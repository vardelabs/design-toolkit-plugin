// Reads custom properties from a stylesheet with the line each is declared on.

// A selector or at-rule names a theme when a class, an attribute value, or the colour-scheme query is that theme, as in
// .dark, .theme-dark, .dark-mode, .darkMode, [data-theme="dark"], prefers-color-scheme: dark, or Tailwind v4's
// @variant dark. A component variant,
// such as .btn-dark, is not a theme, and :root:not(.dark) is not the dark theme.
const themeContext = (mode) => new RegExp(`\\.(theme[-_]?)?${mode}([-_]?(mode|theme)|Mode|Theme)?(?![\\w-])|\\[[^\\]]*=\\s*["']?${mode}["']?\\s*\\]|prefers-color-scheme\\s*:\\s*${mode}|@variant\\s+${mode}\\b`);
const DARK_CONTEXT = themeContext('dark');
const LIGHT_CONTEXT = themeContext('light');
const NEGATION = /:not\((?:[^()]|\([^()]*\))*\)/g;

export function isDarkContext(context) {
  return DARK_CONTEXT.test(context.replace(NEGATION, ''));
}

export function isLightContext(context) {
  return LIGHT_CONTEXT.test(context.replace(NEGATION, ''));
}

// Comments become spaces of the same length, so every index still points at the same line. A // comment counts
// only in SCSS and Less, and not inside a string or url(), or straight after a URL scheme, so url(http://...) and
// --site: https://x.com stay whole. A // comment inside a Sass map or a mixin's arguments is still a comment.
const URL_OPEN = /url$/i;
const URL_SCHEME = /[a-z]:$/i;

export function blankComments(text, lineComments = false) {
  const out = text.split('');
  let quote = '';
  const parens = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote || ch === '\n') quote = '';
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (let j = i; j < stop; j += 1) if (out[j] !== '\n') out[j] = ' ';
      i = stop - 1;
    } else if (lineComments && ch === '/' && text[i + 1] === '/' && !parens.at(-1) && !URL_SCHEME.test(text.slice(Math.max(0, i - 2), i))) {
      for (; i < text.length && text[i] !== '\n'; i += 1) out[i] = ' ';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') parens.push(URL_OPEN.test(text.slice(Math.max(0, i - 3), i)));
    else if (ch === ')') parens.pop();
  }
  return out.join('');
}

// A value written over several lines reads as one line; the spaces inside a quoted string, such as a font name, stay.
function collapseSpace(value) {
  return value.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\s+/g, (match, quoted) => quoted ?? ' ');
}

const QUOTED = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

// Index just past the brace that closes the one at `open`.
function closingBrace(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return i + 1;
  }
  return source.length;
}

export function customProperties(text, { lineComments = false } = {}) {
  const source = blankComments(text, lineComments);
  const found = [];
  const contexts = [];
  let start = 0;
  let quote = '';
  let depth = 0;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    // Sass interpolation, #{$ink}, and Less interpolation, @{ink}, are part of the value, not a block.
    if ((ch === '#' || ch === '@') && source[i + 1] === '{') {
      i = closingBrace(source, i + 1) - 1;
      continue;
    }
    // A semicolon or brace inside a string or url() is part of the value, not the end of a declaration.
    if (depth > 0 || (ch !== '{' && ch !== '}' && ch !== ';')) continue;
    const chunk = source.slice(start, i);
    if (ch === '{') contexts.push(chunk.trim());
    else {
      const declaration = /^\s*(--[\p{L}\p{N}_-]+)\s*:\s*([\s\S]+?)\s*$/u.exec(chunk);
      if (declaration) {
        const offset = start + chunk.indexOf(declaration[1]);
        const valueStart = start + chunk.indexOf(declaration[2], chunk.indexOf(':'));
        const line = lineAt(source, offset);
        const endLine = lineAt(source, valueStart + declaration[2].length);
        found.push({ name: declaration[1], value: collapseSpace(declaration[2]), dark: contexts.some(isDarkContext), line, ...(endLine > line && { endLine }), ...(contexts.some(isLightContext) && { light: true }) });
      }
      if (ch === '}') contexts.pop();
    }
    start = i + 1;
  }
  return found;
}

export function hasFocusRule(text, { lineComments = false } = {}) {
  return /:focus(-visible|-within)?\b/.test(blankComments(text, lineComments).replace(QUOTED, ''));
}
