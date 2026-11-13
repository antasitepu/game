# Pelontar Batu buatan skrip: mesin pelontar beroda (rangka balok, tiang dan palang penahan berbantalan, lengan bermangkuk,
# gulungan tali puntir, tali penarik, peti batu, gagang dorong, panji) dengan satu juru lontar di belakangnya. Mesin dan
# juru lontar satu mesh dan satu kerangka (28 tulang: 7 tulang mesin berawalan Mesin + 21 tulang manusia di bawah MesinRoot).
# Bantalan palang, panji, dan baju juru lontar putih gading (diwarnai tim oleh game).
# Klip: diam, jalan/lari (mendorong; satu putaran = satu putaran roda = 2,07 m), serang (4,2 s: batu lepas pada 0,2 s, lalu
# lengan ditarik turun dan batu baru dimuat), mati (rangka ambruk, poros depan dan lengan terlepas, juru lontar rebah).
# Hasil: satu GLB berkerangka untuk `node tools/aset/olah.mjs pelontar`: <folder-keluaran>.glb atau --glb, serta pratinjau PNG.
#
#   blender --background --factory-startup --python tools/aset/blender/pelontar.py -- <folder-keluaran> [--tekstur <folder>] [--glb <file>]
# Baris terakhir keluaran: PELONTAR {json ringkasan}.
import bmesh, math, os, sys
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manusia as mn
from manusia import X, Y, Z, rad, naik, lerp, halus

ARG = sys.argv[sys.argv.index('--') + 1:]
opsi = lambda n, bawaan=None: ARG[ARG.index(n) + 1] if n in ARG else bawaan
T = mn.Tokoh('pelontar', ARG[0], opsi('--tekstur'))
linen, goni, papan = T.tekstur('rough_linen'), T.tekstur('hessian_230'), T.tekstur('weathered_brown_planks')
kulit = T.bahan('kulit', (0.66, 0.47, 0.34))
samak = T.bahan('samak', (0.27, 0.18, 0.12), kasar=0.7)
besi = T.bahan('besi', (0.33, 0.33, 0.34), kasar=0.5, logam=1.0)
gading = lambda nama: T.kain(nama, linen, 5.0, (0.72, 0.68, 0.60), (0.94, 0.92, 0.86))        # kain putih gading: dikalikan warna tim

# ---------------------------------------------------------------- juru lontar
T.kepala(kulit, T.bahan('rambut', (0.07, 0.055, 0.05)), T.bahan('muka', (0.16, 0.09, 0.07)))
T.lengan(kulit)
T.kaki(samak, nama='sepatu', tebal=0.007, atas=0.44)
T.celana(T.kain('celana', goni, 3.0, (0.17, 0.14, 0.11), (0.38, 0.31, 0.24)), bawah=0.42, segitiga=380)
T.tunik(gading('tunik'), segitiga=640)
T.rompi(samak, bawah=0.90, segitiga=320)                                                      # celemek kulit di atas baju
T.sabuk(T.kain('sabuk', linen, 5.0, (0.16, 0.12, 0.10), (0.34, 0.26, 0.20)), juntai=False)
bm = bmesh.new()                                                                               # kopiah kain (warna tim)
mn.bubut(bm, [(0.101, 1.636), (0.106, 1.664), (0.092, 1.722), (0.050, 1.760), (0.004, 1.768)], 12, sumbu=(X * 0.92, Y * 1.05, Z))
T.tambah('kopiah', bm, gading('kopiah'), tim=True, kaku='Head')
manusia = [b['nama'] for b in T.bagian]

# ---------------------------------------------------------------- tata letak (meter; depan = −Y)
PUSAT = Vector((0, -0.40, 0))                               # tengah mesin; juru lontar di belakangnya, gabungannya berpusat di titik asal
m = lambda x, y, z: Vector((x, y, z)) + PUSAT
ORANG = Vector((0, 1.40, 0))                                # tempat berdiri juru lontar
R_RODA, Y_POROS, X_RODA = 0.33, 0.62, 0.61
POROS = m(0, -0.25, 0.64)                                   # poros lengan (di tengah gulungan tali puntir)
T0, T1 = 0.16, 1.61                                         # sudut lengan terhadap arah belakang-mendatar: rebah (termuat) dan menumbuk bantalan
D_MANGKUK = 1.20


