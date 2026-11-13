'use strict';
// Model 3D prosedural: bangunan dan unit — disusun dari bentuk dasar lewat kode. Tembok, gerbang, dan menara memakai
// bagian batu hasil pindai dari BF.assets (pohon, batu, semak dirakit di render.js).
// Koordinat model: X = sumbu x tile, Z = sumbu y tile, Y = tinggi; 1 satuan = 1 tile.
(function () {
  const TAU = Math.PI * 2;
  const models = BF.models = {};
  const C = hex => new THREE.Color(hex);
  const WHITE = C('#ffffff'), DARKW = C('#4a3320'), DARK = C('#1a120b'), SKIN = C('#e2b48a');
  const STEEL = C('#b7c0ca'), GOLD = C('#e0bb4e');
  const mul = (c, k) => new THREE.Color(c.r * k, c.g * k, c.b * k);

  // ---------------------------------------------------------------- pembangun mesh

  // Mengumpulkan segitiga per "kunci material"; tiap kunci menjadi satu mesh (hemat draw call).
  class MB {
    // pbr: [kekasaran, kelogaman] yang dicatat per-vertex (dipakai material unit); smooth: geometri three.js mempertahankan
    // normal halusnya alih-alih dibuat bersudut; bone/skinned: tiap vertex diikat ke satu tulang (untuk SkinnedMesh).
    constructor() { this.parts = {}; this.pbr = [0.85, 0]; this.smooth = false; this.bone = 0; this.skinned = false; }
    part(key) { return this.parts[key] || (this.parts[key] = { pos: [], nor: [], uv: [], col: [], rm: [], sk: [] }); }
    // Jalankan fn dengan sifat permukaan pbr, lalu kembalikan yang sebelumnya.
    use(pbr, fn) { const p0 = this.pbr; this.pbr = pbr; fn(); this.pbr = p0; }

    // Poligon cembung, titik berlawanan arah jarum jam dilihat dari luar. UV = jarak dunia (tekstur berulang per tile).
    // ks: kecerahan per titik (untuk gelap di kaki dinding, dsb). uvs: UV per titik bila tidak memakai proyeksi bawaan.
    poly(key, pts, col, ks, flip, uvs) {
      if (flip) { pts = pts.slice().reverse(); if (ks) ks = ks.slice().reverse(); if (uvs) uvs = uvs.slice().reverse(); }
      const p = this.part(key), a = pts[0], b = pts[1], z = pts[pts.length - 1];
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = z[0] - a[0], vy = z[1] - a[1], vz = z[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const lu = Math.hypot(ux, uy, uz) || 1, ex = ux / lu, ey = uy / lu, ez = uz / lu;
      const wx = ny * ez - nz * ey, wy = nz * ex - nx * ez, wz = nx * ey - ny * ex;
      const cc = col || WHITE;
      const put = i => {
        const q = pts[i], dx = q[0] - a[0], dy = q[1] - a[1], dz = q[2] - a[2], k = ks ? ks[i] : 1;
        p.pos.push(q[0], q[1], q[2]);
        p.nor.push(nx, ny, nz);
        if (uvs) p.uv.push(uvs[i][0], uvs[i][1]);
        else p.uv.push(dx * ex + dy * ey + dz * ez, dx * wx + dy * wy + dz * wz);
        p.col.push(cc.r * k, cc.g * k, cc.b * k);
        p.rm.push(this.pbr[0], this.pbr[1]);
        p.sk.push(this.bone);
      };
      for (let i = 1; i < pts.length - 1; i++) { put(0); put(i); put(i + 1); }
    }

    // Kotak. kb/kt: kecerahan vertex bawah/atas (bayangan kontak di kaki). top: gambar bidang atas.
    box(key, x0, y0, z0, x1, y1, z1, col, kb, kt, top) {
      kb = kb === undefined ? 1 : kb; kt = kt === undefined ? 1 : kt;
      const ks = [kb, kb, kt, kt];
      this.poly(key, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], col, ks);
      this.poly(key, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], col, ks);
      this.poly(key, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], col, ks);
      this.poly(key, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], col, ks);
      if (top !== false) this.poly(key, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], col, [kt, kt, kt, kt]);
    }

    // Tambahkan geometri three.js (silinder, bola, dsb) yang sudah ditransformasi. grad: gelap di bawah → terang di atas.
    geom(key, geo, mat4, col, grad) {
      const p = this.part(key), g = geo.index ? geo.toNonIndexed() : geo;
      if (mat4) g.applyMatrix4(mat4);
      if (!this.smooth) g.computeVertexNormals();
      const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, cc = col || WHITE;
      let y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < pos.count; i++) { y0 = Math.min(y0, pos.getY(i)); y1 = Math.max(y1, pos.getY(i)); }
      for (let i = 0; i < pos.count; i++) {
        const k = grad ? grad[0] + (grad[1] - grad[0]) * ((pos.getY(i) - y0) / (y1 - y0 || 1)) : 1;
        p.pos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        p.nor.push(nor.getX(i), nor.getY(i), nor.getZ(i));
        p.uv.push(uv ? uv.getX(i) * 2 : 0, uv ? uv.getY(i) * 2 : 0);
        p.col.push(cc.r * k, cc.g * k, cc.b * k);
        p.rm.push(this.pbr[0], this.pbr[1]);
        p.sk.push(this.bone);
      }
      g.dispose();
    }

    // Salin geometri berindeks (mis. model pindai) dengan transformasi mat4; normal i8 dari berkas aset dinormalkan di sini.
    mesh(key, geo, mat4) {
      const p = this.part(key), P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv, idx = geo.index;
      const nk = N.array instanceof Int8Array ? 1 / 127 : 1, nm = new THREE.Matrix3().getNormalMatrix(mat4), v = new THREE.Vector3();
      for (let j = 0; j < idx.count; j++) {
        const i = idx.getX(j);
        v.fromBufferAttribute(P, i).applyMatrix4(mat4);
        p.pos.push(v.x, v.y, v.z);
        v.set(N.array[i * 3] * nk, N.array[i * 3 + 1] * nk, N.array[i * 3 + 2] * nk).applyMatrix3(nm).normalize();
        p.nor.push(v.x, v.y, v.z);
        p.uv.push(U.getX(i), U.getY(i));
        p.col.push(1, 1, 1);
        p.rm.push(this.pbr[0], this.pbr[1]);
        p.sk.push(this.bone);
      }
    }

    // Profil [jari-jari, y] diputar mengelilingi sumbu Y.
    lathe(key, pts, seg, mat4, col, grad) { this.geom(key, new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg), mat4, col, grad); }
    // Tabung meruncing dari titik a (jari-jari ra) ke b (rb); sx memipihkan penampangnya pada sumbu X.
    tube(key, a, b, ra, rb, seg, col, grad, sx) {
      const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = d.length();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      const m = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(sx || 1, 1, 1));
      this.geom(key, new THREE.CylinderGeometry(rb, ra, len, seg || 8), m, col, grad);
    }

    cyl(key, x, y, z, r0, r1, h, seg, col, grad) {
      this.geom(key, new THREE.CylinderGeometry(r1, r0, h, seg || 8), new THREE.Matrix4().makeTranslation(x, y + h / 2, z), col, grad);
    }
    ball(key, x, y, z, r, col, detail, sx, sy, sz) {
      const m = new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeScale(sx || 1, sy || 1, sz || 1));
      this.geom(key, new THREE.IcosahedronGeometry(r, detail === undefined ? 1 : detail), m, col, [0.72, 1.1]);
    }

    geometry(key) {
      const p = this.parts[key], g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(p.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(p.col, 3));
      g.setAttribute('pbr', new THREE.Float32BufferAttribute(p.rm, 2));
      if (this.skinned) {
        const n = p.sk.length, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) { si[i * 4] = p.sk[i]; sw[i * 4] = 1; }
        g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
        g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      }
      g.computeBoundingSphere();
      return g;
    }

    // Satu mesh per kunci material.
    build(matOf) {
      const group = new THREE.Group();
      for (const key in this.parts) {
        const m = new THREE.Mesh(this.geometry(key), matOf(key));
        m.castShadow = key !== 'glow';
        m.receiveShadow = true;
        m.userData.key = key;
        group.add(m);
      }
      return group;
    }
  }
  models.MB = MB;

  const matOf = key => (key === 'tong' ? BF.assets.model.tong.bahan[0] : BF.tex.mat[key]);

  // ---------------------------------------------------------------- bangunan
  //
  // Bangunan dirakit seperti bangunan sungguhan: alas batu, dinding (batu kasar, plester berangka kayu, atau papan), atap tebal
  // yang menjorok dengan bubungan dan segitiga pelana, kusen serta daun pintu papan yang menonjol dari dinding, cerobong, dan
  // perabot halaman. Warna tim tampil pada kain dan cat: panji, bendera, tirai, daun jendela.
  // Kamera memandang dari arah +X/+Z, jadi muka depan bangunan menghadap +Z atau +X.

  const TIMBER = C('#94785e'), LEAF = C('#a3815f'), IRON = C('#2d2b29'), VOID = C('#17120d'), DRESSED = C('#d6cebd'), DAUB = C('#efe5d0');
  const HAY = C('#e4c67e'), BURLAP = C('#b89e74'), BARK = C('#5e4632'), CUT = C('#d2b083'), POOL = C('#30505a');
  const HEXA_F = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  const vsub = (a, c) => [a[0] - c[0], a[1] - c[1], a[2] - c[2]], vdot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
  const vcross = (a, c) => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
  const vavg = ps => { const s = [0, 0, 0]; for (const p of ps) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } return [s[0] / ps.length, s[1] / ps.length, s[2] / ps.length]; };
  const span = (a, c, n) => Array.from({ length: n + 1 }, (_, i) => a + (c - a) * i / n);
  // Bidang muka dinding: F(u, y, d) → titik dunia; u menyusuri dinding, d menjauh keluar dari permukaannya.
  const FACE = { 'z+': at => (u, y, d) => [u, y, at + d], 'z-': at => (u, y, d) => [u, y, at - d], 'x+': at => (u, y, d) => [at + d, y, u], 'x-': at => (u, y, d) => [at - d, y, u] };

  // Gaya bangunan tiap wangsa: bentuk sama, bahan berbeda. kunci: ganti bahan di mana pun dipakai; atap: ganti bahan atap
  // (atap jerami tebal & menggembung, genteng/batu sabak tipis bergenteng bubungan — bentuknya ikut bahan); rona: pengali warna.
  const GAYA = {
    padang: {},                                                                      // campuran: jerami, genteng tanah liat, batu sabak
    samudra: { kunci: { stone: 'kapur' }, atap: { thatch: 'clay', slate: 'clay' } },  // pesisir: batu dikapur putih, genteng tanah liat
    bara: { atap: { thatch: 'slate', clay: 'slate' }, rona: { stone: [0.7, 0.64, 0.6], planks: [0.8, 0.74, 0.7] } },   // batu gelap, batu sabak
    rimba: { atap: { clay: 'thatch', slate: 'thatch' }, rona: { stone: [0.84, 0.94, 0.78] } },                          // batu berlumut, jerami
  };

  // Pembangun mesh dengan alat-alat pertukangan.
  class Rakit extends MB {
    constructor(owner, faction) {
      super();
      this.team = C(BF.SLOTS[owner].color);
      this.cat = this.team.clone().lerp(C('#6f5d4a'), 0.45);       // cat kayu berwarna tim yang sudah pudar
      this.gaya = GAYA[faction] || GAYA.padang;
      this.meta = {};
      this.scans = [];
    }
    part(key) { return super.part((this.gaya.kunci && this.gaya.kunci[key]) || key); }
    roofKey(key) { return (this.gaya.atap && this.gaya.atap[key]) || key; }
    build(matOf) {
      const rona = this.gaya.rona || {};
      for (const k in rona) if (this.parts[k]) { const c = this.parts[k].col, t = rona[k]; for (let i = 0; i < c.length; i += 3) { c[i] *= t[0]; c[i + 1] *= t[1]; c[i + 2] *= t[2]; } }
      return super.build(matOf);
    }

    // ---- bentuk dasar
    // Poligon cembung yang dihadapkan ke arah dir (urutan titik dibalik bila perlu).
    quad(key, pts, dir, col, ks, uvs) { this.poly(key, pts, col, ks, vdot(vcross(vsub(pts[1], pts[0]), vsub(pts[pts.length - 1], pts[0])), dir) < 0, uvs); }
    // Balok dari 8 sudut: cincin 0–3 lalu 4–7 (titik i+4 di seberang titik i); tiap sisi dihadapkan keluar. Sisi cincin pertama
    // (alas) hanya digambar bila full — tak pernah terlihat dari kamera, tetapi perlu untuk bayangan benda yang melayang.
    hexa(key, P, col, kb, kt, full) {
      const c = vavg(P), k = i => (i < 4 ? (kb === undefined ? 1 : kb) : (kt === undefined ? 1 : kt));
      for (const f of full ? HEXA_F : HEXA_F.slice(1)) { const pts = f.map(i => P[i]); this.quad(key, pts, vsub(vavg(pts), c), col, f.map(k)); }
    }
    // Kotak menempel di bidang dinding F: rentang u, y, dan d (tebal keluar dari permukaan).
    fbox(F, u0, u1, y0, y1, d0, d1, key, col, kb, kt) { this.hexa(key, [F(u0, y0, d0), F(u1, y0, d0), F(u1, y0, d1), F(u0, y0, d1), F(u0, y1, d0), F(u1, y1, d0), F(u1, y1, d1), F(u0, y1, d1)], col, kb, kt); }
    // Balok miring di bidang dinding dari (u0, y0) ke (u1, y1), lebar w.
    fbeam(F, u0, y0, u1, y1, w, d0, d1, key, col) {
      const l = Math.hypot(u1 - u0, y1 - y0), pu = -(y1 - y0) / l * w / 2, py = (u1 - u0) / l * w / 2;
      const ring = d => [F(u0 - pu, y0 - py, d), F(u1 - pu, y1 - py, d), F(u1 + pu, y1 + py, d), F(u0 + pu, y0 + py, d)];
      this.hexa(key, ring(d0).concat(ring(d1)), col);
    }
    fpoly(F, key, pts, d, col) { this.quad(key, pts.map(p => F(p[0], p[1], d)), vsub(F(0, 0, 1), F(0, 0, 0)), col); }
    // Balok mendatar di denah dari (x0, z0) ke (x1, z1), lebar w, setinggi y0..y1.
    rail(key, x0, z0, x1, z1, y0, y1, w, col, full) {
      const l = Math.hypot(x1 - x0, z1 - z0), px = -(z1 - z0) / l * w / 2, pz = (x1 - x0) / l * w / 2;
      const ring = y => [[x0 - px, y, z0 - pz], [x1 - px, y, z1 - pz], [x1 + px, y, z1 + pz], [x0 + px, y, z0 + pz]];
      this.hexa(key, ring(y0).concat(ring(y1)), col, 1, 1, full);
    }
    // Lempeng (atap papan, alas gerobak): 4 sudut permukaan atas berurutan keliling, tebal th ke bawah.
    slab(key, pts, th, col) { this.hexa(key, pts.map(p => [p[0], p[1] - th, p[2]]).concat(pts), col, 0.75, 1, true); }
    block(key, x0, z0, x1, z1, y0, y1, col) { this.box(key, x0, y0, z0, x1, y1, z1, col || null, 0.8, 0.96, false); }
    plinth(x0, z0, x1, z1, h) { this.box('stone', x0, 0, z0, x1, h, z1, C('#b9b1a3'), 0.62, 0.92, true); }
    post(x, z, y0, y1, w) { w = (w || 0.05) / 2; this.box('planks', x - w, y0, z - w, x + w, y1, z + w, TIMBER, 0.8, 1, true); }
    // Batu sudut tempa berselang panjang-pendek di sudut (x, z); sx, sz = arah keluar (±1).
    quoins(x, z, sx, sz, y0, y1) {
      for (let i = 0, y = y0; y < y1 - 0.03; i++, y += 0.095) {
        const a = i % 2 ? 0.1 : 0.17, c = i % 2 ? 0.17 : 0.1, e = 0.008;
        this.box('plaster', sx > 0 ? x - a : x - e, y, sz > 0 ? z - c : z - e, sx > 0 ? x + e : x + a, Math.min(y + 0.088, y1), sz > 0 ? z + e : z + c, DRESSED, 0.92, 1, false);
      }
    }

    // ---- atap
    // Atap dari penampang yang direntang sepanjang bubungan. prof: [titik atas, titik bawah] per stasiun pada bidang (s, y);
    // axis 'x': bubungan sejajar X (s = z), 'z': sejajar Z (s = x). UV: u menyusuri bubungan, v menuruni lereng dari puncak,
    // jadi baris genteng sejajar bubungan di kedua sisi. Sisi bawah tidak digambar (bahannya dua sisi).
    roofExtrude(key, axis, a0, a1, prof, col) {
      const M = axis === 'x' ? (a, s, y) => [a, y, s] : (a, s, y) => [s, y, a], edge = mul(col || WHITE, 0.8), arc = [0];
      for (let i = 1; i < prof.length; i++) arc.push(arc[i - 1] + Math.hypot(prof[i][0][0] - prof[i - 1][0][0], prof[i][0][1] - prof[i - 1][0][1]));
      let r = 0;
      prof.forEach((p, i) => { if (p[0][1] > prof[r][0][1]) r = i; });
      const v = i => -Math.abs(arc[i] - arc[r]);
      for (let i = 0; i < prof.length - 1; i++) {
        const [t0, b0] = prof[i], [t1, b1] = prof[i + 1];
        this.quad(key, [M(a0, t0[0], t0[1]), M(a1, t0[0], t0[1]), M(a1, t1[0], t1[1]), M(a0, t1[0], t1[1])], M(0, t0[0] + t1[0] - b0[0] - b1[0], t0[1] + t1[1] - b0[1] - b1[1]), col, null,
          [[a0, v(i)], [a1, v(i)], [a1, v(i + 1)], [a0, v(i + 1)]]);
        for (const a of [a0, a1]) this.quad(key, [M(a, t0[0], t0[1]), M(a, t1[0], t1[1]), M(a, b1[0], b1[1]), M(a, b0[0], b0[1])], M(a === a0 ? -1 : 1, 0, 0), edge);
      }
      for (const i of [0, prof.length - 1]) {                              // tepi cucuran
        const [t, bt] = prof[i], o = prof[i ? i - 1 : 1][0];
        this.quad(key, [M(a0, t[0], t[1]), M(a1, t[0], t[1]), M(a1, bt[0], bt[1]), M(a0, bt[0], bt[1])], M(0, t[0] - o[0], 0), edge);
      }
    }
    // Atap pelana di atas dinding s0..s1 (melintang bubungan) setinggi y; bubungan naik rise; cucuran menjorok ov; tebal th;
    // ujung atap a0..a1. o.soft: jerami (menggembung, tepi cucuran dipotong miring, gulungan bubungan). o.cap: genteng bubungan.
    // o.end: [kunci, warna, w0, w1] → segitiga pelana di bidang dinding w0 dan w1 (null = tidak ada).
    gable(key, axis, a0, a1, s0, s1, y, rise, ov, th, o) {
      o = o || {};
      key = this.roofKey(key);
      const soft = key === 'thatch', cap = !soft && !!(o.cap || o.soft);
      th = soft ? Math.max(th, 0.1) : Math.min(th, 0.05);
      const M = axis === 'x' ? (a, s, yy) => [a, yy, s] : (a, s, yy) => [s, yy, a];
      const c = (s0 + s1) / 2, half = c - s0, k = rise / half, tv = th * Math.hypot(1, k), col = o.col || WHITE;
      const under = s => y + rise - k * Math.abs(s - c);
      const bulge = s => (soft ? Math.sin(Math.PI * Math.min(1, Math.abs(s - c) / (half + ov))) * th * 0.35 : 0);
      const ss = soft ? [s0 - ov, s0 - ov * 0.25, (s0 + c) / 2, c, (c + s1) / 2, s1 + ov * 0.25, s1 + ov] : [s0 - ov, c, s1 + ov];
      const prof = ss.map(s => [[s, under(s) + tv + bulge(s)], [s, under(s)]]);
      if (soft) { const bv = th * 0.8, n = prof.length - 1; prof[0][1] = [s0 - ov + bv, under(s0 - ov + bv)]; prof[n][1] = [s1 + ov - bv, under(s1 + ov - bv)]; }
      this.roofExtrude(key, axis, a0, a1, prof, col);
      const top = y + rise + tv;
      if (soft) this.tube(key, M(a0 - 0.03, c, top - th * 0.2), M(a1 + 0.03, c, top - th * 0.2), th * 0.7, th * 0.7, 8, mul(col, 0.82));
      if (cap) this.tube(key, M(a0 - 0.01, c, top), M(a1 + 0.01, c, top), 0.038, 0.038, 6, mul(col, 0.72));
      if (o.end) {
        const [ek, ecol, w0, w1] = o.end;
        for (const w of [w0, w1]) if (w !== null && w !== undefined) this.quad(ek, [M(w, s0, y), M(w, s1, y), M(w, c, y + rise)], M(w === w0 ? -1 : 1, 0, 0), ecol);
      }
      return top;
    }
    // Atap sandar satu lereng: tepi tinggi di sHi (setinggi yHi) turun ke sLo (yLo).
    shed(key, axis, a0, a1, sHi, yHi, sLo, yLo, th, col) {
      key = this.roofKey(key);
      if (key === 'thatch') th = Math.max(th, 0.08);
      const tv = th * Math.hypot(1, (yHi - yLo) / Math.abs(sLo - sHi));
      this.roofExtrude(key, axis, a0, a1, [[[sHi, yHi + tv], [sHi, yHi]], [[sLo, yLo + tv], [sLo, yLo]]], col);
    }
    // Atap perisai/limas di atas denah x0..x1 × z0..z1 setinggi y; lereng sama di keempat sisi (puncak tunggal bila persegi).
    hipRoof(key, x0, z0, x1, z1, y, rise, ov, th, o) {
      o = o || {};
      key = this.roofKey(key);
      const cap = o.cap && key !== 'thatch';
      if (key === 'thatch') th = Math.max(th, 0.08);
      const hx = (x1 - x0) / 2, hz = (z1 - z0) / 2, h = Math.min(hx, hz), k = rise / h, tv = th * Math.hypot(1, k), sl = Math.hypot(1, k) / k;
      const ye = y - k * ov + tv, top = y + rise + tv, col = o.col || WHITE;
      const E = [[x0 - ov, ye, z0 - ov], [x1 + ov, ye, z0 - ov], [x1 + ov, ye, z1 + ov], [x0 - ov, ye, z1 + ov]];
      const R = hx >= hz ? [[x0 + h, top, z0 + hz], [x1 - h, top, z0 + hz]] : [[x0 + hx, top, z0 + h], [x0 + hx, top, z1 - h]];
      const near = p => (Math.hypot(p[0] - R[0][0], p[2] - R[0][2]) <= Math.hypot(p[0] - R[1][0], p[2] - R[1][2]) ? R[0] : R[1]);
      for (let i = 0; i < 4; i++) {
        const a = E[i], c = E[(i + 1) % 4], ra = near(a), rc = near(c), alongX = i % 2 === 0;
        const pts = ra === rc ? [a, c, rc] : [a, c, rc, ra], out = alongX ? [0, 1, i === 0 ? -1 : 1] : [i === 1 ? 1 : -1, 1, 0];
        this.quad(key, pts, out, col, null, pts.map(p => [alongX ? p[0] : p[2], -(top - p[1]) * sl]));
        this.quad(key, [a, c, [c[0], c[1] - tv, c[2]], [a[0], a[1] - tv, a[2]]], [out[0], 0, out[2]], mul(col, 0.8));
        if (cap) this.tube(key, a, ra, 0.035, 0.03, 6, mul(col, 0.72));
      }
      if (cap && (R[0][0] !== R[1][0] || R[0][2] !== R[1][2])) this.tube(key, R[0], R[1], 0.035, 0.035, 6, mul(col, 0.72));
      return top;
    }

    // ---- bukaan dan rangka dinding
    // Papan tegak berjajar (daun pintu, daun jendela): n bilah dengan celah tipis dan rona berselang.
    planksV(F, u0, u1, y0, y1, d0, d1, col, n) {
      const w = (u1 - u0) / n;
      for (let i = 0; i < n; i++) this.fbox(F, u0 + i * w + 0.003, u0 + (i + 1) * w - 0.003, y0, y1, d0, d1, 'planks', mul(col, [1.04, 0.92, 1, 0.88][i % 4]));
    }
    steps(F, u0, u1, y0) {
      const n = Math.max(1, Math.round(y0 / 0.06)), h = y0 / n;
      for (let i = 0; i < n; i++) this.fbox(F, u0 - i * 0.012, u1 + i * 0.012, 0, y0 - i * h, 0, 0.065 * (i + 1), 'plaster', mul(DRESSED, 0.9), 0.8, 1);
    }
    // Jendela: lubang gelap, tiang & palang tengah, ambang bawah menonjol, kusen (o.frame === false: tanpa kusen — dinding
    // berangka kayu sudah membingkainya). o.stone: kusen batu tempa. o.shut: daun penutup papan terbuka berwarna cat itu.
    win(F, u0, u1, y0, y1, o) {
      o = o || {};
      const f = 0.03, K = o.stone ? 'plaster' : 'planks', kc = o.stone ? DRESSED : TIMBER, um = (u0 + u1) / 2, ym = y0 + (y1 - y0) * 0.55;
      this.fbox(F, u0, u1, y0, y1, 0, 0.004, 'flat', VOID);
      this.fbox(F, um - 0.009, um + 0.009, y0, y1, 0, 0.016, 'planks', TIMBER);
      this.fbox(F, u0, u1, ym - 0.008, ym + 0.008, 0, 0.016, 'planks', TIMBER);
      if (o.frame !== false) {
        this.fbox(F, u0 - f, u0, y0, y1, 0, 0.035, K, kc);
        this.fbox(F, u1, u1 + f, y0, y1, 0, 0.035, K, kc);
        this.fbox(F, u0 - f, u1 + f, y1, y1 + f * 1.3, 0, 0.04, K, kc);
      }
      this.fbox(F, u0 - f * 1.5, u1 + f * 1.5, y0 - f, y0 + 0.006, 0, 0.06, K, kc);
      if (o.shut) { const w = (u1 - u0) / 2; this.planksV(F, u0 - f - w, u0 - f, y0, y1, 0.024, 0.036, o.shut, 2); this.planksV(F, u1 + f, u1 + f + w, y0, y1, 0.024, 0.036, o.shut, 2); }
    }
    // Pintu papan dengan engsel besi panjang; anak tangga batu bila lantainya terangkat.
    door(F, u0, u1, y0, y1, o) {
      o = o || {};
      const f = 0.035, K = o.stone ? 'plaster' : 'planks', kc = o.stone ? DRESSED : TIMBER, h = y1 - y0;
      this.fbox(F, u0, u1, y0, y1, 0, 0.004, 'flat', VOID);
      this.planksV(F, u0, u1, y0, y1, 0.004, 0.016, LEAF, Math.max(3, Math.round((u1 - u0) / 0.07)));
      for (const k of [0.2, 0.75]) this.fbox(F, u0 + 0.012, u1 - 0.05, y0 + h * k, y0 + h * k + 0.022, 0.016, 0.023, 'flat', IRON);
      this.fbox(F, u1 - 0.05, u1 - 0.034, y0 + h * 0.46, y0 + h * 0.52, 0.016, 0.03, 'flat', IRON);
      if (o.frame !== false) {
        this.fbox(F, u0 - f, u0, y0, y1, 0, 0.04, K, kc);
        this.fbox(F, u1, u1 + f, y0, y1, 0, 0.04, K, kc);
        this.fbox(F, u0 - f, u1 + f, y1, y1 + f * 1.2, 0, 0.045, K, kc);
      }
      if (y0 > 0.04 && o.steps !== false) this.steps(F, u0 - 0.04, u1 + 0.04, y0);
    }
    // Pintu (atau lubang saja bila o.hole) berambang lengkung batu tempa: lebar w, bagian tegak setinggi h di atas y0.
    archDoor(F, uc, w, y0, h, o) {
      o = o || {};
      const r = w / 2, n = 7, R = 0.075, yc = y0 + h, P = (a, rr, d) => F(uc + Math.cos(a) * rr, yc + Math.sin(a) * rr, d);
      const shape = rr => [[uc - rr, y0], [uc + rr, y0]].concat(span(0, Math.PI, n).map(a => [uc + Math.cos(a) * rr, yc + Math.sin(a) * rr]));
      this.fpoly(F, 'flat', shape(r), 0.003, VOID);
      if (!o.hole) {
        this.fpoly(F, 'planks', shape(r - 0.014), 0.008, LEAF);
        for (const k of [0.25, 0.8]) this.fbox(F, uc - r + 0.02, uc + r - 0.02, y0 + h * k, y0 + h * k + 0.024, 0.008, 0.016, 'flat', IRON);
        this.fbox(F, uc + r * 0.45, uc + r * 0.45 + 0.025, y0 + h * 0.55, y0 + h * 0.55 + 0.04, 0.008, 0.024, 'flat', IRON);
      }
      for (let i = 0; i < n; i++) {
        const a0 = Math.PI * i / n, a1 = Math.PI * (i + 1) / n;
        this.hexa('plaster', [P(a0, r, 0), P(a1, r, 0), P(a1, r + R, 0), P(a0, r + R, 0), P(a0, r, 0.03), P(a1, r, 0.03), P(a1, r + R, 0.03), P(a0, r + R, 0.03)], mul(DRESSED, i % 2 ? 0.93 : 1.02));
      }
      for (let j = 0; j < 3; j++) {
        const ya = y0 + j * h / 3 + 0.004, yb = y0 + (j + 1) * h / 3, e = j % 2 ? 0.025 : 0;
        this.fbox(F, uc - r - R + e, uc - r, ya, yb, 0, 0.03, 'plaster', DRESSED);
        this.fbox(F, uc + r, uc + r + R - e, ya, yb, 0, 0.03, 'plaster', DRESSED);
      }
      if (!o.hole && y0 > 0.04) this.steps(F, uc - r - 0.05, uc + r + 0.05, y0);
    }
    // Dinding berangka kayu: tiang di posisi us, ambang & balok atas; tiap petak diisi menurut kodenya: '/' '\' penopang
    // miring, 'x' silang, '-' palang tengah, 'w' jendela, 'd' pintu, 's' pintu kandang dua bagian, ' ' kosong.
    timberWall(F, us, y0, y1, bays, o) {
      o = o || {};
      const w = 0.05, d = 0.022, K = 'planks', u0 = us[0], u1 = us[us.length - 1];
      this.fbox(F, u0 - w / 2, u1 + w / 2, y0, y0 + w, 0, d, K, TIMBER);
      this.fbox(F, u0 - w / 2, u1 + w / 2, y1 - w, y1, 0, d, K, TIMBER);
      for (const u of us) this.fbox(F, u - w / 2, u + w / 2, y0 + w, y1 - w, 0, d, K, TIMBER);
      [...bays].forEach((t, i) => {
        const ua = us[i] + w / 2, ub = us[i + 1] - w / 2, uc = (ua + ub) / 2, ym = (y0 + y1) / 2, yb = y0 + w, yt = y1 - w, dh = o.dh || y0 + 0.62;
        if (t === '-') this.fbox(F, ua, ub, ym - w / 2, ym + w / 2, 0, d, K, TIMBER);
        if (t === '/' || t === 'x') this.fbeam(F, ua, yb, ub, yt, w * 0.9, 0, d * 0.9, K, TIMBER);
        if (t === '\\' || t === 'x') this.fbeam(F, ua, yt, ub, yb, w * 0.9, 0, d * 0.8, K, TIMBER);
        if (t === 'w') {
          const hw = Math.min(o.ww || 0.09, (ub - ua) / 2 - 0.02);
          this.fbox(F, ua, ub, o.wy0 - w, o.wy0, 0, d, K, TIMBER);
          this.fbox(F, ua, ub, o.wy1, o.wy1 + w, 0, d, K, TIMBER);
          this.win(F, uc - hw, uc + hw, o.wy0, o.wy1, { frame: false, shut: o.shut });
        }
        if (t === 'd') { this.fbox(F, ua, ub, dh, dh + w, 0, d, K, TIMBER); this.door(F, ua + 0.006, ub - 0.006, yb, dh, { frame: false, steps: o.steps }); }
        if (t === 's') {
          const a = uc - (o.sw || 0.17), c = uc + (o.sw || 0.17);
          this.fbox(F, ua, ub, dh, dh + w, 0, d, K, TIMBER);
          this.fbox(F, a, c, yb, dh, 0, 0.004, 'flat', VOID);
          this.planksV(F, a, c, yb, yb + (dh - yb) * 0.52, 0.004, 0.018, LEAF, 4);
          this.fbox(F, a - 0.03, a, yb, dh, 0, d, K, TIMBER);
          this.fbox(F, c, c + 0.03, yb, dh, 0, d, K, TIMBER);
        }
      });
    }
    // Rangka kayu di segitiga pelana: balok dasar, tiang raja, dua penopang.
    gableFrame(F, s0, s1, y, rise) {
      const c = (s0 + s1) / 2, w = 0.05, d = 0.022;
      this.fbox(F, s0, s1, y, y + w, 0, d, 'planks', TIMBER);
      this.fbox(F, c - w / 2, c + w / 2, y + w, y + rise - 0.05, 0, d, 'planks', TIMBER);
      this.fbeam(F, s0 + (c - s0) * 0.3, y + w, c - w / 2, y + rise * 0.55, w * 0.9, 0, d, 'planks', TIMBER);
      this.fbeam(F, s1 - (s1 - c) * 0.3, y + w, c + w / 2, y + rise * 0.55, w * 0.9, 0, d, 'planks', TIMBER);
    }
    chimney(x, z, wx, wz, y0, y1, smoke) {
      this.box('stone', x - wx / 2, y0, z - wz / 2, x + wx / 2, y1, z + wz / 2, null, 0.85, 1, false);
      this.box('plaster', x - wx / 2 - 0.025, y1, z - wz / 2 - 0.025, x + wx / 2 + 0.025, y1 + 0.05, z + wz / 2 + 0.025, DRESSED, 0.9, 1, true);
      this.box('flat', x - wx / 2 + 0.035, y1 + 0.05, z - wz / 2 + 0.035, x + wx / 2 - 0.035, y1 + 0.052, z + wz / 2 - 0.035, VOID, 1, 1, true);
      if (smoke) this.meta.smoke = [x, y1 + 0.12, z];
    }
    // Panji tim tergantung dari batang besi di dinding; ujung bawah meruncing, lambang belah ketupat emas.
    banner(F, u, yTop, w, h) {
      this.fbox(F, u - w / 2 - 0.035, u + w / 2 + 0.035, yTop, yTop + 0.02, 0, 0.05, 'flat', IRON);
      this.fpoly(F, 'flat', [[u - w / 2, yTop - h], [u, yTop - h - w * 0.4], [u + w / 2, yTop - h], [u + w / 2, yTop], [u - w / 2, yTop]], 0.03, this.team);
      this.fpoly(F, 'flat', [[u, yTop - h * 0.64], [u + w * 0.22, yTop - h * 0.42], [u, yTop - h * 0.2], [u - w * 0.22, yTop - h * 0.42]], 0.033, GOLD);
    }
    flagPole(x, z, y0, y1) {
      this.tube('flat', [x, y0, z], [x, y1, z], 0.02, 0.014, 6, C('#3a2a1b'));
      this.ball('flat', x, y1 + 0.02, z, 0.03, GOLD);
      this.meta.flag = [x, y1 - 0.08, z];
    }

    // ---- perabot halaman
    scan(name, rotY, x, z) {                            // bagian model pindai (BF.assets); rotY 0 = memanjang/menghadap +X
      const a = BF.assets.model[name], m = new THREE.Mesh(a.lod[0], a.bahan.length > 1 ? a.bahan : a.bahan[0]);
      m.position.set(x === undefined ? 0.5 : x, 0, z === undefined ? 0.5 : z);
      m.rotation.y = rotY || 0;
      m.castShadow = m.receiveShadow = true;
      this.scans.push(m);
    }
    barrel(x, z, y) { this.mesh('tong', BF.assets.model.tong.lod[0], mT(x, y || 0, z).multiply(new THREE.Matrix4().makeRotationY((x * 7 + z * 3) % TAU))); }
    // Tumpukan kayu bakar (rows lapis, makin ke atas makin sedikit); ujung potongannya terang menghadap kamera.
    logs(x, z, len, rows, alongX) {
      let n = 0;
      for (let r = 0; r < rows; r++)
        for (let i = 0; i < rows - r + 1; i++) {
          const o = (i - (rows - r) / 2) * 0.078, y = 0.036 + r * 0.066, rr = 0.034 + ((n++ * 7) % 3) * 0.004, j = ((n * 5) % 3 - 1) * 0.02;
          const a = alongX ? [x - len / 2 + j, y, z + o] : [x + o, y, z - len / 2 + j], c = alongX ? [x + len / 2 + j, y, z + o] : [x + o, y, z + len / 2 + j];
          this.tube('flat', a, c, rr, rr, 7, mul(BARK, 0.9 + (n % 3) * 0.08));
          const e = alongX ? [c[0] + 0.004, y, c[2]] : [c[0], y, c[2] + 0.004];
          this.tube('flat', c, e, rr * 0.9, rr * 0.9, 7, CUT);
        }
    }
    sack(x, z, r, y) { y = y || 0; this.ball('flat', x, y + r * 0.72, z, r, BURLAP, 1, 1, 0.8, 0.9); this.ball('flat', x, y + r * 1.42, z, r * 0.33, mul(BURLAP, 0.85), 0); }
    crate(x, z, s, y) {
      y = y || 0;
      this.box('planks', x - s / 2, y, z - s / 2, x + s / 2, y + s, z + s / 2, C('#dcc09a'), 0.75, 1, true);
      for (const k of [0.1, 0.9]) this.box('planks', x - s / 2 - 0.006, y + s * k - 0.012, z - s / 2 - 0.006, x + s / 2 + 0.006, y + s * k + 0.012, z + s / 2 + 0.006, TIMBER, 1, 1, true);
    }
    // Tangga kayu bersandar: kaki di (x, zb) di tanah, puncak menempel di zt setinggi yt.
    ladder(x, zb, zt, yt) {
      for (const s of [-0.09, 0.09]) this.tube('planks', [x + s, 0, zb], [x + s, yt, zt], 0.014, 0.014, 5, TIMBER);
      for (let k = 0.12; k < 0.98; k += 0.17) this.tube('planks', [x - 0.09, yt * k, zb + (zt - zb) * k], [x + 0.09, yt * k, zb + (zt - zb) * k], 0.009, 0.009, 4, TIMBER);
    }
    hay(x0, z0, x1, z1, y0, y1) { this.box('thatch', x0, y0, z0, x1, y1, z1, HAY, 0.72, 1.05, true); }
    staddle(x, z) { this.lathe('stone', [[0, 0], [0.075, 0], [0.05, 0.19], [0.045, 0.2], [0.115, 0.205], [0.12, 0.25], [0, 0.255]], 8, mT(x, 0, z), DRESSED, [0.7, 1]); }
    // Pagar tiang & dua palang menyusuri titik-titik denah pts.
    fence(pts, h) {
      for (const [x, z] of pts) this.box('planks', x - 0.022, 0, z - 0.022, x + 0.022, h, z + 0.022, TIMBER, 0.75, 1, true);
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
        for (const k of [0.42, 0.84]) this.rail('planks', x0, z0, x1, z1, h * k - 0.016, h * k + 0.016, 0.024, mul(TIMBER, 1.15), true);
      }
    }
    trough(x, z, len, alongX) {
      const hx = alongX ? len / 2 : 0.09, hz = alongX ? 0.09 : len / 2;
      this.box('planks', x - hx, 0, z - hz, x + hx, 0.17, z + hz, C('#9c7f60'), 0.75, 1, true);
      this.box('flat', x - hx + 0.025, 0.17, z - hz + 0.025, x + hx - 0.025, 0.172, z + hz - 0.025, POOL, 1, 1, true);
    }
    // Roda kayu: lingkar, poros, dan jari-jari; berdiri di bidang yang tegak lurus sumbu (rot = putaran sumbu dari +Z).
    wheel(x, y, z, r, rot, tilt) {
      const m = mT(x, y, z).multiply(new THREE.Matrix4().makeRotationY(rot || 0)).multiply(mRx(tilt || 0));
      this.geom('flat', new THREE.TorusGeometry(r, 0.018, 5, 16), m, C('#5b4029'));
      this.geom('flat', new THREE.CylinderGeometry(0.03, 0.03, 0.06, 8), m.clone().multiply(mRx(Math.PI / 2)), IRON);
      for (let i = 0; i < 4; i++) this.geom('flat', new THREE.BoxGeometry(0.016, r * 2 - 0.02, 0.016), m.clone().multiply(mRz(Math.PI * i / 4)), C('#6b4c31'));
    }
    cart(x, z, alongX) {
      const P = alongX ? (l, y, w) => [x + l, y, z + w] : (l, y, w) => [x + w, y, z + l], rot = alongX ? 0 : Math.PI / 2;
      this.slab('planks', [P(-0.25, 0.22, -0.15), P(0.25, 0.22, -0.15), P(0.25, 0.22, 0.15), P(-0.25, 0.22, 0.15)], 0.04, C('#c4a47e'));
      for (const s of [-1, 1]) this.hexa('planks', [P(-0.25, 0.22, s * 0.13), P(0.25, 0.22, s * 0.13), P(0.25, 0.22, s * 0.15), P(-0.25, 0.22, s * 0.15), P(-0.25, 0.32, s * 0.13), P(0.25, 0.32, s * 0.13), P(0.25, 0.32, s * 0.15), P(-0.25, 0.32, s * 0.15)], C('#b39470'));
      for (const s of [-1, 1]) {
        const c = P(-0.02, 0.15, s * 0.19);
        this.wheel(c[0], c[1], c[2], 0.15, rot);
        this.tube('planks', P(0.24, 0.2, s * 0.1), P(0.66, 0.05, s * 0.1), 0.016, 0.014, 6, TIMBER);
      }
    }
    dummy(x, z) {                                       // boneka latihan: tiang, lengan palang, badan karung jerami
      this.tube('planks', [x, 0, z], [x, 0.72, z], 0.024, 0.02, 6, TIMBER);
      this.tube('planks', [x - 0.19, 0.52, z], [x + 0.19, 0.52, z], 0.016, 0.016, 6, TIMBER);
      this.ball('flat', x, 0.43, z, 0.11, BURLAP, 1, 0.92, 1.35, 0.78);
      this.ball('flat', x, 0.66, z, 0.06, HAY, 1);
    }
    butt(x, z) {                                        // sasaran panah: bantal jerami bercincin cat di kedua muka, di atas kaki tiga
      const y = 0.46, rot = mRx(Math.PI / 2);
      this.geom('thatch', new THREE.CylinderGeometry(0.2, 0.2, 0.13, 14), mT(x, y, z).multiply(rot), HAY);
      for (const s of [-1, 1]) [[0.17, '#f2eee4'], [0.125, '#c8423a'], [0.08, '#f2eee4'], [0.035, '#d9a940']].forEach(([rr, c], i) => this.geom('flat', new THREE.CylinderGeometry(rr, rr, 0.004, 18), mT(x, y, z + s * (0.067 + i * 0.002)).multiply(rot), C(c)));
      this.tube('planks', [x - 0.16, 0, z + 0.04], [x - 0.08, 0.5, z + 0.03], 0.014, 0.012, 5, TIMBER);
      this.tube('planks', [x + 0.16, 0, z + 0.04], [x + 0.08, 0.5, z + 0.03], 0.014, 0.012, 5, TIMBER);
      this.tube('planks', [x, 0, z - 0.3], [x, 0.56, z - 0.05], 0.014, 0.012, 5, TIMBER);
    }
    // Rak tombak berdiri menyusuri Z di x.
    rack(x, za, zb) {
      for (const z of [za, zb]) this.post(x, z, 0, 0.56, 0.04);
      for (const y of [0.13, 0.5]) this.rail('planks', x, za, x, zb, y, y + 0.03, 0.03, TIMBER, true);
      for (const z of span(za + 0.06, zb - 0.06, 4)) {
        const a = [x - 0.13, 0.01, z], c = [x + 0.03, 0.86, z], dir = vsub(c, a), l = Math.hypot(...dir);
        this.tube('flat', a, c, 0.009, 0.008, 5, C('#8a6a48'));
        this.tube('flat', c, [c[0] + dir[0] / l * 0.08, c[1] + dir[1] / l * 0.08, c[2]], 0.016, 0.001, 4, STEEL);
      }
    }
    well(x, z) {
      this.lathe('stone', [[0.13, 0.12], [0.13, 0.3], [0.19, 0.3], [0.19, 0.27], [0.175, 0.26], [0.175, 0]], 12, mT(x, 0, z), C('#cfc8ba'), [0.65, 1]);
      this.cyl('flat', x, 0.12, z, 0.13, 0.13, 0.01, 12, POOL);
      for (const s of [-1, 1]) this.post(x + s * 0.21, z, 0, 0.66, 0.045);
      this.tube('planks', [x - 0.21, 0.5, z], [x + 0.21, 0.5, z], 0.025, 0.025, 7, TIMBER);
      this.cyl('planks', x + 0.1, 0.3, z + 0.12, 0.05, 0.055, 0.08, 8, LEAF);
      this.gable('clay', 'x', x - 0.3, x + 0.3, z - 0.2, z + 0.2, 0.64, 0.18, 0.05, 0.03, { cap: true });
    }
    // Ladang: 6 baris rumpun pindai digabung menjadi satu mesh (satu draw call per ladang).
    crops() {
      const src = BF.assets.model.rumput2.lod[0], sp = src.attributes.position, sc = src.attributes.color, si = src.index, rnd = BF.makeRng(31);
      const pos = [], nor = [], col = [], idx = [];
      for (let r = 0; r < 6; r++)
        for (let k = 0; k < 9; k++) {
          const x = 0.2 + k * 0.2 + (rnd() - 0.5) * 0.06, z = 0.265 + r * 0.3 + (rnd() - 0.5) * 0.04, s = 1 + rnd() * 0.5, a = rnd() * TAU, c = Math.cos(a), sn = Math.sin(a), g = 0.85 + rnd() * 0.3, base = pos.length / 3;
          for (let i = 0; i < sp.count; i++) {
            const px = sp.getX(i) * s, pz = sp.getZ(i) * s;
            pos.push(x + px * c + pz * sn, 0.05 + sp.getY(i) * s, z - px * sn + pz * c);
            nor.push(0, 1, 0);
            col.push(sc.getX(i) * 0.75 * g, Math.min(1, sc.getY(i) * 1.3 * g), sc.getZ(i) * 0.5 * g);
          }
          for (let i = 0; i < si.count; i++) idx.push(base + si.getX(i));
        }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      const m = new THREE.Mesh(geo, BF.assets.bahan.daun);
      m.receiveShadow = true;
      this.scans.push(m);
    }
    scarecrow(x, z) {                                   // orang-orangan sawah berbaju warna tim
      this.tube('planks', [x, 0, z], [x, 0.6, z], 0.018, 0.016, 6, TIMBER);
      this.tube('planks', [x - 0.17, 0.44, z], [x + 0.17, 0.44, z], 0.013, 0.013, 6, TIMBER);
      this.tube('flat', [x, 0.25, z], [x, 0.47, z], 0.075, 0.06, 8, this.team);
      this.tube('flat', [x - 0.19, 0.43, z], [x + 0.19, 0.43, z], 0.028, 0.028, 6, mul(this.team, 0.85));
      this.ball('flat', x, 0.53, z, 0.055, BURLAP, 1);
      this.cyl('thatch', x, 0.575, z, 0.11, 0.1, 0.012, 12, HAY);
      this.geom('thatch', new THREE.ConeGeometry(0.06, 0.07, 10), mT(x, 0.62, z), HAY);
    }
  }

  function buildingMesh(type, owner, links, faction) {
    const r = new Rakit(owner, faction), S = FACE;
    switch (type) {
      case 'house': {                                   // pondok berangka kayu, atap jerami, cerobong batu, emperan kayu bakar
        r.meta.body = [[0.2, 0.36, 1.72, 1.52, 0.9]];
        const x0 = 0.36, x1 = 1.56, z0 = 0.52, z1 = 1.36, y0 = 0.1, y1 = 0.9, o = { wy0: 0.42, wy1: 0.66, shut: r.cat, dh: 0.74 };
        r.plinth(x0 - 0.04, z0 - 0.04, x1 + 0.04, z1 + 0.04, y0);
        r.block('plaster', x0, z0, x1, z1, y0, y1, DAUB);
        r.timberWall(S['z+'](z1), [0.36, 0.62, 0.88, 1.12, 1.38, 1.56], y0, y1, '/wdw\\', o);
        r.timberWall(S['z-'](z0), span(x0, x1, 4), y0, y1, 'x-w/', o);
        r.timberWall(S['x+'](x1), span(z0, z1, 3), y0, y1, '/w\\', o);
        r.timberWall(S['x-'](x0), span(z0, z1, 3), y0, y1, '\\w/', o);
        r.gable('thatch', 'x', x0 - 0.16, x1 + 0.16, z0, z1, y1, 0.62, 0.2, 0.11, { soft: true, end: ['plaster', DAUB, x0, x1] });
        r.gableFrame(S['x+'](x1), z0, z1, y1, 0.62);
        r.gableFrame(S['x-'](x0), z0, z1, y1, 0.62);
        r.chimney(0.58, 0.84, 0.16, 0.16, y1, 1.86);
        for (const z of [0.6, 1.28]) r.post(1.9, z, 0, 0.64);
        r.slab('planks', [[x1, 0.88, 0.54], [x1, 0.88, 1.34], [1.97, 0.62, 1.34], [1.97, 0.62, 0.54]], 0.03, C('#d8c0a0'));
        r.logs(1.74, 0.94, 0.6, 3, false);
        r.barrel(0.5, 1.64);
        r.cyl('flat', 1.62, 0, 1.72, 0.08, 0.09, 0.14, 8, BARK);
        r.cyl('flat', 1.62, 0.14, 1.72, 0.075, 0.075, 0.004, 8, CUT);
        break;
      }
      case 'storage': {                                 // lumbung panggung di atas batu jamur (tikus tak bisa naik), dinding papan
        r.meta.body = [[0.26, 0.28, 1.74, 1.56, 1.08]];
        const x0 = 0.4, x1 = 1.6, z0 = 0.42, z1 = 1.42, fl = 0.3, y1 = 1.08, wc = new THREE.Color(1.2, 1.08, 0.92);
        for (const x of [0.47, 1.0, 1.53]) for (const z of [0.49, 0.92, 1.35]) r.staddle(x, z);
        r.box('planks', x0 - 0.04, 0.25, z0 - 0.04, x1 + 0.04, fl, z1 + 0.04, TIMBER, 0.7, 1, false);
        r.block('planks', x0, z0, x1, z1, fl, y1, wc);
        r.timberWall(S['z+'](z1), [0.4, 0.78, 1.22, 1.6], fl, y1, '-d-', { dh: 0.84, steps: false });
        r.ladder(1.0, 1.78, z1 + 0.02, fl + 0.06);
        r.timberWall(S['z-'](z0), span(x0, x1, 3), fl, y1, '-x-');
        r.timberWall(S['x+'](x1), span(z0, z1, 2), fl, y1, '/\\');
        r.timberWall(S['x-'](x0), span(z0, z1, 2), fl, y1, '\\/');
        r.gable('thatch', 'x', x0 - 0.15, x1 + 0.15, z0, z1, y1, 0.56, 0.18, 0.1, { soft: true, end: ['planks', wc, x0, x1] });
        r.fbox(S['x+'](x1), 0.85, 0.99, 1.26, 1.4, 0, 0.004, 'flat', VOID);
        r.flagPole(x1 - 0.06, 0.92, 1.66, 2.3);
        r.sack(1.46, 1.66, 0.085); r.sack(1.62, 1.72, 0.08); r.sack(1.53, 1.84, 0.085); r.sack(1.55, 1.72, 0.07, 0.12);
        r.barrel(0.56, 1.66);
        r.cart(0.5, 0.18, true);
        break;
      }
      case 'townhall': {                                // balai: aula batu dengan lantai atas berangka kayu yang menjorok, serambi, menara lonceng di belakang
        r.meta.body = [[0.23, 0.33, 2.77, 1.91, 1.68], [0.02, 0.04, 1.0, 1.02, 3.0]];
        const x0 = 0.42, x1 = 2.58, z0 = 0.52, z1 = 1.72, g = 0.14, y1 = 0.98, y2 = 1.68, j = 0.05, o = { wy0: 1.18, wy1: 1.46, ww: 0.075, shut: r.cat };
        r.plinth(x0 - 0.06, z0 - 0.06, x1 + 0.06, z1 + 0.06, g);
        r.block('stone', x0, z0, x1, z1, g, y1);
        r.quoins(x1, z1, 1, 1, g, y1); r.quoins(x1, z0, 1, -1, g, y1); r.quoins(x0, z1, -1, 1, g, y1);
        r.block('plaster', x0 - j, z0 - j, x1 + j, z1 + j, y1, y2, DAUB);
        for (const x of span(x0 + 0.06, x1 - 0.06, 16)) r.box('planks', x - 0.025, y1 - 0.05, z1 - 0.02, x + 0.025, y1, z1 + j + 0.012, TIMBER, 0.8, 1, true);
        for (const z of span(z0 + 0.06, z1 - 0.06, 9)) r.box('planks', x1 - 0.02, y1 - 0.05, z - 0.025, x1 + j + 0.012, y1, z + 0.025, TIMBER, 0.8, 1, true);
        r.timberWall(S['z+'](z1 + j), span(x0 - j, x1 + j, 8), y1, y2, '/wx--xw\\', o);
        r.timberWall(S['z-'](z0 - j), span(x0 - j, x1 + j, 8), y1, y2, '/wxwwxw\\', o);
        r.timberWall(S['x+'](x1 + j), span(z0 - j, z1 + j, 4), y1, y2, '/ww\\', o);
        r.timberWall(S['x-'](x0 - j), span(z0 - j, z1 + j, 4), y1, y2, '\\ww/', o);
        r.gable('clay', 'x', x0 - j - 0.15, x1 + j + 0.15, z0 - j, z1 + j, y2, 0.82, 0.16, 0.05, { cap: true, end: ['plaster', DAUB, x0 - j, x1 + j] });
        r.gableFrame(S['x+'](x1 + j), z0 - j, z1 + j, y2, 0.82);
        r.gableFrame(S['x-'](x0 - j), z0 - j, z1 + j, y2, 0.82);
        r.chimney(1.32, 0.8, 0.18, 0.18, y2, 2.7);
        r.chimney(2.3, 0.8, 0.18, 0.18, y2, 2.66);
        r.banner(S['z+'](z1), 1.0, 0.92, 0.16, 0.46);
        r.banner(S['z+'](z1), 2.0, 0.92, 0.16, 0.46);
        for (const u of [0.7, 2.3]) r.win(S['z+'](z1), u - 0.07, u + 0.07, 0.46, 0.76, { stone: true });
        for (const u of [1.2, 1.8, 2.3]) r.win(S['z-'](z0), u - 0.07, u + 0.07, 0.46, 0.76, { stone: true });
        for (const u of [0.85, 1.4]) r.win(S['x+'](x1), u - 0.07, u + 0.07, 0.46, 0.76, { stone: true });
        for (const u of [1.12, 1.46]) r.win(S['x-'](x0), u - 0.07, u + 0.07, 0.46, 0.76, { stone: true });
        // serambi bergerbang lengkung
        const px0 = 1.18, px1 = 1.82, pz = 2.18, py = 1.26;
        r.plinth(px0 - 0.05, z1, px1 + 0.05, pz + 0.05, g);
        r.block('stone', px0, z1, px1, pz, g, py);
        r.quoins(px0, pz, -1, 1, g, py); r.quoins(px1, pz, 1, 1, g, py);
        r.archDoor(S['z+'](pz), 1.5, 0.32, g, 0.42);
        r.gable('clay', 'z', z1 - 0.1, pz + 0.13, px0, px1, py, 0.5, 0.12, 0.05, { cap: true, end: ['stone', null, null, pz] });
        r.win(S['z+'](pz), 1.45, 1.55, 1.3, 1.5, { stone: true });
        // menara lonceng di sudut belakang: menjulang di atas atap aula
        const tx0 = 0.16, tx1 = 0.86, tz0 = 0.18, tz1 = 0.88, ty = 3.0, tc = (tx0 + tx1) / 2, tzc = (tz0 + tz1) / 2;
        r.plinth(tx0 - 0.06, tz0 - 0.06, tx1 + 0.06, tz1 + 0.06, g + 0.02);
        r.block('stone', tx0, tz0, tx1, tz1, g, ty);
        r.quoins(tx0, tz1, -1, 1, g, ty); r.quoins(tx1, tz1, 1, 1, g, ty); r.quoins(tx1, tz0, 1, -1, g, ty); r.quoins(tx0, tz0, -1, -1, g, ty);
        r.box('plaster', tx0 - 0.025, 2.36, tz0 - 0.025, tx1 + 0.025, 2.42, tz1 + 0.025, DRESSED, 0.9, 1, true);
        r.box('plaster', tx0 - 0.04, ty, tz0 - 0.04, tx1 + 0.04, ty + 0.07, tz1 + 0.04, DRESSED, 0.9, 1, true);
        for (const [sd, at] of [['z+', tz1], ['x+', tx1], ['z-', tz0], ['x-', tx0]]) {
          const F = S[sd](at), c = sd[0] === 'z' ? tc : tzc;
          for (const du of [-0.13, 0.13]) r.archDoor(F, c + du, 0.15, 2.48, 0.24, { hole: true });
        }
        for (const [sd, at] of [['z-', tz0], ['x-', tx0]]) for (const y of [0.9, 1.6]) r.win(S[sd](at), (sd[0] === 'z' ? tc : tzc) - 0.035, (sd[0] === 'z' ? tc : tzc) + 0.035, y, y + 0.36, { stone: true });
        r.win(S['z+'](tz1), 0.255, 0.325, 1.9, 2.22, { stone: true });
        r.hipRoof('slate', tx0, tz0, tx1, tz1, ty + 0.07, 1.05, 0.1, 0.05, { cap: true });
        r.flagPole(tc, tzc, 4.0, 4.78);
        r.well(0.42, 2.46);
        r.barrel(2.72, 2.42); r.barrel(2.84, 2.2); r.crate(2.5, 2.7, 0.16); r.crate(2.5, 2.7, 0.12, 0.16);
        break;
      }
      case 'barracks': {                                // asrama prajurit: aula batu berbentuk L, halaman latihan
        r.meta.body = [[0.08, 0.11, 2.92, 1.52, 1.0], [0.08, 1.52, 1.14, 2.44, 0.9]];
        const x0 = 0.22, x1 = 2.78, z0 = 0.25, z1 = 1.38, g = 0.1, y1 = 1.0, wx1 = 1.0, wz = 2.3, wy = 0.9;
        r.plinth(x0 - 0.04, z0 - 0.04, x1 + 0.04, z1 + 0.04, g);
        r.block('stone', x0, z0, x1, z1, g, y1);
        r.quoins(x1, z1, 1, 1, g, y1); r.quoins(x1, z0, 1, -1, g, y1); r.quoins(x0, z0, -1, -1, g, y1);
        r.gable('clay', 'x', x0 - 0.14, x1 + 0.14, z0, z1, y1, 0.66, 0.14, 0.05, { cap: true, end: ['stone', null, x0, x1] });
        r.plinth(x0 - 0.04, z1, wx1 + 0.04, wz + 0.04, g);
        r.block('stone', x0, z1, wx1, wz, g, wy);
        r.quoins(x0, wz, -1, 1, g, wy); r.quoins(wx1, wz, 1, 1, g, wy);
        r.gable('clay', 'z', z1 - 0.2, wz + 0.14, x0, wx1, wy, 0.5, 0.13, 0.05, { cap: true, end: ['stone', null, null, wz] });
        r.chimney(2.3, 0.62, 0.18, 0.18, y1, 1.98);
        r.archDoor(S['z+'](z1), 1.9, 0.34, g, 0.42);
        r.banner(S['z+'](z1), 1.5, 0.95, 0.15, 0.4);
        r.banner(S['z+'](z1), 2.3, 0.95, 0.15, 0.4);
        for (const u of [1.18, 2.6]) r.win(S['z+'](z1), u - 0.065, u + 0.065, 0.46, 0.74, { stone: true });
        for (const u of [0.6, 1.2, 1.8, 2.4]) r.win(S['z-'](z0), u - 0.065, u + 0.065, 0.46, 0.74, { stone: true });
        for (const u of [0.58, 1.05]) r.win(S['x+'](x1), u - 0.065, u + 0.065, 0.46, 0.74, { stone: true });
        r.win(S['x-'](x0), 0.75, 0.88, 0.46, 0.74, { stone: true });
        r.win(S['x-'](x0), 1.8, 1.93, 0.46, 0.7, { stone: true });
        r.win(S['z+'](wz), 0.55, 0.68, 0.44, 0.7, { stone: true });
        for (const u of [1.62, 2.06]) r.win(S['x+'](wx1), u - 0.065, u + 0.065, 0.44, 0.7, { stone: true });
        for (const u of [1.84]) {                       // perisai berwarna tim tergantung di dinding sayap
          r.geom('flat', new THREE.CylinderGeometry(0.11, 0.11, 0.03, 16), mT(wx1 + 0.02, 0.6, u).multiply(mRz(Math.PI / 2)), r.team);
          r.geom('flat', new THREE.CylinderGeometry(0.035, 0.035, 0.04, 10), mT(wx1 + 0.03, 0.6, u).multiply(mRz(Math.PI / 2)), GOLD);
        }
        r.dummy(1.6, 2.2); r.dummy(2.2, 2.55);
        r.rack(2.7, 1.7, 2.3);
        r.flagPole(2.72, 2.78, 0, 2.3);
        r.barrel(1.2, 2.72);
        break;
      }
      case 'range': {                                   // los memanah: dinding papan belakang, atap sandar genteng, sasaran jerami
        r.meta.body = [[0.1, 0.1, 2.9, 1.14, 0.8]];
        const x0 = 0.22, x1 = 2.78, z0 = 0.22, zf = 1.0, yb = 1.06, yf = 0.8, wc = new THREE.Color(1.15, 1.02, 0.86);
        r.block('planks', x0, z0, x1, z0 + 0.07, 0, yb, wc);
        for (const x of [x0, x1 - 0.06]) r.block('planks', x, z0, x + 0.06, zf - 0.04, 0, 0.46, wc);
        for (const x of [0.25, 1.0, 1.75, 2.75]) r.post(x, zf, 0, yf + 0.02, 0.06);
        for (const x of [x0 + 0.03, x1 - 0.03]) r.rail('planks', x, z0, x, zf, 0.42, 0.46, 0.05, TIMBER);
        r.rail('planks', x0, zf, x1, zf, yf - 0.06, yf + 0.02, 0.07, TIMBER, true);
        r.shed('clay', 'x', x0 - 0.12, x1 + 0.12, z0 - 0.1, yb + 0.033, zf + 0.16, yf - 0.053, 0.05);
        const back = S['z+'](z0 + 0.07);
        for (const y of [0.52, 0.78]) r.fbox(back, 0.7, 2.3, y, y + 0.025, 0, 0.04, 'planks', TIMBER);
        for (const u of [0.8, 0.98, 1.98, 2.16]) {     // busur tergantung: bilah lengkung dan tali
          const pts = span(-1, 1, 4).map(t => back(u + 0.07 * (1 - t * t), 0.68 + t * 0.24, 0.05));
          for (let i = 0; i < 4; i++) r.tube('flat', pts[i], pts[i + 1], 0.009, 0.009, 4, C('#7a5634'));
          r.tube('flat', pts[0], pts[4], 0.003, 0.003, 3, C('#e6dcc4'));
        }
        r.banner(back, 1.5, 0.98, 0.22, 0.42);
        for (const [x, z] of [[0.52, 0.48], [2.48, 0.48]]) {
          r.barrel(x, z);
          for (let i = 0; i < 7; i++) { const a = i * 0.9, dx = Math.cos(a) * 0.05, dz = Math.sin(a) * 0.05; r.tube('flat', [x + dx, 0.2, z + dz], [x + dx * 2.2, 0.52, z + dz * 2.2], 0.005, 0.005, 3, C('#b89668')); }
        }
        for (const x of [0.7, 1.5, 2.3]) r.butt(x, x === 1.5 ? 2.58 : 2.42);
        r.fence(span(1.12, 2.88, 4).map(z => [0.12, z]), 0.4);
        r.fence(span(1.12, 2.88, 4).map(z => [2.88, z]), 0.4);
        r.hay(2.3, 1.18, 2.72, 1.38, 0, 0.2); r.hay(2.38, 1.2, 2.66, 1.36, 0.2, 0.38);
        break;
      }
      case 'stable': {                                  // istal: lumbung papan beratap jerami, pintu kandang dua bagian, paddock berpagar
        r.meta.body = [[0.06, 0.11, 2.94, 1.56, 0.92]];
        const x0 = 0.2, x1 = 2.8, z0 = 0.25, z1 = 1.42, g = 0.08, y1 = 0.92, wc = new THREE.Color(1.12, 1.0, 0.84);
        r.plinth(x0 - 0.03, z0 - 0.03, x1 + 0.03, z1 + 0.03, g);
        r.block('planks', x0, z0, x1, z1, g, y1, wc);
        r.timberWall(S['z+'](z1), span(x0, x1, 5), g, y1, 'sxsxs', { dh: 0.72 });
        r.timberWall(S['z-'](z0), span(x0, x1, 5), g, y1, '-w-w-', { wy0: 0.46, wy1: 0.66 });
        r.timberWall(S['x+'](x1), span(z0, z1, 3), g, y1, '/d\\', { dh: 0.74 });
        r.timberWall(S['x-'](x0), span(z0, z1, 3), g, y1, '\\-/');
        r.gable('thatch', 'x', x0 - 0.16, x1 + 0.16, z0, z1, y1, 0.66, 0.2, 0.11, { soft: true, end: ['planks', wc, x0, x1] });
        const gx = S['x+'](x1), zc = (z0 + z1) / 2;
        r.fbox(gx, zc - 0.14, zc + 0.14, 1.04, 1.32, 0, 0.004, 'flat', VOID);
        r.fbox(gx, zc - 0.17, zc + 0.17, 1.0, 1.04, 0, 0.05, 'planks', TIMBER);
        r.hay(x1 - 0.02, zc - 0.12, x1 + 0.06, zc + 0.12, 1.04, 1.13);
        r.box('planks', x1, 1.42, zc - 0.03, x1 + 0.2, 1.47, zc + 0.03, TIMBER, 1, 1, true);
        r.tube('flat', [x1 + 0.17, 1.42, zc], [x1 + 0.17, 1.06, zc], 0.005, 0.005, 3, C('#c9b48e'));
        const fz0 = 1.72, fz1 = 2.86, fx0 = 0.18, fx1 = 2.82;
        r.fence([[0.95, fz0], [fx0, fz0], [fx0, 2.29], [fx0, fz1], ...span(fx0, fx1, 6).slice(1).map(x => [x, fz1]), [fx1, 2.29], [fx1, fz0], [1.45, fz0]], 0.4);
        r.box('flat', 1.2, 0.27, fz1 - 0.015, 1.52, 0.36, fz1 + 0.015, r.team, 0.85, 1, true);
        r.box('flat', 1.2, 0.3, fz1 - 0.017, 1.52, 0.315, fz1 + 0.017, GOLD, 1, 1, true);
        r.box('flat', 2.1, 0.27, fz1 - 0.015, 2.42, 0.36, fz1 + 0.015, r.team, 0.85, 1, true);
        r.trough(0.62, 2.05, 0.5, true);
        r.hay(2.2, 2.2, 2.62, 2.42, 0, 0.2); r.hay(2.24, 2.44, 2.66, 2.66, 0, 0.2); r.hay(2.26, 2.3, 2.6, 2.56, 0.2, 0.38);
        r.barrel(2.62, 1.6);
        break;
      }
      case 'smithy': {                                  // pandai besi: bengkel batu berbukaan tungku, cerobong luar di pelana, landasan di halaman
        r.meta.body = [[0.06, 0.12, 1.76, 1.22, 0.92]];
        const x0 = 0.2, x1 = 1.5, z0 = 0.26, z1 = 1.08, y1 = 0.92, F = S['z+'](z1);
        r.plinth(x0 - 0.03, z0 - 0.03, x1 + 0.03, z1 + 0.03, 0.06);
        r.block('stone', x0, z0, x1, z1, 0.06, y1);
        r.quoins(x1, z1, 1, 1, 0.06, y1); r.quoins(x0, z1, -1, 1, 0.06, y1); r.quoins(x0, z0, -1, -1, 0.06, y1);
        r.gable('slate', 'x', x0 - 0.12, x1 + 0.12, z0, z1, y1, 0.5, 0.12, 0.045, { cap: true, end: ['stone', null, x0, x1] });
        // cerobong tungku menempel di luar dinding pelana timur: kaki lebar, bahu miring, batang sampai di atas bubungan
        r.box('stone', x1, 0, 0.45, x1 + 0.2, 1.2, 0.89, null, 0.8, 1, false);
        r.hexa('stone', [[x1, 1.2, 0.45], [x1 + 0.2, 1.2, 0.45], [x1 + 0.2, 1.2, 0.89], [x1, 1.2, 0.89], [x1, 1.38, 0.55], [x1 + 0.16, 1.38, 0.55], [x1 + 0.16, 1.38, 0.79], [x1, 1.38, 0.79]], null, 0.9, 1);
        r.chimney(x1 + 0.08, 0.67, 0.16, 0.24, 1.38, 2.0, true);
        // bukaan tungku lebar dengan bara menyala di dalam, ambang balok kayu, tiang batu tempa
        r.fbox(F, 0.66, 1.16, 0.06, 0.64, 0, 0.004, 'flat', VOID);
        r.fbox(F, 0.76, 1.06, 0.16, 0.3, 0.004, 0.008, 'glow');
        r.fbox(F, 0.62, 1.2, 0.64, 0.72, 0, 0.045, 'planks', TIMBER);
        for (const u of [0.62, 1.16]) r.fbox(F, u, u + 0.04, 0.06, 0.64, 0, 0.03, 'plaster', DRESSED);
        r.door(F, 0.3, 0.5, 0.06, 0.66, {});
        r.banner(F, 1.33, 0.86, 0.13, 0.34);
        r.win(S['z-'](z0), 0.78, 0.92, 0.44, 0.7, { stone: true });
        r.win(S['x-'](x0), 0.6, 0.74, 0.44, 0.7, { stone: true });
        // landasan di atas tunggul, bak pendingin, batu asah, arang
        r.cyl('flat', 0.92, 0, 1.46, 0.085, 0.095, 0.2, 9, BARK);
        r.box('flat', 0.85, 0.2, 1.42, 0.99, 0.23, 1.5, IRON, 1, 1, true);
        r.box('flat', 0.82, 0.23, 1.42, 1.03, 0.3, 1.5, IRON, 0.9, 1.1, true);
        r.tube('flat', [1.03, 0.27, 1.46], [1.12, 0.27, 1.46], 0.03, 0.002, 6, IRON);
        r.trough(1.42, 1.4, 0.34, false);
        r.geom('plaster', new THREE.CylinderGeometry(0.12, 0.12, 0.05, 14), mT(1.78, 0.24, 1.3).multiply(mRx(Math.PI / 2)), DRESSED);
        for (const z of [1.25, 1.35]) r.post(1.78, z, 0, 0.22, 0.03);
        for (let i = 0; i < 6; i++) r.ball('flat', 0.38 + (i % 3) * 0.05, 0.03 + (i > 2 ? 0.04 : 0), 1.38 + (i % 2) * 0.04, 0.04, C('#2a2724'), 0);
        r.logs(1.78, 1.72, 0.4, 2, true);
        break;
      }
      case 'workshop': {                                // bengkel pelontar: lumbung kerja besar berpintu ganda, katrol di pelana, kayu olahan
        r.meta.body = [[0.1, 0.1, 2.9, 1.76, 1.18]];
        const x0 = 0.24, x1 = 2.76, z0 = 0.24, z1 = 1.62, g = 0.1, y1 = 1.18, wc = new THREE.Color(1.15, 1.03, 0.88);
        r.plinth(x0 - 0.04, z0 - 0.04, x1 + 0.04, z1 + 0.04, g);
        r.block('planks', x0, z0, x1, z1, g, y1, wc);
        r.timberWall(S['z+'](z1), [x0, 0.62, 1.0, 2.0, 2.38, x1], g, y1, '/- -\\');
        const fr = S['z+'](z1);
        r.fbox(fr, 1.0, 2.0, 1.0, 1.07, 0, 0.05, 'planks', TIMBER);
        r.fbox(fr, 1.03, 1.97, g + 0.05, 1.0, 0, 0.004, 'flat', VOID);
        r.planksV(fr, 1.03, 1.5, g + 0.05, 0.99, 0.004, 0.02, LEAF, 6);
        r.fbeam(fr, 1.06, g + 0.08, 1.47, 0.96, 0.05, 0.02, 0.034, 'planks', TIMBER);
        r.hexa('planks', [[1.95, g + 0.05, z1], [1.99, g + 0.05, z1], [1.99, g + 0.05, z1 + 0.46], [1.95, g + 0.05, z1 + 0.46], [1.95, 0.99, z1], [1.99, 0.99, z1], [1.99, 0.99, z1 + 0.46], [1.95, 0.99, z1 + 0.46]], LEAF);
        r.timberWall(S['z-'](z0), span(x0, x1, 6), g, y1, 'x-ww-x', { wy0: 0.56, wy1: 0.82 });
        r.timberWall(S['x+'](x1), span(z0, z1, 3), g, y1, '/w\\', { wy0: 0.56, wy1: 0.82 });
        r.timberWall(S['x-'](x0), span(z0, z1, 3), g, y1, '\\w/', { wy0: 0.56, wy1: 0.82 });
        r.gable('clay', 'x', x0 - 0.15, x1 + 0.15, z0, z1, y1, 0.76, 0.15, 0.05, { cap: true, end: ['planks', wc, x0, x1] });
        const gx = S['x+'](x1), zc = (z0 + z1) / 2;
        r.fbox(gx, zc - 0.13, zc + 0.13, 1.28, 1.6, 0, 0.004, 'flat', VOID);
        r.fbox(gx, zc - 0.16, zc + 0.16, 1.24, 1.28, 0, 0.05, 'planks', TIMBER);
        r.box('planks', x1, 1.74, zc - 0.035, x1 + 0.22, 1.8, zc + 0.035, TIMBER, 1, 1, true);
        r.box('flat', x1 + 0.15, 1.66, zc - 0.025, x1 + 0.2, 1.74, zc + 0.025, C('#4a3826'), 1, 1, true);
        r.tube('flat', [x1 + 0.175, 1.66, zc], [x1 + 0.175, 0.75, zc], 0.006, 0.006, 3, C('#c9b48e'));
        r.banner(fr, 2.57, 1.08, 0.17, 0.42);
        for (let l = 0; l < 3; l++) for (let i = 0; i < 4 - l; i++) { const z = 2.14 + (i - (3 - l) / 2) * 0.1, y = l * 0.07; r.box('planks', 1.72, y, z - 0.04, 2.78, y + 0.07, z + 0.04, mul(C('#d8b58a'), 0.9 + ((i + l) % 3) * 0.06), 0.8, 1, true); }
        r.logs(0.85, 2.62, 0.95, 3, true);
        r.wheel(0.5, 0.25, z1 + 0.08, 0.24, 0, -0.2);
        r.post(0.62, 2.1, 0, 0.3); r.post(0.86, 2.1, 0, 0.3);
        r.tube('flat', [0.5, 0.3, 2.1], [1.02, 0.3, 2.1], 0.05, 0.05, 7, BARK);
        break;
      }
      case 'market': {                                  // pasar: los terbuka bertiang kayu, dua lapak bertenda warna tim, dagangan
        r.meta.body = [[0.2, 0.3, 2.8, 1.76, 1.0]];
        const x0 = 0.36, x1 = 2.64, z0 = 0.46, z1 = 1.6, g = 0.06, y1 = 1.0, wc = new THREE.Color(1.15, 1.03, 0.88), TOP = C('#d8bd96'), LINEN = C('#efe6d2');
        r.plinth(x0 - 0.1, z0 - 0.1, x1 + 0.1, z1 + 0.1, g);                            // lantai batu
        for (const x of span(x0, x1, 3)) {
          for (const z of [z0, z1]) r.post(x, z, g, y1, 0.07);
          for (const sd of [-1, 1]) if (x + sd * 0.2 > x0 && x + sd * 0.2 < x1) r.tube('planks', [x, y1 - 0.3, z1], [x + sd * 0.22, y1 - 0.04, z1], 0.02, 0.02, 4, TIMBER);   // penopang siku
        }
        for (const z of [z0, z1]) r.rail('planks', x0, z, x1, z, y1 - 0.07, y1, 0.07, TIMBER, true);
        for (const x of [x0, x1]) r.rail('planks', x, z0, x, z1, y1 - 0.07, y1, 0.07, TIMBER, true);
        r.block('planks', x0, z0 - 0.03, x1, z0 + 0.03, g, 0.52, wc);                     // dinding papan belakang setengah tinggi
        r.gable('clay', 'x', x0 - 0.2, x1 + 0.2, z0, z1, y1, 0.62, 0.22, 0.05, { cap: true, end: ['planks', wc, x0, x1] });
        r.gableFrame(S['x+'](x1), z0, z1, y1, 0.62);
        r.gableFrame(S['x-'](x0), z0, z1, y1, 0.62);
        const table = (tx0, tx1, tz0, tz1, h) => {
          r.box('planks', tx0, h - 0.04, tz0, tx1, h, tz1, TOP, 1, 1, true);
          for (const x of [tx0 + 0.04, tx1 - 0.04]) for (const z of [tz0 + 0.04, tz1 - 0.04]) r.post(x, z, 0, h - 0.04, 0.03);
        };
        const fruit = (x, z, y, col) => { for (let i = 0; i < 5; i++) r.ball('flat', x + (i % 3 - 1) * 0.055, y + (i > 2 ? 0.045 : 0), z + (i % 2) * 0.05 - (i > 2 ? 0.0 : 0.025), 0.034, col, 0); };
        const bolt = (x, z, y, col) => r.tube('flat', [x - 0.13, y + 0.03, z], [x + 0.13, y + 0.03, z], 0.03, 0.03, 6, col);      // gulungan kain
        // di dalam los: dua meja dagang, peti, karung, tong
        table(0.56, 1.3, 0.92, 1.3, 0.36); table(1.7, 2.44, 0.92, 1.3, 0.36);
        fruit(0.74, 1.1, 0.4, C('#c8423a')); fruit(1.1, 1.12, 0.4, C('#d9a940'));
        bolt(1.9, 1.04, 0.36, r.team); bolt(1.92, 1.18, 0.36, LINEN); bolt(2.24, 1.1, 0.36, C('#8a5a3c'));
        r.crate(1.5, 0.78, 0.2); r.crate(1.5, 0.78, 0.15, 0.2); r.sack(0.6, 0.7, 0.085); r.sack(0.78, 0.66, 0.08); r.barrel(2.46, 0.72);
        // dua lapak depan: tiang, tenda miring bergaris warna tim, meja berisi dagangan
        [[0.3, C('#6f9a4a')], [1.8, C('#c8423a')]].forEach(([ax, col], n) => {
          for (const dx of [0, 0.9]) { r.post(ax + dx, 2.08, 0, 0.8, 0.04); r.post(ax + dx, 2.72, 0, 0.56, 0.04); }
          for (let k = 0; k < 6; k++) r.shed('flat', 'x', ax - 0.06 + k * 0.17, ax - 0.06 + (k + 1) * 0.17, 2.0, 0.8, 2.82, 0.52, 0.014, k % 2 ? LINEN : r.team);
          table(ax + 0.08, ax + 0.82, 2.24, 2.6, 0.32);
          fruit(ax + 0.28, 2.4, 0.36, col); fruit(ax + 0.6, 2.42, 0.36, n ? C('#d9a940') : C('#e8dcc0'));
        });
        r.cart(1.48, 2.46, false);
        r.sack(2.84, 2.2, 0.085); r.barrel(0.16, 2.3); r.crate(2.86, 1.86, 0.17);
        r.flagPole(1.5, (z0 + z1) / 2, 1.6, 2.35);
        break;
      }
      case 'tower': {
        r.meta.body = [[0.04, 0.04, 0.96, 0.96, 3.3]];
        r.scan('menara', 0);                            // batang batu 0,68 × 0,68 → sisi-sisinya di 0,16 dan 0,84
        r.door(S['z+'](0.84), 0.4, 0.6, 0, 0.56, {});
        for (const [s, at] of [['z+', 0.84], ['z-', 0.16], ['x+', 0.84], ['x-', 0.16]]) {
          const F = S[s](at);
          r.fbox(F, 0.47, 0.53, 1.5, 2.1, 0, 0.004, 'flat', VOID);
          r.fbox(F, 0.43, 0.57, 1.46, 1.5, 0, 0.03, 'plaster', DRESSED);
          r.fbox(F, 0.43, 0.57, 2.1, 2.14, 0, 0.03, 'plaster', DRESSED);
        }
        r.banner(S['z+'](0.84), 0.5, 2.95, 0.22, 0.6);
        r.banner(S['x+'](0.84), 0.5, 2.95, 0.22, 0.6);
        for (const x of [0.2, 0.8]) for (const z of [0.2, 0.8]) r.post(x, z, 3.4, 3.8, 0.05);      // atap limas di atas pagar tembok, bertumpu pada merlon sudut
        r.hipRoof('slate', 0.16, 0.16, 0.84, 0.84, 3.8, 0.68, 0.1, 0.045, { cap: true });
        r.flagPole(0.5, 0.5, 4.3, 4.95);
        break;
      }
      case 'wall': {
        // links: 1 = utara (−Z), 2 = timur (+X), 4 = selatan (+Z), 8 = barat (−X)
        const l = links || 0;
        if (l === 10 || l === 5) r.scan('tembok_lurus', l === 5 ? Math.PI / 2 : 0);      // ruas lurus: satu modul penuh
        else {                                                                            // ujung, sudut, simpang: pilar + lengan ke tiap tetangga
          r.scan('tembok_pilar', 0);
          if (l & 2) r.scan('tembok_lengan', 0);
          if (l & 1) r.scan('tembok_lengan', Math.PI / 2);
          if (l & 8) r.scan('tembok_lengan', Math.PI);
          if (l & 4) r.scan('tembok_lengan', -Math.PI / 2);
        }
        break;
      }
      case 'gate': {
        const l = links || 0, alongX = !(l & 5) || (l & 10);
        r.scan('gerbang', alongX ? 0 : Math.PI / 2);
        // titik lokal (u menyusuri tembok, w tegak lurus tembok) → dunia, searah putaran model pindai.
        // Lubang lengkung model: u −0,24..0,24, bagian tegak sampai y 0,64, puncak lengkung 0,88; tebal tembok w −0,17..0,19.
        const L = alongX ? (u, y, w) => [0.5 + u, y, 0.5 + w] : (u, y, w) => [0.5 + w, y, 0.5 - u];
        const lbox = (u0, u1, y0, y1, w0, w1, key, col) => r.hexa(key, [L(u0, y0, w0), L(u1, y0, w0), L(u1, y0, w1), L(u0, y0, w1), L(u0, y1, w0), L(u1, y1, w0), L(u1, y1, w1), L(u0, y1, w1)], col);
        for (let u = -0.21; u < 0.22; u += 0.06) {                               // jeruji besi terangkat: ujung bawahnya menggantung di lengkung
          lbox(u - 0.011, u + 0.011, 0.58, 0.64 + Math.sqrt(0.0576 - u * u), -0.011, 0.011, 'flat', IRON);
          r.tube('flat', L(u, 0.58, 0), L(u, 0.54, 0), 0.012, 0.001, 4, IRON);
        }
        for (const y of [0.62, 0.72]) lbox(-0.23, 0.23, y, y + 0.02, -0.014, 0.014, 'flat', IRON);
        for (const sd of [-1, 1]) {                                              // daun pintu kayu terbuka, rapat ke dinding lorong
          const u0 = sd > 0 ? 0.2 : -0.23, u1 = sd > 0 ? 0.23 : -0.2;
          lbox(u0, u1, 0.01, 0.6, -0.16, 0.08, 'planks', LEAF);
          for (const y of [0.14, 0.44]) lbox(u0 - 0.004, u1 + 0.004, y, y + 0.025, -0.14, 0.06, 'flat', IRON);
        }
        for (const u of [-0.42, 0.42]) for (const w of [-0.12, 0.12]) lbox(u - 0.025, u + 0.025, 1.16, 1.52, w - 0.025, w + 0.025, 'planks', TIMBER);
        r.gable('slate', alongX ? 'x' : 'z', -0.07, 1.07, 0.38, 0.62, 1.52, 0.3, 0.1, 0.04, { cap: true, end: ['planks', LEAF, 0.08, 0.92] });   // atap rumah gerbang
        r.flagPole(0.5, 0.5, 1.5, 2.25);
        break;
      }
      case 'farm': {
        r.box('soil', 0.04, 0, 0.04, 1.96, 0.05, 1.96, null, 1, 1, true);
        r.crops();
        r.scarecrow(0.16, 0.16);
        break;
      }
    }
    const group = r.build(matOf);
    for (const m of r.scans) group.add(m);
    group.userData.meta = r.meta;
    return group;
  }

  // ---------------------------------------------------------------- perancah pembangunan

  // Perancah kayu segar mengelilingi badan bangunan selama dibangun: tiang tegak, palang datar per tingkat, papan pijakan,
  // penopang silang di tiap sisi, tangga di depan, tumpukan papan dan batu di sudut depan.
  // bodies: meta.body bangunan — [x0, z0, x1, z1, tinggi cucuran] per bagian; size: sisi denah (tile).
  const POLE = new THREE.Color(1.25, 1.08, 0.86), BOARD = new THREE.Color(1.35, 1.2, 0.98), scache = {};
  models.scaffold = function (type, bodies, size) {
    if (scache[type]) return scache[type];
    const r = new Rakit(0);
    for (const [x0, z0, x1, z1, h] of bodies) {
      const lv = [];
      for (let y = 0.36; y < h - 0.12; y += 0.36) lv.push(y);
      lv.push(h - 0.02);
      for (const [ax, az, bx, bz] of [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]]) {
        const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 0.62)), nx = -(bz - az) / len * 0.11, nz = (bx - ax) / len * 0.11;
        for (let i = 0; i < n; i++) { const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n; r.tube('planks', [x, 0, z], [x, h + 0.14, z], 0.013, 0.011, 5, POLE); }
        lv.forEach((y, i) => {
          r.rail('planks', ax, az, bx, bz, y - 0.011, y + 0.011, 0.018, POLE, true);
          if (i % 2 === 0 || i === lv.length - 1) r.slab('planks', [[ax, y + 0.024, az], [bx, y + 0.024, bz], [bx + nx, y + 0.024, bz + nz], [ax + nx, y + 0.024, az + nz]], 0.013, BOARD);
        });
        r.tube('planks', [ax, 0.04, az], [bx, h - 0.04, bz], 0.009, 0.009, 4, POLE);
      }
      r.ladder(x1 - 0.3, z1 + 0.22, z1 + 0.02, lv[0] + 0.03);
      if (z1 + 0.34 < size) {                                                       // bahan: papan bersilang dan batu tempa
        for (let l = 0; l < 4; l++) {
          const y = l * 0.035, ax = l % 2 === 0;
          for (let i = 0; i < 3; i++) {
            const o = (i - 1) * 0.07;
            if (ax) r.box('planks', x0 + 0.06, y, z1 + 0.17 + o - 0.03, x0 + 0.46, y + 0.035, z1 + 0.17 + o + 0.03, BOARD, 0.8, 1, true);
            else r.box('planks', x0 + 0.26 + o * 2 - 0.03, y, z1 + 0.05, x0 + 0.26 + o * 2 + 0.03, y + 0.035, z1 + 0.3, BOARD, 0.8, 1, true);
          }
        }
        for (const [dx, dz, y] of [[0.6, 0.1, 0], [0.74, 0.12, 0], [0.66, 0.24, 0], [0.67, 0.16, 0.07]]) r.box('plaster', x0 + dx - 0.055, y, z1 + dz - 0.04, x0 + dx + 0.055, y + 0.07, z1 + dz + 0.04, DRESSED, 0.8, 1, true);
      }
    }
    return (scache[type] = r.build(matOf));
  };

  const bcache = {};
  // Prototipe model bangunan (di-cache). Pakai .clone() untuk tiap bangunan: geometri & material dipakai bersama.
  // faction: kunci BF.FACTIONS → gaya bahan bangunan wangsa itu.
  models.building = function (type, owner, links, faction) {
    const key = type + ':' + owner + ':' + (links || 0) + ':' + (faction || '');
    return bcache[key] || (bcache[key] = buildingMesh(type, owner, links || 0, faction));
  };

  // ---------------------------------------------------------------- unit

  // Unit berkerangka: satu SkinnedMesh per unit (satu draw call). Tiap vertex terikat kaku ke satu tulang dan sendi ditutup
  // bola, sehingga lutut, siku, leher, dan kaki kuda bisa menekuk. Proporsi mendekati tubuh manusia dan kuda sungguhan.
  // Model menghadap +Z, kaki di y = 0, 1 satuan = 1 tile.
  const ucache = {};
  const mT = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z), mS = (x, y, z) => new THREE.Matrix4().makeScale(x, y, z);
  const mRx = a => new THREE.Matrix4().makeRotationX(a), mRz = a => new THREE.Matrix4().makeRotationZ(a);
  const CLOTH = [0.92, 0], HIDE = [0.62, 0], PLATE = [0.36, 1], MAIL = [0.55, 0.85], GILT = [0.35, 1];   // [kekasaran, kelogaman]
  const lerp = (a, b, k) => a + (b - a) * k;

  class Rig {
    constructor() { this.mb = new MB(); this.mb.smooth = true; this.mb.skinned = true; this.bones = []; this.index = {}; this.extras = {}; }
    bone(name, parent, x, y, z) { this.index[name] = this.bones.length; this.bones.push({ name, parent: parent ? this.index[parent] : -1, pos: [x, y, z] }); }
    // Semua yang digambar fn terikat ke tulang `name` dengan sifat permukaan pbr.
    on(name, pbr, fn) {
      const m = this.mb, b0 = m.bone, p0 = m.pbr;
      m.bone = this.index[name]; m.pbr = pbr;
      fn(m);
      m.bone = b0; m.pbr = p0;
    }
    // Bagian yang bisa disembunyikan (alat kerja, bawaan): mesh terpisah yang menempel pada tulang.
    extra(name, bone, pbr, fn) { const m = new MB(); m.smooth = true; m.pbr = pbr; fn(m); this.extras[name] = { geo: m.geometry('flat'), bone: this.index[bone] }; }
    done() {
      const geo = this.mb.geometry('flat');
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 1.5);      // longgar: mencakup ayunan senjata
      return { geo, bones: this.bones, extras: this.extras };
    }
  }

  // ---- manusia: tinggi ±0,84 tile; pinggul, lutut, bahu, siku pada proporsi tubuh dewasa
  const HU = { HIP: 0.44, KNEE: 0.235, SH: 0.685, SHX: 0.108, UA: 0.15, FA: 0.14, HX: 0.05, NECK: 0.715, HEAD: 0.778 };
  const HAND_Y = HU.SH - HU.UA - HU.FA;

  // oy/oz menggeser badan atas (penunggang duduk di pelana); legs = false untuk penunggang.
  function humanBones(r, parent, oy, oz, legs) {
    const H = HU;
    r.bone('pelvis', parent, 0, H.HIP + oy, oz);
    r.bone('spine', 'pelvis', 0, H.HIP + 0.03 + oy, oz);
    r.bone('head', 'spine', 0, H.NECK + oy, oz);
    for (const [s, k] of [['L', -1], ['R', 1]]) {
      r.bone('arm' + s, 'spine', k * H.SHX, H.SH + oy, oz);
      r.bone('fore' + s, 'arm' + s, k * H.SHX, H.SH - H.UA + oy, oz);
      r.bone('wpn' + s, 'fore' + s, k * H.SHX, HAND_Y + oy, oz);
      if (legs) { r.bone('thigh' + s, 'pelvis', k * H.HX, H.HIP, 0); r.bone('shin' + s, 'thigh' + s, k * H.HX, H.KNEE, 0); }
    }
  }

  // o: { top, skin, pants, boots, hair, belt, sleeve: 'long'|'short'|'none', torso: pbr, torsoCol, arms: pbr, armCol, skirt: warna|false, greaves }
  function humanBody(r, o, oy, oz, legs) {
    const H = HU, skin = o.skin || SKIN, pants = o.pants || C('#5a4630'), boot = o.boots || C('#2e2218');
    const torso = o.torso || CLOTH, torsoCol = o.torsoCol || o.top, armPbr = o.arms || CLOTH, armCol = o.armCol || o.top;
    r.on('pelvis', CLOTH, m => {
      m.geom('flat', new THREE.SphereGeometry(0.09, 12, 8), mT(0, H.HIP - 0.005 + oy, oz).multiply(mS(1, 0.72, 0.68)), pants, [0.85, 1]);
      if (o.skirt !== false) m.geom('flat', new THREE.CylinderGeometry(0.078, 0.108, 0.15, 12, 1, true), mT(0, H.HIP - 0.035 + oy, oz).multiply(mS(1, 1, 0.72)), mul(o.skirt || o.top, 0.88), [0.78, 1]);
    });
    r.on('spine', torso, m => {
      m.lathe('flat', [[0.074, 0.465], [0.08, 0.52], [0.092, 0.58], [0.1, 0.635], [0.097, 0.675], [0.07, 0.705], [0.036, 0.718]], 12, mT(0, oy, oz).multiply(mS(1, 1, 0.64)), torsoCol, [0.85, 1.05]);
      m.use(HIDE, () => m.geom('flat', new THREE.CylinderGeometry(0.079, 0.079, 0.03, 12), mT(0, 0.476 + oy, oz).multiply(mS(1, 1, 0.68)), o.belt || DARKW));
      m.use(GILT, () => m.box('flat', -0.016, 0.463 + oy, oz + 0.05, 0.016, 0.489 + oy, oz + 0.058, GOLD, 1, 1));
      m.use(HIDE, () => m.cyl('flat', 0, 0.7 + oy, oz, 0.03, 0.027, 0.04, 8, skin));
    });
    r.on('head', HIDE, m => {
      const y = H.HEAD + oy;
      m.geom('flat', new THREE.SphereGeometry(0.06, 14, 10), mT(0, y, oz + 0.004).multiply(mS(0.9, 1.08, 1)), skin, [0.9, 1.05]);
      m.geom('flat', new THREE.SphereGeometry(0.012, 6, 4), mT(0, y - 0.01, oz + 0.062), mul(skin, 0.94));
      m.box('flat', -0.03, y + 0.004, oz + 0.052, -0.014, y + 0.014, oz + 0.061, DARK); m.box('flat', 0.014, y + 0.004, oz + 0.052, 0.03, y + 0.014, oz + 0.061, DARK);
      if (o.hair) m.geom('flat', new THREE.SphereGeometry(0.063, 12, 6, 0, TAU, 0, Math.PI * 0.55), mT(0, y + 0.008, oz - 0.006), o.hair, [0.8, 1.1]);
    });
    for (const [s, k] of [['L', -1], ['R', 1]]) {
      const ax = k * H.SHX, sy = H.SH + oy, bare = o.sleeve === 'none', long = o.sleeve === 'long';
      r.on('arm' + s, bare ? HIDE : armPbr, m => {
        m.geom('flat', new THREE.SphereGeometry(0.04, 10, 7), mT(ax, sy - 0.004, oz), bare ? skin : armCol);
        m.cyl('flat', ax, sy - H.UA, oz, 0.029, 0.036, H.UA, 8, bare ? skin : armCol, [0.9, 1]);
      });
      r.on('fore' + s, long ? armPbr : HIDE, m => {
        m.geom('flat', new THREE.SphereGeometry(0.03, 8, 6), mT(ax, sy - H.UA, oz), long ? armCol : skin);
        m.cyl('flat', ax, HAND_Y + oy, oz, 0.022, 0.029, H.FA, 8, long ? armCol : skin, [0.9, 1]);
        m.use(HIDE, () => m.geom('flat', new THREE.SphereGeometry(0.026, 8, 6), mT(ax, HAND_Y + oy - 0.012, oz).multiply(mS(0.8, 1.15, 1)), o.gloves || skin));
      });
      if (!legs) continue;
      const lx = k * H.HX;
      r.on('thigh' + s, CLOTH, m => m.cyl('flat', lx, H.KNEE, 0, 0.04, 0.057, H.HIP - H.KNEE, 9, pants, [0.85, 1]));
      r.on('shin' + s, o.greaves ? PLATE : CLOTH, m => {
        m.geom('flat', new THREE.SphereGeometry(0.041, 8, 6), mT(lx, H.KNEE, 0), o.greaves || pants);
        m.lathe('flat', [[0.028, 0.045], [0.034, 0.1], [0.044, 0.17], [0.04, H.KNEE]], 9, mT(lx, 0, 0), o.greaves || pants, [0.85, 1]);
        m.use([0.7, 0], () => { m.geom('flat', new THREE.SphereGeometry(0.036, 8, 6), mT(lx, 0.03, 0.026).multiply(mS(0.95, 0.82, 1.9)), boot); m.cyl('flat', lx, 0.02, 0, 0.03, 0.032, 0.07, 8, boot); });
      });
    }
  }

  // ---- perlengkapan. k: -1 = tangan kiri, +1 = kanan. Senjata terikat ke tulang wpn (di telapak) agar bisa diarahkan sendiri.
  const side = k => (k < 0 ? 'L' : 'R');
  function gearSpear(r, k, oy, oz, len) {                 // tegak di genggaman, ujung ke atas
    const x = k * HU.SHX, y = HAND_Y + oy, z = oz + 0.03;
    r.on('wpn' + side(k), [0.8, 0], m => m.cyl('flat', x, y - 0.38, z, 0.011, 0.011, len + 0.38, 6, C('#8a6238')));
    r.on('wpn' + side(k), PLATE, m => m.geom('flat', new THREE.ConeGeometry(0.024, 0.15, 6), mT(x, y + len + 0.07, z).multiply(mS(1, 1, 0.4)), STEEL));
  }
  function gearSword(r, oy, oz) {                         // bilah mengarah ke depan (+Z) dari tangan kanan
    const x = HU.SHX, y = HAND_Y + oy - 0.012, z = oz;
    r.on('wpnR', [0.24, 1], m => m.box('flat', x - 0.006, y - 0.017, z + 0.05, x + 0.006, y + 0.017, z + 0.5, C('#e6eaef'), 1, 1));
    r.on('wpnR', GILT, m => { m.box('flat', x - 0.045, y - 0.01, z + 0.034, x + 0.045, y + 0.01, z + 0.052, GOLD, 1, 1); m.ball('flat', x, y, z - 0.04, 0.014, GOLD, 1); });
    r.on('wpnR', HIDE, m => m.geom('flat', new THREE.CylinderGeometry(0.011, 0.011, 0.075, 6), mT(x, y, z).multiply(mRx(Math.PI / 2)), DARKW));
  }
  function gearAxe(r, k, oy, oz) {                        // gagang ke depan, mata kapak di ujung
    const x = k * HU.SHX, y = HAND_Y + oy - 0.012, z = oz;
    r.on('wpn' + side(k), [0.8, 0], m => m.geom('flat', new THREE.CylinderGeometry(0.011, 0.011, 0.36, 6), mT(x, y, z + 0.14).multiply(mRx(Math.PI / 2)), C('#5b3d20')));
    r.on('wpn' + side(k), PLATE, m => { m.box('flat', x - 0.007, y - 0.1, z + 0.24, x + 0.007, y + 0.03, z + 0.31, STEEL, 1, 1); m.box('flat', x - 0.004, y - 0.12, z + 0.22, x + 0.004, y - 0.09, z + 0.33, STEEL, 1, 1); });
  }
  function gearBow(r, oy, oz, R) {                        // di tangan kiri: busur tegak pada bidang YZ, melengkung ke depan
    const x = -HU.SHX, y = HAND_Y + oy, z = oz + 0.03, A = 1.12, pt = a => [x, y + R * Math.sin(a), z + 0.18 * (Math.cos(a) - Math.cos(A))];
    r.on('wpnL', [0.75, 0], m => { for (let i = 0; i < 8; i++) m.tube('flat', pt(-A + i * A / 4), pt(-A + (i + 1) * A / 4), 0.009, 0.009, 5, C('#7a5632')); });
    r.on('wpnL', CLOTH, m => m.tube('flat', pt(-A), pt(A), 0.0025, 0.0025, 4, C('#e9dcc0')));
  }
  function gearRoundShield(r, col, oy, oz) {
    const x = -HU.SHX - 0.048, y = HAND_Y + oy + 0.075, z = oz + 0.01;
    r.on('foreL', [0.8, 0], m => m.geom('flat', new THREE.CylinderGeometry(0.135, 0.135, 0.022, 18), mT(x, y, z).multiply(mRz(Math.PI / 2)), col));
    r.on('foreL', PLATE, m => { m.geom('flat', new THREE.TorusGeometry(0.135, 0.011, 5, 18), mT(x, y, z).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)), STEEL); m.ball('flat', x - 0.016, y, z, 0.036, STEEL, 1); });
  }
  // Perisai dipasang melintang pada lengan bawah: saat lengan bawah mendatar di depan badan, sumbu panjangnya tegak.
  function gearKiteShield(r, col, oy, oz) {               // perisai layang: lebar di atas, meruncing ke bawah
    const x = -HU.SHX - 0.046, y = HAND_Y + oy + 0.06, z = oz + 0.01;
    r.on('foreL', [0.7, 0], m => m.geom('flat', new THREE.CylinderGeometry(0.115, 0.035, 0.36, 12), mT(x, y, z + 0.03).multiply(mRx(Math.PI / 2)).multiply(mS(0.16, 1, 1)), col));
    r.on('foreL', GILT, m => m.ball('flat', x - 0.02, y, z + 0.07, 0.03, GOLD, 1));
  }
  function gearTowerShield(r, col, oy, oz) {              // perisai besar persegi berbingkai baja
    const x = -HU.SHX - 0.05, y = HAND_Y + oy + 0.05, z = oz + 0.01;
    r.on('foreL', PLATE, m => m.box('flat', x - 0.016, y - 0.13, z - 0.25, x + 0.012, y + 0.13, z + 0.25, C('#c3c9d0'), 1, 1));
    r.on('foreL', [0.8, 0], m => m.box('flat', x - 0.022, y - 0.095, z - 0.21, x - 0.014, y + 0.095, z + 0.21, col, 1, 1));
    r.on('foreL', GILT, m => m.ball('flat', x - 0.026, y, z, 0.034, GOLD, 1));
  }
  function gearHelmet(r, col, oy, oz, crest) {            // topi baja + bingkai + pelindung hidung; crest: warna jambul
    const y = HU.HEAD + oy;
    r.on('head', PLATE, m => {
      m.geom('flat', new THREE.SphereGeometry(0.066, 14, 7, 0, TAU, 0, Math.PI / 2), mT(0, y + 0.012, oz + 0.002).multiply(mS(0.94, 1.05, 1.02)), col, [0.8, 1.1]);
      m.geom('flat', new THREE.CylinderGeometry(0.066, 0.066, 0.012, 14), mT(0, y + 0.012, oz + 0.002).multiply(mS(0.96, 1, 1.04)), mul(col, 0.8));
      m.box('flat', -0.008, y - 0.03, oz + 0.058, 0.008, y + 0.02, oz + 0.068, mul(col, 0.8));
    });
    if (crest) r.on('head', CLOTH, m => m.geom('flat', new THREE.SphereGeometry(0.05, 10, 6, 0, TAU, 0, Math.PI / 2), mT(0, y + 0.07, oz - 0.01).multiply(mS(0.22, 1.1, 1.25)), crest, [0.8, 1.1]));
  }
  function gearQuiver(r, oy, oz) {
    r.on('spine', HIDE, m => m.tube('flat', [0.03, 0.5 + oy, oz - 0.08], [0.075, 0.74 + oy, oz - 0.075], 0.026, 0.03, 8, C('#6b4a2a')));
    r.on('spine', CLOTH, m => { for (const dx of [-0.012, 0.004, 0.016]) m.tube('flat', [0.075 + dx, 0.74 + oy, oz - 0.075], [0.085 + dx, 0.8 + oy, oz - 0.073], 0.004, 0.004, 4, C('#e9dcc0')); });
  }

  // ---- kuda: tinggi punggung ±0,78 tile; badan berprofil (dada dalam, pinggang ramping, pinggul bulat), kaki dua ruas
  function horse(r, coat, team, rider) {
    const dk = mul(coat, 0.62), maneC = C('#241710'), hoofC = C('#1d1814');
    r.bone('root', null, 0, 0, 0);
    r.bone('body', 'root', 0, 0.66, 0);
    r.bone('neck', 'body', 0, 0.72, 0.24);
    r.bone('hhead', 'neck', 0, 1.0, 0.43);
    r.bone('tail', 'body', 0, 0.77, -0.3);
    for (const [s, k] of [['L', -1], ['R', 1]]) {
      r.bone('fU' + s, 'body', k * 0.075, 0.6, 0.2); r.bone('fL' + s, 'fU' + s, k * 0.075, 0.32, 0.215);
      r.bone('hU' + s, 'body', k * 0.075, 0.62, -0.22); r.bone('hL' + s, 'hU' + s, k * 0.075, 0.36, -0.275);
    }
    r.on('body', HIDE, m => {
      m.lathe('flat', [[0.012, -0.33], [0.075, -0.31], [0.115, -0.24], [0.122, -0.12], [0.116, 0.0], [0.124, 0.12], [0.128, 0.2], [0.105, 0.27], [0.06, 0.31], [0.012, 0.325]], 14, mT(0, 0.66, 0).multiply(mRx(Math.PI / 2)).multiply(mS(0.92, 1, 1.04)), coat, [0.72, 1.08]);
      for (const k of [-1, 1]) {
        m.geom('flat', new THREE.SphereGeometry(0.075, 10, 7), mT(k * 0.062, 0.65, 0.2).multiply(mS(0.8, 1.25, 1)), coat, [0.8, 1.05]);       // bahu
        m.geom('flat', new THREE.SphereGeometry(0.09, 10, 7), mT(k * 0.06, 0.67, -0.2).multiply(mS(0.82, 1.15, 1.1)), coat, [0.8, 1.05]);     // paha atas
      }
    });
    r.on('body', CLOTH, m => m.geom('flat', new THREE.CylinderGeometry(0.129, 0.129, 0.24, 14, 1, true), mT(0, 0.662, -0.02).multiply(mRx(Math.PI / 2)).multiply(mS(0.94, 1, 1.04)), team, [0.85, 1]));   // selimut pelana
    r.on('body', HIDE, m => {
      m.geom('flat', new THREE.SphereGeometry(0.085, 10, 6, 0, TAU, 0, Math.PI / 2), mT(0, 0.775, -0.02).multiply(mS(0.9, 0.42, 1.25)), C('#5b3d20'));    // pelana
      if (!rider) return;
      for (const k of [-1, 1]) {                                        // kaki penunggang: paha ke depan-bawah, betis turun, sepatu
        m.tube('flat', [k * 0.065, 0.81, -0.03], [k * 0.14, 0.63, 0.08], 0.052, 0.042, 8, rider.pants);
        m.ball('flat', k * 0.14, 0.63, 0.08, 0.042, rider.pants, 1);
        m.tube('flat', [k * 0.14, 0.63, 0.08], [k * 0.152, 0.43, 0.045], 0.04, 0.028, 8, rider.pants);
        m.geom('flat', new THREE.SphereGeometry(0.034, 8, 6), mT(k * 0.154, 0.405, 0.07).multiply(mS(0.95, 0.85, 1.8)), rider.boots);
      }
    });
    r.on('neck', HIDE, m => {
      m.tube('flat', [0, 0.69, 0.2], [0, 1.01, 0.435], 0.105, 0.058, 10, coat, [0.85, 1.05], 0.7);
      m.tube('flat', [0, 0.78, 0.17], [0, 1.06, 0.4], 0.034, 0.022, 6, maneC, null, 0.4);                                                          // surai
    });
    r.on('hhead', HIDE, m => {
      m.tube('flat', [0, 1.045, 0.395], [0, 0.865, 0.625], 0.062, 0.036, 10, coat, null, 0.76);
      m.geom('flat', new THREE.SphereGeometry(0.052, 8, 6), mT(0, 0.975, 0.455).multiply(mS(0.8, 1.1, 1)), coat);                                 // rahang
      m.geom('flat', new THREE.SphereGeometry(0.037, 8, 6), mT(0, 0.857, 0.633).multiply(mS(0.82, 1, 1)), dk);                                    // moncong
      for (const k of [-1, 1]) { m.geom('flat', new THREE.ConeGeometry(0.016, 0.065, 5), mT(k * 0.032, 1.095, 0.385), coat); m.ball('flat', k * 0.04, 1.0, 0.47, 0.009, DARK, 1); }
      m.tube('flat', [0, 1.075, 0.385], [0, 1.02, 0.47], 0.022, 0.012, 5, maneC, null, 0.5);                                                       // jambul
    });
    r.on('tail', HIDE, m => m.lathe('flat', [[0.012, -0.44], [0.036, -0.32], [0.042, -0.16], [0.024, -0.03], [0.012, 0]], 7, mT(0, 0.775, -0.31).multiply(mRx(0.25)), maneC));
    // Kaki: lengan atas berotot (depan) / paha-betis (belakang), lalu tulang kering ramping yang pipih, sendi fetlock, pastern
    // miring ke depan, dan kuku yang melebar ke bawah. Kaki belakang bertumit (hock) runcing menonjol ke belakang.
    for (const [s, k] of [['L', -1], ['R', 1]]) {
      const x = k * 0.075;
      r.on('fU' + s, HIDE, m => {
        m.tube('flat', [x, 0.62, 0.2], [x, 0.33, 0.215], 0.058, 0.03, 9, coat, [0.85, 1], 0.85);
        m.geom('flat', new THREE.SphereGeometry(0.036, 8, 6), mT(x, 0.55, 0.165).multiply(mS(0.8, 1.2, 1)), coat);           // siku
      });
      r.on('hU' + s, HIDE, m => m.tube('flat', [x, 0.65, -0.2], [x, 0.37, -0.283], 0.072, 0.033, 9, coat, [0.85, 1], 0.8));
      for (const [bone, jy, jz, fz, hind] of [['fL' + s, 0.32, 0.215, 0.212, false], ['hL' + s, 0.36, -0.278, -0.262, true]])
        r.on(bone, HIDE, m => {
          m.geom('flat', new THREE.SphereGeometry(0.032, 8, 6), mT(x, jy, jz).multiply(mS(0.85, 1.15, 1)), coat);            // lutut / tumit
          if (hind) m.geom('flat', new THREE.ConeGeometry(0.02, 0.06, 6), mT(x, jy + 0.025, jz - 0.03).multiply(mRx(-2.3)), coat);   // ujung tumit
          m.tube('flat', [x, jy - 0.01, jz + 0.002], [x, 0.115, fz], 0.024, 0.019, 7, dk, null, 0.72);                         // tulang kering
          m.geom('flat', new THREE.SphereGeometry(0.028, 8, 6), mT(x, 0.1, fz - 0.004).multiply(mS(0.85, 1, 1.15)), dk);       // fetlock
          m.tube('flat', [x, 0.1, fz], [x, 0.05, fz + 0.024], 0.021, 0.023, 7, dk);                                          // pastern
          m.use([0.5, 0], () => m.geom('flat', new THREE.CylinderGeometry(0.026, 0.035, 0.05, 10), mT(x, 0.025, fz + 0.03).multiply(mRx(0.18)), hoofC));   // kuku
        });
    }
  }

  // ---- hewan liar: rusa (ramping, berleher panjang, pantat & ekor putih, jantan bertanduk) dan babi hutan (gempal,
  // berpunggung tinggi bersurai kasar, moncong panjang, taring). Kerangka bernama sama dengan kuda: pose berbagi pola gerak.
  const ANIMAL_P = {
    deer: { by: 0.45, len: 0.31, sh: 0.17, hip: -0.18, lx: 0.052, knee: 0.25, hock: 0.29, coat: '#7a583b', pale: '#e9e0cf',
      prof: [[0.01, -0.31], [0.06, -0.29], [0.092, -0.22], [0.098, -0.1], [0.092, 0.02], [0.097, 0.13], [0.096, 0.2], [0.077, 0.26], [0.04, 0.3], [0.01, 0.31]], body: [0.82, 1, 1.12],
      neck: [[0, 0.5, 0.2], [0, 0.71, 0.3]], nr: [0.05, 0.03], head: [[0, 0.74, 0.29], [0, 0.66, 0.44]], hr: [0.042, 0.019], leg: [0.034, 0.016], lie: 0.1 },
    boar: { by: 0.27, len: 0.3, sh: 0.15, hip: -0.16, lx: 0.06, knee: 0.13, hock: 0.15, coat: '#4a3b31', pale: '#6b5747',
      prof: [[0.01, -0.29], [0.07, -0.27], [0.1, -0.2], [0.11, -0.08], [0.122, 0.04], [0.13, 0.14], [0.12, 0.22], [0.09, 0.27], [0.05, 0.3], [0.01, 0.31]], body: [0.86, 1, 1.08],
      neck: [[0, 0.3, 0.22], [0, 0.29, 0.3]], nr: [0.1, 0.085], head: [[0, 0.3, 0.29], [0, 0.2, 0.5]], hr: [0.08, 0.03], leg: [0.032, 0.02], lie: 0.13 },
  };

  const FUR = [0.9, 0];                                   // bulu: kusam (≥ 0,85 → ikut peta normal kain, tampak seperti helai)
  function quad(r, type, antlers) {
    const P = ANIMAL_P[type], coat = C(P.coat), dk = mul(coat, 0.62), pale = C(P.pale), hoof = C('#1d1814'), by = P.by, deer = type === 'deer', HIDE = FUR;
    r.bone('root', null, 0, 0, 0);
    r.bone('body', 'root', 0, by, 0);
    r.bone('neck', 'body', 0, P.neck[0][1], P.neck[0][2]);
    r.bone('hhead', 'neck', 0, P.head[0][1], P.head[0][2]);
    r.bone('tail', 'body', 0, by + 0.07, -P.len);
    for (const [sd, k] of [['L', -1], ['R', 1]]) {
      r.bone('fU' + sd, 'body', k * P.lx, by - 0.03, P.sh); r.bone('fL' + sd, 'fU' + sd, k * P.lx, P.knee, P.sh + 0.01);
      r.bone('hU' + sd, 'body', k * P.lx, by - 0.01, P.hip); r.bone('hL' + sd, 'hU' + sd, k * P.lx, P.hock, P.hip - 0.05);
    }
    r.on('body', HIDE, m => {
      m.lathe('flat', P.prof, 14, mT(0, by, 0).multiply(mRx(Math.PI / 2)).multiply(mS(P.body[0], P.body[1], P.body[2])), coat, [0.7, 1.08]);
      for (const k of [-1, 1]) m.geom('flat', new THREE.SphereGeometry(deer ? 0.055 : 0.07, 10, 7), mT(k * 0.038, by - 0.005, P.hip + 0.02).multiply(mS(0.7, 1.15, 1.15)), coat, [0.8, 1.02]);   // paha
      m.geom('flat', new THREE.SphereGeometry(0.08, 10, 6, 0, TAU, Math.PI / 2, Math.PI / 2), mT(0, by - 0.035, 0).multiply(mS(0.95, 0.6, 3)), deer ? pale : mul(coat, 0.8));   // perut lebih terang
      if (deer) m.geom('flat', new THREE.SphereGeometry(0.05, 10, 7), mT(0, by + 0.015, -P.len + 0.02).multiply(mS(1.1, 1.1, 0.45)), pale);       // pantat putih
      else for (let i = 0; i < 14; i++) {                                                                                                   // surai bulu kaku di punggung
        const z = -0.16 + i * 0.03, h = 0.018 + 0.014 * Math.sin(i / 13 * Math.PI);
        m.geom('flat', new THREE.ConeGeometry(0.011, h * 1.6, 4), mT(0, by + 0.118 + 0.022 * (z + 0.16) / 0.4 + h * 0.5, z).multiply(mRx(-1.0)), mul(coat, 0.5));
      }
    });
    r.on('neck', HIDE, m => {
      m.tube('flat', P.neck[0], P.neck[1], P.nr[0], P.nr[1], 10, coat, [0.85, 1.05], 0.8);
      if (deer) m.geom('flat', new THREE.SphereGeometry(0.035, 8, 6), mT(0, 0.6, 0.29).multiply(mS(0.8, 1.2, 0.7)), pale);                    // kerongkong putih
    });
    r.on('hhead', HIDE, m => {
      const [a, b] = P.head;
      m.tube('flat', a, b, P.hr[0], P.hr[1], 10, coat, null, 0.8);
      m.geom('flat', new THREE.SphereGeometry(P.hr[1] * 1.2, 8, 6), mT(b[0], b[1], b[2]), deer ? DARK : C('#5a3d35'));                         // hidung / cakram moncong
      for (const k of [-1, 1]) {
        const ey = a[1] + (b[1] - a[1]) * 0.3, ez = a[2] + (b[2] - a[2]) * 0.3;
        m.ball('flat', k * P.hr[0] * 0.85, ey + 0.012, ez, deer ? 0.009 : 0.008, DARK, 1);
        m.geom('flat', new THREE.ConeGeometry(deer ? 0.022 : 0.02, deer ? 0.07 : 0.05, 5), mT(k * P.hr[0] * 0.75, a[1] + 0.05, a[2] - 0.01).multiply(mRz(-k * 0.5)), coat);   // telinga
        if (!deer) m.use(PLATE, () => m.tube('flat', [k * 0.03, b[1] + 0.005, b[2] - 0.05], [k * 0.045, b[1] + 0.05, b[2] - 0.02], 0.009, 0.002, 5, C('#efe6d2')));   // taring
        if (deer && antlers) {                                                                                                                  // tanduk bercabang
          const r0 = [k * 0.02, a[1] + 0.035, a[2] + 0.005], r1 = [k * 0.07, a[1] + 0.13, a[2] - 0.02], r2 = [k * 0.08, a[1] + 0.21, a[2] + 0.02];
          m.tube('flat', r0, r1, 0.008, 0.006, 5, C('#cdb994')); m.tube('flat', r1, r2, 0.006, 0.003, 5, C('#d8c7a4'));
          m.tube('flat', r1, [k * 0.05, a[1] + 0.17, a[2] + 0.06], 0.005, 0.002, 4, C('#d8c7a4'));
        }
      }
    });
    r.on('tail', HIDE, m => m.tube('flat', [0, by + 0.07, -P.len], [0, by - (deer ? 0.0 : 0.05), -P.len - 0.04], deer ? 0.018 : 0.01, deer ? 0.008 : 0.005, 6, deer ? mul(coat, 0.85) : dk));
    for (const [sd, k] of [['L', -1], ['R', 1]]) {
      const x = k * P.lx;
      const ix = x * 0.7;                                                     // pangkal kaki masuk ke dalam badan (tak tampak tutup datarnya)
      r.on('fU' + sd, HIDE, m => m.tube('flat', [ix, by + 0.04, P.sh - 0.01], [x, P.knee, P.sh + 0.01], P.leg[0] * 1.35, P.leg[0], 8, coat, [0.85, 1]));
      r.on('hU' + sd, HIDE, m => m.tube('flat', [ix, by + 0.05, P.hip + 0.01], [x, P.hock, P.hip - 0.05], P.leg[0] * 1.7, P.leg[0], 8, coat, [0.85, 1]));
      for (const [bone, jy, jz] of [['fL' + sd, P.knee, P.sh + 0.01], ['hL' + sd, P.hock, P.hip - 0.05]])
        r.on(bone, HIDE, m => {
          m.ball('flat', x, jy, jz, P.leg[0] * 0.95, coat, 1);
          m.tube('flat', [x, jy, jz], [x, 0.045, jz + 0.012], P.leg[1] * 1.2, P.leg[1], 7, deer ? coat : dk);
          m.use([0.5, 0], () => m.geom('flat', new THREE.CylinderGeometry(P.leg[1] * 0.9, P.leg[1] * 1.4, 0.045, 8), mT(x, 0.022, jz + 0.016), hoof));
        });
    }
  }

  function unitDef(type, owner) {
    const key = type + ':' + owner;
    if (ucache[key]) return ucache[key];
    if (BF.ANIMALS[type]) { const r = new Rig(); quad(r, type, owner === 1); return (ucache[key] = r.done()); }      // owner = varian (1: rusa jantan)
    const team = C(BF.SLOTS[owner].color), teamD = C(BF.SLOTS[owner].dark), PANTS = C('#5a4630'), LEATHER = C('#6b4a2a'), HAIR = C('#2a1b10');
    if (type === 'catapult') return (ucache[key] = { parts: catapultParts(owner) });
    const r = new Rig(), cav = BF.UNITS[type].cls === 'cavalry', oy = cav ? 0.385 : 0, oz = cav ? -0.03 : 0, pants = type === 'sword' || type === 'guard' ? C('#6a6f77') : PANTS;
    if (cav) { horse(r, type === 'rider' ? C('#6f4424') : C('#a67c52'), team, { pants, boots: C('#2e2218') }); humanBones(r, 'body', oy, oz, false); }
    else { r.bone('root', null, 0, 0, 0); humanBones(r, 'root', 0, 0, true); }
    const body = o => humanBody(r, Object.assign({ top: team, pants, hair: HAIR, sleeve: 'long' }, o), oy, oz, !cav);
    const HY = HU.HEAD + oy;
    switch (type) {
      case 'healer':                                      // cadangan bila model aset `tabib` tidak termuat: jubah polos warna tim
        body({});
        break;
      case 'worker':
        body({ sleeve: 'short', hair: null });
        r.on('head', [1, 0], m => m.geom('flat', new THREE.ConeGeometry(0.14, 0.08, 18), mT(0, HY + 0.082, 0), C('#c9a85c'), [0.8, 1.1]));                          // caping
        r.on('spine', [0.95, 0], m => { m.geom('flat', new THREE.CylinderGeometry(0.062, 0.05, 0.17, 10), mT(0, 0.585, -0.1), C('#b08a4e'), [0.8, 1]); m.tube('flat', [-0.06, 0.69, 0.02], [-0.045, 0.66, -0.08], 0.008, 0.008, 4, LEATHER); m.tube('flat', [0.06, 0.69, 0.02], [0.045, 0.66, -0.08], 0.008, 0.008, 4, LEATHER); });   // keranjang punggung
        r.extra('tool', 'wpnR', [0.8, 0], m => { const x = HU.SHX, y = HAND_Y - 0.012; m.geom('flat', new THREE.CylinderGeometry(0.011, 0.011, 0.36, 6), mT(x, y, 0.14).multiply(mRx(Math.PI / 2)), C('#7a5632')); m.use(PLATE, () => m.box('flat', x - 0.008, y - 0.1, 0.25, x + 0.008, y + 0.04, 0.31, STEEL, 1, 1)); });
        for (const res of BF.RES) r.extra('pack_' + res, 'spine', [0.9, 0], m => m.geom('flat', new THREE.SphereGeometry(0.07, 10, 6, 0, TAU, 0, Math.PI / 2), mT(0, 0.665, -0.1).multiply(mS(1, 1.1, 0.9)), C(BF.RES_COLOR[res]), [0.85, 1.1]));
        break;
      case 'spear':
        body({ belt: LEATHER });
        gearHelmet(r, C('#aab4bf'), oy, oz); gearRoundShield(r, teamD, oy, oz); gearSpear(r, 1, oy, oz, 0.62);
        break;
      case 'sword':
        body({ torso: PLATE, torsoCol: C('#aeb6bf'), arms: MAIL, armCol: C('#8b939c'), skirt: team, greaves: C('#9aa3ad'), gloves: LEATHER });
        gearHelmet(r, C('#c9d0d8'), oy, oz, team); gearKiteShield(r, team, oy, oz); gearSword(r, oy, oz);
        break;
      case 'guard':
        body({ torso: PLATE, torsoCol: C('#7f8992'), arms: PLATE, armCol: C('#7f8992'), skirt: team, greaves: C('#7f8992'), gloves: C('#4a4f55') });
        for (const k of [-1, 1]) r.on('arm' + side(k), PLATE, m => m.geom('flat', new THREE.SphereGeometry(0.052, 10, 6, 0, TAU, 0, Math.PI / 2), mT(k * (HU.SHX + 0.004), HU.SH - 0.006, 0).multiply(mS(1, 0.9, 1.05)), C('#8f98a3')));   // pelindung bahu
        gearHelmet(r, C('#7d8791'), oy, oz, team); gearTowerShield(r, team, oy, oz); gearSpear(r, 1, oy, oz, 0.6);
        break;
      case 'berserk': {
        const tan = C('#d7a276');
        body({ skin: tan, top: tan, torso: HIDE, sleeve: 'none', skirt: C('#5b4632'), hair: C('#b8400e'), boots: C('#5b4632') });
        r.on('spine', CLOTH, m => {
          m.geom('flat', new THREE.SphereGeometry(0.115, 12, 6, 0, TAU, 0, Math.PI / 2), mT(0, 0.665, -0.012).multiply(mS(1.12, 0.5, 0.78)), C('#5b4632'), [0.8, 1.1]);     // mantel bulu
          m.tube('flat', [-0.085, 0.67, 0.058], [0.07, 0.49, 0.052], 0.016, 0.016, 5, team);                                                                               // selempang tim
        });
        r.on('head', CLOTH, m => m.geom('flat', new THREE.SphereGeometry(0.05, 8, 6, 0, TAU, 0, Math.PI / 2), mT(0, HY + 0.05, -0.012).multiply(mS(0.2, 1.3, 1.3)), C('#c2410c')));   // jambul
        gearAxe(r, -1, oy, oz); gearAxe(r, 1, oy, oz);
        break;
      }
      case 'archer':
        body({ belt: LEATHER });
        r.on('head', CLOTH, m => m.geom('flat', new THREE.SphereGeometry(0.068, 12, 7, 0, TAU, 0, Math.PI * 0.62), mT(0, HY + 0.006, -0.008), teamD, [0.8, 1.1]));         // tudung kain
        gearQuiver(r, oy, oz); gearBow(r, oy, oz, 0.27);
        break;
      case 'ranger': {
        const green = C('#3f6b3a');
        body({ top: green, belt: team });
        r.on('spine', CLOTH, m => m.geom('flat', new THREE.CylinderGeometry(0.1, 0.125, 0.34, 12, 1, true, Math.PI * 0.5, Math.PI), mT(0, 0.55, -0.012), C('#2f5233'), [0.8, 1]));   // jubah
        r.on('head', HIDE, m => { m.geom('flat', new THREE.ConeGeometry(0.075, 0.075, 12), mT(0, HY + 0.085, -0.004), LEATHER, [0.8, 1.1]); m.geom('flat', new THREE.CylinderGeometry(0.095, 0.095, 0.008, 14), mT(0, HY + 0.05, 0), LEATHER); m.tube('flat', [0.045, HY + 0.055, -0.01], [0.07, HY + 0.17, -0.03], 0.007, 0.002, 4, C('#f4f1e8')); });   // topi berbulu
        gearQuiver(r, oy, oz); gearBow(r, oy, oz, 0.32);
        break;
      }
      case 'rider':
        body({ torso: MAIL, torsoCol: C('#8b939c'), arms: MAIL, armCol: C('#8b939c'), skirt: team, gloves: LEATHER });
        r.on('spine', CLOTH, m => m.tube('flat', [-0.085, 0.67 + oy, oz + 0.058], [0.07, 0.49 + oy, oz + 0.052], 0.016, 0.016, 5, team));
        gearHelmet(r, C('#aab4bf'), oy, oz, team); gearSpear(r, 1, oy, oz, 0.78);
        break;
      case 'harcher':
        body({ belt: LEATHER });
        r.on('head', HIDE, m => { m.geom('flat', new THREE.SphereGeometry(0.067, 12, 7, 0, TAU, 0, Math.PI * 0.55), mT(0, HY + 0.008, oz - 0.004), LEATHER, [0.8, 1.1]); m.geom('flat', new THREE.TorusGeometry(0.062, 0.012, 5, 14), mT(0, HY + 0.012, oz).multiply(mRx(Math.PI / 2)), C('#3b2c1e')); });   // topi berbulu tepi
        gearQuiver(r, oy, oz); gearBow(r, oy, oz, 0.24);
        break;
    }
    return (ucache[key] = r.done());
  }

  // Pelontar batu (mangonel): rangka balok kayu bertekstur di atas empat roda papan berban besi, gulungan tali puntir
  // sebagai poros lengan, palang penahan berlapis kain warna tim, kerekan di belakang. Bagian yang bergerak terpisah:
  // lengan (berputar ke atas saat menembak), dua poros roda (berputar saat berjalan), kerekan (berputar saat menarik
  // lengan kembali). Menghadap +Z; poros lengan di (0, 0,3, 0,1).
  const ARM_PIVOT = [0, 0.3, 0.1], ARM_REST = 0.08, ARM_FIRE = 1.62;
  function catapultParts(owner) {
    const team = C(BF.SLOTS[owner].color), IRONC = C('#3a3836'), ROPE = C('#8a7553'), WOODC = new THREE.Color(1.08, 0.95, 0.8), DARKC = mul(WOODC, 0.7);
    const P = {}, part = (name, at, fn) => { const r = new Rakit(owner); fn(r); P[name] = { obj: r.build(matOf), at }; return P[name]; };
    part('body', [0, 0, 0], r => {
      for (const sx of [-1, 1]) {
        r.box('planks', sx * 0.2 - 0.04, 0.2, -0.5, sx * 0.2 + 0.04, 0.29, 0.5, WOODC, 0.8, 1.05, true);                    // balok samping
        r.tube('planks', [sx * 0.17, 0.29, 0.2], [sx * 0.17, 0.86, 0.24], 0.032, 0.03, 4, WOODC);                           // tiang penahan
        r.tube('planks', [sx * 0.2, 0.29, 0.47], [sx * 0.17, 0.78, 0.25], 0.024, 0.022, 4, DARKC);                         // penopang depan
        r.tube('planks', [sx * 0.2, 0.29, -0.06], [sx * 0.17, 0.62, 0.21], 0.022, 0.02, 4, DARKC);                          // penopang belakang
        r.box('planks', sx * 0.245 - 0.012, 0.29, -0.02, sx * 0.245 + 0.012, 0.33, 0.22, DARKC, 1, 1, true);                 // tuas penegang puntiran
        for (const z of [-0.46, -0.2, 0.2, 0.46]) r.box('flat', sx * 0.2 - 0.043, 0.215, z - 0.012, sx * 0.2 + 0.043, 0.295, z + 0.012, IRONC, 1, 1, true);   // pelat besi sambungan
        r.post(sx * 0.17, -0.38, 0.29, 0.4, 0.035);                                                                            // dudukan kerekan
      }
      for (const z of [-0.46, -0.2, 0.2, 0.46]) r.box('planks', -0.24, 0.21, z - 0.035, 0.24, 0.28, z + 0.035, DARKC, 0.85, 1, true);
      for (const z of [-0.3, 0.3]) r.tube('flat', [-0.33, 0.17, z], [0.33, 0.17, z], 0.022, 0.022, 6, IRONC);                  // poros roda
      r.tube('flat', [-0.165, 0.3, 0.1], [0.165, 0.3, 0.1], 0.068, 0.068, 10, ROPE);                                         // gulungan tali puntir
      for (const x of [-0.12, -0.04, 0.04, 0.12]) r.tube('flat', [x, 0.3, 0.1 - 0.072], [x, 0.3, 0.1 + 0.072], 0.004, 0.004, 3, mul(ROPE, 0.7));
      r.box('planks', -0.25, 0.82, 0.2, 0.25, 0.9, 0.28, WOODC, 0.9, 1.05, true);                                               // palang penahan
      r.box('flat', -0.1, 0.79, 0.165, 0.1, 0.93, 0.205, team, 0.85, 1.05, true);                                               // bantalan kain warna tim
      r.tube('planks', [-0.2, 0.29, 0.48], [-0.2, 1.0, 0.48], 0.012, 0.01, 5, DARKC);                                          // tiang panji
      for (const sd of [1, -1]) r.quad('flat', [[-0.2, 0.98, 0.48], [-0.2, 0.84, 0.48], [-0.2 + sd * 0 + 0.0, 0.91, 0.48 + 0.24]], [sd, 0, 0], team);
    });
    part('arm', ARM_PIVOT, r => {
      r.tube('planks', [0, 0, 0.07], [0, 0, -0.58], 0.04, 0.032, 4, WOODC);
      for (const z of [-0.02, -0.22, -0.42]) r.tube('flat', [0, 0, z], [0, 0, z - 0.025], 0.045, 0.04, 6, IRONC);
      r.geom('planks', new THREE.SphereGeometry(0.08, 12, 6, 0, TAU, Math.PI / 2, Math.PI / 2), mT(0, 0.06, -0.62), DARKC);       // mangkuk
      r.tube('flat', [0, 0.06, -0.62], [0, 0.065, -0.62], 0.082, 0.082, 12, IRONC);
    });
    const stone = new MB();
    stone.geom('flat', new THREE.DodecahedronGeometry(0.058, 0), mT(0, 0.075, -0.62), C('#8b8579'), [0.7, 1.05]);
    const batu = new THREE.Mesh(stone.geometry('flat'), BF.tex.mat.flat);
    batu.name = 'batu';
    batu.castShadow = true;
    P.arm.obj.add(batu);
    for (const [name, z] of [['axleF', 0.3], ['axleR', -0.3]]) part(name, [0, 0.17, z], r => {
      for (const sx of [-1, 1]) {
        const x = sx * 0.29, ax = mRz(Math.PI / 2);
        r.geom('planks', new THREE.CylinderGeometry(0.16, 0.16, 0.05, 18), mT(x, 0, 0).multiply(ax), WOODC);                       // roda papan
        r.geom('flat', new THREE.TorusGeometry(0.16, 0.014, 5, 20), mT(x, 0, 0).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)), IRONC);   // ban besi
        r.geom('flat', new THREE.CylinderGeometry(0.042, 0.042, 0.07, 10), mT(x, 0, 0).multiply(ax), IRONC);                       // naf
        for (const k of [0, 1]) r.geom('planks', new THREE.BoxGeometry(0.012, 0.3, 0.035), mT(x + sx * 0.028, 0, 0).multiply(mRx(k * Math.PI / 2)), DARKC);   // palang papan roda
      }
    });
    part('winch', [0, 0.38, -0.38], r => {
      r.tube('planks', [-0.15, 0, 0], [0.15, 0, 0], 0.045, 0.045, 8, DARKC);
      r.tube('flat', [-0.06, 0, 0], [0.06, 0, 0], 0.05, 0.05, 8, ROPE);
      for (const sx of [-1, 1]) for (const k of [0, 1]) r.geom('planks', new THREE.BoxGeometry(0.016, 0.24, 0.016), mT(sx * 0.21, 0, 0).multiply(mRx(k * Math.PI / 2)), WOODC);   // jari-jari pemutar
    });
    return P;
  }

  // Bangkai pelontar: poros depan patah sehingga hidung rangka terjerembap, poros & roda depan dan lengan terlempar ke samping.
  const wcache = {};
  models.catapultWreck = function (owner) {
    if (wcache[owner]) return wcache[owner];
    const P = catapultParts(owner), g = new THREE.Group(), put = (o, pos, rot) => { o.position.fromArray(pos); o.rotation.set(rot[0], rot[1], rot[2]); g.add(o); };
    put(P.body.obj, [0, -0.07, 0], [0.25, 0, 0]);                      // poros depan patah: hidung rangka menyentuh tanah
    put(P.axleR.obj, [0, 0.17, -0.25], [0, 0, 0]);
    put(P.axleF.obj, [0.56, 0.16, 0.36], [0, 1.2, 0]);                   // poros depan dan rodanya tergeletak di samping
    put(P.arm.obj, [-0.36, 0.035, 0.1], [0, 2.5, 0]);                    // lengan terlempar
    P.arm.obj.getObjectByName('batu').visible = false;
    return (wcache[owner] = g);
  };

  // ---- unit beranimasi: model berkerangka dari aset (BF.assets.model.<nama>) dengan klip diam, jalan, lari, mati, dan
  // klip khusus tiap jenis (pekerja: jalan_bawa, kerja, lempar; prajurit: serang).
  // Laju tanah sebuah klip langkah di tempat (tile/detik pada kecepatan putar 1): kecepatan mundur ujung telapak kaki
  // (tulang ToeBase; untuk kuda: tulang kuku yang disebut di `names`) selama menapak. Kaki dianggap menapak saat tingginya dalam 0,012 dari titik terendah sepanjang
  // klip; pada klip lari ada fase melayang (tak ada kaki yang menapak) yang tidak dihitung. Unit yang bergerak secepat
  // ini tampak tidak meluncur.
  function gaitSpeed(m, clip, names) {
    const { akar, skeleton } = BF.assets.kerangkaBaru(m), root = new THREE.Object3D(), v = new THREE.Vector3(), N = 120, pos = [];
    for (const b of akar) root.add(b);
    const mixer = new THREE.AnimationMixer(root);
    const feet = names ? names.map(n => skeleton.bones.find(b => b.name === n)) : ['Left', 'Right'].map(sd => skeleton.bones.find(b => b.name === sd + 'ToeBase') || skeleton.bones.find(b => b.name === sd + 'Foot'));
    mixer.clipAction(clip).play();
    for (let i = 0; i <= N; i++) {
      mixer.setTime(clip.duration * Math.min(i / N, 0.9999));
      root.updateMatrixWorld(true);
      pos.push(feet.map(f => { v.setFromMatrixPosition(f.matrixWorld); return [v.y, v.z]; }));
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    skeleton.dispose();
    let low = Infinity, dz = 0, n = 0;
    for (const q of pos) for (const f of q) low = Math.min(low, f[0]);
    for (let i = 1; i <= N; i++) {
      const y = k => (pos[i][k][0] + pos[i - 1][k][0]) / 2;
      let k = 0;
      for (let j = 1; j < feet.length; j++) if (y(j) < y(k)) k = j;                    // kaki yang paling rendah = yang menapak
      if (y(k) > low + 0.012) continue;
      dz += pos[i - 1][k][1] - pos[i][k][1];
      n++;
    }
    return n ? Math.max(0.05, dz / (n * clip.duration / N)) : 0.5;
  }

  // Klip lari turunan dari klip jalan, dipakai selama aset belum menyediakan klip `lari`: unit bergerak ±2,4 tile/detik
  // sedangkan laju tanah klip jalan hanya ±0,5 tile/detik, jadi kaki tampak meluncur. Di sini ayunan paha dan lengan
  // diperbesar di sekitar pose rata-ratanya, tekukan lutut diperbesar dari pose istirahat (lutut tidak pernah menekuk
  // ke belakang), dan badan dicondongkan ke depan. Karena pinggul tidak ikut turun, kaki hanya menapak di sekitar
  // posisi tegak dan melayang di ujung-ujung ayunan — seperti orang berlari.
  function runClip(m, base, name) {
    const T = m.kerangka.tulang, q = new THREE.Quaternion(), ref = new THREE.Quaternion(), d = new THREE.Quaternion();
    const lean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.2);
    const gain = bone => (/UpLeg$/.test(bone) ? [2.3, 0] : /Leg$/.test(bone) ? [1.5, 1] : /^(Left|Right)Arm$/.test(bone) ? [1.6, 0] : null);      // [pengali, 1 = dari pose istirahat]
    return new THREE.AnimationClip(name, base.duration, base.tracks.map(tr => {
      const c = tr.clone(), v = c.values, [bone, prop] = c.name.split('.'), g = prop === 'quaternion' ? gain(bone) : null;
      if (g) {
        if (g[1]) ref.fromArray(T.find(t => t.nama === bone).r);
        else {                                            // rata-rata kuaternion sepanjang klip
          const a = [0, 0, 0, 0];
          for (let i = 0; i < v.length; i += 4) { const sg = v[i] * v[0] + v[i + 1] * v[1] + v[i + 2] * v[2] + v[i + 3] * v[3] < 0 ? -1 : 1; for (let j = 0; j < 4; j++) a[j] += v[i + j] * sg; }
          ref.fromArray(a).normalize();
        }
        for (let i = 0; i < v.length; i += 4) {
          d.copy(ref).invert().multiply(q.fromArray(v, i));
          if (d.w < 0) d.set(-d.x, -d.y, -d.z, -d.w);
          const h = Math.acos(Math.min(1, d.w)), sn = Math.sin(h);
          if (sn > 1e-5) { const h2 = h * g[0], k = Math.sin(h2) / sn; d.set(d.x * k, d.y * k, d.z * k, Math.cos(h2)); }
          q.copy(ref).multiply(d).toArray(v, i);
        }
      }
      if (bone === 'Spine' && prop === 'quaternion') for (let i = 0; i < v.length; i += 4) q.fromArray(v, i).premultiply(lean).toArray(v, i);
      return c;
    }));
  }

  models.gaitSpeed = gaitSpeed;

  // Klip lari sambil membawa: kaki dan badan dari klip lari, lengan kiri (yang menahan beban) dari klip jalan membawa.
  function carryClip(run, carry, name) {
    const arm = /^Left(Shoulder|Arm|ForeArm|Hand)\./, k = run.duration / carry.duration;
    return new THREE.AnimationClip(name, run.duration, run.tracks.filter(t => !arm.test(t.name)).map(t => t.clone()).concat(carry.tracks.filter(t => arm.test(t.name)).map(t => {
      const c = t.clone();
      for (let i = 0; i < c.times.length; i++) c.times[i] *= k;
      return c;
    })));
  }

  // Detik saat tangan kanan paling jauh terjulur ke depan dalam sebuah klip pukul/lempar (saat kena/lepas).
  function reachTime(m, clip) {
    const { akar, skeleton } = BF.assets.kerangkaBaru(m), root = new THREE.Object3D(), v = new THREE.Vector3(), hand = skeleton.bones.find(b => b.name === 'RightHand'), N = 48;
    for (const b of akar) root.add(b);
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(clip).play();
    let best = 0, bz = -Infinity;
    for (let i = 0; i <= N; i++) {
      const t = clip.duration * Math.min(i / N, 0.9999);
      mixer.setTime(t);
      root.updateMatrixWorld(true);
      const z = v.setFromMatrixPosition(hand.matrixWorld).z;
      if (z > bz) { bz = z; best = t; }
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    skeleton.dispose();
    return best;
  }

  // Unit yang memakai model berkerangka dari aset (bila modelnya ada; kalau tidak, rig buatan kode di bawah tetap dipakai).
  // strike: klip sekali-main yang dipicu saat unit menyerang (pekerja: melempar tombak buruan). at: detik kena/lepas pada
  // klip itu bila tidak bertepatan dengan tangan kanan paling terjulur (yang diukur otomatis). feet: tulang yang menapak
  // tanah untuk mengukur laju klip (unit berkuda: keempat kuku). sphere: bola pembatas [x, y, z, r] bila lebih besar.
  const HOOVES = ['HorseFrontL3', 'HorseFrontR3', 'HorseHindL3', 'HorseHindR3'], MOUNTED = [0, 0.6, 0.1, 2];
  const RIGGED = {
    worker: { model: 'pekerja', strike: 'lempar' },
    spear: { model: 'tombak', strike: 'serang' },
    sword: { model: 'pedang', strike: 'serang' },
    guard: { model: 'pengawal', strike: 'serang' },
    archer: { model: 'pemanah', strike: 'serang', at: 0.58 },      // memanah: saat lepas, tangan kanan justru di belakang
    ranger: { model: 'pemburu', strike: 'serang', at: 0.58 },
    berserk: { model: 'pengamuk', strike: 'serang', at: 0.29 },      // dua hantaman beruntun: kapak kanan 0,29 s, kiri 0,46 s
    rider: { model: 'penunggang', strike: 'serang', at: 0.35, feet: HOOVES, sphere: MOUNTED },         // kuda + penunggang satu kerangka
    harcher: { model: 'pemanah_kuda', strike: 'serang', at: 0.58, feet: HOOVES, sphere: MOUNTED },
    healer: { model: 'tabib' },                                      // tanpa klip serang; klip `kerja` (berulang) = menyembuhkan
    // Pelontar Batu: mesin beroda + juru lontar dalam satu kerangka. Klip serang 4,2 s: batu lepas di 0,2 s, lalu lengan
    // ditarik turun dan batu baru dimuat (cooldown unit 5 s). Saat mati rangkanya ambruk dan bagiannya menyebar.
    catapult: { model: 'pelontar', strike: 'serang', at: 0.2, sphere: [0, 0.45, -0.2, 1.4] },
  };
  const kits = {};
  function rigKit(type) {
    if (type in kits) return kits[type];
    const R = RIGGED[type], m = R && BF.assets.model[R.model];
    if (!m || !m.klip || !m.klip.diam || !m.klip.jalan || !m.klip.mati) return (kits[type] = null);
    const K = m.kerangka, at = name => K.tulang.findIndex(t => t.nama === name);
    const sp = R.sphere || [0, 0.4, -0.2, 1.3], ball = new THREE.Sphere(new THREE.Vector3(sp[0], sp[1], sp[2]), sp[3]);
    for (const g of m.lod) g.boundingSphere = ball;        // longgar: mencakup senjata dan rebah saat mati (semua tingkat rinci)
    // klip bergerak: `lari` / `lari_bawa` dari aset bila ada, kalau tidak diturunkan dari klip jalan; laju tanahnya
    // diukur supaya kecepatan putar klip bisa disamakan dengan kecepatan gerak unit (kaki tidak meluncur)
    const lari = m.klip.lari || runClip(m, m.klip.jalan, 'lari'), gerak = { lari: { clip: lari, laju: gaitSpeed(m, lari, R.feet) } };
    if (m.klip.jalan_bawa) {
      const bawa = m.klip.lari_bawa || (m.klip.lari ? carryClip(lari, m.klip.jalan_bawa, 'lari_bawa') : runClip(m, m.klip.jalan_bawa, 'lari_bawa'));
      gerak.lari_bawa = { clip: bawa, laju: gaitSpeed(m, bawa) };
    }
    // simulasi sudah menjatuhkan kerusakan/melepas tombak saat serangan dipicu, jadi klip pukul dimulai sesaat sebelum
    // detik kena — yang terlihat adalah hantamannya dan gerak kembalinya
    const strike = m.klip[R.strike] ? R.strike : null, strikeAt = strike ? Math.max(0, (R.at !== undefined ? R.at : reachTime(m, m.klip[strike])) - 0.12) : 0;
    const kit = kits[type] = { type, m, K, gerak, strike, strikeAt, tint: {}, extras: [] };
    if (type !== 'worker') return kit;
    // pekerja: alat kerja di tangan kanan dan bawaan di punggung — mesh kaku yang menempel pada tulang; geometrinya ditulis
    // dalam ruang model (pose istirahat) dan dibawa ke ruang tulang oleh matriks ikat-balik tulang itu
    const rest = k => new THREE.Matrix4().copy(K.ibm[k]).invert(), P = k => new THREE.Vector3().setFromMatrixPosition(rest(k));
    const mk = fn => { const b = new MB(); b.smooth = true; fn(b); return b.geometry('flat'); };
    const hand = at('RightHand'), back = at('Spine1'), hp = P(hand), sh = P(at('LeftArm'));
    const grip = new THREE.Vector3(0, 1, 0).transformDirection(rest(hand)).multiplyScalar(0.05).add(hp);      // kepalan: 5 cm dari pergelangan
    kit.extras.push(['tool', mk(b => {                    // cangkul/kapak: gagang ke depan, bilah di ujungnya
      b.pbr = [0.8, 0];
      b.tube('flat', [grip.x, grip.y, grip.z - 0.07], [grip.x, grip.y + 0.02, grip.z + 0.3], 0.011, 0.011, 6, C('#7a5632'));
      b.use(PLATE, () => b.box('flat', grip.x - 0.008, grip.y - 0.09, grip.z + 0.25, grip.x + 0.008, grip.y + 0.05, grip.z + 0.31, STEEL, 1, 1));
    }), hand]);
    for (const res of BF.RES) kit.extras.push(['pack_' + res, mk(b => {      // bawaan: ikatan kayu di bahu kiri, atau karung yang disandang di punggung
      const x = sh.x * 0.9, y = sh.y + 0.075, z = sh.z - 0.01, col = C(BF.RES_COLOR[res]), sack = C('#b89e74').lerp(col, 0.45);
      b.pbr = [0.9, 0];
      if (res === 'wood') { for (const [dx, dy] of [[-0.03, 0], [0.03, 0], [0, 0.045]]) b.tube('flat', [x + dx, y + dy - 0.01, z - 0.13], [x + dx, y + dy - 0.01, z + 0.13], 0.03, 0.03, 7, mul(col, 0.9 + dy * 4)); return; }
      b.ball('flat', sh.x * 0.35, sh.y - 0.085, sh.z - 0.098, 0.08, sack, 1, 1.05, 1.2, 0.75);                          // badan karung menempel di punggung
      b.tube('flat', [sh.x * 0.5, sh.y - 0.01, sh.z - 0.08], [sh.x * 0.95, sh.y + 0.04, sh.z + 0.03], 0.032, 0.02, 6, mul(sack, 0.8));   // leher karung melewati bahu kiri
      b.ball('flat', sh.x * 0.35, sh.y - 0.1, sh.z - 0.152, 0.034, col, 1, 1.4, 1.4, 0.4);                               // tanda warna sumber daya
    }), back]);
    return kit;
  }
  // Hewan liar berkerangka (kaki empat, tulang berawalan Beast). model: nama model per varian (rusa: 0 betina, 1 jantan
  // bertanduk). laju: laju tanah rancangan klip, dipakai bila pengukuran tidak andal (angkatan kuku babi lebih kecil
  // daripada ambang pengukur). Klip: diam, jalan, lari, makan (merumput), mati (pose akhirnya = bangkai), babi: serang.
  const BEAST_HOOVES = ['BeastFrontL3', 'BeastFrontR3', 'BeastHindL3', 'BeastHindR3'];
  const BEASTS = {
    deer: { model: ['rusa', 'rusa_jantan'] },
    boar: { model: ['babi'], strike: 'serang', at: 0.28, laju: { jalan: 0.53, lari: 2.34 } },
  };
  const beastKits = {};
  function beastKit(type, variant) {
    const R = BEASTS[type], name = R && (R.model[variant] || R.model[0]);
    if (!name) return null;
    if (name in beastKits) return beastKits[name];
    const m = BF.assets.model[name], k = m && m.klip;
    if (!k || !k.diam || !k.jalan || !k.lari || !k.makan || !k.mati) return (beastKits[name] = null);
    const ball = new THREE.Sphere(new THREE.Vector3(0, 0.35, 0.05), 1);
    for (const g of m.lod) g.boundingSphere = ball;
    const gerak = {};
    for (const n of ['jalan', 'lari']) gerak[n] = { clip: k[n], laju: (R.laju && R.laju[n]) || gaitSpeed(m, k[n], BEAST_HOOVES) };
    const strike = R.strike && k[R.strike] ? R.strike : null;
    return (beastKits[name] = { type, beast: true, m, K: m.kerangka, gerak, strike, strikeAt: strike ? Math.max(0, R.at - 0.12) : 0, tint: {}, extras: [] });
  }
  models.rigged = (type, variant) => !!(BEASTS[type] ? beastKit(type, variant || 0) : rigKit(type));

  // Tiap unit punya tulang dan AnimationMixer sendiri; geometri, bahan, dan klip dipakai bersama. Bahan bertanda `tim`
  // (tunik, kain) memakai salinan per pemain yang dikalikan warna tim.
  function riggedUnit(kit, owner) {
    const m = kit.m, group = new THREE.Group(), ud = group.userData;
    const tint = kit.tint[owner] || (kit.tint[owner] = m.bahan.map(b => { if (!b.userData.tim) return b; const c = b.clone(); c.color = C(BF.SLOTS[owner].color); return c; }));
    const { akar, skeleton } = BF.assets.kerangkaBaru(m), mesh = new THREE.SkinnedMesh(m.lod[0], tint);
    mesh.castShadow = true;
    for (const b of akar) mesh.add(b);
    mesh.bind(skeleton, new THREE.Matrix4());
    group.add(mesh);
    ud.type = kit.type;
    ud.kit = kit;
    ud.skeleton = skeleton;
    ud.mixer = new THREE.AnimationMixer(mesh);
    ud.act = {};
    for (const n in m.klip) ud.act[n] = ud.mixer.clipAction(m.klip[n]);
    for (const n in kit.gerak) ud.act[n] = ud.mixer.clipAction(kit.gerak[n].clip);
    for (const n of [kit.strike, 'mati']) if (n) { ud.act[n].setLoop(THREE.LoopOnce, 1); ud.act[n].clampWhenFinished = true; }
    ud.cur = null; ud.once = null; ud.lastT = null; ud.atk0 = 0;
    ud.extras = {};
    for (const [name, geo, bone] of kit.extras) {
      const o = ud.extras[name] = new THREE.Mesh(geo, BF.tex.mat.unit);
      o.matrixAutoUpdate = false;
      o.matrix.copy(kit.K.ibm[bone]);
      o.castShadow = true;
      o.visible = false;
      skeleton.bones[bone].add(o);
    }
    return group;
  }

  // Animasi unit berkerangka: pilih klip dari keadaan unit, bersilang-pudar saat berganti, lalu majukan mixer sebesar
  // selisih waktu simulasi sejak panggilan terakhir (jadi ikut berhenti saat jeda dan ikut cepat pada kecepatan 2×).
  function poseRigged(ud, st, a) {
    // st.skip: detik yang dilompati pada panggilan pertama (jasad yang baru terlihat lama setelah unitnya tewas)
    const A = ud.act, kit = ud.kit, dt = ud.lastT === null ? st.skip || 0 : Math.min(0.1, Math.max(0, st.t - ud.lastT));
    ud.lastT = st.t;
    const hit = !!kit.strike && !st.dead && !st.working && a > ud.atk0 + 0.05;        // serangan baru dipicu (atk melonjak)
    ud.atk0 = a;
    if (hit) ud.once = kit.strike;
    let want = st.dead ? 'mati' : st.working && A.kerja ? 'kerja' : st.moving ? (st.carry > 0 && A.lari_bawa ? 'lari_bawa' : 'lari') : 'diam';
    if (ud.once) {
      if (want !== 'diam' || (!hit && ud.cur === ud.once && !A[ud.once].isRunning())) ud.once = null;      // selesai, atau unit disuruh hal lain
      else want = ud.once;
    }
    if (want !== ud.cur || (hit && want === kit.strike)) {
      const next = A[want], prev = ud.cur && A[ud.cur];
      next.reset();
      next.time = want === kit.strike ? kit.strikeAt : want === 'diam' || want === 'kerja' ? (st.id * 0.37) % next.getClip().duration : 0;      // diam/kerja tidak serempak antar-unit
      next.play();
      if (prev && prev !== next) prev.crossFadeTo(next, 0.15, false);
      ud.cur = want;
    }
    // kecepatan putar klip lari = kecepatan unit ÷ laju tanah klip (dibatasi agar tidak terlalu lambat/tergesa)
    for (const n in kit.gerak) A[n].timeScale = BF.clamp((st.speed || 2.4) / kit.gerak[n].laju, 0.6, 2.6);
    ud.mixer.update(dt);
    if (ud.extras.tool) ud.extras.tool.visible = !!st.working;
    for (const res of BF.RES) if (ud.extras['pack_' + res]) ud.extras['pack_' + res].visible = !st.dead && !st.working && st.carry > 0 && st.carryType === res;
  }

  // Hewan berkerangka. st: {t, id, moving, run, graze, carcass, atk (1 saat menyeruduk → 0)}. Hewan yang sudah menjadi
  // bangkai saat pertama kali terlihat langsung berada di pose akhir klip mati.
  function poseBeast(ud, st) {
    const A = ud.act, kit = ud.kit, P = BF.ANIMALS[kit.type], first = ud.lastT === null, dt = first ? st.skip || 0 : Math.min(0.1, Math.max(0, st.t - ud.lastT));
    ud.lastT = st.t;
    const a = st.atk || 0, hit = !!kit.strike && !st.carcass && a > ud.atk0 + 0.05;
    ud.atk0 = a;
    if (hit) ud.once = kit.strike;
    let want = st.carcass ? 'mati' : st.moving ? (st.run ? 'lari' : 'jalan') : st.graze ? 'makan' : 'diam';
    if (ud.once) {
      if (st.carcass || (!hit && ud.cur === ud.once && !A[ud.once].isRunning())) ud.once = null;
      else want = ud.once;
    }
    if (want !== ud.cur || (hit && want === kit.strike)) {
      const next = A[want], prev = ud.cur && A[ud.cur], len = next.getClip().duration;
      next.reset();
      next.time = want === kit.strike ? kit.strikeAt : want === 'mati' ? (first ? len - 0.001 : 0) : want === 'diam' || want === 'makan' ? (st.id * 0.37) % len : 0;
      next.play();
      if (prev && prev !== next) prev.crossFadeTo(next, 0.15, false);
      ud.cur = want;
    }
    A.jalan.timeScale = BF.clamp(P.speed / kit.gerak.jalan.laju, 0.5, 2.6);
    A.lari.timeScale = BF.clamp(P.run / kit.gerak.lari.laju, 0.5, 2.6);
    ud.mixer.update(dt);
  }

  // Tingkat rinci model berkerangka: 0 = penuh, 1 = ±45% segitiga, 2 = ±20% (kamera jauh). Kerangka, bahan, dan klip sama
  // untuk semua tingkat; yang diganti hanya geometri SkinnedMesh-nya. Unit buatan kode tidak terpengaruh.
  models.setLod = function (group, n) {
    const ud = group.userData;
    if (!ud.mixer) return;
    const lods = ud.kit.m.lod, g = lods[Math.min(n, lods.length - 1)], mesh = group.children[0];
    if (mesh.geometry !== g) mesh.geometry = g;
  };

  // Objek unit: Group berisi SkinnedMesh + kerangkanya sendiri (geometri & material dipakai bersama antar-unit sejenis).
  // Untuk hewan liar, owner = varian.
  models.unit = function (type, owner) {
    const kit = BEASTS[type] ? beastKit(type, owner) : rigKit(type);
    if (kit) return riggedUnit(kit, owner);
    const d = unitDef(type, owner), group = new THREE.Group(), mat = BF.tex.mat.unit, ud = group.userData;
    ud.type = type;
    if (d.parts) {
      ud.parts = {};
      for (const name in d.parts) { const m = d.parts[name].obj.clone(); m.position.fromArray(d.parts[name].at); group.add(m); ud.parts[name] = m; }
      ud.parts.batu = ud.parts.arm.getObjectByName('batu');
      ud.wheel = 0;
      return group;
    }
    const bones = d.bones.map(() => new THREE.Bone()), B = ud.B = {};
    d.bones.forEach((b, i) => {
      const p = b.parent < 0 ? [0, 0, 0] : d.bones[b.parent].pos;
      bones[i].position.set(b.pos[0] - p[0], b.pos[1] - p[1], b.pos[2] - p[2]);
      if (b.parent >= 0) bones[b.parent].add(bones[i]);
      B[b.name] = bones[i];
    });
    const mesh = new THREE.SkinnedMesh(d.geo, mat);
    mesh.castShadow = true;
    mesh.add(bones[0]);
    mesh.bind(ud.skeleton = new THREE.Skeleton(bones));
    group.add(mesh);
    ud.extras = {};
    for (const name in d.extras) {                                   // geometri dalam ruang model → digeser balik ke posisi tulangnya
      const e = d.extras[name], m = new THREE.Mesh(e.geo, mat), p = d.bones[e.bone].pos;
      m.position.set(-p[0], -p[1], -p[2]);
      m.castShadow = true;
      m.visible = false;
      bones[e.bone].add(m);
      ud.extras[name] = m;
    }
    return group;
  };

  // Lepaskan sumber daya GPU milik satu unit (tekstur tulang kerangkanya).
  models.disposeUnit = function (group) {
    const ud = group.userData;
    if (ud.mixer) { ud.mixer.stopAllAction(); ud.mixer.uncacheRoot(ud.mixer.getRoot()); }
    if (ud.skeleton) ud.skeleton.dispose();
  };

  // ---- animasi. Rotasi X positif mengayun anggota badan ke belakang; negatif ke depan.
  function poseHuman(B, st, type, a, mounted) {
    const t = st.t, id = st.id, ph = t * 9.5 + id * 1.7, s = Math.sin(ph), c = Math.cos(ph), mv = st.moving && !mounted ? 1 : 0, idle = 1 - mv;
    const breath = Math.sin(t * 1.7 + id), sway = Math.sin(t * 0.8 + id * 2.3);
    // bawaan: lengan berayun berlawanan dengan kaki, siku sedikit menekuk
    let aL = mv * 0.5 * s, aR = -mv * 0.5 * s, fL = -0.22 - mv * 0.35 * Math.max(0, -s), fR = -0.22 - mv * 0.35 * Math.max(0, s);
    let zL = -0.07, zR = 0.07, yL = 0, wL = 0, wR = 0, lean = mv * 0.07 + breath * 0.012, twist = -mv * 0.13 * s, headY = 0, crouch = 0;
    let tL = -mv * 0.55 * s, tR = mv * 0.55 * s, kL = 0.05 + mv * Math.max(0, c), kR = 0.05 + mv * Math.max(0, -c);
    if (type === 'worker') {
      if (st.working) {                                               // mengayun alat dengan dua tangan
        const w = Math.sin(t * 8 + id);
        aR = -1.25 + 0.75 * w; aL = -1.05 + 0.6 * w; fR = fL = -0.55 - 0.25 * w; zL = 0.22; lean = 0.2 + 0.14 * w; crouch = 0.22;
      } else if (st.carry > 0) { aL = -0.25 + aL * 0.4; fL = -1.7; zL = 0.12; lean += 0.06; }
    } else if (type === 'spear' || type === 'guard' || type === 'rider') {
      const k = a * a * (3 - 2 * a);                                  // tusukan: tombak turun dari tegak ke mendatar sambil lengan menjulur
      aR = lerp(-0.15 + aR * 0.3, -1.25, k); fR = lerp(-0.5, -0.15, k); wR = lerp(-(aR + fR), Math.PI / 2 - (aR + fR), k);
      twist += -0.3 * k; lean += 0.14 * k;
      if (!mounted) { tL = lerp(tL, -0.45, k); kL = lerp(kL, 0.5, k); tR = lerp(tR, 0.3, k); }
      if (type === 'rider') { aL = -0.55; fL = -0.95; } else { aL = -0.2 + aL * 0.2; fL = -1.45; yL = 1.05; zL = -0.12; }      // kekang / perisai melintang di depan badan
    } else if (type === 'sword') {
      aR = -0.2 + aR * 0.3 - 2.3 * a; fR = -0.7 + 0.45 * a; twist += 0.35 * a - 0.12; lean += 0.1 * (1 - a) * (a > 0 ? 1 : 0);
      aL = -0.2 + aL * 0.2; fL = -1.45; yL = 1.05; zL = -0.12;
    } else if (type === 'berserk') {
      const b = Math.max(0, a - 0.35) / 0.65;
      aR = -0.35 + aR * 0.5 - 2.1 * a; aL = -0.35 + aL * 0.5 - 2.1 * b; fR = fL = -0.65; twist += 0.3 * (a - b); lean += 0.08;
    } else if (type === 'archer' || type === 'ranger' || type === 'harcher') {
      const k = Math.min(1, a * 1.7), draw = Math.min(1, a * 3);      // membidik: tangan kiri lurus ke depan, kanan menarik tali ke pipi
      aL = lerp(-0.3 + aL * 0.3, -1.5, k); fL = lerp(-0.55, 0, k); wL = -(aL + fL);
      aR = lerp(aR, -1.3, k); fR = lerp(fR, -0.6 - 1.4 * draw, k);
      twist += 0.55 * k; headY = -0.5 * k;
    }
    if (B.root && !mounted) B.root.position.y = -mv * 0.44 * (1 - Math.cos(0.55 * s)) * 0.8 - crouch * 0.07;
    B.pelvis.rotation.z = idle * 0.03 * sway;
    B.spine.rotation.set(lean, twist, -idle * 0.03 * sway);
    B.head.rotation.set(-lean * 0.6, headY - twist * 0.6, 0);
    B.armL.rotation.set(aL, yL, zL); B.armR.rotation.set(aR, 0, zR);
    B.foreL.rotation.x = fL; B.foreR.rotation.x = fR;
    B.wpnL.rotation.x = wL; B.wpnR.rotation.x = wR;
    if (mounted) return;
    B.thighL.rotation.x = tL - crouch; B.thighR.rotation.x = tR - crouch;
    B.shinL.rotation.x = kL + crouch * 1.8; B.shinR.rotation.x = kR + crouch * 1.8;
  }

  function poseHorse(B, st) {
    const t = st.t, id = st.id, mv = st.moving ? 1 : 0, ph = t * 12 + id * 1.3;
    const leg = (U, L, off, flex) => { U.rotation.x = -mv * 0.5 * Math.sin(ph + off); L.rotation.x = mv * flex * Math.max(0, Math.cos(ph + off)); };
    leg(B.fUL, B.fLL, 0, 1.0); leg(B.hUR, B.hLR, 0.4, 0.6); leg(B.fUR, B.fLR, Math.PI, 1.0); leg(B.hUL, B.hLL, Math.PI + 0.4, 0.6);   // derap: pasangan diagonal seirama
    const rest = 1 - mv, side = id % 2 ? 1 : -1, [rU, rL] = side > 0 ? [B.hUR, B.hLR] : [B.hUL, B.hLL];
    rU.rotation.x += rest * 0.06; rL.rotation.x -= rest * 0.34;                                     // diam: satu kaki belakang diistirahatkan, bertumpu di ujung kuku
    B.body.position.y = 0.66 + mv * 0.02 * Math.sin(ph * 2) - rest * 0.006;
    B.body.rotation.x = mv * 0.03 * Math.sin(ph * 2 + 0.6);
    B.body.rotation.z = rest * side * 0.03;                                                          // pinggul turun di sisi kaki yang beristirahat
    const nod = mv * 0.1 * Math.sin(ph * 2 + 1.2) + (1 - mv) * 0.05 * Math.sin(t * 0.6 + id);
    B.neck.rotation.x = nod;
    B.hhead.rotation.x = -nod * 0.6 + (1 - mv) * 0.06 * Math.sin(t * 0.9 + id * 2);
    B.tail.rotation.set(0.05 + mv * 0.4 + 0.08 * Math.sin(t * 2.3 + id), 0, 0.12 * Math.sin(t * 1.7 + id * 3));
  }

  // Hewan: derap/jalan seperti kuda (kaki diagonal seirama), kepala merunduk saat merumput, rebah miring bila sudah mati.
  // st.run = lari/menyeruduk, st.graze = sedang merumput, st.carcass = bangkai.
  function poseAnimal(B, st, type) {
    const P = ANIMAL_P[type], t = st.t, id = st.id, mv = st.moving ? 1 : 0, run = st.run ? 1 : 0, ph = t * (run ? 14 : 7) + id * 1.3, amp = run ? 0.6 : 0.32;
    const leg = (U, L, off, flex) => { U.rotation.x = -mv * amp * Math.sin(ph + off); L.rotation.x = mv * flex * Math.max(0, Math.cos(ph + off)); };
    leg(B.fUL, B.fLL, 0, 0.9); leg(B.hUR, B.hLR, 0.4, 0.6); leg(B.fUR, B.fLR, Math.PI, 0.9); leg(B.hUL, B.hLL, Math.PI + 0.4, 0.6);
    B.root.rotation.z = st.carcass ? Math.PI / 2 : 0;
    B.root.position.set(0, st.carcass ? P.lie : 0, 0);
    if (st.carcass) {                                   // rebah miring, kaki terlipat, leher terkulai
      for (const k of ['UL', 'UR']) { B['f' + k].rotation.x = -0.5; B['h' + k].rotation.x = 0.45; }
      for (const k of ['LL', 'LR']) { B['f' + k].rotation.x = 1.1; B['h' + k].rotation.x = -0.9; }
      B.neck.rotation.x = 0.5; B.hhead.rotation.x = 0.3; B.tail.rotation.set(0, 0, 0);
      return;
    }
    B.body.position.y = P.by + mv * (run ? 0.025 : 0.01) * Math.sin(ph * 2);
    const graze = st.graze ? Math.max(0, Math.sin(t * 0.5 + id)) : 0;                                 // menunduk merumput lalu sesekali mendongak
    B.neck.rotation.x = mv * 0.06 * Math.sin(ph * 2) + (type === 'deer' ? 1.15 : 0.45) * Math.min(1, graze * 1.6) + (st.charge ? 0.25 : 0);
    B.hhead.rotation.x = 0.05 * Math.sin(t * 1.3 + id);
    B.tail.rotation.set(0.1 + run * 0.5 + 0.12 * Math.sin(t * 3.1 + id), 0, 0.2 * Math.sin(t * 2.2 + id * 3));
  }

  // Pose dari state simulasi. st: {t (detik), id, moving, working, atk (1 saat memukul → 0), carryType, carry}
  models.pose = function (group, st) {
    const ud = group.userData, type = ud.type, a = Math.min(1, Math.max(0, st.atk));
    if (ud.mixer) { if (ud.kit.beast) poseBeast(ud, st); else poseRigged(ud, st, a); return; }
    if (ud.parts) {                                                   // pelontar: lengan menyentak ke palang lalu ditarik kembali oleh kerekan
      const P = ud.parts;
      P.arm.rotation.x = ARM_REST + ARM_FIRE * a * a * (3 - 2 * a);
      P.batu.visible = a < 0.02;
      P.winch.rotation.x = -a * 7;
      if (st.moving) ud.wheel = st.t * 8;                             // ±1,4 tile/detik pada roda berjari-jari 0,16
      P.axleF.rotation.x = P.axleR.rotation.x = ud.wheel;
      return;
    }
    if (BF.ANIMALS[type]) { poseAnimal(ud.B, st, type); return; }
    const mounted = BF.UNITS[type].cls === 'cavalry';
    if (mounted) poseHorse(ud.B, st);
    poseHuman(ud.B, st, type, a, mounted);
    if (type === 'worker') {
      ud.extras.tool.visible = !!st.working;
      for (const res of BF.RES) ud.extras['pack_' + res].visible = st.carry > 0 && st.carryType === res;
    }
  };

  // ---------------------------------------------------------------- kecil-kecil

  models.arrow = function () {
    const b = new MB();
    b.box('flat', -0.008, -0.008, -0.2, 0.008, 0.008, 0.2, C('#a8835a'), 1, 1);
    for (const k of [-1, 1]) b.box('flat', k * 0.012 - 0.002, -0.012, -0.2, k * 0.012 + 0.002, 0.012, -0.13, C('#ece6da'), 1, 1);   // bulu ekor panah
    b.geom('flat', new THREE.ConeGeometry(0.02, 0.07, 4), new THREE.Matrix4().makeTranslation(0, 0, 0.22).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), STEEL);
    return b.geometry('flat');
  };
  // Jasad: sosok unit yang sama, direbahkan (kavaleri: kuda rebah menyamping dan penunggangnya di sebelahnya).
  const ccache = {};
  models.corpse = function (owner, big) {
    const key = owner + ':' + (big ? 1 : 0);
    if (ccache[key]) return ccache[key];
    const team = C(BF.SLOTS[owner].color), man = new Rig();
    man.bone('root', null, 0, 0, 0); humanBones(man, 'root', 0, 0, true);
    humanBody(man, { top: team, pants: C('#5a4630'), hair: C('#2a1b10'), sleeve: 'long' }, 0, 0, true);
    const g = man.mb.geometry('flat').applyMatrix4(mT(big ? -0.3 : 0, 0.07, 0.42).multiply(mRx(-Math.PI / 2)));       // telentang, kepala ke −Z
    if (!big) return (ccache[key] = g);
    const hr = new Rig();
    horse(hr, C('#6f4424'), team, null);
    const h = hr.mb.geometry('flat').applyMatrix4(mT(0.75, 0.115, 0).multiply(mRz(Math.PI / 2)));                      // rebah pada sisi kirinya
    const out = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv', 'color', 'pbr']) {
      const a = g.attributes[name], b = h.attributes[name], arr = new Float32Array(a.array.length + b.array.length);
      arr.set(a.array); arr.set(b.array, a.array.length);
      out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
    }
    g.dispose(); h.dispose();
    out.computeBoundingSphere();
    return (ccache[key] = out);
  };

  // Serakan puing (prototipe per ukuran, di-cache; pakai .clone()): bongkah batu bertekstur foto dan balok kayu hangus
  // yang tergeletak miring, berpusat di (0, 0).
  const rcache = {};
  models.rubble = function (size) {
    if (rcache[size]) return rcache[size];
    const b = new MB(), rnd = BF.makeRng(size * 13 + 1), R = size * 0.42;
    for (let i = 0; i < 8 + size * 7; i++) {
      const r = 0.05 + rnd() * 0.1, a = rnd() * TAU, d = Math.sqrt(rnd()) * R, k = 0.55 + rnd() * 0.35;
      b.geom('stone', new THREE.DodecahedronGeometry(r, 0), mT(Math.cos(a) * d, r * 0.35, Math.sin(a) * d).multiply(new THREE.Matrix4().makeRotationY(a * 3)).multiply(mS(1.3, 0.7, 1)), new THREE.Color(k, k * 0.96, k * 0.9), [0.55, 1]);
    }
    for (let i = 0; i < size * 3; i++) {
      const a = rnd() * TAU, d = rnd() * R * 0.8, x = Math.cos(a) * d, z = Math.sin(a) * d, l = 0.3 + rnd() * 0.45, h = rnd() < 0.4 ? 0.12 + rnd() * 0.15 : 0.02, dir = rnd() * TAU;
      b.tube('planks', [x, 0.025, z], [x + Math.cos(dir) * l, h, z + Math.sin(dir) * l], 0.03, 0.026, 4, rnd() < 0.6 ? C('#3a2f28') : C('#6b5442'));
    }
    const g = b.build(k => BF.tex.mat[k]);
    g.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
    return (rcache[size] = g);
  };
  models.flag = function (owner) {
    const b = new MB(), c = C(BF.SLOTS[owner].color);
    const pts = [[0, 0, 0], [0.44, -0.03, 0], [0.44, -0.27, 0], [0, -0.3, 0]];
    b.poly('flat', pts, c, [1.1, 0.85, 0.85, 1.1]);
    b.poly('flat', pts, mul(c, 0.8), null, true);
    return b.geometry('flat');
  };
})();
