/**
 * Forcefield Icon Set (14 Icons)
 * Visual Style: 3D Claymorphic DCC Physics / Simulation Elements
 * Emphasizing physical force vectors, flow fields, tactile emitters, and energy fields
 */

export const forcefieldIcons = [
  {
    id: 'force-point',
    name: 'Point Gravity Field',
    category: 'Forcefield',
    tags: ['point', 'gravity', 'radial', 'attractor', 'singularity', 'physics'],
    description: 'Generates an omnidirectional spherical gravitational or repulsive field radiating from a central point source.',
    hotkeys: { blender: 'Shift+A > Force Field > Point', maya: 'Fields > Radial', c4d: 'Radial Field', max: 'Gravity Space Warp' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="ff-pt-core" cx="0.4" cy="0.4" r="0.6">
      <stop offset="0%" stop-color="#fef08a"/>
      <stop offset="40%" stop-color="#f59e0b"/>
      <stop offset="85%" stop-color="#b45309"/>
      <stop offset="100%" stop-color="#78350f"/>
    </radialGradient>
    <radialGradient id="ff-pt-wave" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.5"/>
      <stop offset="70%" stop-color="#0284c7" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#0369a1" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Concentric Gravitational Wave Ripples -->
  <circle cx="64" cy="64" r="50" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.4"/>
  <circle cx="64" cy="64" r="36" fill="url(#ff-pt-wave)"/>
  <circle cx="64" cy="64" r="36" fill="none" stroke="#38bdf8" stroke-width="2" opacity="0.75"/>

  <!-- Inward Radial Gravity Vectors -->
  <g stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <!-- North -->
    <path d="M64 16 V32 M59 26 L64 32 L69 26"/>
    <!-- South -->
    <path d="M64 112 V96 M59 102 L64 96 L69 102"/>
    <!-- West -->
    <path d="M16 64 H32 M26 59 L32 64 L26 69"/>
    <!-- East -->
    <path d="M112 64 H96 M102 59 L96 64 L102 69"/>
    <!-- Diagonals -->
    <path d="M30 30 L42 42 M34 42 L42 42 L42 34"/>
    <path d="M98 30 L86 42 M94 42 L86 42 L86 34"/>
    <path d="M30 98 L42 86 M34 86 L42 86 L42 94"/>
    <path d="M98 98 L86 86 M94 86 L86 86 L86 94"/>
  </g>

  <!-- Heavy 3D Central Gravity Core Sphere -->
  <circle cx="64" cy="64" r="16" fill="url(#ff-pt-core)" stroke="#fef08a" stroke-width="2"/>
  <ellipse cx="60" cy="58" rx="6" ry="3.5" fill="#ffffff" opacity="0.6"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="4"/>
  <path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>
  <path d="M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
</svg>`
  },
  {
    id: 'force-wind',
    name: 'Directional Wind Force',
    category: 'Forcefield',
    tags: ['wind', 'air', 'directional', 'gust', 'velocity', 'aerodynamic'],
    description: 'Blows physics particles, cloth, and soft bodies in a continuous constant or gusting directional vector.',
    hotkeys: { blender: 'Shift+A > Force Field > Wind', maya: 'Fields > Air', c4d: 'Wind Modifier', max: 'Wind Space Warp' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="ff-wind-nozzle" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3b4252"/>
      <stop offset="100%" stop-color="#1e222a"/>
    </linearGradient>
    <linearGradient id="ff-wind-stream" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#f59e0b"/>
      <stop offset="50%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- 3D Wind Emitter Cone / Turbine Nozzle (Similar to megaphone reference) -->
  <g transform="translate(18, 44)">
    <path d="M4 14 L24 2 L24 38 L4 26 Z" fill="url(#ff-wind-nozzle)" stroke="#4b5563" stroke-width="2"/>
    <ellipse cx="24" cy="20" rx="5" ry="18" fill="#f59e0b" stroke="#fef08a" stroke-width="2"/>
    <rect x="-6" y="14" width="10" height="12" rx="3" fill="#2d323f" stroke="#4b5563" stroke-width="1.5"/>
  </g>

  <!-- High-Speed Aerodynamic Wind Ribbons -->
  <!-- Top Streamline -->
  <path d="M46 44 C64 42 78 34 106 34" stroke="url(#ff-wind-stream)" stroke-width="4" stroke-linecap="round"/>
  <polygon points="112,34 104,30 104,38" fill="#38bdf8"/>

  <!-- Middle Main Gust -->
  <path d="M48 64 C70 64 88 64 116 64" stroke="url(#ff-wind-stream)" stroke-width="5" stroke-linecap="round"/>
  <polygon points="122,64 114,59 114,69" fill="#f59e0b"/>

  <!-- Bottom Streamline -->
  <path d="M46 84 C64 86 78 94 106 94" stroke="url(#ff-wind-stream)" stroke-width="4" stroke-linecap="round"/>
  <polygon points="112,94 104,90 104,98" fill="#38bdf8"/>

  <!-- Gust Wind Particle Beads -->
  <circle cx="68" cy="52" r="3" fill="#fef08a"/>
  <circle cx="88" cy="74" r="2.5" fill="#bae6fd"/>
  <circle cx="94" cy="48" r="2" fill="#fef08a"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 8h12a3 3 0 1 0-3-3"/>
  <path d="M2 12h17a3 3 0 1 1-3 3"/>
  <path d="M5 16h8a2 2 0 1 0-2-2"/>
</svg>`
  },
  {
    id: 'force-vortex',
    name: 'Vortex / Cyclone Field',
    category: 'Forcefield',
    tags: ['vortex', 'tornado', 'cyclone', 'spin', 'centrifugal', 'spiral'],
    description: 'Produces a helical swirling vortex that draws particles toward a central funnel and spins them along a vertical axis.',
    hotkeys: { blender: 'Shift+A > Force Field > Vortex', maya: 'Fields > Vortex', c4d: 'Vortex Field', max: 'Vortex Space Warp' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="ff-vortex-cone" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="50%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#1e222a"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="114" rx="42" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Swirling Cyclone Funnel Rings -->
  <!-- Top Ring (Widest) -->
  <ellipse cx="64" cy="30" rx="42" ry="12" fill="none" stroke="#38bdf8" stroke-width="3" opacity="0.9"/>
  <path d="M106 30 L102 24 M106 30 L108 36" stroke="#38bdf8" stroke-width="3" stroke-linecap="round"/>

  <!-- Ring 2 -->
  <ellipse cx="64" cy="50" rx="32" ry="9" fill="none" stroke="#f59e0b" stroke-width="3" opacity="0.85"/>
  <path d="M32 50 L36 44 M32 50 L30 56" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/>

  <!-- Ring 3 -->
  <ellipse cx="64" cy="70" rx="22" ry="6.5" fill="none" stroke="#38bdf8" stroke-width="2.5" opacity="0.85"/>
  <path d="M86 70 L82 65 M86 70 L88 75" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round"/>

  <!-- Ring 4 (Narrow Bottom) -->
  <ellipse cx="64" cy="88" rx="12" ry="4" fill="none" stroke="#f59e0b" stroke-width="2"/>
  <circle cx="64" cy="100" r="4" fill="#fde047" stroke="#b45309" stroke-width="1.5"/>

  <!-- Central Vertical Vortex Core Spindle -->
  <line x1="64" y1="20" x2="64" y2="100" stroke="#ffffff" stroke-width="2" stroke-dasharray="3 3" opacity="0.5"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <ellipse cx="12" cy="5" rx="9" ry="3"/>
  <ellipse cx="12" cy="11" rx="6" ry="2"/>
  <ellipse cx="12" cy="16" rx="3.5" ry="1.2"/>
  <circle cx="12" cy="20" r="1"/>
  <path d="M21 5l-2-2m-14 8l2-2"/>
</svg>`
  },
  {
    id: 'force-turbulence',
    name: 'Turbulence Field',
    category: 'Forcefield',
    tags: ['turbulence', 'noise', 'perlin', 'curl', 'chaos', 'fluid'],
    description: 'Disturbs particle velocity using multi-octave 3D Perlin/simplex noise to create chaotic, organic motion.',
    hotkeys: { blender: 'Shift+A > Force Field > Turbulence', maya: 'Fields > Turbulence', c4d: 'Random Field', max: 'Displace Space Warp' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Intersecting Chaotic Curl Noise Streams -->
  <!-- Stream 1 (Amber Wave) -->
  <path d="M24 38 Q42 16 60 44 T98 32 T110 52" stroke="#f59e0b" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  
  <!-- Stream 2 (Cyan Curl) -->
  <path d="M18 64 Q46 88 64 56 T106 72" stroke="#38bdf8" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  
  <!-- Stream 3 (Gold Swirl) -->
  <path d="M26 94 Q48 68 76 92 T112 84" stroke="#fbbf24" stroke-width="3.5" fill="none" stroke-linecap="round"/>

  <!-- Micro Vortices / Turbulence Eddies -->
  <g stroke="#ffffff" stroke-width="1.8" fill="none" opacity="0.8">
    <path d="M46 36 C42 42 46 48 52 46 C56 44 56 38 50 36"/>
    <path d="M82 66 C78 72 82 78 88 76 C92 74 92 68 86 66"/>
  </g>

  <!-- Deflected Particle Sprays -->
  <circle cx="38" cy="28" r="2.5" fill="#fef08a"/>
  <circle cx="78" cy="42" r="3" fill="#38bdf8"/>
  <circle cx="56" cy="74" r="2" fill="#fef08a"/>
  <circle cx="94" cy="88" r="3" fill="#f59e0b"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 8c3-3 6 3 9 0s6 3 9 0"/>
  <path d="M3 13c4 3 6-3 10 0s5-2 8 0"/>
  <path d="M3 18c3-2 6 2 9 0s6-1 9 0"/>
</svg>`
  },
  {
    id: 'force-curve-guide',
    name: 'Curve Guide',
    category: 'Forcefield',
    tags: ['curve', 'guide', 'spline', 'path', 'trajectory', 'flow'],
    description: 'Channels and guides particles strictly along the length and tangent of a 3D bezier or NURBS spline curve.',
    hotkeys: { blender: 'Shift+A > Force Field > Curve Guide', maya: 'Curve Flow', c4d: 'Spline Field', max: 'Path Follow' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- 3D Guide Spline Tube (Curving S-path) -->
  <path d="M24 96 C30 50 60 40 68 70 C76 100 100 90 108 34" stroke="#2d323f" stroke-width="10" stroke-linecap="round"/>
  <path d="M24 96 C30 50 60 40 68 70 C76 100 100 90 108 34" stroke="#f59e0b" stroke-width="4" stroke-linecap="round"/>

  <!-- Guiding Magnetic Rings / Collars along path -->
  <ellipse cx="34" cy="72" rx="10" ry="5" transform="rotate(-35, 34, 72)" fill="none" stroke="#38bdf8" stroke-width="2.5"/>
  <ellipse cx="68" cy="70" rx="10" ry="5" transform="rotate(45, 68, 70)" fill="none" stroke="#38bdf8" stroke-width="2.5"/>
  <ellipse cx="98" cy="54" rx="10" ry="5" transform="rotate(-40, 98, 54)" fill="none" stroke="#38bdf8" stroke-width="2.5"/>

  <!-- Traveling Particles following spline -->
  <circle cx="28" cy="86" r="4" fill="#fde047" stroke="#b45309" stroke-width="1.5"/>
  <circle cx="56" cy="56" r="4" fill="#fde047" stroke="#b45309" stroke-width="1.5"/>
  <circle cx="80" cy="80" r="4" fill="#fde047" stroke="#b45309" stroke-width="1.5"/>
  <circle cx="106" cy="40" r="5" fill="#ffffff" stroke="#f59e0b" stroke-width="2"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 19c2-8 6-10 8-5s6 3 8-9"/>
  <circle cx="4" cy="19" r="2"/>
  <circle cx="12" cy="14" r="2"/>
  <circle cx="20" cy="5" r="2"/>
</svg>`
  },
  {
    id: 'force-drag',
    name: 'Drag & Resistance',
    category: 'Forcefield',
    tags: ['drag', 'resistance', 'friction', 'air', 'damping', 'deceleration'],
    description: 'Applies aerodynamic drag force proportional to particle velocity, slowing down fast-moving bodies.',
    hotkeys: { blender: 'Shift+A > Force Field > Drag', maya: 'Fields > Drag', c4d: 'Friction Modifier', max: 'Drag Space Warp' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="ff-drag-shield" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3b4252"/>
      <stop offset="100%" stop-color="#1a1c22"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Curved Aerodynamic Drag Shield -->
  <path d="M40 28 C64 42 64 86 40 100 C74 100 86 64 86 64 C86 64 74 28 40 28 Z" fill="url(#ff-drag-shield)" stroke="#4b5563" stroke-width="2.5"/>
  <path d="M40 28 C64 42 64 86 40 100" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/>

  <!-- Opposing Deceleration Resistance Arrows -->
  <g stroke="#38bdf8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M104 46 H76 M84 40 L76 46 L84 52"/>
    <path d="M112 64 H84 M92 58 L84 64 L92 70"/>
    <path d="M104 82 H76 M84 76 L76 82 L84 88"/>
  </g>

  <!-- Deflected Turbulent Wake Behind Shield -->
  <path d="M34 46 Q22 46 16 38" stroke="#64748b" stroke-width="2" stroke-dasharray="3 3"/>
  <path d="M34 82 Q22 82 16 90" stroke="#64748b" stroke-width="2" stroke-dasharray="3 3"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M8 5c6 3 6 11 0 14"/>
  <path d="M19 8h-6m2-3l-3 3 3 3"/>
  <path d="M21 16h-6m2-3l-3 3 3 3"/>
</svg>`
  },
  {
    id: 'force-harmonic',
    name: 'Harmonic Oscillator',
    category: 'Forcefield',
    tags: ['harmonic', 'spring', 'oscillator', 'resonance', 'vibration', 'physics'],
    description: 'Simulates a damped harmonic oscillator (Hooke’s law spring) that pulls objects toward an equilibrium point.',
    hotkeys: { blender: 'Shift+A > Force Field > Harmonic', maya: 'Fields > Spring', c4d: 'Spring Field', max: 'Spring Controller' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="42" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Top Mounting Plate (Hardware bracket like clapperboard) -->
  <rect x="42" y="18" width="44" height="12" rx="4" fill="#2d323f" stroke="#4b5563" stroke-width="2"/>
  <circle cx="50" cy="24" r="2.5" fill="#94a3b8"/>
  <circle cx="78" cy="24" r="2.5" fill="#94a3b8"/>

  <!-- Coiled 3D Helical Spring -->
  <path d="M64 30 L74 38 L54 46 L74 54 L54 62 L74 70 L54 78 L64 84" stroke="#f59e0b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- Oscillating Mass Bob (3D Clay Sphere) -->
  <circle cx="64" cy="94" r="14" fill="#f59e0b" stroke="#fef08a" stroke-width="2"/>
  <ellipse cx="60" cy="88" rx="5" ry="3" fill="#ffffff" opacity="0.7"/>

  <!-- Harmonic Vibration Amplitude Arrows -->
  <g stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M88 84 V104 M84 88 L88 84 L92 88 M84 100 L88 104 L92 100"/>
  </g>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <line x1="8" y1="3" x2="16" y2="3"/>
  <path d="M12 3v3l3 2-6 3 6 3-6 3 3 2v2"/>
  <circle cx="12" cy="20" r="2.5"/>
</svg>`
  },
  {
    id: 'force-magnetic',
    name: 'Magnetic Dipole Field',
    category: 'Forcefield',
    tags: ['magnetic', 'dipole', 'magnet', 'flux', 'attract', 'poles'],
    description: 'Generates a magnetic dipole field with North and South poles, exerting Lorentz forces on charged particles.',
    hotkeys: { blender: 'Shift+A > Force Field > Magnetic', maya: 'Fields > Newton', c4d: 'Magnetic Field', max: 'Motor Space Warp' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="ff-mag-red" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f43f5e"/>
      <stop offset="100%" stop-color="#be123c"/>
    </linearGradient>
    <linearGradient id="ff-mag-blue" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#0284c7"/>
    </linearGradient>
  </defs>
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.45" filter="blur(4px)"/>

  <!-- Horseshoe Magnet 3D Body -->
  <path d="M34 32 C34 16 94 16 94 32 V72 H74 V40 C74 34 54 34 54 40 V72 H34 Z" fill="#2d323f" stroke="#4b5563" stroke-width="2.5"/>

  <!-- Left Pole Cap (North - Red) -->
  <rect x="34" y="68" width="20" height="20" rx="3" fill="url(#ff-mag-red)" stroke="#fecdd3" stroke-width="1.5"/>
  <text x="44" y="82" fill="#ffffff" font-size="11" font-weight="bold" text-anchor="middle">N</text>

  <!-- Right Pole Cap (South - Blue) -->
  <rect x="74" y="68" width="20" height="20" rx="3" fill="url(#ff-mag-blue)" stroke="#bae6fd" stroke-width="1.5"/>
  <text x="84" y="82" fill="#ffffff" font-size="11" font-weight="bold" text-anchor="middle">S</text>

  <!-- Looping Magnetic Flux Lines (Amber Glowing Arcs) -->
  <path d="M44 88 C44 116 84 116 84 88" stroke="#f59e0b" stroke-width="2.5" fill="none" stroke-dasharray="3 3"/>
  <path d="M38 88 C38 126 90 126 90 88" stroke="#fbbf24" stroke-width="2" fill="none" opacity="0.6"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M6 4c0-2 12-2 12 0v10h-4V6H10v8H6z"/>
  <rect x="6" y="14" width="4" height="6"/>
  <rect x="14" y="14" width="4" height="6"/>
  <path d="M8 20c0 3 8 3 8 0" stroke-dasharray="2 2"/>
</svg>`
  },
  {
    id: 'force-buoyancy',
    name: 'Fluid Buoyancy Lift',
    category: 'Forcefield',
    tags: ['buoyancy', 'fluid', 'float', 'lift', 'liquid', 'bubbles'],
    description: 'Imparts an upward Archimedean buoyant force inside fluid simulation domains based on density differentials.',
    hotkeys: { blender: 'Fluid Simulation > Buoyancy', maya: 'Fluids > Density Buoyancy', c4d: 'Pyro Updraft', max: 'Fluid Float' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Liquid Surface / Container Plane -->
  <path d="M20 74 C40 68 88 80 108 74 V102 H20 Z" fill="#0284c7" fill-opacity="0.3" stroke="#38bdf8" stroke-width="2"/>

  <!-- Ascending Floating Sphere (Referencing battery/lab flask style) -->
  <circle cx="64" cy="52" r="16" fill="#f59e0b" stroke="#fef08a" stroke-width="2.5"/>
  <ellipse cx="60" cy="46" rx="6" ry="3.5" fill="#ffffff" opacity="0.7"/>

  <!-- Upward Buoyant Lift Vectors -->
  <g stroke="#38bdf8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M64 34 V16 M59 22 L64 16 L69 22"/>
    <path d="M42 46 V32 M38 37 L42 32 L46 37"/>
    <path d="M86 46 V32 M82 37 L86 32 L90 37"/>
  </g>

  <!-- Effervescent Rising Bubbles -->
  <circle cx="48" cy="80" r="4" fill="none" stroke="#bae6fd" stroke-width="1.8"/>
  <circle cx="76" cy="86" r="5" fill="none" stroke="#bae6fd" stroke-width="1.8"/>
  <circle cx="62" cy="94" r="3" fill="none" stroke="#bae6fd" stroke-width="1.8"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="9" r="4"/>
  <path d="M12 5V2m-2 2l2-2 2 2"/>
  <path d="M3 17c4-2 7 2 11 0s5-1 7 0"/>
  <circle cx="7" cy="19" r="1"/>
  <circle cx="16" cy="20" r="1.5"/>
</svg>`
  },
  {
    id: 'force-collision',
    name: 'Deflector / Collision',
    category: 'Forcefield',
    tags: ['collision', 'deflector', 'barrier', 'bounce', 'reflection', 'physics'],
    description: 'Impenetrable boundary surface that deflects particles upon impact with configurable restitution/damping.',
    hotkeys: { blender: 'Physics > Collision', maya: 'Particles > Make Collide', c4d: 'Collider Tag', max: 'Deflector Space Warp' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Angled Deflector Barrier (Heavy Slate Block) -->
  <polygon points="24,96 104,96 84,76 4,76" fill="#2d323f" stroke="#4b5563" stroke-width="2.5"/>
  <line x1="4" y1="76" x2="84" y2="76" stroke="#f59e0b" stroke-width="3.5"/>

  <!-- Incoming Particle Ray (Cyan) -->
  <path d="M26 24 L52 76" stroke="#38bdf8" stroke-width="3" stroke-linecap="round"/>
  <polygon points="50,72 42,66 48,60" fill="#38bdf8"/>

  <!-- Outgoing Rebounding Particle Ray (Amber) -->
  <path d="M52 76 L86 28" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/>
  <polygon points="86,28 84,38 76,34" fill="#f59e0b"/>

  <!-- Impact Point Energy Spark -->
  <circle cx="52" cy="76" r="6" fill="#ffffff" stroke="#fde047" stroke-width="2"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <line x1="3" y1="18" x2="21" y2="18" stroke-width="2.5"/>
  <path d="M5 6l6 12 8-10"/>
  <circle cx="11" cy="18" r="1.5" fill="currentColor"/>
</svg>`
  },
  {
    id: 'force-charge',
    name: 'Electrostatic Charge',
    category: 'Forcefield',
    tags: ['charge', 'electric', 'coulomb', 'positive', 'negative', 'attract'],
    description: 'Calculates Coulomb electrostatic attraction and repulsion between oppositely or like-charged particles.',
    hotkeys: { blender: 'Shift+A > Force Field > Charge', maya: 'Fields > Newton (Charge)', c4d: 'Charge Modifier', max: 'Electric Field' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Positive (+) Gold Clay Orb -->
  <circle cx="40" cy="64" r="18" fill="#f59e0b" stroke="#fef08a" stroke-width="2.5"/>
  <path d="M40 54 V74 M30 64 H50" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>

  <!-- Negative (-) Cyan Clay Orb -->
  <circle cx="88" cy="64" r="18" fill="#0284c7" stroke="#bae6fd" stroke-width="2.5"/>
  <path d="M78 64 H98" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>

  <!-- Connecting Coulomb Field Lines -->
  <path d="M40 46 C40 26 88 26 88 46" stroke="#38bdf8" stroke-width="2" fill="none" stroke-dasharray="3 3"/>
  <path d="M40 82 C40 102 88 102 88 82" stroke="#38bdf8" stroke-width="2" fill="none" stroke-dasharray="3 3"/>
  <line x1="58" y1="64" x2="70" y2="64" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="7" cy="12" r="4"/>
  <circle cx="17" cy="12" r="4"/>
  <path d="M7 10v4M5 12h4M15 12h4"/>
  <path d="M7 8c2-3 8-3 10 0M7 16c2 3 8 3 10 0" stroke-dasharray="2 2"/>
</svg>`
  },
  {
    id: 'force-texture',
    name: 'Texture Displace Force',
    category: 'Forcefield',
    tags: ['texture', 'noise', 'displace', 'heightmap', 'bitmap', 'procedural'],
    description: 'Drives physics forces directly from grayscale or RGB vector texture maps to sculpt complex wave behaviors.',
    hotkeys: { blender: 'Shift+A > Force Field > Texture', maya: 'Fields > Volume Axis', c4d: 'Shader Field', max: 'Displace Space Warp' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- 3D Displaced Landscape Mesh Grid Tile -->
  <polygon points="18,74 64,52 110,74 64,98" fill="#242833" stroke="#4b5563" stroke-width="2"/>
  
  <!-- Displaced Height Peak (Amber Island) -->
  <polygon points="46,62 64,36 82,62 64,78" fill="#f59e0b" stroke="#fef08a" stroke-width="2"/>
  <line x1="64" y1="36" x2="64" y2="78" stroke="#ffffff" stroke-width="1.5" opacity="0.5"/>

  <!-- Vertical Normal Force Vectors -->
  <g stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M64 36 V18 M60 23 L64 18 L68 23"/>
    <path d="M46 62 V48 M43 52 L46 48 L49 52"/>
    <path d="M82 62 V48 M79 52 L82 48 L85 52"/>
  </g>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 18l9-4 9 4-9 4-9-4z"/>
  <path d="M7 16l5-6 5 6"/>
  <path d="M12 10V4m-2 2l2-2 2 2"/>
</svg>`
  },
  {
    id: 'force-boids',
    name: 'Flocking / Boids Swarm',
    category: 'Forcefield',
    tags: ['boids', 'flocking', 'swarm', 'crowd', 'alignment', 'cohesion'],
    description: 'Implements Craig Reynolds’ Boids algorithm: flock cohesion, obstacle separation, and velocity alignment.',
    hotkeys: { blender: 'Shift+A > Force Field > Boid', maya: 'MASH > Crowd / Flight', c4d: 'Flock Modifier', max: 'Crowd / Delegate' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Leader Boid (Golden Arrowhead) -->
  <g transform="translate(64, 40)">
    <polygon points="0,-16 16,16 0,8 -16,16" fill="#f59e0b" stroke="#fef08a" stroke-width="2"/>
  </g>

  <!-- Wingman Boid Left (Cyan Arrowhead) -->
  <g transform="translate(36, 76)">
    <polygon points="0,-14 14,14 0,7 -14,14" fill="#0284c7" stroke="#7dd3fc" stroke-width="1.8"/>
  </g>

  <!-- Wingman Boid Right (Slate Arrowhead) -->
  <g transform="translate(92, 76)">
    <polygon points="0,-14 14,14 0,7 -14,14" fill="#3b4252" stroke="#94a3b8" stroke-width="1.8"/>
  </g>

  <!-- Inter-Flock Cohesion & Alignment Vectors -->
  <line x1="42" y1="68" x2="58" y2="48" stroke="#38bdf8" stroke-width="2" stroke-dasharray="3 2"/>
  <line x1="86" y1="68" x2="70" y2="48" stroke="#38bdf8" stroke-width="2" stroke-dasharray="3 2"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 2l4 8-4-2-4 2 4-8z"/>
  <path d="M6 14l3 6-3-1.5-3 1.5 3-6z"/>
  <path d="M18 14l3 6-3-1.5-3 1.5 3-6z"/>
</svg>`
  },
  {
    id: 'force-vortex-ring',
    name: 'Toroidal Vortex Ring',
    category: 'Forcefield',
    tags: ['vortex ring', 'torus', 'smoke ring', 'vorticity', 'fluid'],
    description: 'Simulates a self-propagating toroidal vortex (smoke ring) that rolls fluid momentum forward along its axis.',
    hotkeys: { blender: 'Fluid Simulation > Smoke Ring', maya: 'Bifrost > Smoke Ring', c4d: 'Vortex Torus', max: 'Ring Wave' },
    svg3d: `<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="64" cy="114" rx="44" ry="8" fill="#000" opacity="0.4" filter="blur(4px)"/>

  <!-- Torus Body Outer Arc -->
  <ellipse cx="64" cy="64" rx="46" ry="24" fill="none" stroke="#2d323f" stroke-width="16"/>
  <ellipse cx="64" cy="64" rx="46" ry="24" fill="none" stroke="#f59e0b" stroke-width="4"/>

  <!-- Torus Core Hole -->
  <ellipse cx="64" cy="64" rx="20" ry="10" fill="#14161b" stroke="#38bdf8" stroke-width="2"/>

  <!-- Poloidal Vorticity Circulation Vectors (Rolling arrows) -->
  <g stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M22 64 C22 56 30 52 38 56 M20 60 L22 64 L26 62"/>
    <path d="M106 64 C106 56 98 52 90 56 M108 60 L106 64 L102 62"/>
  </g>

  <!-- Central Jet Vector -->
  <line x1="64" y1="44" x2="64" y2="84" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>
  <polygon points="64,88 60,80 68,80" fill="#ffffff"/>
</svg>`,
    svg2d: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <ellipse cx="12" cy="12" rx="9" ry="5"/>
  <ellipse cx="12" cy="12" rx="4" ry="2"/>
  <path d="M12 7v10m-2-2l2 2 2-2"/>
</svg>`
  }
];
