// Light fixtures: real lights in real housings. Softboxes and strip boxes on C-stands and the overhead diffusion frame
// are rectangular area lights (soft, wide reflections in the paint); fresnels, track spots and wall washers are shadowed
// spot lights with optional haze beams; pendants are point lights in a shade; the halo is a hung ring; workshop battens
// are rows of LED panels. Each fixture is a type + parameters, built like the scene pieces, and every light is aimed
// along the fixture's local +Z (turned by the placement's yaw, pitched by `tilt`).
//
// Rigs are light presets: a set of fixtures placed around the car (positions relative to the car, aimed at it).
import { THREE, rad, finish, glow, mesh, rbox, box, cyl, pipe, at, group, lathe, kelvinColour } from './Kit.js';
import { RectAreaLightUniformsLib } from './Vendor/RectAreaLightUniformsLib.js';

let areaLightsReady = false;
export function prepareAreaLights() { if (!areaLightsReady) { RectAreaLightUniformsLib.init(); areaLightsReady = true; } }

const N = (label, value, min, max, step = 0.05, unit = 'm') => ({ label, value, min, max, step, unit });
const C = (label, value) => ({ label, value, kind: 'colour' });
const B = (label, value) => ({ label, value, kind: 'toggle' });

const LIGHT = { kelvin: N('Temperature', 6300, 2200, 9000, 100, 'K'), gel: C('Gel', '#ffffff') };
const lightColour = (p) => kelvinColour(p.kelvin).multiply(new THREE.Color(p.gel));

// ------------------------------------------------------------------------------------------------- hardware
const steel = () => finish('blackSteel');
const chromeM = () => finish('chrome');

// C-stand: three legs, a riser to `height`, and a knuckle at the top.
function stand(height) {
  const g = group('Stand'), m = steel();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    g.add(pipe([0, 0.32, 0], [Math.cos(a) * 0.62, 0.02, Math.sin(a) * 0.62], 0.013, m, 8));
    g.add(at(mesh(cyl(0.025, 0.025, 0.03, { segments: 10 }), finish('rubber')), Math.cos(a) * 0.62, 0, Math.sin(a) * 0.62));
  }
  g.add(at(mesh(cyl(0.022, 0.022, height - 0.1, { segments: 12 }), chromeM()), 0, 0.1, 0));
  g.add(at(mesh(cyl(0.04, 0.04, 0.12, { segments: 12 }), m), 0, 0.26, 0));
  g.add(at(mesh(cyl(0.035, 0.035, 0.08, { segments: 12 }), m), 0, height - 0.05, 0));
  return g;
}

// Haze beam: an additive cone that fades along its length and toward its silhouette (fake volumetric light).
function beam(angleDeg, length, colour, strength) {
  const r = Math.tan(rad(angleDeg)) * length;
  const geo = new THREE.CylinderGeometry(0.04, r, length, 48, 1, true).translate(0, -length / 2, 0).rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColour: { value: new THREE.Color(colour) }, uStrength: { value: strength } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vT;
      void main(){ vT = uv.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColour; uniform float uStrength; varying vec3 vN; varying vec3 vV; varying float vT;
      void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6); float fall = pow(vT, 1.7);
        gl_FragColor = vec4(uColour * uStrength * edge * fall, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.raycast = () => {};
  m.userData.beam = true;
  return m;
}

function areaLight(colour, intensity, w, h) {
  prepareAreaLights();
  const l = new THREE.RectAreaLight(colour, intensity, w, h);
  l.lookAt(0, 0, 1);          // emit along the parent's +Z
  return l;
}

function spot(colour, intensity, angle, penumbra, shadow, reach = 30) {
  const l = new THREE.SpotLight(colour, intensity, reach, rad(angle), penumbra, 2);
  l.castShadow = shadow;
  l.shadow.mapSize.set(1024, 1024);
  l.shadow.bias = -0.0003; l.shadow.normalBias = 0.02;
  l.shadow.radius = 4;
  l.target.position.set(0, 0, 5);
  l.add(l.target);
  return l;
}

// Softbox head: a square frustum of black fabric with a glowing diffuser, a recessed inner baffle and an egg-crate.
function softboxHead(w, h, depth, colour, intensity, grid) {
  const head = group('Head');
  const fabric = finish({ colour: '#0d0d0f', roughness: 0.95, sheen: 0.6 }, { side: THREE.DoubleSide });
  const shell = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2 * 0.28, 1, 4, 1, true);
  shell.rotateY(Math.PI / 4); shell.rotateX(Math.PI / 2);
  const shellMesh = mesh(shell, fabric);
  shellMesh.scale.set(w, h, depth);
  shellMesh.position.z = -depth / 2;
  head.add(shellMesh);
  const back = mesh(box(0.18, 0.18, 0.1, { centre: true }), steel());
  back.position.z = -depth - 0.02;
  head.add(back);
  const diffuser = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.98, h * 0.98), glow(colour, 1.4 + intensity / 20));
  diffuser.position.z = 0.002;
  head.add(diffuser);
  if (grid) {
    const crate = finish({ colour: '#0b0b0c', roughness: 0.9 });
    const cell = 0.12;
    for (let x = -w / 2 + cell; x < w / 2 - 0.01; x += cell) head.add(at(mesh(box(0.006, h, 0.06, { centre: true }), crate, { cast: false }), x, 0, 0.035));
    for (let y = -h / 2 + cell; y < h / 2 - 0.01; y += cell) head.add(at(mesh(box(w, 0.006, 0.06, { centre: true }), crate, { cast: false }), 0, y, 0.035));
  }
  const l = areaLight(colour, intensity, w, h);
  l.position.z = 0.01;
  head.add(l);
  return { head, light: l, diffuser };
}

