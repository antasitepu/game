# Model pekerja buatan skrip, tanpa akun atau add-on: tubuh sederhana berpose A, tunik putih gading (diwarnai tim oleh game),
# sabuk kain, celana longgar, dan caping. Bahan memakai tekstur kain/jerami Poly Haven (CC0); warna dan bayangan lembut (AO)
# dipanggang ke satu atlas. Menghadap −Y Blender (depan Mixamo), kaki di z = 0, satuan meter.
# Keluaran di <folder-keluaran>:
#   pekerja-mixamo.fbx   tubuh + pakaian tanpa caping, untuk diunggah ke Mixamo (pilih kerangka "No Fingers")
#   pekerja-tempel.glb   caping; ditempel kaku ke tulang kepala oleh gabung.py (--tempel pekerja-tempel.glb:Head)
#   pekerja-lengkap.glb  semuanya (tanpa kerangka), untuk diperiksa
#   pekerja-atlas.png, pekerja-{depan,samping,belakang,serong,atas}.png, pekerja-tim-{biru,merah}.png (tunik dikali warna tim)
#
#   blender --background --factory-startup --python tools/aset/blender/pekerja.py -- <folder-keluaran> [--tekstur <folder>]
# --tekstur: folder tembolok tekstur Poly Haven (bawaan tools/aset/sumber, sama dengan olah.mjs); diunduh bila belum ada.
# Baris terakhir keluaran: PEKERJA {json ringkasan}.
import bpy, bmesh, json, math, os, sys, urllib.request
import numpy as np
from mathutils import Matrix, Vector

