#!/usr/bin/env node
// Renders a filled sheet in headless Chrome and writes it as static HTML: every shot inlined, no script,
// and the capture time read from the shots on disk.
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fill } from './fill.mjs';
import { launchBrowser, useBundledChromiumIfNeeded } from './lib/launch-browser.mjs';
import { toUrl } from './lib/page.mjs';
import { sheetProblems } from './lib/sheet-check.mjs';

// An Artifact page may be 16 MB. A baked page past 12 MB moves its shots to the asset store, so a later round
// that adds shots still fits. The limit applies to the baked page, because the template shows one shot in
// several places.
export const PAGE_LIMIT_BYTES = 12 * 1024 * 1024;
const BLOCK = /<script type="application\/json" id="sheet-data">([\s\S]*?)<\/script>/;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
// The skill puts every shot under shots/, so prose that names an image file is not read from disk.
const SHOT_PATH = /^shots\/\S+\.(png|jpe?g|webp)$/i;

export function shotPaths(value, found = new Set()) {
  if (typeof value === 'string' && SHOT_PATH.test(value)) found.add(value);
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => shotPaths(v, found));
  return found;
}

export function capturedAt(files, zone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const newest = new Date(Math.max(...files.map((file) => statSync(file).mtimeMs)));
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23', timeZoneName: 'short',
  }).formatToParts(newest).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${parts.timeZoneName}`;
}

function inlineSources(paths, sheetDir) {
  return Object.fromEntries(paths.map((path) => {
    const bytes = readFileSync(resolve(sheetDir, path));
    return [path, `data:${MIME[extname(path).toLowerCase()]};base64,${bytes.toString('base64')}`];
  }));
}

export function chooseSources(paths, sheetDir, assets) {
  if (assets) {
    const missing = paths.filter((path) => !assets[path]);
    if (missing.length) throw new Error(`--assets has no URL for: ${missing.join(', ')}`);
    return Object.fromEntries(paths.map((path) => [path, assets[path]]));
  }
  return inlineSources(paths, sheetDir);
}

export function pageSizeProblem(html, usedAssets) {
  const bytes = Buffer.byteLength(html);
  if (bytes <= PAGE_LIMIT_BYTES) return null;
  const size = `the baked sheet is ${Math.round(bytes / 1048576)} MB, over the ${PAGE_LIMIT_BYTES / 1048576} MB limit`;
  return usedAssets ? `${size} with every shot on the asset store. Split it into two sheets.`
    : `${size}. Upload the shots to the Artifact's asset store, write a JSON map of shot path to asset URL, and `
      + 'pass it with --assets.';
}

// Runs in the page after the template has rendered.
function staticPage(sources) {
  for (const img of document.images) {
    img.removeAttribute('loading');
    img.src = sources[img.getAttribute('src')] ?? img.getAttribute('src');
    const button = img.parentElement;
    if (button && button.tagName === 'BUTTON') button.replaceWith(img);
  }
  document.querySelectorAll('script, dialog').forEach((node) => node.remove());
  const styles = [...document.querySelectorAll('style')].filter((s) => !s.closest('main')).map((s) => s.outerHTML);
  return [document.querySelector('title')?.outerHTML ?? '', ...styles, document.querySelector('main').outerHTML].join('\n');
}

async function render(page, url) {
  await page.goto(url, { settleMs: 0 });
  return page.eval(() => Promise.all([...document.images].map((img) => (img.complete ? null
    : new Promise((done) => { img.onload = done; img.onerror = done; }))))
    .then(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))));
}

export async function bake(sheetFile, assets) {
  const sheetDir = dirname(resolve(sheetFile));
  const filled = readFileSync(sheetFile, 'utf8');
  const block = BLOCK.exec(filled);
  if (!block) throw new Error(`${sheetFile} has no sheet-data block; fill assets/sheet.html with fill.mjs first`);
  const data = JSON.parse(block[1]);
  const paths = [...shotPaths(data)];
  const sources = chooseSources(paths, sheetDir, assets);
  const dated = { ...data, ...(paths.length && { captured: capturedAt(paths.map((p) => resolve(sheetDir, p))) }) };
  const staging = join(sheetDir, `.bake-${process.pid}.html`);
  useBundledChromiumIfNeeded();
  const browser = await launchBrowser();
  try {
    writeFileSync(staging, fill(filled, dated));
    const page = await browser.newPage({ width: 1280, height: 800, dsf: 1 });
    await render(page, toUrl(staging));
    if (page.consoleErrors.length) throw new Error(`the sheet threw while it rendered:\n  ${page.consoleErrors.join('\n  ')}`);
    const html = await page.eval(staticPage, sources);
    const problems = sheetProblems(html);
    if (problems.length) throw new Error(`the baked sheet is not self-contained:\n  ${problems.join('\n  ')}`);
    const tooBig = pageSizeProblem(html, Boolean(assets));
    if (tooBig) throw new Error(tooBig);
    return html;
  } finally {
    await browser.close();
    rmSync(staging, { force: true });
  }
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { assets: { type: 'string' } } });
  const [sheetFile, out] = positionals;
  if (!sheetFile || !out) {
    console.error('usage: node bake-sheet.mjs <filled sheet.html> <out.html> [--assets shot-urls.json]');
    return 2;
  }
  const assets = values.assets ? JSON.parse(readFileSync(values.assets, 'utf8')) : null;
  writeFileSync(out, await bake(sheetFile, assets));
  console.log(out);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().then((code) => process.exit(code), (err) => {
    console.error(`bake-sheet: ${err.message}`);
    process.exit(1);
  });
}
