// Tes headless inti simulasi (tanpa browser): AI, determinisme, simpan/muat, wangsa & teknologi,
// validasi perintah, tembok & gerbang.
// Jalankan: node tests/sim.test.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..');
for (const f of ['config', 'util', 'map', 'pathfinding', 'sim', 'commands', 'ai', 'save'])
  vm.runInThisContext(fs.readFileSync(path.join(dir, 'js', f + '.js'), 'utf8'), { filename: f + '.js' });
const BF = globalThis.BF;
let pass = 0, fail = 0;
const check = (name, ok, detail) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  → ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); };
const run = (s, ticks) => { for (let i = 0; i < ticks && !s.over; i++) { BF.step(s); s.events.length = 0; } };
// Menyingkirkan unit awal selain pekerja (Penunggang Kuda), untuk tes yang menyusun pasukannya sendiri secara persis.
const tanpaUnitAwal = s => { for (const u of s.units.slice()) if (u.type !== 'worker') BF.kill(s, u, true); s.units = s.units.filter(u => !u.dead); s.effects.length = 0; s.hasDead = false; return s; };
const sane = s => s.units.every(u => u.x >= 0 && u.y >= 0 && u.x < 96 && u.y < 96 && isFinite(u.hp));

// 1. AI lawan AI: selesai tanpa error di berbagai seed, wangsa, dan kesulitan
{
  const fk = Object.keys(BF.FACTIONS), res = [];
  let ok = true, maxMs = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const s = BF.newGame({ seed, ai: [true, true], difficulty: ['easy', 'normal', 'hard'][seed % 3], factions: [fk[seed % 4], fk[(seed + 1 + (seed >> 2)) % 4]] });
    const t0 = Date.now();
    run(s, 20 * 60 * 70);
    maxMs = Math.max(maxMs, (Date.now() - t0) / s.tick);
    ok = ok && s.over && sane(s);
    const w = s.players[s.winner] || {};
    res.push(`${seed}:${s.players[0].faction}-v-${s.players[1].faction}→${w.faction || '?'}@${(s.tick / 1200).toFixed(0)}m(tech ${s.players.map(p => p.techs.length).join('/')})`);
  }
  check('AI vs AI 8 seed selesai', ok, res.join('  '));
  check('biaya tick rata-rata < 0.5 ms', maxMs < 0.5, maxMs.toFixed(3) + ' ms');
}

// 2. Determinisme: dua simulasi dengan seed sama harus identik (syarat lockstep)
{
  const mk = () => BF.newGame({ seed: 77, ai: [true, true], difficulty: 'hard', factions: ['bara', 'rimba'] });
  const a = mk(), b = mk();
  let same = true;
  for (let i = 0; i < 20 * 60 * 12 && same; i++) { BF.step(a); BF.step(b); a.events.length = b.events.length = 0; if (i % 200 === 0) same = BF.hash(a) === BF.hash(b); }
  check('determinisme 12 menit (hash identik tiap 10 dtk)', same && BF.hash(a) === BF.hash(b), { tick: a.tick, units: a.units.length });
}

// 3. Simpan → muat → lanjut harus identik dengan permainan yang tidak pernah disimpan
{
  const a = BF.newGame({ seed: 91, ai: [true, true], difficulty: 'normal', factions: ['padang', 'samudra'] });
  run(a, 20 * 60 * 9);
  const json = JSON.stringify(BF.serialize(a));
  const b = BF.deserialize(JSON.parse(json));
  check('snapshot dimuat: hash sama', BF.hash(a) === BF.hash(b), { kb: (json.length / 1024) | 0, units: b.units.length, bld: b.buildings.length, proj: b.projectiles.length });
  let same = true;
  for (let i = 0; i < 20 * 60 * 8 && same && !a.over; i++) { BF.step(a); BF.step(b); a.events.length = b.events.length = 0; if (i % 200 === 0) same = BF.hash(a) === BF.hash(b); }
  check('lanjut 8 menit setelah muat tetap identik', same && BF.hash(a) === BF.hash(b), { tick: a.tick, over: a.over });
  let threw = false;
  try { BF.deserialize({ v: 999 }); } catch (e) { threw = true; }
  check('simpanan versi asing ditolak', threw);
}

// 4. Wangsa & teknologi mengubah stat
{
  const s = BF.newGame({ seed: 5, ai: [false, false], factions: ['bara', 'samudra'] });
  const p = s.players[0], q = s.players[1], th = s.buildings[0];
  check('bonus wangsa diterapkan', p.U.spear.atk === 6 && Math.abs(p.U.sword.time - 14.4) < 1e-9 && q.mod.carry === 13 && q.U.spear.atk === 5 && p.U.worker.atk === 0, { spear: p.U.spear.atk, carry: q.mod.carry });
  check('unit unik hanya untuk wangsanya', BF.trainable(p, 'barracks').join() === 'spear,sword,berserk' && BF.trainable(q, 'barracks').join() === 'spear,sword,guard');
  p.res = { food: 5000, wood: 5000, gold: 5000, stone: 5000 };
  check('riset ditolak sebelum eranya', BF.cmd.research(s, th, 'gerobak') === 'era');
  p.era = 1;
  const w = s.units.find(u => u.owner === 0), hp0 = th.hp;
  check('riset diterima & tidak bisa dobel', BF.cmd.research(s, th, 'gerobak') === true && BF.cmd.research(s, th, 'gerobak') === 'busy' && BF.cmd.research(s, th, 'tukang') === true);
  check('teknologi di bangunan yang salah ditolak', BF.cmd.research(s, th, 'tempa2') === 'invalid');
  run(s, 20 * 80);
  check('teknologi selesai: efek aktif', p.techs.join() === 'gerobak,tukang' && p.mod.carry === 15 && Math.abs(p.U.worker.speed - 2.64) < 1e-9 && p.B.townhall.hp === 2880 && th.hp === hp0 + 480, { techs: p.techs, thHp: th.hp, speed: p.U.worker.speed });
  check('lawan tidak terpengaruh', q.B.townhall.hp === 2400 && q.techs.length === 0);
  const spot = BF.findFreeNear(s.map, th.tx + 6, th.ty + 6, 6);
  const sm = BF.spawnBuilding(s, 'smithy', 0, spot.x, spot.y, true);
  check('prasyarat teknologi (Baja Lipat butuh Tempa Besi)', (p.era = 2, BF.cmd.research(s, sm, 'tempa2')) === 'req');
  const gold0 = p.res.gold;
  check('riset masuk antrean & biaya terpotong', BF.cmd.research(s, sm, 'tempa') === true && p.techQ.tempa === 1 && p.res.gold === gold0 - 100);
  BF.cmd.cancel(s, sm, 0);
  check('batal riset: biaya kembali & bisa diriset lagi', p.res.gold === gold0 && !p.techQ.tempa && BF.cmd.research(s, sm, 'tempa') === true);
  const atk0 = p.U.sword.atk;
  run(s, 20 * 40);
  check('Tempa Besi: +2 serangan infanteri, pekerja tetap 0', p.U.sword.atk === atk0 + 2 && p.U.worker.atk === 0 && p.U.archer.atk === 6, { sword: p.U.sword.atk });
  BF.cmd.research(s, sm, 'tempa2');
  BF.kill(s, sm);
  check('bangunan hancur saat meriset: teknologi bisa diriset ulang', !p.techQ.tempa2);
}

// 5. BF.exec: validasi kepemilikan & perintah rusak
{
  const s = BF.newGame({ seed: 6, ai: [false, false], factions: ['rimba', 'padang'] });
  const mine = s.units.filter(u => u.owner === 0), foe = s.units.filter(u => u.owner === 1), th1 = s.buildings[1];
  BF.exec(s, 0, { c: 'move', ids: foe.map(u => u.id), x: 40, y: 40 });
  check('tidak bisa memerintah unit lawan', foe.every(u => u.order.type === 'idle'));
  BF.exec(s, 0, { c: 'train', bid: th1.id, unit: 'worker' });
  BF.exec(s, 0, { c: 'destroy', ids: [th1.id, foe[0].id] });
  check('tidak bisa memakai/menghancurkan bangunan lawan', th1.queue.length === 0 && !th1.dead && !foe[0].dead);
  let threw = false;
  try {
    for (const c of [null, 5, {}, { c: 'move' }, { c: 'move', ids: 'x', x: NaN, y: 1 }, { c: 'place', type: 'nope', tx: 1, ty: 1 }, { c: 'place', type: 'house', tx: -5, ty: 1e9 },
      { c: 'wall', tiles: [[1], 'a', [1e9, 2]] }, { c: 'gather', nx: 'a', ny: 2 }, { c: 'cancel', bid: th1.id, i: 0 }, { c: 'research', bid: 1, tech: '__proto__' }, { c: 'train', bid: 1, unit: 'constructor' }, { c: 'attack', ids: [1, 2, 3], tid: 'zz' }]) BF.exec(s, 0, c);
  } catch (e) { threw = e.message; }
  check('perintah rusak diabaikan tanpa error', threw === false, threw);
  BF.exec(s, 0, { c: 'move', ids: mine.map(u => u.id), x: 40, y: 40 });
  check('perintah sah dijalankan', mine.every(u => u.order.type === 'move'));
  BF.exec(s, 1, { c: 'resign' });
  check('menyerah mengakhiri permainan', s.over && s.winner === 0);
}

