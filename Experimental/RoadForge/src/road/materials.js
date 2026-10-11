// RoadForge — material table shared by CPU meshing and the GPU shading pass.
// texSlot indexes the procedurally baked texture array (see gpu/texbake.js).

export const MAT = {
  ASPHALT: 0, ASPHALT_OLD: 1, ASPHALT_NEW: 2, PAVING: 3, CURB: 4, GUTTER: 5,
  GRASS: 6, DIRT: 7, BALLAST: 8, CONCRETE: 9, STEEL: 10, PAINT_W: 11,
  COBBLE: 12, TACTILE: 13, RUBBER: 14, GLASS: 15, PLASTIC: 16, PLAZA: 17,
  SLEEPER: 18, LAMP: 19, PAINT_Y: 20, BIKE: 21, POLE: 22, RUST: 23,
  ALU: 24, SIGN: 25, LIGHT_R: 26, LIGHT_G: 27, LIGHT_A: 28, TARP: 29,
  TRAIN: 30, TRAIN_DARK: 31,
};

// [name, color(linear), roughness, metallic, texSlot, uvScale, emissive, flags]
// flags bit0: receives road markings | bit1: wet-prone | bit2: double-sided
export const MATERIALS = [
  ['Asphalt — carriageway', [0.0255, 0.0260, 0.0280], 0.76, 0.0, 0, 0.18, 0, 3],
  ['Asphalt — aged overlay', [0.0330, 0.0325, 0.0320], 0.86, 0.0, 0, 0.155, 0, 3],
  ['Asphalt — fresh lay', [0.0170, 0.0172, 0.0185], 0.70, 0.0, 0, 0.20, 0, 3],
  ['Footway paving', [0.1180, 0.1150, 0.1105], 0.80, 0.0, 1, 0.45, 0, 2],
  ['Kerb stone', [0.1750, 0.1720, 0.1660], 0.66, 0.0, 2, 0.70, 0, 2],
  ['Gutter channel', [0.1350, 0.1340, 0.1300], 0.70, 0.0, 3, 0.55, 0, 3],
  ['Verge grass', [0.0180, 0.0320, 0.0130], 0.95, 0.0, 4, 0.22, 0, 0],
  ['Compacted earth', [0.0380, 0.0290, 0.0205], 0.94, 0.0, 5, 0.30, 0, 0],
  ['Track ballast', [0.0320, 0.0310, 0.0295], 0.93, 0.0, 5, 0.85, 0, 0],
  ['Structural concrete', [0.1050, 0.1050, 0.1030], 0.74, 0.0, 3, 0.20, 0, 0],
  ['Galvanised steel', [0.2900, 0.2950, 0.3000], 0.34, 0.95, 7, 0.4, 0, 0],
  ['Road paint — white', [0.4200, 0.4200, 0.4050], 0.52, 0.0, -1, 1.0, 0, 0],
  ['Setts / cobble', [0.0480, 0.0455, 0.0430], 0.84, 0.0, 6, 0.75, 0, 2],
  ['Tactile paving', [0.1700, 0.1250, 0.0300], 0.72, 0.0, 1, 1.4, 0, 2],
  ['Crossing rubber', [0.0150, 0.0150, 0.0160], 0.88, 0.0, -1, 1.0, 0, 2],
  ['Glazing', [0.0120, 0.0135, 0.0150], 0.07, 0.0, -1, 1.0, 0, 4],
  ['Signal plastic', [0.2400, 0.0450, 0.0080], 0.48, 0.0, -1, 1.0, 0, 0],
  ['Plaza paving', [0.0780, 0.0700, 0.0640], 0.82, 0.0, 1, 0.30, 0, 0],
  ['Timber sleeper', [0.0230, 0.0170, 0.0120], 0.90, 0.0, 7, 0.6, 0, 0],
  ['Luminaire', [0.5000, 0.5000, 0.5000], 0.30, 0.0, -1, 1.0, 1, 0],
  ['Road paint — yellow', [0.3600, 0.2350, 0.0220], 0.54, 0.0, -1, 1.0, 0, 0],
  ['Cycle lane surface', [0.0620, 0.0200, 0.0160], 0.80, 0.0, 0, 0.18, 0, 3],
  ['Column steel', [0.0280, 0.0290, 0.0300], 0.42, 0.85, 7, 0.5, 0, 0],
  ['Weathered steel', [0.0620, 0.0330, 0.0180], 0.78, 0.55, 7, 0.5, 0, 0],
  ['Anodised aluminium', [0.3200, 0.3250, 0.3300], 0.26, 0.95, 7, 0.35, 0, 0],
  ['Sign face', [0.3400, 0.3400, 0.3500], 0.34, 0.0, -1, 1.0, 0, 0],
  ['Signal — red', [0.6000, 0.0300, 0.0150], 0.30, 0.0, -1, 1.0, 1, 0],
  ['Signal — green', [0.0400, 0.5200, 0.1200], 0.30, 0.0, -1, 1.0, 1, 0],
  ['Signal — amber', [0.6500, 0.2600, 0.0150], 0.30, 0.0, -1, 1.0, 1, 0],
  ['Site tarpaulin', [0.1800, 0.1150, 0.0180], 0.86, 0.0, -1, 1.0, 0, 4],
  ['Rolling stock shell', [0.2100, 0.2150, 0.2200], 0.30, 0.35, 7, 0.3, 0, 0],
  ['Rolling stock trim', [0.0180, 0.0185, 0.0200], 0.40, 0.2, -1, 1.0, 0, 0],
];

export const MATERIAL_COUNT = MATERIALS.length;

export function materialBuffer() {
  // 3 x vec4 per material = 48 bytes
  const f = new Float32Array(MATERIAL_COUNT * 12);
  MATERIALS.forEach((m, i) => {
    const o = i * 12;
    f[o] = m[1][0]; f[o + 1] = m[1][1]; f[o + 2] = m[1][2]; f[o + 3] = 1;
    f[o + 4] = m[2]; f[o + 5] = m[3]; f[o + 6] = m[4]; f[o + 7] = m[5];
    f[o + 8] = m[6]; f[o + 9] = m[7]; f[o + 10] = 0; f[o + 11] = 0;
  });
  return f;
}

export const TEX_SLOTS = [
  { id: 'asphalt', name: 'Asphalt', slot: 0 },
  { id: 'paving', name: 'Footway paving', slot: 1 },
  { id: 'kerb', name: 'Kerb stone', slot: 2 },
  { id: 'concrete', name: 'Concrete', slot: 3 },
  { id: 'grass', name: 'Verge', slot: 4 },
  { id: 'gravel', name: 'Gravel / ballast', slot: 5 },
  { id: 'setts', name: 'Setts', slot: 6 },
  { id: 'metal', name: 'Metal / misc', slot: 7 },
];
