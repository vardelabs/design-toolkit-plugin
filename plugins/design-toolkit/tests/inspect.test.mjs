import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../skills/design-spec/scripts/lib/cdp.mjs';
import { RULE_IDS, merge } from '../skills/ui-inspect/scripts/lib/rules.mjs';

const INSPECT = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'ui-inspect', 'scripts', 'inspect.mjs');
const NO_CHROME = findChrome() ? false : 'no Chrome, Edge, or Chromium installed';
const LONG = 'Synthetic running text for the fixture page that keeps going well past one short line of copy. '.repeat(3);

// Each block trips one rule; the ids in the comments are the rules the test expects to fire.
const BROKEN = `<!doctype html><html><head><style>
  @font-face { font-family: Ghost; src: url(missing-font.woff2); }
  body { margin: 0; background: #fff; color: #111; font: 16px sans-serif; }
  .row { margin: 8px; }
</style></head><body>
  <div style="width: 1500px; height: 4px"></div>                                          <!-- overflow -->
  <img src="missing.png" width="40" height="40" alt="">                                    <!-- broken-image -->
  <div class="row" style="position: relative">
    <p style="margin: 0">Covered paragraph text sits here</p>
    <div style="position: absolute; inset: 0 auto 0 0; width: 400px; background: #222"></div> <!-- covered-text -->
  </div>
  <div class="row" style="width: 80px; overflow: hidden; white-space: nowrap">A long label that cannot fit</div> <!-- clipped-text -->
  <p class="row" style="color: #e4e4e4">Pale words on white</p>                             <!-- contrast -->
  <p class="row" style="font-family: serif">Serif words for the count</p>                    <!-- font-count -->
  <p class="row" style="font-family: monospace">Monospace words for the count</p>
  <p class="row" style="font-family: cursive">Cursive words for the count</p>
  <p class="row" style="font-family: Ghost, sans-serif">Words set in a face that never loads</p> <!-- font-fallback -->
  <p class="row" style="font-size: 10px">3</p>                                      <!-- small-text -->
  <p class="row">${[13, 14, 15, 17, 18, 19, 20, 21, 22].map((s) => `<span style="font-size:${s}px">Size</span>`).join(' ')}</p> <!-- size-count -->
  <p class="row" style="width: 1100px">${LONG}</p>                                           <!-- measure -->
  <div class="row" style="width: 300px; height: 60px; overflow-x: auto"><div style="width: 2000px; height: 50px">Wide row</div></div> <!-- side-scroll -->
  <div class="row" style="display: flex; align-items: flex-start; line-height: 28px"><svg width="12" height="12"><rect width="100%" height="100%"/></svg><span>Icon at the top</span></div> <!-- optical-align -->
</body></html>`;

const CLEAN = `<!doctype html><html><head><style>
  body { margin: 0; background: #fff; color: #111; font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 65ch; padding: 24px 16px; }
  h1 { font-size: 24px; } .note { color: #555; font-size: 14px; }
  button { font: inherit; padding: 8px 16px; background: #1d4ed8; color: #fff; border: 0; }
  @media (prefers-color-scheme: dark) { body { background: #111; color: #eee; } .note { color: #aaa; } }
  body { padding-bottom: 140px; }
</style></head><body><main>
  <h1>Project settings</h1>
  <p>${LONG}</p>
  <p class="note">Changes save when you leave the field.</p>
  <button>Save</button>
  <p style="margin-bottom: 900px">Text the composer bar scrolls over</p>
  <div style="position: fixed; left: 0; right: 0; bottom: 0; height: 120px; background: #ddd; color: #111">Composer</div>
  <p><button disabled style="background: #eee; color: #ccc">Archive</button></p>
  <p style="width: 120px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis">A long label truncated on purpose</p>
  <div style="position: relative">
    <p>Text under an open menu</p>
    <ul role="menu" style="position: absolute; top: 0; left: 0; margin: 0; padding: 8px; list-style: none; background: #fff; color: #111"><li>Rename</li></ul>
  </div>
</main>
  <div style="position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); opacity: 0; pointer-events: none"></div>
  <div style="position: relative">
    <p style="margin: 0; padding: 7px">Row under a fade</p>
    <div style="position: absolute; inset: 0; background: linear-gradient(transparent, #fff); pointer-events: none"></div>
  </div>
  <div style="height: 290px; overflow: hidden; display: flex; flex-direction: column">
    <div style="flex: 1; overflow-y: auto">${Array.from({ length: 30 }, (_, i) => `<p style="margin: 0; padding: 7px; font-size: 20px">Message row ${i + 1} in a scrolling pane</p>`).join('')}</div>
  </div>
</body></html>`;

