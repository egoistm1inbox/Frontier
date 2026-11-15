// Rigid-body preview for the Fracture Editor's Simulate and Play modes.
// Small on purpose. It turns a fracture result into motion you can scrub, so a recipe can be judged by how it breaks.
// It is not the runtime destruction solver.
//
//   1. Energy shares. The impact energy left after paying for crack surface (2·Gc per m², see FractureEngine.budget)
//      is multiplied by the transfer fraction and split between pieces by cut priority squared. The transfer falls off
//      twice as fast as the cut density, so the small near-field cells take most of the energy and fly fastest, as real
//      debris does.
//      Pieces whose share is below the release energy stay held in the remaining body.
//   2. Bake. Semi-implicit Euler at 240 Hz (4 substeps per 60 Hz step). Impulse contacts against the ground plane use
//      each piece's 14 extreme points. Fragments collide with each other as bounding spheres; pairs that start out
//      overlapping are ignored until they first separate. Every step stores, per piece: centre (3),
//      rotation quaternion (4) and kinetic energy (1).
//   3. Sample. Cached steps are interpolated, so the timeline can scrub at any speed.

export const SIMULATION_DEFAULTS = { Duration: 4, Transfer: 0.4, Release: 5, Gravity: 9.81, Restitution: 0.3, Friction: 0.6, Collisions: true };
export const SIMULATION_LIMITS = { Duration: [1, 10], Transfer: [0, 1], Release: [0, 200], Gravity: [0, 30], Restitution: [0, 0.95], Friction: [0, 1.5] };
export const RATE = 60;
const SUBSTEPS = 4;
const STRIDE = 8; // px py pz qx qy qz qw kinetic
const MAX_SPEED = 40, MAX_SPIN = 40;

export function normalizeSimulation(input = {}) {
  const s = { ...SIMULATION_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const [k, [lo, hi]] of Object.entries(SIMULATION_LIMITS)) { const v = +s[k]; s[k] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : SIMULATION_DEFAULTS[k]; }
  s.Collisions = s.Collisions !== false;
  return s;
}

// ---------------------------------------------------------------------------------------------------- energy shares
// `overrides` maps piece id → 'held' | 'released' (per-fragment choices made in the inspector).
export function impactShares(result, simulation, overrides = new Map()) {
  const sim = normalizeSimulation(simulation), r = result.recipe, pieces = result.pieces, n = pieces.length;
  const spent = Math.min(r.Energy, result.plan.energy);
  const kinetic = Math.max(0, r.Energy - spent) * sim.Transfer;
  const weights = pieces.map((p) => p.priority * p.priority);
  const total = weights.reduce((a, w) => a + w, 0) || 1;
  const energy = new Float64Array(n), released = new Uint8Array(n);
  let releasedCount = 0, peak = 0, low = Infinity;
  for (let i = 0; i < n; i++) {
    energy[i] = (kinetic * weights[i]) / total;
    const o = overrides.get(pieces[i].id);
    released[i] = o === 'held' ? 0 : o === 'released' ? 1 : energy[i] >= sim.Release ? 1 : 0;
    releasedCount += released[i];
    peak = Math.max(peak, energy[i]); low = Math.min(low, energy[i]);
  }
  return { impact: r.Energy, spent, kinetic, energy, released, releasedCount, peak, low: n ? low : 0 };
}

