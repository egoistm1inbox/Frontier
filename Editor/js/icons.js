/* ══════════════════════════════════════════════════════════════════════════════════════════════
   ICONS.JS — the editor's two icon families.

   1. GLYPHS — the outliner's own semantic glyph set (EditorGlyph in EditorInstance.h, drawn by
      VectorCodec's glyph records in the C++ editor): monochrome, stroked in the row's tint.
   2. ART — the colourful SVG archive shipped in EngineContent/Icons (IconSymbols.inc). The HTML
      editor vendors the exact files under ../icons/.

   FILLED-IN ICONS. The C++ registry (IconSymbols.inc) never registered the artwork the content
   folder already ships — editor-tyre, editor-wheel-rim, editor-tread, editor-cube, editor-sphere,
   editor-cylinder, editor-cone, editor-torus, editor-plant, editor-tree — and it carries no
   vehicle or cloth mark at all. This redesign registers all of them: the shipped ten, plus two
   new icons drawn in the family's own style (editor-vehicle.svg, editor-cloth.svg).
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

"use strict";

const Glyphs = (() => {
  // One painter: 24-space paths stroked at 1.9, mirroring the C++ glyph sheet.
  const S = (inner) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const F = (inner) =>
    `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">${inner}</svg>`;

  return {
    // ── the chrome marks (OutlinerIconCategory) ────────────────────────────────────────────
    chevron:      S('<path d="m9 6 6 6-6 6"/>'),
    chevronUp:    S('<path d="m6 14 6-6 6 6"/>'),
    check:        S('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    warn:         S('<path d="M12 3.5 21.5 20h-19Z"/><path d="M12 9.5v4.2"/><circle cx="12" cy="16.6" r="0.6" fill="currentColor"/>'),
    dot:          F('<circle cx="12" cy="12" r="3"/>'),
    search:       S('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.8 4.8"/>'),
    sliders:      S('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>'),
    compact:      S('<path d="M5 9.5h14M5 14.5h14"/>'),
    eye:          S('<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.6"/>'),
    eyeOff:       S('<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.6"/><path d="m4 20 16-16"/>'),
    plus:         S('<path d="M12 5v14M5 12h14"/>'),
    minus:        S('<path d="M5 12h14"/>'),
    trash:        S('<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/><path d="M10 11v5M14 11v5"/>'),
    lock:         S('<rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
    unlock:       S('<rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.8-1.2"/>'),
    close:        S('<path d="m6 6 12 12M18 6 6 18"/>'),
    gear:         S('<circle cx="12" cy="12" r="3.4"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8"/>'),

    // ── the row glyphs (EditorGlyph) ───────────────────────────────────────────────────────
    folder:       S('<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h9A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z"/>'),
    globe:        S('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c-5.5 5-5.5 12 0 17M12 3.5c5.5 5 5.5 12 0 17"/>'),
    sun:          S('<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M18.7 5.3l-1.5 1.5M6.8 17.2l-1.5 1.5"/>'),
    moon:         S('<path d="M20 13.5A8.5 8.5 0 0 1 10.5 4 8.5 8.5 0 1 0 20 13.5Z"/>'),
    stars:        F('<circle cx="6" cy="7" r="1.4"/><circle cx="12" cy="4.5" r="1.1"/><circle cx="18" cy="8" r="1.4"/><circle cx="9" cy="13" r="1.1"/><circle cx="15.5" cy="14.5" r="1.3"/><circle cx="6.5" cy="18.5" r="1.2"/><circle cx="13" cy="19.5" r="1.4"/><circle cx="19" cy="18" r="1.1"/>'),
    cloud:        S('<path d="M6.5 17.5a4 4 0 0 1-.4-8 5.6 5.6 0 0 1 11-1.2 4.4 4.4 0 0 1 .4 8.7Z"/>'),
    volumeClouds: S('<path d="M6.5 13.5a4 4 0 0 1-.4-8 5.6 5.6 0 0 1 11-1.2 4.4 4.4 0 0 1 .4 8.7Z"/><path d="M7 19.5a3.4 3.4 0 0 1-.3-6.8 4.8 4.8 0 0 1 9.4-1 3.8 3.8 0 0 1 .9 7.3" opacity=".6"/>'),
    localCloud:   S('<path d="M6.5 15.5a4 4 0 0 1-.4-8 5.6 5.6 0 0 1 11-1.2 4.4 4.4 0 0 1 .4 8.7Z"/><path d="M5 19.5h14" stroke-dasharray="2 3"/>'),
    rainbow:      S('<path d="M4 18a8 8 0 0 1 16 0"/><path d="M7.2 18a4.8 4.8 0 0 1 9.6 0" opacity=".6"/>'),
    wind:         S('<path d="M3 8.5h9.5a2.8 2.8 0 1 0-2.8-2.8M3 12.5h14.5a2.8 2.8 0 1 1-2.8 2.8M3 16.5h6.5"/>'),
    rain:         S('<path d="M6.5 13.5a4 4 0 0 1-.4-8 5.6 5.6 0 0 1 11-1.2 4.4 4.4 0 0 1 .4 8.7Z"/><path d="M8.5 16.5v2.4M12 17.5v2.4M15.5 16.5v2.4"/>'),
    fog:          S('<path d="M4 9.5h16M6 13h12M4 16.5h16" opacity=".9"/><path d="M8 6h8" opacity=".5"/>'),
    volumeFog:    S('<rect x="4" y="5.5" width="16" height="13" rx="3" stroke-dasharray="3 2.6"/><path d="M7 10h10M7 14h10" opacity=".7"/>'),
    wave:         S('<path d="M2.5 12c2.4-3.4 4.8-3.4 7.2 0s4.8 3.4 7.2 0 3.4-2.6 4.6-1.2"/>'),
    horizon:      S('<path d="M3 15.5h18"/><path d="M6.5 15.5a5.5 5.5 0 0 1 11 0"/><path d="M12 4.5v2M6 6.8l1.4 1.4M18 6.8l-1.4 1.4"/>'),
    orbit:        S('<ellipse cx="12" cy="12" rx="9" ry="4.2"/><circle cx="12" cy="12" r="2.6"/><circle cx="20" cy="9.4" r="1.2" fill="currentColor" stroke="none"/>'),
    bulb:         S('<path d="M9 17.5h6M9.8 20.5h4.4"/><path d="M12 3.5a5.5 5.5 0 0 1 3.3 9.9c-.7.5-.8 1.2-.8 2.1v.5h-5v-.5c0-.9-.1-1.6-.8-2.1A5.5 5.5 0 0 1 12 3.5Z"/>'),
    camera:       S('<rect x="3" y="7.5" width="13" height="10" rx="2.5"/><path d="m16 11 5-2.5v8L16 14"/>'),
    effects:      S('<path d="M12 3.5 13.8 9 19.5 10.8 13.8 12.6 12 18.3 10.2 12.6 4.5 10.8 10.2 9Z"/><path d="M18.5 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z" stroke-width="1.4"/>'),
    palette:      S('<path d="M12 3.5a8.5 8.5 0 1 0 .4 17c1.6 0 2-1 1.5-2-.7-1.4.3-2.8 1.8-2.8h1.8a3 3 0 0 0 3-3.2A8.5 8.5 0 0 0 12 3.5Z"/><circle cx="8" cy="9" r="1.2" fill="currentColor" stroke="none"/><circle cx="13" cy="7" r="1.2" fill="currentColor" stroke="none"/><circle cx="17" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="7.5" cy="14" r="1.2" fill="currentColor" stroke="none"/>'),
    ground:       S('<path d="m12 4.5 8.5 4.5L12 13.5 3.5 9Z"/><path d="M3.5 13.5 12 18l8.5-4.5" opacity=".55"/>'),
    lattice:      S('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16" opacity=".7"/>'),
    galaxy:       S('<circle cx="12" cy="12" r="2.2"/><path d="M12 4.5c4.5 1 7.5 4 7.5 7.5M12 19.5c-4.5-1-7.5-4-7.5-7.5"/><path d="M17.5 6.5c2 1.6 2.8 3.4 2.4 5M6.5 17.5c-2-1.6-2.8-3.4-2.4-5" opacity=".6"/>'),
    aperture:     S('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v6.2M19.4 7.8l-5.4 3M19.4 16.2 14 13.2M12 20.5v-6.2M4.6 16.2l5.4-3M4.6 7.8 10 10.8" opacity=".8"/>'),
    flare:        S('<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7" stroke-dasharray="2.4 3"/><path d="M12 2v2.6M12 19.4V22M2 12h2.6M19.4 12H22" opacity=".7"/>'),
    plane:        S('<path d="M3.5 16.5 12 6l8.5 10.5Z"/>'),
    key:          S('<circle cx="8" cy="12" r="4.5"/><path d="M12.5 12H21M18 12v3M15 12v2"/>'),
    up:           S('<path d="M12 19V5M6 11l6-6 6 6"/>'),
    down:         S('<path d="M12 5v14M6 13l6 6 6-6"/>'),
    flat:         S('<path d="m12 8 8.5 4L12 16 3.5 12Z"/>'),
    pivot:        S('<path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="3.4"/>'),
    select:       S('<path d="M5 3.5 19 10l-6 1.8L10.5 18Z"/>'),
    move:         S('<path d="M12 3v18M3 12h18"/><path d="m9.5 5.5 2.5-2.5 2.5 2.5M9.5 18.5l2.5 2.5 2.5-2.5M5.5 9.5 3 12l2.5 2.5M18.5 9.5 21 12l-2.5 2.5"/>'),
    rotate:       S('<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 3.5V8h-4.5"/>'),
    scale:        S('<path d="M4 20 20 4"/><path d="M4 20v-6M4 20h6M20 4v6M20 4h-6"/>'),
    snap:         S('<path d="M4 4h6v6H4zM14 14h6v6h-6z"/><path d="M10 7h4v-3M14 17h-4v3" opacity=".6"/>'),
    grid:         S('<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>'),

    // ── the transport marks (filled at 13 px, as the C++ RunGlyphs) ────────────────────────
    play:         F('<path d="M7 4.5v15L19.5 12Z"/>'),
    pause:        F('<rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/>'),
    stop:         F('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
    step:         F('<path d="M7 5v14l9-7Z"/><rect x="17" y="5" width="2.4" height="14"/>'),
    sim:          S('<path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 12V7.5M12 12l3.5 2"/><path d="M17 3l4 2-4 2Z" fill="currentColor" stroke="none"/>'),
    command:      S('<path d="M8 3.5 4.5 7v10L8 13.5h8l3.5 3.5v-10L16 10.5H8Z"/>'),
  };
})();

/* Colourful artwork icons — the EngineContent/Icons archive, vendored under ../icons/.
   Keys are the IconSymbol names the C++ editor seats; files are the shipped SVGs. */
