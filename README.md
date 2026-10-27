# Frontier · Tropical Tree Generator

A new webapp in the exact UI language of the Slate plant editor
(`unassignedinbox/Slate`, branch `arena/01a096c9-slate`) — three floating
glass cards (**Library · Viewport · Inspector**), tick-track sliders with
drag-scrub mono values, per-level tables, pill segments, stat tiles, hero
card, presence toggles, command line — with a brand-new, geometry-first
**tropical** plant engine underneath.

## Run

ES modules require a static server (double-clicking the file will not work):

```bash
python3 -m http.server 5173 --bind 0.0.0.0
# → http://localhost:5173
```

Everything is self-contained: `index.html` (UI + generator + viewer) and a
vendored copy of three.js in `vendor/` (MIT, see `vendor/LICENSE-three.md`).
Fonts load from Google Fonts with system fallbacks offline.

## Species (20)

- **Palms & bananas** — Coconut, Royal (crownshaft), Date (diamond armour +
  date bunches), Fan Palm (petticoat skirt), Traveller's Palm (one-plane
  fan), Banana (sheathing pseudostem clump, fruit bunch + heart)
- **Rainforest canopy** — Kapok (plank buttresses, emergent umbrella),
  Banyan (fluted trunk, aerial prop roots), Rain Tree, Mango, Flamboyant
- **Coast & wetland** — Red Mangrove (stilt roots, propagules), Screw Pine
  (prop-root cone, spiral rosettes), Sea Grape (plate leaves)
- **Understorey** — Monstera (real fenestrated leaves), Tree Fern
  (bipinnate fronds, crozier), Bird of Paradise, Heliconia, Elephant Ear,
  Giant Bamboo (swollen culm nodes)

## How the fidelity works

- **No alpha cards.** Every leaf is a parametric folded blade (midrib curve,
  V-fold, edge sweep, tip twist); palm fronds are a tapered rachis carrying
  individually folded pinnae; tree-fern fronds are rachis → pinnae →
  pinnules; monstera leaves are cut shapes with real holes.
- Trunks/branches are parallel-transport tubes with species profiles
  (coconut ring scars, palm diamond leaf-base armour, bamboo nodes,
  banyan fluting, banana sheath ridges) plus procedural canvas bark/leaf/
  ground textures with bump.
- Buttress fins, surface roots, banyan aerial roots, mangrove stilts,
  pandanus prop-root cones, coconuts, date bunches, banana hands, flowers.
- All organs merge into **3 draw calls** (bark · stems/fruit · foliage)
  with baked per-vertex wind weights (sway · bend · flutter · phase)
  evaluated in the vertex shader.
- Quality presets **Balanced / High / Ultra / Cinematic** scale leaflet
  counts, blade rings, trunk tessellation and shadow resolution together
  (a High kapok is ~600k triangles; Cinematic pushes past 1.5M).

## Controls

Same shell as the copied UI: search the library, edit **Botany / Foliage /
Roots / Mesh / View / Report**, switch Shaded · Clay · Wire · Organs · Wind,
toggle wire/leaves/wind, frame (**F**), frame base (**B**), reseed (**R**),
export **OBJ / GLB**, save a PNG, or use the command line
(`seed 42 · species kapok · quality ultra · export glb · help`).
Environment presets (Jungle clearing / Golden hour / Overcast / Studio)
and a time-of-day sun live in the View tab.
