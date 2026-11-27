import { PUZZLES, puzzleState, matchState } from './puzzles.js';
import {
  cloneState, legalMoves, makeMove, moveToSan, getGameStatus, positionKey,
  findKing, fileOf, rankOf, sq, squareName, opposite,
} from './rules.js';
import { pickMove } from './ai.js';
import { findForcedMate } from './solver.js';

const STORAGE = {
  progress: '4x4chess.progress.v1',
  settings: '4x4chess.settings.v1',
};

const GLYPH = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};
const PIECE_NAME = { k: '왕', q: '퀸', r: '룩', b: '비숍', n: '나이트', p: '폰' };
const COLOR_NAME = { w: '흰색', b: '검정' };
const DRAW_REASON = {
  stalemate: '스테일메이트: 둘 수는 없지만 체크는 아니에요.',
  insufficient: '남은 기물으로는 체크메이트가 불가능해요.',
  fifty: '50수 동안 폰 이동이나 잡기가 없었어요.',
  repetition: '같은 위치가 세 번 반복됐어요.',
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage disabled */ }
}

const settings = {
  mode: 'puzzle',
  levelIndex: 0,
  difficulty: 'normal',
  humanColor: 'w',
  flipped: false,
  sound: true,
  ...readJSON(STORAGE.settings, {}),
};
let progress = readJSON(STORAGE.progress, {});

const $ = (id) => document.getElementById(id);
const ui = {
  board: $('board'), promotion: $('promotion'), status: $('status'), statusNote: $('status-note'),
  levels: $('levels'), levelCounter: $('level-counter'), levelName: $('level-name'), levelMeta: $('level-meta'),
  puzzlePanel: $('puzzle-panel'), matchPanel: $('match-panel'), sideField: $('side-field'),
  difficulty: $('difficulty'), side: $('side'), moves: $('moves'), moveCounter: $('move-counter'),
  hintBtn: $('hint-btn'), soundBtn: $('sound-btn'), toast: $('toast'),
  playerTop: $('player-top'), playerBottom: $('player-bottom'),
  playerTopName: $('player-top-name'), playerBottomName: $('player-bottom-name'),
  rulesDialog: $('rules-dialog'), resultDialog: $('result-dialog'),
  resultTitle: $('result-title'), resultDesc: $('result-desc'), resultStars: $('result-stars'),
  resultPrimary: $('result-primary'),
};

let game = null;
let aiToken = 0;
let pendingPromotion = null;
let resultAction = () => {};
let toastTimer = 0;
let audioContext = null;

function persistSettings() { writeJSON(STORAGE.settings, settings); }

function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('is-visible'), 2600);
}

function beep(frequency, duration = 0.08, type = 'triangle', volume = 0.045) {
  if (!settings.sound) return;
  try {
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  } catch { /* audio not available */ }
}

function currentPuzzle() { return PUZZLES[settings.levelIndex]; }

function isAITurn() {
  return !!game?.aiColor && game.state.turn === game.aiColor;
}

function setupGame() {
  aiToken += 1;
  let state;
  let aiColor = null;
  if (settings.mode === 'puzzle') {
    state = puzzleState(currentPuzzle());
    aiColor = 'b';
  } else {
    state = matchState();
    aiColor = settings.mode === 'ai' ? opposite(settings.humanColor) : null;
  }
  const humanColor = settings.mode === 'local' ? null
    : settings.mode === 'puzzle' ? 'w' : settings.humanColor;

  game = {
    mode: settings.mode,
    state,
    aiColor,
    humanColor,
    positions: [cloneState(state)],
    keys: [positionKey(state)],
    log: [],
    selected: null,
    legal: [],
    result: null,
    thinking: false,
    hintsUsed: 0,
    playerMoves: 0,
    lastMove: null,
  };
  pendingPromotion = null;
  ui.promotion.hidden = true;
  if (ui.resultDialog.open) ui.resultDialog.close();
  render();
  if (isAITurn()) scheduleAI();
}

