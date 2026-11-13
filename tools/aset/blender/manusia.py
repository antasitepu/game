# Pustaka unit manusia buatan skrip (dipakai pekerja.py, tombak.py, dan unit manusia berikutnya):
#   Tokoh   membangun tubuh, pakaian, dan perlengkapan; memanggang warna + bayangan lembut (AO) + kekasaran/logam ke atlas;
#           memasang kerangka & bobot; merekam klip gerak; mengekspor GLB berkerangka untuk tools/aset/olah.mjs.
#   Peraga  pemeraga gerak (FK + IK kaki/lengan), dan fungsi klip: diam, jalan, kerja, lempar, mati, siaga, tusuk, …
# Semua koordinat: meter, Z ke atas, depan = −Y, kiri tokoh = +X; kerangka tanpa skala/rotasi objek.
# Sudut rotasi tulang ditulis terhadap sumbu kerangka pada pose istirahat, relatif ke induknya:
#   X positif = mengayun ke belakang / menunduk ke depan untuk batang tubuh, Z positif = sisi kiri ke belakang.
import bpy, bmesh, json, math, os, urllib.request
import numpy as np
from mathutils import Matrix, Quaternion, Vector, kdtree

X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
rad = math.radians
SISI = (('Left', 1), ('Right', -1))
halus = lambda t: t * t * (3 - 2 * t) if 0 < t < 1 else (0.0 if t <= 0 else 1.0)      # smoothstep
naik = lambda p, a, b: halus((p - a) / (b - a))                                          # 0 → 1 antara a dan b
lerp = lambda a, b, t: a + (b - a) * t
lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
SKALA_GAME = 0.86 / 1.771                                   # tile per meter: pekerja bercaping (1,771 m) = 0,86 tile


# ---------------------------------------------------------------- bentuk dasar

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


def bubut(bm, profil, seg, pusat=(0, 0, 0), sumbu=(X, Y, Z), uv=None):
    """Benda putar: profil [(jari, tinggi)] diputar mengelilingi sumbu[2] lewat `pusat`. uv(i_profil, j) → (u, v) untuk UV 'asal'."""
    pusat, lapis = Vector(pusat), bm.loops.layers.uv.get('asal') or (bm.loops.layers.uv.new('asal') if uv else None)
    cincin = [[bm.verts.new(pusat + sumbu[0] * (r * math.cos(2 * math.pi * j / seg)) + sumbu[1] * (r * math.sin(2 * math.pi * j / seg)) + sumbu[2] * t)
               for j in range(seg)] for r, t in profil]
    for i in range(len(profil) - 1):
        for j in range(seg):
            f = bm.faces.new((cincin[i][j], cincin[i][(j + 1) % seg], cincin[i + 1][(j + 1) % seg], cincin[i + 1][j]))
            if uv:
                for lp, (ii, jj) in zip(f.loops, ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j))):
                    lp[lapis].uv = uv(ii, jj)


# ---------------------------------------------------------------- tokoh

