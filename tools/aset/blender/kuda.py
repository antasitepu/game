# Kuda untuk unit berkuda (dipakai penunggang.py dan pemanah_kuda.py bersama manusia.py):
#   bangun(T, …)   menambahkan bagian-bagian kuda ke tokoh T (badan, kaki, kuku, surai, ekor, pelana, selimut pelana bertim)
#   sendi()        kerangka kuda, 19 tulang berawalan Horse; tulang Hips penunggang menjadi anak HorseSpine
#   KAKI           rantai IK keempat kaki untuk Peraga (kunci FL, FR, HL, HR)
#   diam, jalan, lari, rebah   gerak kuda;   duduk   sikap penunggang di pelana
# Koordinat seperti manusia.py: meter, Z ke atas, depan = −Y. Tinggi gumba ±1,5 m; pelana di (0, 0, 1,55).
import bmesh, math
from mathutils import Quaternion, Vector
from manusia import X, Y, Z, rad, halus, naik, lerp, tabung, elips, SISI

X_DEPAN, X_BELAKANG = 0.14, 0.15
DUDUK = Vector((0, 0.04, 0.70))                             # geser tokoh manusia berdiri → pinggul di atas pelana
# pangkal ruas kaki: (depan-belakang, tinggi) siku/lutut atas, lutut/tumit, pergelangan, ujung kuku
DEPAN = ((-0.41, 1.02), (-0.435, 0.52), (-0.42, 0.14), (-0.47, 0.02))
BELAKANG = ((0.50, 1.02), (0.62, 0.58), (0.56, 0.14), (0.51, 0.02))
KAKI = {'FL': ('HorseFrontL2', 'HorseFrontL3', (0, -0.8, 0)), 'FR': ('HorseFrontR2', 'HorseFrontR3', (0, -0.8, 0)),
        'HL': ('HorseHindL2', 'HorseHindL3', (0, 0.8, 0)), 'HR': ('HorseHindR2', 'HorseHindR3', (0, 0.8, 0))}
KELOMPOK = lambda bagian_manusia, bagian_kuda: [('Horse', bagian_kuda), ('', bagian_manusia)]


def sendi():
    T = [('HorseRoot', None, (0, 0.05, 1.20), (0, 0.05, 1.32)), ('HorseSpine', 'HorseRoot', (0, 0.05, 1.22), (0, -0.10, 1.22)),
         ('HorseChest', 'HorseSpine', (0, -0.10, 1.22), (0, -0.50, 1.26)), ('HorseHip', 'HorseSpine', (0, 0.15, 1.22), (0, 0.66, 1.26)),
         ('HorseNeck', 'HorseChest', (0, -0.46, 1.34), (0, -0.92, 1.88)), ('HorseHead', 'HorseNeck', (0, -0.92, 1.88), (0, -1.22, 1.54)),
         ('HorseTail', 'HorseHip', (0, 0.80, 1.20), (0, 0.92, 0.62))]
    for s, k in SISI:
        for nama, induk, x, titik in (('HorseFront', 'HorseChest', k * X_DEPAN, DEPAN), ('HorseHind', 'HorseHip', k * X_BELAKANG, BELAKANG)):
            for i in range(3):
                T.append((nama + s[0] + str(i + 1), nama + s[0] + str(i) if i else induk, (x, *titik[i]), (x, *titik[i + 1])))
    return T


