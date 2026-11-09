// A phone app may load an Artifact without its published files and may never run a lazy load, so a sheet
// shows only images it carries itself, in markup that needs no script.
const IMG_TAG = /<img\b[^>]*>/gi;
const SRC_ATTR = /\ssrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i;
const SELF_CONTAINED_SRC = /^(data:image\/|https:\/\/)/i;

export function sheetProblems(html) {
  const problems = [];
  if (/<script\b/i.test(html)) problems.push('the page has a <script>, so its images may be built by script');
  for (const tag of html.match(IMG_TAG) ?? []) {
    const found = SRC_ATTR.exec(tag);
    const src = found ? found[2] ?? found[3] ?? found[4] : '';
    if (!SELF_CONTAINED_SRC.test(src)) problems.push(`an <img> has src "${src.slice(0, 80)}", which is not a data URI or an https URL`);
    if (/\sloading\s*=\s*["']?lazy/i.test(tag)) problems.push(`an <img> loads lazily: ${tag.slice(0, 80)}`);
  }
  return problems;
}
