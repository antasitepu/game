'use strict';
// Server Benteng Fajar (tanpa dependency):
//   1. menyajikan file game (index.html, /js, /css, /assets, serta sw.js dan manifest.webmanifest untuk pemasangan sebagai aplikasi)
//   2. relay WebSocket untuk multiplayer: meneruskan pesan antarpemain (2–4) dalam satu ruangan
// Jalankan: node server.js   (opsi: PORT=8080 HOST=0.0.0.0; untuk layanan publik lihat DEPLOY.md)
// Server tidak menjalankan logika game dan tidak menyimpan data apa pun (tanpa akun, tanpa log alamat IP).
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os'), zlib = require('zlib');

const PORT = +process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.bin': 'application/octet-stream', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png', '.webmanifest': 'application/manifest+json; charset=utf-8' };
const CODE = ['.html', '.js', '.css'];   // jenis file yang boleh diambil dari luar /assets
const num = (k, d) => (process.env[k] ? +process.env[k] || d : d);
const MAX_MSG = 32 * 1024;   // byte per pesan
const MAX_CONN = num('MAX_CONN', 400);
const MAX_ROOMS = num('MAX_ROOMS', 200);
const ROOM_MAX = 4;          // klien per ruangan
const RATE = 150;            // pesan per detik per koneksi
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 5;          // 31^5 ≈ 28 juta kode: tidak praktis ditebak dengan batas percobaan di bawah
// --- perlindungan untuk layanan publik
// TRUST_PROXY=1: server berada di belakang SATU reverse proxy tepercaya (TLS); alamat klien dibaca dari kepala proxy.
// ALLOWED_ORIGINS: daftar asal (dipisah koma) yang boleh membuka WebSocket; kosong = hanya halaman dari host yang sama.
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const IP_CONN = num('MAX_CONN_PER_IP', 16);                 // koneksi serentak per alamat (satu rumah/sekolah bisa berbagi alamat)
const IP_ROOMS = num('ROOMS_PER_IP_PER_MIN', 10);           // ruangan baru per alamat per menit
const IP_FAILS = num('JOIN_FAILS_PER_IP_PER_MIN', 20);      // percobaan gabung yang gagal per alamat per menit
const CONN_FAILS = 6;                                       // …dan per koneksi, sebelum koneksinya diputus
const IDLE_MS = num('IDLE_MS', 30e3);                       // koneksi yang tidak masuk ruangan mana pun
const LOBBY_MS = num('LOBBY_MS', 30 * 60e3);                // ruangan yang tidak kunjung dimulai
const STALL_MS = num('STALL_MS', 30e3);                     // ruangan yang macet menunggu satu pemain (lihat sweep)
const DEAD_MS = num('DEAD_MS', 10 * 60e3);                  // ruangan bermain yang sunyi total
const MAX_BUFFER = 1 << 20;                                 // byte yang boleh menumpuk untuk klien yang tidak membaca
// --- sambung ulang
const RECONNECT_MS = num('RECONNECT_MS', 30e3);             // kursi pemain yang koneksinya putus ditahan selama ini
const LIVE_MS = num('LIVE_MS', 12e3);                       // klien di permainan yang tidak bersuara sama sekali (ping pun tidak) dianggap putus
const LOG_N = 64, LOG_BYTES = 64 * 1024;                    // paket giliran terakhir tiap kursi yang dicatat untuk dikirim ulang
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// ---------------------------------------------------------------- file statis

