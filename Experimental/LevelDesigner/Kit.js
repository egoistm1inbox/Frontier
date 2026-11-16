// Building blocks shared by the sets, the scene pieces and the light fixtures: materials (finishes with procedural
// textures), rounded boxes, lathe profiles, tubes and small placement helpers. Everything is built at real-world
// scale in metres, origin on the floor.
import { THREE } from '../Shared/Studio/Render.js';
import { RoundedBoxGeometry } from './Vendor/RoundedBoxGeometry.js';
import { mergeGeometries } from './Vendor/BufferGeometryUtils.js';
import { tiled, surfaceTextures } from './Textures.js';

export { THREE, mergeGeometries };
export const rad = THREE.MathUtils.degToRad;

// Finishes: named material recipes. `texture` = a procedural surface from Textures.js, `metres` its tile size.
export const FINISHES = {
  paintWhite: { label: 'Matte white', colour: '#e9eaec', roughness: 0.8 },
  paintGrey: { label: 'Studio grey', colour: '#7c7f84', roughness: 0.85 },
  paintCharcoal: { label: 'Charcoal', colour: '#2b2c2f', roughness: 0.75 },
  satinBlack: { label: 'Satin black', colour: '#141416', roughness: 0.45, clearcoat: 0.4 },
  glossBlack: { label: 'Gloss black', colour: '#0c0c0e', roughness: 0.12, clearcoat: 1 },
  concrete: { label: 'Concrete', colour: '#ffffff', roughness: 0.85, texture: 'concrete' },
  boardConcrete: { label: 'Board concrete', colour: '#ffffff', roughness: 0.92, texture: 'boardConcrete', bump: 0.6 },
  plaster: { label: 'Lime plaster', colour: '#ffffff', roughness: 0.95, texture: 'plaster' },
  oak: { label: 'Oak', colour: '#ffffff', roughness: 0.6, texture: 'oak', metres: 2, bump: 0.25 },
  walnut: { label: 'Walnut', colour: '#7a5a44', roughness: 0.55, texture: 'oak', metres: 2, bump: 0.25 },
  marble: { label: 'Marble', colour: '#ffffff', roughness: 0.18, texture: 'marble', clearcoat: 0.5 },
  terrazzo: { label: 'Terrazzo', colour: '#ffffff', roughness: 0.4, texture: 'terrazzo' },
  brushed: { label: 'Brushed steel', colour: '#ffffff', roughness: 0.35, metalness: 1, texture: 'brushed' },
  chrome: { label: 'Chrome', colour: '#f2f4f6', roughness: 0.06, metalness: 1 },
  blackSteel: { label: 'Black steel', colour: '#1e1f22', roughness: 0.42, metalness: 0.85 },
  aluminium: { label: 'Aluminium', colour: '#c9ccd0', roughness: 0.3, metalness: 1 },
  brass: { label: 'Brass', colour: '#c9a46a', roughness: 0.28, metalness: 1 },
  redEnamel: { label: 'Red enamel', colour: '#b3191e', roughness: 0.28, clearcoat: 0.8 },
  safetyYellow: { label: 'Safety yellow', colour: '#f2b705', roughness: 0.5 },
  fabricSand: { label: 'Sand fabric', colour: '#c8b9a2', roughness: 0.95, texture: 'fabric', metres: 0.25, sheen: 1 },
  fabricSlate: { label: 'Slate fabric', colour: '#555b63', roughness: 0.95, texture: 'fabric', metres: 0.25, sheen: 1 },
  leather: { label: 'Cognac leather', colour: '#8b4a26', roughness: 0.5, clearcoat: 0.3 },
  rubber: { label: 'Rubber', colour: '#151517', roughness: 0.88 },
  glass: { label: 'Clear glass', colour: '#e8f0f4', roughness: 0.03, opacity: 0.16, clearcoat: 1 },
  smokedGlass: { label: 'Smoked glass', colour: '#3a4046', roughness: 0.05, opacity: 0.45, clearcoat: 1 },
  frosted: { label: 'Frosted glass', colour: '#eef3f6', roughness: 0.35, opacity: 0.55 },
  bark: { label: 'Bark', colour: '#ffffff', roughness: 0.95, texture: 'bark', metres: 0.6, bump: 1 },
  soil: { label: 'Soil', colour: '#2e241c', roughness: 1 },
  terracotta: { label: 'Terracotta', colour: '#b0613d', roughness: 0.85 },
  stone: { label: 'Honed stone', colour: '#ffffff', roughness: 0.5, texture: 'stone' },
};

// A material for a finish (name or recipe), optionally with texture repeat sized for a w × h surface.
export function finish(spec, { w = 1, h = 1, side } = {}) {
  const f = typeof spec === 'string' ? FINISHES[spec] : spec;
  side = side ?? f.side ?? THREE.FrontSide;
  const m = new THREE.MeshPhysicalMaterial({
    color: f.colour || '#ffffff', roughness: f.roughness ?? 0.6, metalness: f.metalness ?? 0,
    clearcoat: f.clearcoat || 0, clearcoatRoughness: 0.12, side,
  });
  if (f.sheen) { m.sheen = f.sheen; m.sheenRoughness = 0.7; m.sheenColor = new THREE.Color(f.colour).lerp(new THREE.Color('#ffffff'), 0.4); }
  if (f.texture) {
    const t = tiled(f.texture, w, h, f.metres || null);
    if (t.map) m.map = t.map;
    if (t.roughnessMap) m.roughnessMap = t.roughnessMap;
    if (t.bumpMap) { m.bumpMap = t.bumpMap; m.bumpScale = f.bump ?? 0.5; }
  }
  if (f.opacity !== undefined && f.opacity < 1) { m.transparent = true; m.opacity = f.opacity; m.depthWrite = false; m.envMapIntensity = 1.4; }
  if (f.emissive) { m.emissive = new THREE.Color(f.emissive); m.emissiveIntensity = f.emissiveIntensity ?? 1; }
  return m;
}

