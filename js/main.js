/* Game loop, input, interactions, scoring and the glue between sim, world, story and UI. */
(function () {
  'use strict';
  const G = window.G;
  const U = G.U;
  const $ = (id) => document.getElementById(id);
  const SAVE_KEY = 'coldShutdown.save.v1';
  const MIN_PER_SEC = 720 / 300; // a 12-hour shift in about 5 minutes

  const SHORT = {
    mainConsole: 'Main console', autoOpt: 'AutoOptimize™', pumpA: 'RCP-A', pumpB: 'RCP-B', porvValve: 'PORV block valve',
    porvGauge: 'PORV gauge', eccsValve: 'ECCS valve', fwBreaker: 'Breaker 52-FW3', intakeScreen: 'Intake screen',
    turbineReset: 'Turbine panel', dgAPanel: 'EDG-A panel', dgBPanel: 'EDG-B panel', dgBFuel: 'Fuel valve FO-V-22',
    borationPanel: 'Boration panel', coffee: 'Coffee',
  };

  const BOARD = {
    1: ['MON 11/16 · DAY SHIFT', 'Rx 70% → follow demand', 'Tavg band 295–305 °C', '!Welcome, new Lead Engineer!', 'Coffee: still terrible'],
    2: ['TUE 11/17 · HEAT ADVISORY', 'Peak ~1,090 MWe @ 15:00', 'River temp 27 °C', '!RCP-B: watch vibration', 'Hydrate. — Gus'],
    3: ['WED 11/18 · NSRC ON SITE', '"Be boring." — VC', 'Tavg band 295–305 °C', '!PORV tailpipe warm?', 'Peak ~1,000 MWe'],
    4: ['THU 11/19 · AutoOptimize™ go-live', 'EDG weekly test 10:00', '!RCP-B rebuild: CANCELLED', 'Storm watch FRI', 'Finish the block. — G'],
    5: ['FRI 11/20 · SEVERE WEATHER', '!EDG-A OUT OF SERVICE', '!RCP-B degraded', '!PORV CR-0413 open', 'EOP-0 binder: west wall'],
  };

  const GUS_NOTES = {
    'A+': 'That was a pancake block on the whole shift. Putting this one on the highlight reel.',
    A: 'Clean, physical, no wasted motion. That is how you finish a block.',
    B: 'Solid day. A couple of whiffs, but you stayed on your man.',
    C: 'We moved the chains. Ugly drive, but we moved them.',
    D: 'Rough one. Film session tomorrow. I will bring snacks.',
    F: 'We will call that a learning opportunity. I have had worse days. Not many.',
  };

  class Game {
    constructor() {
      this.mode = 'boot';
      this.paused = false;
      this.inDialogue = false;
      this.clock = 360;
      this.simTime = 0;
      this.demand = 0;
      this.history = [];
      this.histT = 0;
      this.flags = {};
      this.dg = { A: 'off', B: 'off' };
      this.valveAngles = { porv: 0, eccs: 0, fuel: 0 };
      this.valveTargets = { porv: 0, eccs: 0, fuel: 0 };
      this.autoOpt = 'absent';
      this.hold = null;
      this.useHeld = false;
      this.ffTouch = false;
      this.expectUnlock = false;
      this.tailpipe = 40;
      this.lightningT = 5;
      this.aoT = 20;
      this.titleT = 0;
    }

    // ------------------------------------------------------------ boot
    async boot(hotData) {
      const msg = $('ld-msg');
      try {
        await Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise((r) => setTimeout(r, 2500))]);
      } catch (e) {
        /* fonts are optional */
      }
      if (!window.THREE) {
        msg.textContent = 'Could not load the 3D engine. Check your connection and reload.';
        return;
      }
      try {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      } catch (e) {
        msg.textContent = 'WebGL is not available in this browser, so the plant cannot be drawn.';
        return;
      }
      const r = this.renderer;
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      r.outputEncoding = THREE.sRGBEncoding;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.05;
      $('view').appendChild(r.domElement);
      this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 900);
      msg.textContent = 'Pouring concrete…';
      await new Promise((res) => setTimeout(res, 20));
      this.world = new G.World();
      this.world.build();
      this.sim = new G.Sim.Reactor({ power: 0.8 });
      this.player = new G.Player(this.camera, r.domElement, this.world);
      this.player.onStep = (run) => this.audio.step(this.surface());
      this.player.onLockChange = (locked) => this.onLockChange(locked);
      this.audio = new G.Audio();
      this.ui = new G.UI(this);
      this.director = new G.Director(this);
      this.raycaster = new THREE.Raycaster();
      this.raycaster.far = 2.9;

      this.save = U.storage.get(SAVE_KEY, null) || { unlocked: 1, grades: {}, flags: {}, settings: { vol: 80, sens: 100, invert: false } };
      if (hotData && hotData.save) this.save = Object.assign(this.save, hotData.save);
      this.flags = Object.assign({}, this.save.flags);
      this.applySettings();
      if (window.claude && window.claude.hot && window.claude.hot.snapshot) {
        try {
          window.claude.hot.snapshot(() => ({ save: this.save }));
        } catch (e) {
          /* not in a viewer */
        }
      }

      window.addEventListener('resize', () => this.resize());
      this.resize();
      this.bindInput();
      this.bindMenus();
      // Warm up shaders so the first frame of play does not hitch
      this.renderer.compile(this.world.scene, this.camera);
      this.toTitle();
      $('loading').hidden = true;
      this.last = performance.now();
      requestAnimationFrame((t) => this.frame(t));
    }

    resize() {
      const w = window.innerWidth, h = window.innerHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.fov = w < h ? 80 : 72;
      this.camera.updateProjectionMatrix();
    }

    applySettings() {
      const s = this.save.settings;
      $('set-vol').value = s.vol;
      $('set-sens').value = s.sens;
      $('set-invert').checked = !!s.invert;
      this.audio.setVolume(s.vol / 100);
      this.player.sensitivity = s.sens / 100;
      this.player.invertY = !!s.invert;
    }

    persist() {
      this.save.flags = Object.assign({}, this.save.flags, this.flags);
      U.storage.set(SAVE_KEY, this.save);
    }

    saveFlag(k, v) {
      this.flags[k] = v;
      this.persist();
    }

    surface() {
      const r = this.world.roomAt(this.player.pos.x, this.player.pos.z);
      if (!r) return 'concrete';
      if (r.id === 'control') return 'carpet';
      if (r.id === 'containment' || r.id === 'turbine') return 'metal';
      return 'concrete';
    }

    // ------------------------------------------------------------ menus
    bindMenus() {
      $('btn-new').addEventListener('click', () => {
        this.audio.start();
        this.save.unlocked = Math.max(1, this.save.unlocked);
        this.flags = {};
        this.save.flags = {};
        this.persist();
        this.startDay(1);
      });
      $('btn-continue').addEventListener('click', () => {
        this.audio.start();
        this.startDay(Math.min(5, this.save.unlocked));
      });
      $('btn-howto').addEventListener('click', () => {
        $('howto').hidden = false;
        $('title-menu').hidden = true;
      });
      $('btn-howto-close').addEventListener('click', () => {
        $('howto').hidden = true;
        $('title-menu').hidden = false;
      });
      $('p-resume').addEventListener('click', () => this.resume());
      $('p-restart').addEventListener('click', () => {
        this.resume(true);
        this.startDay(this.dayN, { retry: this.dayN === 5 && this.crisisSeen });
      });
      $('p-quit').addEventListener('click', () => {
        this.resume(true);
        this.toTitle();
      });
      $('set-vol').addEventListener('input', (e) => {
        this.save.settings.vol = +e.target.value;
        this.audio.setVolume(this.save.settings.vol / 100);
        this.persist();
      });
      $('set-sens').addEventListener('input', (e) => {
        this.save.settings.sens = +e.target.value;
        this.player.sensitivity = this.save.settings.sens / 100;
        this.persist();
      });
      $('set-invert').addEventListener('change', (e) => {
        this.save.settings.invert = e.target.checked;
        this.player.invertY = e.target.checked;
        this.persist();
      });
    }

    toTitle() {
      this.director.reset();
      this.mode = 'title';
      this.paused = false;
      this.inDialogue = false;
      this.crisis = false;
      this.ui.setHudVisible(false);
      this.ui.closeConsole();
      this.ui.toggleMap(false);
      ['dayintro', 'pause', 'report', 'ending', 'dialogue', 'resume'].forEach((id) => this.ui.hide(id));
      this.ui.show('title');
      this.player.enabled = false;
      this.player.unlock();
      this.sim.reset({ power: 0.8 });
      this.world.setWeather('clear');
      this.world.setLighting('normal');
      for (const id of Object.keys(this.world.npcs)) this.world.setNPC(id, null, null, null, false);
      this.world.setNPC('walt', 9.5, -21.5, Math.PI, true);
      this.clock = 11 * 60;
      const cont = $('btn-continue');
      const u = Math.min(5, this.save.unlocked || 1);
      cont.hidden = u <= 1;
      cont.textContent = 'Continue · Day ' + u;
      const ds = $('dayselect');
      ds.innerHTML = '';
      if (u > 1) {
        for (let i = 1; i <= u; i++) {
          const b = document.createElement('button');
          b.className = 'btn ghost';
          b.type = 'button';
          b.innerHTML = 'Day ' + i + (this.save.grades[i] ? `<span class="g">${this.save.grades[i]}</span>` : '');
          b.addEventListener('click', () => {
            this.audio.start();
            this.startDay(i);
          });
          ds.appendChild(b);
        }
      }
    }

    pause() {
      if (this.mode !== 'play' || this.paused) return;
      this.paused = true;
      this.hold = null;
      this.ui.show('pause');
      this.player.enabled = false;
      this.expectUnlock = true;
      this.player.unlock();
      setTimeout(() => $('p-resume').focus(), 30);
    }

    resume(noLock) {
      if (!this.paused) return;
      this.paused = false;
      this.ui.hide('pause');
      if (!noLock) this.player.requestLock();
    }

    onLockChange(locked) {
      if (locked) {
        this.ui.hide('resume');
        return;
      }
      if (this.expectUnlock) {
        this.expectUnlock = false;
        return;
      }
      if (this.mode === 'play' && !this.paused && !this.ui.consoleOpen && !this.inDialogue && !this.player.lockFailed) this.pause();
    }

    // ------------------------------------------------------------ input
    bindInput() {
      window.addEventListener('keydown', (e) => this.onKeyDown(e));
      window.addEventListener('keyup', (e) => {
        if (e.code === 'KeyE') this.useUp();
      });
      const canvas = this.renderer.domElement;
      canvas.addEventListener('click', () => {
        if (this.mode === 'play' && !this.paused && !this.ui.consoleOpen && !this.player.locked && !this.player.isTouch) {
          if (this.inDialogue) return;
          this.player.requestLock();
        }
      });
      window.addEventListener('mousedown', (e) => {
        if (this.inDialogue && this.player.locked) {
          this.ui.dialogueAdvance();
          return;
        }
        if (this.mode === 'play' && this.player.locked && !this.inDialogue && e.button === 0) this.useDown();
      });
      window.addEventListener('mouseup', (e) => {
        if (e.button === 0) this.useUp();
      });
    }

    onKeyDown(e) {
      if (this.mode !== 'play') return;
      if (e.code === 'Escape') {
        if (this.ui.consoleOpen) this.closeConsole(false);
        else if (this.ui.mapOpen) this.ui.toggleMap(false);
        else if (this.paused) this.resume();
        else if (!this.inDialogue) this.pause();
        return;
      }
      if (this.paused) return;
      if (this.inDialogue) {
        if (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          if (!e.repeat) this.ui.dialogueAdvance();
        }
        const m = /^Digit([1-4])$/.exec(e.code);
        if (m) this.ui.dialogueChoose(+m[1] - 1);
        return;
      }
      if (e.code === 'KeyE' && !e.repeat) {
        if (this.ui.consoleOpen) this.closeConsole(true);
        else this.useDown();
      }
      if ((e.code === 'KeyM' || e.code === 'Tab') && !e.repeat) {
        e.preventDefault();
        this.ui.toggleMap();
      }
      if (e.code === 'Space') e.preventDefault();
    }

    useDown() {
      if (this.inDialogue) {
        this.ui.dialogueAdvance();
        return;
      }
      if (this.mode !== 'play' || this.paused || this.ui.consoleOpen) return;
      this.useHeld = true;
      const it = this.target;
      if (!it) return;
      const info = this.interactionInfo(it);
      if (!info || info.locked) {
        if (info && info.locked) this.audio.deny();
        return;
      }
      if (info.hold > 0) {
        this.hold = { id: it.id, t: 0, dur: info.hold, action: info.action };
        if (info.sound) this.audio[info.sound]();
      } else info.action();
    }

    useUp() {
      this.useHeld = false;
      this.hold = null;
    }

    // ------------------------------------------------------------ interactions
    findTarget() {
      this.camera.updateMatrixWorld();
      this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
      const hits = this.raycaster.intersectObjects(this.world.hitboxes, false);
      for (const h of hits) {
        const id = h.object.userData.interactId;
        if (!id) continue;
        if (id.startsWith('npc:')) {
          const n = this.world.npcs[id.slice(4)];
          if (!n || !n.group.visible) continue;
        }
        return this.world.interactables.get(id);
      }
      return null;
    }

    interactionInfo(it) {
      const d = this.director;
      const sim = this.sim;
      const task = d.tasks.get(it.id);
      if (task && task.id === d.runId) {
        const req = task.requires && task.requires();
        if (req) return { label: req, locked: true };
        return { label: task.label, hold: task.hold, sound: task.hold >= 2 ? 'valve' : null, action: () => d.completeTask(it.id) };
      }
      if (it.id.startsWith('npc:')) {
        const who = it.id.slice(4);
        const cast = G.CAST[who];
        return { label: 'Talk to ' + cast.name.split(' ')[0], action: () => this.talkTo(who) };
      }
      const say = (who, text, o) => () => this.ui.comms(who, text, o);
      switch (it.id) {
        case 'mainConsole':
          return { label: 'Use the main control board', action: () => this.openConsole() };
        case 'coffee':
          return { label: this.coffeeT > 0 ? 'Coffee (you are already buzzing)' : 'Pour a coffee', locked: this.coffeeT > 0, action: () => this.drinkCoffee() };
        case 'belt':
          return { label: 'Admire the championship belt', action: say('gus', 'SAFETY CHAMPION, Unit 2, three years running. Nobody touches the belt. ...Okay, you can touch the belt. Gently.') };
        case 'eop':
          return {
            label: 'Read EOP-0: Reactor Trip or Safety Injection',
            action: say('plant', 'EOP-0 · 1) Verify reactor trip. 2) Verify power to emergency bus 1E (diesels). 3) Verify heat sink: aux feedwater. 4) Check RCS integrity: PORV and block valve. 5) Safety injection if inventory is low. 6) Stuck rods? Emergency borate.', { life: 22, channel: 'procedure' }),
          };
        case 'fuelPool':
          return { label: 'Look into the spent fuel pool', action: say('plant', 'Spent fuel pool: 1,204 assemblies at 28 °C. The blue glow is Cherenkov radiation: particles moving faster than light travels in water.', { life: 14, channel: 'placard' }) };
        case 'pumpA':
          return { label: 'RCP-A · ' + Math.round(sim.pumps[0].eff * 100) + '% speed · smooth', action: say('walt', sim.pumps[0].eff > 0.1 ? 'A sounds like a purring cat. A six-thousand-horsepower cat.' : 'A is coasting down. No power to the motor.') };
        case 'pumpB':
          return { label: 'RCP-B · vibration ' + sim.pumps[1].vibration.toFixed(1) + ' mils', action: say('walt', sim.pumps[1].seized ? 'B is seized. Locked rotor. I told them.' : sim.pumps[1].vibration > 2 ? 'Listen to her complain. Keep her at 75% or less.' : 'Grumbly, but holding.') };
        case 'porvGauge':
          return { label: 'PORV tailpipe: ' + Math.round(this.tailpipe) + ' °C (indicator says ' + (sim.porv.indicatorFault || !sim.porv.open ? 'CLOSED' : 'OPEN') + ')', action: () => this.audio.blip() };
        case 'porvValve':
          return { label: sim.porv.blocked ? 'PORV block valve: CLOSED' : 'PORV block valve: OPEN (normal lineup)', locked: true };
        case 'eccsValve':
          return { label: sim.eccsValve ? 'ECCS injection: OPEN' : 'ECCS injection valve: closed (standby)', locked: true };
        case 'autoOpt': {
          const l = { absent: 'Synthex crate: "DO NOT POWER ON UNTIL THURSDAY"', pending: 'AutoOptimize™ cabinet: awaiting authorization', on: 'AutoOptimize™ is running. It hums smugly.', killed: 'Unplugged. Peace and quiet.' }[this.autoOpt];
          return { label: l, locked: true };
        }
        case 'turbineReset':
          if (sim.turbineTripped && sim.offsitePower) {
            if (sim.scrammed) return { label: 'Reset the reactor trip at the console first', locked: true };
            return { label: 'Reset the main turbine', hold: 2, sound: 'valve', action: () => {
              if (sim.resetTurbine()) {
                this.audio.clunk();
                this.ui.comms('priya', 'Turbine reset and on the line. Bring the load up from the board.');
              }
            } };
          }
          return { label: 'Turbine control panel: ' + (sim.offsitePower ? 'ONLINE' : 'NO GRID'), locked: true };
        case 'fwBreaker':
          return { label: 'Breaker 52-FW3: ' + (this.fwBreakerTripped ? 'TRIPPED' : 'closed'), locked: true };
        case 'intakeScreen':
          return { label: 'Condenser intake screen', locked: true };
        case 'dgAPanel':
          return { label: 'EDG-A: ' + (this.dgAFault ? 'OUT OF SERVICE (injector pump)' : 'standby'), locked: true };
        case 'dgBPanel':
          return { label: 'EDG-B: ' + (this.dg.B === 'running' ? 'RUNNING' : 'standby'), locked: true };
        case 'dgBFuel':
          return { label: 'Fuel isolation FO-V-22: ' + (this.dgFuelOpen ? 'OPEN' : 'CLOSED'), locked: true };
        case 'borationPanel':
          return { label: 'Boron ' + Math.round(sim.boron) + ' ppm · emergency boration is for emergencies', locked: true };
        default:
          return { label: it.label, locked: true };
      }
    }

    async talkTo(who) {
      const d = this.director;
      const s = d.npcScripts.get(who);
      if (s && s.id === d.runId) {
        d.npcScripts.delete(who);
        if (typeof s.lines === 'function') await s.lines();
        else await this.dialogue(s.lines);
        s.resolve();
        return;
      }
      const cast = G.CAST[who];
      const line = U.pick(cast.idle || ['...']);
      this.world.npcs[who].talking = 2;
      this.ui.comms(who, line, { channel: 'in person' });
    }

    npcTalk(who) {
      const n = this.world.npcs[who];
      if (n) n.talking = 3;
    }

    drinkCoffee() {
      this.coffeeT = 60;
      this.player.speedBoost = 1.18;
      this.audio.coffee();
      this.ui.comms('gus', U.pick(['That is the stuff. Terrible, but the stuff.', 'Hydration is for the weak. Kidding. Drink water too.', 'Fuel for the big fella and the guy driving it.']));
    }

    dialogue(lines) {
      this.inDialogue = true;
      this.hold = null;
      this.player.enabled = false;
      $('app').classList.add('talking');
      return this.ui.dialogue(lines).then((choice) => {
        this.inDialogue = false;
        $('app').classList.remove('talking');
        return choice;
      });
    }

    onChoicesShown() {
      if (this.player.locked) {
        this.expectUnlock = true;
        this.player.unlock();
      }
    }

    onChoiceMade() {
      if (!this.player.isTouch && !this.player.lockFailed) this.player.requestLock();
    }

    // ------------------------------------------------------------ console
    openConsole() {
      this.ui.openConsole();
      this.director.flags.consoleOpened = true;
      this.player.enabled = false;
      if (this.player.locked) {
        this.expectUnlock = true;
        this.player.unlock();
      }
      this.audio.blip();
    }

    closeConsole(gesture) {
      this.ui.closeConsole();
      if (gesture && this.mode === 'play') this.player.requestLock();
    }

    cmd(name, v) {
      const sim = this.sim;
      this.audio.click();
      switch (name) {
        case 'rodTarget':
          if (!sim.rodLock) sim.setRodTarget(v);
          break;
        case 'rodNudge':
          if (!sim.rodLock) sim.setRodTarget(sim.rodTarget + v);
          break;
        case 'turbineTarget':
          sim.setTurbineTarget(v);
          break;
        case 'turbNudge':
          sim.setTurbineTarget(sim.turbineTarget + v);
          break;
        case 'pump':
          if (v[0] === 1 && sim.pumps[1].seized) break;
          sim.setPump(v[0], v[1]);
          break;
        case 'scram':
          if (!sim.scram('MANUAL')) {
            if (sim.scramInhibit) {
              this.audio.deny();
              this.ui.toast('SCRAM INHIBITED', 'AutoOptimize™ is blocking the trip. Kill it in the Server Room.', 'crit', 3.5);
            }
          }
          break;
        case 'resetScram':
          if (sim.resetScram()) this.ui.comms('priya', 'Trip reset. Withdraw rods slowly, then reset the turbine in the Turbine Hall.');
          break;
        case 'auxFeed':
          if (sim.hasPower(true)) {
            sim.auxFeed = true;
            this.audio.confirm();
          }
          break;
        case 'rcpA':
          if (sim.emergencyPower) {
            sim.pumps[0].restarted = true;
            sim.pumps[0].running = true;
            sim.setPump(0, 0.6);
            this.audio.confirm();
          }
          break;
        case 'conditionReport':
          this.director.flags.crFiled = true;
          this.audio.confirm();
          break;
      }
      this.ui.syncConsoleInputs(true);
    }

    consoleHint() {
      const s = this.sim;
      const L = s.limits;
      const d = this.demand;
      if (this.crisis && !this.crisisOver) {
        if (this.autoOpt === 'on') return 'AutoOptimize is holding the rods. Pull its plug in the Server Room, then SCRAM.';
        if (!s.scrammed) return 'Rods are free. Lift the cover and hit SCRAM!';
        if (!s.emergencyPower) return 'We need power. Diesel B: open fuel valve FO-V-22 by the day tank, then start it at its panel.';
        if (!s.auxFeed || !s.pumps[0].restarted) return 'Power is back! Start aux feedwater and restart RCP-A right here.';
        if (s.porv.stuck && !s.porv.blocked) return 'Inventory is falling. The PORV is open no matter what the light says. Shut the block valve in containment.';
        if (!s.eccsValve) return 'Open ECCS valve SI-V-101 in containment to refill the core.';
        if (s.boron < 2450) return s.boronRate > 0 ? 'Boration running. Hang on.' : 'Borate at the CVCS panel in the Auxiliary Building.';
        return 'Hold on. Everything is trending the right way.';
      }
      if (s.scrammed) return s.canResetScram() ? 'Trip conditions cleared. Reset the trip, withdraw rods slowly, then reset the turbine in the Turbine Hall.' : 'Reactor tripped. Give it 20 seconds for conditions to clear before resetting.';
      if (s.turbineTripped) return 'Turbine is tripped. Bring power down with rods to match the steam dumps, then reset the turbine in the Turbine Hall.';
      if (s.rodLock) return 'AutoOptimize has the rods. Nothing to do but ride it out.';
      if (s.Tc > L.cladWarn) return 'Clad temperature is high! Lower turbine load or insert rods. Check pump speeds.';
      if (s.Tw > L.tavgBandHi) return 'Tavg is high. Insert rods a little (S, or Insert).';
      if (s.Tw < L.tavgBandLo) return 'Tavg is low. Withdraw rods a little (W, or Withdraw).';
      if (d > 0 && s.mwe < d * 0.95) return s.turbineTarget >= 1.04 ? 'We are maxed out. Every bit of efficiency counts now.' : 'Output is under demand. Raise turbine load (D, or +), then re-trim Tavg with rods.';
      if (d > 0 && s.mwe > d * 1.05) return 'We are over demand. Ease the turbine load down (A, or −).';
      return 'Looking good. Output matches demand and Tavg is in the band.';
    }

    // ------------------------------------------------------------ days
    async startDay(n, opts) {
      opts = opts || {};
      this.retry = !!opts.retry;
      this.director.reset();
      this.dayN = n;
      this.day = G.DAYS[n - 1];
      const day = this.day;
      ['title', 'pause', 'report', 'ending', 'dialogue', 'resume', 'howto'].forEach((id) => this.ui.hide(id));
      $('title-menu').hidden = false;
      this.paused = false;
      this.inDialogue = false;
      this.ui.dialogueState = null;
      this.ui.closeConsole();
      this.ui.toggleMap(false);
      this.ui.clearComms();
      this.ui.setObjectives([]);
      day.setup(this.sim);
      this.sim.drainEvents();
      this.world.setWeather(day.weather);
      this.world.setLighting('normal');
      for (const id of Object.keys(this.world.npcs)) this.world.setNPC(id, null, null, null, false);
      this.clock = 360;
      this.simTime = 0;
      this.history = [];
      this.histT = 0;
      this.autoOpt = day.autoOpt || (n > 4 ? 'killed' : 'absent');
      this.dg = { A: 'off', B: 'off' };
      this.dgFuelOpen = true;
      this.dgAFault = n === 5;
      this.fwBreakerTripped = false;
      this.showCR = false;
      this.crisis = false;
      this.crisisOver = false;
      this.crisisSeen = false;
      this.crisisT = 0;
      this.coffeeT = 0;
      this.player.speedBoost = 1;
      this.valveAngles = { porv: 0, eccs: 0, fuel: 0 };
      this.valveTargets = { porv: 0, eccs: 0, fuel: 0 };
      this.tailpipe = day.tailpipe || 40;
      this.aoT = 25;
      this.lightningT = 3;
      this.stats = { gridNum: 0, gridDen: 0, bandT: 0, totalT: 0, mwh: 0, demandMwh: 0, revenue: 0, optional: 0, quiz: null, startScrams: 0, startPorv: 0 };
      this.player.teleport(day.spawn[0], day.spawn[1], day.spawn[2]);
      this.ui.setHudVisible(false);
      this.mode = 'intro';
      this.player.enabled = false;
      if (!this.retry) await this.ui.dayIntro(day);
      this.audio.start();
      this.mode = 'play';
      this.ui.setHudVisible(true);
      this.player.requestLock();
      if (this.player.isTouch) this.ui.show('touch');
      const runId = this.director.runId;
      day.script(this.director, this).catch((e) => {
        if (this.director.alive(runId)) console.error('Story script error', e);
      });
    }

    score(key, v) {
      if (key === 'optional') this.stats.optional += v;
      if (key === 'quiz') this.stats.quiz = v;
    }

    refreshObjectives() {
      this.ui.setObjectives(this.director.objectives);
    }

    onObjectiveDone(o) {
      this.audio.confirm();
    }

    gradeDay() {
      const s = this.stats;
      const sim = this.sim;
      const grid = s.gridDen > 0 ? s.gridNum / s.gridDen : 1;
      const band = s.totalT > 0 ? s.bandT / s.totalT : 1;
      const scrams = sim.scramCount;
      const lifts = sim.porv.cycles;
      let score = 0.5 * grid + 0.4 * band + 0.1;
      score += s.optional * 0.03 + (s.quiz || 0) * 0.015;
      score -= scrams * 0.1 + Math.min(0.15, lifts * 0.03);
      const grade = score >= 0.95 ? 'A+' : score >= 0.9 ? 'A' : score >= 0.82 ? 'B' : score >= 0.72 ? 'C' : score >= 0.6 ? 'D' : 'F';
      return { grid, band, scrams, lifts, grade, score };
    }

    endDay() {
      if (this.mode !== 'play') return;
      const g = this.gradeDay();
      const s = this.stats;
      const sim = this.sim;
      const req = this.director.objectives.filter((o) => !o.optional && !o.persistent);
      const opt = this.director.objectives.filter((o) => o.optional);
      const rows = [
        ['Energy delivered', U.fmtInt(s.mwh) + ' MWh of ' + U.fmtInt(s.demandMwh)],
        ['Grid match', Math.round(g.grid * 100) + '%'],
        ['Time in operating band', Math.round(g.band * 100) + '%'],
        ['Peak fuel clad temperature', Math.round(sim.peakClad) + ' °C'],
        ['Reactor trips', String(g.scrams)],
        ['PORV lifts', String(g.lifts)],
        ['Tasks completed', req.filter((o) => o.done && !o.failed).length + ' / ' + req.length + (opt.length ? ' · bonus ' + opt.filter((o) => o.done).length : '')],
      ];
      if (s.quiz != null) rows.push(['Inspector questions', s.quiz + ' / 3']);
      rows.push(['Revenue', '$' + (s.revenue / 1e6).toFixed(2) + 'M']);
      this.save.grades[this.dayN] = g.grade;
      this.save.unlocked = Math.max(this.save.unlocked || 1, this.dayN + 1);
      this.persist();
      this.mode = 'report';
      this.ui.setHudVisible(false);
      this.ui.closeConsole();
      this.ui.toggleMap(false);
      this.player.enabled = false;
      this.expectUnlock = true;
      this.player.unlock();
      let note = GUS_NOTES[g.grade];
      if (this.dayN === 4) note += ' Get some sleep. Tomorrow looks ugly.';
      this.ui.report({ day: this.dayN, title: this.day.title, rows, grade: g.grade, note, nextLabel: this.dayN === 4 ? 'Into the storm' : 'Next shift' }).then(() => this.startDay(this.dayN + 1));
    }

    // ------------------------------------------------------------ crisis
    beginCrisis() {
      this.crisis = true;
      this.crisisSeen = true;
      this.crisisT = 0;
      this.director.clock(false);
      this.world.lightning();
      this.audio.thunder(0.05);
      this.player.shake(2.2);
      this.ui.flash(0.9, 900);
      this.world.setLighting('blackout');
      this.dg.A = 'sputter';
      setTimeout(() => {
        if (this.crisis && this.dg.A === 'sputter') this.dg.A = 'failed';
      }, 2500);
      setTimeout(() => {
        if (this.crisis && !this.crisisOver) {
          this.audio.sputter();
          this.ui.comms('plant', 'EDG-A: START FAILURE. EDG-B: NO FUEL PRESSURE, fuel isolation closed.');
        }
      }, 4000);
      // Make sure the stuck PORV happens even if the player trips the reactor very fast
      this.director.wait(12).then(() => {
        const p = this.sim.porv;
        if (!p.open && !p.blocked) {
          p.open = true;
          p.stuck = true;
          p.cycles++;
        }
      });
    }

    async victory() {
      if (this.crisisOver) return;
      this.crisisOver = true;
      const sim = this.sim;
      const t = this.crisisT;
      this.audio.victory();
      this.ui.toast('STABLE SHUTDOWN', 'Unit 2 is safe', 'good', 5);
      const peak = Math.round(sim.peakClad);
      const grade = peak < 450 && t < 330 ? 'A+' : peak < 600 ? 'A' : peak < 800 ? 'B' : peak < 1000 ? 'C' : 'D';
      this.save.grades[5] = grade;
      this.save.unlocked = 5;
      this.save.won = true;
      this.persist();
      await new Promise((r) => setTimeout(r, 1800));
      this.world.setNPC('gus', -2.6, 9.6, Math.PI, true);
      await this.dialogue([
        { who: 'gus', text: 'Core is covered. Power is down. Temperatures are falling. Boss... that is a cold shutdown.' },
        { who: 'priya', text: 'Peak clad was ' + peak + ' °C. ' + (peak > 700 ? 'We cut it close, and some fuel is damaged, but the core held.' : 'Nothing melted. Nothing even came close.') },
        { who: 'gus', text: 'You know what that was? A game-winning block in a hurricane. Hang on, I have something for you.' },
        { who: 'gus', text: 'The belt. Safety Champion. It is yours now. Do not let Walt polish it. He uses the wrong stuff.' },
      ]);
      this.mode = 'ending';
      this.ui.setHudVisible(false);
      this.ui.closeConsole();
      this.player.enabled = false;
      this.expectUnlock = true;
      this.player.unlock();
      const gr = this.save.grades;
      this.ui.ending({
        meta: 'FINAL REPORT · CEDAR HOLLOW UNIT 2 · FRIDAY 2026-11-20',
        title: 'Cold shutdown',
        body: `
          <p>At T+${U.fmtTimer(t)}, Unit 2 reached stable shutdown. Peak fuel cladding temperature: <b>${peak} °C</b>. ${peak > 700 ? 'Some fuel was damaged, and the cleanup will take a year, but the core stayed in the vessel.' : 'Not one fuel pellet melted.'}</p>
          <p>The storm passed by noon and offsite power came back at 14:12. Inspector Halvorsen's report credited the control room crew for "decisive action under degraded conditions." She also asked, pointedly, about a certain PORV.</p>
          <p>Synthex Controls recalled AutoOptimize™ from every plant in the country by Monday. Vance Calloway is now pursuing opportunities outside the nuclear industry.</p>
          <p>Walt got his RCP-B rebuild, and his diesel parts, overnighted. Gus hung the Safety Champion belt over your desk and told everyone who would listen that you finished the block.</p>
          <table><tbody>${[1, 2, 3, 4, 5].map((i) => `<tr><td>Day ${i} · ${G.DAYS[i - 1].title}</td><td>${gr[i] || '—'}</td></tr>`).join('')}</tbody></table>`,
        buttons: [
          { label: 'Play again from Day 1', primary: true, action: () => { this.flags = {}; this.save.flags = {}; this.persist(); this.startDay(1); } },
          { label: 'Replay the storm', action: () => this.startDay(5, { retry: true }) },
          { label: 'Title screen', action: () => this.toTitle() },
        ],
      });
    }

    async meltdown() {
      if (this.crisisOver) return;
      this.crisisOver = true;
      const t = this.crisisT;
      this.audio.boom();
      this.player.shake(3.5);
      this.ui.flash(1, 3200);
      this.world.setLighting('blackout');
      this.ui.toast('CORE DAMAGE', 'Fuel cladding has failed', 'crit', 4);
      await new Promise((r) => setTimeout(r, 3400));
      this.mode = 'ending';
      this.ui.setHudVisible(false);
      this.ui.closeConsole();
      this.ui.toggleMap(false);
      this.player.enabled = false;
      this.expectUnlock = true;
      this.player.unlock();
      const done = this.director.objectives.filter((o) => o.done).map((o) => o.id);
      const missing = [];
      if (!done.includes('killAO')) missing.push('AutoOptimize™ was still holding the rods out.');
      if (!done.includes('dgB')) missing.push('Diesel B never started, so nothing on the emergency bus had power.');
      if (!done.includes('porv')) missing.push('The PORV was stuck open the whole time, draining the core.');
      if (!done.includes('eccs')) missing.push('Safety injection never refilled the reactor.');
      this.ui.ending({
        meta: 'INCIDENT REPORT · CEDAR HOLLOW UNIT 2 · T+' + U.fmtTimer(t),
        title: 'Core damage',
        bad: true,
        body: `
          <p>At T+${U.fmtTimer(t)} the fuel cladding passed 1,200 °C. Zirconium met steam, the core slumped, and Cedar Hollow Unit 2 became a chapter in a textbook.</p>
          <p>The containment held. The valley will be fine. Your career will need a minute.</p>
          ${missing.length ? '<p><b>What went wrong:</b> ' + missing.join(' ') + '</p>' : ''}
          <p><i>Gus:</i> "Hey. Shake it off. We have the film. We run it back."</p>`,
        buttons: [
          { label: 'Retry from the storm', primary: true, action: () => this.startDay(5, { retry: true }) },
          { label: 'Title screen', action: () => this.toTitle() },
        ],
      });
    }

    handleSimEvents() {
      for (const e of this.sim.drainEvents()) {
        switch (e.type) {
          case 'scram':
            if (this.crisis) {
              this.ui.toast('REACTOR TRIP', 'Rods dropping · ' + e.data, 'crit', 3);
            } else {
              this.ui.toast('REACTOR TRIP', e.data + ' · turbine tripped', 'crit', 4);
              this.ui.comms('priya', 'Reactor tripped on ' + e.data.toLowerCase() + '. Wait for conditions to clear, reset the trip at the board, then reset the turbine.');
            }
            this.audio.clunk();
            break;
          case 'turbineTrip':
            if (!this.crisis && e.data !== 'REACTOR TRIP') this.audio.alarmChime();
            break;
          case 'porvOpen':
            if (!this.crisis) {
              this.ui.comms('plant', 'PRESSURIZER PORV LIFTED at ' + this.sim.pressure.toFixed(2) + ' MPa. Reduce Tavg.');
              this.audio.alarmChime();
            }
            break;
          case 'scramInhibited':
            if (e.data !== 'MANUAL') this.ui.comms('ao', 'AutoOptimize™: trip signal "' + e.data + '" suppressed to protect output target.', { life: 8 });
            break;
          case 'meltdown':
            this.meltdown();
            break;
        }
      }
    }

    // ------------------------------------------------------------ frame
    frame(now) {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      try {
        this.update(dt);
      } catch (e) {
        console.error(e);
      }
      this.renderer.render(this.world.scene, this.camera);
      requestAnimationFrame((t) => this.frame(t));
    }

    update(dt) {
      const sim = this.sim;
      const playing = this.mode === 'play';
      const running = playing && !this.paused && !this.inDialogue;

      if (this.mode === 'title' || this.mode === 'boot') {
        this.titleT += dt;
        sim.step(dt);
        sim.drainEvents();
        const a = this.titleT * 0.06;
        this.camera.position.set(Math.sin(a) * 11.5, 6.2 + Math.sin(this.titleT * 0.13) * 1.2, -19 + Math.cos(a) * 11.5);
        this.camera.lookAt(0, 3.4, -19);
        this.world.update(dt, this.worldCtx(0));
        return;
      }

      // Fast-forward only when nothing urgent is happening
      const urgent = this.director.objectives.some((o) => o.urgent && !o.done);
      const wantFF = (this.player.keys.KeyT || this.ffTouch) && running && !this.crisis && !urgent && this.director.clockRunning;
      this.fastForward = !!wantFF;
      const ff = wantFF ? 4 : 1;

      this.player.enabled = running && !this.ui.consoleOpen;
      this.player.update(dt);

      if (running) {
        const sdt = dt * ff;
        sim.step(sdt);
        this.simTime += sdt;
        if (this.director.clockRunning && !this.crisis) this.clock = Math.min(18 * 60, this.clock + sdt * MIN_PER_SEC);
        if (this.crisis && !this.crisisOver) this.crisisT += sdt;
        this.demand = this.crisis ? 0 : U.curve(this.day.demand, this.clock);
        this.handleSimEvents();
        this.director.update();
        this.accumulateStats(sdt);
        this.histT += sdt;
        if (this.histT >= 1) {
          this.histT = 0;
          this.history.push({ mwe: sim.mwe, demand: this.demand });
          if (this.history.length > 180) this.history.shift();
        }
        if (this.coffeeT > 0) {
          this.coffeeT -= dt;
          if (this.coffeeT <= 0) this.player.speedBoost = 1;
        }
        this.autoOptimizeTick(sdt);
        // Console keyboard controls
        if (this.ui.consoleOpen) {
          const k = this.player.keys;
          if (!sim.rodLock && !sim.scrammed) {
            if (k.KeyW || k.ArrowUp) sim.setRodTarget(sim.rodTarget + 6 * dt);
            if (k.KeyS || k.ArrowDown) sim.setRodTarget(sim.rodTarget - 6 * dt);
          }
          if (k.KeyD || k.ArrowRight) sim.setTurbineTarget(sim.turbineTarget + 0.1 * dt);
          if (k.KeyA || k.ArrowLeft) sim.setTurbineTarget(sim.turbineTarget - 0.1 * dt);
        }
      } else if (playing && this.inDialogue) {
        this.ui.dialogueTick(dt);
      }

      // Tailpipe temperature follows PORV flow
      const tpTarget = sim.porvFlowing ? 155 : this.tailpipe0();
      this.tailpipe += (tpTarget - this.tailpipe) * Math.min(1, dt * 0.25);
      // Valve wheel animation
      for (const k of ['porv', 'eccs', 'fuel']) this.valveAngles[k] += (this.valveTargets[k] - this.valveAngles[k]) * Math.min(1, dt * 2);
      if (this.hold) {
        const k = this.hold.id === 'porvValve' ? 'porv' : this.hold.id === 'eccsValve' ? 'eccs' : this.hold.id === 'dgBFuel' ? 'fuel' : null;
        if (k) this.valveAngles[k] += dt * 2.5 * (k === 'porv' ? -1 : 1);
      }
      // Storm
      if (this.world.weather === 'storm' && playing) {
        this.lightningT -= dt;
        if (this.lightningT <= 0) {
          this.lightningT = U.rand(7, 17);
          this.world.lightning();
          const dist = Math.random();
          this.audio.thunder(dist);
          if (dist < 0.3) this.player.shake(0.4);
        }
      }

      // Interaction targeting
      if (playing && !this.paused && !this.inDialogue && !this.ui.consoleOpen) {
        this.target = this.findTarget();
        const info = this.target ? this.interactionInfo(this.target) : null;
        if (this.hold) {
          if (!this.target || this.target.id !== this.hold.id || !this.useHeld) this.hold = null;
          else {
            this.hold.t += dt;
            if (this.hold.t >= this.hold.dur) {
              const a = this.hold.action;
              this.hold = null;
              a();
            }
          }
        }
        this.ui.prompt(info ? info.label : null, info && info.locked, this.hold ? this.hold.t / this.hold.dur : 0);
      } else {
        this.target = null;
        this.ui.prompt(null);
      }

      // Resume hint (or a drag hint when the frame blocks pointer lock)
      const free = playing && !this.paused && !this.inDialogue && !this.ui.consoleOpen && !this.player.locked && !this.player.isTouch;
      if (free && this.player.lockFailed && !this.dragHintDone) {
        this.dragHintT = (this.dragHintT || 0) + dt;
        if (this.dragHintT > 9) this.dragHintDone = true;
      }
      const showHint = free && (!this.player.lockFailed || !this.dragHintDone);
      const rs = $('resume');
      if (showHint) {
        const txt = this.player.lockFailed ? 'Drag with the mouse to look around' : 'Click to look around';
        if (rs.firstChild.textContent !== txt) rs.firstChild.textContent = txt;
      }
      rs.hidden = !showHint;

      // World, HUD, audio
      const alarms = sim.alarms();
      const alarmLevel = alarms.reduce((m, a) => Math.max(m, a.sev), 0);
      this.world.update(dt, this.worldCtx(alarmLevel, alarms));
      if (playing) {
        const room = this.world.roomAt(this.player.pos.x, this.player.pos.z);
        const hud = {
          sim, demand: this.demand, alarms, room, fastForward: this.fastForward,
          dayLabel: 'DAY ' + this.dayN + ' · ' + this.day.weekday.slice(0, 3).toUpperCase(),
          clockLabel: this.crisis ? 'T+' + U.fmtTimer(this.crisisT) : U.fmtClock(this.clock),
          crisis: this.crisis && !this.crisisOver, crisisT: this.crisisT,
          vignette: alarmLevel >= 3 || (this.crisis && !this.crisisOver && sim.Tc > 500),
        };
        this.ui.updateHUD(dt, hud);
        if (this.ui.consoleOpen) {
          this.ui.updateConsole(dt, Object.assign(hud, {
            hint: this.consoleHint(), tailpipe: this.tailpipe, showEmergency: this.crisis, showCR: this.showCR, noReset: this.crisis,
          }));
        }
        this.ui.waypoints(this.waypointList(), this.camera);
        this.ui.drawMap(this.world, this.player.pos, this.player.yaw, this.waypointList());
        this.audio.update(dt, {
          room: room && room.id, paused: this.paused, power: sim.P, blackout: this.world.lightMode === 'blackout',
          turbineSpeed: sim.turbineTripped ? 0 : sim.turbineLoad, rain: this.world.weather === 'storm',
          dieselRunning: this.dg.B === 'running' || this.dg.A === 'sputter', klaxon: (alarmLevel >= 3 || (this.crisis && !this.crisisOver)) && !this.paused,
          steamLeak: sim.porvFlowing, rumble: this.crisis && !this.crisisOver ? U.clamp((sim.Tc - 400) / 800, 0, 0.6) : 0,
        });
      } else {
        this.audio.update(dt, { paused: true, power: 0, turbineSpeed: 0 });
      }
    }

    tailpipe0() {
      return this.day && this.day.tailpipe ? this.day.tailpipe : 40;
    }

    accumulateStats(sdt) {
      if (this.crisis || !this.director.clockRunning || this.clock >= 18 * 60) return;
      const s = this.stats;
      const sim = this.sim;
      const h = (sdt * MIN_PER_SEC) / 60;
      s.totalT += sdt;
      if (sim.Tw >= 294.5 && sim.Tw <= 305.5 && sim.Tc < 345 && !sim.scrammed) s.bandT += sdt;
      s.gridNum += Math.min(sim.mwe, this.demand) * sdt;
      s.gridDen += this.demand * sdt;
      s.mwh += sim.mwe * h;
      s.demandMwh += this.demand * h;
      s.revenue += sim.mwe * h * 65;
    }

    autoOptimizeTick(sdt) {
      if (this.autoOpt !== 'on' || this.crisis || this.dayN < 4) return;
      this.aoT -= sdt;
      if (this.aoT > 0) return;
      this.aoT = U.rand(34, 50);
      const sim = this.sim;
      if (sim.scrammed || sim.turbineTripped) return;
      const pull = U.pick([2, 2.5, 3]);
      sim.setRodTarget(sim.rodTarget + pull);
      sim.setTurbineTarget(Math.min(1.04, sim.turbineTarget + 0.03));
      this.ui.comms('ao', U.pick([
        'Efficiency opportunity! Withdrawing rods ' + pull + '% and loading the turbine +3%.',
        'Detected unused margin. Withdrawing rods ' + pull + '%. You are welcome.',
        'Optimizing! Rods +' + pull + '%, turbine +3%. Revenue projection: delightful.',
      ]), { life: 8 });
    }

    worldCtx(alarmLevel, alarms) {
      return {
        sim: this.sim, clockMin: this.clock, alarmLevel, alarms: alarms || [], playerPos: this.player ? this.player.pos : new THREE.Vector3(),
        dg: this.dg, autoOpt: this.autoOpt, valveAngles: this.valveAngles, fwBreakerTripped: this.fwBreakerTripped,
        demand: this.demand, history: this.history, clockLabel: this.crisis ? 'T+' + U.fmtTimer(this.crisisT) : U.fmtClock(this.clock),
        crisis: this.crisis && !this.crisisOver, crisisLabel: 'T+' + U.fmtTimer(this.crisisT), tailpipe: this.tailpipe,
        boardLines: BOARD[this.dayN] || BOARD[1], dgFuelOpen: this.dgFuelOpen, dgAFault: this.dgAFault,
      };
    }

    waypointList() {
      const out = [];
      const pp = this.player.pos;
      for (const o of this.director.objectives) {
        if (o.done || !o.target) continue;
        let pos;
        if (typeof o.target === 'string') {
          if (o.target.startsWith('npc:')) {
            const n = this.world.npcs[o.target.slice(4)];
            if (!n || !n.group.visible) continue;
            pos = n.group.position.clone().setY(1.6);
          } else {
            const it = this.world.interactables.get(o.target);
            if (!it) continue;
            pos = it.pos;
          }
        } else pos = o.target;
        const label = o.target.startsWith && o.target.startsWith('npc:') ? G.CAST[o.target.slice(4)].name.split(' ')[0] : SHORT[o.target] || o.text;
        out.push({ key: o.id, pos, label, urgent: !!o.urgent, dist: Math.hypot(pos.x - pp.x, pos.z - pp.z) });
      }
      return out;
    }
  }

  // ------------------------------------------------------------ start
  const game = new Game();
  window.__game = game;
  const start = (data) => game.boot(data || {});
  const hot = window.claude && window.claude.hot;
  if (hot && hot.ready) hot.ready(start);
  else start(hot && hot.data ? hot.data : {});
})();
