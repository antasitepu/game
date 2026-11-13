'use strict';
// Data & konstanta game. Semua angka balancing ada di sini (single source of truth).
globalThis.BF = {};

BF.TITLE = 'Benteng Fajar';
BF.TILE = 32;
BF.MAP_SIZE = 96;
BF.TICK_RATE = 20;
BF.DT = 1 / BF.TICK_RATE;
BF.MAX_POP = 75;
BF.CARRY_CAP = 10;
BF.START_WORKERS = 4;
BF.START_RES = { food: 250, wood: 250, gold: 100, stone: 100 };
BF.SAVE_VERSION = 1;

BF.RES = ['food', 'wood', 'gold', 'stone'];
BF.RES_LABEL = { food: 'Pangan', wood: 'Kayu', gold: 'Emas', stone: 'Batu' };
BF.RES_COLOR = { food: '#d9534f', wood: '#8a5a2b', gold: '#f2c94c', stone: '#9aa0a6' };
BF.GATHER_RATE = { food: 0.9, wood: 0.9, gold: 0.8, stone: 0.8, farm: 0.7, hunt: 1.25 };

BF.T_GRASS = 0;
BF.T_WATER = 1;

BF.N_TREE = 1;
BF.N_BERRY = 2;
BF.N_GOLD = 3;
BF.N_STONE = 4;
// Hewan liar (bukan milik pemain). Rusa berkelompok dan lari saat diserang; babi hutan menyendiri dan menyeruduk balik.
// Yang mati menjadi bangkai berisi pangan; pekerja mengulitinya lebih cepat daripada memetik beri (GATHER_RATE.hunt).
// speed: jalan santai, run: lari/menyeruduk (tile/detik); atk/cooldown: serudukan babi.
BF.ANIMALS = {
  deer: { name: 'Rusa', hp: 12, food: 140, speed: 0.9, run: 3.3, radius: 0.28, herd: 3 },
  boar: { name: 'Babi Hutan', hp: 36, food: 300, speed: 0.7, run: 2.7, radius: 0.3, herd: 1, atk: 3, cooldown: 1.2 },
};
// Perbaikan bangunan oleh pekerja: tiap pekerja memulihkan nyawa secepat rate × laju membangun bangunan itu, dan
// memulihkan nyawa dari nol sampai penuh menghabiskan cost × biaya bangunannya (ditagih sedikit demi sedikit).
BF.REPAIR = { rate: 0.75, cost: 0.5 };
// Skor: ekonomi = sumber daya terkumpul ÷ eco; militer = nilai (biaya) unit & bangunan musuh yang dikalahkan ÷ mil;
// teknologi = era × era + teknologi × tech. Riwayat skor dicatat tiap `every` tick untuk grafik di layar akhir.
BF.SCORE = { eco: 10, mil: 5, era: 150, tech: 40, every: 600 };
// Formasi untuk perintah gerak (indeks dikirim bersama perintah): bebas = kisi tanpa arah, tiap unit dengan kecepatannya
// sendiri. Baris dan kotak menghadap arah maju, petarung jarak dekat di depan, dan berjalan secepat unit paling lambat.
BF.FORMATIONS = [
  { name: 'Bebas', desc: 'Tanpa formasi: tiap unit bergerak dengan kecepatannya sendiri.' },
  { name: 'Baris', desc: 'Barisan lebar menghadap arah maju: petarung jarak dekat di depan, pemanah di belakangnya, mesin kepung paling belakang. Semua berjalan secepat unit paling lambat.', cols: 10 },
  { name: 'Kotak', desc: 'Kelompok rapat menghadap arah maju, susunan depan-belakang sama seperti Baris. Semua berjalan secepat unit paling lambat.' },
];
// Sikap unit tempur saat tidak diperintah (u.stance = indeks): agresif mengejar musuh yang terlihat lalu kembali;
// bertahan hanya menyerang yang masuk jangkauannya tanpa beranjak; diam tidak menyerang sama sekali, juga saat diserang.
BF.STANCES = [
  { name: 'Agresif', desc: 'Mengejar musuh yang terlihat; bila pengejaran melewati ±10 tile, kembali ke tempat semula.' },
  { name: 'Bertahan', desc: 'Tetap di tempat; hanya menyerang musuh yang masuk jangkauan.' },
  { name: 'Diam', desc: 'Tidak menyerang kecuali diperintah, juga saat diserang.' },
];
// Berlindung: unit berkelas cls boleh masuk ke bangunan sendiri yang punya kapasitas `garrison`. Di dalam, unit tak
// bisa diserang dan pulih heal nyawa/detik; bangunannya menembak 1 panah tambahan per perArrow unit di dalamnya.
BF.GARRISON = { cls: ['civil', 'infantry', 'archer'], heal: 0.5, perArrow: 2 };
// Tombak lempar pekerja saat berburu.
BF.HUNT = { atk: 4, range: 2.6, cooldown: 1.5 };

