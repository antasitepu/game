# Model uji berkerangka untuk alat aset (bukan aset game): sosok manusia sederhana dengan kerangka bergaya Mixamo
# (objek kerangka diputar 90° dan berskala 0,01, tulang dalam cm, nama "mixamorig:…"), tiga klip animasi, diekspor ke GLB.
# Juga menulis rujukan posisi vertex hasil evaluasi Blender (rujukan.json) dan gambar pratinjau, dipakai
# tools/aset/uji-kerangka.mjs untuk memastikan hasil olah.mjs + js/assets.js bergerak persis seperti di Blender.
#
#   blender --background --factory-startup --python tools/aset/blender/contoh.py -- <folder-keluaran>
import bpy, bmesh, json, math, os, sys
from mathutils import Matrix, Vector, Quaternion

KELUAR = os.path.abspath(sys.argv[sys.argv.index('--') + 1])
os.makedirs(KELUAR, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps = 30

# ---------------------------------------------------------------- kerangka (ruang lokal: X samping, Y atas, Z depan; cm)
TULANG = [
    ('Hips', None, (0, 100, 0), (0, 110, 0)),
    ('Spine', 'Hips', (0, 110, 0), (0, 125, 0)),
    ('Spine1', 'Spine', (0, 125, 0), (0, 140, 0)),
    ('Neck', 'Spine1', (0, 147, 0), (0, 154, 0)),
    ('Head', 'Neck', (0, 154, 0), (0, 175, 0)),
]
for s, k in (('Left', 1), ('Right', -1)):
    TULANG += [
        (s + 'Shoulder', 'Spine1', (k * 5, 143, 0), (k * 16, 145, 0)),
        (s + 'Arm', s + 'Shoulder', (k * 16, 145, 0), (k * 34, 127, 0)),
        (s + 'ForeArm', s + 'Arm', (k * 34, 127, 0), (k * 52, 109, 0)),
        (s + 'Hand', s + 'ForeArm', (k * 52, 109, 0), (k * 58, 103, 0)),
        (s + 'UpLeg', 'Hips', (k * 9, 97, 0), (k * 9, 52, 0)),
        (s + 'Leg', s + 'UpLeg', (k * 9, 52, 0), (k * 9, 8, 0)),
        (s + 'Foot', s + 'Leg', (k * 9, 8, 0), (k * 9, 2, 13)),
    ]
PRE = 'mixamorig:'

data_k = bpy.data.armatures.new('Armature')
arm = bpy.data.objects.new('Armature', data_k)
sc.collection.objects.link(arm)
arm.rotation_euler = (math.radians(90), 0, 0)
arm.scale = (0.01, 0.01, 0.01)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = {}
for nama, induk, h, t in TULANG:
    b = data_k.edit_bones.new(PRE + nama)
    b.head, b.tail = h, t
    if induk:
        b.parent = eb[induk]
    eb[nama] = b
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- tubuh (bmesh, ruang lokal kerangka)
bm = bmesh.new()
uvl = bm.loops.layers.uv.new('UVMap')


def tabung(a, b, ra, rb, ring, seg, v0, v1, elips=(1, 1)):
    a, b = Vector(a), Vector(b)
    sumbu = (b - a).normalized()
    atas = Vector((0, 0, 1)) if abs(sumbu.z) < 0.9 else Vector((1, 0, 0))
    u = sumbu.cross(atas).normalized()
    w = sumbu.cross(u).normalized()
    baris = []
    for i in range(ring + 1):
        f = i / ring
        c, r = a.lerp(b, f), ra + (rb - ra) * f
        baris.append([bm.verts.new(c + u * math.cos(2 * math.pi * j / seg) * r * elips[0] + w * math.sin(2 * math.pi * j / seg) * r * elips[1]) for j in range(seg)])
    for i in range(ring):
        for j in range(seg):
            f = bm.faces.new((baris[i][j], baris[i][(j + 1) % seg], baris[i + 1][(j + 1) % seg], baris[i + 1][j]))
            for lp, (ii, jj) in zip(f.loops, ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j))):
                lp[uvl].uv = (jj / seg, v0 + (v1 - v0) * ii / ring)
    for r in (baris[0], baris[-1]):
        f = bm.faces.new(r)
        for lp in f.loops:
            lp[uvl].uv = (0.5, v0)


tabung((0, 92, 0), (0, 150, 0), 13, 12, 10, 14, 0.0, 0.4, (1.15, 0.75))     # badan
tabung((0, 147, 0), (0, 156, 0), 5, 5, 2, 10, 0.4, 0.45)                    # leher
for k in (1, -1):
    tabung((k * 15, 145, 0), (k * 53, 108, 0), 5, 3.5, 12, 10, 0.45, 0.65)  # lengan
    tabung((k * 9, 96, 0), (k * 9, 6, 0), 7.5, 4.5, 14, 10, 0.65, 0.95)     # tungkai
    bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation((k * 9, 3, 5)) @ Matrix.Diagonal((8, 6, 18, 1)), calc_uvs=True)
    bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=3.5, matrix=Matrix.Translation((k * 56, 105, 0)), calc_uvs=True)
bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=10, matrix=Matrix.Translation((0, 164, 0)), calc_uvs=True)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
me = bpy.data.meshes.new('Tubuh')
bm.to_mesh(me)
bm.free()
ob = bpy.data.objects.new('Tubuh', me)
sc.collection.objects.link(ob)
ob.parent = arm

# bobot: kebalikan pangkat empat jarak ke ruas tulang, tiga tulang terdekat, dinormalkan
ruas = {PRE + n: (Vector(h), Vector(t)) for n, _, h, t in TULANG}
grup = {n: ob.vertex_groups.new(name=n) for n in ruas}


