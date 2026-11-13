# Pasar (percontohan bangunan buatan skrip Blender, gaya wangsa Padang): los terbuka bertiang kayu di atas lantai batu,
# atap pelana genteng tanah liat yang sedikit melendut, dua lapak depan bertenda bergaris warna tim, meja dagangan,
# karung, peti, tong, tempayan, keranjang buah, gerobak, dan tiang bendera. Denah dan ukurannya mengikuti rakitan kode
# `case 'market'` di js/models.js (tapak 3 × 3 tile), supaya keduanya bisa dibandingkan dan saling menggantikan.
# Bagian bertanda tim: garis tenda, bendera, dan satu gulungan kain. Pembentuk dan pemanggangan dari bangunan.py.
# Hasil: GLB untuk `node tools/aset/olah.mjs pasar`: <folder-keluaran>.glb (bawaan tools/aset/sumber/pasar.glb) atau
# --glb, serta pratinjau PNG di <folder-keluaran>.
#
#   blender --background --factory-startup --python tools/aset/blender/pasar.py -- <folder-keluaran> [--glb <file>]
# Baris terakhir keluaran: PASAR {json ringkasan}.
import bmesh, math, os, sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bangunan as bg
from bangunan import kotak, balok, kisi, lembaran, KAYU, KAYU_TUA, KAYU_MUDA, BESI, LINEN, PUTIH
from manusia import X, Y, Z, Vector, tabung, elips, bubut

ARG = sys.argv[sys.argv.index('--') + 1:]
opsi = lambda n, bawaan=None: ARG[ARG.index(n) + 1] if n in ARG else bawaan
R = bg.Rakitan('pasar', ARG[0], tapak=3)
P, goyang = R.P, R.goyang
X0, X1, Z0, Z1, LANTAI, CUCUR, BUBUNG, JUNTAI = 0.36, 2.64, 0.46, 1.60, 0.06, 1.0, 0.62, 0.22
ZM = (Z0 + Z1) / 2

# ---------------------------------------------------------------- lantai batu
bm = bmesh.new()
kotak(bm, P(X0 - 0.12, Z0 - 0.12, 0), P(X1 + 0.12, Z1 + 0.12, LANTAI))
R.tambah('lantai', bm, 'stone', rona=(0.80, 0.78, 0.74), bagi=0.3)
bm = bmesh.new()                                            # batu pijakan di depan los, tidak rata
for x, z, r in ((1.22, 1.86, 0.11), (1.50, 1.92, 0.13), (1.80, 1.85, 0.10)):
    tabung(bm, [(P(x, z, 0), r, r * 0.8), (P(x + goyang(0.01), z, 0.03), r * 0.92, r * 0.72)], seg=7)
R.tambah('pijakan', bm, 'stone', rona=(0.74, 0.72, 0.68))

# ---------------------------------------------------------------- rangka los: tiang, balok keliling, penopang siku
bm, bm_siku = bmesh.new(), bmesh.new()
for i in range(4):
    x = X0 + (X1 - X0) * i / 3
    for z in (Z0, Z1):
        dx, dz = goyang(0.012), goyang(0.012)               # tiang kayu gelondong, sedikit miring dan mengecil ke atas
        tabung(bm, [(P(x, z, LANTAI), 0.044, 0.044), (P(x + dx * 0.5, z + dz * 0.5, 0.5), 0.040, 0.040), (P(x + dx, z + dz, CUCUR - 0.09), 0.036, 0.036)], seg=7)
    for sd in (-1, 1):
        if X0 < x + sd * 0.2 < X1:
            balok(bm_siku, P(x, Z1, CUCUR - 0.36), P(x + sd * 0.24, Z1, CUCUR - 0.10), 0.035, 0.035, atas=Y)
R.tambah('tiang', bm, 'planks', rona=KAYU, serat=Z, halus=True)
R.tambah('siku', bm_siku, 'planks', rona=KAYU_TUA, serat=X + Z)
bm = bmesh.new()
for z in (Z0, Z1):
    balok(bm, P(X0 - 0.06, z, CUCUR - 0.062), P(X1 + 0.06, z, CUCUR - 0.062), 0.075, 0.075)
