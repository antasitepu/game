# Pustaka bangunan rakitan buatan skrip (percontohan; dipakai pasar.py):
#   Rakitan   mengumpulkan bagian-bagian bangunan, memberi UV berskala dunia dan rona per-vertex, memanggang bayangan
#             lembut (AO) ke warna per-vertex, merender pratinjau, dan mengekspor GLB untuk `olah.mjs` (resep "rakitan").
# Bangunan TIDAK membawa tekstur sendiri: tiap bagian memakai satu kunci bahan pustaka bangunan game (BF.tex.mat di
# js/tex.js: planks, stone, clay, thatch, slate, plaster, flat), jadi teksturnya sama tajam dengan bangunan rakitan kode.
# Bagian bertanda tim memakai bahan "<kunci>_tim" dan dikalikan warna tim oleh game.
# Satuan = tile. Koordinat tapak seperti di js/models.js: x ke kanan, z ke depan (kamera memandang dari +x/+z), y ke atas,
# sudut belakang-kiri tapak = (0, 0); R.P(x, z, y) mengubahnya ke koordinat Blender (titik asal di tengah tapak, depan = −Y).
import bpy, bmesh, json, math, os, random
import numpy as np
from mathutils import Vector
from manusia import X, Y, Z, rad, lin, tabung, elips, bubut

TEKSTUR = {'planks': 'bg_papan', 'stone': 'bg_batu', 'clay': 'bg_tanahliat', 'thatch': 'bg_jerami', 'slate': 'bg_genteng', 'plaster': 'bg_plester'}
PENGALI = {'stone': (1.25, 1.2, 1.1), 'slate': (0.66, 0.635, 0.60), 'plaster': (0.95, 0.90, 0.80)}       # warna bahan di js/tex.js
# rona yang sering dipakai (nilai mentah seperti di js/models.js; dikalikan dengan tekstur bahannya)
KAYU, KAYU_TUA, KAYU_MUDA, BESI, LINEN, PUTIH = (0.58, 0.47, 0.37), (0.42, 0.33, 0.25), (0.85, 0.74, 0.59), (0.18, 0.17, 0.16), (0.94, 0.90, 0.82), (0.96, 0.96, 0.96)


def kotak(bm, a, b):
    """Kotak sejajar sumbu antara dua sudut berseberangan (koordinat Blender)."""
    (x0, x1), (y0, y1), (z0, z1) = (sorted((a[i], b[i])) for i in range(3))
    v = [bm.verts.new((x, y, z)) for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
    for f in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (1, 3, 7, 5), (3, 2, 6, 7), (2, 0, 4, 6)):
        bm.faces.new([v[i] for i in f])


def balok(bm, a, b, lebar, tebal, atas=Z):
    """Balok dari a ke b; lebar = ukuran menyamping, tebal = ukuran searah `atas`."""
    a, b = Vector(a), Vector(b)
    s = (b - a).normalized()
    sisi = s.cross(atas)
    sisi = sisi.normalized() if sisi.length > 1e-4 else X.copy()
    up = sisi.cross(s).normalized()
    v = [bm.verts.new(p + sisi * (dx * lebar / 2) + up * (dy * tebal / 2)) for p in (a, b) for dy in (-1, 1) for dx in (-1, 1)]
    for f in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (1, 3, 7, 5), (3, 2, 6, 7), (2, 0, 4, 6)):
        bm.faces.new([v[i] for i in f])


