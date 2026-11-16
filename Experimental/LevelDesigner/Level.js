// A level as the Level Designer edits it: the Lobby environment, the configurable vehicle with its hotspots, lights
// and (for Premium) the designer's own placements — primitives and imported models. Each thing in the level is a
// Placement record { id, kind, name, group, object, … }; the outliner, picking, the gizmo and the Details panel all
// work from that list. The level saves to localStorage and exports as JSON.
import { THREE } from '../Shared/Studio/Render.js';
import { readGeometry, formatOf } from '../Shared/GeometryCompile/Engine/ImportFormats.js';
import { Lobby, defaultLobbySettings } from './Lobby.js';
import { ControlVehicle, geometryFromRaw } from './Vehicle.js';
import { PROPS, SURFACES, defaultParams, surfaceMaterial } from './Props.js';
import { Configurator, DEFAULT_HOTSPOTS, ZONES, applyDefaultFinish } from './Configurator.js';

export const STORAGE_KEY = 'Frontier.LevelDesigner.Lobby.v1';      // single-level save from the first build (migrated)
export const LIBRARY_KEY = 'Frontier.LevelDesigner.Levels.v1';

export const GROUPS = [
  { id: 'environment', label: 'Environment', icon: 'sun', note: 'Sky, sun, floor, walls, turntable' },
  { id: 'vehicle', label: 'Vehicle', icon: 'vehicle', note: 'Configurable car and its dots' },
  { id: 'props', label: 'Props', icon: 'plinth', note: 'Lobby pieces · resize, restyle or swap' },
  { id: 'lights', label: 'Lights', icon: 'bulb', note: 'Added lights' },
  { id: 'custom', label: 'Your models', icon: 'sparkle', note: 'Premium · imported models' },
];

// Things that can be added. `premium` ones need the Premium tier.
export const ADDABLE = [
  { kind: 'light-point', label: 'Point light', icon: 'bulb', group: 'Lights', note: 'Omni bulb' },
  { kind: 'light-spot', label: 'Spot light', icon: 'spot', group: 'Lights', note: 'Cone with soft edge' },
  { kind: 'light-strip', label: 'Light strip', icon: 'strip', group: 'Lights', note: 'Glowing bar with a soft glow' },
  { kind: 'hotspot', label: 'Configurator dot', icon: 'dot', group: 'Vehicle', note: 'Another dot on the car' },
  ...Object.entries(PROPS).map(([type, d]) => ({ kind: `prop:${type}`, label: d.label, icon: d.icon, group: 'Props', note: d.note })),
  { kind: 'import', label: 'Import model…', icon: 'upload', group: 'Your models', premium: true, note: 'OBJ · glTF · GLB · STL · PLY · FCT1' },
];

