'use strict';
// Pustaka material PBR three.js: bahan bangunan bertekstur foto (dari BF.assets), medan, dan air.
// Tekstur dinding/atap berulang: 1 pengulangan = 1 satuan tile di dunia.
(function () {
  const N = BF.MAP_SIZE, TAU = Math.PI * 2;
  // Alur warna linear: warna hex/CSS dan tekstur warna dianggap sRGB lalu dihitung dalam ruang linear.
  THREE.ColorManagement.legacyMode = false;
  const tex = BF.tex = {};

  function canvas(w, h, paint) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    paint(c.getContext('2d'), w, h);
    return c;
  }

  // ---------------------------------------------------------------- medan

  function vnoise(x, y, cell, seed) {
    const hsh = (ix, iy) => { let n = (Math.imul(ix + seed * 131, 374761393) + Math.imul(iy - seed * 57, 668265263)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return (((n ^ (n >>> 16)) >>> 0) & 1023) / 1023; };
    const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy);
    let fx = gx - x0, fy = gy - y0;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = hsh(x0, y0), b = hsh(x0 + 1, y0), c = hsh(x0, y0 + 1), d = hsh(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  // "Kedaratan" 0..1 di titik dunia (x, y): interpolasi antar-tile + usikan noise → garis pantai organik.
  // Dipakai bersama oleh warna medan dan bentuk (ketinggian) dasar air agar keduanya cocok.
  tex.landness = function (map, x, y) {
    const L = (tx, ty) => (map.terrain[BF.clamp(ty, 0, N - 1) * N + BF.clamp(tx, 0, N - 1)] ? 0 : 1);
    const fx = x - 0.5, fy = y - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
    const l = L(ix, iy) * (1 - ax) * (1 - ay) + L(ix + 1, iy) * ax * (1 - ay) + L(ix, iy + 1) * (1 - ax) * ay + L(ix + 1, iy + 1) * ax * ay;
    return l + (vnoise(x, y, 0.9, 3) - 0.5) * 0.2;
  };

  // Peta kendali medan: R = porsi rumput (0 = pasir), G = basah/kedalaman air, B = variasi terang skala besar.
  function controlMap(map) {
    const R = 6, W = N * R;
    return canvas(W, W, g => {
      const img = g.createImageData(W, W), d = img.data;
      // noise frekuensi rendah dihitung per tile lalu diinterpolasi (hemat waktu)
      const lo = new Float32Array((N + 1) * (N + 1));
      for (let y = 0; y <= N; y++) for (let x = 0; x <= N; x++) lo[y * (N + 1) + x] = vnoise(x, y, 5.5, 5) * 0.6 + vnoise(x, y, 1.9, 11) * 0.4;
      for (let py = 0; py < W; py++) {
        const y = (py + 0.5) / R, ty = Math.min(N - 1, y | 0), fy = y - ty;
        for (let px = 0; px < W; px++) {
          const x = (px + 0.5) / R, tx = Math.min(N - 1, x | 0), fx = x - tx, i0 = ty * (N + 1) + tx;
          const t = (lo[i0] * (1 - fx) + lo[i0 + 1] * fx) * (1 - fy) + (lo[i0 + N + 1] * (1 - fx) + lo[i0 + N + 2] * fx) * fy;
          const l = tex.landness(map, x, y), j = (py * W + px) * 4;
          d[j] = 255 * BF.clamp((l - 0.6) / 0.12, 0, 1);
          d[j + 1] = 255 * (l < 0.5 ? 0.2 + 0.8 * Math.min(1, (0.5 - l) * 2.6) : 0.2 * BF.clamp((0.6 - l) / 0.1, 0, 1));
          d[j + 2] = 255 * t;
          d[j + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
    });
  }

  // Material medan: tekstur foto rumput & pasir (berulang) dicampur menurut peta kendali; pasir menggelap ke dasar air.
  // wear: tekstur keausan (0..1, sumbu sama dengan peta kendali) → rumput berubah menjadi jalan tanah di jalur yang sering dilalui.
  tex.ground = function (map, wear) {
    const A = BF.assets.tex, ctrl = new THREE.CanvasTexture(controlMap(map));
    A.rumputN.repeat.set(N / 5, N / 5);                               // 1 pengulangan tekstur = 5 tile
    const m = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, normalMap: A.rumputN, normalScale: new THREE.Vector2(0.9, 0.9) });
    m.userData.ctrl = ctrl;
    m.onBeforeCompile = sh => {
      sh.uniforms.tCtrl = { value: ctrl };
      sh.uniforms.tGrass = { value: A.rumput };
      sh.uniforms.tSand = { value: A.pasir };
      sh.uniforms.tWear = { value: wear };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 slope;\nvarying vec2 vCtrlUv;\nvarying vec2 vSlope;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvCtrlUv = uv;\nvSlope = slope;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tCtrl, tGrass, tSand, tWear;\nvarying vec2 vCtrlUv;\nvarying vec2 vSlope;')
        .replace('#include <map_fragment>', [
          'vec4 ctrl = texture2D(tCtrl, vCtrlUv);',
          'vec3 gCol = mix(texture2D(tGrass, vUv).rgb, texture2D(tGrass, vUv * 0.31 + 0.37).rgb, 0.45);',     // dua skala → pengulangan tak kentara
          'vec3 gnd = mix(texture2D(tSand, vUv * 1.7).rgb * vec3(1.1, 1.05, 0.92), gCol * vec3(0.6, 0.8, 0.44), ctrl.r) * (0.74 + 0.52 * ctrl.b);',
          // jalan tanah: tepinya digerigikan oleh terang-gelap rumput agar tidak mulus seperti dicat
          'float path = smoothstep(0.2, 0.62, texture2D(tWear, vCtrlUv).r + (dot(gCol, vec3(0.333)) - 0.33) * 0.6) * ctrl.r;',
          'gnd = mix(gnd, texture2D(tSand, vUv * 1.3 + 0.21).rgb * vec3(0.76, 0.63, 0.47) * (0.78 + 0.44 * ctrl.b), path * 0.9);',
          // lereng bukit (atribut slope dari render.js): x = kemiringan → rumput lebih kering & kecokelatan;
          // y = arah lereng terhadap matahari → bayangan bukit dipertegas agar bentuknya terbaca dari kamera yang tinggi
          'gnd = mix(gnd, gnd * vec3(1.0, 0.82, 0.6), smoothstep(0.02, 0.16, vSlope.x) * ctrl.r * 0.75);',
          'gnd *= clamp(1.0 + vSlope.y * 1.6, 0.55, 1.35);',
          'diffuseColor.rgb *= mix(gnd, gnd * vec3(0.22, 0.4, 0.46), ctrl.g);',
        ].join('\n'))
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(geometryNormal, normal, (0.3 + 0.7 * ctrl.r) * (1.0 - 0.6 * path)));');
    };
    return m;
  };

  // ---------------------------------------------------------------- pustaka material

  // Peta normal kain: lipatan tegak yang bergelombang tak beraturan + tenunan halus. Frekuensi bulat → menyambung di tepi.
  // Pada geometri silinder/bola unit, u mengelilingi badan dan v menyusurinya, jadi lipatan jatuh tegak seperti kain tergantung.
  function clothNormal() {
    const W = 128;
    return new THREE.CanvasTexture(canvas(W, W, g => {
      const img = g.createImageData(W, W), d = img.data, h = new Float32Array(W * W), K = TAU / W;
      for (let y = 0; y < W; y++)
        for (let x = 0; x < W; x++) {
          const fold = Math.sin(x * K * 3 + Math.sin(y * K) * 0.8) * 0.7 + Math.sin(x * K * 5 + 1.3 + Math.sin(y * K * 2 + 2) * 0.6) * 0.3;
          h[y * W + x] = fold * 1.6 + Math.sin(x * K * 64) * Math.sin(y * K * 64) * 0.012;
        }
      for (let y = 0; y < W; y++)
        for (let x = 0; x < W; x++) {
          const at = (i, j) => h[((j + W) % W) * W + ((i + W) % W)];
          const nx = (at(x - 1, y) - at(x + 1, y)) * 2.2, ny = (at(x, y - 1) - at(x, y + 1)) * 2.2, l = Math.hypot(nx, ny, 1), j = (y * W + x) * 4;
          d[j] = (nx / l * 0.5 + 0.5) * 255; d[j + 1] = (ny / l * 0.5 + 0.5) * 255; d[j + 2] = (0.5 / l + 0.5) * 255; d[j + 3] = 255;
        }
      g.putImageData(img, 0, 0);
    }));
  }

  // Material unit: kekasaran & kelogaman dibaca per-vertex (atribut `pbr` dari pembangun mesh), jadi kain, kulit, dan baja
  // bisa berada dalam satu mesh dan satu draw call. Peta normal kain hanya berlaku pada permukaan sekasar kain (≥ 0,85).
  function unitMaterial(m) {
    const n = m.normalMap = clothNormal();
    n.wrapS = n.wrapT = THREE.RepeatWrapping;
    n.repeat.set(0.5, 0.5);
    m.normalScale = new THREE.Vector2(0.7, 0.7);
    m.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 pbr;\nvarying vec2 vPbr;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvPbr = pbr;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vPbr;')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.x;').replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;')
        .replace('#include <normal_fragment_maps>', [
          '#ifdef TANGENTSPACE_NORMALMAP',
          '  vec3 mapN = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0;',
          '  mapN.xy *= normalScale * smoothstep( 0.84, 0.9, vPbr.x );',
          '  normal = perturbNormal2Arb( - vViewPosition, normal, mapN, faceDirection );',
          '#endif',
        ].join('\n'));
    };
    return m;
  }

  tex.build = function () {
    const lam = (opts) => new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.88, metalness: 0 }, opts));
    // bahan bangunan: tekstur foto + peta normal bila ada; warna per-vertex dari pembangun mesh tetap berlaku (peneduhan kaki dinding dsb.)
    const A = BF.assets.tex, foto = (nama, opts) => lam(Object.assign({ map: A['bg_' + nama], normalMap: A['bg_' + nama + 'N'] || null }, opts));
    // atap (jerami, genteng tanah liat, batu sabak) dua sisi: atap hanya berupa kulit atas, sisi baliknya perlu untuk peta bayangan
    const atap = (nama, opts) => foto(nama, Object.assign({ side: THREE.DoubleSide }, opts));
    const M = tex.mat = {
      stone: foto('batu', { color: new THREE.Color(1.25, 1.2, 1.1) }),
      planks: foto('papan'),
      thatch: atap('jerami', { roughness: 0.95 }),
      clay: atap('tanahliat'),
      slate: atap('genteng', { color: 0xa8a29a }),
      plaster: foto('plester', { color: 0xf2e6cb }),
      kapur: lam({ map: A.bg_plester, normalMap: A.bg_batuN, color: 0xf4efe6 }),       // batu kasar berlabur kapur putih (permukaan plester, relief batu)
      soil: foto('ladang'),
      flat: lam({}),
      unit: unitMaterial(lam({})),                                                   // warna per-vertex, tanpa tekstur
      glow: new THREE.MeshBasicMaterial({ color: 0xffa040 }),
      water: new THREE.MeshStandardMaterial({ color: 0x1a4859, roughness: 0.16, metalness: 0, transparent: true, opacity: 0.86, depthWrite: false, normalScale: new THREE.Vector2(0.22, 0.22) }),
    };
    // riak air: peta normal berulang dari jumlahan gelombang sinus (frekuensi bulat → menyambung di tepi)
    const ripple = new THREE.CanvasTexture(canvas(256, 256, (g, w, h) => {
      const img = g.createImageData(w, h), d = img.data, K = TAU / w;
      const waves = [[5, 2, 0.6, 0.3], [-3, 6, 0.5, 1.7], [7, -4, 0.4, 4.1], [2, 9, 0.35, 2.2], [-9, -3, 0.3, 5.3], [11, 6, 0.25, 0.9], [-6, 10, 0.25, 3.3], [13, -2, 0.2, 1.1]];   // [fx, fy, amplitudo, fase]
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let dx = 0, dy = 0;
          for (const [fx, fy, a, ph] of waves) { const c = Math.cos((fx * x + fy * y) * K + ph) * a; dx += c * fx; dy += c * fy; }
          const nx = -dx * 0.09, ny = -dy * 0.09, l = Math.hypot(nx, ny, 1), j = (y * w + x) * 4;
          d[j] = (nx / l * 0.5 + 0.5) * 255; d[j + 1] = (ny / l * 0.5 + 0.5) * 255; d[j + 2] = (0.5 / l + 0.5) * 255; d[j + 3] = 255;
        }
      g.putImageData(img, 0, 0);
    }));
    ripple.wrapS = ripple.wrapT = THREE.RepeatWrapping;
    ripple.repeat.set(N / 4, N / 4);
    M.water.normalMap = ripple;
    tex.ripple = ripple;
    return M;
  };

  // Versi redup sebuah material: untuk objek di wilayah yang pernah dijelajahi tetapi tidak sedang terlihat.
  tex.DIM = 0.2;
  tex.dim = function (m) {
    if (Array.isArray(m)) return m.map(tex.dim);
    if (!m.userData.dim) {
      const d = m.clone();
      d.color = new THREE.Color(m.color).multiplyScalar(tex.DIM);
      m.userData.dim = d;
    }
    return m.userData.dim;
  };
})();
