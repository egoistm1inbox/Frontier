// Lobby designs ("sets"): the architecture around the car. Each set is a complete room built from real-scale parts —
// a photo studio with an L-shaped cove and lighting grid, a steel-framed garage workshop, a board-formed concrete
// atrium under timber slats and a skylight, a glass pavilion on a stone plinth in a garden, and an open floor that
// runs to the horizon. A set also carries its sky, sun, ambience, a recommended floor and a recommended light rig;
// floors and rigs can be swapped independently afterwards.
import {
  THREE, rad, finish, glow, mesh, rbox, box, cyl, pipe, at, group, roundedRect, slab, seeded, signTexture, foliage, mergeGeometries,
} from './Kit.js';
import { tiled } from './Textures.js';
import { RectAreaLightUniformsLib } from './Vendor/RectAreaLightUniformsLib.js';

let areaReady = false;
const prepareAreaLights = () => { if (!areaReady) { RectAreaLightUniformsLib.init(); areaReady = true; } };

// ----------------------------------------------------------------------------------------------------- floors
// Floor finishes. `gloss` = how much of the floor's mirror shows through; `texture` = procedural surface.
export const FLOORS = {
  concrete: { label: 'Polished concrete', texture: 'concrete', colour: '#ffffff', gloss: 0.45, roughness: 0.55 },
  studio: { label: 'Studio paint', texture: 'plaster', colour: '#8b8e93', gloss: 0.22, roughness: 0.7 },
  epoxy: { label: 'Workshop epoxy', texture: 'epoxy', colour: '#ffffff', gloss: 0.5, roughness: 0.35 },
  marble: { label: 'White marble', texture: 'marble', colour: '#ffffff', gloss: 0.55, roughness: 0.2 },
  stone: { label: 'Honed stone', texture: 'stone', colour: '#ffffff', gloss: 0.25, roughness: 0.6 },
  terrazzo: { label: 'Terrazzo', texture: 'terrazzo', colour: '#ffffff', gloss: 0.4, roughness: 0.4 },
  oak: { label: 'Oak planks', texture: 'oak', colour: '#ffffff', gloss: 0.3, roughness: 0.5 },
  rubber: { label: 'Coin rubber', texture: 'rubber', colour: '#ffffff', gloss: 0.08, roughness: 0.85 },
  glossBlack: { label: 'Black lacquer', texture: null, colour: '#0d0e10', gloss: 0.78, roughness: 0.1 },
  litGlass: { label: 'Lit glass', texture: 'litglass', colour: '#ffffff', gloss: 0.7, roughness: 0.08, emissive: '#cfe3ff' },
};

// ------------------------------------------------------------------------------------------------- set helpers
// Wall swept along a plan path with a floor cove: the profile curves up from the floor (radius `cove`) into a vertical
// wall. The path is a polyline [[x, z], …] with rounded corners; the room is on the left-hand side of travel.
function coveWall(path, { height = 6, cove = 1.2, corner = 3 } = {}) {
  const plan = roundedPath(path, corner);
  const nv = 22, pos = [], uv = [], idx = [];
  const arc = (Math.PI / 2) * cove, length = arc + (height - cove);
  let run = 0;
  for (let i = 0; i < plan.length; i++) {
    const [x, z] = plan[i];
    const prev = plan[Math.max(0, i - 1)], next = plan[Math.min(plan.length - 1, i + 1)];
    let dx = next[0] - prev[0], dz = next[1] - prev[1];
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const nx = -dz, nz = dx;           // into the room
    if (i > 0) run += Math.hypot(x - plan[i - 1][0], z - plan[i - 1][1]);
    for (let j = 0; j <= nv; j++) {
      const s = (j / nv) * length;
      let o, y;
      if (s < arc) { const k = s / cove; o = cove * (1 - Math.sin(k)); y = cove * (1 - Math.cos(k)); } else { o = 0; y = cove + (s - arc); }
      pos.push(x + nx * o, y, z + nz * o);
      uv.push(run / 4, (s) / 4);
    }
  }
  for (let i = 0; i < plan.length - 1; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, b = a + nv + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function roundedPath(points, r, segs = 14) {
  const out = [];
  const step = 0.5;
  const pushLine = (a, b) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * (k / n), a[1] + (b[1] - a[1]) * (k / n)]);
  };
  let start = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], a = points[i - 1], b = points[i + 1];
    const da = norm2([a[0] - p[0], a[1] - p[1]]), db = norm2([b[0] - p[0], b[1] - p[1]]);
    const c1 = [p[0] + da[0] * r, p[1] + da[1] * r], c2 = [p[0] + db[0] * r, p[1] + db[1] * r];
    pushLine(start, c1);
    for (let k = 0; k < segs; k++) {
      const t = k / segs, u = 1 - t;
      out.push([u * u * c1[0] + 2 * u * t * p[0] + t * t * c2[0], u * u * c1[1] + 2 * u * t * p[1] + t * t * c2[1]]);
    }
    start = c2;
  }
  pushLine(start, points[points.length - 1]);
  out.push(points[points.length - 1]);
  return out;
}
const norm2 = ([x, z]) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };

