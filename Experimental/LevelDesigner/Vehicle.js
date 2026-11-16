// The ControlVehicle placed in a level: the three Vehicle Lab facet streams (body, rim, tyre) and the Component
// Viewer's procedural rear wing, assembled exactly like BP_ControlVehicle (Experimental/ComponentViewer/Main.js) but
// built straight into three.js geometry — no compile workers, so a level opens in a few hundred milliseconds.
//
// Every part keeps one material per CourseMaterial family, and every material is the part's own, so the configurator
// can repaint the tyres without touching the dark interior of the body that shares the Tyre family.
import { THREE, VEHICLE_PALETTE } from '../Shared/Studio/Render.js';
import { fetchModel } from '../Shared/GeometryCompile/CompileSources.js';
import { readFacet } from '../Shared/GeometryCompile/Engine/ImportFormats.js';
import { convertSource, cornerNormals } from '../Shared/GeometryCompile/Engine/MeshAnalysis.js';

// Vehicle Lab sheet (Experimental/ComponentViewer/Blueprint.js · VEHICLE_SHEET), authored Z-up.
export const VEHICLE_SHEET = {
  axleMount: [[1.7274, 1.0475, 0.0914], [1.7274, -1.0475, 0.0914], [-1.6686, 1.0475, 0.0914], [-1.6686, -1.0475, 0.0914]],
  tyreRadius: 0.50855,
  groundOffset: 0.50855 - 0.0914,
  wingDock: [-2.9822, 0.8367, 0],
};

const PARTS = [
  { key: 'body', file: 'ControlVehicleBody.facet', normals: 'angle', up: 'z' },
  { key: 'tyre', file: 'ControlVehicleTyre.facet', normals: 'smooth', up: 'z' },
  { key: 'rim', file: 'ControlVehicleRim.facet', normals: 'angle', up: 'z' },
  { key: 'wing', build: buildWing, normals: 'angle', up: 'y' },
];

// Rear wing from the Component Viewer (8° angle of attack, endplates flush with the body sides, gurney flap).
const WING = { aoa: 8, bodyHalfWidth: 1.2498, chordHalf: 0.17, planeHalfThick: 0.016, plateHalfThick: 0.008, planeY: 0.25 };
function buildWing() {
  const pos = [], idx = [], fam = [];
  const box = (c, h, family, tilt = 0) => {
    const base = pos.length / 3, cs = Math.cos(tilt), sn = Math.sin(tilt);
    for (let i = 0; i < 8; i++) {
      const x = (i & 1 ? 1 : -1) * h[0], y = (i & 2 ? 1 : -1) * h[1], z = (i & 4 ? 1 : -1) * h[2];
      pos.push(c[0] + x * cs - y * sn, c[1] + x * sn + y * cs, c[2] + z);
    }
    const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
    for (const [a, b, c2, d] of quads) { idx.push(base + a, base + b, base + c2, base + a, base + c2, base + d); fam.push(family, family); }
  };
  const { aoa, bodyHalfWidth, chordHalf, planeHalfThick, plateHalfThick, planeY } = WING;
  const tilt = -aoa * Math.PI / 180;
  const plateZ = bodyHalfWidth - plateHalfThick;
  const span = plateZ - plateHalfThick;
  box([0, planeY, 0], [chordHalf, planeHalfThick, span], 8, tilt);
  const te = [-chordHalf * Math.cos(tilt) - planeHalfThick * Math.sin(tilt), planeY - chordHalf * Math.sin(tilt) + planeHalfThick * Math.cos(tilt)];
  box([te[0] + 0.008 * Math.cos(tilt) - 0.022 * Math.sin(tilt), te[1] + 0.008 * Math.sin(tilt) + 0.022 * Math.cos(tilt), 0], [0.008, 0.022, span], 6, tilt);
  for (const z of [-plateZ, plateZ]) box([-0.01, 0.23, z], [0.2, 0.1, plateHalfThick], 6);
  for (const z of [-0.56, 0.56]) box([0.02, 0.11, z], [0.05, 0.11, 0.01], 10);
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), families: new Uint32Array(fam) };
}

// Raw facet triangles → non-indexed BufferGeometry, one group per family, plus the family list in group order.
export function geometryFromRaw(raw, { up = 'y', normals = 'angle' } = {}) {
  const src = convertSource(raw, { up });
  const nor = cornerNormals(src.positions, src.indices, normals, 40);
  const tris = src.indices.length / 3;
  const fam = src.families || new Uint32Array(tris);
  const order = Array.from({ length: tris }, (_, i) => i).sort((a, b) => fam[a] - fam[b] || a - b);
  const pos = new Float32Array(tris * 9), n = new Float32Array(tris * 9);
  const geo = new THREE.BufferGeometry();
  const families = [];
  let start = 0, current = fam[order[0]];
  families.push(current);
  for (let i = 0; i < tris; i++) {
    const t = order[i];
    if (fam[t] !== current) { geo.addGroup(start * 3, (i - start) * 3, families.length - 1); start = i; current = fam[t]; families.push(current); }
    for (let k = 0; k < 3; k++) {
      const v = src.indices[t * 3 + k] * 3;
      pos[i * 9 + k * 3] = src.positions[v]; pos[i * 9 + k * 3 + 1] = src.positions[v + 1]; pos[i * 9 + k * 3 + 2] = src.positions[v + 2];
      n.set(nor.subarray(t * 9 + k * 3, t * 9 + k * 3 + 3), i * 9 + k * 3);
    }
  }
  geo.addGroup(start * 3, (tris - start) * 3, families.length - 1);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return { geometry: geo, families };
}

