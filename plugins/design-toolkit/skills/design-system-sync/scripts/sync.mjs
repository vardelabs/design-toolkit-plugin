#!/usr/bin/env node
// Rebuilds a repo's Design System library from its default branch, in a temporary detached worktree, and works out
// the Artifact publish. It never publishes: only a session's Artifact tool can.
//   node sync.mjs prepare [--repo OWNER/NAME] [--repo-dir DIR] [--workdir DIR]
//   node sync.mjs plan --state FILE --live-dir DIR
//   node sync.mjs check-tip --state FILE
//   node sync.mjs cleanup --state FILE
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CONFIG_NAME, parseSyncConfig } from './lib/sync-config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURE = join(HERE, '../../design-spec/scripts/capture.mjs');
const ENTRY = 'project/README.md';
const PUBLISHED_ROOT = 'project/';
// The artifact type's own index holds the library's title and uploaded images, so a build must not replace it.
const NEVER_PUBLISHED = new Set(['project/design-system.json']);
const CARD_PATH = /^project\/components\/([^/]+)\//;
const STEP_TIMEOUT_MS = 600000;
const REMOTE_URL = /^remote\.(.+)\.url\s.*[:/]([^/:\s]+\/[^/\s]+?)(?:\.git)?\/?$/;

const atLeast = (version, floor) => {
  const [major, minor] = version.split('.').map(Number);
  const [floorMajor, floorMinor] = floor.split('.').map(Number);
  return major > floorMajor || (major === floorMajor && minor >= floorMinor);
};

