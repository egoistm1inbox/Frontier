// Lobby props: parametric showroom pieces (plinths, slabs, arches, rope barriers, lamps, screens…). Every prop is a
// type + a parameter set + a surface, so a placed prop can be resized, restyled or swapped for another type in place.
// build() returns a Group whose origin sits on the floor at the prop's footprint centre.
import { THREE } from '../Shared/Studio/Render.js';

// Surface presets. `custom` is what a preset becomes after the colour or sliders are edited.
export const SURFACES = {
  gallery: { label: 'Gallery white', colour: '#eef1f5', roughness: 0.85, metalness: 0 },
  concrete: { label: 'Concrete', colour: '#8e9092', roughness: 0.92, metalness: 0 },
  metal: { label: 'Brushed metal', colour: '#b8bcc2', roughness: 0.32, metalness: 1 },
  black: { label: 'Gloss black', colour: '#101113', roughness: 0.14, metalness: 0, clearcoat: 1 },
  wood: { label: 'Warm wood', colour: '#8a5a35', roughness: 0.62, metalness: 0 },
  glass: { label: 'Frosted glass', colour: '#dbe6ee', roughness: 0.18, metalness: 0, opacity: 0.38 },
};

const P = (label, value, min, max, step = 0.05, unit = 'm') => ({ label, value, min, max, step, unit });

