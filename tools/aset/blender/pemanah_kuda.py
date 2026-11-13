# Pemanah Berkuda (unit unik wangsa Padang) buatan skrip: tunik (diwarnai tim oleh game), sabuk kulit, topi kulit
# bertepi bulu, tabung anak panah, busur pendek di tangan kiri, duduk di atas kuda cokelat muda berpelana dengan
# selimut pelana berwarna tim. Kuda dan penunggang satu mesh dan satu kerangka (40 tulang, sama dengan penunggang.py).
# Pembentuk manusia dari manusia.py, kuda dari kuda.py.
# Hasil: satu GLB berkerangka (klip diam, jalan, lari, serang, mati) untuk `node tools/aset/olah.mjs pemanah_kuda`:
# <folder-keluaran>.glb (bawaan tools/aset/sumber/pemanah_kuda.glb) atau --glb, serta pratinjau PNG di <folder-keluaran>.
# Klip serang 1,0 detik: memanah dari atas pelana, tali dilepas di 0,58 detik (mn.LEPAS_PANAH).
#
#   blender --background --factory-startup --python tools/aset/blender/pemanah_kuda.py -- <folder-keluaran> [--tekstur <folder>] [--glb <file>]
# Baris terakhir keluaran: PEMANAH_KUDA {json ringkasan}.
import bmesh, math, os, sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manusia as mn
import kuda as kd
from manusia import X, Y, Z, rad, naik, lerp, Vector

ARG = sys.argv[sys.argv.index('--') + 1:]
opsi = lambda n, bawaan=None: ARG[ARG.index(n) + 1] if n in ARG else bawaan
T = mn.Tokoh('pemanah_kuda', ARG[0], opsi('--tekstur'))
linen, goni = T.tekstur('rough_linen'), T.tekstur('hessian_230')
kulit = T.bahan('kulit', (0.66, 0.47, 0.34))
samak = T.bahan('samak', (0.27, 0.18, 0.12), kasar=0.7)
kayu = T.bahan('kayu', (0.44, 0.31, 0.19), kasar=0.8)
gading = lambda nama: T.kain(nama, linen, 5.0, (0.72, 0.68, 0.60), (0.94, 0.92, 0.86))        # kain putih gading: dikalikan warna tim

T.kepala(kulit, T.bahan('rambut', (0.07, 0.055, 0.05)), T.bahan('muka', (0.16, 0.09, 0.07)), rambut_penuh=False)
T.lengan(kulit)
T.kaki(samak, nama='sepatu', tebal=0.007, atas=0.44)
T.celana(T.kain('celana', goni, 3.0, (0.20, 0.15, 0.11), (0.45, 0.35, 0.26)), bawah=0.42, segitiga=420)
T.tunik(gading('tunik'), segitiga=700)
T.sabuk(samak, juntai=False, lebar=0.022, longgar=0.016)
bm = bmesh.new()                                                                              # topi kulit dengan tepi bulu
mn.bubut(bm, [(0.104, 1.632), (0.098, 1.675), (0.070, 1.712), (0.034, 1.733), (0.004, 1.739)], 14, pusat=(0, 0.002, 0), sumbu=(X * 0.90, Y * 1.04, Z))
T.tambah('topi', bm, samak, kaku='Head')
bm = bmesh.new()
mn.bubut(bm, [(0.104, 1.578), (0.124, 1.584), (0.130, 1.606), (0.122, 1.630), (0.104, 1.636)], 14, pusat=(0, 0.002, 0), sumbu=(X * 0.90, Y * 1.04, Z))
T.tambah('tepi_topi', bm, T.kain('bulu_topi', goni, 2.2, (0.16, 0.11, 0.07), (0.40, 0.30, 0.21), kasar=0.95), kaku='Head')
T.tabung_panah(samak, kayu, T.bahan('bulu', (0.88, 0.86, 0.80)))
T.busur(T.bahan('kayu_busur', (0.30, 0.20, 0.12), kasar=0.6), T.bahan('tali', (0.82, 0.78, 0.68)), panjang=1.0)
manusia = [b['nama'] for b in T.bagian]
T.pindah(kd.DUDUK)
kuda = kd.bangun(T, T.bahan('bulu_kuda', (0.60, 0.44, 0.28), kasar=0.75), T.bahan('surai', (0.13, 0.09, 0.06), kasar=0.9), T.bahan('kuku', (0.10, 0.08, 0.07), kasar=0.6),
                 samak, gading('selimut'), T.bahan('mata', (0.05, 0.04, 0.04), kasar=0.3))

