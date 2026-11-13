'use strict';
// Renderer 3D (three.js, material PBR + pantulan langit HDRI): menyinkronkan state simulasi ke scene — medan, air, kabut perang,
// alam dari model pindai (instanced, per petak, ber-LOD), bangunan, unit beranimasi, proyektil, efek — plus overlay 2D
// (bar HP), minimap, dan ikon.
(function () {
  const N = BF.MAP_SIZE, idx = BF.idx, view = BF.view, models = BF.models, tex = BF.tex;
  const U = BF.UNITS, B = BF.BUILDINGS, TAU = Math.PI * 2;
  const gfx = BF.gfx = {};
  let renderer = null, scene = null, sun = null, fill = null, M = null, W = null, lastNow = 0;
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpC = new THREE.Color();
  const UP = new THREE.Vector3(0, 1, 0), SUN_OFFSET = new THREE.Vector3();
  const EXPOSURE = 0.8;
  const FILL_C = 10 * Math.cos(0.44), FILL_S = 10 * Math.sin(0.44);          // cahaya isian datang dari arah kamera, ±25° di atas cakrawala
  const CH = 8;                             // alam dikelompokkan per petak CH×CH tile agar yang di luar layar tidak digambar
  const LOD_ZOOM = [13, 25];                // zoom ≤ 13: model paling rinci; ≤ 25: sedang; lebih jauh: paling ringan (rumput hias disembunyikan)

  // Bayangan lembut 4 cuplikan (bilinear) menggantikan 16 cuplikan bawaan PCFSoftShadowMap: di layar beresolusi tinggi
  // penyaringan bayangan per piksel adalah beban terbesar. Bila pola tidak cocok (versi three.js lain), bawaan tetap dipakai.
  THREE.ShaderChunk.shadowmap_pars_fragment = THREE.ShaderChunk.shadowmap_pars_fragment.replace(/(uv -= f \* texelSize;)[\s\S]*?\* \( 1\.0 \/ 9\.0 \);/,
    '$1\nshadow = mix( mix( texture2DCompare( shadowMap, uv, shadowCoord.z ), texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ), f.x ), '
    + 'mix( texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ), texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ), f.x ), f.y );');

  function output(r) {
    r.outputEncoding = THREE.sRGBEncoding;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = EXPOSURE;
  }

  const hash = (x, y) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };

  // ---------------------------------------------------------------- inisialisasi

  gfx.init = function (canvas) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    output(renderer);
    renderer.shadowMap.enabled = true;
    renderer.localClippingEnabled = true;                // bangunan yang sedang dibangun dipotong bidang datar
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    // cahaya isian: langit dari atas, pantulan tanah dari bawah; matahari sebagai lampu arah berbayang (searah matahari di HDRI)
    scene.add(new THREE.HemisphereLight(0xbccbe7, 0x8b8d73, 0.85));
    // pantulan lingkungan dari arah kamera (tanpa bayangan): sisi bangunan yang menghadap pemain tidak tenggelam gelap
    // walau membelakangi matahari; arahnya mengikuti putaran kamera, arah matahari & bayangan tetap
    fill = new THREE.DirectionalLight(0xe4e8ee, 0.75);
    SUN_OFFSET.fromArray(BF.assets.matahari);
    sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 80;
    scene.add(sun, sun.target);
    fill.target = sun.target;
    scene.add(fill);
    M = tex.build();
    // pantulan langit HDRI hanya untuk permukaan mengilap (air, emas, baja pada unit); di permukaan kasar nyaris tak terlihat tetapi mahal
    M.water.envMap = M.unit.envMap = BF.assets.bahan.emas.envMap = BF.assets.langit;
    gfx.spriteTex = { fire: fxTex('fire'), smoke: fxTex('smoke'), dust: fxTex('dust'), spark: fxTex('spark'), ember: fxTex('ember') };
    M.chip = [new THREE.MeshStandardMaterial({ color: 0x8d867a, roughness: 0.95, flatShading: true }), new THREE.MeshStandardMaterial({ color: 0x5e4733, roughness: 0.9 })];   // serpihan batu, kayu
    M.rock = new THREE.MeshStandardMaterial({ color: 0x8b8579, roughness: 0.92, flatShading: true });
    gfx.chipGeo = [new THREE.DodecahedronGeometry(0.05, 0), new THREE.BoxGeometry(0.16, 0.025, 0.035)];
    M.skirt = new THREE.MeshStandardMaterial({ map: skirtTex(), transparent: true, depthWrite: false, color: 0x8a6d47, roughness: 1, metalness: 0 });
    // penanda antarmuka: warna apa adanya (tanpa tone mapping)
    M.ring = [0xffffff, 0xfca5a5, 0xfde68a].map(c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }));   // milik sendiri, lawan, hewan liar
    M.line = [0xffffff, 0xfca5a5].map(c => new THREE.LineBasicMaterial({ color: c, toneMapped: false }));
    M.ghost = [0x4ade80, 0xf87171].map(c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }));
    M.flagSide = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
    gfx.ringGeo = new THREE.RingGeometry(0.86, 1, 28).rotateX(-Math.PI / 2);
    gfx.arrowGeo = models.arrow();
    gfx.rockGeo = new THREE.IcosahedronGeometry(0.11, 0);
  };

  gfx.resize = function (w, h, dpr) {
    if (!renderer) return;
    renderer.setPixelRatio(Math.min(dpr, 2));
    renderer.setSize(w, h, false);
    view.resize(w, h);
  };

  // Tekstur efek prosedural (128 px): kepulan asap/debu bergumpal dari derau fbm dengan sisi atas lebih terang, lidah api
  // meruncing ke atas dengan inti putih-kuning ke tepi merah, bara, dan kilat benturan.
  function fxTex(kind) {
    const S = 128, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data, seed = { smoke: 3, dust: 9, fire: 17, spark: 23, ember: 29 }[kind];
    const vn = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const h = (a, b) => hash(a + seed * 97, b - seed * 31) / 4294967296;
      return (h(xi, yi) * (1 - sx) + h(xi + 1, yi) * sx) * (1 - sy) + (h(xi, yi + 1) * (1 - sx) + h(xi + 1, yi + 1) * sx) * sy;
    };
    const fbm = (x, y) => (vn(x, y) * 0.5 + vn(x * 2, y * 2) * 0.25 + vn(x * 4, y * 4) * 0.125 + vn(x * 8, y * 8) * 0.0625) / 0.9375;
    const sm = (a, b, v) => { const q = Math.min(1, Math.max(0, (v - a) / (b - a))); return q * q * (3 - 2 * q); };
    const ramp = [[0, [120, 20, 5]], [0.35, [230, 80, 15]], [0.6, [255, 150, 35]], [0.82, [255, 215, 110]], [1, [255, 248, 225]]];
    for (let py = 0; py < S; py++)
      for (let px = 0; px < S; px++) {
        const u = (px + 0.5) / S * 2 - 1, v = (py + 0.5) / S * 2 - 1, r = Math.hypot(u, v), j = (py * S + px) * 4;
        let R = 255, G = 255, Bc = 255, A = 0;
        if (kind === 'smoke' || kind === 'dust') {
          const n = fbm(u * 2.4 + 5, v * 2.4 + 5);
          A = sm(0.08, 0.62, (1 - r * 1.12) * 1.5 + (n - 0.5) * 1.5);
          const light = 0.78 + (-u * 0.25 - v * 0.45) * 0.5 + (n - 0.5) * 0.45, base = kind === 'smoke' ? [118, 113, 107] : [200, 182, 150];
          [R, G, Bc] = base.map(q => Math.min(255, q * light));
        } else if (kind === 'fire') {
          const t = (1 - v) / 2, n = fbm(u * 2.6 + 2, v * 2 + 7), uu = u + (n - 0.5) * 0.8 * t, w = 0.86 * Math.pow(1 - t, 0.9) * Math.min(1, 0.5 + t * 3);
          let inten = Math.max(0, 1 - Math.abs(uu) / Math.max(0.01, w)) * sm(0, 0.12, 1 - t);
          inten = Math.min(1, Math.max(0, inten * 1.35 + (n - 0.5) * 0.7 - t * 0.35));
          let k = 0;
          while (k < ramp.length - 2 && inten > ramp[k + 1][0]) k++;
          const a = ramp[k], b = ramp[k + 1], q = (inten - a[0]) / (b[0] - a[0]);
          [R, G, Bc] = a[1].map((x, i) => x + (b[1][i] - x) * q);
          A = sm(0.04, 0.45, inten);
        } else if (kind === 'ember') {
          A = Math.exp(-r * r * 22); R = 255; G = 170 + 80 * A; Bc = 60 + 120 * A;
        } else {                                        // spark: kilat bintang
          A = Math.min(1, Math.exp(-r * r * 30) + (Math.exp(-Math.abs(u) * 28) * Math.exp(-Math.abs(v) * 3.5) + Math.exp(-Math.abs(v) * 28) * Math.exp(-Math.abs(u) * 3.5)) * 0.7);
          G = 238; Bc = 190;
        }
        d[j] = R; d[j + 1] = G; d[j + 2] = Bc; d[j + 3] = A * 255;
      }
    g.putImageData(img, 0, 0);
    const tx = new THREE.CanvasTexture(c);
    tx.encoding = THREE.sRGBEncoding;
    return tx;
  }

  function glowTex(inner, outer) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, 'rgba(' + outer + ',1)');
    gr.addColorStop(0.4, 'rgba(' + inner + ',.75)');
    gr.addColorStop(1, 'rgba(' + inner + ',0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  function skirtTex() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 20, 64, 64, 63);
    gr.addColorStop(0, 'rgba(255,255,255,.85)');
    gr.addColorStop(0.62, 'rgba(255,255,255,.6)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  // ---------------------------------------------------------------- dunia per-permainan

  function disposeWorld() {
    if (!W) return;
    scene.remove(W.root);
    for (const o of W.units.values()) models.disposeUnit(o.group);
    for (const o of W.animals.values()) models.disposeUnit(o.group);
    for (const o of W.bld.values()) endBuild(o);
    for (const m of W.fxMap.values()) dropFx(m);
    W.root.traverse(o => {
      if (o.geometry && o.userData.own) o.geometry.dispose();
      if (o.userData.lods) { for (const g of o.userData.lods) g.dispose(); o.dispose(); }
      if (o.material && o.userData.ownMat) { for (const t of [o.material.map, o.material.userData.ctrl, o.material.userData.wear]) if (t) t.dispose(); o.material.dispose(); }
    });
    W = null;
  }

  // Statistik render frame terakhir (untuk mengukur beban).
  gfx.info = () => ({ drawCalls: renderer.info.render.calls, segitiga: renderer.info.render.triangles, geometri: renderer.info.memory.geometries, tekstur: renderer.info.memory.textures });

  // Objek tampilan sebuah unit (Group three.js) — untuk tes dan alat periksa.
  gfx.unitGroup = id => { const o = W && W.units.get(id); return o ? o.group : null; };

  // Buang dunia yang sedang tampil; frame berikutnya membangunnya ulang dari state.
  gfx.reset = disposeWorld;

  function buildWorld(s) {
    disposeWorld();
    const map = s.map, root = new THREE.Group();
    W = { s, map, root, tick: -1, fogVer: -1, mapVer: -1, linkVer: -1, lod: -1, bld: new Map(), units: new Map(), animals: new Map(), fxMap: new Map(), fly: new Map(), stuck: [], pools: {}, nodes: [], inst: [], flat: new Map(), t0: performance.now() };
    scene.add(root);

    // medan: bidang berpetak — bukit dari BF.relief (verteksnya tepat di titik kisi relief) dan cekungan di bawah air
    BF.relief.build(map, s.seed);
    const geo = new THREE.PlaneGeometry(N, N, N * 2, N * 2);
    geo.rotateX(-Math.PI / 2);
    geo.translate(N / 2, 0, N / 2);
    const pos = geo.attributes.position, dip = W.dip = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const l = tex.landness(map, pos.getX(i), pos.getZ(i));
      if (l < 0.5) { const t = Math.min(1, (0.5 - l) / 0.4); dip[i] = -0.6 * t * t * (3 - 2 * t); }
    }
    geo.setAttribute('slope', new THREE.Float32BufferAttribute(new Float32Array(pos.count * 2), 2));
    W.groundGeo = geo;
    // keausan medan: R piksel per tile, nilai di kanal merah (RGBA: format yang bisa disimpan di WebGL1 maupun WebGL2);
    // baris 0 tekstur = tepi peta y = N (UV bidang medan terbalik terhadap y tile)
    const WR = 4, WN = N * WR, wearTex = new THREE.DataTexture(new Uint8Array(WN * WN * 4), WN, WN, THREE.RGBAFormat);
    wearTex.magFilter = wearTex.minFilter = THREE.LinearFilter;
    wearTex.needsUpdate = true;
    W.wear = { tex: wearTex, data: wearTex.image.data, R: WR, n: WN, dirty: false };
    const ground = new THREE.Mesh(geo, tex.ground(map, wearTex));
    ground.material.userData.wear = wearTex;
    ground.receiveShadow = ground.castShadow = true;           // bukit membayangi lerengnya sendiri
    ground.userData.own = ground.userData.ownMat = true;
    root.add(ground);
    W.ground = ground;

    const flatPlane = (y, mat) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(N, N).rotateX(-Math.PI / 2), mat); m.position.set(N / 2, y, N / 2); m.userData.own = true; root.add(m); return m; };
    W.water = flatPlane(-0.13, M.water);
    W.water.scale.set((N - 0.5) / N, 1, (N - 0.5) / N);      // sedikit lebih kecil dari medan agar tepinya tidak mengintip
    W.water.receiveShadow = true;

    // kabut perang: tekstur N×N di atas tanah, tepi lembut dari filter linear GPU
    W.fogCanvas = document.createElement('canvas');
    W.fogCanvas.width = W.fogCanvas.height = N;
    W.fogCtx = W.fogCanvas.getContext('2d');
    W.fogImg = W.fogCtx.createImageData(N, N);
    W.fogTex = new THREE.CanvasTexture(W.fogCanvas);
    W.fogTex.minFilter = W.fogTex.magFilter = THREE.LinearFilter;
    W.fogTex.generateMipmaps = false;
    const FM = 6, fogGeo = new THREE.PlaneGeometry(N + FM * 2, N + FM * 2, (N + FM * 2) * 2, (N + FM * 2) * 2).rotateX(-Math.PI / 2), fuv = fogGeo.attributes.uv;
    for (let i = 0; i < fuv.count; i++) fuv.setXY(i, (fuv.getX(i) * (N + FM * 2) - FM) / N, (fuv.getY(i) * (N + FM * 2) - FM) / N);   // di luar peta: warna tepi (clamp)
    const fogMesh = new THREE.Mesh(fogGeo, new THREE.MeshBasicMaterial({ map: W.fogTex, transparent: true, depthWrite: false }));
    fogMesh.position.set(N / 2, 0, N / 2);
    fogMesh.userData.own = fogMesh.userData.ownMat = true;
    fogMesh.renderOrder = 5;
    root.add(fogMesh);
    W.fogGeo = fogGeo; W.fogM = FM * 2;                  // titik kisi kabut (ix, iy) = titik relief (ix − FM·2, iy − FM·2)
    applyRelief(null);

    // alam (model pindai dari BF.assets): satu InstancedMesh per model per petak. o.n = jenis node yang diwakili;
    // 0 = rumput hias (tidak memblokir apa pun, disembunyikan bila tile-nya ditempati bangunan).
    const A = BF.assets.model, groups = new Map();
    const put = (name, x, y, n, dx, dz, h, sc, sy) => {
      const key = name + ':' + ((x / CH) | 0) + ':' + ((y / CH) | 0);
      let g = groups.get(key);
      if (!g) groups.set(key, g = { model: A[name], decor: n === 0, list: [] });
      g.list.push({
        i: y * N + x, n, state: -1, tint: 0.86 + (h >>> 12) % 100 / 100 * 0.28, px: x + 0.5 + dx, pz: y + 0.5 + dz,
        mat: new THREE.Matrix4().compose(tmpV.set(x + 0.5 + dx, BF.relief.at(x + 0.5 + dx, y + 0.5 + dz) - 0.03, y + 0.5 + dz), tmpQ.setFromAxisAngle(UP, (h >>> 4) % 628 / 100), tmpS.set(sc, sc * sy, sc)),
      });
    };
    const frac = (h, shift) => (h >>> shift) % 100 / 100;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * N + x, n = map.node[i], h = hash(x * 3 + 1, y * 5 + 2);
        if (n === BF.N_TREE) {
          const kind = hash(x >> 3, y >> 3) % 3, r = map.variant[i];
          put('pohon' + (r === 3 ? (kind + 1) % 3 : kind), x, y, n, (frac(h, 8) - 0.5) * 0.36, (frac(h, 16) - 0.5) * 0.36, h, 0.82 + frac(h, 0) * 0.4, 0.9 + frac(h, 20) * 0.25);
        } else if (n === BF.N_BERRY) put('semak', x, y, n, 0, 0, h, 0.95 + frac(h, 0) * 0.25, 1);
        else if (n === BF.N_GOLD) put('emas', x, y, n, 0, 0, h, 0.92 + frac(h, 0) * 0.16, 1);
        else if (n === BF.N_STONE) put('batu' + (h & 1), x, y, n, 0, 0, h, 0.92 + frac(h, 0) * 0.16, 1);
        else if (!map.terrain[i] && !map.shore[i] && h % 100 < 38)
          for (let k = 1 + h % 3; k > 0; k--) {
            const q = hash(x * 7 + k * 131, y * 11 + k * 17);
            put('rumput' + q % 3, x, y, 0, frac(q, 8) - 0.5, frac(q, 16) - 0.5, q, 0.9 + frac(q, 0) * 0.8, 1);
          }
      }
    for (const g of groups.values()) {
      // bola pembatas petak (dipakai three.js untuk culling terhadap kamera maupun kamera bayangan)
      const c = new THREE.Vector3(), top = g.model.tinggi * 1.6;
      let lo = Infinity, hi = -Infinity;
      for (const o of g.list) { c.x += o.px / g.list.length; c.z += o.pz / g.list.length; const y = o.mat.elements[13]; lo = Math.min(lo, y); hi = Math.max(hi, y); }
      let far = 0;
      for (const o of g.list) far = Math.max(far, Math.hypot(o.px - c.x, o.pz - c.z));
      c.y = (lo + hi + top) / 2;                         // + selisih tinggi tanah antar-instance dan cadangan untuk perataan bangunan
      const sphere = new THREE.Sphere(c, Math.hypot(far + g.model.radius * 1.8, (hi - lo + top) / 2 + 1));
      // tiap petak punya objek geometri sendiri (untuk bola pembatasnya) tetapi berbagi buffer vertex dengan model aslinya
      const lods = g.model.lod.map(src => { const q = new THREE.BufferGeometry(); q.attributes = src.attributes; q.index = src.index; q.groups = src.groups; q.boundingSphere = sphere; return q; });
      const mesh = new THREE.InstancedMesh(lods[0], g.model.bahan.length > 1 ? g.model.bahan : g.model.bahan[0], g.list.length);
      mesh.frustumCulled = true;                 // InstancedMesh bawaannya tanpa culling; di sini aman karena bola pembatas di atas mencakup semua instance
      mesh.castShadow = !g.decor;
      mesh.receiveShadow = true;
      mesh.userData.lods = lods;
      mesh.userData.decor = g.decor;
      g.list.forEach((o, slot) => {
        o.mesh = mesh; o.slot = slot;
        mesh.setColorAt(slot, tmpC.setScalar(1));
        W.nodes.push(o);
      });
      W.inst.push(mesh);
      root.add(mesh);
    }
    W.zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  // Terapkan kisi BF.relief ke verteks medan dan kabut (seluruhnya bila r null, atau rentang kisi r hasil perataan),
  // lalu hitung ulang normal dan kemiringan medan; tanaman/batu di rentang itu ikut dinaikkan/diturunkan.
  function applyRelief(r) {
    const H = BF.relief.grid, G = BF.relief.G, gp = W.groundGeo.attributes.position, fp = W.fogGeo.attributes.position, FG = G + W.fogM * 2, dip = W.dip;
    const x0 = r ? r.x0 : 0, x1 = r ? r.x1 : G - 1, y0 = r ? r.y0 : 0, y1 = r ? r.y1 : G - 1;
    for (let iy = y0; iy <= y1; iy++)
      for (let ix = x0; ix <= x1; ix++) {
        const i = iy * G + ix, y = H[i] + dip[i];
        gp.setY(i, y);
        fp.setY((iy + W.fogM) * FG + ix + W.fogM, Math.max(y, -0.13) + 0.04);       // di atas permukaan air bila tanahnya di dasar danau
      }
    if (!r) for (let i = 0; i < fp.count; i++) { const ix = i % FG - W.fogM, iy = ((i / FG) | 0) - W.fogM; if (ix < 0 || iy < 0 || ix >= G || iy >= G) fp.setY(i, 0.04); }
    gp.needsUpdate = fp.needsUpdate = true;
    W.groundGeo.computeVertexNormals();
    // per verteks: x = kemiringan (1 − normal.y); y = arah lereng terhadap matahari (+ menghadap, − membelakangi, 0 datar)
    const nor = W.groundGeo.attributes.normal, sl = W.groundGeo.attributes.slope, L = tmpV.copy(SUN_OFFSET).normalize();
    for (let i = 0; i < sl.count; i++) { const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i); sl.setXY(i, 1 - ny, nx * L.x + ny * L.y + nz * L.z - L.y); }
    sl.needsUpdate = true;
    W.groundGeo.computeBoundingSphere();
    if (!r) return;
    const lx = x0 / BF.relief.R, hx = x1 / BF.relief.R, ly = y0 / BF.relief.R, hy = y1 / BF.relief.R, dirty = new Set();
    for (const o of W.nodes) {
      if (o.px < lx || o.px > hx || o.pz < ly || o.pz > hy) continue;
      o.mat.elements[13] = BF.relief.at(o.px, o.pz) - 0.03;
      if (o.state > 0) { o.mesh.setMatrixAt(o.slot, o.mat); dirty.add(o.mesh); }
    }
    for (const m of dirty) m.instanceMatrix.needsUpdate = true;
  }

  // Kabut & visibilitas pohon/sumber daya (hanya diperbarui saat kabut atau peta berubah).
  function syncFogAndNodes(s) {
    const fog = s.fog, map = s.map;
    if (W.fogVer !== fog.version) {
      const d = W.fogImg.data, vis = fog.visible, exp = fog.explored;
      for (let i = 0; i < N * N; i++) d[i * 4 + 3] = vis[i] ? 0 : exp[i] ? 125 : 255;
      W.fogCtx.putImageData(W.fogImg, 0, 0);
      W.fogTex.needsUpdate = true;
    }
    if (W.fogVer === fog.version && W.mapVer === map.version) return;
    const dirty = new Set();
    for (const o of W.nodes) {
      const gone = o.n ? map.node[o.i] !== o.n : map.node[o.i] !== 0 || map.bld[o.i] !== 0;
      const st = gone || !fog.explored[o.i] ? 0 : fog.visible[o.i] ? 2 : 1;
      if (st === o.state) continue;
      o.state = st;
      o.mesh.setMatrixAt(o.slot, st ? o.mat : W.zero);
      o.mesh.setColorAt(o.slot, tmpC.setScalar(o.tint * (st === 2 ? 1 : tex.DIM)));
      dirty.add(o.mesh);
    }
    for (const m of dirty) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    W.fogVer = fog.version;
    W.mapVer = map.version;
  }

  function wallLinks(s, b) {
    let l = 0;
    const map = s.map, at = (x, y) => {
      if (!BF.inBounds(x, y)) return false;
      const o = s.byId.get(map.bld[idx(x, y)]);
      return !!o && o.owner === b.owner && !!B[o.type].barrier;
    };
    if (at(b.tx, b.ty - 1)) l |= 1;
    if (at(b.tx + 1, b.ty)) l |= 2;
    if (at(b.tx, b.ty + 1)) l |= 4;
    if (at(b.tx - 1, b.ty)) l |= 8;
    return l;
  }

  // Kolam objek yang dipakai ulang tiap frame (cincin seleksi, proyektil, sprite efek, …).
  function pool(name, make) {
    const p = W.pools[name] || (W.pools[name] = { items: [], n: 0, make });
    return p;
  }
  function take(name, make) {
    const p = pool(name, make);
    let o = p.items[p.n];
    if (!o) { o = p.make(); p.items.push(o); W.root.add(o); }
    p.n++;
    o.visible = true;
    return o;
  }
  function resetPools() {
    for (const k in W.pools) { const p = W.pools[k]; for (let i = p.n; i < p.items.length; i++) p.items[i].visible = false; p.n = 0; }
  }
  const sprite = kind => () => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: gfx.spriteTex[kind], transparent: true, depthWrite: false, blending: kind === 'fire' || kind === 'spark' || kind === 'ember' ? THREE.AdditiveBlending : THREE.NormalBlending })); sp.userData.ownMat = false; return sp; };

  // ---------------------------------------------------------------- bangunan

  function setDim(group, dim) {
    group.traverse(o => { if (o.isMesh && o.userData.base) o.material = dim ? tex.dim(o.userData.base) : o.userData.base; });
  }

  function makeBuilding(s, b, links) {
    const proto = models.building(b.type, b.owner, links, s.players[b.owner].faction), group = proto.clone();
    group.traverse(o => { if (o.isMesh) o.userData.base = o.material; });
    let base = W.flat.get(b.id);
    if (base === undefined) {                            // pertama kali tampil: ratakan tanah di bawahnya
      const r = BF.relief.flatten(b.tx, b.ty, b.size);
      W.flat.set(b.id, base = r.base);
      applyRelief(r);
    }
    group.position.set(b.tx, base - 0.02, b.ty);
    const meta = proto.userData.meta, d = B[b.type];
    if (!d.barrier && b.type !== 'farm') {
      const sk = new THREE.Mesh(new THREE.PlaneGeometry(b.size + 1.1, b.size + 1.1).rotateX(-Math.PI / 2), M.skirt);
      sk.position.set(b.size / 2, 0.018, b.size / 2);
      sk.receiveShadow = true;
      sk.userData.own = true;
      group.add(sk);
    }
    let flag = null;
    if (meta.flag) {
      flag = new THREE.Mesh(models.flagGeo[b.owner] || (models.flagGeo[b.owner] = models.flag(b.owner)), M.flagSide);
      flag.position.fromArray(meta.flag);
      flag.castShadow = true;
      group.add(flag);
    }
    W.root.add(group);
    return { group, links, dim: false, flag, meta, base, top: new THREE.Box3().setFromObject(proto).max.y, build: null, scaf: null };
  }
  models.flagGeo = {};

  // Tahap pembangunan: bangunan dipotong bidang datar yang naik sesuai kemajuan — dinding tumbuh dari fondasi, atap
  // terakhir — dan dikelilingi perancah. Tiap bangunan yang sedang dibangun memakai salinan materialnya sendiri yang
  // berbidang potong (juga untuk bayangan), dikembalikan ke material bersama begitu selesai.
  function clipMat(m, planes) {
    const ud = m.userData;
    m.userData = {};                                     // jangan ikut menyalin versi redup yang tersimpan di userData
    const c = m.clone();
    m.userData = ud;
    c.onBeforeCompile = m.onBeforeCompile;
    c.clippingPlanes = planes;
    c.clipShadows = true;
    const d = tex.dim(c);
    d.clippingPlanes = planes;
    d.clipShadows = true;
    return c;
  }
  function startBuild(o, b) {
    const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), planes = [plane], made = new Map();
    const conv = m => { if (!made.has(m)) made.set(m, clipMat(m, planes)); return made.get(m); };
    o.group.traverse(x => {
      if (!x.isMesh || !x.userData.base || x === o.flag || x.userData.own) return;
      x.userData.base0 = x.userData.base;
      x.userData.base = Array.isArray(x.userData.base) ? x.userData.base.map(conv) : conv(x.userData.base);
      x.material = o.dim ? tex.dim(x.userData.base) : x.userData.base;
    });
    if (o.meta.body) {
      o.scaf = models.scaffold(b.type, o.meta.body, b.size).clone();
      o.scaf.traverse(x => { if (x.isMesh) { x.userData.base = x.material; if (o.dim) x.material = tex.dim(x.material); } });
      o.group.add(o.scaf);
    }
    o.build = { plane, mats: [...made.values()] };
  }
  function endBuild(o) {
    if (!o.build) return;
    o.group.traverse(x => {
      if (!x.isMesh || !x.userData.base0) return;
      x.userData.base = x.userData.base0;
      delete x.userData.base0;
      x.material = o.dim ? tex.dim(x.userData.base) : x.userData.base;
    });
    for (const m of o.build.mats) { m.userData.dim.dispose(); m.dispose(); }
    if (o.scaf) { o.group.remove(o.scaf); o.scaf = null; }
    o.build = null;
  }

  function syncBuildings(s, t, me) {
    const fog = s.fog, relink = W.linkVer !== s.map.version;
    for (const b of s.buildings) {
      if (b.dead) continue;
      let o = W.bld.get(b.id);
      if (!BF.buildingSeen(s, b)) { if (o) o.group.visible = false; continue; }
      const links = B[b.type].barrier ? (o && !relink ? o.links : wallLinks(s, b)) : 0;
      if (o && o.links !== links) { endBuild(o); W.root.remove(o.group); o = null; }
      if (!o) { o = makeBuilding(s, b, links); W.bld.set(b.id, o); }
      o.group.visible = true;
      const dim = b.owner !== me && !fog.visible[idx(b.tx + (b.size >> 1), b.ty + (b.size >> 1))];
      if (dim !== o.dim) { setDim(o.group, dim); o.dim = dim; }
      if (!b.built) {
        if (!o.build) startBuild(o, b);
        o.build.plane.constant = o.base + o.top * (0.03 + 0.97 * b.progress);
      } else if (o.build) endBuild(o);
      if (o.flag) { o.flag.visible = b.built && !dim; o.flag.rotation.y = Math.sin(t * 2.2 + b.id) * 0.35 - 0.6; }
      if (!b.built || dim) continue;
      const cx = b.tx + b.size / 2, cz = b.ty + b.size / 2, hgt = view.BUILD_H[b.type], by = o.base;
      if (o.meta.smoke) puffs(b.tx + o.meta.smoke[0], by + o.meta.smoke[1], b.ty + o.meta.smoke[2], t, b.id, 'smoke', 0.28, 0.45, 4, 1.8, 0.32, 0.95);
      const frac = b.hp / BF.bldDef(s, b).hp;
      if (frac < 0.5 && !B[b.type].barrier) {                                 // terbakar: kolom asap gelap, lidah api, bara beterbangan
        const heavy = frac < 0.25;
        puffs(cx, by + hgt * 0.72, cz, t, b.id + 3, 'smoke', 0.62, 0.85, heavy ? 7 : 5, 2.8, 0.28, 0.42);
        flames(cx + 0.15, by + Math.min(hgt * 0.72, 2.4), cz + 0.1, t, b.id, 0.85 + b.size * 0.12);
        if (heavy && b.size > 1) flames(cx - b.size * 0.25, by + Math.min(hgt * 0.6, 2), cz + b.size * 0.2, t, b.id + 7, 0.8);
      }
    }
    for (const [id, o] of W.bld) if (!s.byId.has(id)) { endBuild(o); W.root.remove(o.group); W.bld.delete(id); }
    W.linkVer = s.map.version;
  }

  // Asap/debu membumbung: tiap kepulan lahir kecil, mengembang, berputar pelan, condong searah angin, lalu memudar.
  // n kepulan, rise = tinggi naik, rate = siklus per detik, shade = kecerahan (asap kebakaran lebih gelap).
  const WIND = [0.5, 0.18];
  const frand = (a, b) => (hash(a, b) % 1000) / 1000;
  function puffs(x, y, z, t, seed, kind, size, alpha, n, rise, rate, shade) {
    n = n || 4; rise = rise || 1.6; rate = rate || 0.45;
    for (let i = 0; i < n; i++) {
      const k = ((t * rate + seed * 0.37 + i / n) % 1 + 1) % 1, j = frand(seed, i), sp = take(kind, sprite(kind));
      sp.position.set(x + (j - 0.5) * 0.16 + Math.sin(k * 5 + i + seed) * 0.08 + k * k * WIND[0] * rise, y + k * rise, z + (j - 0.5) * 0.12 + k * k * WIND[1] * rise);
      sp.scale.setScalar(size * (0.45 + k * 1.7) * (0.85 + j * 0.3));
      sp.material.rotation = j * 6.28 + k * (j - 0.5) * 1.6;
      sp.material.color.setScalar(shade || 1);
      sp.material.opacity = Math.min(1, k * 6) * (1 - k) * alpha;
    }
  }
  // Api: empat lidah api yang menari (tinggi dan lebar berdenyut tak seirama) dan bara yang terbawa angin ke atas.
  function flames(x, y, z, t, seed, sc) {
    sc = sc || 1;
    for (let i = 0; i < 4; i++) {
      const j = frand(seed + 11, i), fl = 0.8 + Math.sin(t * (9 + j * 5) + seed + i * 2.1) * 0.13 + Math.sin(t * 23 + i * 1.7) * 0.07, sp = take('fire', sprite('fire'));
      const h = (0.45 + j * 0.35) * sc * fl;
      sp.position.set(x + (i - 1.5) * 0.2 * sc, y + h * 0.4, z + (j - 0.5) * 0.3 * sc);
      sp.scale.set(h * 0.9, h, 1);
      sp.material.rotation = Math.sin(t * 3 + i) * 0.08;
      sp.material.opacity = 0.95;
    }
    const glow = take('ember', sprite('ember'));                                  // pendar jingga di dasar api
    glow.position.set(x, y + 0.15 * sc, z);
    glow.scale.setScalar(1.3 * sc * (0.95 + Math.sin(t * 13 + seed) * 0.05));
    glow.material.opacity = 0.32;
    for (let i = 0; i < 4; i++) {
      const k = ((t * 0.6 + seed * 0.21 + i / 4) % 1 + 1) % 1, j = frand(seed + 5, i), sp = take('ember', sprite('ember'));
      sp.position.set(x + (j - 0.5) * 0.45 * sc + Math.sin(k * 9 + i) * 0.1 + k * WIND[0] * 0.9, y + 0.2 + k * 1.5, z + (j - 0.5) * 0.3 + k * WIND[1] * 0.9);
      sp.scale.setScalar(0.08 * (1 - k * 0.5));
      sp.material.opacity = 1 - k;
    }
  }

  // ---------------------------------------------------------------- unit

  function syncUnits(s, t, me, alpha, dt, sel) {
    const fog = s.fog, newTick = W.tick !== s.tick;
    for (const u of s.units) {
      if (u.dead) continue;
      let o = W.units.get(u.id);
      if (!o) {
        o = { group: models.unit(u.type, u.owner), px: u.x, py: u.y, cx: u.x, cy: u.y, yaw: Math.PI / 2 - u.dir };
        W.root.add(o.group);
        W.units.set(u.id, o);
      } else if (newTick) { o.px = o.cx; o.py = o.cy; o.cx = u.x; o.cy = u.y; }
      const visible = u.owner === me || !!fog.visible[idx(u.x | 0, u.y | 0)];
      o.group.visible = visible;
      if (!visible) continue;
      // posisi diinterpolasi antar-tick simulasi (20 Hz) supaya gerak mulus di 60 fps
      const x = o.px + (o.cx - o.px) * alpha, y = o.py + (o.cy - o.py) * alpha;
      o.group.position.x = x; o.group.position.z = y;
      let dy = (Math.PI / 2 - u.dir) - o.yaw;
      dy = ((dy + Math.PI) % TAU + TAU) % TAU - Math.PI;
      o.yaw += dy * Math.min(1, dt * 12);
      o.group.rotation.y = o.yaw;
      o.group.position.y = BF.relief.at(x, y);
      models.pose(o.group, { t, id: u.id, moving: u.moving, working: u.working, atk: Math.max(0, u.atkAnim) / 0.3, carry: u.carry, carryType: u.carryType, speed: Math.min(BF.unitDef(s, u).speed, u.order.pace || Infinity) });
      if (sel.has(u.id)) {
        const r = take('ring' + (u.owner === me ? 0 : 1), () => new THREE.Mesh(gfx.ringGeo, M.ring[u.owner === me ? 0 : 1])), rad = U[u.type].radius + 0.2;
        r.position.set(x, o.group.position.y + 0.07, y);
        r.quaternion.setFromUnitVectors(UP, BF.relief.normal(x, y, tmpV));      // cincin mengikuti lereng
        r.scale.set(rad, 1, rad);
        r.renderOrder = 6;
      }
    }
    for (const [id, o] of W.units) if (!s.byId.has(id)) { W.root.remove(o.group); models.disposeUnit(o.group); W.units.delete(id); }
    if (newTick) wearGround(s, W.tick);
    W.tick = s.tick;
  }

  // Hewan liar: tampak hanya di area yang sedang terlihat; posisi diinterpolasi seperti unit; bangkai makin kecil saat dikuliti.
  function syncAnimals(s, t, alpha, dt, sel) {
    const fog = s.fog, newTick = W.atick !== s.tick;
    for (const a of s.animals) {
      if (a.dead) continue;
      let o = W.animals.get(a.id);
      if (!o) {
        o = { group: models.unit(a.type, a.type === 'deer' && a.id % 3 === 0 ? 1 : 0), px: a.x, py: a.y, cx: a.x, cy: a.y, yaw: Math.PI / 2 - a.dir };
        W.root.add(o.group);
        W.animals.set(a.id, o);
      } else if (newTick) { o.px = o.cx; o.py = o.cy; o.cx = a.x; o.cy = a.y; }
      const visible = !!fog.visible[idx(a.x | 0, a.y | 0)];
      o.group.visible = visible;
      if (!visible) continue;
      const x = o.px + (o.cx - o.px) * alpha, y = o.py + (o.cy - o.py) * alpha, carcass = a.state === 'carcass';
      let dy = (Math.PI / 2 - a.dir) - o.yaw;
      dy = ((dy + Math.PI) % TAU + TAU) % TAU - Math.PI;
      o.yaw += dy * Math.min(1, dt * 10);
      o.group.position.set(x, BF.relief.at(x, y), y);
      o.group.rotation.y = o.yaw;
      o.group.scale.setScalar(carcass ? 0.7 + 0.3 * a.food / BF.ANIMALS[a.type].food : 1);
      models.pose(o.group, { t, id: a.id, moving: a.moving, run: a.state === 'flee' || a.state === 'charge', graze: a.state === 'graze', carcass, charge: a.state === 'charge', atk: Math.max(0, a.atkAnim || 0) / 0.3 });
      if (sel.has(a.id)) {
        const r = take('ring2', () => new THREE.Mesh(gfx.ringGeo, M.ring[2]));
        r.position.set(x, o.group.position.y + 0.07, y);
        r.quaternion.setFromUnitVectors(UP, BF.relief.normal(x, y, tmpV));
        r.scale.set(BF.ANIMALS[a.type].radius + 0.25, 1, BF.ANIMALS[a.type].radius + 0.25);
        r.renderOrder = 6;
      }
    }
    for (const [id, o] of W.animals) if (!s.byId.has(id)) { W.root.remove(o.group); models.disposeUnit(o.group); W.animals.delete(id); }
    W.atick = s.tick;
  }

  // Jalan tanah: tiap tick, unit darat yang berjalan mengikis rumput di bawah kakinya; keausan pulih sangat lambat
  // (1 tingkat per 10 detik), jadi hanya jalur yang terus dilalui — pekerja bolak-balik ke sumber daya — yang menjadi jalan.
  // Murni tampilan: tidak memengaruhi simulasi, dan mulai dari nol lagi saat permainan dimuat.
  function wearGround(s, prev) {
    const w = W.wear, d = w.data, n = w.n, R = w.R, k = prev < 0 ? 1 : BF.clamp(s.tick - prev, 1, 8);    // tick yang berlalu sejak frame lalu (kecepatan 2×/3×)
    const rub = (px, py, a) => { if (px < 0 || py < 0 || px >= n || py >= n) return; const i = ((n - 1 - py) * n + px) * 4; if (d[i] < 255) d[i] = Math.min(255, d[i] + a * k); };
    for (const u of s.units) {
      if (u.dead || !u.moving) continue;
      const px = Math.floor(u.x * R), py = Math.floor(u.y * R);
      rub(px, py, 4); rub(px - 1, py, 2); rub(px + 1, py, 2); rub(px, py - 1, 2); rub(px, py + 1, 2);
      w.dirty = true;
    }
    const step = (t, m) => Math.floor(t / m) !== Math.floor(prev / m);
    if (prev >= 0 && step(s.tick, 200)) for (let i = 0; i < d.length; i += 4) if (d[i]) d[i]--;
    if (w.dirty && step(s.tick, 10)) { w.tex.needsUpdate = true; w.dirty = false; }
  }

  // ---------------------------------------------------------------- proyektil & efek

  function syncProjectiles(s) {
    const fog = s.fog, now = performance.now(), live = new Set(), vis = (x, y) => !!fog.visible[idx(BF.clamp(x | 0, 0, N - 1), BF.clamp(y | 0, 0, N - 1))];
    // Panah yang sudah kena: menancap di bangunan, atau di tanah bila sasarannya tewas/hilang (sasaran hidup: masuk ke badan).
    for (const [p, f] of W.fly) {
      if (s.projectiles.includes(p)) continue;
      W.fly.delete(p);
      const tg = s.byId.get(p.tid);
      if (!p.splash && (!tg || tg.dead || tg.kind === 'building')) W.stuck.push(Object.assign(f, { t0: now, ground: !tg || tg.dead }));
    }
    if (W.stuck.length > 60) W.stuck.splice(0, W.stuck.length - 60);
    W.stuck = W.stuck.filter(a => now - a.t0 < 6000);
    for (const a of W.stuck) {
      if (!vis(a.x, a.y)) continue;
      const m = take('arrow', () => new THREE.Mesh(gfx.arrowGeo, M.flat)), gy = BF.relief.at(a.x, a.y);
      if (a.ground) { m.position.set(a.x - a.dx * 0.1, gy + 0.11, a.y - a.dz * 0.1); m.lookAt(a.x + a.dx * 0.5, gy - 0.4, a.y + a.dz * 0.5); }
      else { m.position.set(a.x - a.dx * 0.12, a.h, a.y - a.dz * 0.12); m.lookAt(a.x + a.dx, a.h + a.slope * 0.5, a.y + a.dz); }
    }
    for (const p of s.projectiles) {
      live.add(p);
      if (!vis(p.x, p.y)) continue;
      const total = BF.dist(p.tx - p.sx, p.ty - p.sy) || 1, done = BF.clamp(BF.dist(p.x - p.sx, p.y - p.sy) / total, 0, 1);
      const arc = p.splash ? 2.2 : 0.3 + total * 0.06, h = BF.relief.at(p.x, p.y) + 0.55 * (1 - done) + 0.35 * done + Math.sin(done * Math.PI) * arc;
      const slope = (Math.cos(done * Math.PI) * Math.PI * arc - 0.2) / total;        // dh/ds, untuk arah panah
      if (p.splash) {
        const m = take('rock', () => { const q = new THREE.Mesh(gfx.rockGeo, M.rock); q.castShadow = true; return q; });
        m.position.set(p.x, h, p.y);
        m.rotation.set(now * 0.007, now * 0.005, 0);                              // batu berputar di udara
      } else {
        const m = take('arrow', () => new THREE.Mesh(gfx.arrowGeo, M.flat)), dx = p.tx - p.x, dz = p.ty - p.y, l = Math.hypot(dx, dz) || 1;
        m.position.set(p.x, h, p.y);
        m.lookAt(p.x + dx / l, h + slope, p.y + dz / l);
        W.fly.set(p, { x: p.x, y: p.y, h, dx: dx / l, dz: dz / l, slope });
      }
    }
  }

  // Reruntuhan: bangunan yang sama dipotong rendah (sisa dinding dan tiang), hangus menghitam, di tengah serakan batu dan
  // balok. Bidang potong dalam koordinat dunia, jadi ikut diturunkan saat reruntuhan tenggelam di akhir umurnya.
  function makeRuin(s, e) {
    const p = s.players[e.owner], proto = models.building(e.bt, e.owner, 0, p && p.faction), g = new THREE.Group(), ruin = proto.clone();
    const top = new THREE.Box3().setFromObject(proto).max.y, plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), made = new Map();
    const charred = m => {
      if (!made.has(m)) {
        const ud = m.userData; m.userData = {};
        const c = m.clone(); m.userData = ud;
        c.onBeforeCompile = m.onBeforeCompile;
        c.color = new THREE.Color(m.color).multiply(new THREE.Color(0.3, 0.27, 0.25));      // hangus
        c.clippingPlanes = [plane];
        c.clipShadows = true;
        c.side = THREE.DoubleSide;                       // sisi dalam dinding yang terpotong ikut terlihat
        made.set(m, c);
      }
      return made.get(m);
    };
    ruin.traverse(x => { if (x.isMesh) x.material = Array.isArray(x.material) ? x.material.map(charred) : charred(x.material); });
    ruin.position.set(-e.size / 2, 0, -e.size / 2);
    g.add(ruin, models.rubble(e.size).clone());
    g.userData.ruin = { plane, h: Math.min(0.62, top * 0.24), mats: [...made.values()] };
    return g;
  }
  function dropFx(m) {
    if (m.userData.mixer) models.disposeUnit(m);
    if (m.userData.own) m.geometry.dispose();
    if (m.userData.ruin) for (const c of m.userData.ruin.mats) c.dispose();
  }

  function syncEffects(s, t) {
    const fog = s.fog, live = new Set();
    for (const e of s.effects) {
      const k = BF.clamp(e.t / e.life, 0, 1), seen = !!fog.explored[idx(BF.clamp(e.x | 0, 0, N - 1), BF.clamp(e.y | 0, 0, N - 1))];
      if (e.type === 'death' || e.type === 'rubble') {
        if (!seen) continue;
        live.add(e);
        let m = W.fxMap.get(e);
        if (!m) {
          if (e.unit === 'catapult') m = models.catapultWreck(e.owner || 0).clone();            // bangkai: geometri bersama, jangan dibuang
          else if (e.bt && !B[e.bt].barrier) m = makeRuin(s, e);
          else if (e.type === 'rubble') m = models.rubble(e.size).clone();
          else if (e.unit && models.rigged(e.unit)) m = models.unit(e.unit, e.owner || 0);          // model berkerangka: rebah dengan klip "mati" lalu diam
          else {
            m = new THREE.Mesh(models.corpse(e.owner || 0, e.big), M.flat);
            m.userData.own = true;
            m.castShadow = m.receiveShadow = true;
          }
          m.position.set(e.x, 0, e.y);
          if (m.userData.mixer) { m.rotation.y = Math.PI / 2 - (e.dir || 0); models.pose(m, { t, id: 0, dead: true, atk: 0, skip: e.t }); }      // menghadap arah unit saat tewas
          else if (!m.userData.ruin) m.rotation.y = (hash((e.x * 31) | 0, (e.y * 17) | 0) % 628) / 100;
          W.root.add(m);
          W.fxMap.set(e, m);
        }
        m.position.y = BF.relief.at(e.x, e.y) - Math.pow(Math.max(0, k - 0.7) / 0.3, 2) * (e.type === 'death' ? 0.3 : 0.5);      // tenggelam perlahan di akhir
        if (m.userData.mixer && e.t < 2.5) models.pose(m, { t, id: 0, dead: true, atk: 0 });
        if (m.userData.ruin) m.userData.ruin.plane.constant = m.userData.ruin.h + m.position.y;
      } else if (e.type === 'boom') {
        // hantaman batu / bangunan runtuh: cincin debu yang mengembang dan membumbung, serpihan batu & kayu terlempar melengkung
        if (!seen) continue;
        const gy = BF.relief.at(e.x, e.y), big = e.life > 0.6, seed = (e.x * 131 + e.y * 71) | 0, kk = 1 - (1 - k) * (1 - k), nd = big ? 9 : 6;
        for (let i = 0; i < nd; i++) {
          const j = frand(seed, i), a = i / nd * TAU + j, rr = e.r * (0.2 + kk * (0.8 + j * 0.5)), sp = take('dust', sprite('dust'));
          sp.position.set(e.x + Math.cos(a) * rr, gy + 0.15 + kk * (big ? 1.1 : 0.6) * (0.5 + j), e.y + Math.sin(a) * rr);
          sp.scale.setScalar((0.45 + kk * 1.4) * Math.max(0.7, e.r) * (0.8 + j * 0.4));
          sp.material.rotation = j * 6.28 + kk;
          sp.material.color.setScalar(1);
          sp.material.opacity = 0.85 * (1 - k) * Math.min(1, k * 8);
        }
        for (let i = 0, nc = big ? 10 : 6; i < nc; i++) {
          const j = frand(seed + 3, i), j2 = frand(seed + 9, i), a = j * TAU, sp = (1.2 + j2 * 2.2) * Math.max(0.6, Math.min(1.4, e.r)), vy = 2.2 + j * 2.5;
          const tt = Math.min(e.t, (vy + Math.sqrt(vy * vy + 5.9)) / 9.8), hh = 0.3 + vy * tt - 4.9 * tt * tt, wood = i % 3 === 0;
          const m = take(wood ? 'chipW' : 'chipS', () => { const q = new THREE.Mesh(gfx.chipGeo[wood ? 1 : 0], M.chip[wood ? 1 : 0]); q.castShadow = true; return q; });
          m.position.set(e.x + Math.cos(a) * sp * tt, gy + Math.max(0.02, hh), e.y + Math.sin(a) * sp * tt);
          m.rotation.set(tt * 9 * j, tt * 7, tt * 11 * j2);
          m.scale.setScalar((0.6 + j2 * 0.8) * (big ? 1.2 : 0.9) * (k > 0.85 ? (1 - k) / 0.15 : 1));
        }
      } else if (e.type === 'hit') {
        const sp = take('spark', sprite('spark'));
        sp.position.set(e.x, BF.relief.at(e.x, e.y) + 0.55, e.y);
        sp.scale.setScalar(0.2 + k * 0.25);
        sp.material.rotation = e.x * 7;
        sp.material.opacity = 1 - k;
      }
    }
    for (const [e, m] of W.fxMap) if (!live.has(e)) { W.root.remove(m); dropFx(m); W.fxMap.delete(e); }
  }

  // ---------------------------------------------------------------- penanda antarmuka di dunia

  function syncMarkers(s, t, me, ui, sel) {
    const rect = (b, own) => {
      const l = take('rect' + own, () => { const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 0, 1), new THREE.Vector3(0, 0, 1)]); const o = new THREE.LineLoop(g, M.line[own]); o.renderOrder = 6; return o; });
      l.position.set(b.tx - 0.04, (W.flat.has(b.id) ? W.flat.get(b.id) : BF.relief.at(b.tx, b.ty)) + 0.07, b.ty - 0.04);
      l.scale.set(b.size + 0.08, 1, b.size + 0.08);
    };
    for (const b of s.buildings) {
      if (b.dead || !sel.has(b.id)) continue;
      rect(b, b.owner === me ? 0 : 1);
      if (b.rally && b.owner === me) {
        const line = take('rally', () => new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]), M.line[0]));
        const pa = line.geometry.attributes.position;
        pa.setXYZ(0, b.tx + b.size / 2, BF.relief.at(b.tx + b.size / 2, b.ty + b.size / 2) + 0.07, b.ty + b.size / 2);
        pa.setXYZ(1, b.rally.x, BF.relief.at(b.rally.x, b.rally.y) + 0.07, b.rally.y);
        pa.needsUpdate = true;
        line.geometry.computeBoundingSphere();
        const f = take('rflag', () => { const g = new THREE.Group(), p = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 5), M.flat); p.position.y = 0.45; const fl = new THREE.Mesh(models.flagGeo[me] || (models.flagGeo[me] = models.flag(me)), M.flagSide); fl.position.y = 0.9; g.add(p, fl); return g; });
        f.position.set(b.rally.x, BF.relief.at(b.rally.x, b.rally.y), b.rally.y);
        f.children[1].rotation.y = Math.sin(t * 2.2) * 0.35 - 0.6;
      }
    }
    ui.pings.forEach((p, i) => {
      const k = p.t / 0.5, r = take('ping', () => { const m = new THREE.Mesh(gfx.ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false })); m.renderOrder = 6; return m; });
      r.material.color.set(p.col);
      r.material.opacity = 1 - k;
      r.position.set(p.x, BF.relief.at(p.x, p.y) + 0.07, p.y);
      const sc = 0.15 + k * 0.55;
      r.scale.set(sc, 1, sc);
      void i;
    });
    // bayangan penempatan bangunan
    for (const gh of ui.ghosts) {
      const key = 'ghost:' + gh.type + ':' + (gh.links || 0);
      const g = take(key, () => { const c = models.building(gh.type, me, gh.links || 0, s.players[me].faction).clone(); c.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } }); return c; });
      const mat = M.ghost[gh.ok ? 0 : 1];
      g.traverse(o => { if (o.isMesh) o.material = mat; });
      g.position.set(gh.tx, BF.relief.avg(gh.tx, gh.ty, B[gh.type].size) + 0.02, gh.ty);
    }
  }

  // ---------------------------------------------------------------- overlay 2D: bar HP & kotak seret

  function hpBar(g, x, y, w, frac) {
    frac = BF.clamp(frac, 0, 1);
    g.fillStyle = 'rgba(0,0,0,.72)';
    g.fillRect(x - w / 2 - 1, y - 1, w + 2, 5);
    g.fillStyle = frac > 0.6 ? '#4ade80' : frac > 0.3 ? '#facc15' : '#f87171';
    g.fillRect(x - w / 2, y, w * frac, 3);
  }

  function overlay(v, s, me, sel) {
    const g = v.fx, fog = s.fog, ppu = view.ppu();
    g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    g.clearRect(0, 0, v.w, v.h);
    const on = p => p.x > -60 && p.x < v.w + 60 && p.y > -60 && p.y < v.h + 60;
    for (const b of s.buildings) {
      if (b.dead || !BF.buildingSeen(s, b)) continue;
      const d = BF.bldDef(s, b), show = !b.built || sel.has(b.id) || b.hp < d.hp, hid = b.owner === me ? b.inside.length : 0;
      if (!show && !hid) continue;
      const p = view.toScreen(b.tx + b.size / 2, b.ty + b.size / 2, view.BUILD_H[b.type] * (b.built ? 1 : 0.5) + 0.25);
      if (!on(p)) continue;
      if (show) hpBar(g, p.x, p.y, Math.max(22, b.size * ppu * 0.42), b.built ? b.hp / d.hp : b.progress);
      if (hid) {                                         // penanda jumlah unit yang berlindung (hanya bangunan sendiri)
        const txt = '⌂ ' + hid + '/' + d.garrison;
        g.font = '600 11px system-ui, sans-serif';
        const w = g.measureText(txt).width + 10;
        g.fillStyle = 'rgba(0,0,0,.72)';
        g.fillRect(p.x - w / 2, p.y - 19, w, 15);
        g.fillStyle = '#bfdbfe';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(txt, p.x, p.y - 11);
      }
    }
    for (const u of s.units) {
      if (u.dead || (u.owner !== me && !fog.visible[idx(u.x | 0, u.y | 0)])) continue;
      const d = BF.unitDef(s, u);
      if (!sel.has(u.id) && u.hp >= d.hp) continue;
      const o = W.units.get(u.id), x = o ? o.group.position.x : u.x, y = o ? o.group.position.z : u.y;
      const p = view.toScreen(x, y, U[u.type].cls === 'cavalry' ? 1.42 : 1.02);
      if (on(p)) hpBar(g, p.x, p.y, Math.max(18, ppu * 0.48), u.hp / d.hp);
    }
    for (const a of s.animals) {                         // hewan liar: bar nyawa bila dipilih atau terluka (bukan bangkai)
      if (a.dead || a.state === 'carcass' || !fog.visible[idx(a.x | 0, a.y | 0)]) continue;
      const max = BF.ANIMALS[a.type].hp;
      if (!sel.has(a.id) && a.hp >= max) continue;
      const o = W.animals.get(a.id), p = view.toScreen(o ? o.group.position.x : a.x, o ? o.group.position.z : a.y, a.type === 'deer' ? 0.95 : 0.62);
      if (on(p)) hpBar(g, p.x, p.y, Math.max(16, ppu * 0.42), a.hp / max);
    }
    const dr = v.ui.drag;
    if (dr && (Math.abs(dr.x1 - dr.x0) > 4 || Math.abs(dr.y1 - dr.y0) > 4)) {
      const x = Math.min(dr.x0, dr.x1), y = Math.min(dr.y0, dr.y1), w = Math.abs(dr.x1 - dr.x0), h = Math.abs(dr.y1 - dr.y0);
      g.fillStyle = 'rgba(255,255,255,.08)';
      g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(255,255,255,.85)';
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
  }

  // ---------------------------------------------------------------- frame

  BF.render = function (v) {
    const s = v.s, me = s.human, now = performance.now(), dt = Math.min(0.1, (now - lastNow) / 1000);
    lastNow = now;
    if (!W || W.s !== s) buildWorld(s);
    view.update();
    const cam = v.cam, t = (s.tick + v.alpha) * BF.DT, sel = new Set(v.ui.sel);

    // matahari mengikuti kamera; kotak bayangan menutupi area pandang
    sun.target.position.set(cam.x, 0, cam.y);
    sun.position.copy(sun.target.position).add(SUN_OFFSET.clone().multiplyScalar(2.2));
    fill.position.set(cam.x + Math.sin(cam.yaw) * FILL_C, FILL_S, cam.y + Math.cos(cam.yaw) * FILL_C);
    const half = cam.zoom * 0.95 + 4, sc = sun.shadow.camera;
    if (sc.right !== half) { sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.updateProjectionMatrix(); }

    const lod = cam.zoom <= LOD_ZOOM[0] ? 0 : cam.zoom <= LOD_ZOOM[1] ? 1 : 2;
    if (lod !== W.lod) {
      W.lod = lod;
      for (const m of W.inst) { m.geometry = m.userData.lods[Math.min(lod, m.userData.lods.length - 1)]; if (m.userData.decor) m.visible = lod < 2; }
    }

    resetPools();
    syncFogAndNodes(s);
    syncBuildings(s, t, me);
    syncUnits(s, t, me, v.alpha, dt, sel);
    syncAnimals(s, t, v.alpha, dt, sel);
    syncProjectiles(s);
    syncEffects(s, t);
    syncMarkers(s, t, me, v.ui, sel);
    tex.ripple.offset.set(now * 0.000012, now * 0.000008);

    renderer.render(scene, view.camera);
    overlay(v, s, me, sel);
  };

  // ---------------------------------------------------------------- minimap (tampak atas, utara di atas)

  const MM = { grass: [88, 141, 61], sand: [196, 180, 124], water: [44, 104, 150], 1: [38, 88, 44], 2: [214, 80, 110], 3: [240, 205, 70], 4: [158, 163, 170] };
  let mmC = null, mmG = null, mmImg = null, mmKey = '';

  BF.renderMinimap = function (g, size, s) {
    const map = s.map, fog = s.fog, me = s.human;
    if (!mmC) {
      mmC = document.createElement('canvas');
      mmC.width = mmC.height = N;
      mmG = mmC.getContext('2d');
      mmImg = mmG.createImageData(N, N);
    }
    const key = s.seed + ':' + map.version + ':' + fog.version;
    if (key !== mmKey) {
      mmKey = key;
      const d = mmImg.data;
      for (let i = 0; i < N * N; i++) {
        let c, k = 1;
        if (!fog.explored[i]) c = [8, 9, 12];
        else {
          c = map.terrain[i] ? MM.water : map.node[i] ? MM[map.node[i]] : map.shore[i] ? MM.sand : MM.grass;
          if (!fog.visible[i]) k = 0.55;
        }
        d[i * 4] = c[0] * k; d[i * 4 + 1] = c[1] * k; d[i * 4 + 2] = c[2] * k; d[i * 4 + 3] = 255;
      }
      mmG.putImageData(mmImg, 0, 0);
    }
    const k = size / N;
    g.imageSmoothingEnabled = false;
    g.drawImage(mmC, 0, 0, size, size);
    for (const b of s.buildings) {
      if (b.dead || !BF.buildingSeen(s, b)) continue;
      g.fillStyle = s.players[b.owner].color;
      g.fillRect(b.tx * k, b.ty * k, Math.max(3, b.size * k), Math.max(3, b.size * k));
    }
    for (const u of s.units) {
      if (u.dead || (u.owner !== me && !fog.visible[idx(u.x | 0, u.y | 0)])) continue;
      g.fillStyle = s.players[u.owner].light;
      g.fillRect(u.x * k - 1, u.y * k - 1, 2.5, 2.5);
    }
    g.fillStyle = '#e9c46a';                                // hewan liar yang sedang terlihat
    for (const a of s.animals) if (!a.dead && fog.visible[idx(a.x | 0, a.y | 0)]) g.fillRect(a.x * k - 1, a.y * k - 1, 2, 2);
    const p = s.players[me];
    if (s.tick - p.alertTick < 120 && ((s.tick / 6) | 0) % 2 === 0) {
      g.beginPath();
      g.arc(p.alertX * k, p.alertY * k, 7, 0, TAU);
      g.strokeStyle = '#fde047'; g.lineWidth = 2; g.stroke();
    }
    // bidang pandang kamera: jejak empat sudut layar di tanah (ikut berputar bersama kamera)
    const c = view.groundCorners();
    g.beginPath();
    c.forEach((q, i) => (i ? g.lineTo(q.x * k, q.y * k) : g.moveTo(q.x * k, q.y * k)));
    g.closePath();
    g.strokeStyle = '#ffffff'; g.lineWidth = 1; g.stroke();
  };

  // ---------------------------------------------------------------- ikon tombol & potret (cuplikan 3D)

  let icon = null;
  const iconCache = {};
  function iconImage(kind, type, owner) {
    const s = BF.game && BF.game.s, faction = s && s.players[owner] ? s.players[owner].faction : '';
    const key = kind + ':' + type + ':' + owner + ':' + faction;
    if (iconCache[key]) return iconCache[key];
    if (!icon) {
      const c = document.createElement('canvas');
      c.width = c.height = 192;
      const r = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.setClearColor(0x000000, 0);
      output(r);
      const sc = new THREE.Scene(), dl = new THREE.DirectionalLight(0xfff1d6, 2.6);
      dl.position.set(-4, 8, 5);
      sc.add(new THREE.HemisphereLight(0xe6efff, 0x57492f, 1.3), dl);
      icon = { c, r, sc, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100), holder: new THREE.Group() };
      sc.add(icon.holder);
    }
    const obj = kind === 'unit' || kind === 'animal' ? models.unit(type, owner) : models.building(type, owner, B[type].barrier ? 10 : 0, faction).clone();
    if (kind === 'unit' || kind === 'animal') models.pose(obj, { t: 0, id: 0, moving: false, working: false, atk: 0, carry: 0 });
    icon.holder.clear();
    icon.holder.add(obj);
    const box = new THREE.Box3().setFromObject(obj), ctr = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    const half = Math.max(sz.x, sz.z) * 0.62 + sz.y * 0.34;
    icon.cam.left = -half; icon.cam.right = half; icon.cam.top = half; icon.cam.bottom = -half;
    icon.cam.position.set(ctr.x + 12, ctr.y + 11, ctr.z + 12);
    icon.cam.lookAt(ctr);
    icon.cam.updateProjectionMatrix();
    icon.r.render(icon.sc, icon.cam);
    const out = document.createElement('canvas');
    out.width = out.height = 192;
    out.getContext('2d').drawImage(icon.c, 0, 0);
    return (iconCache[key] = out);
  }

  BF.drawIcon = function (canvas, kind, type, owner, px) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.height = Math.round(px * dpr);
    canvas.style.width = canvas.style.height = px + 'px';
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    if (kind === 'tech') { g.scale(px / 40, px / 40); BF.techIcon(g, type); return; }
    g.imageSmoothingQuality = 'high';
    g.drawImage(iconImage(kind, type, owner), 0, 0, px, px);
  };
})();
