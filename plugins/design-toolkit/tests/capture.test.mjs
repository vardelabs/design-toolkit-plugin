import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
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

test('--card refuses a crop over the height limit and writes no file', { skip: NO_CHROME }, () => {
  const dir = workdir();
  writeFileSync(join(dir, 'tall.html'), '<!doctype html><body style="margin:0"><div class="card" style="width:200px;height:401px"></div></body>');
  const run = spawnSync(process.execPath, [CAPTURE, '--url', join(dir, 'tall.html'), '--out', dir, '--name', 'card', '--selector', '.card', '--margin', '0', '--card', '--viewport', '800x600', '--theme', 'light'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Make the full sheet instead/);
  assert.equal(existsSync(join(dir, 'card-800x600-light.png')), false);
});

test('with no --margin, a selector crop keeps 96px of the screen around the element', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const [shot] = capture(['--url', join(dir, 'fixture.html'), '--out', dir, '--selector', '#box', '--viewport', '800x600', '--theme', 'light']);
  assert.deepEqual(pngSize(shot.file), { width: (200 + 192) * 2, height: (120 + 192) * 2 });
});

test('light and dark come from prefers-color-scheme', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const [light, dark] = capture(['--url', join(dir, 'fixture.html'), '--out', dir, '--selector', '#box', '--viewport', '800x600']);
  assert.notDeepEqual(readFileSync(light.file), readFileSync(dark.file));
  assert.equal(light.colorModes.note, 'Dark mode: follows the system setting, captured light and dark.');
});

const BOX = '<div id="box" style="position:absolute;left:100px;top:100px;width:200px;height:120px;background:#0a0"></div>';
const NO_DARK = `<!doctype html><html><body style="margin:0;background:#fff">${BOX}</body></html>`;
const INERT_DARK_RULE = `<!doctype html><html><head><style>
  body { margin: 0; background: #fff; }
  @media (prefers-color-scheme: dark) { .not-on-this-page { color: #fff; } }
</style></head><body>${BOX}</body></html>`;
// A template that hard-sets light on a framework whose CSS also ships a dark theme, as Tabler does.
const HARD_SET_LIGHT = `<!doctype html><html lang="en" data-bs-theme="light"><head><style>
  :root, [data-bs-theme="light"] { --page-bg: #fff; }
  [data-bs-theme="dark"] { --page-bg: #1a1d21; }
  body { margin: 0; background: var(--page-bg); }
</style></head><body>${BOX}</body></html>`;
const toggleFixture = (onClick) => `<!doctype html><html data-theme="light"><head><style>
  body { margin: 0; background: #fff; }
  [data-theme="dark"] body { background: #111; }
</style><script>
  if (localStorage.theme) document.documentElement.dataset.theme = localStorage.theme;
</script></head><body>${BOX}<button id="toggle" onclick="${onClick}">Theme</button></body></html>`;
const SAVED_TOGGLE = toggleFixture("document.documentElement.dataset.theme = localStorage.theme = 'dark'");

function writePage(dir, name, html) {
  writeFileSync(join(dir, name), html);
  return join(dir, name);
}

// The red channel of a crop's top-left pixel, which a #box crop with a margin takes from the page ground.
function groundRed(file) {
  return pngRows(file).rows[0][0];
}

test('a page with no dark mode is captured in light only, and the shot says so', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const url = writePage(dir, 'plain.html', NO_DARK);
  const shots = capture(['--url', url, '--out', dir, '--selector', '#box', '--viewport', '800x600']);
  assert.deepEqual(shots.map((s) => s.theme), ['light']);
  assert.equal(shots[0].colorModes.note, 'Dark mode: not supported, captured light only.');
  assert.equal(shots[0].colorModes.detail, 'The page reads light with either colour scheme requested.');
  const run = spawnSync(process.execPath, [CAPTURE, '--url', url, '--out', dir, '--theme', 'dark'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /--theme dark: Dark mode: not supported/);
});

test('a template that hard-sets light is captured light only, though its framework CSS has a dark theme', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const url = writePage(dir, 'hard-set.html', HARD_SET_LIGHT);
  const shots = capture(['--url', url, '--out', dir, '--selector', '#box', '--viewport', '800x600']);
  assert.deepEqual(shots.map((s) => s.theme), ['light']);
  assert.equal(groundRed(shots[0].file), 255);
  const forced = spawnSync(process.execPath, [CAPTURE, '--url', url, '--out', dir, '--theme-attr', 'data-bs-theme'], { encoding: 'utf8' });
  assert.equal(forced.status, 1);
  assert.match(forced.stderr, /Unknown option '--theme-attr'/);
});