BF.NODES = {
  1: { res: 'wood', amount: 120, name: 'Pohon' },
  2: { res: 'food', amount: 200, name: 'Semak Beri' },
  3: { res: 'gold', amount: 900, name: 'Urat Emas' },
  4: { res: 'stone', amount: 700, name: 'Bongkah Batu' },
};

// Warna mengikuti slot pemain (0 = biru, 1 = merah), bukan faksi.
BF.SLOTS = [
  { label: 'Biru', color: '#3b82f6', dark: '#1e3a8a', light: '#bfdbfe' },
  { label: 'Merah', color: '#ef4444', dark: '#7f1d1d', light: '#fecaca' },
];

BF.ERAS = [
  { name: 'Era Perintis' },
  { name: 'Era Baja', cost: { food: 400, gold: 150 }, time: 45, desc: 'Membuka Pendekar Pedang, Pemanah, Penunggang Kuda, Pandai Besi, Menara Jaga, dan unit unik wangsa.' },
  { name: 'Era Kejayaan', cost: { food: 800, gold: 500 }, time: 70, desc: 'Membuka Bengkel Pelontar, Pelontar Batu, dan teknologi tingkat lanjut.' },
];

// Efek (dipakai faksi & teknologi):
//   {u: 'tipe' | 'cls:kelas' | '*', stat, add|mul}  → mengubah stat unit
//   {b: 'tipe' | '*', stat, add|mul}                → mengubah stat bangunan
//   {p: 'carry' | 'gather.<res>', add|mul}          → mengubah pengali milik pemain
BF.FACTIONS = {
  samudra: {
    name: 'Wangsa Samudra', tag: 'Ekonomi', unique: 'guard',
    bonus: ['Pekerja membawa +3 sumber daya', 'Emas ditambang 15% lebih cepat', 'Unit unik: Pengawal Karang'],
    effects: [{ p: 'carry', add: 3 }, { p: 'gather.gold', mul: 1.15 }],
  },
  bara: {
    name: 'Wangsa Bara', tag: 'Infanteri', unique: 'berserk',
    bonus: ['Infanteri +1 serangan', 'Infanteri dilatih 20% lebih cepat', 'Unit unik: Pengamuk'],
    effects: [{ u: 'cls:infantry', stat: 'atk', add: 1 }, { u: 'cls:infantry', stat: 'time', mul: 0.8 }],
  },
  rimba: {
    name: 'Wangsa Rimba', tag: 'Pemanah', unique: 'ranger',
    bonus: ['Kayu ditebang 20% lebih cepat', 'Pemanah +1 jarak tembak', 'Unit unik: Pemburu Rimba'],
    effects: [{ p: 'gather.wood', mul: 1.2 }, { u: 'cls:archer', stat: 'range', add: 1 }],
  },
  padang: {
    name: 'Wangsa Padang', tag: 'Kavaleri', unique: 'harcher',
    bonus: ['Kavaleri +15% daya tahan', 'Kavaleri dilatih 20% lebih cepat', 'Unit unik: Pemanah Berkuda'],
    effects: [{ u: 'cls:cavalry', stat: 'hp', mul: 1.15 }, { u: 'cls:cavalry', stat: 'time', mul: 0.8 }],
  },
};