// Wall panel standing on the floor: w along local X, centred, facing +Z.
function wall(w, h, t, mat) { const m = mesh(box(w, h, t), mat); return m; }

// I-beam (steel section) of length `len` along local X.
function iBeam(len, depth, width, mat) {
  const s = new THREE.Shape(), d = depth / 2, b = width / 2, tf = depth * 0.08, tw = width * 0.12;
  s.moveTo(-b, -d); s.lineTo(b, -d); s.lineTo(b, -d + tf); s.lineTo(tw / 2, -d + tf); s.lineTo(tw / 2, d - tf); s.lineTo(b, d - tf);
  s.lineTo(b, d); s.lineTo(-b, d); s.lineTo(-b, d - tf); s.lineTo(-tw / 2, d - tf); s.lineTo(-tw / 2, -d + tf); s.lineTo(-b, -d + tf); s.lineTo(-b, -d);
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
  g.translate(0, 0, -len / 2);
  g.rotateY(Math.PI / 2);
  return mesh(g, mat);
}

// Corrugated sheet (w × d) in the XZ plane, ribs along X, facing down.
function corrugated(w, d, mat, pitch = 0.2, amp = 0.03) {
  const g = new THREE.PlaneGeometry(w, d, 4, Math.round(d / pitch * 6));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getY(i) / pitch) * Math.PI * 2) * amp);
  g.computeVertexNormals();
  g.rotateX(Math.PI / 2);
  return mesh(g, mat, { cast: true, receive: true });
}

// Heavy velvet drape across w, with folds.
function drape(w, h, mat) {
  const g = new THREE.PlaneGeometry(w, h, Math.round(w * 8), 4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, Math.sin(x * 5.2) * 0.09 + Math.sin(x * 1.7 + 1) * 0.05); }
  g.computeVertexNormals();
  g.translate(0, h / 2, 0);
  return mesh(g, mat, { cast: false });
}

// Segmented roll-up door, `open` 0..1 (raised fraction), with steel frame.
function rollUpDoor(w, h, open, panelMat, frameMat, outsideMat) {
  const g = group('Roll-up door');
  const rib = 0.3, rows = Math.round(h / rib), visible = Math.round(rows * (1 - open));
  for (let i = 0; i < visible; i++) {
    const m = mesh(rbox(w, rib - 0.012, 0.06, 0.012, { centre: true }), panelMat);
    m.position.set(0, (i + 0.5) * rib + open * h, 0);
    m.rotation.x = 0.04;
    g.add(m);
  }
  // Coil housing, guides and the frame.
  g.add(at(mesh(cyl(0.32, 0.32, w + 0.3, { centre: true }), frameMat), 0, h + 0.32, -0.12));
  g.children[g.children.length - 1].rotation.z = Math.PI / 2;
  for (const s of [-1, 1]) g.add(at(mesh(box(0.14, h + 0.1, 0.16), frameMat), s * (w / 2 + 0.07), 0, 0));
  g.add(at(mesh(box(w + 0.42, 0.14, 0.18), frameMat), 0, h, 0));
  // Daylight outside the open part.
  if (open > 0.02) {
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(w, open * h), outsideMat);
    outside.position.set(0, open * h / 2, -0.6);
    g.add(outside);
  }
  return g;
}

