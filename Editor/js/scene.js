/* ══════════════════════════════════════════════════════════════════════════════════════════════
   SCENE.JS — the Project Zero feed (EditorFeedSequence.cpp). FillRoster walks the level's
   placements into outliner rows: the four stock folders (Scene · Lighting · World · Room) and,
   for this redesign, two more items families the C++ roster never carried — Vehicles and Cloth.
   Every non-folder row seats a coloured box in the viewport (a different colour per entry) and
   a property sheet the inspector draws through the same widget vocabulary as the C++ panels.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

"use strict";

/* ── the readout the three foot strips share (EditorReadout) ─────────────────────────────── */
const Readout = {
  fps: 60, quality: "Standard", pixels: "1280×720",
  sunElevation: 41.2, moonCount: 1, moonCap: 4,
  triangles: 0, cam: [0, 1.6, 3.2], scene: "Showcase",
};

/* ── tints, straight from EditorFeedSequence ─────────────────────────────────────────────── */
const T = {
  folder: [0.788, 0.635, 0.294],
  light:  [0.961, 0.827, 0.294],
  camera: [0.412, 0.765, 1.000],
  post:   [1.000, 0.541, 0.396],
  white:  [0.87, 0.88, 0.92],
};
const tintCss = (t, a = 1) =>
  `rgba(${Math.round(t[0]*255)},${Math.round(t[1]*255)},${Math.round(t[2]*255)},${a})`;

/* The viewport's per-entry colours: a different hue for every box. */
const ENTRY_HUES = [212, 28, 158, 268, 336, 86, 196, 16, 246, 122, 306, 54, 176, 8, 232, 104];

let SEQ = 1;
const row = (o) => Object.assign({
  key: SEQ++, label: "Node", depth: 0, category: "geometry",
  tint: T.white, art: null, glyph: null, narrowing: "auto",
  meta: "", tag: "", visible: true, locked: false, dynamic: false, physics: false,
  pinned: false, component: false, shut: false, standing: "auto", standingNote: "",
  box: null, state: {}, appearance: "generic",
}, o);

