// Operasi gambar untuk alat aset. Pengecilan memakai `sips` (bawaan macOS), pengodean WebP memakai `cwebp`
// (brew install webp), piksel dibaca lewat BMP.
// Juga pembaca HDRI Radiance (.hdr) dan penyiapannya menjadi peta lingkungan kecil.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-aset-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
let urut = 0;

// src: { file } atau { data, ext } (gambar tertanam di GLB) → path file di disk.
function fileDari(src) {
  if (src.file) return src.file;
  const f = path.join(tmp, 'tanam' + (urut++) + '.' + src.ext);
  fs.writeFileSync(f, src.data);
  return f;
}

function sips(args) {
  try { execFileSync('sips', args, { stdio: ['ignore', 'ignore', 'pipe'] }); }
  catch (e) { throw new Error('sips gagal (alat ini memakai sips bawaan macOS): ' + (e.stderr ? e.stderr.toString().trim() : e.message)); }
}

// Simpan sebagai WebP dengan sisi terpanjang ≤ maks: dikecilkan ke PNG (tanpa rugi) lalu dikodekan sekali saja.
// WebP dipilih karena pemain mengunduh semua tekstur lewat internet: ±30–40% lebih kecil daripada JPEG semutu.
export function simpanWebp(src, tujuan, maks, kualitas) {
  fs.mkdirSync(path.dirname(tujuan), { recursive: true });
  const png = path.join(tmp, 'kecil' + (urut++) + '.png');
  sips(['-s', 'format', 'png', '-Z', String(maks), fileDari(src), '--out', png]);
  try { execFileSync('cwebp', ['-quiet', '-q', String(kualitas || 80), '-m', '6', '-sharp_yuv', png, '-o', tujuan], { stdio: ['ignore', 'ignore', 'pipe'] }); }
  catch (e) { throw new Error('cwebp gagal (pasang dengan: brew install webp): ' + (e.stderr ? e.stderr.toString().trim() : e.message)); }
  fs.rmSync(png);
  return fs.statSync(tujuan).size;
}

// Baca piksel: { w, h, rgb: Uint8Array (baris 0 = atas) }.
export function muat(src, maks) {
  const f = path.join(tmp, 'px' + (urut++) + '.bmp');
  sips(['-s', 'format', 'bmp', '-Z', String(maks), fileDari(src), '--out', f]);
  const b = fs.readFileSync(f);
  if (b.toString('latin1', 0, 2) !== 'BM') throw new Error('BMP tidak dikenali');
  const off = b.readUInt32LE(10), w = b.readInt32LE(18), hRaw = b.readInt32LE(22), bpp = b.readUInt16LE(28), komp = b.readUInt32LE(30);
  const h = Math.abs(hRaw), bytes = bpp / 8;
  if ((bpp !== 24 && bpp !== 32) || (komp !== 0 && komp !== 3)) throw new Error('format BMP tidak didukung: ' + bpp + ' bit, kompresi ' + komp);
  let ir = 2, ig = 1, ib = 0;                                        // urutan standar: B, G, R(, A)
  if (komp === 3) {                                                  // BI_BITFIELDS: posisi kanal dari mask
    const byteKe = mask => Math.round(Math.log2(mask & -mask)) / 8;
    ir = byteKe(b.readUInt32LE(54)); ig = byteKe(b.readUInt32LE(58)); ib = byteKe(b.readUInt32LE(62));
  }
  const baris = Math.ceil(w * bytes / 4) * 4, rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const sy = hRaw > 0 ? h - 1 - y : y;
    for (let x = 0; x < w; x++) { const s = off + sy * baris + x * bytes, d = (y * w + x) * 3; rgb[d] = b[s + ir]; rgb[d + 1] = b[s + ig]; rgb[d + 2] = b[s + ib]; }
  }
  return { w, h, rgb };
}

// Pencuplik warna pada UV (v ke atas, berulang): rata-rata tetangga 5×5 yang bukan latar gelap. null bila semuanya latar.
export function pencuplik(img, ambang) {
  const { w, h, rgb } = img, batas = ambang === undefined ? 30 : ambang;
  return (u, v) => {
    u -= Math.floor(u); v -= Math.floor(v);
    const x0 = Math.min(w - 1, Math.floor(u * w)), y0 = Math.min(h - 1, Math.floor((1 - v) * h));
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const i = (((y0 + dy + h) % h) * w + (x0 + dx + w) % w) * 3;
        if (Math.max(rgb[i], rgb[i + 1], rgb[i + 2]) < batas) continue;
        r += rgb[i]; g += rgb[i + 1]; b += rgb[i + 2]; n++;
      }
    return n ? [r / n / 255, g / n / 255, b / n / 255] : null;
  };
}

export function rataRata(img, ambang) {
  const { rgb } = img, batas = ambang === undefined ? 30 : ambang;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < rgb.length; i += 3) { if (Math.max(rgb[i], rgb[i + 1], rgb[i + 2]) < batas) continue; r += rgb[i]; g += rgb[i + 1]; b += rgb[i + 2]; n++; }
  return n ? [r / n / 255, g / n / 255, b / n / 255] : [0.5, 0.5, 0.5];
}

// ---------------------------------------------------------------- HDRI

