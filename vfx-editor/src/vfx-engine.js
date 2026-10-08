// Frontier VFX Engine — GPU-parametric streak + point renderer.
// One unified shader family covers: starburst, bloom, silk flow, voxel shell, wave layers.
// This file is the runtime. The editor (main.js) drives it; games can import it too.
import * as THREE from 'three';

export const MAX_COUNT = 60000;

const COMMON_GLSL = /* glsl */`
uniform float uTime;
uniform float uLife;
uniform float uRadius;
uniform float uSpeed;
uniform float uSpread;
uniform vec3  uDirection;
uniform float uTurbulence;
uniform float uCurl;
uniform float uTwist;
uniform float uWaveFreq;
uniform float uWaveAmp;
uniform float uFlowSpeed;
uniform float uFlowLength;
uniform float uGravity;
uniform float uDrag;
uniform float uShape;
uniform float uBurst; // 0..1 envelope after manual burst trigger

// life-phase for a particle: loops 0..1, offset by seed
float lifePhase(float seedW, float tOffset) {
  float t = fract(uTime / uLife + seedW + tOffset);
  return t;
}

vec3 calcPos(vec4 seed, vec3 dir, float t) {
  float r  = seed.x;
  float r2 = seed.y;
  float r3 = seed.z;
  // drag eases expansion
  float tt = pow(t, mix(1.0, 0.55, clamp(uDrag, 0.0, 1.0)));
  // manual burst punch
  float punch = 1.0 + uBurst * 0.9 * (1.0 - t);
  vec3 pos = vec3(0.0);
  float shape = uShape;

  if (shape < 0.5) {
    // ---- 0 · SPHERE BURST (fiber-optic starburst) ----
    vec3 bias = normalize(uDirection + dir * max(uSpread, 0.05));
    vec3 d = normalize(mix(dir, bias, 0.65));
    float dist = tt * uRadius * (0.22 + 0.78 * r) * uSpeed * punch;
    pos = d * dist;
  } else if (shape < 1.5) {
    // ---- 1 · BLOOM DOME (petal bloom + dust) ----
    vec3 d = dir;
    d.y = abs(d.y) * 0.75 + 0.12;
    d = normalize(d + uDirection * 0.35);
    float shell = 0.25 + 0.75 * pow(r, 0.7);
    pos = d * (tt * uRadius * shell * uSpeed * punch);
    pos.y += tt * tt * -uGravity * 1.5;
  } else if (shape < 2.5) {
    // ---- 2 · SILK FLOW (horizontal ribbon current) ----
    float span = max(uFlowLength, 2.0);
    float x = (r - 0.5) * span * 0.7 + (tt - 0.5) * uFlowSpeed * 4.0;
    x = mod(x + span * 0.5, span) - span * 0.5;
    float env = 1.0 - pow(abs(x) / (span * 0.5), 2.0) * 0.55;
    float y = sin(x * uWaveFreq + uTime * 0.7 + r2 * 6.2831) * uWaveAmp * (0.25 + 0.75 * r3) * env;
    float z = cos(x * uWaveFreq * 0.8 + seed.w * 6.2831 + uTime * 0.4) * uWaveAmp * (0.25 + 0.75 * r2) * env;
    float tw = x * uTwist * 0.45 + uTime * 0.15;
    float c = cos(tw), s = sin(tw);
    pos = vec3(x, y * c - z * s, y * s + z * c) + dir * 0.18 * uSpread;
  } else if (shape < 3.5) {
    // ---- 3 · VOXEL SHELL (chunky explosion ball) ----
    vec3 d = normalize(dir + vec3(0.0001));
    float lump = 0.62 + 0.28 * sin(r * 43.7) * sin(r2 * 31.3) + r3 * 0.22;
    float grow = (0.35 + 0.65 * tt);
    pos = d * (lump * uRadius * grow * uSpeed * punch);
    // slight voxel snap for chunky feel
    pos = floor(pos * 26.0) / 26.0;
    pos.y -= tt * tt * uGravity * 2.2;
  } else {
    // ---- 4 · WAVE LAYERS (parallel streak sheets) ----
    float span = max(uFlowLength, 2.0);
    float layer = floor(r * 6.0) / 6.0;
    float x = (r2 - 0.5) * span * 0.6 + tt * uFlowSpeed * 2.0;
    x = mod(x + span * 0.5, span) - span * 0.5;
    float y = sin(x * uWaveFreq + layer * 5.0 + uTime * 0.55) * uWaveAmp * (0.55 + layer * 0.9);
    float z = (layer - 0.5) * 4.2 + cos(x * uWaveFreq * 0.6 + r3 * 3.0) * uWaveAmp * 0.4;
    pos = vec3(x, y, z) + dir * 0.1 * uSpread;
    float tw = uTwist * 0.3 * x * 0.2;
    float c = cos(tw), s = sin(tw);
    pos.yz = mat2(c, -s, s, c) * pos.yz;
  }

  // ---- shared turbulence / curl ----
  float tb = uTurbulence * (0.25 + 0.75 * tt);
  float ph = uTime * 1.2;
  pos.x += (sin(pos.y * 1.7 + ph + r * 6.2831) * 0.4 + sin(pos.z * 2.2 - ph * 0.8) * uCurl * 0.5) * tb;
  pos.y += (sin(pos.z * 1.8 + ph * 0.9 + r2 * 6.2831) * 0.4) * tb;
  pos.z += (cos(pos.x * 1.6 + ph * 1.1 + r3 * 6.2831) * 0.4 + cos(pos.y * 2.0 + ph) * uCurl * 0.5) * tb;

  // twist around Y for radial shapes
  if (shape < 1.5) {
    float ang = uTwist * tt * 2.4;
    float c = cos(ang), s = sin(ang);
    pos.xz = mat2(c, -s, s, c) * pos.xz;
  }
  return pos;
}

vec3 palette(float t, vec3 cA, vec3 cB, vec3 cC) {
  // head = A (hot white), mid = B, tail/old = C
  vec3 col = mix(cA, cB, smoothstep(0.0, 0.45, t));
  col = mix(col, cC, smoothstep(0.35, 1.0, t));
  return col;
}
`;