function displayOrder() {
  const order = [];
  for (let displayRank = 0; displayRank < 4; displayRank += 1) {
    const rank = settings.flipped ? displayRank : 3 - displayRank;
    for (let file = 0; file < 4; file += 1) order.push(sq(file, rank));
  }
  return order;
}

function squareLabel(square, piece) {
  const base = `${squareName(square)}, ${piece ? `${COLOR_NAME[piece.color]} ${PIECE_NAME[piece.type]}` : '빈 칸'}`;
  return game.selected === square ? `${base}, 선택됨` : base;
}

function renderBoard() {
  const order = displayOrder();
  const status = game.result ?? getGameStatus(game.state, game.keys);
  const checkSquare = status.check ? findKing(game.state.board, game.state.turn) : -1;
  const fragment = document.createDocumentFragment();

  for (const square of order) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `square ${(fileOf(square) + rankOf(square)) % 2 === 0 ? 'dark' : 'light'}`;
    button.dataset.square = String(square);
    if (game.lastMove && (game.lastMove.from === square || game.lastMove.to === square)) {
      button.classList.add('is-last');
    }
    if (game.selected === square) button.classList.add('is-selected');
    if (square === checkSquare) button.classList.add('is-check');

    const target = game.legal.find((move) => move.to === square);
    if (target) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.setAttribute('aria-hidden', 'true');
      button.appendChild(dot);
      if (game.state.board[square] || target.epCapture !== undefined) button.classList.add('is-capture');
    }

    const piece = game.state.board[square];
    if (piece) {
      const glyph = document.createElement('span');
      glyph.className = `piece ${piece.color}`;
      glyph.textContent = GLYPH[piece.color][piece.type];
      glyph.setAttribute('aria-hidden', 'true');
      button.appendChild(glyph);
    }

    const coordinate = document.createElement('span');
    coordinate.className = 'coord';
    coordinate.textContent = squareName(square);
    coordinate.setAttribute('aria-hidden', 'true');
    button.appendChild(coordinate);

    button.setAttribute('aria-label', squareLabel(square, piece));
    button.setAttribute('aria-pressed', game.selected === square ? 'true' : 'false');
    fragment.appendChild(button);
  }
  ui.board.replaceChildren(fragment);
}

function renderLevels() {
  const stars = PUZZLES.map((puzzle) => progress[puzzle.id] ?? 0);
  const firstOpen = stars.findIndex((value) => value === 0);
  const maxOpen = firstOpen === -1 ? PUZZLES.length - 1 : firstOpen;
  const fragment = document.createDocumentFragment();

  PUZZLES.forEach((puzzle, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'level-btn';
    if (index === settings.levelIndex && settings.mode === 'puzzle') button.classList.add('is-current');
    button.disabled = index > maxOpen;
    button.dataset.level = String(index);
    button.setAttribute('aria-label', `${index + 1}단계 ${puzzle.name}${button.disabled ? ', 잠김' : ''}`);
    const number = document.createElement('span');
    number.textContent = String(index + 1);
    const marks = document.createElement('span');
    marks.className = 'level-stars';
    marks.textContent = stars[index] ? '★'.repeat(stars[index]) : button.disabled ? '🔒' : '· · ·';
    button.append(number, marks);
    fragment.appendChild(button);
  });
  ui.levels.replaceChildren(fragment);
}

function renderStatus() {
  const status = game.result ?? getGameStatus(game.state, game.keys);
  if (game.thinking) {
    ui.status.textContent = '상대가 생각 중…';
  } else if (status.over) {
    if (status.reason === 'checkmate') ui.status.textContent = `${COLOR_NAME[status.winner]} 체크메이트!`;
    else ui.status.textContent = `무승부 · ${DRAW_REASON[status.reason] ?? ''}`;
  } else {
    ui.status.textContent = `${COLOR_NAME[game.state.turn]} 차례${status.check ? ' · 체크!' : ''}`;
  }
  ui.statusNote.textContent = game.result
    ? '다시 하기로 한 번 더 도전해 보세요.'
    : game.thinking ? '잠시만 기다려 주세요.'
      : game.humanColor !== null && game.state.turn !== game.humanColor ? '상대의 수를 기다리는 중이에요.'
        : '말을 누른 뒤 이동할 칸을 누르세요.';
}

