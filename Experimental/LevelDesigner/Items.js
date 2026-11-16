// Scene pieces: everything a designer can place in a lobby — trees and plants, architecture (feature walls, glazing,
// columns, stairs, portals, platforms), a garage unit and workshop kit (tyre stacks, tool chest, workbench, lift,
// drums, cones), lounge furniture and display pieces. Each piece is a type + parameters + a primary finish; build()
// returns a Group at real scale with its origin on the floor. Secondary materials (chrome handles, rubber, glow)
// are fixed per piece.
import {
  THREE, rad, finish, glow, mesh, rbox, box, cyl, lathe, tube, pipe, at, group, roundedRect, slab, seeded, foliage, signTexture, mergeGeometries,
} from './Kit.js';

const N = (label, value, min, max, step = 0.05, unit = 'm') => ({ label, value, min, max, step, unit });
const B = (label, value) => ({ label, value, kind: 'toggle' });
const S = (label, value) => ({ label, value, min: 1, max: 99, step: 1, unit: '', kind: 'seed' });

export const CATEGORIES = [
  { id: 'nature', label: 'Nature', icon: 'tree' },
  { id: 'architecture', label: 'Architecture', icon: 'wall' },
  { id: 'garage', label: 'Garage', icon: 'garage' },
  { id: 'lounge', label: 'Lounge', icon: 'sofa' },
  { id: 'display', label: 'Display', icon: 'plinth' },
];

// Finishes offered for the primary material in Details.
export const PIECE_FINISHES = ['paintWhite', 'paintGrey', 'paintCharcoal', 'satinBlack', 'glossBlack', 'concrete', 'boardConcrete', 'plaster', 'stone', 'marble', 'terrazzo', 'oak', 'walnut', 'brushed', 'aluminium', 'blackSteel', 'brass', 'chrome', 'redEnamel', 'safetyYellow', 'fabricSand', 'fabricSlate', 'leather', 'terracotta', 'glass', 'smokedGlass', 'frosted', 'bark'];

const steel = () => finish('blackSteel');
const chrome = () => finish('chrome');
const rubber = () => finish('rubber');

// ------------------------------------------------------------------------------------------------- nature
// A broadleaf tree: a tapered trunk splitting into limbs (tubes along jittered curves) and leaf-card crowns at
// the limb ends. Deterministic per seed.
function treeBuild(p, bark) {
  const g = group('Tree');
  const r = seeded(p.seed * 17 + 3);
  const H = p.height, trunkH = H * 0.42, girth = 0.08 + H * 0.025;
  const trunkPts = [[0, 0, 0], [(r() - 0.5) * 0.1, trunkH * 0.5, (r() - 0.5) * 0.1], [(r() - 0.5) * 0.2, trunkH, (r() - 0.5) * 0.2]];
  // Tapered trunk as a lathe-like tube: stack segments of decreasing radius.
  const trunkCurve = new THREE.CatmullRomCurve3(trunkPts.map((q) => new THREE.Vector3(...q)));
  g.add(mesh(taperTube(trunkCurve, girth * 1.25, girth * 0.75, 18), bark));
  // Root flare
  g.add(mesh(lathe([[girth * 2, 0], [girth * 1.5, 0.08], [girth * 1.2, 0.25], [girth * 1.05, 0.5]], 18), bark));
  const top = trunkCurve.getPoint(1);
  const limbs = 3 + Math.floor(r() * 2);
  const crowns = [];
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + r() * 0.8;
    const spread = p.crown * (0.5 + r() * 0.4);
    const rise = H * (0.25 + r() * 0.25);
    const end = new THREE.Vector3(top.x + Math.cos(a) * spread, top.y + rise, top.z + Math.sin(a) * spread);
    const mid = new THREE.Vector3((top.x + end.x) / 2 + (r() - 0.5) * 0.3, (top.y + end.y) / 2 + 0.2, (top.z + end.z) / 2 + (r() - 0.5) * 0.3);
    const curve = new THREE.CatmullRomCurve3([top.clone().add(new THREE.Vector3(0, -0.15, 0)), mid, end]);
    g.add(mesh(taperTube(curve, girth * 0.7, girth * 0.25, 12), bark));
    // Twigs
    for (let k = 0; k < 2; k++) {
      const s = curve.getPoint(0.55 + k * 0.2);
      const tip = s.clone().add(new THREE.Vector3((r() - 0.5) * p.crown * 0.8, 0.4 + r() * 0.6, (r() - 0.5) * p.crown * 0.8));
      g.add(mesh(taperTube(new THREE.CatmullRomCurve3([s, s.clone().lerp(tip, 0.5).add(new THREE.Vector3(0, 0.1, 0)), tip]), girth * 0.25, girth * 0.08, 8), bark));
      crowns.push(tip);
    }
    crowns.push(end);
  }
  for (const c of crowns) {
    const size = p.crown * (0.55 + r() * 0.25);
    g.add(foliage({ count: Math.round(70 * p.density), radius: [size, size * 0.75, size], centre: [c.x, c.y + size * 0.2, c.z], size: 0.55 + p.crown * 0.12, seed: Math.floor(r() * 1000), tint: p.autumn ? '#f0a860' : '#ffffff' }));
  }
  if (p.planter) {
    const w = Math.max(1.2, girth * 14);
    const pl = finish('concrete', { w, h: 1 });
    g.add(mesh(rbox(w, 0.7, w, 0.04), pl));
    g.add(at(mesh(box(w - 0.12, 0.02, w - 0.12), finish('soil')), 0, 0.66, 0));
    g.children.forEach((c) => { if (c !== g.children[g.children.length - 1] && c !== g.children[g.children.length - 2]) c.position.y += 0.66; });
  }
  return g;
}

