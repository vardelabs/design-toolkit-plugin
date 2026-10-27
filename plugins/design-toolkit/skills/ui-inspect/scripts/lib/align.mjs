import { inflateSync } from 'node:zlib';

// Text and icons snap to the device pixel grid, so page geometry (boxes and font metrics) can disagree
// with the ink by up to a pixel, in a way that changes with where the row lands. Geometry only pairs each
// icon with a letter beside it; the gap is read from the ink in a screenshot of the pair.
//
// findPairs and locatePair run INSIDE the page (serialised through cdp.mjs), so each stays self-contained:
// no imports, no closures over module scope.

const PAIRS = '__designToolkitAlignPairs';

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
  const firstText = (el) => document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (t) => (t.textContent.trim() ? 1 : 3) }).nextNode();
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
      if (sibling.nodeType === 3 && sibling.textContent.trim()) return sibling;
      if (sibling.nodeType !== 1 || !shown(sibling)) continue;
      if (stacked(sibling)) return null;
      const text = firstText(sibling);
      if (text) return text;
    }
    return null;
  };
  const centreFor = (icon) => exceptions.find((e) => icon.closest(e.selector))?.centre ?? 'cap-height';

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
    pairs.push({ icon, letter, report: { text: text.textContent.trim().slice(0, 40), at: pathOf(item), centre } });
  }
  window[key] = pairs;
  return pairs.map((p) => p.report);
}

// Brings a pair on screen and returns the clip that holds both, in document CSS px, and the column band of
// each inside that clip, in image px.
function locatePair({ key, index }) {
  const { icon, letter } = window[key][index];
  icon.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const a = icon.getBoundingClientRect();
  const l = letter.getBoundingClientRect();
  const left = Math.floor(Math.min(a.left, l.left));
  const top = Math.floor(Math.min(a.top, l.top)) - 2;
  const right = Math.ceil(Math.max(a.right, l.right));
  const bottom = Math.ceil(Math.max(a.bottom, l.bottom)) + 2;
  const dpr = devicePixelRatio;
  // A letter's box holds its side bearings, where a kerned neighbour's ink can reach.
  const inset = l.width * 0.15;
  const band = (from, to) => [Math.round((from - left) * dpr), Math.round((to - left) * dpr)];
  return {
    clip: { x: left + scrollX, y: top + scrollY, width: right - left, height: bottom - top },
    bands: [band(a.left, a.right), band(l.left + inset, l.right - inset)],
    dpr,
  };
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

export async function alignment(page, { ignore, exceptions }) {
  const pairs = await page.eval(findPairs, { ignore, exceptions, key: PAIRS });
  const off = [];
  for (const [index, pair] of pairs.entries()) {
    const { clip, bands, dpr } = await page.eval(locatePair, { key: PAIRS, index });
    const image = decodePng(await page.screenshot({ format: 'png', clip }));
    const [icon, letter] = bands.map((band) => inkMiddle(image, band));
    if (icon === null || letter === null) continue;
    const gap = (icon - letter) / dpr;
    if (Math.abs(gap) >= 0.75) off.push({ ...pair, gap: Math.round(gap * 100) / 100 });
  }
  await page.eval((key) => { delete window[key]; window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, PAIRS);
  return { off };
}
