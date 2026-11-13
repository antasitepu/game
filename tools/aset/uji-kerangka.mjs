// Uji ujung-ke-ujung alur aset berkerangka. Blender membuat model uji + rujukan posisi vertex (tools/aset/blender/contoh.py),
// lalu dua jalur diuji sampai ke js/assets.js di Node dengan three.js asli, dan hasil skinning dibandingkan dengan Blender:
//   langsung: GLB berkerangka → olah.mjs → assets.js
//   mixamo:   tiruan unduhan Mixamo (FBX) → blender/gabung.py → olah.mjs → assets.js (jari dilebur, gerak akar dibuang)
// Ditambah blender/rapikan.py pada tiruan model AI mentah. Semua aset game lain ikut dimuat dari salinan folder assets/
// untuk memastikan pemuatnya tetap kompatibel.
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
let lulus = 0, gagal = 0;
const cek = (nama, ok, rinci) => { ok ? lulus++ : gagal++; console.log((ok ? 'PASS ' : 'FAIL ') + nama + (rinci !== undefined ? '  → ' + rinci : '')); };
function jalankan(cmd, args, env) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', env: Object.assign({}, process.env, env) });
  if (r.status !== 0 || /^Traceback/m.test(r.stdout + r.stderr)) { console.log((r.stdout || '') + (r.stderr || '') + (r.error ? r.error.message : '')); throw new Error(path.basename(args[3] || cmd) + ' gagal (status ' + r.status + ')'); }
  return r.stdout;
}
const blender = (skrip, args) => jalankan(process.env.BLENDER || 'blender', ['--background', '--factory-startup', '--python', path.join(DI_SINI, 'blender', skrip), '--', ...args]);
const ringkasan = (keluaran, label) => JSON.parse(keluaran.split('\n').find(l => l.startsWith(label + ' ')).slice(label.length + 1));

// three.js asli + js/assets.js; fetch & pemuat tekstur diganti versi berkas lokal dari folder ASET jalur yang sedang diuji
const THREE = globalThis.THREE = createRequire(import.meta.url)(path.join(AKAR, 'js', 'vendor', 'three.min.js'));
let ASET = null;
const berkas = url => path.join(ASET, url.replace(/^assets\//, ''));
globalThis.fetch = async url => {
  if (!fs.existsSync(berkas(url))) return { ok: false, status: 404 };
  const b = fs.readFileSync(berkas(url));
  return { ok: true, json: async () => JSON.parse(b.toString('utf8')), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};
THREE.TextureLoader.prototype.load = function (url, onLoad, _, onError) {
  if (!fs.existsSync(berkas(url))) { onError(); return null; }
  const t = new THREE.Texture();
  setTimeout(() => onLoad(t));
  return t;
};
const sumberAssets = fs.readFileSync(path.join(AKAR, 'js', 'assets.js'), 'utf8');

const kotak = a => { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < a.length; i += 3) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], a[i + c]); mx[c] = Math.max(mx[c], a[i + c]); } return { mn, mx }; };
// jarak terjauh dari tiap vertex a ke vertex b terdekat (vertex hasil ekspor/olah adalah salinan/subset vertex Blender)
function jarakMaks(a, b) {
  let maks = 0;
  for (let i = 0; i < a.length; i += 3) {
    let d = Infinity;
    for (let j = 0; j < b.length; j += 3) { const e = (a[i] - b[j]) ** 2 + (a[i + 1] - b[j + 1]) ** 2 + (a[i + 2] - b[j + 2]) ** 2; if (e < d) d = e; }
    maks = Math.max(maks, Math.sqrt(d));
  }
  return maks;
}
const rata = a => { const m = [0, 0, 0]; for (let i = 0; i < a.length; i++) m[i % 3] += a[i] / (a.length / 3); return m; };

// ---------------------------------------------------------------- model uji
const CONTOH = path.join(KERJA, 'contoh');
blender('contoh.py', [CONTOH, '--mixamo', '--ai']);
const ruj = JSON.parse(fs.readFileSync(path.join(CONTOH, 'rujukan.json'), 'utf8'));