// A tube whose radius tapers from r0 to r1 along the curve.
function taperTube(curve, r0, r1, radial = 10, segments = 24) {
  const geo = new THREE.TubeGeometry(curve, segments, 1, radial, false);
  const pos = geo.attributes.position, n = geo.attributes.normal;
  const frames = curve.computeFrenetFrames(segments, false);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, rr = r0 + (r1 - r0) * t, c = curve.getPointAt(t);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      pos.setXYZ(k, c.x + n.getX(k) * rr, c.y + n.getY(k) * rr, c.z + n.getZ(k) * rr);
    }
  }
  void frames;
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// A single broad leaf (fiddle-leaf fig style), curved, as a small mesh.
function leafGeometry(len, wid) {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.bezierCurveTo(wid * 0.6, len * 0.15, wid * 0.62, len * 0.8, 0, len); s.bezierCurveTo(-wid * 0.62, len * 0.8, -wid * 0.6, len * 0.15, 0, 0);
  const g = new THREE.ShapeGeometry(s, 10);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, -Math.abs(x) * 0.35 + (y / len) * (y / len) * len * 0.25); }
  g.computeVertexNormals();
  return g;
}

function pottedBuild(p, potMat) {
  const g = group('Plant');
  const r = seeded(p.seed * 31 + 7);
  const pr = p.pot / 2, ph = p.pot * 1.05;
  g.add(mesh(lathe([[0, 0], [pr * 0.78, 0], [pr * 0.8, 0.02], [pr, ph * 0.9], [pr * 1.04, ph], [pr * 0.95, ph], [0.01, ph * 0.92]], 40), potMat));
  g.add(at(mesh(cyl(pr * 0.93, pr * 0.93, 0.02, { segments: 32 }), finish('soil')), 0, ph * 0.9, 0));
  const leafMat = new THREE.MeshStandardMaterial({ color: '#3d6a2e', roughness: 0.55, side: THREE.DoubleSide });
  const stemMat = new THREE.MeshStandardMaterial({ color: '#5a4a32', roughness: 0.9 });
  const stems = 3 + Math.floor(r() * 2);
  for (let i = 0; i < stems; i++) {
    const a = r() * Math.PI * 2, lean = 0.05 + r() * 0.18, h = p.height * (0.7 + r() * 0.3);
    const top = new THREE.Vector3(Math.cos(a) * lean * h, ph + h, Math.sin(a) * lean * h);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, ph * 0.9, 0), new THREE.Vector3(top.x * 0.4, ph + h * 0.5, top.z * 0.4), top]);
    g.add(mesh(taperTube(curve, 0.02, 0.008, 6, 12), stemMat));
    const leaves = Math.round(6 + h * 5);
    for (let k = 0; k < leaves; k++) {
      const t = 0.3 + (k / leaves) * 0.7, at3 = curve.getPoint(t);
      const leaf = new THREE.Mesh(leafGeometry(0.22 + r() * 0.12, 0.2 + r() * 0.06), leafMat.clone());
      leaf.material.color.offsetHSL((r() - 0.5) * 0.03, 0, (r() - 0.5) * 0.08);
      leaf.position.copy(at3);
      leaf.rotation.set(-0.6 - r() * 0.7, r() * Math.PI * 2, (r() - 0.5) * 0.6, 'YXZ');
      leaf.castShadow = true;
      g.add(leaf);
    }
  }
  return g;
}

function hedgeBuild(p, planterMat) {
  const g = group('Hedge');
  const w = p.length, d = p.depth, h = p.height;
  g.add(mesh(rbox(w, 0.5, d, 0.03), planterMat));
  const r = seeded(p.seed * 7 + 1);
  const count = Math.round(w * d * h * 160);
  const leaves = foliage({ count, radius: [0.001, 0.001, 0.001], centre: [0, 0, 0], size: 0.32, seed: p.seed });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), pp = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // Bias toward the outer faces of the box so the hedge reads as a trimmed volume.
    let x = (r() - 0.5) * (w - 0.1), y = 0.5 + r() * h, z = (r() - 0.5) * (d - 0.06);
    const face = r();
    if (face < 0.3) z = Math.sign(z || 1) * (d / 2 - 0.05 - r() * 0.05);
    else if (face < 0.45) x = Math.sign(x || 1) * (w / 2 - 0.05 - r() * 0.05);
    else if (face < 0.7) y = 0.5 + h - r() * 0.06;
    pp.set(x, y, z); q.setFromEuler(e.set(r() * 3, r() * 6, r() * 3));
    m.compose(pp, q, s.setScalar(0.7 + r() * 0.5)); leaves.setMatrixAt(i, m);
  }
  leaves.instanceMatrix.needsUpdate = true;
  g.add(leaves);
  return g;
}

function rockBuild(p, mat) {
  const r = seeded(p.seed * 13 + 5);
  const geo = new THREE.IcosahedronGeometry(1, 4);
  const pos = geo.attributes.position, v = new THREE.Vector3();
  const bumps = Array.from({ length: 9 }, () => [new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), 0.08 + r() * 0.22]);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let k = 1;
    for (const [dir, amt] of bumps) k += Math.max(0, v.dot(dir) - 0.4) * amt * 2 - Math.max(0, -v.dot(dir) - 0.7) * amt;
    v.multiplyScalar(k);
    v.y = Math.max(v.y, -0.25);           // flat-ish base, sunk into the floor
    pos.setXYZ(i, v.x * p.size * 0.6, (v.y + 0.25) * p.size * 0.42, v.z * p.size * 0.5);
  }
  geo.computeVertexNormals();
  return group('Rock', mesh(geo, mat));
}

