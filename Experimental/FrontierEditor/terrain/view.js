// Viewport: three.js scene for the terrain. The heightfield is one indexed grid; the albedo and the
// roughness come from the texturing stack as DataTextures. Water is a separate surface built from the
// water-level field, so it only exists where water does, and it fades at the shoreline.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { terrainGeometry, waterGeometry } from './mesh.js';
import { NO_WATER } from './routing.js';

const BG = '#14171c';

// dark graphite → warm sand, for the height-style debug views
function ramp(t) {
  const k = Math.min(1, Math.max(0, t));
  return [0.12 + 0.8 * k, 0.11 + 0.75 * k, 0.1 + 0.68 * k];
}

export class TerrainView {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG);
    this.camera = new THREE.PerspectiveCamera(36, 1, 2, 40000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.485;

    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 1.5;
    this.scene.add(this.sun);
    this.scene.add(new THREE.HemisphereLight(0xdde7f4, 0x3a3228, 1.1));

    this.material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, color: 0xffffff });
    this.waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x4f8f96, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.9, depthWrite: false,
    });
    // Water colour follows depth: shallow water is pale and see-through so the bed shows, deep water is
    // dark and more opaque. The shore has a thin lighter rim, and the alpha goes to zero at the contour.
    this.waterMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aDepth;\nvarying float vDepth;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDepth = aDepth;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vDepth;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float deepN = smoothstep(0.0, 5.0, vDepth);
          diffuseColor.rgb = mix(vec3(0.42, 0.62, 0.62), vec3(0.04, 0.15, 0.19), deepN);
          float rim = 1.0 - smoothstep(0.0, 0.5, vDepth);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.7, 0.76, 0.72), rim * 0.22);
          diffuseColor.a *= mix(0.45, 0.93, smoothstep(0.0, 1.5, vDepth)) * smoothstep(0.0, 0.22, vDepth);`);
    };

    this.terrain = null;
    this.water = null;
    this.size = 1024;
    this.mode = 'shaded';
    this.fields = null;
    this.fieldsVersion = 0;
    this.albedo = null;
    this.roughTex = null;
    this.debugTex = null;
    this.debugFor = null;

    this.resize();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // fields: { N, size, height, water, riverMask, lakeMask, seaMask, hardness, sediment }
  setTerrain(fields) {
    this.fields = fields;
    this.fieldsVersion += 1;
    const { N, size, height, water } = fields;
    this.size = size;

    if (this.terrain) { this.scene.remove(this.terrain); this.terrain.geometry.dispose(); }
    const g = terrainGeometry(N, size, height);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(g.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(g.nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
    geo.setIndex(new THREE.BufferAttribute(g.index, 1));
    this.terrain = new THREE.Mesh(geo, this.material);
    this.terrain.castShadow = true;
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);

    if (this.water) { this.scene.remove(this.water); this.water.geometry.dispose(); }
    const w = waterGeometry(N, size, height, water);
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(w.pos, 3));
    wg.setAttribute('aDepth', new THREE.BufferAttribute(w.depth, 1));
    wg.setIndex(new THREE.BufferAttribute(w.index, 1));
    wg.computeVertexNormals();
    this.water = new THREE.Mesh(wg, this.waterMaterial);
    this.water.renderOrder = 2;
    this.scene.add(this.water);

    this.sun.position.set(-0.6 * size, 0.95 * size, 0.55 * size);
    // shadow frustum: the whole tile, seen from the sun
    const sc = this.sun.shadow.camera;
    const r = size * 0.62;
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r;
    sc.near = size * 0.2; sc.far = size * 3;
    sc.updateProjectionMatrix();
    this.scene.fog = new THREE.Fog(BG, size * 1.6, size * 4.5);
    this.applyMode();
  }

  setAlbedo({ N, rgba, rough }) {
    if (this.albedo) this.albedo.dispose();
    if (this.roughTex) this.roughTex.dispose();
    this.albedo = new THREE.DataTexture(new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.length), N, N, THREE.RGBAFormat);
    this.albedo.colorSpace = THREE.SRGBColorSpace;
    this.albedo.magFilter = THREE.LinearFilter;
    this.albedo.minFilter = THREE.LinearMipmapLinearFilter;
    this.albedo.generateMipmaps = true;
    this.albedo.needsUpdate = true;
    // roughness lives in the green channel, as glTF and three.js expect
    const g = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) { g[i * 4] = 0; g[i * 4 + 1] = rough[i]; g[i * 4 + 2] = 0; g[i * 4 + 3] = 255; }
    this.roughTex = new THREE.DataTexture(g, N, N, THREE.RGBAFormat);
    this.roughTex.needsUpdate = true;
    this.applyMode();
  }

  setMode(mode) {
    this.mode = mode;
    this.applyMode();
  }

  // Debug colourings are built from the fields on the main thread: cheap, and no re-evaluation.
  debugColours(mode) {
    const f = this.fields;
    const { N, height, water, hardness, sediment, riverMask, lakeMask, seaMask } = f;
    const total = N * N, out = new Uint8Array(total * 4);
    const cell = this.size / (N - 1);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < total; i++) { if (height[i] < lo) lo = height[i]; if (height[i] > hi) hi = height[i]; }
    const span = Math.max(1e-3, hi - lo);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const c = j * N + i;
        let rgb;
        if (mode === 'height') rgb = ramp((height[c] - lo) / span);
        else if (mode === 'slope') {
          const il = Math.max(0, i - 1), ir = Math.min(N - 1, i + 1);
          const jd = Math.max(0, j - 1), ju = Math.min(N - 1, j + 1);
          const gx = (height[j * N + ir] - height[j * N + il]) / ((ir - il) * cell || 1);
          const gz = (height[ju * N + i] - height[jd * N + i]) / ((ju - jd) * cell || 1);
          rgb = ramp((Math.atan(Math.hypot(gx, gz)) / (Math.PI / 2)) * 1.2);
        } else if (mode === 'hardness') rgb = ramp(hardness[c]);
        else if (mode === 'sediment') rgb = [0.2 + 0.7 * sediment[c], 0.12 + 0.5 * sediment[c], 0.08 + 0.25 * sediment[c]];
        else {
          // water: sea, lakes and rivers get their own colour; dry ground stays neutral
          const wet = water[c] > NO_WATER / 2 && water[c] > height[c] + 0.02;
          if (!wet) rgb = [0.24, 0.22, 0.2];
          else if (seaMask[c] > 0.5) rgb = [0.1, 0.55, 0.55];
          else if (lakeMask[c] > 0.5) rgb = [0.4, 0.72, 0.95];
          else if (riverMask[c] > 0.5) rgb = [0.2, 0.55, 0.95];
          else rgb = [0.12, 0.42, 0.85];
        }
        out[c * 4] = rgb[0] * 255; out[c * 4 + 1] = rgb[1] * 255; out[c * 4 + 2] = rgb[2] * 255; out[c * 4 + 3] = 255;
      }
    }
    return out;
  }

  applyMode() {
    if (!this.terrain || !this.fields) return;
    if (this.mode === 'shaded') {
      // no albedo yet (texturing still running): plain clay, so the shape reads at once
      this.material.map = this.albedo;
      this.material.roughnessMap = this.albedo ? this.roughTex : null;
      this.material.color.set(this.albedo ? 0xffffff : 0x9a9a92);
      this.material.roughness = this.albedo ? 1 : 0.9;
    } else {
      const key = `${this.mode}:${this.fieldsVersion}`;
      if (this.debugFor !== key) {
        if (this.debugTex) this.debugTex.dispose();
        const N = this.fields.N;
        this.debugTex = new THREE.DataTexture(this.debugColours(this.mode), N, N, THREE.RGBAFormat);
        this.debugTex.colorSpace = THREE.SRGBColorSpace;
        this.debugTex.needsUpdate = true;
        this.debugFor = key;
      }
      this.material.map = this.debugTex;
      this.material.roughnessMap = null;
      this.material.color.set(0xffffff);
      this.material.roughness = 0.9;
    }
    this.material.needsUpdate = true;
    this.waterMaterial.opacity = this.mode === 'water' ? 1 : 0.92;
  }

  frame() {
    if (!this.fields) return;
    const s = this.size;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < this.fields.height.length; i++) {
      const h = this.fields.height[i];
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    // look at the middle of the height range, from a distance that keeps the whole tile in view
    this.controls.target.set(0, (lo + hi) * 0.4, 0);
    this.camera.position.set(-0.62 * s, 0.8 * s, 1.05 * s);
    this.camera.near = Math.max(1, s * 0.002);
    this.camera.far = s * 12;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  dispose() {
    this.running = false;
    this.observer.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
