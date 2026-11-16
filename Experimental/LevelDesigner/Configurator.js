// Lobby configurator: small dots on the car. Pressing one flies the camera to that part (the tyres, the paint, the
// wing…) and opens a strip of swatches for it — the only interface the Lobby itself shows. Zones say which part and
// material family a swatch row repaints; hotspot anchors are body-local (Y-up, +X forward) and can be moved in the
// Level Designer like any other placement.
import { THREE } from '../Shared/Studio/Render.js';
import { el } from '../Shared/Studio/Ui.js';
import { FINISHES } from './Vehicle.js';

const sw = (name, hex) => ({ name, hex });
// Colours round-trip through linear space, so compare within a couple of steps per channel.
export function sameColour(a, b) {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  return [16, 8, 0].every((s) => Math.abs(((x >> s) & 255) - ((y >> s) & 255)) <= 2);
}
// Showroom defaults: every swatch row starts on its first swatch.
export function applyDefaultFinish(vehicle) {
  for (const zone of Object.values(ZONES)) for (const row of zone.rows) {
    if (!row.targets) continue;
    for (const [part, family] of row.targets) vehicle.setColour(part, family, row.swatches[0].hex);
  }
}
// A car's configuration as plain data (what a player shares with the lobby): one colour per swatch row + the finish.
export function configOf(vehicle) {
  const colours = {};
  for (const zone of Object.values(ZONES)) for (const row of zone.rows) {
    if (!row.targets) continue;
    const [part, family] = row.targets[0];
    colours[`${part}:${family}`] = vehicle.colour(part, family);
  }
  return { finish: vehicle.finish, colours };
}
export function applyConfig(vehicle, config) {
  if (!config) return;
  for (const zone of Object.values(ZONES)) for (const row of zone.rows) {
    if (!row.targets) continue;
    const [part, family] = row.targets[0];
    const hex = config.colours && config.colours[`${part}:${family}`];
    if (hex) for (const [p, f] of row.targets) vehicle.setColour(p, f, hex);
  }
  if (config.finish) vehicle.setFinish(config.finish);
}
// A plausible configuration a player might pick: a paint, matching rims and lamps, mostly showroom-tasteful.
export function randomConfig(random = Math.random) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const colours = {};
  for (const zone of Object.values(ZONES)) for (const row of zone.rows) {
    if (!row.targets) continue;
    const [part, family] = row.targets[0];
    colours[`${part}:${family}`] = (zone === ZONES.lights && random() < 0.7 ? row.swatches[0] : pick(row.swatches)).hex;
  }
  return { finish: pick(['gloss', 'gloss', 'metallic', 'satin', 'matte']), colours };
}
export const ZONES = {
  paint: {
    label: 'Paint', kicker: 'Body colour',
    rows: [
      { label: 'Colour', targets: [['body', 6], ['wing', 6]], swatches: [sw('Acid lime', '#d9e61f'), sw('Glacier white', '#eef0f2'), sw('Liquid silver', '#b9bec5'), sw('Ice blue', '#8fb0d6'), sw('Deep teal', '#1f5a55'), sw('Racing yellow', '#f2c300'), sw('Signal red', '#c4161c'), sw('Obsidian', '#141518')] },
      { label: 'Finish', finish: true },
    ],
  },
  wheels: {
    label: 'Wheels', kicker: 'Rims and tyres',
    rows: [
      { label: 'Rim', targets: [['rim', 9]], swatches: [sw('Satin black', '#151618'), sw('Gunmetal', '#3b3f45'), sw('Silver', '#c2c6cc'), sw('Bronze', '#8a6a3e'), sw('White', '#e6e6e6')] },
      { label: 'Hub', targets: [['rim', 10]], swatches: [sw('Cobalt', '#1f4fbf'), sw('Lime', '#c6dc1a'), sw('Red', '#c81e1e'), sw('Gold', '#c8a040'), sw('Black', '#111111')] },
      { label: 'Tyre', targets: [['tyre', 9]], swatches: [sw('Carbon black', '#151515'), sw('Graphite', '#34363a'), sw('Tan wall', '#8b6d4a'), sw('Chalk', '#d9d6cf')] },
    ],
  },
  glass: {
    label: 'Glass', kicker: 'Window tint',
    rows: [{ label: 'Tint', targets: [['body', 7]], swatches: [sw('Night', '#08090a'), sw('Smoke', '#2a2c30'), sw('Bronze', '#3a2a1a'), sw('Blue', '#13263a'), sw('Clear', '#5a6670')] }],
  },
  wing: {
    label: 'Rear wing', kicker: 'Aero',
    rows: [
      { label: 'Plane', targets: [['wing', 8]], swatches: [sw('Carbon', '#111215'), sw('Gloss white', '#eceff2'), sw('Silver', '#b9bec5'), sw('Red', '#c4161c')] },
      { label: 'Pylons', targets: [['wing', 10]], swatches: [sw('Cobalt', '#1f4fbf'), sw('Black', '#111111'), sw('Gold', '#c8a040'), sw('Silver', '#c2c6cc')] },
    ],
  },
  lights: {
    label: 'Lights', kicker: 'Lamp colour',
    rows: [
      { label: 'Head', targets: [['body', 13]], swatches: [sw('Pure white', '#ffffff'), sw('Warm', '#ffd9a0'), sw('Ice', '#a8d8ff'), sw('Amber', '#ffb238')] },
      { label: 'Tail', targets: [['body', 14]], swatches: [sw('Red', '#ff1a1a'), sw('Deep red', '#9a0a0a'), sw('Magenta', '#ff2a6a')] },
    ],
  },
  trim: {
    label: 'Trim', kicker: 'Lower body and grille',
    rows: [
      { label: 'Cladding', targets: [['body', 8]], swatches: [sw('Black', '#0f1114'), sw('Graphite', '#33363b'), sw('Silver', '#9aa0a8'), sw('Body', '#d9e61f')] },
      { label: 'Grille', targets: [['body', 12]], swatches: [sw('Silver', '#c9cdd2'), sw('Black', '#111111'), sw('Bronze', '#8a6a3e')] },
    ],
  },
};

