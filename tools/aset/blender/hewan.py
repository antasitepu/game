# Pustaka hewan berkaki empat (dipakai kuda.py untuk unit berkuda, rusa.py dan babi.py untuk hewan liar):
#   sendi(B), kaki(B)   kerangka 19 tulang berawalan B['pre'] dan rantai IK keempat kakinya untuk Peraga
#   diam, jalan, lari, rebah, makan, seruduk   gerak; tungkai() membangun keempat kaki dan kukunya
# B ("bentuk") = kamus ukuran satu jenis hewan:
#   pre         awalan nama tulang ('Horse', 'Beast')
#   u           skala gerak terhadap kuda (1,0 = kuda): ayunan badan, angkat kuku, jarak kecil lain dikali u
#   tulang      {'Root' | 'Spine' | 'Chest' | 'Hip' | 'Neck' | 'Head' | 'Tail': (pangkal, ujung)}
#   x_depan, x_belakang   jarak kaki dari garis tengah
#   depan, belakang       empat titik (depan-belakang, tinggi) tiap kaki: siku/lutut atas, lutut/tumit, pergelangan, ujung kuku
#   jalan, lari           (bagian putaran saat menapak, setengah langkah, angkat kuku depan, angkat kuku belakang)
#   rebah       tinggi tulang akar saat hewan terbaring miring
#   makan       (tunduk leher, putar kepala, condong badan) dalam derajat dan bukaan kaki depan (m), untuk klip makan
# Koordinat seperti manusia.py: meter, Z ke atas, depan = −Y. Tulang kuku = ruas ketiga tiap kaki (…Front/HindL/R3).
import bmesh, math
from mathutils import Vector
from manusia import rad, halus, naik, lerp, tabung, SISI


def sendi(B):
    pre, t = B['pre'], B['tulang']
    T = [(pre + 'Root', None, *t['Root']), (pre + 'Spine', pre + 'Root', *t['Spine']), (pre + 'Chest', pre + 'Spine', *t['Chest']), (pre + 'Hip', pre + 'Spine', *t['Hip']),
         (pre + 'Neck', pre + 'Chest', *t['Neck']), (pre + 'Head', pre + 'Neck', *t['Head']), (pre + 'Tail', pre + 'Hip', *t['Tail'])]
    for s, k in SISI:
        for nama, induk, x, titik in ((pre + 'Front', pre + 'Chest', k * B['x_depan'], B['depan']), (pre + 'Hind', pre + 'Hip', k * B['x_belakang'], B['belakang'])):
            for i in range(3):
                T.append((nama + s[0] + str(i + 1), nama + s[0] + str(i) if i else induk, (x, *titik[i]), (x, *titik[i + 1])))
    return T


def kaki(B):
    """Rantai IK keempat kaki untuk Peraga (kunci FL, FR, HL, HR): lutut depan menekuk ke depan, tumit belakang ke belakang."""
    pre = B['pre']
    return {'FL': (pre + 'FrontL2', pre + 'FrontL3', (0, -0.8, 0)), 'FR': (pre + 'FrontR2', pre + 'FrontR3', (0, -0.8, 0)),
            'HL': (pre + 'HindL2', pre + 'HindL3', (0, 0.8, 0)), 'HR': (pre + 'HindR2', pre + 'HindR3', (0, 0.8, 0))}


def tungkai(T, B, bulu, kuku, depan, belakang, kuku_r, voxel=0.006, segitiga=200):
    """Empat kaki dan kukunya. depan/belakang: cincin (depan-belakang, tinggi, jari samping, jari depan-belakang) dari atas ke
    bawah; kuku_r: (jari atas, jari bawah, tinggi kuku). Nama bagian: kaki_depanL, kuku_depanL, kaki_belakangR, …"""
    for s, k in SISI:
        for nama, x, cincin, tulang in (('depan', k * B['x_depan'], depan, 'Front'), ('belakang', k * B['x_belakang'], belakang, 'Hind')):
            bm = bmesh.new()
            tabung(bm, [((x, y, z), rx, ry) for y, z, rx, ry in cincin], seg=10)
            T.tambah('kaki_' + nama + s[0], bm, bulu, lebur=(voxel, segitiga, 0.0, 3))
            y, (ra, rb, t) = cincin[-1][0], kuku_r
            bm = bmesh.new()
            tabung(bm, [((x, y + 0.1 * ra, t), ra, ra * 1.1), ((x, y - 0.55 * ra, 0.0), rb, rb * 1.1)], seg=8)
            T.tambah('kuku_' + nama + s[0], bm, kuku, kaku=B['pre'] + tulang + s[0] + '3')


