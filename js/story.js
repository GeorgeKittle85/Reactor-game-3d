/*
 * Story: cast, the five days, and the Director that runs each day's script.
 * Scripts are async functions. Every wait is resolved from the game loop, so pausing
 * the game pauses the story. Restarting a day abandons the old script's pending waits.
 */
(function () {
  'use strict';
  const G = window.G;
  const U = G.U;

  G.CAST = {
    gus: {
      name: 'Gus Kettleman', role: 'Shift Supervisor', color: '#ffb547', initials: 'GK',
      idle: [
        'Coffee machine is by the window. The coffee is terrible. It also makes you walk faster. Science.',
        'You drive, I block. That is the whole playbook.',
        'That belt on the wall? Safety Champion, three years running. Nobody touches the belt.',
        'Big fella sounds happy today. Listen to that hum.',
        'Number 85 on the back, number one in your heart. Also on the mug.',
      ],
    },
    priya: {
      name: 'Priya Raman', role: 'Reactor Operator', color: '#6fd6ff', initials: 'PR',
      idle: [
        'Rods set temperature, turbine sets power. Once that clicks, the board makes sense.',
        'If Tavg drifts low, pull rods a little. Small moves. The core is slower than you think.',
        'Gus played tight end in college. He will mention it. Often.',
        'The wall display has a three-minute trend. Watch the dashed demand line.',
      ],
    },
    walt: {
      name: 'Walt Brenner', role: 'Maintenance Chief', color: '#e5c45a', initials: 'WB',
      idle: [
        'Nineteen years on these pumps. They talk, if you listen.',
        'Corporate thinks maintenance is a cost. Maintenance is what keeps you from finding out what the other cost is.',
        'Hands off my diesels unless you are testing them.',
      ],
    },
    calloway: {
      name: 'Vance Calloway', role: 'VP of Operations', color: '#d58cff', initials: 'VC', channel: 'email',
      idle: ['Time is money. I mean that literally.', 'Have you seen our output numbers this week? Gorgeous.'],
    },
    halvorsen: {
      name: 'Ruth Halvorsen', role: 'NSRC Resident Inspector', color: '#8fe0b0', initials: 'RH',
      idle: ['Carry on. Pretend I am not here.', 'I like a quiet control room. Quiet means people are paying attention.'],
    },
    ao: { name: 'AutoOptimize™', role: 'Synthex Controls', color: '#ff5fd2', initials: 'AO', channel: 'system' },
    grid: { name: 'Grid Dispatch', role: 'Regional Operator', color: '#9fb4c0', initials: 'GD', channel: 'phone' },
    plant: { name: 'Plant Computer', role: 'Unit 2', color: '#c9d4d9', initials: 'PC', channel: 'system' },
  };

  // ---------------------------------------------------------------- Director
  class Director {
    constructor(game) {
      this.game = game;
      this.runId = 0;
      this.reset();
    }

    reset() {
      this.runId++;
      this.waiters = [];
      this.objectives = [];
      this.tasks = new Map();
      this.npcScripts = new Map();
      this.flags = {};
      this.clockRunning = false;
    }

    get sim() {
      return this.game.sim;
    }

    // -- waiting
    waitFor(pred) {
      const id = this.runId;
      return new Promise((resolve) => {
        this.waiters.push({ pred, resolve, id });
      });
    }
    wait(sec) {
      const end = this.game.simTime + sec;
      return this.waitFor(() => this.game.simTime >= end);
    }
    until(clockMin) {
      return this.waitFor(() => this.game.clock >= clockMin);
    }
    waitFlag(name) {
      return this.waitFor(() => this.flags[name]);
    }
    // Condition must hold continuously for `sec` seconds.
    sustain(pred, sec) {
      let t = 0, last = this.game.simTime;
      return this.waitFor(() => {
        const now = this.game.simTime;
        const dt = now - last;
        last = now;
        if (pred()) t += dt;
        else t = 0;
        return t >= sec;
      });
    }

    update() {
      if (!this.waiters.length) return;
      const keep = [];
      const ready = [];
      for (const w of this.waiters) {
        if (w.id !== this.runId) continue;
        let ok = false;
        try {
          ok = w.pred();
        } catch (e) {
          ok = false;
        }
        if (ok) ready.push(w);
        else keep.push(w);
      }
      this.waiters = keep;
      for (const w of ready) w.resolve();
    }

    alive(id) {
      return id === this.runId;
    }

    // -- talking
    say(who, text, opts) {
      this.game.ui.comms(who, text, opts);
    }
    talk(lines) {
      return this.game.dialogue(lines);
    }
    toast(t, sub, kind, dur) {
      this.game.ui.toast(t, sub, kind, dur);
    }

    // -- objectives
    obj(id, text, opts) {
      let o = this.objectives.find((x) => x.id === id);
      if (!o) {
        o = { id, text, done: false };
        this.objectives.push(o);
      }
      Object.assign(o, { text }, opts || {});
      this.game.refreshObjectives();
      return o;
    }
    get(id) {
      return this.objectives.find((x) => x.id === id);
    }
    done(id) {
      const o = this.get(id);
      if (o && !o.done) {
        o.done = true;
        o.urgent = false;
        this.game.onObjectiveDone(o);
      }
      this.game.refreshObjectives();
    }
    fail(id) {
      const o = this.get(id);
      if (o) {
        o.failed = true;
        o.done = true;
      }
      this.game.refreshObjectives();
    }
    remove(id) {
      this.objectives = this.objectives.filter((o) => o.id !== id);
      this.game.refreshObjectives();
    }
    waitObj(id) {
      return this.waitFor(() => {
        const o = this.get(id);
        return o && o.done;
      });
    }
    requiredDone() {
      return this.objectives.every((o) => o.done || o.optional || o.persistent);
    }

    // -- tasks on interactables: resolves when the player completes it
    task(interactId, opts) {
      const id = this.runId;
      return new Promise((resolve) => {
        this.tasks.set(interactId, Object.assign({ hold: 0, id }, opts, { resolve }));
      });
    }
    completeTask(interactId) {
      const t = this.tasks.get(interactId);
      if (!t) return;
      this.tasks.delete(interactId);
      if (t.onDone) t.onDone();
      t.resolve();
    }

    // -- NPCs
    npc(id, x, z, yaw, visible) {
      this.game.world.setNPC(id, x, z, yaw, visible);
    }
    hideNPC(id) {
      this.game.world.setNPC(id, null, null, null, false);
    }
    npcTalk(npcId, lines) {
      const id = this.runId;
      return new Promise((resolve) => {
        this.npcScripts.set(npcId, { lines, resolve, id });
      });
    }

    clock(on) {
      this.clockRunning = on;
    }

    async endOfShift() {
      const g = this.game;
      await this.until(18 * 60);
      if (!this.requiredDone()) {
        this.say('gus', 'Shift change is here, but we have open items. Finish them up and I will sign you out. Overtime is on Calloway.');
        await this.waitFor(() => this.requiredDone());
      }
      g.endDay();
    }
  }

  // ---------------------------------------------------------------- helpers
  function inBand(sim) {
    return sim.Tw >= 294.5 && sim.Tw <= 305.5 && sim.Tc < 345;
  }

  async function holdTheLine(d) {
    d.obj('steady', 'Match grid demand and keep Tavg 295–305 °C until 18:00', { persistent: true });
  }

  // ---------------------------------------------------------------- days
  const DAYS = [
    // ------------------------------------------------------------ DAY 1
    {
      n: 1, weekday: 'Monday', date: '2026-11-16', title: 'Orientation',
      intro: 'Your first shift as Lead Engineer at Cedar Hollow Unit 2, a 1,120-megawatt pressurized water reactor that keeps half the valley lit. Night shift left the reactor at 70% power. Your shift supervisor, Gus Kettleman, is waiting in the control room.',
      brief: ['Meet Gus in the control room.', 'Log in at the main console and match grid demand.', 'Walk down the reactor coolant pumps with maintenance.', 'Shift ends at 18:00.'],
      weather: 'clear',
      demand: [[360, 760], [480, 880], [660, 950], [900, 1000], [1020, 960], [1080, 860]],
      setup(sim) {
        sim.reset({ power: 0.7 });
      },
      spawn: [0, 13.6, 0],
      async script(d, g) {
        d.npc('gus', -6.4, 10.6, Math.PI * 0.85);
        d.npc('priya', -3.3, 9.4, Math.PI);
        d.npc('walt', 11.6, -22.2, -Math.PI / 2);
        d.clock(false);
        await d.wait(1.2);
        d.say('gus', 'Hey! You must be the new Lead Engineer. Come say hi. I am the big guy by the desk with the mug.');
        d.obj('meetGus', 'Talk to Gus, the shift supervisor', { target: 'npc:gus' });
        await d.npcTalk('gus', [
          { who: 'gus', text: 'There they are! Gus Kettleman, shift supervisor. I played tight end in college, so fair warning: I explain everything with blocking.' },
          { who: 'gus', text: 'Here is the play. You drive the reactor. I block for you. Paperwork, phone calls, the VP. Whatever comes at you, I pick it up.' },
          { who: 'gus', text: 'Two levers matter. Turbine load decides how many megawatts we sell. Control rods decide how hot the core runs.' },
          { who: 'gus', text: 'Keep Tavg, the average coolant temperature, between 295 and 305. Running low? Pull rods out a hair. Running high? Push them in. Fuel clad stays under 345.' },
          { who: 'gus', text: 'Grid Dispatch tells us what they need. Match it and everybody is happy. Go log in at the main console. Priya will talk you through it.' },
        ]);
        d.done('meetGus');
        d.obj('console', 'Log in at the main console', { target: 'mainConsole' });
        await d.waitFlag('consoleOpened');
        d.done('console');
        d.clock(true);
        d.say('priya', 'Hi, Priya here. Raise turbine load until output matches demand, then nudge rods to keep Tavg in the band. At the board, W/S moves rods and A/D moves the turbine.', { life: 16 });
        d.obj('demand', 'Bring output within 5% of demand with Tavg in band', { target: 'mainConsole', sub: 'Turbine up for megawatts, rods to trim Tavg' });
        await d.sustain(() => Math.abs(g.sim.mwe - g.demand) < g.demand * 0.05 && inBand(g.sim), 5);
        d.done('demand');
        d.say('grid', 'Dispatch here. Unit 2 looks good on our end. Thanks, Cedar Hollow.');
        holdTheLine(d);
        await d.wait(4);
        d.say('priya', 'Quiet stretches happen. Hold T to fast-forward when nothing needs you. The board keeps running while you walk around.', { life: 14 });

        await d.until(8 * 60 + 20);
        d.say('walt', 'Walt, maintenance. If the new hotshot has a minute, come down to containment. I want you to hear RCP-B.');
        d.obj('pumpB', 'Walk down Reactor Coolant Pump B (Containment)', { target: 'pumpB' });
        await d.task('pumpB', { label: 'Listen to RCP-B', hold: 2 });
        await d.talk([
          { who: 'walt', text: 'Hear that? Grinding under the hum. That is the number two seal and a bearing that has been unhappy since spring.' },
          { who: 'walt', text: 'I have put in three work orders for a rebuild. Corporate keeps kicking it to the next outage. She will run. I just do not like how she sounds.' },
          { who: 'walt', text: 'Go listen to A on the other side if you want to hear what a healthy pump sounds like.' },
        ]);
        d.done('pumpB');
        d.obj('pumpA', 'Compare with RCP-A', { target: 'pumpA', optional: true });
        d.task('pumpA', { label: 'Listen to RCP-A', hold: 1.5 }).then(() => {
          d.say('walt', 'Smooth, right? That is what B should sound like.');
          d.done('pumpA');
          g.score('optional', 1);
        });

        await d.until(11 * 60);
        g.fwBreakerTripped = true;
        g.sim.condenserFactor = 0.95;
        g.audio.alarmChime();
        d.toast('FEEDWATER HEATER 3', 'Breaker 52-FW3 tripped · efficiency down 5%', '', 3.5);
        d.say('priya', 'Feedwater heater 3 tripped its breaker. We lose a little efficiency until someone resets it in the Turbine Hall.');
        d.obj('fw', 'Reset the feedwater heater breaker (Turbine Hall)', { target: 'fwBreaker' });
        await d.task('fwBreaker', { label: 'Reset breaker 52-FW3', hold: 1.5 });
        g.fwBreakerTripped = false;
        g.sim.condenserFactor = 1;
        g.audio.clunk();
        d.done('fw');
        d.say('priya', 'Heater 3 is back. Nice work.');

        await d.until(13 * 60);
        d.say('calloway', 'Welcome aboard! Every megawatt-hour we sell is about $65, so keep that turbine loaded. — V. Calloway, VP Operations', { channel: 'email' });
        await d.until(16 * 60);
        d.say('gus', 'Last stretch. Peak is behind us. Keep her steady and we hand off clean.');
        await d.endOfShift();
      },
    },

    // ------------------------------------------------------------ DAY 2
    {
      n: 2, weekday: 'Tuesday', date: '2026-11-17', title: 'Heat Wave',
      intro: 'A freak November heat wave is sitting on the valley. Every air conditioner is running, the grid wants everything Unit 2 can give, and the river that cools the condenser is as warm as bathwater.',
      brief: ['Peak demand is about 1,090 MWe around 15:00.', 'Warm river water costs you condenser efficiency.', 'Walt is still worried about RCP-B.'],
      weather: 'hot',
      demand: [[360, 820], [540, 950], [720, 1030], [900, 1090], [990, 1070], [1080, 980]],
      setup(sim) {
        sim.reset({ power: 0.78, condenserFactor: 0.96 });
      },
      spawn: [0, 13.6, 0],
      async script(d, g) {
        d.npc('gus', -6.4, 10.6, Math.PI * 0.85);
        d.npc('priya', -3.3, 9.4, Math.PI);
        d.npc('walt', 11.6, -22.2, -Math.PI / 2);
        d.clock(true);
        d.say('grid', 'Dispatch to Cedar Hollow. It is going to be a hot one. We need every megawatt you have at peak, around 15:00.');
        holdTheLine(d);
        await d.wait(3);
        d.say('gus', 'Big game today, boss. Grid is hungry. Stay low, keep your feet moving.');

        await d.until(7 * 60 + 30);
        g.sim.condenserFactor = 0.9;
        d.say('priya', 'Condenser vacuum is dropping. Warm river plus debris on the intake screen. We are losing about 10% of our output.');
        d.obj('screen', 'Clear the condenser intake screen (Turbine Hall)', { target: 'intakeScreen' });
        await d.task('intakeScreen', { label: 'Rake debris off the intake screen', hold: 3 });
        g.sim.condenserFactor = 0.975;
        g.audio.clunk();
        d.done('screen');
        d.say('priya', 'Better. The river is still warm, so we will not get all of it back today.');

        await d.until(9 * 60);
        g.sim.pumpBWorn = true;
        g.audio.alarmChime();
        d.toast('RCP-B VIBRATION HIGH', 'Pump B bearing vibration rising', '', 3.5);
        d.say('walt', 'RCP-B vibration just jumped. Come look before it gets worse.');
        d.obj('inspectB', 'Inspect RCP-B (Containment)', { target: 'pumpB', urgent: true });
        await d.task('pumpB', { label: 'Check RCP-B vibration', hold: 2 });
        d.done('inspectB');
        await d.talk([
          { who: 'walt', text: 'That is ' + g.sim.pumps[1].vibration.toFixed(1) + ' mils and climbing. Drop her to 75% speed and she will settle.' },
          { who: 'walt', text: 'Running a pump like this at 100% is how you turn a pump into a very expensive paperweight.' },
        ]);
        d.obj('slowB', 'Reduce RCP-B speed to 75% or less (main console)', { target: 'mainConsole' });
        await d.waitFor(() => g.sim.pumps[1].target <= 0.76);
        d.done('slowB');
        d.say('walt', 'Thank you. I am filing for a rebuild. Again.');
        await d.wait(3);
        d.say('priya', 'With B slowed down, clad temperature runs a little hotter. Watch it at peak.');

        await d.until(11 * 60);
        g.player.shake(0.9);
        g.audio.thunder(0.7);
        d.say('plant', 'SEISMIC MONITOR: ground motion 0.02 g. Magnitude 2.4 event, 38 km northeast. No damage detected.');
        await d.wait(3);
        d.say('priya', 'Was that... normal?');
        await d.wait(2.5);
        d.say('gus', 'Earth is just stretching. Stay in your stance.');

        await d.until(13 * 60 + 30);
        d.say('grid', 'Peak is coming. Can you push to 1,090?');
        d.obj('peak', 'Deliver at least 1,050 MWe during the afternoon peak', { optional: true, target: 'mainConsole' });
        d.sustain(() => g.sim.mwe >= 1050, 8).then(() => {
          if (!d.get('peak').done) {
            d.done('peak');
            g.score('optional', 1);
            d.say('grid', 'That is the number. You just kept a lot of air conditioners running. Thank you.');
          }
        });
        await d.until(16 * 60 + 30);
        if (!d.get('peak').done) {
          d.remove('peak');
          d.say('grid', 'We had to buy power from out of state for the peak. It happens.');
        }
        d.say('calloway', 'Fantastic numbers today. The bonus pool is looking great. Let us not get distracted by "maintenance requests" this quarter. — VC', { channel: 'email' });
        await d.endOfShift();
      },
    },

    // ------------------------------------------------------------ DAY 3
    {
      n: 3, weekday: 'Wednesday', date: '2026-11-18', title: 'The Inspector',
      intro: 'The Nuclear Safety Regulatory Commission’s resident inspector, Ruth Halvorsen, is on site today. She is sharp, she is thorough, and she writes everything down. Calloway would very much like today to be boring.',
      brief: ['Answer the inspector’s questions.', 'Check the pressurizer relief valve with her.', 'Keep the reactor in spec all day, whatever happens.'],
      weather: 'overcast',
      demand: [[360, 800], [540, 920], [720, 980], [780, 960], [900, 1000], [1080, 870]],
      setup(sim) {
        sim.reset({ power: 0.8, condenserFactor: 0.985 });
        sim.pumpBWorn = true;
        sim.setPump(1, 0.75);
        sim.pumps[1].eff = 0.75;
        sim.steamDumpDecay = true;
      },
      tailpipe: 68,
      spawn: [0, 13.6, 0],
      async script(d, g) {
        d.npc('gus', -6.4, 10.6, Math.PI * 0.85);
        d.npc('priya', -3.3, 9.4, Math.PI);
        d.npc('halvorsen', 3.2, 12.6, -Math.PI * 0.7);
        d.clock(true);
        holdTheLine(d);
        d.say('gus', 'Inspector is here. Be yourself. Unless yourself is nervous. Then be me.');
        d.obj('meet', 'Meet Inspector Halvorsen (Control Room)', { target: 'npc:halvorsen' });
        let correct = 0;
        await d.npcTalk('halvorsen', async () => {
          await d.talk([
            { who: 'halvorsen', text: 'Ruth Halvorsen, NSRC. I am not here to catch you out. I am here to see whether you know your plant. Three questions.' },
          ]);
          const qs = [
            {
              q: 'If the coolant temperature rises, what happens to reactivity in this core?',
              a: ['It goes up. Hotter water means more fission.', 'It goes down. Hotter water slows down fewer neutrons.', 'Nothing. Only rods change reactivity.'],
              right: 1,
              yes: 'Correct. Negative moderator temperature coefficient. It is why this reactor tends to calm itself down.',
              no: 'No. Hotter, less dense water slows fewer neutrons, so reactivity drops. That self-correction is your best friend.',
            },
            {
              q: 'After a reactor trip the chain reaction stops. Why do we still need cooling?',
              a: ['We do not. The core cools on its own.', 'Decay heat. Fission products keep producing a few percent of full power.', 'The rods are hot from falling in.'],
              right: 1,
              yes: 'Right. Six or seven percent at first, fading over hours. Lose cooling and that alone can melt a core.',
              no: 'Decay heat. Fission products keep making a few percent of full power for hours. That is what melts cores.',
            },
            {
              q: 'A relief valve indicator says CLOSED, but the tailpipe downstream is hot. What do you believe?',
              a: ['The indicator. That is what it is for.', 'The tailpipe temperature. Something is flowing.', 'Neither. Call maintenance and wait.'],
              right: 1,
              yes: 'Good. At Three Mile Island the light showed what the valve was told to do, not what it did. Believe the physics.',
              no: 'Believe the tailpipe. At Three Mile Island the light showed what the valve was told to do, not what it did.',
            },
          ];
          for (const q of qs) {
            const pick = await d.talk([{ who: 'halvorsen', text: q.q, choices: q.a }]);
            if (pick === q.right) correct++;
            await d.talk([{ who: 'halvorsen', text: pick === q.right ? q.yes : q.no }]);
          }
          await d.talk([{ who: 'halvorsen', text: correct + ' out of 3. ' + (correct === 3 ? 'You will do.' : 'We will keep talking.') + ' Carry on, I will be watching the board.' }]);
        });
        g.score('quiz', correct);
        d.done('meet');

        await d.until(9 * 60);
        d.npc('halvorsen', -0.5, -29.2, Math.PI * 0.6);
        d.say('halvorsen', 'Walk me to the pressurizer. I want to see the PORV tailpipe gauge. I will meet you in containment.');
        d.obj('porvCheck', 'Check the PORV tailpipe gauge with the inspector (Containment)', { target: 'porvGauge' });
        await d.task('porvGauge', { label: 'Read the PORV tailpipe gauge', hold: 1.5 });
        d.done('porvCheck');
        await d.talk([
          { who: 'halvorsen', text: 'Sixty-eight degrees. Ambient in here is about thirty. And your board says the PORV is closed.' },
          { who: 'halvorsen', text: 'Either the valve is seeping past its seat, or the position indicator is wrong. Either way, it goes in a condition report.' },
        ]);
        d.obj('cr', 'File a condition report at the main console', { target: 'mainConsole' });
        g.showCR = true;
        await d.waitFlag('crFiled');
        g.showCR = false;
        g.saveFlag('crFiled', true);
        d.done('cr');
        d.say('priya', 'CR-2026-0413 filed: "PORV RC-V-516 suspected seat leakage, tailpipe 68 °C, indication CLOSED."');
        d.npc('halvorsen', 3.2, 12.6, -Math.PI * 0.7);
        await d.until(10 * 60 + 40);
        d.say('calloway', 'Re: CR-2026-0413. Deferred to the next refueling outage. No budget this quarter. — VC', { channel: 'email' });
        await d.wait(3);
        d.say('gus', 'I would like that in writing. Oh wait. It is.');

        await d.until(13 * 60);
        // Turbine trip
        g.sim.tripTurbine('GENERATOR LOCKOUT');
        g.audio.alarmChime();
        d.toast('TURBINE TRIP', 'Runback in progress · steam dumps carrying the load', 'crit', 4);
        d.say('priya', 'Turbine trip! The runback pulled rods in, but the steam dumps cannot carry this for long. Get power down and Tavg back in the band!', { life: 14 });
        d.obj('stabilize', 'Insert rods: power under 30% and Tavg under 305 °C', { target: 'mainConsole', urgent: true });
        const startScrams = g.sim.scramCount;
        await d.waitFor(() => (g.sim.P < 0.3 && g.sim.Tw < 305) || g.sim.scrammed);
        if (g.sim.scrammed) {
          d.fail('stabilize');
          d.say('halvorsen', 'A trip is not a failure. Recovering badly would be. Walk me through it.');
          d.obj('reset', 'Reset the reactor trip at the main console (after 20 s)', { target: 'mainConsole' });
          await d.waitFor(() => !g.sim.scrammed);
          d.done('reset');
        } else {
          d.done('stabilize');
          d.say('halvorsen', 'Clean. That is what I like to see.');
          g.score('optional', 1);
        }
        d.obj('turb', 'Reset the main turbine (Turbine Hall control panel)', { target: 'turbineReset' });
        await d.waitFor(() => !g.sim.turbineTripped);
        d.done('turb');
        g.sim.steamDumpDecay = false;
        d.obj('reload', 'Reload the turbine and get back within 5% of demand', { target: 'mainConsole' });
        await d.sustain(() => Math.abs(g.sim.mwe - g.demand) < g.demand * 0.05 && g.sim.Tc < 345, 4);
        d.done('reload');
        d.say('grid', 'Dispatch sees Unit 2 back on the line. Appreciated.');
        if (g.sim.scramCount === startScrams) d.say('gus', 'Textbook. I am getting that one framed.');

        await d.until(16 * 60);
        d.hideNPC('halvorsen');
        d.say('halvorsen', 'I am writing up the PORV as an open item. Fix that valve, Cedar Hollow.');
        await d.endOfShift();
      },
    },

    // ------------------------------------------------------------ DAY 4
    {
      n: 4, weekday: 'Thursday', date: '2026-11-19', title: 'AutoOptimize',
      intro: 'Vance Calloway is in the building, which is never a good sign. He has brought a server cabinet from Synthex Controls and a word he keeps saying: optimization. The weather service is watching a storm system for tomorrow.',
      brief: ['Install AutoOptimize™ (VP’s orders).', 'Run the weekly emergency diesel generator test.', 'Keep the reactor in spec while the software "helps".'],
      weather: 'overcast',
      demand: [[360, 820], [600, 980], [840, 1040], [1080, 900]],
      setup(sim) {
        sim.reset({ power: 0.85, condenserFactor: 0.99 });
        sim.pumpBWorn = true;
        sim.setPump(1, 0.75);
        sim.pumps[1].eff = 0.75;
      },
      tailpipe: 70,
      autoOpt: 'pending',
      spawn: [0, 13.6, 0],
      async script(d, g) {
        d.npc('gus', -6.4, 10.6, Math.PI * 0.85);
        d.npc('priya', -3.3, 9.4, Math.PI);
        d.npc('calloway', 3.2, 12.8, -Math.PI * 0.7);
        d.npc('walt', -23.5, -8.5, Math.PI);
        d.clock(true);
        holdTheLine(d);
        d.say('gus', 'Heads up. The VP is here. He brought a box.');
        d.obj('vp', 'Talk to Vance Calloway (Control Room)', { target: 'npc:calloway' });
        await d.npcTalk('calloway', async () => {
          const c = await d.talk([
            { who: 'calloway', text: 'Our new Lead Engineer! Vance Calloway, VP of Operations. I will keep this short, because time is money and I mean that literally.' },
            { who: 'calloway', text: 'Meet AutoOptimize by Synthex. Machine-learning reactor efficiency. It trims rods and turbine in real time to squeeze out every last megawatt.' },
            { who: 'calloway', text: 'The board already approved it. I just need you to authorize the install in the server room.', choices: ['Has it been tested on our plant?', 'Fine. I will authorize it.', 'I am not comfortable with this.'] },
          ]);
          const reply = [
            'It was tested on a simulator of a plant very much like ours. Basically the same thing.',
            'That is the spirit. Server room, through the east door.',
            'Noted! And logged. It was not really a question, though.',
          ][c];
          await d.talk([{ who: 'calloway', text: reply }]);
        });
        d.done('vp');
        d.say('gus', 'For the record, I hate this. But I will block for you either way.');
        d.obj('install', 'Authorize the AutoOptimize™ install (Server Room)', { target: 'autoOpt' });
        await d.task('autoOpt', { label: 'Authorize AutoOptimize™ install', hold: 3 });
        d.done('install');
        g.autoOpt = 'on';
        g.audio.confirm();
        d.say('ao', 'AutoOptimize™ online. Hello, Cedar Hollow! Efficiency opportunities detected: 14.');
        d.hideNPC('calloway');
        await d.wait(4);
        d.say('priya', 'It is going to keep pulling rods and loading the turbine. We will have to keep it honest from the board.');

        await d.until(10 * 60);
        d.say('walt', 'Weekly diesel test. Meet me in the diesel building. Start A first.');
        d.obj('dgA', 'Test-start Emergency Diesel A (Diesel Generator Building)', { target: 'dgAPanel' });
        await d.task('dgAPanel', { label: 'Start EDG-A (test)', hold: 2.5 });
        g.dg.A = 'sputter';
        g.audio.crank();
        g.audio.sputter();
        await d.wait(2.6);
        g.dg.A = 'failed';
        g.dgAFault = true;
        d.done('dgA');
        await d.talk([
          { who: 'walt', text: 'And there it is. Injector pump on A is shot. Part is on backorder. Three weeks, they say.' },
          { who: 'walt', text: 'B is healthy, though. Give B a spin.' },
        ]);
        d.obj('dgB', 'Test-start Emergency Diesel B', { target: 'dgBPanel' });
        await d.task('dgBPanel', { label: 'Start EDG-B (test)', hold: 2.5 });
        g.dg.B = 'cranking';
        g.audio.crank();
        await d.wait(2);
        g.dg.B = 'running';
        d.done('dgB');
        await d.wait(4);
        g.dg.B = 'off';
        g.dgFuelOpen = false;
        await d.talk([
          { who: 'walt', text: 'B runs like a champ. I am isolating her fuel line while I tear into A, standard practice.' },
          { who: 'walt', text: 'Just remember: if you ever need B in a hurry, open the fuel isolation valve, FO-V-22, before you hit start. It is by the day tank.' },
        ]);

        await d.until(12 * 60);
        d.say('calloway', 'RCP-B rebuild is CANCELLED this quarter. AutoOptimize reports the pump is "within learned parameters." — VC', { channel: 'email' });
        await d.wait(3);
        d.say('walt', '"Learned parameters." I have been learning that pump for nineteen years.');

        await d.until(14 * 60);
        d.say('plant', 'NATIONAL WEATHER SERVICE: Severe thunderstorm watch for the valley, Friday 05:00–14:00. Damaging winds and frequent lightning possible.', { life: 14 });

        await d.until(15 * 60);
        // The glitch
        if (g.autoOpt === 'on') {
          g.sim.setRodTarget(Math.min(100, g.sim.rods + 4));
          g.sim.rodLock = true;
          g.audio.alarmChime();
          d.toast('ROD CONTROL LOCKED', 'AutoOptimize™ rejected manual rod commands', 'crit', 4);
          d.say('ao', 'AutoOptimize™: manual rod commands rejected. Efficiency mode active.');
          await d.wait(4);
          g.sim.rodLock = false;
          g.sim.setRodTarget(g.sim.rods);
          await d.wait(8);
          d.say('ao', 'Lockout released. You are welcome!');
          await d.wait(3);
          d.say('priya', 'It just locked us out of our own rods. That should not be possible.');
        }

        await d.until(17 * 60);
        d.obj('gusTalk', 'Talk to Gus before you leave', { target: 'npc:gus' });
        await d.npcTalk('gus', [
          { who: 'gus', text: 'Hell of a week, boss. Storm tomorrow, A diesel in pieces, B pump grinding, and a laptop driving our rods.' },
          { who: 'gus', text: 'You know what wins games when the weather turns? Fundamentals. Footwork. Hands inside. Finish the block.' },
          { who: 'gus', text: 'If tomorrow goes sideways, you do not have to be pretty. You just have to finish. I will be right there blocking.' },
          { who: 'gus', text: 'Get some sleep. And take a coffee for the road. It is terrible.' },
        ]);
        d.done('gusTalk');
        await d.endOfShift();
      },
    },

    // ------------------------------------------------------------ DAY 5
    {
      n: 5, weekday: 'Friday', date: '2026-11-20', title: 'The Storm',
      intro: 'Severe thunderstorms rolled in before dawn. Rain is hammering the turbine hall roof. Diesel A is in pieces on Walt’s bench, RCP-B is grinding, the PORV is still seeping, and AutoOptimize™ has been running the reactor all night.',
      brief: ['Run the plant through the storm.', 'Know where everything is. Press M for the map.', 'Trust your gauges, not just your indicators.'],
      weather: 'storm',
      demand: [[360, 1000], [1080, 1000]],
      setup(sim) {
        sim.reset({ power: 0.95, condenserFactor: 0.99 });
        sim.pumpBWorn = true;
        sim.setPump(1, 0.75);
        sim.pumps[1].eff = 0.75;
      },
      tailpipe: 72,
      autoOpt: 'on',
      spawn: [0, 13.6, 0],
      async script(d, g) {
        const sim = g.sim;
        d.npc('gus', -6.4, 10.6, Math.PI * 0.85);
        d.npc('priya', -3.3, 9.4, Math.PI);
        g.dg.A = 'failed';
        g.dgAFault = true;
        g.dgFuelOpen = false;
        d.clock(true);
        if (!g.retry) {
          await d.wait(1);
          await d.talk([
            { who: 'gus', text: 'Morning, boss. Listen to that rain. Ninety-kilometer gusts by seven, they are saying.' },
            { who: 'priya', text: 'AutoOptimize pushed us to 95% overnight. I could not talk it down.' },
            { who: 'gus', text: 'Stay frosty. If something happens, you call the plays. I will block.' },
          ]);
          d.obj('steady', 'Hold the plant steady through the storm', { persistent: true });
          await d.wait(22);
          d.say('grid', 'Dispatch to all units: lightning activity near your switchyards. Stand by.');
          await d.wait(9);
        } else {
          d.obj('steady', 'Hold the plant steady through the storm', { persistent: true });
          await d.wait(4);
        }

        // ---------------- THE STRIKE
        g.beginCrisis();
        sim.scramInhibit = true;
        sim.rodLock = true;
        sim.porv.stickArmed = true;
        sim.porv.indicatorFault = true;
        sim.rodStuckFloor = 24;
        sim.sdEffect = 0.5;
        sim.runbackEnabled = false;
        sim.loseOffsitePower();
        sim.pumps[1].seized = true;
        d.remove('steady');
        d.toast('LOSS OF OFFSITE POWER', 'Reactor trip INHIBITED by AutoOptimize™', 'crit', 5);
        await d.wait(1.5);
        d.say('ao', 'AutoOptimize™: grid disturbance detected. Reactor trip inhibited to protect output target.', { life: 12 });
        await d.wait(1.5);
        d.say('gus', 'Lightning took the switchyard! Boss, the rods did not drop! That thing is holding them!', { life: 12 });
        d.obj('killAO', 'Pull the plug on AutoOptimize™ (Server Room)', { target: 'autoOpt', urgent: true });
        d.obj('scram', 'Trip the reactor: SCRAM (Main Console)', { target: 'mainConsole', sub: 'Rod control is locked until AutoOptimize™ is off' });
        d.obj('dgB', 'Start Emergency Diesel B (Diesel Building)', { target: 'dgBFuel', sub: 'Open fuel valve FO-V-22, then start at the local panel' });
        d.obj('cool', 'Restore cooling: aux feedwater + RCP-A (Main Console)', { target: 'mainConsole', sub: 'Needs diesel power' });

        // AutoOptimize kill
        d.task('autoOpt', { label: 'Pull the plug on AutoOptimize™', hold: 2.5 }).then(() => {
          g.autoOpt = 'killed';
          sim.scramInhibit = false;
          sim.rodLock = false;
          g.audio.clunk();
          d.done('killAO');
          d.say('ao', 'AutoOptimize™: connection lost. Have a nice d—', { life: 6 });
          const o = d.get('scram');
          if (o && !o.done) o.sub = 'Rod control released. Hit SCRAM now!';
          d.get('scram').urgent = true;
          g.refreshObjectives();
        });
        // SCRAM
        d.waitFor(() => sim.scrammed).then(async () => {
          d.done('scram');
          await d.wait(2);
          g.audio.alarmChime();
          d.say('plant', 'ROD BOTTOM LIGHTS: 50 of 53. Rods H-8, K-12 and M-6 stuck at 24%.');
          await d.wait(2.5);
          d.say('priya', 'Three rods did not go all the way in. Once we cool down there is not enough shutdown margin. We need to borate.', { life: 12 });
          d.obj('borate', 'Emergency borate (Auxiliary Building)', { target: 'borationPanel', sub: 'Needs diesel power' });
          d.task('borationPanel', {
            label: 'Start emergency boration',
            hold: 3,
            requires: () => (sim.hasPower(true) ? null : 'No power to the boric acid pumps. Start a diesel.'),
          }).then(() => {
            sim.startBoration(1500);
            g.audio.confirm();
            d.get('borate').sub = 'Boration in progress';
            d.get('borate').urgent = false;
            g.refreshObjectives();
            d.say('priya', 'Boric acid is going in. Two minutes to full shutdown margin.');
          });
        });
        // Diesel B
        d.task('dgBFuel', { label: 'Open fuel isolation FO-V-22', hold: 2 }).then(() => {
          g.dgFuelOpen = true;
          g.valveTargets.fuel = Math.PI * 3;
          g.audio.valve();
          const o = d.get('dgB');
          o.target = 'dgBPanel';
          o.sub = 'Fuel is open. Start it at the local panel.';
          g.refreshObjectives();
        });
        d.task('dgBPanel', {
          label: 'Emergency start EDG-B',
          hold: 3,
          requires: () => (g.dgFuelOpen ? null : 'No fuel pressure. Open fuel isolation FO-V-22 first.'),
        }).then(async () => {
          g.dg.B = 'cranking';
          g.audio.crank();
          await d.wait(2.5);
          g.dg.B = 'running';
          sim.emergencyPower = true;
          g.world.setLighting('emergency');
          g.audio.clunk();
          d.done('dgB');
          d.toast('EMERGENCY BUS 1E ENERGIZED', 'EDG-B running · 4,160 V', 'good', 4);
          d.say('gus', 'LIGHTS! Let’s go! That is a pancake block, boss!', { life: 8 });
          const c = d.get('cool');
          if (c) c.sub = 'Power is back. Start aux feed and restart RCP-A at the board.';
          const b = d.get('borate');
          if (b && !b.done && sim.boronRate === 0) b.sub = 'Power is back. Go!';
          g.refreshObjectives();
          d.obj('eccs', 'Open ECCS injection valve SI-V-101 (Containment)', { target: 'eccsValve' });
        });
        // ECCS
        d.task('eccsValve', {
          label: 'Open ECCS injection valve',
          hold: 3,
          requires: () => (sim.hasPower(true) ? null : 'Injection pumps have no power. Start a diesel first.'),
        }).then(() => {
          sim.eccsValve = true;
          g.valveTargets.eccs = Math.PI * 4;
          g.audio.valve();
          d.done('eccs');
          d.say('priya', 'Safety injection is flowing. Inventory coming back up.');
        });
        // Cooling via console buttons
        d.waitFor(() => sim.auxFeed && sim.pumps[0].restarted).then(() => {
          d.done('cool');
          d.say('priya', 'Aux feed is flowing and A pump is turning. We have a heat sink again!');
        });
        // Stuck-open PORV
        d.waitFor(() => sim.porv.stuck).then(async () => {
          await d.wait(14);
          d.say('priya', 'Inventory is dropping and the relief tank is filling. Something is venting, but the PORV light says CLOSED.', { life: 12 });
          await d.wait(4);
          d.say('gus', 'Closed, my foot. ' + (g.flags.crFiled ? 'You wrote that valve up on Wednesday! ' : '') + 'Check the tailpipe and shut the block valve!', { life: 12 });
          d.obj('porv', 'Close the PORV block valve RC-V-516 (Containment)', { target: 'porvValve', urgent: true, sub: 'Indicator says CLOSED. The tailpipe says otherwise.' });
          await d.task('porvValve', { label: 'Close PORV block valve', hold: 3 });
          sim.porv.blocked = true;
          g.valveTargets.porv = -Math.PI * 4;
          g.audio.valve();
          d.done('porv');
          d.say('priya', 'Block valve shut. Inventory has stopped falling.');
          if (!d.get('eccs')) d.obj('eccs', 'Open ECCS injection valve SI-V-101 (Containment)', { target: 'eccsValve', sub: 'Needs diesel power' });
        });
        // Recriticality warning
        d.waitFor(() => sim.scrammed && sim.P > 0.008 && sim.Tw < 292 && sim.boronRate === 0 && sim.boron < 1500).then(() => {
          g.audio.alarmChime();
          d.toast('SOURCE RANGE: POWER RISING', 'Recriticality: cooldown is adding reactivity', 'crit', 4);
          d.say('priya', 'We are going critical again! With those stuck rods, cooling down adds reactivity. Borate, now!', { life: 12 });
          const b = d.get('borate');
          if (b && !b.done) {
            b.urgent = true;
            g.refreshObjectives();
          }
        });
        // Flavor
        d.wait(70).then(() => {
          if (!g.crisisOver) d.say('walt', 'Walt here, I am stuck at the flooded underpass. If you need diesel B: fuel valve FO-V-22 first, then start!', { life: 12 });
        });
        d.wait(105).then(async () => {
          if (g.crisisOver) return;
          d.say('calloway', 'Is the plant still making money??', { channel: 'phone', life: 6 });
          await d.wait(2.5);
          d.say('gus', 'Vance, I am going to hang up now.', { life: 6 });
        });

        // Boration completion
        d.waitFor(() => sim.boron >= 2450).then(() => {
          d.done('borate');
          d.say('priya', 'Boron at ' + Math.round(sim.boron) + ' ppm. Shutdown margin restored.');
        });

        // Victory: everything done and plant stable for a few seconds
        await d.waitFor(() => ['killAO', 'scram', 'dgB', 'cool', 'porv', 'eccs', 'borate'].every((k) => d.get(k) && d.get(k).done));
        d.obj('stable', 'Hold until the plant reaches stable shutdown', { sub: 'Power under 2%, clad under 320 °C, inventory above 70%' });
        await d.sustain(() => sim.P < 0.02 && sim.Tc < 320 && sim.level > 70, 4);
        d.done('stable');
        g.victory();
      },
    },
  ];

  G.Director = Director;
  G.DAYS = DAYS;
})();