function renderPlayers() {
  const topColor = settings.flipped ? 'w' : 'b';
  const label = (color) => {
    if (game.mode === 'local') return COLOR_NAME[color];
    return color === game.humanColor ? `${COLOR_NAME[color]} · 나` : `${COLOR_NAME[color]} · AI`;
  };
  ui.playerTopName.textContent = label(topColor);
  ui.playerBottomName.textContent = label(opposite(topColor));
  ui.playerTop.classList.toggle('is-turn', !game.result && game.state.turn === topColor);
  ui.playerBottom.classList.toggle('is-turn', !game.result && game.state.turn === opposite(topColor));
}

function renderMoves() {
  const fragment = document.createDocumentFragment();
  if (!game.log.length) {
    const empty = document.createElement('li');
    empty.className = 'moves-empty';
    empty.textContent = '아직 두지 않았어요.';
    fragment.appendChild(empty);
  } else {
    for (let i = 0; i < game.log.length; i += 2) {
      const row = document.createElement('li');
      const number = document.createElement('span');
      number.className = 'move-no';
      number.textContent = `${Math.floor(i / 2) + 1}.`;
      const white = document.createElement('span');
      white.textContent = game.log[i].san;
      const black = document.createElement('span');
      black.textContent = game.log[i + 1]?.san ?? '';
      row.append(number, white, black);
      fragment.appendChild(row);
    }
  }
  ui.moves.replaceChildren(fragment);
  ui.moveCounter.textContent = `${game.log.length}수`;
}

function render() {
  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.mode === settings.mode;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-pressed', String(active));
  });
  ui.puzzlePanel.hidden = settings.mode !== 'puzzle';
  ui.matchPanel.hidden = settings.mode === 'puzzle';
  ui.sideField.hidden = settings.mode !== 'ai';
  ui.hintBtn.hidden = settings.mode === 'local';
  ui.hintBtn.disabled = !!game.result || game.thinking ||
    game.humanColor === null || game.state.turn !== game.humanColor;

  const puzzle = currentPuzzle();
  ui.levelCounter.textContent = `${settings.levelIndex + 1} / ${PUZZLES.length}`;
  ui.levelName.textContent = puzzle.name;
  ui.levelMeta.textContent = `${puzzle.mateIn}수 안에 체크메이트`;

  renderBoard();
  renderLevels();
  renderStatus();
  renderPlayers();
  renderMoves();
}

function applyMove(move) {
  const captured = move.epCapture !== undefined || !!game.state.board[move.to];
  const san = moveToSan(game.state, move);
  const mover = game.state.turn;
  const next = makeMove(game.state, move);

  if (mover === game.humanColor) game.playerMoves += 1;
  game.positions.push(cloneState(next));
  game.keys.push(positionKey(next));
  game.log.push({ san, color: mover, move });
  game.state = next;
  game.lastMove = move;
  game.selected = null;
  game.legal = [];
  pendingPromotion = null;
  ui.promotion.hidden = true;

  beep(captured ? 220 : 440, 0.07, captured ? 'sawtooth' : 'triangle');
  const status = getGameStatus(game.state, game.keys);
  if (status.over) {
    game.thinking = false;
    game.result = status;
    beep(status.winner ? 660 : 300, 0.22, 'sine', 0.06);
    showResult(status);
  }
  render();
  if (!status.over && isAITurn()) scheduleAI();
  else if (!status.over && status.check) beep(780, 0.12, 'square', 0.03);
}

