const test = require('node:test');
const assert = require('node:assert');
const R = require('../rules');

const B = R.BLACK, W = R.WHITE;

function boardFrom(rows) {
  // rows: array of 15 strings, 'X' black, 'O' white, '.' empty. Shorter rows padded.
  const b = R.emptyBoard();
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === 'X') b[y][x] = B;
      else if (row[x] === 'O') b[y][x] = W;
    }
  });
  return b;
}

test('board is 15x15', () => {
  const b = R.emptyBoard();
  assert.strictEqual(b.length, 15);
  assert.ok(b.every(r => r.length === 15));
});

test('five in a row wins (horizontal)', () => {
  const b = boardFrom(['XXXX.']);
  const res = R.checkWin(b, 4, 0, B);
  assert.ok(res, 'should win');
  assert.strictEqual(res.length, 5);
});

test('five in a row wins (diagonal)', () => {
  const b = boardFrom([
    'X....',
    '.X...',
    '..X..',
    '...X.',
    '.....',
  ]);
  assert.ok(R.checkWin(b, 4, 4, B));
});

test('black overline (6) does not win, white overline wins', () => {
  const b = boardFrom(['XXX.XX']);
  assert.strictEqual(R.checkWin(b, 3, 0, B), null);
  const w = boardFrom(['OOO.OO']);
  assert.ok(R.checkWin(w, 3, 0, W));
});

test('black exact five wins even if it would otherwise look forbidden', () => {
  // vertical four + horizontal four, placing completes a five vertically
  const b = boardFrom([
    '..X..',
    '..X..',
    '..X..',
    '..X..',
    'XX.XX',
  ]);
  assert.ok(R.checkWin(b, 2, 4, B));
  assert.strictEqual(R.forbidden(b, 2, 4), null);
});

test('black 3-3 is forbidden', () => {
  const b = boardFrom([
    '.......',
    '.......',
    '..XX...',
    '.......',
    '..X....',
    '..X....',
    '.......',
  ]);
  // placing at (2,3) would form horizontal? no: forms vertical three (2,3),(2,4),(2,5)
  // and ... let's build a clean cross: horizontal .XX_ and vertical .XX_ meeting
  const c = boardFrom([
    '.......',
    '.......',
    '.......',
    '...XX..',
    '.......',
    '.......',
    '.......',
  ]);
  c[5][2] = B; c[6][2] = B; // vertical stones at (2,5),(2,6); placing (2,4)? that's a diff column
  // Use straightforward: row 3 has X at (3,3),(4,3); col 2 has X at (2,5),(2,6)? Not intersecting.
  const d = boardFrom([
    '.......',
    '.......',
    '.......',
    '..XX...',   // (2,3),(3,3)
    '.......',
    '.X.....',   // (1,5)
    '.X.....',   // (1,6)
    '.......',
  ]);
  // placing (1,3) makes horizontal three (1,3),(2,3),(3,3) open, and vertical? (1,3),(1,5),(1,6) has gap -> broken three also open three
  assert.strictEqual(R.forbidden(d, 1, 3), '33');
});

test('black 4-4 is forbidden', () => {
  const b = boardFrom([
    '.......',
    '.X.....',
    '.X.....',
    '.X.....',
    '.......',
    '.......',
  ]);
  // vertical three at (1,1),(1,2),(1,3); horizontal three at (2,4),(3,4),(4,4); placing (1,4) makes two fours
  b[4][2] = B; b[4][3] = B; b[4][4] = B;
  assert.strictEqual(R.forbidden(b, 1, 4), '44');
});

test('black overline is forbidden', () => {
  const b = boardFrom(['XXX.XX']);
  assert.strictEqual(R.forbidden(b, 3, 0), '6');
});

test('a normal move is not forbidden and white is never forbidden', () => {
  const b = boardFrom(['XX....']);
  assert.strictEqual(R.forbidden(b, 2, 0), null);
  const w = boardFrom(['OOO.OO']);
  assert.strictEqual(R.forbidden(w, 3, 0, W), null);
});

test('simple preset: 4-4 and overline allowed, 3-3 still forbidden, black wins with 6', () => {
  const S = R.PRESETS.simple;
  const b44 = boardFrom(['.......', '.X.....', '.X.....', '.X.....', '..XXX..']);
  assert.strictEqual(R.forbidden(b44, 1, 4, B, S), null);
  const b6 = boardFrom(['XXX.XX']);
  assert.strictEqual(R.forbidden(b6, 3, 0, B, S), null);
  assert.ok(R.checkWin(b6, 3, 0, B, S), 'six in a row wins for black under simple rules');
  // 연속삼 + 띈삼: 기본 규칙에서는 허용, 렌주룰에서는 3-3
  const broken = boardFrom(['.......', '.......', '.......', '..XX...', '.......', '.X.....', '.X.....']);
  assert.strictEqual(R.forbidden(broken, 1, 3, B, S), null);
  assert.strictEqual(R.forbidden(broken, 1, 3, B, R.PRESETS.renju), '33');
  // 연속삼 + 연속삼(ㄱ자)은 기본 규칙에서도 3-3
  const solid = boardFrom(['.......', '.......', '.......', '..XX...', '....X..', '....X..']);
  assert.strictEqual(R.forbidden(solid, 4, 3, B, S), '33');
  // 대각선 연속삼 두 개(X자)도 3-3
  const cross = boardFrom(['.......', '.......', '..X.X..', '.......', '..X.X..']);
  assert.strictEqual(R.forbidden(cross, 3, 3, B, S), '33');
});

test('three with an opponent stone blocking is not open (no 3-3)', () => {
  const b = boardFrom([
    'O......',
    '.X.....',
    '..X....',
    '.......',
    '...XX.O',
  ]);
  // placing (3,3): diagonal (1,1),(2,2),(3,3) blocked by O at (0,0) -> not open; horizontal (3,4)? no, (3,3) isn't in row 4.
  assert.strictEqual(R.forbidden(b, 3, 3), null);
});