// Versi permainan (build): sidik isi index.html, /js, dan /css. Disisipkan ke index.html dan dikirim klien saat membuat/
// bergabung ke ruangan, supaya pemain dengan halaman lama dan baru tidak masuk ruangan yang sama (simulasinya berbeda).
let buildSig = '', buildId = 'dev';
function build() {
  const files = [path.join(ROOT, 'index.html')];
  const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else if (CODE.includes(path.extname(f))) files.push(f); } };
  try {
    walk(path.join(ROOT, 'js'));
    walk(path.join(ROOT, 'css'));
    files.sort();
    const sig = files.map(f => { const st = fs.statSync(f); return f + ':' + st.mtimeMs + ':' + st.size; }).join('|');
    if (sig !== buildSig) {
      const h = crypto.createHash('sha1');
      for (const f of files) h.update(fs.readFileSync(f));
      buildSig = sig;
      buildId = h.digest('hex').slice(0, 12);
    }
  } catch (e) { /* file sedang ditulis: pakai nilai terakhir */ }
  return buildId;
}

const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };
// Hanya skrip dan gaya milik sendiri; sambungan WebSocket boleh ke server lain (kolom alamat server di menu).
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; " +
  "connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const GZIP = ['.html', '.js', '.css', '.json', '.bin', '.webmanifest'];
const cache = new Map();   // file → { sig, etag, body, gz }

// Isi file + ETag + versi gzip-nya, disimpan di memori sampai file berubah.
function load(file, ext, cb) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return cb(null);
    const index = file === path.join(ROOT, 'index.html'), sig = st.mtimeMs + ':' + st.size + (index ? ':' + build() : ''), hit = cache.get(file);
    if (hit && hit.sig === sig) return cb(hit);
    fs.readFile(file, (e2, data) => {
      if (e2) return cb(null);
      if (index) data = Buffer.from(data.toString('utf8').replace('<head>', '<head>\n  <meta name="bf-build" content="' + buildId + '">'));
      const entry = { sig, etag: '"' + crypto.createHash('sha1').update(data).digest('hex').slice(0, 20) + '"', body: data, gz: null };
      const done = () => { cache.set(file, entry); cb(entry); };
      if (!GZIP.includes(ext) || data.length < 1024) return done();
      zlib.gzip(data, (e3, gz) => { if (!e3 && gz.length < data.length * 0.9) entry.gz = gz; done(); });
    });
  });
}

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); res.end(); return; }
  if (p === '/healthz') {                                 // untuk pemantauan: tanpa data pemain
    res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, SECURITY));
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ ok: true, build: build(), rooms: rooms.size, conns: conns.size }));
    return;
  }
  if (p === '/') p = '/index.html';
  const ext = path.extname(p);
  // Hanya file game yang boleh diakses; server.js, tests, dsb. tidak disajikan.
  const inCode = (CODE.includes(ext) && (p === '/index.html' || p.startsWith('/js/') || p.startsWith('/css/'))) || p === '/sw.js' || p === '/manifest.webmanifest';
  const allowed = TYPES[ext] && (inCode || (p.startsWith('/assets/') && !CODE.includes(ext))) && !p.includes('..') && !p.includes('\0');
  const file = path.join(ROOT, p);
  if (!allowed || !file.startsWith(ROOT + path.sep)) { res.writeHead(404); res.end('Not found'); return; }
  load(file, ext, f => {
    if (!f) { res.writeHead(404); res.end('Not found'); return; }
    // no-cache = selalu ditanyakan ulang; bila belum berubah dijawab 304 tanpa isi
    const head = Object.assign({ 'Content-Type': TYPES[ext], 'Cache-Control': 'no-cache', ETag: f.etag, Vary: 'Accept-Encoding' }, SECURITY);
    if (p === '/index.html') head['Content-Security-Policy'] = CSP;
    if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, head); res.end(); return; }
    const gz = f.gz && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
    if (gz) head['Content-Encoding'] = 'gzip';
    const body = gz ? f.gz : f.body;
    head['Content-Length'] = body.length;
    res.writeHead(200, head);
    res.end(req.method === 'HEAD' ? undefined : body);
  });
}

// ---------------------------------------------------------------- WebSocket (RFC 6455)

const conns = new Set(), rooms = new Map();
const ips = new Map();     // alamat → { conns, rooms: [waktu], fails: [waktu] } (hanya di memori, untuk pembatasan)

