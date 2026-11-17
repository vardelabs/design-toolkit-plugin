import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bake, capturedAt, chooseSources, PAGE_LIMIT_BYTES, pageSizeProblem, pathsOutsideShots, shotPaths } from '../skills/design-spec/scripts/bake-sheet.mjs';
import { fill } from '../skills/design-spec/scripts/fill.mjs';
import { findChrome } from '../skills/design-spec/scripts/lib/cdp.mjs';
import { launchBrowser, useBundledChromiumIfNeeded } from '../skills/design-spec/scripts/lib/launch-browser.mjs';
import { toUrl } from '../skills/design-spec/scripts/lib/page.mjs';
import { findPlaywrightChromium } from '../skills/design-spec/scripts/lib/playwright-chromium.mjs';
import { sheetProblems } from '../skills/design-spec/scripts/lib/sheet-check.mjs';

const SKILL = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'design-spec');
const NO_BROWSER = findChrome() || findPlaywrightChromium() ? false : 'no Chrome or Playwright Chromium installed';
const ONE_PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');

test('a relative, root-relative, or file src fails the check', () => {
  for (const src of ['shots/a.png', '/shots/a.png', 'file:///tmp/a.png', '']) {
    assert.match(sheetProblems(`<img alt="x" src="${src}">`).join(), /not a data URI or an https URL/);
  }
});

test('a data URI or an https asset URL passes the check', () => {
  assert.deepEqual(sheetProblems('<img alt="x" src="data:image/png;base64,AAAA"><img src=\'https://claude.ai/a.png\'>'), []);
});

test('lazy loading and any script fail the check', () => {
  assert.match(sheetProblems('<img loading="lazy" src="data:image/png;base64,AAAA">').join(), /loads lazily/);
  assert.match(sheetProblems('<main></main><script>build()</script>').join(), /has a <script>/);
});

test('the capture time is the newest shot file time, from the system clock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bake-sheet-'));
  const [older, newer] = [join(dir, 'a.png'), join(dir, 'b.png')];
  writeFileSync(older, ONE_PIXEL_PNG);
  writeFileSync(newer, ONE_PIXEL_PNG);
  utimesSync(older, new Date('2026-11-08T10:00:00Z'), new Date('2026-11-08T10:00:00Z'));
  utimesSync(newer, new Date('2026-11-08T21:45:00Z'), new Date('2026-11-08T21:45:00Z'));
  assert.equal(capturedAt([older, newer], 'UTC'), '2026-11-08 21:45 UTC');
  assert.equal(capturedAt([older, newer], 'America/Los_Angeles'), '2026-11-08 13:45 PST');
});

test('the size limit counts every place the page shows a shot', () => {
  const shot = `<img src="data:image/png;base64,${'A'.repeat(Math.ceil(PAGE_LIMIT_BYTES * 0.4))}">`;
  assert.equal(pageSizeProblem(shot, false), null);
  assert.match(pageSizeProblem(shot.repeat(3), false), /Upload the shots to the Artifact's asset store/);
  assert.match(pageSizeProblem(shot.repeat(3), true), /Split it into two sheets/);
});

test('only paths under shots/ count as shots, never prose that names an image', () => {
  const data = { summary: 'The logo.png now sits left.', states: [{ lookFor: 'see hero.webp', light: 'shots/a-light.png' }] };
  assert.deepEqual([...shotPaths(data)], ['shots/a-light.png']);
});

test('an --assets map must name every shot', () => {
  assert.deepEqual(chooseSources(['big.png'], tmpdir(), { 'big.png': 'https://claude.ai/a/big.png' }), { 'big.png': 'https://claude.ai/a/big.png' });
  assert.throws(() => chooseSources(['big.png'], tmpdir(), {}), /--assets has no URL for: big\.png/);
});

const SHEET_THAT_THROWS = '<title>x</title><main></main><script type="application/json" id="sheet-data">{}</script>'
  + '<script>throw new Error("render broke")</script>';

test('a sheet that throws while it renders fails the bake', { skip: NO_BROWSER }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bake-sheet-'));
  writeFileSync(join(dir, 'sheet.html'), SHEET_THAT_THROWS);
  await assert.rejects(bake(join(dir, 'sheet.html'), null), /threw while it rendered:[\s\S]*render broke/);
});

