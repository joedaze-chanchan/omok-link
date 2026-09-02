/*
 * 오목 규칙 (렌주룰) — 서버와 브라우저가 같은 파일을 공유합니다.
 *  - 15x15, 흑 선공
 *  - 5목이면 승리. 흑은 정확히 5개여야 하고(장목 6목 이상은 승리 아님), 백은 5개 이상이면 승리
 *  - 흑 금수: 3-3, 4-4, 장목(6목 이상). 단 5목을 완성하는 수는 금수가 아니라 승리
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OmokRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SIZE = 15;
  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

  function emptyBoard() {
    return Array.from({ length: SIZE }, () => new Array(SIZE).fill(EMPTY));
  }
  function inside(x, y) { return x >= 0 && y >= 0 && x < SIZE && y < SIZE; }

  // 한 방향의 연속 돌 좌표(놓은 돌 포함)
  function runThrough(board, x, y, dx, dy, color) {
    const cells = [[x, y]];
    for (const s of [1, -1]) {
      let cx = x + dx * s, cy = y + dy * s;
      while (inside(cx, cy) && board[cy][cx] === color) {
        cells.push([cx, cy]);
        cx += dx * s; cy += dy * s;
      }
    }
    return cells;
  }

  // (x,y)에 color 돌을 놓았을 때 승리하는지. 승리하면 돌 좌표 배열, 아니면 null
  function checkWin(board, x, y, color) {
    const prev = board[y][x];
    board[y][x] = color;
    let result = null;
    for (const [dx, dy] of DIRS) {
      const run = runThrough(board, x, y, dx, dy, color);
      const n = run.length;
      if ((color === BLACK && n === 5) || (color === WHITE && n >= 5)) { result = run; break; }
    }
    board[y][x] = prev;
    return result;
  }

  // 방향 선을 -R..+R 범위로 잘라 배열로 만든다. 1: 내 돌, 0: 빈칸, -1: 상대 돌 또는 벽. 가운데(index R)는 놓을 돌.
  const R = 5;
  function lineArray(board, x, y, dx, dy, color) {
    const arr = [];
    for (let i = -R; i <= R; i++) {
      const cx = x + dx * i, cy = y + dy * i;
      if (i === 0) { arr.push(1); continue; }
      if (!inside(cx, cy)) { arr.push(-1); continue; }
      const v = board[cy][cx];
      arr.push(v === EMPTY ? 0 : (v === color ? 1 : -1));
    }
    return arr;
  }

  // arr[idx]가 1이라고 가정하고 idx를 포함하는 연속 구간 [lo, hi]
  function runBounds(arr, idx) {
    let lo = idx, hi = idx;
    while (lo - 1 >= 0 && arr[lo - 1] === 1) lo--;
    while (hi + 1 < arr.length && arr[hi + 1] === 1) hi++;
    return [lo, hi];
  }

  // 빈칸 i에 돌을 놓으면 가운데 돌을 포함한 '정확히 5'가 되는가
  function makesExactFive(arr, i) {
    arr[i] = 1;
    const [lo, hi] = runBounds(arr, i);
    arr[i] = 0;
    return lo <= R && R <= hi && hi - lo + 1 === 5;
  }

  // 이 방향에서 만들어지는 '4'의 개수 (열린 4는 1개로 센다)
  function countFours(arr) {
    const cells = [];
    for (let i = 0; i < arr.length; i++) if (arr[i] === 0 && makesExactFive(arr, i)) cells.push(i);
    if (cells.length === 0) return 0;
    if (cells.length === 2) {
      // 열린 4 (XXXX 양끝이 5 완성 칸)인지 확인
      const [lo, hi] = runBounds(arr, R);
      if (hi - lo + 1 === 4 && cells[0] === lo - 1 && cells[1] === hi + 1) return 1;
    }
    return cells.length;
  }

  // 빈칸 i에 돌을 놓으면 열린 4(양쪽 모두 5 완성 가능한 연속 4)가 되는가
  function makesOpenFour(arr, i) {
    arr[i] = 1;
    const [lo, hi] = runBounds(arr, i);
    let ok = false;
    if (lo <= R && R <= hi && hi - lo + 1 === 4) {
      const l = lo - 1, h = hi + 1;
      ok = l >= 0 && h < arr.length && arr[l] === 0 && arr[h] === 0 && makesExactFive(arr, l) && makesExactFive(arr, h);
    }
    arr[i] = 0;
    return ok;
  }

  // 이 방향에서 열린 3이 되는가 (한 수 더 두면 열린 4가 되는 3)
  function isOpenThree(arr) {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === 0 && makesOpenFour(arr, i)) return true;
    }
    return false;
  }

  // 흑의 금수 판정. 금수면 '33' | '44' | '6', 아니면 null. 백은 항상 null.
  function forbidden(board, x, y, color) {
    color = color || BLACK;
    if (color !== BLACK) return null;
    if (board[y][x] !== EMPTY) return null;
    if (checkWin(board, x, y, BLACK)) return null; // 5목 완성은 승리

    board[y][x] = BLACK;
    let over = false, fours = 0, threes = 0;
    for (const [dx, dy] of DIRS) {
      const run = runThrough(board, x, y, dx, dy, BLACK);
      if (run.length >= 6) { over = true; break; }
      const arr = lineArray(board, x, y, dx, dy, BLACK);
      fours += countFours(arr);
      if (isOpenThree(arr)) threes++;
    }
    board[y][x] = EMPTY;

    if (over) return '6';
    if (fours >= 2) return '44';
    if (threes >= 2) return '33';
    return null;
  }

  // 현재 흑 차례에 표시할 금수 자리 목록
  function forbiddenPoints(board) {
    const pts = [];
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      if (board[y][x] === EMPTY) { const f = forbidden(board, x, y, BLACK); if (f) pts.push({ x, y, type: f }); }
    }
    return pts;
  }

  return { SIZE, EMPTY, BLACK, WHITE, emptyBoard, checkWin, forbidden, forbiddenPoints };
});
