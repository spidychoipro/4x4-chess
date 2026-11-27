import test from 'node:test';
import assert from 'node:assert/strict';
import { DICE_FACES, decideFirstMove, rollDie } from '../src/dice.js';

test('dice rolls stay inside one to six', () => {
  const random = () => 0.999999;
  assert.equal(rollDie(random), 6);
  assert.equal(rollDie(() => 0), 1);
  for (let i = 0; i < 200; i += 1) {
    const value = rollDie();
    assert.ok(Number.isInteger(value) && value >= 1 && value <= 6);
  }
  assert.equal(DICE_FACES.length, 6);
});

test('larger die wins and equal dice ask for another roll', () => {
  assert.equal(decideFirstMove(4, 2), 'first');
  assert.equal(decideFirstMove(1, 6), 'second');
  assert.equal(decideFirstMove(3, 3), 'tie');
});
