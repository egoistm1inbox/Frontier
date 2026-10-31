/**
 * Frontier Studio — Non-Destructive Terrain Layer Stack, Inspector, Preset Shelf & 3D Spline Gizmo UI.
 *
 * Implements the Frontier Editor / ProjectZero 3-column dark studio architecture:
 *   - Left Dock: Layer Stack (newest at TOP, evaluated BOTTOM -> TOP)
 *   - Center Viewport: Derived Surface Shading bar, Authoring Tool bar, 3D Spline Gizmo, Preset Shelf
 *   - Right Dock: Contextual Layer Inspector (identity card, Reads/Writes channels, .tp-property-card controls, B&W Mask)
 */

import {
  BASE_ARCHETYPES,
  COMBINE_MODES,
  DERIVED_FABRICS,
  DERIVED_PALETTES,
  LAYER_CATEGORIES,
  LAYER_OPERATION_SPECS,
  SPLINE_MODES,
  TERRAIN_STACK_PRESETS,
  VEG_SPECIES,
} from './terrain-stack-presets.js';

const SVG_ICONS = {
  mountain: `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 14.5 6.8 6l3.4 5 2.4-3.3L16 14.5H2Z"/></svg>`,
  ridge: `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 13.5 5.5 5l3.5 6 3.5-7 4 9.5"/><path d="M5.5 5l1.6 4.2"/></svg>`,
  strata: `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 5.2h14M2 9h14M2 12.8h14"/><path d="M5 5.2v3.8M12 9v3.8"/></svg>`,
  stacks: `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15V7.5h3.5V15M10.5 15V4.5H14V15M2.5 7.5h6M9.5 4.5h5.5"/></svg>`,
  cliff: `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15V3.5h6.5L7.5 8h4l-2 7H3Z"/><path d="M12.5 6.5h3m-1.2-1.4 1.4 1.4-1.4 1.4"/></svg>`,
  cave: `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 14.5V6.5C2 4.3 5 3 9 3s7 1.3 7 3.5v8h-3.2v-3.6c0-2.1-1.7-3.4-3.8-3.4s-3.8 1.3-3.8 3.4v3.6H2Z"/></svg>`,
  sculpt: `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m11.8 3.2 3 3-7.6 7.6H4.2v-3l7.6-7.6Z"/><path d="M2.5 15.5h13"/></svg>`,
  river: `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2.5c3.5 2.2-2.5 4.6 2 7.2 4.2 2.4 1 4.4 6 5.8"/><path d="M8.5 2.5c2.2 1.8-1 3.5 1.2 5.2"/></svg>`,
  droplet: `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5C9 2.5 4.5 7.7 4.5 11a4.5 4.5 0 0 0 9 0C13.5 7.7 9 2.5 9 2.5Z"/></svg>`,
  talus: `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3.5v11h12L3 3.5Z"/><circle cx="11.5" cy="8.2" r="1"/><circle cx="13.5" cy="11" r="1.1"/></svg>`,
  wind: `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M9 2v14M3 5.5l12 7M15 5.5l-12 7"/></svg>`,
  spline: `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 14c1-5 11-3 12-10"/><circle cx="3" cy="14" r="1.6" fill="currentColor"/><circle cx="15" cy="4" r="1.6" fill="currentColor"/></svg>`,
  boulders: `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="3,13.5 5.5,6.5 11.5,5.5 15,10.5 13,14.5 4.5,14.5"/></svg>`,
  grass: `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M9 15V5M6 15c0-3.8-1.5-6.2-3.5-7.8M12 15c0-3.8 1.5-6.2 3.5-7.8"/></svg>`,
  eyeOpen: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8s-2.4 4.2-6.5 4.2S1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="1.9"/></svg>`,
  eyeClosed: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 2l12 12M3.2 5.6C2.1 6.8 1.5 8 1.5 8s2.4 4.2 6.5 4.2c1.4 0 2.6-.4 3.6-1M6.6 3.9A7 7 0 0 1 8 3.8c4.1 0 6.5 4.2 6.5 4.2a11 11 0 0 1-1.8 2.4"/></svg>`,
  mask: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11V2.5Z" fill="currentColor"/></svg>`,
};

const OP_DESCRIPTIONS = {
  'base-landform': 'Constructs foundational bedrock elevation and base rock competency at the bottom of the stack.',
  'mountain-ridges': 'Adds, subtracts, or blends procedural ridges, plateaus, fault escarpments, dunes, or craters.',
  'stratigraphic-beds': 'Carves dipping sedimentary bed benches, 3D caprock overhangs, and differential rock hardness.',
  'rock-stacks': 'Synthesizes Slate-style tiered, leaning boulder tors and mushroom caprock columns.',
  'cliff-push-pull': 'Applies 3D lateral crag buttress and ledge overhang vector displacement on steep faces.',
  'sdf-caves': 'Subtracts real 3D volumetric karst cave tunnels and cliff-base undercuts using boolean SDFs.',
  'sculpt-layer': 'Stores non-destructive 3D brush edits (add/remove height & carve/fill 3D caves) separately from procedural layers.',
  'river-incision': 'Integrates catchment drainage discharge and carves bedrock gorges weighted by 3D rock hardness.',
  'hydraulic-erosion': 'Simulates rainfall runoff detachment, sediment capacity transport, and piedmont alluvial fans.',
  'thermal-talus': 'Spalls over-steepened cliff faces and relaxes loose scree cones to their angle of repose.',
  'aeolian-glacial': 'Simulates alpine snowpack & cirque glacier plucking or windward sand saltation.',
  'spline-feature': 'Steers an interactive 3D control spline to cut canyon gorges, grade switchback roads, or excavate lakes.',
  'rock-placement': 'Distributes gravity-settled 3D loose boulders across cliff toes and crowns (distinct from bedrock landforms).',
  'vegetation-placement': 'Instantiates up to 44,000 real 3D multi-blade grass tufts masked by slope, elevation, snow, and water.',
};

