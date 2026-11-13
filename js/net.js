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
  // Versi permainan yang dimuat halaman ini (disisipkan server ke index.html). Server hanya mempertemukan pemain yang
  // versinya sama, karena simulasi versi berbeda tidak akan sinkron.
  const meta = document.querySelector('meta[name="bf-build"]');
  BF.BUILD = (meta && meta.content) || 'dev';
  const net = BF.net = {
    active: false, waiting: false, desync: false, slot: 0, code: '', key: '', addr: '', order: [0, 1], pid: 0, here: {},
    ws: null, handler: null, pending: [], inbox: [{}, {}], gone: [false, false], hashes: {}, peerHashes: [{}, {}],
    // sambung ulang: lost = {since, n} selama koneksi kita putus; away[pid] = batas waktu menunggu pemain lain (0 = ada);
    // sent = paket giliran terakhir kita (untuk dikirim ulang); top[pid] = giliran tertinggi yang diterima dari pemain
    // itu; done = giliran terakhir yang sudah dijalankan
    lost: null, away: [0, 0], sent: [], top: [-1, -1], done: -1, unheard: 0, retry: 0, beat: 0, quit: -1,
  };

  // ---------------------------------------------------------------- koneksi & lobi

  // Sambung ulang: koneksi yang putus di tengah permainan dicoba lagi selama RECONNECT_MS (server menahan kursi kita
  // selama itu). Tanda hidup: tiap PING_MS klien mengirim ping; PING_MISS ping berturut-turut tanpa satu pun pesan dari
  // server berarti sambungan menggantung (umum di jaringan seluler) dan dianggap putus.
  const PING_MS = 2500, PING_MISS = 3, RETRY_MS = [300, 700, 1500, 2500], RECONNECT_MS = 30000, OPEN_MS = 4000, LOG = 64;
  const raw = o => { if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(o)); };
  const stopTimers = () => { clearTimeout(net.retry); clearInterval(net.beat); net.retry = net.beat = 0; };

  // handler(type, data, from): 'open' | 'room' (kode) | 'joined' (slot-slot yang sudah ada) | 'peer' (slot yang masuk) |
  //   'left' ({slot, closed}) | 'error' (pesan) | 'close' | 'msg' (isi, from = slot pengirim) | 'desync' |
  //   'lost' (koneksi kita putus, sedang menyambung ulang) | 'regained' (tersambung lagi) |
  //   'away' (slot pemain lain yang terputus dan sedang ditunggu) | 'back' (slot yang tersambung lagi)
  net.connect = function (addr, handler) {
    net.close();
    net.handler = handler;
    net.addr = addr;
    open(false);
  };

  // again: sambungan pengganti di tengah permainan — begitu terbuka langsung meminta kursi kita kembali.
  function open(again) {
    const handler = net.handler;
    let ws;
    // halaman HTTPS hanya boleh membuka sambungan aman (wss)
    try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + net.addr + '/ws'); } catch (e) { if (again) down(); else handler('error', 'Alamat server tidak valid'); return; }
    net.ws = ws;
    if (again) setTimeout(() => { if (net.ws === ws && ws.readyState === 0) { net.ws = null; try { ws.close(); } catch (e) { /* abaikan */ } down(); } }, OPEN_MS);
    ws.onopen = () => {
      if (net.ws !== ws) return;
      net.unheard = 0;
      if (!again) { handler('open'); return; }
      const have = {};
      net.order.forEach((sl, pid) => { if (pid !== net.pid) have[sl] = net.top[pid]; });
      raw({ t: 'rejoin', code: net.code, slot: net.slot, key: net.key, v: BF.BUILD, have });
    };
    ws.onclose = () => { if (net.ws === ws) { net.ws = null; down(); } };
    ws.onerror = () => { if (net.ws === ws && !net.active) handler('error', 'Tidak bisa terhubung ke server'); };
    ws.onmessage = ev => {
      if (net.ws !== ws) return;
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || typeof m !== 'object') return;
      net.unheard = 0;
      // net.here: slot pemain lain yang sedang ada di ruangan (menurut server)
      if (m.t === 'room') { net.code = String(m.code); net.key = String(m.key || ''); net.slot = 0; net.here = {}; handler('room', net.code); }
      else if (m.t === 'joined') {
        const here = Array.isArray(m.here) ? m.here.filter(Number.isInteger) : [0];
        net.code = String(m.code); net.key = String(m.key || ''); net.slot = m.slot | 0; net.here = {};
        for (const sl of here) net.here[sl] = true;
        handler('joined', here);
      } else if (m.t === 'peer') { net.here[m.slot | 0] = true; handler('peer', m.slot | 0); }
      else if (m.t === 'left') {
        const pid = net.order.indexOf(m.slot | 0);
        delete net.here[m.slot | 0];
        if (net.active && pid >= 0) { net.gone[pid] = true; net.away[pid] = 0; }
        handler('left', { slot: m.slot | 0, closed: !!m.closed });
      } else if (m.t === 'away' || m.t === 'back') {
        // pemain lain terputus (kursinya ditahan sampai waktu di net.away) / tersambung lagi
        const pid = net.order.indexOf(m.slot | 0);
        if (!net.active || pid < 0) return;
        net.away[pid] = m.t === 'away' ? Date.now() + (+m.ms || RECONNECT_MS) : 0;
        handler(m.t, m.slot | 0);
      } else if (m.t === 'rejoined') {
        // kursi kita kembali: kirim ulang paket kita yang belum sampai ke server; paket pemain lain yang terlewat
        // menyusul dari server sebagai pesan biasa
        if (!net.lost) return;
        net.lost = null;
        net.order.forEach((sl, pid) => { net.away[pid] = Array.isArray(m.away) && m.away.indexOf(sl) >= 0 ? Date.now() + (+m.ms || RECONNECT_MS) : 0; });
        for (const e of net.sent) if (e.n > (m.got | 0) || !Number.isInteger(m.got)) raw({ t: 'msg', d: e });
        handler('regained');
      } else if (m.t === 'error') {
        if (net.lost) { if (m.code === 'rejoin') giveUp(); return; }         // kursi sudah hangus: sambung ulang gagal
        handler('error', String(m.m || 'Kesalahan server'));
      } else if (m.t === 'msg' && m.d && typeof m.d === 'object') {
        if (m.d.k === 't') onTurn(m.d, m.from | 0); else handler('msg', m.d, m.from | 0);
      }
    };
  }

  // Sambungan tertutup tanpa diminta. Di luar permainan: lapor 'close'. Di tengah permainan: coba menyambung ulang
  // dengan jeda yang makin panjang sampai RECONNECT_MS, lalu menyerah.
  function down() {
    if (!net.active) { if (net.handler) net.handler('close'); return; }
    if (!net.lost) { net.lost = { since: Date.now(), n: 0 }; net.handler('lost'); }
    if (Date.now() - net.lost.since > RECONNECT_MS) { giveUp(); return; }
    clearTimeout(net.retry);
    net.retry = setTimeout(() => { net.retry = 0; if (net.active && net.lost && !net.ws) open(true); }, RETRY_MS[Math.min(net.lost.n++, RETRY_MS.length - 1)]);
  }

  function giveUp() {
    const ws = net.ws, handler = net.handler;
    stopTimers();
    net.ws = null;
    net.lost = null;
    net.active = false;
    net.waiting = false;
    if (ws) { try { ws.close(); } catch (e) { /* sudah tertutup */ } }
    if (handler) handler('close');
  }

  net.create = () => raw({ t: 'create', v: BF.BUILD });
  net.join = code => raw({ t: 'join', code: String(code).trim().toUpperCase(), v: BF.BUILD });
  net.send = d => raw({ t: 'msg', d });
  net.lock = () => raw({ t: 'lock' });                      // tuan rumah: ruangan ditutup bagi pemain baru

  // Menutup sambungan dengan sengaja (kembali ke menu, permainan selesai, tumbang): pamit dulu supaya pemain lain tidak
  // menunggu kita tersambung lagi.
  net.close = function () {
    const ws = net.ws;
    raw({ t: 'bye' });
    stopTimers();
    net.ws = null;
    net.lost = null;
    net.active = false;
    net.waiting = false;
    if (ws) { try { ws.close(); } catch (e) { /* sudah tertutup */ } }
  };
  window.addEventListener('pagehide', () => raw({ t: 'bye' }));       // halaman ditutup/dimuat ulang: keadaan permainan hilang, tak bisa kembali

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
    net.lost = null;
    net.quit = -1;                                          // pemain terakhir yang dianggap menyerah karena keluar
    net.away = net.order.map(() => 0);
    net.sent = [];
    net.top = net.order.map(() => -1);
    net.done = -1;
    net.unheard = 0;
    stopTimers();
    net.beat = setInterval(() => {
      if (!net.active || !net.ws || net.ws.readyState !== 1) return;
      if (net.unheard < PING_MISS) { net.unheard++; raw({ t: 'ping' }); return; }
      const ws = net.ws;                                    // sambungan menggantung: tutup dan sambung ulang
      net.ws = null;
      try { ws.close(); } catch (e) { /* abaikan */ }
      down();
    }, PING_MS);
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
    if (d.n <= net.done) return;                            // kiriman ulang untuk giliran yang sudah dijalankan
    if (d.n > net.top[pid]) net.top[pid] = d.n;
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
          else if (pid !== me && net.gone[pid] && !s.players[pid].out) { net.quit = pid; BF.resign(s, pid); }      // keluar: menyerah di turn pertama tanpa paketnya
        }
        net.done = T;
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
      net.sent.push(pkt);
      if (net.sent.length > LOG) net.sent.shift();
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