// ---------------------------------------------------------------------------------------------------- vectors / quaternions
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a, fallback = [0, 1, 0]) => { const l = len(a); return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : fallback; };
function rotate(q, v) { // q = [x, y, z, w]
  const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
function spin(q, w, h) { // q += ½·(ω,0)·q·h, then renormalise
  const [x, y, z, s] = q, a = w[0] * h * 0.5, b = w[1] * h * 0.5, c = w[2] * h * 0.5;
  const nx = x + (a * s + b * z - c * y), ny = y + (b * s + c * x - a * z), nz = z + (c * s + a * y - b * x), ns = s + (-a * x - b * y - c * z);
  const l = Math.hypot(nx, ny, nz, ns) || 1;
  q[0] = nx / l; q[1] = ny / l; q[2] = nz / l; q[3] = ns / l;
}
function random(seed) { let a = seed >>> 0 || 1; return () => { a = (Math.imul(1664525, a) + 1013904223) >>> 0; return a / 4294967296; }; }

// 14 extreme points (6 axes + 8 diagonals) relative to the piece centre: enough to rest a convex piece on the ground.
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], ...[-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z])))];
function hullPoints(piece) {
  const P = piece.positions, c = piece.centre, out = [];
  for (const d of DIRS) {
    let best = -Infinity, bi = 0;
    for (let i = 0; i < P.length; i += 3) { const s = (P[i] - c[0]) * d[0] + (P[i + 1] - c[1]) * d[1] + (P[i + 2] - c[2]) * d[2]; if (s > best) { best = s; bi = i; } }
    const p = [P[bi] - c[0], P[bi + 1] - c[1], P[bi + 2] - c[2]];
    if (!out.some((q) => Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) < 1e-6)) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- bake
export function simulate(result, simulation, { overrides = new Map(), ground = result.source.bounds.lo[1] } = {}) {
  const t0 = performance.now();
  const sim = normalizeSimulation(simulation), pieces = result.pieces, n = pieces.length;
  const shares = impactShares(result, sim, overrides);
  const rnd = random(result.recipe.Seed * 7919 + 17);
  const B = result.source.bounds, impact = result.impact;
  // The push follows the impactor's travel direction when the fracture records one, else it goes into the object.
  const hit = result.travel ? unit(result.travel) : unit(B.centre.map((v, k) => v - impact[k]), [0, 0, -1]);

  const bodies = pieces.map((pc, i) => {
    const s = pc.bounds.size, m = Math.max(1e-6, pc.mass), inertia = Math.max(1e-9, (m * (s[0] * s[0] + s[1] * s[1] + s[2] * s[2])) / 18);
    const radius = Math.min(0.5 * Math.max(...s), Math.max(0.35 * Math.cbrt(Math.max(1e-12, s[0] * s[1] * s[2])), 0.25 * Math.min(...s.filter((v) => v > 1e-6), 1)));
    const b = { x: [...pc.centre], v: [0, 0, 0], q: [0, 0, 0, 1], w: [0, 0, 0], m, inv: shares.released[i] ? 1 / m : 0, inertia, invI: shares.released[i] ? 1 / inertia : 0, radius, hull: hullPoints(pc), still: 0, asleep: !shares.released[i] };
    if (shares.released[i]) {
      const E = shares.energy[i], radial = unit(pc.centre.map((v, k) => v - impact[k]), hit);
      const dir = unit([hit[0] * 0.55 + radial[0] * 0.85, hit[1] * 0.55 + radial[1] * 0.85 + 0.25, hit[2] * 0.55 + radial[2] * 0.85]);
      const speed = Math.min(MAX_SPEED, Math.sqrt((2 * 0.85 * E) / m));
      b.v = dir.map((d) => d * speed);
      const axis = unit(cross(dir, [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]));
      const omega = Math.min(MAX_SPIN, Math.sqrt((2 * 0.15 * E) / inertia)) * (0.4 + 0.6 * rnd());
      b.w = axis.map((a) => a * omega);
    }
    return b;
  });

  // Pairs that start out overlapping (neighbouring cells) are ignored until they first separate.
  const ignore = new Uint8Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = bodies[i], b = bodies[j], d = Math.hypot(a.x[0] - b.x[0], a.x[1] - b.x[1], a.x[2] - b.x[2]);
    if (d < a.radius + b.radius) ignore[i * n + j] = 1;
  }

  const steps = Math.round(sim.Duration * RATE) + 1, poses = new Float32Array(steps * n * STRIDE), totals = new Float32Array(steps), awakeAt = new Uint16Array(steps);
  const h = 1 / (RATE * SUBSTEPS), g = sim.Gravity, e = sim.Restitution, mu = sim.Friction;
  let settled = null;
  const write = (f) => {
    let sum = 0, awake = 0;
    for (let i = 0; i < n; i++) {
      const b = bodies[i], o = (f * n + i) * STRIDE;
      const ke = b.inv ? 0.5 * b.m * (b.v[0] ** 2 + b.v[1] ** 2 + b.v[2] ** 2) + 0.5 * b.inertia * (b.w[0] ** 2 + b.w[1] ** 2 + b.w[2] ** 2) : 0;
      poses[o] = b.x[0]; poses[o + 1] = b.x[1]; poses[o + 2] = b.x[2];
      poses[o + 3] = b.q[0]; poses[o + 4] = b.q[1]; poses[o + 5] = b.q[2]; poses[o + 6] = b.q[3]; poses[o + 7] = ke;
      sum += ke; if (!b.asleep) awake++;
    }
    totals[f] = sum;
    awakeAt[f] = awake;
    if (settled === null && f > 0 && awake === 0) settled = f / RATE;
  };
  write(0);

  for (let f = 1; f < steps; f++) {
    for (let s = 0; s < SUBSTEPS; s++) {
      for (const b of bodies) {
        if (!b.inv || b.asleep) continue;
        b.v[1] -= g * h;
        const damp = 1 - 0.02 * h, adamp = 1 - 0.08 * h;
        for (let k = 0; k < 3; k++) { b.v[k] *= damp; b.w[k] *= adamp; b.x[k] += b.v[k] * h; }
        spin(b.q, b.w, h);
        // Ground: impulses at the deepest few penetrating hull points.
        const contacts = [];
        for (const r of b.hull) { const rw = rotate(b.q, r), y = b.x[1] + rw[1]; if (y < ground) contacts.push([ground - y, rw]); }
        if (contacts.length) {
          contacts.sort((a, c) => c[0] - a[0]);
          const use = contacts.slice(0, 4), share = 1 / use.length;
          for (const [, rw] of use) {
            const vc = [b.v[0] + (b.w[1] * rw[2] - b.w[2] * rw[1]), b.v[1] + (b.w[2] * rw[0] - b.w[0] * rw[2]), b.v[2] + (b.w[0] * rw[1] - b.w[1] * rw[0])];
            if (vc[1] >= 0) continue;
            const rn = cross(rw, [0, 1, 0]), kn = b.inv + b.invI * (rn[0] ** 2 + rn[1] ** 2 + rn[2] ** 2);
            const jn = (-(1 + (vc[1] < -0.6 ? e : 0)) * vc[1] / kn) * share;
            b.v[1] += jn * b.inv;
            for (let k = 0; k < 3; k++) b.w[k] += rn[k] * jn * b.invI;
            const vt = [vc[0], 0, vc[2]], vtl = len(vt);
            if (vtl > 1e-6) {
              const t = [vt[0] / vtl, 0, vt[2] / vtl], rt = cross(rw, t), kt = b.inv + b.invI * (rt[0] ** 2 + rt[1] ** 2 + rt[2] ** 2);
              const jt = Math.min(mu * jn, (vtl / kt) * share);
              b.v[0] -= t[0] * jt * b.inv; b.v[2] -= t[2] * jt * b.inv;
              for (let k = 0; k < 3; k++) b.w[k] -= rt[k] * jt * b.invI;
            }
          }
          b.x[1] += contacts[0][0] * 0.8;
          for (let k = 0; k < 3; k++) b.w[k] *= 1 - 3 * h; // rolling resistance
        }
        // Sleep once slow for 0.3 s, resting on the ground or on other pieces. A throw passes its apex far faster.
        // Specific kinetic energy (J/kg), with a timer that decays rather than resets so contact jitter cannot keep a piece awake.
        const specific = 0.5 * (b.v[0] ** 2 + b.v[1] ** 2 + b.v[2] ** 2) + (0.5 * b.inertia * (b.w[0] ** 2 + b.w[1] ** 2 + b.w[2] ** 2)) / b.m;
        b.still = specific < 0.02 ? b.still + h : Math.max(0, b.still - 2 * h);
        if (b.still > 0.3) { b.asleep = true; b.v = [0, 0, 0]; b.w = [0, 0, 0]; }
      }
      if (sim.Collisions) collide(bodies, ignore, n);
    }
    write(f);
  }
  return { rate: RATE, steps, n, duration: (steps - 1) / RATE, poses, totals, awake: awakeAt, shares, settled, ground, ms: performance.now() - t0, simulation: sim };
}

