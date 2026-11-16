// Transform gizmo for the Level Designer viewport: world-aligned axis arrows, plane handles and a free (screen) handle
// for moving, and a ground ring for turning about the vertical axis. Drawn over the scene at a constant screen size.
// It listens on the canvas well in the capture phase, so a press on a handle never reaches the camera rig.
import { THREE } from '../Shared/Studio/Render.js';

const AXES = {
  x: { dir: new THREE.Vector3(1, 0, 0), colour: '#ff5a52' },
  y: { dir: new THREE.Vector3(0, 1, 0), colour: '#5fd36a' },
  z: { dir: new THREE.Vector3(0, 0, 1), colour: '#4d8dff' },
};
const PLANES = {
  xz: { normal: new THREE.Vector3(0, 1, 0), colour: '#5fd36a', at: [0.3, 0, 0.3], rot: [-Math.PI / 2, 0, 0] },
  xy: { normal: new THREE.Vector3(0, 0, 1), colour: '#4d8dff', at: [0.3, 0.3, 0], rot: [0, 0, 0] },
  yz: { normal: new THREE.Vector3(1, 0, 0), colour: '#ff5a52', at: [0, 0.3, 0.3], rot: [0, Math.PI / 2, 0] },
};
const HOVER = '#ffd36b';

function overlayMaterial(colour, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color: colour, depthTest: false, depthWrite: false, transparent: true, opacity, toneMapped: false, side: THREE.DoubleSide });
}

export class TransformGizmo {
  constructor(stage, well, { onChange = () => {}, onCommit = () => {} } = {}) {
    this.stage = stage;
    this.well = well;
    this.onChange = onChange;
    this.onCommit = onCommit;
    this.mode = 'move';
    this.snap = false;
    this.target = null;
    this.enabled = true;
    this.root = new THREE.Group();
    this.root.name = 'TransformGizmo';
    this.root.renderOrder = 999;
    this.root.visible = false;
    stage.scene.add(this.root);
    this.handles = [];
    this.build();
    this.raycaster = new THREE.Raycaster();
    this.drag = null;
    this.hover = null;
    stage.frameCallbacks.add(() => this.update());
    well.addEventListener('pointerdown', (e) => this.down(e), true);
    well.addEventListener('pointermove', (e) => this.move(e));
    addEventListener('pointermove', (e) => { if (this.drag) this.dragTo(e); });
    addEventListener('pointerup', (e) => this.up(e));
  }

  handle(object, kind, key, colour) {
    object.traverse((o) => { if (o.isMesh) o.renderOrder = 999; });
    object.userData.gizmo = { kind, key, colour };
    this.handles.push(object);
    return object;
  }