const linear = (rgb) => '#' + new THREE.Color().setRGB(...rgb, THREE.LinearSRGBColorSpace).getHexString();

// Showroom materials per family: the paint is a clear-coated physical material, glass is dark and glossy.
function familyMaterial(family) {
  const spec = VEHICLE_PALETTE[family] || VEHICLE_PALETTE[15];
  const params = { color: linear(spec.albedo), roughness: spec.roughness, metalness: spec.metalness };
  if (spec.emission) { params.emissive = linear(spec.emission); params.emissiveIntensity = family === 13 ? 2.2 : 1.4; }
  if (family === 6) return new THREE.MeshPhysicalMaterial({ ...params, roughness: 0.32, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.06 });
  if (family === 7) return new THREE.MeshPhysicalMaterial({ ...params, roughness: 0.04, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 });
  if (family === 10) return new THREE.MeshStandardMaterial({ ...params, emissive: '#000000' });
  return new THREE.MeshStandardMaterial(params);
}

// Finishes: paint sheen presets (roughness / metalness / clear coat).
export const FINISHES = {
  gloss: { label: 'Gloss', roughness: 0.32, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 },
  metallic: { label: 'Metallic', roughness: 0.24, metalness: 0.85, clearcoat: 1, clearcoatRoughness: 0.08 },
  satin: { label: 'Satin', roughness: 0.55, metalness: 0.25, clearcoat: 0.35, clearcoatRoughness: 0.45 },
  matte: { label: 'Matte', roughness: 0.82, metalness: 0.05, clearcoat: 0, clearcoatRoughness: 1 },
};

export class ControlVehicle {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'ControlVehicle';
    this.body = new THREE.Group();          // body-local frame: Vehicle Lab sockets are expressed in it
    this.body.position.y = VEHICLE_SHEET.groundOffset;
    this.root.add(this.body);
    this.materials = {};                    // part → family → material
    this.meshes = [];
    this.wheels = [];
    this.finish = 'gloss';
  }

  async load(report = () => {}) {
    const built = {};
    let i = 0;
    for (const part of PARTS) {
      report(part.file ? `Reading ${part.file}` : 'Building rear wing', i / PARTS.length);
      const raw = part.build ? part.build() : readFacet(await fetchModel(part.file));
      built[part.key] = geometryFromRaw(raw, part);
      i++;
    }
    const mats = (key) => {
      this.materials[key] = {};
      return built[key].families.map((f) => (this.materials[key][f] = familyMaterial(f)));
    };
    const mesh = (key, materials) => {
      const m = new THREE.Mesh(built[key].geometry, materials);
      m.castShadow = true; m.receiveShadow = true;
      m.userData.part = key;
      this.meshes.push(m);
      return m;
    };
    this.body.add(mesh('body', mats('body')));
    const tyreMats = mats('tyre'), rimMats = mats('rim');
    for (const m of VEHICLE_SHEET.axleMount) {
      const wheel = new THREE.Group();
      wheel.position.set(m[0], m[2], -m[1]);
      if (m[1] < 0) wheel.rotation.y = Math.PI;           // right-hand wheels face outward
      wheel.add(mesh('tyre', tyreMats), mesh('rim', rimMats));
      this.body.add(wheel);
      this.wheels.push(wheel);
    }
    const d = VEHICLE_SHEET.wingDock;
    const wing = mesh('wing', mats('wing'));
    wing.position.set(d[0], d[1], d[2]);
    this.body.add(wing);
    this.wing = wing;
    this.root.updateMatrixWorld(true);
    this.bounds = new THREE.Box3().setFromObject(this.root);
    return this;
  }

  material(part, family) { return this.materials[part] && this.materials[part][family]; }

  colour(part, family) {
    const m = this.material(part, family);
    if (!m) return '#000000';
    return '#' + (family === 13 || family === 14 ? m.emissive : m.color).getHexString();
  }

  setColour(part, family, hex) {
    const m = this.material(part, family);
    if (!m) return;
    if (family === 13 || family === 14) { m.emissive.set(hex); m.color.set(hex).lerp(new THREE.Color('#ffffff'), 0.6); }
    else m.color.set(hex);
  }

  setFinish(name) {
    const f = FINISHES[name];
    if (!f) return;
    this.finish = name;
    for (const part of ['body', 'wing']) {
      const m = this.material(part, 6);
      if (!m) continue;
      m.roughness = f.roughness; m.metalness = f.metalness;
      if ('clearcoat' in m) { m.clearcoat = f.clearcoat; m.clearcoatRoughness = f.clearcoatRoughness; }
    }
  }

  // Triangles drawn for the readout.
  get triangles() {
    let n = 0;
    for (const m of this.meshes) n += m.geometry.attributes.position.count / 3;
    return n;
  }
}