class Tokoh:
    BAHU_Z, KAKI_X = 1.33, 0.105
    K = Vector((0, -0.006, 1.567))                          # pusat tempurung kepala
    PINGGANG = (1.03, 0.160, 0.113)                         # tinggi, setengah lebar, setengah tebal

    def __init__(self, nama, keluar, teks=None):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.sc, self.nama, self.keluar = bpy.context.scene, nama, os.path.abspath(keluar)
        self.teks = os.path.abspath(teks) if teks else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sumber')
        os.makedirs(self.keluar, exist_ok=True)
        self.bagian, self.catatan, self.info = [], [], {}
        self.awan = bpy.data.textures.new('awan', 'CLOUDS')
        self.awan.noise_scale = 0.11
        self.LENGAN = {}
        for k in (1, -1):                                   # pose A: lengan turun 45°
            S, d = Vector((k * 0.185, 0, self.BAHU_Z)), Vector((k, 0, -1)).normalized()
            self.LENGAN[k] = (S, d, d.cross(Y) * k)         # bahu, arah lengan, tegak lurus lengan ke arah luar-atas

    berkas = lambda self, n: os.path.join(self.keluar, self.nama + '-' + n)

    def genggam(self, k):
        """Titik tengah telapak tangan pada pose istirahat (tempat alat/senjata digenggam)."""
        S, d, _ = self.LENGAN[k]
        return S + d * 0.59

    # ---- bahan (sebelum dipanggang)
    def tekstur(self, nama):
        f = os.path.join(self.teks, 'tex_' + nama, 'Diffuse.jpg')
        if not os.path.exists(f):                           # tekstur Poly Haven (CC0), tembolok sama dengan olah.mjs
            ua = {'User-Agent': 'asset-pipeline/1.0'}
            with urllib.request.urlopen(urllib.request.Request('https://api.polyhaven.com/files/' + nama, headers=ua)) as r:
                url = json.load(r)['Diffuse']['1k']['jpg']['url']
            os.makedirs(os.path.dirname(f), exist_ok=True)
            with urllib.request.urlopen(urllib.request.Request(url, headers=ua)) as r, open(f, 'wb') as fh:
                fh.write(r.read())
        return bpy.data.images.load(f)

    def bahan(self, nama, warna=None, kasar=0.85, logam=0.0):
        m = bpy.data.materials.new(nama)
        b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        b.inputs['Roughness'].default_value, b.inputs['Metallic'].default_value = kasar, logam
        if warna:
            b.inputs['Base Color'].default_value = (lin(warna[0]), lin(warna[1]), lin(warna[2]), 1)
        m['logam'] = logam
        return m

    def kain(self, nama, gbr, ulang, gelap, terang, jahitan=0.0):
        """Tekstur tenun diproyeksikan kotak, dijadikan hitam-putih, lalu dipetakan ke dua warna (gelap → terang).
        jahitan > 0: garis jahitan tegak tiap `jahitan` meter (baju berlapis kapas)."""
        m = self.bahan(nama)
        nt, b = m.node_tree, next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
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
                     (bw.outputs['Val'], rp.inputs['Fac'])):
            nt.links.new(a, z)
        warna = rp.outputs['Color']
        if jahitan:                                         # pita gelombang pada (x − y): garis tegak di depan, belakang, dan sisi
            mp2, gel, rp2, kali = nt.nodes.new('ShaderNodeMapping'), nt.nodes.new('ShaderNodeTexWave'), nt.nodes.new('ShaderNodeValToRGB'), nt.nodes.new('ShaderNodeMix')
            mp2.inputs['Rotation'].default_value = (0, 0, rad(45))
            gel.wave_type, gel.bands_direction = 'BANDS', 'X'
            gel.inputs['Scale'].default_value = 1 / (jahitan * math.pi)
            e2 = rp2.color_ramp.elements
            e2[0].position, e2[1].position, e2[0].color, e2[1].color = 0.0, 0.07, (0.62, 0.62, 0.62, 1), (1, 1, 1, 1)
            kali.data_type, kali.blend_type = 'RGBA', 'MULTIPLY'
            kali.inputs[0].default_value = 1
            for a, z in ((tc.outputs['Object'], mp2.inputs['Vector']), (mp2.outputs['Vector'], gel.inputs['Vector']), (gel.outputs['Fac'], rp2.inputs['Fac']),
                         (warna, kali.inputs[6]), (rp2.outputs['Color'], kali.inputs[7])):
                nt.links.new(a, z)
            warna = kali.outputs[2]
        nt.links.new(warna, b.inputs['Base Color'])
        return m

    # ---- bagian
    def terapkan(self, ob):
        bpy.context.view_layer.update()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        lama = ob.data
        ob.modifiers.clear()
        ob.data = me
        bpy.data.meshes.remove(lama)
        for p in me.polygons:
            p.use_smooth = True
        return sum(len(p.vertices) - 2 for p in me.polygons)

    def tambah(self, nama, bm, bhn, lebur=None, tim=False, kaku=None, rata=False):
        """Daftarkan satu bagian. lebur = (voxel, segitiga[, riak[, halus]]): selubung-selubung yang bertumpuk disatukan jadi
        satu permukaan mulus, diberi riak kain, lalu disederhanakan. tim: diwarnai tim oleh game. kaku: nama tulang
        tempat bagian ini menempel penuh (perlengkapan). rata: tanpa penghalusan normal (benda bersudut)."""
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        me = bpy.data.meshes.new(nama)
        bm.to_mesh(me)
        bm.free()
        me.materials.append(bhn)
        ob = bpy.data.objects.new(nama, me)
        self.sc.collection.objects.link(ob)
        if lebur:
            voxel, segitiga, riak, hal = list(lebur) + [0.0, 4][len(lebur) - 2:]
            m = ob.modifiers.new('Lebur', 'REMESH')
            m.mode, m.voxel_size, m.use_smooth_shade = 'VOXEL', voxel, True
            if riak:
                d = ob.modifiers.new('Riak', 'DISPLACE')
                d.texture, d.strength, d.texture_coords = self.awan, riak, 'GLOBAL'
            s = ob.modifiers.new('Halus', 'SMOOTH')
            s.factor, s.iterations = 0.5, hal
            n = self.terapkan(ob)
            if n > segitiga:
                d = ob.modifiers.new('Sederhana', 'DECIMATE')
                d.ratio, d.use_collapse_triangulate = segitiga / n, True
                self.terapkan(ob)
        self.bagian.append({'nama': nama, 'ob': ob, 'tim': tim, 'kaku': kaku, 'rata': rata})
        return ob

    def _rahang(self, verts):                               # separuh bawah kepala menyempit ke dagu, belakangnya masuk ke leher
        K = self.K
        for v in verts:
            t = (K.z - v.co.z) / 0.113
            if t > 0:
                v.co.x *= 1 - 0.30 * t ** 1.4
                if v.co.y > K.y:
                    v.co.y = K.y + (v.co.y - K.y) * (1 - 0.35 * t ** 1.5)

    def kepala(self, kulit, rambut, muka, rambut_penuh=True):
        """Kepala + leher, wajah (mata, alis, bibir), dan rambut (penuh, atau hanya sisi & tengkuk untuk yang berhelm)."""
        K = self.K
        bm = bmesh.new()
        self._rahang(elips(bm, K, (0.076, 0.094, 0.113), seg=24, ring=16))
        elips(bm, (0, -0.040, 1.492), (0.046, 0.050, 0.040))                                               # rahang bawah & dagu
        m = rad(-18)
        elips(bm, (0, -0.100, 1.548), (0.012, 0.017, 0.024), sumbu=(X, Vector((0, math.cos(m), math.sin(m))), Vector((0, -math.sin(m), math.cos(m)))))   # hidung
        for k in (1, -1):
            elips(bm, (k * 0.077, 0.004, 1.558), (0.007, 0.016, 0.027))                                    # telinga
        tabung(bm, [((0, 0.014, 1.37), 0.050, 0.052), ((0, 0.006, 1.47), 0.047, 0.050), ((0, -0.002, 1.53), 0.046, 0.050)], seg=14)   # leher
        kepala = self.tambah('kepala', bm, kulit, lebur=(0.004, 620, 0.0, 3))
        bpy.context.view_layer.update()
        wajah = lambda x, z, masuk: kepala.ray_cast(Vector((x, -1, z)), Y)[1] + Y * masuk                  # titik di permukaan wajah
        bm = bmesh.new()
        for k in (1, -1):
            elips(bm, wajah(k * 0.031, 1.578, 0.002), (0.0115, 0.006, 0.0062), seg=6, ring=4)             # mata
            a = rad(k * 9)
            elips(bm, wajah(k * 0.032, 1.599, 0.001), (0.017, 0.005, 0.0036), sumbu=(Vector((math.cos(a), 0, -math.sin(a))), Y, Vector((math.sin(a), 0, math.cos(a)))), seg=6, ring=4)
        elips(bm, wajah(0, 1.497, 0.001), (0.019, 0.005, 0.0034), seg=6, ring=4)                          # bibir
        self.tambah('muka', bm, muka, kaku='Head')
        bm = bmesh.new()
        self._rahang(elips(bm, K + Vector((0, 0.005, 0.004)), (0.081, 0.099, 0.118), seg=16, ring=10))
        garis = (lambda p: p.z > 0.062 + 0.5 * max(0, -p.y - 0.05) or (p.y > -0.012 and p.z > -0.082)) if rambut_penuh else (lambda p: p.y > -0.012 and -0.082 < p.z < 0.03)
        for f in [f for f in bm.faces if not garis(f.calc_center_median() - K)]:
            bm.faces.remove(f)                              # garis rambut: ubun-ubun, sisi di belakang telinga, sampai tengkuk
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        self.tambah('rambut', bm, rambut, kaku='Head')

    def lengan(self, kulit, dari=0.10):
        """Lengan bawah + tangan (jari menyatu), mulai `dari` meter dari bahu (bagian atasnya tertutup lengan baju)."""
        for k in (1, -1):
            S, d, w = self.LENGAN[k]
            bm = bmesh.new()
            tabung(bm, [(S + d * t, ry, rw) for t, ry, rw in ((0.10, 0.047, 0.044), (0.18, 0.045, 0.042), (0.25, 0.038, 0.036), (0.285, 0.037, 0.035), (0.34, 0.041, 0.037),
                                                            (0.44, 0.033, 0.028), (0.505, 0.027, 0.021), (0.53, 0.030, 0.019)) if t >= dari], u=Y, w=w, seg=14)
            elips(bm, S + d * 0.592, (0.040, 0.0155, 0.086), sumbu=(Y, w, d), seg=14, ring=10)             # telapak
            jempol = (d * 0.8 - Y * 0.6).normalized()
            elips(bm, S + d * 0.566 - Y * 0.043, (0.012, 0.011, 0.036), sumbu=(w.cross(jempol), w, jempol), seg=10, ring=8)
            self.tambah('lengan' + 'LR'[k < 0], bm, kulit, lebur=(0.004, 220, 0.0, 3))

    def kaki(self, bhn, nama='kaki', tebal=0.0, atas=0.44, segitiga=240):
        """Betis + telapak kaki. tebal > 0 dengan bahan kulit samak = sepatu bot setinggi `atas`."""
        t = tebal
        for k in (1, -1):
            x = k * self.KAKI_X
            bm = bmesh.new()
            tabung(bm, [((x, y, z), rx + t, ry + t) for y, z, rx, ry in ((0.004, 0.44, 0.050, 0.052), (0.010, 0.36, 0.052, 0.057), (0.006, 0.22, 0.040, 0.043),
                                                                         (0.004, 0.10, 0.031, 0.034), (0.0, 0.035, 0.034, 0.040)) if z <= atas + 1e-6], seg=14)   # betis
            tabung(bm, [((x, y, z + t * 0.5), rx + t, rz + t * 0.5) for y, z, rx, rz in ((0.062, 0.031, 0.030, 0.028), (0.0, 0.041, 0.041, 0.040), (-0.08, 0.029, 0.047, 0.027),
                                                                                        (-0.15, 0.018, 0.049, 0.016), (-0.188, 0.012, 0.040, 0.010))], u=X, w=Z, seg=12)   # telapak
            self.tambah(nama + 'LR'[k < 0], bm, bhn, lebur=(0.004, segitiga, 0.0, 3))

    def celana(self, bhn, bawah=0.30, segitiga=540):
        bm = bmesh.new()
        tabung(bm, [((0, 0, 1.01), 0.158, 0.110), ((0, 0, 0.93), 0.176, 0.124), ((0, 0, 0.85), 0.186, 0.128), ((0, 0, 0.78), 0.176, 0.116)], n=2.4)
        for k in (1, -1):
            x = k * self.KAKI_X
            tabung(bm, [((x, 0, 0.88), 0.090, 0.100), ((x, 0, 0.70), 0.093, 0.100), ((x, 0, 0.50), 0.085, 0.090), ((x, 0.004, bawah + 0.06), 0.082, 0.086),
                        ((x, 0.004, bawah), 0.088, 0.091)], seg=16)
        self.tambah('celana', bm, bhn, lebur=(0.007, segitiga, 0.014))

    def tunik(self, bhn, bawah=0.80, lengan=0.225, tebal=0.0, segitiga=800, riak=0.010, tim=True):
        """Baju: badan dari leher sampai `bawah`, lengan baju sampai `lengan` meter dari bahu; tebal menambah ketebalan (baju berlapis)."""
        z0, rx0, ry0 = self.PINGGANG
        t = tebal
        cincin = [(bawah, 0.205 + (0.80 - bawah) * 0.10, 0.145 + (0.80 - bawah) * 0.05, 0)] if bawah < 0.80 else []
        cincin += [(0.80, 0.205, 0.145, 0), (0.87, 0.196, 0.138, 0), (0.94, 0.184, 0.130, 0), (z0, rx0, ry0, 0), (1.13, 0.172, 0.120, -0.003), (1.26, 0.190, 0.128, -0.006),
                   (1.33, 0.200, 0.118, -0.004), (1.372, 0.180, 0.100, 0), (1.402, 0.110, 0.080, 0.004), (1.42, 0.060, 0.062, 0.008)]
        bm = bmesh.new()
        tabung(bm, [((0, y, z), rx + (t if z < 1.40 else 0), ry + (t if z < 1.40 else 0)) for z, rx, ry, y in cincin], seg=24, n=2.5)
        for k in (1, -1):
            S, d, w = self.LENGAN[k]
            elips(bm, S, (0.064 + t, 0.059 + t, 0.064 + t), sumbu=(Y, w, d))                               # bahu membulat
            ujung = [(0.0, 0.063, 0.058), (0.08, 0.064, 0.060), (0.17, 0.061, 0.058)] + ([(lengan - 0.06, 0.058, 0.054)] if lengan > 0.26 else []) + [(lengan, 0.066 if lengan < 0.26 else 0.056, 0.063 if lengan < 0.26 else 0.052)]
            tabung(bm, [(S + d * u, ry + t, rw + t) for u, ry, rw in ujung], u=Y, w=w, seg=16)             # lengan baju
        self.tambah('tunik', bm, bhn, lebur=(0.007, segitiga, riak), tim=tim)

    def sabuk(self, bhn, juntai=True, lebar=0.02, longgar=0.012):
        z, rx, ry = self.PINGGANG
        bm = bmesh.new()
        tabung(bm, [((0, 0, z - lebar), rx + longgar, ry + longgar), ((0, 0, z + lebar), rx + longgar, ry + longgar)], seg=16, n=2.5)
        if juntai:                                          # sabuk kain: simpul dan dua juntai
            elips(bm, (0.05, -ry - longgar - 0.002, z), (0.024, 0.014, 0.022), seg=6, ring=4)
            for dx, pj in ((0.035, 0.11), (0.066, 0.085)):
                tabung(bm, [((dx, -ry - longgar - 0.006, z - 0.01), 0.011, 0.006), ((dx + 0.004, -ry - longgar - 0.014, z - pj), 0.013, 0.006)], seg=6)
        self.tambah('sabuk', bm, bhn)

    # ---- rakit: gabung, kaki ke z = 0, atlas, panggang
    def rakit(self, ukuran=1024):
        sc, B = self.sc, self.bagian
        self.info['segitiga'] = {b['nama']: sum(len(p.vertices) - 2 for p in b['ob'].data.polygons) for b in B}
        for i, b in enumerate(B):                           # tiap verteks mengingat bagian asalnya (dipakai saat memberi bobot)
            me = b['ob'].data
            me.attributes.new('bagian', 'INT', 'POINT').data.foreach_set('value', [i] * len(me.vertices))
            if 'asal' not in me.uv_layers:
                me.uv_layers.new(name='asal')
            for p in me.polygons:
                p.use_smooth = not b['rata']
        for o in sc.objects:
            o.select_set(any(o == b['ob'] for b in B))
        bpy.context.view_layer.objects.active = B[0]['ob']
        bpy.ops.object.join()
        ob = self.ob = bpy.context.view_layer.objects.active
        ob.name = self.nama.capitalize()
        me = ob.data
        self.dasar = min(v.co.z for v in me.vertices)
        for v in me.vertices:
            v.co.z -= self.dasar
        self.asal = [B[d.value]['nama'] for d in me.attributes['bagian'].data]
        self.tinggi = max(v.co.z for v in me.vertices)
        atlas_uv = me.uv_layers.new(name='atlas')
        me.uv_layers.active = atlas_uv
        atlas_uv.active_render = True
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=rad(72), island_margin=0.006)
        bpy.ops.object.mode_set(mode='OBJECT')

        # panggang warna + AO, dan kekasaran + logam bila ada bahan logam
        def baru(n, data=False):
            g = bpy.data.images.new(self.nama + '-' + n, ukuran, ukuran)
            if data:
                g.colorspace_settings.name = 'Non-Color'
            return g

        g_warna, g_ao = baru('atlas'), baru('ao', True)
        sasaran = []
        for m in me.materials:
            n = m.node_tree.nodes.new('ShaderNodeTexImage')
            m.node_tree.nodes.active = n
            sasaran.append(n)
        sc.world = bpy.data.worlds.new('Dunia')
        sc.world.light_settings.distance = 0.6
        sc.render.engine = 'CYCLES'
        sc.cycles.device, sc.cycles.samples = 'CPU', 48

        def panggang(gbr, jenis, **opsi):
            for n in sasaran:
                n.image = gbr
            bpy.ops.object.bake(type=jenis, margin=10, use_clear=True, **opsi)
            px = np.empty(ukuran * ukuran * 4, np.float32)
            gbr.pixels.foreach_get(px)
            return px.reshape(-1, 4)

        def lewat_emisi(gbr, isi):
            """Panggang satu nilai per bahan lewat emisi: isi(bahan, node_emisi) mengatur warnanya. Dipakai untuk warna
            dasar (bahan logam tidak punya komponen difus) dan untuk kadar logam (tidak ada jenis panggangnya)."""
            kabel = []
            for m in me.materials:
                nt = m.node_tree
                out, em = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), nt.nodes.new('ShaderNodeEmission')
                isi(m, em)
                kabel.append((nt, out, out.inputs['Surface'].links[0].from_socket, em))
                nt.links.new(em.outputs[0], out.inputs['Surface'])
            px = panggang(gbr, 'EMIT')
            for nt, out, asal, em in kabel:
                nt.links.new(asal, out.inputs['Surface'])
                nt.nodes.remove(em)
            return px

        def warna_dasar(m, em):
            s = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color']
            if s.links:
                m.node_tree.links.new(s.links[0].from_socket, em.inputs['Color'])
            else:
                em.inputs['Color'].default_value = s.default_value

        px, ao = lewat_emisi(g_warna, warna_dasar), panggang(g_ao, 'AO')
        px[:, :3] *= 0.45 + 0.55 * ao[:, :1]                # bayangan lembut: lipatan, ketiak, bawah topi
        px[:, 3] = 1
        g_warna.pixels.foreach_set(px.ravel())
        g_warna.filepath_raw, g_warna.file_format = self.berkas('atlas.png'), 'PNG'
        g_warna.save()
        g_orm = None
        if any(m.get('logam', 0) > 0 for m in me.materials):
            g_orm, g_tmp = baru('orm', True), baru('tmp', True)
            kasar = panggang(g_tmp, 'ROUGHNESS')[:, 0].copy()
            logam = lewat_emisi(g_tmp, lambda m, em: setattr(em.inputs['Color'], 'default_value', (m.get('logam', 0),) * 3 + (1,)))[:, 0].copy()
            orm = np.ones((ukuran * ukuran, 4), np.float32)   # R kosong, G kekasaran, B logam (susunan glTF)
            orm[:, 1], orm[:, 2] = kasar, logam
            g_orm.pixels.foreach_set(orm.ravel())
            g_orm.filepath_raw, g_orm.file_format = self.berkas('orm.png'), 'PNG'
            g_orm.save()
            bpy.data.images.remove(g_tmp)

        # bahan akhir: satu atlas; bagian bertanda tim di bahan tersendiri ("kain_tim") supaya game bisa mengalikannya dengan warna tim
        tim = {i for i, b in enumerate(B) if b['tim']}
        kelas = [1 if me.attributes['bagian'].data[p.vertices[0]].value in tim else 0 for p in me.polygons]
        self.akhir = []
        for nama in ('tubuh', 'kain_tim'):
            m = self.bahan(nama)
            nt, b = m.node_tree, next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
            tx = nt.nodes.new('ShaderNodeTexImage')
            tx.image = g_warna
            nt.links.new(tx.outputs['Color'], b.inputs['Base Color'])
            if g_orm:
                to, pisah = nt.nodes.new('ShaderNodeTexImage'), nt.nodes.new('ShaderNodeSeparateColor')
                to.image = g_orm
                nt.links.new(to.outputs['Color'], pisah.inputs['Color'])
                nt.links.new(pisah.outputs['Green'], b.inputs['Roughness'])
                nt.links.new(pisah.outputs['Blue'], b.inputs['Metallic'])
            self.akhir.append(m)
        me.materials.clear()
        for m in self.akhir:
            me.materials.append(m)
        for p, i in zip(me.polygons, kelas):
            p.material_index = i
        me.uv_layers.remove(me.uv_layers['asal'])
        self.info['logam'] = bool(g_orm)

    di = lambda self, *nama: [i for i, n in enumerate(self.asal) if n in nama]

    # ---- pratinjau diam
    def pratinjau(self):
        sc = self.sc
        sc.render.engine = 'BLENDER_EEVEE'
        sc.view_settings.view_transform = 'Standard'
        if bpy.app.version < (5, 0, 0):                     # sejak Blender 5 dunia selalu bernode
            sc.world.use_nodes = True
        latar = next(n for n in sc.world.node_tree.nodes if n.type == 'BACKGROUND')
        latar.inputs['Color'].default_value, latar.inputs['Strength'].default_value = (0.82, 0.84, 0.86, 1), 0.9
        surya = bpy.data.objects.new('Surya', bpy.data.lights.new('Surya', 'SUN'))
        surya.data.energy, surya.data.angle = 2.6, rad(8)
        surya.rotation_euler = (rad(52), 0, rad(-28))
        sc.collection.objects.link(surya)
        kam = self.kam = bpy.data.objects.new('Kamera', bpy.data.cameras.new('Kamera'))
        sc.collection.objects.link(kam)
        sc.camera = kam
        sc.render.resolution_x, sc.render.resolution_y = 520, 640
        tengah = Vector((0, 0, self.tinggi / 2))
        for nama, arah, orto in (('depan', (0, -1, 0), 1), ('samping', (1, 0, 0), 1), ('belakang', (0, 1, 0), 1), ('serong', (0.62, -1, 0.42), 0), ('atas', (0.25, -1, 1.05), 0)):
            arah = Vector(arah).normalized()
            kam.data.type = 'ORTHO' if orto else 'PERSP'
            kam.data.ortho_scale = self.tinggi * 1.12
            kam.data.lens = 70
            kam.location = tengah + arah * (8 if orto else 2.95 * self.tinggi)
            kam.rotation_euler = (-arah).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = self.berkas(nama + '.png')
            bpy.ops.render.render(write_still=True)

    def pratinjau_tim(self):
        """Bahan kain_tim dikalikan warna tim, seperti yang dilakukan game; memakai sudut kamera terakhir pratinjau()."""
        nt = self.akhir[1].node_tree
        kali, b = nt.nodes.new('ShaderNodeMix'), next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        kali.data_type, kali.blend_type = 'RGBA', 'MULTIPLY'
        kali.inputs[0].default_value = 1
        nt.links.new(b.inputs['Base Color'].links[0].from_socket, kali.inputs[6])
        nt.links.new(kali.outputs[2], b.inputs['Base Color'])
        for nama, hexa in (('biru', '3b82f6'), ('merah', 'ef4444')):
            kali.inputs[7].default_value = (*[lin(int(hexa[i:i + 2], 16) / 255) for i in (0, 2, 4)], 1)
            self.sc.render.filepath = self.berkas('tim-' + nama + '.png')
            bpy.ops.render.render(write_still=True)

    # ---- kerangka + gerak → GLB berkerangka
    def gerakkan(self, klip, glb, tiru=(), lihat=None):
        """klip: [(nama, jumlah frame, fungsi(P, p))]. tiru: [(bagian sasaran, bagian sumber, rentang_z)] (lihat ikat).
        lihat: opsi lembar kontak per klip {nama: {…}} atau {'*': {…}} untuk semua."""
        sc, ob, me, B = self.sc, self.ob, self.ob.data, self.bagian
        kaku = {}
        for b in B:
            if b['kaku']:
                kaku.setdefault(b['kaku'], []).extend(self.di(b['nama']))
        kaku.setdefault('Head', []).extend(i for i in self.di('kepala') if me.vertices[i].co.z > 1.475 - self.dasar)   # kepala di atas dagu kaku
        arm = self.arm = buat_kerangka(sendi({k: self.LENGAN[k][:2] for k in (1, -1)}, turun=self.dasar, kaki_x=self.KAKI_X))
        self.catatan += ikat(ob, arm, kaku, tiru=[(self.di(a), self.di(b), r) for a, b, r in tiru])
        P = self.P = Peraga(arm)
        for nama, frame, fungsi in klip:
            P.rekam(nama, frame, fungsi)
        aksi = P.selesai()
        badan = set(self.di(*[b['nama'] for b in B if not b['kaku'] or b['nama'] == 'kepala']))
        lantai = {}
        for nama, _, _ in klip:                             # titik terendah badan (tanpa perlengkapan) sepanjang klip: [paling rendah, paling tinggi]
            P.pasang(aksi[nama])
            z = []
            for f in range(0, int(aksi[nama].frame_range[1]) + 1, 3):
                sc.frame_set(f)
                ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
                m = ev.to_mesh()
                z.append(min(v.co.z for v in m.vertices if v.index in badan))
                ev.to_mesh_clear()
            lantai[nama] = [round(min(z), 3), round(max(z), 3)]
        P.diam()
        sc.frame_set(0)
        for o in sc.objects:
            o.select_set(o in (ob, arm))
        bpy.context.view_layer.objects.active = ob
        os.makedirs(os.path.dirname(os.path.abspath(glb)), exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=os.path.abspath(glb), export_format='GLB', use_selection=True, export_animation_mode='ACTIONS', export_skins=True, export_yup=True)
        kam = self.kam
        posisi = (kam.location.copy(), kam.rotation_euler.copy(), kam.data.type)
        for nama, _, _ in klip:
            lembar(P, aksi[nama], self.berkas('gerak-' + nama + '.png'), **{**(lihat or {}).get('*', {}), **(lihat or {}).get(nama, {})})
        kam.location, kam.rotation_euler, kam.data.type = posisi
        self.info.update({'glb': os.path.abspath(glb), 'tulang': len(arm.data.bones), 'klip': {n: round(f / 30, 2) for n, f, _ in klip}, 'titik_terendah_m': lantai})

    def ringkasan(self):
        s = self.info['segitiga']
        print(self.nama.upper() + ' ' + json.dumps({'tinggi_m': round(self.tinggi, 3), 'total': sum(s.values()), **self.info, 'folder': self.keluar, 'catatan': self.catatan}))


