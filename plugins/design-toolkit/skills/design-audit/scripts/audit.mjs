#!/usr/bin/env node
// Gathers the evidence for a design audit: full-page shots at each viewport and theme, ui-inspect's measured
// findings, and the source linter's tells. It orders every finding by the fix order, names the shot for a
// measured finding and the file and line for a source one, then writes audit.json and card.json for
// design-spec's fill.mjs. Judging the shots is left to the
// reviewer: this script reports what can be measured and never edits the page.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { AREAS } from './lib/lint-rules.mjs';
import { lint } from './lint.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURE = join(HERE, '..', '..', 'design-spec', 'scripts', 'capture.mjs');
const INSPECT = join(HERE, '..', '..', 'ui-inspect', 'scripts', 'inspect.mjs');

// ui-inspect's rules, placed in the same fix order as the linter's.
const MEASURED_AREA = {
  overflow: 'composition', 'side-scroll': 'composition', 'clipped-text': 'composition', 'covered-text': 'composition',
  contrast: 'colour', 'broken-image': 'imagery',
  'font-fallback': 'type', 'font-count': 'type', 'size-count': 'type', 'small-text': 'type', measure: 'type',
};
const PAGE_OPTIONS = ['theme-attr', 'cookies', 'wait-for', 'settle'];

const USAGE = `usage: node audit.mjs --url <url|file> [--src dir]... [--mode app|site] [--out dir]
  [--viewport desktop|narrow|WIDTHxHEIGHT]... [--theme light|dark]...
  [--theme-attr name] [--cookies file.json] [--wait-for css] [--settle ms] [--blur] [--ignore css]...`;

function readOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      url: { type: 'string' }, src: { type: 'string', multiple: true, default: [] },
      mode: { type: 'string', default: 'app' }, out: { type: 'string' },
      viewport: { type: 'string', multiple: true, default: ['desktop', 'narrow'] },
      theme: { type: 'string', multiple: true, default: ['light', 'dark'] },
      'theme-attr': { type: 'string' }, cookies: { type: 'string' }, 'wait-for': { type: 'string' }, settle: { type: 'string' },
      blur: { type: 'boolean', default: false }, ignore: { type: 'string', multiple: true, default: [] },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help || !values.url) return null;
  if (!['app', 'site'].includes(values.mode)) throw new Error(`--mode "${values.mode}": use app or site`);
  // Never the cwd by default: an audit run from a repo must not write its shots into it.
  return { ...values, out: values.out ? resolve(values.out) : mkdtempSync(join(tmpdir(), 'design-audit-')) };
}

function pageArgs(opts) {
  const args = ['--url', opts.url];
  for (const v of opts.viewport) args.push('--viewport', v);
  for (const t of opts.theme) args.push('--theme', t);
  for (const name of PAGE_OPTIONS) if (opts[name] !== undefined) args.push(`--${name}`, opts[name]);
  if (opts.blur) args.push('--blur');
  return args;
}

function capture(opts) {
  const out = join(opts.out, 'shots');
  mkdirSync(out, { recursive: true });
  const args = [CAPTURE, ...pageArgs(opts), '--out', out, '--name', 'page', '--full-page'];
  const shots = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 24 }));
  return shots.map((s) => ({ where: `${s.viewport}/${s.theme}`, viewport: s.viewport, theme: s.theme, file: relative(opts.out, s.file).split('\\').join('/'), pageErrors: s.pageErrors }));
}

function inspect(opts) {
  const args = [INSPECT, ...pageArgs(opts), '--json', ...opts.ignore.flatMap((sel) => ['--ignore', sel])];
  const run = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 24 });
  // Exit 1 only means a FAIL was found; 2 means the run itself failed.
  if (run.status !== 0 && run.status !== 1) throw new Error(`ui-inspect failed: ${run.stderr.trim()}`);
  return JSON.parse(run.stdout);
}

function measuredFindings(report, shotsByWhere) {
  return report.findings.map((f) => ({
    source: 'measured', level: f.level, id: f.id, area: MEASURED_AREA[f.id] || 'detail', text: f.message, fix: f.fix,
    where: f.where, shots: f.where.map((w) => shotsByWhere.get(w)).filter(Boolean), ...(f.selectors && { selectors: f.selectors }),
  }));
}

