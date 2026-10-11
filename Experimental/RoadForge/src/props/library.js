// RoadForge — prop library.
//
// Every prop is built once into a shared mesh atlas and drawn with instancing.
// All of them are quad-topology solids built at real-world dimensions:
// columns taper, signal heads have backboards and visors, vehicles have
// glazing and wheels. Nothing here is a billboard or a flat card.

import { MeshBuilder, box, roundedBox, revolve, fanCap } from '../core/mesh.js';
import { MAT } from '../road/materials.js';

/* ---------------------------------------------------------------- tools */

/** Vertical lathe: profile [[r,y],...] placed at (x,z). */
function lathe(mb, profile, seg, x, z, rotY = 0, { capTop = true, capBottom = false } = {}) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  return revolve(mb, profile, seg, (p) => [x + p[0] * c + p[2] * s, p[1], z - p[0] * s + p[2] * c],
    { capTop, capBottom, uvScale: 0.6 });
}

/** Cylinder between two points in 3D (used for mast arms, railings, axles). */
function tube(mb, a, b, r0, r1, seg = 8) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(d[0], d[1], d[2]) || 1;
  const f = [d[0] / L, d[1] / L, d[2] / L];
  let up = Math.abs(f[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const rt = norm(cross(f, up));
  const u2 = cross(rt, f);
  const ringA = [], ringB = [];
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    const cx = Math.cos(t), sy = Math.sin(t);
    ringA.push(mb.vert([
      a[0] + rt[0] * cx * r0 + u2[0] * sy * r0,
      a[1] + rt[1] * cx * r0 + u2[1] * sy * r0,
      a[2] + rt[2] * cx * r0 + u2[2] * sy * r0,
    ], [i / seg, 0], [0, 0, 0, 0]));
    ringB.push(mb.vert([
      b[0] + rt[0] * cx * r1 + u2[0] * sy * r1,
      b[1] + rt[1] * cx * r1 + u2[1] * sy * r1,
      b[2] + rt[2] * cx * r1 + u2[2] * sy * r1,
    ], [i / seg, L], [0, 0, 0, 0]));
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    mb.quad(ringA[i], ringA[j], ringB[j], ringB[i]);
  }
  return { ringA, ringB };
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Wheel with a tyre and a hub, axis along X. */
function wheel(mb, x, y, z, r, w) {
  mb.setCtx(MAT.RUBBER, 0, 0, 0);
  const seg = 12;
  const rings = [];
  for (const [ox, rr] of [[-w / 2, r * 0.82], [-w / 2 + 0.02, r], [w / 2 - 0.02, r], [w / 2, r * 0.82]]) {
    const ring = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      ring.push(mb.vert([x + ox, y + Math.sin(a) * rr, z + Math.cos(a) * rr], [i / seg, ox], [0, 0, 0, 0]));
    }
    rings.push(ring);
  }
  for (let p = 0; p < rings.length - 1; p++) {
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      mb.quad(rings[p][i], rings[p][j], rings[p + 1][j], rings[p + 1][i]);
    }
  }
  mb.setCtx(MAT.ALU, 0, 0, 0);
  const hubL = [], hubR = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    hubL.push(mb.vert([x - w / 2 + 0.01, y + Math.sin(a) * r * 0.58, z + Math.cos(a) * r * 0.58], [0, 0], [0, 0, 0, 0]));
    hubR.push(mb.vert([x + w / 2 - 0.01, y + Math.sin(a) * r * 0.58, z + Math.cos(a) * r * 0.58], [1, 0], [0, 0, 0, 0]));
  }
  fanCap(mb, hubL, [x - w / 2 + 0.01, y, z], true);
  fanCap(mb, hubR, [x + w / 2 - 0.01, y, z], false);
}

/* ---------------------------------------------------------------- props */
// Local axes: +Z forward (along the kerb), +X right, origin at ground level.

