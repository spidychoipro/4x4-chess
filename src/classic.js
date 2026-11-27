import { sq, fileOf, rankOf, getGameStatus, legalMoves, inCheck, makeMove } from './rules.js';

export const CLASSIC_LEVELS = 20;

const TIERS = [
  { last: 5, pieces: ['k', 'q', 'p', 'p'], minMoves: 4, pattern: 'rotate' },
  { last: 10, pieces: ['k', 'r', 'b', 'p'], minMoves: 5, pattern: 'vertical' },
  { last: 15, pieces: ['k', 'q', 'b', 'p'], minMoves: 6, pattern: 'zigzag' },
  { last: 20, pieces: ['k', 'r', 'n', 'p'], minMoves: 7, pattern: 'rotate' },
];

const ELO_STEPS = [100, 300, 600, 1000, 1500];

function tierFor(level) {
  return TIERS.find((tier) => level <= tier.last) ?? TIERS.at(-1);
}

function timeLimitFor(level) {
  if (level < 6) return null;
  if (level < 11) return level % 2 === 0 ? 90 : null;
  if (level < 16) return level % 2 === 1 ? 75 : null;
  return 60;
}

export function classicInfo(level) {
  const normalized = Math.max(1, Math.min(CLASSIC_LEVELS, Math.floor(level) || 1));
  const tier = tierFor(normalized);
  const patternName = { rotate: '대칭', vertical: '세로', zigzag: '지그재그' }[tier.pattern];
  return {
    level: normalized,
    pieces: [...tier.pieces],
    minMoves: tier.minMoves,
    pattern: tier.pattern,
    patternName,
    timeLimit: timeLimitFor(normalized),
    botElo: ELO_STEPS[Math.min(ELO_STEPS.length - 1, Math.floor((normalized - 1) / 4))],
  };
}

function mirrorOf(square, pattern) {
  const f = fileOf(square);
  const r = rankOf(square);
  if (pattern === 'vertical') return sq(f, 3 - r);
  if (pattern === 'zigzag') return sq(r, f);
  return 15 - square;
}

function shuffle(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function pairsFor(pattern) {
  const pairs = [];
  for (let s = 0; s < 16; s += 1) {
    const mirror = mirrorOf(s, pattern);
    if (mirror > s) pairs.push([s, mirror]);
  }
  return pairs;
}

// 원작처럼 판을 채우되, 양쪽 기물 수와 종류가 같도록 뒤집어서 놓는다.
// 왕이 처음부터 체크받거나 둘 수가 거의 없는 판은 버리고 다시 뽑는다.
export function classicState(level, random = Math.random) {
  const info = classicInfo(level);
  const pairs = pairsFor(info.pattern);
  let state = null;

  for (let attempt = 0; attempt < 3000 && !state; attempt += 1) {
    const board = new Array(16).fill(null);
    const picked = shuffle(pairs, random).slice(0, info.pieces.length);
    const types = shuffle(info.pieces, random);

    picked.forEach(([first, second], index) => {
      const whiteSquare = random() < 0.5 ? first : second;
      const blackSquare = whiteSquare === first ? second : first;
      board[whiteSquare] = { type: types[index], color: 'w' };
      board[blackSquare] = { type: types[index], color: 'b' };
    });

    const candidate = { board, turn: 'w', ep: null, halfmove: 0, fullmove: 1 };
    if (inCheck(candidate, 'w') || inCheck(candidate, 'b')) continue;
    if (getGameStatus(candidate).over) continue;
    const moves = legalMoves(candidate);
    if (moves.length < info.minMoves) continue;
    if (moves.some((move) => legalMoves(makeMove(candidate, move)).length < 3)) continue;
    state = candidate;
  }

  if (!state) throw new Error(`클래식 ${info.level}단계 배치를 만들지 못했습니다.`);
  return state;
}
