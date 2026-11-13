'use strict';
// Pemuat aset hasil olahan tools/aset: model pindai yang sudah disederhanakan (beberapa LOD), tekstur tanah,
// dan langit HDRI untuk pantulan. Dimuat sekali sebelum permainan dimulai (butuh server; lihat server.js).
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

  // Tata letak biner per LOD (lihat tools/aset/olah.mjs): pos f32, normal i8, uv f32, warna u8 (sRGB), indeks u16; tiap blok rata 4 byte.
  function bangunModel(def, buf, tx, bersama) {
    const lod = def.lod.map(l => {
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
      for (const [mulai, jumlah, bahan] of l.grup) g.addGroup(mulai, jumlah, bahan);
      g.computeBoundingSphere();
      return g;
    });
    const bahan = def.bahan.map(b => bersama[b.jenis] || new THREE.MeshStandardMaterial({ map: tx[b.peta], normalMap: b.normal ? tx[b.normal] : null, roughness: b.kasar, metalness: 0 }));
    return { lod, bahan, tinggi: def.tinggi, radius: def.radius };
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
    for (const d of Object.values(man.model)) for (const b of d.bahan) if (b.jenis === 'tekstur') { perlu.set(b.peta, true); if (b.normal) perlu.set(b.normal, false); }
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