const BUILDERS = {

  /* --- lighting --------------------------------------------------------- */
  lamp_street(mb) {
    mb.setCtx(MAT.POLE, 0, 0, 0);
    lathe(mb, [[0.14, 0], [0.14, 0.42], [0.105, 0.52], [0.098, 4.2], [0.078, 8.1]], 10, 0, 0, 0, { capTop: false });
    // swan-neck arm
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      pts.push([Math.sin(t * Math.PI * 0.5) * 1.55, 8.1 + Math.sin(t * Math.PI * 0.42) * 0.62, 0]);
    }
    for (let i = 0; i < pts.length - 1; i++) tube(mb, pts[i], pts[i + 1], 0.07, 0.065, 8);
    // luminaire
    const h = pts[pts.length - 1];
    mb.setCtx(MAT.ALU, 0, 0, 0);
    box(mb, [h[0] + 0.33, h[1] - 0.06, 0], [0.92, 0.16, 0.34]);
    box(mb, [h[0] + 0.33, h[1] - 0.17, 0], [0.84, 0.08, 0.28]);
    mb.setCtx(MAT.LAMP, 0, 0, 0);
    box(mb, [h[0] + 0.33, h[1] - 0.215, 0], [0.74, 0.03, 0.22]);
  },

  lamp_motorway(mb) {
    mb.setCtx(MAT.POLE, 0, 0, 0);
    lathe(mb, [[0.22, 0], [0.22, 0.5], [0.17, 0.62], [0.15, 6], [0.11, 12.2]], 12, 0, 0, 0, { capTop: false });
    for (const sgn of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 5; i++) {
        const t = i / 5;
        pts.push([sgn * t * 2.1, 12.2 + Math.sin(t * Math.PI * 0.4) * 0.5, 0]);
      }
      for (let i = 0; i < pts.length - 1; i++) tube(mb, pts[i], pts[i + 1], 0.08, 0.07, 8);
      const h = pts[pts.length - 1];
      mb.setCtx(MAT.ALU, 0, 0, 0);
      box(mb, [h[0] + sgn * 0.3, h[1] - 0.07, 0], [0.95, 0.17, 0.36]);
      mb.setCtx(MAT.LAMP, 0, 0, 0);
      box(mb, [h[0] + sgn * 0.3, h[1] - 0.17, 0], [0.8, 0.03, 0.26]);
      mb.setCtx(MAT.POLE, 0, 0, 0);
    }
  },

  lamp_heritage(mb) {
    mb.setCtx(MAT.POLE, 0, 0, 0);
    lathe(mb, [[0.19, 0], [0.19, 0.3], [0.13, 0.42], [0.1, 0.55], [0.075, 3.1], [0.09, 3.3], [0.06, 3.45]], 12, 0, 0, 0, { capTop: false });
    mb.setCtx(MAT.ALU, 0, 0, 0);
    lathe(mb, [[0.06, 3.45], [0.26, 3.6], [0.24, 4.25], [0.1, 4.45], [0.06, 4.52]], 8, 0, 0, 0, { capTop: true });
    mb.setCtx(MAT.LAMP, 0, 0, 0);
    lathe(mb, [[0.17, 3.68], [0.17, 4.18]], 8, 0, 0, 0, { capTop: false, capBottom: false });
  },

  /* --- signals ---------------------------------------------------------- */
  signal_mast(mb) {
    mb.setCtx(MAT.POLE, 0, 0, 0);
    lathe(mb, [[0.16, 0], [0.16, 0.35], [0.12, 0.45], [0.115, 5.6]], 10, 0, 0, 0, { capTop: false });
    const arm = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      arm.push([t * 4.6, 5.6 + Math.sin(t * Math.PI * 0.35) * 0.35, 0]);
    }
    for (let i = 0; i < arm.length - 1; i++) tube(mb, arm[i], arm[i + 1], 0.085, 0.07, 8);
    // primary head on the arm + secondary head on the post
    signalHead(mb, [3.3, 4.75, 0]);
    signalHead(mb, [0.33, 3.3, 0]);
    // controller cabinet
    mb.setCtx(MAT.ALU, 0, 0, 0);
    box(mb, [-0.55, 0.62, 0.0], [0.42, 1.2, 0.58]);
  },

  signal_post(mb) {
    mb.setCtx(MAT.POLE, 0, 0, 0);
    lathe(mb, [[0.14, 0], [0.14, 0.3], [0.1, 0.4], [0.095, 3.4]], 10, 0, 0, 0, { capTop: false });
    signalHead(mb, [0.3, 2.55, 0]);
  },

  signal_ped(mb) {
    mb.setCtx(MAT.POLE, 0, 0, 0);
    lathe(mb, [[0.12, 0], [0.12, 0.28], [0.085, 0.38], [0.08, 2.65]], 8, 0, 0, 0, { capTop: false });
    mb.setCtx(MAT.PLASTIC, 0, 0, 0);
    box(mb, [0.17, 2.2, 0], [0.26, 0.5, 0.3]);
    mb.setCtx(MAT.LIGHT_R, 0, 0, 0);
    box(mb, [0.305, 2.33, 0], [0.02, 0.17, 0.18]);
    mb.setCtx(MAT.LIGHT_G, 0, 0, 0);
    box(mb, [0.305, 2.1, 0], [0.02, 0.17, 0.18]);
    mb.setCtx(MAT.ALU, 0, 0, 0);
    box(mb, [0.17, 1.15, 0], [0.16, 0.2, 0.14]);
  },

  /* --- bollards (four designs) ------------------------------------------ */
  bollard_steel(mb) {
    mb.setCtx(MAT.STEEL, 0, 0, 0);
    lathe(mb, [[0.098, 0], [0.098, 0.84], [0.09, 0.9], [0.055, 0.98], [0.0, 1.0]], 12, 0, 0);
    mb.setCtx(MAT.PAINT_W, 0, 0, 0);
    lathe(mb, [[0.1005, 0.66], [0.1005, 0.78]], 12, 0, 0, 0, { capTop: false, capBottom: false });
  },
  bollard_granite(mb) {
    mb.setCtx(MAT.CURB, 0, 0, 0);
    box(mb, [0, 0.46, 0], [0.26, 0.92, 0.26]);
    box(mb, [0, 0.95, 0], [0.22, 0.08, 0.22]);
  },
  bollard_bell(mb) {
    mb.setCtx(MAT.CONCRETE, 0, 0, 0);
    lathe(mb, [[0.31, 0], [0.3, 0.1], [0.22, 0.38], [0.2, 0.62], [0.22, 0.74], [0.18, 0.8], [0, 0.82]], 14, 0, 0);
  },
  bollard_lit(mb) {
    mb.setCtx(MAT.ALU, 0, 0, 0);
    lathe(mb, [[0.11, 0], [0.11, 0.18], [0.085, 0.24], [0.085, 0.72]], 10, 0, 0, 0, { capTop: false });
    mb.setCtx(MAT.LAMP, 0, 0, 0);
    lathe(mb, [[0.085, 0.72], [0.085, 1.02]], 10, 0, 0, 0, { capTop: false, capBottom: false });
    mb.setCtx(MAT.ALU, 0, 0, 0);
    lathe(mb, [[0.088, 1.02], [0.088, 1.08], [0.05, 1.12], [0, 1.13]], 10, 0, 0);
  },

  /* --- signs & billboards ----------------------------------------------- */
  billboard(mb) {
    mb.setCtx(MAT.POLE, 0, 0, 0);
    for (const x of [-2.1, 2.1]) lathe(mb, [[0.19, 0], [0.19, 0.3], [0.155, 0.45], [0.145, 5.0]], 10, x, 0, 0, { capTop: false });
    mb.setCtx(MAT.STEEL, 0, 0, 0);
    box(mb, [0, 5.05, 0], [5.4, 0.16, 0.2]);
    box(mb, [0, 7.95, 0], [5.4, 0.16, 0.2]);
    for (const x of [-2.1, 0, 2.1]) box(mb, [x, 6.5, -0.12], [0.12, 2.9, 0.1]);
    mb.setCtx(MAT.SIGN, 0, 0, 0);
    box(mb, [0, 6.5, 0.07], [6.2, 3.1, 0.12]);
    mb.setCtx(MAT.ALU, 0, 0, 0);
    box(mb, [0, 8.12, 0.42], [5.0, 0.1, 0.5]);
    mb.setCtx(MAT.LAMP, 0, 0, 0);
    for (const x of [-1.7, 0, 1.7]) box(mb, [x, 8.02, 0.5], [0.5, 0.11, 0.2]);
  },

  sign_round(mb) {
    mb.setCtx(MAT.POLE, 0, 0, 0);
    lathe(mb, [[0.045, 0], [0.045, 2.2]], 8, 0, 0, 0, { capTop: true });
    mb.setCtx(MAT.SIGN, 0, 0, 0);
    discZ(mb, 0, 2.45, 0.03, 0.31, 0.05, 16);
    mb.setCtx(MAT.PAINT_W, 0, 0, 0);
    discZ(mb, 0, 2.45, 0.062, 0.24, 0.006, 16);
  },

  sign_board(mb) {
    mb.setCtx(MAT.POLE, 0, 0, 0);
    for (const x of [-0.42, 0.42]) lathe(mb, [[0.05, 0], [0.05, 2.5]], 8, x, 0);
    mb.setCtx(MAT.SIGN, 0, 0, 0);
    box(mb, [0, 2.1, 0.03], [1.5, 0.95, 0.07]);
  },

  /* --- street furniture --------------------------------------------------*/
  bench(mb) {
    mb.setCtx(MAT.STEEL, 0, 0, 0);
    for (const z of [-0.72, 0.72]) {
      box(mb, [-0.22, 0.2, z], [0.08, 0.4, 0.08]);
      box(mb, [0.22, 0.2, z], [0.08, 0.4, 0.08]);
      box(mb, [0, 0.42, z], [0.62, 0.07, 0.08]);
    }
    mb.setCtx(MAT.SLEEPER, 0, 0, 0);
    for (let i = 0; i < 4; i++) box(mb, [-0.24 + i * 0.16, 0.47, 0], [0.13, 0.05, 1.7]);
    for (let i = 0; i < 3; i++) box(mb, [0.3, 0.6 + i * 0.16, 0], [0.05, 0.13, 1.7]);
  },

  bin(mb) {
    mb.setCtx(MAT.STEEL, 0, 0, 0);
    lathe(mb, [[0.22, 0.06], [0.26, 0.2], [0.26, 0.86], [0.28, 0.9], [0.26, 0.95]], 12, 0, 0, 0, { capTop: false });
    lathe(mb, [[0.26, 0.95], [0.2, 1.02], [0.1, 1.04]], 12, 0, 0);
    lathe(mb, [[0.06, 0], [0.06, 0.06]], 8, 0, 0);
  },

  tree(mb) {
    mb.setCtx(MAT.SLEEPER, 0, 0, 0);
    lathe(mb, [[0.26, 0], [0.19, 0.5], [0.16, 1.6], [0.13, 2.6], [0.1, 3.4]], 8, 0, 0, 0, { capTop: false });
    mb.setCtx(MAT.GRASS, 0, 0, 0);
    // three overlapping canopy lobes, each a quad-ring sphere
    for (const [cx, cy, cz, r] of [[0, 4.3, 0, 1.85], [0.95, 3.6, 0.5, 1.25], [-0.8, 3.75, -0.55, 1.15]]) {
      sphere(mb, cx, cy, cz, r, 10, 7);
    }
  },

  planter(mb) {
    mb.setCtx(MAT.CONCRETE, 0, 0, 0);
    box(mb, [0, 0.3, 0], [1.3, 0.6, 1.3]);
    mb.setCtx(MAT.DIRT, 0, 0, 0);
    box(mb, [0, 0.61, 0], [1.1, 0.04, 1.1]);
    mb.setCtx(MAT.GRASS, 0, 0, 0);
    sphere(mb, 0, 0.95, 0, 0.55, 8, 5);
  },

  meter(mb) {
    mb.setCtx(MAT.POLE, 0, 0, 0);
    lathe(mb, [[0.05, 0], [0.05, 1.05]], 8, 0, 0);
    mb.setCtx(MAT.ALU, 0, 0, 0);
    box(mb, [0, 1.25, 0], [0.22, 0.42, 0.16]);
    mb.setCtx(MAT.GLASS, 0, 0, 0);
    box(mb, [0, 1.33, 0.085], [0.15, 0.16, 0.02]);
  },

  hydrant(mb) {
    mb.setCtx(MAT.PLASTIC, 0, 0, 0);
    lathe(mb, [[0.17, 0], [0.17, 0.1], [0.12, 0.16], [0.12, 0.62], [0.16, 0.68], [0.1, 0.78], [0.04, 0.84]], 10, 0, 0);
    box(mb, [0, 0.45, 0], [0.42, 0.14, 0.14]);
  },

  /* --- works ------------------------------------------------------------ */
  cone(mb) {
    mb.setCtx(MAT.PLASTIC, 0, 0, 0);
    box(mb, [0, 0.025, 0], [0.38, 0.05, 0.38]);
    lathe(mb, [[0.16, 0.05], [0.13, 0.26], [0.085, 0.52], [0.05, 0.72]], 10, 0, 0, 0, { capTop: true });
    mb.setCtx(MAT.PAINT_W, 0, 0, 0);
    lathe(mb, [[0.113, 0.3], [0.1, 0.42]], 10, 0, 0, 0, { capTop: false, capBottom: false });
  },

  barrier_jersey(mb) {
    // true New-Jersey section, extruded 2.4 m
    mb.setCtx(MAT.CONCRETE, 0, 0, 0);
    const sec = [[-0.3, 0], [-0.3, 0.075], [-0.165, 0.33], [-0.095, 0.81], [0.095, 0.81], [0.165, 0.33], [0.3, 0.075], [0.3, 0]];
    extrudeZ(mb, sec, -1.2, 1.2, true);
  },

  barrier_fence(mb) {
    mb.setCtx(MAT.STEEL, 0, 0, 0);
    for (const z of [-1.1, 1.1]) {
      box(mb, [0, 0.07, z], [0.5, 0.14, 0.4]);
      box(mb, [0, 1.0, z], [0.06, 1.9, 0.06]);
    }
    box(mb, [0, 1.9, 0], [0.05, 0.05, 2.3]);
    box(mb, [0, 0.2, 0], [0.05, 0.05, 2.3]);
    mb.setCtx(MAT.ALU, 0, 0, 0);
    for (let i = 0; i < 9; i++) box(mb, [0, 1.05, -1.0 + i * 0.25], [0.02, 1.7, 0.03]);
  },

  works_board(mb) {
    mb.setCtx(MAT.POLE, 0, 0, 0);
    for (const z of [-0.5, 0.5]) box(mb, [0, 0.55, z], [0.07, 1.1, 0.07]);
    mb.setCtx(MAT.SIGN, 0, 0, 0);
    box(mb, [0, 1.45, 0], [0.08, 0.9, 1.3]);
    mb.setCtx(MAT.LIGHT_A, 0, 0, 0);
    box(mb, [0.06, 2.0, 0], [0.06, 0.12, 0.12]);
  },

  site_hut(mb) {
    mb.setCtx(MAT.TARP, 0, 0, 0);
    box(mb, [0, 1.25, 0], [2.4, 2.5, 6.0]);
    mb.setCtx(MAT.ALU, 0, 0, 0);
    box(mb, [0, 2.55, 0], [2.5, 0.12, 6.1]);
    box(mb, [0, 0.07, 0], [2.5, 0.14, 6.1]);
    mb.setCtx(MAT.GLASS, 0, 0, 0);
    for (const z of [-1.6, 0.4]) box(mb, [1.22, 1.6, z], [0.04, 0.7, 1.1]);
  },

  pipe_stack(mb) {
    mb.setCtx(MAT.PLASTIC, 0, 0, 0);
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 3 - r; i++) {
        const x = (i - (2 - r) / 2) * 0.46;
        const y = 0.23 + r * 0.4;
        tube(mb, [x, y, -1.3], [x, y, 1.3], 0.21, 0.21, 10);
        tube(mb, [x, y, -1.3], [x, y, 1.3], 0.16, 0.16, 10);
      }
    }
  },

  /* --- guard furniture ---------------------------------------------------*/
  guard_post(mb) {
    mb.setCtx(MAT.STEEL, 0, 0, 0);
    box(mb, [0, 0.38, 0], [0.12, 0.76, 0.16]);
    box(mb, [0, 0.72, 0], [0.2, 0.16, 0.2]);
  },

  /* --- vehicles ----------------------------------------------------------*/
  car_sedan(mb) { carBody(mb, 4.52, 1.81, 1.44, 'sedan'); },
  car_hatch(mb) { carBody(mb, 3.98, 1.76, 1.52, 'hatch'); },
  car_suv(mb) { carBody(mb, 4.74, 1.92, 1.74, 'suv'); },
  van(mb) { carBody(mb, 5.4, 2.0, 2.3, 'van'); },

  bus(mb) {
    const L = 11.6, W = 2.55, H = 3.05;
    mb.setCtx(MAT.TRAIN, 0, 0, 0);
    roundedBox(mb, [0, H / 2 + 0.35, 0], [W, H, L], 0.3, 3);
    mb.setCtx(MAT.GLASS, 0, 0, 0);
    box(mb, [0, 1.95, L / 2 - 0.08], [W - 0.3, 1.25, 0.1]);
    box(mb, [0, 1.95, -L / 2 + 0.08], [W - 0.3, 1.1, 0.1]);
    for (const sgn of [-1, 1]) box(mb, [sgn * (W / 2 - 0.04), 2.0, 0.3], [0.08, 1.1, L - 2.2]);
    mb.setCtx(MAT.TRAIN_DARK, 0, 0, 0);
    box(mb, [0, H + 0.42, -0.6], [W - 0.25, 0.22, 4.2]);
    for (const [z, s] of [[L / 2 - 0.05, 1], [-L / 2 + 0.05, -1]]) {
      mb.setCtx(s > 0 ? MAT.LIGHT_A : MAT.LIGHT_R, 0, 0, 0);
      for (const sgn of [-1, 1]) box(mb, [sgn * 0.92, 0.95, z], [0.4, 0.22, 0.07]);
    }
    for (const z of [L / 2 - 2.3, -L / 2 + 2.6]) {
      wheel(mb, -W / 2 + 0.18, 0.52, z, 0.52, 0.3);
      wheel(mb, W / 2 - 0.18, 0.52, z, 0.52, 0.3);
    }
  },

  truck(mb) {
    const W = 2.5;
    mb.setCtx(MAT.TRAIN, 0, 0, 0);
    roundedBox(mb, [0, 1.65, 2.6], [W, 2.4, 2.4], 0.25, 3);
    mb.setCtx(MAT.GLASS, 0, 0, 0);
    box(mb, [0, 2.1, 3.78], [W - 0.4, 1.0, 0.1]);
    mb.setCtx(MAT.TARP, 0, 0, 0);
    box(mb, [0, 2.0, -1.9], [W, 2.6, 6.4]);
    mb.setCtx(MAT.STEEL, 0, 0, 0);
    box(mb, [0, 0.62, -1.0], [W - 0.3, 0.3, 8.6]);
    mb.setCtx(MAT.LIGHT_A, 0, 0, 0);
    for (const sgn of [-1, 1]) box(mb, [sgn * 0.95, 0.95, 3.82], [0.36, 0.2, 0.06]);
    wheel(mb, -W / 2 + 0.16, 0.55, 2.9, 0.55, 0.28);
    wheel(mb, W / 2 - 0.16, 0.55, 2.9, 0.55, 0.28);
    for (const z of [-2.4, -3.75]) {
      wheel(mb, -W / 2 + 0.16, 0.55, z, 0.55, 0.3);
      wheel(mb, W / 2 - 0.16, 0.55, z, 0.55, 0.3);
    }
  },

  /* --- rolling stock -----------------------------------------------------*/
  train_loco(mb) { railCar(mb, 19.5, 2.9, 3.5, true); },
  train_coach(mb) { railCar(mb, 19.5, 2.9, 3.5, false); },
};

