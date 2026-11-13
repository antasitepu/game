'use strict';
// Pembuatan peta prosedural + query grid (passable, cari node sumber daya, dst).
(function () {
  const N = BF.MAP_SIZE;
  const idx = (x, y) => y * N + x;
  BF.idx = idx;
  BF.inBounds = (x, y) => x >= 0 && y >= 0 && x < N && y < N;

  // map.block: 0 = bebas, 1 = terhalang, 2 + pemilik = gerbang (hanya bisa dilewati pemiliknya).
  BF.passable = function (map, x, y, owner) {
    if (x < 0 || y < 0 || x >= N || y >= N) return false;
    const i = y * N + x, b = map.block[i];
    return map.terrain[i] === 0 && map.node[i] === 0 && (b === 0 || b === owner + 2);
  };

  function makeNoise(rand, cells) {
    const w = cells + 1, g = new Float32Array(w * w);
    for (let i = 0; i < g.length; i++) g[i] = rand();
    return function (u, v) {
      const x = u * cells, y = v * cells;
      const x0 = Math.min(cells - 1, Math.floor(x)), y0 = Math.min(cells - 1, Math.floor(y));
      let fx = x - x0, fy = y - y0;
      fx = fx * fx * (3 - 2 * fx);
      fy = fy * fy * (3 - 2 * fy);
      const a = g[y0 * w + x0], b = g[y0 * w + x0 + 1], c = g[(y0 + 1) * w + x0], d = g[(y0 + 1) * w + x0 + 1];
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    };
  }

  function hasFreeNeighbor(map, x, y) {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if ((dx || dy) && BF.passable(map, x + dx, y + dy)) return true;
    return false;
  }

  // Apakah b bisa dicapai dari a lewat tile yang bisa dilalui (4 arah).
  function reachable(map, a, b) {
    const seen = new Uint8Array(N * N), q = new Int32Array(N * N);
    let h = 0, t = 0;
    q[t++] = idx(a.x, a.y);
    seen[q[0]] = 1;
    const target = idx(b.x, b.y);
    while (h < t) {
      const c = q[h++];
      if (c === target) return true;
      const x = c % N, y = (c / N) | 0;
      const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (const [nx, ny] of nb) {
        if (!BF.passable(map, nx, ny)) continue;
        const ni = idx(nx, ny);
        if (!seen[ni]) { seen[ni] = 1; q[t++] = ni; }
      }
    }
    return false;
  }

  // Label wilayah daratan (dipisah air saja) supaya pencarian node tidak memilih pulau lain.
  function labelRegions(map) {
    map.region.fill(0);
    const q = new Int32Array(N * N);
    let label = 0;
    for (let i = 0; i < N * N; i++) {
      if (map.terrain[i] !== 0 || map.region[i]) continue;
      label++;
      let h = 0, t = 0;
      q[t++] = i;
      map.region[i] = label;
      while (h < t) {
        const c = q[h++], x = c % N, y = (c / N) | 0;
        const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
        for (const [nx, ny] of nb) {
          if (!BF.inBounds(nx, ny)) continue;
          const ni = idx(nx, ny);
          if (map.terrain[ni] === 0 && !map.region[ni]) { map.region[ni] = label; q[t++] = ni; }
        }
      }
    }
  }

  BF.createMap = function (seed) {
    const rand = BF.makeRng(seed);
    const map = {
      size: N,
      terrain: new Uint8Array(N * N),
      node: new Uint8Array(N * N),
      nodeAmt: new Uint16Array(N * N),
      block: new Uint8Array(N * N),
      bld: new Int32Array(N * N),
      variant: new Uint8Array(N * N),
      shore: new Uint8Array(N * N),
      region: new Int16Array(N * N),
      starts: [],
      version: 0,
    };
    const e = 15, f = N - 16;
    const starts = rand() < 0.5 ? [{ x: e, y: f }, { x: f, y: e }] : [{ x: e, y: e }, { x: f, y: f }];
    if (rand() < 0.5) starts.reverse();
    map.starts = starts;
    const nearStart = (x, y, r) => starts.some(s => BF.dist(x - s.x, y - s.y) < r);

    const setNode = (i, type) => { map.node[i] = type; map.nodeAmt[i] = BF.NODES[type].amount; };
    const wA = makeNoise(rand, 5), wB = makeNoise(rand, 13), fA = makeNoise(rand, 7), fB = makeNoise(rand, 17);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = idx(x, y), u = x / N, v = y / N;
        map.variant[i] = (rand() * 4) | 0;
        const edge = Math.min(x, y, N - 1 - x, N - 1 - y);
        const w = wA(u, v) * 0.65 + wB(u, v) * 0.35;
        if (w < 0.3 && edge > 1 && !nearStart(x, y, 13)) { map.terrain[i] = BF.T_WATER; continue; }
        if (nearStart(x, y, 8)) continue;
        const fr = fA(u, v) * 0.6 + fB(u, v) * 0.4;
        if (fr > 0.6 + rand() * 0.06 || rand() < 0.008) setNode(i, BF.N_TREE);
      }
    }

    function placeCluster(cx, cy, type, count) {
      const sx = BF.clamp(Math.round(cx), 2, N - 3), sy = BF.clamp(Math.round(cy), 2, N - 3);
      const open = [[sx, sy]];
      let placed = 0, guard = 0;
      while (placed < count && open.length && guard++ < 600) {
        const [px, py] = open.splice((rand() * open.length) | 0, 1)[0];
        if (px < 1 || py < 1 || px > N - 2 || py > N - 2) continue;
        const i = idx(px, py);
        const cur = map.node[i];
        if (map.terrain[i] !== 0) { if (placed === 0) open.push([px + 1, py], [px, py + 1], [px - 1, py], [px, py - 1]); continue; }
        if (cur === type || (cur !== 0 && cur !== BF.N_TREE) || nearStart(px, py, 4.5)) continue;
        setNode(i, type);
        placed++;
        if (type !== BF.N_TREE) {
          // Pastikan tambang/semak tidak terkubur hutan.
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const j = idx(px + dx, py + dy);
              if (map.node[j] === BF.N_TREE) { map.node[j] = 0; map.nodeAmt[j] = 0; }
            }
        }
        open.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
      }
    }

    for (const s of starts) {
      const a = rand() * Math.PI * 2;
      const at = (ang, d) => [s.x + BF.qcos(a + ang) * d, s.y + BF.qsin(a + ang) * d];
      placeCluster(...at(0, 6), BF.N_BERRY, 6);
      placeCluster(...at(2.1, 8.5), BF.N_GOLD, 5);
      placeCluster(...at(4.2, 9), BF.N_STONE, 4);
      placeCluster(...at(1.05, 10), BF.N_TREE, 18);
      placeCluster(...at(3.15, 10.5), BF.N_TREE, 16);
      placeCluster(...at(5.25, 11), BF.N_TREE, 14);
      placeCluster(...at(2.7, 17), BF.N_GOLD, 5);
      placeCluster(...at(5.0, 16), BF.N_BERRY, 5);
    }
    const scatter = (type, clusters, count) => {
      for (let k = 0, guard = 0; k < clusters && guard < 200; guard++) {
        const x = 4 + rand() * (N - 8), y = 4 + rand() * (N - 8);
        if (nearStart(x, y, 20) || map.terrain[idx(x | 0, y | 0)] !== 0) continue;
        placeCluster(x, y, type, count);
        k++;
      }
    };
    scatter(BF.N_GOLD, 6, 6);
    scatter(BF.N_STONE, 5, 5);
    scatter(BF.N_BERRY, 5, 5);

    // Jamin kedua markas terhubung lewat darat; kalau tidak, buka jalur lurus.
    if (!reachable(map, starts[0], starts[1])) {
      const a = starts[0], b = starts[1], steps = N * 2;
      for (let k = 0; k <= steps; k++) {
        const x = Math.round(a.x + (b.x - a.x) * k / steps), y = Math.round(a.y + (b.y - a.y) * k / steps);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!BF.inBounds(x + dx, y + dy)) continue;
            const i = idx(x + dx, y + dy);
            map.terrain[i] = 0;
            if (map.node[i] === BF.N_TREE) { map.node[i] = 0; map.nodeAmt[i] = 0; }
          }
      }
    }

    BF.finishMap(map);
    return map;
  };

  // Data turunan dari terrain (garis pantai & wilayah daratan). Dipakai juga saat memuat simpanan.
  BF.finishMap = function (map) {
    map.shore.fill(0);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = idx(x, y);
        if (map.terrain[i] !== 0) continue;
        const water = (x > 0 && map.terrain[i - 1]) || (x < N - 1 && map.terrain[i + 1]) || (y > 0 && map.terrain[i - N]) || (y < N - 1 && map.terrain[i + N]);
        if (water) map.shore[i] = 1;
      }
    labelRegions(map);
  };

  BF.canPlace = function (map, type, tx, ty) {
    const size = BF.BUILDINGS[type].size;
    for (let y = ty; y < ty + size; y++)
      for (let x = tx; x < tx + size; x++) {
        if (!BF.inBounds(x, y)) return false;
        const i = idx(x, y);
        if (map.terrain[i] !== 0 || map.node[i] !== 0 || map.bld[i] !== 0) return false;
      }
    return true;
  };

  // Tile bebas terdekat dari (cx, cy), dicari per cincin.
  BF.findFreeNear = function (map, cx, cy, maxR, owner) {
    let best = null, bd = 1e9;
    for (let r = 0; r <= maxR; r++) {
      if (best && r > bd) break;
      for (let y = cy - r; y <= cy + r; y++) {
        const edgeRow = y === cy - r || y === cy + r;
        for (let x = cx - r; x <= cx + r; x += edgeRow || r === 0 ? 1 : 2 * r) {
          if (!BF.passable(map, x, y, owner)) continue;
          const d = BF.dist(x - cx, y - cy);
          if (d < bd) { bd = d; best = { x, y }; }
        }
      }
    }
    return best;
  };

  // Node sumber daya terdekat bertipe `type` yang punya tetangga kosong (bisa didatangi).
  BF.findNode = function (map, cx, cy, type, maxR, region) {
    let best = null, bd = 1e9;
    for (let r = 0; r <= maxR; r++) {
      if (best && r > bd) break;
      for (let y = cy - r; y <= cy + r; y++) {
        if (y < 0 || y >= N) continue;
        const edgeRow = y === cy - r || y === cy + r;
        for (let x = cx - r; x <= cx + r; x += edgeRow || r === 0 ? 1 : 2 * r) {
          if (x < 0 || x >= N) continue;
          const i = y * N + x;
          if (map.node[i] !== type) continue;
          if (region && map.region[i] !== region) continue;
          if (!hasFreeNeighbor(map, x, y)) continue;
          const d = BF.dist(x - cx, y - cy);
          if (d < bd) { bd = d; best = { x, y }; }
        }
      }
    }
    return best;
  };
})();