R.tambah('balok_x', bm, 'planks', rona=KAYU, serat=X, bagi=0.4)
bm = bmesh.new()
for x in (X0, (X0 * 2 + X1) / 3, (X0 + X1 * 2) / 3, X1):
    balok(bm, P(x, Z0, CUCUR - 0.062), P(x, Z1, CUCUR - 0.062), 0.06, 0.06)                          # balok melintang setinggi balok keliling
R.tambah('balok_z', bm, 'planks', rona=KAYU_TUA, serat=Y, bagi=0.4)
bm = bmesh.new()                                            # dinding papan belakang setengah tinggi
kotak(bm, P(X0, Z0 - 0.025, LANTAI), P(X1, Z0 + 0.025, 0.54))
R.tambah('dinding', bm, 'planks', rona=(0.95, 0.88, 0.76), bagi=0.3)

# ---------------------------------------------------------------- atap pelana genteng, bubungan melendut di tengah
NX, NS, TEBAL, ANGKAT = 12, 4, 0.05, 0.05                   # ANGKAT: sisi bawah atap bebas dari balok keliling
SETENGAH = (Z1 - Z0) / 2
lendut = lambda u: 0.045 * math.sin(math.pi * u) + 0.006 * math.sin(7 * u + 1)
bubungan = lambda u: CUCUR + BUBUNG + ANGKAT - lendut(u)       # tinggi sisi atas atap di bubungan


def lereng(sisi):
    """sisi +1 = depan, −1 = belakang. v: 0 di tepi cucuran yang menjorok, 1 di bubungan."""
    z_tepi = ZM + sisi * (SETENGAH + JUNTAI)
    y_tepi = CUCUR + ANGKAT - BUBUNG * JUNTAI / SETENGAH

    def titik(u, v):
        x = X0 - 0.2 + (X1 - X0 + 0.4) * u
        y = y_tepi + (bubungan(u) - y_tepi) * v - 0.02 * math.sin(math.pi * v) + 0.006 * math.sin(11 * u + 3 * v + sisi)   # genteng sedikit cekung, tepi tak rata
        return P(x, z_tepi + (ZM - z_tepi) * v, y)
    return titik


bm = bmesh.new()
for sisi in (1, -1):
    lembaran(bm, lereng(sisi), NX, NS, TEBAL)
R.tambah('atap', bm, 'clay', rona=(0.96, 0.93, 0.90), halus=True)
bm = bmesh.new()
tabung(bm, [(P(X0 - 0.21 + (X1 - X0 + 0.42) * i / NX, ZM, bubungan(i / NX) + 0.012), 0.050, 0.038) for i in range(NX + 1)], u=Y, w=Z, seg=6)
R.tambah('bubungan', bm, 'clay', rona=(0.82, 0.78, 0.74), serat=X, halus=True)
for nama, x in (('pelana_kiri', X0), ('pelana_kanan', X1)):
    u = (x - X0 + 0.2) / (X1 - X0 + 0.4)
    bm = bmesh.new()                                        # segitiga pelana berpapan + papan tepi atap
    bm.faces.new([bm.verts.new(p) for p in (P(x, Z0, CUCUR - 0.03), P(x, Z1, CUCUR - 0.03), P(x, ZM, bubungan(u) - TEBAL - 0.01))])
    R.tambah(nama, bm, 'planks', rona=(0.92, 0.85, 0.72), bagi=0.3)
    bm = bmesh.new()
    xl = x + (0.21 if x > 1.5 else -0.21)
    for sisi in (1, -1):
        z_tepi, y_tepi = ZM + sisi * (SETENGAH + JUNTAI), CUCUR + ANGKAT - BUBUNG * JUNTAI / SETENGAH
        balok(bm, P(xl, z_tepi, y_tepi - 0.03), P(xl, ZM, bubungan(u) - 0.02), 0.022, 0.07)
    R.tambah(nama + '_lis', bm, 'planks', rona=KAYU_TUA, serat=Y + Z * 0.5)

# ---------------------------------------------------------------- perabot dan dagangan


