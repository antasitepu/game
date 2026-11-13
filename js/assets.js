'use strict';
// Pemuat aset hasil olahan tools/aset: model pindai yang sudah disederhanakan (beberapa LOD), model berkerangka
// beranimasi, tekstur tanah, dan langit HDRI untuk pantulan. Dimuat sekali sebelum permainan dimulai (butuh server; lihat server.js).
(function () {
  const assets = BF.assets = { model: {}, tex: {}, bahan: {}, langit: null, matahari: null };
  const DASAR = 'assets/';
  const pad4 = n => (n + 3) & ~3;
  const linear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

  function ambil(file, jenis) {
    return fetch(DASAR + file).then(r => { if (!r.ok) throw new Error(file + ' (' + r.status + ')'); return r[jenis](); });
  }

  function tekstur(file, warna) {
    return new Promise((res, rej) => new THREE.TextureLoader().load(DASAR + file, t => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      if (warna) t.encoding = THREE.sRGBEncoding;
      res(t);
    }, undefined, () => rej(new Error(file))));
  }

  // Daun, semak, rumput: warna per-vertex, dua sisi. Normal tidak dibalik di sisi belakang karena alat aset
  // sudah mengarahkannya keluar tajuk (peneduhan tajuk yang lembut, bukan berbintik per helai).
  function bahanDaun() {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
    m.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal = normal * faceDirection;', ''));
    };
    return m;
  }

  // Kerangka & klip animasi model berkerangka (lihat tulisKerangka di tools/aset/olah.mjs). IBM dan klip dipakai bersama
  // oleh semua objek model itu; tulangnya dibuat per objek lewat assets.kerangkaBaru.
  const SIFAT = { t: ['position', 3], r: ['quaternion', 4], s: ['scale', 3] };
  function bangunKerangka(def, buf) {
    const tulang = def.kerangka.tulang, ibm = tulang.map((_, k) => new THREE.Matrix4().fromArray(new Float32Array(buf, def.kerangka.ibm + k * 64, 16)));
    const klip = {};
    for (const nama in def.klip) {
      const c = def.klip[nama];
      klip[nama] = new THREE.AnimationClip(nama, c.durasi, c.jalur.map(j => {
        const [sifat, n] = SIFAT[j.sifat], waktu = new Float32Array(buf, j.off, j.n), nilai = new Float32Array(buf, j.off + j.n * 4, j.n * n);
        const Jalur = j.sifat === 'r' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
        return new Jalur(tulang[j.tulang].nama + '.' + sifat, waktu, nilai, j.step ? THREE.InterpolateDiscrete : undefined);
      }));
    }
    return { kerangka: { tulang, ibm }, klip };
  }

  // Tulang baru (pose istirahat) untuk satu objek model berkerangka. Hasil: { akar: [Bone] untuk ditambahkan ke SkinnedMesh, skeleton }.
  assets.kerangkaBaru = function (model) {
    const def = model.kerangka.tulang, tulang = def.map(d => {
      const b = new THREE.Bone();
      b.name = d.nama;
      b.position.fromArray(d.t); b.quaternion.fromArray(d.r);
      if (d.s) b.scale.fromArray(d.s);
      return b;
    });
    const akar = [];
    def.forEach((d, k) => (d.induk < 0 ? akar.push(tulang[k]) : tulang[d.induk].add(tulang[k])));
    return { akar, skeleton: new THREE.Skeleton(tulang, model.kerangka.ibm) };
  };

  // Tata letak biner per LOD (lihat tools/aset/olah.mjs): pos f32, normal i8, uv f32, warna u8 (sRGB), indeks u16, lalu bila ada
  // kerangka: nomor tulang u8×4 dan bobot u8×4 mulai dari l.kulit; tiap blok rata 4 byte.
  // LOD dengan `bersama` hanya berisi indeks (u16 mulai dari l.idx): vertexnya milik LOD nomor `bersama`.
  function bangunModel(def, buf, tx, bersama) {
    const lod = [];
    def.lod.forEach(l => {
      if (l.bersama !== undefined) {
        const g = new THREE.BufferGeometry(), asal = lod[l.bersama];
        for (const nama in asal.attributes) g.setAttribute(nama, asal.attributes[nama]);
        g.setIndex(new THREE.BufferAttribute(new Uint16Array(buf, l.idx, l.i), 1));
        for (const [mulai, jumlah, bahan] of l.grup) g.addGroup(mulai, jumlah, bahan);
        g.boundingSphere = asal.boundingSphere.clone();
        lod.push(g);
        return;
      }
      let o = l.off;
      const pos = new Float32Array(buf, o, l.v * 3); o += l.v * 12;
      const nor = new Int8Array(buf, o, l.v * 3); o += pad4(l.v * 3);
      const uv = new Float32Array(buf, o, l.v * 2); o += l.v * 8;
      const c8 = new Uint8Array(buf, o, l.v * 3); o += pad4(l.v * 3);
      const idx = new Uint16Array(buf, o, l.i), col = new Float32Array(l.v * 3);
      for (let i = 0; i < col.length; i++) col[i] = linear(c8[i] / 255);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      if (l.kulit !== undefined) {
        g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint8Array(buf, l.kulit, l.v * 4), 4));
        g.setAttribute('skinWeight', new THREE.BufferAttribute(new Uint8Array(buf, l.kulit + l.v * 4, l.v * 4), 4, true));
      }
      for (const [mulai, jumlah, bahan] of l.grup) g.addGroup(mulai, jumlah, bahan);
      g.computeBoundingSphere();
      lod.push(g);
    });
    const bahan = def.bahan.map(b => {
      if (bersama[b.jenis]) return bersama[b.jenis];
      if (b.jenis === 'bangunan') return null;         // bahan pustaka bangunan (BF.tex.mat[kunci]): dipasang pemakainya, lihat `kunci` di bawah
      const m = new THREE.MeshStandardMaterial({ map: tx[b.peta], normalMap: b.normal ? tx[b.normal] : null, roughness: b.kasar, metalness: 0 });
      if (b.orm) { m.roughnessMap = m.metalnessMap = tx[b.orm]; m.roughness = m.metalness = 1; }   // peta G = kekasaran, B = logam (helm, mata tombak)
      if (b.tim) m.userData.tim = true;                // bahan yang dikalikan warna tim oleh pemakainya (mis. tunik pekerja)
      return m;
    });
    // bangunan rakitan: kunci[i] = kunci bahan grup ke-i, tim[i] = diwarnai tim; tapak & badan untuk penempatan dan perancah
    const rakitan = def.badan ? { kunci: def.bahan.map(b => b.kunci), tim: def.bahan.map(b => !!b.tim), tapak: def.tapak, badan: def.badan } : null;
    return Object.assign({ lod, bahan, tinggi: def.tinggi, radius: def.radius }, def.kerangka ? bangunKerangka(def, buf) : null, rakitan);
  }

  // Langit: byte RGBE (baris 0 = bawah) → tekstur equirectangular half-float.
  function bangunLangit(def, buf) {
    const src = new Uint8Array(buf), n = def.w * def.h, data = new Uint16Array(n * 4), half = THREE.DataUtils.toHalfFloat, satu = half(1);
    for (let i = 0; i < n; i++) {
      const e = src[i * 4 + 3], f = e ? Math.pow(2, e - 136) : 0;
      data[i * 4] = half(src[i * 4] * f); data[i * 4 + 1] = half(src[i * 4 + 1] * f); data[i * 4 + 2] = half(src[i * 4 + 2] * f); data[i * 4 + 3] = satu;
    }
    const t = new THREE.DataTexture(data, def.w, def.h, THREE.RGBAFormat, THREE.HalfFloatType);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  assets.muat = async function () {
    const man = await ambil('manifest.json', 'json'), perlu = new Map();          // file tekstur → apakah tekstur warna (sRGB)
    for (const t of Object.values(man.tekstur)) perlu.set(t.file, t.warna);
    for (const d of Object.values(man.model)) for (const b of d.bahan) if (b.jenis === 'tekstur') { perlu.set(b.peta, true); if (b.normal) perlu.set(b.normal, false); if (b.orm) perlu.set(b.orm, false); }
    const fileTex = [...perlu.keys()], namaModel = Object.keys(man.model);
    const [gbr, bin, langit] = await Promise.all([
      Promise.all(fileTex.map(f => tekstur(f, perlu.get(f)))),
      Promise.all(namaModel.map(n => ambil(man.model[n].file, 'arrayBuffer'))),
      ambil(man.langit.file, 'arrayBuffer'),
    ]);
    const tx = {}, bersama = assets.bahan = { daun: bahanDaun(), emas: new THREE.MeshStandardMaterial({ color: 0xf0bd42, roughness: 0.38, metalness: 1 }) };
    fileTex.forEach((f, i) => { tx[f] = gbr[i]; });
    for (const k in man.tekstur) assets.tex[k] = tx[man.tekstur[k].file];
    namaModel.forEach((n, i) => { assets.model[n] = bangunModel(man.model[n], bin[i], tx, bersama); });
    assets.langit = bangunLangit(man.langit, langit);
    assets.matahari = man.langit.matahari;
  };
})();