ARG = sys.argv[sys.argv.index('--') + 1:]
KELUAR = os.path.abspath(ARG[0])
TEKS = os.path.abspath(ARG[ARG.index('--tekstur') + 1]) if '--tekstur' in ARG else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sumber')
os.makedirs(KELUAR, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def tekstur(nama):
    f = os.path.join(TEKS, 'tex_' + nama, 'Diffuse.jpg')
    if not os.path.exists(f):
        ua = {'User-Agent': 'asset-pipeline/1.0'}
        with urllib.request.urlopen(urllib.request.Request('https://api.polyhaven.com/files/' + nama, headers=ua)) as r:
            url = json.load(r)['Diffuse']['1k']['jpg']['url']
        os.makedirs(os.path.dirname(f), exist_ok=True)
        with urllib.request.urlopen(urllib.request.Request(url, headers=ua)) as r, open(f, 'wb') as fh:
            fh.write(r.read())
    return bpy.data.images.load(f)


# ---------------------------------------------------------------- bahan (sebelum dipanggang)

def bahan(nama, warna=None):
    m = bpy.data.materials.new(nama)
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Roughness'].default_value = 0.85
    if warna:
        b.inputs['Base Color'].default_value = (lin(warna[0]), lin(warna[1]), lin(warna[2]), 1)
    return m, m.node_tree, b


def kain(nama, gbr, ulang, gelap, terang):
    """Tekstur tenun diproyeksikan kotak, dijadikan hitam-putih, lalu dipetakan ke dua warna (gelap → terang)."""
    m, nt, b = bahan(nama)
    px = np.empty(gbr.size[0] * gbr.size[1] * 4, np.float32)
    gbr.pixels.foreach_get(px)
    px = px.reshape(-1, 4)[::97, :3]
    px = np.where(px <= 0.04045, px / 12.92, ((px + 0.055) / 1.055) ** 2.4)
    terang_px = px @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    tc, mp, tx = nt.nodes.new('ShaderNodeTexCoord'), nt.nodes.new('ShaderNodeMapping'), nt.nodes.new('ShaderNodeTexImage')
    bw, rp = nt.nodes.new('ShaderNodeRGBToBW'), nt.nodes.new('ShaderNodeValToRGB')
    mp.inputs['Scale'].default_value = (ulang, ulang, ulang)
    tx.image, tx.projection, tx.projection_blend = gbr, 'BOX', 0.25
    e = rp.color_ramp.elements
    e[0].position, e[1].position = float(terang_px.mean() - 1.6 * terang_px.std()), float(terang_px.mean() + 1.6 * terang_px.std())
    e[0].color, e[1].color = (*[lin(c) for c in gelap], 1), (*[lin(c) for c in terang], 1)
    for a, z in ((tc.outputs['Object'], mp.inputs['Vector']), (mp.outputs['Vector'], tx.inputs['Vector']), (tx.outputs['Color'], bw.inputs['Color']),
                 (bw.outputs['Val'], rp.inputs['Fac']), (rp.outputs['Color'], b.inputs['Base Color'])):
        nt.links.new(a, z)
    return m


linen, goni = tekstur('rough_linen'), tekstur('hessian_230')
B_KULIT = bahan('kulit', (0.66, 0.47, 0.34))[0]
B_RAMBUT = bahan('rambut', (0.07, 0.055, 0.05))[0]
B_MUKA = bahan('muka', (0.16, 0.09, 0.07))[0]                                  # mata, alis, bibir
B_TUNIK = kain('tunik', linen, 5.0, (0.72, 0.68, 0.60), (0.94, 0.92, 0.86))    # putih gading: dikalikan warna tim di game
B_SABUK = kain('sabuk', linen, 5.0, (0.16, 0.12, 0.10), (0.34, 0.26, 0.20))
B_CELANA = kain('celana', goni, 3.0, (0.20, 0.15, 0.11), (0.45, 0.35, 0.26))
B_CAPING, nt, b = bahan('caping')
uvn, tx, hs = nt.nodes.new('ShaderNodeUVMap'), nt.nodes.new('ShaderNodeTexImage'), nt.nodes.new('ShaderNodeHueSaturation')
uvn.uv_map, tx.image = 'asal', tekstur('reed_roof_04')
hs.inputs['Saturation'].default_value, hs.inputs['Value'].default_value = 0.8, 1.25
for a, z in ((uvn.outputs['UV'], tx.inputs['Vector']), (tx.outputs['Color'], hs.inputs['Color']), (hs.outputs['Color'], b.inputs['Base Color'])):
    nt.links.new(a, z)

# ---------------------------------------------------------------- pembentuk


def tabung(bm, cincin, u=X, w=Y, seg=20, n=2.0):
    """Selubung tertutup lewat deretan cincin (pusat, jari searah u, jari searah w); n > 2 = penampang lebih kotak."""
    baris = []
    for c, ru, rw in cincin:
        c, r = Vector(c), []
        for j in range(seg):
            ca, sa = math.cos(2 * math.pi * j / seg), math.sin(2 * math.pi * j / seg)
            r.append(bm.verts.new(c + u * (ru * math.copysign(abs(ca) ** (2 / n), ca)) + w * (rw * math.copysign(abs(sa) ** (2 / n), sa))))
        baris.append(r)
    for i in range(len(baris) - 1):
        for j in range(seg):
            bm.faces.new((baris[i][j], baris[i][(j + 1) % seg], baris[i + 1][(j + 1) % seg], baris[i + 1][j]))
    bm.faces.new(baris[0])
    bm.faces.new(baris[-1])


def elips(bm, pusat, jari, sumbu=None, seg=16, ring=10):
    """Elipsoid; sumbu = (arah lokal X, Y, Z) bila tidak sejajar sumbu dunia."""
    R = Matrix(sumbu).transposed().to_4x4() if sumbu else Matrix.Identity(4)
    return bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=ring, radius=1, matrix=Matrix.Translation(pusat) @ R @ Matrix.Diagonal((*jari, 1)))['verts']


def objek(nama, bm, bhn):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(nama)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(bhn)
    ob = bpy.data.objects.new(nama, me)
    sc.collection.objects.link(ob)
    return ob


def terapkan(ob):
    bpy.context.view_layer.update()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    lama = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(lama)
    for p in me.polygons:
        p.use_smooth = True
    return sum(len(p.vertices) - 2 for p in me.polygons)


AWAN = bpy.data.textures.new('awan', 'CLOUDS')
AWAN.noise_scale = 0.11


def lebur(ob, voxel, segitiga, riak=0.0, halus=4):
    """Satukan selubung-selubung yang bertumpuk jadi satu permukaan mulus (voxel), beri riak kain, lalu sederhanakan."""
    m = ob.modifiers.new('Lebur', 'REMESH')
    m.mode, m.voxel_size, m.use_smooth_shade = 'VOXEL', voxel, True
    if riak:
        d = ob.modifiers.new('Riak', 'DISPLACE')
        d.texture, d.strength, d.texture_coords = AWAN, riak, 'GLOBAL'
    s = ob.modifiers.new('Halus', 'SMOOTH')
    s.factor, s.iterations = 0.5, halus
    n = terapkan(ob)
    if n > segitiga:
        d = ob.modifiers.new('Sederhana', 'DECIMATE')
        d.ratio, d.use_collapse_triangulate = segitiga / n, True
        terapkan(ob)
    return ob


