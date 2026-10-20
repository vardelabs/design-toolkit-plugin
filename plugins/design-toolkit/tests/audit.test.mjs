import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from '../skills/design-spec/scripts/lib/cdp.mjs';
import { launchBrowser } from '../skills/design-spec/scripts/lib/launch-browser.mjs';
import { order } from '../skills/design-audit/scripts/audit.mjs';
import { AREAS } from '../skills/design-audit/scripts/lib/lint-rules.mjs';
import { lint } from '../skills/design-audit/scripts/lint.mjs';

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');
const AUDIT = join(SKILLS, 'design-audit', 'scripts', 'audit.mjs');
const NO_CHROME = findChrome() ? false : 'no Chrome, Edge, or Chromium installed';

// One planted tell per line, named by the rule that should find it.
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title><link rel="stylesheet" href="app.css"></head>
<body>
  <h1 class="hero">Unleash your workflow</h1>
  <p class="pale">Pale words nobody can read</p>
  <p>Lorem ipsum dolor sit amet, placeholder copy.</p>
  <a class="btn" href="#">Learn more</a>
  <span class="icon">\u{1F680}</span>
  <div class="wide">A row wider than the window</div>
  <script src="app.js"></script>
  <script>notDefinedAnywhere();</script>
</body></html>`;
const CSS = `body { margin: 0; font: 16px system-ui, sans-serif; color: #111; background: #fff; }
.hero { background: linear-gradient(90deg, #6366f1, #a855f7); background-clip: text; color: transparent; }
.pale { color: #e4e4e4; }
.btn { transition: all 0.3s; }
.toast { position: fixed; z-index: 99999; }
.wide { width: 1600px; }
.panel { border-top: 1px solid #ddd; }
.kept { z-index: 10000; } /* design-audit-ignore: the system toast layer */
.thinking-label {
  background: linear-gradient(90deg, #888, #111, #888);
  background-clip: text;
  color: transparent;
}
`;
const JS = `document.querySelector('.btn').addEventListener('click', () => window.alert('Oops! Something went wrong'));
const robust = (leverage) => leverage;
`;
const PLANTED_SOURCE = ['copy', 'lorem', 'cta-copy', 'dead-link', 'emoji', 'gradient-text', 'purple', 'transition-all', 'z-index', 'alert', 'oops-copy'];
const PLANTED_MEASURED = ['overflow', 'contrast', 'page-error'];

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'design-audit-test-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'index.html'), PAGE);
  writeFileSync(join(dir, 'src', 'app.css'), CSS);
  writeFileSync(join(dir, 'src', 'app.js'), JS);
  return dir;
}

const ids = (findings) => [...new Set(findings.map((f) => f.id))].sort();

test('app mode finds every planted source tell and none of the marketing house rules', () => {
  const { findings } = lint([join(fixture(), 'src')]);
  assert.deepEqual(ids(findings), [...PLANTED_SOURCE].sort());
  assert.ok(findings.every((f) => /^src\/(index\.html|app\.css|app\.js)$/.test(f.file)), JSON.stringify(findings.map((f) => f.file)));
});

test('a folder or file whose name holds "lock" is still scanned', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'design-audit-test-')), 'blocks');
  mkdirSync(dir);
  writeFileSync(join(dir, 'Clock.html'), '<p>Lorem ipsum</p>');
  writeFileSync(join(dir, 'app.min.css'), '.x { color: #6366f1 }');
  const report = lint([dir]);
  assert.equal(report.files, 1);
  assert.deepEqual(report.findings.map((f) => `${f.file} ${f.id}`), ['blocks/Clock.html lorem']);
});

test('in script, copy is read from strings, not from identifiers', () => {
  const copy = lint([join(fixture(), 'src')]).findings.filter((f) => f.id === 'copy');
  assert.deepEqual(copy.map((f) => f.file), ['src/index.html']);
});

test('two roots with the same folder name are told apart by their path', () => {
  const base = mkdtempSync(join(tmpdir(), 'design-audit-test-'));
  for (const side of ['a', 'b']) {
    mkdirSync(join(base, side, 'src'), { recursive: true });
    writeFileSync(join(base, side, 'src', 'page.html'), '<p>Lorem ipsum</p>');
  }
  const files = lint([join(base, 'a', 'src'), join(base, 'b', 'src')]).findings.map((f) => f.file);
  assert.equal(new Set(files).size, 2, JSON.stringify(files));
  assert.ok(files.every((f) => /(^|\/)(a|b)\/src\/page\.html$/.test(f)), JSON.stringify(files));
});

test('site mode adds the house rules, such as gradient fills and hairlines, and drops the app-only rules', () => {
  const found = ids(lint([join(fixture(), 'src')], { mode: 'site' }).findings);
  for (const id of ['gradient', 'hairline']) assert.ok(found.includes(id), id);
  for (const id of ['alert', 'z-index', 'dead-link', 'oops-copy']) assert.ok(!found.includes(id), id);
});

test('a line marked design-audit-ignore is kept, and a loading shimmer is not gradient text', () => {
  const zIndex = lint([join(fixture(), 'src')]).findings.filter((f) => f.id === 'z-index');
  assert.deepEqual(zIndex.map((f) => f.line), [5]);
  const clipped = lint([join(fixture(), 'src')]).findings.filter((f) => f.id === 'gradient-text');
  assert.deepEqual(clipped.map((f) => f.line), [2]);
});

test('order puts findings in the fix order, FAIL before WARN within an area', () => {
  const f = (area, level) => ({ area, level });
  const sorted = order([f('motion', 'WARN'), f('colour', 'WARN'), f('idea', 'WARN'), f('colour', 'FAIL')]);
  assert.deepEqual(sorted.map((x) => `${x.area}:${x.level}`), ['idea:WARN', 'colour:FAIL', 'colour:WARN', 'motion:WARN']);
});

test('the audit names every planted tell, a shot or a file and line for each, in fix order, and renders as a one-theme card', { skip: NO_CHROME }, async () => {
  const dir = fixture();
  // No --out: the audit writes to a fresh temp folder, never the cwd, and prints where.
  const { out } = JSON.parse(execFileSync(process.execPath, [AUDIT, '--url', join(dir, 'src', 'index.html'), '--src', join(dir, 'src'), '--viewport', 'desktop', '--theme', 'light'], { cwd: dir, encoding: 'utf8' }));
  assert.ok(out.startsWith(tmpdir()) && !existsSync(join(dir, '.design-audit')), out);
  const audit = JSON.parse(readFileSync(join(out, 'audit.json'), 'utf8'));
  assert.deepEqual(ids(audit.findings), [...PLANTED_SOURCE, ...PLANTED_MEASURED].sort());
  for (const f of audit.findings.filter((x) => x.source === 'measured')) assert.ok(f.shots.length && f.shots.every((s) => existsSync(join(out, s))), `${f.id} names no shot on disk`);
  for (const f of audit.findings.filter((x) => x.source === 'source')) assert.ok(f.places.length && f.places.every((p) => /^src\/[\w.]+:\d+ /.test(p)), `${f.id} names no file and line`);
  assert.deepEqual(audit.scan, { files: 3, skipped: [] });
  const ranks = audit.findings.map((f) => AREAS.indexOf(f.area));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));

  const card = JSON.parse(readFileSync(join(out, 'card.json'), 'utf8'));
  execFileSync(process.execPath, [join(SKILLS, 'design-spec', 'scripts', 'fill.mjs'), join(SKILLS, 'design-spec', 'assets', 'card.html'), join(out, 'card.json'), join(out, 'card.html')], { stdio: 'pipe' });
  const browser = await launchBrowser({ warn: () => {} });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(join(out, 'card.html')).href, { timeoutMs: 5000, settleMs: 300 });
    const shown = await page.eval(() => ({ rows: document.querySelectorAll('.finding').length, broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).length }));
    assert.deepEqual(shown, { rows: card.findings.length, broken: 0 });
  } finally {
    await browser.close();
  }
});