function scheduleAI() {
  const token = ++aiToken;
  game.thinking = true;
  render();
  setTimeout(() => {
    if (token !== aiToken || !game || game.result || !isAITurn()) return;
    const choice = pickMove(game.state, settings.difficulty);
    game.thinking = false;
    if (choice?.move) applyMove(choice.move);
  }, 320 + Math.random() * 220);
}

function showResult(status) {
  let title;
  let description;
  let stars = 0;

  if (status.reason === 'checkmate') {
    const winner = COLOR_NAME[status.winner];
    if (game.mode === 'local') {
      title = `${winner} 승리!`;
      description = `${winner}이(가) 체크메이트를 만들었어요.`;
    } else if (status.winner === game.humanColor) {
      title = '체크메이트!';
      const puzzle = currentPuzzle();
      description = game.mode === 'puzzle'
        ? `${puzzle.mateIn}수 안에 상대 왕을 잡았어요.`
        : `${winner}이(가) 이겼어요.`;
    } else {
      title = '체크메이트';
      description = `${winner}이(가) 이겼어요. 다시 도전해 보세요.`;
    }
  } else {
    title = '무승부';
    description = DRAW_REASON[status.reason] ?? '게임이 끝났어요.';
  }

  if (game.mode === 'puzzle' && status.winner === 'w') {
    const puzzle = currentPuzzle();
    const extra = Math.max(0, game.playerMoves - puzzle.mateIn);
    stars = Math.max(1, 3 - (extra > 0 ? 1 : 0) - (game.hintsUsed > 0 ? 1 : 0));
    progress[puzzle.id] = Math.max(progress[puzzle.id] ?? 0, stars);
    writeJSON(STORAGE.progress, progress);
  }

  ui.resultTitle.textContent = title;
  ui.resultDesc.textContent = description;
  ui.resultStars.textContent = stars ? `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}` : '';
  const hasNext = game.mode === 'puzzle' && status.winner === 'w' && settings.levelIndex < PUZZLES.length - 1;
  ui.resultPrimary.textContent = hasNext ? '다음 단계' : '다시 하기';
  resultAction = hasNext
    ? () => { settings.levelIndex += 1; persistSettings(); setupGame(); }
    : () => setupGame();
  if (!ui.resultDialog.open) ui.resultDialog.showModal();
}

function undo() {
  if (!game || game.log.length === 0) return;
  aiToken += 1;
  const steps = game.mode === 'local' ? 1 : game.aiColor ? 2 : 1;
  for (let i = 0; i < steps && game.log.length; i += 1) {
    game.log.pop();
    game.positions.pop();
    game.keys.pop();
  }
  game.state = cloneState(game.positions.at(-1));
  game.lastMove = game.log.at(-1)?.move ?? null;
  game.playerMoves = game.log.filter((entry) => entry.color === game.humanColor).length;
  game.result = null;
  game.thinking = false;
  game.selected = null;
  game.legal = [];
  pendingPromotion = null;
  ui.promotion.hidden = true;
  if (ui.resultDialog.open) ui.resultDialog.close();
  render();
}

function hint() {
  if (game.mode === 'local') { toast('2인용에서는 힌트를 쓸 수 없어요.'); return; }
  if (!game || game.result || game.thinking || game.state.turn !== game.humanColor) return;
  let move = null;
  if (game.mode === 'puzzle') {
    const puzzle = currentPuzzle();
    const remaining = Math.max(1, puzzle.mateIn - game.playerMoves);
    move = findForcedMate(game.state, remaining, 'w')?.[0] ?? null;
  }
  if (!move) move = pickMove(game.state, settings.difficulty)?.move ?? null;
  if (!move) return;
  game.hintsUsed += 1;
  toast(`추천 수: ${moveToSan(game.state, move)}`);
  render();
}

