# Ikon aplikasi Benteng Fajar (untuk pemasangan sebagai aplikasi di ponsel/desktop): siluet benteng di depan matahari terbit
# berwarna emas di atas cokelat tua HUD, dengan panji emas di puncak menara. Digambar langsung per piksel (bentuk-bentuk
# sederhana, 4× supersampel), jadi tidak butuh berkas sumber apa pun.
#   ikon-192.png, ikon-512.png      sudut membulat tembus pandang
#   ikon-maskable-512.png           latar penuh, gambar di dalam lingkaran aman 80% tengah (Android memotong tepinya)
#   ikon-180.png                    latar penuh tanpa transparansi (iOS)
#
#   blender --background --factory-startup --python tools/aset/blender/ikon.py -- assets/ikon
import bpy, os, sys
import numpy as np

KELUAR = os.path.abspath(sys.argv[sys.argv.index('--') + 1])
hexa = lambda h: np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)])
LATAR, TANAH, SILUET = hexa('#2a2117'), hexa('#1c150e'), hexa('#1c150e')
EMAS, INTI, TEPI, NYALA = hexa('#f4dfa0'), hexa('#fdeeb5'), hexa('#e89a3c'), hexa('#f7c873')
H, R = 0.22, 0.43                                           # tinggi cakrawala dan jari-jari matahari (satuan sisi ikon, v ke atas)


def gambar(N, skala=1.0, sudut=0.0):
    n = N * 4
    yy, xx = np.mgrid[0:n, 0:n]
    U, V = (xx + 0.5) / n, 1 - (yy + 0.5) / n               # koordinat ikon; baris 0 = atas
    u, v = (U - 0.5) / skala + 0.5, (V - 0.5) / skala + 0.5  # koordinat komposisi (diperkecil terhadap pusat untuk ikon maskable)
    kotak = lambda x0, x1, v0, v1: (u >= x0) & (u < x1) & (v >= H + v0) & (v < H + v1)     # tinggi dihitung dari cakrawala
    cermin = lambda x0, x1, v0, v1: kotak(x0, x1, v0, v1) | kotak(1 - x1, 1 - x0, v0, v1)
    g = np.empty((n, n, 3))
    g[:] = LATAR
    g += (0.05 * np.clip(1 - np.hypot(u - 0.5, v - H) / 0.9, 0, 1))[..., None]            # pendar fajar samar di langit
    r, sdt = np.hypot(u - 0.5, v - H), np.degrees(np.arctan2(v - H, u - 0.5))
    t = np.clip((r - (R + 0.03)) / 0.065, 0, 1)                                           # sinar: enam baji yang meruncing keluar, puncak dikosongkan untuk panji
    sinar = (v > H) & (r > R + 0.03) & (r < R + 0.095) & (np.abs((sdt + 11) % 22 - 11) < 3.6 * (1 - 0.7 * t)) & (sdt > 15) & (sdt < 165) & (np.abs(sdt - 90) > 15)
    g[sinar] = EMAS
    matahari = (r < R) & (v > H)
    f = np.clip(r / R, 0, 1)[..., None] ** 1.6
    g[matahari] = (INTI * (1 - f) + TEPI * f)[matahari]
    g[v < H] = TANAH
    g[kotak(0.05, 0.95, -0.012, 0)] = EMAS * 0.55                                         # garis cakrawala
    benteng = (kotak(0.405, 0.595, 0, 0.34) | kotak(0.385, 0.615, 0.32, 0.36) | kotak(0.385, 0.435, 0.36, 0.405) | kotak(0.475, 0.525, 0.36, 0.405) | kotak(0.565, 0.615, 0.36, 0.405)
               | kotak(0.24, 0.76, 0, 0.16) | cermin(0.31, 0.35, 0.16, 0.195) | cermin(0.365, 0.405, 0.16, 0.195)
               | cermin(0.20, 0.30, 0, 0.24) | cermin(0.20, 0.235, 0.24, 0.28) | cermin(0.265, 0.30, 0.24, 0.28))
    g[benteng] = SILUET
    g[kotak(0.46, 0.54, 0, 0.10) | (np.hypot(u - 0.5, v - H - 0.10) < 0.04)] = NYALA      # gerbang lengkung yang terang
    g[kotak(0.488, 0.512, 0.21, 0.275) | cermin(0.243, 0.257, 0.13, 0.18)] = NYALA        # jendela menara
    panji = (u >= 0.504) & (v < H + 0.55 - (u - 0.504) * 0.34) & (v > H + 0.485 + (u - 0.504) * 0.34)
    g[kotak(0.495, 0.505, 0.405, 0.555) | panji] = EMAS
    a = np.ones((n, n))
    if sudut:                                               # sudut membulat tembus pandang
        dx, dy = np.maximum(np.abs(U - 0.5) - (0.5 - sudut), 0), np.maximum(np.abs(V - 0.5) - (0.5 - sudut), 0)
        a = (np.hypot(dx, dy) <= sudut).astype(float)
    kecil = lambda x: x.reshape(N, 4, N, 4, -1).mean(axis=(1, 3))
    return np.concatenate([kecil(g * a[..., None]) / np.maximum(kecil(a[..., None]), 1e-6), kecil(a[..., None])], axis=2)


def simpan(nama, px):
    N = px.shape[0]
    im = bpy.data.images.new(nama, N, N, alpha=True)
    im.colorspace_settings.name, im.alpha_mode = 'Non-Color', 'STRAIGHT'
    im.pixels.foreach_set(np.ascontiguousarray(px[::-1], np.float32).ravel())
    im.filepath_raw, im.file_format = os.path.join(KELUAR, nama), 'PNG'
    im.save()


os.makedirs(KELUAR, exist_ok=True)
simpan('ikon-192.png', gambar(192, sudut=0.18))
simpan('ikon-512.png', gambar(512, sudut=0.18))
simpan('ikon-maskable-512.png', gambar(512, skala=0.8))
simpan('ikon-180.png', gambar(180))
if '--kecil' in sys.argv:                                   # pratinjau keterbacaan pada ukuran kecil
    simpan('pratinjau-48.png', gambar(48, sudut=0.18))
print('IKON selesai →', KELUAR)
