// Page setup shared by capture.mjs and the ui-inspect skill, so a measured check sees the same page as the shot.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Page, sleep } from './cdp.mjs';

export const VIEWPORTS = { desktop: { width: 1280, height: 800 }, narrow: { width: 400, height: 800 } };
const FREEZE_CSS = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';

export function parseViewport(spec) {
  if (VIEWPORTS[spec]) return { name: spec, ...VIEWPORTS[spec] };
  const m = /^(\d+)x(\d+)$/.exec(spec);
  if (!m) throw new Error(`viewport "${spec}": use desktop, narrow, or WIDTHxHEIGHT`);
  return { name: spec, width: Number(m[1]), height: Number(m[2]) };
}

export function parseTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') throw new Error(`theme "${theme}": use light or dark`);
  return theme;
}

export function toUrl(target) {
  // A one-letter scheme is a Windows drive (C:\...), not a URL.
  return /^[a-z][a-z0-9+.-]+:/i.test(target) ? target : pathToFileURL(resolve(target)).href;
}

// A theme toggle saves its choice to storage, which pages in one browser context share, so each page gets
// its own context and a dark shot cannot turn the next light shot dark.
export async function openPage(browser, { width, height, dsf }) {
  const { browserContextId } = await browser.send('Target.createBrowserContext');
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(browser, targetId, sessionId);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.setViewport({ width, height, dsf });
  page.close = () => browser.send('Target.disposeBrowserContext', { browserContextId }, undefined, 5000).catch(() => {});
  return page;
}

async function waitForSelector(page, selector, option, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.eval((s) => !!document.querySelector(s), selector)) return;
    await sleep(100);
  }
  throw new Error(`${option} "${selector}" did not appear within ${timeoutMs}ms`);
}

// The app's own control switches the theme, so the page runs its own code and nothing is forced on it.
async function clickToggles(page, selectors) {
  for (const selector of selectors) {
    await waitForSelector(page, selector, '--theme-toggle');
    await page.eval((s) => document.querySelector(s).click(), selector);
    await settleFrame(page);
  }
}

// Two animation frames plus font readiness: the page is read only after a real paint of the final layout.
function settleFrame(page) {
  return page.eval(() => document.fonts.ready.then(() => new Promise((done) => {
    requestAnimationFrame(() => requestAnimationFrame(done));
  })));
}

// `look` is how to reach a colour mode: the colour scheme to request, and whether to click the app's toggle.
export async function preparePage(page, opts, look) {
  await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: look.scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  if (opts.cookies) await page.send('Network.setCookies', { cookies: opts.cookies });
  await page.goto(opts.url, { settleMs: 0 });
  await page.eval((css) => document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css })), FREEZE_CSS);
  if (opts.waitFor) await waitForSelector(page, opts.waitFor, '--wait-for');
  if (look.toggle) await clickToggles(page, opts.themeToggles);
  // Script-driven states leave focus where the script put it, drawing a ring a person never sees.
  if (opts.blur) await page.eval(() => document.activeElement && document.activeElement.blur());
  await sleep(opts.settleMs);
  await settleFrame(page);
}
