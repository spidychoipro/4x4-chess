import { fromPlacement } from './rules.js';

// Every stage below was generated and verified by tools/find-puzzles.mjs:
// one unique first move, forced mate in exactly `mateIn` moves. No dice rolls.
export const PUZZLES = [
  {
    id: 'stage-1', name: '첫 수', rows: ['....', '.Q..', '.K.k', '....'], mateIn: 1,
    tip: '퀸이 노리는 대각선을 확인해 보세요.',
  },
  {
    id: 'stage-2', name: '긴 장', rows: ['....', '....', '.KR.', '...k'], mateIn: 2,
    tip: '상대 왕을 구석으로 몰아넣으세요.',
  },
  {
    id: 'stage-3', name: '폰 대결', rows: ['....', 'k...', 'PpK.', '.Q..'], mateIn: 2,
    tip: '폰은 앞으로는 못 가지만, 대각선으로 잡을 수 있어요.',
  },
  {
    id: 'stage-4', name: '사제의 길', rows: ['k...', '...R', '.B..', '...K'], mateIn: 2,
    tip: '같은 색 칸만 다니는 비숍의 길을 노리세요.',
  },
  {
    id: 'stage-5', name: '기사의 방해', rows: ['..r.', 'KQNk', '....', '....'], mateIn: 2,
    tip: '상대 룩이 지키는 칸을 나이트가 끊어야 해요.',
  },
  {
    id: 'stage-6', name: '승격 직전', rows: ['K...', '..P.', 'k.p.', '...Q'], mateIn: 2,
    tip: '마지막 줄에 닿는 폰은 퀸이 될 수 있어요.',
  },
  {
    id: 'stage-7', name: '좁은 공간', rows: ['.K..', '..PN', 'p.k.', 'B...'], mateIn: 3,
    tip: '기물이 적어도 왕 혼자서는 못 이깁니다. 협력하세요.',
  },
  {
    id: 'stage-8', name: '무거운 조각', rows: ['....', '.RKR', '....', '..kq'], mateIn: 2,
    tip: '퀸을 잡는 것만이 답은 아닐 수도 있어요.',
  },
  {
    id: 'stage-9', name: '마지막 방어', rows: ['K..Q', '.PrP', '.p..', '...k'], mateIn: 3,
    tip: '상대 폰이 승격하려는 길을 미리 막으세요.',
  },
  {
    id: 'stage-10', name: '왕관의 무게', rows: ['.R..', '.P.K', '..pn', 'k..B'], mateIn: 3,
    tip: '한 수씩만 보지 말고, 세 수 뒤의 왕을 그려보세요.',
  },
];

// Rotationally symmetric 8-piece starting position used for AI and 2-player games.
export const MATCH_ROWS = ['.qk.', '.pb.', '.BP.', '.KQ.'];

export function puzzleState(puzzle) {
  return fromPlacement(puzzle.rows, 'w');
}

export function matchState() {
  return fromPlacement(MATCH_ROWS, 'w');
}
