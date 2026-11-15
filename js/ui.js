/* DOM side of the game: HUD, dialogue, control board, map, menus and reports. */
(function () {
  'use strict';
  const G = window.G;
  const U = G.U;
  const $ = (id) => document.getElementById(id);

  function cls(el, map) {
    for (const k in map) el.classList.toggle(k, !!map[k]);
  }

  class UI {
    constructor(game) {
      this.game = game;
      this.hudTimer = 0;
      this.msgs = [];
      this.dialogueState = null;
      this.toastTimer = 0;
      this.consoleOpen = false;
      this.mapOpen = false;
      this.scramArmed = false;
      this.wpEls = new Map();
      this._bindConsole();
      this._bindDialogue();
      this._bindTouch();
    }

    show(id) {
      $(id).hidden = false;
    }
    hide(id) {
      $(id).hidden = true;
    }
    isOpen(id) {
      return !$(id).hidden;
    }

    // ------------------------------------------------------------ HUD
    setHudVisible(v) {
      $('hud').hidden = !v;
      $('touch').hidden = !(v && this.game.player.isTouch);
    }

    updateHUD(dt, d) {
      this.hudTimer -= dt;
      this._updateMsgs(dt);
      if (this.toastTimer > 0) {
        this.toastTimer -= dt;
        if (this.toastTimer <= 0) $('toast').hidden = true;
      }
      if (this.hudTimer > 0) return;
      this.hudTimer = 0.1;
      const sim = d.sim;
      const L = sim.limits;
      $('hud-dayname').textContent = d.dayLabel;
      $('hud-clock').textContent = d.clockLabel;
      $('hud-ff').hidden = !d.fastForward;
      const setV = (id, text, state) => {
        const el = $(id);
        el.textContent = text;
        el.className = 'st-v ' + (state || '');
      };
      setV('st-power', (sim.P * 100).toFixed(1) + '%', sim.P > 1.06 ? 'crit' : '');
      setV('st-output', U.fmtInt(sim.mwe) + ' / ' + U.fmtInt(d.demand), d.demand > 0 && sim.mwe < d.demand * 0.95 ? 'warn' : 'ok');
      const frac = U.clamp(sim.mwe / 1200, 0, 1);
      $('st-outbar').style.width = frac * 100 + '%';
      $('st-demandmark').style.left = U.clamp(d.demand / 1200, 0, 1) * 100 + '%';
      setV('st-tavg', sim.Tw.toFixed(1) + ' °C', sim.Tw > L.tavgHigh || sim.Tw < L.tavgLow ? 'crit' : sim.Tw > L.tavgBandHi || sim.Tw < L.tavgBandLo ? 'warn' : 'ok');
      setV('st-clad', Math.round(sim.Tc) + ' °C', sim.Tc > L.cladTrip ? 'crit' : sim.Tc > L.cladWarn ? 'warn' : '');
      setV('st-press', sim.pressure.toFixed(2) + ' MPa', sim.pressure > L.porvOpen - 0.15 ? 'warn' : '');
      $('st-inv-row').hidden = sim.level > 99 && !d.crisis;
      setV('st-inv', Math.round(sim.level) + '%', sim.level < L.inventoryLow ? 'crit' : sim.level < 90 ? 'warn' : '');
      const top = d.alarms.slice().sort((a, b) => b.sev - a.sev)[0];
      const al = $('st-alarm');
      if (top && top.sev >= 2) {
        al.hidden = false;
        al.textContent = '⚠ ' + top.label + (d.alarms.length > 1 ? '  +' + (d.alarms.length - 1) : '');
        al.className = top.sev >= 3 ? 'crit' : '';
      } else al.hidden = true;
      $('vignette').classList.toggle('on', !!d.vignette);
      $('location').textContent = d.room ? d.room.name : '';
      // Crisis panel
      $('crisis').hidden = !d.crisis;
      if (d.crisis) {
        $('cr-timer').textContent = 'T+' + U.fmtTimer(d.crisisT);
        const margin = U.clamp(1 - (sim.Tc - 330) / (1200 - 330), 0, 1) * U.clamp((sim.level - 10) / 50 + 0.15, 0, 1);
        const m2 = Math.min(margin, U.clamp(1 - (sim.Tc - 330) / 870, 0, 1));
        $('cr-margin').style.width = (m2 * 100).toFixed(1) + '%';
        $('cr-note').textContent = 'Clad ' + Math.round(sim.Tc) + ' °C · Inventory ' + Math.round(sim.level) + '% · Power ' + (sim.P * 100).toFixed(1) + '%';
      }
    }

    setObjectives(list) {
      const ol = $('objectives');
      const html = list
        .filter((o) => !o.hidden)
        .map((o) => `<li class="${o.done ? 'done' : ''} ${o.optional ? 'optional' : ''} ${o.urgent && !o.done ? 'urgent' : ''}"><span>${o.text}${o.sub && !o.done ? `<small>${o.sub}</small>` : ''}</span></li>`)
        .join('');
      if (ol.innerHTML !== html) ol.innerHTML = html;
    }

    comms(who, text, opts) {
      const cast = G.CAST[who] || { name: who, color: '#6fd6ff' };
      const el = document.createElement('div');
      el.className = 'msg';
      el.style.setProperty('--c', cast.color);
      el.innerHTML = `<div class="who">${cast.name}<em>${(opts && opts.channel) || cast.channel || 'radio'}</em></div><p></p>`;
      el.querySelector('p').textContent = text;
      $('comms').appendChild(el);
      this.msgs.push({ el, life: (opts && opts.life) || Math.max(9, text.length * 0.075) });
      while (this.msgs.length > 4) {
        const m = this.msgs.shift();
        m.el.remove();
      }
      if (this.game.audio) this.game.audio.radio();
    }

    _updateMsgs(dt) {
      for (const m of this.msgs) {
        m.life -= dt;
        if (m.life < 0.6) m.el.classList.add('fade');
      }
      while (this.msgs.length && this.msgs[0].life <= 0) {
        this.msgs.shift().el.remove();
      }
    }

    clearComms() {
      for (const m of this.msgs) m.el.remove();
      this.msgs = [];
    }

    toast(title, sub, kind, dur) {
      const t = $('toast');
      t.innerHTML = '';
      t.append(document.createTextNode(title));
      if (sub) {
        const s = document.createElement('small');
        s.textContent = sub;
        t.append(s);
      }
      t.className = kind || '';
      t.hidden = false;
      this.toastTimer = dur || 3.5;
    }

    prompt(label, locked, hold) {
      const p = $('prompt');
      const ch = $('crosshair');
      if (!label) {
        p.hidden = true;
        ch.classList.remove('target');
        $('ch-ring').style.opacity = 0;
        $('t-use').classList.add('dim');
        return;
      }
      p.hidden = false;
      $('prompt-text').textContent = label;
      $('prompt-key').hidden = !!locked;
      $('prompt-key').textContent = this.game.player.isTouch ? 'USE' : 'E';
      p.classList.toggle('locked', !!locked);
      ch.classList.add('target');
      $('t-use').classList.toggle('dim', !!locked);
      const ring = $('ch-ring');
      if (hold > 0) {
        ring.style.opacity = 1;
        ring.style.strokeDashoffset = String(88 * (1 - hold));
      } else ring.style.opacity = 0;
    }

    waypoints(list, camera) {
      const wrap = $('waypoints');
      const W = wrap.clientWidth, H = wrap.clientHeight;
      const seen = new Set();
      const placed = [];
      const v = new THREE.Vector3();
      const mx = 56, myTop = 70, myBot = 60;
      for (const wp of list) {
        seen.add(wp.key);
        let el = this.wpEls.get(wp.key);
        if (!el) {
          el = document.createElement('div');
          el.className = 'wp';
          el.innerHTML = '<i></i><span></span>';
          wrap.appendChild(el);
          this.wpEls.set(wp.key, el);
        }
        v.set(wp.pos.x, wp.pos.y + 0.6, wp.pos.z);
        const cs = v.clone().applyMatrix4(camera.matrixWorldInverse);
        v.project(camera);
        let x = (v.x * 0.5 + 0.5) * W;
        let y = (-v.y * 0.5 + 0.5) * H;
        const onScreen = cs.z < 0 && x > mx && x < W - mx && y > myTop && y < H - myBot;
        let rot = 0;
        if (!onScreen) {
          // Point from the screen centre toward the target and pin the marker to the edge.
          let dx = cs.x, dy = -cs.y;
          if (cs.z > 0 && Math.abs(dx) < 0.2) dx = dx < 0 ? -0.2 : 0.2;
          const len = Math.hypot(dx, dy) || 1;
          dx /= len;
          dy /= len;
          const hw = W / 2 - mx, hh = (H - myTop - myBot) / 2;
          const k = Math.min(hw / Math.max(Math.abs(dx), 1e-3), hh / Math.max(Math.abs(dy), 1e-3));
          x = W / 2 + dx * k;
          y = myTop + hh + dy * k;
          rot = (Math.atan2(dy, dx) * 180) / Math.PI - 135; // teardrop tip starts at bottom-left
        }
        for (const p of placed) {
          if (Math.abs(p.x - x) < 150 && Math.abs(p.y - y) < 30) y = p.y + (y >= p.y ? 30 : -30);
        }
        placed.push({ x, y });
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        el.style.setProperty('--rot', rot + 'deg');
        el.classList.toggle('urgent', !!wp.urgent);
        el.classList.toggle('edge', !onScreen);
        el.classList.toggle('left', !onScreen && x < W / 2);
        el.classList.toggle('right', !onScreen && x >= W / 2);
        el.querySelector('span').textContent = wp.label + ' · ' + Math.round(wp.dist) + ' m';
      }
      for (const [k, el] of this.wpEls) {
        if (!seen.has(k)) {
          el.remove();
          this.wpEls.delete(k);
        }
      }
    }

    // ------------------------------------------------------------ dialogue
    _bindDialogue() {
      $('dialogue').addEventListener('click', (e) => {
        if (e.target.closest('.dl-choices')) return;
        this.dialogueAdvance();
      });
    }

    get dialogueOpen() {
      return !!this.dialogueState;
    }

    // lines: [{who, text, choices?: [string]}]; resolves with the last choice index (or -1)
    dialogue(lines) {
      return new Promise((resolve) => {
        this.dialogueState = { lines, i: -1, resolve, choice: -1, typing: false };
        $('dialogue').hidden = false;
        this._nextLine();
      });
    }

    _nextLine() {
      const st = this.dialogueState;
      st.i++;
      if (st.i >= st.lines.length) {
        $('dialogue').hidden = true;
        this.dialogueState = null;
        st.resolve(st.choice);
        return;
      }
      const line = st.lines[st.i];
      const cast = G.CAST[line.who] || { name: line.who, role: '', color: '#ffb547', initials: '?' };
      const card = document.querySelector('.dl-card');
      card.style.setProperty('--c', cast.color);
      $('dl-badge').textContent = cast.initials;
      $('dl-name').textContent = cast.name;
      $('dl-role').textContent = cast.role;
      const textEl = $('dl-text');
      textEl.textContent = '';
      st.full = line.text;
      st.shown = 0;
      st.typing = true;
      const choices = $('dl-choices');
      choices.innerHTML = '';
      st.choicesPending = line.choices || null;
      $('dl-next').hidden = true;
      if (this.game.npcTalk) this.game.npcTalk(line.who);
    }

    _showChoices() {
      const st = this.dialogueState;
      const choices = $('dl-choices');
      choices.innerHTML = '';
      if (!st.choicesPending) {
        $('dl-next').hidden = false;
        return;
      }
      st.choicesPending.forEach((c, idx) => {
        const b = document.createElement('button');
        b.className = 'btn';
        b.type = 'button';
        b.innerHTML = `<kbd>${idx + 1}</kbd>`;
        b.append(document.createTextNode(c));
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.dialogueChoose(idx);
        });
        choices.appendChild(b);
      });
      if (this.game.onChoicesShown) this.game.onChoicesShown();
    }

    dialogueTick(dt) {
      const st = this.dialogueState;
      if (!st || !st.typing) return;
      const before = Math.floor(st.shown);
      st.shown += dt * 70;
      const n = Math.min(st.full.length, Math.floor(st.shown));
      if (n !== before) {
        $('dl-text').textContent = st.full.slice(0, n);
        if (n % 3 === 0 && this.game.audio) this.game.audio.typeTick();
      }
      if (n >= st.full.length) {
        st.typing = false;
        this._showChoices();
      }
    }

    dialogueAdvance() {
      const st = this.dialogueState;
      if (!st) return;
      if (st.typing) {
        st.shown = st.full.length;
        $('dl-text').textContent = st.full;
        st.typing = false;
        this._showChoices();
        return;
      }
      if (st.choicesPending) return;
      this._nextLine();
    }

    dialogueChoose(idx) {
      const st = this.dialogueState;
      if (!st || st.typing || !st.choicesPending || idx >= st.choicesPending.length) return;
      st.choice = idx;
      st.choicesPending = null;
      if (this.game.audio) this.game.audio.click();
      if (this.game.onChoiceMade) this.game.onChoiceMade();
      this._nextLine();
    }

    // ------------------------------------------------------------ control board
    _bindConsole() {
      const g = this.game;
      $('con-close').addEventListener('click', () => g.closeConsole(true));
      $('rod-slider').addEventListener('input', (e) => {
        g.cmd('rodTarget', parseFloat(e.target.value));
      });
      $('turb-slider').addEventListener('input', (e) => {
        g.cmd('turbineTarget', parseFloat(e.target.value) / 100);
      });
      $('pumpA-slider').addEventListener('input', (e) => g.cmd('pump', [0, parseFloat(e.target.value) / 100]));
      $('pumpB-slider').addEventListener('input', (e) => g.cmd('pump', [1, parseFloat(e.target.value) / 100]));
      document.querySelectorAll('[data-rod]').forEach((b) =>
        b.addEventListener('click', () => g.cmd('rodNudge', parseFloat(b.dataset.rod)))
      );
      document.querySelectorAll('[data-turb]').forEach((b) =>
        b.addEventListener('click', () => g.cmd('turbNudge', parseFloat(b.dataset.turb) / 100))
      );
      $('btn-scram').addEventListener('click', () => {
        if (!this.scramArmed) {
          this.scramArmed = true;
          $('btn-scram').classList.add('open');
          if (g.audio) g.audio.click();
          return;
        }
        g.cmd('scram');
        this.scramArmed = false;
        $('btn-scram').classList.remove('open');
      });
      $('btn-reset').addEventListener('click', () => g.cmd('resetScram'));
      $('btn-auxfeed').addEventListener('click', () => g.cmd('auxFeed'));
      $('btn-rcpa').addEventListener('click', () => g.cmd('rcpA'));
      $('btn-cr').addEventListener('click', () => g.cmd('conditionReport'));
      // Stop key presses on sliders from also moving the player / triggering shortcuts twice
      document.querySelectorAll('#console input').forEach((el) => el.addEventListener('keydown', (e) => e.stopPropagation()));
    }

    openConsole() {
      this.consoleOpen = true;
      this.scramArmed = false;
      $('btn-scram').classList.remove('open');
      $('console').hidden = false;
      this.consoleTimer = 0;
      this.syncConsoleInputs(true);
    }

    closeConsole() {
      this.consoleOpen = false;
      $('console').hidden = true;
    }

    syncConsoleInputs(force) {
      const sim = this.game.sim;
      const active = document.activeElement;
      const set = (id, v) => {
        const el = $(id);
        if (force || active !== el) el.value = v;
      };
      set('rod-slider', sim.rodTarget.toFixed(1));
      set('turb-slider', Math.round(sim.turbineTarget * 100));
      set('pumpA-slider', Math.round(sim.pumps[0].target * 100));
      set('pumpB-slider', Math.round(sim.pumps[1].target * 100));
    }

    updateConsole(dt, d) {
      if (!this.consoleOpen) return;
      this.consoleTimer -= dt;
      if (this.consoleTimer > 0) return;
      this.consoleTimer = 0.1;
      const sim = d.sim;
      const L = sim.limits;
      $('con-sub').textContent = d.clockLabel + ' · ' + d.dayLabel + ' · Demand ' + U.fmtInt(d.demand) + ' MWe';
      const ro = (id, text, state) => {
        const el = $(id);
        el.textContent = text;
        el.className = state || '';
      };
      ro('ro-power', (sim.P * 100).toFixed(1), sim.P > 1.06 ? 'crit' : '');
      ro('ro-mwe', U.fmtInt(sim.mwe), d.demand > 0 && Math.abs(sim.mwe - d.demand) > d.demand * 0.05 ? 'warn' : 'ok');
      $('ro-demand').textContent = 'MWe · demand ' + U.fmtInt(d.demand);
      ro('ro-tavg', sim.Tw.toFixed(1), sim.Tw > L.tavgHigh || sim.Tw < L.tavgLow ? 'crit' : sim.Tw > L.tavgBandHi || sim.Tw < L.tavgBandLo ? 'warn' : 'ok');
      ro('ro-clad', Math.round(sim.Tc).toString(), sim.Tc > L.cladTrip ? 'crit' : sim.Tc > L.cladWarn ? 'warn' : '');
      ro('ro-press', sim.pressure.toFixed(2), sim.pressure > L.porvOpen - 0.15 ? 'warn' : '');
      ro('ro-inv', Math.round(sim.level) + '%', sim.level < L.inventoryLow ? 'crit' : sim.level < 90 ? 'warn' : '');
      $('ro-flow').textContent = 'flow ' + Math.round(sim.flow * 100) + '% · boron ' + Math.round(sim.boron) + ' ppm';
      // rods
      $('rod-actual').style.width = sim.rods + '%';
      $('rod-target').style.left = 'calc(' + sim.rodTarget + '% - 1px)';
      const rodLocked = sim.rodLock || sim.scrammed;
      $('rod-slider').disabled = rodLocked;
      document.querySelectorAll('[data-rod]').forEach((b) => (b.disabled = rodLocked));
      $('rod-note').textContent = sim.rodLock
        ? 'ROD CONTROL LOCKED by AutoOptimize™.'
        : sim.scrammed
        ? 'Reactor tripped: all rods inserted' + (sim.rodStuckFloor > 0 ? ' except 3 stuck at ' + sim.rodStuckFloor + '%.' : '.')
        : 'At ' + sim.rods.toFixed(1) + '% → target ' + sim.rodTarget.toFixed(1) + '%. Withdraw to heat up, insert to cool down.';
      // turbine
      $('turb-val').textContent = sim.turbineTripped ? 'TRIPPED' : (sim.turbineLoad * 100).toFixed(0) + '% → ' + (sim.turbineTarget * 100).toFixed(0) + '%';
      $('turb-val').className = 'bigval' + (sim.turbineTripped ? ' crit' : '');
      $('turb-slider').disabled = sim.turbineTripped;
      document.querySelectorAll('[data-turb]').forEach((b) => (b.disabled = sim.turbineTripped));
      $('turb-note').textContent = sim.turbineTripped
        ? sim.offsitePower
          ? 'Turbine tripped. Reset it at the turbine control panel in the Turbine Hall.'
          : 'No offsite power. The turbine is gone for today.'
        : 'Load sets output: about 11 MWe per percent.';
      // pumps
      $('pumpA-val').textContent = Math.round(sim.pumps[0].eff * 100) + '%';
      $('pumpB-val').textContent = sim.pumps[1].seized ? 'SEIZED' : Math.round(sim.pumps[1].eff * 100) + '%';
      $('pumpB-slider').disabled = sim.pumps[1].seized || !sim.offsitePower;
      $('pumpA-slider').disabled = !sim.pumps[0].powered;
      const vib = sim.pumps[1].vibration;
      $('pump-note').textContent = sim.pumps[1].seized ? 'RCP-B: locked rotor. It is not coming back.' : 'RCP-B vibration ' + vib.toFixed(1) + ' mils' + (vib > 2.2 ? ' (HIGH)' : '');
      // emergency section
      $('emerg').hidden = !d.showEmergency;
      if (d.showEmergency) {
        const af = $('btn-auxfeed');
        af.disabled = sim.auxFeed || !sim.hasPower(true);
        af.classList.toggle('on', !!sim.auxFeed);
        af.textContent = sim.auxFeed ? 'Aux feedwater running' : sim.hasPower(true) ? 'Start aux feedwater' : 'Aux feed (no power)';
        const ra = $('btn-rcpa');
        const aOn = sim.pumps[0].restarted;
        ra.disabled = aOn || !sim.emergencyPower;
        ra.classList.toggle('on', !!aOn);
        ra.textContent = aOn ? 'RCP-A running (1E)' : sim.emergencyPower ? 'Restart RCP-A' : 'RCP-A (no power)';
      }
      // protection
      const scramBtn = $('btn-scram');
      scramBtn.disabled = sim.scrammed;
      $('btn-reset').disabled = !sim.canResetScram() || d.noReset;
      const ind = $('porv-ind');
      const shown = sim.porv.indicatorFault ? 'CLOSED' : sim.porv.open ? 'OPEN' : 'CLOSED';
      ind.textContent = shown + (sim.porv.blocked ? ' · BLOCKED' : '');
      ind.className = shown === 'OPEN' ? 'warn' : '';
      const tail = $('porv-tail');
      tail.textContent = Math.round(d.tailpipe) + ' °C';
      tail.className = d.tailpipe > 100 ? 'crit' : d.tailpipe > 60 ? 'warn' : '';
      $('btn-cr').hidden = !d.showCR;
      // annunciators
      const ann = $('con-annun');
      const al = d.alarms.slice().sort((a, b) => b.sev - a.sev);
      const html = al.length ? al.map((a) => `<span class="s${a.sev}">${a.label}</span>`).join('') : '<span class="none">NO ACTIVE ALARMS</span>';
      if (ann.innerHTML !== html) ann.innerHTML = html;
      $('con-hint-text').textContent = d.hint;
      this.syncConsoleInputs(false);
    }

    // ------------------------------------------------------------ map
    toggleMap(force) {
      this.mapOpen = force != null ? force : !this.mapOpen;
      $('map').hidden = !this.mapOpen;
    }

    drawMap(world, playerPos, yaw, targets) {
      if (!this.mapOpen) return;
      const c = $('map-canvas');
      const x = c.getContext('2d');
      const W = c.width, H = c.height;
      const minX = -38, maxX = 48, minZ = -36, maxZ = 18;
      const s = Math.min((W - 40) / (maxX - minX), (H - 40) / (maxZ - minZ));
      const ox = (W - (maxX - minX) * s) / 2, oz = (H - (maxZ - minZ) * s) / 2;
      const P = (px, pz) => [ox + (px - minX) * s, oz + (pz - minZ) * s];
      x.clearRect(0, 0, W, H);
      x.fillStyle = '#0b1115';
      x.fillRect(0, 0, W, H);
      const here = world.roomAt(playerPos.x, playerPos.z);
      for (const r of world.rooms) {
        const [a, b] = P(r.x0, r.z0);
        const [c2, d2] = P(r.x1, r.z1);
        x.fillStyle = here && here.id === r.id ? '#1d3340' : '#141e25';
        x.fillRect(a, b, c2 - a, d2 - b);
        x.strokeStyle = '#5d7684';
        x.lineWidth = 2;
        x.strokeRect(a, b, c2 - a, d2 - b);
        x.fillStyle = '#9fb4c0';
        x.font = '600 15px "Barlow Condensed", sans-serif';
        x.textAlign = 'center';
        if (r.id !== 'corridor') x.fillText(r.name.toUpperCase(), (a + c2) / 2, b + 20);
      }
      // doors
      x.fillStyle = '#ffb547';
      for (const dd of world.doors) {
        const [a, b] = P(dd.x, dd.z);
        if (dd.axis === 'x') x.fillRect(a - (dd.w * s) / 2, b - 3, dd.w * s, 6);
        else x.fillRect(a - 3, b - (dd.w * s) / 2, 6, dd.w * s);
      }
      // equipment dots
      x.fillStyle = '#4b6574';
      for (const it of world.interactables.values()) {
        if (it.id.startsWith('npc:')) continue;
        const [a, b] = P(it.pos.x, it.pos.z);
        x.fillRect(a - 2, b - 2, 4, 4);
      }
      // targets
      for (const t of targets) {
        const [a, b] = P(t.pos.x, t.pos.z);
        x.save();
        x.translate(a, b);
        x.rotate(Math.PI / 4);
        x.fillStyle = t.urgent ? '#ff4d4d' : '#ffb547';
        x.fillRect(-7, -7, 14, 14);
        x.restore();
        x.fillStyle = t.urgent ? '#ff8a8a' : '#ffd08a';
        x.font = '600 14px "Barlow Condensed", sans-serif';
        x.textAlign = 'left';
        x.fillText(t.label, a + 12, b + 5);
      }
      // player
      const [px, pz] = P(playerPos.x, playerPos.z);
      x.save();
      x.translate(px, pz);
      x.rotate(-yaw);
      x.fillStyle = '#6fd6ff';
      x.beginPath();
      x.moveTo(0, -12);
      x.lineTo(8, 9);
      x.lineTo(0, 4);
      x.lineTo(-8, 9);
      x.closePath();
      x.fill();
      x.restore();
      x.textAlign = 'left';
    }

    // ------------------------------------------------------------ touch
    _bindTouch() {
      const g = this.game;
      const stick = $('stick');
      g.player.onStick = (on, ox, oy, dx, dy) => {
        stick.classList.toggle('on', !!on);
        if (on) {
          stick.style.left = ox + 'px';
          stick.style.top = oy + 'px';
          stick.querySelector('i').style.transform = `translate(${dx || 0}px, ${dy || 0}px)`;
        }
      };
      const use = $('t-use');
      use.addEventListener('touchstart', (e) => {
        e.preventDefault();
        g.useDown();
      });
      use.addEventListener('touchend', (e) => {
        e.preventDefault();
        g.useUp();
      });
      $('t-map').addEventListener('click', () => this.toggleMap());
      $('t-menu').addEventListener('click', () => g.pause());
      const ff = $('t-ff');
      ff.addEventListener('touchstart', (e) => {
        e.preventDefault();
        g.ffTouch = true;
      });
      ff.addEventListener('touchend', () => (g.ffTouch = false));
    }

    // ------------------------------------------------------------ screens
    dayIntro(day) {
      return new Promise((resolve) => {
        $('di-meta').textContent = 'SHIFT TURNOVER · UNIT 2 · ' + day.date;
        $('di-day').textContent = 'DAY ' + day.n + ' · ' + day.weekday.toUpperCase();
        $('di-title').textContent = day.title;
        $('di-text').textContent = day.intro;
        $('di-list').innerHTML = day.brief.map((b) => `<li>${b}</li>`).join('');
        this.show('dayintro');
        const go = $('di-go');
        const done = () => {
          go.removeEventListener('click', done);
          this.hide('dayintro');
          resolve();
        };
        go.addEventListener('click', done);
        setTimeout(() => go.focus(), 50);
      });
    }

    report(r) {
      return new Promise((resolve) => {
        $('rp-meta').textContent = 'END OF SHIFT REPORT · DAY ' + r.day + ' · ' + r.title.toUpperCase();
        $('rp-rows').innerHTML = r.rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
        $('rp-grade').textContent = r.grade;
        $('rp-note').innerHTML = `<b>NOTE FROM GUS</b>${r.note}`;
        $('rp-go').textContent = r.nextLabel || 'Next shift';
        this.show('report');
        const go = $('rp-go');
        const done = () => {
          go.removeEventListener('click', done);
          this.hide('report');
          resolve();
        };
        go.addEventListener('click', done);
        setTimeout(() => go.focus(), 50);
      });
    }

    ending(opts) {
      $('en-meta').textContent = opts.meta;
      const t = $('en-title');
      t.textContent = opts.title;
      t.className = 'ending-title' + (opts.bad ? ' bad' : '');
      $('en-body').innerHTML = opts.body;
      const menu = $('en-menu');
      menu.innerHTML = '';
      for (const b of opts.buttons) {
        const el = document.createElement('button');
        el.className = 'btn' + (b.primary ? ' primary' : '');
        el.type = 'button';
        el.textContent = b.label;
        el.addEventListener('click', () => {
          this.hide('ending');
          b.action();
        });
        menu.appendChild(el);
      }
      this.show('ending');
    }

    flash(opacity, ms) {
      const f = $('flash');
      f.style.transition = 'none';
      f.style.opacity = String(opacity);
      requestAnimationFrame(() => {
        f.style.transition = `opacity ${ms || 600}ms ease-out`;
        f.style.opacity = '0';
      });
    }
  }

  G.UI = UI;
})();
