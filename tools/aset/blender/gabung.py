# Gabungkan unduhan Mixamo menjadi satu GLB berkerangka untuk tools/aset/olah.mjs.
#   <folder>/*.fbx: tepat satu file berisi mesh ("With Skin") = model; animasinya (bila lebih dari pose tunggal) ikut jadi klip.
#   FBX lain ("Without Skin") = klip; nama klip = nama file (mis. diam.fbx, jalan.fbx, kerja.fbx, serang.fbx, mati.fbx).
# Gerak tiap klip dipindahkan ke kerangka model lewat posisi dunia tiap tulang (Copy Transforms lalu bake), jadi tetap benar
# walau pose istirahat kerangka di file animasi berbeda dari kerangka model; nama tulang dicocokkan tanpa awalan
# ("mixamorig:", "mixamorig1:", …). Tulang jari dilebur ke tangan (tak terlihat dari jarak kamera game, menghemat hitungan
# animasi per unit) kecuali --simpan-jari, dan gerak maju akar (root motion) dibuang supaya klip berjalan di tempat:
# posisi unit diatur simulasi.
# --tempel <file.glb>:<Tulang> (boleh berulang): mesh kaku yang tidak ikut diunggah ke Mixamo (mis. caping) ditempel 100% ke
# satu tulang dan disatukan dengan mesh model. Bila GLB itu membawa properti "kotak_tubuh" (kotak pembatas tubuh di
# koordinat asalnya, lihat pekerja.py), posisinya disejajarkan dengan model keluaran Mixamo yang mungkin digeser/diskalakan.
#
#   blender --background --factory-startup --python tools/aset/blender/gabung.py -- <folder-mixamo> <keluar.glb>
#           [--simpan-jari] [--tempel <file.glb>:<Tulang>]
# Baris terakhir keluaran: GABUNG {json ringkasan}.
import bpy, json, os, re, sys
from mathutils import Matrix, Vector

ARG = sys.argv[sys.argv.index('--') + 1:]
FOLDER, KELUAR = os.path.abspath(ARG[0]), os.path.abspath(ARG[1])
SIMPAN_JARI = '--simpan-jari' in ARG[2:]
TEMPEL = [ARG[i + 1] for i, a in enumerate(ARG) if a == '--tempel']
JARI = re.compile(r'Hand(Thumb|Index|Middle|Ring|Pinky)\d', re.I)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps = 30                                         # laju bawaan Mixamo


def jalur_f(aksi):
    """Semua (wadah, fcurve) milik aksi; Blender 4.4+ menyimpannya per slot (channelbag)."""
    if bpy.app.version < (4, 4, 0):
        return [(aksi.fcurves, fc) for fc in aksi.fcurves]
    return [(cb.fcurves, fc) for ly in aksi.layers for st in ly.strips for cb in st.channelbags for fc in cb.fcurves]


def pasang(arm, aksi):
    arm.animation_data.action = aksi
    if bpy.app.version >= (4, 4, 0) and arm.animation_data.action_slot is None and len(aksi.slots):
        arm.animation_data.action_slot = aksi.slots[0]


def impor(f):
    obj0, aksi0 = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=os.path.join(FOLDER, f), ignore_leaf_bones=True)
    return [o for o in bpy.data.objects if o not in obj0], [a for a in bpy.data.actions if a not in aksi0]


berkas = sorted(f for f in os.listdir(FOLDER) if f.lower().endswith('.fbx'))
if not berkas:
    raise SystemExit('tidak ada file .fbx di ' + FOLDER)
nama_klip = lambda f: re.sub(r'[^a-z0-9_-]+', '_', os.path.splitext(f)[0].lower()).strip('_')
arm, klip, sumber, catatan = None, [], [], []
for f in berkas:
    obj, aksi = impor(f)
    pakai = [a for a in aksi if a.frame_range[1] - a.frame_range[0] >= 2]
    if any(o.type == 'MESH' for o in obj):
        if arm:
            raise SystemExit('lebih dari satu FBX berisi mesh ("With Skin"); sisakan satu saja: ' + f)
        arm = next(o for o in obj if o.type == 'ARMATURE')
        for a in aksi:
            if a in pakai[:1]:                                  # animasi ikut di file model: sudah cocok dengan kerangkanya
                for wadah, fc in jalur_f(a):
                    if not fc.data_path.startswith('pose.bones'):
                        wadah.remove(fc)
                a.name = nama_klip(f)
                a.use_fake_user = True
                klip.append(a)
            else:
                bpy.data.actions.remove(a)
        continue
    kr = next((o for o in obj if o.type == 'ARMATURE'), None)
    if not kr or not pakai:
        catatan.append(f + ': tidak berisi animasi kerangka, dilewati')
        continue
    sumber.append((nama_klip(f), kr, pakai[0]))
