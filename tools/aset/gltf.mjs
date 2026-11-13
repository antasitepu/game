// Pembaca glTF 2.0 (.gltf + .bin, atau .glb) minimal untuk alat aset.
// bacaGltf: daftar "bagian" (satu per primitive segitiga) dengan transform node sudah diterapkan.
// bacaKerangka: mesh berkerangka (skin) + tulang + klip animasi, untuk unit/hewan yang bergerak.
// UV sudah memuat KHR_texture_transform dan dibalik (v ke atas, konvensi three.js).
import fs from 'node:fs';
import path from 'node:path';

const UKURAN = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const BACA = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' };
const NORMAL = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
const JUMLAH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const DIDUKUNG = ['KHR_texture_transform', 'KHR_materials_specular', 'KHR_materials_ior'];
const IDENTITAS = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// File yang dirujuk aset harus berada di dalam folder aset itu sendiri.
function didalam(dir, uri) {
  const f = path.resolve(dir, decodeURIComponent(uri));
  if (!f.startsWith(path.resolve(dir) + path.sep)) throw new Error('rujukan file di luar folder aset: ' + uri);
  return f;
}

// ---------------------------------------------------------------- matriks 4×4 (urutan kolom) & kuaternion [x, y, z, w]

function kali(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

function invers(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) throw new Error('matriks tidak bisa dibalik');
  const d = 1 / det;
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d, (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d, (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d, (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d, (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d,
  ];
}

const titik = (M, x, y, z) => [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]];

// Matriks normal = invers-transpos 3×3 (benar juga untuk skala tak seragam); hasil urutan kolom 3×3.
function matriksNormal(M) {
  const a = M[0], b = M[4], c = M[8], d = M[1], e = M[5], f = M[9], g = M[2], h = M[6], i = M[10];
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C || 1;
  return [A / det, (c * h - b * i) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, (c * d - a * f) / det, C / det, (b * g - a * h) / det, (a * e - b * d) / det];
}

function matriksTRS(t, q, s) {
  const [x, y, z, w] = q, [sx, sy, sz] = s, [tx, ty, tz] = t;
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const matriksNode = n => n.matrix || matriksTRS(n.translation || [0, 0, 0], n.rotation || [0, 0, 0, 1], n.scale || [1, 1, 1]);

// Urai matriks tanpa geser-miring menjadi translasi, rotasi (kuaternion), dan skala.
function urai(M) {
  const s = [Math.hypot(M[0], M[1], M[2]), Math.hypot(M[4], M[5], M[6]), Math.hypot(M[8], M[9], M[10])];
  const det = M[0] * (M[5] * M[10] - M[9] * M[6]) - M[4] * (M[1] * M[10] - M[9] * M[2]) + M[8] * (M[1] * M[6] - M[5] * M[2]);
  if (det < 0) s[0] = -s[0];
  const r = [M[0] / s[0], M[1] / s[0], M[2] / s[0], M[4] / s[1], M[5] / s[1], M[6] / s[1], M[8] / s[2], M[9] / s[2], M[10] / s[2]];
  const [m11, m21, m31, m12, m22, m32, m13, m23, m33] = r, tr = m11 + m22 + m33;
  let q;
  if (tr > 0) { const k = 0.5 / Math.sqrt(tr + 1); q = [(m32 - m23) * k, (m13 - m31) * k, (m21 - m12) * k, 0.25 / k]; }
  else if (m11 > m22 && m11 > m33) { const k = 2 * Math.sqrt(1 + m11 - m22 - m33); q = [0.25 * k, (m12 + m21) / k, (m13 + m31) / k, (m32 - m23) / k]; }
  else if (m22 > m33) { const k = 2 * Math.sqrt(1 + m22 - m11 - m33); q = [(m12 + m21) / k, 0.25 * k, (m23 + m32) / k, (m13 - m31) / k]; }
  else { const k = 2 * Math.sqrt(1 + m33 - m11 - m22); q = [(m13 + m31) / k, (m23 + m32) / k, 0.25 * k, (m21 - m12) / k]; }
  return { t: [M[12], M[13], M[14]], r: q, s };
}

const kaliQ = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
function putarQ(q, v) {
  const [x, y, z, w] = q, ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}

// ---------------------------------------------------------------- berkas

function buka(file) {
  const dir = path.dirname(file), raw = fs.readFileSync(file);
  let json, binGlb = null;
  if (raw.length > 12 && raw.readUInt32LE(0) === 0x46546c67) {          // "glTF" → wadah biner GLB
    for (let off = 12; off + 8 <= raw.length;) {
      const len = raw.readUInt32LE(off), jenis = raw.readUInt32LE(off + 4), isi = raw.subarray(off + 8, off + 8 + len);
      if (jenis === 0x4e4f534a) json = JSON.parse(isi.toString('utf8'));
      else if (jenis === 0x004e4942) binGlb = isi;
      off += 8 + len + ((4 - (len % 4)) % 4);
    }
  } else json = JSON.parse(raw.toString('utf8'));
  const asing = (json.extensionsRequired || []).filter(e => !DIDUKUNG.includes(e));
  if (asing.length) throw new Error('ekstensi glTF belum didukung: ' + asing.join(', ') + ' (ekspor ulang tanpa kompresi)');

  const buffers = (json.buffers || []).map(b => {
    if (!b.uri) return binGlb;
    if (b.uri.startsWith('data:')) return Buffer.from(b.uri.slice(b.uri.indexOf(',') + 1), 'base64');
    return fs.readFileSync(didalam(dir, b.uri));
  });

  function aksesor(i, sebagaiIndeks) {
    const a = json.accessors[i], n = JUMLAH[a.type], sz = UKURAN[a.componentType];
    if (a.sparse || a.bufferView === undefined) throw new Error('accessor sparse belum didukung');
    const bv = json.bufferViews[a.bufferView], buf = buffers[bv.buffer];
    const mulai = (bv.byteOffset || 0) + (a.byteOffset || 0), langkah = bv.byteStride || n * sz;
    const out = sebagaiIndeks ? new Uint32Array(a.count * n) : new Float32Array(a.count * n);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), baca = BACA[a.componentType];
    const bagi = !sebagaiIndeks && a.normalized ? NORMAL[a.componentType] : 0;
    for (let k = 0; k < a.count; k++)
      for (let c = 0; c < n; c++) {
        const v = dv[baca](mulai + k * langkah + c * sz, true);
        out[k * n + c] = bagi ? Math.max(v / bagi, -1) : v;
      }
    return out;
  }

  // Gambar: { file } (di disk) atau { data, ext } (tertanam di GLB); kunci sama = gambar yang sama (dipakai beberapa bahan).
  function gambar(texInfo) {
    if (!texInfo || json.textures === undefined) return null;
    const t = json.textures[texInfo.index];
    if (!t || t.source === undefined) return null;
    const im = json.images[t.source], kunci = 'g' + t.source;
    if (im.uri && !im.uri.startsWith('data:')) return { file: didalam(dir, im.uri), kunci };
    const ext = /png/.test(im.mimeType || im.uri || '') ? 'png' : 'jpg';
    if (im.uri) return { data: Buffer.from(im.uri.slice(im.uri.indexOf(',') + 1), 'base64'), ext, kunci };
    const bv = json.bufferViews[im.bufferView], buf = buffers[bv.buffer];
    return { data: buf.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength), ext, kunci };
  }

  const bahan = (json.materials || []).map(m => {
    const p = m.pbrMetallicRoughness || {}, tt = p.baseColorTexture && p.baseColorTexture.extensions && p.baseColorTexture.extensions.KHR_texture_transform;
    return {
      nama: m.name || '', alpha: m.alphaMode || 'OPAQUE', duaSisi: !!m.doubleSided,
      warna: p.baseColorFactor || [1, 1, 1, 1], kasar: p.roughnessFactor === undefined ? 1 : p.roughnessFactor, logam: p.metallicFactor === undefined ? 1 : p.metallicFactor,
      gbrWarna: gambar(p.baseColorTexture), gbrNormal: gambar(m.normalTexture), gbrKasar: gambar(p.metallicRoughnessTexture),
      uvT: tt ? { geser: tt.offset || [0, 0], putar: tt.rotation || 0, skala: tt.scale || [1, 1] } : null,
    };
  });
  const POLOS = { nama: '', alpha: 'OPAQUE', duaSisi: false, warna: [1, 1, 1, 1], kasar: 1, logam: 0, gbrWarna: null, gbrNormal: null, gbrKasar: null, uvT: null };

  // Satu primitive segitiga → { bahan, pos, nor, uv, idx } dalam ruang lokal mesh; M (opsional) diterapkan ke posisi & normal.
  function primitive(pr, M) {
    if (pr.mode !== undefined && pr.mode !== 4) return null;
    if (pr.extensions && pr.extensions.KHR_draco_mesh_compression) throw new Error('mesh terkompresi Draco belum didukung');
    const pos = aksesor(pr.attributes.POSITION), nv = pos.length / 3;
    const nor = pr.attributes.NORMAL !== undefined ? aksesor(pr.attributes.NORMAL) : null;
    const uv = pr.attributes.TEXCOORD_0 !== undefined ? aksesor(pr.attributes.TEXCOORD_0) : null;
    const idx = pr.indices !== undefined ? aksesor(pr.indices, true) : Uint32Array.from({ length: nv }, (_, k) => k);
    const mat = pr.material !== undefined ? bahan[pr.material] : POLOS;
    if (M) {
      const Nm = matriksNormal(M);
      for (let k = 0; k < nv; k++) {
        const p = titik(M, pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
        pos[k * 3] = p[0]; pos[k * 3 + 1] = p[1]; pos[k * 3 + 2] = p[2];
        if (nor) {
          const nx = nor[k * 3], ny = nor[k * 3 + 1], nz = nor[k * 3 + 2];
          const px = Nm[0] * nx + Nm[3] * ny + Nm[6] * nz, py = Nm[1] * nx + Nm[4] * ny + Nm[7] * nz, pz = Nm[2] * nx + Nm[5] * ny + Nm[8] * nz, l = Math.hypot(px, py, pz) || 1;
          nor[k * 3] = px / l; nor[k * 3 + 1] = py / l; nor[k * 3 + 2] = pz / l;
        }
      }
    }
    if (uv) for (let k = 0; k < nv; k++) {
      let u = uv[k * 2], v = uv[k * 2 + 1];
      if (mat.uvT) {
        const t = mat.uvT, co = Math.cos(t.putar), si = Math.sin(t.putar), su = u * t.skala[0], sv = v * t.skala[1];
        u = co * su + si * sv + t.geser[0];
        v = -si * su + co * sv + t.geser[1];
      }
      uv[k * 2] = u; uv[k * 2 + 1] = 1 - v;
    }
    return { bahan: mat, pos, nor, uv, idx };
  }

  const induk = new Array(json.nodes.length).fill(-1);
  json.nodes.forEach((n, i) => (n.children || []).forEach(c => { induk[c] = i; }));
  const scene = json.scenes && json.scenes[json.scene || 0];
  const akar = scene ? scene.nodes : json.nodes.map((_, i) => i).filter(i => induk[i] < 0);
  const dunia = i => (i < 0 ? IDENTITAS : kali(dunia(induk[i]), matriksNode(json.nodes[i])));
  return { json, aksesor, primitive, induk, akar, dunia };
}

export function bacaGltf(file) {
  const { json, primitive, akar } = buka(file), bagian = [];
  function jelajah(ni, indukM) {
    const node = json.nodes[ni], M = kali(indukM, matriksNode(node));
    if (node.mesh !== undefined)
      for (const pr of json.meshes[node.mesh].primitives) {
        const p = primitive(pr, M);
        if (p) bagian.push({ node: node.name || '', indeksNode: ni, indeksMesh: node.mesh, ...p });
      }
    for (const c of node.children || []) jelajah(c, M);
  }
  for (const ni of akar) jelajah(ni, IDENTITAS);
  return bagian;
}

// ---------------------------------------------------------------- kerangka & animasi

// Nama tulang aman untuk jalur animasi three.js (tanpa titik/titik dua); awalan "mixamorig:" dan sejenisnya dibuang.
function namaAman(nama, k, dipakai) {
  let n = (nama || '').replace(/^.*:/, '').replace(/[^A-Za-z0-9_-]/g, '_') || 'tulang' + k;
  while (dipakai.has(n)) n += '_' + k;
  dipakai.add(n);
  return n;
}

// Hasil: { bagian: [{ bahan, pos, nor, uv, idx, sendi: Uint16Array(4n), bobot: Float32Array(4n) }],
//          tulang: [{ nama, induk, t, r, s }], ibm: [matriks 4×4 per tulang], leluhur: [matriks dunia induk non-tulang, khusus tulang akar],
//          klip: [{ nama, jalur: [{ tulang, sifat: 't'|'r'|'s', waktu, nilai, step }] }], catatan: [peringatan] }
// Sesuai spesifikasi glTF, transform node mesh berkerangka diabaikan: posisi vertex berada di ruang ikat (bind) kulitnya.
export function bacaKerangka(file) {
  const { json, aksesor, primitive, induk, dunia } = buka(file), catatan = [];
  const nodeKulit = json.nodes.map((_, i) => i).filter(i => json.nodes[i].mesh !== undefined && json.nodes[i].skin !== undefined);
  if (!nodeKulit.length) throw new Error('tidak ada mesh berkerangka (skin) di file ini');
  const iKulit = json.nodes[nodeKulit[0]].skin, kulit = json.skins[iKulit], sendiNode = kulit.joints;
  if (nodeKulit.some(i => json.nodes[i].skin !== iKulit)) throw new Error('lebih dari satu kerangka (skin) dalam satu file belum didukung');
  if (sendiNode.length > 255) throw new Error('kerangka terlalu banyak tulang (' + sendiNode.length + ', maks 255)');
  const statis = json.nodes.filter(n => n.mesh !== undefined && n.skin === undefined).length;
  if (statis) catatan.push(statis + ' mesh tanpa kerangka diabaikan');

  const nomor = new Map(sendiNode.map((ni, k) => [ni, k])), dipakai = new Set();
  const tulang = sendiNode.map((ni, k) => {
    const n = json.nodes[ni], p = induk[ni];
    if (!nomor.has(p)) for (let q = p; q >= 0; q = induk[q])
      if (nomor.has(q)) throw new Error('node bukan tulang di antara tulang "' + (n.name || ni) + '" dan induknya belum didukung');
    const trs = n.matrix ? urai(n.matrix) : { t: n.translation || [0, 0, 0], r: n.rotation || [0, 0, 0, 1], s: n.scale || [1, 1, 1] };
    return { nama: namaAman(n.name, k, dipakai), induk: nomor.has(p) ? nomor.get(p) : -1, t: [...trs.t], r: [...trs.r], s: [...trs.s] };
  });
  const leluhur = sendiNode.map((ni, k) => (tulang[k].induk < 0 ? dunia(induk[ni]) : null));
  const dataIbm = kulit.inverseBindMatrices !== undefined ? aksesor(kulit.inverseBindMatrices) : null;
  const ibm = sendiNode.map((_, k) => (dataIbm ? Array.from(dataIbm.subarray(k * 16, k * 16 + 16)) : IDENTITAS.slice()));

  const bagian = [];
  for (const ni of nodeKulit) {
    const W = dunia(ni);
    if (W.some((v, i) => Math.abs(v - IDENTITAS[i]) > 1e-6)) catatan.push('transform node mesh "' + (json.nodes[ni].name || ni) + '" diabaikan (sesuai spesifikasi glTF)');
    for (const pr of json.meshes[json.nodes[ni].mesh].primitives) {
      const p = primitive(pr);
      if (!p) continue;
      const nv = p.pos.length / 3, set = [];
      for (let s = 0; pr.attributes['JOINTS_' + s] !== undefined; s++) set.push([aksesor(pr.attributes['JOINTS_' + s], true), aksesor(pr.attributes['WEIGHTS_' + s])]);
      if (!set.length) throw new Error('primitive berkerangka tanpa JOINTS_0/WEIGHTS_0');
      const sendi = new Uint16Array(nv * 4), bobot = new Float32Array(nv * 4);
      for (let v = 0; v < nv; v++) {
        const calon = [];
        for (const [J, Wt] of set) for (let c = 0; c < 4; c++) if (Wt[v * 4 + c] > 0) calon.push([J[v * 4 + c], Wt[v * 4 + c]]);
        calon.sort((a, b) => b[1] - a[1]);
        const empat = calon.slice(0, 4), jml = empat.reduce((s, c) => s + c[1], 0) || 1;
        if (!empat.length) empat.push([0, 1]);
        empat.forEach(([j, w], c) => { sendi[v * 4 + c] = j; bobot[v * 4 + c] = w / jml; });
      }
      bagian.push({ node: json.nodes[ni].name || '', indeksNode: ni, ...p, sendi, bobot });
    }
  }

  const SIFAT = { translation: 't', rotation: 'r', scale: 's' };
  const klip = (json.animations || []).map((a, ai) => {
    const jalur = [];
    let lewat = 0;
    for (const ch of a.channels) {
      const k = nomor.get(ch.target.node), sifat = SIFAT[ch.target.path];
      if (k === undefined || !sifat) { lewat++; continue; }
      const smp = a.samplers[ch.sampler], waktu = aksesor(smp.input), mentah = aksesor(smp.output), n = sifat === 'r' ? 4 : 3;
      let nilai = mentah;
      if (smp.interpolation === 'CUBICSPLINE') {                    // ambil nilai kunci saja (tanpa tangen): cukup untuk animasi hasil bake per frame
        nilai = new Float32Array(waktu.length * n);
        for (let i = 0; i < waktu.length; i++) for (let c = 0; c < n; c++) nilai[i * n + c] = mentah[(i * 3 + 1) * n + c];
        catatan.push('klip "' + a.name + '": interpolasi CUBICSPLINE didekati linear');
      }
      jalur.push({ tulang: k, sifat, waktu, nilai, step: smp.interpolation === 'STEP' });
    }
    if (lewat) catatan.push('klip "' + (a.name || ai) + '": ' + lewat + ' jalur untuk node bukan tulang diabaikan');
    return { nama: a.name || 'klip' + ai, jalur };
  });
  return { bagian, tulang, ibm, leluhur, klip, catatan };
}

// Normalkan kerangka hasil bacaKerangka (diubah di tempat): Y ke atas, kaki di y = 0, tulang akar di x = z = 0,
// tinggi pose istirahat = `tinggi`, atau skala tetap `skala` (satuan game per satuan sumber) bila diberikan. Hasil akhirnya setara dengan N · (posisi glTF asli) untuk setiap pose, dengan
// N = skala seragam + geser. Leluhur non-tulang dilebur ke tulang akar; tulang tidak mendapat skala tambahan
// (translasi semua tulang dikali σ), sehingga jalur animasi tetap bebas satu sama lain.
// Vertex disimpan dalam pose istirahat dunia (ternormalkan) dan IBM disesuaikan agar hasil skinning tetap eksak.
export function normalkanKerangka(k, tinggi, skala) {
  const n = k.tulang.length, lokal = d => matriksTRS(d.t, d.r, d.s), Wr = new Array(n);
  const duniaTulang = i => Wr[i] || (Wr[i] = kali(k.tulang[i].induk < 0 ? k.leluhur[i] : duniaTulang(k.tulang[i].induk), lokal(k.tulang[i])));
  // C: ruang ikat → dunia pada pose istirahat. Bila pose istirahat = pose ikat, nilainya sama untuk semua tulang.
  const C = kali(duniaTulang(0), k.ibm[0]);
  let beda = 0;
  for (let i = 1; i < n; i++) { const Ci = kali(duniaTulang(i), k.ibm[i]); for (let e = 0; e < 16; e++) beda = Math.max(beda, Math.abs(Ci[e] - C[e]) / (Math.abs(C[e]) + 1)); }
  if (beda > 1e-3) k.catatan.push('pose istirahat berbeda dari pose ikat (selisih ' + beda.toFixed(3) + '): ukuran & titik kaki dihitung dari pose ikat');

  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const b of k.bagian) for (let v = 0; v < b.pos.length; v += 3) {
    const p = titik(C, b.pos[v], b.pos[v + 1], b.pos[v + 2]);
    for (let c = 0; c < 3; c++) { if (p[c] < min[c]) min[c] = p[c]; if (p[c] > max[c]) max[c] = p[c]; }
  }
  // titik asal: di tanah, tepat di bawah tulang akar (bukan tengah kotak: tombak atau perisai tidak boleh menggeser badan)
  const akar0 = duniaTulang(k.tulang.findIndex(d => d.induk < 0));
  const s = skala || tinggi / (max[1] - min[1]), tN = [-akar0[12] * s, -min[1] * s, -akar0[14] * s];
  const N = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, tN[0], tN[1], tN[2], 1], NC = kali(N, C), NCinv = invers(NC), Nm = matriksNormal(NC);

  for (const b of k.bagian) for (let v = 0; v < b.pos.length; v += 3) {
    const p = titik(NC, b.pos[v], b.pos[v + 1], b.pos[v + 2]);
    b.pos.set(p, v);
    if (b.nor) {
      const nx = b.nor[v], ny = b.nor[v + 1], nz = b.nor[v + 2];
      const px = Nm[0] * nx + Nm[3] * ny + Nm[6] * nz, py = Nm[1] * nx + Nm[4] * ny + Nm[7] * nz, pz = Nm[2] * nx + Nm[5] * ny + Nm[8] * nz, l = Math.hypot(px, py, pz) || 1;
      b.nor[v] = px / l; b.nor[v + 1] = py / l; b.nor[v + 2] = pz / l;
    }
  }

  // N·A = T(t') · R_a · S(σ) untuk tiap tulang akar (A = matriks dunia induk non-tulang, harus berskala seragam).
  let sigma = null;
  const akar = k.tulang.map((d, i) => {
    if (d.induk >= 0) return null;
    const a = urai(k.leluhur[i]);
    if (Math.abs(a.s[0] - a.s[1]) > 1e-4 * Math.abs(a.s[0]) || Math.abs(a.s[0] - a.s[2]) > 1e-4 * Math.abs(a.s[0]) || a.s[0] <= 0) throw new Error('leluhur kerangka berskala tak seragam/terbalik belum didukung');
    const sg = s * a.s[0];
    if (sigma !== null && Math.abs(sg - sigma) > 1e-6 * sigma) throw new Error('beberapa tulang akar dengan skala berbeda belum didukung');
    sigma = sg;
    return { t: a.t.map((x, c) => s * x + tN[c]), q: a.r };
  });
  const ubahT = (i, p) => (akar[i] ? putarQ(akar[i].q, p).map((x, c) => akar[i].t[c] + sigma * x) : p.map(x => x * sigma));
  const ubahR = (i, q) => (akar[i] ? kaliQ(akar[i].q, q) : q);
  k.tulang.forEach((d, i) => { d.t = ubahT(i, d.t); d.r = ubahR(i, d.r); });
  const S = [sigma, 0, 0, 0, 0, sigma, 0, 0, 0, 0, sigma, 0, 0, 0, 0, 1];
  k.ibm = k.ibm.map(m => kali(kali(S, m), NCinv));

  for (const c of k.klip) {
    for (const j of c.jalur) {
      if (j.sifat === 's') continue;
      const lebar = j.sifat === 'r' ? 4 : 3;
      for (let e = 0; e < j.nilai.length; e += lebar) {
        const x = Array.from(j.nilai.subarray(e, e + lebar));
        j.nilai.set(j.sifat === 'r' ? ubahR(j.tulang, x) : ubahT(j.tulang, x), e);
      }
    }
    // Rapikan: waktu mulai dari 0; jalur yang tetap sepanjang klip disingkat jadi satu kunci, dan dibuang bila sama dengan pose istirahat.
    if (!c.jalur.length) { c.durasi = 0; continue; }
    const t0 = Math.min(...c.jalur.map(j => j.waktu[0]));
    c.durasi = Math.max(0, ...c.jalur.map(j => j.waktu[j.waktu.length - 1])) - t0;
    c.jalur = c.jalur.filter(j => {
      for (let i = 0; i < j.waktu.length; i++) j.waktu[i] -= t0;
      const lebar = j.sifat === 'r' ? 4 : 3, eps = j.sifat === 't' ? 1e-5 * (max[1] - min[1]) * s : 1e-5;
      const sama = (e, ref) => {
        let d = 0, dNeg = 0;
        for (let c2 = 0; c2 < lebar; c2++) { d = Math.max(d, Math.abs(j.nilai[e + c2] - ref[c2])); dNeg = Math.max(dNeg, Math.abs(j.nilai[e + c2] + ref[c2])); }
        return (j.sifat === 'r' ? Math.min(d, dNeg) : d) <= eps;
      };
      const pertama = Array.from(j.nilai.subarray(0, lebar));
      for (let e = lebar; e < j.nilai.length; e += lebar) if (!sama(e, pertama)) return true;
      if (sama(0, k.tulang[j.tulang][j.sifat])) return false;
      j.waktu = j.waktu.subarray(0, 1); j.nilai = j.nilai.subarray(0, lebar);
      return true;
    });
  }
  return { skala: s };
}
