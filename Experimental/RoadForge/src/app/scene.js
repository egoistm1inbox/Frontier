// RoadForge — scene assembly.
//
// Owns the network, the built geometry, props, traffic and lighting, and
// knows how to rebuild each stage when the editor changes a setting.

import { generate, PRESETS } from '../road/generator.js';
import { buildNetwork, flatGround } from '../road/build.js';
import { buildStructures, buildTrackwork } from '../road/structures.js';
import { buildBlocks, buildGround } from '../road/blocks.js';
import { buildPropAtlas } from '../props/library.js';
import { placeProps, buildRailings, VEHICLE_TYPES, TRAIN_TYPES } from '../props/placement.js';
import { TrafficSim, TrainSim } from '../traffic/traffic.js';
import { ROAD_CLASSES, CLASS_ORDER } from '../road/network.js';
import { defaultStacks, STACK_ORDER, packStack } from '../texture/stack.js';
import { clamp } from '../core/math.js';
import { EdgeCurve } from '../road/curve.js';

export const DEFAULT_SETTINGS = {
  preset: 'district',
  seed: 20260411,
  extent: 320,
  block: 68,
  density: 0.72,
  curviness: 0.35,
  relief: 0,
  highway: true,
  rail: true,
  quality: 1,

  markings: true,
  wear: 0.55,
  potholes: true,
  calming: true,
  works: true,
  parking: true,

  structures: true,
  tunnels: true,
  trackwork: true,
  railings: true,

  lighting: true,
  signals: true,
  bollards: true,
  furniture: true,
  billboards: true,
  worksKit: true,
  propDensity: 1,

  blocks: true,
  ground: true,

  traffic: true,
  vehicles: 18,
  trains: true,

  // environment
  timeOfDay: 15.2,
  sunAzimuth: 2.3,
  exposure: 1.05,
  cloudCover: 0.35,
  fog: 0.0016,
  wetness: 0.0,
  shadows: true,
  ao: 0.85,
  vignette: 0.35,
  grain: 0.22,
};

export class Scene {
  constructor(renderer) {
    this.r = renderer;
    this.settings = { ...DEFAULT_SETTINGS };
    this.classOverrides = {};
    for (const c of CLASS_ORDER) this.classOverrides[c] = {};
    this.visible = {};
    this.stacks = defaultStacks();
    this.net = null;
    this.build = null;
    this.mesh = null;
    this.blocks = [];
    this.staticLights = [];
    this.lightScratch = [];
    this.traffic = null;
    this.trains = null;
    this.selection = { kind: null, id: null };
    this.stats = {};
    this.propAtlas = buildPropAtlas();
    this.r.setPropMesh(this.propAtlas.mesh);
    this.packed = null;
    this.signalMeta = [];
    this.dirty = false;
    this.wantWire = false;   // quad-topology overlay buffer is opt-in
  }

  get presets() { return PRESETS; }

  /* ------------------------------------------------------------ texture */

  bakeAll() {
    const t0 = performance.now();
    for (const id of STACK_ORDER) {
      const st = this.stacks[id];
      if (!st) continue;
      this.r.baker.bakeSlot(st.slot, packStack(st), this.settings.seed % 9973);
    }
    this.stats.bakeMs = performance.now() - t0;
  }

  bakeSlot(id) {
    const st = this.stacks[id];
    if (!st) return;
    this.r.baker.bakeSlot(st.slot, packStack(st), this.settings.seed % 9973);
  }

  /* ------------------------------------------------------------ network */

  generate(presetId = this.settings.preset, over = {}) {
    const s = { ...this.settings, ...over, preset: presetId };
    this.settings = s;
    this.net = generate(presetId, {
      seed: s.seed, extent: s.extent, block: s.block, density: s.density,
      curviness: s.curviness, relief: s.relief, highway: s.highway, rail: s.rail,
    });
    this.applyFeatureFlags();
    this.selection = { kind: null, id: null };
    this.rebuild();
  }