# ---------------------------------------------------------------- tubuh (hanya bagian yang terlihat di luar pakaian)
bagian = []
K = Vector((0, -0.006, 1.567))                                  # pusat tempurung kepala


def rahang(verts):                                              # separuh bawah kepala menyempit ke dagu, belakangnya masuk ke leher
    for v in verts:
        t = (K.z - v.co.z) / 0.113
        if t > 0:
            v.co.x *= 1 - 0.30 * t ** 1.4
            if v.co.y > K.y:
                v.co.y = K.y + (v.co.y - K.y) * (1 - 0.35 * t ** 1.5)


bm = bmesh.new()
rahang(elips(bm, K, (0.076, 0.094, 0.113), seg=24, ring=16))
elips(bm, (0, -0.040, 1.492), (0.046, 0.050, 0.040))                                                   # rahang bawah & dagu
miring = math.radians(-18)
elips(bm, (0, -0.100, 1.548), (0.012, 0.017, 0.024), sumbu=(X, Vector((0, math.cos(miring), math.sin(miring))), Vector((0, -math.sin(miring), math.cos(miring)))))  # hidung
for k in (1, -1):
    elips(bm, (k * 0.077, 0.004, 1.558), (0.007, 0.016, 0.027))                                        # telinga
tabung(bm, [((0, 0.014, 1.37), 0.050, 0.052), ((0, 0.006, 1.47), 0.047, 0.050), ((0, -0.002, 1.53), 0.046, 0.050)], seg=14)   # leher
kepala = lebur(objek('kepala', bm, B_KULIT), 0.004, 620, halus=3)
bagian.append(kepala)
bpy.context.view_layer.update()


def wajah(x, z, masuk):                                         # titik di permukaan wajah (dari depan), digeser `masuk` ke dalam
    kena, lok, _, _ = kepala.ray_cast(Vector((x, -1, z)), Y)
    return lok + Y * masuk


bm = bmesh.new()
for k in (1, -1):
    elips(bm, wajah(k * 0.031, 1.578, 0.002), (0.0115, 0.006, 0.0062), seg=6, ring=4)                 # mata
    a = math.radians(k * 9)
    elips(bm, wajah(k * 0.032, 1.599, 0.001), (0.017, 0.005, 0.0036), sumbu=(Vector((math.cos(a), 0, -math.sin(a))), Y, Vector((math.sin(a), 0, math.cos(a)))), seg=6, ring=4)   # alis
elips(bm, wajah(0, 1.497, 0.001), (0.019, 0.005, 0.0034), seg=6, ring=4)                              # bibir
bagian.append(objek('muka', bm, B_MUKA))

bm = bmesh.new()
rahang(elips(bm, K + Vector((0, 0.005, 0.004)), (0.081, 0.099, 0.118), seg=16, ring=10))
for f in [f for f in bm.faces if not (lambda p: p.z > 0.062 + 0.5 * max(0, -p.y - 0.05) or (p.y > -0.012 and p.z > -0.082))(f.calc_center_median() - K)]:
    bm.faces.remove(f)                                          # garis rambut: ubun-ubun, sisi di belakang telinga, sampai tengkuk
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bagian.append(objek('rambut', bm, B_RAMBUT))

BAHU_Z, LENGAN = 1.33, {}
for k in (1, -1):
    S, d = Vector((k * 0.185, 0, BAHU_Z)), Vector((k, 0, -1)).normalized()                             # pose A: lengan turun 45°
    w = d.cross(Y) * k                                          # tegak lurus lengan, ke arah luar-atas
    LENGAN[k] = (S, d, w)
    bm = bmesh.new()
    tabung(bm, [(S + d * t, ry, rw) for t, ry, rw in ((0.10, 0.047, 0.044), (0.18, 0.045, 0.042), (0.25, 0.038, 0.036), (0.285, 0.037, 0.035), (0.34, 0.041, 0.037),
                                                    (0.44, 0.033, 0.028), (0.505, 0.027, 0.021), (0.53, 0.030, 0.019))], u=Y, w=w, seg=14)
    elips(bm, S + d * 0.592, (0.040, 0.0155, 0.086), sumbu=(Y, w, d), seg=14, ring=10)                 # telapak (jari menyatu)
    jempol = (d * 0.8 - Y * 0.6).normalized()
    elips(bm, S + d * 0.566 - Y * 0.043, (0.012, 0.011, 0.036), sumbu=(w.cross(jempol), w, jempol), seg=10, ring=8)
    bagian.append(lebur(objek('lengan' + 'LR'[k < 0], bm, B_KULIT), 0.004, 220, halus=3))

