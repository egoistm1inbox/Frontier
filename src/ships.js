import * as THREE from 'three';
import { PALETTE } from './track.js';

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

export const TUNING = {
  maxSpeed: 100,   // m/s (~360 km/h)
  boostSpeed: 142, // m/s (~510 km/h)
  accel: 46,
  latAccel: 44,    // m/s^2 of usable cornering grip, drives AI + camera
  brake: 78,
  coastDrag: 9,
  steerRate: 1.85,
  steerAtSpeed: 0.72,
  gripNormal: 8.0,
  gripDrift: 1.25,
  driftYawBonus: 1.62,
  boostDrain: 0.42,
  boostRegenDrift: 0.19,
  boostRegenHit: 0.05,
  hover: 1.25,
  hull: 100,
};

function makeShipMesh(color, accent) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x151c2e,
    metalness: 0.9,
    roughness: 0.28,
    emissive: new THREE.Color(color).multiplyScalar(0.12),
  });
  const accentMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x081018,
    metalness: 1,
    roughness: 0.05,
    emissive: new THREE.Color(accent).multiplyScalar(0.35),
  });

  // --- hull: tapered wedge
  const shape = new THREE.Shape();
  shape.moveTo(0, 3.05);
  shape.lineTo(0.95, 0.9);
  shape.lineTo(1.32, -1.0);
  shape.lineTo(0.72, -2.0);
  shape.lineTo(-0.72, -2.0);
  shape.lineTo(-1.32, -1.0);
  shape.lineTo(-0.95, 0.9);
  shape.closePath();

  const hullGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.62,
    bevelEnabled: true,
    bevelSize: 0.14,
    bevelThickness: 0.16,
    bevelSegments: 1,
  });
  hullGeo.rotateX(Math.PI / 2); // nose (+Y in shape space) -> +Z, the ship's forward
  hullGeo.translate(0, 0.28, 0);
  const hull = new THREE.Mesh(hullGeo, bodyMat);
  group.add(hull);

  // --- canopy
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.78, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), glassMat);
  canopy.scale.set(0.78, 0.62, 1.55);
  canopy.position.set(0, 0.86, 0.35);
  group.add(canopy);

  // --- side pods
  const podGeo = new THREE.CapsuleGeometry(0.3, 1.9, 4, 10);
  podGeo.rotateX(Math.PI / 2);
  for (const sx of [-1, 1]) {
    const pod = new THREE.Mesh(podGeo, bodyMat);
    pod.position.set(sx * 1.28, 0.18, -0.5);
    pod.scale.set(1, 0.72, 1);
    group.add(pod);

    // wing
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.05), bodyMat);
    wing.position.set(sx * 1.5, 0.3, -1.15);
    wing.rotation.z = sx * 0.18;
    group.add(wing);

    // engine ring
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.06, 8, 18), accentMat);
    ring.position.set(sx * 1.28, 0.2, -1.75);
    group.add(ring);

    // engine core
    const core = new THREE.Mesh(
      new THREE.CircleGeometry(0.28, 16),
      new THREE.MeshBasicMaterial({
        color: 0xdff6ff,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    core.position.set(sx * 1.28, 0.2, -1.8);
    core.rotation.y = Math.PI;
    core.name = 'engineCore';
    group.add(core);
  }

  // --- light strips
  const stripGeo = new THREE.BoxGeometry(0.05, 0.05, 2.6);
  for (const sx of [-0.9, 0.9]) {
    const strip = new THREE.Mesh(stripGeo, accentMat);
    strip.position.set(sx, 0.42, 0.1);
    group.add(strip);
  }

  // --- underglow
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(4.4, 6.2),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: glowTexture(),
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.42;
  glow.name = 'underglow';
  group.add(glow);

  // --- headlight cone
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(1.1, 7, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xbff0ff,
      transparent: true,
      opacity: 0.075,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  cone.rotation.x = Math.PI / 2;
  cone.position.set(0, 0.35, 5.2);
  group.add(cone);

  group.scale.setScalar(0.86);
  return group;
}

let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}

class Trail {
  constructor(color, segments = 34) {
    this.segments = segments;
    this.positions = new Float32Array(segments * 2 * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const idx = [];
    for (let i = 0; i < segments - 1; i++) {
      const b = i * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    this.geo.setIndex(idx);
    this.mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.history = [];
  }

  reset() {
    this.history.length = 0;
  }

  update(pos, right, strength) {
    this.history.unshift({ p: pos.clone(), r: right.clone(), s: strength });
    if (this.history.length > this.segments) this.history.pop();

    const arr = this.positions;
    for (let i = 0; i < this.segments; i++) {
      const h = this.history[Math.min(i, this.history.length - 1)];
      if (!h) continue;
      const w = (0.42 + 0.5 * h.s) * (1 - i / this.segments);
      const o = i * 6;
      arr[o] = h.p.x - h.r.x * w;
      arr[o + 1] = h.p.y - h.r.y * w;
      arr[o + 2] = h.p.z - h.r.z * w;
      arr[o + 3] = h.p.x + h.r.x * w;
      arr[o + 4] = h.p.y + h.r.y * w;
      arr[o + 5] = h.p.z + h.r.z * w;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeBoundingSphere();
  }
}

export class Ship {
  constructor({ scene, track, color, accent, name, isPlayer = false, skill = 1 }) {
    this.scene = scene;
    this.track = track;
    this.color = color;
    this.name = name;
    this.isPlayer = isPlayer;
    this.skill = skill;

    this.mesh = makeShipMesh(color, accent);
    scene.add(this.mesh);

    this.trailL = new Trail(color);
    this.trailR = new Trail(accent);
    scene.add(this.trailL.mesh, this.trailR.mesh);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.steer = 0;
    this.throttle = 0;
    this.brakeInput = 0;
    this.drifting = false;
    this.boost = 0.6;
    this.boosting = false;
    this.hull = TUNING.hull;
    this.sampleIndex = 0;
    this.lateral = 0;
    this.lap = 0;
    this.lapProgress = 0;
    this.progress = 0;
    this.energyFx = 0;
    this.bob = Math.random() * 10;
    this.airborne = 0;
    this.free = false; // debug: skip track constraint (used by tools/sim.mjs)
  }

  placeAt(sampleIndex, lateral = 0) {
    this.sampleIndex = ((sampleIndex % this.track.N) + this.track.N) % this.track.N;
    const s = this.track.samples[this.sampleIndex];
    const p = this.track.surfacePoint(this.sampleIndex, lateral, new THREE.Vector3(), TUNING.hover);
    this.pos.copy(p);
    this.yaw = Math.atan2(s.tangent.x, s.tangent.z);
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.lap = 0;
    this.lapProgress = 0;
    this.progress = this.sampleIndex;
    this.trailL.reset();
    this.trailR.reset();
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /**
   * inputs: { steer: -1..1, throttle: 0..1, brake: 0..1, drift: bool, boost: bool }
   */
  update(dt, inputs, elapsed) {
    const T = TUNING;
    this.steer = lerp(this.steer, inputs.steer ?? 0, 1 - Math.exp(-12 * dt));
    this.throttle = lerp(this.throttle, inputs.throttle ?? 0, 1 - Math.exp(-9 * dt));
    this.brakeInput = lerp(this.brakeInput, inputs.brake ?? 0, 1 - Math.exp(-14 * dt));

    const speedRatio = clamp(this.speed / T.maxSpeed, 0, 1.4);

    // drift state
    const wantDrift = !!inputs.drift && this.speed > 26;
    if (wantDrift !== this.drifting) {
      if (wantDrift) this.energyFx = 1;
      this.drifting = wantDrift;
    }

    // boost
    const wantBoost = !!inputs.boost && this.boost > 0.02 && this.speed > 18;
    this.boosting = wantBoost;
    if (this.boosting) {
      this.boost = Math.max(0, this.boost - T.boostDrain * dt);
      this.energyFx = 1;
    } else {
      const regen = this.drifting ? T.boostRegenDrift : T.boostRegenHit;
      this.boost = Math.min(1, this.boost + regen * dt * (this.isPlayer ? 1 : 1.35));
    }
    this.energyFx = Math.max(0, this.energyFx - dt * 2.2);

    // ---- steering
    const gripLoss = this.drifting ? T.driftYawBonus : 1;
    const steerAuthority = T.steerRate * (1 - speedRatio * T.steerAtSpeed) * gripLoss;
    const dir = this.speed >= 0 ? 1 : -1;
    this.yaw -= this.steer * steerAuthority * dt * dir * clamp(this.speed / 14, 0, 1);

    const fwd = this.forward;
    // right of travel = forward x up  ->  (-fz, 0, fx)
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);

    // ---- longitudinal
    const topSpeed = this.boosting ? T.boostSpeed : T.maxSpeed;
    const accel = T.accel * (this.boosting ? 1.75 : 1) * this.throttle;
    if (this.throttle > 0.01) this.speed += accel * dt * (1 - clamp(this.speed / topSpeed, 0, 1));
    if (this.brakeInput > 0.01) this.speed -= T.brake * this.brakeInput * dt;
    if (this.throttle < 0.05 && this.brakeInput < 0.05) this.speed -= T.coastDrag * dt;
    // boost release bleeds back down to the normal top speed smoothly
    if (this.speed > topSpeed) this.speed -= (this.speed - topSpeed) * 2.4 * dt;
    this.speed = clamp(this.speed, -12, T.boostSpeed * 1.02);

    // ---- lateral slip (this is what makes it feel like a racer, not a runner)
    const velFwd = this.vel.dot(fwd);
    const velRight = this.vel.dot(right);

    // Inject outward slide when turning: this is the whole difference between a
    // racer and a rail-runner. Drifting deliberately breaks grip so the hull
    // points into the corner while momentum carries you wide.
    const slideTarget = -this.steer * Math.abs(this.speed) * (this.drifting ? 0.26 : 0.03);
    const grip = this.drifting ? T.gripDrift : T.gripNormal;
    const newRight = lerp(velRight, slideTarget, 1 - Math.exp(-grip * dt));

    // longitudinal speed is authoritative (already integrated above); only the
    // lateral component is filtered, which is what produces grip/slip.
    this.vel.copy(fwd).multiplyScalar(this.speed).addScaledVector(right, newRight);

    this.pos.addScaledVector(this.vel, dt);

    // ---- track constraint
    if (!this.free) this._constrainToTrack(dt);

    // ---- visuals
    this._syncMesh(dt, elapsed);
  }

  _constrainToTrack(dt) {
    const track = this.track;
    let idx = track.nearestIndex(this.pos, this.sampleIndex, 34);
    // lost the thread (respawn, big hit): fall back to a global search
    if (track.samples[idx].pos.distanceToSquared(this.pos) > 3600) {
      idx = track.nearestIndex(this.pos, -1);
      this.sampleIndex = idx;
    }
    const info = track.lateralAt(idx, this.pos);
    const sample = track.samples[idx];

    // ---- progress + lap detection
    // A lap only counts once the ship has actually covered most of the circuit
    // since its last crossing, so the grid roll-off the line can't false-trigger.
    const prev = this.sampleIndex;
    const N = track.N;
    let delta = idx - prev;
    let crossed = null;
    if (delta < -N / 2) {
      delta += N;
      crossed = 1;
    } else if (delta > N / 2) {
      delta -= N;
      crossed = -1;
    }
    if (crossed === 1 && this.lapProgress > N * 0.5) {
      this.lap += 1;
      this.lapProgress = 0;
      if (this.onLap) this.onLap(this);
    } else if (crossed === -1) {
      if (this.lap > 0) this.lap -= 1;
      this.lapProgress = 0;
    }
    this.progress += delta;
    if (delta > 0) this.lapProgress += delta;
    this.sampleIndex = idx;
    this.lateral = info.t;

    // hover height follows the road surface
    const targetY = info.y + TUNING.hover;
    this.pos.y = lerp(this.pos.y, targetY, 1 - Math.exp(-14 * dt));

    // barrier collision
    const limit = 1.0;
    if (Math.abs(info.t) > limit) {
      const overshoot = Math.abs(info.t) - limit;
      const sign = Math.sign(info.t);
      // push back inside
      this.pos.addScaledVector(sample.right, -sign * Math.min(overshoot * info.hw, info.hw * 0.9));
      // scrape: bleed speed and lateral velocity
      const impact = Math.abs(this.vel.dot(sample.right));
      const owner = this;
      this.speed *= 1 - clamp(0.06 + impact * 0.012, 0, 0.34);
      const lat = this.vel.dot(sample.right);
      this.vel.addScaledVector(sample.right, -lat * 1.45);
      this.scrape = Math.min(1, (this.scrape || 0) + 0.35 + impact * 0.03);
      if (this.onWall) this.onWall(owner, impact);
      // yaw nudged back along the track
      const trackYaw = Math.atan2(sample.tangent.x, sample.tangent.z);
      this.yaw = this.yaw + wrapAngle(trackYaw - this.yaw) * clamp(0.12 + impact * 0.01, 0, 0.3);
    }
    this.scrape = Math.max(0, (this.scrape || 0) - dt * 3);
  }

  _syncMesh(dt, elapsed) {
    this.bob += dt * (6 + this.speed * 0.12);
    const sample = this.track.samples[this.sampleIndex];

    this.mesh.position.copy(this.pos);
    this.mesh.position.y += Math.sin(this.bob) * 0.055;

    // roll: bank into steering + drift lean
    const targetRoll =
      this.steer * (0.14 + this.speed / TUNING.maxSpeed * 0.26) +
      (this.drifting ? this.steer * 0.1 : 0);
    this.mesh.rotation.z = lerp(this.mesh.rotation.z, targetRoll, 1 - Math.exp(-8 * dt));

    // pitch: nose up under boost, dip when braking
    const targetPitch =
      this.brakeInput * 0.09 - (this.boosting ? 0.05 : 0) - Math.sin(this.bob * 0.5) * 0.006;
    this.mesh.rotation.x = lerp(this.mesh.rotation.x, targetPitch, 1 - Math.exp(-6 * dt));

    // yaw follows heading, drifts visually when sliding
    const visualYaw = this.yaw - (this.drifting ? this.steer * 0.24 : 0);
    this.mesh.rotation.y = visualYaw;

    // engine glow
    const thrust = clamp(this.throttle + (this.boosting ? 1 : 0), 0, 2);
    this.mesh.traverse((o) => {
      if (o.name === 'engineCore') {
        const s = 0.7 + thrust * 0.5 + Math.random() * 0.12;
        o.scale.setScalar(s);
        o.material.opacity = clamp(0.55 + thrust * 0.4, 0, 1);
        o.material.color.setHex(this.boosting ? 0xdff6ff : 0x7fe6ff);
      }
      if (o.name === 'underglow') {
        o.material.opacity = 0.18 + thrust * 0.2 + this.scrape * 0.5;
      }
    });

    // trails
    const rightV = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const strength = clamp(this.speed / TUNING.maxSpeed, 0, 1.4) * (this.boosting ? 1.5 : 1);
    const wp = this.mesh.position.clone();
    const pL = wp.clone().addScaledVector(rightV, -1.1).addScaledVector(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), -1.5);
    const pR = wp.clone().addScaledVector(rightV, 1.1).addScaledVector(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), -1.5);
    this.trailL.update(pL, rightV, strength);
    this.trailR.update(pR, rightV, strength);
    const opacity = 0.12 + strength * 0.4;
    this.trailL.mat.opacity = opacity;
    this.trailR.mat.opacity = opacity;
    this.trailL.mat.color.setHex(this.boosting ? 0xdff6ff : this.color);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.scene.remove(this.trailL.mesh);
    this.scene.remove(this.trailR.mesh);
  }
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/* -------------------------------------------------------------------- AI ---- */

export class AIDriver {
  constructor(ship, track, { lane = 0, aggression = 1 } = {}) {
    this.ship = ship;
    this.track = track;
    this.lane = lane;
    this.aggression = aggression;
    this.laneTarget = lane;
    this.laneTimer = 1 + Math.random() * 2;
    this.rubber = 1;
  }

  update(dt, raceContext) {
    const ship = this.ship;
    const track = this.track;
    const N = track.N;

    // look ahead, further at speed
    const look = Math.round(14 + Math.abs(ship.speed) * 0.42);
    const aheadIdx = (ship.sampleIndex + look) % N;
    const ahead = track.samples[aheadIdx];

    // pick a racing line: hug the inside of the upcoming corner.
    // curv is 1/radius (positive = right-hand corner), lane t is +right.
    this.laneTimer -= dt;
    if (this.laneTimer <= 0) {
      this.laneTimer = 1.2 + Math.random() * 1.6;
      const c = ahead.curv;
      const inside = Math.sign(c) * Math.min(0.66, Math.abs(c) * 55);
      this.laneTarget = clamp(inside + (Math.random() - 0.5) * 0.22, -0.8, 0.8);
    }
    this.lane = lerp(this.lane, this.laneTarget, 1 - Math.exp(-2.6 * dt));

    const target = track.surfacePoint(aheadIdx, this.lane, new THREE.Vector3(), 0);
    const toTarget = target.clone().sub(ship.pos);
    toTarget.y = 0;
    const desiredYaw = Math.atan2(toTarget.x, toTarget.z);
    const err = wrapAngle(desiredYaw - ship.yaw);

    // err > 0 means the target yaw is counter-clockwise (to our left) => steer left
    const steer = clamp(-err * 3.0, -1, 1);

    // ---- corner speed: v = sqrt(a_lat / |curvature|), evaluated a few samples
    // ahead so the ship starts slowing before the apex, not at it.
    let tightest = 0;
    for (const k of [10, 22, 36, 52]) {
      const c = Math.abs(track.samples[(ship.sampleIndex + k) % N].curv);
      if (c > tightest) tightest = c;
    }
    const curvHere = Math.abs(track.samples[(ship.sampleIndex + 6) % N].curv);
    const cornerSpeed = tightest > 1e-5 ? Math.sqrt(TUNING.latAccel / tightest) : TUNING.maxSpeed;
    const baseSpeed =
      Math.min(TUNING.maxSpeed, cornerSpeed) * (0.92 + this.aggression * 0.1) * this.rubber;

    const throttle = ship.speed < baseSpeed ? 1 : ship.speed < baseSpeed * 1.1 ? 0.35 : 0.05;
    const brake = ship.speed > baseSpeed * 1.12 ? 0.9 : ship.speed > baseSpeed * 1.04 ? 0.4 : 0;

    // drift through committed corners (radius < ~110 m)
    const drift = curvHere > 0.009 && ship.speed > 48;

    // boost on straights when charged
    const boost = ship.boost > 0.4 && tightest < 0.0022 && ship.speed > 55;

    ship.update(
      dt,
      { steer, throttle, brake, drift, boost },
      raceContext?.elapsed ?? 0
    );

    // avoid stacking on other ships: small lateral nudge
    const rivals = raceContext?.ships;
    if (rivals) {
      for (const other of rivals) {
        if (other === ship) continue;
        const d = other.pos.distanceTo(ship.pos);
        if (d < 6.5) {
          const side = Math.sign(
            (other.pos.x - ship.pos.x) * Math.cos(ship.yaw) - (other.pos.z - ship.pos.z) * Math.sin(ship.yaw)
          );
          ship.pos.addScaledVector(new THREE.Vector3(Math.cos(ship.yaw), 0, -Math.sin(ship.yaw)), side * 3 * dt);
        }
      }
    }
  }
}
