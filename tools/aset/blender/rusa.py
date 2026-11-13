# Rusa (hewan liar) buatan skrip: badan cokelat dengan perut pucat, ekor putih pendek, dan dengan --jantan sepasang
# tanduk bercabang (model `rusa_jantan`; kerangka dan klipnya sama). Kerangka 19 tulang berawalan Beast dan geraknya
# dari hewan.py; pemanggangan atlas dan ekspor dari manusia.py. Tanpa bahan tim.
# Hasil: satu GLB berkerangka (klip diam, jalan, lari, makan, mati) untuk `node tools/aset/olah.mjs rusa` (atau
# rusa_jantan): <folder-keluaran>.glb atau --glb, serta pratinjau PNG di <folder-keluaran>.
# Laju rancangan pada model: jalan 0,9 m per putaran (0,7 detik), lari 2,64 m per putaran (0,4 detik).
#
#   blender --background --factory-startup --python tools/aset/blender/rusa.py -- <folder-keluaran> [--jantan] [--tekstur <folder>] [--glb <file>]
# Baris terakhir keluaran: RUSA {json ringkasan} (atau RUSA_JANTAN).
import bmesh, os, sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manusia as mn
import hewan as hw
from manusia import X, Y, Z, Vector, tabung, elips

ARG = sys.argv[sys.argv.index('--') + 1:]
opsi = lambda n, bawaan=None: ARG[ARG.index(n) + 1] if n in ARG else bawaan
JANTAN = '--jantan' in ARG
B = {'pre': 'Beast', 'u': 0.68,
     'tulang': {'Root': ((0, 0.02, 0.93), (0, 0.02, 1.03)), 'Spine': ((0, 0.02, 0.95), (0, -0.08, 0.95)), 'Chest': ((0, -0.08, 0.95), (0, -0.40, 0.98)),
                'Hip': ((0, 0.10, 0.95), (0, 0.50, 0.98)), 'Neck': ((0, -0.38, 1.02), (0, -0.64, 1.40)), 'Head': ((0, -0.64, 1.40), (0, -0.90, 1.26)),
                'Tail': ((0, 0.58, 1.00), (0, 0.64, 0.84))},
     'x_depan': 0.085, 'x_belakang': 0.095,
     'depan': ((-0.33, 0.74), (-0.345, 0.42), (-0.335, 0.10), (-0.375, 0.015)), 'belakang': ((0.40, 0.76), (0.50, 0.48), (0.455, 0.10), (0.415, 0.015)),
     'jalan': (0.60, 0.27, 0.09, 0.07), 'lari': (0.25, 0.33, 0.22, 0.19), 'rebah': 0.19, 'makan': (112, -40, 5, 0.20), 'ekor_lari': 70}

T = mn.Tokoh('rusa_jantan' if JANTAN else 'rusa', ARG[0], opsi('--tekstur'))
goni = T.tekstur('hessian_230')
bulu = T.kain('bulu', goni, 3.0, (0.36, 0.25, 0.16), (0.56, 0.41, 0.27), kasar=0.9, perut=(0.76, 0.90, (0.80, 0.74, 0.62)))   # perut pucat
bulu_kaki = T.kain('bulu_kaki', goni, 3.0, (0.32, 0.22, 0.14), (0.50, 0.37, 0.25), kasar=0.9)
pucat = T.bahan('pucat', (0.91, 0.88, 0.81), kasar=0.9)
gelap = T.bahan('gelap', (0.08, 0.06, 0.05), kasar=0.5)

pangkal, leher, tegak = Vector((0, -0.36, 1.00)), Vector((0, -0.26, 0.38)).normalized(), Vector((0, 0.38, 0.26)).normalized()
ubun = pangkal + leher * 0.46
turun, muka = Vector((0, -0.88, -0.47)).normalized(), Vector((0, -0.47, 0.88)).normalized()
bm = bmesh.new()
tabung(bm, [((0, y, z), rx, rz) for y, z, rx, rz in ((-0.52, 0.96, 0.07, 0.11), (-0.42, 0.94, 0.14, 0.20), (-0.25, 0.92, 0.17, 0.23), (0.0, 0.93, 0.18, 0.21),
                                                    (0.25, 0.95, 0.18, 0.20), (0.44, 0.97, 0.16, 0.19), (0.56, 0.96, 0.07, 0.09))], u=X, w=Z, seg=16)
