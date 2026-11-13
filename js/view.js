'use strict';
// Kamera 3D (ortografik, bisa diputar & zoom) dan konversi koordinat dunia ↔ layar.
// Dunia game: (x, y) satuan tile di bidang tanah. Dunia three.js: X = x, Z = y, Y = tinggi.
// Satu-satunya tempat yang tahu bentuk proyeksi; render, input, dan suara memakainya.
(function () {
  const N = BF.MAP_SIZE, EL = 40 * Math.PI / 180;      // sudut elevasi kamera
  const SIN_EL = Math.sin(EL), COS_EL = Math.cos(EL), DIST = 220;
  const v3 = new THREE.Vector3();

  const view = BF.view = {
    ZOOM_MIN: 8, ZOOM_MAX: 38, ZOOM_DEFAULT: 17, YAW_DEFAULT: Math.PI / 4,
    // Tinggi (satuan tile) objek tegak: dipakai untuk klik pada badan objek dan posisi bar HP.
    BUILD_H: { townhall: 4.6, house: 1.9, farm: 0.08, storage: 2.0, barracks: 1.9, range: 1.2, stable: 1.8, smithy: 2.0, workshop: 2.0, tower: 4.6, wall: 1.3, gate: 1.9 },
    NODE_H: { 1: 2.7, 2: 0.6, 3: 0.75, 4: 0.75 },
    camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 600),
    w: 1, h: 1,

    resize(w, h) { view.w = w; view.h = h; },

    // Terapkan state kamera game (BF.game.cam = {x, y, yaw, zoom}) ke kamera three.js.
    update() {
      const c = BF.game.cam, cam = view.camera, halfH = c.zoom / 2, halfW = halfH * view.w / view.h;
      cam.left = -halfW; cam.right = halfW; cam.top = halfH; cam.bottom = -halfH;
      cam.position.set(c.x + Math.sin(c.yaw) * COS_EL * DIST, SIN_EL * DIST, c.y + Math.cos(c.yaw) * COS_EL * DIST);
      cam.lookAt(c.x, 0, c.y);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
    },

    // piksel layar per satuan dunia (tegak lurus arah pandang)
    ppu() { return view.h / BF.game.cam.zoom; },

    // Titik dunia (x, y) setinggi h di atas tanah (relief bukit ikut dihitung) → piksel layar.
    toScreen(x, y, h) {
      v3.set(x, (h || 0) + BF.relief.at(x, y), y).project(view.camera);
      return { x: (v3.x + 1) / 2 * view.w, y: (1 - v3.y) / 2 * view.h };
    },

    // Sinar pandang lewat piksel layar: {o: asal, d: arah (menurun)}.
    ray(px, py) {
      const o = new THREE.Vector3(px / view.w * 2 - 1, 1 - py / view.h * 2, -1).unproject(view.camera);
      const d = new THREE.Vector3(0, 0, -1).transformDirection(view.camera.matrixWorld);
      return { o, d };
    },

    // Titik TANAH di bawah piksel layar: sinar ditelusuri dari ketinggian 4 ke bawah sampai pertama kali berada di bawah
    // permukaan relief, lalu titik potongnya dipersempit dengan bagi dua (tepat di lereng securam apa pun).
    toWorld(px, py) {
      const r = view.ray(px, py), at = BF.relief.at, P = h => { const t = (h - r.o.y) / r.d.y; return [r.o.x + r.d.x * t, r.o.z + r.d.z * t]; };
      let hi = 4, lo = hi;
      for (; lo > -0.8; lo -= 0.15) { const p = P(lo); if (lo <= at(p[0], p[1])) break; hi = lo; }
      for (let i = 0; i < 12; i++) { const m = (hi + lo) / 2, p = P(m); if (m <= at(p[0], p[1])) lo = m; else hi = m; }
      const p = P((hi + lo) / 2);
      return { x: p[0], y: p[1] };
    },

    // Objek tegak (bangunan / node sumber daya) yang tertembus sinar pandang di piksel itu, yang terdepan dulu:
    // sinar ditelusuri dari atas ke bawah sampai menembus tanah; objek kena bila titik sinar berada di tile-nya dan di bawah
    // puncaknya (diukur dari tanah tempatnya berdiri).
    pickStanding(s, px, py) {
      const r = view.ray(px, py), map = s.map, at = BF.relief.at;
      for (let h = 7; h >= -0.7; h -= 0.12) {
        const t = (h - r.o.y) / r.d.y, x = r.o.x + r.d.x * t, y = r.o.z + r.d.z * t, tx = Math.floor(x), ty = Math.floor(y);
        if (!BF.inBounds(tx, ty)) continue;
        if (h < at(x, y) - 0.05) break;
        const i = BF.idx(tx, ty), n = map.node[i];
        if (n && s.fog.explored[i] && h - at(tx + 0.5, ty + 0.5) <= view.NODE_H[n]) {
          const dx = x - tx - 0.5, dy = y - ty - 0.5, rad = n === BF.N_TREE ? (h > 1 ? 0.62 : 0.2) : 0.5;
          if (dx * dx + dy * dy <= rad * rad) return { node: n, x: tx, y: ty };
        }
        const b = s.byId.get(map.bld[i]);
        if (b && !b.dead && h - at(b.tx + b.size / 2, b.ty + b.size / 2) <= view.BUILD_H[b.type] && BF.buildingSeen(s, b)) return { b };
      }
      return null;
    },

    // Empat titik tanah di sudut-sudut layar (untuk minimap).
    groundCorners() {
      return [view.toWorld(0, 0), view.toWorld(view.w, 0), view.toWorld(view.w, view.h), view.toWorld(0, view.h)];
    },

    // Geser sasaran kamera sejauh (dx, dy) piksel layar.
    panPx(dx, dy) {
      const c = BF.game.cam, k = 1 / view.ppu(), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
      // kanan layar = (cos yaw, -sin yaw); bawah layar di tanah = (sin yaw, cos yaw) / sin(elevasi)
      c.x += (dx * cy + dy * sy / SIN_EL) * k;
      c.y += (-dx * sy + dy * cy / SIN_EL) * k;
    },

    // Jaga agar titik tanah di piksel (px, py) tetap berada di dalam peta.
    clampAt(px, py) {
      const c = BF.game.cam;
      view.update();
      const g = view.toWorld(px, py), x = BF.clamp(g.x, 0, N), y = BF.clamp(g.y, 0, N);
      c.x += x - g.x;
      c.y += y - g.y;
      view.update();
    },
  };
})();