async function ujiJalur(label, glb, tanpaGerakAkar) {
  console.log('\n## ' + label);
  const SUMBER = path.join(KERJA, label, 'sumber');
  ASET = path.join(KERJA, label, 'aset');
  fs.mkdirSync(SUMBER, { recursive: true });
  fs.copyFileSync(glb, path.join(SUMBER, 'pekerja.glb'));
  fs.cpSync(path.join(AKAR, 'assets'), ASET, { recursive: true });
  const keluaran = jalankan(process.execPath, [path.join(DI_SINI, 'olah.mjs'), 'pekerja'], { SUMBER, KELUAR: ASET });
  process.stdout.write(keluaran.split('\n').filter(l => /pekerja/.test(l)).map(l => '  olah: ' + l.trim() + '\n').join(''));

  globalThis.BF = {};
  vm.runInThisContext(sumberAssets, { filename: 'assets.js' });
  await BF.assets.muat();
  const man = JSON.parse(fs.readFileSync(path.join(ASET, 'manifest.json'), 'utf8'));
  cek('semua model di manifest termuat (kompatibel dengan aset lama)', Object.keys(man.model).every(n => BF.assets.model[n] && BF.assets.model[n].lod.length), Object.keys(man.model).length + ' model');
  const model = BF.assets.model.pekerja, tulang = model.kerangka.tulang;
  cek('nama tulang tanpa awalan "mixamorig:"', tulang.every(t => !/[:.]/.test(t.nama)) && tulang.some(t => t.nama === 'Hips'));
  cek('klip diam, jalan, serang ada', ['diam', 'jalan', 'serang'].every(n => model.klip[n]), Object.keys(model.klip).join(', '));

  const geo = model.lod[0], { akar, skeleton } = BF.assets.kerangkaBaru(model);
  const mesh = new THREE.SkinnedMesh(geo, model.bahan[0]);
  akar.forEach(b => mesh.add(b));
  mesh.bind(skeleton);
  const nv = geo.attributes.position.count, v3 = new THREE.Vector3();
  const posisiSkin = () => {
    mesh.updateMatrixWorld(true);
    const out = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) { v3.fromBufferAttribute(geo.attributes.position, i); mesh.boneTransform(i, v3); out.set([v3.x, v3.y, v3.z], i * 3); }
    return out;
  };

  const istirahat = posisiSkin(), kI = kotak(istirahat), kR = kotak(ruj.istirahat), tinggi = kI.mx[1] - kI.mn[1];
  cek('tinggi pose istirahat = 0,86 tile, kaki di y = 0', Math.abs(tinggi - 0.86) < 1e-3 && Math.abs(kI.mn[1]) < 1e-3, 'tinggi ' + tinggi.toFixed(4) + ', y min ' + kI.mn[1].toFixed(4));
  cek('pose istirahat sama dengan geometri tersimpan', jarakMaks(istirahat, geo.attributes.position.array) < 1e-5);
  // rujukan Blender → ruang game: skala seragam + geser (dari pose istirahat)
  const s = tinggi / (kR.mx[1] - kR.mn[1]), geser = [0, 1, 2].map(c => (c === 1 ? kI.mn[1] - kR.mn[1] * s : (kI.mn[c] + kI.mx[c]) / 2 - (kR.mn[c] + kR.mx[c]) / 2 * s));
  const keGame = a => Float32Array.from(a, (x, i) => x * s + geser[i % 3]);
  const BATAS = 0.005 * tinggi, selisih = jarakMaks(istirahat, keGame(ruj.istirahat));
  cek('pose istirahat cocok dengan Blender', selisih < BATAS, (selisih / tinggi * 100).toFixed(3) + '% tinggi');

  const mixer = new THREE.AnimationMixer(mesh);
  for (const nama of Object.keys(ruj.klip)) {
    const klip = model.klip[nama], sampel = ruj.klip[nama];
    if (!klip) continue;
    const aksi = mixer.clipAction(klip);
    aksi.setLoop(THREE.LoopOnce, 1);
    aksi.clampWhenFinished = true;
    aksi.play();
    // gerak akar di rujukan: pergeseran mendatar rata-rata tubuh dari awal ke akhir klip; jalur mixamo harus membuangnya secara linear
    const T = sampel[sampel.length - 1].t, m0 = rata(sampel[0].v), m1 = rata(sampel[sampel.length - 1].v), maju = [m1[0] - m0[0], 0, m1[2] - m0[2]];
    let terburuk = 0, gerak = 0;
    for (const smp of sampel) {
      mixer.setTime(smp.t);
      const p = posisiSkin(), k = tanpaGerakAkar ? smp.t / T : 0;
      terburuk = Math.max(terburuk, jarakMaks(p, keGame(smp.v.map((x, i) => x - maju[i % 3] * k))));
      gerak = Math.max(gerak, jarakMaks(p, istirahat));
    }
    const ket = Math.hypot(maju[0], maju[2]) > 0.01 ? (tanpaGerakAkar ? ', gerak akar ' + (Math.hypot(maju[0], maju[2]) * s).toFixed(3) + ' tile dibuang' : ', dengan gerak akar') : '';
    cek('klip ' + nama + ': gerak sama dengan Blender (' + sampel.length + ' sampel' + ket + ')', terburuk < BATAS && gerak > 2 * BATAS, 'selisih maks ' + (terburuk / tinggi * 100).toFixed(3) + '% tinggi, gerak maks ' + (gerak / tinggi * 100).toFixed(1) + '% tinggi');
    aksi.stop();
  }
  console.log('  m/pekerja.bin ' + (fs.statSync(path.join(ASET, man.model.pekerja.file)).size / 1024).toFixed(0) + ' KB, ' + tulang.length + ' tulang, ' + geo.index.count / 3 + ' segitiga');
  return model;
}

