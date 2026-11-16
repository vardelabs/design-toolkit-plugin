import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

async function bakeTemplate() {
  const dir = mkdtempSync(join(tmpdir(), 'bake-sheet-'));
  mkdirSync(join(dir, 'shots'));
  const template = readFileSync(join(SKILL, 'assets', 'sheet.html'), 'utf8');
  const data = JSON.parse(/<script type="application\/json" id="sheet-data">([\s\S]*?)<\/script>/.exec(template)[1]);
  for (const shot of new Set(JSON.stringify(data).match(/shots\/[\w-]+\.png/g))) writeFileSync(join(dir, shot), ONE_PIXEL_PNG);
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
