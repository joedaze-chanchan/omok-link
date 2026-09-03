const test = require('node:test');
const assert = require('node:assert');
const R = require('../rules');
const AI = require('../ai');

const B = R.BLACK, W = R.WHITE;

function boardFrom(rows) {
  const b = R.emptyBoard();
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === 'X') b[y][x] = B;
      else if (row[x] === 'O') b[y][x] = W;
    }
  });
  return b;
}

test('empty board: plays center', () => {
  assert.deepStrictEqual(AI.chooseMove(R.emptyBoard(), B), { x: 7, y: 7 });
});

test('takes an immediate win', () => {
  const b = boardFrom([
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '.....OOOO......',
    '.....XXXX......',
  ]);
  // white to move: (4,6) or (9,6) wins
  const m = AI.chooseMove(b, W);
  assert.ok(R.checkWin(b, m.x, m.y, W), 'should win at ' + JSON.stringify(m));
});

test('blocks opponent immediate win', () => {
  const b = boardFrom([
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '.....O.........',
    '.....XXXX......',
  ]);
  const m = AI.chooseMove(b, W);
  assert.ok((m.x === 4 && m.y === 7) || (m.x === 9 && m.y === 7), 'should block at an end, got ' + JSON.stringify(m));
});

test('levels: all three return legal moves and hard blocks a four', () => {
  const b = boardFrom([
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '...............',
    '.....O.........',
    '.....XXXX......',
  ]);
  for (const lv of ['easy', 'normal', 'hard']) {
    const m = AI.chooseMove(b, W, R.PRESETS.renju, lv);
    assert.ok(m && b[m.y][m.x] === R.EMPTY, lv + ' returns an empty cell');
  }
  const h = AI.chooseMove(b, W, R.PRESETS.renju, 'hard');
  assert.ok((h.x === 4 && h.y === 7) || (h.x === 9 && h.y === 7), 'hard blocks the open four, got ' + JSON.stringify(h));
});

test('black never picks a forbidden point', () => {
  // (1,3) is a 3-3 for black; make it attractive but forbidden
  const b = boardFrom([
    '.......',
    '.......',
    '.......',
    '..XX...',
    '.......',
    '.X.....',
    '.X.....',
  ]);
  b[10][10] = W; b[10][11] = W;
  for (let i = 0; i < 20; i++) {
    const m = AI.chooseMove(b, B);
    assert.strictEqual(R.forbidden(b, m.x, m.y, B), null);
  }
});