function pythonVersion(path) {
  try {
    return execFileSync(path, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

// A desktop session's PATH often leaves out the user-level folders where a newer Python lives.
const pythonFolders = () => [
  ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
  join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin',
];

// Oldest first: a machine can hold a pre-release Python, and the floor is what the repo says it runs on.
export function findPython(floor, folders = pythonFolders()) {
  const names = [...Array.from({ length: 30 }, (_, i) => `python3.${i + 1}`), 'python3'];
  for (const folder of folders) {
    for (const name of names) {
      const path = join(folder, name);
      if (!existsSync(path)) continue;
      const version = pythonVersion(path);
      if (version && atLeast(version, floor)) return path;
    }
  }
  throw new Error(`no Python ${floor} or later found in ${folders.join(', ')}`);
}

export function fillCommand(argv, values) {
  return argv.map((arg) => arg.replace(/\{(python|capture)\}/g, (_, name) => {
    if (!values[name]) throw new Error(`the command uses {${name}}, and the config sets no "python" version`);
    return values[name];
  }));
}

function runStep(argv, cwd) {
  // stdin: ignored, so a step that reads it fails at once rather than hanging the session.
  return execFileSync(argv[0], argv.slice(1), {
    cwd, encoding: 'utf8', timeout: STEP_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function repoFacts(repoDir, named) {
  const args = ['gh', 'repo', 'view', ...(named ? [named] : []), '--json', 'nameWithOwner,defaultBranchRef'];
  const view = JSON.parse(runStep(args, repoDir));
  return { repo: view.nameWithOwner, branch: view.defaultBranchRef.name };
}

// `gh` can name a repo other than `origin`, and a merge can be for a repo other than this checkout's.
// The raw config value, because `git remote get-url` applies any url rewrite first.
function remoteFor(repoDir, repo) {
  // Exits 1 when the checkout has no remote at all, which is the same refusal as no matching remote.
  const config = spawnSync('git', ['config', '--get-regexp', '^remote\\..*\\.url$'], { cwd: repoDir, encoding: 'utf8' });
  const lines = config.stdout.split('\n');
  const matches = lines.map((line) => line.match(REMOTE_URL)).filter(Boolean);
  const found = matches.find(([, , name]) => name.toLowerCase() === repo.toLowerCase());
  if (!found) throw new Error(`no remote of this checkout points at ${repo}: run from a checkout of it, or pass --repo-dir`);
  return found[1];
}

function tipOf({ repoDir, remote, branch }) {
  return runStep(['git', 'ls-remote', remote, `refs/heads/${branch}`], repoDir).split(/\s/)[0];
}

export function newFails(buildOutput, known = []) {
  return buildOutput.split('\n')
    .filter((line) => line.startsWith('FAIL') && !known.some((entry) => line.includes(entry)));
}

function listFiles(root, dir = root) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(root, path) : [relative(root, path)];
  });
}

function buildInWorktree(checkout, config) {
  const values = { capture: CAPTURE, python: config.python && findPython(config.python) };
  const buildOutput = runStep(fillCommand(config.build, values), checkout);
  runStep(fillCommand(config.measure, values), checkout);
  return { root: join(checkout, config.out), newFails: newFails(buildOutput, config.knownFails) };
}

function prepare({ 'repo-dir': repoDirArg, workdir, repo: named }) {
  const repoDir = resolve(repoDirArg ?? '.');
  const { repo, branch } = repoFacts(repoDir, named);
  const remote = remoteFor(repoDir, repo);
  runStep(['git', 'fetch', remote, branch], repoDir);
  const commit = runStep(['git', 'rev-parse', 'FETCH_HEAD'], repoDir).trim();
  const config = parseSyncConfig(runStep(['git', 'show', `${commit}:${CONFIG_NAME}`], repoDir));
  if (!config) throw new Error(`${repo} declares no design-system-sync in ${CONFIG_NAME} at ${commit}`);

  const parent = resolve(workdir ?? join(repoDir, '.claude/worktrees'));
  mkdirSync(parent, { recursive: true });
  const workRoot = mkdtempSync(join(parent, 'design-system-sync-'));
  const checkout = join(workRoot, 'checkout');
  runStep(['git', 'worktree', 'add', '--detach', checkout, commit], repoDir);
  const state = {
    repo, branch, remote, commit, artifact: config.artifact, keepCards: config.keepCards ?? [], repoDir, workRoot, checkout,
  };
  const stateFile = join(workRoot, 'state.json');
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
  try {
    Object.assign(state, buildInWorktree(checkout, config));
    writeFileSync(stateFile, JSON.stringify(state, null, 2));
    return { ...state, stateFile };
  } catch (err) {
    cleanup({ state: stateFile });
    throw err;
  }
}

const sameBytes = (a, b) => readFileSync(a).equals(readFileSync(b));
const cardName = (path) => path.match(CARD_PATH)?.[1] ?? null;
const uniqueCards = (paths) => [...new Set(paths.map(cardName).filter(Boolean))].sort();

// builtFiles and liveFiles are paths relative to the artifact root; isChanged compares a path on both sides.
// A live card named by keepCards stays until a person retires it, because no build writes it.
export function planPublish(builtFiles, liveFiles, isChanged, keepCards = []) {
  const built = builtFiles.filter((path) => path.startsWith(PUBLISHED_ROOT) && !NEVER_PUBLISHED.has(path));
  if (!built.includes(ENTRY)) throw new Error(`the build wrote no ${ENTRY}`);
  const live = new Set(liveFiles);
  const added = built.filter((path) => !live.has(path));
  const changed = built.filter((path) => live.has(path) && isChanged(path));
  const notBuilt = liveFiles.filter((path) => CARD_PATH.test(path) && !built.includes(path));
  const isKept = (path) => keepCards.some((prefix) => cardName(path).startsWith(prefix));
  const removed = notBuilt.filter((path) => !isKept(path));

  const files = Object.fromEntries(built.filter((path) => path !== ENTRY).map((path) => [path, path]));
  for (const path of removed) files[path] = null;
  const touched = [...changed, ...added];
  const hasCard = (paths, card) => paths.some((path) => cardName(path) === card);
  return {
    file_path: ENTRY,
    files,
    nothingToPublish: !touched.length && !removed.length,
    changedCards: uniqueCards([...touched, ...removed]).filter((card) => hasCard(liveFiles, card) && hasCard(built, card)),
    keptCards: uniqueCards(notBuilt.filter(isKept)),
    addedCards: uniqueCards(added).filter((card) => !hasCard(liveFiles, card)),
    removedCards: uniqueCards(removed).filter((card) => !hasCard(built, card)),
    changedOther: touched.filter((path) => !CARD_PATH.test(path)).sort(),
    readBack: touched.find((path) => CARD_PATH.test(path)) ?? touched[0] ?? (removed.length ? ENTRY : null),
  };
}

function plan({ state: stateFile, 'live-dir': liveDir }) {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const result = planPublish(
    listFiles(state.root),
    listFiles(resolve(liveDir)),
    (path) => !sameBytes(join(state.root, path), join(resolve(liveDir), path)),
    state.keepCards,
  );
  const file_path = join(state.root, result.file_path);
  return {
    ...result,
    file_path,
    url: state.artifact,
    root: state.root,
    commit: state.commit,
    newFails: state.newFails,
    tipMoved: tipOf(state) !== state.commit,
  };
}

function checkTip({ state: stateFile }) {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  return { commit: state.commit, tipMoved: tipOf(state) !== state.commit };
}

function cleanup({ state: stateFile }) {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  runStep(['git', 'worktree', 'remove', '--force', state.checkout], state.repoDir);
  rmSync(state.workRoot, { recursive: true, force: true });
  return { removed: state.workRoot };
}

const COMMANDS = { prepare, plan, 'check-tip': checkTip, cleanup };
const REQUIRED = { prepare: [], plan: ['state', 'live-dir'], 'check-tip': ['state'], cleanup: ['state'] };

function main(argv) {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      repo: { type: 'string' }, 'repo-dir': { type: 'string' }, workdir: { type: 'string' }, state: { type: 'string' }, 'live-dir': { type: 'string' },
    },
  });
  if (!COMMANDS[command]) throw new Error(`usage: sync.mjs ${Object.keys(COMMANDS).join('|')}`);
  for (const name of REQUIRED[command]) if (!values[name]) throw new Error(`${command} needs --${name}`);
  console.log(JSON.stringify(COMMANDS[command](values), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`design-system-sync: ${String(err.stderr || '').trim() || err.message}`);
    process.exitCode = 1;
  }
}
