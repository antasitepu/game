'use strict';
(function () {
  // PRNG deterministik (mulberry32) supaya peta bisa direproduksi dari seed.
  BF.makeRng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // PRNG yang state-nya disimpan di state game (s.rng) agar ikut tersimpan & sinkron di multiplayer.
  BF.rnd = function (s) {
    const a = (s.rng + 0x6d2b79f5) | 0;
    s.rng = a;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  BF.clamp = function (v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  };

  // Jarak Euclid. Sengaja memakai sqrt (hasilnya identik di semua engine JS), bukan Math.hypot,
  // karena simulasi harus deterministik untuk multiplayer lockstep.
  BF.dist = function (dx, dy) {
    return Math.sqrt(dx * dx + dy * dy);
  };

  // sin/cos dibulatkan: selisih bit terakhir antar-engine tidak boleh memengaruhi simulasi.
  BF.qcos = a => Math.round(Math.cos(a) * 1000) / 1000;
  BF.qsin = a => Math.round(Math.sin(a) * 1000) / 1000;

  BF.fmtTime = function (sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  };
})();
