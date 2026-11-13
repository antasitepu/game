// Operasi geometri untuk alat aset: komponen terhubung, penyederhanaan (meshoptimizer), kartu daun, taburan.
// Mesh = { pos: Float32Array(3n), nor: Float32Array(3n), uv: Float32Array(2n)|null, col: Float32Array(3n)|null (sRGB 0..1), idx: Uint32Array }
// Mesh berkerangka menambah sendi: Uint16Array(4n) (nomor tulang) dan bobot: Float32Array(4n); keduanya ikut kompak/gabung/salin.
import { MeshoptSimplifier as MS } from 'meshoptimizer';

await MS.ready;

export const jumlahTri = m => m.idx.length / 3;

export function acak(seed) {                             // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function kotak(m) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.pos.length; i += 3) for (let c = 0; c < 3; c++) { const v = m.pos[i + c]; if (v < min[c]) min[c] = v; if (v > max[c]) max[c] = v; }
  return { min, max };
}

// Buang vertex yang tidak dipakai indeks.
export function kompak(m) {
  const n = m.pos.length / 3, peta = new Int32Array(n).fill(-1);
  let k = 0;
  for (let i = 0; i < m.idx.length; i++) if (peta[m.idx[i]] < 0) peta[m.idx[i]] = k++;
  const pos = new Float32Array(k * 3), nor = new Float32Array(k * 3), uv = m.uv ? new Float32Array(k * 2) : null, col = m.col ? new Float32Array(k * 3) : null;
  const sendi = m.sendi ? new Uint16Array(k * 4) : null, bobot = m.sendi ? new Float32Array(k * 4) : null;
  for (let i = 0; i < n; i++) {
    const j = peta[i];
    if (j < 0) continue;
    for (let c = 0; c < 3; c++) { pos[j * 3 + c] = m.pos[i * 3 + c]; nor[j * 3 + c] = m.nor[i * 3 + c]; if (col) col[j * 3 + c] = m.col[i * 3 + c]; }
    if (uv) { uv[j * 2] = m.uv[i * 2]; uv[j * 2 + 1] = m.uv[i * 2 + 1]; }
    if (sendi) for (let c = 0; c < 4; c++) { sendi[j * 4 + c] = m.sendi[i * 4 + c]; bobot[j * 4 + c] = m.bobot[i * 4 + c]; }
  }
  const idx = new Uint32Array(m.idx.length);
  for (let i = 0; i < idx.length; i++) idx[i] = peta[m.idx[i]];
  return sendi ? { pos, nor, uv, col, idx, sendi, bobot } : { pos, nor, uv, col, idx };
}

export function gabung(list) {
  list = list.filter(m => m && m.idx.length);
  const nv = list.reduce((s, m) => s + m.pos.length / 3, 0), ni = list.reduce((s, m) => s + m.idx.length, 0);
  const adaUv = list.some(m => m.uv), adaCol = list.some(m => m.col);
  const out = { pos: new Float32Array(nv * 3), nor: new Float32Array(nv * 3), uv: adaUv ? new Float32Array(nv * 2) : null, col: adaCol ? new Float32Array(nv * 3).fill(1) : null, idx: new Uint32Array(ni) };
  if (list.some(m => m.sendi)) {
    if (!list.every(m => m.sendi)) throw new Error('tidak bisa menggabung mesh berkerangka dengan mesh tanpa kerangka');
    out.sendi = new Uint16Array(nv * 4); out.bobot = new Float32Array(nv * 4);
  }
  let v = 0, i = 0;
  for (const m of list) {
    out.pos.set(m.pos, v * 3);
    out.nor.set(m.nor || new Float32Array(m.pos.length), v * 3);
    if (m.uv) out.uv.set(m.uv, v * 2);
    if (m.col) out.col.set(m.col, v * 3);
    if (m.sendi) { out.sendi.set(m.sendi, v * 4); out.bobot.set(m.bobot, v * 4); }
    for (let k = 0; k < m.idx.length; k++) out.idx[i + k] = m.idx[k] + v;
    v += m.pos.length / 3; i += m.idx.length;
  }
  return out;
}

