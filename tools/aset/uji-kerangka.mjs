// Uji ujung-ke-ujung dukungan model berkerangka: Blender membuat model uji (tools/aset/blender/contoh.py) → olah.mjs
// (resep pekerja) → js/assets.js di Node dengan three.js asli → hasil skinning dibandingkan dengan posisi vertex Blender.
// Semua aset game lain ikut dimuat dari salinan folder assets/ untuk memastikan pemuatnya tetap kompatibel.
//
//   node tools/aset/uji-kerangka.mjs        (butuh Blender: di PATH, atau lewat variabel BLENDER)
// Folder kerja sementara: $KERJA (bawaan: folder sementara OS). Folder assets/ proyek tidak diubah.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const DI_SINI = path.dirname(fileURLToPath(import.meta.url)), AKAR = path.join(DI_SINI, '..', '..');
const KERJA = fs.mkdtempSync(path.join(process.env.KERJA || os.tmpdir(), 'uji-kerangka-'));
const SUMBER = path.join(KERJA, 'sumber'), ASET = path.join(KERJA, 'aset');
let lulus = 0, gagal = 0;
const cek = (nama, ok, rinci) => { ok ? lulus++ : gagal++; console.log((ok ? 'PASS ' : 'FAIL ') + nama + (rinci !== undefined ? '  → ' + rinci : '')); };
function jalankan(cmd, args, env) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', env: Object.assign({}, process.env, env) });
  if (r.status !== 0) { console.log((r.stdout || '') + (r.stderr || '') + (r.error ? r.error.message : '')); throw new Error(path.basename(cmd) + ' gagal (status ' + r.status + ')'); }
  return r.stdout;
}

// 1. model uji + rujukan dari Blender
jalankan(process.env.BLENDER || 'blender', ['--background', '--factory-startup', '--python', path.join(DI_SINI, 'blender', 'contoh.py'), '--', SUMBER]);
const ruj = JSON.parse(fs.readFileSync(path.join(SUMBER, 'rujukan.json'), 'utf8'));

// 2. olah ke salinan folder assets
fs.cpSync(path.join(AKAR, 'assets'), ASET, { recursive: true });
const keluaran = jalankan(process.execPath, [path.join(DI_SINI, 'olah.mjs'), 'pekerja'], { SUMBER, KELUAR: ASET });
process.stdout.write(keluaran.split('\n').filter(l => /pekerja|catatan/.test(l)).map(l => '  olah: ' + l.trim() + '\n').join(''));

