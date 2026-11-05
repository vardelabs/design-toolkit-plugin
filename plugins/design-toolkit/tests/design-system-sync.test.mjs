import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { findMerges, shellSegments } from '../hooks/design-system-sync-on-merge.mjs';
import { parseSyncConfig, touchesSource } from '../skills/design-system-sync/scripts/lib/sync-config.mjs';
import { fillCommand, findPython, newFails, planPublish } from '../skills/design-system-sync/scripts/sync.mjs';

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK_COMMAND = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8'))
  .hooks.PostToolUse[0].hooks[0].command;
const SYNC = join(PLUGIN, 'skills/design-system-sync/scripts/sync.mjs');
const MERGE_SHA = '79f9299e4c6acd1016f66295b9943563e8533de7';

const CONFIG = {
  'optical-align': { exceptions: [] },
  'design-system-sync': {
    artifact: 'https://claude.ai/artifact/abc123',
    sourcePaths: ['design/', 'app/ui/', 'theme.css'],
    python: '3.10',
    build: ['{python}', 'build.py'],
    measure: ['{python}', 'measure.py', 'out', '{capture}'],
    out: 'out',
    knownFails: ['FAIL light amber'],
  },
};

// Field names and shapes follow captured `gh api` responses for a real merged pull request.
const merged = { merged: true, merge_commit_sha: MERGE_SHA, base: { ref: 'main', repo: { default_branch: 'main' } } };

function fakeGh(routes) {
  const dir = mkdtempSync(join(tmpdir(), 'dss-gh-'));
  const log = join(dir, 'calls.log');
  writeFileSync(join(dir, 'routes.json'), JSON.stringify(routes));
  writeFileSync(join(dir, 'gh'), `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs');
const args = process.argv.slice(2).join(' ');
appendFileSync(${JSON.stringify(log)}, process.cwd() + ' :: ' + args + '\\n');
const routes = JSON.parse(readFileSync(${JSON.stringify(join(dir, 'routes.json'))}, 'utf8'));
const route = routes.find(([pattern]) => args.includes(pattern));
if (!route) { console.error('HTTP 404: no route for ' + args); process.exit(1); }
if (route[1].error) { console.error(route[1].error); process.exit(1); }
process.stdout.write(typeof route[1] === 'string' ? route[1] : JSON.stringify(route[1]));
`);
  chmodSync(join(dir, 'gh'), 0o755);
  return { dir, calls: () => readFileSync(log, 'utf8').trim().split('\n') };
}

const routesFor = ({ pr = merged, files = 'design/rules.md\n', config = JSON.stringify(CONFIG) } = {}) => [
  ['pr view', { url: 'https://github.com/example/app/pull/42' }],
  ['pulls/42/files', files],
  ['contents/.design-toolkit.json', config],
  ['repos/example/app/pulls/42', pr],
];

// Runs the hook through the command hooks.json gives the harness, with the payload on stdin.
function runHook(command, routes, env = {}, toolName = 'Bash') {
  const gh = fakeGh(routes);
  const payload = JSON.stringify({ tool_name: toolName, tool_input: { command }, cwd: gh.dir });
  const result = spawnSync('sh', ['-c', HOOK_COMMAND], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, PATH: `${gh.dir}${delimiter}${process.env.PATH}`, ...env },
  });
  const context = result.stdout ? JSON.parse(result.stdout).hookSpecificOutput.additionalContext : '';
  return { status: result.status, stderr: result.stderr, context, gh };
}