/* ── the roster, in the feed's order: Scene → Lighting → World → Room ────────────────────── */
const Roster = [
  row({ label: "Scene", depth: 0, category: "folder", tint: T.folder, glyph: "folder",
        art: "FolderScene", pinned: true, narrowing: "camera" }),
  row({ label: "Main Camera", depth: 1, category: "camera", tint: T.camera, art: "Camera",
        meta: "Live", narrowing: "camera", appearance: "camera",
        box: { p: [0.0, 1.55, 3.1], h: [0.17, 0.14, 0.26] },
        state: { fov: 55, aspect: 1, live: true, focus: 4.2, aperture: 2.8 } }),
  row({ label: "Cine Camera", depth: 1, category: "camera", tint: T.camera, art: "Camera",
        meta: "Study", narrowing: "camera", appearance: "camera",
        box: { p: [-2.9, 1.25, 0.7], h: [0.15, 0.12, 0.24] },
        state: { fov: 35, aspect: 2, live: false, focus: 6.0, aperture: 1.8 } }),
  row({ label: "Post Process", depth: 1, category: "geometry", tint: T.post, art: "EditorInstance",
        tag: "Comp", meta: "+0.0 EV", narrowing: "camera", appearance: "post",
        box: { p: [0.0, 1.5, 0.6], h: [0.55, 0.55, 0.55], wire: true },
        state: { ev: 0.0, autoExp: true, bloom: 0.35, vignette: 0.22, grain: 0.06, mode: 0 } }),

  row({ label: "Lighting", depth: 0, category: "folder", tint: T.folder, glyph: "folder",
        art: "FolderGeneric", pinned: true, narrowing: "lights" }),
  row({ label: "Sun", depth: 1, category: "light", tint: T.light, art: "Sun",
        meta: "41.2°", narrowing: "sky", appearance: "sun",
        box: { p: [4.4, 5.6, -6.4], h: [0.34, 0.34, 0.34], glow: true },
        state: { azimuth: 128, elevation: 41.2, intensity: 2.6, temp: 5800, shadows: true } }),
  row({ label: "Ceiling Luminaire", depth: 1, category: "light", tint: T.light,
        art: "EditorAreaLight", meta: "32 lx", narrowing: "lights", appearance: "luminaire",
        box: { p: [0.0, 2.99, -0.75], h: [0.5, 0.035, 0.4], glow: true },
        state: { power: 32, area: 0.8, warm: true } }),

  row({ label: "World", depth: 0, category: "folder", tint: T.folder, glyph: "folder",
        art: "FolderWorld", pinned: true, narrowing: "bodies" }),
  row({ label: "Tall Box", depth: 1, category: "geometry", dynamic: true,
        box: { p: [-0.9, 0.9, -2.7], h: [0.55, 0.9, 0.55] },
        state: { pos: [-0.9, 0.9, -2.7], rot: [0, 0, 0], scl: [1, 1, 1] } }),
  row({ label: "Short Box", depth: 1, category: "geometry", dynamic: true,
        box: { p: [0.85, 0.45, -1.5], h: [0.53, 0.45, 0.53] },
        state: { pos: [0.85, 0.45, -1.5], rot: [0, 18, 0], scl: [1, 1, 1] } }),
  row({ label: "Sphere", depth: 1, category: "geometry", dynamic: true,
        box: { p: [-1.15, 0.45, -1.05], h: [0.45, 0.45, 0.45] },
        state: { pos: [-1.15, 0.45, -1.05], rot: [0, 0, 0], scl: [1, 1, 1] } }),
  row({ label: "Cone", depth: 1, category: "geometry", dynamic: true,
        box: { p: [1.3, 0.55, -3.05], h: [0.45, 0.55, 0.45] },
        state: { pos: [1.3, 0.55, -3.05], rot: [0, 0, 0], scl: [1, 1, 1] } }),
  row({ label: "Torus", depth: 1, category: "geometry", dynamic: true,
        box: { p: [0.0, 0.32, -1.55], h: [0.56, 0.14, 0.56] },
        state: { pos: [0, 0.32, -1.55], rot: [0, 0, 0], scl: [1, 1, 1] } }),
  row({ label: "Silk Canopy", depth: 1, category: "geometry", dynamic: true, tint: [0.85, 0.55, 0.79],
        art: "SlateFabric", glyph: null, narrowing: "bodies", appearance: "cloth", tag: "Cloth",
        box: { p: [-1.15, 2.05, 0.9], h: [0.78, 0.03, 0.58], cloth: true },
        state: { mass: 0.4, stiffness: 0.62, wind: 0.75, damp: 0.18, collide: true } }),

  row({ label: "Vehicles", depth: 0, category: "folder", tint: [0.42, 0.62, 0.94], glyph: "folder",
        art: "EditorVehicle", narrowing: "bodies",
        standing: "auto", standingNote: "" }),
  row({ label: "Show Coupé", depth: 1, category: "geometry", dynamic: true, physics: true,
        tint: [0.42, 0.62, 0.94], art: "EditorVehicle", narrowing: "bodies", appearance: "vehicle",
        tag: "Phys", meta: "4.1 m",
        box: { p: [-0.35, 0.44, 1.15], h: [0.92, 0.44, 2.05] },
        state: { mass: 1250, drive: 1, top: 240, grip: 0.86, steer: 0, brake: false } }),
  row({ label: "Rally Tyre", depth: 1, category: "geometry", dynamic: true, physics: true,
        tint: [0.42, 0.62, 0.94], art: "EditorTyre", narrowing: "bodies", appearance: "tyre",
        tag: "Phys", meta: "18″",
        box: { p: [1.25, 0.31, 0.85], h: [0.31, 0.31, 0.13] },
        state: { diameter: 0.62, width: 0.235, tread: 8.5, pressure: 2.1, compound: 1 } }),
  row({ label: "Wheel Rim", depth: 1, category: "geometry", dynamic: true, physics: true,
        tint: [0.42, 0.62, 0.94], art: "EditorWheelRim", narrowing: "bodies", appearance: "tyre",
        tag: "Phys", meta: "17″",
        box: { p: [1.95, 0.27, 0.3], h: [0.27, 0.27, 0.09] },
        state: { diameter: 0.43, width: 0.2, tread: 0, pressure: 0, compound: 0 } }),
  row({ label: "Tread Sample", depth: 1, category: "geometry", dynamic: true,
        tint: [0.42, 0.62, 0.94], art: "EditorTread", narrowing: "bodies", appearance: "tread",
        meta: "8.5 mm",
        box: { p: [0.62, 0.09, 1.65], h: [0.36, 0.09, 0.18] },
        state: { depth: 8.5, pattern: 2, rubber: 0.9 } }),

  row({ label: "Room", depth: 0, category: "folder", tint: T.folder, glyph: "folder",
        art: "FolderGeneric", pinned: true, narrowing: "geometry" }),
  row({ label: "Floor", depth: 1, category: "geometry", tint: [0.75, 0.75, 0.78],
        box: { p: [0, -0.03, -2], h: [2, 0.03, 2], shell: true },
        state: { pos: [0, 0, -2], rot: [0, 0, 0], scl: [1, 1, 1] } }),
  row({ label: "Ceiling", depth: 1, category: "geometry", tint: [0.7, 0.71, 0.75],
        box: { p: [0, 3.0, -2], h: [2, 0.02, 2], shell: true },
        state: { pos: [0, 3, -2], rot: [0, 0, 0], scl: [1, 1, 1] } }),
  row({ label: "Back Wall", depth: 1, category: "geometry", tint: [0.72, 0.72, 0.76],
        box: { p: [0, 1.5, -4], h: [2, 1.5, 0.03], shell: true },
        state: { pos: [0, 1.5, -4], rot: [0, 0, 0], scl: [1, 1, 1] } }),
  row({ label: "Left Wall", depth: 1, category: "geometry", tint: [0.85, 0.24, 0.24],
        box: { p: [-2, 1.5, -2], h: [0.03, 1.5, 2], shell: true },
        state: { pos: [-2, 1.5, -2], rot: [0, 0, 0], scl: [1, 1, 1] } }),
  row({ label: "Right Wall", depth: 1, category: "geometry", tint: [0.24, 0.72, 0.3],
        box: { p: [2, 1.5, -2], h: [0.03, 1.5, 2], shell: true },
        state: { pos: [2, 1.5, -2], rot: [0, 0, 0], scl: [1, 1, 1] } }),
  row({ label: "Silver Birch", depth: 1, category: "geometry", tint: [0.5, 0.78, 0.5],
        art: "EditorTree", narrowing: "geometry", appearance: "foliage", meta: "2.2 m",
        box: { p: [2.9, 1.1, -1.1], h: [0.6, 1.1, 0.6] },
        state: { height: 2.2, sway: 0.4, season: 1 } }),
  row({ label: "Fern Pot", depth: 1, category: "geometry", tint: [0.45, 0.7, 0.42],
        art: "EditorPlant", narrowing: "geometry", appearance: "foliage", meta: "0.5 m",
        box: { p: [1.55, 0.25, -3.6], h: [0.22, 0.25, 0.22] },
        state: { height: 0.5, sway: 0.6, season: 1 } }),
];