KAKI_X = 0.105
for k in (1, -1):
    x = k * KAKI_X
    bm = bmesh.new()
    tabung(bm, [((x, 0.004, 0.44), 0.050, 0.052), ((x, 0.010, 0.36), 0.052, 0.057), ((x, 0.006, 0.22), 0.040, 0.043), ((x, 0.004, 0.10), 0.031, 0.034),
                ((x, 0.0, 0.035), 0.034, 0.040)], seg=14)                                               # betis
    tabung(bm, [((x, 0.062, 0.031), 0.030, 0.028), ((x, 0.0, 0.041), 0.041, 0.040), ((x, -0.08, 0.029), 0.047, 0.027), ((x, -0.15, 0.018), 0.049, 0.016),
                ((x, -0.188, 0.012), 0.040, 0.010)], u=X, w=Z, seg=12)                                  # telapak kaki
    bagian.append(lebur(objek('kaki' + 'LR'[k < 0], bm, B_KULIT), 0.004, 240, halus=3))

# ---------------------------------------------------------------- pakaian
bm = bmesh.new()
tabung(bm, [((0, 0, 1.01), 0.158, 0.110), ((0, 0, 0.93), 0.176, 0.124), ((0, 0, 0.85), 0.186, 0.128), ((0, 0, 0.78), 0.176, 0.116)], n=2.4)
for k in (1, -1):
    x = k * KAKI_X
    tabung(bm, [((x, 0, 0.88), 0.090, 0.100), ((x, 0, 0.70), 0.093, 0.100), ((x, 0, 0.50), 0.085, 0.090), ((x, 0.004, 0.36), 0.082, 0.086), ((x, 0.004, 0.30), 0.088, 0.091)], seg=16)
bagian.append(lebur(objek('celana', bm, B_CELANA), 0.007, 540, riak=0.014))

PINGGANG = (1.03, 0.160, 0.113)
bm = bmesh.new()
tabung(bm, [((0, y, z), rx, ry) for z, rx, ry, y in ((0.80, 0.205, 0.145, 0), (0.87, 0.196, 0.138, 0), (0.94, 0.184, 0.130, 0), (*PINGGANG, 0), (1.13, 0.172, 0.120, -0.003),
                                                    (1.26, 0.190, 0.128, -0.006), (1.33, 0.200, 0.118, -0.004), (1.372, 0.180, 0.100, 0), (1.402, 0.110, 0.080, 0.004),
                                                    (1.42, 0.060, 0.062, 0.008))], seg=24, n=2.5)
for k in (1, -1):
    S, d, w = LENGAN[k]
    elips(bm, S, (0.064, 0.059, 0.064), sumbu=(Y, w, d))                                                # bahu membulat
    tabung(bm, [(S + d * t, ry, rw) for t, ry, rw in ((0.0, 0.063, 0.058), (0.08, 0.064, 0.060), (0.17, 0.061, 0.058), (0.225, 0.066, 0.063))], u=Y, w=w, seg=16)   # lengan baju
tunik = lebur(objek('tunik', bm, B_TUNIK), 0.007, 800, riak=0.010)
bagian.append(tunik)

bm = bmesh.new()
z, rx, ry = PINGGANG
tabung(bm, [((0, 0, z - 0.02), rx + 0.012, ry + 0.012), ((0, 0, z + 0.02), rx + 0.012, ry + 0.012)], seg=16, n=2.5)   # sabuk kain
elips(bm, (0.05, -ry - 0.014, z), (0.024, 0.014, 0.022), seg=6, ring=4)                                 # simpul
for dx, pj in ((0.035, 0.11), (0.066, 0.085)):                                                         # dua juntai
    tabung(bm, [((dx, -ry - 0.018, z - 0.01), 0.011, 0.006), ((dx + 0.004, -ry - 0.026, z - pj), 0.013, 0.006)], seg=6)
bagian.append(objek('sabuk', bm, B_SABUK))

