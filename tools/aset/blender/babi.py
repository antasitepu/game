# Babi hutan (hewan liar) buatan skrip: badan gempal cokelat tua, punuk berbulu surai, kepala baji bertaring, kaki
# pendek. Kerangka 19 tulang berawalan Beast dan geraknya dari hewan.py; pemanggangan atlas dan ekspor dari manusia.py.
# Tanpa bahan tim.
# Hasil: satu GLB berkerangka (klip diam, jalan, lari, makan, serang, mati) untuk `node tools/aset/olah.mjs babi`:
# <folder-keluaran>.glb (bawaan tools/aset/sumber/babi.glb) atau --glb, serta pratinjau PNG di <folder-keluaran>.
# Laju rancangan pada model: jalan 0,43 m per putaran (0,4 detik), lari 1,29 m per putaran (0,27 detik).
# Klip serang 0,6 detik = seruduk; sentakan kepala memuncak di 0,28 detik (hw.SERUDUK).
#
#   blender --background --factory-startup --python tools/aset/blender/babi.py -- <folder-keluaran> [--tekstur <folder>] [--glb <file>]
# Baris terakhir keluaran: BABI {json ringkasan}.
import bmesh, os, sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manusia as mn
import hewan as hw
from manusia import X, Y, Z, Vector, tabung, elips

ARG = sys.argv[sys.argv.index('--') + 1:]
opsi = lambda n, bawaan=None: ARG[ARG.index(n) + 1] if n in ARG else bawaan
B = {'pre': 'Beast', 'u': 0.45,
     'tulang': {'Root': ((0, 0.02, 0.56), (0, 0.02, 0.66)), 'Spine': ((0, 0.02, 0.58), (0, -0.08, 0.58)), 'Chest': ((0, -0.08, 0.58), (0, -0.42, 0.60)),
                'Hip': ((0, 0.10, 0.58), (0, 0.50, 0.58)), 'Neck': ((0, -0.40, 0.62), (0, -0.56, 0.58)), 'Head': ((0, -0.56, 0.58), (0, -0.98, 0.38)),
                'Tail': ((0, 0.58, 0.62), (0, 0.66, 0.46))},
     'x_depan': 0.11, 'x_belakang': 0.11,
     'depan': ((-0.34, 0.36), (-0.35, 0.20), (-0.34, 0.06), (-0.37, 0.01)), 'belakang': ((0.40, 0.38), (0.46, 0.24), (0.43, 0.06), (0.40, 0.01)),
     'jalan': (0.60, 0.13, 0.075, 0.06), 'lari': (0.28, 0.18, 0.15, 0.13), 'rebah': 0.22, 'makan': (24, 16, 4, 0.07), 'ekor_lari': 60}

T = mn.Tokoh('babi', ARG[0], opsi('--tekstur'))
goni = T.tekstur('hessian_230')
bulu = T.kain('bulu', goni, 2.6, (0.15, 0.11, 0.09), (0.36, 0.28, 0.22), kasar=0.95)
gelap = T.bahan('gelap', (0.07, 0.055, 0.05), kasar=0.6)

kepala, moncong = Vector((0, -0.48, 0.60)), Vector((0, -0.92, -0.40)).normalized()
dahi = Vector((0, -0.40, 0.92)).normalized()
bm = bmesh.new()
tabung(bm, [((0, y, z), rx, rz) for y, z, rx, rz in ((-0.56, 0.56, 0.10, 0.14), (-0.44, 0.58, 0.20, 0.25), (-0.25, 0.60, 0.24, 0.27), (0.0, 0.58, 0.24, 0.25),
                                                    (0.25, 0.57, 0.23, 0.24), (0.45, 0.56, 0.19, 0.21), (0.58, 0.55, 0.08, 0.10))], u=X, w=Z, seg=16)