/* Give every boxed entry its own hue — "a different colour for each entry". */
(() => {
  let hue = 0;
  for (const r of Roster) {
    if (!r.box) continue;
    r.hue = ENTRY_HUES[hue++ % ENTRY_HUES.length];
    if (r.box.glow) r.hue = 46;                    // the emitters read warm
  }
})();

/* ── the feed's filter masks (EditorNarrowing) ───────────────────────────────────────────── */
function rowFilterMask(r) {
  if (r.narrowing !== "auto") return 1 << { lights: 1, sky: 2, bodies: 3, geometry: 4, camera: 5 }[r.narrowing];
  if (r.category === "light")  return 1 << 1;
  if (r.category === "camera") return 1 << 5;
  return 1 << 4;
}

/* ── property sheets (EditorSheet groups) — one builder per appearance ───────────────────── */
const slider = (label, figure, min, max, unit = "", decimals = 2, hi = false) =>
  ({ label, cat: "slider", figure, min, max, unit, decimals, hi });
const sw     = (label, on) => ({ label, cat: "switch", on });
const vec3   = (label, axes, editable = true) => ({ label, cat: "vec3", axes, editable });
const colour = (label, tint, swatches = false) => ({ label, cat: "colour", tint, swatches });
const select = (label, options, picked) => ({ label, cat: "select", options, picked });
const readoutRow = (label, text) => ({ label, cat: "readout", text });