// A fixed header that hides the first heading at load, and a panel painted in oklch(): both cover text for good.
const COVERED = `<!doctype html><html><head><style>
  body { margin: 0; background: #fff; color: #111; font: 16px system-ui, sans-serif; }
</style></head><body>
  <header style="position: fixed; top: 0; left: 0; right: 0; height: 60px; background: #ddd"></header>
  <h1 style="margin: 10px 16px; font-size: 24px">Heading under the header</h1>
  <div style="position: relative; margin: 80px 16px">
    <p>Paragraph under an oklch panel</p>
    <div style="position: absolute; inset: 0; background: oklch(0.3 0.02 250)"></div>
  </div>
</body></html>`;

// Readable in light; dark grey on black in dark, so only the dark runs may report it.
const DARK_ONLY = `<!doctype html><html><head><style>
  body { margin: 0; background: #fff; color: #111; font: 16px system-ui, sans-serif; }
  @media (prefers-color-scheme: dark) { body { background: #000; color: #222; } }
</style></head><body><p>Readable only in the light theme</p></body></html>`;

// Boxes that hide one axis only: CSS computes the other axis to auto, which must not stop the walk.
const ONE_AXIS = `<!doctype html><html><head><style>
  body { margin: 0; background: #fff; color: #111; font: 16px system-ui, sans-serif; }
</style></head><body>
  <div style="margin: 16px; width: 80px; overflow-x: hidden; white-space: nowrap">Cut on the right side</div>
  <div style="margin: 16px; width: 300px; height: 20px; overflow-x: auto; overflow-y: hidden"><p style="margin: 14px 0 0">Cut along the bottom</p></div>
  <div style="margin: 16px; width: 200px; height: 20px; overflow: hidden; text-overflow: ellipsis">Wrapping words under an ellipsis box that cuts its lower lines</div>
  <div style="margin: 16px; width: 300px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis"><span style="display: inline-block; width: 60px; overflow: hidden; vertical-align: top">Inner box cut</span></div>
</body></html>`;

// Seven unreadable items and one faint one: more than a message quotes, so no cap may drop the faint one.
const BOTH_CONTRASTS = `<!doctype html><html><head><style>
  body { margin: 0; background: #fff; font: 16px system-ui, sans-serif; }
</style></head><body>${Array.from({ length: 7 }, (_, i) => `<p style="color: #e4e4e4">Unreadable words ${i + 1}</p>`).join('')}<p style="color: #888">Faint words</p></body></html>`;

// A page longer than the screens read, ending in text that a fixed bottom bar hides for good.
const LONG_PAGE = `<!doctype html><html><head><style>
  body { margin: 0; background: #fff; color: #111; font: 16px system-ui, sans-serif; }
</style></head><body><div style="height: 4000px"></div><p style="margin: 0 16px 20px">The last line on the page</p>
  <div style="position: fixed; left: 0; right: 0; bottom: 0; height: 80px; background: #ddd"></div></body></html>`;

// A full-height side nav over the first heading: scrolling never moves it off the text.
const SIDE_NAV = `<!doctype html><html><head><style>
  body { margin: 0; background: #fff; color: #111; font: 16px system-ui, sans-serif; }
</style></head><body><h1 style="margin: 16px">Heading under the side nav</h1><div style="height: 3000px"></div>
  <nav style="position: fixed; top: 0; bottom: 0; left: 0; width: 500px; background: #ddd"></nav></body></html>`;

// A chat pane resting at its bottom under a sticky day header, in a window that does not scroll.
const PANE = `<!doctype html><html><head><style>
  body { margin: 0; background: #fff; color: #111; font: 16px system-ui, sans-serif; }
</style></head><body>
  <div id="thread" style="height: 300px; overflow-y: auto">
    <div style="position: sticky; top: 0; background: #eee; color: #111; padding: 4px">Today</div>
    ${Array.from({ length: 40 }, (_, i) => `<p style="margin: 0; padding: 4px">Message ${i + 1} in the thread</p>`).join('')}
  </div>
  <script>document.getElementById('thread').scrollTop = 1e6</script>
</body></html>`;

