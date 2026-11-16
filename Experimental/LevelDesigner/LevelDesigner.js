// Level Designer workspace: outliner (left), viewport with select / move / turn tools (centre), Details (right), and
// the Lobby play mode that hides all of it and leaves only the configurator dots. Same docks, tabs, panels and
// controls as the Component Viewer (Shared/Studio).
import { THREE } from '../Shared/Studio/Render.js';
import { createCameraHud } from '../Shared/Studio/Camera.js';
import { $, el, section, panel, rangeField, segmentedField, toggle, selectField, vec3Field, colorField, textField, metrics, toast, download } from '../Shared/Studio/Ui.js';
import { IMPORT_FORMATS } from '../Shared/GeometryCompile/Engine/ImportFormats.js';
import { icon, iconEl, hydrate } from './LevelIcons.js';
import { TransformGizmo } from './Gizmo.js';
import { GROUPS, ADDABLE, STORAGE_KEY } from './Level.js';
import { LOBBY_PRESETS } from './Lobby.js';
import { ZONES, sameColour } from './Configurator.js';
import { FINISHES } from './Vehicle.js';

const KIND_LABEL = {
  sky: 'Sky dome', sun: 'Directional light', floor: 'Reflective floor', walls: 'Cyclorama wall', slab: 'Lobby slab', turntable: 'Turntable', arches: 'Light arches',
  vehicle: 'Configurable vehicle', hotspot: 'Configurator dot', 'light-point': 'Point light', 'light-spot': 'Spot light', 'light-strip': 'Light strip',
  'shape-plinth': 'Plinth', 'shape-block': 'Block', 'shape-sphere': 'Sphere', 'shape-panel': 'Wall panel', 'shape-arch': 'Arch', import: 'Imported model',
};
const deg = THREE.MathUtils.radToDeg, rad = THREE.MathUtils.degToRad;

