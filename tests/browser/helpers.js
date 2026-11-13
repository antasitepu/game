'use strict';
// Potongan JavaScript yang dievaluasi DI DALAM halaman game oleh skenario tes.
// Semuanya menghasilkan koordinat layar (piksel) lewat kamera 3D BF.view, jadi tetap benar saat kamera diputar/zoom.

// Area peta yang aman diklik (tidak tertutup bar atas / panel bawah).
const SAFE = '(q => q.x > 24 && q.x < 1256 && q.y > 70 && q.y < 585)';

module.exports = {
  // Kotak seleksi yang melingkupi badan semua pekerja milik `owner`.
  workersBox: owner => `(() => { const s = BF.game.s, w = s.units.filter(u => u.owner === ${owner} && u.type === 'worker').map(u => BF.view.toScreen(u.x, u.y, 0.4)); return { x0: Math.min(...w.map(q => q.x)) - 26, y0: Math.min(...w.map(q => q.y)) - 26, x1: Math.max(...w.map(q => q.x)) + 26, y1: Math.max(...w.map(q => q.y)) + 26 }; })()`,

  // Titik di badan unit dengan id hasil ekspresi `idExpr`.
  unitPoint: idExpr => `(() => { const u = BF.game.s.byId.get(${idExpr}); return BF.view.toScreen(u.x, u.y, 0.45); })()`,

  // Titik di badan bangunan `expr` yang kena bangunan itu dan tidak tertutup unit/hewan mana pun (peta acak: bisa ada
  // yang berdiri di depannya). Kamera tidak digeser. null bila tidak ada.
  freePoint: expr => `(() => { const s = BF.game.s, b = ${expr}, V = BF.view, k = V.ppu(), c = b.size / 2; for (const f of [0.6, 0.75, 0.9, 0.45, 0.3]) for (const dx of [0, -0.2 * b.size, 0.2 * b.size]) { const q = V.toScreen(b.tx + c + dx, b.ty + c - dx, V.BUILD_H[b.type] * f); const r = V.pickStanding(s, q.x, q.y); if (!r || r.b !== b) continue; const hit = s.units.concat(s.animals).some(u => { const a = V.toScreen(u.x, u.y, 0), t = V.toScreen(u.x, u.y, 1.4); return Math.abs(q.x - a.x) < 0.6 * k && q.y > t.y - 8 && q.y < a.y + 10; }); if (!hit) return q; } return null; })()`,

  // Titik di badan bangunan hasil ekspresi `expr` (kamera dipusatkan dulu ke bangunan itu). frac = bagian tinggi bangunan.
  buildingPoint: (expr, frac) => `new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => { const b = ${expr}; if (!b) return res(null); BF.input.centerOn(b.tx + b.size / 2, b.ty + b.size / 2); res(BF.view.toScreen(b.tx + b.size / 2, b.ty + b.size / 2, BF.view.BUILD_H[b.type] * ${frac || 0.4})); })))`,

  // Node sumber daya bertipe `type` terdekat dari Balai Kota `owner` yang benar-benar bisa diklik
  // (tidak tertutup objek lain di depannya dan berada di area aman).
  node: (type, owner) => `(() => { const s = BF.game.s, th = s.buildings.find(b => b.owner === ${owner}), safe = ${SAFE}; let best = null, bd = 1e9; for (let y = th.ty - 16; y < th.ty + 18; y++) for (let x = th.tx - 16; x < th.tx + 18; x++) { if (!BF.inBounds(x, y)) continue; const i = BF.idx(x, y); if (s.map.node[i] !== ${type} || !s.fog.explored[i]) continue; const q = BF.view.toScreen(x + 0.5, y + 0.5, BF.view.NODE_H[${type}] * 0.5); if (!safe(q)) continue; const r = BF.view.pickStanding(s, q.x, q.y); if (!r || r.node !== ${type}) continue; const d = Math.hypot(x - th.tx, y - th.ty); if (d < bd) { bd = d; best = { x: q.x, y: q.y, tx: r.x, ty: r.y }; } } return best; })()`,

  // Hingga `n` tapak kosong (tidak saling tumpang-tindih) untuk bangunan `type` di dekat Balai Kota `owner`.
  spots: (type, owner, n) => `(() => { const s = BF.game.s, th = s.buildings.find(b => b.owner === ${owner}), size = BF.BUILDINGS['${type}'].size, safe = ${SAFE}, out = []; for (let r = 3; r < 11 && out.length < ${n}; r++) for (let dy = -r; dy <= r && out.length < ${n}; dy++) for (let dx = -r; dx <= r && out.length < ${n}; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; const tx = th.tx + dx, ty = th.ty + dy; if (!BF.canPlace(s.map, '${type}', tx, ty)) continue; let ok = true; for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) if (!s.fog.explored[BF.idx(x, y)]) ok = false; if (!ok || out.some(o => Math.abs(o.tx - tx) < size + 1 && Math.abs(o.ty - ty) < size + 1)) continue; const q = BF.view.toScreen(tx + size / 2, ty + size / 2, 0); if (safe(q)) out.push({ x: q.x, y: q.y, tx, ty }); } return out; })()`,

  // Posisi suatu titik dunia di minimap (tampak atas, utara di atas).
  minimapPoint: (xExpr, yExpr) => `(() => { const r = document.getElementById('minimap').getBoundingClientRect(), x = ${xExpr}, y = ${yExpr}; return { x: r.left + x / 96 * r.width, y: r.top + y / 96 * r.height }; })()`,

  // Titik tanah di tengah area peta yang terlihat.
  viewCenter: `BF.view.toWorld(640, 40 + (800 - 228) / 2)`,
};
