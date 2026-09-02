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
