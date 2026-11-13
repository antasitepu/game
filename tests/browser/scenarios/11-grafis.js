'use strict';
// Mutu grafis: Tinggi (bawaan di komputer) dan Hemat (30 gambar per detik, resolusi 1×, tanpa bayangan). Simulasi
// harus tetap berjalan sama cepat di kedua mode, pilihan tersimpan, dan perangkat sentuh memulai dengan Hemat.
module.exports = async ({ page, check }) => {
  const p = await page();
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
  await p.ev(`window.dispatchEvent(new Event('resize'))`);      // kerapatan piksel berubah tanpa mengubah ukuran jendela
  await p.sleep(300);
  await p.clickEl('#btn-start');
  await p.sleep(700);
  await p.ev(`(() => { const r = BF.render; window.__gambar = 0; BF.render = o => { window.__gambar++; return r(o); }; })()`);
  // jumlah gambar dan tick simulasi dalam dua detik
  const laju = async () => { const a = await p.ev(`({ g: window.__gambar, t: BF.game.s.tick, w: performance.now() })`); await p.sleep(2000); const b = await p.ev(`({ g: window.__gambar, t: BF.game.s.tick, w: performance.now() })`), d = (b.w - a.w) / 1000; return { fps: +((b.g - a.g) / d).toFixed(1), tps: +((b.t - a.t) / d).toFixed(1) }; };
  const info = () => p.ev(`(({ mutu, rasio, bayangan }) => ({ mutu, rasio, bayangan }))(BF.gfx.info())`);

  let i = await info(), l = await laju();
  check('komputer: bawaan mutu Tinggi (resolusi 2×, bayangan)', i.mutu === 'tinggi' && i.rasio === 2 && i.bayangan === true, i);
  check('Tinggi: ±60 gambar per detik, simulasi 20 tick per detik', l.fps > 45 && l.tps > 17 && l.tps < 23, l);
  await p.shot('80-grafis-tinggi');

  await p.clickEl('#btn-menu');
  await p.sleep(200);
  check('Menu menampilkan pilihan grafis', (await p.ev(`document.getElementById('m-gfx').textContent`)) === 'Grafis: Tinggi');
  await p.clickEl('#m-gfx');
  await p.sleep(200);
  check('tombol beralih ke Hemat', (await p.ev(`document.getElementById('m-gfx').textContent`)).startsWith('Grafis: Hemat'));
  await p.clickEl('#m-resume');
  await p.sleep(600);
  i = await info(); l = await laju();
  check('Hemat: resolusi 1×, tanpa bayangan', i.mutu === 'hemat' && i.rasio === 1 && i.bayangan === false, i);
  check('Hemat: ±30 gambar per detik, simulasi tetap 20 tick per detik', l.fps > 22 && l.fps < 36 && l.tps > 17 && l.tps < 23, l);
  check('tanpa galat setelah beralih mutu', p.errors.length === 0, p.errors.slice(0, 3));
  await p.shot('81-grafis-hemat');

  // tersimpan: setelah halaman dimuat ulang tetap Hemat
  await p.send('Page.reload');
  for (let k = 0; k < 100 && !(await p.ev('!!(window.BF && BF.game && BF.game.ready)').catch(() => false)); k++) await p.sleep(100);
  check('pilihan tersimpan setelah halaman dimuat ulang', await p.ev(`BF.gfx.quality === 'hemat' && localStorage.getItem('bf.grafis') === 'hemat'`));
  await p.ev(`BF.gfx.setQuality('tinggi')`);                    // di menu awal, sebelum permainan dimulai
  i = await info();
  check('kembali ke Tinggi: resolusi dan bayangan pulih', i.mutu === 'tinggi' && i.rasio === 2 && i.bayangan === true, i);

  // perangkat sentuh tanpa pilihan tersimpan: mulai dengan Hemat
  await p.ev(`localStorage.removeItem('bf.grafis')`);
  await p.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 400, deviceScaleFactor: 2.5, mobile: true });
  await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await p.send('Page.reload');
  for (let k = 0; k < 100 && !(await p.ev('!!(window.BF && BF.game && BF.game.ready)').catch(() => false)); k++) await p.sleep(100);
  const kasar = await p.ev(`matchMedia('(pointer: coarse)').matches`);
  check('perangkat sentuh: bawaan mutu Hemat', kasar && await p.ev(`BF.gfx.quality === 'hemat'`), { pointerKasar: kasar, mutu: await p.ev(`BF.gfx.quality`) });
  await p.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await p.send('Emulation.clearDeviceMetricsOverride');
  await p.ev(`localStorage.removeItem('bf.grafis')`);
};
