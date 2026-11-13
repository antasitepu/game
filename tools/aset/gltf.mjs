// Pembaca glTF 2.0 (.gltf + .bin, atau .glb) minimal untuk alat aset.
// Hasil: daftar "bagian" (satu per primitive segitiga) dengan transform node sudah diterapkan,
// UV sudah memuat KHR_texture_transform dan dibalik (v ke atas, konvensi three.js).
import fs from 'node:fs';
import path from 'node:path';

const UKURAN = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const BACA = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' };
const NORMAL = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
const JUMLAH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const DIDUKUNG = ['KHR_texture_transform', 'KHR_materials_specular', 'KHR_materials_ior'];

// File yang dirujuk aset harus berada di dalam folder aset itu sendiri.
function didalam(dir, uri) {
  const f = path.resolve(dir, decodeURIComponent(uri));
  if (!f.startsWith(path.resolve(dir) + path.sep)) throw new Error('rujukan file di luar folder aset: ' + uri);
  return f;
}

function kali(a, b) {                                   // matriks 4×4 urutan kolom
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

function matriksNode(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

export function bacaGltf(file) {
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

  // Gambar: { file } (di disk) atau { data, ext } (tertanam di GLB).
  function gambar(texInfo) {
    if (!texInfo || json.textures === undefined) return null;
    const t = json.textures[texInfo.index];
    if (!t || t.source === undefined) return null;
    const im = json.images[t.source];
    if (im.uri && !im.uri.startsWith('data:')) return { file: didalam(dir, im.uri) };
    const ext = /png/.test(im.mimeType || im.uri || '') ? 'png' : 'jpg';
    if (im.uri) return { data: Buffer.from(im.uri.slice(im.uri.indexOf(',') + 1), 'base64'), ext };
    const bv = json.bufferViews[im.bufferView], buf = buffers[bv.buffer];
    return { data: buf.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength), ext };
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

  const bagian = [];
  function jelajah(ni, induk) {
    const node = json.nodes[ni], M = kali(induk, matriksNode(node));
    if (node.mesh !== undefined) {
      // matriks normal = invers-transpos 3×3 (benar juga untuk skala tak seragam)
      const a = M[0], b = M[4], c = M[8], d = M[1], e = M[5], f = M[9], g = M[2], h = M[6], i = M[10];
      const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C || 1;
      const Nm = [A / det, (c * h - b * i) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, (c * d - a * f) / det, C / det, (b * g - a * h) / det, (a * e - b * d) / det];
      json.meshes[node.mesh].primitives.forEach(pr => {
        if (pr.mode !== undefined && pr.mode !== 4) return;
        if (pr.extensions && pr.extensions.KHR_draco_mesh_compression) throw new Error('mesh terkompresi Draco belum didukung');
        const pos = aksesor(pr.attributes.POSITION), nv = pos.length / 3;
        const nor = pr.attributes.NORMAL !== undefined ? aksesor(pr.attributes.NORMAL) : null;
        const uv = pr.attributes.TEXCOORD_0 !== undefined ? aksesor(pr.attributes.TEXCOORD_0) : null;
        const idx = pr.indices !== undefined ? aksesor(pr.indices, true) : Uint32Array.from({ length: nv }, (_, k) => k);
        const mat = pr.material !== undefined ? bahan[pr.material] : POLOS;
        for (let k = 0; k < nv; k++) {
          const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
          pos[k * 3] = M[0] * x + M[4] * y + M[8] * z + M[12];
          pos[k * 3 + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
          pos[k * 3 + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
          if (nor) {
            const nx = nor[k * 3], ny = nor[k * 3 + 1], nz = nor[k * 3 + 2];
            const px = Nm[0] * nx + Nm[3] * ny + Nm[6] * nz, py = Nm[1] * nx + Nm[4] * ny + Nm[7] * nz, pz = Nm[2] * nx + Nm[5] * ny + Nm[8] * nz, l = Math.hypot(px, py, pz) || 1;
            nor[k * 3] = px / l; nor[k * 3 + 1] = py / l; nor[k * 3 + 2] = pz / l;
          }
          if (uv) {
            let u = uv[k * 2], v = uv[k * 2 + 1];
            if (mat.uvT) {
              const t = mat.uvT, co = Math.cos(t.putar), si = Math.sin(t.putar), su = u * t.skala[0], sv = v * t.skala[1];
              u = co * su + si * sv + t.geser[0];
              v = -si * su + co * sv + t.geser[1];
            }
            uv[k * 2] = u; uv[k * 2 + 1] = 1 - v;
          }
        }
        bagian.push({ node: node.name || '', indeksNode: ni, indeksMesh: node.mesh, bahan: mat, pos, nor, uv, idx });
      });
    }
    for (const c of node.children || []) jelajah(c, M);
  }
  const scene = json.scenes && json.scenes[json.scene || 0];
  const akar = scene ? scene.nodes : json.nodes.map((_, i) => i).filter(i => !json.nodes.some(n => (n.children || []).includes(i)));
  for (const ni of akar) jelajah(ni, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return bagian;
}