test('a browser that will not start leaves no staging file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bake-sheet-'));
  writeFileSync(join(dir, 'sheet.html'), SHEET_THAT_THROWS);
  const saved = process.env.CHROME_PATH;
  process.env.CHROME_PATH = '/bin/false';
  try {
    await assert.rejects(bake(join(dir, 'sheet.html'), null));
  } finally {
    if (saved === undefined) delete process.env.CHROME_PATH;
    else process.env.CHROME_PATH = saved;
  }
  assert.deepEqual(readdirSync(dir), ['sheet.html']);
});

test('a baked sheet carries every shot inline, with no script and no lazy load', { skip: NO_BROWSER }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bake-sheet-'));
  mkdirSync(join(dir, 'shots'));
  const template = readFileSync(join(SKILL, 'assets', 'sheet.html'), 'utf8');
  const data = JSON.parse(/<script type="application\/json" id="sheet-data">([\s\S]*?)<\/script>/.exec(template)[1]);
  const shots = new Set(JSON.stringify(data).match(/shots\/[\w-]+\.png/g));
  for (const shot of shots) writeFileSync(join(dir, shot), ONE_PIXEL_PNG);
  writeFileSync(join(dir, 'sheet.html'), fill(template, { ...data, captured: '2099-01-01 00:00' }));
  const html = await bake(join(dir, 'sheet.html'), null);
  assert.deepEqual(sheetProblems(html), []);
  assert.equal(html.match(/<img\b/g).length >= shots.size, true);
  assert.doesNotMatch(html, /2099-01-01/);
});

test('a sheet with no shots is dated by the bake time', () => {
  assert.equal(capturedAt([], 'UTC', new Date('2026-11-09T04:40:00Z')), '2026-11-09 04:40 UTC');
});

const FOOTNOTE_SHEET = '<title>x</title><main></main><script type="application/json" id="sheet-data">{}</script>'
  + '<script>document.querySelector("main").textContent = "Captured " + '
  + 'JSON.parse(document.getElementById("sheet-data").textContent).captured;</script>';

test('a baked sheet with no shots still names a capture time', { skip: NO_BROWSER }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bake-sheet-'));
  writeFileSync(join(dir, 'sheet.html'), FOOTNOTE_SHEET);
  assert.match(await bake(join(dir, 'sheet.html'), null), /Captured \d{4}-\d{2}-\d{2} \d{2}:\d{2} /);
});

// zlib.crc32 arrived after Node 22.0, and the skill supports every Node 22, so the PNG checksum is computed here.
function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

// A solid grey PNG of the given size, so a test can tell the on-page width from the opened width.
function greyPng(width, height) {
  const chunk = (type, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), body])));
    return Buffer.concat([length, Buffer.from(type), body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  const rows = Buffer.alloc((width + 1) * height, 0x80);
  for (let row = 0; row < height; row++) rows[row * (width + 1)] = 0;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

async function bakeTemplate(png = ONE_PIXEL_PNG) {
  const dir = mkdtempSync(join(tmpdir(), 'bake-sheet-'));
  mkdirSync(join(dir, 'shots'));
  const template = readFileSync(join(SKILL, 'assets', 'sheet.html'), 'utf8');
  const data = JSON.parse(/<script type="application\/json" id="sheet-data">([\s\S]*?)<\/script>/.exec(template)[1]);
  for (const shot of new Set(JSON.stringify(data).match(/shots\/[\w-]+\.png/g))) writeFileSync(join(dir, shot), png);
  writeFileSync(join(dir, 'sheet.html'), fill(template, data));
  const out = join(dir, 'sheet-baked.html');
  writeFileSync(out, await bake(join(dir, 'sheet.html'), null));
  return out;
}

test('every baked shot links to its own figure and carries a close link, with one copy of each image', { skip: NO_BROWSER }, async () => {
  const html = readFileSync(await bakeTemplate(), 'utf8');
  const figures = html.match(/<figure\b[\s\S]*?<\/figure>/g);
  assert.ok(figures.length >= 4);
  const ids = figures.map((figure) => {
    const id = /^<figure id="(shot-\d+)">/.exec(figure)?.[1];
    assert.ok(id, `a figure has no shot id: ${figure.slice(0, 60)}`);
    assert.match(figure, new RegExp(`<a class="open" href="#${id}"><img\\b`));
    assert.match(figure, /<a class="close" href="#shot-closed"/);
    assert.equal(figure.match(/<img\b/g).length, 1);
    return id;
  });
  assert.equal(new Set(ids).size, ids.length);
  assert.doesNotMatch(html, /id="shot-closed"/);
});

test('a baked shot opens as a full-viewport overlay on its fragment and closes in place', { skip: NO_BROWSER }, async () => {
  const sheet = await bakeTemplate();
  useBundledChromiumIfNeeded();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ width: 390, height: 844, dsf: 1 });
    await page.goto(toUrl(sheet), { settleMs: 0 });
    const state = await page.eval(async () => {
      const figure = document.getElementById('shot-2');
      // A fragment link navigates in a task after the click, not during it.
      const settle = (hash) => new Promise((done) => {
        const poll = () => (location.hash === hash ? done() : setTimeout(poll, 10));
        poll();
      });
      window.scrollTo(0, 300);
      const before = scrollY;
      figure.querySelector('.open').click();
      await settle('#shot-2');
      const open = getComputedStyle(figure).position;
      const box = figure.getBoundingClientRect();
      const closer = document.elementFromPoint(2, 842);
      closer.closest('.close').click();
      await settle('#shot-closed');
      return { open, box: [box.width, box.height], closer: closer.closest('a')?.className,
        closed: getComputedStyle(figure).position, before, after: scrollY };
    });
    assert.equal(state.open, 'fixed');
    assert.deepEqual(state.box, [390, 844]);
    assert.equal(state.closer, 'close');
    assert.equal(state.closed, 'static');
    assert.equal(state.after, state.before);
  } finally {
    await browser.close();
  }
});

