# Unified Studio

The standalone Studio redesign: Layers / Outliner on the left, a canvas placeholder in the middle (no viewport), Properties
on the right, and a floating, draggable Workspaces palette for switching between Paint, UV and the other workspaces.

- Source: `SultanAladin/Slate`, `master`, `References/Studio-standalone.html` (blob `3a216396`, commit `62e354e`,
  2026-08-30). The same blob is on every Slate branch that carries the file.
- Change from the source: the Lucide icon script loads from `Vendor/lucide.min.js` (lucide 1.78.0, licence in
  `Vendor/lucide-LICENSE`) instead of `unpkg.com/lucide@latest`. The General Sans font still loads from Fontshare.
- Serve: `python3 Experimental/UnifiedStudio/Serve.py` → `http://0.0.0.0:8130/`.

Its quick action menus and toggles have not yet been ported to the Project Zero Editor's Texture paint, Pattern or Stamp
workspaces. Only its inspector and panel styling was carried over earlier.