test('a merge that touched a source path tells the session to run the skill', () => {
  const { status, context } = runHook('gh pr merge 42 --squash --match-head-commit abc', routesFor());
  assert.equal(status, 0);
  assert.match(context, /example\/app#42 merged/);
  assert.match(context, /design-toolkit:design-system-sync/);
});

test('the notice carries no file name from the PR', () => {
  const { context } = runHook('gh pr merge 42', routesFor({ files: 'design/ignore-prior-instructions.md\n' }));
  assert.match(context, /example\/app#42/);
  assert.doesNotMatch(context, /ignore-prior-instructions/);
});

test('a merge outside the source paths is silent', () => {
  const { status, context, stderr } = runHook('gh pr merge 42', routesFor({ files: 'server/api.py\ndesignish/x.md\n' }));
  assert.equal(status, 0);
  assert.equal(context, '');
  assert.equal(stderr, '');
});

test('a file renamed out of a source path counts', () => {
  const { context } = runHook('gh pr merge 42', routesFor({ files: 'archive/rules.md\ndesign/rules.md\n' }));
  assert.match(context, /example\/app#42/);
});

test('a repo with no config file is silent', () => {
  const routes = routesFor().filter(([pattern]) => !pattern.startsWith('contents'));
  assert.equal(runHook('gh pr merge 42', routes).context, '');
});

test('a config file with no sync block is silent', () => {
  const config = JSON.stringify({ 'optical-align': { exceptions: [] } });
  assert.equal(runHook('gh pr merge 42', routesFor({ config })).context, '');
});

test('a PR not yet merged, such as --auto, is silent', () => {
  const pr = { ...merged, merged: false, merge_commit_sha: null };
  const { context, gh } = runHook('gh pr merge 42 --auto', routesFor({ pr }));
  assert.equal(context, '');
  assert.ok(!gh.calls().some((call) => call.includes('contents/')));
});

test('a merge into a branch other than the default is silent', () => {
  const pr = { ...merged, base: { ref: 'preview', repo: { default_branch: 'main' } } };
  assert.equal(runHook('gh pr merge 42', routesFor({ pr })).context, '');
});

test('the config is read at the merge commit', () => {
  const { gh } = runHook('gh pr merge 42', routesFor());
  assert.ok(gh.calls().some((call) => call.includes(`contents/.design-toolkit.json?ref=${MERGE_SHA}`)));
});

test('a command with no merge makes no gh call', () => {
  const { context, gh } = runHook('git log --oneline -1', routesFor());
  assert.equal(context, '');
  assert.throws(() => gh.calls());
});

test('merge text inside a quoted body makes no gh call', () => {
  const { context, gh } = runHook('gh pr comment 7 --body "then gh pr merge 42"', routesFor());
  assert.equal(context, '');
  assert.throws(() => gh.calls());
});

test('merge text inside a heredoc makes no gh call, and a command after the heredoc still counts', () => {
  const body = "git commit -F - <<'EOF'\ngh pr merge 7\nEOF";
  const quiet = runHook(body, routesFor());
  assert.equal(quiet.context, '');
  assert.throws(() => quiet.gh.calls());
  assert.match(runHook(`${body}\ngh pr merge 42`, routesFor()).context, /example\/app#42 merged/);
});

test('a PowerShell backtick continuation is one command', () => {
  const { context } = runHook('gh `\n  pr merge 42', routesFor(), {}, 'PowerShell');
  assert.match(context, /example\/app#42 merged/);
});

test('a merged PR with no merge commit asks for a run by hand', () => {
  const { context, gh } = runHook('gh pr merge 42', routesFor({ pr: { ...merged, merge_commit_sha: null } }));
  assert.match(context, /could not check/);
  assert.ok(!gh.calls().some((call) => call.includes('contents/')));
});

test('a gh failure still exits 0 and asks for a run by hand', () => {
  const routes = [['pr view', { error: 'HTTP 502: Bad Gateway' }]];
  const { status, context } = runHook('gh pr merge 42', routes);
  assert.equal(status, 0);
  assert.match(context, /could not check/);
  assert.match(context, /HTTP 502/);
  assert.match(context, /by hand/);
});

test('a broken config asks for a look rather than staying silent', () => {
  const config = JSON.stringify({ 'design-system-sync': { artifact: 'https://evil.example/x' } });
  const { status, context } = runHook('gh pr merge 42', routesFor({ config }));
  assert.equal(status, 0);
  assert.match(context, /could not check/);
  assert.doesNotMatch(context, /evil/);
});

test('a config that is not JSON keeps its text out of the notice', () => {
  // Short enough that JSON.parse would quote all of it.
  const { context } = runHook('gh pr merge 42', routesFor({ config: '{"a":XY}' }));
  assert.match(context, /\.design-toolkit\.json is not valid JSON/);
  assert.doesNotMatch(context, /XY/);
});

test('a payload that is not JSON exits 0', () => {
  const result = spawnSync('sh', ['-c', HOOK_COMMAND], {
    input: 'not json', encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});

test('findMerges reads the repo, the selector, and the folder', () => {
  assert.deepEqual(findMerges('gh pr merge 42 --repo o/r --squash', '/w'), [{ repo: 'o/r', selector: '42', dir: '/w' }]);
  assert.deepEqual(findMerges('gh pr merge -R o/r --match-head-commit abc 42', '/w'), [{ repo: 'o/r', selector: '42', dir: '/w' }]);
  assert.deepEqual(findMerges('gh pr merge --repo=o/r 42', '/w'), [{ repo: 'o/r', selector: '42', dir: '/w' }]);
  assert.deepEqual(findMerges('gh pr merge', '/w'), [{ repo: null, selector: null, dir: '/w' }]);
  assert.deepEqual(findMerges('cd /other && gh pr merge 7', '/w'), [{ repo: null, selector: '7', dir: '/other' }]);
  assert.deepEqual(findMerges('cd sub\n/opt/bin/gh pr merge https://github.com/o/r/pull/7', '/w'),
    [{ repo: null, selector: 'https://github.com/o/r/pull/7', dir: '/w/sub' }]);
  assert.equal(findMerges('gh pr merge 1 && gh pr merge 2', '/w').length, 2);
  assert.deepEqual(findMerges('gh pr view 1 # gh pr merge 2', '/w'), []);
  assert.deepEqual(findMerges("gh pr merge 42 \\\n  --subject 'a; gh pr merge 9'", '/w'), [{ repo: null, selector: '42', dir: '/w' }]);
});

test('findMerges finds the repo wherever gh takes it', () => {
  const want = [{ repo: 'o/r', selector: '42', dir: '/w' }];
  for (const command of [
    'gh -R o/r pr merge 42', 'gh --repo o/r pr merge 42', 'gh --repo=o/r pr merge 42', 'gh pr -R o/r merge 42',
    'gh pr merge 42 -Ro/r', 'GH_REPO=o/r gh pr merge 42', 'export GH_REPO=o/r && gh pr merge 42',
    'GH_REPO=x/y gh pr merge 42 --repo o/r',
  ]) assert.deepEqual(findMerges(command, '/w'), want, command);
});

test('a redirect is not the selector', () => {
  const none = [{ repo: null, selector: null, dir: '/w' }];
  assert.deepEqual(findMerges('gh pr merge --squash 2>&1 | tail -1', '/w'), none);
  assert.deepEqual(findMerges('gh pr merge > /tmp/out', '/w'), none);
  assert.deepEqual(findMerges('gh pr merge >/tmp/out', '/w'), none);
});

test('a heredoc with no terminator hides nothing, and long input stays quick', () => {
  assert.equal(findMerges('echo "a <<b"\ngh pr merge 42', '/w').length, 1);
  assert.equal(findMerges('cat <<<word\ngh pr merge 42\nword', '/w').length, 1);
  const started = Date.now();
  findMerges(Array.from({ length: 40000 }, (_, i) => `<<t${i}`).join('\n'), '/w');
  assert.ok(Date.now() - started < 1000);
});

test('shellSegments keeps quoted separators in one word', () => {
  assert.deepEqual(shellSegments('a "b; c" | d'), [['a', 'b; c'], ['d']]);
});

test('touchesSource matches a folder and a file, and no name that only starts the same', () => {
  const paths = ['design/', 'theme.css', 'app/ui'];
  assert.ok(touchesSource(['design/a.md'], paths));
  assert.ok(touchesSource(['theme.css'], paths));
  assert.ok(touchesSource(['app/ui/x.css'], paths));
  assert.ok(!touchesSource(['designs/a.md', 'theme.css.map', 'app/uikit/x.css'], paths));
});

test('parseSyncConfig returns the block, null with none, and names the bad field', () => {
  assert.equal(parseSyncConfig(JSON.stringify(CONFIG)).out, 'out');
  assert.equal(parseSyncConfig('{"optical-align":{}}'), null);
  const bad = (patch) => JSON.stringify({ 'design-system-sync': { ...CONFIG['design-system-sync'], ...patch } });
  assert.throws(() => parseSyncConfig(bad({ artifact: 'https://evil.example/x' })), /"artifact"/);
  assert.throws(() => parseSyncConfig(bad({ out: '../up' })), /"out"/);
  assert.throws(() => parseSyncConfig(bad({ sourcePaths: [] })), /"sourcePaths"/);
  assert.throws(() => parseSyncConfig(bad({ sourcePaths: ['/etc'] })), /"sourcePaths"/);
  assert.throws(() => parseSyncConfig(bad({ build: 'sh -c x' })), /"build"/);
  assert.throws(() => parseSyncConfig(bad({ python: 'three' })), /"python"/);
});

const BUILT = [
  'project/README.md', 'project/tokens.json', 'project/components/bundle.css',
  'project/components/Chips/README.md', 'project/components/Chips/preview.html',
  'project/components/Send/preview.html', 'project/components/New/preview.html',
];
const LIVE = [
  'project/README.md', 'project/tokens.json', 'project/components/bundle.css', 'project/design-system.json',
  'project/components/Chips/README.md', 'project/components/Chips/preview.html', 'project/components/Chips/old-note.md',
  'project/components/Send/preview.html', 'project/components/Gone/preview.html', 'project/05-old-tab.md',
];

test('planPublish sends the built files, and null for a live card file the build did not write', () => {
  const plan = planPublish(BUILT, LIVE, (path) => path === 'project/components/Chips/preview.html' || path === 'project/tokens.json');
  assert.equal(plan.file_path, 'project/README.md');
  assert.deepEqual(plan.files, {
    'project/tokens.json': 'project/tokens.json',
    'project/components/bundle.css': 'project/components/bundle.css',
    'project/components/Chips/README.md': 'project/components/Chips/README.md',
    'project/components/Chips/preview.html': 'project/components/Chips/preview.html',
    'project/components/Send/preview.html': 'project/components/Send/preview.html',
    'project/components/New/preview.html': 'project/components/New/preview.html',
    'project/components/Chips/old-note.md': null,
    'project/components/Gone/preview.html': null,
  });
  assert.deepEqual(plan.changedCards, ['Chips']);
  assert.deepEqual(plan.addedCards, ['New']);
  assert.deepEqual(plan.removedCards, ['Gone']);
  assert.deepEqual(plan.changedOther, ['project/tokens.json']);
  assert.equal(plan.readBack, 'project/components/Chips/preview.html');
  assert.equal(plan.nothingToPublish, false);
});

test('planPublish calls a card changed when it only gains or loses a file', () => {
  const entry = 'project/README.md';
  const a = 'project/components/A/preview.html';
  const gained = planPublish([entry, a, 'project/components/A/note.md'], [entry, a], () => false);
  assert.deepEqual([gained.changedCards, gained.addedCards, gained.removedCards], [['A'], [], []]);
  const lost = planPublish([entry, a], [entry, a, 'project/components/A/note.md'], () => false);
  assert.deepEqual([lost.changedCards, lost.addedCards, lost.removedCards], [['A'], [], []]);
});

test('planPublish never sends the index, even when a build wrote it, or anything outside project/', () => {
  const plan = planPublish([...BUILT, 'project/design-system.json', 'index.html', 'artifact-type/app.js'], LIVE, () => false);
  for (const path of ['project/design-system.json', 'index.html', 'artifact-type/app.js']) {
    assert.ok(!(path in plan.files), path);
  }
});

test('planPublish never removes a live file outside a card folder', () => {
  const plan = planPublish(BUILT, [...LIVE, 'index.html', 'artifact-type/app.js', 'project/assets/Tray App/shot.png'], () => false);
  const removed = Object.keys(plan.files).filter((path) => plan.files[path] === null);
  assert.deepEqual(removed, ['project/components/Chips/old-note.md', 'project/components/Gone/preview.html']);
});

test('planPublish says when the library already matches', () => {
  const plan = planPublish(['project/README.md'], ['project/README.md', 'project/design-system.json'], () => false);
  assert.equal(plan.nothingToPublish, true);
  assert.equal(plan.readBack, null);
});

test('planPublish refuses a build with no entry file', () => {
  assert.throws(() => planPublish(['project/tokens.json'], [], () => false), /README\.md/);
});

test('newFails drops the known lines and keeps the rest', () => {
  const output = 'Built x.\nFAIL light amber on canvas 2.15:1\nFAIL dark faint on raised 2.0:1\nbody on core 14:1\n';
  assert.deepEqual(newFails(output, ['FAIL light amber']), ['FAIL dark faint on raised 2.0:1']);
  assert.deepEqual(newFails(output), ['FAIL light amber on canvas 2.15:1', 'FAIL dark faint on raised 2.0:1']);
});

test('fillCommand fills the placeholders and refuses a missing interpreter', () => {
  assert.deepEqual(fillCommand(['{python}', 'm.py', '{capture}'], { python: '/py', capture: '/c.mjs' }), ['/py', 'm.py', '/c.mjs']);
  assert.throws(() => fillCommand(['{python}'], { capture: '/c.mjs' }), /\{python\}/);
});

test('findPython skips an interpreter under the floor and prefers the oldest allowed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dss-py-'));
  const fake = (name, version) => {
    writeFileSync(join(dir, name), `#!/bin/sh\necho ${version}\n`);
    chmodSync(join(dir, name), 0o755);
  };
  fake('python3', '3.9');
  fake('python3.13', '3.13');
  fake('python3.15', '3.15');
  try {
    assert.equal(findPython('3.10', [dir]), join(dir, 'python3.13'));
    fake('python3', '3.15');
    assert.equal(findPython('3.10', [dir]), join(dir, 'python3.13'), 'a bare python3 can be the pre-release');
    rmSync(join(dir, 'python3.13'));
    rmSync(join(dir, 'python3.15'));
    assert.equal(findPython('3.10', [dir]), join(dir, 'python3'));
    assert.throws(() => findPython('3.16', [dir]), /no Python 3\.16/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fixtureRepo() {
  const base = mkdtempSync(join(tmpdir(), 'dss-repo-'));
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const origin = join(base, 'origin.git');
  const repo = join(base, 'repo');
  git(base, 'init', '-q', '--bare', '-b', 'main', origin);
  git(base, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  writeFileSync(join(repo, 'build.mjs'), `import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('out/project/components/Chips', { recursive: true });
writeFileSync('out/project/README.md', 'readme');
writeFileSync('out/project/components/Chips/preview.html', 'chips');
console.log('FAIL light amber on canvas');
console.log('FAIL dark faint on raised');
`);
  writeFileSync(join(repo, '.design-toolkit.json'), JSON.stringify({
    'design-system-sync': {
      artifact: 'https://claude.ai/artifact/abc123',
      sourcePaths: ['design/'],
      build: ['node', 'build.mjs'],
      measure: ['node', '-e', '0'],
      out: 'out',
      knownFails: ['FAIL light amber'],
    },
  }));
  writeFileSync(join(repo, '.gitignore'), 'out/\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'first');
  git(repo, 'push', '-q', 'origin', 'HEAD:main');
  return { base, repo, git };
}

test('prepare, plan, and cleanup work through the CLI against a real git repo', () => {
  const { base, repo, git } = fixtureRepo();
  const gh = fakeGh([['repo view', { nameWithOwner: 'example/app', defaultBranchRef: { name: 'main' } }]]);
  const env = { ...process.env, PATH: `${gh.dir}${delimiter}${process.env.PATH}` };
  const run = (...args) => JSON.parse(execFileSync('node', [SYNC, ...args], { cwd: repo, encoding: 'utf8', env }));
  try {
    const state = run('prepare', '--workdir', join(base, 'work'));
    const head = git(repo, 'rev-parse', 'HEAD').trim();
    assert.equal(state.commit, head);
    assert.deepEqual(state.newFails, ['FAIL dark faint on raised']);
    assert.equal(git(state.checkout, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'HEAD');

    const live = join(base, 'live');
    mkdirSync(join(live, 'project/components/Chips'), { recursive: true });
    mkdirSync(join(live, 'project/components/Gone'), { recursive: true });
    writeFileSync(join(live, 'project/README.md'), 'readme');
    writeFileSync(join(live, 'project/components/Chips/preview.html'), 'older chips');
    writeFileSync(join(live, 'project/components/Gone/preview.html'), 'gone');

    const plan = run('plan', '--state', state.stateFile, '--live-dir', live);
    assert.equal(plan.url, 'https://claude.ai/artifact/abc123');
    assert.equal(plan.root, state.root);
    assert.equal(plan.file_path, join(state.root, 'project/README.md'));
    assert.deepEqual(plan.changedCards, ['Chips']);
    assert.deepEqual(plan.removedCards, ['Gone']);
    assert.equal(plan.files['project/components/Gone/preview.html'], null);
    assert.equal(plan.tipMoved, false);

    run('cleanup', '--state', state.stateFile);
    assert.ok(!git(repo, 'worktree', 'list').includes(state.checkout));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('prepare builds the branch tip, not the local checkout, and a failed build leaves no worktree', () => {
  const { base, repo, git } = fixtureRepo();
  const gh = fakeGh([['repo view', { nameWithOwner: 'example/app', defaultBranchRef: { name: 'main' } }]]);
  const env = { ...process.env, PATH: `${gh.dir}${delimiter}${process.env.PATH}` };
  const sync = (...args) => spawnSync('node', [SYNC, ...args], { cwd: repo, encoding: 'utf8', env });
  try {
    const other = join(base, 'other');
    git(base, 'clone', '-q', join(base, 'origin.git'), other);
    git(other, 'config', 'user.email', 'test@example.com');
    git(other, 'config', 'user.name', 'Test');
    writeFileSync(join(other, 'build.mjs'), 'process.exit(3);\n');
    git(other, 'add', '.');
    git(other, 'commit', '-q', '-m', 'break the build');
    git(other, 'push', '-q', 'origin', 'HEAD:main');

    const result = sync('prepare', '--workdir', join(base, 'work'));
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /must be/);
    assert.equal(git(repo, 'worktree', 'list').trim().split('\n').length, 1);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
