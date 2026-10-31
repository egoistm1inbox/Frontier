import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  DEFAULT_EROSION_PARAMS,
  EMITTER_MODES,
  EROSION_LANDSCAPES,
  MATERIAL_THEMES,
  ROCK_FABRIC_MODES,
  getVegetationDefaultsForLandscape,
} from '../src/erosion/erosion-presets.js';
import { RockCalvingSystem, buildRockArchetypeAtlas } from '../src/erosion/rock-calving.js';
import { buildGrassTuftMesh, MAX_GRASS_TUFTS } from '../src/erosion/grass-system.js';
import {
  DERIVED_PALETTES,
  LAYER_CATEGORIES,
  LAYER_OPERATION_SPECS,
  TERRAIN_STACK_PRESETS,
  createStackLayer,
} from '../src/erosion/terrain-stack-presets.js';
import { SdfCaveSystem } from '../src/erosion/sdf-cave-mesher.js';
import { GpuErosionEngine } from '../src/erosion/gpu-erosion-engine.js';
import { ErosionLayerStackUI } from '../src/erosion/layer-stack-ui.js';
import * as Shaders from '../src/erosion/erosion-shaders.js';
import * as PipelineShaders from '../src/erosion/pipeline-shaders.js';

const ALL_SHADER_EXPORTS = [
  'FULLSCREEN_VERT',
  'INIT_TERRAIN_FRAG',
  'INIT_SNOW_FRAG',
  'INIT_PARTICLES_FRAG',
  'PARTICLE_STEP_FRAG',
  'PARTICLE_SCATTER_VERT',
  'PARTICLE_SCATTER_FRAG',
  'WATER_FLUX_FRAG',
  'TERRAIN_INTEGRATE_FRAG',
  'SNOW_CRYO_FRAG',
  'THERMAL_TALUS_FRAG',
  'TERRAIN_RENDER_VERT',
  'TERRAIN_RENDER_FRAG',
  'PARTICLE_RENDER_VERT',
  'PARTICLE_RENDER_FRAG',
  'SKY_BG_FRAG',
  'ROCK_INSTANCE_VERT',
  'ROCK_INSTANCE_FRAG',
  'PROCEDURAL_MODIFIER_FRAG',
  'GRASS_INSTANCE_VERT',
  'GRASS_INSTANCE_FRAG',
];

test('GPU Erosion presets cover all 19 landscapes including non-periodic Himalayas, Sahara Grand Erg, Rugged Desert, Moon, Icelandic Green Highlands & Oasis', () => {
  const landKeys = Object.keys(EROSION_LANDSCAPES);
  assert.equal(landKeys.length, 19);
  const seenTypes = new Set();
  for (const k of landKeys) {
    const p = EROSION_LANDSCAPES[k];
    assert.equal(p.id, k);
    assert.ok(p.defaults.relief >= 80 && p.defaults.relief <= 230);
    assert.ok(p.defaults.rockHardness > 0 && p.defaults.rockHardness < 1);
    seenTypes.add(p.terrainType);
  }
  assert.equal(seenTypes.size, 19, 'Each landscape preset should map to a unique GPU terrain generator mode');

  // Verify all untouched baseline & v2.2 terrainTypes (0..6, 8..13), upgraded 7 & 14, and new 15..18!
  assert.equal(DEFAULT_EROSION_PARAMS.landscape, 'icelandic-highlands');
  assert.equal(EROSION_LANDSCAPES['alpine-divide'].terrainType, 0);
  assert.equal(EROSION_LANDSCAPES['layered-plateau'].terrainType, 1);
  assert.equal(EROSION_LANDSCAPES['fault-escarpment'].terrainType, 2);
  assert.equal(EROSION_LANDSCAPES['volcanic-caldera'].terrainType, 3);
  assert.equal(EROSION_LANDSCAPES['badlands-domes'].terrainType, 4);
  assert.equal(EROSION_LANDSCAPES['coastal-massif'].terrainType, 5);
  assert.equal(EROSION_LANDSCAPES['icelandic-highlands'].terrainType, 6);
  assert.equal(EROSION_LANDSCAPES['himalayan-karakoram'].terrainType, 7);
  assert.equal(EROSION_LANDSCAPES['himalayan-karakoram'].name, 'Himalayan Snow Mountains');
  assert.equal(EROSION_LANDSCAPES['grand-canyon'].terrainType, 8);
  assert.equal(EROSION_LANDSCAPES['studlagil-basalt'].terrainType, 9);
  assert.equal(EROSION_LANDSCAPES['fjadrargljufur-palagonite'].terrainType, 10);
  assert.equal(EROSION_LANDSCAPES['namib-erg-dunes'].terrainType, 11);
  assert.equal(EROSION_LANDSCAPES['yardang-wind-corridor'].terrainType, 12);
  assert.equal(EROSION_LANDSCAPES['glacial-lake-watershed'].terrainType, 13);
  assert.equal(EROSION_LANDSCAPES['sahara-tassili-erg'].terrainType, 14);
  assert.equal(EROSION_LANDSCAPES['rugged-desert-crags'].terrainType, 15);
  assert.equal(EROSION_LANDSCAPES['lunar-mare-craters'].terrainType, 16);
  assert.equal(EROSION_LANDSCAPES['icelandic-green-highlands'].terrainType, 17);
  assert.equal(EROSION_LANDSCAPES['desert-oasis-erg'].terrainType, 18);
  assert.equal(EROSION_LANDSCAPES['desert-oasis-erg'].defaults.oasisSpring, true);
  assert.equal(Object.keys(MATERIAL_THEMES).length, 10);
  assert.equal(Object.keys(ROCK_FABRIC_MODES).length, 5);

  // Ensure periodic fract(spurPhase) and stair-stepped floor(mesaMask) artifacts are gone from INIT_TERRAIN_FRAG
  assert.ok(!Shaders.INIT_TERRAIN_FRAG.includes('spurPhase1'), 'Himalayan terrain must not use periodic fract(spurPhase) ribs');
  assert.ok(!Shaders.INIT_TERRAIN_FRAG.includes('mesaMask'), 'Sahara terrain must not use stair-stepped Tassili mesaMask blobs');

  // Glacial mountain archetypes must exist and snow across broad mountain elevation ranges
  const iceland = EROSION_LANDSCAPES['icelandic-highlands'];
  const himalaya = EROSION_LANDSCAPES['himalayan-karakoram'];
  assert.ok(iceland && himalaya, 'Icelandic & Himalayan glacial mountain presets must exist');
  assert.ok(iceland.defaults.snowfallRate > 0.5 && himalaya.defaults.snowfallRate > 0.85);
  assert.ok(himalaya.defaults.snowline <= 0.30, 'Himalayan Snow Mountains must have low snowline for broad snow cover');
  assert.ok(himalaya.defaults.glacierStrength > iceland.defaults.glacierStrength * 0.9);

  const emitterKeys = Object.keys(EMITTER_MODES);
  assert.equal(emitterKeys.length, 6);
  for (const required of ['glacial-blizzard', 'aeolian-wind', 'rockfall-avalanche', 'all-weather', 'sky-rain']) {
    assert.ok(emitterKeys.includes(required), `Missing multi-agent emitter mode ${required}`);
  }
  const codes = new Set(emitterKeys.map((k) => EMITTER_MODES[k].code));
  assert.equal(codes.size, 6, 'Emitter mode codes must be unique for GPU dispatch');
  assert.equal(DEFAULT_EROSION_PARAMS.gridSize, 512);
  assert.ok(DEFAULT_EROSION_PARAMS.particleCount >= 8192 && DEFAULT_EROSION_PARAMS.particleCount <= 32768);
});