def bangun(T, bulu, surai, kuku, pelana, selimut, mata):
    """Bagian kuda. Nama-nama bagiannya dikembalikan (untuk kelompok bobot dan pemanggangan terpisah)."""
    sebelum = len(T.bagian)
    leher, tegak = Vector((0, -0.50, 0.60)).normalized(), Vector((0, 0.60, 0.50)).normalized()
    pangkal = Vector((0, -0.44, 1.30))
    ubun = pangkal + leher * 0.76
    turun, muka = Vector((0, -0.62, -0.72)).normalized(), Vector((0, -0.72, 0.62)).normalized()
    bm = bmesh.new()
    tabung(bm, [((0, y, z), rx, rz) for y, z, rx, rz in ((-0.68, 1.18, 0.10, 0.15), (-0.56, 1.16, 0.21, 0.30), (-0.36, 1.15, 0.26, 0.35), (-0.05, 1.16, 0.28, 0.34),
                                                        (0.25, 1.18, 0.28, 0.32), (0.50, 1.22, 0.27, 0.30), (0.72, 1.21, 0.19, 0.23), (0.80, 1.18, 0.08, 0.10))], u=X, w=Z, seg=18)
    tabung(bm, [(pangkal + leher * d, rx, rt) for d, rx, rt in ((0.0, 0.16, 0.26), (0.25, 0.115, 0.185), (0.50, 0.090, 0.135), (0.74, 0.078, 0.105))], u=X, w=tegak, seg=14)
    tabung(bm, [(ubun + turun * d, rx, rt) for d, rx, rt in ((-0.04, 0.070, 0.085), (0.10, 0.082, 0.105), (0.26, 0.062, 0.078), (0.40, 0.050, 0.058), (0.47, 0.046, 0.050))], u=X, w=muka, seg=12)
    for k in (1, -1):
        elips(bm, (k * 0.16, -0.40, 1.05), (0.11, 0.18, 0.26))                                             # bahu
        elips(bm, (k * 0.17, 0.48, 1.08), (0.13, 0.22, 0.28))                                              # paha atas
        elips(bm, ubun + Vector((k * 0.045, 0.03, 0.075)), (0.018, 0.012, 0.050))                          # telinga
    T.tambah('kuda_badan', bm, bulu, lebur=(0.012, 1500, 0.0, 4))
    for s, k in SISI:
        for nama, x, cincin, tulang in (('kuda_depan', k * X_DEPAN, ((-0.41, 1.02, 0.085, 0.110), (-0.42, 0.78, 0.062, 0.078), (-0.432, 0.55, 0.048, 0.054), (-0.43, 0.49, 0.042, 0.045),
                                                                     (-0.42, 0.20, 0.033, 0.037), (-0.425, 0.14, 0.043, 0.047), (-0.45, 0.075, 0.038, 0.042)), 'HorseFront'),
                                        ('kuda_belakang', k * X_BELAKANG, ((0.50, 1.02, 0.095, 0.150), (0.56, 0.80, 0.068, 0.095), (0.615, 0.61, 0.048, 0.060), (0.615, 0.54, 0.040, 0.046),
                                                                           (0.57, 0.20, 0.033, 0.037), (0.56, 0.14, 0.043, 0.047), (0.535, 0.075, 0.038, 0.042)), 'HorseHind')):
            bm = bmesh.new()
            tabung(bm, [((x, y, z), rx, ry) for y, z, rx, ry in cincin], seg=10)
            T.tambah(nama + s[0], bm, bulu, lebur=(0.006, 200, 0.0, 3))
            y = cincin[-1][0]
            bm = bmesh.new()
            tabung(bm, [((x, y + 0.004, 0.085), 0.040, 0.044), ((x, y - 0.022, 0.0), 0.054, 0.060)], seg=8)
            T.tambah('kuku_' + nama[5:] + s[0], bm, kuku, kaku=tulang + s[0] + '3')
    bm = bmesh.new()
    tabung(bm, [(pangkal + leher * d + tegak * (t + 0.03), 0.018, 0.050) for d, t in ((-0.04, 0.24), (0.25, 0.185), (0.50, 0.135), (0.76, 0.10))], u=X, w=tegak, seg=6)      # surai
    tabung(bm, [(ubun + Vector((0, -0.03, 0.06)), 0.03, 0.02), (ubun + turun * 0.14 + muka * 0.11, 0.025, 0.012)], u=X, w=muka, seg=6)                                      # jambul dahi
    T.tambah('surai', bm, surai, kaku='HorseNeck')
    bm = bmesh.new()
    tabung(bm, [((0, 0.80, 1.22), 0.045, 0.045), ((0, 0.90, 1.05), 0.060, 0.055), ((0, 0.94, 0.80), 0.055, 0.050), ((0, 0.93, 0.58), 0.025, 0.025)], seg=8)
    T.tambah('ekor', bm, surai, kaku='HorseTail')
    bm = bmesh.new()
    for k in (1, -1):
        elips(bm, ubun + turun * 0.13 + X * (k * 0.076) + muka * 0.03, (0.012, 0.018, 0.016), seg=6, ring=4)
    T.tambah('mata_kuda', bm, mata, kaku='HorseHead')
    bm = bmesh.new()                                                                                       # selimut pelana (warna tim): punggung dan sisi, perut terbuka
    tabung(bm, [((0, y, z), rx, rz) for y, z, rx, rz in ((-0.28, 1.155, 0.287, 0.357), (0.0, 1.165, 0.294, 0.350), (0.30, 1.185, 0.294, 0.332))], u=X, w=Z, seg=18)
    for f in [f for f in bm.faces if len(f.verts) > 4 or f.calc_center_median().z < 1.0]:
        bm.faces.remove(f)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    T.tambah('selimut', bm, selimut, tim=True, kaku='HorseSpine')
    bm = bmesh.new()
    elips(bm, (0, 0.02, 1.51), (0.17, 0.25, 0.055), seg=10, ring=6)
    elips(bm, (0, -0.20, 1.545), (0.07, 0.05, 0.06), seg=8, ring=6)                                        # tanduk pelana depan
    elips(bm, (0, 0.24, 1.54), (0.13, 0.05, 0.06), seg=8, ring=6)                                          # sandaran belakang
    T.tambah('pelana', bm, pelana, kaku='HorseSpine')
    return [b['nama'] for b in T.bagian[sebelum:]]