// Instanced copies of one geometry at a list of [x, y, z, ry] transforms.
function instances(geometry, material, transforms, { cast = true, receive = true } = {}) {
  const inst = new THREE.InstancedMesh(geometry, material, transforms.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  transforms.forEach(([x, y, z, ry = 0, sc = 1], i) => { p.set(x, y, z); q.setFromEuler(e.set(0, ry, 0)); s.setScalar(sc); m.compose(p, q, s); inst.setMatrixAt(i, m); });
  inst.castShadow = cast; inst.receiveShadow = receive;
  return inst;
}

// Distant landscape: low-poly trees in a loose ring and soft hills, for sets that open to the outside.
function landscape({ inner = 26, outer = 70, trees = 90, seed = 3, ground = -0.02 } = {}) {
  const g = group('Landscape');
  const grassMat = finish({ colour: '#ffffff', roughness: 1, texture: 'grass', metres: 6 }, { w: 400, h: 400 });
  const lawn = mesh(new THREE.CircleGeometry(200, 64).rotateX(-Math.PI / 2), grassMat, { cast: false });
  lawn.position.y = ground;
  g.add(lawn);
  const r = seeded(seed);
  const crown = new THREE.IcosahedronGeometry(1, 1), trunk = cyl(0.12, 0.18, 1, { segments: 7 });
  const crownMat = new THREE.MeshStandardMaterial({ color: '#4c6b34', roughness: 0.9, flatShading: true });
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#4a3b2e', roughness: 1 });
  const cs = [], ts = [];
  for (let i = 0; i < trees; i++) {
    const a = r() * Math.PI * 2, d = inner + Math.pow(r(), 0.7) * (outer - inner);
    const x = Math.cos(a) * d, z = Math.sin(a) * d, h = 4 + r() * 6, s = 1.6 + r() * 2.2;
    ts.push([x, ground, z, 0, 1]);
    cs.push([x, ground + h, z, r() * 3, s]);
  }
  const trunks = new THREE.InstancedMesh(trunk, trunkMat, ts.length), crowns = new THREE.InstancedMesh(crown, crownMat, cs.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), colour = new THREE.Color();
  ts.forEach(([x, y, z], i) => { const h = cs[i][1] - y; m.compose(p.set(x, y, z), q.identity(), sc.set(1, h, 1)); trunks.setMatrixAt(i, m); });
  cs.forEach(([x, y, z, ry, s], i) => { m.compose(p.set(x, y, z), q.setFromEuler(new THREE.Euler(0, ry, 0)), sc.set(s, s * 1.25, s)); crowns.setMatrixAt(i, m); crowns.setColorAt(i, colour.setHSL(0.24 + r() * 0.06, 0.32 + r() * 0.15, 0.24 + r() * 0.1)); });
  trunks.castShadow = crowns.castShadow = true;
  g.add(trunks, crowns);
  const hillMat = new THREE.MeshStandardMaterial({ color: '#61774f', roughness: 1 });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + r(), d = 120 + r() * 30;
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), hillMat);
    hill.scale.set(30 + r() * 30, 8 + r() * 10, 30 + r() * 20);
    hill.position.set(Math.cos(a) * d, ground - 1, Math.sin(a) * d);
    g.add(hill);
  }
  for (const o of g.children) o.raycast = () => {};
  return g;
}

// ------------------------------------------------------------------------------------------------------ the sets
function buildStudio() {
  const g = group('Studio set'), occluders = [];
  // L-shaped hard cove (back + left), studio grey.
  const coveMat = finish({ colour: '#8d9095', roughness: 0.82, texture: 'plaster', metres: 6 }, { side: THREE.DoubleSide });
  const cove = mesh(coveWall([[-11, 9], [-11, -8.5], [13, -8.5]], { height: 7, cove: 1.4, corner: 3.2 }), coveMat, { cast: false });
  cove.name = 'Cove';
  g.add(cove); occluders.push(cove);
  // Black drapes on the open sides, ceiling and the lighting grid.
  const velvet = finish({ colour: '#101012', roughness: 1, sheen: 1 }, { side: THREE.DoubleSide });
  const right = at(drape(19, 7.2, velvet), 13.2, 0, 0.3, -Math.PI / 2);
  const front = at(drape(24.4, 7.2, velvet), 1, 0, 9.4, Math.PI);
  g.add(right, front); occluders.push(right, front);
  const ceiling = mesh(new THREE.PlaneGeometry(26, 20).rotateX(Math.PI / 2), finish('paintCharcoal'), { cast: false });
  at(ceiling, 1, 7.6, 0.4);
  g.add(ceiling); occluders.push(ceiling);
  const steel = finish('blackSteel');
  const pipes = [];
  for (let x = -9; x <= 12; x += 3) pipes.push(pipe([x, 6.6, -7.5], [x, 6.6, 8.5], 0.025, steel));
  for (let z = -7.5; z <= 8.5; z += 2.666) pipes.push(pipe([-10, 6.55, z], [12.5, 6.55, z], 0.025, steel));
  for (const [x, z] of [[-9, -7.5], [12, -7.5], [-9, 8.5], [12, 8.5]]) pipes.push(pipe([x, 6.6, z], [x, 7.6, z], 0.02, steel));
  g.add(...pipes);
  // Cable runs drooping from the grid down the drape.
  const cable = new THREE.MeshStandardMaterial({ color: '#09090a', roughness: 0.6 });
  for (const z of [-4, 3]) {
    const pts = [new THREE.Vector3(12, 6.6, z), new THREE.Vector3(12.6, 5.6, z + 0.3), new THREE.Vector3(12.9, 2, z + 0.5), new THREE.Vector3(12.9, 0.02, z + 0.9), new THREE.Vector3(11.5, 0.02, z + 1.5)];
    g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.018, 6), cable));
  }
  return { group: g, occluders, floorSize: [80, 80] };
}