// Geser lalu skalakan (boleh tak seragam); normal ikut dikoreksi.
export function ubah(m, geser, skala) {
  const [sx, sy, sz] = skala;
  for (let i = 0; i < m.pos.length; i += 3) {
    m.pos[i] = (m.pos[i] + geser[0]) * sx; m.pos[i + 1] = (m.pos[i + 1] + geser[1]) * sy; m.pos[i + 2] = (m.pos[i + 2] + geser[2]) * sz;
    const nx = m.nor[i] / sx, ny = m.nor[i + 1] / sy, nz = m.nor[i + 2] / sz, l = Math.hypot(nx, ny, nz) || 1;
    m.nor[i] = nx / l; m.nor[i + 1] = ny / l; m.nor[i + 2] = nz / l;
  }
  return m;
}

export function putarY(m, sudut) {
  const c = Math.cos(sudut), s = Math.sin(sudut);
  for (const a of [m.pos, m.nor]) for (let i = 0; i < a.length; i += 3) { const x = a[i], z = a[i + 2]; a[i] = c * x + s * z; a[i + 2] = -s * x + c * z; }
  return m;
}

export const salin = m => ({ pos: m.pos.slice(), nor: m.nor.slice(), uv: m.uv ? m.uv.slice() : null, col: m.col ? m.col.slice() : null, idx: m.idx.slice(), ...(m.sendi ? { sendi: m.sendi.slice(), bobot: m.bobot.slice() } : {}) });

// Potong mesh dengan bidang: bagian yang memenuhi n·p ≤ d dipertahankan. Segitiga yang terpotong dibelah, atributnya diinterpolasi.
export function potong(m, n, d) {
  const P = [], N = [], U = [], C = [], I = [];
  const titik = i => ({
    p: [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]], n: [m.nor[i * 3], m.nor[i * 3 + 1], m.nor[i * 3 + 2]],
    u: m.uv ? [m.uv[i * 2], m.uv[i * 2 + 1]] : null, c: m.col ? [m.col[i * 3], m.col[i * 3 + 1], m.col[i * 3 + 2]] : null,
    s: n[0] * m.pos[i * 3] + n[1] * m.pos[i * 3 + 1] + n[2] * m.pos[i * 3 + 2] - d,
  });
  const antara = (a, b) => { const t = a.s / (a.s - b.s), L = (x, y) => x.map((v, k) => v + (y[k] - v) * t); return { p: L(a.p, b.p), n: L(a.n, b.n), u: a.u && L(a.u, b.u), c: a.c && L(a.c, b.c), s: 0 }; };
  for (let t = 0; t < m.idx.length; t += 3) {
    const tri = [titik(m.idx[t]), titik(m.idx[t + 1]), titik(m.idx[t + 2])], out = [];
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      if (a.s <= 0) out.push(a);
      if ((a.s <= 0) !== (b.s <= 0)) out.push(antara(a, b));
    }
    if (out.length < 3) continue;
    const base = P.length / 3;
    for (const v of out) { P.push(v.p[0], v.p[1], v.p[2]); N.push(v.n[0], v.n[1], v.n[2]); if (v.u) U.push(v.u[0], v.u[1]); if (v.c) C.push(v.c[0], v.c[1], v.c[2]); }
    for (let k = 1; k < out.length - 1; k++) I.push(base, base + k, base + k + 1);
  }
  return { pos: new Float32Array(P), nor: new Float32Array(N), uv: m.uv ? new Float32Array(U) : null, col: m.col ? new Float32Array(C) : null, idx: new Uint32Array(I) };
}

// Komponen terhubung (vertex berposisi sama dianggap satu). Hasil: [{ tris: [nomor segitiga], min, max, ukuran }]
export function komponen(m) {
  const n = m.pos.length / 3, sama = MS.generatePositionRemap(m.pos, 3), induk = new Uint32Array(n);
  for (let i = 0; i < n; i++) induk[i] = i;
  const cari = x => { while (induk[x] !== x) { induk[x] = induk[induk[x]]; x = induk[x]; } return x; };
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = cari(sama[m.idx[t]]), b = cari(sama[m.idx[t + 1]]);
    if (b !== a) induk[b] = a;
    const c = cari(sama[m.idx[t + 2]]);
    if (c !== a) induk[c] = a;
  }
  const nomor = new Map(), list = [];
  for (let t = 0; t < m.idx.length / 3; t++) {
    const r = cari(sama[m.idx[t * 3]]);
    let k = nomor.get(r);
    if (k === undefined) { k = list.length; nomor.set(r, k); list.push({ tris: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }); }
    const o = list[k];
    o.tris.push(t);
    for (let q = 0; q < 3; q++) { const v = m.idx[t * 3 + q] * 3; for (let c = 0; c < 3; c++) { const p = m.pos[v + c]; if (p < o.min[c]) o.min[c] = p; if (p > o.max[c]) o.max[c] = p; } }
  }
  for (const o of list) o.ukuran = Math.hypot(o.max[0] - o.min[0], o.max[1] - o.min[1], o.max[2] - o.min[2]);
  return list;
}