function clientIp(req) {
  if (TRUST_PROXY) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf) return cf.trim();
    const xf = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (xf.length) return xf[xf.length - 1];             // entri terakhir = yang ditambahkan proxy kita sendiri
  }
  return req.socket.remoteAddress || '?';
}
const ipOf = ip => { let r = ips.get(ip); if (!r) ips.set(ip, r = { conns: 0, rooms: [], fails: [] }); return r; };
// Catat satu kejadian pada daftar waktu `list`; false bila dalam semenit terakhir sudah mencapai `max`.
function allow(list, max) {
  const now = Date.now();
  while (list.length && now - list[0] > 60e3) list.shift();
  if (list.length >= max) return false;
  list.push(now);
  return true;
}

// WebSocket hanya boleh dibuka oleh halaman kita sendiri (atau asal yang didaftarkan). Klien tanpa kepala Origin
// (bukan peramban) tidak dibatasi di sini — Origin bukan autentikasi, hanya mencegah situs lain menumpang lewat
// peramban pengunjungnya.
function originOk(req) {
  const o = req.headers.origin;
  if (!o) return true;
  let host;
  try { host = new URL(o).host.toLowerCase(); } catch (e) { return false; }
  if (ORIGINS.length) return ORIGINS.includes(String(o).toLowerCase()) || ORIGINS.includes(host);
  return host === String(req.headers.host || '').toLowerCase();
}

function sendFrame(c, op, payload) {
  if (c.socket.destroyed) return;
  if (c.socket.writableLength > MAX_BUFFER) { setImmediate(drop, c); return; }      // klien tidak membaca: putuskan
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
  c.socket.write(Buffer.concat([head, payload]));
}
const send = (c, obj) => sendFrame(c, 0x1, Buffer.from(JSON.stringify(obj)));

// Ruangan: clients[slot] = koneksi yang sedang menduduki kursi (slot 0 = tuan rumah); seats[slot] = keadaan kursi yang
// bertahan walau koneksinya berganti: kunci rahasia untuk sambung ulang, giliran terakhir yang dikirim (turn) dan
// kapan (tTurn), waktu terputus (away), sudah keluar untuk selamanya (gone), dan catatan paket giliran terakhirnya.
const newSeat = () => ({ key: crypto.randomBytes(16).toString('hex'), turn: -1, tTurn: Date.now(), away: 0, gone: false, log: [], bytes: 0 });

// Kursi dikosongkan untuk selamanya: kuncinya hangus dan pemain lain diberi tahu ('left' → dianggap menyerah). Ruangan
// dihapus bila tidak ada lagi klien maupun kursi yang masih ditunggu.
function vacate(room, slot) {
  const seat = room.seats[slot];
  if (seat) { seat.gone = true; seat.away = 0; seat.key = null; }
  const now = Date.now();
  for (const q of room.seats) if (q) q.tTurn = now;        // yang lain baru saja berhenti menunggu dia: beri waktu melanjutkan
  for (const o of room.clients) if (o) send(o, { t: 'left', slot });
  if (!room.clients.some(Boolean) && !room.seats.some(q => q && q.away)) rooms.delete(room.code);
}