def jarak(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (a + ab * t - p).length


for v in me.vertices:
    dekat = sorted((jarak(v.co, a, b), n) for n, (a, b) in ruas.items())[:3]
    w = [1 / max(d, 0.5) ** 4 for d, _ in dekat]
    pilih = [(n, x) for (_, n), x in zip(dekat, w) if x / sum(w) > 0.02]
    jml = sum(x for _, x in pilih)
    for n, x in pilih:
        grup[n].add([v.index], x / jml, 'REPLACE')
ob.modifiers.new('Armature', 'ARMATURE').object = arm

# bahan bertekstur (kisi warna) supaya jalur tekstur ikut teruji
gbr = bpy.data.images.new('kisi', 128, 128)
gbr.generated_type = 'COLOR_GRID'
gbr.filepath_raw = os.path.join(KELUAR, 'kisi.png')
gbr.file_format = 'PNG'
gbr.save()
mat = bpy.data.materials.new('Kain')
if bpy.app.version < (5, 0, 0):                     # sejak Blender 5 bahan baru selalu bernode (Principled BSDF)
    mat.use_nodes = True
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
tex = nt.nodes.new('ShaderNodeTexImage')
tex.image = bpy.data.images.load(os.path.join(KELUAR, 'kisi.png'))
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
me.materials.append(mat)

# ---------------------------------------------------------------- animasi (rotasi di ruang lokal tulang)
pb = arm.pose.bones
for b in pb:
    b.rotation_mode = 'QUATERNION'
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))


def putar(nama, sumbu, sudut):
    pb[PRE + nama].rotation_quaternion = Quaternion(sumbu, sudut) @ pb[PRE + nama].rotation_quaternion


def diam(f):
    ph = 2 * math.pi * f / 48
    putar('Spine', X, 0.04 * math.sin(ph))
    putar('Head', Y, 0.15 * math.sin(ph))
    for s, k in (('Left', 1), ('Right', -1)):
        putar(s + 'Arm', Z, 0.06 * k * math.sin(ph))
    pb[PRE + 'Hips'].location = (0, 0.6 * math.sin(ph), 0)


def jalan(f):
    ph = 2 * math.pi * f / 30
    for s, k in (('Left', 1), ('Right', -1)):
        putar(s + 'UpLeg', X, 0.5 * k * math.sin(ph))
        putar(s + 'Leg', X, -0.7 * max(0.0, k * math.cos(ph)))
        putar(s + 'Arm', X, -0.4 * k * math.sin(ph))
        putar(s + 'ForeArm', X, -0.3)
    putar('Hips', Y, 0.12 * math.sin(ph))
    putar('Spine1', Y, -0.18 * math.sin(ph))
    pb[PRE + 'Hips'].location = (0, 2.0 * abs(math.cos(ph)), 0)


def serang(f):
    k = math.sin(math.pi * f / 20)
    putar('RightArm', X, -1.8 * k)
    putar('RightForeArm', X, -0.8 * k)
    putar('Spine', Y, 0.35 * k)
    putar('Spine1', X, 0.2 * k)


KLIP = [('diam', 48, diam), ('jalan', 30, jalan), ('serang', 20, serang)]
arm.animation_data_create()
aksi = {}
for nama, n, fn in KLIP:
    a = bpy.data.actions.new(nama)
    a.use_fake_user = True
    arm.animation_data.action = a
    for f in range(0, n + 1, 2):
        for b in pb:
            b.rotation_quaternion = (1, 0, 0, 0)
            b.location = (0, 0, 0)
        fn(f)
        for b in pb:
            b.keyframe_insert('rotation_quaternion', frame=f)
            b.keyframe_insert('location', frame=f)
    aksi[nama] = a

# ---------------------------------------------------------------- rujukan: posisi dunia Blender, dikonversi ke Y-atas glTF (x, z, −y)


def posisi():
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    m = ev.to_mesh()
    M = ob.matrix_world
    hasil = []
    for v in m.vertices:
        p = M @ v.co
        hasil += [round(p.x, 6), round(p.z, 6), round(-p.y, 6)]
    ev.to_mesh_clear()
    return hasil


ruj = {'klip': {}}
data_k.pose_position = 'REST'
bpy.context.view_layer.update()
ruj['istirahat'] = posisi()
data_k.pose_position = 'POSE'
for nama, n, _ in KLIP:
    arm.animation_data.action = aksi[nama]
    ruj['klip'][nama] = []
    for f in sorted({0, n // 4, n // 2, 3 * n // 4, n}):
        sc.frame_set(f)
        ruj['klip'][nama].append({'t': f / sc.render.fps, 'v': posisi()})
with open(os.path.join(KELUAR, 'rujukan.json'), 'w') as fh:
    json.dump(ruj, fh)

# pratinjau: pose tengah langkah
arm.animation_data.action = aksi['jalan']
sc.frame_set(8)
kam = bpy.data.objects.new('Kamera', bpy.data.cameras.new('Kamera'))
sc.collection.objects.link(kam)
kam.location = (2.6, -3.6, 1.7)
kam.rotation_euler = (Vector((0, 0, 0.9)) - kam.location).to_track_quat('-Z', 'Y').to_euler()
sc.camera = kam
sc.render.engine = 'BLENDER_WORKBENCH'
sc.render.resolution_x, sc.render.resolution_y = 320, 400
sc.render.filepath = os.path.join(KELUAR, 'pratinjau.png')
bpy.ops.render.render(write_still=True)

arm.animation_data.action = None
bpy.ops.export_scene.gltf(filepath=os.path.join(KELUAR, 'pekerja.glb'), export_format='GLB', export_animation_mode='ACTIONS', export_skins=True, export_yup=True)
print('CONTOH SELESAI', os.path.join(KELUAR, 'pekerja.glb'))
