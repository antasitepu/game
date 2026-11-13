'use strict';
// AI lawan: ekonomi → rumah → bangunan militer → naik era → teknologi → gelombang serangan.
// Memakai BF.cmd yang sama dengan pemain, jadi tunduk pada biaya dan aturan yang sama.
(function () {
  const idx = BF.idx, dist = BF.dist;
  const SHARES = [
    { food: 0.5, wood: 0.38, gold: 0.12, stone: 0 },
    { food: 0.4, wood: 0.3, gold: 0.22, stone: 0.08 },
    { food: 0.36, wood: 0.27, gold: 0.3, stone: 0.07 },
  ];
  const NODE_OF = { wood: BF.N_TREE, gold: BF.N_GOLD, stone: BF.N_STONE };
  // Urutan prioritas riset: ekonomi dulu, lalu senjata.
  const TECH_ORDER = ['kapak', 'bajak', 'gerobak', 'tempa', 'beliung', 'zirah', 'panah', 'tukang', 'tempa2', 'zirah2', 'panah2'];

  function areaFree(map, tx, ty, w) {
    for (let y = ty; y < ty + w; y++)
      for (let x = tx; x < tx + w; x++) {
        if (!BF.inBounds(x, y)) return false;
        const i = idx(x, y);
        if (map.terrain[i] !== 0 || map.node[i] !== 0 || map.bld[i] !== 0) return false;
      }
    return true;
  }

  // Cari tapak kosong di sekitar (cx, cy), cincin demi cincin. margin = jarak bebas di sekeliling.
  function findSpot(s, type, cx, cy, rMin, rMax, margin, region) {
    const size = BF.BUILDINGS[type].size, map = s.map;
    for (let r = rMin; r <= rMax; r++) {
      const cands = [];
      for (let d = -r; d <= r; d++) {
        cands.push([d, -r]);
        if (r > 0) cands.push([d, r]);
        if (d > -r && d < r) cands.push([-r, d], [r, d]);
      }
      const off = (BF.rnd(s) * cands.length) | 0;
      for (let k = 0; k < cands.length; k++) {
        const c = cands[(k + off) % cands.length];
        const tx = Math.round(cx + c[0] - size / 2), ty = Math.round(cy + c[1] - size / 2);
        if (!areaFree(map, tx - margin, ty - margin, size + margin * 2)) continue;
        if (region && map.region[idx(tx, ty)] !== region) continue;
        return { tx, ty };
      }
    }
    return null;
  }

  function pickBuilder(workers, x, y) {
    let best = null, bd = 1e9;
    for (const w of workers) {
      if (w.order.type === 'build') continue;
      const d = dist(w.x - x, w.y - y) + (w.order.type === 'idle' ? 0 : 6);
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }

  function construct(s, p, c, type, cx, cy, rMin, rMax, margin, builder) {
    if (!BF.canAfford(p, p.B[type].cost)) return null;
    const spot = findSpot(s, type, cx, cy, rMin, rMax, margin, c.region);
    if (!spot) return null;
    const w = builder || pickBuilder(c.workers, spot.tx, spot.ty);
    if (!w) return null;
    const r = BF.cmd.place(s, p.id, type, spot.tx, spot.ty);
    if (!r.b) return null;
    BF.cmd.build(s, [w], r.b);
    (c.own[type] || (c.own[type] = [])).push(r.b);
    c.pending.push(r.b);
    return r.b;
  }

  // Buruan untuk AI: bangkai atau rusa paling dekat ≤ 14 tile dari markas, paling banyak 3 pemburu per hewan
  // (babi hutan dihindari — menyeruduk balik).
  function prey(s, c) {
    let best = null, bd = 14;
    for (const a of s.animals) {
      if (a.dead || (a.state !== 'carcass' && a.type !== 'deer') || s.map.region[idx(a.x | 0, a.y | 0)] !== c.region) continue;
      if (c.workers.filter(w => w.order.animal === a.id).length >= 3) continue;
      const d = BF.dist(a.x - c.hx, a.y - c.hy) - (a.state === 'carcass' ? 2 : 0);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  function assign(s, p, c, w, res) {
    const map = s.map, hx = c.hx | 0, hy = c.hy | 0;
    if (res === 'food') {
      const a = prey(s, c);
      if (a) { BF.cmd.hunt(s, [w], a); return true; }
      const n = BF.findNode(map, hx, hy, BF.N_BERRY, 16, c.region);
      if (n) { BF.cmd.gather(s, [w], n.x, n.y); return true; }
      const f = (c.own.farm || []).find(f => f.built && BF.farmFree(s, f, w));
      if (f) { f.worker = w.id; BF.cmd.farm(s, [w], f); return true; }
      return !!construct(s, p, c, 'farm', c.hx, c.hy, 3, 13, 0, w);
    }
    const n = BF.findNode(map, hx, hy, NODE_OF[res], 45, c.region);
    if (!n) return false;
    BF.cmd.gather(s, [w], n.x, n.y);
    return true;
  }

  // Perbaikan: satu bangunan rusak (nyawa < 65%, bukan tembok) per giliran, hanya bila tak ada musuh dalam 8 tile dan
  // stok bahan bangunannya masih ≥ 40; dikerjakan 2 pekerja terdekat (3 untuk bangunan besar) yang tidak sedang menyetor.
  function repairs(s, p, c) {
    for (const b of s.buildings) {
      if (b.owner !== p.id || b.dead || !b.built || BF.BUILDINGS[b.type].barrier) continue;
      const max = p.B[b.type].hp, cx = b.tx + b.size / 2, cy = b.ty + b.size / 2;
      if (b.hp >= max * 0.65) continue;
      if (Object.keys(p.B[b.type].cost).some(r => p.res[r] < 40)) continue;
      if (s.units.some(u => u.owner !== p.id && !u.dead && dist(u.x - cx, u.y - cy) < 8)) continue;
      const want = (b.size >= 3 ? 3 : 2) - c.workers.filter(w => w.order.type === 'repair' && w.order.bid === b.id).length;
      if (want <= 0) continue;
      const pool = c.workers.filter(w => w.order.type === 'idle' || (w.order.type === 'gather' && w.order.state !== 'return'))
        .sort((a, b2) => dist(a.x - cx, a.y - cy) - dist(b2.x - cx, b2.y - cy)).slice(0, want);
      if (pool.length) BF.cmd.repair(s, pool, b);
      return;
    }
  }

  function census(s, p) {
    const c = { workers: [], army: [], idle: [], cnt: { food: 0, wood: 0, gold: 0, stone: 0 }, own: {}, pending: [], types: {} };
    for (const u of s.units) {
      if (u.owner !== p.id || u.dead) continue;
      if (u.type === 'worker') {
        c.workers.push(u);
        if (u.order.type === 'idle') c.idle.push(u);
        else if (u.order.type === 'gather') c.cnt[u.order.res]++;
      } else {
        c.army.push(u);
        c.types[u.type] = (c.types[u.type] || 0) + 1;
      }
    }
    for (const b of s.buildings) {
      if (b.owner !== p.id || b.dead) continue;
      (c.own[b.type] || (c.own[b.type] = [])).push(b);
      if (!b.built) c.pending.push(b);
      for (const q of b.queue) if (q.unit && q.unit !== 'worker') c.types[q.unit] = (c.types[q.unit] || 0) + 1;
    }
    return c;
  }

  // Porsi pekerja per sumber daya: porsi dasar era, digeser menurut stok (stok menumpuk → kurangi).
  function shares(p) {
    const base = SHARES[p.era], out = {};
    let sum = 0;
    for (const r of BF.RES) {
      const stock = p.res[r];
      out[r] = base[r] * (stock < 100 ? 1.4 : stock > 800 ? 0.3 : stock > 400 ? 0.6 : 1);
      sum += out[r];
    }
    for (const r of BF.RES) out[r] /= sum;
    return out;
  }

  function economy(s, p, ai, c) {
    const share = shares(p), total = c.workers.length, cnt = c.cnt;
    for (const w of c.idle) {
      if (w.order.type !== 'idle') continue;
      const order = BF.RES.slice().sort((a, b) => (share[b] * total - cnt[b]) - (share[a] * total - cnt[a]));
      for (const r of order) if (assign(s, p, c, w, r)) { cnt[r]++; break; }
    }
    // Seimbangkan ulang perlahan saat kebutuhan bergeser (misal setelah naik era).
    if (total >= 2 && s.tick - ai.rebalT > 160) {
      let lo = null, hi = null, lv = -1, hv = 1;
      for (const r of BF.RES) {
        const v = cnt[r] - share[r] * total;
        if (v < lv) { lv = v; lo = r; }
        if (v > hv) { hv = v; hi = r; }
      }
      if (lo && hi) {
        const w = c.workers.find(w => w.order.type === 'gather' && w.order.res === hi && w.order.state === 'go') ||
          c.workers.find(w => w.order.type === 'gather' && w.order.res === hi);
        if (w && assign(s, p, c, w, lo)) { cnt[hi]--; cnt[lo]++; ai.rebalT = s.tick; }
      }
    }
  }

  function storages(s, p, c) {
    if (c.pending.some(b => b.type === 'storage') || !BF.canAfford(p, p.B.storage.cost)) return;
    const drops = (c.own.townhall || []).concat(c.own.storage || []);
    for (const res of ['wood', 'gold', 'stone']) {
      if (c.cnt[res] < 2) continue;
      const w = c.workers.find(w => w.order.type === 'gather' && w.order.res === res && w.order.state !== 'return');
      if (!w) continue;
      const nx = w.order.nx + 0.5, ny = w.order.ny + 0.5;
      let near = 1e9;
      for (const b of drops) near = Math.min(near, BF.distToBuilding(b, nx, ny));
      if (near > 7 && construct(s, p, c, 'storage', nx, ny, 1, 5, 0, w)) return;
    }
  }

  function research(s, p, c, diff, spendOK) {
    if (p.techs.length + Object.keys(p.techQ).length >= diff.techs) return;
    for (const key of TECH_ORDER) {
      const t = BF.TECHS[key];
      if (p.techs.indexOf(key) >= 0 || p.techQ[key] || p.era < t.era || (t.req && p.techs.indexOf(t.req) < 0)) continue;
      if (!BF.canAfford(p, t.cost) || !spendOK(t.cost)) continue;
      const b = (c.own[t.at] || []).find(b => b.built && b.queue.length < 2);
      if (b && BF.cmd.research(s, b, key) === true) return; // satu riset per giliran berpikir
    }
  }

  function military(s, p, ai, c, diff, spendOK, underAttack) {
    const has = t => (c.own[t] ? c.own[t].length : 0);
    const total = c.workers.length;
    const front = (type, d) => p.B[type].era <= p.era && spendOK(p.B[type].cost) &&
      construct(s, p, c, type, c.hx + ai.dirX * d, c.hy + ai.dirY * d, 0, 12, 1);
    if (!c.pending.some(b => b.type !== 'house' && b.type !== 'farm' && b.type !== 'storage')) {
      if (!has('townhall')) construct(s, p, c, 'townhall', c.hx, c.hy, 0, 12, 1);
      else if (!has('barracks')) { if (total >= 6) front('barracks', 7); }
      else if (p.era >= 1 && !has('range')) front('range', 8);
      else if (p.era >= 1 && !has('stable')) front('stable', 8);
      else if (p.era >= 1 && !has('smithy') && diff.techs > 2) front('smithy', 4);
      else if (p.era >= 1 && has('tower') < diff.towers && p.res.stone >= 150) front('tower', 5);
      else if (p.era >= 2 && !has('workshop')) front('workshop', 9);
      else if (p.era >= 1 && has('barracks') < 2 && p.res.wood > 450) front('barracks', 9);
    }
    let size = c.army.length;
    for (const t in c.own) for (const b of c.own[t]) for (const q of b.queue) if (q.unit && q.unit !== 'worker') size++;
    if (size >= diff.maxArmy && !underAttack) return;
    // Tiap bangunan melatih unit yang jumlahnya paling sedikit di antara pilihannya → komposisi berimbang.
    for (const type of ['barracks', 'range', 'stable', 'workshop']) {
      for (const b of c.own[type] || []) {
        if (!b.built || b.queue.length >= 2) continue;
        let pick = null, pv = 1e9;
        for (const ut of BF.trainable(p, type)) {
          const ud = p.U[ut];
          if (ud.era > p.era || (ut === 'catapult' && (c.types.catapult || 0) >= 3)) continue;
          if (ut === 'spear' && p.era >= 1 && (c.types.spear || 0) >= 4) continue; // tombak cukup sebagai anti-kuda
          const v = c.types[ut] || 0;
          if (v < pv) { pv = v; pick = ut; }
        }
        if (!pick || !BF.canAfford(p, p.U[pick].cost) || !spendOK(p.U[pick].cost)) continue;
        if (BF.cmd.train(s, b, pick) === true) c.types[pick] = (c.types[pick] || 0) + 1;
      }
    }
  }

  function warfare(s, p, ai, c, diff, underAttack) {
    const army = c.army, rx = c.hx + ai.dirX * 7, ry = c.hy + ai.dirY * 7;
    if (ai.state === 'build') {
      if (underAttack) {
        const list = army.filter(u => u.order.type === 'idle' || u.order.type === 'move');
        if (list.length) BF.cmd.move(s, list, p.lastHitX, p.lastHitY, true);
      } else {
        const list = army.filter(u => u.order.type === 'idle' && dist(u.x - rx, u.y - ry) > 6);
        if (list.length) BF.cmd.move(s, list, rx, ry);
        if (army.length >= ai.waveSize && s.tick >= diff.firstAttack) { ai.state = 'attack'; ai.sent = army.length; ai.target = 0; }
      }
    }
    if (ai.state !== 'attack') return;
    if (army.length <= Math.max(1, Math.floor(ai.sent * 0.25))) {
      ai.state = 'build';
      ai.waveSize = Math.min(diff.maxWave, ai.waveSize + diff.waveGrow);
      if (army.length) BF.cmd.move(s, army, rx, ry);
      return;
    }
    ai.sent = Math.max(ai.sent, army.length);
    let t = s.byId.get(ai.target), fresh = false;
    if (!t || t.dead) {
      let mx = 0, my = 0;
      for (const u of army) { mx += u.x; my += u.y; }
      mx /= army.length; my /= army.length;
      // Sasaran: bangunan musuh terdekat; tembok/gerbang hanya bila tidak ada pilihan lain.
      const nearest = barrier => {
        let best = null, bd = 1e9;
        for (const b of s.buildings) {
          if (b.owner === p.id || b.dead || !!BF.BUILDINGS[b.type].barrier !== barrier) continue;
          const d = BF.distToBuilding(b, mx, my);
          if (d < bd) { bd = d; best = b; }
        }
        return best;
      };
      t = nearest(false) || nearest(true);
      if (!t) {
        let bd = 1e9;
        for (const u of s.units) {
          if (u.owner === p.id || u.dead) continue;
          const d = dist(u.x - mx, u.y - my);
          if (d < bd) { bd = d; t = u; }
        }
      }
      ai.target = t ? t.id : 0;
      fresh = true;
    }
    if (!t) return;
    const tx = t.kind === 'unit' ? t.x : t.tx + t.size / 2, ty = t.kind === 'unit' ? t.y : t.ty + t.size / 2;
    const list = army.filter(u => (fresh ? u.order.type !== 'attack' : u.order.type === 'idle'));
    if (list.length) BF.cmd.move(s, list, tx, ty, true);
  }

  BF.aiThink = function (s, p) {
    const diff = BF.DIFF[s.difficulty], map = s.map;
    const ai = p.ai || (p.ai = { state: 'build', waveSize: diff.firstWave, sent: 0, target: 0, rebalT: 0, dirX: 0, dirY: 0 });
    const c = census(s, p);
    const th = (c.own.townhall || []).find(b => b.built);
    const anchor = th || (c.own.townhall || [])[0] || s.buildings.find(b => b.owner === p.id && !b.dead && !BF.BUILDINGS[b.type].barrier);
    if (!anchor) return;
    c.hx = anchor.tx + anchor.size / 2;
    c.hy = anchor.ty + anchor.size / 2;
    c.region = map.region[idx(anchor.tx, anchor.ty)];
    const foe = s.buildings.find(b => b.owner !== p.id && !b.dead && !BF.BUILDINGS[b.type].barrier);
    if (foe) {
      const dx = foe.tx - c.hx, dy = foe.ty - c.hy, l = dist(dx, dy) || 1;
      ai.dirX = dx / l; ai.dirY = dy / l;
    }
    const underAttack = s.tick - p.lastHitTick < 160;
    const total = c.workers.length;

    for (const b of c.pending) {
      if (c.workers.some(w => w.order.type === 'build' && w.order.bid === b.id)) continue;
      const w = pickBuilder(c.workers, b.tx, b.ty);
      if (w) BF.cmd.build(s, [w], b);
    }

    repairs(s, p, c);
    economy(s, p, ai, c);

    let queuedWorkers = 0;
    if (th) for (const q of th.queue) if (q.unit === 'worker') queuedWorkers++;
    if (th && total + queuedWorkers < diff.maxWorkers[p.era] && th.queue.length < 2) BF.cmd.train(s, th, 'worker');

    const pendingHouses = (c.own.house || []).filter(b => !b.built).length;
    const cap = p.popCap + pendingHouses * p.B.house.pop;
    if (cap < BF.MAX_POP && cap - p.pop <= (p.era ? 5 : 3) && pendingHouses < 2) construct(s, p, c, 'house', c.hx, c.hy, 4, 15, 1);

    // Menabung untuk naik era: belanja militer & riset ditahan sampai biaya era terpenuhi.
    let saving = null;
    if (th && p.era < BF.ERAS.length - 1 && !p.eraQueued) {
      const has = t => (c.own[t] ? c.own[t].length : 0);
      const ready = p.era === 0 ? total >= diff.eraWorkers[0] && has('barracks') : total >= diff.eraWorkers[1] && has('range') + has('stable') > 0;
      if (ready) {
        const cost = BF.ERAS[p.era + 1].cost;
        if (BF.canAfford(p, cost)) BF.cmd.advanceEra(s, th); else saving = cost;
      }
    }
    const spendOK = cost => !saving || underAttack || BF.RES.every(r => p.res[r] - (cost[r] || 0) >= (saving[r] || 0));

    storages(s, p, c);
    // Riset sebelum belanja pasukan: sekali bayar, manfaatnya permanen.
    if (!underAttack && c.army.length >= 3) research(s, p, c, diff, spendOK);
    military(s, p, ai, c, diff, spendOK, underAttack);
    warfare(s, p, ai, c, diff, underAttack);
  };
})();
