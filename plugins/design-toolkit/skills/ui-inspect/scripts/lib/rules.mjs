// Adapted from taste-skill scripts/lib/rules.mjs (MIT, see LICENSE and UPSTREAM). The marketing rules
// (picture and motion counts, eyebrows, gradients, palettes) are gone; an app screen keeps the rest.
//
// FAIL: the screen is broken for a person using it. WARN: usually wrong; keep it only with a reason.

export const RULE_IDS = ['overflow', 'clipped-text', 'covered-text', 'contrast', 'font-fallback', 'broken-image', 'small-text', 'size-count', 'measure', 'font-count', 'side-scroll', 'optical-align'];

export function judge(m, frames, { allow = [] } = {}) {
  const out = [];
  // items: the measured elements behind a finding; their paths become "selectors", ready for --ignore.
  const add = (level, id, message, fix, items = []) => {
    if (allow.includes(id)) return;
    const selectors = [...new Set(items.map((i) => i.at).filter(Boolean))];
    out.push({ level, id, message, fix, ...(selectors.length && { selectors }) });
  };
  const named = (item) => `"${item.text}" (${item.at})`;
  const narrow = m.viewport.w < 600;
  const quote = (list, n, fmt) => list.slice(0, n).map(fmt).join('; ') + (list.length > n ? `; and ${list.length - n} more` : '');

  if (m.page.horizontalOverflow) add('FAIL', 'overflow', `The page scrolls sideways by ${m.page.horizontalOverflow}px.${m.page.overflowCulprits.length ? ' Widest: ' + m.page.overflowCulprits.join(', ') + '.' : ''}`,
    'Constrain the element that is wider than the viewport (max-width: 100%, min-width: 0 on a flex or grid child, or overflow: clip on its container).');
  if (m.page.brokenImages.length) add('FAIL', 'broken-image', 'Broken image(s): ' + quote(m.page.brokenImages, 4, (src) => src), 'Fix the URL or the asset, or render a placeholder when the source fails.');

  // Keyed by element and text, so the same words in two places stay two items.
  const byText = (key) => [...new Map(frames.flatMap((f) => f[key].map((c) => [`${c.at}|${c.text}`, c]))).values()];
  const covered = byText('covered');
  if (covered.length) add('FAIL', 'covered-text', 'Text lies under another element: ' + quote(covered, 4, (c) => `${named(c)}, ${Math.round(c.share * 100)}% hidden`),
    'Give the covering element its own space in the layout, or raise the text above it with a z-index and a solid ground.', covered);
  const clipped = byText('clipped');
  if (clipped.length) add('FAIL', 'clipped-text', 'Text is cut off by the box that holds it, with no ellipsis: ' + quote(clipped, 4, named),
    'Let the box grow with its text, wrap it, or truncate on purpose with text-overflow: ellipsis or a line clamp and a title for the full text.', clipped);

  const veryLow = m.lowContrast.filter((c) => c.ratio < 3);
  const low = m.lowContrast.filter((c) => c.ratio >= 3);
  if (veryLow.length) add('FAIL', 'contrast', 'Text a person cannot read: ' + quote(veryLow, 4, (c) => `${named(c)} ${c.ratio}:1, ${c.fg} on ${c.bg}`), 'Raise contrast to at least 4.5:1 for text, 3:1 for large text.', veryLow);
  if (low.length) add('WARN', 'contrast', 'Low-contrast text: ' + quote(low, 4, (c) => `${named(c)} ${c.ratio}:1, needs ${c.need}:1`), 'Darken or lighten the text colour for this theme.', low);

  const families = m.type.families.filter((f) => f.share >= 0.02);
  if (families.length > 3) add('FAIL', 'font-count', `${families.length} typefaces in use (${families.map((f) => f.family).join(', ')}).`, 'An app screen needs one text face, and at most one more for code or display.');
  else if (families.length === 3) add('WARN', 'font-count', `3 typefaces in use (${families.map((f) => f.family).join(', ')}).`, 'Two at most.');
  if (m.type.notLoaded.length) add('WARN', 'font-fallback', `Typeface(s) not loaded, so a fallback renders: ${m.type.notLoaded.join(', ')}`, 'Fix the font URL or family name, or the shots show a face the app does not ship.');
  if (m.type.sizeCount > 9) add('WARN', 'size-count', `${m.type.sizeCount} font sizes (${m.type.sizes.join(', ')} px).`, 'Map each size onto the type scale; an app screen needs about six.');
  if (m.type.small.length) add('WARN', 'small-text', `${m.type.small.length} text element(s) under 12px: ` + quote(m.type.small, 3, (t) => `${named(t)} ${t.size}px`), 'Nothing meant to be read goes below 12px.', m.type.small);
  if (!narrow && m.type.measureChars > 88) add('WARN', 'measure', `The longest paragraph runs about ${m.type.measureChars} characters per line.`, 'Cap running text at 45 to 75 characters (max-width: 65ch).');
  const off = m.alignment.off;
  if (off.length) add('FAIL', 'optical-align', 'Icon off the middle of the text beside it: ' + quote(off, 4, (o) => `${named(o)} ${Math.abs(o.gap)}px ${o.gap > 0 ? 'low' : 'high'} against the ${o.centre.replace('-', ' ')}`),
    'Move the icon (a translate on the icon or its wrapper) until its middle meets the middle of the letters. For an icon meant to centre on another height, add an exception to .design-toolkit.json.', off);
  if (m.page.sideScrollers) add('WARN', 'side-scroll', `${m.page.sideScrollers} row(s) scroll sideways with content past their edge.`, 'Wrap the row, or show that it scrolls (a fade or a partial item). Mark a deliberate scroller with data-scroll-x.');
  return out;
}

// One finding per rule, level, and message; the viewports and themes it appeared at are listed in "where".
// A message that differs (another element, another ratio) stays its own finding, so no evidence is dropped.
export function merge(findings) {
  const merged = [];
  for (const f of findings) {
    const same = merged.find((x) => x.id === f.id && x.level === f.level && x.message === f.message);
    if (same) { if (!same.where.includes(f.where)) same.where.push(f.where); continue; }
    merged.push({ ...f, where: [f.where] });
  }
  return merged.sort((a, b) => (a.level === b.level ? 0 : a.level === 'FAIL' ? -1 : 1));
}
