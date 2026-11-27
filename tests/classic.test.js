import test from 'node:test';
import assert from 'node:assert/strict';
import { CLASSIC_LEVELS, classicInfo, classicState } from '../src/classic.js';
import { fileOf, rankOf, getGameStatus, inCheck, legalMoves, makeMove, sq } from '../src/rules.js';

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

test('every classic level makes a fair, playable eight-piece board', () => {
  for (let level = 1; level <= CLASSIC_LEVELS; level += 1) {
    const info = classicInfo(level);
    const state = classicState(level, seeded(level * 7919));
    const white = state.board.filter((piece) => piece?.color === 'w');
    const black = state.board.filter((piece) => piece?.color === 'b');

    assert.equal(state.board.filter(Boolean).length, 8, `level ${level} has eight pieces`);
    assert.equal(white.length, 4);
    assert.equal(black.length, 4);
    assert.deepEqual(white.map((piece) => piece.type).sort(), [...info.pieces].sort());
    assert.deepEqual(black.map((piece) => piece.type).sort(), [...info.pieces].sort());
    assert.equal(inCheck(state, 'w'), false, `level ${level} white starts safe`);
    assert.equal(inCheck(state, 'b'), false, `level ${level} black starts safe`);
    assert.equal(getGameStatus(state).over, false, `level ${level} is not over at the start`);
    assert.ok(legalMoves(state).length >= info.minMoves, `level ${level} offers enough moves`);

    for (let s = 0; s < 16; s += 1) {
      const piece = state.board[s];
      if (!piece) continue;
      const target = info.pattern === 'vertical' ? sq(fileOf(s), 3 - rankOf(s))
        : info.pattern === 'zigzag' ? sq(rankOf(s), fileOf(s)) : 15 - s;
      if (target === s) continue;
      const mirror = state.board[target];
      assert.ok(mirror, `level ${level} mirrors ${s}`);
      assert.equal(mirror.color, piece.color === 'w' ? 'b' : 'w');
      assert.equal(mirror.type, piece.type);
    }
  }
});

test('classic boards are random but repeatable with the same seed', () => {
  const first = classicState(8, seeded(42));
  const second = classicState(8, seeded(42));
  const third = classicState(8, seeded(43));
  assert.deepEqual(first.board, second.board);
  assert.notDeepEqual(first.board, third.board);
});

test('later classic levels add time limits and stronger bots', () => {
  assert.equal(classicInfo(1).timeLimit, null);
  assert.equal(classicInfo(6).timeLimit, 90);
  assert.equal(classicInfo(11).timeLimit, 75);
  assert.equal(classicInfo(20).timeLimit, 60);
  assert.ok(classicInfo(20).botElo > classicInfo(1).botElo);
  assert.equal(classicInfo(99).level, CLASSIC_LEVELS);
  assert.equal(classicInfo(0).level, 1);
});

test('a generated classic board can be played without engine errors', () => {
  const state = classicState(12, seeded(12));
  const move = legalMoves(state)[0];
  const next = makeMove(state, move);
  assert.equal(next.turn, 'b');
  assert.equal(next.board.filter(Boolean).length <= 8, true);
});
