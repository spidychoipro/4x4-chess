// Dev tool: search for legal positions with a unique forced mate.
// Usage: node tools/find-puzzles.mjs [templateIndex] [attempts]
import { inCheck, isSquareAttacked, findKing, fileOf, rankOf, sq } from '../src/rules.js';
import { mateDistance, countMateMoves } from '../src/solver.js';

const templates = [
  { name: '첫 수', white: ['k', 'q'], black: ['k'], mate: 1 },
  { name: '긴 장', white: ['k', 'r'], black: ['k'], mate: 2 },
  { name: '폰 대결', white: ['k', 'q', 'p'], black: ['k', 'p'], mate: 2 },
  { name: '사제의 길', white: ['k', 'r', 'b'], black: ['k'], mate: 2 },
  { name: '기사의 방해', white: ['k', 'q', 'n'], black: ['k', 'r'], mate: 2 },
  { name: '승격 직전', white: ['k', 'q', 'p'], black: ['k', 'p'], mate: 2, promo: true },
  { name: '좁은 공간', white: ['k', 'b', 'n', 'p'], black: ['k', 'p'], mate: 3 },
  { name: '무거운 조각', white: ['k', 'r', 'r'], black: ['k', 'q'], mate: 2 },
  { name: '마지막 방어', white: ['k', 'q', 'p', 'p'], black: ['k', 'r', 'p'], mate: 3 },
  { name: '왕관의 무게', white: ['k', 'r', 'b', 'p'], black: ['k', 'n', 'p'], mate: 3 },
];

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildCandidate(template, rng) {
  const cells = Array.from({ length: 16 }, (_, i) => i);
  for (let i = cells.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  const board = new Array(16).fill(null);
  const place = (type, color, allowed) => {
    const at = cells.findIndex((s) => !board[s] && (!allowed || allowed(s)));
    if (at === -1) return false;
    const [square] = cells.splice(at, 1);
    board[square] = { type, color };
    return true;
  };

  for (const type of template.white) {
    const allowed = type === 'p' && template.promo ? (s) => rankOf(s) === 2 : undefined;
    if (!place(type, 'w', allowed)) return null;
  }
  for (const type of template.black) {
    if (!place(type, 'b')) return null;
  }

  for (const pieces of [board]) {
    for (let s = 0; s < 16; s += 1) {
      const p = pieces[s];
      if (!p || p.type !== 'p') continue;
      const r = rankOf(s);
      if (p.color === 'w' && (r === 0 || r === 3)) return null;
      if (p.color === 'b' && (r === 0 || r === 3)) return null;
    }
  }

  const whiteKing = findKing(board, 'w');
  const blackKing = findKing(board, 'b');
  if (whiteKing === -1 || blackKing === -1) return null;
  if (Math.max(Math.abs(fileOf(whiteKing) - fileOf(blackKing)), Math.abs(rankOf(whiteKing) - rankOf(blackKing))) <= 1) return null;
  if (isSquareAttacked(board, blackKing, 'w')) return null;
  if (isSquareAttacked(board, whiteKing, 'b')) return null;

  const state = { board, turn: 'w', ep: null, halfmove: 0, fullmove: 1 };
  if (inCheck(state)) return null;
  return state;
}

function placementRows(state) {
  const rows = [];
  for (let r = 3; r >= 0; r -= 1) {
    let row = '';
    for (let f = 0; f < 4; f += 1) {
      const p = state.board[sq(f, r)];
      row += p ? (p.color === 'w' ? p.type.toUpperCase() : p.type) : '.';
    }
    rows.push(row);
  }
  return rows;
}

const only = process.argv[2] === undefined ? null : Number(process.argv[2]);
const attempts = Number(process.argv[3] ?? 20000);

templates.forEach((template, index) => {
  if (only !== null && only !== index) return;
  const rng = mulberry32(0x5eed + index * 7919);
  let found = null;
  let tried = 0;

  for (; tried < attempts && !found; tried += 1) {
    const state = buildCandidate(template, rng);
    if (!state) continue;
    const solution = mateDistance(state, template.mate);
    if (!solution || solution.moves !== template.mate) continue;
    if (countMateMoves(state, template.mate) !== 1) continue;
    found = { state, solution };
  }

  if (!found) {
    console.log(`// ${index}: ${template.name} — not found in ${tried} tries`);
    return;
  }
  const rows = placementRows(found.state);
  console.log(`// ${index}: ${template.name} (mate in ${template.mate}), ${tried} tries`);
  console.log(`  { id: 'stage-${index + 1}', name: '${template.name}', rows: ${JSON.stringify(rows)}, mateIn: ${template.mate} },`);
});