// fragment shaders only need the palette (full COMMON would reference uTime-driven fns)
const PALETTE_GLSL = /* glsl */`
vec3 palette(float t, vec3 cA, vec3 cB, vec3 cC) {
  vec3 col = mix(cA, cB, smoothstep(0.0, 0.45, t));
  col = mix(col, cC, smoothstep(0.35, 1.0, t));
  return col;
}
`;

const STREAK_VERT = /* glsl */`
attribute vec4 aSeed;
attribute vec3 aDir;
attribute float aEnd; // 0 = head, 1 = tail
uniform float uStreak;
varying float vT;
varying float vEnd;
varying float vSeed;
${COMMON_GLSL}
void main() {
  float tHead = lifePhase(aSeed.w, 0.0);
  float t = tHead - aEnd * uStreak;
  t = clamp(t, 0.0, 0.999);
  // hide tail before birth
  float born = step(aEnd * uStreak, tHead);
  vec3 p = calcPos(aSeed, aDir, t);
  vT = tHead;
  vEnd = aEnd;
  vSeed = aSeed.x;
  vec4 mv = modelViewMatrix * vec4(p * born, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

const STREAK_FRAG = /* glsl */`
precision mediump float;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform float uStreakOpacity;
varying float vT;
varying float vEnd;
varying float vSeed;
${PALETTE_GLSL}
void main() {
  vec3 col = palette(vT, uColorA, uColorB, uColorC);
  float headBright = 1.6 - vT * 0.9;
  float tailFade = 1.0 - vEnd;
  tailFade *= tailFade;
  float a = uStreakOpacity * tailFade * headBright;
  // soft birth/death
  a *= smoothstep(0.0, 0.06, vT) * (1.0 - smoothstep(0.75, 1.0, vT) * 0.7);
  gl_FragColor = vec4(col * headBright, a);
}
`;

const POINT_VERT = /* glsl */`
attribute vec4 aSeed;
attribute vec3 aDir;
uniform float uPointSize;
uniform float uSizeAttn;
varying float vT;
varying float vSeed;
${COMMON_GLSL}
void main() {
  float t = lifePhase(aSeed.w, 0.0);
  vec3 p = calcPos(aSeed, aDir, t);
  vT = t;
  vSeed = aSeed.x;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float twinkle = 0.7 + 0.6 * sin(uTime * (2.0 + vSeed * 4.0) + vSeed * 40.0);
  float sz = uPointSize * (0.5 + 0.8 * (1.0 - t)) * twinkle * (0.6 + 0.8 * vSeed);
  if (uSizeAttn > 0.5) {
    gl_PointSize = sz * (140.0 / -mv.z);
  } else {
    gl_PointSize = sz * 3.0;
  }
}
`;

const POINT_FRAG = /* glsl */`
precision mediump float;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform float uPointOpacity;
varying float vT;
varying float vSeed;
${PALETTE_GLSL}
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  float disc = smoothstep(1.0, 0.15, d);
  float core = smoothstep(0.5, 0.0, d) * 0.9;
  vec3 col = palette(vT, uColorA, uColorB, uColorC);
  float a = uPointOpacity * disc * (smoothstep(0.0, 0.05, vT)) * (1.0 - smoothstep(0.8, 1.0, vT) * 0.65);
  gl_FragColor = vec4(col * (1.0 + core), a);
}
`;

function randomDir(out) {
  // uniform sphere
  const u = Math.random();
  const v = Math.random();
  const theta = 2 * Math.PI * u;
  const phi = Math.acos(2 * v - 1);
  out[0] = Math.sin(phi) * Math.cos(theta);
  out[1] = Math.sin(phi) * Math.sin(theta);
  out[2] = Math.cos(phi);
  return out;
}

export class VfxEffect {
  /** @param {THREE.Scene} scene */
  constructor(scene, params) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.params = params;
    this.time = Math.random() * 10;
    this.burst = 0;

    this.uniforms = {
      uTime: { value: 0 },
      uLife: { value: 4 },
      uRadius: { value: 5 },
      uSpeed: { value: 1 },
      uSpread: { value: 0.8 },
      uDirection: { value: new THREE.Vector3(0, 0.3, 0) },
      uTurbulence: { value: 0.5 },
      uCurl: { value: 0.5 },
      uTwist: { value: 0.3 },
      uWaveFreq: { value: 1.2 },
      uWaveAmp: { value: 0.4 },
      uFlowSpeed: { value: 1 },
      uFlowLength: { value: 12 },
      uGravity: { value: 0 },
      uDrag: { value: 0.3 },
      uShape: { value: 0 },
      uBurst: { value: 0 },
      uColorA: { value: new THREE.Color('#ffffff') },
      uColorB: { value: new THREE.Color('#37b6ff') },
      uColorC: { value: new THREE.Color('#7a2bff') },
      uStreak: { value: 0.05 },
      uStreakOpacity: { value: 0.85 },
      uPointSize: { value: 2.4 },
      uPointOpacity: { value: 0.9 },
      uSizeAttn: { value: 1 },
    };

    this.streakMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.pointMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    // soft core glow sprite
    const glowTex = makeGlowTexture();
    this.glowMat = new THREE.SpriteMaterial({
      map: glowTex, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.glow = new THREE.Sprite(this.glowMat);
    this.glow.scale.setScalar(3);
    this.group.add(this.glow);

    this.streaks = null;
    this.points = null;
    this.applyParams(params, true);
  }

  applyParams(p, rebuild = false) {
    this.params = p;
    const u = this.uniforms;
    u.uLife.value = p.life;
    u.uRadius.value = p.radius;
    u.uSpeed.value = p.speed;
    u.uSpread.value = p.spread;
    u.uDirection.value.set(p.dirX ?? 0, p.dirY ?? 0.3, p.dirZ ?? 0);
    u.uTurbulence.value = p.turbulence;
    u.uCurl.value = p.curl;
    u.uTwist.value = p.twist;
    u.uWaveFreq.value = p.waveFreq;
    u.uWaveAmp.value = p.waveAmp;
    u.uFlowSpeed.value = p.flowSpeed;
    u.uFlowLength.value = p.flowLength;
    u.uGravity.value = p.gravity;
    u.uDrag.value = p.drag;
    u.uShape.value = p.shape;
    u.uColorA.value.set(p.colorA);
    u.uColorB.value.set(p.colorB);
    u.uColorC.value.set(p.colorC);
    u.uStreak.value = p.streakLength;
    u.uStreakOpacity.value = p.streakOpacity;
    u.uPointSize.value = p.pointSize;
    u.uPointOpacity.value = p.pointOpacity;
    u.uSizeAttn.value = p.sizeAttn ? 1 : 0;
    this.glowMat.opacity = 0.55 * (p.coreGlow ?? 0.8);
    this.glowMat.color.set(p.colorB);
    const s = 2.2 + (p.coreGlow ?? 0.8) * 2.2;
    this.glow.scale.setScalar(p.shape === 2 || p.shape === 4 ? s * 0.5 : s);
    this.glow.visible = (p.coreGlow ?? 0.8) > 0.02;
    if (this.streaks) this.streaks.visible = p.showStreaks !== false;
    if (this.points) this.points.visible = p.showPoints !== false;

    const count = Math.max(500, Math.min(MAX_COUNT, Math.round(p.count)));
    if (rebuild || count !== this.count) this.rebuild(count);
  }

  rebuild(count) {
    this.count = count;
    const d = [0, 0, 0];
    // --- streak lines: 2 verts per particle ---
    const ls = new Float32Array(count * 2 * 4);
    const ld = new Float32Array(count * 2 * 3);
    const le = new Float32Array(count * 2);
    const ps = new Float32Array(count * 4);
    const pd = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const s0 = Math.random(), s1 = Math.random(), s2 = Math.random(), s3 = Math.random();
      randomDir(d);
      ls.set([s0, s1, s2, s3], i * 8);
      ls.set([s0, s1, s2, s3], i * 8 + 4);
      ld.set(d, i * 6);
      ld.set(d, i * 6 + 3);
      le[i * 2] = 0; le[i * 2 + 1] = 1;
      ps.set([s0, s1, s2, s3], i * 4);
      pd.set(d, i * 3);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 2 * 3), 3));
    lg.setAttribute('aSeed', new THREE.BufferAttribute(ls, 4));
    lg.setAttribute('aDir', new THREE.BufferAttribute(ld, 3));
    lg.setAttribute('aEnd', new THREE.BufferAttribute(le, 1));
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    pg.setAttribute('aSeed', new THREE.BufferAttribute(ps, 4));
    pg.setAttribute('aDir', new THREE.BufferAttribute(pd, 3));

    if (this.streaks) { this.group.remove(this.streaks); this.streaks.geometry.dispose(); }
    if (this.points) { this.group.remove(this.points); this.points.geometry.dispose(); }
    this.streaks = new THREE.LineSegments(lg, this.streakMat);
    this.streaks.frustumCulled = false;
    this.streaks.visible = this.params.showStreaks !== false;
    this.points = new THREE.Points(pg, this.pointMat);
    this.points.frustumCulled = false;
    this.points.visible = this.params.showPoints !== false;
    this.group.add(this.streaks, this.points);
  }

  triggerBurst(strength = 1) {
    this.burst = Math.min(1.5, this.burst + strength);
  }

  update(dt, playing) {
    if (playing) this.time += dt;
    this.burst = Math.max(0, this.burst - dt * 1.4);
    this.uniforms.uTime.value = this.time;
    this.uniforms.uBurst.value = this.burst;
  }

  dispose() {
    this.scene.remove(this.group);
    this.streakMat.dispose();
    this.pointMat.dispose();
    if (this.streaks) this.streaks.geometry.dispose();
    if (this.points) this.points.geometry.dispose();
  }
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
