// The "design-system-sync" block of a repo's .design-toolkit.json. The merge hook and sync.mjs both read it.
export const CONFIG_NAME = '.design-toolkit.json';
const KEY = 'design-system-sync';
const ARTIFACT_URL = /^https:\/\/claude\.ai\/(code\/)?artifact\/[\w-]+$/;
const PYTHON_VERSION = /^\d+\.\d+$/;

const isRelativeInside = (path) =>
  typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.split('/').includes('..');
const isCommand = (argv) => Array.isArray(argv) && argv.length > 0 && argv.every((arg) => typeof arg === 'string' && arg);

const CHECKS = [
  ['artifact', (v) => typeof v === 'string' && ARTIFACT_URL.test(v), 'a claude.ai artifact URL'],
  ['sourcePaths', (v) => Array.isArray(v) && v.length > 0 && v.every(isRelativeInside), 'a list of repo-relative paths'],
  ['build', isCommand, 'a command as a list of arguments'],
  ['measure', isCommand, 'a command as a list of arguments'],
  ['out', isRelativeInside, 'a repo-relative path'],
  ['python', (v) => v === undefined || (typeof v === 'string' && PYTHON_VERSION.test(v)), 'a version such as "3.10"'],
  ['knownFails', (v) => v === undefined || (Array.isArray(v) && v.every((s) => typeof s === 'string')), 'a list of strings'],
];

// JSON.parse quotes the text it failed on, and this text comes from a PR, so its message must not travel.
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${CONFIG_NAME} is not valid JSON`);
  }
}

// Returns the block, or null when the repo declares none; throws on a block that cannot be used.
export function parseSyncConfig(text) {
  const block = parseJson(text)?.[KEY];
  if (block === undefined) return null;
  for (const [field, valid, expected] of CHECKS) {
    if (!valid(block?.[field])) throw new Error(`${KEY} "${field}" must be ${expected}`);
  }
  return block;
}

const covers = (sourcePath, file) =>
  sourcePath.endsWith('/') ? file.startsWith(sourcePath) : file === sourcePath || file.startsWith(`${sourcePath}/`);

export const touchesSource = (files, sourcePaths) =>
  files.some((file) => sourcePaths.some((sourcePath) => covers(sourcePath, file)));
