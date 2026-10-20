import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from '../skills/design-spec/scripts/lib/cdp.mjs';
import { launchBrowser } from '../skills/design-spec/scripts/lib/launch-browser.mjs';

const SKILL = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'design-spec');
const CAPTURE = join(SKILL, 'scripts', 'capture.mjs');
const NO_CHROME = findChrome() ? false : 'no Chrome, Edge, or Chromium installed';

const FIXTURE = `<!doctype html><html><head><style>
  body { margin: 0; background: #fff; }
  #box { position: absolute; left: 100px; top: 100px; width: 200px; height: 120px; background: #0a0; }
  #attr { position: absolute; left: 400px; top: 100px; width: 50px; height: 50px; background: #00a; }
  @media (prefers-color-scheme: dark) { body { background: #000; } #box { background: #a00; } }
  :root[data-theme="dark"] #attr { background: #fa0; }
</style></head><body><div id="box"></div><div id="attr"></div></body></html>`;

function capture(args) {
  return JSON.parse(execFileSync(process.execPath, [CAPTURE, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

// PNG IHDR: width and height are big-endian at byte offsets 16 and 20.
function pngSize(file) {
  const buf = readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function workdir() {
  const dir = mkdtempSync(join(tmpdir(), 'design-spec-test-'));
  writeFileSync(join(dir, 'fixture.html'), FIXTURE);
  return dir;
}

function fillTemplate(dir, template, blockId, data) {
  const html = readFileSync(join(SKILL, 'assets', template), 'utf8');
  const pattern = new RegExp(`(<script type="application/json" id="${blockId}">)[\\s\\S]*?(</script>)`);
  assert.match(html, pattern);
  writeFileSync(join(dir, template), html.replace(pattern, `$1${JSON.stringify(data)}$2`));
}

test('clips to the selector plus margin at twice the CSS size', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const [shot] = capture(['--url', join(dir, 'fixture.html'), '--out', dir, '--selector', '#box', '--margin', '10', '--viewport', '800x600', '--theme', 'light']);
  assert.deepEqual(pngSize(shot.file), { width: (200 + 20) * 2, height: (120 + 20) * 2 });
  assert.equal(shot.file, join(dir, 'shot-800x600-light.png'));
});

test('light and dark come from prefers-color-scheme', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const [light, dark] = capture(['--url', join(dir, 'fixture.html'), '--out', dir, '--selector', '#box', '--viewport', '800x600']);
  assert.notDeepEqual(readFileSync(light.file), readFileSync(dark.file));
});

test('--theme-attr reaches a theme set by an attribute, not the media query', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const args = ['--url', join(dir, 'fixture.html'), '--out', dir, '--selector', '#attr', '--margin', '0', '--viewport', '800x600'];
  const [plainLight, plainDark] = capture([...args, '--name', 'plain']);
  const [attrLight, attrDark] = capture([...args, '--name', 'attr', '--theme-attr', 'data-theme']);
  assert.deepEqual(readFileSync(plainLight.file), readFileSync(plainDark.file));
  assert.notDeepEqual(readFileSync(attrLight.file), readFileSync(attrDark.file));
});

test('a selector that matches nothing fails loudly', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const run = spawnSync(process.execPath, [CAPTURE, '--url', join(dir, 'fixture.html'), '--out', dir, '--selector', '#missing', '--theme', 'light'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /--selector "#missing" matched nothing/);
});

function sampleShots(dir) {
  const shots = capture(['--url', join(dir, 'fixture.html'), '--out', join(dir, 'shots'), '--selector', '#box', '--viewport', '800x600']);
  return { light: `shots/${shots[0].file.split('/').pop()}`, dark: `shots/${shots[1].file.split('/').pop()}` };
}

test('the card template renders captured shots with no broken image or page error', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const pair = sampleShots(dir);
  fillTemplate(dir, 'card.html', 'card-data', {
    ref: 'example-org/example-app#1', status: 'Draft', title: 'Synthetic change', summary: 'One line.',
    viewport: '800x600', source: 'synthetic', captured: 'now',
    screens: [{ label: 'Box', before: pair, after: pair }, { label: 'New box', after: pair }],
  });
  const [card] = capture(['--url', join(dir, 'card.html'), '--out', dir, '--name', 'card', '--selector', '.card', '--margin', '0', '--theme', 'light', '--viewport', '1300x900']);
  assert.deepEqual(card.brokenImages, []);
  assert.deepEqual(card.pageErrors, []);
  assert.equal(pngSize(card.file).width, 1200 * 2);
});

// The quick card is one image: every state in a grid, each with its own title and look-for line.
test('the card lays every state out in one grid image, each tile titled and captioned, at 2x', { skip: NO_CHROME }, async () => {
  const dir = workdir();
  const pair = sampleShots(dir);
  const states = ['Empty', 'Loading', 'Saved'].map((label) => ({ label, lookFor: `The ${label.toLowerCase()} box.`, ...pair }));
  fillTemplate(dir, 'card.html', 'card-data', {
    ref: 'example-org/example-app#2', status: 'Draft', title: 'Synthetic states', summary: 'Three states.',
    viewport: '800x600', source: 'synthetic', captured: 'now', columns: 3, states,
  });
  const browser = await launchBrowser({ warn: () => {} });
  let tiles;
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(join(dir, 'card.html')).href, { timeoutMs: 5000, settleMs: 0 });
    tiles = await page.eval(() => [...document.querySelectorAll('.states .tile')].map((t) => ({
      title: t.querySelector('h2').textContent, look: t.querySelector('.look').textContent,
      shots: t.querySelectorAll('img').length, themes: [...t.querySelectorAll('.theme')].map((x) => x.textContent), top: Math.round(t.getBoundingClientRect().top),
    })));
  } finally {
    await browser.close();
  }
  assert.deepEqual(tiles.map((t) => [t.title, t.look, t.shots, t.themes]), states.map((s) => [s.label, `Look for: ${s.lookFor}`, 2, ['Light', 'Dark']]));
  assert.equal(new Set(tiles.map((t) => t.top)).size, 1, 'three columns put the three tiles on one row');
  const shots = capture(['--url', join(dir, 'card.html'), '--out', dir, '--name', 'card', '--selector', '.card', '--margin', '0', '--theme', 'light', '--viewport', '1300x900']);
  assert.equal(shots.length, 1);
  assert.deepEqual(shots[0].brokenImages, []);
  assert.equal(pngSize(shots[0].file).width, 1200 * 2);
});

