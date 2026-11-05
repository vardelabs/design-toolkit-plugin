#!/usr/bin/env node
// PostToolUse: after `gh pr merge`, tells the session to run design-system-sync when the merged PR touched the
// repo's declared source paths. It only ever adds context, and always exits 0, so it cannot get in a merge's way.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_NAME, parseSyncConfig, touchesSource } from '../skills/design-system-sync/scripts/lib/sync-config.mjs';

const GH_TIMEOUT_MS = 15000;
const REASON_LIMIT = 200;
// A comment can only start a word: the last alternative takes a # inside one.
const SHELL_TOKEN = /\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"?|'[^']*'?|#[^\n]*|[;&|()\n]|[^\S\n]+|[^\s;&|()"'\\]+/g;
const VALUE_FLAGS = new Set([
  '--repo', '-R', '--match-head-commit', '--subject', '-t', '--body', '-b', '--body-file', '-F', '--author-email', '-A',
]);

// A heredoc's body is text, not commands. With no terminator line, the `<<` was text too, so the lines stay.
const HEREDOC = /(?<!<)<<(?!<)-?\s*(?:'([^'\n]+)'|"([^"\n]+)"|([^\s;&|()<>'"]+))/g;
const REDIRECT = /^\d*[<>]/;
const REDIRECT_ONLY = /^\d*[<>]+$/;
const ATTACHED_REPO = /^(?:--repo=|-R)(.+)$/;

function dropHeredocBodies(command) {
  const lines = command.split('\n');
  const bare = lines.map((line) => line.replace(/^\t+/, ''));
  const lastAt = new Map(bare.map((line, i) => [line, i]));
  const kept = [];
  for (let i = 0; i < lines.length; i += 1) {
    kept.push(lines[i]);
    for (const [, single, double, plain] of lines[i].matchAll(HEREDOC)) {
      const tag = single ?? double ?? plain;
      if (lastAt.get(tag) > i) i = bare.indexOf(tag, i + 1);
    }
  }
  return kept.join('\n');
}

function unquote(token) {
  if (token[0] === "'") return token.replace(/^'|'$/g, '');
  if (token[0] === '"') return token.replace(/^"|"$/g, '').replace(/\\([\s\S])/g, '$1');
  return token.replace(/\\([\s\S])/g, '$1');
}