# ---------------------------------------------------------------- kerangka & bobot

def sendi(bahu, turun=0.0, kaki_x=0.105):
    """Daftar tulang (nama, induk, pangkal, ujung). bahu: {k: (S, d)} = titik bahu & arah lengan per sisi (k = +1 kiri).
    Lutut sedikit ke depan dan siku sedikit ke belakang supaya IK tahu arah tekuknya."""
    g = Vector((0, 0, -turun))
    T = [('Hips', None, (0, 0, 0.95), (0, 0, 1.05)), ('Spine', 'Hips', (0, 0, 1.05), (0, 0, 1.17)), ('Spine1', 'Spine', (0, 0, 1.17), (0, 0, 1.30)),
         ('Neck', 'Spine1', (0, 0.006, 1.40), (0, 0, 1.49)), ('Head', 'Neck', (0, 0, 1.49), (0, 0, 1.70))]
    for s, k in SISI:
        S, d = bahu[k]
        x, siku = k * kaki_x, S + d * 0.285 + Y * 0.012
        T += [(s + 'Shoulder', 'Spine1', (k * 0.035, 0, 1.345), S), (s + 'Arm', s + 'Shoulder', S, siku), (s + 'ForeArm', s + 'Arm', siku, S + d * 0.515),
              (s + 'Hand', s + 'ForeArm', S + d * 0.515, S + d * 0.62),
              (s + 'UpLeg', 'Hips', (x, 0, 0.90), (x, -0.015, 0.50)), (s + 'Leg', s + 'UpLeg', (x, -0.015, 0.50), (x, 0.004, 0.085)),
              (s + 'Foot', s + 'Leg', (x, 0.004, 0.085), (x, -0.125, 0.022)), (s + 'ToeBase', s + 'Foot', (x, -0.125, 0.022), (x, -0.19, 0.012))]
    return [(n, i, Vector(h) + g, Vector(t) + g) for n, i, h, t in T]