test('the sheet template renders captured shots with no broken image or page error', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const pair = sampleShots(dir);
  const data = JSON.parse(/<script type="application\/json" id="sheet-data">([\s\S]*?)<\/script>/.exec(readFileSync(join(SKILL, 'assets', 'sheet.html'), 'utf8'))[1]);
  data.beforeAfter = [{ label: 'Box', before: pair, after: pair }];
  data.states = [{ screen: 'Box', items: [{ label: 'Default', source: 'Real server', ...pair }] }];
  data.zooms = [{ label: 'Box', lookFor: 'The box.', before: pair, after: pair }];
  data.interactive = data.interactive.map((item) => ({ ...item, background: pair }));
  fillTemplate(dir, 'sheet.html', 'sheet-data', data);
  const shots = capture(['--url', join(dir, 'sheet.html'), '--out', dir, '--name', 'sheet', '--viewport', 'desktop', '--viewport', '390x844']);
  for (const shot of shots) {
    assert.deepEqual(shot.brokenImages, []);
    assert.deepEqual(shot.pageErrors, []);
  }
});

function sheetData() {
  return JSON.parse(/<script type="application\/json" id="sheet-data">([\s\S]*?)<\/script>/.exec(readFileSync(join(SKILL, 'assets', 'sheet.html'), 'utf8'))[1]);
}

async function inSheet(data, probe) {
  const dir = workdir();
  fillTemplate(dir, 'sheet.html', 'sheet-data', data);
  const browser = await launchBrowser({ warn: () => {} });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(join(dir, 'sheet.html')).href, { timeoutMs: 5000, settleMs: 0 });
    return await page.eval(probe);
  } finally {
    await browser.close();
  }
}

// Two entries that share a class name with different CSS, so a rule that leaks from one to the other shows.
function interactiveItem(label, colour, states) {
  return {
    label, width: 120, height: 40, background: { light: 'shots/none.png', dark: 'shots/none.png' },
    overlay: { html: '<button class="cap" type="button">x</button>', css: `.cap { color: ${colour}; } .cap:hover, .cap.is-hover { background: rgb(1, 2, 3); }` },
    states,
  };
}

