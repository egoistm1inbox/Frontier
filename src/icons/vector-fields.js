/**
 * Vector Fields Icon Set (14 Icons)
 * Visual Style: 3D Claymorphic Computational DCC Elements
 * Featuring 3D vector lattices, velocity arrows, mathematical differential operators, and volume data
 */

export const vectorFieldIcons = [
  {
    id: 'vf-grid-3d',
    name: '3D Vector Flow Grid',
    category: 'Vector Fields',
    tags: ['grid', 'lattice', 'volume', 'velocity', 'vectors', 'flow'],
    description: 'A 3-dimensional structured grid container holding discrete directional velocity vectors at each voxel coordinate.',
    hotkeys: { blender: 'Simulation Nodes > Sample Vector Grid', unreal: 'Vector Field Volume', houdini: 'Volume VOP / VDB', unity: 'VFX Graph Vector Field' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="vf-grid-box" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3b4252"/>
      <stop offset="100%" stop-color="#181a20"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Isometric 3D Bounding Cage -->
  <!-- Top Face -->
  <polygon points="64,22 104,44 64,66 24,44" fill="#2d323f" stroke="#64748b" stroke-width="1.8"/>
  <!-- Left Face -->
  <polygon points="24,44 64,66 64,106 24,84" fill="#1e222a" stroke="#4b5563" stroke-width="1.8"/>
  <!-- Right Face -->
  <polygon points="64,66 104,44 104,84 64,106" fill="#171920" stroke="#4b5563" stroke-width="1.8"/>

  <!-- Interior Vector Grid Matrix (Array of Directional Flow Arrows) -->
  <!-- Layer 1 -->
  <g stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <!-- Arrow 1 -->
    <path d="M44 48 L56 42 M52 38 L56 42 L51 44"/>
    <!-- Arrow 2 -->
    <path d="M64 56 L78 50 M74 46 L78 50 L73 52"/>
    <!-- Arrow 3 -->
    <path d="M84 40 L96 34 M92 30 L96 34 L91 36"/>
  </g>

  <!-- Layer 2 (Cyan Vectors) -->
  <g stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <!-- Arrow 4 -->
    <path d="M40 70 L54 62 M50 58 L54 62 L48 64"/>
    <!-- Arrow 5 (Center Highlight) -->
    <path d="M60 78 L76 70 M72 66 L76 70 L70 72"/>
    <!-- Arrow 6 -->
    <path d="M82 62 L96 54 M92 50 L96 54 L90 56"/>
  </g>

  <!-- Layer 3 (Lower Vectors) -->
  <g stroke="#fde047" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M44 88 L58 80 M54 76 L58 80 L52 82"/>
    <path d="M64 96 L80 88 M76 84 L80 88 L74 90"/>
  </g>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 2l8 4v8l-8 4-8-4V6z"/>
  <path d="M12 2v16M4 6l8 4 8-4"/>
  <path d="M8 8l3-1.5m3-1.5l3-1.5M7 13l3-1.5m4-2l3-1.5"/>
</svg>`
  },
  {
    id: 'vf-curl',
    name: 'Curl Field (∇ × F)',
    category: 'Vector Fields',
    tags: ['curl', 'vorticity', 'rotation', 'del', 'circulation', 'math'],
    description: 'Computes the curl operator measuring infinitesimal rotation and local vorticity of a 3D vector velocity field.',
    hotkeys: { blender: 'Simulation Nodes > Vector Curl', unreal: 'Curl Noise 3D', houdini: 'VDB Curl', unity: 'Curl Noise' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="vf-curl-glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="70%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#b45309"/>
    </radialGradient>
  </defs>
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Base Coordinate Ring -->
  <ellipse cx="64" cy="74" rx="42" ry="20" fill="#1c1f26" stroke="#4b5563" stroke-width="2"/>

  <!-- Circulating Rotational Vector Loop (Cyan Curl) -->
  <path d="M26 74 C26 56 102 56 102 74 C102 92 26 92 26 74" fill="none" stroke="#38bdf8" stroke-width="4"/>
  <polygon points="102,74 96,64 106,66" fill="#38bdf8"/>
  <polygon points="26,74 32,84 22,82" fill="#38bdf8"/>

  <!-- Perpendicular Curl Axis Arrow (Right-Hand Rule) -->
  <g stroke="#f59e0b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
    <line x1="64" y1="84" x2="64" y2="24"/>
    <path d="M56 34 L64 22 L72 34"/>
  </g>

  <!-- Math Notation Badge "∇ × F" -->
  <rect x="74" y="24" width="38" height="20" rx="4" fill="#2d323f" stroke="#f59e0b" stroke-width="1.2"/>
  <text x="93" y="38" fill="#fef08a" font-size="10" font-weight="bold" font-family="monospace" text-anchor="middle">∇×F</text>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <ellipse cx="12" cy="14" rx="8" ry="4"/>
  <path d="M12 18V4m-3 3l3-3 3 3"/>
  <path d="M20 14l-2-2m-12 2l2 2"/>
</svg>`
  },
  {
    id: 'vf-divergence',
    name: 'Divergence (∇ · F)',
    category: 'Vector Fields',
    tags: ['divergence', 'source', 'sink', 'flux', 'expansion', 'math'],
    description: 'Measures net outward flux per unit volume: positive divergence acts as a source, negative acts as a sink.',
    hotkeys: { blender: 'Simulation Nodes > Vector Divergence', unreal: 'Divergence Free Solver', houdini: 'VDB Divergence', unity: 'Volume Divergence' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="vf-div-core" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="50%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#0284c7"/>
    </radialGradient>
  </defs>
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Diverging Outward Vector Arrows (Omnidirectional Golden Vectors) -->
  <g stroke="#f59e0b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <!-- North -->
    <path d="M64 50 V26 M59 32 L64 26 L69 32"/>
    <!-- South -->
    <path d="M64 78 V102 M59 96 L64 102 L69 96"/>
    <!-- West -->
    <path d="M50 64 H26 M32 59 L26 64 L32 69"/>
    <!-- East -->
    <path d="M78 64 H102 M96 59 L102 64 L96 69"/>
    <!-- Diagonals -->
    <path d="M54 54 L36 36 M44 36 L36 36 L36 44"/>
    <path d="M74 54 L92 36 M84 36 L92 36 L92 44"/>
    <path d="M54 74 L36 92 M44 92 L36 92 L36 84"/>
    <path d="M74 74 L92 92 M84 92 L92 92 L92 84"/>
  </g>

  <!-- Central Source Core Sphere -->
  <circle cx="64" cy="64" r="14" fill="url(#vf-div-core)" stroke="#f8fafc" stroke-width="2"/>

  <!-- Math Symbol Badge "∇·F" -->
  <rect x="18" y="22" width="34" height="18" rx="4" fill="#2d323f" stroke="#38bdf8" stroke-width="1.2"/>
  <text x="35" y="35" fill="#38bdf8" font-size="10" font-weight="bold" font-family="monospace" text-anchor="middle">∇·F</text>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="3"/>
  <path d="M12 9V3m-2 2l2-2 2 2"/>
  <path d="M12 15v6m-2-2l2 2 2-2"/>
  <path d="M9 12H3m2-2l-2 2 2 2"/>
  <path d="M15 12h6m-2-2l2 2-2 2"/>
</svg>`
  },
  {
    id: 'vf-gradient',
    name: 'Gradient Field (∇f)',
    category: 'Vector Fields',
    tags: ['gradient', 'potential', 'scalar', 'steepest', 'height', 'math'],
    description: 'Generates a vector field pointing in the direction of the greatest rate of increase of a scalar field.',
    hotkeys: { blender: 'Simulation Nodes > Vector Gradient', unreal: 'Distance Field Gradient', houdini: 'Volume Gradient', unity: 'SDF Gradient' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Stepped Elevation Topographic Contour Slices -->
  <!-- Level 1 (Base) -->
  <path d="M20 90 C34 76 94 76 108 90 C108 100 20 100 20 90 Z" fill="#1c1f26" stroke="#3b4252" stroke-width="1.5"/>
  <!-- Level 2 -->
  <path d="M28 72 C40 60 88 60 100 72 C100 82 28 82 28 72 Z" fill="#2d323f" stroke="#4b5563" stroke-width="1.5"/>
  <!-- Level 3 -->
  <path d="M38 52 C48 42 80 42 90 52 C90 62 38 62 38 52 Z" fill="#3b4252" stroke="#64748b" stroke-width="1.5"/>
  <!-- Peak Summit (Amber) -->
  <ellipse cx="64" cy="38" rx="16" ry="8" fill="#f59e0b" stroke="#fef08a" stroke-width="1.8"/>

  <!-- Steepest Ascent Normal Gradient Vectors (Cyan Arrows Pointing Uphill) -->
  <g stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M42 82 L52 64 M46 64 L52 64 L52 70"/>
    <path d="M86 82 L76 64 M82 64 L76 64 L76 70"/>
    <path d="M64 64 L64 44 M59 50 L64 44 L69 50"/>
  </g>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 18c3-3 15-3 18 0"/>
  <path d="M5 13c3-3 11-3 14 0"/>
  <path d="M8 8c2-2 6-2 8 0"/>
  <path d="M12 17V5m-3 3l3-3 3 3"/>
</svg>`
  },
  {
    id: 'vf-streamlines',
    name: 'Velocity Streamlines',
    category: 'Vector Fields',
    tags: ['streamlines', 'velocity', 'particles', 'flow', 'laminar', 'ribbons'],
    description: 'Curves whose tangents match velocity vectors everywhere, illustrating laminar flow pathways and speed gradients.',
    hotkeys: { blender: 'Geometry Nodes > Curve Flow', unreal: 'Niagara Ribbon Flow', houdini: 'Streamlines SOP', unity: 'VFX Streamlines' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="vf-str-grad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#0284c7"/>
      <stop offset="40%" stop-color="#38bdf8"/>
      <stop offset="80%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#fef08a"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Smooth Laminar Flow Streamline Ribbons -->
  <!-- Streamline 1 -->
  <path d="M18 36 C42 36 54 26 82 26 C98 26 106 32 114 40" stroke="url(#vf-str-grad)" stroke-width="3" stroke-linecap="round" fill="none"/>
  
  <!-- Streamline 2 (Main Center Flow) -->
  <path d="M14 64 C42 64 56 52 86 52 C104 52 110 64 118 68" stroke="url(#vf-str-grad)" stroke-width="4.5" stroke-linecap="round" fill="none"/>
  
  <!-- Streamline 3 -->
  <path d="M18 92 C42 92 58 78 86 78 C102 78 108 86 114 90" stroke="url(#vf-str-grad)" stroke-width="3" stroke-linecap="round" fill="none"/>

  <!-- Arrowheads on flow tips -->
  <polygon points="116,40 108,36 110,44" fill="#fef08a"/>
  <polygon points="120,68 112,62 114,72" fill="#fef08a"/>
  <polygon points="116,90 108,86 110,94" fill="#fef08a"/>

  <!-- Speed Velocity Markers (White dots along stream) -->
  <circle cx="34" cy="64" r="3" fill="#bae6fd"/>
  <circle cx="70" cy="54" r="3" fill="#38bdf8"/>
  <circle cx="98" cy="56" r="3" fill="#fde047"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 6c6 0 8-2 13-2s3 2 5 3"/>
  <path d="M2 12c6 0 9-3 14-3s3 3 6 4"/>
  <path d="M3 18c6 0 8-2 13-2s3 2 5 3"/>
</svg>`
  },
  {
    id: 'vf-advection',
    name: 'Particle Advection',
    category: 'Vector Fields',
    tags: ['advection', 'runge-kutta', 'euler', 'particles', 'tracer', 'fluid'],
    description: 'Advects passive particles along vector trajectories using 4th-order Runge-Kutta (RK4) numerical integration.',
    hotkeys: { blender: 'Simulation Nodes > Advect Particles', unreal: 'Advect by Vector Field', houdini: 'POP Advect by Volume', unity: 'RK4 Advection' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Underlying Vector Field Cell Grid -->
  <rect x="22" y="22" width="84" height="84" rx="12" fill="#1c1f26" stroke="#3b4252" stroke-width="2"/>
  <path d="M22 50 H106 M22 78 H106 M50 22 V106 M78 22 V106" stroke="#2d323f" stroke-width="1.5"/>

  <!-- Continuous Advection Curve Path -->
  <path d="M32 90 C36 68 54 62 66 52 C78 42 86 36 96 32" stroke="#64748b" stroke-width="2" stroke-dasharray="3 3"/>

  <!-- Discrete Integration Step Vectors (Amber Arrows) -->
  <g stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="32" y1="90" x2="48" y2="72"/>
    <line x1="48" y1="72" x2="68" y2="52"/>
    <line x1="68" y1="52" x2="94" y2="34"/>
  </g>

  <!-- Stepping Particle Nodes (Cyan/Gold Spheres) -->
  <circle cx="32" cy="90" r="4" fill="#38bdf8"/>
  <circle cx="48" cy="72" r="4.5" fill="#f59e0b"/>
  <circle cx="68" cy="52" r="5" fill="#fde047"/>
  <circle cx="94" cy="34" r="6" fill="#ffffff" stroke="#f59e0b" stroke-width="2"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 20l5-6 6-5 6-4"/>
  <circle cx="4" cy="20" r="1.5"/>
  <circle cx="9" cy="14" r="1.5"/>
  <circle cx="15" cy="9" r="1.5"/>
  <circle cx="21" cy="5" r="2"/>
</svg>`
  },
  {
    id: 'vf-trilinear',
    name: 'Trilinear Voxel Sample',
    category: 'Vector Fields',
    tags: ['trilinear', 'interpolation', 'voxel', 'sample', '3d texture', 'probe'],
    description: 'Samples sub-voxel continuous 3D vector values by trilinearly interpolating the 8 enclosing cell corner vectors.',
    hotkeys: { blender: 'Geometry Nodes > Sample Volume', unreal: 'Trilinear Voxel Sample', houdini: 'Volume Sample Vector', unity: 'Volume Texture Sample' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Voxel Wireframe Box -->
  <!-- Top Face -->
  <polygon points="64,26 96,44 64,62 32,44" fill="#2d323f" fill-opacity="0.4" stroke="#64748b" stroke-width="1.8"/>
  <!-- Front Faces -->
  <polygon points="32,44 64,62 64,98 32,80" fill="#1e222a" fill-opacity="0.5" stroke="#64748b" stroke-width="1.8"/>
  <polygon points="64,62 96,44 96,80 64,98" fill="#171920" fill-opacity="0.5" stroke="#64748b" stroke-width="1.8"/>

  <!-- 8 Voxel Corner Vectors (Small Slate/Cyan Beads) -->
  <circle cx="64" cy="26" r="3.5" fill="#38bdf8"/>
  <circle cx="96" cy="44" r="3.5" fill="#38bdf8"/>
  <circle cx="64" cy="62" r="3.5" fill="#38bdf8"/>
  <circle cx="32" cy="44" r="3.5" fill="#38bdf8"/>
  <circle cx="32" cy="80" r="3.5" fill="#38bdf8"/>
  <circle cx="96" cy="80" r="3.5" fill="#38bdf8"/>
  <circle cx="64" cy="98" r="3.5" fill="#38bdf8"/>

  <!-- Central Interpolated Probe Sample (Golden Target Bead) -->
  <circle cx="64" cy="62" r="8" fill="#f59e0b" stroke="#ffffff" stroke-width="2"/>
  <!-- Trilinear Interpolation Vector coming from probe -->
  <line x1="64" y1="62" x2="78" y2="48" stroke="#fef08a" stroke-width="3" stroke-linecap="round"/>
  <polygon points="82,44 74,46 78,54" fill="#fef08a"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 2l7 4v8l-7 4-7-4V6z"/>
  <path d="M12 2v16M5 6l7 4 7-4"/>
  <circle cx="12" cy="10" r="2" fill="currentColor"/>
</svg>`
  },
  {
    id: 'vf-cross-product',
    name: 'Vector Cross Product',
    category: 'Vector Fields',
    tags: ['cross product', 'orthogonal', 'normal', 'tangent', 'math', 'vectors'],
    description: 'Computes the vector cross product (A × B = C), producing a vector perpendicular to both operand vectors.',
    hotkeys: { blender: 'Vector Math > Cross Product', unreal: 'Vector Cross Product', houdini: 'cross(v1, v2)', unity: 'Vector3.Cross' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Base Coordinate Plane (A and B vectors span this plane) -->
  <polygon points="64,88 108,76 80,60 36,72" fill="#2d323f" stroke="#4b5563" stroke-width="1.5"/>

  <!-- Vector A (Cyan Vector on Plane) -->
  <g stroke="#38bdf8" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="64" y1="88" x2="104" y2="76"/>
    <path d="M96 73 L104 76 L98 81"/>
  </g>
  <text x="106" y="88" fill="#38bdf8" font-size="11" font-weight="bold">A</text>

  <!-- Vector B (Slate Vector on Plane) -->
  <g stroke="#94a3b8" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="64" y1="88" x2="42" y2="74"/>
    <path d="M48 72 L42 74 L46 79"/>
  </g>
  <text x="32" y="74" fill="#94a3b8" font-size="11" font-weight="bold">B</text>

  <!-- Orthogonal Result Vector C (Golden Vertical Normal) -->
  <g stroke="#f59e0b" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="64" y1="88" x2="64" y2="28"/>
    <path d="M56 38 L64 24 L72 38"/>
  </g>
  <text x="72" y="28" fill="#fde047" font-size="12" font-weight="bold">A×B</text>

  <!-- Right Angle Square at origin -->
  <path d="M64 78 L72 75 L72 85" stroke="#ffffff" stroke-width="1.5" fill="none"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 21V4m-3 3l3-3 3 3"/>
  <path d="M12 21l8-3m-3-1l3 1-1 3"/>
  <path d="M12 21l-7-3m3-1l-3 1 1 3"/>
</svg>`
  },
  {
    id: 'vf-fbm',
    name: 'Fractal Brownian Motion',
    category: 'Vector Fields',
    tags: ['fbm', 'fractal', 'brownian', 'noise', 'octaves', 'procedural'],
    description: 'Combines multiple octaves of vector noise with persistent lacunarity to synthesize realistic atmospheric turbulence.',
    hotkeys: { blender: 'Simulation Nodes > FBM Noise', unreal: 'Vector Noise FBM', houdini: 'Curl Noise Octaves', unity: 'FBM Vector' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Multi-Octave Fractal Turbulent Streams -->
  <!-- Low Frequency Harmonic (Broad Curve) -->
  <path d="M20 74 C42 40 78 98 108 52" stroke="#475569" stroke-width="6" stroke-linecap="round" fill="none"/>

  <!-- Mid Frequency Harmonic (Amber) -->
  <path d="M22 68 Q38 46 54 62 T86 54 T108 48" stroke="#f59e0b" stroke-width="3.5" stroke-linecap="round" fill="none"/>

  <!-- High Frequency Harmonic (Cyan Ripples) -->
  <path d="M22 64 Q30 54 38 64 T54 64 T70 64 T86 64 T102 64" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" fill="none"/>

  <!-- Micro Fractal Swirls -->
  <circle cx="54" cy="46" r="6" fill="none" stroke="#fde047" stroke-width="1.8"/>
  <circle cx="86" cy="74" r="5" fill="none" stroke="#38bdf8" stroke-width="1.8"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 15c4-5 8 5 12-2s4 0 6-2"/>
  <path d="M3 11c3-2 6 2 9 0s5 2 9-2" stroke-dasharray="2 2"/>
</svg>`
  },
  {
    id: 'vf-bounds',
    name: 'Volume Bounds Container',
    category: 'Vector Fields',
    tags: ['bounds', 'openvdb', 'nanovdb', 'container', 'domain', 'voxel'],
    description: 'Defines the 3D world-space bounding box domain for sparse OpenVDB / NanoVDB vector grids.',
    hotkeys: { blender: 'Smoke / Fluid Domain', unreal: 'Heterogeneous Volume', houdini: 'VDB Bounding Box', unity: 'Volume Component' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Outer Isometric Bounding Box Cage (Slate) -->
  <polygon points="64,22 106,44 64,66 22,44" fill="none" stroke="#f59e0b" stroke-width="2.5"/>
  <polygon points="22,44 64,66 64,106 22,84" fill="none" stroke="#f59e0b" stroke-width="2.5"/>
  <polygon points="64,66 106,44 106,84 64,106" fill="none" stroke="#f59e0b" stroke-width="2.5"/>

  <!-- Bounding Corner Brackets (Hardware accents) -->
  <circle cx="64" cy="22" r="3.5" fill="#fef08a"/>
  <circle cx="106" cy="44" r="3.5" fill="#fef08a"/>
  <circle cx="22" cy="44" r="3.5" fill="#fef08a"/>
  <circle cx="64" cy="106" r="3.5" fill="#fef08a"/>

  <!-- Inner Sparse Active Voxel Core -->
  <polygon points="64,48 84,58 64,68 44,58" fill="#0284c7" stroke="#38bdf8" stroke-width="1.5"/>
  <polygon points="44,58 64,68 64,86 44,76" fill="#0369a1" stroke="#38bdf8" stroke-width="1.5"/>
  <polygon points="64,68 84,58 84,76 64,86" fill="#0c4a6e" stroke="#38bdf8" stroke-width="1.5"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/>
  <path d="M12 3v18M4 7.5l8 4.5 8-4.5"/>
</svg>`
  },
  {
    id: 'vf-baker',
    name: 'Vector Field Baker',
    category: 'Vector Fields',
    tags: ['baker', 'fga', 'export', 'cache', 'bake', 'simulation'],
    description: 'Bakes dynamic vector field animations into discrete 3D texture slices (.FGA or OpenVDB) for game engines.',
    hotkeys: { blender: 'Bake Simulation', unreal: 'Bake Vector Field (FGA)', houdini: 'ROP Volume Output', unity: 'VFX Texture3D Baker' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Microchip / Baker Processor Tile (Dark Charcoal) -->
  <rect x="26" y="26" width="76" height="76" rx="14" fill="#1e222a" stroke="#4b5563" stroke-width="2.5"/>

  <!-- Chip Connector Pins -->
  <g stroke="#94a3b8" stroke-width="2" stroke-linecap="round">
    <line x1="38" y1="20" x2="38" y2="26"/>
    <line x1="50" y1="20" x2="50" y2="26"/>
    <line x1="64" y1="20" x2="64" y2="26"/>
    <line x1="78" y1="20" x2="78" y2="26"/>
    <line x1="90" y1="20" x2="90" y2="26"/>
    <!-- Bottom pins -->
    <line x1="38" y1="102" x2="38" y2="108"/>
    <line x1="64" y1="102" x2="64" y2="108"/>
    <line x1="90" y1="102" x2="90" y2="108"/>
  </g>

  <!-- Golden Baking Core with Vector Arrow Stamp -->
  <rect x="38" y="38" width="52" height="52" rx="8" fill="#f59e0b" stroke="#fef08a" stroke-width="2"/>
  <path d="M50 74 L78 50 M68 48 L78 50 L76 60" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
  
  <!-- Heat/Bake Waves -->
  <path d="M46 32 C50 30 54 32 58 30" stroke="#f97316" stroke-width="2" stroke-linecap="round"/>
  <path d="M70 32 C74 30 78 32 82 30" stroke="#f97316" stroke-width="2" stroke-linecap="round"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="5" y="5" width="14" height="14" rx="2"/>
  <path d="M9 1l-1 4M15 1l-1 4M9 19l-1 4M15 19l-1 4M1 9l4-1M1 15l4-1M19 9l4-1M19 15l4-1"/>
  <path d="M9 15l6-6m-4 0h4v4"/>
</svg>`
  },
  {
    id: 'vf-attractor',
    name: 'Lorenz Strange Attractor',
    category: 'Vector Fields',
    tags: ['attractor', 'lorenz', 'chaos', 'butterfly', 'orbit', 'dynamical'],
    description: 'Dynamic non-linear attractor field exhibiting chaotic butterfly-shaped dual-orbital particle trajectories.',
    hotkeys: { blender: 'Simulation Nodes > Lorenz Attractor', unreal: 'Chaotic Attractor', houdini: 'Lorenz Differential SOP', unity: 'Attractor System' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Dual-Lobed Butterfly Lorenz Orbits -->
  <!-- Left Wing (Cyan) -->
  <path d="M64 64 C42 32 20 46 22 72 C24 94 48 88 64 64" stroke="#38bdf8" stroke-width="3" fill="none"/>
  
  <!-- Right Wing (Amber) -->
  <path d="M64 64 C86 32 108 46 106 72 C104 94 80 88 64 64" stroke="#f59e0b" stroke-width="3" fill="none"/>

  <!-- Inner Loop Spiral -->
  <path d="M64 64 C50 48 34 56 36 70 C38 82 52 78 64 64" stroke="#7dd3fc" stroke-width="1.8" fill="none" stroke-dasharray="2 2"/>
  <path d="M64 64 C78 48 94 56 92 70 C90 82 76 78 64 64" stroke="#fde047" stroke-width="1.8" fill="none" stroke-dasharray="2 2"/>

  <!-- Orbiting Tracer Beads -->
  <circle cx="28" cy="54" r="3.5" fill="#38bdf8"/>
  <circle cx="100" cy="54" r="3.5" fill="#f59e0b"/>
  <circle cx="64" cy="64" r="5" fill="#ffffff" stroke="#f59e0b" stroke-width="1.5"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 12c-3-5-7-3-7 1s4 4 7-1z"/>
  <path d="M12 12c3-5 7-3 7 1s-4 4-7-1z"/>
  <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
</svg>`
  },
  {
    id: 'vf-normalize',
    name: 'Vector Normalizer',
    category: 'Vector Fields',
    tags: ['normalize', 'unit vector', 'length', 'magnitude', 'math'],
    description: 'Rescales variable-length vector field vectors to unit magnitude (|v| = 1) while preserving directional angles.',
    hotkeys: { blender: 'Vector Math > Normalize', unreal: 'Normalize Vector', houdini: 'normalize(v)', unity: 'Vector3.Normalize' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Unit Sphere Wireframe (Radius = 1) -->
  <circle cx="64" cy="64" r="42" fill="#1c1f26" stroke="#4b5563" stroke-width="2"/>
  <ellipse cx="64" cy="64" rx="42" ry="14" fill="none" stroke="#64748b" stroke-width="1.5" stroke-dasharray="3 3"/>
  <line x1="64" y1="22" x2="64" y2="106" stroke="#64748b" stroke-width="1.5" stroke-dasharray="3 3"/>

  <!-- Normalized Unit Vector (Snapping exactly to radius ring) -->
  <g stroke="#f59e0b" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="64" y1="64" x2="94" y2="34"/>
    <path d="M86 34 L94 34 L94 42"/>
  </g>
  <circle cx="94" cy="34" r="4.5" fill="#fde047" stroke="#b45309" stroke-width="1.5"/>

  <!-- Center Origin Bead -->
  <circle cx="64" cy="64" r="4.5" fill="#38bdf8"/>

  <!-- Formula Badge |v| = 1 -->
  <rect x="18" y="20" width="34" height="18" rx="4" fill="#2d323f" stroke="#f59e0b" stroke-width="1.2"/>
  <text x="35" y="33" fill="#fef08a" font-size="9" font-weight="bold" font-family="monospace" text-anchor="middle">|v|=1</text>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="8"/>
  <path d="M12 12l6-6m-4 0h4v4"/>
  <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
</svg>`
  },
  {
    id: 'vf-potential',
    name: 'Potential Flow Field',
    category: 'Vector Fields',
    tags: ['potential', 'equipotential', 'aerodynamics', 'flow', 'stream', 'laplace'],
    description: 'Models irrotational, incompressible potential flow around solid obstacles using Laplace equation velocity gradients.',
    hotkeys: { blender: 'Simulation Nodes > Potential Flow', unreal: 'Distance Field Flow', houdini: 'VDB Potential Flow', unity: 'Potential Solver' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Central Obstacle Cylinder (Slate/Charcoal) -->
  <circle cx="64" cy="64" r="18" fill="#2d323f" stroke="#f59e0b" stroke-width="2.5"/>
  <circle cx="64" cy="64" r="6" fill="#14161b"/>

  <!-- Deflected Equipotential Flow Lines around obstacle -->
  <path d="M18 36 C44 36 50 44 64 44 C78 44 84 36 110 36" stroke="#38bdf8" stroke-width="2.5" fill="none"/>
  <path d="M18 92 C44 92 50 84 64 84 C78 84 84 92 110 92" stroke="#38bdf8" stroke-width="2.5" fill="none"/>

  <!-- Close contour wrapping cylinder -->
  <path d="M18 64 C36 64 40 46 64 42 C88 46 92 64 110 64" stroke="#f59e0b" stroke-width="2" fill="none" stroke-dasharray="3 2"/>
  <path d="M18 64 C36 64 40 82 64 86 C88 82 92 64 110 64" stroke="#f59e0b" stroke-width="2" fill="none" stroke-dasharray="3 2"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="3.5"/>
  <path d="M2 7c5 0 7 2 10 2s5-2 10-2"/>
  <path d="M2 17c5 0 7-2 10-2s5 2 10 2"/>
</svg>`
  }
];
