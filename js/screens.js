/* Canvas renderers for every in-world display. Called ~4 times a second by World.update. */
(function () {
  'use strict';
  const G = window.G;
  const U = G.U;

  const C = {
    bg: '#081016',
    panel: '#0f1a21',
    line: '#24343e',
    text: '#d7e3e8',
    dim: '#6f8794',
    amber: '#ffb547',
    green: '#59e39a',
    red: '#ff4d4d',
    cyan: '#6fd6ff',
    magenta: '#ff5fd2',
  };
  const MONO = '"JetBrains Mono", ui-monospace, monospace';
  const COND = '"Barlow Condensed", "Arial Narrow", sans-serif';
  const DISP = '"Chakra Petch", "Barlow Condensed", sans-serif';

  function font(x, size, fam, weight) {
    x.font = `${weight || 500} ${size}px ${fam}`;
  }

  // Shrink the font until the text fits maxW (fallback fonts can be much wider).
  function fitText(x, text, px, py, maxW, size, fam, weight) {
    let s = size;
    font(x, s, fam, weight);
    while (s > 8 && x.measureText(text).width > maxW) {
      s -= 1;
      font(x, s, fam, weight);
    }
    x.fillText(text, px, py);
  }

  function tempColor(sim) {
    const L = sim.limits;
    if (sim.Tc > L.cladTrip || sim.Tw > L.tavgHigh) return C.red;
    if (sim.Tc > L.cladWarn || sim.Tw > L.tavgBandHi || sim.Tw < L.tavgBandLo) return C.amber;
    return C.green;
  }

  function readout(x, px, py, w, label, value, unit, color, sub) {
    x.fillStyle = C.panel;
    x.fillRect(px, py, w, 132);
    x.strokeStyle = C.line;
    x.lineWidth = 2;
    x.strokeRect(px + 1, py + 1, w - 2, 130);
    x.fillStyle = C.dim;
    font(x, 24, COND, 600);
    x.textAlign = 'left';
    x.fillText(label, px + 14, py + 30);
    x.fillStyle = color || C.text;
    fitText(x, value, px + 14, py + 88, w - 28, 52, MONO, 600);
    x.fillStyle = C.dim;
    font(x, 22, COND, 500);
    x.fillText(unit, px + 14, py + 118);
    if (sub) {
      x.textAlign = 'right';
      x.fillText(sub, px + w - 12, py + 118);
      x.textAlign = 'left';
    }
  }

  const Screens = {
    drawAll(S, ctx) {
      const sim = ctx.sim;
      const powered = ctx.screensPowered !== false;
      for (const key in S) {
        const s = S[key];
        const x = s.ctx;
        const w = s.canvas.width, h = s.canvas.height;
        if (!powered && key !== 'board' && key !== 'gauge') {
          x.fillStyle = '#020304';
          x.fillRect(0, 0, w, h);
          continue;
        }
        const fn = Screens[key] || Screens[key.replace(/[AB]$/, '')];
        if (fn) fn(x, w, h, sim, ctx, key);
      }
    },

    wall(x, w, h, sim, ctx) {
      x.fillStyle = C.bg;
      x.fillRect(0, 0, w, h);
      // header
      x.fillStyle = '#0f1a21';
      x.fillRect(0, 0, w, 58);
      x.fillStyle = C.amber;
      font(x, 30, DISP, 700);
      x.textAlign = 'left';
      x.fillText('UNIT 2 · PLANT OVERVIEW', 22, 40);
      x.textAlign = 'right';
      x.fillStyle = C.text;
      font(x, 30, MONO, 600);
      x.fillText(ctx.clockLabel || '', w - 22, 40);
      x.textAlign = 'left';
      const L = sim.limits;
      const pw = (sim.P * 100).toFixed(1);
      readout(x, 16, 74, 290, 'REACTOR POWER', pw, '% RATED THERMAL', sim.P > 1.06 ? C.red : C.text);
      const short = ctx.demand > 0 && sim.mwe < ctx.demand * 0.95;
      readout(x, 316, 74, 330, 'GENERATOR OUTPUT', U.fmtInt(sim.mwe), 'MWe', short ? C.amber : C.green, 'DEMAND ' + U.fmtInt(ctx.demand));
      readout(x, 656, 74, 270, 'TAVG', sim.Tw.toFixed(1), '°C · BAND 295–305', sim.Tw > L.tavgHigh || sim.Tw < L.tavgLow ? C.red : sim.Tw > L.tavgBandHi || sim.Tw < L.tavgBandLo ? C.amber : C.green);
      readout(x, 936, 74, 280, 'FUEL CLAD TEMP', Math.round(sim.Tc).toString(), '°C · LIMIT 345', sim.Tc > L.cladTrip ? C.red : sim.Tc > L.cladWarn ? C.amber : C.text);
      readout(x, 1226, 74, 294, 'RCS PRESSURE', sim.pressure.toFixed(2), 'MPa', sim.pressure > L.porvOpen - 0.15 ? C.amber : C.text, 'INV ' + Math.round(sim.level) + '%');
      // trend
      const tx = 16, ty = 222, tw = 1000, th = 270;
      x.fillStyle = C.panel;
      x.fillRect(tx, ty, tw, th);
      x.strokeStyle = C.line;
      for (let i = 1; i < 4; i++) {
        x.beginPath();
        x.moveTo(tx, ty + (th * i) / 4);
        x.lineTo(tx + tw, ty + (th * i) / 4);
        x.stroke();
      }
      x.fillStyle = C.dim;
      font(x, 22, COND, 600);
      x.fillText('OUTPUT vs DEMAND · LAST 3 MIN', tx + 12, ty + 26);
      const hist = ctx.history || [];
      const plot = (key, color, dash) => {
        if (hist.length < 2) return;
        x.strokeStyle = color;
        x.lineWidth = 3;
        x.setLineDash(dash || []);
        x.beginPath();
        hist.forEach((p, i) => {
          const px = tx + (i / (180 - 1)) * tw;
          const py = ty + th - (Math.min(1250, p[key]) / 1250) * (th - 34);
          if (i === 0) x.moveTo(px, py);
          else x.lineTo(px, py);
        });
        x.stroke();
        x.setLineDash([]);
      };
      plot('demand', '#8aa0ab', [10, 8]);
      plot('mwe', C.amber);
      // alarms
      const ax = 1032, aw = w - ax - 16;
      x.fillStyle = C.panel;
      x.fillRect(ax, ty, aw, th);
      x.fillStyle = C.dim;
      font(x, 22, COND, 600);
      x.fillText('ACTIVE ALARMS', ax + 12, ty + 26);
      const al = (ctx.alarms || []).slice().sort((a, b) => b.sev - a.sev).slice(0, 7);
      if (!al.length) {
        x.fillStyle = C.green;
        font(x, 26, COND, 600);
        x.fillText('NONE · ALL SYSTEMS NORMAL', ax + 12, ty + 66);
      }
      const blink = Math.floor(Date.now() / 400) % 2;
      al.forEach((a, i) => {
        const col = a.sev >= 3 ? C.red : a.sev === 2 ? C.amber : C.cyan;
        x.fillStyle = a.sev >= 2 && blink ? col : 'rgba(255,255,255,0.06)';
        x.fillRect(ax + 12, ty + 40 + i * 32, 10, 24);
        x.fillStyle = col;
        fitText(x, a.label, ax + 32, ty + 60 + i * 32, aw - 44, 25, COND, 700);
      });
      if (ctx.crisis) {
        x.fillStyle = blink ? 'rgba(255,77,77,0.92)' : 'rgba(120,20,20,0.92)';
        x.fillRect(0, 0, w, 58);
        x.fillStyle = '#fff';
        font(x, 34, DISP, 700);
        x.fillText('STATION BLACKOUT · EOP-0 IN EFFECT · ' + ctx.crisisLabel, 22, 42);
      }
    },

    console(x, w, h, sim, ctx) {
      x.fillStyle = C.bg;
      x.fillRect(0, 0, w, h);
      const pane = (px, title) => {
        x.fillStyle = C.panel;
        x.fillRect(px, 8, 330, h - 16);
        x.fillStyle = C.dim;
        font(x, 22, COND, 700);
        x.textAlign = 'left';
        x.fillText(title, px + 12, 34);
      };
      pane(8, 'CONTROL ROD BANK D');
      x.fillStyle = '#1b2a33';
      x.fillRect(24, 50, 50, 180);
      x.fillStyle = C.cyan;
      const rh = (sim.rods / 100) * 180;
      x.fillRect(24, 230 - rh, 50, rh);
      x.strokeStyle = C.amber;
      x.lineWidth = 3;
      const ty = 230 - (sim.rodTarget / 100) * 180;
      x.beginPath();
      x.moveTo(18, ty);
      x.lineTo(80, ty);
      x.stroke();
      x.fillStyle = C.text;
      font(x, 54, MONO, 600);
      x.fillText(sim.rods.toFixed(1) + '%', 96, 130);
      x.fillStyle = C.dim;
      font(x, 22, COND, 500);
      x.fillText('WITHDRAWN · TARGET ' + sim.rodTarget.toFixed(0) + '%', 96, 164);
      x.fillText(sim.rodLock ? 'ROD CONTROL LOCKED' : sim.scrammed ? 'TRIPPED · ALL RODS IN' : 'MANUAL CONTROL', 96, 196);

      pane(347, 'TURBINE / GENERATOR');
      x.fillStyle = sim.turbineTripped ? C.red : C.green;
      font(x, 54, MONO, 600);
      x.fillText(sim.turbineTripped ? 'TRIP' : (sim.turbineLoad * 100).toFixed(0) + '%', 360, 110);
      x.fillStyle = C.text;
      font(x, 34, MONO, 600);
      x.fillText(U.fmtInt(sim.mwe) + ' MWe', 360, 160);
      x.fillStyle = C.dim;
      font(x, 22, COND, 500);
      x.fillText('DEMAND ' + U.fmtInt(ctx.demand) + ' MWe', 360, 196);

      pane(686, 'REACTOR COOLANT SYSTEM');
      x.fillStyle = tempColor(sim);
      font(x, 40, MONO, 600);
      x.fillText('Tavg ' + sim.Tw.toFixed(1), 698, 96);
      x.fillStyle = C.text;
      font(x, 28, MONO, 500);
      x.fillText('Clad ' + Math.round(sim.Tc) + '°C', 698, 136);
      x.fillText(sim.pressure.toFixed(2) + ' MPa', 698, 172);
      x.fillStyle = C.dim;
      font(x, 22, COND, 500);
      x.fillText('FLOW ' + Math.round(sim.flow * 100) + '%  ·  INV ' + Math.round(sim.level) + '%  ·  PORV ' + (sim.porv.indicatorFault ? 'CLOSED' : sim.porv.open ? 'OPEN' : 'CLOSED'), 698, 210);
    },

    annun(x, w, h, sim, ctx) {
      x.fillStyle = '#05080a';
      x.fillRect(0, 0, w, h);
      const tiles = ['TAVG HIGH', 'TAVG LOW', 'CLAD TEMP', 'PRESS HIGH', 'PORV OPEN', 'RCP-B VIB', 'TURB TRIP', 'RX TRIP', 'LOSS OF PWR', 'INV LOW', 'ROD LOCK', 'OVERPOWER'];
      const ids = ['tavgHi', 'tavgLo', 'clad', 'press', 'porv', 'vib', 'turb', 'scram', 'loop', 'inv', 'rodlock', 'overpwr'];
      const active = new Map((ctx.alarms || []).map((a) => [a.id, a.sev]));
      const blink = Math.floor(Date.now() / 350) % 2;
      for (let i = 0; i < 12; i++) {
        const cx = (i % 4) * 128, cy = Math.floor(i / 4) * 85;
        const sev = active.get(ids[i]);
        let bg = '#1a1f22', fg = '#45525a';
        if (sev) {
          bg = sev >= 3 ? (blink ? '#ff4d4d' : '#6a1414') : sev === 2 ? (blink ? '#ffb547' : '#6a4a14') : '#ffe08a';
          fg = '#1a0d00';
        }
        x.fillStyle = bg;
        x.fillRect(cx + 4, cy + 4, 120, 77);
        x.fillStyle = fg;
        x.textAlign = 'center';
        fitText(x, tiles[i], cx + 64, cy + 50, 110, 22, COND, 700);
      }
      x.textAlign = 'left';
    },

    board(x, w, h, sim, ctx) {
      x.fillStyle = '#f4f4ef';
      x.fillRect(0, 0, w, h);
      x.fillStyle = '#1f4f86';
      font(x, 40, '"Barlow Condensed", sans-serif', 700);
      x.fillText('SHIFT BOARD', 26, 52);
      x.fillStyle = '#333';
      font(x, 30, '"Barlow Condensed", sans-serif', 500);
      (ctx.boardLines || []).forEach((l, i) => {
        x.fillStyle = l.startsWith('!') ? '#c0392b' : '#24313a';
        x.fillText(l.replace(/^!/, ''), 30, 104 + i * 44);
      });
    },

    rod(x, w, h, sim) {
      x.fillStyle = C.bg;
      x.fillRect(0, 0, w, h);
      x.fillStyle = C.dim;
      font(x, 30, COND, 700);
      x.fillText('ROD POSITION · BANK D', 20, 44);
      x.fillStyle = C.cyan;
      font(x, 96, MONO, 600);
      x.fillText(sim.rods.toFixed(0) + '%', 20, 150);
      x.fillStyle = tempColor(sim);
      font(x, 34, MONO, 500);
      x.fillText('CLAD ' + Math.round(sim.Tc) + '°C', 20, 210);
      if (sim.rodStuckFloor > 0 && sim.scrammed) {
        x.fillStyle = C.red;
        font(x, 28, COND, 700);
        x.fillText('3 RODS NOT FULLY INSERTED', 250, 210);
      }
    },

    gauge(x, w, h, sim, ctx) {
      const t = ctx.tailpipe || 40;
      x.fillStyle = '#efeee6';
      x.beginPath();
      x.arc(128, 128, 124, 0, Math.PI * 2);
      x.fill();
      x.strokeStyle = '#222';
      x.lineWidth = 6;
      x.stroke();
      const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
      for (let v = 0; v <= 200; v += 20) {
        const a = a0 + (v / 200) * (a1 - a0);
        x.strokeStyle = v >= 100 ? '#c0392b' : '#222';
        x.lineWidth = 4;
        x.beginPath();
        x.moveTo(128 + Math.cos(a) * 96, 128 + Math.sin(a) * 96);
        x.lineTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112);
        x.stroke();
      }
      x.fillStyle = '#222';
      font(x, 22, COND, 700);
      x.textAlign = 'center';
      x.fillText('TAILPIPE °C', 128, 190);
      font(x, 30, MONO, 600);
      x.fillText(Math.round(t), 128, 222);
      const a = a0 + (U.clamp(t, 0, 200) / 200) * (a1 - a0);
      x.strokeStyle = '#c0392b';
      x.lineWidth = 6;
      x.beginPath();
      x.moveTo(128, 128);
      x.lineTo(128 + Math.cos(a) * 90, 128 + Math.sin(a) * 90);
      x.stroke();
      x.fillStyle = '#222';
      x.beginPath();
      x.arc(128, 128, 10, 0, Math.PI * 2);
      x.fill();
      x.textAlign = 'left';
    },

    ao(x, w, h, sim, ctx) {
      const st = ctx.autoOpt;
      x.fillStyle = st === 'killed' ? '#000' : '#0d0716';
      x.fillRect(0, 0, w, h);
      if (st === 'killed') {
        x.fillStyle = '#333';
        font(x, 28, MONO, 600);
        x.textAlign = 'center';
        x.fillText('NO SIGNAL', w / 2, h / 2);
        x.textAlign = 'left';
        return;
      }
      x.textAlign = 'center';
      x.fillStyle = C.magenta;
      font(x, 34, DISP, 700);
      x.fillText('SYNTHEX', w / 2, 60);
      x.fillStyle = '#d9c7ff';
      font(x, 30, DISP, 600);
      x.fillText('AutoOptimize™', w / 2, 98);
      const t = Date.now() / 1000;
      x.strokeStyle = C.magenta;
      x.lineWidth = 4;
      x.beginPath();
      x.arc(w / 2, 200, 54, t * 2, t * 2 + Math.PI * 1.4);
      x.stroke();
      font(x, 22, MONO, 600);
      x.fillStyle = '#d9c7ff';
      if (st === 'on') {
        x.fillText('OPTIMIZING', w / 2, 208);
        font(x, 24, COND, 600);
        x.fillText('EFFICIENCY ' + (98.5 + Math.sin(t) * 0.9).toFixed(1) + '%', w / 2, 300);
        x.fillText('Revenue mode: AGGRESSIVE', w / 2, 334);
        x.fillStyle = C.amber;
        x.fillText('Operator overrides: LOGGED', w / 2, 368);
        if (ctx.crisis) {
          x.fillStyle = Math.floor(t * 3) % 2 ? C.red : '#fff';
          font(x, 26, COND, 700);
          x.fillText('TRIP INHIBIT ACTIVE', w / 2, 420);
          x.fillText('"Protecting output target"', w / 2, 452);
        }
      } else {
        x.fillText('STANDBY', w / 2, 208);
        font(x, 24, COND, 600);
        x.fillText(st === 'pending' ? 'Installer ready' : 'Awaiting install', w / 2, 300);
      }
      x.textAlign = 'left';
    },

    turb(x, w, h, sim) {
      x.fillStyle = C.bg;
      x.fillRect(0, 0, w, h);
      x.fillStyle = C.dim;
      font(x, 24, COND, 700);
      x.fillText('MAIN TURBINE', 16, 32);
      x.fillStyle = sim.turbineTripped ? C.red : C.green;
      font(x, 44, MONO, 600);
      x.fillText(sim.turbineTripped ? 'TRIPPED' : 'ONLINE', 16, 96);
      x.fillStyle = C.text;
      font(x, 30, MONO, 500);
      x.fillText((sim.turbineTripped ? 0 : 1800) + ' rpm', 16, 150);
      x.fillText((sim.turbineLoad * 100).toFixed(0) + '% load', 16, 196);
      x.fillStyle = C.dim;
      font(x, 22, COND, 500);
      x.fillText(sim.turbineTripped ? 'Reset available locally' : 'Governor in AUTO', 16, 236);
    },

    dg(x, w, h, sim, ctx, key) {
      const name = key.slice(-1);
      const st = ctx.dg[name];
      x.fillStyle = C.bg;
      x.fillRect(0, 0, w, h);
      x.fillStyle = C.dim;
      font(x, 24, COND, 700);
      x.fillText('EDG-' + name + ' LOCAL PANEL', 16, 32);
      const label = { off: 'STANDBY', cranking: 'CRANKING', running: 'RUNNING', failed: 'FAILED', sputter: 'START FAIL' }[st] || 'STANDBY';
      x.fillStyle = st === 'running' ? C.green : st === 'failed' || st === 'sputter' ? C.red : st === 'cranking' ? C.amber : C.text;
      font(x, 40, MONO, 600);
      x.fillText(label, 16, 96);
      x.fillStyle = C.text;
      font(x, 26, MONO, 500);
      x.fillText(st === 'running' ? '4,160 V · 60 Hz' : '0 V', 16, 148);
      x.fillStyle = C.dim;
      font(x, 22, COND, 500);
      if (name === 'B') x.fillText('FUEL ISOLATION: ' + (ctx.dgFuelOpen ? 'OPEN' : 'CLOSED'), 16, 196);
      else x.fillText('INJECTOR PUMP: ' + (ctx.dgAFault ? 'FAULT' : 'OK'), 16, 196);
      x.fillText(st === 'running' ? 'Emergency bus 1E energized' : 'Bus 1E de-energized', 16, 232);
    },

    boron(x, w, h, sim, ctx) {
      x.fillStyle = C.bg;
      x.fillRect(0, 0, w, h);
      x.fillStyle = C.dim;
      font(x, 26, COND, 700);
      x.fillText('RCS BORON CONCENTRATION', 16, 36);
      x.fillStyle = C.green;
      font(x, 72, MONO, 600);
      x.fillText(Math.round(sim.boron) + ' ppm', 16, 120);
      x.fillStyle = sim.boronRate > 0 ? C.amber : C.text;
      font(x, 28, COND, 700);
      const status = sim.boronRate > 0 ? 'EMERGENCY BORATION IN PROGRESS' : sim.boron > 2000 ? 'SHUTDOWN MARGIN RESTORED' : sim.hasPower(true) ? 'BORIC ACID PUMPS READY' : 'NO POWER TO BA PUMPS';
      x.fillText(status, 16, 176);
      x.fillStyle = C.dim;
      font(x, 24, COND, 500);
      x.fillText('BAST-A 74% · BAST-B 81%', 16, 220);
    },
  };

  G.Screens = Screens;
})();
