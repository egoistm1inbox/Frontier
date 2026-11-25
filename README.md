# Frontier

Procedural 3D botanical & groom studio for **Topologically Welded Woody Trees**, **Fruiting & Dichotomous Palm Trees**, **Gigantic 3D Sculpted Vibrant Flowers**, **Cloud-Forest Pillow & Velvet Carpet Moss**, **Welded Giant Tropical Megaphylls**, **High-Poly Ferns & Broadleaf Plants**, and **Studio Fur & Hair Grooms**, built with the SolidArc floating-glass workspace (**Outliner · Viewport · Inspector**).

## Capabilities

1. **Closed 2-Manifold Stem, Root & Collar Welding (`src/core/weldedManifold.ts`, `src/generators/treeMesher.ts`)**
   - **Exact Watertight Quad Topology (`V - E + F = 2C`)**: Non-overlapping `w × rows` parent grid windows, phase-matched quadratic Bezier branch/root collars (`buildCollar`), D-ring multi-way dichotomous/trichotomous forks (`meshFork`), and dome caps produce mathematically verified closed 2-manifolds (`0` boundary edges, `0` non-manifold edges, `>99%` native quads).
   - **4 Welded Tree Species**: `Ancient English Oak` (*Quercus robur*), `Tropical Buttress Banyan` (*Ficus benghalensis*), `Sculpted Japanese Maple` (*Acer palmatum*), and `Monumental African Baobab` (*Adansonia digitata*) with terrain-hugging buttress roots, trunk flutes aligned with root azimuths, Da Vinci pipe-model radii, and 3D sculpted foliage.

2. **Anatomically Accurate Fruiting & Y-Branching Palm Generator (`src/generators/palmMesher.ts`)**
   - **5 Botanical Palm Species**: `Medjool Date Palm` (*Phoenix dactylifera* diamond leaf-base boots + golden-orange spadix strands bearing ~1,900 3D dates), `Coastal Coconut Palm` (*Cocos nucifera* curved ringed trunk + 3-angled fibrous coconuts), `Cuban Royal Palm` (*Roystonea regia* emerald crownshaft + plumose fronds + infrafoliar drupe panicles), `Desert Oasis Fan Palm` (*Washingtonia filifera* accordion-pleated costapalmate fans + persistent shag petticoat skirt), and `Branching Doum Palm` (*Hyphaene thebaica* welded aerial dichotomous Y-forks + 4 crowns).

3. **Gigantic 3D Sculpted Vibrant Flowers (`src/generators/flowerMesher.ts`, `src/generators/flowerParams.ts`)**
   - **6 Giant-Scale Floral Species with Closed 2-Manifold Welded Stems, Pedicels & Petioles (`V - E + F = 2`)**: `Colossal Tropical Hibiscus` (pinwheel ruffled 3D veined petals + exserted 60-anther staminal column & 5 velvet stigmas), `Giant Stargazer / Oriental Lily` (raised 3D ruby throat papillae, chartreuse star, snow picotee & T-hinged cinnabar anthers), `Sacred Imperial Lotus` (24 concave striated boat petals, 112 golden stamens, pitted seed torus & peltate pads), `Imperial Giant Tree Peony` (36 ruffled silk double-whorl petals, 116 golden stamens & 5 carpels), `Crown Passionflower` (10-part star perianth & 2-ring 84-filament banded corona), and `Titan Royal Sunflower` (twin-grooved golden rays & 420-floret Fibonacci Vogel spiral capitulum).
   - **Vibrant Floral Shader (`uProfile == 4`) & 10 Colorways + 6-Zone Custom Pigments**: Conical-papillae chroma-preserving floral shading, 1-click vibrant colorway swatches (`Species Signature`, `Electric Magenta`, `Crimson Ruby`, `Solar Tangerine`, `UV Orchid`, `Cerulean Sapphire`, `Imperial Coral`, `Bioluminescent Aurora`, `Royal Amethyst`), and live 6-channel RGB pickers (`Primary Corolla`, `Margin/Picotee`, `Velvet Throat`, `3D Veins & Papillae`, `Pollen/Anther`, `Stems & Leaves`).

4. **Cloud-Forest Cascading Pillow & Velvet Carpet Moss (`src/generators/mossMesher.ts`)**
   - **7 Bryological & Cushion Habits**: `Cloud-Forest Pillow Cushions` (`billowing_pillow` confluent 3-layer smooth-max cushions with tucked overhanging lips, deep near-black V-crevices, sun-toasted crests, and >80,000 barycentrically sampled 3D radial gametophyte star-tufts over glistening `wet_basalt_crag` volcanic rock), `Lush Velvet Carpet`, `Acrocarp Star Turf`, `Billowing Pincushion`, `Pleurocarp Feather Mat`, `Capitulum Bog Peat`, and `Hyaline Hair-Point Tuft`.

5. **Welded Giant Tropical Megaphylls (`src/generators/tropicalMesher.ts`)**
   - **5 Megaphyll Architectures**: `Giant Banana` (*Musa acuminata*), `Red Abyssinian Banana` (*Ensete maurelii*), `Traveller's Palm` (*Ravenala* distichous fan), `Colossal Elephant Ear` (*Alocasia*), and `Giant Bird of Paradise` (*Strelitzia*), with pseudostems, basal root swells, and continuous canaliculate U-grooved petiole-to-midrib spines welded into a single closed manifold per stem (`0` duplicate overlapping tubes).

6. **Isometric `SO(3)` Rodrigues Wind Engine (`src/viewer/shaders.ts`)**
   - **Zero Edge-Length Scaling (`0.000%` Stretch)**: Pure `SO(3)` Rodrigues axis-angle rotations (`pitch`, cross-eddy `roll`, and torsional spine `flap`) around welded root/branch/tuft pivots preserve exact organ edge lengths while animating branches, fronds, petals, fruits, wind-split banana ribbons, and moss velvet.

7. **High-Poly Ferns, Broadleafs & Studio Fur/Hair Grooms (48 Curated Presets across 9 Groups)**
   - Multi-layer composition (`+ Tree`, `+ Palm`, `+ Flower`, `+ Moss`, `+ Tropical`, `+ Fern`, `+ Hair`), per-organ Outliner selection, visibility, Solo isolation, 6 display modes (`Shaded`, `Clay`, `Wire`, `Anatomy`, `Veins / Locks`, `Wind`), `Macro` framing (`M`), and off-thread quad `OBJ` & multi-node `GLB` export.

## Development

```bash
npm install
npm run dev       # http://0.0.0.0:5173
npm run typecheck
npm test
npm run build
```