# caping: kerucut jerami tipis; UV "asal": u = keliling (3× ulang), v = dari puncak ke tepi (jalur jerami menyebar dari puncak)
bm = bmesh.new()
uv = bm.loops.layers.uv.new('asal')
SEG, TEPI = 24, 0.25
profil = [(0.004, 1.772), (0.035, 1.757), (0.14, 1.690), (TEPI, 1.612), (TEPI - 0.007, 1.605), (0.13, 1.678), (0.004, 1.750)]
cincin = [[bm.verts.new((r * math.cos(2 * math.pi * j / SEG), r * math.sin(2 * math.pi * j / SEG), z)) for j in range(SEG)] for r, z in profil]
for i in range(len(profil) - 1):
    for j in range(SEG):
        f = bm.faces.new((cincin[i][j], cincin[i][(j + 1) % SEG], cincin[i + 1][(j + 1) % SEG], cincin[i + 1][j]))
        for lp, (ii, jj) in zip(f.loops, ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j))):
            lp[uv].uv = (3 * jj / SEG, 0.86 - 0.8 * profil[ii][0] / TEPI)
caping = objek('caping', bm, B_CAPING)
bagian.append(caping)

# ---------------------------------------------------------------- gabung, kaki ke z = 0, UV atlas
hitung = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bagian}
for o in bagian:
    if 'asal' not in o.data.uv_layers:
        o.data.uv_layers.new(name='asal')
for o in sc.objects:
    o.select_set(o in bagian)
bpy.context.view_layer.objects.active = kepala
bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
ob.name = 'Pekerja'
me = ob.data
dasar = min(v.co.z for v in me.vertices)
for v in me.vertices:
    v.co.z -= dasar
for p in me.polygons:
    p.use_smooth = True
atlas_uv = me.uv_layers.new(name='atlas')
me.uv_layers.active = atlas_uv
atlas_uv.active_render = True
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(72), island_margin=0.006)
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- panggang warna + AO ke atlas
UKURAN = 1024
g_warna = bpy.data.images.new('pekerja-atlas', UKURAN, UKURAN)
g_ao = bpy.data.images.new('pekerja-ao', UKURAN, UKURAN)
g_ao.colorspace_settings.name = 'Non-Color'
sasaran = []
for m in me.materials:
    n = m.node_tree.nodes.new('ShaderNodeTexImage')
    m.node_tree.nodes.active = n
    sasaran.append(n)
sc.world = bpy.data.worlds.new('Dunia')
sc.world.light_settings.distance = 0.6
sc.render.engine = 'CYCLES'
sc.cycles.device, sc.cycles.samples = 'CPU', 48
for gbr, jenis, opsi in ((g_warna, 'DIFFUSE', {'pass_filter': {'COLOR'}}), (g_ao, 'AO', {})):
    for n in sasaran:
        n.image = gbr
    bpy.ops.object.bake(type=jenis, margin=10, use_clear=True, **opsi)
px = np.empty(UKURAN * UKURAN * 4, np.float32)
ao = np.empty(UKURAN * UKURAN * 4, np.float32)
g_warna.pixels.foreach_get(px)
g_ao.pixels.foreach_get(ao)
px, ao = px.reshape(-1, 4), ao.reshape(-1, 4)
px[:, :3] *= 0.45 + 0.55 * ao[:, :1]                            # bayangan lembut: lipatan, ketiak, bawah caping
px[:, 3] = 1
g_warna.pixels.foreach_set(px.ravel())
g_warna.filepath_raw, g_warna.file_format = os.path.join(KELUAR, 'pekerja-atlas.png'), 'PNG'
g_warna.save()

# bahan akhir: satu atlas; tunik di bahan tersendiri ("kain_tim") supaya game bisa mengalikannya dengan warna tim
i_tunik, i_caping = me.materials.find('tunik'), me.materials.find('caping')
kelas = [(1 if p.material_index == i_tunik else 0, p.material_index == i_caping) for p in me.polygons]
akhir = []
for nama in ('tubuh', 'kain_tim'):
    m, nt, b = bahan(nama)
    tx = nt.nodes.new('ShaderNodeTexImage')
    tx.image = g_warna
    nt.links.new(tx.outputs['Color'], b.inputs['Base Color'])
    akhir.append(m)
me.materials.clear()
for m in akhir:
    me.materials.append(m)
for p, (i, _) in zip(me.polygons, kelas):
    p.material_index = i
