'use strict';
// Server Benteng Fajar (tanpa dependency):
//   1. menyajikan file game (index.html, /js, /css, /assets)
//   2. relay WebSocket untuk multiplayer: meneruskan pesan antarpemain (2–4) dalam satu ruangan
// Jalankan: node server.js   (opsi: PORT=8080 HOST=0.0.0.0)
// Server tidak menjalankan logika game dan tidak menyimpan data apa pun.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');

const PORT = +process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.bin': 'application/octet-stream', '.jpg': 'image/jpeg' };
const CODE = ['.html', '.js', '.css'];   // jenis file yang boleh diambil dari luar /assets
const MAX_MSG = 32 * 1024;   // byte per pesan
const MAX_CONN = 400;
const MAX_ROOMS = 200;
const ROOM_MAX = 4;          // klien per ruangan
const RATE = 150;            // pesan per detik per koneksi
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// ---------------------------------------------------------------- file statis

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); res.end(); return; }
  if (p === '/') p = '/index.html';
  const ext = path.extname(p);
  // Hanya file game yang boleh diakses; server.js, tests, dsb. tidak disajikan.
  const inCode = CODE.includes(ext) && (p === '/index.html' || p.startsWith('/js/') || p.startsWith('/css/'));
  const allowed = TYPES[ext] && (inCode || (p.startsWith('/assets/') && !CODE.includes(ext))) && !p.includes('..') && !p.includes('\0');
  const file = path.join(ROOT, p);
  if (!allowed || !file.startsWith(ROOT + path.sep)) { res.writeHead(404); res.end('Not found'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[ext], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

// ---------------------------------------------------------------- WebSocket (RFC 6455)

const conns = new Set(), rooms = new Map();

function sendFrame(c, op, payload) {
  if (c.socket.destroyed) return;
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
  c.socket.write(Buffer.concat([head, payload]));
}
const send = (c, obj) => sendFrame(c, 0x1, Buffer.from(JSON.stringify(obj)));

// Ruangan: clients[slot] (slot 0 = tuan rumah). Di lobi (belum dikunci) ruangan milik tuan rumah: bila ia keluar, ruangan
// ditutup untuk semua. Tamu yang keluar dari lobi, atau siapa pun yang keluar setelah permainan dimulai, hanya
// mengosongkan slotnya; klien lain diberi tahu slot mana yang pergi dan ruangan bertahan sampai kosong.
function leaveRoom(c) {
  const room = c.room;
  if (!room) return;
  c.room = null;
  const slot = room.clients.indexOf(c);
  if (!room.started && slot === 0) {
    rooms.delete(room.code);
    for (const o of room.clients) if (o && o !== c) { o.room = null; send(o, { t: 'left', slot: 0, closed: true }); }
    return;
  }
  room.clients[slot] = null;
  if (!room.clients.some(Boolean)) { rooms.delete(room.code); return; }
  for (const o of room.clients) if (o) send(o, { t: 'left', slot });
}

function drop(c) {
  if (!conns.delete(c)) return;
  leaveRoom(c);
  c.socket.destroy();
}

function newCode() {
  for (let tries = 0; tries < 50; tries++) {
    let code = '';
    for (const b of crypto.randomBytes(4)) code += CODE_CHARS[b % CODE_CHARS.length];
    if (!rooms.has(code)) return code;
  }
  return null;
}

function onMessage(c, text) {
  if (++c.count > RATE) { drop(c); return; }
  let m;
  try { m = JSON.parse(text); } catch (e) { drop(c); return; }
  if (!m || typeof m !== 'object') return;
  if (m.t === 'create') {
    if (c.room) return;
    const code = rooms.size < MAX_ROOMS ? newCode() : null;
    if (!code) { send(c, { t: 'error', m: 'Server penuh, coba lagi nanti' }); return; }
    c.room = { code, clients: [c].concat(new Array(ROOM_MAX - 1).fill(null)), started: false };
    rooms.set(code, c.room);
    send(c, { t: 'room', code, slot: 0 });
  } else if (m.t === 'join') {
    if (c.room) return;
    const room = rooms.get(String(m.code || '').toUpperCase().slice(0, 8));
    const slot = room && !room.started ? room.clients.indexOf(null) : -1;
    if (slot < 0) { send(c, { t: 'error', m: 'Ruangan tidak ditemukan, sudah penuh, atau permainannya sudah dimulai' }); return; }
    const here = [];
    room.clients.forEach((o, i) => { if (o) here.push(i); });
    room.clients[slot] = c;
    c.room = room;
    send(c, { t: 'joined', code: room.code, slot, here });
    for (const i of here) send(room.clients[i], { t: 'peer', slot });
  } else if (m.t === 'lock') {
    // tuan rumah memulai permainan: ruangan tidak menerima pemain baru lagi
    if (c.room && c.room.clients[0] === c) c.room.started = true;
  } else if (m.t === 'msg') {
    // diteruskan ke semua klien lain; slot pengirim diisi server (tidak bisa dipalsukan klien)
    const room = c.room;
    if (!room || m.d === undefined) return;
    const from = room.clients.indexOf(c);
    for (const o of room.clients) if (o && o !== c) send(o, { t: 'msg', d: m.d, from });
  }
}

function onData(c, chunk) {
  c.buf = c.buf.length ? Buffer.concat([c.buf, chunk]) : chunk;
  if (c.buf.length > MAX_MSG * 2) { drop(c); return; }
  for (;;) {
    if (c.buf.length < 2) return;
    const b0 = c.buf[0], b1 = c.buf[1], fin = b0 & 0x80, op = b0 & 0x0f;
    let len = b1 & 0x7f, off = 2;
    if (len === 126) { if (c.buf.length < 4) return; len = c.buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { drop(c); return; }                 // pesan > 64 KB tidak didukung
    if (!(b1 & 0x80) || len > MAX_MSG) { drop(c); return; }    // frame klien wajib ber-mask
    if (c.buf.length < off + 4 + len) return;
    const mask = c.buf.subarray(off, off + 4), payload = Buffer.from(c.buf.subarray(off + 4, off + 4 + len));
    for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
    c.buf = c.buf.subarray(off + 4 + len);
    if (op === 0x8) { drop(c); return; }
    else if (op === 0x9) sendFrame(c, 0xA, payload);
    else if (op === 0xA) c.alive = true;
    else if (op === 0x1 || op === 0x0) {
      c.frag = c.frag ? Buffer.concat([c.frag, payload]) : payload;
      if (c.frag.length > MAX_MSG) { drop(c); return; }
      if (fin) { const text = c.frag.toString('utf8'); c.frag = null; onMessage(c, text); if (!conns.has(c)) return; }
    } else { drop(c); return; }
  }
}

const server = http.createServer(serveStatic);

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (req.url !== '/ws' || String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key || conns.size >= MAX_CONN) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  const c = { socket, buf: Buffer.alloc(0), frag: null, room: null, alive: true, count: 0 };
  conns.add(c);
  socket.on('data', d => onData(c, d));
  socket.on('close', () => drop(c));
  socket.on('error', () => drop(c));
});

setInterval(() => { for (const c of conns) c.count = 0; }, 1000).unref();
setInterval(() => {
  for (const c of conns) {
    if (!c.alive) { drop(c); continue; }
    c.alive = false;
    sendFrame(c, 0x9, Buffer.alloc(0));
  }
}, 30000).unref();

server.listen(PORT, HOST, () => {
  console.log('Benteng Fajar berjalan:');
  console.log('  http://localhost:' + PORT);
  if (HOST === '0.0.0.0') {
    for (const list of Object.values(os.networkInterfaces()))
      for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log('  http://' + a.address + ':' + PORT + '   (untuk pemain lain di jaringan yang sama)');
  }
});
