'use strict';
// Input pemain: seleksi, perintah klik kanan, penempatan bangunan & tembok, kamera (geser/putar/zoom), hotkey, minimap.
// Tidak pernah mengubah state game secara langsung: semua lewat BF.issue.
(function () {
  const N = BF.MAP_SIZE, U = BF.UNITS, B = BF.BUILDINGS, idx = BF.idx, view = BF.view;
  const ui = BF.ui, hud = BF.hud;
  const TOP = 40, BOTTOM = 188, PAN = 900, MAX_WALL = 60;
  const keys = {};
  let lastClick = { id: 0, t: 0 }, lastGroup = { k: '', t: 0 }, rotating = null;

  const input = BF.input = {};
  const game = () => BF.game;
  const ping = (x, y, col) => ui.pings.push({ x, y, t: 0, col });
  const idsOf = list => list.map(e => e.id);
  const isBig = u => U[u.type].cls === 'cavalry' || U[u.type].cls === 'siege';
  // pusat area peta yang tidak tertutup bar atas / panel bawah
  const midY = () => TOP + (game().h - TOP - BOTTOM) / 2;

  // Titik tanah di tengah area pandang harus tetap berada di dalam peta.
  const clampCam = () => view.clampAt(game().w / 2, midY());

  input.centerOn = function (x, y) {
    const g = game();
    g.cam.x = x;
    g.cam.y = y;
    view.update();
    view.panPx(0, g.h / 2 - midY());      // geser agar titik itu jatuh di tengah area yang terlihat
    keepAt(g.w / 2, midY(), { x, y });      // relief bukit menggeser titik tanah di tengah layar: koreksi sampai tepat
    clampCam();
  };

  // Geser kamera sehingga titik tanah w tampil tepat di piksel (px, py). Kamera ortografik: menggeser sasaran kamera
  // menggeser semua sinar pandang sama jauhnya, jadi cukup satu langkah — samakan titik potong sinar pada bidang
  // setinggi tanah di w dengan w (tepat di lereng securam apa pun, tanpa iterasi).
  function keepAt(px, py, w) {
    const c = game().cam;
    view.update();
    const q = view.planeAt(px, py, BF.relief.at(w.x, w.y));
    c.x += w.x - q.x;
    c.y += w.y - q.y;
    view.update();
  }

  function zoomAt(px, py, factor) {
    const c = game().cam, before = view.toWorld(px, py);
    c.zoom = BF.clamp(c.zoom * factor, view.ZOOM_MIN, view.ZOOM_MAX);
    keepAt(px, py, before);                  // pertahankan titik tanah di bawah kursor
    clampCam();
  }

  // Putar kamera mengelilingi titik tanah di tengah area pandang.
  function rotateBy(da) {
    const g = game(), c = g.cam, pivot = view.toWorld(g.w / 2, midY());
    c.yaw += da;
    keepAt(g.w / 2, midY(), pivot);
    clampCam();
  }

  // Unit yang badannya berada di bawah kursor (yang paling dekat kamera bila bertumpuk).
  function pickUnit(s, mx, my) {
    const ppu = view.ppu();
    let best = null, by = -1e9;
    for (const u of s.units) {
      if (u.dead) continue;
      if (u.owner !== s.human && !s.fog.visible[idx(u.x | 0, u.y | 0)]) continue;
      const big = isBig(u), feet = view.toScreen(u.x, u.y, 0), head = view.toScreen(u.x, u.y, big ? 1.3 : 0.9);
      if (Math.abs(mx - feet.x) <= (big ? 0.5 : 0.26) * ppu && my >= head.y - 4 && my <= feet.y + 6 && feet.y > by) { by = feet.y; best = u; }
    }
    for (const a of s.animals) {                          // hewan liar (termasuk bangkai) di area yang terlihat
      if (a.dead || !s.fog.visible[idx(a.x | 0, a.y | 0)]) continue;
      const lying = a.state === 'carcass', feet = view.toScreen(a.x, a.y, 0), head = view.toScreen(a.x, a.y, lying ? 0.25 : a.type === 'deer' ? 0.8 : 0.5);
      if (Math.abs(mx - feet.x) <= 0.38 * ppu && my >= head.y - 6 && my <= feet.y + 8 && feet.y > by) { by = feet.y; best = a; }
    }
    return best;
  }

  // Apa yang ada di piksel layar itu: {x, y} titik tanah, e = unit/bangunan, node = tile sumber daya.
  function targetAt(s, mx, my) {
    const g = view.toWorld(mx, my), t = { x: g.x, y: g.y, e: pickUnit(s, mx, my), node: null };
    if (!t.e) {
      const st = view.pickStanding(s, mx, my);
      if (st && st.b) t.e = st.b;
      else if (st) t.node = { x: st.x, y: st.y };
    }
    return t;
  }

  // Sama, tetapi dari koordinat dunia (klik di minimap).
  function targetWorld(s, x, y) {
    const tx = x | 0, ty = y | 0, t = { x, y, e: null, node: null };
    if (!BF.inBounds(tx, ty)) return t;
    const i = idx(tx, ty), b = s.byId.get(s.map.bld[i]);
    if (b && !b.dead && BF.buildingSeen(s, b)) t.e = b;
    else if (s.map.node[i] && s.fog.explored[i]) t.node = { x: tx, y: ty };
    return t;
  }

  const ownUnits = s => ui.entities(s).filter(e => e.owner === s.human && e.kind === 'unit');
  const ownWorkers = s => ownUnits(s).filter(u => u.type === 'worker');

  // ---------------------------------------------------------------- perintah

  // alt: Alt + klik kanan pada bangunan sendiri yang berkapasitas = berlindung di sana.
  function command(s, t, alt) {
    const me = s.human, units = ownUnits(s);
    if (alt && units.length && t.e && t.e.kind === 'building' && t.e.owner === me && BF.bldDef(s, t.e).garrison) { garrisonAt(s, t); return; }
    if (!units.length) {
      const b = ui.entities(s)[0];
      if (b && b.kind === 'building' && b.owner === me && b.built) {
        const x = t.node ? t.node.x + 0.5 : t.x, y = t.node ? t.node.y + 0.5 : t.y;
        BF.issue({ c: 'rally', bid: b.id, x, y });
        ping(x, y, '#fde047');
        BF.audio.play('order');
      }
      return;
    }
    const workers = units.filter(u => u.type === 'worker'), army = units.filter(u => u.type !== 'worker');
    const e = t.e, move = list => { if (list.length) BF.issue({ c: 'move', ids: idsOf(list), x: t.x, y: t.y, f: ui.formation }); };
    BF.audio.play('order');
    if (e && e.kind === 'animal') {                       // buru: pekerja melempar tombak & menguliti, pasukan membunuh
      BF.issue({ c: 'hunt', ids: idsOf(units), aid: e.id });
      ping(e.x, e.y, '#fde047');
      return;
    }
    if (e && e.owner !== me) {
      if (army.length) BF.issue({ c: 'attack', ids: idsOf(army), tid: e.id });
      move(workers);
      ping(t.x, t.y, '#f87171');
      return;
    }
    // klik kanan unit sendiri yang bisa disembuhkan: para Tabib terpilih menyembuhkannya, sisanya bergerak ke sana
    const healers = e && e.kind === 'unit' && e.owner === me ? units.filter(u => BF.canHeal(s, u, e)) : [];
    if (healers.length) {
      BF.issue({ c: 'heal', ids: idsOf(healers), tid: e.id });
      move(units.filter(u => healers.indexOf(u) < 0 && u !== e));
      ping(e.x, e.y, '#4ade80');
      return;
    }
    if (e && e.kind === 'building' && workers.length) {
      const carriers = workers.filter(u => u.carry > 0), wids = idsOf(workers);
      if (!e.built) BF.issue({ c: 'build', ids: wids, bid: e.id });
      else if (e.type === 'farm') BF.issue({ c: 'farm', ids: wids, bid: e.id });
      else if (e.hp < BF.bldDef(s, e).hp) BF.issue({ c: 'repair', ids: wids, bid: e.id });          // rusak → perbaiki
      else if (B[e.type].dropoff && carriers.length) BF.issue({ c: 'dropoff', ids: idsOf(carriers), bid: e.id });
      else move(workers);
      move(army);
      ping(e.tx + e.size / 2, e.ty + e.size / 2, '#fde047');
      return;
    }
    if (workers.length && t.node) {
      BF.issue({ c: 'gather', ids: idsOf(workers), nx: t.node.x, ny: t.node.y });
      move(army);
      ping(t.node.x + 0.5, t.node.y + 0.5, '#fde047');
      return;
    }
    move(units);
    ping(t.x, t.y, '#86efac');
  }

  // Mode berlindung (tombol/tombol G): klik kiri berikutnya memilih bangunan tujuan.
  input.garrisonMode = function () {
    const s = game().s, cls = BF.GARRISON.cls;
    if (!ownUnits(s).some(u => cls.indexOf(U[u.type].cls) >= 0)) return hud.fail('Unit ini tidak bisa berlindung');
    endPlacing(false);
    ui.amove = ui.patrol = false;
    ui.garrison = true;
  };

  // Mode patroli: klik kiri pada peta menentukan ujung rute yang satunya.
  function patrolTo(s, t) {
    const us = ownUnits(s).filter(u => BF.unitDef(s, u).atk);
    ui.patrol = false;
    if (!us.length) return hud.fail('Unit ini tidak bisa berpatroli');
    BF.issue({ c: 'patrol', ids: idsOf(us), x: t.x, y: t.y });
    ping(t.x, t.y, '#93c5fd');
    BF.audio.play('order');
  }

  // Suruh unit terpilih berlindung di bangunan pada sasaran t (Balai Kota / Menara Jaga milik sendiri yang sudah jadi).
  function garrisonAt(s, t) {
    const b = t.e;
    ui.garrison = false;
    if (!b || b.kind !== 'building' || b.owner !== s.human || !b.built || !BF.bldDef(s, b).garrison) return hud.fail('Pilih Balai Kota atau Menara Jaga milikmu');
    const us = ownUnits(s).filter(u => BF.canGarrison(s, u, b));
    if (!us.length) return hud.fail('Unit ini tidak bisa berlindung');
    BF.issue({ c: 'garrison', ids: idsOf(us), bid: b.id });
    ping(b.tx + b.size / 2, b.ty + b.size / 2, '#93c5fd');
    BF.audio.play('order');
  }

  function attackMove(s, t) {
    const ids = idsOf(ownUnits(s));
    if (t.e && t.e.owner !== s.human) BF.issue({ c: 'attack', ids, tid: t.e.id });
    else BF.issue({ c: 'move', ids, x: t.x, y: t.y, attack: true, f: ui.formation });
    ping(t.x, t.y, '#f87171');
    BF.audio.play('order');
    ui.amove = false;
  }

  // ---------------------------------------------------------------- penempatan

  const explored = (s, x, y) => BF.inBounds(x, y) && !!s.fog.explored[idx(x, y)];

  function ghostAt(s, wx, wy) {
    const type = ui.placing, size = B[type].size;
    const tx = Math.floor(wx - size / 2 + 0.5), ty = Math.floor(wy - size / 2 + 0.5);
    let ok = BF.placeable(s, s.human, type, tx, ty);
    for (let y = ty; ok && y < ty + size; y++)
      for (let x = tx; x < tx + size; x++) if (!explored(s, x, y)) { ok = false; break; }
    return { type, tx, ty, ok };
  }

  // Garis tembok 4-arah (tanpa langkah diagonal) dari tile awal ke tile kursor.
  function wallLine(a, b) {
    const out = [[a.x, a.y]];
    let x = a.x, y = a.y, ix = 0, iy = 0;
    const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y), sx = b.x > a.x ? 1 : -1, sy = b.y > a.y ? 1 : -1;
    while ((ix < dx || iy < dy) && out.length < MAX_WALL) {
      // Melangkah di sumbu yang paling tertinggal dari garis lurus ideal.
      if (iy >= dy || (ix < dx && (ix + 0.5) / dx <= (iy + 0.5) / dy)) { x += sx; ix++; } else { y += sy; iy++; }
      out.push([x, y]);
    }
    return out;
  }

  function wallGhosts(s, wx, wy) {
    const p = s.players[s.human], cost = p.B.wall.cost.stone;
    const tiles = wallLine(ui.wallStart, { x: Math.floor(wx), y: Math.floor(wy) });
    const set = new Set(tiles.map(t => t[0] + ',' + t[1]));
    let budget = Math.floor(p.res.stone / cost);
    return tiles.map(t => {
      const ok = BF.placeable(s, s.human, 'wall', t[0], t[1]) && explored(s, t[0], t[1]) && budget-- > 0;
      const links = (set.has(t[0] + ',' + (t[1] - 1)) ? 1 : 0) | (set.has((t[0] + 1) + ',' + t[1]) ? 2 : 0) |
        (set.has(t[0] + ',' + (t[1] + 1)) ? 4 : 0) | (set.has((t[0] - 1) + ',' + t[1]) ? 8 : 0);
      return { type: 'wall', tx: t[0], ty: t[1], ok, links };
    });
  }

  function endPlacing(keep) {
    ui.wallStart = null;
    if (!keep) { ui.placing = null; ui.ghosts = []; }
  }

  function place(s, keep) {
    const g = ui.ghosts[0], p = s.players[s.human];
    if (!g) return;
    if (!g.ok) { hud.fail(hud.ERR.place); return; }
    if (!BF.canAfford(p, p.B[g.type].cost)) { hud.fail(hud.ERR.res); return; }
    BF.issue({ c: 'place', type: g.type, tx: g.tx, ty: g.ty, ids: idsOf(ownWorkers(s)) });
    BF.audio.play('place');
    endPlacing(keep);
  }

  function placeWall(s, keep) {
    const tiles = ui.ghosts.filter(g => g.ok).map(g => [g.tx, g.ty]), p = s.players[s.human];
    if (!tiles.length) { hud.fail(ui.ghosts.length && !BF.canAfford(p, p.B.wall.cost) ? hud.ERR.res : hud.ERR.place); ui.wallStart = null; return; }
    BF.issue({ c: 'wall', tiles, ids: idsOf(ownWorkers(s)) });
    BF.audio.play('place');
    endPlacing(keep);
  }

  // ---------------------------------------------------------------- seleksi

  function clickSelect(s, mx, my, shift) {
    const e = targetAt(s, mx, my).e, now = performance.now();
    if (!e) { if (!shift) ui.select([]); return; }
    BF.audio.play('select');
    if (e.kind === 'unit' && e.owner === s.human && lastClick.id === e.id && now - lastClick.t < 350) {
      // klik ganda: pilih semua unit sejenis di layar
      const g = game();
      ui.select(idsOf(s.units.filter(u => {
        if (u.owner !== s.human || u.type !== e.type) return false;
        const p = view.toScreen(u.x, u.y, 0.4);
        return p.x >= 0 && p.x <= g.w && p.y >= TOP && p.y <= g.h - BOTTOM + 40;
      })));
    } else if (shift && e.owner === s.human && e.kind === 'unit') {
      const i = ui.sel.indexOf(e.id);
      ui.select(i < 0 ? ui.sel.concat(e.id) : ui.sel.filter(id => id !== e.id));
    } else ui.select([e.id]);
    lastClick = { id: e.id, t: now };
  }

  // Seleksi kotak bekerja di ruang layar: unit terpilih bila badannya berada di dalam kotak.
  function boxSelect(s, d, shift) {
    const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
    const ids = idsOf(s.units.filter(u => {
      if (u.owner !== s.human || u.dead) return false;
      const p = view.toScreen(u.x, u.y, 0.4);
      return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
    }));
    if (ids.length) BF.audio.play('select');
    if (shift) ui.select(ui.sel.concat(ids.filter(id => ui.sel.indexOf(id) < 0)));
    else ui.select(ids);
  }

  // ---------------------------------------------------------------- shortcut

  function selectTownhall(s) {
    const th = s.buildings.find(b => b.owner === s.human && b.type === 'townhall' && !b.dead);
    if (!th) return;
    ui.select([th.id]);
    input.centerOn(th.tx + 1.5, th.ty + 1.5);
  }

  input.nextIdleWorker = function () {
    const s = game().s;
    if (!s) return;
    const idle = s.units.filter(u => u.owner === s.human && u.type === 'worker' && u.order.type === 'idle');
    if (!idle.length) { hud.toast('Tidak ada pekerja menganggur'); return; }
    const cur = idle.findIndex(u => u.id === ui.sel[0]), u = idle[(cur + 1) % idle.length];
    ui.select([u.id]);
    input.centerOn(u.x, u.y);
  };

  function group(s, k, assign) {
    if (assign) { ui.groups[k] = ui.sel.slice(); hud.toast('Grup ' + k + ' disimpan'); return; }
    const ids = (ui.groups[k] || []).filter(id => s.byId.has(id));
    if (!ids.length) return;
    ui.select(ids);
    const now = performance.now();
    if (lastGroup.k === k && now - lastGroup.t < 400) { const e = s.byId.get(ids[0]); input.centerOn(e.kind === 'unit' ? e.x : e.tx + 1, e.kind === 'unit' ? e.y : e.ty + 1); }
    lastGroup = { k, t: now };
  }

  function onKey(e) {
    const g = game(), s = g.s;
    if (!s || !g.running || g.menuOpen) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.key.indexOf('Arrow') === 0) { keys[e.key] = true; e.preventDefault(); return; }
    if (e.key === '[' || e.key === ']') { rotateBy(e.key === '[' ? Math.PI / 8 : -Math.PI / 8); return; }
    if (e.key === 'Home') { rotateBy(view.YAW_DEFAULT - g.cam.yaw); return; }
    if (e.repeat) return;
    const digit = /^Digit[0-9]$/.test(e.code) ? e.code.slice(5) : '';
    if (digit) { group(s, digit, e.ctrlKey || e.altKey); e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case 'Escape':
        if (ui.placing || ui.amove || ui.garrison || ui.patrol) { endPlacing(false); ui.amove = ui.garrison = ui.patrol = false; }
        else if (ui.sel.length) ui.select([]);
        else BF.menu.openGameMenu();
        return;
      case 'Delete': case 'Backspace': {
        const ids = idsOf(ui.entities(s).filter(en => en.owner === s.human));
        if (ids.length) BF.issue({ c: 'destroy', ids });
        e.preventDefault();
        return;
      }
      case ' ': {
        const en = ui.entities(s)[0];
        if (en) input.centerOn(en.kind === 'unit' ? en.x : en.tx + en.size / 2, en.kind === 'unit' ? en.y : en.ty + en.size / 2);
        e.preventDefault();
        return;
      }
      case '.': input.nextIdleWorker(); return;
      case 'h': case 'H': selectTownhall(s); return;
      case 'g': case 'G': if (ownUnits(s).length) { input.garrisonMode(); return; } break;      // bangunan terpilih: tombol "Keluarkan semua"
      case 'p': case 'P': g.togglePause(); return;
    }
    if (e.key.length === 1 && hud.pressKey(e.key.toUpperCase())) e.preventDefault();
  }

  // ---------------------------------------------------------------- per frame

  input.update = function (dt) {
    const g = game(), s = g.s, m = ui.mouse;
    let dx = 0, dy = 0;
    if (keys.ArrowLeft) dx--;
    if (keys.ArrowRight) dx++;
    if (keys.ArrowUp) dy--;
    if (keys.ArrowDown) dy++;
    if (m.inside && document.hasFocus() && !g.menuOpen && !rotating) {
      if (m.x < 6) dx--; else if (m.x > g.w - 6) dx++;
      if (m.y < 6) dy--; else if (m.y > g.h - 6) dy++;
    }
    view.update();
    if (dx || dy) { view.panPx(dx * PAN * dt, dy * PAN * dt); clampCam(); }
    for (const p of ui.pings) p.t += dt;
    if (ui.pings.length && ui.pings[0].t > 0.5) ui.pings = ui.pings.filter(p => p.t <= 0.5);
    const w = view.toWorld(m.x, m.y);
    if (!ui.placing) ui.ghosts = [];
    else if (ui.wallStart) ui.ghosts = wallGhosts(s, w.x, w.y);
    else ui.ghosts = m.onMap ? [ghostAt(s, w.x, w.y)] : [];
    g.canvas.style.cursor = rotating ? 'grabbing' : ui.placing ? 'copy' : ui.amove || ui.patrol ? 'crosshair' : ui.garrison ? 'alias' : 'default';
  };

  input.init = function (canvas, minimap) {
    canvas.addEventListener('mousedown', e => {
      const g = game(), s = g.s;
      if (!s || !g.running || s.over) return;
      view.update();
      const w = view.toWorld(e.clientX, e.clientY);
      if (e.button === 1) { rotating = { x: e.clientX }; e.preventDefault(); return; }
      if (e.button === 0) {
        if (ui.placing === 'wall') { ui.wallStart = { x: Math.floor(w.x), y: Math.floor(w.y) }; ui.ghosts = wallGhosts(s, w.x, w.y); }
        else if (ui.placing) { ui.ghosts = [ghostAt(s, w.x, w.y)]; place(s, e.shiftKey); }
        else if (ui.amove) attackMove(s, targetAt(s, e.clientX, e.clientY));
        else if (ui.garrison) garrisonAt(s, targetAt(s, e.clientX, e.clientY));
        else if (ui.patrol) patrolTo(s, w);
        else ui.drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
      } else if (e.button === 2) {
        if (ui.placing || ui.amove || ui.garrison || ui.patrol) { endPlacing(false); ui.amove = ui.garrison = ui.patrol = false; }
        else command(s, targetAt(s, e.clientX, e.clientY), e.altKey);
      }
    });
    canvas.addEventListener('wheel', e => {
      const g = game();
      if (!g.s || !g.running || g.menuOpen) return;
      e.preventDefault();
      view.update();
      zoomAt(e.clientX, e.clientY, Math.exp(BF.clamp(e.deltaY, -120, 120) * 0.0016));
    }, { passive: false });
    window.addEventListener('mousemove', e => {
      const m = ui.mouse;
      m.x = e.clientX; m.y = e.clientY; m.inside = true; m.onMap = e.target === canvas;
      if (ui.drag) { ui.drag.x1 = e.clientX; ui.drag.y1 = e.clientY; }
      if (rotating) { view.update(); rotateBy((e.clientX - rotating.x) * 0.006); rotating.x = e.clientX; }
    });
    window.addEventListener('mouseup', e => {
      const s = game().s, d = ui.drag;
      if (e.button === 1) { rotating = null; return; }
      if (e.button !== 0 || !s) return;
      view.update();
      if (ui.wallStart) {
        const w = view.toWorld(e.clientX, e.clientY);
        ui.ghosts = wallGhosts(s, w.x, w.y);
        placeWall(s, e.shiftKey);
        return;
      }
      if (!d) return;
      ui.drag = null;
      if (Math.abs(d.x1 - d.x0) > 4 || Math.abs(d.y1 - d.y0) > 4) boxSelect(s, d, e.shiftKey);
      else clickSelect(s, d.x0, d.y0, e.shiftKey);
    });
    document.addEventListener('mouseleave', () => { ui.mouse.inside = false; });
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; ui.mouse.inside = false; rotating = null; });
    window.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', e => { keys[e.key] = false; });

    // minimap (utara di atas): kiri = pindah kamera, kanan = perintah ke lokasi itu
    let panning = false;
    const mmWorld = e => {
      const r = minimap.getBoundingClientRect();
      return { x: BF.clamp((e.clientX - r.left) / r.width, 0, 1) * (N - 0.01), y: BF.clamp((e.clientY - r.top) / r.height, 0, 1) * (N - 0.01) };
    };
    minimap.addEventListener('mousedown', e => {
      const s = game().s;
      if (!s || s.over) return;
      const w = mmWorld(e);
      if (e.button === 0) { panning = true; input.centerOn(w.x, w.y); }
      else if (e.button === 2) command(s, targetWorld(s, w.x, w.y));
    });
    window.addEventListener('mousemove', e => { if (panning) { const w = mmWorld(e); input.centerOn(w.x, w.y); } });
    window.addEventListener('mouseup', () => { panning = false; });
  };
})();