// cls: kelas unit untuk sistem counter. bonus: pengali damage terhadap kelas target.
// faction: unit unik, hanya bisa dilatih wangsa tersebut.
BF.UNITS = {
  worker: {
    name: 'Pekerja', cls: 'civil', era: 0, cost: { food: 50 }, time: 14, pop: 1,
    hp: 30, atk: 0, armor: 0, range: 0, cooldown: 0, speed: 2.4, sight: 5, radius: 0.26,
    desc: 'Mengumpulkan sumber daya dan mendirikan bangunan.',
  },
  spear: {
    name: 'Prajurit Tombak', cls: 'infantry', era: 0, cost: { food: 40, wood: 25 }, time: 15, pop: 1,
    hp: 55, atk: 5, armor: 0, range: 0.5, cooldown: 1.2, speed: 2.3, sight: 5, radius: 0.28,
    bonus: { cavalry: 3, building: 0.5 },
    desc: 'Infanteri murah. Unggul melawan kavaleri.',
  },
  sword: {
    name: 'Pendekar Pedang', cls: 'infantry', era: 1, cost: { food: 60, gold: 25 }, time: 18, pop: 1,
    hp: 80, atk: 9, armor: 1, range: 0.5, cooldown: 1.3, speed: 2.2, sight: 5, radius: 0.29,
    bonus: { building: 0.8 },
    desc: 'Infanteri berat serba guna. Lumayan untuk merobohkan bangunan.',
  },
  guard: {
    name: 'Pengawal Karang', cls: 'infantry', era: 1, faction: 'samudra', cost: { food: 70, gold: 45 }, time: 21, pop: 1,
    hp: 110, atk: 8, armor: 3, range: 0.5, cooldown: 1.4, speed: 2.0, sight: 5, radius: 0.31,
    bonus: { cavalry: 1.5, building: 0.7 },
    desc: 'Unit unik. Infanteri berperisai tebal: sangat tahan panah dan tebasan, tetapi lambat.',
  },
  berserk: {
    name: 'Pengamuk', cls: 'infantry', era: 1, faction: 'bara', cost: { food: 65, gold: 35 }, time: 17, pop: 1,
    hp: 75, atk: 12, armor: 0, range: 0.5, cooldown: 1.1, speed: 2.9, sight: 5, radius: 0.29,
    bonus: { building: 1 },
    desc: 'Unit unik. Infanteri cepat dengan serangan ganas, tanpa zirah.',
  },
  archer: {
    name: 'Pemanah', cls: 'archer', era: 1, cost: { wood: 30, gold: 40 }, time: 18, pop: 1,
    hp: 35, atk: 6, armor: 0, range: 5, cooldown: 1.8, speed: 2.3, sight: 6, radius: 0.27,
    bonus: { infantry: 1.5, building: 0.25 },
    desc: 'Menyerang dari jauh. Unggul melawan infanteri, lemah terhadap kavaleri.',
  },
  ranger: {
    name: 'Pemburu Rimba', cls: 'archer', era: 1, faction: 'rimba', cost: { wood: 45, gold: 50 }, time: 20, pop: 1,
    hp: 45, atk: 8, armor: 0, range: 6, cooldown: 1.9, speed: 2.5, sight: 7, radius: 0.27,
    bonus: { infantry: 1.5, cavalry: 1.2, building: 0.25 },
    desc: 'Unit unik. Pemanah jarak jauh yang lincah dan mematikan.',
  },
  rider: {
    name: 'Penunggang Kuda', cls: 'cavalry', era: 1, cost: { food: 70, gold: 60 }, time: 22, pop: 1,
    hp: 110, atk: 9, armor: 1, range: 0.5, cooldown: 1.3, speed: 3.6, sight: 6, radius: 0.36,
    bonus: { archer: 1.8, siege: 2.5, building: 0.6 },
    desc: 'Cepat dan tangguh. Unggul melawan pemanah dan pelontar, lemah terhadap tombak.',
  },
  harcher: {
    name: 'Pemanah Berkuda', cls: 'cavalry', era: 1, faction: 'padang', cost: { food: 55, gold: 55 }, time: 22, pop: 1,
    hp: 75, atk: 6, armor: 0, range: 4.5, cooldown: 1.7, speed: 3.3, sight: 6, radius: 0.36,
    bonus: { infantry: 1.3, building: 0.25 },
    desc: 'Unit unik. Menembak sambil berkuda: ideal untuk serang-lari, lemah terhadap tombak.',
  },
  catapult: {
    name: 'Pelontar Batu', cls: 'siege', era: 2, cost: { wood: 150, gold: 120 }, time: 35, pop: 2,
    hp: 90, atk: 35, armor: 0, range: 7, cooldown: 5, speed: 1.4, sight: 8, radius: 0.42, splash: 1.2,
    bonus: { building: 3.5 },
    desc: 'Senjata kepung. Menghancurkan bangunan dan tembok dari jauh, lambat dan rapuh.',
  },
};

