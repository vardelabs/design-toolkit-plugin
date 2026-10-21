#!/usr/bin/env node
// Keeps the plugin version in step across the files that carry it, and checks that a change to the plugin raises it.
// `claude plugin update` installs a new copy only when the version changes, so a merged change with no bump never reaches users.
//   node scripts/version.mjs bump patch|minor|major
//   node scripts/version.mjs check <base-ref>
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_DIR = 'plugins/design-toolkit/';
const MARKETPLACE = '.claude-plugin/marketplace.json';
const PLUGIN_JSON = 'plugins/design-toolkit/.claude-plugin/plugin.json';
const README = 'plugins/design-toolkit/README.md';
const README_VERSION = /^\*\*Version:\*\* (\S+) \|/m;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function readVersions(read) {
  const market = JSON.parse(read(MARKETPLACE));
  const entry = market.plugins.find((p) => p.name === 'design-toolkit');
  return {
    marketplace: entry.version,
    metadata: market.metadata.version,
    pluginJson: JSON.parse(read(PLUGIN_JSON)).version,
    readme: read(README).match(README_VERSION)?.[1] ?? null,
  };
}

export function parse(version) {
  const m = SEMVER.exec(version ?? '');
  if (!m) throw new Error(`not a version: ${version}`);
  return m.slice(1).map(Number);
}

export function compare(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

export function bumped(version, part) {
  const [major, minor, patch] = parse(version);
  if (part === 'major') return `${major + 1}.0.0`;
  if (part === 'minor') return `${major}.${minor + 1}.0`;
  if (part === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`bump takes patch, minor, or major, not ${part}`);
}

function disagreement(versions) {
  const distinct = new Set(Object.values(versions));
  if (distinct.size === 1) return null;
  return `the version differs between files: ${Object.entries(versions).map(([k, v]) => `${k} ${v}`).join(', ')}`;
}

// Returns the problems with a change from base to head; an empty list passes.
export function check({ base, head, changed }) {
  const problems = [];
  const split = disagreement(head);
  if (split) problems.push(split);
  const touchesPlugin = changed.some((path) => path.startsWith(PLUGIN_DIR));
  if (touchesPlugin && !split && compare(head.marketplace, base.marketplace) <= 0) {
    problems.push(`this change edits ${PLUGIN_DIR} but leaves the version at ${head.marketplace}; run \`node scripts/version.mjs bump patch\` (or minor, or major)`);
  }
  return problems;
}

function bump(part) {
  const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
  const current = readVersions(read);
  const split = disagreement(current);
  if (split) throw new Error(split);
  const next = bumped(current.marketplace, part);
  const market = JSON.parse(read(MARKETPLACE));
  market.metadata.version = next;
  market.plugins.find((p) => p.name === 'design-toolkit').version = next;
  writeFileSync(join(ROOT, MARKETPLACE), JSON.stringify(market, null, 2) + '\n');
  const plugin = JSON.parse(read(PLUGIN_JSON));
  plugin.version = next;
  writeFileSync(join(ROOT, PLUGIN_JSON), JSON.stringify(plugin, null, 2) + '\n');
  writeFileSync(join(ROOT, README), read(README).replace(README_VERSION, `**Version:** ${next} |`));
  console.log(`${current.marketplace} -> ${next}`);
}

function checkAgainst(baseRef) {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  const base = readVersions((rel) => git('show', `${baseRef}:${rel}`));
  const head = readVersions((rel) => readFileSync(join(ROOT, rel), 'utf8'));
  const changed = git('diff', '--name-only', `${baseRef}...HEAD`).split('\n').filter(Boolean);
  const problems = check({ base, head, changed });
  for (const p of problems) console.error(`version check: ${p}`);
  if (!problems.length) console.log(`version check: ${base.marketplace} -> ${head.marketplace}, ok`);
  return problems.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, arg] = process.argv.slice(2);
  try {
    if (command === 'bump') bump(arg);
    else if (command === 'check' && arg) process.exitCode = checkAgainst(arg);
    else throw new Error('usage: version.mjs bump patch|minor|major | check <base-ref>');
  } catch (err) {
    console.error(err.message);
    process.exitCode = 2;
  }
}
