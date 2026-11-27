import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fromPlacement, toPlacement, initialPosition, legalMoves, makeMove,
  moveToSan, isSquareAttacked, getGameStatus, parseSquare, squareName,
} from '../src/rules.js';
import { PUZZLES, puzzleState } from '../src/puzzles.js';
import { findForcedMate } from '../src/solver.js';

const at = (state, name) => state.board[parseSquare(name)];
const hasMove = (moves, from, to, extra = {}) => moves.some((m) =>
  m.from === parseSquare(from) && m.to === parseSquare(to) &&
  Object.entries(extra).every(([k, v]) => m[k] === v));

test('placement round-trip', () => {
  const state = initialPosition();
  assert.deepEqual(toPlacement(state), ['.qk.', 'p..p', 'p..p', '.KQ.']);
  assert.equal(Object.values(state.board).filter(Boolean).length, 8);
});

test('a double pawn push lands on the last rank and must promote', () => {
  const state = fromPlacement(['k...', '....', '.P..', '.K..']);
  const moves = legalMoves(state).filter((m) => m.from === parseSquare('b2') && m.to === parseSquare('b4'));
  assert.deepEqual(moves.map((m) => m.promotion).sort(), ['b', 'n', 'q', 'r']);
  assert.ok(moves.every((m) => m.ep === parseSquare('b3')));
  const after = makeMove(state, moves[0]);
  assert.equal(at(after, 'b4').color, 'w');
  assert.equal(squareName(after.ep), 'b3');
});

test('en passant removes the pawn beside the destination square', () => {
  const state = fromPlacement(['pP.k', '....', '....', '...K'], 'b', 'b3');
  const moves = legalMoves(state);
  assert.ok(hasMove(moves, 'a4', 'b3', { epCapture: parseSquare('b4') }));
  const after = makeMove(state, moves.find((m) => m.epCapture !== undefined));
  assert.equal(at(after, 'b4'), null);
  assert.equal(at(after, 'b3').color, 'b');
});

test('promotion offers four pieces including underpromotion', () => {
  const state = fromPlacement(['...k', '.P..', '....', 'K...']);
  const moves = legalMoves(state).filter((m) => m.from === parseSquare('b3'));
  assert.deepEqual(moves.map((m) => m.promotion).sort(), ['b', 'n', 'q', 'r']);
  const promoted = makeMove(state, moves.find((m) => m.promotion === 'n'));
  assert.equal(at(promoted, 'b4').type, 'n');
});

test('kings may not step onto attacked squares', () => {
  const state = fromPlacement(['....', '....', 'r...', 'K..k']);
  assert.equal(isSquareAttacked(state.board, parseSquare('a1'), 'b'), true);
  const moves = legalMoves(state);
  assert.equal(hasMove(moves, 'a1', 'b2'), false);
  assert.equal(hasMove(moves, 'a1', 'b1'), true);
});

test('checkmate and stalemate are distinguished', () => {
  const state = puzzleState(PUZZLES[0]);
  const line = findForcedMate(state, 1);
  const mated = makeMove(state, line[0]);
  assert.equal(getGameStatus(mated).reason, 'checkmate');
  assert.equal(getGameStatus(mated).winner, 'w');

  const stale = fromPlacement(['k...', '..Q.', '.K..', '....'], 'b');
  assert.equal(getGameStatus(stale).check, false);
  assert.equal(getGameStatus(stale).reason, 'stalemate');
});

test('SAN records capture, en passant and checkmate', () => {
  const state = puzzleState(PUZZLES[0]);
  const line = findForcedMate(state, 1);
  assert.ok(moveToSan(state, line[0]).endsWith('#'));

  const epState = fromPlacement(['pP.k', '....', '....', '...K'], 'b', 'b3');
  const epMove = legalMoves(epState).find((m) => m.epCapture !== undefined);
  assert.equal(moveToSan(epState, epMove), 'axb3 e.p.');
});

test('bare kings are an immediate draw', () => {
  const state = fromPlacement(['k...', '....', '....', '...K']);
  assert.equal(getGameStatus(state).reason, 'insufficient');
});
