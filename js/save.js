'use strict';
// Simpan/muat: snapshot seluruh state game ke objek JSON, disimpan di localStorage browser.
(function () {
  const N = BF.MAP_SIZE, NN = N * N;
  const KEY = { manual: 'bf.save.manual', auto: 'bf.save.auto' };

  function b64(arr) {
    const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    let out = '';
    for (let i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(out);
  }
  function unb64(str, Type) {
    const bin = atob(str), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const arr = new Type(u8.buffer);
    if (arr.length !== NN) throw new Error('Ukuran data peta tidak cocok');
    return arr;
  }

  // State → objek polos yang aman untuk JSON.stringify.
  BF.serialize = function (s) {
    const m = s.map;
    return {
      v: BF.SAVE_VERSION, seed: s.seed, tick: s.tick, nextId: s.nextId, rng: s.rng,
      human: s.human, difficulty: s.difficulty, over: s.over, winner: s.winner, market: s.market,
      map: { terrain: b64(m.terrain), node: b64(m.node), nodeAmt: b64(m.nodeAmt), block: b64(m.block), bld: b64(m.bld), variant: b64(m.variant), starts: m.starts },
      explored: b64(s.fog.explored),
      // p.U / p.B / p.mod adalah data turunan: dibangun ulang saat dimuat.
      players: s.players.map(p => { const o = Object.assign({}, p); delete o.U; delete o.B; delete o.mod; return o; }),
      units: s.units.filter(u => !u.dead),
      buildings: s.buildings.filter(b => !b.dead),
      animals: s.animals.filter(a => !a.dead),
      projectiles: s.projectiles,
    };
  };

  BF.deserialize = function (d) {
    if (!d || d.v !== BF.SAVE_VERSION) throw new Error('Versi simpanan tidak didukung');
    const map = {
      size: N,
      terrain: unb64(d.map.terrain, Uint8Array), node: unb64(d.map.node, Uint8Array), nodeAmt: unb64(d.map.nodeAmt, Uint16Array),
      block: unb64(d.map.block, Uint8Array), bld: unb64(d.map.bld, Int32Array), variant: unb64(d.map.variant, Uint8Array),
      shore: new Uint8Array(NN), region: new Int16Array(NN), starts: d.map.starts, version: 1,
    };
    BF.finishMap(map);
    const s = {
      seed: d.seed, map, tick: d.tick, nextId: d.nextId, rng: d.rng,
      units: d.units, buildings: d.buildings, animals: d.animals || [], projectiles: d.projectiles, effects: [], events: [],
      byId: new Map(), players: d.players, human: d.human, over: d.over, winner: d.winner, hasDead: false,
      difficulty: d.difficulty, mp: false,
      fog: { explored: unb64(d.explored, Uint8Array), visible: new Uint8Array(NN), version: 0 },
      market: Object.assign({}, BF.MARKET.base, d.market),          // simpanan lama: harga dasar
    };
    for (const p of s.players) {
      if (!BF.FACTIONS[p.faction]) throw new Error('Wangsa tidak dikenal di simpanan');
      BF.rebuildDefs(p);
    }
    for (const u of s.units) s.byId.set(u.id, u);
    for (const b of s.buildings) { s.byId.set(b.id, b); if (!b.inside) b.inside = []; }      // simpanan lama: belum ada yang berlindung
    for (const a of s.animals) s.byId.set(a.id, a);
    BF.updateFog(s);
    return s;
  };

  // Akses localStorage. Semua fungsi aman dipanggil walau storage tidak tersedia/penuh.
  BF.save = {
    write(slot, s) {
      try {
        const p = s.players[s.human];
        const meta = { time: Date.now(), tick: s.tick, faction: p.faction, foe: s.players[1 - s.human].faction, difficulty: s.difficulty, era: p.era };
        localStorage.setItem(KEY[slot], JSON.stringify({ meta, data: BF.serialize(s) }));
        return true;
      } catch (e) { return false; }
    },
    meta(slot) {
      try {
        const raw = localStorage.getItem(KEY[slot]);
        return raw ? JSON.parse(raw).meta : null;
      } catch (e) { return null; }
    },
    // Return state, atau null bila tidak ada / rusak.
    read(slot) {
      try {
        const raw = localStorage.getItem(KEY[slot]);
        return raw ? BF.deserialize(JSON.parse(raw).data) : null;
      } catch (e) { return null; }
    },
  };
})();
