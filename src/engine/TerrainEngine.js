import { GeologicalNoise } from './Noise.js';
import { HydraulicErosionEngine } from './HydraulicErosion.js';
import { ThermalErosionEngine } from './ThermalErosion.js';

export const TERRAIN_LAYER_TYPES = {
  ALPINE_PEAKS: 'alpine_peaks',
  RIDGED_MULTIFRACTAL: 'ridged_multifractal',
  SWISS_FBM: 'swiss_fbm',
  VORONOI_CRAGS: 'voronoi_crags',
  CANYON_FAULT: 'canyon_fault',
  VOLCANIC_CALDERA: 'volcanic_caldera',
  DESERT_DUNES: 'desert_dunes',
  PLATEAU_MESA: 'plateau_mesa',
  // Modifiers
  HYDRAULIC_EROSION: 'hydraulic_erosion',
  THERMAL_TALUS: 'thermal_talus',
  STRATA_TERRACES: 'strata_terraces',
  DOMAIN_WARP: 'domain_warp',
  PEAK_SHARPENER: 'peak_sharpener',
  SEDIMENT_INFILL: 'sediment_infill'
};

export class TerrainEngine {
  constructor(size = 256) {
    this.size = size;
    this.noise = new GeologicalNoise(428);
    this.hydraulic = new HydraulicErosionEngine(size);
    this.thermal = new ThermalErosionEngine(size);
  }

  setSize(size) {
    this.size = size;
    this.hydraulic.size = size;
    this.thermal.size = size;
  }

  // Create default starter terrain layers
  static getDefaultLayers() {
    return [
      {
        id: 'layer-base-alpine',
        name: 'Alpine Massif Base',
        type: TERRAIN_LAYER_TYPES.ALPINE_PEAKS,
        enabled: true,
        bypassed: false,
        blendMode: 'replace',
        opacity: 1.0,
        params: {
          seed: 428,
          scale: 1.8,
          octaves: 7,
          lacunarity: 2.1,
          gain: 0.52,
          sharpness: 2.2,
          altitude: 280, // meters
          ridgeWeight: 1.2
        }
      },
      {
        id: 'layer-domain-warp',
        name: 'Tectonic Plate Warp',
        type: TERRAIN_LAYER_TYPES.DOMAIN_WARP,
        enabled: true,
        bypassed: false,
        blendMode: 'replace',
        opacity: 0.85,
        params: {
          strength: 1.4,
          frequency: 1.2,
          octaves: 4
        }
      },
      {
        id: 'layer-strata',
        name: 'Sedimentary Strata',
        type: TERRAIN_LAYER_TYPES.STRATA_TERRACES,
        enabled: true,
        bypassed: false,
        blendMode: 'replace',
        opacity: 0.45,
        params: {
          frequency: 18,
          hardness: 0.72,
          warpModulation: 0.35
        }
      },
      {
        id: 'layer-hydraulic',
        name: 'Hydraulic Fluvial Erosion',
        type: TERRAIN_LAYER_TYPES.HYDRAULIC_EROSION,
        enabled: true,
        bypassed: false,
        blendMode: 'replace',
        opacity: 0.9,
        params: {
          iterations: 65000,
          rainRate: 1.2,
          erodeSpeed: 0.38,
          depositSpeed: 0.35,
          inertia: 0.18,
          sedimentCapacity: 4.5,
          evaporateSpeed: 0.022
        }
      },
      {
        id: 'layer-thermal',
        name: 'Thermal Scree Slopes',
        type: TERRAIN_LAYER_TYPES.THERMAL_TALUS,
        enabled: true,
        bypassed: false,
        blendMode: 'replace',
        opacity: 0.85,
        params: {
          iterations: 14,
          reposeAngle: 37.0, // degrees
          talusRate: 0.52
        }
      },
      {
        id: 'layer-peak-sharpener',
        name: 'Arete & Horn Sharpener',
        type: TERRAIN_LAYER_TYPES.PEAK_SHARPENER,
        enabled: true,
        bypassed: false,
        blendMode: 'replace',
        opacity: 0.65,
        params: {
          threshold: 0.65,
          accentuation: 1.35
        }
      },
      {
        id: 'layer-sediment-infill',
        name: 'Alluvial Valley Basin',
        type: TERRAIN_LAYER_TYPES.SEDIMENT_INFILL,
        enabled: true,
        bypassed: false,
        blendMode: 'replace',
        opacity: 0.4,
        params: {
          waterLevelThreshold: 0.12,
          infillSoftness: 0.08
        }
      }
    ];
  }

