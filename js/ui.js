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
    sel: [], placing: null, amove: false, drag: null, ghosts: [], wallStart: null, pings: [], groups: {},
    mouse: { x: 0, y: 0, inside: false, onMap: false },
  };
  const hud = BF.hud = { buttons: [], sig: '', hover: -1, infoAt: 0, portraitKey: '', text: {}, ERR, endNote: '', waitSince: 0 };
  let toastTimer = 0;

  ui.select = function (ids) {
    ui.sel = ids;
    ui.placing = null;
    ui.wallStart = null;
    ui.amove = false;
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
      BF.BUILD_MENU.forEach((t, i) => {
        const d = p.B[t];
        slots[i] = {
          icon: ['building', t], title: 'Bangun ' + d.name, cost: d.cost, desc: d.desc,
          locked: p.era < d.era ? eraName(d.era) : null, poor: !BF.canAfford(p, d.cost), active: ui.placing === t,
          action() {
            if (p.era < d.era) return hud.fail('Butuh ' + eraName(d.era));
            if (!BF.canAfford(p, d.cost)) return hud.fail(ERR.res);
            ui.placing = t;
            ui.wallStart = null;
            ui.amove = false;
          },
        };
      });
    } else if (units.length) {
      slots[4] = {
        glyph: '⚔', title: 'Gerak-Serang', active: ui.amove,
        desc: 'Lalu klik kiri pada peta: pasukan bergerak ke sana sambil menyerang musuh yang ditemui.',
        action() { ui.amove = true; ui.placing = null; },
      };
      slots[5] = stop;
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
      (b.disabled ? '<div class="tt-lock">Sedang berlangsung</div>' : '') +
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
  const combatHtml = d => `<div class="stats"><span>Serang <b>${num(d.atk)}</b></span><span>Jarak <b>${d.range > 1 ? num(d.range) : 'dekat'}</b></span>` +
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
            (e.carry > 0 ? ` · membawa ${e.carry} ${BF.RES_LABEL[e.carryType]}` : '') + '</div>' : '');
      } else {
        const d = BF.bldDef(s, e);
        pk = 'building:' + e.type + ':' + e.owner;
        html = head(d.name) + hpHtml(e.hp, d.hp) + (d.atk ? combatHtml(d) : '');
        if (!e.built) html += `<div class="status">Sedang dibangun: ${Math.floor(e.progress * 100)}%</div>`;
        else if (e.owner === me && e.hp < d.hp) {                                     // rusak: siapa yang memperbaiki, atau caranya
          const n = s.units.filter(u => !u.dead && u.owner === me && u.order.type === 'repair' && u.order.bid === e.id).length;
          html += n ? `<div class="status">Sedang diperbaiki · ${n} pekerja</div>` : '<div class="status warn">Rusak — pilih pekerja lalu klik kanan bangunan ini untuk memperbaiki</div>';
        }
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
      else if (e.type === 'over') hud.showEnd(s, e.resigned);
    }
    s.events.length = 0;
  }

  // note: keterangan khusus (lawan keluar, koneksi putus). resigned: id pemain yang menyerah.
  hud.showEnd = function (s, resigned) {
    const win = s.winner === s.human, none = s.winner < 0, p = s.players[s.human];
    $('end-title').textContent = none ? 'Permainan Berakhir' : win ? 'Kemenangan!' : 'Kekalahan';
    $('end-title').className = none ? 'draw' : win ? 'win' : 'lose';
    $('end-text').textContent = hud.endNote || (resigned !== undefined ? (resigned === s.human ? 'Kamu menyerah.' : 'Lawan menyerah.')
      : win ? 'Seluruh bangunan musuh telah runtuh.' : 'Permukiman kita telah jatuh.');
    $('end-stats').innerHTML = `<span>Waktu <b>${BF.fmtTime(s.tick / BF.TICK_RATE)}</b></span><span>Musuh dikalahkan <b>${p.kills}</b></span>` +
      `<span>Kehilangan <b>${p.losses}</b></span><span>Sumber daya terkumpul <b>${p.gathered}</b></span>` +
      `<span>Teknologi diteliti <b>${p.techs.length}</b></span>`;
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
    if (!BF.net.waiting) hud.waitSince = 0; else if (!hud.waitSince) hud.waitSince = now;
    $('net-wait').classList.toggle('hidden', !(hud.waitSince && now - hud.waitSince > 500) || s.over);
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
