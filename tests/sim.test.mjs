// Unit tests for the reactor model. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Reactor, rodsForReactivity, rodReactivity } = require('../js/sim.js');

function run(r, seconds, hook) {
  const n = Math.round(seconds / 0.05);
  for (let i = 0; i < n; i++) {
    if (hook) hook(r, i * 0.05);
    r.step(0.05);
    if (r.meltdown) break;
  }
  return r;
}

test('starts in equilibrium at the requested power with Tavg at 300 °C', () => {
  const r = new Reactor({ power: 0.75 });
  run(r, 60);
  assert.ok(Math.abs(r.P - 0.75) < 0.005, `P=${r.P}`);
  assert.ok(Math.abs(r.Tw - 300) < 0.2, `Tw=${r.Tw}`);
  assert.equal(r.scrammed, false);
});

test('rodsForReactivity inverts rodReactivity', () => {
  for (const rho of [-0.04, -0.01, 0, 0.02]) {
    assert.ok(Math.abs(rodReactivity(rodsForReactivity(rho)) - rho) < 1e-6);
  }
});

test('turbine load sets power; rods set temperature', () => {
  const r = new Reactor({ power: 0.75 });
  r.setTurbineTarget(0.95);
  run(r, 80);
  assert.ok(r.P > 0.85, `power rises with load, P=${r.P}`);
  assert.ok(r.Tw < 299, `Tavg sags when load rises with rods fixed, Tw=${r.Tw}`);
  assert.ok(r.P < 0.93, 'low Tavg caps what the steam generators can deliver');
  const before = r.Tw;
  r.setRodTarget(r.rods + 5);
  run(r, 80);
  assert.ok(r.Tw > before + 2.5, `withdrawing rods raises Tavg (${before} -> ${r.Tw})`);
  assert.ok(Math.abs(r.P - 0.95) < 0.02, `power now meets the full load, P=${r.P}`);
});

test('a moderate rod pull at full power does not trip the reactor', () => {
  const r = new Reactor({ power: 1.0 });
  r.setRodTarget(r.rods + 6);
  run(r, 60);
  assert.equal(r.scrammed, false);
});

test('SCRAM drops power to decay heat and trips the turbine', () => {
  const r = new Reactor({ power: 1.0 });
  run(r, 5);
  assert.ok(r.scram('MANUAL'));
  run(r, 10);
  assert.ok(r.P < 0.08, `P=${r.P}`);
  assert.ok(r.decayHeat > 0.02, 'decay heat remains');
  assert.equal(r.turbineTripped, true);
  assert.equal(r.canResetScram(), false, 'reset is blocked for 20 s');
  run(r, 15);
  assert.equal(r.canResetScram(), true);
});

test('turbine trip triggers a runback instead of an immediate reactor trip', () => {
  const r = new Reactor({ power: 1.0 });
  r.steamDumpDecay = true;
  r.tripTurbine('TEST');
  run(r, 30);
  assert.equal(r.scrammed, false);
  assert.ok(r.P < 0.5, `runback cut power, P=${r.P}`);
});

test('overheating trips the reactor automatically', () => {
  const r = new Reactor({ power: 1.0 });
  r.setRodTarget(100);
  run(r, 60);
  assert.equal(r.scrammed, true);
});

test('AutoOptimize inhibit blocks a manual SCRAM', () => {
  const r = new Reactor({ power: 0.9 });
  r.scramInhibit = true;
  assert.equal(r.scram('MANUAL'), false);
  assert.ok(r.drainEvents().some((e) => e.type === 'scramInhibited'));
});

// The Day 5 scenario, mirrored from js/story.js
function blackout() {
  const r = new Reactor({ power: 0.95 });
  r.pumpBWorn = true;
  r.setPump(1, 0.75);
  run(r, 20);
  r.scramInhibit = true;
  r.rodLock = true;
  r.porv.stickArmed = true;
  r.porv.indicatorFault = true;
  r.rodStuckFloor = 24;
  r.sdEffect = 0.5;
  r.runbackEnabled = false;
  r.loseOffsitePower();
  r.pumps[1].seized = true;
  r.drainEvents();
  return r;
}

test('Day 5: doing nothing melts the core in roughly 3-6 minutes', () => {
  const r = blackout();
  const t0 = r.t;
  run(r, 600);
  assert.equal(r.meltdown, true);
  const t = r.t - t0;
  assert.ok(t > 180 && t < 360, `meltdown at T+${t.toFixed(0)}s`);
  assert.ok(r.Tc <= 2865, 'temperature is clamped');
});

test('Day 5: the PORV sticks open while its indicator says closed', () => {
  const r = blackout();
  run(r, 20);
  assert.equal(r.porv.stuck, true);
  assert.equal(r.porv.indicatorFault, true);
  assert.ok(r.level < 100, 'inventory is draining');
});

test('Day 5: a crew that works the procedure reaches stable shutdown', () => {
  const r = blackout();
  const t0 = r.t;
  const done = {};
  run(r, 600, (r) => {
    const t = r.t - t0;
    const at = (k, s, fn) => { if (!done[k] && t >= s) { done[k] = true; fn(); } };
    at('kill', 40, () => { r.rodLock = false; r.scramInhibit = false; r.scram('MANUAL'); });
    at('dg', 130, () => { r.emergencyPower = true; });
    at('cool', 170, () => { r.auxFeed = true; r.pumps[0].restarted = true; r.setPump(0, 0.6); });
    at('porv', 220, () => { r.porv.blocked = true; });
    at('eccs', 240, () => { r.eccsValve = true; });
    at('borate', 300, () => r.startBoration(1500));
  });
  assert.equal(r.meltdown, false, `peak clad ${r.peakClad.toFixed(0)}`);
  assert.ok(r.P < 0.02, `P=${r.P}`);
  assert.ok(r.Tc < 320, `Tc=${r.Tc}`);
  assert.ok(r.level > 70, `level=${r.level}`);
});

test('Day 5: without boration the stuck rods let the core go critical again', () => {
  const r = blackout();
  const t0 = r.t;
  const done = {};
  let recrit = false;
  run(r, 500, (r) => {
    const t = r.t - t0;
    const at = (k, s, fn) => { if (!done[k] && t >= s) { done[k] = true; fn(); } };
    at('kill', 30, () => { r.rodLock = false; r.scramInhibit = false; r.scram('MANUAL'); });
    at('dg', 90, () => { r.emergencyPower = true; });
    at('cool', 120, () => { r.auxFeed = true; r.pumps[0].restarted = true; r.setPump(0, 0.6); });
    at('porv', 150, () => { r.porv.blocked = true; });
    at('eccs', 160, () => { r.eccsValve = true; });
    if (r.t - t0 > 140 && r.scrammed && r.P > 0.03) recrit = true;
  });
  assert.equal(recrit, true);
});
