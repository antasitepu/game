# Pengawal Karang (unit unik wangsa Samudra) buatan skrip: zirah pelat gelap dari leher sampai pergelangan, pelat bahu
# dan kaki, rok kain, jambul helm, dan muka perisai menara (ketiganya diwarnai tim oleh game), tombak di tangan kanan.
# Gerakannya sama dengan prajurit tombak. Semua pembentuk dari manusia.py.
# Hasil: satu GLB berkerangka (klip diam, jalan, lari, serang, mati) untuk `node tools/aset/olah.mjs pengawal`:
# <folder-keluaran>.glb (bawaan tools/aset/sumber/pengawal.glb) atau --glb, serta pratinjau PNG di <folder-keluaran>.
#
#   blender --background --factory-startup --python tools/aset/blender/pengawal.py -- <folder-keluaran> [--tekstur <folder>] [--glb <file>]
# Baris terakhir keluaran: PENGAWAL {json ringkasan}.
import os, sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manusia as mn

ARG = sys.argv[sys.argv.index('--') + 1:]
opsi = lambda n, bawaan=None: ARG[ARG.index(n) + 1] if n in ARG else bawaan
T = mn.Tokoh('pengawal', ARG[0], opsi('--tekstur'))
linen, goni = T.tekstur('rough_linen'), T.tekstur('hessian_230')
kulit = T.bahan('kulit', (0.66, 0.47, 0.34))
samak = T.bahan('samak', (0.20, 0.14, 0.10), kasar=0.7)
pelat = T.bahan('pelat', (0.42, 0.46, 0.50), kasar=0.44, logam=1.0)                            # besi gelap
besi = T.bahan('besi', (0.60, 0.63, 0.66), kasar=0.42, logam=1.0)
kayu = T.bahan('kayu', (0.44, 0.31, 0.19), kasar=0.8)
gading = lambda nama: T.kain(nama, linen, 5.0, (0.72, 0.68, 0.60), (0.94, 0.92, 0.86))        # kain putih gading: dikalikan warna tim

T.kepala(kulit, T.bahan('rambut', (0.07, 0.055, 0.05)), T.bahan('muka', (0.16, 0.09, 0.07)), rambut_penuh=False)
T.lengan(kulit, dari=0.44)
T.kaki(samak, nama='sepatu', tebal=0.007, atas=0.44)
T.celana(T.kain('celana', goni, 3.0, (0.12, 0.11, 0.10), (0.30, 0.27, 0.24)), bawah=0.42, segitiga=380)
T.tunik(pelat, lengan=0.48, tebal=0.012, segitiga=600, riak=0.0, tim=False)                    # pelat badan & lengan
T.rompi(pelat, tebal=0.03, segitiga=360)
T.rok(gading('rok'), bawah=0.58, segitiga=360)
T.sabuk(samak, juntai=False, lebar=0.024, longgar=0.044, gesper=besi)
T.pelindung_kaki(pelat)
T.pelindung_bahu(pelat)
T.helm(pelat, jambul=gading('jambul'))
T.perisai(T.bahan('cat', (0.91, 0.89, 0.84), kasar=0.6), kayu, besi, bentuk='menara')
T.tombak(kayu, besi)

T.rakit()
T.pratinjau()
T.gerakkan((('diam', 90, mn.siaga), ('jalan', 30, mn.baris), ('lari', 20, mn.serbu), ('serang', 24, mn.tusuk), ('mati', 36, mn.gugur)),
           glb=opsi('--glb', T.keluar + '.glb'),
           lihat={'*': {'pusat': (0, -0.1, 1.0), 'jarak': 6.0, 'ukuran': (320, 400)}, 'serang': {'pusat': (0, -0.5, 0.95), 'jarak': 7.2}, 'mati': {'pusat': (0, 0.3, 0.6), 'jarak': 6.6}})
T.pratinjau_tim()
T.ringkasan()