const SHOT_WIDTH = 1200;

// Opens one plain shot and one zoom shot in turn and returns each one's width on the page and when opened.
// The capture browser runs with hidden scrollbars, so a scrollbar is stood in for by padding of the same width
// on the overlay: both narrow the overlay's content box and leave the viewport width as it was.
async function shotWidths(sheet, viewportWidth, scrollbarWidth = 0) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ width: viewportWidth, height: 800, dsf: 1 });
    await page.goto(toUrl(sheet), { settleMs: 0 });
    return await page.eval(async (scrollbarWidth) => {
      document.head.append(Object.assign(document.createElement('style'), { textContent: `figure:target { padding-right: ${scrollbarWidth}px; }` }));
      const settle = (hash) => new Promise((done) => {
        const poll = () => (location.hash === hash ? done() : setTimeout(poll, 10));
        poll();
      });
      const measure = async (figure) => {
        const img = figure.querySelector('img');
        const onPage = img.getBoundingClientRect().width;
        const column = figure.parentElement.getBoundingClientRect().width;
        figure.querySelector('.open').click();
        await settle(`#${figure.id}`);
        const opened = img.getBoundingClientRect().width;
        const scrolls = figure.scrollWidth > figure.clientWidth;
        figure.querySelector('.close').click();
        await settle('#shot-closed');
        return { onPage, column, opened, scrolls };
      };
      return {
        plain: await measure(document.querySelector('.themes figure')),
        zoom: await measure(document.querySelector('.zoom figure')),
      };
    }, scrollbarWidth);
  } finally {
    await browser.close();
  }
}

test('an opened shot shows larger than on the page, up to one CSS px per captured pixel', { skip: NO_BROWSER }, async () => {
  const sheet = await bakeTemplate(greyPng(SHOT_WIDTH, 40));
  useBundledChromiumIfNeeded();
  const wide = await shotWidths(sheet, 1440);
  assert.equal(wide.plain.onPage, Math.min(SHOT_WIDTH / 2, wide.plain.column));
  assert.equal(wide.zoom.onPage, Math.min(SHOT_WIDTH, wide.zoom.column));
  assert.equal(wide.plain.opened, SHOT_WIDTH);
  assert.equal(wide.zoom.opened, SHOT_WIDTH);

  const narrow = await shotWidths(sheet, 390);
  assert.ok(narrow.plain.onPage < SHOT_WIDTH / 2);
  assert.equal(narrow.plain.opened, SHOT_WIDTH / 2, 'a narrow screen never shows the opened shot smaller than true size');
  assert.equal(narrow.zoom.opened, SHOT_WIDTH);
  assert.ok(narrow.plain.scrolls && narrow.zoom.scrolls, 'the overlay scrolls an opened shot wider than the screen');

  const between = await shotWidths(sheet, 1000);
  assert.equal(between.plain.opened, 1000 - 32, 'a shot wider than the screen opens at the screen width');
  assert.equal(between.plain.scrolls, false, 'a shot that fits the screen does not scroll sideways');

  const scrollbar = 15;
  const besideScrollbar = await shotWidths(sheet, 1000, scrollbar);
  assert.equal(besideScrollbar.plain.opened, 1000 - scrollbar - 32, 'the opened shot fills the overlay beside its scrollbar');
  assert.equal(besideScrollbar.plain.scrolls, false, 'a scrollbar does not push the opened shot into a sideways scroll');
});