// 3. muat dengan js/assets.js asli (fetch & pemuat tekstur diganti versi berkas lokal)
const THREE = globalThis.THREE = createRequire(import.meta.url)(path.join(AKAR, 'js', 'vendor', 'three.min.js'));
globalThis.BF = {};
globalThis.fetch = async url => {
  const f = path.join(ASET, url.replace(/^assets\//, ''));
  if (!fs.existsSync(f)) return { ok: false, status: 404 };
  const b = fs.readFileSync(f);
  return { ok: true, json: async () => JSON.parse(b.toString('utf8')), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};
THREE.TextureLoader.prototype.load = function (url, onLoad, _, onError) {
  if (!fs.existsSync(path.join(ASET, url.replace(/^assets\//, '')))) { onError(); return null; }
  const t = new THREE.Texture();
  setTimeout(() => onLoad(t));
  return t;
};
vm.runInThisContext(fs.readFileSync(path.join(AKAR, 'js', 'assets.js'), 'utf8'), { filename: 'assets.js' });
await BF.assets.muat();
const man = JSON.parse(fs.readFileSync(path.join(ASET, 'manifest.json'), 'utf8'));
cek('semua model di manifest termuat (kompatibel dengan aset lama)', Object.keys(man.model).every(n => BF.assets.model[n] && BF.assets.model[n].lod.length), Object.keys(man.model).length + ' model');

const model = BF.assets.model.pekerja;
cek('model pekerja punya kerangka & klip', !!(model && model.kerangka && model.klip));
cek('nama tulang tanpa awalan "mixamorig:"', model.kerangka.tulang.every(t => !/[:.]/.test(t.nama)) && model.kerangka.tulang.some(t => t.nama === 'Hips'));
cek('klip diam, jalan, serang ada', ['diam', 'jalan', 'serang'].every(n => model.klip[n]), Object.keys(model.klip).join(', '));

// 4. bangun SkinnedMesh dan bandingkan posisi hasil skinning dengan Blender
const geo = model.lod[0], { akar, skeleton } = BF.assets.kerangkaBaru(model);
const mesh = new THREE.SkinnedMesh(geo, model.bahan[0]);
akar.forEach(b => mesh.add(b));
mesh.bind(skeleton);
const nv = geo.attributes.position.count, v3 = new THREE.Vector3();
function posisiSkin() {
  mesh.updateMatrixWorld(true);
  const out = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) { v3.fromBufferAttribute(geo.attributes.position, i); mesh.boneTransform(i, v3); out.set([v3.x, v3.y, v3.z], i * 3); }
  return out;
}
const kotak = a => { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < a.length; i += 3) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], a[i + c]); mx[c] = Math.max(mx[c], a[i + c]); } return { mn, mx }; };
// jarak terjauh dari tiap vertex three.js ke vertex rujukan terdekat (vertex hasil ekspor/olah adalah salinan/subset vertex Blender)
function jarakMaks(a, b) {
  let maks = 0;
  for (let i = 0; i < a.length; i += 3) {
    let d = Infinity;
    for (let j = 0; j < b.length; j += 3) { const e = (a[i] - b[j]) ** 2 + (a[i + 1] - b[j + 1]) ** 2 + (a[i + 2] - b[j + 2]) ** 2; if (e < d) d = e; }
    maks = Math.max(maks, Math.sqrt(d));
  }
  return maks;
}

const istirahat = posisiSkin(), kI = kotak(istirahat), kR = kotak(ruj.istirahat), tinggi = kI.mx[1] - kI.mn[1];
cek('tinggi pose istirahat = 0,86 tile, kaki di y = 0', Math.abs(tinggi - 0.86) < 1e-3 && Math.abs(kI.mn[1]) < 1e-3, 'tinggi ' + tinggi.toFixed(4) + ', y min ' + kI.mn[1].toFixed(4));
cek('pose istirahat sama dengan geometri tersimpan', jarakMaks(istirahat, geo.attributes.position.array) < 1e-5);
// rujukan Blender → ruang game: skala seragam + geser (dari pose istirahat)
const s = tinggi / (kR.mx[1] - kR.mn[1]), geser = [0, 1, 2].map(c => (c === 1 ? kI.mn[1] - kR.mn[1] * s : (kI.mn[c] + kI.mx[c]) / 2 - (kR.mn[c] + kR.mx[c]) / 2 * s));
const keGame = a => Float32Array.from(a, (x, i) => x * s + geser[i % 3]);
const BATAS = 0.005 * tinggi;
cek('pose istirahat cocok dengan Blender', jarakMaks(istirahat, keGame(ruj.istirahat)) < BATAS, (jarakMaks(istirahat, keGame(ruj.istirahat)) / tinggi * 100).toFixed(3) + '% tinggi');

const mixer = new THREE.AnimationMixer(mesh);
for (const nama of Object.keys(ruj.klip)) {
  const klip = model.klip[nama];
  if (!klip) continue;
  const aksi = mixer.clipAction(klip);
  aksi.setLoop(THREE.LoopOnce, 1);
  aksi.clampWhenFinished = true;
  aksi.play();
  let terburuk = 0, gerak = 0;
  for (const smp of ruj.klip[nama]) {
    mixer.setTime(smp.t);
    const p = posisiSkin();
    terburuk = Math.max(terburuk, jarakMaks(p, keGame(smp.v)));
    gerak = Math.max(gerak, jarakMaks(p, istirahat));
  }
  cek('klip ' + nama + ': gerak sama dengan Blender (' + ruj.klip[nama].length + ' sampel)', terburuk < BATAS && gerak > 2 * BATAS, 'selisih maks ' + (terburuk / tinggi * 100).toFixed(3) + '% tinggi, gerak maks ' + (gerak / tinggi * 100).toFixed(1) + '% tinggi');
  aksi.stop();
}
const ukuran = fs.statSync(path.join(ASET, man.model.pekerja.file)).size;
console.log('  ukuran m/pekerja.bin: ' + (ukuran / 1024).toFixed(0) + ' KB, ' + model.kerangka.tulang.length + ' tulang, ' + (geo.index.count / 3) + ' segitiga');
console.log('\n' + lulus + ' lulus, ' + gagal + ' gagal   (folder kerja: ' + KERJA + ')');
process.exit(gagal ? 1 : 0);