function grassBuild(p) {
  const r = seeded(p.seed * 11 + 2);
  const blades = [];
  const n = Math.round(80 + p.spread * 80);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * p.spread * 0.4, h = p.height * (0.6 + r() * 0.4), lean = 0.2 + r() * 0.5;
    const g = new THREE.PlaneGeometry(0.025, h, 1, 4).translate(0, h / 2, 0);
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) { const y = pos.getY(k) / h; pos.setZ(k, y * y * lean * h * 0.6); pos.setX(k, pos.getX(k) * (1 - y * 0.9)); }
    g.rotateY(a); g.translate(Math.cos(a) * d, 0, Math.sin(a) * d);
    blades.push(g);
  }
  const merged = mergeGeometries(blades);
  merged.computeVertexNormals();
  const m = mesh(merged, new THREE.MeshStandardMaterial({ color: p.dry ? '#b49a62' : '#6f8a45', roughness: 0.8, side: THREE.DoubleSide }));
  return group('Grass', m);
}

// ------------------------------------------------------------------------------------------------- garage
function tyreGeometry(radius = 0.33, width = 0.24, rim = 0.21) {
  const pts = [];
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, a = -Math.PI / 2 + t * Math.PI;
    const rr = rim + (radius - rim) * (0.55 + 0.45 * Math.cos(a));
    pts.push([rr, Math.sin(a) * width / 2]);
  }
  const g = lathe(pts.map(([x, y]) => [x, y]), 56);
  return g;
}

function tyresBuild(p) {
  const g = group('Tyres');
  const r = seeded(p.seed * 5 + 9);
  const geo = tyreGeometry(), m = rubber();
  const n = Math.round(p.count);
  for (let i = 0; i < n; i++) {
    const t = mesh(geo, m);
    t.position.set((r() - 0.5) * 0.06, 0.12 + i * 0.235, (r() - 0.5) * 0.06);
    t.rotation.y = r() * 3;
    g.add(t);
  }
  if (p.leaning) {
    for (let k = 0; k < 2; k++) {
      const t = mesh(geo, m);
      t.rotation.set(Math.PI / 2 - 0.25, 0, 0);
      t.position.set(-0.4 + k * 0.8 * 0.5 + 0.7, 0.33, 0.55 + k * 0.05);
      g.add(t);
    }
  }
  return g;
}

function toolChestBuild(p, body) {
  const g = group('Tool chest');
  const w = p.width, h = 1.05, d = 0.5;
  g.add(at(mesh(rbox(w, h - 0.12, d, 0.025), body), 0, 0.12, 0));
  const drawers = 6, handle = chrome(), seam = finish('satinBlack');
  for (let i = 0; i < drawers; i++) {
    const dh = (h - 0.25) / drawers, y = 0.16 + i * dh;
    g.add(at(mesh(box(w - 0.06, 0.006, 0.01), seam, { cast: false }), 0, y + dh - 0.004, d / 2 + 0.002));
    g.add(at(mesh(rbox(w * 0.7, 0.025, 0.03, 0.01), handle), 0, y + dh * 0.45, d / 2 + 0.018));
  }
  // Top box with lid
  g.add(at(mesh(rbox(w, 0.38, d * 0.92, 0.025), body), 0, h + 0.02, -0.02));
  g.add(at(mesh(rbox(w * 0.5, 0.025, 0.03, 0.01), handle), 0, h + 0.3, d * 0.46 + 0.012));
  g.add(at(mesh(box(w + 0.02, 0.03, d + 0.02), finish('satinBlack')), 0, h, 0));
  // Casters and a side handle
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const c = mesh(cyl(0.05, 0.05, 0.035, { segments: 16, centre: true }), rubber());
    c.rotation.z = Math.PI / 2; c.position.set(sx * (w / 2 - 0.07), 0.05, sz * (d / 2 - 0.07));
    g.add(c, at(mesh(box(0.05, 0.06, 0.05), handle), sx * (w / 2 - 0.07), 0.07, sz * (d / 2 - 0.07)));
  }
  g.add(pipe([w / 2 + 0.05, 0.6, -0.15], [w / 2 + 0.05, 0.6, 0.15], 0.012, handle));
  for (const z of [-0.15, 0.15]) g.add(pipe([w / 2, 0.6, z], [w / 2 + 0.05, 0.6, z], 0.01, handle));
  return g;
}

function workbenchBuild(p, top) {
  const g = group('Workbench');
  const w = p.length, d = 0.75, h = 0.92, frame = finish({ colour: '#3e4247', roughness: 0.5, metalness: 0.5 });
  g.add(at(mesh(rbox(w, 0.05, d, 0.008), top), 0, h - 0.05, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(mesh(box(0.05, h - 0.05, 0.05), frame), sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08)));
  g.add(at(mesh(box(w - 0.12, 0.03, d - 0.12), frame), 0, 0.18, 0));
  g.add(at(mesh(box(w - 0.12, 0.04, 0.04), frame), 0, h - 0.12, d / 2 - 0.08));
  // Drawer unit and a vise.
  g.add(at(mesh(rbox(0.55, 0.45, d - 0.12, 0.01), finish('redEnamel')), w / 2 - 0.4, h - 0.55, 0));
  const vise = group('Vise', mesh(box(0.22, 0.12, 0.18), finish({ colour: '#2f5d8a', roughness: 0.4, metalness: 0.4 })), at(mesh(box(0.2, 0.08, 0.04), steel()), 0, 0.12, 0.07), at(mesh(box(0.2, 0.08, 0.04), steel()), 0, 0.12, -0.03));
  at(vise, -w / 2 + 0.25, h, d / 2 - 0.1);
  g.add(vise);
  // Back panel with a shelf.
  g.add(at(mesh(box(w, 0.9, 0.025), finish('paintGrey')), 0, h, -d / 2 + 0.012));
  g.add(at(mesh(box(w, 0.025, 0.22), frame), 0, h + 0.62, -d / 2 + 0.12));
  return g;
}

