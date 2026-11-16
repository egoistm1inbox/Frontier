// The Lobby's environment: a sky dome, the set (architecture from Sets.js), a floor finish over a real-time mirror, the
// turntable, the sun, a soft contact shadow under the car, and the reflection environment. Everything the
// environment panels edit lives in `settings`; apply* methods push one group of settings into the scene.
//
// Reflections: the floor is a planar mirror (Reflector) seen through the floor finish (gloss = how much of it shows);
// paint, glass and every other surface use a PMREM environment baked from the actual room — set, floor, fixtures and
// placed pieces, with the car and editor overlays hidden — so the car reflects the softboxes and windows around it.
import { THREE } from '../Shared/Studio/Render.js';
import { Reflector } from './Vendor/Reflector.js';
import { SETS, FLOORS, buildSet } from './Sets.js';
import { tiled } from './Textures.js';

export { SETS, FLOORS };
export const SET_CEILING = { studio: 6.55, garage: 6.25, atrium: 6.85, pavilion: 4.28, horizon: null };

const clone = (v) => JSON.parse(JSON.stringify(v));

export function defaultLobbySettings(setId = 'studio') {
  const s = SETS[setId] || SETS.studio;
  return {
    set: setId,
    rig: s.rig,
    sky: clone(s.sky), sun: clone(s.sun), ambient: clone(s.ambient),
    floor: { preset: s.floor, gloss: FLOORS[s.floor].gloss, tint: '#ffffff', scale: 1 },
    turntable: { radius: 3.3, spin: false, speed: 6, ring: '#ffffff', glow: 0.6, finish: 'dark' },
    shadow: { strength: 0.85, softness: 2.4 },
  };
}

// ------------------------------------------------------------------------------------------------------- sky dome
const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w;
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

// --------------------------------------------------------------------------------------------- contact shadow
// The car seen from below by an orthographic camera, drawn as darkness-by-height into a small target, blurred twice
// and laid on the floor under the car. Grounds the car under area lights (which cast no shadow maps).
const BLUR_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const BLUR_FRAG = `uniform sampler2D tMap; uniform vec2 uStep; varying vec2 vUv;
void main(){ vec4 s = vec4(0.0);
  s += texture2D(tMap, vUv - 4.0 * uStep) * 0.051; s += texture2D(tMap, vUv - 3.0 * uStep) * 0.0918; s += texture2D(tMap, vUv - 2.0 * uStep) * 0.12245;
  s += texture2D(tMap, vUv - uStep) * 0.1531; s += texture2D(tMap, vUv) * 0.1633; s += texture2D(tMap, vUv + uStep) * 0.1531;
  s += texture2D(tMap, vUv + 2.0 * uStep) * 0.12245; s += texture2D(tMap, vUv + 3.0 * uStep) * 0.0918; s += texture2D(tMap, vUv + 4.0 * uStep) * 0.051;
  gl_FragColor = s; }`;
export const SHADOW_LAYER = 6;

class ContactShadow {
  constructor(renderer, { size = 9, res = 512, height = 1.8 } = {}) {
    this.renderer = renderer;
    this.size = size; this.height = height;
    const opts = { type: THREE.HalfFloatType };
    this.rt = new THREE.WebGLRenderTarget(res, res, opts);
    this.rtBlur = new THREE.WebGLRenderTarget(res, res, opts);
    this.group = new THREE.Group();
    this.group.name = 'Contact shadow';
    this.material = new THREE.MeshBasicMaterial({ map: this.rt.texture, transparent: true, depthWrite: false, opacity: 0.85, color: '#000000' });
    // The texture holds darkness in alpha; colour comes from the material (black).
    this.material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#ifdef USE_MAP\n vec4 sampledDiffuseColor = texture2D( map, vMapUv );\n diffuseColor.a *= sampledDiffuseColor.a;\n#endif');
    };
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.material);
    this.plane.rotation.x = -Math.PI / 2;
    this.plane.scale.y = -1;
    this.plane.renderOrder = 1;
    this.plane.raycast = () => {};
    this.group.add(this.plane);
    this.camera = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0, height);
    this.camera.rotation.x = Math.PI / 2;
    this.camera.layers.set(SHADOW_LAYER);
    this.group.add(this.camera);
    this.depth = new THREE.MeshDepthMaterial();
    this.depth.userData.darkness = { value: 1.6 };
    this.depth.onBeforeCompile = (shader) => {
      shader.uniforms.darkness = this.depth.userData.darkness;
      shader.fragmentShader = 'uniform float darkness;\n' + shader.fragmentShader.replace('gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );', 'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );');
    };
    this.depth.depthTest = false; this.depth.depthWrite = false;
    this.blurScene = new THREE.Scene();
    this.blurMat = new THREE.ShaderMaterial({ uniforms: { tMap: { value: null }, uStep: { value: new THREE.Vector2() } }, vertexShader: BLUR_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false });
    this.blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMat);
    this.blurQuad.frustumCulled = false;
    this.blurScene.add(this.blurQuad);
    this.blurCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.softness = 2.4;
    this.last = new THREE.Matrix4();
    this.dirty = true;
  }

  render(scene) {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget(), prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    const prevBg = scene.background, prevOverride = scene.overrideMaterial, prevAuto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    scene.background = null;
    scene.overrideMaterial = this.depth;
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rt); r.clear();
    r.render(scene, this.camera);
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    const px = 1 / this.rt.width;
    for (let pass = 0; pass < 2; pass++) {
      const k = this.softness * (pass ? 0.5 : 1);
      this.blurMat.uniforms.tMap.value = this.rt.texture; this.blurMat.uniforms.uStep.value.set(px * k, 0);
      r.setRenderTarget(this.rtBlur); r.clear(); r.render(this.blurScene, this.blurCam);
      this.blurMat.uniforms.tMap.value = this.rtBlur.texture; this.blurMat.uniforms.uStep.value.set(0, px * k);
      r.setRenderTarget(this.rt); r.clear(); r.render(this.blurScene, this.blurCam);
    }
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevClear, prevAlpha);
    r.shadowMap.autoUpdate = prevAuto;
  }
}

