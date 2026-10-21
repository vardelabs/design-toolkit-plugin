import assert from 'node:assert/strict';
import { test } from 'node:test';
import { check } from './version.mjs';

const at = (v) => ({ marketplace: v, metadata: v, pluginJson: v, readme: v });

test('passes a change that leaves the version alone', () => {
  assert.deepEqual(check({ base: at('0.9.1'), head: at('0.9.1') }), []);
});

test('fails a raised version, and names each field that moved', () => {
  const problems = check({ base: at('0.9.1'), head: at('0.9.2') });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /marketplace 0\.9\.1 -> 0\.9\.2/);
  assert.match(problems[0], /each release sets it/);
});

test('fails a version edit in one file only', () => {
  const problems = check({ base: at('0.9.1'), head: { ...at('0.9.1'), readme: '0.9.2' } });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /readme 0\.9\.1 -> 0\.9\.2/);
  assert.doesNotMatch(problems[0], /marketplace/);
});
