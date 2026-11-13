# Prompt untuk generator 3D AI (bangunan & unit)

Alam (pohon, batu, semak, rumput, tanah) serta tembok, gerbang, dan menara sudah memakai model pindai, dan semua
bangunan sudah bertekstur foto. Bentuk bangunan lain dan semua unit tetap buatan kode (unit sudah dirancang ulang agar
lebih halus). File ini berisi prompt bila suatu saat ingin menggantinya dengan model dari generator AI (Meshy, Tripo,
dan sejenisnya) — langkah itu butuh akun Anda sendiri.

## Cara mencoba (mulai dari 1–2 model dulu)

1. Buat model dengan prompt di bawah. Bila generator menerima gambar, hasil "image to 3D" biasanya lebih baik
   daripada "text to 3D": buat dulu satu gambar konsep (tampak tiga-perempat dari atas, latar polos), lalu ubah ke 3D.
2. Unduh sebagai **GLB** lengkap dengan tekstur (PBR bila tersedia). Jumlah poligon bebas — alat aset yang menyederhanakannya.
3. Taruh filenya di `tools/aset/buatan/<nama>.glb` (misalnya `tools/aset/buatan/rumah.glb`). Folder itu ikut masuk
   git, karena model buatan sendiri tidak bisa diunduh ulang seperti aset Poly Haven di `tools/aset/sumber/`.
4. Periksa isinya: `node tools/aset/olah.mjs --info tools/aset/buatan/rumah.glb`
5. Kabari saya; dari hasil 1–2 model itu kita nilai mutunya sebelum mengerjakan sisanya.

Catatan lisensi: keluaran paket gratis umumnya berlisensi CC BY 4.0 (wajib mencantumkan atribusi) dan ada yang
tidak mengizinkan pemakaian komersial. Baca ketentuan paket yang dipakai, dan catat sumbernya di `assets/SUMBER.txt`.

## Tambahan yang dipakai di semua prompt bangunan

Unit manusia memakai tambahannya sendiri (lihat bagian Unit); tambahan ini juga dipakai untuk `pelontar`.

> single isolated object, centered, standing on flat ground, no base plate, no background, no people,
> realistic proportions, weathered natural materials, photorealistic PBR textures, soft neutral daylight,
> game asset viewed from above at 40 degrees

Gaya bersama (supaya semua bangunan serasi): *tropical island village of a maritime trading people, hand-built
from timber, bamboo, river stone and thatch*. Jangan menyebut nama game, film, atau merek apa pun di prompt.

## Bangunan

Ukuran tapak dalam tile (1 tile ≈ lebar dua orang dewasa). Warna tim (biru/merah) ditambahkan game — minta atap
berwarna netral.

| Nama file | Bangunan | Tapak | Prompt |
|---|---|---|---|
| `balai` | Balai Kota | 3×3 | A two-storey village great hall on a raised stone platform, wide stone steps at the front, whitewashed stone-block walls, dark timber posts, a broad tiered hipped roof of weathered clay tiles with a small upper tier, carved wooden double door, shuttered windows |
| `rumah` | Rumah | 2×2 | A small rural dwelling on a low stone footing, woven bamboo walls with timber frame, steep gabled roof of thick dry thatch, one plank door, small shuttered window, clay water jar by the door |
| `ladang` | Ladang | 2×2 | A square plot of tilled farmland with neat furrows of dark soil and rows of young green crops, low bamboo fence on the edges, a wooden hoe stuck in the ground (flat, very low) |
| `lumbung` | Lumbung | 2×2 | A timber storehouse raised on short stone piers, plank walls, wide sliding door, hipped thatch roof, stacked sacks, barrels and cut logs beside the entrance |
| `barak` | Barak | 3×3 | A long military barracks with stone lower walls and timber upper walls, clay-tile gabled roof, open training yard in front with wooden practice dummies and a spear rack |
| `panahan` | Lapangan Panah | 3×3 | An archery range: an open-sided timber shelter with a tiled roof, straw target butts on wooden stands, racks of longbows and quivers |
| `istal` | Istal | 3×3 | A horse stable with timber stalls under a long thatched roof, split-rail paddock fence, hay bales, a water trough |
| `pandai` | Pandai Besi | 2×2 | A blacksmith forge: stone workshop open on one side, brick furnace with a tall soot-stained chimney, anvil on a stump, quenching barrel, tools hanging on the wall |
| `bengkel` | Bengkel Pelontar | 3×3 | A siege workshop: a tall open timber shed with heavy beams, sawhorses, stacked planks, large wooden wheels and a half-built catapult frame |

## Unit

Unit butuh animasi (diam, jalan, bekerja, menyerang, mati). Alurnya (contoh untuk `pekerja`; perintah dijalankan dari
folder proyek, butuh Blender):

