# Frontier — Streak & Burst VFX

A particle/VFX editor + runtime for the **fiber-burst / light-streak** look:
radial fiber-optic starbursts, flowing silk ribbons, bloom cores, voxel-shell
explosions and layered streak waves — all GPU-procedural, all real-time.

7 presets ship with the editor, each matched to one of the reference images:

| Preset | Reference look |
|---|---|
| Fiber Burst | radial blue/violet fiber starburst + tip dots |
| Bloom Core | green petal bloom + micro dust |
| Silk Ember | flowing orange/blue ember ribbon |
| Voxel Bloom | green/orange chunky shell explosion |
| Ghost Waves | monochrome streak wave sheets |
| Teal Current | teal light current |
| Neon Twist | violet/cyan fiber twist |

## Run the editor

```bash
cd vfx-editor
npm install
npm run dev      # → http://localhost:5173
```

Drag to orbit, scroll to zoom, **✦ Burst** to punch radial effects.
Tune any parameter live, then **Export JSON** or grab a **PNG** snapshot.

## Use effects in your game

Effects are portable JSON (`frontier-vfx/1`) — see ready-made files in
[`/presets`](presets). Three.js runtime:

```js
import { loadVfx } from './engine/frontier-vfx-loader.js';
const fx = await loadVfx(scene, './presets/fiber-burst.json');
// per frame: fx.update(dt, true);
// on impact: fx.triggerBurst();
```

Porting to another engine? [`engine/FORMAT.md`](engine/FORMAT.md) documents the
full param→uniform map; the GLSL ports directly (attributes: `aSeed`, `aDir`).

## Layout

```
Frontier/
├── vfx-editor/        # visual editor (Vite + Three.js)
│   └── src/
│       ├── main.js        # editor UI + viewport + post chain
│       ├── vfx-engine.js  # GPU particle runtime (the canonical impl)
│       └── presets.js     # the 7 reference-matched presets
├── presets/           # exported frontier-vfx/1 JSON, one per preset
└── engine/            # game-side loader + format spec
```

## How it renders

- One unified GPU-parametric system: positions are pure functions of
  `(seed, direction, time)` — zero CPU simulation, 60k particles easy.
- Two layers per effect: **streak lines** (head/tail verts evaluated at
  `t` and `t − streakLength`) + **twinkling point sprites**.
- 3-stop life gradient (hot head → deep tail), additive blending,
  UnrealBloom + ACES for the glow.