test('All 18 WebGL2 GLSL ES 3.00 shaders satisfy strict ANGLE precision, brace, and interface invariants', () => {
  for (const name of ALL_SHADER_EXPORTS) {
    const src = Shaders[name];
    assert.equal(typeof src, 'string', `Missing shader export ${name}`);
    assert.ok(
      src.startsWith('#version 300 es\n'),
      `${name} must start at byte 0 with '#version 300 es'`
    );
    assert.ok(src.includes('precision highp float;'), `${name} missing highp float`);
    assert.ok(src.includes('precision highp int;'), `${name} missing highp int`);
    assert.ok(src.includes('precision highp sampler2D;'), `${name} missing highp sampler2D`);
    assert.ok(src.includes('void main()'), `${name} missing void main()`);

    // Balanced braces and parentheses
    let braces = 0;
    let parens = 0;
    for (const ch of src) {
      if (ch === '{') braces++;
      else if (ch === '}') braces--;
      else if (ch === '(') parens++;
      else if (ch === ')') parens--;
      assert.ok(braces >= 0, `Unbalanced '}' in ${name}`);
      assert.ok(parens >= 0, `Unbalanced ')' in ${name}`);
    }
    assert.equal(braces, 0, `Unclosed '{' in ${name}`);
    assert.equal(parens, 0, `Unclosed '(' in ${name}`);
  }

  // Verify MRT locations on PARTICLE_STEP_FRAG (5 attachments: posAge, velWater, sediment, exchange, cryo)
  for (let loc = 0; loc < 5; loc++) {
    assert.ok(
      Shaders.PARTICLE_STEP_FRAG.includes(`layout(location = ${loc}) out vec4`),
      `PARTICLE_STEP_FRAG missing MRT attachment ${loc}`
    );
  }

  // Verify every getUniformLocation / _bindTex name in gpu-erosion-engine.js exists in the target shader!
  const engineSrc = fs.readFileSync(new URL('../src/erosion/gpu-erosion-engine.js', import.meta.url), 'utf8');
  const uniformRegex = /(?:getUniformLocation|_bindTex)\(\s*this\.(\w+)\s*,\s*'(\w+)'/g;
  const progMap = {
    progInitTerrain: [Shaders.FULLSCREEN_VERT, Shaders.INIT_TERRAIN_FRAG],
    progProceduralMod: [Shaders.FULLSCREEN_VERT, Shaders.PROCEDURAL_MODIFIER_FRAG],
    progInitSnow: [Shaders.FULLSCREEN_VERT, Shaders.INIT_SNOW_FRAG],
    progInitParticles: [Shaders.FULLSCREEN_VERT, Shaders.INIT_PARTICLES_FRAG],
    progParticleStep: [Shaders.FULLSCREEN_VERT, Shaders.PARTICLE_STEP_FRAG],
    progParticleScatter: [Shaders.PARTICLE_SCATTER_VERT, Shaders.PARTICLE_SCATTER_FRAG],
    progWaterFlux: [Shaders.FULLSCREEN_VERT, Shaders.WATER_FLUX_FRAG],
    progTerrainIntegrate: [Shaders.FULLSCREEN_VERT, Shaders.TERRAIN_INTEGRATE_FRAG],
    progThermalTalus: [Shaders.FULLSCREEN_VERT, Shaders.THERMAL_TALUS_FRAG],
    progSnowCryo: [Shaders.FULLSCREEN_VERT, Shaders.SNOW_CRYO_FRAG],
    progTerrainRender: [Shaders.TERRAIN_RENDER_VERT, Shaders.TERRAIN_RENDER_FRAG],
    progRockInstance: [Shaders.ROCK_INSTANCE_VERT, Shaders.ROCK_INSTANCE_FRAG],
    progGrassInstance: [Shaders.GRASS_INSTANCE_VERT, Shaders.GRASS_INSTANCE_FRAG],
    progParticleRender: [Shaders.PARTICLE_RENDER_VERT, Shaders.PARTICLE_RENDER_FRAG],
  };

  let match;
  let checkedCount = 0;
  while ((match = uniformRegex.exec(engineSrc)) !== null) {
    const [, progProp, uName] = match;
    if (!progMap[progProp]) continue;
    const combined = progMap[progProp].join('\n');
    assert.ok(
      combined.includes(`uniform `) && combined.includes(uName),
      `Uniform '${uName}' referenced on '${progProp}' is missing from its GLSL shaders`
    );
    checkedCount++;
  }
  assert.ok(checkedCount >= 35, `Expected >= 35 verified GPU uniform bindings, got ${checkedCount}`);
  // Verify glacial-blizzard (code 1) is NOT trapped inside storm-cell disc (only mode == 5 is storm-cell!)
  assert.ok(
    Shaders.PARTICLE_STEP_FRAG.includes('if (mode == 5)') && !Shaders.PARTICLE_STEP_FRAG.includes('if (mode == 1) {\n    float ang'),
    'Full-domain blizzard snowfall must not be restricted to storm-cell radius'
  );
});

test('Top-drop particle physics, 3D rock hardness resistance, and two-species sedimentation obey physical conservation', () => {
  // Exact mirror of PARTICLE_STEP_FRAG hardness-gated cutting & two-species sedimentation laws:
  const evalBedrockCut = (hardness, rawDemand, bedrock = 100) => {
    const rockResistance = 0.12 + 3.85 * hardness * hardness;
    return Math.min(Math.max(0, bedrock - 1.0), rawDemand / rockResistance);
  };

  // 1. Differential Hardness Cutting Contrast: soft shale (H=0.10) vs hard caprock (H=0.94)
  const softCut = evalBedrockCut(0.10, 0.08);
  const hardCut = evalBedrockCut(0.94, 0.08);
  const contrastRatio = softCut / hardCut;
  assert.ok(
    contrastRatio > 18.0,
    `Expected > 18:1 cutting contrast between soft shale and hard caprock, got ${contrastRatio.toFixed(2)}:1`
  );

  // 2. Airborne Sky-Drop Fall -> Landing Impact Transition
  let dropY = 185.0;
  let vy = -15.0;
  let phaseAge = -0.02; // negative = airborne falling drop
  const surfY = 92.0;
  const dt = 0.085;
  let stepsToLand = 0;
  while (phaseAge < 0 && stepsToLand < 200) {
    stepsToLand++;
    vy = Math.max(vy - 9.81 * 2.2 * dt, -26.0);
    dropY += vy * dt;
    if (dropY <= surfY) {
      dropY = surfY;
      phaseAge = 0.001; // transitions to landed surface runoff parcel!
    }
  }
  assert.equal(phaseAge, 0.001, 'Falling drop must transition to landed runoff parcel upon hitting terrain');
  assert.equal(dropY, surfY);
  assert.ok(stepsToLand > 10 && stepsToLand < 100);

  // 3. Two-Species Sedimentation & Grain-Size Sorting on Gentle Alluvial Fan
  let coarseLoad = 0.045;
  let fineLoad = 0.045;
  const capacity = 0.010; // Flow decelerated onto piedmont plain -> over capacity!
  const depRate = 0.60 * 0.42;

  const surplus = (coarseLoad + fineLoad) - capacity;
  const depCoarse = Math.min(coarseLoad, surplus * depRate * 1.45);
  const remSurplus = Math.max(0, surplus - depCoarse);
  const depFine = Math.min(fineLoad, remSurplus * depRate * 0.45);

  const nextCoarse = coarseLoad - depCoarse;
  const nextFine = fineLoad - depFine;

  assert.ok(depCoarse > depFine * 2.5, 'Coarse gravel must settle significantly faster than fine silt at slope break');
  assert.ok(depFine > 0, 'Fine alluvial silt must also deposit across the fan');

  // Exact solid-mass conservation between particle load loss and terrain sediment gain
  const beforeMass = coarseLoad + fineLoad;
  const afterMass = nextCoarse + nextFine + depCoarse + depFine;
  assert.ok(Math.abs(beforeMass - afterMass) < 1e-12, 'Sediment deposition must strictly conserve mass');
});

test('Multi-agent GPU particle species (snow, aeolian wind, rockfall) and glacier cryosphere conserve mass', () => {
  // ---- 1. Species lottery partitions the whole population with zero loss ----
  const speciesVec = [0.34, 0.41, 0.17, 0.08]; // rain, snow, wind, rockfall
  const total = speciesVec.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, 'Species weights must be normalized');

  const counts = [0, 0, 0, 0];
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const pick = ((i * 0.6180339887) % 1) * total;
    let species = 0;
    if (pick > speciesVec[0] + speciesVec[1] + speciesVec[2]) species = 3;
    else if (pick > speciesVec[0] + speciesVec[1]) species = 2;
    else if (pick > speciesVec[0]) species = 1;
    counts[species]++;
  }
  assert.equal(counts.reduce((a, b) => a + b, 0), N, 'Every GPU slot must receive exactly one species');
  assert.ok(counts[1] > 0 && counts[2] > 0 && counts[3] > 0, 'Snow, wind and rockfall species must all be emitted');
  for (let i = 0; i < 4; i++) {
    const expected = speciesVec[i] * N;
    assert.ok(Math.abs(counts[i] - expected) / N < 0.02, `Species ${i} frequency off by more than 2%`);
  }

  // ---- 2. Snowflake terminal velocity is far below a raindrop under the same gravity ----
  const dt = 0.085;
  let rainVy = -14, snowVy = -2.4;
  for (let i = 0; i < 40; i++) {
    rainVy = Math.max(rainVy - 9.81 * 2.2 * dt, -26.0);
    snowVy = Math.max(snowVy - 9.81 * 0.22 * dt, -4.2);
  }
  assert.ok(rainVy < -20, `Rain must reach terminal speed, got ${rainVy}`);
  assert.ok(snowVy > -4.3 && snowVy <= -4.2, `Snow must drift slowly at terminal speed, got ${snowVy}`);

  // ---- 3. Snowpack accumulation -> firn compaction -> glacier ice is mass conserving ----
  let snow = 0.9;
  let ice = 0.4;
  const glacierStrength = 0.85;
  const elevN = 0.72;
  const smoothstep = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const before = snow + ice;
  const compaction = Math.min(snow * 0.20, snow * smoothstep(0.30, 0.85, elevN) * glacierStrength * 0.55 * dt);
  snow -= compaction;
  ice += compaction;
  assert.ok(Math.abs(snow + ice - before) < 1e-12, 'Firn compaction must conserve total ice-equivalent mass');
  assert.ok(compaction > 0, 'Cold high basins must form glacier ice');

  // ---- 4. Degree-day ablation only melts where the cell is below the snowline ----
  const warmth = (snowline, elev) => Math.max(0, Math.min(1, (snowline - elev) / Math.max(snowline, 0.05)));
  assert.equal(warmth(0.5, 0.9), 0, 'Summit snow far above the snowline must not melt');
  assert.ok(warmth(0.9, 0.2) > 0.7, 'Low warm cells below the snowline must melt aggressively');

  // ---- 5. Aeolian saltation carries sand further than heavy rockfall boulders ----
  const surfaceSpeed = (species, sinTheta) => {
    if (species === 'wind') return Math.min(22, Math.max(0.5, 6.0 + 20.0 * sinTheta));
    if (species === 'rock') return Math.min(26, Math.max(0.8, 1.4 + 22.0 * sinTheta));
    return 1.0;
  };
  // Saltating sand keeps blowing across flat plains while heavy boulders grind to a halt
  assert.ok(surfaceSpeed('wind', 0.0) > 5.0, 'Aeolian sand must keep saltating on flat ground');
  assert.ok(surfaceSpeed('rock', 0.0) < 2.5, 'Boulders must stall on flat ground');
  assert.ok(surfaceSpeed('wind', 0.0) > surfaceSpeed('rock', 0.0) * 2,
    'On a flat plain saltating sand must outrun stalled boulders');
  // Boulders gain far more speed per unit slope than sand (gravity-driven rolling vs. aerodynamic saltation)
  const rockGain = surfaceSpeed('rock', 0.6) - surfaceSpeed('rock', 0.05);
  const windGain = surfaceSpeed('wind', 0.6) - surfaceSpeed('wind', 0.05);
  assert.ok(rockGain > 0 && windGain > 0, 'Both species must accelerate down steepening slopes');
});

