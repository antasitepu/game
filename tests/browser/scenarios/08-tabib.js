'use strict';
// Tabib (penyembuh): tombol latih di Balai Kota (terkunci sampai Era Baja), klik kanan unit sendiri yang terluka
// → menyembuhkan, panel info, dan model beranimasi saat menyembuhkan.
const H = require('../helpers');

module.exports = async ({ page, check }) => {
  const p = await page();
  const step = n => p.ev(`(() => { const s = BF.game.s; for (let i = 0; i < ${n} && !s.over; i++) BF.step(s); })()`);
  await p.clickEl('#btn-start');
  await p.sleep(700);
  await p.ev(`(() => { const s = BF.game.s; s.players[1].isAI = false; s.animals.length = 0; s.players[0].res = { food: 900, wood: 900, gold: 900, stone: 900 }; s.players[0].popCap = 40; })()`);

  // tombol latih
  await p.key('h', 'KeyH', 72);
  await p.sleep(250);
  const btn = () => p.ev(`(() => { const i = BF.hud.buttons.findIndex(b => b && b.title === 'Latih Tabib'), b = BF.hud.buttons[i]; return b ? { i, locked: !!b.locked, kelas: document.querySelectorAll('#cmds .cmd')[i].className } : null; })()`);
  let b = await btn();
  check('Balai Kota: tombol Latih Tabib di slot kedua (W), terkunci di Era Perintis', !!b && b.i === 1 && b.locked && b.kelas.includes('locked'), b);
  await p.key('w', 'KeyW', 87);
  await p.sleep(150);
  check('W saat terkunci tidak melatih', await p.ev(`BF.ui.entities(BF.game.s)[0].queue.length === 0`));
  await p.ev(`(() => { const s = BF.game.s; s.players[0].era = 1; BF.rebuildDefs(s.players[0]); BF.hud.sig = ''; })()`);
  await p.sleep(250);
  b = await btn();
  check('Era Baja membuka Latih Tabib', !!b && !b.locked, b);
  await p.shot('60-balai-kota-tabib');
  await p.key('w', 'KeyW', 87);
  await p.sleep(200);
  check('W → Tabib masuk antrean, biaya dipotong', await p.ev(`(() => { const s = BF.game.s, q = BF.ui.entities(s)[0].queue; return q.length === 1 && q[0].unit === 'healer' && s.players[0].res.gold === 900 - BF.UNITS.healer.cost.gold; })()`));
  await step(20 * (await p.ev(`BF.UNITS.healer.time + 2`)));
  await p.sleep(300);
  const hid = await p.ev(`(BF.game.s.units.find(u => u.owner === 0 && u.type === 'healer') || {}).id`);
  check('Tabib selesai dilatih', typeof hid === 'number');

  // prajurit terluka di dekatnya; Tabib bersikap Diam supaya hanya bertindak atas perintah
  const sid = await p.ev(`(() => { const s = BF.game.s, h = s.byId.get(${hid}), f = BF.findFreeNear(s.map, Math.round(h.x + 4), Math.round(h.y + 1), 4, 0), u = BF.spawnUnit(s, 'spear', 0, f.x + 0.5, f.y + 0.5); u.hp = 15; h.stance = 2; BF.ui.select([h.id]); BF.input.centerOn(h.x + 2, h.y); return u.id; })()`);
  await p.sleep(350);
  const info = await p.ev(`document.getElementById('info-body').textContent`);
  check('panel info Tabib: laju pulih, jangkauan, dan sikap (bukan nilai serang)', info.includes('Tabib') && info.includes('Pulih') && info.includes('Jangkauan') && !info.includes('Serang') && info.includes('Sikap: Diam'), info.slice(0, 120));
  const sikap = await p.ev(`BF.hud.buttons.slice(8, 11).map(b => b && (b.title + '|' + b.desc + '|' + +!!b.active))`);
  check('panel Tabib: tiga tombol sikap dengan keterangan penyembuh, Diam menyala', sikap.every(Boolean) && sikap[0].includes('terluka') && sikap[2].startsWith('Sikap: Diam|Hanya menyembuhkan atas perintah.|1'), sikap);
  const pt = await p.ev(H.unitPoint(String(sid)));
  await p.click(pt.x, pt.y, 'right');
  await p.sleep(200);
  check('klik kanan unit sendiri yang terluka → perintah menyembuhkan', await p.ev(`(() => { const o = BF.game.s.byId.get(${hid}).order; return o.type === 'heal' && o.tid === ${sid}; })()`), await p.ev(`BF.game.s.byId.get(${hid}).order`));
  await step(20 * 5);
  await p.sleep(500);
  const st = await p.ev(`(() => { const s = BF.game.s, h = s.byId.get(${hid}), u = s.byId.get(${sid}), g = BF.gfx.unitGroup(h.id); return { hp: u.hp, working: h.working, jarak: BF.dist(h.x - u.x, h.y - u.y), klip: g && g.userData.cur }; })()`);
  check('Tabib mendekat dan memulihkan nyawa', st.hp > 20 && st.working && st.jarak < 3.2, st);
  check('model Tabib memutar klip kerja saat menyembuhkan', st.klip === 'kerja', st);
  await p.ev(`BF.hud.infoAt = 0`);
  await p.sleep(300);
  check('panel info: status "Menyembuhkan"', (await p.ev(`document.getElementById('info-body').textContent`)).includes('Menyembuhkan'));
  await p.shot('61-tabib-menyembuhkan');
  check('tanpa galat halaman', p.errors.length === 0, p.errors.slice(0, 3));
};
