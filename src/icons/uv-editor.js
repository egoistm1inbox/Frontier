/**
 * UV Editor Icon Set (16 Icons)
 * Visual Style: 3D Claymorphic / Stylized DCC Matte Plastic
 * Inspired by reference assets: charcoal body, warm amber/yellow accents, electric cyan highlights, soft bevels
 */

export const uvIcons = [
  {
    id: 'uv-unwrap',
    name: 'UV Unwrap',
    category: 'UV Editor',
    tags: ['unwrap', 'flatten', 'projection', 'texture', 'seam', 'pelt'],
    description: 'Calculates an optimal 2D UV layout by flattening 3D mesh geometry along marked seams with conformal angle conservation.',
    hotkeys: { blender: 'U > U', maya: 'Ctrl+U', c4d: 'Shift+U', max: 'Unwrap UVW' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="uv-unwrap-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="6" flood-color="#000" flood-opacity="0.45"/>
    </filter>
    <linearGradient id="uv-unw-body" x1="20" y1="20" x2="108" y2="108" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#3a404d"/>
      <stop offset="45%" stop-color="#242831"/>
      <stop offset="100%" stop-color="#181a20"/>
    </linearGradient>
    <linearGradient id="uv-unw-gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="50%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#b45309"/>
    </linearGradient>
    <linearGradient id="uv-unw-cyan" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#7dd3fc"/>
      <stop offset="100%" stop-color="#0284c7"/>
    </linearGradient>
    <linearGradient id="uv-unw-bevel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.0"/>
    </linearGradient>
  </defs>
  <!-- Ambient Shadow -->
  <ellipse cx="64" cy="112" rx="46" ry="10" fill="#000" opacity="0.4" filter="blur(5px)"/>
  
  <!-- Flattened UV Net Tiles -->
  <g filter="url(#uv-unwrap-shadow)">
    <!-- Base Plate Grid / Coordinate tile -->
    <rect x="22" y="22" width="84" height="84" rx="14" fill="url(#uv-unw-body)" stroke="#4b5563" stroke-width="2"/>
    <rect x="23" y="23" width="82" height="82" rx="13" fill="none" stroke="url(#uv-unw-bevel)" stroke-width="1.5"/>

    <!-- Grid checker sub-lines -->
    <path d="M22 64 H106 M64 22 V106" stroke="#374151" stroke-width="2" stroke-dasharray="3 3"/>
    
    <!-- 3D Unfolded Faces (Cube net peeling open) -->
    <!-- Top Face -->
    <rect x="48" y="28" width="32" height="24" rx="4" fill="url(#uv-unw-gold)" opacity="0.95"/>
    <rect x="49" y="29" width="30" height="22" rx="3" fill="none" stroke="#fef08a" stroke-width="1" opacity="0.8"/>
    <!-- Center Face -->
    <rect x="48" y="56" width="32" height="26" rx="4" fill="#2d323f" stroke="#fbbf24" stroke-width="2"/>
    <!-- Left Flap peeling -->
    <path d="M26 62 L44 56 V82 L26 78 Z" fill="url(#uv-unw-cyan)" opacity="0.9"/>
    <!-- Right Flap peeling -->
    <path d="M102 62 L84 56 V82 L102 78 Z" fill="url(#uv-unw-cyan)" opacity="0.9"/>
    <!-- Bottom Face -->
    <rect x="48" y="86" width="32" height="16" rx="4" fill="#3b4252" stroke="#6b7280" stroke-width="1.5"/>

    <!-- Cut Seam Lines (Warm Amber dashed cut lines) -->
    <path d="M48 28 V102 M80 28 V102" stroke="#fef08a" stroke-width="2" stroke-dasharray="4 2"/>

    <!-- 3D Peeling Arrows -->
    <path d="M38 52 L26 44 M26 44 L34 43 M26 44 L28 52" stroke="#f59e0b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M90 52 L102 44 M102 44 L94 43 M102 44 L100 52" stroke="#f59e0b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>

    <!-- Center vertex pin bead -->
    <circle cx="64" cy="69" r="4" fill="#f8fafc" stroke="#d97706" stroke-width="2"/>
  </g>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M9 3h6v4H9zM9 7h6v6H9zM9 13h6v4H9zM3 7h6v6H3zM15 7h6v6h-6z"/>
  <path d="M5 5l2 2m12-2l-2 2" stroke-dasharray="2 2"/>
</svg>`
  },
  {
    id: 'uv-smart-project',
    name: 'Smart UV Project',
    category: 'UV Editor',
    tags: ['smart', 'project', 'angle', 'projection', 'automatic', 'cubemap'],
    description: 'Algorithms automatically detect surface angle thresholds and project multiple UV islands into normalized UV space.',
    hotkeys: { blender: 'U > S', maya: 'Auto UV', c4d: 'Auto UV Unwrap', max: 'Flatten Mapping' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="uv-smart-body" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#343946"/>
      <stop offset="100%" stop-color="#171920"/>
    </linearGradient>
    <linearGradient id="uv-smart-gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="70%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#b45309"/>
    </linearGradient>
    <linearGradient id="uv-smart-cyan" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#0369a1"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="114" rx="42" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Base Coordinate Plate -->
  <rect x="20" y="80" width="88" height="34" rx="8" fill="url(#uv-smart-body)" stroke="#4b5563" stroke-width="2"/>
  <rect x="24" y="84" width="80" height="26" rx="5" fill="#1e222a"/>
  
  <!-- Target UV Island Footprints on Plate -->
  <rect x="30" y="88" width="22" height="18" rx="3" fill="url(#uv-smart-cyan)" opacity="0.85"/>
  <rect x="56" y="88" width="24" height="18" rx="3" fill="url(#uv-smart-gold)" opacity="0.9"/>
  <rect x="84" y="90" width="14" height="14" rx="2" fill="#64748b"/>

  <!-- Upper 3D Polyhedral Geo (Projecting Source) -->
  <g transform="translate(64, 42)">
    <!-- 3D Isometric Diamond/Icosahedron Facets -->
    <polygon points="0,-28 26,-10 0,16 -26,-10" fill="#3b4252" stroke="#64748b" stroke-width="1.5"/>
    <polygon points="0,16 26,-10 24,18 0,32" fill="url(#uv-smart-cyan)"/>
    <polygon points="0,16 -26,-10 -24,18 0,32" fill="url(#uv-smart-gold)"/>
    <polygon points="0,-28 26,-10 24,18 0,32" fill="none" stroke="#f8fafc" stroke-width="1" opacity="0.4"/>
  </g>

  <!-- Projection Laser Cones / Projection Rays -->
  <path d="M48 64 L36 86 M64 74 L68 86 M80 64 L90 88" stroke="#38bdf8" stroke-width="2.5" stroke-dasharray="3 3" opacity="0.85"/>
  <polygon points="34,88 38,82 42,86" fill="#38bdf8"/>
  <polygon points="66,88 70,82 74,86" fill="#fbbf24"/>
  <polygon points="88,90 92,84 96,88" fill="#38bdf8"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 2l7 4v6l-7 4-7-4V6z"/>
  <path d="M12 2v14M5 6l7 4 7-4"/>
  <path d="M3 19h18M5 16l-2 3M19 16l2 3M12 16v3" stroke-dasharray="2 2"/>
</svg>`
  },
  {
    id: 'uv-mark-seam',
    name: 'Mark Seam',
    category: 'UV Editor',
    tags: ['seam', 'cut', 'knife', 'mark', 'edge', 'boundary'],
    description: 'Marks selected polygonal edges as UV boundary cuts, enabling unwrapping algorithms to flatten topology cleanly.',
    hotkeys: { blender: 'Ctrl+E > M', maya: 'Cut UV Edge', c4d: 'Set Seam', max: 'Point to Point Seam' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="uv-mark-blade" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="40%" stop-color="#cbd5e1"/>
      <stop offset="100%" stop-color="#64748b"/>
    </linearGradient>
    <linearGradient id="uv-mark-handle" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#9a3412"/>
    </linearGradient>
    <filter id="uv-glow-gold" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <ellipse cx="64" cy="112" rx="42" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- 3D Mesh Edge Rails (Dark Charcoal Polygon Face) -->
  <polygon points="18,78 64,106 110,78 64,52" fill="#20242e" stroke="#3b4252" stroke-width="3"/>
  <polygon points="18,78 64,106 64,116 18,88" fill="#16181f"/>
  <polygon points="110,78 64,106 64,116 110,88" fill="#111317"/>

  <!-- High-Luminance Glowing Seam Line (Amber/Gold) -->
  <g filter="url(#uv-glow-gold)">
    <path d="M18 78 L64 106 L110 78" stroke="#f59e0b" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M18 78 L64 106 L110 78" stroke="#fef08a" stroke-width="2" stroke-dasharray="6 3" stroke-linecap="round"/>
  </g>

  <!-- Seam Cut Spark Particles -->
  <circle cx="64" cy="106" r="3.5" fill="#fef08a"/>
  <circle cx="68" cy="100" r="2" fill="#f59e0b"/>
  <circle cx="58" cy="98" r="2" fill="#f59e0b"/>

  <!-- 3D Scalpel / Craft Knife (Referencing clay camera / clapperboard hardware) -->
  <g transform="translate(68, 18) rotate(22)">
    <!-- Knife Handle -->
    <rect x="-8" y="0" width="16" height="52" rx="7" fill="url(#uv-mark-handle)" stroke="#fef08a" stroke-width="1.5"/>
    <!-- Grip Ribs -->
    <line x1="-5" y1="14" x2="5" y2="14" stroke="#78350f" stroke-width="2" stroke-linecap="round"/>
    <line x1="-5" y1="22" x2="5" y2="22" stroke="#78350f" stroke-width="2" stroke-linecap="round"/>
    <line x1="-5" y1="30" x2="5" y2="30" stroke="#78350f" stroke-width="2" stroke-linecap="round"/>
    <!-- Metal Ferrule & Screws -->
    <rect x="-7" y="48" width="14" height="10" rx="2" fill="#475569" stroke="#94a3b8" stroke-width="1"/>
    <circle cx="0" cy="53" r="2" fill="#cbd5e1"/>
    <!-- Angled Razor Blade -->
    <polygon points="-5,58 5,58 5,82 -5,70" fill="url(#uv-mark-blade)" stroke="#e2e8f0" stroke-width="1.2"/>
    <line x1="5" y1="58" x2="5" y2="82" stroke="#f8fafc" stroke-width="1.5"/>
  </g>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 18l8 3 8-3-8-3-8 3z"/>
  <path d="M4 18l8 3 8-3" stroke="currentColor" stroke-width="2.5" stroke-dasharray="2 2"/>
  <path d="M14 4l5 5-9 9H5v-5l9-9z"/>
</svg>`
  },
  {
    id: 'uv-clear-seam',
    name: 'Clear Seam',
    category: 'UV Editor',
    tags: ['clear', 'remove', 'erase', 'weld', 'stitch', 'unmark'],
    description: 'Removes UV cut marks from active edges, restoring unbroken edge continuity for layout relaxation.',
    hotkeys: { blender: 'Ctrl+E > Alt+M', maya: 'Sew UVs', c4d: 'Clear Seam', max: 'Remove Seam' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="uv-clear-body" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#353b49"/>
      <stop offset="100%" stop-color="#191c24"/>
    </linearGradient>
    <linearGradient id="uv-clear-eraser" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fb7185"/>
      <stop offset="100%" stop-color="#e11d48"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="112" rx="42" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Mesh Surface Geometry -->
  <polygon points="18,78 64,106 110,78 64,52" fill="#20242e" stroke="#3b4252" stroke-width="3"/>
  
  <!-- Faded/Clearing Seam Line -->
  <path d="M18 78 L46 95" stroke="#f59e0b" stroke-width="3" stroke-dasharray="4 3" opacity="0.4"/>
  <path d="M46 95 L64 106 L110 78" stroke="#475569" stroke-width="3"/>

  <!-- 3D Clay Eraser / Cleaner Tool -->
  <g transform="translate(68, 30) rotate(-15)">
    <!-- Clay Eraser Body -->
    <rect x="-14" y="0" width="28" height="48" rx="8" fill="url(#uv-clear-eraser)" stroke="#fda4af" stroke-width="1.5"/>
    <!-- Paper Sleeve with SADA style label -->
    <rect x="-15" y="16" width="30" height="26" rx="4" fill="#1e293b" stroke="#64748b" stroke-width="1.2"/>
    <rect x="-10" y="24" width="20" height="4" rx="2" fill="#38bdf8"/>
    <!-- Erase Dust Specks -->
    <circle cx="-16" cy="52" r="2" fill="#cbd5e1" opacity="0.7"/>
    <circle cx="-8" cy="56" r="2.5" fill="#cbd5e1" opacity="0.9"/>
    <circle cx="2" cy="54" r="1.8" fill="#cbd5e1" opacity="0.6"/>
  </g>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 18l8 3 8-3-8-3-8 3z"/>
  <path d="M18 4l3 3-7 7-3-3 7-7z"/>
  <path d="M11 11l-3 3 2 2 3-3"/>
  <line x1="6" y1="20" x2="10" y2="20"/>
</svg>`
  },
  {
    id: 'uv-pack-islands',
    name: 'Pack Islands',
    category: 'UV Editor',
    tags: ['pack', 'islands', 'layout', 'organize', 'atlas', 'density'],
    description: 'Packs multiple UV islands tightly within the 0..1 UV coordinate space, maximizing texel density and minimizing wasted texture area.',
    hotkeys: { blender: 'Ctrl+P', maya: 'Layout UVs', c4d: 'UV Packing', max: 'Pack UVs' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="uv-pack-tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2a2e39"/>
      <stop offset="100%" stop-color="#14161c"/>
    </linearGradient>
    <linearGradient id="uv-pack-island1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="100%" stop-color="#d97706"/>
    </linearGradient>
    <linearGradient id="uv-pack-island2" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#0284c7"/>
    </linearGradient>
    <linearGradient id="uv-pack-island3" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fb7185"/>
      <stop offset="100%" stop-color="#be123c"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="114" rx="46" ry="8" fill="#000" opacity="0.5" filter="blur(5px)"/>

  <!-- Master UV 0-1 Coordinate Tile -->
  <rect x="20" y="20" width="88" height="88" rx="14" fill="url(#uv-pack-tile)" stroke="#4b5563" stroke-width="2.5"/>
  <rect x="22" y="22" width="84" height="84" rx="12" fill="none" stroke="#ffffff" stroke-width="1.5" opacity="0.15"/>

  <!-- Packing Margins and Grid Lines -->
  <rect x="26" y="26" width="76" height="76" rx="8" fill="none" stroke="#374151" stroke-width="1.5" stroke-dasharray="3 3"/>

  <!-- Interlocking 3D Clay Islands -->
  <!-- Island 1 (Amber L-Shape) -->
  <path d="M30 30 H70 V52 H54 V74 H30 Z" fill="url(#uv-pack-island1)" stroke="#fef08a" stroke-width="1.5" rx="4"/>
  
  <!-- Island 2 (Cyan Rectangle) -->
  <rect x="74" y="30" width="24" height="38" rx="5" fill="url(#uv-pack-island2)" stroke="#bae6fd" stroke-width="1.5"/>
  
  <!-- Island 3 (Coral Wedge) -->
  <polygon points="58,56 98,72 98,98 58,98" fill="url(#uv-pack-island3)" stroke="#fecdd3" stroke-width="1.5"/>

  <!-- Island 4 (Small Slate Block) -->
  <rect x="30" y="78" width="22" height="20" rx="4" fill="#475569" stroke="#94a3b8" stroke-width="1.5"/>

  <!-- Magnetic Snap Convergence Indicator -->
  <circle cx="64" cy="64" r="5" fill="#f8fafc" stroke="#f59e0b" stroke-width="2"/>
  <path d="M64 54 V58 M64 74 V70 M54 64 H58 M74 64 H70" stroke="#f8fafc" stroke-width="2" stroke-linecap="round"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="3"/>
  <path d="M6 6h7v4H9v4H6z"/>
  <rect x="15" y="6" width="3" height="6" rx="1"/>
  <rect x="12" y="14" width="6" height="4" rx="1"/>
  <rect x="6" y="15" width="4" height="3" rx="1"/>
</svg>`
  },
  {
    id: 'uv-pin',
    name: 'Pin UV',
    category: 'UV Editor',
    tags: ['pin', 'lock', 'freeze', 'anchor', 'vertex', 'thumbtack'],
    description: 'Pins selected UV vertices in place, preventing them from shifting or sliding during subsequent unwrapping or relaxation operations.',
    hotkeys: { blender: 'P', maya: 'Pin Component', c4d: 'Pin UV', max: 'Freeze Vertices' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="uv-pin-head" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="50%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#b45309"/>
    </linearGradient>
    <linearGradient id="uv-pin-needle" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#64748b"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="112" rx="42" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- UV Grid Background Plate -->
  <rect x="24" y="58" width="80" height="52" rx="10" fill="#1e222b" stroke="#374151" stroke-width="2"/>
  <path d="M24 84 H104 M64 58 V110" stroke="#4b5563" stroke-width="2"/>

  <!-- Pinned Red/Amber Target Ring -->
  <circle cx="64" cy="84" r="10" fill="#f59e0b" fill-opacity="0.2" stroke="#f59e0b" stroke-width="2.5" stroke-dasharray="3 2"/>
  <circle cx="64" cy="84" r="3" fill="#ef4444"/>

  <!-- 3D Thumbtack / Pushpin Piercing Down -->
  <g transform="translate(64, 40)">
    <!-- Pin Needle -->
    <polygon points="-2,18 2,18 1,44 -1,44" fill="url(#uv-pin-needle)" stroke="#cbd5e1" stroke-width="0.8"/>
    <!-- Pin Lower Collar -->
    <ellipse cx="0" cy="18" rx="8" ry="3.5" fill="#d97706" stroke="#fef08a" stroke-width="1"/>
    <!-- Pin Concave Grip Body -->
    <path d="M-7 18 C-4 8 -11 -6 -12 -16 H12 C11 -6 4 8 7 18 Z" fill="url(#uv-pin-head)" stroke="#fef08a" stroke-width="1.2"/>
    <!-- Pin Top Rounded Cap -->
    <ellipse cx="0" cy="-16" rx="14" ry="6" fill="#fde047" stroke="#ffffff" stroke-width="1.5"/>
    <ellipse cx="0" cy="-18" rx="8" ry="3" fill="#ffffff" opacity="0.6"/>
  </g>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 17v5M9 4h6l-1 7h3l-5 6-5-6h3L9 4z"/>
  <circle cx="12" cy="17" r="1" fill="currentColor"/>
</svg>`
  },
  {
    id: 'uv-unpin',
    name: 'Unpin UV',
    category: 'UV Editor',
    tags: ['unpin', 'unlock', 'free', 'release', 'thumbtack'],
    description: 'Releases the pin lock on selected UV coordinates, allowing them to adapt freely during future relaxing passes.',
    hotkeys: { blender: 'Alt+P', maya: 'Unpin Component', c4d: 'Unpin UV', max: 'Unfreeze Vertices' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="uv-unpin-head" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#0369a1"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="112" rx="40" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- UV Grid Background -->
  <rect x="24" y="60" width="80" height="50" rx="10" fill="#1e222b" stroke="#374151" stroke-width="2"/>
  <path d="M24 85 H104 M64 60 V110" stroke="#4b5563" stroke-width="2"/>

  <!-- Released Vertex Spot with Sparkles -->
  <circle cx="64" cy="85" r="5" fill="#38bdf8" fill-opacity="0.3" stroke="#38bdf8" stroke-width="2"/>
  <circle cx="64" cy="85" r="2.5" fill="#f8fafc"/>

  <!-- Upward Lift Motion Arcs -->
  <path d="M50 72 C50 62 58 56 64 56 C70 56 78 62 78 72" stroke="#38bdf8" stroke-width="2" stroke-dasharray="3 3"/>
  <path d="M64 52 V40 M60 44 L64 38 L68 44" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- Tilted Lifting Pin -->
  <g transform="translate(64, 28) rotate(-18)">
    <polygon points="-2,14 2,14 1,32 -1,32" fill="#cbd5e1"/>
    <path d="M-6 14 C-3 6 -9 -4 -10 -12 H10 C9 -4 3 6 6 14 Z" fill="url(#uv-unpin-head)" stroke="#7dd3fc" stroke-width="1.2"/>
    <ellipse cx="0" cy="-12" rx="12" ry="5" fill="#7dd3fc" stroke="#ffffff" stroke-width="1.2"/>
  </g>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 9V3m-3 3l3-3 3 3"/>
  <path d="M9 13h6l-1 5h2l-4 4-4-4h2l-1-5z"/>
  <circle cx="12" cy="21" r="1"/>
</svg>`
  },
  {
    id: 'uv-relax',
    name: 'Relax & Smooth',
    category: 'UV Editor',
    tags: ['relax', 'smooth', 'stretch', 'minimize', 'tension', 'springs'],
    description: 'Minimizes texture distortion by running spring-relaxation iterations across the UV island mesh.',
    hotkeys: { blender: 'UV > Minimize Stretch', maya: 'Unfold / Relax', c4d: 'Relax UV', max: 'Relax Tool' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="uv-relax-mesh" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#343946"/>
      <stop offset="100%" stop-color="#191c24"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="112" rx="44" ry="9" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Relaxing Mesh Grid (Curved, relaxing boundary) -->
  <path d="M30 40 Q64 30 98 40 Q106 64 98 88 Q64 98 30 88 Q22 64 30 40 Z" fill="url(#uv-relax-mesh)" stroke="#4b5563" stroke-width="2.5"/>

  <!-- Internal Quad Flow Lines -->
  <path d="M52 35 Q54 64 52 93 M76 35 Q74 64 76 93" stroke="#64748b" stroke-width="1.8"/>
  <path d="M26 54 Q64 56 102 54 M26 74 Q64 72 102 74" stroke="#64748b" stroke-width="1.8"/>

  <!-- Spring Damping Stress Arrows (Amber Relaxation Vectors) -->
  <g stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <!-- North arrow -->
    <path d="M64 42 V28 M59 33 L64 28 L69 33"/>
    <!-- South arrow -->
    <path d="M64 86 V100 M59 95 L64 100 L69 95"/>
    <!-- West arrow -->
    <path d="M38 64 H24 M29 59 L24 64 L29 69"/>
    <!-- East arrow -->
    <path d="M90 64 H104 M99 59 L104 64 L99 69"/>
  </g>

  <!-- Central Relax Bead -->
  <circle cx="64" cy="64" r="5" fill="#fde047" stroke="#b45309" stroke-width="1.5"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="4" y="4" width="16" height="16" rx="4"/>
  <path d="M4 12h16M12 4v16"/>
  <path d="M12 2l-2 2h4l-2-2zM12 22l-2-2h4l-2 2zM2 12l2-2v4l-2-2zM22 12l-2-2v4l2-2z"/>
</svg>`
  },
  {
    id: 'uv-stitch',
    name: 'Stitch Seams',
    category: 'UV Editor',
    tags: ['stitch', 'sew', 'join', 'weld', 'combine', 'seam'],
    description: 'Bridges and stitches corresponding split UV edges back into continuous adjacent UV islands.',
    hotkeys: { blender: 'Alt+V', maya: 'Stitch Together', c4d: 'Stitch UV', max: 'Stitch Selected' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="uv-stitch-needle" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="50%" stop-color="#cbd5e1"/>
      <stop offset="100%" stop-color="#64748b"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Left UV Island Face -->
  <path d="M22 36 H52 V92 H22 Z" fill="#242833" stroke="#4b5563" stroke-width="2"/>
  <!-- Right UV Island Face -->
  <path d="M76 36 H106 V92 H76 Z" fill="#242833" stroke="#4b5563" stroke-width="2"/>

  <!-- Stitched Thread Crossings (Warm Gold String) -->
  <g stroke="#f59e0b" stroke-width="3" stroke-linecap="round">
    <line x1="52" y1="46" x2="76" y2="54"/>
    <line x1="52" y1="54" x2="76" y2="46"/>
    <line x1="52" y1="68" x2="76" y2="76"/>
    <line x1="52" y1="76" x2="76" y2="68"/>
    <!-- Thread loops -->
    <circle cx="52" cy="46" r="3" fill="#fde047"/>
    <circle cx="76" cy="54" r="3" fill="#fde047"/>
    <circle cx="52" cy="68" r="3" fill="#fde047"/>
    <circle cx="76" cy="76" r="3" fill="#fde047"/>
  </g>

  <!-- Curved Metallic Needle Piercing Down -->
  <g transform="translate(68, 20) rotate(30)">
    <!-- Eye of Needle -->
    <path d="M0 0 C6 15 12 35 14 60 L10 60 C8 38 4 18 0 0 Z" fill="url(#uv-stitch-needle)" stroke="#e2e8f0" stroke-width="1"/>
    <ellipse cx="4" cy="8" rx="2" ry="4" fill="#1e293b"/>
    <!-- Golden Thread through eye -->
    <path d="M-6 4 Q4 8 14 16" stroke="#fbbf24" stroke-width="2" fill="none"/>
  </g>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 6h5v12H4zM15 6h5v12h-5z"/>
  <path d="M9 9l6 3M9 12l6-3M9 15l6 3M9 18l6-3"/>
</svg>`
  },
  {
    id: 'uv-checker',
    name: 'UV Checker Map',
    category: 'UV Editor',
    tags: ['checker', 'grid', 'texture', 'texel', 'distortion', 'test'],
    description: 'Displays a high-contrast checkerboard texture pattern to inspect texel density and UV distortion.',
    hotkeys: { blender: 'Viewport Display > Checker', maya: 'UV Texture Checker', c4d: 'Checker Shader', max: 'Checker Pattern' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="uv-chk-dark" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2d323f"/>
      <stop offset="100%" stop-color="#14161d"/>
    </linearGradient>
    <linearGradient id="uv-chk-gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="100%" stop-color="#d97706"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="112" rx="44" ry="9" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- 3D Checker Tile Plate (Beveled like battery top) -->
  <rect x="22" y="22" width="84" height="84" rx="14" fill="#1a1c22" stroke="#4b5563" stroke-width="2.5"/>

  <!-- Checkerboard 4x4 Grid with Clay Bevels -->
  <!-- Row 1 -->
  <rect x="26" y="26" width="18" height="18" rx="3" fill="url(#uv-chk-gold)"/>
  <rect x="46" y="26" width="18" height="18" rx="3" fill="url(#uv-chk-dark)"/>
  <rect x="66" y="26" width="18" height="18" rx="3" fill="url(#uv-chk-gold)"/>
  <rect x="86" y="26" width="16" height="18" rx="3" fill="url(#uv-chk-dark)"/>
  <!-- Row 2 -->
  <rect x="26" y="46" width="18" height="18" rx="3" fill="url(#uv-chk-dark)"/>
  <rect x="46" y="46" width="18" height="18" rx="3" fill="url(#uv-chk-gold)"/>
  <rect x="66" y="46" width="18" height="18" rx="3" fill="url(#uv-chk-dark)"/>
  <rect x="86" y="46" width="16" height="18" rx="3" fill="url(#uv-chk-gold)"/>
  <!-- Row 3 -->
  <rect x="26" y="66" width="18" height="18" rx="3" fill="url(#uv-chk-gold)"/>
  <rect x="46" y="66" width="18" height="18" rx="3" fill="url(#uv-chk-dark)"/>
  <rect x="66" y="66" width="18" height="18" rx="3" fill="url(#uv-chk-gold)"/>
  <rect x="86" y="66" width="16" height="18" rx="3" fill="url(#uv-chk-dark)"/>
  <!-- Row 4 -->
  <rect x="26" y="86" width="18" height="16" rx="3" fill="url(#uv-chk-dark)"/>
  <rect x="46" y="86" width="18" height="16" rx="3" fill="url(#uv-chk-gold)"/>
  <rect x="66" y="86" width="18" height="16" rx="3" fill="url(#uv-chk-dark)"/>
  <rect x="86" y="86" width="16" height="16" rx="3" fill="url(#uv-chk-gold)"/>

  <!-- Center Inspection Magnifier Ring -->
  <circle cx="64" cy="64" r="16" fill="none" stroke="#38bdf8" stroke-width="3" opacity="0.9"/>
  <circle cx="64" cy="64" r="12" fill="#38bdf8" fill-opacity="0.15"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="2"/>
  <path d="M3 12h18M12 3v18"/>
  <path d="M3 3h9v9H3zM12 12h9v9h-9z" fill="currentColor" fill-opacity="0.2"/>
</svg>`
  },
  {
    id: 'uv-island-select',
    name: 'UV Island Select',
    category: 'UV Editor',
    tags: ['select', 'island', 'shell', 'component', 'mode'],
    description: 'Selects an entire contiguous UV shell/island with a single click for fast transformation.',
    hotkeys: { blender: 'L or 4', maya: 'UV Shell Mode (F12)', c4d: 'Select Island', max: 'Select Element' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="uv-isl-amber" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="60%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#b45309"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Unselected UV Island 1 -->
  <path d="M22 30 H48 V56 H22 Z" fill="#242833" stroke="#4b5563" stroke-width="2" rx="4"/>
  <!-- Unselected UV Island 2 -->
  <polygon points="86,28 106,42 100,74 80,68" fill="#242833" stroke="#4b5563" stroke-width="2"/>

  <!-- Selected Active UV Island (Glowing Amber Clay Silhouette) -->
  <path d="M36 68 H74 V102 H36 Z" fill="url(#uv-isl-amber)" stroke="#fef08a" stroke-width="3" rx="6"/>
  
  <!-- Corner Selection Gizmo Nodes -->
  <circle cx="36" cy="68" r="4.5" fill="#ffffff" stroke="#d97706" stroke-width="2"/>
  <circle cx="74" cy="68" r="4.5" fill="#ffffff" stroke="#d97706" stroke-width="2"/>
  <circle cx="74" cy="102" r="4.5" fill="#ffffff" stroke="#d97706" stroke-width="2"/>
  <circle cx="36" cy="102" r="4.5" fill="#ffffff" stroke="#d97706" stroke-width="2"/>

  <!-- Island Cursor Pointer -->
  <polygon points="82,78 72,96 76,98 84,104 88,98 82,94" fill="#38bdf8" stroke="#ffffff" stroke-width="1.2"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M7 14h8v6H7z" fill="currentColor" fill-opacity="0.25"/>
  <rect x="6" y="13" width="10" height="8" rx="1"/>
  <path d="M4 4h5v5H4zM15 4h5v5h-5z" stroke-dasharray="2 2"/>
</svg>`
  },
  {
    id: 'uv-face-select',
    name: 'UV Face Select',
    category: 'UV Editor',
    tags: ['face', 'quad', 'polygon', 'select', 'component'],
    description: 'Enables individual polygon face selection inside the UV coordinate viewport.',
    hotkeys: { blender: '3', maya: 'Face (F11)', c4d: 'Polygons Mode', max: 'Polygon (4)' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="uv-face-grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="100%" stop-color="#f59e0b"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="112" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Surrounding Quad Mesh -->
  <rect x="22" y="22" width="84" height="84" rx="12" fill="#1e222b" stroke="#374151" stroke-width="2"/>
  <path d="M22 64 H106 M64 22 V106" stroke="#4b5563" stroke-width="2"/>

  <!-- Selected Active Face (Glowing Golden Quad) -->
  <rect x="24" y="24" width="38" height="38" rx="4" fill="url(#uv-face-grad)" stroke="#fef08a" stroke-width="2.5"/>
  <circle cx="43" cy="43" r="5" fill="#f8fafc" stroke="#d97706" stroke-width="2"/>

  <!-- Unselected Faces -->
  <circle cx="85" cy="43" r="3" fill="#475569"/>
  <circle cx="43" cy="85" r="3" fill="#475569"/>
  <circle cx="85" cy="85" r="3" fill="#475569"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="2"/>
  <path d="M3 12h18M12 3v18"/>
  <rect x="4" y="4" width="7" height="7" fill="currentColor" fill-opacity="0.3"/>
  <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor"/>
</svg>`
  },
  {
    id: 'uv-edge-select',
    name: 'UV Edge Select',
    category: 'UV Editor',
    tags: ['edge', 'select', 'component', 'line', 'seam'],
    description: 'Switches the UV editor into edge selection mode for seam definition and border straightening.',
    hotkeys: { blender: '2', maya: 'Edge (F10)', c4d: 'Edge Mode', max: 'Edge (2)' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="112" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Quad Mesh Grid -->
  <rect x="22" y="22" width="84" height="84" rx="12" fill="#1e222b" stroke="#374151" stroke-width="2"/>
  <path d="M22 64 H106 M64 22 V106" stroke="#374151" stroke-width="2"/>

  <!-- Highlighted Active Edge (Thick Amber Bar) -->
  <rect x="61" y="22" width="6" height="44" rx="3" fill="#f59e0b" stroke="#fef08a" stroke-width="1.5"/>
  <circle cx="64" cy="22" r="5" fill="#f8fafc" stroke="#d97706" stroke-width="2"/>
  <circle cx="64" cy="64" r="5" fill="#f8fafc" stroke="#d97706" stroke-width="2"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="2"/>
  <path d="M3 12h18M12 3v18"/>
  <line x1="12" y1="3" x2="12" y2="12" stroke="currentColor" stroke-width="3"/>
  <circle cx="12" cy="3" r="1.5" fill="currentColor"/>
  <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
</svg>`
  },
  {
    id: 'uv-vertex-select',
    name: 'UV Vertex Select',
    category: 'UV Editor',
    tags: ['vertex', 'point', 'select', 'component', 'coordinate'],
    description: 'Allows precise manipulation of individual 2D (U, V) coordinates and pinned vertices.',
    hotkeys: { blender: '1', maya: 'Vertex (F9)', c4d: 'Point Mode', max: 'Vertex (1)' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="uv-vert-glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="60%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#b45309"/>
    </radialGradient>
  </defs>
  <ellipse cx="64" cy="112" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Mesh Grid Coordinates -->
  <rect x="22" y="22" width="84" height="84" rx="12" fill="#1e222b" stroke="#374151" stroke-width="2"/>
  <path d="M22 64 H106 M64 22 V106" stroke="#4b5563" stroke-width="2"/>

  <!-- Inactive Vertices -->
  <circle cx="22" cy="64" r="3.5" fill="#64748b"/>
  <circle cx="106" cy="64" r="3.5" fill="#64748b"/>
  <circle cx="64" cy="22" r="3.5" fill="#64748b"/>
  <circle cx="64" cy="106" r="3.5" fill="#64748b"/>

  <!-- Active Selected 3D Vertex (Beaded Sphere with Coordinate Rings) -->
  <circle cx="64" cy="64" r="14" fill="#f59e0b" fill-opacity="0.25" stroke="#f59e0b" stroke-dasharray="3 2" stroke-width="1.5"/>
  <circle cx="64" cy="64" r="8" fill="url(#uv-vert-glow)" stroke="#ffffff" stroke-width="2"/>
  <!-- Crosshairs -->
  <path d="M64 48 V54 M64 74 V80 M48 64 H54 M74 64 H80" stroke="#fef08a" stroke-width="2" stroke-linecap="round"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="2"/>
  <path d="M3 12h18M12 3v18"/>
  <circle cx="12" cy="12" r="3" fill="currentColor"/>
  <circle cx="12" cy="12" r="5" stroke="currentColor" stroke-dasharray="2 2"/>
</svg>`
  },
  {
    id: 'uv-straighten',
    name: 'Straighten UVs',
    category: 'UV Editor',
    tags: ['straighten', 'align', 'axis', 'snap', 'orthogonal', 'rectify'],
    description: 'Straightens irregular, curved UV perimeter loops along orthogonal horizontal or vertical axis lines.',
    hotkeys: { blender: 'W > Straighten', maya: 'Straighten UVs', c4d: 'Align UVs', max: 'Straighten Selection' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="112" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Curving/Wavy distorted edge (before) -->
  <path d="M24 42 Q44 26 64 46 T104 38" stroke="#64748b" stroke-width="3" stroke-dasharray="4 3"/>

  <!-- Laser Straightened Edge (Golden Ruler bar) -->
  <rect x="22" y="74" width="84" height="12" rx="4" fill="#2d323f" stroke="#f59e0b" stroke-width="2"/>
  <!-- Ruler Marks -->
  <line x1="36" y1="74" x2="36" y2="80" stroke="#fde047" stroke-width="2"/>
  <line x1="50" y1="74" x2="50" y2="82" stroke="#fde047" stroke-width="2"/>
  <line x1="64" y1="74" x2="64" y2="84" stroke="#fde047" stroke-width="2.5"/>
  <line x1="78" y1="74" x2="78" y2="82" stroke="#fde047" stroke-width="2"/>
  <line x1="92" y1="74" x2="92" y2="80" stroke="#fde047" stroke-width="2"/>

  <!-- Snapping Downward Alignment Arrows -->
  <g stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M44 46 V64 M40 58 L44 64 L48 58"/>
    <path d="M64 54 V64 M60 58 L64 64 L68 58"/>
    <path d="M84 46 V64 M80 58 L84 64 L88 58"/>
  </g>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 7c4-3 7 3 11 0s5-1 7 0" stroke-dasharray="2 2"/>
  <line x1="3" y1="17" x2="21" y2="17" stroke-width="2.5"/>
  <path d="M7 10v4m5-4v4m5-4v4"/>
</svg>`
  },
  {
    id: 'uv-peel',
    name: 'Pelt & Peel',
    category: 'UV Editor',
    tags: ['peel', 'pelt', 'cylinder', 'seam', 'scroll', 'unroll'],
    description: 'Pelt-unwraps cylindrical and organic shapes by pinning the outer perimeter and pulling outward like stretching a pelt.',
    hotkeys: { blender: 'Follow Active Quads', maya: 'Pelt Mapping', c4d: 'Pelt Mapping', max: 'Pelt Map' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="uv-peel-scroll" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="70%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#b45309"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Unrolling 3D Cylinder / Pelt Scroll -->
  <path d="M28 34 C28 34 46 22 64 22 C82 22 100 34 100 34 V82 C100 82 82 70 64 70 C46 70 28 82 28 82 Z" fill="#2d323f" stroke="#4b5563" stroke-width="2"/>
  
  <!-- Outer Peeling Flap (Amber Pelt) -->
  <path d="M28 82 C28 82 46 70 64 70 C82 70 100 82 100 82 C100 98 82 106 64 106 C46 106 28 98 28 82 Z" fill="url(#uv-peel-scroll)" stroke="#fef08a" stroke-width="2"/>

  <!-- Radial Pelt Pull Springs / Pullers -->
  <g stroke="#38bdf8" stroke-width="2" stroke-linecap="round">
    <line x1="20" y1="58" x2="10" y2="58"/>
    <line x1="108" y1="58" x2="118" y2="58"/>
    <circle cx="10" cy="58" r="2.5" fill="#38bdf8"/>
    <circle cx="118" cy="58" r="2.5" fill="#38bdf8"/>
    <circle cx="28" cy="58" r="2.5" fill="#f8fafc"/>
    <circle cx="100" cy="58" r="2.5" fill="#f8fafc"/>
  </g>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M5 8c0-3 3-5 7-5s7 2 7 5v8c0 3-3 5-7 5s-7-2-7-5z"/>
  <path d="M5 8c0 3 3 5 7 5s7-2 7-5"/>
  <path d="M2 12h3M19 12h3"/>
</svg>`
  }
];