function drumBuild(p, paint) {
  const r = 0.29, h = 0.88;
  const pts = [[0, 0], [r - 0.01, 0], [r, 0.01]];
  for (const y of [0.3, 0.58]) pts.push([r, y - 0.02], [r + 0.012, y], [r, y + 0.02]);
  pts.push([r, h - 0.01], [r - 0.01, h], [0, h]);
  const g = group('Drum', mesh(lathe(pts, 48), paint));
  g.add(at(mesh(cyl(0.035, 0.035, 0.012, { segments: 16 }), chrome()), 0.15, h, 0.05));
  g.add(at(mesh(cyl(0.02, 0.02, 0.012, { segments: 12 }), chrome()), -0.16, h, -0.06));
  if (p.label) {
    const band = mesh(cyl(r + 0.002, r + 0.002, 0.18, { segments: 48, open: true }), new THREE.MeshStandardMaterial({ color: '#f0f0f0', roughness: 0.5 }));
    band.position.y = 0.36; g.add(band);
  }
  return g;
}

function coneBuild(p, mat) {
  const h = p.height, r = h * 0.18;
  const g = group('Cone');
  g.add(mesh(rbox(r * 2.6, 0.03, r * 2.6, 0.01), rubber()));
  g.add(at(mesh(cyl(0.025, r, h - 0.03, { segments: 32 }), mat), 0, 0.03, 0));
  const white = new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.3 });
  for (const [t0, t1] of [[0.45, 0.58], [0.68, 0.76]]) {
    const ra = r + (0.025 - r) * t0, rb = r + (0.025 - r) * t1;
    g.add(at(mesh(cyl(rb + 0.002, ra + 0.002, (t1 - t0) * (h - 0.03), { segments: 32, open: true }), white), 0, 0.03 + t0 * (h - 0.03), 0));
  }
  return g;
}

function liftBuild(p, paint) {
  const g = group('Lift');
  const span = 3.4, H = p.height;
  for (const s of [-1, 1]) {
    const post = group('Post');
    post.add(mesh(rbox(0.32, H, 0.36, 0.02), paint));
    post.add(at(mesh(box(0.6, 0.02, 0.7), steel()), 0, 0, 0));
    const carriage = at(mesh(box(0.38, 0.5, 0.42), finish('blackSteel')), 0, p.raised, 0.02);
    post.add(carriage);
    for (const k of [-1, 1]) {
      const arm = mesh(box(0.1, 0.08, 1.2), finish('satinBlack'));
      arm.position.set(-s * 0.5, p.raised + 0.1, k * 0.55);
      arm.rotation.y = -s * k * 0.55;
      post.add(arm);
      post.add(at(mesh(cyl(0.09, 0.09, 0.06), rubber()), -s * 0.85, p.raised + 0.14, k * 1.05));
    }
    at(post, s * span / 2, 0, 0);
    g.add(post);
  }
  g.add(at(mesh(box(span + 0.3, 0.16, 0.2), paint), 0, H, 0));
  g.add(at(mesh(box(span - 0.4, 0.008, 0.5), finish('safetyYellow')), 0, 0, 0));
  return g;
}

function garageBuild(p, wallMat) {
  const g = group('Garage');
  const W = p.width, D = p.depth, H = p.height, t = 0.2;
  const add = (m) => { g.add(m); return m; };
  add(at(mesh(box(W, H, t), wallMat), 0, 0, -D / 2 + t / 2));
  for (const s of [-1, 1]) add(at(mesh(box(t, H, D), wallMat), s * (W / 2 - t / 2), 0, 0));
  // Front: piers and a header around the door opening.
  const doorW = W - 1.1, doorH = H - 0.6;
  for (const s of [-1, 1]) add(at(mesh(box((W - doorW) / 2, H, t), wallMat), s * (W / 2 - (W - doorW) / 4), 0, D / 2 - t / 2));
  add(at(mesh(box(doorW, H - doorH, t), wallMat), 0, doorH, D / 2 - t / 2));
  // Mono-pitch roof with a steel fascia.
  const roof = mesh(rbox(W + 0.5, 0.18, D + 0.6, 0.02), finish('paintCharcoal'));
  roof.position.set(0, H, 0); roof.rotation.x = -0.04;
  g.add(roof);
  // Segmented door, part open.
  const rows = Math.round(doorH / 0.32), shown = Math.round(rows * (1 - p.open)), panel = finish({ colour: '#cfd2d6', roughness: 0.4, metalness: 0.5 });
  for (let i = 0; i < shown; i++) g.add(at(mesh(rbox(doorW, 0.3, 0.05, 0.01), panel), 0, i * 0.32 + p.open * doorH, D / 2 - t / 2));
  // Interior: floor slab, a wall light and a workbench silhouette.
  g.add(at(mesh(box(W - 0.02, 0.05, D - 0.02), finish('concrete', { w: W, h: D })), 0, 0, 0));
  g.add(at(new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.08), glow('#fff3e0', 3)), 0, H - 0.3, -D / 2 + t + 0.01));
  const inside = new THREE.PointLight('#ffe9cc', 6, 8, 2);
  inside.position.set(0, H - 0.5, 0);
  g.add(inside);
  g.add(at(mesh(box(2, 0.9, 0.6), finish('paintGrey')), -W / 2 + 1.4, 0.05, -D / 2 + 0.55));
  return g;
}