function collide(bodies, ignore, n) {
  for (let i = 0; i < n; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < n; j++) {
      const b = bodies[j];
      // Sleeping pieces act as static until a real impact wakes them, so neighbours cannot shove them underground.
      const ia = a.asleep ? 0 : a.inv, ib = b.asleep ? 0 : b.inv;
      if (!ia && !ib) continue;
      const dx = b.x[0] - a.x[0], dy = b.x[1] - a.x[1], dz = b.x[2] - a.x[2], rr = a.radius + b.radius, d2 = dx * dx + dy * dy + dz * dz;
      const key = i * n + j;
      if (ignore[key]) { if (d2 > rr * rr * 1.1) ignore[key] = 0; continue; }
      if (d2 >= rr * rr || d2 < 1e-12) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d, wsum = ia + ib;
      const push = (rr - d) / wsum;
      a.x[0] -= nx * push * ia; a.x[1] -= ny * push * ia; a.x[2] -= nz * push * ia;
      b.x[0] += nx * push * ib; b.x[1] += ny * push * ib; b.x[2] += nz * push * ib;
      const vn = (b.v[0] - a.v[0]) * nx + (b.v[1] - a.v[1]) * ny + (b.v[2] - a.v[2]) * nz;
      if (vn >= 0) continue;
      const j2 = (-(1 + 0.15) * vn) / wsum;
      a.v[0] -= nx * j2 * ia; a.v[1] -= ny * j2 * ia; a.v[2] -= nz * j2 * ia;
      b.v[0] += nx * j2 * ib; b.v[1] += ny * j2 * ib; b.v[2] += nz * j2 * ib;
      if (Math.abs(vn) > 0.6) { if (a.inv) { a.asleep = false; a.still = 0; } if (b.inv) { b.asleep = false; b.still = 0; } }
    }
  }
}