  // Generate complete terrain heightfield & auxiliary maps from layerstack
  generate(layers, progressCallback = null) {
    const size = this.size;
    let heightMap = new Float32Array(size * size);
    let flowMask = new Float32Array(size * size);
    let sedimentMask = new Float32Array(size * size);
    let talusMask = new Float32Array(size * size);

    // Active enabled & not bypassed layers
    const activeLayers = layers.filter(l => l.enabled && !l.bypassed);

    for (let layerIdx = 0; layerIdx < activeLayers.length; layerIdx++) {
      const layer = activeLayers[layerIdx];
      if (progressCallback) progressCallback(layerIdx / activeLayers.length, layer.name);

      const layerHeight = new Float32Array(size * size);

      switch (layer.type) {
        case TERRAIN_LAYER_TYPES.ALPINE_PEAKS: {
          this.generateAlpinePeaks(layerHeight, layer.params);
          this.applyBlend(heightMap, layerHeight, layer.blendMode, layer.opacity);
          break;
        }

        case TERRAIN_LAYER_TYPES.RIDGED_MULTIFRACTAL: {
          this.generateRidgedMultifractal(layerHeight, layer.params);
          this.applyBlend(heightMap, layerHeight, layer.blendMode, layer.opacity);
          break;
        }

        case TERRAIN_LAYER_TYPES.SWISS_FBM: {
          this.generateSwissFbm(layerHeight, layer.params);
          this.applyBlend(heightMap, layerHeight, layer.blendMode, layer.opacity);
          break;
        }

        case TERRAIN_LAYER_TYPES.VORONOI_CRAGS: {
          this.generateVoronoiCrags(layerHeight, layer.params);
          this.applyBlend(heightMap, layerHeight, layer.blendMode, layer.opacity);
          break;
        }

        case TERRAIN_LAYER_TYPES.CANYON_FAULT: {
          this.generateCanyonFault(layerHeight, layer.params);
          this.applyBlend(heightMap, layerHeight, layer.blendMode, layer.opacity);
          break;
        }

        case TERRAIN_LAYER_TYPES.VOLCANIC_CALDERA: {
          this.generateVolcanicCaldera(layerHeight, layer.params);
          this.applyBlend(heightMap, layerHeight, layer.blendMode, layer.opacity);
          break;
        }

        case TERRAIN_LAYER_TYPES.DESERT_DUNES: {
          this.generateDesertDunes(layerHeight, layer.params);
          this.applyBlend(heightMap, layerHeight, layer.blendMode, layer.opacity);
          break;
        }

        case TERRAIN_LAYER_TYPES.PLATEAU_MESA: {
          this.generatePlateauMesa(layerHeight, layer.params);
          this.applyBlend(heightMap, layerHeight, layer.blendMode, layer.opacity);
          break;
        }

        // Modifiers applied in-place to current heightMap
        case TERRAIN_LAYER_TYPES.DOMAIN_WARP: {
          this.applyDomainWarp(heightMap, layer.params, layer.opacity);
          break;
        }

        case TERRAIN_LAYER_TYPES.STRATA_TERRACES: {
          this.applyStrataTerraces(heightMap, layer.params, layer.opacity);
          break;
        }

        case TERRAIN_LAYER_TYPES.HYDRAULIC_EROSION: {
          const res = this.hydraulic.simulate(heightMap, size, {
            iterations: layer.params.iterations ?? 55000,
            erodeSpeed: layer.params.erodeSpeed ?? 0.38,
            depositSpeed: layer.params.depositSpeed ?? 0.35,
            inertia: layer.params.inertia ?? 0.18,
            sedimentCapacityFactor: layer.params.sedimentCapacity ?? 4.5,
            evaporateSpeed: layer.params.evaporateSpeed ?? 0.02
          });
          heightMap = res.heightMap;
          flowMask = res.flowMask;
          sedimentMask = res.sedimentMask;
          break;
        }

        case TERRAIN_LAYER_TYPES.THERMAL_TALUS: {
          const res = this.thermal.simulate(heightMap, size, {
            iterations: layer.params.iterations ?? 12,
            reposeAngleDegrees: layer.params.reposeAngle ?? 37.0,
            talusRate: (layer.params.talusRate ?? 0.5) * layer.opacity
          });
          heightMap = res.heightMap;
          talusMask = res.talusMask;
          break;
        }

        case TERRAIN_LAYER_TYPES.PEAK_SHARPENER: {
          this.applyPeakSharpener(heightMap, layer.params, layer.opacity);
          break;
        }

        case TERRAIN_LAYER_TYPES.SEDIMENT_INFILL: {
          this.applySedimentInfill(heightMap, layer.params, layer.opacity);
          break;
        }
      }
    }

    // Compute derivative maps: Normals, Slopes, Curvature/Cavity
    const analysis = this.analyzeTerrain(heightMap, size);

    return {
      heightMap,
      flowMask,
      sedimentMask,
      talusMask,
      normalMap: analysis.normalMap,
      slopeMap: analysis.slopeMap,
      curvatureMap: analysis.curvatureMap,
      stats: analysis.stats
    };
  }