/* --------------------------------------------------------------- shapes */

function sphere(mb, cx, cy, cz, r, seg, rings) {
  const grid = [];
  for (let j = 0; j <= rings; j++) {
    const v = (j / rings) * Math.PI;
    const row = [];
    for (let i = 0; i < seg; i++) {
      const u = (i / seg) * Math.PI * 2;
      const n = [Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u)];
      const wob = 1 + Math.sin(u * 3 + v * 5) * 0.08;
      row.push(mb.vert([cx + n[0] * r * wob, cy + n[1] * r * wob * 0.92, cz + n[2] * r * wob],
        [i / seg, j / rings], [0, 0, 0, 0]));
    }
    grid.push(row);
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const i2 = (i + 1) % seg;
      mb.quad(grid[j][i], grid[j][i2], grid[j + 1][i2], grid[j + 1][i]);
    }
  }
}

/** Disc/short cylinder whose axis is +Z (sign faces, wheels on their side). */
function discZ(mb, cx, cy, cz, r, thick, seg) {
  const front = [], back = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    back.push(mb.vert([x, y, cz - thick / 2], [i / seg, 0], [0, 0, 0, 0]));
    front.push(mb.vert([x, y, cz + thick / 2], [i / seg, 1], [0, 0, 0, 0]));
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    mb.quad(back[i], back[j], front[j], front[i]);
  }
  fanCap(mb, front, [cx, cy, cz + thick / 2], false);
  fanCap(mb, back, [cx, cy, cz - thick / 2], true);
}

