// A level as the Level Designer edits it: the Lobby environment (set, floor, sky, sun), the configurable vehicle with
// its hotspots, light fixtures, scene pieces and (for Premium) imported models. Each thing in the level is a Placement
// record { id, kind, name, group, object, … }; the outliner, picking, the gizmo and the Details panel all work from
// that list. Fixtures and pieces are "kits": a type + parameters (+ a finish for pieces), rebuilt inside a holder so
// their transform survives edits. Levels save into a library in localStorage and export as JSON.
import { THREE } from '../Shared/Studio/Render.js';
import { readGeometry, formatOf } from '../Shared/GeometryCompile/Engine/ImportFormats.js';
import { Lobby, defaultLobbySettings, SETS, FLOORS, SHADOW_LAYER } from './Lobby.js';
import { ControlVehicle, geometryFromRaw } from './Vehicle.js';
import { PIECES, CATEGORIES, defaultPieceParams } from './Items.js';
import { FIXTURES, RIGS, defaultFixtureParams, aimAt, headHeight } from './Fixtures.js';
import { FINISHES, finish } from './Kit.js';
import { Configurator, DEFAULT_HOTSPOTS, ZONES, applyDefaultFinish } from './Configurator.js';

export const STORAGE_KEY = 'Frontier.LevelDesigner.Lobby.v1';      // first build's single save (no longer read)
export const LIBRARY_KEY = 'Frontier.LevelDesigner.Levels.v2';

export const GROUPS = [
  { id: 'environment', label: 'Environment', icon: 'sun', note: 'Set, floor, sky, sun, turntable' },
  { id: 'vehicle', label: 'Vehicle', icon: 'vehicle', note: 'Configurable car and its dots' },
  { id: 'lights', label: 'Lights', icon: 'softbox', note: 'Fixtures · area lights, spots, pendants' },
  { id: 'pieces', label: 'Scene', icon: 'tree', note: 'Trees, furniture, garage kit, architecture' },
  { id: 'custom', label: 'Your models', icon: 'sparkle', note: 'Premium · imported models' },
];

// Things that can be added. `premium` ones need the Premium tier.
export const ADDABLE = [
  ...Object.entries(FIXTURES).map(([type, d]) => ({ kind: `fixture:${type}`, label: d.label, icon: d.icon, group: 'Lights', note: d.note })),
  { kind: 'hotspot', label: 'Configurator dot', icon: 'dot', group: 'Vehicle', note: 'Another dot on the car' },
  ...CATEGORIES.flatMap((c) => Object.entries(PIECES).filter(([, d]) => d.category === c.id).map(([type, d]) => ({ kind: `piece:${type}`, label: d.label, icon: d.icon, group: c.label, note: d.note }))),
  { kind: 'import', label: 'Import model…', icon: 'upload', group: 'Your models', premium: true, note: 'OBJ · glTF · GLB · STL · PLY · FCT1' },
];

