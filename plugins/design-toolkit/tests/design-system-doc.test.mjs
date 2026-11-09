import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { customProperties, hasFocusRule } from '../skills/design-system-doc/scripts/lib/css.mjs';
import { jsonTokens } from '../skills/design-system-doc/scripts/lib/json.mjs';
import { categorize } from '../skills/design-system-doc/scripts/tokens.mjs';

const TESTS = dirname(fileURLToPath(import.meta.url));
const TOKENS = join(TESTS, '..', 'skills', 'design-system-doc', 'scripts', 'tokens.mjs');
const FIXTURE = join(TESTS, 'fixtures', 'design-system-doc-repo');

function copyOfFixture() {
  const repo = join(mkdtempSync(join(tmpdir(), 'design-system-doc-')), 'repo');
  cpSync(FIXTURE, repo, { recursive: true });
  return repo;
}

function designDoc(repo) {
  const run = spawnSync(process.execPath, [TOKENS, repo], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}

function citations(doc) {
  return [...doc.matchAll(/`([^`]+)` \(([^():]+):(\d+)(?:-(\d+))?\)/g)].map(([, value, file, line, endLine]) => ({ value: value.replaceAll('\\|', '|'), file, line: Number(line), endLine: Number(endLine ?? line) }));
}

test('every token in the DESIGN.md is on the source line it cites', () => {
  const repo = copyOfFixture();
  const cited = citations(designDoc(repo));
  assert.equal(cited.length, 13);
  for (const { value, file, line, endLine } of cited) {
    const sourceLine = readFileSync(join(repo, file), 'utf8').split('\n').slice(line - 1, endLine).join(' ').replace(/\s+/g, ' ');
    const asWritten = file.endsWith('.json') ? JSON.stringify(value).slice(1, -1) : value;
    assert.ok(sourceLine.includes(asWritten), `${file}:${line} does not hold ${value}: ${sourceLine}`);
  }
});

test('a dark theme value lands in the dark column', () => {
  const doc = designDoc(copyOfFixture());
  assert.match(doc, /\| `--color-bg` \| `#fafaf9` \(src\/styles\/tokens\.css:3\) \| `#1c1917` \(src\/styles\/tokens\.css:17\) \|/);
});

test('tokens in dependency folders are not the repo\'s tokens', () => {
  const repo = copyOfFixture();
  mkdirSync(join(repo, 'node_modules', 'some-lib'), { recursive: true });
  writeFileSync(join(repo, 'node_modules', 'some-lib', 'vendor.css'), ':root { --color-vendor: #ff00ff; }\n');
  assert.doesNotMatch(designDoc(repo), /--color-vendor/);
});