BF.BUILDINGS = {
  townhall: {
    name: 'Balai Kota', size: 3, era: 0, cost: { wood: 250, stone: 150 }, time: 90, hp: 2400, pop: 5, sight: 8,
    dropoff: true, trains: ['worker'], atk: 6, range: 6, cooldown: 2, garrison: 10,
    desc: 'Pusat permukiman. Melatih Pekerja, menerima setoran, dan meneliti era baru.',
  },
  house: {
    name: 'Rumah', size: 2, era: 0, cost: { wood: 30 }, time: 18, hp: 500, pop: 5, sight: 3,
    desc: 'Menambah batas populasi +5.',
  },
  farm: {
    name: 'Ladang', size: 2, era: 0, cost: { wood: 50 }, time: 12, hp: 250, sight: 2, walkable: true,
    desc: 'Sumber Pangan tanpa batas. Digarap oleh satu Pekerja.',
  },
  storage: {
    name: 'Lumbung', size: 2, era: 0, cost: { wood: 80 }, time: 25, hp: 600, sight: 4, dropoff: true,
    desc: 'Tempat setor sumber daya dan meneliti teknologi ekonomi. Bangun di dekat hutan atau tambang.',
  },
  barracks: {
    name: 'Barak', size: 3, era: 0, cost: { wood: 150 }, time: 35, hp: 1100, sight: 5,
    trains: ['spear', 'sword', 'guard', 'berserk'],
    desc: 'Melatih infanteri.',
  },
  range: {
    name: 'Lapangan Panah', size: 3, era: 1, cost: { wood: 150 }, time: 35, hp: 1000, sight: 5,
    trains: ['archer', 'ranger'],
    desc: 'Melatih pemanah.',
  },
  stable: {
    name: 'Istal', size: 3, era: 1, cost: { wood: 160 }, time: 35, hp: 1000, sight: 5,
    trains: ['rider', 'harcher'],
    desc: 'Melatih kavaleri.',
  },
  smithy: {
    name: 'Pandai Besi', size: 2, era: 1, cost: { wood: 150 }, time: 30, hp: 900, sight: 4,
    desc: 'Meneliti peningkatan senjata dan zirah.',
  },
  workshop: {
    name: 'Bengkel Pelontar', size: 3, era: 2, cost: { wood: 200, gold: 50 }, time: 40, hp: 1000, sight: 5,
    trains: ['catapult'],
    desc: 'Merakit Pelontar Batu.',
  },
  tower: {
    name: 'Menara Jaga', size: 1, era: 1, cost: { stone: 100, wood: 40 }, time: 30, hp: 800, sight: 8,
    atk: 7, range: 7, cooldown: 1.6, garrison: 4,
    desc: 'Menembaki musuh yang mendekat.',
  },
  market: {
    name: 'Pasar', size: 3, era: 1, cost: { wood: 150 }, time: 35, hp: 900, sight: 5,
    desc: 'Menukar Pangan, Kayu, dan Batu dengan Emas. Harga naik tiap dibeli, turun tiap dijual.',
  },
  wall: {
    name: 'Tembok Batu', size: 1, era: 0, cost: { stone: 6 }, time: 6, hp: 700, sight: 2, barrier: true,
    desc: 'Menghalangi semua unit. Seret di peta untuk membangun sebaris tembok.',
  },
  gate: {
    name: 'Gerbang', size: 1, era: 0, cost: { stone: 30 }, time: 14, hp: 900, sight: 2, barrier: true, gate: true,
    desc: 'Hanya bisa dilewati unit sendiri. Bisa diletakkan di atas Tembok Batu milik sendiri.',
  },
};

// Menu bangun pekerja: halaman utama (11 bangunan + tombol pindah halaman) dan halaman kedua.
BF.BUILD_MENU = ['house', 'farm', 'storage', 'barracks', 'range', 'stable', 'smithy', 'workshop', 'tower', 'wall', 'gate'];
BF.BUILD_MENU2 = ['market', 'townhall'];

// Pasar: harga (emas per lot satuan) dipakai bersama kedua pemain. Membeli dikenai +fee, menjual −fee; tiap transaksi
// menggeser harga sebesar step (beli → naik, jual → turun) dalam batas min..max, lalu tiap 10 detik harga kembali
// mendekati harga dasar sebesar drift dari selisihnya.
BF.MARKET = { lot: 100, base: { food: 100, wood: 100, stone: 130 }, fee: 0.3, step: 0.04, drift: 0.03, min: 25, max: 400 };

