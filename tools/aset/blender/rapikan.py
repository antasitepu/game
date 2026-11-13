# Rapikan model mentah (mis. hasil generator AI) sebelum diunggah ke Mixamo: semua mesh digabung, kerangka & objek lain
# dibuang, disederhanakan ke ±N segitiga, ditegakkan (kaki di z = 0, tinggi manusia, menghadap −Y Blender = depan
# Mixamo), lalu diekspor ke FBX bertekstur tertanam plus gambar pratinjau depan & samping untuk diperiksa.
#
#   blender --background --factory-startup --python tools/aset/blender/rapikan.py -- <masuk.glb|.gltf|.fbx|.obj> <keluar.fbx>
#           [--segitiga 3000] [--tinggi 1.75] [--putar 0]
# --putar: putar sekian derajat di sumbu tegak bila pratinjau "depan" ternyata memperlihatkan sisi lain model.
# Baris terakhir keluaran: RAPIKAN {json ringkasan}.
import bpy, bmesh, json, math, os, sys
from mathutils import Vector

ARG = sys.argv[sys.argv.index('--') + 1:]
MASUK, KELUAR = os.path.abspath(ARG[0]), os.path.abspath(ARG[1])
OPSI = {'segitiga': 3000, 'tinggi': 1.75, 'putar': 0.0}
for i in range(2, len(ARG) - 1, 2):
    k = ARG[i].lstrip('-')
    if k not in OPSI:
        raise SystemExit('opsi tidak dikenal: ' + ARG[i])
    OPSI[k] = type(OPSI[k])(ARG[i + 1])
peringatan = []

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
ext = os.path.splitext(MASUK)[1].lower()
if ext in ('.glb', '.gltf'):
    bpy.ops.import_scene.gltf(filepath=MASUK)
elif ext == '.fbx':
    bpy.ops.import_scene.fbx(filepath=MASUK)
elif ext == '.obj':
    bpy.ops.wm.obj_import(filepath=MASUK)
else:
    raise SystemExit('format tidak didukung: ' + ext)

# hanya mesh yang dipertahankan, dalam pose diamnya (kerangka bawaan generator diganti rig Mixamo)
mesh = [o for o in sc.objects if o.type == 'MESH']
if not mesh:
    raise SystemExit('tidak ada mesh di ' + MASUK)
for o in mesh:
    for m in [m for m in o.modifiers if m.type == 'ARMATURE']:
        o.modifiers.remove(m)
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
    o.vertex_groups.clear()
    if o.data.shape_keys:
        o.shape_key_clear()
for o in [o for o in sc.objects if o.type != 'MESH']:
    bpy.data.objects.remove(o, do_unlink=True)
if any(o.type == 'ARMATURE' for o in mesh):
    peringatan.append('kerangka bawaan dibuang')

for o in sc.objects:
    o.select_set(o in mesh)
bpy.context.view_layer.objects.active = mesh[0]
if len(mesh) > 1:
    bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
ob.name = os.path.splitext(os.path.basename(KELUAR))[0]
if OPSI['putar']:
    ob.rotation_euler.z += math.radians(OPSI['putar'])
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

me = ob.data
segitiga = lambda: sum(len(p.vertices) - 2 for p in me.polygons)
awal = segitiga()
ukuran = max(ob.dimensions)
bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=ukuran * 1e-5)
bm.to_mesh(me)
bm.free()
if me.has_custom_normals:
    with bpy.context.temp_override(object=ob, active_object=ob):
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
if segitiga() > OPSI['segitiga']:
    dec = ob.modifiers.new('Sederhana', 'DECIMATE')
    dec.ratio = OPSI['segitiga'] / segitiga()
    dec.use_collapse_triangulate = True
    with bpy.context.temp_override(object=ob, active_object=ob):
        bpy.ops.object.modifier_apply(modifier=dec.name)
for p in me.polygons:
    p.use_smooth = True

# tegakkan: tinggi = OPSI tinggi, kaki di z = 0, tengah alas di x = y = 0
ko = [ob.matrix_world @ v.co for v in me.vertices]
mn = Vector((min(p.x for p in ko), min(p.y for p in ko), min(p.z for p in ko)))
mx = Vector((max(p.x for p in ko), max(p.y for p in ko), max(p.z for p in ko)))
s = OPSI['tinggi'] / (mx.z - mn.z)
for v in me.vertices:
    v.co = Vector(((v.co.x - (mn.x + mx.x) / 2) * s, (v.co.y - (mn.y + mx.y) / 2) * s, (v.co.z - mn.z) * s))
me.update()
bpy.context.view_layer.update()
dim = [round(max(v.co[i] for v in me.vertices) - min(v.co[i] for v in me.vertices), 4) for i in range(3)]
if dim[1] > 0.6 * dim[2]:
    peringatan.append('model lebih tebal dari wajar (rebah?), periksa pratinjau')

# tekstur dikemas supaya ikut tertanam di FBX
gambar = {n.image for m in me.materials if m and m.node_tree for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image}
for g in gambar:
    if not g.packed_file:
        g.pack()
if not gambar:
    peringatan.append('tidak ada tekstur warna')

os.makedirs(os.path.dirname(KELUAR), exist_ok=True)
bpy.ops.export_scene.fbx(filepath=KELUAR, use_selection=False, object_types={'MESH'}, path_mode='COPY', embed_textures=True)

# pratinjau ortografis depan (dari −Y) dan samping (dari +X), bertekstur
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x, sc.render.resolution_y = 360, 480
kam = bpy.data.objects.new('Kamera', bpy.data.cameras.new('Kamera'))
sc.collection.objects.link(kam)
sc.camera = kam
kam.data.type = 'ORTHO'
kam.data.ortho_scale = max(dim[0], dim[2]) * 1.15
h = OPSI['tinggi'] / 2
dasar = os.path.splitext(KELUAR)[0]
for nama, lokasi, rot in (('depan', (0, -10, h), (math.pi / 2, 0, 0)), ('samping', (10, 0, h), (math.pi / 2, 0, math.pi / 2))):
    kam.location, kam.rotation_euler = lokasi, rot
    sc.render.filepath = dasar + '-' + nama + '.png'
    bpy.ops.render.render(write_still=True)

print('RAPIKAN ' + json.dumps({'segitiga_awal': awal, 'segitiga': segitiga(), 'ukuran': dim, 'tekstur': len(gambar), 'peringatan': peringatan,
                               'fbx': KELUAR, 'pratinjau': [dasar + '-depan.png', dasar + '-samping.png']}))
