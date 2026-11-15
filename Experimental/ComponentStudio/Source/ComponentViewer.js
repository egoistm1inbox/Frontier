// Component Viewer — formerly Vehicle Lab, rebuilt as a Blueprint-class style editor.
// A class (BP_ControlVehicle) is a tree of scene components (Static Mesh, Wheel, Camera, Light, Sensor, Ballast, Aero
// Surface) plus class components (Vehicle Movement). Static Mesh components reference compiled meshes from the
// Content drawer — the output of Geometry Compile — so their baked UVs, cluster LOD levels, SDF and icon are all live here.
import { Viewport, LineBuilder } from './Renderer.js';
import { compose, multiply, identity, transformPoint, invert, boundsOf } from './MathUtils.js';
import { meshPayload, formatCount, ms } from './Compile.js';
import { linearToHex, hexToLinear } from './MeshData.js';
import { ControlVehicleSockets, VehicleGeometry, EngineSheet, TurbochargerSheet, TransmissionSheet, ChassisSheet, PacejkaParameters } from '../Vehicle/VehicleSpecification.js';
import { $, h, heading, panel, cardHead, note, slider, segmented, tile, vecRow, rows, prop, toast, hydrate, labelled, bindDrawers, setFill } from './Kit.js';

const STORE_KEY = 'frontier.componentStudio.class.v1';
const GROUND = VehicleGeometry.TyreRadius - ControlVehicleSockets.AxleMount[0][2]; // model origin above the ground
const G = 9.81;

export const TYPES = {
  root: { label: 'Scene Root', cls: 'SceneComponent', icon: 'root', accent: 'grey', note: 'Class origin' },
  mesh: { label: 'Static Mesh', cls: 'StaticMeshComponent', icon: 'mesh', accent: 'blue', note: 'Compiled mesh' },
  wheel: { label: 'Wheel', cls: 'WheelComponent', icon: 'wheel', accent: 'amber', note: 'Axle + suspension' },
  camera: { label: 'Camera', cls: 'CameraComponent', icon: 'camera', accent: 'teal', note: 'View point' },
  light: { label: 'Light', cls: 'PointLightComponent', icon: 'light', accent: 'amber', note: 'Lamp' },
  sensor: { label: 'Sensor', cls: 'SensorComponent', icon: 'sensor', accent: 'green', note: 'Range cone' },
  ballast: { label: 'Ballast', cls: 'BallastComponent', icon: 'ballast', accent: 'orange', note: 'Added mass' },
  aero: { label: 'Aero Surface', cls: 'AeroSurfaceComponent', icon: 'aero', accent: 'violet', note: 'Wing / splitter' },
  movement: { label: 'Vehicle Movement', cls: 'VehicleMovementComponent', icon: 'movement', accent: 'green', note: 'Class component' },
};
const ADDABLE = ['mesh', 'wheel', 'camera', 'light', 'sensor', 'ballast', 'aero'];
const DEFAULT_PROPS = {
  mesh: () => ({ meshId: null, tint: [1, 1, 1] }),
  wheel: () => ({ radius: VehicleGeometry.TyreRadius, width: VehicleGeometry.TyreWidth, maxSteer: 30, travel: 0.12, steer: false, drive: true, brake: true }),
  camera: () => ({ fov: 70, active: true }),
  light: () => ({ intensity: 1200, color: [1, 0.92, 0.78], radius: 6 }),
  sensor: () => ({ range: 18, cone: 30 }),
  ballast: () => ({ mass: 25, size: 0.3 }),
  aero: () => ({ area: 0.9, angle: 6, span: 1.8 }),
};

const CHANNELS = [
  { id: 'none', label: 'None', icon: 'eyeOff', accent: 'grey' },
  { id: 'load', label: 'Wheel load vectors', icon: 'load', accent: 'green', legend: ['WHEEL LOAD', 'LIGHT', 'HEAVY'], ramp: 'linear-gradient(90deg,#3d7a52,#7fe09a,#f2d36b,#ef7d57)' },
  { id: 'com', label: 'Centre of mass', icon: 'com', accent: 'amber', legend: ['CENTRE OF MASS', 'FRONT', 'REAR'], ramp: 'linear-gradient(90deg,#ffb238,#ffe2a8)' },
  { id: 'suspension', label: 'Suspension travel', icon: 'spring', accent: 'violet', legend: ['SUSPENSION', 'EXTENDED', 'COMPRESSED'], ramp: 'linear-gradient(90deg,#7a5cff,#d1b8ff)' },
  { id: 'patch', label: 'Contact patches', icon: 'patch', accent: 'orange', legend: ['CONTACT PATCH', 'SMALL', 'LARGE'], ramp: 'linear-gradient(90deg,#9b4b2a,#ff8a4c,#ffd1a8)' },
  { id: 'slip', label: 'Slip vectors', icon: 'slip', accent: 'blue', legend: ['SLIP', 'GRIP', 'SLIDE'], ramp: 'linear-gradient(90deg,#4d9bff,#38d1c4,#ff6b5e)' },
  { id: 'bounds', label: 'Component bounds', icon: 'bounds', accent: 'teal', legend: ['BOUNDS', 'MESH', 'CLASS'], ramp: 'linear-gradient(90deg,#38d1c4,#ffffff)' },
  { id: 'sdf', label: 'Distance-field collision', icon: 'sdf', accent: 'teal', legend: ['SDF COLLISION', 'BAKED', 'MISSING'], ramp: 'linear-gradient(90deg,#38d1c4,#ff6b5e)' },
];

const MOVEMENT_SPECS = [
  { title: 'CHASSIS & MASS', tag: 'CONTROL VEHICLE', rows: [
    { key: 'mass', label: 'Vehicle mass', min: 900, max: 1800, step: 10, unit: 'kg', digits: 0 },
    { key: 'com', label: 'Centre of mass height', min: 0.3, max: 0.8, step: 0.005, unit: 'm', digits: 3 },
    { key: 'frontWeight', label: 'Front weight distribution', min: 35, max: 65, step: 0.1, unit: '%', digits: 1 }] },
  { title: 'AERODYNAMICS', tag: 'GT PACKAGE', rows: [
    { key: 'dragArea', label: 'Drag area · CdA', min: 0.3, max: 1.2, step: 0.01, unit: 'm²', digits: 2 },
    { key: 'liftArea', label: 'Downforce area · ClA', min: 0, max: 2, step: 0.01, unit: 'm²', digits: 2 }] },
  { title: 'SUSPENSION', tag: '4 CORNERS', rows: [
    { key: 'springHz', label: 'Natural frequency', min: 1, max: 4, step: 0.05, unit: 'Hz', digits: 2 },
    { key: 'dampingRatio', label: 'Damping ratio · ζ', min: 0.15, max: 1.1, step: 0.01, unit: 'ζ', digits: 2 },
    { key: 'steeringLock', label: 'Maximum steering lock', min: 0.35, max: 0.8, step: 0.01, unit: 'rad', digits: 2 }] },
  { title: 'POWERTRAIN', tag: 'VR38 · 6-SPEED', rows: [
    { key: 'engineIdle', label: 'Idle speed', min: 500, max: 1200, step: 10, unit: 'rpm', digits: 0 },
    { key: 'engineRedline', label: 'Redline', min: 5000, max: 9000, step: 50, unit: 'rpm', digits: 0 },
    { key: 'finalDrive', label: 'Final drive ratio', min: 2.5, max: 5, step: 0.01, unit: ':1', digits: 2 },
    { key: 'boostLimit', label: 'Wastegate boost limit', min: 0, max: 1.35, step: 0.01, unit: 'bar', digits: 2 },
    { key: 'spoolTime', label: 'Turbo spool time', min: 0.1, max: 1.5, step: 0.01, unit: 's', digits: 2 }] },
  { title: 'TYRES · MF6.1', tag: 'PACEJKA', rows: [
    { key: 'pacejkaLat', label: 'Lateral peak · D', min: 1, max: 2.5, step: 0.01, unit: 'μ', digits: 2 },
    { key: 'pacejkaB', label: 'Stiffness factor · B', min: 6, max: 24, step: 0.1, unit: 'B', digits: 1 },
    { key: 'coldPressure', label: 'Cold pressure', min: 160, max: 320, step: 1, unit: 'kPa', digits: 0 }] },
];
const MOVEMENT_DEFAULTS = {
  mass: VehicleGeometry.Mass, com: VehicleGeometry.CoMHeight, frontWeight: VehicleGeometry.FrontWeightFraction * 100,
  dragArea: ChassisSheet.DragArea, liftArea: ChassisSheet.LiftArea, springHz: 2, dampingRatio: 0.6, steeringLock: ChassisSheet.MaxSteerAngleRad,
  engineIdle: EngineSheet.IdleRPM, engineRedline: EngineSheet.RedlineRPM, finalDrive: TransmissionSheet.FinalDriveRatio,
  boostLimit: TurbochargerSheet.WastegateMaxBoost, spoolTime: TurbochargerSheet.SpoolTimeConstant,
  pacejkaLat: PacejkaParameters.pDy1, pacejkaB: PacejkaParameters.pBy1, coldPressure: 240,
};

// ---------------------------------------------------------------------------------------------------- default class
function vehicleClass() {
  const c = [];
  const add = (id, name, type, parent, location = [0, 0, 0], rotation = [0, 0, 0], props = {}) => c.push({ id, name, type, parent, location, rotation, scale: [1, 1, 1], visible: true, props: { ...(DEFAULT_PROPS[type]?.() || {}), ...props } });
  add('root', 'DefaultSceneRoot', 'root', null);
  add('body', 'Body', 'mesh', 'root', [0, GROUND, 0], [0, 0, 0], { meshId: 'builtin-body' });
  const names = ['FL', 'FR', 'RL', 'RR'];
  ControlVehicleSockets.AxleMount.forEach((s, i) => {
    const right = s[1] < 0, id = `wheel${names[i]}`;
    add(id, `Wheel_${names[i]}`, 'wheel', 'root', [s[0], s[2] + GROUND, -s[1]], [0, right ? 180 : 0, 0], { steer: i < 2, drive: true, brake: true });
    add(`tyre${names[i]}`, `Tyre_${names[i]}`, 'mesh', id, [0, 0, 0], [0, 0, 0], { meshId: 'builtin-tyre' });
    add(`rim${names[i]}`, `Rim_${names[i]}`, 'mesh', id, [0, 0, 0], [0, 0, 0], { meshId: 'builtin-rim' });
  });
  const wing = ControlVehicleSockets.RearWingPort;
  add('wing', 'RearWing', 'aero', 'body', [wing[0] + 0.15, wing[2] + 0.12, 0], [0, 0, 0], { area: 0.9, angle: 6, span: 1.9 });
  add('headlights', 'Headlights', 'light', 'body', [2.95, 0.42, 0], [0, 0, 0], { intensity: 1800, color: [1, 0.96, 0.88], radius: 9 });
  add('radar', 'FrontRadar', 'sensor', 'body', [3.05, 0.05, 0], [0, 0, 0], { range: 22, cone: 26 });
  add('chase', 'ChaseCamera', 'camera', 'root', [-7.2, 2.3, 0], [0, 0, -11], { fov: 68 });
  c.push({ id: 'movement', name: 'VehicleMovement', type: 'movement', parent: null, actor: true, props: { values: { ...MOVEMENT_DEFAULTS }, curves: defaultCurves(), interpolation: { Torque: 'smooth', Boost: 'linear' } } });
  return { name: 'BP_ControlVehicle', components: c };
}
function defaultCurves() { return { Torque: EngineSheet.TorqueCurve.map((p) => [...p]), Boost: TurbochargerSheet.TorqueMultiplierCurve.map((p) => [...p]) }; }

