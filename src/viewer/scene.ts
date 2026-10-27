/**
 * three.js viewport: PBR preview of the single welded plant mesh with
 * image-based lighting, one shadow map, quad wireframe overlay, a procedural
 * texture atlas (toggled against flat vertex colour) and the shared vertex
 * wind shader.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GpuBuffers } from '../tropical/export';
import { createAtlasCanvas } from '../tropical/textures';
import { WIND_ATTRIBUTES, WIND_FUNCTIONS, WIND_UNIFORMS } from './shaders';

export type DisplayMode = 'shaded' | 'wireframe' | 'levels' | 'wind' | 'junctions' | 'matcap';

export interface ViewerSettings {
  mode: DisplayMode;
  showWire: boolean;
  /** Procedural atlas on (true) or flat vertex colour only (false). */
  useTexture: boolean;
  windEnabled: boolean;
  windStrength: number;
  windGust: number;
  windDirection: number;
  trunkFlex: number;
  limbFlex: number;
  detailFlex: number;
  autoRotate: boolean;
  showGrid: boolean;
}

export const DEFAULT_VIEW: ViewerSettings = {
  mode: 'shaded',
  showWire: false,
  useTexture: true,
  windEnabled: true,
  windStrength: 1.0,
  windGust: 0.4,
  windDirection: 35,
  trunkFlex: 1,
  limbFlex: 1,
  detailFlex: 1,
  autoRotate: false,
  showGrid: true,
};

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private clock = new THREE.Clock();
  private uniforms: Record<string, THREE.IUniform>;
  private plantGroup = new THREE.Group();
  private plantMesh: THREE.Mesh | null = null;
  private wireMesh: THREE.LineSegments | null = null;
  private ground: THREE.Mesh;
  private groundMat: THREE.MeshStandardMaterial;
  private grid: THREE.GridHelper;
  private sun: THREE.DirectionalLight;
  private settings: ViewerSettings = { ...DEFAULT_VIEW };
  private plantHeight = 10;
  private pmrem: THREE.PMREMGenerator;
  private matcapTexture: THREE.Texture;
  private atlasTexture: THREE.Texture;
  private disposed = false;
  private frameCallbacks: ((dt: number) => void)[] = [];
  private lastFpsTime = 0;
  private frames = 0;
  fps = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Wind deforms in the vertex shader only, so the shadow of the undisplaced
    // mesh is static: render it once per plant instead of every frame.
    this.renderer.shadowMap.autoUpdate = false;

    this.scene.background = new THREE.Color(0x0c0d10);
    this.scene.fog = new THREE.Fog(0x0c0d10, 60, 220);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 600);
    this.camera.position.set(18, 9, 24);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 6, 0);
    this.controls.maxPolarAngle = Math.PI * 0.52;
    this.controls.minDistance = 0.05;
    this.controls.maxDistance = 300;

    this.sun = new THREE.DirectionalLight(0xfff1dc, 3.4);
    this.sun.position.set(30, 45, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    const hemi = new THREE.HemisphereLight(0xbcd0e8, 0x3a3229, 0.55);
    this.scene.add(hemi);

    this.groundMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 1, metalness: 0 });
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(400, 64), this.groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.grid = new THREE.GridHelper(80, 80, 0x3b3e46, 0x2a2d34);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.55;
    this.grid.position.y = 0.002;
    this.scene.add(this.grid);

    this.scene.add(this.plantGroup);

    this.uniforms = {
      uTime: { value: 0 },
      uWindDir: { value: new THREE.Vector3(1, 0, 0.4).normalize() },
      uWindStrength: { value: 1 },
      uWindGust: { value: 0.4 },
      uTreeHeight: { value: 10 },
      uTrunkFlex: { value: 1 },
      uLimbFlex: { value: 1 },
      uDetailFlex: { value: 1 },
    };

    this.matcapTexture = makeMatcap();
    this.atlasTexture = new THREE.CanvasTexture(createAtlasCanvas() as HTMLCanvasElement);
    this.atlasTexture.colorSpace = THREE.SRGBColorSpace;
    this.atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.atlasTexture.anisotropy = 8;
    // flipY stays true (three.js default) — the atlas layout accounts for it.

    window.addEventListener('resize', this.resize);
    this.resize();
    this.renderer.setAnimationLoop(this.tick);
  }

  onFrame(cb: (dt: number) => void): void {
    this.frameCallbacks.push(cb);
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.resize);
  }

  private resize = (): void => {
    const parent = this.canvas.parentElement ?? document.body;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  };

  private tick = (): void => {
    if (this.disposed) return;
    const dt = this.clock.getDelta();
    const t = this.clock.elapsedTime;
    this.uniforms.uTime.value = this.settings.windEnabled ? t : 0;
    this.controls.autoRotate = this.settings.autoRotate;
    this.controls.update();
    for (const cb of this.frameCallbacks) cb(dt);
    this.renderer.render(this.scene, this.camera);
    this.frames++;
    if (t - this.lastFpsTime > 0.5) {
      this.fps = this.frames / (t - this.lastFpsTime);
      this.frames = 0;
      this.lastFpsTime = t;
    }
  };

  applySettings(s: ViewerSettings): void {
    this.settings = { ...s };
    this.uniforms.uWindStrength.value = s.windEnabled ? s.windStrength : 0;
    this.uniforms.uWindGust.value = s.windGust;
    const a = (s.windDirection * Math.PI) / 180;
    (this.uniforms.uWindDir.value as THREE.Vector3).set(Math.cos(a), 0, Math.sin(a));
    this.uniforms.uTrunkFlex.value = s.trunkFlex;
    this.uniforms.uLimbFlex.value = s.limbFlex;
    this.uniforms.uDetailFlex.value = s.detailFlex;
    if (this.wireMesh) this.wireMesh.visible = s.showWire || s.mode === 'wireframe';
    this.grid.visible = s.showGrid;
    if (this.plantMesh) {
      const mat = this.plantMesh.material as THREE.MeshStandardMaterial & { userData: { mode?: { value: number }; useMap?: { value: number } } };
      mat.userData.mode!.value = modeIndex(s.mode);
      mat.userData.useMap!.value = s.useTexture ? 1 : 0;
      mat.wireframe = false;
      this.plantMesh.visible = true;
    }
  }

  setPlant(buffers: GpuBuffers, height: number): void {
    this.clearPlant();
    this.plantHeight = Math.max(0.05, height);
    this.uniforms.uTreeHeight.value = Math.max(0.5, height);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(buffers.position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(buffers.normal, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(buffers.uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(buffers.color, 3));
    geo.setAttribute('aWind', new THREE.BufferAttribute(buffers.wind, 4));
    geo.setAttribute('aPivot', new THREE.BufferAttribute(buffers.pivot, 3));
    geo.setAttribute('aOrgan', new THREE.BufferAttribute(buffers.organ, 1));
    geo.setAttribute('aJunction', new THREE.BufferAttribute(buffers.junction, 1));
    geo.setAttribute('aTile', new THREE.BufferAttribute(buffers.tile, 1));
    geo.setIndex(new THREE.BufferAttribute(buffers.index, 1));

    const mat = this.makePlantMaterial();
    this.plantMesh = new THREE.Mesh(geo, mat);
    this.plantMesh.castShadow = true;
    this.plantMesh.receiveShadow = true;
    this.plantMesh.frustumCulled = false;
    this.plantGroup.add(this.plantMesh);

    // Quad wireframe (true quad edges, not the triangulation).
    const wgeo = new THREE.BufferGeometry();
    wgeo.setAttribute('position', geo.getAttribute('position'));
    wgeo.setAttribute('aWind', geo.getAttribute('aWind'));
    wgeo.setAttribute('aPivot', geo.getAttribute('aPivot'));
    wgeo.setIndex(new THREE.BufferAttribute(buffers.edgeIndex, 1));
    this.wireMesh = new THREE.LineSegments(wgeo, this.makeWireMaterial());
    this.wireMesh.frustumCulled = false;
    this.wireMesh.renderOrder = 2;
    this.plantGroup.add(this.wireMesh);

    const r = Math.max(1.2, this.plantHeight * 0.8);
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 1;
    cam.far = 200;
    cam.updateProjectionMatrix();
    this.sun.position.set(r * 1.2, r * 2.2, r * 0.9);
    this.sun.target.position.set(0, this.plantHeight * 0.4, 0);
    this.renderer.shadowMap.needsUpdate = true;
    this.applySettings(this.settings);
  }

  /** Fit the whole plant in view from the standard three-quarter direction. */
  frame(): void {
    const dir = new THREE.Vector3(0.7, 0.32, 1).normalize();
    const fwd = dir.clone().negate();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd);
    const tanV = Math.tan((this.camera.fov * Math.PI) / 360);
    const tanH = tanV * Math.max(0.4, this.camera.aspect);

    const pos = this.plantMesh ? (this.plantMesh.geometry.getAttribute('position').array as Float32Array) : null;
    let cy = this.plantHeight * 0.5;
    let dist = this.plantHeight * 2;
    if (pos && pos.length >= 3) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < pos.length; i += 3) {
        const y = pos[i + 1];
        if (y < -0.01) continue;
        const x = pos[i], z = pos[i + 2];
        const sx = x * right.x + y * right.y + z * right.z;
        const sy = x * up.x + y * up.y + z * up.z;
        if (sx < minX) minX = sx;
        if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy;
        if (sy > maxY) maxY = sy;
      }
      if (!Number.isFinite(minX)) return;
      const mx = (minX + maxX) * 0.5;
      const my = (minY + maxY) * 0.5;
      let need = 0;
      const n = pos.length / 3;
      const req = new Float32Array(n);
      let k = 0;
      for (let i = 0; i < pos.length; i += 3) {
        const y = pos[i + 1];
        if (y < -0.01) continue;
        const x = pos[i], z = pos[i + 2];
        const sx = x * right.x + y * right.y + z * right.z - mx;
        const sy = x * up.x + y * up.y + z * up.z - my;
        const sz = x * dir.x + y * dir.y + z * dir.z;
        const d = Math.max(Math.abs(sx) / tanH, Math.abs(sy) / tanV) + sz;
        req[k++] = d;
        if (d > need) need = d;
      }
      const bins = new Uint32Array(512);
      const lo = Math.min(0, need);
      const scaleF = 511 / Math.max(1e-6, need - lo);
      for (let i = 0; i < k; i++) bins[Math.floor((req[i] - lo) * scaleF)]++;
      let acc = 0;
      let b = 0;
      for (; b < 512; b++) {
        acc += bins[b];
        if (acc >= k * 0.998) break;
      }
      dist = Math.max(0.1, (lo + (b + 1) / scaleF) * 1.1);
      const centre = right.clone().multiplyScalar(mx).add(up.clone().multiplyScalar(my + dist * tanV * 0.07));
      const target = new THREE.Vector3(centre.x, centre.y, centre.z);
      this.controls.target.copy(target);
      this.camera.position.copy(dir).multiplyScalar(dist).add(target);
      this.controls.update();
      return;
    }
    this.controls.target.set(0, cy, 0);
    this.camera.position.copy(dir).multiplyScalar(dist).add(new THREE.Vector3(0, cy, 0));
    this.controls.update();
  }

  /** Low camera on the trunk base. */
  frameBase(reach = 4): void {
    const d = Math.max(0.4, reach * 1.6);
    const ty = Math.min(0.35, d * 0.12);
    this.controls.target.set(0, ty, 0);
    const dir = new THREE.Vector3(0.75, 0.42, 1).normalize();
    this.camera.position.copy(dir.multiplyScalar(d)).add(new THREE.Vector3(0, ty, 0));
    this.controls.update();
  }

  private clearPlant(): void {
    for (const m of [this.plantMesh, this.wireMesh]) {
      if (!m) continue;
      this.plantGroup.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.plantMesh = this.wireMesh = null;
  }

  // ---------------------------------------------------------------------------
  // Materials
  // ---------------------------------------------------------------------------

  private injectWind(shader: THREE.WebGLProgramParametersWithUniforms): void {
    Object.assign(shader.uniforms, this.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_UNIFORMS}\n${WIND_ATTRIBUTES}\n${WIND_FUNCTIONS}`)
      .replace('#include <begin_vertex>', `vec3 transformed = applyWind(vec3(position));`);
  }

  private makePlantMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      map: this.atlasTexture,
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.0,
      side: THREE.FrontSide, // the mesh is a closed manifold: no backfaces needed
    });
    const modeU = { value: 0 };
    const useMapU = { value: 1 };
    mat.userData.mode = modeU;
    mat.userData.useMap = useMapU;
    mat.onBeforeCompile = (shader) => {
      this.injectWind(shader);
      shader.uniforms.uMode = modeU;
      shader.uniforms.uUseMap = useMapU;
      shader.uniforms.uMatcap = { value: this.matcapTexture };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nattribute float aOrgan;\nattribute float aJunction;\nattribute float aTile;\nvarying vec4 vWindV;\nvarying float vOrgan;\nvarying float vJunction;\nvarying float vTile;\nvarying vec3 vViewNrm;`)
        .replace('#include <fog_vertex>', `#include <fog_vertex>\nvWindV = aWind;\nvOrgan = aOrgan;\nvJunction = aJunction;\nvTile = aTile;\nvViewNrm = normalize(normalMatrix * objectNormal);`);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\nuniform float uMode;\nuniform float uUseMap;\nuniform sampler2D uMatcap;\nvarying vec4 vWindV;\nvarying float vOrgan;\nvarying float vJunction;\nvarying float vTile;\nvarying vec3 vViewNrm;
          vec3 srgbIn(vec3 c) { return pow(c, vec3(2.2)); }
          vec3 organColor(float l) {
            if (l < 0.5) return srgbIn(vec3(0.54, 0.35, 0.23));
            if (l < 1.5) return srgbIn(vec3(0.79, 0.55, 0.29));
            if (l < 2.5) return srgbIn(vec3(0.44, 0.63, 0.42));
            if (l < 3.5) return srgbIn(vec3(0.35, 0.63, 0.79));
            return srgbIn(vec3(0.72, 0.42, 0.36));
          }
          vec3 heat(float t) {
            t = clamp(t, 0.0, 1.0);
            return srgbIn(mix(mix(vec3(0.10, 0.20, 0.55), vec3(0.20, 0.75, 0.55), smoothstep(0.0, 0.5, t)), vec3(0.98, 0.85, 0.25), smoothstep(0.5, 1.0, t)));
          }`,
        )
        .replace(
          '#include <map_fragment>',
          `// Procedural atlas: tile-local UVs (continuous v) mapped into the
          // tile rect with fract(); textureGrad keeps filtering correct
          // across repeat seams using the continuous derivatives.
          if (uUseMap > 0.5) {
            vec2 cell = vec2(mod(vTile, 2.0), floor(vTile / 2.0));
            vec2 org = cell * 0.5 + vec2(16.0 / 1024.0);
            vec2 sc = vec2(480.0 / 1024.0);
            vec2 auv = org + fract(vMapUv) * sc;
            diffuseColor *= textureGrad(map, auv, dFdx(vMapUv) * sc, dFdy(vMapUv) * sc);
          }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          if (uMode > 0.5 && uMode < 1.5) diffuseColor.rgb = organColor(vOrgan);
          else if (uMode > 1.5 && uMode < 2.5) diffuseColor.rgb = heat(vWindV.y * 0.75 + vWindV.w * 0.25);
          else if (uMode > 2.5 && uMode < 3.5) diffuseColor.rgb = srgbIn(mix(vec3(0.62, 0.60, 0.58), vec3(0.95, 0.42, 0.18), vJunction));
          else if (uMode > 5.5) diffuseColor.rgb = vec3(0.16, 0.17, 0.19);`,
        )
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
          if (uMode > 3.5 && uMode < 4.5) {
            vec3 n = normalize(vViewNrm);
            if (!gl_FrontFacing) n = -n;
            vec2 muv = n.xy * 0.495 + 0.5;
            gl_FragColor = linearToOutputTexel(vec4(texture2D(uMatcap, muv).rgb, 1.0));
          }`,
        );
    };
    mat.customProgramCacheKey = () => 'tropical-plant-v1';
    return mat;
  }

  private makeWireMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        ${WIND_UNIFORMS}
        ${WIND_ATTRIBUTES}
        ${WIND_FUNCTIONS}
        varying float vDepth;
        void main() {
          vec3 p = applyWind(position);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
          gl_Position.z -= 0.0006 * gl_Position.w;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vDepth;
        void main() {
          float a = clamp(1.0 - vDepth / 160.0, 0.25, 1.0);
          gl_FragColor = vec4(0.80, 0.86, 0.95, 0.55 * a);
        }
      `,
    });
  }

  screenshot(): string {
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}

function modeIndex(m: DisplayMode): number {
  switch (m) {
    case 'levels':
      return 1;
    case 'wind':
      return 2;
    case 'junctions':
      return 3;
    case 'matcap':
      return 4;
    case 'wireframe':
      return 6;
    default:
      return 0;
  }
}

/** Procedural clay matcap: neutral studio sphere. */
function makeMatcap(): THREE.Texture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x / (size - 1)) * 2 - 1;
      const ny = 1 - (y / (size - 1)) * 2;
      const r2 = nx * nx + ny * ny;
      const nz = Math.sqrt(Math.max(0, 1 - r2));
      const l1 = Math.max(0, nx * -0.45 + ny * 0.6 + nz * 0.66);
      const l2 = Math.max(0, nx * 0.7 + ny * -0.2 + nz * 0.3);
      const spec = Math.pow(l1, 40) * 0.35;
      const rim = Math.pow(1 - nz, 3) * 0.25;
      const v = 0.18 + 0.62 * Math.pow(l1, 1.4) + 0.14 * l2 + spec + rim;
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, v * 235);
      img.data[i + 1] = Math.min(255, v * 228);
      img.data[i + 2] = Math.min(255, v * 218);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