  // --- Primitives Generation ---

  generateAlpinePeaks(out, params) {
    const {
      seed = 428,
      scale = 1.8,
      octaves = 7,
      lacunarity = 2.1,
      gain = 0.52,
      sharpness = 2.2,
      ridgeWeight = 1.2
    } = params;

    this.noise.setSeed(seed);
    const size = this.size;
    const invSize = 1.0 / size;

    for (let y = 0; y < size; y++) {
      const ny = y * invSize * scale;
      for (let x = 0; x < size; x++) {
        const nx = x * invSize * scale;
        // Primary ridged multi-fractal
        const r = this.noise.ridgedMultifractal(nx, ny, octaves, lacunarity, gain, sharpness);
        // Secondary billow/fbm for massif body bulk
        const b = this.noise.fbm(nx * 0.5 + 12.3, ny * 0.5 + 7.4, 4, 2.0, 0.5);
        // Combined alpine massif
        const h = r * ridgeWeight + b * (1.0 - ridgeWeight * 0.5);
        out[y * size + x] = Math.max(0, h);
      }
    }
  }

  generateRidgedMultifractal(out, params) {
    const {
      seed = 101,
      scale = 2.0,
      octaves = 6,
      lacunarity = 2.0,
      gain = 0.5,
      sharpness = 2.0
    } = params;

    this.noise.setSeed(seed);
    const size = this.size;
    const invSize = 1.0 / size;

    for (let y = 0; y < size; y++) {
      const ny = y * invSize * scale;
      for (let x = 0; x < size; x++) {
        const nx = x * invSize * scale;
        out[y * size + x] = this.noise.ridgedMultifractal(nx, ny, octaves, lacunarity, gain, sharpness);
      }
    }
  }

