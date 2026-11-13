'use strict';
// Layar sentuh di ukuran ponsel mendatar (844×390): tata letak ringkas, ketuk (pilih / perintah), tekan lama, seret
// (geser kamera), kotak seleksi, cubit & puntir dua jari, menempatkan bangunan, minimap, dan petunjuk memutar perangkat.
const H = require('../helpers');
const { sleep } = require('../cdp');

module.exports = async ({ blank, check, url }) => {
  const p = await blank();
  await p.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
  await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await p.send('Page.navigate', { url });
  for (let i = 0; i < 100 && !(await p.ev('!!(window.BF && BF.game && BF.game.ready)').catch(() => false)); i++) await sleep(100);
  const T = (type, pts) => p.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: Math.round(q.x), y: Math.round(q.y), id: i })) });
  const tap = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(140); };
  // hold: lama menahan sebelum mulai menyeret (≥ 350 ms = tekan lama)
  const drag = async (x0, y0, x1, y1, hold) => { await T('touchStart', [{ x: x0, y: y0 }]); await sleep(hold || 30); for (let k = 1; k <= 6; k++) { await T('touchMove', [{ x: x0 + (x1 - x0) * k / 6, y: y0 + (y1 - y0) * k / 6 }]); await sleep(25); } await T('touchEnd', []); await sleep(140); };
  const two = async (a0, b0, a1, b1) => { await T('touchStart', [a0]); await T('touchStart', [a0, b0]); for (let k = 1; k <= 8; k++) { const f = k / 8; await T('touchMove', [{ x: a0.x + (a1.x - a0.x) * f, y: a0.y + (a1.y - a0.y) * f }, { x: b0.x + (b1.x - b0.x) * f, y: b0.y + (b1.y - b0.y) * f }]); await sleep(25); } await T('touchEnd', []); await sleep(140); };
  const sel = () => p.ev(`BF.ui.entities(BF.game.s).map(e => e.type)`);
  const cam = () => p.ev(`({ x: BF.game.cam.x, y: BF.game.cam.y, zoom: BF.game.cam.zoom, yaw: BF.game.cam.yaw })`);
  const world = (x, y) => p.ev(`(() => { BF.view.update(); return BF.view.toWorld(${x}, ${y}); })()`);

  await p.ev(`document.getElementById('btn-start').click()`);
  for (let i = 0; i < 40 && !(await p.ev('BF.game.running')); i++) await sleep(100);
  await p.ev(`(() => { const s = BF.game.s; s.players[1].isAI = false; s.animals.length = 0; })()`);
  await sleep(400);

  // ---- tata letak ringkas
  const lay = await p.ev(`(() => { const r = id => document.getElementById(id).getBoundingClientRect(), cs = getComputedStyle(document.getElementById('bottom')); return { inset: BF.ui.inset, top: r('topbar').height, mm: r('minimap').width, cmd: document.querySelector('#cmds .cmd').getBoundingClientRect().width, latar: cs.backgroundImage, putar: getComputedStyle(document.getElementById('rotate')).display, kasar: matchMedia('(pointer: coarse)').matches, mutu: BF.gfx.quality, jeda: getComputedStyle(document.getElementById('btn-pause')).display, kunci: getComputedStyle(document.querySelector('.key') || document.body).display }; })()`);
  check('ponsel mendatar: HUD ringkas (bar atas 32 px, minimap 112 px, tombol 46 px) melayang di atas peta', lay.top === 32 && lay.mm === 112 && lay.cmd === 46 && lay.latar === 'none' && lay.inset.top === 32 && lay.inset.bottom < 100 && lay.putar === 'none', lay);
  check('perangkat sentuh: mode Hemat, tombol jeda disembunyikan', lay.kasar && lay.mutu === 'hemat' && lay.jeda === 'none', lay);
  await p.shot('90-ponsel-awal');

  // ---- ketuk: pilih; tekan lama: semua yang sejenis
  const w0 = await p.ev(`BF.game.s.units.find(u => u.owner === 0 && u.type === 'worker').id`);
  let pt = await p.ev(H.unitPoint(String(w0)));
  await tap(pt.x, pt.y);
  check('ketuk unit sendiri → terpilih (tanpa klik tiruan yang membatalkannya)', (await sel()).join() === 'worker' && await p.ev(`document.body.classList.contains('sentuh')`), await sel());
  check('tombol ✕ muncul setelah layar disentuh', await p.ev(`getComputedStyle(document.getElementById('btn-desel')).display !== 'none'`));
  await drag(pt.x, pt.y, pt.x, pt.y, 480);
  check('tekan lama pada unit → semua yang sejenis di layar terpilih', (await sel()).join() === 'worker,worker,worker,worker', await sel());

  // ---- ketuk dengan unit terpilih = perintah
  const berry = await p.ev(H.node('BF.N_BERRY', 0));
  await tap(berry.x, berry.y);
  check('ketuk semak beri → pekerja mengumpulkan pangan', (await p.ev(`BF.game.s.units.filter(u => u.owner === 0 && u.order.type === 'gather' && u.order.res === 'food').length`)) === 4);
  const lahan = await p.ev(`(() => { const s = BF.game.s, th = s.buildings[0]; for (let r = 4; r < 9; r++) for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [r, r]]) { const x = th.tx + 1 + dx, y = th.ty + 1 + dy; if (!BF.inBounds(x, y) || !BF.passable(s.map, x, y, 0) || s.map.node[BF.idx(x, y)]) continue; const q = BF.view.toScreen(x + 0.5, y + 0.5, 0); if (q.x > 150 && q.x < 620 && q.y > 50 && q.y < 300 && !BF.view.pickStanding(s, q.x, q.y)) return q; } return null; })()`);
  await tap(lahan.x, lahan.y);
  check('ketuk lahan kosong → pekerja bergerak ke sana', (await p.ev(`BF.game.s.units.filter(u => u.owner === 0 && u.order.type === 'move').length`)) === 4, lahan);
  const roof = await p.ev(`(() => { const b = BF.game.s.buildings[0]; return BF.view.toScreen(b.tx + 1.5, b.ty + 1.5, BF.view.BUILD_H.townhall * 0.8); })()`);
  await tap(roof.x, roof.y);
  check('ketuk bangunan sendiri yang utuh → bangunan itu terpilih (bukan perintah)', (await sel()).join() === 'townhall', await sel());
  await tap(lahan.x, lahan.y);
  check('bangunan terpilih + ketuk lahan → titik kumpul', await p.ev(`(() => { const b = BF.game.s.buildings[0]; return !!b.rally && BF.ui.sel[0] === b.id; })()`));
  await p.clickEl('#btn-desel');
  await sleep(120);
  check('tombol ✕ membatalkan pilihan', (await sel()).length === 0);

  // ---- seret satu jari: kamera bergeser, tanah mengikuti jari
  let c0 = await cam();
  const g0 = await world(420, 200);
  await drag(420, 200, 300, 140);
  let c1 = await cam();
  const g1 = await world(300, 140);
  check('seret satu jari menggeser kamera; titik tanah mengikuti jari', Math.hypot(c1.x - c0.x, c1.y - c0.y) > 1.5 && Math.hypot(g1.x - g0.x, g1.y - g0.y) < 0.6 && (await sel()).length === 0, { geser: +Math.hypot(c1.x - c0.x, c1.y - c0.y).toFixed(2), selisihTanah: +Math.hypot(g1.x - g0.x, g1.y - g0.y).toFixed(2) });
  await drag(300, 140, 420, 200);

  // ---- tekan lama lalu seret: kotak seleksi
  const box = await p.ev(H.workersBox(0));
  await drag(box.x0, box.y0, box.x1, box.y1, 480);
  check('tekan lama lalu seret → kotak seleksi memilih para pekerja', (await sel()).filter(t => t === 'worker').length >= 3 && Math.hypot((await cam()).x - c0.x, (await cam()).y - c0.y) < 0.5, await sel());

  // ---- dua jari: cubit = zoom, puntir = putar, titik tengah tetap di tempat
  c0 = await cam();
  const mid0 = await world(400, 180);
  await two({ x: 360, y: 180 }, { x: 440, y: 180 }, { x: 300, y: 180 }, { x: 500, y: 180 });
  c1 = await cam();
  const mid1 = await world(400, 180);
  check('cubit membuka → zoom mendekat, titik tengah tetap', c1.zoom < c0.zoom * 0.7 && Math.hypot(mid1.x - mid0.x, mid1.y - mid0.y) < 0.6 && Math.abs(c1.yaw - c0.yaw) < 0.05, { zoom: [+c0.zoom.toFixed(1), +c1.zoom.toFixed(1)], selisih: +Math.hypot(mid1.x - mid0.x, mid1.y - mid0.y).toFixed(2) });
  await two({ x: 300, y: 180 }, { x: 500, y: 180 }, { x: 360, y: 180 }, { x: 440, y: 180 });
  const c2 = await cam();
  check('cubit menutup → zoom menjauh', c2.zoom > c1.zoom * 1.3, [+c1.zoom.toFixed(1), +c2.zoom.toFixed(1)]);
  // puntir 40° searah jarum jam mengelilingi (400,180): titik tanah di bawah jari pertama harus ikut jari itu
  const A0 = { x: 320, y: 180 }, B0 = { x: 480, y: 180 }, ang = 40 * Math.PI / 180, rot = q => ({ x: 400 + (q.x - 400) * Math.cos(ang) - (q.y - 180) * Math.sin(ang), y: 180 + (q.x - 400) * Math.sin(ang) + (q.y - 180) * Math.cos(ang) });
  const gA = await world(A0.x, A0.y);
  await two(A0, B0, rot(A0), rot(B0));
  const c3 = await cam(), gA1 = await world(rot(A0).x, rot(A0).y);
  check('puntir dua jari memutar kamera; tanah mengikuti jari', Math.abs(Math.abs(c3.yaw - c2.yaw) - ang) < 0.15 && Math.hypot(gA1.x - gA.x, gA1.y - gA.y) < 1.2, { putar: +(c3.yaw - c2.yaw).toFixed(2), selisihTanah: +Math.hypot(gA1.x - gA.x, gA1.y - gA.y).toFixed(2) });
  check('gerakan dua jari tidak memilih atau memerintah apa pun', (await sel()).filter(t => t === 'worker').length >= 3 && (await p.ev(`BF.game.s.units.filter(u => u.owner === 0 && u.order.type === 'move').length`)) <= 4);
  await p.ev(`(() => { const th = BF.game.s.buildings[0]; BF.game.cam.yaw = BF.view.YAW_DEFAULT; BF.game.cam.zoom = BF.view.ZOOM_DEFAULT; BF.input.centerOn(th.tx + 1.5, th.ty + 1.5); })()`);
  await sleep(250);

  // ---- menempatkan bangunan: tombol, lalu sentuh-seret-lepas di lahan yang sah; tekan tombolnya lagi = batal
  await p.ev(`BF.ui.select(BF.game.s.units.filter(u => u.owner === 0 && u.type === 'worker').map(u => u.id))`);
  await sleep(250);
  await p.clickEl('#cmds .cmd:nth-child(1)');
  await sleep(150);
  check('tombol bangun menyalakan mode penempatan', await p.ev(`BF.ui.placing === 'house'`));
  await p.clickEl('#cmds .cmd:nth-child(1)');
  await sleep(150);
  check('menekan tombol yang menyala lagi membatalkannya', await p.ev(`BF.ui.placing === null`));
  await p.clickEl('#cmds .cmd:nth-child(1)');
  await sleep(150);
  const spot = (await p.ev(H.spots('house', 0, 1)))[0];
  const nb = await p.ev(`BF.game.s.buildings.length`);
  await drag(spot.x - 60, spot.y - 30, spot.x, spot.y);
  check('sentuh, seret ke lahan yang sah, lepas → bangunan ditempatkan', (await p.ev(`BF.game.s.buildings.length`)) === nb + 1 && await p.ev(`BF.ui.placing === null && BF.game.s.buildings.some(b => b.type === 'house' && b.owner === 0)`), { sebelum: nb, sesudah: await p.ev(`BF.game.s.buildings.length`) });

  // ---- ketuk musuh dengan prajurit terpilih = serang
  const ids = await p.ev(`(() => { const s = BF.game.s, th = s.buildings[0], a = BF.findFreeNear(s.map, th.tx - 3, th.ty + 4, 6), me = BF.spawnUnit(s, 'spear', 0, a.x + 0.5, a.y + 0.5), b = BF.findFreeNear(s.map, a.x - 3, a.y + 1, 6), foe = BF.spawnUnit(s, 'worker', 1, b.x + 0.5, b.y + 0.5); BF.updateFog(s); BF.input.centerOn(a.x, a.y); return { me: me.id, foe: foe.id }; })()`);
  await sleep(300);
  pt = await p.ev(H.unitPoint(String(ids.me)));
  await tap(pt.x, pt.y);
  pt = await p.ev(H.unitPoint(String(ids.foe)));
  await tap(pt.x, pt.y);
  check('ketuk musuh dengan prajurit terpilih → perintah serang', await p.ev(`(() => { const o = BF.game.s.byId.get(${ids.me}).order; return o.type === 'attack' && o.tid === ${ids.foe}; })()`), await p.ev(`BF.game.s.byId.get(${ids.me}).order.type`));

  // ---- minimap
  c0 = await cam();
  const mm = await p.ev(H.minimapPoint('48', '48'));
  await tap(mm.x, mm.y);
  c1 = await cam();
  check('sentuh minimap → kamera pindah ke sana', Math.hypot(c1.x - c0.x, c1.y - c0.y) > 10, { dari: [+c0.x.toFixed(0), +c0.y.toFixed(0)], ke: [+c1.x.toFixed(0), +c1.y.toFixed(0)] });
  await p.shot('91-ponsel-main');

  // ---- dipegang tegak: petunjuk memutar perangkat
  await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(300);
  check('ponsel dipegang tegak → petunjuk memutar perangkat', (await p.ev(`getComputedStyle(document.getElementById('rotate')).display`)) === 'flex');
  check('tanpa galat halaman', p.errors.length === 0, p.errors.slice(0, 3));
};
