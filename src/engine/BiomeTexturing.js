import { GeologicalNoise } from './Noise.js';

export const TEXTURE_LAYER_TYPES = {
  SNOW_ICE: 'snow_ice',
  GRANITE_CLIFF: 'granite_cliff',
  TALUS_SCREE: 'talus_scree',
  ALPINE_MOSS: 'alpine_moss',
  MONTANE_GRASS: 'montane_grass',
  VALLEY_SOIL: 'valley_soil',
  ALLUVIAL_SAND: 'alluvial_sand',
  WET_ROCK_FLOW: 'wet_rock_flow'
};

export class BiomeTexturingEngine {
  constructor(size = 512) {
    this.size = size;
    this.noise = new GeologicalNoise(999);
  }

  static getDefaultLayers() {
    return [
      {
        id: 'tex-granite-cliff',
        name: 'Deep Granite Bedrock',
        type: TEXTURE_LAYER_TYPES.GRANITE_CLIFF,
        enabled: true,
        bypassed: false,
        opacity: 1.0,
        color1: '#3d3835',
        color2: '#4a443f',
        roughness: 0.85,
        bumpStrength: 0.7,
        rules: {
          altMin: 0,
          altMax: 500,
          altFalloff: 20,
          slopeMin: 38,
          slopeMax: 90,
          slopeFalloff: 10,
          flowWeight: 0.0,
          sedimentWeight: -0.4,
          talusWeight: 0.0,
          cavityWeight: 0.0,
          noiseBreakup: 0.35
        }
      },
      {
        id: 'tex-talus-scree',
        name: 'Scree & Rockfall Cones',
        type: TEXTURE_LAYER_TYPES.TALUS_SCREE,
        enabled: true,
        bypassed: false,
        opacity: 0.9,
        color1: '#665e53',
        color2: '#574f45',
        roughness: 0.92,
        bumpStrength: 0.85,
        rules: {
          altMin: 40,
          altMax: 420,
          altFalloff: 30,
          slopeMin: 24,
          slopeMax: 55,
          slopeFalloff: 8,
          flowWeight: 0.0,
          sedimentWeight: 0.2,
          talusWeight: 0.85,
          cavityWeight: 0.0,
          noiseBreakup: 0.4
        }
      },
      {
        id: 'tex-valley-soil',
        name: 'Valley Loam & Humus',
        type: TEXTURE_LAYER_TYPES.VALLEY_SOIL,
        enabled: true,
        bypassed: false,
        opacity: 0.85,
        color1: '#352b22',
        color2: '#2a221a',
        roughness: 0.9,
        bumpStrength: 0.4,
        rules: {
          altMin: 0,
          altMax: 90,
          altFalloff: 25,
          slopeMin: 0,
          slopeMax: 22,
          slopeFalloff: 6,
          flowWeight: 0.0,
          sedimentWeight: 0.4,
          talusWeight: -0.5,
          cavityWeight: 0.3,
          noiseBreakup: 0.3
        }
      },
      {
        id: 'tex-montane-grass',
        name: 'Alpine Meadow Grass',
        type: TEXTURE_LAYER_TYPES.MONTANE_GRASS,
        enabled: true,
        bypassed: false,
        opacity: 0.95,
        color1: '#54663a',
        color2: '#687948',
        roughness: 0.72,
        bumpStrength: 0.35,
        rules: {
          altMin: 20,
          altMax: 220,
          altFalloff: 40,
          slopeMin: 0,
          slopeMax: 36,
          slopeFalloff: 8,
          flowWeight: 0.0,
          sedimentWeight: -0.2,
          talusWeight: -0.6,
          cavityWeight: 0.2,
          noiseBreakup: 0.45
        }
      },
      {
        id: 'tex-alpine-moss',
        name: 'Subalpine Moss & Lichen',
        type: TEXTURE_LAYER_TYPES.ALPINE_MOSS,
        enabled: true,
        bypassed: false,
        opacity: 0.75,
        color1: '#474d32',
        color2: '#5a623f',
        roughness: 0.8,
        bumpStrength: 0.5,
        rules: {
          altMin: 120,
          altMax: 300,
          altFalloff: 30,
          slopeMin: 10,
          slopeMax: 48,
          slopeFalloff: 10,
          flowWeight: 0.2,
          sedimentWeight: 0.0,
          talusWeight: 0.0,
          cavityWeight: 0.5,
          noiseBreakup: 0.5
        }
      },
      {
        id: 'tex-alluvial-sand',
        name: 'Alluvial Riverbed Sand',
        type: TEXTURE_LAYER_TYPES.ALLUVIAL_SAND,
        enabled: true,
        bypassed: false,
        opacity: 0.88,
        color1: '#7c7059',
        color2: '#8e826b',
        roughness: 0.65,
        bumpStrength: 0.45,
        rules: {
          altMin: 0,
          altMax: 120,
          altFalloff: 20,
          slopeMin: 0,
          slopeMax: 18,
          slopeFalloff: 5,
          flowWeight: 0.4,
          sedimentWeight: 0.85,
          talusWeight: 0.0,
          cavityWeight: 0.4,
          noiseBreakup: 0.25
        }
      },
      {
        id: 'tex-wet-flow',
        name: 'Wet Rock & Watercourse',
        type: TEXTURE_LAYER_TYPES.WET_ROCK_FLOW,
        enabled: true,
        bypassed: false,
        opacity: 0.9,
        color1: '#1f1d1a',
        color2: '#2b2926',
        roughness: 0.18, // Very shiny wet!
        bumpStrength: 0.3,
        rules: {
          altMin: 0,
          altMax: 450,
          altFalloff: 50,
          slopeMin: 0,
          slopeMax: 90,
          slopeFalloff: 5,
          flowWeight: 0.95,
          sedimentWeight: -0.1,
          talusWeight: 0.0,
          cavityWeight: 0.6,
          noiseBreakup: 0.15
        }
      },
      {
        id: 'tex-snow-ice',
        name: 'Glacial Ice & High Snow',
        type: TEXTURE_LAYER_TYPES.SNOW_ICE,
        enabled: true,
        bypassed: false,
        opacity: 0.95,
        color1: '#f0f4f8',
        color2: '#dce6f0',
        roughness: 0.28,
        bumpStrength: 0.25,
        rules: {
          altMin: 220,
          altMax: 500,
          altFalloff: 45,
          slopeMin: 0,
          slopeMax: 46,
          slopeFalloff: 10,
          flowWeight: -0.2,
          sedimentWeight: 0.0,
          talusWeight: 0.0,
          cavityWeight: 0.35, // snow accumulates in crevices
          noiseBreakup: 0.4
        }
      }
    ];
  }

