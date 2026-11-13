# Penunggang Kuda buatan skrip: prajurit berbaju rantai, rok kain dan jambul helm (diwarnai tim oleh game), tombak di
# tangan kanan, duduk di atas kuda cokelat tua berpelana dengan selimut pelana berwarna tim. Kuda dan penunggang satu
# mesh dan satu kerangka (40 tulang: 19 tulang kuda berawalan Horse + 21 tulang manusia di bawah HorseSpine).
# Pembentuk manusia dari manusia.py, kuda dari kuda.py.
# Hasil: satu GLB berkerangka (klip diam, jalan, lari, serang, mati) untuk `node tools/aset/olah.mjs penunggang`:
# <folder-keluaran>.glb (bawaan tools/aset/sumber/penunggang.glb) atau --glb, serta pratinjau PNG di <folder-keluaran>.
#
#   blender --background --factory-startup --python tools/aset/blender/penunggang.py -- <folder-keluaran> [--tekstur <folder>] [--glb <file>]
# Baris terakhir keluaran: PENUNGGANG {json ringkasan}.
import math, os, sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manusia as mn
import kuda as kd
from manusia import rad, naik, lerp

ARG = sys.argv[sys.argv.index('--') + 1:]
opsi = lambda n, bawaan=None: ARG[ARG.index(n) + 1] if n in ARG else bawaan
T = mn.Tokoh('penunggang', ARG[0], opsi('--tekstur'))
linen, goni = T.tekstur('rough_linen'), T.tekstur('hessian_230')
kulit = T.bahan('kulit', (0.66, 0.47, 0.34))
samak = T.bahan('samak', (0.27, 0.18, 0.12), kasar=0.7)
besi = T.bahan('besi', (0.60, 0.63, 0.66), kasar=0.42, logam=1.0)
kayu = T.bahan('kayu', (0.44, 0.31, 0.19), kasar=0.8)
gading = lambda nama: T.kain(nama, linen, 5.0, (0.72, 0.68, 0.60), (0.94, 0.92, 0.86))        # kain putih gading: dikalikan warna tim

T.kepala(kulit, T.bahan('rambut', (0.07, 0.055, 0.05)), T.bahan('muka', (0.16, 0.09, 0.07)), rambut_penuh=False)
T.lengan(kulit, dari=0.34)
T.kaki(samak, nama='sepatu', tebal=0.007, atas=0.44)
T.celana(T.kain('celana', goni, 3.0, (0.17, 0.14, 0.11), (0.38, 0.31, 0.24)), bawah=0.42, segitiga=380)
T.tunik(T.kain('rantai', goni, 9.0, (0.26, 0.27, 0.29), (0.60, 0.62, 0.65), kasar=0.5, logam=0.85), lengan=0.40, tebal=0.008, segitiga=600, riak=0.003, tim=False)   # baju rantai
T.rok(gading('rok'), bawah=0.66, segitiga=320)
T.sabuk(samak, juntai=False, lebar=0.024, longgar=0.036, gesper=besi)
T.helm(besi, jambul=gading('jambul'))
T.tombak(kayu, besi)
manusia = [b['nama'] for b in T.bagian]
T.pindah(kd.DUDUK)
kuda = kd.bangun(T, T.bahan('bulu_kuda', (0.40, 0.25, 0.14), kasar=0.75), T.bahan('surai', (0.10, 0.07, 0.05), kasar=0.9), T.bahan('kuku', (0.10, 0.08, 0.07), kasar=0.6),
                 samak, gading('selimut'), T.bahan('mata', (0.05, 0.04, 0.04), kasar=0.3))

TEGAK, MAJU = mn.TEGAK, mn.bidik((0, -0.92, -0.39), (0, -0.39, 0.92))                          # tombak tegak / condong ke depan-bawah


def tombak(P, turun=30, ayun=-28, tekuk=70, arah=TEGAK):
    mn.lengan(P, 'Right', -1, turun=turun, ayun=ayun, tekuk=tekuk, putar=10)
    P.tangan('Right', arah=arah)


def diam(P, p):
    kd.diam(P, p)
    kd.duduk(P, ayun=0.004 * math.sin(2 * math.pi * p))
    P.fk('Head', ('Z', rad(8 * math.sin(2 * math.pi * p))))
    tombak(P)


def jalan(P, p):
    c2 = kd.jalan(P, p)
    kd.duduk(P, ayun=0.008 * c2)
    tombak(P, arah=mn.Quaternion(mn.X, rad(6)) @ TEGAK)


def lari(P, p):
    angguk = kd.lari(P, p)
    kd.duduk(P, ayun=0.02 * math.sin(2 * math.pi * (p - 0.3)), condong=14 + 0.6 * angguk)
    tombak(P, turun=34, ayun=-20, tekuk=86, arah=mn.Quaternion(mn.X, rad(52)) @ TEGAK)       # tombak direbahkan ke depan


def serang(P, p):
    """Menusuk dari atas pelana: tombak diangkat lalu ditusukkan ke depan-bawah; kuda melangkah di tempat."""
    def tusuk(P):
        a, b = naik(p, 0.0, 0.30), naik(p, 0.30, 0.44)
        kd.diam(P, 0.0)
        P.telapak('FL', (0, -0.10 * b, 0.05 * math.sin(math.pi * b)))
        P.fk('HorseNeck', ('X', rad(5 - 6 * a + 8 * b)))
        kd.duduk(P, condong=-6 * a + 20 * b)
        P.fk('Spine1', ('Z', rad(-16 * a + 22 * b)), ('X', rad(-3 * a + 6 * b)))
        tombak(P, turun=lerp(lerp(30, -30, a), 6, b), ayun=lerp(lerp(-28, 26, a), -96, b), tekuk=lerp(lerp(70, 112, a), 18, b), arah=TEGAK.slerp(MAJU, naik(p, 0.05, 0.36)))
    P.campur(tusuk, lambda P: diam(P, 0.0), naik(p, 0.6, 1.0))


def mati(P, p):
    def jatuh(P):
        a, b = kd.rebah(P, p)
        kd.duduk(P, condong=-12 * a, kendali=False, terlempar=0.22 * b)
        P.fk('Spine', ('Y', rad(18 * b)))
        P.fk('Head', ('X', rad(16 * b)), ('Z', rad(20 * b)))
        for s, k in mn.SISI:
            mn.lengan(P, s, k, turun=lerp(34, 10, b), ayun=-20 * a, tekuk=lerp(40, 24, b))
        P.tangan('Right', arah=TEGAK.slerp(mn.bidik((0.2, -0.98, 0), (0.98, 0.2, 0)), naik(p, 0.1, 0.8)))
    P.campur(lambda P: diam(P, 0.0), jatuh, naik(p, 0.0, 0.15))


T.rakit(pisah=kuda)
T.gerakkan((('diam', 90, diam), ('jalan', 36, jalan), ('lari', 15, lari), ('serang', 24, serang), ('mati', 42, mati)),
           glb=opsi('--glb', T.keluar + '.glb'), tulang_lain=kd.sendi(), kelompok=kd.KELOMPOK(manusia, kuda),
           peraga={'kaki': kd.KAKI, 'induk_manusia': 'HorseSpine'},
           lihat={'*': {'pusat': (0, -0.1, 1.15), 'jarak': 9.0, 'ukuran': (360, 400), 'arah': (1, -0.45, 0.25)}, 'mati': {'pusat': (0.3, 0, 0.8), 'jarak': 9.5}})
T.pratinjau(klip='diam', lebar=2.3)
T.pratinjau_tim(klip='diam')
T.ringkasan()
