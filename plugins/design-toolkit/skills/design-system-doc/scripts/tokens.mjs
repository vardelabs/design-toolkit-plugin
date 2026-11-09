#!/usr/bin/env node
// Reads a repo's real design tokens and prints the token half of its DESIGN.md, every value cited to file:line.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankComments, customProperties, hasFocusRule } from './lib/css.mjs';
import { jsonTokens } from './lib/json.mjs';

const SKIPPED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', 'coverage', 'vendor', '.turbo', '.cache']);
const STYLE_EXTENSIONS = new Set(['.css', '.scss', '.less', '.pcss']);
const LINE_COMMENT_EXTENSIONS = new Set(['.scss', '.less']);
// tokens.json, design-tokens.json, theme.json, or a DTCG file such as colors.tokens.json, each with an optional .light or
// .dark before .json. Other JSON with token in its name is often a credential, such as an OAuth token.json.
const TOKEN_JSON = /^(tokens|design-tokens|theme)$|\.tokens$/i;
// The mode is a dot-separated part of the name: tokens.dark, dark.tokens, or colors.dark.tokens.
const MODE_PART = /(^|\.)(light|dark)(?=\.|$)/i;
// JSON named like a token file but not by a name the script reads, such as tokens-dark.json, is named for the agent.
const TOKEN_LIKE = /(^|[-_.])(tokens?|theme)([-_.]|$)/i;
const TOKEN_FOLDER = /^(design-)?tokens$/i;
// A token file that names or holds a credential is withheld, so no secret reaches the doc.
const SECRET_NAME = /secret|passw(or)?d|credential|(access|refresh|auth|bearer|session|id)[-_]?token|api[-_]?key|private[-_]?key|client[-_]?id|(^|[-_.])(auth|token)$/i;
// A known credential prefix anywhere a word starts, so "Bearer ghp_..." and a quoted key are caught too.
const SECRET_VALUE = /(^|[\s"'])(gh[pousr]_|github_pat_|sk-|sk_live_|rk_live_|xox[abpr]-|AKIA|ya29\.|AIza|npm_|glpat-|Bearer\s)/;
// A theme file named for one mode, such as dark.css or tokens.dark.json.
const DARK_FILE = /(^|[-_.])dark([-_.]|$)/i;
const LIGHT_FILE = /(^|[-_.])light([-_.]|$)/i;
// Sass and Less variables, $ink: or @ink:, are tokens the script does not read.
const PREPROCESSOR_VARIABLE = /^\s*[$@][\w-]+\s*:/m;
// A JS or TS theme needs evaluating to read, and indented Sass has no braces to parse, so the doc names these for the
// agent instead of guessing at them.
const HAND_READ = /^(tailwind\.config|theme|tokens?)\.(c|m)?(js|ts)$|\.sass$/i;
// The whole value is one colour; rgba(0,0,0,.1) 0 1px 2px is a shadow.
const COLOUR_VALUE = /^(#[0-9a-f]{3,8}|(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\((?:[^()]|\([^()]*\))*\))$/i;
const FONT_SIZE = /font[-._]?size/;
// shadcn-style channels, "0 0% 100%", that a stylesheet wraps in hsl() where it uses them.
const HSL_CHANNELS = /^-?[\d.]+(deg|turn|rad)?\s+[\d.]+%\s+[\d.]+%(\s*\/\s*[\d.]+%?)?$/;
const SIZE_VALUE = /^(-?[\d.]+(px|rem|em|%|vw|vh|vmin|vmax|ch|ex|pt|cqi)?|(clamp|calc|min|max)\()/i;
// A step name such as --text-sm or --step-0 is a type size even when its value is a var().
const TYPE_STEP = /(^|[-.])(text|fs|step)[-.]([2-9]?x[sl]|sm|md|lg|base|\d+)$/;
const SIZE_NAME = /(^|[-.])(width|height|size|min|max)([-.]|$)/;
const COLOUR_ROLE = /colou?r|(^|[-.])(text|ink|fg|bg|background|foreground|surface|border|accent|primary|secondary|muted|danger|success|warning|destructive|ring|card|popover|brand)([-.]|$)/;

export const CATEGORIES = [
  { id: 'colour', title: 'Colour roles', question: 'No colour tokens were found. Which colours are the roles (background, text, muted text, accent, border, danger)?' },
  { id: 'type', title: 'Type scale', question: 'No type-size tokens were found. What is the type scale?' },
  { id: 'font', title: 'Font families', question: 'No font-family tokens were found. Which typefaces does the product use, and for what?' },
  { id: 'spacing', title: 'Spacing', question: 'No spacing tokens were found. What is the spacing scale?' },
  { id: 'radius', title: 'Radius', question: 'No radius tokens were found. What corner radii are in use?' },
  { id: 'shadow', title: 'Shadows', question: null },
  { id: 'other', title: 'Other tokens', question: null },
];

export function categorize(name, value) {
  const n = name.toLowerCase();
  if (/weight|leading|line-height|tracking|letter-spacing|duration|ease|z-index|breakpoint/.test(n)) return 'other';
  if (FONT_SIZE.test(n)) return 'type';
  if (COLOUR_VALUE.test(value) || HSL_CHANNELS.test(value)) return 'colour';
  if (/radius|rounded/.test(n)) return 'radius';
  if (/shadow|elevation/.test(n)) return 'shadow';
  if (/font-size|(^|[-.])(text|step|fs)[-.]|type-scale/.test(n) && (SIZE_VALUE.test(value) || TYPE_STEP.test(n))) return 'type';
  if (/font|family|typeface/.test(n)) return 'font';
  if (/space|spacing|gap|gutter|margin|padding|inset/.test(n)) return 'spacing';
  if (COLOUR_ROLE.test(n) && !SIZE_NAME.test(n) && !SIZE_VALUE.test(value)) return 'colour';
  return 'other';
}

// One token keeps one role across its light and dark values: the dark --surface: var(--dark-surface) is a colour
// because the light --surface: #fff is.
function withRoles(tokens) {
  const roles = new Map();
  for (const t of tokens) {
    const role = categorize(t.name, t.value);
    if (!roles.has(t.name) || roles.get(t.name) === 'other') roles.set(t.name, role);
  }
  return tokens.map((t) => ({ ...t, category: roles.get(t.name) }));
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith('.')) yield* walk(join(dir, entry.name));
    } else if (entry.isFile()) yield join(dir, entry.name);
  }
}

// In a git repo, git names the files: tracked ones and untracked ones it does not ignore, so a gitignored credential
// file is never read. Outside git, the walk stands in. Hidden folders, such as a worktree under .claude, and the
// folders in SKIPPED_DIRS are skipped in both. A file is read only when it is a regular file whose real path is inside
// the repo, so neither a linked file nor a linked folder brings outside content in.
function repoFiles(root) {
  let listed;
  try {
    listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
  } catch {
    if (inGitRepo(root)) throw new Error(`git could not list the files in ${root}, so the script stopped rather than read files git ignores. Make git run there (for a dubious-ownership refusal, add the repo to safe.directory) and run the script again.`);
    return [...walk(root)];
  }
  return listed.split('\0').filter((rel) => {
    const folders = rel.split('/').slice(0, -1);
    return rel && !folders.some((f) => SKIPPED_DIRS.has(f) || f.startsWith('.'));
  }).map((rel) => join(root, rel)).filter(insideRepo(root));
}

function inGitRepo(root) {
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return true;
    if (dirname(dir) === dir) return false;
  }
}