// Default dots: body-local anchor (metres) and a camera view relative to the car (yaw / pitch in degrees).
export const DEFAULT_HOTSPOTS = [
  { id: 'hs-paint', zone: 'paint', anchor: [0.15, 0.64, 1.26], view: { yaw: 14, pitch: 7, distance: 6.4, target: [0.1, 0.55, 0] } },
  { id: 'hs-wheels', zone: 'wheels', anchor: [1.7274, 0.42, 1.27], view: { yaw: 12, pitch: 5, distance: 2.5, target: [1.7274, 0.09, 1.05] } },
  { id: 'hs-glass', zone: 'glass', anchor: [0.15, 1.08, 1.0], view: { yaw: 32, pitch: 20, distance: 4.2, target: [0.3, 1.0, 0.4] } },
  { id: 'hs-wing', zone: 'wing', anchor: [-2.98, 1.14, 0.7], view: { yaw: -62, pitch: 18, distance: 3.4, target: [-2.95, 1.05, 0] } },
  { id: 'hs-lights', zone: 'lights', anchor: [3.07, 0.56, 0.92], view: { yaw: 66, pitch: 5, distance: 3, target: [2.9, 0.5, 0.55] } },
  { id: 'hs-trim', zone: 'trim', anchor: [-0.9, 0.16, 1.27], view: { yaw: 4, pitch: 3, distance: 3.6, target: [-0.6, 0.2, 1.0] } },
];

export class Configurator {
  constructor({ stage, vehicle, well, onPick = null, onChange = () => {} }) {
    this.stage = stage;
    this.vehicle = vehicle;
    this.well = well;
    this.onPick = onPick;           // design mode: a dot press selects the hotspot instead of opening it
    this.onChange = onChange;
    this.spots = [];
    this.active = null;
    this.visible = true;
    this.layer = el('div', { class: 'ld-spots' });
    this.tray = el('div', { class: 'ld-config', hidden: true });
    well.append(this.layer, this.tray);
    this.raycaster = new THREE.Raycaster();
    this.occlusionClock = 0;
    stage.frameCallbacks.add((dt) => this.tick(dt));
  }