test('an interactive item draws a live stage per theme and one frozen stage per state, with its CSS kept to itself', { skip: NO_CHROME }, async () => {
  const data = {
    ...sheetData(), ...OPTIONAL, checks: null,
    interactive: [
      interactiveItem('Red', 'rgb(200, 0, 0)', [{ name: 'Hover', target: '.cap', mode: 'hover' }, { name: 'Lost', target: '.nope', mode: 'hover' }]),
      interactiveItem('Blue', 'rgb(0, 0, 200)', []),
    ],
  };
  const seen = await inSheet(data, () => {
    const block = (i) => document.querySelector(`[data-interactive="${i}"]`);
    const stages = (i) => [...block(i).querySelectorAll('.stage')];
    const red = stages(0);
    return {
      live: red.filter((s) => s.classList.contains('live')).map((s) => [...s.classList].filter((c) => c === 'light' || c === 'dark')[0]),
      frozen: red.filter((s) => !s.classList.contains('live')).map((s) => s.querySelector('.cap').classList.contains('is-hover')),
      hoverFill: getComputedStyle(red.find((s) => !s.classList.contains('live') && s.querySelector('.is-hover')).querySelector('.cap')).backgroundColor,
      focusable: red.map((s) => { const b = s.querySelector('.cap'); b.focus(); return document.activeElement === b; }),
      hit: [red[0], red[2]].map((s) => {
        const b = s.querySelector('.cap');
        b.scrollIntoView();
        const r = b.getBoundingClientRect();
        return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b;
      }),
      errors: [...block(0).querySelectorAll('.stage-error')].map((e) => e.textContent),
      colours: [0, 1].map((i) => getComputedStyle(block(i).querySelector('.cap')).color),
    };
  });
  assert.deepEqual(seen.live, ['light', 'dark']);
  // Per theme: at rest, Hover, then the lost target, which stays at rest.
  assert.deepEqual(seen.frozen, [false, true, false, false, true, false]);
  assert.equal(seen.hoverFill, 'rgb(1, 2, 3)');
  // Only the two live stages take focus; inert also takes the frozen copies out of the pointer.
  assert.deepEqual(seen.focusable, [true, true, false, false, false, false, false, false]);
  assert.deepEqual(seen.hit, [true, false]);
  assert.deepEqual(seen.errors, ['Target ".nope" matched nothing in the overlay', 'Target ".nope" matched nothing in the overlay']);
  assert.deepEqual(seen.colours, ['rgb(200, 0, 0)', 'rgb(0, 0, 200)']);
});

async function summaryNote(template, blockId, data, width) {
  const dir = workdir();
  fillTemplate(dir, template, blockId, data);
  const browser = await launchBrowser({ warn: () => {} });
  try {
    const page = await browser.newPage({ width, height: 900 });
    await page.goto(pathToFileURL(join(dir, template)).href, { timeoutMs: 5000, settleMs: 100 });
    return await page.eval(() => document.querySelector('.too-long')?.textContent ?? null);
  } finally {
    await browser.close();
  }
}

const LONG_SUMMARY = 'People can now attach a file from the composer, see how many files are attached, and retry a failed upload. '.repeat(6);

test('a summary over three lines is flagged on the card and the desktop-width sheet, and not at phone width', { skip: NO_CHROME }, async () => {
  const card = { ref: 'r', status: 's', title: 't', viewport: 'v', source: 's', captured: 'c', screens: [] };
  assert.equal(await summaryNote('card.html', 'card-data', { ...card, summary: 'One short line.' }, 1300), null);
  assert.match(await summaryNote('card.html', 'card-data', { ...card, summary: LONG_SUMMARY }, 1300), /^This summary runs \d+ lines; cut it to 3\.$/);
  const sheet = { ...sheetData(), ...OPTIONAL, checks: null };
  assert.equal(await summaryNote('sheet.html', 'sheet-data', { ...sheet, summary: 'One short line.' }, 1280), null);
  assert.match(await summaryNote('sheet.html', 'sheet-data', { ...sheet, summary: LONG_SUMMARY }, 1280), /runs \d+ lines/);
  assert.equal(await summaryNote('sheet.html', 'sheet-data', { ...sheet, summary: LONG_SUMMARY }, 400), null);
});

const sheetHeadings = (data) => inSheet(data, () => [...document.querySelectorAll('h2')].map((h) => h.textContent));
const OPTIONAL = { colors: [], zooms: [], interactive: [], parity: [], options: [], removed: [], notInScope: [] };