def meja(bm, x0, x1, z0, z1, tinggi):
    kotak(bm, P(x0, z0, tinggi - 0.035), P(x1, z1, tinggi))
    for x in (x0 + 0.04, x1 - 0.04):
        for z in (z0 + 0.04, z1 - 0.04):
            kotak(bm, P(x - 0.016, z - 0.016, 0 if z > Z1 + 0.2 else LANTAI), P(x + 0.016, z + 0.016, tinggi - 0.035))


def karung(bm, x, z, r, dasar=0.0):
    """Karung goni gemuk: elipsoid yang rata di bawah, lehernya terikat miring."""
    miring = goyang(0.4)
    for v in elips(bm, P(x, z, dasar + r * 0.95), (r, r * 0.86, r * 1.22), seg=8, ring=6):
        v.co.z = max(v.co.z, dasar + 0.004)
    tabung(bm, [(P(x, z, dasar + r * 2.05), r * 0.30, r * 0.30), (P(x + 0.02 * miring, z, dasar + r * 2.32), r * 0.42, r * 0.36)], seg=6)


def tong(bm, bm_besi, x, z, dasar=0.0, r=0.085, t=0.26):
    bubut(bm, [(r * 0.82, 0), (r * 0.97, t * 0.25), (r, t * 0.5), (r * 0.97, t * 0.75), (r * 0.82, t), (0.004, t)], 10, pusat=P(x, z, dasar))
    for h in (0.2, 0.8):
        bubut(bm_besi, [(r * 0.955, t * h - 0.012), (r * 0.975, t * h - 0.012), (r * 0.975, t * h + 0.012), (r * 0.955, t * h + 0.012)], 10, pusat=P(x, z, dasar))


def tempayan(bm, x, z, r, dasar=0.0):
    bubut(bm, [(r * 0.45, 0), (r * 0.9, r * 0.5), (r, r * 1.1), (r * 0.8, r * 1.7), (r * 0.5, r * 1.95), (r * 0.58, r * 2.1), (r * 0.44, r * 2.08), (r * 0.36, r * 1.9)], 9, pusat=P(x, z, dasar))


def buah(bm, x, z, y, n=6, r=0.033):
    for i in range(n):
        lapis = i >= 4
        elips(bm, P(x + ((i % 3) - 1) * 0.052 * (0.5 if lapis else 1) + goyang(0.008), z + ((i % 2) - 0.5) * 0.058 * (0.4 if lapis else 1) + goyang(0.008), y + r * (1.6 if lapis else 0.75)),
              (r, r, r * 0.92), seg=6, ring=4)


bm = bmesh.new()
meja(bm, 0.56, 1.30, 0.92, 1.30, 0.36)
meja(bm, 1.70, 2.44, 0.92, 1.30, 0.36)
for ax in (0.30, 1.80):                                     # meja dua lapak depan
    meja(bm, ax + 0.08, ax + 0.82, 2.24, 2.60, 0.32)
R.tambah('meja', bm, 'planks', rona=KAYU_MUDA, bagi=0.35)

bm = bmesh.new()
for x, z, r, dasar in ((0.60, 0.70, 0.085, LANTAI), (0.79, 0.66, 0.078, LANTAI), (0.70, 0.82, 0.07, LANTAI), (2.84, 2.20, 0.085, 0), (2.70, 2.30, 0.075, 0)):
    karung(bm, x, z, r, dasar)
R.tambah('karung', bm, 'flat', rona=(0.70, 0.60, 0.44), halus=True)

bm, bm_besi = bmesh.new(), bmesh.new()
tong(bm, bm_besi, 2.46, 0.72, LANTAI)
tong(bm, bm_besi, 0.16, 2.30, 0)
R.tambah('tong', bm, 'planks', rona=KAYU, serat=Z, halus=True)
R.tambah('gelang_tong', bm_besi, 'flat', rona=BESI, halus=True)