// light-dark(#fff, #000) is a light value and a dark value on one line.
function splitLightDark(token) {
  const match = /^light-dark\((.*)\)$/.exec(token.value);
  if (!match) return [token];
  let depth = 0;
  for (let i = 0; i < match[1].length; i += 1) {
    const ch = match[1][i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      return [{ ...token, value: match[1].slice(0, i).trim(), dark: false }, { ...token, value: match[1].slice(i + 1).trim(), dark: true }];
    }
  }
  return [token];
}

function insideRepo(root) {
  const base = realpathSync(root) + sep;
  return (file) => {
    try {
      return lstatSync(file).isFile() && realpathSync(file).startsWith(base);
    } catch {
      return false;
    }
  };
}

function looksSecret(token) {
  return SECRET_NAME.test(token.name) || SECRET_VALUE.test(token.value);
}

function fileMode(name) {
  if (DARK_FILE.test(name)) return 'dark';
  if (LIGHT_FILE.test(name)) return 'light';
  return null;
}

// A stylesheet whose only theme selector is a light one, :root { dark } .light { light }, has dark as its default. The
// doc asks about it, because a light theme repeated under .light reads the same way.
function lightOnly(found, mode) {
  return !mode && found.some((t) => t.light) && !found.some((t) => t.dark);
}