function buildGarage() {
  const g = group('Garage workshop'), occluders = [];
  const W = 26, D = 20, H = 6.4, x0 = -W / 2, z0 = -D / 2;
  const blockMat = finish({ colour: '#ffffff', roughness: 0.88, texture: 'block', bump: 0.4 }, { w: 1, h: 1 });
  const dado = finish({ colour: '#3b3e43', roughness: 0.7 });
  const mkWall = (len, x, z, ry) => {
    const m = at(mesh(box(len, H, 0.3), finish({ colour: '#ffffff', roughness: 0.88, texture: 'block', bump: 0.4 }, { w: len, h: H })), x, 0, z, ry);
    const band = at(mesh(box(len, 1.25, 0.04), dado, { cast: false }), x, 0, z, ry);
    band.translateZ(0.17);
    g.add(m, band); occluders.push(m);
    return m;
  };
  void blockMat;
  // Back wall with two door openings: built as three piers and a header.
  const doorW = 4.8, doorH = 4.4, doorX = [-6, 6];
  const backZ = z0;
  const pierEdges = [x0, doorX[0] - doorW / 2, doorX[0] + doorW / 2, doorX[1] - doorW / 2, doorX[1] + doorW / 2, -x0];
  for (let i = 0; i < pierEdges.length; i += 2) { const a = pierEdges[i], b = pierEdges[i + 1]; mkWall(b - a, (a + b) / 2, backZ, 0); }
  for (const x of doorX) {
    const header = at(mesh(box(doorW, H - doorH, 0.3), finish({ colour: '#ffffff', roughness: 0.88, texture: 'block' }, { w: doorW, h: H - doorH })), x, doorH, backZ);
    g.add(header); occluders.push(header);
  }
  mkWall(D, x0, 0, Math.PI / 2);
  mkWall(D, -x0, 0, -Math.PI / 2);
  mkWall(W, 0, -z0, Math.PI);
  // Roll-up doors: left closed, right two-thirds open onto daylight.
  const panel = finish({ colour: '#c9ccd0', roughness: 0.45, metalness: 0.6 });
  const outside = new THREE.MeshBasicMaterial({ color: new THREE.Color('#dfe8f2').multiplyScalar(2.2) });
  g.add(at(rollUpDoor(doorW, doorH, 0, panel, finish('blackSteel'), outside), doorX[0], 0, backZ + 0.2));
  g.add(at(rollUpDoor(doorW, doorH, 0.62, panel, finish('blackSteel'), outside), doorX[1], 0, backZ + 0.2));
  // Portal frames: columns along the side walls and roof beams across.
  const steel = finish({ colour: '#2f5d8a', roughness: 0.45, metalness: 0.4, clearcoat: 0.3 });
  for (const z of [-7.5, -2.5, 2.5, 7.5]) {
    for (const s of [-1, 1]) {
      const col = iBeam(H + 0.3, 0.36, 0.2, steel);
      col.rotation.set(0, 0, Math.PI / 2);
      col.position.set(s * (W / 2 - 0.35), (H + 0.3) / 2, z);
      g.add(col);
    }
    const beam = iBeam(W - 0.4, 0.5, 0.22, steel);
    beam.position.set(0, H + 0.1, z);
    g.add(beam);
  }
  // Roof: corrugated deck with two skylight strips; it closes the room for reflections.
  const deck = corrugated(W, D, finish({ colour: '#8a8e93', roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide }));
  deck.position.set(0, H + 0.42, 0);
  g.add(deck); occluders.push(deck);
  const sky = new THREE.MeshBasicMaterial({ color: new THREE.Color('#eef4ff').multiplyScalar(1.6) });
  for (const x of [-6, 6]) { const s = new THREE.Mesh(new THREE.PlaneGeometry(2.2, D - 2).rotateX(Math.PI / 2), sky); s.position.set(x, H + 0.39, 0); g.add(s); }
  // Floor markings: bay outline and a hatched no-park zone in front of the doors.
  const yellow = new THREE.MeshStandardMaterial({ color: '#e8b10c', roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  const line = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), yellow); m.position.set(x, 0.003, z); m.receiveShadow = true; return m; };
  g.add(line(11, 0.12, 0, -4.6), line(11, 0.12, 0, 4.6), line(0.12, 9.2, -5.5, 0), line(0.12, 9.2, 5.5, 0));
  for (const x of doorX) for (let k = -4; k <= 4; k++) { const m = line(0.14, 1.6, x + k * 0.55, backZ + 1.6); m.rotation.y = 0.6; g.add(m); }
  // Wall details: signage, pegboard, hose reel, extinguisher, cable tray.
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), new THREE.MeshStandardMaterial({ map: signTexture(['BAY 01', 'FRONTIER WORKS · SERVICE']), roughness: 0.5 }));
  sign.position.set(0, 4.95, backZ + 0.17);
  g.add(sign);
  const peg = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 2), new THREE.MeshStandardMaterial({ map: pegboardTexture(), roughness: 0.8 }));
  peg.position.set(x0 + 0.17, 2.4, -2); peg.rotation.y = Math.PI / 2;
  g.add(peg);
  const red = finish('redEnamel');
  const ext = group('Extinguisher', mesh(cyl(0.09, 0.09, 0.55), red), at(mesh(cyl(0.03, 0.05, 0.12), finish('blackSteel')), 0, 0.55, 0));
  at(ext, -x0 - 0.3, 0.9, -6);
  g.add(ext);
  const reel = group('Hose reel', at(mesh(cyl(0.32, 0.32, 0.18, { centre: true }), red), 0, 0, 0));
  reel.children[0].rotation.x = Math.PI / 2;
  reel.add(at(mesh(new THREE.TorusGeometry(0.24, 0.05, 10, 32), finish('rubber')), 0, 0, 0.02));
  at(reel, x0 + 0.35, 3.4, 5); reel.rotation.y = Math.PI / 2;
  g.add(reel);
  const tray = finish('aluminium');
  g.add(at(mesh(box(0.3, 0.08, D - 2), tray), x0 + 0.5, 5.4, 0), at(mesh(box(0.3, 0.08, D - 2), tray), -x0 - 0.5, 5.4, 0));
  return { group: g, occluders, floorSize: [W, D] };
}

