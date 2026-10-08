# Frontier VFX format `frontier-vfx/1`

Effects exported from the editor (and in `/presets`) are plain JSON that map
**1:1 to GPU shader uniforms**. Porting to any engine = reimplementing one
vertex/fragment pair (see `vfx-editor/src/vfx-engine.js`, ~200 lines of GLSL).

```json
{ "format": "frontier-vfx/1", "preset": "fiber-burst", "params": { ... } }
```

## Geometry (built once per `count` change)

| Buffer | Contents |
|---|---|
| streaks (`LineSegments`, 2 verts / particle) | `aSeed` vec4 random, `aDir` vec3 unit-sphere dir, `aEnd` 0 head / 1 tail |
| points (`Points`, 1 vert / particle) | `aSeed` vec4, `aDir` vec3 |

All motion is **procedural in the vertex shader** — no CPU per-frame updates,
no textures, no simulation state. Time loops with `fract(uTime / uLife + seed.w)`.

## Params → uniforms

| Param | Type | Meaning |
|---|---|---|
| `shape` | 0–4 | 0 Burst (radial starburst) · 1 Bloom (dome + dust) · 2 Silk Flow (ribbon current) · 3 Voxel Shell (chunky explosion) · 4 Wave Layers (parallel streak sheets) |
| `count` | 1k–60k | particle count (rebuild buffers on change) |
| `life` | s | loop duration |
| `speed` / `radius` / `spread` | float | expansion speed, burst size, directional scatter |
| `dirX/Y/Z` | float | emitter bias direction |
| `turbulence` / `curl` / `twist` | float | flow-field chaos, swirl coupling, ribbon/radial twist |
| `waveFreq` / `waveAmp` | float | sine warp of flow shapes |
| `flowSpeed` / `flowLength` | float | travel speed + span of flow shapes |
| `gravity` / `drag` | float | downward pull (neg = rise), expansion easing |
| `colorA/B/C` | hex | head (hot) → mid → tail (deep) gradient over particle life |
| `background` | hex | clear color |
| `streakLength` | 0–0.2 | trail length in life units (`tHead − aEnd·uStreak`) |
| `streakOpacity` / `pointSize` / `pointOpacity` | float | layer intensities |
| `coreGlow` | 0–2 | central additive sprite strength |
| `bloom` / `exposure` | float | post: UnrealBloom strength + tone-map exposure |
| `showStreaks` / `showPoints` | bool | layer visibility |

Blending: **additive**, depth-write off. Post chain: bloom (radius ≈ 0.65,
threshold ≈ 0.12) → ACES tone map.

## One-shot bursts in gameplay

Keep the effect looping ambiently, then call `triggerBurst()` (decays over
~0.7 s, drives the `uBurst` punch uniform) on impacts, pickups, ults, etc.
