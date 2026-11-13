# Tabib (penyembuh, tak bersenjata) buatan skrip: jubah selutut berlengan panjang (diwarnai tim oleh game), ikat kepala
# putih, sabuk kain, tas obat berselempang, dan tongkat berlabu obat di tangan kanan. Semua pembentuk dan gerak dari
# manusia.py.
# Hasil: satu GLB berkerangka (klip diam, jalan, lari, kerja, mati) untuk `node tools/aset/olah.mjs tabib`:
# <folder-keluaran>.glb (bawaan tools/aset/sumber/tabib.glb) atau --glb, serta pratinjau PNG di <folder-keluaran>.
# Klip kerja = gerak menyembuhkan, 1,4 detik, berulang mulus (awal = akhir).
#
#   blender --background --factory-startup --python tools/aset/blender/tabib.py -- <folder-keluaran> [--tekstur <folder>] [--glb <file>]
# Baris terakhir keluaran: TABIB {json ringkasan}.
import os, sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manusia as mn

ARG = sys.argv[sys.argv.index('--') + 1:]
opsi = lambda n, bawaan=None: ARG[ARG.index(n) + 1] if n in ARG else bawaan
T = mn.Tokoh('tabib', ARG[0], opsi('--tekstur'))
linen, goni = T.tekstur('rough_linen'), T.tekstur('hessian_230')
kulit = T.bahan('kulit', (0.66, 0.47, 0.34))
samak = T.bahan('samak', (0.27, 0.18, 0.12), kasar=0.7)

T.kepala(kulit, T.bahan('rambut', (0.07, 0.055, 0.05)), T.bahan('muka', (0.16, 0.09, 0.07)), rambut_penuh=False)
T.lengan(kulit, dari=0.34)
T.kaki(kulit)
T.celana(T.kain('celana', goni, 3.0, (0.20, 0.15, 0.11), (0.45, 0.35, 0.26)), segitiga=420)
T.tunik(T.kain('jubah', linen, 5.0, (0.72, 0.68, 0.60), (0.94, 0.92, 0.86)), bawah=0.50, lengan=0.42, segitiga=900, riak=0.012)   # putih gading: dikalikan warna tim
T.sabuk(T.kain('sabuk', linen, 5.0, (0.16, 0.12, 0.10), (0.34, 0.26, 0.20)))
T.tudung(T.kain('ikat_kepala', linen, 5.0, (0.74, 0.72, 0.66), (0.96, 0.95, 0.91)), tim=False)
T.tas(samak, samak)
T.tongkat(T.bahan('kayu', (0.44, 0.31, 0.19), kasar=0.8), labu=T.bahan('labu', (0.62, 0.48, 0.22), kasar=0.6))

T.rakit()
T.pratinjau()
T.gerakkan((('diam', 90, mn.siaga_tongkat), ('jalan', 30, mn.jalan_tongkat), ('lari', 20, mn.lari_tongkat), ('kerja', 42, mn.sembuh), ('mati', 36, mn.gugur_tongkat)),
           glb=opsi('--glb', T.keluar + '.glb'),
           lihat={'*': {'pusat': (0, -0.1, 0.95), 'jarak': 5.4, 'ukuran': (300, 370)}, 'mati': {'pusat': (0, 0.35, 0.55), 'jarak': 6.2}})
T.pratinjau_tim()
T.ringkasan()