// 6. Tembok & gerbang: menghalangi lawan, bisa dilewati pemilik, dan AI mendobraknya
{
  const s = BF.newGame({ seed: 8, ai: [false, true], difficulty: 'hard', factions: ['samudra', 'bara'] });
  const p = s.players[0], th = s.buildings[0], cx = th.tx + 1, cy = th.ty + 1, R = 6;
  p.res.stone = 5000;
  for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {  // bersihkan cincin agar tembok pasti utuh
    if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== R) continue;
    const i = BF.idx(x, y); s.map.terrain[i] = 0; s.map.node[i] = 0;
  }
  const ring = [];
  for (let d = -R; d <= R; d++) ring.push([cx + d, cy - R], [cx + d, cy + R]);
  for (let d = -R + 1; d < R; d++) ring.push([cx - R, cy + d], [cx + R, cy + d]);
  const workers = s.units.filter(u => u.owner === 0);
  BF.exec(s, 0, { c: 'wall', ids: workers.map(u => u.id), tiles: ring.slice(0, 60) });
  BF.exec(s, 0, { c: 'wall', ids: [], tiles: ring.slice(60) });
  const walls = s.buildings.filter(b => b.type === 'wall');
  check('tembok diletakkan & batu terpotong', walls.length === ring.length && p.res.stone === 5000 - ring.length * 6, { walls: walls.length });
  for (const b of walls) { b.built = true; b.progress = 1; b.hp = p.B.wall.hp; }
  const out = BF.findFreeNear(s.map, cx + R + 3, cy, 6);
  let r = BF.findPath(s.map, cx + 2, cy + 2, { x0: out.x, y0: out.y, x1: out.x, y1: out.y, range: 0 }, 0);
  check('cincin tembok menutup jalan', r.partial === true);
  const gw = walls.find(b => b.tx === cx + R && b.ty === cy);
  BF.exec(s, 0, { c: 'place', type: 'gate', tx: gw.tx, ty: gw.ty, ids: [] });
  const gate = s.buildings.find(b => b.type === 'gate' && !b.dead);
  check('gerbang menggantikan tembok', !!gate && gw.dead && s.map.block[BF.idx(gate.tx, gate.ty)] === 2);
  gate.built = true; gate.progress = 1; gate.hp = p.B.gate.hp;
  r = BF.findPath(s.map, cx + 2, cy + 2, { x0: out.x, y0: out.y, x1: out.x, y1: out.y, range: 0 }, 0);
  const r1 = BF.findPath(s.map, out.x, out.y, { x0: cx + 2, y0: cy + 2, x1: cx + 2, y1: cy + 2, range: 0 }, 1);
  check('gerbang: pemilik lewat, lawan tidak', r.partial === false && r1.partial === true);
  run(s, 20 * 60 * 40);
  check('AI mendobrak tembok dan menang atas pemain pasif', s.over && s.winner === 1, { min: (s.tick / 1200).toFixed(1), wallsLeft: s.buildings.filter(b => b.type === 'wall').length });
}

// 7. Hewan buruan: tersebar adil, rusa diburu jadi pangan, babi menyeruduk balik, perintah berburu tervalidasi
{
  const s = BF.newGame({ seed: 4202, ai: [false, false], factions: ['padang', 'bara'] });
  const near = (p, type) => s.animals.filter(a => a.type === type).map(a => BF.dist(a.x - p.x, a.y - p.y)).sort((a, b) => a - b);
  const [a0, a1] = s.map.starts.map(p => near(p, 'deer').slice(0, 6).filter(d => d < 18).length);
  check('setiap markas punya rusa & babi hutan di dekatnya', a0 >= 4 && a1 >= 4 && near(s.map.starts[0], 'boar')[0] < 18 && near(s.map.starts[1], 'boar')[0] < 18, { rusa: [a0, a1] });
  const st = s.map.starts[0], deer = s.animals.filter(a => a.type === 'deer').sort((a, b) => BF.dist(a.x - st.x, a.y - st.y) - BF.dist(b.x - st.x, b.y - st.y))[0];
  const ws = s.units.filter(u => u.owner === 0 && u.type === 'worker'), food0 = s.players[0].res.food;
  BF.exec(s, 1, { c: 'hunt', ids: ws.map(u => u.id), aid: deer.id });
  check('tidak bisa menyuruh pekerja lawan berburu', ws.every(u => u.order.type === 'idle'));
  BF.exec(s, 0, { c: 'hunt', ids: ws.map(u => u.id), aid: deer.id });
  run(s, 20 * 90);
  check('rusa diburu → bangkai → pangan disetor', s.players[0].res.food >= food0 + 100 && deer.state === 'carcass', { pangan: s.players[0].res.food, sisa: deer.food });

  const s2 = BF.newGame({ seed: 4202, ai: [false, false], factions: ['padang', 'bara'] });
  const boar = s2.animals.filter(a => a.type === 'boar').sort((a, b) => BF.dist(a.x - st.x, a.y - st.y) - BF.dist(b.x - st.x, b.y - st.y))[0];
  const w = s2.units.find(u => u.owner === 0 && u.type === 'worker');
  BF.exec(s2, 0, { c: 'hunt', ids: [w.id], aid: boar.id });
  run(s2, 20 * 60);
  check('babi hutan menyeruduk balik pemburu tunggal', w.dead || w.hp < BF.UNITS.worker.hp, { hpPekerja: w.dead ? 0 : w.hp, hpBabi: boar.hp });
}

// 8. Perbaikan bangunan: nyawa pulih, biaya ±50% biaya bangunan untuk perbaikan penuh, berhenti saat stok habis,
//    perintah tervalidasi, dan AI memperbaiki bangunannya sendiri
{
  const mk = () => { const s = BF.newGame({ seed: 4202, ai: [false, false], factions: ['padang', 'bara'] }); s.animals.length = 0; return s; };
  const s = mk(), p = s.players[0], th = s.buildings.find(b => b.owner === 0 && b.type === 'townhall'), max = BF.bldDef(s, th).hp;
  const ws = s.units.filter(u => u.owner === 0 && u.type === 'worker'), ids = ws.map(u => u.id);
  th.hp = 1;
  p.res = { food: 0, wood: 1000, gold: 0, stone: 1000 };
  BF.exec(s, 1, { c: 'repair', ids, bid: th.id });
  check('tidak bisa menyuruh pekerja lawan memperbaiki', ws.every(u => u.order.type === 'idle'));
  BF.exec(s, 0, { c: 'repair', ids, bid: th.id });
  run(s, 20 * 120);
  const used = { wood: 1000 - p.res.wood, stone: 1000 - p.res.stone }, c = BF.BUILDINGS.townhall.cost;
  check('perbaikan penuh: nyawa kembali utuh, pekerja menganggur lagi', th.hp === max && ws.every(u => u.order.type === 'idle'), { hp: th.hp, max });
  check('biaya perbaikan penuh ≈ 50% biaya bangunan', Math.abs(used.wood - c.wood * 0.5) <= 2 && Math.abs(used.stone - c.stone * 0.5) <= 2, used);

  const s2 = mk(), p2 = s2.players[0], th2 = s2.buildings.find(b => b.owner === 0 && b.type === 'townhall');
  th2.hp = 100;
  p2.res = { food: 0, wood: 20, gold: 0, stone: 1000 };
  const ws2 = s2.units.filter(u => u.owner === 0 && u.type === 'worker');
  BF.exec(s2, 0, { c: 'repair', ids: ws2.map(u => u.id), bid: th2.id });
  let stop = false;
  for (let i = 0; i < 20 * 120; i++) { BF.step(s2); if (s2.events.some(e => e.type === 'repairStop' && e.owner === 0)) stop = true; s2.events.length = 0; }
  check('stok habis → perbaikan berhenti & pemilik diberi tahu', stop && th2.hp < BF.bldDef(s2, th2).hp && p2.res.wood >= 0 && ws2.every(u => u.order.type === 'idle'), { hp: Math.round(th2.hp), kayu: p2.res.wood });

  const s3 = mk(), p3 = s3.players[1], th3 = s3.buildings.find(b => b.owner === 1 && b.type === 'townhall'), max3 = BF.bldDef(s3, th3).hp;
  p3.isAI = true;
  th3.hp = max3 * 0.3;
  run(s3, 20 * 60);
  check('AI memperbaiki balai kotanya yang rusak', th3.hp > max3 * 0.5, { dari: Math.round(max3 * 0.3), ke: Math.round(th3.hp) });
}

