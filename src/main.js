import { PUZZLES, puzzleState, matchState } from './puzzles.js';
import { CLASSIC_LEVELS, classicInfo, classicState } from './classic.js';
import {
  cloneState, legalMoves, makeMove, moveToSan, getGameStatus, positionKey,
  findKing, fileOf, rankOf, sq, squareName, opposite,
} from './rules.js';
import { BOTS, resolveBot, pickMove } from './ai.js';
import { DICE_FACES, decideFirstMove, rollDie } from './dice.js';
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
  mode: 'classic',
  levelIndex: 0,
  classicLevel: 1,
  classicOpponent: 'bot',
  botElo: 1000,
  humanColor: 'w',
  flipped: false,
  sound: true,
  ...readJSON(STORAGE.settings, {}),
};
let progress = readJSON(STORAGE.progress, {});

// 예전 설정 파일에 남아 있던 쉬움/보통/어려움 값을 레이팅으로 옮긴다.
const legacyRating = { easy: 100, normal: 1000, hard: 2000 };
if (!Number.isFinite(settings.botElo)) settings.botElo = legacyRating[settings.difficulty] ?? 1000;
if (settings.classicOpponent !== 'local') settings.classicOpponent = 'bot';

const $ = (id) => document.getElementById(id);
const ui = {
  board: $('board'), promotion: $('promotion'), status: $('status'), statusNote: $('status-note'),
  levels: $('levels'), levelCounter: $('level-counter'), levelName: $('level-name'), levelMeta: $('level-meta'),
  classicPanel: $('classic-panel'), classicLevels: $('classic-levels'), classicInfo: $('classic-info'),
  classicCounter: $('classic-counter'), classicOpponent: $('classic-opponent'),
  clock: $('clock'), promotionCancel: $('promotion-cancel'),
  diceOverlay: $('dice-overlay'), diceTitle: $('dice-title'), diceNote: $('dice-note'),
  diceButton: $('dice-btn'), dieFirst: $('die-first'), dieSecond: $('die-second'),
  puzzlePanel: $('puzzle-panel'), matchPanel: $('match-panel'), sideField: $('side-field'),
  difficulty: $('difficulty'), botDesc: $('bot-desc'), matchNote: $('match-note'),
  side: $('side'), moves: $('moves'), moveCounter: $('move-counter'),
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
let clockTimer = 0;
let diceTimer = 0;
let diceRolling = false;

function persistSettings() { writeJSON(STORAGE.settings, settings); }

function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast.classList.remove('is-visible');
    ui.toast.textContent = '';
  }, 2600);
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

function currentBotElo() {
  if (settings.mode === 'classic' && settings.classicOpponent === 'bot') {
    return classicInfo(settings.classicLevel).botElo;
  }
  return settings.botElo;
}

function classicUnlocked() {
  return Math.max(1, Math.min(CLASSIC_LEVELS, Number(progress.classic) || 1));
}

function isClassicLocal() {
  return settings.mode === 'classic' && settings.classicOpponent === 'local';
}

function isAITurn() {
  return !!game?.aiColor && game.state.turn === game.aiColor;
}

function usesDice() {
  return settings.mode === 'classic' || settings.mode === 'local';
}

function viewFlipped() {
  if (game?.humanColor === 'b') return !settings.flipped;
  return settings.flipped;
}

function diceParticipants() {
  if (settings.mode === 'classic') {
    return { first: '귀하', second: '상대방', firstColor: 'w', secondColor: 'b' };
  }
  return { first: '흰색', second: '검정', firstColor: 'w', secondColor: 'b' };
}

function diceResultText(winner) {
  if (game.mode === 'classic') {
    return winner === 'first'
      ? '귀하의 숫자가 더 크기 때문에, 귀하가 첫 번째로 이동합니다.'
      : '상대방의 숫자가 더 크기 때문에, 상대방이 첫 번째로 이동합니다.';
  }
  const name = winner === 'first' ? '흰색' : '검정';
  return `${name}의 숫자가 더 크기 때문에, ${name}이 첫 번째로 이동합니다.`;
}

function diceTieText() {
  if (game.mode === 'classic') return '귀하와 상대방의 숫자가 같기 때문에, 다시 시도하십시오.';
  return '흰색과 검정의 숫자가 같기 때문에, 다시 시도하십시오.';
}