def buat_kerangka(tulang, nama='Kerangka'):
    sc = bpy.context.scene
    arm = bpy.data.objects.new(nama, bpy.data.armatures.new(nama))
    sc.collection.objects.link(arm)
    for o in sc.objects:
        o.select_set(o == arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for n, induk, h, t in tulang:
        b = arm.data.edit_bones.new(n)
        b.head, b.tail = h, t
        if induk:
            b.parent = eb[induk]
        eb[n] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    for b in arm.pose.bones:
        b.rotation_mode = 'QUATERNION'
    return arm


def ikat(ob, arm, kaku=None, tiru=None, maks=4):
    """Bobot otomatis (panas tulang) + bagian kaku {tulang: [indeks verteks]} diikat penuh. Hasil: catatan.
    tiru: [(sasaran, sumber, rentang_z)] = verteks sasaran meniru bobot verteks sumber terdekat, supaya dua lapis kain
    bergerak bersama dan lapis dalam tidak menembus keluar; rentang_z (z0, z1): penuh di bawah z0, memudar sampai z1."""
    sc, catatan = bpy.context.scene, []
    for o in sc.objects:
        o.select_set(o in (ob, arm))
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    me = ob.data
    semua_kaku = {i for idx in (kaku or {}).values() for i in idx}
    kosong = [v.index for v in me.vertices if v.index not in semua_kaku and not any(g.weight > 1e-4 for g in v.groups)]
    if len(kosong) + len(semua_kaku) >= len(me.vertices):
        raise RuntimeError('bobot otomatis gagal untuk seluruh mesh')
    if kosong:                                               # pulau kecil yang tak terjangkau panas tulang: tiru verteks berbobot terdekat
        tanpa = set(kosong) | semua_kaku
        berbobot = [v for v in me.vertices if v.index not in tanpa]
        kd = kdtree.KDTree(len(berbobot))
        for i, v in enumerate(berbobot):
            kd.insert(v.co, i)
        kd.balance()
        for i in kosong:
            for g in berbobot[kd.find(me.vertices[i].co)[1]].groups:
                ob.vertex_groups[g.group].add([i], g.weight, 'REPLACE')
        catatan.append(str(len(kosong)) + ' verteks tanpa bobot meniru tetangga terdekat')
    for sasaran, sumber, rentang in (tiru or []):
        kd = kdtree.KDTree(len(sumber))
        for j, i in enumerate(sumber):
            kd.insert(me.vertices[i].co, j)
        kd.balance()
        for i in sasaran:
            v = me.vertices[i]
            f = 1.0 if not rentang else max(0.0, min(1.0, (rentang[1] - v.co.z) / (rentang[1] - rentang[0])))
            if f <= 0:
                continue
            baru = {g.group: g.weight * (1 - f) for g in v.groups}
            for g in me.vertices[sumber[kd.find(v.co)[1]]].groups:
                baru[g.group] = baru.get(g.group, 0.0) + g.weight * f
            for gi in [g.group for g in v.groups]:
                ob.vertex_groups[gi].remove([i])
            for gi, w in baru.items():
                if w > 0:
                    ob.vertex_groups[gi].add([i], w, 'REPLACE')
    for n, idx in (kaku or {}).items():
        for g in ob.vertex_groups:
            g.remove(idx)
        ob.vertex_groups[n].add(idx, 1.0, 'REPLACE')
    for v in me.vertices:                                    # paling banyak `maks` pengaruh, dinormalkan
        gs = sorted(((g.weight, g.group) for g in v.groups), reverse=True)
        for w, gi in gs[maks:] + [x for x in gs[:maks] if x[0] < 0.01]:
            ob.vertex_groups[gi].remove([v.index])
        simpan = [x for x in gs[:maks] if x[0] >= 0.01] or gs[:1]
        jml = sum(w for w, _ in simpan)
        for w, gi in simpan:
            ob.vertex_groups[gi].add([v.index], w / jml, 'REPLACE')
    return catatan


# ---------------------------------------------------------------- pemeraga

class Peraga:
    """Pemeraga gerak: tulang diputar langsung (FK); kaki mengikuti sasaran telapak (IK); lengan bisa mengikuti sasaran
    genggaman (IK) dan arah tangan bisa dikunci di ruang dunia (untuk senjata yang menempel di tangan). Tiap frame
    direkam lalu ditulis jadi aksi berkunci per frame tanpa pengekang."""

    def __init__(self, arm, fps=30):
        self.arm, self.pb, self.fps, self.rekaman = arm, arm.pose.bones, fps, {}
        self.rq = {b.name: b.bone.matrix_local.to_quaternion() for b in self.pb}
        self.kepala = {b.name: b.bone.matrix_local.to_translation() for b in self.pb}
        self.ekor = {b.name: b.bone.tail_local.copy() for b in self.pb}
        sc = bpy.context.scene
        sc.render.fps = fps
        self.kendali = []

        def kosong(nama):
            e = bpy.data.objects.new(nama, None)
            sc.collection.objects.link(e)
            e.rotation_mode = 'QUATERNION'
            self.kendali.append(e)
            return e

        self.kaki, self.tgn = {}, {}
        for s, k in SISI:
            t, p = kosong(s + '_telapak'), kosong(s + '_lutut')
            p.location = self.kepala[s + 'Leg'] + Vector((0, -0.8, 0))
            ik = self.pb[s + 'Leg'].constraints.new('IK')
            ik.target, ik.pole_target, ik.chain_count = t, p, 2
            cr = self.pb[s + 'Foot'].constraints.new('COPY_ROTATION')
            cr.target = t
            self.kaki[s] = (t, ik, cr)
            t, p = kosong(s + '_tangan'), kosong(s + '_siku')
            ik = self.pb[s + 'ForeArm'].constraints.new('IK')
            ik.target, ik.pole_target, ik.chain_count = t, p, 2
            cr = self.pb[s + 'Hand'].constraints.new('COPY_ROTATION')
            cr.target = t
            self.tgn[s] = (t, p, ik, cr)
        self.awal()
        for s, _ in SISI:                                    # sudut kutub: pilih yang membiarkan lutut/siku di tempat istirahatnya
            for ik, tengah, kutub in ((self.kaki[s][1], s + 'Leg', None), (self.tgn[s][2], s + 'ForeArm', self.tgn[s][1])):
                if kutub:
                    kutub.location = self.kepala[tengah] + Vector((0, 0.6, 0))
                ik.influence, terbaik = 1, None
                for a in (0, 90, 180, -90):
                    ik.pole_angle = rad(a)
                    bpy.context.view_layer.update()
                    d = ((arm.matrix_world @ self.pb[tengah].matrix).to_translation() - self.kepala[tengah]).length
                    if terbaik is None or d < terbaik[0]:
                        terbaik = (d, a)
                ik.pole_angle = rad(terbaik[1])
        self.awal()

    def awal(self):
        for b in self.pb:
            b.rotation_quaternion, b.location, b.scale = (1, 0, 0, 0), (0, 0, 0), (1, 1, 1)
        for s, k in SISI:
            self.telapak(s)
            t, p, ik, cr = self.tgn[s]
            t.location, t.rotation_quaternion, ik.influence, cr.influence = self.kepala[s + 'Hand'], self.rq[s + 'Hand'], 0, 0
        self.ik(1)

    def ik(self, pengaruh):
        for t, ik, cr in self.kaki.values():
            ik.influence = cr.influence = pengaruh

    @staticmethod
    def putaran(putaran):
        """[(sumbu, sudut), …] berurutan → kuaternion; sumbu 'X'/'Y'/'Z' atau Vector."""
        if isinstance(putaran, Quaternion):
            return putaran
        q = Quaternion()
        for sumbu, sudut in putaran:
            q = Quaternion(sumbu if isinstance(sumbu, Vector) else {'X': X, 'Y': Y, 'Z': Z}[sumbu], sudut) @ q
        return q

    def fk(self, nama, *putaran):
        """Putaran di sumbu kerangka relatif ke induk."""
        self.pb[nama].rotation_quaternion = self.rq[nama].inverted() @ self.putaran(putaran) @ self.rq[nama]

    def pinggul(self, geser=(0, 0, 0), *putaran):
        self.pb['Hips'].location = self.rq['Hips'].inverted() @ Vector(geser)
        self.fk('Hips', *putaran)

    def telapak(self, s, geser=(0, 0, 0), jungkit=0.0, serong=0.0):
        """Sasaran pergelangan kaki (geser dari posisi istirahat); jungkit > 0 = tumit terangkat, serong = putar keluar."""
        t = self.kaki[s][0]
        t.location = self.kepala[s + 'Foot'] + Vector(geser)
        t.rotation_quaternion = Quaternion(Z, serong) @ Quaternion(X, jungkit) @ self.rq[s + 'Foot']

    def tangan(self, s, genggam=None, arah=None, siku=None):
        """genggam: titik dunia tempat tengah telapak berada (lengan mengikuti lewat IK). arah: putaran tangan di ruang
        dunia terhadap pose istirahatnya (kuaternion atau [(sumbu, sudut)]); benda yang menempel di tangan ikut berputar.
        siku: titik dunia yang dituju siku (bawaan: belakang-bawah-luar bahu)."""
        t, p, ik, cr = self.tgn[s]
        k = 1 if s == 'Left' else -1
        q = self.putaran(arah) if arah is not None else Quaternion()
        if arah is not None:
            t.rotation_quaternion, cr.influence = q @ self.rq[s + 'Hand'], 1
        if genggam is not None:
            telapak = (self.ekor[s + 'Hand'] - self.kepala[s + 'Hand']) * (0.075 / 0.105)       # pergelangan → tengah telapak (istirahat)
            t.location, ik.influence = Vector(genggam) - q @ telapak, 1
            p.location = Vector(siku) if siku is not None else self.kepala[s + 'Arm'] + Vector((k * 0.30, 0.55, -0.45))

    def potret(self):
        return ({b.name: (b.rotation_quaternion.copy(), b.location.copy()) for b in self.pb},
                [(e.location.copy(), e.rotation_quaternion.copy()) for e in self.kendali],
                [c.influence for b in self.pb for c in b.constraints])

    def campur(self, pose_a, pose_b, t):
        """Pose antara dua fungsi pose (t = 0 → a, t = 1 → b): tulang, sasaran IK, dan pengaruh pengekang ikut dicampur."""
        self.awal()
        pose_a(self)
        a = self.potret()
        self.awal()
        pose_b(self)
        if t >= 1:
            return
        b = self.potret()
        for bn in self.pb:
            bn.rotation_quaternion, bn.location = a[0][bn.name][0].slerp(b[0][bn.name][0], t), a[0][bn.name][1].lerp(b[0][bn.name][1], t)
        for e, (la, qa), (lb, qb) in zip(self.kendali, a[1], b[1]):
            e.location, e.rotation_quaternion = la.lerp(lb, t), qa.slerp(qb, t)
        for c, ia, ib in zip([c for bn in self.pb for c in bn.constraints], a[2], b[2]):
            c.influence = lerp(ia, ib, t)

    def rekam(self, nama, frame, fungsi):
        """fungsi(P, p) memeragakan fase p = 0..1 (p = 1 sama dengan p = 0 untuk gerak berulang)."""
        data = []
        for f in range(frame + 1):
            self.awal()
            fungsi(self, f / frame)
            bpy.context.view_layer.update()
            pose = {}
            for b in self.pb:
                M = self.arm.convert_space(pose_bone=b, matrix=b.matrix, from_space='POSE', to_space='LOCAL')
                q = M.to_quaternion()
                if data and data[-1][b.name][1].dot(q) < 0:
                    q.negate()
                pose[b.name] = (M.to_translation(), q)
            data.append(pose)
        self.rekaman[nama] = data

    def selesai(self):
        """Buang pengekang & kendali, tulis aksi. Hasil: {nama: aksi}."""
        for b in self.pb:
            for c in list(b.constraints):
                b.constraints.remove(c)
        for e in self.kendali:
            bpy.data.objects.remove(e, do_unlink=True)
        self.kendali = []
        self.arm.animation_data_create()
        aksi = {}
        for nama, data in self.rekaman.items():
            a = bpy.data.actions.new(nama)
            a.use_fake_user = True
            self.arm.animation_data.action = a
            for f, pose in enumerate(data):
                for b in self.pb:
                    b.location, b.rotation_quaternion = pose[b.name]
                    b.keyframe_insert('rotation_quaternion', frame=f)
                    if b.parent is None:
                        b.keyframe_insert('location', frame=f)
            aksi[nama] = a
        self.diam()
        return aksi

    def diam(self):
        self.arm.animation_data.action = None
        for b in self.pb:
            b.rotation_quaternion, b.location = (1, 0, 0, 0), (0, 0, 0)

    def pasang(self, a):
        ad = self.arm.animation_data
        ad.action = a
        if bpy.app.version >= (4, 4, 0) and ad.action_slot is None and len(a.slots):
            ad.action_slot = a.slots[0]


# ---------------------------------------------------------------- gerak: pekerja

def lengan(P, s, k, turun=38, ayun=0.0, tekuk=14, masuk=0.0, putar=0.0):
    """Lengan dari pose A: turun ke sisi badan (derajat), ayun (+ ke belakang), tekuk siku ke depan, masuk = menyilang
    ke tengah, putar = puntir lengan atas pada sumbunya."""
    d = (P.ekor[s + 'ForeArm'] - P.kepala[s + 'Arm']).normalized()
    P.fk(s + 'Arm', (d, rad(k * putar)), ('Y', rad(k * turun)), ('X', rad(ayun)), ('Z', rad(-k * masuk)))
    P.fk(s + 'ForeArm', (d.cross(-Y).normalized(), rad(tekuk)))


def diam(P, p, bawa=False):
    s1, s2 = math.sin(2 * math.pi * p), math.sin(4 * math.pi * p + 0.7)
    P.pinggul((0.012 + 0.004 * s1, 0.004, -0.012), ('Y', rad(1.6)), ('X', rad(1.0)))                    # berat badan di kaki kiri
    P.fk('Spine', ('Y', rad(-1.0)), ('X', rad(1.5 + 0.5 * s1)))
    P.fk('Spine1', ('Y', rad(-0.6)), ('X', rad(-1.2 * s1)))                                             # napas
    P.fk('Neck', ('X', rad(-2 + 0.6 * s1)))
    P.fk('Head', ('Z', rad(7 * s1 + 2 * s2)), ('X', rad(1.5 * s2)))
    for s, k in SISI:
        P.fk(s + 'Shoulder', ('Y', rad(-k * 1.2 * s1)))
        lengan(P, s, k, turun=37 + 0.8 * s1, ayun=3 + k * 1.5 * s2, tekuk=14 if k > 0 else 20, putar=8)
    if bawa:
        lengan(P, 'Left', 1, turun=34, ayun=-38, tekuk=118, masuk=6)


def langkah(P, p, setengah=0.29):
    """Kaki & batang tubuh untuk jalan di tempat: dua langkah per putaran, kaki kiri menapak di p = 0. Hasil: cos fase."""
    for s, k in SISI:
        q = (p + (0.0 if k > 0 else 0.5)) % 1.0
        if q < 0.6:                                          # menapak: tumit dulu, rata, lalu tumit terangkat menjelang lepas
            u = q / 0.6
            lepas = max(0.0, (u - 0.68) / 0.32) ** 1.4
            tumit = max(0.0, 1 - u / 0.16)
            y, z, jungkit = -setengah + 2 * setengah * u, 0.085 * lepas + 0.014 * tumit, rad(-14) * tumit + rad(30) * lepas
        else:                                                # mengayun ke depan
            u = (q - 0.6) / 0.4
            e = 0.5 - 0.5 * math.cos(math.pi * u)
            y, z, jungkit = setengah - 2 * setengah * e, lerp(0.085, 0.014, u) + 0.06 * math.sin(math.pi * u), rad(lerp(30, -14, e))
        P.telapak(s, (-k * 0.018, y, z), jungkit, rad(k * 5))
    c, s1 = math.cos(2 * math.pi * p), math.sin(2 * math.pi * (p - 0.05))
    P.pinggul((0.02 * s1, -0.01, -0.05 - 0.017 * math.cos(4 * math.pi * (p - 0.05))),
              ('X', rad(3.5)), ('Y', rad(3.0 * math.sin(2 * math.pi * (p - 0.55)))), ('Z', rad(-7 * c)))
    P.fk('Spine', ('X', rad(2.0)), ('Z', rad(4 * c)))
    P.fk('Spine1', ('X', rad(1.5)), ('Z', rad(8 * c)), ('Y', rad(-2.0 * math.sin(2 * math.pi * (p - 0.55)))))
    P.fk('Neck', ('Z', rad(-2.5 * c)), ('X', rad(-3)))
    P.fk('Head', ('Z', rad(-2.5 * c)), ('X', rad(-2)))
    return c


def jalan(P, p, bawa=False):
    c = langkah(P, p)
    for s, k in SISI:
        a = k * c                                            # lengan berlawanan dengan kaki sesisi
        lengan(P, s, k, turun=38, ayun=22 * a + 2, tekuk=20 + 16 * max(0.0, -a) - 6 * max(0.0, a), putar=10)
    if bawa:
        lengan(P, 'Left', 1, turun=34, ayun=-38 + 2 * c, tekuk=118, masuk=6)
        P.fk('Spine1', ('X', rad(5)), ('Z', rad(5 * c)))


def derap(P, p, depan=0.32, belakang=0.46, tapak=0.34):
    """Kaki & batang tubuh untuk lari di tempat: dua langkah per putaran dengan saat melayang, kaki kiri menapak di p = 0.
    Jarak tempuh satu putaran tanpa selip = (depan + belakang) / tapak meter. Hasil: cos fase."""
    for s, k in SISI:
        q = (p + (0.0 if k > 0 else 0.5)) % 1.0
        if q < tapak:                                        # menapak: telapak rata lalu tumit terangkat sampai tolakan
            u = q / tapak
            lepas = max(0.0, (u - 0.45) / 0.55) ** 1.3
            y, z, jungkit = -depan + (depan + belakang) * u, 0.012 * (1 - u) + 0.11 * lepas, rad(-4) * (1 - u) + rad(52) * lepas
        else:                                                # mengayun: tumit ke arah paha, lutut maju, lalu menjulur untuk mendarat
            u = (q - tapak) / (1 - tapak)
            e = halus(u)
            y, z, jungkit = belakang - (depan + belakang) * e, lerp(0.11, 0.012, u) + 0.24 * math.sin(math.pi * u ** 0.75), rad(lerp(52, -4, e) + 18 * math.sin(math.pi * u))
        P.telapak(s, (-k * 0.03, y, z), jungkit, rad(k * 3))
    c = math.cos(2 * math.pi * (p - tapak / 2))              # 1 saat kaki kiri di tengah tapakan
    P.pinggul((0.012 * c, -0.03, -0.07 - 0.03 * math.cos(4 * math.pi * (p - tapak / 2))),
              ('X', rad(9)), ('Y', rad(-3 * c)), ('Z', rad(9 * math.sin(2 * math.pi * (p - tapak / 2)))))
    P.fk('Spine', ('X', rad(4)), ('Z', rad(-6 * math.sin(2 * math.pi * (p - tapak / 2)))))
    P.fk('Spine1', ('X', rad(3)), ('Z', rad(-12 * math.sin(2 * math.pi * (p - tapak / 2)))))
    P.fk('Neck', ('X', rad(-7)), ('Z', rad(4 * math.sin(2 * math.pi * (p - tapak / 2)))))
    P.fk('Head', ('X', rad(-6)), ('Z', rad(5 * math.sin(2 * math.pi * (p - tapak / 2)))))
    return math.sin(2 * math.pi * (p - tapak / 2))


def lari(P, p, bawa=False):
    """Lari: 2,29 m per putaran (1,11 tile) pada model, lengan tertekuk memompa berlawanan dengan kaki."""
    a = derap(P, p)
    for s, k in SISI:
        lengan(P, s, k, turun=40, ayun=-8 - 34 * k * a, tekuk=88 + 12 * k * a, masuk=8, putar=18)
    if bawa:                                                 # lengan kiri menahan beban di bahu
        lengan(P, 'Left', 1, turun=34, ayun=-40 + 3 * a, tekuk=118, masuk=6)
        P.fk('Spine1', ('X', rad(6)), ('Z', rad(-8 * a)))


def kerja(P, p):
    """Mengayun alat dengan dua tangan dari atas bahu kanan ke depan-bawah. p = 0: alat di bawah (habis menghantam)."""
    if p < 0.5:
        k = halus(p / 0.5)                                   # mengangkat
    elif p < 0.66:
        k = 1 - ((p - 0.5) / 0.16) ** 2.2                    # menghantam: makin cepat
    else:
        k = 0.06 * math.sin(math.pi * (p - 0.66) / 0.34)     # pantulan kecil lalu diam
    P.telapak('Left', (0.02, -0.11, 0), 0, rad(8))
    P.telapak('Right', (-0.03, 0.10, 0), 0, rad(-18))
    P.pinggul((0, -0.01 + 0.03 * k, -0.075 + 0.03 * k), ('X', rad(lerp(20, -3, k))), ('Z', rad(lerp(10, -16, k))))
    P.fk('Spine', ('X', rad(lerp(12, -4, k))), ('Z', rad(lerp(6, -10, k))))
    P.fk('Spine1', ('X', rad(lerp(10, -6, k))), ('Z', rad(lerp(6, -12, k))))
    P.fk('Neck', ('X', rad(lerp(-12, 4, k))), ('Z', rad(lerp(-8, 12, k))))
    P.fk('Head', ('X', rad(lerp(-10, 2, k))), ('Z', rad(lerp(-6, 14, k))))
    lengan(P, 'Right', -1, turun=lerp(30, 10, k), ayun=lerp(-52, -116, k), tekuk=lerp(24, 104, k), masuk=lerp(22, -4, k), putar=20)
    lengan(P, 'Left', 1, turun=lerp(30, 16, k), ayun=lerp(-56, -110, k), tekuk=lerp(34, 110, k), masuk=lerp(34, 30, k), putar=20)


def lempar(P, p):
    """Melempar tombak dengan tangan kanan; awal & akhir = sikap diam."""
    diam(P, 0.0)
    a = naik(p, 0.0, 0.38) * (1 - naik(p, 0.40, 0.56))       # ancang-ancang
    b = naik(p, 0.40, 0.58) * (1 - naik(p, 0.66, 1.0))       # lepas & ikut gerak
    P.telapak('Left', (0, -0.16 * (a * 0.4 + b), 0.03 * math.sin(math.pi * naik(p, 0.3, 0.5))), 0, rad(6))
    P.telapak('Right', (-0.01, 0.07 * a, 0.075 * b), rad(26 * b), rad(-14))
    P.pinggul((0.0, 0.05 * a - 0.10 * b, -0.025 - 0.035 * b), ('X', rad(-6 * a + 14 * b)), ('Z', rad(-24 * a + 20 * b)))
    P.fk('Spine', ('X', rad(-4 * a + 9 * b)), ('Z', rad(-12 * a + 12 * b)))
    P.fk('Spine1', ('X', rad(-5 * a + 9 * b)), ('Z', rad(-14 * a + 14 * b)))
    P.fk('Neck', ('Z', rad(18 * a - 10 * b)), ('X', rad(-3)))
    P.fk('Head', ('Z', rad(20 * a - 12 * b)))
    lengan(P, 'Right', -1, turun=lerp(lerp(37, -42, a), -8, b), ayun=24 * a - 118 * b, tekuk=lerp(lerp(20, 108, a), 12, b), putar=-30 * a)
    lengan(P, 'Left', 1, turun=lerp(lerp(37, 14, a), 42, b), ayun=-44 * a + 28 * b, tekuk=lerp(lerp(14, 34, a), 30, b), masuk=12 * a)


def rebah(P, p):
    """Lutut tertekuk lalu rebah ke belakang; pose akhir terlentang. Telapak tetap menapak selama lutut tertekuk (IK),
    lalu kaki terjulur saat badan mendarat. Lengan diatur pemanggil."""
    P.ik(1 - naik(p, 0.6, 0.92))
    a, b, c = naik(p, 0.0, 0.38), naik(p, 0.22, 0.86), naik(p, 0.8, 1.0)
    lipat = math.sin(math.pi * naik(p, 0.0, 0.9))            # tekukan lutut: naik lalu lurus lagi saat terbaring
    P.pinggul((0.02 * a, 0.10 * a + 0.26 * b, -0.16 * a - 0.645 * b + 0.01 * math.sin(math.pi * c)), ('X', rad(-10 * a - 79 * b)), ('Z', rad(6 * b)))
    P.fk('Spine', ('X', rad(-8 * a + 6 * b)))
    P.fk('Spine1', ('X', rad(-12 * a + 10 * b)), ('Z', rad(-5 * b)))
    P.fk('Neck', ('X', rad(-18 * a + 13 * b)))
    P.fk('Head', ('X', rad(-14 * a + 9 * b)), ('Z', rad(16 * b)))
    for s, k in SISI:
        P.fk(s + 'UpLeg', ('X', rad(-34 * lipat - (7 if k > 0 else 2) * b)), ('Y', rad(k * 7 * b)))
        P.fk(s + 'Leg', ('X', rad(62 * lipat + (16 if k > 0 else 5) * b)))
        P.fk(s + 'Foot', ('X', rad(24 * b)))
    return a, b


def mati(P, p):
    a, b = rebah(P, p)
    for s, k in SISI:
        lengan(P, s, k, turun=lerp(37, -18 if k > 0 else 6, naik(p, 0.05, 0.7)), ayun=-36 * math.sin(math.pi * a) - (5 if k > 0 else 9) * b, tekuk=lerp(16, 42 if k > 0 else 20, b))


# ---------------------------------------------------------------- gerak: prajurit bertombak & berperisai
# Tombak menempel di tangan kanan sepanjang sumbu depan-belakang pose istirahat (mata tombak ke depan): tanpa putaran
# tangan tombak mendatar ke depan. Perisai menempel di lengan bawah kiri, menghadap sisi punggung lengan.
TEGAK = Quaternion(Z, rad(45)) @ Quaternion(X, rad(-90))    # tangan kanan: tombak tegak, mata di atas, tangan menghadap depan
DATAR = Quaternion(Y, rad(-45))                             # tangan kanan: tombak mendatar ke depan, tangan menghadap bawah
GENGGAM = 0.86                                              # jarak pangkal tombak dari genggaman (m)


def perisai(P, maju=0.0, hadap=50, tekuk=80, turun=38):
    """Lengan kiri memegang perisai di depan badan; hadap = puntir lengan atas (0 = perisai di sisi, 90 = lurus ke depan)."""
    lengan(P, 'Left', 1, turun=turun, ayun=-12 - maju, tekuk=tekuk, putar=hadap)


def siaga(P, p):
    """Berdiri siaga: tombak tegak bertumpu di tanah, perisai di depan-kiri badan."""
    s1, s2 = math.sin(2 * math.pi * p), math.sin(4 * math.pi * p + 0.7)
    P.telapak('Left', (0.01, -0.05, 0), 0, rad(6))
    P.telapak('Right', (-0.02, 0.05, 0), 0, rad(-14))
    P.pinggul((0.004 * s1, 0.0, -0.018), ('X', rad(1.5)), ('Z', rad(-6)))
    P.fk('Spine', ('X', rad(1.0 + 0.5 * s1)), ('Z', rad(2)))
    P.fk('Spine1', ('X', rad(-1.2 * s1)), ('Z', rad(2)))
    P.fk('Neck', ('X', rad(-2)), ('Z', rad(2)))
    P.fk('Head', ('Z', rad(6 * s1 + 2 * s2)), ('X', rad(1.2 * s2)))
    perisai(P, hadap=48 + 2 * s1, tekuk=78)
    P.tangan('Right', genggam=(-0.31, -0.17, GENGGAM + 0.004), arah=Quaternion(X, rad(1.5 * s2)) @ TEGAK)


def baris(P, p):
    """Berjalan: tombak tegak sedikit condong ke depan, perisai di sisi depan."""
    c = langkah(P, p)
    naik_turun = -0.05 - 0.017 * math.cos(4 * math.pi * (p - 0.05))
    perisai(P, maju=3 * c, hadap=40, tekuk=76 + 3 * c)
    P.tangan('Right', genggam=(-0.31, -0.19 - 0.015 * c, GENGGAM + 0.13 + naik_turun), arah=Quaternion(X, rad(7 + 2 * c)) @ TEGAK)


def serbu(P, p):
    """Lari membawa tombak tegak dan perisai rapat di depan badan."""
    a = derap(P, p)
    perisai(P, maju=6 + 5 * a, hadap=44, tekuk=88)
    P.tangan('Right', genggam=(-0.30, -0.26 - 0.03 * a, GENGGAM + 0.20 - 0.07 - 0.03 * math.cos(4 * math.pi * (p - 0.17))), arah=Quaternion(X, rad(13 + 3 * a)) @ TEGAK)


def tusuk(P, p):
    """Menusuk: tombak diturunkan sambil ditarik ke belakang, lalu ditusukkan ke depan dengan langkah kaki kiri."""
    def serang(P):
        a = naik(p, 0.0, 0.30)                               # ancang-ancang: tombak turun mendatar, ditarik ke belakang
        b = naik(p, 0.30, 0.44)                              # tusukan
        P.telapak('Left', (0.01, -0.05 - 0.20 * b, 0.035 * math.sin(math.pi * b)), 0, rad(6))
        P.telapak('Right', (-0.02, 0.05 + 0.04 * a, 0.068 * b), rad(22 * b), rad(-18))
        P.pinggul((0, 0.04 * a - 0.17 * b, -0.03 - 0.045 * b), ('X', rad(-3 * a + 13 * b)), ('Z', rad(-16 * a + 26 * b)))
        P.fk('Spine', ('X', rad(-2 * a + 7 * b)), ('Z', rad(-8 * a + 12 * b)))
        P.fk('Spine1', ('X', rad(-2 * a + 6 * b)), ('Z', rad(-8 * a + 12 * b)))
        P.fk('Neck', ('Z', rad(12 * a - 14 * b)), ('X', rad(-4 * b)))
        P.fk('Head', ('Z', rad(12 * a - 14 * b)), ('X', rad(-4 * b)))
        perisai(P, maju=8 * b, hadap=62, tekuk=84)
        tarik, tusukan = Vector((-0.27, 0.10, 1.06)), Vector((-0.15, -0.70, 1.10))
        P.tangan('Right', genggam=Vector((-0.31, -0.17, GENGGAM + 0.004)).lerp(tarik, a).lerp(tusukan, b), arah=TEGAK.slerp(DATAR, naik(p, 0.0, 0.26)),
                 siku=P.kepala['RightArm'] + Vector((-0.35, 0.6, -0.2)))
    P.campur(serang, lambda P: siaga(P, 0.0), naik(p, 0.58, 1.0))


def gugur(P, p):
    """Rebah ke belakang: perisai tetap di depan dada, tombak tergeletak di samping badan."""
    def jatuh(P):
        a, b = rebah(P, p)
        perisai(P, maju=14 * b, hadap=62, tekuk=92, turun=38 - 10 * b)
        lengan(P, 'Right', -1, turun=lerp(30, 4, b), ayun=-30 * math.sin(math.pi * a) - 8 * b, tekuk=lerp(30, 18, b))
        P.tangan('Right', arah=TEGAK.slerp(Quaternion(Z, rad(-30)) @ Quaternion(Y, rad(45)), naik(p, 0.1, 0.8)))
    P.campur(lambda P: siaga(P, 0.0), jatuh, naik(p, 0.0, 0.2))


# ---------------------------------------------------------------- pratinjau gerak

def lembar(P, aksi, berkas, n=6, arah=(0.7, -1, 0.35), pusat=(0, 0, 0.88), jarak=4.3, ukuran=(260, 330)):
    """Lembar kontak: n frame merata dari satu aksi, berjajar dalam satu gambar (memakai kamera & cahaya adegan)."""
    sc = bpy.context.scene
    kam, arah = sc.camera, Vector(arah).normalized()
    kam.data.type, kam.data.lens = 'PERSP', 70
    kam.location = Vector(pusat) + arah * jarak
    kam.rotation_euler = (-arah).to_track_quat('-Z', 'Y').to_euler()
    lama = (sc.render.resolution_x, sc.render.resolution_y, sc.render.filepath)
    sc.render.resolution_x, sc.render.resolution_y = ukuran
    P.pasang(aksi)
    akhir, petak = int(round(aksi.frame_range[1])), []
    for i in range(n):
        sc.frame_set(round(akhir * i / (n - 1)) if n > 1 else 0)
        sc.render.filepath = berkas + '.tmp%d.png' % i
        bpy.ops.render.render(write_still=True)
        g = bpy.data.images.load(sc.render.filepath)
        px = np.empty(ukuran[0] * ukuran[1] * 4, np.float32)
        g.pixels.foreach_get(px)
        petak.append(px.reshape(ukuran[1], ukuran[0], 4))
        bpy.data.images.remove(g)
        os.remove(sc.render.filepath)
    semua = np.concatenate(petak, axis=1)
    hasil = bpy.data.images.new('lembar', ukuran[0] * n, ukuran[1])
    hasil.pixels.foreach_set(semua.ravel())
    hasil.filepath_raw, hasil.file_format = berkas, 'PNG'
    hasil.save()
    bpy.data.images.remove(hasil)
    sc.render.resolution_x, sc.render.resolution_y, sc.render.filepath = lama
    P.diam()