  generateSwissFbm(out, params) {
    const {
      seed = 303,
      scale = 2.2,
      octaves = 8,
      lacunarity = 2.0,
      persistence = 0.48
    } = params;

    this.noise.setSeed(seed);
    const size = this.size;
    const invSize = 1.0 / size;

    for (let y = 0; y < size; y++) {
      const ny = y * invSize * scale;
      for (let x = 0; x < size; x++) {
        const nx = x * invSize * scale;
        out[y * size + x] = this.noise.fbm(nx, ny, octaves, lacunarity, persistence);
      }
    }
  }

  generateVoronoiCrags(out, params) {
    const {
      seed = 505,
      scale = 3.5,
      jitter = 0.85
    } = params;

    this.noise.setSeed(seed);
    const size = this.size;
    const invSize = 1.0 / size;

    for (let y = 0; y < size; y++) {
      const ny = y * invSize * scale;
      for (let x = 0; x < size; x++) {
        const nx = x * invSize * scale;
        const v = this.noise.voronoi(nx, ny, jitter);
        out[y * size + x] = (1.0 - v.f1) * 0.7 + v.crag * 0.3;
      }
    }
  }

  generateCanyonFault(out, params) {
    const {
      seed = 707,
      scale = 1.5,
      canyonDepth = 0.7,
      meander = 1.5
    } = params;

    this.noise.setSeed(seed);
    const size = this.size;
    const invSize = 1.0 / size;

    for (let y = 0; y < size; y++) {
      const ny = y * invSize;
      for (let x = 0; x < size; x++) {
        const nx = x * invSize;
        // Meandering fault line
        const faultX = 0.5 + 0.25 * Math.sin(ny * Math.PI * meander) + 0.1 * this.noise.perlin2D(nx * 3, ny * 3);
        const distToFault = Math.abs(nx - faultX);
        const plateau = this.noise.fbm(nx * scale * 2, ny * scale * 2, 5, 2.0, 0.5) * 0.3 + 0.7;
        const cut = Math.min(1.0, Math.pow(distToFault * 5.0, 0.7));
        out[y * size + x] = plateau * (1.0 - (1.0 - cut) * canyonDepth);
      }
    }
  }

  generateVolcanicCaldera(out, params) {
    const {
      seed = 909,
      craterRadius = 0.35,
      rimHeight = 0.9,
      floorDepth = 0.25
    } = params;

    this.noise.setSeed(seed);
    const size = this.size;
    const invSize = 1.0 / size;

    for (let y = 0; y < size; y++) {
      const ny = (y * invSize - 0.5) * 2.0;
      for (let x = 0; x < size; x++) {
        const nx = (x * invSize - 0.5) * 2.0;
        const dist = Math.hypot(nx, ny);
        const angle = Math.atan2(ny, nx);
        const noiseWiggle = this.noise.fbm(nx * 2, ny * 2, 4) * 0.15;
        const d = dist + noiseWiggle;

        let h = 0;
        if (d < craterRadius) {
          // Inside caldera floor
          const t = d / craterRadius;
          h = floorDepth + (rimHeight - floorDepth) * Math.pow(t, 2.5);
        } else {
          // Outer flank
          const t = (d - craterRadius) / (1.4 - craterRadius);
          h = rimHeight * Math.exp(-t * 3.5);
        }
        out[y * size + x] = Math.max(0, h);
      }
    }
  }