// Level templates: what a new level starts with.
export const TEMPLATES = {
  lobby: {
    label: 'Lobby', note: 'Daylight cove, two leaning slabs, turntable', preset: 'cove',
    props: [
      { type: 'panel', name: 'Slab west', position: [-7.6, 0, 3.4], rotationY: 2.12, params: { width: 4.2, height: 6.2, thickness: 0.55, lean: -9 } },
      { type: 'panel', name: 'Slab east', position: [6.4, 0, -6.2], rotationY: -0.42, params: { width: 7.5, height: 2.1, thickness: 0.5, lean: 0 } },
    ],
  },
  gallery: {
    label: 'Gallery', note: 'Overcast concrete room, stage, barriers, planters', preset: 'overcast',
    props: [
      { type: 'stage', name: 'Stage', position: [0, 0, 0], params: { width: 9, depth: 6, height: 0.03, corner: 1 }, surface: 'concrete' },
      { type: 'barrier', name: 'Barrier front', position: [0, 0, 3.6], params: { span: 4.4 } },
      { type: 'planter', name: 'Planter west', position: [-6.4, 0, -3.2] },
      { type: 'planter', name: 'Planter east', position: [6.4, 0, -3.2] },
      { type: 'screen', name: 'Wall screen', position: [0, 0, -7.4], params: { width: 4.2, height: 2.2, lift: 1.2 } },
    ],
  },
  studio: { label: 'Night studio', note: 'Dark room with light arches', preset: 'studio', props: [] },
  empty: { label: 'Empty cove', note: 'Walls, floor and the car only', preset: 'cove', props: [], turntable: false },
};

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

  // id: library entry to open. A saved snapshot wins; otherwise the entry's template dresses a fresh level.
  async load(report, id = null) {
    const library = readLibrary();
    this.id = id && library.levels[id] ? id : library.active;
    const entry = library.levels[this.id];
    this.template = entry.template || 'lobby';
    this.name = entry.name || 'Lobby';
    await this.vehicle.load(report);
    this.vehicle.root.position.y = this.lobby.turntableHeight;
    this.stage.content.add(this.vehicle.root);
    this.configurator = new Configurator({ stage: this.stage, vehicle: this.vehicle, well: this.well, onChange: () => this.changed('finish') });
    applyDefaultFinish(this.vehicle);
    this.registerBuiltIns();
    for (const def of DEFAULT_HOTSPOTS) this.addHotspot(def, { silent: true });
    let restored = false;
    if (entry.snapshot) { try { this.restore(entry.snapshot); restored = true; } catch (e) { console.warn('Saved level ignored', e); } }
    if (!restored) this.dress(this.template);
    library.active = this.id;
    writeLibrary(library);
  }

  // A fresh level from a template: environment preset and starting props.
  dress(templateId) {
    const t = TEMPLATES[templateId] || TEMPLATES.lobby;
    this.lobby.usePreset(t.preset);
    for (const prop of t.props) this.addProp(prop.type, { ...prop, silent: true });
    if (t.turntable === false) { this.lobby.turntable.visible = false; }
    this.seatVehicle();
  }

  // Large props block the view like walls do; small ones (plinths, lamps, benches) never push the camera in.
  occluders() {
    const list = [];
    if (this.lobby.walls.visible) list.push(this.lobby.walls);
    for (const p of this.byGroup('props')) {
      if (!p.object.visible || !this.custom.visible) continue;
      const box = new THREE.Box3().setFromObject(p.object);
      if (box.max.y - box.min.y > 1.6 && Math.max(box.max.x - box.min.x, box.max.z - box.min.z) > 1.2) list.push(p.object);
    }
    return list;
  }

  // ------------------------------------------------------------------------------------------ built-ins
  registerBuiltIns() {
    const L = this.lobby;
    const env = (id, kind, name, object, extra = {}) => this.placements.push({ id, kind, name, group: 'environment', object, builtIn: true, ...extra });
    env('sky', 'sky', 'Sky', L.sky, { icon: 'sky', note: 'Gradient dome' });
    env('sun', 'sun', 'Sun', L.sun, { icon: 'sun', note: 'Shadow-casting key light' });
    env('floor', 'floor', 'Floor', L.floor, { icon: 'floor', note: 'Glossy reflective floor' });
    env('walls', 'walls', 'Cyclorama', L.walls, { icon: 'wall', note: 'Curved wall with floor cove · turn to aim the opening', movable: true, rotatable: true, pick: [L.walls] });
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

  // ----------------------------------------------------------------------------------------------- props
  // A prop is a holder (transform, picked as one) around the built geometry; edits rebuild the inside only.
  addProp(type, opts = {}) {
    const def = PROPS[type];
    if (!def) return null;
    const holder = new THREE.Group();
    holder.position.set(...(opts.position || [-4.2, 0, 2.2]));
    if (opts.rotationY) holder.rotation.y = opts.rotationY;
    if (opts.scale) holder.scale.set(...opts.scale);
    this.custom.add(holder);
    const p = { id: opts.id || newId('prop'), kind: 'prop', name: opts.name || def.label, group: 'props', object: holder, icon: def.icon, movable: true, rotatable: true, scalable: true, removable: true, pick: [holder] };
    const surfaceId = opts.surface && SURFACES[opts.surface] ? opts.surface : opts.surface === 'custom' ? 'custom' : def.surface;
    const base = SURFACES[surfaceId] || SURFACES[def.surface];
    p.data = {
      type,
      params: { ...defaultParams(type), ...(opts.params || {}) },
      surface: surfaceId,
      colour: opts.colour || base.colour, roughness: opts.roughness ?? base.roughness, metalness: opts.metalness ?? base.metalness,
    };
    if (opts.shown === false) holder.visible = false;
    this.buildProp(p);
    this.placements.push(p);
    if (!opts.silent) this.changed('add');
    return p;
  }

  buildProp(p) {
    const def = PROPS[p.data.type];
    for (const c of [...p.object.children]) { p.object.remove(c); c.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } }); }
    const preset = SURFACES[p.data.surface] || {};
    const mat = surfaceMaterial({ ...preset, colour: p.data.colour, roughness: p.data.roughness, metalness: p.data.metalness });
    p.material = mat;
    const built = def.build(p.data.params, mat, p);
    p.object.add(built);
    p.object.name = p.name;
    p.icon = def.icon;
    p.note = `${def.label} · ${Object.entries(def.params).slice(0, 3).map(([k, d]) => `${(+p.data.params[k]).toFixed(d.step < 0.1 ? 2 : 1)}${d.unit === 'm' ? '' : d.unit}`).join(' × ')}${def.params.width || def.params.radius ? ' m' : ''}`;
  }

  setPropType(p, type) {
    if (!PROPS[type]) return;
    const keepName = p.name !== PROPS[p.data.type].label;
    p.data.type = type;
    p.data.params = defaultParams(type);
    if (!keepName) p.name = PROPS[type].label;
    this.buildProp(p);
    this.changed('rename');
  }

  setPropParam(p, key, value) { p.data.params[key] = value; this.buildProp(p); this.changed('edit'); }

  setPropSurface(p, surfaceId) {
    const s = SURFACES[surfaceId];
    if (!s) return;
    Object.assign(p.data, { surface: surfaceId, colour: s.colour, roughness: s.roughness, metalness: s.metalness });
    this.buildProp(p);
    this.changed('edit');
  }

  // Surface sliders/colour on a prop (or an imported model).
  setSurface(p, key, value) {
    p.data[key] = value;
    if (p.kind === 'prop') {
      p.data.surface = 'custom';
      const m = p.material;
      if (key === 'colour') m.color.set(value);
      if (key === 'roughness') m.roughness = value;
      if (key === 'metalness') m.metalness = value;
    } else {
      const mats = Array.isArray(p.mesh.material) ? p.mesh.material : [p.mesh.material];
      for (const m of mats) {
        if (key === 'colour') m.color.set(value);
        if (key === 'roughness') m.roughness = value;
        if (key === 'metalness') m.metalness = value;
      }
    }
    this.changed('edit');
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
    if (p.kind === 'prop') return this.addProp(p.data.type, { ...JSON.parse(JSON.stringify(p.data)), name: p.name, position: r3(p.object.position.clone().add(new THREE.Vector3(0.8, 0, 0.8))), rotationY: p.object.rotation.y, scale: r3(p.object.scale) });
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
      format: 'Frontier.Level', version: 2, name: this.name, template: this.template, tier: this.tier,
      lobby: this.lobby.settings,
      vehicle: { finish: v.finish, colours },
      transforms, visibility,
      hotspots: this.byGroup('vehicle').filter((p) => p.kind === 'hotspot').map((p) => ({ id: p.id, zone: p.spot.zone, anchor: r3(p.object.position), view: p.spot.view })),
      lights: this.byGroup('lights').map((p) => ({ id: p.id, kind: p.kind, name: p.name, position: r3(p.object.position), rotationY: p.object.rotation.y, ...p.data })),
      props: this.byGroup('props').map((p) => ({ id: p.id, name: p.name, type: p.data.type, params: p.data.params, surface: p.data.surface, colour: p.data.colour, roughness: p.data.roughness, metalness: p.data.metalness, position: r3(p.object.position), rotationY: +p.object.rotation.y.toFixed(4), scale: r3(p.object.scale), shown: p.object.visible })),
    };
  }

  restore(s) {
    if (!s || s.format !== 'Frontier.Level') return;
    this.name = s.name || this.name;
    this.template = s.template || this.template;
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
    // Version 1 saves kept premium "shapes"; they come back as props of the same type.
    const legacy = (s.shapes || []).map((sh) => ({ ...sh, type: String(sh.kind).replace('shape-', ''), surface: 'custom' }));
    for (const pr of [...(s.props || []), ...legacy]) if (PROPS[pr.type]) this.addProp(pr.type, { ...pr, silent: true });
    if (!s.props) for (const prop of (TEMPLATES[s.template] || TEMPLATES.lobby).props) this.addProp(prop.type, { ...prop, silent: true });
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

  save() {
    const library = readLibrary();
    const entry = library.levels[this.id] || (library.levels[this.id] = { template: this.template });
    entry.name = this.name;
    entry.snapshot = this.snapshot();
    entry.summary = { preset: this.lobby.settings.preset, props: this.byGroup('props').length, dots: this.counts.hotspots, lights: this.byGroup('lights').length };
    entry.saved = Date.now();
    writeLibrary(library);
  }

  queueSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 400);
  }

  get counts() {
    return { placements: this.placements.length, hotspots: this.placements.filter((p) => p.kind === 'hotspot').length, lights: this.byGroup('lights').length, props: this.byGroup('props').length, custom: this.byGroup('custom').length };
  }
}

