'use strict';
// Ikon teknologi 2D (kotak 40×40) untuk tombol riset.
(function () {
  const TAU = Math.PI * 2, OL = 'rgba(24,16,8,.62)';
  function oval(g, x, y, rx, ry, fill) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fillStyle = fill; g.fill(); }
  function circle(g, x, y, r, fill, stroke) { g.beginPath(); g.arc(x, y, r, 0, TAU); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); } }
  function line(g, x0, y0, x1, y1, col, lw) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokeStyle = col; g.lineWidth = lw || 1; g.stroke(); }
  function shape(g, pts, fill, stroke, lw) {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || 1; g.lineJoin = 'round'; g.stroke(); }
  }

  const TECH_ART = {
    kapak: 'axe', bajak: 'wheat', beliung: 'pick', gerobak: 'cart', tukang: 'bricks',
    tempa: 'sword', tempa2: 'sword', zirah: 'shield', zirah2: 'shield', panah: 'arrow', panah2: 'arrow',
  };
  BF.techIcon = function (g, key) {
    const hi = key.slice(-1) === '2', metal = hi ? '#f4cf47' : '#e3e7ec', wood = '#8a5a2b';
    switch (TECH_ART[key]) {
      case 'axe':
        line(g, 12, 32, 27, 9, wood, 3);
        shape(g, [[22, 7], [34, 9], [31, 21], [24, 16]], metal, OL);
        break;
      case 'pick':
        line(g, 11, 33, 27, 11, wood, 3);
        g.beginPath(); g.moveTo(14, 12); g.quadraticCurveTo(28, 2, 36, 18);
        g.strokeStyle = metal; g.lineWidth = 3.5; g.stroke();
        break;
      case 'wheat':
        for (const x of [12, 20, 28]) {
          line(g, x, 34, x, 12, '#b98a2e', 2);
          for (let y = 12; y < 26; y += 4) { oval(g, x - 3, y, 2.6, 1.6, '#f4cf47'); oval(g, x + 3, y, 2.6, 1.6, '#f4cf47'); }
        }
        break;
      case 'cart':
        shape(g, [[8, 13], [30, 13], [30, 25], [8, 25]], wood, OL);
        line(g, 30, 19, 36, 12, wood, 2.5);
        circle(g, 17, 28, 6, '#3a2a18', OL);
        circle(g, 17, 28, 2, '#c9a45c');
        break;
      case 'bricks':
        for (const [x, y] of [[6, 24], [21, 24], [13, 15], [28, 15], [6, 6], [21, 6]]) shape(g, [[x, y], [x + 13, y], [x + 13, y + 8], [x, y + 8]], '#b9b2a4', '#5f594d');
        break;
      case 'sword':
        line(g, 10, 31, 30, 9, metal, 4);
        line(g, 11, 22, 19, 30, '#c9a45c', 3);
        line(g, 7, 34, 11, 30, wood, 3.5);
        break;
      case 'shield':
        shape(g, [[20, 5], [33, 10], [31, 24], [20, 35], [9, 24], [7, 10]], metal, OL, 1.5);
        line(g, 20, 8, 20, 32, 'rgba(0,0,0,.3)', 1.5);
        break;
      case 'arrow':
        line(g, 8, 32, 29, 11, wood, 2.5);
        shape(g, [[34, 6], [31, 17], [23, 9]], metal, OL);
        line(g, 8, 32, 6, 26, '#f4f1e8', 2);
        line(g, 8, 32, 14, 34, '#f4f1e8', 2);
        break;
    }
    if (hi) { g.fillStyle = '#f4cf47'; g.font = 'bold 12px system-ui, sans-serif'; g.fillText('II', 27, 36); }
  };
})();