// New-level templates: a set, a floor, a light rig and the pieces that dress it.
export const TEMPLATES = {
  studio: {
    label: 'Studio', note: 'Grey cove, softbox rig', set: 'studio', rig: 'softbox',
    pieces: [],
  },
  stage: {
    label: 'Night stage', note: 'Lacquer floor, glowing platform, fresnel spots and haze', set: 'studio', floor: 'glossBlack', rig: 'drama',
    pieces: [{ type: 'platform', name: 'Stage', position: [0, 0, 0], params: { width: 9, depth: 6, height: 0.12, corner: 1.2, glow: true }, finish: 'glossBlack' }],
    turntableOnStage: true,
  },
  garage: {
    label: 'Garage', note: 'Workshop with lift, tool chest, tyres and battens', set: 'garage', rig: 'workshop',
    pieces: [
      { type: 'lift', name: 'Lift bay 2', position: [-7.8, 0, -1.5], rotationY: Math.PI / 2 },
      { type: 'toolchest', name: 'Tool chest', position: [-11.9, 0, 4.5], rotationY: Math.PI / 2 },
      { type: 'workbench', name: 'Workbench', position: [-12.2, 0, 1.2], rotationY: Math.PI / 2, params: { length: 2.6 } },
      { type: 'tyres', name: 'Tyre stack', position: [10.8, 0, -6.5], params: { count: 5 } },
      { type: 'tyres', name: 'Tyre stack 2', position: [11.6, 0, -4.9], params: { count: 3, seed: 7, leaning: false } },
      { type: 'drum', name: 'Oil drum', position: [11.9, 0, 6.6] },
      { type: 'drum', name: 'Oil drum 2', position: [11.3, 0, 7.3], finish: 'redEnamel', params: { label: false } },
      { type: 'cone', name: 'Cone', position: [5.6, 0, 5.4] },
      { type: 'cone', name: 'Cone 2', position: [-5.6, 0, 5.4] },
    ],
  },
  atrium: {
    label: 'Minimal architecture', note: 'Concrete atrium, skylight, tree, lounge corner', set: 'atrium', rig: 'daylight',
    pieces: [
      { type: 'tree', name: 'Atrium tree', position: [-7.6, 0, -4.2], params: { height: 5.6, crown: 1.7, planter: true, seed: 3 } },
      { type: 'lounge', name: 'Lounge chair', position: [8.4, 0, 5.4], rotationY: -2.4 },
      { type: 'lounge', name: 'Lounge chair 2', position: [9.9, 0, 3.6], rotationY: -1.9 },
      { type: 'coffee', name: 'Coffee table', position: [8.6, 0, 3.4] },
      { type: 'rug', name: 'Rug', position: [9, 0, 4.2], rotationY: 0.5, params: { width: 3.4, depth: 2.6, round: true }, finish: 'fabricSlate' },
      { type: 'grass', name: 'Grass', position: [-9.8, 0, 3.2], params: { spread: 1.6 } },
      { type: 'rock', name: 'Boulder', position: [-8.7, 0, 2.2], params: { size: 1.1 } },
    ],
  },
  pavilion: {
    label: 'Glass pavilion', note: 'Marble floor, gallery tracks, reception and plants', set: 'pavilion', rig: 'gallery',
    pieces: [
      { type: 'desk', name: 'Reception', position: [-7, 0, -4.6], rotationY: 0.6 },
      { type: 'sofa', name: 'Sofa', position: [7.4, 0, -5.4], rotationY: -0.4 },
      { type: 'coffee', name: 'Coffee table', position: [7.2, 0, -3.9] },
      { type: 'plant', name: 'Plant', position: [-9.6, 0, 5.6], params: { height: 1.8, pot: 0.6 } },
      { type: 'plant', name: 'Plant 2', position: [9.6, 0, 5.6], params: { height: 1.5, seed: 8 } },
      { type: 'screen', name: 'Screen', position: [0, 0, -6.8], params: { width: 3, lift: 0.9 } },
      { type: 'barrier', name: 'Barrier', position: [0, 0, 4.6], params: { span: 4.2 } },
    ],
  },
  open: {
    label: 'Open floor', note: 'Concrete to the horizon, daylight', set: 'horizon', rig: 'daylight',
    pieces: [],
  },
};

const r3 = (v) => [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)];
let serial = 1;
const newId = (kind) => `${kind}-${Date.now().toString(36)}-${serial++}`;
const CAR_CENTRE = [0, 0.75, 0];

