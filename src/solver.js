// Forced-mate search. Used to verify that every campaign puzzle really has a
// forced win, and to power the hint button.
import { legalMoves, makeMove, inCheck, positionKey, opposite } from './rules.js';

export function findForcedMate(state, maxMoves = 2, attacker = state.turn) {
  const memo = new Map();

  function attack(current, remaining) {
    if (remaining <= 0) return null;
    const key = `${positionKey(current)}|${remaining}`;
    if (memo.has(key)) return memo.get(key);

    let best = null;
    for (const move of legalMoves(current)) {
      const next = makeMove(current, move);
      const reply = defend(next, remaining);
      if (reply) {
        const line = [move, ...reply];
        if (!best || line.length < best.length) best = line;
      }
    }
    memo.set(key, best);
    return best;
  }

  function defend(current, remaining) {
    const moves = legalMoves(current);
    if (moves.length === 0) return inCheck(current) ? [] : null;
    if (remaining <= 1) return null;

    let longest = null;
    for (const move of moves) {
      const next = makeMove(current, move);
      const continuation = attack(next, remaining - 1);
      if (!continuation) return null;
      const line = [move, ...continuation];
      if (!longest || line.length > longest.length) longest = line;
    }
    return longest;
  }

  if (state.turn !== attacker) return null;
  return attack(state, maxMoves);
}

export function mateDistance(state, limit = 4, attacker = state.turn) {
  for (let n = 1; n <= limit; n += 1) {
    const line = findForcedMate(state, n, attacker);
    if (line) return { moves: n, line };
  }
  return null;
}

// How many different first moves still force mate within the given depth.
export function countMateMoves(state, maxMoves = 2, attacker = state.turn) {
  if (state.turn !== attacker) return 0;
  let count = 0;
  for (const move of legalMoves(state)) {
    const next = makeMove(state, move);
    const replies = legalMoves(next);
    if (replies.length === 0) {
      if (inCheck(next)) count += 1;
    } else if (maxMoves > 1 && replies.every((reply) => findForcedMate(
      makeMove(next, reply), maxMoves - 1, attacker,
    ))) {
      count += 1;
    }
  }
  return count;
}

export { opposite };
