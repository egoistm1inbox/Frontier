/**
 * Desert plant parameters and species presets.
 *
 * Desert plants are not treated as low-detail trees.  The generator has a
 * small botanical vocabulary for columnar cacti, barrels, pads and rosettes:
 * ribs are part of the body profile, arms are welded through true windows, and
 * the areole/spine layer is generated from the surface rather than painted on
 * with an image.
 */

export type DesertForm = 'saguaro' | 'barrel' | 'organ-pipe' | 'prickly-pear' | 'agave' | 'aloe' | 'ocotillo';

export const DESERT_FORM_NAMES: Record<DesertForm, string> = {
  saguaro: 'Saguaro · branching column',
  barrel: 'Barrel · ribbed globe',
  'organ-pipe': 'Organ pipe · clustered columns',
  'prickly-pear': 'Prickly pear · pads',
  agave: 'Agave · rigid rosette',
  aloe: 'Aloe · serrated rosette',
  ocotillo: 'Ocotillo · whip stems',
};

export interface DesertParams {
  form: DesertForm;

  // Main body ---------------------------------------------------------------
  height: number;
  heightV: number;
  radius: number;
  radiusV: number;
  lean: number;
  curve: number;
  taper: number;
  shoulder: number;

  // Branching cacti / pad plants -------------------------------------------
  arms: number;
  armHeight: number;
  armHeightV: number;
  armLength: number;
  armLengthV: number;
  armRadius: number;
  armRadiusV: number;
  armLean: number;
  armCurve: number;
  armTaper: number;
  armSpread: number;
  secondaryArms: number;

  // Flattened pads ----------------------------------------------------------
  padWidth: number;
  padHeight: number;
  padThickness: number;
  padTilt: number;
  padCount: number;

  // Rosette leaves ----------------------------------------------------------
  rosetteLeaves: number;
  leafLength: number;
  leafLengthV: number;
  leafWidth: number;
  leafWidthV: number;
  leafThickness: number;
  leafLean: number;
  leafDroop: number;
  leafTwist: number;
  leafSerration: number;

  // Surface anatomy ---------------------------------------------------------
  ribs: number;
  ribDepth: number;
  ribSharpness: number;
  areoleRows: number;
  areoleColumns: number;
  spinesPerAreole: number;
  spineLength: number;
  spineLengthV: number;
  spineSpread: number;
  spineClusterScale: number;
  flower: boolean;
  flowerScale: number;

  // Mesh density ------------------------------------------------------------
  radialSegments: number;
  bodyRings: number;
  armRings: number;
  branchletSegments: number;
  collarRings: number;
}

export const DEFAULT_DESERT: DesertParams = {
  form: 'saguaro',
  height: 3.6,
  heightV: 0.12,
  radius: 0.28,
  radiusV: 0.08,
  lean: 1.5,
  curve: 2,
  taper: 0.18,
  shoulder: 0.12,

  arms: 2,
  armHeight: 0.44,
  armHeightV: 0.14,
  armLength: 0.95,
  armLengthV: 0.2,
  armRadius: 0.18,
  armRadiusV: 0.1,
  armLean: 6,
  armCurve: 5,
  armTaper: 0.18,
  armSpread: 0.85,
  secondaryArms: 0,

  padWidth: 0.42,
  padHeight: 0.62,
  padThickness: 0.11,
  padTilt: 18,
  padCount: 6,

  rosetteLeaves: 46,
  leafLength: 0.95,
  leafLengthV: 0.2,
  leafWidth: 0.17,
  leafWidthV: 0.12,
  leafThickness: 0.025,
  leafLean: 48,
  leafDroop: 15,
  leafTwist: 10,
  leafSerration: 0.7,

  ribs: 16,
  ribDepth: 0.075,
  ribSharpness: 1.8,
  areoleRows: 15,
  areoleColumns: 16,
  spinesPerAreole: 5,
  spineLength: 0.035,
  spineLengthV: 0.25,
  spineSpread: 0.45,
  spineClusterScale: 1,
  flower: true,
  flowerScale: 0.16,

  radialSegments: 32,
  bodyRings: 28,
  armRings: 12,
  branchletSegments: 4,
  collarRings: 2,
};