// --------------------------------------------------------------------------------------------------------- Lobby
export class Lobby {
  constructor(stage, settings = defaultLobbySettings()) {
    this.stage = stage;
    this.settings = settings;
    const scene = stage.scene;
    this.hemi = scene.children.find((c) => c.isHemisphereLight);
    this.fill = scene.children.find((c) => c.isDirectionalLight && c !== stage.sun);
    if (this.fill) this.fill.intensity = 0;
    stage.grid.visible = false;
    stage.ground.visible = false;
    scene.background = null;

    this.sun = stage.sun;
    const cam = this.sun.shadow.camera;
    cam.left = -16; cam.right = 16; cam.top = 16; cam.bottom = -16; cam.near = 1; cam.far = 90;
    cam.updateProjectionMatrix();
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.bias = -0.0002;
    this.sun.target.position.set(0, 0, 0);

    this.group = new THREE.Group();
    this.group.name = 'Lobby';
    scene.add(this.group);

    this.skyMat = skyMaterial();
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), this.skyMat);
    this.sky.name = 'Sky';
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.sky.raycast = () => {};
    this.group.add(this.sky);

    // Floor: mirror under the floor finish.
    const w = Math.max(512, Math.round(stage.canvas.clientWidth * 0.6)), h = Math.max(512, Math.round(stage.canvas.clientHeight * 0.6));
    this.mirror = new Reflector(new THREE.PlaneGeometry(1, 1), { textureWidth: w, textureHeight: h, color: 0x7f8389, clipBias: 0.002 });
    this.mirror.rotation.x = -Math.PI / 2;
    this.mirror.raycast = () => {};
    this.hideInMirror = [];
    const mirrorPass = this.mirror.onBeforeRender;
    this.mirror.onBeforeRender = (...args) => {
      const hidden = this.hideInMirror.filter((o) => o.visible);
      for (const o of hidden) o.visible = false;
      mirrorPass.apply(this.mirror, args);
      for (const o of hidden) o.visible = true;
    };
    this.floorMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.5, transparent: true, opacity: 0.6, depthWrite: false });
    this.floorCoat = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.floorMat);
    this.floorCoat.rotation.x = -Math.PI / 2;
    this.floorCoat.position.y = 0.001;
    this.floorCoat.receiveShadow = true;
    this.floorCoat.raycast = () => {};
    // Opaque stand-in used only while baking reflections (the mirror can't render inside a cube camera).
    this.floorProxyMat = new THREE.MeshStandardMaterial({ color: '#888888', roughness: 0.6 });
    this.floorProxy = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.floorProxyMat);
    this.floorProxy.rotation.x = -Math.PI / 2;
    this.floorProxy.visible = false;
    this.floor = new THREE.Group();
    this.floor.name = 'Floor';
    this.floor.add(this.mirror, this.floorCoat, this.floorProxy);
    this.group.add(this.floor);

    // Set architecture (rebuilt by applySet).
    this.set = new THREE.Group();
    this.set.name = 'Set';
    this.group.add(this.set);
    this.occluders = [];
    this.ceiling = null;

    // Turntable: a low disc with a bevelled edge band and an LED groove.
    this.turntable = new THREE.Group();
    this.turntable.name = 'Turntable';
    this.discMat = new THREE.MeshPhysicalMaterial({ color: '#1b1c1f', roughness: 0.35, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.12 });
    this.bandMat = new THREE.MeshPhysicalMaterial({ color: '#b9bcc1', roughness: 0.3, metalness: 1 });
    this.disc = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 128), this.discMat);
    this.disc.receiveShadow = true;
    this.band = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 128, 1, true), this.bandMat);
    this.ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 8, 192), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.turntable.add(this.disc, this.band, this.ring);
    this.group.add(this.turntable);
    this.turntableHeight = 0.06;

    this.shadow = new ContactShadow(stage.renderer, { size: 9, res: 512, height: 1.9 });
    this.group.add(this.shadow.group);
    this.shadowTarget = null;            // set by the level: the vehicle root

    this.pmrem = new THREE.PMREMGenerator(stage.renderer);
    this.envTarget = null;
    this.envTimer = 0;
    this.bakeHidden = () => [];          // set by the level: things to keep out of the reflection bake
    this.spin = 0;
    stage.frameCallbacks.add((dt) => this.tick(dt));
    this.applyAll();
  }

  // ------------------------------------------------------------------------------------------------ apply
  applyAll() {
    this.applySet(); this.applySky(); this.applySun(); this.applyAmbient(); this.applyFloor(); this.applyTurntable(); this.applyShadow();
  }

  applySet() {
    for (const c of [...this.set.children]) { this.set.remove(c); dispose(c); }
    const built = buildSet(this.settings.set);
    this.set.add(built.group);
    this.occluders = built.occluders;
    this.floorSize = built.floorSize;
    this.ceiling = SET_CEILING[this.settings.set] ?? null;
    this.setLabel = (SETS[this.settings.set] || SETS.studio).label;
    for (const m of [this.mirror, this.floorCoat, this.floorProxy]) m.scale.set(built.floorSize[0], built.floorSize[1], 1);
    const open = this.settings.set === 'horizon';
    this.stage.scene.fog = open ? new THREE.Fog(this.settings.sky.horizon, 40, 170) : new THREE.Fog(this.settings.sky.horizon, 90, 300);
    this.applyFloor();
    this.queueEnvironment();
  }

  applySky() {
    const s = this.settings.sky, u = this.skyMat.uniforms;
    u.uZenith.value.set(s.zenith); u.uHorizon.value.set(s.horizon); u.uGround.value.set(s.ground); u.uHaze.value = s.haze;
    if (this.stage.scene.fog) this.stage.scene.fog.color.set(s.horizon);
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
    this.sun.position.copy(d).multiplyScalar(45);
    this.sun.target.position.set(0, 0, 0);
    const on = this.sun.visible && s.on !== false;
    this.sun.intensity = on ? s.intensity : 0;
    this.sun.castShadow = on;
    this.sun.color.set(s.colour);
    this.sun.shadow.radius = s.softness;
    this.sun.shadow.blurSamples = 16;
    const u = this.skyMat.uniforms;
    u.uSunDir.value.copy(d);
    u.uSunColour.value.set(s.colour).multiplyScalar(on ? Math.min(1.2, s.intensity / 3) : 0);
    this.queueEnvironment();
  }

  applyAmbient() {
    const a = this.settings.ambient;
    if (this.hemi) { this.hemi.color.set(a.sky); this.hemi.groundColor.set(a.ground); this.hemi.intensity = a.intensity; }
    this.stage.scene.environmentIntensity = a.reflections;
    this.stage.renderer.toneMappingExposure = a.exposure;
  }

  applyFloor() {
    const f = this.settings.floor, def = FLOORS[f.preset] || FLOORS.concrete;
    const m = this.floorMat;
    for (const k of ['map', 'roughnessMap', 'bumpMap', 'emissiveMap']) { if (m[k]) m[k].dispose(); m[k] = null; }
    const size = this.floorSize || [80, 80];
    if (def.texture) {
      const t = tiled(def.texture, size[0] / (f.scale || 1), size[1] / (f.scale || 1));
      Object.assign(m, t);
      if (t.bumpMap) m.bumpScale = 0.4;
    }
    m.color.set(def.colour).multiply(new THREE.Color(f.tint || '#ffffff'));
    m.roughness = def.roughness;
    m.emissive = new THREE.Color(def.emissive || '#000000');
    m.emissiveIntensity = def.emissive ? 1.2 : 0;
    m.opacity = 1 - f.gloss * 0.78;
    m.needsUpdate = true;
    // Mirror tint: the floor's average tone, so the reflection sits in the floor rather than on it.
    const tone = def.texture ? averageTone(def.texture) : new THREE.Color(def.colour);
    this.mirror.material.uniforms.color.value.copy(tone).lerp(new THREE.Color('#7a7a7a'), 0.35);
    this.floorProxyMat.color.copy(tone);
    this.floorProxyMat.map = m.map;
    this.floorProxyMat.needsUpdate = true;
    this.queueEnvironment();
  }

  applyTurntable() {
    const t = this.settings.turntable;
    const h = this.turntableHeight;
    this.disc.scale.set(t.radius, h, t.radius);
    this.disc.position.y = h / 2;
    this.band.scale.set(t.radius + 0.004, h * 0.8, t.radius + 0.004);
    this.band.position.y = h * 0.45;
    this.discMat.color.set(t.finish === 'light' ? '#eceef1' : '#1b1c1f');
    this.ring.scale.setScalar(t.radius - 0.16);
    this.ring.position.y = h + 0.002;
    this.ringMat.color.set(t.ring);
    this.ringMat.opacity = t.glow;
    this.ring.visible = t.glow > 0.01;
    this.shadow.dirty = true;
  }

  applyShadow() {
    const s = this.settings.shadow;
    this.shadow.material.opacity = s.strength;
    this.shadow.softness = s.softness;
    this.shadow.dirty = true;
  }

  // Switch to another set: architecture, sky, sun, ambience and its recommended floor.
  useSet(id) {
    const def = SETS[id];
    if (!def) return;
    const s = this.settings;
    s.set = id;
    Object.assign(s.sky, clone(def.sky)); Object.assign(s.sun, clone(def.sun)); Object.assign(s.ambient, clone(def.ambient));
    s.floor.preset = def.floor; s.floor.gloss = FLOORS[def.floor].gloss; s.floor.tint = '#ffffff'; s.floor.scale = 1;
    this.applyAll();
  }

  useFloor(id) {
    const def = FLOORS[id];
    if (!def) return;
    Object.assign(this.settings.floor, { preset: id, gloss: def.gloss, tint: '#ffffff' });
    this.applyFloor();
  }

  // ------------------------------------------------------------------------------------------- environment
  queueEnvironment() {
    clearTimeout(this.envTimer);
    this.envTimer = setTimeout(() => this.bakeEnvironment(), 160);
  }

  // Bake the room as it is (set, floor, fixtures, pieces), from the car's position, without the car.
  bakeEnvironment() {
    const scene = this.stage.scene;
    const hidden = [this.mirror, this.floorCoat, this.shadow.group, this.turntable, ...this.hideInMirror, ...this.bakeHidden()].filter((o) => o && o.visible);
    for (const o of hidden) o.visible = false;
    this.floorProxy.visible = true;
    const prevEnv = scene.environment;
    scene.environment = null;
    const old = this.envTarget;
    try {
      this.envTarget = this.pmrem.fromScene(scene, 0.02, 0.1, 400, { size: 256, position: new THREE.Vector3(0, 1.1, 0) });
    } catch {
      this.envTarget = this.pmrem.fromScene(scene, 0.02, 0.1, 400);
    }
    this.floorProxy.visible = false;
    for (const o of hidden) o.visible = true;
    scene.environment = this.envTarget.texture;
    if (old && old !== this.envTarget) old.dispose();
    void prevEnv;
  }

  tick(dt) {
    const t = this.settings.turntable;
    if (t.spin && this.turntable.visible) {
      const step = THREE.MathUtils.degToRad(t.speed) * dt;
      this.turntable.rotation.y += step;
      this.spin = step;
    } else this.spin = 0;
    // Contact shadow follows the car; re-rendered only when the car moved.
    const target = this.shadowTarget;
    if (target && target.visible) {
      this.shadow.group.visible = true;
      target.updateMatrixWorld();
      if (this.shadow.dirty || !this.shadow.last.equals(target.matrixWorld)) {
        const p = new THREE.Vector3().setFromMatrixPosition(target.matrixWorld);
        const box = new THREE.Box3().setFromObject(target);
        this.shadow.group.position.set(p.x, box.min.y + 0.003, p.z);
        this.shadow.group.updateMatrixWorld(true);
        this.shadow.render(this.stage.scene);
        this.shadow.last.copy(target.matrixWorld);
        this.shadow.dirty = false;
      }
    } else this.shadow.group.visible = false;
  }
}

function dispose(object) {
  object.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) { for (const k of ['map', 'roughnessMap', 'bumpMap', 'emissiveMap']) if (m[k]) m[k].dispose(); m.dispose(); }
  });
}

const tones = new Map();
function averageTone(textureName) {
  if (tones.has(textureName)) return tones.get(textureName).clone();
  const t = tiled(textureName, 1, 1).map;
  const img = t.image, c = document.createElement('canvas');
  c.width = c.height = 8;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, 8, 8);
  const d = ctx.getImageData(0, 0, 8, 8).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  const col = new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
  tones.set(textureName, col);
  t.dispose();
  return col.clone();
}