// Teknologi: diteliti di bangunan `at`. req = teknologi prasyarat.
BF.TECHS = {
  kapak: {
    name: 'Kapak Ganda', at: 'storage', era: 0, cost: { food: 100, wood: 50 }, time: 25,
    desc: 'Pekerja menebang kayu 20% lebih cepat.', effects: [{ p: 'gather.wood', mul: 1.2 }],
  },
  bajak: {
    name: 'Bajak Kerbau', at: 'storage', era: 0, cost: { food: 75, wood: 75 }, time: 25,
    desc: 'Ladang menghasilkan pangan 25% lebih cepat.', effects: [{ p: 'gather.farm', mul: 1.25 }],
  },
  beliung: {
    name: 'Beliung Baja', at: 'storage', era: 1, cost: { food: 150, wood: 100 }, time: 30,
    desc: 'Emas dan batu ditambang 20% lebih cepat.', effects: [{ p: 'gather.gold', mul: 1.2 }, { p: 'gather.stone', mul: 1.2 }],
  },
  gerobak: {
    name: 'Gerobak Dorong', at: 'townhall', era: 1, cost: { food: 175, wood: 50 }, time: 35,
    desc: 'Pekerja membawa +5 sumber daya dan bergerak 10% lebih cepat.',
    effects: [{ p: 'carry', add: 5 }, { u: 'worker', stat: 'speed', mul: 1.1 }],
  },
  tukang: {
    name: 'Tukang Batu', at: 'townhall', era: 1, cost: { wood: 150, stone: 100 }, time: 40,
    desc: 'Semua bangunan dan tembok +20% daya tahan.', effects: [{ b: '*', stat: 'hp', mul: 1.2 }],
  },
  tempa: {
    name: 'Tempa Besi', at: 'smithy', era: 1, cost: { food: 150, gold: 100 }, time: 35,
    desc: 'Infanteri dan kavaleri +2 serangan.',
    effects: [{ u: 'cls:infantry', stat: 'atk', add: 2 }, { u: 'cls:cavalry', stat: 'atk', add: 2 }],
  },
  tempa2: {
    name: 'Baja Lipat', at: 'smithy', era: 2, req: 'tempa', cost: { food: 300, gold: 250 }, time: 50,
    desc: 'Infanteri dan kavaleri +2 serangan lagi.',
    effects: [{ u: 'cls:infantry', stat: 'atk', add: 2 }, { u: 'cls:cavalry', stat: 'atk', add: 2 }],
  },
  zirah: {
    name: 'Zirah Sisik', at: 'smithy', era: 1, cost: { food: 150, gold: 100 }, time: 35,
    desc: 'Infanteri dan kavaleri +1 zirah.',
    effects: [{ u: 'cls:infantry', stat: 'armor', add: 1 }, { u: 'cls:cavalry', stat: 'armor', add: 1 }],
  },
  zirah2: {
    name: 'Zirah Pelat', at: 'smithy', era: 2, req: 'zirah', cost: { food: 300, gold: 200 }, time: 50,
    desc: 'Infanteri dan kavaleri +1 zirah lagi, pemanah +1 zirah.',
    effects: [{ u: 'cls:infantry', stat: 'armor', add: 1 }, { u: 'cls:cavalry', stat: 'armor', add: 1 }, { u: 'cls:archer', stat: 'armor', add: 1 }],
  },
  panah: {
    name: 'Mata Panah Baja', at: 'smithy', era: 1, cost: { food: 100, gold: 150 }, time: 35,
    desc: 'Pemanah, Menara Jaga, dan Balai Kota +1 serangan dan +1 jarak tembak.',
    effects: [
      { u: 'cls:archer', stat: 'atk', add: 1 }, { u: 'cls:archer', stat: 'range', add: 1 },
      { b: 'tower', stat: 'atk', add: 1 }, { b: 'tower', stat: 'range', add: 1 },
      { b: 'townhall', stat: 'atk', add: 1 }, { b: 'townhall', stat: 'range', add: 1 },
    ],
  },
  panah2: {
    name: 'Busur Tanduk', at: 'smithy', era: 2, req: 'panah', cost: { food: 250, gold: 250 }, time: 50,
    desc: 'Pemanah +2 serangan.', effects: [{ u: 'cls:archer', stat: 'atk', add: 2 }],
  },
};

// smart: kecerdasan AI — 0 = dasar; 1 = mundur saat kalah jumlah, berburu babi hutan berkelompok, berdagang di pasar;
// 2 = juga menyerang dari dua arah.
BF.DIFF = {
  easy: { label: 'Mudah', think: 40, firstAttack: 10 * 60 * 20, firstWave: 4, waveGrow: 2, maxWave: 12, maxArmy: 14, maxWorkers: [9, 13, 16], eraWorkers: [9, 13], towers: 0, techs: 2, smart: 0 },
  normal: { label: 'Sedang', think: 20, firstAttack: 7 * 60 * 20, firstWave: 6, waveGrow: 3, maxWave: 22, maxArmy: 26, maxWorkers: [12, 18, 24], eraWorkers: [11, 16], towers: 1, techs: 6, smart: 1 },
  hard: { label: 'Sulit', think: 20, firstAttack: 4.5 * 60 * 20, firstWave: 7, waveGrow: 4, maxWave: 34, maxArmy: 40, maxWorkers: [14, 22, 30], eraWorkers: [12, 18], towers: 2, techs: 99, smart: 2 },
};