export const DESERT_PRESETS: { name: string; desert: Partial<DesertParams> }[] = [
  {
    name: 'Saguaro Cactus',
    desert: {
      form: 'saguaro',
      height: 5.1,
      heightV: 0.1,
      radius: 0.31,
      radiusV: 0.06,
      lean: 1.2,
      curve: 2.5,
      taper: 0.13,
      shoulder: 0.15,
      arms: 2,
      armHeight: 0.42,
      armHeightV: 0.18,
      armLength: 1.35,
      armLengthV: 0.16,
      armRadius: 0.19,
      armRadiusV: 0.08,
      armLean: 4,
      armCurve: 3,
      armTaper: 0.12,
      armSpread: 0.8,
      secondaryArms: 1,
      ribs: 22,
      ribDepth: 0.085,
      ribSharpness: 2,
      areoleRows: 20,
      areoleColumns: 22,
      spinesPerAreole: 5,
      spineLength: 0.045,
      spineLengthV: 0.35,
      spineSpread: 0.36,
      flower: true,
      flowerScale: 0.16,
      radialSegments: 36,
      bodyRings: 36,
      armRings: 16,
    },
  },
  {
    name: 'Golden Barrel Cactus',
    desert: {
      form: 'barrel',
      height: 0.82,
      heightV: 0.08,
      radius: 0.62,
      radiusV: 0.04,
      taper: 0.05,
      shoulder: 0.4,
      arms: 0,
      ribs: 34,
      ribDepth: 0.1,
      ribSharpness: 2.4,
      areoleRows: 12,
      areoleColumns: 34,
      spinesPerAreole: 8,
      spineLength: 0.055,
      spineLengthV: 0.3,
      spineSpread: 0.7,
      spineClusterScale: 1.1,
      flower: true,
      flowerScale: 0.14,
      radialSegments: 40,
      bodyRings: 28,
    },
  },
  {
    name: 'Organ Pipe Cactus',
    desert: {
      form: 'organ-pipe',
      height: 4.3,
      heightV: 0.12,
      radius: 0.21,
      radiusV: 0.08,
      taper: 0.1,
      shoulder: 0.2,
      arms: 7,
      armHeight: 0.08,
      armHeightV: 0.18,
      armLength: 2.7,
      armLengthV: 0.18,
      armRadius: 0.18,
      armRadiusV: 0.08,
      armLean: 18,
      armCurve: 6,
      armTaper: 0.14,
      armSpread: 1,
      secondaryArms: 0,
      ribs: 13,
      ribDepth: 0.07,
      ribSharpness: 1.8,
      areoleRows: 18,
      areoleColumns: 13,
      spinesPerAreole: 4,
      spineLength: 0.035,
      spineSpread: 0.4,
      flower: false,
      radialSegments: 32,
      bodyRings: 30,
      armRings: 20,
    },
  },
  {
    name: 'Prickly Pear',
    desert: {
      form: 'prickly-pear',
      height: 1.2,
      heightV: 0.12,
      radius: 0.19,
      radiusV: 0.08,
      arms: 2,
      armHeight: 0.24,
      armHeightV: 0.18,
      armLength: 0.58,
      armLengthV: 0.18,
      armRadius: 0.18,
      armRadiusV: 0.1,
      armLean: 22,
      armCurve: 12,
      armTaper: 0.38,
      armSpread: 0.9,
      secondaryArms: 2,
      padWidth: 0.62,
      padHeight: 0.78,
      padThickness: 0.12,
      padTilt: 22,
      padCount: 7,
      ribs: 0,
      ribDepth: 0,
      areoleRows: 7,
      areoleColumns: 8,
      spinesPerAreole: 3,
      spineLength: 0.02,
      spineLengthV: 0.3,
      spineSpread: 0.8,
      spineClusterScale: 0.8,
      flower: true,
      flowerScale: 0.12,
      radialSegments: 24,
      bodyRings: 18,
      armRings: 10,
    },
  },
  {
    name: 'Agave Americana',
    desert: {
      form: 'agave',
      height: 1.05,
      heightV: 0.1,
      radius: 0.36,
      radiusV: 0.06,
      arms: 0,
      ribs: 0,
      ribDepth: 0,
      rosetteLeaves: 58,
      leafLength: 1.15,
      leafLengthV: 0.16,
      leafWidth: 0.2,
      leafWidthV: 0.14,
      leafThickness: 0.035,
      leafLean: 63,
      leafDroop: 18,
      leafTwist: 13,
      leafSerration: 0.95,
      areoleRows: 0,
      areoleColumns: 0,
      spinesPerAreole: 0,
      flower: false,
      radialSegments: 28,
      bodyRings: 16,
    },
  },
  {
    name: 'Aloe Ferox',
    desert: {
      form: 'aloe',
      height: 0.88,
      heightV: 0.1,
      radius: 0.28,
      radiusV: 0.1,
      arms: 0,
      ribs: 0,
      ribDepth: 0,
      rosetteLeaves: 42,
      leafLength: 0.82,
      leafLengthV: 0.2,
      leafWidth: 0.12,
      leafWidthV: 0.15,
      leafThickness: 0.025,
      leafLean: 46,
      leafDroop: 27,
      leafTwist: 8,
      leafSerration: 0.78,
      areoleRows: 0,
      areoleColumns: 0,
      spinesPerAreole: 0,
      flower: true,
      flowerScale: 0.24,
      radialSegments: 24,
      bodyRings: 14,
    },
  },
  {
    name: 'Ocotillo',
    desert: {
      form: 'ocotillo',
      height: 3.2,
      heightV: 0.14,
      radius: 0.2,
      radiusV: 0.1,
      arms: 12,
      armHeight: 0.04,
      armHeightV: 0.18,
      armLength: 2.55,
      armLengthV: 0.18,
      armRadius: 0.045,
      armRadiusV: 0.2,
      armLean: 28,
      armCurve: 15,
      armTaper: 0.52,
      armSpread: 1,
      secondaryArms: 0,
      ribs: 8,
      ribDepth: 0.035,
      ribSharpness: 1.3,
      areoleRows: 9,
      areoleColumns: 8,
      spinesPerAreole: 1,
      spineLength: 0.025,
      spineLengthV: 0.3,
      spineSpread: 0.5,
      flower: true,
      flowerScale: 0.12,
      radialSegments: 20,
      bodyRings: 22,
      armRings: 18,
    },
  },
];

export const DESERT_GROUP = { label: 'Desert · cacti & succulents', names: DESERT_PRESETS.map((p) => p.name) };

export function desertHeight(d: DesertParams): number {
  if (d.form === 'agave' || d.form === 'aloe') return Math.max(0.05, d.height + d.leafLength * 0.75);
  if (d.form === 'prickly-pear') return Math.max(0.05, d.height + d.padHeight * 0.6);
  return Math.max(0.05, d.height * (1 + d.heightV * 0.5), d.height + d.armLength * (d.form === 'organ-pipe' ? 0.4 : 0.75));
}

export function desertHabit(d: DesertParams): string {
  switch (d.form) {
    case 'barrel':
      return 'solitary barrel';
    case 'prickly-pear':
      return 'segmented pad colony';
    case 'agave':
      return 'basal rosette';
    case 'aloe':
      return 'succulent rosette';
    case 'ocotillo':
      return 'whip-stem shrub';
    case 'organ-pipe':
      return 'clustered column';
    default:
      return 'branched column';
  }
}
