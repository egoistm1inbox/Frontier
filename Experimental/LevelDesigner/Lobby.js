// The Lobby's environment: a neutral showroom built from a sky dome, a curved cyclorama wall with a floor cove,
// a mirror-glossy floor, a turntable and (for the studio preset) arched light strips. Everything the
// environment panel edits lives in `settings`; apply* methods push one group of settings into the scene, and the
// reflection environment (PMREM of a cheap copy of the room) is rebuilt after edits so the paint reflects the room.
import { THREE } from '../Shared/Studio/Render.js';
import { Reflector } from './Vendor/Reflector.js';

export const LOBBY_PRESETS = {
  cove: {
    label: 'Daylight cove',
    note: 'White curved walls, clear blue sky, glossy floor',
    sky: { zenith: '#3b7cc4', horizon: '#b4cfe9', ground: '#b9c0c9', haze: 0.3 },
    sun: { azimuth: 118, elevation: 30, intensity: 3, colour: '#fff4e6', softness: 3 },
    ambient: { sky: '#cfdcf0', ground: '#7d8794', intensity: 0.55, reflections: 0.7, exposure: 0.92 },
    floor: { colour: '#bfc7d2', gloss: 0.42 },
    walls: { colour: '#e4e9f0', height: 3.1, radius: 12, sweep: 230, wave: 0.38 },
    turntable: { ring: '#ffffff', glow: 0.5 },
    arches: { visible: false },
  },
  overcast: {
    label: 'Overcast gallery',
    note: 'Concrete floor, warm low sun, soft grey sky',
    sky: { zenith: '#7f8790', horizon: '#ddd8cf', ground: '#7d7f82', haze: 0.8 },
    sun: { azimuth: 62, elevation: 22, intensity: 2.8, colour: '#ffe2bd', softness: 4 },
    ambient: { sky: '#e8e4dc', ground: '#6f7174', intensity: 1, reflections: 0.75, exposure: 1 },
    floor: { colour: '#8d8f92', gloss: 0.28 },
    walls: { colour: '#ebe6de', height: 5.2, radius: 11, sweep: 200, wave: 0.12 },
    turntable: { ring: '#fff1dc', glow: 0.3 },
    arches: { visible: false },
  },
  studio: {
    label: 'Night studio',
    note: 'Dark room, arched light strips, bright turntable ring',
    sky: { zenith: '#050506', horizon: '#111215', ground: '#0b0b0d', haze: 0.2 },
    sun: { azimuth: 20, elevation: 74, intensity: 1.6, colour: '#eef2ff', softness: 6 },
    ambient: { sky: '#d5dceb', ground: '#202024', intensity: 0.8, reflections: 1.4, exposure: 1.05 },
    floor: { colour: '#1d1e21', gloss: 0.6 },
    walls: { colour: '#1c1d20', height: 4.6, radius: 9, sweep: 250, wave: 0 },
    turntable: { ring: '#ffffff', glow: 1 },
    arches: { visible: true },
  },
};

const clone = (v) => JSON.parse(JSON.stringify(v));

export function defaultLobbySettings() {
  const p = clone(LOBBY_PRESETS.cove);
  return {
    preset: 'cove',
    sky: p.sky, sun: p.sun, ambient: p.ambient, floor: p.floor, walls: p.walls,
    turntable: { radius: 3.3, spin: false, speed: 6, ...p.turntable },
    arches: { count: 11, colour: '#ffffff', spacing: 0.95, ...p.arches },
  };
}

// ------------------------------------------------------------------------------------------------------- sky dome
const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // sits on the far plane
}`;
const SKY_FRAG = `
uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColour;
uniform float uHaze, uSunSize;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float up = pow(clamp(h, 0.0, 1.0), mix(0.75, 0.32, uHaze));
  vec3 c = mix(uHorizon, uZenith, up);
  c = mix(c, uGround, smoothstep(0.0, -0.08, h));
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  c += uSunColour * (pow(s, 900.0 / uSunSize) * 2.4 + pow(s, 12.0) * 0.12 * uHaze);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function skyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColour: { value: new THREE.Color() }, uHaze: { value: 0.5 }, uSunSize: { value: 1 },
    },
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
  });
}

