// Starter projects. Every preset is a complete project: world, terrain stack, texture stack and scene.
import { makeTerrainLayer } from '../terrain/layer-types.js';
import { makeTextureLayer } from '../texture/layer-types.js';
import { SCENE_DEFAULTS } from '../render/renderer.js';

const T = (type, o = {}) => makeTerrainLayer(type, o);
const X = (type, o = {}) => makeTextureLayer(type, o);
const rule = (lo, hi, fall, on = true) => ({ on, lo, hi, fall });

function scene(over = {}) {
  const s = structuredClone(SCENE_DEFAULTS);
  for (const [k, v] of Object.entries(over)) s[k] = typeof v === 'object' && !Array.isArray(v) ? { ...s[k], ...v } : v;
  return s;
}
function project(name, world, terrain, texture, sc, camera) {
  const s = scene(sc);
  if (camera) s.camera = camera;
  return { version: 1, name, world: { size: 8192, height: 2400, seaOn: false, seaLevel: 0, ...world }, build: { res: 1024, auto: true }, terrain: { layers: terrain }, texture: { layers: texture }, scene: s };
}

export const PRESETS = [
  {
    id: 'alpine', label: 'Alpine Range', icon: 'mountain-snow', blurb: 'Glaciated peaks, river valleys, meadows and forest',
    make: () => project('Alpine Range', { height: 3000 }, [
      T('noise', { name: 'Rolling base', params: { ntype: 0, height: 320, scale: 3.6, detail: 7 } }),
      T('mountains', { name: 'Alpine massif', params: { shape: 2, height: 2350, scale: 9, ridgeScale: 2.6, ridgeAmount: 0.85, erosive: 0.5, warp: 0.4, seed: 7 } }),
      T('fluvial', { name: 'River incision', params: { strength: 0.6, duration: 0.5, talus: 37, soften: 0.12 } }),
      T('hydraulic', { name: 'Rain erosion', params: { rain: 2.4, erosion: 0.42 } }),
      T('snow', { name: 'Snowpack', params: { snowline: 1750, fade: 320, depth: 3.5 } }),
    ], [
      X('base', { name: 'Gneiss bedrock', params: { colorA: '#7b7872', colorB: '#67645f' } }),
      X('soil', { name: 'Alpine tundra', params: { colorA: '#6a6446', colorB: '#5a5440', rules: { slope: rule(0, 40, 6), height: rule(0, 0.82, 0.08) } } }),
      X('grass', { name: 'Alpine meadow', params: { colorA: '#66753a', colorB: '#88864a', coverage: 0.56, rules: { slope: rule(0, 36, 6), height: rule(0, 0.7, 0.08), noise: { on: true, scale: 220, threshold: 0.36, contrast: 1.4 } } } }),
      X('forest', { name: 'Spruce forest', params: { colorA: '#26331f', colorB: '#2e3b24', coverage: 0.52, edge: 0.6, rules: { slope: rule(0, 38, 5), height: rule(0, 0.44, 0.07) } } }),
      X('rock', { name: 'Rock faces', params: { colorA: '#85827c', colorB: '#6c6964', rules: { slope: rule(42, 90, 6) } } }),
      X('scree', { params: { colorA: '#9a968e', colorB: '#85817a' } }),
      X('sediment', { name: 'Alluvium', params: { colorA: '#7e7764', colorB: '#958c76' } }),
      X('gravel', { params: { colorA: '#9b978e', colorB: '#aaa69c' } }),
      X('snow'),
      X('shoreline'),
      X('tint', { blend: { opacity: 0.35 } }),
    ], { sky: { sunAzimuth: 122, sunElevation: 30, haze: 1.1 }, surround: 1 },
    { pos: [-2600, 2900, 6400], yaw: 0.36, pitch: -0.27, fov: 50 }),
  },
  {
    id: 'mesa', label: 'Desert Mesa', icon: 'layers-3', blurb: 'Stratified buttes, canyons, talus and dunes',
    make: () => project('Desert Mesa', { height: 1500 }, [
      T('noise', { name: 'Plateau undulation', params: { ntype: 0, height: 110, scale: 2.8, detail: 6 } }),
      T('mesa', { name: 'Canyonlands', params: { height: 720, scale: 4.6, coverage: 0.52, levels: 5, cliff: 0.84 } }),
      T('thermal', { name: 'Rockfall', params: { angle: 58, iterations: 18 } }),
      T('hydraulic', { name: 'Flash floods', params: { rain: 0.9, erosion: 0.4, smoothing: 0.2 } }),
      T('dunes', { name: 'Dune field', params: { height: 22, wavelength: 260 }, blend: { opacity: 0.8 }, mask: { mode: 1, min: -500, max: 260, falloff: 90 } }),
    ], [
      X('sand', { name: 'Desert floor', params: { colorA: '#c08a5c', colorB: '#a8744a' } }),
      X('dryGrass', { name: 'Scrub', params: { colorA: '#8a7a4c', colorB: '#6d6440', coverage: 0.35, rules: { slope: rule(0, 18, 4), noise: { on: true, scale: 60, threshold: 0.55, contrast: 2.5 } } } }),
      X('cliff', { name: 'Sandstone strata', params: { colorA: '#b5683f', colorB: '#94522f', strataColor: '#dca277', strataSpacing: 7, strataContrast: 0.55, rules: { slope: rule(34, 90, 5) } } }),
      X('rock', { name: 'Desert varnish', params: { colorA: '#5e3a2a', colorB: '#4a2f22', coverage: 0.42, rules: { slope: rule(58, 90, 6), noise: { on: true, scale: 40, threshold: 0.45, contrast: 2 } } } }),
      X('scree', { name: 'Talus', params: { colorA: '#a7704b', colorB: '#8e5d3e' } }),
      X('sediment', { name: 'Wash', params: { colorA: '#c9a07a', colorB: '#b88d68' } }),
      X('tint', { blend: { opacity: 0.4 } }),
    ], { sky: { sunAzimuth: 248, sunElevation: 17, haze: 0.9, sunTint: '#ffe9d2' }, surround: 1 },
    { pos: [2600, 1250, 5200], yaw: -0.45, pitch: -0.2, fov: 50 }),
  },
  {
    id: 'island', label: 'Volcanic Island', icon: 'flame', blurb: 'Stratovolcano rising from the sea, gullied flanks',
    make: () => project('Volcanic Island', { height: 2200, seaOn: true, seaLevel: 150 }, [
      T('shape', { name: 'Island', params: { form: 0, height: 420, radius: 0.64, falloff: 0.34 } }),
      T('volcano', { name: 'Stratovolcano', params: { height: 1450, radius: 3.1, caldera: 0.09 } }),
      T('noise', { name: 'Lava flows', params: { ntype: 4, height: 110, scale: 1.3, detail: 8 } }),
      T('fluvial', { name: 'Gully incision', params: { strength: 0.55, duration: 0.45, talus: 36 } }),
      T('hydraulic', { name: 'Tropical rain', params: { rain: 2.6 } }),
    ], [
      X('basalt', { name: 'Basalt bedrock' }),
      X('soil', { name: 'Volcanic soil', params: { colorA: '#3e342b', colorB: '#4a3d31' } }),
      X('grass', { name: 'Lush slopes', params: { colorA: '#46612a', colorB: '#5c7232', rules: { slope: rule(0, 32, 5), height: rule(0, 0.5, 0.08), noise: { on: true, scale: 160, threshold: 0.38, contrast: 1.5 } } } }),
      X('forest', { name: 'Cloud forest', params: { colorA: '#26391f', colorB: '#2f4524', rules: { slope: rule(0, 36, 4), height: rule(0, 0.42, 0.06) } } }),
      X('sand', { name: 'Black sand beach', params: { colorA: '#3b3836', colorB: '#4b4642', edge: 0.2, rules: { height: rule(0, 0.1, 0.012) } } }),
      X('rock', { name: 'Lava cliffs', params: { colorA: '#3a3633', colorB: '#2a2726' } }),
      X('scree', { name: 'Cinder', params: { colorA: '#4d3a33', colorB: '#5a4038' } }),
      X('tint', { blend: { opacity: 0.35 } }),
    ], { sky: { sunAzimuth: 140, sunElevation: 32, haze: 1.9 }, surround: 2, water: { color: '#2f8fa3', clarity: 14, turbidity: 0.05, waves: 0.7 } },
    { pos: [0, 1400, 7600], yaw: 0, pitch: -0.18, fov: 50 }),
  },
  {
    id: 'fjords', label: 'Highland Fjords', icon: 'waves', blurb: 'Steep glacial valleys flooded by the sea',
    make: () => project('Highland Fjords', { height: 1900, seaOn: true, seaLevel: 260 }, [
      T('noise', { name: 'Uplands', params: { ntype: 1, height: 900, scale: 3.2, detail: 8, sharpness: 1.6 } }),
      T('mountains', { name: 'Highlands', params: { shape: 2, height: 1100, scale: 10, ridgeScale: 1.8, erosive: 0.6 } }),
      T('fluvial', { name: 'Glacial valleys', params: { strength: 0.75, duration: 0.6, talus: 40, concavity: 0.4 } }),
      T('hydraulic', { name: 'Rain erosion', params: { rain: 2 } }),
      T('snow', { name: 'Snow', params: { snowline: 1150, fade: 260, depth: 2.5 } }),
    ], [
      X('base', { name: 'Gneiss', params: { colorA: '#6e6a66', colorB: '#5a5754' } }),
      X('grass', { name: 'Heath', params: { colorA: '#58623a', colorB: '#6f6b45', rules: { slope: rule(0, 33, 5), height: rule(0, 0.7, 0.08), noise: { on: true, scale: 200, threshold: 0.4, contrast: 1.5 } } } }),
      X('moss'),
      X('rock'),
      X('scree'),
      X('snow'),
      X('tint', { blend: { opacity: 0.4 } }),
    ], { sky: { sunAzimuth: 200, sunElevation: 15, haze: 2.4, fogDensity: 0.15, fogHeight: 180 }, surround: 2, water: { color: '#2d6f7e', clarity: 7, turbidity: 0.1, waves: 0.4 } },
    { pos: [-1800, 1100, 5600], yaw: 0.25, pitch: -0.12, fov: 50 }),
  },
  {
    id: 'dunes', label: 'Dune Sea', icon: 'sun', blurb: 'Wind-sculpted barchan and linear dunes',
    make: () => project('Dune Sea', { height: 500 }, [
      T('noise', { name: 'Erg base', params: { ntype: 0, height: 70, scale: 3.4, detail: 5 } }),
      T('dunes', { name: 'Dunes', params: { height: 80, wavelength: 640, asym: 0.8, secondary: 0.4 } }),
      T('dunes', { name: 'Ripple dunes', params: { height: 9, wavelength: 120, direction: 75, secondary: 0.2 }, blend: { opacity: 0.6 } }),
    ], [
      X('sand', { name: 'Sand', params: { colorA: '#d29a62', colorB: '#c4864f', varScale: 220 } }),
      X('sand', { name: 'Slip faces', params: { colorA: '#c18450', colorB: '#b47844', rules: { slope: rule(24, 90, 4) } } }),
      X('dryGrass', { name: 'Interdune scrub', params: { coverage: 0.3, rules: { curvature: rule(-40, -0.5, 0.8), slope: rule(0, 10, 3) } } }),
    ], { sky: { sunAzimuth: 100, sunElevation: 12, haze: 1.1 }, surround: 1 },
    { pos: [0, 260, 3800], yaw: 0.6, pitch: -0.09, fov: 50 }),
  },
  {
    id: 'blank', label: 'Blank', icon: 'square', blurb: 'A gentle noise field to start from scratch',
    make: () => project('Untitled terrain', { height: 1500 }, [
      T('noise', { name: 'Noise', params: { ntype: 0, height: 380, scale: 2.4 } }),
    ], [X('base', { name: 'Ground', params: { colorA: '#6b6157', colorB: '#5a5148' } })], { surround: 1 },
    { pos: [0, 1300, 5200], yaw: 0, pitch: -0.25, fov: 50 }),
  },
];

export function presetById(id) { return (PRESETS.find(p => p.id === id) || PRESETS[0]).make(); }

// Fill in anything an older or hand-edited project file is missing.
export function normalizeProject(p) {
  const base = PRESETS[5].make();
  p.version ??= 1;
  p.name ??= 'Untitled terrain';
  p.world = { ...base.world, ...(p.world || {}) };
  p.build = { ...base.build, ...(p.build || {}) };
  p.terrain ??= { layers: [] };
  p.texture ??= { layers: [] };
  const s = scene();
  p.scene = p.scene || {};
  for (const k of Object.keys(s)) {
    if (typeof s[k] === 'object' && !Array.isArray(s[k])) p.scene[k] = { ...s[k], ...(p.scene[k] || {}) };
    else p.scene[k] ??= s[k];
  }
  return p;
}