const Art = {
  Camera:            "camera.svg",
  EditorMesh:        "editor-mesh.svg",
  EditorPointLight:  "editor-point-light.svg",
  EditorAreaLight:   "editor-area-light.svg",
  EditorSpotlight:   "editor-spotlight.svg",
  EditorDomeLight:   "editor-dome-light.svg",
  Sun:               "sun.svg",
  Moon:              "moon.svg",
  Stars:             "stars.svg",
  Clouds:            "clouds.svg",
  Fog:               "fog.svg",
  Wind:              "wind.svg",
  Rainbow:           "rainbow.svg",
  LensFlare:         "lens-flare.svg",
  Terrain:           "terrain.svg",
  Material:          "editor-material.svg",
  EditorPhysics:     "editor-physics.svg",
  EditorInstance:    "editor-instance.svg",
  EditorCollection:  "editor-collection.svg",
  EditorBone:        "editor-bone.svg",
  FolderScene:       "folder-scene.svg",
  FolderWorld:       "folder-world.svg",
  FolderGeneric:     "folder-generic.svg",
  EditorCube:        "editor-cube.svg",
  EditorSphere:      "editor-sphere.svg",
  EditorCylinder:    "editor-cylinder.svg",
  EditorCone:        "editor-cone.svg",
  EditorTorus:       "editor-torus.svg",
  EditorPlant:       "editor-plant.svg",
  EditorTree:        "editor-tree.svg",
  EditorSelect:      "editor-select.svg",
  EditorMove:        "editor-move.svg",
  EditorRotate:      "editor-rotate.svg",
  EditorScale:       "editor-scale.svg",
  EditorSnap:        "editor-snap.svg",
  EditorGrid:        "editor-grid.svg",
  EditorPivot:       "editor-pivot.svg",
  // ── the filled-in icons: shipped by EngineContent but never registered in IconSymbols.inc ──
  EditorTyre:        "editor-tyre.svg",
  EditorWheelRim:    "editor-wheel-rim.svg",
  EditorTread:       "editor-tread.svg",
  // ── the two new marks, drawn in the family's own style ────────────────────────────────────
  EditorVehicle:     "editor-vehicle.svg",
  SlateFabric:       "editor-cloth.svg",
};

const artUrl  = (name) => "icons/" + (Art[name] || "editor-mesh.svg");
const artImg  = (name, size = 24) =>
  `<img src="${artUrl(name)}" width="${size}" height="${size}" alt="" draggable="false">`;
const glyph   = (name, cls = "glyph") =>
  `<span class="${cls}" aria-hidden="true">${Glyphs[name] || Glyphs.dot}</span>`;

/* Category → artwork mapping, the C++ NativeConstructPanel::Artwork rule. */
function artworkFor(row) {
  if (row.art) return row.art;
  if (row.category === "camera")   return "Camera";
  if (row.category === "light")    return "EditorPointLight";
  if (row.category === "geometry") return "EditorMesh";
  return null;
}