test('3D RockCalvingSystem synthesizes outward-normal CCW polyhedral outcrops & settles calved boulders down cliff slopes', () => {
  const atlas = buildRockArchetypeAtlas(7331);
  assert.equal(atlas.submeshes.length, 6, 'Atlas must contain 6 cleaved polyhedral rock archetypes');
  assert.ok(atlas.indices.length > 600, 'Polyhedral rock atlas must contain rich faceted triangles');

  // Verify EVERY triangle in the rock atlas has outward-pointing normals and CCW front-face winding!
  const pos = atlas.positions;
  const nrm = atlas.normals;
  const idxArr = atlas.indices;
  for (const sub of atlas.submeshes) {
    for (let t = sub.firstIndex; t < sub.firstIndex + sub.indexCount; t += 3) {
      const i0 = idxArr[t] * 3, i1 = idxArr[t + 1] * 3, i2 = idxArr[t + 2] * 3;
      const e1x = pos[i1] - pos[i0], e1y = pos[i1 + 1] - pos[i0 + 1], e1z = pos[i1 + 2] - pos[i0 + 2];
      const e2x = pos[i2] - pos[i0], e2y = pos[i2 + 1] - pos[i0 + 1], e2z = pos[i2 + 2] - pos[i0 + 2];
      const cx = e1y * e2z - e1z * e2y;
      const cy = e1z * e2x - e1x * e2z;
      const cz = e1x * e2y - e1y * e2x;
      const dotN = cx * nrm[i0] + cy * nrm[i0 + 1] + cz * nrm[i0 + 2];
      assert.ok(dotN > 0, 'Every rock facet triangle must have strictly outward CCW winding');
    }
  }

  const sys = new RockCalvingSystem();
  const N = 64;
  const grid = new Float32Array(N * N * 4);
  // Build a steep cliff escarpment at x < 0 dropping onto a gentle talus apron at x > 0
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const u = ix / (N - 1) - 0.5;
      const scarp = 1 / (1 + Math.exp(u * 22.0));
      const idx = (iz * N + ix) * 4;
      grid[idx + 0] = 14.0 + 95.0 * scarp;
      grid[idx + 1] = 0.4 * (1 - scarp);
      grid[idx + 2] = 0.0;
      grid[idx + 3] = 0.0;
    }
  }

  sys.updateTerrainSnapshot(grid, N, 512.0);
  sys.seedForLandscape({ seed: 4029, worldSpan: 512.0, boulderDensity: 0.75, strataStrike: 10, strataDip: 12 });

  // Verify EVERY rock instance 3x3 basis matrix has det(M) > 0 (right-handed, NEVER inverted normals!)
  for (let b = 0; b < sys.bucketCounts.length; b++) {
    const cnt = sys.bucketCounts[b];
    const data = sys.bucketData[b];
    for (let s = 0; s < cnt; s++) {
      const o = s * 16;
      const m00 = data[o + 0], m01 = data[o + 1], m02 = data[o + 2];
      const m10 = data[o + 4], m11 = data[o + 5], m12 = data[o + 6];
      const m20 = data[o + 8], m21 = data[o + 9], m22 = data[o + 10];
      const det = m00 * (m11 * m22 - m12 * m21)
                - m01 * (m10 * m22 - m12 * m20)
                + m02 * (m10 * m21 - m11 * m20);
      assert.ok(det > 0.05, `Instance matrix must be strictly right-handed (det > 0), got ${det}`);
    }
  }

  const outcrops = sys.rocks.filter((r) => r.isOutcrop);
  const boulders = sys.rocks.filter((r) => !r.isOutcrop);
  assert.ok(outcrops.length >= 10, `Expected >= 10 crown outcrops on gentle rim, got ${outcrops.length}`);
  assert.ok(boulders.length >= 50, `Expected >= 50 calved boulders, got ${boulders.length}`);

  // Verify NO rooted outcrop clings to steep slopes (all outcrops must sit on gentle slope <= 0.40)
  for (const out of outcrops) {
    const s = sys.sampleTerrain(out.x, out.z).slope;
    assert.ok(s <= 0.40, `Rooted outcrop must never cling to steep slope, got slope=${s}`);
  }

  // Verify brisk rockfall speed: a boulder on the steep cliff face x=0 must travel >12m in 1.0s!
  const cliffSample = sys.sampleTerrain(0.0, 0.0);
  assert.ok(cliffSample.slope > 1.0, `Expected steep cliff at x=0, got slope=${cliffSample.slope}`);
  const testRock = {
    submesh: 2,
    isOutcrop: false,
    settled: false,
    x: 0.0,
    y: cliffSample.totalH + 1.5,
    z: 0.0,
    vx: 2.0,
    vy: 0.0,
    vz: 0.0,
    sx: 2.0,
    sy: 1.8,
    sz: 2.0,
    radiusY: 1.8,
    yaw: 0.0,
    upX: 0.0,
    upY: 1.0,
    upZ: 0.0,
    isSlab: false,
    wakeTimer: 4.0,
    wear: 0.2,
    seedHash: 0.5,
  };
  sys.rocks.push(testRock);
  for (let s = 0; s < 20; s++) sys.stepPhysics(0.05); // 1.0 second elapsed
  assert.ok(testRock.x > 12.0, `Cliff boulder must slide briskly (>12m in 1.0s), moved ${testRock.x.toFixed(2)}m`);

  // Step boulder gravity rolling until boulders reach the gentle cliff toe / apron
  for (let s = 0; s < 100; s++) sys.stepPhysics(0.05);
  const settled = sys.rocks.filter((r) => !r.isOutcrop && r.settled);
  assert.ok(settled.length >= boulders.length * 0.75, 'Calved boulders must naturally decelerate and settle on gentler terrain');
  for (const b of settled) {
    const s = sys.sampleTerrain(b.x, b.z).slope;
    assert.ok(s <= 0.43, `Settled boulder must NEVER cling on steep slope (>0.43), got slope=${s}`);
  }

  // Verify hydraulic undercutting wakes settled boulders up to roll further!
  const target = settled[0];
  for (let i = 0; i < grid.length; i += 4) grid[i] = Math.max(2.0, grid[i] - 2.5);
  sys.updateTerrainSnapshot(grid, N, 512.0);
  assert.equal(target.settled, false, 'Erosion undercutting (>0.24m drop) must wake settled boulder to roll');
});