test('the sheet renders every section, each optional one only when it has entries, and checks only when ui-inspect ran', { skip: NO_CHROME }, async () => {
  const full = await sheetHeadings(sheetData());
  assert.deepEqual(full, ['What Changed Since the Last Round', 'Colour Changes', 'Zoomed In', 'Before and After', 'Interactive States', 'Every State', 'Measured Checks', 'Removed as Impossible', 'Reference Product Parity', 'Options Considered', 'Interaction Notes', 'Not in This PR', 'Open Questions']);
  const lean = await sheetHeadings({ ...sheetData(), ...OPTIONAL, checks: null });
  assert.deepEqual(lean, ['What Changed Since the Last Round', 'Before and After', 'Every State', 'Interaction Notes', 'Open Questions']);
  const empty = await sheetHeadings({ ...sheetData(), ...OPTIONAL, checks: [] });
  assert.deepEqual(empty, lean);
});

test('an audit sheet with findings and no change sections renders only what it holds', { skip: NO_CHROME }, async () => {
  const audit = { ...sheetData(), ...OPTIONAL, checks: null, beforeAfter: [], states: [], interactions: [], findings: [{ level: 'FAIL', area: 'colour', text: 'Pale words', fix: 'Darken them', where: 'desktop/light' }] };
  assert.deepEqual(await sheetHeadings(audit), ['What Changed Since the Last Round', 'Findings, in the Order to Fix Them', 'Open Questions']);
});

const colorRows = (colors) => inSheet({ ...sheetData(), colors }, () => [...document.querySelectorAll('table.colors tr')].slice(1).map((row) => [...row.querySelectorAll('.pill')].map((p) => p.textContent)));

// The expected ratios were measured outside this template: 3.3 and 5.1 by a real-app contrast review, and
// 2.8 for the tinted badge by ui-inspect, so the test checks the sheet's maths against another source.
test('the colour table computes each ratio from its colours, tint included, and judges it against the row target', { skip: NO_CHROME }, async () => {
  const rows = await colorRows(sheetData().colors);
  assert.deepEqual(rows, [['3.3:1', '5.1:1', 'Now passes'], ['2.8:1', '4.8:1', 'Now passes']]);
});