/** Extrude a 2D section ([x,y]) along Z. */
function extrudeZ(mb, sec, z0, z1, cap) {
  const A = sec.map((p) => mb.vert([p[0], p[1], z0], [p[0], p[1]], [0, 0, 0, 0]));
  const B = sec.map((p) => mb.vert([p[0], p[1], z1], [p[0], p[1]], [0, 0, 0, 0]));
  for (let i = 0; i < sec.length - 1; i++) mb.quad(A[i], A[i + 1], B[i + 1], B[i]);
  if (cap) {
    for (let i = 1; i < sec.length - 1; i++) {
      mb.tri(A[0], A[i + 1], A[i]);
      mb.tri(B[0], B[i], B[i + 1]);
    }
  }
}

function signalHead(mb, at) {
  const [x, y, z] = at;
  mb.setCtx(MAT.ALU, 0, 0, 0);
  box(mb, [x, y + 0.05, z], [0.4, 1.12, 0.3]);            // body
  box(mb, [x, y + 0.05, z - 0.2], [0.56, 1.3, 0.04]);     // backboard
  for (let i = 0; i < 3; i++) {
    const ly = y + 0.41 - i * 0.36;
    box(mb, [x, ly + 0.11, z + 0.2], [0.34, 0.1, 0.22]);  // visor
    mb.setCtx([MAT.LIGHT_R, MAT.LIGHT_A, MAT.LIGHT_G][i], 0, 0, 0);
    box(mb, [x, ly, z + 0.17], [0.26, 0.26, 0.06]);
    mb.setCtx(MAT.ALU, 0, 0, 0);
  }
}