# ---------------------------------------------------------------- gerak kuda

def tapak(q, lama, depan, belakang, angkat):
    """Lintasan satu kuku di tempat: fase q 0..1; menapak selama `lama` (mundur dari −depan ke +belakang), lalu mengayun."""
    if q < lama:
        u = q / lama
        lepas = max(0.0, (u - 0.75) / 0.25)
        return -depan + (depan + belakang) * u, 0.025 * lepas, rad(28) * lepas
    u = (q - lama) / (1 - lama)
    e = halus(u)
    return belakang - (depan + belakang) * e, 0.025 * (1 - u) + angkat * math.sin(math.pi * u ** 0.8), rad(lerp(28, -6, e) + 34 * math.sin(math.pi * u))


def diam(P, p):
    """Berdiri: napas, kepala mengangguk pelan, ekor mengibas, satu kaki belakang diistirahatkan di ujung kuku."""
    s1, s2 = math.sin(2 * math.pi * p), math.sin(4 * math.pi * p + 0.6)
    P.telapak('HR', (0.01, 0.03, 0.045), rad(32))
    P.pb['HorseRoot'].location = P.rq['HorseRoot'].inverted() @ Vector((0.012, 0, -0.008 + 0.004 * s1))
    P.fk('HorseHip', ('Y', rad(-2.5)))
    P.fk('HorseNeck', ('X', rad(5 + 3 * s1)))
    P.fk('HorseHead', ('X', rad(-4 - 2 * s1 + 1.5 * s2)), ('Z', rad(4 * s2)))
    P.fk('HorseTail', ('X', rad(-4)), ('Z', rad(14 * s2)))


def jalan(P, p):
    """Jalan empat ketukan (kiri belakang, kiri depan, kanan belakang, kanan depan): 1,13 m per putaran pada model."""
    for s, fase in (('HL', 0.0), ('FL', 0.25), ('HR', 0.5), ('FR', 0.75)):
        y, z, jungkit = tapak((p + 1 - fase) % 1.0, 0.62, 0.35, 0.35, 0.13 if s[0] == 'F' else 0.10)
        P.telapak(s, (0, y, z), jungkit)
    c2, s2 = math.cos(4 * math.pi * p), math.sin(4 * math.pi * p)
    P.pb['HorseRoot'].location = P.rq['HorseRoot'].inverted() @ Vector((0.012 * math.sin(2 * math.pi * p), 0, -0.035 + 0.012 * c2))
    P.fk('HorseSpine', ('X', rad(0.8 * s2)))
    P.fk('HorseHip', ('Z', rad(3 * math.sin(2 * math.pi * p))), ('Y', rad(2.5 * math.cos(2 * math.pi * p))))
    P.fk('HorseChest', ('Z', rad(-2.5 * math.sin(2 * math.pi * p + 1.2))))
    P.fk('HorseNeck', ('X', rad(6 + 4 * c2)))
    P.fk('HorseHead', ('X', rad(-5 - 3 * c2)))
    P.fk('HorseTail', ('X', rad(-6)), ('Z', rad(9 * math.sin(2 * math.pi * p))))
    return c2