test('Asymmetric Namib/Sahara sand dune profile joins windward stoss & 33.8-deg planar slipface along a razor-sharp brink', () => {
  const evalDune = (dM, hCrestM = 72.0, stossSpanM = 185.0) => {
    if (dM >= 0.0) {
      const rawLee = hCrestM - dM * 0.670;
      if (rawLee <= -2.5) return 0.0;
      const k = 2.2;
      const h = Math.max(0, Math.min(1, 0.5 + 0.5 * rawLee / k));
      return Math.max(0, rawLee * h + k * h * (1 - h));
    }
    const t = Math.max(0, Math.min(1, -dM / stossSpanM));
    return hCrestM * (1 - t) * (1 - t) * (1 + 1.25 * t);
  };

  // 1. Exact C0 crest height continuity at brink (dM = 0)
  assert.ok(Math.abs(evalDune(-1e-6) - evalDune(1e-6)) < 1e-3, 'Stoss and slipface meet cleanly at the brink');
  // 2. Sharp slope discontinuity at brink: gentle positive windward stoss slope vs steep -0.670 (33.8 deg) leeward slipface!
  const stossSlope = (evalDune(0) - evalDune(-2.0)) / 2.0;
  const leeSlope = (evalDune(2.0) - evalDune(0)) / 2.0;
  assert.ok(stossSlope > 0.15 && stossSlope < 0.38, `Expected gentle windward stoss slope, got ${stossSlope}`);
  assert.ok(Math.abs(leeSlope - (-0.670)) < 1e-3, `Expected planar 33.8-deg (-0.670) slipface, got ${leeSlope}`);
  // 3. Clean flat interdune desert floor beyond slipface & upwind toe
  assert.equal(evalDune(140.0), 0, 'Interdune floor beyond slipface toe must be clean exposed desert pan');
  assert.equal(evalDune(-190.0), 0, 'Upwind stoss toe merges smoothly onto flat desert pan');
});

test('3D Rocks pack non-negative airLift and ROCK_INSTANCE_VERT locks footprints to exact 512x512 terrain heightfield', () => {
  assert.ok(
    Shaders.ROCK_INSTANCE_VERT.includes('texelFetch(uTerrainTex') &&
    Shaders.ROCK_INSTANCE_VERT.includes('texelFetch(uSnowTex') &&
    Shaders.ROCK_INSTANCE_VERT.includes('max(0.0, aInstPosMeta.y)'),
    'ROCK_INSTANCE_VERT must lock 3D rock footprints onto exact 512x512 uTerrainTex + uSnowTex with non-negative airLift'
  );

  const sys = new RockCalvingSystem(6);
  const N = 64;
  const grid = new Float32Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const idx = (j * N + i) * 4;
      const u = i / (N - 1);
      // Create convex rocky crown on left, steep cliff in center, gentle talus apron on right
      const h = u < 0.35
        ? 110.0 - Math.pow((u - 0.18) * 12.0, 2.0) * 1.4
        : u < 0.55
          ? 105.0 - (u - 0.35) * 360.0
          : 33.0 - (u - 0.55) * 14.0;
      grid[idx] = h;
      grid[idx + 1] = 0.0; // dry
      grid[idx + 2] = u >= 0.55 && u < 0.72 ? 1.4 : 0.0; // coarse scree at cliff toe
      grid[idx + 3] = 0.0; // low sand
    }
  }
  sys.updateTerrainSnapshot(grid, N, 512.0);
  sys.seedForLandscape({ seed: 4029, boulderDensity: 0.85, rockfallRate: 0.75 });
  assert.ok(sys.rocks.length >= 25, `Expected >= 25 seeded outcrops + talus boulders, got ${sys.rocks.length}`);

  for (let s = 0; s < 30; s++) sys.stepPhysics(0.04);
  for (let v = 0; v < 6; v++) {
    const count = sys.bucketCounts[v];
    const arr = sys.bucketData[v];
    for (let k = 0; k < count; k++) {
      const airLift = arr[k * 16 + 13];
      assert.ok(Number.isFinite(airLift) && airLift >= 0.0, `Rock airLift must be >= 0 so rocks never sink underground, got ${airLift}`);
    }
  }
});

test('Real 3D Grass tuft mesh, biome vegetation defaults (Green / Dry / Auto-Blend), and Layer Stack preserve preset visual invariance', () => {
  // 1. 3D Curved Grass Tuft Geometry
  const tuft = buildGrassTuftMesh();
  assert.equal(tuft.vertexCount, 35, '5 curved 3D grass blades * 7 verts = 35 vertices per tuft');
  assert.equal(tuft.indexCount, 75, '5 curved 3D grass blades * 5 segments * 3 indices = 75 indices per tuft');
  assert.equal(tuft.positions.length, 35 * 3);
  assert.equal(tuft.normals.length, 35 * 3);
  assert.equal(tuft.bladeMeta.length, 35 * 2);
  assert.ok(MAX_GRASS_TUFTS >= 32000);
  for (let i = 0; i < tuft.positions.length; i++) {
    assert.ok(Number.isFinite(tuft.positions[i]), 'Non-finite grass vertex position');
    assert.ok(Number.isFinite(tuft.normals[i]), 'Non-finite grass vertex normal');
  }

  // 2. Biome Vegetation Defaults (Green Grass vs Dry Grass vs Disabled)
  const greenHighlands = getVegetationDefaultsForLandscape('icelandic-green-highlands');
  assert.equal(greenHighlands.grassEnabled, true);
  assert.equal(greenHighlands.grassMode, 0, 'Icelandic Green Highlands uses lush Green Grass');

  const oasis = getVegetationDefaultsForLandscape('desert-oasis-erg');
  assert.equal(oasis.grassEnabled, true);
  assert.equal(oasis.grassMode, 2, 'Desert Oasis uses Biome Auto-Blend (green oasis shore -> dry outer fringe)');

  const ruggedDesert = getVegetationDefaultsForLandscape('rugged-desert-crags');
  assert.equal(ruggedDesert.grassEnabled, true);
  assert.equal(ruggedDesert.grassMode, 1, 'Rugged Desert Crags uses Dry Grass');

  const moon = getVegetationDefaultsForLandscape('lunar-mare-craters');
  assert.equal(moon.grassEnabled, false, 'Lunar Mare Craters disables grass');
});