function carBody(mb, L, W, H, kind) {
  const hood = kind === 'van' ? 0.9 : kind === 'suv' ? 1.25 : 1.15;
  const cabinL = kind === 'van' ? L * 0.72 : L * 0.46;
  const beltY = kind === 'van' ? H * 0.52 : H * 0.55;
  mb.setCtx(MAT.TRAIN, 0, 0, 0);
  // lower body
  roundedBox(mb, [0, 0.33 + beltY / 2, 0], [W, beltY, L], 0.28, 3);
  // cabin / greenhouse
  const cabZ = kind === 'van' ? -L * 0.06 : -L * 0.04;
  roundedBox(mb, [0, 0.33 + beltY + (H - beltY) / 2 - 0.03, cabZ],
    [W - 0.22, H - beltY, cabinL], 0.3, 3);
  // glazing
  mb.setCtx(MAT.GLASS, 0, 0, 0);
  const gy = 0.33 + beltY + (H - beltY) * 0.5 - 0.04;
  box(mb, [0, gy, cabZ + cabinL / 2 - 0.08], [W - 0.42, (H - beltY) * 0.72, 0.06], 0);
  box(mb, [0, gy, cabZ - cabinL / 2 + 0.08], [W - 0.42, (H - beltY) * 0.66, 0.06], 0);
  for (const sgn of [-1, 1]) {
    box(mb, [sgn * (W / 2 - 0.13), gy, cabZ], [0.05, (H - beltY) * 0.6, cabinL - 0.5]);
  }
  // lights
  mb.setCtx(MAT.LIGHT_A, 0, 0, 0);
  for (const sgn of [-1, 1]) box(mb, [sgn * (W * 0.32), 0.33 + beltY * 0.62, L / 2 - 0.04], [W * 0.26, 0.14, 0.07]);
  mb.setCtx(MAT.LIGHT_R, 0, 0, 0);
  for (const sgn of [-1, 1]) box(mb, [sgn * (W * 0.32), 0.33 + beltY * 0.66, -L / 2 + 0.04], [W * 0.24, 0.13, 0.07]);
  // mirrors + trim
  mb.setCtx(MAT.TRAIN_DARK, 0, 0, 0);
  for (const sgn of [-1, 1]) box(mb, [sgn * (W / 2 + 0.03), gy - 0.02, cabZ + cabinL / 2 - 0.25], [0.18, 0.1, 0.12]);
  box(mb, [0, 0.3, 0], [W + 0.02, 0.12, L - 0.9]);
  void hood;
  // wheels
  const wr = kind === 'van' || kind === 'suv' ? 0.37 : 0.33;
  for (const z of [L * 0.3, -L * 0.3]) {
    wheel(mb, -W / 2 + 0.11, wr, z, wr, 0.22);
    wheel(mb, W / 2 - 0.11, wr, z, wr, 0.22);
  }
}