function softboxBuild(p) {
  const g = group('Softbox');
  const colour = lightColour(p);
  g.add(stand(p.standHeight));
  const yoke = group('Yoke');
  yoke.position.y = p.standHeight + 0.02;
  const arm = mesh(box(0.04, 0.04, 0.5, { centre: true }), steel());
  arm.position.z = -0.1;
  yoke.add(arm);
  const pitch = group('Pitch');
  pitch.rotation.x = rad(p.tilt);
  pitch.rotation.z = rad(p.roll || 0);
  const { head } = softboxHead(p.width, p.height, Math.min(p.width, p.height) * 0.55, colour, p.intensity, p.grid);
  pitch.add(head);
  pitch.position.z = 0.12;
  yoke.add(pitch);
  g.add(yoke);
  return g;
}

// ------------------------------------------------------------------------------------------------- fixtures
export const FIXTURES = {
  softbox: {
    label: 'Softbox', icon: 'softbox', note: 'Large soft key on a C-stand · area light',
    params: { width: N('Width', 1.4, 0.4, 3), height: N('Height', 1, 0.3, 3), standHeight: N('Stand height', 2.2, 0.8, 4), tilt: N('Tilt', 18, -30, 80, 1, '°'), intensity: N('Brightness', 26, 0, 120, 1, ''), ...LIGHT, grid: B('Egg-crate grid', false) },
    build: softboxBuild,
  },
  strip: {
    label: 'Strip box', icon: 'stripbox', note: 'Tall narrow softbox for rims · area light',
    params: { width: N('Width', 0.35, 0.15, 1), height: N('Height', 1.8, 0.6, 3.5), standHeight: N('Stand height', 1.8, 0.8, 4), tilt: N('Tilt', 0, -30, 80, 1, '°'), roll: N('Roll', 0, -90, 90, 1, '°'), intensity: N('Brightness', 34, 0, 150, 1, ''), ...LIGHT, grid: B('Egg-crate grid', true) },
    build: softboxBuild,
  },
  overhead: {
    label: 'Overhead frame', icon: 'overhead', note: 'Huge diffusion frame over the car · area light',
    params: { width: N('Length', 6, 2, 12, 0.1), depth: N('Width', 2.8, 1, 6, 0.1), hang: N('Height', 4.6, 2.6, 8, 0.05), intensity: N('Brightness', 9, 0, 40, 0.5, ''), ...LIGHT, kelvin: N('Temperature', 6000, 2200, 9000, 100, 'K') },
    build: (p, ctx) => {
      const g = group('Overhead frame');
      const colour = lightColour(p);
      const frame = group('Frame');
      frame.position.y = p.hang;
      const alu = finish('aluminium');
      const w = p.width, d = p.depth;
      // Square tube frame with a corner gusset at each corner, and a sagging silk diffuser.
      for (const s of [-1, 1]) { frame.add(at(mesh(box(w + 0.1, 0.06, 0.06, { centre: true }), alu), 0, 0, s * d / 2)); frame.add(at(mesh(box(0.06, 0.06, d, { centre: true }), alu), s * w / 2, 0, 0)); }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) frame.add(at(mesh(box(0.2, 0.012, 0.2, { centre: true }), steel()), sx * (w / 2 - 0.06), -0.035, sz * (d / 2 - 0.06)));
      const silk = new THREE.PlaneGeometry(w, d, 12, 6).rotateX(Math.PI / 2);
      const pos = silk.attributes.position;
      for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) / (w / 2), z = pos.getZ(i) / (d / 2); pos.setY(i, -0.05 * (1 - x * x) * (1 - z * z) - 0.02); }
      silk.computeVertexNormals();
      frame.add(new THREE.Mesh(silk, glow(colour, 1.2 + p.intensity / 8)));
      const l = areaLight(colour, p.intensity, w * 0.96, d * 0.96);
      l.lookAt(0, -1, 0);
      l.position.y = -0.04;
      frame.add(l);
      g.add(frame);
      // Hung from the ceiling on four wires, or standing on truss legs when there's no ceiling.
      const ceiling = ctx.ceiling;
      if (ceiling && ceiling > p.hang + 0.2) {
        const wire = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.5 });
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(pipe([sx * w / 2, p.hang, sz * d / 2], [sx * w * 0.3, ceiling, sz * d * 0.3], 0.004, wire, 4));
      } else {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const leg = group('Leg');
          leg.add(at(mesh(box(0.18, p.hang, 0.18), alu), 0, 0, 0));
          leg.add(at(mesh(box(0.6, 0.02, 0.6), steel()), 0, 0, 0));
          at(leg, sx * (w / 2 + 0.15), 0, sz * (d / 2 + 0.15));
          g.add(leg);
        }
      }
      return g;
    },
  },
  fresnel: {
    label: 'Fresnel spot', icon: 'fresnel', note: 'Hard key with barn doors, shadows and a haze beam',
    params: { standHeight: N('Stand height', 2.4, 0.8, 4.5), tilt: N('Tilt', 24, -20, 85, 1, '°'), angle: N('Beam', 22, 5, 60, 1, '°'), soft: N('Edge', 0.45, 0, 1, 0.01, ''), intensity: N('Brightness', 160, 0, 800, 5, ''), ...LIGHT, kelvin: N('Temperature', 3800, 2200, 9000, 100, 'K'), shadow: B('Shadows', true), haze: N('Haze beam', 0.35, 0, 1.5, 0.01, '') },
    build: (p) => {
      const g = group('Fresnel');
      const colour = lightColour(p);
      g.add(stand(p.standHeight));
      const yoke = group('Yoke');
      yoke.position.y = p.standHeight;
      const m = steel();
      yoke.add(at(mesh(box(0.42, 0.03, 0.03, { centre: true }), m), 0, 0.02, 0));
      for (const s of [-1, 1]) yoke.add(at(mesh(box(0.03, 0.34, 0.03), m), s * 0.21, 0.02, 0));
      const head = group('Head');
      head.position.y = 0.3;
      head.rotation.x = rad(p.tilt);
      const barrel = mesh(cyl(0.17, 0.19, 0.42, { segments: 28, centre: true }), finish({ colour: '#202124', roughness: 0.5, metalness: 0.6 }));
      barrel.rotation.x = Math.PI / 2;
      head.add(barrel);
      // Cooling fins, lens, barn doors.
      for (let i = 0; i < 5; i++) { const fin = mesh(new THREE.TorusGeometry(0.19, 0.008, 6, 32), m); fin.position.z = -0.15 + i * 0.05; head.add(fin); }
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.15, 32), glow(colour, 2 + p.intensity / 120));
      lens.position.z = 0.212;
      head.add(lens);
      const door = finish({ colour: '#151517', roughness: 0.6, metalness: 0.5 }, { side: THREE.DoubleSide });
      for (let i = 0; i < 4; i++) {
        const hinge = group('Door');
        hinge.rotation.z = (i * Math.PI) / 2;
        const leaf = mesh(box(0.34, 0.004, 0.2, { centre: true }), door);
        leaf.position.set(0, 0.2, 0.32);
        leaf.rotation.x = -0.45;
        hinge.add(leaf);
        hinge.position.z = 0;
        head.add(hinge);
      }
      const l = spot(colour, p.intensity, p.angle, p.soft, p.shadow);
      l.position.z = 0.22;
      head.add(l);
      if (p.haze > 0.01) { const b = beam(p.angle * 0.8, 9, colour, p.haze * 0.18); b.position.z = 0.22; head.add(b); }
      yoke.add(head);
      g.add(yoke);
      return g;
    },
  },
  track: {
    label: 'Track spots', icon: 'track', note: 'Ceiling track with gallery spot heads',
    params: { length: N('Track length', 4, 1, 12, 0.1), count: N('Heads', 3, 1, 6, 1, ''), hang: N('Height', 4.2, 2.4, 8), tilt: N('Tilt', 50, 0, 89, 1, '°'), angle: N('Beam', 18, 6, 50, 1, '°'), intensity: N('Brightness', 90, 0, 500, 5, ''), ...LIGHT, kelvin: N('Temperature', 3500, 2200, 9000, 100, 'K'), shadow: B('Shadows', false), haze: N('Haze beam', 0, 0, 1.5, 0.01, '') },
    build: (p, ctx) => {
      const g = group('Track');
      const colour = lightColour(p);
      const m = finish({ colour: '#e9eaec', roughness: 0.4 });
      const y = p.hang;
      g.add(at(mesh(box(p.length, 0.04, 0.035, { centre: true }), m), 0, y, 0));
      if (ctx.ceiling && ctx.ceiling > y + 0.05) for (const s of [-1, 1]) g.add(pipe([s * p.length * 0.4, y, 0], [s * p.length * 0.4, ctx.ceiling, 0], 0.003, steel(), 4));
      const n = Math.round(p.count);
      for (let i = 0; i < n; i++) {
        const x = n === 1 ? 0 : -p.length / 2 + 0.3 + (i / (n - 1)) * (p.length - 0.6);
        const adapter = at(mesh(box(0.06, 0.05, 0.05, { centre: true }), m), x, y - 0.04, 0);
        g.add(adapter);
        const head = group('Head');
        head.position.set(x, y - 0.12, 0);
        head.rotation.x = rad(p.tilt);
        head.add(at(mesh(cyl(0.012, 0.012, 0.08, { centre: true }), m), 0, 0.05, 0));
        const can = mesh(cyl(0.055, 0.065, 0.2, { segments: 24, centre: true }), m);
        can.rotation.x = Math.PI / 2;
        head.add(can);
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.05, 24), glow(colour, 2.5));
        lens.position.z = 0.102;
        head.add(lens);
        const l = spot(colour, p.intensity, p.angle, 0.5, p.shadow && i === 0);
        l.position.z = 0.1;
        head.add(l);
        if (p.haze > 0.01) { const b = beam(p.angle * 0.75, 6, colour, p.haze * 0.15); b.position.z = 0.1; head.add(b); }
        g.add(head);
      }
      return g;
    },
  },
  pendant: {
    label: 'Pendant', icon: 'pendant', note: 'Dome pendant on a cord · warm point light',
    params: { hang: N('Height', 3, 1.6, 7), size: N('Shade', 0.45, 0.2, 1.2), intensity: N('Brightness', 14, 0, 80, 0.5, ''), ...LIGHT, kelvin: N('Temperature', 2700, 2200, 9000, 100, 'K'), shade: C('Shade colour', '#1c1d20') },
    build: (p, ctx) => {
      const g = group('Pendant');
      const colour = lightColour(p);
      const top = ctx.ceiling || p.hang + 2;
      g.add(pipe([0, p.hang + p.size * 0.5, 0], [0, top, 0], 0.004, steel(), 6));
      const r = p.size / 2;
      const shadeGeo = lathe([[r, 0], [r * 0.98, r * 0.12], [r * 0.85, r * 0.42], [r * 0.55, r * 0.75], [r * 0.18, r * 0.95], [0.03, r]], 48);
      const shade = mesh(shadeGeo, finish({ colour: p.shade, roughness: 0.35, metalness: 0.3, side: THREE.DoubleSide }));
      shade.position.y = p.hang;
      g.add(shade);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(r * 0.28, 20, 12), glow(colour, 3));
      bulb.position.y = p.hang + r * 0.25;
      g.add(bulb);
      const l = new THREE.PointLight(colour, p.intensity, 18, 2);
      l.position.y = p.hang + r * 0.1;
      l.castShadow = true; l.shadow.mapSize.set(512, 512); l.shadow.bias = -0.002;
      g.add(l);
      return g;
    },
  },
  battens: {
    label: 'LED battens', icon: 'battens', note: 'Row of workshop ceiling panels · area lights',
    params: { count: N('Panels', 4, 1, 6, 1, ''), spacing: N('Spacing', 2.6, 1, 6), length: N('Panel length', 1.8, 0.6, 3), hang: N('Height', 5.4, 2.6, 8), intensity: N('Brightness', 14, 0, 60, 0.5, ''), ...LIGHT, kelvin: N('Temperature', 5000, 2200, 9000, 100, 'K') },
    build: (p, ctx) => {
      const g = group('Battens');
      const colour = lightColour(p);
      const n = Math.round(p.count), housing = finish({ colour: '#d9dbde', roughness: 0.4, metalness: 0.3 });
      for (let i = 0; i < n; i++) {
        const z = (i - (n - 1) / 2) * p.spacing;
        const unit = group('Panel');
        unit.position.set(0, p.hang, z);
        unit.add(at(mesh(rbox(p.length, 0.07, 0.32, 0.015, { centre: true }), housing), 0, 0.035, 0));
        const opal = new THREE.Mesh(new THREE.PlaneGeometry(p.length - 0.06, 0.26).rotateX(Math.PI / 2), glow(colour, 1.5 + p.intensity / 8));
        opal.position.y = -0.001;
        unit.add(opal);
        const l = areaLight(colour, p.intensity, p.length - 0.06, 0.26);
        l.lookAt(0, -1, 0);
        unit.add(l);
        if (ctx.ceiling && ctx.ceiling > p.hang + 0.1) for (const s of [-1, 1]) unit.add(pipe([s * p.length * 0.4, 0.07, 0], [s * p.length * 0.4, ctx.ceiling - p.hang, 0], 0.003, steel(), 4));
        g.add(unit);
      }
      return g;
    },
  },
  halo: {
    label: 'Halo ring', icon: 'halo', note: 'Hung light ring over the car',
    params: { radius: N('Radius', 2.6, 0.8, 5), hang: N('Height', 4, 2.4, 8), intensity: N('Brightness', 60, 0, 300, 1, ''), ...LIGHT, kelvin: N('Temperature', 6500, 2200, 9000, 100, 'K') },
    build: (p, ctx) => {
      const g = group('Halo');
      const colour = lightColour(p);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(p.radius, 0.045, 12, 128), glow(colour, 3 + p.intensity / 40));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = p.hang;
      g.add(ring);
      const housing = mesh(new THREE.TorusGeometry(p.radius, 0.07, 10, 128, Math.PI * 2), finish('blackSteel'));
      housing.rotation.x = Math.PI / 2; housing.position.y = p.hang + 0.06; housing.scale.set(1, 1, 0.6);
      g.add(housing);
      const top = ctx.ceiling || p.hang + 3;
      for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; g.add(pipe([Math.cos(a) * p.radius, p.hang + 0.08, Math.sin(a) * p.radius], [Math.cos(a) * p.radius * 0.6, top, Math.sin(a) * p.radius * 0.6], 0.004, steel(), 4)); }
      const l = new THREE.SpotLight(colour, p.intensity, 20, Math.atan((p.radius + 1.5) / p.hang), 0.9, 2);
      l.position.y = p.hang;
      l.target.position.set(0, -p.hang, 0);
      l.add(l.target);
      l.castShadow = true; l.shadow.mapSize.set(1024, 1024); l.shadow.radius = 8; l.shadow.bias = -0.0003;
      g.add(l);
      return g;
    },
  },
  washer: {
    label: 'Wall washer', icon: 'washer', note: 'Floor uplight grazing a wall or the car',
    params: { tilt: N('Tilt', -55, -89, 0, 1, '°'), angle: N('Beam', 34, 8, 70, 1, '°'), intensity: N('Brightness', 80, 0, 400, 5, ''), ...LIGHT, kelvin: N('Temperature', 4000, 2200, 9000, 100, 'K'), haze: N('Haze beam', 0, 0, 1.5, 0.01, '') },
    build: (p) => {
      const g = group('Wall washer');
      const colour = lightColour(p);
      g.add(mesh(rbox(0.34, 0.08, 0.34, 0.02), steel()));
      const head = group('Head');
      head.position.y = 0.16;
      head.rotation.x = rad(p.tilt);
      const can = mesh(cyl(0.09, 0.1, 0.18, { segments: 24, centre: true }), finish({ colour: '#222327', roughness: 0.4, metalness: 0.6 }));
      can.rotation.x = Math.PI / 2;
      head.add(can);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.085, 24), glow(colour, 3));
      lens.position.z = 0.092;
      head.add(lens);
      for (const s of [-1, 1]) g.add(at(mesh(box(0.02, 0.18, 0.04), steel()), s * 0.11, 0.06, 0));
      const l = spot(colour, p.intensity, p.angle, 0.6, false);
      l.position.z = 0.1;
      head.add(l);
      if (p.haze > 0.01) { const b = beam(p.angle * 0.75, 5, colour, p.haze * 0.15); b.position.z = 0.1; head.add(b); }
      g.add(head);
      return g;
    },
  },
};