test('a dark theme in oklch, the computed syntax Tailwind v4 leaves, counts as a dark mode', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const url = writePage(dir, 'oklch.html', `<!doctype html><html><head><style>
    body { margin: 0; background: oklch(0.98 0 0); }
    @media (prefers-color-scheme: dark) { body { background: oklch(0.2 0 0); } }
  </style></head><body>${BOX}</body></html>`);
  const shots = capture(['--url', url, '--out', dir, '--viewport', '800x600']);
  assert.deepEqual(shots.map((s) => s.theme), ['light', 'dark']);
});

test('a dark mode counts when a hero is dark over the first screen in both modes', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const url = writePage(dir, 'hero.html', `<!doctype html><html><head><style>
    body { margin: 0; background: #fff; }
    @media (prefers-color-scheme: dark) { body { background: #111; } }
    .hero { height: 100vh; background: #1b1b1b; }
  </style></head><body><div class="hero"></div><p>Featured articles</p></body></html>`);
  const shots = capture(['--url', url, '--out', dir, '--viewport', '800x600']);
  assert.deepEqual(shots.map((s) => s.theme), ['light', 'dark']);
});

test('a dark mode painted as a gradient on <body> counts', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const url = writePage(dir, 'gradient.html', `<!doctype html><html><head><style>
    body { margin: 0; background: #fff; }
    @media (prefers-color-scheme: dark) { body { background-image: linear-gradient(#111, #222); } }
  </style></head><body>${BOX}</body></html>`);
  assert.deepEqual(capture(['--url', url, '--out', dir, '--viewport', '800x600']).map((s) => s.theme), ['light', 'dark']);
});

test('--theme narrows the run, and the report names only the modes it captured', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const [shot, more] = capture(['--url', join(dir, 'fixture.html'), '--out', dir, '--viewport', '800x600', '--theme', 'light']);
  assert.equal(more, undefined);
  assert.deepEqual(shot.colorModes.modes, ['light']);
  assert.equal(shot.colorModes.note, 'Dark mode: follows the system setting, captured light only.');
});

test('a page that renders dark for a light request and light for a dark one gets each shot under its real mode', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const url = writePage(dir, 'inverted.html', `<!doctype html><html><head><style>
    body { margin: 0; background: #111; }
    @media (prefers-color-scheme: dark) { body { background: #fff; } }
  </style></head><body>${BOX}</body></html>`);
  const shots = capture(['--url', url, '--out', dir, '--selector', '#box', '--margin', '10', '--viewport', '800x600']);
  assert.deepEqual(shots.map((s) => [s.theme, groundRed(s.file)]), [['light', 255], ['dark', 0x11]]);
});

test('a root change that is not darker never counts as a dark mode, from the system setting or a toggle', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const lighter = writePage(dir, 'lighter.html', `<!doctype html><html><head><style>
    body { margin: 0; background: #ececec; }
    @media (prefers-color-scheme: dark) { body { background: #fff; } }
  </style></head><body>${BOX}</body></html>`);
  const shots = capture(['--url', lighter, '--out', dir, '--viewport', '800x600']);
  assert.deepEqual(shots.map((s) => s.theme), ['light']);
  const toggle = writePage(dir, 'lighter-toggle.html', `<!doctype html><html><body style="margin:0;background:#ececec">${BOX}<button id="toggle" onclick="document.body.style.background = '#fff'">Theme</button></body></html>`);
  const run = spawnSync(process.execPath, [CAPTURE, '--url', toggle, '--out', dir, '--theme-toggle', '#toggle'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /did not change the page's colours/);
});

test('a prefers-color-scheme rule that changes nothing on the page does not count as a dark mode', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const shots = capture(['--url', writePage(dir, 'inert.html', INERT_DARK_RULE), '--out', dir, '--viewport', '800x600']);
  assert.deepEqual(shots.map((s) => s.theme), ['light']);
  assert.match(shots[0].colorModes.detail, /it has 1 prefers-color-scheme rule, and none changes it/);
});