// ------------------------------------------------------------------------------------------------- lounge
function loungeBuild(p, fabric) {
  const g = group('Lounge chair');
  const w = 0.82, d = 0.86, legs = finish('walnut', { w: 1, h: 1 });
  for (const sx of [-1, 1]) {
    g.add(pipe([sx * w * 0.42, 0, d * 0.4], [sx * w * 0.42, 0.36, d * 0.3], 0.018, legs));
    g.add(pipe([sx * w * 0.42, 0, -d * 0.42], [sx * w * 0.42, 0.36, -d * 0.3], 0.018, legs));
    g.add(at(mesh(rbox(0.06, 0.05, d * 0.8, 0.02), legs), sx * w * 0.42, 0.36, 0));
  }
  const seat = mesh(rbox(w, 0.16, d * 0.8, 0.06), fabric);
  seat.position.set(0, 0.38, 0.02); g.add(seat);
  const back = mesh(rbox(w, 0.62, 0.16, 0.06), fabric);
  back.position.set(0, 0.48, -d * 0.36); back.rotation.x = -0.28; g.add(back);
  const pillow = mesh(rbox(w * 0.6, 0.24, 0.1, 0.05), fabric);
  pillow.position.set(0, 0.68, -d * 0.24); pillow.rotation.x = -0.2; g.add(pillow);
  return g;
}

function sofaBuild(p, fabric) {
  const g = group('Sofa');
  const w = p.length, d = 0.95;
  g.add(at(mesh(rbox(w, 0.24, d, 0.04), fabric), 0, 0.1, 0));
  const seats = Math.max(2, Math.round(w / 0.8));
  for (let i = 0; i < seats; i++) {
    const cw = (w - 0.36) / seats, x = -w / 2 + 0.18 + cw * (i + 0.5);
    g.add(at(mesh(rbox(cw - 0.02, 0.16, d - 0.28, 0.06), fabric), x, 0.34, 0.08));
    const back = mesh(rbox(cw - 0.02, 0.48, 0.2, 0.07), fabric);
    back.position.set(x, 0.42, -d / 2 + 0.17); back.rotation.x = -0.12; g.add(back);
  }
  for (const s of [-1, 1]) g.add(at(mesh(rbox(0.18, 0.62, d, 0.06), fabric), s * (w / 2 - 0.09), 0.08, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(at(mesh(cyl(0.02, 0.015, 0.1, { segments: 10 }), finish('brass')), sx * (w / 2 - 0.1), 0, sz * (d / 2 - 0.1)));
  return g;
}

function coffeeBuild(p, top) {
  const g = group('Coffee table');
  const r = p.size / 2;
  g.add(at(mesh(cyl(r, r, 0.04, { segments: 64 }), top), 0, 0.36, 0));
  g.add(at(mesh(cyl(r * 0.25, r * 0.3, 0.34, { segments: 32 }), finish('blackSteel')), 0, 0.02, 0));
  g.add(mesh(cyl(r * 0.5, r * 0.5, 0.02, { segments: 48 }), finish('blackSteel')));
  return g;
}

function deskBuild(p, body) {
  const g = group('Reception desk');
  const w = p.length, depth = 0.75, h = 1.08;
  // Curved front: an extruded arc segment.
  const R = w * 0.9, a = Math.asin(Math.min(0.95, w / 2 / R));
  const shape = new THREE.Shape();
  shape.absarc(0, -R + depth, R, Math.PI / 2 - a, Math.PI / 2 + a, false);
  shape.absarc(0, -R + depth, R - depth * 0.6, Math.PI / 2 + a, Math.PI / 2 - a, true);
  const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: h - 0.05, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 48 });
  bodyGeo.rotateX(-Math.PI / 2); bodyGeo.rotateY(Math.PI);
  g.add(mesh(bodyGeo, body));
  const topShape = new THREE.Shape();
  topShape.absarc(0, -R + depth, R + 0.04, Math.PI / 2 - a - 0.01, Math.PI / 2 + a + 0.01, false);
  topShape.absarc(0, -R + depth, R - depth * 0.6 - 0.02, Math.PI / 2 + a + 0.01, Math.PI / 2 - a - 0.01, true);
  const topGeo = new THREE.ExtrudeGeometry(topShape, { depth: 0.04, bevelEnabled: false, curveSegments: 48 });
  topGeo.rotateX(-Math.PI / 2); topGeo.rotateY(Math.PI); topGeo.translate(0, h - 0.04, 0);
  g.add(mesh(topGeo, finish('oak', { w: 2, h: 1 })));
  // Under-glow line along the plinth.
  const glowShape = new THREE.Shape();
  glowShape.absarc(0, -R + depth, R + 0.002, Math.PI / 2 - a, Math.PI / 2 + a, false);
  glowShape.absarc(0, -R + depth, R - 0.01, Math.PI / 2 + a, Math.PI / 2 - a, true);
  const gl = new THREE.ExtrudeGeometry(glowShape, { depth: 0.025, bevelEnabled: false, curveSegments: 48 });
  gl.rotateX(-Math.PI / 2); gl.rotateY(Math.PI); gl.translate(0, 0.04, 0);
  g.add(new THREE.Mesh(gl, glow('#ffe3c0', 3)));
  return g;
}

function stoolBuild(p, seat) {
  const g = group('Bar stool');
  const h = p.height;
  g.add(mesh(cyl(0.22, 0.24, 0.02, { segments: 40 }), chrome()));
  g.add(at(mesh(cyl(0.025, 0.025, h - 0.06, { segments: 16 }), chrome()), 0, 0.02, 0));
  g.add(at(mesh(new THREE.TorusGeometry(0.17, 0.01, 8, 40).rotateX(Math.PI / 2), chrome()), 0, h * 0.38, 0));
  g.add(at(mesh(lathe([[0, 0], [0.19, 0], [0.2, 0.03], [0.19, 0.06], [0, 0.065]], 40), seat), 0, h - 0.06, 0));
  return g;
}

