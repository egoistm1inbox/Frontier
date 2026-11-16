// Level Designer workspace: outliner (left), viewport with select / move / turn tools (centre), Details (right), and
// the Lobby play mode that hides all of it and leaves only the configurator dots. Same docks, tabs, panels and
// controls as the Component Viewer (Shared/Studio).
import { THREE } from '../Shared/Studio/Render.js';
import { createCameraHud } from '../Shared/Studio/Camera.js';
import { MAX_PLAYERS } from './Session.js';
import { $, el, section, panel, rangeField, segmentedField, toggle, selectField, vec3Field, colorField, textField, metrics, toast, download } from '../Shared/Studio/Ui.js';
import { IMPORT_FORMATS } from '../Shared/GeometryCompile/Engine/ImportFormats.js';
import { icon, iconEl, hydrate } from './LevelIcons.js';
import { TransformGizmo } from './Gizmo.js';
import { GROUPS, ADDABLE, TEMPLATES, LIBRARY_KEY, readLibrary, writeLibrary, createLevelEntry } from './Level.js';
import { PIECES, CATEGORIES, PIECE_FINISHES } from './Items.js';
import { FIXTURES, RIGS } from './Fixtures.js';
import { FINISHES as SURFACE_FINISHES, kelvinColour } from './Kit.js';
import { SETS, FLOORS } from './Lobby.js';
import { surfaceSwatch } from './Textures.js';
import { ZONES, sameColour } from './Configurator.js';
import { FINISHES } from './Vehicle.js';

const KIND_LABEL = {
  sky: 'Sky dome', sun: 'Directional light', floor: 'Floor finish', set: 'Lobby design', turntable: 'Turntable',
  vehicle: 'Configurable vehicle', hotspot: 'Configurator dot', fixture: 'Light fixture', piece: 'Scene piece', import: 'Imported model', place: 'Player place',
};
const deg = THREE.MathUtils.radToDeg, rad = THREE.MathUtils.degToRad;

