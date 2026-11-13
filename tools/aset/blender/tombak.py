# Prajurit tombak buatan skrip: baju berlapis kapas putih gading dan muka perisai (keduanya diwarnai tim oleh game),
# helm besi, sabuk dan sepatu kulit, celana, perisai bulat di lengan kiri, tombak di tangan kanan. Tubuh, bahan,
# pemanggangan atlas (warna + kekasaran/logam), kerangka, bobot, dan gerak berasal dari manusia.py.
# Hasil: satu GLB berkerangka (klip diam, jalan, lari, serang, mati) untuk `node tools/aset/olah.mjs tombak`:
# <folder-keluaran>.glb (bawaan tools/aset/sumber/tombak.glb) atau --glb. Di <folder-keluaran>: tombak-atlas.png,
# tombak-orm.png, pratinjau tombak-{depan,samping,belakang,serong,atas}.png, tombak-tim-{biru,merah}.png, dan lembar
# kontak tombak-gerak-<klip>.png.
#
#   blender --background --factory-startup --python tools/aset/blender/tombak.py -- <folder-keluaran> [--tekstur <folder>] [--glb <file>]
# Baris terakhir keluaran: TOMBAK {json ringkasan}.
import bmesh, os, sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manusia as mn
from manusia import X, Y, Z

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
T.sabuk(samak, juntai=False, lebar=0.024, longgar=0.027)
z, rx, ry = T.PINGGANG
bm = bmesh.new()
mn.elips(bm, (0, -ry - 0.029, z), (0.022, 0.006, 0.019), seg=8, ring=4)                        # gesper
T.tambah('gesper', bm, besi)

# helm besi: kubah lonjong dengan bibir dan pelindung hidung
bm = bmesh.new()
mn.bubut(bm, [(0.113, 1.588), (0.113, 1.602), (0.108, 1.606), (0.106, 1.635), (0.096, 1.675), (0.070, 1.712), (0.034, 1.733), (0.004, 1.739)], 16,
         pusat=(0, 0.002, 0), sumbu=(X * 0.90, Y * 1.04, Z))
mn.tabung(bm, [((0, -0.114, 1.606), 0.010, 0.004), ((0, -0.119, 1.548), 0.008, 0.004)], seg=6)
T.tambah('helm', bm, besi, kaku='Head')

# perisai bulat di lengan bawah kiri: muka bercat (warna tim), punggung kayu, tonjolan besi di tengah
S, d, w = T.LENGAN[1]
C = S + d * 0.415 + w * 0.05
bm = bmesh.new()
mn.bubut(bm, [(0.275, 0.006), (0.268, 0.016), (0.19, 0.032), (0.062, 0.042)], 20, pusat=C, sumbu=(d, Y, w))
T.tambah('perisai_muka', bm, T.bahan('cat', (0.91, 0.89, 0.84), kasar=0.6), tim=True, kaku='LeftForeArm')
bm = bmesh.new()
mn.bubut(bm, [(0.004, -0.004), (0.262, -0.004), (0.282, 0.0), (0.282, 0.008), (0.275, 0.006)], 20, pusat=C, sumbu=(d, Y, w))
T.tambah('perisai', bm, kayu, kaku='LeftForeArm')
bm = bmesh.new()
mn.bubut(bm, [(0.062, 0.042), (0.052, 0.062), (0.030, 0.076), (0.004, 0.080)], 10, pusat=C, sumbu=(d, Y, w))
T.tambah('perisai_besi', bm, besi, kaku='LeftForeArm')

# tombak di tangan kanan, sepanjang sumbu depan-belakang (mata di depan); genggaman 0,86 m dari pangkal
g = T.genggam(-1) - T.LENGAN[-1][2] * 0.012
bm = bmesh.new()
mn.tabung(bm, [(g + Y * mn.GENGGAM, 0.013, 0.013), (g - Y * 1.10, 0.012, 0.012)], u=X, w=Z, seg=6)
T.tambah('gagang', bm, kayu, kaku='RightHand')
bm = bmesh.new()
mn.tabung(bm, [(g - Y * 1.08, 0.015, 0.015), (g - Y * 1.13, 0.016, 0.016), (g - Y * 1.17, 0.034, 0.007), (g - Y * 1.30, 0.014, 0.004), (g - Y * 1.37, 0.002, 0.002)], u=X, w=Z, seg=6)
T.tambah('mata_tombak', bm, besi, kaku='RightHand')

T.rakit()
T.pratinjau()
T.gerakkan((('diam', 90, mn.siaga), ('jalan', 30, mn.baris), ('lari', 20, mn.serbu), ('serang', 24, mn.tusuk), ('mati', 36, mn.gugur)),
           glb=opsi('--glb', T.keluar + '.glb'), tiru=[('tunik', 'celana', (0.90, 1.00)), ('sabuk', 'tunik', None), ('gesper', 'tunik', None)],
           lihat={'*': {'pusat': (0, -0.1, 1.0), 'jarak': 6.0, 'ukuran': (320, 400)}, 'serang': {'pusat': (0, -0.5, 0.95), 'jarak': 7.2}, 'mati': {'pusat': (0, 0.3, 0.6), 'jarak': 6.6}})
T.pratinjau_tim()
T.ringkasan()
