import { inflateSync } from 'node:zlib';

// Text and icons snap to the device pixel grid, so page geometry (boxes and font metrics) can disagree
// with the ink by up to a pixel, in a way that changes with where the row lands. Geometry only pairs each
// icon with a letter beside it; the gap is read from the ink in a screenshot of the pair. An icon-only
// control with no letter to pair is held to the middle of the controls beside it, whose boxes, snapped to
// the device grid, are what the eye lines it up with.
//
// findPairs and locatePair run INSIDE the page (serialised through cdp.mjs), so each stays self-contained:
// no imports, no closures over module scope.

const PAIRS = '__designToolkitAlignPairs';
const BADGE = 'data-design-toolkit-badge';

// exceptions: [{ selector, centre }], where centre names the letter height an icon centres on instead.
function findPairs({ ignore, exceptions, key }) {
  // Letters whose ink runs flat from the baseline to the cap or x height; a round letter overshoots both.
  const FLAT = { 'cap-height': /[BDEFHIKLMNPRTVWXZ]/, 'x-height': /[mnruvwxz]/ };
  const pathOf = (el) => {
    const parts = [];
    for (let p = el; p && p !== document.body && parts.length < 3; p = p.parentElement) {
      const classes = [...p.classList].slice(0, 2).map((c) => '.' + CSS.escape(c)).join('');
      parts.unshift(p.tagName.toLowerCase() + classes);
    }
    return parts.join(' > ');
  };
  const shown = (el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  // Words a person sees. An svg's title and a screen-reader label in a 1px box name a control but show
  // nothing, so neither pairs with an icon, and a control that holds only those is icon-only.
  const seenText = (t) => {
    const holder = t.parentElement;
    if (!t.textContent.trim() || holder.closest('svg') || !shown(holder)) return false;
    const box = holder.getBoundingClientRect();
    return box.width > 1 && box.height > 1;
  };
  const firstText = (el) => document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (t) => (seenText(t) ? 1 : 3) }).nextNode();
  const holdsOnly = (wrapper, child) => [...wrapper.childNodes].every((n) => n === child || (n.nodeType === 3 && !n.textContent.trim()) || n.nodeType === 8);
  // A wrapper that holds only the icon (a grid cell, a button) is the item the row lays out.
  const itemOf = (icon) => {
    let item = icon;
    while (item.parentElement && item.parentElement !== document.body && holdsOnly(item.parentElement, item)) item = item.parentElement;
    return item;
  };
  // An icon taken out of flow (a badge laid over its wrapper) is placed on purpose, not by the row.
  const outOfFlow = (icon, item) => {
    for (let el = icon; el !== item.parentElement; el = el.parentElement) {
      if (/absolute|fixed/.test(getComputedStyle(el).position)) return true;
    }
    return false;
  };
  const isRow = (el) => {
    const cs = getComputedStyle(el);
    return cs.display.includes('grid') || (cs.display.includes('flex') && !cs.flexDirection.startsWith('column'));
  };
  // A two-line block (a name over its detail) centres as a block, not on its first line.
  const stacked = (el) => el.getBoundingClientRect().height > 2.2 * parseFloat(getComputedStyle(el).fontSize);
  const textBeside = (row, item) => {
    for (const sibling of row.childNodes) {
      if (sibling === item) continue;
      if (sibling.nodeType === 3 && seenText(sibling)) return sibling;
      if (sibling.nodeType !== 1 || !shown(sibling)) continue;
      if (stacked(sibling)) return null;
      const text = firstText(sibling);
      if (text) return text;
    }
    return null;
  };
  const centreFor = (icon) => exceptions.find((e) => icon.closest(e.selector))?.centre ?? 'cap-height';
  const CONTROL = 'button, a[href], [role="button"], input:not([type="hidden"]), select';
  const middleOf = (r) => r.top + r.height / 2;
  const worded = (el) => el.matches('input, select') || !!firstText(el);
  // The controls a row lays out beside an item, by their own box. Controls that hold words set the line
  // when there are any; a row of icons alone is held to all of them.
  const controlsBeside = (row, item) => {
    const own = middleOf(item.getBoundingClientRect());
    const controls = [...row.children].filter((sibling) => {
      if (sibling === item || !shown(sibling) || /absolute|fixed/.test(getComputedStyle(sibling).position)) return false;
      if (!sibling.matches(CONTROL) && !sibling.querySelector(CONTROL)) return false;
      const box = sibling.getBoundingClientRect();
      return box.height >= 8 && box.height <= 64 && Math.abs(middleOf(box) - own) <= 14;
    });
    const withWords = controls.filter(worded);
    return withWords.length ? withWords : controls;
  };
  const iconOnly = (control) => {
    if (worded(control)) return null;
    const icons = [...control.querySelectorAll('svg, img')].filter((el) => !el.parentElement.closest('svg') && shown(el));
    return icons.length === 1 ? icons[0] : null;
  };

  const pairs = [];
  for (const icon of document.body.querySelectorAll('svg, img, canvas')) {
    if (icon.parentElement.closest('svg') || (ignore && icon.closest(ignore)) || !shown(icon)) continue;
    const box = icon.getBoundingClientRect();
    if (box.height < 8 || box.height > 28) continue;
    const item = itemOf(icon);
    const row = item.parentElement;
    if (!row || !isRow(row) || outOfFlow(icon, item)) continue;
    const text = textBeside(row, item);
    if (!text) continue;
    const centre = centreFor(icon);
    const at = text.textContent.search(FLAT[centre]);
    if (at < 0) continue;
    const letter = document.createRange();
    letter.setStart(text, at);
    letter.setEnd(text, at + 1);
    const line = letter.getBoundingClientRect();
    // Text more than a line away from the icon is another row of a grid, not the icon's label.
    if (Math.abs(line.top + line.height / 2 - (box.top + box.height / 2)) > 14) continue;
    pairs.push({ icon, letter, row, report: { text: text.textContent.trim().slice(0, 40), at: pathOf(item), centre } });
  }
  const paired = new Set(pairs.map((p) => p.icon));
  for (const control of document.body.querySelectorAll(CONTROL)) {
    if ((ignore && control.closest(ignore)) || !shown(control)) continue;
    const icon = iconOnly(control);
    if (!icon || paired.has(icon)) continue;
    const item = itemOf(control);
    const row = item.parentElement;
    if (!row || !isRow(row) || outOfFlow(control, item)) continue;
    const neighbours = controlsBeside(row, item);
    if (!neighbours.length) continue;
    const name = control.getAttribute('aria-label') || control.title || icon.getAttribute('alt') || 'icon';
    pairs.push({ icon, neighbours, row, control, report: { text: name.trim().slice(0, 40), at: pathOf(item), centre: 'controls' } });
  }
  window[key] = pairs;
  return pairs.map((p) => p.report);
}

