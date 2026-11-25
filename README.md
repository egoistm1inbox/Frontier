# Frontier

Procedural 3D studio for **Giant Tropical Megaphyll Plants**, **Continuous Velvet Carpet & Bryophyte Moss**, **Ultra-Realistic High-Poly Ferns & Broadleaf Plants**, and **Studio Fur & Hair Grooms**, built with the SolidArc floating-glass workspace (**Outliner · Viewport · Inspector**).

## Capabilities

1. **Giant Tropical Megaphyll Generator (`src/generators/tropicalMesher.ts`)**
   - **5 Megaphyll Architectures**: `Giant Banana` (*Musa acuminata*), `Red Abyssinian Banana` (*Ensete ventricosum maurelii*), `Traveller's Palm` (*Ravenala madagascariensis* distichous fan), `Colossal Elephant Ear` (*Alocasia macrorrhizos* sagittate ear lobes), and `Giant Bird of Paradise` (*Strelitzia nicolai*).
   - **Wind-Torn Ribbons & Botanical Organs**: Clasping leaf-sheath **pseudostems** with sucker pups, central rolled **cigar furl leaf**, canaliculate U-grooved petioles & midrib keels, parallel-striated paddles physically split along lateral veins into **independent wind-driven ribbons**, and pendant **banana flower bells + upward-curved fruit hands** / *Strelitzia* crane-beak spathes.

2. **Real Bryophyte & Velvet Carpet Moss Generator (`src/generators/mossMesher.ts`)**
   - **6 Bryological & Carpet Habits**: `Lush Velvet Carpet` (*Hypnum* / *Dicranum* continuous forest-floor meadow on undulating `forest_carpet` peat), `Acrocarp Star Turf` (*Polytrichum*), `Billowing Pincushion` (*Leucobryum* Voronoi hummocks), `Pleurocarp Feather Mat` (*Thuidium*), `Capitulum Bog Peat` (*Sphagnum*), and `Hyaline Hair-Point Tuft` (*Tortula*).
   - **Micro-Botanical Organs**: Basal **rhizoid felt**, erect or swept **gametophyte stems** & branchlets, spiraled (`137.5°`) 3D V-keeled **phyllids**, wiry **sporophyte setae**, and rigid 3D **theca spore capsules** with peristome rims & **opercula**.

3. **Isometric 3D Rodrigues Wind Engine (`src/viewer/shaders.ts`)**
   - **Zero Scaling / Zero Stretching**: Pure `SO(3)` Rodrigues axis-angle rotations (`pitch`, cross-eddy `roll`, and torsional spine `flap`) around welded root/stem pivots preserve exact organ dimensions (`0.00%` radial scaling or inflation on moss phyllids & capsules) while propagating spatial breeze & turbulent gust waves across moss carpets and giant tropical paddles.

4. **High-Poly Fern & Plant Generator (`src/generators/fernMesher.ts`) & Studio Fur/Hair Grooms (`src/generators/hairMesher.ts`)**
   - **Ferns & Broadleaves**: `Western Sword Fern`, `Lady Fern`, `Ostrich Shuttlecock Fern`, `Boston Sword Fern`, `Delta Maidenhair`, `Soft Tree Fern`, plus `Hosta`, fenestrated `Monstera`, and pleated `Calathea` with 3D venation, bullation, crosiers, and abaxial sori.
   - **Fur & Hair Grooms**: Master guide curves, SDF host collision, dense undercoat, clumped guard locks, whiskers/flyaways, helical curls, physical melanin + agouti banding, and dual-lobe Marschner / Kajiya-Kay shading.

5. **Hierarchical Scene Outliner & Node Inspector (29 Curated Presets)**
   - Multi-layer composition (`+ Tropical`, `+ Fern`, `+ Moss`, `+ Hair`), per-organ Outliner selection, visibility, Solo isolation, 6 display modes (`Shaded`, `Clay`, `Wire`, `Anatomy`, `Veins / Locks`, `Wind`), `Macro` close-up framing (`M`), and off-thread quad `OBJ` & multi-node `GLB` export.

## Development

```bash
npm install
npm run dev       # http://0.0.0.0:5173
npm run typecheck
npm test
npm run build
```