export function createLevelDesigner({ stage, level }) {
  const well = $('ViewportWell');
  const L = level.lobby;
  const state = { selected: null, tool: 'select', search: '', playing: false, dots: true, helpers: true, idleOrbit: true };
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
    if (moved > 4 || state.playing) return;
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
  const viewBar = el('div', { class: 'segmented' });
  for (const [id, label] of [['hero', 'Hero'], ['front', 'Front'], ['side', 'Side'], ['rear', 'Rear'], ['top', 'Top']]) {
    const b = el('button', { type: 'button' }, label);
    b.addEventListener('click', () => namedView(id));
    viewBar.append(b);
  }
  $('ViewBar').append(viewBar);
  createCameraHud(stage.rig, well);

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
    const show = state.helpers && !state.playing;
    for (const p of level.byGroup('lights')) if (p.glyph.userData.helper) p.glyph.visible = show;
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
    if (kind.startsWith('light-')) p = level.addLight(kind, { position: kind === 'light-strip' ? [t.x, 3.6, t.z + 2.4] : [t.x + 2.4, 3.2, t.z + 2.8], colour: kind === 'light-spot' ? '#fff1dc' : '#ffffff' });
    else if (kind === 'hotspot') p = level.addHotspot();
    else if (kind === 'import') { $('FileInput').click(); return; }
    else p = level.addShape(kind, { position: [-4.4 + Math.random() * 0.6, 0, 2.6 + Math.random() * 0.6] });
    applyHelpers();
    if (p) { select(p); setTool('move'); toast(`${p.name} added · drag the arrows to place it`); }
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
    });
  }
  $('ImportFormats').append(...IMPORT_FORMATS.filter((f) => f.reads).map((f) => el('span', { class: 'chip' }, f.label)));

  function renderContent() {
    const list = $('PieceList');
    list.replaceChildren();
    const locked = level.tier !== 'premium';
    $('ImportBtn').classList.toggle('stale', locked);
    for (const a of ADDABLE.filter((x) => x.kind.startsWith('shape-'))) {
      const place = el('button', { type: 'button', class: 'tool' }, locked ? iconEl('lock', 12) : null, 'Place');
      place.addEventListener('click', () => addThing(a.kind));
      list.append(el('div', { class: `piece-row${locked ? ' locked' : ''}` }, el('span', { class: 'piece-glyph', html: icon(a.icon, 22) }), el('div', {}, el('b', {}, a.label), el('small', {}, a.note)), place));
    }
    if (locked) list.append(el('div', { class: 'premium-note' }, iconEl('premium', 14), el('div', {}, 'Lobby pieces and imported models are part of Premium. Basic levels keep the built-in lobby, environment, lights and dots.', el('br'), unlockButton())));
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
    } else if (p.kind.startsWith('light-')) extra = el('i', { class: 'dot-swatch', style: `--c:${p.data.colour}` });
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
      el('div', {}, el('b', {}, level.name, el('i', { class: 'root-tag' }, 'LEVEL')), el('small', {}, `${LOBBY_PRESETS[L.settings.preset] ? LOBBY_PRESETS[L.settings.preset].label : 'Custom'} · ${level.tier}`)), el('span'), el('span'));
    root.style.paddingLeft = '10px';
    root.addEventListener('click', () => select(null));
    tree.append(root);
    for (const g of GROUPS) {
      const items = level.byGroup(g.id).filter(match);
      const locked = g.id === 'custom' && level.tier !== 'premium';
      if (q && !items.length) continue;
      tree.append(el('div', { class: 'group-row' }, iconEl(g.icon, 16), el('div', {}, el('b', {}, g.label), el('small', {}, g.note)), locked ? el('span', { class: 'lock-tag', html: icon('lock', 13), title: 'Premium' }) : el('span', { class: 'count' }, String(level.byGroup(g.id).length))));
      if (locked) {
        tree.append(el('div', { class: 'premium-note' }, iconEl('premium', 14), el('div', {}, 'Premium designers place their own pieces and models in the Lobby.', el('br'), unlockButton())));
        continue;
      }
      if (g.id === 'vehicle') {
        for (const p of items.filter((x) => x.kind === 'vehicle')) tree.append(row(p));
        for (const p of items.filter((x) => x.kind === 'hotspot')) tree.append(row(p, { child: true }));
      } else for (const p of items) tree.append(row(p));
      if (!items.length) tree.append(el('p', { class: 'tree-empty' }, g.id === 'lights' ? 'No added lights. Add → Point, Spot or Light strip.' : 'Nothing placed yet. Add → Lobby pieces, or import a model from Content.'));
    }
    $('StatPlacements').textContent = String(level.placements.length);
    $('StatDots').textContent = String(level.counts.hotspots);
  }

  // -------------------------------------------------------------------------------------------- details
  function head(p) {
    const glyph = el('div', { class: 'detail-glyph', html: icon(p ? p.icon || 'dot' : 'root', 22) });
    const name = el('input', { class: 'name-input', value: p ? p.name : level.name, 'aria-label': 'Name' });
    name.addEventListener('change', () => {
      if (p) p.name = name.value || p.name; else { level.name = name.value || 'Lobby'; $('LevelName').textContent = level.name; $('SceneTitle').textContent = level.name; }
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

  function presetTiles() {
    const tiles = el('div', { class: 'preset-tiles' });
    for (const [id, pr] of Object.entries(LOBBY_PRESETS)) {
      const b = el('button', { type: 'button', class: `preset-tile${L.settings.preset === id ? ' active' : ''}`, title: pr.note, style: `--g:linear-gradient(180deg, ${pr.sky.zenith}, ${pr.sky.horizon} 45%, ${pr.walls.colour} 45%);--f:${pr.floor.colour}` }, el('i'), pr.label);
      b.addEventListener('click', () => { L.usePreset(id); level.seatVehicle(); level.changed('preset'); renderAll(); toast(`${pr.label} · ${pr.note}`); });
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
          metrics([[c.placements, 'PLACEMENTS'], [c.hotspots, 'CONFIGURATOR DOTS'], [c.lights, 'ADDED LIGHTS'], [level.tier === 'premium' ? c.custom : '—', 'YOUR PIECES']]),
          segmentedField({ label: 'Account tier', value: level.tier, options: [{ id: 'basic', label: 'Basic' }, { id: 'premium', label: 'Premium' }], onChange: setTier, note: 'Basic: built-in lobby, environment, lights and dots. Premium: also your own pieces and imported models.' }),
        ),
        section('ENVIRONMENT'),
        panel(presetTiles(), el('p', {}, 'Neutral by default. Fine-tune the Sky, Sun, Floor and Cyclorama from the outliner, or add lights.')),
        section('LOBBY'),
        panel(
          el('p', {}, 'Players see the Lobby without any interface: only the dots on the car. A dot flies the camera to its part and opens its colours.'),
          toggle({ label: 'Slow orbit when idle', value: state.idleOrbit, onChange: (v) => { state.idleOrbit = v; } }),
          (() => { const b = el('button', { type: 'button', class: 'primary wide', html: `${icon('play', 13)} Play lobby` }); b.addEventListener('click', () => setPlaying(true)); return b; })(),
        ),
        section('FILE'),
        panel(el('div', { class: 'action-row' },
          (() => { const b = el('button', { type: 'button', class: 'tool', html: `${icon('download', 13)} Export JSON` }); b.addEventListener('click', () => download(`${level.name.replace(/\W+/g, '')}.level.json`, JSON.stringify(level.snapshot(), null, 2), 'application/json')); return b; })(),
          (() => { const b = el('button', { type: 'button', class: 'tool', html: `${icon('reset', 13)} Reset level` }); b.addEventListener('click', () => { localStorage.removeItem(STORAGE_KEY); location.search = '?fresh=1'; }); return b; })(),
        ), el('p', {}, 'The level saves in this browser as you edit. Imported models stay for the session only.')),
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
      ), section('PRESETS'), panel(presetTiles()));
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
      d.append(section('FLOOR'), panel(
        colorField({ label: 'Colour', value: S.floor.colour, onChange: edit((v) => { S.floor.colour = v; L.applyFloor(); }) }),
        rangeField({ label: 'Gloss', value: S.floor.gloss, min: 0, max: 1, step: 0.01, note: 'How much of the room the floor mirrors.', onInput: (v) => { S.floor.gloss = v; L.applyFloor(); }, onChange: () => level.changed('edit') }),
      ));
    } else if (p.kind === 'walls' || p.kind === 'slab') {
      if (p.kind === 'slab') d.append(...transformPanel(p));
      d.append(section('CYCLORAMA'), panel(
        colorField({ label: 'Wall colour', value: S.walls.colour, onChange: edit((v) => { S.walls.colour = v; L.applyWalls(); }) }),
        rangeField({ label: 'Height', value: S.walls.height, min: 2, max: 9, step: 0.1, unit: 'm', onChange: edit((v) => { S.walls.height = v; L.applyWalls(); }) }),
        rangeField({ label: 'Radius', value: S.walls.radius, min: 6, max: 24, step: 0.1, unit: 'm', onChange: edit((v) => { S.walls.radius = v; L.applyWalls(); }) }),
        rangeField({ label: 'Sweep', value: S.walls.sweep, min: 90, max: 330, step: 1, unit: '°', onChange: edit((v) => { S.walls.sweep = v; L.applyWalls(); }) }),
        rangeField({ label: 'Top curve', value: S.walls.wave, min: 0, max: 0.6, step: 0.01, note: 'Sweeps the top edge from high to low.', onChange: edit((v) => { S.walls.wave = v; L.applyWalls(); }) }),
      ));
    } else if (p.kind === 'turntable') {
      const T = S.turntable;
      d.append(...transformPanel(p), section('TURNTABLE'), panel(
        toggle({ label: 'Spin', value: T.spin, note: 'Turns the car parked on it', onChange: edit((v) => { T.spin = v; }) }),
        rangeField({ label: 'Speed', value: T.speed, min: 1, max: 40, step: 1, unit: '°/s', onInput: (v) => { T.speed = v; }, onChange: () => level.changed('edit') }),
        rangeField({ label: 'Radius', value: T.radius, min: 2, max: 6, step: 0.05, unit: 'm', onInput: (v) => { T.radius = v; L.applyTurntable(); }, onChange: () => { level.seatVehicle(); level.changed('edit'); } }),
        colorField({ label: 'Ring colour', value: T.ring, onChange: edit((v) => { T.ring = v; L.applyTurntable(); }) }),
        rangeField({ label: 'Ring glow', value: T.glow, min: 0, max: 1, step: 0.01, onInput: (v) => { T.glow = v; L.applyTurntable(); }, onChange: () => level.changed('edit') }),
      ));
    } else if (p.kind === 'arches') {
      const A = S.arches;
      d.append(section('LIGHT ARCHES'), panel(
        toggle({ label: 'Show arches', value: A.visible, onChange: edit((v) => { A.visible = v; L.applyArches(); renderTree(); }) }),
        rangeField({ label: 'Count', value: A.count, min: 1, max: 15, step: 1, onChange: edit((v) => { A.count = v; L.applyArches(); }) }),
        rangeField({ label: 'Spacing', value: A.spacing, min: 0.5, max: 2, step: 0.05, unit: 'm', onChange: edit((v) => { A.spacing = v; L.applyArches(); }) }),
        colorField({ label: 'Colour', value: A.colour, onChange: edit((v) => { A.colour = v; L.applyArches(); }) }),
        el('p', {}, 'The studio preset turns these on with a dark room, like a night photo booth.'),
      ));
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
    } else if (p.kind.startsWith('light-')) {
      const D = p.data;
      d.append(...transformPanel(p), section('LIGHT'), panel(
        colorField({ label: 'Colour', value: D.colour, onChange: (v) => { level.setLight(p, 'colour', v); } }),
        rangeField({ label: 'Strength', value: D.intensity, min: 0, max: p.kind === 'light-spot' ? 300 : 120, step: 0.5, onInput: (v) => level.setLight(p, 'intensity', v) }),
        rangeField({ label: 'Reach', value: D.range, min: 1, max: 40, step: 0.5, unit: 'm', onInput: (v) => level.setLight(p, 'range', v) }),
        p.kind === 'light-spot' ? rangeField({ label: 'Cone', value: D.angle, min: 5, max: 80, step: 1, unit: '°', onInput: (v) => level.setLight(p, 'angle', v) }) : null,
        p.kind === 'light-spot' ? toggle({ label: 'Cast shadows', value: D.shadow, onChange: (v) => level.setLight(p, 'shadow', v) }) : null,
        p.kind === 'light-strip' ? rangeField({ label: 'Length', value: D.length, min: 0.5, max: 8, step: 0.1, unit: 'm', onChange: (v) => level.setLight(p, 'length', v) }) : null,
      ));
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
      else if (state.playing) setPlaying(false);
      else if (!$('AddMenu').hidden) hideAddMenu();
      else select(null);
      return;
    }
    if (state.playing) {
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
    $('Strip').textContent = `LEVEL DESIGNER · ${level.name.toUpperCase()} · ${(LOBBY_PRESETS[L.settings.preset] || { label: 'Custom' }).label.toUpperCase()} · ${level.counts.placements} PLACEMENTS · ${level.tier.toUpperCase()}`;
  }, 250);

  level.on((what) => { if (['add', 'remove', 'visibility', 'rename', 'finish'].includes(what)) renderTree(); });

  function renderAll() { renderTree(); renderDetails(); renderContent(); }

  hydrate(document);
  setTier(level.tier);
  renderAll();
  return { select, setPlaying, setTool, heroView, setTier, state, focusZone: (zone) => { const s = level.configurator.spots.find((x) => x.zone === zone); if (s) level.configurator.focus(s); }, level };
}
