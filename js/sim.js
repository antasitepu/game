'use strict';
// Simulasi inti: state game, perilaku unit/bangunan, pertempuran, teknologi, kabut perang, kondisi menang.
// Tidak menyentuh DOM dan sepenuhnya deterministik (syarat multiplayer lockstep & simpan/muat).
(function () {
  const N = BF.MAP_SIZE, DT = BF.DT, idx = BF.idx, dist = BF.dist;
  // Definisi efektif (setelah bonus wangsa & teknologi) disimpan per pemain: p.U / p.B.
  const UD = (s, u) => s.players[u.owner].U[u.type];
  const BD = (s, b) => s.players[b.owner].B[b.type];
  BF.unitDef = UD;
  BF.bldDef = BD;
  // Event "ramai" (suara tempur) dibatasi; event penting memakai s.events.push langsung.
  const emit = (s, e) => { if (s.events.length < 250) s.events.push(e); };

  BF.canAfford = function (p, cost) {
    for (const k in cost) if (p.res[k] < cost[k]) return false;
    return true;
  };
  BF.pay = function (p, cost) {
    for (const k in cost) p.res[k] -= cost[k];
  };
  BF.refund = function (p, cost, frac) {
    for (const k in cost) p.res[k] += Math.floor(cost[k] * (frac === undefined ? 1 : frac));
  };

  BF.distToBuilding = function (b, x, y) {
    const dx = x < b.tx ? b.tx - x : x > b.tx + b.size ? x - b.tx - b.size : 0;
    const dy = y < b.ty ? b.ty - y : y > b.ty + b.size ? y - b.ty - b.size : 0;
    return dist(dx, dy);
  };
  BF.bRect = (b, range) => ({ x0: b.tx, y0: b.ty, x1: b.tx + b.size - 1, y1: b.ty + b.size - 1, range });

  BF.buildingSeen = function (s, b) {
    if (b.owner === s.human) return true;
    const e = s.fog.explored, k = b.size - 1;
    return !!(e[idx(b.tx, b.ty)] || e[idx(b.tx + k, b.ty)] || e[idx(b.tx, b.ty + k)] || e[idx(b.tx + k, b.ty + k)]);
  };

  // Unit yang bisa dilatih pemain p di bangunan bertipe `type` (unit unik hanya untuk wangsanya).
  BF.trainable = function (p, type) {
    return (BF.BUILDINGS[type].trains || []).filter(u => !BF.UNITS[u].faction || BF.UNITS[u].faction === p.faction);
  };

  // Teknologi yang ditawarkan bangunan bertipe `type` dan belum diteliti/antre.
  BF.techsAt = function (p, type) {
    return Object.keys(BF.TECHS).filter(k => BF.TECHS[k].at === type && p.techs.indexOf(k) < 0 && !p.techQ[k]);
  };

  // ---------------------------------------------------------------- definisi efektif

  function applyFx(p, fx) {
    const ap = v => (fx.mul !== undefined ? v * fx.mul : v + fx.add);
    if (fx.p) {
      const k = fx.p.split('.');
      if (k.length === 2) p.mod[k[0]][k[1]] = ap(p.mod[k[0]][k[1]]);
      else p.mod[k[0]] = ap(p.mod[k[0]]);
      return;
    }
    const defs = fx.u ? p.U : p.B, sel = fx.u || fx.b;
    for (const key in defs) {
      const d = defs[key];
      if (!(sel === '*' || sel === key || sel === 'cls:' + d.cls)) continue;
      if (fx.stat === 'cost') { for (const r in d.cost) d.cost[r] = Math.round(ap(d.cost[r])); }
      else if (d[fx.stat] !== undefined && !(fx.stat === 'atk' && !d.atk)) d[fx.stat] = ap(d[fx.stat]);
    }
  }

  // Bangun ulang p.U / p.B / p.mod dari data dasar + efek wangsa + teknologi yang sudah diteliti.
  BF.rebuildDefs = function (p) {
    const clone = defs => {
      const o = {};
      for (const k in defs) { o[k] = Object.assign({}, defs[k]); o[k].cost = Object.assign({}, defs[k].cost); }
      return o;
    };
    p.U = clone(BF.UNITS);
    p.B = clone(BF.BUILDINGS);
    p.mod = { carry: BF.CARRY_CAP, gather: Object.assign({}, BF.GATHER_RATE) };
    for (const fx of BF.FACTIONS[p.faction].effects) applyFx(p, fx);
    for (const t of p.techs) for (const fx of BF.TECHS[t].effects) applyFx(p, fx);
    for (const k in p.U) p.U[k].hp = Math.round(p.U[k].hp);
    for (const k in p.B) p.B[k].hp = Math.round(p.B[k].hp);
  };

  function completeTech(s, p, key) {
    const oldU = p.U, oldB = p.B;
    p.techs.push(key);
    delete p.techQ[key];
    BF.rebuildDefs(p);
    // Kenaikan HP maksimum langsung dinikmati unit/bangunan yang sudah ada.
    for (const u of s.units) if (u.owner === p.id) u.hp += p.U[u.type].hp - oldU[u.type].hp;
    for (const b of s.buildings) if (b.owner === p.id && b.built) b.hp += p.B[b.type].hp - oldB[b.type].hp;
    s.events.push({ type: 'tech', owner: p.id, tech: key });
  }

  // ---------------------------------------------------------------- state

  BF.newGame = function (opts) {
    opts = opts || {};
    const seed = opts.seed !== undefined ? opts.seed : (Math.random() * 2147483647) | 0;
    const map = BF.createMap(seed);
    const s = {
      seed, map, tick: 0, nextId: 1, rng: (seed ^ 0x5bd1e995) | 0,
      units: [], buildings: [], animals: [], projectiles: [], effects: [], events: [],
      byId: new Map(), players: [], human: opts.human || 0, over: false, winner: -1, hasDead: false,
      difficulty: opts.difficulty || 'normal', mp: !!opts.mp,
      fog: { explored: new Uint8Array(N * N), visible: new Uint8Array(N * N), version: 0 },
    };
    const ai = opts.ai || [false, true], fkeys = Object.keys(BF.FACTIONS);
    for (let i = 0; i < 2; i++) {
      const slot = BF.SLOTS[i], faction = (opts.factions && opts.factions[i]) || fkeys[(BF.rnd(s) * fkeys.length) | 0];
      const p = {
        id: i, faction, name: BF.FACTIONS[faction].name, color: slot.color, dark: slot.dark, light: slot.light,
        res: Object.assign({}, BF.START_RES), era: 0, eraQueued: false, techs: [], techQ: {}, pop: 0, popCap: 0,
        isAI: !!ai[i], ai: null, alertTick: -9999, alertX: 0, alertY: 0, lastHitTick: -9999, lastHitX: 0, lastHitY: 0,
        kills: 0, losses: 0, gathered: 0,
      };
      BF.rebuildDefs(p);
      s.players.push(p);
    }
    map.starts.forEach((st, i) => {
      BF.spawnBuilding(s, 'townhall', i, st.x - 1, st.y - 1, true);
      for (let k = 0; k < BF.START_WORKERS; k++) BF.spawnUnit(s, 'worker', i, st.x - 1 + k * 0.9, st.y + 2.5);
    });
    spawnAnimals(s);
    BF.updateFog(s);
    return s;
  };

  BF.spawnUnit = function (s, type, owner, x, y) {
    const d = s.players[owner].U[type];
    const u = {
      id: s.nextId++, kind: 'unit', type, owner, x, y, hp: d.hp, dir: Math.PI / 2,
      order: { type: 'idle' }, path: null, pi: 0, repathT: 0, cd: 0, atkAnim: 0, breach: 0,
      carry: 0, carryType: null, moving: false, working: false, stance: 0, dead: false,
    };
    s.units.push(u);
    s.byId.set(u.id, u);
    s.players[owner].pop += d.pop;
    return u;
  };

  BF.spawnBuilding = function (s, type, owner, tx, ty, built) {
    const d = s.players[owner].B[type], map = s.map;
    const b = {
      id: s.nextId++, kind: 'building', type, owner, tx, ty, size: d.size,
      hp: built ? d.hp : 1, built: !!built, progress: built ? 1 : 0,
      queue: [], rally: null, cd: 0, worker: 0, inside: [], dead: false,
    };
    const blockVal = d.walkable ? 0 : d.gate ? 2 + owner : 1;
    for (let y = ty; y < ty + d.size; y++)
      for (let x = tx; x < tx + d.size; x++) {
        const i = idx(x, y);
        map.bld[i] = b.id;
        map.block[i] = blockVal;
      }
    map.version++;
    s.buildings.push(b);
    s.byId.set(b.id, b);
    if (built) s.players[owner].popCap += d.pop || 0;
    if (!d.walkable) {
      // Unit yang berdiri di tapak bangunan dipindahkan keluar (kecuali pemilik gerbang).
      for (const u of s.units) {
        if (u.dead || u.x < tx || u.y < ty || u.x >= tx + d.size || u.y >= ty + d.size) continue;
        if (d.gate && u.owner === owner) continue;
        const f = BF.findFreeNear(map, u.x | 0, u.y | 0, 8, u.owner);
        if (f) { u.x = f.x + 0.5; u.y = f.y + 0.5; }
        u.path = null;
        u.order.planned = false;
      }
    }
    return b;
  };

  BF.kill = function (s, t) {
    if (t.dead) return;
    t.dead = true;
    s.hasDead = true;
    s.byId.delete(t.id);
    const p = s.players[t.owner];
    p.losses++;
    if (t.kind === 'unit') {
      p.pop -= p.U[t.type].pop;
      const cls = p.U[t.type].cls;
      s.effects.push({ type: 'death', x: t.x, y: t.y, t: 0, life: 7, owner: t.owner, big: cls === 'cavalry' || cls === 'siege', unit: t.type });
      emit(s, { type: 'death', x: t.x, y: t.y });
    } else {
      const map = s.map, d = p.B[t.type];
      for (let y = t.ty; y < t.ty + t.size; y++)
        for (let x = t.tx; x < t.tx + t.size; x++) {
          const i = idx(x, y);
          if (map.bld[i] === t.id) { map.bld[i] = 0; map.block[i] = 0; }
        }
      map.version++;
      BF.ungarrison(s, t, true);                           // yang berlindung selamat, muncul di bekas tapak bangunan
      if (t.built) p.popCap -= d.pop || 0;
      for (const q of t.queue) {
        if (q.era) p.eraQueued = false;
        if (q.tech) delete p.techQ[q.tech];
      }
      const cx = t.tx + t.size / 2, cy = t.ty + t.size / 2;
      s.effects.push({ type: 'boom', x: cx, y: cy, t: 0, life: 0.9, r: t.size * 0.7 });
      if (t.type !== 'farm') s.effects.push({ type: 'rubble', x: cx, y: cy, t: 0, life: 16, size: t.size, bt: t.type, owner: t.owner });
      emit(s, { type: 'collapse', x: cx, y: cy });
    }
  };

  BF.resign = function (s, pid) {
    if (s.over) return;
    s.over = true;
    s.winner = 1 - pid;
    s.events.push({ type: 'over', winner: s.winner, resigned: pid });
  };

  // Checksum state untuk mendeteksi desinkronisasi multiplayer.
  BF.hash = function (s) {
    let h = 2166136261 >>> 0;
    const mix = v => { h ^= v | 0; h = Math.imul(h, 16777619) >>> 0; };
    mix(s.tick); mix(s.nextId); mix(s.rng);
    for (const u of s.units) { mix(u.id); mix(Math.round(u.x * 1000)); mix(Math.round(u.y * 1000)); mix(Math.round(u.hp * 100)); }
    for (const b of s.buildings) { mix(b.id); mix(Math.round(b.hp * 100)); mix(Math.round(b.progress * 1000)); mix(b.inside.length); }
    for (const a of s.animals) { mix(a.id); mix(Math.round(a.x * 1000)); mix(Math.round(a.y * 1000)); mix(Math.round(a.hp * 100)); mix(a.food); }
    for (const p of s.players) { for (const r of BF.RES) mix(Math.round(p.res[r])); mix(p.pop); mix(p.era); mix(p.techs.length); }
    return h;
  };

  // ---------------------------------------------------------------- order

  function setIdle(u) {
    u.order = { type: 'idle' };
    u.path = null;
  }

  BF.setOrder = function (u, order) {
    u.order = order;
    u.path = null;
  };

  BF.moveOrder = function (s, x, y, attack, owner) {
    x = BF.clamp(x, 0, N - 0.01);
    y = BF.clamp(y, 0, N - 0.01);
    let tx = x | 0, ty = y | 0;
    if (!BF.passable(s.map, tx, ty, owner)) {
      const f = BF.findFreeNear(s.map, tx, ty, 10, owner);
      if (f) { tx = f.x; ty = f.y; x = tx + 0.5; y = ty + 0.5; }
    }
    return { type: attack ? 'amove' : 'move', x, y, exact: true, goal: { x0: tx, y0: ty, x1: tx, y1: ty, range: 0 } };
  };

  BF.gatherOrder = function (map, nx, ny) {
    const node = map.node[idx(nx, ny)];
    return { type: 'gather', nx, ny, node, res: BF.NODES[node].res, state: 'go' };
  };

  BF.huntOrder = function (a) {
    return { type: 'gather', animal: a.id, res: 'food', state: 'go', ax: a.x, ay: a.y };
  };

  BF.farmOrder = function (f) {
    return { type: 'gather', farm: f.id, res: 'food', state: 'go' };
  };

  BF.farmFree = function (s, f, u) {
    if (!f.worker || f.worker === u.id) return true;
    const w = s.byId.get(f.worker);
    return !(w && !w.dead && w.order.type === 'gather' && w.order.farm === f.id);
  };

  // Jalan mengikuti jalur menuju goal. Return: 0 = menunggu, 1 = bergerak, 2 = tiba.
  function travel(s, u, o, goal, speed) {
    if (!o.planned) {
      if (u.repathT > 0) return 0;
      u.repathT = 6 + (u.id & 3);
      const r = BF.findPath(s.map, u.x | 0, u.y | 0, goal, u.owner), pts = r.pts;
      if (o.exact) {
        if (!r.partial) {
          if (pts.length) pts[pts.length - 1] = { x: o.x, y: o.y };
          else pts.push({ x: o.x, y: o.y });
        }
      } else if (pts.length) {
        // Geser sedikit titik akhir agar unit tidak bertumpuk persis di tengah tile.
        const l = pts[pts.length - 1];
        l.x += ((u.id * 0.618) % 1 - 0.5) * 0.5;
        l.y += ((u.id * 0.381) % 1 - 0.5) * 0.5;
      }
      u.path = pts;
      u.pi = 0;
      o.planned = true;
      o.partial = r.partial;
    }
    const p = u.path;
    if (!p || u.pi >= p.length) { u.path = null; return 2; }
    let rem = speed * DT;
    while (rem > 0 && u.pi < p.length) {
      const wp = p[u.pi];
      if (!BF.passable(s.map, wp.x | 0, wp.y | 0, u.owner)) { u.path = null; o.planned = false; return 0; }
      const dx = wp.x - u.x, dy = wp.y - u.y, d = dist(dx, dy);
      if (d > 1e-4) u.dir = Math.atan2(dy, dx);
      if (d <= rem) { u.x = wp.x; u.y = wp.y; u.pi++; rem -= d; }
      else { u.x += dx / d * rem; u.y += dy / d * rem; rem = 0; }
    }
    u.moving = true;
    if (u.pi >= p.length) { u.path = null; return 2; }
    return 1;
  }

  // ---------------------------------------------------------------- combat

  BF.damage = function (s, ad, t) {
    if (t.kind === 'animal') return Math.max(1, ad.atk);
    const isB = t.kind === 'building';
    const mult = (ad.bonus && ad.bonus[isB ? 'building' : UD(s, t).cls]) || 1;
    return Math.max(1, ad.atk * mult - (isB ? 0 : UD(s, t).armor));
  };

  BF.applyDamage = function (s, t, dmg, src) {
    if (t.dead) return;
    if (t.kind === 'animal') { hurtAnimal(s, t, dmg, src); return; }
    t.hp -= dmg;
    const p = s.players[t.owner];
    const x = t.kind === 'unit' ? t.x : t.tx + t.size / 2, y = t.kind === 'unit' ? t.y : t.ty + t.size / 2;
    p.lastHitTick = s.tick;
    p.lastHitX = x;
    p.lastHitY = y;
    if (s.tick - p.alertTick > 300) {
      p.alertTick = s.tick;
      p.alertX = x;
      p.alertY = y;
      s.events.push({ type: 'attacked', owner: t.owner, x, y });
    }
    if (t.hp <= 0) {
      BF.kill(s, t);
      if (src && src.kind !== 'animal') s.players[src.owner].kills++;
      return;
    }
    if (t.kind === 'unit' && src && !src.dead && src.owner !== t.owner && UD(s, t).atk && t.stance !== 2) {
      const o = t.order;
      if (o.type === 'idle') {
        t.path = null;
        t.order = { type: 'attack', tid: src.id, auto: true, hold: t.stance === 1, hx: t.x, hy: t.y };
      } else if (o.type === 'amove' || o.type === 'patrol') {
        t.path = null;
        o.planned = false;
        t.order = { type: 'attack', tid: src.id, resume: o };
      }
    }
  };

  // dk = kunci definisi penyerang (bukan referensi objek) agar proyektil bisa disimpan sebagai JSON.
  function spawnProjectile(s, x, y, t, d, dk, srcId) {
    let tx, ty;
    if (t.kind !== 'building') { tx = t.x; ty = t.y; }
    else { tx = BF.clamp(x, t.tx + 0.3, t.tx + t.size - 0.3); ty = BF.clamp(y, t.ty + 0.3, t.ty + t.size - 0.3); }
    s.projectiles.push({ x, y, sx: x, sy: y, tx, ty, tid: t.id, dk, owner: dk.o, src: srcId, speed: d.splash ? 7 : 13, splash: d.splash || 0, done: false });
    emit(s, { type: d.splash ? 'launch' : 'shot', x, y });
  }

  // Percikan di titik kena (visual saja).
  function hitSpark(s, t, fx, fy) {
    if (s.effects.length > 150) return;
    const x = t.kind !== 'building' ? t.x : BF.clamp(fx, t.tx + 0.2, t.tx + t.size - 0.2);
    const y = t.kind !== 'building' ? t.y : BF.clamp(fy, t.ty + 0.2, t.ty + t.size - 0.2);
    s.effects.push({ type: 'hit', x, y, t: 0, life: 0.25 });
  }

  function fire(s, u, d, t) {
    u.cd = d.cooldown;
    u.atkAnim = 0.3;
    if (d.range > 1) spawnProjectile(s, u.x, u.y, t, d, { k: 'u', t: u.type, o: u.owner }, u.id);
    else {
      emit(s, { type: 'melee', x: u.x, y: u.y });
      hitSpark(s, t, u.x, u.y);
      BF.applyDamage(s, t, BF.damage(s, d, t), u);
    }
  }

  // hold (sikap bertahan): hanya sasaran yang sudah berada dalam jangkauan serang.
  function acquire(s, u, d, hold) {
    const aggro = hold ? d.range + d.radius + 0.25 : Math.max(d.sight, d.range + 1);
    let best = null, bd = aggro;
    const scanUnits = () => {
      for (const t of s.units) {
        if (t.owner === u.owner || t.dead) continue;
        const dd = dist(t.x - u.x, t.y - u.y);
        if (dd < bd) { bd = dd; best = t; }
      }
    };
    const scanBuildings = barrier => {
      for (const b of s.buildings) {
        if (b.owner === u.owner || b.dead || !!BF.BUILDINGS[b.type].barrier !== barrier) continue;
        const dd = BF.distToBuilding(b, u.x, u.y);
        if (dd < bd) { bd = dd; best = b; }
      }
    };
    // Jalur baru saja terhalang → dobrak tembok/gerbang terdekat dulu.
    if (u.breach > s.tick) { scanBuildings(true); if (best) return best; }
    if (d.cls === 'siege') { scanBuildings(false); if (!best) scanBuildings(true); if (!best) scanUnits(); }
    else { scanUnits(); if (!best) scanBuildings(false); if (!best) scanBuildings(true); }
    return best;
  }

  function resume(u, o) {
    if (o.resume) {
      o.resume.planned = false;
      u.order = o.resume;
      u.path = null;
    } else setIdle(u);
  }

  function updateAttack(s, u, d, o) {
    const t = s.byId.get(o.tid);
    if (!t || t.dead || t.owner === u.owner || t.state === 'carcass') { resume(u, o); return; }
    const isU = t.kind !== 'building';                  // unit atau hewan liar
    const gap = isU ? dist(t.x - u.x, t.y - u.y) - (t.kind === 'animal' ? BF.ANIMALS[t.type].radius : UD(s, t).radius) : BF.distToBuilding(t, u.x, u.y);
    const reach = d.range + d.radius;
    if (gap <= reach) {
      u.path = null;
      o.planned = false;
      o.done = false;
      const ax = isU ? t.x : t.tx + t.size / 2, ay = isU ? t.y : t.ty + t.size / 2;
      u.dir = Math.atan2(ay - u.y, ax - u.x);
      if (u.cd <= 0) fire(s, u, d, t);
      return;
    }
    if (o.hold) { resume(u, o); return; }               // bertahan: sasaran di luar jangkauan dilepas, tidak dikejar
    if (o.auto && dist(u.x - o.hx, u.y - o.hy) > 10) {
      BF.setOrder(u, BF.moveOrder(s, o.hx, o.hy, false, u.owner));
      return;
    }
    if (o.done) { // sudah tiba tapi target tetap di luar jangkauan → kemungkinan terhalang tembok
      u.breach = s.tick + 120;
      resume(u, o);
      return;
    }
    if (isU) {
      if (gap < reach + 1.2) {
        // Langkah lurus ke sasaran; bila terhalang sudut penghalang, bergeser pada satu sumbu saja (tanpa ini unit jarak
        // dekat macet di tile serong dari sasarannya: jalur menganggapnya sudah tiba, padahal belum terjangkau). Geseran
        // hanya dipakai bila komponennya cukup besar, supaya unit di balik tembok tetap jatuh ke pencarian jalur/dobrak.
        const dx = t.x - u.x, dy = t.y - u.y, l = dist(dx, dy) || 1, st = d.speed * DT, sx = dx / l * st, sy = dy / l * st;
        for (const [mx, my] of [[sx, sy], [sx, 0], [0, sy]]) {
          if (Math.abs(mx) + Math.abs(my) < st * 0.35) continue;
          const nx = u.x + mx, ny = u.y + my;
          if (!BF.passable(s.map, Math.floor(nx), Math.floor(ny), u.owner)) continue;      // floor, bukan |0: −0,5 harus di luar peta
          u.x = nx; u.y = ny; u.dir = Math.atan2(dy, dx);
          u.moving = true; u.path = null; o.planned = false;
          return;
        }
      }
      const ttx = t.x | 0, tty = t.y | 0;
      if (o.planned && (o.gx !== ttx || o.gy !== tty) && u.repathT <= 0) o.planned = false;
      if (!o.planned) { o.gx = ttx; o.gy = tty; }
      const r = travel(s, u, o, { x0: o.gx, y0: o.gy, x1: o.gx, y1: o.gy, range: 1 }, d.speed);
      if (r === 2) { if (o.partial) o.done = true; else o.planned = false; }
    } else if (travel(s, u, o, BF.bRect(t, 1), d.speed) === 2) o.done = true;
  }

  // ---------------------------------------------------------------- gather

  function nearestDropoff(s, u) {
    let best = null, bd = 1e9;
    for (const b of s.buildings) {
      if (b.owner !== u.owner || b.dead || !b.built || !BF.BUILDINGS[b.type].dropoff) continue;
      const d = BF.distToBuilding(b, u.x, u.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  function findFreeFarm(s, u) {
    let best = null, bd = 1e9;
    for (const b of s.buildings) {
      if (b.owner !== u.owner || b.dead || !b.built || b.type !== 'farm' || !BF.farmFree(s, b, u)) continue;
      const d = BF.distToBuilding(b, u.x, u.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  function retarget(s, u, o) {
    const map = s.map, reg = map.region[idx(BF.clamp(u.x | 0, 0, N - 1), BF.clamp(u.y | 0, 0, N - 1))];
    const n = BF.findNode(map, o.nx, o.ny, o.node, 12, reg);
    if (!n) return false;
    o.nx = n.x; o.ny = n.y; o.state = 'go'; o.planned = false;
    u.path = null;
    return true;
  }

  // Sumber habis: setor dulu bawaan yang ada, lalu menganggur.
  function finishGather(u, o) {
    if (u.carry > 0) { o.state = 'return'; o.last = true; o.planned = false; o.drop = 0; u.path = null; }
    else setIdle(u);
  }

  function startWork(u, o) {
    o.state = 'work';
    o.t = 0;
    if (u.carryType !== o.res) { u.carry = 0; u.carryType = o.res; }
  }

  function updateGather(s, u, d, o) {
    const map = s.map, p = s.players[u.owner], cap = p.mod.carry;
    if (o.state === 'go') {
      if (o.farm) {
        let f = s.byId.get(o.farm);
        if (!f || f.dead || !f.built || !BF.farmFree(s, f, u)) {
          f = findFreeFarm(s, u);
          if (!f) { finishGather(u, o); return; }
          o.farm = f.id; o.planned = false; u.path = null;
        }
        f.worker = u.id;
        const r = travel(s, u, o, BF.bRect(f, 0), d.speed);
        if (r === 2) { if (BF.distToBuilding(f, u.x, u.y) < 0.9) startWork(u, o); else setIdle(u); }
      } else if (o.animal) {
        huntGo(s, u, d, o);
      } else {
        if (map.node[idx(o.nx, o.ny)] !== o.node) { if (!retarget(s, u, o)) finishGather(u, o); return; }
        const r = travel(s, u, o, { x0: o.nx, y0: o.ny, x1: o.nx, y1: o.ny, range: 1 }, d.speed);
        if (r === 2) {
          if (Math.abs(u.x - o.nx - 0.5) < 1.6 && Math.abs(u.y - o.ny - 0.5) < 1.6) startWork(u, o);
          else setIdle(u);
        }
      }
    } else if (o.state === 'work') {
      if (o.farm) {
        const f = s.byId.get(o.farm);
        if (!f || f.dead) { finishGather(u, o); return; }
        u.working = true;
        o.t += DT * p.mod.gather.farm;
        while (o.t >= 1 && u.carry < cap) { o.t -= 1; u.carry++; }
      } else if (o.animal) {
        const a = s.byId.get(o.animal);
        if (!a || a.dead || a.state !== 'carcass') { if (!retargetAnimal(s, u, o)) finishGather(u, o); return; }
        if (dist(a.x - u.x, a.y - u.y) > 1.5) { o.state = 'go'; o.planned = false; return; }
        u.working = true;
        u.dir = Math.atan2(a.y - u.y, a.x - u.x);
        o.t += DT * p.mod.gather.hunt;
        while (o.t >= 1 && u.carry < cap && !a.dead) {
          o.t -= 1;
          u.carry++;
          if (--a.food <= 0) { a.dead = true; s.byId.delete(a.id); s.hasDead = true; }
        }
      } else {
        const i = idx(o.nx, o.ny);
        if (map.node[i] !== o.node) { if (!retarget(s, u, o)) finishGather(u, o); return; }
        u.working = true;
        u.dir = Math.atan2(o.ny + 0.5 - u.y, o.nx + 0.5 - u.x);
        o.t += DT * p.mod.gather[o.res];
        while (o.t >= 1 && u.carry < cap && map.node[i] === o.node) {
          o.t -= 1;
          u.carry++;
          if (--map.nodeAmt[i] === 0) { map.node[i] = 0; map.version++; }
        }
      }
      if (u.carry >= cap) { o.state = 'return'; o.planned = false; o.drop = 0; }
    } else {
      let b = o.drop ? s.byId.get(o.drop) : null;
      if (!b || b.dead) {
        b = nearestDropoff(s, u);
        if (!b) { setIdle(u); return; }
        o.drop = b.id; o.planned = false; u.path = null;
      }
      if (travel(s, u, o, BF.bRect(b, 1), d.speed) === 2) {
        if (BF.distToBuilding(b, u.x, u.y) < 1.6) {
          p.res[u.carryType] += u.carry;
          p.gathered += u.carry;
          u.carry = 0;
          if (o.last) setIdle(u);
          else { o.state = 'go'; o.planned = false; o.drop = 0; }
        } else setIdle(u);
      }
    }
  }

  // ---------------------------------------------------------------- hewan liar & berburu

  // Hewan tidak dimiliki siapa pun; owner −9 membuat tembok maupun gerbang siapa pun menghalanginya.
  const walkable = (s, x, y) => BF.passable(s.map, Math.floor(x), Math.floor(y), -9);

  function addAnimal(s, type, x, y) {
    const d = BF.ANIMALS[type];
    const a = { id: s.nextId++, kind: 'animal', type, x, y, hx: x, hy: y, hp: d.hp, food: d.food, dir: BF.rnd(s) * 6.283,
      state: 'graze', t: 1 + BF.rnd(s) * 4, wx: x, wy: y, tid: 0, cd: 0, atkAnim: 0, moving: false, dead: false };
    s.animals.push(a);
    s.byId.set(a.id, a);
  }

  // Kawanan rusa dan babi hutan: masing-masing markas mendapat jumlah dan jarak yang sama (adil), sisanya tersebar di
  // tengah peta jauh dari kedua markas. Hanya di daratan yang terhubung dengan markas.
  function spawnAnimals(s) {
    const map = s.map, st = map.starts, reg = map.region[idx(st[0].x, st[0].y)];
    const ok = (x, y) => BF.inBounds(x, y) && walkable(s, x, y) && map.region[idx(x, y)] === reg;
    const place = (type, cx, cy, r0, r1, far) => {
      for (let k = 0; k < 80; k++) {
        const a = BF.rnd(s) * 6.283, r = r0 + BF.rnd(s) * (r1 - r0), x = Math.floor(cx + BF.qcos(a) * r), y = Math.floor(cy + BF.qsin(a) * r);
        if (!ok(x, y) || (far && st.some(p => dist(x - p.x, y - p.y) < far))) continue;
        for (let n = 0; n < BF.ANIMALS[type].herd; n++) {
          const hx = x + 0.5 + (n ? (BF.rnd(s) - 0.5) * 2.4 : 0), hy = y + 0.5 + (n ? (BF.rnd(s) - 0.5) * 2.4 : 0);
          if (ok(hx | 0, hy | 0)) addAnimal(s, type, hx, hy);
        }
        return;
      }
    };
    for (const p of st) { place('deer', p.x, p.y, 9, 13); place('deer', p.x, p.y, 11, 16); place('boar', p.x, p.y, 12, 17); }
    for (let i = 0; i < 4; i++) place('deer', N / 2, N / 2, 0, N / 2 - 4, 20);
    for (let i = 0; i < 3; i++) place('boar', N / 2, N / 2, 0, N / 2 - 4, 20);
  }

  // Melangkah lurus ke (tx, ty). false bila sudah tiba atau langkah berikutnya terhalang.
  function stepToward(s, a, tx, ty, speed) {
    const dx = tx - a.x, dy = ty - a.y, l = dist(dx, dy);
    if (l < 0.05) return false;
    const k = Math.min(l, speed * DT) / l, nx = a.x + dx * k, ny = a.y + dy * k;
    if (!walkable(s, nx, ny)) return false;
    a.x = nx; a.y = ny; a.dir = Math.atan2(dy, dx); a.moving = true;
    return true;
  }

  // Lari ±5 tile menjauhi titik (sx, sy); sarangnya pindah ke tempat itu supaya tidak kembali ke arah pemburu.
  function fleeFrom(s, a, sx, sy) {
    let ax = a.x - sx, ay = a.y - sy;
    const l = dist(ax, ay) || 1;
    ax /= l; ay /= l;
    for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 2]) {
      const c = BF.qcos(turn), sn = BF.qsin(turn), wx = a.x + (ax * c - ay * sn) * 5, wy = a.y + (ax * sn + ay * c) * 5;
      if (walkable(s, wx, wy)) { a.state = 'flee'; a.wx = a.hx = wx; a.wy = a.hy = wy; return; }
    }
  }

  // Hewan terkena serangan: mati → bangkai; babi menyeruduk penyerangnya; rusa lari bersama kawanannya.
  function hurtAnimal(s, a, dmg, src) {
    if (a.dead || a.state === 'carcass') return;
    a.hp -= dmg;
    if (a.hp <= 0) {
      a.hp = 0; a.state = 'carcass'; a.moving = false;
      emit(s, { type: 'death', x: a.x, y: a.y });
      return;
    }
    const d = BF.ANIMALS[a.type];
    if (d.atk && src && src.kind === 'unit' && !src.dead) { a.state = 'charge'; a.tid = src.id; return; }
    const sx = src ? src.x : a.x - 1, sy = src ? src.y : a.y;
    for (const q of s.animals)
      if (q === a || (!q.dead && q.type === a.type && q.state !== 'carcass' && dist(q.x - a.x, q.y - a.y) < 4)) fleeFrom(s, q, sx, sy);
  }

  function updateAnimal(s, a) {
    const d = BF.ANIMALS[a.type];
    a.moving = false;
    if (a.cd > 0) a.cd -= DT;
    if (a.atkAnim > 0) a.atkAnim -= DT;
    if (a.state === 'carcass') return;
    if (a.state === 'charge') {
      const t = s.byId.get(a.tid);
      if (!t || t.dead || dist(a.hx - a.x, a.hy - a.y) > 9) { a.state = 'walk'; a.wx = a.hx; a.wy = a.hy; return; }   // kembali ke sarang
      const dd = dist(t.x - a.x, t.y - a.y);
      if (dd <= d.radius + UD(s, t).radius + 0.25) {
        a.dir = Math.atan2(t.y - a.y, t.x - a.x);
        if (a.cd <= 0) {
          a.cd = d.cooldown; a.atkAnim = 0.3;
          emit(s, { type: 'melee', x: a.x, y: a.y });
          hitSpark(s, t, a.x, a.y);
          BF.applyDamage(s, t, Math.max(1, d.atk - UD(s, t).armor), a);
        }
      } else stepToward(s, a, t.x, t.y, d.run);
      return;
    }
    if (a.state === 'flee' || a.state === 'walk') {
      if (!stepToward(s, a, a.wx, a.wy, a.state === 'flee' ? d.run : d.speed)) { a.state = 'graze'; a.t = 2 + BF.rnd(s) * 5; }
      return;
    }
    if ((a.t -= DT) <= 0) {                             // merumput, sesekali pindah beberapa langkah di sekitar sarang
      const ang = BF.rnd(s) * 6.283, r = BF.rnd(s) * 3.5, wx = a.hx + BF.qcos(ang) * r, wy = a.hy + BF.qsin(ang) * r;
      if (walkable(s, wx, wy)) { a.state = 'walk'; a.wx = wx; a.wy = wy; } else a.t = 1;
    }
  }

  // Sasaran buruan berikutnya di sekitar buruan terakhir: bangkai lebih dulu, lalu rusa (babi hanya bila diperintah langsung).
  function retargetAnimal(s, u, o) {
    let best = null, bd = 8;
    for (const a of s.animals) {
      if (a.dead || (a.state !== 'carcass' && a.type !== 'deer')) continue;
      const dd = dist(a.x - o.ax, a.y - o.ay) - (a.state === 'carcass' ? 3 : 0);
      if (dd < bd) { bd = dd; best = a; }
    }
    if (!best) return false;
    o.animal = best.id; o.state = 'go'; o.planned = false;
    u.path = null;
    return true;
  }

  // Pekerja mendekati buruan; hewan hidup dilempari tombak dari jarak BF.HUNT.range, bangkai didatangi lalu dikuliti.
  function huntGo(s, u, d, o) {
    const a = s.byId.get(o.animal);
    if (!a || a.dead) { if (!retargetAnimal(s, u, o)) finishGather(u, o); return; }
    o.ax = a.x; o.ay = a.y;
    const dd = dist(a.x - u.x, a.y - u.y);
    if (a.state === 'carcass') {
      if (dd <= 1) { u.path = null; startWork(u, o); return; }
    } else if (dd <= BF.HUNT.range) {
      u.path = null; o.planned = false;
      u.dir = Math.atan2(a.y - u.y, a.x - u.x);
      if (u.cd <= 0) { u.cd = BF.HUNT.cooldown; u.atkAnim = 0.3; spawnProjectile(s, u.x, u.y, a, BF.HUNT, { k: 'h', o: u.owner }, u.id); }
      return;
    }
    if (dd < 3 && !o.planned) {                         // dekat & tanpa jalur aktif: langkah lurus bila terbuka; terhalang → cari jalur
      const nx = u.x + (a.x - u.x) / dd * d.speed * DT, ny = u.y + (a.y - u.y) / dd * d.speed * DT;
      if (BF.passable(s.map, Math.floor(nx), Math.floor(ny), u.owner)) {
        u.x = nx; u.y = ny; u.dir = Math.atan2(a.y - u.y, a.x - u.x);
        u.moving = true; u.path = null;
        return;
      }
    }
    // jalur: ke tile bangkai itu sendiri (hewan hanya berdiri di tile yang bisa dipijak), atau ke sekitar hewan hidup
    const gx = a.x | 0, gy = a.y | 0, range = a.state === 'carcass' ? 0 : 1;
    if (o.planned && (o.gx !== gx || o.gy !== gy) && u.repathT <= 0) o.planned = false;
    if (!o.planned) { o.gx = gx; o.gy = gy; }
    if (travel(s, u, o, { x0: o.gx, y0: o.gy, x1: o.gx, y1: o.gy, range }, d.speed) === 2) o.planned = false;
  }

  // ---------------------------------------------------------------- build

  function completeBuilding(s, b) {
    const d = BD(s, b);
    b.built = true;
    b.progress = 1;
    b.hp = Math.min(d.hp, Math.ceil(b.hp));
    s.players[b.owner].popCap += d.pop || 0;
    s.events.push({ type: 'built', owner: b.owner, building: b.type, x: b.tx + b.size / 2, y: b.ty + b.size / 2 });
  }

  function afterBuild(s, u, b) {
    // Klaim ladang dicatat saat itu juga supaya pembangun lain di tick yang sama tidak ikut mengklaim.
    if (b.type === 'farm' && BF.farmFree(s, b, u)) { b.worker = u.id; BF.setOrder(u, BF.farmOrder(b)); return; }
    let best = null, bd = 14;
    for (const o of s.buildings) {
      if (o.owner !== u.owner || o.built || o.dead) continue;
      const dd = BF.distToBuilding(o, u.x, u.y);
      if (dd < bd) { bd = dd; best = o; }
    }
    if (best) { BF.setOrder(u, { type: 'build', bid: best.id }); return; }
    if (b.type === 'storage') {
      const map = s.map, cx = b.tx + 1, cy = b.ty + 1, reg = map.region[idx(b.tx, b.ty)];
      let node = null, nd = 1e9;
      for (const t of [BF.N_TREE, BF.N_GOLD, BF.N_STONE, BF.N_BERRY]) {
        const n = BF.findNode(map, cx, cy, t, 5, reg);
        if (n) { const dd = dist(n.x - cx, n.y - cy); if (dd < nd) { nd = dd; node = n; } }
      }
      if (node) { BF.setOrder(u, BF.gatherOrder(map, node.x, node.y)); return; }
    }
    setIdle(u);
  }

  function updateBuild(s, u, d, o) {
    const b = s.byId.get(o.bid);
    if (!b || b.dead) { setIdle(u); return; }
    if (b.built) { afterBuild(s, u, b); return; }
    if (o.state !== 'work') {
      if (travel(s, u, o, BF.bRect(b, 1), d.speed) === 2) {
        if (BF.distToBuilding(b, u.x, u.y) < 1.7) o.state = 'work'; else setIdle(u);
      }
      return;
    }
    const bd = BD(s, b);
    u.working = true;
    u.dir = Math.atan2(b.ty + b.size / 2 - u.y, b.tx + b.size / 2 - u.x);
    b.progress += DT / bd.time;
    b.hp = Math.min(bd.hp, b.hp + bd.hp * DT / bd.time);
    if (b.progress >= 1) { completeBuilding(s, b); afterBuild(s, u, b); }
  }

  // Perbaikan: pekerja mendatangi bangunan sendiri yang rusak lalu memulihkan nyawanya. Biayanya dicatat sebagai utang
  // pecahan di bangunan (b.owe, dipakai bersama semua tukangnya) dan ditagih per satuan bulat; bila stok tidak cukup,
  // perbaikan berhenti dan pemilik diberi tahu (event repairStop, paling sering sekali per 5 detik).
  function updateRepair(s, u, d, o) {
    const b = s.byId.get(o.bid), p = s.players[u.owner];
    if (!b || b.dead || !b.built || b.owner !== u.owner) { setIdle(u); return; }
    const bd = BD(s, b);
    if (b.hp >= bd.hp) { b.hp = bd.hp; setIdle(u); return; }
    if (o.state !== 'work') {
      if (travel(s, u, o, BF.bRect(b, 1), d.speed) === 2) {
        if (BF.distToBuilding(b, u.x, u.y) < 1.7) o.state = 'work'; else setIdle(u);
      }
      return;
    }
    if (BF.distToBuilding(b, u.x, u.y) > 1.9) { o.state = 'go'; o.planned = false; return; }   // terdorong menjauh
    const hp = Math.min(bd.hp - b.hp, bd.hp * DT / bd.time * BF.REPAIR.rate), owe = Object.assign({}, b.owe), bill = {};
    for (const r in bd.cost) {
      owe[r] = (owe[r] || 0) + bd.cost[r] * BF.REPAIR.cost * hp / bd.hp;
      if (owe[r] >= 1) bill[r] = Math.floor(owe[r]);
    }
    if (!BF.canAfford(p, bill)) {
      if (s.tick - (p.repairWarn || -1e9) > 100) { p.repairWarn = s.tick; s.events.push({ type: 'repairStop', owner: u.owner, x: b.tx + b.size / 2, y: b.ty + b.size / 2 }); }
      setIdle(u);
      return;
    }
    for (const r in bill) { p.res[r] -= bill[r]; owe[r] -= bill[r]; }
    b.owe = owe;
    b.hp += hp;
    u.working = true;
    u.dir = Math.atan2(b.ty + b.size / 2 - u.y, b.tx + b.size / 2 - u.x);
  }

  // ---------------------------------------------------------------- berlindung
  //
  // Unit yang berlindung dikeluarkan dari s.units dan s.byId lalu disimpan di b.inside (ikut tersimpan bersama bangunan).
  // Selama di dalam, u.dead = true supaya semua loop unit (pencarian sasaran, pemisahan, AI, render) melewatinya tanpa
  // perlu tahu soal berlindung. Ini bukan kematian: populasi tetap dan unit dikembalikan apa adanya saat keluar.

  BF.canGarrison = function (s, u, b) {
    return !!BD(s, b).garrison && b.built && !b.dead && b.owner === u.owner && BF.GARRISON.cls.indexOf(UD(s, u).cls) >= 0;
  };

  function enter(s, u, b) {
    const p = s.players[u.owner];
    if (u.carry > 0 && BF.BUILDINGS[b.type].dropoff) { p.res[u.carryType] += u.carry; p.gathered += u.carry; u.carry = 0; }
    u.order = { type: 'idle' };
    u.path = null;
    u.moving = u.working = false;
    u.dead = true;
    s.hasDead = true;
    s.byId.delete(u.id);
    b.inside.push(u);
  }

  // Keluarkan semua unit yang berlindung di b; mengembalikan jumlah yang keluar. Bila tak ada tile bebas di sekeliling
  // bangunan, unit tetap di dalam. scatter: bangunannya roboh → unit muncul di bekas tapaknya.
  BF.ungarrison = function (s, b, scatter) {
    const stay = [];
    let n = 0;
    b.inside.forEach((u, i) => {
      let x, y;
      if (scatter) { x = b.tx + 0.5 + i % b.size; y = b.ty + 0.5 + ((i / b.size) | 0) % b.size; }
      else {
        const t = exitTile(s, b);
        if (!t) { stay.push(u); return; }
        x = t.x + 0.5; y = t.y + 0.5;
      }
      u.dead = false;
      u.x = x; u.y = y;
      if (s.units.indexOf(u) < 0) s.units.push(u);         // baru masuk di tick yang sama: masih ada di daftar
      s.byId.set(u.id, u);
      n++;
    });
    b.inside = stay;
    return n;
  };

  function updateGarrison(s, u, d, o) {
    const b = s.byId.get(o.bid);
    if (!b || !BF.canGarrison(s, u, b)) { setIdle(u); return; }
    if (travel(s, u, o, BF.bRect(b, 1), d.speed) !== 2) return;
    if (BF.distToBuilding(b, u.x, u.y) < 1.7) {
      if (b.inside.length < BD(s, b).garrison) { enter(s, u, b); return; }
      const p = s.players[u.owner];
      if (s.tick - (p.fullWarn || -1e9) > 100) { p.fullWarn = s.tick; s.events.push({ type: 'garrisonFull', owner: u.owner, x: u.x, y: u.y }); }
    }
    setIdle(u);
  }

  // ---------------------------------------------------------------- update

  function updateUnit(s, u) {
    const d = UD(s, u);
    u.moving = false;
    u.working = false;
    if (u.cd > 0) u.cd -= DT;
    if (u.repathT > 0) u.repathT--;
    if (u.atkAnim > 0) u.atkAnim -= DT;
    const o = u.order;
    switch (o.type) {
      case 'idle':
        if (d.atk && u.stance !== 2 && (s.tick + u.id) % 8 === 0) {
          const t = acquire(s, u, d, u.stance === 1);
          if (t) u.order = { type: 'attack', tid: t.id, auto: true, hold: u.stance === 1, hx: u.x, hy: u.y };
        }
        break;
      case 'patrol':                                      // bolak-balik antara dua titik sambil menyerang musuh yang ditemui
        if (d.atk && (s.tick + u.id) % 8 === 0) {
          const t = acquire(s, u, d);
          if (t) { u.path = null; o.planned = false; u.order = { type: 'attack', tid: t.id, resume: o }; break; }
        }
        if (travel(s, u, o, o.goal, d.speed) === 2) {
          const leg = o.pts[o.i = 1 - o.i];
          o.x = leg.x; o.y = leg.y; o.goal = leg.goal; o.planned = false;
        }
        break;
      case 'move':
        if (travel(s, u, o, o.goal, d.speed) === 2) setIdle(u);
        break;
      case 'amove':
        if (d.atk && (s.tick + u.id) % 8 === 0) {
          const t = acquire(s, u, d);
          if (t) { u.path = null; o.planned = false; u.order = { type: 'attack', tid: t.id, resume: o }; break; }
        }
        if (travel(s, u, o, o.goal, d.speed) === 2) {
          if (o.partial) u.breach = s.tick + 120;
          setIdle(u);
        }
        break;
      case 'attack': updateAttack(s, u, d, o); break;
      case 'gather': updateGather(s, u, d, o); break;
      case 'build': updateBuild(s, u, d, o); break;
      case 'repair': updateRepair(s, u, d, o); break;
      case 'garrison': updateGarrison(s, u, d, o); break;
    }
  }

  // Dorong unit diam yang saling bertumpuk agar menyebar. Unit yang sedang jalan/bekerja tidak didorong.
  function separate(s) {
    const us = s.units, n = us.length, map = s.map;
    for (let i = 0; i < n; i++) {
      const a = us[i];
      if (a.dead) continue;
      const ra = UD(s, a).radius, pa = !a.moving && !a.working;
      for (let j = i + 1; j < n; j++) {
        const b = us[j];
        if (b.dead) continue;
        const dx = b.x - a.x;
        if (dx > 1 || dx < -1) continue;
        const dy = b.y - a.y;
        if (dy > 1 || dy < -1) continue;
        const pb = !b.moving && !b.working;
        if (!pa && !pb) continue;
        const rr = ra + UD(s, b).radius, d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        let nx, ny, dd = Math.sqrt(d2);
        if (dd < 1e-3) { const ang = (a.id * 2.399 + b.id) % 6.283; nx = BF.qcos(ang); ny = BF.qsin(ang); dd = 0; }
        else { nx = dx / dd; ny = dy / dd; }
        const push = (rr - dd) * 0.35, wa = pa ? (pb ? 0.5 : 1) : 0, wb = pb ? (pa ? 0.5 : 1) : 0;
        if (wa) {
          const x = a.x - nx * push * wa, y = a.y - ny * push * wa;
          if (BF.passable(map, Math.floor(x), Math.floor(y), a.owner)) { a.x = x; a.y = y; }
        }
        if (wb) {
          const x = b.x + nx * push * wb, y = b.y + ny * push * wb;
          if (BF.passable(map, Math.floor(x), Math.floor(y), b.owner)) { b.x = x; b.y = y; }
        }
      }
    }
  }

  // Tile bebas di sekeliling bangunan (cincin 1–3 tile) yang paling dekat ke titik kumpul, atau ke depan bangunan.
  function exitTile(s, b) {
    const rx = b.rally ? b.rally.x : b.tx + b.size / 2, ry = b.rally ? b.rally.y : b.ty + b.size + 1;
    let best = null, bd = 1e9;
    for (let r = 1; r <= 3 && !best; r++) {
      const x0 = b.tx - r, y0 = b.ty - r, x1 = b.tx + b.size + r - 1, y1 = b.ty + b.size + r - 1;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          if (x > x0 && x < x1 && y > y0 && y < y1) continue;
          if (!BF.passable(s.map, x, y)) continue;
          const dd = (x + 0.5 - rx) * (x + 0.5 - rx) + (y + 0.5 - ry) * (y + 0.5 - ry);
          if (dd < bd) { bd = dd; best = { x, y }; }
        }
    }
    return best;
  }

  function spawnFromBuilding(s, b, type) {
    const best = exitTile(s, b);
    if (!best) return null;
    const u = BF.spawnUnit(s, type, b.owner, best.x + 0.5, best.y + 0.5);
    const r = b.rally;
    if (r) {
      if (type === 'worker' && r.node && s.map.node[idx(r.nx, r.ny)] === r.node) u.order = BF.gatherOrder(s.map, r.nx, r.ny);
      else u.order = BF.moveOrder(s, r.x, r.y, false, b.owner);
    }
    s.events.push({ type: 'trained', owner: b.owner, unit: type, x: u.x, y: u.y });
    return u;
  }

  function updateBuilding(s, b) {
    if (!b.built) return;
    const d = BD(s, b), p = s.players[b.owner];
    if (b.queue.length) {
      const q = b.queue[0];
      if (q.era) {
        q.t += DT;
        if (q.t >= q.time) {
          p.era++;
          p.eraQueued = false;
          b.queue.shift();
          s.events.push({ type: 'era', owner: b.owner, era: p.era });
        }
      } else if (q.tech) {
        q.t += DT;
        if (q.t >= q.time) { b.queue.shift(); completeTech(s, p, q.tech); }
      } else {
        const ud = p.U[q.unit];
        if (q.t < ud.time) q.t += DT;
        q.stalled = false;
        if (q.t >= ud.time) {
          if (p.pop + ud.pop > Math.min(p.popCap, BF.MAX_POP)) q.stalled = true;
          else if (spawnFromBuilding(s, b, q.unit)) b.queue.shift();
        }
      }
    }
    for (const u of b.inside) { const max = p.U[u.type].hp; if (u.hp < max) u.hp = Math.min(max, u.hp + BF.GARRISON.heal * DT); }
    if (d.atk) {
      b.cd -= DT;
      if (b.cd <= 0) {
        // satu panah ke musuh terdekat, + satu panah per GARRISON.perArrow unit yang berlindung, dibagi ke musuh-musuh
        // terdekat berikutnya (berputar bila panahnya lebih banyak daripada musuhnya)
        const cx = b.tx + b.size / 2, cy = b.ty + b.size / 2, foes = [];
        for (const t of s.units) {
          if (t.owner === b.owner || t.dead) continue;
          const dd = dist(t.x - cx, t.y - cy);
          if (dd < d.range) foes.push({ t, dd });
        }
        if (foes.length) {
          foes.sort((a, c) => a.dd - c.dd || a.t.id - c.t.id);
          const n = 1 + Math.floor(b.inside.length / BF.GARRISON.perArrow);
          for (let i = 0; i < n; i++) spawnProjectile(s, cx + (i - (n - 1) / 2) * 0.12, cy, foes[i % foes.length].t, d, { k: 'b', t: b.type, o: b.owner }, b.id);
          b.cd = d.cooldown;
        } else b.cd = 0.4;
      }
    }
  }

  function updateProjectiles(s) {
    let done = false;
    for (const p of s.projectiles) {
      const t = s.byId.get(p.tid);
      if (!p.splash && t && !t.dead && t.kind !== 'building') { p.tx = t.x; p.ty = t.y; }
      const dx = p.tx - p.x, dy = p.ty - p.y, dd = dist(dx, dy), step = p.speed * DT;
      if (dd > step) { p.x += dx / dd * step; p.y += dy / dd * step; continue; }
      p.done = done = true;
      const src = s.byId.get(p.src) || null;
      const ad = p.dk.k === 'u' ? s.players[p.dk.o].U[p.dk.t] : p.dk.k === 'h' ? BF.HUNT : s.players[p.dk.o].B[p.dk.t];
      if (p.splash) {
        for (const u of s.units)
          if (u.owner !== p.owner && !u.dead && dist(u.x - p.tx, u.y - p.ty) <= p.splash) BF.applyDamage(s, u, BF.damage(s, ad, u), src);
        for (const b of s.buildings)
          if (b.owner !== p.owner && !b.dead && BF.distToBuilding(b, p.tx, p.ty) <= 0.5) BF.applyDamage(s, b, BF.damage(s, ad, b), src);
        s.effects.push({ type: 'boom', x: p.tx, y: p.ty, t: 0, life: 0.4, r: p.splash });
        emit(s, { type: 'impact', x: p.tx, y: p.ty });
      } else if (t && !t.dead) { hitSpark(s, t, p.tx, p.ty); BF.applyDamage(s, t, BF.damage(s, ad, t), src); }
    }
    if (done) s.projectiles = s.projectiles.filter(p => !p.done);
  }

  BF.updateFog = function (s) {
    const f = s.fog, vis = f.visible, exp = f.explored, me = s.human, p = s.players[me];
    vis.fill(0);
    const reveal = (cx, cy, r) => {
      const r2 = r * r + r;
      for (let y = Math.max(0, cy - r); y <= Math.min(N - 1, cy + r); y++)
        for (let x = Math.max(0, cx - r); x <= Math.min(N - 1, cx + r); x++)
          if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2) { const i = y * N + x; vis[i] = 1; exp[i] = 1; }
    };
    for (const u of s.units) if (u.owner === me && !u.dead) reveal(u.x | 0, u.y | 0, p.U[u.type].sight);
    for (const b of s.buildings)
      if (b.owner === me && !b.dead) reveal((b.tx + b.size / 2) | 0, (b.ty + b.size / 2) | 0, b.built ? p.B[b.type].sight : 2);
    f.version++;
  };

  // Kalah bila tidak punya bangunan lagi (ladang, tembok, dan gerbang tidak dihitung).
  function checkVictory(s) {
    const alive = [0, 0];
    for (const b of s.buildings) if (!b.dead && b.type !== 'farm' && !BF.BUILDINGS[b.type].barrier) alive[b.owner]++;
    if (alive[0] && alive[1]) return;
    s.over = true;
    s.winner = alive[0] ? 0 : alive[1] ? 1 : -1;
    s.events.push({ type: 'over', winner: s.winner });
  }

  BF.step = function (s) {
    if (s.over) return;
    s.tick++;
    const think = BF.DIFF[s.difficulty].think;
    for (const p of s.players) if (p.isAI && (s.tick + p.id * 7) % think === 0) BF.aiThink(s, p);
    for (const u of s.units) if (!u.dead) updateUnit(s, u);
    for (const a of s.animals) if (!a.dead) updateAnimal(s, a);
    separate(s);
    for (const b of s.buildings) if (!b.dead) updateBuilding(s, b);
    updateProjectiles(s);
    if (s.effects.length) {
      for (const e of s.effects) e.t += DT;
      s.effects = s.effects.filter(e => e.t <= e.life);
    }
    if (s.hasDead) {
      s.units = s.units.filter(u => !u.dead);
      s.buildings = s.buildings.filter(b => !b.dead);
      s.animals = s.animals.filter(a => !a.dead);
      s.hasDead = false;
    }
    if (s.events.length > 400) s.events.splice(0, s.events.length - 400);
    if (s.tick % 5 === 0) BF.updateFog(s);
    if (s.tick % 20 === 0) checkVictory(s);
  };
})();
