#!/usr/bin/env node
// Static scan of source files for generated-page tells. It catches what a render cannot show, such as copy
// habits and motion values, and it points at the file and line. Adapted from taste-skill (see UPSTREAM).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { RULES } from './lib/lint-rules.mjs';

const EXT = new Set(['.html', '.htm', '.css', '.scss', '.less', '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.astro', '.mdx']);
const SKIP = new Set(['node_modules', '.git', '.next', '.nuxt', '.svelte-kit', 'dist', 'build', 'out', '.vercel', 'coverage', '.turbo', 'vendor']);
const MAX_BYTES = 4_000_000;
const TABLE_OR_FIELD = /(^|[\s,>+~(])(table|thead|tbody|tfoot|tr|td|th|input|textarea|select|fieldset)\b/i;
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|import |@import|<!--)/;

// A root is named by its folder (src), unless two roots share that name; then by its path from the cwd.
function rootLabels(roots) {
  const names = roots.map((r) => basename(resolve(r)));
  return roots.map((r, i) => (names.indexOf(names[i]) === names.lastIndexOf(names[i]) ? names[i] : relative(process.cwd(), resolve(r)) || names[i]));
}

function sourceFiles(roots) {
  const files = [];
  const skipped = [];
  const labels = rootLabels(roots);
  let root = '', label = '';
  const walk = (path) => {
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat) throw new Error(`not found: ${path}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path)) if (!SKIP.has(name) && !name.startsWith('.')) walk(join(path, name));
    } else if (EXT.has(extname(path)) && !/\.min\.|\.d\.ts$/.test(basename(path))) {
      (stat.size < MAX_BYTES ? files : skipped).push({ path, root, label });
    }
  };
  roots.forEach((r, i) => {
    root = resolve(r);
    label = labels[i];
    walk(root);
  });
  return { files, skipped };
}

// Real code may be monospace; real tables, form fields and interface fragments keep their lines; a
// screen-reader helper is not a rule; copy rules ignore comments and imports. A gradient sweeping across a
// loading label ("Thinking", a skeleton row) is a progress signal that the chat apps share, not a tell.
const LOADING = /shimmer|skeleton|loading|thinking|pending/i;
function exempt(rule, ctx) {
  if (rule.id === 'gradient-text' || rule.id === 'gradient') return LOADING.test(ctx.selector + ctx.line);
  if (rule.id === 'mono') return ctx.codeLine || /(^|[\s,>+~(])(pre|code|kbd|samp)\b|code/i.test(ctx.selector);
  if (rule.id === 'hairline' || rule.id === 'outlined-box') {
    if (TABLE_OR_FIELD.test(ctx.selector) || ctx.inUi) return true;
    return rule.id === 'hairline' && /sr-only|visually-hidden|clip(-path)?\s*:|outline/i.test(ctx.line + ctx.selector);
  }
  if (rule.id === 'shadow') return ctx.inUi;
  if (COPY_RULES.has(rule.id) || rule.id === 'cta-copy' || rule.id === 'emoji' || rule.id === 'oops-copy') return COMMENT_LINE.test(ctx.line);
  return false;
}

// In script, copy is only what reaches the screen: string literals and JSX text, never an identifier such
// as robust or leverage().
const SCRIPT = new Set(['.js', '.jsx', '.ts', '.tsx']);
const COPY_RULES = new Set(['copy', 'theater-slop-phrase']);
const shownText = (line) => [...line.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1|>([^<>{}]+)</g)].map((m) => m[2] ?? m[3]).join(' ');

// Paths read from the folder that was scanned (src/app.css), whatever directory the audit ran from.
function scanFile({ path, root, label }, rules) {
  const file = (path === root ? basename(path) : join(label, relative(root, path))).split('\\').join('/');
  const script = SCRIPT.has(extname(path));
  const findings = [];
  let inCode = false, selector = '', pending = '';
  readFileSync(path, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (line.includes('{')) { selector = pending + line.slice(0, line.indexOf('{')); pending = ''; }
    else if (!line.includes('}')) pending = `${pending} ${line}`.slice(-300);
    const inUi = /data-ui/.test(selector) || /data-ui/.test(line);
    if (line.includes('}') && !line.includes('{')) { selector = ''; pending = ''; }
    if (/<(pre|code)\b/i.test(line)) inCode = true;
    const codeLine = inCode || /<(pre|code|kbd|samp)\b/i.test(line);
    if (/<\/(pre|code)>/i.test(line)) inCode = false;
    // Minified or data lines say nothing about a design choice; a marked line was kept on purpose.
    if (line.length > 2000 || /design-audit-ignore|taste-skill-ignore/.test(line)) return;
    const ctx = { line, selector, inUi, codeLine };
    for (const rule of rules) {
      if (exempt(rule, ctx)) continue;
      const m = (script && COPY_RULES.has(rule.id) ? shownText(line) : line).match(rule.re);
      if (m) findings.push({ level: rule.level, id: rule.id, area: rule.area, file, line: i + 1, match: m[0].trim().slice(0, 70), message: rule.message });
    }
  });
  return findings;
}

export function lint(roots, { mode = 'app' } = {}) {
  const rules = RULES.filter((r) => r.modes.includes(mode));
  const { files, skipped } = sourceFiles(roots);
  return { mode, files: files.length, skipped: skipped.map((f) => f.path), findings: files.flatMap((f) => scanFile(f, rules)) };
}

function main(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { mode: { type: 'string', default: 'app' }, json: { type: 'boolean', default: false } } });
  if (!['app', 'site'].includes(values.mode)) throw new Error(`--mode "${values.mode}": use app or site`);
  const report = lint(positionals.length ? positionals : ['.'], { mode: values.mode });
  if (values.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`DESIGN LINT (${report.mode})  ${report.files} file(s)`);
    for (const f of report.findings) console.log(`${f.level} [${f.id}] ${f.file}:${f.line}  ${f.match}\n  ${f.message}`);
    if (report.skipped.length) console.log(`Skipped (over 4 MB, check by hand): ${report.skipped.join(', ')}`);
  }
  return report.findings.some((f) => f.level === 'FAIL') ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`lint: ${err.message}`);
    process.exitCode = 2;
  }
}