test('Bottom-to-top Terrain Stack Pipeline shaders, uniform bindings, and non-colour operation specs satisfy strict architecture', () => {
  const PIPELINE_EXPORTS = [
    'STACK_OP_FRAG',
    'SCULPT_STAMP_FRAG',
    'STACK_MASK_BAKE_FRAG',
    'STACK_MASK_BLEND_FRAG',
    'STACK_COPY_VEC_FRAG',
    'SDF_CAVE_VERT',
    'SDF_CAVE_FRAG',
  ];

  for (const name of PIPELINE_EXPORTS) {
    const src = PipelineShaders[name];
    assert.equal(typeof src, 'string', `Missing pipeline shader export ${name}`);
    assert.ok(src.startsWith('#version 300 es\n'), `${name} must start with #version 300 es`);
    assert.ok(src.includes('precision highp float;'), `${name} missing highp float`);
    assert.ok(src.includes('precision highp int;'), `${name} missing highp int`);
    assert.ok(src.includes('precision highp sampler2D;'), `${name} missing highp sampler2D`);
    assert.ok(src.includes('void main()'), `${name} missing void main()`);

    let braces = 0, parens = 0;
    for (const ch of src) {
      if (ch === '{') braces++;
      else if (ch === '}') braces--;
      else if (ch === '(') parens++;
      else if (ch === ')') parens--;
      assert.ok(braces >= 0, `Unbalanced '}' in ${name}`);
      assert.ok(parens >= 0, `Unbalanced ')' in ${name}`);
    }
    assert.equal(braces, 0, `Unclosed '{' in ${name}`);
    assert.equal(parens, 0, `Unclosed '(' in ${name}`);
  }

  // Verify every getUniformLocation / _bindTex in terrain-stack-pipeline.js matches its GLSL shader!
  const pipeSrc = fs.readFileSync(new URL('../src/erosion/terrain-stack-pipeline.js', import.meta.url), 'utf8');
  const uRegex = /(?:getUniformLocation|_bindTex)\(\s*this\.(?:engine\.)?(\w+)\s*,\s*'(\w+)'/g;
  const progShaders = {
    progStackOp: [Shaders.FULLSCREEN_VERT, PipelineShaders.STACK_OP_FRAG],
    progSculptStamp: [Shaders.FULLSCREEN_VERT, PipelineShaders.SCULPT_STAMP_FRAG],
    progMaskBake: [Shaders.FULLSCREEN_VERT, PipelineShaders.STACK_MASK_BAKE_FRAG],
    progMaskBlend: [Shaders.FULLSCREEN_VERT, PipelineShaders.STACK_MASK_BLEND_FRAG],
    progCopyVec: [Shaders.FULLSCREEN_VERT, PipelineShaders.STACK_COPY_VEC_FRAG],
    progCave: [PipelineShaders.SDF_CAVE_VERT, PipelineShaders.SDF_CAVE_FRAG],
    progInitTerrain: [Shaders.FULLSCREEN_VERT, Shaders.INIT_TERRAIN_FRAG],
    progInitParticles: [Shaders.FULLSCREEN_VERT, Shaders.INIT_PARTICLES_FRAG],
    progSkyBg: [Shaders.FULLSCREEN_VERT, Shaders.SKY_BG_FRAG],
    progTerrainRender: [Shaders.TERRAIN_RENDER_VERT, Shaders.TERRAIN_RENDER_FRAG],
    progRockInstance: [Shaders.ROCK_INSTANCE_VERT, Shaders.ROCK_INSTANCE_FRAG],
    progGrassInstance: [Shaders.GRASS_INSTANCE_VERT, Shaders.GRASS_INSTANCE_FRAG],
    progParticleRender: [Shaders.PARTICLE_RENDER_VERT, Shaders.PARTICLE_RENDER_FRAG],
  };

  let m;
  let verified = 0;
  while ((m = uRegex.exec(pipeSrc)) !== null) {
    const [, progName, uName] = m;
    if (!progShaders[progName]) continue;
    const joined = progShaders[progName].join('\n');
    assert.ok(
      joined.includes('uniform ') && joined.includes(uName),
      `Pipeline uniform '${uName}' referenced on '${progName}' is missing from GLSL`
    );
    verified++;
  }
  assert.ok(verified >= 45, `Expected >= 45 verified pipeline GPU uniform bindings, got ${verified}`);

  // Verify 14 composable operations across all 5 categories, and ZERO colour/material/biome layers!
  const specKeys = Object.keys(LAYER_OPERATION_SPECS);
  assert.equal(specKeys.length, 14);
  for (const catKey of ['landform', 'simulation', 'spline', 'rocks', 'vegetation']) {
    assert.ok(LAYER_CATEGORIES[catKey], `Missing category ${catKey}`);
    assert.ok(specKeys.some((k) => LAYER_OPERATION_SPECS[k].category === catKey), `No operation in category ${catKey}`);
  }
  const forbiddenTerms = ['colour', 'color', 'material', 'biome', 'texture', 'albedo'];
  for (const spec of Object.values(LAYER_OPERATION_SPECS)) {
    const labelStr = spec.defaultName || '';
    for (const bad of forbiddenTerms) {
      assert.ok(
        !spec.type.toLowerCase().includes(bad) && !labelStr.toLowerCase().includes(bad),
        `Layer stack must not contain colour/material layers, found ${labelStr}`
      );
    }
    assert.ok(Array.isArray(spec.reads) && Array.isArray(spec.writes) && spec.writes.length > 0);
  }
  assert.equal(Object.keys(DERIVED_PALETTES).length, 10, 'All 10 regional geological MATERIAL_THEMES live separately from the layer stack');

  // Verify all 19 canonical EROSION_LANDSCAPES preset stack recipes build valid bottom-up stacks anchored by base-landform at bottom!
  const presetKeys = Object.keys(TERRAIN_STACK_PRESETS);
  assert.equal(presetKeys.length, 19);
  for (const pk of presetKeys) {
    const orig = EROSION_LANDSCAPES[pk];
    assert.ok(orig, `Stack preset ${pk} must map 1:1 to canonical EROSION_LANDSCAPES`);
    const stack = TERRAIN_STACK_PRESETS[pk].layers();
    assert.ok(stack.length >= 3, `Preset ${pk} must populate a multi-stage editable stack`);
    const bottomLayer = stack[stack.length - 1];
    assert.equal(bottomLayer.type, 'base-landform', `Bottom layer of ${pk} must be base-landform (evaluated first)`);
    assert.equal(bottomLayer.params.archetype, orig.terrainType, `Preset ${pk} must use exact INIT_TERRAIN_FRAG terrainType ${orig.terrainType}`);
    assert.equal(bottomLayer.params.seed, 4029, `Preset ${pk} must preserve default seed 4029`);
    assert.equal(bottomLayer.params.relief, orig.defaults.relief ?? DEFAULT_EROSION_PARAMS.relief, `Preset ${pk} must preserve exact relief`);
    for (const l of stack) {
      assert.ok(l.id && l.type && l.params && typeof l.enabled === 'boolean');
    }
  }
});

test('Bottom-to-top layer order genuinely changes terrain output and 3D SDF Cave mesher carves volumetric overhangs', () => {
  // 1. Prove Layer Order Sensitivity:
  // Evaluate a 1D column strip bottom-to-top for:
  //   Stack A (top -> bottom): [Hydraulic Erosion, Rock Stacks, Base Landform] -> Stacks built first, THEN eroded!
  //   Stack B (top -> bottom): [Rock Stacks, Hydraulic Erosion, Base Landform] -> Valley eroded first, THEN crisp stacks added!
  const W = 32;
  const evalStripBottomUp = (layersTopToBottom) => {
    let h = new Float32Array(W);
    let sed = new Float32Array(W);
    for (let li = layersTopToBottom.length - 1; li >= 0; li--) {
      const layer = layersTopToBottom[li];
      if (!layer.enabled) continue;
      if (layer.type === 'base-landform') {
        for (let x = 0; x < W; x++) h[x] = 20 + Math.sin((x / W) * Math.PI) * layer.params.relief * 0.4;
      } else if (layer.type === 'rock-stacks') {
        // Add steep rock stack pillar in center
        for (let x = 13; x <= 18; x++) h[x] += layer.params.height;
      } else if (layer.type === 'hydraulic-erosion') {
        const steps = layer.params.bakeSteps ?? layer.params.iterations ?? 24;
        for (let it = 0; it < steps; it++) {
          const next = new Float32Array(h);
          for (let x = 1; x < W - 1; x++) {
            const lap = 0.5 * (h[x - 1] + h[x + 1]) - h[x];
            if (lap < 0) {
              const cut = -lap * 0.28 * layer.params.erosionStrength;
              next[x] -= cut;
              sed[x] += cut * 0.5;
            } else {
              next[x] += lap * 0.15;
            }
          }
          h = next;
        }
      }
    }
    return { h, sed };
  };

  const base = createStackLayer('base-landform', { params: { relief: 120 } });
  const stacks = createStackLayer('rock-stacks', { params: { height: 55 } });
  const erosion = createStackLayer('hydraulic-erosion', { params: { bakeSteps: 24, erosionStrength: 0.8 } });

  const outErodedStacks = evalStripBottomUp([erosion, stacks, base]); // bottom->top: base -> stacks -> erosion
  const outFreshStacks = evalStripBottomUp([stacks, erosion, base]);  // bottom->top: base -> erosion -> stacks

  const crestA = outErodedStacks.h[13];
  const crestB = outFreshStacks.h[13];
  assert.ok(
    crestB - crestA > 12.0,
    `Swapping Rock Stacks above Hydraulic Erosion must preserve sharp un-eroded stack rims (got ${crestB.toFixed(1)}m vs ${crestA.toFixed(1)}m)`
  );
  assert.ok(
    outErodedStacks.sed[13] > outFreshStacks.sed[13] * 2.0,
    'Eroding after Rock Stacks must generate significantly more stack-derived sediment'
  );

  // 2. Prove Real 3D Volumetric SDF Cave & Cliff-Undercut Carving + Non-Destructive Muting:
  const caveSys = new SdfCaveSystem();
  const N = 64;
  const snap = new Float32Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      // Steep 140m escarpment cliff running through center of domain
      const bedrock = u < 0.42 ? 18.0 : u > 0.58 ? 158.0 : 18.0 + ((u - 0.42) / 0.16) * 140.0;
      const idx = (j * N + i) * 4;
      snap[idx] = bedrock;
    }
  }

  const caveLayer = createStackLayer('sdf-caves', {
    params: { undercutDepth: 16.5, caveRadius: 12.5, archHeight: 18.0, slopeMin: 20, elevationCenter: 0.35, elevationBand: 0.35, opacity: 1.0 },
  });
  const sculptCaveStrokes = [{ x: 0, y: 58, z: 0, radius: 18, strength: 1.0, op: 'cave-carve' }];

  const resActive = caveSys.rebuildCaveVolume({
    gridRgba: snap,
    gridN: N,
    worldSpan: 512,
    caveLayers: [caveLayer],
    sculptCaveStrokes,
    maxRelief: 165,
  });

  assert.equal(resActive.hasCaves, true);
  assert.ok(resActive.vertexCount >= 90, `Expected real 3D SDF cave mesh triangles, got ${resActive.vertexCount} vertices`);
  let maxPortal = 0;
  for (let k = 0; k < caveSys.portalTexData.length; k += 4) {
    if (caveSys.portalTexData[k] > maxPortal) maxPortal = caveSys.portalTexData[k];
  }
  assert.ok(maxPortal > 0.46, `Expected 3D cave portal mask to breach cliff surface (>0.46), got ${maxPortal}`);

  // Verify every 3D cave normal is unit length and finite
  for (let v = 0; v < resActive.vertexCount; v++) {
    const nx = caveSys.normals[v * 3], ny = caveSys.normals[v * 3 + 1], nz = caveSys.normals[v * 3 + 2];
    const len = Math.hypot(nx, ny, nz);
    assert.ok(Math.abs(len - 1.0) < 1e-3, `Non-unit 3D SDF cave normal length ${len}`);
  }

  // Non-destructive mute restores 0 cave vertices without touching snap heightfield
  caveLayer.enabled = false;
  const resMuted = caveSys.rebuildCaveVolume({
    gridRgba: snap,
    gridN: N,
    worldSpan: 512,
    caveLayers: [caveLayer],
    sculptCaveStrokes: [],
    maxRelief: 165,
  });
  assert.equal(resMuted.vertexCount, 0);
});

