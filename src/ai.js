import { opposite, legalMoves, makeMove, inCheck, fileOf, rankOf } from './rules.js';

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 100000;

export function evaluate(state, color) {
  let score = 0;
  for (let s = 0; s < 16; s += 1) {
    const piece = state.board[s];
    if (!piece) continue;
    const sign = piece.color === color ? 1 : -1;
    let value = VALUE[piece.type];
    if (piece.type === 'p') {
      const advance = piece.color === 'w' ? rankOf(s) : 3 - rankOf(s);
      value += advance * 18;
    }
    if (piece.type === 'k') {
      const f = fileOf(s);
      const r = rankOf(s);
      value += Math.min(f, 3 - f, r, 3 - r) * 12;
    }
    score += sign * value;
  }
  const mine = legalMoves(state, color).length;
  const theirs = legalMoves(state, opposite(color)).length;
  return score + (mine - theirs) * 4;
}

function captureScore(state, move) {
  let score = 0;
  const victim = state.board[move.to];
  if (victim) score += VALUE[victim.type] * 10 - VALUE[state.board[move.from].type];
  if (move.epCapture !== undefined) score += VALUE.p * 10;
  if (move.promotion) score += VALUE[move.promotion] * 5;
  return score;
}

function orderMoves(state, moves) {
  moves.sort((a, b) => captureScore(state, b) - captureScore(state, a));
  return moves;
}

function quiesce(state, alpha, beta, limit, stats) {
  stats.nodes += 1;
  const standPat = evaluate(state, state.turn);
  if (limit === 0 || standPat >= beta) return standPat;
  if (standPat > alpha) alpha = standPat;

  const captures = orderMoves(state, legalMoves(state).filter(
    (move) => state.board[move.to] || move.promotion || move.epCapture !== undefined,
  ));
  for (const move of captures) {
    const score = -quiesce(makeMove(state, move), -beta, -alpha, limit - 1, stats);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(state, depth, alpha, beta, ply, stats) {
  const moves = legalMoves(state);
  if (moves.length === 0) return inCheck(state) ? -MATE + ply : 0;
  if (depth === 0) return quiesce(state, alpha, beta, 4, stats);

  let best = -Infinity;
  for (const move of orderMoves(state, moves)) {
    stats.nodes += 1;
    const score = -negamax(makeMove(state, move), depth - 1, -beta, -alpha, ply + 1, stats);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export const DIFFICULTIES = {
  easy: { depth: 1, spread: 3 },
  normal: { depth: 3, spread: 1 },
  hard: { depth: 4, spread: 1 },
};

export function pickMove(state, difficulty = 'normal') {
  const config = DIFFICULTIES[difficulty] ?? DIFFICULTIES.normal;
  const moves = legalMoves(state);
  if (!moves.length) return null;

  const stats = { nodes: 0 };
  const scored = orderMoves(state, moves).map((move) => ({
    move,
    score: -negamax(makeMove(state, move), config.depth - 1, -Infinity, Infinity, 1, stats),
  }));
  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, Math.min(config.spread, scored.length));
  const chosen = top[Math.floor(Math.random() * top.length)];
  return { move: chosen.move, score: chosen.score, nodes: stats.nodes };
}
