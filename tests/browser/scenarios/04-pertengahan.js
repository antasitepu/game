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
  // (antrean dibandingkan per butir, bukan per panjang: unit di kepala antrean bisa selesai dilatih di sela-sela tes)
  const before = await p.ev(`(() => { const q = BF.ui.entities(BF.game.s)[0].queue; window.__last = q[q.length - 1]; return q.length; })()`);
  await p.clickEl('#info-body .q:last-child');
  await p.sleep(350);
  check('klik chip antrean membatalkan', await p.ev(`(() => { const q = BF.ui.entities(BF.game.s)[0].queue; return q.indexOf(window.__last) < 0 && q.length <= ${before} - 1; })()`));

  // seluruh pasukan → klik kanan minimap di markas musuh
  await p.ev(`(() => { const s = BF.game.s; BF.ui.select(s.units.filter(u => u.owner === 0 && u.type !== 'worker').map(u => u.id)); })()`);
  const n = await p.ev(`BF.ui.sel.length`);
  await p.sleep(200);
  check('panel pasukan: 3 formasi, Gerak-Serang, Berhenti, Berlindung, Patroli, 3 sikap', (await p.ev(`document.querySelectorAll('#cmds .cmd:not(.empty)').length`)) === 10 && n > 0, n);
  // formasi: Q = Baris, W = Kotak, E = Bebas; pilihan bertahan dan ditandai aktif di panel
  const aktif = () => p.ev(`[...document.querySelectorAll('#cmds .cmd')].slice(0, 3).map(e => e.classList.contains('active') ? 1 : 0).join('')`);
  check('formasi awal: Bebas (tombol E menyala)', await p.ev(`BF.ui.formation === 0`) && (await aktif()) === '001', await aktif());
  await p.key('w', 'KeyW', 87);
  await p.sleep(120);
  check('W → formasi Kotak', await p.ev(`BF.ui.formation === 2`) && (await aktif()) === '010', await aktif());
  await p.key('q', 'KeyQ', 81);
  await p.sleep(120);
  check('Q → formasi Baris', await p.ev(`BF.ui.formation === 1`) && (await aktif()) === '100', await aktif());
  const lahan = await p.ev(`(() => { const s = BF.game.s, th = s.buildings.find(b => b.owner === 0 && b.type === 'townhall'); return BF.findFreeNear(s.map, th.tx + 9, th.ty + 9, 6, 0); })()`);
  const mf = await p.ev(H.minimapPoint(String(lahan.x + 0.5), String(lahan.y + 0.5)));
  await p.click(mf.x, mf.y, 'right');
  await p.sleep(150);
  // (pasukan bisa sedang bertempur: unit yang gugur di sela-sela tes tidak dihitung — bandingkan dengan yang masih hidup)
  const form = await p.ev(`(() => { const s = BF.game.s, all = s.units.filter(u => u.owner === 0 && u.type !== 'worker'), us = all.filter(u => u.order.type === 'move'); return { hidup: all.length, n: us.length, pace: us.map(u => u.order.pace), min: Math.min(...us.map(u => BF.unitDef(s, u).speed)), face: us.map(u => u.order.face) }; })()`);
  check('perintah gerak membawa formasi terpilih (laju bersama & arah hadap)', form.hidup < 2 || (form.n === form.hidup && form.pace.every(v => v === form.min) && form.face.every(v => typeof v === 'number' && v === form.face[0])), { n, bergerak: form.n, min: form.min, lain: await p.ev(`BF.game.s.units.filter(u => u.owner === 0 && u.type !== 'worker' && u.order.type !== 'move').map(u => [u.type, u.order.type, +u.x.toFixed(1), +u.y.toFixed(1), JSON.stringify(u.order).slice(0, 90)])`) });
  await p.key('a', 'KeyA', 65);
  await p.sleep(100);
  check('A → mode gerak-serang', await p.ev(`BF.ui.amove === true`));
  await p.key('Escape', 'Escape', 27);
  const mm = await p.ev(H.minimapPoint(`BF.game.s.buildings.find(b => b.owner === 1).tx + 1.5`, `BF.game.s.buildings.find(b => b.owner === 1).ty + 1.5`));
  await p.click(mm.x, mm.y, 'right');
  await p.sleep(150);
  check('klik kanan minimap → pasukan berangkat', await p.ev(`(() => { const all = BF.game.s.units.filter(u => u.owner === 0 && u.type !== 'worker'); return all.length > 0 && all.every(u => u.order.type === 'move' || u.order.type === 'attack'); })()`));
  await p.key('e', 'KeyE', 69);
  await p.sleep(120);
  check('E → formasi Bebas', await p.ev(`BF.ui.formation === 0`));

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
  // layar akhir: tabel statistik dua pemain + grafik skor, cocok dengan state; tombol Main Lagi terlihat tanpa menggulir
  check('layar akhir: tabel statistik cocok dengan state', await p.ev(`(() => { const s = BF.game.s, me = s.players[0], foe = s.players[1], rows = [...document.querySelectorAll('.end-table tr')].map(tr => [...tr.children].map(c => c.textContent));
    const row = name => rows.find(r => r[0] === name), n = v => v.toLocaleString('id-ID');
    return rows.length === 14 && rows[0][1].startsWith('Kamu') && rows[0][2].startsWith('Lawan') && row('Skor')[1] === n(BF.score(me).total) && row('Skor')[2] === n(BF.score(foe).total)
      && row('Unit dilatih')[1] === String(me.stat.trained) && row('Bangunan dirobohkan')[2] === String(foe.stat.razed) && row('Era tercapai')[1] === BF.ERAS[me.era].name; })()`), await p.ev(`[...document.querySelectorAll('.end-table tr')].slice(1, 5).map(tr => tr.textContent).join(' | ')`));
  check('layar akhir: grafik skor dua garis + legenda, tombol Main Lagi terlihat', await p.ev(`(() => { const c = document.querySelector('.end-chart'), b = document.getElementById('btn-again').getBoundingClientRect();
    return c.querySelectorAll('svg path').length === 2 && c.querySelector('.ec-legend').textContent === 'KamuLawan' && BF.game.s.hist.length >= 4 && b.bottom <= window.innerHeight && b.top > 0; })()`));
  const cp = await p.ev(`(() => { const r = document.querySelector('.end-chart svg').getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 }; })()`);
  await p.mouse('mouseMoved', cp.x, cp.y);
  await p.sleep(200);
  check('kursor di grafik → tooltip skor kedua pemain di menit itu', await p.ev(`(() => { const t = document.querySelector('.ec-tip'); return !t.classList.contains('hidden') && /^Menit \\d+:\\d\\d/.test(t.textContent) && t.textContent.includes('Kamu') && t.textContent.includes('Lawan'); })()`), await p.ev(`document.querySelector('.ec-tip').textContent`));
  await p.shot('23-akhir');
  await p.clickEl('#btn-again');
  await p.sleep(200);
  check('Main Lagi kembali ke menu awal', !(await hidden('overlay-start')) && await p.ev(`!BF.game.running`));
};