1. **Model** — buat dengan prompt di bawah (pose A, tangan kosong: senjata/alat dibuat terpisah dan ditempel ke tulang
   tangan di game). Unduh GLB bertekstur ke `tools/aset/buatan/pekerja-ai.glb` (folder ini ikut masuk git).
2. **Rapikan** — gabung mesh, sederhanakan, tegakkan, ekspor FBX untuk Mixamo + pratinjau depan/samping:
   `blender -b --factory-startup --python tools/aset/blender/rapikan.py -- tools/aset/buatan/pekerja-ai.glb tools/aset/sumber/pekerja/pekerja-mixamo.fbx`
   Bila pratinjau "depan" memperlihatkan punggung/samping, ulangi dengan `--putar 180` (atau 90/−90).
3. **Mixamo** (mixamo.com, akun Adobe) — unggah `pekerja-mixamo.fbx`, tandai titik dagu/pergelangan/siku/lutut/selangkangan.
   Unduh FBX: satu kali **With Skin** (pose T) disimpan sebagai `tools/aset/sumber/pekerja/mixamo/model.fbx`, lalu tiap
   animasi **Without Skin**, 30 fps, centang **In Place** bila ada, disimpan dengan nama klipnya: `diam.fbx`, `jalan.fbx`,
   `kerja.fbx`, `serang.fbx`, `mati.fbx` (nama file = nama klip di game).
4. **Gabung** — semua klip ke satu GLB (jari dilebur ke tangan, gerak maju akar dibuang):
   `blender -b --factory-startup --python tools/aset/blender/gabung.py -- tools/aset/sumber/pekerja/mixamo tools/aset/sumber/pekerja.glb`
5. **Olah** — `node tools/aset/olah.mjs pekerja` (resep `pekerja` di olah.mjs) → `assets/m/pekerja.bin` + manifest.

Alat ini diuji ujung-ke-ujung dengan `node tools/aset/uji-kerangka.mjs` (model uji buatan Blender, tanpa akun apa pun).

Unduhan Mixamo dan `pekerja.glb` hasil gabungannya sengaja berada di `tools/aset/sumber/` (tidak masuk git): repo ini
publik, dan file animasi mentah Mixamo tidak boleh dibagikan ulang sebagai aset lepas. Cadangkan folder itu sendiri.

Tambahan untuk prompt unit manusia (pengganti tambahan bangunan):

> single full-body human character, standing upright in a symmetric A-pose, arms straight and held about 45 degrees
> away from the body, legs slightly apart, empty hands, facing forward, plain light-grey background, soft even lighting,
> no cast shadows, realistic proportions, photorealistic PBR textures

Gaya bersama: *villager of a tropical island maritime trading people*. Bila layanannya punya pilihan pose A/T, aktifkan.
Senjata, perisai, dan alat di tangan pada prompt di bawah dihapus dulu saat membuat model (dibuat terpisah). Pakaian
yang nanti diwarnai sesuai tim diminta polos berwarna putih gading, supaya game bisa mewarnainya.

| Nama file | Unit | Prompt |
|---|---|---|
| `pekerja` | Pekerja | A village labourer in a plain undyed off-white cotton tunic reaching the hips and loose brown trousers, wide conical straw hat, barefoot, carrying nothing, neutral A-pose |
| `tombak` | Prajurit Tombak | A foot soldier in quilted cloth armour and a simple iron helmet, round wooden shield on the left arm, long spear in the right hand, neutral A-pose |
| `pedang` | Pendekar Pedang | A swordsman in lamellar armour of small iron plates over a padded coat, open-faced helmet, straight single-handed sword and oval shield, neutral A-pose |
| `pemanah` | Pemanah | A light archer in a leather jerkin and cloth headwrap, quiver on the back, wooden longbow in the left hand, neutral A-pose |
| `kuda` | Penunggang Kuda | A cavalryman in scale armour riding a sturdy brown horse with leather tack, lance held upright, horse standing square |
| `pelontar` | Pelontar Batu (mesin kepung) | A wooden torsion catapult on four solid wheels, throwing arm with a rope sling, iron fittings, stones stacked on the frame |
| `pengawal` | Pengawal Karang (unik) | A heavy guardsman in dark iron plate and mail, tall rectangular shield reinforced with bronze, short thrusting spear, crested helmet, neutral A-pose |
| `pengamuk` | Pengamuk (unik) | A bare-chested war fighter with red body paint, fur mantle on the shoulders, a heavy two-handed axe, wild braided hair, neutral A-pose |
| `pemburu` | Pemburu Rimba (unik) | A forest ranger in a mottled green hooded cloak and leather armour, recurve bow, hunting knife at the belt, neutral A-pose |
| `pemanah-kuda` | Pemanah Berkuda (unik) | A steppe horse archer in a felt coat and fur-trimmed cap on a lean pale horse, short composite bow drawn, quiver at the saddle |
