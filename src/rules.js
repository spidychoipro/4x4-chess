// Pure rules engine for 4x4 chess. No DOM, no side effects.
// Squares are 0..15, index = rank * 4 + file. Rank 0 is rank 1 (White's side).

export const SIZE = 4;
export const FILE_NAMES = 'abcd';
export const PIECE_TYPES = ['q', 'r', 'b', 'n'];

const KNIGHT_DELTAS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KING_DELTAS = [...ORTHO, ...DIAG];

export const inBoard = (f, r) => f >= 0 && f < SIZE && r >= 0 && r < SIZE;
export const sq = (f, r) => r * SIZE + f;
export const fileOf = (s) => s % SIZE;
export const rankOf = (s) => Math.floor(s / SIZE);
export const squareName = (s) => FILE_NAMES[fileOf(s)] + (rankOf(s) + 1);
export const opposite = (color) => (color === 'w' ? 'b' : 'w');

export function parseSquare(name) {
  if (typeof name !== 'string' || name.length !== 2) return -1;
  const f = FILE_NAMES.indexOf(name[0]);
  const r = Number(name[1]) - 1;
  return inBoard(f, r) ? sq(f, r) : -1;
}

export function cloneState(state) {
  return {
    board: state.board.slice(),
    turn: state.turn,
    ep: state.ep ?? null,
    halfmove: state.halfmove ?? 0,
    fullmove: state.fullmove ?? 1,
  };
}

// rows are given from rank 4 down to rank 1. Uppercase = White, lowercase = Black.
export function fromPlacement(rows, turn = 'w', ep = null) {
  if (!Array.isArray(rows) || rows.length !== SIZE) throw new Error('placement needs 4 rows');
  const board = new Array(SIZE * SIZE).fill(null);
  rows.forEach((row, rowIndex) => {
    if (row.length !== SIZE) throw new Error('each row needs 4 squares');
    const rank = SIZE - 1 - rowIndex;
    for (let file = 0; file < SIZE; file += 1) {
      const ch = row[file];
      if (ch === '.' || ch === ' ') continue;
      board[sq(file, rank)] = {
        type: ch.toLowerCase(),
        color: ch === ch.toUpperCase() ? 'w' : 'b',
      };
    }
  });
  return { board, turn, ep: ep === null ? null : parseSquare(ep), halfmove: 0, fullmove: 1 };
}

export function toPlacement(state) {
  const rows = [];
  for (let rank = SIZE - 1; rank >= 0; rank -= 1) {
    let row = '';
    for (let file = 0; file < SIZE; file += 1) {
      const p = state.board[sq(file, rank)];
      row += p ? (p.color === 'w' ? p.type.toUpperCase() : p.type) : '.';
    }
    rows.push(row);
  }
  return rows;
}

export function positionKey(state) {
  const placement = state.board.map((p) => (p ? p.color + p.type : '.')).join('');
  return placement + state.turn + (state.ep === null ? '-' : squareName(state.ep));
}

// Rotationally symmetric starting setup, 8 pieces in total.
export function initialPosition() {
  return fromPlacement(['.qk.', 'p..p', 'p..p', '.KQ.'], 'w');
}

function pseudoMoves(state, color) {
  const moves = [];
  const board = state.board;

  for (let from = 0; from < SIZE * SIZE; from += 1) {
    const piece = board[from];
    if (!piece || piece.color !== color) continue;
    const f = fileOf(from);
    const r = rankOf(from);
    const push = (tf, tr, extra) => {
      if (!inBoard(tf, tr)) return;
      const target = board[sq(tf, tr)];
      if (target && target.type === 'k' && target.color !== color) return;
      moves.push({ from, to: sq(tf, tr), ...extra });
    };

    if (piece.type === 'p') {
      const dir = color === 'w' ? 1 : -1;
      const startRank = color === 'w' ? 1 : 2;
      const promoRank = color === 'w' ? SIZE - 1 : 0;
      const oneRank = r + dir;

      if (inBoard(f, oneRank) && !board[sq(f, oneRank)]) {
        if (rankOf(sq(f, oneRank)) === promoRank) {
          for (const promotion of PIECE_TYPES) push(f, oneRank, { promotion });
        } else {
          push(f, oneRank);
        }
        if (r === startRank && inBoard(f, r + 2 * dir) && !board[sq(f, r + 2 * dir)]) {
          const twoRank = r + 2 * dir;
          if (rankOf(sq(f, twoRank)) === promoRank) {
            for (const promotion of PIECE_TYPES) push(f, twoRank, { promotion, ep: sq(f, oneRank) });
          } else {
            push(f, twoRank, { ep: sq(f, oneRank) });
          }
        }
      }

      for (const df of [-1, 1]) {
        if (!inBoard(f + df, oneRank)) continue;
        const to = sq(f + df, oneRank);
        const target = board[to];
        if (target && target.color !== color) {
          if (rankOf(to) === promoRank) {
            for (const promotion of PIECE_TYPES) push(f + df, oneRank, { promotion });
          } else {
            push(f + df, oneRank);
          }
        } else if (!target && state.ep === to) {
          const captured = sq(f + df, r);
          const victim = board[captured];
          if (victim && victim.type === 'p' && victim.color !== color) {
            push(f + df, oneRank, { epCapture: captured });
          }
        }
      }
      continue;
    }

    if (piece.type === 'n' || piece.type === 'k') {
      const deltas = piece.type === 'n' ? KNIGHT_DELTAS : KING_DELTAS;
      for (const [df, dr] of deltas) {
        const tf = f + df;
        const tr = r + dr;
        if (!inBoard(tf, tr)) continue;
        const target = board[sq(tf, tr)];
        if (!target || target.color !== color) push(tf, tr);
      }
      continue;
    }

    const directions = piece.type === 'r' ? ORTHO : piece.type === 'b' ? DIAG : [...ORTHO, ...DIAG];
    for (const [df, dr] of directions) {
      let tf = f + df;
      let tr = r + dr;
      while (inBoard(tf, tr)) {
        const target = board[sq(tf, tr)];
        if (!target) {
          push(tf, tr);
        } else {
          if (target.color !== color) push(tf, tr);
          break;
        }
        tf += df;
        tr += dr;
      }
    }
  }

  return moves;
}

