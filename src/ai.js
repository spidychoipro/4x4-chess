import { opposite, legalMoves, makeMove, inCheck, fileOf, rankOf } from './rules.js';

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 100000;

// 체감 레이팅 단계. 같은 엔진에 탐색 깊이·평가 정교함·실수 확률을 다르게 줘서
// 100점부터 최정상급까지 실제로 체감 난이도가 오르도록 만들었다.
export const BOTS = [
  { elo: 100, name: '첫 걸음', depth: 1, spread: 5, noise: 420, style: 'material', desc: '규칙을 막 배운 사람처럼 가끔 엉뚱한 수를 둡니다.' },
  { elo: 300, name: '동네 형', depth: 1, spread: 3, noise: 220, style: 'material', desc: '기물은 잘 잡지만 함정은 잘 못 봅니다.' },
  { elo: 600, name: '취미 생활', depth: 2, spread: 3, noise: 110, style: 'material', desc: '한 수 뒤까지는 봅니다. 실수도 종종 합니다.' },
  { elo: 1000, name: '동아리', depth: 3, spread: 2, noise: 45, style: 'full', desc: '기물과 위치를 함께 봅니다. 이제 만만치 않습니다.' },
  { elo: 1500, name: '클럽 챔피언', depth: 3, spread: 1, noise: 0, style: 'full', desc: '눈앞의 실수를 저지르지 않습니다.' },
  { elo: 2000, name: '국가대표', depth: 4, spread: 1, noise: 0, style: 'full', desc: '두 수 뒤까지 계산하고 기물을 아낍니다.' },
  { elo: 2400, name: '그랜드마스터', depth: 5, spread: 1, noise: 0, style: 'full', desc: '세 수 뒤까지 읽습니다. 여유 있게 두면 이깁니다.' },
  { elo: 2800, name: '최정상급', depth: 6, spread: 1, noise: 0, style: 'full', desc: '가장 긴 계산. 한 수만 어긋나도 끝납니다.' },
];

export function resolveBot(selection) {
  if (selection && typeof selection === 'object' && Number.isFinite(selection.elo)) return selection;
  const legacy = { easy: 100, normal: 1000, hard: 2000 };
  const requested = typeof selection === 'string' && legacy[selection] !== undefined
    ? legacy[selection] : Number(selection);
  if (!Number.isFinite(requested)) return BOTS[3];
  return BOTS.reduce((best, bot) =>
    Math.abs(bot.elo - requested) < Math.abs(best.elo - requested) ? bot : best, BOTS[0]);
}

export function evaluate(state, color, style = 'full') {
  let score = 0;
  for (let s = 0; s < 16; s += 1) {
    const piece = state.board[s];
    if (!piece) continue;
    const sign = piece.color === color ? 1 : -1;
    let value = VALUE[piece.type];
    if (piece.type === 'p') {
      const advance = piece.color === 'w' ? rankOf(s) : 3 - rankOf(s);
      value += advance * (style === 'full' ? 18 : 8);
    }
    if (piece.type === 'k' && style === 'full') {
      const f = fileOf(s);
      const r = rankOf(s);
      value += Math.min(f, 3 - f, r, 3 - r) * 12;
    }
    score += sign * value;
  }
  if (style === 'full') {
    const mine = legalMoves(state, color).length;
    const theirs = legalMoves(state, opposite(color)).length;
    score += (mine - theirs) * 4;
  }
  return score;
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

function quiesce(state, alpha, beta, limit, stats, style) {
  stats.nodes += 1;
  const standPat = evaluate(state, state.turn, style);
  if (limit === 0 || standPat >= beta) return standPat;
  if (standPat > alpha) alpha = standPat;

  const captures = orderMoves(state, legalMoves(state).filter(
    (move) => state.board[move.to] || move.promotion || move.epCapture !== undefined,
  ));
  for (const move of captures) {
    const score = -quiesce(makeMove(state, move), -beta, -alpha, limit - 1, stats, style);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(state, depth, alpha, beta, ply, stats, style) {
  const moves = legalMoves(state);
  if (moves.length === 0) return inCheck(state) ? -MATE + ply : 0;
  if (depth === 0) return quiesce(state, alpha, beta, 4, stats, style);

  let best = -Infinity;
  for (const move of orderMoves(state, moves)) {
    stats.nodes += 1;
    const score = -negamax(makeMove(state, move), depth - 1, -beta, -alpha, ply + 1, stats, style);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export function pickMove(state, selection = 1000) {
  const bot = resolveBot(selection);
  const moves = legalMoves(state);
  if (!moves.length) return null;

  const stats = { nodes: 0 };
  const scored = orderMoves(state, moves).map((move) => {
    const score = -negamax(
      makeMove(state, move), bot.depth - 1, -Infinity, Infinity, 1, stats, bot.style,
    );
    return { move, score: score + (bot.noise ? (Math.random() * 2 - 1) * bot.noise : 0) };
  });
  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, Math.min(bot.spread, scored.length));
  const chosen = top[Math.floor(Math.random() * top.length)];
  return { move: chosen.move, score: chosen.score, nodes: stats.nodes, bot };
}
