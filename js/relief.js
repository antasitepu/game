'use strict';
// Relief medan: bukit dan lembah untuk tampilan saja — simulasi tetap di bidang datar 2D, jadi aturan permainan,
// pencarian jalan, dan multiplayer tidak terpengaruh. Tinggi disimpan pada kisi titik berjarak 0,5 tile (sama dengan
// verteks bidang medan di render.js) dan dibaca dengan interpolasi bilinear. Tanah di bawah bangunan diratakan saat
// bangunan pertama kali tampil.
(function () {
  const N = BF.MAP_SIZE, R = 2, G = N * R + 1;                  // R titik per tile; G titik per sisi
  const relief = BF.relief = { grid: null, ver: 0, R, G };

  function vnoise(x, y, seed) {
    const hsh = (ix, iy) => { let n = (Math.imul(ix + seed * 131, 374761393) + Math.imul(iy - seed * 57, 668265263)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return (((n ^ (n >>> 16)) >>> 0) & 1023) / 1023; };
    const x0 = Math.floor(x), y0 = Math.floor(y);
    let fx = x - x0, fy = y - y0;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = hsh(x0, y0), b = hsh(x0 + 1, y0), c = hsh(x0, y0 + 1), d = hsh(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

  // Bangun kisi tinggi untuk peta ini. Bukit tersendiri (bukan gelombang rata) dipisahkan dataran, ditambah alunan kecil
  // di mana-mana; semuanya memudar ke nol 1–7 tile dari air supaya tepi danau dan sungai tetap rata. Sekitar markas awal
  // (map.starts) bukit diturunkan menjadi landai: adil bagi kedua pemain dan tata letak awal tetap rapi.
  relief.build = function (map, seed) {
    const s = (seed | 0) & 0xffff, dw = new Float32Array(N * N).fill(1e9), q = [];
    for (let i = 0; i < N * N; i++) if (map.terrain[i]) { dw[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {                           // jarak (langkah 4-arah) ke air terdekat
      const i = q[h], x = i % N, y = (i / N) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const j = ny * N + nx;
        if (dw[j] > dw[i] + 1) { dw[j] = dw[i] + 1; q.push(j); }
      }
    }
    // jarak ke air dibaca bilinear antar-pusat tile agar peluruhan bukit di tepi air mulus, tidak bertangga per tile
    const D = (x, y) => dw[Math.min(N - 1, Math.max(0, y)) * N + Math.min(N - 1, Math.max(0, x))];
    const water = (x, y) => {
      const fx = x - 0.5, fy = y - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
      return (D(ix, iy) * (1 - ax) + D(ix + 1, iy) * ax) * (1 - ay) + (D(ix, iy + 1) * (1 - ax) + D(ix + 1, iy + 1) * ax) * ay;
    };
    const g = relief.grid = new Float32Array(G * G);
    relief.lock = null;
    for (let iy = 0; iy < G; iy++)
      for (let ix = 0; ix < G; ix++) {
        const x = ix / R, y = iy / R;
        const big = vnoise(x / 17, y / 17, s) * 0.65 + vnoise(x / 8, y / 8, s + 7) * 0.35;
        const home = (map.starts || []).reduce((k, p) => Math.min(k, smooth(8, 15, Math.hypot(x - p.x, y - p.y))), 1);
        const hill = smooth(0.42, 0.9, big) * 3.0 * (0.12 + 0.88 * home);
        const roll = (vnoise(x / 4, y / 4, s + 13) - 0.5) * 0.28;
        const fade = smooth(1, 7, water(x, y));
        g[iy * G + ix] = Math.max(0, hill + roll + 0.11) * fade;
      }
    relief.ver++;
    return g;
  };

  // Tinggi tanah di titik dunia (x, y). 0 bila belum ada peta.
  relief.at = function (x, y) {
    const g = relief.grid;
    if (!g) return 0;
    const fx = Math.min(G - 1.001, Math.max(0, x * R)), fy = Math.min(G - 1.001, Math.max(0, y * R)), ix = fx | 0, iy = fy | 0, ax = fx - ix, ay = fy - iy, i = iy * G + ix;
    return (g[i] * (1 - ax) + g[i + 1] * ax) * (1 - ay) + (g[i + G] * (1 - ax) + g[i + G + 1] * ax) * ay;
  };

  // Ratakan tanah di bawah persegi tile (tx, ty, size) setinggi rata-rata tanah di dalamnya, sampai 0,55 tile di luarnya
  // (tempat alas tanah bangunan), lalu landai halus selebar 1,2 tile. Titik di bawah bangunan yang sudah diratakan lebih dulu
  // dikunci agar bangunan itu tidak ikut terangkat atau terbenam. Mengembalikan {base, x0, y0, x1, y1} (rentang kisi berubah).
  relief.flatten = function (tx, ty, size) {
    const g = relief.grid;
    if (!g) return { base: 0 };
    const lock = relief.lock || (relief.lock = new Uint8Array(G * G));
    const C = 0.55, M = 1.2, a0 = tx - C, b0 = ty - C, a1 = tx + size + C, b1 = ty + size + C;
    let sum = 0, n = 0;
    for (let iy = ty * R; iy <= (ty + size) * R; iy++) for (let ix = tx * R; ix <= (tx + size) * R; ix++) { sum += g[iy * G + ix]; n++; }
    const base = n ? sum / n : 0;
    const x0 = Math.max(0, Math.floor((a0 - M) * R)), x1 = Math.min(G - 1, Math.ceil((a1 + M) * R));
    const y0 = Math.max(0, Math.floor((b0 - M) * R)), y1 = Math.min(G - 1, Math.ceil((b1 + M) * R));
    for (let iy = y0; iy <= y1; iy++)
      for (let ix = x0; ix <= x1; ix++) {
        const i = iy * G + ix;
        if (lock[i]) continue;
        const x = ix / R, y = iy / R, d = Math.hypot(Math.max(a0 - x, 0, x - a1), Math.max(b0 - y, 0, y - b1));
        g[i] += (base - g[i]) * (1 - smooth(0, M, d));
      }
    for (let iy = ty * R; iy <= (ty + size) * R; iy++) for (let ix = tx * R; ix <= (tx + size) * R; ix++) lock[iy * G + ix] = 1;
    relief.ver++;
    return { base, x0, y0, x1, y1 };
  };

  // Tinggi rata-rata di bawah persegi tile (untuk bayangan penempatan bangunan sebelum tanahnya diratakan).
  relief.avg = function (tx, ty, size) {
    let s = 0, n = 0;
    for (let y = 0; y <= size; y += 0.5) for (let x = 0; x <= size; x += 0.5) { s += relief.at(tx + x, ty + y); n++; }
    return s / n;
  };

  // Normal permukaan (untuk memiringkan cincin seleksi mengikuti lereng).
  relief.normal = function (x, y, out) {
    const e = 0.25, hx = relief.at(x + e, y) - relief.at(x - e, y), hy = relief.at(x, y + e) - relief.at(x, y - e);
    return out.set(-hx / (2 * e), 1, -hy / (2 * e)).normalize();
  };
})();
