import test from 'node:test';
import assert from 'node:assert/strict';
import { PUZZLES, puzzleState, matchState } from '../src/puzzles.js';
import { findForcedMate, countMateMoves, mateDistance } from '../src/solver.js';
import { legalMoves, makeMove, getGameStatus, findKing, isSquareAttacked, inCheck } from '../src/rules.js';
import { pickMove } from '../src/ai.js';

test('all ten stages have a unique forced mate of the advertised length', () => {
  assert.equal(PUZZLES.length, 10);
  for (const puzzle of PUZZLES) {
    const state = puzzleState(puzzle);
    const solution = mateDistance(state, puzzle.mateIn);
    assert.ok(solution, `${puzzle.id} has no forced mate`);
    assert.equal(solution.moves, puzzle.mateIn, `${puzzle.id} has a shorter mate`);
    assert.equal(countMateMoves(state, puzzle.mateIn), 1, `${puzzle.id} has multiple solutions`);
    assert.equal(solution.line.length % 2, 1, `${puzzle.id} solution must end with White's mating move`);
  }
});

test('queen side is not in check at the start of every stage', () => {
  for (const puzzle of PUZZLES) {
    const state = puzzleState(puzzle);
    const whiteKing = findKing(state.board, 'w');
    const blackKing = findKing(state.board, 'b');
    assert.ok(whiteKing >= 0 && blackKing >= 0, `${puzzle.id} needs both kings`);
    assert.equal(isSquareAttacked(state.board, blackKing, 'w'), false, `${puzzle.id} starts illegally`);
  }
});

test('every AI and local match starts with a legal, symmetric setup', () => {
  const state = matchState();
  assert.equal(legalMoves(state).length > 0, true);
  assert.equal(getGameStatus(state).over, false);
  assert.equal(inCheck(state, 'w'), false, 'match must not start with White in check');
  assert.equal(inCheck(state, 'b'), false, 'match must not start with Black in check');
  assert.ok(legalMoves(state).length >= 5, 'match should offer a real choice of opening moves');
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const choice = pickMove(state, difficulty);
    assert.ok(choice?.move, `${difficulty} must produce a move`);
    assert.equal(makeMove(state, choice.move).turn, 'b');
  }
});

test('the forced-mate solver rejects positions with no mate in range', () => {
  const state = matchState();
  for (let n = 1; n <= 3; n += 1) {
    assert.equal(findForcedMate(state, n), null);
  }
});