SISI_PAHA = mn.bidik((0.18, -0.50, 0.85), (0.20, -0.84, -0.50), k=1)                          # busur di sisi paha kiri, condong ke depan
BIDIK = mn.bidik((0, 0, 1), (0, -1, 0), k=1)                                                   # busur tegak, tangan mengarah ke sasaran


def pegang(P, ayun=0.0):
    """Tangan kanan memegang tali kekang, tangan kiri membawa busur di sisi paha."""
    mn.lengan(P, 'Right', -1, turun=36, ayun=-30 + ayun, tekuk=78, masuk=14, putar=20)
    mn.lengan(P, 'Left', 1, turun=30, ayun=-16 - ayun, tekuk=58, putar=6)
    P.tangan('Left', arah=SISI_PAHA)


def diam(P, p):
    kd.diam(P, p)
    kd.duduk(P, ayun=0.004 * math.sin(2 * math.pi * p), kendali=False)
    P.fk('Head', ('Z', rad(8 * math.sin(2 * math.pi * p))))
    pegang(P)


def jalan(P, p):
    c2 = kd.jalan(P, p)
    kd.duduk(P, ayun=0.008 * c2, kendali=False)
    pegang(P, ayun=2 * c2)


def lari(P, p):
    angguk = kd.lari(P, p)
    kd.duduk(P, ayun=0.02 * math.sin(2 * math.pi * (p - 0.3)), condong=14 + 0.6 * angguk, kendali=False)
    pegang(P, ayun=4 * math.sin(2 * math.pi * p))


def serang(P, p):
    """Memanah dari atas pelana ke depan-kiri kepala kuda; kuda diam di tempat."""
    def bidikan(P):
        b, c = naik(p, 0.28, 0.52), naik(p, mn.LEPAS_PANAH, mn.LEPAS_PANAH + 0.05)             # tarikan, lepasan
        kd.diam(P, 0.0)
        kd.duduk(P, condong=-2, kendali=False)
        P.fk('Spine', ('Z', rad(-14)))
        P.fk('Spine1', ('Z', rad(-22)), ('X', rad(-3 * b)))
        P.fk('Neck', ('Z', rad(14)))
        P.fk('Head', ('Z', rad(18)), ('X', rad(-2)))
        g = Vector((0.30, -0.56, 1.37)) + kd.DUDUK
        P.tangan('Left', genggam=g, arah=BIDIK)
        tali, dagu = g + Vector((-0.02, 0.14, 0)), Vector((-0.03, 0.02, 1.455)) + kd.DUDUK
        P.tangan('Right', genggam=tali.lerp(dagu, b).lerp(dagu + Vector((-0.05, 0.08, 0.01)), c), siku=Vector((-0.55, 0.55, 1.50)) + kd.DUDUK)
    P.campur(lambda P: diam(P, 0.0), bidikan, naik(p, 0.0, 0.30) * (1 - naik(p, 0.72, 1.0)))


def mati(P, p):
    def jatuh(P):
        a, b = kd.rebah(P, p)
        kd.duduk(P, condong=-12 * a, kendali=False, terlempar=0.22 * b)
        P.fk('Spine', ('Y', rad(18 * b)))
        P.fk('Head', ('X', rad(16 * b)), ('Z', rad(20 * b)))
        for s, k in mn.SISI:
            mn.lengan(P, s, k, turun=lerp(34, 10, b), ayun=-20 * a, tekuk=lerp(40, 24, b))
        P.tangan('Left', arah=SISI_PAHA.slerp(mn.bidik((0.2, -0.98, 0), (0.98, -0.2, 0), k=1), naik(p, 0.1, 0.8)))
    P.campur(lambda P: diam(P, 0.0), jatuh, naik(p, 0.0, 0.15))


T.rakit(pisah=kuda)
T.gerakkan((('diam', 90, diam), ('jalan', 36, jalan), ('lari', 15, lari), ('serang', 30, serang), ('mati', 42, mati)),
           glb=opsi('--glb', T.keluar + '.glb'), tulang_lain=kd.sendi(), kelompok=kd.KELOMPOK(manusia, kuda),
           peraga={'kaki': kd.KAKI, 'induk_manusia': 'HorseSpine'},
           lihat={'*': {'pusat': (0, -0.1, 1.15), 'jarak': 9.0, 'ukuran': (360, 400), 'arah': (1, -0.45, 0.25)}, 'mati': {'pusat': (0.3, 0, 0.8), 'jarak': 9.5}})
T.pratinjau(klip='diam', lebar=2.3)
T.pratinjau_tim(klip='diam')
T.ringkasan()
