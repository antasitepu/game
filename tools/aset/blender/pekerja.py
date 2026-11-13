# Pekerja buatan skrip, tanpa akun atau add-on: tubuh berpose A, tunik putih gading (diwarnai tim oleh game), sabuk kain,
# celana longgar, dan caping. Tubuh, bahan, pemanggangan atlas, kerangka, bobot, dan gerak berasal dari manusia.py.
# Hasil: satu GLB berkerangka (klip diam, jalan, lari, jalan_bawa, lari_bawa, kerja, lempar, mati) untuk `node tools/aset/olah.mjs pekerja`:
# <folder-keluaran>.glb (bawaan tools/aset/sumber/pekerja.glb) atau --glb. Di <folder-keluaran>: pekerja-atlas.png,
# pratinjau pekerja-{depan,samping,belakang,serong,atas}.png, pekerja-tim-{biru,merah}.png, dan lembar kontak
# pekerja-gerak-<klip>.png.
#
#   blender --background --factory-startup --python tools/aset/blender/pekerja.py -- <folder-keluaran> [--tekstur <folder>] [--glb <file>]
# --tekstur: folder tembolok tekstur Poly Haven (bawaan tools/aset/sumber, sama dengan olah.mjs); diunduh bila belum ada.
# Baris terakhir keluaran: PEKERJA {json ringkasan}.
import bmesh, os, sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manusia as mn

ARG = sys.argv[sys.argv.index('--') + 1:]
opsi = lambda n, bawaan=None: ARG[ARG.index(n) + 1] if n in ARG else bawaan
T = mn.Tokoh('pekerja', ARG[0], opsi('--tekstur'))
linen, goni = T.tekstur('rough_linen'), T.tekstur('hessian_230')

kulit = T.bahan('kulit', (0.66, 0.47, 0.34))
T.kepala(kulit, T.bahan('rambut', (0.07, 0.055, 0.05)), T.bahan('muka', (0.16, 0.09, 0.07)))
T.lengan(kulit)
T.kaki(kulit)
T.celana(T.kain('celana', goni, 3.0, (0.20, 0.15, 0.11), (0.45, 0.35, 0.26)))
T.tunik(T.kain('tunik', linen, 5.0, (0.72, 0.68, 0.60), (0.94, 0.92, 0.86)))                # putih gading: dikalikan warna tim di game
T.sabuk(T.kain('sabuk', linen, 5.0, (0.16, 0.12, 0.10), (0.34, 0.26, 0.20)))

# caping: kerucut jerami tipis; UV "asal": u = keliling (3× ulang), v = dari puncak ke tepi (jalur jerami menyebar dari puncak)
jerami = T.bahan('caping')
nt, b = jerami.node_tree, next(n for n in jerami.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
uvn, tx, hs = nt.nodes.new('ShaderNodeUVMap'), nt.nodes.new('ShaderNodeTexImage'), nt.nodes.new('ShaderNodeHueSaturation')
uvn.uv_map, tx.image = 'asal', T.tekstur('reed_roof_04')
hs.inputs['Saturation'].default_value, hs.inputs['Value'].default_value = 0.8, 1.25
for a, z in ((uvn.outputs['UV'], tx.inputs['Vector']), (tx.outputs['Color'], hs.inputs['Color']), (hs.outputs['Color'], b.inputs['Base Color'])):
    nt.links.new(a, z)
SEG, TEPI = 24, 0.25
profil = [(0.004, 1.772), (0.035, 1.757), (0.14, 1.690), (TEPI, 1.612), (TEPI - 0.007, 1.605), (0.13, 1.678), (0.004, 1.750)]
bm = bmesh.new()
mn.bubut(bm, profil, SEG, uv=lambda i, j: (3 * j / SEG, 0.86 - 0.8 * profil[i][0] / TEPI))
T.tambah('caping', bm, jerami, kaku='Head')

T.rakit()
T.pratinjau()
# bawah tunik meniru bobot celana di baliknya (celana tidak menembus keluar saat melangkah); sabuk meniru tunik
T.gerakkan((('diam', 90, mn.diam), ('jalan', 30, mn.jalan), ('lari', 20, mn.lari), ('jalan_bawa', 30, lambda P, p: mn.jalan(P, p, bawa=True)),
            ('lari_bawa', 20, lambda P, p: mn.lari(P, p, bawa=True)), ('kerja', 27, mn.kerja),
            ('lempar', 24, mn.lempar), ('mati', 36, mn.mati)),
           glb=opsi('--glb', T.keluar + '.glb'), tiru=[('tunik', 'celana', (0.90, 1.00)), ('sabuk', 'tunik', None)],
           lihat={'mati': {'pusat': (0, 0.4, 0.5), 'jarak': 5.2}})
T.pratinjau_tim()
T.ringkasan()