def kisi(bm, titik, nu, nv):
    """Permukaan kisi (nu × nv petak) dari fungsi titik(u, v) dengan u, v ∈ 0..1."""
    g = [[bm.verts.new(titik(i / nu, j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
    return [bm.faces.new((g[i][j], g[i + 1][j], g[i + 1][j + 1], g[i][j + 1])) for i in range(nu) for j in range(nv)]


def lembaran(bm, titik, nu, nv, tebal, dinding=True):
    """Lembaran setebal `tebal` di bawah permukaan titik(u, v): sisi atas dan sisi bawah berverteks sendiri (bayangan
    lembut sisi bawah tidak merembes ke atas); dinding=True menutup tepi kelilingnya (atap), False membiarkannya (kain)."""
    atas = [[bm.verts.new(titik(i / nu, j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
    bawah = [[bm.verts.new(v.co - Z * tebal) for v in baris] for baris in atas]
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((atas[i][j], atas[i + 1][j], atas[i + 1][j + 1], atas[i][j + 1]))
            bm.faces.new((bawah[i][j + 1], bawah[i + 1][j + 1], bawah[i + 1][j], bawah[i][j]))
    if dinding:
        tepi = [(i, 0) for i in range(nu)] + [(nu, j) for j in range(nv)] + [(i, nv) for i in range(nu, 0, -1)] + [(0, j) for j in range(nv, 0, -1)]
        for (i0, j0), (i1, j1) in zip(tepi, tepi[1:] + tepi[:1]):
            a, b = bm.verts.new(atas[i0][j0].co), bm.verts.new(atas[i1][j1].co)
            c, d = bm.verts.new(bawah[i1][j1].co), bm.verts.new(bawah[i0][j0].co)
            bm.faces.new((a, b, c, d))


class Rakitan:
    def __init__(self, nama, keluar, tapak, aset=None):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.sc, self.nama, self.keluar, self.tapak = bpy.context.scene, nama, os.path.abspath(keluar), tapak
        self.aset = os.path.abspath(aset) if aset else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'assets')
        os.makedirs(self.keluar, exist_ok=True)
        self.bagian, self.bahan, self.acak, self.info = [], {}, random.Random(7), {}

    berkas = lambda self, n: os.path.join(self.keluar, self.nama + '-' + n)

    def P(self, x, z, y=0.0):
        """Koordinat tapak → koordinat Blender."""
        return Vector((x - self.tapak / 2, self.tapak / 2 - z, y))

    def goyang(self, besar):
        return self.acak.uniform(-besar, besar)

    def _bahan(self, kunci):
        """Bahan pratinjau: tekstur bahan game (bila ada) × warna per-vertex × pengali (warna bahan, atau warna tim)."""
        if kunci in self.bahan:
            return self.bahan[kunci]
        m = bpy.data.materials.new(kunci)
        nt, dasar = m.node_tree, kunci.replace('_tim', '')
        b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        b.inputs['Roughness'].default_value = 0.88
        warna = nt.nodes.new('ShaderNodeVertexColor')
        warna.layer_name = 'Col'
        hasil = warna.outputs['Color']

        def kali(a, nilai=None, sumber=None):
            n = nt.nodes.new('ShaderNodeMix')
            n.data_type, n.blend_type = 'RGBA', 'MULTIPLY'
            n.inputs[0].default_value = 1
            nt.links.new(a, n.inputs[6])
            if sumber is not None:
                nt.links.new(sumber, n.inputs[7])
            else:
                n.inputs[7].default_value = (*nilai, 1)
            return n

        if dasar in TEKSTUR:
            tx = nt.nodes.new('ShaderNodeTexImage')
            tx.image = bpy.data.images.load(os.path.join(self.aset, 't', TEKSTUR[dasar] + '.jpg'), check_existing=True)
            hasil = kali(hasil, sumber=tx.outputs['Color']).outputs[2]
        akhir = kali(hasil, nilai=PENGALI.get(dasar, (1, 1, 1)))
        akhir.name = 'pengali'
        nt.links.new(akhir.outputs[2], b.inputs['Base Color'])
        self.bahan[kunci] = m
        return m

    def tambah(self, nama, bm, kunci, rona=PUTIH, serat=None, halus=False, bagi=None, tim=False):
        """Daftarkan satu bagian. kunci: bahan pustaka bangunan game; rona: pengali warna (nilai mentah seperti di kode game);
        serat: arah serat/alur tekstur (bawaan: mendatar, tekstur tegak ke atas); halus: normal dihaluskan;
        bagi: belah rusuk yang lebih panjang dari ini supaya bayangan lembut per-vertex cukup rapat; tim: diwarnai tim."""
        if bagi:
            for _ in range(6):
                panjang = [e for e in bm.edges if e.calc_length() > bagi]
                if not panjang:
                    break
                bmesh.ops.subdivide_edges(bm, edges=panjang, cuts=1, use_grid_fill=True)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        me = bpy.data.meshes.new(nama)
        bm.to_mesh(me)
        bm.free()
        me.materials.append(self._bahan(kunci + ('_tim' if tim else '')))
        for p in me.polygons:
            p.use_smooth = halus
        me.color_attributes.new('rona', 'FLOAT_COLOR', 'CORNER').data.foreach_set('color', np.tile(np.array([*rona, 1.0], np.float32), len(me.loops)))
        uv, g0 = me.uv_layers.new(name='UVMap'), Vector(serat).normalized() if serat else None
        for p in me.polygons:                               # UV = jarak dunia: u searah serat (atau mendatar), v tegak lurus di bidang muka
            n, g = p.normal, None
            if g0 is not None:
                g = g0 - n * g0.dot(n)
                g = g.normalized() if g.length > 0.2 else None
            if g is None:
                g = Z.cross(n)
                g = g.normalized() if g.length > 0.05 else X.copy()
            v = n.cross(g)
            for li in p.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                uv.data[li].uv = (co.dot(g), co.dot(v))
        ob = bpy.data.objects.new(nama, me)
        self.sc.collection.objects.link(ob)
        self.bagian.append(ob)
        return ob

    def rakit(self, gelap=0.42):
        """Gabungkan semua bagian dan panggang bayangan lembut (AO, dengan tanah sebagai penghalang) ke warna per-vertex:
        warna akhir = rona × (gelap + (1 − gelap) × AO). AO dipanggang per verteks (bukan per sudut muka) supaya halus."""
        sc = self.sc
        self.info['bagian'] = len(self.bagian)
        for o in sc.objects:
            o.select_set(o in self.bagian)
        bpy.context.view_layer.objects.active = self.bagian[0]
        bpy.ops.object.join()
        ob = self.ob = bpy.context.view_layer.objects.active
        ob.name = self.nama.capitalize()
        me = ob.data
        tanah_me = bpy.data.meshes.new('tanah')
        bm = bmesh.new()
        kotak(bm, (-10, -10, -0.2), (10, 10, 0))
        bm.to_mesh(tanah_me)
        bm.free()
        tanah = bpy.data.objects.new('tanah', tanah_me)
        sc.collection.objects.link(tanah)
        ao = me.color_attributes.new('ao', 'FLOAT_COLOR', 'POINT')
        me.color_attributes.active_color = ao
        sc.world = bpy.data.worlds.new('Dunia')
        sc.world.light_settings.distance = 0.8
        sc.render.engine = 'CYCLES'
        sc.cycles.device, sc.cycles.samples = 'CPU', 64
        for o in sc.objects:
            o.select_set(o == ob)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
        n = len(me.loops)
        a, r, lv = np.empty(len(me.vertices) * 4, np.float32), np.empty(n * 4, np.float32), np.empty(n, np.int32)
        ao.data.foreach_get('color', a)
        me.color_attributes['rona'].data.foreach_get('color', r)
        me.loops.foreach_get('vertex_index', lv)
        a, r = a.reshape(-1, 4)[lv], r.reshape(-1, 4)
        r[:, :3] = np.clip(r[:, :3] * (gelap + (1 - gelap) * a[:, :1]), 0, 1)
        r[:, 3] = 1
        col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        col.data.foreach_set('color', r.ravel())
        me.color_attributes.remove(me.color_attributes['ao'])
        me.color_attributes.remove(me.color_attributes['rona'])
        me.color_attributes.active_color = me.color_attributes['Col']
        me.color_attributes.render_color_index = me.color_attributes.find('Col')
        bpy.data.objects.remove(tanah, do_unlink=True)
        ko = [v.co for v in me.vertices]
        self.tinggi = max(p.z for p in ko)
        self.info.update({'segitiga': sum(len(p.vertices) - 2 for p in me.polygons), 'tinggi': round(self.tinggi, 3), 'bahan': [m.name for m in me.materials],
                          'kotak': [round(f(p[i] for p in ko), 3) for f in (min, max) for i in range(3)]})

    def ekspor(self, glb):
        for o in self.sc.objects:
            o.select_set(o == self.ob)
        bpy.context.view_layer.objects.active = self.ob
        os.makedirs(os.path.dirname(os.path.abspath(glb)), exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=os.path.abspath(glb), export_format='GLB', use_selection=True, export_yup=True, export_vertex_color='ACTIVE',
                                  export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True)
        self.info['glb'] = os.path.abspath(glb)

    def pratinjau(self, tim=(('biru', '3b82f6'), ('merah', 'ef4444'))):
        """Gambar pratinjau: 'kamera' (sudut pandang seperti kamera game), depan, samping, atas, lalu warna tim."""
        sc = self.sc
        sc.render.engine = 'BLENDER_EEVEE'
        sc.view_settings.view_transform = 'Standard'
        if bpy.app.version < (5, 0, 0):
            sc.world.use_nodes = True
        latar = next(n for n in sc.world.node_tree.nodes if n.type == 'BACKGROUND')
        latar.inputs['Color'].default_value, latar.inputs['Strength'].default_value = (0.82, 0.84, 0.86, 1), 0.9
        surya = bpy.data.objects.new('Surya', bpy.data.lights.new('Surya', 'SUN'))
        surya.data.energy, surya.data.angle = 2.6, rad(8)
        surya.rotation_euler = (rad(50), 0, rad(40))
        sc.collection.objects.link(surya)
        tanah_me = bpy.data.meshes.new('alas')
        bm = bmesh.new()
        kotak(bm, (-12, -12, -0.05), (12, 12, 0))
        bm.to_mesh(tanah_me)
        bm.free()
        alas = bpy.data.objects.new('alas', tanah_me)
        alas_b = bpy.data.materials.new('alas')
        next(n for n in alas_b.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'].default_value = (0.30, 0.36, 0.17, 1)
        tanah_me.materials.append(alas_b)
        sc.collection.objects.link(alas)
        kam = bpy.data.objects.new('Kamera', bpy.data.cameras.new('Kamera'))
        sc.collection.objects.link(kam)
        sc.camera = kam
        kam.data.type = 'ORTHO'
        sc.render.resolution_x, sc.render.resolution_y = 900, 700
        tengah = Vector((0, 0, self.tinggi * 0.4))

        def jepret(nama, arah, skala):
            arah = Vector(arah).normalized()
            kam.data.ortho_scale = skala
            kam.location = tengah + arah * 14
            kam.rotation_euler = (-arah).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = self.berkas(nama + '.png')
            bpy.ops.render.render(write_still=True)

        s = self.tapak * 1.55
        for nama, arah in (('kamera', (1, -1, 1.15)), ('depan', (0, -1, 0.25)), ('samping', (1, 0, 0.25)), ('belakang', (-1, 1, 1.15)), ('atas', (0.02, -0.05, 1))):
            jepret(nama, arah, s)
        pengali = [m.node_tree.nodes['pengali'] for k, m in self.bahan.items() if k.endswith('_tim')]
        for nama, hexa in tim:
            for n in pengali:
                n.inputs[7].default_value = (*[int(hexa[i:i + 2], 16) / 255 for i in (0, 2, 4)], 1)
            jepret('tim-' + nama, (1, -1, 1.15), s)

    def ringkasan(self):
        print(self.nama.upper() + ' ' + json.dumps({**self.info, 'folder': self.keluar}))
