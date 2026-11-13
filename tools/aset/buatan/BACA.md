# Model buatan sendiri (ikut masuk git)

Model asli yang tidak bisa diunduh ulang, misalnya hasil generator AI:

- `<nama>.glb` — sumber untuk resep di `../olah.mjs` (dicari di sini lebih dulu, baru di `../sumber/`).
- `<nama>-ai.glb` — model unit mentah sebelum dirapikan untuk Mixamo (lihat `../prompt-ai.md`, bagian Unit).

Aturan:

- Catat sumber dan lisensinya di `assets/SUMBER.txt` (paket gratis generator AI umumnya CC BY 4.0: wajib atribusi).
- Jangan taruh unduhan Mixamo (FBX) atau GLB hasil gabungannya di sini. Repo ini publik, dan file animasi mentah
  Mixamo tidak boleh dibagikan ulang sebagai aset lepas. Simpan di `../sumber/<nama>/` (tidak masuk git) dan
  cadangkan sendiri.
- Batas GitHub 100 MB per file. Model AI bertekstur 4K bisa besar; pilih tekstur 2K saat mengunduh bila ada pilihannya.