me.uv_layers.remove(me.uv_layers['asal'])

# caping dipisah jadi objek sendiri (ditempel ke tulang kepala setelah Mixamo)
topi = ob.copy()
topi.data = me.copy()
topi.name = 'Caping'
sc.collection.objects.link(topi)
for target, simpan in ((ob, False), (topi, True)):
    bm = bmesh.new()
    bm.from_mesh(target.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if kelas[f.index][1] != simpan], context='FACES')
    bm.to_mesh(target.data)
    bm.free()

# ---------------------------------------------------------------- ekspor & pratinjau


def pilih(*obj):
    for o in sc.objects:
        o.select_set(o in obj)
    bpy.context.view_layer.objects.active = obj[0]


berkas = lambda n: os.path.join(KELUAR, n)
# kotak pembatas tubuh di koordinat asal: gabung.py memakainya untuk menyejajarkan caping dengan model keluaran Mixamo
topi['kotak_tubuh'] = [f(v.co[i] for v in ob.data.vertices) for f in (min, max) for i in range(3)]
pilih(ob)
bpy.ops.export_scene.fbx(filepath=berkas('pekerja-mixamo.fbx'), use_selection=True, object_types={'MESH'}, path_mode='COPY', embed_textures=True)
pilih(topi)
bpy.ops.export_scene.gltf(filepath=berkas('pekerja-tempel.glb'), export_format='GLB', use_selection=True, export_yup=True, export_extras=True)
pilih(ob, topi)
bpy.ops.export_scene.gltf(filepath=berkas('pekerja-lengkap.glb'), export_format='GLB', use_selection=True, export_yup=True)

sc.render.engine = 'BLENDER_EEVEE'
sc.view_settings.view_transform = 'Standard'
sc.world.use_nodes = True
latar = next(n for n in sc.world.node_tree.nodes if n.type == 'BACKGROUND')
latar.inputs['Color'].default_value, latar.inputs['Strength'].default_value = (0.82, 0.84, 0.86, 1), 0.9
surya = bpy.data.objects.new('Surya', bpy.data.lights.new('Surya', 'SUN'))
surya.data.energy, surya.data.angle = 2.6, math.radians(8)
surya.rotation_euler = (math.radians(52), 0, math.radians(-28))
sc.collection.objects.link(surya)
kam = bpy.data.objects.new('Kamera', bpy.data.cameras.new('Kamera'))
sc.collection.objects.link(kam)
sc.camera = kam
tinggi = max(v.co.z for v in topi.data.vertices)
tengah = Vector((0, 0, tinggi / 2))
sc.render.resolution_x, sc.render.resolution_y = 520, 640
for nama, arah, orto in (('depan', (0, -1, 0), 1), ('samping', (1, 0, 0), 1), ('belakang', (0, 1, 0), 1), ('serong', (0.62, -1, 0.42), 0), ('atas', (0.25, -1, 1.05), 0)):
    arah = Vector(arah).normalized()
    kam.data.type = 'ORTHO' if orto else 'PERSP'
    kam.data.ortho_scale = tinggi * 1.12
    kam.data.lens = 70
    kam.location = tengah + arah * (8 if orto else 5.2)
    kam.rotation_euler = (-arah).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = berkas('pekerja-' + nama + '.png')
    bpy.ops.render.render(write_still=True)

# warna tim: tunik (bahan kain_tim) dikalikan warna tim, seperti yang nanti dilakukan game
nt = akhir[1].node_tree
kali, b = nt.nodes.new('ShaderNodeMix'), next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
kali.data_type, kali.blend_type = 'RGBA', 'MULTIPLY'
kali.inputs[0].default_value = 1
nt.links.new(next(n for n in nt.nodes if n.type == 'TEX_IMAGE').outputs['Color'], kali.inputs[6])
nt.links.new(kali.outputs[2], b.inputs['Base Color'])
for nama, hexa in (('biru', '3b82f6'), ('merah', 'ef4444')):
    kali.inputs[7].default_value = (*[lin(int(hexa[i:i + 2], 16) / 255) for i in (0, 2, 4)], 1)
    sc.render.filepath = berkas('pekerja-tim-' + nama + '.png')
    bpy.ops.render.render(write_still=True)

print('PEKERJA ' + json.dumps({'tinggi_m': round(tinggi, 3), 'segitiga': hitung, 'total': sum(hitung.values()), 'folder': KELUAR}))