function mesh(geometry, material) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function roundedRect(w, d, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
  r = Math.min(r, w / 2 - 0.01, d / 2 - 0.01);
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export const PROPS = {
  plinth: {
    label: 'Plinth', icon: 'plinth', note: 'Round display base', surface: 'gallery',
    params: { radius: P('Radius', 0.9, 0.2, 4), height: P('Height', 0.5, 0.05, 2) },
    build: (p, mat) => { const g = new THREE.Group(); g.add(mesh(new THREE.CylinderGeometry(p.radius, p.radius, p.height, 72).translate(0, p.height / 2, 0), mat)); return g; },
  },
  stage: {
    label: 'Stage', icon: 'floor', note: 'Low rounded platform', surface: 'black',
    params: { width: P('Width', 7, 1, 16, 0.1), depth: P('Depth', 4.4, 1, 12, 0.1), height: P('Height', 0.14, 0.02, 1, 0.01), corner: P('Corner', 0.6, 0, 3) },
    build: (p, mat) => {
      const geo = new THREE.ExtrudeGeometry(roundedRect(p.width, p.depth, p.corner), { depth: p.height, bevelEnabled: false, curveSegments: 16 });
      geo.rotateX(-Math.PI / 2);
      const g = new THREE.Group(); g.add(mesh(geo, mat)); return g;
    },
  },
  block: {
    label: 'Block', icon: 'cube', note: 'Box, any size', surface: 'gallery',
    params: { width: P('Width', 1.2, 0.1, 8), height: P('Height', 1.2, 0.1, 8), depth: P('Depth', 1.2, 0.1, 8) },
    build: (p, mat) => { const g = new THREE.Group(); g.add(mesh(new THREE.BoxGeometry(p.width, p.height, p.depth).translate(0, p.height / 2, 0), mat)); return g; },
  },
  panel: {
    label: 'Wall slab', icon: 'panel', note: 'Standing slab, can lean', surface: 'gallery',
    params: { width: P('Width', 3, 0.3, 14, 0.1), height: P('Height', 3.2, 0.3, 9, 0.1), thickness: P('Thickness', 0.18, 0.03, 1.5, 0.01), lean: P('Lean', 0, -30, 30, 1, '°') },
    build: (p, mat) => {
      const g = new THREE.Group();
      const m = mesh(new THREE.BoxGeometry(p.width, p.height, p.thickness).translate(0, p.height / 2, 0), mat);
      m.rotation.x = THREE.MathUtils.degToRad(-p.lean);
      g.add(m); return g;
    },
  },
  arch: {
    label: 'Arch', icon: 'arch', note: 'Doorway frame', surface: 'gallery',
    params: { width: P('Width', 3.2, 1, 10, 0.1), height: P('Height', 3.8, 1.2, 9, 0.1), thickness: P('Frame', 0.4, 0.1, 1.5), depth: P('Depth', 0.3, 0.05, 2) },
    build: (p, mat) => {
      const R = p.width / 2, r = Math.max(0.05, R - p.thickness), leg = Math.max(0.01, p.height - R);
      const s = new THREE.Shape();
      s.moveTo(-R, 0); s.lineTo(-R, leg); s.absarc(0, leg, R, Math.PI, 0, true); s.lineTo(R, 0); s.lineTo(r, 0); s.lineTo(r, leg);
      s.absarc(0, leg, r, 0, Math.PI, false); s.lineTo(-r, 0); s.lineTo(-R, 0);
      const g = new THREE.Group();
      g.add(mesh(new THREE.ExtrudeGeometry(s, { depth: p.depth, bevelEnabled: false, curveSegments: 40 }).translate(0, 0, -p.depth / 2), mat));
      return g;
    },
  },
  column: {
    label: 'Column', icon: 'capsule', note: 'Round pillar', surface: 'gallery',
    params: { radius: P('Radius', 0.3, 0.05, 2), height: P('Height', 3.6, 0.3, 10, 0.1) },
    build: (p, mat) => { const g = new THREE.Group(); g.add(mesh(new THREE.CylinderGeometry(p.radius, p.radius, p.height, 48).translate(0, p.height / 2, 0), mat)); return g; },
  },
  sphere: {
    label: 'Sphere', icon: 'sphere', note: 'Ball or dome', surface: 'gallery',
    params: { radius: P('Radius', 0.6, 0.05, 4), sink: P('Sunk into floor', 0, 0, 1, 0.01, '×') },
    build: (p, mat) => { const g = new THREE.Group(); g.add(mesh(new THREE.SphereGeometry(p.radius, 56, 28).translate(0, p.radius * (1 - 2 * p.sink), 0), mat)); return g; },
  },
  ramp: {
    label: 'Ramp', icon: 'arrow', note: 'Wedge to tilt a car up', surface: 'concrete',
    params: { width: P('Width', 2.4, 0.3, 8, 0.1), length: P('Length', 3, 0.3, 10, 0.1), height: P('Height', 0.45, 0.05, 3) },
    build: (p, mat) => {
      const s = new THREE.Shape();
      s.moveTo(-p.length / 2, 0); s.lineTo(p.length / 2, 0); s.lineTo(p.length / 2, p.height); s.lineTo(-p.length / 2, 0);
      const g = new THREE.Group();
      g.add(mesh(new THREE.ExtrudeGeometry(s, { depth: p.width, bevelEnabled: false }).translate(0, 0, -p.width / 2), mat));
      return g;
    },
  },
  bench: {
    label: 'Bench', icon: 'block', note: 'Seat for the showroom', surface: 'wood',
    params: { length: P('Length', 1.8, 0.4, 5, 0.1), height: P('Height', 0.45, 0.2, 1, 0.01), depth: P('Depth', 0.5, 0.2, 1.2, 0.01) },
    build: (p, mat) => {
      const g = new THREE.Group();
      g.add(mesh(new THREE.BoxGeometry(p.length, 0.08, p.depth).translate(0, p.height - 0.04, 0), mat));
      const legs = new THREE.MeshStandardMaterial({ color: '#1a1b1e', roughness: 0.4, metalness: 0.8 });
      for (const x of [-p.length / 2 + 0.12, p.length / 2 - 0.12]) g.add(mesh(new THREE.BoxGeometry(0.06, p.height - 0.08, p.depth * 0.9).translate(x, (p.height - 0.08) / 2, 0), legs));
      return g;
    },
  },
  barrier: {
    label: 'Rope barrier', icon: 'link', note: 'Two posts and a rope', surface: 'metal',
    params: { span: P('Span', 2.4, 0.6, 6, 0.1), height: P('Post height', 0.95, 0.4, 1.6, 0.01), sag: P('Rope sag', 0.18, 0, 0.6, 0.01) },
    build: (p, mat) => {
      const g = new THREE.Group();
      for (const x of [-p.span / 2, p.span / 2]) {
        g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, p.height, 16).translate(x, p.height / 2, 0), mat));
        g.add(mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.04, 32).translate(x, 0.02, 0), mat));
        g.add(mesh(new THREE.SphereGeometry(0.05, 16, 10).translate(x, p.height + 0.03, 0), mat));
      }
      const y = p.height - 0.06;
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-p.span / 2, y, 0), new THREE.Vector3(0, y - p.sag * 2, 0), new THREE.Vector3(p.span / 2, y, 0));
      g.add(mesh(new THREE.TubeGeometry(curve, 40, 0.022, 8, false), new THREE.MeshStandardMaterial({ color: '#7a0f16', roughness: 0.7 })));
      return g;
    },
  },
  lamp: {
    label: 'Floor lamp', icon: 'bulb', note: 'Standing lamp that lights the room', surface: 'black',
    params: { height: P('Height', 1.8, 0.6, 3.5), glow: P('Brightness', 8, 0, 40, 0.5, '') },
    build: (p, mat, prop) => {
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 32).translate(0, 0.015, 0), mat));
      g.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, p.height, 12).translate(0, p.height / 2, 0), mat));
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.3, 32, 1, true).translate(0, p.height, 0), new THREE.MeshStandardMaterial({ color: '#f6efe2', emissive: '#ffe6bf', emissiveIntensity: Math.min(1.5, p.glow / 6), side: THREE.DoubleSide }));
      g.add(shade);
      const light = new THREE.PointLight('#ffe2b8', p.glow, 9, 2);
      light.position.y = p.height - 0.05;
      g.add(light);
      return g;
    },
  },
  screen: {
    label: 'Display screen', icon: 'viewport', note: 'Glowing wall screen on a stand', surface: 'black',
    params: { width: P('Width', 2.6, 0.5, 8, 0.1), height: P('Height', 1.5, 0.3, 4.5, 0.05), lift: P('Lift', 0.9, 0, 3, 0.05), glow: P('Brightness', 1, 0, 3, 0.05, '') },
    build: (p, mat) => {
      const g = new THREE.Group();
      g.add(mesh(new THREE.BoxGeometry(p.width + 0.08, p.height + 0.08, 0.08).translate(0, p.lift + p.height / 2, 0), mat));
      const face = new THREE.Mesh(new THREE.PlaneGeometry(p.width, p.height).translate(0, p.lift + p.height / 2, 0.041), new THREE.MeshBasicMaterial({ color: new THREE.Color('#9cc4ff').multiplyScalar(p.glow), toneMapped: false }));
      g.add(face);
      if (p.lift > 0.05) g.add(mesh(new THREE.BoxGeometry(0.12, p.lift, 0.12).translate(0, p.lift / 2, -0.06), mat), mesh(new THREE.BoxGeometry(0.7, 0.04, 0.5).translate(0, 0.02, -0.06), mat));
      return g;
    },
  },
  planter: {
    label: 'Planter', icon: 'sphere', note: 'Pot with a round shrub', surface: 'concrete',
    params: { radius: P('Radius', 0.38, 0.15, 1.5, 0.01), height: P('Pot height', 0.6, 0.2, 1.5, 0.01), shrub: P('Shrub size', 0.55, 0.1, 2, 0.01) },
    build: (p, mat) => {
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(p.radius, p.radius * 0.8, p.height, 40).translate(0, p.height / 2, 0), mat));
      g.add(mesh(new THREE.IcosahedronGeometry(p.shrub, 2).translate(0, p.height + p.shrub * 0.8, 0), new THREE.MeshStandardMaterial({ color: '#3f6b3a', roughness: 0.95, flatShading: true })));
      return g;
    },
  },
  rug: {
    label: 'Floor mat', icon: 'floor', note: 'Flat mat under the car', surface: 'concrete',
    params: { width: P('Width', 7.5, 0.5, 16, 0.1), depth: P('Depth', 4.2, 0.5, 12, 0.1), corner: P('Corner', 0.3, 0, 3) },
    build: (p, mat) => {
      const geo = new THREE.ShapeGeometry(roundedRect(p.width, p.depth, p.corner), 12).rotateX(-Math.PI / 2).translate(0, 0.004, 0);
      const m = new THREE.Mesh(geo, mat); m.receiveShadow = true;
      const g = new THREE.Group(); g.add(m); return g;
    },
  },
};

export function defaultParams(type) {
  return Object.fromEntries(Object.entries(PROPS[type].params).map(([k, d]) => [k, d.value]));
}

export function surfaceMaterial(surface) {
  const m = new THREE.MeshPhysicalMaterial({ color: surface.colour, roughness: surface.roughness, metalness: surface.metalness, clearcoat: surface.clearcoat || 0 });
  if (surface.opacity !== undefined && surface.opacity < 1) { m.transparent = true; m.opacity = surface.opacity; m.depthWrite = false; }
  return m;
}