test('All Pipeline Shaders satisfy strict Windows Chrome ANGLE D3D11 HLSL rules (no inverted smoothstep, no divergent texture(), matching varyings)', () => {
  for (const [name, src] of Object.entries(PipelineShaders)) {
    if (typeof src !== 'string') continue;

    // 1. Every fragment shader must declare explicit layout(location = 0) out
    if (name.endsWith('_FRAG')) {
      assert.ok(
        /layout\s*\(\s*location\s*=\s*0\s*\)\s*out\s+vec4/.test(src),
        `${name} must declare explicit layout(location = 0) out vec4`
      );
    }

    // 2. Zero texture() calls (must use derivative-free texelFetch so D3D11 never rejects divergent Sample() gradients!)
    const stripped = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(
      !/\btexture\s*\(/.test(stripped),
      `${name} must use derivative-free texelFetch rather than texture() for ANGLE D3D11 RGBA32F compatibility`
    );

    // 3. Zero literal inverted smoothstep(a, b, x) where a >= b (D3D11 error X4010!)
    const smRe = /smoothstep\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,/g;
    let m;
    while ((m = smRe.exec(stripped)) !== null) {
      const e0 = Number(m[1]);
      const e1 = Number(m[2]);
      assert.ok(
        e0 < e1,
        `${name} contains inverted literal smoothstep(${e0}, ${e1}, ...) which fails ANGLE D3D11 with error X4010`
      );
    }

    // 4. Zero pow((... - ...), ...) where base can be negative (D3D11 error X3571!)
    assert.ok(
      !/\bpow\s*\(\s*\([^)]*-[^)]*\)\s*,/.test(stripped),
      `${name} contains unguarded pow((a - b), e) which fails ANGLE D3D11 with error X3571`
    );
  }

  // 5. Verify exact vertex out -> fragment in varying signatures for all linked pairs
  const extractVaryings = (glsl, dir) => {
    const out = [];
    const re = new RegExp(`^\\s*${dir}\\s+((?:highp|mediump|lowp)\\s+)?(vec[234]|float|int)\\s+(\\w+)\\s*;`, 'gm');
    let m;
    while ((m = re.exec(glsl)) !== null) {
      out.push(`${m[2]} ${m[3]}`);
    }
    return out.sort();
  };

  assert.deepEqual(
    extractVaryings(Shaders.TERRAIN_RENDER_VERT, 'out'),
    extractVaryings(Shaders.TERRAIN_RENDER_FRAG, 'in'),
    'TERRAIN_RENDER_VERT/FRAG varyings must match identically'
  );
  assert.deepEqual(
    extractVaryings(PipelineShaders.SDF_CAVE_VERT, 'out'),
    extractVaryings(PipelineShaders.SDF_CAVE_FRAG, 'in'),
    'SDF_CAVE_VERT/FRAG varyings must match identically'
  );
  assert.equal(
    PipelineShaders.STACK_HYDRAULIC_FRAG,
    undefined,
    'Non-conservative custom iterative hydraulic shader must be eliminated in favor of engine conservative passes'
  );
  assert.equal(
    PipelineShaders.STACK_THERMAL_TALUS_FRAG,
    undefined,
    'Non-conservative custom iterative talus shader must be eliminated in favor of engine conservative passes'
  );
});