tabung(bm, [(kepala + moncong * d, rx, rt) for d, rx, rt in ((0.0, 0.17, 0.20), (0.16, 0.14, 0.16), (0.34, 0.085, 0.09), (0.48, 0.060, 0.060), (0.52, 0.055, 0.055))], u=X, w=dahi, seg=12)
for k in (1, -1):
    elips(bm, (k * 0.13, -0.34, 0.50), (0.09, 0.13, 0.17))                                                 # bahu
    elips(bm, (k * 0.13, 0.40, 0.50), (0.10, 0.15, 0.17))                                                  # paha atas
    elips(bm, (k * 0.115, -0.50, 0.80), (0.032, 0.020, 0.062))                                             # telinga
T.tambah('badan', bm, bulu, lebur=(0.009, 1000, 0.0, 4))
hw.tungkai(T, B, bulu, T.bahan('kuku', (0.10, 0.08, 0.07), kasar=0.6),
           depan=((-0.34, 0.38, 0.075, 0.09), (-0.345, 0.28, 0.050, 0.060), (-0.35, 0.20, 0.036, 0.040), (-0.345, 0.08, 0.028, 0.030), (-0.355, 0.045, 0.030, 0.032)),
           belakang=((0.40, 0.40, 0.085, 0.11), (0.44, 0.30, 0.055, 0.070), (0.46, 0.24, 0.038, 0.044), (0.43, 0.08, 0.028, 0.030), (0.42, 0.045, 0.030, 0.032)),
           kuku_r=(0.031, 0.040, 0.05), voxel=0.005, segitiga=120)
bm = bmesh.new()
tabung(bm, [((0, -0.52, 0.80), 0.012, 0.020), ((0, -0.36, 0.845), 0.022, 0.036), ((0, -0.16, 0.862), 0.024, 0.040), ((0, 0.10, 0.825), 0.018, 0.030), ((0, 0.30, 0.79), 0.008, 0.014)], u=X, w=Z, seg=6)
T.tambah('surai', bm, T.bahan('surai', (0.10, 0.075, 0.06), kasar=0.95))                                                                              # surai kasar di punggung
bm = bmesh.new()
tabung(bm, [((0, 0.58, 0.62), 0.016, 0.016), ((0, 0.64, 0.52), 0.010, 0.010), ((0, 0.66, 0.46), 0.016, 0.012)], seg=5)
T.tambah('ekor', bm, gelap, kaku='BeastTail')
bm = bmesh.new()
for k in (1, -1):
    elips(bm, kepala + moncong * 0.13 + X * (k * 0.125) + dahi * 0.08, (0.012, 0.016, 0.014), seg=6, ring=4)   # mata
tabung(bm, [(kepala + moncong * 0.515, 0.050, 0.050), (kepala + moncong * 0.535, 0.046, 0.046)], u=X, w=dahi, seg=8)   # cakram moncong
T.tambah('mata', bm, gelap, kaku='BeastHead')
bm = bmesh.new()
for k in (1, -1):
    t0 = kepala + moncong * 0.40 + X * (k * 0.062) - dahi * 0.02
    tabung(bm, [(t0, 0.014, 0.014), (t0 + Vector((k * 0.028, -0.03, 0.06)), 0.010, 0.010), (t0 + Vector((k * 0.040, -0.02, 0.115)), 0.002, 0.002)], seg=5)
T.tambah('taring', bm, T.bahan('gading', (0.90, 0.86, 0.74), kasar=0.5), kaku='BeastHead')

T.rakit()
T.gerakkan((('diam', 90, lambda P, p: hw.diam(P, p, B)), ('jalan', 12, lambda P, p: hw.jalan(P, p, B)), ('lari', 8, lambda P, p: hw.lari(P, p, B)),
            ('makan', 60, lambda P, p: hw.makan(P, p, B)), ('serang', 18, lambda P, p: hw.seruduk(P, p, B)), ('mati', 36, lambda P, p: hw.mati(P, p, B))),
           glb=opsi('--glb', T.keluar + '.glb'), tulang_lain=hw.sendi(B), peraga={'kaki': hw.kaki(B)}, manusia=False,
           lihat={'*': {'pusat': (0, -0.1, 0.42), 'jarak': 5.2, 'ukuran': (340, 280), 'arah': (1, -0.45, 0.28)}})
T.pratinjau(klip='diam', lebar=2.1)
T.ringkasan()
