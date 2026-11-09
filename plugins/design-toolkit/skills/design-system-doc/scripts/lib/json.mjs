// Reads design tokens from a JSON file with the line each value is written on. JSON.parse keeps no positions, so
// this reads the text itself; it accepts strict JSON only and throws on anything else.

class Reader {
  constructor(text) {
    this.text = text;
    this.at = 0;
    this.line = 1;
  }

  fail(what) {
    throw new SyntaxError(`${what} at line ${this.line}`);
  }

  skipSpace() {
    for (; this.at < this.text.length; this.at += 1) {
      const ch = this.text[this.at];
      if (ch === '\n') this.line += 1;
      else if (ch !== ' ' && ch !== '\t' && ch !== '\r') return;
    }
  }

  expect(ch) {
    this.skipSpace();
    if (this.text[this.at] !== ch) this.fail(`expected ${ch}`);
    this.at += 1;
  }

  string() {
    const match = /^"(?:[^"\\\n]|\\.)*"/.exec(this.text.slice(this.at));
    if (!match) this.fail('bad string');
    this.at += match[0].length;
    return JSON.parse(match[0]);
  }

  // Each node is { kind, line } plus its value: entries for an object, items for an array, value for a leaf.
  value() {
    this.skipSpace();
    const line = this.line;
    const ch = this.text[this.at];
    if (ch === '{') return { kind: 'object', line, entries: this.members('}', () => [this.key(), this.value()]) };
    if (ch === '[') return { kind: 'array', line, items: this.members(']', () => this.value()) };
    if (ch === '"') return { kind: 'leaf', line, value: this.string() };
    const match = /^(-?\d+(\.\d+)?([eE][-+]?\d+)?|true|false|null)/.exec(this.text.slice(this.at));
    if (!match) this.fail('bad value');
    this.at += match[0].length;
    return { kind: 'leaf', line, value: JSON.parse(match[0]) };
  }

  key() {
    this.skipSpace();
    const key = this.string();
    this.expect(':');
    return key;
  }

  members(close, member) {
    this.at += 1;
    const out = [];
    this.skipSpace();
    if (this.text[this.at] === close) {
      this.at += 1;
      return out;
    }
    for (;;) {
      out.push(member());
      this.skipSpace();
      const ch = this.text[this.at];
      this.at += 1;
      if (ch === close) return out;
      if (ch !== ',') this.fail(`expected , or ${close}`);
    }
  }
}

export function parseWithLines(text) {
  const reader = new Reader(text);
  const root = reader.value();
  reader.skipSpace();
  if (reader.at < text.length) reader.fail('trailing text');
  return root;
}

const MODE_GROUP = /^(light|dark)$/i;
// Style Dictionary's plain `value` wraps a token only when its siblings are metadata; otherwise `value` is a token name.
const TOKEN_META = new Set(['type', 'description', 'comment', 'attributes', 'name', 'path', 'original', 'filePath', 'isSource']);

function tokenValue(node) {
  const dollar = node.entries.find(([key]) => key === '$value');
  if (dollar) return dollar[1];
  const plain = node.entries.find(([key]) => key === 'value');
  const metaOnly = node.entries.every(([key]) => key === 'value' || key.startsWith('$') || TOKEN_META.has(key));
  return plain && metaOnly ? plain[1] : null;
}

// A DTCG dimension, {"value": 16, "unit": "px"}, is one value: 16px, cited across the lines of its value and unit.
function dimension(node) {
  if (node.entries.length !== 2) return null;
  const value = node.entries.find(([key]) => key === 'value')?.[1];
  const unit = node.entries.find(([key]) => key === 'unit')?.[1];
  if (value?.kind !== 'leaf' || typeof value.value !== 'number' || unit?.kind !== 'leaf' || typeof unit.value !== 'string') return null;
  const [line, endLine] = [Math.min(value.line, unit.line), Math.max(value.line, unit.line)];
  return { kind: 'leaf', line, ...(endLine > line && { endLine }), value: `${value.value}${unit.value}` };
}

// A light or dark key holding a group of tokens is a theme mode: it leaves the token name and sets the column. A light
// or dark key holding one value, an array, or one token object is a shade, such as primary.light, and stays in the name.
export function jsonTokens(text) {
  const found = [];
  const walk = (node, path, dark) => {
    if (node.kind === 'leaf') {
      if (typeof node.value === 'string' || typeof node.value === 'number') found.push({ name: path.join('.'), value: String(node.value), dark, line: node.line, ...(node.endLine && { endLine: node.endLine }) });
      return;
    }
    if (node.kind === 'array') {
      node.items.forEach((item, index) => walk(item, [...path, String(index)], dark));
      return;
    }
    const single = dimension(node);
    if (single) {
      walk(single, path, dark);
      return;
    }
    const wrapped = tokenValue(node);
    if (wrapped) {
      walk(wrapped, path, dark);
      return;
    }
    for (const [key, child] of node.entries) {
      if (key.startsWith('$')) continue;
      if (MODE_GROUP.test(key) && child.kind === 'object' && !tokenValue(child)) walk(child, path, dark || /^dark$/i.test(key));
      else walk(child, [...path, key], dark);
    }
  };
  walk(parseWithLines(text), [], false);
  return found;
}