// Sub-mesh dari daftar nomor segitiga.
export function ambilTri(m, tris) {
  const idx = new Uint32Array(tris.length * 3);
  for (let k = 0; k < tris.length; k++) { const t = tris[k] * 3; idx[k * 3] = m.idx[t]; idx[k * 3 + 1] = m.idx[t + 1]; idx[k * 3 + 2] = m.idx[t + 2]; }
  return kompak({ ...m, idx });
}

// Hanya komponen-komponen terbesar (batang & dahan utama; ranting kecil dibuang).
export function terbesar(m, comps, jumlah) {
  const pilih = comps.slice().sort((a, b) => b.ukuran - a.ukuran).slice(0, jumlah);
  return ambilTri(m, pilih.flatMap(c => c.tris));
}

// Kurangi jumlah segitiga sampai kira-kira `target` dengan meshoptimizer (vertex asli dipertahankan, jadi UV/normal tetap sah).
// utuh: vertex tidak dipadatkan — hasilnya hanya daftar indeks lain atas vertex yang sama (untuk LOD yang berbagi vertex).
export function sederhanakan(m, target, flags, utuh) {
  if (jumlahTri(m) <= target) return m;
  const sasaran = Math.max(3, Math.round(target) * 3);
  let [idx] = MS.simplify(m.idx, m.pos, 3, sasaran, 1, flags || []);
  // Sambungan UV menahan penyederhanaan; untuk LOD jauh, izinkan melewatinya (distorsi tekstur tak terlihat dari jauh).
  if (idx.length > sasaran * 1.3) [idx] = MS.simplify(m.idx, m.pos, 3, sasaran, 1, (flags || []).concat('Permissive'));
  return utuh ? { ...m, idx } : kompak({ ...m, idx });
}

// Susun ulang vertex: vertex ke-k hasil = vertex urut[k] semula; indeks ikut dipetakan. `peta[lama]` = nomor barunya.
export function urutkanVertex(m, urut) {
  const peta = new Int32Array(urut.length);
  urut.forEach((lama, k) => { peta[lama] = k; });
  const ambil = (a, n) => {
    if (!a) return a;
    const b = new a.constructor(a.length);
    urut.forEach((lama, k) => { for (let c = 0; c < n; c++) b[k * n + c] = a[lama * n + c]; });
    return b;
  };
  return { ...m, pos: ambil(m.pos, 3), nor: ambil(m.nor, 3), uv: ambil(m.uv, 2), col: ambil(m.col, 3), sendi: ambil(m.sendi, 4), bobot: ambil(m.bobot, 4), idx: m.idx.map(i => peta[i]), peta };
}

