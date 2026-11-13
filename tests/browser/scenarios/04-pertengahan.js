'use strict';
// Pertengahan permainan (kedua pihak dijalankan AI agar markas berkembang): panel bangunan, tooltip,
// antrean, perintah lewat minimap, pertempuran, unit unik, layar akhir.
const H = require('../helpers');

module.exports = async ({ page, check }) => {
  const p = await page();
  const hidden = id => p.ev(`document.getElementById('${id}').classList.contains('hidden')`);
  await p.clickEl('#factions .faction:nth-child(2)');   // Wangsa Bara
  await p.clickEl('#btn-start');
  await p.sleep(400);
  // Seed tetap agar jalannya permainan sama di setiap tes (peta acak bisa membuat markas keburu hancur).
  await p.ev(`BF.game.start({ difficulty: 'normal', factions: ['bara', 'rimba'], seed: 4202 })`);
  await p.sleep(200);
  await p.ev(`(() => { const s = BF.game.s; s.players[0].isAI = true; for (let i = 0; i < 20 * 60 * 10 && !s.over; i++) { BF.step(s); s.events.length = 0; } s.players[0].isAI = false; })()`);
  await p.key('h', 'KeyH', 72);
  await p.sleep(500);
  await p.shot('20-markas-menit-10');
  const st = await p.ev(`(() => { const s = BF.game.s, q = s.players[0]; return { era: q.era, pop: q.pop, techs: q.techs, army: s.units.filter(u => u.owner === 0 && u.type !== 'worker').map(u => u.type).sort().join(',') }; })()`);
  check('markas berkembang (era, populasi, pasukan)', st.pop > 15 && st.era >= 1, st);

  // Barak: singkirkan dulu unit yang mungkin berdiri di depannya agar klik mengenai bangunan
  const bar = await p.ev(H.buildingPoint(`BF.game.s.buildings.find(b => b.owner === 0 && b.type === 'barracks' && b.built)`));
  check('ada Barak', !!bar);
  await p.sleep(150);
  await p.ev(`(() => { const s = BF.game.s, b = s.buildings.find(q => q.owner === 0 && q.type === 'barracks' && q.built); const r = BF.view.pickStanding(s, ${bar.x}, ${bar.y}); window.__barOk = !!r && r.b === b; BF.ui.select([b.id]); })()`);
  check('Barak bisa diklik pada badannya', await p.ev(`window.__barOk`));
  await p.sleep(250);
  check('tombol Barak: tombak, pedang, Pengamuk (unik Bara), hancurkan', await p.ev(`BF.hud.buttons.filter(Boolean).map(b => b.title).join('|') === 'Latih Prajurit Tombak|Latih Pendekar Pedang|Latih Pengamuk|Hancurkan bangunan'`), await p.ev(`BF.hud.buttons.filter(Boolean).map(b => b.title)`));
  await p.ev(`(() => { const r = BF.game.s.players[0].res; r.food += 600; r.wood += 600; r.gold += 600; })()`);
  const q0 = await p.ev(`BF.ui.entities(BF.game.s)[0].queue.length`);
  await p.clickEl('#cmds .cmd:nth-child(3)');
  await p.clickEl('#cmds .cmd:nth-child(3)');
  await p.sleep(350);
  check('klik tombol melatih 2 Pengamuk', await p.ev(`(() => { const b = BF.ui.entities(BF.game.s)[0]; return b.queue.length === ${q0} + 2 && b.queue[b.queue.length - 1].unit === 'berserk'; })()`));
  check('tooltip unit unik tampil', await p.ev(`!document.getElementById('tooltip').classList.contains('hidden') && document.getElementById('tooltip').textContent.includes('Pengamuk')`));
  await p.shot('21-panel-barak');
  const before = await p.ev(`BF.ui.entities(BF.game.s)[0].queue.length`);
  await p.clickEl('#info-body .q:last-child');
  await p.sleep(350);
  check('klik chip antrean membatalkan', (await p.ev(`BF.ui.entities(BF.game.s)[0].queue.length`)) === before - 1);

  // seluruh pasukan → klik kanan minimap di markas musuh
  await p.ev(`(() => { const s = BF.game.s; BF.ui.select(s.units.filter(u => u.owner === 0 && u.type !== 'worker').map(u => u.id)); })()`);
  const n = await p.ev(`BF.ui.sel.length`);
  await p.sleep(200);
  check('panel pasukan: Gerak-Serang + Berhenti', (await p.ev(`document.querySelectorAll('#cmds .cmd:not(.empty)').length`)) === 2 && n > 0, n);
  await p.key('a', 'KeyA', 65);
  await p.sleep(100);
  check('A → mode gerak-serang', await p.ev(`BF.ui.amove === true`));
  await p.key('Escape', 'Escape', 27);
  const mm = await p.ev(H.minimapPoint(`BF.game.s.buildings.find(b => b.owner === 1).tx + 1.5`, `BF.game.s.buildings.find(b => b.owner === 1).ty + 1.5`));
  await p.click(mm.x, mm.y, 'right');
  await p.sleep(150);
  check('klik kanan minimap → pasukan berangkat', (await p.ev(`BF.game.s.units.filter(u => u.owner === 0 && u.type !== 'worker' && (u.order.type === 'move' || u.order.type === 'attack')).length`)) === n);

  await p.ev(`(() => { const s = BF.game.s; s.players[0].isAI = true; for (let i = 0; i < 20 * 60 * 8 && !s.over; i++) { BF.step(s); s.events.length = 0; if (i > 600 && s.projectiles.length >= 3) break; } s.players[0].isAI = false; const f = s.units.find(u => u.order.type === 'attack'); if (f) BF.input.centerOn(f.x, f.y); s.fog.explored.fill(1); })()`);
  await p.sleep(500);
  await p.shot('22-pertempuran');
  await p.ev(`BF.game.cam.yaw += 1.9; BF.game.cam.zoom = 13; (() => { const f = BF.game.s.units.find(u => u.order.type === 'attack'); if (f) BF.input.centerOn(f.x, f.y); })()`);
  await p.sleep(400);
  await p.shot('22b-pertempuran-diputar');
  await p.ev(`BF.game.cam.yaw = BF.view.YAW_DEFAULT; BF.game.cam.zoom = BF.view.ZOOM_DEFAULT`);

  await p.clickEl('#btn-help');
  await p.sleep(150);
  check('Bantuan terbuka', !(await hidden('overlay-help')));
  await p.clickEl('#btn-help-close');

  await p.ev(`(() => { const s = BF.game.s; s.players[0].isAI = true; for (let i = 0; i < 20 * 60 * 90 && !s.over; i++) BF.step(s); })()`);
  await p.sleep(500);
  check('permainan berakhir & layar akhir tampil', await p.ev(`BF.game.s.over`) && !(await hidden('overlay-end')), await p.ev(`({ winner: BF.game.s.winner, menit: Math.round(BF.game.s.tick / 1200), teknologi: BF.game.s.players.map(q => q.techs.length) })`));
  await p.shot('23-akhir');
  await p.clickEl('#btn-again');
  await p.sleep(200);
  check('Main Lagi kembali ke menu awal', !(await hidden('overlay-start')) && await p.ev(`!BF.game.running`));
};