test('--theme-toggle reaches dark through the app\'s own control, and a saved choice never leaks into a light shot', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const shots = capture(['--url', writePage(dir, 'toggle.html', SAVED_TOGGLE), '--out', dir, '--selector', '#box', '--margin', '10', '--viewport', '800x600', '--viewport', '900x600', '--theme-toggle', '#toggle']);
  assert.deepEqual(shots.map((s) => `${s.viewport}/${s.theme}`), ['800x600/light', '800x600/dark', '900x600/light', '900x600/dark']);
  assert.deepEqual(shots.map((s) => groundRed(s.file)), [255, 0x11, 255, 0x11]);
  assert.equal(shots[0].colorModes.note, "Dark mode: switched with the app's own control, captured light and dark.");
});

test('a --theme-toggle that does not change the page\'s colours fails', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const url = writePage(dir, 'dead-toggle.html', toggleFixture("this.textContent = 'Clicked'"));
  const run = spawnSync(process.execPath, [CAPTURE, '--url', url, '--out', dir, '--theme-toggle', '#toggle'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /--theme-toggle #toggle did not change the page's colours/);
});

test('a selector that matches nothing fails loudly', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const run = spawnSync(process.execPath, [CAPTURE, '--url', join(dir, 'fixture.html'), '--out', dir, '--selector', '#missing', '--theme', 'light'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /--selector "#missing" matched nothing/);
});

// PNG rows as RGB triples, for the guide tests. Chrome writes 8-bit RGB or RGBA with per-row filters.
function pngRows(file) {
  const png = readFileSync(file);
  const width = png.readUInt32BE(16);
  const channels = { 2: 3, 6: 4 }[png[25]];
  const chunks = [];
  for (let at = 8; at < png.length; at += 12 + png.readUInt32BE(at)) {
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + png.readUInt32BE(at)));
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const rows = [];
  let prior = Buffer.alloc(stride);
  for (let y = 0; y * (stride + 1) < raw.length; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = prior[x];
      const upLeft = x >= channels ? prior[x - channels] : 0;
      const p = left + up - upLeft;
      const paeth = Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - upLeft) ? left : Math.abs(p - up) <= Math.abs(p - upLeft) ? up : upLeft;
      line[x] = (line[x] + [0, left, up, (left + up) >> 1, paeth][filter]) & 255;
    }
    rows.push(line);
    prior = line;
  }
  return { width, channels, rows };
}

const GUIDE_BLUE = (rgb) => rgb[0] < 40 && rgb[1] > 140 && rgb[1] < 200 && rgb[2] > 220;

test('--guide draws one device-pixel line at the measured middle, and --scale 4 makes it four times the CSS size', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const [shot] = capture(['--url', join(dir, 'fixture.html'), '--out', dir, '--selector', '#box', '--margin', '10', '--viewport', '800x600', '--theme', 'light', '--scale', '4', '--guide', '#box']);
  assert.deepEqual(pngSize(shot.file), { width: (200 + 20) * 4, height: (120 + 20) * 4 });
  assert.deepEqual(shot.guides, [{ selector: '#box', edge: 'middle', y: 160 }]);
  const { channels, rows } = pngRows(shot.file);
  // Column 2 sits left of the label, inside the margin; the box's middle is 70 CSS px into the crop.
  const blue = rows.flatMap((row, y) => (GUIDE_BLUE(row.subarray(2 * channels, 2 * channels + 3)) ? [y] : []));
  assert.deepEqual(blue, [70 * 4]);
});

