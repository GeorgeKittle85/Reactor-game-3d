/* Shared helpers: math, procedural canvas textures, signs. */
(function () {
  'use strict';
  const G = (window.G = window.G || {});

  const U = {
    clamp: (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v),
    lerp: (a, b, t) => a + (b - a) * t,
    smooth: (t) => t * t * (3 - 2 * t),
    rand: (a, b) => a + Math.random() * (b - a),
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    fmtClock(min) {
      const m = Math.floor(min);
      const h = Math.floor(m / 60) % 24;
      const mm = m % 60;
      return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    },
    fmtTimer(sec) {
      const s = Math.max(0, Math.floor(sec));
      return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    },
    fmtInt(n) {
      return Math.round(n).toLocaleString('en-US');
    },
    // Piecewise-linear lookup over [[x, y], ...]
    curve(points, x) {
      if (x <= points[0][0]) return points[0][1];
      for (let i = 1; i < points.length; i++) {
        if (x <= points[i][0]) {
          const [x0, y0] = points[i - 1];
          const [x1, y1] = points[i];
          return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
        }
      }
      return points[points.length - 1][1];
    },
    storage: {
      get(key, fallback) {
        try {
          const v = window.localStorage.getItem(key);
          return v ? JSON.parse(v) : fallback;
        } catch (e) {
          return fallback;
        }
      },
      set(key, value) {
        try {
          window.localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
          /* storage unavailable: progress lasts for this session only */
        }
      },
    },
  };

  // ---------------------------------------------------------------- textures
  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  U.canvas = canvas;

  function noise(ctx, w, h, amount, alpha) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * amount;
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n;
      if (alpha) d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  function toTexture(c, repeat) {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    t.encoding = THREE.sRGBEncoding;
    if (repeat) t.repeat.set(repeat, repeat);
    return t;
  }
  U.toTexture = toTexture;

  const texCache = {};
  U.tex = function (name) {
    if (texCache[name]) return texCache[name];
    const f = TEX[name];
    texCache[name] = f();
    return texCache[name];
  };

  const TEX = {
    // Painted concrete block wall (1 tile = 2 m)
    block() {
      const c = canvas(256, 256);
      const x = c.getContext('2d');
      x.fillStyle = '#b9bdb6';
      x.fillRect(0, 0, 256, 256);
      noise(x, 256, 256, 14);
      x.strokeStyle = 'rgba(70,72,68,0.35)';
      x.lineWidth = 2;
      for (let r = 0; r < 8; r++) {
        const y = r * 32;
        x.beginPath();
        x.moveTo(0, y);
        x.lineTo(256, y);
        x.stroke();
        const off = r % 2 ? 0 : 64;
        for (let k = 0; k < 3; k++) {
          const xx = off + k * 128;
          x.beginPath();
          x.moveTo(xx, y);
          x.lineTo(xx, y + 32);
          x.stroke();
        }
      }
      return toTexture(c);
    },
    // Raw concrete (1 tile = 4 m)
    concrete() {
      const c = canvas(256, 256);
      const x = c.getContext('2d');
      x.fillStyle = '#8f938f';
      x.fillRect(0, 0, 256, 256);
      noise(x, 256, 256, 26);
      for (let i = 0; i < 40; i++) {
        x.fillStyle = `rgba(${60 + Math.random() * 40},${60 + Math.random() * 40},${55 + Math.random() * 40},0.06)`;
        x.beginPath();
        x.arc(Math.random() * 256, Math.random() * 256, 10 + Math.random() * 40, 0, Math.PI * 2);
        x.fill();
      }
      x.strokeStyle = 'rgba(40,40,40,0.25)';
      x.lineWidth = 1;
      x.strokeRect(0.5, 0.5, 255, 255);
      return toTexture(c);
    },
    // Epoxy painted plant floor (1 tile = 4 m)
    epoxy() {
      const c = canvas(256, 256);
      const x = c.getContext('2d');
      x.fillStyle = '#6f7d76';
      x.fillRect(0, 0, 256, 256);
      noise(x, 256, 256, 12);
      x.strokeStyle = 'rgba(30,35,32,0.35)';
      x.lineWidth = 2;
      x.strokeRect(1, 1, 254, 254);
      for (let i = 0; i < 12; i++) {
        x.strokeStyle = 'rgba(20,20,20,0.06)';
        x.lineWidth = 6 + Math.random() * 10;
        x.beginPath();
        const y = Math.random() * 256;
        x.moveTo(0, y);
        x.bezierCurveTo(80, y + 20, 160, y - 20, 256, y + Math.random() * 10);
        x.stroke();
      }
      return toTexture(c);
    },
    // Vinyl tiles (1 tile = 1.2 m)
    vinyl() {
      const c = canvas(128, 128);
      const x = c.getContext('2d');
      x.fillStyle = '#c9c8bd';
      x.fillRect(0, 0, 128, 128);
      noise(x, 128, 128, 10);
      x.fillStyle = 'rgba(120,110,90,0.12)';
      for (let i = 0; i < 30; i++) x.fillRect(Math.random() * 128, Math.random() * 128, 3, 2);
      x.strokeStyle = 'rgba(80,80,70,0.4)';
      x.strokeRect(0.5, 0.5, 127, 127);
      return toTexture(c);
    },
    // Control room carpet tile (1 tile = 0.6 m)
    carpet() {
      const c = canvas(128, 128);
      const x = c.getContext('2d');
      x.fillStyle = '#2c3640';
      x.fillRect(0, 0, 128, 128);
      noise(x, 128, 128, 22);
      x.strokeStyle = 'rgba(0,0,0,0.25)';
      x.strokeRect(0.5, 0.5, 127, 127);
      return toTexture(c);
    },
    ceiling() {
      const c = canvas(128, 128);
      const x = c.getContext('2d');
      x.fillStyle = '#d7d8d2';
      x.fillRect(0, 0, 128, 128);
      noise(x, 128, 128, 8);
      x.strokeStyle = 'rgba(90,90,90,0.5)';
      x.lineWidth = 2;
      x.strokeRect(1, 1, 126, 126);
      return toTexture(c);
    },
    hazard() {
      const c = canvas(128, 32);
      const x = c.getContext('2d');
      x.fillStyle = '#f2c230';
      x.fillRect(0, 0, 128, 32);
      x.fillStyle = '#1b1b1b';
      for (let i = -2; i < 10; i++) {
        x.beginPath();
        x.moveTo(i * 16, 32);
        x.lineTo(i * 16 + 8, 32);
        x.lineTo(i * 16 + 24, 0);
        x.lineTo(i * 16 + 16, 0);
        x.closePath();
        x.fill();
      }
      return toTexture(c);
    },
    grass() {
      const c = canvas(256, 256);
      const x = c.getContext('2d');
      x.fillStyle = '#4b5a3a';
      x.fillRect(0, 0, 256, 256);
      noise(x, 256, 256, 30);
      return toTexture(c);
    },
    asphalt() {
      const c = canvas(256, 256);
      const x = c.getContext('2d');
      x.fillStyle = '#3a3c3e';
      x.fillRect(0, 0, 256, 256);
      noise(x, 256, 256, 30);
      return toTexture(c);
    },
    // Server rack front with LEDs
    rack() {
      const c = canvas(128, 256);
      const x = c.getContext('2d');
      x.fillStyle = '#16191d';
      x.fillRect(0, 0, 128, 256);
      for (let r = 0; r < 20; r++) {
        const y = 8 + r * 12;
        x.fillStyle = r % 3 === 0 ? '#23282e' : '#1d2126';
        x.fillRect(8, y, 112, 10);
        for (let k = 0; k < 6; k++) {
          x.fillStyle = Math.random() > 0.3 ? (Math.random() > 0.8 ? '#ffb547' : '#4be38f') : '#0d2a1a';
          x.fillRect(14 + k * 7, y + 3, 3, 3);
        }
      }
      const t = new THREE.CanvasTexture(c);
      t.encoding = THREE.sRGBEncoding;
      return t;
    },
    // Fuel pool rack grid seen through water
    poolRacks() {
      const c = canvas(256, 256);
      const x = c.getContext('2d');
      x.fillStyle = '#0a4a6a';
      x.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 16; i++) {
        for (let j = 0; j < 16; j++) {
          const lit = Math.random();
          x.fillStyle = lit > 0.15 ? `rgba(120,220,255,${0.35 + lit * 0.4})` : '#06324a';
          x.fillRect(i * 16 + 2, j * 16 + 2, 12, 12);
        }
      }
      const t = new THREE.CanvasTexture(c);
      t.encoding = THREE.sRGBEncoding;
      return t;
    },
  };

  // Text sign / label on a plane.
  U.signTexture = function (lines, opts) {
    opts = opts || {};
    const w = opts.w || 512;
    const h = opts.h || 128;
    const c = canvas(w, h);
    const x = c.getContext('2d');
    x.fillStyle = opts.bg || '#1f4f86';
    x.fillRect(0, 0, w, h);
    if (opts.border !== false) {
      x.strokeStyle = opts.borderColor || 'rgba(255,255,255,0.85)';
      x.lineWidth = Math.max(4, h * 0.04);
      x.strokeRect(x.lineWidth, x.lineWidth, w - x.lineWidth * 2, h - x.lineWidth * 2);
    }
    x.fillStyle = opts.fg || '#ffffff';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    const arr = Array.isArray(lines) ? lines : [lines];
    const size = opts.size || Math.floor((h * 0.62) / arr.length);
    arr.forEach((line, i) => {
      const s = i === 0 ? size : Math.floor(size * (opts.subScale || 0.6));
      x.font = `${opts.weight || 700} ${s}px ${opts.font || '"Barlow Condensed", "Arial Narrow", sans-serif'}`;
      const y = arr.length === 1 ? h / 2 : h * ((i + 0.5) / arr.length) + (i === 0 ? h * 0.04 : -h * 0.02);
      x.fillText(line, w / 2, y);
    });
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  };

  U.noise = noise;
  G.U = U;
})();