function buildSheet(r) {
  const s = r.state;
  const groups = [];
  switch (r.appearance) {
    case "camera":
      groups.push(
        { title: "Lens", props: [
          slider("Fov", s.fov, 10, 120, "°", 0, true),
          select("Aspect", ["Free", "1:1", "2:1", "2.39:1"], s.aspect),
          slider("Aperture", s.aperture, 1.4, 16, "ƒ", 1),
          slider("Focus", s.focus, 0.3, 100, "m", 1),
        ]},
        { title: "Feed", props: [
          sw("Live view", s.live),
          readoutRow("Exposure", "Centre-weighted"),
          readoutRow("Sensor", "36 × 24 mm"),
        ]},
      );
      break;
    case "post":
      groups.push(
        { title: "Exposure", props: [
          slider("Compensation", s.ev, -4, 4, "EV", 1),
          sw("Auto exposure", s.autoExp),
        ]},
        { title: "Optics", props: [
          slider("Bloom", s.bloom, 0, 1, "", 2, true),
          slider("Vignette", s.vignette, 0, 1),
          slider("Grain", s.grain, 0, 1),
          select("Tonemap", ["Filmic", "AgX", "Reinhard", "Linear"], s.mode),
        ]},
      );
      break;
    case "sun":
      groups.push(
        { title: "Orbit", props: [
          slider("Azimuth", s.azimuth, 0, 360, "°", 1),
          slider("Elevation", s.elevation, -90, 90, "°", 1, true),
        ]},
        { title: "Radiance", props: [
          slider("Intensity", s.intensity, 0, 10, "", 2, true),
          slider("Temperature", s.temp, 1000, 12000, "K", 0),
          sw("Cast shadows", s.shadows),
          readoutRow("Disc", "0.53° apparent"),
        ]},
      );
      break;
    case "luminaire":
      groups.push(
        { title: "Emitter", props: [
          slider("Power", s.power, 0, 200, "lx", 0, true),
          slider("Area", s.area, 0.05, 4, "m²", 2),
          sw("Warm tint", s.warm),
          readoutRow("Contents", "1 direct · 3 total"),
        ]},
      );
      break;
    case "vehicle":
      groups.push(
        { title: "Body", props: [
          slider("Mass", s.mass, 200, 4000, "kg", 0),
          select("Drivetrain", ["Rear", "All", "Front"], s.drive),
          slider("Top speed", s.top, 60, 400, "km/h", 0, true),
        ]},
        { title: "Contact", props: [
          slider("Grip", s.grip, 0, 1.5, "", 2),
          slider("Steering", s.steer, -45, 45, "°", 1),
          sw("Handbrake", s.brake),
          readoutRow("Tyres", "4 seated"),
        ]},
      );
      break;
    case "tyre":
      groups.push(
        { title: "Casing", props: [
          slider("Diameter", s.diameter, 0.3, 1.2, "m", 2, true),
          slider("Width", s.width, 0.1, 0.4, "m", 3),
          slider("Pressure", s.pressure, 0, 4, "bar", 1),
        ]},
        { title: "Contact", props: [
          slider("Tread depth", s.tread, 0, 12, "mm", 1),
          select("Compound", ["Hard", "Road", "Soft", "Wet"], s.compound),
          readoutRow("Lattice", "84 cells"),
        ]},
      );
      break;
    case "tread":
      groups.push(
        { title: "Pattern", props: [
          slider("Depth", s.depth, 0, 12, "mm", 1, true),
          select("Layout", ["Block", "Rib", "Lug", "Mixed"], s.pattern),
          slider("Rubber grip", s.rubber, 0, 1.5, "", 2),
        ]},
      );
      break;
    case "cloth":
      groups.push(
        { title: "Fabric", props: [
          colour("Tint", r.tint, true),
          slider("Mass", s.mass, 0.05, 5, "kg", 2),
          slider("Stiffness", s.stiffness, 0, 1, "", 2, true),
        ]},
        { title: "Simulation", props: [
          slider("Wind response", s.wind, 0, 2, "", 2),
          slider("Damping", s.damp, 0, 1),
          sw("Collide with bodies", s.collide),
          readoutRow("Solver", "12 iterations"),
        ]},
      );
      break;
    case "foliage":
      groups.push(
        { title: "Growth", props: [
          slider("Height", s.height, 0.1, 30, "m", 1, true),
          select("Season", ["Spring", "Summer", "Autumn", "Winter"], s.season),
        ]},
        { title: "Motion", props: [
          slider("Wind sway", s.sway, 0, 1),
        ]},
      );
      break;
    default: // geometry
      groups.push(
        { title: "Placement", props: [
          vec3("Position", s.pos ?? [0,0,0]),
          vec3("Rotation", s.rot ?? [0,0,0]),
          vec3("Scale", s.scl ?? [1,1,1]),
        ]},
        { title: "Surface", props: [
          colour("Tint", r.tint, true),
          select("Material", ["Matte", "Gloss", "Metal", "Emissive"], 0),
          readoutRow("Slabs", "1 direct · 2 total"),
        ]},
      );
      break;
  }
  return groups;
}

/* Per-row standing (EditorStanding): Auto derives Ok / Err "Hidden"; folders total their rows. */
function standingOf(r, roster, index) {
  if (r.standing !== "auto") return { standing: r.standing, note: r.standingNote || "Seated" };
  if (!r.visible) return { standing: "err", note: "Hidden" };
  if (r.category === "folder") {
    const end = runEnd(roster, index);
    let warn = 0;
    for (let i = index + 1; i < end; i++)
      if (roster[i].visible && (roster[i].standing === "warn" || roster[i].standing === "err")) warn++;
    return warn ? { standing: "warn", note: warn + " issue" + (warn > 1 ? "s" : "") }
                : { standing: "ok", note: "All good" };
  }
  return { standing: "ok", note: r.standingNote || "Seated" };
}

/* Preorder run end — the same walk the outliner uses. */
function runEnd(roster, i) {
  const depth = roster[i].depth;
  let j = i + 1;
  while (j < roster.length && roster[j].depth > depth) j++;
  return j;
}
function ownerOf(roster, i) {
  const depth = roster[i].depth;
  if (depth === 0) return -1;
  for (let j = i - 1; j >= 0; j--) if (roster[j].depth < depth) return j;
  return -1;
}
