# Level Designer · Lobby

The Lobby is the first level: a car configurator showroom. Players see **no interface**, only small dots on the car. Pressing a dot flies the camera to that part (wheels, paint, glass, rear wing, lights, trim) and opens a strip of colour swatches for it.

The **Level Designer** is the editor around the level. It uses the Component Viewer's layout, styling, icons and ControlVehicle. All of that comes from `Experimental/Shared` (Studio kit, three r187, DM Sans, `.facet` models).

```
python3 Experimental/LevelDesigner/Serve.py        # http://0.0.0.0:8096/
```

| URL flag | Effect |
|---|---|
| `?play=1` | Opens straight into the Lobby, with no editor interface |
| `?tier=premium` | Starts as a Premium designer |
| `?fresh=1` | Ignores the level saved in this browser |
| `?focus=wheels` | Opens a configurator part: paint, wheels, glass, wing, lights or trim |

![Level Designer](Screenshots/level-designer.png)
![Lobby](Screenshots/lobby.png)

## Workspace
- **Outliner:** the level is split into **Environment**, **Vehicle** and **Lights**.
  - **Environment:** sky, sun, floor, cyclorama, two leaning slabs, turntable and light arches.
  - **Vehicle:** the ControlVehicle, with its configurator dots underneath it.
  - **Lights:** any lights you have added.
  - **Your placements** are Premium only.
  - Each row has an eye toggle. The **Add** menu (with search) adds lights, dots and lobby pieces.
- **Viewport tools:**
  - **Select** (`Q`), **Move** (`W`) and **Turn** (`E`), shown as a gizmo with axis arrows, plane handles, a free handle and a ground ring.
  - **Snap** (25 cm / 15°, or hold `Ctrl`), dots toggle (`H`), light glyphs toggle and **Frame** (`F`).
  - Hero / Front / Side / Rear / Top views and **Play lobby** (`P`, `Esc` to return).
- **Details:** each kind of placement has its own panels.
  - **Sky:** zenith, horizon and haze, plus ambient and exposure.
  - **Sun:** a draggable top-view dial, height, strength, softness and colour.
  - **Floor:** colour and gloss (how much of the room it mirrors).
  - **Cyclorama:** height, radius, sweep and top curve.
  - **Turntable:** spin, speed, radius and ring.
  - **Light arches:** count, spacing and colour.
  - **Vehicle:** every configurator row, plus the paint finish.
  - **Dots:** which part the dot opens and the camera view. **Use this view** copies the current camera.
  - **Lights:** colour, strength, reach, cone and shadows.
  - **Pieces:** colour, roughness and metalness.
- **Environment presets:**
  - **Daylight cove** (default, neutral): white curved walls, blue sky and a glossy floor.
  - **Overcast gallery:** concrete floor and a warm low sun.
  - **Night studio:** dark room, arched light strips and a bright turntable ring.

## Tiers
- **Basic:** the built-in lobby, plus environment edits, added lights and configurator dots.
- **Premium:** also lobby pieces (plinth, block, sphere, wall panel, arch) and imported models (OBJ, glTF / GLB, STL, PLY, FCT1). Imports are centred on the floor and scaled to metres.

The level saves to `localStorage` as you edit, and **Export JSON** writes a `Frontier.Level` document. Imported models last for the session only.

## Files
| File | Purpose |
|---|---|
| `Main.js` | Boot and URL flags |
| `LevelDesigner.js` | Outliner, tools, Details, play mode and shortcuts |
| `Level.js` | Placements, add/remove, picking and persistence |
| `Lobby.js` | Sky dome shader, cyclorama geometry, mirror floor (`Vendor/Reflector.js` from three r187), slabs, turntable, light arches and the PMREM reflection bake |
| `Vehicle.js` | ControlVehicle built straight from the facet streams, with per-part, per-family materials and paint finishes |
| `Configurator.js` | Zones, swatches, default dots, camera flights and the swatch strip |
| `Gizmo.js` | Move / turn gizmo. It listens in the capture phase, so handle drags never reach the camera rig |
| `LevelIcons.js` | Shared studio icons plus level glyphs (select, move, turn, sun, sky, floor, wall, turntable…) |