// Complete Inspector Control Schema per Layer Type (1:1 aligned with canonical generators & conservative physics)
const INSPECTOR_SCHEMAS = {
  'base-landform': {
    selects: [
      { key: 'archetype', label: 'Landform Generator', options: Object.values(BASE_ARCHETYPES).map((o) => ({ value: o.id, label: o.label })) },
    ],
    sliders: [
      { key: 'relief', label: 'Vertical Relief', min: 55, max: 260, step: 1, fmt: (v) => `${Math.round(v)} m` },
      { key: 'roughness', label: 'Tectonic Roughness', min: 0.05, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
    ],
    hasSeed: true,
  },
  'mountain-ridges': {
    selects: [
      {
        key: 'generator',
        label: 'Landform Generator',
        options: [
          { value: 0, label: 'Sharp Arête Ridges & Spurs' },
          { value: 1, label: 'Flat-Topped Mesa / Plateau' },
          { value: 2, label: 'Tectonic Fault Escarpment' },
          { value: 3, label: 'Asymmetric Aeolian Dunes' },
          { value: 4, label: 'Impact Crater Bowl & Rim' },
        ],
      },
      { key: 'combineMode', label: 'Combine Operation', options: Object.values(COMBINE_MODES).map((o) => ({ value: o.id, label: o.label })) },
    ],
    sliders: [
      { key: 'amplitude', label: 'Elevation Amplitude', min: 8, max: 160, step: 1, fmt: (v) => `${Math.round(v)} m` },
      { key: 'scale', label: 'Spatial Frequency', min: 0.6, max: 5.0, step: 0.05, fmt: (v) => `${Number(v).toFixed(2)}×` },
      { key: 'sharpness', label: 'Crest / Rim Sharpness', min: 0.05, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'azimuth', label: 'Strike / Wind Azimuth', min: -180, max: 180, step: 1, fmt: (v) => `${Math.round(v)}°` },
      { key: 'opacity', label: 'Layer Blend Weight', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
    ],
    hasSeed: true,
  },
  'stratigraphic-beds': {
    selects: [],
    sliders: [
      { key: 'rockHardness', label: 'Base Rock Hardness', min: 0.08, max: 0.96, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'strataStrength', label: '3D Strata Contrast', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'strataFreq', label: 'Stratigraphic Bed Count', min: 2, max: 24, step: 0.5, fmt: (v) => `${Number(v).toFixed(1)} beds` },
      { key: 'strataDip', label: 'Bedding Dip Angle', min: 0, max: 45, step: 1, fmt: (v) => `${Math.round(v)}°` },
      { key: 'strataStrike', label: 'Strike Azimuth', min: -180, max: 180, step: 1, fmt: (v) => `${Math.round(v)}°` },
      { key: 'faultWeakness', label: 'Fracture & Fault Weakness', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'terraceCarve', label: 'Geometric Terrace Carve', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'ledgeOverhang', label: '3D Caprock Ledge Overhang', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'opacity', label: 'Layer Blend Weight', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
    ],
    hasSeed: true,
  },
  'rock-stacks': {
    selects: [],
    sliders: [
      { key: 'height', label: 'Stack / Tor Height', min: 12, max: 115, step: 1, fmt: (v) => `${Math.round(v)} m` },
      { key: 'spacing', label: 'Cluster Spacing', min: 32, max: 140, step: 1, fmt: (v) => `${Math.round(v)} m` },
      { key: 'radius', label: 'Column Base Radius', min: 6, max: 38, step: 0.5, fmt: (v) => `${Number(v).toFixed(1)} m` },
      { key: 'tiers', label: 'Stacked Bedding Tiers', min: 2, max: 9, step: 1, fmt: (v) => `${Math.round(v)} tiers` },
      { key: 'taper', label: 'Pillar Taper', min: 0.05, max: 0.9, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'caprockOverhang', label: '3D Caprock Overhang', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'lean', label: '3D Column Lean', min: 0.0, max: 0.85, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'leanAzimuth', label: 'Lean Direction', min: -180, max: 180, step: 1, fmt: (v) => `${Math.round(v)}°` },
      { key: 'opacity', label: 'Layer Blend Weight', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
    ],
    hasSeed: true,
  },
  'cliff-push-pull': {
    selects: [],
    sliders: [
      { key: 'displacement', label: '3D Push–Pull Amplitude', min: 0, max: 26, step: 0.5, fmt: (v) => `${Number(v).toFixed(1)} m` },
      { key: 'featureScale', label: 'Buttress & Crag Scale', min: 0.8, max: 5.5, step: 0.1, fmt: (v) => `${Number(v).toFixed(1)}×` },
      { key: 'slopeThreshold', label: 'Minimum Cliff Slope', min: 14, max: 54, step: 1, fmt: (v) => `${Math.round(v)}°` },
      { key: 'ledgeStrength', label: 'Stepped Ledge Ribs', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'overhangBias', label: 'Outward Overhang Bias', min: -0.4, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'verticalCrease', label: 'Vertical Fracture Chutes', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'opacity', label: 'Layer Blend Weight', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
    ],
    hasSeed: true,
  },
  'sdf-caves': {
    selects: [],
    sliders: [
      { key: 'carveDepth', label: '3D Cave Carve Depth', min: 4, max: 36, step: 0.5, fmt: (v) => `${Number(v).toFixed(1)} m` },
      { key: 'undercutStrength', label: 'Cliff Undercut Strength', min: 0.0, max: 1.2, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'archHeight', label: 'Portal Arch Height', min: 6, max: 30, step: 0.5, fmt: (v) => `${Number(v).toFixed(1)} m` },
      { key: 'tunnelScale', label: 'Cave Network Frequency', min: 0.8, max: 4.5, step: 0.1, fmt: (v) => `${Number(v).toFixed(1)}×` },
      { key: 'elevationCenter', label: 'Cliff Band Elevation', min: 0.1, max: 0.85, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'elevationBand', label: 'Vertical Horizon Span', min: 0.1, max: 0.65, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'slopeMin', label: 'Cliff Face Slope Gate', min: 14, max: 48, step: 1, fmt: (v) => `${Math.round(v)}°` },
      { key: 'ribRoughness', label: 'Bedding Rib Roughness', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'opacity', label: 'Cave Carve Strength', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
    ],
    hasSeed: true,
  },
  'sculpt-layer': {
    selects: [],
    sliders: [
      { key: 'brushRadius', label: 'Sculpt / Cave Brush Radius', min: 8, max: 96, step: 1, fmt: (v) => `${Math.round(v)} m` },
      { key: 'brushStrength', label: 'Stamp Strength', min: 0.1, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'caveHeightOffset', label: '3D Cave Depth Below Surface', min: 2, max: 24, step: 0.5, fmt: (v) => `${Number(v).toFixed(1)} m` },
      { key: 'opacity', label: 'Layer Contribution', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
    ],
    hasSeed: false,
  },
  'river-incision': {
    selects: [],
    sliders: [
      { key: 'iterations', label: 'Drainage Solver Passes', min: 2, max: 80, step: 1, fmt: (v) => `${Math.round(v)} passes` },
      { key: 'incisionStrength', label: 'Gorge Cutting Power', min: 0.05, max: 1.4, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'headwaterRain', label: 'Catchment Runoff Supply', min: 0.05, max: 1.3, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'basinPooling', label: 'Channel & Basin Water Fill', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'hardnessRespect', label: '3D Strata Hardness Respect', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
    ],
    hasSeed: false,
  },
  'hydraulic-erosion': {
    selects: [],
    sliders: [
      { key: 'bakeSteps', label: 'Stack Bake Steps', min: 0, max: 120, step: 2, fmt: (v) => (v > 0 ? `${Math.round(v)} steps` : 'Live sim') },
      { key: 'rainIntensity', label: 'Rainfall Intensity', min: 0.0, max: 1.2, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'erosionStrength', label: 'Hydraulic Detachment', min: 0.05, max: 1.3, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'sedimentCapacity', label: 'Sediment Capacity', min: 0.05, max: 1.4, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'depositionRate', label: 'Alluvial Deposition', min: 0.05, max: 1.2, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'evaporation', label: 'Evaporation Rate', min: 0.01, max: 0.60, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'headwaterFlow', label: 'River / Spring Discharge', min: 0.0, max: 1.2, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'lakeRetention', label: 'Basin Lake Retention', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
    ],
    hasSeed: false,
  },
  'thermal-talus': {
    selects: [],
    sliders: [
      { key: 'bakePasses', label: 'Stack Bake Passes', min: 0, max: 80, step: 2, fmt: (v) => (v > 0 ? `${Math.round(v)} passes` : 'Live sim') },
      { key: 'talusAngle', label: 'Angle of Repose', min: 0.30, max: 1.10, step: 0.02, fmt: (v) => `${Math.round((Math.atan(v) * 180) / Math.PI)}°` },
      { key: 'rockfallRate', label: 'Cliff Spalling & Rockfall', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
    ],
    hasSeed: false,
  },
  'aeolian-glacial': {
    selects: [],
    sliders: [
      { key: 'bakePasses', label: 'Stack Bake Passes', min: 0, max: 64, step: 2, fmt: (v) => (v > 0 ? `${Math.round(v)} passes` : 'Live sim') },
      { key: 'snowline', label: 'Snowline Elevation', min: 0.05, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'snowfallRate', label: 'Snowfall Rate', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'glacierStrength', label: 'Glacier Ice Strength', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'iceMeltRate', label: 'Glacial Meltwater Recharge', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'windSpeed', label: 'Wind Speed & Saltation', min: 0.0, max: 1.2, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'windAzimuth', label: 'Prevailing Wind Azimuth', min: -180, max: 180, step: 1, fmt: (v) => `${Math.round(v)}°` },
      { key: 'dryAeolianMode', label: 'Arid Erg Regime', min: 0.0, max: 1.0, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    ],
    hasSeed: false,
  },
  'spline-feature': {
    selects: [
      { key: 'mode', label: 'Spline Corridor Operation', options: Object.values(SPLINE_MODES).map((o) => ({ value: o.id, label: o.label })) },
    ],
    sliders: [
      { key: 'width', label: 'Corridor / Basin Width', min: 10, max: 130, step: 1, fmt: (v) => `${Math.round(v)} m` },
      { key: 'depth', label: 'Incision / Excavation Depth', min: 4, max: 110, step: 1, fmt: (v) => `${Math.round(v)} m` },
      { key: 'wallSteepness', label: 'Wall / Cut Slope Steepness', min: 0.1, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'meanderAmp', label: 'Natural Wall Perturbation', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'waterFill', label: 'River / Lake Water Level', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'bankFalloff', label: 'Embankment Grading Width', min: 0.1, max: 1.2, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'opacity', label: 'Layer Blend Weight', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
    ],
    hasSeed: false,
  },
  'rock-placement': {
    selects: [],
    sliders: [
      { key: 'density', label: '3D Boulder Scatter Density', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'talusAffinity', label: 'Cliff-Toe & Rockfall Rate', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'settleSteps', label: 'Pre-Settle Tumble Steps', min: 0, max: 56, step: 2, fmt: (v) => `${Math.round(v)} steps` },
    ],
    hasSeed: true,
  },
  'vegetation-placement': {
    selects: [
      { key: 'species', label: '3D Plant Species', options: Object.values(VEG_SPECIES).map((o) => ({ value: o.id, label: o.label })) },
    ],
    sliders: [
      { key: 'density', label: '3D Tuft Scatter Density', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'bladeHeight', label: '3D Blade Height', min: 0.4, max: 2.4, step: 0.05, fmt: (v) => `${Number(v).toFixed(2)} m` },
      { key: 'slopeMax', label: 'Maximum Slope Cutoff', min: 0.20, max: 1.30, step: 0.02, fmt: (v) => `${Math.round((Math.atan(v) * 180) / Math.PI)}°` },
      { key: 'elevationMax', label: 'Treeline / Meadow Ceiling', min: 0.15, max: 0.98, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'patchiness', label: 'Meadow Clumping', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: 'windSway', label: 'Wind Gust Sway', min: 0.0, max: 1.4, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    ],
    hasSeed: true,
  },
};

function summarizeLayer(layer) {
  const spec = LAYER_OPERATION_SPECS[layer.type];
  if (spec && typeof spec.summary === 'function') {
    return spec.summary(layer.params);
  }
  return '';
}

export class ErosionLayerStackUI {
  constructor(engine, opts = {}) {
    this.engine = engine;
    this.pipeline = engine.pipeline;
    this.onPresetChanged = opts.onPresetChanged || null;
    this.searchQuery = '';
    this.addMenuOpen = false;
    this.shelfOpen = true;
    this.dragFromIdx = null;
    this.draggingSplinePt = -1;

    // Bind callbacks from engine
    this.engine.onStackMutated = () => {
      this.renderStackList();
      this.renderInspector();
    };
    this.engine.onFrameRendered = () => {
      this.updateSplineGizmoOverlay();
    };

    this._cacheDom();
    this._bindGlobalEvents();
    this.renderAll();
  }

  _cacheDom() {
    this.elList = document.getElementById('tp-layer-list');
    this.elCountBadge = document.getElementById('tp-layer-count');
    this.elStatVisible = document.getElementById('tp-stat-visible');
    this.elStatHidden = document.getElementById('tp-stat-hidden');
    this.elSearch = document.getElementById('tp-layer-search-input');
    this.elAddBtn = document.getElementById('tp-btn-add-layer');
    this.elAddMenu = document.getElementById('tp-add-layer-menu');
    this.elInspector = document.getElementById('tp-inspector-content');
    this.elPresetGrid = document.getElementById('cb-preset-grid');
    this.elShelfDrawer = document.getElementById('cb-shelf-drawer');
    this.elShelfToggle = document.getElementById('cb-btn-toggle');
    this.elDocTitle = document.getElementById('tp-doc-title');
    this.elSceneCaption = document.getElementById('tp-scene-caption');
    this.elShadingSelect = document.getElementById('tp-select-shading');
    this.elPaletteSelect = document.getElementById('tp-select-palette');
    this.elAuthorTools = document.getElementById('tp-author-tools');
    this.elSplineSvg = document.getElementById('spline-gizmo-svg');
  }

  _bindGlobalEvents() {
    if (this.elSearch) {
      this.elSearch.addEventListener('input', () => {
        this.searchQuery = this.elSearch.value.trim().toLowerCase();
        this.renderStackList();
      });
    }

    if (this.elAddBtn && this.elAddMenu) {
      this._buildAddLayerMenu();
      this.elAddBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.addMenuOpen = !this.addMenuOpen;
        this.elAddMenu.hidden = !this.addMenuOpen;
      });
      document.addEventListener('click', (e) => {
        if (this.addMenuOpen && !this.elAddMenu.contains(e.target) && e.target !== this.elAddBtn) {
          this.addMenuOpen = false;
          this.elAddMenu.hidden = true;
        }
      });
    }

    if (this.elShelfToggle && this.elShelfDrawer) {
      this.elShelfToggle.addEventListener('click', () => {
        this.shelfOpen = !this.shelfOpen;
        this.elShelfDrawer.hidden = !this.shelfOpen;
        this.elShelfToggle.classList.toggle('open', this.shelfOpen);
      });
    }

    if (this.elShadingSelect) {
      this.elShadingSelect.addEventListener('change', () => {
        this.pipeline.shadingMode = Number(this.elShadingSelect.value);
        this.renderInspector();
      });
    }

    if (this.elPaletteSelect) {
      this.elPaletteSelect.innerHTML = Object.values(DERIVED_PALETTES).map(
        (p) => `<option value="${p.id}">${p.label}</option>`
      ).join('');
      this.elPaletteSelect.value = String(this.pipeline.paletteId);
      this.elPaletteSelect.addEventListener('change', () => {
        this.pipeline.paletteId = Number(this.elPaletteSelect.value);
      });
    }

    if (this.elAuthorTools) {
      this.elAuthorTools.querySelectorAll('button[data-tool]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.setAuthorTool(btn.dataset.tool);
        });
      });
    }

    this._bindSplineGizmoEvents();
  }

  setAuthorTool(tool) {
    this.pipeline.authorTool = tool;
    if (this.elAuthorTools) {
      this.elAuthorTools.querySelectorAll('button[data-tool]').forEach((b) => {
        b.classList.toggle('active', b.dataset.tool === tool);
      });
    }
    // Automatically select or highlight relevant layer when entering spline or sculpt tool
    if (tool === 'spline-edit') {
      const sel = this.pipeline.getSelectedLayer();
      if (!sel || sel.type !== 'spline-feature') {
        const sp = this.pipeline.layers.find((l) => l.type === 'spline-feature');
        if (sp) {
          this.pipeline.selectedLayerId = sp.id;
          this.renderStackList();
          this.renderInspector();
        }
      }
    } else if (tool.startsWith('sculpt-') || tool.startsWith('cave-')) {
      const sel = this.pipeline.getSelectedLayer();
      if (!sel || sel.type !== 'sculpt-layer') {
        const sc = this.pipeline.layers.find((l) => l.type === 'sculpt-layer');
        if (sc) {
          this.pipeline.selectedLayerId = sc.id;
          this.renderStackList();
          this.renderInspector();
        }
      }
    }
    this.updateSplineGizmoOverlay();
  }

  _buildAddLayerMenu() {
    const groups = [
      { id: 'landform', title: '1. Landform & 3D SDF Geometry' },
      { id: 'simulation', title: '2. Simulation & Erosion Passes' },
      { id: 'spline', title: '3. Spatial Spline Features' },
      { id: 'rocks', title: '4. Loose Rock Placement' },
      { id: 'vegetation', title: '5. 3D Vegetation Placement' },
    ];
    let html = '';
    for (const g of groups) {
      const specs = Object.values(LAYER_OPERATION_SPECS).filter(
        (s) => s.category === g.id && s.type !== 'base-landform'
      );
      if (!specs.length) continue;
      html += `<div class="tp-menu-group"><div class="tp-menu-heading">${g.title}</div>`;
      for (const s of specs) {
        const cat = LAYER_CATEGORIES[s.category];
        const desc = OP_DESCRIPTIONS[s.type] || '';
        html += `
          <button type="button" class="tp-menu-item" data-add-type="${s.type}">
            <span class="tp-menu-dot" style="background:${cat.color}"></span>
            <span class="tp-menu-item-body">
              <strong>${s.defaultName}</strong>
              <small>${desc}</small>
            </span>
          </button>`;
      }
      html += `</div>`;
    }
    this.elAddMenu.innerHTML = html;
    this.elAddMenu.querySelectorAll('button[data-add-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.addType;
        this.addMenuOpen = false;
        this.elAddMenu.hidden = true;
        this.pipeline.addLayer(type);
        if (type === 'sculpt-layer') this.setAuthorTool('sculpt-add');
        else if (type === 'spline-feature') this.setAuthorTool('spline-edit');
        this.renderAll();
      });
    });
  }

  renderAll() {
    if (this.elDocTitle) this.elDocTitle.textContent = this.pipeline.projectTitle;
    if (this.elPaletteSelect) this.elPaletteSelect.value = String(this.pipeline.paletteId);
    if (this.elShadingSelect) this.elShadingSelect.value = String(this.pipeline.shadingMode);
    this.renderStackList();
    this.renderInspector();
    this.renderPresetShelf();
    this.updateSceneCaption();
    this.updateSplineGizmoOverlay();
  }

  updateSceneCaption() {
    if (!this.elSceneCaption) return;
    const enabledCount = this.pipeline.layers.filter((l) => l.enabled).length;
    const caveTris = Math.round(this.pipeline.caveSystem.vertexCount / 3);
    this.elSceneCaption.textContent =
      `PIPELINE · ${enabledCount}/${this.pipeline.layers.length} ACTIVE PASSES (BOTTOM → TOP) · ` +
      `${this.pipeline.lastEvalMs.toFixed(1)} MS` +
      (caveTris > 0 ? ` · ${caveTris.toLocaleString()} SDF CAVE TRIS` : '');
  }

  renderStackList() {
    if (!this.elList) return;
    const layers = this.pipeline.layers;
    const visCount = layers.filter((l) => l.enabled).length;
    const hidCount = layers.length - visCount;

    if (this.elCountBadge) this.elCountBadge.textContent = String(layers.length);
    if (this.elStatVisible) this.elStatVisible.textContent = String(visCount);
    if (this.elStatHidden) this.elStatHidden.textContent = String(hidCount);

    let html = '';
    layers.forEach((layer, idx) => {
      const spec = LAYER_OPERATION_SPECS[layer.type] || LAYER_OPERATION_SPECS['mountain-ridges'];
      const cat = LAYER_CATEGORIES[spec.category] || LAYER_CATEGORIES.landform;
      const summary = summarizeLayer(layer);
      const specLabel = spec.defaultName || layer.type;
      if (
        this.searchQuery &&
        !layer.name.toLowerCase().includes(this.searchQuery) &&
        !specLabel.toLowerCase().includes(this.searchQuery) &&
        !summary.toLowerCase().includes(this.searchQuery)
      ) {
        return;
      }

      const isSelected = layer.id === this.pipeline.selectedLayerId;
      const evalOrderNum = layers.length - idx; // 1 = bottom foundation, N = top final pass
      const iconSvg = SVG_ICONS[spec.glyph] || SVG_ICONS.mountain;
      const hasMask = layer.mask && layer.mask.enabled;
      const supportsMask = layer.type !== 'base-landform';

      html += `
        <div class="tp-layer-item-wrap" data-layer-id="${layer.id}" data-idx="${idx}">
          <div class="tp-layer-row ${isSelected ? 'selected' : ''} ${layer.enabled ? '' : 'muted'}"
               draggable="${layer.locked ? 'false' : 'true'}"
               data-select-id="${layer.id}" data-idx="${idx}">
            <span class="tp-drag-grip" title="Drag to reorder pipeline stage (Bottom → Top)">⋮⋮</span>
            <span class="tp-layer-icon" style="--cat-accent:${cat.color}">
              ${iconSvg}
            </span>
            <div class="tp-layer-meta">
              <div class="tp-layer-title-line">
                <span class="tp-layer-name">${this._esc(layer.name)}</span>
                <span class="tp-step-pill" title="Evaluated at step #${evalOrderNum} from bottom">#${evalOrderNum}</span>
              </div>
              <div class="tp-layer-sub">${this._esc(summary)}</div>
            </div>
            <div class="tp-layer-controls">
              ${
                supportsMask
                  ? `<button type="button" class="tp-icon-btn ${hasMask ? 'mask-on' : ''}" data-toggle-mask="${layer.id}" title="${hasMask ? 'Disable B&W spatial mask' : 'Add B&W spatial mask'}">${SVG_ICONS.mask}</button>`
                  : ''
              }
              <button type="button" class="tp-icon-btn ${layer.enabled ? 'vis-on' : 'vis-off'}" data-toggle-vis="${layer.id}" title="${layer.enabled ? 'Mute pass' : 'Enable pass'}">
                ${layer.enabled ? SVG_ICONS.eyeOpen : SVG_ICONS.eyeClosed}
              </button>
            </div>
          </div>
          ${
            hasMask
              ? `<div class="tp-mask-row ${isSelected ? 'selected' : ''}" data-select-mask="${layer.id}">
                   <span class="tp-mask-chip">B&amp;W MASK</span>
                   <span class="tp-mask-desc">${layer.mask.mode.toUpperCase()} [${Math.round(layer.mask.min * 100)}–${Math.round(layer.mask.max * 100)}%]${layer.mask.invert ? ' · INV' : ''}</span>
                   <button type="button" class="tp-mask-eye ${this.pipeline.shadingMode === 5 && isSelected ? 'active' : ''}" data-preview-mask="${layer.id}" title="Inspect B&W Mask on 3D Terrain">B&amp;W</button>
                 </div>`
              : ''
          }
          ${
            isSelected
              ? `<div class="tp-layer-actions">
                   <button type="button" data-move-up="${idx}" ${idx === 0 ? 'disabled' : ''} title="Move later in pipeline (up)">↑ Up</button>
                   <button type="button" data-move-down="${idx}" ${idx >= layers.length - 1 ? 'disabled' : ''} title="Move earlier in pipeline (down)">↓ Down</button>
                   ${!layer.locked ? `<button type="button" data-dup="${layer.id}" title="Duplicate layer">Duplicate</button>` : ''}
                   ${!layer.locked ? `<button type="button" class="danger" data-del="${layer.id}" title="Delete layer">Delete</button>` : '<span class="tp-locked-tag">Foundation</span>'}
                 </div>`
              : ''
          }
        </div>
      `;
    });

    this.elList.innerHTML = html;

    // Bind row selection, visibility, mask, reorder & drag-and-drop
    this.elList.querySelectorAll('[data-select-id]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        this.pipeline.selectedLayerId = row.dataset.selectId;
        if (this.pipeline.shadingMode === 5) {
          this.pipeline.evaluateStack({ reseedPlacements: false, fastPreview: true });
        }
        this.renderStackList();
        this.renderInspector();
        this.updateSplineGizmoOverlay();
      });

      // HTML5 Drag-and-Drop Reordering
      row.addEventListener('dragstart', (e) => {
        this.dragFromIdx = Number(row.dataset.idx);
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        this.elList.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        row.classList.add('drop-target');
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('drop-target');
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drop-target');
        const toIdx = Number(row.dataset.idx);
        if (this.dragFromIdx !== null && this.dragFromIdx !== toIdx) {
          this.pipeline.moveLayer(this.dragFromIdx, toIdx);
          this.dragFromIdx = null;
          this.renderAll();
        }
      });
    });

    this.elList.querySelectorAll('[data-toggle-vis]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const l = this.pipeline.layers.find((x) => x.id === btn.dataset.toggleVis);
        if (!l) return;
        l.enabled = !l.enabled;
        this.pipeline.evaluateStack({ reseedPlacements: true });
        this.renderAll();
      });
    });

    this.elList.querySelectorAll('[data-toggle-mask]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const l = this.pipeline.layers.find((x) => x.id === btn.dataset.toggleMask);
        if (!l || !l.mask) return;
        l.mask.enabled = !l.mask.enabled;
        this.pipeline.selectedLayerId = l.id;
        this.pipeline.evaluateStack({ reseedPlacements: false });
        this.renderAll();
      });
    });

    this.elList.querySelectorAll('[data-preview-mask]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pipeline.selectedLayerId = btn.dataset.previewMask;
        this.pipeline.shadingMode = this.pipeline.shadingMode === 5 ? 0 : 5;
        if (this.elShadingSelect) this.elShadingSelect.value = String(this.pipeline.shadingMode);
        this.pipeline.evaluateStack({ reseedPlacements: false, fastPreview: true });
        this.renderAll();
      });
    });

    this.elList.querySelectorAll('[data-move-up]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.moveUp);
        this.pipeline.moveLayer(idx, idx - 1);
        this.renderAll();
      });
    });

    this.elList.querySelectorAll('[data-move-down]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.moveDown);
        this.pipeline.moveLayer(idx, idx + 1);
        this.renderAll();
      });
    });

    this.elList.querySelectorAll('[data-dup]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.pipeline.duplicateLayer(btn.dataset.dup);
        this.renderAll();
      });
    });

    this.elList.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.pipeline.deleteLayer(btn.dataset.del);
        this.renderAll();
      });
    });

    this.updateSceneCaption();
  }

  renderInspector() {
    if (!this.elInspector) return;
    const layer = this.pipeline.getSelectedLayer();
    if (!layer) {
      this.elInspector.innerHTML = `<div class="tp-empty-state">Select a layer in the stack to inspect its parameters and spatial mask.</div>`;
      return;
    }

    const layers = this.pipeline.layers;
    const idx = layers.indexOf(layer);
    const stepNum = layers.length - idx;
    const spec = LAYER_OPERATION_SPECS[layer.type] || LAYER_OPERATION_SPECS['mountain-ridges'];
    const cat = LAYER_CATEGORIES[spec.category] || LAYER_CATEGORIES.landform;
    const schema = INSPECTOR_SCHEMAS[layer.type] || { selects: [], sliders: [], hasSeed: false };
    const iconSvg = SVG_ICONS[spec.glyph] || SVG_ICONS.mountain;
    const specLabel = spec.defaultName || layer.type;
    const specDesc = OP_DESCRIPTIONS[layer.type] || '';
    const supportsMask = layer.type !== 'base-landform';

    const readsBadges = (spec.reads.length ? spec.reads : ['domain XZ']).map((r) => `<span class="tp-io-pill read">R: ${r}</span>`).join('');
    const writesBadges = spec.writes.map((w) => `<span class="tp-io-pill write">W: ${w}</span>`).join('');

    let controlsHtml = '';
    for (const sel of schema.selects) {
      const curVal = layer.params[sel.key] ?? 0;
      controlsHtml += `
        <label class="tp-field-row">
          <span>${sel.label}</span>
          <select class="tp-select" data-param-select="${sel.key}">
            ${sel.options.map((o) => `<option value="${o.value}" ${Number(curVal) === Number(o.value) ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </label>`;
    }

    for (const sl of schema.sliders) {
      const val = layer.params[sl.key] ?? sl.min;
      const pct = Math.max(0, Math.min(100, ((val - sl.min) / Math.max(1e-6, sl.max - sl.min)) * 100));
      controlsHtml += `
        <div class="tp-control-row">
          <div class="tp-control-label">
            <span>${sl.label}</span>
          </div>
          <div class="tp-amount" style="--fill:${pct.toFixed(1)}%">
            <input type="range" min="${sl.min}" max="${sl.max}" step="${sl.step}" value="${val}" data-param-slider="${sl.key}" />
            <output data-param-out="${sl.key}">${sl.fmt(val)}</output>
          </div>
        </div>`;
    }

    if (schema.hasSeed) {
      controlsHtml += `
        <div class="tp-seed-bar">
          <span>Procedural Seed</span>
          <div class="tp-seed-controls">
            <input type="number" class="tp-seed-input" value="${layer.params.seed ?? 4029}" data-param-seed="seed" />
            <button type="button" class="tp-mini-btn" data-random-seed="1">Randomize</button>
          </div>
        </div>`;
    }

    // Contextual Authoring Card for Sculpt Layer or Spline Layer
    let authoringCardHtml = '';
    if (layer.type === 'sculpt-layer') {
      const curT = this.pipeline.authorTool;
      authoringCardHtml = `
        <section class="tp-property-card">
          <h2><i style="background:${cat.color}"></i><span>Non-Destructive Sculpt Brushes</span></h2>
          <p class="tp-card-note">Paint directly on the 3D terrain. Edits are stored inside this Sculpt Layer so procedural landforms below remain 100% editable.</p>
          <div class="tp-brush-grid">
            <button type="button" class="${curT === 'sculpt-add' ? 'active' : ''}" data-set-tool="sculpt-add">+ Raise</button>
            <button type="button" class="${curT === 'sculpt-remove' ? 'active' : ''}" data-set-tool="sculpt-remove">− Carve</button>
            <button type="button" class="${curT === 'sculpt-smooth' ? 'active' : ''}" data-set-tool="sculpt-smooth">≈ Smooth</button>
            <button type="button" class="${curT === 'cave-carve' ? 'active' : ''}" data-set-tool="cave-carve">◔ Carve 3D Cave</button>
            <button type="button" class="${curT === 'cave-fill' ? 'active' : ''}" data-set-tool="cave-fill">● Fill 3D Cave</button>
            <button type="button" class="${curT === 'navigate' ? 'active' : ''}" data-set-tool="navigate">Orbit / Fly</button>
          </div>
          <div class="tp-card-footer-btns">
            <button type="button" class="tp-mini-btn danger" id="tp-btn-clear-sculpt">Clear Layer Strokes (${layer.params.strokeCount || 0})</button>
          </div>
        </section>`;
    } else if (layer.type === 'spline-feature') {
      const pts = layer.params.points || [];
      const spModeLabel = SPLINE_MODES[layer.params.mode ?? 0]?.label || 'canyon cut';
      authoringCardHtml = `
        <section class="tp-property-card">
          <h2><i style="background:${cat.color}"></i><span>3D Spline Control Path (${pts.length}/8 pts)</span></h2>
          <p class="tp-card-note">Drag gold control handles directly on the 3D viewport to steer this ${spModeLabel.toLowerCase()}.</p>
          <div class="tp-card-footer-btns">
            <button type="button" class="tp-mini-btn ${this.pipeline.authorTool === 'spline-edit' ? 'active' : ''}" data-set-tool="spline-edit">Edit Points in Viewport</button>
            <button type="button" class="tp-mini-btn" id="tp-btn-add-spline-pt" ${pts.length >= 8 ? 'disabled' : ''}>+ Append Point</button>
            <button type="button" class="tp-mini-btn" id="tp-btn-pop-spline-pt" ${pts.length <= 2 ? 'disabled' : ''}>− Remove Last</button>
          </div>
        </section>`;
    }

    // Black & White Spatial Mask Card
    let maskCardHtml = '';
    if (supportsMask && layer.mask) {
      const m = layer.mask;
      const pctMin = (m.min * 100).toFixed(1);
      const pctMax = (m.max * 100).toFixed(1);
      const pctFeat = ((m.feather / 0.5) * 100).toFixed(1);
      maskCardHtml = `
        <section class="tp-property-card">
          <div class="tp-card-head-row">
            <h2><i style="background:#d9b281"></i><span>Black &amp; White Spatial Mask</span></h2>
            <div class="tp-mask-head-actions">
              <button type="button" class="tp-mini-btn ${this.pipeline.shadingMode === 5 ? 'active' : ''}" id="tp-btn-inspect-mask">B&amp;W View</button>
              <label class="tp-switch">
                <input type="checkbox" id="tp-chk-mask-enabled" ${m.enabled ? 'checked' : ''} />
                <span>${m.enabled ? 'On' : 'Off'}</span>
              </label>
            </div>
          </div>
          <div class="tp-mask-controls ${m.enabled ? '' : 'disabled-group'}">
            <label class="tp-field-row">
              <span>Mask Driver</span>
              <select class="tp-select" id="tp-mask-mode">
                <option value="height" ${m.mode === 'height' ? 'selected' : ''}>Elevation Band</option>
                <option value="slope" ${m.mode === 'slope' ? 'selected' : ''}>Slope Steepness</option>
                <option value="flow" ${m.mode === 'flow' ? 'selected' : ''}>Drainage Flow</option>
                <option value="concavity" ${m.mode === 'concavity' ? 'selected' : ''}>Concavity / Hollows</option>
                <option value="radial" ${m.mode === 'radial' ? 'selected' : ''}>Radial Distance</option>
                <option value="noise" ${m.mode === 'noise' ? 'selected' : ''}>Procedural Noise</option>
              </select>
            </label>
            <div class="tp-control-row">
              <div class="tp-control-label"><span>Range Min</span></div>
              <div class="tp-amount" style="--fill:${pctMin}%">
                <input type="range" min="0" max="1" step="0.01" value="${m.min}" data-mask-slider="min" />
                <output data-mask-out="min">${Math.round(m.min * 100)}%</output>
              </div>
            </div>
            <div class="tp-control-row">
              <div class="tp-control-label"><span>Range Max</span></div>
              <div class="tp-amount" style="--fill:${pctMax}%">
                <input type="range" min="0" max="1" step="0.01" value="${m.max}" data-mask-slider="max" />
                <output data-mask-out="max">${Math.round(m.max * 100)}%</output>
              </div>
            </div>
            <div class="tp-control-row">
              <div class="tp-control-label"><span>Edge Feather</span></div>
              <div class="tp-amount" style="--fill:${pctFeat}%">
                <input type="range" min="0.02" max="0.50" step="0.01" value="${m.feather}" data-mask-slider="feather" />
                <output data-mask-out="feather">${Math.round(m.feather * 100)}%</output>
              </div>
            </div>
            <label class="tp-check-row">
              <input type="checkbox" id="tp-chk-mask-invert" ${m.invert ? 'checked' : ''} />
              <span>Invert Black &amp; White Mask</span>
            </label>
          </div>
        </section>`;
    }

    // Global Derived Surface Shading & Sun Card (explicitly separate from Layer Stack!)
    const sunAz = this.engine.params.sunAzimuth ?? 48;
    const sunEl = this.engine.params.sunElevation ?? 28;
    const sunAzPct = (((sunAz + 180) / 360) * 100).toFixed(1);
    const sunElPct = (((sunEl - 4) / 81) * 100).toFixed(1);
    const curFab = this.pipeline.fabricMode ?? 0;
    const fabOpts = Object.values(DERIVED_FABRICS)
      .map((f) => `<option value="${f.id}" ${Number(curFab) === f.id ? 'selected' : ''}>${f.label}</option>`)
      .join('');

    const shadingCardHtml = `
      <section class="tp-property-card">
        <h2><i style="background:#82939e"></i><span>Derived Surface Shading &amp; Sun</span></h2>
        <p class="tp-card-note">Shading is derived purely from AO, protrusions, height, rock hardness, sediment &amp; flow — independent of the geometry stack.</p>
        <div class="tp-control-row">
          <div class="tp-control-label"><span>Rock Micro-Fabric</span></div>
          <select class="tp-select" id="tp-select-fabric">${fabOpts}</select>
        </div>
        <div class="tp-control-row">
          <div class="tp-control-label"><span>Sun Azimuth</span></div>
          <div class="tp-amount" style="--fill:${sunAzPct}%">
            <input type="range" min="-180" max="180" step="1" value="${sunAz}" id="tp-slider-sun-az" />
            <output id="tp-out-sun-az">${Math.round(sunAz)}°</output>
          </div>
        </div>
        <div class="tp-control-row">
          <div class="tp-control-label"><span>Sun Elevation</span></div>
          <div class="tp-amount" style="--fill:${sunElPct}%">
            <input type="range" min="4" max="85" step="1" value="${sunEl}" id="tp-slider-sun-el" />
            <output id="tp-out-sun-el">${Math.round(sunEl)}°</output>
          </div>
        </div>
        <label class="tp-check-row">
          <input type="checkbox" id="tp-chk-show-water" ${this.engine.params.showWater !== false ? 'checked' : ''} />
          <span>Render 2.5D River &amp; Basin Water</span>
        </label>
        <label class="tp-check-row">
          <input type="checkbox" id="tp-chk-show-particles" ${this.engine.params.showParticles !== false ? 'checked' : ''} />
          <span>Show 3D Rain / Snow / Wind Particles</span>
        </label>
      </section>`;

    this.elInspector.innerHTML = `
      <div class="tp-inspector-trail">
        <span>Terrain Stack</span>
        <i>›</i>
        <span>${cat.label}</span>
        <i>›</i>
        <span>Step #${stepNum} of ${layers.length}</span>
      </div>

      <div class="tp-inspector-identity">
        <div class="tp-identity-badge" style="--cat-accent:${cat.color}">
          ${iconSvg}
        </div>
        <div class="tp-identity-copy">
          <span class="tp-eyebrow" style="color:${cat.color}">${cat.eyebrow || cat.label.toUpperCase()}</span>
          <input type="text" class="tp-identity-title-input" id="tp-input-layer-name" value="${this._esc(layer.name)}" />
          <p class="tp-identity-desc">${specDesc}</p>
        </div>
      </div>

      <div class="tp-inspector-status">
        ${readsBadges}
        ${writesBadges}
      </div>

      <section class="tp-property-card">
        <h2><i style="background:${cat.color}"></i><span>${specLabel} Parameters</span></h2>
        ${controlsHtml}
      </section>

      ${authoringCardHtml}
      ${maskCardHtml}
      ${shadingCardHtml}
    `;

    // Wire Inspector Event Listeners
    const nameInput = document.getElementById('tp-input-layer-name');
    if (nameInput) {
      nameInput.addEventListener('change', () => {
        layer.name = nameInput.value.trim() || specLabel;
        this.renderStackList();
      });
    }

    this.elInspector.querySelectorAll('[data-param-select]').forEach((sel) => {
      sel.addEventListener('change', () => {
        layer.params[sel.dataset.paramSelect] = Number(sel.value);
        this.pipeline.evaluateStack({ reseedPlacements: true });
        this.renderStackList();
        this.updateSplineGizmoOverlay();
      });
    });

    this.elInspector.querySelectorAll('[data-param-slider]').forEach((inp) => {
      const key = inp.dataset.paramSlider;
      const slDef = schema.sliders.find((s) => s.key === key);
      const out = this.elInspector.querySelector(`[data-param-out="${key}"]`);
      inp.addEventListener('input', () => {
        const v = Number(inp.value);
        layer.params[key] = v;
        if (out && slDef) out.textContent = slDef.fmt(v);
        const pct = ((v - Number(inp.min)) / Math.max(1e-6, Number(inp.max) - Number(inp.min))) * 100;
        inp.parentElement.style.setProperty('--fill', `${pct.toFixed(1)}%`);
        this.pipeline.evaluateStack({
          reseedPlacements: layer.type === 'rock-placement',
          fastPreview: true,
        });
        this.updateSceneCaption();
      });
      inp.addEventListener('change', () => {
        this.pipeline.evaluateStack({ reseedPlacements: true, fastPreview: false });
        this.renderStackList();
      });
    });

    const seedInp = this.elInspector.querySelector('[data-param-seed]');
    if (seedInp) {
      seedInp.addEventListener('change', () => {
        layer.params.seed = Math.round(Number(seedInp.value) || 1);
        this.pipeline.evaluateStack({ reseedPlacements: true });
        this.renderStackList();
      });
    }
    const rndBtn = this.elInspector.querySelector('[data-random-seed]');
    if (rndBtn) {
      rndBtn.addEventListener('click', () => {
        layer.params.seed = Math.floor(1000 + Math.random() * 8999);
        if (seedInp) seedInp.value = String(layer.params.seed);
        this.pipeline.evaluateStack({ reseedPlacements: true });
        this.renderStackList();
      });
    }

    this.elInspector.querySelectorAll('[data-set-tool]').forEach((b) => {
      b.addEventListener('click', () => {
        this.setAuthorTool(b.dataset.setTool);
        this.renderInspector();
      });
    });

    const clearSculptBtn = document.getElementById('tp-btn-clear-sculpt');
    if (clearSculptBtn) {
      clearSculptBtn.addEventListener('click', () => {
        this.pipeline.clearSculptLayer(layer.id);
        this.renderAll();
      });
    }

    const addPtBtn = document.getElementById('tp-btn-add-spline-pt');
    if (addPtBtn) {
      addPtBtn.addEventListener('click', () => {
        const pts = layer.params.points || [];
        if (pts.length >= 8) return;
        const last = pts[pts.length - 1] || [0, 0];
        const prev = pts[pts.length - 2] || [-40, -40];
        const nx = Math.max(-230, Math.min(230, last[0] + (last[0] - prev[0]) * 0.6));
        const nz = Math.max(-230, Math.min(230, last[1] + (last[1] - prev[1]) * 0.6));
        pts.push([Math.round(nx), Math.round(nz)]);
        this.pipeline.evaluateStack({ reseedPlacements: true });
        this.renderAll();
      });
    }

    const popPtBtn = document.getElementById('tp-btn-pop-spline-pt');
    if (popPtBtn) {
      popPtBtn.addEventListener('click', () => {
        const pts = layer.params.points || [];
        if (pts.length <= 2) return;
        pts.pop();
        this.pipeline.evaluateStack({ reseedPlacements: true });
        this.renderAll();
      });
    }

    // Mask bindings
    const chkMask = document.getElementById('tp-chk-mask-enabled');
    if (chkMask) {
      chkMask.addEventListener('change', () => {
        layer.mask.enabled = chkMask.checked;
        this.pipeline.evaluateStack({ reseedPlacements: false });
        this.renderAll();
      });
    }

    const btnInspMask = document.getElementById('tp-btn-inspect-mask');
    if (btnInspMask) {
      btnInspMask.addEventListener('click', () => {
        this.pipeline.shadingMode = this.pipeline.shadingMode === 5 ? 0 : 5;
        if (this.elShadingSelect) this.elShadingSelect.value = String(this.pipeline.shadingMode);
        this.pipeline.evaluateStack({ reseedPlacements: false, fastPreview: true });
        this.renderAll();
      });
    }

    const selMaskMode = document.getElementById('tp-mask-mode');
    if (selMaskMode) {
      selMaskMode.addEventListener('change', () => {
        layer.mask.mode = selMaskMode.value;
        this.pipeline.evaluateStack({ reseedPlacements: false });
        this.renderStackList();
      });
    }

    this.elInspector.querySelectorAll('[data-mask-slider]').forEach((inp) => {
      const k = inp.dataset.maskSlider;
      const out = this.elInspector.querySelector(`[data-mask-out="${k}"]`);
      inp.addEventListener('input', () => {
        const v = Number(inp.value);
        layer.mask[k] = v;
        if (out) out.textContent = `${Math.round(v * 100)}%`;
        const pct = ((v - Number(inp.min)) / Math.max(1e-6, Number(inp.max) - Number(inp.min))) * 100;
        inp.parentElement.style.setProperty('--fill', `${pct.toFixed(1)}%`);
        this.pipeline.evaluateStack({ reseedPlacements: false, fastPreview: true });
      });
      inp.addEventListener('change', () => {
        this.pipeline.evaluateStack({ reseedPlacements: true });
        this.renderStackList();
      });
    });

    const chkInv = document.getElementById('tp-chk-mask-invert');
    if (chkInv) {
      chkInv.addEventListener('change', () => {
        layer.mask.invert = chkInv.checked;
        this.pipeline.evaluateStack({ reseedPlacements: false });
        this.renderStackList();
      });
    }

    // Fabric, Sun, Water & Particle bindings
    const selFab = document.getElementById('tp-select-fabric');
    if (selFab) {
      selFab.addEventListener('change', () => {
        this.pipeline.fabricMode = Number(selFab.value);
        this.engine.params.fabricMode = this.pipeline.fabricMode;
      });
    }
    const slAz = document.getElementById('tp-slider-sun-az');
    const outAz = document.getElementById('tp-out-sun-az');
    if (slAz) {
      slAz.addEventListener('input', () => {
        const v = Number(slAz.value);
        this.engine.params.sunAzimuth = v;
        if (outAz) outAz.textContent = `${Math.round(v)}°`;
        slAz.parentElement.style.setProperty('--fill', `${(((v + 180) / 360) * 100).toFixed(1)}%`);
      });
    }
    const slEl = document.getElementById('tp-slider-sun-el');
    const outEl = document.getElementById('tp-out-sun-el');
    if (slEl) {
      slEl.addEventListener('input', () => {
        const v = Number(slEl.value);
        this.engine.params.sunElevation = v;
        if (outEl) outEl.textContent = `${Math.round(v)}°`;
        slEl.parentElement.style.setProperty('--fill', `${(((v - 4) / 81) * 100).toFixed(1)}%`);
      });
    }
    const chkWater = document.getElementById('tp-chk-show-water');
    if (chkWater) {
      chkWater.addEventListener('change', () => {
        this.engine.params.showWater = chkWater.checked;
      });
    }
    const chkPart = document.getElementById('tp-chk-show-particles');
    if (chkPart) {
      chkPart.addEventListener('change', () => {
        this.engine.params.showParticles = chkPart.checked;
      });
    }
  }

  renderPresetShelf() {
    if (!this.elPresetGrid) return;
    let html = '';
    for (const preset of Object.values(TERRAIN_STACK_PRESETS)) {
      const isAct = preset.id === this.pipeline.activePresetId;
      const sampleLayers = preset.layers();
      html += `
        <button type="button" class="cb-preset-card ${isAct ? 'active' : ''}" data-preset-id="${preset.id}">
          <div class="cb-card-top">
            <span class="cb-badge">${preset.category || 'Stack Recipe'}</span>
            <span class="cb-pass-count">${sampleLayers.length} layers</span>
          </div>
          <div class="cb-card-title">${preset.name}</div>
          <div class="cb-card-sub">${preset.subtitle}</div>
        </button>`;
    }
    this.elPresetGrid.innerHTML = html;
    this.elPresetGrid.querySelectorAll('[data-preset-id]').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.dataset.presetId;
        this.pipeline.loadPreset(id);
        this.renderAll();
        if (this.onPresetChanged) this.onPresetChanged(id);
      });
    });
  }

  // =========================================================================
  // INTERACTIVE 3D SPLINE GIZMO OVERLAY
  // =========================================================================
  _bindSplineGizmoEvents() {
    if (!this.elSplineSvg) return;

    window.addEventListener('pointermove', (e) => {
      if (this.draggingSplinePt < 0) return;
      const sel = this.pipeline.getSelectedLayer();
      if (!sel || sel.type !== 'spline-feature') {
        this.draggingSplinePt = -1;
        return;
      }
      const hit = this.engine._raycastPlaneXZ(e.clientX, e.clientY);
      if (hit && sel.params.points[this.draggingSplinePt]) {
        sel.params.points[this.draggingSplinePt][0] = Math.round(hit[0]);
        sel.params.points[this.draggingSplinePt][1] = Math.round(hit[1]);
        this.pipeline.evaluateStack({ reseedPlacements: false, fastPreview: true });
        this.updateSplineGizmoOverlay();
      }
    });

    window.addEventListener('pointerup', () => {
      if (this.draggingSplinePt >= 0) {
        this.draggingSplinePt = -1;
        this.pipeline.evaluateStack({ reseedPlacements: true, fastPreview: false });
        this.renderStackList();
      }
    });
  }

  updateSplineGizmoOverlay() {
    const svg = this.elSplineSvg;
    if (!svg) return;
    const sel = this.pipeline.getSelectedLayer();
    const showGizmo =
      this.engine.active &&
      sel &&
      sel.type === 'spline-feature' &&
      sel.enabled &&
      Array.isArray(sel.params.points) &&
      sel.params.points.length >= 2;

    if (!showGizmo) {
      if (svg.innerHTML !== '') svg.innerHTML = '';
      svg.style.pointerEvents = 'none';
      return;
    }

    const w = svg.clientWidth || this.engine.canvas.clientWidth || 800;
    const h = svg.clientHeight || this.engine.canvas.clientHeight || 600;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    const pts2D = [];
    for (let i = 0; i < sel.params.points.length; i++) {
      const [wx, wz] = sel.params.points[i];
      const st = this.engine.rockCalving.sampleTerrain(wx, wz);
      const pr = this.pipeline.projectWorldToScreen(wx, st.surfaceH + 5.0, wz);
      if (pr) pts2D.push({ i, x: pr.u * w, y: pr.v * h, wx, wz });
    }

    if (pts2D.length < 2) {
      svg.innerHTML = '';
      return;
    }

    const polyPoints = pts2D.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    let circles = '';
    for (const p of pts2D) {
      circles += `
        <g class="spline-handle" data-pt-idx="${p.i}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
          <circle r="10" fill="rgba(18,18,18,0.78)" stroke="#d9b281" stroke-width="2" />
          <text y="3.5" text-anchor="middle" fill="#dededc" font-size="9" font-family="DM Sans, sans-serif">${p.i + 1}</text>
        </g>`;
    }

    svg.innerHTML = `
      <polyline points="${polyPoints}" fill="none" stroke="rgba(217,178,129,0.85)" stroke-width="2.2" stroke-dasharray="6 4" />
      ${circles}
    `;

    svg.querySelectorAll('.spline-handle').forEach((g) => {
      g.style.cursor = 'grab';
      g.style.pointerEvents = 'all';
      g.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.draggingSplinePt = Number(g.dataset.ptIdx);
      });
    });
  }

  _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
