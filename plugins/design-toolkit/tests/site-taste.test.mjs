import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../skills/design-spec/scripts/lib/cdp.mjs';
import { hostRestrictsUserNamespaces } from '../skills/design-spec/scripts/lib/launch-browser.mjs';
import { findPlaywrightChromium } from '../skills/design-spec/scripts/lib/playwright-chromium.mjs';

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = join(PLUGIN, 'skills', 'site-taste');
const LANDING = join(PLUGIN, 'tests', 'fixtures', 'site-taste-landing', 'index.html');
const BROWSER = findChrome() || findPlaywrightChromium();
const NO_CHROME = BROWSER ? false : 'no Chrome, Edge, or Chromium installed';

// The vendored inspector launches Chrome with upstream's flags only, so on a host that blocks the sandbox the test hands it a wrapper.
function browserForInspector() {
  if (!hostRestrictsUserNamespaces()) return BROWSER;
  const wrapper = join(mkdtempSync(join(tmpdir(), 'site-taste-chrome-')), 'chrome');
  writeFileSync(wrapper, `#!/bin/sh\nexec '${BROWSER.replaceAll("'", "'\\''")}' --no-sandbox "$@"\n`);
  chmodSync(wrapper, 0o755);
  return wrapper;
}

test('site-taste shares design-spec\'s cdp.mjs byte for byte', () => {
  const shared = readFileSync(join(PLUGIN, 'skills', 'design-spec', 'scripts', 'lib', 'cdp.mjs'));
  const vendored = readFileSync(join(SKILL, 'scripts', 'lib', 'cdp.mjs'));
  assert.ok(shared.equals(vendored), 'the two cdp.mjs copies differ; re-sync both to the same upstream pin');
});

test('the synthetic landing page passes the site-taste linter', () => {
  const run = spawnSync(process.execPath, [join(SKILL, 'scripts', 'lint.mjs'), LANDING], { encoding: 'utf8' });
  assert.match(run.stdout, /RESULT: 0 FAIL/, run.stdout + run.stderr);
});

test('the synthetic landing page passes the site-taste inspector with 0 FAIL', { skip: NO_CHROME, timeout: 240_000 }, () => {
  const out = mkdtempSync(join(tmpdir(), 'site-taste-inspect-'));
  const run = spawnSync(process.execPath, [join(SKILL, 'scripts', 'inspect.mjs'), LANDING, '--out', out, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, CHROME_PATH: browserForInspector() },
  });
  const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
  const fails = report.findings.filter((finding) => finding.level === 'FAIL');
  assert.deepEqual(fails.map((finding) => `${finding.id} @${finding.width}px`), [], run.stderr);
  assert.equal(run.status, 0, run.stderr);
});