function renderDice() {
  if (!game?.dice) return;
  ui.dieFirst.textContent = DICE_FACES[game.dice[0] - 1];
  ui.dieSecond.textContent = DICE_FACES[game.dice[1] - 1];
  ui.dieFirst.setAttribute('aria-label', `첫 번째 주사위 ${game.dice[0]}`);
  ui.dieSecond.setAttribute('aria-label', `두 번째 주사위 ${game.dice[1]}`);
  ui.dieFirst.classList.toggle('is-rolling', diceRolling);
  ui.dieSecond.classList.toggle('is-rolling', diceRolling);
}

function stopDiceAnimation() {
  clearInterval(diceTimer);
  diceTimer = 0;
  diceRolling = false;
}

function beginAfterDice() {
  ui.diceOverlay.hidden = true;
  game.phase = 'playing';
  render();
  focusSquare(displayOrder()[0]);
  if (isAITurn()) scheduleAI();
  startClock();
}

function handleDiceButton() {
  if (!game || game.phase !== 'dice') return;

  if (diceRolling) {
    stopDiceAnimation();
    beep(520, 0.08, 'square', 0.035);
    const winner = decideFirstMove(...game.dice);
    if (winner === 'tie') {
      game.diceResult = 'tie';
      ui.diceNote.textContent = diceTieText();
      ui.diceButton.textContent = '다시 굴리기';
    } else {
      const { firstColor, secondColor } = diceParticipants();
      game.diceResult = winner;
      game.firstColor = winner === 'first' ? firstColor : secondColor;
      if (game.mode === 'classic') {
        game.humanColor = game.firstColor;
        game.aiColor = opposite(game.humanColor);
      }
      game.state.turn = game.firstColor;
      game.positions[0] = cloneState(game.state);
      game.keys[0] = positionKey(game.state);
      ui.diceNote.textContent = `${diceResultText(winner)} 화면을 터치하여 게임을 시작하세요.`;
      ui.diceButton.textContent = '게임 시작';
    }
    render();
    return;
  }

  if (game.diceResult === 'tie') {
    startDiceSelection();
  } else if (game.diceResult) {
    beginAfterDice();
  }
}

function startDiceSelection() {
  stopDiceAnimation();
  game.phase = 'dice';
  game.diceResult = null;
  game.firstColor = null;
  game.dice = [rollDie(), rollDie()];
  ui.diceOverlay.hidden = false;
  ui.diceTitle.textContent = '주도권을 쥘 플레이어를 결정합니다.';
  ui.diceNote.textContent = '플레이어는 화면을 터치하여 주사위를 멈추고 큰 숫자를 얻은 플레이어가 첫 번째로 이동합니다.';
  ui.diceButton.textContent = '주사위 멈추기';
  diceRolling = true;
  diceTimer = setInterval(() => {
    if (!game || game.phase !== 'dice' || !diceRolling) return;
    game.dice = [rollDie(), rollDie()];
    renderDice();
  }, 110);
  renderDice();
  render();
  ui.diceButton.focus();
}

function stopClock() {
  clearInterval(clockTimer);
  clockTimer = 0;
}

function renderClock() {
  if (!game?.timeLimit) {
    ui.clock.hidden = true;
    return;
  }
  const left = Math.max(0, game.timeLeft);
  const minutes = Math.floor(left / 60);
  const seconds = String(left % 60).padStart(2, '0');
  ui.clock.hidden = false;
  ui.clock.textContent = `${minutes}분 ${seconds}초`;
  ui.clock.classList.toggle('is-low', left <= 10);
  ui.clock.setAttribute('aria-label', `남은 시간 ${minutes}분 ${seconds}초`);
}

function startClock() {
  stopClock();
  if (!game?.timeLimit) return;
  clockTimer = setInterval(() => {
    if (!game || game.phase !== 'playing' || game.result || game.thinking ||
        game.state.turn !== game.humanColor) return;
    game.timeLeft = Math.max(0, game.timeLeft - 1);
    renderClock();
    if (game.timeLeft === 0) {
      stopClock();
      game.result = { over: true, reason: 'timeout', winner: opposite(game.humanColor) };
      beep(220, 0.3, 'sine', 0.06);
      showResult(game.result);
      render();
    }
  }, 1000);
  renderClock();
}

