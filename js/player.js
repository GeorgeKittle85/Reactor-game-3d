/*
 * First-person controller.
 * Desktop: WASD + mouse (pointer lock), Shift to run. If pointer lock is refused
 * (some embedded frames block it) the view falls back to click-and-drag to look.
 * Touch: left thumb stick to move, drag anywhere else to look.
 */
(function () {
  'use strict';
  const G = window.G;
  const U = G.U;

  class Player {
    constructor(camera, dom, world) {
      this.camera = camera;
      this.dom = dom;
      this.world = world;
      this.pos = new THREE.Vector3(0, 0, 12);
      this.vel = new THREE.Vector2(0, 0);
      this.yaw = 0;
      this.pitch = 0;
      this.eye = 1.65;
      this.radius = 0.32;
      this.keys = {};
      this.enabled = false;
      this.locked = false;
      this.lockFailed = false;
      this.dragging = false;
      this.sensitivity = 1;
      this.invertY = false;
      this.speedBoost = 1;
      this.bobT = 0;
      this.stepAcc = 0;
      this.onStep = null;
      this.shakeAmt = 0;
      this.touch = { active: false, moveId: null, lookId: null, mx: 0, my: 0, ox: 0, oy: 0, lx: 0, ly: 0 };
      this.isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      this._bind();
    }

    _bind() {
      window.addEventListener('keydown', (e) => {
        this.keys[e.code] = true;
      });
      window.addEventListener('keyup', (e) => {
        this.keys[e.code] = false;
      });
      window.addEventListener('blur', () => {
        this.keys = {};
      });
      document.addEventListener('pointerlockchange', () => {
        this.locked = document.pointerLockElement === this.dom;
        if (this.onLockChange) this.onLockChange(this.locked);
      });
      document.addEventListener('pointerlockerror', () => {
        this.lockFailed = true;
        if (this.onLockChange) this.onLockChange(false);
      });
      document.addEventListener('mousemove', (e) => {
        if (!this.enabled) return;
        if (this.locked || this.dragging) this._look(e.movementX || 0, e.movementY || 0);
      });
      this.dom.addEventListener('mousedown', (e) => {
        if (!this.enabled || this.isTouch) return;
        if (this.lockFailed && !this.locked) {
          this.dragging = true;
          this.dom.style.cursor = 'grabbing';
        }
      });
      window.addEventListener('mouseup', () => {
        this.dragging = false;
        this.dom.style.cursor = '';
      });
      // Touch controls
      const tz = this.dom;
      tz.addEventListener('touchstart', (e) => this._touchStart(e), { passive: false });
      tz.addEventListener('touchmove', (e) => this._touchMove(e), { passive: false });
      tz.addEventListener('touchend', (e) => this._touchEnd(e));
      tz.addEventListener('touchcancel', (e) => this._touchEnd(e));
    }

    _look(dx, dy) {
      const s = 0.0022 * this.sensitivity;
      this.yaw -= dx * s;
      this.pitch -= dy * s * (this.invertY ? -1 : 1);
      this.pitch = U.clamp(this.pitch, -1.45, 1.45);
    }

    _touchStart(e) {
      if (!this.enabled) return;
      this.isTouch = true;
      for (const t of e.changedTouches) {
        const leftZone = t.clientX < window.innerWidth * 0.42 && t.clientY > window.innerHeight * 0.35;
        if (leftZone && this.touch.moveId == null) {
          this.touch.moveId = t.identifier;
          this.touch.ox = t.clientX;
          this.touch.oy = t.clientY;
          this.touch.mx = 0;
          this.touch.my = 0;
          if (this.onStick) this.onStick(true, t.clientX, t.clientY, 0, 0);
        } else if (this.touch.lookId == null) {
          this.touch.lookId = t.identifier;
          this.touch.lx = t.clientX;
          this.touch.ly = t.clientY;
        }
      }
      e.preventDefault();
    }

    _touchMove(e) {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.moveId) {
          const dx = t.clientX - this.touch.ox, dy = t.clientY - this.touch.oy;
          const len = Math.hypot(dx, dy);
          const max = 55;
          const k = len > max ? max / len : 1;
          this.touch.mx = (dx * k) / max;
          this.touch.my = (dy * k) / max;
          if (this.onStick) this.onStick(true, this.touch.ox, this.touch.oy, dx * k, dy * k);
        } else if (t.identifier === this.touch.lookId) {
          this._look((t.clientX - this.touch.lx) * 1.6, (t.clientY - this.touch.ly) * 1.6);
          this.touch.lx = t.clientX;
          this.touch.ly = t.clientY;
        }
      }
      e.preventDefault();
    }

    _touchEnd(e) {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.moveId) {
          this.touch.moveId = null;
          this.touch.mx = this.touch.my = 0;
          if (this.onStick) this.onStick(false);
        }
        if (t.identifier === this.touch.lookId) this.touch.lookId = null;
      }
    }

    requestLock() {
      if (this.isTouch || this.lockFailed) return false;
      try {
        const r = this.dom.requestPointerLock && this.dom.requestPointerLock();
        if (r && r.catch) {
          r.catch(() => {
            this.lockFailed = true;
            if (this.onLockChange) this.onLockChange(false);
          });
        }
        return true;
      } catch (e) {
        this.lockFailed = true;
        return false;
      }
    }

    unlock() {
      if (document.pointerLockElement) document.exitPointerLock();
      this.dragging = false;
    }

    teleport(x, z, yaw) {
      this.pos.set(x, 0, z);
      this.vel.set(0, 0);
      if (yaw != null) this.yaw = yaw;
      this.pitch = 0;
    }

    shake(amount) {
      this.shakeAmt = Math.max(this.shakeAmt, amount);
    }

    update(dt) {
      let fx = 0, fz = 0;
      if (this.enabled) {
        const k = this.keys;
        if (k.KeyW || k.ArrowUp) fz += 1;
        if (k.KeyS || k.ArrowDown) fz -= 1;
        if (k.KeyA || k.ArrowLeft) fx -= 1;
        if (k.KeyD || k.ArrowRight) fx += 1;
        if (this.touch.moveId != null) {
          fx += this.touch.mx;
          fz -= this.touch.my;
        }
      }
      const len = Math.hypot(fx, fz);
      if (len > 1) {
        fx /= len;
        fz /= len;
      }
      const run = this.keys.ShiftLeft || this.keys.ShiftRight || (this.touch.moveId != null && Math.hypot(this.touch.mx, this.touch.my) > 0.92);
      const speed = (run ? 6.4 : 3.8) * this.speedBoost;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      // forward is -z when yaw = 0
      const wx = (fx * cos - fz * sin) * speed;
      const wz = (-fx * sin - fz * cos) * speed;
      const accel = len > 0.05 ? 12 : 14;
      this.vel.x += (wx - this.vel.x) * Math.min(1, dt * accel);
      this.vel.y += (wz - this.vel.y) * Math.min(1, dt * accel);

      const nx = this.pos.x + this.vel.x * dt;
      const nz = this.pos.z + this.vel.y * dt;
      const res = this.collide(nx, nz);
      const moved = Math.hypot(res.x - this.pos.x, res.z - this.pos.z);
      this.pos.x = res.x;
      this.pos.z = res.z;

      // head bob & footsteps
      const sp = moved / Math.max(dt, 1e-4);
      if (sp > 0.5) {
        this.bobT += dt * (run ? 11 : 8.5);
        this.stepAcc += moved;
        const stride = run ? 0.85 : 0.7;
        if (this.stepAcc > stride) {
          this.stepAcc = 0;
          if (this.onStep) this.onStep(run);
        }
      } else {
        this.bobT *= 0.9;
      }
      const bob = Math.sin(this.bobT) * 0.035 * Math.min(1, sp / 3);

      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.5);
      const sh = this.shakeAmt * this.shakeAmt;
      const cam = this.camera;
      cam.position.set(this.pos.x + (Math.random() - 0.5) * sh * 0.12, this.eye + bob + (Math.random() - 0.5) * sh * 0.12, this.pos.z + (Math.random() - 0.5) * sh * 0.12);
      cam.rotation.order = 'YXZ';
      cam.rotation.y = this.yaw;
      cam.rotation.x = this.pitch + (Math.random() - 0.5) * sh * 0.02;
      cam.rotation.z = Math.sin(this.bobT * 0.5) * 0.004;
    }

    collide(x, z) {
      const r = this.radius;
      for (let iter = 0; iter < 3; iter++) {
        for (const c of this.world.colliders) {
          if (c.type === 'box') {
            const minX = c.minX - r, maxX = c.maxX + r, minZ = c.minZ - r, maxZ = c.maxZ + r;
            if (x > minX && x < maxX && z > minZ && z < maxZ) {
              const dl = x - minX, dr = maxX - x, dn = z - minZ, ds = maxZ - z;
              const m = Math.min(dl, dr, dn, ds);
              if (m === dl) x = minX;
              else if (m === dr) x = maxX;
              else if (m === dn) z = minZ;
              else z = maxZ;
            }
          } else {
            const dx = x - c.x, dz = z - c.z;
            const d = Math.hypot(dx, dz);
            const rr = c.r + r;
            if (d < rr) {
              if (d < 1e-4) {
                x = c.x + rr;
              } else {
                x = c.x + (dx / d) * rr;
                z = c.z + (dz / d) * rr;
              }
            }
          }
        }
      }
      return { x, z };
    }

    forward() {
      return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    }
  }

  G.Player = Player;
})();