export function makeMove(state, move) {
  const next = cloneState(state);
  const piece = next.board[move.from];
  if (!piece) throw new Error('no piece on the origin square');

  if (move.epCapture !== undefined) next.board[move.epCapture] = null;
  next.board[move.from] = null;
  next.board[move.to] = move.promotion ? { type: move.promotion, color: piece.color } : piece;
  next.ep = move.ep ?? null;
  next.halfmove = piece.type === 'p' || move.epCapture !== undefined || state.board[move.to] ? 0 : state.halfmove + 1;
  next.turn = opposite(state.turn);
  if (next.turn === 'w') next.fullmove += 1;
  return next;
}

export function findKing(board, color) {
  for (let s = 0; s < SIZE * SIZE; s += 1) {
    const p = board[s];
    if (p && p.type === 'k' && p.color === color) return s;
  }
  return -1;
}

export function isSquareAttacked(board, target, byColor) {
  const tf = fileOf(target);
  const tr = rankOf(target);

  for (const [df, dr] of KNIGHT_DELTAS) {
    const f = tf + df;
    const r = tr + dr;
    if (inBoard(f, r)) {
      const p = board[sq(f, r)];
      if (p && p.color === byColor && p.type === 'n') return true;
    }
  }
  for (const [df, dr] of KING_DELTAS) {
    const f = tf + df;
    const r = tr + dr;
    if (inBoard(f, r)) {
      const p = board[sq(f, r)];
      if (p && p.color === byColor && p.type === 'k') return true;
    }
  }
  const pawnDir = byColor === 'w' ? 1 : -1;
  for (const df of [-1, 1]) {
    const f = tf + df;
    const r = tr - pawnDir;
    if (inBoard(f, r)) {
      const p = board[sq(f, r)];
      if (p && p.color === byColor && p.type === 'p') return true;
    }
  }

  for (const [deltas, types] of [[ORTHO, ['r', 'q']], [DIAG, ['b', 'q']]]) {
    for (const [df, dr] of deltas) {
      let f = tf + df;
      let r = tr + dr;
      while (inBoard(f, r)) {
        const p = board[sq(f, r)];
        if (p) {
          if (p.color === byColor && types.includes(p.type)) return true;
          break;
        }
        f += df;
        r += dr;
      }
    }
  }
  return false;
}

export function inCheck(state, color = state.turn) {
  const king = findKing(state.board, color);
  return king !== -1 && isSquareAttacked(state.board, king, opposite(color));
}

export function legalMoves(state, color = state.turn) {
  return pseudoMoves(state, color).filter((move) => !inCheck(makeMove(state, move), color));
}

function insufficientMaterial(board) {
  const pieces = board.filter(Boolean);
  if (pieces.length === 2) return true;
  if (pieces.length === 3) {
    const odd = pieces.find((p) => p.type !== 'k');
    return !!odd && (odd.type === 'b' || odd.type === 'n');
  }
  return false;
}

// history should include the current position key when repetition matters.
export function getGameStatus(state, history = []) {
  const moves = legalMoves(state);
  const check = inCheck(state);
  if (moves.length === 0) {
    return {
      over: true,
      winner: check ? opposite(state.turn) : null,
      reason: check ? 'checkmate' : 'stalemate',
      check,
    };
  }
  if (insufficientMaterial(state.board)) return { over: true, winner: null, reason: 'insufficient', check };
  if (state.halfmove >= 100) return { over: true, winner: null, reason: 'fifty', check };
  if (history.filter((key) => key === positionKey(state)).length >= 3) {
    return { over: true, winner: null, reason: 'repetition', check };
  }
  return { over: false, winner: null, reason: null, check };
}

function sameMove(a, b) {
  return a.from === b.from && a.to === b.to && (a.promotion ?? null) === (b.promotion ?? null);
}

export function moveToSan(state, move) {
  const piece = state.board[move.from];
  const capture = !!state.board[move.to] || move.epCapture !== undefined;
  let san;

  if (piece.type === 'p') {
    san = capture ? `${FILE_NAMES[fileOf(move.from)]}x${squareName(move.to)}` : squareName(move.to);
    if (move.epCapture !== undefined) san += ' e.p.';
    if (move.promotion) san += `=${move.promotion.toUpperCase()}`;
  } else {
    const rivals = legalMoves(state).filter(
      (m) => !sameMove(m, move) && m.to === move.to &&
        state.board[m.from]?.type === piece.type && state.board[m.from]?.color === piece.color,
    );
    let disambiguation = '';
    if (rivals.length) {
      const sameFile = rivals.some((m) => fileOf(m.from) === fileOf(move.from));
      const sameRank = rivals.some((m) => rankOf(m.from) === rankOf(move.from));
      if (!sameFile) disambiguation = FILE_NAMES[fileOf(move.from)];
      else if (!sameRank) disambiguation = String(rankOf(move.from) + 1);
      else disambiguation = squareName(move.from);
    }
    san = piece.type.toUpperCase() + disambiguation + (capture ? 'x' : '') + squareName(move.to);
  }

  const next = makeMove(state, move);
  if (inCheck(next)) san += legalMoves(next).length ? '+' : '#';
  return san;
}
