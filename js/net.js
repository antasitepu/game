'use strict';
// Multiplayer: lockstep deterministik lewat server relay WebSocket (server.js).
// Semua pemain (2–4) menjalankan simulasi yang sama; yang dikirim hanya perintah per "giliran" (turn).
//   - Perintah yang dibuat pada turn T dijadwalkan untuk turn T + DELAY (menutupi latensi jaringan).
//   - Turn T baru boleh dijalankan setelah paket turn T dari semua pemain lain yang masih bermain tiba; kalau belum,
//     simulasi menunggu. Pemain yang sudah tumbang (p.out, bagian dari state bersama) tidak ditunggu lagi.
//   - Pemain yang keluar di tengah permainan: server meneruskan semua paketnya lebih dulu, baru kabar keluarnya, jadi
//     semua klien memegang paketnya sampai turn K yang sama. Pada turn K + 1 ia dianggap menyerah — di semua klien.
//   - Tiap HASH_EVERY turn, checksum state dibandingkan untuk mendeteksi desinkronisasi.
// Slot = nomor kursi di ruangan (dari server). order = slot-slot yang ikut bermain; id pemain = urutannya di order.
(function () {
  const TURN = 2, DELAY = 2, HASH_EVERY = 20, MAX_CMDS = 100;
  const net = BF.net = {
    active: false, waiting: false, desync: false, slot: 0, code: '', order: [0, 1], pid: 0, here: {},
    ws: null, handler: null, pending: [], inbox: [{}, {}], gone: [false, false], hashes: {}, peerHashes: [{}, {}],
  };

  // ---------------------------------------------------------------- koneksi & lobi

  // handler(type, data, from): 'open' | 'room' (kode) | 'joined' (slot-slot yang sudah ada) | 'peer' (slot yang masuk) |
  //   'left' ({slot, closed}) | 'error' (pesan) | 'close' | 'msg' (isi, from = slot pengirim) | 'desync'
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
      // net.here: slot pemain lain yang sedang ada di ruangan (menurut server)
      if (m.t === 'room') { net.code = String(m.code); net.slot = 0; net.here = {}; handler('room', net.code); }
      else if (m.t === 'joined') {
        const here = Array.isArray(m.here) ? m.here.filter(Number.isInteger) : [0];
        net.code = String(m.code); net.slot = m.slot | 0; net.here = {};
        for (const sl of here) net.here[sl] = true;
        handler('joined', here);
      } else if (m.t === 'peer') { net.here[m.slot | 0] = true; handler('peer', m.slot | 0); }
      else if (m.t === 'left') {
        const pid = net.order.indexOf(m.slot | 0);
        delete net.here[m.slot | 0];
        if (net.active && pid >= 0) net.gone[pid] = true;
        handler('left', { slot: m.slot | 0, closed: !!m.closed });
      } else if (m.t === 'error') handler('error', String(m.m || 'Kesalahan server'));
      else if (m.t === 'msg' && m.d && typeof m.d === 'object') {
        if (m.d.k === 't') onTurn(m.d, m.from | 0); else handler('msg', m.d, m.from | 0);
      }
    };
  };

  const raw = o => { if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(o)); };
  net.create = () => raw({ t: 'create' });
  net.join = code => raw({ t: 'join', code: String(code).trim().toUpperCase() });
  net.send = d => raw({ t: 'msg', d });
  net.lock = () => raw({ t: 'lock' });                      // tuan rumah: ruangan ditutup bagi pemain baru

  net.close = function () {
    const ws = net.ws;
    net.ws = null;
    net.active = false;
    net.waiting = false;
    if (ws) { try { ws.close(); } catch (e) { /* sudah tertutup */ } }
  };

  // ---------------------------------------------------------------- lockstep

  // order: slot-slot yang ikut bermain, urut = id pemain.
  net.begin = function (order) {
    net.order = order.slice();
    net.pid = net.order.indexOf(net.slot);
    net.active = true;
    net.waiting = false;
    net.desync = false;
    net.pending = [];
    net.inbox = net.order.map(() => ({}));
    // pemain yang ikut di daftar tetapi sudah tidak ada di ruangan (keluar tepat saat permainan dimulai) langsung
    // ditandai keluar, supaya tidak ditunggu selamanya
    net.gone = net.order.map(sl => sl !== net.slot && !net.here[sl]);
    net.hashes = {};
    net.peerHashes = net.order.map(() => ({}));
  };

  // Bandingkan checksum turn T milik sendiri dengan milik pemain pid (bila keduanya sudah ada).
  function checkHash(T, pid) {
    const mine = net.hashes[T], theirs = net.peerHashes[pid][T];
    if (mine === undefined || theirs === undefined) return;
    if (mine !== theirs && !net.desync) { net.desync = true; if (net.handler) net.handler('desync'); }
    delete net.peerHashes[pid][T];
  }

  function onTurn(d, from) {
    const pid = net.order.indexOf(from);
    if (!net.active || pid < 0 || pid === net.pid || !Number.isInteger(d.n) || d.n < 0 || !Array.isArray(d.c) || d.c.length > MAX_CMDS) return;
    net.inbox[pid][d.n] = d.c;
    if (Number.isInteger(d.ht) && typeof d.h === 'number') { net.peerHashes[pid][d.ht] = d.h; checkHash(d.ht, pid); }
  }

  // Majukan simulasi satu tick. Return false bila harus menunggu paket lawan.
  net.advance = function (s) {
    if (!net.active) { BF.step(s); return true; }
    if (s.tick % TURN === 0) {
      const T = s.tick / TURN, me = net.pid, n = net.order.length;
      if (T >= DELAY) {
        // tunggu paket pemain lain yang masih bermain (belum tumbang) dan belum keluar
        for (let pid = 0; pid < n; pid++)
          if (pid !== me && !net.inbox[pid][T] && !net.gone[pid] && !s.players[pid].out) { net.waiting = true; return false; }
        for (let pid = 0; pid < n; pid++) {
          const cs = net.inbox[pid][T];
          if (cs) { for (const c of cs) BF.exec(s, pid, c); delete net.inbox[pid][T]; }
          else if (pid !== me && net.gone[pid]) BF.resign(s, pid);      // keluar: menyerah di turn pertama tanpa paketnya
        }
        if (s.over) return true;
      }
      net.waiting = false;
      const pkt = { k: 't', n: T + DELAY, c: net.pending.splice(0) };
      if (T % HASH_EVERY === 0) {
        pkt.h = BF.hash(s); pkt.ht = T; net.hashes[T] = pkt.h;
        delete net.hashes[T - HASH_EVERY * 10];
        for (let pid = 0; pid < n; pid++) if (pid !== me) checkHash(T, pid);
      }
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
