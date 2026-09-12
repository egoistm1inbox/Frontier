/**
 * Desert plant parameters.
 *
 * These are intentionally botanical parameters rather than a generic "tree
 * with fewer branches" preset. The desert mesher uses them to build the
 * characteristic forms of cacti and succulents: ribbed columns, rounded
 * areoles, flattened pads, thick lanceolate leaves and the sparse stems of an
 * ocotillo. Dimensions are metres and angles are degrees.
 */

export type DesertForm = 'saguaro' | 'prickly-pear' | 'agave' | 'barrel' | 'ocotillo' | 'yucca';

export interface DesertParams {
  form: DesertForm;
  /** Plant height, excluding the small root flare below the soil. */
  height: number;
  /** Maximum width across the crown. */
  width: number;
  /** Number of samples across the largest dimension. Higher is more detailed. */
  resolution: number;
  /** Stable radius variation on ribbed cactus bodies. */
  ribCount: number;
  ribDepth: number;
  /** Number of major arms, pads or leaves depending on the form. */
  organs: number;
  /** Fine surface complexity is expressed as extra radial variation, not noise displacement. */
  surfaceDetail: number;
  /** Wind response, kept deliberately small for heavy, water-filled plants. */
  wind: number;
}

export const DESERT_FORMS: Record<DesertForm, string> = {
  saguaro: 'Saguaro cactus',
  'prickly-pear': 'Prickly pear cactus',
  agave: 'Agave rosette',
  barrel: 'Golden barrel cactus',
  ocotillo: 'Ocotillo',
  yucca: 'Joshua tree yucca',
};

/** Production presets. They favour real silhouettes over decorative symmetry. */
export const DESERT_PRESETS: { name: string; desert: DesertParams }[] = [
  {
    name: 'Saguaro Cactus',
    desert: {
      form: 'saguaro',
      height: 5.2,
      width: 2.55,
      resolution: 66,
      ribCount: 12,
      ribDepth: 0.05,
      organs: 3,
      surfaceDetail: 0.65,
      wind: 0.22,
    },
  },
  {
    name: 'Prickly Pear',
    desert: {
      form: 'prickly-pear',
      height: 1.9,
      width: 2.7,
      resolution: 72,
      ribCount: 0,
      ribDepth: 0,
      organs: 17,
      surfaceDetail: 0.8,
      wind: 0.3,
    },
  },
  {
    name: 'Agave Americana',
    desert: {
      form: 'agave',
      height: 1.28,
      width: 2.35,
      resolution: 66,
      ribCount: 0,
      ribDepth: 0,
      organs: 38,
      surfaceDetail: 0.9,
      wind: 0.4,
    },
  },
  {
    name: 'Golden Barrel',
    desert: {
      form: 'barrel',
      height: 1.38,
      width: 1.5,
      resolution: 82,
      ribCount: 24,
      ribDepth: 0.045,
      organs: 0,
      surfaceDetail: 0.9,
      wind: 0.18,
    },
  },
  {
    name: 'Ocotillo',
    desert: {
      form: 'ocotillo',
      height: 4.15,
      width: 2.9,
      resolution: 64,
      ribCount: 0,
      ribDepth: 0,
      organs: 22,
      surfaceDetail: 0.8,
      wind: 0.75,
    },
  },
  {
    name: 'Joshua Tree Yucca',
    desert: {
      form: 'yucca',
      height: 3.4,
      width: 2.25,
      resolution: 66,
      ribCount: 0,
      ribDepth: 0,
      organs: 2,
      surfaceDetail: 0.7,
      wind: 0.55,
    },
  },
];

export function desertHeight(p: DesertParams): number {
  return Math.max(0.1, p.height);
}

export function desertHabit(p: DesertParams): string {
  switch (p.form) {
    case 'saguaro':
      return 'ribbed columnar cactus';
    case 'prickly-pear':
      return 'segmented pad cactus';
    case 'agave':
      return 'armed leaf rosette';
    case 'barrel':
      return 'ribbed globular cactus';
    case 'ocotillo':
      return 'thorny cane shrub';
    case 'yucca':
      return 'branched desert rosette';
  }
}
