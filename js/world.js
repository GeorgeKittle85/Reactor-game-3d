/*
 * The 3D plant: rooms, equipment, lights, NPC bodies, weather and animated machinery.
 * Coordinates are metres. +x east, -z north, y up. Floor is y = 0.
 *
 *   z=-34 ┌──────────────┐
 *   DG    │ Containment  │  Turbine Hall
 *   z=-4 ═╧══ corridor ══╧═══════════════
 *   z=0    Aux │ Control │ Server
 *   z=16
 */
(function () {
  'use strict';
  const G = window.G;
  const U = G.U;
  const T = THREE;

  const ROOMS = [
    { id: 'control', name: 'Control Room', x0: -10, x1: 10, z0: 0, z1: 16, h: 4.2 },
    { id: 'server', name: 'Server Room', x0: 10, x1: 17, z0: 0, z1: 12, h: 3.5 },
    { id: 'aux', name: 'Auxiliary Building', x0: -32, x1: -10, z0: 0, z1: 16, h: 6 },
    { id: 'corridor', name: 'Main Corridor', x0: -36, x1: 46, z0: -4, z1: 0, h: 4 },
    { id: 'containment', name: 'Containment', x0: -15, x1: 15, z0: -34, z1: -4, h: 18 },
    { id: 'turbine', name: 'Turbine Hall', x0: 15, x1: 46, z0: -32, z1: -4, h: 12 },
    { id: 'dg', name: 'Diesel Generator Building', x0: -36, x1: -15, z0: -22, z1: -4, h: 7 },
  ];

  const DOORS = [
    { x: -6, z: 0, w: 2.2, axis: 'x' },
    { x: 6, z: 0, w: 2.2, axis: 'x' },
    { x: -21, z: 0, w: 2.4, axis: 'x' },
    { x: 10, z: 6, w: 1.6, axis: 'z' },
    { x: -26, z: -4, w: 3, axis: 'x' },
    { x: 0, z: -4, w: 3.2, axis: 'x' },
    { x: 30, z: -4, w: 3, axis: 'x' },
  ];

  function boxGeo(w, h, d, tile) {
    const g = new T.BoxGeometry(w, h, d);
    if (tile) {
      const uv = g.attributes.uv;
      const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
      for (let f = 0; f < 6; f++) {
        for (let k = 0; k < 4; k++) {
          const i = f * 4 + k;
          uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
        }
      }
    }
    return g;
  }

  function softDot() {
    const c = U.canvas(64, 64);
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    return new T.CanvasTexture(c);
  }

  class World {
    constructor() {
      this.scene = new T.Scene();
      this.colliders = [];
      this.interactables = new Map();
      this.hitboxes = [];
      this.roomLights = [];
      this.fixtureMats = [];
      this.beacons = [];
      this.npcs = {};
      this.time = 0;
      this.lightMode = 'normal';
      this.weather = 'clear';
      this.flashT = 0;
      this.rooms = ROOMS;
      this.doors = DOORS;
      this.anim = {};
      this.shake = 0;
      this.screens = {};
      this.screenTimer = 0;
      this.dot = softDot();
      this.mats = {};
    }

    // ------------------------------------------------------------ helpers
    m(key) {
      return this.mats[key];
    }

    box(x0, x1, y0, y1, z0, z1, mat, opts) {
      opts = opts || {};
      const g = boxGeo(x1 - x0, y1 - y0, z1 - z0, opts.tile);
      const mesh = new T.Mesh(g, mat);
      mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      (opts.parent || this.scene).add(mesh);
      if (opts.collide && y0 < 1.9 && y1 > 0.25) {
        this.colliders.push({ type: 'box', minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1) });
      }
      return mesh;
    }

    cyl(x, z, r, y0, y1, mat, opts) {
      opts = opts || {};
      const g = new T.CylinderGeometry(opts.rTop != null ? opts.rTop : r, r, y1 - y0, opts.segs || 24, 1, !!opts.open);
      const mesh = new T.Mesh(g, mat);
      mesh.position.set(x, (y0 + y1) / 2, z);
      (opts.parent || this.scene).add(mesh);
      if (opts.collide) this.colliders.push({ type: 'circle', x, z, r: opts.collideR || Math.max(r, opts.rTop || 0) });
      return mesh;
    }

    pipe(a, b, r, mat, parent) {
      const va = new T.Vector3(a[0], a[1], a[2]);
      const vb = new T.Vector3(b[0], b[1], b[2]);
      const len = va.distanceTo(vb);
      const g = new T.CylinderGeometry(r, r, len, 14);
      const mesh = new T.Mesh(g, mat);
      mesh.position.copy(va).add(vb).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
      (parent || this.scene).add(mesh);
      return mesh;
    }

    plane(w, h, mat, x, y, z, rotY, parent) {
      const mesh = new T.Mesh(new T.PlaneGeometry(w, h), mat);
      mesh.position.set(x, y, z);
      mesh.rotation.y = rotY || 0;
      (parent || this.scene).add(mesh);
      return mesh;
    }

    floor(x0, x1, z0, z1, mat, tile, y) {
      const w = x1 - x0, d = z1 - z0;
      const g = new T.PlaneGeometry(w, d);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * d) / tile);
      const mesh = new T.Mesh(g, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set((x0 + x1) / 2, y || 0, (z0 + z1) / 2);
      this.scene.add(mesh);
      return mesh;
    }

    ceiling(x0, x1, z0, z1, y, mat, tile) {
      const m = this.floor(x0, x1, z0, z1, mat, tile, y);
      m.rotation.x = Math.PI / 2;
      return m;
    }

    sign(lines, w, h, x, y, z, rotY, opts) {
      const tex = U.signTexture(lines, Object.assign({ w: Math.round(256 * (w / h)), h: 256 }, opts || {}));
      const mat = new T.MeshBasicMaterial({ map: tex, toneMapped: false });
      if (opts && opts.dim) mat.color.setScalar(opts.dim);
      return this.plane(w, h, mat, x, y, z, rotY);
    }

    // Wall running along x at fixed z.
    wallX(z, x0, x1, h, doors, mat, opts) {
      opts = opts || {};
      const t = opts.t || 0.3;
      const ds = (doors || []).slice().sort((a, b) => a.c - b.c);
      let cur = x0;
      for (const d of ds) {
        const a = d.c - d.w / 2, b = d.c + d.w / 2;
        if (a > cur) this.box(cur, a, 0, h, z - t / 2, z + t / 2, mat, { collide: true, tile: 2 });
        this.box(a, b, d.h || 2.6, h, z - t / 2, z + t / 2, mat, { tile: 2 });
        this.doorFrame(d.c, z, d.w, d.h || 2.6, 'x', d.frame);
        cur = b;
      }
      if (cur < x1) this.box(cur, x1, 0, h, z - t / 2, z + t / 2, mat, { collide: true, tile: 2 });
    }

    // Wall running along z at fixed x.
    wallZ(x, z0, z1, h, doors, mat, opts) {
      opts = opts || {};
      const t = opts.t || 0.3;
      const ds = (doors || []).slice().sort((a, b) => a.c - b.c);
      let cur = z0;
      for (const d of ds) {
        const a = d.c - d.w / 2, b = d.c + d.w / 2;
        if (a > cur) this.box(x - t / 2, x + t / 2, 0, h, cur, a, mat, { collide: true, tile: 2 });
        this.box(x - t / 2, x + t / 2, d.h || 2.6, h, a, b, mat, { tile: 2 });
        this.doorFrame(x, d.c, d.w, d.h || 2.6, 'z', d.frame);
        cur = b;
      }
      if (cur < z1) this.box(x - t / 2, x + t / 2, 0, h, cur, z1, mat, { collide: true, tile: 2 });
    }

    doorFrame(a, b, w, h, axis, style) {
      const mat = style === 'hazard' ? this.m('hazardV') : this.m('frame');
      const ft = 0.12, fd = 0.42;
      if (axis === 'x') {
        const x = a, z = b;
        this.box(x - w / 2 - ft, x - w / 2, 0, h, z - fd / 2, z + fd / 2, mat);
        this.box(x + w / 2, x + w / 2 + ft, 0, h, z - fd / 2, z + fd / 2, mat);
        this.box(x - w / 2 - ft, x + w / 2 + ft, h, h + ft, z - fd / 2, z + fd / 2, mat);
      } else {
        const x = a, z = b;
        this.box(x - fd / 2, x + fd / 2, 0, h, z - w / 2 - ft, z - w / 2, mat);
        this.box(x - fd / 2, x + fd / 2, 0, h, z + w / 2, z + w / 2 + ft, mat);
        this.box(x - fd / 2, x + fd / 2, h, h + ft, z - w / 2 - ft, z + w / 2 + ft, mat);
      }
    }

    light(room, x, y, z, color, intensity, distance) {
      const l = new T.PointLight(color, intensity, distance, 1.6);
      l.position.set(x, y, z);
      this.scene.add(l);
      this.roomLights.push({ light: l, room, base: intensity, color: new T.Color(color) });
      return l;
    }

    fixture(x0, x1, z0, z1, y, room) {
      let entry = this.fixtureMats.find((f) => f.room === room);
      if (!entry) {
        const mat = new T.MeshBasicMaterial({ color: '#fff6e6', toneMapped: false });
        entry = { room, mat, base: new T.Color('#fff6e6') };
        this.fixtureMats.push(entry);
      }
      const mesh = new T.Mesh(new T.PlaneGeometry(x1 - x0, z1 - z0), entry.mat);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set((x0 + x1) / 2, y - 0.02, (z0 + z1) / 2);
      this.scene.add(mesh);
      return mesh;
    }

    beacon(x, y, z) {
      const g = new T.Group();
      const base = new T.Mesh(new T.CylinderGeometry(0.12, 0.14, 0.08, 12), this.m('darkSteel'));
      const domeMat = new T.MeshBasicMaterial({ color: '#5a1010', toneMapped: false });
      const dome = new T.Mesh(new T.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
      dome.position.y = 0.04;
      const beam = new T.Mesh(
        new T.ConeGeometry(0.6, 2.2, 16, 1, true),
        new T.MeshBasicMaterial({ color: '#ff2a2a', transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide, toneMapped: false })
      );
      beam.rotation.z = Math.PI / 2;
      beam.position.x = 1.1;
      const spin = new T.Group();
      spin.add(beam);
      spin.position.y = 0.1;
      g.add(base, dome, spin);
      g.position.set(x, y, z);
      this.scene.add(g);
      this.beacons.push({ g, domeMat, beam, spin });
    }

    addInteract(id, label, x, y, z, w, h, d, room) {
      const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), new T.MeshBasicMaterial({ visible: false }));
      mesh.position.set(x, y, z);
      mesh.userData.interactId = id;
      this.scene.add(mesh);
      this.hitboxes.push(mesh);
      const it = { id, label, mesh, pos: mesh.position, room };
      this.interactables.set(id, it);
      return it;
    }

    roomAt(x, z) {
      for (const r of ROOMS) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r;
      return null;
    }

    // ------------------------------------------------------------ build
    build() {
      this.makeMaterials();
      this.buildSkyAndExterior();
      this.buildShell();
      this.buildControlRoom();
      this.buildServerRoom();
      this.buildCorridor();
      this.buildContainment();
      this.buildTurbineHall();
      this.buildDieselRoom();
      this.buildAux();
      this.buildWeather();
      this.buildNPCs();
      this.scene.updateMatrixWorld(true);
    }

    makeMaterials() {
      const std = (o) => new T.MeshStandardMaterial(Object.assign({ roughness: 0.85, metalness: 0.05 }, o));
      const M = this.mats;
      M.block = std({ map: U.tex('block'), color: '#f2f0ea' });
      M.blockWarm = std({ map: U.tex('block'), color: '#e9dfcc' });
      M.concrete = std({ map: U.tex('concrete'), color: '#ffffff' });
      M.concreteDark = std({ map: U.tex('concrete'), color: '#8a8c8a' });
      M.epoxy = std({ map: U.tex('epoxy'), color: '#ffffff', roughness: 0.6 });
      M.vinyl = std({ map: U.tex('vinyl'), color: '#ffffff', roughness: 0.55 });
      M.carpet = std({ map: U.tex('carpet'), color: '#ffffff', roughness: 1 });
      M.ceiling = std({ map: U.tex('ceiling'), color: '#ffffff', roughness: 0.95 });
      M.ceilingDark = std({ color: '#3a3f44', roughness: 1 });
      M.steel = std({ color: '#9aa3a8', metalness: 0.6, roughness: 0.4 });
      M.darkSteel = std({ color: '#3d454c', metalness: 0.5, roughness: 0.5 });
      M.blue = std({ color: '#2d5f8f', metalness: 0.2, roughness: 0.55 });
      M.green = std({ color: '#2f6b4f', metalness: 0.2, roughness: 0.5 });
      M.yellow = std({ color: '#e5b31f', roughness: 0.55 });
      M.red = std({ color: '#c0392b', roughness: 0.45, metalness: 0.2 });
      M.cream = std({ color: '#ddd6c2', roughness: 0.8 });
      M.white = std({ color: '#e7eae6', roughness: 0.7 });
      M.desk = std({ color: '#4a525a', roughness: 0.6 });
      M.deskTop = std({ color: '#c6c3b8', roughness: 0.5 });
      M.black = std({ color: '#15181b', roughness: 0.6 });
      M.frame = std({ color: '#5f6b73', metalness: 0.3, roughness: 0.5 });
      const hz = U.tex('hazard').clone();
      hz.needsUpdate = true;
      hz.repeat.set(1, 6);
      hz.rotation = Math.PI / 2;
      M.hazardV = std({ map: hz, roughness: 0.6 });
      M.hazard = std({ map: U.tex('hazard'), roughness: 0.6 });
      M.glass = new T.MeshBasicMaterial({ color: '#a9cfe0', transparent: true, opacity: 0.1, depthWrite: false });
      M.screenOff = new T.MeshBasicMaterial({ color: '#0b1115' });
    }

    buildSkyAndExterior() {
      const s = this.scene;
      // Sky dome
      this.skyUniforms = {
        top: { value: new T.Color('#3b6ea8') },
        horizon: { value: new T.Color('#cfe0ea') },
        flash: { value: 0 },
      };
      const sky = new T.Mesh(
        new T.SphereGeometry(450, 32, 16),
        new T.ShaderMaterial({
          side: T.BackSide,
          depthWrite: false,
          uniforms: this.skyUniforms,
          vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
          fragmentShader:
            'uniform vec3 top; uniform vec3 horizon; uniform float flash; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y, -0.1, 1.0); vec3 c = mix(horizon, top, pow(max(h,0.0), 0.55)); c = mix(c, vec3(0.85,0.88,1.0), flash); gl_FragColor = vec4(c, 1.0); }',
        })
      );
      s.add(sky);

      this.hemi = new T.HemisphereLight('#dfe9f2', '#3a3530', 0.55);
      s.add(this.hemi);
      this.ambient = new T.AmbientLight('#ffffff', 0.12);
      s.add(this.ambient);

      // Ground
      const grass = new T.MeshLambertMaterial({ map: U.tex('grass') });
      const g = this.floor(-300, 300, -300, 300, grass, 12, -0.03);
      g.renderOrder = -1;
      const asphalt = new T.MeshLambertMaterial({ map: U.tex('asphalt') });
      this.floor(-24, 24, 17, 40, asphalt, 8, -0.01);
      this.floor(46, 80, -36, 0, asphalt, 8, -0.01);
      this.exteriorMats = [grass, asphalt];

      // Cooling towers
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const y = (i / 24) * 75;
        pts.push(new T.Vector2(18 * Math.sqrt(1 + Math.pow((y - 55) / 41.2, 2)), y));
      }
      const towerMat = new T.MeshLambertMaterial({ color: '#b9b8b1', side: T.DoubleSide });
      this.exteriorMats.push(towerMat);
      this.towers = [];
      for (const [x, z] of [[30, 120], [-45, 140], [140, -40]]) {
        const tower = new T.Mesh(new T.LatheGeometry(pts, 40), towerMat);
        tower.position.set(x, 0, z);
        s.add(tower);
        this.towers.push({ x, z, top: 75, r: 19 });
      }
      // Steam plumes
      const steamMat = new T.SpriteMaterial({ map: this.dot, color: '#f2f4f5', transparent: true, opacity: 0.5, depthWrite: false });
      this.plumes = [];
      for (const tw of this.towers) {
        for (let i = 0; i < 26; i++) {
          const sp = new T.Sprite(steamMat.clone());
          sp.userData = { tower: tw, life: Math.random() };
          s.add(sp);
          this.plumes.push(sp);
        }
      }

      // Parking lot, a pickup truck (Gus's), fence, light poles
      const truck = new T.Group();
      const red = new T.MeshLambertMaterial({ color: '#8f1f1f' });
      this.box(-1.0, 1.0, 0.5, 1.4, -2.6, 2.6, red, { parent: truck });
      this.box(-1.0, 1.0, 1.4, 2.2, -0.6, 1.6, red, { parent: truck });
      this.box(-0.95, 0.95, 1.45, 2.1, 1.55, 1.62, new T.MeshBasicMaterial({ color: '#203040' }), { parent: truck });
      const wheelMat = new T.MeshLambertMaterial({ color: '#111' });
      for (const [wx, wz] of [[-1, -1.7], [1, -1.7], [-1, 1.7], [1, 1.7]]) {
        const w = new T.Mesh(new T.CylinderGeometry(0.42, 0.42, 0.3, 16), wheelMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(wx, 0.42, wz);
        truck.add(w);
      }
      truck.position.set(5, 0, 27);
      truck.rotation.y = 0.15;
      s.add(truck);
      const car = truck.clone();
      car.position.set(-9, 0, 31);
      car.rotation.y = -0.1;
      car.traverse((o) => {
        if (o.material === red) o.material = new T.MeshLambertMaterial({ color: '#2f4d6b' });
      });
      s.add(car);
      const postMat = new T.MeshLambertMaterial({ color: '#7d8388' });
      for (let x = -30; x <= 30; x += 3) {
        this.cyl(x, 44, 0.05, 0, 2.2, postMat, { segs: 6 });
      }
      this.box(-30, 30, 2.0, 2.06, 43.97, 44.03, postMat);
      this.box(-30, 30, 1.0, 1.04, 43.97, 44.03, postMat);
      for (const x of [-16, 16]) {
        this.cyl(x, 24, 0.09, 0, 7, postMat, { segs: 8 });
        this.box(x - 0.6, x + 0.6, 6.9, 7.1, 23.8, 24.2, postMat);
      }
      // Switchyard pylons east (seen from turbine hall)
      for (const [x, z] of [[85, -10], [85, -35], [110, -10], [110, -35]]) {
        this.cyl(x, z, 0.5, 0, 26, postMat, { rTop: 0.15, segs: 4 });
        this.box(x - 4, x + 4, 22, 22.4, z - 0.3, z + 0.3, postMat);
      }
    }

    buildShell() {
      const M = this.mats;
      // Floors
      this.floor(-10, 10, 0, 16, M.carpet, 0.6);
      this.floor(10, 17, 0, 12, M.vinyl, 1.2);
      this.floor(-32, -10, 0, 16, M.epoxy, 4);
      this.floor(-36, 46, -4, 0, M.vinyl, 1.2);
      this.floor(-15, 15, -34, -4, M.epoxy, 4);
      this.floor(15, 46, -32, -4, M.epoxy, 4);
      this.floor(-36, -15, -22, -4, M.concrete, 4);
      // Ceilings
      this.ceiling(-10, 10, 0, 16, 4.2, M.ceiling, 1.2);
      this.ceiling(10, 17, 0, 12, 3.5, M.ceiling, 1.2);
      this.ceiling(-32, -10, 0, 16, 6, M.ceilingDark, 4);
      this.ceiling(-36, 46, -4, 0, 4, M.ceiling, 1.2);
      this.ceiling(-15, 15, -34, -4, 18, M.ceilingDark, 4);
      this.ceiling(15, 46, -32, -4, 12, M.ceilingDark, 4);
      this.ceiling(-36, -15, -22, -4, 7, M.ceilingDark, 4);

      // Walls
      const W = M.block;
      // Corridor south wall z=0 (control, aux, server doors)
      this.wallX(0, -36, 46, 6, [{ c: -21, w: 2.4 }, { c: -6, w: 2.2 }, { c: 6, w: 2.2 }], W);
      // Corridor north wall z=-4 in three height segments
      this.wallX(-4, -36, -15, 7, [{ c: -26, w: 3, h: 3 }], W);
      this.wallX(-4, -15, 15, 18, [{ c: 0, w: 3.2, h: 3.2, frame: 'hazard' }], M.concrete);
      this.wallX(-4, 15, 46, 12, [{ c: 30, w: 3, h: 3.2 }], W);
      // Outer west / east of corridor & DG
      this.wallZ(-36, -22, 0, 7, [], W);
      this.wallZ(46, -4, 0, 4, [], W);
      // DG north, containment west
      this.wallX(-22, -36, -15, 7, [], W);
      this.wallZ(-15, -34, -4, 18, [], M.concrete);
      this.wallZ(15, -34, -4, 18, [], M.concrete);
      this.wallX(-34, -15, 15, 18, [], M.concrete);
      // Turbine north + east (with clerestory windows)
      this.wallX(-32, 15, 46, 12, [], W);
      this.windowWallZ(46, -32, -4, 12, { a: -29, b: -7, y0: 4.5, y1: 8.5 }, W);
      // Aux
      this.wallZ(-32, 0, 16, 6, [], W);
      this.wallX(16, -32, -10, 6, [], W);
      this.wallZ(-10, 0, 16, 6, [], W);
      // Control room south (windows) and east (server door)
      this.windowWallX(16, -10, 10, 4.2, { a: -8.5, b: 8.5, y0: 1.1, y1: 2.9 }, M.blockWarm);
      this.wallZ(10, 0, 16, 4.2, [{ c: 6, w: 1.6, h: 2.4 }], M.blockWarm);
      // Server
      this.wallZ(17, 0, 12, 3.5, [], W);
      this.wallX(12, 10, 17, 3.5, [], W);
    }

    windowWallX(z, x0, x1, h, win, mat) {
      const t = 0.3;
      this.box(x0, win.a, 0, h, z - t / 2, z + t / 2, mat, { tile: 2 });
      this.box(win.b, x1, 0, h, z - t / 2, z + t / 2, mat, { tile: 2 });
      this.box(win.a, win.b, 0, win.y0, z - t / 2, z + t / 2, mat, { tile: 2 });
      this.box(win.a, win.b, win.y1, h, z - t / 2, z + t / 2, mat, { tile: 2 });
      this.colliders.push({ type: 'box', minX: x0, maxX: x1, minZ: z - t / 2, maxZ: z + t / 2 });
      const glass = this.plane(win.b - win.a, win.y1 - win.y0, this.m('glass'), (win.a + win.b) / 2, (win.y0 + win.y1) / 2, z, 0);
      this.glass = (this.glass || []).concat(glass);
      for (let x = win.a; x <= win.b + 0.01; x += (win.b - win.a) / 8) {
        this.box(x - 0.05, x + 0.05, win.y0, win.y1, z - 0.08, z + 0.08, this.m('frame'));
      }
      this.box(win.a, win.b, win.y0 - 0.05, win.y0 + 0.04, z - 0.25, z + 0.05, this.m('frame'));
    }

    windowWallZ(x, z0, z1, h, win, mat) {
      const t = 0.3;
      this.box(x - t / 2, x + t / 2, 0, h, z0, win.a, mat, { tile: 2 });
      this.box(x - t / 2, x + t / 2, 0, h, win.b, z1, mat, { tile: 2 });
      this.box(x - t / 2, x + t / 2, 0, win.y0, win.a, win.b, mat, { tile: 2 });
      this.box(x - t / 2, x + t / 2, win.y1, h, win.a, win.b, mat, { tile: 2 });
      this.colliders.push({ type: 'box', minX: x - t / 2, maxX: x + t / 2, minZ: z0, maxZ: z1 });
      const glass = this.plane(win.b - win.a, win.y1 - win.y0, this.m('glass'), x, (win.y0 + win.y1) / 2, (win.a + win.b) / 2, Math.PI / 2);
      this.glass = (this.glass || []).concat(glass);
      for (let z = win.a; z <= win.b + 0.01; z += (win.b - win.a) / 10) {
        this.box(x - 0.08, x + 0.08, win.y0, win.y1, z - 0.06, z + 0.06, this.m('frame'));
      }
    }

    makeScreen(key, w, h) {
      const c = U.canvas(w, h);
      const tex = new T.CanvasTexture(c);
      tex.encoding = T.sRGBEncoding;
      tex.anisotropy = 4;
      const mat = new T.MeshBasicMaterial({ map: tex, toneMapped: false });
      this.screens[key] = { canvas: c, ctx: c.getContext('2d'), tex, mat };
      return mat;
    }

    buildControlRoom() {
      const M = this.mats;
      // Main wall display
      const wallMat = this.makeScreen('wall', 1536, 512);
      this.box(-4.45, 4.45, 1.0, 4.0, 0.15, 0.3, M.black);
      this.plane(8.4, 2.8, wallMat, 0, 2.5, 0.31, 0);
      this.sign(['UNIT 2 · CEDAR HOLLOW GENERATING STATION'], 6, 0.36, 0, 4.0, 0.31, 0, { bg: '#11171c', fg: '#ffb547', border: false });

      // Horseshoe console
      const consoleScreen = this.makeScreen('console', 1024, 256);
      const annMat = this.makeScreen('annun', 512, 256);
      const seg = (cx, cz, rot, w, screenMat) => {
        const g = new T.Group();
        g.position.set(cx, 0, cz);
        g.rotation.y = rot;
        this.scene.add(g);
        this.box(-w / 2, w / 2, 0, 0.78, -0.55, 0.45, M.desk, { parent: g });
        this.box(-w / 2 - 0.02, w / 2 + 0.02, 0.78, 0.84, -0.6, 0.55, M.deskTop, { parent: g });
        const back = this.box(-w / 2, w / 2, 0.84, 1.62, -0.6, -0.3, M.desk, { parent: g });
        back.rotation.x = -0.18;
        if (screenMat) {
          const scr = new T.Mesh(new T.PlaneGeometry(w - 0.2, 0.62), screenMat);
          scr.position.set(0, 1.24, -0.27);
          scr.rotation.x = -0.18;
          g.add(scr);
        }
        // switch rows on the desk
        for (let i = 0; i < Math.floor(w / 0.35); i++) {
          const k = new T.Mesh(new T.BoxGeometry(0.08, 0.04, 0.12), i % 4 === 0 ? M.red : M.darkSteel);
          k.position.set(-w / 2 + 0.25 + i * 0.35, 0.86, 0.2);
          g.add(k);
        }
        return g;
      };
      seg(0, 6.9, 0, 6, consoleScreen);
      seg(-4.7, 7.6, 0.62, 3.0, annMat);
      seg(4.7, 7.6, -0.62, 3.0, annMat);
      this.colliders.push({ type: 'box', minX: -3.1, maxX: 3.1, minZ: 6.2, maxZ: 7.5 });
      this.colliders.push({ type: 'circle', x: -4.7, z: 7.6, r: 1.3 });
      this.colliders.push({ type: 'circle', x: 4.7, z: 7.6, r: 1.3 });
      // SCRAM button pedestal on the desk
      const scramCover = new T.Mesh(new T.CylinderGeometry(0.09, 0.09, 0.05, 16), new T.MeshStandardMaterial({ color: '#d11', emissive: '#400', roughness: 0.3 }));
      scramCover.position.set(2.6, 0.87, 7.3);
      this.scene.add(scramCover);
      this.addInteract('mainConsole', 'Use the main reactor console', 0, 1.0, 7.3, 8.6, 1.8, 2.0, 'control');

      // Chairs
      const chair = (x, z, r) => {
        const g = new T.Group();
        this.cyl(0, 0, 0.04, 0.05, 0.45, M.darkSteel, { parent: g, segs: 8 });
        this.box(-0.25, 0.25, 0.45, 0.55, -0.25, 0.25, M.black, { parent: g });
        this.box(-0.25, 0.25, 0.55, 1.15, 0.2, 0.28, M.black, { parent: g });
        g.position.set(x, 0, z);
        g.rotation.y = r || 0;
        this.scene.add(g);
      };
      chair(-1.4, 8.3, 0.1);
      chair(1.4, 8.3, -0.1);
      chair(-6.4, 11.4, Math.PI);

      // Supervisor desk with the mug and monitor
      this.box(-8.0, -4.9, 0, 0.76, 11.9, 12.9, M.desk, { collide: true });
      this.box(-8.05, -4.85, 0.76, 0.8, 11.85, 12.95, M.deskTop);
      this.box(-7.0, -6.0, 0.8, 1.4, 12.55, 12.62, M.black);
      const mugTex = U.signTexture(['85'], { w: 128, h: 128, bg: '#d0a020', fg: '#5c0f0f', border: false, size: 80 });
      const mug = new T.Mesh(new T.CylinderGeometry(0.05, 0.045, 0.11, 16), new T.MeshStandardMaterial({ map: mugTex, roughness: 0.4 }));
      mug.position.set(-5.4, 0.86, 12.3);
      mug.rotation.y = 0.6;
      this.scene.add(mug);
      // The championship belt on the west wall
      const beltG = new T.Group();
      this.box(-0.9, 0.9, -0.08, 0.08, -0.01, 0.02, M.black, { parent: beltG });
      const plateTex = U.signTexture(['SAFETY', 'CHAMPION · UNIT 2'], { w: 256, h: 160, bg: '#c99a2e', fg: '#3a2405', borderColor: '#f3d27a' });
      const plate = new T.Mesh(new T.CircleGeometry(0.26, 24), new T.MeshStandardMaterial({ map: plateTex, metalness: 0.6, roughness: 0.3 }));
      plate.position.z = 0.03;
      beltG.add(plate);
      beltG.position.set(-9.83, 2.35, 12.4);
      beltG.rotation.y = Math.PI / 2;
      this.scene.add(beltG);
      this.addInteract('belt', 'Admire the championship belt', -9.6, 2.3, 12.4, 0.5, 0.8, 2.0, 'control');

      // Mimic board on the west wall
      const mimicTex = this.mimicTexture();
      this.plane(6.5, 2.2, new T.MeshBasicMaterial({ map: mimicTex, toneMapped: false }), -9.83, 2.2, 5.5, Math.PI / 2);
      // Procedures shelf
      this.box(-9.85, -9.35, 0, 1.2, 1.2, 3.4, M.desk, { collide: true });
      const binderColors = ['#b22', '#e6b31f', '#2d5f8f', '#2f6b4f', '#ddd'];
      for (let i = 0; i < 14; i++) {
        this.box(-9.8, -9.42, 1.2, 1.2 + 0.28 + Math.random() * 0.05, 1.3 + i * 0.14, 1.3 + i * 0.14 + 0.11, new T.MeshStandardMaterial({ color: binderColors[i % 5], roughness: 0.7 }));
      }
      this.addInteract('eop', 'Read the emergency procedures', -9.5, 1.3, 2.3, 0.9, 1.2, 2.4, 'control');

      // East wall: shift board, poster, coffee
      const boardMat = this.makeScreen('board', 768, 512);
      this.box(9.8, 9.86, 1.0, 2.9, 1.0, 4.4, M.frame);
      this.plane(3.3, 1.8, boardMat, 9.78, 1.95, 2.7, -Math.PI / 2);
      const poster = this.posterTexture();
      this.plane(1.3, 1.8, new T.MeshStandardMaterial({ map: poster, roughness: 0.9 }), 9.83, 2.0, 10.5, -Math.PI / 2);
      this.box(8.2, 9.85, 0, 0.9, 13.6, 15.85, M.desk, { collide: true });
      this.box(8.15, 9.85, 0.9, 0.95, 13.55, 15.85, M.deskTop);
      const cm = new T.Group();
      this.box(-0.25, 0.25, 0, 0.55, -0.22, 0.22, M.black, { parent: cm });
      this.box(-0.2, 0.2, 0.32, 0.5, 0.22, 0.24, new T.MeshBasicMaterial({ color: '#1e8f5a', toneMapped: false }), { parent: cm });
      cm.position.set(9.3, 0.95, 14.9);
      cm.rotation.y = -Math.PI / 2;
      this.scene.add(cm);
      this.addInteract('coffee', 'Pour a coffee', 9.1, 1.2, 14.9, 1.2, 0.9, 1.2, 'control');

      // Lights and fixtures
      for (const z of [3, 7, 11, 14.5]) {
        for (const x of [-6, -2, 2, 6]) this.fixture(x - 1.2, x + 1.2, z - 0.3, z + 0.3, 4.2, 'control');
      }
      this.light('control', 0, 3.7, 4.5, '#fff1df', 0.85, 24);
      this.light('control', 0, 3.7, 12, '#fff1df', 0.75, 24);
      this.beacon(-9.6, 3.9, 0.6);
      this.beacon(9.6, 3.9, 0.6);
      this.sign(['CONTROL ROOM'], 2.6, 0.4, -6, 3.35, -0.16, Math.PI, { bg: '#1f4f86' });
      this.sign(['CONTROL ROOM'], 2.6, 0.4, 6, 3.35, -0.16, Math.PI, { bg: '#1f4f86' });
      this.sign(['SERVER ROOM'], 1.6, 0.3, 9.83, 2.75, 6, -Math.PI / 2, { bg: '#2b2f36' });
    }

    mimicTexture() {
      const c = U.canvas(1024, 352);
      const x = c.getContext('2d');
      x.fillStyle = '#d6d4c8';
      x.fillRect(0, 0, 1024, 352);
      x.strokeStyle = '#2d5f8f';
      x.lineWidth = 10;
      x.strokeRect(60, 90, 140, 180);
      x.fillStyle = '#2d5f8f';
      x.font = '700 24px "Barlow Condensed", sans-serif';
      x.fillText('REACTOR', 85, 80);
      x.strokeStyle = '#c0392b';
      x.beginPath();
      x.moveTo(200, 140);
      x.lineTo(420, 140);
      x.stroke();
      x.strokeStyle = '#2d5f8f';
      x.beginPath();
      x.moveTo(420, 240);
      x.lineTo(200, 240);
      x.stroke();
      x.strokeRect(420, 70, 110, 230);
      x.fillText('S/G', 455, 60);
      x.strokeStyle = '#7f8c8d';
      x.beginPath();
      x.moveTo(530, 110);
      x.lineTo(720, 110);
      x.stroke();
      x.strokeRect(720, 80, 220, 90);
      x.fillText('TURBINE · GENERATOR', 740, 70);
      for (let i = 0; i < 18; i++) {
        x.fillStyle = i % 5 === 0 ? '#c0392b' : '#2e9e5b';
        x.beginPath();
        x.arc(80 + i * 50, 320, 8, 0, Math.PI * 2);
        x.fill();
      }
      const t = new T.CanvasTexture(c);
      t.encoding = T.sRGBEncoding;
      return t;
    }

    posterTexture() {
      const c = U.canvas(260, 360);
      const x = c.getContext('2d');
      x.fillStyle = '#1d2a3a';
      x.fillRect(0, 0, 260, 360);
      x.fillStyle = '#ffb547';
      x.font = '700 46px "Chakra Petch", sans-serif';
      x.textAlign = 'center';
      x.fillText('BLOCK', 130, 70);
      x.fillText('FOR', 130, 116);
      x.fillText('SAFETY', 130, 162);
      // a tight end in a three-point stance, very abstract
      x.fillStyle = '#e7eae6';
      x.beginPath();
      x.arc(150, 205, 16, 0, Math.PI * 2);
      x.fill();
      x.fillRect(95, 215, 70, 34);
      x.fillRect(95, 249, 16, 52);
      x.fillRect(150, 249, 16, 52);
      x.fillRect(165, 230, 40, 12);
      x.fillStyle = '#c0392b';
      x.font = '700 30px "Chakra Petch", sans-serif';
      x.fillText('85', 130, 242);
      x.fillStyle = '#9fb4c0';
      x.font = '500 18px "Barlow Condensed", sans-serif';
      x.fillText('Finish every block. Finish every procedure.', 130, 335);
      const t = new T.CanvasTexture(c);
      t.encoding = T.sRGBEncoding;
      return t;
    }

    buildServerRoom() {
      const M = this.mats;
      const rackMat = new T.MeshStandardMaterial({ map: U.tex('rack'), emissive: '#ffffff', emissiveMap: U.tex('rack'), emissiveIntensity: 0.6, roughness: 0.6 });
      this.serverRackMat = rackMat;
      for (const z of [2.5, 4.2, 7.6, 9.3]) {
        this.box(12.2, 13.2, 0, 2.1, z - 0.4, z + 0.4, M.black, { collide: true });
        this.plane(0.8, 2.0, rackMat, 13.21, 1.05, z, Math.PI / 2);
      }
      for (const z of [7.6, 9.3, 11]) {
        this.box(15.8, 16.8, 0, 2.1, z - 0.4, z + 0.4, M.black, { collide: true });
        this.plane(0.8, 2.0, rackMat, 15.79, 1.05, z, -Math.PI / 2);
      }
      // AutoOptimize cabinet
      const ao = new T.Group();
      this.box(-0.5, 0.5, 0, 2.2, -0.9, 0.9, new T.MeshStandardMaterial({ color: '#191526', metalness: 0.4, roughness: 0.35 }), { parent: ao });
      const aoMat = this.makeScreen('ao', 256, 512);
      const aoScreen = new T.Mesh(new T.PlaneGeometry(1.4, 1.9), aoMat);
      aoScreen.position.set(-0.51, 1.1, 0);
      aoScreen.rotation.y = -Math.PI / 2;
      ao.add(aoScreen);
      this.aoGlow = new T.MeshBasicMaterial({ color: '#ff4fd8', toneMapped: false });
      const strip = new T.Mesh(new T.BoxGeometry(0.04, 2.2, 0.04), this.aoGlow);
      strip.position.set(-0.52, 1.1, 0.92);
      const strip2 = strip.clone();
      strip2.position.z = -0.92;
      ao.add(strip, strip2);
      // power cord & plug on the wall
      this.aoPlug = new T.Mesh(new T.BoxGeometry(0.12, 0.18, 0.08), new T.MeshStandardMaterial({ color: '#e5b31f' }));
      this.aoPlug.position.set(-0.2, 0.35, -1.25);
      ao.add(this.aoPlug);
      ao.position.set(16.3, 0, 3.4);
      this.scene.add(ao);
      this.colliders.push({ type: 'box', minX: 15.7, maxX: 17, minZ: 2.4, maxZ: 4.4 });
      this.addInteract('autoOpt', 'AutoOptimize™ cabinet', 15.6, 1.1, 3.2, 0.8, 2.2, 2.4, 'server');
      this.light('server', 13.5, 3.2, 6, '#9fc4ff', 0.6, 14);
      for (const z of [3, 6, 9]) this.fixture(13, 15, z - 0.25, z + 0.25, 3.5, 'server');
    }

    buildCorridor() {
      const M = this.mats;
      for (let x = -33; x <= 44; x += 6) this.fixture(x - 1, x + 1, -2.3, -1.7, 4, 'corridor');
      this.light('corridor', -18, 3.6, -2, '#f3f6ff', 0.75, 30);
      this.light('corridor', 22, 3.6, -2, '#f3f6ff', 0.75, 30);
      // pipes & cable tray along the ceiling
      this.pipe([-36, 3.5, -3.6], [46, 3.5, -3.6], 0.12, M.blue);
      this.pipe([-36, 3.25, -3.6], [46, 3.25, -3.6], 0.08, M.green);
      this.box(-36, 46, 3.65, 3.72, -1.0, -0.3, M.steel);
      // stripes on floor
      this.box(-36, 46, 0.005, 0.012, -3.75, -3.65, M.yellow);
      this.box(-36, 46, 0.005, 0.012, -0.35, -0.25, M.yellow);
      // signs above doors (corridor side)
      const sg = (txt, x, z, rot, bg) => this.sign(txt, 3.2, 0.5, x, 3.25, z, rot, { bg: bg || '#1f4f86' });
      sg(['DIESEL GENERATORS'], -26, -3.84, 0);
      sg(['CONTAINMENT · UNIT 2'], 0, -3.84, 0, '#7a1f6a');
      sg(['TURBINE HALL'], 30, -3.84, 0);
      sg(['AUXILIARY BLDG · CVCS'], -21, -0.16, Math.PI);
      sg(['CONTROL ROOM'], -6, -0.16, Math.PI);
      sg(['CONTROL ROOM'], 6, -0.16, Math.PI);
      this.sign(['⚠ RADIATION CONTROLLED AREA'], 2.6, 0.32, 0, 2.75, -3.84, 0, { bg: '#f2c230', fg: '#5a1056', border: false });
      // a few lockers, extinguisher, bench
      for (let i = 0; i < 5; i++) this.box(36 + i * 0.62, 36.6 + i * 0.62, 0, 1.9, -0.6, -0.15, M.frame, { collide: true });
      this.box(-34, -31.5, 0, 0.45, -0.7, -0.25, M.desk, { collide: true });
      this.cyl(-12, -0.3, 0.1, 0.4, 0.95, M.red, { segs: 10 });
      this.beacon(-9, 3.8, -0.4);
      this.beacon(18, 3.8, -0.4);
    }

    buildContainment() {
      const M = this.mats;
      const s = this.scene;
      // Ribs on the walls, catwalk, painted UNIT 2
      for (let x = -12; x <= 12; x += 6) {
        this.box(x - 0.3, x + 0.3, 0, 18, -33.85, -33.5, M.concreteDark);
      }
      for (let z = -30; z <= -8; z += 6) {
        this.box(-14.85, -14.5, 0, 18, z - 0.3, z + 0.3, M.concreteDark);
        this.box(14.5, 14.85, 0, 18, z - 0.3, z + 0.3, M.concreteDark);
      }
      this.box(-14.8, 14.8, 7, 7.2, -33.8, -32.6, M.steel);
      this.box(-14.8, -13.6, 7, 7.2, -33.8, -4.2, M.steel);
      this.box(13.6, 14.8, 7, 7.2, -33.8, -4.2, M.steel);
      this.box(-14.8, 14.8, 8.1, 8.15, -32.62, -32.58, M.yellow);
      this.box(-13.62, -13.58, 8.1, 8.15, -33.8, -4.2, M.yellow);
      this.box(13.58, 13.62, 8.1, 8.15, -33.8, -4.2, M.yellow);
      this.sign(['UNIT 2'], 9, 2.6, 0, 12.5, -33.4, 0, { bg: '#2a2e31', fg: '#e5b31f', border: false, font: '"Chakra Petch", sans-serif' });
      // Polar crane
      this.box(-14.5, 14.5, 15.2, 16, -20.5, -19.5, M.yellow);
      this.box(-14.5, 14.5, 15.2, 16, -17.5, -16.5, M.yellow);
      this.box(-2, 2, 14.4, 15.2, -21, -16, M.yellow);
      this.pipe([0, 14.4, -18.5], [0, 9, -18.5], 0.03, M.darkSteel);
      this.box(-0.35, 0.35, 8.5, 9, -18.85, -18.15, M.yellow);

      // Reactor cavity & vessel head
      const cx = 0, cz = -19;
      this.cyl(cx, cz, 4.4, 0, 1.0, M.concrete, { segs: 40, collide: true, collideR: 4.9 });
      this.box(-4.4, 4.4, 1.0, 1.02, cz - 0.05, cz + 0.05, M.hazard);
      this.cyl(cx, cz, 2.35, 1.0, 2.8, M.steel, { segs: 32 });
      const head = new T.Mesh(new T.SphereGeometry(2.35, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.steel);
      head.position.set(cx, 2.8, cz);
      head.scale.y = 0.55;
      s.add(head);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const b = new T.Mesh(new T.CylinderGeometry(0.09, 0.09, 0.25, 8), M.darkSteel);
        b.position.set(cx + Math.cos(a) * 2.2, 2.9, cz + Math.sin(a) * 2.2);
        s.add(b);
      }
      // CRDM housings and moving rod tips
      const crdmPos = [];
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
        if (Math.abs(i) + Math.abs(j) > 3) continue;
        crdmPos.push([cx + i * 0.55, cz + j * 0.55]);
      }
      const hGeo = new T.CylinderGeometry(0.1, 0.1, 2.6, 10);
      const housings = new T.InstancedMesh(hGeo, M.darkSteel, crdmPos.length);
      const tipMat = new T.MeshStandardMaterial({ color: '#d7dde0', metalness: 0.7, roughness: 0.25, emissive: '#1a3a4a' });
      const tips = new T.InstancedMesh(new T.CylinderGeometry(0.05, 0.05, 1.8, 8), tipMat, crdmPos.length);
      const mtx = new T.Matrix4();
      crdmPos.forEach(([x, z], i) => {
        mtx.makeTranslation(x, 3.0 + 1.3 + 0.3, z);
        housings.setMatrixAt(i, mtx);
      });
      s.add(housings, tips);
      this.anim.crdm = { tips, pos: crdmPos, mtx };
      // Missile shield / rod position board on a stand
      const rodMat = this.makeScreen('rod', 512, 256);
      this.box(4.9, 5.0, 0, 2.2, -14.4, -14.2, M.darkSteel);
      this.box(4.0, 5.9, 1.4, 2.5, -14.45, -14.35, M.black);
      this.plane(1.8, 1.0, rodMat, 4.95, 1.95, -14.34, 0);
      // Railing around the cavity
      const rail = new T.Mesh(new T.TorusGeometry(4.8, 0.04, 6, 64), M.yellow);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(cx, 1.05, cz);
      s.add(rail);
      const rail2 = rail.clone();
      rail2.position.y = 0.6;
      s.add(rail2);
      const posts = new T.InstancedMesh(new T.CylinderGeometry(0.035, 0.035, 1.05, 6), M.yellow, 28);
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        mtx.makeTranslation(cx + Math.cos(a) * 4.8, 0.525, cz + Math.sin(a) * 4.8);
        posts.setMatrixAt(i, mtx);
      }
      s.add(posts);

      // Steam generators
      for (const sx of [-9, 9]) {
        const sz = -12;
        this.cyl(sx, sz, 1.5, 0, 7, M.cream, { segs: 28, collide: true, collideR: 2.0 });
        this.cyl(sx, sz, 1.5, 7, 8.6, M.cream, { rTop: 2.0, segs: 28 });
        this.cyl(sx, sz, 2.0, 8.6, 12.8, M.cream, { segs: 28 });
        const top = new T.Mesh(new T.SphereGeometry(2.0, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.cream);
        top.position.set(sx, 12.8, sz);
        top.scale.y = 0.6;
        s.add(top);
        for (let y = 1.5; y < 12; y += 2.2) {
          const band = new T.Mesh(new T.TorusGeometry(y < 7 ? 1.52 : 2.02, 0.04, 6, 32), M.steel);
          band.rotation.x = Math.PI / 2;
          band.position.set(sx, y, sz);
          s.add(band);
        }
        this.sign([sx < 0 ? 'S/G A' : 'S/G B'], 1.6, 0.5, sx, 3.5, sz + 1.52, 0, { bg: '#ddd6c2', fg: '#1f4f86', border: false });
        // main steam line out through the wall
        this.pipe([sx, 13.5, sz], [sx, 14.5, sz], 0.45, M.cream);
        this.pipe([sx, 14.5, sz], [sx < 0 ? -14.8 : 14.8, 14.5, sz], 0.45, M.cream);
      }
      // Reactor coolant pumps
      this.anim.pumps = [];
      for (const [px, name] of [[-9, 'A'], [9, 'B']]) {
        const pz = -24.5;
        const g = new T.Group();
        g.position.set(px, 0, pz);
        s.add(g);
        this.cyl(0, 0, 1.05, 0, 1.4, M.darkSteel, { parent: g, segs: 24 });
        this.cyl(0, 0, 0.85, 1.4, 3.4, M.blue, { parent: g, segs: 24 });
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          const fin = new T.Mesh(new T.BoxGeometry(0.06, 1.8, 0.12), M.blue);
          fin.position.set(Math.cos(a) * 0.88, 2.4, Math.sin(a) * 0.88);
          fin.rotation.y = -a;
          g.add(fin);
        }
        this.cyl(0, 0, 0.98, 3.4, 3.6, M.darkSteel, { parent: g, segs: 24 });
        const fan = new T.Group();
        fan.position.y = 3.75;
        for (let k = 0; k < 4; k++) {
          const b = new T.Mesh(new T.BoxGeometry(1.5, 0.04, 0.22), M.steel);
          b.rotation.y = (k * Math.PI) / 4;
          fan.add(b);
        }
        g.add(fan);
        const cage = new T.Mesh(new T.CylinderGeometry(0.95, 0.95, 0.4, 20, 1, true), new T.MeshStandardMaterial({ color: '#555', wireframe: true }));
        cage.position.y = 3.8;
        g.add(cage);
        this.colliders.push({ type: 'circle', x: px, z: pz, r: 1.35 });
        this.sign(['RCP-' + name], 1.0, 0.4, px, 2.4, pz + 0.9, 0, { bg: '#2d5f8f' });
        this.anim.pumps.push({ g, fan, baseX: px, baseZ: pz });
        this.addInteract('pump' + name, 'Reactor Coolant Pump ' + name, px, 1.6, pz, 2.8, 3.4, 2.8, 'containment');
      }
      // Loop piping (elevated so you can walk underneath)
      const yP = 2.8;
      for (const sx of [-9, 9]) {
        this.pipe([sx * 0.25, yP, -18.2], [sx, yP, -12.6], 0.42, M.steel); // hot leg
        this.pipe([sx, yP, -11.4], [sx, yP, -24.0], 0.36, M.steel); // crossover
        this.pipe([sx, yP, -24.0], [sx * 0.25, yP, -19.8], 0.38, M.steel); // cold leg
        this.pipe([sx, 0.4, -12], [sx, yP, -12], 0.38, M.steel);
        this.pipe([sx, 3.6, -24.5], [sx, yP, -24.5], 0.32, M.steel);
      }
      // Pressurizer + PORV + quench tank
      const prx = -6, prz = -30;
      this.cyl(prx, prz, 1.15, 0, 10.5, M.cream, { segs: 24, collide: true, collideR: 1.35 });
      const pt = new T.Mesh(new T.SphereGeometry(1.15, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.cream);
      pt.position.set(prx, 10.5, prz);
      pt.scale.y = 0.6;
      s.add(pt);
      this.sign(['PRESSURIZER'], 1.8, 0.4, prx, 3.2, prz + 1.17, 0, { bg: '#ddd6c2', fg: '#1f4f86', border: false });
      this.pipe([prx, 11.1, prz], [prx, 11.7, prz], 0.12, M.steel);
      this.pipe([prx, 11.7, prz], [-3.6, 11.7, prz], 0.12, M.steel);
      this.pipe([-3.6, 11.7, prz], [-3.6, 0.3, prz], 0.12, M.steel);
      // PORV valve body high up
      const porvBody = new T.Mesh(new T.BoxGeometry(0.5, 0.5, 0.5), M.red);
      porvBody.position.set(-4.6, 11.7, prz);
      s.add(porvBody);
      // block valve handwheel at chest height
      const wheel = new T.Mesh(new T.TorusGeometry(0.34, 0.035, 8, 24), M.red);
      wheel.position.set(-3.6, 1.35, prz + 0.38);
      s.add(wheel);
      for (let k = 0; k < 3; k++) {
        const sp = new T.Mesh(new T.BoxGeometry(0.66, 0.03, 0.03), M.red);
        sp.rotation.z = (k * Math.PI) / 3;
        wheel.add(sp);
      }
      this.anim.porvWheel = wheel;
      this.box(-3.8, -3.4, 1.15, 1.55, prz - 0.2, prz + 0.36, M.darkSteel);
      this.sign(['PORV BLOCK VALVE', 'RC-V-516'], 1.2, 0.45, -3.6, 2.15, prz + 0.4, 0, { bg: '#c0392b' });
      this.addInteract('porvValve', 'PORV block valve', -3.6, 1.35, prz + 0.3, 1.0, 1.2, 0.9, 'containment');
      // tailpipe temperature gauge
      const gaugeMat = this.makeScreen('gauge', 256, 256);
      this.box(-2.25, -2.15, 0, 1.4, prz + 0.05, prz + 0.15, M.darkSteel);
      const gauge = new T.Mesh(new T.CircleGeometry(0.26, 32), gaugeMat);
      gauge.position.set(-2.2, 1.55, prz + 0.17);
      s.add(gauge);
      this.addInteract('porvGauge', 'PORV tailpipe temperature gauge', -2.2, 1.5, prz + 0.2, 0.8, 0.8, 0.6, 'containment');
      // Quench tank
      const qt = new T.Mesh(new T.CylinderGeometry(0.9, 0.9, 4.2, 20), M.steel);
      qt.rotation.z = Math.PI / 2;
      qt.position.set(-10.5, 0.95, -31.6);
      s.add(qt);
      this.colliders.push({ type: 'box', minX: -12.7, maxX: -8.3, minZ: -32.6, maxZ: -30.6 });
      this.pipe([-3.6, 0.3, prz], [-8.3, 0.3, prz], 0.1, M.steel);
      this.sign(['PRZR RELIEF TANK'], 1.8, 0.35, -10.5, 2.15, -30.68, 0, { bg: '#2b2f36' });
      this.anim.leakOrigin = new T.Vector3(-8.6, 1.4, -31.0);

      // ECCS injection valve + accumulators
      this.pipe([5, 0, -31.2], [5, 3.4, -31.2], 0.14, M.steel);
      this.pipe([5, 3.4, -31.2], [0, 3.4, -24], 0.14, M.steel);
      const ew = new T.Mesh(new T.TorusGeometry(0.34, 0.035, 8, 24), M.red);
      ew.position.set(5, 1.35, -30.8);
      s.add(ew);
      for (let k = 0; k < 3; k++) {
        const sp = new T.Mesh(new T.BoxGeometry(0.66, 0.03, 0.03), M.red);
        sp.rotation.z = (k * Math.PI) / 3;
        ew.add(sp);
      }
      this.anim.eccsWheel = ew;
      this.box(4.8, 5.2, 1.15, 1.55, -31.4, -30.85, M.darkSteel);
      this.sign(['ECCS · HIGH PRESSURE', 'INJECTION SI-V-101'], 1.5, 0.5, 5, 2.2, -30.75, 0, { bg: '#2f6b4f' });
      this.addInteract('eccsValve', 'ECCS injection valve', 5, 1.35, -30.9, 1.0, 1.2, 0.9, 'containment');
      for (const [ax, az] of [[10.5, -31], [12.4, -28.2]]) {
        this.cyl(ax, az, 1.0, 0, 3.6, M.white, { collide: true, collideR: 1.1 });
        const d = new T.Mesh(new T.SphereGeometry(1.0, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.white);
        d.position.set(ax, 3.6, az);
        s.add(d);
      }
      this.sign(['ACCUMULATORS'], 1.6, 0.35, 11.5, 4.6, -26.9, 0, { bg: '#2b2f36' });

      // Floor markings
      this.box(-1.6, -1.45, 0.005, 0.012, -14, -4.2, M.yellow);
      this.box(1.45, 1.6, 0.005, 0.012, -14, -4.2, M.yellow);

      // Lights
      for (const [x, z] of [[-8, -9], [8, -9], [-8, -28], [8, -28], [0, -12], [0, -26]]) {
        const f = new T.Mesh(new T.CircleGeometry(0.5, 16), this.fixtureMatFor('containment'));
        f.rotation.x = Math.PI / 2;
        f.position.set(x, 16.9, z);
        s.add(f);
      }
      this.light('containment', 0, 13, -12, '#e8f0ff', 1.0, 40);
      this.light('containment', 0, 13, -27, '#e8f0ff', 1.0, 40);
      this.beacon(-14.6, 5, -10);
      this.beacon(14.6, 5, -26);
      this.beacon(-14.6, 5, -26);
      // Inside door sign
      this.sign(['EXIT → CORRIDOR'], 2.4, 0.4, 0, 3.6, -4.17, Math.PI, { bg: '#2e7d4f' });
    }

    fixtureMatFor(room) {
      let entry = this.fixtureMats.find((f) => f.room === room);
      if (!entry) {
        const mat = new T.MeshBasicMaterial({ color: '#fff6e6', toneMapped: false, side: T.DoubleSide });
        entry = { room, mat, base: new T.Color('#fff6e6') };
        this.fixtureMats.push(entry);
      }
      return entry.mat;
    }

    buildTurbineHall() {
      const M = this.mats;
      const s = this.scene;
      const tz = -18;
      this.box(19, 44, 0, 1.4, tz - 3.2, tz + 3.2, M.concrete, { collide: true, tile: 4 });
      const casing = (x0, x1, r, mat) => {
        const c = new T.Mesh(new T.CylinderGeometry(r, r, x1 - x0, 32, 1), mat);
        c.rotation.z = Math.PI / 2;
        c.position.set((x0 + x1) / 2, 1.4 + r * 0.85, tz);
        s.add(c);
        const lid = new T.Mesh(new T.CylinderGeometry(r * 1.04, r * 1.04, 0.2, 32), M.darkSteel);
        lid.rotation.z = Math.PI / 2;
        lid.position.set(x0 + 0.1, 1.4 + r * 0.85, tz);
        s.add(lid);
        const lid2 = lid.clone();
        lid2.position.x = x1 - 0.1;
        s.add(lid2);
        return c;
      };
      const turbineMat = new T.MeshStandardMaterial({ color: '#8c9aa3', metalness: 0.55, roughness: 0.35 });
      casing(21, 25, 1.3, turbineMat);
      casing(26.5, 31.5, 2.0, turbineMat);
      casing(33, 38, 2.0, turbineMat);
      casing(39.2, 42.6, 1.55, M.green);
      casing(42.8, 43.6, 0.8, M.green);
      // Rotating shaft with couplings
      const shaft = new T.Group();
      shaft.position.set(0, 3.0, tz);
      const sh = new T.Mesh(new T.CylinderGeometry(0.22, 0.22, 24, 12), M.steel);
      sh.rotation.z = Math.PI / 2;
      sh.position.x = 32;
      shaft.add(sh);
      for (const cxp of [25.75, 32.25, 38.6, 42.7]) {
        const cp = new T.Mesh(new T.CylinderGeometry(0.45, 0.45, 0.35, 12), M.darkSteel);
        cp.rotation.z = Math.PI / 2;
        cp.position.x = cxp;
        shaft.add(cp);
        for (let k = 0; k < 4; k++) {
          const bolt = new T.Mesh(new T.BoxGeometry(0.4, 0.09, 0.09), M.yellow);
          const a = (k * Math.PI) / 2;
          bolt.position.set(cxp, Math.cos(a) * 0.4, Math.sin(a) * 0.4);
          shaft.add(bolt);
        }
      }
      s.add(shaft);
      this.anim.shaft = shaft;
      // Crossover pipes
      this.pipe([23, 3.6, tz], [23, 6.2, tz], 0.5, turbineMat);
      this.pipe([23, 6.2, tz], [35.5, 6.2, tz], 0.6, turbineMat);
      this.pipe([29, 6.2, tz], [29, 4.8, tz], 0.6, turbineMat);
      this.pipe([35.5, 6.2, tz], [35.5, 4.8, tz], 0.6, turbineMat);
      // Main steam from containment wall
      this.pipe([15.2, 9.5, -12], [21, 9.5, -12], 0.45, M.cream);
      this.pipe([21, 9.5, -12], [21, 4.0, -12], 0.45, M.cream);
      this.pipe([21, 4.0, -12], [21, 3.4, tz + 1], 0.4, M.cream);
      this.sign(['MAIN TURBINE · 1,120 MWe'], 4, 0.6, 32, 7.2, tz, 0, { bg: '#2b2f36', fg: '#e7eae6' });
      // Turbine front standard / control panel
      this.box(18.6, 19.8, 0, 1.6, -23.6, -22.4, M.desk, { collide: true });
      const tpMat = this.makeScreen('turb', 256, 256);
      this.plane(0.9, 0.9, tpMat, 19.81, 1.15, -23, Math.PI / 2);
      this.addInteract('turbineReset', 'Turbine control panel', 19.9, 1.1, -23, 1.0, 1.6, 1.6, 'turbine');
      // Feedwater heater breaker panel on the south wall
      this.box(19.2, 20.8, 0.4, 2.2, -4.5, -4.15, M.frame);
      this.sign(['FW HTR 3', 'BREAKER 52-FW3'], 1.4, 0.5, 20, 2.0, -4.52, Math.PI, { bg: '#2b2f36' });
      this.fwLamp = new T.MeshBasicMaterial({ color: '#2e9e5b', toneMapped: false });
      const lamp = new T.Mesh(new T.CircleGeometry(0.07, 12), this.fwLamp);
      lamp.position.set(20, 1.3, -4.53);
      lamp.rotation.y = Math.PI;
      s.add(lamp);
      this.addInteract('fwBreaker', 'Feedwater heater breaker', 20, 1.3, -4.7, 1.6, 1.8, 0.6, 'turbine');
      // Condenser intake screen station on the east side
      this.box(43.4, 45.8, 0, 1.0, -12, -8, M.darkSteel, { collide: true });
      const grate = new T.Mesh(new T.PlaneGeometry(2.2, 3.6), new T.MeshStandardMaterial({ color: '#555', wireframe: true }));
      grate.rotation.x = -Math.PI / 2;
      grate.position.set(44.6, 1.01, -10);
      s.add(grate);
      this.box(43.0, 43.5, 0, 1.4, -10.5, -9.5, M.yellow);
      this.sign(['CIRC WATER', 'INTAKE SCREEN'], 1.6, 0.6, 44.6, 2.2, -7.95, Math.PI, { bg: '#1f4f86' });
      this.addInteract('intakeScreen', 'Condenser intake screen', 43.3, 1.0, -10, 1.0, 1.6, 2.4, 'turbine');
      // Feedwater pumps
      for (const fx of [34, 39]) {
        this.cyl(fx, -28.5, 0.7, 0, 1.4, M.blue, { collide: true, collideR: 0.9 });
        this.pipe([fx, 1.4, -28.5], [fx, 4.5, -28.5], 0.2, M.steel);
      }
      this.pipe([31, 4.5, -28.5], [42, 4.5, -28.5], 0.2, M.steel);
      // Lights
      for (const x of [20, 27, 34, 41]) for (const z of [-10, -26]) {
        const f = new T.Mesh(new T.CircleGeometry(0.45, 16), this.fixtureMatFor('turbine'));
        f.rotation.x = Math.PI / 2;
        f.position.set(x, 11.9, z);
        s.add(f);
      }
      this.light('turbine', 30, 10, -18, '#fff4e0', 1.0, 40);
      this.beacon(45.6, 4, -6);
      this.sign(['EXIT → CORRIDOR'], 2.4, 0.4, 30, 3.6, -4.17, Math.PI, { bg: '#2e7d4f' });
    }

    buildDieselRoom() {
      const M = this.mats;
      const s = this.scene;
      this.anim.dg = {};
      for (const [dx, name] of [[-31, 'A'], [-20, 'B']]) {
        const g = new T.Group();
        g.position.set(dx, 0, 0);
        s.add(g);
        this.box(-1.6, 1.6, 0, 0.3, -18, -8.8, M.darkSteel, { parent: g });
        this.box(-1.1, 1.1, 0.3, 2.3, -17.6, -12.2, new T.MeshStandardMaterial({ color: '#3f6f8f', roughness: 0.5, metalness: 0.3 }), { parent: g });
        this.box(-0.9, 0.9, 2.3, 2.7, -17.3, -12.5, M.darkSteel, { parent: g });
        for (let k = 0; k < 8; k++) {
          const cyl = new T.Mesh(new T.CylinderGeometry(0.16, 0.16, 0.3, 10), M.steel);
          cyl.position.set(k % 2 ? 0.5 : -0.5, 2.85, -16.8 + Math.floor(k / 2) * 1.2);
          g.add(cyl);
        }
        const gen = new T.Mesh(new T.CylinderGeometry(1.0, 1.0, 2.6, 24), M.green);
        gen.rotation.x = Math.PI / 2;
        gen.position.set(0, 1.35, -10.7);
        g.add(gen);
        this.pipe([0.6, 2.7, -16], [0.6, 7, -16], 0.18, M.darkSteel, g);
        this.colliders.push({ type: 'box', minX: dx - 1.6, maxX: dx + 1.6, minZ: -18, maxZ: -8.8 });
        // local panel
        this.box(dx - 0.6, dx + 0.6, 0, 1.7, -7.3, -6.9, M.desk, { collide: true });
        const pm = this.makeScreen('dg' + name, 256, 256);
        this.plane(0.9, 0.9, pm, dx, 1.2, -6.89, 0);
        this.sign(['EDG-' + name, 'EMERGENCY DIESEL'], 2.4, 0.7, dx, 4.2, -8.7, 0, { bg: name === 'A' ? '#2b2f36' : '#1f4f86' });
        this.addInteract('dg' + name + 'Panel', 'Diesel Generator ' + name + ' local panel', dx, 1.1, -6.6, 1.4, 1.8, 0.8, 'dg');
        this.anim.dg[name] = { g, baseX: dx };
      }
      // Fuel day tanks
      for (const [fx, name] of [[-34.6, 'A'], [-16.6, 'B']]) {
        this.cyl(fx, -19.2, 0.9, 0, 2.6, new T.MeshStandardMaterial({ color: '#b8a24a', roughness: 0.6 }), { collide: true, collideR: 1.0 });
        this.sign(['DAY TANK ' + name, 'DIESEL FUEL'], 1.3, 0.45, fx, 2.0, -18.29, 0, { bg: '#2b2f36', fg: '#f2c230' });
      }
      // Fuel valve for DG-B
      this.pipe([-16.6, 0.5, -18.3], [-16.6, 0.5, -16.2], 0.08, M.steel);
      this.pipe([-16.6, 0.5, -16.2], [-16.6, 1.6, -16.2], 0.08, M.steel);
      const fw = new T.Mesh(new T.TorusGeometry(0.22, 0.03, 8, 20), M.yellow);
      fw.position.set(-16.6, 1.3, -16.0);
      s.add(fw);
      for (let k = 0; k < 2; k++) {
        const sp = new T.Mesh(new T.BoxGeometry(0.42, 0.025, 0.025), M.yellow);
        sp.rotation.z = (k * Math.PI) / 2;
        fw.add(sp);
      }
      this.anim.fuelWheel = fw;
      this.sign(['FUEL ISOLATION', 'EDG-B · FO-V-22'], 1.1, 0.4, -16.6, 2.0, -15.95, 0, { bg: '#c0392b' });
      this.addInteract('dgBFuel', 'EDG-B fuel isolation valve', -16.6, 1.3, -16.1, 0.9, 1.2, 0.9, 'dg');
      for (const x of [-31, -25, -19]) this.fixture(x - 0.8, x + 0.8, -14 - 0.3, -14 + 0.3, 7, 'dg');
      this.light('dg', -25.5, 6, -13, '#fff0dc', 0.85, 26);
      this.beacon(-35.6, 4.5, -6);
      // smoke puffs
      this.puffs = [];
      const pm = new T.SpriteMaterial({ map: this.dot, color: '#2b2b2b', transparent: true, opacity: 0, depthWrite: false });
      for (let i = 0; i < 18; i++) {
        const sp = new T.Sprite(pm.clone());
        sp.visible = false;
        s.add(sp);
        this.puffs.push(sp);
      }
      this.sign(['EXIT → CORRIDOR'], 2.4, 0.4, -26, 3.4, -4.17, Math.PI, { bg: '#2e7d4f' });
    }

    buildAux() {
      const M = this.mats;
      const s = this.scene;
      // Spent fuel pool
      const poolCurb = M.concrete;
      this.box(-30.3, -21.7, 0, 0.9, 6.7, 7.0, poolCurb, { collide: true });
      this.box(-30.3, -21.7, 0, 0.9, 15.0, 15.3, poolCurb, { collide: true });
      this.box(-30.3, -30.0, 0, 0.9, 7.0, 15.0, poolCurb, { collide: true });
      this.box(-22.0, -21.7, 0, 0.9, 7.0, 15.0, poolCurb, { collide: true });
      this.colliders.push({ type: 'box', minX: -30, maxX: -22, minZ: 7, maxZ: 15 });
      const racks = U.tex('poolRacks');
      const poolBottom = new T.Mesh(new T.PlaneGeometry(8, 8), new T.MeshBasicMaterial({ map: racks, toneMapped: false }));
      poolBottom.rotation.x = -Math.PI / 2;
      poolBottom.position.set(-26, 0.05, 11);
      s.add(poolBottom);
      const waterMat = new T.MeshBasicMaterial({ color: '#46c8ff', transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false });
      const water = new T.Mesh(new T.PlaneGeometry(8, 8, 1, 1), waterMat);
      water.rotation.x = -Math.PI / 2;
      water.position.set(-26, 0.75, 11);
      s.add(water);
      this.anim.poolWater = waterMat;
      for (let x = -30; x <= -22; x += 1) this.cyl(x, 6.85, 0.03, 0.9, 1.9, M.yellow, { segs: 6 });
      this.box(-30.3, -21.7, 1.85, 1.9, 6.8, 6.9, M.yellow);
      this.light('aux', -26, 2.6, 11, '#5fd4ff', 1.2, 14);
      this.sign(['SPENT FUEL POOL', 'NO SWIMMING. SERIOUSLY.'], 3.2, 0.9, -26, 3.2, 15.84, Math.PI, { bg: '#1f4f86' });
      this.addInteract('fuelPool', 'Look into the spent fuel pool', -26, 1.2, 6.6, 8, 1.2, 0.6, 'aux');
      // Boric acid storage tanks
      for (const [bx, name] of [[-12.8, 'A'], [-16.0, 'B']]) {
        this.cyl(bx, 13.6, 1.2, 0, 4.6, M.white, { collide: true, collideR: 1.3 });
        this.sign(['BAST-' + name, '7,000 ppm BORON'], 1.4, 0.5, bx, 2.4, 12.37, 0, { bg: '#2b2f36', fg: '#9fe0b0' });
      }
      this.pipe([-12.8, 4.6, 13.6], [-12.8, 5.2, 13.6], 0.1, M.steel);
      this.pipe([-16, 4.6, 13.6], [-16, 5.2, 13.6], 0.1, M.steel);
      this.pipe([-16, 5.2, 13.6], [-12.8, 5.2, 13.6], 0.1, M.steel);
      // CVCS / emergency boration panel
      this.box(-16.2, -13.4, 0, 1.0, 9.0, 9.9, M.desk, { collide: true });
      const back = this.box(-16.2, -13.4, 1.0, 2.0, 9.6, 9.9, M.desk);
      back.rotation.x = 0.1;
      const bm = this.makeScreen('boron', 512, 256);
      this.plane(2.4, 0.9, bm, -14.8, 1.5, 9.55, Math.PI);
      this.sign(['CVCS · EMERGENCY BORATION'], 2.6, 0.35, -14.8, 2.25, 9.5, Math.PI, { bg: '#2f6b4f' });
      this.addInteract('borationPanel', 'Emergency boration panel', -14.8, 1.1, 8.9, 2.8, 1.6, 1.0, 'aux');
      // Charging pumps
      for (const px of [-29, -26]) {
        this.cyl(px, 3, 0.55, 0, 1.0, M.blue, { collide: true, collideR: 0.7 });
        this.cyl(px, 3, 0.4, 1.0, 1.8, M.blue);
      }
      this.sign(['CHARGING PUMPS'], 2.2, 0.35, -27.5, 2.6, 0.17, 0, { bg: '#2b2f36' });
      for (const [x, z] of [[-26, 3], [-16, 3], [-16, 13]]) this.fixture(x - 1, x + 1, z - 0.3, z + 0.3, 6, 'aux');
      this.light('aux', -16, 5, 6, '#fff3e0', 0.8, 20);
      this.beacon(-31.6, 4.5, 2);
    }

    buildWeather() {
      const n = 900;
      const pos = new Float32Array(n * 6);
      this.rain = { n, speeds: new Float32Array(n), regions: [] };
      const regions = [
        { x0: -14, x1: 14, z0: 16.6, z1: 34 },
        { x0: 46.6, x1: 64, z0: -34, z1: -2 },
      ];
      for (let i = 0; i < n; i++) {
        const r = regions[i % 2];
        const x = U.rand(r.x0, r.x1), z = U.rand(r.z0, r.z1), y = U.rand(0, 16);
        pos.set([x, y, z, x + 0.05, y + 0.7, z], i * 6);
        this.rain.speeds[i] = U.rand(16, 22);
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      this.rain.mesh = new T.LineSegments(geo, new T.LineBasicMaterial({ color: '#a9c2d6', transparent: true, opacity: 0.45 }));
      this.rain.mesh.visible = false;
      this.rain.mesh.frustumCulled = false;
      this.scene.add(this.rain.mesh);
      // lightning bolt
      this.bolt = new T.Line(new T.BufferGeometry(), new T.LineBasicMaterial({ color: '#eef3ff', transparent: true, opacity: 0, toneMapped: false }));
      this.scene.add(this.bolt);
      // steam leak puffs in containment
      this.leak = [];
      const lm = new T.SpriteMaterial({ map: this.dot, color: '#ffffff', transparent: true, opacity: 0, depthWrite: false });
      for (let i = 0; i < 30; i++) {
        const sp = new T.Sprite(lm.clone());
        sp.userData.life = Math.random();
        sp.visible = false;
        this.scene.add(sp);
        this.leak.push(sp);
      }
    }

    // ------------------------------------------------------------ NPCs
    buildNPCs() {
      const people = {
        gus: { cloth: '#d9822b', pants: '#2b3440', hat: '#f4f4f0', scale: 1.13, mustache: true, number: '85', skin: '#d7a27e' },
        priya: { cloth: '#2d5f8f', pants: '#252b33', hat: '#2d5f8f', scale: 0.96, skin: '#a36d4b', hair: '#1a1210' },
        walt: { cloth: '#5d6b45', pants: '#3a3a30', hat: '#e5b31f', scale: 1.0, skin: '#e0b896', beard: true },
        calloway: { cloth: '#23252b', pants: '#23252b', hat: null, scale: 1.02, tie: '#8a1d6e', skin: '#e8c3a5', hair: '#6b5a48' },
        halvorsen: { cloth: '#6c7a89', pants: '#3a4049', hat: '#ffffff', scale: 0.98, skin: '#f0cfb5', hair: '#c9c2b8', glasses: true },
      };
      for (const [id, o] of Object.entries(people)) {
        const npc = this.makePerson(o);
        npc.group.visible = false;
        this.scene.add(npc.group);
        const hit = this.addInteract('npc:' + id, 'Talk', 0, 1.0, 0, 0.9, 2.0, 0.9, null);
        npc.hit = hit;
        npc.id = id;
        npc.yaw = 0;
        npc.targetYaw = 0;
        npc.phase = Math.random() * 6;
        this.npcs[id] = npc;
      }
    }

    makePerson(o) {
      const std = (c) => new T.MeshStandardMaterial({ color: c, roughness: 0.8 });
      const g = new T.Group();
      const body = new T.Group();
      g.add(body);
      const skin = std(o.skin);
      const cloth = std(o.cloth);
      const pants = std(o.pants);
      const legL = new T.Mesh(new T.BoxGeometry(0.17, 0.86, 0.2), pants);
      legL.position.set(-0.11, 0.43, 0);
      const legR = legL.clone();
      legR.position.x = 0.11;
      const torso = new T.Mesh(new T.BoxGeometry(0.5, 0.64, 0.28), cloth);
      torso.position.y = 1.18;
      const armGeo = new T.BoxGeometry(0.13, 0.62, 0.15);
      armGeo.translate(0, -0.29, 0);
      const armL = new T.Mesh(armGeo, cloth);
      armL.position.set(-0.33, 1.47, 0);
      const armR = armL.clone();
      armR.position.x = 0.33;
      const head = new T.Mesh(new T.SphereGeometry(0.135, 16, 12), skin);
      head.position.y = 1.64;
      const neck = new T.Mesh(new T.CylinderGeometry(0.06, 0.07, 0.1, 8), skin);
      neck.position.y = 1.51;
      body.add(legL, legR, torso, armL, armR, neck, head);
      // reflective stripes on coveralls
      if (o.hat !== null) {
        const stripe = new T.Mesh(new T.BoxGeometry(0.51, 0.04, 0.29), new T.MeshBasicMaterial({ color: '#d7e0e0' }));
        stripe.position.y = 1.02;
        body.add(stripe);
      }
      if (o.hair) {
        const hair = new T.Mesh(new T.SphereGeometry(0.14, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), std(o.hair));
        hair.position.y = 1.66;
        hair.rotation.x = -0.25;
        body.add(hair);
      }
      if (o.hat) {
        const hat = new T.Mesh(new T.SphereGeometry(0.155, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new T.MeshStandardMaterial({ color: o.hat, roughness: 0.35 }));
        hat.position.y = 1.69;
        const brim = new T.Mesh(new T.CylinderGeometry(0.19, 0.19, 0.02, 16), hat.material);
        brim.position.set(0, 1.7, 0.03);
        body.add(hat, brim);
      }
      if (o.mustache) {
        const m = new T.Mesh(new T.BoxGeometry(0.13, 0.03, 0.03), std('#5a3a22'));
        m.position.set(0, 1.6, 0.125);
        body.add(m);
      }
      if (o.beard) {
        const b = new T.Mesh(new T.SphereGeometry(0.1, 10, 8), std('#9a9a90'));
        b.scale.set(1.1, 0.8, 0.6);
        b.position.set(0, 1.55, 0.07);
        body.add(b);
      }
      if (o.glasses) {
        const gl = new T.Mesh(new T.BoxGeometry(0.2, 0.035, 0.02), std('#222'));
        gl.position.set(0, 1.66, 0.13);
        body.add(gl);
      }
      if (o.tie) {
        const shirt = new T.Mesh(new T.BoxGeometry(0.14, 0.3, 0.01), std('#e8e8e8'));
        shirt.position.set(0, 1.34, 0.142);
        const tie = new T.Mesh(new T.BoxGeometry(0.05, 0.28, 0.012), std(o.tie));
        tie.position.set(0, 1.32, 0.148);
        body.add(shirt, tie);
      }
      if (o.number) {
        const tex = U.signTexture([o.number], { w: 128, h: 128, bg: o.cloth, fg: '#ffffff', border: false, size: 90, font: '"Chakra Petch", sans-serif' });
        const num = new T.Mesh(new T.PlaneGeometry(0.34, 0.34), new T.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
        num.position.set(0, 1.22, -0.142);
        num.rotation.y = Math.PI;
        body.add(num);
      }
      g.scale.setScalar(o.scale || 1);
      return { group: g, body, armL, armR, head, torso, talking: 0 };
    }

    setNPC(id, x, z, yaw, visible) {
      const n = this.npcs[id];
      if (!n) return;
      if (x != null) {
        n.group.position.set(x, 0, z);
        n.hit.mesh.position.set(x, 1.0, z);
      }
      if (yaw != null) {
        n.yaw = n.targetYaw = yaw;
        n.homeYaw = yaw;
      }
      n.group.visible = visible !== false;
      n.hit.mesh.position.y = n.group.visible ? 1.0 : -50;
    }

    // ------------------------------------------------------------ effects
    setLighting(mode) {
      this.lightMode = mode;
    }

    setWeather(w) {
      this.weather = w;
      this.rain.mesh.visible = w === 'storm';
    }

    lightning() {
      this.flashT = 1;
      const pts = [];
      let x = U.rand(-60, 80), y = 140, z = U.rand(110, 160);
      if (Math.random() < 0.4) {
        x = U.rand(110, 160);
        z = U.rand(-60, 20);
      }
      while (y > 0) {
        pts.push(new T.Vector3(x, y, z));
        x += U.rand(-6, 6);
        z += U.rand(-3, 3);
        y -= U.rand(6, 14);
      }
      pts.push(new T.Vector3(x, 0, z));
      this.bolt.geometry.dispose();
      this.bolt.geometry = new T.BufferGeometry().setFromPoints(pts);
    }

    // ------------------------------------------------------------ update
    update(dt, ctx) {
      this.time += dt;
      const t = this.time;
      const sim = ctx.sim;

      // Sky & outside light from time of day and weather
      const hour = ctx.clockMin / 60;
      this.updateSky(hour, dt);

      // Interior lighting modes
      const alarm = ctx.alarmLevel || 0;
      const pulse = alarm >= 2 ? 0.5 + 0.5 * Math.sin(t * 5) : 0;
      for (const rl of this.roomLights) {
        let k = 1, col = rl.color;
        if (this.lightMode === 'blackout') {
          k = 0.18 + (Math.random() < 0.02 ? 0.25 : 0);
          col = new T.Color('#ff3020');
        } else if (this.lightMode === 'emergency') {
          k = 0.55;
          col = new T.Color('#ffc890');
        }
        rl.light.color.copy(col);
        if (alarm >= 2 && this.lightMode === 'normal') rl.light.color.lerp(new T.Color('#ff6a50'), pulse * 0.35);
        rl.light.intensity = rl.base * k + (this.flashT > 0 && (rl.room === 'control' || rl.room === 'turbine') ? this.flashT * 0.8 : 0);
      }
      for (const f of this.fixtureMats) {
        if (this.lightMode === 'blackout') f.mat.color.set('#2a0a08');
        else if (this.lightMode === 'emergency') f.mat.color.set('#a8865c');
        else f.mat.color.copy(f.base);
      }
      // Beacons
      for (const b of this.beacons) {
        const on = alarm >= 2 || this.lightMode === 'blackout';
        b.domeMat.color.set(on ? '#ff2020' : '#4a1010');
        b.beam.material.opacity = on ? 0.16 : 0;
        b.spin.rotation.y += dt * (on ? 6 : 0);
      }
      this.hemi.intensity = (this.lightMode === 'blackout' ? 0.12 : this.lightMode === 'emergency' ? 0.3 : 0.55) + this.flashT * 1.2;
      if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt * 3.5);
      this.skyUniforms.flash.value = this.flashT * 0.8;
      this.bolt.material.opacity = this.flashT > 0.4 ? 1 : 0;
      if (this.glass) for (const gl of this.glass) gl.material.opacity = 0.1 + this.flashT * 0.4;

      // Rain
      if (this.rain.mesh.visible) {
        const p = this.rain.mesh.geometry.attributes.position.array;
        for (let i = 0; i < this.rain.n; i++) {
          const o = i * 6;
          const dy = this.rain.speeds[i] * dt;
          p[o + 1] -= dy;
          p[o + 4] -= dy;
          if (p[o + 1] < 0) {
            p[o + 1] += 16;
            p[o + 4] += 16;
          }
        }
        this.rain.mesh.geometry.attributes.position.needsUpdate = true;
      }

      // Steam plumes scale with load
      const plume = sim.offsitePower ? 0.25 + sim.turbineLoad * 0.75 : 0.15;
      for (const sp of this.plumes) {
        const d = sp.userData;
        d.life += dt * 0.06 * (0.6 + plume);
        if (d.life > 1) {
          d.life = 0;
          d.ox = U.rand(-8, 8);
          d.oz = U.rand(-8, 8);
        }
        const L = d.life;
        sp.position.set(d.tower.x + (d.ox || 0) + L * 18, d.tower.top + L * 40, d.tower.z + (d.oz || 0));
        const sc = 14 + L * 30;
        sp.scale.set(sc, sc, 1);
        sp.material.opacity = (1 - L) * 0.55 * plume;
        sp.material.color.set(this.weather === 'storm' ? '#9aa0a4' : '#f2f4f5');
      }

      // CRDM rod tips: more withdrawn rods stick up higher above the head
      const cr = this.anim.crdm;
      const ext = (sim.rods / 100) * 1.7;
      cr.pos.forEach(([x, z], i) => {
        cr.mtx.makeTranslation(x, 5.6 + ext - 0.9, z);
        cr.tips.setMatrixAt(i, cr.mtx);
      });
      cr.tips.instanceMatrix.needsUpdate = true;

      // Pumps
      this.anim.pumps.forEach((p, i) => {
        const pump = sim.pumps[i];
        p.fan.rotation.y += dt * pump.eff * 16;
        const vib = i === 1 ? Math.max(0, pump.vibration - 1.4) * 0.012 * pump.eff : 0;
        p.g.position.x = p.baseX + (Math.random() - 0.5) * vib;
        p.g.position.z = p.baseZ + (Math.random() - 0.5) * vib;
      });
      // Turbine shaft
      this.anim.shaftSpeed = U.lerp(this.anim.shaftSpeed || 0, sim.turbineTripped ? 0 : 0.4 + sim.turbineLoad * 9, Math.min(1, dt * 0.4));
      this.anim.shaft.rotation.x += dt * this.anim.shaftSpeed;
      // Diesel generators
      for (const name of ['A', 'B']) {
        const st = ctx.dg[name];
        const d = this.anim.dg[name];
        const amp = st === 'running' ? 0.012 : st === 'cranking' || st === 'sputter' ? 0.03 : 0;
        d.g.position.x = d.baseX + (Math.random() - 0.5) * amp;
        d.g.position.y = (Math.random() - 0.5) * amp * 0.6;
        if ((st === 'running' && Math.random() < dt * 3) || (st === 'sputter' && Math.random() < dt * 8)) this.puff(d.baseX + 0.6, st === 'sputter' ? '#111111' : '#555555');
      }
      for (const sp of this.puffs) {
        if (!sp.visible) continue;
        sp.userData.life += dt * 0.5;
        const L = sp.userData.life;
        sp.position.y = 7 + L * 4;
        sp.scale.setScalar(0.8 + L * 3);
        sp.material.opacity = (1 - L) * 0.7;
        if (L >= 1) sp.visible = false;
      }
      // Valve wheels
      if (this.anim.porvWheel) this.anim.porvWheel.rotation.z = ctx.valveAngles.porv;
      if (this.anim.eccsWheel) this.anim.eccsWheel.rotation.z = ctx.valveAngles.eccs;
      if (this.anim.fuelWheel) this.anim.fuelWheel.rotation.z = ctx.valveAngles.fuel;
      // Feedwater breaker lamp
      this.fwLamp.color.set(ctx.fwBreakerTripped ? (Math.sin(t * 8) > 0 ? '#ffb547' : '#3a2a10') : '#2e9e5b');
      // Pool shimmer
      this.anim.poolWater.opacity = 0.28 + Math.sin(t * 1.3) * 0.04;
      // Server LEDs and AutoOptimize glow
      this.serverRackMat.emissiveIntensity = this.lightMode === 'blackout' ? 0.15 : 0.5 + Math.random() * 0.15;
      const aoOn = ctx.autoOpt === 'on';
      this.aoGlow.color.set(aoOn ? (Math.sin(t * 3) > 0 ? '#ff4fd8' : '#b23d9a') : ctx.autoOpt === 'killed' ? '#1a1a1a' : '#3a2a40');
      this.aoPlug.position.x = ctx.autoOpt === 'killed' ? -0.45 : -0.2;
      this.aoPlug.position.y = ctx.autoOpt === 'killed' ? 0.12 : 0.35;
      // Steam leak from the relief tank when the PORV is passing flow
      const leaking = sim.porvFlowing;
      for (const sp of this.leak) {
        const d = sp.userData;
        if (!leaking && !sp.visible) continue;
        sp.visible = true;
        d.life += dt * 0.7;
        if (d.life > 1) {
          d.life = 0;
          if (!leaking) {
            sp.visible = false;
            continue;
          }
        }
        const L = d.life;
        sp.position.set(this.anim.leakOrigin.x + L * 1.5 + Math.sin(d.life * 9) * 0.2, this.anim.leakOrigin.y + L * 6, this.anim.leakOrigin.z + L * 1.2);
        sp.scale.setScalar(0.6 + L * 3.5);
        sp.material.opacity = (1 - L) * 0.5;
      }

      // NPC idle animation
      for (const n of Object.values(this.npcs)) {
        if (!n.group.visible) continue;
        n.phase += dt;
        const dx = ctx.playerPos.x - n.group.position.x;
        const dz = ctx.playerPos.z - n.group.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 4.5 || n.talking > 0) n.targetYaw = Math.atan2(dx, dz);
        else if (n.homeYaw != null) n.targetYaw = n.homeYaw;
        let dy = n.targetYaw - n.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        n.yaw += dy * Math.min(1, dt * 4);
        n.group.rotation.y = n.yaw;
        n.torso.scale.y = 1 + Math.sin(n.phase * 2) * 0.015;
        if (n.talking > 0) {
          n.talking -= dt;
          n.armR.rotation.x = -0.4 + Math.sin(n.phase * 7) * 0.35;
          n.armL.rotation.x = -0.2 + Math.cos(n.phase * 5) * 0.2;
          n.head.rotation.x = Math.sin(n.phase * 9) * 0.06;
        } else {
          n.armR.rotation.x *= 0.9;
          n.armL.rotation.x *= 0.9;
          n.head.rotation.x *= 0.9;
        }
      }

      // Screens (4 Hz)
      this.screenTimer -= dt;
      if (this.screenTimer <= 0) {
        this.screenTimer = 0.25;
        G.Screens.drawAll(this.screens, ctx);
        for (const k in this.screens) this.screens[k].tex.needsUpdate = true;
      }
    }

    puff(x, color) {
      const sp = this.puffs.find((p) => !p.visible);
      if (!sp) return;
      sp.visible = true;
      sp.userData.life = 0;
      sp.material.color.set(color);
      sp.position.set(x, 7, -16);
    }

    updateSky(hour, dt) {
      const k = U.clamp((hour - 6) / 12, 0, 1);
      let top, hor;
      if (this.weather === 'storm') {
        top = new T.Color('#1d2328');
        hor = new T.Color('#46504f');
      } else {
        const dawnTop = new T.Color('#3b4f7a'), dayTop = new T.Color('#3d78b8'), duskTop = new T.Color('#3a3f6e');
        const dawnHor = new T.Color('#f0b089'), dayHor = new T.Color('#cfe2ee'), duskHor = new T.Color('#f29a6a');
        if (k < 0.2) {
          top = dawnTop.clone().lerp(dayTop, k / 0.2);
          hor = dawnHor.clone().lerp(dayHor, k / 0.2);
        } else if (k > 0.8) {
          top = dayTop.clone().lerp(duskTop, (k - 0.8) / 0.2);
          hor = dayHor.clone().lerp(duskHor, (k - 0.8) / 0.2);
        } else {
          top = dayTop;
          hor = dayHor;
        }
        if (this.weather === 'hot') hor = hor.clone().lerp(new T.Color('#f2dca0'), 0.45);
        if (this.weather === 'overcast') {
          top = top.clone().lerp(new T.Color('#59636b'), 0.6);
          hor = hor.clone().lerp(new T.Color('#9aa3a8'), 0.6);
        }
      }
      this.skyUniforms.top.value.copy(top);
      this.skyUniforms.horizon.value.copy(hor);
      const bright = this.weather === 'storm' ? 0.25 : 0.35 + Math.sin(k * Math.PI) * 0.35;
      for (const m of this.exteriorMats) {
        m.emissive = m.emissive || new T.Color();
        m.emissive.copy(hor).multiplyScalar(bright * 0.6 + this.flashT * 0.6);
      }
    }
  }

  G.World = World;
})();