function railCar(mb, L, W, H, loco) {
  mb.setCtx(loco ? MAT.TRAIN_DARK : MAT.TRAIN, 0, 0, 0);
  roundedBox(mb, [0, 1.05 + H / 2, 0], [W, H, L], 0.45, 4);
  mb.setCtx(MAT.GLASS, 0, 0, 0);
  const wy = 1.05 + H * 0.62;
  for (const sgn of [-1, 1]) {
    if (loco) {
      box(mb, [sgn * (W / 2 - 0.05), wy + 0.2, L / 2 - 1.6], [0.06, 0.8, 2.0]);
    } else {
      for (let i = 0; i < 5; i++) {
        box(mb, [sgn * (W / 2 - 0.05), wy, -L / 2 + 2.4 + i * 3.4], [0.06, 1.0, 2.3]);
      }
    }
  }
  box(mb, [0, wy + 0.25, L / 2 - 0.1], [W - 0.5, 1.0, 0.1]);
  box(mb, [0, wy + 0.25, -L / 2 + 0.1], [W - 0.5, 1.0, 0.1]);
  mb.setCtx(MAT.TRAIN_DARK, 0, 0, 0);
  box(mb, [0, 0.95, 0], [W - 0.15, 0.3, L - 1.2]);
  if (loco) {
    mb.setCtx(MAT.LIGHT_A, 0, 0, 0);
    for (const sgn of [-1, 1]) box(mb, [sgn * 0.85, 1.5, L / 2 - 0.02], [0.3, 0.26, 0.06]);
    mb.setCtx(MAT.STEEL, 0, 0, 0);
    box(mb, [0, H + 1.2, -1.5], [1.6, 0.3, 3.0]);
  }
  // bogies
  mb.setCtx(MAT.RUST, 0, 0, 0);
  for (const z of [L * 0.33, -L * 0.33]) {
    box(mb, [0, 0.72, z], [2.3, 0.5, 3.1]);
    for (const dz of [-0.95, 0.95]) {
      wheel(mb, -1.0, 0.46, z + dz, 0.46, 0.14);
      wheel(mb, 1.0, 0.46, z + dz, 0.46, 0.14);
    }
  }
}

/* --------------------------------------------------------------- atlas */

export const PROP_NAMES = Object.keys(BUILDERS);

/** Build every prop into one mesh; returns the mesh plus per-prop index ranges. */
export function buildPropAtlas() {
  const mb = new MeshBuilder('props');
  const parts = [];
  for (const name of PROP_NAMES) {
    const quad0 = mb.quads.length;
    const tri0 = mb.tris.length;
    BUILDERS[name](mb);
    parts.push({ name, quad0, quad1: mb.quads.length, tri0, tri1: mb.tris.length });
  }
  mb.computeNormals();
  const { indices, ranges } = mb.buildIndicesGrouped(parts);
  const mesh = {
    name: 'props',
    vertexData: mb.interleave(),
    indices,
    wire: new Uint32Array(0),
    vertexCount: mb.vertexCount,
    quadCount: mb.quadCount,
    triCount: mb.triCount,
    bounds: mb.bounds(),
  };
  return { mesh, draws: ranges, mb };
}