// A box exactly one line tall hides its later lines whole; a paragraph sits below where they would be.
const WHOLE_LINES = `<!doctype html><html><head><style>
  body { margin: 0; background: #fff; color: #111; font: 16px system-ui, sans-serif; }
</style></head><body>
  <div style="margin: 16px 16px 0; width: 200px; height: 24px; line-height: 24px; overflow: hidden">Lines in a box one line tall that hides its second and third lines entirely</div>
  <p style="margin: 0 16px; width: 200px; line-height: 24px">A paragraph right below the box that wraps onto its second line</p>
</body></html>`;

// An ellipsis box inside a card that also hides overflow: the long name's range keeps its untruncated
// width, but the ellipsis ends the visible text inside the card. A line clamp whose hidden lines hold a
// long unbreakable path: those lines run past the side, but none of them is on screen.
const NESTED_ELLIPSIS = `<!doctype html><html><head><style>
  body { font: 13px system-ui, sans-serif; background: #fff; color: #030305; margin: 24px; }
  .card { width: 200px; padding: 8px; overflow: hidden; background: #fafaf9; border: 1px solid #ddd; }
  .name { display: block; width: 144px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style></head><body>
  <div class="card"><span class="name">Short file name.txt</span></div>
  <div class="card"><span class="name">Household allocation targets and drift since the last rebalance.csv</span></div>
  <div style="width: 104px; display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2">The copy failed: [Errno 2] No such file or directory: '/opt/app/very/long/path/to/plugins'</div>
</body></html>`;

// A translucent tint over the page, and translucent text: each is measured as the colour a person sees.
const TRANSLUCENT = `<!doctype html><html><head><style>
  body { font: 14px system-ui, sans-serif; background: #fafaf9; color: #030305; margin: 24px; }
  .tile { display: inline-grid; place-items: center; width: 40px; height: 36px; background: rgba(217, 119, 6, 0.1); color: #d97706; font-weight: 700; }
  .ghost { color: rgba(0, 0, 0, 0.3); }
</style></head><body><span class="tile">TXT</span><p class="ghost">Translucent words</p></body></html>`;

// A pane that hides only x (y computes to auto, so it scrolls): a long address on a line below its
// edge can be scrolled into view, and its side cut is real.
const SCROLL_Y_PANE = `<!doctype html><html><head><style>
  body { margin: 0; background: #fff; color: #111; font: 16px system-ui, sans-serif; }
</style></head><body>
  <div style="margin: 16px; width: 120px; height: 60px; overflow-x: hidden"><p style="margin: 0; line-height: 20px">Some words on the first lines here then https://example.test/a/very/long/unbroken/address/path</p></div>
</body></html>`;

