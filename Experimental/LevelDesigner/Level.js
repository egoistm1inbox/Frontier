// A level as the Level Designer edits it: the Lobby environment, the configurable vehicle with its hotspots, lights
// and (for Premium) the designer's own placements — primitives and imported models. Each thing in the level is a
// Placement record { id, kind, name, group, object, … }; the outliner, picking, the gizmo and the Details panel all
// work from that list. The level saves to localStorage and exports as JSON.
import { THREE } from '../Shared/Studio/Render.js';
import { readGeometry, formatOf } from '../Shared/GeometryCompile/Engine/ImportFormats.js';
import { Lobby, defaultLobbySettings } from './Lobby.js';
import { ControlVehicle, geometryFromRaw } from './Vehicle.js';
import { Configurator, DEFAULT_HOTSPOTS, ZONES, applyDefaultFinish } from './Configurator.js';

export const STORAGE_KEY = 'Frontier.LevelDesigner.Lobby.v1';

export const GROUPS = [
  { id: 'environment', label: 'Environment', icon: 'sun', note: 'Sky, sun, floor and walls' },
  { id: 'vehicle', label: 'Vehicle', icon: 'vehicle', note: 'Configurable car and its dots' },
  { id: 'lights', label: 'Lights', icon: 'bulb', note: 'Added lights' },
  { id: 'custom', label: 'Your placements', icon: 'sparkle', note: 'Premium · your own shapes and models' },
];

// Things that can be added. `premium` ones need the Premium tier.
export const ADDABLE = [
  { kind: 'light-point', label: 'Point light', icon: 'bulb', group: 'Lights', note: 'Omni bulb' },
  { kind: 'light-spot', label: 'Spot light', icon: 'spot', group: 'Lights', note: 'Cone with soft edge' },
  { kind: 'light-strip', label: 'Light strip', icon: 'strip', group: 'Lights', note: 'Glowing bar with a soft glow' },
  { kind: 'hotspot', label: 'Configurator dot', icon: 'dot', group: 'Vehicle', note: 'Another dot on the car' },
  { kind: 'shape-plinth', label: 'Plinth', icon: 'plinth', group: 'Lobby pieces', premium: true, note: 'Round display base' },
  { kind: 'shape-block', label: 'Block', icon: 'cube', group: 'Lobby pieces', premium: true, note: 'Box, any size' },
  { kind: 'shape-sphere', label: 'Sphere', icon: 'sphere', group: 'Lobby pieces', premium: true, note: 'Ball or dome' },
  { kind: 'shape-panel', label: 'Wall panel', icon: 'panel', group: 'Lobby pieces', premium: true, note: 'Thin standing slab' },
  { kind: 'shape-arch', label: 'Arch', icon: 'arch', group: 'Lobby pieces', premium: true, note: 'Doorway frame' },
  { kind: 'import', label: 'Import model…', icon: 'upload', group: 'Your models', premium: true, note: 'OBJ · glTF · GLB · STL · PLY · FCT1' },
];

const SHAPES = {
  'shape-plinth': { name: 'Plinth', make: () => new THREE.CylinderGeometry(0.9, 0.9, 0.5, 64).translate(0, 0.25, 0), colour: '#f2f3f5' },
  'shape-block': { name: 'Block', make: () => new THREE.BoxGeometry(1.2, 1.2, 1.2).translate(0, 0.6, 0), colour: '#e9ecf0' },
  'shape-sphere': { name: 'Sphere', make: () => new THREE.SphereGeometry(0.6, 48, 24).translate(0, 0.6, 0), colour: '#dfe3e8' },
  'shape-panel': { name: 'Wall panel', make: () => new THREE.BoxGeometry(3, 3.2, 0.18).translate(0, 1.6, 0), colour: '#f1f3f6' },
  'shape-arch': { name: 'Arch', make: archFrame, colour: '#f1f3f6' },
};

function archFrame() {
  const s = new THREE.Shape();
  s.moveTo(-1.6, 0); s.lineTo(-1.6, 2.2); s.absarc(0, 2.2, 1.6, Math.PI, 0, true); s.lineTo(1.6, 0); s.lineTo(1.2, 0); s.lineTo(1.2, 2.2);
  s.absarc(0, 2.2, 1.2, 0, Math.PI, false); s.lineTo(-1.2, 0); s.lineTo(-1.6, 0);
  return new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false, curveSegments: 32 }).translate(0, 0, -0.15);
}

const r3 = (v) => [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)];
let serial = 1;
const newId = (kind) => `${kind}-${Date.now().toString(36)}-${serial++}`;