// A theme selector wins over the file name; the file name sets only the values outside any theme selector.
function cssModes(found, mode) {
  const lightDefault = lightOnly(found, mode);
  const unmarked = mode ? mode === 'dark' : lightDefault;
  return found.map(({ light, ...t }) => ({ ...t, dark: t.dark || (!light && unmarked) }));
}

function readTokenJson(text) {
  const found = jsonTokens(text);
  const withheld = found.some(looksSecret);
  return withheld ? null : found;
}

function inTokenFolder(rel) {
  return rel.split('/').slice(0, -1).some((f) => TOKEN_FOLDER.test(f));
}

export function scan(root) {
  const tokens = [];
  const handRead = [];
  const unreadable = [];
  const withheld = [];
  const variables = [];
  const darkDefaults = [];
  const redacted = [];
  const maybeTokens = [];
  let focusStyle = false;
  for (const file of repoFiles(root)) {
    const rel = relative(root, file).split(sep).join('/');
    const ext = extname(file).toLowerCase();
    const name = basename(file, ext);
    if (STYLE_EXTENSIONS.has(ext)) {
      const text = readFileSync(file, 'utf8');
      const options = { lineComments: LINE_COMMENT_EXTENSIONS.has(ext) };
      if (hasFocusRule(text, options)) focusStyle = true;
      const declared = customProperties(text, options);
      const found = declared.filter((t) => !looksSecret(t));
      if (found.length < declared.length) redacted.push(rel);
      if (lightOnly(found, fileMode(name))) darkDefaults.push(rel);
      for (const t of cssModes(found, fileMode(name)).flatMap(splitLightDark)) tokens.push({ ...t, file: rel });
      if (options.lineComments && PREPROCESSOR_VARIABLE.test(blankComments(text, true))) variables.push(rel);
    } else if (ext === '.json' && TOKEN_JSON.test(name.replace(MODE_PART, ''))) {
      const mode = MODE_PART.exec(name)?.[2].toLowerCase();
      try {
        const found = readTokenJson(readFileSync(file, 'utf8'));
        if (!found) withheld.push(rel);
        else for (const t of found) tokens.push({ ...t, dark: mode ? mode === 'dark' : t.dark, file: rel });
      } catch {
        unreadable.push(rel);
      }
    } else if (HAND_READ.test(basename(file)) || (ext === '.json' && inTokenFolder(rel))) handRead.push(rel);
    else if (ext === '.json' && TOKEN_LIKE.test(name)) maybeTokens.push(rel);
  }
  tokens.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { tokens: withRoles(tokens), handRead: handRead.sort(), unreadable: unreadable.sort(), withheld: withheld.sort(), variables: variables.sort(), darkDefaults: darkDefaults.sort(), redacted: redacted.sort(), maybeTokens: maybeTokens.sort(), focusStyle };
}

function cell(entries) {
  if (!entries.length) return '';
  return entries.map((e) => `\`${e.value.replaceAll('|', '\\|')}\` (${e.file}:${e.line}${e.endLine ? `-${e.endLine}` : ''})`).join('<br>');
}

function groupByName(tokens) {
  const groups = new Map();
  for (const t of tokens) {
    if (!groups.has(t.name)) groups.set(t.name, { light: [], dark: [] });
    groups.get(t.name)[t.dark ? 'dark' : 'light'].push(t);
  }
  return groups;
}

function distinctValues(entries) {
  return new Set(entries.map((e) => e.value)).size;
}