// ====================================================================================================================
export function createComponentViewer({ library, openCompile, openImportMenu }) {
  let cls = load() || vehicleClass();
  const state = { selected: 'body', collapsed: new Set(), channel: 'none', mode: 'lit', wire: false, grid: true, lodMode: 'auto', camPreset: 'persp', search: '', drawnLods: {} };
  const sim = { running: false, speed: 0, rpm: 0, gear: 1, spin: 0, steer: 0, offset: 0, boost: 0, torque: 0, accel: 0, throttle: 0.6, brake: 0 };
  const gpuCache = new Map();
  let viewport, drawers, saveTimer = 0, lastFrame = performance.now(), frameMs = 16, linesDirty = true;

  // -------------------------------------------------------------------------------------------- model helpers
  const byId = (id) => cls.components.find((c) => c.id === id);
  const children = (id) => cls.components.filter((c) => c.parent === id && !c.actor);
  const movement = () => cls.components.find((c) => c.type === 'movement');
  const values = () => movement().props.values;
  const sceneComponents = () => cls.components.filter((c) => !c.actor);
  function ancestorsVisible(c) { for (let p = c; p; p = byId(p.parent)) if (p.visible === false) return false; return true; }
  function isDescendant(c, ancestorId) { for (let p = c; p; p = byId(p.parent)) if (p.id === ancestorId) return true; return false; }

  function persist() {
    $('SaveState').textContent = 'SAVING';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(cls)); $('SaveState').textContent = 'SAVED'; } catch { $('SaveState').textContent = 'NOT SAVED'; } }, 300);
  }
  function load() { try { const v = JSON.parse(localStorage.getItem(STORE_KEY)); return v && v.components ? v : null; } catch { return null; } }

  // -------------------------------------------------------------------------------------------- matrices
  function localMatrix(c) {
    let m = compose(c.location, c.rotation, c.scale);
    if (c.type === 'wheel') {
      const side = Math.cos((c.rotation[1] * Math.PI) / 180) >= 0 ? 1 : -1;
      const steer = c.props.steer ? sim.steer * c.props.maxSteer : 0;
      m = multiply(m, compose([0, 0, 0], [0, steer, 0]));
      m = multiply(m, compose([0, 0, 0], [0, 0, (-sim.spin * 180) / Math.PI * side]));
    }
    return m;
  }
  function worldMatrices() {
    const out = new Map();
    const visit = (c, parentM) => { const m = multiply(parentM, localMatrix(c)); out.set(c.id, m); children(c.id).forEach((k) => visit(k, m)); };
    sceneComponents().filter((c) => !c.parent).forEach((r) => visit(r, identity()));
    return out;
  }

  // -------------------------------------------------------------------------------------------- GPU meshes
  function gpuMesh(record, level) {
    const key = `${record.id}|${level}`;
    const hit = gpuCache.get(key);
    if (hit && hit.version === record.compiledAt) return hit.handle;
    if (hit) viewport.deleteMesh(hit.handle);
    const handle = viewport.createMesh(meshPayload(record, level));
    gpuCache.set(key, { handle, version: record.compiledAt });
    return handle;
  }
  function purgeGpu(id) {
    for (const [k, v] of gpuCache) if (!id || k.startsWith(id + '|')) { viewport.deleteMesh(v.handle); gpuCache.delete(k); }
  }

  function chooseLevel(record, worldM) {
    if (state.mode === 'checker' || !record.lod) return -1;
    const top = record.lod.levels.length - 1;
    if (state.lodMode === 'max') return top;
    if (state.lodMode !== 'auto') return Math.min(+state.lodMode, top);
    // Screen-space heuristic: keep roughly one triangle per 6 px² of the mesh's projected bounding disc.
    const centre = transformPoint(worldM, record.bounds.centre), eye = viewport.eye();
    const d = Math.max(0.01, Math.hypot(centre[0] - eye[0], centre[1] - eye[1], centre[2] - eye[2]));
    const px = (record.bounds.radius / d) * (viewport.canvas.clientHeight / (2 * Math.tan((viewport.camera.fov * Math.PI) / 360)));
    const budget = Math.max(64, (Math.PI * px * px) / 6);
    for (let L = 0; L <= top; L++) if (record.lod.levels[L].triangles <= budget) return L;
    return top;
  }

  function sync() {
    if (!viewport) return;
    const W = worldMatrices(), objects = [];
    let drawn = 0, source = 0;
    state.drawnLods = {};
    for (const c of sceneComponents()) {
      if (c.type !== 'mesh' || !ancestorsVisible(c)) continue;
      const record = library.get(c.props.meshId);
      if (!record) continue;
      const m = W.get(c.id);
      const level = chooseLevel(record, m);
      const handle = gpuMesh(record, level);
      drawn += handle.triangles; source += record.triangles;
      state.drawnLods[record.name] = level < 0 ? 'src' : `L${level}`;
      const mode = state.mode === 'clusters' ? 'debug' : state.mode;
      objects.push({ mesh: handle, matrix: m, tint: c.props.tint, pickId: c.id, selected: isDescendant(c, state.selected) && state.selected !== 'root', mode });
    }
    viewport.settings.wire = state.wire; viewport.settings.grid = state.grid;
    viewport.settings.groundOffset = [sim.offset, 0];
    viewport.setObjects(objects);
    state.drawn = drawn; state.source = source;
    if (linesDirty || sim.running) { drawLines(W); linesDirty = false; }
    readout();
  }

  // -------------------------------------------------------------------------------------------- overlays
  function wheelStations(W) {
    return sceneComponents().filter((c) => c.type === 'wheel' && ancestorsVisible(c)).map((c) => {
      const p = transformPoint(W.get(c.id), [0, 0, 0]);
      return { c, centre: p, contact: [p[0], 0.002, p[2]], radius: c.props.radius, front: p[0] > 0 };
    });
  }
  function totalMass() {
    return values().mass + sceneComponents().filter((c) => c.type === 'ballast').reduce((a, c) => a + c.props.mass, 0);
  }
  function wheelLoads(stations) {
    const v = values(), m = totalMass();
    const front = stations.filter((s) => s.front), rear = stations.filter((s) => !s.front);
    const wb = front.length && rear.length ? front[0].centre[0] - rear[0].centre[0] : 3.4;
    const transfer = (m * sim.accel * v.com) / Math.max(1, wb);
    const fz = (s) => (s.front ? (m * G * v.frontWeight / 100 - transfer) / Math.max(1, front.length) : (m * G * (1 - v.frontWeight / 100) + transfer) / Math.max(1, rear.length));
    return stations.map((s) => ({ ...s, load: fz(s) }));
  }
  function comPoint(stations) {
    const v = values();
    const front = stations.filter((s) => s.front), rear = stations.filter((s) => !s.front);
    const xf = front.length ? front[0].centre[0] : 1.7, xr = rear.length ? rear[0].centre[0] : -1.7;
    let x = xr + (xf - xr) * (v.frontWeight / 100), y = v.com, z = 0, m = v.mass;
    const W = worldMatrices();
    for (const c of sceneComponents().filter((k) => k.type === 'ballast')) {
      const p = transformPoint(W.get(c.id), [0, 0, 0]);
      x = (x * m + p[0] * c.props.mass) / (m + c.props.mass); y = (y * m + p[1] * c.props.mass) / (m + c.props.mass); z = (z * m + p[2] * c.props.mass) / (m + c.props.mass); m += c.props.mass;
    }
    return [x, y, z];
  }

  function drawLines(W) {
    const L = new LineBuilder(), sel = state.selected;
    const tp = transformPoint;
    // Component gizmos (non-mesh scene components), brighter when selected.
    for (const c of sceneComponents()) {
      if (!ancestorsVisible(c) || c.type === 'mesh' || c.type === 'root') continue;
      const m = W.get(c.id), on = isDescendant(c, sel) && sel !== 'root', a = on ? 1 : 0.35;
      const P = (x, y, z) => tp(m, [x, y, z]);
      if (c.type === 'camera') {
        const t = Math.tan((c.props.fov * Math.PI) / 360) * 0.9, d = 0.9, col = [0.22, 0.82, 0.77, a];
        const o = P(0, 0, 0), cs = [P(d, t * 0.6, t), P(d, t * 0.6, -t), P(d, -t * 0.6, -t), P(d, -t * 0.6, t)];
        cs.forEach((q, i) => { L.line(o, q, col); L.line(q, cs[(i + 1) % 4], col); });
        L.line(P(d, t * 0.6 + 0.12, 0), P(d, t * 0.6, t * 0.3), col).line(P(d, t * 0.6 + 0.12, 0), P(d, t * 0.6, -t * 0.3), col);
      } else if (c.type === 'light') {
        const col = [...c.props.color, a]; const o = P(0, 0, 0);
        for (let i = 0; i < 12; i++) { const ang = (i / 12) * Math.PI * 2; L.line(o, P(0.6, Math.cos(ang) * 0.18, Math.sin(ang) * 0.18), col); }
        L.circle(o, 0.12, 'x', col, 18);
      } else if (c.type === 'sensor') {
        const col = [0.27, 0.82, 0.4, a * 0.9], r = Math.tan((c.props.cone * Math.PI) / 360) * c.props.range, o = P(0, 0, 0);
        for (let i = 0; i < 16; i++) { const ang = (i / 16) * Math.PI * 2, ang2 = ((i + 1) / 16) * Math.PI * 2; const q = P(c.props.range, Math.cos(ang) * r * 0.35, Math.sin(ang) * r); L.line(q, P(c.props.range, Math.cos(ang2) * r * 0.35, Math.sin(ang2) * r), col); if (i % 4 === 0) L.line(o, q, col); }
      } else if (c.type === 'ballast') {
        const s = c.props.size / 2; L.box([-s, -s, -s], [s, s, s], [1, 0.54, 0.3, a], m, tp);
      } else if (c.type === 'aero') {
        const s = c.props.span / 2, ch = 0.32, ang = (c.props.angle * Math.PI) / 180, col = [0.71, 0.55, 1, a];
        const lead = [ch / 2 * Math.cos(ang), ch / 2 * Math.sin(ang)], trail = [-lead[0], -lead[1]];
        const pts = [P(lead[0], lead[1], -s), P(lead[0], lead[1], s), P(trail[0], trail[1], s), P(trail[0], trail[1], -s)];
        pts.forEach((q, i) => L.line(q, pts[(i + 1) % 4], col));
        for (const z of [-s * 0.7, s * 0.7]) L.line(P(0, 0, z), P(0, -0.32, z), col);
        if (on) { const df = 0.5 * 1.225 * 30 * 30 * c.props.area * (0.08 * c.props.angle) / 1000; L.arrow(P(0, 0, 0), P(0, -Math.min(1.2, df * 0.4), 0), [0.71, 0.55, 1, 1]); }
      } else if (c.type === 'wheel' && on) {
        const col = [1, 0.7, 0.22, 1], o = P(0, 0, 0);
        const ring = []; for (let i = 0; i <= 36; i++) { const ang = (i / 36) * Math.PI * 2; ring.push(P(Math.cos(ang) * c.props.radius * 1.04, Math.sin(ang) * c.props.radius * 1.04, 0)); }
        ring.forEach((q, i) => i && L.line(ring[i - 1], q, col));
        L.line(P(0, 0, -c.props.width * 0.7), P(0, 0, c.props.width * 0.7), col);
        void o;
      }
    }
    // Selection pivot axes.
    const sc = byId(sel);
    if (sc && !sc.actor && W.get(sel)) {
      const m = W.get(sel), o = tp(m, [0, 0, 0]), s = 0.45;
      const axis = (d) => { const q = tp(m, d); const l = Math.hypot(q[0] - o[0], q[1] - o[1], q[2] - o[2]) || 1; return o.map((x, k) => x + ((q[k] - x) / l) * s); };
      L.line(o, axis([1, 0, 0]), [0.9, 0.3, 0.28, 1]).line(o, axis([0, 1, 0]), [0.4, 0.8, 0.35, 1]).line(o, axis([0, 0, 1]), [0.3, 0.55, 1, 1]);
    }
    channelLines(L, W);
    viewport.setLines('gizmos', L.build(), { depth: false });
  }

  function channelLines(L, W) {
    const ch = state.channel;
    const legend = $('ViewerLegend');
    const spec = CHANNELS.find((c) => c.id === ch);
    legend.hidden = ch === 'none';
    if (ch !== 'none') legend.innerHTML = `<b>${spec.legend[0]}</b><div class="ramp" style="background:${spec.ramp}"></div><div class="ends"><span>${spec.legend[1]}</span><span>${spec.legend[2]}</span></div>`;
    if (ch === 'none') return;
    const stations = wheelLoads(wheelStations(W));
    const maxLoad = Math.max(1, ...stations.map((s) => s.load));
    const heat = (t) => { const c = [[0.24, 0.48, 0.32], [0.5, 0.88, 0.6], [0.95, 0.83, 0.42], [0.94, 0.49, 0.34]]; const x = Math.max(0, Math.min(0.999, t)) * 3, i = Math.floor(x), f = x - i; return c[i].map((v, k) => v + (c[i + 1][k] - v) * f).concat(1); };
    if (ch === 'load') {
      for (const s of stations) { const t = s.load / (maxLoad * 1.1); L.arrow(s.contact, [s.contact[0], s.contact[1] + s.load / 2800, s.contact[2]], heat(t)); L.circle(s.contact, 0.12, 'y', heat(t), 20); }
      legend.innerHTML += `<div style="margin-top:6px;font:400 9px ui-monospace,monospace;color:#9a9a9a">${stations.map((s) => `${s.c.name.replace('Wheel_', '')} ${(s.load / 1000).toFixed(2)} kN`).join('<br>')}</div>`;
    } else if (ch === 'com') {
      const p = comPoint(stations), col = [1, 0.7, 0.22, 1];
      L.line([p[0] - 0.3, p[1], p[2]], [p[0] + 0.3, p[1], p[2]], col).line([p[0], p[1] - 0.3, p[2]], [p[0], p[1] + 0.3, p[2]], col).line([p[0], p[1], p[2] - 0.3], [p[0], p[1], p[2] + 0.3], col);
      L.circle(p, 0.22, 'z', col, 32).circle(p, 0.22, 'y', col, 32).circle(p, 0.22, 'x', col, 32);
      L.line(p, [p[0], 0.002, p[2]], [1, 0.7, 0.22, 0.5]);
      L.arrow([p[0], p[1], p[2]], [p[0], p[1] - 0.8, p[2]], [1, 0.85, 0.5, 0.8]);
      legend.innerHTML += `<div style="margin-top:6px;font:400 9px ui-monospace,monospace;color:#9a9a9a">x ${p[0].toFixed(3)} m · h ${p[1].toFixed(3)} m<br>mass ${totalMass().toFixed(0)} kg</div>`;
    } else if (ch === 'suspension') {
      const v = values();
      for (const s of stations) {
        const top = [s.centre[0], s.centre[1] + 0.55, s.centre[2] * 0.82], bottom = s.centre;
        const compress = Math.max(-1, Math.min(1, (s.load - (totalMass() * G) / 4) / ((totalMass() * G) / 4) + 0.2));
        const col = [0.48 + 0.3 * compress, 0.36, 1, 1];
        L.line(top, [top[0], top[1] - 0.08, top[2]], col);
        const coils = Math.round(4 + v.springHz * 2);
        let prev = [top[0], top[1] - 0.08, top[2]];
        for (let i = 1; i <= coils * 2; i++) { const t = i / (coils * 2), y = top[1] - 0.08 - t * (top[1] - bottom[1] - 0.16), q = [top[0] + (i % 2 ? 0.07 : -0.07), y, top[2]]; L.line(prev, q, col); prev = q; }
        L.line(prev, bottom, col);
        L.line([s.centre[0] - 0.18, s.centre[1] + s.c.props.travel, s.centre[2]], [s.centre[0] + 0.18, s.centre[1] + s.c.props.travel, s.centre[2]], [0.82, 0.72, 1, 0.6]);
        L.line([s.centre[0] - 0.18, s.centre[1] - s.c.props.travel, s.centre[2]], [s.centre[0] + 0.18, s.centre[1] - s.c.props.travel, s.centre[2]], [0.82, 0.72, 1, 0.6]);
      }
    } else if (ch === 'patch') {
      const v = values();
      for (const s of stations) {
        const area = s.load / (v.coldPressure * 1000), w = s.c.props.width * 0.9, len = area / w, col = heat(s.load / (maxLoad * 1.1));
        const x0 = s.contact[0] - len / 2, x1 = s.contact[0] + len / 2, z0 = s.contact[2] - w / 2, z1 = s.contact[2] + w / 2, y = 0.004;
        L.line([x0, y, z0], [x1, y, z0], col).line([x1, y, z0], [x1, y, z1], col).line([x1, y, z1], [x0, y, z1], col).line([x0, y, z1], [x0, y, z0], col);
        for (let i = 1; i < 4; i++) { const x = x0 + ((x1 - x0) * i) / 4; L.line([x, y, z0], [x, y, z1], [col[0], col[1], col[2], 0.5]); }
      }
    } else if (ch === 'slip') {
      for (const s of stations) {
        const driven = s.c.props.drive, ratio = driven ? Math.min(0.3, Math.abs(sim.accel) / 40 + sim.throttle * 0.05 * (sim.running ? 1 : 0)) : 0.01;
        const len = 0.3 + sim.speed * 0.03, col = ratio > 0.15 ? [1, 0.42, 0.37, 1] : ratio > 0.06 ? [0.22, 0.82, 0.77, 1] : [0.3, 0.6, 1, 1];
        const steer = s.c.props.steer ? sim.steer * (s.c.props.maxSteer * Math.PI) / 180 : 0;
        L.arrow([s.contact[0], 0.03, s.contact[2]], [s.contact[0] + Math.cos(steer) * len, 0.03, s.contact[2] - Math.sin(steer) * len], col);
        L.line([s.contact[0], 0.03, s.contact[2]], [s.contact[0] + len * (1 + ratio * 3), 0.03, s.contact[2]], [col[0], col[1], col[2], 0.35]);
      }
    } else if (ch === 'bounds' || ch === 'sdf') {
      let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const c of sceneComponents()) {
        if (c.type !== 'mesh' || !ancestorsVisible(c)) continue;
        const r = library.get(c.props.meshId); if (!r) continue;
        const m = W.get(c.id);
        if (ch === 'sdf') {
          const baked = !!r.sdf;
          const blo = baked ? r.sdf.origin : r.bounds.lo, bhi = baked ? r.sdf.origin.map((o) => o + (r.sdf.dims - 1) * r.sdf.voxel) : r.bounds.hi;
          L.box(blo, bhi, baked ? [0.22, 0.82, 0.77, 0.9] : [1, 0.42, 0.37, 0.7], m, transformPoint);
          continue;
        }
        L.box(r.bounds.lo, r.bounds.hi, [0.22, 0.82, 0.77, 0.75], m, transformPoint);
        const wb = boundsOf(new Float32Array([...r.bounds.lo, ...r.bounds.hi, r.bounds.lo[0], r.bounds.hi[1], r.bounds.lo[2], r.bounds.hi[0], r.bounds.lo[1], r.bounds.hi[2], r.bounds.lo[0], r.bounds.lo[1], r.bounds.hi[2], r.bounds.hi[0], r.bounds.hi[1], r.bounds.lo[2]]), m);
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], wb.lo[k]); hi[k] = Math.max(hi[k], wb.hi[k]); }
      }
      if (ch === 'bounds' && Number.isFinite(lo[0])) {
        L.box(lo, hi, [1, 1, 1, 0.9]);
        legend.innerHTML += `<div style="margin-top:6px;font:400 9px ui-monospace,monospace;color:#9a9a9a">class ${hi.map((v, k) => (v - lo[k]).toFixed(2)).join(' × ')} m</div>`;
      }
      if (ch === 'sdf') {
        const missing = sceneComponents().filter((c) => c.type === 'mesh' && library.get(c.props.meshId) && !library.get(c.props.meshId).sdf).length;
        legend.innerHTML += `<div style="margin-top:6px;font:400 9px ui-monospace,monospace;color:#9a9a9a">${missing ? `${missing} component(s) without an SDF —<br>bake it in Geometry Compile` : 'every mesh has a baked SDF'}</div>`;
      }
    }
  }

  function readout() {
    const c = byId(state.selected);
    const lods = Object.entries(state.drawnLods).map(([k, v]) => `${k.replace('SM_', '')} ${v}`).join(' · ');
    $('ViewerReadout').textContent = [
      `class     ${cls.name}`, `selected  ${c ? `${c.name} · ${TYPES[c.type].cls}` : '—'}`,
      `tris      ${formatCount(state.drawn || 0)} drawn / ${formatCount(state.source || 0)} source`,
      `lod       ${state.lodMode}${lods ? ' · ' + lods : ''}`, `frame     ${frameMs.toFixed(1)} ms`,
    ].join('\n');
  }

  // -------------------------------------------------------------------------------------------- outliner
  function renderTree() {
    const host = $('ComponentTree'); host.textContent = '';
    const q = state.search.trim().toLowerCase();
    const matches = (c) => !q || c.name.toLowerCase().includes(q) || TYPES[c.type].label.toLowerCase().includes(q) || children(c.id).some(matches);
    const visit = (c, depth) => {
      if (!matches(c)) return;
      const kids = children(c.id), closed = state.collapsed.has(c.id) && !q;
      const record = c.type === 'mesh' ? library.get(c.props.meshId) : null;
      const glyph = record && record.icon ? h('img', { class: 'thumb', src: record.icon, alt: '' }) : h('span', { class: 'glyph', dataset: { icon: TYPES[c.type].icon, size: '17', accent: TYPES[c.type].accent } });
      const sub = c.type === 'mesh' ? (record ? record.name : 'Missing mesh') : c.type === 'wheel' ? `r ${c.props.radius.toFixed(3)} m${c.props.steer ? ' · steer' : ''}${c.props.drive ? ' · drive' : ''}` : TYPES[c.type].cls;
      const eye = c.type !== 'root' ? h('span', { class: 'hide', title: c.visible === false ? 'Show' : 'Hide', dataset: { icon: c.visible === false ? 'eyeOff' : 'eye', size: '13' } }) : null;
      const row = h('button', { class: `tree-row${state.selected === c.id ? ' active' : ''}${c.visible === false ? ' hidden-row' : ''}`, role: 'treeitem', style: { '--depth': depth }, draggable: c.type !== 'root' ? 'true' : null, dataset: { id: c.id } },
        h('span', { class: 'caret' + (kids.length ? (closed ? ' closed' : '') : ' leaf') }), glyph,
        h('div', {}, h('b', {}, c.name), h('small', {}, sub)),
        h('span', { class: 'tag' }, c.type === 'root' ? 'ROOT' : record ? formatCount(record.triangles) : '', eye));
      if (c.type === 'mesh' && !record) row.querySelector('small').style.color = '#ff8a6b';
      row.addEventListener('click', (e) => {
        if (e.target.closest('.caret') && kids.length) { state.collapsed.has(c.id) ? state.collapsed.delete(c.id) : state.collapsed.add(c.id); renderTree(); return; }
        if (e.target.closest('.hide')) { c.visible = c.visible === false; changed(); return; }
        select(c.id);
      });
      row.addEventListener('dblclick', () => frameSelection());
      row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-frontier-component', c.id); e.dataTransfer.effectAllowed = 'move'; });
      row.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].some((t) => t.startsWith('application/x-frontier'))) { e.preventDefault(); row.style.background = '#262118'; } });
      row.addEventListener('dragleave', () => { row.style.background = ''; });
      row.addEventListener('drop', (e) => {
        e.preventDefault(); row.style.background = '';
        const meshId = e.dataTransfer.getData('application/x-frontier-mesh');
        const compId = e.dataTransfer.getData('application/x-frontier-component');
        if (meshId) addComponent({ type: 'mesh', parent: c.id, meshId });
        else if (compId && compId !== c.id && !isDescendant(c, compId)) { reparent(byId(compId), c.id); }
      });
      host.append(row);
      if (!closed) kids.forEach((k) => visit(k, depth + 1));
    };
    sceneComponents().filter((c) => !c.parent).forEach((r) => visit(r, 0));
    const actor = $('ActorTree'); actor.textContent = '';
    cls.components.filter((c) => c.actor).forEach((c) => {
      const row = h('button', { class: `tree-row${state.selected === c.id ? ' active' : ''}` }, h('span', { class: 'caret leaf' }), h('span', { class: 'glyph', dataset: { icon: TYPES[c.type].icon, size: '17', accent: TYPES[c.type].accent } }), h('div', {}, h('b', {}, c.name), h('small', {}, TYPES[c.type].cls)), h('span', { class: 'tag' }, 'CLASS'));
      row.addEventListener('click', () => select(c.id));
      actor.append(row);
    });
    const scene = sceneComponents();
    $('SceneCount').textContent = scene.length;
    $('ActorCount').textContent = cls.components.length - scene.length;
    $('StatComponents').textContent = cls.components.length;
    $('StatTriangles').innerHTML = formatCount(scene.filter((c) => c.type === 'mesh').reduce((a, c) => a + (library.get(c.props.meshId)?.triangles || 0), 0));
    $('ClassSummary').textContent = `${cls.name} · ${scene.length} scene`;
    $('FootClass').textContent = cls.name;
    $('FootMeshes').textContent = String(new Set(scene.filter((c) => c.type === 'mesh').map((c) => c.props.meshId)).size);
    $('ViewerTitle').textContent = cls.name;
    $('DocTab').textContent = cls.name;
    $('ViewerNote').textContent = `Component class · ${cls.components.length} components · ${library.list().length} compiled meshes in Content`;
    hydrate(host); hydrate(actor);
  }

  function renderChannels() {
    const host = $('ChannelList'); host.textContent = '';
    CHANNELS.forEach((ch) => {
      const row = h('button', { class: 'channel-row' + (state.channel === ch.id ? ' active' : '') }, h('span', { class: 'glyph', dataset: { icon: ch.icon, size: '16', accent: ch.accent } }), h('span', {}, ch.label), h('span', { class: 'switch' + (state.channel === ch.id ? ' on' : '') }));
      row.addEventListener('click', () => { state.channel = state.channel === ch.id ? 'none' : ch.id; renderChannels(); linesDirty = true; sync(); });
      host.append(row);
    });
    $('ChannelCount').textContent = CHANNELS.length - 1;
    hydrate(host);
  }

  // -------------------------------------------------------------------------------------------- details
  function renderDetails() {
    const host = $('Details'); host.textContent = '';
    const c = byId(state.selected) || byId('root');
    const T = TYPES[c.type];
    const record = c.type === 'mesh' ? library.get(c.props.meshId) : null;
    const path = []; for (let p = c; p; p = byId(p.parent)) path.unshift(p.name);
    host.append(
      h('div', { class: 'crumbs' }, 'Details', h('i', {}, '/'), cls.name, ...path.flatMap((n) => [h('i', {}, '/'), n])),
      h('div', { class: 'title-row' },
        h('span', { class: 'badge' }, record?.icon ? h('img', { src: record.icon, alt: '' }) : h('span', { dataset: { icon: T.icon, size: '22', accent: T.accent } })),
        h('div', { style: { minWidth: 0, flex: 1 } }, h('h1', {}, c.name))),
      h('div', { class: 'subtitle' }, `${T.cls}${record ? ` · ${record.name} · ${formatCount(record.triangles)} triangles` : ''}`),
    );
    const sections = [];
    if (!c.actor) {
      sections.push(['Component', () => componentPanel(c)]);
      if (c.type !== 'root') sections.push(['Transform', () => transformPanel(c)]);
    }
    if (c.type === 'root') sections.push(['Class', () => classPanel()]);
    if (c.type === 'mesh') { sections.push(['Static Mesh', () => meshPanel(c, record)]); if (record) { sections.push(['Baked data', () => bakePanel(record)]); sections.push(['Materials', () => materialPanel(c, record)]); } }
    if (c.type === 'wheel') sections.push(['Wheel', () => wheelPanel(c)]);
    if (['camera', 'light', 'sensor', 'ballast', 'aero'].includes(c.type)) sections.push([T.label, () => simplePanel(c)]);
    if (c.type === 'movement') sections.push(['Movement', () => movementPanel(c)]);
    const nav = h('div', { class: 'inspector-nav' });
    sections.forEach(([name], i) => nav.append(h('button', { onclick: () => host.querySelector(`[data-section="${i}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, name)));
    if (sections.length > 2) host.append(nav);
    sections.forEach(([, build], i) => { const wrap = h('div', { dataset: { section: String(i) } }); build().forEach((n) => wrap.append(n)); host.append(wrap); });
    if (!c.actor && c.type !== 'root') host.append(h('div', { class: 'btn-row', style: { marginTop: '18px' } },
      h('button', { class: 'tool', onclick: () => duplicate(c) }, h('span', { dataset: { icon: 'duplicate', size: '14' } }), 'Duplicate'),
      h('button', { class: 'tool', onclick: () => remove(c) }, h('span', { dataset: { icon: 'trash', size: '14' } }), 'Delete')));
    hydrate(host);
  }

  function componentPanel(c) {
    const name = h('input', { value: c.name, maxlength: 40, autocomplete: 'off', disabled: c.type === 'root' });
    name.addEventListener('change', () => { c.name = name.value.trim() || c.name; changed({ details: true }); });
    const parents = sceneComponents().filter((p) => p.id !== c.id && !isDescendant(p, c.id));
    const parent = h('select', { disabled: c.type === 'root' }, ...(c.type === 'root' ? [h('option', {}, '—')] : parents.map((p) => h('option', { value: p.id, selected: p.id === c.parent }, p.name))));
    parent.addEventListener('change', () => reparent(c, parent.value));
    return [heading('COMPONENT', TYPES[c.type].label.toUpperCase()), panel(
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } }, h('label', { class: 'meta-field' }, h('span', {}, 'Name'), name), h('label', { class: 'meta-field' }, h('span', {}, 'Parent'), parent)),
      c.type !== 'root' ? h('div', { class: 'tiles' },
        tile({ icon: 'eye', label: 'Visible', on: c.visible !== false, onToggle: (on) => { c.visible = on; changed(); } }),
        tile({ icon: 'frame', label: 'Frame in view', on: false, onToggle: () => frameSelection() })) : note('The root is the class origin. Every scene component is parented under it; the ground plane sits at Y = 0.'))];
  }

  function transformPanel(c) {
    return [heading('TRANSFORM', 'RELATIVE TO PARENT'), panel(
      vecRow({ label: 'Location', value: c.location, step: 0.005, digits: 3, onInput: (v) => { c.location = v; changed({ tree: false, details: false }); }, onReset: () => (c.location = [0, 0, 0]) }),
      vecRow({ label: 'Rotation', value: c.rotation, step: 0.5, digits: 1, onInput: (v) => { c.rotation = v; changed({ tree: false, details: false }); }, onReset: () => (c.rotation = [0, 0, 0]) }),
      vecRow({ label: 'Scale', value: c.scale, step: 0.005, digits: 3, onInput: (v) => { c.scale = v; changed({ tree: false, details: false }); }, onReset: () => (c.scale = [1, 1, 1]) }),
      h('small', {}, 'Drag a field to scrub (Shift = ×10), click to type. Units: metres and degrees, Y-up.'))];
  }

  function classPanel() {
    const scene = sceneComponents(), meshes = scene.filter((c) => c.type === 'mesh');
    const tris = meshes.reduce((a, c) => a + (library.get(c.props.meshId)?.triangles || 0), 0);
    const unique = [...new Set(meshes.map((c) => c.props.meshId))].map((id) => library.get(id)).filter(Boolean);
    const baked = (k) => unique.filter((r) => r[k]).length;
    const list = panel();
    unique.forEach((r) => {
      const row = h('div', { class: 'mesh-picker', style: { gridTemplateColumns: '40px minmax(0,1fr) auto' } },
        h('span', { class: 'thumb', style: { width: '40px', height: '40px', borderRadius: '10px' } }, r.icon ? h('img', { src: r.icon, alt: '' }) : h('span', { dataset: { icon: 'mesh', size: '18' } })),
        h('div', {}, h('b', {}, r.name), h('small', {}, `${formatCount(r.triangles)} tris · ${meshes.filter((c) => c.props.meshId === r.id).length} uses`)),
        h('button', { class: 'tool', onclick: () => openCompile(r) }, 'Compile…'));
      list.append(row);
    });
    const nameIn = h('input', { value: cls.name, maxlength: 40 });
    nameIn.addEventListener('change', () => { cls.name = nameIn.value.trim() || cls.name; changed({ details: true }); });
    return [
      h('div', { class: 'metrics' },
        h('div', {}, h('b', {}, String(cls.components.length)), h('small', {}, 'COMPONENTS')), h('div', {}, h('b', {}, formatCount(tris)), h('small', {}, 'SOURCE TRIANGLES')),
        h('div', {}, h('b', {}, `${totalMass().toFixed(0)} kg`), h('small', {}, 'MASS INCL. BALLAST')), h('div', {}, h('b', {}, String(unique.length)), h('small', {}, 'UNIQUE MESHES'))),
      heading('CLASS DEFAULTS'), panel(h('label', { class: 'meta-field' }, h('span', {}, 'Class name'), nameIn),
        rows([['UV charts baked', `${baked('uv')} / ${unique.length}`], ['Cluster LOD baked', `${baked('lod')} / ${unique.length}`], ['SDF baked', `${baked('sdf')} / ${unique.length}`], ['Icons', `${baked('icon')} / ${unique.length}`]])),
      heading('MESHES IN THIS CLASS', `${unique.length}`), list,
      h('div', { class: 'btn-row', style: { marginTop: '10px' } },
        h('button', { class: 'tool', onclick: () => { if (confirm('Reset BP_ControlVehicle to the authored ControlVehicle layout?')) { cls = vehicleClass(); state.selected = 'body'; changed({ details: true }); } } }, h('span', { dataset: { icon: 'reset', size: '14' } }), 'Reset class'),
        h('button', { class: 'tool', onclick: exportClass }, h('span', { dataset: { icon: 'export', size: '14' } }), 'Export JSON')),
    ];
  }

  function meshPanel(c, record) {
    const opts = library.list().map((r) => h('option', { value: r.id, selected: r.id === c.props.meshId }, r.name));
    const pick = h('select', {}, ...(record ? [] : [h('option', { value: '', selected: true }, '— missing mesh —')]), ...opts);
    pick.addEventListener('change', () => { c.props.meshId = pick.value; changed({ details: true }); });
    return [heading('STATIC MESH', record ? record.category.toUpperCase() : 'MISSING'), panel(
      h('div', { class: 'mesh-picker' },
        h('span', { class: 'thumb' }, record?.icon ? h('img', { src: record.icon, alt: '' }) : h('span', { dataset: { icon: 'mesh', size: '24' } })),
        h('div', {}, h('b', {}, record ? record.name : 'Mesh not found'), h('small', {}, record ? `${record.format} · ${record.sourceFile}` : 'Imported meshes live in this browser only'), h('div', { style: { marginTop: '6px' } }, pick))),
      record ? rows([['Triangles', formatCount(record.triangles)], ['Vertices', formatCount(record.vertices)], ['Bounds', record.bounds.hi.map((v, k) => (v - record.bounds.lo[k]).toFixed(2)).join(' × ') + ' m'], ['Topology', record.topology.closed ? 'Closed' : `Open · ${record.topology.border} border edges`], ['Compiled', new Date(record.compiledAt).toLocaleString()]]) : null,
      h('div', { class: 'btn-row' },
        h('button', { class: 'primary', disabled: !record, onclick: () => openCompile(record) }, h('span', { dataset: { icon: 'compile', size: '15' } }), 'Open in Geometry Compile'),
        h('button', { class: 'tool', style: { flex: '0 0 auto' }, onclick: () => openImportMenu($('ImportBtn')) }, h('span', { dataset: { icon: 'import', size: '14' } }), 'Import'))),
    ];
  }

  function bakePanel(r) {
    const chip = (key, label, icon, text) => h('div', { class: 'bake-chip' + (r[key] ? ' on' : '') }, h('span', { class: 'ico', dataset: { icon: r[key] ? 'check' : icon, size: '14' } }), h('div', {}, h('b', {}, label), h('small', {}, r[key] ? text : 'Not baked')));
    const out = [heading('BAKED DATA', 'FROM GEOMETRY COMPILE'), panel(
      h('div', { class: 'bake-grid' },
        chip('uv', 'UV charts', 'uv', r.uv ? `${r.uv.charts} islands · ${Math.round(r.uv.fit * 100)} % fit` : ''),
        chip('sdf', 'SDF', 'sdf', r.sdf ? `${r.sdf.dims}³ · ${r.sdf.voxel.toFixed(3)} voxel` : ''),
        chip('lod', 'Cluster LOD', 'lod', r.lod ? `${r.lod.levels.length} levels · ${formatCount(r.lod.clusterCount)} clusters` : ''),
        chip('icon', 'Icon', 'icon', 'Content thumbnail')),
      (!r.uv || !r.sdf || !r.lod) ? h('button', { class: 'tool wide', onclick: () => openCompile(r) }, 'Bake missing data in Geometry Compile…') : null)];
    if (r.lod) {
      const wrap = h('div', {});
      const max = r.lod.levels[0].triangles;
      const current = state.drawnLods[r.name];
      r.lod.levels.forEach((lv, i) => {
        const row = h('div', { class: 'level-row' + (current === `L${i}` ? ' active' : ''), title: 'Show this level in the viewport' },
          h('i', { style: { background: `hsl(${(i * 47) % 360} 55% 55%)` } }), h('b', {}, `LOD ${i}`),
          h('div', { class: 'meter' }, h('em', { style: { width: Math.max(2, (lv.triangles / max) * 100) + '%' } })), h('span', {}, formatCount(lv.triangles)));
        row.addEventListener('click', () => { state.lodMode = String(i); $('LodMode').value = i > 4 ? 'max' : String(i); sync(); renderDetails(); });
        wrap.append(row);
      });
      out.push(heading('CLUSTER LOD', state.lodMode === 'auto' ? `AUTO · ${current || '—'}` : `FORCED · ${current || '—'}`), panel(wrap, note('Auto picks the finest level with about one triangle per 6 px² of the mesh on screen. Click a level to force it.')));
    }
    return out;
  }

  function materialPanel(c, r) {
    const p = panel();
    r.slots.forEach((slot, i) => {
      const input = h('input', { type: 'color', value: linearToHex(slot.color), 'aria-label': `${slot.name} colour` });
      input.addEventListener('input', () => { slot.color = hexToLinear(input.value); library.touch(r.id); purgeGpu(r.id); sync(); });
      p.append(h('div', { class: 'slot-row' }, input, h('span', {}, slot.name), h('small', {}, `SLOT ${i}`)));
    });
    const tint = h('input', { type: 'color', value: linearToHex(c.props.tint || [1, 1, 1]) });
    tint.addEventListener('input', () => { c.props.tint = hexToLinear(tint.value); changed({ tree: false, details: false }); });
    return [heading('MATERIALS', `${r.slots.length} SLOTS · MESH DEFAULTS`), p,
      heading('COMPONENT OVERRIDE'), panel(h('div', { class: 'slot-row' }, tint, h('span', {}, 'Tint (this component only)'), h('small', {}, 'MULTIPLY')))];
  }

  function wheelPanel(c) {
    const P = c.props, upd = () => changed({ tree: true, details: false });
    return [heading('WHEEL', c.name.replace('Wheel_', '') + ' CORNER'), panel(
      prop({ label: 'Tyre radius', min: 0.25, max: 0.7, step: 0.001, value: P.radius, unit: 'm', digits: 3, onInput: (v) => { P.radius = v; upd(); } }),
      prop({ label: 'Tyre width', min: 0.15, max: 0.5, step: 0.001, value: P.width, unit: 'm', digits: 3, onInput: (v) => { P.width = v; upd(); } }),
      prop({ label: 'Max steer angle', min: 0, max: 45, step: 0.5, value: P.maxSteer, unit: '°', digits: 1, onInput: (v) => { P.maxSteer = v; upd(); } }),
      prop({ label: 'Suspension travel', min: 0.04, max: 0.3, step: 0.005, value: P.travel, unit: 'm', digits: 3, onInput: (v) => { P.travel = v; upd(); } }),
      h('div', { class: 'tiles three' },
        tile({ icon: 'rotate', label: 'Steering', on: P.steer, onToggle: (on) => { P.steer = on; upd(); } }),
        tile({ icon: 'movement', label: 'Driven', on: P.drive, onToggle: (on) => { P.drive = on; upd(); } }),
        tile({ icon: 'stop', label: 'Braked', on: P.brake, onToggle: (on) => { P.brake = on; upd(); } })),
      note('Child Tyre and Rim Static Mesh components spin with this wheel in the drive preview. Right-side wheels reuse the same meshes rotated 180°.'))];
  }

  function simplePanel(c) {
    const P = c.props, upd = () => changed({ tree: false, details: false });
    const map = {
      camera: () => [prop({ label: 'Field of view', min: 30, max: 110, step: 1, value: P.fov, unit: '°', digits: 0, onInput: (v) => { P.fov = v; upd(); } }), h('button', { class: 'tool wide', onclick: () => pilotCamera(c) }, h('span', { dataset: { icon: 'camera', size: '14' } }), 'Look through this camera')],
      light: () => [prop({ label: 'Intensity', min: 0, max: 5000, step: 10, value: P.intensity, unit: 'lm', digits: 0, onInput: (v) => { P.intensity = v; upd(); } }), prop({ label: 'Attenuation radius', min: 1, max: 30, step: 0.1, value: P.radius, unit: 'm', digits: 1, onInput: (v) => { P.radius = v; upd(); } }),
        (() => { const i = h('input', { type: 'color', value: linearToHex(P.color.map((x) => Math.pow(x, 2.2))) }); i.addEventListener('input', () => { P.color = hexToLinear(i.value).map((x) => Math.pow(x, 1 / 2.2)); upd(); }); return h('div', { class: 'slot-row' }, i, h('span', {}, 'Light colour'), h('small', {}, 'RGB')); })()],
      sensor: () => [prop({ label: 'Range', min: 1, max: 60, step: 0.5, value: P.range, unit: 'm', digits: 1, onInput: (v) => { P.range = v; upd(); } }), prop({ label: 'Cone angle', min: 5, max: 120, step: 1, value: P.cone, unit: '°', digits: 0, onInput: (v) => { P.cone = v; upd(); } })],
      ballast: () => [prop({ label: 'Mass', min: 1, max: 200, step: 1, value: P.mass, unit: 'kg', digits: 0, onInput: (v) => { P.mass = v; upd(); } }), prop({ label: 'Gizmo size', min: 0.05, max: 1, step: 0.01, value: P.size, unit: 'm', digits: 2, onInput: (v) => { P.size = v; upd(); } }), note('Ballast shifts the centre of mass and the wheel loads — turn on the Centre of mass or Wheel load channels to see it.')],
      aero: () => [prop({ label: 'Planform area', min: 0.1, max: 2.5, step: 0.01, value: P.area, unit: 'm²', digits: 2, onInput: (v) => { P.area = v; upd(); } }), prop({ label: 'Angle of attack', min: -5, max: 20, step: 0.5, value: P.angle, unit: '°', digits: 1, onInput: (v) => { P.angle = v; upd(); } }), prop({ label: 'Span', min: 0.5, max: 2.4, step: 0.01, value: P.span, unit: 'm', digits: 2, onInput: (v) => { P.span = v; upd(); } }),
        rows([['Downforce @ 100 km/h', `${(0.5 * 1.225 * 27.8 * 27.8 * P.area * 0.08 * P.angle).toFixed(0)} N`]])],
    };
    return [heading(TYPES[c.type].label.toUpperCase(), TYPES[c.type].cls.toUpperCase()), panel(...map[c.type]())];
  }

  function movementPanel(c) {
    const v = c.props.values, out = [];
    out.push(h('div', { class: 'btn-row' },
      h('button', { class: 'primary', onclick: () => drawers.open('CurveDrawer') }, h('span', { dataset: { icon: 'curve', size: '15' } }), 'Edit response curves'),
      h('button', { class: 'tool', onclick: () => toggleSim() }, h('span', { dataset: { icon: sim.running ? 'stop' : 'play', size: '13' } }), sim.running ? 'Stop' : 'Simulate')));
    for (const section of MOVEMENT_SPECS) {
      out.push(heading(section.title, section.tag));
      out.push(panel(...section.rows.map((s) => prop({ ...s, value: v[s.key], onInput: (x) => { v[s.key] = x; changed({ tree: false, details: false }); } }))));
    }
    out.push(h('button', { class: 'tool wide', style: { marginTop: '12px' }, onclick: () => { c.props.values = { ...MOVEMENT_DEFAULTS }; c.props.curves = defaultCurves(); changed({ details: true }); drawCurve(); } }, h('span', { dataset: { icon: 'reset', size: '14' } }), 'Reset to ControlVehicle sheets'));
    out.push(h('p', { class: 'honest' }, 'Values come from the Vehicle HMI ControlVehicle sheets (VehicleSpecification.js). The drive preview is a longitudinal model: torque curve × boost × gearing against drag, rolling resistance and brakes.'));
    return out;
  }

  // -------------------------------------------------------------------------------------------- edits
  function changed({ tree = true, details = true } = {}) {
    linesDirty = true;
    if (tree) renderTree();
    if (details) renderDetails();
    sync(); persist();
  }
  function select(id) { state.selected = id; linesDirty = true; renderTree(); renderDetails(); sync(); }
  function reparent(c, parentId) {
    const W = worldMatrices(), world = W.get(c.id), parentWorld = W.get(parentId);
    const local = multiply(invert(parentWorld), world);
    c.parent = parentId; c.location = [local[12], local[13], local[14]];
    changed();
    toast(`${c.name} is now a child of ${byId(parentId).name}`);
  }
  function remove(c) {
    const doomed = sceneComponents().filter((k) => isDescendant(k, c.id)).map((k) => k.id);
    cls.components = cls.components.filter((k) => !doomed.includes(k.id));
    state.selected = c.parent || 'root';
    changed(); toast(`Deleted ${c.name}${doomed.length > 1 ? ` and ${doomed.length - 1} child component(s)` : ''}`);
  }
  function duplicate(c) {
    const map = new Map();
    const copy = (k, parent) => {
      const id = `${k.type}-${Math.random().toString(36).slice(2, 8)}`; map.set(k.id, id);
      cls.components.push({ ...structuredClone(k), id, parent, name: parent === c.parent ? `${k.name}_Copy` : k.name, location: parent === c.parent ? [k.location[0], k.location[1], k.location[2] + 0.6] : [...k.location] });
      children(k.id).filter((x) => !map.has(x.id)).forEach((x) => copy(x, id));
    };
    copy(c, c.parent);
    state.selected = map.get(c.id); changed();
  }

  function addComponent({ type, parent = 'root', name, meshId = null, mount = 'origin' }) {
    const id = `${type}-${Math.random().toString(36).slice(2, 8)}`;
    const record = meshId ? library.get(meshId) : null;
    const anchors = { origin: null, roof: [0, 1.45, 0], front: [3.05, 0.6, 0], rear: [-3.05, 0.75, 0], left: [0, 0.8, -1.2], right: [0, 0.8, 1.2] };
    let location = [0, 0, 0];
    const W = worldMatrices();
    if (anchors[mount]) { const l = multiply(invert(W.get(parent)), compose(anchors[mount])); location = [l[12], l[13], l[14]]; }
    else if (type === 'mesh' && record && parent === 'root') {
      const others = sceneComponents().filter((c) => c.parent === 'root' && c.id.startsWith('mesh-')).length;
      location = [-(others % 3) * (record.bounds.radius * 2.2 + 0.5), -record.bounds.lo[1], 2.2 + record.bounds.radius + Math.floor(others / 3) * 2.5];
    }
    const comp = { id, name: name || (record ? record.name.replace(/^SM_/, '') : TYPES[type].label.replace(/\s+/g, '')), type, parent, location, rotation: [0, 0, 0], scale: [1, 1, 1], visible: true, props: { ...(DEFAULT_PROPS[type]?.() || {}) } };
    if (type === 'mesh') comp.props.meshId = meshId || library.list()[0]?.id || null;
    cls.components.push(comp);
    state.selected = id; state.collapsed.delete(parent);
    changed();
    toast(`Added ${comp.name} (${TYPES[type].cls}) under ${byId(parent).name}`);
    return comp;
  }

  function exportClass() {
    const blob = JSON.stringify({ class: cls.name, components: cls.components, meshes: library.list().map((r) => ({ id: r.id, name: r.name, triangles: r.triangles, baked: { uv: !!r.uv, sdf: !!r.sdf, lod: !!r.lod, icon: !!r.icon } })) }, null, 2);
    const a = h('a', { href: URL.createObjectURL(new Blob([blob], { type: 'application/json' })), download: `${cls.name}.json` }); document.body.append(a); a.click(); a.remove();
  }

  // -------------------------------------------------------------------------------------------- add dialog
  let addType = 'mesh';
  function openAddDialog() {
    const grid = $('TypeGrid'); grid.textContent = '';
    ADDABLE.forEach((t) => {
      const b = h('button', { type: 'button', class: 'type-card' + (t === addType ? ' active' : '') }, h('span', { dataset: { icon: TYPES[t].icon, size: '22', accent: TYPES[t].accent } }), h('b', {}, TYPES[t].label), h('small', {}, TYPES[t].note));
      b.addEventListener('click', () => { addType = t; [...grid.children].forEach((x) => x.classList.toggle('active', x === b)); $('AddMeshField').hidden = t !== 'mesh'; $('AddName').placeholder = TYPES[t].label.replace(/\s+/g, ''); });
      grid.append(b);
    });
    const sel = byId(state.selected);
    $('AddParent').innerHTML = ''; sceneComponents().forEach((c) => $('AddParent').append(h('option', { value: c.id, selected: sel && !sel.actor ? c.id === sel.id : c.id === 'root' }, c.name)));
    $('AddMesh').innerHTML = ''; library.list().forEach((r) => $('AddMesh').append(h('option', { value: r.id }, r.name)));
    $('AddMeshField').hidden = addType !== 'mesh';
    $('AddName').value = ''; $('AddName').placeholder = TYPES[addType].label.replace(/\s+/g, '');
    hydrate(grid);
    $('AddDialog').showModal();
  }

  // -------------------------------------------------------------------------------------------- content drawer
  function renderLibrary() {
    const grid = $('LibraryGrid'); grid.textContent = '';
    const imp = h('button', { class: 'library-card import-card' }, h('span', { class: 'thumb' }, h('span', { dataset: { icon: 'import', size: '30', accent: 'amber' } })), h('b', {}, 'Import…'), h('small', {}, 'OBJ · STL · FCT1 · samples'));
    imp.addEventListener('click', () => openImportMenu(imp));
    grid.append(imp);
    for (const r of library.list()) {
      const uses = sceneComponents().filter((c) => c.type === 'mesh' && c.props.meshId === r.id).length;
      const card = h('div', { class: 'library-card', draggable: 'true', title: `${r.name}\nDrag onto the viewport or a component to add · double-click to open in Geometry Compile` },
        h('span', { class: 'bake-dots', title: 'UV · SDF · LOD · Icon' }, ...['uv', 'sdf', 'lod', 'icon'].map((k) => h('i', { class: r[k] ? 'on' : '' }))),
        h('span', { class: 'thumb' }, r.icon ? h('img', { src: r.icon, alt: '' }) : h('span', { dataset: { icon: 'mesh', size: '28' } })),
        h('b', {}, r.name), h('small', {}, `${formatCount(r.triangles)} tris · ${uses} use${uses === 1 ? '' : 's'}`),
        h('div', { class: 'btn-row' }, h('button', { class: 'tool', style: { height: '26px', minHeight: '26px', fontSize: '10px', padding: '0 6px' }, onclick: (e) => { e.stopPropagation(); addComponent({ type: 'mesh', parent: 'root', meshId: r.id }); } }, '+ Add'), h('button', { class: 'tool', style: { height: '26px', minHeight: '26px', fontSize: '10px', padding: '0 6px' }, onclick: (e) => { e.stopPropagation(); openCompile(r); } }, 'Compile')));
      card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-frontier-mesh', r.id); e.dataTransfer.effectAllowed = 'copy'; });
      card.addEventListener('dblclick', () => openCompile(r));
      grid.append(card);
    }
    $('LibrarySummary').textContent = `${library.list().length} compiled meshes · drag onto the viewport or a component to add a Static Mesh · double-click to re-open Geometry Compile`;
    hydrate(grid);
  }

  // -------------------------------------------------------------------------------------------- curves
  let curveKey = 'Torque', curveBounds = null, curveDrag = -1;
  const curveCanvas = () => $('CurveCanvas');
  function curveSpec() {
    return curveKey === 'Torque'
      ? { title: 'Engine torque', ax: 'ENGINE SPEED · RPM', ay: 'TORQUE · N·M', xmin: 0, xmax: 9000, ymin: 0, ymax: 650, color: '#a8d8bb' }
      : { title: 'Turbo multiplier', ax: 'BOOST PRESSURE · BAR', ay: 'TORQUE MULTIPLIER · ×', xmin: 0, xmax: 1.4, ymin: 0.8, ymax: 2.2, color: '#e8c27a' };
  }
  function evalCurve(points, x, mode) {
    if (!points.length) return 0;
    if (x <= points[0][0]) return points[0][1];
    if (x >= points[points.length - 1][0]) return points[points.length - 1][1];
    let i = 0; while (i < points.length - 2 && x > points[i + 1][0]) i++;
    const a = points[i], b = points[i + 1], t = (x - a[0]) / (b[0] - a[0] || 1);
    if (mode === 'step') return a[1];
    if (mode === 'smooth') {
      const p0 = points[Math.max(0, i - 1)][1], p3 = points[Math.min(points.length - 1, i + 2)][1];
      const t2 = t * t, t3 = t2 * t;
      return 0.5 * (2 * a[1] + (-p0 + b[1]) * t + (2 * p0 - 5 * a[1] + 4 * b[1] - p3) * t2 + (-p0 + 3 * a[1] - 3 * b[1] + p3) * t3);
    }
    return a[1] + (b[1] - a[1]) * t;
  }
  function drawCurve() {
    const cv = curveCanvas(); if (!cv || !$('CurveDrawer').classList.contains('open')) return;
    const r = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, hgt = cv.clientHeight;
    cv.width = w * r; cv.height = hgt * r;
    const g = cv.getContext('2d'); g.setTransform(r, 0, 0, r, 0, 0);
    const s = curveSpec(), m = movement().props, pts = m.curves[curveKey], mode = m.interpolation[curveKey] || 'linear';
    const L = 52, T = 14, W = w - L - 16, H = hgt - T - 30;
    curveBounds = { L, T, W, H, ...s };
    const X = (x) => L + ((x - s.xmin) / (s.xmax - s.xmin)) * W, Y = (y) => T + (1 - (y - s.ymin) / (s.ymax - s.ymin)) * H;
    g.fillStyle = '#0f0f10'; g.fillRect(0, 0, w, hgt);
    g.strokeStyle = '#1f1f22'; g.lineWidth = 1; g.font = '9px ui-monospace, monospace'; g.fillStyle = '#5c5c5c';
    for (let i = 0; i <= 6; i++) { const x = L + (i / 6) * W; g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + H); g.stroke(); g.fillText((s.xmin + (i / 6) * (s.xmax - s.xmin)).toFixed(curveKey === 'Torque' ? 0 : 2), x - 12, T + H + 14); }
    for (let i = 0; i <= 4; i++) { const y = T + (i / 4) * H; g.beginPath(); g.moveTo(L, y); g.lineTo(L + W, y); g.stroke(); g.fillText((s.ymax - (i / 4) * (s.ymax - s.ymin)).toFixed(curveKey === 'Torque' ? 0 : 2), 6, y + 3); }
    g.fillText(s.ax, L + W / 2 - 50, hgt - 2);
    if (curveKey === 'Torque') {
      const v = values();
      g.fillStyle = '#ff6b5e14'; g.fillRect(X(v.engineRedline), T, L + W - X(v.engineRedline), H);
      g.strokeStyle = '#ff6b5e66'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(X(v.engineRedline), T); g.lineTo(X(v.engineRedline), T + H); g.stroke(); g.setLineDash([]);
      if (sim.running) { g.strokeStyle = '#ffffff88'; g.beginPath(); g.moveTo(X(sim.rpm), T); g.lineTo(X(sim.rpm), T + H); g.stroke(); }
    }
    const grad = g.createLinearGradient(0, T, 0, T + H); grad.addColorStop(0, s.color + '40'); grad.addColorStop(1, s.color + '00');
    g.beginPath(); g.moveTo(X(pts[0][0]), Y(s.ymin));
    for (let i = 0; i <= 200; i++) { const x = pts[0][0] + (i / 200) * (pts[pts.length - 1][0] - pts[0][0]); g.lineTo(X(x), Y(evalCurve(pts, x, mode))); }
    g.lineTo(X(pts[pts.length - 1][0]), Y(s.ymin)); g.closePath(); g.fillStyle = grad; g.fill();
    g.beginPath(); for (let i = 0; i <= 200; i++) { const x = pts[0][0] + (i / 200) * (pts[pts.length - 1][0] - pts[0][0]); const y = Y(evalCurve(pts, x, mode)); i ? g.lineTo(X(x), y) : g.moveTo(X(x), y); }
    g.strokeStyle = s.color; g.lineWidth = 2; g.stroke();
    pts.forEach((p, i) => { g.beginPath(); g.arc(X(p[0]), Y(p[1]), i === curveDrag ? 5.5 : 4, 0, Math.PI * 2); g.fillStyle = i === curveDrag ? '#fff' : s.color; g.fill(); g.strokeStyle = '#0f0f10'; g.lineWidth = 1.5; g.stroke(); });
    $('CurveTitle').textContent = s.title;
    $('CurveMeta').textContent = curveKey === 'Torque' ? `${pts.length} points · peak ${Math.max(...pts.map((p) => p[1])).toFixed(0)} N·m · ${mode}` : `${pts.length} points · ${values().spoolTime.toFixed(2)} s spool · ${mode}`;
    $('CurveInterp').value = mode;
  }
  function bindCurves() {
    const cv = curveCanvas();
    const toData = (e) => { const r = cv.getBoundingClientRect(), b = curveBounds; return [b.xmin + ((e.clientX - r.left - b.L) / b.W) * (b.xmax - b.xmin), b.ymax - ((e.clientY - r.top - b.T) / b.H) * (b.ymax - b.ymin)]; };
    const nearest = (e) => { const r = cv.getBoundingClientRect(), b = curveBounds, pts = movement().props.curves[curveKey]; let best = -1, bd = 12; pts.forEach((p, i) => { const x = b.L + ((p[0] - b.xmin) / (b.xmax - b.xmin)) * b.W, y = b.T + (1 - (p[1] - b.ymin) / (b.ymax - b.ymin)) * b.H; const d = Math.hypot(x - (e.clientX - r.left), y - (e.clientY - r.top)); if (d < bd) { bd = d; best = i; } }); return best; };
    cv.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; curveDrag = nearest(e); if (curveDrag >= 0) cv.setPointerCapture(e.pointerId); drawCurve(); });
    cv.addEventListener('pointermove', (e) => {
      if (curveDrag < 0) return;
      const pts = movement().props.curves[curveKey], [x, y] = toData(e), b = curveBounds;
      const lo = curveDrag > 0 ? pts[curveDrag - 1][0] + 1e-3 : b.xmin, hi = curveDrag < pts.length - 1 ? pts[curveDrag + 1][0] - 1e-3 : b.xmax;
      pts[curveDrag] = [Math.max(lo, Math.min(hi, x)), Math.max(b.ymin, Math.min(b.ymax, y))];
      drawCurve();
    });
    cv.addEventListener('pointerup', () => { if (curveDrag >= 0) persist(); curveDrag = -1; drawCurve(); });
    cv.addEventListener('dblclick', (e) => { const pts = movement().props.curves[curveKey], p = toData(e); pts.push(p); pts.sort((a, b) => a[0] - b[0]); persist(); drawCurve(); });
    cv.addEventListener('contextmenu', (e) => { e.preventDefault(); const i = nearest(e), pts = movement().props.curves[curveKey]; if (i >= 0 && pts.length > 2) { pts.splice(i, 1); persist(); drawCurve(); } });
    $('CurveTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-curve]'); if (!b) return; curveKey = b.dataset.curve; [...$('CurveTabs').children].forEach((x) => x.classList.toggle('active', x === b)); drawCurve(); });
    $('CurveInterp').addEventListener('change', () => { movement().props.interpolation[curveKey] = $('CurveInterp').value; persist(); drawCurve(); });
    $('CurveReset').addEventListener('click', () => { movement().props.curves[curveKey] = defaultCurves()[curveKey]; persist(); drawCurve(); });
    $('CurveDrawer').addEventListener('drawer-open', () => requestAnimationFrame(drawCurve));
    new ResizeObserver(() => drawCurve()).observe(cv);
  }

  // -------------------------------------------------------------------------------------------- simulation
  function toggleSim() {
    sim.running = !sim.running;
    $('ToolSimulate').classList.toggle('warn', sim.running);
    $('ToolSimulate').innerHTML = `<span data-icon="${sim.running ? 'stop' : 'play'}" data-size="13"></span>${sim.running ? 'Stop' : 'Simulate'}`;
    hydrate($('ToolSimulate'));
    $('SimHud').hidden = !sim.running;
    viewport.animating = sim.running;
    if (!sim.running) { sim.speed = 0; sim.accel = 0; sim.gear = 1; sim.rpm = 0; sim.offset = 0; sim.boost = 0; linesDirty = true; sync(); }
    if (byId(state.selected)?.type === 'movement') renderDetails();
  }
  function stepSim(dt) {
    const v = values(), m = movement().props, mass = totalMass();
    const front = sceneComponents().find((c) => c.type === 'wheel') || { props: { radius: VehicleGeometry.TyreRadius } };
    const r = front.props.radius, ratios = TransmissionSheet.GearRatios.slice(3), gr = ratios[sim.gear - 1], fd = v.finalDrive;
    const wheelRpm = (sim.speed / r) * 60 / (2 * Math.PI);
    sim.rpm = Math.max(v.engineIdle, wheelRpm * gr * fd);
    if (sim.rpm > TransmissionSheet.UpshiftRPM && sim.gear < ratios.length) sim.gear++;
    else if (sim.rpm < TransmissionSheet.DownshiftRPM && sim.gear > 1) sim.gear--;
    const target = v.boostLimit * sim.throttle;
    sim.boost += (target - sim.boost) * Math.min(1, dt / Math.max(0.05, v.spoolTime));
    const mult = evalCurve(m.curves.Boost, sim.boost, m.interpolation.Boost);
    sim.torque = sim.rpm >= v.engineRedline ? 0 : evalCurve(m.curves.Torque, sim.rpm, m.interpolation.Torque) * sim.throttle * mult;
    const drive = (sim.torque * gr * fd * TransmissionSheet.DriveEfficiency) / r;
    const drag = 0.5 * ChassisSheet.AirDensity * v.dragArea * sim.speed * sim.speed;
    const roll = sim.speed > 0.05 ? ChassisSheet.RollingResistance * mass * G : 0;
    const braked = sceneComponents().filter((c) => c.type === 'wheel' && c.props.brake).length;
    const brake = sim.speed > 0.05 ? (sim.brake * braked * ChassisSheet.MaxBrakeTorquePerWheel) / r : 0;
    sim.accel = (drive - drag - roll - brake) / mass;
    sim.speed = Math.max(0, sim.speed + sim.accel * dt);
    if (sim.speed === 0) sim.accel = Math.max(0, sim.accel);
    sim.spin += (sim.speed / r) * dt;
    sim.offset += sim.speed * dt;
    $('SimSpeed').textContent = (sim.speed * 3.6).toFixed(0);
    $('SimRpm').textContent = sim.rpm.toFixed(0);
    $('SimTorque').textContent = sim.torque.toFixed(0);
    $('SimGear').textContent = `GEAR ${sim.gear} · ${(sim.accel / G).toFixed(2)} g`;
    if ($('CurveDrawer').classList.contains('open') && curveKey === 'Torque') drawCurve();
  }

  // -------------------------------------------------------------------------------------------- camera
  function frameSelection() {
    const W = worldMatrices(), sel = state.selected;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const c of sceneComponents()) {
      if (sel !== 'root' && !isDescendant(c, sel)) continue;
      if (sel === 'root' && c.type !== 'mesh') continue;
      if (!ancestorsVisible(c)) continue;
      const m = W.get(c.id);
      const r = c.type === 'mesh' ? library.get(c.props.meshId) : null;
      const pts = r ? [r.bounds.lo, r.bounds.hi, [r.bounds.lo[0], r.bounds.hi[1], r.bounds.lo[2]], [r.bounds.hi[0], r.bounds.lo[1], r.bounds.hi[2]]] : [[-0.3, -0.3, -0.3], [0.3, 0.3, 0.3]];
      for (const p of pts) { const q = transformPoint(m, p); for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); } }
    }
    if (!Number.isFinite(lo[0])) return;
    viewport.frame({ centre: lo.map((v, k) => (v + hi[k]) / 2), radius: Math.max(0.3, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2) });
  }
  function cameraPreset(p) {
    state.camPreset = p;
    const c = viewport.camera;
    const a = { persp: [0.75, 0.3], side: [0, 0.04], front: [Math.PI / 2, 0.04], top: [0.0001, 1.5] }[p];
    c.yaw = a[0]; c.pitch = a[1];
    const sel = state.selected; state.selected = 'root'; frameSelection(); state.selected = sel;
    [...$('CameraPresets').children].forEach((b) => b.classList.toggle('active', b.dataset.cam === p));
  }
  function pilotCamera(c) {
    const m = worldMatrices().get(c.id), eye = transformPoint(m, [0, 0, 0]), fwd = transformPoint(m, [1, 0, 0]);
    const d = fwd.map((x, k) => x - eye[k]), len = Math.hypot(...d) || 1;
    const cam = viewport.camera;
    cam.fov = c.props.fov * 0.62;
    cam.distance = 6; cam.pitch = Math.asin(-d[1] / len) * -1;
    cam.yaw = Math.atan2(-d[0], -d[2]);
    cam.target = eye.map((x, k) => x + (d[k] / len) * cam.distance);
    cam.pitch = Math.asin(-(d[1] / len));
    viewport.dirty = true;
    toast(`Looking through ${c.name} · orbit to leave`);
    setTimeout(() => { cam.fov = 38; }, 4000);
  }

  // -------------------------------------------------------------------------------------------- init
  function init() {
    viewport = new Viewport($('ViewerCanvas'), {
      onPick: (id, e) => { if (id) select(id); else if (!e.shiftKey) select('root'); },
      onCamera: () => { if (state.lodMode === 'auto') scheduleLodSync(); },
    });
    viewport.settings.cell = 0.5;
    viewport.settings.shadow = [0, 0, 3.6, 1.6];
    viewport.camera = { target: [0, 0.75, 0], yaw: 0.78, pitch: 0.28, distance: 10.5, fov: 38 };
    drawers = bindDrawers($('Studio'));
    $('ViewModes').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (!b) return; state.mode = b.dataset.mode; [...$('ViewModes').children].forEach((x) => x.classList.toggle('active', x === b)); sync(); });
    $('ToolWire').addEventListener('click', () => { state.wire = !state.wire; $('ToolWire').classList.toggle('active', state.wire); sync(); });
    $('ToolGrid').addEventListener('click', () => { state.grid = !state.grid; $('ToolGrid').classList.toggle('active', state.grid); sync(); });
    $('ToolFit').addEventListener('click', frameSelection);
    $('ToolSimulate').addEventListener('click', toggleSim);
    $('CameraPresets').addEventListener('click', (e) => { const b = e.target.closest('[data-cam]'); if (b) cameraPreset(b.dataset.cam); });
    $('LodMode').addEventListener('change', () => { state.lodMode = $('LodMode').value; sync(); renderDetails(); });
    $('TreeSearch').addEventListener('input', () => { state.search = $('TreeSearch').value; renderTree(); });
    $('AddComponent').addEventListener('click', openAddDialog);
    $('AddClose').addEventListener('click', () => $('AddDialog').close());
    $('AddCancel').addEventListener('click', () => $('AddDialog').close());
    $('AddForm').addEventListener('submit', () => addComponent({ type: addType, parent: $('AddParent').value, name: $('AddName').value.trim() || undefined, meshId: addType === 'mesh' ? $('AddMesh').value : null, mount: $('AddMount').value }));
    for (const [id, key, out] of [['Throttle', 'throttle', 'ThrottleOut'], ['Brake', 'brake', 'BrakeOut']]) {
      const r = $(id); setFill(r);
      r.addEventListener('input', () => { sim[key] = +r.value; setFill(r); $(out).textContent = `${Math.round(sim[key] * 100)} %`; });
    }
    const well = $('ViewerWell');
    well.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('application/x-frontier-mesh')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    well.addEventListener('drop', (e) => { const id = e.dataTransfer.getData('application/x-frontier-mesh'); if (id) { e.preventDefault(); e.stopPropagation(); addComponent({ type: 'mesh', parent: 'root', meshId: id }); } });
    $('ContentDrawer').addEventListener('drawer-open', renderLibrary);
    document.addEventListener('keydown', (e) => {
      if (!$('Compile').hidden || document.querySelector('dialog[open]')) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === 'f' || e.key === 'F') frameSelection();
      else if (e.key === 'g' || e.key === 'G') $('ToolGrid').click();
      else if (e.key === 'z' || e.key === 'Z') $('ToolWire').click();
      else if (e.key === ' ') { e.preventDefault(); toggleSim(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && byId(state.selected) && !byId(state.selected).actor && state.selected !== 'root') remove(byId(state.selected));
      else if (e.key === 'd' && (e.ctrlKey || e.metaKey) && byId(state.selected) && !byId(state.selected).actor && state.selected !== 'root') { e.preventDefault(); duplicate(byId(state.selected)); }
    });
    bindCurves();
    const loop = (now) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - lastFrame) / 1000); frameMs = frameMs * 0.9 + (now - lastFrame) * 0.1; lastFrame = now;
      if (sim.running) { stepSim(dt); sync(); }
    };
    requestAnimationFrame(loop);
    renderChannels();
  }
  let lodTimer = 0;
  function scheduleLodSync() { if (lodTimer) return; lodTimer = setTimeout(() => { lodTimer = 0; sync(); }, 60); }

  function refresh() { renderTree(); renderDetails(); if ($('ContentDrawer').classList.contains('open')) renderLibrary(); linesDirty = true; sync(); }

  init();
  return {
    refresh, purgeGpu, viewport: () => viewport, className: () => cls.name,
    addMesh: (meshId) => addComponent({ type: 'mesh', parent: 'root', meshId }),
    openContent: () => drawers.open('ContentDrawer'),
    frame: frameSelection,
  };
}
