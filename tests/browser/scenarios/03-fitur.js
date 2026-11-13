'use strict';
// Fitur lanjutan: pilihan wangsa, suara, riset teknologi, tembok & gerbang, simpan/muat, menu.
const H = require('../helpers');

module.exports = async ({ page, check }) => {
  const p = await page();
  const step = n => p.ev(`(() => { const s = BF.game.s; for (let i = 0; i < ${n}; i++) BF.step(s); })()`);
  const hidden = id => p.ev(`document.getElementById('${id}').classList.contains('hidden')`);

  // ---- menu: wangsa, lawan, kesulitan
  await p.clickEl('#factions .faction:nth-child(3)');
  check('pilih Wangsa Rimba → bonus ditampilkan', await p.ev(`BF.menu.faction === 'rimba' && document.getElementById('faction-info').textContent.includes('Kayu')`));
  await p.ev(`(() => { const el = document.getElementById('foe'); el.value = 'bara'; el.dispatchEvent(new Event('change')); })()`);
  await p.clickEl('#difficulty .choice:nth-child(1)');
  await p.clickEl('#btn-start');
  await p.sleep(500);
  check('permainan memakai pilihan menu', await p.ev(`(() => { const s = BF.game.s; return s.players[0].faction === 'rimba' && s.players[1].faction === 'bara' && s.difficulty === 'easy'; })()`));
  check('bonus wangsa aktif (pemanah +1 jarak, kayu +20%)', await p.ev(`(() => { const q = BF.game.s.players[0]; return q.U.archer.range === 6 && Math.abs(q.mod.gather.wood - 1.08) < 1e-9 && BF.game.s.players[1].U.archer.range === 5; })()`));

  // ---- suara
  check('AudioContext aktif setelah klik Mulai', (await p.ev(`BF.audio.ctx ? BF.audio.ctx.state : 'none'`)) === 'running');
  await p.ev(`(() => { for (const n of ['select','order','place','error','built','ready','tech','clang','arrow','launch','thud','death','collapse','alert','fanfare','win','lose']) { BF.audio.last = {}; BF.audio.play(n); } })()`);
  await p.sleep(1200);
  check('semua efek suara & musik tersintesis tanpa error', await p.ev(`BF.audio.beat > 0`));

  // ---- riset teknologi lewat UI
  await p.ev(`(() => { const s = BF.game.s, th = s.buildings[0], q = s.players[0]; q.res = { food: 3000, wood: 3000, gold: 3000, stone: 3000 }; let spot = null; for (let r = 4; r < 12 && !spot; r++) for (let d = -r; d <= r && !spot; d++) for (const [tx, ty] of [[th.tx + d, th.ty + r], [th.tx + d, th.ty - r]]) if (!spot && BF.canPlace(s.map, 'storage', tx, ty) && !s.map.node[BF.idx(tx + 2, ty + 2)] && !s.map.node[BF.idx(tx + 1, ty + 2)] && !s.map.node[BF.idx(tx + 2, ty + 1)]) spot = { tx, ty }; const b = BF.spawnBuilding(s, 'storage', 0, spot.tx, spot.ty, true); BF.updateFog(s); window.__st = b.id; })()`);
  const st = await p.ev(H.buildingPoint(`BF.game.s.byId.get(window.__st)`));
  await p.sleep(200);
  await p.click(st.x, st.y);
  await p.sleep(250);
  check('klik Lumbung: 3 teknologi (1 terkunci) + hancurkan', (await p.ev(`document.querySelectorAll('#cmds .cmd:not(.empty)').length`)) === 4 && await p.ev(`document.querySelectorAll('#cmds .cmd.locked').length === 1`));
  await p.clickEl('#cmds .cmd:nth-child(1)');
  await p.sleep(300);
  check('klik riset → masuk antrean, biaya terpotong', await p.ev(`(() => { const s = BF.game.s, b = s.byId.get(window.__st), q = s.players[0]; return b.queue.length === 1 && b.queue[0].tech === 'kapak' && q.res.food === 2900 && q.res.wood === 2950; })()`));
  check('tombol riset yang sedang berjalan dinonaktifkan', await p.ev(`document.querySelector('#cmds .cmd:nth-child(1)').classList.contains('disabled')`));
  await p.shot('10-riset');
  await step(20 * 26);
  await p.sleep(300);
  check('riset selesai: efek & pesan', await p.ev(`(() => { const q = BF.game.s.players[0]; return q.techs.join() === 'kapak' && Math.abs(q.mod.gather.wood - 1.296) < 1e-9 && document.getElementById('toast').textContent.includes('Kapak Ganda'); })()`));
  check('teknologi yang selesai hilang dari panel', (await p.ev(`document.querySelectorAll('#cmds .cmd:not(.empty)').length`)) === 3);

  // ---- tembok: seret sebaris 6 tile
  await p.key('h', 'KeyH', 72);
  await p.sleep(150);
  const box = await p.ev(H.workersBox(0));
  await p.drag(box.x0, box.y0, box.x1, box.y1);
  await p.sleep(150);
  await p.key('x', 'KeyX', 88);
  await p.sleep(100);
  check('X → mode Tembok Batu', (await p.ev(`BF.ui.placing`)) === 'wall');
  const run = await p.ev(`(() => { const s = BF.game.s, th = s.buildings[0], safe = q => q.x > 24 && q.x < 1256 && q.y > 70 && q.y < 585; for (let r = 4; r < 10; r++) for (const ty of [th.ty + 1 + r, th.ty + 1 - r]) for (let tx = th.tx - 7; tx <= th.tx + 3; tx++) { let ok = true; for (let k = 0; k < 6 && ok; k++) ok = BF.inBounds(tx + k, ty) && BF.canPlace(s.map, 'wall', tx + k, ty) && !!s.fog.explored[BF.idx(tx + k, ty)]; const a = BF.view.toScreen(tx + 0.5, ty + 0.5), b = BF.view.toScreen(tx + 5.5, ty + 0.5); if (ok && safe(a) && safe(b)) return { a, b, tx, ty }; } return null; })()`);
  check('ada lahan untuk 6 tembok', !!run);
  await p.mouse('mouseMoved', run.a.x, run.a.y);
  await p.mouse('mousePressed', run.a.x, run.a.y, 'left');
  for (let i = 1; i <= 5; i++) await p.mouse('mouseMoved', run.a.x + (run.b.x - run.a.x) * i / 5, run.a.y + (run.b.y - run.a.y) * i / 5, 'left');
  await p.sleep(150);
  check('pratinjau 6 segmen saat menyeret', await p.ev(`BF.ui.ghosts.length === 6 && BF.ui.ghosts.every(g => g.ok)`), await p.ev(`BF.ui.ghosts.length`));
  await p.shot('11-seret-tembok');
  await p.mouse('mouseReleased', run.b.x, run.b.y, 'left');
  await p.sleep(150);
  check('6 tembok diletakkan, batu 3000 → 2964', await p.ev(`BF.game.s.buildings.filter(b => b.type === 'wall').length === 6 && BF.game.s.players[0].res.stone === 2964 && BF.ui.placing === null`));
  await step(20 * 50);
  check('pekerja menyelesaikan seluruh baris', (await p.ev(`BF.game.s.buildings.filter(b => b.type === 'wall' && b.built).length`)) === 6);

  // ---- gerbang di atas tembok
  await p.drag(8, 50, 1272, 600);   // pilih ulang semua unit sendiri di layar
  await p.sleep(100);
  await p.key('c', 'KeyC', 67);
  const gpos = await p.ev(`BF.view.toScreen(${run.tx} + 2.5, ${run.ty} + 0.5)`);
  await p.mouse('mouseMoved', gpos.x, gpos.y);
  await p.sleep(120);
  check('ghost gerbang sah di atas tembok sendiri', await p.ev(`BF.ui.placing === 'gate' && BF.ui.ghosts.length === 1 && BF.ui.ghosts[0].ok && BF.ui.ghosts[0].tx === ${run.tx} + 2`));
  await p.click(gpos.x, gpos.y);
  await p.sleep(150);
  await step(20 * 30);
  await p.sleep(250);
  check('gerbang menggantikan satu tembok & bisa dilewati pemilik', await p.ev(`(() => { const s = BF.game.s; return s.buildings.filter(b => b.type === 'wall').length === 5 && s.buildings.some(b => b.type === 'gate' && b.built) && BF.passable(s.map, ${run.tx} + 2, ${run.ty}, 0) && !BF.passable(s.map, ${run.tx} + 2, ${run.ty}, 1) && !BF.passable(s.map, ${run.tx} + 1, ${run.ty}, 0); })()`));
  await p.key('Escape', 'Escape', 27);
  await p.sleep(250);
  await p.shot('12-tembok-gerbang');

  // ---- simpan / muat
  await p.clickEl('#btn-menu');
  await p.sleep(150);
  check('Menu terbuka & permainan terjeda', !(await hidden('overlay-menu')) && await p.ev(`BF.game.paused && BF.game.menuOpen`));
  await p.clickEl('#m-save');
  await p.sleep(200);
  const saved = await p.ev(`(() => { const s = BF.game.s, m = BF.save.meta('manual'); return { tick: s.tick, wood: s.players[0].res.wood, units: s.units.length, note: document.getElementById('m-note').textContent, meta: m && m.tick }; })()`);
  check('Simpan → tersimpan di localStorage', saved.note.includes('disimpan') && saved.meta === saved.tick, saved);
  await p.clickEl('#m-resume');
  await p.sleep(150);
  check('Lanjutkan menutup menu & melepas jeda', (await hidden('overlay-menu')) && await p.ev(`!BF.game.paused`));
  await p.ev(`(() => { const s = BF.game.s; for (let i = 0; i < 900; i++) BF.step(s); s.players[0].res.wood = 1; })()`);
  await p.key('Escape', 'Escape', 27);
  await p.sleep(150);
  check('Esc tanpa pilihan membuka Menu', !(await hidden('overlay-menu')));
  await p.clickEl('#m-load');
  await p.sleep(400);
  const loaded = await p.ev(`(() => { const s = BF.game.s; return { tick: s.tick, wood: s.players[0].res.wood, units: s.units.length, techs: s.players[0].techs.join(), range: s.players[0].U.archer.range, gate: s.buildings.some(b => b.type === 'gate' && b.built), paused: BF.game.paused }; })()`);
  check('Muat → state kembali persis seperti saat disimpan', loaded.wood === saved.wood && loaded.units === saved.units && loaded.techs === 'kapak' && loaded.range === 6 && loaded.gate && !loaded.paused && loaded.tick - saved.tick < 20 && (await hidden('overlay-menu')), loaded);

  await p.ev(`BF.game.s.tick = 3599`);
  await p.sleep(400);
  check('simpanan otomatis tertulis di menit ke-3', (await p.ev(`(BF.save.meta('auto') || {}).tick`)) === 3600);

  // ---- pengaturan suara tersimpan
  await p.clickEl('#btn-menu');
  await p.sleep(100);
  await p.clickEl('#m-music');
  await p.clickEl('#m-sfx');
  check('toggle suara/musik tersimpan', await p.ev(`!BF.audio.sfx && !BF.audio.music && localStorage.getItem('bf.settings') === '{"sfx":false,"music":false}' && document.getElementById('m-sfx').textContent.includes('Mati')`));
  await p.shot('13-menu');

  // ---- keluar ke menu utama → Lanjutkan
  await p.clickEl('#m-quit');
  await p.sleep(200);
  check('keluar ke menu utama: tombol Lanjutkan muncul', !(await hidden('overlay-start')) && !(await hidden('btn-continue')) && await p.ev(`!BF.game.running && document.getElementById('btn-continue').textContent.includes('Wangsa Rimba')`));
  await p.clickEl('#btn-continue');
  await p.sleep(400);
  check('Lanjutkan memuat simpanan terbaru', await p.ev(`BF.game.running && BF.game.s.tick >= 3600 && BF.game.s.players[0].faction === 'rimba'`) && (await hidden('overlay-start')));

  // ---- simpanan bertahan setelah halaman dimuat ulang
  await p.send('Page.reload');
  await p.sleep(1200);
  check('setelah muat ulang halaman: simpanan & pengaturan masih ada', !(await hidden('btn-continue')) && await p.ev(`!BF.game.running && BF.audio.sfx === false && BF.audio.music === false`));
  await p.clickEl('#btn-continue');
  await p.sleep(400);
  check('permainan tersimpan dilanjutkan dari halaman baru', await p.ev(`(() => { const s = BF.game.s, q = s.players[0]; return BF.game.running && s.tick >= 3600 && q.faction === 'rimba' && q.techs.join() === 'kapak' && s.buildings.some(b => b.type === 'gate' && b.built) && s.buildings.filter(b => b.type === 'wall').length === 5; })()`));
  const t = await p.ev(`BF.game.s.tick`);
  await p.sleep(600);
  check('permainan yang dimuat terus berjalan', (await p.ev(`BF.game.s.tick`)) > t + 5);
};
