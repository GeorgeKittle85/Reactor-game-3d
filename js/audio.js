/* All sound is synthesized with Web Audio — no files to load. Starts on the first click. */
(function () {
  'use strict';
  const G = window.G;

  class Audio {
    constructor() {
      this.ctx = null;
      this.volume = 0.8;
      this.muted = false;
      this.loops = {};
    }

    start() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(c.destination);
      this.noiseBuf = this._noiseBuffer(2);
      this.brownBuf = this._brownBuffer(4);

      // Ambient: reactor hum + ventilation
      this.loops.hum = this._hum();
      this.loops.vent = this._noiseLoop(this.brownBuf, 'lowpass', 420, 0.0);
      this.loops.turbine = this._turbine();
      this.loops.rain = this._noiseLoop(this.noiseBuf, 'highpass', 1800, 0.0);
      this.loops.diesel = this._diesel();
      this.loops.klaxon = this._klaxon();
      this.loops.steam = this._noiseLoop(this.noiseBuf, 'bandpass', 2500, 0.0);
      this.loops.rumble = this._noiseLoop(this.brownBuf, 'lowpass', 120, 0.0);
    }

    setVolume(v) {
      this.volume = v;
      if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05);
    }

    setMuted(m) {
      this.muted = m;
      this.setVolume(this.volume);
    }

    _noiseBuffer(sec) {
      const c = this.ctx;
      const b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return b;
    }

    _brownBuffer(sec) {
      const c = this.ctx;
      const b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate);
      const d = b.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
      return b;
    }

    _noiseLoop(buf, type, freq, gain) {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      const g = c.createGain();
      g.gain.value = gain;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return { gain: g, filter: f };
    }

    _hum() {
      const c = this.ctx;
      const g = c.createGain();
      g.gain.value = 0;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 300;
      f.connect(g).connect(this.master);
      for (const [fr, type, amp] of [[60, 'sawtooth', 0.25], [120, 'sine', 0.35], [180, 'sine', 0.12]]) {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.value = fr;
        const og = c.createGain();
        og.gain.value = amp;
        o.connect(og).connect(f);
        o.start();
      }
      return { gain: g };
    }

    _turbine() {
      const c = this.ctx;
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 240;
      const o2 = c.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = 482;
      const g = c.createGain();
      g.gain.value = 0;
      o.connect(g);
      o2.connect(g);
      g.connect(this.master);
      o.start();
      o2.start();
      return { gain: g, osc: o, osc2: o2 };
    }

    _diesel() {
      const c = this.ctx;
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 38;
      const lfo = c.createOscillator();
      lfo.frequency.value = 9;
      const lfoG = c.createGain();
      lfoG.gain.value = 0.5;
      const am = c.createGain();
      am.gain.value = 0.5;
      lfo.connect(lfoG).connect(am.gain);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 260;
      const g = c.createGain();
      g.gain.value = 0;
      o.connect(am).connect(f).connect(g).connect(this.master);
      o.start();
      lfo.start();
      return { gain: g, osc: o, lfo };
    }

    _klaxon() {
      const c = this.ctx;
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.value = 440;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1800;
      const g = c.createGain();
      g.gain.value = 0;
      o.connect(f).connect(g).connect(this.master);
      o.start();
      return { gain: g, osc: o };
    }

    _env(node, t, a, peak, d) {
      node.gain.setValueAtTime(0.0001, t);
      node.gain.exponentialRampToValueAtTime(peak, t + a);
      node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    }

    tone(freq, dur, type, vol, delay) {
      if (!this.ctx) return;
      const c = this.ctx;
      const t = c.currentTime + (delay || 0);
      const o = c.createOscillator();
      o.type = type || 'sine';
      o.frequency.value = freq;
      const g = c.createGain();
      o.connect(g).connect(this.master);
      this._env(g, t, 0.005, vol || 0.2, dur);
      o.start(t);
      o.stop(t + dur + 0.05);
    }

    noise(dur, type, freq, vol, delay, q) {
      if (!this.ctx) return;
      const c = this.ctx;
      const t = c.currentTime + (delay || 0);
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      if (q) f.Q.value = q;
      const g = c.createGain();
      src.connect(f).connect(g).connect(this.master);
      this._env(g, t, 0.005, vol, dur);
      src.start(t, Math.random());
      src.stop(t + dur + 0.1);
    }

    // ---- one-shots
    click() {
      this.tone(1400, 0.04, 'square', 0.05);
    }
    confirm() {
      this.tone(660, 0.08, 'sine', 0.12);
      this.tone(990, 0.12, 'sine', 0.12, 0.08);
    }
    deny() {
      this.tone(180, 0.18, 'square', 0.08);
    }
    radio() {
      this.noise(0.08, 'bandpass', 2200, 0.08, 0, 2);
      this.tone(1800, 0.05, 'sine', 0.05, 0.08);
    }
    blip() {
      this.tone(880, 0.05, 'sine', 0.05);
    }
    step(surface) {
      const f = surface === 'carpet' ? 380 : surface === 'metal' ? 1600 : 900;
      this.noise(0.06, 'bandpass', f * (0.9 + Math.random() * 0.2), surface === 'carpet' ? 0.05 : 0.09, 0, 1.5);
    }
    valve() {
      for (let i = 0; i < 3; i++) this.noise(0.12, 'bandpass', 600 + i * 120, 0.06, i * 0.18, 6);
    }
    clunk() {
      this.tone(90, 0.25, 'sine', 0.35);
      this.noise(0.15, 'lowpass', 400, 0.25);
    }
    thunder(dist) {
      const d = dist || 0.5;
      this.noise(0.25, 'highpass', 2000, 0.25 * (1 - d), 0);
      this.noise(2.8, 'lowpass', 180, 0.9 * (1 - d * 0.6), 0.15 + d * 0.6);
      this.noise(1.6, 'lowpass', 90, 0.8, 0.4 + d * 0.6);
    }
    alarmChime() {
      this.tone(988, 0.18, 'square', 0.06);
      this.tone(784, 0.25, 'square', 0.06, 0.2);
    }
    sputter() {
      for (let i = 0; i < 9; i++) this.noise(0.08, 'lowpass', 220, 0.3 * (1 - i / 10), i * 0.17 + Math.random() * 0.05);
    }
    crank() {
      for (let i = 0; i < 6; i++) this.noise(0.1, 'lowpass', 300, 0.25, i * 0.22);
    }
    coffee() {
      this.noise(1.6, 'bandpass', 1200, 0.06, 0, 0.8);
      this.tone(520, 0.12, 'sine', 0.08, 1.7);
    }
    boom() {
      this.noise(4, 'lowpass', 80, 1.0);
      this.noise(1.5, 'lowpass', 600, 0.6);
    }
    victory() {
      [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.12, i * 0.14));
    }
    typeTick() {
      this.tone(2200 + Math.random() * 400, 0.015, 'square', 0.012);
    }

    // ---- continuous mix, called every frame
    update(dt, mix) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const set = (loop, v, tc) => loop.gain.gain.setTargetAtTime(v, t, tc || 0.25);
      const room = mix.room;
      const big = room === 'containment' || room === 'turbine';
      set(this.loops.hum, mix.paused ? 0 : (big ? 0.07 : 0.025) * (mix.power > 0.01 ? 1 : 0.4));
      set(this.loops.vent, mix.paused ? 0 : mix.blackout ? 0.02 : 0.07);
      const turb = room === 'turbine' ? 0.05 : room === 'corridor' ? 0.012 : 0.004;
      set(this.loops.turbine, mix.paused ? 0 : turb * mix.turbineSpeed);
      this.loops.turbine.osc.frequency.setTargetAtTime(120 + 140 * mix.turbineSpeed, t, 0.5);
      this.loops.turbine.osc2.frequency.setTargetAtTime(242 + 282 * mix.turbineSpeed, t, 0.5);
      const rainV = mix.rain ? (room === 'control' || room === 'turbine' ? 0.06 : 0.02) : 0;
      set(this.loops.rain, mix.paused ? 0 : rainV, 0.8);
      const dg = mix.dieselRunning ? (room === 'dg' ? 0.32 : room === 'corridor' ? 0.06 : 0.015) : 0;
      set(this.loops.diesel, mix.paused ? 0 : dg, 0.4);
      // klaxon warble
      const kv = mix.klaxon && !mix.paused ? 0.045 : 0;
      set(this.loops.klaxon, kv, 0.05);
      if (kv > 0) this.loops.klaxon.osc.frequency.setValueAtTime(Math.floor(t * 2) % 2 ? 560 : 420, t);
      set(this.loops.steam, mix.paused ? 0 : mix.steamLeak ? (room === 'containment' ? 0.12 : 0.01) : 0, 0.4);
      set(this.loops.rumble, mix.paused ? 0 : mix.rumble || 0, 0.5);
    }
  }

  G.Audio = Audio;
})();