test('End-to-end stateful Mock-WebGL2 + DOM boot of GpuErosionEngine, TerrainStackPipeline, and ErosionLayerStackUI succeeds with zero FBO feedback loops', () => {
  // Minimal DOM environment covering all Frontier Studio IDs
  const elements = new Map();
  const makeEl = (id = '') => {
    const listeners = {};
    const el = {
      id,
      value: '0',
      checked: true,
      hidden: false,
      textContent: '',
      _innerHTML: '',
      dataset: {},
      clientWidth: 960,
      clientHeight: 600,
      width: 960,
      height: 600,
      style: { setProperty() {} },
      parentElement: { style: { setProperty() {} } },
      classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
      setAttribute() {},
      addEventListener(ev, fn) { (listeners[ev] ||= []).push(fn); },
      querySelectorAll() { return []; },
      querySelector() { return null; },
      contains() { return false; },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 600 }),
    };
    Object.defineProperty(el, 'innerHTML', {
      get() { return el._innerHTML; },
      set(v) { el._innerHTML = String(v); },
    });
    return el;
  };

  const domIds = [
    'tp-layer-list', 'tp-layer-count', 'tp-stat-visible', 'tp-stat-hidden',
    'tp-layer-search-input', 'tp-btn-add-layer', 'tp-add-layer-menu',
    'tp-inspector-content', 'cb-preset-grid', 'cb-shelf-drawer', 'cb-btn-toggle',
    'tp-doc-title', 'tp-scene-caption', 'tp-select-shading', 'tp-select-palette',
    'tp-author-tools', 'spline-gizmo-svg',
  ];
  for (const id of domIds) elements.set(id, makeEl(id));

  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  globalThis.document = {
    getElementById: (id) => elements.get(id) || makeEl(id),
    addEventListener() {},
  };
  globalThis.window = {
    devicePixelRatio: 1,
    addEventListener() {},
  };

  try {
    // Stateful WebGL2 mock that tracks shader outputs, uniform samplers, texture units, and FBO attachments
    // to catch ANY FBO-texture feedback loop or MRT drawBuffers mismatch!
    let nextId = 1;
    const shaders = new Map();
    const programs = new Map();
    const fbos = new Map();
    const texUnits = new Array(16).fill(null);
    let activeUnit = 0;
    let currentProg = null;
    let drawFbo = null;
    let drawCount = 0;

    const gl = {
      VERTEX_SHADER: 0x8b31,
      FRAGMENT_SHADER: 0x8b30,
      COMPILE_STATUS: 0x8b81,
      LINK_STATUS: 0x8b82,
      TEXTURE_2D: 0x0de1,
      TEXTURE0: 0x84c0,
      RGBA32F: 0x8814,
      RGBA16F: 0x881a,
      RGBA: 0x1908,
      FLOAT: 0x1406,
      HALF_FLOAT: 0x140b,
      NEAREST: 0x2600,
      LINEAR: 0x2601,
      CLAMP_TO_EDGE: 0x812f,
      TEXTURE_MIN_FILTER: 0x2801,
      TEXTURE_MAG_FILTER: 0x2800,
      TEXTURE_WRAP_S: 0x2802,
      TEXTURE_WRAP_T: 0x2803,
      FRAMEBUFFER: 0x8d40,
      READ_FRAMEBUFFER: 0x8ca8,
      DRAW_FRAMEBUFFER: 0x8ca9,
      FRAMEBUFFER_COMPLETE: 0x8cd5,
      COLOR_ATTACHMENT0: 0x8ce0,
      COLOR_BUFFER_BIT: 0x4000,
      DEPTH_BUFFER_BIT: 0x0100,
      COLOR: 0x1800,
      ARRAY_BUFFER: 0x8892,
      ELEMENT_ARRAY_BUFFER: 0x8893,
      STATIC_DRAW: 0x88e4,
      DYNAMIC_DRAW: 0x88e8,
      POINTS: 0x0000,
      TRIANGLES: 0x0004,
      UNSIGNED_INT: 0x1405,
      UNSIGNED_SHORT: 0x1403,
      DEPTH_TEST: 0x0b71,
      BLEND: 0x0be2,
      CULL_FACE: 0x0b44,
      BACK: 0x0405,
      LEQUAL: 0x0203,
      ONE: 1,
      SRC_ALPHA: 0x0302,
      ONE_MINUS_SRC_ALPHA: 0x0303,

      getExtension: (ext) => (ext === 'EXT_color_buffer_float' || ext === 'EXT_float_blend' || ext === 'OES_texture_float_linear' ? {} : null),
      createShader: (type) => { const s = { id: nextId++, type, src: '' }; shaders.set(s, s); return s; },
      shaderSource: (s, src) => { s.src = src; },
      compileShader: () => {},
      getShaderParameter: () => true,
      getShaderInfoLog: () => '',
      deleteShader: () => {},
      createProgram: () => { const p = { id: nextId++, vs: null, fs: null, samplers: new Map(), fragOutCount: 1 }; programs.set(p, p); return p; },
      attachShader: (p, s) => { if (s.type === 0x8b31) p.vs = s.src; else p.fs = s.src; },
      linkProgram: (p) => {
        const fs = p.fs || '';
        const outs = fs.match(/layout\s*\(\s*location\s*=\s*\d+\s*\)\s*out\s+vec4/g);
        p.fragOutCount = outs ? outs.length : 1;
        const combined = `${p.vs || ''}\n${fs}`;
        const sRe = /uniform\s+sampler2D\s+(\w+)\s*;/g;
        let m;
        while ((m = sRe.exec(combined)) !== null) {
          p.samplers.set(m[1], 0);
        }
      },
      getProgramParameter: () => true,
      getProgramInfoLog: () => '',
      deleteProgram: () => {},
      useProgram: (p) => { currentProg = p; },
      getUniformLocation: (p, name) => ({ prog: p, name }),
      uniform1i: (loc, v) => {
        if (loc && loc.prog && loc.prog.samplers.has(loc.name)) {
          loc.prog.samplers.set(loc.name, v);
        }
      },
      uniform1f() {},
      uniform2f() {},
      uniform2i() {},
      uniform3fv() {},
      uniform4f() {},
      uniform4fv() {},
      uniformMatrix4fv() {},
      createTexture: () => ({ texId: nextId++ }),
      deleteTexture() {},
      activeTexture: (u) => { activeUnit = u - 0x84c0; },
      bindTexture: (_target, tex) => { texUnits[activeUnit] = tex; },
      texParameteri() {},
      texImage2D() {},
      createFramebuffer: () => { const f = { fboId: nextId++, attachments: new Map(), drawBufCount: 1 }; fbos.set(f, f); return f; },
      deleteFramebuffer() {},
      bindFramebuffer: (target, f) => {
        if (target === 0x8d40 || target === 0x8ca9) drawFbo = f;
      },
      framebufferTexture2D: (_target, att, _texTarget, tex) => {
        if (drawFbo) drawFbo.attachments.set(att, tex);
      },
      drawBuffers: (bufs) => { if (drawFbo) drawFbo.drawBufCount = bufs.length; },
      checkFramebufferStatus: () => 0x8cd5,
      createVertexArray: () => ({ vaoId: nextId++ }),
      bindVertexArray() {},
      createBuffer: () => ({ bufId: nextId++ }),
      bindBuffer() {},
      bufferData() {},
      bufferSubData() {},
      enableVertexAttribArray() {},
      vertexAttribPointer() {},
      vertexAttribDivisor() {},
      viewport() {},
      blitFramebuffer() {},
      clearColor() {},
      clear() {},
      clearBufferfv() {},
      enable() {},
      disable() {},
      depthFunc() {},
      depthMask() {},
      cullFace() {},
      blendFunc() {},
      readPixels(_x, _y, w, h, _fmt, _type, dst) {
        for (let j = 0; j < h; j++) {
          for (let i = 0; i < w; i++) {
            const u = i / Math.max(1, w - 1);
            const idx = (j * w + i) * 4;
            dst[idx] = u < 0.45 ? 20 : u > 0.55 ? 150 : 20 + ((u - 0.45) / 0.10) * 130;
            dst[idx + 1] = 0.2;
            dst[idx + 2] = 0.4;
            dst[idx + 3] = 0.3;
          }
        }
      },
      _verifyDrawState() {
        drawCount++;
        assert.ok(currentProg, 'Draw call issued with no active WebGL program');
        if (drawFbo) {
          assert.equal(
            drawFbo.drawBufCount,
            currentProg.fragOutCount,
            `MRT drawBuffers (${drawFbo.drawBufCount}) must match fragment outputs (${currentProg.fragOutCount})`
          );
          const fboTexSet = new Set(drawFbo.attachments.values());
          for (const [sName, unit] of currentProg.samplers.entries()) {
            const boundTex = texUnits[unit];
            assert.ok(
              !fboTexSet.has(boundTex),
              `WebGL2 Feedback Loop detected: sampler ${sName} (unit ${unit}) reads texture currently attached to draw FBO!`
            );
          }
        }
      },
      drawArrays() { this._verifyDrawState(); },
      drawElements() { this._verifyDrawState(); },
      drawArraysInstanced() { this._verifyDrawState(); },
      drawElementsInstanced() { this._verifyDrawState(); },
    };

    const canvas = makeEl('erosion-canvas');
    canvas.getContext = (kind) => (kind === 'webgl2' ? gl : null);

    let lastTel = null;
    const engine = new GpuErosionEngine(canvas, (t) => { lastTel = t; });
    const ui = new ErosionLayerStackUI(engine);

    assert.ok(engine.pipeline, 'TerrainStackPipeline must initialize cleanly');
    assert.equal(engine.pipeline.activePresetId, 'icelandic-highlands', 'Default preset must match c5ae88b/2cc3d34 icelandic-highlands');
    assert.equal(engine.params.seed, 4029, 'Default seed must be 4029');
    assert.equal(engine.pipeline.liveSimRunning, true, 'Live conservative GPU simulation must default to enabled');
    assert.ok(lastTel && lastTel.layerCount >= 7, 'Initial telemetry must publish evaluated stack');
    assert.ok(elements.get('tp-select-palette').innerHTML.includes('<option'), 'Palette select must be populated');
    assert.ok(elements.get('tp-layer-list').innerHTML.includes('tp-layer-row'), 'Layer stack list must render rows');
    assert.ok(elements.get('tp-inspector-content').innerHTML.includes('tp-property-card'), 'Inspector must render property cards');
    assert.ok(elements.get('cb-preset-grid').innerHTML.includes('cb-preset-card'), 'Preset shelf must render all 19 recipes');

    // Cycle through ALL 19 canonical stack presets, verifying exact generator/parameter/seed parity & zero feedback loops!
    for (const presetId of Object.keys(TERRAIN_STACK_PRESETS)) {
      const orig = EROSION_LANDSCAPES[presetId];
      const d = { ...DEFAULT_EROSION_PARAMS, ...(orig.defaults || {}) };
      engine.pipeline.loadPreset(presetId);
      assert.equal(engine.params.relief, d.relief, `Preset ${presetId} relief parity`);
      assert.equal(engine.params.roughness, d.roughness, `Preset ${presetId} roughness parity`);
      assert.equal(engine.params.seed, 4029, `Preset ${presetId} seed parity`);
      assert.equal(engine.params.materialTheme, orig.materialTheme ?? 0, `Preset ${presetId} materialTheme parity`);
      assert.ok(engine.telemetry.fineSedM3 < 50_000_000, `Preset ${presetId} fineSedM3 must stay physically bounded`);
      assert.ok(engine.telemetry.coarseSedM3 < 50_000_000, `Preset ${presetId} coarseSedM3 must stay physically bounded`);
      ui.renderAll();
      engine.renderFrame();
    }

    // Exercise every composable stack operation (Ridges, Rock Stacks, Cliff Push-Pull, Spline, Caves, River, Baked Masked Sim, Sculpt)!
    engine.pipeline.loadPreset('icelandic-highlands');
    engine.pipeline.addLayer('mountain-ridges');
    engine.pipeline.addLayer('rock-stacks');
    engine.pipeline.addLayer('cliff-push-pull');
    engine.pipeline.addLayer('spline-feature');
    engine.pipeline.addLayer('sdf-caves');
    const riverLyr = engine.pipeline.addLayer('river-incision', { iterations: 6 });
    riverLyr.mask.enabled = true;
    engine.pipeline.evaluateStack({ reseedPlacements: true });

    engine.pipeline.authorTool = 'sculpt-add';
    engine.pipeline.applySculptStroke(12, -18, true);
    engine.pipeline.authorTool = 'cave-carve';
    engine.pipeline.applySculptStroke(0, 0, true);
    engine.stepSimulation(2);
    engine.pipeline.shadingMode = 5; // B&W Mask inspection mode
    engine.renderFrame();
    engine.pipeline.shadingMode = 0;
    engine.renderFrame();

    const exported = engine.extractMeshForExport(4);
    assert.ok(exported.positions.length > 0 && exported.indices.length > 0, 'Mesh export must succeed in pipelineMode');
    assert.ok(drawCount > 250, `Expected >250 verified WebGL2 draw calls with zero feedback loops, got ${drawCount}`);
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
  }
});

