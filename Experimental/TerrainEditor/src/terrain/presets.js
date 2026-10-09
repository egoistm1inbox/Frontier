// Terrain presets: each one is a complete layer stack plus terrain and view
// settings, so a preset is a starting point rather than a single slider.

import { shapeLayer, erosionLayer } from './pipeline.js';

export const presets = [
  {
    id: 'sandstone-canyons', label: 'Sandstone Canyons', palette: 'canyon',
    terrain: { size: 256, seed: 4021, waterLevel: 60 },
    layers: () => [
      shapeLayer('Plateau base', 'multifractal', { amplitude: 520, scale: 5, octaves: 4, gain: 0.72, offset: 0.35 }),
      shapeLayer('Sandstone strata', 'strata', { amplitude: 240, scale: 9, layers: 26, width: 0.62, warp: 2.5 }, 'stratify', { layers: 20, width: 0.6, warp: 1.5 }),
      erosionLayer('Rift carving', 'fluvial', { passes: 4, depth: 0.11, power: 0.55, width: 2.5, meander: 0.7, threshold: 0.28, deposition: 0.6 }, 'rifted', { scale: 6, stretch: 7, angle: 18, warp: 2, amplitude: 300 }, 'rifts', { scale: 7, stretch: 5, threshold: 0.6, softness: 0.12, angle: 18 }, 1, 0.9),
      erosionLayer('Rainfall wash', 'hydraulic', { droplets: 90000, lifetime: 30, radius: 3, erodeSpeed: 0.35, depositSpeed: 0.3, capacity: 4.5 }, 'perlin', { amplitude: 400, scale: 6, octaves: 3 }),
    ],
  },
  {
    id: 'sandstone-cliffs', label: 'Sandstone Cliffs', palette: 'canyon',
    terrain: { size: 256, seed: 1707, waterLevel: 40 },
    layers: () => [
      shapeLayer('Mesa base', 'ridged', { amplitude: 760, scale: 9, octaves: 5, persistence: 0.55, gain: 2.2 }),
      shapeLayer('Strata bands', 'strata', { amplitude: 200, scale: 7, layers: 22, width: 0.58, warp: 2 }, 'stratify', { layers: 16, width: 0.55, warp: 1.2 }),
      shapeLayer('Cliff rock', 'ridged', { amplitude: 160, scale: 16, octaves: 4, gain: 2.4 }, 'cliffs', { slopeMin: 0.5, slopeMax: 0.8, strength: 1 }, 'add', 0.9),
      erosionLayer('Talus creep', 'thermal', { iterations: 90, talus: 0.028, fraction: 0.55 }, 'perlin', { amplitude: 300, scale: 5, octaves: 2 }),
      erosionLayer('Gully cut', 'hydraulic', { droplets: 50000, lifetime: 28, radius: 2, erodeSpeed: 0.32, capacity: 4 }, 'warped', { amplitude: 500, scale: 8, octaves: 3, warp: 1.4 }),
    ],
  },
  {
    id: 'coastal-cliffs', label: 'Coastal Cliffs', palette: 'temperate',
    terrain: { size: 256, seed: 883, waterLevel: 150 },
    layers: () => [
      shapeLayer('Island base', 'island', { amplitude: 720, radius: 0.6, falloff: 0.24, scale: 7, octaves: 5, persistence: 0.5 }),
      shapeLayer('Headland rock', 'ridged', { amplitude: 220, scale: 14, octaves: 4, gain: 2.3 }, 'cliffs', { slopeMin: 0.45, slopeMax: 0.75, strength: 1 }),
      shapeLayer('Beach fringe', 'perlin', { amplitude: 60, scale: 10, octaves: 2 }, 'coastal', { falloff: 0.08, edge: 0.05, strength: 1 }, 'subtract', 0.8),
      erosionLayer('Coastal runoff', 'hydraulic', { droplets: 70000, lifetime: 30, radius: 3, erodeSpeed: 0.34, depositSpeed: 0.34, capacity: 4.2 }, 'perlin', { amplitude: 350, scale: 6, octaves: 3 }, 'coastal', { falloff: 0.35, edge: 0.2, strength: 1 }),
      erosionLayer('Shore smoothing', 'thermal', { iterations: 40, talus: 0.018, fraction: 0.5 }, 'perlin', { amplitude: 250, scale: 4, octaves: 2 }),
    ],
  },
  {
    id: 'himalayan', label: 'Himalayan Mountains', palette: 'alpine',
    terrain: { size: 256, seed: 9001, waterLevel: 80 },
    layers: () => [
      shapeLayer('Great ranges', 'mountain', { amplitude: 1600, scale: 10, octaves: 6, persistence: 0.55, ridgeMix: 0.72 }, 'mountain', { scale: 2.5, threshold: 0.48, softness: 0.16, strength: 1 }),
      shapeLayer('Ridge detail', 'ridged', { amplitude: 320, scale: 22, octaves: 5, gain: 2.6 }, 'mountain', { scale: 2.5, threshold: 0.45, softness: 0.2, strength: 0.7 }, 'add', 0.8),
      erosionLayer('Monsoon carve', 'hydraulic', { droplets: 90000, lifetime: 32, radius: 3, erodeSpeed: 0.36, depositSpeed: 0.3, capacity: 4.5, gravity: 4.5 }, 'warped', { amplitude: 600, scale: 9, octaves: 3, warp: 1.6 }),
      erosionLayer('Talus fields', 'thermal', { iterations: 50, talus: 0.022, fraction: 0.5 }, 'perlin', { amplitude: 300, scale: 6, octaves: 2 }),
    ],
  },
  {
    id: 'icelandic', label: 'Icelandic', palette: 'volcanic',
    terrain: { size: 256, seed: 6604, waterLevel: 100 },
    layers: () => [
      shapeLayer('Lava fields', 'ridged', { amplitude: 640, scale: 12, octaves: 5, persistence: 0.5, gain: 2.1 }, 'mountain', { scale: 3, threshold: 0.52, softness: 0.18, strength: 0.8 }),
      shapeLayer('Fissure swarms', 'rifted', { amplitude: 260, scale: 8, stretch: 8, angle: 12, warp: 2.2, octaves: 4 }, 'rifts', { scale: 8, stretch: 6, threshold: 0.58, softness: 0.14, angle: 12 }, 'subtract', 0.85),
      shapeLayer('Moss lowlands', 'perlin', { amplitude: 140, scale: 5, octaves: 3 }, 'coastal', { falloff: 0.3, edge: 0.15, strength: 0.6 }, 'max', 0.9),
      erosionLayer('Meltwater rivers', 'hydraulic', { droplets: 60000, lifetime: 30, radius: 3, erodeSpeed: 0.34, depositSpeed: 0.32, capacity: 4.2 }, 'perlin', { amplitude: 350, scale: 6, octaves: 3 }),
      erosionLayer('Fluvial valleys', 'fluvial', { passes: 3, depth: 0.07, power: 0.5, width: 2, meander: 0.6, threshold: 0.32, deposition: 0.5 }, 'warped', { amplitude: 400, scale: 7, octaves: 3, warp: 1.3 }),
    ],
  },
  {
    id: 'alps', label: 'Alps', palette: 'alpine',
    terrain: { size: 256, seed: 3150, waterLevel: 120 },
    layers: () => [
      shapeLayer('Alpine backbone', 'mountain', { amplitude: 1250, scale: 11, octaves: 6, persistence: 0.52, ridgeMix: 0.55 }, 'mountain', { scale: 2.8, threshold: 0.5, softness: 0.18, strength: 1 }),
      shapeLayer('Meadow detail', 'perlin', { amplitude: 130, scale: 14, octaves: 4, persistence: 0.45 }, 'cliffs', { slopeMin: 0.1, slopeMax: 0.4, strength: 0.5 }, 'add', 0.6),
      erosionLayer('Glacial-age runoff', 'hydraulic', { droplets: 80000, lifetime: 30, radius: 3, erodeSpeed: 0.35, depositSpeed: 0.3, capacity: 4.4 }, 'warped', { amplitude: 550, scale: 8, octaves: 3, warp: 1.5 }),
      erosionLayer('Scree creep', 'thermal', { iterations: 70, talus: 0.024, fraction: 0.55 }, 'perlin', { amplitude: 280, scale: 5, octaves: 2 }),
    ],
  },
  {
    id: 'snowy-mountains', label: 'Snowy Mountains', palette: 'arctic',
    terrain: { size: 256, seed: 7788, waterLevel: 60 },
    layers: () => [
      shapeLayer('Snow peaks', 'mountain', { amplitude: 1500, scale: 9, octaves: 6, persistence: 0.55, ridgeMix: 0.65 }, 'mountain', { scale: 2.2, threshold: 0.46, softness: 0.2, strength: 1 }),
      shapeLayer('Ice detail', 'ridged', { amplitude: 260, scale: 20, octaves: 5, gain: 2.5 }, 'mountain', { scale: 2.2, threshold: 0.5, softness: 0.22, strength: 0.6 }, 'add', 0.7),
      erosionLayer('Gentle weathering', 'thermal', { iterations: 30, talus: 0.016, fraction: 0.45 }, 'perlin', { amplitude: 250, scale: 5, octaves: 2 }),
      erosionLayer('Snowmelt channels', 'hydraulic', { droplets: 40000, lifetime: 26, radius: 2, erodeSpeed: 0.28, depositSpeed: 0.3, capacity: 3.8 }, 'perlin', { amplitude: 300, scale: 7, octaves: 3 }),
    ],
  },
  {
    id: 'rugged-outcrops', label: 'Rugged Outcrops', palette: 'temperate',
    terrain: { size: 256, seed: 2468, waterLevel: 30 },
    layers: () => [
      shapeLayer('Outcrop spine', 'ridged', { amplitude: 620, scale: 15, octaves: 5, persistence: 0.5, gain: 2.4 }, 'mountain', { scale: 3.2, threshold: 0.5, softness: 0.2, strength: 0.85 }),
      shapeLayer('Boulder fields', 'voronoi', { amplitude: 240, scale: 18, jitter: 0.85 }, 'mountain', { scale: 3.2, threshold: 0.55, softness: 0.18, strength: 0.7 }, 'add', 0.75),
      erosionLayer('Talus armor', 'thermal', { iterations: 110, talus: 0.045, fraction: 0.6 }, 'perlin', { amplitude: 320, scale: 6, octaves: 2 }),
      erosionLayer('Ridge runoff', 'hydraulic', { droplets: 45000, lifetime: 26, radius: 2, erodeSpeed: 0.3, depositSpeed: 0.32, capacity: 3.9 }, 'ridged', { amplitude: 400, scale: 10, octaves: 3, gain: 2 }),
    ],
  },
  {
    id: 'desert-dunes', label: 'Desert Dunes', palette: 'desert',
    terrain: { size: 256, seed: 5150, waterLevel: 0 },
    layers: () => [
      shapeLayer('Dune swells', 'perlin', { amplitude: 130, scale: 3.5, octaves: 3, persistence: 0.45 }),
      shapeLayer('Wind ripples', 'dunes', { amplitude: 95, wavelength: 26, asymmetry: 0.9, direction: 20, fieldScale: 4 }),
      erosionLayer('Sand transport', 'aeolian', { iterations: 70, strength: 0.7, direction: 20, transport: 3, erosion: 0.5, deposition: 0.4, ripple: 0.5, slopeMax: 0.3, wavelength: 20 }, 'perlin', { amplitude: 400, scale: 4, octaves: 3 }),
      erosionLayer('Rare storm wash', 'hydraulic', { droplets: 25000, lifetime: 22, radius: 2, erodeSpeed: 0.26, depositSpeed: 0.28, capacity: 3.5, evaporate: 0.02 }, 'warped', { amplitude: 500, scale: 6, octaves: 3, warp: 1.2 }, 'none', {}, 0.5, 0.6),
    ],
  },
  {
    id: 'rocky-desert', label: 'Rocky Desert', palette: 'desert',
    terrain: { size: 256, seed: 8091, waterLevel: 10 },
    layers: () => [
      shapeLayer('Desert plateau', 'strata', { amplitude: 380, scale: 7, layers: 18, width: 0.6, warp: 2.2 }, 'stratify', { layers: 14, width: 0.55, warp: 1.4 }),
      shapeLayer('Rocky highs', 'ridged', { amplitude: 240, scale: 13, octaves: 4, gain: 2.2 }, 'mountain', { scale: 3, threshold: 0.52, softness: 0.2, strength: 0.8 }),
      shapeLayer('Wadi cuts', 'rifted', { amplitude: 150, scale: 9, stretch: 6, angle: 40, warp: 1.8, octaves: 3 }, 'rifts', { scale: 9, stretch: 5, threshold: 0.6, softness: 0.14, angle: 40 }, 'subtract', 0.8),
      erosionLayer('Flash flood carve', 'fluvial', { passes: 3, depth: 0.06, power: 0.55, width: 2, meander: 0.5, threshold: 0.34, deposition: 0.65 }, 'warped', { amplitude: 450, scale: 7, octaves: 3, warp: 1.4 }),
      erosionLayer('Desert pavement', 'thermal', { iterations: 60, talus: 0.03, fraction: 0.5 }, 'perlin', { amplitude: 280, scale: 5, octaves: 2 }),
    ],
  },
];

export function presetById(id) {
  return presets.find((p) => p.id === id);
}