if not arm:
    raise SystemExit('tidak ada FBX berisi mesh ("With Skin") di ' + FOLDER)
model = [o for o in bpy.data.objects if o.type == 'MESH' and o.parent == arm]
inti = lambda n: n.split(':')[-1]
BONE = re.compile(r'pose\.bones\["([^"]+)"\]')

# Tempelan kaku: verteksnya dipindah ke ruang mesh model (pose ikat), diikat penuh ke satu tulang, lalu digabung ke mesh model.
tempelan = []
if TEMPEL:
    badan = model[0]
    titik = [o.matrix_world @ v.co for o in model for v in o.data.vertices]
    kb = [f(p[i] for p in titik) for f in (min, max) for i in range(3)]
    for spek in TEMPEL:
        f, _, nama_tulang = spek.rpartition(':')
        tulang = next((b.name for b in arm.data.bones if inti(b.name).lower() == nama_tulang.lower()), None)
        if not f or not tulang:
            raise SystemExit('--tempel ' + spek + ': tulis <file.glb>:<Tulang>; tulang "' + nama_tulang + '" tidak ada di kerangka model')
        obj0 = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.abspath(f))
        baru = [o for o in bpy.data.objects if o not in obj0]
        ka = next((list(o['kotak_tubuh']) for o in baru if 'kotak_tubuh' in o.keys()), None)
        M, skala = Matrix.Identity(4), 1.0
        if ka:                                                  # koordinat asal → koordinat model sekarang: skala dari tinggi, geser dari tengah alas
            skala = (kb[5] - kb[2]) / (ka[5] - ka[2])
            M = Matrix.Translation(((kb[0] + kb[3]) / 2, (kb[1] + kb[4]) / 2, kb[2])) @ Matrix.Scale(skala, 4) @ Matrix.Translation((-(ka[0] + ka[3]) / 2, -(ka[1] + ka[4]) / 2, -ka[2]))
        jumlah, sisa = 0, [o for o in baru if o.type != 'MESH']
        for o in [o for o in baru if o.type == 'MESH']:
            dunia = M @ o.matrix_world
            o.parent = None
            o.data.transform(badan.matrix_world.inverted() @ dunia)
            o.matrix_world = badan.matrix_world
            o.vertex_groups.new(name=tulang).add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
            if o.data.uv_layers and badan.data.uv_layers:
                o.data.uv_layers[0].name = badan.data.uv_layers.active.name
            for slot in o.material_slots:                       # bahan senama dengan bahan model (mis. "tubuh") dipakai bersama
                sama = next((m for m in badan.data.materials if m and slot.material and inti(m.name).split('.')[0] == slot.material.name.split('.')[0]), None)
                if sama:
                    slot.material = sama
            jumlah += len(o.data.vertices)
            for x in sc.objects:
                x.select_set(x in (o, badan))
            bpy.context.view_layer.objects.active = badan
            bpy.ops.object.join()
        for o in sisa:
            bpy.data.objects.remove(o, do_unlink=True)
        tempelan.append({'file': os.path.basename(f), 'tulang': tulang, 'verteks': jumlah, 'skala': round(skala, 4), 'disejajarkan': bool(ka)})

# Jari dilebur ke tulang tangan: bobotnya ditambahkan ke tangan, lalu tulang & jalur animasinya dibuang.
jari = [] if SIMPAN_JARI else [b.name for b in arm.data.bones if JARI.search(b.name)]
if jari:
    def tangan(b):
        while b and JARI.search(b.name):
            b = b.parent
        return b.name
    tujuan = {n: tangan(arm.data.bones[n]) for n in jari}
    for ob in model:
        for n in jari:
            vg = ob.vertex_groups.get(n)
            if not vg:
                continue
            tg = ob.vertex_groups.get(tujuan[n]) or ob.vertex_groups.new(name=tujuan[n])
            for v in ob.data.vertices:
                for g in v.groups:
                    if g.group == vg.index:
                        tg.add([v.index], g.weight, 'ADD')
            ob.vertex_groups.remove(vg)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for n in jari:
        arm.data.edit_bones.remove(arm.data.edit_bones[n])
    bpy.ops.object.mode_set(mode='OBJECT')
    for a in klip:
        for wadah, fc in jalur_f(a):
            m = BONE.match(fc.data_path)
            if m and m.group(1) in jari:
                wadah.remove(fc)