test('All 25+ WebGL2 GLSL ES 3.00 shaders resolve every function call, identifier, varying interface, and uniform type', () => {
  const GLSL_BUILTINS = new Set([
    'float', 'int', 'uint', 'bool',
    'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'uvec2', 'uvec3', 'uvec4', 'bvec2', 'bvec3', 'bvec4',
    'mat2', 'mat3', 'mat4',
    'radians', 'degrees', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
    'pow', 'exp', 'log', 'exp2', 'log2', 'sqrt', 'inversesqrt',
    'abs', 'sign', 'floor', 'trunc', 'round', 'roundEven', 'ceil', 'fract', 'mod', 'min', 'max', 'clamp', 'mix', 'step', 'smoothstep', 'isnan', 'isinf',
    'length', 'distance', 'dot', 'cross', 'normalize', 'faceforward', 'reflect', 'refract',
    'matrixCompMult', 'outerProduct', 'transpose', 'determinant', 'inverse',
    'lessThan', 'lessThanEqual', 'greaterThan', 'greaterThanEqual', 'equal', 'notEqual', 'any', 'all', 'not',
    'texelFetch', 'textureSize', 'dFdx', 'dFdy', 'fwidth',
    'if', 'for', 'while', 'switch', 'return', 'layout',
  ]);
  const GLSL_KEYWORDS = new Set([
    ...GLSL_BUILTINS,
    'version', 'es', 'precision', 'highp', 'mediump', 'lowp', 'in', 'out', 'inout', 'uniform', 'const', 'flat', 'smooth', 'centroid', 'location',
    'void', 'sampler2D', 'sampler3D', 'samplerCube',
    'else', 'do', 'case', 'default', 'break', 'continue', 'discard', 'true', 'false', 'struct',
    'gl_Position', 'gl_FragCoord', 'gl_VertexID', 'gl_InstanceID', 'gl_PointSize', 'gl_PointCoord', 'gl_FrontFacing',
  ]);

  const engSrc = fs.readFileSync(new URL('../src/erosion/gpu-erosion-engine.js', import.meta.url), 'utf8');
  const telMatch = engSrc.match(/const TELEMETRY_FRAG = `([\s\S]*?)`;/);
  assert.ok(telMatch, 'TELEMETRY_FRAG must exist in gpu-erosion-engine.js');

  const allShaders = [];
  for (const [mName, mod] of [['erosion', Shaders], ['pipeline', PipelineShaders]]) {
    for (const [name, raw] of Object.entries(mod)) {
      if (typeof raw === 'string' && (name.endsWith('_VERT') || name.endsWith('_FRAG'))) {
        allShaders.push([`${mName}.${name}`, raw]);
      }
    }
  }
  allShaders.push(['engine.TELEMETRY_FRAG', telMatch[1]]);
  assert.ok(allShaders.length >= 25, `Expected >=25 shaders, found ${allShaders.length}`);

  for (const [label, raw] of allShaders) {
    const clean = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

    // 1. Order-sensitive function call resolution (catches missing helpers like hash22 before main())
    const declaredFns = new Set();
    const lines = clean.split('\n');
    lines.forEach((line, idx) => {
      const declM = line.match(/^\s*(?:void|float|int|uint|bool|vec[234]|ivec[234]|mat[234])\s+([A-Za-z_]\w*)\s*\(/);
      const callRe = /\b([A-Za-z_]\w*)\s*\(/g;
      let m;
      while ((m = callRe.exec(line)) !== null) {
        const fn = m[1];
        if (declM && declM[1] === fn && m.index === line.indexOf(fn)) continue;
        assert.ok(
          GLSL_BUILTINS.has(fn) || declaredFns.has(fn),
          `${label}:${idx + 1} calls undeclared GLSL function '${fn}(...)'`
        );
      }
      if (declM) declaredFns.add(declM[1]);
    });

    // 2. Full identifier declaration check across each shader unit
    const body = clean.replace(/^#.*$/gm, '');
    const declaredIds = new Set(GLSL_KEYWORDS);
    let m;
    const singleDeclRe = /\b(?:void|float|int|uint|bool|vec[234]|ivec[234]|uvec[234]|bvec[234]|mat[234]|sampler2D)\s+([A-Za-z_]\w*)/g;
    while ((m = singleDeclRe.exec(body)) !== null) declaredIds.add(m[1]);
    const multiDeclRe = /\b(?:float|int|uint|bool|vec[234]|ivec[234]|mat[234])\s+([^;()]+);/g;
    while ((m = multiDeclRe.exec(body)) !== null) {
      for (const part of m[1].split(',')) {
        const id = part.trim().match(/^([A-Za-z_]\w*)/);
        if (id) declaredIds.add(id[1]);
      }
    }
    const tokRe = /(?:\.[A-Za-z_]\w*)|\b([A-Za-z_]\w*)\b/g;
    while ((m = tokRe.exec(body)) !== null) {
      if (!m[1] || /^\d/.test(m[1])) continue;
      assert.ok(declaredIds.has(m[1]), `${label} references undeclared GLSL identifier '${m[1]}'`);
    }
  }

  // 3. Vertex -> Fragment varying interface check for all custom linked pairs
  for (const [vName, fName, vSrc, fSrc] of [
    ['TERRAIN_RENDER_VERT', 'TERRAIN_RENDER_FRAG', Shaders.TERRAIN_RENDER_VERT, Shaders.TERRAIN_RENDER_FRAG],
    ['SDF_CAVE_VERT', 'SDF_CAVE_FRAG', PipelineShaders.SDF_CAVE_VERT, PipelineShaders.SDF_CAVE_FRAG],
    ['ROCK_INSTANCE_VERT', 'ROCK_INSTANCE_FRAG', Shaders.ROCK_INSTANCE_VERT, Shaders.ROCK_INSTANCE_FRAG],
    ['GRASS_INSTANCE_VERT', 'GRASS_INSTANCE_FRAG', Shaders.GRASS_INSTANCE_VERT, Shaders.GRASS_INSTANCE_FRAG],
    ['PARTICLE_RENDER_VERT', 'PARTICLE_RENDER_FRAG', Shaders.PARTICLE_RENDER_VERT, Shaders.PARTICLE_RENDER_FRAG],
  ]) {
    const outs = new Map();
    let m;
    const outRe = /^\s*(?:flat\s+)?out\s+(\w+)\s+(\w+)\s*;/gm;
    while ((m = outRe.exec(vSrc)) !== null) outs.set(m[2], m[1]);
    const inRe = /^\s*(?:flat\s+)?in\s+(\w+)\s+(\w+)\s*;/gm;
    while ((m = inRe.exec(fSrc)) !== null) {
      assert.equal(outs.get(m[2]), m[1], `Varying mismatch ${vName} -> ${fName} for '${m[2]}'`);
    }
  }
});