function rugBuild(p, mat) {
  const g = group('Rug');
  const m = mesh(slab(roundedRect(p.width, p.depth, p.round ? Math.min(p.width, p.depth) / 2 : 0.04), 0.012, 0.004), mat, { cast: false });
  g.add(m);
  return g;
}

// ------------------------------------------------------------------------------------------------ architecture
function featureWallBuild(p, mat) {
  const g = group('Wall');
  g.add(mesh(box(p.width, p.height, p.thickness), mat));
  if (p.reveal) {
    const shadowGap = mesh(box(p.width + 0.002, 0.03, p.thickness + 0.002), finish('satinBlack'), { cast: false });
    shadowGap.position.y = 0; g.add(shadowGap);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(p.width - 0.2, 0.02), glow('#fff2e0', 3));
    strip.position.set(0, p.height - 0.04, p.thickness / 2 + 0.002); g.add(strip);
  }
  return g;
}

function glassWallBuild(p) {
  const g = group('Glass wall');
  const n = Math.max(1, Math.round(p.width / p.module)), mw = p.width / n, frame = steel();
  const glass = finish('glass', { side: THREE.DoubleSide });
  for (let i = 0; i <= n; i++) g.add(at(mesh(box(0.05, p.height, 0.08), frame), -p.width / 2 + i * mw, 0, 0));
  for (const y of [0, p.height - 0.05]) g.add(at(mesh(box(p.width + 0.05, 0.05, 0.08), frame), 0, y, 0));
  if (p.transom) g.add(at(mesh(box(p.width, 0.04, 0.06), frame), 0, p.height * 0.78, 0));
  for (let i = 0; i < n; i++) {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(mw - 0.05, p.height - 0.1), glass);
    pane.position.set(-p.width / 2 + (i + 0.5) * mw, p.height / 2, 0);
    g.add(pane);
  }
  return g;
}

function columnBuild(p, mat) {
  const g = group('Column');
  if (p.square) g.add(mesh(rbox(p.radius * 2, p.height, p.radius * 2, 0.01), mat));
  else g.add(mesh(cyl(p.radius, p.radius, p.height, { segments: 48 }), mat));
  g.add(mesh(p.square ? box(p.radius * 2 + 0.06, 0.06, p.radius * 2 + 0.06) : cyl(p.radius + 0.03, p.radius + 0.03, 0.06, { segments: 48 }), finish('blackSteel')));
  return g;
}

function stairsBuild(p, tread) {
  const g = group('Stairs');
  const n = Math.round(p.steps), rise = p.rise, go = 0.3, w = p.width;
  for (let i = 0; i < n; i++) g.add(at(mesh(rbox(w, 0.06, go + 0.02, 0.008), tread), 0, (i + 1) * rise - 0.06, -i * go));
  const stringer = steel();
  for (const s of [-1, 1]) {
    const len = Math.hypot(n * go, n * rise);
    const m = mesh(box(0.03, 0.22, len, { centre: true }), stringer);
    m.position.set(s * (w / 2 + 0.02), (n * rise) / 2 - 0.06, -(n - 1) * go / 2);
    m.rotation.x = Math.atan2(n * rise, n * go);
    g.add(m);
  }
  if (p.rail) g.add(pipe([w / 2 + 0.05, rise + 0.9, 0.1], [w / 2 + 0.05, n * rise + 0.9, -(n - 1) * go], 0.02, chrome()));
  return g;
}

function platformBuild(p, mat) {
  const g = group('Platform');
  g.add(mesh(slab(roundedRect(p.width, p.depth, p.corner), p.height, 0.01), mat));
  if (p.glow) {
    const edge = mesh(slab(roundedRect(p.width - 0.04, p.depth - 0.04, Math.max(0.01, p.corner - 0.02)), 0.02, 0), glow('#ffffff', 3), { cast: false });
    edge.scale.set(1.002, 1, 1.002); edge.position.y = 0.02;
    g.add(edge);
  }
  return g;
}

function portalBuild(p, mat) {
  const g = group('Portal');
  const t = p.thickness;
  for (const s of [-1, 1]) g.add(at(mesh(box(t, p.height, p.depth), mat), s * (p.width / 2 + t / 2), 0, 0));
  g.add(at(mesh(box(p.width + t * 2, t, p.depth), mat), 0, p.height, 0));
  if (p.glow) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(p.width, 0.03).rotateX(Math.PI / 2), glow('#ffffff', 4));
    line.position.y = p.height - 0.001; g.add(line);
  }
  return g;
}

// ------------------------------------------------------------------------------------------------ display
function plinthBuild(p, mat) {
  const g = group('Plinth');
  g.add(mesh(p.round ? cyl(p.size / 2, p.size / 2, p.height, { segments: 64 }) : rbox(p.size, p.height, p.size, 0.015), mat));
  if (p.case) {
    const c = mesh(rbox(p.size * 0.86, p.size * 0.86, p.size * 0.86, 0.01), finish('glass', { side: THREE.DoubleSide }), { cast: false });
    c.position.y = p.height; g.add(c);
  }
  return g;
}

function screenTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 576;
  const ctx = c.getContext('2d');
  const grd = ctx.createLinearGradient(0, 0, 1024, 576); grd.addColorStop(0, '#0d1b2a'); grd.addColorStop(1, '#1b3a5c');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 1024, 576);
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  for (let x = 0; x < 1024; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 576); ctx.stroke(); }
  ctx.fillStyle = '#ffffff'; ctx.font = '700 84px DM Sans, Arial'; ctx.fillText('CONTROL', 64, 300);
  ctx.font = '500 30px DM Sans, Arial'; ctx.fillStyle = '#9fc2e8'; ctx.fillText('FRONTIER · CONFIGURE YOURS', 68, 352);
  ctx.fillStyle = '#ffb238'; ctx.fillRect(64, 392, 160, 6);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function screenBuild(p) {
  const g = group('Screen');
  const w = p.width, h = w * 9 / 16, lift = p.lift;
  const frame = finish('satinBlack');
  g.add(at(mesh(rbox(w + 0.04, h + 0.04, 0.05, 0.01), frame), 0, lift, 0));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: screenTexture(), toneMapped: true, color: new THREE.Color(1.4, 1.4, 1.4) }));
  face.position.set(0, lift + 0.02 + h / 2, 0.027); g.add(face);
  if (lift > 0.2) { g.add(at(mesh(box(0.08, lift, 0.06), frame), 0, 0, -0.02)); g.add(at(mesh(rbox(0.7, 0.03, 0.45, 0.01), frame), 0, 0, 0)); }
  return g;
}

