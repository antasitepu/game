'use strict';
// A* 8-arah di atas grid. Tujuan berupa persegi + jangkauan (Chebyshev), sehingga satu fungsi
// melayani "ke tile X", "ke samping pohon", dan "ke samping bangunan".
(function () {
  const N = BF.MAP_SIZE, NN = N * N;
  const g = new Float32Array(NN), f = new Float32Array(NN), hv = new Float32Array(NN);
  const from = new Int32Array(NN);
  const seen = new Uint32Array(NN), closed = new Uint32Array(NN);
  const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
  const heap = [];
  let sid = 0;

  function push(i) {
    let c = heap.length;
    heap.push(i);
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (f[heap[p]] <= f[i]) break;
      heap[c] = heap[p];
      c = p;
    }
    heap[c] = i;
  }

  function pop() {
    const top = heap[0], last = heap.pop(), n = heap.length;
    if (n) {
      let c = 0;
      for (;;) {
        let k = c * 2 + 1;
        if (k >= n) break;
        if (k + 1 < n && f[heap[k + 1]] < f[heap[k]]) k++;
        if (f[heap[k]] >= f[last]) break;
        heap[c] = heap[k];
        c = k;
      }
      heap[c] = last;
    }
    return top;
  }

  function build(end, start, partial) {
    const pts = [];
    for (let c = end; c !== start && c >= 0; c = from[c]) pts.push({ x: (c % N) + 0.5, y: ((c / N) | 0) + 0.5 });
    pts.reverse();
    return { pts, partial };
  }

  // goal: {x0, y0, x1, y1, range}. Mengembalikan {pts, partial}; partial = tujuan tak terjangkau,
  // jalur berakhir di tile terdekat yang bisa dicapai.
  BF.findPath = function (map, sx, sy, goal, owner) {
    const gate = owner === undefined ? -1 : owner + 2; // nilai block gerbang milik sendiri
    sx = BF.clamp(sx, 0, N - 1);
    sy = BF.clamp(sy, 0, N - 1);
    const gx0 = goal.x0 - goal.range, gy0 = goal.y0 - goal.range, gx1 = goal.x1 + goal.range, gy1 = goal.y1 + goal.range;
    const h = (x, y) => {
      const dx = x < gx0 ? gx0 - x : x > gx1 ? x - gx1 : 0;
      const dy = y < gy0 ? gy0 - y : y > gy1 ? y - gy1 : 0;
      return dx > dy ? dx + 0.4142 * dy : dy + 0.4142 * dx;
    };
    const terrain = map.terrain, node = map.node, block = map.block;
    sid++;
    heap.length = 0;
    const start = sy * N + sx;
    g[start] = 0;
    hv[start] = h(sx, sy);
    f[start] = hv[start];
    from[start] = -1;
    seen[start] = sid;
    push(start);
    let best = start, bestH = hv[start];
    while (heap.length) {
      const cur = pop();
      if (closed[cur] === sid) continue;
      closed[cur] = sid;
      if (hv[cur] === 0) return build(cur, start, false);
      const cx = cur % N, cy = (cur / N) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k], ny = cy + DY[k];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const ni = ny * N + nx;
        if (terrain[ni] !== 0 || node[ni] !== 0 || (block[ni] !== 0 && block[ni] !== gate) || closed[ni] === sid) continue;
        if (k >= 4) {
          // Diagonal tidak boleh memotong sudut tile yang terhalang.
          const a = cy * N + nx, b = ny * N + cx;
          if (terrain[a] !== 0 || node[a] !== 0 || (block[a] !== 0 && block[a] !== gate) ||
            terrain[b] !== 0 || node[b] !== 0 || (block[b] !== 0 && block[b] !== gate)) continue;
        }
        const ng = g[cur] + (k < 4 ? 1 : 1.4142);
        if (seen[ni] !== sid || ng < g[ni]) {
          seen[ni] = sid;
          g[ni] = ng;
          const hn = h(nx, ny);
          hv[ni] = hn;
          f[ni] = ng + hn;
          from[ni] = cur;
          push(ni);
          if (hn < bestH) { bestH = hn; best = ni; }
        }
      }
    }
    return build(best, start, true);
  };
})();