export function defaultFixtureParams(type) {
  return Object.fromEntries(Object.entries(FIXTURES[type].params).map(([k, d]) => [k, d.value]));
}

// ------------------------------------------------------------------------------------------------------ rigs
// Fixture positions are around a car at the origin facing +X; `aim` turns the fixture toward the car and works out
// its tilt from the height difference. `atCeiling` hangs ceiling fixtures just under the set's ceiling.
export const RIGS = {
  softbox: {
    label: 'Softbox studio', note: 'Big key, strip fill, two rims and an overhead',
    icon: '<rect x="3" y="4" width="7" height="6" rx="1"/><path d="M6.5 10v10M4 20h5"/><rect x="15" y="3" width="3" height="9" rx="1"/><path d="M16.5 12v8"/>',
    fixtures: [
      { type: 'softbox', name: 'Key softbox', position: [-2.6, 0, 5.2], aim: true, params: { width: 1.8, height: 1.3, standHeight: 2.6, intensity: 30 } },
      { type: 'strip', name: 'Fill strip', position: [5.4, 0, 3.6], aim: true, params: { intensity: 22 } },
      { type: 'strip', name: 'Rim strip left', position: [-5.6, 0, -3.6], aim: true, params: { intensity: 40, kelvin: 6200 } },
      { type: 'strip', name: 'Rim strip right', position: [5.2, 0, -4.2], aim: true, params: { intensity: 40, kelvin: 6200 } },
      { type: 'overhead', name: 'Overhead', position: [0, 0, 0], params: { width: 5, depth: 2.2, hang: 4.8, intensity: 6 } },
    ],
  },
  overhead: {
    label: 'Overhead light', note: 'One long diffusion frame: clean reflections along the body',
    icon: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8l-1 4M19 8l1 4M3 20h18"/><path d="M8 16h8"/>',
    fixtures: [
      { type: 'overhead', name: 'Overhead frame', position: [0, 0, 0], params: { width: 8, depth: 3.4, hang: 4.4, intensity: 12 } },
      { type: 'strip', name: 'Kicker left', position: [-4.6, 0, 4.2], aim: true, params: { width: 0.3, height: 2.4, standHeight: 0.5, roll: 90, tilt: 4, intensity: 18 } },
      { type: 'strip', name: 'Kicker right', position: [4.6, 0, 4.2], aim: true, params: { width: 0.3, height: 2.4, standHeight: 0.5, roll: 90, tilt: 4, intensity: 18 } },
    ],
  },
  drama: {
    label: 'Spot drama', note: 'Hard fresnel key, two rims, haze beams',
    icon: '<path d="M4 6l6 3-6 3z"/><path d="M10 9l10 8M10 9l8 11"/><path d="M3 20h18"/>',
    ambient: 0.35,
    fixtures: [
      { type: 'fresnel', name: 'Key fresnel', position: [3.4, 0, 5.6], aim: true, params: { standHeight: 3.6, angle: 24, intensity: 300, haze: 0.45 } },
      { type: 'fresnel', name: 'Rim fresnel left', position: [-5.4, 0, -4.8], aim: true, params: { standHeight: 3.2, angle: 18, intensity: 260, kelvin: 5600, haze: 0.5, shadow: false } },
      { type: 'fresnel', name: 'Rim fresnel right', position: [5.8, 0, -4.4], aim: true, params: { standHeight: 3.2, angle: 18, intensity: 260, kelvin: 5600, haze: 0.5, shadow: false } },
      { type: 'washer', name: 'Floor washer', position: [0, 0, -5.5], params: { tilt: -60, intensity: 60 }, rotationY: Math.PI },
    ],
  },
  daylight: {
    label: 'Daylight', note: 'Sun and sky only, no fixtures',
    icon: '<circle cx="12" cy="10" r="4"/><path d="M12 2v2M12 16v2M4 10H2M22 10h-2M6.3 4.3l1.4 1.4M16.3 14.3l1.4 1.4M6.3 15.7l1.4-1.4M16.3 5.7l1.4-1.4M3 21h18"/>',
    sun: true,
    fixtures: [],
  },
  workshop: {
    label: 'Workshop', note: 'Two rows of LED battens under the roof',
    icon: '<path d="M3 5h7M14 5h7M3 9h7M14 9h7"/><path d="M3 20h18M7 20v-6h10v6"/>',
    fixtures: [
      { type: 'battens', name: 'Battens left', position: [-3.2, 0, 0], params: { hang: 5.6, count: 4, spacing: 3, intensity: 34 }, atCeiling: true },
      { type: 'battens', name: 'Battens right', position: [3.2, 0, 0], params: { hang: 5.6, count: 4, spacing: 3, intensity: 34 }, atCeiling: true },
    ],
  },
  gallery: {
    label: 'Gallery tracks', note: 'Track spots from both sides plus daylight',
    icon: '<path d="M3 4h18"/><path d="M7 4v3l-2 3M12 4v3l0 3M17 4v3l2 3"/><path d="M3 20h18"/>',
    sun: true,
    fixtures: [
      { type: 'track', name: 'Track front', position: [0, 0, 3], params: { length: 6, count: 3, tilt: 52, intensity: 110 }, atCeiling: true },
      { type: 'track', name: 'Track back', position: [0, 0, -3], rotationY: Math.PI, params: { length: 6, count: 3, tilt: 52, intensity: 80 }, atCeiling: true },
    ],
  },
  halo: {
    label: 'Halo', note: 'Light ring over the car, two floor washers',
    icon: '<ellipse cx="12" cy="6" rx="8" ry="2.5"/><path d="M8 20l-2-4M16 20l2-4M3 20h18"/>',
    ambient: 0.5,
    fixtures: [
      { type: 'halo', name: 'Halo ring', position: [0, 0, 0], params: { radius: 3, hang: 4.2, intensity: 90 } },
      { type: 'washer', name: 'Washer left', position: [-4.5, 0, -4], aim: true, params: { tilt: -30, intensity: 60, kelvin: 6500 } },
      { type: 'washer', name: 'Washer right', position: [4.5, 0, -4], aim: true, params: { tilt: -30, intensity: 60, kelvin: 6500 } },
    ],
  },
};

// Yaw (rotationY) that points a fixture's +Z at `target` from `position`, and the tilt (degrees, + = down) for a
// head at `headY` to look at target.y.
export function aimAt(position, target, headY) {
  const dx = target[0] - position[0], dz = target[2] - position[2];
  const yaw = Math.atan2(dx, dz);
  const dist = Math.hypot(dx, dz);
  const tilt = THREE.MathUtils.radToDeg(Math.atan2(headY - target[1], dist));
  return { yaw, tilt };
}

// Head height of a fixture (for aiming).
export function headHeight(type, params) {
  if (type === 'softbox' || type === 'strip') return params.standHeight + 0.02;
  if (type === 'fresnel') return params.standHeight + 0.3;
  if (type === 'washer') return 0.16;
  return params.hang || 2;
}
