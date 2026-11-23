// Finds which colour modes a page really ships, so review material never shows a theme the product lacks.
// The rendered page decides: a theme attribute in the markup, or dark rules in a framework's CSS, prove
// nothing unless something the app runs puts them in force.
import { openPage, preparePage } from './page.mjs';

const MODES = ['light', 'dark'];

// Runs in the page: the mode the page reads as, the root's own colours, and the stylesheet scan that explains
// the verdict. The mode is the ground under a grid of points, since an app may paint its theme on a wrapper
// and leave <body> white.
function modeAndScan() {
  // A computed colour keeps its own syntax (oklch, color-mix), so a canvas pixel turns each into sRGB.
  const pen = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  const toRgb = (colour) => {
    pen.clearRect(0, 0, 1, 1);
    // A colour the canvas cannot parse leaves fillStyle as it was, so start each read from transparent.
    pen.fillStyle = 'transparent';
    pen.fillStyle = colour;
    pen.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = pen.getImageData(0, 0, 1, 1).data;
    return a > 127 ? [r, g, b] : null;
  };
  const opaque = (node) => toRgb(getComputedStyle(node).backgroundColor);
  const linear = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  // The canvas takes the root's background, else <body>'s, which spreads past a short body to the whole
  // window, else the colour-scheme's default.
  const root = document.documentElement;
  const canvasIsDark = (scheme) => /\bdark\b/.test(scheme) && (!/\blight\b/.test(scheme) || matchMedia('(prefers-color-scheme: dark)').matches);
  const canvas = opaque(root) || (document.body && opaque(document.body))
    || (canvasIsDark(getComputedStyle(root).colorScheme) ? [0, 0, 0] : [255, 255, 255]);
  const groundAt = (x, y) => document.elementsFromPoint(x, y).filter((n) => n !== root && n !== document.body).map(opaque).find(Boolean) || canvas;
  const points = [0.2, 0.5, 0.8].flatMap((fx) => [0.2, 0.5, 0.8].map((fy) => groundAt(innerWidth * fx, innerHeight * fy)));
  // 0.18 is the luminance of a mid grey (L* 50).
  const darkPoints = points.filter((p) => luminance(p) < 0.18).length;
  const mode = darkPoints > points.length / 2 ? 'dark' : 'light';
  // Only <html> and <body>: their colours hold still between loads, where ads and live content do not.
  const rootPaint = [root, document.body].filter(Boolean).map((n) => {
    const style = getComputedStyle(n);
    return `${style.backgroundColor} ${style.backgroundImage} ${style.color}`;
  }).join('|');
  // How light the root's ground is: a gradient's stops where one paints over it, else the canvas colour. An
  // image the check cannot read counts as unchanged.
  const gradientStops = [root, document.body].filter(Boolean)
    .map((n) => getComputedStyle(n).backgroundImage)
    .map((image) => (/gradient\(/.test(image) ? image.match(/(?:rgba?|hsla?|oklch|oklab|lch|lab|hwb|color)\([^()]*\)/g) || [] : []))
    .find((stops) => stops.length)?.map(toRgb).filter(Boolean);
  const rootGround = gradientStops?.length ? gradientStops : [canvas];
  const rootLightness = rootGround.reduce((sum, c) => sum + luminance(c), 0) / rootGround.length;

  const dark = /prefers-color-scheme\s*:\s*dark/;
  const scan = { rules: 0, unreadable: 0 };
  const visit = (sheet) => {
    if (dark.test(sheet.media?.mediaText || '')) scan.rules++;
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      scan.unreadable++;
      return;
    }
    walk(rules);
  };
  const walk = (rules) => {
    for (const rule of rules) {
      if (rule.styleSheet) visit(rule.styleSheet);
      else if (dark.test(rule.media?.mediaText || '')) scan.rules++;
      if (rule.cssRules) walk(rule.cssRules);
    }
  };
  [...document.styleSheets].forEach(visit);
  return { mode, rootPaint, rootLightness, scan };
}

// A page can keep a dark hero over the first screen in both modes, so a root that turns darker also counts. Only
// darker: content a script swaps in after load changes the root on one load and not the other, and must never
// put a light page under the Dark label.
function turnsDarker(from, to) {
  return from.rootPaint !== to.rootPaint && to.rootLightness < from.rootLightness - 0.05;
}

async function readPage(browser, opts, viewport, look) {
  const page = await openPage(browser, { width: viewport.width, height: viewport.height, dsf: 1 });
  try {
    await preparePage(page, opts, look);
    return await page.eval(modeAndScan);
  } finally {
    await page.close();
  }
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function oneMode(only, scan) {
  const why = [`The page reads ${only} with either colour scheme requested`];
  if (scan.rules) why.push(`it has ${plural(scan.rules, 'prefers-color-scheme rule')}, and none changes it`);
  if (scan.unreadable) why.push(`${plural(scan.unreadable, 'cross-origin stylesheet')} could not be scanned`);
  return {
    modes: [only],
    looks: { [only]: { scheme: 'light' } },
    support: `${only === 'light' ? 'Dark' : 'Light'} mode: not supported`,
    detail: `${why.join('; ')}.`,
  };
}

// Returns the modes the page ships, how to reach each one, what the app supports, and the evidence.
export async function detectColorModes(browser, opts, viewport) {
  const light = await readPage(browser, opts, viewport, { scheme: 'light' });
  const dark = await readPage(browser, opts, viewport, { scheme: 'dark' });
  if (light.mode !== dark.mode || turnsDarker(light, dark)) {
    // Each mode is reached by the scheme that rendered it; with no change of mode, by the scheme's own name.
    const inverted = light.mode === 'dark' && dark.mode === 'light';
    return {
      modes: MODES,
      looks: { light: { scheme: inverted ? 'dark' : 'light' }, dark: { scheme: inverted ? 'light' : 'dark' } },
      support: 'Dark mode: follows the system setting',
      detail: 'The page changes its colours when dark is requested (prefers-color-scheme).',
    };
  }
  if (opts.themeToggles.length) {
    const toggled = await readPage(browser, opts, viewport, { scheme: 'light', toggle: true });
    const switched = light.mode === 'light'
      ? toggled.mode === 'dark' || turnsDarker(light, toggled)
      : toggled.mode === 'light' || turnsDarker(toggled, light);
    if (!switched) {
      throw new Error(`--theme-toggle ${opts.themeToggles.join(' then ')} did not change the page's colours`);
    }
    return {
      modes: MODES,
      looks: light.mode === 'light'
        ? { light: { scheme: 'light' }, dark: { scheme: 'light', toggle: true } }
        : { light: { scheme: 'light', toggle: true }, dark: { scheme: 'light' } },
      support: 'Dark mode: switched with the app\'s own control',
      detail: `--theme-toggle ${opts.themeToggles.join(' then ')} changes the page's colours.`,
    };
  }
  return oneMode(light.mode, light.scan);
}

// The themes to shoot, those asked for or else every mode the page ships, and the report the shots carry: the
// note is for the reviewer and prints on the card or sheet, the detail is for the person running the capture.
// Asking for a mode the page lacks fails, since a shot of it would show the other mode under the wrong label.
export function planColorModes(requested, detected) {
  const themes = requested ?? detected.modes;
  const missing = themes.find((t) => !detected.modes.includes(t));
  if (missing) throw new Error(`--theme ${missing}: ${detected.support}. ${detected.detail}`);
  const captured = themes.length === 1 ? `${themes[0]} only` : themes.join(' and ');
  return { themes, report: { modes: themes, note: `${detected.support}, captured ${captured}.`, detail: detected.detail } };
}