function setupGame() {
  aiToken += 1;
  stopClock();
  stopDiceAnimation();
  let state;
  let aiColor = null;
  let info = null;

  if (settings.mode === 'classic') {
    info = classicInfo(settings.classicLevel);
    state = classicState(settings.classicLevel);
    aiColor = isClassicLocal() ? null : 'b';
  } else if (settings.mode === 'puzzle') {
    state = puzzleState(currentPuzzle());
    aiColor = 'b';
  } else {
    state = matchState();
    aiColor = settings.mode === 'ai' ? opposite(settings.humanColor) : null;
  }

  const humanColor = settings.mode === 'local' || isClassicLocal() ? null
    : settings.mode === 'puzzle' || settings.mode === 'classic' ? 'w' : settings.humanColor;

  game = {
    mode: settings.mode,
    state,
    info,
    aiColor,
    humanColor,
    positions: [cloneState(state)],
    keys: [positionKey(state)],
    log: [],
    selected: null,
    legal: [],
    result: null,
    thinking: false,
    phase: 'playing',
    dice: null,
    diceResult: null,
    firstColor: null,
    hintsUsed: 0,
    playerMoves: 0,
    lastMove: null,
    timeLimit: info?.timeLimit ?? null,
    timeLeft: info?.timeLimit ?? 0,
  };
  pendingPromotion = null;
  ui.promotion.hidden = true;
  if (ui.resultDialog.open) ui.resultDialog.close();

  if (usesDice()) {
    startDiceSelection();
    return;
  }

  ui.diceOverlay.hidden = true;
  render();
  if (isAITurn()) scheduleAI();
  startClock();
}

function displayOrder() {
  const order = [];
  for (let displayRank = 0; displayRank < 4; displayRank += 1) {
    const rank = viewFlipped() ? displayRank : 3 - displayRank;
    for (let file = 0; file < 4; file += 1) order.push(sq(file, rank));
  }
  return order;
}

function focusSquare(square) {
  ui.board.querySelectorAll('[data-square]').forEach((button) => {
    button.tabIndex = Number(button.dataset.square) === square ? 0 : -1;
  });
  ui.board.querySelector(`[data-square="${square}"]`)?.focus();
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
    button.tabIndex = square === (game.selected ?? order[0]) ? 0 : -1;
    fragment.appendChild(button);
  }
  ui.board.replaceChildren(fragment);
  ui.board.classList.toggle('is-locked', game.phase !== 'playing');
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

function renderClassicLevels() {
  const unlocked = classicUnlocked();
  const info = classicInfo(settings.classicLevel);
  const fragment = document.createDocumentFragment();

  ui.classicCounter.textContent = `${settings.classicLevel} / ${CLASSIC_LEVELS}`;
  ui.classicInfo.textContent = `${info.pieces.map((type) => PIECE_NAME[type]).join('·')} ${info.patternName} 배치`
    + `${info.timeLimit ? ` · ${info.timeLimit}초` : ''} · 상대 ${currentBotElo()}점`;

  for (let level = 1; level <= CLASSIC_LEVELS; level += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'level-btn';
    if (level === settings.classicLevel && settings.mode === 'classic') button.classList.add('is-current');
    button.disabled = level > unlocked;
    button.dataset.classicLevel = String(level);
    button.setAttribute('aria-label', `클래식 ${level}단계${button.disabled ? ', 잠김' : ''}`);
    const number = document.createElement('span');
    number.textContent = String(level);
    const marks = document.createElement('span');
    marks.className = 'level-stars';
    marks.textContent = button.disabled ? '🔒' : level < unlocked ? '✓' : '지금';
    button.append(number, marks);
    fragment.appendChild(button);
  }
  ui.classicLevels.replaceChildren(fragment);
}

function renderStatus() {
  if (game.phase === 'dice') {
    ui.status.textContent = '주사위로 선공을 정하는 중';
    ui.statusNote.textContent = ui.diceNote.textContent;
    return;
  }

  const status = game.result ?? getGameStatus(game.state, game.keys);
  if (game.thinking) {
    ui.status.textContent = '상대가 생각 중…';
  } else if (status.over) {
    if (status.reason === 'checkmate') ui.status.textContent = `${COLOR_NAME[status.winner]} 체크메이트!`;
    else if (status.reason === 'timeout') ui.status.textContent = '시간이 다 됐어요.';
    else ui.status.textContent = `무승부 · ${DRAW_REASON[status.reason] ?? ''}`;
  } else {
    ui.status.textContent = `${COLOR_NAME[game.state.turn]} 차례${status.check ? ' · 체크!' : ''}`;
  }
  ui.statusNote.textContent = game.result
    ? game.mode === 'classic' ? '다시 하기를 누르면 새 배치로 시작해요.' : '다시 하기를 누르면 처음부터 시작해요.'
    : game.thinking ? '상대가 수를 고르고 있어요.'
      : game.humanColor !== null && game.state.turn !== game.humanColor ? '상대의 수를 기다리는 중이에요.'
        : '말을 누른 뒤 이동할 칸을 누르세요.';
}