// Errors the page logged while loading are a fault a person may meet, so each becomes a finding.
function pageErrorFindings(shots) {
  const byText = new Map();
  for (const s of shots) for (const e of s.pageErrors || []) {
    const text = String(e).slice(0, 160);
    if (!byText.has(text)) byText.set(text, { source: 'measured', level: 'FAIL', id: 'page-error', area: 'detail', text: `The page logged an error: ${text}`, fix: 'Fix the error, or the shots may show a broken state.', where: [], shots: [] });
    byText.get(text).where.push(s.where);
    byText.get(text).shots.push(s.file);
  }
  return [...byText.values()];
}

// One finding per rule, listing every place it occurs, so a pattern repeated fifty times is one line to fix.
// A source tell is located by file and line; many (a transition, a z-index) show in no shot at all.
function sourceFindings(report) {
  const byId = new Map();
  for (const f of report.findings) {
    const key = `${f.level} ${f.id}`;
    if (!byId.has(key)) byId.set(key, { source: 'source', level: f.level, id: f.id, area: f.area, text: f.message, places: [] });
    byId.get(key).places.push(`${f.file}:${f.line} ${f.match}`);
  }
  return [...byId.values()];
}

export function order(findings) {
  const rank = (f) => AREAS.indexOf(f.area) * 2 + (f.level === 'FAIL' ? 0 : 1);
  return [...findings].sort((a, b) => rank(a) - rank(b));
}

function cardData(opts, shots, findings, scan) {
  const fails = findings.filter((f) => f.level === 'FAIL').length;
  const scanned = scan ? ` Source scan: ${scan.files} file(s)${scan.skipped.length ? `, ${scan.skipped.length} skipped as too large` : ''}.` : ' No source was scanned.';
  const screens = [...new Set(shots.map((s) => s.viewport))].map((viewport) => ({
    label: `Whole page, ${viewport}`,
    after: Object.fromEntries(shots.filter((s) => s.viewport === viewport).map((s) => [s.theme, s.file])),
  }));
  return {
    ref: opts.url, status: `Design audit, ${opts.mode} mode`, title: 'Design Audit',
    summary: `${findings.length} findings so far (${fails} FAIL).${scanned} Add what the shots show, then fill the card.`,
    viewport: opts.viewport.join(' and '), source: 'Current state, no change applied', afterLabel: 'Current',
    captured: new Date().toISOString().slice(0, 16).replace('T', ' '), screens,
    findings: findings.map((f) => ({ level: f.level, area: f.area, id: f.id, text: f.text, fix: f.fix || '', where: f.places ? f.places.slice(0, 3).join('; ') + (f.places.length > 3 ? `; and ${f.places.length - 3} more` : '') : f.where.join(', ') })),
  };
}

function main(argv) {
  const opts = readOptions(argv);
  if (!opts) { console.log(USAGE); return 0; }
  mkdirSync(opts.out, { recursive: true });
  const shots = capture(opts);
  const shotsByWhere = new Map(shots.map((s) => [s.where, s.file]));
  const measured = measuredFindings(inspect(opts), shotsByWhere);
  const report = opts.src.length ? lint(opts.src, { mode: opts.mode }) : null;
  const scan = report && { files: report.files, skipped: report.skipped };
  const findings = order([...measured, ...pageErrorFindings(shots), ...(report ? sourceFindings(report) : [])]);
  writeFileSync(join(opts.out, 'audit.json'), JSON.stringify({ url: opts.url, mode: opts.mode, src: opts.src, scan, shots: shots.map(({ pageErrors, ...s }) => s), findings }, null, 2));
  writeFileSync(join(opts.out, 'card.json'), JSON.stringify(cardData(opts, shots, findings, scan), null, 2));
  console.log(JSON.stringify({ out: opts.out, shots: shots.length, findings: findings.length, fails: findings.filter((f) => f.level === 'FAIL').length }));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`audit: ${err.message}`);
    process.exitCode = 2;
  }
}