# Pindahkan tiap klip: tulang model mengikuti posisi dunia tulang senama di kerangka animasi, lalu di-bake per frame.
arm.animation_data_create()
for b in arm.pose.bones:
    b.rotation_mode = 'QUATERNION'
for nama, kr, aksi in sumber:
    peta = {inti(b.name): b.name for b in kr.data.bones}
    hilang = [b.name for b in arm.pose.bones if inti(b.name) not in peta]
    if hilang:
        catatan.append(nama + ': ' + str(len(hilang)) + ' tulang model tidak ada di file animasi (diam di pose istirahat)')
    for b in arm.pose.bones:
        if inti(b.name) in peta:
            c = b.constraints.new('COPY_TRANSFORMS')
            c.target, c.subtarget = kr, peta[inti(b.name)]
    arm.animation_data.action = None
    for o in sc.objects:
        o.select_set(o == arm)
    bpy.context.view_layer.objects.active = arm
    f0, f1 = int(round(aksi.frame_range[0])), int(round(aksi.frame_range[1]))
    bpy.ops.nla.bake(frame_start=f0, frame_end=f1, step=1, only_selected=False, visual_keying=True, clear_constraints=True,
                     use_current_action=False, bake_types={'POSE'})
    baru = arm.animation_data.action
    baru.name, baru.use_fake_user = nama, True
    klip.append(baru)
    data = kr.data
    bpy.data.objects.remove(kr, do_unlink=True)
    if data.users == 0:
        bpy.data.armatures.remove(data)
    bpy.data.actions.remove(aksi)
if not klip:
    raise SystemExit('tidak ada klip animasi')

# Buang gerak maju akar: selisih mendatar posisi akar antara awal & akhir klip dikurangkan secara linear.
akar = next(b for b in arm.data.bones if b.parent is None and b.children)
atas = (arm.matrix_world.inverted().to_3x3() @ Vector((0, 0, 1))).normalized()
ringkas = {}
for a in klip:
    pasang(arm, a)
    f0, f1 = int(round(a.frame_range[0])), int(round(a.frame_range[1]))
    sc.frame_set(f0)
    h0 = arm.pose.bones[akar.name].head.copy()
    sc.frame_set(f1)
    d = arm.pose.bones[akar.name].head - h0
    d -= atas * d.dot(atas)
    geser = d.length * arm.matrix_world.to_scale()[0]
    lok = [fc for _, fc in jalur_f(a) if fc.data_path == 'pose.bones["%s"].location' % akar.name]
    if geser > 1e-4 and lok:
        Minv = akar.matrix_local.to_3x3().inverted()
        for fc in lok:
            for kp in fc.keyframe_points:
                kurang = (Minv @ (d * ((kp.co.x - f0) / max(1, f1 - f0))))[fc.array_index]
                kp.co.y -= kurang
                kp.handle_left.y -= kurang
                kp.handle_right.y -= kurang
            fc.update()
    ringkas[a.name] = {'frame': f1 - f0, 'geser_akar_m': round(geser, 4)}

arm.animation_data.action = None
for b in arm.pose.bones:
    b.location, b.rotation_quaternion, b.rotation_euler, b.scale = (0, 0, 0), (1, 0, 0, 0), (0, 0, 0), (1, 1, 1)
for o in sc.objects:
    o.select_set(o == arm or o in model)
bpy.context.view_layer.objects.active = arm
os.makedirs(os.path.dirname(KELUAR), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=KELUAR, export_format='GLB', use_selection=True, export_animation_mode='ACTIONS', export_skins=True, export_yup=True)
print('GABUNG ' + json.dumps({'glb': KELUAR, 'tulang': len(arm.data.bones), 'jari_dilebur': len(jari), 'mesh': [o.name for o in model], 'klip': ringkas, 'tempel': tempelan, 'catatan': catatan}))
