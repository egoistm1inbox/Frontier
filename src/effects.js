import * as THREE from 'three';
import { PALETTE } from './track.js';

/** GPU-friendly particle pool (points) for sparks, boost trails, pickups. */
export class ParticleSystem {
  constructor(scene, count = 2600) {
    this.count = count;
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.sizes = new Float32Array(count);
    this.alive = new Uint8Array(count);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.base = new Float32Array(count);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (320.0 / max(1.0, -mv.z));
          vAlpha = clamp(size * 2.2, 0.0, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 d = gl_PointCoord - vec2(0.5);
          float r = length(d);
          if (r > 0.5) discard;
          float a = pow(1.0 - r * 2.0, 2.0);
          gl_FragColor = vec4(vColor, a * vAlpha);
        }
      `,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.geo = geo;
  }

  spawn(pos, vel, color, size = 1, life = 0.7) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    const o = i * 3;
    this.positions[o] = pos.x;
    this.positions[o + 1] = pos.y;
    this.positions[o + 2] = pos.z;
    this.vel[o] = vel.x;
    this.vel[o + 1] = vel.y;
    this.vel[o + 2] = vel.z;
    const c = new THREE.Color(color);
    this.colors[o] = c.r;
    this.colors[o + 1] = c.g;
    this.colors[o + 2] = c.b;
    this.sizes[i] = size;
    this.base[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.alive[i] = 1;
  }

  burst(pos, color, amount = 14, power = 8, size = 0.9) {
    for (let k = 0; k < amount; k++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(power * (0.35 + Math.random()));
      v.y = Math.abs(v.y) * 0.6 + 1;
      this.spawn(pos, v, color, size * (0.5 + Math.random()), 0.4 + Math.random() * 0.6);
    }
  }

  update(dt, gravity = -14) {
    const p = this.positions;
    const s = this.sizes;
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) {
        if (s[i] !== 0) s[i] = 0;
        continue;
      }
      const o = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alive[i] = 0;
        s[i] = 0;
        continue;
      }
      this.vel[o + 1] += gravity * dt * 0.35;
      p[o] += this.vel[o] * dt;
      p[o + 1] += this.vel[o + 1] * dt;
      p[o + 2] += this.vel[o + 2] * dt;
      this.vel[o] *= 1 - 1.6 * dt;
      this.vel[o + 2] *= 1 - 1.6 * dt;
      const k = this.life[i] / this.maxLife[i];
      s[i] = this.base[i] * k * k;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

/** Radial speed lines rendered as a screen-space overlay when boosting. */
export class SpeedLines {
  constructor(scene, camera) {
    this.group = new THREE.Group();
    this.lines = [];
    const count = 90;
    for (let i = 0; i < count; i++) {
      const geo = new THREE.BufferGeometry();
      const a = Math.random() * Math.PI * 2;
      const r = 3.2 + Math.random() * 5;
      const len = 1.2 + Math.random() * 2.6;
      const pts = new Float32Array([
        Math.cos(a) * r, Math.sin(a) * r, -12,
        Math.cos(a) * (r + len * 0.3), Math.sin(a) * (r + len * 0.3), -12 - len,
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xaee8ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      this.lines.push(line);
      this.group.add(line);
    }
    camera.add(this.group);
    this.intensity = 0;
  }

  update(dt, intensity, elapsed) {
    this.intensity += (intensity - this.intensity) * (1 - Math.exp(-6 * dt));
    this.group.visible = this.intensity > 0.02;
    for (let i = 0; i < this.lines.length; i++) {
      const l = this.lines[i];
      l.material.opacity = this.intensity * (0.16 + 0.3 * Math.random());
      l.position.z = ((elapsed * (28 + i % 7 * 8)) % 24) - 12;
      l.scale.z = 1 + this.intensity * 2;
    }
  }
}

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0; // 0 chase, 1 far chase, 2 hood
    this.modes = ['CHASE', 'FAR CHASE', 'COCKPIT'];
    this.shake = 0;
    this.fov = 74;
    this.targetPos = new THREE.Vector3();
    this.targetLook = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
  }

  cycle() {
    this.mode = (this.mode + 1) % this.modes.length;
    return this.modes[this.mode];
  }

  addShake(v) {
    this.shake = Math.min(1.4, this.shake + v);
  }

  update(dt, ship, elapsed) {
    const fwd = new THREE.Vector3(Math.sin(ship.yaw), 0, Math.cos(ship.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const speedN = Math.min(1.5, Math.abs(ship.speed) / 116);

    let back, up, lookAhead;
    if (this.mode === 2) {
      back = 0.6;
      up = 1.5;
      lookAhead = 22;
    } else if (this.mode === 1) {
      back = 15 + speedN * 3;
      up = 6.4;
      lookAhead = 16;
    } else {
      back = 9.4 + speedN * 2.4;
      up = 3.9 + speedN * 0.5;
      lookAhead = 14;
    }

    const drift = ship.drifting ? 1.6 : 0;
    this.targetPos
      .copy(ship.pos)
      .addScaledVector(fwd, -back)
      .addScaledVector(right, -ship.steer * drift)
      .add(new THREE.Vector3(0, up, 0));

    const follow = this.mode === 2 ? 22 : 5.2;
    this.camera.position.lerp(this.targetPos, 1 - Math.exp(-follow * dt));

    this.targetLook
      .copy(ship.pos)
      .addScaledVector(fwd, lookAhead)
      .addScaledVector(right, ship.steer * 2.6)
      .add(new THREE.Vector3(0, 1.5, 0));
    this.lookAt.lerp(this.targetLook, 1 - Math.exp(-7 * dt));

    // shake
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const sh = this.shake * this.shake;
    const jitter = new THREE.Vector3(
      (Math.random() - 0.5) * sh * 1.6,
      (Math.random() - 0.5) * sh * 1.2,
      (Math.random() - 0.5) * sh * 1.6
    );
    this.camera.position.add(jitter);

    this.camera.lookAt(this.lookAt);

    // rolling camera when drifting
    const roll = ship.steer * (ship.drifting ? 0.05 : 0.022);
    this.camera.rotateZ(roll);

    // FOV kicks with speed and boost
    const targetFov = 74 + speedN * 12 + (ship.boosting ? 9 : 0);
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-4 * dt));
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }
}

/** Pooled speed-gate pickup rings. */
export class EnergyGates {
  constructor(scene, track, count = 26) {
    this.track = track;
    this.items = [];
    const geo = new THREE.TorusGeometry(2.4, 0.16, 8, 22);
    const padGeo = new THREE.CircleGeometry(2.5, 20);

    for (let i = 0; i < count; i++) {
      const s = i / count;
      const idx = Math.round(s * track.N) % track.N;
      const lane = Math.sin(i * 2.399) * 0.62;
      const group = new THREE.Group();
      const ring = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: PALETTE.lime,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      const halo = new THREE.Mesh(
        padGeo,
        new THREE.MeshBasicMaterial({
          color: PALETTE.lime,
          transparent: true,
          opacity: 0.16,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      group.add(ring, halo);
      const p = track.surfacePoint(idx, lane, new THREE.Vector3(), 2.9);
      group.position.copy(p);
      const sample = track.samples[idx];
      group.rotation.y = Math.atan2(sample.tangent.x, sample.tangent.z);
      ring.rotation.y = Math.PI / 2;
      halo.rotation.y = Math.PI / 2;
      scene.add(group);
      this.items.push({ group, ring, halo, index: idx, active: true, respawn: 0, lane, phase: i });
    }
  }

  update(dt, elapsed, ship, onCollect) {
    for (const item of this.items) {
      if (!item.active) {
        item.respawn -= dt;
        if (item.respawn <= 0) {
          item.active = true;
          item.group.visible = true;
        }
        continue;
      }
      item.group.rotation.z = Math.sin(elapsed * 1.2 + item.phase) * 0.18;
      item.halo.material.opacity = 0.1 + 0.08 * Math.sin(elapsed * 4 + item.phase);
      const d = item.group.position.distanceTo(ship.pos);
      if (d < 3.6) {
        item.active = false;
        item.group.visible = false;
        item.respawn = 14;
        onCollect?.(item);
      }
    }
  }
}