// Each icon is placed by an oracle the rule does not share: the baseline from an empty inline-block at
// the text's baseline, and the glyph height from the ink of a 10x glyph drawn to a canvas. The rows sit
// below the first screen, so the rule must scroll to read them, and the page's CSP allows no data: images.
const ALIGN = `<!doctype html><html><head>
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
  <style>
  body { margin: 0; background: #fff; color: #111; font: 15px/24px system-ui, sans-serif; }
  .row { margin: 16px; gap: 8px; align-items: start; }
  svg { position: relative; }
</style></head><body>
  <div style="height: 2500px"></div>
  <div class="row centred" style="display: flex"><svg width="14" height="14" data-glyph="H" data-shift="0"><rect width="100%" height="100%"/></svg><span>Header centred</span></div>
  <div class="row notice" style="display: grid; grid-template-columns: auto 1fr"><span class="glyph"><svg width="14" height="14" data-glyph="H" data-shift="1.25"><rect width="100%" height="100%"/></svg></span><span>Notice one quarter low</span></div>
  <button class="row group-toggle" style="display: flex; font: inherit; border: 0; background: none; color: inherit; padding: 0"><svg class="caret" width="10" height="10" data-glyph="x" data-shift="0"><rect width="100%" height="100%"/></svg><span>Workspace</span></button>
  <div class="row badge" style="display: flex; position: relative"><span style="width: 14px"><svg width="14" height="14" style="position: absolute; top: 9px"><rect width="100%" height="100%"/></svg></span><span>Badge laid over its row</span></div>
  <div class="row zero" style="display: flex; font-size: 0"><svg width="14" height="14"><rect width="100%" height="100%"/></svg>Delete</div>
  <script>
    const inkHeight = (font, glyph) => {
      const c = document.createElement('canvas'); c.width = 400; c.height = 400;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.font = font; g.fillText(glyph, 50, 300);
      const ink = g.getImageData(0, 0, 400, 400).data;
      for (let y = 0; y < 300; y++) for (let x = 0; x < 400; x++) if (ink[(y * 400 + x) * 4 + 3] > 127) return (300 - y) / 10;
    };
    for (const icon of document.querySelectorAll('svg[data-glyph]')) {
      const text = icon.closest('.row').querySelector(':scope > span:not(.glyph)');
      const cs = getComputedStyle(text);
      const marker = text.appendChild(document.createElement('i'));
      marker.style.display = 'inline-block';
      const baseline = marker.getBoundingClientRect().bottom;
      const glyph = inkHeight(\`\${cs.fontWeight} \${parseFloat(cs.fontSize) * 10}px \${cs.fontFamily}\`, icon.dataset.glyph);
      const box = icon.getBoundingClientRect();
      icon.style.top = (baseline - glyph / 2 + Number(icon.dataset.shift) - (box.top + box.height / 2)) + 'px';
    }
  </script>
</body></html>`;

function page(html) {
  const dir = mkdtempSync(join(tmpdir(), 'ui-inspect-test-'));
  writeFileSync(join(dir, 'page.html'), html);
  return join(dir, 'page.html');
}

function inspect(file, ...args) {
  const run = spawnSync(process.execPath, [INSPECT, '--url', file, '--json', ...args], { encoding: 'utf8' });
  assert.notEqual(run.status, 2, run.stderr);
  return { status: run.status, report: JSON.parse(run.stdout) };
}

test('every kept rule fires on the broken fixture, and a FAIL exits 1', { skip: NO_CHROME }, () => {
  const { status, report } = inspect(page(BROKEN), '--viewport', 'desktop', '--theme', 'light');
  assert.equal(status, 1);
  assert.deepEqual([...new Set(report.findings.map((f) => f.id))].sort(), [...RULE_IDS].sort());
});

test('a clean screen stays quiet at both viewports and both themes', { skip: NO_CHROME }, () => {
  const { status, report } = inspect(page(CLEAN));
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.ran, ['desktop/light', 'desktop/dark', 'narrow/light', 'narrow/dark']);
  assert.equal(status, 0);
});

test('a finding names only the viewports and themes it appeared at', { skip: NO_CHROME }, () => {
  const { report } = inspect(page(DARK_ONLY));
  assert.deepEqual(report.findings.map((f) => [f.id, f.where]), [['contrast', ['desktop/dark', 'narrow/dark']]]);
});

test('a top bar over text at load and an oklch() panel both count as covering', { skip: NO_CHROME }, () => {
  const { report } = inspect(page(COVERED), '--viewport', 'desktop', '--theme', 'light');
  const covered = report.findings.filter((f) => f.id === 'covered-text').map((f) => f.message).join(' ');
  assert.match(covered, /Heading under the header/);
  assert.match(covered, /Paragraph under an oklch panel/);
});

test('a box that hides one axis cuts text on that axis, and an ellipsis excuses only its own side cut', { skip: NO_CHROME }, () => {
  const { report } = inspect(page(ONE_AXIS), '--viewport', 'desktop', '--theme', 'light');
  const clipped = report.findings.filter((f) => f.id === 'clipped-text').map((f) => f.message).join(' ');
  assert.match(clipped, /Cut on the right side/);
  assert.match(clipped, /Cut along the bottom/);
  assert.match(clipped, /Wrapping words under an ellipsis box/);
  assert.match(clipped, /Inner box cut/);
});

test('lines a box hides whole are cut text, never covered text', { skip: NO_CHROME }, () => {
  const { report } = inspect(page(WHOLE_LINES), '--viewport', 'desktop', '--theme', 'light');
  assert.deepEqual(report.findings.map((f) => f.id), ['clipped-text']);
  assert.match(report.findings[0].message, /Lines in a box one line tall/);
});