export function createLevelDesigner({ stage, level }) {
  const well = $('ViewportWell');
  const L = level.lobby;
  const state = { selected: null, tool: 'select', search: '', playing: false, dots: true, helpers: level.hardware, idleOrbit: true, contain: true, contentCat: 'nature', withRig: true };
  let live = null; // inputs refreshed while the gizmo drags

  // ------------------------------------------------------------------------------------------------- gizmo
  let lastTurntable = L.turntable.position.clone();
  const gizmo = new TransformGizmo(stage, well, {
    onChange(object) {
      const p = state.selected;
      if (p && p.kind === 'turntable') {
        // The car rides along when it is parked on the turntable.
        const delta = object.position.clone().sub(lastTurntable);
        const v = level.vehicle.root;
        if (Math.hypot(v.position.x - lastTurntable.x, v.position.z - lastTurntable.z) < L.settings.turntable.radius) v.position.add(delta);
        lastTurntable.copy(object.position);
      }
      refreshLive();
    },
    onCommit() {
      lastTurntable.copy(L.turntable.position);
      if (state.selected && state.selected.kind === 'walls') L.queueEnvironment();
      occluderClock = 0;
      level.changed('transform');
    },
  });

  L.hideInMirror.push(gizmo.root);

  function refreshLive() {
    const p = state.selected;
    if (!live || !p) return;
    const o = p.object;
    if (live.loc) ['x', 'y', 'z'].forEach((k, i) => { live.loc[i].value = +o.position[k].toFixed(3); });
    if (live.turn) { live.turn.value = Math.round(deg(o.rotation.y)); live.turnOut.textContent = `${Math.round(deg(o.rotation.y))}°`; }
  }

  function syncGizmo() {
    const p = state.selected;
    const can = p && !state.playing && ((state.tool === 'move' && p.movable) || (state.tool === 'rotate' && p.rotatable));
    gizmo.enabled = !state.playing;
    gizmo.setMode(state.tool === 'rotate' ? 'rotate' : 'move');
    gizmo.attach(can ? p.object : null);
  }

  // ---------------------------------------------------------------------------------------------- selection
  function select(p) {
    state.selected = p || null;
    for (const x of level.placements) if (x.kind === 'hotspot') x.spot.dot.classList.toggle('selected', x === p);
    syncGizmo();
    renderTree();
    renderDetails();
  }

  level.configurator.onPick = (spot) => {
    if (state.playing) return false;
    select(level.placements.find((p) => p.spot === spot));
    return true;
  };

  let press = null;
  well.addEventListener('pointerdown', (e) => { press = { x: e.clientX, y: e.clientY, button: e.button }; });
  well.addEventListener('pointerup', (e) => {
    if (!press || press.button !== 0 || e.target !== stage.canvas) { press = null; return; }
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    press = null;
    if (moved > 4) return;
    if (state.playing) {
      // Lobby: tap another player's car to go and look at it; tap your own to come back.
      if (level.configurator.active) return;
      const hit = level.pickCar(e.clientX, e.clientY);
      if (hit === 'you') { if (state.visiting) visit(null); }
      else if (hit) visit(hit);
      return;
    }
    select(level.pick(e.clientX, e.clientY, { helpers: state.helpers }));
  });
  stage.canvas.addEventListener('dblclick', (e) => {
    if (state.playing) return;
    const p = level.pick(e.clientX, e.clientY, { helpers: state.helpers });
    if (p) { select(p); frameSelection(); }
  });

  // ------------------------------------------------------------------------------------------------ camera
  function carCentre() {
    const c = new THREE.Box3().setFromObject(level.vehicle.root).getCenter(new THREE.Vector3());
    c.y = Math.max(0.6, c.y - 0.1);
    return c;
  }
  function heroView(duration = 1) {
    const yaw = level.vehicle.root.rotation.y;
    stage.rig.flyTo({ target: carCentre(), yaw: yaw + rad(40), pitch: rad(5), distance: 15, focal: 45 }, { duration });
  }
  function namedView(name) {
    const yaw = level.vehicle.root.rotation.y;
    const v = { hero: [40, 5, 15], front: [90, 4, 12], side: [0, 3, 14], rear: [-130, 10, 13], top: [0, 88, 17] }[name];
    stage.rig.flyTo({ target: carCentre(), yaw: yaw + rad(v[0]), pitch: rad(v[1]), distance: v[2] }, { duration: 0.9 });
  }
  function frameSelection() {
    const p = state.selected;
    if (!p || ['sky', 'sun', 'floor'].includes(p.kind)) { heroView(); return; }
    if (p.kind === 'hotspot') { level.configurator.focus(p.spot); level.configurator.close(false); stage.rig.flyTo(level.configurator.viewOf(p.spot), { duration: 0.9 }); return; }
    const box = new THREE.Box3().setFromObject(p.object);
    if (box.isEmpty()) box.setFromCenterAndSize(p.object.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(1, 1, 1));
    stage.rig.frame(box, { keepAngle: true });
  }
  // ------------------------------------------------------------------------------------ other players' cars
  // Visiting: the camera flies to another player's place and frames their car. View only — no dots, no colours.
  function carCentreOf(root) {
    const c = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
    c.y = Math.max(0.6, c.y - 0.1);
    return c;
  }
  // Seen from in front (the side facing the host), at whichever quarter angle has no other car or wall in the way.
  const viewRay = new THREE.Raycaster();
  function viewOfPlace(p) {
    const car = p.seat.car.root;
    const yaw = p.object.rotation.y + car.rotation.y;
    const target = carCentreOf(car), pitch = rad(11), distance = 9.5;
    const blockers = [...level.vehicle.meshes, ...occluders];
    for (const q of level.guestPlaces()) if (q !== p && q.seat && q.object.visible) blockers.push(...q.seat.car.meshes);
    let best = null;
    // A fan of rays per angle (the edges of the shot as well as its centre), so a neighbour can't sit in a corner.
    for (const a of [32, -32, 0, 55, -55, 80, -80]) {
      const y = yaw + rad(a);
      let clear = distance;
      for (const [dy, dp] of [[0, 0], [14, 0], [-14, 0], [9, -5], [-9, -5]]) {
        const yy = y + rad(dy), pp = pitch + rad(dp), cp = Math.cos(pp);
        viewRay.set(target, new THREE.Vector3(Math.sin(yy) * cp, Math.sin(pp), Math.cos(yy) * cp));
        viewRay.far = distance;
        const hit = viewRay.intersectObjects(blockers, true)[0];
        if (hit) clear = Math.min(clear, hit.distance);
      }
      if (!best || clear > best.clear + 0.5) best = { yaw: y, clear };
      if (clear >= distance) break;
    }
    return { target, yaw: best.yaw, pitch, distance: Math.max(5.5, Math.min(distance, best.clear - 0.6)) };
  }
  const visitTag = el('div', { class: 'ld-visit', hidden: true });
  well.append(visitTag);
  function visit(p) {
    if (p && !(p.seat && p.object.visible)) p = null;
    state.visiting = p;
    level.configurator.close(false);
    level.configurator.visible = !p && state.dots;
    stage.rig.turntable = !p && state.playing && state.idleOrbit;
    visitTag.hidden = !p;
    visitTag.replaceChildren();
    if (p) {
      const back = el('button', { type: 'button', title: 'Back to your car (Esc)', html: `${icon('exit', 14)}<span>Your car</span>` });
      back.addEventListener('click', () => visit(null));
      visitTag.append(el('div', { class: 'who' }, el('b', {}, p.seat.player.name), el('small', {}, `PLACE ${String(p.placeIndex + 1).padStart(2, '0')} · VIEW ONLY`)), back);
      stage.rig.flyTo(viewOfPlace(p), { duration: 1.1 });
    } else if (state.playing) heroView(1);
    for (const t of tags.values()) t.el.classList.toggle('current', !!p && t.place === p);
  }

  // Name tags over other players' cars, projected each frame like the dots (hidden behind walls and off-screen).
  const tagLayer = el('div', { class: 'ld-tags' });
  well.append(tagLayer);
  const tags = new Map();   // placement id → { el, place }
  const tagRay = new THREE.Raycaster(), tagPos = new THREE.Vector3();
  let tagClock = 0;
  function syncTags() {
    const seen = new Set();
    for (const p of level.guestPlaces()) {
      if (!p.seat) continue;
      seen.add(p.id);
      let t = tags.get(p.id);
      if (!t || t.player !== p.seat.player.id) {
        if (t) t.el.remove();
        const tag = el('button', { type: 'button', class: 'ld-tag' }, el('i', {}), el('span', {}, p.seat.player.name));
        tag.addEventListener('click', (e) => { e.stopPropagation(); if (state.playing) visit(state.visiting === p ? null : p); else select(p); });
        t = { el: tag, place: p, player: p.seat.player.id, hidden: false };
        tags.set(p.id, t);
        tagLayer.append(tag);
      }
      t.place = p;
      t.el.querySelector('i').style.background = p.seat.car.colour('body', 6);
    }
    for (const [id, t] of tags) if (!seen.has(id)) { t.el.remove(); tags.delete(id); }
    if (state.visiting && !state.visiting.seat) visit(null);
  }
  stage.frameCallbacks.add((dt) => {
    const rect = well.getBoundingClientRect(), cam = stage.camera;
    tagClock -= dt;
    const checkWalls = tagClock <= 0;
    if (checkWalls) tagClock = 0.15;
    for (const t of tags.values()) {
      const p = t.place;
      if (!p.seat || !p.object.visible) { t.el.style.display = 'none'; continue; }
      p.seat.car.root.getWorldPosition(tagPos);
      tagPos.y += 2.15;
      const v = tagPos.clone().project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) { t.el.style.display = 'none'; continue; }
      if (checkWalls) {
        const from = cam.getWorldPosition(new THREE.Vector3());
        const dir = tagPos.clone().sub(from), len = dir.length();
        tagRay.set(from, dir.normalize()); tagRay.far = len - 0.3;
        t.hidden = occluders.length > 0 && tagRay.intersectObjects(occluders, true).length > 0;
      }
      t.el.style.display = t.hidden || state.visiting === p ? 'none' : '';
      t.el.style.transform = `translate(${((v.x + 1) / 2) * rect.width}px, ${((1 - v.y) / 2) * rect.height}px) translate(-50%, -100%)`;
    }
  });

  const viewBar = el('div', { class: 'segmented' });
  for (const [id, label] of [['hero', 'Hero'], ['front', 'Front'], ['side', 'Side'], ['rear', 'Rear'], ['top', 'Top']]) {
    const b = el('button', { type: 'button' }, label);
    b.addEventListener('click', () => namedView(id));
    viewBar.append(b);
  }
  $('ViewBar').append(viewBar);
  createCameraHud(stage.rig, well);

  // ------------------------------------------------------------------------------------ camera containment
  // Spring arm: after the rig places the camera, cast from the pivot to the camera against the walls and large props;
  // if something is in between, the camera is pulled in front of it, so it can never end up behind a wall with the
  // car hidden. The rig keeps its wanted distance, so orbiting back toward the opening lets the camera out again.
  // The camera also stays above the floor. Always on in the Lobby; a switch in the Level details for the editor.
  const arm = new THREE.Raycaster();
  const rig = stage.rig, cam = stage.camera;
  const rigApply = rig.apply.bind(rig);
  let occluders = [], occluderClock = 0;
  stage.frameCallbacks.add((dt) => { occluderClock -= dt; if (occluderClock <= 0) { occluders = level.occluders(); occluderClock = 0.5; } });
  rig.apply = () => {
    if (!(state.contain || state.playing)) return rigApply();
    rig.goal.distance = Math.min(rig.goal.distance, 60);
    const cp = Math.cos(rig.pitch);
    const dir = new THREE.Vector3(Math.sin(rig.yaw) * cp, Math.sin(rig.pitch), Math.cos(rig.yaw) * cp);
    const pivot = rig.target.clone().add(rig.kick.offset);
    const want = rig.distance;
    let reach = want;
    if (occluders.length && want > 0.5) {
      arm.set(pivot, dir);
      arm.far = want + 0.4;
      const hit = arm.intersectObjects(occluders, true)[0];
      if (hit) reach = Math.max(0.35, Math.min(want, hit.distance - 0.45));
    }
    const minY = 0.12;
    if (dir.y < 0 && pivot.y + dir.y * reach < minY) reach = Math.max(0.2, (pivot.y - minY) / -dir.y);
    // Apply with the shortened arm (near plane, listeners and the HUD all see the real camera), then restore.
    rig.distance = reach;
    rigApply();
    rig.distance = want;
    state.armPulled = reach < want - 0.01;
    // Zooming out against a wall shouldn't bank distance the camera can't use (the next zoom-in would do nothing).
    if (state.armPulled && !rig.flight) rig.goal.distance = Math.min(rig.goal.distance, reach + 1.2);
  };


  // ------------------------------------------------------------------------------------------------- tools
  function setTool(tool) {
    state.tool = tool;
    for (const b of $('ToolModes').children) b.classList.toggle('active', b.dataset.tool === tool);
    syncGizmo();
  }
  for (const b of $('ToolModes').children) b.addEventListener('click', () => setTool(b.dataset.tool));
  $('SnapBtn').addEventListener('click', () => { gizmo.snap = !gizmo.snap; $('SnapBtn').classList.toggle('active', gizmo.snap); toast(gizmo.snap ? 'Snap on · 25 cm, 15°' : 'Snap off'); });
  function setDots(on) { state.dots = on; level.configurator.visible = on; $('DotsBtn').classList.toggle('active', on); }
  $('DotsBtn').addEventListener('click', () => setDots(!state.dots));
  function setHelpers(on) {
    state.helpers = on;
    $('HelpersBtn').classList.toggle('active', on);
    applyHelpers();
  }
  function applyHelpers() {
    if (level.hardware !== state.helpers) level.setHardware(state.helpers);
  }
  $('HelpersBtn').addEventListener('click', () => setHelpers(!state.helpers));
  $('FrameBtn').addEventListener('click', frameSelection);

  // ------------------------------------------------------------------------------------------------- tier
  function setTier(tier) {
    level.tier = tier;
    level.custom.children.forEach((o) => {
      const p = level.placements.find((x) => x.object === o);
      if (p && p.premium) o.visible = tier === 'premium' && p.shown !== false;
    });
    const chip = $('TierChip');
    chip.className = `tier-chip ${tier}`;
    chip.innerHTML = `${icon(tier === 'premium' ? 'premium' : 'lock', 12)}${tier === 'premium' ? 'PREMIUM' : 'BASIC'}`;
    if (state.selected && state.selected.premium && tier !== 'premium') select(null);
    level.changed('tier');
    renderAll();
  }
  $('TierChip').addEventListener('click', () => setTier(level.tier === 'premium' ? 'basic' : 'premium'));
  $('TierChip').style.cursor = 'pointer';

  // -------------------------------------------------------------------------------------------- add menu
  function addThing(kind) {
    const a = ADDABLE.find((x) => x.kind === kind);
    if (a.premium && level.tier !== 'premium') { toast('Premium · your own lobby pieces and models'); flashTier(); return; }
    hideAddMenu();
    let p = null;
    const t = stage.rig.target;
    void t;
    if (kind.startsWith('fixture:')) {
      const type = kind.slice(8), hung = ['overhead', 'track', 'pendant', 'battens', 'halo'].includes(type);
      p = level.addFixture(type, { position: hung ? (type === 'overhead' || type === 'halo' ? [carCentre().x, 0, carCentre().z] : propSpot(2.6)) : propSpot(4.6), aim: true, atCeiling: hung });
    } else if (kind === 'hotspot') p = level.addHotspot();
    else if (kind === 'import') { $('FileInput').click(); return; }
    else if (kind.startsWith('piece:')) p = level.addPiece(kind.slice(6), { position: propSpot() });
    applyHelpers();
    if (p) { select(p); setTool('move'); toast(`${p.name} added · drag the arrows to place it`); }
  }
  // Somewhere on the floor beside the car, toward the camera's right, so a new prop is in view and not inside the car.
  function propSpot(reach = 4.4) {
    const right = new THREE.Vector3().setFromMatrixColumn(stage.camera.matrixWorld, 0).setY(0).normalize();
    const toCam = stage.camera.position.clone().sub(stage.rig.target).setY(0).normalize();
    const c = carCentre();
    const at = c.addScaledVector(right, reach + Math.random() * 0.4).addScaledVector(toCam, 1.2);
    return [+at.x.toFixed(2), 0, +at.z.toFixed(2)];
  }
  function flashTier() { const c = $('TierChip'); c.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 380 }); }

  function renderAddMenu() {
    const q = $('AddSearch').value.trim().toLowerCase();
    const list = $('AddList');
    list.replaceChildren();
    let group = '';
    for (const a of ADDABLE) {
      if (q && !`${a.label} ${a.group} ${a.note}`.toLowerCase().includes(q)) continue;
      if (a.group !== group) { group = a.group; list.append(el('div', { class: 'menu-group' }, group.toUpperCase())); }
      const locked = a.premium && level.tier !== 'premium';
      const b = el('button', { type: 'button', class: `menu-item${locked ? ' locked' : ''}` }, iconEl(a.icon, 16), el('span', {}, a.label), locked ? el('span', { class: 'lock', html: icon('lock', 12), title: 'Premium' }) : el('small', {}, a.note));
      b.addEventListener('click', () => addThing(a.kind));
      list.append(b);
    }
  }
  function hideAddMenu() { $('AddMenu').hidden = true; }
  $('AddBtn').addEventListener('click', (e) => { e.stopPropagation(); const m = $('AddMenu'); m.hidden = !m.hidden; if (!m.hidden) { renderAddMenu(); $('AddSearch').value = ''; $('AddSearch').focus(); } });
  $('AddSearch').addEventListener('input', renderAddMenu);
  addEventListener('pointerdown', (e) => { if (!$('AddMenu').hidden && !e.target.closest('#AddMenu, #AddBtn')) hideAddMenu(); });

  // -------------------------------------------------------------------------------------------- import
  async function importFiles(files) {
    if (level.tier !== 'premium') { toast('Premium · import your own models'); flashTier(); return; }
    for (const file of files) {
      try {
        const p = await level.importFile(file);
        select(p); setTool('move');
        toast(`${p.name} placed · ${p.note}`);
      } catch (err) { toast(String(err.message || err)); }
    }
  }
  $('FileInput').addEventListener('change', (e) => { importFiles([...e.target.files]); e.target.value = ''; });
  $('ImportBtn').addEventListener('click', () => { if (level.tier !== 'premium') { toast('Premium · import your own models'); flashTier(); return; } $('FileInput').click(); });
  addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); well.classList.add('drop'); } });
  addEventListener('dragleave', () => well.classList.remove('drop'));
  addEventListener('drop', (e) => { well.classList.remove('drop'); if (e.dataTransfer.files.length) { e.preventDefault(); importFiles([...e.dataTransfer.files]); } });

  // ----------------------------------------------------------------------------------------- left tabs
  for (const tab of document.querySelectorAll('[data-left]')) {
    tab.addEventListener('click', () => {
      for (const t of document.querySelectorAll('[data-left]')) t.classList.toggle('active', t === tab);
      $('LeftOutliner').hidden = tab.dataset.left !== 'outliner';
      $('LeftContent').hidden = tab.dataset.left !== 'content';
      $('LeftLevels').hidden = tab.dataset.left !== 'levels';
      if (tab.dataset.left === 'levels') renderLevels();
    });
  }
  $('ImportFormats').append(...IMPORT_FORMATS.filter((f) => f.reads).map((f) => el('span', { class: 'chip' }, f.label)));

  function renderContent() {
    const list = $('PieceList');
    list.replaceChildren();
    const locked = level.tier !== 'premium';
    $('ImportBtn').classList.toggle('stale', locked);
    const cats = [...CATEGORIES.map((c) => ({ ...c, kinds: Object.keys(PIECES).filter((t) => PIECES[t].category === c.id).map((t) => `piece:${t}`) })), { id: 'lights', label: 'Light fixtures', icon: 'softbox', kinds: Object.keys(FIXTURES).map((t) => `fixture:${t}`) }];
    const chips = el('div', { class: 'cat-chips' }, ...cats.map((c) => {
      const b = el('button', { type: 'button', class: `cat-chip${state.contentCat === c.id ? ' on' : ''}`, html: `${icon(c.icon, 14)}<span>${c.label}</span>` });
      b.addEventListener('click', () => { state.contentCat = c.id; renderContent(); });
      return b;
    }));
    list.append(chips);
    const cat = cats.find((c) => c.id === state.contentCat) || cats[0];
    const grid = el('div', { class: 'piece-grid' });
    for (const kind of cat.kinds) {
      const a = ADDABLE.find((x) => x.kind === kind);
      const [k, type] = kind.split(':');
      const n = level.placements.filter((p) => p.kind === k && p.data && p.data.type === type).length;
      const b = el('button', { type: 'button', class: 'piece-card', title: `${a.label} · ${a.note} — click to place` }, el('span', { class: 'piece-glyph', html: icon(a.icon, 26) }), el('b', {}, a.label), el('small', {}, a.note), n ? el('i', { class: 'in-level' }, `${n}`) : null);
      b.addEventListener('click', () => addThing(kind));
      grid.append(b);
    }
    list.append(grid);
    if (locked) $('ImportNote').replaceChildren(el('div', { class: 'premium-note flat' }, iconEl('premium', 14), el('div', {}, 'Importing your own models is part of Premium. Lobby designs, floors, lights, scene pieces and dots are open to every designer.', el('br'), unlockButton())));
    else $('ImportNote').replaceChildren();
  }
  function unlockButton() {
    const b = el('button', { type: 'button' }, 'Switch to Premium');
    b.addEventListener('click', () => setTier('premium'));
    return b;
  }

  // ------------------------------------------------------------------------------------------- outliner
  $('TreeSearch').addEventListener('input', () => { state.search = $('TreeSearch').value.trim().toLowerCase(); renderTree(); });

  function row(p, { child = false } = {}) {
    const visible = level.isVisible(p);
    const eye = el('button', { type: 'button', class: `eye${visible ? '' : ' off'}`, title: visible ? 'Hide' : 'Show', html: icon(visible ? 'eye' : 'eyeOff', 14) });
    eye.addEventListener('click', (e) => { e.stopPropagation(); level.setVisible(p, !visible); renderTree(); });
    let extra = el('span');
    if (p.kind === 'hotspot') {
      const zone = ZONES[p.spot.zone];
      const [part, fam] = zone.rows.find((r) => r.targets).targets[0];
      extra = el('i', { class: 'dot-swatch', style: `--c:${level.vehicle.colour(part, fam)}`, title: 'Current colour' });
    } else if (p.kind === 'fixture' && p.data.params.kelvin) extra = el('i', { class: 'dot-swatch glow', style: `--c:#${kelvinHex(p.data.params.kelvin)}` });
    const b = el('button', { type: 'button', class: `entity comp-row${child ? ' child' : ''}${state.selected === p ? ' active' : ''}`, role: 'treeitem' },
      el('span', { class: 'tree-caret-sm' }, child ? '' : p.kind === 'vehicle' ? '▾' : ''),
      el('span', { class: 'entity-icon', html: icon(p.icon || 'dot', 16) }),
      el('div', {}, el('b', {}, p.name), el('small', {}, p.note || KIND_LABEL[p.kind])),
      extra, eye);
    b.addEventListener('click', () => select(p));
    b.addEventListener('dblclick', () => { select(p); frameSelection(); });
    return b;
  }

  function renderTree() {
    const tree = $('Tree');
    tree.replaceChildren();
    const q = state.search;
    const match = (p) => !q || `${p.name} ${p.note || ''} ${KIND_LABEL[p.kind]}`.toLowerCase().includes(q);
    // Level root
    const root = el('button', { type: 'button', class: `entity comp-row root${state.selected ? '' : ' active'}` },
      el('span', { class: 'tree-caret-sm' }, '▾'), el('span', { class: 'entity-icon', html: icon('root', 16) }),
      el('div', {}, el('b', {}, level.name, el('i', { class: 'root-tag' }, 'LEVEL')), el('small', {}, `${SETS[L.settings.set].label} · ${FLOORS[L.settings.floor.preset].label}`)), el('span'), el('span'));
    root.style.paddingLeft = '10px';
    root.addEventListener('click', () => select(null));
    tree.append(root);
    for (const g of GROUPS) {
      const items = level.byGroup(g.id).filter(match);
      const locked = g.id === 'custom' && level.tier !== 'premium';
      if (q && !items.length) continue;
      tree.append(el('div', { class: 'group-row' }, iconEl(g.icon, 16), el('div', {}, el('b', {}, g.label), el('small', {}, g.note)), locked ? el('span', { class: 'lock-tag', html: icon('lock', 13), title: 'Premium' }) : el('span', { class: 'count' }, String(level.byGroup(g.id).length))));
      if (locked) {
        tree.append(el('div', { class: 'premium-note' }, iconEl('premium', 14), el('div', {}, 'Premium designers import their own models into the level.', el('br'), unlockButton())));
        continue;
      }
      if (g.id === 'vehicle') {
        for (const p of items.filter((x) => x.kind === 'vehicle')) tree.append(row(p));
        for (const p of items.filter((x) => x.kind === 'hotspot')) tree.append(row(p, { child: true }));
      } else for (const p of items) tree.append(row(p));
      if (!items.length) tree.append(el('p', { class: 'tree-empty' }, { lights: 'No fixtures. Pick a light rig in the level Details, or Add → Lights.', pieces: 'Nothing placed. Add → Nature, Garage, Lounge… or browse Content.', custom: 'No models yet. Import one from Content.' }[g.id] || ''));
    }
    $('StatPlacements').textContent = String(level.placements.length);
    $('StatDots').textContent = String(level.counts.hotspots);
  }

  // -------------------------------------------------------------------------------------------- details
  function head(p) {
    const glyph = el('div', { class: 'detail-glyph', html: icon(p ? p.icon || 'dot' : 'root', 22) });
    const name = el('input', { class: 'name-input', value: p ? p.name : level.name, 'aria-label': 'Name' });
    name.addEventListener('change', () => {
      if (p) p.name = name.value || p.name; else { level.name = name.value || 'Lobby'; for (const id of ['LevelName', 'SceneTitle', 'DocTab']) $(id).textContent = level.name; }
      level.changed('rename'); renderTree();
    });
    const actions = el('div', { class: 'detail-actions' });
    if (p) {
      const frame = el('button', { type: 'button', class: 'tool round', title: 'Frame (F)', html: icon('frame', 14) });
      frame.addEventListener('click', frameSelection);
      actions.append(frame);
      if (p.removable || p.kind === 'hotspot') {
        const dup = el('button', { type: 'button', class: 'tool round', title: 'Duplicate (Ctrl D)', html: icon('copy', 14) });
        dup.addEventListener('click', duplicateSelected);
        const del = el('button', { type: 'button', class: 'tool round', title: 'Delete (Del)', html: icon('trash', 14) });
        del.addEventListener('click', deleteSelected);
        actions.append(dup, del);
      }
    }
    return el('div', { class: 'detail-head' }, glyph, el('div', { class: 'detail-title' }, name, el('div', { class: 'subtitle' }, p ? `${KIND_LABEL[p.kind]} · ${GROUPS.find((g) => g.id === p.group).label}` : 'Level · car configurator lobby')), actions);
  }

  function transformPanel(p) {
    live = { loc: null, turn: null };
    const kids = [];
    const local = p.kind === 'hotspot';
    const loc = vec3Field({ label: local ? 'Anchor' : 'Location', unit: local ? 'm · on the car' : 'm', value: p.object.position.toArray(), step: 0.05, onChange: (v) => { p.object.position.set(...v); if (p.kind === 'turntable') level.seatVehicle(); level.changed('transform'); } });
    live.loc = [...loc.querySelectorAll('input')];
    kids.push(loc);
    if (p.rotatable) {
      const f = rangeField({ label: 'Turn', value: Math.round(deg(p.object.rotation.y)), min: -180, max: 180, step: 1, unit: '°', onInput: (v) => { p.object.rotation.y = rad(v); }, onChange: () => level.changed('transform') });
      live.turn = f.querySelector('input'); live.turnOut = f.querySelector('output');
      kids.push(f);
    }
    if (p.scalable) kids.push(vec3Field({ label: 'Scale', value: p.object.scale.toArray(), step: 0.05, linkable: true, onChange: (v) => { p.object.scale.set(...v.map((x) => Math.max(0.01, x))); level.changed('transform'); } }));
    const tools = el('div', { class: 'action-row' });
    const mv = el('button', { type: 'button', class: `tool${state.tool === 'move' ? ' active' : ''}`, html: `${icon('move', 13)} Move` });
    mv.addEventListener('click', () => { setTool('move'); renderDetails(); });
    const tr = el('button', { type: 'button', class: `tool${state.tool === 'rotate' ? ' active' : ''}`, html: `${icon('turn', 13)} Turn` });
    tr.disabled = !p.rotatable;
    tr.addEventListener('click', () => { setTool('rotate'); renderDetails(); });
    kids.push(tools);
    tools.append(mv, tr);
    return [section('TRANSFORM'), panel(...kids)];
  }

  const edit = (apply) => (v) => { apply(v); level.changed('edit'); };

  // Lobby design (set), floor and light-rig pickers.
  function designTiles() {
    const tiles = el('div', { class: 'design-tiles' });
    for (const [id, d] of Object.entries(SETS)) {
      const b = el('button', { type: 'button', class: `design-tile${L.settings.set === id ? ' active' : ''}`, title: d.note, style: `--g:linear-gradient(160deg, ${d.sky.zenith}, ${d.sky.horizon})` },
        el('span', { class: 'design-art', html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${d.icon}</svg>` }),
        el('b', {}, d.label), el('small', {}, d.note));
      b.addEventListener('click', () => {
        L.useSet(id);
        if (state.withRig) level.applyRig(d.rig, { silent: true });
        level.refreshBuiltInNotes(); level.seatVehicle(); level.changed('preset'); renderAll();
        toast(`${d.label} · ${FLOORS[d.floor].label}${state.withRig ? ` · ${RIGS[d.rig].label}` : ''}`);
      });
      tiles.append(b);
    }
    return tiles;
  }
  function floorTiles() {
    const tiles = el('div', { class: 'floor-tiles' });
    for (const [id, f] of Object.entries(FLOORS)) {
      const img = f.texture ? `url(${surfaceSwatch(f.texture)})` : f.colour;
      const b = el('button', { type: 'button', class: `floor-tile${L.settings.floor.preset === id ? ' active' : ''}`, title: f.label, style: `--img:${img};--gloss:${f.gloss}` }, el('i'), el('span', {}, f.label));
      b.addEventListener('click', () => { L.useFloor(id); level.refreshBuiltInNotes(); level.changed('preset'); renderAll(); });
      tiles.append(b);
    }
    return tiles;
  }
  function rigTiles() {
    const tiles = el('div', { class: 'rig-tiles' });
    for (const [id, r] of Object.entries(RIGS)) {
      const b = el('button', { type: 'button', class: `rig-tile${L.settings.rig === id ? ' active' : ''}`, title: r.note },
        el('span', { class: 'rig-art', html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${r.icon}</svg>` }),
        el('div', {}, el('b', {}, r.label), el('small', {}, r.fixtures.length ? `${r.fixtures.length} fixtures · ${r.note}` : r.note)));
      b.addEventListener('click', () => { level.applyRig(id); applyHelpers(); renderAll(); toast(`${r.label} · ${r.fixtures.length} fixtures aimed at the car`); });
      tiles.append(b);
    }
    return tiles;
  }

  function sunDial() {
    const s = L.settings.sun;
    const out = el('output', {}, '');
    const svg = el('div', { html: '' });
    const dial = el('div', { class: 'sun-dial', title: 'Drag the sun: around = direction, in / out = height' }, el('small', {}, 'TOP VIEW'), out, svg);
    const draw = () => {
      const w = 260, h = 120, cx = w / 2, cy = h / 2, R = 52;
      const a = rad(s.azimuth), r = R * (1 - s.elevation / 90);
      const x = cx + Math.sin(a) * r, y = cy + Math.cos(a) * r;
      svg.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet"><circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#2c2c2c"/><circle cx="${cx}" cy="${cy}" r="${R / 2}" fill="none" stroke="#222" stroke-dasharray="2 3"/><rect x="${cx - 13}" y="${cy - 6}" width="26" height="12" rx="4" fill="#3a3a3a"/><path d="M${cx + 13} ${cy}h5" stroke="#6e6e6e"/><line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#ffb23866"/><circle cx="${x}" cy="${y}" r="7" fill="#ffb238"/><circle cx="${x}" cy="${y}" r="12" fill="none" stroke="#ffb23855"/></svg>`;
      out.textContent = `${Math.round(s.azimuth)}° · ${Math.round(s.elevation)}° up`;
    };
    const setFrom = (e) => {
      const r = dial.getBoundingClientRect();
      const scale = Math.min(r.width / 260, r.height / 120);
      const dx = (e.clientX - (r.left + r.width / 2)) / scale, dy = (e.clientY - (r.top + r.height / 2)) / scale;
      s.azimuth = (deg(Math.atan2(dx, dy)) + 360) % 360;
      s.elevation = THREE.MathUtils.clamp(90 * (1 - Math.hypot(dx, dy) / 52), 2, 89);
      L.applySun(); draw();
    };
    dial.addEventListener('pointerdown', (e) => { dial.setPointerCapture(e.pointerId); setFrom(e); dial.onpointermove = setFrom; });
    dial.addEventListener('pointerup', () => { dial.onpointermove = null; level.changed('sun'); renderDetails(); });
    draw();
    return dial;
  }

  function vehicleZones() {
    const v = level.vehicle;
    const blocks = Object.entries(ZONES).map(([id, z]) => {
      const lines = z.rows.map((r) => {
        if (r.finish) {
          return el('div', { class: 'zone-line' }, el('span', {}, r.label), el('div', { class: 'swatch-grid' }, ...Object.entries(FINISHES).map(([fid, f]) => {
            const b = el('button', { type: 'button', class: `chip-toggle${v.finish === fid ? ' on' : ''}` }, f.label);
            b.addEventListener('click', () => { v.setFinish(fid); level.changed('finish'); renderDetails(); });
            return b;
          })), el('span'));
        }
        const [part, fam] = r.targets[0];
        const cur = v.colour(part, fam);
        const custom = el('input', { type: 'color', value: cur, title: 'Any colour' });
        custom.addEventListener('input', () => { for (const [pp, ff] of r.targets) v.setColour(pp, ff, custom.value); level.changed('finish'); });
        custom.addEventListener('change', () => renderDetails());
        return el('div', { class: 'zone-line' }, el('span', {}, r.label), el('div', { class: 'swatch-grid' }, ...r.swatches.map((s) => {
          const b = el('button', { type: 'button', class: `mini-swatch${sameColour(cur, s.hex) ? ' on' : ''}`, title: s.name, style: `--c:${s.hex}` });
          b.addEventListener('click', () => { for (const [pp, ff] of r.targets) v.setColour(pp, ff, s.hex); level.changed('finish'); renderDetails(); });
          return b;
        })), custom);
      });
      return el('div', { class: 'zone-block' }, el('header', {}, iconEl('palette', 13), z.label, el('small', {}, z.kicker)), ...lines);
    });
    return panel(...blocks);
  }

  // ---------------------------------------------------------------------------------------------- places
  function button(glyph, label, onClick, disabled = false) {
    const b = el('button', { type: 'button', class: 'tool', html: `${icon(glyph, 13)} ${label}` });
    b.disabled = !!disabled;
    b.addEventListener('click', onClick);
    return b;
  }
  function lookAtPlace(p) {
    if (!p.seat) return;
    stage.rig.turntable = false;
    stage.rig.flyTo(viewOfPlace(p), { duration: 0.9 });
  }
  // The five places, who stands where, test company and the arc.
  function placesPanels() {
    const S = level.session, open = S.capacity;
    const rows = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = i === 0 ? level.get('turntable') : level.placeAt(i);
      const who = S.playerAt(i), closed = i > 0 && p && !p.object.visible;
      const swatch = el('i', { class: who ? '' : 'empty' });
      if (who) swatch.style.background = i === 0 ? level.vehicle.colour('body', 6) : (p.seat ? p.seat.car.colour('body', 6) : '');
      const row = el('button', { type: 'button', class: `ld-place-row${state.selected === p ? ' active' : ''}${closed ? ' closed' : ''}` },
        el('span', { class: 'idx' }, String(i + 1).padStart(2, '0')), swatch,
        el('span', { class: 'name' }, who ? (i === 0 ? 'You' : who.name) : closed ? 'Closed' : 'Open'),
        el('small', {}, i === 0 ? 'HOST' : who ? 'GUEST' : ''));
      row.addEventListener('click', () => p && select(p));
      rows.push(row);
    }
    return [
      panel(
        metrics([[`${S.count}/${MAX_PLAYERS}`, 'CARS IN THE LOBBY'], [open, 'OPEN PLACES']]),
        el('div', { class: 'ld-place-list' }, ...rows),
        el('div', { class: 'action-row' },
          button('plus', 'Add', () => { if (!level.addGuest()) toast('Every open place is taken'); }, S.full),
          button('vehicle', 'Fill', () => level.fillLobby(), S.full),
          button('x', 'Clear', () => level.clearGuests(), !S.guests.length)),
        toggle({ label: 'Automatic company', value: level.sim.auto, note: 'Simulated players drift in, repaint and leave while you design.', onChange: (v) => { level.sim.auto = v; level.sim.timer = 1; } }),
      ),
      section('ARC', el('small', { class: 'section-note' }, 'guest places around yours')),
      panel(
        rangeField({ label: 'Distance', value: level.layout.radius, min: 7.5, max: 18, step: 0.1, unit: 'm', onInput: (v) => { level.layout.radius = v; level.relayout({ silent: true }); }, onChange: () => level.relayout() }),
        rangeField({ label: 'Spread', value: level.layout.spread, min: 60, max: 220, step: 1, unit: '°', onInput: (v) => { level.layout.spread = v; level.relayout({ silent: true }); }, onChange: () => level.relayout() }),
        rangeField({ label: 'Disc radius', value: level.layout.discRadius, min: 2.6, max: 4.2, step: 0.05, unit: 'm', onInput: (v) => { level.layout.discRadius = v; level.relayout({ silent: true }); }, onChange: () => level.relayout() }),
        el('p', {}, 'Moving the arc puts every guest place back on it; move or turn a single place with the gizmo afterwards. Players are simulated until the lobby has a server — Session.js speaks a two-method transport a WebSocket can fill in.'),
      ),
    ];
  }

  function renderDetails() {
    const d = $('Details');
    const scroll = d.scrollTop;
    d.replaceChildren();
    live = null;
    const p = state.selected;
    const crumbs = el('div', { class: 'crumbs' }, p ? `${level.name} / ${GROUPS.find((g) => g.id === p.group).label} / ${p.name}` : `${level.name} / Level`);
    d.append(crumbs, head(p));
    const S = L.settings;

    if (!p) {
      const c = level.counts;
      d.append(
        section('LEVEL'),
        panel(
          metrics([[c.pieces, 'SCENE PIECES'], [c.lights, 'LIGHT FIXTURES'], [c.hotspots, 'CONFIGURATOR DOTS'], [level.tier === 'premium' ? c.custom : '—', 'YOUR MODELS']]),
          segmentedField({ label: 'Account tier', value: level.tier, options: [{ id: 'basic', label: 'Basic' }, { id: 'premium', label: 'Premium' }], onChange: setTier, note: 'Basic: designs, floors, lights, scene pieces and dots. Premium: also imports your own models.' }),
        ),
        section('LOBBY DESIGN', el('small', { class: 'section-note' }, 'the room')),
        panel(designTiles(), toggle({ label: 'Bring its light rig', value: state.withRig, note: 'Switching the design also swaps the fixtures for its own rig.', onChange: (v) => { state.withRig = v; } })),
        section('FLOOR', el('small', { class: 'section-note' }, FLOORS[S.floor.preset].label)),
        panel(floorTiles(), rangeField({ label: 'Gloss', value: S.floor.gloss, min: 0, max: 1, step: 0.01, note: 'How much of the room the floor mirrors.', onInput: (v) => { S.floor.gloss = v; L.applyFloor(); }, onChange: () => level.changed('edit') })),
        section('LIGHTING', el('small', { class: 'section-note' }, RIGS[S.rig] ? RIGS[S.rig].label : 'custom')),
        panel(rigTiles(), el('p', {}, 'A rig replaces the fixtures with its own, aimed at the car. Every fixture stays editable under Lights; add more from Add → Lights.')),
        section('PLACES', el('small', { class: 'section-note' }, `${level.session.count} of ${MAX_PLAYERS} cars`)),
        ...placesPanels(),
        section('LOBBY'),
        panel(
          el('p', {}, 'Players see the Lobby without any interface: only the dots on their own car and name tags over the others. Tapping another car flies over to look at it.'),
          toggle({ label: 'Slow orbit when idle', value: state.idleOrbit, onChange: (v) => { state.idleOrbit = v; } }),
          toggle({ label: 'Keep the camera inside', value: state.contain, note: 'Walls and tall pieces push the editor camera in front of them. Always on in the Lobby.', onChange: (v) => { state.contain = v; } }),
          (() => { const b = el('button', { type: 'button', class: 'primary wide', html: `${icon('play', 13)} Play lobby` }); b.addEventListener('click', () => setPlaying(true)); return b; })(),
        ),
        section('FILE'),
        panel(el('div', { class: 'action-row' },
          (() => { const b = el('button', { type: 'button', class: 'tool', html: `${icon('download', 13)} Export JSON` }); b.addEventListener('click', () => download(`${level.name.replace(/\W+/g, '')}.level.json`, JSON.stringify(level.snapshot(), null, 2), 'application/json')); return b; })(),
          (() => { const b = el('button', { type: 'button', class: 'tool', html: `${icon('reset', 13)} Reset` }); b.addEventListener('click', resetLevel); return b; })(),
          (() => { const b = el('button', { type: 'button', class: 'tool', html: `${icon('layers', 13)} All levels` }); b.addEventListener('click', () => document.querySelector('[data-left="levels"]').click()); return b; })(),
        ), el('p', {}, `Started from the ${(TEMPLATES[level.template] || TEMPLATES.lobby).label} template. Saves in this browser as you edit; imported models stay for the session only.`)),
      );
    } else if (p.kind === 'sky') {
      d.append(section('SKY'), panel(
        colorField({ label: 'Zenith', value: S.sky.zenith, onChange: edit((v) => { S.sky.zenith = v; L.applySky(); }) }),
        colorField({ label: 'Horizon', value: S.sky.horizon, onChange: edit((v) => { S.sky.horizon = v; L.applySky(); }) }),
        colorField({ label: 'Below horizon', value: S.sky.ground, onChange: edit((v) => { S.sky.ground = v; L.applySky(); }) }),
        rangeField({ label: 'Haze', value: S.sky.haze, min: 0, max: 1, step: 0.01, onInput: (v) => { S.sky.haze = v; L.applySky(); }, onChange: () => level.changed('edit') }),
      ), section('AMBIENT'), panel(
        colorField({ label: 'Sky light', value: S.ambient.sky, onChange: edit((v) => { S.ambient.sky = v; L.applyAmbient(); }) }),
        colorField({ label: 'Bounce light', value: S.ambient.ground, onChange: edit((v) => { S.ambient.ground = v; L.applyAmbient(); }) }),
        rangeField({ label: 'Ambient', value: S.ambient.intensity, min: 0, max: 3, step: 0.05, onInput: (v) => { S.ambient.intensity = v; L.applyAmbient(); }, onChange: () => level.changed('edit') }),
        rangeField({ label: 'Reflections', value: S.ambient.reflections, min: 0, max: 2, step: 0.05, onInput: (v) => { S.ambient.reflections = v; L.applyAmbient(); }, onChange: () => level.changed('edit') }),
        rangeField({ label: 'Exposure', value: S.ambient.exposure, min: 0.4, max: 2, step: 0.01, onInput: (v) => { S.ambient.exposure = v; L.applyAmbient(); }, onChange: () => level.changed('edit') }),
      ));
    } else if (p.kind === 'sun') {
      d.append(section('SUN'), panel(
        sunDial(),
        rangeField({ label: 'Direction', value: S.sun.azimuth, min: 0, max: 360, step: 1, unit: '°', onInput: (v) => { S.sun.azimuth = v; L.applySun(); }, onChange: () => level.changed('edit') }),
        rangeField({ label: 'Height', value: S.sun.elevation, min: 2, max: 89, step: 1, unit: '°', onInput: (v) => { S.sun.elevation = v; L.applySun(); }, onChange: () => level.changed('edit') }),
        rangeField({ label: 'Strength', value: S.sun.intensity, min: 0, max: 8, step: 0.05, onInput: (v) => { S.sun.intensity = v; L.applySun(); }, onChange: () => level.changed('edit') }),
        rangeField({ label: 'Shadow softness', value: S.sun.softness, min: 0, max: 10, step: 0.5, onInput: (v) => { S.sun.softness = v; L.applySun(); }, onChange: () => level.changed('edit') }),
        colorField({ label: 'Colour', value: S.sun.colour, onChange: edit((v) => { S.sun.colour = v; L.applySun(); }) }),
      ));
    } else if (p.kind === 'floor') {
      d.append(section('FINISH'), panel(floorTiles()), section('FLOOR'), panel(
        rangeField({ label: 'Gloss', value: S.floor.gloss, min: 0, max: 1, step: 0.01, note: 'How much of the room the floor mirrors.', onInput: (v) => { S.floor.gloss = v; L.applyFloor(); }, onChange: () => level.changed('edit') }),
        rangeField({ label: 'Pattern scale', value: S.floor.scale || 1, min: 0.25, max: 4, step: 0.05, unit: '×', onChange: edit((v) => { S.floor.scale = v; L.applyFloor(); }) }),
        colorField({ label: 'Tint', value: S.floor.tint || '#ffffff', onChange: edit((v) => { S.floor.tint = v; L.applyFloor(); }) }),
      ));
    } else if (p.kind === 'set') {
      d.append(section('LOBBY DESIGN'), panel(designTiles(), toggle({ label: 'Bring its light rig', value: state.withRig, onChange: (v) => { state.withRig = v; } })),
        section('LIGHTING'), panel(rigTiles()),
        section('CONTACT SHADOW'), panel(
          rangeField({ label: 'Strength', value: S.shadow.strength, min: 0, max: 1, step: 0.01, onInput: (v) => { S.shadow.strength = v; L.applyShadow(); }, onChange: () => level.changed('edit') }),
          rangeField({ label: 'Softness', value: S.shadow.softness, min: 0.5, max: 6, step: 0.1, onInput: (v) => { S.shadow.softness = v; L.applyShadow(); }, onChange: () => level.changed('edit') }),
        ));
    } else if (p.kind === 'place') {
      const who = p.seat && p.seat.player;
      d.append(...transformPanel(p), section('PLAYER'), panel(
        who
          ? el('div', { class: 'ld-seat' }, el('i', { style: { background: p.seat.car.colour('body', 6) } }), el('div', {}, el('b', {}, who.name), el('small', {}, `${FINISHES[who.config.finish] ? FINISHES[who.config.finish].label || who.config.finish : 'Gloss'} · simulated player`)))
          : el('p', {}, p.object.visible ? 'Open: the next player to join stands here.' : 'Hidden: closed to players. Show it to open it again.'),
        el('div', { class: 'action-row' }, ...(who ? [
          button('eye', 'Look', () => lookAtPlace(p)),
          button('palette', 'Repaint', () => level.sim.repaint(who.id), !level.sim.present.has(who.id)),
          button('x', 'Remove', () => { level.kick(p); toast(`${who.name} left the lobby`); }),
        ] : [button('plus', 'Add player', () => { if (!level.addGuest()) toast('No open place'); }, !p.object.visible || level.session.full)])),
        toggle({ label: 'Spin', value: p.data.spin, note: 'Turns this player\'s car on its disc', onChange: (v) => level.setPlaceSpin(p, v) }),
      ), section('ALL PLACES'), ...placesPanels());
    } else if (p.kind === 'turntable') {
      const T = S.turntable;
      d.append(...transformPanel(p), section('TURNTABLE'), panel(
        toggle({ label: 'Spin', value: T.spin, note: 'Turns the car parked on it', onChange: edit((v) => { T.spin = v; }) }),
        rangeField({ label: 'Speed', value: T.speed, min: 1, max: 40, step: 1, unit: '°/s', onInput: (v) => { T.speed = v; }, onChange: () => level.changed('edit') }),
        rangeField({ label: 'Radius', value: T.radius, min: 2, max: 6, step: 0.05, unit: 'm', onInput: (v) => { T.radius = v; L.applyTurntable(); }, onChange: () => { level.seatVehicle(); level.changed('edit'); } }),
        colorField({ label: 'Ring colour', value: T.ring, onChange: edit((v) => { T.ring = v; L.applyTurntable(); }) }),
        rangeField({ label: 'Ring glow', value: T.glow, min: 0, max: 1, step: 0.01, onInput: (v) => { T.glow = v; L.applyTurntable(); }, onChange: () => level.changed('edit') }),
        segmentedField({ label: 'Disc', value: T.finish || 'dark', options: [{ id: 'dark', label: 'Dark lacquer' }, { id: 'light', label: 'Light' }], onChange: (v) => { T.finish = v; L.applyTurntable(); level.changed('edit'); } }),
        el('p', {}, 'Place 01: your own car. The guest places share this disc, band and ring.'),
      ), section('ALL PLACES'), ...placesPanels());
    } else if (p.kind === 'vehicle') {
      d.append(...transformPanel(p), section('CONFIGURATOR'), vehicleZones(), section('DOTS'), panel(
        toggle({ label: 'Show dots', value: state.dots, onChange: (v) => setDots(v) }),
        el('p', {}, 'Each dot is a placement under the car: select it to move it or change what it opens.'),
      ));
    } else if (p.kind === 'hotspot') {
      const spot = p.spot;
      const zoneOpts = Object.entries(ZONES).map(([id, z]) => ({ id, label: z.label }));
      d.append(...transformPanel(p), section('DOT'), panel(
        selectField({ label: 'Opens', value: spot.zone, options: zoneOpts, onChange: (v) => { level.setHotspotZone(p, v); renderAll(); } }),
        el('p', {}, ZONES[spot.zone].rows.map((r) => r.label).join(' · ')),
      ), section('CAMERA VIEW'), panel(
        rangeField({ label: 'Around the car', value: spot.view.yaw, min: -180, max: 180, step: 1, unit: '°', onChange: edit((v) => { spot.view.yaw = v; previewDot(p); }) }),
        rangeField({ label: 'Height', value: spot.view.pitch, min: -10, max: 80, step: 1, unit: '°', onChange: edit((v) => { spot.view.pitch = v; previewDot(p); }) }),
        rangeField({ label: 'Distance', value: spot.view.distance, min: 1, max: 14, step: 0.1, unit: 'm', onChange: edit((v) => { spot.view.distance = v; previewDot(p); }) }),
        el('div', { class: 'action-row' },
          (() => { const b = el('button', { type: 'button', class: 'tool', html: `${icon('eye', 13)} Preview` }); b.addEventListener('click', () => previewDot(p)); return b; })(),
          (() => { const b = el('button', { type: 'button', class: 'tool', html: `${icon('camera', 13)} Use this view` }); b.addEventListener('click', () => captureView(p)); return b; })(),
        ),
      ));
    } else if (p.kind === 'fixture' || p.kind === 'piece') {
      d.append(...transformPanel(p), ...kitPanels(p));
    } else if (p.premium) {
      const D = p.data;
      d.append(...transformPanel(p), section('SURFACE'), panel(
        colorField({ label: 'Colour', value: D.colour, onChange: (v) => level.setSurface(p, 'colour', v) }),
        rangeField({ label: 'Roughness', value: D.roughness, min: 0, max: 1, step: 0.01, onInput: (v) => level.setSurface(p, 'roughness', v) }),
        rangeField({ label: 'Metalness', value: D.metalness, min: 0, max: 1, step: 0.01, onInput: (v) => level.setSurface(p, 'metalness', v) }),
      ));
      if (p.kind === 'import') d.append(panel(el('p', {}, 'Imported models stay for this session; export or re-import them after a reload.')));
    }
    if (p && p.builtIn && p.kind !== 'hotspot') d.append(el('p', { class: 'muted-note' }, 'Built-in lobby placement: it can be hidden but not deleted.'));
    hydrate(d);
    d.scrollTop = scroll;
  }

  // Fixture or piece: swap the type in place, its own parameters, and (pieces) a finish.
  function kitPanels(p) {
    const fixture = p.kind === 'fixture';
    const lib = fixture ? FIXTURES : PIECES, D = p.data, def = lib[D.type];
    const typeButton = ([type, t]) => {
      const b = el('button', { type: 'button', class: `prop-type${type === D.type ? ' active' : ''}`, title: `${t.label} · ${t.note}`, html: `${icon(t.icon, 18)}<span>${t.label}</span>` });
      b.addEventListener('click', () => { if (type === D.type) return; level.setKitType(p, type); renderDetails(); toast(`Now a ${t.label.toLowerCase()} · same place`); });
      return b;
    };
    const entries = Object.entries(lib).filter(([, t]) => fixture || t.category === def.category);
    const types = el('div', { class: 'prop-types' }, ...entries.map(typeButton));
    const fields = Object.entries(def.params).map(([key, q]) => {
      if (q.kind === 'toggle') return toggle({ label: q.label, value: !!D.params[key], onChange: (v) => { level.setKitParam(p, key, v); } });
      if (q.kind === 'colour') return colorField({ label: q.label, value: D.params[key], onChange: (v) => { level.setKitParam(p, key, v); renderTree(); } });
      if (q.kind === 'seed') {
        const row = el('div', { class: 'action-row' });
        const b = el('button', { type: 'button', class: 'tool', html: `${icon('reset', 13)} ${q.label} ${D.params[key]}` });
        b.addEventListener('click', () => { level.setKitParam(p, key, (D.params[key] % 99) + 1); renderDetails(); });
        row.append(b);
        return row;
      }
      return rangeField({ label: q.label, value: D.params[key], min: q.min, max: q.max, step: q.step, unit: q.unit === 'm' ? ' m' : q.unit, onInput: (v) => level.setKitParam(p, key, v), onChange: () => renderTree() });
    });
    const out = [section(fixture ? 'FIXTURE' : 'PIECE', el('small', { class: 'section-note' }, 'swap in place')), panel(types)];
    if (fixture) {
      const aim = el('button', { type: 'button', class: 'tool', html: `${icon('frame', 13)} Aim at car` });
      aim.addEventListener('click', () => { level.aim(p); renderDetails(); });
      out.push(section('LIGHT'), panel(...fields, el('div', { class: 'action-row' }, aim)));
    } else {
      out.push(section('SHAPE'), panel(...fields.length ? fields : [el('p', {}, 'This piece has a fixed shape; scale it in Transform.')]));
      const current = D.finish === 'default' ? null : D.finish;
      const swatches = el('div', { class: 'finish-tiles' }, ...PIECE_FINISHES.map((id) => {
        const f = SURFACE_FINISHES[id];
        const bg = f.texture ? `url(${surfaceSwatch(f.texture)})` : f.colour;
        const b = el('button', { type: 'button', class: `finish-tile${current === id ? ' active' : ''}${f.metalness ? ' metal' : ''}${f.opacity ? ' clear' : ''}`, title: f.label, style: `--img:${bg};--tint:${f.texture ? f.colour : 'transparent'}` }, el('i'));
        b.addEventListener('click', () => { level.setPieceFinish(p, id); renderDetails(); });
        return b;
      }));
      const curLabel = current ? SURFACE_FINISHES[current].label : 'Original';
      out.push(section('FINISH', el('small', { class: 'section-note' }, D.colour ? 'custom colour' : curLabel)), panel(
        swatches,
        colorField({ label: 'Colour', value: D.colour || (current && !SURFACE_FINISHES[current].texture ? SURFACE_FINISHES[current].colour : '#ffffff'), onChange: (v) => { level.setPieceColour(p, v); renderDetails(); } }),
        (() => { const b = el('button', { type: 'button', class: 'tool', html: `${icon('reset', 13)} Original finish` }); b.addEventListener('click', () => { level.setPieceFinish(p, 'default'); renderDetails(); }); return el('div', { class: 'action-row' }, b); })(),
      ));
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------- levels
  // The level library lives in this browser. Opening another level saves this one and reloads into it.
  function openLevel(id) {
    level.save();
    const lib = readLibrary();
    lib.active = id;
    writeLibrary(lib);
    const q = new URLSearchParams(location.search); q.delete('fresh'); q.set('level', id);
    location.search = q.toString();
  }
  function resetLevel() {
    if (!confirm(`Reset “${level.name}” to its ${(TEMPLATES[level.template] || TEMPLATES.studio).label} template? Pieces, lights, dots and colours go back to the start.`)) return;
    const lib = readLibrary();
    if (lib.levels[level.id]) lib.levels[level.id].snapshot = null;
    writeLibrary(lib);
    level.save = () => {};    // don't write this level back on the way out
    location.reload();
  }
  function renderLevels() {
    const lib = readLibrary();
    const list = $('LevelList');
    list.replaceChildren();
    for (const id of lib.order) {
      const e = lib.levels[id];
      const current = id === level.id;
      const tpl = TEMPLATES[e.template] || TEMPLATES.studio;
      const sum = current ? { set: L.settings.set, pieces: level.counts.pieces, lights: level.counts.lights, dots: level.counts.hotspots } : (e.summary && e.summary.set ? e.summary : { set: tpl.set, pieces: tpl.pieces.length, lights: (RIGS[tpl.rig] || { fixtures: [] }).fixtures.length, dots: 6 });
      const pr = SETS[sum.set] || SETS.studio;
      const thumb = el('span', { class: 'level-thumb', style: setThumb(sum.set, current ? L.settings.floor.preset : pr.floor) }, el('span', { html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${pr.icon}</svg>` }));
      const name = current ? level.name : e.name;
      const tools = el('div', { class: 'level-tools' });
      const mk = (ic, title, fn) => { const b = el('button', { type: 'button', class: 'tool round', title, html: icon(ic, 13) }); b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); }); return b; };
      tools.append(
        mk('copy', 'Duplicate', () => {
          if (current) level.save();
          const l2 = readLibrary();
          const src = l2.levels[id];
          const nid = createLevelEntry(l2, { name: `${src.name} copy`, template: src.template, snapshot: src.snapshot ? { ...src.snapshot, name: `${src.name} copy` } : null });
          l2.levels[nid].summary = src.summary;
          writeLibrary(l2); renderLevels(); toast(`${src.name} duplicated`);
        }),
        mk('trash', 'Delete', () => {
          if (lib.order.length < 2) { toast('A project keeps at least one level'); return; }
          if (!confirm(`Delete “${name}”?`)) return;
          const l2 = readLibrary();
          delete l2.levels[id];
          l2.order = l2.order.filter((x) => x !== id);
          writeLibrary(l2);
          if (current) { level.save = () => {}; openLevel(l2.order[0]); } else renderLevels();
        }),
      );
      const card = el('button', { type: 'button', class: `level-row${current ? ' active' : ''}` }, thumb,
        el('div', {}, el('b', {}, name, current ? el('i', { class: 'root-tag' }, 'OPEN') : null), el('small', {}, `${pr.label} · ${sum.pieces} pieces · ${sum.lights} lights · ${sum.dots} dots`)), tools);
      card.addEventListener('click', () => { if (!current) openLevel(id); });
      list.append(card);
    }
    const tiles = $('TemplateList');
    tiles.replaceChildren();
    for (const [tid, t] of Object.entries(TEMPLATES)) {
      const pr = SETS[t.set];
      const b = el('button', { type: 'button', class: 'template-tile', title: t.note, style: setThumb(t.set, t.floor || pr.floor) }, el('i', { html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${pr.icon}</svg>` }), el('b', {}, t.label), el('small', {}, t.note));
      b.addEventListener('click', () => {
        level.save();
        const l2 = readLibrary();
        const taken = new Set(Object.values(l2.levels).map((e) => e.name));
        let n = t.label, k = 2; while (taken.has(n)) n = `${t.label} ${k++}`;
        const nid = createLevelEntry(l2, { name: n, template: tid });
        writeLibrary(l2);
        openLevel(nid);
      });
      tiles.append(b);
    }
  }

  function setThumb(setId, floorId) {
    const s = SETS[setId] || SETS.studio, f = FLOORS[floorId] || FLOORS.concrete;
    const floor = f.texture ? `url(${surfaceSwatch(f.texture, 64)}) center/cover` : f.colour;
    return `--g:linear-gradient(180deg, ${s.sky.zenith}, ${s.sky.horizon});--f:${floor}`;
  }
  function kelvinHex(k) { return new THREE.Color(kelvinColour(k)).getHexString(); }
  function previewDot(p) { stage.rig.flyTo(level.configurator.viewOf(p.spot), { duration: 0.8 }); }
  function captureView(p) {
    const rig = stage.rig, v = level.vehicle;
    const local = v.body.worldToLocal(rig.goal.target.clone());
    p.spot.view = { yaw: Math.round(deg(rig.goal.yaw - v.root.rotation.y)), pitch: Math.round(deg(rig.goal.pitch)), distance: +rig.goal.distance.toFixed(2), target: local.toArray().map((x) => +x.toFixed(3)) };
    level.changed('edit');
    renderDetails();
    toast('Dot view set to the current camera');
  }

  // ------------------------------------------------------------------------------------- delete / copy
  function deleteSelected() {
    const p = state.selected;
    if (!p) return;
    if (!(p.removable || p.kind === 'hotspot')) { toast(`${p.name} is part of the lobby · hide it instead`); return; }
    level.remove(p);
    select(null);
    toast(`${p.name} removed`);
  }
  function duplicateSelected() {
    const p = state.selected;
    if (!p) return;
    if (p.premium && level.tier !== 'premium') return;
    const copy = level.duplicate(p);
    if (copy) { applyHelpers(); select(copy); toast(`${copy.name} duplicated`); }
  }

  // ------------------------------------------------------------------------------------------- play mode
  let exitTimer = 0;
  function setPlaying(on) {
    state.playing = on;
    if (state.visiting) { state.visiting = null; visitTag.hidden = true; level.configurator.visible = state.dots; }
    document.body.classList.toggle('playing', on);
    $('StateTag').textContent = on ? 'LOBBY' : 'DESIGN';
    $('StateTag').classList.toggle('live', on);
    level.configurator.close(false);
    for (const p of level.placements) if (p.kind === 'hotspot') p.spot.dot.classList.toggle('selected', !on && p === state.selected);
    if (on) setDots(true);
    applyHelpers();
    syncGizmo();
    stage.rig.turntable = on && state.idleOrbit;
    heroView(on ? 1.2 : 0.8);
    if (on) wakeExit();
  }
  function wakeExit() {
    const b = $('LobbyExit');
    b.classList.add('awake');
    clearTimeout(exitTimer);
    exitTimer = setTimeout(() => b.classList.remove('awake'), 2200);
  }
  well.addEventListener('pointermove', () => { if (state.playing) wakeExit(); });
  $('LobbyExit').addEventListener('click', () => setPlaying(false));
  $('PlayBtn').addEventListener('click', () => setPlaying(true));

  // ------------------------------------------------------------------------------------------- keyboard
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('AddMenu').hidden) { hideAddMenu(); return; }
    if (e.target.matches('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') {
      if (level.configurator.active) level.configurator.close();
      else if (state.visiting) visit(null);
      else if (state.playing) setPlaying(false);
      else if (!$('AddMenu').hidden) hideAddMenu();
      else select(null);
      return;
    }
    if (state.playing) {
      if (state.visiting) return;
      if (e.key === 'ArrowRight') level.configurator.active ? level.configurator.step(1) : level.configurator.focus(level.configurator.spots.find((s) => s.shown));
      if (e.key === 'ArrowLeft') level.configurator.active ? level.configurator.step(-1) : level.configurator.focus(level.configurator.spots.find((s) => s.shown));
      return;
    }
    if (stage.rig.flying) return;
    if (k === 'q') setTool('select');
    else if (k === 'w') setTool('move');
    else if (k === 'e') setTool('rotate');
    else if (k === 'f') frameSelection();
    else if (k === 'h') setDots(!state.dots);
    else if (k === 'p') setPlaying(true);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected) { e.preventDefault(); deleteSelected(); }
    else if (k === 'd' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); duplicateSelected(); }
  });

  // -------------------------------------------------------------------------------------------- readout
  setInterval(() => {
    if (state.playing) return;
    const s = L.settings.sun, p = state.selected;
    const pos = p && p.movable ? p.object.position : null;
    $('Readout').textContent = [
      `${level.name.toUpperCase()} · ${state.tool === 'select' ? 'SELECT' : state.tool === 'move' ? 'MOVE' : 'TURN'}${gizmo.snap ? ' · SNAP' : ''}`,
      `${level.vehicle.triangles.toLocaleString()} car tris · ${Math.round(stage.stats.fps)} fps`,
      `sun ${Math.round(s.azimuth)}° / ${Math.round(s.elevation)}°`,
      pos ? `${p.name}  ${pos.x.toFixed(2)}  ${pos.y.toFixed(2)}  ${pos.z.toFixed(2)}` : '',
    ].join('\n');
    $('Strip').textContent = `LEVEL DESIGNER · ${level.name.toUpperCase()} · ${SETS[L.settings.set].label.toUpperCase()} · ${(RIGS[L.settings.rig] || { label: 'Custom light' }).label.toUpperCase()} · ${level.counts.placements} PLACEMENTS · ${level.tier.toUpperCase()}`;
  }, 250);

  level.on((what) => {
    if (what === 'players') {
      syncTags();
      renderTree();
      // Refresh the details if they show the places, unless the designer is mid-drag on one of its sliders.
      const busy = document.activeElement && document.activeElement.closest && document.activeElement.closest('#Details input[type=range]');
      const p = state.selected;
      if (!busy && (!p || p.group === 'places')) renderDetails();
      return;
    }
    if (what === 'visibility') syncTags();
    if (['add', 'remove', 'visibility', 'rename', 'finish'].includes(what)) renderTree();
    if (['add', 'remove', 'rename'].includes(what)) renderContent();
    if (['add', 'remove', 'edit', 'transform'].includes(what)) occluderClock = 0;
  });

  function renderAll() { renderTree(); renderDetails(); renderContent(); }

  for (const id of ['LevelName', 'SceneTitle', 'DocTab']) $(id).textContent = level.name;
  hydrate(document);
  setTier(level.tier);
  renderAll();
  return { select, setPlaying, setTool, heroView, setTier, visit, state, focusZone: (zone) => { const s = level.configurator.spots.find((x) => x.zone === zone); if (s) level.configurator.focus(s); }, level };
}