function selectSquare(square) {
  if (!game || game.result || game.thinking) return;
  if (game.humanColor !== null && game.state.turn !== game.humanColor) return;

  const target = game.legal.find((move) => move.to === square);
  if (game.selected !== null && target) {
    const promotions = game.legal.filter((move) => move.to === square && move.promotion);
    if (promotions.length) {
      pendingPromotion = promotions;
      ui.promotion.hidden = false;
      return;
    }
    applyMove(target);
    return;
  }

  const piece = game.state.board[square];
  if (piece && piece.color === game.state.turn &&
      (game.humanColor === null || piece.color === game.humanColor)) {
    game.selected = square;
    game.legal = legalMoves(game.state).filter((move) => move.from === square);
  } else {
    game.selected = null;
    game.legal = [];
  }
  render();
}

function switchMode(mode) {
  if (settings.mode === mode) return;
  settings.mode = mode;
  if (mode === 'ai') settings.humanColor = ui.side.value === 'b' ? 'b' : 'w';
  persistSettings();
  setupGame();
}

function bindEvents() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchMode(tab.dataset.mode));
  });
  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => $(button.dataset.close).close());
  });
  $('rules-btn').addEventListener('click', () => ui.rulesDialog.showModal());
  $('undo-btn').addEventListener('click', undo);
  $('reset-btn').addEventListener('click', setupGame);
  $('new-btn').addEventListener('click', setupGame);
  $('flip-btn').addEventListener('click', () => {
    settings.flipped = !settings.flipped;
    persistSettings();
    render();
  });
  ui.soundBtn.addEventListener('click', () => {
    settings.sound = !settings.sound;
    persistSettings();
    ui.soundBtn.classList.toggle('is-off', !settings.sound);
    ui.soundBtn.setAttribute('aria-label', settings.sound ? '소리 끄기' : '소리 켜기');
    ui.soundBtn.textContent = settings.sound ? '♪' : '♩';
  });
  ui.hintBtn.addEventListener('click', hint);
  ui.difficulty.addEventListener('change', () => {
    settings.difficulty = ui.difficulty.value;
    persistSettings();
  });
  ui.side.addEventListener('change', () => {
    settings.humanColor = ui.side.value;
    persistSettings();
    if (settings.mode === 'ai') setupGame();
  });
  ui.levels.addEventListener('click', (event) => {
    const button = event.target.closest('[data-level]');
    if (!button || button.disabled) return;
    settings.levelIndex = Number(button.dataset.level);
    persistSettings();
    setupGame();
  });

  ui.board.addEventListener('click', (event) => {
    const button = event.target.closest('[data-square]');
    if (button) selectSquare(Number(button.dataset.square));
  });
  ui.board.addEventListener('keydown', (event) => {
    const current = event.target.closest?.('[data-square]');
    if (!current) return;
    const order = displayOrder();
    const index = order.indexOf(Number(current.dataset.square));
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 }[event.key];
    if (delta === undefined) return;
    const next = order[index + delta];
    if (next !== undefined) {
      event.preventDefault();
      ui.board.querySelector(`[data-square="${next}"]`)?.focus();
    }
  });

  ui.promotion.querySelectorAll('[data-piece]').forEach((button) => {
    button.addEventListener('click', () => {
      const move = pendingPromotion?.find((candidate) => candidate.promotion === button.dataset.piece);
      if (move) applyMove(move);
    });
  });
  ui.resultPrimary.addEventListener('click', () => resultAction());
  $('result-close').addEventListener('click', () => ui.resultDialog.close());
}

function init() {
  settings.levelIndex = Math.max(0, Math.min(PUZZLES.length - 1, Number(settings.levelIndex) || 0));
  ui.difficulty.value = settings.difficulty;
  ui.side.value = settings.humanColor;
  ui.soundBtn.classList.toggle('is-off', !settings.sound);
  ui.soundBtn.setAttribute('aria-label', settings.sound ? '소리 끄기' : '소리 켜기');
  ui.soundBtn.textContent = settings.sound ? '♪' : '♩';
  bindEvents();
  setupGame();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

init();
