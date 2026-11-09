import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cardTooTallMessage, maxCardHeight } from '../skills/design-spec/scripts/lib/card-limit.mjs';

test('a narrow card may be twice as tall as it is wide', () => {
  assert.equal(maxCardHeight(1200), 2400);
  assert.equal(cardTooTallMessage(1200, 2400), null);
  assert.match(cardTooTallMessage(1200, 2401), /over the 2400 px height limit/);
});

test('a wide card stops at 3000 px, below twice its width', () => {
  assert.equal(maxCardHeight(2400), 3000);
  assert.equal(cardTooTallMessage(2400, 3000), null);
  assert.match(cardTooTallMessage(2400, 3001), /over the 3000 px height limit/);
});

test('a refusal sends the agent to the full sheet', () => {
  assert.match(cardTooTallMessage(2400, 12420), /No card was written\. Make the full sheet instead/);
});

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');

function cardRenderCommands() {
  const files = readdirSync(SKILLS, { recursive: true }).filter((f) => /\.(md|html)$/.test(f));
  return files.flatMap((file) => readFileSync(join(SKILLS, file), 'utf8').split('\n')
    .filter((line) => line.includes('capture.mjs') && line.includes('--selector .card'))
    .map((line) => ({ file, line })));
}

test('every card render recipe passes --card', () => {
  const recipes = cardRenderCommands();
  assert.ok(recipes.length >= 3, `found ${recipes.length} card render recipes`);
  assert.deepEqual(recipes.filter(({ line }) => !/\s--card(\s|$)/.test(line)), []);
});
