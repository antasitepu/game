'use strict';
// Multiplayer: lockstep deterministik lewat server relay WebSocket (server.js).
// Kedua pemain menjalankan simulasi yang sama; yang dikirim hanya perintah per "giliran" (turn).
//   - Perintah yang dibuat pada turn T dijadwalkan untuk turn T + DELAY (menutupi latensi jaringan).
//   - Turn T baru boleh dijalankan setelah paket turn T dari lawan tiba; kalau belum, simulasi menunggu.
//   - Tiap HASH_EVERY turn, checksum state dibandingkan untuk mendeteksi desinkronisasi.
(function () {
  const TURN = 2, DELAY = 2, HASH_EVERY = 20, MAX_CMDS = 100;
  const net = BF.net = {
    active: false, waiting: false, desync: false, slot: 0, code: '',
    ws: null, handler: null, pending: [], inbox: [{}, {}], hashes: {}, peerHashes: {},
  };

  // ---------------------------------------------------------------- koneksi & lobi

  // handler(type, data): 'open' | 'room' | 'joined' | 'peer' | 'left' | 'error' | 'close' | 'msg' | 'desync'
  net.connect = function (addr, handler) {
    net.close();
    net.handler = handler;
    let ws;
    try { ws = new WebSocket('ws://' + addr + '/ws'); } catch (e) { handler('error', 'Alamat server tidak valid'); return; }
    net.ws = ws;
    ws.onopen = () => { if (net.ws === ws) handler('open'); };
    ws.onclose = () => { if (net.ws === ws) { net.ws = null; handler('close'); } };
    ws.onerror = () => { if (net.ws === ws) handler('error', 'Tidak bisa terhubung ke server'); };
    ws.onmessage = ev => {
      if (net.ws !== ws) return;
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'room') { net.code = String(m.code); net.slot = 0; handler('room', net.code); }
      else if (m.t === 'joined') { net.code = String(m.code); net.slot = 1; handler('joined', net.code); }
      else if (m.t === 'peer' || m.t === 'left') handler(m.t);
      else if (m.t === 'error') handler('error', String(m.m || 'Kesalahan server'));
      else if (m.t === 'msg' && m.d && typeof m.d === 'object') {
        if (m.d.k === 't') onTurn(m.d); else handler('msg', m.d);
      }
    };
  };

  const raw = o => { if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(o)); };
  net.create = () => raw({ t: 'create' });
  net.join = code => raw({ t: 'join', code: String(code).trim().toUpperCase() });
  net.send = d => raw({ t: 'msg', d });

  net.close = function () {
    const ws = net.ws;
    net.ws = null;
    net.active = false;
    net.waiting = false;
    if (ws) { try { ws.close(); } catch (e) { /* sudah tertutup */ } }
  };

  // ---------------------------------------------------------------- lockstep

  net.begin = function () {
    net.active = true;
    net.waiting = false;
    net.desync = false;
    net.pending = [];
    net.inbox = [{}, {}];
    net.hashes = {};
    net.peerHashes = {};
  };

  function checkHash(T) {
    if (net.hashes[T] === undefined || net.peerHashes[T] === undefined) return;
    if (net.hashes[T] !== net.peerHashes[T] && !net.desync) { net.desync = true; if (net.handler) net.handler('desync'); }
    delete net.hashes[T];
    delete net.peerHashes[T];
  }

  function onTurn(d) {
    if (!net.active || !Number.isInteger(d.n) || d.n < 0 || !Array.isArray(d.c) || d.c.length > MAX_CMDS) return;
    net.inbox[1 - net.slot][d.n] = d.c;
    if (Number.isInteger(d.ht) && typeof d.h === 'number') { net.peerHashes[d.ht] = d.h; checkHash(d.ht); }
  }

  // Majukan simulasi satu tick. Return false bila harus menunggu paket lawan.
  net.advance = function (s) {
    if (!net.active) { BF.step(s); return true; }
    if (s.tick % TURN === 0) {
      const T = s.tick / TURN, me = net.slot, other = 1 - me;
      if (T >= DELAY) {
        if (!net.inbox[other][T]) { net.waiting = true; return false; }
        for (let pid = 0; pid < 2; pid++) {
          for (const c of net.inbox[pid][T] || []) BF.exec(s, pid, c);
          delete net.inbox[pid][T];
        }
      }
      net.waiting = false;
      const pkt = { k: 't', n: T + DELAY, c: net.pending.splice(0) };
      if (T % HASH_EVERY === 0) { pkt.h = BF.hash(s); pkt.ht = T; net.hashes[T] = pkt.h; checkHash(T); }
      net.inbox[me][T + DELAY] = pkt.c;
      net.send(pkt);
    }
    BF.step(s);
    return true;
  };

  // Perintah pemain lokal: langsung dieksekusi (single-player) atau diantrekan ke turn berikutnya.
  const localIssue = BF.issue;
  BF.issue = function (c) {
    if (!net.active) localIssue(c);
    else if (net.pending.length < MAX_CMDS) net.pending.push(c);
  };
})();
