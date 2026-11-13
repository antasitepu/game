'use strict';
// HUD (DOM): bar sumber daya, panel info, tombol perintah, tooltip, toast, layar akhir.
// Semua aksi pemain dikirim lewat BF.issue (perintah berbentuk data) supaya berlaku juga di multiplayer.
(function () {
  const KEYS = ['Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F', 'Z', 'X', 'C', 'V'];
  const ERR = {
    res: 'Sumber daya tidak cukup', era: 'Era belum terbuka', queue: 'Antrean penuh',
    place: 'Tidak bisa membangun di sini', busy: 'Sedang berlangsung', invalid: 'Perintah tidak berlaku',
  };
  const MAX_QUEUE = 8;
  const $ = id => document.getElementById(id);

  // State interaksi pemain (seleksi, mode penempatan, dsb). Dibaca juga oleh render & input.
  const ui = BF.ui = {
    sel: [], placing: null, amove: false, garrison: false, patrol: false, buildPage: 0, formation: 0, drag: null, ghosts: [], wallStart: null, pings: [], groups: {},
    mouse: { x: 0, y: 0, inside: false, onMap: false },
  };
  const hud = BF.hud = { buttons: [], sig: '', hover: -1, infoAt: 0, portraitKey: '', text: {}, ERR, endNote: '', waitSince: 0 };
  let toastTimer = 0;

  ui.select = function (ids) {
    ui.sel = ids;
    ui.placing = null;
    ui.wallStart = null;
    ui.amove = false;
    ui.garrison = false;
    ui.patrol = false;
    ui.buildPage = 0;
    hud.infoAt = 0;
  };
  ui.reset = function () {
    ui.select([]);
    ui.drag = null;
    ui.ghosts = [];
    ui.pings = [];
    ui.groups = {};
    hud.sig = '';
    hud.endNote = '';
  };
  ui.entities = function (s) {
    return ui.sel.map(id => s.byId.get(id)).filter(Boolean);
  };

  hud.toast = function (msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  };
  // Aksi ditolak: beri tahu pemain (BF.exec sendiri diam saat menolak).
  hud.fail = function (msg) {
    hud.toast(msg);
    BF.audio.play('error');
  };

  function setText(id, value) {
    if (hud.text[id] === value) return;
    hud.text[id] = value;
    $(id).textContent = value;
  }

  // ---------------------------------------------------------------- tombol perintah

  function makeButtons(s) {
    const me = s.human, p = s.players[me], slots = new Array(12).fill(null);
    const own = ui.entities(s).filter(e => e.owner === me);
    const units = own.filter(e => e.kind === 'unit');
    const workers = units.filter(u => u.type === 'worker');
    const ids = units.map(u => u.id);
    const eraName = e => BF.ERAS[e].name;
    const stop = { glyph: '■', title: 'Berhenti', desc: 'Hentikan perintah saat ini.', action() { BF.issue({ c: 'stop', ids }); } };
    if (workers.length) {
      slots[11] = {
        glyph: ui.buildPage ? '◂' : '▸', title: ui.buildPage ? 'Bangunan utama' : 'Bangunan lain',
        desc: ui.buildPage ? 'Kembali ke daftar bangunan utama.' : 'Pasar dan Balai Kota.',
        action() { ui.buildPage = ui.buildPage ? 0 : 1; },
      };
      (ui.buildPage ? BF.BUILD_MENU2 : BF.BUILD_MENU).forEach((t, i) => {
        const d = p.B[t];
        slots[i] = {
          icon: ['building', t], title: 'Bangun ' + d.name, cost: d.cost, desc: d.desc,
          locked: p.era < d.era ? eraName(d.era) : null, poor: !BF.canAfford(p, d.cost), active: ui.placing === t,
          action() {
            if (ui.placing === t) { ui.placing = null; ui.wallStart = null; ui.ghosts = []; return; }      // tekan lagi = batal
            if (p.era < d.era) return hud.fail('Butuh ' + eraName(d.era));
            if (!BF.canAfford(p, d.cost)) return hud.fail(ERR.res);
            ui.placing = t;
            ui.wallStart = null;
            ui.amove = false;
            ui.garrison = false;
            ui.patrol = false;
          },
        };
      });
    } else if (units.length) {
      // formasi untuk perintah gerak berikutnya: pilihan pemain, berlaku sampai diganti (Q = Baris, W = Kotak, E = Bebas)
      [1, 2, 0].forEach((v, k) => {
        const F = BF.FORMATIONS[v];
        slots[k] = { glyph: ['⁘', '☰', '▦'][v], title: 'Formasi: ' + F.name, desc: F.desc, active: ui.formation === v, action() { ui.formation = v; } };
      });
      slots[4] = {
        glyph: '⚔', title: 'Gerak-Serang', active: ui.amove,
        desc: 'Lalu klik kiri pada peta: pasukan bergerak ke sana sambil menyerang musuh yang ditemui.',
        action() { ui.amove = !ui.amove; ui.garrison = ui.patrol = false; ui.placing = null; },
      };
      slots[5] = stop;
      slots[6] = {
        glyph: '⌂', key: 'G', title: 'Berlindung', active: ui.garrison,
        desc: 'Lalu klik kiri Balai Kota atau Menara Jaga milikmu: unit masuk, aman dari serangan, dan bangunan itu menembak lebih banyak panah. Bisa juga Alt + klik kanan.',
        action() { BF.input.garrisonMode(); },
      };
      slots[7] = {
        glyph: '⇄', title: 'Patroli', active: ui.patrol,
        desc: 'Lalu klik kiri pada peta: pasukan berjalan bolak-balik antara posisinya sekarang dan titik itu sambil menyerang musuh yang ditemui.',
        action() { ui.patrol = !ui.patrol; ui.amove = ui.garrison = false; ui.placing = null; },
      };
      // sikap: tombol menyala bila semua unit tempur (dan Tabib) terpilih memakai sikap itu; bila yang terpilih hanya
      // Tabib, keterangannya memakai arti sikap bagi penyembuh
      const fighters = units.filter(u => p.U[u.type].atk || p.U[u.type].heal), medic = fighters.every(u => p.U[u.type].heal), cur = fighters.length && fighters.every(u => (u.stance || 0) === (fighters[0].stance || 0)) ? fighters[0].stance || 0 : -1;
      if (fighters.length) BF.STANCES.forEach((st, v) => {
        slots[8 + v] = {
          glyph: ['➤', '◆', '○'][v], title: 'Sikap: ' + st.name, desc: medic ? st.heal : st.desc, active: cur === v,
          action() { BF.issue({ c: 'stance', ids: fighters.map(u => u.id), v }); hud.infoAt = 0; },
        };
      });
    } else if (own.length === 1 && own[0].kind === 'building') {
      const b = own[0];
      if (b.built) {
        const full = () => b.queue.length >= MAX_QUEUE;
        let i = 0;
        const next = BF.ERAS[p.era + 1];
        if (b.type === 'townhall' && next)
          slots[3] = {
            glyph: '▲', title: 'Naik ke ' + next.name, cost: next.cost, desc: next.desc,
            poor: !BF.canAfford(p, next.cost), disabled: p.eraQueued,
            action() {
              if (!BF.canAfford(p, next.cost)) return hud.fail(ERR.res);
              BF.issue({ c: 'era', bid: b.id });
            },
          };
        if (p.B[b.type].garrison)
          slots[10] = {
            glyph: '⇱', key: 'G', title: 'Keluarkan semua', disabled: !b.inside.length, why: 'Belum ada unit di dalam',
            desc: 'Semua unit yang berlindung di bangunan ini keluar.',
            action() { BF.issue({ c: 'ungarrison', bid: b.id }); hud.infoAt = 0; },
          };
        if (b.type === 'market') {
          // baris atas: jual 1 lot → emas; baris kedua: beli 1 lot dengan emas (harga terkini ada di judul tombol)
          const lot = BF.MARKET.lot, note = 'Harga naik tiap kali dibeli dan turun tiap kali dijual, lalu perlahan kembali normal.';
          ['food', 'wood', 'stone'].forEach((r, k) => {
            const name = BF.RES_LABEL[r], sell = BF.tradeQuote(s, r, false), buy = BF.tradeQuote(s, r, true);
            slots[k] = {
              glyph: name[0] + '↑', title: `Jual ${lot} ${name} → ${sell} Emas`, cost: { [r]: lot }, desc: note, poor: p.res[r] < lot,
              action() { if (p.res[r] < lot) return hud.fail(ERR.res); BF.issue({ c: 'trade', bid: b.id, res: r, buy: false }); },
            };
            slots[4 + k] = {
              glyph: name[0] + '↓', title: `Beli ${lot} ${name}`, cost: { gold: buy }, desc: note, poor: p.res.gold < buy,
              action() { if (p.res.gold < buy) return hud.fail(ERR.res); BF.issue({ c: 'trade', bid: b.id, res: r, buy: true }); },
            };
          });
        }
        const put = btn => { while (slots[i]) i++; if (i < 11) slots[i++] = btn; };
        for (const ut of BF.trainable(p, b.type)) {
          const ud = p.U[ut];
          put({
            icon: ['unit', ut], title: 'Latih ' + ud.name, cost: ud.cost, desc: ud.desc,
            locked: p.era < ud.era ? eraName(ud.era) : null, poor: !BF.canAfford(p, ud.cost),
            action() {
              if (p.era < ud.era) return hud.fail('Butuh ' + eraName(ud.era));
              if (full()) return hud.fail(ERR.queue);
              if (!BF.canAfford(p, ud.cost)) return hud.fail(ERR.res);
              BF.issue({ c: 'train', bid: b.id, unit: ut });
            },
          });
        }
        for (const key of Object.keys(BF.TECHS)) {
          const t = BF.TECHS[key];
          if (t.at !== b.type || p.techs.indexOf(key) >= 0) continue;
          const needReq = t.req && p.techs.indexOf(t.req) < 0;
          put({
            icon: ['tech', key], title: 'Teliti ' + t.name, cost: t.cost, desc: t.desc,
            locked: p.era < t.era ? eraName(t.era) : needReq ? BF.TECHS[t.req].name : null,
            poor: !BF.canAfford(p, t.cost), disabled: !!p.techQ[key],
            action() {
              if (p.era < t.era) return hud.fail('Butuh ' + eraName(t.era));
              if (needReq) return hud.fail('Butuh ' + BF.TECHS[t.req].name);
              if (full()) return hud.fail(ERR.queue);
              if (!BF.canAfford(p, t.cost)) return hud.fail(ERR.res);
              BF.issue({ c: 'research', bid: b.id, tech: key });
            },
          });
        }
      }
      slots[11] = {
        glyph: '✕', key: 'Del', title: b.built ? 'Hancurkan bangunan' : 'Batalkan pembangunan',
        desc: b.built ? 'Menghancurkan bangunan ini.' : 'Sisa biaya dikembalikan.',
        action() { BF.issue({ c: 'destroy', ids: [b.id] }); },
      };
    }
    slots.forEach((b, i) => { if (b && !b.key) b.key = KEYS[i]; });
    return slots;
  }

  function renderButtons(s) {
    const grid = $('cmds');
    grid.textContent = '';
    hud.buttons.forEach((b, i) => {
      const el = document.createElement('div');
      el.className = 'cmd' + (b ? '' : ' empty') + (b && b.locked ? ' locked' : '') + (b && b.poor ? ' poor' : '') + (b && b.active ? ' active' : '') + (b && b.disabled ? ' disabled' : '');
      el.dataset.i = i;
      if (b) {
        if (b.icon) {
          const c = document.createElement('canvas');
          BF.drawIcon(c, b.icon[0], b.icon[1], s.human, 40);
          el.appendChild(c);
        } else {
          const g = document.createElement('span');
          g.className = 'glyph';
          g.textContent = b.glyph;
          el.appendChild(g);
        }
        const k = document.createElement('span');
        k.className = 'key';
        k.textContent = b.key;
        el.appendChild(k);
      }
      grid.appendChild(el);
    });
    if (hud.hover >= 0) showTip(s, hud.hover);
  }

  function costHtml(p, cost) {
    return Object.keys(cost).map(r =>
      `<span class="cost${p.res[r] < cost[r] ? ' lack' : ''}"><i class="ico ${r}"></i>${cost[r]}</span>`).join('');
  }

  function showTip(s, i) {
    const b = hud.buttons[i], tip = $('tooltip'), el = $('cmds').children[i];
    if (!b || !el) { tip.classList.add('hidden'); return; }
    const p = s.players[s.human];
    tip.innerHTML = `<div class="tt-title">${b.title}<span class="tt-key">${b.key}</span></div>` +
      (b.cost ? `<div class="tt-cost">${costHtml(p, b.cost)}</div>` : '') +
      (b.locked ? `<div class="tt-lock">Butuh ${b.locked}</div>` : '') +
      (b.disabled ? `<div class="tt-lock">${b.why || 'Sedang berlangsung'}</div>` : '') +
      `<div class="tt-desc">${b.desc || ''}</div>`;
    tip.classList.remove('hidden');
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    tip.style.top = (r.top - h - 8) + 'px';
  }

  hud.press = function (i) {
    const b = hud.buttons[i];
    if (!b || b.disabled) return;
    BF.audio.play('select');
    b.action();
  };
  hud.pressKey = function (key) {
    // Hitung ulang dari pilihan saat ini: hotkey bisa ditekan sebelum frame berikutnya memperbarui panel.
    hud.buttons = makeButtons(BF.game.s);
    const i = hud.buttons.findIndex(b => b && b.key === key);
    if (i < 0) return false;
    hud.press(i);
    return true;
  };

  // ---------------------------------------------------------------- panel info

  function statusOf(u) {
    const o = u.order;
    switch (o.type) {
      case 'move': return 'Bergerak';
      case 'amove': return 'Gerak-serang';
      case 'attack': return 'Menyerang';
      case 'build': return 'Membangun';
      case 'repair': return 'Memperbaiki';
      case 'heal': return 'Menyembuhkan';
      case 'patrol': return 'Berpatroli';
      case 'garrison': return 'Menuju tempat berlindung';
      case 'gather': return o.state === 'return' ? 'Menyetor ' + BF.RES_LABEL[o.res] : o.animal ? (o.state === 'work' ? 'Menguliti buruan' : 'Berburu') : 'Mengumpulkan ' + BF.RES_LABEL[o.res];
      default: return 'Menganggur';
    }
  }

  function hpHtml(hp, max) {
    const f = BF.clamp(hp / max, 0, 1);
    return `<div class="hp"><i style="width:${(f * 100).toFixed(1)}%;background:${f > 0.6 ? '#4ade80' : f > 0.3 ? '#facc15' : '#f87171'}"></i>` +
      `<span>${Math.max(0, Math.ceil(hp))} / ${max}</span></div>`;
  }

  const num = v => (Math.round(v * 10) / 10).toString();
  const combatHtml = d => '<div class="stats">' + (d.heal ? `<span>Pulih <b>${num(d.heal)}</b>/dtk</span><span>Jangkauan <b>${num(d.healRange)}</b></span>`
    : `<span>Serang <b>${num(d.atk)}</b></span><span>Jarak <b>${d.range > 1 ? num(d.range) : 'dekat'}</b></span>`) +
    (d.armor !== undefined ? `<span>Zirah <b>${num(d.armor)}</b></span>` : '') + (d.speed ? `<span>Laju <b>${num(d.speed)}</b></span>` : '') + '</div>';

  function renderInfo(s) {
    const me = s.human, p = s.players[me], ents = ui.entities(s), body = $('info-body'), portrait = $('portrait');
    let html = '', pk = '';
    if (!ents.length) {
      const f = BF.FACTIONS[p.faction];
      html = `<div class="name">${f.name}<span class="owner" style="color:${p.color}">${f.tag}</span></div>` +
        `<div class="bonus">${f.bonus.map(b => `<span>${b}</span>`).join('')}</div>` +
        (p.techs.length ? `<div class="status">Teknologi: ${p.techs.map(k => BF.TECHS[k].name).join(', ')}</div>` : '') +
        '<div class="hint">Klik kiri atau seret untuk memilih. Klik kanan untuk memberi perintah.</div>';
    } else if (ents.length === 1 && ents[0].kind === 'animal') {
      const e = ents[0], d = BF.ANIMALS[e.type];
      pk = 'animal:' + e.type + ':' + (e.type === 'deer' && e.id % 3 === 0 ? 1 : 0);
      html = `<div class="name">${d.name}<span class="owner">Hewan liar</span></div>` +
        (e.state === 'carcass' ? `<div class="status">Bangkai · ${e.food} ${BF.RES_LABEL.food} tersisa</div>`
          : hpHtml(e.hp, d.hp) + `<div class="status">${d.food} ${BF.RES_LABEL.food} · ${d.atk ? 'menyeruduk balik bila diserang' : 'lari bila diserang'}</div>`) +
        '<div class="hint">Pilih pekerja lalu klik kanan hewan untuk berburu.</div>';
    } else if (ents.length === 1) {
      const e = ents[0], pl = s.players[e.owner];
      const head = name => `<div class="name">${name}<span class="owner" style="color:${pl.color}">${pl.name}</span></div>`;
      if (e.kind === 'unit') {
        const d = BF.unitDef(s, e);
        pk = 'unit:' + e.type + ':' + e.owner;
        html = head(d.name) + hpHtml(e.hp, d.hp) + combatHtml(d) +
          (e.owner === me ? `<div class="status">${statusOf(e)}` +
            (e.carry > 0 ? ` · membawa ${e.carry} ${BF.RES_LABEL[e.carryType]}` : '') +
            (d.atk || d.heal ? ' · Sikap: ' + BF.STANCES[e.stance || 0].name : '') + '</div>' : '');
      } else {
        const d = BF.bldDef(s, e);
        pk = 'building:' + e.type + ':' + e.owner;
        html = head(d.name) + hpHtml(e.hp, d.hp) + (d.atk ? combatHtml(d) : '');
        if (!e.built) html += `<div class="status">Sedang dibangun: ${Math.floor(e.progress * 100)}%</div>`;
        else if (e.owner === me && e.hp < d.hp) {                                     // rusak: siapa yang memperbaiki, atau caranya
          const n = s.units.filter(u => !u.dead && u.owner === me && u.order.type === 'repair' && u.order.bid === e.id).length;
          html += n ? `<div class="status">Sedang diperbaiki · ${n} pekerja</div>` : '<div class="status warn">Rusak — pilih pekerja lalu klik kanan bangunan ini untuk memperbaiki</div>';
        }
        if (e.built && e.owner === me && e.type === 'market')
          html += `<div class="status">Harga per ${BF.MARKET.lot}: ` + ['food', 'wood', 'stone'].map(r => `${BF.RES_LABEL[r]} ${Math.round(s.market[r])}`).join(' · ') + ' Emas</div>';
        if (e.built && e.owner === me && d.garrison)
          html += `<div class="status">Berlindung: ${e.inside.length}/${d.garrison} unit${e.inside.length ? '' : ' · pilih unit, tekan G, lalu klik bangunan ini'}</div>`;
        if (e.built && e.owner === me) {
          if (e.queue.length) {
            html += '<div class="queue">' + e.queue.map((q, i) => {
              const total = q.unit ? p.U[q.unit].time : q.time;
              const name = q.era ? 'Era baru' : q.tech ? BF.TECHS[q.tech].name : p.U[q.unit].name;
              return `<div class="q" data-q="${i}" title="Klik untuk membatalkan">${name}` +
                (i === 0 ? `<i style="width:${Math.min(100, q.t / total * 100).toFixed(0)}%"></i>` : '') + '</div>';
            }).join('') + '</div>';
            if (e.queue[0].stalled) html += '<div class="status warn">Populasi penuh — bangun Rumah</div>';
          } else html += `<div class="status">${d.desc}</div>`;
        }
      }
    } else {
      const count = {};
      for (const e of ents) { const n = e.kind === 'unit' ? BF.UNITS[e.type].name : e.kind === 'animal' ? BF.ANIMALS[e.type].name : BF.BUILDINGS[e.type].name; count[n] = (count[n] || 0) + 1; }
      html = `<div class="name">${ents.length} dipilih</div><div class="group">` +
        Object.keys(count).map(n => `<span>${n} ×${count[n]}</span>`).join('') + '</div>';
    }
    body.innerHTML = html;
    if (pk !== hud.portraitKey) {
      hud.portraitKey = pk;
      portrait.classList.toggle('hidden', !pk);
      if (pk) { const [kind, type, owner] = pk.split(':'); BF.drawIcon(portrait, kind, type, +owner, 64); }
    }
  }

  // ---------------------------------------------------------------- siklus

  function handleEvents(s) {
    const me = s.human;
    BF.audio.handle(s, s.events, BF.game);
    for (const e of s.events) {
      if (e.type === 'attacked' && e.owner === me) hud.toast('Kita diserang!');
      else if (e.type === 'era') hud.toast(e.owner === me ? 'Kita memasuki ' + BF.ERAS[e.era].name + '!' : 'Musuh memasuki ' + BF.ERAS[e.era].name);
      else if (e.type === 'tech' && e.owner === me) hud.toast('Riset selesai: ' + BF.TECHS[e.tech].name);
      else if (e.type === 'repairStop' && e.owner === me) hud.toast('Perbaikan berhenti: ' + ERR.res.toLowerCase());
      else if (e.type === 'garrisonFull' && e.owner === me) hud.toast('Bangunan penuh');
      else if (e.type === 'defeat') {
        hud.toast(`${s.players[e.pid].name} (${BF.SLOTS[e.pid].label}) ${e.resigned ? 'menyerah' : 'tumbang'}.`);
        if (e.pid === me && s.mp) {                         // daring: kita tumbang sementara yang lain masih bermain →
          BF.net.close();                                   // permainan selesai di layar ini saja; yang lain melanjutkan
          s.over = true;
          s.winner = -1;
          hud.showEnd(s, e.resigned ? me : undefined);
        }
      }
      else if (e.type === 'over') {
        if (s.mp) BF.net.close();                           // permainan selesai: pamit, supaya server tidak menahan kursi kita
        hud.showEnd(s, e.resigned);
      }
    }
    s.events.length = 0;
  }

  // ---------------------------------------------------------------- layar akhir: statistik & grafik skor

  const fmtN = n => Math.round(n).toLocaleString('id-ID');

  // Tabel statistik para pemain (kolom pertama selalu pemain di layar ini) dan grafik skor di bawahnya. Dua pemain:
  // "Kamu" dan "Lawan"; lebih dari dua: lawan disebut menurut warna timnya, dengan baris hasil (menang/tumbang).
  function endStats(s) {
    const me = s.human, ps = [s.players[me]].concat(s.players.filter(p => p.id !== me)), sc = ps.map(BF.score), box = $('end-stats');
    const who = ps.map((p, i) => (i === 0 ? 'Kamu' : ps.length === 2 ? 'Lawan' : BF.SLOTS[p.id].label));
    box.classList.toggle('many', ps.length > 2);
    box.closest('.card').classList.toggle('many', ps.length > 2);
    const head = (p, who) => `<th><i style="background:${p.color}"></i>${who}<small>${p.name}</small></th>`;
    const row = (label, f, cls) => `<tr${cls ? ` class="${cls}"` : ''}><td>${label}</td>${ps.map((p, i) => `<td>${f(p, sc[i])}</td>`).join('')}</tr>`;
    box.innerHTML = `<div><div class="end-time">Waktu permainan <b>${BF.fmtTime(s.tick / BF.TICK_RATE)}</b></div>` +
      '<table class="end-table"><tr><th></th>' + ps.map((p, i) => head(p, who[i])).join('') + '</tr>' +
      (ps.length > 2 ? row('Hasil', p => (s.winner === p.id ? 'Menang' : p.out ? 'Tumbang' : 'Bertahan')) : '') +
      row('Skor', (p, c) => fmtN(c.total), 'total') + row('Ekonomi', (p, c) => fmtN(c.eco), 'sub') + row('Militer', (p, c) => fmtN(c.mil), 'sub') + row('Teknologi', (p, c) => fmtN(c.tek), 'sub') +
      row('Sumber daya terkumpul', p => fmtN(p.gathered)) + row('Unit dilatih', p => p.stat.trained) + row('Bangunan didirikan', p => p.stat.built) +
      row('Musuh dikalahkan', p => p.stat.killU) + row('Bangunan dirobohkan', p => p.stat.razed) +
      row('Unit gugur', p => p.stat.lostU) + row('Bangunan hilang', p => p.stat.lostB) +
      row('Teknologi diteliti', p => p.techs.length) + row('Era tercapai', p => BF.ERAS[p.era].name) + '</table></div>';
    const S = BF.SCORE, side = document.createElement('div'), note = document.createElement('div');
    side.appendChild(scoreChart(s, ps, sc, who));
    note.className = 'end-note';
    note.textContent = `Skor = sumber daya terkumpul ÷ ${S.eco} (ekonomi) + nilai unit dan bangunan musuh yang dikalahkan ÷ ${S.mil} (militer) + era × ${S.era} + teknologi × ${S.tech} (teknologi).`;
    side.appendChild(note);
    box.appendChild(side);
  }

  // Grafik garis skor sepanjang permainan (SVG): satu sumbu, satu seri berwarna tim per pemain, legenda + nilai di ujung garis,
  // garis bantu tipis, dan garis silang + tooltip saat kursor di atas grafik. Teks memakai warna teks, bukan warna seri.
  function scoreChart(s, ps, sc, who) {
    const NS = 'http://www.w3.org/2000/svg', SURF = '#1c150e', every = BF.SCORE.every;
    const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
    const div = (cls, parent, text) => { const d = document.createElement('div'); d.className = cls; if (text) d.textContent = text; if (parent) parent.appendChild(d); return d; };
    const key = (parent, color, label) => { const sp = document.createElement('span'), i = document.createElement('i'); i.style.background = color; sp.appendChild(i); sp.appendChild(document.createTextNode(label)); parent.appendChild(sp); };
    // titik data: awal permainan, tiap sampel riwayat, dan keadaan akhir
    const pts = [{ t: 0, v: ps.map(() => 0) }].concat(s.hist.map((r, i) => ({ t: (i + 1) * every, v: ps.map(p => r[p.id] || 0) })).filter(q => q.t < s.tick), [{ t: Math.max(1, s.tick), v: sc.map(c => c.total) }]);
    const W = 460, H = 250, L = 46, R = 50, T = 10, B = 24, tMax = pts[pts.length - 1].t, vMax = Math.max(100, ...pts.map(q => Math.max(...q.v)));
    const raw = vMax / 4, pow = Math.pow(10, Math.floor(Math.log10(raw))), fr = raw / pow, step = (fr <= 1 ? 1 : fr <= 2 ? 2 : fr <= 5 ? 5 : 10) * pow, yMax = Math.ceil(vMax / step) * step;
    const X = t => L + (W - L - R) * t / tMax, Y = v => T + (H - T - B) * (1 - v / yMax);

    const wrap = div('end-chart'), headEl = div('ec-head', wrap);
    div('ec-title', headEl, 'Skor sepanjang permainan');
    const legend = div('ec-legend', headEl);
    ps.forEach((p, i) => key(legend, p.color, who[i]));
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Grafik skor: ' + ps.map((p, i) => `${who[i]} ${fmtN(sc[i].total)}`).join(', ') }, wrap);
    for (let v = 0; v <= yMax + 1e-6; v += step) {
      el('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: '#3a2e1e', 'stroke-width': 1 }, svg);
      el('text', { x: L - 7, y: Y(v) + 4, 'text-anchor': 'end' }, svg).textContent = fmtN(v);
    }
    const mins = tMax / 1200, ms = mins <= 6 ? 1 : mins <= 14 ? 2 : mins <= 35 ? 5 : 10;
    for (let m = 0; m * 1200 <= tMax; m += ms) el('text', { x: X(m * 1200), y: H - 6, 'text-anchor': 'middle' }, svg).textContent = m ? m + ' mnt' : '0';
    for (let i = ps.length - 1; i >= 0; i--) {            // lawan dulu, lalu pemain di layar ini (di atas)
      el('path', { d: pts.map((q, k) => (k ? 'L' : 'M') + X(q.t).toFixed(1) + ' ' + Y(q.v[i]).toFixed(1)).join(' '), fill: 'none', stroke: ps[i].color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      el('circle', { cx: X(tMax), cy: Y(sc[i].total), r: 4, fill: ps[i].color, stroke: SURF, 'stroke-width': 2 }, svg);
    }
    // nilai akhir di ujung garis; label yang bertabrakan direnggangkan 13px, berpusat di rata-rata kelompoknya
    const ly = sc.map(c => Y(c.total) + 4), ord = ly.map((v, i) => i).sort((a, b) => ly[a] - ly[b] || a - b);
    for (let a = 0, b; a < ord.length; a = b) {
      for (b = a + 1; b < ord.length && ly[ord[b]] - ly[ord[b - 1]] < 13;) b++;
      if (b - a < 2) continue;
      let mid = 0;
      for (let k = a; k < b; k++) mid += ly[ord[k]] / (b - a);
      for (let k = a; k < b; k++) ly[ord[k]] = mid + (k - a - (b - a - 1) / 2) * 13;
    }
    ps.forEach((p, i) => { el('text', { x: X(tMax) + 9, y: Math.min(H - B + 4, Math.max(T + 8, ly[i])), class: 'val' }, svg).textContent = fmtN(sc[i].total); });

    // lapisan kursor: garis silang menempel ke sampel terdekat + tooltip berisi semua seri (nilai dulu, lalu nama)
    const cross = el('line', { y1: T, y2: H - B, stroke: '#8a7a5c', 'stroke-width': 1, visibility: 'hidden' }, svg);
    const dots = ps.map(p => el('circle', { r: 4, fill: p.color, stroke: SURF, 'stroke-width': 2, visibility: 'hidden' }, svg));
    const tip = div('ec-tip hidden', wrap), hit = el('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' }, svg);
    const hide = () => { tip.classList.add('hidden'); cross.setAttribute('visibility', 'hidden'); for (const d of dots) d.setAttribute('visibility', 'hidden'); };
    hit.addEventListener('pointermove', e => {
      const box = svg.getBoundingClientRect(), t = (((e.clientX - box.left) / box.width * W) - L) / (W - L - R) * tMax;
      let q = pts[0];
      for (const c of pts) if (Math.abs(c.t - t) < Math.abs(q.t - t)) q = c;
      cross.setAttribute('x1', X(q.t)); cross.setAttribute('x2', X(q.t)); cross.setAttribute('visibility', 'visible');
      dots.forEach((d, i) => { d.setAttribute('cx', X(q.t)); d.setAttribute('cy', Y(q.v[i])); d.setAttribute('visibility', 'visible'); });
      tip.textContent = '';
      div('', tip, 'Menit ' + BF.fmtTime(q.t / BF.TICK_RATE));
      ps.forEach((p, i) => { const r = div('', tip), k = document.createElement('i'), b = document.createElement('b'); k.style.background = p.color; b.textContent = fmtN(q.v[i]); r.appendChild(k); r.appendChild(b); r.appendChild(document.createTextNode(who[i])); });
      tip.classList.remove('hidden');
      const wb = wrap.getBoundingClientRect(), px = box.left - wb.left + X(q.t) / W * box.width;
      tip.style.left = (px + 12 + tip.offsetWidth > wb.width ? px - 12 - tip.offsetWidth : px + 12) + 'px';
      tip.style.top = '34px';
    });
    hit.addEventListener('pointerleave', hide);
    return wrap;
  }

  // note: keterangan khusus (lawan keluar, koneksi putus). resigned: id pemain yang menyerah.
  hud.showEnd = function (s, resigned) {
    // lost: pemain di layar ini tumbang sementara yang lain masih bertahan (permainan tunggal lebih dari dua pemain)
    const win = s.winner === s.human, lost = !win && s.players[s.human].out && s.players.some(p => !p.out), none = s.winner < 0 && !lost;
    $('end-title').textContent = none ? 'Permainan Berakhir' : win ? 'Kemenangan!' : 'Kekalahan';
    $('end-title').className = none ? 'draw' : win ? 'win' : 'lose';
    $('end-text').textContent = hud.endNote || (resigned !== undefined ? (resigned === s.human ? 'Kamu menyerah.' : s.mp && BF.net.quit === resigned ? 'Lawan keluar dari permainan.' : 'Lawan menyerah.')
      : win ? 'Seluruh bangunan musuh telah runtuh.' : 'Permukiman kita telah jatuh.');
    endStats(s);
    $('overlay-end').classList.remove('hidden');
  };

  hud.update = function (s) {
    const p = s.players[s.human];
    const before = ui.sel.length;
    ui.sel = ui.sel.filter(id => s.byId.has(id));
    if (ui.sel.length !== before) hud.infoAt = 0;
    handleEvents(s);

    for (const r of BF.RES) setText('r-' + r, String(Math.floor(p.res[r])));
    setText('r-pop', p.pop + '/' + Math.min(p.popCap, BF.MAX_POP));
    setText('era', BF.ERAS[p.era].name);
    setText('clock', BF.fmtTime(s.tick / BF.TICK_RATE));
    let idle = 0;
    for (const u of s.units) if (u.owner === s.human && u.type === 'worker' && u.order.type === 'idle') idle++;
    setText('btn-idle', 'Pekerja menganggur: ' + idle);
    $('btn-idle').classList.toggle('alert', idle > 0);
    $('r-pop').parentNode.classList.toggle('lack', p.pop >= Math.min(p.popCap, BF.MAX_POP));

    hud.buttons = makeButtons(s);
    const sig = ui.sel.length + '#' + hud.buttons.map(b => (b ? [b.title, +!!b.locked, +!!b.poor, +!!b.active, +!!b.disabled].join(',') : '')).join('|');
    if (sig !== hud.sig) { hud.sig = sig; renderButtons(s); }

    const now = performance.now();
    if (now >= hud.infoAt) { hud.infoAt = now + 250; renderInfo(s); }

    // Multiplayer: tampilkan "menunggu" hanya bila macet lebih dari setengah detik.
    // keterangan menunggu di permainan daring: koneksi kita sendiri putus, menunggu pemain yang terputus (dengan sisa
    // waktunya), atau sekadar menunggu paket pemain lain
    $('btn-desel').classList.toggle('hidden', !ui.sel.length);
    const net = BF.net, awayPid = net.active ? net.away.findIndex((t, pid) => t > 0 && !s.players[pid].out) : -1;
    if (!net.waiting) hud.waitSince = 0; else if (!hud.waitSince) hud.waitSince = now;
    const wait = net.lost ? 'Koneksi terputus — menyambung ulang…'
      : awayPid >= 0 ? `Menunggu ${s.players[awayPid].name} tersambung lagi… (${Math.max(0, Math.ceil((net.away[awayPid] - Date.now()) / 1000))} dtk)`
        : hud.waitSince && now - hud.waitSince > 500 ? 'Menunggu pemain lain…' : '';
    if (hud.text.wait !== wait) { hud.text.wait = wait; if (wait) $('net-wait').textContent = wait; }
    $('net-wait').classList.toggle('hidden', !wait || s.over);
  };

  hud.init = function () {
    const grid = $('cmds');
    grid.addEventListener('pointerdown', e => {
      const el = e.target.closest('.cmd');
      if (el && e.button === 0) { hud.press(+el.dataset.i); hud.sig = ''; }
    });
    grid.addEventListener('mouseover', e => {
      const el = e.target.closest('.cmd');
      hud.hover = el ? +el.dataset.i : -1;
      if (BF.game.s && hud.hover >= 0) showTip(BF.game.s, hud.hover);
    });
    grid.addEventListener('mouseleave', () => { hud.hover = -1; $('tooltip').classList.add('hidden'); });
    $('info-body').addEventListener('pointerdown', e => {
      const el = e.target.closest('.q'), s = BF.game.s;
      if (!el || !s) return;
      const b = ui.entities(s)[0];
      if (b && b.kind === 'building' && b.owner === s.human) { BF.issue({ c: 'cancel', bid: b.id, i: +el.dataset.q }); hud.infoAt = 0; }
    });
  };
})();