  /** Feature toggles that live on edges rather than in the builder. */
  applyFeatureFlags() {
    const s = this.settings;
    for (const e of this.net.edges.values()) {
      const ov = this.classOverrides[e.cls] || {};
      for (const [k, v] of Object.entries(ov)) {
        if (v !== undefined && v !== null) e[k] = v;
      }
      if (!s.calming) e.bumps = [];
      if (!s.works) e.construction = null;
      if (!s.parking) { e.parkingL = 0; e.parkingR = 0; }
      e.wear = clamp((e.baseWear ?? (e.baseWear = e.wear)) * s.wear * 1.6, 0, 1);
      if (!s.potholes) e.damage = 0;
      else e.damage = e.baseDamage ?? (e.baseDamage = e.damage ?? 1);
    }
  }

  rebuild() {
    if (!this.net) return;
    const s = this.settings;
    const t0 = performance.now();
    this.applyFeatureFlags();

    const build = buildNetwork(this.net, {
      quality: s.quality, groundAt: flatGround, seed: s.seed, markings: s.markings,
    });
    this.build = build;
    const mb = build.mb;

    if (s.structures) {
      const clearance = makeClearance(this.net, build);
      buildStructures(mb, build.structures, { groundAt: flatGround, clearance });
    }
    if (s.trackwork) buildTrackwork(mb, this.net, build.curves, build.profiles, { trims: build.trims });
    if (s.railings) buildRailings(mb, this.net, build, { groundAt: flatGround });
    this.blocks = s.blocks ? buildBlocks(mb, this.net, build.profiles, { seed: s.seed, groundAt: flatGround }) : [];
    const bounds0 = mb.bounds();
    if (s.ground) buildGround(mb, bounds0, { groundAt: flatGround, pad: 300 });

    const mesh = mb.finish({ wire: this.wantWire !== false });
    this.mesh = mesh;
    this.r.setRoadMesh(mesh);
    this.r.setRoadParams(build.roadParams);

    this.placeAll();

    this.stats = {
      ...this.stats,
      nodes: this.net.nodes.size,
      edges: this.net.edges.size,
      verts: mesh.vertexCount,
      quads: mesh.quadCount,
      tris: mesh.triCount,
      indices: mesh.indices.length,
      structures: build.structures.length,
      blocks: this.blocks.length,
      buildMs: performance.now() - t0,
      bounds: mesh.bounds,
    };
    this.dirty = false;
  }

  placeAll() {
    const s = this.settings;
    const { set, lights } = placeProps({
      net: this.net, build: this.build,
      opts: {
        seed: s.seed, groundAt: flatGround, propDensity: s.propDensity,
        lighting: s.lighting,
      },
    });
    // layer filters
    const drop = new Set();
    if (!s.lighting) ['lamp_street', 'lamp_motorway', 'lamp_heritage'].forEach((n) => drop.add(n));
    if (!s.signals) ['signal_mast', 'signal_post', 'signal_ped'].forEach((n) => drop.add(n));
    if (!s.bollards) ['bollard_steel', 'bollard_granite', 'bollard_bell', 'bollard_lit'].forEach((n) => drop.add(n));
    if (!s.furniture) ['bench', 'bin', 'tree', 'planter', 'hydrant', 'meter'].forEach((n) => drop.add(n));
    if (!s.billboards) ['billboard', 'sign_round', 'sign_board'].forEach((n) => drop.add(n));
    if (!s.worksKit) ['cone', 'barrier_jersey', 'barrier_fence', 'works_board', 'site_hut', 'pipe_stack'].forEach((n) => drop.add(n));
    if (!s.parking) ['car_sedan', 'car_hatch', 'car_suv', 'van'].forEach((n) => drop.add(n));
    for (const n of drop) set.byType.get(n).length = 0;

    const reserve = [
      ...VEHICLE_TYPES.map((v) => ({ name: v.name, n: v.n })),
      ...TRAIN_TYPES.map((v) => ({ name: v.name, n: v.n })),
    ];
    this.packed = set.pack(reserve);
    // bind each draw to its slice of the prop atlas index buffer
    for (const d of this.packed.draws) {
      const r = this.propAtlas.draws[d.name];
      if (!r) { d.indexOffset = 0; d.indexCount = 0; d.instanceCount = 0; continue; }
      d.indexOffset = r.indexOffset;
      d.indexCount = r.indexCount;
    }
    this.staticLights = s.lighting ? lights : lights.filter((l) => l.kind >= 3);

    this.traffic = new TrafficSim(this.net, this.build, { seed: s.seed, count: s.vehicles });
    this.trains = new TrainSim(this.net, this.build, { seed: s.seed });

    this.r.setInstances(this.packed.data, this.packed.draws);
    this.r.setLights(this.staticLights);
    this.lightsDirty = false;
    this.stats.props = this.packed.staticCount;
    this.stats.lights = this.staticLights.length;
    this.stats.lanes = this.traffic.graph.lanes.length;
  }