function pegboardTexture() {
  const c = document.createElement('canvas'); c.width = 900; c.height = 400;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d6d0c2'; ctx.fillRect(0, 0, 900, 400);
  ctx.fillStyle = '#a49d8d';
  for (let y = 10; y < 400; y += 20) for (let x = 10; x < 900; x += 20) { ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 6.283); ctx.fill(); }
  // Tools: spanners, a hammer, screwdrivers, pliers — drawn as dark silhouettes with outlines.
  ctx.fillStyle = '#2a2c30'; ctx.strokeStyle = '#d6d0c2';
  for (let i = 0; i < 8; i++) { const x = 60 + i * 34, len = 120 + i * 14; ctx.fillRect(x, 60, 10, len); ctx.beginPath(); ctx.arc(x + 5, 60, 14, 0, 6.283); ctx.fill(); }
  ctx.fillStyle = '#b3191e'; for (let i = 0; i < 6; i++) { ctx.fillRect(400 + i * 30, 70, 16, 70); ctx.fillStyle = '#9aa0a6'; ctx.fillRect(405 + i * 30, 140, 6, 80 + i * 6); ctx.fillStyle = '#b3191e'; }
  ctx.fillStyle = '#2a2c30'; ctx.fillRect(620, 80, 16, 200); ctx.fillRect(590, 70, 76, 34);
  ctx.fillStyle = '#e8b10c'; ctx.fillRect(720, 70, 120, 90); ctx.fillStyle = '#2a2c30'; ctx.fillRect(735, 90, 90, 50);
  ctx.fillStyle = '#3a3d42'; ctx.fillRect(700, 230, 160, 120);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function buildAtrium() {
  const g = group('Concrete atrium'), occluders = [];
  const W = 24, D = 18, H = 7.2;
  const concrete = (w, h) => finish('boardConcrete', { w, h });
  const add = (m, occ = true) => { g.add(m); if (occ) occluders.push(m); return m; };
  // Back wall (full), right wall (with a deep niche), left wall with a long low window slot.
  add(at(mesh(box(W + 0.8, H, 0.4), concrete(W, H)), 0, 0, -D / 2));
  add(at(mesh(box(D, H, 0.4), concrete(D, H)), W / 2 + 0.2, 0, 0, Math.PI / 2));
  const slotY0 = 0.9, slotY1 = 2.9, slotZ0 = -6.5, slotZ1 = 5.5;
  const lx = -W / 2 - 0.2;
  add(at(mesh(box(D, slotY0, 0.4), concrete(D, slotY0)), lx, 0, 0, Math.PI / 2));
  add(at(mesh(box(D, H - slotY1, 0.4), concrete(D, H - slotY1)), lx, slotY1, 0, Math.PI / 2));
  add(at(mesh(box(slotZ0 + D / 2, slotY1 - slotY0, 0.4), concrete(3, 2)), lx, slotY0, (-D / 2 + slotZ0) / 2, Math.PI / 2));
  add(at(mesh(box(D / 2 - slotZ1, slotY1 - slotY0, 0.4), concrete(3, 2)), lx, slotY0, (slotZ1 + D / 2) / 2, Math.PI / 2));
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(slotZ1 - slotZ0, slotY1 - slotY0), finish('glass', { side: THREE.DoubleSide }));
  pane.position.set(lx, (slotY0 + slotY1) / 2, (slotZ0 + slotZ1) / 2); pane.rotation.y = Math.PI / 2;
  g.add(pane);
  // Roof slab with a skylight over the car, timber slat ceiling under it.
  const roofY = H, gapZ = 1.4, gapX = 7;
  const roofMat = finish('concrete', { w: W, h: D });
  const roofParts = [
    [W + 0.8, (D / 2 - gapZ), 0, -(gapZ + (D / 2 - gapZ) / 2)], [W + 0.8, (D / 2 - gapZ), 0, gapZ + (D / 2 - gapZ) / 2],
    [(W / 2 - gapX) + 0.4, gapZ * 2, -(gapX + (W / 2 - gapX + 0.4) / 2), 0], [(W / 2 - gapX) + 0.4, gapZ * 2, gapX + (W / 2 - gapX + 0.4) / 2, 0],
  ];
  for (const [w, d, x, z] of roofParts) add(at(mesh(box(w, 0.5, d), roofMat), x, roofY, z));
  // Slats: 60 mm × 240 mm oak battens every 300 mm, interrupted at the skylight.
  const oak = finish('oak', { w: 1, h: 6 });
  const slat = box(0.06, 0.24, 1);
  const ts = [];
  for (let z = -D / 2 + 0.3; z < D / 2; z += 0.3) {
    if (Math.abs(z) < gapZ) {
      const seg = W / 2 - gapX;
      ts.push([-(gapX + seg / 2), roofY - 0.3, z, Math.PI / 2, 1, seg], [gapX + seg / 2, roofY - 0.3, z, Math.PI / 2, 1, seg]);
    } else ts.push([0, roofY - 0.3, z, Math.PI / 2, 1, W]);
  }
  const inst = new THREE.InstancedMesh(slat, oak, ts.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  ts.forEach(([x, y, z, ry, , len], i) => { m4.compose(p.set(x, y, z), q.setFromEuler(new THREE.Euler(0, ry, 0)), s.set(1, 1, len)); inst.setMatrixAt(i, m4); });
  inst.castShadow = true; inst.receiveShadow = true;
  add(inst, false);
  // Reflecting pool along the back wall, with a stone coping.
  const coping = finish('stone', { w: 2, h: 2 });
  const poolW = 16, poolD = 1.6, pz = -D / 2 + 0.2 + poolD / 2 + 0.25;
  for (const [w, d, x, z] of [[poolW + 0.5, 0.25, 0, pz - poolD / 2 - 0.125], [poolW + 0.5, 0.25, 0, pz + poolD / 2 + 0.125], [0.25, poolD, -poolW / 2 - 0.125, pz], [0.25, poolD, poolW / 2 + 0.125, pz]]) g.add(at(mesh(box(w, 0.32, d), coping), x, 0, z));
  const water = mesh(new THREE.PlaneGeometry(poolW, poolD).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: '#0d1719', roughness: 0.02, metalness: 0.1, clearcoat: 1, envMapIntensity: 1.6 }), { cast: false });
  water.position.set(0, 0.24, pz);
  g.add(water);
  // Built-in bench along the right wall and a niche shelf.
  g.add(at(mesh(box(5, 0.45, 0.7), finish('concrete', { w: 5, h: 1 })), W / 2 - 0.55, 0, 3.5, Math.PI / 2));
  g.add(at(mesh(box(5.2, 0.06, 0.9), finish('oak', { w: 5, h: 1 })), W / 2 - 0.5, 0.45, 3.5, Math.PI / 2));
  // Outside: courtyard gravel and a garden seen through the slot and the open front.
  g.add(landscape({ inner: 18, outer: 60, trees: 70, seed: 9 }));
  return { group: g, occluders, floorSize: [W, D] };
}