tabung(bm, [(pangkal + leher * d, rx, rt) for d, rx, rt in ((0.0, 0.095, 0.15), (0.16, 0.070, 0.10), (0.32, 0.055, 0.075), (0.46, 0.050, 0.065))], u=X, w=tegak, seg=12)
tabung(bm, [(ubun + turun * d, rx, rt) for d, rx, rt in ((-0.03, 0.055, 0.065), (0.08, 0.062, 0.075), (0.20, 0.042, 0.050), (0.285, 0.030, 0.034))], u=X, w=muka, seg=12)
for k in (1, -1):
    elips(bm, (k * 0.10, -0.33, 0.86), (0.07, 0.12, 0.17))                                                 # bahu
    elips(bm, (k * 0.11, 0.40, 0.88), (0.085, 0.15, 0.19))                                                 # paha atas
    elips(bm, ubun + Vector((k * 0.072, 0.03, 0.075)), (0.024, 0.012, 0.062))                              # telinga
T.tambah('badan', bm, bulu, lebur=(0.008, 1000, 0.0, 4))
hw.tungkai(T, B, bulu_kaki, T.bahan('kuku', (0.11, 0.09, 0.08), kasar=0.6),
           depan=((-0.33, 0.74, 0.050, 0.065), (-0.34, 0.58, 0.036, 0.045), (-0.345, 0.43, 0.028, 0.030), (-0.342, 0.39, 0.025, 0.026), (-0.336, 0.14, 0.019, 0.021),
                  (-0.338, 0.10, 0.025, 0.027), (-0.355, 0.055, 0.023, 0.025)),
           belakang=((0.40, 0.76, 0.060, 0.095), (0.45, 0.62, 0.042, 0.058), (0.498, 0.50, 0.030, 0.036), (0.498, 0.45, 0.025, 0.028), (0.46, 0.14, 0.019, 0.021),
                     (0.455, 0.10, 0.025, 0.027), (0.435, 0.055, 0.023, 0.025)),
           kuku_r=(0.025, 0.033, 0.06), voxel=0.004, segitiga=150)
bm = bmesh.new()
tabung(bm, [((0, 0.565, 1.00), 0.036, 0.028), ((0, 0.615, 0.90), 0.030, 0.020), ((0, 0.635, 0.84), 0.012, 0.010)], seg=8)
T.tambah('ekor', bm, pucat, kaku='BeastTail')
bm = bmesh.new()
for k in (1, -1):
    elips(bm, ubun + turun * 0.085 + X * (k * 0.055) + muka * 0.02, (0.010, 0.015, 0.014), seg=6, ring=4)   # mata
elips(bm, ubun + turun * 0.28, (0.024, 0.018, 0.020), seg=8, ring=4)                                       # hidung
T.tambah('mata', bm, gelap, kaku='BeastHead')
if JANTAN:
    bm = bmesh.new()
    for k in (1, -1):
        p0 = ubun + Vector((k * 0.035, 0.01, 0.06))
        p1 = p0 + Vector((k * 0.09, 0.10, 0.20))
        p2 = p1 + Vector((k * 0.07, -0.02, 0.22))
        tabung(bm, [(p0, 0.014, 0.014), (p1, 0.011, 0.011), (p2, 0.004, 0.004)], seg=6)                    # batang tanduk
        for pangkal_c, arah in ((p0.lerp(p1, 0.35), Vector((k * 0.02, -0.14, 0.08))), (p1, Vector((k * 0.03, -0.13, 0.12)))):
            tabung(bm, [(pangkal_c, 0.009, 0.009), (pangkal_c + arah, 0.003, 0.003)], u=X, w=Z, seg=5)     # cabang ke depan
    T.tambah('tanduk', bm, T.bahan('tanduk', (0.78, 0.70, 0.55), kasar=0.7), kaku='BeastHead')

T.rakit()
T.gerakkan((('diam', 90, lambda P, p: hw.diam(P, p, B)), ('jalan', 21, lambda P, p: hw.jalan(P, p, B)), ('lari', 12, lambda P, p: hw.lari(P, p, B)),
            ('makan', 60, lambda P, p: hw.makan(P, p, B)), ('mati', 36, lambda P, p: hw.mati(P, p, B))),
           glb=opsi('--glb', T.keluar + '.glb'), tulang_lain=hw.sendi(B), peraga={'kaki': hw.kaki(B)}, manusia=False,
           lihat={'*': {'pusat': (0, -0.1, 0.80), 'jarak': 7.0, 'ukuran': (340, 320), 'arah': (1, -0.45, 0.25)}})
T.pratinjau(klip='diam', lebar=1.8)
T.ringkasan()
