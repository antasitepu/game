// Alat pengolah aset Benteng Fajar: model pindai/buatan (glTF/GLB) → model ringan untuk game + tekstur + langit HDRI.
//
//   node tools/aset/olah.mjs                 olah semua resep → folder assets/
//   node tools/aset/olah.mjs pohon0 batu0    olah resep tertentu saja
//   node tools/aset/olah.mjs --info <file>   periksa isi sebuah .gltf/.glb (bagian, bahan, jumlah segitiga, ukuran)
//
// Sumber diunduh sekali ke tools/aset/sumber/ (boleh dihapus; akan diunduh ulang bila perlu). Butuh macOS (sips).
// Model buatan sendiri yang tidak bisa diunduh ulang (mis. hasil generator AI) disimpan di tools/aset/buatan/ (ikut git).
// Variabel lingkungan SUMBER / BUATAN / KELUAR mengganti folder-folder itu (dipakai tools/aset/uji-kerangka.mjs).
// Satuan keluaran: 1 = 1 tile, Y ke atas, titik asal di kaki objek.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bacaGltf, bacaKerangka, normalkanKerangka } from './gltf.mjs';
import * as G from './mesh.mjs';
import * as I from './gambar.mjs';

const DI_SINI = path.dirname(fileURLToPath(import.meta.url));
const SUMBER = process.env.SUMBER || path.join(DI_SINI, 'sumber');
const BUATAN = process.env.BUATAN || path.join(DI_SINI, 'buatan');
const KELUAR = process.env.KELUAR ? path.resolve(process.env.KELUAR) : path.join(DI_SINI, '..', '..', 'assets');
const UA = { 'User-Agent': 'asset-pipeline/1.0' };

// Arah menuju matahari di dunia game; langit HDRI diputar mengikutinya dan game membacanya dari manifest.
const MATAHARI = [-9, 16, 4];

// ---------------------------------------------------------------- resep
// lod: dari paling rinci ke paling ringan. Angka = perkiraan jumlah segitiga (atau jumlah helai untuk daun).

