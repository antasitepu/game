'use strict';
// Tutorial terpandu: tiap langkah selesai saat keadaan permainan memenuhi syaratnya, sampai pos musuh roboh.
// Langkah awal memakai input sungguhan (tombol, seret, klik kanan); pembangunan dan pelatihan dipercepat dengan BF.step.
const H = require('../helpers');

module.exports = async ({ page, check }) => {
  const p = await page();
  const step = n => p.ev(`(() => { const s = BF.game.s; for (let i = 0; i < ${n} && !s.over; i++) BF.step(s); })()`);
  const panel = () => p.ev(`({ step: document.getElementById('tut-step').textContent, title: document.getElementById('tut-title').textContent, hidden: document.getElementById('tutorial').classList.contains('hidden') })`);
  // tunggu sampai panel menampilkan langkah ke-n (jeda "selesai" ±1,4 detik)
  const at = async n => { for (let i = 0; i < 40; i++) { const q = await panel(); if (q.step === `Tutorial · ${n}/9` && !q.title.startsWith('✓')) return q; await p.sleep(100); } return panel(); };

  await p.clickEl('#btn-tutorial');
  await p.sleep(600);
  let q = await panel();
  check('tombol Tutorial memulai permainan terpandu', await p.ev(`BF.game.running && BF.game.s.tutorial === true && BF.tutorial.active`) && !q.hidden && q.step === 'Tutorial · 1/9' && q.title === 'Gerakkan kamera', q);
  check('lawan hanya berupa satu pos yang dijaga, tanpa AI', await p.ev(`(() => { const s = BF.game.s; return !s.players[1].isAI && s.buildings.filter(b => b.owner === 1).length === 1 && s.buildings.find(b => b.owner === 1).type === 'house' && s.units.filter(u => u.owner === 1).length === 1 && !s.over; })()`));
  await p.shot('40-tutorial-awal');

  // 1. kamera: tahan panah kanan
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await p.sleep(500);
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  q = await at(2);
  check('langkah 1 selesai setelah kamera digeser', q.title === 'Pilih pekerja', q);

  // 2. pilih pekerja dengan seret kotak
  await p.key('h', 'KeyH', 72);
  await p.sleep(200);
  await p.key('Escape', 'Escape', 27);
  const box = await p.ev(H.workersBox(0));
  await p.drag(box.x0, box.y0, box.x1, box.y1);
  q = await at(3);
  check('langkah 2 selesai setelah pekerja dipilih', q.title === 'Kumpulkan pangan', q);

  // 3. klik kanan semak beri
  const berry = await p.ev(H.node('BF.N_BERRY', 0));
  await p.click(berry.x, berry.y, 'right');
  q = await at(4);
  check('langkah 3 selesai setelah pekerja memetik beri', q.title === 'Tebang kayu', q);

  // 4–8: perintah lewat BF.issue, waktu dipercepat
  await p.ev(`(() => { const s = BF.game.s, w = s.units.filter(u => u.owner === 0 && u.type === 'worker'), th = s.buildings.find(b => b.owner === 0), n = BF.findNode(s.map, th.tx, th.ty, BF.N_TREE, 20, s.map.region[BF.idx(th.tx, th.ty + 3)]); BF.issue({ c: 'gather', ids: w.slice(2).map(u => u.id), nx: n.x, ny: n.y }); })()`);
  q = await at(5);
  check('langkah 4 selesai setelah pekerja menebang', q.title === 'Bangun Rumah', q);

  const place = type => p.ev(`(() => { const s = BF.game.s, th = s.buildings.find(b => b.owner === 0 && b.type === 'townhall'), w = s.units.filter(u => u.owner === 0 && u.type === 'worker'); for (let r = 4; r < 14; r++) for (let d = -r; d <= r; d++) for (const [tx, ty] of [[th.tx + d, th.ty + r], [th.tx + r, th.ty + d]]) if (BF.placeable(s, 0, '${type}', tx, ty)) { BF.issue({ c: 'place', type: '${type}', tx, ty, ids: w.slice(0, 2).map(u => u.id) }); return true; } return false; })()`);
  await place('house');
  await step(20 * 40);
  q = await at(6);
  check('langkah 5 selesai setelah Rumah berdiri', q.title === 'Latih pekerja', q);

  await p.ev(`(() => { const s = BF.game.s, th = s.buildings.find(b => b.owner === 0 && b.type === 'townhall'); for (let i = 0; i < 2; i++) BF.issue({ c: 'train', bid: th.id, unit: 'worker' }); })()`);
  await step(20 * 40);
  q = await at(7);
  check('langkah 6 selesai setelah dua pekerja dilatih', q.title === 'Bangun Barak', q);

  await place('barracks');
  await step(20 * 60);
  q = await at(8);
  check('langkah 7 selesai setelah Barak berdiri', q.title === 'Latih pasukan', q);

  await p.ev(`(() => { const s = BF.game.s, b = s.buildings.find(x => x.owner === 0 && x.type === 'barracks'); for (let i = 0; i < 3; i++) BF.issue({ c: 'train', bid: b.id, unit: 'spear' }); })()`);
  await step(20 * 70);
  q = await at(9);
  check('langkah 8 selesai setelah tiga prajurit dilatih', q.title === 'Robohkan pos musuh', q);
  await p.sleep(300);
  check('langkah 9: pos musuh tampak di peta & ditandai di minimap', await p.ev(`(() => { const s = BF.game.s, b = s.byId.get(BF.tutorial.post), q = s.players[0]; return !!s.fog.explored[BF.idx(b.tx, b.ty)] && Math.abs(q.alertX - b.tx - 1) < 0.01 && s.tick - q.alertTick <= 120; })()`));
  await p.shot('41-tutorial-serang');

  // 9. serang pos musuh sampai roboh
  await p.ev(`(() => { const s = BF.game.s; BF.issue({ c: 'attack', ids: s.units.filter(u => u.owner === 0 && u.type === 'spear').map(u => u.id), tid: BF.tutorial.post }); })()`);
  await step(20 * 150);
  await p.sleep(500);
  q = await panel();
  check('pos musuh roboh → menang & tutorial dinyatakan selesai', await p.ev(`BF.game.s.over && BF.game.s.winner === 0 && !document.getElementById('overlay-end').classList.contains('hidden') && document.getElementById('end-title').textContent === 'Kemenangan!' && document.getElementById('tut-text').textContent.startsWith('Tutorial selesai')`) && q.title.startsWith('✓'), q);
  check('tutorial tidak menimpa simpanan otomatis', await p.ev(`localStorage.getItem('bf.save.auto') === null`));
  await p.shot('42-tutorial-selesai');
  await p.clickEl('#btn-again');
  await p.sleep(300);
  check('kembali ke menu: panel tutorial hilang', (await panel()).hidden && await p.ev(`!BF.tutorial.active && !document.getElementById('overlay-start').classList.contains('hidden')`));

  // menutup petunjuk di tengah jalan: permainan tetap berjalan tanpa panel
  await p.clickEl('#btn-tutorial');
  await p.sleep(500);
  await p.clickEl('#tut-close');
  await p.sleep(200);
  check('"Tutup petunjuk" menyembunyikan panel, permainan lanjut', (await panel()).hidden && await p.ev(`BF.game.running && !BF.tutorial.active`));
  // memulai permainan biasa sesudahnya tidak menampilkan panel lagi
  await p.ev(`BF.menu.toStart()`);
  await p.sleep(200);
  await p.clickEl('#btn-start');
  await p.sleep(500);
  check('permainan biasa sesudah tutorial: tanpa panel, AI aktif', (await panel()).hidden && await p.ev(`BF.game.running && !BF.game.s.tutorial && BF.game.s.players[1].isAI`));
};