  build() {
    this.moveSet = new THREE.Group();
    this.turnSet = new THREE.Group();
    this.root.add(this.moveSet, this.turnSet);
    for (const [key, a] of Object.entries(AXES)) {
      const g = new THREE.Group();
      const mat = overlayMaterial(a.colour);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.86, 10), mat);
      shaft.position.y = 0.43 + 0.08;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.2, 20), mat);
      tip.position.y = 1.0;
      const pick = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.1, 8), overlayMaterial('#ffffff', 0));
      pick.position.y = 0.6;
      pick.userData.picker = true;
      g.add(shaft, tip, pick);
      if (key === 'x') g.rotation.z = -Math.PI / 2;
      if (key === 'z') g.rotation.x = Math.PI / 2;
      g.userData.materials = [mat];
      this.moveSet.add(this.handle(g, 'axis', key, a.colour));
    }
    for (const [key, p] of Object.entries(PLANES)) {
      const mat = overlayMaterial(p.colour, 0.38);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), mat);
      m.position.set(...p.at);
      m.rotation.set(...p.rot);
      m.userData.materials = [mat];
      this.moveSet.add(this.handle(m, 'plane', key, p.colour));
    }
    const centreMat = overlayMaterial('#f2f2f2', 0.9);
    const centre = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 12), centreMat);
    centre.userData.materials = [centreMat];
    this.moveSet.add(this.handle(centre, 'free', 'view', '#f2f2f2'));

    const ringMat = overlayMaterial('#ffb238');
    const ring = new THREE.Group();
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.014, 8, 128), ringMat);
    const pick = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.08, 6, 64), overlayMaterial('#ffffff', 0));
    pick.userData.picker = true;
    const tick = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), ringMat);
    tick.position.set(0.9, 0, 0);
    band.add(tick);
    ring.add(band, pick);
    ring.rotation.x = -Math.PI / 2;
    ring.userData.materials = [ringMat];
    this.turnSet.add(this.handle(ring, 'turn', 'y', '#ffb238'));
    const axisMat = overlayMaterial('#5fd36a', 0.6);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.5, 6), axisMat);
    post.position.y = 0.25;
    post.renderOrder = 999;
    this.turnSet.add(post);
  }

  setMode(mode) { this.mode = mode; this.refresh(); }
  attach(object) { this.target = object || null; this.refresh(); }
  refresh() {
    const on = !!this.target && this.enabled && (this.mode === 'move' || this.mode === 'rotate');
    this.root.visible = on;
    this.moveSet.visible = this.mode === 'move';
    this.turnSet.visible = this.mode === 'rotate';
  }

  worldPosition(out = new THREE.Vector3()) { return this.target.getWorldPosition(out); }

  update() {
    if (!this.root.visible || !this.target) return;
    const p = this.worldPosition();
    this.root.position.copy(p);
    const cam = this.stage.camera;
    const d = cam.position.distanceTo(p);
    const s = d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * 0.22;
    this.root.scale.setScalar(Math.max(0.02, s));
    // Plane handles flip to the side facing the camera so they never hide behind the arrows.
    const v = cam.position.clone().sub(p);
    for (const h of this.moveSet.children) {
      const g = h.userData.gizmo;
      if (!g || g.kind !== 'plane') continue;
      const at = PLANES[g.key].at;
      h.position.set(at[0] * Math.sign(v.x || 1), at[1] * Math.sign(v.y || 1), at[2] * Math.sign(v.z || 1));
    }
  }

  ray(e) {
    const rect = this.stage.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.stage.camera);
    return this.raycaster.ray;
  }

  hit(e) {
    if (!this.root.visible) return null;
    this.ray(e);
    this.root.updateMatrixWorld(true);
    const set = this.mode === 'move' ? this.moveSet : this.turnSet;
    const hits = this.raycaster.intersectObjects(set.children.filter((c) => c.userData.gizmo), true);
    if (!hits.length) return null;
    // Prefer the free handle and the plane handles when they are under the cursor (they are small).
    const rank = { free: 0, plane: 1, axis: 2, turn: 3 };
    let best = null;
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.gizmo) o = o.parent;
      if (!o) continue;
      if (!best || rank[o.userData.gizmo.kind] < rank[best.userData.gizmo.kind]) best = o;
    }
    return best;
  }

  highlight(handle) {
    if (this.hover === handle) return;
    if (this.hover) for (const m of this.hover.userData.materials || []) m.color.set(this.hover.userData.gizmo.colour);
    this.hover = handle;
    if (handle) for (const m of handle.userData.materials || []) m.color.set(HOVER);
    this.well.style.cursor = handle ? 'grab' : '';
  }

  plane(kind, key, origin) {
    const cam = this.stage.camera;
    const view = cam.position.clone().sub(origin).normalize();
    let normal;
    if (kind === 'axis') {
      const a = AXES[key].dir;
      normal = view.clone().sub(a.clone().multiplyScalar(view.dot(a)));
      if (normal.lengthSq() < 1e-6) normal = new THREE.Vector3(0, 1, 0);
      normal.normalize();
    } else if (kind === 'plane') normal = PLANES[key].normal.clone();
    else if (kind === 'turn') normal = new THREE.Vector3(0, 1, 0);
    else normal = view;
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
  }

  down(e) {
    if (e.button !== 0 || !this.enabled) return;
    const h = this.hit(e);
    if (!h) return;
    e.stopPropagation();
    e.preventDefault();
    const { kind, key } = h.userData.gizmo;
    const origin = this.worldPosition();
    const plane = this.plane(kind, key, origin);
    const start = new THREE.Vector3();
    if (!this.ray(e).intersectPlane(plane, start)) return;
    this.drag = { kind, key, plane, start, origin: origin.clone(), rotation: this.target.rotation.y, moved: false };
    this.highlight(h);
    this.well.style.cursor = 'grabbing';
  }

  dragTo(e) {
    const d = this.drag;
    const p = new THREE.Vector3();
    if (!this.ray(e).intersectPlane(d.plane, p)) return;
    const step = e.ctrlKey || this.snap ? 0.25 : 0;
    if (d.kind === 'turn') {
      const a0 = Math.atan2(d.start.z - d.origin.z, d.start.x - d.origin.x);
      const a1 = Math.atan2(p.z - d.origin.z, p.x - d.origin.x);
      let r = d.rotation - (a1 - a0);
      if (step) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
      this.target.rotation.y = r;
    } else {
      const delta = p.clone().sub(d.start);
      if (d.kind === 'axis') { const a = AXES[d.key].dir; delta.copy(a).multiplyScalar(delta.dot(a)); }
      const world = d.origin.clone().add(delta);
      if (step) {
        const keys = d.kind === 'axis' ? [d.key] : d.kind === 'plane' ? d.key.split('') : ['x', 'y', 'z'];
        for (const k of keys) world[k] = Math.round(world[k] / step) * step;
      }
      if (this.target.parent) this.target.parent.worldToLocal(world);
      this.target.position.copy(world);
    }
    d.moved = true;
    this.onChange(this.target);
  }

  move(e) {
    if (this.drag || e.buttons) return;
    this.highlight(this.hit(e));
  }

  up() {
    if (!this.drag) return;
    const moved = this.drag.moved;
    this.drag = null;
    this.well.style.cursor = this.hover ? 'grab' : '';
    if (moved) this.onCommit(this.target);
  }

  get busy() { return !!this.drag; }
}