const RESEP = {
  pohon0: { jenis: 'pohon', sumber: 'island_tree_01', tinggi: 3.3, rapat: 0.92, tekstur: 512, lod: [{ daun: 2000, dahan: 30, cabang: 420, batang: 420 }, { daun: 900, dahan: 12, cabang: 140, batang: 160 }, { daun: 300, dahan: 0, cabang: 0, batang: 60 }] },
  pohon1: { jenis: 'padat', sumber: 'quiver_tree_02', tinggi: 2.5, alas: 'kaki', tekstur: 512, lod: [2400, 900, 320] },
  pohon2: { jenis: 'pohon', sumber: 'island_tree_02', tinggi: 2.7, regangY: 1.2, rapat: 0.92, tekstur: 512, lod: [{ daun: 2000, dahan: 30, cabang: 420, batang: 420 }, { daun: 900, dahan: 12, cabang: 140, batang: 160 }, { daun: 300, dahan: 0, cabang: 0, batang: 60 }] },
  semak: { jenis: 'semak', sumber: 'searsia_lucida', node: [4], tinggi: 0.74, buah: 10, lod: [{ daun: 520, dahan: 14, batang: 160 }, { daun: 320, dahan: 6, batang: 60 }, { daun: 140, dahan: 0, batang: 0 }] },
  batu0: { jenis: 'padat', sumber: 'rock_moss_set_01', node: [3], lebar: 0.98, tanam: 0.06, tekstur: 512, normal: true, lod: [520, 220, 90] },
  batu1: { jenis: 'padat', sumber: 'rock_moss_set_01', node: [2], lebar: 0.98, tanam: 0.06, tekstur: 512, normal: true, lod: [520, 220, 90] },
  emas: { jenis: 'padat', sumber: 'namaqualand_boulder_03', lebar: 0.98, tanam: 0.05, tekstur: 512, normal: true, lod: [520, 220, 90], bongkah: { jumlah: 24, radius: 0.05 } },
  tong: { jenis: 'padat', sumber: 'wooden_barrels_01', node: [0], tinggi: 0.27, tekstur: 256, lod: [420] },
  // Kit benteng modular (dinding batu pindai). Modul lurus = tepat 1 tile; lengan = setengah modul dari tengah tile ke tepi;
  // pilar & menara = empat sisi dinding yang dipotong serong lalu disusun persegi.
  tembok_lurus: { jenis: 'benteng', sumber: 'modular_fort_01', node: 10, bentuk: 'lurus' },
  tembok_lengan: { jenis: 'benteng', sumber: 'modular_fort_01', node: 10, bentuk: 'lengan' },
  tembok_pilar: { jenis: 'benteng', sumber: 'modular_fort_01', node: 10, bentuk: 'menara', sisi: 0.5, tingkat: 1, regang: 1.15 },
  gerbang: { jenis: 'benteng', sumber: 'modular_fort_01', node: 12, bentuk: 'lurus' },
  menara: { jenis: 'benteng', sumber: 'modular_fort_01', node: 10, bentuk: 'menara', sisi: 0.68, tingkat: 3, regang: 1 },
  rumput0: { jenis: 'rumput', sumber: 'grass_medium_01', mesh: [1], tinggi: 0.16, bilah: 34, lebar: 0.014 },
  rumput1: { jenis: 'rumput', sumber: 'grass_medium_01', mesh: [9], tinggi: 0.14, bilah: 40, lebar: 0.014 },
  rumput2: { jenis: 'rumput', sumber: 'grass_medium_01', mesh: [4], tinggi: 0.24, bilah: 18, lebar: 0.012 },
  // Unit berkerangka & beranimasi: GLB sendiri (lokal) di sumber/<sumber>.glb, mis. model AI yang dirig & dianimasikan di
  // Mixamo lalu digabung di Blender. File itu sengaja di sumber/ (tidak masuk git): isinya animasi mentah Mixamo, yang tidak
  // boleh dibagikan ulang sebagai aset lepas. Selama belum ada, olah semua melewatinya. tinggi: puncak kepala unit buatan kode.
  pekerja: { jenis: 'kerangka', sumber: 'pekerja', lokal: true, tinggi: 0.86, tekstur: 512, lod: [3000] },
  // Unit manusia lain memakai skala yang sama dengan pekerja (bukan tinggi), supaya tombak/helm tidak mengecilkan badannya.
  tombak: { jenis: 'kerangka', sumber: 'tombak', lokal: true, skala: 0.86 / 1.771, tekstur: 512, lod: [3400] },
  pedang: { jenis: 'kerangka', sumber: 'pedang', lokal: true, skala: 0.86 / 1.771, tekstur: 512, lod: [3600] },
  pengawal: { jenis: 'kerangka', sumber: 'pengawal', lokal: true, skala: 0.86 / 1.771, tekstur: 512, lod: [3600] },
};
const TEKSTUR = {
  rumput: { sumber: 'forrest_ground_01', peta: 'Diffuse', ukuran: 1024, kualitas: 80 },
  rumputN: { sumber: 'forrest_ground_01', peta: 'nor_gl', ukuran: 512, kualitas: 85 },
  pasir: { sumber: 'coast_sand_01', peta: 'Diffuse', ukuran: 512, kualitas: 80 },
  // bahan bangunan (dipakai pustaka material di js/tex.js); akhiran N = peta normal
  bg_jerami: { sumber: 'reed_roof_04', peta: 'Diffuse', ukuran: 512, kualitas: 80 },
  bg_jeramiN: { sumber: 'reed_roof_04', peta: 'nor_gl', ukuran: 512, kualitas: 82 },
  bg_papan: { sumber: 'weathered_brown_planks', peta: 'Diffuse', ukuran: 512, kualitas: 80 },
  bg_papanN: { sumber: 'weathered_brown_planks', peta: 'nor_gl', ukuran: 512, kualitas: 82 },
  bg_batu: { sumber: 'castle_wall_slates', peta: 'Diffuse', ukuran: 512, kualitas: 80 },
  bg_batuN: { sumber: 'castle_wall_slates', peta: 'nor_gl', ukuran: 512, kualitas: 82 },
  bg_tanahliat: { sumber: 'roof_09', peta: 'Diffuse', ukuran: 512, kualitas: 80 },
  bg_tanahliatN: { sumber: 'roof_09', peta: 'nor_gl', ukuran: 512, kualitas: 82 },
  bg_plester: { sumber: 'white_rough_plaster', peta: 'Diffuse', ukuran: 512, kualitas: 80 },
  bg_genteng: { sumber: 'roof_slates_03', peta: 'Diffuse', ukuran: 512, kualitas: 80 },
  bg_gentengN: { sumber: 'roof_slates_03', peta: 'nor_gl', ukuran: 512, kualitas: 82 },
  bg_ladang: { sumber: 'farm_furrows', peta: 'Diffuse', ukuran: 512, kualitas: 80 },
  bg_ladangN: { sumber: 'farm_furrows', peta: 'nor_gl', ukuran: 512, kualitas: 82 },
};
// terang: rata-rata kecerahan langit setelah dinormalkan (lampu matahari di game ≈ 2,4); tanah: warna pantulan dari bawah cakrawala
const LANGIT = { sumber: 'kloofendal_48d_partly_cloudy_puresky', w: 256, h: 128, terang: 0.6, tanah: [0.3, 0.32, 0.2] };

