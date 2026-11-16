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
  const hits = document.elementsFromPoint(a.left + a.width / 2, a.top + a.height / 2);
  hitStyle.remove();
  if (covered) return null;
  // A badge laid over an icon (a dot, a count) paints in the icon's columns, where its ink would read as
  // the icon's. It is hidden for the shot, then shown again. Only a placed layer that paints its own ground
  // and fills every band the shot reads (an active item's pill, a hover circle) is what the icon is read on,
  // and stays; every other placed layer is hidden. Where the box cannot be known, the layer is hidden too,
  // so a mistake hides a layer rather than leaving a badge in.
  // An icon-only control is searched inside the control, an icon beside a letter inside the item's row.
  const scope = control ?? row;
  const sheet = document.head.appendChild(document.createElement('style'));
  sheet.id = badge;
  sheet.textContent = `[${badge}="self"], [${badge}~="before"]::before, [${badge}~="after"]::after { visibility: hidden !important; }`;
  const all = [a, ...others];
  const left = Math.floor(Math.min(...all.map((r) => r.left)));
  const top = Math.floor(Math.min(...all.map((r) => r.top))) - 2;
  const right = Math.ceil(Math.max(...all.map((r) => r.right)));
  const bottom = Math.ceil(Math.max(...all.map((r) => r.bottom))) + 2;
  // The ink is read in the icon's columns, and the letter's, over the shot's full height, whose top and
  // bottom rows give the ground; a ground layer has to fill all of that.
  const sampled = [a, ...(letter ? others : [])].map((r) => ({ left: r.left, right: r.right, top, bottom }));
  // Ground is one flat colour: an image, a border, an inset shadow, an outline (which a negative offset
  // draws inside the box) or a list marker paints over part of it.
  const paintsGround = (cs) => alpha(cs.backgroundColor) > 0.05 && cs.backgroundImage === 'none' && !/inset/.test(cs.boxShadow)
    && cs.outlineStyle === 'none' && cs.display !== 'list-item';
  // Content inside a layer (a child, a digit, its own ::before or ::after) paints over its ground, so only
  // an empty layer is ground. An element that draws its own content (an image, a canvas, a form field)
  // paints over its ground with no child or text, so it is never empty.
  const bare = (el) => !el.matches('img, svg, canvas, video, iframe, object, embed, picture, input, select, textarea, meter, progress')
    && !el.firstElementChild && !el.textContent.trim()
    && ['::before', '::after'].every((pseudo) => getComputedStyle(el, pseudo).content === 'none');
  // A layer is behind the icon only when the hit test at the icon's middle reaches the icon first. A
  // pseudo-element is hit as its own element, so one drawn above the icon is never taken as behind it.
  const behindIcon = (layer) => {
    for (const hit of hits) {
      if (icon.contains(hit)) return true;
      if (hit === layer) return false;
    }
    return false;
  };
  const sides = ['Top', 'Right', 'Bottom', 'Left'];
  const borders = (cs) => sides.map((side) => parseFloat(cs[`border${side}Width`]) || 0);
  const paddings = (cs) => sides.map((side) => parseFloat(cs[`padding${side}`]) || 0);
  const shrink = (r, [top, right, bottom, left]) => ({ left: r.left + left, top: r.top + top, right: r.right - right, bottom: r.bottom - bottom });
  // Corner radii, circular and in px; a percentage or elliptical radius is not followed, so null.
  const radiiOf = (cs) => {
    const radii = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((corner) => cs[`border${corner}Radius`]);
    return radii.some((radius) => /%|\s/.test(radius.trim())) ? null : radii.map((radius) => parseFloat(radius) || 0);
  };
  // A rounded box holds a rect when the rect is inside the box and each of the rect's corners that falls
  // in a rounded corner lies within that corner's circle.
  const holds = (box, radii, r) => {
    if (r.left < box.left || r.right > box.right || r.top < box.top || r.bottom > box.bottom) return false;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    return corners.every(([sx, sy], i) => {
      const [x, y] = [sx < 0 ? r.left : r.right, sy < 0 ? r.top : r.bottom];
      const [cx, cy] = [(sx < 0 ? box.left : box.right) - sx * radii[i], (sy < 0 ? box.top : box.bottom) - sy * radii[i]];
      return (x - cx) * sx <= 0 || (y - cy) * sy <= 0 || Math.hypot(x - cx, y - cy) <= radii[i];
    });
  };
  // A box shrunk on every side by 0.293 of its largest corner radius lies inside the rounded shape.
  const rounded = (box, cs) => {
    const radii = radiiOf(cs);
    if (!radii) return null;
    const cut = 0.293 * Math.max(...radii);
    return shrink(box, [cut, cut, cut, cut]);
  };
  // The background shows inside the border, and inside the padding too for content-box; for any other
  // clip the painted box is not known.
  const paintBox = (box, cs) => {
    if (cs.backgroundClip === 'border-box' || cs.backgroundClip === 'padding-box') return shrink(box, borders(cs));
    if (cs.backgroundClip === 'content-box') return shrink(shrink(box, borders(cs)), paddings(cs));
    return null;
  };
  const masked = (cs) => cs.clipPath !== 'none' || cs.maskImage !== 'none' || cs.clip !== 'auto';
  const clips = (cs) => cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || /paint|strict|content/.test(cs.contain)
    || cs.contentVisibility !== 'visible';
  // Each ancestor that clips its overflow or contains its paint cuts the paint to its padding box. A
  // clip-path, mask or clip cuts it in a shape the box cannot follow, so the paint is not known.
  const clippedBy = (start, box) => {
    for (let p = start; p && box; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (masked(cs)) return null;
      if (!clips(cs)) continue;
      const r = p.getBoundingClientRect();
      const [left, top] = [r.left + p.clientLeft, r.top + p.clientTop];
      const inner = rounded({ left, top, right: left + p.clientWidth, bottom: top + p.clientHeight }, cs);
      box = inner && { left: Math.max(box.left, inner.left), top: Math.max(box.top, inner.top), right: Math.min(box.right, inner.right), bottom: Math.min(box.bottom, inner.bottom) };
    }
    return box;
  };
  // A layer is the ground the icon is read on when it paints a background that, once clipped, still
  // fills every sampled band from behind the icon.
  const isGround = (layer, cs, box, clipFrom) => {
    const [painted, radii] = [paintBox(box, cs), radiiOf(cs)];
    if (!paintsGround(cs) || masked(cs) || !painted || !radii) return false;
    const clipped = clippedBy(clipFrom, painted);
    return !!clipped && sampled.every((r) => holds(painted, radii, r) && holds(clipped, [0, 0, 0, 0], r)) && behindIcon(layer);
  };
  // A pseudo-element has no DOM box, so its box is read from its resolved offsets against the padding box
  // of its own positioned element. Its margins and the translation of its transform move it too; a badge is
  // often set on a corner with a negative margin or translate(50%, -50%).
  const pseudoBox = (el, cs) => {
    const base = el.getBoundingClientRect();
    const px = (name) => parseFloat(cs[name]) || 0;
    const outer = cs.boxSizing === 'border-box' ? [0, 0]
      : [px('paddingLeft') + px('paddingRight') + px('borderLeftWidth') + px('borderRightWidth'), px('paddingTop') + px('paddingBottom') + px('borderTopWidth') + px('borderBottomWidth')];
    const shift = cs.transform === 'none' ? new DOMMatrix() : new DOMMatrix(cs.transform);
    const left = base.left + el.clientLeft + px('left') + px('marginLeft') + shift.e;
    const top = base.top + el.clientTop + px('top') + px('marginTop') + shift.f;
    return { left, top, right: left + px('width') + outer[0], bottom: top + px('height') + outer[1] };
  };
  // That box holds only for an absolute pseudo of a positioned, unscrolled element, moved at most by its
  // transform's translation, inside elements that are not transformed, zoomed, filtered or given
  // perspective. Anything else could be placed against another box or scaled, so it is hidden. A placed
  // element is held to the same chain, since a transform makes its bounding box larger than its paint.
  const unmoved = (cs) => cs.translate === 'none' && cs.rotate === 'none' && cs.scale === 'none' && cs.zoom === '1';
  const flat = (cs) => cs.transform === 'none' && unmoved(cs) && cs.filter === 'none' && cs.perspective === 'none';
  const flatChain = (el) => {
    for (let p = el; p; p = p.parentElement) if (!flat(getComputedStyle(p))) return false;
    return true;
  };
  const measurable = (el, cs) => {
    if (cs.position === 'fixed' || !unmoved(cs) || getComputedStyle(el).position === 'static') return false;
    if (el.scrollLeft || el.scrollTop) return false;
    if (cs.transform !== 'none') {
      const { a, b, c, d, is2D } = new DOMMatrix(cs.transform);
      if (!is2D || a !== 1 || b !== 0 || c !== 0 || d !== 1) return false;
    }
    return flatChain(el);
  };
  const badgePseudo = (el, pseudo) => {
    const cs = getComputedStyle(el, pseudo);
    if (cs.content === 'none' || !/absolute|fixed/.test(cs.position)) return false;
    return !(cs.content === '""' && measurable(el, cs) && isGround(el, cs, pseudoBox(el, cs), el));
  };
  for (const el of [scope, ...scope.querySelectorAll('*')]) {
    if (icon.contains(el)) continue;
    const holdsPair = el.contains(icon) || (letter && el.contains(letter.startContainer));
    const cs = getComputedStyle(el);
    if (!holdsPair && /absolute|fixed/.test(cs.position) && !(bare(el) && flatChain(el) && isGround(el, cs, el.getBoundingClientRect(), el.parentElement))) {
      el.setAttribute(badge, 'self');
      continue;
    }
    // Each pseudo-element is marked on its own: an item's ::before can be its pill while its ::after is a dot.
    const marks = ['before', 'after'].filter((side) => badgePseudo(el, `::${side}`));
    if (marks.length) el.setAttribute(badge, marks.join(' '));
  }
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