// Tiap komponen (helai daun / bilah rumput) dijadikan satu kartu 2 segitiga dari empat titik ekstremnya.
// Hanya `simpan` helai pertama menurut `urutan` yang dipakai, lalu diperbesar `skala`× supaya tetap tampak rimbun.
// warna(u, v) → [r, g, b] sRGB atau null. pusat: titik tengah tajuk; `bulat` = seberapa jauh normal diarahkan keluar dari pusat
// (peneduhan tajuk yang lembut alih-alih berbintik per helai).
export function kartu(m, comps, urutan, { simpan, skala, lebar, warna, pusat, bulat, warnaCadangan }) {
  const P = [], Nn = [], Cc = [], I = [], pos = m.pos, nor = m.nor, uv = m.uv;
  const jarak2 = (a, b) => (pos[a * 3] - pos[b * 3]) ** 2 + (pos[a * 3 + 1] - pos[b * 3 + 1]) ** 2 + (pos[a * 3 + 2] - pos[b * 3 + 2]) ** 2;
  let dipakai = 0;
  for (let q = 0; q < urutan.length && dipakai < simpan; q++) {
    const comp = comps[urutan[q]], vs = new Set();
    for (const t of comp.tris) { vs.add(m.idx[t * 3]); vs.add(m.idx[t * 3 + 1]); vs.add(m.idx[t * 3 + 2]); }
    if (vs.size < 4) continue;
    const c = [0, 0, 0], n = [0, 0, 0], cu = [0, 0];
    for (const v of vs) { for (let k = 0; k < 3; k++) { c[k] += pos[v * 3 + k] / vs.size; n[k] += nor[v * 3 + k]; } if (uv) { cu[0] += uv[v * 2] / vs.size; cu[1] += uv[v * 2 + 1] / vs.size; } }
    const nl = Math.hypot(n[0], n[1], n[2]);
    if (nl < 1e-6) continue;
    n[0] /= nl; n[1] /= nl; n[2] /= nl;
    let A = -1, B = -1, best = -1;
    for (const v of vs) { const d = (pos[v * 3] - c[0]) ** 2 + (pos[v * 3 + 1] - c[1]) ** 2 + (pos[v * 3 + 2] - c[2]) ** 2; if (d > best) { best = d; A = v; } }
    best = -1;
    for (const v of vs) { const d = jarak2(v, A); if (d > best) { best = d; B = v; } }
    const u = [pos[B * 3] - pos[A * 3], pos[B * 3 + 1] - pos[A * 3 + 1], pos[B * 3 + 2] - pos[A * 3 + 2]], ul = Math.hypot(u[0], u[1], u[2]);
    if (ul < 1e-6) continue;
    const w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]], wl = Math.hypot(w[0], w[1], w[2]);
    if (wl < 1e-9) continue;
    let C = -1, D = -1, hi = -Infinity, lo = Infinity;
    for (const v of vs) {
      const d = ((pos[v * 3] - pos[A * 3]) * w[0] + (pos[v * 3 + 1] - pos[A * 3 + 1]) * w[1] + (pos[v * 3 + 2] - pos[A * 3 + 2]) * w[2]) / wl;
      if (d > hi) { hi = d; C = v; }
      if (d < lo) { lo = d; D = v; }
    }
    if (hi - lo < ul * 0.02 || C === D || C === A || C === B || D === A || D === B) continue;
    const base = P.length / 3;
    let rata = null;
    const warnaTitik = [];
    for (const v of [A, B, C, D]) {
      const col = warna && uv ? warna(uv[v * 2] + (cu[0] - uv[v * 2]) * 0.35, uv[v * 2 + 1] + (cu[1] - uv[v * 2 + 1]) * 0.35) : null;
      warnaTitik.push(col);
      if (col && !rata) rata = col;
    }
    if (!rata) rata = (warna && uv && warna(cu[0], cu[1])) || warnaCadangan;
    [A, B, C, D].forEach((v, k) => {
      const rel = [pos[v * 3] - c[0], pos[v * 3 + 1] - c[1], pos[v * 3 + 2] - c[2]], sejajar = (rel[0] * u[0] + rel[1] * u[1] + rel[2] * u[2]) / (ul * ul), kl = skala * (lebar || 1);
      const p = [0, 1, 2].map(i => c[i] + u[i] * sejajar * skala + (rel[i] - u[i] * sejajar) * kl);      // lebar: melebarkan tegak lurus sumbu helai
      let nx = nor[v * 3], ny = nor[v * 3 + 1], nz = nor[v * 3 + 2];
      if (pusat) {
        let ox = p[0] - pusat[0], oy = p[1] - pusat[1], oz = p[2] - pusat[2];
        const ol = Math.hypot(ox, oy, oz) || 1;
        ox /= ol; oy /= ol; oz /= ol;
        if (nx * ox + ny * oy + nz * oz < 0) { nx = -nx; ny = -ny; nz = -nz; }
        nx = nx * (1 - bulat) + ox * bulat; ny = ny * (1 - bulat) + oy * bulat; nz = nz * (1 - bulat) + oz * bulat;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
      }
      P.push(p[0], p[1], p[2]);
      Nn.push(nx, ny, nz);
      const col = warnaTitik[k] || rata;
      Cc.push(col[0], col[1], col[2]);
    });
    I.push(base, base + 1, base + 2, base, base + 3, base + 1);
    dipakai++;
  }
  return { pos: new Float32Array(P), nor: new Float32Array(Nn), uv: null, col: new Float32Array(Cc), idx: new Uint32Array(I) };
}