function barrierBuild(p) {
  const g = group('Rope barrier');
  const post = chrome();
  for (const x of [-p.span / 2, p.span / 2]) {
    g.add(at(mesh(cyl(0.16, 0.18, 0.03, { segments: 32 }), post), x, 0, 0));
    g.add(at(mesh(cyl(0.025, 0.025, p.height, { segments: 16 }), post), x, 0.03, 0));
    g.add(at(mesh(new THREE.SphereGeometry(0.045, 16, 10), post), x, p.height + 0.04, 0));
  }
  const y = p.height - 0.06;
  g.add(mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-p.span / 2, y, 0), new THREE.Vector3(0, y - p.sag * 2, 0), new THREE.Vector3(p.span / 2, y, 0)), 32, 0.022, 10), finish({ colour: '#5a1418', roughness: 0.9, sheen: 1 })));
  return g;
}

function bannerBuild(p) {
  const g = group('Banner');
  const w = 0.85, h = p.height;
  g.add(mesh(rbox(w + 0.06, 0.12, 0.26, 0.02), finish('aluminium')));
  g.add(at(mesh(cyl(0.012, 0.012, h, { segments: 8 }), finish('aluminium')), 0, 0.12, -0.08));
  const tex = signTexture(['CONTROL', 'THE NEW FRONTIER'], { width: 256, height: 640, bg: '#101114', accent: '#ffb238' });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h - 0.1), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  face.position.set(0, 0.12 + (h - 0.1) / 2, 0.005); face.castShadow = true;
  g.add(face);
  return g;
}