test('the close label stays in the top right corner while the opened shot scrolls both ways', { skip: NO_BROWSER }, async () => {
  const sheet = await bakeTemplate(greyPng(SHOT_WIDTH, 2000));
  useBundledChromiumIfNeeded();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ width: 390, height: 800, dsf: 1 });
    await page.goto(toUrl(sheet), { settleMs: 0 });
    const corners = await page.eval(async () => {
      const figure = document.querySelector('.themes figure');
      figure.querySelector('.open').click();
      await new Promise((done) => {
        const poll = () => (location.hash === `#${figure.id}` ? done() : setTimeout(poll, 10));
        poll();
      });
      const label = figure.querySelector('.close span');
      const corner = () => {
        const box = label.getBoundingClientRect();
        return [innerWidth - box.right, box.top];
      };
      const start = corner();
      figure.scrollTo(figure.scrollWidth, figure.scrollHeight);
      return { start, scrolled: corner(), moved: figure.scrollLeft > 0 && figure.scrollTop > 0 };
    });
    assert.ok(corners.moved, 'the opened shot scrolls both ways');
    assert.deepEqual(corners.start, [12, 12]);
    assert.deepEqual(corners.scrolled, [12, 12]);
  } finally {
    await browser.close();
  }
});

test('an opened shot wider than the screen can be scrolled to every edge, and a click on any part of it closes it', { skip: NO_BROWSER }, async () => {
  const sheet = await bakeTemplate(greyPng(SHOT_WIDTH, 40));
  useBundledChromiumIfNeeded();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ width: 390, height: 800, dsf: 1 });
    await page.goto(toUrl(sheet), { settleMs: 0 });
    const reach = await page.eval(async () => {
      const figure = document.querySelector('.themes figure');
      figure.querySelector('.open').click();
      await new Promise((done) => {
        const poll = () => (location.hash === `#${figure.id}` ? done() : setTimeout(poll, 10));
        poll();
      });
      const img = figure.querySelector('img');
      const left = img.getBoundingClientRect().left;
      figure.scrollTo(figure.scrollWidth, 0);
      const box = img.getBoundingClientRect();
      const closer = document.elementFromPoint(box.right - 2, box.top + box.height / 2);
      return { left, right: box.right, width: innerWidth, closes: Boolean(closer?.closest('.close')) };
    });
    assert.ok(reach.left >= 0, `the shot's left edge sits at ${reach.left}px, out of scroll reach`);
    assert.ok(reach.right <= reach.width, `the shot's right edge sits at ${reach.right}px after a full scroll`);
    assert.ok(reach.closes, 'a click on the scrolled-in part of the shot closes it');
  } finally {
    await browser.close();
  }
});

test('a shot path that leaves shots/ is refused, by .. or by a symlink', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bake-sheet-'));
  mkdirSync(join(dir, 'shots'));
  writeFileSync(join(dir, 'secret.png'), ONE_PIXEL_PNG);
  writeFileSync(join(dir, 'shots', 'a.png'), ONE_PIXEL_PNG);
  symlinkSync(join(dir, 'secret.png'), join(dir, 'shots', 'link.png'));
  const paths = ['shots/a.png', 'shots/../secret.png', 'shots/link.png', 'shots/not-yet.png'];
  assert.deepEqual(pathsOutsideShots(paths, dir), ['shots/../secret.png', 'shots/link.png']);
  symlinkSync(dir, `${dir}-alias`);
  assert.deepEqual(pathsOutsideShots(['shots/not-yet.png'], `${dir}-alias`), []);
});

test('the bake stops before it reads a path outside shots/', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bake-sheet-'));
  writeFileSync(join(dir, 'sheet.html'), '<script type="application/json" id="sheet-data">{"shot":"shots/../../etc.png"}</script>');
  await assert.rejects(bake(join(dir, 'sheet.html'), null), /shot paths leave .*shots: shots\/\.\.\/\.\.\/etc\.png/);
});