  hexToRgb(hex) {
    let clean = hex.replace('#', '');
    if (clean.length === 3) {
      clean = clean.split('').map(c => c + c).join('');
    }
    const num = parseInt(clean, 16);
    return [
      (num >> 16) & 255,
      (num >> 8) & 255,
      num & 255
    ];
  }

  smoothstep(min, max, value) {
    const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
    return x * x * (3 - 2 * x);
  }

  // Generate PBR texture maps (Albedo RGBA, Roughness R, Normal Map RGBA)
  bakeTextures(terrainData, layers, texSize = 512) {
    const {
      heightMap,
      flowMask,
      sedimentMask,
      talusMask,
      slopeMap,
      curvatureMap,
      normalMap,
      stats
    } = terrainData;

    const terrainGridSize = Math.round(Math.sqrt(heightMap.length));
    const invTexSize = 1.0 / texSize;

    const albedoData = new Uint8Array(texSize * texSize * 4);
    const roughnessData = new Uint8Array(texSize * texSize);
    const normalData = new Uint8Array(texSize * texSize * 4);

    // Active layers in order
    const activeLayers = layers.filter(l => l.enabled && !l.bypassed);

    // Cache RGB colors
    const layerColors = activeLayers.map(l => ({
      c1: this.hexToRgb(l.color1),
      c2: this.hexToRgb(l.color2 || l.color1),
      roughness: l.roughness ?? 0.8,
      bump: l.bumpStrength ?? 0.5,
      rules: l.rules,
      opacity: l.opacity ?? 1.0
    }));

    for (let ty = 0; ty < texSize; ty++) {
      const v = ty * invTexSize;
      const gy = Math.min(terrainGridSize - 1, Math.floor(v * terrainGridSize));

      for (let tx = 0; tx < texSize; tx++) {
        const u = tx * invTexSize;
        const gx = Math.min(terrainGridSize - 1, Math.floor(u * terrainGridSize));
        const gIdx = gy * terrainGridSize + gx;

        const altitude = heightMap[gIdx] * 500; // in meters
        const slope = slopeMap[gIdx]; // in degrees
        const flow = flowMask[gIdx];
        const sediment = sedimentMask[gIdx];
        const talus = talusMask[gIdx];
        const cavity = curvatureMap[gIdx]; // -1 to 1

        // Base background (dark granite bedrock)
        let rAcc = 45, gAcc = 42, bAcc = 39;
        let roughAcc = 0.85;

        // Iterate through texturing layers
        for (let i = 0; i < layerColors.length; i++) {
          const l = layerColors[i];
          const rules = l.rules;

          // Altitude mask
          let altWeight = 1.0;
          if (altitude < rules.altMin) {
            altWeight = this.smoothstep(rules.altMin - rules.altFalloff, rules.altMin, altitude);
          } else if (altitude > rules.altMax) {
            altWeight = 1.0 - this.smoothstep(rules.altMax, rules.altMax + rules.altFalloff, altitude);
          }

          // Slope mask
          let slopeWeight = 1.0;
          if (slope < rules.slopeMin) {
            slopeWeight = this.smoothstep(rules.slopeMin - rules.slopeFalloff, rules.slopeMin, slope);
          } else if (slope > rules.slopeMax) {
            slopeWeight = 1.0 - this.smoothstep(rules.slopeMax, rules.slopeMax + rules.slopeFalloff, slope);
          }

          // Flow mask weight
          let flowW = 1.0;
          if (rules.flowWeight > 0) {
            flowW = (1.0 - rules.flowWeight) + flow * rules.flowWeight;
          } else if (rules.flowWeight < 0) {
            flowW = 1.0 - flow * (-rules.flowWeight);
          }

          // Sediment weight
          let sedW = 1.0;
          if (rules.sedimentWeight > 0) {
            sedW = (1.0 - rules.sedimentWeight) + sediment * rules.sedimentWeight;
          } else if (rules.sedimentWeight < 0) {
            sedW = 1.0 - sediment * (-rules.sedimentWeight);
          }

          // Talus weight
          let talusW = 1.0;
          if (rules.talusWeight > 0) {
            talusW = (1.0 - rules.talusWeight) + talus * rules.talusWeight;
          } else if (rules.talusWeight < 0) {
            talusW = 1.0 - talus * (-rules.talusWeight);
          }

          // Cavity weight (-1 to 1)
          let cavW = 1.0;
          if (rules.cavityWeight !== 0) {
            cavW = Math.max(0, Math.min(1.0, 0.5 + cavity * rules.cavityWeight * 0.8));
          }

          // Organic fractal breakup
          const noisePerturb = 1.0 + (this.noise.perlin2D(u * 14.0 + i * 3.7, v * 14.0 + i * 5.1) - 0.5) * rules.noiseBreakup;

          // Combined layer weight
          let weight = altWeight * slopeWeight * flowW * sedW * talusW * cavW * noisePerturb * l.opacity;
          weight = Math.max(0.0, Math.min(1.0, weight));

          if (weight > 0.001) {
            // Secondary color noise blend
            const colorVariation = (this.noise.perlin2D(u * 28.0 + i * 2.0, v * 28.0 + i * 2.0) + 1.0) * 0.5;
            const lr = l.c1[0] * (1.0 - colorVariation) + l.c2[0] * colorVariation;
            const lg = l.c1[1] * (1.0 - colorVariation) + l.c2[1] * colorVariation;
            const lb = l.c1[2] * (1.0 - colorVariation) + l.c2[2] * colorVariation;

            // Alpha over blend
            rAcc = rAcc * (1.0 - weight) + lr * weight;
            gAcc = gAcc * (1.0 - weight) + lg * weight;
            bAcc = bAcc * (1.0 - weight) + lb * weight;

            roughAcc = roughAcc * (1.0 - weight) + l.roughness * weight;
          }
        }

        const outIdx = (ty * texSize + tx);
        albedoData[outIdx * 4 + 0] = Math.round(rAcc);
        albedoData[outIdx * 4 + 1] = Math.round(gAcc);
        albedoData[outIdx * 4 + 2] = Math.round(bAcc);
        albedoData[outIdx * 4 + 3] = 255;

        roughnessData[outIdx] = Math.round(roughAcc * 255);

        // Combined macro + micro normal map
        const nx = normalMap[gIdx * 3 + 0];
        const ny = normalMap[gIdx * 3 + 1];
        const nz = normalMap[gIdx * 3 + 2];

        // Micro-detail normal noise
        const microNx = this.noise.perlin2D(u * 64.0, v * 64.0) * 0.15;
        const microNy = this.noise.perlin2D(u * 64.0 + 3.3, v * 64.0 + 1.7) * 0.15;

        const fnx = nx + microNx;
        const fny = ny + microNy;
        const fnz = nz;
        const fnLen = Math.hypot(fnx, fny, fnz);

        normalData[outIdx * 4 + 0] = Math.round(((fnx / fnLen) * 0.5 + 0.5) * 255);
        normalData[outIdx * 4 + 1] = Math.round(((fny / fnLen) * 0.5 + 0.5) * 255);
        normalData[outIdx * 4 + 2] = Math.round(((fnz / fnLen) * 0.5 + 0.5) * 255);
        normalData[outIdx * 4 + 3] = 255;
      }
    }

    return {
      albedoData,
      roughnessData,
      normalData,
      texSize
    };
  }
}