export class Level {
  constructor(stage, well) {
    this.stage = stage;
    this.well = well;
    this.name = 'Lobby';
    this.tier = 'basic';
    this.placements = [];
    this.listeners = new Set();
    this.lobby = new Lobby(stage, defaultLobbySettings());
    this.vehicle = new ControlVehicle();
    this.helpers = new THREE.Group();     // light glyphs: drawn in design mode only
    this.helpers.name = 'Helpers';
    stage.scene.add(this.helpers);
    this.custom = new THREE.Group();
    this.custom.name = 'Placements';
    stage.scene.add(this.custom);
    this.imports = new Map();             // id → { fileName, raw } (kept for the session only)
    stage.frameCallbacks.add(() => this.tick());
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed(what = 'scene') { for (const fn of this.listeners) fn(what); this.queueSave(); }

  async load(report) {
    await this.vehicle.load(report);
    this.vehicle.root.position.y = this.lobby.turntableHeight;
    this.stage.content.add(this.vehicle.root);
    this.configurator = new Configurator({ stage: this.stage, vehicle: this.vehicle, well: this.well, onChange: () => this.changed('finish') });
    applyDefaultFinish(this.vehicle);
    this.registerBuiltIns();
    for (const def of DEFAULT_HOTSPOTS) this.addHotspot(def, { silent: true });
    const saved = this.readSaved();
    if (saved) { try { this.restore(saved); } catch (e) { console.warn('Saved level ignored', e); } }
  }

  // ------------------------------------------------------------------------------------------ built-ins
  registerBuiltIns() {
    const L = this.lobby;
    const env = (id, kind, name, object, extra = {}) => this.placements.push({ id, kind, name, group: 'environment', object, builtIn: true, ...extra });
    env('sky', 'sky', 'Sky', L.sky, { icon: 'sky', note: 'Gradient dome' });
    env('sun', 'sun', 'Sun', L.sun, { icon: 'sun', note: 'Shadow-casting key light' });
    env('floor', 'floor', 'Floor', L.floor, { icon: 'floor', note: 'Glossy reflective floor' });
    env('walls', 'walls', 'Cyclorama', L.walls, { icon: 'wall', note: 'Curved wall with floor cove', pick: [L.walls] });
    L.slabs.forEach((s, i) => env(`slab-${i}`, 'slab', s.name, s, { icon: 'panel', note: 'Leaning slab', movable: true, rotatable: true, pick: [s] }));
    env('turntable', 'turntable', 'Turntable', L.turntable, { icon: 'turntable', note: 'Display disc with a light ring', movable: true, pick: [L.disc] });
    env('arches', 'arches', 'Light arches', L.arches, { icon: 'strip', note: 'Arched light strips' });
    this.placements.push({ id: 'vehicle', kind: 'vehicle', name: 'ControlVehicle', group: 'vehicle', object: this.vehicle.root, builtIn: true, icon: 'vehicle', note: 'Body · 4 wheels · rear wing', movable: true, rotatable: true, pick: this.vehicle.meshes });
  }

  get(id) { return this.placements.find((p) => p.id === id) || null; }
  byGroup(group) { return this.placements.filter((p) => p.group === group); }

  // ------------------------------------------------------------------------------------------- hotspots
  addHotspot(def, { silent = false } = {}) {
    const d = def || { id: newId('hs'), zone: 'paint', anchor: [0.8, 0.9, 1.1], view: { yaw: 20, pitch: 10, distance: 4 } };
    const spot = this.configurator.add(d);
    const p = { id: d.id, kind: 'hotspot', name: `${ZONES[d.zone].label} dot`, group: 'vehicle', parent: 'vehicle', object: spot.marker, spot, icon: 'dot', note: ZONES[d.zone].kicker, movable: true, builtIn: DEFAULT_HOTSPOTS.some((x) => x.id === d.id) };
    this.placements.push(p);
    if (!silent) this.changed('add');
    return p;
  }

  setHotspotZone(p, zone) {
    p.spot.zone = zone; p.spot.zoneDef = ZONES[zone];
    p.name = `${ZONES[zone].label} dot`; p.note = ZONES[zone].kicker;
    p.spot.dot.querySelector('span').textContent = ZONES[zone].label;
    p.spot.dot.title = ZONES[zone].label;
    this.changed('rename');
  }

  // ---------------------------------------------------------------------------------------------- lights
  addLight(kind, opts = {}) {
    const id = opts.id || newId(kind);
    const colour = opts.colour || '#ffffff';
    let light, glyph, name;
    const holder = new THREE.Group();
    holder.position.set(...(opts.position || (kind === 'light-strip' ? [0, 3.4, 2.6] : [2.6, 3.2, 3.2])));
    if (kind === 'light-point') {
      name = 'Point light';
      light = new THREE.PointLight(colour, opts.intensity ?? 18, opts.range ?? 14, 2);
      glyph = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 10), new THREE.MeshBasicMaterial({ color: colour, toneMapped: false }));
    } else if (kind === 'light-spot') {
      name = 'Spot light';
      light = new THREE.SpotLight(colour, opts.intensity ?? 60, opts.range ?? 20, THREE.MathUtils.degToRad(opts.angle ?? 32), 0.55, 2);
      light.castShadow = !!opts.shadow;
      light.shadow.mapSize.set(1024, 1024);
      light.target.position.set(0, -1, -0.4);
      holder.add(light.target);
      glyph = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.28, 18, 1, true), new THREE.MeshBasicMaterial({ color: colour, wireframe: true, toneMapped: false }));
      glyph.rotation.x = Math.PI;
    } else {
      name = 'Light strip';
      light = new THREE.PointLight(colour, opts.intensity ?? 14, opts.range ?? 12, 2);
      glyph = new THREE.Mesh(new THREE.BoxGeometry(opts.length ?? 3, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: colour, toneMapped: false }));
    }
    holder.add(light);
    const helperHolder = glyph;
    holder.add(glyph);
    if (kind !== 'light-strip') glyph.userData.helper = true;
    holder.name = name;
    if (opts.rotationY) holder.rotation.y = opts.rotationY;
    this.custom.add(holder);
    const p = { id, kind, name: opts.name || name, group: 'lights', object: holder, light, glyph: helperHolder, icon: kind === 'light-spot' ? 'spot' : kind === 'light-strip' ? 'strip' : 'bulb', note: '', movable: true, rotatable: kind !== 'light-point', removable: true, pick: [glyph] };
    p.data = { colour, intensity: light.intensity, range: light.distance, angle: opts.angle ?? 32, shadow: !!opts.shadow, length: opts.length ?? 3 };
    this.placements.push(p);
    if (!opts.silent) this.changed('add');
    return p;
  }

  setLight(p, key, value) {
    p.data[key] = value;
    const l = p.light;
    if (key === 'colour') { l.color.set(value); p.glyph.material.color.set(value); }
    if (key === 'intensity') l.intensity = value;
    if (key === 'range') l.distance = value;
    if (key === 'angle' && l.isSpotLight) l.angle = THREE.MathUtils.degToRad(value);
    if (key === 'shadow' && l.isSpotLight) l.castShadow = value;
    if (key === 'length' && p.kind === 'light-strip') { p.glyph.geometry.dispose(); p.glyph.geometry = new THREE.BoxGeometry(value, 0.05, 0.05); }
    this.changed('edit');
  }

  // ---------------------------------------------------------------------------------------------- shapes
  addShape(kind, opts = {}) {
    const def = SHAPES[kind];
    const mat = new THREE.MeshPhysicalMaterial({ color: opts.colour || def.colour, roughness: opts.roughness ?? 0.6, metalness: opts.metalness ?? 0, clearcoat: 0.2 });
    const mesh = new THREE.Mesh(def.make(), mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const holder = new THREE.Group();
    holder.add(mesh);
    holder.position.set(...(opts.position || [-4.2, 0, 2.2]));
    if (opts.rotationY) holder.rotation.y = opts.rotationY;
    if (opts.scale) holder.scale.set(...opts.scale);
    holder.name = def.name;
    this.custom.add(holder);
    const p = { id: opts.id || newId(kind), kind, name: opts.name || def.name, group: 'custom', object: holder, mesh, icon: ADDABLE.find((a) => a.kind === kind).icon, note: 'Lobby piece', movable: true, rotatable: true, scalable: true, removable: true, premium: true, pick: [mesh] };
    p.data = { colour: '#' + mat.color.getHexString(), roughness: mat.roughness, metalness: mat.metalness };
    this.placements.push(p);
    if (!opts.silent) this.changed('add');
    return p;
  }

  async importFile(file) {
    if (!formatOf(file.name)) throw new Error(`Unknown file type: ${file.name}`);
    const bytes = await file.arrayBuffer();
    const raw = readGeometry(file.name, bytes);
    const isFacet = /\.facet$/i.test(file.name);
    const { geometry, families } = geometryFromRaw(raw, { up: isFacet ? 'z' : 'y', normals: 'angle' });
    // Fit: centre on the floor; scale down files authored in centimetres or millimetres.
    geometry.computeBoundingBox();
    const box = geometry.boundingBox, size = box.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    const unit = longest > 400 ? 0.001 : longest > 40 ? 0.01 : 1;
    geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    geometry.scale(unit, unit, unit);
    const mats = families.map((f, i) => new THREE.MeshPhysicalMaterial({ color: families.length > 1 ? new THREE.Color().setHSL((i * 0.161 + 0.08) % 1, 0.25, 0.7) : '#c3c7cf', roughness: 0.55, clearcoat: 0.2 }));
    const mesh = new THREE.Mesh(geometry, mats.length > 1 ? mats : mats[0]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const holder = new THREE.Group();
    holder.add(mesh);
    holder.position.set(4.6, 0, 2.6);
    holder.name = file.name;
    this.custom.add(holder);
    const name = file.name.replace(/\.[^.]+$/, '');
    const p = { id: newId('import'), kind: 'import', name, group: 'custom', object: holder, mesh, icon: 'file', note: `${formatOf(file.name).label} · ${(geometry.attributes.position.count / 3).toLocaleString()} tris${unit !== 1 ? ` · ×${unit}` : ''}`, movable: true, rotatable: true, scalable: true, removable: true, premium: true, pick: [mesh], session: true };
    p.data = { colour: '#c3c7cf', roughness: 0.55, metalness: 0 };
    this.placements.push(p);
    this.changed('add');
    return p;
  }

  setSurface(p, key, value) {
    p.data[key] = value;
    const mats = Array.isArray(p.mesh.material) ? p.mesh.material : [p.mesh.material];
    for (const m of mats) {
      if (key === 'colour') m.color.set(value);
      if (key === 'roughness') m.roughness = value;
      if (key === 'metalness') m.metalness = value;
    }
    this.changed('edit');
  }

  remove(p) {
    if (!p || !p.removable && p.kind !== 'hotspot') return false;
    if (p.kind === 'hotspot') this.configurator.remove(p.spot);
    else {
      p.object.parent && p.object.parent.remove(p.object);
      p.object.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
    }
    this.placements = this.placements.filter((x) => x !== p);
    this.changed('remove');
    return true;
  }

  duplicate(p) {
    if (p.kind.startsWith('light-')) return this.addLight(p.kind, { ...p.data, position: r3(p.object.position.clone().add(new THREE.Vector3(0.6, 0, 0.6))), rotationY: p.object.rotation.y });
    if (p.kind.startsWith('shape-')) return this.addShape(p.kind, { ...p.data, position: r3(p.object.position.clone().add(new THREE.Vector3(0.8, 0, 0.8))), rotationY: p.object.rotation.y, scale: r3(p.object.scale) });
    if (p.kind === 'hotspot') return this.addHotspot({ id: newId('hs'), zone: p.spot.zone, anchor: r3(p.object.position.clone().add(new THREE.Vector3(-0.3, 0, 0))), view: { ...p.spot.view } });
    return null;
  }

  setVisible(p, on) {
    if (p.kind === 'hotspot') p.spot.shown = on;
    else if (p.kind === 'sun') { p.object.visible = on; this.lobby.applySun(); }
    else if (p.kind === 'arches') { this.lobby.settings.arches.visible = on; this.lobby.applyArches(); }
    else p.object.visible = on;
    if (p.kind === 'walls') this.lobby.queueEnvironment();
    if (p.kind === 'turntable') this.seatVehicle();
    this.changed('visibility');
  }

  isVisible(p) {
    if (p.kind === 'hotspot') return p.spot.shown;
    if (p.kind === 'arches') return this.lobby.settings.arches.visible;
    return p.object.visible;
  }

  // The car sits on the turntable when it is parked over it.
  seatVehicle() {
    const v = this.vehicle.root, t = this.lobby.turntable;
    const dx = v.position.x - t.position.x, dz = v.position.z - t.position.z;
    const on = t.visible && Math.hypot(dx, dz) < this.lobby.settings.turntable.radius;
    v.position.y = on ? t.position.y + this.lobby.turntableHeight : 0;
  }

  tick() {
    const spin = this.lobby.spin;
    if (spin) {
      const v = this.vehicle.root, t = this.lobby.turntable;
      const dx = v.position.x - t.position.x, dz = v.position.z - t.position.z;
      if (Math.hypot(dx, dz) < this.lobby.settings.turntable.radius) v.rotation.y += spin;
    }
  }

  // ---------------------------------------------------------------------------------------------- picking
  pickables() {
    const list = [];
    for (const p of this.placements) {
      if (!p.pick || !this.isVisible(p)) continue;
      for (const o of p.pick) list.push([o, p]);
    }
    return list;
  }

  pick(clientX, clientY, { helpers = true } = {}) {
    const rect = this.stage.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.stage.camera);
    const pairs = this.pickables().filter(([o]) => helpers || !o.userData.helper);
    const owner = new Map(pairs);
    const hits = ray.intersectObjects(pairs.map(([o]) => o), true);
    for (const h of hits) {
      let o = h.object;
      while (o && !owner.has(o)) o = o.parent;
      if (o) return owner.get(o);
    }
    return null;
  }

  // ------------------------------------------------------------------------------------------- persistence
  snapshot() {
    const v = this.vehicle;
    const colours = {};
    for (const [part, fams] of Object.entries(v.materials)) for (const f of Object.keys(fams)) colours[`${part}:${f}`] = v.colour(part, +f);
    const transforms = {}, visibility = {};
    for (const p of this.placements) {
      visibility[p.id] = this.isVisible(p);
      if (p.movable && p.builtIn && p.kind !== 'hotspot') transforms[p.id] = { position: r3(p.object.position), rotationY: +p.object.rotation.y.toFixed(4) };
    }
    return {
      format: 'Frontier.Level', version: 1, name: this.name, tier: this.tier,
      lobby: this.lobby.settings,
      vehicle: { finish: v.finish, colours },
      transforms, visibility,
      hotspots: this.byGroup('vehicle').filter((p) => p.kind === 'hotspot').map((p) => ({ id: p.id, zone: p.spot.zone, anchor: r3(p.object.position), view: p.spot.view })),
      lights: this.byGroup('lights').map((p) => ({ id: p.id, kind: p.kind, name: p.name, position: r3(p.object.position), rotationY: p.object.rotation.y, ...p.data })),
      shapes: this.byGroup('custom').filter((p) => !p.session).map((p) => ({ id: p.id, kind: p.kind, name: p.name, position: r3(p.object.position), rotationY: p.object.rotation.y, scale: r3(p.object.scale), ...p.data })),
    };
  }

  restore(s) {
    if (!s || s.format !== 'Frontier.Level') return;
    this.name = s.name || 'Lobby';
    this.tier = s.tier === 'premium' ? 'premium' : 'basic';
    const L = this.lobby;
    for (const k of Object.keys(L.settings)) if (s.lobby && s.lobby[k] !== undefined) L.settings[k] = typeof L.settings[k] === 'object' ? { ...L.settings[k], ...s.lobby[k] } : s.lobby[k];
    L.applyAll();
    const v = this.vehicle;
    if (s.vehicle) {
      for (const [key, hex] of Object.entries(s.vehicle.colours || {})) { const [part, f] = key.split(':'); v.setColour(part, +f, hex); }
      v.setFinish(s.vehicle.finish || 'gloss');
    }
    if (s.hotspots) {
      for (const p of this.byGroup('vehicle').filter((x) => x.kind === 'hotspot')) { this.configurator.remove(p.spot); this.placements = this.placements.filter((x) => x !== p); }
      for (const h of s.hotspots) if (ZONES[h.zone]) this.addHotspot(h, { silent: true });
    }
    for (const l of s.lights || []) this.addLight(l.kind, { ...l, silent: true });
    for (const sh of s.shapes || []) if (SHAPES[sh.kind]) this.addShape(sh.kind, { ...sh, silent: true });
    for (const [id, t] of Object.entries(s.transforms || {})) {
      const p = this.get(id);
      if (!p) continue;
      p.object.position.set(...t.position);
      p.object.rotation.y = t.rotationY || 0;
    }
    for (const [id, on] of Object.entries(s.visibility || {})) {
      const p = this.get(id);
      if (!p || p.kind === 'arches') continue;
      if (p.kind === 'hotspot') p.spot.shown = on; else { p.object.visible = on; if (p.kind === 'sun') L.applySun(); }
    }
    this.seatVehicle();
    L.queueEnvironment();
  }

  readSaved() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
  }

  queueSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.snapshot())); } catch { /* storage full or blocked */ } }, 400);
  }

  get counts() {
    return { placements: this.placements.length, hotspots: this.placements.filter((p) => p.kind === 'hotspot').length, lights: this.byGroup('lights').length, custom: this.byGroup('custom').length };
  }
}
