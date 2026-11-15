// End-to-end playthrough: serves the game, injects tests/bot.js and plays every day headlessly.
//   node tests/playthrough.mjs            (needs Playwright + Chromium)
//   THREE_LOCAL=/path/to/three.min.js node tests/playthrough.mjs   (offline: serve three.js from disk)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.mjs': 'application/javascript' };

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failures = 0;
const check = (cond, msg) => {
  console.log((cond ? '  PASS ' : '  FAIL ') + msg);
  if (!cond) failures++;
};

async function play(day, plan, label) {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  if (process.env.THREE_LOCAL) {
    await page.route('https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js', (r) =>
      r.fulfill({ body: fs.readFileSync(process.env.THREE_LOCAL), contentType: 'application/javascript' })
    );
  }
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.__game && window.__game.mode === 'title', null, { timeout: 60000 });
  await page.addScriptTag({ path: path.join(ROOT, 'tests/bot.js') });
  const out = await page.evaluate(([d, p]) => window.__bot.runDay(d, p), [day, plan]);
  await page.close();
  console.log(`\n=== Day ${day} · ${label}`);
  for (const l of out.log) console.log('   ' + l);
  console.log('   result:', JSON.stringify(out.result), '| peak clad', out.peakClad, '| scrams', out.scrams, '| crisis T+' + out.crisisT.toFixed(0));
  if (out.result && out.result.rows) for (const r of out.result.rows) console.log('     ' + r);
  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  return out;
}

const only = process.argv[2];
const want = (k) => !only || only.split(',').includes(k);

if (want('1')) {
  const o = await play(1, {}, 'competent');
  check(o.result && o.result.kind === 'report', 'day 1 reaches the end-of-shift report');
  check(o.result && /A|B/.test(o.result.grade), 'day 1 grade is A or B for a competent player (got ' + (o.result && o.result.grade) + ')');
}
if (want('2')) {
  const o = await play(2, {}, 'competent');
  check(o.result && o.result.kind === 'report', 'day 2 reaches the report');
  check(o.result && /A|B|C/.test(o.result.grade), 'day 2 grade C or better (got ' + (o.result && o.result.grade) + ')');
}
if (want('3')) {
  const o = await play(3, { choice: 1 }, 'competent, right answers');
  check(o.result && o.result.kind === 'report', 'day 3 reaches the report');
  check(o.result && o.result.rows.some((r) => r.includes('Inspector questions3 / 3')), 'inspector quiz scored 3/3');
}
if (want('4')) {
  const o = await play(4, {}, 'competent');
  check(o.result && o.result.kind === 'report', 'day 4 reaches the report');
}
if (want('5')) {
  const efficient = { autoOpt: 25, scram: 0, dgBFuel: 45, dgBPanel: 55, cool: 75, porvValve: 0, eccsValve: 0, borationPanel: 0 };
  const o = await play(5, { crisis: efficient, walk: 6, fullIntro: true }, 'efficient crew');
  check(o.result && o.result.kind === 'ending' && /Cold shutdown/i.test(o.result.title), 'efficient crew reaches cold shutdown (got ' + JSON.stringify(o.result) + ')');
  const slow = { autoOpt: 45, scram: 0, dgBFuel: 110, dgBPanel: 130, cool: 170, porvValve: 200, eccsValve: 220, borationPanel: 260 };
  const o2 = await play(5, { crisis: slow, walk: 12 }, 'slow crew');
  check(o2.result && /Cold shutdown/i.test(o2.result.title), 'slow crew still survives (got ' + JSON.stringify(o2.result) + ')');
  const o3 = await play(5, { idle: true, maxT: 900 }, 'frozen crew');
  check(o3.result && /Core damage/i.test(o3.result.title), 'doing nothing ends in core damage (got ' + JSON.stringify(o3.result) + ')');
  check(o3.crisisT > 180 && o3.crisisT < 420, 'meltdown arrives between 3 and 7 minutes after the blackout (T+' + o3.crisisT.toFixed(0) + ')');
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