test('gaps in the fixture become open questions, not values', () => {
  const doc = designDoc(copyOfFixture());
  const questions = doc.split('## Open Questions')[1];
  assert.match(questions, /no dark value: `--color-accent`/);
  assert.match(questions, /`tailwind\.config\.js` defines tokens the script does not read/);
  assert.doesNotMatch(doc, /#0b5d4b/);
});

test('a repo with no tokens gets a question for each missing role and no invented value', () => {
  const repo = mkdtempSync(join(tmpdir(), 'design-system-doc-empty-'));
  writeFileSync(join(repo, 'app.css'), 'body { margin: 0; }\n');
  const doc = designDoc(repo);
  assert.equal(citations(doc).length, 0);
  for (const role of ['colour', 'type-size', 'font-family', 'spacing', 'radius']) assert.match(doc, new RegExp(`No ${role} tokens were found`));
  assert.match(doc, /No `:focus` or `:focus-visible` rule was found/);
});

test('a token declared twice with different values is asked about', () => {
  const repo = copyOfFixture();
  writeFileSync(join(repo, 'src', 'styles', 'marketing.css'), '.landing {\n  --radius-md: 12px;\n}\n');
  assert.match(designDoc(repo), /`--radius-md` has 2 different light values/);
});

test('a declaration inside a dark media query is a dark value', () => {
  const [token] = customProperties('@media (prefers-color-scheme: dark) {\n  :root { --ink: #eee; }\n}\n');
  assert.deepEqual(token, { name: '--ink', value: '#eee', dark: true, line: 2 });
});

test('a commented-out declaration is not a token', () => {
  assert.deepEqual(customProperties(':root {\n  /* --old: red; */\n  --new: blue;\n}\n').map((t) => t.name), ['--new']);
});

test('token names sort into the DESIGN.md roles', () => {
  const cases = [
    ['--color-surface', 'var(--grey-1)', 'colour'],
    ['--brand', '#123456', 'colour'],
    ['--text-color', '#111', 'colour'],
    ['--space-bg', 'oklch(20% 0 0)', 'colour'],
    ['--text-lg', '1.125rem', 'type'],
    ['--font-sans', 'Inter, sans-serif', 'font'],
    ['--font-weight-bold', '700', 'other'],
    ['--space-8', '2rem', 'spacing'],
    ['--radius-lg', '12px', 'radius'],
    ['--shadow-card', '0 1px 2px #0002', 'shadow'],
  ];
  for (const [name, value, category] of cases) assert.equal(categorize(name, value), category, name);
});

test('a token file that is not valid JSON is asked about and the rest still reads', () => {
  const repo = copyOfFixture();
  writeFileSync(join(repo, 'theme.json'), '{ // comments are not JSON\n  "accent": "#0b5d4b"\n}\n');
  const doc = designDoc(repo);
  assert.match(doc, /`theme\.json` is not valid JSON/);
  assert.match(doc, /`--color-bg`/);
});

test('a multi-line JSON token cites the line its value is on', () => {
  const [token] = jsonTokens('{\n  "primary": {\n    "$type": "color",\n    "$value": "#0b5d4b"\n  }\n}\n');
  assert.deepEqual(token, { name: 'primary', value: '#0b5d4b', dark: false, line: 4 });
});

test('minified JSON tokens cite the one line they are on', () => {
  assert.deepEqual(jsonTokens('{"colors":{"bg":{"$value":"#fff"},"ink":"#111"}}').map((t) => t.line), [1, 1]);
});

test('JSON light and dark groups pair into one token', () => {
  const tokens = jsonTokens('{\n  "light": { "background": "#fff" },\n  "dark": { "background": "#111" }\n}\n');
  assert.deepEqual(tokens.map((t) => [t.name, t.dark]), [['background', false], ['background', true]]);
});

test('a semicolon or brace inside a quoted value or url() stays in the value', () => {
  const tokens = customProperties(':root {\n  --icon: url("data:image/svg+xml;utf8,<svg>{}</svg>");\n  --ink: #111;\n}\n');
  assert.deepEqual(tokens.map((t) => [t.name, t.value, t.dark]), [['--icon', 'url("data:image/svg+xml;utf8,<svg>{}</svg>")', false], ['--ink', '#111', false]]);
});

test('an indented Sass file is named for reading by hand, not reported as empty', () => {
  const repo = copyOfFixture();
  writeFileSync(join(repo, 'src', 'styles', 'theme.sass'), ':root\n  --color-brand: #0b5d4b\n');
  assert.match(designDoc(repo), /`src\/styles\/theme\.sass` defines tokens the script does not read/);
});

test('a commented-out focus rule does not count as a focus style', () => {
  const repo = mkdtempSync(join(tmpdir(), 'design-system-doc-focus-'));
  writeFileSync(join(repo, 'app.css'), ':root { --ink: #111; }\n/* button:focus { outline: 2px solid; } */\n');
  assert.match(designDoc(repo), /No `:focus` or `:focus-visible` rule was found/);
});

test('a // comment in SCSS is a comment, whatever it holds', () => {
  const scss = (body) => customProperties(body, { lineComments: true }).map((t) => [t.name, t.value, t.dark]);
  assert.deepEqual(scss("// Don't edit by hand (\n:root { --color-ink: #111; --space-1: 4px; }\n"), [['--color-ink', '#111', false], ['--space-1', '4px', false]]);
  assert.deepEqual(scss('// light values, dark ones live in dark.scss\n:root { --ink: #111; }\n'), [['--ink', '#111', false]]);
  assert.deepEqual(scss(':root {\n  // brand ink\n  --ink: #111;\n}\n'), [['--ink', '#111', false]]);
  assert.deepEqual(scss(':root { --logo: url(http://example.com/a.svg); }\n'), [['--logo', 'url(http://example.com/a.svg)', false]]);
});

test('a // comment in an SCSS file does not count as a focus style', () => {
  const repo = mkdtempSync(join(tmpdir(), 'design-system-doc-scss-'));
  writeFileSync(join(repo, 'app.scss'), ':root { --ink: #111; }\n// button:focus { outline: 0; }\n');
  assert.match(designDoc(repo), /No `:focus` or `:focus-visible` rule was found/);
});

test('a Sass interpolation is the value, not a block', () => {
  assert.deepEqual(customProperties(':root {\n  --ink: #{$ink};\n  --bg: #fff;\n}\n', { lineComments: true }).map((t) => [t.name, t.value, t.line]), [['--ink', '#{$ink}', 2], ['--bg', '#fff', 3]]);
});

test('a :not(.dark) selector is the light theme', () => {
  assert.deepEqual(customProperties(':root:not(.dark) { --ink: #111; }\n.theme-dark { --ink: #eee; }\n').map((t) => t.dark), [false, true]);
});

test('a JSON key cites its own line, not a nested key of an earlier sibling', () => {
  const tokens = jsonTokens('{\n  "colors": {\n    "hover": {\n      "bg": "#222"\n    },\n    "bg": "#111"\n  }\n}\n');
  assert.deepEqual(tokens.map((t) => [t.name, t.value, t.line]), [['colors.hover.bg', '#222', 4], ['colors.bg', '#111', 6]]);
});

test('light and dark shades are names, and only a dark group is the dark theme', () => {
  const tokens = jsonTokens('{ "primary": { "main": "#00f", "light": "#88f", "dark": "#008" }, "colors": { "darkBlue": "#003" } }');
  assert.deepEqual(tokens.map((t) => [t.name, t.dark]), [['primary.main', false], ['primary.light', false], ['primary.dark', false], ['colors.darkBlue', false]]);
});

test('array and composite token values cite each part on its own line', () => {
  const tokens = jsonTokens('{\n  "fontFamilies": [\n    "Inter",\n    "Arial"\n  ],\n  "card": {\n    "$type": "shadow",\n    "$value": {\n      "color": "#0002",\n      "blur": "8px"\n    }\n  }\n}\n');
  assert.deepEqual(tokens.map((t) => [t.name, t.value, t.line]), [['fontFamilies.0', 'Inter', 3], ['fontFamilies.1', 'Arial', 4], ['card.color', '#0002', 9], ['card.blur', '8px', 10]]);
});

test('colour roles named by use and HSL channels sort as colours', () => {
  assert.equal(categorize('--text-primary', 'var(--gray-900)'), 'colour');
  assert.equal(categorize('--background', '0 0% 100%'), 'colour');
  assert.equal(categorize('--border-width', '1px'), 'other');
  assert.equal(categorize('--text-sm', '0.875rem'), 'type');
});

test('a semicolon inside an unquoted url() stays in the value', () => {
  assert.deepEqual(customProperties(':root { --icon: url(data:image/svg+xml;utf8,x); --ink: #111; }\n').map((t) => [t.name, t.value]), [['--icon', 'url(data:image/svg+xml;utf8,x)'], ['--ink', '#111']]);
});

test('a token keeps one role across its light and dark values', () => {
  const repo = mkdtempSync(join(tmpdir(), 'design-system-doc-roles-'));
  writeFileSync(join(repo, 'app.css'), ':root { --hero-one: #fff; }\n.dark { --hero-one: var(--night-one); }\nbutton:focus-visible { outline: 2px solid; }\n');
  const doc = designDoc(repo);
  assert.match(doc, /### Colour roles\n\n\| Token \| Light \| Dark \|\n\|---\|---\|---\|\n\| `--hero-one` \| `#fff` \(app\.css:1\) \| `var\(--night-one\)` \(app\.css:2\) \|/);
  assert.doesNotMatch(doc, /no dark value/);
});

test('a shade written as a token object stays a shade, not a theme mode', () => {
  const tokens = jsonTokens('{"primary":{"light":{"$value":"#fff"},"dark":{"$value":"#000"}}}');
  assert.deepEqual(tokens.map((t) => [t.name, t.dark]), [['primary.light', false], ['primary.dark', false]]);
});

test('a value written over several lines cites the whole range', () => {
  const [token] = customProperties(':root {\n  --hero: linear-gradient(\n    #fff,\n    #000\n  );\n}\n');
  assert.deepEqual(token, { name: '--hero', value: 'linear-gradient( #fff, #000 )', dark: false, line: 2, endLine: 5 });
});

test('a // comment inside a Sass map or mixin call is a comment, and the tokens after it still read', () => {
  const scss = (body) => customProperties(body, { lineComments: true }).map((t) => t.name);
  assert.deepEqual(scss("$bp: (\n  // don't use below 480\n  sm: 480px\n);\n:root { --ink: #111; --space-1: 4px; }\n"), ['--ink', '--space-1']);
  assert.deepEqual(scss(':root { --first: #000; }\n$bp: (\n  // mobile (small\n  sm: 480px\n);\n:root { --ink: #111; }\n'), ['--first', '--ink']);
  assert.deepEqual(scss("@include theme(\n  // it's the default\n  a\n);\n:root { --ink: #111; }\n"), ['--ink']);
});

test('a URL in an SCSS value is the value, not a comment', () => {
  const scss = (body) => customProperties(body, { lineComments: true }).map((t) => [t.name, t.value]);
  assert.deepEqual(scss(':root {\n  --site: https://x.com;\n  --next: #000;\n}\n'), [['--site', 'https://x.com'], ['--next', '#000']]);
  assert.deepEqual(scss(':root { --site: https://x.com; --next: #000; }\n'), [['--site', 'https://x.com'], ['--next', '#000']]);
  assert.deepEqual(scss(':root { --logo: url(//cdn.x.com/a.svg); --next: #000; }\n'), [['--logo', 'url(//cdn.x.com/a.svg)'], ['--next', '#000']]);
});

test('a Less interpolation is the value, not a block', () => {
  assert.deepEqual(customProperties(':root { --ink: @{ink}; --bg: #fff; }\n', { lineComments: true }).map((t) => [t.name, t.value]), [['--ink', '@{ink}'], ['--bg', '#fff']]);
});

test('a type step or a size written with var() is not a colour', () => {
  assert.equal(categorize('--text-sm', 'var(--step-0)'), 'type');
  assert.equal(categorize('--step-0', 'var(--base)'), 'type');
  assert.equal(categorize('--card-width', 'var(--w)'), 'other');
  assert.equal(categorize('--ring-width', 'var(--w)'), 'other');
  assert.equal(categorize('--text-primary', 'var(--ink)'), 'colour');
});

test('an array under a dark key is a name, not the dark theme', () => {
  assert.deepEqual(jsonTokens('{"colors":{"dark":["#a","#b"]}}').map((t) => [t.name, t.dark]), [['colors.dark.0', false], ['colors.dark.1', false]]);
});

test('a custom property named in letters beyond ASCII is a token', () => {
  assert.deepEqual(customProperties(':root { --café: #fff; --颜色: #000; }\n').map((t) => [t.name, t.value]), [['--café', '#fff'], ['--颜色', '#000']]);
});

test('a DTCG dimension keeps its unit, and value is a token name beside other tokens', () => {
  assert.deepEqual(jsonTokens('{"space":{"md":{"$type":"dimension","$value":{"value":16,"unit":"px"}}}}').map((t) => [t.name, t.value]), [['space.md', '16px']]);
  assert.deepEqual(jsonTokens('{"shadow":{"$value":{"color":"#000","offset":{"value":4,"unit":"px"}}}}').map((t) => [t.name, t.value]), [['shadow.color', '#000'], ['shadow.offset', '4px']]);
  assert.deepEqual(jsonTokens('{"surface":{"value":"#fff","background":"#000"}}').map((t) => [t.name, t.value]), [['surface.value', '#fff'], ['surface.background', '#000']]);
  assert.deepEqual(jsonTokens('{"ink":{"value":"#111","type":"color"}}').map((t) => [t.name, t.value]), [['ink', '#111']]);
});

test('spaces inside a quoted value stay as written', () => {
  assert.deepEqual(customProperties(':root { --font-name: "A  B", serif; }\n').map((t) => t.value), ['"A  B", serif']);
});

function repoWith(files, { git = false } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'design-system-doc-repo-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
  if (git) spawnSync('git', ['init', '-q'], { cwd: repo });
  return repo;
}

test('a gitignored file and a file that holds a credential are never copied into the doc', () => {
  const fakeKey = ['gh', 'p_', 'x'.repeat(36)].join('');
  const repo = repoWith({
    '.gitignore': 'tokens.json\n',
    'tokens.json': '{"color":{"ink":"#ignored"}}',
    'theme.json': `{"github":"${fakeKey}","color":{"bg":"#fff"}}`,
    'design-tokens.json': '{"oauth":{"refresh_token":"1//abc","color":"#eee"}}',
    'token.json': '{"refresh_token":"1//abc","client_secret":"shh"}',
    'api-tokens.json': '{"stripe":"shh"}',
    'app.css': ':root { --ink: #111; }\n',
  }, { git: true });
  const doc = designDoc(repo);
  assert.doesNotMatch(doc, /#ignored|ghp_|1\/\/abc|shh/);
  assert.match(doc, /`theme\.json` names or holds a credential, so it was not read/);
  assert.match(doc, /`design-tokens\.json` names or holds a credential, so it was not read/);
  assert.match(doc, /`--ink` \| `#111`/);
});

test('hidden folders such as a nested worktree or a virtualenv are not the repo\'s tokens', () => {
  const files = { 'app.css': ':root { --ink: #111; }\n', '.claude/worktrees/x/src/a.css': ':root { --ink: #222; }\n', '.venv/lib/s.css': ':root { --venv-color: #333; }\n' };
  for (const git of [false, true]) {
    const doc = designDoc(repoWith(files, { git }));
    assert.doesNotMatch(doc, /#222|--venv-color/);
  }
});

test('Sass and Less variables and token JSON with another name are named, not reported as no tokens', () => {
  const doc = designDoc(repoWith({ '_variables.scss': '$color-primary: #00f;\n', 'v.less': '@color: #00f;\n@media (min-width: 1px) {}\n', 'tokens/colors.json': '{"primary":"#00f"}' }));
  assert.match(doc, /declare Sass or Less variables, which the script does not read: `_variables\.scss`, `v\.less`/);
  assert.match(doc, /`tokens\/colors\.json` defines tokens the script does not read/);
});

test('a theme file named for its mode, a light-only selector, and a component variant land in the right column', () => {
  const columns = (files) => {
    const doc = designDoc(repoWith(files));
    return [...doc.matchAll(/\| `(--[\w-]+|[\w.]+)` \| (.*?) \| (.*?) \|$/gm)].map(([, name, light, dark]) => [name, Boolean(light), Boolean(dark)]);
  };
  assert.deepEqual(columns({ 'base.css': ':root { --bg: #fff; }\n', 'dark.css': ':root { --bg: #000; }\n' }), [['--bg', true, true]]);
  assert.deepEqual(columns({ 'tokens.json': '{"bg":"#fff"}', 'tokens.dark.json': '{"bg":"#000"}' }), [['bg', true, true]]);
  assert.deepEqual(columns({ 'a.css': ':root { --bg: #000; }\n.light { --bg: #fff; }\n' }), [['--bg', true, true]]);
  assert.deepEqual(columns({ 'a.css': ':root { --bg: #fff; }\n.darkMode { --bg: #000; }\n' }), [['--bg', true, true]]);
  assert.deepEqual(columns({ 'a.css': ':root { --bg: #fff; }\n.dark { --bg: #000; }\n.btn-dark { --btn-bg: #222; }\n' }), [['--bg', true, true], ['--btn-bg', true, false]]);
});

test('font sizes in token JSON and CSS are the type scale, and a shadow that starts with a colour is a shadow', () => {
  assert.equal(categorize('font.size.sm', '14px'), 'type');
  assert.equal(categorize('fontSize.lg', '20px'), 'type');
  assert.equal(categorize('--font-size-sm', 'var(--x)'), 'type');
  assert.equal(categorize('--shadow-sm', 'rgba(0,0,0,.1) 0 1px 2px'), 'shadow');
  assert.equal(categorize('--ink', 'rgb(0 0 0 / 0.8)'), 'colour');
  assert.equal(categorize('--mix', 'color-mix(in srgb, var(--a) 50%, white)'), 'colour');
});

test('a tracked symbolic link is not read, so nothing outside the repo reaches the doc', () => {
  const outside = mkdtempSync(join(tmpdir(), 'design-system-doc-outside-'));
  writeFileSync(join(outside, 'secret.css'), ':root { --outside-ink: #abc; }\n');
  const repo = repoWith({ 'app.css': ':root { --ink: #111; }\n' }, { git: true });
  symlinkSync(join(outside, 'secret.css'), join(repo, 'linked.css'));
  spawnSync('git', ['add', '-A'], { cwd: repo });
  const doc = designDoc(repo);
  assert.doesNotMatch(doc, /--outside-ink|#abc/);
  assert.match(doc, /`--ink` \| `#111`/);
});

test('a DTCG dimension split over lines cites the value line through the unit line', () => {
  const [token] = jsonTokens('{"space":{"md":{"$value":{\n"value": 16,\n"unit": "px"\n}}}}');
  assert.deepEqual(token, { name: 'space.md', value: '16px', dark: false, line: 2, endLine: 3 });
});

test('a stylesheet with only a light theme selector reads its defaults as dark and asks about it', () => {
  const doc = designDoc(repoWith({ 'a.css': ':root { --bg: #000; }\n.light { --bg: #fff; }\n' }));
  assert.match(doc, /`a\.css` sets values under a light theme selector and none under a dark one/);
});

test('a tracked folder replaced by a link to outside the repo is not read', () => {
  const outside = mkdtempSync(join(tmpdir(), 'design-system-doc-outside-'));
  writeFileSync(join(outside, 'a.css'), ':root { --outside-ink: #abc; }\n');
  const repo = repoWith({ 'app.css': ':root { --ink: #111; }\n', 'styles/a.css': ':root { --inside: #def; }\n' }, { git: true });
  spawnSync('git', ['add', '-A'], { cwd: repo });
  rmSync(join(repo, 'styles'), { recursive: true });
  symlinkSync(outside, join(repo, 'styles'));
  const doc = designDoc(repo);
  assert.doesNotMatch(doc, /--outside-ink|#abc/);
  assert.match(doc, /`--ink` \| `#111`/);
});

test('a custom property that names or holds a credential is left out and named', () => {
  const fakeKey = ['sk', '-', 'x'.repeat(20)].join('');
  const doc = designDoc(repoWith({ 'app.css': `:root { --ink: #111; --api-key: ${fakeKey}; --stripe: ${fakeKey}; }\n` }));
  assert.doesNotMatch(doc, /sk-x/);
  assert.match(doc, /`--ink` \| `#111`/);
  assert.match(doc, /`app\.css` declares custom properties that name or hold a credential/);
});

test('a DTCG dimension with its unit first still cites the lines in order', () => {
  const [token] = jsonTokens('{"space":{"md":{"$value":{\n"unit": "px",\n"value": 16\n}}}}');
  assert.deepEqual(token, { name: 'space.md', value: '16px', dark: false, line: 2, endLine: 3 });
});

test('a quoted credential in a custom property is left out', () => {
  const fakeKey = ['sk', '-', 'x'.repeat(20)].join('');
  const doc = designDoc(repoWith({ 'app.css': `:root { --ink: #111; --stripe: "${fakeKey}"; }\n` }));
  assert.doesNotMatch(doc, /sk-x/);
});

test('a theme selector wins over a file named for the other mode', () => {
  const doc = designDoc(repoWith({ 'dark.css': ':root { --bg: #000; }\n.light { --bg: #fff; }\n' }));
  assert.match(doc, /\| `--bg` \| `#fff` \(dark\.css:2\) \| `#000` \(dark\.css:1\) \|/);
});

test('a :focus inside a quoted value is not a focus style', () => {
  assert.equal(hasFocusRule('.a::after { content: ":focus"; }\n'), false);
  assert.equal(hasFocusRule('.a:focus-visible { outline: 2px solid; }\n'), true);
});

test('credentials in camelCase names, auth names, bearer values, and other key prefixes are left out', () => {
  const keys = ['npm_', 'glpat-', 'rk_live_'].map((p) => p + 'x'.repeat(20));
  const doc = designDoc(repoWith({
    'tokens.json': '{"accessToken":"abc111","refreshToken":"def222"}',
    'theme.json': `{"a":"${keys[0]}","bg":"#fff"}`,
    'b.tokens.json': `{"b":"${keys[1]}"}`,
    'c.tokens.json': `{"c":"${keys[2]}"}`,
    'design-tokens.json': '{"token":"tok333"}',
    'app.css': ':root { --ink: #111; --access-token: aaa444; --auth-token: qqq555; --auth: aaa777; --header: "Bearer zzz666"; }\n',
  }));
  assert.doesNotMatch(doc, /abc111|def222|npm_x|glpat-x|rk_live_x|tok333|aaa444|qqq555|zzz666|aaa777/);
  assert.match(doc, /`--ink` \| `#111`/);
});

test('in a git repo where git does not run, the script stops instead of reading ignored files', () => {
  const repo = repoWith({ '.gitignore': 'tokens.json\n', 'tokens.json': '{"bg":"#ignored"}' }, { git: true });
  const run = spawnSync(process.execPath, [TOKENS, repo], { encoding: 'utf8', env: { ...process.env, PATH: '' } });
  assert.equal(run.status, 1);
  assert.doesNotMatch(run.stdout, /#ignored/);
  assert.match(run.stderr, /git could not list the files/);
});

test('a DTCG token file keeps the mode in its name, and other token-like JSON is named', () => {
  const doc = designDoc(repoWith({ 'light.tokens.json': '{"bg":"#fff"}', 'colors.dark.tokens.json': '{"bg":"#000"}', 'tokens-dark.json': '{"bg":"#111"}', 'theme-light.json': '{"bg":"#eee"}' }));
  assert.match(doc, /\| `bg` \| `#fff` \(light\.tokens\.json:1\) \| `#000` \(colors\.dark\.tokens\.json:1\) \|/);
  assert.match(doc, /`theme-light\.json` is named like a token file but was not read/);
  assert.match(doc, /`tokens-dark\.json` is named like a token file but was not read/);
});

test('Tailwind @variant dark and light-dark() give dark values', () => {
  const doc = designDoc(repoWith({ 'app.css': '@theme { --color-bg: #fff; }\n@variant dark { --color-bg: #000; }\n:root { --ink: light-dark(#111, #eee); }\n' }));
  assert.match(doc, /\| `--color-bg` \| `#fff` \(app\.css:1\) \| `#000` \(app\.css:2\) \|/);
  assert.match(doc, /\| `--ink` \| `#111` \(app\.css:3\) \| `#eee` \(app\.css:3\) \|/);
});