function buildPavilion() {
  const g = group('Glass pavilion'), occluders = [];
  const W = 22, D = 15, H = 4.3, plinth = 0.5;
  // Stone plinth with steps at the front.
  const stoneMat = finish('stone', { w: W, h: 1 });
  const base = mesh(slab(roundedRect(W + 1.2, D + 1.2, 0.05), plinth, 0.015), stoneMat);
  base.position.y = -plinth;
  g.add(base);
  for (let k = 1; k <= 3; k++) g.add(at(mesh(box(6, plinth - k * (plinth / 3), 0.4), stoneMat), 0, -plinth, (D + 1.2) / 2 + k * 0.4 - 0.2));
  // Columns and glass between them: slim black steel, frameless panes with top and bottom channels.
  const steel = finish('blackSteel');
  const glass = finish({ colour: '#e2edf2', roughness: 0.02, opacity: 0.12, clearcoat: 1 }, { side: THREE.DoubleSide });
  const xs = [], zs = [];
  for (let i = 0; i <= 6; i++) xs.push(-W / 2 + (W / 6) * i);
  for (let i = 0; i <= 4; i++) zs.push(-D / 2 + (D / 4) * i);
  const posts = [];
  for (const x of xs) for (const z of [-D / 2, D / 2]) posts.push([x, z]);
  for (const z of zs.slice(1, -1)) for (const x of [-W / 2, W / 2]) posts.push([x, z]);
  for (const [x, z] of posts) g.add(at(mesh(box(0.12, H, 0.12), steel), x, 0, z));
  const run = (a, b, along) => {
    for (let i = 0; i < a.length - 1; i++) {
      const len = a[i + 1] - a[i], mid = (a[i] + a[i + 1]) / 2;
      const pane = mesh(new THREE.PlaneGeometry(len - 0.14, H - 0.16), glass, { cast: false, receive: false });
      if (along === 'x') { pane.position.set(mid, H / 2, b); } else { pane.position.set(b, H / 2, mid); pane.rotation.y = Math.PI / 2; }
      g.add(pane); occluders.push(pane);
      for (const y of [0, H - 0.08]) { const ch = mesh(box(along === 'x' ? len : 0.08, 0.08, along === 'x' ? 0.08 : len), steel); ch.position.set(along === 'x' ? mid : b, y, along === 'x' ? b : mid); g.add(ch); }
    }
  };
  run(xs, -D / 2, 'x'); run(xs, D / 2, 'x'); run(zs, -W / 2, 'z'); run(zs, W / 2, 'z');
  // Floating roof: thin white slab with a deep overhang and recessed downlights.
  const roof = mesh(rbox(W + 4, 0.38, D + 4, 0.03), finish('paintWhite'));
  roof.position.y = H;
  g.add(roof); occluders.push(roof);
  const fascia = mesh(box(W + 4.02, 0.12, D + 4.02), steel); fascia.position.y = H + 0.3; g.add(fascia);
  const downs = [];
  for (let x = -W / 2 + 2; x <= W / 2 - 1.9; x += 3) for (let z = -D / 2 + 2; z <= D / 2 - 1.9; z += 2.75) downs.push([x, H - 0.002, z]);
  const disc = new THREE.CircleGeometry(0.11, 24).rotateX(Math.PI / 2);
  g.add(instances(disc, glow('#fff1df', 6), downs, { cast: false, receive: false }));
  g.add(landscape({ inner: 16, outer: 70, trees: 110, seed: 5, ground: -plinth }));
  return { group: g, occluders, floorSize: [W, D] };
}