// ----------------------------------------------------------------------------------------------- catalogue
export const PIECES = {
  tree: { label: 'Tree', icon: 'tree', category: 'nature', note: 'Broadleaf tree with leaf crowns', finish: 'bark', params: { height: N('Height', 5, 2, 10, 0.1), crown: N('Crown', 1.5, 0.6, 3), density: N('Leaves', 1, 0.3, 2, 0.05, '×'), seed: S('Variation', 3), planter: B('In a planter', false), autumn: B('Autumn', false) }, build: treeBuild },
  plant: { label: 'Potted plant', icon: 'plant', category: 'nature', note: 'Fiddle-leaf fig in a pot', finish: 'terracotta', params: { height: N('Height', 1.4, 0.5, 2.6), pot: N('Pot', 0.5, 0.25, 1), seed: S('Variation', 4) }, build: pottedBuild },
  hedge: { label: 'Hedge planter', icon: 'hedge', category: 'nature', note: 'Clipped hedge in a long planter', finish: 'concrete', params: { length: N('Length', 2.4, 0.8, 8, 0.1), depth: N('Depth', 0.6, 0.3, 1.5), height: N('Hedge height', 0.6, 0.2, 1.8), seed: S('Variation', 2) }, build: hedgeBuild },
  rock: { label: 'Boulder', icon: 'rock', category: 'nature', note: 'Natural stone', finish: 'concrete', params: { size: N('Size', 1.2, 0.3, 4), seed: S('Variation', 6) }, build: rockBuild },
  grass: { label: 'Ornamental grass', icon: 'grass', category: 'nature', note: 'Soft clump of tall grass', finish: 'bark', params: { height: N('Height', 0.9, 0.3, 1.8), spread: N('Spread', 1, 0.4, 2.5), seed: S('Variation', 5), dry: B('Dry', false) }, build: grassBuild },

  wall: { label: 'Feature wall', icon: 'wall', category: 'architecture', note: 'Freestanding wall with a lit reveal', finish: 'boardConcrete', params: { width: N('Width', 5, 0.5, 20, 0.1), height: N('Height', 3.2, 0.5, 8, 0.1), thickness: N('Thickness', 0.25, 0.05, 1, 0.01), reveal: B('Light reveal', true) }, build: featureWallBuild },
  glasswall: { label: 'Glass wall', icon: 'glass', category: 'architecture', note: 'Steel-framed glazing', finish: 'blackSteel', params: { width: N('Width', 4.8, 1, 16, 0.1), height: N('Height', 3, 1, 6, 0.1), module: N('Pane width', 1.2, 0.5, 3), transom: B('Transom bar', false) }, build: glassWallBuild },
  column: { label: 'Column', icon: 'column', category: 'architecture', note: 'Round or square column', finish: 'concrete', params: { radius: N('Radius', 0.3, 0.08, 1.2, 0.01), height: N('Height', 4, 1, 10, 0.1), square: B('Square', false) }, build: columnBuild },
  stairs: { label: 'Floating stairs', icon: 'stairs', category: 'architecture', note: 'Oak treads on steel stringers', finish: 'oak', params: { steps: N('Steps', 8, 2, 20, 1, ''), rise: N('Rise', 0.18, 0.12, 0.22, 0.005), width: N('Width', 1.1, 0.6, 3), rail: B('Handrail', true) }, build: stairsBuild },
  platform: { label: 'Platform', icon: 'floor', category: 'architecture', note: 'Rounded stage, optional light line', finish: 'glossBlack', params: { width: N('Width', 7, 1, 16, 0.1), depth: N('Depth', 4.4, 1, 12, 0.1), height: N('Height', 0.15, 0.03, 1, 0.01), corner: N('Corner', 0.8, 0, 3), glow: B('Light line', true) }, build: platformBuild },
  portal: { label: 'Portal frame', icon: 'arch', category: 'architecture', note: 'Walk-through frame', finish: 'paintWhite', params: { width: N('Opening', 3.6, 1, 10, 0.1), height: N('Height', 3.2, 1.5, 8, 0.1), depth: N('Depth', 0.6, 0.1, 3), thickness: N('Thickness', 0.3, 0.05, 1, 0.01), glow: B('Light line', true) }, build: portalBuild },

  garage: { label: 'Garage unit', icon: 'garage', category: 'garage', note: 'Single garage with a roll-up door', finish: 'paintWhite', params: { width: N('Width', 3.8, 2.8, 7, 0.1), depth: N('Depth', 6.2, 4, 9, 0.1), height: N('Height', 3, 2.4, 5, 0.1), open: N('Door open', 0.6, 0, 1, 0.01, '') }, build: garageBuild },
  tyres: { label: 'Tyre stack', icon: 'tyre', category: 'garage', note: 'Stacked tyres, two leaning', finish: 'rubber', params: { count: N('Tyres', 4, 1, 8, 1, ''), seed: S('Variation', 1), leaning: B('Two leaning', true) }, build: tyresBuild },
  toolchest: { label: 'Tool chest', icon: 'toolbox', category: 'garage', note: 'Rolling cabinet with a top box', finish: 'redEnamel', params: { width: N('Width', 1.05, 0.6, 2) }, build: toolChestBuild },
  workbench: { label: 'Workbench', icon: 'bench', category: 'garage', note: 'Steel bench, oak top, vise', finish: 'oak', params: { length: N('Length', 2.2, 1.2, 4, 0.1) }, build: workbenchBuild },
  lift: { label: 'Two-post lift', icon: 'lift', category: 'garage', note: 'Car lift with swing arms', finish: { colour: '#2f5d8a', roughness: 0.45, metalness: 0.4, clearcoat: 0.3 }, params: { height: N('Height', 3.8, 3, 4.6), raised: N('Arms height', 0.2, 0.1, 2) }, build: liftBuild },
  drum: { label: 'Oil drum', icon: 'drum', category: 'garage', note: '200 L steel drum', finish: { colour: '#1f4e8c', roughness: 0.35, metalness: 0.3, clearcoat: 0.5 }, params: { label: B('Label band', true) }, build: drumBuild },
  cone: { label: 'Traffic cone', icon: 'cone', category: 'garage', note: 'Reflective bands', finish: { colour: '#ff5a0a', roughness: 0.45 }, params: { height: N('Height', 0.7, 0.3, 1) }, build: coneBuild },

  lounge: { label: 'Lounge chair', icon: 'chair', category: 'lounge', note: 'Walnut frame, deep cushions', finish: 'fabricSand', params: {}, build: loungeBuild },
  sofa: { label: 'Sofa', icon: 'sofa', category: 'lounge', note: 'Low sofa on brass feet', finish: 'fabricSlate', params: { length: N('Length', 2.4, 1.4, 4, 0.1) }, build: sofaBuild },
  coffee: { label: 'Coffee table', icon: 'table', category: 'lounge', note: 'Round top on a steel pedestal', finish: 'marble', params: { size: N('Diameter', 0.9, 0.5, 1.6) }, build: coffeeBuild },
  desk: { label: 'Reception desk', icon: 'desk', category: 'lounge', note: 'Curved front, oak top, under-glow', finish: 'paintWhite', params: { length: N('Length', 3, 1.6, 6, 0.1) }, build: deskBuild },
  stool: { label: 'Bar stool', icon: 'stool', category: 'lounge', note: 'Chrome pedestal stool', finish: 'leather', params: { height: N('Seat height', 0.76, 0.6, 0.85, 0.01) }, build: stoolBuild },
  rug: { label: 'Rug', icon: 'rug', category: 'lounge', note: 'Soft area rug', finish: 'fabricSand', params: { width: N('Width', 3, 1, 8, 0.1), depth: N('Depth', 2, 1, 6, 0.1), round: B('Rounded', false) }, build: rugBuild },

  plinth: { label: 'Plinth', icon: 'plinth', category: 'display', note: 'Display base, optional glass case', finish: 'paintWhite', params: { size: N('Size', 0.7, 0.3, 2), height: N('Height', 1, 0.2, 1.6), round: B('Round', false), case: B('Glass case', false) }, build: plinthBuild },
  screen: { label: 'Display screen', icon: 'viewport', category: 'display', note: '16:9 screen on a stand', finish: 'satinBlack', params: { width: N('Width', 2.2, 0.8, 6, 0.1), lift: N('Lift', 1, 0, 3) }, build: screenBuild },
  barrier: { label: 'Rope barrier', icon: 'link', category: 'display', note: 'Chrome posts and velvet rope', finish: 'chrome', params: { span: N('Span', 2.4, 0.6, 6, 0.1), height: N('Post height', 0.95, 0.4, 1.4, 0.01), sag: N('Rope sag', 0.15, 0, 0.5, 0.01) }, build: barrierBuild },
  banner: { label: 'Roll-up banner', icon: 'banner', category: 'display', note: 'Printed banner stand', finish: 'aluminium', params: { height: N('Height', 2, 1.2, 2.6) }, build: bannerBuild },
};

export function defaultPieceParams(type) {
  return Object.fromEntries(Object.entries(PIECES[type].params).map(([k, d]) => [k, d.value]));
}

void tube; void rad;
