'use strict';
// Lebih dari dua pemain (semua lawan semua, lawan AI): pilihan jumlah lawan di menu, permainan 3 dan 4 pemain,
// pemain tumbang di tengah permainan, layar akhir berkolom banyak (kalah, menyerah, menang), lalu kembali ke 2 pemain.
module.exports = async ({ page, check }) => {
  const p = await page();
  const step = n => p.ev(`(() => { const s = BF.game.s; for (let i = 0; i < ${n} && !s.over; i++) BF.step(s); })()`);
  const raze = pid => p.ev(`(() => { const s = BF.game.s; for (const b of s.buildings.slice()) if (b.owner === ${pid} && !b.dead) BF.kill(s, b); })()`);
  const foes = n => p.ev(`document.querySelectorAll('#foes .choice')[${n - 1}].click()`);
  const menu = () => p.ev(`({ foes: BF.menu.foes, off: document.getElementById('foe').disabled, val: document.getElementById('foe').value, on: [...document.querySelectorAll('#foes .choice')].map(e => +e.classList.contains('on')).join('') })`);
  const end = () => p.ev(`({ over: BF.game.s.over, winner: BF.game.s.winner, shown: !document.getElementById('overlay-end').classList.contains('hidden'), title: document.getElementById('end-title').textContent, text: document.getElementById('end-text').textContent,
    head: [...document.querySelectorAll('.end-table tr:first-child th')].map(e => e.textContent), row2: [...document.querySelectorAll('.end-table tr:nth-child(2) td')].map(e => e.textContent),
    lines: document.querySelectorAll('.end-chart svg path').length, legend: document.querySelectorAll('.ec-legend span').length, many: document.querySelector('#overlay-end .card').classList.contains('many'),
    fits: (() => { const t = document.querySelector('.end-table').getBoundingClientRect(), c = document.querySelector('.end-chart').getBoundingClientRect(); return t.right <= c.left + 1; })() })`);
  const state = () => p.ev(`(() => { const s = BF.game.s; return { n: s.players.length, ai: s.players.map(q => +q.isAI).join(''), fac: s.players.map(q => q.faction), col: s.players.map(q => q.color), th: s.players.map(q => s.buildings.filter(b => b.owner === q.id && b.type === 'townhall').length).join(''), out: s.players.map(q => +!!q.out).join(''), over: s.over }; })()`);
  const distinct = a => new Set(a).size === a.length;

  // ---- menu
  let m = await menu();
  check('menu: bawaan satu lawan, wangsa lawan bisa dipilih', m.foes === 1 && !m.off && m.on === '100', m);
  await p.ev(`(() => { const f = document.getElementById('foe'); f.value = 'bara'; f.dispatchEvent(new Event('change')); })()`);
  await foes(3);
  m = await menu();
  check('tiga lawan: wangsa lawan dikunci Acak', m.foes === 3 && m.off && m.val === 'random' && m.on === '001', m);
  await foes(1);
  m = await menu();
  check('kembali satu lawan: pilihan wangsa lawan pulih', m.foes === 1 && !m.off && m.val === 'bara', m);

  // ---- 3 pemain
  await foes(2);
  await p.clickEl('#btn-start');
  await p.sleep(700);
  let st = await state();
  check('dua lawan → permainan 3 pemain, wangsa & warna berbeda, masing-masing satu Balai Kota', st.n === 3 && st.ai === '011' && distinct(st.fac) && distinct(st.col) && st.th === '111', st);
  await p.ev(`BF.game.stop(); BF.menu.toStart()`);
  await p.sleep(300);

  // ---- 4 pemain
  await foes(3);
  await p.clickEl('#btn-start');
  await p.sleep(700);
  st = await state();
  check('tiga lawan → permainan 4 pemain (keempat wangsa), tiga AI', st.n === 4 && st.ai === '0111' && distinct(st.fac) && distinct(st.col) && st.th === '1111', st);
  check('pesan awal menyebut semua lawan', (await p.ev(`document.getElementById('toast').textContent`)).includes('semua lawan'));
  await step(20 * 60 * 4);
  await p.sleep(500);
  check('4 menit berjalan: ketiga AI membangun, tanpa galat', await p.ev(`(() => { const s = BF.game.s; return !s.over && [1, 2, 3].every(i => s.buildings.filter(b => b.owner === i).length >= 3 && s.units.filter(u => u.owner === i).length >= 6); })()`) && p.errors.length === 0, p.errors.slice(0, 3));
  await p.ev(`BF.game.s.fog.explored.fill(1)`);
  await p.shot('50-empat-pemain');

  // pemain tumbang di tengah permainan
  await raze(3);
  await step(21);
  await p.sleep(400);
  st = await state();
  check('lawan tanpa bangunan tumbang: miliknya musnah, permainan lanjut, ada pemberitahuan', st.out === '0001' && !st.over && await p.ev(`BF.game.s.units.every(u => u.owner !== 3) && BF.game.s.buildings.every(b => b.owner !== 3)`) && /Toska.*tumbang/.test(await p.ev(`document.getElementById('toast').textContent`)), st);
  await step(20 * 30);
  check('permainan tetap berjalan setelah satu pemain tumbang', await p.ev(`!BF.game.s.over && BF.game.s.tick > 20 * 60 * 4 + 600`) && p.errors.length === 0, p.errors.slice(0, 3));

  // pemain di layar ini kehilangan semua bangunan saat dua AI masih bertahan → kalah
  await raze(0);
  await step(21);
  await p.sleep(600);
  let e = await end();
  check('pemain manusia tumbang → Kekalahan walau AI lain masih bertahan', e.over && e.winner === -1 && e.shown && e.title === 'Kekalahan' && e.text === 'Permukiman kita telah jatuh.', e);
  check('layar akhir 4 pemain: kolom Kamu + tiga warna lawan, baris hasil', e.head.length === 5 && e.head[1].startsWith('Kamu') && e.head[2].startsWith('Merah') && e.head[3].startsWith('Kuning') && e.head[4].startsWith('Toska') && e.row2.join('|') === 'Hasil|Tumbang|Bertahan|Bertahan|Tumbang', { head: e.head, row2: e.row2 });
  check('grafik skor 4 seri + legenda, tabel tidak menimpa grafik', e.lines === 4 && e.legend === 4 && e.many && e.fits, e);
  await p.shot('51-akhir-empat-pemain');

  // menyerah
  await p.clickEl('#btn-again');
  await p.sleep(300);
  await p.clickEl('#btn-start');
  await p.sleep(700);
  await p.ev(`BF.resign(BF.game.s, BF.game.s.human)`);
  await p.sleep(500);
  e = await end();
  check('menyerah di permainan 4 pemain → selesai, "Kamu menyerah."', e.over && e.title === 'Kekalahan' && e.text === 'Kamu menyerah.' && e.row2.join('|') === 'Hasil|Tumbang|Bertahan|Bertahan|Bertahan', e);

  // menang: ketiga lawan tumbang
  await p.clickEl('#btn-again');
  await p.sleep(300);
  await p.clickEl('#btn-start');
  await p.sleep(700);
  await step(20 * 20);
  await raze(1); await raze(2);
  await step(21);
  check('dua lawan tumbang, satu tersisa: belum selesai', await p.ev(`!BF.game.s.over && BF.game.s.players.map(q => +!!q.out).join('') === '0110'`));
  await raze(3);
  await step(21);
  await p.sleep(600);
  e = await end();
  check('semua lawan tumbang → Kemenangan!', e.over && e.winner === 0 && e.title === 'Kemenangan!' && e.row2.join('|') === 'Hasil|Menang|Tumbang|Tumbang|Tumbang', e);
  await p.shot('52-menang-empat-pemain');

  // kembali ke dua pemain: layar akhir seperti semula
  await p.clickEl('#btn-again');
  await p.sleep(300);
  await foes(1);
  await p.clickEl('#btn-start');
  await p.sleep(700);
  st = await state();
  await raze(1);
  await step(21);
  await p.sleep(600);
  e = await end();
  check('satu lawan sesudahnya: 2 pemain, layar akhir dua kolom tanpa baris hasil', st.n === 2 && st.fac[1] === 'bara' && e.title === 'Kemenangan!' && e.head.length === 3 && e.head[2].startsWith('Lawan') && e.row2[0] === 'Skor' && e.lines === 2 && !e.many, { st, head: e.head, row2: e.row2 });
};
