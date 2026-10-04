# Frontier

HTML redesign of the **Project Zero** development editor, replicated from the C++ editor
sources (dock host, outliner, viewport + gizmo, inspector, Construct window) and served
straight from static files — open `Editor/index.html` in a browser, no build step.

## Layout

- `Editor/index.html` — the fullscreen dock host (Outliner · Viewport · Inspector), the
  Construct window, the Control Centre shade, popup + toast shells.
- `Editor/css/editor.css` — the full style sheet; geometry and colour tokens mirror the
  editor's style specification (window `#121212`, popup `#1a1a1a`, roundings 8/12/16/18,
  44 px rail + 2 px convergence hairline, 40 px foot strips).
- `Editor/js/` — the panels: `scene.js` (the feed/roster, sheets, readout), `outliner.js`,
  `inspector.js`, `viewport.js` (canvas scene + the editor's translate/rotate/scale gizmo,
  orbit camera, console), `widgets.js`, `icons.js`, `app.js` (host glue, Construct, keys).
- `Editor/icons/` — the icon set: engine icon artwork plus the previously unregistered
  symbols (tyres, wheel rims, tread, plants, primitives, …) and two new family drawings,
  `editor-vehicle.svg` and `editor-cloth.svg`. Attribution in `Editor/icons/NOTICE.md`.

## Keys

`Tab` compact outliner · `W/E/R` gizmo mode · `Shift+A` Construct · `Ctrl+K` console ·
`Ctrl+Shift+F` outliner search · `Ctrl+R` realtime toggle · `Esc` closes.

The viewport draws each outliner entry as its own coloured box; the room shell reads as
tinted glass so the volumes keep their colours. Drag rows in the outliner to reparent
(top of a row = sibling before, rest = child).