function renderPlayers() {
  const topColor = viewFlipped() ? 'w' : 'b';
  const active = !game.result && game.phase === 'playing';
  const label = (color) => {
    if (game.mode === 'local' || isClassicLocal()) return COLOR_NAME[color];
    if (color === game.humanColor) return `${COLOR_NAME[color]} · 나`;
    return `${COLOR_NAME[color]} · AI ${currentBotElo()}`;
  };
  ui.playerTopName.textContent = label(topColor);
  ui.playerBottomName.textContent = label(opposite(topColor));
  ui.playerTop.classList.toggle('is-turn', active && game.state.turn === topColor);
  ui.playerBottom.classList.toggle('is-turn', active && game.state.turn === opposite(topColor));
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
  ui.classicPanel.hidden = settings.mode !== 'classic';
  ui.puzzlePanel.hidden = settings.mode !== 'puzzle';
  ui.matchPanel.hidden = settings.mode === 'local' || settings.mode === 'classic';
  ui.sideField.hidden = settings.mode !== 'ai';
  ui.matchNote.textContent = settings.mode === 'puzzle'
    ? '도전 코스의 방어 상대 강도도 여기서 바꿀 수 있어요.'
    : '원하는 레이팅의 봇을 골라 붙으세요.';
  ui.classicOpponent.value = settings.classicOpponent;
  ui.hintBtn.hidden = settings.mode === 'local' || isClassicLocal();
  ui.hintBtn.querySelector('span').hidden = settings.mode !== 'puzzle';
  ui.hintBtn.disabled = game.phase !== 'playing' || !!game.result || game.thinking ||
    game.humanColor === null || game.state.turn !== game.humanColor;
  if (game.phase === 'dice') renderDice();

  const puzzle = currentPuzzle();
  ui.levelCounter.textContent = `${settings.levelIndex + 1} / ${PUZZLES.length}`;
  ui.levelName.textContent = puzzle.name;
  ui.levelMeta.textContent = `${puzzle.mateIn}수 안에 체크메이트`;

  renderBoard();
  renderClassicLevels();
  renderLevels();
  renderStatus();
  renderPlayers();
  renderMoves();
  renderClock();
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
    if (token !== aiToken || !game || game.phase !== 'playing' || game.result || !isAITurn()) return;
    const choice = pickMove(game.state, currentBotElo());
    game.thinking = false;
    if (choice?.move) applyMove(choice.move);
  }, 320 + Math.random() * 220);
}

function showResult(status) {
  let title;
  let description;
  let markText = '';
  let hasNext = false;

  if (status.reason === 'checkmate') {
    const winner = COLOR_NAME[status.winner];
    if (game.mode === 'local' || isClassicLocal()) {
      title = '게임 끝.';
      description = `${winner}이(가) 이겼습니다.`;
    } else if (game.mode === 'classic') {
      title = '게임 끝.';
      description = status.winner === game.humanColor ? '당신이 이겼습니다.' : '상대가 이겼습니다.';
    } else if (status.winner === game.humanColor) {
      title = '체크메이트!';
      description = game.mode === 'puzzle'
        ? `${currentPuzzle().mateIn}수 안에 상대 왕을 움직일 수 없게 만들었어요.`
        : `${winner}이(가) 이겼어요.`;
    } else {
      title = '체크메이트';
      description = `${winner}이(가) 이겼어요. 다시 도전해 보세요.`;
    }
  } else if (status.reason === 'timeout') {
    title = '시간 초과';
    description = '제한시간 안에 끝내지 못했어요. 다시 도전해 보세요.';
  } else {
    title = '무승부';
    description = DRAW_REASON[status.reason] ?? '게임이 끝났어요.';
  }

  if (game.mode === 'puzzle' && status.winner === 'w') {
    const extra = Math.max(0, game.playerMoves - currentPuzzle().mateIn);
    const stars = Math.max(1, 3 - (extra > 0 ? 1 : 0) - (game.hintsUsed > 0 ? 1 : 0));
    markText = `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`;
    progress[currentPuzzle().id] = Math.max(progress[currentPuzzle().id] ?? 0, stars);
    writeJSON(STORAGE.progress, progress);
    hasNext = settings.levelIndex < PUZZLES.length - 1;
    resultAction = hasNext
      ? () => { settings.levelIndex += 1; persistSettings(); setupGame(); }
      : () => setupGame();
  } else if (game.mode === 'classic' && status.winner === game.humanColor && !isClassicLocal()) {
    const next = Math.min(CLASSIC_LEVELS, settings.classicLevel + 1);
    markText = '✓ 클리어';
    if (next > classicUnlocked()) {
      progress.classic = next;
      writeJSON(STORAGE.progress, progress);
    }
    hasNext = settings.classicLevel < CLASSIC_LEVELS;
    resultAction = hasNext
      ? () => { settings.classicLevel += 1; persistSettings(); setupGame(); }
      : () => setupGame();
  } else {
    resultAction = () => setupGame();
  }

  ui.resultTitle.textContent = title;
  ui.resultDesc.textContent = description;
  ui.resultStars.textContent = markText;
  ui.resultPrimary.textContent = hasNext ? '다음 단계' : game.mode === 'classic' ? '새 판' : '다시 하기';
  if (!ui.resultDialog.open) ui.resultDialog.showModal();
}