// 9. Berlindung: masuk & keluar bangunan, kapasitas, kelas, aman dari serangan, panah tambahan, pulih, simpan/muat,
//    validasi kepemilikan, dan AI menyembunyikan pekerjanya saat markas diserang
{
  const mk = () => { const s = BF.newGame({ seed: 4202, ai: [false, false], factions: ['padang', 'bara'] }); s.animals.length = 0; return s; };
  const near = (s, b, type, owner, n) => { const out = []; for (let i = 0; i < n; i++) { const f = BF.findFreeNear(s.map, b.tx + b.size + 1, b.ty + b.size + 1 + i, 6, owner); out.push(BF.spawnUnit(s, type, owner, f.x + 0.5, f.y + 0.5)); } return out; };
  const s = mk(), p = s.players[0], th = s.buildings.find(b => b.owner === 0 && b.type === 'townhall');
  const ws = s.units.filter(u => u.owner === 0 && u.type === 'worker'), ids = ws.map(u => u.id), pop0 = p.pop;
  ws[0].hp = 10;
  BF.exec(s, 1, { c: 'garrison', ids, bid: th.id });
  check('lawan tidak bisa menyuruh unit kita berlindung', ws.every(u => u.order.type === 'idle'));
  BF.exec(s, 0, { c: 'garrison', ids, bid: th.id });
  run(s, 20 * 20);
  check('pekerja masuk Balai Kota: hilang dari peta, populasi tetap', th.inside.length === 4 && !s.units.some(u => u.owner === 0 && u.type === 'worker') && ids.every(id => !s.byId.has(id)) && p.pop === pop0, { dalam: th.inside.length, pop: p.pop });
  check('unit di dalam pulih perlahan', ws[0].hp > 15 && ws[0].hp <= 30, { hp: ws[0].hp });

  // musuh menyerbu: yang berlindung tak tersentuh, balai kota menembak 1 + 4/2 = 3 panah per tembakan
  const foes = near(s, th, 'spear', 1, 3);
  for (const f of foes) BF.setOrder(f, { type: 'attack', tid: th.id });
  let volley = 0;
  for (let i = 0; i < 20 * 12; i++) { const n0 = s.projectiles.length; BF.step(s); s.events.length = 0; volley = Math.max(volley, s.projectiles.filter(q => q.dk.k === 'b').length - n0); }
  check('3 panah per tembakan dengan 4 unit di dalam', volley === 3, { volley });
  check('unit yang berlindung tidak bisa diserang', th.inside.length === 4 && th.inside.every(u => u.hp > 0));
  for (const f of foes) if (!f.dead) BF.kill(s, f);
  run(s, 2);

  const h0 = BF.hash(s), s2 = BF.deserialize(JSON.parse(JSON.stringify(BF.serialize(s)))), th2 = s2.buildings.find(b => b.id === th.id);
  check('simpan/muat mempertahankan unit yang berlindung', BF.hash(s2) === h0 && th2.inside.length === 4 && !s2.units.some(u => u.owner === 0));

  BF.exec(s, 1, { c: 'ungarrison', bid: th.id });
  check('lawan tidak bisa mengeluarkan unit kita', th.inside.length === 4);
  BF.exec(s, 0, { c: 'ungarrison', bid: th.id });
  run(s, 20 * 2);
  const out = s.units.filter(u => u.owner === 0);
  check('keluar: semua unit kembali ke peta di dekat bangunan', th.inside.length === 0 && out.length === 4 && out.every(u => !u.dead && s.byId.get(u.id) === u && BF.distToBuilding(th, u.x, u.y) < 4) && new Set(s.units).size === s.units.length);
  BF.exec(s2, 0, { c: 'ungarrison', bid: th2.id });
  run(s2, 20 * 2);
  check('keluar setelah dimuat dari simpanan tetap identik', BF.hash(s2) === BF.hash(s));

  // menara: kapasitas 4; kavaleri ditolak; bangunan roboh → penghuninya selamat
  const s3 = mk(), th3 = s3.buildings.find(b => b.owner === 0 && b.type === 'townhall');
  s3.players[0].popCap = 60;
  const spot = BF.findFreeNear(s3.map, th3.tx + 6, th3.ty + 6, 8, 0), tw = BF.spawnBuilding(s3, 'tower', 0, spot.x, spot.y, true);
  const sp = near(s3, tw, 'spear', 0, 6), rd = near(s3, tw, 'rider', 0, 1)[0];
  let full = false;
  BF.exec(s3, 0, { c: 'garrison', ids: sp.map(u => u.id).concat(rd.id), bid: tw.id });
  for (let i = 0; i < 20 * 20; i++) { BF.step(s3); if (s3.events.some(e => e.type === 'garrisonFull' && e.owner === 0)) full = true; s3.events.length = 0; }
  check('menara menampung 4; sisanya menunggu di luar & pemilik diberi tahu', tw.inside.length === 4 && sp.filter(u => s3.byId.has(u.id)).length === 2 && full, { dalam: tw.inside.length });
  check('kavaleri tidak bisa berlindung', rd.order.type === 'idle' && s3.byId.has(rd.id));
  const pop3 = s3.players[0].pop;
  BF.exec(s3, 0, { c: 'destroy', ids: [tw.id] });
  run(s3, 20);
  check('bangunan roboh: unit di dalamnya selamat', sp.every(u => !u.dead && s3.byId.get(u.id) === u) && s3.players[0].pop === pop3 && sane(s3) && new Set(s3.units).size === s3.units.length);

  // AI: pekerja masuk balai kota saat musuh di depan pintu, keluar lagi setelah aman
  const s4 = mk(), q = s4.players[1], th4 = s4.buildings.find(b => b.owner === 1 && b.type === 'townhall');
  q.isAI = true;
  const raid = near(s4, th4, 'spear', 0, 3);
  for (const u of raid) BF.setOrder(u, { type: 'idle' });
  run(s4, 20 * 8);
  const hid = th4.inside.length;
  for (const u of raid) if (!u.dead) BF.kill(s4, u);
  run(s4, 20 * 6);
  check('AI: pekerja berlindung saat diserbu, keluar setelah aman', hid >= 3 && th4.inside.length === 0 && s4.units.filter(u => u.owner === 1 && u.type === 'worker').length >= 4, { berlindung: hid, sesudah: th4.inside.length });
}

// 10. Sikap unit & patroli
{
  // lahan uji datar tanpa penghalang di tengah peta; kedua pemain bukan AI, hewan disingkirkan
  const mk = () => {
    const s = BF.newGame({ seed: 4202, ai: [false, false], factions: ['padang', 'bara'] }), m = s.map;
    s.animals.length = 0;
    for (let y = 40; y < 56; y++) for (let x = 36; x < 60; x++) { const i = y * 96 + x; m.terrain[i] = 0; m.node[i] = 0; m.nodeAmt[i] = 0; m.block[i] = 0; m.bld[i] = 0; }
    BF.finishMap(m);
    s.players[0].popCap = s.players[1].popCap = 60;
    return s;
  };
  const moved = (u, x, y) => BF.dist(u.x - x, u.y - y);

  let s = mk(), me = BF.spawnUnit(s, 'spear', 0, 42.5, 48.5), foe = BF.spawnUnit(s, 'worker', 1, 46.5, 48.5);
  check('unit baru bersikap agresif', me.stance === 0);
  run(s, 20 * 6);
  check('agresif: mengejar musuh yang terlihat', foe.dead || moved(me, 42.5, 48.5) > 1.5, { geser: moved(me, 42.5, 48.5).toFixed(2), musuhMati: foe.dead });

  s = mk(); me = BF.spawnUnit(s, 'spear', 0, 42.5, 48.5); foe = BF.spawnUnit(s, 'worker', 1, 46.5, 48.5);
  BF.exec(s, 1, { c: 'stance', ids: [me.id], v: 1 });
  check('lawan tidak bisa mengubah sikap unit kita', me.stance === 0);
  BF.exec(s, 0, { c: 'stance', ids: [me.id], v: 7 });
  check('nilai sikap tak sah diabaikan', me.stance === 0);
  BF.exec(s, 0, { c: 'stance', ids: [me.id], v: 1 });
  run(s, 20 * 8);
  check('bertahan: tidak beranjak mengejar musuh di luar jangkauan', me.stance === 1 && moved(me, 42.5, 48.5) < 0.05 && !foe.dead, { geser: moved(me, 42.5, 48.5).toFixed(3) });
  BF.setOrder(foe, BF.moveOrder(s, 43.2, 48.5, false, 1));
  run(s, 20 * 10);
  check('bertahan: menyerang musuh yang masuk jangkauan, tetap di tempat', foe.dead && moved(me, 42.5, 48.5) < 0.6, { musuhMati: foe.dead, geser: moved(me, 42.5, 48.5).toFixed(2) });

  s = mk(); me = BF.spawnUnit(s, 'spear', 0, 42.5, 48.5);
  const arc = BF.spawnUnit(s, 'archer', 1, 46.5, 48.5);
  BF.exec(s, 0, { c: 'stance', ids: [me.id], v: 1 });
  run(s, 20 * 6);
  check('bertahan: dipanah dari jauh pun tidak mengejar', me.hp < BF.UNITS.spear.hp && moved(me, 42.5, 48.5) < 0.05, { hp: me.hp });

  s = mk(); me = BF.spawnUnit(s, 'spear', 0, 42.5, 48.5); foe = BF.spawnUnit(s, 'spear', 1, 43.3, 48.5);
  BF.exec(s, 0, { c: 'stance', ids: [me.id], v: 2 });
  run(s, 20 * 5);
  check('diam: tidak membalas walau diserang', me.stance === 2 && foe.hp === s.players[1].U.spear.hp && (me.dead || me.hp < BF.UNITS.spear.hp), { hpKita: me.dead ? 0 : me.hp, hpMusuh: foe.hp });
  if (!me.dead) { BF.exec(s, 0, { c: 'attack', ids: [me.id], tid: foe.id }); run(s, 20 * 3); }
  check('diam: perintah serang langsung tetap dijalankan', me.dead || foe.dead || foe.hp < s.players[1].U.spear.hp);

  // patroli: bolak-balik A ↔ B, menyerang musuh di rute lalu lanjut
  s = mk(); me = BF.spawnUnit(s, 'sword', 0, 40.5, 50.5);
  BF.exec(s, 1, { c: 'patrol', ids: [me.id], x: 52.5, y: 50.5 });
  check('lawan tidak bisa menyuruh unit kita berpatroli', me.order.type === 'idle');
  BF.exec(s, 0, { c: 'patrol', ids: [me.id], x: 52.5, y: 50.5 });
  let nearB = 0, backA = 0, tB = 0;
  for (let i = 0; i < 20 * 40; i++) { BF.step(s); s.events.length = 0; if (!nearB && moved(me, 52.5, 50.5) < 0.6) { nearB = 1; tB = i; } if (nearB && !backA && moved(me, 40.5, 50.5) < 0.6) backA = 1; }
  check('patroli: sampai di titik tujuan lalu kembali ke titik awal', nearB === 1 && backA === 1 && me.order.type === 'patrol', { tickKeB: tB });
  foe = BF.spawnUnit(s, 'worker', 1, 46.5, 51.5);
  run(s, 20 * 25);
  check('patroli: menyerang musuh di rute, lalu melanjutkan patroli', foe.dead && me.order.type === 'patrol', { musuhMati: foe.dead, perintah: me.order.type });
  const s2 = BF.deserialize(JSON.parse(JSON.stringify(BF.serialize(s))));
  run(s, 20 * 20); run(s2, 20 * 20);
  check('patroli & sikap ikut tersimpan (lanjut setelah muat identik)', BF.hash(s) === BF.hash(s2) && s2.units.find(u => u.id === me.id).order.type === 'patrol');

  // unit jarak dekat tidak macet bila sasarannya di tile serong di balik sudut penghalang
  s = mk(); s.map.node[49 * 96 + 45] = BF.N_STONE; s.map.nodeAmt[49 * 96 + 45] = 100; BF.finishMap(s.map);
  me = BF.spawnUnit(s, 'spear', 0, 45.5, 48.96); foe = BF.spawnUnit(s, 'worker', 1, 46.5, 49.5);
  BF.exec(s, 0, { c: 'stance', ids: [me.id], v: 0 });
  BF.exec(s, 0, { c: 'attack', ids: [me.id], tid: foe.id });
  run(s, 20 * 12);
  check('serang jarak dekat melewati sudut penghalang (tidak macet)', foe.dead, { hpMusuh: foe.dead ? 0 : foe.hp, x: me.x.toFixed(2), y: me.y.toFixed(2) });
}