bm = bmesh.new()
for x, z, s, dasar, putar in ((1.50, 0.78, 0.20, LANTAI, 0.0), (1.52, 0.77, 0.15, LANTAI + 0.20, 0.3), (2.86, 1.86, 0.17, 0, 0.2)):
    c, sn = math.cos(putar) * s / 2, math.sin(putar) * s / 2    # peti kayu, ada yang diputar sedikit
    sudut = [P(x + a * c - b * sn, z + a * sn + b * c, dasar) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    bawah = [bm.verts.new(p) for p in sudut]
    atas = [bm.verts.new(p + Z * s) for p in sudut]
    bm.faces.new(bawah[::-1])
    bm.faces.new(atas)
    for i in range(4):
        bm.faces.new((bawah[i], bawah[(i + 1) % 4], atas[(i + 1) % 4], atas[i]))
R.tambah('peti', bm, 'planks', rona=(0.80, 0.68, 0.52))

bm = bmesh.new()
for x, z, r, dasar in ((2.20, 0.66, 0.075, LANTAI), (2.05, 0.74, 0.055, LANTAI), (0.20, 1.90, 0.08, 0)):
    tempayan(bm, x, z, r, dasar)
R.tambah('tempayan', bm, 'flat', rona=(0.62, 0.36, 0.24), halus=True)

for nama, rona, tempat in (('buah_merah', (0.78, 0.26, 0.23), ((0.74, 1.10, 0.36), (2.08, 2.40, 0.32))), ('buah_kuning', (0.85, 0.66, 0.25), ((1.10, 1.12, 0.36), (2.40, 2.42, 0.32))),
                           ('buah_hijau', (0.44, 0.60, 0.29), ((0.58, 2.40, 0.32),)), ('buah_pucat', (0.91, 0.86, 0.75), ((0.90, 2.42, 0.32),))):
    bm = bmesh.new()
    for x, z, y in tempat:
        buah(bm, x, z, y)
    R.tambah(nama, bm, 'flat', rona=rona, halus=True)

bm = bmesh.new()                                            # keranjang anyaman di bawah buah lapak
for x, z in ((0.58, 2.40), (0.90, 2.42), (2.08, 2.40), (2.40, 2.42)):
    bubut(bm, [(0.060, 0.0), (0.090, 0.035), (0.096, 0.05), (0.086, 0.05), (0.058, 0.012)], 9, pusat=P(x, z, 0.32))
R.tambah('keranjang', bm, 'flat', rona=(0.72, 0.58, 0.36), halus=True)


def gulungan(bm, x, z, y):
    tabung(bm, [(P(x - 0.13, z, y + 0.03), 0.03, 0.03), (P(x + 0.13, z, y + 0.03), 0.03, 0.03)], u=Y, w=Z, seg=7)


bm = bmesh.new()
gulungan(bm, 1.90, 1.04, 0.36)
R.tambah('kain_tim', bm, 'flat', rona=PUTIH, halus=True, tim=True)
for nama, rona, (x, z) in (('kain_linen', LINEN, (1.92, 1.18)), ('kain_cokelat', (0.54, 0.35, 0.24), (2.24, 1.10))):
    bm = bmesh.new()
    gulungan(bm, x, z, 0.36)
    R.tambah(nama, bm, 'flat', rona=rona, halus=True)

# ---------------------------------------------------------------- dua lapak depan: tiang dan tenda kain bergaris
bm = bmesh.new()
for ax in (0.30, 1.80):
    for dx in (0, 0.9):
        tabung(bm, [(P(ax + dx, 2.08, 0), 0.024, 0.024), (P(ax + dx + goyang(0.01), 2.08, 0.79), 0.020, 0.020)], seg=6)
        tabung(bm, [(P(ax + dx, 2.72, 0), 0.024, 0.024), (P(ax + dx + goyang(0.01), 2.74, 0.55), 0.020, 0.020)], seg=6)
    balok(bm, P(ax - 0.07, 2.08, 0.775), P(ax + 0.97, 2.08, 0.775), 0.03, 0.03)                            # palang tenda: kain terbentang di atasnya
    balok(bm, P(ax - 0.07, 2.73, 0.540), P(ax + 0.97, 2.73, 0.540), 0.03, 0.03)
R.tambah('tiang_lapak', bm, 'planks', rona=KAYU, serat=Z, halus=True)


def tenda(ax, k):
    """Garis ke-k (dari 6) tenda lapak di ax: kain miring dari z 2,0 ke 2,84, melendut di tengah, tepi depan menjuntai."""
    def titik(u, v):
        x = ax - 0.08 + (k + u) * 1.06 / 6
        s = (x - ax + 0.08) / 1.06                          # 0..1 melintang seluruh tenda
        z = 2.0 + 0.84 * min(v, 0.88) / 0.88
        y = 0.83 - 0.27 * min(v, 0.88) / 0.88 - 0.055 * math.sin(math.pi * min(v, 0.88) / 0.88) - 0.035 * math.sin(math.pi * s) * math.sin(math.pi * min(v, 0.88) / 0.88)
        if v > 0.88:                                        # juntai depan bergelombang
            y -= (v - 0.88) / 0.12 * (0.06 + 0.02 * math.sin(2 * math.pi * 3 * s))
        return P(x, z, y)
    return titik


bm_tim, bm_linen = bmesh.new(), bmesh.new()
for ax in (0.30, 1.80):
    for k in range(6):
        lembaran(bm_linen if k % 2 else bm_tim, tenda(ax, k), 2, 8, 0.012, dinding=False)
for bm, nama, rona, tim in ((bm_tim, 'tenda_tim', PUTIH, True), (bm_linen, 'tenda_linen', LINEN, False)):
    R.tambah(nama, bm, 'flat', rona=rona, halus=True, tim=tim)

# ---------------------------------------------------------------- gerobak, tiang bendera
bm, bm_besi = bmesh.new(), bmesh.new()
kotak(bm, P(1.32, 2.36, 0.15), P(1.66, 2.58, 0.17))                                                      # lantai gerobak
for (xa, za, xb, zb) in ((1.32, 2.36, 1.66, 2.36), (1.32, 2.58, 1.66, 2.58), (1.32, 2.36, 1.32, 2.58), (1.66, 2.36, 1.66, 2.58)):
    balok(bm, P(xa, za, 0.215), P(xb, zb, 0.215), 0.014, 0.09)
for z in (2.38, 2.56):
    balok(bm, P(1.66, z, 0.17), P(1.96, z, 0.10), 0.02, 0.02)                                             # gagang, ujungnya bertumpu di tanah
for z in (2.33, 2.61):
    tabung(bm, [(P(1.46, z - 0.014, 0.10), 0.10, 0.10), (P(1.46, z + 0.014, 0.10), 0.10, 0.10)], u=X, w=Z, seg=12)
    tabung(bm_besi, [(P(1.46, z - 0.02, 0.10), 0.022, 0.022), (P(1.46, z + 0.02, 0.10), 0.022, 0.022)], u=X, w=Z, seg=6)
R.tambah('gerobak', bm, 'planks', rona=KAYU_MUDA)
R.tambah('naf', bm_besi, 'flat', rona=BESI)
bm = bmesh.new()
karung(bm, 1.44, 2.47, 0.07, 0.17)
karung(bm, 1.57, 2.46, 0.06, 0.17)
R.tambah('karung_gerobak', bm, 'flat', rona=(0.74, 0.64, 0.47), halus=True)

bm = bmesh.new()
XB = 1.62                                                   # di antara dua verteks bubungan, supaya bayangannya tidak menggelapkan petak atap
tabung(bm, [(P(XB, ZM, CUCUR + BUBUNG - 0.08), 0.014, 0.014), (P(XB, ZM, 2.40), 0.010, 0.010)], seg=6)
R.tambah('tiang_bendera', bm, 'planks', rona=KAYU_TUA, serat=Z, halus=True)
bm = bmesh.new()
for sisi in (1, -1):                                        # dua sisi kain, masing-masing menghadap keluar
    kisi(bm, lambda u, v: P(XB, ZM, 2.38 - 0.20 * (v if sisi > 0 else 1 - v)) + Vector((0.34 * u, 0.035 * math.sin(2.6 * math.pi * u) * (0.3 + u) + 0.004 * sisi, -0.05 * u * u)), 8, 3)
R.tambah('bendera', bm, 'flat', rona=PUTIH, halus=True, tim=True)

R.rakit()
R.ekspor(opsi('--glb', R.keluar + '.glb'))
R.pratinjau()
R.ringkasan()