# ---------------------------------------------------------------- gerak

def _akar(P, B, geser):
    P.pb[B['pre'] + 'Root'].location = P.rq[B['pre'] + 'Root'].inverted() @ Vector(geser)


def tapak(q, lama, setengah, angkat, u=1.0):
    """Lintasan satu kuku di tempat: fase q 0..1; menapak selama `lama` (mundur dari −setengah ke +setengah), lalu mengayun."""
    if q < lama:
        t = q / lama
        lepas = max(0.0, (t - 0.75) / 0.25)
        return -setengah + 2 * setengah * t, 0.025 * u * lepas, rad(28) * lepas
    t = (q - lama) / (1 - lama)
    e = halus(t)
    return setengah - 2 * setengah * e, 0.025 * u * (1 - t) + angkat * math.sin(math.pi * t ** 0.8), rad(lerp(28, -6, e) + 34 * math.sin(math.pi * t))


def diam(P, p, B):
    """Berdiri: napas, kepala mengangguk pelan, ekor mengibas, satu kaki belakang diistirahatkan di ujung kuku."""
    pre, u = B['pre'], B['u']
    s1, s2 = math.sin(2 * math.pi * p), math.sin(4 * math.pi * p + 0.6)
    P.telapak('HR', (0.01 * u, 0.03 * u, 0.045 * u), rad(32))
    _akar(P, B, (0.012 * u, 0, (-0.008 + 0.004 * s1) * u))
    P.fk(pre + 'Hip', ('Y', rad(-2.5)))
    P.fk(pre + 'Neck', ('X', rad(5 + 3 * s1)))
    P.fk(pre + 'Head', ('X', rad(-4 - 2 * s1 + 1.5 * s2)), ('Z', rad(4 * s2)))
    P.fk(pre + 'Tail', ('X', rad(-4)), ('Z', rad(14 * s2)))


def jalan(P, p, B):
    """Jalan empat ketukan (kiri belakang, kiri depan, kanan belakang, kanan depan). Jarak satu putaran tanpa selip =
    2 × setengah langkah ÷ bagian menapak."""
    pre, u = B['pre'], B['u']
    lama, setengah, angkat_d, angkat_b = B['jalan']
    for s, fase in (('HL', 0.0), ('FL', 0.25), ('HR', 0.5), ('FR', 0.75)):
        y, z, jungkit = tapak((p + 1 - fase) % 1.0, lama, setengah, angkat_d if s[0] == 'F' else angkat_b, u)
        P.telapak(s, (0, y, z), jungkit)
    c2, s2 = math.cos(4 * math.pi * p), math.sin(4 * math.pi * p)
    _akar(P, B, (0.012 * u * math.sin(2 * math.pi * p), 0, (-0.035 + 0.012 * c2) * u))
    P.fk(pre + 'Spine', ('X', rad(0.8 * s2)))
    P.fk(pre + 'Hip', ('Z', rad(3 * math.sin(2 * math.pi * p))), ('Y', rad(2.5 * math.cos(2 * math.pi * p))))
    P.fk(pre + 'Chest', ('Z', rad(-2.5 * math.sin(2 * math.pi * p + 1.2))))
    P.fk(pre + 'Neck', ('X', rad(6 + 4 * c2)))
    P.fk(pre + 'Head', ('X', rad(-5 - 3 * c2)))
    P.fk(pre + 'Tail', ('X', rad(-6)), ('Z', rad(9 * math.sin(2 * math.pi * p))))
    return c2


def lari(P, p, B):
    """Derap cepat (galop) dengan saat melayang: kaki belakang mendarat dulu, lalu kaki depan."""
    pre, u = B['pre'], B['u']
    lama, setengah, angkat_d, angkat_b = B['lari']
    for s, fase in (('HL', 0.0), ('HR', 0.10), ('FL', 0.36), ('FR', 0.46)):
        y, z, jungkit = tapak((p + 1 - fase) % 1.0, lama, setengah, angkat_d if s[0] == 'F' else angkat_b, u)
        P.telapak(s, (0, y - (0.05 * u if s[0] == 'H' else -0.04 * u), z), jungkit)
    a = 2 * math.pi * (p - 0.10)
    angguk = -7 * math.cos(a)                                # hidung naik saat kaki belakang menapak, turun saat kaki depan menapak
    _akar(P, B, (0, 0, (-0.10 + 0.07 * math.sin(2 * math.pi * (p - 0.55))) * u))
    P.fk(pre + 'Root', ('X', rad(angguk)))
    P.fk(pre + 'Hip', ('X', rad(-5 * math.cos(a))))
    P.fk(pre + 'Chest', ('X', rad(4 * math.cos(a))))
    P.fk(pre + 'Neck', ('X', rad(16 - 0.8 * angguk + 5 * math.sin(a))))
    P.fk(pre + 'Head', ('X', rad(-14 + 4 * math.cos(a))))
    P.fk(pre + 'Tail', ('X', rad(B.get('ekor_lari', 40) + 10 * math.sin(a))))      # ekor terangkat ke belakang
    return angguk