def lari(P, p):
    """Derap cepat (galop) dengan saat melayang: kaki belakang mendarat dulu, lalu kaki depan; 3,6 m per putaran."""
    for s, fase in (('HL', 0.0), ('HR', 0.10), ('FL', 0.36), ('FR', 0.46)):
        y, z, jungkit = tapak((p + 1 - fase) % 1.0, 0.25, 0.45, 0.45, 0.36 if s[0] == 'F' else 0.30)
        P.telapak(s, (0, y - (0.05 if s[0] == 'H' else -0.04), z), jungkit)
    a = 2 * math.pi * (p - 0.10)
    angguk = -7 * math.cos(a)                                # hidung naik saat kaki belakang menapak, turun saat kaki depan menapak
    P.pb['HorseRoot'].location = P.rq['HorseRoot'].inverted() @ Vector((0, 0, -0.10 + 0.07 * math.sin(2 * math.pi * (p - 0.55))))
    P.fk('HorseRoot', ('X', rad(angguk)))
    P.fk('HorseHip', ('X', rad(-5 * math.cos(a))))
    P.fk('HorseChest', ('X', rad(4 * math.cos(a))))
    P.fk('HorseNeck', ('X', rad(16 - 0.8 * angguk + 5 * math.sin(a))))
    P.fk('HorseHead', ('X', rad(-14 + 4 * math.cos(a))))
    P.fk('HorseTail', ('X', rad(-48 + 10 * math.sin(a))))
    return angguk


def rebah(P, p):
    """Kaki tertekuk lalu kuda rebah ke sisi kanannya; kuku menapak (IK) selama berlutut, lalu kaki terlipat di bawah
    badan. Hasil: (tekuk, guling) untuk penunggangnya."""
    a, b = naik(p, 0.0, 0.40), naik(p, 0.25, 0.85)
    P.ik(1 - naik(p, 0.22, 0.46))
    lipat = naik(p, 0.05, 0.42) * (1 - 0.35 * naik(p, 0.8, 1.0))      # lipatan kaki mengikuti turunnya badan
    P.pb['HorseRoot'].location = P.rq['HorseRoot'].inverted() @ Vector((-0.10 * b, 0, -0.40 * a - 0.51 * b))
    P.fk('HorseRoot', ('Y', rad(-86 * b)), ('X', rad(4 * a)))
    P.fk('HorseNeck', ('X', rad(-14 * a + 30 * b)), ('Z', rad(-10 * b)))
    P.fk('HorseHead', ('X', rad(10 * a - 20 * b)))
    P.fk('HorseTail', ('X', rad(-20 * b)))
    for s, _ in SISI:
        P.fk('HorseFront' + s[0] + '1', ('X', rad(-72 * lipat)))
        P.fk('HorseFront' + s[0] + '2', ('X', rad(138 * lipat)))
        P.fk('HorseHind' + s[0] + '1', ('X', rad(52 * lipat)))
        P.fk('HorseHind' + s[0] + '2', ('X', rad(-112 * lipat)))
    return a, b


# ---------------------------------------------------------------- penunggang

def duduk(P, ayun=0.0, condong=0.0, kendali=True, terlempar=0.0):
    """Penunggang duduk di pelana: paha terbuka dan menekuk ke depan, betis turun di sisi kuda. ayun: naik-turun kecil
    mengikuti langkah; condong: badan condong ke depan (derajat). kendali: tangan kiri memegang tali kekang.
    terlempar: geser ke sisi kiri kuda (m); saat kuda rebah ke kanan, arah itu menjadi ke atas."""
    P.pinggul((terlempar, 0, ayun), ('X', rad(4 + condong)))
    P.fk('Spine', ('X', rad(2 + 0.3 * condong)))
    P.fk('Spine1', ('X', rad(-1 + 0.2 * condong)))
    P.fk('Neck', ('X', rad(-4 - 0.8 * condong)))
    P.fk('Head', ('X', rad(-2 - 0.6 * condong)))
    for s, k in SISI:
        P.fk(s + 'UpLeg', ('Y', rad(-k * 30)), ('X', rad(-58)))
        P.fk(s + 'Leg', ('X', rad(84)), ('Y', rad(k * 10)))
        P.fk(s + 'Foot', ('X', rad(-24)))
    if kendali:
        from manusia import lengan
        lengan(P, 'Left', 1, turun=36, ayun=-30, tekuk=78, masuk=14, putar=20)