def di_lengan(d, tegak=0.0, sudut=T0):
    """Titik pada lengan: d meter dari poros sepanjang lengan, `tegak` meter tegak lurus ke sisi atasnya."""
    c, s = math.cos(sudut), math.sin(sudut)
    return POROS + Vector((0, d * c - tegak * s, d * s + tegak * c))


TROMOL = m(0, 0.95, 0.72)                                   # puncak tromol tali di balok belakang
KAIT = lambda sudut=T0: di_lengan(1.02, -0.05, sudut)       # kait tali penarik di sisi bawah lengan
BATU = di_lengan(D_MANGKUK, 0.145)                          # pusat batu di dalam mangkuk
GAGANG = {k: m(k * 0.30, 1.57, 1.02) for k in (1, -1)}      # ujung gagang dorong (k = +1 kiri)
PETI = m(0, 1.17, 0.38)                                     # alas peti batu, di bawah gagang
T.pindah(ORANG)


def balok(bm, a, b, lebar, tebal, atas=Z):
    """Balok persegi dari a ke b: lebar tegak lurus arah balok dan `atas`, tebal ke arah `atas`."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    u = d.cross(Vector(atas)).normalized()
    M = Matrix((u, d, u.cross(d))).transposed().to_4x4()
    M.translation = (a + b) / 2
    bmesh.ops.create_cube(bm, size=1.0, matrix=M @ Matrix.Diagonal((lebar, (b - a).length, tebal, 1)))


def silinder(bm, a, b, r, seg=10, r2=None):
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    u = d.orthogonal().normalized()
    mn.tabung(bm, [(a, r, r), (b, r2 or r, r2 or r)], u=u, w=d.cross(u), seg=seg)


def bongkah(bm, pusat, r, benih):
    """Batu: bola bersegi yang dipenyokkan (acak tetap dari `benih`)."""
    for i, v in enumerate(bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r, matrix=Matrix.Translation(pusat) @ Matrix.Diagonal((1.0, 0.92, 0.84, 1)))['verts']):
        v.co += (v.co - Vector(pusat)) * (0.22 * math.sin(12.9898 * (i + 1) * (benih + 1)) % 0.16 - 0.06)


kayu = T.kain('kayu', papan, 1.3, (0.22, 0.15, 0.09), (0.60, 0.45, 0.29), kasar=0.85)
kayu_tua = T.kain('kayu_tua', papan, 1.3, (0.14, 0.10, 0.06), (0.40, 0.29, 0.18), kasar=0.9)
tali = T.kain('tali', goni, 14.0, (0.34, 0.27, 0.17), (0.72, 0.62, 0.44), kasar=0.95)
anyaman = T.kain('anyaman', goni, 7.0, (0.30, 0.22, 0.12), (0.62, 0.50, 0.31), kasar=0.9)
batu = T.bahan('batu', (0.52, 0.50, 0.46), kasar=0.95)
awal_mesin = len(T.bagian)

# ---------------------------------------------------------------- rangka
bm = bmesh.new()
for k in (1, -1):
    balok(bm, m(k * 0.41, -1.03, 0.51), m(k * 0.41, 1.03, 0.51), 0.16, 0.18)                               # balok samping
    balok(bm, m(k * 0.36, -0.45, 0.60), m(k * 0.36, -0.52, 1.60), 0.13, 0.13, atas=Y)                      # tiang penahan
    balok(bm, m(k * 0.41, 0.98, 0.56), GAGANG[k] + Vector((0, -0.10, -0.045)), 0.07, 0.07)                 # gagang dorong, ujungnya pegangan bulat
    silinder(bm, GAGANG[k] + Vector((0, -0.13, -0.03)), GAGANG[k] + Vector((0, 0.09, -0.03)), 0.026, 6)
    balok(bm, m(k * 0.30, 0.88, 0.60), m(k * 0.30, 1.02, 0.60), 0.05, 0.14)                                # bantalan tromol
for y in (-0.95, -0.45, 0.40, 0.95):
    balok(bm, m(-0.49, y, 0.51), m(0.49, y, 0.51), 0.14, 0.14)                                             # balok lintang
balok(bm, m(-0.54, -0.50, 1.50), m(0.54, -0.50, 1.50), 0.17, 0.16)                                         # palang penahan
T.tambah('rangka', bm, kayu, kaku='MesinRangka', rata=True)
bm = bmesh.new()
for k in (1, -1):
    balok(bm, m(k * 0.41, -0.97, 0.60), m(k * 0.37, -0.53, 1.40), 0.08, 0.08, atas=X)                      # penopang depan
    balok(bm, m(k * 0.41, 0.14, 0.60), m(k * 0.37, -0.44, 1.26), 0.08, 0.08, atas=X)                       # penopang belakang
    balok(bm, m(k * 0.515, -0.25, 0.64), m(k * 0.515, 0.10, 0.70), 0.035, 0.06, atas=X)                    # tuas penegang puntiran
    balok(bm, m(k * 0.25, 1.04, 0.49), m(k * 0.25, 1.30, 0.49), 0.03, 0.24)                                # sisi peti batu
for y in (1.04, 1.30):
    balok(bm, m(-0.25, y, 0.49), m(0.25, y, 0.49), 0.03, 0.24)
balok(bm, m(-0.25, 1.17, 0.385), m(0.25, 1.17, 0.385), 0.29, 0.03)                                         # alas peti
balok(bm, m(-0.28, -0.74, 0.60), m(0.28, -0.74, 0.60), 0.36, 0.04)                                         # geladak depan
silinder(bm, m(0.41, -0.99, 0.60), m(0.41, -0.99, 2.02), 0.022, 6, 0.016)                                  # tiang panji
T.tambah('rangka_tua', bm, kayu_tua, kaku='MesinRangka', rata=True)
bm = bmesh.new()
silinder(bm, m(-0.33, -0.25, 0.64), m(0.33, -0.25, 0.64), 0.15, 12)                                        # gulungan tali puntir
silinder(bm, m(-0.24, 0.95, 0.66), m(0.24, 0.95, 0.66), 0.06, 8)                                           # tromol tali penarik
for k in (1, -1):                                                                                          # lilitan tali pengikat tiang ke palang
    silinder(bm, m(k * 0.36, -0.512, 1.33), m(k * 0.36, -0.518, 1.41), 0.098, 8)
T.tambah('tali_mesin', bm, tali, kaku='MesinRangka')
bm = bmesh.new()
for k in (1, -1):
    silinder(bm, m(k * 0.49, -0.25, 0.64), m(k * 0.545, -0.25, 0.64), 0.125, 10)                           # cakram besi penjepit tali puntir
    for y in (-0.95, -0.45, 0.40, 0.95):
        balok(bm, m(k * 0.41, y - 0.03, 0.515), m(k * 0.41, y + 0.03, 0.515), 0.175, 0.20)                 # pelat besi sambungan
T.tambah('besi_rangka', bm, besi, kaku='MesinRangka', rata=True)
bm = bmesh.new()
balok(bm, m(-0.21, -0.405, 1.50), m(0.21, -0.405, 1.50), 0.07, 0.26)                                       # bantalan palang (warna tim)
balok(bm, m(-0.30, -0.74, 0.628), m(0.30, -0.74, 0.628), 0.40, 0.02)                                       # kain alas batu di geladak depan
for k in (1, -1):
    balok(bm, m(k * 0.30, -0.93, 0.56), m(k * 0.30, -0.55, 0.56), 0.012, 0.14)                             # juntainya di kedua sisi
T.tambah('bantalan', bm, gading('bantalan'), tim=True, kaku='MesinRangka')
bm = bmesh.new()                                                                                           # panji segitiga (dua sisi)
pj = [m(0.41, -0.99, 2.00), m(0.41, -0.99, 1.70), m(0.41, -0.46, 1.86)]
for geser, urut in ((X * 0.004, (0, 1, 2)), (-X * 0.004, (2, 1, 0))):
    bm.faces.new([bm.verts.new(pj[i] + geser) for i in urut])
T.tambah('panji', bm, gading('panji'), tim=True, kaku='MesinRangka', rata=True)
bm = bmesh.new()
for i, (x, y, z) in enumerate(((-0.13, 1.12, 0.50), (0.10, 1.10, 0.49), (-0.02, 1.23, 0.50), (0.14, 1.24, 0.50), (-0.15, 1.24, 0.49), (0.0, 1.15, 0.62))):
    bongkah(bm, m(x, y, z), 0.105, i)                                                                      # batu cadangan di peti
for i, (x, y) in enumerate(((-0.14, -0.80), (0.12, -0.72))):
    bongkah(bm, m(x, y, 0.725), 0.10, i + 9)                                                               # dan di geladak depan
T.tambah('batu_cadangan', bm, batu, kaku='MesinRangka')

# ---------------------------------------------------------------- lengan, batu, tali penarik
bm = bmesh.new()
mn.tabung(bm, [(di_lengan(-0.16), 0.05, 0.05), (di_lengan(0.0), 0.055, 0.055), (di_lengan(1.06), 0.042, 0.042), (di_lengan(D_MANGKUK + 0.02), 0.036, 0.03)],
          u=X, w=di_lengan(0, 1) - POROS, seg=4, n=5)
mn.bubut(bm, [(0.004, -0.105), (0.10, -0.09), (0.158, -0.03), (0.168, 0.025), (0.142, 0.025), (0.112, -0.015), (0.004, -0.04)], 10,
         pusat=di_lengan(D_MANGKUK, 0.085), sumbu=(X, (di_lengan(1) - POROS), (di_lengan(0, 1) - POROS)))  # mangkuk
T.tambah('lengan_mesin', bm, kayu, kaku='MesinLengan')
bm = bmesh.new()
for d in (0.22, 0.62, 1.0):
    mn.tabung(bm, [(di_lengan(d - 0.025), 0.058, 0.058), (di_lengan(d + 0.025), 0.056, 0.056)], u=X, w=di_lengan(0, 1) - POROS, seg=4, n=5)   # gelang besi
T.tambah('besi_lengan', bm, besi, kaku='MesinLengan', rata=True)
bm = bmesh.new()
bongkah(bm, BATU, 0.115, 5)
T.tambah('batu', bm, batu, kaku='MesinBatu')
bm = bmesh.new()
silinder(bm, TROMOL, KAIT(), 0.014, 5)
T.tambah('tali_tarik', bm, tali, kaku='MesinTali')

# ---------------------------------------------------------------- poros dan roda
for nama, y in (('Depan', -Y_POROS), ('Belakang', Y_POROS)):
    bm = bmesh.new()
    for k in (1, -1):
        c = m(k * X_RODA, y, R_RODA)
        silinder(bm, c - X * 0.05, c + X * 0.05, R_RODA - 0.012, 16)                                       # roda papan
        for j in (0, 1):                                                                                   # palang papan di sisi luar
            arah = Y if j else Z
            balok(bm, c + X * (k * 0.062) - arah * (R_RODA - 0.03), c + X * (k * 0.062) + arah * (R_RODA - 0.03), 0.07, 0.03, atas=X)
    T.tambah('roda' + nama, bm, kayu, kaku='MesinPoros' + nama, rata=True)
    bm = bmesh.new()
    silinder(bm, m(-X_RODA - 0.09, y, R_RODA), m(X_RODA + 0.09, y, R_RODA), 0.04, 8)                       # poros
    for k in (1, -1):
        c = m(k * X_RODA, y, R_RODA)
        silinder(bm, c - X * 0.032, c + X * 0.032, R_RODA, 16)                                             # ban besi
        silinder(bm, c - X * 0.075, c + X * 0.075, 0.085, 8)                                               # naf
    T.tambah('besi_roda' + nama, bm, besi, kaku='MesinPoros' + nama, rata=True)
mesin_bagian = [b['nama'] for b in T.bagian[awal_mesin:]]

SENDI = [('MesinRoot', None, (0, 0, 0), (0, 0, 0.2)),
         ('MesinRangka', 'MesinRoot', m(0, Y_POROS, R_RODA), m(0, Y_POROS, R_RODA + 0.2)),                  # berporos di poros belakang (ambruk ke depan saat hancur)
         ('MesinTali', 'MesinRangka', TROMOL, KAIT()),
         ('MesinLengan', 'MesinRoot', POROS, di_lengan(0.3)),
         ('MesinBatu', 'MesinLengan', BATU, BATU + Vector((0, 0, 0.12))),
         ('MesinPorosDepan', 'MesinRoot', m(0, -Y_POROS, R_RODA), m(0, -Y_POROS, R_RODA + 0.2)),
         ('MesinPorosBelakang', 'MesinRoot', m(0, Y_POROS, R_RODA), m(0, Y_POROS, R_RODA + 0.2))]


# ---------------------------------------------------------------- gerak
def geser(P, nama, v):
    P.pb[nama].location = P.rq[nama].inverted() @ Vector(v)


def mesin(P, sudut=T0, batu=1.0, roda=0.0, tali=True):
    """Pose mesin: sudut lengan, batu tampak (skala), putaran roda, dan tali penarik yang membentang dari tromol ke kait lengan."""
    P.fk('MesinLengan', ('X', sudut - T0))
    P.pb['MesinBatu'].scale = (batu, batu, batu)
    for n in ('MesinPorosDepan', 'MesinPorosBelakang'):
        P.fk(n, ('X', roda))
    v, v0 = KAIT(sudut) - TROMOL, KAIT() - TROMOL
    P.fk('MesinTali', ('X', math.atan2(v.z, v.y) - math.atan2(v0.z, v0.y)))
    P.pb['MesinTali'].scale = (1, v.length / v0.length if tali else 0.01, 1)


def pegang(P, naik_=0.025):
    for s, k in mn.SISI:
        P.tangan(s, genggam=GAGANG[k] + Vector((0, 0, naik_)))


def siap(P, p=0.0):
    mn.diam(P, p)
    pegang(P)


def diam(P, p):
    siap(P, p)
    mesin(P)


def dorong(P, p):
    """Mendorong sambil berlari: satu putaran klip = satu putaran roda (2,07 m), tangan tetap di gagang."""
    mn.derap(P, p, depan=0.30, belakang=0.446, tapak=0.36)
    pegang(P)
    mesin(P, roda=2 * math.pi * p)


# titik-titik kerja juru lontar (dunia)
TALI_JAUH, TALI_DEKAT = Vector((0, 0.93, 0.98)), Vector((0, 1.20, 1.14))
PETI_ATAS = PETI + Vector((0, 0, 0.36))
DUR, AT = 4.2, 0.2


def kuda_kuda(P, maju=0.0, turun=0.0, bungkuk=0.0):
    P.telapak('Left', (0.04, -0.16, 0), 0, rad(8))
    P.telapak('Right', (-0.04, 0.10, 0), 0, rad(-14))
    P.pinggul((0, -maju, -0.04 - turun), ('X', rad(6 + 0.55 * bungkuk)))
    P.fk('Spine', ('X', rad(0.25 * bungkuk)))
    P.fk('Spine1', ('X', rad(0.20 * bungkuk)))
    P.fk('Neck', ('X', rad(-0.25 * bungkuk)))
    P.fk('Head', ('X', rad(-0.2 * bungkuk)))


def tarik(P, q):
    """Menarik tali tangan-berganti-tangan; q = jumlah tarikan yang sudah lewat (pecahannya = fase tarikan sekarang)."""
    n, u = int(q), q - int(q)
    e = halus(min(1.0, u / 0.65))
    kuda_kuda(P, maju=0.10 - 0.09 * e, turun=0.05, bungkuk=24 - 16 * e)
    P.fk('Spine1', ('Z', rad((10 - 20 * e) * (1 if n % 2 else -1))))
    for s, k in mn.SISI:
        tarikan = (n % 2 == 0) == (k < 0)                   # tarikan genap: tangan kanan menarik, kiri menjangkau
        t = e if tarikan else 1 - e
        P.tangan(s, genggam=TALI_JAUH.lerp(TALI_DEKAT, t) + Vector((k * 0.05, 0, 0.05 * math.sin(math.pi * e) * (0 if tarikan else 1))))


def muat(P, v):
    """Dua tangan mengangkat batu dari peti (v = 0) ke mangkuk (v = 1). Hasil: titik pusat batu."""
    pusat = PETI_ATAS.lerp(BATU, halus(v)) + Vector((0, 0, 0.22 * math.sin(math.pi * v)))
    kuda_kuda(P, maju=lerp(0.20, 0.34, v), turun=lerp(0.20, 0.06, v), bungkuk=lerp(52, 30, v))
    for s, k in mn.SISI:
        P.tangan(s, genggam=pusat + Vector((k * 0.125, 0.02, 0.0)), siku=Vector((k * 0.75, ORANG.y - 0.2, 0.9)))
    return pusat


def serang(P, p):
    t = p * DUR
    if t < 0.5:                                              # menyentak tali picu dengan tangan kanan, lalu bersiap menarik
        a = naik(t, 0.0, 0.07) * (1 - naik(t, 0.25, 0.5))

        def picu(P):
            siap(P)
            P.tangan('Right', genggam=GAGANG[-1] + Vector((-0.10, 0.22, 0.10)) * a)
            P.fk('Spine1', ('Z', rad(-10 * a)))
        picu(P)
    elif t < 1.0:
        P.campur(siap, lambda P: tarik(P, 0.0), naik(t, 0.5, 1.0))
    elif t < 3.0:
        tarik(P, (t - 1.0) / 0.4)
    elif t < 3.3:
        P.campur(lambda P: tarik(P, 4.999), lambda P: muat(P, 0.0), naik(t, 3.0, 3.3))
    elif t < 3.8:
        muat(P, (t - 3.3) / 0.5)
    else:
        P.campur(lambda P: muat(P, 1.0), siap, naik(t, 3.8, DUR))
    # mesin: lengan melesat (batu lepas pada AT), memantul di bantalan, lalu turun setahap tiap tarikan
    if t < 0.06:
        sudut = T0
    elif t < 0.24:
        sudut = lerp(T0, T1, ((t - 0.06) / 0.18) ** 2)
    elif t < 1.0:
        sudut = T1 - 0.12 * math.exp(-(t - 0.24) / 0.13) * abs(math.sin(math.pi * (t - 0.24) / 0.16))
    elif t < 3.0:
        q = (t - 1.0) / 0.4
        sudut = lerp(T1, T0, (int(q) + halus(min(1.0, (q - int(q)) / 0.65))) / 5)
    else:
        sudut = T0
    tampak = 1.0 if t < 0.09 or t >= 3.36 else 0.001            # game memunculkan batu terbangnya sejak klip mulai diputar (±0,08 s)
    mesin(P, sudut, tampak)
    if 3.3 <= t < 3.8:                                       # batu baru ikut tangan dari peti ke mangkuk
        geser(P, 'MesinBatu', muat(P, (t - 3.3) / 0.5) - BATU)
        mesin(P, sudut, tampak)
    elif 3.0 <= t < 3.3:
        geser(P, 'MesinBatu', PETI_ATAS - BATU)


def mati(P, p):
    """Rangka ambruk ke depan, poros depan dan lengan terlepas; juru lontar rebah ke belakang."""
    P.campur(lambda P: siap(P), lambda P: mn.mati(P, p), naik(p, 0.0, 0.15))
    a, b, c = naik(p, 0.05, 0.42), naik(p, 0.10, 0.85), naik(p, 0.15, 0.60)
    mesin(P, tali=p < 0.08)
    P.fk('MesinRangka', ('X', 0.235 * a + 0.02 * math.sin(math.pi * naik(p, 0.42, 0.7))))
    geser(P, 'MesinPorosDepan', (0.95 * b, -0.30 * b, 0.0))
    P.fk('MesinPorosDepan', ('X', 3.2 * b), ('Z', -1.15 * b))
    geser(P, 'MesinLengan', (-0.85 * b, 0.30 * b, -(POROS.z - 0.075) * c + 0.30 * math.sin(math.pi * c)))
    P.fk('MesinLengan', ('X', -T0 * c), ('Z', 2.2 * b))
    geser(P, 'MesinBatu', (0.25 * b, 0.35 * b, -0.02 * c))


T.rakit(pisah=mesin_bagian)
T.gerakkan((('diam', 90, diam), ('jalan', 21, dorong), ('lari', 21, dorong), ('serang', 126, serang), ('mati', 42, mati)),
           glb=opsi('--glb', T.keluar + '.glb'), tulang_lain=SENDI, kelompok=[(lambda n: not n.startswith('Mesin'), manusia)],
           peraga={'induk_manusia': 'MesinRoot'},
           lihat={'*': {'pusat': (0, 0.15, 0.85), 'jarak': 8.2, 'ukuran': (500, 400), 'arah': (1, -0.42, 0.40)}, 'serang': {'rentang': (0, 24)}, 'mati': {'pusat': (0.2, 0.3, 0.7)}})
LIHAT = {'pusat': (0, 0.15, 0.85), 'jarak': 8.2, 'ukuran': (500, 400), 'arah': (1, -0.42, 0.40)}
mn.lembar(T.P, T.aksi['serang'], T.berkas('gerak-serang-tarik.png'), rentang=(27, 90), **LIHAT)       # menarik lengan turun
mn.lembar(T.P, T.aksi['serang'], T.berkas('gerak-serang-muat.png'), rentang=(93, 126), **LIHAT)       # memuat batu baru
T.pratinjau(klip='diam', lebar=3.3)
T.pratinjau_tim(klip='diam')
T.ringkasan()