// ---------------------------------------------------------------- sumber (Poly Haven, CC0)

async function ambil(url, tujuan) {
  if (fs.existsSync(tujuan) && fs.statSync(tujuan).size) return;
  fs.mkdirSync(path.dirname(tujuan), { recursive: true });
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error('unduh gagal (' + r.status + '): ' + url);
  fs.writeFileSync(tujuan + '.part', Buffer.from(await r.arrayBuffer()));
  fs.renameSync(tujuan + '.part', tujuan);
}
async function daftarFile(nama) {
  const r = await fetch('https://api.polyhaven.com/files/' + encodeURIComponent(nama), { headers: UA });
  if (!r.ok) throw new Error('aset "' + nama + '" tidak ditemukan di Poly Haven (' + r.status + ')');
  return r.json();
}
async function sumberModel(nama) {
  const dir = path.join(SUMBER, nama), f = path.join(dir, nama + '.gltf');
  for (const d of [BUATAN, SUMBER]) {                    // model sendiri (mis. hasil generator AI): taruh buatan/<nama>.glb
    const glb = path.join(d, nama + '.glb');
    if (fs.existsSync(glb)) return glb;
  }
  if (!fs.existsSync(f)) {
    console.log('  mengunduh model ' + nama + ' …');
    const e = (await daftarFile(nama)).gltf['1k'].gltf;
    for (const [rel, inc] of Object.entries(e.include || {})) {
      const t = path.resolve(dir, rel);
      if (!t.startsWith(dir + path.sep)) throw new Error('path tak wajar dari server: ' + rel);
      await ambil(inc.url, t);
    }
    await ambil(e.url, f);
  }
  return f;
}
async function sumberTekstur(nama, peta) {
  const f = path.join(SUMBER, 'tex_' + nama, peta + '.jpg');
  if (!fs.existsSync(f)) { console.log('  mengunduh tekstur ' + nama + ' (' + peta + ') …'); await ambil((await daftarFile(nama))[peta]['1k'].jpg.url, f); }
  return f;
}
async function sumberHdri(nama) {
  const f = path.join(SUMBER, 'hdri_' + nama + '.hdr');
  if (!fs.existsSync(f)) { console.log('  mengunduh HDRI ' + nama + ' …'); await ambil((await daftarFile(nama)).hdri['1k'].hdr.url, f); }
  return f;
}

// ---------------------------------------------------------------- penulis

const manifest = { versi: 1, langit: null, tekstur: {}, model: {} };

// Bobot tulang → u8 yang jumlahnya tepat 255 (sisa pembulatan masuk ke bobot terbesar).
function kulitU8(m) {
  const n = m.sendi.length / 4, j8 = new Uint8Array(n * 4), w8 = new Uint8Array(n * 4);
  for (let v = 0; v < n; v++) {
    const w = [0, 1, 2, 3].map(c => Math.round(m.bobot[v * 4 + c] * 255)), besar = w.indexOf(Math.max(...w));
    w[besar] += 255 - w.reduce((a, b) => a + b, 0);
    for (let c = 0; c < 4; c++) { j8[v * 4 + c] = m.sendi[v * 4 + c]; w8[v * 4 + c] = w[c]; }
  }
  return [j8, w8];
}

// Kerangka & klip (hasil normalkanKerangka): IBM f32 (16 per tulang), lalu per jalur: waktu f32 (n) diikuti nilai f32 (n × 3|4).
function tulisKerangka(k, dorong) {
  const r6 = a => a.map(x => +x.toFixed(6)), ibm = dorong(Float32Array.from(k.ibm.flat())), klip = {};
  for (const c of k.klip) {
    if (!c.jalur.length) continue;
    let nama = c.nama;
    for (let i = 2; klip[nama]; i++) nama = c.nama + '_' + i;
    klip[nama] = {
      durasi: +c.durasi.toFixed(4),
      jalur: c.jalur.map(j => {
        const off = dorong(Float32Array.from(j.waktu));
        dorong(Float32Array.from(j.nilai));
        return { tulang: j.tulang, sifat: j.sifat, n: j.waktu.length, off, ...(j.step ? { step: true } : {}) };
      }),
    };
  }
  const tulang = k.tulang.map(d => ({ nama: d.nama, induk: d.induk, t: r6(d.t), r: r6(d.r), ...(d.s.some(x => Math.abs(x - 1) > 1e-6) ? { s: r6(d.s) } : {}) }));
  return { kerangka: { tulang, ibm }, klip };
}

