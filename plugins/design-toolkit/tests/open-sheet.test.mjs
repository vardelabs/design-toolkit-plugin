import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'design-spec', 'scripts');
const URL = 'https://claude.ai/artifact/example';
// The public copy of this plugin leaves the arc add-on out; its tests then have nothing to test.
const NO_ARC = existsSync(join(SCRIPTS, 'lib', 'arc.sh')) ? false : 'no lib/arc.sh in this copy';

// Stand-ins for the commands the script hands the link to. Each logs its arguments, so a test reads what
// would have opened without opening anything on the machine running it.
function stubs({ system = 'Darwin', arcRunning = false, arcWorks = true, openWorks = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'open-sheet-test-'));
  const log = join(dir, 'calls.log');
  const stub = (name, body) => {
    writeFileSync(join(dir, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  };
  stub('uname', `echo ${system}`);
  stub('open', `exit ${openWorks ? 0 : 3}`);
  stub('pgrep', `exit ${arcRunning ? 0 : 1}`);
  stub('osascript', `cat > /dev/null; exit ${arcWorks ? 0 : 1}`);
  return { dir, log, home: dir };
}

function run(env, args, scripts = SCRIPTS) {
  const { dir, log, home } = env;
  const result = spawnSync('sh', [join(scripts, 'open-sheet.sh'), ...args], {
    encoding: 'utf8',
    env: { PATH: `${dir}:/usr/bin:/bin`, HOME: home, ...(env.mode && { DESIGN_SPEC_OPEN: env.mode }) },
  });
  let calls = [];
  try { calls = readFileSync(log, 'utf8').trim().split('\n').filter((l) => !/^(uname|pgrep)/.test(l)); } catch {}
  return { status: result.status, out: result.stdout.trim(), err: result.stderr.trim(), calls };
}

test('every mode prints the link, so it can always go in the reply', () => {
  for (const mode of ['auto', 'browser-background', 'browser-foreground', 'app-pane', 'none', 'arc-background']) {
    assert.equal(run(stubs(), [URL, '--mode', mode]).out, URL, mode);
  }
});

test('auto opens an arc background tab when that browser is running, and the default browser behind the app when not', { skip: NO_ARC }, () => {
  assert.deepEqual(run(stubs({ arcRunning: true }), [URL]).calls, [`osascript - ${URL} background`]);
  assert.deepEqual(run(stubs(), [URL]).calls, [`open -g ${URL}`]);
});

test('the browser modes use open, in the background or the foreground', () => {
  assert.deepEqual(run(stubs(), [URL, '--mode', 'browser-background']).calls, [`open -g ${URL}`]);
  assert.deepEqual(run(stubs(), [URL, '--mode', 'browser-foreground']).calls, [`open ${URL}`]);
});

test('app-pane and none open nothing', () => {
  for (const mode of ['app-pane', 'none']) assert.deepEqual(run(stubs({ arcRunning: true }), [URL, '--mode', mode]).calls, [], mode);
});

test('DESIGN_SPEC_OPEN sets the mode, and --mode overrides it', () => {
  assert.deepEqual(run({ ...stubs(), mode: 'browser-foreground' }, [URL]).calls, [`open ${URL}`]);
  assert.deepEqual(run({ ...stubs(), mode: 'browser-foreground' }, [URL, '--mode', 'none']).calls, []);
});

test('an arc mode falls back to the default browser, in the same place, when that browser fails or is not running', { skip: NO_ARC }, () => {
  const failed = run(stubs({ arcRunning: true, arcWorks: false }), [URL, '--mode', 'arc-foreground']);
  assert.deepEqual(failed.calls, [`osascript - ${URL} foreground`, `open ${URL}`]);
  assert.match(failed.err, /arc browser is not available/);
  assert.deepEqual(run(stubs(), [URL, '--mode', 'arc-background']).calls, [`open -g ${URL}`]);
});

test('a republish to the same URL prints the link and opens nothing', () => {
  const env = stubs();
  run(env, [URL]);
  const again = run(env, [URL, '--mode', 'browser-foreground']);
  assert.equal(again.out, URL);
  assert.deepEqual(again.calls, [`open -g ${URL}`]);
});

test('an arc tab counts as opened, and so does its fallback', { skip: NO_ARC }, () => {
  const arc = stubs({ arcRunning: true });
  run(arc, [URL]);
  assert.deepEqual(run(arc, [URL]).calls, [`osascript - ${URL} background`]);
  const fallback = stubs({ arcRunning: true, arcWorks: false });
  run(fallback, [URL]);
  assert.deepEqual(run(fallback, [URL]).calls, [`osascript - ${URL} background`, `open -g ${URL}`]);
});

test('another URL still opens, including one that is the start of an opened one', () => {
  const env = stubs();
  run(env, [`${URL}-2`]);
  assert.deepEqual(run(env, [URL]).calls, [`open -g ${URL}-2`, `open -g ${URL}`]);
});

test('a mode that opened nothing leaves the first open still to come', () => {
  const env = stubs();
  run(env, [URL, '--mode', 'none']);
  assert.deepEqual(run(env, [URL]).calls, [`open -g ${URL}`]);
});

test('a failed open reports its status and is tried again', () => {
  for (const mode of ['browser-background', 'arc-background']) {
    const env = stubs({ openWorks: false });
    assert.equal(run(env, [URL, '--mode', mode]).status, 3, mode);
    assert.equal(run(env, [URL, '--mode', mode]).calls.length, 2, mode);
  }
});

test('a state folder that cannot be written still opens, and exits 0', () => {
  const env = stubs();
  const home = join(env.dir, 'a-file');
  writeFileSync(home, '');
  const result = run({ ...env, home }, [URL]);
  assert.deepEqual([result.status, result.err, result.calls], [0, '', [`open -g ${URL}`]]);
});

test('off macOS it only prints the link', () => {
  const linux = run(stubs({ system: 'Linux', arcRunning: true }), [URL, '--mode', 'browser-foreground']);
  assert.deepEqual([linux.out, linux.calls], [URL, []]);
});

test('without lib/arc.sh, as in the public copy, auto opens the default browser even with that browser running', () => {
  const bare = mkdtempSync(join(tmpdir(), 'open-sheet-bare-'));
  mkdirSync(join(bare, 'lib'));
  copyFileSync(join(SCRIPTS, 'open-sheet.sh'), join(bare, 'open-sheet.sh'));
  assert.deepEqual(run(stubs({ arcRunning: true }), [URL], bare).calls, [`open -g ${URL}`]);
});

test('an unknown mode or a missing link is a usage error', () => {
  assert.equal(run(stubs(), [URL, '--mode', 'chrome']).status, 2);
  assert.equal(run(stubs(), []).status, 2);
  assert.equal(run(stubs(), [URL, '--mode']).status, 2);
});