// Brings a pair on screen and returns the clip that holds both, in document CSS px, and the column band of
// each inside that clip, in image px. For an icon held to its neighbours' boxes, the second entry is
// instead the middle row of those boxes in the clip, in image px. Returns null when another layer lies over
// the pair.
function locatePair({ key, index, badge }) {
  const { icon, letter, neighbours, row, control } = window[key][index];
  icon.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const a = icon.getBoundingClientRect();
  const others = (neighbours ?? [letter]).map((el) => el.getBoundingClientRect());
  // A layer that paints over the row (a dialog's scrim, often blurred, or a pinned bar) puts its own pixels
  // in the screenshot, so the ink read there is not the icon's. A transparent layer, such as a stretched
  // link, changes no pixel, and neither does a closed dialog left in the page at zero opacity. Hit-testing
  // skips pointer-events: none, which would let a scrim that ignores the pointer pass as clear.
  const swatch = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const alpha = (colour) => { swatch.clearRect(0, 0, 1, 1); swatch.fillStyle = colour; swatch.fillRect(0, 0, 1, 1); return swatch.getImageData(0, 0, 1, 1).data[3] / 255; };
  const seen = (el) => {
    let opacity = 1;
    for (let p = el; p; p = p.parentElement) opacity *= +getComputedStyle(p).opacity;
    return opacity > 0.05;
  };
  const range = document.createRange();
  // Text paints only where its letters are, not across its element's box.
  const textAt = (el, x, y) => [...el.childNodes].some((n) => {
    if (n.nodeType !== 3 || !n.nodeValue.trim()) return false;
    range.selectNodeContents(n);
    return [...range.getClientRects()].some((r) => x >= r.left && x < r.right && y >= r.top && y < r.bottom);
  });
  const paints = (el, x, y) => seen(el) && (el.closest('svg, img, picture, canvas, video, iframe') || textAt(el, x, y)
    || [null, '::before', '::after'].some((pseudo) => {
      const cs = getComputedStyle(el, pseudo);
      return alpha(cs.backgroundColor) > 0.05 || cs.backgroundImage !== 'none' || cs.backdropFilter !== 'none';
    }));
  const underLayer = (r) => {
    const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
    for (const el of document.elementsFromPoint(x, y)) {
      if (row.contains(el)) return false;
      if (paints(el, x, y)) return true;
    }
    return true;
  };
  const hitStyle = document.head.appendChild(document.createElement('style'));
  hitStyle.textContent = '*, *::before, *::after { pointer-events: auto !important; }';
  const covered = [a, ...others].some(underLayer);
  hitStyle.remove();
  if (covered) return null;
  // A badge laid over an icon-only control (a dot, a count) paints in the icon's columns, where its ink
  // would read as the icon's. It is hidden for the shot, then shown again.
  if (control) {
    const sheet = document.head.appendChild(document.createElement('style'));
    sheet.id = badge;
    sheet.textContent = `[${badge}="self"], [${badge}]::before, [${badge}]::after { visibility: hidden !important; }`;
    for (const el of [control, ...control.querySelectorAll('*')]) {
      if (icon.contains(el)) continue;
      const placed = (pseudo) => /absolute|fixed/.test(getComputedStyle(el, pseudo).position);
      if (!el.contains(icon) && placed(null)) el.setAttribute(badge, 'self');
      else if (placed('::before') || placed('::after')) el.setAttribute(badge, 'pseudo');
    }
  }
  const all = [a, ...others];
  const left = Math.floor(Math.min(...all.map((r) => r.left)));
  const top = Math.floor(Math.min(...all.map((r) => r.top))) - 2;
  const right = Math.ceil(Math.max(...all.map((r) => r.right)));
  const bottom = Math.ceil(Math.max(...all.map((r) => r.bottom))) + 2;
  const dpr = devicePixelRatio;
  const band = (from, to) => [Math.round((from - left) * dpr), Math.round((to - left) * dpr)];
  const clip = { x: left + scrollX, y: top + scrollY, width: right - left, height: bottom - top };
  if (neighbours) {
    const middles = others.map((r) => (Math.round((r.top - top) * dpr) + Math.round((r.bottom - top) * dpr)) / 2).sort((p, q) => p - q);
    const half = middles.length >> 1;
    const middle = middles.length % 2 ? middles[half] : (middles[half - 1] + middles[half]) / 2;
    return { clip, bands: [band(a.left, a.right)], middle, dpr };
  }
  // A letter's box holds its side bearings, where a kerned neighbour's ink can reach.
  const [l] = others;
  const inset = l.width * 0.15;
  return { clip, bands: [band(a.left, a.right), band(l.left + inset, l.right - inset)], dpr };
}