// ------------------------------------------------------------------------------------------------ level library
// { active, order: [id], levels: { id: { name, template, snapshot, summary, saved } } } in localStorage.
export function readLibrary() {
  let lib = null;
  try { lib = JSON.parse(localStorage.getItem(LIBRARY_KEY) || 'null'); } catch { lib = null; }
  if (!lib || !lib.levels || !Object.keys(lib.levels).length) {
    let legacy = null;
    try { legacy = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { legacy = null; }
    lib = { active: 'lobby', order: ['lobby'], levels: { lobby: { name: 'Lobby', template: 'lobby', snapshot: legacy && legacy.format === 'Frontier.Level' ? legacy : null } } };
  }
  lib.order = (lib.order || []).filter((id) => lib.levels[id]);
  for (const id of Object.keys(lib.levels)) if (!lib.order.includes(id)) lib.order.push(id);
  if (!lib.levels[lib.active]) lib.active = lib.order[0];
  return lib;
}

export function writeLibrary(lib) {
  try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib)); } catch { /* storage full or blocked */ }
}

export function createLevelEntry(lib, { name, template = 'lobby', snapshot = null }) {
  const id = `level-${Date.now().toString(36)}`;
  lib.levels[id] = { name, template, snapshot };
  lib.order.push(id);
  return id;
}