// ---------------------------------------------------------------------------------------------------- sample
// Interpolated pose and energy of piece i at time t (seconds).
export function sample(cache, t, i, out = { x: [0, 0, 0], q: [0, 0, 0, 1], kinetic: 0 }) {
  const f = Math.max(0, Math.min(cache.steps - 1, t * cache.rate)), f0 = Math.floor(f), f1 = Math.min(cache.steps - 1, f0 + 1), k = f - f0;
  const D = cache.poses, a = (f0 * cache.n + i) * STRIDE, b = (f1 * cache.n + i) * STRIDE;
  for (let c = 0; c < 3; c++) out.x[c] = D[a + c] + (D[b + c] - D[a + c]) * k;
  let dotq = 0; for (let c = 0; c < 4; c++) dotq += D[a + 3 + c] * D[b + 3 + c];
  const sgn = dotq < 0 ? -1 : 1;
  let l = 0; for (let c = 0; c < 4; c++) { out.q[c] = D[a + 3 + c] + (sgn * D[b + 3 + c] - D[a + 3 + c]) * k; l += out.q[c] ** 2; }
  l = Math.sqrt(l) || 1; for (let c = 0; c < 4; c++) out.q[c] /= l;
  out.kinetic = D[a + 7] + (D[b + 7] - D[a + 7]) * k;
  return out;
}
export function totalAt(cache, t) { const f = Math.max(0, Math.min(cache.steps - 1, t * cache.rate)), f0 = Math.floor(f), f1 = Math.min(cache.steps - 1, f0 + 1); return cache.totals[f0] + (cache.totals[f1] - cache.totals[f0]) * (f - f0); }

// Column-major model matrix: translate to the simulated centre, rotate, translate back from the rest centre.
export function poseMatrix(rest, x, q, out = new Float32Array(16)) {
  const [qx, qy, qz, qw] = q;
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz;
  const m = [1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy)];
  out[0] = m[0]; out[1] = m[1]; out[2] = m[2]; out[3] = 0;
  out[4] = m[3]; out[5] = m[4]; out[6] = m[5]; out[7] = 0;
  out[8] = m[6]; out[9] = m[7]; out[10] = m[8]; out[11] = 0;
  out[12] = x[0] - (m[0] * rest[0] + m[3] * rest[1] + m[6] * rest[2]);
  out[13] = x[1] - (m[1] * rest[0] + m[4] * rest[1] + m[7] * rest[2]);
  out[14] = x[2] - (m[2] * rest[0] + m[5] * rest[1] + m[8] * rest[2]);
  out[15] = 1;
  return out;
}
