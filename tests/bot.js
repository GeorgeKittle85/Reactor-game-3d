/*
 * Browser-side test bot. Injected by tests/playthrough.mjs into the running game.
 * It stops the render loop, then drives Game.update() directly with a fixed time step,
 * playing each day the way a competent (or deliberately idle) player would.
 */
(function () {
  'use strict';
  const STEP = 0.05;

  function autopilot(g) {
    const s = g.sim;
    if (s.rodLock) return;
    if (s.scrammed) {
      if (!g.crisis && s.canResetScram()) s.resetScram();
      return;
    }
    if (g.crisis) return;
    if (s.turbineTripped) {
      // Bring power down to what the steam dumps can take, then reset the turbine.
      if (s.P > 0.2) s.setRodTarget(Math.max(0, s.rods - 3));
      else if (s.offsitePower && s.Tw < 305) s.resetTurbine();
      return;
    }
    const want = g.demand / (1122 * s.condenserFactor);
    s.setTurbineTarget(Math.min(1.04, want));
    const err = 300 - s.Tw;
    s.setRodTarget(Math.max(s.rods - 1.5, Math.min(s.rods + 1.5, s.rodTarget + err * 0.006)));
  }

  function dialogue(g, choice) {
    const st = g.ui.dialogueState;
    if (!st) return;
    if (st.typing) g.ui.dialogueAdvance();
    else if (st.choicesPending) g.ui.dialogueChoose(Math.min(choice, st.choicesPending.length - 1));
    else g.ui.dialogueAdvance();
  }

  window.__bot = {
    log: [],
    async runDay(n, plan) {
      plan = plan || {};
      const g = window.__game;
      const d = g.director;
      g.frame = function () {}; // stop the rAF loop (no GPU work while testing)
      this.log = [];
      const startP = g.startDay(n, { retry: !plan.fullIntro });
      if (plan.fullIntro) document.getElementById('di-go').click();
      await startP;
      const seen = {};
      const taskSeen = new Map();
      let t = 0;
      let steps = 0;
      let result = null;
      const maxT = plan.maxT || 1500;
      const crisisPlan = plan.crisis || null;
      while (t < maxT) {
        // Fast-forward through calm stretches like a player holding T
        g.player.keys.KeyT = !plan.noFF;
        if (!plan.idle) autopilot(g);
        dialogue(g, plan.choice != null ? plan.choice : 1);

        if (!plan.idle) {
          // NPC conversations
          for (const who of d.npcScripts.keys()) if (!g.inDialogue) g.talkTo(who);
          // Objectives that are done at the console
          const has = (id) => d.get(id) && !d.get(id).done;
          if (has('console')) {
            g.openConsole();
            g.closeConsole(false);
          }
          if (has('cr')) g.cmd('conditionReport');
          if (has('slowB')) g.cmd('pump', [1, 0.75]);
          // Tasks: walk there (simulated delay), then do them
          for (const [id, task] of d.tasks) {
            if (task.id !== d.runId) continue;
            if (!taskSeen.has(id)) taskSeen.set(id, g.simTime);
            const walk = plan.walk != null ? plan.walk : 8;
            const due = crisisPlan && crisisPlan[id] != null ? g.crisisT >= crisisPlan[id] : g.simTime - taskSeen.get(id) >= walk;
            if (!due) continue;
            if (task.requires && task.requires()) continue;
            this.log.push(`[${g.crisis ? 'T+' + g.crisisT.toFixed(0) : g.clock.toFixed(0)}] task ${id}`);
            d.completeTask(id);
          }
          // Crisis console actions
          if (g.crisis && !g.crisisOver && crisisPlan) {
            const s = g.sim;
            if (g.autoOpt === 'killed' && !s.scrammed && g.crisisT >= (crisisPlan.scram || 0)) g.cmd('scram');
            if (s.emergencyPower && g.crisisT >= (crisisPlan.cool || 0)) {
              if (!s.auxFeed) g.cmd('auxFeed');
              if (!s.pumps[0].restarted) g.cmd('rcpA');
            }
          }
        }
        for (const o of d.objectives) {
          if (!seen[o.id]) {
            seen[o.id] = true;
            this.log.push(`[${g.crisis ? 'T+' + g.crisisT.toFixed(0) : g.clock.toFixed(0)}] objective ${o.id}: ${o.text}`);
          }
        }
        g.update(STEP);
        t += STEP;
        steps++;
        await null; // let story continuations (promise callbacks) run, as they would between frames
        if (!document.getElementById('report').hidden) {
          result = { kind: 'report', grade: document.getElementById('rp-grade').textContent, rows: [...document.querySelectorAll('#rp-rows tr')].map((r) => r.textContent) };
          break;
        }
        if (g.mode === 'ending' && !document.getElementById('ending').hidden) {
          result = { kind: 'ending', title: document.getElementById('en-title').textContent, meta: document.getElementById('en-meta').textContent };
          break;
        }
        if (steps % 400 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      // Meltdown/victory endings resolve after a short real-time delay
      if (!result && g.crisisOver) {
        for (let i = 0; i < 80 && !result; i++) {
          dialogue(g, 1);
          await new Promise((r) => setTimeout(r, 100));
          if (!document.getElementById('ending').hidden) result = { kind: 'ending', title: document.getElementById('en-title').textContent, meta: document.getElementById('en-meta').textContent };
        }
      }
      return {
        day: n, result, clock: g.clock, crisisT: g.crisisT, peakClad: Math.round(g.sim.peakClad), scrams: g.sim.scramCount,
        open: d.objectives.filter((o) => !o.done && !o.optional && !o.persistent).map((o) => o.id), log: this.log,
      };
    },
  };
})();