// 11. Pasar: syarat era, validasi, harga bergeser tiap transaksi lalu kembali normal, dipakai bersama, ikut tersimpan
{
  const mk = () => { const s = BF.newGame({ seed: 4202, ai: [false, false], factions: ['padang', 'bara'] }); s.animals.length = 0; return s; };
  const s = mk(), p = s.players[0], q = s.players[1], th = s.buildings.find(b => b.owner === 0 && b.type === 'townhall');
  const spot = (owner, dx) => { const t = s.buildings.find(b => b.owner === owner && b.type === 'townhall'); for (let r = 4; r < 14; r++) for (let d = -r; d <= r; d++) for (const [x, y] of [[t.tx + d, t.ty + r], [t.tx + r + dx, t.ty + d]]) if (BF.canPlace(s.map, 'market', x, y)) return { x, y }; };
  p.res = { food: 1000, wood: 1000, gold: 1000, stone: 1000 };
  q.res = { food: 1000, wood: 1000, gold: 1000, stone: 1000 };
  const a = spot(0, 0);
  check('Pasar belum bisa dibangun di Era Perintis', BF.cmd.place(s, 0, 'market', a.x, a.y).err === 'era');
  p.era = q.era = 1;
  const mine = BF.spawnBuilding(s, 'market', 0, a.x, a.y, false), b2 = spot(1, 0), theirs = BF.spawnBuilding(s, 'market', 1, b2.x, b2.y, true);
  const snap = () => JSON.stringify([p.res, q.res, s.market]);
  let before = snap();
  BF.exec(s, 0, { c: 'trade', bid: mine.id, res: 'wood', buy: false });
  BF.exec(s, 0, { c: 'trade', bid: theirs.id, res: 'wood', buy: false });
  BF.exec(s, 0, { c: 'trade', bid: th.id, res: 'wood', buy: false });
  check('berdagang butuh Pasar sendiri yang sudah jadi', snap() === before);
  mine.built = true; mine.progress = 1; mine.hp = BF.bldDef(s, mine).hp;
  BF.exec(s, 0, { c: 'trade', bid: mine.id, res: 'gold', buy: true });
  BF.exec(s, 0, { c: 'trade', bid: mine.id, res: 'pop', buy: false });
  check('sumber daya yang tak diperdagangkan ditolak', snap() === before);

  BF.exec(s, 0, { c: 'trade', bid: mine.id, res: 'wood', buy: false });
  check('jual 100 Kayu → +70 Emas, harga Kayu turun 4%', p.res.wood === 900 && p.res.gold === 1070 && Math.abs(s.market.wood - 96) < 1e-9, { emas: p.res.gold, harga: s.market.wood });
  BF.exec(s, 0, { c: 'trade', bid: mine.id, res: 'food', buy: true });
  check('beli 100 Pangan → −130 Emas, harga Pangan naik 4%', p.res.food === 1100 && p.res.gold === 940 && Math.abs(s.market.food - 104) < 1e-9, { emas: p.res.gold, harga: s.market.food });
  BF.exec(s, 1, { c: 'trade', bid: theirs.id, res: 'food', buy: true });
  check('harga dipakai bersama: pembelian lawan ikut menaikkannya', q.res.gold === 1000 - Math.ceil(104 * 1.3) && s.market.food > 108, { emasLawan: q.res.gold, harga: s.market.food.toFixed(2) });

  const g0 = p.res.gold;
  for (let i = 0; i < 3; i++) { BF.exec(s, 0, { c: 'trade', bid: mine.id, res: 'stone', buy: true }); BF.exec(s, 0, { c: 'trade', bid: mine.id, res: 'stone', buy: false }); }
  check('beli lalu jual lagi selalu rugi (tak bisa dieksploitasi)', p.res.gold < g0 - 150 && p.res.stone === 1000, { rugi: g0 - p.res.gold });

  p.res.wood = 100000;
  for (let i = 0; i < 60; i++) BF.exec(s, 0, { c: 'trade', bid: mine.id, res: 'wood', buy: false });
  check('harga tidak turun di bawah batas minimum', s.market.wood === BF.MARKET.min, { harga: s.market.wood });
  p.res.gold = 0;
  before = snap();
  BF.exec(s, 0, { c: 'trade', bid: mine.id, res: 'food', buy: true });
  check('emas tidak cukup → pembelian ditolak', snap() === before);

  const h0 = BF.hash(s), d = JSON.parse(JSON.stringify(BF.serialize(s))), s2 = BF.deserialize(d);
  check('harga pasar ikut tersimpan', BF.hash(s2) === h0 && s2.market.wood === s.market.wood);
  delete d.market;
  check('simpanan lama tanpa pasar dimuat dengan harga dasar', BF.deserialize(d).market.stone === BF.MARKET.base.stone);
  run(s, 20 * 60 * 6);
  check('harga perlahan kembali ke harga dasar', s.market.wood > 60 && s.market.wood <= 100 && Math.abs(s.market.food - 100) < 5, { kayu: s.market.wood.toFixed(1), pangan: s.market.food.toFixed(1) });
}