// Chrome's screenshots are 8-bit RGB or RGBA, non-interlaced. They are decoded here, outside the page, so
// no page policy (a CSP without data: images) or page script can stop the read.
function decodePng(base64) {
  const png = Buffer.from(base64, 'base64');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const channels = { 2: 3, 6: 4 }[png[25]];
  if (png[24] !== 8 || !channels || png[28] !== 0) throw new Error('optical-align: unexpected screenshot format');
  const chunks = [];
  for (let at = 8; at < png.length; at += 12 + png.readUInt32BE(at)) {
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + png.readUInt32BE(at)));
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = x >= channels && y ? pixels[(y - 1) * stride + x - channels] : 0;
      pixels[y * stride + x] = (line[x] + unfilter(filter, left, up, upLeft)) & 255;
    }
  }
  return { width, height, channels, pixels };
}

function unfilter(filter, left, up, upLeft) {
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return (left + up) >> 1;
  if (filter !== 4) return 0;
  const p = left + up - upLeft;
  const [dl, du, dul] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
  return dl <= du && dl <= dul ? left : du <= dul ? up : upLeft;
}

// The middle of the ink in a column band, in image px. The ground is the commonest colour on the band's
// top and bottom rows, which the clip's padding keeps clear of both boxes: inside them, a solid icon can
// outnumber its ground. A pixel is ink when it is at least half way from the ground to the band's most
// distant colour, so an anti-aliased edge counts by its coverage.
function inkMiddle({ width, height, channels, pixels }, [x0, x1]) {
  const columns = [];
  for (let x = Math.max(0, x0); x < Math.min(width, Math.max(x0 + 1, x1)); x++) columns.push(x);
  if (!columns.length) return null;
  const at = (x, y) => (y * width + x) * channels;
  const counts = new Map();
  for (const y of [0, height - 1]) {
    for (const x of columns) {
      const i = at(x, y);
      const colour = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
      counts.set(colour, (counts.get(colour) ?? 0) + 1);
    }
  }
  const ground = [...counts].sort((p, q) => q[1] - p[1])[0][0];
  const distance = (i) => Math.abs(pixels[i] - (ground >> 16)) + Math.abs(pixels[i + 1] - ((ground >> 8) & 255)) + Math.abs(pixels[i + 2] - (ground & 255));
  let far = 0;
  for (let y = 0; y < height; y++) for (const x of columns) far = Math.max(far, distance(at(x, y)));
  if (far < 48) return null;
  const inkRows = [];
  for (let y = 0; y < height; y++) if (columns.some((x) => distance(at(x, y)) >= far / 2)) inkRows.push(y);
  return (inkRows[0] + inkRows[inkRows.length - 1] + 1) / 2;
}

function showBadges(badge) {
  document.getElementById(badge)?.remove();
  for (const el of document.querySelectorAll(`[${badge}]`)) el.removeAttribute(badge);
}

export async function alignment(page, { ignore, exceptions }) {
  const pairs = await page.eval(findPairs, { ignore, exceptions, key: PAIRS });
  const off = [];
  for (const [index, pair] of pairs.entries()) {
    const located = await page.eval(locatePair, { key: PAIRS, index, badge: BADGE });
    if (!located) continue;
    const { clip, bands, middle, dpr } = located;
    const image = decodePng(await page.screenshot({ format: 'png', clip }));
    await page.eval(showBadges, BADGE);
    const [icon, letter = middle] = bands.map((band) => inkMiddle(image, band));
    if (icon === null || letter === null) continue;
    const gap = (icon - letter) / dpr;
    if (Math.abs(gap) >= 0.75) off.push({ ...pair, gap: Math.round(gap * 100) / 100 });
  }
  await page.eval((key) => { delete window[key]; window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, PAIRS);
  return { off };
}