// ------------------------------------------------------------------------------------------------ cyclorama wall
// Inner face of a curved wall around the origin: a quarter-circle cove rises from the floor into a vertical wall
// whose top sweeps from high (left) to low (right). The arc is centred on −Z (behind a car facing +X seen from +Z).
export function cycloramaGeometry({ radius = 12, height = 4.6, sweep = 230, wave = 0.28, cove = 1.4 } = {}) {
  const nu = 160, nv = 26;
  const pos = [], uv = [], idx = [];
  const half = THREE.MathUtils.degToRad(sweep) / 2;
  for (let i = 0; i <= nu; i++) {
    const t = i / nu;
    const a = -half + t * 2 * half;
    const dx = Math.sin(a), dz = -Math.cos(a);
    const h = Math.max(cove + 0.2, height * (1 + wave * Math.cos(Math.PI * t)));
    const arc = (Math.PI / 2) * cove, length = arc + (h - cove);
    for (let j = 0; j <= nv; j++) {
      const s = (j / nv) * length;
      let r, y;
      if (s < arc) { const k = s / cove; r = radius - cove + cove * Math.sin(k); y = cove - cove * Math.cos(k); }
      else { r = radius; y = cove + (s - arc); }
      pos.push(dx * r, y, dz * r);
      uv.push(t, s / length);
    }
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, b = a + nv + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// ------------------------------------------------------------------------------------------------ light arches
// One strip: rises from the floor behind the car, bends over and runs overhead toward the viewer (like a light tunnel
// seen from its open end).
function archGeometry({ back = -5.2, front = 3.2, height = 4.4, corner = 1.8, thickness = 0.035 } = {}) {
  const path = new THREE.CurvePath();
  const v = (z, y) => new THREE.Vector3(0, y, z);
  path.add(new THREE.LineCurve3(v(back, 0.9), v(back, height - corner)));
  path.add(new THREE.QuadraticBezierCurve3(v(back, height - corner), v(back, height), v(back + corner, height)));
  path.add(new THREE.LineCurve3(v(back + corner, height), v(front, height)));
  return new THREE.TubeGeometry(path, 90, thickness, 6, false);
}

// --------------------------------------------------------------------------------------------------------- Lobby
export class Lobby {
  constructor(stage, settings = defaultLobbySettings()) {
    this.stage = stage;
    this.settings = settings;
    const scene = stage.scene;
    this.hemi = scene.children.find((c) => c.isHemisphereLight);
    this.fill = scene.children.find((c) => c.isDirectionalLight && c !== stage.sun);
    if (this.fill) this.fill.intensity = 0.25;
    stage.grid.visible = false;
    stage.ground.visible = false;
    scene.background = null;

    // Sun: the stage's shadow-casting key light, aimed at the origin with a shadow frustum covering the room.
    this.sun = stage.sun;
    const cam = this.sun.shadow.camera;
    cam.left = -15; cam.right = 15; cam.top = 15; cam.bottom = -15; cam.near = 1; cam.far = 80;
    cam.updateProjectionMatrix();
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.bias = -0.0002;
    this.sun.target.position.set(0, 0, 0);

    this.group = new THREE.Group();
    this.group.name = 'Lobby';
    scene.add(this.group);

    // Sky
    this.skyMat = skyMaterial();
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(180, 48, 24), this.skyMat);
    this.sky.name = 'Sky';
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.sky.raycast = () => {};
    this.group.add(this.sky);

    // Floor: a mirror under a translucent satin coat (gloss = how much of the mirror shows through).
    const size = 160;
    const w = Math.max(512, Math.round(stage.canvas.clientWidth * 0.6)), h = Math.max(512, Math.round(stage.canvas.clientHeight * 0.6));
    this.mirror = new Reflector(new THREE.PlaneGeometry(size, size), { textureWidth: w, textureHeight: h, color: 0x7f8389, clipBias: 0.002 });
    this.mirror.rotation.x = -Math.PI / 2;
    this.mirror.raycast = () => {};
    // Editor overlays (gizmo, light glyphs) are not part of the room: keep them out of the floor's reflection.
    this.hideInMirror = [];
    const mirrorPass = this.mirror.onBeforeRender;
    this.mirror.onBeforeRender = (...args) => {
      const hidden = this.hideInMirror.filter((o) => o.visible);
      for (const o of hidden) o.visible = false;
      mirrorPass.apply(this.mirror, args);
      for (const o of hidden) o.visible = true;
    };
    this.floorMat = new THREE.MeshStandardMaterial({ color: '#d3d9e1', roughness: 0.6, metalness: 0, transparent: true, opacity: 0.6, depthWrite: false });
    this.floorCoat = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.floorMat);
    this.floorCoat.rotation.x = -Math.PI / 2;
    this.floorCoat.position.y = 0.001;
    this.floorCoat.receiveShadow = true;
    this.floorCoat.raycast = () => {};
    this.floor = new THREE.Group();
    this.floor.name = 'Floor';
    this.floor.add(this.mirror, this.floorCoat);
    this.group.add(this.floor);

    // Cyclorama
    this.wallMat = new THREE.MeshStandardMaterial({ color: '#eef1f5', roughness: 0.92, metalness: 0, side: THREE.DoubleSide, shadowSide: THREE.DoubleSide });
    this.walls = new THREE.Mesh(cycloramaGeometry(settings.walls), this.wallMat);
    this.walls.name = 'Cyclorama';
    this.walls.castShadow = false; this.walls.receiveShadow = true;
    this.group.add(this.walls);

    // Turntable
    this.turntable = new THREE.Group();
    this.turntable.name = 'Turntable';
    this.discMat = new THREE.MeshPhysicalMaterial({ color: '#f4f5f7', roughness: 0.3, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.15 });
    this.disc = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 128), this.discMat);
    this.disc.castShadow = false; this.disc.receiveShadow = true;
    this.ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.01, 8, 192), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.turntable.add(this.disc, this.ring);
    this.group.add(this.turntable);
    this.turntableHeight = 0.05;

    // Light arches
    this.archMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    this.arches = new THREE.Group();
    this.arches.name = 'Light arches';
    this.group.add(this.arches);

    // Reflection environment
    this.pmrem = new THREE.PMREMGenerator(stage.renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new THREE.Mesh(this.sky.geometry, this.skyMat);
    this.envWallMat = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide });
    this.envWalls = new THREE.Mesh(this.walls.geometry, this.envWallMat);
    this.envFloorMat = new THREE.MeshBasicMaterial({ color: '#9aa0a8' });
    const envFloor = new THREE.Mesh(new THREE.CircleGeometry(60, 48), this.envFloorMat);
    envFloor.rotation.x = -Math.PI / 2;
    this.envArches = new THREE.Group();
    this.envScene.add(this.envSky, this.envWalls, envFloor, this.envArches);
    this.envTarget = null;
    this.envTimer = 0;

    this.spin = 0;
    stage.frameCallbacks.add((dt) => this.tick(dt));
    this.applyAll();
  }

  // ------------------------------------------------------------------------------------------------ apply
  applyAll() {
    this.applySky(); this.applySun(); this.applyAmbient(); this.applyFloor(); this.applyWalls(); this.applyTurntable(); this.applyArches();
  }

  applySky() {
    const s = this.settings.sky, u = this.skyMat.uniforms;
    u.uZenith.value.set(s.zenith); u.uHorizon.value.set(s.horizon); u.uGround.value.set(s.ground); u.uHaze.value = s.haze;
    this.stage.scene.fog = new THREE.Fog(s.horizon, 45, 170);
    this.queueEnvironment();
  }

  sunDirection() {
    const s = this.settings.sun;
    const az = THREE.MathUtils.degToRad(s.azimuth), el = THREE.MathUtils.degToRad(s.elevation);
    return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  }

  applySun() {
    const s = this.settings.sun;
    const d = this.sunDirection();
    this.sun.position.copy(d).multiplyScalar(40);
    this.sun.target.position.set(0, 0, 0);
    this.sun.intensity = this.sun.visible ? s.intensity : 0;
    this.sun.color.set(s.colour);
    this.sun.shadow.radius = s.softness;
    this.sun.shadow.blurSamples = 16;
    const u = this.skyMat.uniforms;
    u.uSunDir.value.copy(d);
    u.uSunColour.value.set(s.colour).multiplyScalar(Math.min(1.2, s.intensity / 3));
    this.queueEnvironment();
  }

  applyAmbient() {
    const a = this.settings.ambient;
    if (this.hemi) { this.hemi.color.set(a.sky); this.hemi.groundColor.set(a.ground); this.hemi.intensity = a.intensity; }
    this.stage.scene.environmentIntensity = a.reflections;
    this.stage.renderer.toneMappingExposure = a.exposure;
  }

  applyFloor() {
    const f = this.settings.floor;
    this.floorMat.color.set(f.colour);
    this.floorMat.opacity = 1 - f.gloss * 0.72;
    this.floorMat.roughness = 0.75 - f.gloss * 0.4;
    this.envFloorMat.color.set(f.colour).multiplyScalar(0.8);
    this.mirror.material.uniforms.color.value.set(f.colour).lerp(new THREE.Color('#808080'), 0.5);
    this.queueEnvironment();
  }

  applyWalls() {
    const w = this.settings.walls;
    this.wallMat.color.set(w.colour);
    const geo = cycloramaGeometry(w);
    this.walls.geometry.dispose();
    this.walls.geometry = geo;
    this.envWalls.geometry = geo;
    this.envWallMat.color.set(w.colour).multiplyScalar(0.92);
    this.queueEnvironment();
  }

  applyTurntable() {
    const t = this.settings.turntable;
    const h = this.turntableHeight;
    this.disc.scale.set(t.radius, h, t.radius);
    this.disc.position.y = h / 2;
    this.ring.scale.setScalar(t.radius - 0.14);
    this.ring.position.y = h + 0.002;
    this.ringMat.color.set(t.ring);
    this.ringMat.opacity = t.glow;
    this.ring.visible = t.glow > 0.01;
  }

  applyArches() {
    const a = this.settings.arches;
    for (const g of [this.arches, this.envArches]) for (const c of [...g.children]) { g.remove(c); }
    this.archMat.color.set(a.colour);
    const geo = archGeometry();
    const n = Math.max(1, Math.round(a.count));
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * a.spacing;
      const m = new THREE.Mesh(geo, this.archMat);
      m.position.x = x;
      m.raycast = () => {};
      this.arches.add(m);
      const e = new THREE.Mesh(geo, this.archMat);
      e.position.x = x;
      this.envArches.add(e);
    }
    this.arches.visible = a.visible;
    this.envArches.visible = a.visible;
    this.queueEnvironment();
  }

  usePreset(name) {
    const p = LOBBY_PRESETS[name];
    if (!p) return;
    const s = this.settings;
    s.preset = name;
    Object.assign(s.sky, clone(p.sky)); Object.assign(s.sun, clone(p.sun)); Object.assign(s.ambient, clone(p.ambient));
    Object.assign(s.floor, clone(p.floor)); Object.assign(s.walls, clone(p.walls));
    Object.assign(s.turntable, clone(p.turntable)); Object.assign(s.arches, clone(p.arches));
    this.applyAll();
  }

  // ------------------------------------------------------------------------------------------- environment
  queueEnvironment() {
    clearTimeout(this.envTimer);
    this.envTimer = setTimeout(() => this.bakeEnvironment(), 120);
  }

  bakeEnvironment() {
    const old = this.envTarget;
    this.envWalls.visible = this.walls.visible;
    this.envWalls.position.copy(this.walls.position);
    this.envWalls.rotation.copy(this.walls.rotation);
    this.envTarget = this.pmrem.fromScene(this.envScene, 0.035, 0.1, 200);
    this.stage.scene.environment = this.envTarget.texture;
    if (old) old.dispose();
  }

  tick(dt) {
    const t = this.settings.turntable;
    if (t.spin && this.turntable.visible) {
      const step = THREE.MathUtils.degToRad(t.speed) * dt;
      this.turntable.rotation.y += step;
      this.spin = step;
    } else this.spin = 0;
  }
}