test('the colour table judges the after colour first, says when a row already passed, and flags a bad colour or a see-through ground', { skip: NO_CHROME }, async () => {
  const rows = await colorRows([
    { token: '--ink', where: 'Body', theme: 'light', surface: 'page', target: 4.5, before: { text: '#333333', ground: '#ffffff' }, after: { text: '#222222', ground: '#ffffff' } },
    { token: '--typo', where: 'Body', theme: 'dark', surface: 'page', target: 4.5, before: { text: '#33', ground: '#000000' }, after: { text: '#eeeeee', ground: 'rgba(0, 0, 0, 0.5)' } },
    { token: '--muted', where: 'Captions', theme: 'light', surface: 'page', target: 4.5, before: { text: '#333333', ground: '#ffffff' }, after: { text: '#bbbbbb', ground: '#ffffff' } },
  ]);
  assert.equal(rows[0][2], 'Already passed; changed to match');
  assert.match(rows[1][0], /^Not a colour: #33/);
  assert.match(rows[1][1], /see-through; give the opaque surface as ground/);
  assert.equal(rows[1][2], 'After colour could not be measured');
  assert.equal(rows[2][2], 'Now below target');
});

test('zoom crops show every captured pixel, and context shots show half', { skip: NO_CHROME }, async () => {
  const dir = workdir();
  const pair = sampleShots(dir);
  fillTemplate(dir, 'sheet.html', 'sheet-data', { ...sheetData(), zooms: [{ label: 'Box', lookFor: 'The box.', before: pair, after: pair }], beforeAfter: [{ label: 'Box', lookFor: 'The box.', before: pair, after: pair }], states: [], interactive: [] });
  const browser = await launchBrowser({ warn: () => {} });
  try {
    const page = await browser.newPage({ width: 1280, height: 800 });
    await page.goto(pathToFileURL(join(dir, 'sheet.html')).href, { timeoutMs: 5000, settleMs: 300 });
    const sizes = await page.eval(() => Promise.all([...document.images].map((i) => i.decode().then(() => i))).then((imgs) => imgs.map((i) => [i.closest('.zoom') ? 'zoom' : 'context', i.style.width, i.naturalWidth])));
    for (const [kind, width, natural] of sizes) assert.equal(width, `${kind === 'zoom' ? natural : natural / 2}px`, kind);
    const looks = await page.eval(() => [...document.querySelectorAll('.look b')].length);
    assert.equal(looks, 2);
  } finally {
    await browser.close();
  }
});

test('clicking a shot opens it full size in the page, and a click on it closes it', { skip: NO_CHROME }, async () => {
  const dir = workdir();
  const pair = sampleShots(dir);
  fillTemplate(dir, 'sheet.html', 'sheet-data', { ...sheetData(), zooms: [], beforeAfter: [{ label: 'Box', lookFor: 'The box.', before: pair, after: pair }], states: [] });
  const browser = await launchBrowser({ warn: () => {} });
  try {
    const page = await browser.newPage({ width: 1280, height: 800 });
    await page.goto(pathToFileURL(join(dir, 'sheet.html')).href, { timeoutMs: 5000, settleMs: 300 });
    const result = await page.eval(() => {
      const shot = document.querySelector('figure button');
      const viewer = document.getElementById('viewer');
      shot.click();
      const opened = { open: viewer.open, src: viewer.querySelector('img').getAttribute('src'), shown: shot.querySelector('img').getAttribute('src') };
      viewer.click();
      return { ...opened, closed: !viewer.open, links: document.querySelectorAll('figure a').length };
    });
    assert.match(result.shown, /^shots\/.+\.png$/);
    assert.deepEqual(result, { open: true, src: result.shown, shown: result.shown, closed: true, links: 0 });
  } finally {
    await browser.close();
  }
});

test('--full-page captures the whole scroll width and height, overflow included', { skip: NO_CHROME }, () => {
  const dir = workdir();
  writeFileSync(join(dir, 'wide.html'), '<!doctype html><style>body{margin:0;height:0}</style><div style="position:absolute;left:0;top:0;width:1000px;height:700px;background:#09f"></div>');
  const [shot] = capture(['--url', join(dir, 'wide.html'), '--out', dir, '--name', 'wide', '--full-page', '--viewport', '400x300', '--theme', 'light']);
  assert.deepEqual(pngSize(shot.file), { width: 1000 * 2, height: 700 * 2 });
});

test('several selectors crop to the union of their boxes', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const [shot] = capture(['--url', join(dir, 'fixture.html'), '--out', dir, '--selector', '#box', '--selector', '#attr', '--margin', '0', '--viewport', '800x600', '--theme', 'light']);
  assert.deepEqual(pngSize(shot.file), { width: (450 - 100) * 2, height: (220 - 100) * 2 });
});

test('--blur drops the focus a script left behind', { skip: NO_CHROME }, () => {
  const dir = workdir();
  writeFileSync(join(dir, 'focus.html'), '<!doctype html><style>body{margin:0;background:#fff}button{position:absolute;left:20px;top:20px;width:120px;height:40px;border:0;background:#ddd;outline:none}button:focus{outline:6px solid #f00}</style><button id="b">Open</button><script>document.getElementById("b").focus()</script>');
  const args = ['--url', join(dir, 'focus.html'), '--out', dir, '--selector', '#b', '--margin', '10', '--viewport', '400x200', '--theme', 'light'];
  const [focused] = capture([...args, '--name', 'focused']);
  const [blurred] = capture([...args, '--name', 'blurred', '--blur']);
  assert.notDeepEqual(readFileSync(focused.file), readFileSync(blurred.file));
});

test('the sheet template carries no document skeleton, since the Artifact tool adds its own', () => {
  const html = readFileSync(join(SKILL, 'assets', 'sheet.html'), 'utf8');
  assert.doesNotMatch(html, /<!doctype|<html|<head|<body|<meta/i);
});

test('the sheet labels before and after from its data', { skip: NO_CHROME }, async () => {
  const dir = workdir();
  fillTemplate(dir, 'sheet.html', 'sheet-data', { ...sheetData(), beforeLabel: 'Before (v1.2.0)', afterLabel: 'After (main @ 9f8e7d6)' });
  const browser = await launchBrowser({ warn: () => {} });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(join(dir, 'sheet.html')).href, { timeoutMs: 5000, settleMs: 0 });
    const heads = await page.eval(() => [...document.querySelectorAll('.pair .colhead')].map((h) => h.textContent));
    assert.ok(heads.includes('Before (v1.2.0)') && heads.includes('After (main @ 9f8e7d6)'));
  } finally {
    await browser.close();
  }
});