const langsung = await ujiJalur('langsung', path.join(CONTOH, 'pekerja.glb'), false);
cek('tulang jari ada di jalur langsung', langsung.kerangka.tulang.some(t => /HandIndex1/.test(t.nama)));

const gab = ringkasan(blender('gabung.py', [path.join(CONTOH, 'mixamo'), path.join(KERJA, 'gabung', 'pekerja.glb')]), 'GABUNG');
const mix = await ujiJalur('mixamo', gab.glb, true);
cek('gabung.py: jari dilebur ke tangan', gab.jari_dilebur === 4 && !mix.kerangka.tulang.some(t => /Hand(Thumb|Index)/.test(t.nama)), mix.kerangka.tulang.length + ' tulang');
cek('gabung.py: gerak akar klip jalan terdeteksi', Math.abs(gab.klip.jalan.geser_akar_m - 0.2) < 0.005, gab.klip.jalan.geser_akar_m + ' m');

console.log('\n## rapikan (model AI mentah → FBX untuk Mixamo)');
const rap = ringkasan(blender('rapikan.py', [path.join(CONTOH, 'pekerja-ai.glb'), path.join(KERJA, 'rapikan', 'pekerja-mixamo.fbx'), '--segitiga', '3000']), 'RAPIKAN');
cek('disederhanakan ke target', rap.segitiga_awal > 3000 && rap.segitiga <= 3000, rap.segitiga_awal + ' → ' + rap.segitiga + ' segitiga');
cek('tinggi 1,75 m (skala Mixamo)', Math.abs(rap.ukuran[2] - 1.75) < 1e-3, rap.ukuran.join(' × ') + ' m');
cek('tekstur ikut, FBX & pratinjau tertulis', rap.tekstur >= 1 && [rap.fbx, ...rap.pratinjau].every(f => fs.existsSync(f) && fs.statSync(f).size > 0));

console.log('\n' + lulus + ' lulus, ' + gagal + ' gagal   (folder kerja: ' + KERJA + ')');
process.exit(gagal ? 1 : 0);
