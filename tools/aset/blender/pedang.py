# Pendekar pedang buatan skrip: pelat dada besi di atas baju rantai, rok kain, jambul helm, dan muka perisai layang
# (ketiganya diwarnai tim oleh game), pelat kaki, pedang lurus di tangan kanan. Semua pembentuk dari manusia.py.
# Hasil: satu GLB berkerangka (klip diam, jalan, lari, serang, mati) untuk `node tools/aset/olah.mjs pedang`:
# <folder-keluaran>.glb (bawaan tools/aset/sumber/pedang.glb) atau --glb, serta pratinjau PNG di <folder-keluaran>.
#
#   blender --background --factory-startup --python tools/aset/blender/pedang.py -- <folder-keluaran> [--tekstur <folder>] [--glb <file>]
# Baris terakhir keluaran: PEDANG {json ringkasan}.
import os, sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manusia as mn

ARG = sys.argv[sys.argv.index('--') + 1:]
opsi = lambda n, bawaan=None: ARG[ARG.index(n) + 1] if n in ARG else bawaan
T = mn.Tokoh('pedang', ARG[0], opsi('--tekstur'))
linen, goni = T.tekstur('rough_linen'), T.tekstur('hessian_230')
kulit = T.bahan('kulit', (0.66, 0.47, 0.34))
samak = T.bahan('samak', (0.27, 0.18, 0.12), kasar=0.7)
besi = T.bahan('besi', (0.68, 0.71, 0.74), kasar=0.36, logam=1.0)
kayu = T.bahan('kayu', (0.44, 0.31, 0.19), kasar=0.8)
gading = lambda nama: T.kain(nama, linen, 5.0, (0.72, 0.68, 0.60), (0.94, 0.92, 0.86))        # kain putih gading: dikalikan warna tim

T.kepala(kulit, T.bahan('rambut', (0.07, 0.055, 0.05)), T.bahan('muka', (0.16, 0.09, 0.07)), rambut_penuh=False)
T.lengan(kulit, dari=0.34)
T.kaki(samak, nama='sepatu', tebal=0.007, atas=0.44)
T.celana(T.kain('celana', goni, 3.0, (0.17, 0.14, 0.11), (0.38, 0.31, 0.24)), bawah=0.42, segitiga=380)
T.tunik(T.kain('rantai', goni, 9.0, (0.26, 0.27, 0.29), (0.60, 0.62, 0.65), kasar=0.5, logam=0.85), lengan=0.40, tebal=0.008, segitiga=600, riak=0.003, tim=False)   # baju rantai
T.rompi(besi, segitiga=360)
T.rok(gading('rok'), bawah=0.60, segitiga=360)
T.sabuk(samak, juntai=False, lebar=0.024, longgar=0.036, gesper=besi)
T.pelindung_kaki(besi)
T.helm(besi, jambul=gading('jambul'))
T.perisai(T.bahan('cat', (0.91, 0.89, 0.84), kasar=0.6), kayu, besi, bentuk='layang')
T.pedang(besi, samak)

S = mn.PEDANG
T.rakit()
T.pratinjau()
T.gerakkan((('diam', 90, lambda P, p: mn.siaga(P, p, S)), ('jalan', 30, lambda P, p: mn.baris(P, p, S)), ('lari', 20, lambda P, p: mn.serbu(P, p, S)),
            ('serang', 24, mn.tebas), ('mati', 36, lambda P, p: mn.gugur(P, p, S))),
           glb=opsi('--glb', T.keluar + '.glb'),
           lihat={'*': {'pusat': (0, -0.1, 0.92), 'jarak': 5.0, 'ukuran': (300, 370)}, 'mati': {'pusat': (0, 0.35, 0.55), 'jarak': 5.8}})
T.pratinjau_tim()
T.ringkasan()