// 12. AI lebih cerdas (BF.DIFF.smart): mundur saat kalah jumlah, mengapit dari dua arah, berburu babi berempat, berdagang
{
  const mk = diff => { const s = tanpaUnitAwal(BF.newGame({ seed: 4202, ai: [false, true], difficulty: diff, factions: ['padang', 'bara'] })); s.animals.length = 0; s.players[0].popCap = s.players[1].popCap = 70; return s; };
  const ring = (s, cx, cy, type, owner, n) => { const out = []; for (let i = 0; i < n; i++) { const f = BF.findFreeNear(s.map, Math.round(cx + (i % 4) - 1.5), Math.round(cy + ((i / 4) | 0)), 6, owner); out.push(BF.spawnUnit(s, type, owner, f.x + 0.5, f.y + 0.5)); } return out; };
  const AI0 = (wave, sent) => ({ state: 'attack', waveSize: wave, sent, target: 0, rebalT: 0, dirX: 0, dirY: 0 });

  // mundur: 5 tombak AI menyerbu markas yang dijaga 14 pedang
  const raid = diff => {
    const s = mk(diff), th = s.buildings.find(b => b.owner === 0 && b.type === 'townhall'), q = s.players[1];
    const guards = ring(s, th.tx + 1, th.ty + 5, 'sword', 0, 14);
    for (const g of guards) g.stance = 1;                      // penjaga bertahan di tempat (tidak mengejar)
    const army = ring(s, th.tx + 1, th.ty + 12, 'spear', 1, 5);
    q.ai = AI0(5, 5);
    let t = 0;
    for (; t < 20 * 12 && q.ai.state === 'attack'; t++) { BF.step(s); s.events.length = 0; }
    return { s, q, army, t };
  };
  let r = raid('normal');
  const alive = r.army.filter(u => !u.dead);
  check('AI Sedang mundur saat kalah jumlah', r.q.ai.state === 'build' && r.q.ai.retreats === 1 && alive.length >= 4 && alive.every(u => u.order.type === 'move') && r.q.ai.waveSize > 5, { tick: r.t, hidup: alive.length, gelombang: r.q.ai.waveSize });
  run(r.s, 20 * 8);
  check('setelah mundur tidak langsung berbalik menyerang', r.q.ai.state === 'build' && r.army.filter(u => !u.dead).every(u => u.order.type !== 'attack' && u.order.type !== 'amove'));
  r = raid('easy');
  check('AI Mudah tidak mundur (bertempur sampai gelombangnya habis)', !r.q.ai.retreats, { tick: r.t, state: r.q.ai.state });

  // mengapit: AI Sulit dengan 12 pasukan membagi sepertiganya ke titik di samping sasaran
  let s = mk('hard'), q = s.players[1], th = s.buildings.find(b => b.owner === 1 && b.type === 'townhall');
  let army = ring(s, th.tx + 1, th.ty + 5, 'spear', 1, 12);
  s.tick = BF.DIFF.hard.firstAttack;
  run(s, 20 * 4);
  const fl = q.ai.flank, tgt = s.byId.get(q.ai.target);
  const wing = fl ? army.filter(u => fl.ids.indexOf(u.id) >= 0) : [];
  check('AI Sulit: sepertiga pasukan menjadi kelompok pengapit', q.ai.state === 'attack' && !!fl && wing.length === 4 && !!tgt && BF.distToBuilding(tgt, fl.x, fl.y) > 6, fl && { n: wing.length, jarakKeSasaran: BF.distToBuilding(tgt, fl.x, fl.y).toFixed(1) });
  check('pengapit menuju titik apit, pasukan utama menuju sasaran', !!fl && wing.every(u => u.order.type === 'amove' && Math.abs(u.order.x - fl.x) < 3 && Math.abs(u.order.y - fl.y) < 3) && army.filter(u => fl.ids.indexOf(u.id) < 0).every(u => u.order.type === 'amove' && BF.dist(u.order.x - fl.x, u.order.y - fl.y) > 5));
  let went = false;
  for (let i = 0; i < 20 * 100 && !went; i++) { BF.step(s); s.events.length = 0; went = !q.ai.flank || q.ai.flank.go; }
  check('pengapit lalu menyerbu sasaran dari samping', went);
  s = mk('normal'); q = s.players[1]; th = s.buildings.find(b => b.owner === 1 && b.type === 'townhall');
  ring(s, th.tx + 1, th.ty + 5, 'spear', 1, 12);
  s.tick = BF.DIFF.normal.firstAttack;
  run(s, 20 * 4);
  check('AI Sedang menyerang tanpa mengapit', q.ai.state === 'attack' && !q.ai.flank);

  // formasi: gelombang AI Sedang/Sulit berbaris dulu di titik siap di depan sasaran, lalu menyerbu; AI Mudah langsung maju
  const wave = diff => {
    const s = mk(diff), q = s.players[1], th = s.buildings.find(b => b.owner === 1 && b.type === 'townhall');
    q.era = 2;
    const army = ring(s, th.tx + 1, th.ty + 5, 'spear', 1, 4).concat(ring(s, th.tx + 1, th.ty + 7, 'archer', 1, 3), ring(s, th.tx + 1, th.ty + 8, 'catapult', 1, 1));
    q.ai = AI0(8, 8);
    run(s, BF.DIFF[diff].think + 2);
    const tgt = s.byId.get(q.ai.target), tx = tgt.tx + tgt.size / 2, ty = tgt.ty + tgt.size / 2;
    return { s, army, tgt, slow: Math.min(...army.map(u => BF.unitDef(s, u).speed)), jarak: army.map(u => +BF.dist(u.order.x - tx, u.order.y - ty).toFixed(1)) };
  };
  let w = wave('normal');
  check('AI Sedang berangkat menyerang dalam formasi (laju unit paling lambat, arah hadap sama)', w.army.every(u => u.order.type === 'amove' && u.order.pace === w.slow && u.order.face === w.army[0].order.face) && w.slow < BF.unitDef(w.s, w.army[0]).speed, { laju: w.army.map(u => u.order.pace), jenis: w.army.map(u => u.order.type) });
  check('barisan dibentuk di titik siap di depan sasaran, bukan di atas sasaran', w.jarak.every(d => d > 4 && d < 11), w.jarak);
  {
    // petarung jarak dekat ditempatkan di depan pemanah, pelontar paling belakang (diukur sepanjang arah maju)
    const f = w.army[0].order.face, along = u => u.order.x * Math.cos(f) + u.order.y * Math.sin(f), of = t => w.army.filter(u => u.type === t).map(along);
    check('formasi AI: tombak di depan, pemanah di tengah, pelontar di belakang', Math.min(...of('spear')) > Math.max(...of('archer')) && Math.min(...of('archer')) > Math.max(...of('catapult')), { tombak: of('spear').map(v => +v.toFixed(1)), pemanah: of('archer').map(v => +v.toFixed(1)), pelontar: of('catapult').map(v => +v.toFixed(1)) });
  }
  {
    const hp0 = w.tgt.hp;
    let k = 0;
    for (; k < 20 * 150 && !w.tgt.dead && w.tgt.hp >= hp0; k++) { BF.step(w.s); w.s.events.length = 0; }
    check('setelah berbaris, pasukan AI menyerbu dan memukul sasaran', w.tgt.dead || w.tgt.hp < hp0, { detik: (k / 20).toFixed(0), jenis: w.army.map(u => u.order.type) });
  }
  w = wave('easy');
  check('AI Mudah langsung menuju sasaran tanpa formasi', w.army.every(u => u.order.type === 'amove' && !u.order.pace) && w.jarak.every(d => d < 4), { laju: w.army.map(u => u.order.pace), jarak: w.jarak });

  // babi hutan: diburu berempat sekaligus, tanpa korban
  s = mk('normal'); q = s.players[1]; th = s.buildings.find(b => b.owner === 1 && b.type === 'townhall');
  ring(s, th.tx + 1, th.ty + 4, 'worker', 1, 4);
  const bf = BF.findFreeNear(s.map, th.tx + 8, th.ty + 6, 6, 1), bd = BF.ANIMALS.boar;
  const boar = { id: s.nextId++, kind: 'animal', type: 'boar', x: bf.x + 0.5, y: bf.y + 0.5, hx: bf.x + 0.5, hy: bf.y + 0.5, hp: bd.hp, food: bd.food, dir: 0, state: 'graze', t: 5, wx: bf.x + 0.5, wy: bf.y + 0.5, tid: 0, cd: 0, atkAnim: 0, moving: false, dead: false };
  s.animals.push(boar); s.byId.set(boar.id, boar);
  const workers0 = s.units.filter(u => u.owner === 1 && u.type === 'worker').length;
  let pack = 0;
  for (let i = 0; i < 20 * 20 && boar.state !== 'carcass'; i++) { BF.step(s); s.events.length = 0; pack = Math.max(pack, s.units.filter(u => u.owner === 1 && u.order.animal === boar.id).length); }
  check('AI memburu babi hutan berempat sekaligus', pack >= 4 && boar.state === 'carcass', { pemburu: pack, babi: boar.state });
  run(s, 20 * 30);
  check('tak ada pekerja tewas & pangan bertambah dari babi', s.units.filter(u => u.owner === 1 && u.type === 'worker').length >= workers0 && boar.food < bd.food, { sisaPangan: boar.food });

  // pasar: AI membangunnya di Era Baja lalu menjual stok yang menumpuk
  const trader = diff => {
    const t = mk(diff), a = t.players[1], h = t.buildings.find(b => b.owner === 1 && b.type === 'townhall');
    a.era = 1;
    for (const [type, dx, dy] of [['barracks', 5, 0], ['range', 5, 4], ['stable', -5, 0]]) { const f = BF.findFreeNear(t.map, h.tx + dx, h.ty + dy, 8, 1); for (let rr = 0; rr < 12; rr++) { let ok = false; for (let d = -rr; d <= rr && !ok; d++) for (const [x, y] of [[f.x + d, f.y + rr], [f.x + rr, f.y + d], [f.x + d, f.y - rr], [f.x - rr, f.y + d]]) if (!ok && BF.canPlace(t.map, type, x, y)) { BF.spawnBuilding(t, type, 1, x, y, true); ok = true; } if (ok) break; } }
    a.res = { food: 300, wood: 2500, gold: 0, stone: 100 };
    run(t, 20 * 60 * 4);
    return { market: t.buildings.some(b => b.owner === 1 && b.type === 'market' && b.built), harga: t.market.wood };
  };
  let m = trader('normal');
  check('AI Sedang membangun Pasar dan menjual kayu yang menumpuk', m.market && m.harga < 100, m);
  m = trader('easy');
  check('AI Mudah tidak membangun Pasar', !m.market && m.harga === 100, m);
}

// 13. Statistik & skor untuk layar akhir
{
  const s = BF.newGame({ seed: 4202, ai: [true, true], difficulty: 'normal', factions: ['padang', 'bara'] });
  run(s, 20 * 60 * 12);
  const [p, q] = s.players, sum = o => Object.values(o).reduce((a, b) => a + b, 0), sc = BF.score(p);
  check('sumber daya terkumpul tercatat per jenis (jumlahnya = total)', sum(p.stat.got) === p.gathered && p.stat.got.food > 0 && p.stat.got.wood > 0, p.stat.got);
  check('unit dilatih & bangunan didirikan tercatat', p.stat.trained >= 8 && p.stat.built >= 3 && q.stat.trained >= 8, { dilatih: p.stat.trained, didirikan: p.stat.built });
  check('skor = ekonomi + militer + teknologi menurut BF.SCORE', sc.total === sc.eco + sc.mil + sc.tek && sc.eco === Math.round(p.gathered / 10) && sc.tek === p.era * 150 + p.techs.length * 40 && sc.mil === Math.round(p.stat.killVal / 5), sc);
  check('riwayat skor: satu sampel per 30 detik, tidak pernah turun', s.hist.length === 24 && s.hist.every((r, i) => r.length === 2 && (!i || (r[0] >= s.hist[i - 1][0] && r[1] >= s.hist[i - 1][1]))), { sampel: s.hist.length, akhir: s.hist[s.hist.length - 1] });
  const d = JSON.parse(JSON.stringify(BF.serialize(s))), s2 = BF.deserialize(d);
  check('statistik & riwayat ikut tersimpan', JSON.stringify(s2.players[0].stat) === JSON.stringify(p.stat) && s2.hist.length === s.hist.length && BF.score(s2.players[1]).total === BF.score(q).total);
  for (const pl of d.players) delete pl.stat;
  delete d.hist;
  const s3 = BF.deserialize(d);
  check('simpanan lama (tanpa statistik) tetap bisa dimuat & dilanjutkan', s3.hist.length === 0 && s3.players[0].stat.trained === 0 && BF.score(s3.players[0]).eco === sc.eco && (run(s3, 20 * 40), s3.hist.length === 1));

  // pertempuran: nilai musuh yang dikalahkan, kehilangan, dan penghancuran oleh pemilik sendiri
  const t = BF.newGame({ seed: 4202, ai: [false, false], factions: ['padang', 'bara'] }), a = t.players[0], b = t.players[1];
  t.animals.length = 0;
  const th = t.buildings.find(x => x.owner === 0 && x.type === 'townhall'), f = BF.findFreeNear(t.map, th.tx + 5, th.ty + 5, 6, 0);
  const me = BF.spawnUnit(t, 'sword', 0, f.x + 0.5, f.y + 0.5), foe = BF.spawnUnit(t, 'worker', 1, f.x + 1.5, f.y + 0.5);
  BF.exec(t, 0, { c: 'attack', ids: [me.id], tid: foe.id });
  run(t, 20 * 15);
  check('mengalahkan unit musuh: tercatat di kedua pihak, militer = nilai ÷ 5', foe.dead && a.stat.killU === 1 && a.stat.killVal === 50 && BF.score(a).mil === 10 && b.stat.lostU === 1 && a.kills === 1 && b.losses === 1, { killVal: a.stat.killVal, mil: BF.score(a).mil });
  BF.exec(t, 0, { c: 'destroy', ids: [me.id] });
  check('menghancurkan milik sendiri bukan kehilangan', me.dead && a.stat.lostU === 0 && a.losses === 0);
}