export function openQuestions({ tokens, handRead, unreadable = [], withheld = [], variables = [], darkDefaults = [], redacted = [], maybeTokens = [], focusStyle }) {
  const questions = [];
  for (const category of CATEGORIES) {
    if (category.question && !tokens.some((t) => t.category === category.id)) questions.push(category.question);
  }
  const colours = groupByName(tokens.filter((t) => t.category === 'colour'));
  const anyDark = [...colours.values()].some((g) => g.dark.length);
  if (colours.size && !anyDark) questions.push('No dark-mode colour values were found. Does the product have a dark theme, and what are its values?');
  if (anyDark) {
    const lightOnly = [...colours].filter(([, g]) => g.light.length && !g.dark.length).map(([name]) => `\`${name}\``);
    if (lightOnly.length) questions.push(`These colour roles have no dark value: ${lightOnly.join(', ')}. Do they keep the light value in dark mode?`);
  }
  for (const [name, group] of groupByName(tokens)) {
    for (const mode of ['light', 'dark']) {
      if (distinctValues(group[mode]) > 1) questions.push(`\`${name}\` has ${distinctValues(group[mode])} different ${mode} values. Which one is the token, and where do the others apply?`);
    }
  }
  if (!focusStyle) questions.push('No `:focus` or `:focus-visible` rule was found in the stylesheets. What does keyboard focus look like?');
  for (const file of unreadable) questions.push(`\`${file}\` is not valid JSON, so its tokens were not read. Fix it or read it by hand, and add each token with its file:line.`);
  for (const file of darkDefaults) questions.push(`\`${file}\` sets values under a light theme selector and none under a dark one, so its other values are read as dark. If they are the light theme, move them to the Light column.`);
  for (const file of maybeTokens) questions.push(`\`${file}\` is named like a token file but was not read, since names like this often hold credentials. Read it only if it holds design tokens, and copy no secret.`);
  for (const file of redacted) questions.push(`\`${file}\` declares custom properties that name or hold a credential. They were left out; copy no secret into the doc.`);
  for (const file of withheld) questions.push(`\`${file}\` names or holds a credential, so it was not read. If it also holds design tokens, read those by hand and copy no secret.`);
  if (variables.length) questions.push(`These stylesheets declare Sass or Less variables, which the script does not read: ${variables.map((f) => `\`${f}\``).join(', ')}. Read them, and add each design token with its file:line.`);
  for (const file of handRead) questions.push(`\`${file}\` defines tokens the script does not read (a theme in code, indented Sass, or token JSON with another name). Read it, and add each token it defines with its file:line.`);
  return questions;
}

function tokenTable(category, tokens) {
  const groups = groupByName(tokens.filter((t) => t.category === category.id));
  if (!groups.size) return [];
  const rows = [...groups].map(([name, g]) => `| \`${name}\` | ${cell(g.light)} | ${cell(g.dark)} |`);
  return [`### ${category.title}`, '', '| Token | Light | Dark |', '|---|---|---|', ...rows, ''];
}

export function render(root, result) {
  const lines = [`# Design System: ${basename(resolve(root))}`, '', '## Tokens', ''];
  lines.push('Each value is copied from the file and line in brackets. Change a value there, not here.', '');
  for (const category of CATEGORIES) lines.push(...tokenTable(category, result.tokens));
  if (!result.tokens.length) lines.push('No tokens were found in the stylesheets or token files.', '');
  lines.push('## Open Questions', '');
  const questions = openQuestions(result);
  lines.push(...(questions.length ? questions.map((q) => `- ${q}`) : ['None.']), '');
  return lines.join('\n');
}

function main(argv) {
  const json = argv.includes('--json');
  const root = argv.find((a) => !a.startsWith('--'));
  if (!root) {
    console.error('usage: node tokens.mjs <repo folder> [--json]');
    return 2;
  }
  let result;
  try {
    result = scan(resolve(root));
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  process.stdout.write(json ? JSON.stringify({ ...result, openQuestions: openQuestions(result) }, null, 2) + '\n' : render(root, result));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