export class Level {
  constructor(stage, well) {
    this.stage = stage;
    this.well = well;
    this.name = 'Studio';
    this.tier = 'basic';
    this.placements = [];
    this.listeners = new Set();
    this.lobby = new Lobby(stage, defaultLobbySettings('studio'));
    this.vehicle = new ControlVehicle();
    this.helpers = new THREE.Group();
    this.helpers.name = 'Helpers';
    stage.scene.add(this.helpers);
    this.custom = new THREE.Group();
    this.custom.name = 'Placements';
    stage.scene.add(this.custom);
    this.hardware = true;                 // fixture housings and stands visible (the lights work either way)
    stage.frameCallbacks.add(() => this.tick());
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed(what = 'scene') {
    if (['add', 'remove', 'edit', 'transform', 'visibility'].includes(what)) this.lobby.queueEnvironment();
    for (const fn of this.listeners) fn(what);
    this.queueSave();
  }

  async load(report, id = null) {
    const library = readLibrary();
    this.id = id && library.levels[id] ? id : library.active;
    const entry = library.levels[this.id];
    this.template = entry.template || 'studio';
    this.name = entry.name || 'Studio';
    await this.vehicle.load(report);
    this.vehicle.root.position.y = this.lobby.turntableHeight;
    this.stage.content.add(this.vehicle.root);
    for (const m of this.vehicle.meshes) m.layers.enable(SHADOW_LAYER);
    this.lobby.shadowTarget = this.vehicle.root;
    this.lobby.bakeHidden = () => [this.vehicle.root, this.helpers];
    this.configurator = new Configurator({ stage: this.stage, vehicle: this.vehicle, well: this.well, onChange: () => this.changed('finish') });
    applyDefaultFinish(this.vehicle);
    this.registerBuiltIns();
    for (const def of DEFAULT_HOTSPOTS) this.addHotspot(def, { silent: true });
    let restored = false;
    if (entry.snapshot) { try { this.restore(entry.snapshot); restored = true; } catch (e) { console.warn('Saved level ignored', e); } }
    if (!restored) this.dress(this.template);
    this.refreshBuiltInNotes();
    library.active = this.id;
    writeLibrary(library);
  }

  // A fresh level from a template.
  dress(templateId) {
    const t = TEMPLATES[templateId] || TEMPLATES.studio;
    this.lobby.useSet(t.set);
    if (t.floor) this.lobby.useFloor(t.floor);
    this.applyRig(t.rig, { silent: true });
    for (const piece of t.pieces) this.addPiece(piece.type, { ...piece, silent: true });
    if (t.turntableOnStage) this.lobby.turntable.position.y = 0.12;
    this.seatVehicle();
  }

  // Replace every fixture with a rig's fixtures, aimed at the car.
  applyRig(rigId, { silent = false } = {}) {
    const rig = RIGS[rigId];
    if (!rig) return;
    for (const p of this.byGroup('lights')) this.remove(p, { silent: true });
    for (const f of rig.fixtures) this.addFixture(f.type, { ...f, silent: true });
    const setDef = SETS[this.lobby.settings.set];
    this.lobby.settings.rig = rigId;
    // Daylight rigs keep the design's sun (and lift the ambient in a closed room that has none); fixture rigs dim the
    // sun so the fixtures read as the key.
    const S = this.lobby.settings, sunny = setDef.sun.on !== false && setDef.sun.intensity > 0;
    S.sun.intensity = +(setDef.sun.intensity * (rig.sun ? 1 : 0.35)).toFixed(3);
    S.sun.on = setDef.sun.on;
    S.ambient.intensity = +(setDef.ambient.intensity * (rig.ambient ?? 1) * (rig.sun && !sunny ? 4 : 1)).toFixed(3);
    this.lobby.applySun();
    this.lobby.applyAmbient();
    if (!silent) this.changed('add');
  }

  // Large pieces block the view like walls do; small ones never push the camera in.
  occluders() {
    const list = this.lobby.set.visible ? [...this.lobby.occluders] : [];
    for (const p of this.byGroup('pieces')) {
      if (!p.object.visible) continue;
      const box = new THREE.Box3().setFromObject(p.object);
      if (box.max.y - box.min.y > 2.2 && Math.max(box.max.x - box.min.x, box.max.z - box.min.z) > 2) list.push(p.object);
    }
    return list;
  }

  // ------------------------------------------------------------------------------------------ built-ins
  registerBuiltIns() {
    const L = this.lobby;
    const env = (id, kind, name, object, extra = {}) => this.placements.push({ id, kind, name, group: 'environment', object, builtIn: true, ...extra });
    env('set', 'set', 'Set', L.set, { icon: 'wall', note: 'Room architecture' });
    env('floor', 'floor', 'Floor', L.floor, { icon: 'floor', note: 'Finish over a live mirror' });
    env('sky', 'sky', 'Sky', L.sky, { icon: 'sky', note: 'Gradient dome' });
    env('sun', 'sun', 'Sun', L.sun, { icon: 'sun', note: 'Shadow-casting daylight' });
    env('turntable', 'turntable', 'Turntable', L.turntable, { icon: 'turntable', note: 'Display disc with a light ring', movable: true, pick: [L.disc] });
    this.placements.push({ id: 'vehicle', kind: 'vehicle', name: 'ControlVehicle', group: 'vehicle', object: this.vehicle.root, builtIn: true, icon: 'vehicle', note: 'Body · 4 wheels · rear wing', movable: true, rotatable: true, pick: this.vehicle.meshes });
    this.refreshBuiltInNotes();
  }

  refreshBuiltInNotes() {
    const L = this.lobby, set = this.get('set'), floor = this.get('floor');
    if (set) set.note = SETS[L.settings.set].label;
    if (floor) floor.note = FLOORS[L.settings.floor.preset].label;
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

  // --------------------------------------------------------------------------------------------- kits
  // Fixtures and pieces share one mechanism: a holder carries the transform; build() fills it from type + params.
  addKit(kind, type, opts = {}) {
    const lib = kind === 'fixture' ? FIXTURES : PIECES;
    const def = lib[type];
    if (!def) return null;
    const holder = new THREE.Group();
    holder.position.set(...(opts.position || [-4.2, 0, 2.2]));
    if (opts.rotationY) holder.rotation.y = opts.rotationY;
    if (opts.scale) holder.scale.set(...opts.scale);
    this.custom.add(holder);
    const params = { ...(kind === 'fixture' ? defaultFixtureParams(type) : defaultPieceParams(type)), ...(opts.params || {}) };
    const p = {
      id: opts.id || newId(kind), kind, name: opts.name || def.label, group: kind === 'fixture' ? 'lights' : 'pieces', object: holder, icon: def.icon,
      movable: true, rotatable: true, scalable: kind === 'piece', removable: true, pick: [holder],
      data: { type, params, finish: kind === 'piece' ? (opts.finish ?? (typeof def.finish === 'string' ? def.finish : 'default')) : null, colour: opts.colour || null },
    };
    if (kind === 'fixture') {
      if (opts.atCeiling && this.lobby.ceiling && params.hang !== undefined) params.hang = Math.min(params.hang, this.lobby.ceiling - 0.35);
      if (opts.aim) this.aim(p, { build: false });
    }
    if (opts.shown === false) holder.visible = false;
    this.buildKit(p);
    this.placements.push(p);
    if (!opts.silent) this.changed('add');
    return p;
  }
  addPiece(type, opts) { return this.addKit('piece', type, opts); }
  addFixture(type, opts) { return this.addKit('fixture', type, opts); }

  pieceMaterial(p) {
    const def = PIECES[p.data.type];
    const spec = p.data.finish === 'default' || !p.data.finish ? def.finish : p.data.finish;
    const recipe = typeof spec === 'string' ? { ...FINISHES[spec] } : { ...spec };
    if (p.data.colour) recipe.colour = p.data.colour;
    const size = Math.max(1, ...['width', 'length', 'height', 'size'].map((k) => p.data.params[k] || 0));
    return finish(recipe, { w: size, h: size, side: recipe.opacity ? THREE.DoubleSide : THREE.FrontSide });
  }

  buildKit(p) {
    for (const c of [...p.object.children]) { p.object.remove(c); disposeTree(c); }
    let built;
    if (p.kind === 'fixture') built = FIXTURES[p.data.type].build(p.data.params, { ceiling: this.lobby.ceiling });
    else built = PIECES[p.data.type].build(p.data.params, this.pieceMaterial(p), { ceiling: this.lobby.ceiling });
    p.object.add(built);
    p.object.name = p.name;
    p.icon = (p.kind === 'fixture' ? FIXTURES : PIECES)[p.data.type].icon;
    p.note = this.kitNote(p);
    if (p.kind === 'fixture') this.applyHardware(p);
  }

  kitNote(p) {
    const lib = p.kind === 'fixture' ? FIXTURES : PIECES, def = lib[p.data.type], q = p.data.params;
    if (p.kind === 'fixture') {
      const bits = [def.label];
      if (q.kelvin) bits.push(`${q.kelvin} K`);
      if (q.intensity !== undefined) bits.push(`${q.intensity}`);
      return bits.join(' · ');
    }
    const dims = Object.entries(def.params).filter(([, d]) => d.unit === 'm').slice(0, 3).map(([k]) => (+q[k]).toFixed(1));
    return dims.length ? `${def.label} · ${dims.join(' × ')} m` : def.label;
  }

  setKitType(p, type) {
    const lib = p.kind === 'fixture' ? FIXTURES : PIECES;
    if (!lib[type]) return;
    const keepName = p.name !== lib[p.data.type].label;
    p.data.type = type;
    p.data.params = p.kind === 'fixture' ? defaultFixtureParams(type) : defaultPieceParams(type);
    if (p.kind === 'piece') { p.data.finish = typeof PIECES[type].finish === 'string' ? PIECES[type].finish : 'default'; p.data.colour = null; }
    if (!keepName) p.name = lib[type].label;
    if (p.kind === 'fixture') this.aim(p, { build: false });
    this.buildKit(p);
    this.changed('rename');
  }

  setKitParam(p, key, value) { p.data.params[key] = value; this.buildKit(p); this.changed('edit'); }
  setPieceFinish(p, finishId) { p.data.finish = finishId; p.data.colour = null; this.buildKit(p); this.changed('edit'); }
  setPieceColour(p, hex) { p.data.colour = hex; this.buildKit(p); this.changed('edit'); }

  // Turn a fixture toward the car and tilt its head onto it.
  aim(p, { build = true } = {}) {
    const pos = r3(p.object.position);
    const head = headHeight(p.data.type, p.data.params);
    const t = aimAt(pos, CAR_CENTRE.map((v, i) => v + (i === 0 ? this.vehicle.root.position.x : i === 2 ? this.vehicle.root.position.z : 0)), head);
    if (Math.hypot(pos[0], pos[2]) > 0.3) p.object.rotation.y = t.yaw;
    if (p.data.params.tilt !== undefined) {
      const d = FIXTURES[p.data.type].params.tilt;
      p.data.params.tilt = Math.round(THREE.MathUtils.clamp(t.tilt, d.min, d.max));
    }
    if (build) { this.buildKit(p); this.changed('transform'); }
  }

  setHardware(on) {
    this.hardware = on;
    for (const p of this.byGroup('lights')) this.applyHardware(p);
    this.lobby.queueEnvironment();
  }

  // Housings/stands hidden or shown; glowing faces and the lights themselves stay.
  applyHardware(p) {
    p.object.traverse((o) => {
      if (!o.isMesh || o.userData.beam) return;
      const glowing = o.material && o.material.isMeshBasicMaterial;
      if (!glowing) o.visible = this.hardware;
    });
  }

  // Surface sliders/colour on an imported model.
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

  async importFile(file) {
    if (!formatOf(file.name)) throw new Error(`Unknown file type: ${file.name}`);
    const bytes = await file.arrayBuffer();
    const raw = readGeometry(file.name, bytes);
    const isFacet = /\.facet$/i.test(file.name);
    const { geometry, families } = geometryFromRaw(raw, { up: isFacet ? 'z' : 'y', normals: 'angle' });
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

  remove(p, { silent = false } = {}) {
    if (!p || !p.removable && p.kind !== 'hotspot') return false;
    if (p.kind === 'hotspot') this.configurator.remove(p.spot);
    else { p.object.parent && p.object.parent.remove(p.object); disposeTree(p.object); }
    this.placements = this.placements.filter((x) => x !== p);
    if (!silent) this.changed('remove');
    return true;
  }

  duplicate(p) {
    const offset = (d) => r3(p.object.position.clone().add(new THREE.Vector3(d, 0, d)));
    if (p.kind === 'fixture' || p.kind === 'piece') return this.addKit(p.kind, p.data.type, { ...JSON.parse(JSON.stringify(p.data)), name: `${p.name} copy`, position: offset(0.9), rotationY: p.object.rotation.y, scale: r3(p.object.scale) });
    if (p.kind === 'hotspot') return this.addHotspot({ id: newId('hs'), zone: p.spot.zone, anchor: r3(p.object.position.clone().add(new THREE.Vector3(-0.3, 0, 0))), view: { ...p.spot.view } });
    return null;
  }

  setVisible(p, on) {
    if (p.kind === 'hotspot') p.spot.shown = on;
    else if (p.kind === 'sun') { p.object.visible = on; this.lobby.applySun(); }
    else p.object.visible = on;
    if (p.kind === 'turntable') this.seatVehicle();
    this.changed('visibility');
  }

  isVisible(p) {
    if (p.kind === 'hotspot') return p.spot.shown;
    return p.object.visible;
  }

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

  pick(clientX, clientY) {
    const rect = this.stage.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.stage.camera);
    const pairs = this.pickables();
    const owner = new Map(pairs);
    const hits = ray.intersectObjects(pairs.map(([o]) => o), true).filter((h) => h.object.visible && !h.object.userData.beam);
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
      if (p.builtIn) visibility[p.id] = this.isVisible(p);
      if (p.movable && p.builtIn && p.kind !== 'hotspot') transforms[p.id] = { position: r3(p.object.position), rotationY: +p.object.rotation.y.toFixed(4) };
    }
    const kit = (p) => ({ id: p.id, name: p.name, type: p.data.type, params: p.data.params, finish: p.data.finish, colour: p.data.colour, position: r3(p.object.position), rotationY: +p.object.rotation.y.toFixed(4), scale: r3(p.object.scale), shown: p.object.visible });
    return {
      format: 'Frontier.Level', version: 3, name: this.name, template: this.template, tier: this.tier, hardware: this.hardware,
      lobby: this.lobby.settings,
      vehicle: { finish: v.finish, colours },
      transforms, visibility,
      hotspots: this.byGroup('vehicle').filter((p) => p.kind === 'hotspot').map((p) => ({ id: p.id, zone: p.spot.zone, anchor: r3(p.object.position), view: p.spot.view, shown: p.spot.shown })),
      fixtures: this.byGroup('lights').map(kit),
      pieces: this.byGroup('pieces').map(kit),
    };
  }

  restore(s) {
    if (!s || s.format !== 'Frontier.Level' || (s.version || 1) < 3) throw new Error('Older level format');
    this.name = s.name || this.name;
    this.template = s.template || this.template;
    this.tier = s.tier === 'premium' ? 'premium' : 'basic';
    this.hardware = s.hardware !== false;
    const L = this.lobby;
    for (const k of Object.keys(L.settings)) if (s.lobby && s.lobby[k] !== undefined) L.settings[k] = typeof L.settings[k] === 'object' && L.settings[k] ? { ...L.settings[k], ...s.lobby[k] } : s.lobby[k];
    if (s.lobby && s.lobby.rig) L.settings.rig = s.lobby.rig;
    if (!SETS[L.settings.set]) L.settings.set = 'studio';
    if (!FLOORS[L.settings.floor.preset]) L.settings.floor.preset = 'concrete';
    L.applyAll();
    const v = this.vehicle;
    if (s.vehicle) {
      for (const [key, hex] of Object.entries(s.vehicle.colours || {})) { const [part, f] = key.split(':'); v.setColour(part, +f, hex); }
      v.setFinish(s.vehicle.finish || 'gloss');
    }
    if (s.hotspots) {
      for (const p of this.byGroup('vehicle').filter((x) => x.kind === 'hotspot')) { this.configurator.remove(p.spot); this.placements = this.placements.filter((x) => x !== p); }
      for (const h of s.hotspots) if (ZONES[h.zone]) { const p = this.addHotspot(h, { silent: true }); if (h.shown === false) p.spot.shown = false; }
    }
    for (const f of s.fixtures || []) if (FIXTURES[f.type]) this.addFixture(f.type, { ...f, silent: true });
    for (const pc of s.pieces || []) if (PIECES[pc.type]) this.addPiece(pc.type, { ...pc, silent: true });
    for (const [id, t] of Object.entries(s.transforms || {})) {
      const p = this.get(id);
      if (!p) continue;
      p.object.position.set(...t.position);
      p.object.rotation.y = t.rotationY || 0;
    }
    for (const [id, on] of Object.entries(s.visibility || {})) {
      const p = this.get(id);
      if (!p) continue;
      if (p.kind === 'hotspot') p.spot.shown = on; else { p.object.visible = on; if (p.kind === 'sun') L.applySun(); }
    }
    this.refreshBuiltInNotes();
    this.seatVehicle();
    L.queueEnvironment();
  }

  save() {
    const library = readLibrary();
    const entry = library.levels[this.id] || (library.levels[this.id] = { template: this.template });
    entry.name = this.name;
    entry.snapshot = this.snapshot();
    entry.summary = { set: this.lobby.settings.set, pieces: this.byGroup('pieces').length, lights: this.byGroup('lights').length, dots: this.counts.hotspots };
    entry.saved = Date.now();
    writeLibrary(library);
  }

  queueSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 400);
  }

  get counts() {
    return { placements: this.placements.length, hotspots: this.placements.filter((p) => p.kind === 'hotspot').length, lights: this.byGroup('lights').length, pieces: this.byGroup('pieces').length, custom: this.byGroup('custom').length };
  }
}