test('--guide takes an edge after the last colon, keeps a pseudo-class in the selector, and fails on no match', { skip: NO_CHROME }, () => {
  const dir = workdir();
  const [shot] = capture(['--url', join(dir, 'fixture.html'), '--out', dir, '--selector', '#box', '--viewport', '800x600', '--theme', 'light', '--guide', '#box:bottom', '--guide', 'div:not(#attr)']);
  assert.deepEqual(shot.guides.map((g) => [g.selector, g.edge, g.y]), [['#box', 'bottom', 220], ['div:not(#attr)', 'middle', 160]]);
  const run = spawnSync(process.execPath, [CAPTURE, '--url', join(dir, 'fixture.html'), '--out', dir, '--guide', '#missing:top', '--theme', 'light'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /--guide "#missing" matched nothing/);
  const badScale = spawnSync(process.execPath, [CAPTURE, '--url', join(dir, 'fixture.html'), '--out', dir, '--scale', '3'], { encoding: 'utf8' });
  assert.equal(badScale.status, 1);
  assert.match(badScale.stderr, /--scale must be one of 2, 4/);
});

test('--guide draws above an open modal dialog, which paints over any z-index', { skip: NO_CHROME }, () => {
  const dir = workdir();
  writeFileSync(join(dir, 'modal.html'), `<!doctype html><body style="margin:0"><dialog id="d" style="margin:0; top:100px; left:100px; padding:20px; border:0; background:#eee">
    <div id="field" style="width:200px; height:40px; background:#888"></div></dialog><script>d.showModal()</script></body>`);
  const [shot] = capture(['--url', join(dir, 'modal.html'), '--out', dir, '--selector', '#d', '--margin', '10', '--viewport', '800x600', '--theme', 'light', '--scale', '4', '--guide', '#field']);
  assert.deepEqual(shot.guides, [{ selector: '#field', edge: 'middle', y: 140 }]);
  const { channels, rows } = pngRows(shot.file);
  // Column 30 CSS px in lies inside the dialog's padding; the field's middle is 50 CSS px into the crop.
  const x = 30 * 4 * channels;
  assert.deepEqual(rows.flatMap((row, y) => (GUIDE_BLUE(row.subarray(x, x + 3)) ? [y] : [])), [50 * 4]);
});

test('the card stacks guide rows in one column, Before above After and light above dark', { skip: NO_CHROME }, async () => {
  const dir = workdir();
  const pair = sampleShots(dir);
  const rows = [['Before (light)', pair.light], ['After (light)', pair.light], ['Before (dark)', pair.dark], ['After (dark)', pair.dark]].map(([label, src]) => ({ label, src }));
  fillTemplate(dir, 'card.html', 'card-data', {
    ref: 'example-org/example-app#3', status: 'Draft', title: 'Synthetic alignment fix', summary: 'One line.',
    viewport: '800x600', source: 'synthetic', captured: 'now', guides: [{ label: 'Box on the line', lookFor: 'The box middle on the line.', rows }],
  });
  const browser = await launchBrowser({ warn: () => {} });
  let laid;
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(join(dir, 'card.html')).href, { timeoutMs: 5000, settleMs: 0 });
    laid = await page.eval(() => [...document.querySelectorAll('.guides .guide-row')].map((r) => {
      const box = r.getBoundingClientRect();
      return { label: r.querySelector('.theme').textContent, left: Math.round(box.left), top: Math.round(box.top) };
    }));
  } finally {
    await browser.close();
  }
  assert.deepEqual(laid.map((r) => r.label), rows.map((r) => r.label));
  assert.equal(new Set(laid.map((r) => r.left)).size, 1, 'one column');
  assert.ok(laid.every((r, i) => i === 0 || r.top > laid[i - 1].top), 'each row below the last');
  const [card] = capture(['--url', join(dir, 'card.html'), '--out', dir, '--name', 'card', '--selector', '.card', '--margin', '0', '--theme', 'light', '--viewport', '1300x900']);
  assert.deepEqual(card.brokenImages, []);
  assert.deepEqual(card.pageErrors, []);
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

async function inTemplate(template, blockId, data, probe) {
  const dir = workdir();
  fillTemplate(dir, template, blockId, data);
  const browser = await launchBrowser({ warn: () => {} });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(join(dir, template)).href, { timeoutMs: 5000, settleMs: 0 });
    return await page.eval(probe);
  } finally {
    await browser.close();
  }
}

const inSheet = (data, probe) => inTemplate('sheet.html', 'sheet-data', data, probe);

const LIGHT_ONLY = { modes: ['light'], note: 'Dark mode: not supported, captured light only.' };