// 14. Formasi: baris & kotak menghadap arah maju, petarung jarak dekat di depan, kecepatan disamakan, tiba bersama
{
  const mk = () => {
    const s = BF.newGame({ seed: 4202, ai: [false, false], factions: ['padang', 'bara'] }), m = s.map;
    s.animals.length = 0;
    for (let y = 36; y < 60; y++) for (let x = 30; x < 66; x++) { const i = y * 96 + x; m.terrain[i] = 0; m.node[i] = 0; m.nodeAmt[i] = 0; m.block[i] = 0; m.bld[i] = 0; }
    BF.finishMap(m);
    for (const p of s.players) { p.popCap = 70; p.era = 2; BF.rebuildDefs(p); }
    return s;
  };
  const squad = (s, types) => types.map((t, i) => BF.spawnUnit(s, t, 0, 34 + (i % 3) * 0.9, 46 + ((i / 3) | 0) * 0.9));
  const ids = us => us.map(u => u.id), span = (us, k) => Math.max(...us.map(u => u[k])) - Math.min(...us.map(u => u[k]));
  const TEN = ['spear', 'archer', 'spear', 'archer', 'spear', 'archer', 'spear', 'archer', 'spear', 'spear'];

  // baris ke timur: 6 tombak di barisan depan (x lebih besar), 4 pemanah satu barisan di belakangnya, semua menghadap timur
  let s = mk(), us = squad(s, TEN);
  BF.exec(s, 0, { c: 'move', ids: ids(us), x: 54, y: 48, f: 1 });
  check('perintah gerak berformasi mencatat kecepatan & arah hadap formasi', us.every(u => u.order.type === 'move' && u.order.pace === Math.min(...us.map(q => BF.unitDef(s, q).speed)) && Math.abs(u.order.face) < 0.2), { pace: us[0].order.pace, face: +us[0].order.face.toFixed(2) });
  run(s, 20 * 20);
  let melee = us.filter(u => u.type === 'spear'), ranged = us.filter(u => u.type === 'archer');
  check('baris: tombak di depan pemanah, lebar melintang arah maju', us.every(u => u.order.type === 'idle') && Math.min(...melee.map(u => u.x)) > Math.max(...ranged.map(u => u.x)) + 0.4 && span(melee, 'y') > 4 && span(melee, 'x') < 0.5 && span(ranged, 'x') < 0.5,
    { depan: +Math.min(...melee.map(u => u.x)).toFixed(2), belakang: +Math.max(...ranged.map(u => u.x)).toFixed(2), lebar: +span(melee, 'y').toFixed(2) });
  check('tiba menghadap arah maju', us.every(u => Math.abs(u.dir) < 0.2), us.map(u => +u.dir.toFixed(2)));
  check('formasi berpusat di titik tujuan', Math.abs(us.reduce((a, u) => a + u.x, 0) / us.length - 54) < 0.6 && Math.abs(us.reduce((a, u) => a + u.y, 0) / us.length - 48) < 0.6);

  // kotak ke selatan: lebih rapat daripada baris, tombak tetap di depan (y lebih besar)
  s = mk(); us = squad(s, TEN);
  BF.exec(s, 0, { c: 'move', ids: ids(us), x: 36, y: 56, f: 2 });
  run(s, 20 * 16);
  melee = us.filter(u => u.type === 'spear'); ranged = us.filter(u => u.type === 'archer');
  check('kotak: rapat (≤ 4 lajur), tombak di depan, menghadap selatan', span(us, 'x') < 3 && span(us, 'y') > 1.5 && Math.min(...melee.map(u => u.y)) > Math.max(...ranged.map(u => u.y)) + 0.4 && us.every(u => Math.abs(u.dir - Math.PI / 2) < 0.2), { lebar: +span(us, 'x').toFixed(2), dalam: +span(us, 'y').toFixed(2) });

  // kecepatan: penunggang kuda + pelontar. Bebas → kuda jauh di depan; berformasi → berjalan bersama & tiba bersamaan
  const gap = f => {
    const t = mk(), r = BF.spawnUnit(t, 'rider', 0, 34, 46), c = BF.spawnUnit(t, 'catapult', 0, 34, 47.2);
    BF.exec(t, 0, { c: 'move', ids: [r.id, c.id], x: 58, y: 47, f });
    run(t, 20 * 6);
    const mid = r.x - c.x;
    let tr = 0, tc = 0;
    for (let i = 0; i < 20 * 30 && !(tr && tc); i++) { BF.step(t); t.events.length = 0; if (!tr && r.order.type === 'idle') tr = t.tick; if (!tc && c.order.type === 'idle') tc = t.tick; }
    return { mid: +mid.toFixed(2), selisihTiba: Math.abs(tr - tc) };
  };
  const free = gap(0), form = gap(1);
  check('bebas: kuda meninggalkan pelontar', free.mid > 6 && free.selisihTiba > 100, free);
  check('berformasi: berjalan secepat unit paling lambat & tiba bersamaan', Math.abs(form.mid) < 1.5 && form.selisihTiba < 30, form);

  // gerak-serang berformasi: musuh di rute diserang, lalu formasi dilanjutkan
  s = mk(); us = squad(s, ['sword', 'sword', 'sword', 'archer', 'archer']);
  const foe = BF.spawnUnit(s, 'worker', 1, 44, 48.5);
  BF.exec(s, 0, { c: 'move', ids: ids(us), x: 54, y: 48, attack: true, f: 1 });
  run(s, 20 * 30);
  check('gerak-serang berformasi: menyerang di jalan lalu menyelesaikan formasi', foe.dead && us.every(u => u.order.type === 'idle' && u.x > 51) && Math.min(...us.filter(u => u.type === 'sword').map(u => u.x)) > Math.max(...us.filter(u => u.type === 'archer').map(u => u.x)), { musuhMati: foe.dead, x: us.map(u => +u.x.toFixed(1)) });

  // validasi & kompatibilitas
  s = mk(); us = squad(s, ['spear', 'spear', 'spear']);
  BF.exec(s, 0, { c: 'move', ids: ids(us), x: 50, y: 48, f: 9 });
  check('nilai formasi tak sah → gerak bebas', us.every(u => u.order.type === 'move' && u.order.pace === undefined));
  BF.exec(s, 1, { c: 'move', ids: ids(us), x: 40, y: 40, f: 1 });
  check('lawan tidak bisa menggerakkan unit kita dalam formasi', us.every(u => u.order.goal.x0 >= 48));
  const a = mk(), b = mk(), ua = squad(a, TEN), ub = squad(b, TEN);
  BF.exec(a, 0, { c: 'move', ids: ids(ua), x: 54, y: 48 });
  BF.exec(b, 0, { c: 'move', ids: ids(ub), x: 54, y: 48, f: 0 });
  run(a, 200); run(b, 200);
  check('tanpa formasi (f kosong / 0): perilaku lama tidak berubah', BF.hash(a) === BF.hash(b) && ua.every(u => u.order.pace === undefined));
  s = mk(); us = squad(s, TEN);
  BF.exec(s, 0, { c: 'move', ids: ids(us), x: 54, y: 48, f: 2 });
  run(s, 20 * 3);
  const s2 = BF.deserialize(JSON.parse(JSON.stringify(BF.serialize(s))));
  run(s, 20 * 20); run(s2, 20 * 20);
  check('formasi di tengah jalan ikut tersimpan (lanjut setelah muat identik)', BF.hash(s) === BF.hash(s2));
}

