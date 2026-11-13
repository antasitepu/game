'use strict';
// Tes end-to-end di browser headless (klik, drag, dan tombol sungguhan).
// Jalankan: node --experimental-websocket tests/browser/run.js [nama-skenario ...]
// Screenshot disimpan ke $SHOTS (default: folder sementara OS).
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');
const { launch, sleep } = require('./cdp');

const root = path.join(__dirname, '..', '..');
const out = process.env.SHOTS || path.join(os.tmpdir(), 'benteng-fajar-shots');
const dir = path.join(__dirname, 'scenarios');
const names = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3)).sort();

(async () => {
  fs.mkdirSync(out, { recursive: true });
  // Game memuat aset lewat HTTP, jadi halaman dibuka dari server.js sungguhan (bukan file://).
  const PORT = 8600 + (process.pid % 90);
  const srv = spawn(process.execPath, [path.join(root, 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1' }), stdio: 'ignore' });
  await sleep(700);
  let pass = 0, fail = 0, port = 9400;
  for (const name of names) {
    console.log('\n## ' + name);
    const browser = await launch(out, port++);
    const pages = [];
    const ctx = {
      root, out, url: 'http://127.0.0.1:' + PORT + '/',
      // halaman dianggap siap setelah aset termuat dan game terinisialisasi
      async page(url) {
        const p = await browser.page(url || ctx.url);
        pages.push(p);
        for (let i = 0; i < 100 && !(await p.ev('!!(window.BF && BF.game && BF.game.ready)')); i++) await sleep(100);
        return p;
      },
      check(label, ok, detail) {
        ok ? pass++ : fail++;
        console.log((ok ? 'PASS ' : 'FAIL ') + label + (detail !== undefined ? '  → ' + JSON.stringify(detail) : ''));
      },
    };
    try { await require(path.join(dir, name))(ctx); }
    catch (e) { fail++; console.log('FAIL skenario berhenti: ' + e.message); }
    const errors = pages.flatMap(p => p.errors);
    ctx.check('tanpa error JavaScript', errors.length === 0, errors.length ? errors.slice(0, 5) : undefined);
    browser.close();
  }
  srv.kill();
  console.log(`\nHASIL: ${pass} lulus, ${fail} gagal   (screenshot: ${out})`);
  process.exit(fail ? 1 : 0);
})();