  generateDesertDunes(out, params) {
    const {
      seed = 808,
      scale = 3.0,
      waveAngle = 35.0,
      asymmetry = 0.75
    } = params;

    this.noise.setSeed(seed);
    const size = this.size;
    const invSize = 1.0 / size;
    const rad = (waveAngle * Math.PI) / 180.0;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x * invSize) * scale;
        const v = (y * invSize) * scale;
        const proj = u * cosA + v * sinA;
        const warp = this.noise.perlin2D(u * 0.8, v * 0.8) * 0.4;
        const phase = (proj + warp) % 1.0;
        // Asymmetric dune crest
        const h = phase < asymmetry
          ? Math.pow(phase / asymmetry, 1.8)
          : Math.pow(1.0 - (phase - asymmetry) / (1.0 - asymmetry), 0.6);
        out[y * size + x] = h * 0.45;
      }
    }
  }

  generatePlateauMesa(out, params) {
    const {
      seed = 404,
      scale = 1.6,
      terraceSteps = 4,
      cliffSharpness = 8.0
    } = params;

    this.noise.setSeed(seed);
    const size = this.size;
    const invSize = 1.0 / size;

    for (let y = 0; y < size; y++) {
      const ny = y * invSize * scale;
      for (let x = 0; x < size; x++) {
        const nx = x * invSize * scale;
        const base = this.noise.fbm(nx, ny, 6, 2.0, 0.5);
        const stepped = Math.floor(base * terraceSteps) / terraceSteps;
        const rem = (base * terraceSteps) % 1.0;
        const smoothStep = 1.0 / (1.0 + Math.exp(-cliffSharpness * (rem - 0.5)));
        out[y * size + x] = (stepped + smoothStep / terraceSteps);
      }
    }
  }

  // --- Modifiers ---

  applyDomainWarp(heightMap, params, opacity) {
    const { strength = 1.4, frequency = 1.2 } = params;
    const size = this.size;
    const temp = new Float32Array(heightMap);
    const invSize = 1.0 / size;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = x * invSize;
        const ny = y * invSize;
        const warp = this.noise.domainWarp(nx * 3.0, ny * 3.0, strength * 0.08, frequency);
        const sampleX = Math.max(0, Math.min(size - 1, warp.x * size));
        const sampleY = Math.max(0, Math.min(size - 1, warp.y * size));

        const x0 = Math.floor(sampleX);
        const y0 = Math.floor(sampleY);
        const x1 = Math.min(size - 1, x0 + 1);
        const y1 = Math.min(size - 1, y0 + 1);
        const u = sampleX - x0;
        const v = sampleY - y0;

        const val = (1 - u) * (1 - v) * temp[y0 * size + x0] +
                    u * (1 - v) * temp[y0 * size + x1] +
                    (1 - u) * v * temp[y1 * size + x0] +
                    u * v * temp[y1 * size + x1];

        const idx = y * size + x;
        heightMap[idx] = heightMap[idx] * (1.0 - opacity) + val * opacity;
      }
    }
  }

  applyStrataTerraces(heightMap, params, opacity) {
    const { frequency = 18, hardness = 0.72, warpModulation = 0.35 } = params;
    const size = this.size;
    const invSize = 1.0 / size;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = y * size + x;
        const h = heightMap[idx];
        const warp = this.noise.perlin2D(x * invSize * 4, y * invSize * 4) * warpModulation * 0.05;
        const hWarped = h + warp;

        const steppedH = Math.floor(hWarped * frequency) / frequency;
        const rem = (hWarped * frequency) % 1.0;
        const ramp = Math.pow(rem, 1.0 + hardness * 4.0);
        const terraced = steppedH + ramp / frequency;

        heightMap[idx] = h * (1.0 - opacity) + terraced * opacity;
      }
    }
  }

  applyPeakSharpener(heightMap, params, opacity) {
    const { threshold = 0.6, accentuation = 1.35 } = params;
    const size = this.size;

    for (let i = 0; i < size * size; i++) {
      const h = heightMap[i];
      if (h > threshold) {
        const excess = (h - threshold) / (1.0 - threshold);
        const boosted = threshold + Math.pow(excess, accentuation) * (1.0 - threshold) * 1.25;
        heightMap[i] = h * (1.0 - opacity) + boosted * opacity;
      }
    }
  }

  applySedimentInfill(heightMap, params, opacity) {
    const { waterLevelThreshold = 0.12, infillSoftness = 0.08 } = params;
    const size = this.size;

    for (let i = 0; i < size * size; i++) {
      const h = heightMap[i];
      if (h < waterLevelThreshold + infillSoftness) {
        const t = Math.max(0, Math.min(1, (h - (waterLevelThreshold - infillSoftness)) / (infillSoftness * 2)));
        const smoothed = waterLevelThreshold * 0.7 + h * 0.3;
        heightMap[i] = h * (1.0 - opacity * (1.0 - t)) + smoothed * (opacity * (1.0 - t));
      }
    }
  }

  // --- Layer Blending Math ---

  applyBlend(base, layer, mode, opacity) {
    const len = base.length;
    for (let i = 0; i < len; i++) {
      const b = base[i];
      const l = layer[i];
      let res = b;

      switch (mode) {
        case 'replace':
          res = b * (1.0 - opacity) + l * opacity;
          break;
        case 'add':
          res = b + l * opacity;
          break;
        case 'max':
          res = Math.max(b, l * opacity);
          break;
        case 'min':
          res = Math.min(b, l * opacity);
          break;
        case 'multiply':
          res = b * ((1.0 - opacity) + l * opacity);
          break;
        case 'subtract':
          res = Math.max(0, b - l * opacity);
          break;
        default:
          res = b * (1.0 - opacity) + l * opacity;
      }

      base[i] = res;
    }
  }

  // --- Surface Analysis: Normals, Slopes, Curvature ---

  analyzeTerrain(heightMap, size) {
    const normalMap = new Float32Array(size * size * 3);
    const slopeMap = new Float32Array(size * size);
    const curvatureMap = new Float32Array(size * size);

    let minH = 999999, maxH = -999999, sumH = 0;
    let sumSlope = 0;

    const cellSize = 1.0 / size;
    const invTwoCell = 0.5 / cellSize;

    for (let y = 0; y < size; y++) {
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(size - 1, y + 1);

      for (let x = 0; x < size; x++) {
        const x0 = Math.max(0, x - 1);
        const x1 = Math.min(size - 1, x + 1);

        const idx = y * size + x;
        const h = heightMap[idx];

        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
        sumH += h;

        const hL = heightMap[y * size + x0];
        const hR = heightMap[y * size + x1];
        const hD = heightMap[y0 * size + x];
        const hU = heightMap[y1 * size + x];

        // Central difference gradient
        const dzdx = (hR - hL) * invTwoCell * 0.45;
        const dzdy = (hU - hD) * invTwoCell * 0.45;

        // Normal vector (-dzdx, -dzdy, 1.0) normalized
        const nx = -dzdx;
        const ny = -dzdy;
        const nz = 1.0;
        const len = Math.hypot(nx, ny, nz);

        normalMap[idx * 3 + 0] = nx / len;
        normalMap[idx * 3 + 1] = ny / len;
        normalMap[idx * 3 + 2] = nz / len;

        // Slope angle in degrees (0 = flat, 90 = sheer cliff)
        // cos(theta) = normal.z
        const cosTheta = Math.max(0, Math.min(1.0, nz / len));
        const slopeDeg = (Math.acos(cosTheta) * 180.0) / Math.PI;
        slopeMap[idx] = slopeDeg;
        sumSlope += slopeDeg;

        // Curvature / Laplacian (hL + hR + hD + hU - 4*h)
        // > 0 = concave valley/crevice, < 0 = convex ridge/peak
        const laplacian = (hL + hR + hD + hU - 4.0 * h);
        curvatureMap[idx] = Math.max(-1.0, Math.min(1.0, laplacian * 25.0));
      }
    }

    return {
      normalMap,
      slopeMap,
      curvatureMap,
      stats: {
        minAltitude: Math.round(minH * 500),
        maxAltitude: Math.round(maxH * 500),
        avgAltitude: Math.round((sumH / (size * size)) * 500),
        avgSlope: Math.round(sumSlope / (size * size)),
        vertexCount: size * size,
        triangleCount: (size - 1) * (size - 1) * 2
      }
    };
  }
}
