#!/usr/bin/env node
// Fails a change that edits the plugin version. Each release sets the version here to match Varde Labs'
// own copy of the plugin, so a version a PR sets would point at code that copy never released.
//   node scripts/version.mjs check <base-ref>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARKETPLACE = '.claude-plugin/marketplace.json';
const PLUGIN_JSON = 'plugins/design-toolkit/.claude-plugin/plugin.json';
const README = 'plugins/design-toolkit/README.md';
const README_VERSION = /^\*\*Version:\*\* (\S+) \|/m;

export function readVersions(read) {
  const market = JSON.parse(read(MARKETPLACE));
  return {
    marketplace: market.plugins.find((p) => p.name === 'design-toolkit').version,
    metadata: market.metadata.version,
    pluginJson: JSON.parse(read(PLUGIN_JSON)).version,
    readme: read(README).match(README_VERSION)?.[1] ?? null,
  };
}

// Returns the problems with a change from base to head; an empty list passes.
export function check({ base, head }) {
  const changed = Object.keys(head).filter((field) => head[field] !== base[field]);
  if (!changed.length) return [];
  const moves = changed.map((field) => `${field} ${base[field]} -> ${head[field]}`).join(', ');
  return [`this change edits the plugin version (${moves}); leave it as it is, since each release sets it`];
}

function checkAgainst(baseRef) {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  const base = readVersions((rel) => git('show', `${baseRef}:${rel}`));
  const head = readVersions((rel) => readFileSync(join(ROOT, rel), 'utf8'));
  const problems = check({ base, head });
  for (const p of problems) console.error(`version check: ${p}`);
  if (!problems.length) console.log(`version check: ${head.marketplace} unchanged, ok`);
  return problems.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, baseRef] = process.argv.slice(2);
  try {
    if (command !== 'check' || !baseRef) throw new Error('usage: version.mjs check <base-ref>');
    process.exitCode = checkAgainst(baseRef);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 2;
  }
}
