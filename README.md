# Cold Shutdown

A first-person 3D game about running a nuclear power plant. You are the new Lead Engineer at
**Cedar Hollow Unit 2**, a 1,120 MWe pressurized water reactor. Work five day shifts: match grid
demand, keep the core in spec, walk the plant to fix what breaks, and deal with a VP who has just
bought some reactor-optimizing AI. On Friday a storm takes out the grid and you have to stop a
full core meltdown.

Your shift supervisor, Gus Kettleman, played tight end in college. He blocks for you. He will
mention it.

## Play

```bash
npm start            # serves the game at http://127.0.0.1:8080/
# or any static server, e.g. python3 -m http.server
```

Or build a single self-contained HTML file and open it directly:

```bash
npm run build        # -> dist/cold-shutdown.html
```

Three.js and the fonts load from public CDNs, so you need an internet connection.
It runs in any modern desktop browser with WebGL, and on phones with touch controls.

### Controls

| | Desktop | Touch |
|---|---|---|
| Move | WASD / arrows, Shift to run | Left thumb stick |
| Look | Mouse (click to capture; drag if the page blocks pointer lock) | Drag anywhere else |
| Use / talk / hold to turn valves | E or left click | USE button |
| Plant map | M or Tab | MAP |
| Fast-forward quiet stretches | Hold T | Hold ▶▶ |
| Pause | Esc | II |
| At the control board | W/S rods, A/D turbine, Esc to close | Sliders and buttons |

### Running the reactor (the short version)

- **Turbine load** decides how many megawatts you sell. Match the grid's demand.
- **Control rods** set the core temperature. Keep **Tavg** between 295 and 305 °C: withdraw rods if
  it's low, insert them if it's high. About 1% of rod travel ≈ 1 °C.
- Keep **fuel clad** under 345 °C. Pushing too hard trips the reactor (and costs you grade).
- After any trip, the reactor still makes **decay heat** for hours. Cooling is never optional.
- Indicators can lie. Gauges are physics.

## The week

| Day | Shift | What happens |
|---|---|---|
| 1 · Mon | Orientation | Meet the crew, learn the board, walk down the coolant pumps |
| 2 · Tue | Heat Wave | Record demand, a warm river, a vibrating pump, a small tremor |
| 3 · Wed | The Inspector | A regulator quiz, a suspicious relief valve, a turbine trip |
| 4 · Thu | AutoOptimize | The VP installs an AI that "helps", a diesel fails its test |
| 5 · Fri | The Storm | Station blackout. Stop the meltdown. |

Each normal day ends with a shift report and a grade. Progress is saved in the browser.

## How it's built

Plain JavaScript and [three.js](https://threejs.org/) r149, no build step required.

| File | What it does |
|---|---|
| `js/sim.js` | The reactor model: point-kinetics-style power with moderator and Doppler feedback, decay heat, core and coolant temperatures, pressurizer and PORV, coolant inventory, pumps, turbine, steam dumps, diesels, ECCS, boration. Pure JS, unit-tested in Node. |
| `js/world.js` | The 3D plant: control room, containment (vessel with moving rod drives, steam generators, pumps, pressurizer), turbine hall, diesel building, auxiliary building with the spent fuel pool, server room, exterior and weather. |
| `js/screens.js` | Live canvas displays inside the world (wall overview, console, annunciators, gauges). |
| `js/player.js` | First-person controller with pointer lock, drag-look fallback and touch controls. |
| `js/audio.js` | All sound, synthesized with Web Audio. |
| `js/story.js` | The cast, the five days, and the async "director" that runs each day's script. |
| `js/ui.js`, `css/style.css` | HUD, dialogue, control board, map, menus and reports. |
| `js/main.js` | Game loop, input, interactions, scoring and endings. |

## Tests

```bash
npm test             # reactor model unit tests (Node 18+)
npm run test:e2e     # headless playthrough of all five days (needs Playwright + Chromium)
```

The playthrough injects a bot (`tests/bot.js`) that plays each day: a competent operator for
Days 1–4, then three crews on Day 5: one that works the emergency procedure quickly, one that's
slow (and should still survive), and one that freezes (and should melt the core).
Set `THREE_LOCAL=/path/to/three.min.js` to run it offline.

The physics is simplified for gameplay. Please do not use it to run an actual reactor.
