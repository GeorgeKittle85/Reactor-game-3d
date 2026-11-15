/*
 * Reactor simulation for Cedar Hollow Unit 2 (a pressurized water reactor).
 *
 * This is a game model, not an engineering code, but it keeps the shape of the
 * real thing so the controls behave the way a PWR operator would expect:
 *   - The turbine load decides how much steam (and electricity) you take.
 *   - The reactor follows that load through moderator temperature feedback.
 *   - Control rods and boron therefore set *temperature* (Tavg), not power.
 *   - After a shutdown, decay heat keeps producing ~6% power, fading slowly.
 *   - Losing coolant inventory uncovers the core and the fuel heats up fast.
 *
 * Pure JavaScript with no DOM or THREE dependency so it can be unit-tested in Node.
 */
(function (root) {
  'use strict';

  const QNOM = 3400;        // rated thermal power, MWt
  const EFF = 0.33;         // thermal-to-electric efficiency
  const H_CORE = 113;       // core-to-coolant heat transfer at full flow, MW/°C
  const C_CORE = 25;        // fuel + cladding heat capacity, MJ/°C
  const C_COOL = 1200;      // primary coolant heat capacity, MJ/°C
  const ALPHA = 0.002;      // moderator temperature coefficient (reactivity per °C)
  const BETA = 0.06;        // power (Doppler) coefficient (reactivity per unit power)
  const ROD_WORTH = 0.10;   // total worth of the controlling bank (~1 °C of Tavg per 1% of travel)
  const ROD_REF = 0.55;     // rod position that is critical at full power, 300 °C, 1000 ppm
  const BORON_REF = 1000;   // ppm
  const BORON_WORTH = 0.00005; // reactivity per ppm
  const DECAY_GROUPS = [
    { a: 0.025, tau: 10 },
    { a: 0.020, tau: 80 },
    { a: 0.030, tau: 1200 },
  ];
  const DECAY_FRACTION = DECAY_GROUPS.reduce((s, g) => s + g.a, 0);

  const LIMITS = {
    tavgLow: 290, tavgBandLo: 295, tavgBandHi: 305, tavgHigh: 310, tavgTrip: 314,
    cladWarn: 345, cladTrip: 362, cladDamage: 700, cladMelt: 1200,
    pressNominal: 15.5, porvOpen: 16.45, porvClose: 15.9, pressTrip: 16.9,
    overpower: 1.15, inventoryLow: 60,
  };

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // Integral of a cosine-shaped rod worth curve: rods are most effective mid-core.
  function rodShape(x) {
    x = clamp(x, 0, 1);
    return x - Math.sin(2 * Math.PI * x) / (2 * Math.PI);
  }
  const ROD_SHAPE_REF = rodShape(ROD_REF);

  function rodReactivity(posPct) {
    return ROD_WORTH * (rodShape(posPct / 100) - ROD_SHAPE_REF);
  }

  function boronReactivity(ppm) {
    return -(ppm - BORON_REF) * BORON_WORTH;
  }

  // Rod position (percent withdrawn) that gives the requested reactivity.
  function rodsForReactivity(rho) {
    let lo = 0, hi = 100;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (rodReactivity(mid) < rho) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // How much heat the steam generators can hand over at a given average coolant temperature.
  function sgCapacity(tavg) {
    return clamp((tavg - 280) / 18, 0, 1.4);
  }

  class Reactor {
    constructor(opts) {
      this.reset(opts || {});
    }

    reset(opts) {
      const power = opts.power != null ? opts.power : 0.75;
      this.t = 0;
      this.events = [];
      this.limits = LIMITS;

      // Controls
      this.boron = opts.boron != null ? opts.boron : BORON_REF;
      this.boronTarget = this.boron;
      this.boronRate = 0;          // ppm/s while emergency boration runs
      this.rodLock = false;        // rods frozen (AutoOptimize)
      this.rodSpeed = 1.6;         // %/s
      this.rodStuckFloor = 0;      // rods that will not insert past this on a scram
      this.sdWorth = 0.06;         // shutdown banks that drop on a trip
      this.sdEffect = 1;           // fraction of the shutdown banks that actually insert
      this.turbineTarget = power;
      this.turbineLoad = power;
      this.turbineTripped = false;
      this.turbineRate = 0.025;    // fraction per second
      this.condenserFactor = opts.condenserFactor != null ? opts.condenserFactor : 1;

      this.pumps = [
        { name: 'A', target: 1, eff: 1, powered: true, seized: false, running: true, emergencyBus: true, restarted: false, vibration: 0.6 },
        { name: 'B', target: 1, eff: 1, powered: true, seized: false, running: true, emergencyBus: false, restarted: false, vibration: 0.9 },
      ];
      this.pumpBWorn = false;

      this.offsitePower = true;
      this.emergencyPower = false;
      this.auxFeed = false;
      this.eccsValve = false;
      this.steamDumpCap = 0.4;
      this.steamDumpDecay = false; // dumps lose capacity while they carry load (Day 3)
      this.runbackEnabled = true;
      this.runback = false;
      this.sgReserve = 30000;      // MJ of steam generator boil-off when feedwater is lost

      this.porv = { open: false, stuck: false, stickArmed: false, blocked: false, indicatorFault: false, cycles: 0 };

      this.scrammed = false;
      this.scramTime = 0;
      this.scramReason = '';
      this.autoScram = true;
      this.scramInhibit = false;
      this.scramCount = 0;

      // State
      this.P = power;
      this.decay = DECAY_GROUPS.map(g => g.a * power);
      this.Tw = 300;
      this.Tc = 300 + 30 * power;
      this.pressure = LIMITS.pressNominal;
      this.level = 100;
      this.flow = 1;

      // Rods for a 300 °C equilibrium at this power
      const rhoRods = BETA * (power - 1) - boronReactivity(this.boron);
      this.rods = rodsForReactivity(rhoRods);
      this.rodTarget = this.rods;

      this.meltdown = false;
      this.peakClad = this.Tc;
      this.demand = opts.demand != null ? opts.demand : 800;
      this._computeOutputs();
    }

    // ---- Commands -------------------------------------------------------
    scram(reason) {
      if (this.scrammed) return false;
      if (this.scramInhibit) {
        if (reason === 'MANUAL' || this.t - (this._inhibitT || -99) > 15) {
          this._inhibitT = this.t;
          this._event('scramInhibited', reason || 'MANUAL');
        }
        return false;
      }
      this.scrammed = true;
      this.scramTime = this.t;
      this.scramReason = reason || 'MANUAL';
      this.scramCount++;
      this.rodTarget = this.rodStuckFloor;
      this.tripTurbine('REACTOR TRIP');
      this._event('scram', this.scramReason);
      return true;
    }

    canResetScram() {
      return this.scrammed && this.t - this.scramTime > 20 && !this._tripCondition();
    }

    resetScram() {
      if (!this.canResetScram()) return false;
      this.scrammed = false;
      this.rodTarget = this.rods;
      this._event('scramReset');
      return true;
    }

    tripTurbine(reason) {
      if (this.turbineTripped) return;
      this.turbineTripped = true;
      this.turbineTarget = 0;
      this.turbineLoad = 0;
      this.steamDumpCap = 0.4;
      // Automatic runback: drive rods in fast enough to bring power near what the dumps can take.
      if (!this.scrammed && !this.rodLock && this.runbackEnabled) {
        const rhoNeeded = BETA * (0.42 - 1) + ALPHA * (this.Tw - 300) - boronReactivity(this.boron);
        const pos = rodsForReactivity(rhoNeeded);
        if (pos < this.rods) {
          this.rodTarget = pos;
          this.runback = true;
        }
      }
      this._event('turbineTrip', reason || 'TURBINE TRIP');
    }

    resetTurbine() {
      if (!this.turbineTripped || !this.offsitePower) return false;
      this.turbineTripped = false;
      this.turbineTarget = 0;
      this.turbineLoad = 0;
      this._event('turbineReset');
      return true;
    }

    setRodTarget(v) {
      if (this.scrammed) return;
      this.rodTarget = clamp(v, 0, 100);
    }

    setTurbineTarget(v) {
      if (this.turbineTripped) return;
      this.turbineTarget = clamp(v, 0, 1.05);
    }

    setPump(i, v) {
      this.pumps[i].target = clamp(v, 0, 1);
    }

    loseOffsitePower() {
      if (!this.offsitePower) return;
      this.offsitePower = false;
      this._event('loop');
      this.tripTurbine('LOSS OF OFFSITE POWER');
      if (this.autoScram) this.scram('LOSS OF OFFSITE POWER');
    }

    startBoration(totalPpm) {
      this.boronTarget = this.boron + totalPpm;
      this.boronRate = 30;
    }

    // ---- Simulation -----------------------------------------------------
    step(dt) {
      const n = Math.max(1, Math.ceil(dt / 0.02));
      const h = dt / n;
      for (let i = 0; i < n; i++) this._substep(h);
      this._computeOutputs();
    }

    _event(type, data) {
      this.events.push({ type, data, t: this.t });
    }

    drainEvents() {
      const e = this.events;
      this.events = [];
      return e;
    }

    hasPower(emergencyOk) {
      return this.offsitePower || (emergencyOk && this.emergencyPower);
    }

    _tripCondition() {
      const L = LIMITS;
      if (this.Tc > L.cladTrip) return 'CLAD TEMP HIGH';
      if (this.Tw > L.tavgTrip) return 'OVERTEMPERATURE';
      if (this.pressure > L.pressTrip) return 'PRESSURE HIGH';
      if (this.P > L.overpower) return 'OVERPOWER';
      if (this.flow < 0.55 && this.P > 0.5) return 'LOW FLOW';
      return '';
    }

    _substep(dt) {
      this.t += dt;
      const L = LIMITS;

      // Rods
      if (this.scrammed) {
        const floor = this.rodStuckFloor;
        this.rods = Math.max(floor, this.rods - 45 * dt);
      } else if (!this.rodLock) {
        const d = this.rodTarget - this.rods;
        const m = (this.runback ? 4 : this.rodSpeed) * dt;
        this.rods += clamp(d, -m, m);
        if (this.runback && Math.abs(d) < 0.05) this.runback = false;
      }

      // Boron
      if (this.boronRate > 0) {
        if (this.hasPower(true)) {
          this.boron = Math.min(this.boronTarget, this.boron + this.boronRate * dt);
          if (this.boron >= this.boronTarget) {
            this.boronRate = 0;
            this._event('borationDone');
          }
        }
      }

      // Pumps
      let flowSum = 0;
      for (const p of this.pumps) {
        p.powered = this.offsitePower || (this.emergencyPower && p.emergencyBus && p.restarted);
        const want = p.running && p.powered && !p.seized ? p.target : 0;
        const tau = want > p.eff ? 3 : 10;
        p.eff += (want - p.eff) * Math.min(1, dt / tau);
        flowSum += p.eff;
      }
      this.flow = flowSum / 2;
      const pb = this.pumps[1];
      const vibTarget = this.pumpBWorn ? (pb.eff > 0.78 ? 2 + (pb.eff - 0.78) * 30 : 1.1 + pb.eff * 0.6) : 0.5 + pb.eff * 0.4;
      pb.vibration += (vibTarget - pb.vibration) * Math.min(1, dt / 4);
      const pa = this.pumps[0];
      pa.vibration += (0.4 + pa.eff * 0.3 - pa.vibration) * Math.min(1, dt / 4);

      // Reactivity and power
      const rhoSd = this.scrammed ? -this.sdWorth * this.sdEffect : 0;
      const rhoExt = rodReactivity(this.rods) + boronReactivity(this.boron) + rhoSd;
      this.rho = rhoExt - ALPHA * (this.Tw - 300) - BETA * (this.P - 1);
      const pEq = 1 + (rhoExt - ALPHA * (this.Tw - 300)) / BETA;
      const target = Math.max(0, pEq);
      let dP;
      if (target >= this.P) {
        // Rate limits: prompt response near power, a startup-rate limit when subcritical-ish.
        dP = Math.min((target - this.P) / 3, 0.02 + this.P * 0.025, this.P / 15 + 0.0003);
      } else if (pEq <= 0) {
        const tau = this.P > 0.07 ? 1.0 : 25;
        dP = -this.P / tau;
      } else {
        dP = (target - this.P) / 3;
      }
      this.P = Math.max(1e-5, this.P + dP * dt);
      this.pEq = pEq;

      for (let i = 0; i < DECAY_GROUPS.length; i++) {
        const g = DECAY_GROUPS[i];
        this.decay[i] += (g.a * this.P - this.decay[i]) * (dt / g.tau);
      }
      const decaySum = this.decay[0] + this.decay[1] + this.decay[2];
      this.decayHeat = decaySum;
      // Above ~900 °C zirconium cladding reacts with steam and adds its own heat.
      const Qox = this.Tc > 900 ? (this.Tc - 900) * 1.5 : 0;
      const Qgen = QNOM * (this.P * (1 - DECAY_FRACTION) + decaySum) + Qox;

      // Core-to-coolant heat transfer
      const f = 0.06 + 0.94 * this.flow;
      // Below ~60% inventory the top of the core starts to uncover; below ~22% it is mostly dry.
      let cover;
      if (this.level >= L.inventoryLow) cover = 1;
      else if (this.level >= 22) cover = 0.02 + 0.98 * (this.level - 22) / (L.inventoryLow - 22);
      else cover = 0.003 + 0.017 * this.level / 22;
      this.cover = cover;
      const Qcw = H_CORE * f * cover * (this.Tc - this.Tw);

      // Heat sinks
      // Turbine
      if (!this.turbineTripped) {
        const d = this.turbineTarget - this.turbineLoad;
        const m = this.turbineRate * dt;
        this.turbineLoad += clamp(d, -m, m);
      }
      const cap = sgCapacity(this.Tw);
      let Qturb = 0, Qdump = 0, Qatm = 0, Qaux = 0, Qeccs = 0, Qporv = 0;
      const feedwater = this.offsitePower;
      if (!this.turbineTripped && feedwater) {
        Qturb = Math.min(this.turbineLoad * QNOM, cap * QNOM);
      }
      if (this.turbineTripped && this.offsitePower) {
        if (this.steamDumpDecay) this.steamDumpCap += (0.08 - this.steamDumpCap) * (dt / 50);
        Qdump = clamp((this.Tw - 291) * 400, 0, this.steamDumpCap * QNOM);
      }
      if (this.auxFeed && this.hasPower(true)) {
        // Operators hold a controlled cooldown toward ~262 °C.
        Qaux = clamp((this.Tw - 262) * 40, 0, 0.12 * QNOM * clamp((this.Tw - 220) / 60, 0, 1.3));
      }
      if (!feedwater && !this.auxFeed && this.sgReserve > 0) {
        Qatm = clamp((this.Tw - 286) * 300, 0, 0.12 * QNOM);
        this.sgReserve -= Qatm * dt;
      }
      // ECCS injection (cold borated water)
      const eccsFlowing = this.eccsValve && this.hasPower(true) && this.level < 99.5;
      if (eccsFlowing) {
        Qeccs = 0.05 * QNOM * clamp((this.Tw - 30) / 270, 0, 1.2);
      }

      // PORV
      const porv = this.porv;
      if (!porv.stuck) {
        if (!porv.open && this.pressure > L.porvOpen) {
          porv.open = true;
          porv.cycles++;
          this._event('porvOpen');
          if (porv.stickArmed) {
            porv.stuck = true;
            this._event('porvStuck');
          }
        } else if (porv.open && this.pressure < L.porvClose) {
          porv.open = false;
          this._event('porvClose');
        }
      }
      const porvFlowing = porv.open && !porv.blocked;
      this.porvFlowing = porvFlowing;
      if (porvFlowing) Qporv = 0.045 * QNOM * clamp(this.pressure / 15.5, 0.2, 1.2);

      // Inventory
      let dLevel = 0;
      if (porvFlowing) dLevel -= 0.4 * clamp(this.pressure / 15.5, 0.3, 1.2);
      if (this.hasPower(true) && this.level < 100) dLevel += 0.12; // charging pumps
      if (eccsFlowing) dLevel += 1.4;
      this.level = clamp(this.level + dLevel * dt, 0, 100);

      // Temperatures
      this.Tc += (Qgen - Qcw) / C_CORE * dt;
      if (this.Tc > 2865) this.Tc = 2865; // UO2 melting point: the model stops meaning anything past here
      const Qsink = Qturb + Qdump + Qatm + Qaux + Qeccs + Qporv;
      this.Tw += (Qcw - Qsink) / C_COOL * dt;
      if (this.Tw < 40) this.Tw = 40;
      if (this.Tc < this.Tw) this.Tc = this.Tw;

      // Pressure follows coolant temperature (pressurizer), drops when venting or voiding.
      let pTarget = 15.5 + 0.09 * (this.Tw - 300);
      if (porvFlowing) pTarget -= 1.6;
      if (this.level < L.inventoryLow) pTarget -= (L.inventoryLow - this.level) * 0.09;
      pTarget = clamp(pTarget, 0.5, 18.5);
      this.pressure += (pTarget - this.pressure) * Math.min(1, dt / 2.5);

      this.Q = { gen: Qgen, cw: Qcw, turb: Qturb, dump: Qdump, atm: Qatm, aux: Qaux, eccs: Qeccs, porv: Qporv };

      if (this.Tc > this.peakClad) this.peakClad = this.Tc;
      if (this.Tc > L.cladDamage) this.coreDamage = Math.min(1, (this.coreDamage || 0) + (this.Tc - L.cladDamage) / 500 * dt / 60);

      // Protection system
      if (this.autoScram && !this.scrammed) {
        const reason = this._tripCondition();
        if (reason) this.scram(reason);
      }
      if (!this.meltdown && this.Tc >= L.cladMelt) {
        this.meltdown = true;
        this._event('meltdown');
      }
    }

    _computeOutputs() {
      const Q = this.Q ? this.Q.turb : this.turbineLoad * QNOM;
      this.mwe = this.offsitePower && !this.turbineTripped ? Q * EFF * this.condenserFactor : 0;
      this.thermalMW = this.Q ? this.Q.gen : this.P * QNOM;
    }

    // Annunciator states for the console and HUD.
    alarms() {
      const L = LIMITS;
      const a = [];
      const add = (id, label, sev) => a.push({ id, label, sev });
      if (this.meltdown) add('melt', 'CORE DAMAGE', 3);
      if (this.scrammed) add('scram', 'REACTOR TRIP', 2);
      if (!this.offsitePower) add('loop', 'LOSS OF OFFSITE PWR', 3);
      if (this.turbineTripped && !this.scrammed && this.offsitePower) add('turb', 'TURBINE TRIP', 2);
      if (this.Tc > L.cladWarn) add('clad', 'CLAD TEMP HIGH', this.Tc > L.cladTrip ? 3 : 2);
      if (this.Tw > L.tavgHigh) add('tavgHi', 'TAVG HIGH', 2);
      else if (this.Tw > L.tavgBandHi + 0.5) add('tavgHi', 'TAVG ABOVE BAND', 1);
      if (this.Tw < L.tavgLow && !this.scrammed && this.offsitePower) add('tavgLo', 'TAVG LOW', 1);
      else if (this.Tw < L.tavgBandLo - 0.5 && !this.scrammed && this.offsitePower) add('tavgLo', 'TAVG BELOW BAND', 1);
      if (this.pressure > L.porvOpen - 0.15) add('press', 'PRESSURE HIGH', 2);
      if (this.porv.open && !this.porv.indicatorFault) add('porv', 'PORV OPEN', 2);
      if (this.level < 90) add('inv', 'RCS INVENTORY LOW', this.level < L.inventoryLow ? 3 : 2);
      if (this.pumps[1].vibration > 2.2) add('vib', 'RCP-B VIBRATION', 2);
      if (this.pumps[1].seized) add('seize', 'RCP-B LOCKED ROTOR', 3);
      if (this.flow < 0.5 && this.offsitePower) add('flow', 'RCS FLOW LOW', 2);
      if (this.rodLock) add('rodlock', 'ROD CONTROL LOCKED', 2);
      if (this.P > 1.06) add('overpwr', 'OVERPOWER', 2);
      return a;
    }

    snapshot() {
      return {
        t: this.t, P: this.P, Tw: this.Tw, Tc: this.Tc, pressure: this.pressure, level: this.level,
        rods: this.rods, rodTarget: this.rodTarget, boron: this.boron, flow: this.flow,
        turbineLoad: this.turbineLoad, turbineTarget: this.turbineTarget, mwe: this.mwe,
        scrammed: this.scrammed, porvOpen: this.porv.open, meltdown: this.meltdown,
      };
    }
  }

  const api = { Reactor, LIMITS, QNOM, EFF, rodReactivity, rodsForReactivity, boronReactivity, sgCapacity, clamp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.G = root.G || {};
    root.G.Sim = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