// Bilah rumput: tiap komponen dijadikan pita tipis 3 segitiga (pangkal lebar → ujung runcing) yang mengikuti lengkung
// bilah aslinya. Normal menghadap atas supaya rumput diterangi seperti tanah di sekitarnya.
export function pita(m, comps, urutan, { simpan, lebar, pangkal, ujung, seed }) {
  const P = [], Nn = [], Cc = [], I = [], pos = m.pos, r = acak(seed);
  let dipakai = 0;
  for (let q = 0; q < urutan.length && dipakai < simpan; q++) {
    const vs = new Set();
    for (const t of comps[urutan[q]].tris) { vs.add(m.idx[t * 3]); vs.add(m.idx[t * 3 + 1]); vs.add(m.idx[t * 3 + 2]); }
    let R = -1, T = -1, best = Infinity;
    for (const v of vs) if (pos[v * 3 + 1] < best) { best = pos[v * 3 + 1]; R = v; }
    best = -1;
    for (const v of vs) { const d = (pos[v * 3] - pos[R * 3]) ** 2 + (pos[v * 3 + 1] - pos[R * 3 + 1]) ** 2 + (pos[v * 3 + 2] - pos[R * 3 + 2]) ** 2; if (d > best) { best = d; T = v; } }
    const a = [pos[R * 3], pos[R * 3 + 1], pos[R * 3 + 2]], b = [pos[T * 3], pos[T * 3 + 1], pos[T * 3 + 2]], u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L2 = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
    if (L2 < 1e-8) continue;
    const mid = [0, 0, 0];
    let n = 0;
    for (const v of vs) {
      const t = ((pos[v * 3] - a[0]) * u[0] + (pos[v * 3 + 1] - a[1]) * u[1] + (pos[v * 3 + 2] - a[2]) * u[2]) / L2;
      if (t > 0.4 && t < 0.65) { mid[0] += pos[v * 3]; mid[1] += pos[v * 3 + 1]; mid[2] += pos[v * 3 + 2]; n++; }
    }
    for (let k = 0; k < 3; k++) mid[k] = n ? mid[k] / n : (a[k] + b[k]) / 2;
    const sudut = r() * Math.PI, s = [Math.cos(sudut) * lebar, 0, Math.sin(sudut) * lebar], terang = 0.8 + r() * 0.4, base = P.length / 3;
    const titik = [[a, 1, pangkal], [a, -1, pangkal], [mid, 0.7, null], [mid, -0.7, null], [b, 0, ujung]];
    for (const [p, k, col] of titik) {
      P.push(p[0] + s[0] * k, p[1], p[2] + s[2] * k);
      Nn.push(0, 1, 0);
      for (let c = 0; c < 3; c++) Cc.push(Math.min(1, (col ? col[c] : (pangkal[c] + ujung[c]) / 2) * terang));
    }
    I.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 3, base + 4, base + 2);
    dipakai++;
  }
  return { pos: new Float32Array(P), nor: new Float32Array(Nn), uv: null, col: new Float32Array(Cc), idx: new Uint32Array(I) };
}

// Urutan acak tetap atas n komponen: LOD yang lebih rendah memakai awalan urutan yang sama (helai yang sama, lebih sedikit).
export function urutanAcak(n, seed) {
  const r = acak(seed), a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

// Warnai seluruh vertex dengan satu warna (+ sedikit variasi), misalnya dahan yang terlalu kecil untuk diberi tekstur.
export function warnai(m, warna, variasi, seed) {
  const r = acak(seed || 1), n = m.pos.length / 3;
  m.col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const k = 1 + (r() - 0.5) * (variasi || 0); for (let c = 0; c < 3; c++) m.col[i * 3 + c] = Math.min(1, warna[c] * k); }
  m.uv = null;
  return m;
}

// Warna per vertex diambil dari tekstur pada UV vertex itu.
export function warnaiDariTekstur(m, warna, cadangan) {
  const n = m.pos.length / 3;
  m.col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const c = (m.uv && warna(m.uv[i * 2], m.uv[i * 2 + 1])) || cadangan; m.col[i * 3] = c[0]; m.col[i * 3 + 1] = c[1]; m.col[i * 3 + 2] = c[2]; }
  m.uv = null;
  return m;
}