// lods: [[{ mesh, bahan: indeks }, …], …] → satu file biner; tata letak per LOD: pos f32, normal i8, uv f32, warna u8, indeks u16,
// lalu (mesh berkerangka) nomor tulang u8×4 dan bobot u8×4 mulai dari `kulit` (tiap blok rata 4 byte). kerangka: lihat tulisKerangka.
function tulisModel(nama, lods, bahan, catatan, kerangka) {
  const blok = [], lod = [];
  let off = 0;
  const dorong = ta => { const mulai = off, b = Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength), pad = (4 - (b.length % 4)) % 4; blok.push(b); if (pad) blok.push(Buffer.alloc(pad)); off += b.length + pad; return mulai; };
  for (const grup of lods) {
    const isi = grup.filter(g => g.mesh && g.mesh.idx.length), m = G.gabung(isi.map(g => g.mesh)), v = m.pos.length / 3;
    if (v > 65535) throw new Error(nama + ': LOD terlalu besar (' + v + ' vertex), turunkan targetnya');
    const nor = new Int8Array(v * 3), col = new Uint8Array(v * 3).fill(255);
    for (let i = 0; i < v * 3; i++) { nor[i] = Math.round(m.nor[i] * 127); if (m.col) col[i] = Math.round(Math.min(1, Math.max(0, m.col[i])) * 255); }
    const mulai = off;
    dorong(m.pos); dorong(nor); dorong(m.uv || new Float32Array(v * 2)); dorong(col); dorong(Uint16Array.from(m.idx));
    let s = 0;
    const entri = { off: mulai, v, i: m.idx.length, grup: isi.map(g => { const r = [s, g.mesh.idx.length, g.bahan]; s += g.mesh.idx.length; return r; }) };
    if (m.sendi) { const [j8, w8] = kulitU8(m); entri.kulit = dorong(j8); dorong(w8); }
    lod.push(entri);
  }
  const ekstra = kerangka ? tulisKerangka(kerangka, dorong) : {};
  const buf = Buffer.concat(blok), k = G.kotak(G.gabung(lods[0].map(g => g.mesh)));
  fs.mkdirSync(path.join(KELUAR, 'm'), { recursive: true });
  fs.writeFileSync(path.join(KELUAR, 'm', nama + '.bin'), buf);
  manifest.model[nama] = { file: 'm/' + nama + '.bin', bahan, lod, tinggi: +k.max[1].toFixed(3), radius: +Math.max(-k.min[0], k.max[0], -k.min[2], k.max[2]).toFixed(3), ...ekstra };
  console.log('  ' + nama.padEnd(9) + ' segitiga/LOD: ' + lod.map(l => String(l.i / 3).padStart(5)).join(' ') + '   ' + (buf.length / 1024).toFixed(0).padStart(4) + ' KB   tinggi ' + k.max[1].toFixed(2) + ', radius ' + manifest.model[nama].radius.toFixed(2) + (catatan ? '   ' + catatan : ''));
}

function tulisTekstur(nama, src, ukuran, kualitas) {
  const rel = 't/' + nama + '.jpg';
  I.simpanJpg(src, path.join(KELUAR, rel), ukuran, kualitas);
  return rel;
}

// ---------------------------------------------------------------- pembangun