// A body flag's text can quote a merge command, so quotes must hold their text inside one word.
export function shellSegments(command) {
  const segments = [[]];
  let word = null;
  const endWord = () => {
    if (word !== null) segments.at(-1).push(word);
    word = null;
  };
  for (const [token] of dropHeredocBodies(command).replace(/\\\n/g, ' ').matchAll(SHELL_TOKEN)) {
    const breaksSegment = /^[;&|()\n]$/.test(token);
    if (breaksSegment || /^(\s|#)/.test(token)) endWord();
    else word = (word ?? '') + unquote(token);
    if (breaksSegment) segments.push([]);
  }
  endWord();
  return segments.filter((segment) => segment.length);
}

// gh takes its flags anywhere, before the subcommand too, so the words that name the command come out of one pass.
function parseGhArgs(args) {
  let repo = null;
  const words = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const attached = arg.match(ATTACHED_REPO);
    if (attached) repo = attached[1];
    else if (arg === '--repo' || arg === '-R') repo = args[i + 1] ?? null;
    if (VALUE_FLAGS.has(arg) || REDIRECT_ONLY.test(arg)) i += 1;
    else if (!arg.startsWith('-') && !REDIRECT.test(arg)) words.push(arg);
  }
  return { repo, words };
}

const isGh = (word) => word === 'gh' || word.endsWith('/gh');
const ghRepoIn = (words) => words.find((word) => word.startsWith('GH_REPO='))?.slice('GH_REPO='.length) ?? null;

// Each merge in the command, with the folder and repo it runs against: a `cd` or `export GH_REPO` earlier in the command
// moves it off the session's own.
export function findMerges(command, cwd) {
  const merges = [];
  let dir = cwd;
  let exportedRepo = null;
  for (const segment of shellSegments(command)) {
    if (segment[0] === 'cd' && segment[1]) {
      dir = resolve(dir, segment[1].replace(/^~(?=\/|$)/, homedir()));
      continue;
    }
    if (segment[0] === 'export') exportedRepo = ghRepoIn(segment) ?? exportedRepo;
    const at = segment.findIndex(isGh);
    if (at < 0) continue;
    const { repo, words } = parseGhArgs(segment.slice(at + 1));
    if (words[0] !== 'pr' || words[1] !== 'merge') continue;
    merges.push({ repo: repo ?? ghRepoIn(segment.slice(0, at)) ?? exportedRepo, selector: words[2] ?? null, dir });
  }
  return merges;
}

function gh(args, dir) {
  // stdin: ignored, so a gh prompt can never hold the hook open.
  return execFileSync('gh', args, {
    cwd: dir, encoding: 'utf8', timeout: GH_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function resolvePr({ repo, selector, dir }) {
  const args = ['pr', 'view', ...(selector ? [selector] : []), ...(repo ? ['--repo', repo] : []), '--json', 'url'];
  const match = JSON.parse(gh(args, dir)).url.match(/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/);
  if (!match) throw new Error('gh returned no pull request URL');
  return { repo: match[1], number: match[2] };
}

function readConfigAt(repo, sha, dir) {
  let text;
  try {
    text = gh(['api', '-H', 'Accept: application/vnd.github.raw+json', `repos/${repo}/contents/${CONFIG_NAME}?ref=${sha}`], dir);
  } catch (err) {
    if (/HTTP 404/.test(String(err.stderr))) return null;
    throw err;
  }
  return parseSyncConfig(text);
}

// The REST file list names a rename's old path too: moving a file out of a source path still changes the library.
function changedFiles(repo, number, dir) {
  const jq = '.[] | .filename, (.previous_filename // empty)';
  return gh(['api', '--paginate', `repos/${repo}/pulls/${number}/files`, '--jq', jq], dir).split('\n').filter(Boolean);
}

// Returns the merged PR's repo and number when it should sync, else null.
export function prToSync(merge) {
  const { repo, number } = resolvePr(merge);
  const pr = JSON.parse(gh(['api', `repos/${repo}/pulls/${number}`], merge.dir));
  if (!pr.merged || pr.base.ref !== pr.base.repo.default_branch) return null;
  if (!pr.merge_commit_sha) throw new Error('GitHub gave no merge commit for the PR');
  const config = readConfigAt(repo, pr.merge_commit_sha, merge.dir);
  if (!config) return null;
  return touchesSource(changedFiles(repo, number, merge.dir), config.sourcePaths) ? { repo, number } : null;
}

function failureReason(err) {
  const firstLine = String(err.stderr || err.message).trim().split('\n')[0];
  return firstLine.slice(0, REASON_LIMIT);
}

// Names only the repo and PR number: file names and config text come from the PR and must not reach the session as prose.
function syncNotice(synced) {
  const prs = synced.map(({ repo, number }) => `${repo}#${number}`).join(', ');
  const repos = [...new Set(synced.map(({ repo }) => repo))].join(', ');
  return `design-toolkit: ${prs} merged and touched the repo's declared design source paths, so its Design System `
    + 'library is now behind the default branch. In this turn, run the design-toolkit:design-system-sync skill, '
    + `which rebuilds from the default branch and republishes. Run it from a checkout of ${repos}, and pass that repo `
    + 'to its prepare step as --repo. Report its result.';
}

const failureNotice = (reason) => 'design-toolkit: could not check whether this merge touched design source paths '
  + `(${reason}). If this repo declares design-system-sync in ${CONFIG_NAME}, run the design-toolkit:design-system-sync skill by hand.`;

export function noticeFor(merges) {
  const synced = [];
  const notices = [];
  for (const merge of merges) {
    try {
      const pr = prToSync(merge);
      if (pr) synced.push(pr);
    } catch (err) {
      notices.push(failureNotice(failureReason(err)));
    }
  }
  if (synced.length) notices.unshift(syncNotice(synced));
  return notices.join('\n');
}

function main() {
  const payload = JSON.parse(readFileSync(0, 'utf8'));
  const command = payload.tool_input?.command;
  if (typeof command !== 'string' || !/\bmerge\b/.test(command)) return;
  // PowerShell continues a line with a backtick.
  const joined = payload.tool_name === 'PowerShell' ? command.replace(/`\r?\n/g, ' ') : command;
  const notice = noticeFor(findMerges(joined, payload.cwd || process.cwd()));
  if (!notice) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notice },
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`design-system-sync hook: ${err.message}`);
  }
}