  /* ------------------------------------------------------------- runtime */

  update(dt, env) {
    const s = this.settings;
    if (!this.packed) return;
    this.traffic.setCount(s.traffic ? s.vehicles : 0);
    this.traffic.update(dt, true);
    this.trains.update(dt, s.trains);

    const vcounts = this.traffic.writeInstances(this.packed.data, this.packed.slots);
    const tcounts = this.trains.writeInstances(this.packed.data, this.packed.slots, s.trains);
    for (const d of this.packed.draws) {
      if (!d.dynamic) continue;
      d.instanceCount = (vcounts.get(d.name) ?? tcounts.get(d.name) ?? 0);
    }
    // only the dynamic tail needs re-uploading
    const first = this.packed.slots.size
      ? Math.min(...[...this.packed.slots.values()].map((v) => v.first))
      : 0;
    const off = first * 24;
    this.r.device.queue.writeBuffer(
      this.r.instBuf, off * 4,
      this.packed.data, off, this.packed.data.length - off,
    );
    this.r.propDraws = this.packed.draws;

    // night headlights join the clustered light set
    const night = env.night;
    if (night > 0.03 && s.traffic) {
      this.lightScratch.length = 0;
      for (const L of this.staticLights) this.lightScratch.push(L);
      this.traffic.headlights(this.lightScratch, night);
      this.r.setLights(this.lightScratch);
      this.lightsDirty = true;
    } else if (this.lightsDirty) {
      this.r.setLights(this.staticLights);
      this.lightsDirty = false;
    }
  }

  /* ----------------------------------------------------------- selection */

  moveNode(id, pos) {
    const n = this.net.node(id);
    if (!n) return;
    n.x = pos[0]; n.y = pos[1]; n.z = pos[2];
    this.dirty = true;
  }

  /* --- live drag: ghost the affected arms instead of rebuilding ------- */

  beginDrag(nodeId) {
    const incident = this.net.edgesAt(nodeId);
    this.preview = {
      nodeId,
      edges: incident.map((e) => ({
        edge: e,
        profile: this.build.profiles.get(e.id),
        curve: this.build.curves.get(e.id),
      })),
      far: new Set(incident.map((e) => (e.a === nodeId ? e.b : e.a))),
    };
  }

  dragTo(nodeId, pos) {
    this.moveNode(nodeId, pos);
    const pv = this.preview;
    if (!pv) return;
    for (const item of pv.edges) {
      item.curve = new EdgeCurve(this.net, item.edge, 40);
    }
  }

  endDrag() {
    this.preview = null;
    this.rebuild();
  }

  classCount(cls) {
    let n = 0;
    for (const e of this.net.edges.values()) if (e.cls === cls) n++;
    return n;
  }

  junctionCount() {
    let n = 0;
    for (const nd of this.net.nodes.values()) if (this.net.degree(nd.id) >= 3) n++;
    return n;
  }
}

/** Keeps viaduct piers out of live carriageways. */
function makeClearance(net, build) {
  const segs = [];
  for (const e of net.edges.values()) {
    const curve = build.curves.get(e.id);
    const prof = build.profiles.get(e.id);
    if (!curve || !prof) continue;
    const step = Math.max(3, curve.length / 40);
    for (let s = 0; s <= curve.length; s += step) {
      const fr = curve.frameAt(s);
      segs.push([fr.p[0], fr.p[2], prof.roadHalf + 1.4, fr.p[1]]);
    }
  }
  return (x, z, y = 0) => {
    for (const sg of segs) {
      if (Math.abs(sg[3] - y) > 3.5) continue;
      const dx = x - sg[0], dz = z - sg[1];
      if (dx * dx + dz * dz < sg[2] * sg[2]) return false;
    }
    return true;
  };
}

export { ROAD_CLASSES, CLASS_ORDER, STACK_ORDER };
