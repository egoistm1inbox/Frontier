/**
 * Modelling Icons Set (18 Icons)
 * Visual Style: 3D Claymorphic DCC Mesh & Topology Tools
 * Depicting polygon manipulation, subdivision, booleans, retopology, and sculpting
 */

export const modellingIcons = [
  {
    id: 'model-extrude',
    name: 'Extrude Region',
    category: 'Modelling',
    tags: ['extrude', 'pull', 'face', 'polygon', 'geometry', 'region'],
    description: 'Pulls a selected polygon face outward along its normal vector to generate new connected 3D geometry.',
    hotkeys: { blender: 'E', maya: 'Ctrl+E', c4d: 'D', max: 'Shift+E' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="mod-ext-top" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="60%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#b45309"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Base Mesh Polygon Plate (Dark Slate) -->
  <polygon points="64,68 104,88 64,108 24,88" fill="#1e222a" stroke="#4b5563" stroke-width="2"/>
  <polygon points="24,88 64,108 64,116 24,96" fill="#14161d"/>
  <polygon points="64,108 104,88 104,96 64,116" fill="#0f1115"/>

  <!-- Extruded Column Prism Body -->
  <!-- Left Wall -->
  <polygon points="24,88 64,108 64,64 24,44" fill="#2d323f" stroke="#4b5563" stroke-width="1.8"/>
  <!-- Right Wall -->
  <polygon points="64,108 104,88 104,44 64,64" fill="#232732" stroke="#4b5563" stroke-width="1.8"/>

  <!-- Extruded Active Top Face (Luminous Amber Clay) -->
  <polygon points="64,24 104,44 64,64 24,44" fill="url(#mod-ext-top)" stroke="#fef08a" stroke-width="2.5"/>

  <!-- Upward Extrusion Handle Arrow (Cyan Gizmo) -->
  <g stroke="#38bdf8" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="64" y1="44" x2="64" y2="12"/>
    <path d="M58 20 L64 10 L70 20"/>
  </g>
  <circle cx="64" cy="44" r="3.5" fill="#ffffff"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 2l7 3.5v5L12 14l-7-3.5v-5z"/>
  <path d="M5 10.5v6l7 3.5 7-3.5v-6"/>
  <path d="M12 14v6"/>
  <path d="M12 8V2m-2 3l2-3 2 3"/>
</svg>`
  },
  {
    id: 'model-inset',
    name: 'Inset Faces',
    category: 'Modelling',
    tags: ['inset', 'offset', 'polygon', 'face', 'border', 'bevel'],
    description: 'Offsets selected face boundaries inward, creating a concentric inner polygon surrounded by quad border loops.',
    hotkeys: { blender: 'I', maya: 'Extrude (Offset)', c4d: 'I', max: 'Inset (Ctrl+Shift+I)' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="mod-ins-core" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="70%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#b45309"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Outer 3D Polygon Face (Slate) -->
  <polygon points="64,22 106,44 64,106 22,84" fill="#2d323f" stroke="#4b5563" stroke-width="2.5"/>

  <!-- Perimeter Quad Ribs Connecting Inner and Outer -->
  <line x1="22" y1="84" x2="42" y2="76" stroke="#4b5563" stroke-width="1.8"/>
  <line x1="64" y1="22" x2="64" y2="40" stroke="#4b5563" stroke-width="1.8"/>
  <line x1="106" y1="44" x2="88" y2="52" stroke="#4b5563" stroke-width="1.8"/>
  <line x1="64" y1="106" x2="64" y2="88" stroke="#4b5563" stroke-width="1.8"/>

  <!-- Inset Face (Golden Concentric Polygon) -->
  <polygon points="64,40 88,52 64,88 42,76" fill="url(#mod-ins-core)" stroke="#fef08a" stroke-width="2.5"/>

  <!-- Inward Offset Convergence Arrows -->
  <g stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M30 80 L38 76 M33 75 L38 76 L36 81"/>
    <path d="M64 28 L64 36 M60 32 L64 36 L68 32"/>
    <path d="M98 48 L90 52 M94 48 L90 52 L95 54"/>
  </g>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="2"/>
  <rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" fill-opacity="0.3"/>
  <line x1="3" y1="3" x2="7" y2="7"/>
  <line x1="21" y1="3" x2="17" y2="7"/>
  <line x1="21" y1="21" x2="17" y2="17"/>
  <line x1="3" y1="21" x2="7" y2="17"/>
</svg>`
  },
  {
    id: 'model-bevel',
    name: 'Bevel / Chamfer',
    category: 'Modelling',
    tags: ['bevel', 'chamfer', 'fillet', 'round', 'smooth', 'edge'],
    description: 'Rounds sharp hard polygonal edges into smooth multi-segmented fillets with specular highlights.',
    hotkeys: { blender: 'Ctrl+B', maya: 'Ctrl+B', c4d: 'B', max: 'Chamfer (Ctrl+Shift+C)' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="mod-bev-fillet" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="50%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#b45309"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- 3D Block Corner Geometry (Charcoal) -->
  <polygon points="20,54 54,34 54,94 20,114" fill="#2d323f" stroke="#4b5563" stroke-width="2"/>
  <polygon points="54,94 108,64 108,18 54,34" fill="#1e222a" stroke="#4b5563" stroke-width="2"/>

  <!-- Rounded Bevel / Chamfer Ribs (Amber Fillet Strip) -->
  <polygon points="54,34 70,26 70,86 54,94" fill="url(#mod-bev-fillet)" stroke="#fef08a" stroke-width="2"/>
  
  <!-- Sub-segment lines along fillet curve -->
  <line x1="59" y1="31" x2="59" y2="91" stroke="#ffffff" stroke-width="1.5" opacity="0.6"/>
  <line x1="65" y1="28" x2="65" y2="88" stroke="#ffffff" stroke-width="1.2" opacity="0.4"/>

  <!-- Original Sharp Corner Phantom Dashed Lines -->
  <path d="M54 34 L78 20 L70 86" stroke="#94a3b8" stroke-width="1.8" stroke-dasharray="3 3"/>
  <circle cx="78" cy="20" r="3" fill="#ef4444"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 20V8a4 4 0 0 1 4-4h12v16z"/>
  <path d="M4 8l5-4"/>
  <line x1="9" y1="4" x2="9" y2="20" stroke-dasharray="2 2"/>
</svg>`
  },
  {
    id: 'model-loop-cut',
    name: 'Loop Cut & Slide',
    category: 'Modelling',
    tags: ['loop cut', 'slide', 'slice', 'edge loop', 'subdivision', 'ring'],
    description: 'Inserts continuous edge loop rings around polygonal cylindrical and quad mesh topology.',
    hotkeys: { blender: 'Ctrl+R', maya: 'Insert Edge Loop', c4d: 'K > L', max: 'SwiftLoop' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- 3D Cylinder / Column Mesh Body (Slate) -->
  <path d="M30 40 C30 26 98 26 98 40 V88 C98 102 30 102 30 88 Z" fill="#2d323f" stroke="#4b5563" stroke-width="2.5"/>
  <ellipse cx="64" cy="40" rx="34" ry="14" fill="#3b4252" stroke="#64748b" stroke-width="1.8"/>

  <!-- Loop Cut Ring (Glowing Amber Laser Ring) -->
  <ellipse cx="64" cy="64" rx="34" ry="14" fill="none" stroke="#f59e0b" stroke-width="4.5"/>
  <ellipse cx="64" cy="64" rx="34" ry="14" fill="none" stroke="#fef08a" stroke-width="2" stroke-dasharray="6 3"/>

  <!-- Slide Bidirectional Vectors (Cyan) -->
  <g stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M108 52 V76 M104 56 L108 52 L112 56 M104 72 L108 76 L112 72"/>
  </g>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="4" y="3" width="16" height="18" rx="2"/>
  <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="2.5"/>
  <path d="M22 9v6m-2-4l2-2 2 2m-2 4l-2-2 2-2"/>
</svg>`
  },
  {
    id: 'model-knife',
    name: 'Knife / Topology Cut',
    category: 'Modelling',
    tags: ['knife', 'cut', 'slice', 'retopology', 'polygon', 'blade'],
    description: 'Slices freehand across polygonal surfaces and edges, generating clean custom vertex splits.',
    hotkeys: { blender: 'K', maya: 'Multi-Cut Tool', c4d: 'K > K', max: 'Cut Tool (Alt+C)' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="mod-knf-blade" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="45%" stop-color="#cbd5e1"/>
      <stop offset="100%" stop-color="#64748b"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Mesh Surface Being Cut -->
  <polygon points="18,80 64,106 110,80 64,54" fill="#20242e" stroke="#3b4252" stroke-width="2.5"/>

  <!-- Fresh Cut Slice Line with Vertex Knots -->
  <path d="M26 84 L64 78 L98 84" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/>
  <circle cx="26" cy="84" r="3.5" fill="#fde047"/>
  <circle cx="64" cy="78" r="4" fill="#ffffff" stroke="#f59e0b" stroke-width="1.5"/>
  <circle cx="98" cy="84" r="3.5" fill="#fde047"/>

  <!-- 3D Craft Scalpel Blade (Referencing studio camera hardware style) -->
  <g transform="translate(64, 24) rotate(32)">
    <!-- Handle -->
    <rect x="-8" y="0" width="16" height="46" rx="6" fill="#f59e0b" stroke="#fef08a" stroke-width="1.5"/>
    <circle cx="0" cy="14" r="2.5" fill="#78350f"/>
    <!-- Blade Shank -->
    <rect x="-6" y="44" width="12" height="12" rx="2" fill="#334155"/>
    <!-- Scalpel Razor Blade -->
    <polygon points="-5,54 5,54 4,80 -5,68" fill="url(#mod-knf-blade)" stroke="#e2e8f0" stroke-width="1.2"/>
  </g>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 21l8-8M3 21l4-1-3-3-1 4z"/>
  <path d="M11 13l7-7 3 3-7 7-3-3z"/>
  <line x1="5" y1="19" x2="19" y2="5" stroke-dasharray="2 2"/>
</svg>`
  },
  {
    id: 'model-bridge',
    name: 'Bridge Edge Loops',
    category: 'Modelling',
    tags: ['bridge', 'loft', 'join', 'quads', 'connect', 'tunnel'],
    description: 'Creates a bridge of quad polygons between two separated, opposing edge loops or mesh holes.',
    hotkeys: { blender: 'Edge > Bridge Edge Loops', maya: 'Bridge', c4d: 'Bridge Tool', max: 'Bridge' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="mod-brg-loft" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="60%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#b45309"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Left Open Loop Ring (Cyan Rim) -->
  <ellipse cx="32" cy="64" rx="10" ry="24" fill="#2d323f" stroke="#38bdf8" stroke-width="3"/>
  
  <!-- Right Open Loop Ring (Cyan Rim) -->
  <ellipse cx="96" cy="64" rx="10" ry="24" fill="#2d323f" stroke="#38bdf8" stroke-width="3"/>

  <!-- Bridged Quad Loft Surface (Luminous Amber Clay Tunnel) -->
  <path d="M32 40 C54 48 74 48 96 40 V88 C74 80 54 80 32 88 Z" fill="url(#mod-brg-loft)" stroke="#fef08a" stroke-width="2"/>

  <!-- Connecting Quad Rib Lines -->
  <line x1="52" y1="44" x2="52" y2="84" stroke="#ffffff" stroke-width="1.8" opacity="0.7"/>
  <line x1="74" y1="44" x2="74" y2="84" stroke="#ffffff" stroke-width="1.8" opacity="0.7"/>
  <line x1="32" y1="64" x2="96" y2="64" stroke="#ffffff" stroke-width="1.8" stroke-dasharray="3 3" opacity="0.8"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <ellipse cx="5" cy="12" rx="2" ry="7"/>
  <ellipse cx="19" cy="12" rx="2" ry="7"/>
  <path d="M5 5h14M5 19h14M5 12h14"/>
  <line x1="10" y1="5" x2="10" y2="19"/>
  <line x1="14" y1="5" x2="14" y2="19"/>
</svg>`
  },
  {
    id: 'model-boolean-union',
    name: 'Boolean Union',
    category: 'Modelling',
    tags: ['boolean', 'union', 'merge', 'fuse', 'csg', 'solid'],
    description: 'Fuses two intersecting solid meshes into a seamless, manifold solid geometry envelope.',
    hotkeys: { blender: 'Ctrl+Shift+Num+', maya: 'Mesh > Booleans > Union', c4d: 'Boole (A union B)', max: 'ProBoolean (Union)' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="mod-bu-grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="60%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#b45309"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Left Cube -->
  <rect x="24" y="38" width="52" height="52" rx="10" fill="#2d323f" stroke="#4b5563" stroke-width="2.5"/>

  <!-- Right Fused Sphere/Block (Unified Hull) -->
  <circle cx="82" cy="64" r="30" fill="url(#mod-bu-grad)" stroke="#fef08a" stroke-width="2.5"/>

  <!-- Seamless Weld Seam Line -->
  <path d="M68 40 C62 52 62 76 68 88" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>
  <circle cx="68" cy="40" r="3" fill="#ffffff"/>
  <circle cx="68" cy="88" r="3" fill="#ffffff"/>

  <!-- Union Symbol Badge (+) -->
  <rect x="54" y="54" width="20" height="20" rx="5" fill="#14161b" stroke="#ffffff" stroke-width="1.5"/>
  <path d="M64 58 V70 M58 64 H70" stroke="#fef08a" stroke-width="2.5" stroke-linecap="round"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="12" height="12" rx="2"/>
  <circle cx="15" cy="15" r="6"/>
  <path d="M12 9h3v6h-3"/>
</svg>`
  },
  {
    id: 'model-boolean-diff',
    name: 'Boolean Difference',
    category: 'Modelling',
    tags: ['boolean', 'difference', 'subtract', 'carve', 'hole', 'csg'],
    description: 'Subtracts a cutter volume from a target mesh, carving holes and hollow chambers.',
    hotkeys: { blender: 'Ctrl+Shift+Num-', maya: 'Mesh > Booleans > Difference', c4d: 'Boole (A subtract B)', max: 'ProBoolean (Subtract)' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Base Solid Block (Slate) -->
  <rect x="22" y="24" width="84" height="80" rx="14" fill="#2d323f" stroke="#4b5563" stroke-width="2.5"/>

  <!-- Carved Cylindrical Void Hole (Charcoal Core with Amber Rim) -->
  <ellipse cx="64" cy="64" rx="24" ry="24" fill="#14161b" stroke="#f59e0b" stroke-width="3.5"/>
  <!-- Inner depth shadow -->
  <path d="M42 56 C46 44 82 44 86 56" stroke="#fef08a" stroke-width="2" fill="none"/>

  <!-- Negative Subtraction Indicator (-) -->
  <rect x="52" y="58" width="24" height="12" rx="4" fill="#ef4444" stroke="#ffffff" stroke-width="1.2"/>
  <line x1="56" y1="64" x2="72" y2="64" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="2"/>
  <circle cx="12" cy="12" r="5" fill="none"/>
  <line x1="9" y1="12" x2="15" y2="12" stroke-width="2.5"/>
</svg>`
  },
  {
    id: 'model-boolean-intersect',
    name: 'Boolean Intersect',
    category: 'Modelling',
    tags: ['boolean', 'intersect', 'shared', 'csg', 'overlap', 'volume'],
    description: 'Preserves only the intersecting volume shared between two overlapping meshes, discarding non-overlapping geometry.',
    hotkeys: { blender: 'Ctrl+Shift+Num*', maya: 'Mesh > Booleans > Intersection', c4d: 'Boole (A intersect B)', max: 'ProBoolean (Intersect)' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="mod-bi-amber" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="70%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#b45309"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Left Wireframe Shape -->
  <circle cx="50" cy="64" r="32" fill="none" stroke="#64748b" stroke-width="2" stroke-dasharray="3 3"/>
  <!-- Right Wireframe Shape -->
  <circle cx="78" cy="64" r="32" fill="none" stroke="#64748b" stroke-width="2" stroke-dasharray="3 3"/>

  <!-- Shared Intersecting Lens (Luminous Amber Clay) -->
  <path d="M64 36 C74 44 78 54 78 64 C78 74 74 84 64 92 C54 84 50 74 50 64 C50 54 54 44 64 36 Z" fill="url(#mod-bi-amber)" stroke="#fef08a" stroke-width="2.5"/>

  <!-- Intersection Center Dot -->
  <circle cx="64" cy="64" r="4.5" fill="#ffffff" stroke="#d97706" stroke-width="1.8"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="9" cy="12" r="6" stroke-dasharray="2 2"/>
  <circle cx="15" cy="12" r="6" stroke-dasharray="2 2"/>
  <path d="M12 7c1.5 1.5 2 3.5 2 5s-.5 3.5-2 5c-1.5-1.5-2-3.5-2-5s.5-3.5 2-5z" fill="currentColor" fill-opacity="0.3"/>
</svg>`
  },
  {
    id: 'model-subdivide',
    name: 'Subdivide Surface',
    category: 'Modelling',
    tags: ['subdivide', 'catmull-clark', 'smooth', 'mesh', 'resolution', 'topology'],
    description: 'Applies Catmull-Clark recursive subdivision to split polygons into smooth, curvature-continuous sub-quads.',
    hotkeys: { blender: 'Ctrl+1 / 2 / 3', maya: '3 (Smooth Mesh)', c4d: 'Subdivision Surface', max: 'TurboSmooth' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Outer Coarse Control Cage (Dashed Cyan Wireframe) -->
  <polygon points="64,18 112,46 64,104 16,76" fill="none" stroke="#38bdf8" stroke-width="2" stroke-dasharray="4 3"/>

  <!-- Subdivided Smooth Organic Quad (Amber Clay Body) -->
  <path d="M64 26 C88 34 102 48 102 52 C102 68 84 88 64 94 C44 88 26 76 26 70 C26 56 40 34 64 26 Z" fill="#2d323f" stroke="#f59e0b" stroke-width="2.5"/>

  <!-- Subdivided Internal Quad Flow Lines -->
  <path d="M64 26 C64 54 64 74 64 94" stroke="#fef08a" stroke-width="2"/>
  <path d="M26 70 C52 64 78 58 102 52" stroke="#fef08a" stroke-width="2"/>

  <!-- Control Cage Corner Vertices -->
  <circle cx="64" cy="18" r="3.5" fill="#38bdf8"/>
  <circle cx="112" cy="46" r="3.5" fill="#38bdf8"/>
  <circle cx="64" cy="104" r="3.5" fill="#38bdf8"/>
  <circle cx="16" cy="76" r="3.5" fill="#38bdf8"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="4"/>
  <line x1="3" y1="12" x2="21" y2="12"/>
  <line x1="12" y1="3" x2="12" y2="21"/>
  <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
</svg>`
  },
  {
    id: 'model-merge',
    name: 'Merge / Weld Vertices',
    category: 'Modelling',
    tags: ['merge', 'weld', 'collapse', 'snap', 'vertex', 'topology'],
    description: 'Welds adjacent or overlapping vertices together into a unified single coordinate point.',
    hotkeys: { blender: 'M', maya: 'Merge Components', c4d: 'Optimize / Weld', max: 'Weld (Ctrl+Shift+W)' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Converging Mesh Edges (Cyan Wire) -->
  <line x1="22" y1="38" x2="64" y2="64" stroke="#4b5563" stroke-width="3"/>
  <line x1="22" y1="90" x2="64" y2="64" stroke="#4b5563" stroke-width="3"/>
  <line x1="106" y1="38" x2="64" y2="64" stroke="#4b5563" stroke-width="3"/>
  <line x1="106" y1="90" x2="64" y2="64" stroke="#4b5563" stroke-width="3"/>

  <!-- Converging Magnetic Arrows -->
  <g stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M40 48 L54 58 M48 57 L54 58 L52 52"/>
    <path d="M88 48 L74 58 M76 52 L74 58 L80 57"/>
  </g>

  <!-- Welded Unified Golden Vertex Bead with Spark Ring -->
  <circle cx="64" cy="64" r="14" fill="#f59e0b" fill-opacity="0.25" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="3 2"/>
  <circle cx="64" cy="64" r="8" fill="#f59e0b" stroke="#ffffff" stroke-width="2.5"/>

  <!-- Magnetic Snap Spark Sparks -->
  <circle cx="64" cy="46" r="2" fill="#fef08a"/>
  <circle cx="64" cy="82" r="2" fill="#fef08a"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="3"/>
  <path d="M4 4l6 6M20 4l-6 6M4 20l6-6M20 20l-6-6"/>
</svg>`
  },
  {
    id: 'model-symmetrize',
    name: 'Mirror / Symmetrize',
    category: 'Modelling',
    tags: ['mirror', 'symmetry', 'bisect', 'flip', 'x-axis', 'character'],
    description: 'Mirrors polygonal geometry across an axis plane, ensuring exact bilateral symmetry for character modeling.',
    hotkeys: { blender: 'Mesh > Symmetrize', maya: 'Mesh > Mirror', c4d: 'Symmetry Object', max: 'Symmetry Modifier' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Central Mirror Plane (Glassy Cyan Plane) -->
  <polygon points="64,16 64,112 64,112 64,16" stroke="#38bdf8" stroke-width="3"/>
  <polygon points="60,20 68,16 68,108 60,112" fill="#38bdf8" fill-opacity="0.3"/>

  <!-- Left Source Mesh (Solid Amber) -->
  <path d="M22 40 H56 V88 H22 Z" fill="#f59e0b" stroke="#fef08a" stroke-width="2"/>
  <circle cx="34" cy="54" r="4" fill="#ffffff"/>

  <!-- Right Mirrored Symmetrical Mesh (Slate Body) -->
  <path d="M72 40 H106 V88 H72 Z" fill="#2d323f" stroke="#4b5563" stroke-width="2"/>
  <circle cx="94" cy="54" r="4" fill="#64748b"/>

  <!-- Bidirectional Symmetry Sync Arrows -->
  <g stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M46 64 H82 M52 59 L46 64 L52 69 M76 59 L82 64 L76 69"/>
  </g>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <line x1="12" y1="2" x2="12" y2="22" stroke-dasharray="2 2"/>
  <path d="M8 6H4v12h4z" fill="currentColor" fill-opacity="0.25"/>
  <path d="M16 6h4v12h-4z"/>
</svg>`
  },
  {
    id: 'model-spin',
    name: 'Spin / Lathe Revolve',
    category: 'Modelling',
    tags: ['spin', 'lathe', 'revolve', 'rotational', 'screw', 'chalice'],
    description: 'Revolves a 2D profile curve around a 3D rotational axis to generate radially symmetrical vessels and mechanical parts.',
    hotkeys: { blender: 'Spin Tool', maya: 'Revolve', c4d: 'Lathe Generator', max: 'Lathe Modifier' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Central Rotation Axis Rod -->
  <line x1="64" y1="16" x2="64" y2="108" stroke="#64748b" stroke-width="2" stroke-dasharray="4 3"/>

  <!-- Revolving Lathed Chalice/Vessel Body (Amber Clay) -->
  <!-- Top Rim -->
  <ellipse cx="64" cy="34" rx="36" ry="10" fill="#f59e0b" stroke="#fef08a" stroke-width="2"/>
  <!-- Chalice Bowl -->
  <path d="M28 34 C28 66 52 74 52 86 H76 C76 74 100 66 100 34 Z" fill="#2d323f" stroke="#4b5563" stroke-width="2"/>
  <!-- Base Stand -->
  <ellipse cx="64" cy="98" rx="26" ry="8" fill="#f59e0b" stroke="#fef08a" stroke-width="2"/>

  <!-- Revolving Spin Arrows (Cyan Orbital Arc) -->
  <path d="M24 64 C24 82 104 82 104 64" stroke="#38bdf8" stroke-width="2.5" fill="none"/>
  <polygon points="104,64 98,56 106,56" fill="#38bdf8"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <line x1="12" y1="2" x2="12" y2="22" stroke-dasharray="2 2"/>
  <path d="M12 5c4 0 6 3 6 7s-3 6-6 6"/>
  <path d="M6 12a6 6 0 0 1 6-6"/>
  <path d="M16 3l2 2-2 2"/>
</svg>`
  },
  {
    id: 'model-polybuild',
    name: 'PolyBuild / Retopology Pen',
    category: 'Modelling',
    tags: ['polybuild', 'retopology', 'quad draw', 'strip', 'pen', 'retopo'],
    description: 'Interactively plants quad polygons directly onto high-density sculpt reference geometry for clean animation topology.',
    hotkeys: { blender: 'Poly Build Tool', maya: 'Quad Draw', c4d: 'Poly Pen', max: 'Step Build' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- High-Density Sculpt Surface (Curved Slate Mesh) -->
  <path d="M18 84 C38 64 90 64 110 84 V106 H18 Z" fill="#1e222a" stroke="#3b4252" stroke-width="2"/>

  <!-- Drawn Quad Polygon Strip (Luminous Amber Quads) -->
  <polygon points="26,76 52,66 48,88 22,96" fill="#f59e0b" stroke="#fef08a" stroke-width="2"/>
  <polygon points="52,66 82,64 78,86 48,88" fill="#f59e0b" stroke="#fef08a" stroke-width="2"/>

  <!-- In-progress Retopo Pen Cursor Drawing Next Vertex -->
  <circle cx="82" cy="64" r="4.5" fill="#ffffff" stroke="#0284c7" stroke-width="2"/>
  
  <!-- Stylus Retopo Pen Tool -->
  <g transform="translate(86, 22) rotate(35)">
    <rect x="-6" y="0" width="12" height="48" rx="5" fill="#3b4252" stroke="#64748b" stroke-width="1.2"/>
    <polygon points="-4,48 4,48 0,64" fill="#38bdf8"/>
    <circle cx="0" cy="64" r="1.5" fill="#ffffff"/>
  </g>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 17l6-3 6 1 6-4"/>
  <path d="M3 17l4 4 6-2 8-5"/>
  <path d="M9 14l4 4"/>
  <path d="M18 4l3 3-9 9-4 1 1-4 9-9z"/>
</svg>`
  },
  {
    id: 'model-sculpt-clay',
    name: 'Sculpt Clay Strips',
    category: 'Modelling',
    tags: ['sculpt', 'clay', 'strips', 'buildup', 'brush', 'organic'],
    description: 'Deposits thick, tactile rectangular clay strips onto organic mesh forms to build anatomy and massing quickly.',
    hotkeys: { blender: 'Clay Strips (C)', maya: 'Sculpt Tool', c4d: 'Clay Brush', zbrush: 'Clay Buildup (BCB)' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Curved Sculpt Base Dome -->
  <ellipse cx="64" cy="74" rx="46" ry="24" fill="#2d323f" stroke="#4b5563" stroke-width="2.5"/>

  <!-- Tactile Layered Clay Ribbon Strips (Warm Amber Clay) -->
  <!-- Strip 1 (Lower) -->
  <path d="M34 68 C48 60 76 60 92 68 L88 78 C74 72 48 72 34 78 Z" fill="#d97706" stroke="#b45309" stroke-width="1.5"/>
  <!-- Strip 2 (Upper Overlap) -->
  <path d="M38 56 C52 48 78 48 94 56 L90 66 C76 60 50 60 38 66 Z" fill="#f59e0b" stroke="#fef08a" stroke-width="2"/>

  <!-- Sculpt Spatula Brush Head -->
  <g transform="translate(74, 22) rotate(20)">
    <rect x="-8" y="0" width="16" height="34" rx="4" fill="#475569" stroke="#94a3b8" stroke-width="1.5"/>
    <!-- Blade tip -->
    <polygon points="-8,34 8,34 6,44 -6,44" fill="#f8fafc"/>
  </g>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <ellipse cx="12" cy="14" rx="9" ry="5"/>
  <path d="M6 12c3-2 9-2 12 0"/>
  <path d="M7 9c3-2 7-2 10 0"/>
  <path d="M15 3l4 4-5 5-4-4 5-5z"/>
</svg>`
  },
  {
    id: 'model-sculpt-grab',
    name: 'Sculpt Grab / Move',
    category: 'Modelling',
    tags: ['sculpt', 'grab', 'move', 'elastic', 'brush', 'form'],
    description: 'Grabs and elastically pulls surface vertices within brush radius to silhouette and reshape forms smoothly.',
    hotkeys: { blender: 'Grab (G)', maya: 'Grab Brush', c4d: 'Grab Tool', zbrush: 'Move (BMV)' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Elastically Pulled Mesh Dome (Slate) -->
  <path d="M22 92 C26 72 44 46 64 30 C84 46 102 72 106 92 Z" fill="#2d323f" stroke="#4b5563" stroke-width="2.5"/>

  <!-- Pulled Peak (Amber Clay Highlight) -->
  <ellipse cx="64" cy="32" rx="14" ry="8" fill="#f59e0b" stroke="#fef08a" stroke-width="2"/>

  <!-- Sculpting Brush Radius Ring (Cyan Ring) -->
  <ellipse cx="64" cy="32" rx="26" ry="16" fill="none" stroke="#38bdf8" stroke-width="2" stroke-dasharray="4 3"/>

  <!-- Upward Pull Vectors -->
  <g stroke="#38bdf8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M64 26 V10 M59 16 L64 10 L69 16"/>
  </g>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 19c2-5 5-11 8-15 3 4 6 10 8 15"/>
  <circle cx="12" cy="4" r="2.5"/>
  <path d="M12 1v3m-2-2l2-2 2 2"/>
</svg>`
  },
  {
    id: 'model-smooth',
    name: 'Smooth / Relax Mesh',
    category: 'Modelling',
    tags: ['smooth', 'relax', 'iron', 'laplacian', 'noise', 'mesh'],
    description: 'Evenly distributes vertex spacing across bumpy or faceted topology, producing relaxed, silky-smooth surfaces.',
    hotkeys: { blender: 'Smooth (Shift+LeftClick)', maya: 'Smooth Tool', c4d: 'Smooth Brush', zbrush: 'Smooth (Shift)' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Wrinkled, Jagged Edge (Before - Slate) -->
  <path d="M24 40 L38 28 L50 44 L66 26 L82 42 L96 30 L104 40" stroke="#64748b" stroke-width="2.5" stroke-dasharray="3 3"/>

  <!-- Ironed / Smoothed Surface (Silky Amber Curve) -->
  <path d="M22 72 C42 56 86 56 106 72 V92 C86 76 42 76 22 92 Z" fill="#2d323f" stroke="#f59e0b" stroke-width="2.5"/>

  <!-- Smoothing Iron Pad / Relax Stamp -->
  <ellipse cx="64" cy="52" rx="22" ry="8" fill="#f59e0b" stroke="#fef08a" stroke-width="2"/>

  <!-- Downward Relaxation Arrows (Cyan) -->
  <g stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M48 38 V48 M45 44 L48 48 L51 44"/>
    <path d="M64 34 V44 M61 40 L64 44 L67 40"/>
    <path d="M80 38 V48 M77 44 L80 48 L83 44"/>
  </g>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 8l3-3 4 4 4-4 4 4 3-3" stroke-dasharray="2 2"/>
  <path d="M3 16c4-3 14-3 18 0" stroke-width="2.5"/>
  <path d="M12 9v4m-2-2l2 2 2-2"/>
</svg>`
  },
  {
    id: 'model-dissolve',
    name: 'Dissolve Geometry',
    category: 'Modelling',
    tags: ['dissolve', 'delete', 'clean', 'n-gon', 'edge loop', 'topology'],
    description: 'Removes edges or vertices while merging surrounding faces into clean continuous geometry without tearing holes.',
    hotkeys: { blender: 'X > Dissolve Edges', maya: 'Ctrl+Delete', c4d: 'M > N (Dissolve)', max: 'Remove (Backspace)' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Retained Clean Quad Polygon Face (Slate) -->
  <rect x="22" y="24" width="84" height="80" rx="12" fill="#2d323f" stroke="#4b5563" stroke-width="2.5"/>

  <!-- Dissolving Edge Loop (Fading Amber/Red Dashes) -->
  <line x1="22" y1="64" x2="106" y2="64" stroke="#f59e0b" stroke-width="3.5" stroke-dasharray="5 5" opacity="0.4"/>

  <!-- Dissolution Vapor Specks (Disappearing Particles) -->
  <circle cx="44" cy="64" r="2.5" fill="#fef08a"/>
  <circle cx="64" cy="60" r="3" fill="#fbbf24"/>
  <circle cx="84" cy="68" r="2.5" fill="#fef08a"/>
  <circle cx="64" cy="68" r="2" fill="#f8fafc"/>

  <!-- Safe Dissolve Clean Shield Badge -->
  <circle cx="64" cy="64" r="12" fill="#14161b" stroke="#10b981" stroke-width="2"/>
  <path d="M60 64 L63 67 L68 61" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="2"/>
  <line x1="3" y1="12" x2="21" y2="12" stroke-dasharray="3 3"/>
  <circle cx="12" cy="12" r="2" fill="currentColor"/>
</svg>`
  }
];