test('an ellipsis inside a clipping card, and a long word on the hidden lines of a clamp, are not cut text', { skip: NO_CHROME }, () => {
  const { report } = inspect(page(NESTED_ELLIPSIS), '--viewport', 'desktop', '--theme', 'light');
  assert.deepEqual(report.findings, []);
});

test('a translucent tint and translucent text are measured as composited', { skip: NO_CHROME }, () => {
  const { report } = inspect(page(TRANSLUCENT), '--viewport', 'desktop', '--theme', 'light');
  const fail = report.findings.find((f) => f.id === 'contrast' && f.level === 'FAIL');
  const ratio = (text) => Number(new RegExp(`"${text}" \\([^)]*\\) ([\\d.]+):1`).exec(fail?.message ?? '')?.[1]);
  assert.ok(ratio('TXT') < 3, fail?.message);
  assert.ok(ratio('Translucent words') < 3, fail?.message);
});

test('a finding names each element, and its selector works with --ignore', { skip: NO_CHROME }, () => {
  const file = page(COVERED);
  const { report } = inspect(file, '--viewport', 'desktop', '--theme', 'light');
  const covered = report.findings.find((f) => f.id === 'covered-text');
  assert.match(covered.message, /"Heading under the header" \(h1\)/);
  assert.ok(covered.selectors.includes('h1'), JSON.stringify(covered.selectors));
  const after = inspect(file, '--viewport', 'desktop', '--theme', 'light', '--ignore', covered.selectors.find((sel) => sel === 'h1')).report;
  assert.doesNotMatch(after.findings.map((f) => f.message).join(' '), /Heading under the header/);
});

test('a side cut below the edge of a box that scrolls on y still counts', { skip: NO_CHROME }, () => {
  const { report } = inspect(page(SCROLL_Y_PANE), '--viewport', 'desktop', '--theme', 'light');
  assert.match(report.findings.find((f) => f.id === 'clipped-text')?.message ?? '', /Some words on the first lines/);
});

test('an unreadable item does not hide a faint one: contrast reports both levels', { skip: NO_CHROME }, () => {
  const { report } = inspect(page(BOTH_CONTRASTS), '--viewport', 'desktop', '--theme', 'light');
  const contrast = report.findings.filter((f) => f.id === 'contrast');
  assert.deepEqual(contrast.map((f) => f.level), ['FAIL', 'WARN']);
  assert.match(contrast[0].message, /and 3 more$/);
});

test('a full-height side nav over text counts as covering it on a page that scrolls', { skip: NO_CHROME }, () => {
  const { report } = inspect(page(SIDE_NAV), '--viewport', 'desktop', '--theme', 'light');
  assert.match(report.findings.find((f) => f.id === 'covered-text')?.message ?? '', /Heading under the side nav/);
});

test('a sticky header in a scrolled pane is judged by the pane, not the window', { skip: NO_CHROME }, () => {
  const { report } = inspect(page(PANE), '--viewport', 'desktop', '--theme', 'light');
  assert.deepEqual(report.findings, []);
});

test('the page end is read past the --screens cap', { skip: NO_CHROME }, () => {
  const { report } = inspect(page(LONG_PAGE), '--viewport', 'desktop', '--theme', 'light', '--screens', '1');
  assert.match(report.findings.find((f) => f.id === 'covered-text')?.message ?? '', /The last line on the page/);
});

test('optical-align fails only the wrapped icon 1.25px low, and the excepted caret passes on the x-height', { skip: NO_CHROME }, () => {
  const file = page(ALIGN);
  const config = join(dirname(file), '.design-toolkit.json');
  writeFileSync(config, JSON.stringify({ 'optical-align': { exceptions: [{ selector: '.group-toggle .caret', centre: 'x-height' }] } }));
  const run = spawnSync(process.execPath, [INSPECT, '--url', file, '--json'], { encoding: 'utf8', cwd: dirname(file) });
  const report = JSON.parse(run.stdout);
  assert.equal(run.status, 1, run.stderr);
  assert.equal(report.config, realpathSync(config));
  const align = report.findings.filter((f) => f.id === 'optical-align');
  assert.deepEqual(align.map((f) => [f.level, f.selectors, f.where.length]), [['FAIL', ['div.row.notice > span.glyph'], 4]]);
  const gap = Number(/"Notice one quarter low" \(div\.row\.notice > span\.glyph\) ([\d.]+)px low against the cap height/.exec(align[0].message)?.[1]);
  // The oracle and the ink each snap to the 2x device grid, which differs by host font: one device pixel.
  assert.ok(Math.abs(gap - 1.25) <= 0.5, align[0].message);
  assert.ok(align[0].fix);
});