// Di lobi (belum dikunci) ruangan milik tuan rumah: bila ia keluar, ruangan ditutup untuk semua; tamu yang keluar hanya
// mengosongkan kursinya. Setelah permainan dimulai: koneksi yang putus menahan kursinya selama RECONNECT_MS (pemain lain
// diberi tahu 'away' dan menunggu) dan boleh kembali dengan kunci kursinya; `final` = keluar untuk selamanya (pamit
// sengaja, dikeluarkan karena macet).
function leaveRoom(c, final) {
  const room = c.room;
  if (!room) return;
  c.room = null;
  const slot = room.clients.indexOf(c);
  if (slot < 0) return;
  if (!room.started) {
    if (slot === 0) {
      rooms.delete(room.code);
      for (const o of room.clients) if (o && o !== c) { o.room = null; send(o, { t: 'left', slot: 0, closed: true }); }
      return;
    }
    room.clients[slot] = null;
    room.seats[slot] = null;
    for (const o of room.clients) if (o) send(o, { t: 'left', slot });
    return;
  }
  room.clients[slot] = null;
  const seat = room.seats[slot];
  if (final || !seat || seat.gone) { vacate(room, slot); return; }
  seat.away = Date.now();
  for (const q of room.seats) if (q) q.tTurn = seat.away;      // semua berhenti menunggu dia: itu bukan "macet"
  for (const o of room.clients) if (o) send(o, { t: 'away', slot, ms: RECONNECT_MS });
}

function drop(c, final) {
  if (!conns.delete(c)) return;
  leaveRoom(c, final);
  const r = ips.get(c.ip);
  if (r && --r.conns <= 0 && !r.rooms.length && !r.fails.length) ips.delete(c.ip);
  c.socket.destroy();
}

function newCode() {
  for (let tries = 0; tries < 50; tries++) {
    let code = '';
    for (const b of crypto.randomBytes(CODE_LEN)) code += CODE_CHARS[b % CODE_CHARS.length];
    if (!rooms.has(code)) return code;
  }
  return null;
}

// Percobaan yang gagal (kode ruangan salah, kunci sambung ulang salah) dibatasi per koneksi dan per alamat.
function failed(c, msg, code) {
  if (++c.fails >= CONN_FAILS || !allow(ipOf(c.ip).fails, IP_FAILS)) { send(c, { t: 'error', m: 'Terlalu banyak percobaan. Coba lagi sebentar lagi.' }); setImmediate(drop, c); return; }
  send(c, code ? { t: 'error', m: msg, code } : { t: 'error', m: msg });
}