test('a light-only sheet draws no dark column and prints the colour-mode note', { skip: NO_CHROME }, async () => {
  const shot = { light: 'shots/none.png' };
  const data = {
    ...sheetData(), colorModes: LIGHT_ONLY, interactive: [],
    beforeAfter: [{ label: 'Box', before: shot, after: shot }],
    zooms: [{ label: 'Box', lookFor: 'The box.', before: shot, after: shot }],
    states: [{ screen: 'Box', items: [{ label: 'Default', source: 'Real server', ...shot }] }],
  };
  const shown = await inSheet(data, () => ({
    notCaptured: [...document.querySelectorAll('.none')].filter((n) => n.textContent === 'Not captured').length,
    darkHeads: [...document.querySelectorAll('.colhead')].filter((h) => /dark/i.test(h.textContent)).length,
    footnote: [...document.querySelectorAll('.footnote')].pop().textContent,
  }));
  assert.deepEqual({ notCaptured: shown.notCaptured, darkHeads: shown.darkHeads }, { notCaptured: 0, darkHeads: 0 });
  assert.match(shown.footnote, / Dark mode: not supported, captured light only\.$/);
});

test('the card footer prints the colour-mode note', { skip: NO_CHROME }, async () => {
  const data = JSON.parse(/<script type="application\/json" id="card-data">([\s\S]*?)<\/script>/.exec(readFileSync(join(SKILL, 'assets', 'card.html'), 'utf8'))[1]);
  const footer = await inTemplate('card.html', 'card-data', { ...data, colorModes: LIGHT_ONLY }, () => document.querySelector('footer').textContent);
  assert.match(footer, /5d6e7f8\. Dark mode: not supported, captured light only\./);
});

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

test('a sheet with no parity or options key, and a colour with no before, still renders to the end', { skip: NO_CHROME }, async () => {
  const { parity, options, ...rest } = sheetData();
  const newColour = { token: '--new', where: 'New badge', theme: 'light', surface: 'page', target: 4.5, after: { text: '#6b6b76', ground: '#fcfcfc' } };
  const seen = await inSheet({ ...rest, colors: [newColour] }, () => ({
    headings: [...document.querySelectorAll('h2')].map((h) => h.textContent),
    row: document.querySelector('table.colors tr:last-child')?.textContent,
  }));
  assert.equal(seen.headings.at(-1), 'Open Questions');
  assert.ok(!seen.headings.includes('Reference Product Parity') && !seen.headings.includes('Options Considered'));
  assert.match(seen.row, /New colour: no before/);
  assert.match(seen.row, /New colour, passes/);
  assert.doesNotMatch(seen.row, /Now passes|Still below/);
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
    const sizes = await page.eval(() => Promise.all([...document.images].map((i) => i.decode().then(() => i))).then((imgs) => imgs.map((i) => [i.closest('.zoom') ? 'zoom' : 'context', i.style.getPropertyValue('--page-width'), i.naturalWidth])));
    for (const [kind, width, natural] of sizes) assert.equal(width, `${kind === 'zoom' ? natural : natural / 2}px`, kind);
    const looks = await page.eval(() => [...document.querySelectorAll('.look b')].length);
    assert.equal(looks, 2);
  } finally {
    await browser.close();
  }
});

test('clicking a shot opens that same image larger over the page, and a click anywhere closes it', { skip: NO_CHROME }, async () => {
  const dir = workdir();
  const pair = sampleShots(dir);
  fillTemplate(dir, 'sheet.html', 'sheet-data', { ...sheetData(), zooms: [], beforeAfter: [{ label: 'Box', lookFor: 'The box.', before: pair, after: pair }], states: [] });
  const browser = await launchBrowser({ warn: () => {} });
  try {
    const page = await browser.newPage({ width: 1280, height: 800 });
    await page.goto(pathToFileURL(join(dir, 'sheet.html')).href, { timeoutMs: 5000, settleMs: 300 });
    const result = await page.eval(async () => {
      // A fragment link navigates in a task after the click, not during it.
      const arrive = (hash) => new Promise((done) => {
        const poll = () => (location.hash === hash ? done() : setTimeout(poll, 10));
        poll();
      });
      const figure = document.querySelector('figure');
      const img = figure.querySelector('img');
      const onPage = img.getBoundingClientRect().width;
      figure.querySelector('.open').click();
      await arrive(`#${figure.id}`);
      const opened = { position: getComputedStyle(figure).position, width: img.getBoundingClientRect().width, onPage };
      document.elementFromPoint(2, 798).click();
      await arrive('#shot-closed');
      return { ...opened, closed: getComputedStyle(figure).position };
    });
    assert.equal(result.position, 'fixed');
    assert.ok(result.width > result.onPage, `opened at ${result.width}px, on the page ${result.onPage}px`);
    assert.equal(result.closed, 'static');
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
