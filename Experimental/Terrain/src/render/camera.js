// Unreal-style viewport camera.
//  RMB drag: look · hold RMB + WASD/QE: fly (WASD also works when the viewport is hovered) · Shift: boost
//  Wheel: dolly (with RMB held: change fly speed) · LMB drag: move forward/back + yaw · MMB drag: pan
//  Alt + LMB: orbit pivot · F: frame terrain · L + LMB drag: rotate sun
import { v3, clamp, perspectiveRevZ, viewFromBasis, mul4, invert4, rad } from '../core/math.js';

export class FlyCamera {
  constructor() {
    this.pos = [0, 1800, 5200];
    this.yaw = 0; this.pitch = -0.2;
    this.fov = 50; this.near = 0.5;
    this.speedMul = 1;
    this.vel = [0, 0, 0];
    this.keys = new Set();
    this.buttons = 0;
    this.heightAt = () => 0;
    this.bounds = 8192;
    this.onChange = () => {};
    this.onSun = null;
    this.pivot = null;
    this._lastT = 0;
  }
  get forward() { const cp = Math.cos(this.pitch); return [Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp]; }
  get right() { return [Math.cos(this.yaw), 0, Math.sin(this.yaw)]; }
  get up() { return v3.cross(this.right, this.forward); }

  matrices(aspect) {
    const view = viewFromBasis(this.pos, this.right, this.up, this.forward);
    const proj = perspectiveRevZ(rad(this.fov), aspect, this.near);
    const viewProj = mul4(proj, view);
    return { view, proj, viewProj, invViewProj: invert4(viewProj) };
  }

  toJSON() { return { pos: this.pos.map(v => +v.toFixed(2)), yaw: +this.yaw.toFixed(4), pitch: +this.pitch.toFixed(4), fov: this.fov }; }
  fromJSON(j) { if (!j) return; this.pos = j.pos.slice(); this.yaw = j.yaw; this.pitch = j.pitch; this.fov = j.fov ?? 50; this.vel = [0, 0, 0]; }

  ground() { return this.heightAt(this.pos[0], this.pos[2]); }
  altitude() { return this.pos[1] - this.ground(); }
  baseSpeed() { return clamp(Math.max(15, this.altitude()) * 0.9, 12, 3500) * this.speedMul; }

