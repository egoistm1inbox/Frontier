/**
 * Three.js WebGL Stage & Part-Granular Outliner Viewport.
 *
 * Manages:
 *   - Zero-copy `PartPacket[]` upload into individual `THREE.Mesh` / `THREE.LineSegments`
 *     objects keyed by `partId`, enabling instant Outliner visibility toggle, Solo
 *     isolation, Selected-node rim highlighting, and Raycast part picking!
 *   - 3-point studio lighting uniforms + 3-tier vertex wind animation
 *   - 6 diagnostic display modes (`Shaded`, `Clay`, `Wire`, `Anatomy`, `Detail`, `Wind`)
 *   - Camera presets: `Frame` (full specimen), `Macro` (close-up on leaf veins / moss phyllids / hair locks),
 *     `Base` (crown / rhizome / roots), and `Focus Selected` (frame the selected Outliner part!)
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PartPacket, ShadingProfile } from '../core/mesh';
import {
  DISPLAY_MODE_INDEX,
  DisplayMode,
  SHADOW_DISC_FRAG,
  WIRE_FRAG,
  WIRE_VERT,
  createSpecimenMaterial,
} from './shaders';

const PROFILE_INDEX: Record<ShadingProfile, number> = {
  botanical: 0,
  moss: 1,
  hair: 2,
  substrate: 3,
  flower: 4,
};

interface RenderedPart {
  id: string;
  shading: ShadingProfile;
  bounds: THREE.Box3;
  mesh: THREE.Mesh | null;
  material: THREE.ShaderMaterial | null;
  wire: THREE.LineSegments | null;
  isPureLine: boolean; // e.g. Hair Guide Strands
}

export class ViewportStage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private readonly host: HTMLElement;
  private readonly rootGroup = new THREE.Group();
  private readonly shadowDisc: THREE.Mesh;
  private readonly scaleRefGroup = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();

  private readonly parts = new Map<string, RenderedPart>();
  private sceneHeight = 0.8;
  private macroTarget: [number, number, number, number] = [0, 0.25, 0, 0.14];
  private mode: DisplayMode = 'shaded';
  private turntable = false;
  private scaleVisible = false;
  private paused = false;

  // Outliner visibility / selection state
  private hiddenIds = new Set<string>();
  private soloPartIds: Set<string> | null = null;
  private selectedPartIds = new Set<string>();

  // Smooth camera transition
  private camAnim: {
    t0: number;
    dur: number;
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTgt: THREE.Vector3;
    toTgt: THREE.Vector3;
  } | null = null;

  // Shared GPU uniforms across all parts
  private readonly sharedUniforms = {
    uTime: { value: 0 },
    uWindStrength: { value: 0.36 },
    uWindGust: { value: 0.52 },
    uWindDir: { value: new THREE.Vector2(0.82, 0.57) },
    uKeyDir: { value: new THREE.Vector3(0.56, 0.74, 0.37).normalize() },
    uFillDir: { value: new THREE.Vector3(-0.68, 0.38, -0.45).normalize() },
    uRimDir: { value: new THREE.Vector3(-0.22, 0.52, -0.82).normalize() },
    uExposure: { value: 1.08 },
    uMode: { value: 0 },
  };

  private readonly wireMaterial: THREE.ShaderMaterial;
  private readonly guideMaterial: THREE.ShaderMaterial;

  private lastFrameMs = performance.now();
  private fpsAccum = 0;
  private fpsFrames = 0;
  public currentFps = 60;
  public onPartPicked?: (partId: string) => void;

  constructor(host: HTMLElement) {
    this.host = host;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050506);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.004, 120);
    this.camera.position.set(0.95, 0.68, 1.25);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.maxDistance = 24;
    this.controls.minDistance = 0.025;
    this.controls.target.set(0, 0.32, 0);

    // Cancel camera tween if user grabs orbit controls
    this.controls.addEventListener('start', () => {
      this.camAnim = null;
    });

    this.scene.add(this.rootGroup);

    // Soft radial contact shadow disc under specimen
    const discGeo = new THREE.PlaneGeometry(1.8, 1.8);
    discGeo.rotateX(-Math.PI / 2);
    const discMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: SHADOW_DISC_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.shadowDisc = new THREE.Mesh(discGeo, discMat);
    this.shadowDisc.position.y = -0.002;
    this.scene.add(this.shadowDisc);

    // Subtle 10cm / 50cm studio scale ruler ticks
    this.buildScaleReference();
    this.scaleRefGroup.visible = false;
    this.scene.add(this.scaleRefGroup);

    this.wireMaterial = new THREE.ShaderMaterial({
      vertexShader: WIRE_VERT,
      fragmentShader: WIRE_FRAG,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      uniforms: {
        ...this.sharedUniforms,
        uWireColor: { value: new THREE.Color(0x4fd8e0) },
        uWireOpacity: { value: 0.42 },
      },
    });

    this.guideMaterial = new THREE.ShaderMaterial({
      vertexShader: WIRE_VERT,
      fragmentShader: WIRE_FRAG,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      uniforms: {
        ...this.sharedUniforms,
        uWireColor: { value: new THREE.Color(0x4fd8e0) },
        uWireOpacity: { value: 0.72 },
      },
    });

    // Double-click or Alt+Click on 3D specimen picks that part in the Outliner!
    this.renderer.domElement.addEventListener('dblclick', (ev) => this.handlePick(ev));

    this.handleResize();
    const ro = new ResizeObserver(() => this.handleResize());
    ro.observe(host);

    this.animate();
  }

  private buildScaleReference(): void {
    const mat = new THREE.LineBasicMaterial({ color: 0x3b444f, transparent: true, opacity: 0.55 });
    const pts: THREE.Vector3[] = [];
    // Vertical 50cm & 1m botanical ruler post offset to the side
    pts.push(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.0, 0));
    for (let cm = 0; cm <= 100; cm += 10) {
      const y = cm * 0.01;
      const w = cm % 50 === 0 ? 0.035 : 0.016;
      pts.push(new THREE.Vector3(-w, y, 0), new THREE.Vector3(w, y, 0));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.scaleRefGroup.add(new THREE.LineSegments(geo, mat));
  }

  private handleResize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  // ---------------------------------------------------------------------------
  // Upload New Scene Parts
  // ---------------------------------------------------------------------------

  setSceneParts(
    packets: PartPacket[],
    sceneHeight: number,
    macroTarget: [number, number, number, number],
    autoFrame = false,
  ): void {
    this.disposeParts();
    this.sceneHeight = Math.max(0.08, sceneHeight);
    this.macroTarget = macroTarget;

    let maxHorizExtent = 0.25;
    let minY = Infinity;

    for (const pkt of packets) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pkt.position, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(pkt.normal, 3));
      geo.setAttribute('aTangent', new THREE.BufferAttribute(pkt.tangent, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(pkt.uv, 2));
      geo.setAttribute('color', new THREE.BufferAttribute(pkt.color, 3));
      geo.setAttribute('aWind', new THREE.BufferAttribute(pkt.wind, 4));
      geo.setAttribute('aPivot', new THREE.BufferAttribute(pkt.pivot, 3));
      geo.setAttribute('aSurface', new THREE.BufferAttribute(pkt.surface, 4));

      const b = new THREE.Box3(
        new THREE.Vector3(pkt.bounds[0], pkt.bounds[1], pkt.bounds[2]),
        new THREE.Vector3(pkt.bounds[3], pkt.bounds[4], pkt.bounds[5]),
      );
      if (Number.isFinite(pkt.bounds[1])) {
        minY = Math.min(minY, pkt.bounds[1]);
        maxHorizExtent = Math.max(
          maxHorizExtent,
          Math.abs(pkt.bounds[0]),
          Math.abs(pkt.bounds[2]),
          Math.abs(pkt.bounds[3]),
          Math.abs(pkt.bounds[5]),
        );
      }

      let mesh: THREE.Mesh | null = null;
      let mat: THREE.ShaderMaterial | null = null;
      let wire: THREE.LineSegments | null = null;
      const isPureLine = pkt.index.length === 0 && pkt.edgeIndex.length > 0;

      if (pkt.index.length > 0) {
        geo.setIndex(new THREE.BufferAttribute(pkt.index, 1));
        mat = createSpecimenMaterial(PROFILE_INDEX[pkt.shading], this.sharedUniforms);
        mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        mesh.userData.partId = pkt.id;
        this.rootGroup.add(mesh);
      }

      if (pkt.edgeIndex.length > 0) {
        const wGeo = new THREE.BufferGeometry();
        wGeo.setAttribute('position', geo.getAttribute('position'));
        wGeo.setAttribute('normal', geo.getAttribute('normal'));
        wGeo.setAttribute('aTangent', geo.getAttribute('aTangent'));
        wGeo.setAttribute('color', geo.getAttribute('color'));
        wGeo.setAttribute('aWind', geo.getAttribute('aWind'));
        wGeo.setAttribute('aPivot', geo.getAttribute('aPivot'));
        wGeo.setIndex(new THREE.BufferAttribute(pkt.edgeIndex, 1));
        wire = new THREE.LineSegments(wGeo, isPureLine ? this.guideMaterial : this.wireMaterial);
        wire.frustumCulled = false;
        // Guide strands start subtle/hidden in normal Shaded mode unless selected in Outliner or in Wire/Detail mode!
        wire.visible = isPureLine ? false : this.mode === 'wire';
        this.rootGroup.add(wire);
      }

      if (pkt.index.length === 0) {
        geo.dispose();
      }

      this.parts.set(pkt.id, {
        id: pkt.id,
        shading: pkt.shading,
        bounds: b,
        mesh,
        material: mat,
        wire,
        isPureLine,
      });
    }

    const shadowScale = Math.max(0.35, maxHorizExtent * 2.5);
    this.shadowDisc.scale.set(shadowScale, 1, shadowScale);
    this.shadowDisc.position.y = Number.isFinite(minY) ? minY - 0.002 : -0.002;
    this.scaleRefGroup.position.set(maxHorizExtent * 1.18 + 0.06, Math.max(0, Number.isFinite(minY) ? minY : 0), 0);

    this.syncOutlinerState();
    if (autoFrame) this.frameAll(true);
  }

  private disposeParts(): void {
    for (const rp of this.parts.values()) {
      if (rp.mesh) {
        this.rootGroup.remove(rp.mesh);
        rp.mesh.geometry.dispose();
      }
      if (rp.material) rp.material.dispose();
      if (rp.wire) {
        this.rootGroup.remove(rp.wire);
        rp.wire.geometry.dispose();
      }
    }
    this.parts.clear();
  }

  // ---------------------------------------------------------------------------
  // Outliner Visibility, Solo Isolation & Highlight Sync
  // ---------------------------------------------------------------------------

  setOutlinerState(hiddenPartIds: Set<string>, soloPartIds: Set<string> | null, selectedPartIds: Set<string>): void {
    this.hiddenIds = new Set(hiddenPartIds);
    this.soloPartIds = soloPartIds ? new Set(soloPartIds) : null;
    this.selectedPartIds = new Set(selectedPartIds);
    this.syncOutlinerState();
  }

  private syncOutlinerState(): void {
    const hasSpecificSelection =
      this.selectedPartIds.size > 0 && this.selectedPartIds.size < this.parts.size;

    for (const rp of this.parts.values()) {
      const allowedBySolo = this.soloPartIds ? this.soloPartIds.has(rp.id) : true;
      const isHidden = this.hiddenIds.has(rp.id);
      const vis = allowedBySolo && !isHidden;
      const isSel = this.selectedPartIds.has(rp.id);

      if (rp.mesh) {
        rp.mesh.visible = vis;
      }
      if (rp.wire) {
        if (rp.isPureLine) {
          // Hair Guide curves show when explicitly selected, soloed, or in Wire/Anatomy/Detail mode!
          rp.wire.visible = vis && (isSel || this.soloPartIds !== null || this.mode === 'wire' || this.mode === 'anatomy');
        } else {
          rp.wire.visible = vis && this.mode === 'wire';
        }
      }
      if (rp.material) {
        rp.material.uniforms.uDimFactor.value = hasSpecificSelection && !isSel ? 0.58 : 1.0;
        rp.material.uniforms.uSelectPulse.value = hasSpecificSelection && isSel ? 1.0 : 0.0;
      }
    }
  }

  getVisiblePartIds(): string[] {
    const out: string[] = [];
    for (const rp of this.parts.values()) {
      const allowedBySolo = this.soloPartIds ? this.soloPartIds.has(rp.id) : true;
      if (allowedBySolo && !this.hiddenIds.has(rp.id)) out.push(rp.id);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Camera Framing Presets (`Frame`, `Macro`, `Base`, `Focus Selected`)
  // ---------------------------------------------------------------------------

  private computeVisibleBox(filterIds?: Set<string>): THREE.Box3 {
    const box = new THREE.Box3();
    for (const rp of this.parts.values()) {
      if (filterIds && !filterIds.has(rp.id)) continue;
      if (rp.mesh && !rp.mesh.visible) continue;
      if (!rp.bounds.isEmpty()) box.union(rp.bounds);
    }
    if (box.isEmpty()) {
      box.setFromCenterAndSize(new THREE.Vector3(0, 0.25, 0), new THREE.Vector3(0.5, 0.5, 0.5));
    }
    return box;
  }

  frameAll(instant = false): void {
    const box = this.computeVisibleBox();
    this.frameBox(box, 1.38, 0.34, instant);
  }

  frameSelected(): void {
    if (this.selectedPartIds.size === 0) {
      this.frameAll();
      return;
    }
    const box = this.computeVisibleBox(this.selectedPartIds);
    this.frameBox(box, 1.55, 0.32, false);
  }

  /** Zoom right into a single fern pinna's 3D venation, a moss cushion's phyllids/capsules, or clumped hair locks! */
  frameMacro(): void {
    const [tx, ty, tz, rad] = this.macroTarget;
    const tgt = new THREE.Vector3(tx, ty, tz);
    const dist = Math.max(0.06, rad * 2.15);
    const dir = new THREE.Vector3(0.52, 0.52, 0.68).normalize();
    this.tweenCamera(tgt.clone().addScaledVector(dir, dist), tgt);
  }

  /** Inspect crown / rhizome / roots / substrate contact at the base. */
  frameBase(): void {
    const box = this.computeVisibleBox();
    const size = box.getSize(new THREE.Vector3());
    const tgt = new THREE.Vector3(0, box.min.y + Math.min(0.12, size.y * 0.22), 0);
    const dist = Math.max(0.16, Math.max(size.x, size.z) * 0.85);
    const pos = new THREE.Vector3(dist * 0.72, tgt.y + dist * 0.36, dist * 0.72);
    this.tweenCamera(pos, tgt);
  }

  private frameBox(box: THREE.Box3, pad: number, elevBias: number, instant: boolean): void {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(0.08, size.x, size.y, size.z);
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const dist = (maxDim * 0.5) / Math.tan(fovRad * 0.5) * pad;

    const dir = new THREE.Vector3(0.62, elevBias, 0.78).normalize();
    const toPos = center.clone().addScaledVector(dir, dist);
    if (instant) {
      this.camAnim = null;
      this.camera.position.copy(toPos);
      this.controls.target.copy(center);
      this.controls.update();
    } else {
      this.tweenCamera(toPos, center);
    }
  }

  private tweenCamera(toPos: THREE.Vector3, toTgt: THREE.Vector3): void {
    this.camAnim = {
      t0: performance.now(),
      dur: 480,
      fromPos: this.camera.position.clone(),
      toPos,
      fromTgt: this.controls.target.clone(),
      toTgt,
    };
  }

  private handlePick(ev: MouseEvent): void {
    if (!this.onPartPicked) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes: THREE.Object3D[] = [];
    for (const rp of this.parts.values()) {
      if (rp.mesh && rp.mesh.visible) meshes.push(rp.mesh);
    }
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length > 0 && hits[0].object.userData.partId) {
      this.onPartPicked(hits[0].object.userData.partId as string);
    }
  }

  // ---------------------------------------------------------------------------
  // Display Mode, Wind, Lighting & Turntable Controls
  // ---------------------------------------------------------------------------

  setDisplayMode(mode: DisplayMode): void {
    this.mode = mode;
    this.sharedUniforms.uMode.value = DISPLAY_MODE_INDEX[mode];
    this.syncOutlinerState();
  }

  getDisplayMode(): DisplayMode {
    return this.mode;
  }

  setWind(strength: number, angleDeg?: number, gust?: number): void {
    this.sharedUniforms.uWindStrength.value = Math.max(0, strength);
    if (angleDeg !== undefined) {
      const r = (angleDeg * Math.PI) / 180;
      this.sharedUniforms.uWindDir.value.set(Math.cos(r), Math.sin(r));
    }
    if (gust !== undefined) {
      this.sharedUniforms.uWindGust.value = Math.max(0, Math.min(1, gust));
    }
  }

  getWindStrength(): number {
    return this.sharedUniforms.uWindStrength.value;
  }

  getWindGust(): number {
    return this.sharedUniforms.uWindGust.value;
  }

  setLighting(sunAzimuthDeg: number, sunElevationDeg: number, exposure: number): void {
    const az = (sunAzimuthDeg * Math.PI) / 180;
    const el = (sunElevationDeg * Math.PI) / 180;
    const key = new THREE.Vector3(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az),
    ).normalize();
    this.sharedUniforms.uKeyDir.value.copy(key);
    this.sharedUniforms.uFillDir.value.set(-key.x * 0.85, 0.36, -key.z * 0.65).normalize();
    this.sharedUniforms.uExposure.value = exposure;
  }

  setTurntable(on: boolean): void {
    this.turntable = on;
  }

  getTurntable(): boolean {
    return this.turntable;
  }

  setScaleVisible(on: boolean): void {
    this.scaleVisible = on;
    this.scaleRefGroup.visible = on;
  }

  getScaleVisible(): boolean {
    return this.scaleVisible;
  }

  setPaused(p: boolean): void {
    this.paused = p;
  }

  isPaused(): boolean {
    return this.paused;
  }

  captureScreenshotDataUrl(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrameMs) * 0.001);
    this.lastFrameMs = now;

    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.currentFps = Math.round(this.fpsFrames / this.fpsAccum);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    if (!this.paused) {
      this.sharedUniforms.uTime.value += dt;
      if (this.turntable) {
        this.rootGroup.rotation.y += dt * 0.36;
      }
    }

    if (this.camAnim) {
      const u = Math.min(1, (now - this.camAnim.t0) / this.camAnim.dur);
      const ease = 1 - Math.pow(1 - u, 3);
      this.camera.position.lerpVectors(this.camAnim.fromPos, this.camAnim.toPos, ease);
      this.controls.target.lerpVectors(this.camAnim.fromTgt, this.camAnim.toTgt, ease);
      if (u >= 1) this.camAnim = null;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}
