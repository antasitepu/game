# Menyajikan Benteng Fajar ke publik

Seluruh layanan adalah satu proses Node (`server.js`, tanpa dependency): menyajikan file game dan menjadi relay
WebSocket untuk ruangan multiplayer (2–4 pemain). Server tidak menyimpan apa pun: tanpa akun, tanpa basis data, tanpa
log alamat IP. Semua ruangan hanya ada di memori — **memulai ulang server memutus semua permainan yang sedang berjalan**.

## Yang dibutuhkan

- Node 20 atau lebih baru.
- Sebuah reverse proxy yang mengurus HTTPS (Caddy, nginx, atau layanan sejenis). Peramban hanya mengizinkan WebSocket
  aman (`wss://`) dari halaman HTTPS, dan klien memilihnya otomatis; `server.js` sendiri hanya berbicara HTTP biasa.

## Menjalankan

```sh
HOST=127.0.0.1 PORT=8080 TRUST_PROXY=1 node server.js
```

Contoh Caddy (sertifikat TLS diurus otomatis; WebSocket ikut diteruskan):

```
game.contoh.id {
    reverse_proxy 127.0.0.1:8080
}
```

Contoh nginx (bagian `location`):

```
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 120s;
}
```

Proxy harus meneruskan kepala `Host` apa adanya: server hanya menerima WebSocket dari halaman yang host-nya sama.

Supaya server hidup lagi setelah mesin dinyalakan ulang atau prosesnya berhenti, jalankan lewat pengelola layanan.
Contoh unit systemd (`/etc/systemd/system/benteng-fajar.service`; belum dicoba — mesin pengembangan memakai macOS):

```
[Unit]
Description=Benteng Fajar
After=network.target

[Service]
WorkingDirectory=/srv/benteng-fajar
Environment=HOST=127.0.0.1 PORT=8080 TRUST_PROXY=1
ExecStart=/usr/bin/node server.js
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

Yang perlu ada di server hanya `server.js`, `index.html`, dan folder `js`, `css`, `assets` (folder `tests` dan `tools`
tidak dibutuhkan dan tidak pernah disajikan).

## Pengaturan (variabel lingkungan)

| Variabel | Bawaan | Arti |
|---|---|---|
| `PORT`, `HOST` | `8080`, `0.0.0.0` | Alamat dengar. Di belakang proxy pakai `HOST=127.0.0.1`. |
| `TRUST_PROXY` | mati | `1` bila ada **satu** reverse proxy tepercaya di depan: alamat pemain dibaca dari `CF-Connecting-IP` atau entri terakhir `X-Forwarded-For`. Jangan dinyalakan bila server terbuka langsung ke internet — pemain bisa memalsukan kepala itu. Tanpa ini, semua pemain tampak beralamat sama (alamat proxy) dan batas per alamat akan mengenai semua orang. |
| `ALLOWED_ORIGINS` | kosong | Daftar asal (dipisah koma) yang boleh membuka WebSocket, mis. `https://game.contoh.id`. Kosong = hanya halaman dari host yang sama. |
| `MAX_CONN`, `MAX_ROOMS` | `400`, `200` | Batas total koneksi dan ruangan. |
| `MAX_CONN_PER_IP` | `16` | Koneksi serentak per alamat (satu rumah atau sekolah bisa berbagi alamat). |
| `ROOMS_PER_IP_PER_MIN` | `10` | Ruangan baru per alamat per menit. |
| `JOIN_FAILS_PER_IP_PER_MIN` | `20` | Percobaan gabung yang gagal per alamat per menit (juga 6 per koneksi) — mencegah menebak kode ruangan. |
| `IDLE_MS` | `30000` | Koneksi yang tidak masuk ruangan mana pun diputus. |
| `LOBBY_MS` | `1800000` | Ruangan yang tidak kunjung dimulai ditutup. |
| `STALL_MS` | `30000` | Ruangan yang macet menunggu seorang pemain (tab disembunyikan, perangkat tertidur): pemain yang tertinggal diputus dan dianggap menyerah. |
| `DEAD_MS` | `600000` | Ruangan bermain yang sunyi total dikosongkan. |
| `RECONNECT_MS` | `30000` | Kursi pemain yang koneksinya putus di tengah permainan ditahan selama ini; pemain lain menunggu. Bila ia tidak kembali, ia dianggap menyerah. |
| `LIVE_MS` | `12000` | Klien di permainan yang tidak mengirim apa pun (klien mengirim tanda hidup tiap 2,5 detik) dianggap putus — untuk sambungan seluler yang menggantung tanpa tertutup. |

## Pemantauan

`GET /healthz` menjawab `{"ok":true,"build":"…","rooms":N,"conns":N}` — tanpa data pemain.

## Memperbarui game

1. Ganti file, lalu mulai ulang proses (`SIGTERM` menutup koneksi dengan rapi). Permainan yang sedang berjalan terputus.
2. Versi game (`build`) dihitung dari isi `index.html`, `/js`, dan `/css`, dan disisipkan ke halaman. Pemain yang masih
   membuka halaman lama tidak bisa masuk ruangan pemain berhalaman baru; mereka diberi pesan untuk memuat ulang.
3. File disajikan dengan `ETag` dan `Cache-Control: no-cache`: peramban selalu bertanya ulang dan hanya mengunduh file
   yang berubah. File teks dan model dikompresi gzip.

## Kapasitas (terukur di Apple M1, klien dan server di mesin yang sama, tanpa TLS)

| Beban | CPU server | Memori | Paket hilang |
|---|---|---|---|
| 100 ruangan × 4 pemain (4.000 paket masuk/detik) | ±26% satu inti | 48 MB | 0 |
| 400 ruangan × 4 pemain (16.000 paket masuk/detik) | ±33% satu inti | 61 MB | 0 |

Untuk beban sebesar itu naikkan `MAX_CONN` dan `MAX_ROOMS`. Server berjalan pada satu inti; lebih dari satu proses
belum didukung (ruangan ada di memori satu proses).

## Yang belum ada

- Sambung ulang hanya menyelamatkan koneksi yang putus selagi halaman masih terbuka. Pemain yang memuat ulang halaman
  atau menutup aplikasinya kehilangan keadaan permainannya dan dianggap keluar.
- Menjalankan beberapa proses/mesin sekaligus.
- Uji di jaringan nyata dengan latensi tinggi untuk 3–4 pemain.