// Unlit glowing material (lamp faces, diffusers, LED lines); `power` > 1 blooms past white before tone mapping.
export function glow(colour = '#ffffff', power = 4) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(colour).multiplyScalar(power), toneMapped: true });
}

export function mesh(geometry, material, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = cast; m.receiveShadow = receive;
  return m;
}

// Rounded box with its base on y = 0 (or centred if `centre`).
export function rbox(w, h, d, r = 0.02, { centre = false, segments = 3 } = {}) {
  const g = new RoundedBoxGeometry(w, h, d, segments, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  if (!centre) g.translate(0, h / 2, 0);
  return g;
}

export function box(w, h, d, { centre = false } = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (!centre) g.translate(0, h / 2, 0);
  return g;
}

export function cyl(rTop, rBottom, h, { segments = 32, centre = false, open = false } = {}) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, segments, 1, open);
  if (!centre) g.translate(0, h / 2, 0);
  return g;
}

// Lathe from a list of [radius, height] points (bottom to top).
export function lathe(points, segments = 48) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

export function tube(points, radius, { segments = 48, radial = 10, closed = false } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed);
  return new THREE.TubeGeometry(curve, segments, radius, radial, closed);
}

// Straight pipe between two points.
export function pipe(a, b, radius, material, radial = 12) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const m = mesh(new THREE.CylinderGeometry(radius, radius, len, radial), material);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return m;
}

export function at(object, x = 0, y = 0, z = 0, ry = 0) {
  object.position.set(x, y, z);
  if (ry) object.rotation.y = ry;
  return object;
}

export function group(name, ...kids) {
  const g = new THREE.Group();
  g.name = name;
  for (const k of kids) if (k) g.add(k);
  return g;
}

// Rounded-rectangle shape centred on the origin.
export function roundedRect(w, d, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
  r = Math.max(0.001, Math.min(r, w / 2 - 0.001, d / 2 - 0.001));
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// Floor slab from a shape (plan) extruded `h` up from y = 0, with a small edge bevel.
export function slab(shape, h, bevel = 0.01) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.001, h - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 24 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel, 0);
  return g;
}

// A deterministic random stream (so a tree or a stack of tyres looks the same after a reload).
export function seeded(seed) {
  let s = (seed * 2654435761) >>> 0 || 7;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

// Colour of a black body at `kelvin` (Tanner Helland's fit), as a THREE.Color in linear space.
export function kelvinColour(kelvin) {
  const t = kelvin / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
  else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); b = 255; }
  const c = (v) => Math.min(255, Math.max(0, v)) / 255;
  return new THREE.Color().setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace);
}

// Instanced foliage cards (crossed quads with the procedural leaf texture) scattered in an ellipsoid.
export function foliage({ count = 220, radius = [1.4, 1.1, 1.4], centre = [0, 2.6, 0], size = 0.7, seed = 1, tint = '#ffffff' } = {}) {
  const tex = surfaceTextures('leaves').map;
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, color: tint });
  const card = new THREE.PlaneGeometry(size, size);
  const inst = new THREE.InstancedMesh(card, mat, count);
  inst.castShadow = true; inst.receiveShadow = true;
  const r = seeded(seed), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const colour = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // Denser at the shell so the crown reads as a mass, with some cards inside.
    const u = r() * 2 - 1, th = r() * Math.PI * 2, shell = 0.55 + Math.pow(r(), 0.4) * 0.45;
    const k = Math.sqrt(1 - u * u);
    p.set(centre[0] + Math.cos(th) * k * radius[0] * shell, centre[1] + u * radius[1] * shell, centre[2] + Math.sin(th) * k * radius[2] * shell);
    e.set(r() * Math.PI, r() * Math.PI * 2, r() * Math.PI);
    q.setFromEuler(e);
    const sc = 0.7 + r() * 0.6;
    s.set(sc, sc, sc);
    m.compose(p, q, s);
    inst.setMatrixAt(i, m);
    // Lighter on top, darker underneath: cheap self-shadowing.
    const lift = 0.62 + (u * 0.5 + 0.5) * 0.45 + r() * 0.1;
    inst.setColorAt(i, colour.setRGB(lift, lift, lift * 0.95));
  }
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  return inst;
}

// Simple text plate (signage) drawn on a canvas.
export function signTexture(lines, { width = 512, height = 256, bg = '#1a1b1e', fg = '#f2f2f2', accent = '#f2b705', font = 'DM Sans, Arial, sans-serif' } = {}) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = accent; ctx.fillRect(0, 0, 18, height);
  ctx.fillStyle = fg;
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => {
    ctx.font = `${i === 0 ? 700 : 500} ${i === 0 ? height * 0.34 : height * 0.14}px ${font}`;
    ctx.fillText(l, 48, height * (i === 0 ? 0.42 : 0.75));
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