function buildHorizon() {
  return { group: group('Open floor'), occluders: [], floorSize: [400, 400] };
}

// sky / sun / ambient are applied by the Lobby; `rig` names a light rig from Fixtures.js.
export const SETS = {
  studio: {
    label: 'Studio set', note: 'Photo studio: grey L-cove, lighting grid, black drapes',
    build: buildStudio, floor: 'studio', rig: 'softbox',
    sky: { zenith: '#050506', horizon: '#0d0d10', ground: '#08080a', haze: 0.1 },
    sun: { on: false, azimuth: 30, elevation: 60, intensity: 0, colour: '#ffffff', softness: 3 },
    ambient: { sky: '#9aa2b0', ground: '#1a1a1d', intensity: 0.12, reflections: 1, exposure: 1 },
    icon: '<path d="M3 20h18M4 20c0-6 0-10 1-12s3-2 15-2"/><path d="M8 4h12M10 4v2M14 4v2M18 4v2"/>',
  },
  garage: {
    label: 'Garage', note: 'Steel-framed workshop, roll-up doors, epoxy floor',
    build: buildGarage, floor: 'epoxy', rig: 'workshop',
    skyFill: [{ at: [-6, 6.3, 0], w: 2.2, h: 17, intensity: 5 }, { at: [6, 6.3, 0], w: 2.2, h: 17, intensity: 5 }],
    sky: { zenith: '#5d8fc4', horizon: '#cfdced', ground: '#8b8f94', haze: 0.4 },
    sun: { on: true, azimuth: 200, elevation: 34, intensity: 2.4, colour: '#fff1df', softness: 3 },
    ambient: { sky: '#d8e0ea', ground: '#4a4d52', intensity: 0.4, reflections: 0.9, exposure: 1 },
    icon: '<path d="M3 20V9l9-5 9 5v11"/><path d="M7 20v-8h10v8M7 14h10M7 17h10"/>',
  },
  atrium: {
    label: 'Minimal architecture', note: 'Board concrete atrium, oak slats, skylight, pool',
    build: buildAtrium, floor: 'stone', rig: 'daylight',
    skyFill: [{ at: [0, 6.9, 0], w: 14, h: 2.8, intensity: 9 }, { at: [-11.8, 1.9, -0.5], look: [0, 1.2, -0.5], w: 12, h: 2, intensity: 4, colour: '#e8f0e2' }],
    sky: { zenith: '#4c86c6', horizon: '#c9dbee', ground: '#9a9a94', haze: 0.35 },
    sun: { on: true, azimuth: 165, elevation: 66, intensity: 3.4, colour: '#fff3e4', softness: 2 },
    ambient: { sky: '#d3dcea', ground: '#6e6a62', intensity: 0.45, reflections: 0.85, exposure: 1 },
    icon: '<path d="M3 20h18M4 20V6h16v14"/><path d="M4 6h6M14 6h6M7 9h10M7 11h10"/>',
  },
  pavilion: {
    label: 'Glass pavilion', note: 'Glass box on a stone plinth in a garden',
    build: buildPavilion, floor: 'marble', rig: 'gallery',
    skyFill: [
      { at: [0, 2.1, 7.3], look: [0, 1, 0], w: 20, h: 3.4, intensity: 2.6, colour: '#e6efe0' }, { at: [0, 2.1, -7.3], look: [0, 1, 0], w: 20, h: 3.4, intensity: 2.2, colour: '#e6efe0' },
      { at: [10.8, 2.1, 0], look: [0, 1, 0], w: 13, h: 3.4, intensity: 2.2, colour: '#e6efe0' }, { at: [-10.8, 2.1, 0], look: [0, 1, 0], w: 13, h: 3.4, intensity: 2.2, colour: '#e6efe0' },
    ],
    sky: { zenith: '#3f7dc2', horizon: '#c4d9ee', ground: '#6d7a5c', haze: 0.3 },
    sun: { on: true, azimuth: 128, elevation: 38, intensity: 3, colour: '#fff4e6', softness: 2.5 },
    ambient: { sky: '#cfdcf0', ground: '#5d6650', intensity: 0.55, reflections: 0.95, exposure: 0.95 },
    icon: '<path d="M2 8h20M4 8v12M20 8v12M9 8v12M15 8v12M3 20h18"/>',
  },
  horizon: {
    label: 'Open floor', note: 'Endless floor fading into the sky',
    build: buildHorizon, floor: 'concrete', rig: 'daylight',
    sky: { zenith: '#93b3d3', horizon: '#e3e9ee', ground: '#b9bec4', haze: 0.6 },
    sun: { on: true, azimuth: 118, elevation: 32, intensity: 3, colour: '#fff4e6', softness: 3 },
    ambient: { sky: '#d7e0ec', ground: '#7d848c', intensity: 0.5, reflections: 0.9, exposure: 0.95 },
    icon: '<path d="M2 14h20M5 18h14M8 21h8"/><circle cx="17" cy="7" r="2.5"/>',
  },
};

export function buildSet(id) {
  const def = SETS[id] || SETS.studio;
  const built = def.build();
  // Glass and other see-through surfaces never block the sun.
  built.group.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some((m) => m && (m.transparent || m.transmission > 0))) o.castShadow = false;
  });
  // Sky light through skylights, glazing and roll-up doors: soft area lights facing down/in, no shadows.
  for (const f of def.skyFill || []) {
    prepareAreaLights();
    const l = new THREE.RectAreaLight(f.colour || '#dfe8f5', f.intensity, f.w, f.h);
    l.position.set(...f.at);
    l.lookAt(...(f.look || [f.at[0], 0, f.at[2]]));
    l.userData.skyFill = true;
    built.group.add(l);
  }
  return built;
}

export { tiled, mergeGeometries, rad };
