'use strict';
// Perintah tingkat tinggi. Dipakai oleh input pemain maupun AI agar aturan (biaya, era, antrean)
// hanya ditegakkan di satu tempat.
//   BF.cmd.*  : operasi atas objek (dipakai AI & BF.exec)
//   BF.exec   : menjalankan perintah berbentuk data {c: 'move', ids: [...], ...} atas nama satu pemain,
//               dengan validasi kepemilikan — bentuk inilah yang dikirim antar pemain di multiplayer
//   BF.issue  : titik masuk perintah pemain lokal (langsung dieksekusi; BF.net menggantinya saat multiplayer)
(function () {
  const idx = BF.idx, MAX_QUEUE = 8, MAX_IDS = 200, MAX_WALL = 60;

  BF.placeable = function (s, owner, type, tx, ty) {
    if (BF.canPlace(s.map, type, tx, ty)) return true;
    // Gerbang boleh menggantikan tembok milik sendiri.
    if (type !== 'gate' || !BF.inBounds(tx, ty)) return false;
    const b = s.byId.get(s.map.bld[idx(tx, ty)]);
    return !!b && !b.dead && b.owner === owner && b.type === 'wall';
  };

  BF.cmd = {
    // form: indeks BF.FORMATIONS. 0/kosong = bebas (kisi tanpa arah; tiap unit dengan kecepatannya sendiri).
    // Baris (1) dan kotak (2) menghadap arah maju — dari titik tengah kelompok ke tujuan — dan disusun per golongan:
    // petarung jarak dekat di depan, lalu pemanah, mesin kepung, dan yang tak bersenjata. Unit yang sekarang paling depan
    // mengisi barisan depan dan tiap barisan diurutkan kiri→kanan menurut posisi sekarang, supaya jalur tidak saling
    // silang. Semua berjalan secepat unit paling lambat (o.pace) dan menghadap ke depan saat tiba (o.face).
    move(s, units, x, y, attack, form) {
      const n = units.length, sp = 0.9, F = BF.FORMATIONS[form];
      if (!form || !F || n < 2) {
        const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
        units.forEach((u, i) => {
          const ox = ((i % cols) - (cols - 1) / 2) * sp, oy = (Math.floor(i / cols) - (rows - 1) / 2) * sp;
          BF.setOrder(u, BF.moveOrder(s, x + ox, y + oy, attack && BF.unitDef(s, u).atk > 0, u.owner));
        });
        return;
      }
      let cx = 0, cy = 0, pace = Infinity;
      for (const u of units) { cx += u.x; cy += u.y; pace = Math.min(pace, BF.unitDef(s, u).speed); }
      let dx = x - cx / n, dy = y - cy / n;
      const l = BF.dist(dx, dy);
      if (l < 0.5) { dx = 0; dy = 1; } else { dx /= l; dy /= l; }
      const px = -dy, py = dx, face = Math.atan2(dy, dx), cols = F.cols || Math.ceil(Math.sqrt(n)), groups = [[], [], [], []], rows = [];
      for (const u of units) { const d = BF.unitDef(s, u); groups[!d.atk ? 3 : d.cls === 'siege' ? 2 : d.range > 1.5 ? 1 : 0].push(u); }
      for (const g of groups) {
        if (!g.length) continue;
        g.sort((a, b) => (b.x * dx + b.y * dy) - (a.x * dx + a.y * dy) || a.id - b.id);
        const per = Math.ceil(g.length / Math.ceil(g.length / cols));          // barisan golongan ini dibagi rata
        for (let i = 0; i < g.length; i += per) rows.push(g.slice(i, i + per).sort((a, b) => (a.x * px + a.y * py) - (b.x * px + b.y * py) || a.id - b.id));
      }
      rows.forEach((row, r) => row.forEach((u, c) => {
        const lat = (c - (row.length - 1) / 2) * sp, dep = ((rows.length - 1) / 2 - r) * sp;
        const o = BF.moveOrder(s, x + px * lat + dx * dep, y + py * lat + dy * dep, attack && BF.unitDef(s, u).atk > 0, u.owner);
        o.pace = pace;
        o.face = face;
        BF.setOrder(u, o);
      }));
    },

    // Patroli: tiap unit tempur bolak-balik antara posisinya sekarang dan titik tujuan (dalam formasi seperti move).
    patrol(s, units, x, y) {
      const n = units.length, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), sp = 0.9;
      units.forEach((u, i) => {
        if (!BF.unitDef(s, u).atk) return;
        const ox = ((i % cols) - (cols - 1) / 2) * sp, oy = (Math.floor(i / cols) - (rows - 1) / 2) * sp;
        const a = BF.moveOrder(s, u.x, u.y, false, u.owner), b = BF.moveOrder(s, x + ox, y + oy, false, u.owner);
        BF.setOrder(u, { type: 'patrol', pts: [{ x: a.x, y: a.y, goal: a.goal }, { x: b.x, y: b.y, goal: b.goal }], i: 1, x: b.x, y: b.y, exact: true, goal: b.goal });
      });
    },

    // Sikap (indeks BF.STANCES). Beralih dari agresif menghentikan pengejaran otomatis yang sedang berjalan.
    stance(s, units, v) {
      for (const u of units) {
        const d = BF.unitDef(s, u);
        if (!d.atk && !d.heal) continue;
        u.stance = v;
        if (v && (u.order.type === 'attack' || u.order.type === 'heal') && u.order.auto) BF.setOrder(u, { type: 'idle' });
      }
    },

    attack(s, units, target) {
      for (const u of units) if (BF.unitDef(s, u).atk) BF.setOrder(u, { type: 'attack', tid: target.id });
    },

    gather(s, units, nx, ny) {
      if (!s.map.node[idx(nx, ny)]) return;
      for (const u of units) if (u.type === 'worker') BF.setOrder(u, BF.gatherOrder(s.map, nx, ny));
    },

    // Buru hewan liar: pekerja melempar tombak lalu menguliti bangkainya; unit tempur hanya membunuhnya.
    hunt(s, units, a) {
      for (const u of units) {
        if (u.type === 'worker') BF.setOrder(u, BF.huntOrder(a));
        else if (BF.unitDef(s, u).atk && a.state !== 'carcass') BF.setOrder(u, { type: 'attack', tid: a.id });
      }
    },

    farm(s, units, farm) {
      for (const u of units) if (u.type === 'worker') BF.setOrder(u, BF.farmOrder(farm));
    },

    build(s, units, b) {
      for (const u of units) if (u.type === 'worker') BF.setOrder(u, { type: 'build', bid: b.id });
    },

    // Perbaiki bangunan sendiri yang sudah jadi (sim.js menghentikannya bila nyawa penuh atau stok habis).
    // Tabib menyembuhkan unit sendiri yang ditunjuk (mengikutinya sampai pulih).
    heal(s, units, t) {
      for (const u of units) if (BF.canHeal(s, u, t)) BF.setOrder(u, { type: 'heal', tid: t.id });
    },

    repair(s, units, b) {
      for (const u of units) if (u.type === 'worker') BF.setOrder(u, { type: 'repair', bid: b.id });
    },

    // Setor bawaan ke bangunan tertentu.
    dropoff(s, units, b) {
      for (const u of units)
        if (u.type === 'worker' && u.carry > 0) BF.setOrder(u, { type: 'gather', state: 'return', drop: b.id, last: true, res: u.carryType });
    },

    // Berlindung di bangunan sendiri yang berkapasitas (balai kota, menara); kelas yang tak diizinkan diabaikan.
    garrison(s, units, b) {
      for (const u of units) if (BF.canGarrison(s, u, b)) BF.setOrder(u, { type: 'garrison', bid: b.id });
    },

    ungarrison(s, b) {
      return BF.ungarrison(s, b);
    },

    // Jual/beli satu lot sumber daya di pasar (harga di s.market).
    trade(s, owner, res, buy) {
      return BF.trade(s, s.players[owner], res, buy);
    },

    stop(s, units) {
      for (const u of units) BF.setOrder(u, { type: 'idle' });
    },

    // Return {b} bila berhasil, {err} bila gagal.
    place(s, owner, type, tx, ty) {
      const p = s.players[owner], d = p.B[type];
      if (!d) return { err: 'invalid' };
      if (p.era < d.era) return { err: 'era' };
      if (!BF.placeable(s, owner, type, tx, ty)) return { err: 'place' };
      if (!BF.canAfford(p, d.cost)) return { err: 'res' };
      const old = s.byId.get(s.map.bld[idx(tx, ty)]);
      if (old) BF.kill(s, old, true);
      BF.pay(p, d.cost);
      return { b: BF.spawnBuilding(s, type, owner, tx, ty, false) };
    },

    // Sebaris tembok. Berhenti saat batu habis. Return daftar segmen yang berhasil diletakkan.
    wall(s, owner, tiles, units) {
      const placed = [];
      for (const t of tiles) {
        const r = BF.cmd.place(s, owner, 'wall', t[0], t[1]);
        if (r.b) placed.push(r.b);
        else if (r.err === 'res' || r.err === 'era') break;
      }
      if (placed.length) BF.cmd.build(s, units, placed[0]);
      return placed;
    },

    // Return true atau kode error.
    train(s, b, unit) {
      const p = s.players[b.owner], ud = p.U[unit];
      if (!b.built || !ud || BF.trainable(p, b.type).indexOf(unit) < 0) return 'invalid';
      if (p.era < ud.era) return 'era';
      if (b.queue.length >= MAX_QUEUE) return 'queue';
      if (!BF.canAfford(p, ud.cost)) return 'res';
      BF.pay(p, ud.cost);
      b.queue.push({ unit, t: 0 });
      return true;
    },

    research(s, b, key) {
      const p = s.players[b.owner], t = BF.TECHS[key];
      if (!b.built || !t || t.at !== b.type) return 'invalid';
      if (p.techs.indexOf(key) >= 0 || p.techQ[key]) return 'busy';
      if (p.era < t.era) return 'era';
      if (t.req && p.techs.indexOf(t.req) < 0) return 'req';
      if (b.queue.length >= MAX_QUEUE) return 'queue';
      if (!BF.canAfford(p, t.cost)) return 'res';
      BF.pay(p, t.cost);
      p.techQ[key] = 1;
      b.queue.push({ tech: key, t: 0, time: t.time, cost: t.cost });
      return true;
    },

    advanceEra(s, b) {
      const p = s.players[b.owner], next = BF.ERAS[p.era + 1];
      if (!b.built || b.type !== 'townhall' || !next) return 'invalid';
      if (p.eraQueued) return 'busy';
      if (!BF.canAfford(p, next.cost)) return 'res';
      BF.pay(p, next.cost);
      p.eraQueued = true;
      b.queue.push({ era: true, t: 0, time: next.time, cost: next.cost });
      return true;
    },

    cancel(s, b, i) {
      const q = b.queue[i], p = s.players[b.owner];
      if (!q) return;
      if (q.era) { BF.refund(p, q.cost); p.eraQueued = false; }
      else if (q.tech) { BF.refund(p, q.cost); delete p.techQ[q.tech]; }
      else BF.refund(p, p.U[q.unit].cost);
      b.queue.splice(i, 1);
    },

    rally(s, b, x, y) {
      const tx = x | 0, ty = y | 0, node = BF.inBounds(tx, ty) ? s.map.node[idx(tx, ty)] : 0;
      b.rally = node ? { x, y, node, nx: tx, ny: ty } : { x, y };
    },

    // Menghancurkan milik sendiri. Bangunan yang belum jadi mengembalikan sisa biaya.
    destroy(s, e) {
      const p = s.players[e.owner];
      if (e.kind === 'building') {
        if (!e.built) BF.refund(p, p.B[e.type].cost, 1 - e.progress);
        for (let i = e.queue.length - 1; i >= 0; i--) BF.cmd.cancel(s, e, i);
      }
      BF.kill(s, e, true);
    },
  };

  // Jalankan perintah berbentuk data atas nama pemain `pid`. Semua id divalidasi: pemain hanya
  // bisa memerintah miliknya sendiri. Perintah yang tidak valid diabaikan tanpa efek.
  BF.exec = function (s, pid, c) {
    if (!c || typeof c !== 'object' || s.over || !s.players[pid] || s.players[pid].out) return;
    const num = v => typeof v === 'number' && isFinite(v);
    const own = (id, kind) => {
      const e = s.byId.get(id);
      return e && !e.dead && e.owner === pid && (!kind || e.kind === kind) ? e : null;
    };
    const units = () => (Array.isArray(c.ids) ? c.ids.slice(0, MAX_IDS) : []).map(id => own(id, 'unit')).filter(Boolean);
    const tile = (x, y) => num(x) && num(y) && BF.inBounds(x | 0, y | 0);
    switch (c.c) {
      case 'move': if (num(c.x) && num(c.y)) BF.cmd.move(s, units(), c.x, c.y, !!c.attack, c.f === 1 || c.f === 2 ? c.f : 0); break;
      case 'attack': {
        const t = s.byId.get(c.tid);
        if (t && !t.dead && t.owner !== pid) BF.cmd.attack(s, units(), t);
        break;
      }
      case 'gather': if (tile(c.nx, c.ny)) BF.cmd.gather(s, units(), c.nx | 0, c.ny | 0); break;
      case 'hunt': { const a = s.byId.get(c.aid); if (a && !a.dead && a.kind === 'animal') BF.cmd.hunt(s, units(), a); break; }
      case 'farm': { const f = own(c.bid, 'building'); if (f && f.type === 'farm' && f.built) BF.cmd.farm(s, units(), f); break; }
      case 'build': { const b = own(c.bid, 'building'); if (b && !b.built) BF.cmd.build(s, units(), b); break; }
      case 'repair': { const b = own(c.bid, 'building'); if (b && b.built) BF.cmd.repair(s, units(), b); break; }
      case 'heal': { const t = own(c.tid, 'unit'); if (t) BF.cmd.heal(s, units(), t); break; }
      case 'patrol': if (num(c.x) && num(c.y)) BF.cmd.patrol(s, units(), c.x, c.y); break;
      case 'stance': if (c.v === 0 || c.v === 1 || c.v === 2) BF.cmd.stance(s, units(), c.v); break;
      case 'trade': {
        const b = own(c.bid, 'building');
        if (b && b.built && b.type === 'market' && (c.res === 'food' || c.res === 'wood' || c.res === 'stone')) BF.cmd.trade(s, pid, c.res, !!c.buy);
        break;
      }
      case 'garrison': { const b = own(c.bid, 'building'); if (b) BF.cmd.garrison(s, units(), b); break; }
      case 'ungarrison': { const b = own(c.bid, 'building'); if (b) BF.cmd.ungarrison(s, b); break; }
      case 'dropoff': { const b = own(c.bid, 'building'); if (b && b.built && BF.BUILDINGS[b.type].dropoff) BF.cmd.dropoff(s, units(), b); break; }
      case 'stop': BF.cmd.stop(s, units()); break;
      case 'place': {
        if (!BF.BUILDINGS[c.type] || !tile(c.tx, c.ty)) break;
        const r = BF.cmd.place(s, pid, c.type, c.tx | 0, c.ty | 0);
        if (r.b) BF.cmd.build(s, units(), r.b);
        break;
      }
      case 'wall': {
        if (!Array.isArray(c.tiles)) break;
        const tiles = c.tiles.slice(0, MAX_WALL).filter(t => Array.isArray(t) && tile(t[0], t[1])).map(t => [t[0] | 0, t[1] | 0]);
        BF.cmd.wall(s, pid, tiles, units());
        break;
      }
      case 'train': { const b = own(c.bid, 'building'); if (b) BF.cmd.train(s, b, c.unit); break; }
      case 'research': { const b = own(c.bid, 'building'); if (b) BF.cmd.research(s, b, c.tech); break; }
      case 'era': { const b = own(c.bid, 'building'); if (b) BF.cmd.advanceEra(s, b); break; }
      case 'cancel': { const b = own(c.bid, 'building'); if (b && num(c.i)) BF.cmd.cancel(s, b, c.i | 0); break; }
      case 'rally': { const b = own(c.bid, 'building'); if (b && b.built && num(c.x) && num(c.y)) BF.cmd.rally(s, b, BF.clamp(c.x, 0, BF.MAP_SIZE - 0.01), BF.clamp(c.y, 0, BF.MAP_SIZE - 0.01)); break; }
      case 'destroy':
        for (const id of (Array.isArray(c.ids) ? c.ids.slice(0, MAX_IDS) : [])) { const e = own(id); if (e) BF.cmd.destroy(s, e); }
        break;
      case 'resign': BF.resign(s, pid); break;
    }
  };

  BF.issue = function (c) {
    const s = BF.game.s;
    BF.exec(s, s.human, c);
  };
})();
