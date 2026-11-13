'use strict';
// Interaksi: klik ganda, grup, tapak tidak valid, shift-letakkan, ladang, serang, jeda, hapus, kecepatan, geser kamera.
const H = require('../helpers');

module.exports = async ({ page, check }) => {
  const p = await page();
  const step = n => p.ev(`(() => { const s = BF.game.s; for (let i = 0; i < ${n}; i++) BF.step(s); })()`);
  await p.clickEl('#btn-start');
  await p.sleep(400);

  const w0 = await p.ev(H.unitPoint(`BF.game.s.units.find(u => u.owner === 0).id`));
  await p.click(w0.x, w0.y);
  await p.sleep(60);
  check('klik pada badan unit memilih 1 unit', (await p.ev(`BF.ui.sel.length`)) === 1);
  await p.click(w0.x, w0.y);
  await p.sleep(100);
  check('klik ganda memilih semua pekerja di layar', (await p.ev(`BF.ui.sel.length`)) === 4);

  await p.key('1', 'Digit1', 49, 2);          // Ctrl+1
  await p.key('Escape', 'Escape', 27);
  await p.sleep(60);
  check('Esc mengosongkan pilihan', (await p.ev(`BF.ui.sel.length`)) === 0);
  await p.key('1', 'Digit1', 49);
  await p.sleep(60);
  check('grup 1 dipanggil kembali', (await p.ev(`BF.ui.sel.length`)) === 4);

  // klik pada atap bangunan (bukan tapaknya) tetap memilih bangunan itu
  const roof = await p.ev(`(() => { const b = BF.game.s.buildings[0]; return BF.view.toScreen(b.tx + 1.5, b.ty + 1.5, BF.view.BUILD_H.townhall * 0.8); })()`);
  await p.click(roof.x, roof.y);
  await p.sleep(80);
  check('klik pada atap Balai Kota memilih bangunannya', await p.ev(`BF.ui.sel.length === 1 && BF.ui.entities(BF.game.s)[0].type === 'townhall'`));
  await p.key('1', 'Digit1', 49);

  // tapak tidak valid: Rumah di atas Balai Kota
  await p.key('q', 'KeyQ', 81);
  const th = await p.ev(`(() => { const b = BF.game.s.buildings[0]; return BF.view.toScreen(b.tx + 1.5, b.ty + 1.5); })()`);
  await p.mouse('mouseMoved', th.x, th.y);
  await p.sleep(120);
  check('ghost merah di tapak terisi', await p.ev(`BF.ui.ghosts.length === 1 && BF.ui.ghosts[0].ok === false`));
  await p.click(th.x, th.y);
  await p.sleep(100);
  check('penempatan ditolak + pesan', await p.ev(`BF.game.s.buildings.filter(b => b.owner === 0).length === 1 && document.getElementById('toast').textContent.includes('Tidak bisa')`));
  await p.key('Escape', 'Escape', 27);

  // shift + klik: dua Ladang berturut-turut (W)
  await p.key('w', 'KeyW', 87);
  const spots = await p.ev(H.spots('farm', 0, 2));
  check('ada 2 tapak ladang di layar', spots.length === 2);
  await p.click(spots[0].x, spots[0].y, 'left', { modifiers: 8 });
  await p.sleep(80);
  check('Shift menjaga mode penempatan', (await p.ev(`BF.ui.placing`)) === 'farm');
  await p.click(spots[1].x, spots[1].y, 'left');
  await p.sleep(80);
  check('2 ladang diletakkan, kayu 250 → 150', await p.ev(`BF.game.s.buildings.filter(b => b.type === 'farm').length === 2 && BF.game.s.players[0].res.wood === 150 && BF.ui.placing === null`));
  await step(20 * 45);
  await p.sleep(200);
  const farm = await p.ev(`(() => { const s = BF.game.s; return { built: s.buildings.filter(b => b.type === 'farm' && b.built).length, farmers: s.units.filter(u => u.order.type === 'gather' && u.order.farm).length }; })()`);
  check('kedua ladang jadi & otomatis digarap', farm.built === 2 && farm.farmers === 2, farm);

  await p.clickEl('#btn-idle');
  await p.sleep(100);
  check('tombol "pekerja menganggur" memilih pekerja idle', await p.ev(`BF.ui.sel.length === 1 && BF.ui.entities(BF.game.s)[0].order.type === 'idle'`));

  // perbaiki: rusakkan Balai Kota, klik kanan atapnya dengan pekerja terpilih
  await p.ev(`(() => { const s = BF.game.s, th = s.buildings.find(b => b.type === 'townhall' && b.owner === 0); th.hp = BF.bldDef(s, th).hp / 2; window.__rp = { id: th.id, hp: th.hp, wood: s.players[0].res.wood, w: BF.ui.sel[0] }; })()`);
  await p.ev(H.buildingPoint(`BF.game.s.byId.get(window.__rp.id)`, 0.6));
  const thPt = await p.ev(H.freePoint(`BF.game.s.byId.get(window.__rp.id)`));
  check('ada titik bebas di badan Balai Kota', !!thPt);
  await p.ev(`BF.ui.select([window.__rp.w])`);
  await p.click(thPt.x, thPt.y, 'right');
  await p.sleep(100);
  check('klik kanan bangunan rusak → perintah perbaiki', await p.ev(`(() => { const o = BF.game.s.byId.get(window.__rp.w).order; return o.type === 'repair' && o.bid === window.__rp.id; })()`));
  await step(20 * 15);
  check('perbaikan memulihkan nyawa & memakai kayu', await p.ev(`(() => { const s = BF.game.s, th = s.byId.get(window.__rp.id); return th.hp > window.__rp.hp + 100 && s.players[0].res.wood < window.__rp.wood; })()`), await p.ev(`({ hp: Math.round(BF.game.s.byId.get(window.__rp.id).hp), kayu: BF.game.s.players[0].res.wood })`));

  // berlindung: G lalu klik Balai Kota → pekerja masuk; G pada bangunan → keluar; Alt + klik kanan → berlindung
  // (pekerja yang berdiri di samping bangunan langsung masuk, jadi "sedang menuju" dan "sudah di dalam" sama-sama sah)
  const TH = 'BF.game.s.byId.get(window.__rp.id)';
  const going = `(() => { const u = BF.game.s.byId.get(window.__rp.w); return !BF.ui.garrison && (u ? u.order.type === 'garrison' && u.order.bid === window.__rp.id : ${TH}.inside.some(q => q.id === window.__rp.w)); })()`;
  await p.ev(`BF.ui.select([window.__rp.w])`);
  await p.key('g', 'KeyG', 71);
  await p.sleep(80);
  check('G menyalakan mode berlindung', await p.ev(`BF.ui.garrison === true`));
  let gp = await p.ev(H.freePoint(TH));
  await p.click(gp.x, gp.y);
  await p.sleep(100);
  check('klik Balai Kota → perintah berlindung', await p.ev(going));
  await step(20 * 8);
  await p.ev(`BF.ui.select([window.__rp.id])`);
  await p.sleep(400);
  check('pekerja masuk & panel menampilkan 1/10', await p.ev(`${TH}.inside.length === 1 && !BF.game.s.byId.has(window.__rp.w) && document.getElementById('info-body').textContent.includes('Berlindung: 1/10')`), await p.ev(`document.getElementById('info-body').textContent`));
  await p.shot('06-berlindung');
  await p.key('g', 'KeyG', 71);
  await p.sleep(200);
  check('G pada bangunan mengeluarkan semua', await p.ev(`${TH}.inside.length === 0 && BF.game.s.byId.has(window.__rp.w)`));
  await p.ev(`BF.ui.select([window.__rp.w])`);
  await p.sleep(150);
  gp = await p.ev(H.freePoint(TH));
  await p.click(gp.x, gp.y, 'right', { modifiers: 1 });
  await p.sleep(100);
  check('Alt + klik kanan → perintah berlindung', await p.ev(going));
  await step(20 * 4);
  await p.ev(`BF.exec(BF.game.s, 0, { c: 'ungarrison', bid: window.__rp.id })`);
  await p.sleep(150);
  await p.ev(`BF.ui.select([window.__rp.w])`);

  // serang: munculkan tombak milik pemain dan satu musuh pasif, lalu klik kanan musuh
  await p.ev(`(() => { const s = BF.game.s, th = s.buildings[0]; s.players[1].isAI = false; const a = BF.findFreeNear(s.map, th.tx + 5, th.ty + 5, 6); const me = BF.spawnUnit(s, 'spear', 0, a.x + 0.5, a.y + 0.5); const b = BF.findFreeNear(s.map, a.x + 3, a.y, 6); const foe = BF.spawnUnit(s, 'worker', 1, b.x + 0.5, b.y + 0.5); BF.updateFog(s); window.__t = { me: me.id, foe: foe.id }; BF.ui.select([me.id]); BF.input.centerOn(me.x, me.y); })()`);
  await p.sleep(150);
  const foe = await p.ev(H.unitPoint('window.__t.foe'));
  await p.click(foe.x, foe.y, 'right');
  await p.sleep(100);
  check('klik kanan musuh → perintah serang', await p.ev(`(() => { const o = BF.game.s.byId.get(window.__t.me).order; return o.type === 'attack' && o.tid === window.__t.foe; })()`));
  // prajurit tombak memakai model berkerangka dari aset: berlari ke sasaran, lalu klip tusukan tiap kali menyerang
  const anim = new Set();
  for (let k = 0; k < 40 && !(anim.has('lari') && anim.has('serang')); k++) { anim.add(await p.ev(`(() => { const g = BF.gfx.unitGroup(window.__t.me); return g && g.userData.mixer ? g.userData.cur : 'tanpa-kerangka'; })()`)); await p.sleep(120); }
  check('prajurit tombak beranimasi: lari ke sasaran lalu menusuk', anim.has('lari') && anim.has('serang') && !anim.has('tanpa-kerangka'), [...anim]);
  await step(20 * 12);
  check('musuh tewas & tercatat', await p.ev(`!BF.game.s.byId.has(window.__t.foe) && BF.game.s.players[0].kills === 1`), await p.ev(`(() => { const s = BF.game.s, me = s.byId.get(window.__t.me), foe = s.byId.get(window.__t.foe); return { kills: s.players[0].kills, me: me && { x: +me.x.toFixed(1), y: +me.y.toFixed(1), hp: me.hp, o: me.order.type, tid: me.order.tid }, foe: foe && { x: +foe.x.toFixed(1), y: +foe.y.toFixed(1), hp: foe.hp, o: foe.order.type } }; })()`));

  // sikap & patroli lewat tombol panel (X = Bertahan, F = Patroli lalu klik peta)
  const ME = 'BF.game.s.byId.get(window.__t.me)';
  await p.ev(`(() => { const u = ${ME}; BF.ui.select([u.id]); BF.input.centerOn(u.x, u.y); })()`);
  await p.sleep(250);
  await p.key('x', 'KeyX', 88);
  await p.sleep(350);
  check('tombol X → sikap Bertahan, tampil di panel', await p.ev(`${ME}.stance === 1 && document.getElementById('info-body').textContent.includes('Sikap: Bertahan') && document.querySelectorAll('#cmds .cmd.active').length === 1`), await p.ev(`document.getElementById('info-body').textContent`));
  await p.key('f', 'KeyF', 70);
  await p.sleep(80);
  check('F menyalakan mode patroli', await p.ev(`BF.ui.patrol === true`));
  const pp = await p.ev(`(() => { const u = ${ME}; return BF.view.toScreen(u.x + 3, u.y + 1, 0); })()`);
  await p.click(pp.x, pp.y);
  await p.sleep(100);
  check('klik peta → perintah patroli', await p.ev(`${ME}.order.type === 'patrol' && !BF.ui.patrol`));
  await p.ev(`(() => { const s = BF.game.s; BF.exec(s, 0, { c: 'stop', ids: [window.__t.me] }); BF.exec(s, 0, { c: 'stance', ids: [window.__t.me], v: 0 }); })()`);

  await p.key('p', 'KeyP', 80);
  const t0 = await p.ev(`BF.game.s.tick`);
  await p.sleep(400);
  check('P menjeda simulasi', (await p.ev(`BF.game.s.tick`)) === t0 && await p.ev(`!document.getElementById('paused').classList.contains('hidden')`));
  await p.key('p', 'KeyP', 80);
  await p.sleep(400);
  check('P lagi melanjutkan', (await p.ev(`BF.game.s.tick`)) > t0);

  await p.key('Delete', 'Delete', 46);
  await p.sleep(100);
  check('Del menghancurkan unit terpilih', await p.ev(`!BF.game.s.byId.has(window.__t.me) && BF.ui.sel.length === 0`));

  await p.clickEl('#btn-speed');
  check('tombol kecepatan → 1.5×', (await p.ev(`BF.game.speed`)) === 1.5);

  // ---- kamera 3D: geser (tepi layar & panah), zoom (roda), putar (tombol & seret tombol tengah)
  const mark = await p.ev(H.viewCenter);                           // titik tanah acuan
  const at = () => p.ev(`BF.view.toScreen(${mark.x}, ${mark.y}, 0)`);
  const room = { left: mark.x > 10 && mark.y < 86, up: mark.x > 14 && mark.y > 14 };
  let a0 = await at();
  await p.mouse('mouseMoved', room.left ? 2 : 1278, 300);
  await p.sleep(450);
  let a1 = await at();
  check('kursor di tepi layar menggeser kamera', room.left ? a1.x > a0.x + 50 : a1.x < a0.x - 50, { dari: a0.x, ke: a1.x });
  await p.mouse('mouseMoved', 640, 300);
  await p.sleep(100);
  a0 = await at();
  const k = room.up ? 'ArrowUp' : 'ArrowDown', vk = room.up ? 38 : 40;
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: vk });
  await p.sleep(350);
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: vk });
  a1 = await at();
  check('tombol panah menggeser kamera', room.up ? a1.y > a0.y + 50 : a1.y < a0.y - 50, { dari: a0.y, ke: a1.y });

  // klik kiri di minimap memindahkan kamera ke titik itu
  const mm = await p.ev(H.minimapPoint('48', '48'));
  await p.click(mm.x, mm.y);
  await p.sleep(100);
  let c = await p.ev(H.viewCenter);
  check('klik minimap memusatkan kamera ke tengah peta', Math.abs(c.x - 48) < 1 && Math.abs(c.y - 48) < 1, c);

  // zoom dengan roda mouse: titik tanah di bawah kursor tidak bergeser
  const z0 = await p.ev(`BF.game.cam.zoom`), g0 = await p.ev(`BF.view.toWorld(400, 250)`);
  await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 400, y: 250, deltaX: 0, deltaY: -120 });
  await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 400, y: 250, deltaX: 0, deltaY: -120 });
  await p.sleep(150);
  const z1 = await p.ev(`BF.game.cam.zoom`), g1 = await p.ev(`BF.view.toWorld(400, 250)`);
  check('roda mouse memperbesar & titik di bawah kursor tetap', z1 < z0 * 0.8 && Math.abs(g1.x - g0.x) < 0.05 && Math.abs(g1.y - g0.y) < 0.05, { z0, z1 });
  for (let i = 0; i < 30; i++) await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 300, deltaX: 0, deltaY: 120 });
  await p.sleep(150);
  check('zoom dibatasi', (await p.ev(`BF.game.cam.zoom`)) === (await p.ev(`BF.view.ZOOM_MAX`)));
  await p.ev(`BF.game.cam.zoom = BF.view.ZOOM_DEFAULT`);

  // putar: tombol ] lalu seret tombol tengah; pusat pandang tetap di titik yang sama
  await p.ev(`BF.input.centerOn(48, 48)`);
  const y0 = await p.ev(`BF.game.cam.yaw`);
  await p.key(']', 'BracketRight', 221);
  await p.sleep(100);
  const y1 = await p.ev(`BF.game.cam.yaw`);
  c = await p.ev(H.viewCenter);
  check('tombol ] memutar kamera mengelilingi pusat pandang', Math.abs(y1 - (y0 - Math.PI / 8)) < 1e-6 && Math.abs(c.x - 48) < 0.05 && Math.abs(c.y - 48) < 0.05, { y0, y1, c });
  await p.mouse('mouseMoved', 600, 300);
  await p.mouse('mousePressed', 600, 300, 'middle', { buttons: 4 });
  for (let i = 1; i <= 5; i++) await p.mouse('mouseMoved', 600 + i * 40, 300, 'middle', { buttons: 4 });
  await p.mouse('mouseReleased', 800, 300, 'middle', { buttons: 0 });
  await p.sleep(100);
  const y2 = await p.ev(`BF.game.cam.yaw`);
  check('seret tombol tengah memutar kamera', Math.abs(y2 - y1 - 200 * 0.006) < 0.05, { y1, y2 });

  // setelah diputar, klik tetap mengenai objek yang benar
  await p.key('h', 'KeyH', 72);
  await p.sleep(150);
  await p.key('Escape', 'Escape', 27);
  const roof2 = await p.ev(`(() => { const b = BF.game.s.buildings[0]; return BF.view.toScreen(b.tx + 1.5, b.ty + 1.5, BF.view.BUILD_H.townhall * 0.6); })()`);
  await p.click(roof2.x, roof2.y);
  await p.sleep(100);
  check('klik bangunan tetap tepat setelah kamera diputar', await p.ev(`BF.ui.sel.length === 1 && BF.ui.entities(BF.game.s)[0].type === 'townhall'`));
  await p.key('Home', 'Home', 36);
  await p.sleep(100);
  check('Home mengembalikan arah kamera', Math.abs((await p.ev(`BF.game.cam.yaw`)) - (await p.ev(`BF.view.YAW_DEFAULT`))) < 1e-6);
  await p.shot('05-kamera');
};