  add(def) {
    const zone = ZONES[def.zone];
    const marker = new THREE.Object3D();
    marker.name = `Hotspot ${zone.label}`;
    marker.position.set(...def.anchor);
    this.vehicle.body.add(marker);
    const dot = el('button', { type: 'button', class: 'ld-dot', title: zone.label, 'aria-label': `Configure ${zone.label}` }, el('i'), el('span', {}, zone.label));
    const spot = { ...def, view: { ...def.view }, zoneDef: zone, marker, dot, shown: def.shown !== false, occluded: false };
    dot.addEventListener('pointerdown', (e) => e.stopPropagation());
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onPick && this.onPick(spot)) return;
      this.focus(spot);
    });
    this.layer.append(dot);
    this.spots.push(spot);
    return spot;
  }

  remove(spot) {
    if (this.active === spot) this.close(false);
    spot.marker.parent && spot.marker.parent.remove(spot.marker);
    spot.dot.remove();
    this.spots = this.spots.filter((s) => s !== spot);
  }

  // ------------------------------------------------------------------------------------------------ focus
  viewOf(spot) {
    const root = this.vehicle.root;
    const target = new THREE.Vector3(...(spot.view.target || spot.anchor));
    this.vehicle.body.localToWorld(target);
    const yaw = THREE.MathUtils.degToRad(spot.view.yaw) + root.rotation.y + (this.extraYaw ? this.extraYaw() : 0);
    return { target, yaw, pitch: THREE.MathUtils.degToRad(spot.view.pitch), distance: spot.view.distance };
  }

  focus(spot) {
    const rig = this.stage.rig;
    if (!this.active) this.home = { target: rig.goal.target.clone(), yaw: rig.goal.yaw, pitch: rig.goal.pitch, distance: rig.goal.distance };
    this.active = spot;
    rig.turntable = false;
    rig.flyTo(this.viewOf(spot), { duration: 1.05 });
    this.renderTray();
    this.layer.classList.add('focused');
    for (const s of this.spots) s.dot.classList.toggle('active', s === spot);
  }

  close(fly = true) {
    if (!this.active) return;
    this.active = null;
    this.tray.hidden = true;
    this.layer.classList.remove('focused');
    for (const s of this.spots) s.dot.classList.remove('active');
    if (fly && this.home) this.stage.rig.flyTo(this.home, { duration: 0.9 });
  }

  step(dir) {
    const list = this.spots.filter((s) => s.shown);
    if (!list.length) return;
    const i = Math.max(0, list.indexOf(this.active));
    this.focus(list[(i + dir + list.length) % list.length]);
  }

  renderTray() {
    const spot = this.active, zone = spot.zoneDef, v = this.vehicle;
    const rows = zone.rows.map((row) => {
      if (row.finish) {
        const pills = Object.entries(FINISHES).map(([id, f]) => {
          const b = el('button', { type: 'button', class: `ld-pill${v.finish === id ? ' on' : ''}` }, f.label);
          b.addEventListener('click', () => { v.setFinish(id); this.onChange(); this.renderTray(); });
          return b;
        });
        return el('div', { class: 'ld-row' }, el('small', {}, row.label), el('div', { class: 'ld-pills' }, pills));
      }
      const [part, family] = row.targets[0];
      const current = v.colour(part, family);
      const chips = row.swatches.map((s) => {
        const b = el('button', { type: 'button', class: `ld-swatch${sameColour(current, s.hex) ? ' on' : ''}`, title: s.name, style: `--c:${s.hex}` });
        b.addEventListener('click', () => {
          for (const [p, f] of row.targets) v.setColour(p, f, s.hex);
          this.onChange();
          this.renderTray();
        });
        return b;
      });
      const name = (row.swatches.find((s) => sameColour(current, s.hex)) || { name: 'Custom' }).name;
      return el('div', { class: 'ld-row' }, el('small', {}, row.label), el('div', { class: 'ld-swatches' }, chips), el('em', {}, name));
    });
    const prev = el('button', { type: 'button', class: 'ld-nav', title: 'Previous', 'aria-label': 'Previous part', html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>' });
    const next = el('button', { type: 'button', class: 'ld-nav', title: 'Next', 'aria-label': 'Next part', html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>' });
    const done = el('button', { type: 'button', class: 'ld-nav close', title: 'Back to the car (Esc)', 'aria-label': 'Close', html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>' });
    prev.addEventListener('click', () => this.step(-1));
    next.addEventListener('click', () => this.step(1));
    done.addEventListener('click', () => this.close());
    this.tray.replaceChildren(
      el('header', {}, prev, el('div', {}, el('small', {}, zone.kicker), el('b', {}, zone.label)), next, done),
      ...rows,
    );
    this.tray.hidden = false;
  }

  // ------------------------------------------------------------------------------------------------- frame
  tick(dt) {
    const cam = this.stage.camera;
    const rect = this.well.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    this.occlusionClock -= dt;
    const checkOcclusion = this.occlusionClock <= 0;
    if (checkOcclusion) this.occlusionClock = 0.12;
    const p = new THREE.Vector3();
    for (const s of this.spots) {
      s.marker.getWorldPosition(p);
      const world = p.clone();
      p.project(cam);
      const behind = p.z > 1 || p.z < -1;
      if (checkOcclusion && !behind) {
        const dir = world.clone().sub(cam.position);
        const dist = dir.length();
        this.raycaster.set(cam.position, dir.normalize());
        this.raycaster.far = dist - 0.06;
        s.occluded = this.raycaster.intersectObjects(this.vehicle.meshes, false).length > 0;
      }
      const show = this.visible && s.shown && !behind;
      s.dot.hidden = !show;
      if (!show) continue;
      s.dot.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px)`;
      s.dot.classList.toggle('occluded', s.occluded);
    }
  }
}
