#!/usr/bin/env node
// Headless capture, not the desktop browser pane: a hidden pane does not repaint and returns stale frames.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { cardTooTallMessage } from './lib/card-limit.mjs';
import { launchBrowser, useBundledChromiumIfNeeded } from './lib/launch-browser.mjs';
import { parseTheme, parseViewport, preparePage, toUrl } from './lib/page.mjs';

const SCALE = 2;

const USAGE = `usage: node capture.mjs --url <url|file> [--out dir] [--name base]
  [--viewport desktop|narrow|WIDTHxHEIGHT]... [--theme light|dark]...
  [--selector css]... [--margin px] [--theme-attr name] [--cookies file.json]
  [--wait-for css] [--settle ms] [--blur] [--full-page] [--card]`;

function readOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      url: { type: 'string' },
      out: { type: 'string', default: '.' },
      name: { type: 'string', default: 'shot' },
      viewport: { type: 'string', multiple: true, default: ['desktop'] },
      theme: { type: 'string', multiple: true, default: ['light', 'dark'] },
      selector: { type: 'string', multiple: true, default: [] },
      margin: { type: 'string', default: '96' },
      'theme-attr': { type: 'string' },
      cookies: { type: 'string' },
      'wait-for': { type: 'string' },
      settle: { type: 'string', default: '300' },
      blur: { type: 'boolean', default: false },
      'full-page': { type: 'boolean', default: false },
      card: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help || !values.url) return null;
  return {
    url: toUrl(values.url),
    out: resolve(values.out),
    name: values.name,
    viewports: values.viewport.map(parseViewport),
    themes: values.theme.map(parseTheme),
    selectors: values.selector,
    fullPage: values['full-page'],
    card: values.card,
    margin: Number(values.margin),
    themeAttr: values['theme-attr'],
    cookies: values.cookies ? JSON.parse(readFileSync(values.cookies, 'utf8')) : null,
    waitFor: values['wait-for'],
    settleMs: Number(values.settle),
    blur: values.blur,
  };
}

// Several selectors crop to the union of their boxes, so a menu that overflows its dialog fits without a wide margin.
async function clipFor(page, selectors, margin) {
  const found = await page.eval((list) => {
    const doc = document.documentElement;
    const boxes = list.map((s) => {
      const el = document.querySelector(s);
      if (!el) return { missing: s };
      const r = el.getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, right: r.right + scrollX, bottom: r.bottom + scrollY };
    });
    return { boxes, pageW: doc.scrollWidth, pageH: doc.scrollHeight };
  }, selectors);
  const missing = found.boxes.find((b) => b.missing);
  if (missing) throw new Error(`--selector "${missing.missing}" matched nothing`);
  const x = Math.max(0, Math.min(...found.boxes.map((b) => b.x)) - margin);
  const y = Math.max(0, Math.min(...found.boxes.map((b) => b.y)) - margin);
  const right = Math.min(found.pageW, Math.max(...found.boxes.map((b) => b.right)) + margin);
  const bottom = Math.min(found.pageH, Math.max(...found.boxes.map((b) => b.bottom)) + margin);
  return { x, y, width: right - x, height: bottom - y, scale: 1 };
}

// The document's scroll size, not <body>'s box: it holds content that overflows sideways and content
// placed outside the body.
async function fullPageClip(page) {
  const size = await page.eval(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  return { x: 0, y: 0, ...size, scale: 1 };
}

function refuseTallCard(clip, viewport) {
  const box = clip ?? viewport;
  const tooTall = cardTooTallMessage(Math.round(box.width * SCALE), Math.round(box.height * SCALE));
  if (tooTall) throw new Error(tooTall);
}

async function shoot(browser, opts, viewport, theme) {
  const page = await browser.newPage({ width: viewport.width, height: viewport.height, dsf: SCALE });
  try {
    await preparePage(page, opts, theme);
    const clip = opts.selectors.length ? await clipFor(page, opts.selectors, opts.margin) : opts.fullPage ? await fullPageClip(page) : null;
    if (opts.card) refuseTallCard(clip, viewport);
    const params = { format: 'png', captureBeyondViewport: !!clip, ...(clip && { clip }) };
    const { data } = await page.send('Page.captureScreenshot', params, 45000);
    const file = join(opts.out, `${opts.name}-${viewport.name}-${theme}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    const brokenImages = await page.eval(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')));
    return { file, viewport: viewport.name, theme, scale: SCALE, clip, brokenImages, pageErrors: page.consoleErrors };
  } finally {
    await page.close();
  }
}

async function main() {
  const opts = readOptions(process.argv.slice(2));
  if (!opts) {
    console.log(USAGE);
    return;
  }
  mkdirSync(opts.out, { recursive: true });
  useBundledChromiumIfNeeded();
  const browser = await launchBrowser();
  try {
    const results = [];
    for (const viewport of opts.viewports) {
      for (const theme of opts.themes) results.push(await shoot(browser, opts, viewport, theme));
    }
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
}

// The vendored goto leaves its 25 s load-timeout timer armed, so an exit that waits for the event loop lingers.
main().then(() => process.exit(0), (err) => {
  console.error(`capture: ${err.message}`);
  process.exit(1);
});
