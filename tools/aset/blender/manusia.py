# Kerangka, bobot, dan gerak manusia untuk unit buatan skrip (dipakai pekerja.py dan unit manusia berikutnya).
# Semua koordinat: meter, Z ke atas, depan = −Y, kiri tokoh = +X; kerangka tanpa skala/rotasi objek.
# Sudut rotasi tulang ditulis terhadap sumbu kerangka pada pose istirahat, relatif ke induknya:
#   X positif = mengayun ke belakang / menunduk ke depan untuk batang tubuh, Z positif = sisi kiri ke belakang.
import bpy, math, os
import numpy as np
from mathutils import Matrix, Quaternion, Vector, kdtree

X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
rad = math.radians
SISI = (('Left', 1), ('Right', -1))
halus = lambda t: t * t * (3 - 2 * t) if 0 < t < 1 else (0.0 if t <= 0 else 1.0)      # smoothstep
naik = lambda p, a, b: halus((p - a) / (b - a))                                          # 0 → 1 antara a dan b
lerp = lambda a, b, t: a + (b - a) * t


def sendi(bahu, turun=0.0, kaki_x=0.105):
    """Daftar tulang (nama, induk, pangkal, ujung). bahu: {k: (S, d)} = titik bahu & arah lengan per sisi (k = +1 kiri)."""
    g = Vector((0, 0, -turun))
    T = [('Hips', None, (0, 0, 0.95), (0, 0, 1.05)), ('Spine', 'Hips', (0, 0, 1.05), (0, 0, 1.17)), ('Spine1', 'Spine', (0, 0, 1.17), (0, 0, 1.30)),
         ('Neck', 'Spine1', (0, 0.006, 1.40), (0, 0, 1.49)), ('Head', 'Neck', (0, 0, 1.49), (0, 0, 1.70))]
    for s, k in SISI:
        S, d = bahu[k]
        x = k * kaki_x
        T += [(s + 'Shoulder', 'Spine1', (k * 0.035, 0, 1.345), S), (s + 'Arm', s + 'Shoulder', S, S + d * 0.285), (s + 'ForeArm', s + 'Arm', S + d * 0.285, S + d * 0.515),
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
    kosong = [v.index for v in me.vertices if not any(g.weight > 1e-4 for g in v.groups)]
    if len(kosong) == len(me.vertices):
        raise RuntimeError('bobot otomatis gagal untuk seluruh mesh')
    if kosong:                                               # pulau kecil yang tak terjangkau panas tulang: tiru verteks berbobot terdekat
        berbobot = [v for v in me.vertices if v.index not in set(kosong)]
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


class Peraga:
    """Pemeraga gerak: tulang diputar langsung (FK), kaki mengikuti sasaran telapak (IK); tiap frame direkam lalu
    ditulis jadi aksi berkunci per frame tanpa pengekang."""

    def __init__(self, arm, fps=30):
        self.arm, self.pb, self.fps, self.rekaman = arm, arm.pose.bones, fps, {}
        self.rq = {b.name: b.bone.matrix_local.to_quaternion() for b in self.pb}
        self.kepala = {b.name: b.bone.matrix_local.to_translation() for b in self.pb}
        sc = bpy.context.scene
        sc.render.fps = fps
        self.kaki, self.kendali = {}, []
        for s, k in SISI:
            t, p = bpy.data.objects.new(s + '_telapak', None), bpy.data.objects.new(s + '_lutut', None)
            for e in (t, p):
                sc.collection.objects.link(e)
                e.rotation_mode = 'QUATERNION'
                self.kendali.append(e)
            p.location = self.kepala[s + 'Leg'] + Vector((0, -0.8, 0))
            ik = self.pb[s + 'Leg'].constraints.new('IK')
            ik.target, ik.pole_target, ik.chain_count = t, p, 2
            cr = self.pb[s + 'Foot'].constraints.new('COPY_ROTATION')
            cr.target = t
            self.kaki[s] = (t, ik, cr)
        self.awal()
        for s, _ in SISI:                                    # sudut kutub: pilih yang membiarkan lutut di tempat istirahatnya
            ik, terbaik = self.kaki[s][1], None
            for a in (0, 90, 180, -90):
                ik.pole_angle = rad(a)
                bpy.context.view_layer.update()
                d = ((arm.matrix_world @ self.pb[s + 'Leg'].matrix).to_translation() - self.kepala[s + 'Leg']).length
                if terbaik is None or d < terbaik[0]:
                    terbaik = (d, a)
            ik.pole_angle = rad(terbaik[1])

    def awal(self):
        for b in self.pb:
            b.rotation_quaternion, b.location, b.scale = (1, 0, 0, 0), (0, 0, 0), (1, 1, 1)
        for s, _ in SISI:
            self.telapak(s)
        self.ik(1)

    def ik(self, pengaruh):
        for t, ik, cr in self.kaki.values():
            ik.influence = cr.influence = pengaruh

    def fk(self, nama, *putaran):
        """putaran: (sumbu, sudut) berurutan; sumbu 'X'/'Y'/'Z' atau Vector, di sumbu kerangka relatif ke induk."""
        q = Quaternion()
        for sumbu, sudut in putaran:
            q = Quaternion(sumbu if isinstance(sumbu, Vector) else {'X': X, 'Y': Y, 'Z': Z}[sumbu], sudut) @ q
        self.pb[nama].rotation_quaternion = self.rq[nama].inverted() @ q @ self.rq[nama]

    def pinggul(self, geser=(0, 0, 0), *putaran):
        self.pb['Hips'].location = self.rq['Hips'].inverted() @ Vector(geser)
        self.fk('Hips', *putaran)

    def telapak(self, s, geser=(0, 0, 0), jungkit=0.0, serong=0.0):
        """Sasaran pergelangan kaki (geser dari posisi istirahat); jungkit > 0 = tumit terangkat, serong = putar keluar."""
        t = self.kaki[s][0]
        t.location = self.kepala[s + 'Foot'] + Vector(geser)
        t.rotation_quaternion = Quaternion(Z, serong) @ Quaternion(X, jungkit) @ self.rq[s + 'Foot']

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
        self.diam(aksi)
        return aksi

    def diam(self, aksi=None):
        self.arm.animation_data.action = None
        for b in self.pb:
            b.rotation_quaternion, b.location = (1, 0, 0, 0), (0, 0, 0)

    def pasang(self, a):
        ad = self.arm.animation_data
        ad.action = a
        if bpy.app.version >= (4, 4, 0) and ad.action_slot is None and len(a.slots):
            ad.action_slot = a.slots[0]


# ---------------------------------------------------------------- gerak

def lengan(P, s, k, turun=38, ayun=0.0, tekuk=14, masuk=0.0, putar=0.0):
    """Lengan dari pose A: turun ke sisi badan (derajat), ayun (+ ke belakang), tekuk siku ke depan, masuk = menyilang ke tengah."""
    d = (P.kepala[s + 'ForeArm'] - P.kepala[s + 'Arm']).normalized()
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


def jalan(P, p, bawa=False, setengah=0.29):
    """Dua langkah per putaran, di tempat. Kaki kiri menapak di p = 0."""
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
    for s, k in SISI:
        a = k * c                                            # lengan berlawanan dengan kaki sesisi
        lengan(P, s, k, turun=38, ayun=22 * a + 2, tekuk=20 + 16 * max(0.0, -a) - 6 * max(0.0, a), putar=10)
    if bawa:
        lengan(P, 'Left', 1, turun=34, ayun=-38 + 2 * c, tekuk=118, masuk=6)
        P.fk('Spine1', ('X', rad(5)), ('Z', rad(5 * c)))


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


def mati(P, p):
    """Lutut tertekuk lalu rebah ke belakang; pose akhir terlentang. Telapak tetap menapak selama lutut tertekuk
    (IK), lalu kaki terjulur saat badan mendarat."""
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
        lengan(P, s, k, turun=lerp(37, -18 if k > 0 else 6, naik(p, 0.05, 0.7)), ayun=-36 * math.sin(math.pi * a) - (5 if k > 0 else 9) * b, tekuk=lerp(16, 42 if k > 0 else 20, b))


# ---------------------------------------------------------------- pratinjau

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