function disposeTree(object) {
  object.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { for (const k of ['map', 'roughnessMap', 'bumpMap']) if (m[k]) m[k].dispose(); m.dispose(); }
    }
    if (o.isLight && o.shadow && o.shadow.map) o.shadow.map.dispose();
  });
}

// ------------------------------------------------------------------------------------------------ level library
// { active, order: [id], levels: { id: { name, template, snapshot, summary, saved } } } in localStorage.
export function readLibrary() {
  let lib = null;
  try { lib = JSON.parse(localStorage.getItem(LIBRARY_KEY) || 'null'); } catch { lib = null; }
  if (!lib || !lib.levels || !Object.keys(lib.levels).length) {
    lib = { active: 'studio', order: ['studio', 'garage', 'atrium', 'pavilion'], levels: {
      studio: { name: 'Studio', template: 'studio', snapshot: null },
      garage: { name: 'Garage', template: 'garage', snapshot: null },
      atrium: { name: 'Atrium', template: 'atrium', snapshot: null },
      pavilion: { name: 'Pavilion', template: 'pavilion', snapshot: null },
    } };
  }
  lib.order = (lib.order || []).filter((id) => lib.levels[id]);
  for (const id of Object.keys(lib.levels)) if (!lib.order.includes(id)) lib.order.push(id);
  if (!lib.levels[lib.active]) lib.active = lib.order[0];
  return lib;
}

export function writeLibrary(lib) {
  try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib)); } catch { /* storage full or blocked */ }
}

export function createLevelEntry(lib, { name, template = 'studio', snapshot = null }) {
  const id = `level-${Date.now().toString(36)}`;
  lib.levels[id] = { name, template, snapshot };
  lib.order.push(id);
  return id;
}
