/*
 * 컴퓨터 상대 (휴리스틱)
 *  1) 바로 이기는 수가 있으면 둔다
 *  2) 상대가 다음 수에 이기는 자리는 막는다
 *  3) 그 외에는 5칸 창(window) 점수로 공격+수비 가치를 합산해 가장 높은 자리를 고른다
 * 흑일 때는 금수 자리를 피한다.
 */
const Rules = require('./rules');
const { SIZE, EMPTY, BLACK, WHITE } = Rules;
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const WEIGHT = [0, 1, 8, 64, 700, 100000]; // 창 안의 내 돌 개수별 점수

// 난이도. noise: 점수에 섞는 무작위 크기, blockChance: 상대 5목 위협을 막을 확률, lookahead: 상대 응수까지 내다보기
const LEVELS = {
  easy:   { key: 'easy',   name: '쉬움',   noise: 400, blockChance: 0.6, lookahead: false, delay: 400 },
  normal: { key: 'normal', name: '보통',   noise: 0.5, blockChance: 1,   lookahead: false, delay: 600 },
  hard:   { key: 'hard',   name: '어려움', noise: 0.5, blockChance: 1,   lookahead: true,  delay: 900 },
};

function inside(x, y) { return x >= 0 && y >= 0 && x < SIZE && y < SIZE; }

// (x,y)에 color를 놓았다고 가정하고 그 자리를 지나는 모든 5칸 창의 점수 합
function windowScore(board, x, y, color) {
  const opp = color === BLACK ? WHITE : BLACK;
  let score = 0;
  for (const [dx, dy] of DIRS) {
    for (let start = -4; start <= 0; start++) {
      let own = 0, blocked = false;
      for (let k = 0; k < 5; k++) {
        const cx = x + dx * (start + k), cy = y + dy * (start + k);
        if (!inside(cx, cy)) { blocked = true; break; }
        const v = (cx === x && cy === y) ? color : board[cy][cx];
        if (v === opp) { blocked = true; break; }
        if (v === color) own++;
      }
      if (!blocked) score += WEIGHT[own];
    }
  }
  return score;
}

function candidates(board) {
  const set = new Set();
  let any = false;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (board[y][x] === EMPTY) continue;
    any = true;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const cx = x + dx, cy = y + dy;
      if (inside(cx, cy) && board[cy][cx] === EMPTY) set.add(cy * SIZE + cx);
    }
  }
  if (!any) return [{ x: 7, y: 7 }];
  return [...set].map(k => ({ x: k % SIZE, y: Math.floor(k / SIZE) }));
}

function chooseMove(board, color, opts, level) {
  opts = opts || Rules.DEFAULT_RULES;
  const L = LEVELS[level] || LEVELS.normal;
  const opp = color === BLACK ? WHITE : BLACK;
  const cands = candidates(board).filter(c => !Rules.forbidden(board, c.x, c.y, color, opts));
  if (cands.length === 0) {
    // 후보가 전부 금수면 아무 빈칸이나 (금수 아닌 곳)
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++)
      if (board[y][x] === EMPTY && !Rules.forbidden(board, x, y, color, opts)) return { x, y };
    return null;
  }
  // 1) 즉시 승리
  for (const c of cands) if (Rules.checkWin(board, c.x, c.y, color, opts)) return c;
  // 2) 상대 즉시 승리 차단 (쉬움은 가끔 놓친다)
  if (Math.random() < L.blockChance) {
    for (const c of cands) if (Rules.checkWin(board, c.x, c.y, opp, opts) && !Rules.forbidden(board, c.x, c.y, opp, opts)) return c;
  }
  // 3) 점수
  const scored = cands.map(c => {
    const attack = windowScore(board, c.x, c.y, color);
    const defense = windowScore(board, c.x, c.y, opp);
    const center = -(Math.abs(c.x - 7) + Math.abs(c.y - 7)) * 0.01;
    return { c, s: attack + defense * 0.9 + center + Math.random() * L.noise };
  }).sort((a, b) => b.s - a.s);
  if (!L.lookahead) return scored[0].c;

  // 4) 어려움: 상위 후보마다 상대의 최선 응수까지 내다보고, 상대에게 좋은 자리를 내주는 수는 피한다
  let best = scored[0].c, bestVal = -Infinity;
  for (const { c, s } of scored.slice(0, 8)) {
    board[c.y][c.x] = color;
    let oppBest = 0;
    if (!Rules.checkWin(board, c.x, c.y, color, opts)) {
      for (const o of candidates(board)) {
        if (Rules.forbidden(board, o.x, o.y, opp, opts)) continue;
        const v = Rules.checkWin(board, o.x, o.y, opp, opts) ? 1e6 : windowScore(board, o.x, o.y, opp) + 0.9 * windowScore(board, o.x, o.y, color);
        if (v > oppBest) oppBest = v;
      }
    }
    board[c.y][c.x] = EMPTY;
    const val = s - 0.7 * oppBest;
    if (val > bestVal) { bestVal = val; best = c; }
  }
  return best;
}

module.exports = { chooseMove, windowScore, LEVELS };
