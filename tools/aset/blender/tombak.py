# Prajurit tombak buatan skrip: baju berlapis kapas putih gading dan muka perisai (keduanya diwarnai tim oleh game),
# helm besi, sabuk dan sepatu kulit, celana, perisai bulat di lengan kiri, tombak di tangan kanan. Tubuh, perlengkapan,
# pemanggangan atlas (warna + kekasaran/logam), kerangka, bobot, dan gerak berasal dari manusia.py.
# Hasil: satu GLB berkerangka (klip diam, jalan, lari, serang, mati) untuk `node tools/aset/olah.mjs tombak`:
# <folder-keluaran>.glb (bawaan tools/aset/sumber/tombak.glb) atau --glb, serta pratinjau PNG di <folder-keluaran>.
#
#   blender --background --factory-startup --python tools/aset/blender/tombak.py -- <folder-keluaran> [--tekstur <folder>] [--glb <file>]
# Baris terakhir keluaran: TOMBAK {json ringkasan}.
import os, sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manusia as mn

ARG = sys.argv[sys.argv.index('--') + 1:]
opsi = lambda n, bawaan=None: ARG[ARG.index(n) + 1] if n in ARG else bawaan
T = mn.Tokoh('tombak', ARG[0], opsi('--tekstur'))
linen, goni = T.tekstur('rough_linen'), T.tekstur('hessian_230')
kulit = T.bahan('kulit', (0.66, 0.47, 0.34))
samak = T.bahan('samak', (0.27, 0.18, 0.12), kasar=0.7)                                        # kulit samak: sabuk, sepatu
besi = T.bahan('besi', (0.60, 0.63, 0.66), kasar=0.42, logam=1.0)
kayu = T.bahan('kayu', (0.44, 0.31, 0.19), kasar=0.8)

T.kepala(kulit, T.bahan('rambut', (0.07, 0.055, 0.05)), T.bahan('muka', (0.16, 0.09, 0.07)), rambut_penuh=False)
T.lengan(kulit, dari=0.25)
T.kaki(samak, nama='sepatu', tebal=0.007, atas=0.36)
T.celana(T.kain('celana', goni, 3.0, (0.17, 0.14, 0.11), (0.38, 0.31, 0.24)))
T.tunik(T.kain('baju', linen, 5.0, (0.70, 0.66, 0.58), (0.93, 0.91, 0.85), jahitan=0.05), bawah=0.66, lengan=0.31, tebal=0.012, segitiga=900, riak=0.005)
T.sabuk(samak, juntai=False, lebar=0.024, longgar=0.027, gesper=besi)
T.helm(besi)
T.perisai(T.bahan('cat', (0.91, 0.89, 0.84), kasar=0.6), kayu, besi)
T.tombak(kayu, besi)

T.rakit()
T.pratinjau()
T.gerakkan((('diam', 90, mn.siaga), ('jalan', 30, mn.baris), ('lari', 20, mn.serbu), ('serang', 24, mn.tusuk), ('mati', 36, mn.gugur)),
           glb=opsi('--glb', T.keluar + '.glb'),
           lihat={'*': {'pusat': (0, -0.1, 1.0), 'jarak': 6.0, 'ukuran': (320, 400)}, 'serang': {'pusat': (0, -0.5, 0.95), 'jarak': 7.2}, 'mati': {'pusat': (0, 0.3, 0.6), 'jarak': 6.6}})
T.pratinjau_tim()
T.ringkasan()
