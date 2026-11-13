'use strict';
// Alur dasar: menu → mulai → seleksi → kumpul → bangun → latih → titik kumpul → waktu berjalan.
const H = require('../helpers');

module.exports = async ({ page, check }) => {
  const p = await page();
  await p.shot('01-menu');
  check('menu awal tampil dengan 4 wangsa', await p.ev(`document.querySelectorAll('#factions .faction').length === 4 && !document.getElementById('overlay-start').classList.contains('hidden')`));
  await p.clickEl('#btn-start');
  await p.sleep(500);
  check('game mulai, lawan beda wangsa', await p.ev(`BF.game.running && BF.game.s.players[0].faction === 'samudra' && BF.game.s.players[1].faction !== 'samudra' && document.getElementById('overlay-start').classList.contains('hidden')`));
  await p.shot('02-awal-permainan');

  const box = await p.ev(H.workersBox(0));
  await p.drag(box.x0, box.y0, box.x1, box.y1);
  await p.sleep(150);
  check('seret-pilih 4 pekerja', (await p.ev(`BF.ui.sel.length`)) === 4);
  check('menu bangun: 12 bangunan', (await p.ev(`document.querySelectorAll('#cmds .cmd:not(.empty)').length`)) === 12);

  const berry = await p.ev(H.node('BF.N_BERRY', 0));
  check('ada semak beri yang bisa diklik', !!berry);
  await p.click(berry.x, berry.y, 'right');
  await p.sleep(150);
  check('klik kanan semak → 4 pekerja mengumpulkan pangan', (await p.ev(`BF.game.s.units.filter(u => u.owner === 0 && u.order.type === 'gather' && u.order.res === 'food').length`)) === 4);

  await p.key('q', 'KeyQ', 81);
  await p.sleep(100);
  check('Q → mode penempatan Rumah', (await p.ev(`BF.ui.placing`)) === 'house');
  const spot = (await p.ev(H.spots('house', 0, 1)))[0];
  await p.mouse('mouseMoved', spot.x, spot.y);
  await p.sleep(120);
  check('ghost hijau di tapak kosong', await p.ev(`BF.ui.ghosts.length === 1 && BF.ui.ghosts[0].ok && BF.ui.ghosts[0].tx === ${spot.tx} && BF.ui.ghosts[0].ty === ${spot.ty}`));
  await p.shot('03-penempatan');
  await p.click(spot.x, spot.y);
  await p.sleep(150);
  check('fondasi Rumah diletakkan, kayu 250 → 220', await p.ev(`BF.game.s.buildings.some(b => b.type === 'house' && !b.built) && BF.game.s.players[0].res.wood === 220`));
  check('pekerja ditugaskan membangun', (await p.ev(`BF.game.s.units.filter(u => u.owner === 0 && u.order.type === 'build').length`)) === 4);

  await p.key('h', 'KeyH', 72);
  await p.sleep(100);
  await p.key('q', 'KeyQ', 81);
  await p.key('q', 'KeyQ', 81);
  await p.sleep(150);
  check('2 pekerja masuk antrean, pangan 250 → 150', await p.ev(`BF.game.s.buildings[0].queue.length === 2 && BF.game.s.players[0].res.food === 150`));

  const tree = await p.ev(H.node('BF.N_TREE', 0));
  if (tree) {
    await p.click(tree.x, tree.y, 'right');
    await p.sleep(100);
    check('klik kanan pohon → titik kumpul', await p.ev(`!!BF.game.s.buildings[0].rally && BF.game.s.buildings[0].rally.node === BF.N_TREE`));
  }

  await p.ev(`(() => { const s = BF.game.s; for (let i = 0; i < 1800; i++) BF.step(s); })()`);
  await p.sleep(300);
  check('setelah 90 dtk: rumah jadi, populasi 6/10, setoran berjalan', await p.ev(`(() => { const s = BF.game.s, q = s.players[0]; return s.buildings.some(b => b.type === 'house' && b.built) && q.popCap === 10 && q.pop === 6 && q.gathered > 0; })()`));
  if (tree) check('pekerja baru otomatis menebang', (await p.ev(`BF.game.s.units.filter(u => u.owner === 0 && u.order.type === 'gather' && u.order.res === 'wood').length`)) >= 2);
  await p.shot('04-setelah-90-detik');
};
