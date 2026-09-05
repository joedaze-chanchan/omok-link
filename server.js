/*
 * 오목 링크 서버
 *  - GET /           : 새 방을 만들고 /r/:id 로 이동
 *  - GET /r/:id      : 게임 화면
 *  - WebSocket /ws   : 방 입장, 착수, 기권, 재대국
 *
 * 방 규칙: 링크를 만든 사람이 1번 자리, 그 다음 처음 들어온 사람이 2번 자리, 나머지는 관전.
 * 브라우저마다 고정된 clientId(localStorage)로 자리를 기억하므로 새로고침해도 자리가 유지된다.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const Rules = require('./rules');
const AI = require('./ai');

const BOT_ID = 'bot';
const BOT_NAME = '컴퓨터';
const CHAT_KEEP = 100; // 방마다 보관하는 채팅 줄 수
const AVATARS = ['🙂', '😎', '🐱', '🐶', '🦊', '🐼', '🐸', '🦁', '🐯', '🦄', '👻', '🍀'];
function cleanName(v) { return String(v || '').replace(/\s+/g, ' ').trim().slice(0, 12) || '익명'; }
function cleanAvatar(v) { return AVATARS.includes(v) ? v : AVATARS[0]; }

const PORT = process.env.PORT || 3000;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000; // 마지막 활동 후 24시간 지나면 방 삭제
const DATA_FILE = process.env.OMOK_DATA || path.join(__dirname, 'data', 'rooms.json'); // 서버를 재시작해도 판이 남도록 저장
const PING_MS = 25 * 1000; // 끊어진 연결 감지용 핑 간격
const LOG_FILE = process.env.OMOK_LOG || path.join(__dirname, 'data', 'server.log');

function log(...args) {
  const line = '[' + new Date().toISOString() + '] ' + args.map(a => (a instanceof Error ? (a.stack || a.message) : (typeof a === 'string' ? a : JSON.stringify(a)))).join(' ');
  console.log(line);
  try { fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true }); fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) {}
}
process.on('uncaughtException', (e) => log('uncaughtException', e));
process.on('unhandledRejection', (e) => log('unhandledRejection', e));
process.on('SIGINT', () => { log('SIGINT 수신, 종료'); process.exit(0); });
process.on('SIGTERM', () => { log('SIGTERM 수신, 종료'); process.exit(0); });
process.on('exit', (code) => log('프로세스 종료 code=' + code));

const app = express();
app.get('/', (req, res) => res.redirect('/r/' + newRoomId()));
// 화면과 규칙 파일은 배포 후 바로 최신이 보이도록 캐시하지 않는다
app.get('/rules.js', (req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(path.join(__dirname, 'rules.js')); });
app.get('/r/:id', (req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const rooms = new Map();

// ----- 저장/복구: 서버가 재시작돼도 진행 중인 판이 사라지지 않게 -----
function loadRooms() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const r of raw.rooms || []) {
      rooms.set(r.id, { id: r.id, players: r.players || [], sockets: new Set(), game: r.game, rematch: new Set(r.rematch || []), hands: new Set(), invite: null, touched: r.touched || Date.now(), gameNo: r.gameNo || 1, everFull: !!r.everFull, rules: r.rules || 'simple', botLevel: r.botLevel || 'normal', chat: r.chat || [] });
    }
    log('저장된 방 ' + rooms.size + '개 복구');
  } catch (e) { log('방 복구 실패:', e.message); }
}

let saveTimer = null;
function saveRooms() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      const out = { rooms: [...rooms.values()].map(r => ({ id: r.id, players: r.players, game: r.game, rematch: [...r.rematch], touched: r.touched, gameNo: r.gameNo, everFull: !!r.everFull, rules: r.rules, botLevel: r.botLevel, chat: r.chat })) };
      fs.writeFileSync(DATA_FILE, JSON.stringify(out));
    } catch (e) { log('방 저장 실패:', e.message); }
  }, 300);
}
loadRooms();

function newRoomId() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let id = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) id += alphabet[bytes[i] % alphabet.length];
  return id;
}

function newGame(blackId) {
  return {
    board: Rules.emptyBoard(),
    moves: [],           // {x, y, color}
    turn: Rules.BLACK,
    status: 'waiting',   // waiting | playing | ended
    winner: null,        // BLACK | WHITE | null
    winLine: null,
    endReason: null,     // 'five' | 'resign'
    blackId,             // 이번 판에서 흑을 두는 사람의 clientId
  };
}

function getRoom(id) {
  let room = rooms.get(id);
  if (!room) {
    room = { id, players: [], sockets: new Set(), game: newGame(null), rematch: new Set(), hands: new Set(), invite: null, touched: Date.now(), gameNo: 1, rules: 'simple', botLevel: 'normal', chat: [] };
    rooms.set(id, room);
  }
  room.touched = Date.now();
  return room;
}

function colorOf(room, clientId) {
  const p = room.players.find(p => p.id === clientId);
  if (!p) return null;
  return room.game.blackId === clientId ? Rules.BLACK : Rules.WHITE;
}

function publicState(room) {
  const g = room.game;
  const online = new Set([...room.sockets].map(s => s.clientId));
  const socks = new Map([...room.sockets].map(s => [s.clientId, s]));
  const spectators = [...online].filter(id => !room.players.some(p => p.id === id))
    .map(id => ({ id, name: (socks.get(id) && socks.get(id).name) || '익명', avatar: (socks.get(id) && socks.get(id).avatar) || AVATARS[0], hand: room.hands.has(id) }))
    .sort((a, b) => (b.hand - a.hand) || a.name.localeCompare(b.name));
  return {
    type: 'state',
    room: room.id,
    gameNo: room.gameNo,
    rules: room.rules,
    botLevel: room.botLevel,
    players: room.players.map(p => ({ id: p.id, name: p.name, avatar: p.id === BOT_ID ? '🤖' : (p.avatar || AVATARS[0]), bot: p.id === BOT_ID, color: g.blackId === p.id ? Rules.BLACK : Rules.WHITE, online: p.id === BOT_ID || online.has(p.id) })),
    spectators,
    openSeat: room.players.length < 2,
    invite: room.invite ? { from: room.invite.from, fromName: room.invite.fromName, to: room.invite.to, toName: room.invite.toName } : null,
    board: g.board,
    moves: g.moves,
    turn: g.turn,
    status: g.status,
    winner: g.winner,
    winLine: g.winLine,
    endReason: g.endReason,
    rematch: [...room.rematch],
  };
}

function broadcast(room) {
  const msg = JSON.stringify(publicState(room));
  for (const s of room.sockets) if (s.readyState === 1) s.send(msg);
  scheduleBot(room);
  saveRooms();
}

// ----- 채팅 -----
function pushChat(room, item) {
  room.chat.push(item);
  if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
  const msg = JSON.stringify({ type: 'chat', items: [item] });
  for (const s of room.sockets) if (s.readyState === 1) s.send(msg);
  saveRooms();
}
function sysChat(room, text) { pushChat(room, { sys: true, text, t: Date.now() }); }
function nameOfColor(room, color) {
  const p = room.players.find(p => (room.game.blackId === p.id ? Rules.BLACK : Rules.WHITE) === color);
  return p ? p.name : (color === Rules.BLACK ? '흑' : '백');
}

// 컴퓨터 차례면 잠시 뒤에 둔다
function scheduleBot(room) {
  const g = room.game;
  const bot = room.players.find(p => p.id === BOT_ID);
  if (!bot || g.status !== 'playing') return;
  const botColor = g.blackId === BOT_ID ? Rules.BLACK : Rules.WHITE;
  if (g.turn !== botColor || room.botTimer) return;
  const gameRef = g;
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (room.game !== gameRef || gameRef.status !== 'playing' || gameRef.turn !== botColor) return;
    const m = AI.chooseMove(gameRef.board, botColor, Rules.preset(room.rules), room.botLevel);
    if (!m) return;
    applyMove(room, botColor, m.x, m.y);
    broadcast(room);
  }, (AI.LEVELS[room.botLevel] || AI.LEVELS.normal).delay);
}

// 착수 적용. 문제가 있으면 안내 문자열, 정상이면 null
function applyMove(room, color, x, y) {
  const g = room.game;
  if (g.status !== 'playing') return '지금은 둘 수 없어요.';
  if (g.turn !== color) return '상대 차례예요.';
  if (x < 0 || y < 0 || x >= Rules.SIZE || y >= Rules.SIZE) return '판 밖이에요.';
  if (g.board[y][x] !== Rules.EMPTY) return '이미 돌이 있는 자리예요.';
  const opts = Rules.preset(room.rules);
  const f = Rules.forbidden(g.board, x, y, color, opts);
  if (f) return { '33': '3-3 금수예요.', '44': '4-4 금수예요.', '6': '장목(6목) 금수예요.' }[f];
  const win = Rules.checkWin(g.board, x, y, color, opts);
  g.board[y][x] = color;
  g.moves.push({ x, y, color });
  if (win) {
    g.status = 'ended'; g.winner = color; g.winLine = win; g.endReason = 'five';
    sysChat(room, nameOfColor(room, color) + '(' + (color === Rules.BLACK ? '흑' : '백') + ') 승리 · ' + g.moves.length + '수');
  } else if (g.moves.length === Rules.SIZE * Rules.SIZE) {
    g.status = 'ended'; g.winner = null; g.endReason = 'draw';
    sysChat(room, '무승부');
  } else {
    g.turn = color === Rules.BLACK ? Rules.WHITE : Rules.BLACK;
  }
  return null;
}

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }

// 빈자리에 앉히기. 첫 사람은 방을 만든 사람이라 흑, 그 뒤로는 새로 앉는 사람이 흑(선공)
function seat(room, player) {
  room.players.push(player);
  room.hands.delete(player.id);
  if (room.players.length === 1) {
    room.game = newGame(player.id);
  } else {
    // 방을 만든 두 사람의 첫 판은 만든 사람이 흑, 그 뒤로 새로 앉는 사람은 흑
    const black = room.everFull ? player.id : room.players[0].id;
    room.everFull = true;
    room.game = newGame(black);
    room.game.status = 'playing';
    room.rematch = new Set();
    room.invite = null;
    sysChat(room, '대국 시작 · ' + nameOfColor(room, Rules.BLACK) + '(흑) 대 ' + nameOfColor(room, Rules.WHITE) + '(백)');
  }
  if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }
}

// 자리에서 내보내기(자발적이든 교체든). 남은 사람만으로 대기 상태의 새 판을 준비한다
function vacate(room, clientId) {
  room.players = room.players.filter(p => p.id !== clientId);
  if (room.players.length === 1 && room.players[0].id === BOT_ID) room.players = []; // 컴퓨터만 남으면 같이 내보냄
  if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }
  room.rematch = new Set();
  room.invite = null;
  const remaining = room.players[0];
  room.game = newGame(remaining ? remaining.id : null);
}

function notify(room, clientId, message) {
  for (const s of room.sockets) if (s.clientId === clientId) send(s, { type: 'notice', message });
}

wss.on('error', (e) => log('wss error', e));
server.on('error', (e) => log('http server error', e));

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('error', (e) => log('ws error', e.message));
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try { handle(ws, msg); } catch (e) { log('handle error', e); send(ws, { type: 'error', message: '서버 오류가 났어요. 새로고침해 주세요.' }); }
  });
  ws.on('close', (code) => {
    const room = ws.room;
    if (!room) return;
    log('퇴장', room.id, ws.name, 'code=' + code);
    room.sockets.delete(ws);
    room.touched = Date.now();
    const stillHere = [...room.sockets].some(s => s.clientId === ws.clientId);
    if (!stillHere) {
      room.hands.delete(ws.clientId);
      if (room.invite && (room.invite.from === ws.clientId || room.invite.to === ws.clientId)) room.invite = null;
    }
    broadcast(room);
  });
});

function handle(ws, msg) {
  if (msg.type === 'join') {
    const roomId = String(msg.room || '').slice(0, 32);
    const clientId = String(msg.clientId || '').slice(0, 64);
    const name = cleanName(msg.name);
    const avatar = cleanAvatar(msg.avatar);
    if (!/^[a-z0-9]+$/.test(roomId) || !clientId) return send(ws, { type: 'error', message: '잘못된 링크예요.' });

    const room = getRoom(roomId);
    ws.room = room; ws.clientId = clientId; ws.name = name; ws.avatar = avatar;
    log('입장', roomId, name, clientId);
    const wasHere = [...room.sockets].some(s => s.clientId === clientId);
    room.sockets.add(ws);

    let player = room.players.find(p => p.id === clientId);
    if (player) {
      player.name = name; player.avatar = avatar;
    } else if (room.players.length < 2 && !wasHere) {
      // 처음 들어온 사람은 빈자리에 자동으로 앉는다 (이미 관전 중이던 사람은 「오목 두기」로 직접 앉음)
      seat(room, { id: clientId, name, avatar });
    }
    send(ws, { type: 'you', clientId });
    send(ws, { type: 'chat', items: room.chat, reset: true });
    broadcast(room);
    return;
  }

  const room = ws.room;
  if (!room) return send(ws, { type: 'error', message: '먼저 방에 입장해야 해요.' });
  room.touched = Date.now();
  const g = room.game;
  const myColor = colorOf(room, ws.clientId);

  if (msg.type === 'move') {
    if (myColor === null) return send(ws, { type: 'error', message: '관전자는 돌을 놓을 수 없어요.' });
    const err = applyMove(room, myColor, msg.x | 0, msg.y | 0);
    if (err) return send(ws, { type: 'error', message: err });
    broadcast(room);
    return;
  }

  if (msg.type === 'profile') {
    // 이름·캐릭터 변경. 같은 사람이 언제든 바꿀 수 있다
    const name = cleanName(msg.name), avatar = cleanAvatar(msg.avatar);
    const before = ws.name;
    ws.name = name; ws.avatar = avatar;
    for (const s of room.sockets) if (s.clientId === ws.clientId) { s.name = name; s.avatar = avatar; }
    const p = room.players.find(p => p.id === ws.clientId);
    if (p) { p.name = name; p.avatar = avatar; }
    if (before && before !== name) sysChat(room, before + ' → ' + name + ' 이름 변경');
    broadcast(room);
    return;
  }

  if (msg.type === 'chat') {
    const text = String(msg.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!text) return;
    const now = Date.now();
    if (ws.lastChat && now - ws.lastChat < 300) return; // 도배 방지
    ws.lastChat = now;
    pushChat(room, { id: ws.clientId, name: ws.name || '익명', avatar: ws.avatar || AVATARS[0], role: myColor === Rules.BLACK ? 'b' : (myColor === Rules.WHITE ? 'w' : 's'), text, t: now });
    return;
  }

  if (msg.type === 'setBotLevel') {
    if (myColor === null) return send(ws, { type: 'error', message: '자리에 앉은 사람만 난이도를 바꿀 수 있어요.' });
    if (g.status === 'playing') return send(ws, { type: 'error', message: '대국 중에는 난이도를 바꿀 수 없어요.' });
    if (!AI.LEVELS[msg.level]) return;
    room.botLevel = msg.level;
    sysChat(room, '컴퓨터 난이도: ' + AI.LEVELS[msg.level].name);
    broadcast(room);
    return;
  }

  if (msg.type === 'resign') {
    if (myColor === null || g.status !== 'playing') return;
    g.status = 'ended'; g.winner = myColor === Rules.BLACK ? Rules.WHITE : Rules.BLACK; g.endReason = 'resign';
    sysChat(room, (ws.name || '익명') + ' 기권');
    broadcast(room);
    return;
  }

  const quiet = g.status !== 'playing'; // 대국 중이 아닐 때만 자리 이동 가능

  if (msg.type === 'setRules') {
    if (myColor === null) return send(ws, { type: 'error', message: '자리에 앉은 사람만 규칙을 바꿀 수 있어요.' });
    if (g.status === 'playing') return send(ws, { type: 'error', message: '대국 중에는 규칙을 바꿀 수 없어요.' });
    if (!Rules.PRESETS[msg.rules]) return;
    room.rules = msg.rules;
    sysChat(room, '규칙 변경: ' + Rules.PRESETS[msg.rules].name);
    broadcast(room);
    return;
  }

  if (msg.type === 'addBot') {
    if (myColor === null) return send(ws, { type: 'error', message: '자리에 앉은 사람만 컴퓨터를 부를 수 있어요.' });
    if (room.players.length >= 2) return send(ws, { type: 'error', message: '이미 두 자리가 다 찼어요.' });
    if (AI.LEVELS[msg.level]) room.botLevel = msg.level;
    seat(room, { id: BOT_ID, name: BOT_NAME });
    broadcast(room);
    return;
  }

  if (msg.type === 'hand') {
    if (myColor !== null) return;
    if (msg.up) room.hands.add(ws.clientId); else room.hands.delete(ws.clientId);
    broadcast(room);
    return;
  }

  if (msg.type === 'takeSeat') {
    if (myColor !== null) return;
    if (room.players.length >= 2) return send(ws, { type: 'error', message: '이미 두 자리가 다 찼어요.' });
    seat(room, { id: ws.clientId, name: ws.name || '익명' });
    broadcast(room);
    return;
  }

  if (msg.type === 'leaveSeat') {
    if (myColor === null) return;
    if (!quiet) return send(ws, { type: 'error', message: '대국 중에는 기권을 먼저 해주세요.' });
    vacate(room, ws.clientId);
    broadcast(room);
    return;
  }

  if (msg.type === 'invite') {
    if (myColor === null) return;
    if (!quiet) return send(ws, { type: 'error', message: '대국이 끝난 뒤에 초대할 수 있어요.' });
    const to = String(msg.to || '');
    const target = [...room.sockets].find(s => s.clientId === to);
    if (!target || room.players.some(p => p.id === to)) return send(ws, { type: 'error', message: '지금은 초대할 수 없는 사람이에요.' });
    room.invite = { from: ws.clientId, fromName: ws.name || '익명', to, toName: target.name || '익명' };
    broadcast(room);
    return;
  }

  if (msg.type === 'inviteCancel') {
    if (room.invite && room.invite.from === ws.clientId) { room.invite = null; broadcast(room); }
    return;
  }

  if (msg.type === 'inviteReply') {
    const inv = room.invite;
    if (!inv || inv.to !== ws.clientId) return;
    room.invite = null;
    if (!msg.accept) { notify(room, inv.from, inv.toName + '님이 초대를 거절했어요.'); broadcast(room); return; }
    if (!room.players.some(p => p.id === inv.from) || g.status === 'playing') { send(ws, { type: 'error', message: '초대가 더 이상 유효하지 않아요.' }); broadcast(room); return; }
    // 초대한 사람은 남고, 상대는 관전으로. 초대받은 사람이 흑(선공)
    const replaced = room.players.find(p => p.id !== inv.from);
    room.players = room.players.filter(p => p.id === inv.from);
    if (replaced) notify(room, replaced.id, inv.fromName + '님이 ' + inv.toName + '님과 새 대국을 시작해서 관전으로 바뀌었어요.');
    seat(room, { id: ws.clientId, name: ws.name || '익명' });
    broadcast(room);
    return;
  }

  if (msg.type === 'rematch') {
    if (myColor === null || g.status !== 'ended') return;
    room.rematch.add(ws.clientId);
    if (room.players.some(p => p.id === BOT_ID)) room.rematch.add(BOT_ID); // 컴퓨터는 항상 응함
    if (room.players.length === 2 && room.players.every(p => room.rematch.has(p.id))) {
      // 색을 바꿔서 새 판
      const prevBlack = g.blackId;
      const nextBlack = room.players.find(p => p.id !== prevBlack).id;
      room.game = newGame(nextBlack);
      room.game.status = 'playing';
      room.rematch = new Set();
      room.gameNo += 1;
    }
    broadcast(room);
    return;
  }
}

// 응답 없는 연결 정리 (핑에 답이 없으면 끊고, 클라이언트가 다시 붙는다)
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }
}, PING_MS).unref();

// 오래된 방 정리
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.sockets.size === 0 && now - room.touched > ROOM_TTL_MS) { rooms.delete(id); saveRooms(); }
  }
}, 60 * 1000).unref();

server.listen(PORT, () => log('오목 서버 실행 중: http://localhost:' + PORT + ' (pid ' + process.pid + ')'));