// 15. Lebih dari dua pemain (semua lawan semua): peta 3–4 markas, pemain tumbang, pemenang terakhir, AI, simpan/muat
{
  const main = b => b.type !== 'farm' && !BF.BUILDINGS[b.type].barrier;
  const raze = (s, pid) => { for (const b of s.buildings.slice()) if (b.owner === pid && !b.dead) BF.kill(s, b); };
  const mapHash = m => { let h = 0; for (let i = 0; i < m.terrain.length; i++) h = (Math.imul(h, 31) + m.terrain[i] * 7 + m.node[i]) | 0; return h; };

  // dua pemain: tidak berubah (opsi players kosong / 2 menghasilkan permainan yang sama persis)
  const a2 = BF.newGame({ seed: 31, factions: ['bara', 'rimba'] }), b2 = BF.newGame({ seed: 31, players: 2, factions: ['bara', 'rimba'] });
  check('players kosong = 2 pemain, peta & keadaan awal identik', a2.players.length === 2 && b2.players.length === 2 && mapHash(a2.map) === mapHash(b2.map) && BF.hash(a2) === BF.hash(b2) && JSON.stringify(a2.map.starts) === JSON.stringify(b2.map.starts));
  check('jumlah pemain dibatasi 2–4', BF.newGame({ seed: 5, players: 9 }).players.length === 4 && BF.newGame({ seed: 5, players: 1 }).players.length === 2 && BF.newGame({ seed: 5, players: 3 }).players.length === 3);

  // peta 3 dan 4 pemain: tiap pemain punya markas sendiri di sudut berbeda, saling terhubung lewat darat, sumber daya adil
  let okStart = true, okRes = true, okLink = true;
  const detail = [];
  for (const n of [3, 4]) for (let seed = 1; seed <= 6; seed++) {
    const s = BF.newGame({ seed: seed * 13, players: n }), m = s.map, th = s.players.map(p => s.buildings.find(b => b.owner === p.id && b.type === 'townhall'));
    okStart = okStart && s.players.length === n && th.every(Boolean) && new Set(m.starts.map(q => q.x + ',' + q.y)).size === n &&
      s.players.every(p => s.units.filter(u => u.owner === p.id && u.type === 'worker').length === BF.START_WORKERS) && new Set(s.players.map(p => p.color)).size === n;
    const reg = m.region[BF.idx(th[0].tx, th[0].ty + 3)];
    okLink = okLink && th.every(b => m.region[BF.idx(b.tx, b.ty + 3)] === reg);
    for (const st of m.starts) {
      const near = type => { let c = 0; for (let y = st.y - 14; y <= st.y + 14; y++) for (let x = st.x - 14; x <= st.x + 14; x++) if (BF.inBounds(x, y) && m.node[BF.idx(x, y)] === type) c++; return c; };
      const r = [near(BF.N_BERRY), near(BF.N_GOLD), near(BF.N_STONE), near(BF.N_TREE)];
      if (r[0] < 4 || r[1] < 4 || r[2] < 3 || r[3] < 20) { okRes = false; detail.push({ n, seed: seed * 13, r }); }
    }
  }
  check('3–4 pemain: tiap pemain punya Balai Kota, pekerja awal, sudut & warna berbeda', okStart);
  check('3–4 pemain: semua markas terhubung lewat darat', okLink);
  check('3–4 pemain: beri, emas, batu, pohon tersedia di dekat tiap markas', okRes, detail.slice(0, 3));
  {
    const s = BF.newGame({ seed: 8, players: 4 }), h = BF.newGame({ seed: 8, players: 4, human: 2 });
    check('tanpa opsi ai: semua selain pemain manusia dipegang AI', s.players.map(p => +p.isAI).join('') === '0111' && h.players.map(p => +p.isAI).join('') === '1101');
  }

  // pemain tumbang: miliknya musnah, permainan berlanjut sampai tinggal satu
  {
    const s = BF.newGame({ seed: 21, players: 3, ai: [false, false, false] });
    const sp = BF.spawnUnit(s, 'spear', 2, s.map.starts[2].x + 4.5, s.map.starts[2].y + 4.5), w2 = s.units.filter(u => u.owner === 2).length;
    raze(s, 2);
    run(s, 21);
    const ev = s.events;      // (run mengosongkan events; cek lewat keadaan)
    check('pemain tanpa bangunan utama tumbang, permainan berlanjut', s.players[2].out === true && !s.over && !s.players[0].out && !s.players[1].out);
    check('seluruh unit & bangunan pemain tumbang musnah', w2 > 3 && s.units.every(u => u.owner !== 2) && s.buildings.every(b => b.owner !== 2) && sp.dead, { sisa: s.units.filter(u => u.owner === 2).length });
    check('musnah karena tumbang tidak dihitung kalah tempur', s.players[2].stat.lostU === 0);
    const w0 = s.units.find(u => u.owner === 0), th2 = s.map.starts[2];
    BF.exec(s, 2, { c: 'move', ids: [w0.id], x: 50, y: 50 });
    const res2 = JSON.stringify(s.players[2].res);
    BF.exec(s, 2, { c: 'place', type: 'house', tx: th2.x + 4, ty: th2.y + 4, ids: [] });
    check('perintah dari pemain tumbang diabaikan', w0.order.type !== 'move' && s.buildings.every(b => b.owner !== 2) && JSON.stringify(s.players[2].res) === res2);
    raze(s, 1);
    run(s, 21);
    check('tinggal satu pemain → permainan selesai, ia menang', s.over && s.winner === 0 && s.players[1].out && !s.players[0].out);
  }
  {
    // peristiwa: 'defeat' saat tumbang (permainan lanjut), 'over' saat selesai
    const s = BF.newGame({ seed: 22, players: 4, ai: [false, false, false, false] });
    raze(s, 3);
    for (let i = 0; i < 21; i++) BF.step(s);
    const d = s.events.filter(e => e.type === 'defeat'), o = s.events.filter(e => e.type === 'over');
    check("peristiwa 'defeat' untuk pemain tumbang, belum 'over'", d.length === 1 && d[0].pid === 3 && d[0].resigned === false && o.length === 0, d);
    s.events.length = 0;
    BF.resign(s, 1);
    const d2 = s.events.filter(e => e.type === 'defeat');
    check('menyerah dengan 3 pemain tersisa: tumbang, permainan lanjut', s.players[1].out && !s.over && d2.length === 1 && d2[0].pid === 1 && d2[0].resigned === true && s.units.every(u => u.owner !== 1 || u.dead));
    BF.resign(s, 1);
    check('menyerah dua kali tidak berpengaruh', s.events.filter(e => e.type === 'defeat').length === 1);
    s.events.length = 0;
    BF.resign(s, 0);
    const o2 = s.events.filter(e => e.type === 'over');
    check('menyerah saat tinggal dua: selesai, pemain terakhir menang', s.over && s.winner === 2 && o2.length === 1 && o2[0].resigned === 0 && o2[0].winner === 2);
  }
  {
    const s = BF.newGame({ seed: 23, players: 3, ai: [false, false, false] });
    for (const p of s.players) raze(s, p.id);
    run(s, 21);
    check('semua tumbang bersamaan → selesai tanpa pemenang', s.over && s.winner === -1);
    const d = BF.newGame({ seed: 23, factions: ['bara', 'rimba'], ai: [false, false] });
    BF.resign(d, 1);
    const o = d.events.filter(e => e.type === 'over');
    check('dua pemain: menyerah tetap langsung selesai (tanpa pemusnahan)', d.over && d.winner === 0 && o.length === 1 && o[0].resigned === 1 && d.units.some(u => u.owner === 1) && d.events.every(e => e.type !== 'defeat'));
  }

  // AI: tiap AI menghadap musuh terdekat; AI pemain tumbang berhenti berpikir
  {
    const s = BF.newGame({ seed: 24, players: 4, ai: [true, true, true, true], difficulty: 'normal' });
    run(s, 60);
    const st = s.map.starts;
    const okDir = s.players.every(p => {
      let best = -1, bd = 1e9;
      for (const q of s.players) if (q !== p) { const d = BF.dist(st[q.id].x - st[p.id].x, st[q.id].y - st[p.id].y); if (d < bd - 1) { bd = d; best = q.id; } }
      const vx = st[best].x - st[p.id].x, vy = st[best].y - st[p.id].y, l = BF.dist(vx, vy);
      // dua tetangga sama jauh (sudut bersebelahan): arah hadap harus menuju salah satunya, bukan sudut seberang (diagonal)
      return p.ai && Math.abs(p.ai.dirX) + Math.abs(p.ai.dirY) > 0.9 && Math.abs(Math.abs(p.ai.dirX) - Math.abs(p.ai.dirY)) > 0.5;
    });
    check('4 AI: tiap AI menghadap markas tetangga (bukan sudut seberang)', okDir, s.players.map(p => p.ai && [+p.ai.dirX.toFixed(2), +p.ai.dirY.toFixed(2)]));
  }

  // pertandingan penuh 3 dan 4 AI: selesai dengan satu pemenang, simpan/muat di tengah jalan tetap identik
  for (const [n, seed, diff] of [[3, 3, 'hard'], [4, 5, 'normal']]) {
    const s = BF.newGame({ seed, players: n, ai: [true, true, true, true].slice(0, n), difficulty: diff });
    run(s, 20 * 60 * 10);
    const b = BF.deserialize(JSON.parse(JSON.stringify(BF.serialize(s))));
    let same = BF.hash(s) === BF.hash(b) && b.players.length === n;
    for (let i = 0; i < 20 * 60 * 4 && same && !s.over; i++) { BF.step(s); BF.step(b); s.events.length = b.events.length = 0; if (i % 200 === 0) same = BF.hash(s) === BF.hash(b); }
    check(n + ' AI: simpan/muat di menit 10 lalu lanjut 4 menit tetap identik', same && BF.hash(s) === BF.hash(b), { tick: s.tick });
    const t0 = Date.now();
    run(s, 20 * 60 * 120);
    const w = s.players[s.winner];
    check(n + ' AI semua lawan semua selesai dengan satu pemenang', s.over && !!w && !w.out && s.players.filter(p => !p.out).length === 1 && sane(s) && s.units.every(u => !s.players[u.owner].out) && s.hist.every(r => r.length === n),
      { pemenang: w && w.faction, menit: (s.tick / 1200).toFixed(0), tumbang: s.players.filter(p => p.out).length, msPerTick: ((Date.now() - t0) / Math.max(1, s.tick - 16800)).toFixed(2), unitMaks: s.units.length });
  }
}

