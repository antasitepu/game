# Pengamuk (unit unik wangsa Bara) buatan skrip: badan dan paha telanjang, mantel bulu di bahu, selempang dada
# (diwarnai tim oleh game), rok dan sepatu kulit berbulu, rambut merah berjambul, kapak di kedua tangan.
# Semua pembentuk dan gerak dari manusia.py.
# Hasil: satu GLB berkerangka (klip diam, jalan, lari, serang, mati) untuk `node tools/aset/olah.mjs pengamuk`:
# <folder-keluaran>.glb (bawaan tools/aset/sumber/pengamuk.glb) atau --glb, serta pratinjau PNG di <folder-keluaran>.
# Klip serang 0,8 detik: kapak kanan menghantam di ±0,29 detik, kapak kiri di ±0,46 detik.
#
#   blender --background --factory-startup --python tools/aset/blender/pengamuk.py -- <folder-keluaran> [--tekstur <folder>] [--glb <file>]
# Baris terakhir keluaran: PENGAMUK {json ringkasan}.
import os, sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manusia as mn

ARG = sys.argv[sys.argv.index('--') + 1:]
opsi = lambda n, bawaan=None: ARG[ARG.index(n) + 1] if n in ARG else bawaan
T = mn.Tokoh('pengamuk', ARG[0], opsi('--tekstur'))
linen, goni = T.tekstur('rough_linen'), T.tekstur('hessian_230')
kulit = T.bahan('kulit', (0.74, 0.53, 0.38))                                                   # kulit terbakar matahari
samak = T.bahan('samak', (0.27, 0.18, 0.12), kasar=0.7)
besi = T.bahan('besi', (0.60, 0.63, 0.66), kasar=0.42, logam=1.0)
kayu = T.bahan('kayu', (0.44, 0.31, 0.19), kasar=0.8)
bulu = lambda nama: T.kain(nama, goni, 2.2, (0.16, 0.11, 0.07), (0.40, 0.30, 0.21), kasar=0.95)   # kulit berbulu cokelat tua
merah = T.bahan('rambut', (0.66, 0.22, 0.05), kasar=0.8)

T.kepala(kulit, merah, T.bahan('muka', (0.16, 0.09, 0.07)))
T.jambul(merah, turun=0.035, tinggi=1.5)
T.dada(kulit)
T.lengan(kulit, dari=0.0)
T.paha(kulit)
T.kaki(bulu('sepatu_bulu'), nama='sepatu', tebal=0.012, atas=0.36)
T.rok(bulu('rok_bulu'), bawah=0.64, tim=False, segitiga=380)
T.sabuk(samak, juntai=False, lebar=0.026, longgar=0.018, gesper=besi)
T.mantel(bulu('mantel_bulu'))
T.selempang(T.kain('selempang', linen, 5.0, (0.72, 0.68, 0.60), (0.94, 0.92, 0.86)))          # putih gading: dikalikan warna tim
T.kapak(-1, kayu, besi)
T.kapak(1, kayu, besi)

T.rakit()
T.pratinjau()
T.gerakkan((('diam', 90, mn.siaga_kapak), ('jalan', 30, mn.jalan_kapak), ('lari', 20, mn.serbu_kapak), ('serang', 24, mn.amuk), ('mati', 36, mn.gugur_kapak)),
           glb=opsi('--glb', T.keluar + '.glb'),
           lihat={'*': {'pusat': (0, -0.1, 0.92), 'jarak': 5.0, 'ukuran': (300, 370)}, 'mati': {'pusat': (0, 0.35, 0.55), 'jarak': 5.8}})
T.pratinjau_tim()
T.ringkasan()