export function bacaHdr(file) {
  const b = fs.readFileSync(file);
  let p = 0;
  const baris = () => { let s = ''; while (p < b.length && b[p] !== 10) s += String.fromCharCode(b[p++]); p++; return s; };
  if (!/^#\?(RADIANCE|RGBE)/.test(baris())) throw new Error('bukan file Radiance HDR');
  while (baris() !== '') { /* lewati header */ }
  const m = /^-Y (\d+) \+X (\d+)/.exec(baris());
  if (!m) throw new Error('orientasi HDR tidak didukung');
  const h = +m[1], w = +m[2], data = new Float32Array(w * h * 3), scan = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    if (w >= 8 && w < 32768 && b[p] === 2 && b[p + 1] === 2 && !(b[p + 2] & 0x80)) {      // RLE per kanal
      p += 4;
      for (let c = 0; c < 4; c++)
        for (let x = 0; x < w;) {
          let n = b[p++];
          if (n > 128) { n -= 128; const v = b[p++]; while (n--) scan[(x++) * 4 + c] = v; }
          else while (n--) scan[(x++) * 4 + c] = b[p++];
        }
    } else for (let i = 0; i < w * 4; i++) scan[i] = b[p++];
    for (let x = 0; x < w; x++) {
      const e = scan[x * 4 + 3];
      if (!e) continue;
      const f = Math.pow(2, e - 136), d = (y * w + x) * 3;
      data[d] = scan[x * 4] * f; data[d + 1] = scan[x * 4 + 1] * f; data[d + 2] = scan[x * 4 + 2] * f;
    }
  }
  return { w, h, data };
}

// Siapkan langit untuk cahaya lingkungan: perkecil ke W×H, redam cakram matahari (matahari diwakili lampu arah di game),
// putar agar matahari HDRI searah `arah` (vektor menuju matahari di dunia game), isi belahan bawah dengan pantulan tanah,
// normalkan agar rata-rata kecerahan langit = `terang`. Hasil: byte RGBE, baris 0 = bawah (nadir).
export function olahLangit(hdr, W, H, arah, tanah, terang) {
  const { w, h, data } = hdr, lum = i => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  let maks = -1, kolomMatahari = 0;
  const contoh = [];
  for (let y = 0; y < h / 2; y++)
    for (let x = 0; x < w; x++) {
      const l = lum((y * w + x) * 3);
      if (l > maks) { maks = l; kolomMatahari = x; }
      if ((x + y * 7) % 13 === 0) contoh.push(l);
    }
  contoh.sort((a, b) => a - b);
  const batas = contoh[Math.floor(contoh.length * 0.98)] * 3;       // di atas ini dianggap cakram matahari → diredam
  const fx = w / W, fy = h / H, kecil = new Float32Array(W * H * 3);
  for (let Y = 0; Y < H; Y++)
    for (let X = 0; X < W; X++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = Math.floor(Y * fy); y < Math.floor((Y + 1) * fy); y++)
        for (let x = Math.floor(X * fx); x < Math.floor((X + 1) * fx); x++) {
          const i = (y * w + x) * 3, l = lum(i), k = l > batas ? batas / l : 1;
          r += data[i] * k; g += data[i + 1] * k; b += data[i + 2] * k; n++;
        }
      const d = (Y * W + X) * 3;
      kecil[d] = r / n; kecil[d + 1] = g / n; kecil[d + 2] = b / n;
    }
  let jumlah = 0, bobot = 0;                                         // rata-rata kecerahan langit, berbobot sudut ruang
  for (let Y = 0; Y < H / 2; Y++) {
    const wgt = Math.cos((0.5 - (Y + 0.5) / H) * Math.PI);
    for (let X = 0; X < W; X++) { const d = (Y * W + X) * 3; jumlah += (0.2126 * kecil[d] + 0.7152 * kecil[d + 1] + 0.0722 * kecil[d + 2]) * wgt; bobot += wgt; }
  }
  const norma = bobot / jumlah * terang;
  const uSasaran = Math.atan2(arah[2], arah[0]) / (2 * Math.PI) + 0.5, geser = Math.round((uSasaran - (kolomMatahari + 0.5) / w) * W);
  const out = new Uint8Array(W * H * 4);
  for (let Y = 0; Y < H; Y++) {
    const elev = (0.5 - (Y + 0.5) / H) * 180, kTanah = Math.min(1, Math.max(0, (4 - elev) / 8));    // campur ke warna tanah di bawah cakrawala
    for (let X = 0; X < W; X++) {
      const s = (Y * W + ((X - geser) % W + W) % W) * 3, d = ((H - 1 - Y) * W + X) * 4;
      const c = [0, 1, 2].map(k => kecil[s + k] * norma * (1 - kTanah) + tanah[k] * kTanah), m = Math.max(c[0], c[1], c[2]);
      if (m < 1e-30) continue;
      const e = Math.floor(Math.log2(m)) + 1, sk = 256 / Math.pow(2, e);
      out[d] = Math.min(255, c[0] * sk); out[d + 1] = Math.min(255, c[1] * sk); out[d + 2] = Math.min(255, c[2] * sk); out[d + 3] = e + 128;
    }
  }
  return { rgbe: out, info: { redamDiAtas: +(batas * norma).toFixed(2), puncakAsli: +(maks * norma).toFixed(0), geserKolom: geser } };
}