  attach(el) {
    this.el = el;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => this._down(e));
    window.addEventListener('pointerup', (e) => this._up(e));
    window.addEventListener('pointermove', (e) => this._move(e));
    el.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    el.addEventListener('pointerenter', () => { this.hover = true; });
    el.addEventListener('pointerleave', () => { this.hover = false; });
    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons = 0; });
  }

  _typing() {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
  }
  _key(e, down) {
    if (down && this._typing()) return;
    const k = e.key.toLowerCase();
    if (down && k === 'f' && !e.ctrlKey && !e.metaKey && (this.hover || this.buttons)) { this.frame(); return; }
    if (['w', 'a', 's', 'd', 'q', 'e', 'shift', 'l', 'alt', ' '].includes(k)) {
      if (down) {
        if (!(this.hover || this.buttons) && k !== 'shift' && k !== 'alt' && k !== 'l') return;
        this.keys.add(k);
      } else this.keys.delete(k);
      if (k === 'alt') e.preventDefault();
      this.onChange();
    }
  }
  _down(e) {
    this.el.focus?.();
    this.buttons |= (1 << e.button);
    this.el.setPointerCapture?.(e.pointerId);
    this._px = e.clientX; this._py = e.clientY;
    if (e.button === 0 && e.altKey) {
      // orbit pivot = terrain point under the view centre (approx: ray march)
      this.pivot = this.pickCenter();
    }
    this.onChange();
  }
  _up(e) {
    this.buttons &= ~(1 << e.button);
    if (e.button === 0) this.pivot = null;
  }
  _move(e) {
    if (!this.buttons) return;
    const dx = e.clientX - this._px, dy = e.clientY - this._py;
    this._px = e.clientX; this._py = e.clientY;
    const rs = 0.0032 * (this.fov / 60);
    if (this.keys.has('l') && (this.buttons & 1) && this.onSun) { this.onSun(dx, dy); return; }
    if (this.buttons & 2) { // look
      this.yaw += dx * rs; this.pitch = clamp(this.pitch - dy * rs, -1.55, 1.55);
    } else if ((this.buttons & 1) && e.altKey && this.pivot) { // orbit
      const off = v3.sub(this.pos, this.pivot);
      const r = v3.len(off);
      let yaw = Math.atan2(off[0], -off[2]) + Math.PI, pitch = Math.asin(clamp(off[1] / r, -1, 1));
      yaw -= 0; this.yaw += dx * rs; this.pitch = clamp(this.pitch - dy * rs, -1.5, 1.5);
      const f = this.forward;
      this.pos = v3.sub(this.pivot, v3.scale(f, r));
      void yaw; void pitch;
    } else if (this.buttons & 1) { // forward/back + yaw (Unreal LMB)
      this.yaw += dx * rs;
      const f = [Math.sin(this.yaw), 0, -Math.cos(this.yaw)];
      this.pos = v3.add(this.pos, v3.scale(f, -dy * this.baseSpeed() * 0.004));
    } else if (this.buttons & 4) { // pan
      const s = this.baseSpeed() * 0.0025;
      this.pos = v3.add(this.pos, v3.add(v3.scale(this.right, -dx * s), v3.scale(this.up, dy * s)));
    }
    this._collide();
    this.onChange();
  }
  _wheel(e) {
    e.preventDefault();
    if (this.buttons & 2) {
      this.speedMul = clamp(this.speedMul * (e.deltaY < 0 ? 1.25 : 0.8), 0.05, 20);
    } else {
      const d = -Math.sign(e.deltaY) * Math.min(4, Math.abs(e.deltaY) / 50 + 0.5);
      this.pos = v3.add(this.pos, v3.scale(this.forward, d * this.baseSpeed() * 0.12));
      this._collide();
    }
    this.onChange();
  }
  pickCenter() {
    const f = this.forward;
    let t = 0, step = 20;
    for (let i = 0; i < 600; i++) {
      const p = v3.add(this.pos, v3.scale(f, t));
      if (p[1] <= this.heightAt(p[0], p[2])) return p;
      t += step; step *= 1.02;
      if (t > this.bounds * 4) break;
    }
    return v3.add(this.pos, v3.scale(f, Math.max(200, this.altitude() * 2)));
  }
  frame() {
    const W = this.bounds;
    this.yaw = Math.PI * 0.25 * 0 + 0.0; this.pitch = -0.42;
    const h = this.heightAt(0, 0);
    const dist = W * 0.95;
    this.pos = [0, h + dist * Math.sin(0.42) + 200, dist * Math.cos(0.42)];
    this.yaw = 0;
    this.vel = [0, 0, 0];
    this.onChange();
  }
  _collide() {
    const g = this.ground() + 1.8;
    if (this.pos[1] < g) this.pos[1] = g;
    const lim = this.bounds * 3;
    this.pos[0] = clamp(this.pos[0], -lim, lim); this.pos[2] = clamp(this.pos[2], -lim, lim);
    this.pos[1] = clamp(this.pos[1], -2000, 60000);
  }
  // Returns true while the camera is moving (keeps the render loop alive)
  update(dt) {
    const k = this.keys;
    const flying = (this.buttons & 2) || this.hover;
    let dir = [0, 0, 0];
    if (flying) {
      if (k.has('w')) dir = v3.add(dir, this.forward);
      if (k.has('s')) dir = v3.sub(dir, this.forward);
      if (k.has('d')) dir = v3.add(dir, this.right);
      if (k.has('a')) dir = v3.sub(dir, this.right);
      if (k.has('e') || k.has(' ')) dir = v3.add(dir, [0, 1, 0]);
      if (k.has('q')) dir = v3.sub(dir, [0, 1, 0]);
    }
    const sp = this.baseSpeed() * (k.has('shift') ? 4 : 1);
    const target = v3.len(dir) > 0 ? v3.scale(v3.norm(dir), sp) : [0, 0, 0];
    const a = 1 - Math.exp(-dt * 10);
    this.vel = v3.lerp(this.vel, target, a);
    const moving = v3.len(this.vel) > 0.05;
    if (moving) {
      this.pos = v3.add(this.pos, v3.scale(this.vel, dt));
      this._collide();
    } else this.vel = [0, 0, 0];
    return moving || v3.len(target) > 0;
  }
}