def rebah(P, p, B):
    """Kaki tertekuk lalu hewan rebah ke sisi kanannya, tetap di atas titik asalnya; kuku menapak (IK) selama berlutut, lalu
    kaki terlipat di bawah badan. Hasil: (tekuk, guling)."""
    pre, u = B['pre'], B['u']
    a, b = naik(p, 0.0, 0.40), naik(p, 0.25, 0.85)
    P.ik(1 - naik(p, 0.22, 0.46))
    lipat = naik(p, 0.05, 0.42) * (1 - 0.35 * naik(p, 0.8, 1.0))      # lipatan kaki mengikuti turunnya badan
    turun = B['tulang']['Root'][0][2] - B['rebah']
    _akar(P, B, (-0.10 * u * b, 0, -(0.44 * a + 0.56 * b) * turun))
    P.fk(pre + 'Root', ('Y', rad(-86 * b)), ('X', rad(4 * a)))
    P.fk(pre + 'Neck', ('X', rad(-14 * a + 30 * b)), ('Z', rad(-10 * b)))
    P.fk(pre + 'Head', ('X', rad(10 * a - 20 * b)))
    P.fk(pre + 'Tail', ('X', rad(-20 * b)))
    for s, _ in SISI:
        P.fk(pre + 'Front' + s[0] + '1', ('X', rad(-72 * lipat)))
        P.fk(pre + 'Front' + s[0] + '2', ('X', rad(138 * lipat)))
        P.fk(pre + 'Hind' + s[0] + '1', ('X', rad(52 * lipat)))
        P.fk(pre + 'Hind' + s[0] + '2', ('X', rad(-112 * lipat)))
    return a, b


def mati(P, p, B):
    """Dari sikap diam lalu rebah miring di tempat; pose akhir = bangkai."""
    P.campur(lambda P: diam(P, 0.0, B), lambda P: rebah(P, p, B), naik(p, 0.0, 0.15))


def makan(P, p, B):
    """Merumput atau mengendus tanah (berulang mulus): kaki depan dibuka depan-belakang sehingga dada turun tanpa lutut
    menekuk, leher merunduk, moncong dekat tanah, kepala bergerak kecil."""
    pre, u = B['pre'], B['u']
    leher, kepala, condong, buka = B['makan']
    s1, s2 = math.sin(2 * math.pi * p), math.sin(4 * math.pi * p + 0.6)
    P.telapak('FL', (0, -buka, 0))
    P.telapak('FR', (0, 0.8 * buka, 0))
    P.fk(pre + 'Root', ('X', rad(condong)))
    P.fk(pre + 'Chest', ('X', rad(0.6 * condong)))
    P.fk(pre + 'Neck', ('X', rad(leher + 4 * s1)))
    P.fk(pre + 'Head', ('X', rad(kepala + 6 * s2)), ('Z', rad(5 * s1)))
    P.fk(pre + 'Tail', ('X', rad(-4)), ('Z', rad(16 * s2)))


SERUDUK = 0.46                                              # fase klip seruduk saat sentakan kepala mencapai puncaknya


def seruduk(P, p, B):
    """Menyeruduk (sekali): kepala merunduk sambil badan ditarik ke belakang, lalu badan menerjang dan kepala disentakkan
    ke depan-atas (puncak di fase SERUDUK); awal dan akhir = sikap diam."""
    pre, u = B['pre'], B['u']
    a = naik(p, 0.0, 0.32) * (1 - naik(p, SERUDUK, 0.72))    # ancang-ancang
    k = naik(p, 0.32, SERUDUK) * (1 - naik(p, 0.62, 1.0))    # sentakan
    diam(P, 0.0, B)
    _akar(P, B, (0.012 * u, (0.10 * a - 0.38 * k) * u, (-0.008 - 0.07 * a) * u))
    P.fk(pre + 'Root', ('X', rad(7 * a - 9 * k)))
    P.fk(pre + 'Neck', ('X', rad(5 + 20 * a - 30 * k)))
    P.fk(pre + 'Head', ('X', rad(-4 + 16 * a - 26 * k)))
    P.fk(pre + 'Tail', ('X', rad(-4 + 50 * k)))
