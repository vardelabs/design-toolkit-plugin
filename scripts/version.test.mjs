import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bumped, check, compare } from './version.mjs';

const at = (v) => ({ marketplace: v, metadata: v, pluginJson: v, readme: v });
const SKILL = 'plugins/design-toolkit/skills/design-spec/SKILL.md';

test('bumps each part and resets the lower ones', () => {
  assert.equal(bumped('0.9.1', 'patch'), '0.9.2');
  assert.equal(bumped('0.9.1', 'minor'), '0.10.0');
  assert.equal(bumped('0.9.1', 'major'), '1.0.0');
  assert.throws(() => bumped('0.9.1', 'huge'), /patch, minor, or major/);
});

test('compares versions by number, not as text', () => {
  assert.ok(compare('0.10.0', '0.9.9') > 0);
  assert.equal(compare('1.2.3', '1.2.3'), 0);
});

test('fails a plugin change that keeps the version', () => {
  const problems = check({ base: at('0.9.1'), head: at('0.9.1'), changed: [SKILL] });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /bump patch/);
});

test('passes a plugin change that raises the version, and a change outside the plugin that keeps it', () => {
  assert.deepEqual(check({ base: at('0.9.1'), head: at('0.9.2'), changed: [SKILL] }), []);
  assert.deepEqual(check({ base: at('0.9.1'), head: at('0.9.1'), changed: ['CONTRIBUTING.md'] }), []);
});

test('fails a lowered version', () => {
  assert.equal(check({ base: at('0.9.2'), head: at('0.9.1'), changed: [SKILL] }).length, 1);
});

test('fails files that disagree, even when nothing in the plugin changed', () => {
  const head = { ...at('0.9.2'), readme: '0.9.1' };
  const problems = check({ base: at('0.9.1'), head, changed: ['README.md'] });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /readme 0\.9\.1/);
});
