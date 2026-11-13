'use strict';
// Menu & overlay: layar awal (lawan AI / multiplayer), lobi, menu dalam permainan, simpan/muat.
(function () {
  const $ = id => document.getElementById(id);
  const show = (id, on) => $(id).classList.toggle('hidden', !on);
  const net = BF.net, audio = BF.audio;
  const menu = BF.menu = { mode: 'ai', faction: 'samudra', foe: 'random', foes: 1, difficulty: 'normal', inLobby: false, peers: {}, peerHere: false, peer: null, wasPaused: false };
  const game = () => BF.game;
  const fkeys = Object.keys(BF.FACTIONS);

  // ---------------------------------------------------------------- layar awal

  function renderFactions() {
    const box = $('factions');
    box.textContent = '';
    for (const k of fkeys) {
      const f = BF.FACTIONS[k], b = document.createElement('button');
      b.className = 'faction' + (k === menu.faction ? ' on' : '');
      b.innerHTML = `<b>${f.name.replace('Wangsa ', '')}</b><small>${f.tag}</small>`;
      b.addEventListener('click', () => {
        menu.faction = k;
        renderFactions();
        if (menu.inLobby) { net.send({ k: 'hello', faction: k }); renderLobby(); }
      });
      box.appendChild(b);
    }
    const f = BF.FACTIONS[menu.faction];
    $('faction-info').innerHTML = f.bonus.map(t => `<span>${t}</span>`).join('');
  }

  function setMode(mode) {
    menu.mode = mode;
    for (const b of $('mode-tabs').children) b.classList.toggle('on', b.dataset.mode === mode);
    show('panel-ai', mode === 'ai');
    show('panel-mp', mode === 'mp');
    if (mode === 'ai' && (net.ws || menu.inLobby)) mpReset('');
  }

  const ago = t => {
    const m = Math.max(0, Math.round((Date.now() - t) / 60000));
    return m < 1 ? 'baru saja' : m < 60 ? m + ' menit lalu' : m < 1440 ? Math.round(m / 60) + ' jam lalu' : Math.round(m / 1440) + ' hari lalu';
  };
  const describe = m => `${BF.FACTIONS[m.faction] ? BF.FACTIONS[m.faction].name : '?'} · ${BF.ERAS[m.era] ? BF.ERAS[m.era].name : ''} · menit ke-${Math.floor(m.tick / 1200)} · ${ago(m.time)}`;

  // Simpanan terbaru di antara slot manual & otomatis.
  function latestSave() {
    const a = BF.save.meta('manual'), b = BF.save.meta('auto');
    if (!a && !b) return null;
    return !b || (a && a.time >= b.time) ? { slot: 'manual', meta: a } : { slot: 'auto', meta: b };
  }

  menu.refresh = function () {
    const l = latestSave();
    show('btn-continue', !!l);
    if (l) $('btn-continue').textContent = 'Lanjutkan: ' + describe(l.meta);
  };

  function load(slot) {
    const st = BF.save.read(slot);
    if (!st) return false;
    game().start({ state: st });
    return true;
  }

  // Satu lawan: wangsanya bisa dipilih. Dua atau tiga lawan: wangsa lawan diacak tanpa kembar (semua lawan semua).
  function startAI() {
    const others = fkeys.filter(k => k !== menu.faction);
    if (menu.foes > 1) {
      for (let i = others.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0, t = others[i]; others[i] = others[j]; others[j] = t; }
      game().start({ difficulty: menu.difficulty, players: menu.foes + 1, factions: [menu.faction].concat(others.slice(0, menu.foes)) });
      return;
    }
    const foe = menu.foe === 'random' ? others[(Math.random() * others.length) | 0] : menu.foe;
    game().start({ difficulty: menu.difficulty, factions: [menu.faction, foe] });
  }

  menu.toStart = function () {
    game().stop();
    net.close();
    mpReset('');
    for (const id of ['overlay-end', 'overlay-menu', 'overlay-help']) show(id, false);
    show('overlay-start', true);
    menu.refresh();
  };

  // ---------------------------------------------------------------- multiplayer: lobi

  function mpStatus(msg, bad) {
    const el = $('mp-status');
    el.textContent = msg || '';
    el.classList.toggle('bad', !!bad);
  }

  // menu.peers: pemain lain di lobi, slot → wangsa (null selama belum memperkenalkan diri). peerHere / peer: ringkasannya
  // untuk lobi dua pemain (ada pemain lain? wangsa pemain lain yang pertama).
  function setPeers(peers) {
    const ks = Object.keys(peers);
    menu.peers = peers;
    menu.peerHere = ks.length > 0;
    menu.peer = ks.length ? peers[ks[0]] : null;
  }
  // Slot-slot yang ada di lobi (termasuk kita), urut naik: urutan ini menjadi id pemain dan warnanya di permainan.
  const lobbyOrder = () => [net.slot].concat(Object.keys(menu.peers).map(Number)).sort((a, b) => a - b);

  function mpReset(msg, bad) {
    net.close();
    menu.inLobby = false;
    setPeers({});
    show('mp-connect', true);
    show('mp-lobby', false);
    mpStatus(msg, bad);
  }

  function renderLobby() {
    const order = lobbyOrder();
    let html = '';
    order.forEach((slot, i) => {
      const c = BF.SLOTS[i], me = slot === net.slot, f = me ? menu.faction : menu.peers[slot];
      html += `<div><i style="background:${c.color}"></i>${me ? 'Kamu' : 'Lawan'} (${c.label})${slot === 0 ? ' · tuan rumah' : ''}<b>${f ? BF.FACTIONS[f].name : '…'}</b></div>`;
    });
    for (let i = order.length; i < BF.SLOTS.length; i++) html += `<div class="empty"><i style="background:${BF.SLOTS[i].color}"></i>Kursi kosong (${BF.SLOTS[i].label})<b>menunggu…</b></div>`;
    $('mp-room').textContent = net.code;
    $('mp-players').innerHTML = html;
    show('mp-start', net.slot === 0);
    $('mp-start').disabled = !(order.length >= 2 && order.every(s => s === net.slot || menu.peers[s]));
  }

  // order: slot-slot yang ikut bermain (urut = id pemain); factions: wangsa tiap pemain menurut urutan itu.
  function startMp(seed, order, factions) {
    menu.inLobby = false;
    net.begin(order);
    game().start({ mp: true, seed, factions, players: order.length, human: net.pid });
  }

  // Lawan keluar / koneksi putus di tengah permainan.
  function endMp(note, win) {
    const s = game().s;
    s.over = true;
    s.winner = win ? s.human : -1;
    BF.hud.endNote = note;
    BF.hud.showEnd(s);
    audio.play(win ? 'win' : 'error');
    net.close();
  }

  // from: slot pengirim (hanya untuk 'msg'; diisi server).
  function onNet(type, d, action, from) {
    const g = game(), playing = g.running && g.s && g.s.mp && !g.s.over;
    switch (type) {
      case 'open': action(); break;
      case 'room':
      case 'joined': {
        const peers = {};
        if (type === 'joined') for (const slot of d) peers[slot] = null;
        setPeers(peers);
        menu.inLobby = true;
        show('mp-connect', false);
        show('mp-lobby', true);
        if (type === 'joined') net.send({ k: 'hello', faction: menu.faction });
        renderLobby();
        mpStatus(type === 'room' ? 'Bagikan kode ruangan ini ke pemain lain (sampai ' + BF.SLOTS.length + ' pemain).' : 'Menunggu tuan rumah memulai…');
        break;
      }
      case 'peer':
        if (!menu.inLobby) break;
        menu.peers[d] = null;
        setPeers(menu.peers);
        net.send({ k: 'hello', faction: menu.faction });
        renderLobby();
        mpStatus('Lawan bergabung.');
        break;
      case 'msg':
        if (d.k === 'hello' && BF.FACTIONS[d.faction]) {
          if (!menu.inLobby) break;
          menu.peers[from] = d.faction;
          setPeers(menu.peers);
          renderLobby();
        } else if (d.k === 'start' && from === 0 && net.slot !== 0 && menu.inLobby && Number.isInteger(d.seed) &&
          Array.isArray(d.order) && Array.isArray(d.factions) && d.order.length >= 2 && d.order.length <= BF.SLOTS.length && d.factions.length === d.order.length &&
          d.order.every(Number.isInteger) && new Set(d.order).size === d.order.length && d.order.indexOf(net.slot) >= 0 &&
          d.factions.every(f => typeof f === 'string' && BF.FACTIONS[f])) startMp(d.seed, d.order, d.factions);
        break;
      case 'left':
        if (playing) {
          // tak ada lagi lawan yang masih bermain → menang; kalau masih ada, yang keluar dianggap menyerah (lihat net.js)
          const s = g.s, pid = net.order.indexOf(d.slot);
          if (!net.order.some((sl, i) => i !== net.pid && !net.gone[i] && !s.players[i].out)) endMp('Lawan keluar dari permainan.', true);
          else if (pid >= 0 && !s.players[pid].out) BF.hud.toast(`${s.players[pid].name} (${BF.SLOTS[pid].label}) keluar dari permainan.`);
        } else if (menu.inLobby) {
          if (d.closed) { mpReset('Tuan rumah keluar. Ruangan ditutup.', true); break; }
          delete menu.peers[d.slot];
          setPeers(menu.peers);
          renderLobby();
          mpStatus('Seorang pemain keluar dari ruangan.');
        }
        break;
      case 'error':
        if (!playing) mpReset(d, true);
        break;
      case 'close':
        if (playing) endMp('Koneksi ke server terputus.', false);
        else if (menu.mode === 'mp') mpReset('Koneksi ke server terputus.', true);
        break;
      case 'desync':
        BF.hud.toast('Peringatan: permainan tidak sinkron dengan lawan');
        break;
    }
  }

  function mpOpen(action) {
    const addr = $('mp-addr').value.trim();
    if (!/^[A-Za-z0-9.\-]+(:\d{1,5})?$/.test(addr)) { mpStatus('Alamat server tidak valid', true); return; }
    mpStatus('Menghubungkan…');
    net.connect(addr, (type, d, from) => onNet(type, d, action, from));
  }

  // ---------------------------------------------------------------- menu dalam permainan

  function renderGameMenu() {
    const s = game().s, mp = s.mp, man = BF.save.meta('manual'), auto = BF.save.meta('auto');
    $('m-sfx').textContent = 'Efek suara: ' + (audio.sfx ? 'Nyala' : 'Mati');
    $('m-music').textContent = 'Musik: ' + (audio.music ? 'Nyala' : 'Mati');
    $('m-save').disabled = mp;
    $('m-load').disabled = mp || !man;
    $('m-loadauto').disabled = mp || !auto;
    $('m-load').textContent = 'Muat Simpanan' + (man ? ' (' + ago(man.time) + ')' : '');
    $('m-loadauto').textContent = 'Muat Simpanan Otomatis' + (auto ? ' (' + ago(auto.time) + ')' : '');
    $('m-quit').textContent = mp ? 'Menyerah & Keluar' : 'Keluar ke Menu Utama';
  }
  const note = msg => { $('m-note').textContent = msg || ''; };

  menu.openGameMenu = function () {
    const g = game();
    if (!g.running || !g.s || g.s.over || g.menuOpen) return;
    g.menuOpen = true;
    menu.wasPaused = g.paused;
    if (!g.s.mp) g.setPaused(true);     // multiplayer tidak bisa dijeda sepihak
    note(g.s.mp ? 'Simpan/muat tidak tersedia di multiplayer. Permainan tetap berjalan.' : '');
    renderGameMenu();
    show('overlay-menu', true);
  };

  menu.closeGameMenu = function () {
    const g = game();
    if (!g.menuOpen) return;
    g.menuOpen = false;
    if (g.s && !g.s.mp) g.setPaused(menu.wasPaused);
    show('overlay-menu', false);
  };

  // ---------------------------------------------------------------- init

  menu.init = function () {
    audio.load();
    renderFactions();
    for (const b of $('mode-tabs').children) b.addEventListener('click', () => setMode(b.dataset.mode));

    const foe = $('foe');
    foe.innerHTML = '<option value="random">Acak</option>' + fkeys.map(k => `<option value="${k}">${BF.FACTIONS[k].name}</option>`).join('');
    foe.addEventListener('change', () => { menu.foe = foe.value; });
    const foesEl = $('foes');
    for (let n = 1; n < BF.SLOTS.length; n++) {
      const b = document.createElement('button');
      b.textContent = n;
      b.className = 'choice' + (n === menu.foes ? ' on' : '');
      b.addEventListener('click', () => {
        menu.foes = n;
        for (const c of foesEl.children) c.classList.toggle('on', c === b);
        foe.disabled = n > 1;                               // lebih dari satu lawan: wangsa lawan selalu acak
        if (n > 1) foe.value = 'random';
        else foe.value = menu.foe;
      });
      foesEl.appendChild(b);
    }

    const diffEl = $('difficulty');
    for (const k of Object.keys(BF.DIFF)) {
      const b = document.createElement('button');
      b.textContent = BF.DIFF[k].label;
      b.className = 'choice' + (k === menu.difficulty ? ' on' : '');
      b.addEventListener('click', () => {
        menu.difficulty = k;
        for (const c of diffEl.children) c.classList.toggle('on', c === b);
      });
      diffEl.appendChild(b);
    }

    $('btn-start').addEventListener('click', startAI);
    $('btn-continue').addEventListener('click', () => {
      const l = latestSave();
      if (!l || !load(l.slot)) { BF.hud.toast('Simpanan tidak bisa dimuat'); menu.refresh(); }
    });
    $('btn-again').addEventListener('click', menu.toStart);
    for (const id of ['btn-howto', 'btn-help', 'm-help']) $(id).addEventListener('click', () => show('overlay-help', true));
    $('btn-help-close').addEventListener('click', () => show('overlay-help', false));

    $('mp-addr').value = /^https?:$/.test(location.protocol) ? location.host : 'localhost:8080';
    $('mp-create').addEventListener('click', () => mpOpen(() => net.create()));
    $('mp-join').addEventListener('click', () => {
      const code = $('mp-code').value.trim().toUpperCase();
      if (!/^[A-Z0-9]{5}$/.test(code)) { mpStatus('Kode ruangan terdiri dari 5 karakter', true); return; }
      mpOpen(() => net.join(code));
    });
    $('mp-leave').addEventListener('click', () => mpReset(''));
    $('mp-start').addEventListener('click', () => {
      const order = lobbyOrder();
      if (net.slot !== 0 || order.length < 2 || !order.every(s => s === 0 || menu.peers[s])) return;
      const seed = (Math.random() * 2147483647) | 0, factions = order.map(s => (s === 0 ? menu.faction : menu.peers[s]));
      net.lock();
      net.send({ k: 'start', seed, order, factions });
      startMp(seed, order, factions);
    });

    $('btn-menu').addEventListener('click', menu.openGameMenu);
    $('m-resume').addEventListener('click', menu.closeGameMenu);
    $('m-save').addEventListener('click', () => {
      note(BF.save.write('manual', game().s) ? 'Permainan disimpan.' : 'Gagal menyimpan: penyimpanan browser penuh atau tidak tersedia.');
      renderGameMenu();
    });
    $('m-load').addEventListener('click', () => { if (!load('manual')) note('Simpanan tidak ada atau rusak.'); });
    $('m-loadauto').addEventListener('click', () => { if (!load('auto')) note('Simpanan otomatis tidak ada atau rusak.'); });
    $('m-sfx').addEventListener('click', () => { audio.sfx = !audio.sfx; audio.persist(); renderGameMenu(); audio.play('select'); });
    $('m-music').addEventListener('click', () => { audio.music = !audio.music; audio.persist(); renderGameMenu(); });
    $('m-quit').addEventListener('click', menu.toStart);
    menu.refresh();
  };
})();
