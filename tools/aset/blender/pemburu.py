# Pemburu Rimba (unit unik wangsa Rimba) buatan skrip: tunik hijau, selempang pinggang dan jubah pendek (keduanya
# diwarnai tim oleh game), topi berbulu, sepatu kulit, tabung anak panah, busur panjang di tangan kiri. Gerakannya sama dengan
# pemanah. Semua pembentuk dan gerak dari manusia.py.
# Hasil: satu GLB berkerangka (klip diam, jalan, lari, serang, mati) untuk `node tools/aset/olah.mjs pemburu`:
# <folder-keluaran>.glb (bawaan tools/aset/sumber/pemburu.glb) atau --glb, serta pratinjau PNG di <folder-keluaran>.
#
#   blender --background --factory-startup --python tools/aset/blender/pemburu.py -- <folder-keluaran> [--tekstur <folder>] [--glb <file>]
# Baris terakhir keluaran: PEMBURU {json ringkasan}.
import os, sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manusia as mn

ARG = sys.argv[sys.argv.index('--') + 1:]
opsi = lambda n, bawaan=None: ARG[ARG.index(n) + 1] if n in ARG else bawaan
T = mn.Tokoh('pemburu', ARG[0], opsi('--tekstur'))
linen, goni = T.tekstur('rough_linen'), T.tekstur('hessian_230')
kulit = T.bahan('kulit', (0.66, 0.47, 0.34))
samak = T.bahan('samak', (0.27, 0.18, 0.12), kasar=0.7)
kayu = T.bahan('kayu', (0.44, 0.31, 0.19), kasar=0.8)

T.kepala(kulit, T.bahan('rambut', (0.07, 0.055, 0.05)), T.bahan('muka', (0.16, 0.09, 0.07)))
T.lengan(kulit)
T.kaki(samak, nama='sepatu', tebal=0.007, atas=0.36)
T.celana(T.kain('celana', goni, 3.0, (0.18, 0.15, 0.10), (0.40, 0.34, 0.24)))
T.tunik(T.kain('tunik', linen, 5.0, (0.16, 0.30, 0.15), (0.32, 0.50, 0.28)), tim=False)        # hijau rimba
T.sabuk(T.kain('selempang', linen, 5.0, (0.72, 0.68, 0.60), (0.94, 0.92, 0.86)), tim=True)     # putih gading: dikalikan warna tim
T.jubah(T.kain('jubah', linen, 4.0, (0.66, 0.62, 0.55), (0.90, 0.88, 0.82)), tim=True)          # jubah: tanda tim yang terlihat dari kamera game
T.topi(samak, T.bahan('bulu', (0.92, 0.90, 0.84)))
T.tabung_panah(samak, kayu, T.bahan('bulu_panah', (0.88, 0.86, 0.80)))
T.busur(T.bahan('kayu_busur', (0.30, 0.20, 0.12), kasar=0.6), T.bahan('tali', (0.82, 0.78, 0.68)), panjang=1.38)

T.rakit()
T.pratinjau()
T.gerakkan((('diam', 90, mn.siaga_busur), ('jalan', 30, mn.jalan_busur), ('lari', 20, mn.lari_busur), ('serang', 30, mn.panah), ('mati', 36, mn.gugur_busur)),
           glb=opsi('--glb', T.keluar + '.glb'),
           lihat={'*': {'pusat': (0, -0.1, 0.95), 'jarak': 5.2, 'ukuran': (300, 370)}, 'serang': {'arah': (1, -0.55, 0.3)}, 'mati': {'pusat': (0, 0.35, 0.55), 'jarak': 5.8}})
T.pratinjau_tim()
T.ringkasan()
