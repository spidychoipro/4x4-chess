export const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

export function rollDie(random = Math.random) {
  const value = Math.floor(random() * 6);
  return Math.min(5, Math.max(0, value)) + 1;
}

export function decideFirstMove(first, second) {
  if (first > second) return 'first';
  if (second > first) return 'second';
  return 'tie';
}