function onMessage(c, text) {
  if (++c.count > RATE) { drop(c); return; }
  let m;
  try { m = JSON.parse(text); } catch (e) { drop(c); return; }
  if (!m || typeof m !== 'object') return;
  c.last = Date.now();
  const ver = typeof m.v === 'string' ? m.v.slice(0, 32) : '';
  if (m.t === 'ping') send(c, { t: 'pong' });               // tanda hidup dari klien yang sedang bermain
  else if (m.t === 'create') {
    if (c.room) return;
    if (!allow(ipOf(c.ip).rooms, IP_ROOMS)) { send(c, { t: 'error', m: 'Terlalu banyak ruangan dibuat dari jaringanmu. Coba lagi sebentar lagi.' }); return; }
    const code = rooms.size < MAX_ROOMS ? newCode() : null;
    if (!code) { send(c, { t: 'error', m: 'Server penuh, coba lagi nanti' }); return; }
    const seats = new Array(ROOM_MAX).fill(null);
    seats[0] = newSeat();
    c.room = { code, clients: [c].concat(new Array(ROOM_MAX - 1).fill(null)), seats, started: false, v: ver, t0: Date.now() };
    rooms.set(code, c.room);
    send(c, { t: 'room', code, slot: 0, key: seats[0].key });
  } else if (m.t === 'join') {
    if (c.room) return;
    const room = rooms.get(String(m.code || '').toUpperCase().slice(0, 8));
    const slot = room && !room.started ? room.clients.indexOf(null) : -1;
    if (slot < 0) { failed(c, 'Ruangan tidak ditemukan, sudah penuh, atau permainannya sudah dimulai'); return; }
    if (room.v !== ver) { send(c, { t: 'error', m: 'Versi permainan berbeda dengan tuan rumah. Muat ulang halaman ini (minta tuan rumah juga), lalu coba lagi.' }); return; }
    const here = [];
    room.clients.forEach((o, i) => { if (o) here.push(i); });
    room.clients[slot] = c;
    room.seats[slot] = newSeat();
    c.room = room;
    send(c, { t: 'joined', code: room.code, slot, here, key: room.seats[slot].key });
    for (const i of here) send(room.clients[i], { t: 'peer', slot });
  } else if (m.t === 'rejoin') {
    // kembali ke kursi sendiri setelah koneksi putus: kode ruangan + nomor kursi + kunci kursi
    if (c.room) return;
    const room = rooms.get(String(m.code || '').toUpperCase().slice(0, 8)), slot = m.slot | 0, key = typeof m.key === 'string' ? m.key : '';
    const seat = room && room.started && slot >= 0 && slot < ROOM_MAX ? room.seats[slot] : null;
    if (!seat || seat.gone || !seat.key || key.length !== seat.key.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(seat.key)) || room.v !== ver) {
      failed(c, 'Tidak bisa tersambung lagi ke permainan itu.', 'rejoin');
      return;
    }
    const old = room.clients[slot], now = Date.now();
    if (old) { old.room = null; setImmediate(drop, old); }   // koneksi lama yang masih menggantung digantikan
    room.clients[slot] = c;
    c.room = room;
    seat.away = 0;
    for (const q of room.seats) if (q) q.tTurn = now;
    const here = [], away = [], have = m.have && typeof m.have === 'object' ? m.have : {};
    room.seats.forEach((q, i) => { if (!q || i === slot) return; if (room.clients[i]) here.push(i); else if (q.away) away.push(i); });
    // got: giliran terakhir darinya yang sampai ke server — klien mengirim ulang paketnya sendiri sesudah itu
    send(c, { t: 'rejoined', slot, got: seat.turn, here, away, ms: RECONNECT_MS });
    // paket giliran pemain lain yang terlewat selama terputus, lalu kabar siapa yang sudah keluar untuk selamanya
    room.seats.forEach((q, i) => {
      if (!q || i === slot) return;
      const from = Number.isInteger(have[i]) ? have[i] : -1;
      for (const e of q.log) if (e.n > from) sendFrame(c, 0x1, Buffer.from('{"t":"msg","d":' + e.json + ',"from":' + i + '}'));
    });
    room.seats.forEach((q, i) => { if (q && q.gone && i !== slot) send(c, { t: 'left', slot: i }); });
    for (const o of room.clients) if (o && o !== c) send(o, { t: 'back', slot });
  } else if (m.t === 'bye') {
    leaveRoom(c, true);                                     // pamit: tidak perlu ditunggu
  } else if (m.t === 'lock') {
    // tuan rumah memulai permainan: ruangan tidak menerima pemain baru lagi
    const room = c.room;
    if (room && room.clients[0] === c && !room.started) { room.started = true; for (const q of room.seats) if (q) { q.turn = -1; q.tTurn = c.last; } }
  } else if (m.t === 'msg') {
    // diteruskan ke semua klien lain; slot pengirim diisi server (tidak bisa dipalsukan klien)
    const room = c.room;
    if (!room || m.d === undefined) return;
    const from = room.clients.indexOf(c), seat = room.seats[from];
    if (seat && room.started && m.d && m.d.k === 't' && Number.isInteger(m.d.n)) {
      // paket giliran: catat nomor dan waktunya (lihat sweep) dan simpan untuk dikirim ulang ke pemain yang tersambung lagi
      if (m.d.n > seat.turn) seat.turn = m.d.n;
      seat.tTurn = c.last;
      const json = JSON.stringify(m.d);
      seat.log.push({ n: m.d.n, json });
      seat.bytes += json.length;
      while (seat.log.length > LOG_N || seat.bytes > LOG_BYTES) seat.bytes -= seat.log.shift().json.length;
    }
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
  const key = req.headers['sec-websocket-key'], ip = clientIp(req);
  if (req.url !== '/ws' || String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key || conns.size >= MAX_CONN || !originOk(req) || ipOf(ip).conns >= IP_CONN) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  const c = { socket, buf: Buffer.alloc(0), frag: null, room: null, alive: true, count: 0, ip, fails: 0, t0: Date.now(), last: Date.now() };
  ipOf(ip).conns++;
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

// Pembersihan berkala:
//   - koneksi yang tidak masuk ruangan mana pun dalam IDLE_MS diputus;
//   - klien di permainan yang tidak bersuara sama sekali selama LIVE_MS (klien mengirim ping tiap beberapa detik)
//     dianggap putus: kursinya ditahan dan ia boleh menyambung ulang;
//   - ruangan lobi yang tidak dimulai dalam LOBBY_MS ditutup;
//   - kursi yang ditunggu lebih dari RECONNECT_MS dikosongkan untuk selamanya (pemain lain menganggapnya menyerah);
//   - ruangan yang sedang bermain, semua pemainnya tersambung, tetapi tanpa paket giliran selama STALL_MS berarti
//     semua menunggu seorang pemain yang macet (tab disembunyikan, perangkat tertidur): pemain yang giliran terkirimnya
//     paling tertinggal dikeluarkan untuk selamanya. Bila semuanya sama-sama diam sampai DEAD_MS (permainan sudah
//     selesai atau ditinggalkan), ruangan dikosongkan.
function sweep() {
  const now = Date.now();
  for (const c of conns) {
    if (!c.room) { if (now - c.last > IDLE_MS) drop(c); }
    else if (c.room.started && now - c.last > LIVE_MS) drop(c);
  }
  for (const room of [...rooms.values()]) {
    const cs = room.clients.filter(Boolean);
    if (!room.started) {
      if (now - room.t0 > LOBBY_MS) for (const o of cs) { send(o, { t: 'error', m: 'Ruangan ditutup karena terlalu lama menunggu.' }); drop(o); }
      continue;
    }
    room.seats.forEach((q, i) => { if (q && q.away && now - q.away > RECONNECT_MS) vacate(room, i); });
    if (!rooms.has(room.code) || room.seats.some(q => q && q.away)) continue;
    const live = [];
    room.clients.forEach((o, i) => { if (o) live.push(i); });
    if (!live.length) { rooms.delete(room.code); continue; }
    const quiet = now - Math.max(...live.map(i => room.seats[i].tTurn));
    if (quiet < STALL_MS) continue;
    const lo = Math.min(...live.map(i => room.seats[i].turn)), hi = Math.max(...live.map(i => room.seats[i].turn));
    if (lo < hi) { for (const i of live) if (room.seats[i].turn === lo) drop(room.clients[i], true); }
    else if (quiet > DEAD_MS) for (const i of live) drop(room.clients[i], true);
  }
  for (const [ip, r] of ips) {
    while (r.rooms.length && now - r.rooms[0] > 60e3) r.rooms.shift();
    while (r.fails.length && now - r.fails[0] > 60e3) r.fails.shift();
    if (r.conns <= 0 && !r.rooms.length && !r.fails.length) ips.delete(ip);
  }
}
setInterval(sweep, Math.min(5000, Math.max(250, Math.min(STALL_MS, RECONNECT_MS, LIVE_MS) / 4))).unref();

// Berhenti dengan rapi (SIGTERM dari pengelola proses saat deploy): tidak menerima koneksi baru, menutup yang ada.
function shutdown() {
  server.close(() => process.exit(0));
  for (const c of [...conns]) { sendFrame(c, 0x8, Buffer.alloc(0)); drop(c); }
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, HOST, () => {
  console.log('Benteng Fajar berjalan:');
  console.log('  http://localhost:' + PORT);
  if (HOST === '0.0.0.0') {
    for (const list of Object.values(os.networkInterfaces()))
      for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log('  http://' + a.address + ':' + PORT + '   (untuk pemain lain di jaringan yang sama)');
  }
});