function pastikanNormal(m) {
  if (m.nor) return m;
  const n = new Float32Array(m.pos.length), p = m.pos;
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = m.idx[t] * 3, b = m.idx[t + 1] * 3, c = m.idx[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    for (const i of [a, b, c]) { n[i] += x; n[i + 1] += y; n[i + 2] += z; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  m.nor = n;
  return m;
}
const satukan = bagian => G.gabung(bagian.map(pastikanNormal));
const pilihNode = (bagian, r) => bagian.filter(b => (!r.node || r.node.includes(b.indeksNode)) && (!r.mesh || r.mesh.includes(b.indeksMesh)));

// Titik tengah (XZ) vertex-vertex terbawah: kaki batang.
function kaki(m, k) {
  let x = 0, z = 0, n = 0;
  const batas = k.min[1] + (k.max[1] - k.min[1]) * 0.04;
  for (let i = 0; i < m.pos.length; i += 3) if (m.pos[i + 1] <= batas) { x += m.pos[i]; z += m.pos[i + 2]; n++; }
  return [x / n, z / n];
}

async function buatPohon(nama, r) {
  const bagian = bacaGltf(await sumberModel(r.sumber));
  const bDaun = bagian.filter(b => /leaves/i.test(b.bahan.nama)), bCabang = bagian.filter(b => /branch/i.test(b.bahan.nama)), bBatang = bagian.filter(b => !/leaves|branch/i.test(b.bahan.nama));
  const batang = satukan(bBatang), cabang = bCabang.length ? satukan(bCabang) : null, daun = satukan(bDaun);
  const kb = G.kotak(batang), kd = G.kotak(daun), [bx, bz] = kaki(batang, kb), regang = r.regangY || 1;
  const s = r.tinggi / ((Math.max(kb.max[1], kd.max[1]) - kb.min[1]) * regang);
  for (const m of [batang, cabang, daun]) if (m) G.ubah(m, [-bx, -kb.min[1], -bz], [s, s * regang, s]);
  const kdaun = G.kotak(daun), pusat = [(kdaun.min[0] + kdaun.max[0]) / 2, kdaun.min[1] + (kdaun.max[1] - kdaun.min[1]) * 0.35, (kdaun.min[2] + kdaun.max[2]) / 2];
  const helai = G.komponen(daun).filter(c => c.tris.length >= 2), urutan = G.urutanAcak(helai.length, 7);
  const gbrDaun = I.muat(bDaun[0].bahan.gbrWarna, 512), warna = I.pencuplik(gbrDaun), cadangan = I.rataRata(gbrDaun);
  const ranting = cabang ? G.komponen(cabang) : [], warnaCabang = cabang && bCabang[0].bahan.gbrWarna ? I.rataRata(I.muat(bCabang[0].bahan.gbrWarna, 64), 0) : [0.3, 0.24, 0.18];
  const lods = r.lod.map(l => {
    const skala = Math.min(r.skalaMaks || 12, Math.sqrt(helai.length / l.daun) * (r.rapat || 0.72));
    const d = G.kartu(daun, helai, urutan, { simpan: l.daun, skala, warna, pusat, bulat: 0.6, warnaCadangan: cadangan });
    const c = cabang && l.cabang ? G.warnai(G.sederhanakan(G.terbesar(cabang, ranting, l.dahan), l.cabang, ['Prune']), warnaCabang, 0.2, 3) : null;
    return [{ mesh: G.sederhanakan(batang, l.batang), bahan: 0 }, { mesh: G.gabung([c, d]), bahan: 1 }];
  });
  const peta = tulisTekstur(nama, bBatang[0].bahan.gbrWarna, r.tekstur, 82);
  tulisModel(nama, lods, [{ jenis: 'tekstur', peta, kasar: 0.9 }, { jenis: 'daun' }], helai.length + ' helai daun di sumber');
}

async function buatPadat(nama, r) {
  const bagian = pilihNode(bacaGltf(await sumberModel(r.sumber)), r), m = satukan(bagian), k = G.kotak(m);
  const [cx, cz] = r.alas === 'kaki' ? kaki(m, k) : [(k.min[0] + k.max[0]) / 2, (k.min[2] + k.max[2]) / 2];
  const s = r.tinggi ? r.tinggi / (k.max[1] - k.min[1]) : r.lebar / Math.max(k.max[0] - k.min[0], k.max[2] - k.min[2]);
  G.ubah(m, [-cx, -k.min[1] - (k.max[1] - k.min[1]) * (r.tanam || 0), -cz], [s, s, s]);
  const lods = r.lod.map(t => [{ mesh: G.sederhanakan(m, t), bahan: 0 }]);
  const bahan = [{ jenis: 'tekstur', peta: tulisTekstur(nama, bagian[0].bahan.gbrWarna, r.tekstur, 82), kasar: 0.9 }];
  if (r.normal && bagian[0].bahan.gbrNormal) bahan[0].normal = tulisTekstur(nama + '_n', bagian[0].bahan.gbrNormal, r.tekstur, 85);
  if (r.bongkah) {
    const b = G.tabur(lods[0][0].mesh, { jumlah: r.bongkah.jumlah, radius: r.bongkah.radius, bentuk: 'okta', warna: [1, 1, 1], minY: G.kotak(lods[0][0].mesh).max[1] * 0.3, seed: 11 });
    for (const l of lods) l.push({ mesh: b, bahan: 1 });
    bahan.push({ jenis: 'emas' });
  }
  tulisModel(nama, lods, bahan, G.jumlahTri(m) + ' segitiga di sumber');
}

async function buatSemak(nama, r) {
  const bagian = pilihNode(bacaGltf(await sumberModel(r.sumber)), r);
  const bDaun = bagian.filter(b => /leaves|twig/i.test(b.bahan.nama)), bBatang = bagian.filter(b => !/leaves|twig/i.test(b.bahan.nama));
  const daun = satukan(bDaun), batang = satukan(bBatang), kb = G.kotak(batang), kd = G.kotak(daun), [bx, bz] = kaki(batang, kb);
  const s = r.tinggi / (Math.max(kb.max[1], kd.max[1]) - kb.min[1]);
  for (const m of [batang, daun]) G.ubah(m, [-bx, -kb.min[1], -bz], [s, s, s]);
  const helai = G.komponen(daun).filter(c => c.tris.length >= 2), urutan = G.urutanAcak(helai.length, 5), dahan = G.komponen(batang);
  const gbr = I.muat(bagian[0].bahan.gbrWarna, 512), warna = I.pencuplik(gbr, 48), cadangan = I.rataRata(gbr, 48);
  const pusat = [0, r.tinggi * 0.3, 0];
  const lods = r.lod.map((l, n) => {
    const skala = Math.min(8, Math.sqrt(helai.length / l.daun) * 0.8);
    const d = G.kartu(daun, helai, urutan, { simpan: l.daun, skala, warna, pusat, bulat: 0.6, warnaCadangan: cadangan });
    const b = l.batang ? G.warnaiDariTekstur(G.sederhanakan(G.terbesar(batang, dahan, l.dahan), l.batang, ['Prune']), warna, cadangan) : null;
    const buah = r.buah ? G.tabur(d, { jumlah: n === 2 ? Math.ceil(r.buah / 2) : r.buah, radius: n === 2 ? 0.06 : 0.045, ragam: 0.25, jarak: 0.11, bentuk: 'iko', warna: [0.78, 0.1, 0.16], minY: r.tinggi * 0.3, seed: 23, tanam: 0.6 }) : null;
    return [{ mesh: G.gabung([b, d, buah]), bahan: 0 }];
  });
  tulisModel(nama, lods, [{ jenis: 'daun' }], helai.length + ' helai daun di sumber');
}

async function buatRumput(nama, r) {
  const bagian = pilihNode(bacaGltf(await sumberModel(r.sumber)), r), m = satukan(bagian), k = G.kotak(m);
  const s = r.tinggi / (k.max[1] - k.min[1]);
  G.ubah(m, [-(k.min[0] + k.max[0]) / 2, -k.min[1], -(k.min[2] + k.max[2]) / 2], [s, s, s]);
  const bilah = G.komponen(m).filter(c => c.tris.length >= 2), gbr = I.muat(bagian[0].bahan.gbrWarna, 512);
  // normal diarahkan ke atas supaya rumput menyatu dengan terang tanah di sekitarnya
  // bilah asli terlalu tipis untuk jarak pandang game → tiap bilah dijadikan pita selebar r.lebar
  const hijau = I.rataRata(gbr, 40), d = G.pita(m, bilah, G.urutanAcak(bilah.length, 9), { simpan: r.bilah, lebar: r.lebar, pangkal: hijau.map(c => c * 0.75), ujung: hijau.map(c => Math.min(1, c * 1.35)), seed: 13 });
  tulisModel(nama, [[{ mesh: d, bahan: 0 }]], [{ jenis: 'daun' }], bilah.length + ' bilah di sumber');
}

const kit = new Map(), REGANG_TEMBOK = 1.12;        // tembok sedikit ditinggikan agar setara tinggi tembok di game (1,3 tile)
let bahanBenteng = null;

async function buatBenteng(nama, r) {
  const file = await sumberModel(r.sumber);
  if (!kit.has(file)) kit.set(file, bacaGltf(file));
  const bagian = kit.get(file).filter(b => b.indeksNode === r.node);
  const bDinding = bagian.filter(b => !/trim/i.test(b.bahan.nama)), bTrim = bagian.filter(b => /trim/i.test(b.bahan.nama));
  // normalkan modul: panjang (sumbu Z di sumber) = 1 tile dan diputar memanjang X; alas di y = 0; muka luar (sisi bergerigi) di −Z
  const dinding = satukan(bDinding), trim = satukan(bTrim), k = G.kotak(dinding), s = 1 / (k.max[2] - k.min[2]);
  for (const m of [dinding, trim]) { G.ubah(m, [-(k.min[0] + k.max[0]) / 2, -k.min[1], -(k.min[2] + k.max[2]) / 2], [s, s * REGANG_TEMBOK, s]); G.putarY(m, Math.PI / 2); }
  let grup;
  if (r.bentuk === 'lurus') grup = [dinding, trim];
  else if (r.bentuk === 'lengan') grup = [dinding, trim].map(m => G.potong(m, [-1, 0, 0], 0));          // separuh: dari tengah tile ke tepi +X
  else {
    const kd = G.kotak(dinding), tinggi = kd.max[1], S = r.sisi;
    const sisi = (m, dy) => [0, 1, 2, 3].map(q => {
      const p = G.ubah(G.salin(m), [0, dy, -S / 2 - kd.min[2]], [1, 1, 1]);                              // muka luar tepat di z = −S/2
      return G.putarY(G.potong(G.potong(p, [1, 0, 1], 0), [-1, 0, 1], 0), q * Math.PI / 2);                // serong 45°: z ≤ −|x|
    });
    const tingkat = Array.from({ length: r.tingkat }, (_, i) => i);
    grup = [G.gabung(tingkat.flatMap(i => sisi(dinding, i * tinggi))), G.gabung(sisi(trim, (r.tingkat - 1) * tinggi))];
    for (const m of grup) G.ubah(m, [0, 0, 0], [1, r.regang, 1]);
  }
  if (!bahanBenteng) bahanBenteng = [
    { jenis: 'tekstur', peta: tulisTekstur('benteng_dinding', bDinding[0].bahan.gbrWarna, 512, 84), normal: tulisTekstur('benteng_dinding_n', bDinding[0].bahan.gbrNormal, 512, 85), kasar: 0.92 },
    { jenis: 'tekstur', peta: tulisTekstur('benteng_trim', bTrim[0].bahan.gbrWarna, 512, 84), kasar: 0.9 },
  ];
  tulisModel(nama, [[{ mesh: grup[0], bahan: 0 }, { mesh: grup[1], bahan: 1 }]], bahanBenteng, 'modul ' + bagian[0].node.replace('modular_fort_01_', ''));
}

// Unit/hewan berkerangka: mesh ber-skin + klip animasi dari GLB lokal. Pose istirahat dinormalkan (kaki di y = 0, tinggi r.tinggi);
// satu grup per bahan, LOD dikurangi proporsional per grup. Bahan yang memakai gambar yang sama berbagi satu tekstur, dan
// bahan bernama "…_tim" ditandai tim: true — game mengalikannya dengan warna tim (mis. tunik putih gading pekerja).
// Peta kekasaran/logam glTF (G = kekasaran, B = logam) ditulis sebagai <nama>_orm.jpg dan dicatat di `orm`.
async function buatKerangka(nama, r) {
  const file = path.join(SUMBER, r.sumber + '.glb');
  if (!fs.existsSync(file)) throw new Error(nama + ': model belum ada — taruh GLB berkerangka di ' + path.relative(process.cwd(), file));
  const k = bacaKerangka(file);
  normalkanKerangka(k, r.tinggi, r.skala);
  for (const c of k.catatan) console.log('  ' + nama + ': ' + c);
  const daftarBahan = [...new Set(k.bagian.map(b => b.bahan))];
  const mesh = daftarBahan.map(b => satukan(k.bagian.filter(x => x.bahan === b))), total = mesh.reduce((s, m) => s + G.jumlahTri(m), 0);
  const lods = r.lod.map(t => mesh.map((m, i) => ({ mesh: G.sederhanakan(m, t * G.jumlahTri(m) / total), bahan: i })));
  const tertulis = new Map(), orm = new Map();
  const bahan = daftarBahan.map(b => {
    if (!b.gbrWarna) throw new Error(nama + ': bahan "' + b.nama + '" tanpa tekstur warna belum didukung');
    if (!tertulis.has(b.gbrWarna.kunci)) tertulis.set(b.gbrWarna.kunci, tulisTekstur(nama + (tertulis.size ? '_' + tertulis.size : ''), b.gbrWarna, r.tekstur, 85));
    if (b.gbrKasar && !orm.has(b.gbrKasar.kunci)) orm.set(b.gbrKasar.kunci, tulisTekstur(nama + '_orm' + (orm.size ? '_' + orm.size : ''), b.gbrKasar, r.tekstur, 88));
    return { jenis: 'tekstur', peta: tertulis.get(b.gbrWarna.kunci), kasar: r.kasar || 0.85, ...(b.gbrKasar ? { orm: orm.get(b.gbrKasar.kunci) } : {}),
      ...(/(^|_)tim(\.|_|$)/i.test(b.nama) ? { tim: true } : {}) };
  });
  const klip = k.klip.filter(c => c.jalur.length).map(c => c.nama + ' ' + c.durasi.toFixed(2) + 's');
  tulisModel(nama, lods, bahan, k.tulang.length + ' tulang; klip: ' + (klip.join(', ') || '-'), k);
}

const PEMBANGUN = { pohon: buatPohon, padat: buatPadat, semak: buatSemak, rumput: buatRumput, benteng: buatBenteng, kerangka: buatKerangka };

// ---------------------------------------------------------------- info

function info(file) {
  const bagian = bacaGltf(file);
  console.log(path.basename(file) + ': ' + bagian.length + ' bagian');
  for (const b of bagian) {
    const m = pastikanNormal(b), k = G.kotak(m), c = G.komponen(m);
    console.log('  node ' + String(b.indeksNode).padStart(2) + ' mesh ' + String(b.indeksMesh).padStart(2) + '  ' + (b.node + ' / ' + b.bahan.nama).slice(0, 52).padEnd(52) + ' tri ' + String(G.jumlahTri(m)).padStart(8) + '  komponen ' + String(c.length).padStart(6)
      + '  ukuran ' + [0, 1, 2].map(i => (k.max[i] - k.min[i]).toFixed(2)).join('×') + '  pusat ' + [0, 2].map(i => ((k.max[i] + k.min[i]) / 2).toFixed(2)).join(',')
      + '  tekstur ' + (b.bahan.gbrWarna ? (b.bahan.gbrWarna.file ? path.basename(b.bahan.gbrWarna.file) : 'tertanam') : '-') + (b.bahan.alpha !== 'OPAQUE' ? '  alpha ' + b.bahan.alpha : ''));
  }
  let k = null;
  try { k = bacaKerangka(file); } catch (e) { if (!/tidak ada mesh berkerangka/.test(e.message)) console.log('  kerangka: ' + e.message); }
  if (!k) return;
  console.log('  kerangka: ' + k.tulang.length + ' tulang (akar: ' + k.tulang.filter(d => d.induk < 0).map(d => d.nama).join(', ') + ')');
  for (const c of k.klip) {
    const t = c.jalur.flatMap(j => [j.waktu[0], j.waktu[j.waktu.length - 1]]);
    console.log('  klip ' + c.nama.padEnd(24) + (t.length ? (Math.max(...t) - Math.min(...t)).toFixed(2) : '0.00') + ' s, ' + c.jalur.length + ' jalur');
  }
  for (const c of k.catatan) console.log('  catatan: ' + c);
}

// ---------------------------------------------------------------- utama

const args = process.argv.slice(2);
if (args[0] === '--info') info(path.resolve(args[1]));
else {
  const fileManifest = path.join(KELUAR, 'manifest.json'), semua = !args.length;
  if (!semua && fs.existsSync(fileManifest)) Object.assign(manifest, JSON.parse(fs.readFileSync(fileManifest, 'utf8')));
  const asing = args.filter(a => !RESEP[a]);
  if (asing.length) { console.error('Resep tidak dikenal: ' + asing.join(', ') + '. Tersedia: ' + Object.keys(RESEP).join(', ')); process.exit(1); }
  console.log('Model:');
  for (const nama of semua ? Object.keys(RESEP) : args) {
    const r = RESEP[nama];
    if (semua && r.lokal && !fs.existsSync(path.join(SUMBER, r.sumber + '.glb'))) { console.log('  ' + nama.padEnd(9) + ' dilewati: sumber/' + r.sumber + '.glb belum ada'); continue; }
    await PEMBANGUN[r.jenis](nama, r);
  }
  if (semua) {
    console.log('Tekstur tanah:');
    for (const [nama, t] of Object.entries(TEKSTUR)) {
      manifest.tekstur[nama] = { file: tulisTekstur(nama, { file: await sumberTekstur(t.sumber, t.peta) }, t.ukuran, t.kualitas), warna: t.peta === 'Diffuse' };
      console.log('  ' + nama.padEnd(9) + (fs.statSync(path.join(KELUAR, manifest.tekstur[nama].file)).size / 1024).toFixed(0).padStart(5) + ' KB');
    }
    const { rgbe, info: il } = I.olahLangit(I.bacaHdr(await sumberHdri(LANGIT.sumber)), LANGIT.w, LANGIT.h, MATAHARI, LANGIT.tanah, LANGIT.terang);
    fs.writeFileSync(path.join(KELUAR, 'langit.bin'), rgbe);
    manifest.langit = { file: 'langit.bin', w: LANGIT.w, h: LANGIT.h, matahari: MATAHARI };
    console.log('Langit: ' + LANGIT.w + '×' + LANGIT.h + '  ' + JSON.stringify(il));
  }
  fs.writeFileSync(fileManifest, JSON.stringify(manifest));
  const total = fs.readdirSync(KELUAR, { recursive: true }).reduce((s, f) => { const st = fs.statSync(path.join(KELUAR, f)); return s + (st.isFile() ? st.size : 0); }, 0);
  console.log('Selesai → ' + path.relative(process.cwd(), KELUAR) + '  (total ' + (total / 1048576).toFixed(1) + ' MB)');
}