test('without its exception, a caret centred on the x-height fails against the cap height', { skip: NO_CHROME }, () => {
  const file = page(ALIGN);
  writeFileSync(join(dirname(file), 'empty.json'), '{}');
  const { report } = inspect(file, '--viewport', 'desktop', '--theme', 'light', '--config', join(dirname(file), 'empty.json'));
  assert.match(report.findings.find((f) => f.id === 'optical-align').message, /"Workspace" \(button\.row\.group-toggle > svg\.caret\) [\d.]+px low against the cap height/);
});

test('a config that is not valid JSON, or whose exceptions are wrong, is a usage error naming the file', () => {
  const file = page(CLEAN);
  const config = join(dirname(file), '.design-toolkit.json');
  const bad = ['{"optical-align": ', { 'optical-align': { exceptions: { selector: '.caret', centre: 'x-height' } } }, { 'optical-align': { exceptions: [{ selector: '.caret', centre: 'middle' }] } }];
  for (const content of bad) {
    writeFileSync(config, typeof content === 'string' ? content : JSON.stringify(content));
    const run = spawnSync(process.execPath, [INSPECT, '--url', file], { encoding: 'utf8', cwd: dirname(file) });
    assert.equal(run.status, 2, run.stderr);
    assert.ok(run.stderr.includes(`inspect: ${realpathSync(config)}: `), run.stderr);
  }
});

test('a count option that is not a whole number is a usage error', () => {
  const run = spawnSync(process.execPath, [INSPECT, '--url', page(CLEAN), '--screens', 'abc'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /--screens "abc": use a whole number/);
});

test('--allow drops a rule', { skip: NO_CHROME }, () => {
  const { status, report } = inspect(page(DARK_ONLY), '--allow', 'contrast');
  assert.deepEqual(report.findings, []);
  assert.equal(status, 0);
});

test('--ignore leaves one element out and names it in the report', { skip: NO_CHROME }, () => {
  const file = page(COVERED);
  const all = inspect(file, '--viewport', 'desktop', '--theme', 'light').report;
  const some = inspect(file, '--viewport', 'desktop', '--theme', 'light', '--ignore', 'h1').report;
  const covered = (r) => r.findings.filter((f) => f.id === 'covered-text').map((f) => f.message).join(' ');
  assert.match(covered(all), /Heading under the header/);
  assert.doesNotMatch(covered(some), /Heading under the header/);
  assert.match(covered(some), /Paragraph under an oklch panel/);
  assert.deepEqual(some.ignore, ['h1']);
});

// Options are checked before a browser launches, so these run on any host.
test('an unknown rule id is a usage error', () => {
  const bad = spawnSync(process.execPath, [INSPECT, '--url', page(DARK_ONLY), '--allow', 'no-such-rule'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /no-such-rule: not a rule id/);
});

test('merge keeps one finding per rule, level, and message, FAIL first', () => {
  const f = (level, id, where) => ({ level, id, where, message: '', fix: '' });
  const merged = merge([f('WARN', 'measure', 'desktop/light'), f('FAIL', 'overflow', 'narrow/light'), f('FAIL', 'overflow', 'narrow/dark'), f('FAIL', 'overflow', 'narrow/dark')]);
  assert.deepEqual(merged.map((m) => [m.level, m.id, m.where]), [['FAIL', 'overflow', ['narrow/light', 'narrow/dark']], ['WARN', 'measure', ['desktop/light']]]);
});

test('merge keeps a finding whose message differs as its own entry', () => {
  const f = (message, where) => ({ level: 'FAIL', id: 'clipped-text', where, message, fix: '' });
  const merged = merge([f('"Label A"', 'desktop/light'), f('"Label B"', 'narrow/light')]);
  assert.deepEqual(merged.map((m) => [m.message, m.where]), [['"Label A"', ['desktop/light']], ['"Label B"', ['narrow/light']]]);
});
