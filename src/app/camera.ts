// Free-fly camera. Speed scales with height above the macro ground so flying out is quick and
// walking on the surface stays controllable.
import type { V3 } from '../clipmap/layout.ts';

export class FlyCamera {
  pos: V3;
  yaw = 0;
  pitch = -0.2;
  readonly keys = new Set<string>();

  constructor(pos: V3) {
    this.pos = [...pos] as V3;
  }

  look(dx: number, dy: number): void {
    this.yaw += dx * 0.0022;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * 0.0022));
  }

  /** `groundAt` returns the macro ground height at (x, z), used for speed scaling. */
  update(dt: number, groundAt: (x: number, z: number) => number): void {
    const k = this.keys;
    const fwdH: V3 = [Math.sin(this.yaw), 0, -Math.cos(this.yaw)];
    const rightH: V3 = [Math.cos(this.yaw), 0, Math.sin(this.yaw)];
    let mx = 0, my = 0, mz = 0;
    const add = (v: V3, s: number) => { mx += v[0] * s; my += v[1] * s; mz += v[2] * s; };
    if (k.has('KeyW')) add(fwdH, 1);
    if (k.has('KeyS')) add(fwdH, -1);
    if (k.has('KeyD')) add(rightH, 1);
    if (k.has('KeyA')) add(rightH, -1);
    if (k.has('Space') || k.has('KeyE')) my += 1;
    if (k.has('ControlLeft') || k.has('KeyQ')) my -= 1;
    const len = Math.hypot(mx, my, mz);
    if (len === 0) return;
    const height = Math.max(0, this.pos[1] - groundAt(this.pos[0], this.pos[2]));
    let speed = Math.min(600, Math.max(3, height * 0.8));
    if (k.has('ShiftLeft') || k.has('ShiftRight')) speed *= 4;
    const s = (speed * dt) / len;
    this.pos = [this.pos[0] + mx * s, this.pos[1] + my * s, this.pos[2] + mz * s];
  }

  basis(): { fwd: V3; right: V3; up: V3 } {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const fwd: V3 = [Math.sin(this.yaw) * cp, sp, -Math.cos(this.yaw) * cp];
    const right: V3 = [Math.cos(this.yaw), 0, Math.sin(this.yaw)];
    const up: V3 = [
      right[1] * fwd[2] - right[2] * fwd[1],
      right[2] * fwd[0] - right[0] * fwd[2],
      right[0] * fwd[1] - right[1] * fwd[0],
    ];
    return { fwd, right, up };
  }
}