// 16. Tabib (penyembuh): dilatih di Balai Kota mulai Era Baja, memulihkan unit sendiri, sikap, perintah, AI
{
  const mk = () => { const s = BF.newGame({ seed: 4202, ai: [false, false], factions: ['padang', 'bara'] }); s.animals.length = 0; for (const p of s.players) { p.era = 1; p.popCap = 60; } return s; };
  const base = s => { const th = s.buildings.find(b => b.owner === 0 && b.type === 'townhall'); return { th, x: th.tx + 1.5, y: th.ty + 6.5 }; };
  const put = (s, type, owner, x, y, hp) => { const f = BF.findFreeNear(s.map, Math.round(x), Math.round(y), 4, owner), u = BF.spawnUnit(s, type, owner, f.x + 0.5, f.y + 0.5); if (hp !== undefined) u.hp = hp; return u; };

  {
    const s = mk(), { th } = base(s), p = s.players[0];
    p.era = 0; p.res.food = p.res.gold = 500;
    BF.exec(s, 0, { c: 'train', bid: th.id, unit: 'healer' });
    const early = th.queue.length;
    p.era = 1;
    BF.exec(s, 0, { c: 'train', bid: th.id, unit: 'healer' });
    check('Tabib dilatih di Balai Kota mulai Era Baja, biaya dipotong', early === 0 && th.queue.length === 1 && p.res.food === 500 - BF.UNITS.healer.cost.food && p.res.gold === 500 - BF.UNITS.healer.cost.gold, { early, antre: th.queue.length });
    run(s, 20 * (BF.UNITS.healer.time + 2));
    const h = s.units.find(u => u.owner === 0 && u.type === 'healer');
    check('Tabib selesai dilatih: tak bersenjata, bisa berlindung', !!h && BF.unitDef(s, h).atk === 0 && BF.unitDef(s, h).heal > 0 && BF.canGarrison(s, h, th));
  }
  {
    // menyembuhkan sendiri unit terluka di dekatnya dengan laju BF.UNITS.healer.heal nyawa/detik, berhenti saat penuh
    const s = mk(), { x, y } = base(s), h = put(s, 'healer', 0, x, y), sp = put(s, 'spear', 0, x + 1.5, y, 20), full = BF.unitDef(s, sp).hp;
    run(s, 20 * 3);
    const gain = sp.hp - 20, rate = BF.UNITS.healer.heal;
    check('Tabib menganggur memulihkan unit terluka (laju sesuai definisi)', gain > rate * 2.3 && gain <= rate * 3.01 && h.order.type === 'heal' && h.working === true, { gain: +gain.toFixed(1), lajuPerDetik: rate });
    run(s, 20 * 14);
    check('berhenti saat nyawa penuh (tidak melebihi)', sp.hp === full && h.order.type === 'idle' && !h.working, { hp: sp.hp });
  }
  {
    // yang tidak disembuhkan: musuh, mesin kepung, dirinya sendiri; tabib lain disembuhkan
    const s = mk(), { x, y } = base(s), h = put(s, 'healer', 0, x, y, 10), foe = put(s, 'spear', 1, x + 1.5, y, 20), cat = put(s, 'catapult', 0, x, y + 1.5, 30);
    foe.stance = 2;
    run(s, 20 * 3);
    check('musuh, mesin kepung, dan dirinya sendiri tidak disembuhkan', foe.hp <= 20 && cat.hp === 30 && h.hp === 10 && h.order.type === 'idle');
    const h2 = put(s, 'healer', 0, x - 1.5, y);
    run(s, 20 * 2);
    check('Tabib menyembuhkan Tabib lain', h.hp > 15 && h2.order.type === 'heal');
  }
  {
    const s = mk(), { x, y } = base(s), h = put(s, 'healer', 0, x, y), a = put(s, 'spear', 0, x + 1.5, y, 40), b = put(s, 'sword', 0, x - 1.5, y, 12);
    run(s, 10);
    check('mendahulukan yang paling parah lukanya', h.order.type === 'heal' && h.order.tid === b.id, { tid: h.order.tid, a: a.id, b: b.id });
  }
  {
    // sikap: Agresif mendatangi yang terluka dalam jarak pandang; Bertahan hanya yang terjangkau; Diam hanya atas perintah
    const far = st => { const s = mk(), { x, y } = base(s), h = put(s, 'healer', 0, x, y), sp = put(s, 'spear', 0, x + 5, y, 20); h.stance = st; const x0 = h.x, y0 = h.y; run(s, 20 * 6); return { s, h, sp, moved: BF.dist(h.x - x0, h.y - y0) }; };
    const ag = far(0), df = far(1), dm = far(2);
    check('Agresif: mendatangi unit terluka di luar jangkauan, lalu menyembuhkan', ag.moved > 1.5 && ag.sp.hp > 25, { geser: +ag.moved.toFixed(1), hp: +ag.sp.hp.toFixed(1) });
    check('Bertahan: tidak beranjak untuk yang di luar jangkauan', df.moved < 0.3 && df.sp.hp === 20, { geser: +df.moved.toFixed(1) });
    check('Diam: tidak menyembuhkan tanpa perintah', dm.moved < 0.3 && dm.sp.hp === 20 && dm.h.order.type === 'idle');
    BF.exec(dm.s, 0, { c: 'heal', ids: [dm.h.id], tid: dm.sp.id });
    run(dm.s, 20 * 6);
    check('perintah menyembuhkan: Tabib mengikuti sasaran sampai terjangkau', dm.sp.hp > 25 && dm.h.order.type === 'heal', { hp: +dm.sp.hp.toFixed(1) });
  }
  {
    // validasi perintah
    const s = mk(), { x, y } = base(s), h = put(s, 'healer', 0, x, y), sp = put(s, 'spear', 0, x + 5, y, 20), foe = put(s, 'spear', 1, x, y + 5, 20), cat = put(s, 'catapult', 0, x - 4, y, 30);
    h.stance = 2; foe.stance = 2;
    BF.exec(s, 1, { c: 'heal', ids: [h.id], tid: sp.id });
    const a = h.order.type;
    BF.exec(s, 0, { c: 'heal', ids: [h.id], tid: foe.id });
    const b = h.order.type;
    BF.exec(s, 0, { c: 'heal', ids: [h.id], tid: cat.id });
    BF.exec(s, 0, { c: 'heal', ids: [h.id], tid: h.id });
    BF.exec(s, 0, { c: 'heal', ids: [h.id], tid: 999999 });
    BF.exec(s, 0, { c: 'heal', ids: [h.id] });
    const c2 = h.order.type;
    BF.exec(s, 0, { c: 'heal', ids: [sp.id], tid: h.id });
    check('perintah menyembuhkan tervalidasi (lawan, musuh, mesin kepung, diri sendiri, id rusak, bukan Tabib)', a === 'idle' && b === 'idle' && c2 === 'idle' && sp.order.type === 'idle');
    BF.exec(s, 0, { c: 'heal', ids: [h.id], tid: sp.id });
    run(s, 20 * 4);
    const json = JSON.stringify(BF.serialize(s)), s2 = BF.deserialize(JSON.parse(json));
    let same = BF.hash(s) === BF.hash(s2);
    for (let i = 0; i < 20 * 6 && same; i++) { BF.step(s); BF.step(s2); s.events.length = s2.events.length = 0; same = BF.hash(s) === BF.hash(s2); }
    check('menyembuhkan ikut tersimpan (lanjut setelah muat identik)', same && sp.hp > 25, { hp: +sp.hp.toFixed(1) });
    // sasaran berlindung → Tabib berhenti
    const th = s.buildings.find(q => q.owner === 0 && q.type === 'townhall');
    sp.hp = 10;
    BF.exec(s, 0, { c: 'heal', ids: [h.id], tid: sp.id });
    BF.exec(s, 0, { c: 'garrison', ids: [sp.id], bid: th.id });
    run(s, 20 * 20);
    check('sasaran masuk berlindung → Tabib berhenti mengikuti', th.inside.indexOf(sp) >= 0 && h.order.type === 'idle');
  }
  {
    // AI: melatih Tabib bila pasukan cukup besar; Tabib tidak ikut menyerbu sasaran, melainkan mengikuti pasukan
    const mkAI = diff => { const s = tanpaUnitAwal(BF.newGame({ seed: 4202, ai: [false, true], difficulty: diff, factions: ['padang', 'bara'] })); s.animals.length = 0; const q = s.players[1]; q.era = 1; q.popCap = 70; q.res = { food: 2000, wood: 2000, gold: 2000, stone: 2000 }; return s; };
    const ring = (s, cx, cy, type, n) => { const out = []; for (let i = 0; i < n; i++) out.push(put(s, type, 1, cx + (i % 4) - 1.5, cy + ((i / 4) | 0))); return out; };
    const trains = diff => { const s = mkAI(diff), th = s.buildings.find(b => b.owner === 1 && b.type === 'townhall'); ring(s, th.tx + 1, th.ty + 6, 'spear', 9); run(s, 20 * 40); return s.units.filter(u => u.owner === 1 && u.type === 'healer').length + th.queue.filter(q => q.unit === 'healer').length; };
    const n1 = trains('normal'), n0 = trains('easy');
    check('AI Sedang melatih Tabib untuk pasukannya; AI Mudah tidak', n1 >= 1 && n1 <= 2 && n0 === 0, { sedang: n1, mudah: n0 });
    const s = mkAI('normal'), q = s.players[1], th = s.buildings.find(b => b.owner === 1 && b.type === 'townhall');
    const army = ring(s, th.tx + 1, th.ty + 6, 'spear', 8), med = put(s, 'healer', 1, th.tx + 1, th.ty + 9);
    q.ai = { state: 'attack', waveSize: 8, sent: 8, target: 0, rebalT: 0, dirX: 0, dirY: 0 };
    run(s, BF.DIFF.normal.think + 2);
    const tgt = s.byId.get(q.ai.target), tx = tgt.tx + tgt.size / 2, ty = tgt.ty + tgt.size / 2;
    check('AI menyerang: Tabib tidak dihitung sebagai pasukan & tidak disuruh ke sasaran', army.every(u => u.order.type === 'amove') && q.ai.sent === 8 && (med.order.type === 'idle' || (med.order.type === 'move' && BF.dist(med.order.x - tx, med.order.y - ty) > 12)), { tabib: med.order.type });
    army[0].hp = 10;
    run(s, 20 * 12);
    check('Tabib AI mengikuti pasukan dan memulihkan yang terluka di jalan', army[0].hp > 14 || BF.dist(med.x - army[0].x, med.y - army[0].y) < 8, { hp: +army[0].hp.toFixed(1), jarak: +BF.dist(med.x - army[0].x, med.y - army[0].y).toFixed(1) });
  }
}

// 17. Unit awal: tiap pemain memulai dengan seorang Penunggang Kuda; populasi awal masih menyisakan tempat
{
  for (const n of [2, 4]) {
    const s = BF.newGame({ seed: 61 + n, players: n }), okAll = s.players.every(p => {
      const mine = s.units.filter(u => u.owner === p.id), riders = mine.filter(u => u.type === 'rider'), th = s.buildings.find(b => b.owner === p.id && b.type === 'townhall');
      return mine.length === BF.START_WORKERS + 1 && riders.length === 1 && BF.dist(riders[0].x - th.tx - 1.5, riders[0].y - th.ty - 1.5) < 6 &&
        BF.passable(s.map, Math.floor(riders[0].x), Math.floor(riders[0].y), p.id) && p.pop === BF.START_WORKERS + 1 && p.popCap === 6;
    });
    check(n + ' pemain: tiap pemain mulai dengan 4 pekerja + 1 Penunggang Kuda di dekat Balai Kota, populasi 5/6', okAll, s.players.map(p => p.pop + '/' + p.popCap));
  }
  const s = BF.newGame({ seed: 63, ai: [false, false], factions: ['bara', 'rimba'] }), p = s.players[0], th = s.buildings.find(b => b.owner === 0), r = s.units.find(u => u.owner === 0 && u.type === 'rider');
  BF.exec(s, 0, { c: 'train', bid: th.id, unit: 'worker' });
  check('pekerja pertama langsung bisa dilatih (masih ada tempat populasi)', th.queue.length === 1);
  BF.exec(s, 0, { c: 'move', ids: [r.id], x: r.x + 6, y: r.y + 3 });
  const x0 = r.x;
  run(s, 20 * 2);
  check('Penunggang Kuda awal bisa diperintah sejak Era Perintis dan bergerak secepat kuda', r.order.type === 'move' && Math.abs(r.x - x0) > 2.5 && p.era === 0 && BF.unitDef(s, r).era === 1, { geser: +(r.x - x0).toFixed(1) });
  BF.exec(s, 0, { c: 'train', bid: th.id, unit: 'rider' });
  check('melatih Penunggang Kuda tetap butuh Era Baja dan Kandang', th.queue.every(q => q.unit !== 'rider'));
}

console.log(`\nHASIL: ${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