// Taburkan benda kecil (bongkah emas / buah beri) di permukaan mesh, memilih segitiga sebanding luasnya.
// bentuk: 'okta' (bersudut) atau 'iko' (membulat). Hasil berupa mesh baru berwarna per-vertex.
export function tabur(m, { jumlah, radius, ragam, jarak, bentuk, warna, minY, seed, tanam }) {
  const r = acak(seed), tris = [], pos = m.pos;
  let total = 0;
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = m.idx[t] * 3, b = m.idx[t + 1] * 3, c = m.idx[t + 2] * 3;
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0], luas = Math.hypot(nx, ny, nz) / 2;
    const cy = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3;
    if (luas < 1e-9 || cy < minY) continue;
    const nrm = [m.nor[a] + m.nor[b] + m.nor[c], m.nor[a + 1] + m.nor[b + 1] + m.nor[c + 1], m.nor[a + 2] + m.nor[b + 2] + m.nor[c + 2]], nl = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1;
    if (nrm[1] / nl < -0.1) continue;
    total += luas;
    tris.push({ a, b, c, kum: total, n: [nrm[0] / nl, nrm[1] / nl, nrm[2] / nl] });
  }
  const PHI = (1 + Math.sqrt(5)) / 2;
  const OKTA = { v: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], f: [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]] };
  const IKO = {
    v: [[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]].map(p => { const l = Math.hypot(p[0], p[1], p[2]); return [p[0] / l, p[1] / l, p[2] / l]; }),
    f: [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]],
  };
  const S = bentuk === 'iko' ? IKO : OKTA, P = [], Nn = [], Cc = [], I = [], pusat = [];
  for (let k = 0, coba = 0; k < jumlah && tris.length && coba < jumlah * 30; coba++) {
    const pilih = r() * total;
    let lo = 0, hi = tris.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tris[mid].kum < pilih) lo = mid + 1; else hi = mid; }
    const T = tris[lo];
    let u = r(), v = r();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v, rad = radius * (1 + (r() - 0.5) * (ragam === undefined ? 0.6 : ragam));
    const ctr = [0, 1, 2].map(c => pos[T.a + c] * w + pos[T.b + c] * u + pos[T.c + c] * v + T.n[c] * rad * (tanam === undefined ? 0.35 : tanam));
    if (jarak && pusat.some(q => Math.hypot(q[0] - ctr[0], q[1] - ctr[1], q[2] - ctr[2]) < jarak)) continue;      // jangan bertumpuk
    pusat.push(ctr);
    k++;
    const ax = r() * Math.PI * 2, ay = r() * Math.PI * 2, ca = Math.cos(ax), sa = Math.sin(ax), cb = Math.cos(ay), sb = Math.sin(ay);
    const rot = p => { const y1 = p[1] * ca - p[2] * sa, z1 = p[1] * sa + p[2] * ca, x2 = p[0] * cb + z1 * sb, z2 = -p[0] * sb + z1 * cb; return [x2, y1, z2]; };
    const terang = 0.85 + r() * 0.3, col = warna.map(c => Math.min(1, c * terang));
    if (bentuk === 'iko') {
      const base = P.length / 3;
      for (const p0 of S.v) { const p = rot(p0); P.push(ctr[0] + p[0] * rad, ctr[1] + p[1] * rad, ctr[2] + p[2] * rad); Nn.push(p[0], p[1], p[2]); Cc.push(col[0], col[1], col[2]); }
      for (const f of S.f) I.push(base + f[0], base + f[1], base + f[2]);
    } else {
      const str = [0.7 + r() * 0.6, 0.7 + r() * 0.6, 0.7 + r() * 0.6];
      for (const f of S.f) {
        const q = f.map(i => rot([S.v[i][0] * str[0], S.v[i][1] * str[1], S.v[i][2] * str[2]]));
        const e1 = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]], e2 = [q[2][0] - q[0][0], q[2][1] - q[0][1], q[2][2] - q[0][2]];
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(n[0], n[1], n[2]) || 1, base = P.length / 3;
        for (const p of q) { P.push(ctr[0] + p[0] * rad, ctr[1] + p[1] * rad, ctr[2] + p[2] * rad); Nn.push(n[0] / l, n[1] / l, n[2] / l); Cc.push(col[0], col[1], col[2]); }
        I.push(base, base + 1, base + 2);
      }
    }
  }
  return { pos: new Float32Array(P), nor: new Float32Array(Nn), uv: null, col: new Float32Array(Cc), idx: new Uint32Array(I) };
}