function undo() {
  if (!game || game.phase !== 'playing' || game.log.length === 0) return;
  if (game.result?.reason === 'timeout') { toast('시간이 끝난 판은 되돌릴 수 없어요.'); return; }
  aiToken += 1;
  stopClock();
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
  startClock();
}

function hint() {
  if (game.mode === 'local' || isClassicLocal()) { toast('2인용에서는 힌트를 쓸 수 없어요.'); return; }
  if (!game || game.phase !== 'playing' || game.result || game.thinking ||
      game.state.turn !== game.humanColor) return;
  let move = null;
  if (game.mode === 'puzzle') {
    const puzzle = currentPuzzle();
    const remaining = Math.max(1, puzzle.mateIn - game.playerMoves);
    move = findForcedMate(game.state, remaining, 'w')?.[0] ?? null;
  }
  if (!move) move = pickMove(game.state, currentBotElo())?.move ?? null;
  if (!move) return;
  game.hintsUsed += 1;
  toast(`추천 수: ${moveToSan(game.state, move)}`);
  render();
}

function selectSquare(square) {
  if (!game || game.phase !== 'playing' || game.result || game.thinking) return;
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
  if (game?.log.length && !window.confirm('지금 판을 버리고 모드를 바꿀까요?')) return;
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
  ui.diceButton.addEventListener('click', handleDiceButton);
  ui.diceOverlay.addEventListener('click', (event) => {
    if (event.target === ui.diceOverlay) handleDiceButton();
  });
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
    settings.botElo = Number(ui.difficulty.value);
    ui.botDesc.textContent = resolveBot(settings.botElo).desc;
    persistSettings();
    render();
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
  ui.classicLevels.addEventListener('click', (event) => {
    const button = event.target.closest('[data-classic-level]');
    if (!button || button.disabled) return;
    settings.classicLevel = Number(button.dataset.classicLevel);
    persistSettings();
    setupGame();
  });
  ui.classicOpponent.addEventListener('change', () => {
    settings.classicOpponent = ui.classicOpponent.value === 'local' ? 'local' : 'bot';
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
      focusSquare(next);
    }
  });

  ui.promotion.querySelectorAll('[data-piece]').forEach((button) => {
    button.addEventListener('click', () => {
      const move = pendingPromotion?.find((candidate) => candidate.promotion === button.dataset.piece);
      if (move) applyMove(move);
    });
  });
  ui.promotionCancel.addEventListener('click', () => {
    pendingPromotion = null;
    ui.promotion.hidden = true;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || ui.promotion.hidden) return;
    pendingPromotion = null;
    ui.promotion.hidden = true;
  });
  ui.resultPrimary.addEventListener('click', () => resultAction());
  $('result-close').addEventListener('click', () => ui.resultDialog.close());
}

function init() {
  if (!['classic', 'puzzle', 'ai', 'local'].includes(settings.mode)) settings.mode = 'classic';
  settings.levelIndex = Math.max(0, Math.min(PUZZLES.length - 1, Number(settings.levelIndex) || 0));
  settings.classicLevel = Math.max(1, Math.min(CLASSIC_LEVELS, Number(settings.classicLevel) || 1));
  settings.botElo = resolveBot(settings.botElo).elo;
  const botOptions = BOTS.map((bot) => {
    const option = document.createElement('option');
    option.value = String(bot.elo);
    option.textContent = `${bot.elo} · ${bot.name}`;
    return option;
  });
  ui.difficulty.replaceChildren(...botOptions);
  ui.difficulty.value = String(settings.botElo);
  ui.botDesc.textContent = resolveBot(settings.botElo).desc;
  ui.classicOpponent.value = settings.classicOpponent;
  ui.side.value = settings.humanColor;
  ui.soundBtn.classList.toggle('is-off', !settings.sound);
  ui.soundBtn.setAttribute('aria-label', settings.sound ? '소리 끄기' : '소리 켜기');
  ui.soundBtn.textContent = settings.sound ? '♪' : '♩';
  bindEvents();
  setupGame();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

init();
