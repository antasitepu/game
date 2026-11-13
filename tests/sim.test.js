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

console.log(`\nHASIL: ${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
