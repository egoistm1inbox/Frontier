// Plain rock scatter: a jittered grid of candidates accepted by density × slope window × a
// large-scale clustering mask. Sizes follow a power law (many small stones per large one); rocks
// sit on the rendered surface (heightfield + face displacement + mesh detail), follow the slope by
// an adjustable amount and are sunk in by the embed depth. No bed snapping, no protrusion, no
// special-casing — just an ordinary scatter that can be tuned or switched off.

import * as THREE from 'three';
import { mulberry32, smoothstep, SimplexNoise } from './noise.js';
import { makeSampler } from './terrain-geometry.js';

const MAX_INSTANCES = 20000;
const MAX_PEBBLES = 40000;

export function placeRocks(field, params, library) {
  const sampler = makeSampler(field);
  const size = field.worldSize;
  const rand = mulberry32(params.rockSeed * 7919 + 1);
  const cluster = new SimplexNoise(params.rockSeed * 101 + 3);

  const density = Math.max(0, params.rockDensity || 0);
  // candidate spacing: denser grid as density rises, so the slider covers "a few" → "a lot"
  const spacing = size / Math.round(60 + 160 * density);
  const steps = Math.floor(size / spacing);
  const placements = [];

  const slopeLo = Math.tan((params.rockSlopeMin * Math.PI) / 180);
  const slopeHi = Math.tan((params.rockSlopeMax * Math.PI) / 180);
  const clustering = params.rockClustering == null ? 0.5 : params.rockClustering;
  const clusterScale = Math.max(10, params.rockClusterScale || 80);
  const tiltFollow = params.rockTilt == null ? 0.7 : params.rockTilt;

  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion(), qYaw = new THREE.Quaternion(), qTilt = new THREE.Quaternion(), qTumble = new THREE.Quaternion();
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3(), nrm = new THREE.Vector3(), axis = new THREE.Vector3(), target = new THREE.Vector3();

  const sizeMin = params.rockSizeMin, sizeMax = Math.max(params.rockSizeMin + 0.1, params.rockSizeMax);
  const powerLaw = (lo, hi, k) => lo * Math.pow(hi / lo, Math.pow(rand(), k));

  for (let j = 0; j < steps && density > 0; j++) {
    for (let i = 0; i < steps; i++) {
      if (placements.length >= MAX_INSTANCES) break;
      const x = (i + 0.5 + (rand() - 0.5) * 0.95) * spacing - size * 0.5;
      const z = (j + 0.5 + (rand() - 0.5) * 0.95) * spacing - size * 0.5;
      if (Math.abs(x) > size * 0.495 || Math.abs(z) > size * 0.495) continue;
      const h = sampler.height(x, z);
      if (params.waterEnabled && h < params.seaLevel - 1) continue;
      if (field.road && sampler.map('road', x, z) > 0.2) continue;
      if (field.waterLevel && sampler.map('waterLevel', x, z) > h + 0.3) continue;
      const slope = sampler.map('slope', x, z);          // tan(angle)
      // true-3D cliff chunks carve their own faces: no scatter rocks hanging on those walls
      if (field.sdfWeight && slope > 0.9 && sampler.map('sdfWeight', x, z) > 0.4) continue;
      const inWindow = smoothstep(slopeLo * 0.7, slopeLo + 0.02, slope) * (1 - smoothstep(slopeHi, slopeHi * 1.35 + 0.05, slope));
      if (inWindow <= 0.001) continue;
      // clustering: a smooth mask that thins the scatter into groups as the slider rises
      const mask = cluster.fbm(x / clusterScale, z / clusterScale, 3) * 0.5 + 0.5;
      const clusterWeight = clustering <= 0 ? 1 : smoothstep(clustering * 0.6, clustering * 0.6 + 0.35, mask);
      const accept = density * inWindow * clusterWeight * 0.9;
      if (rand() > accept) continue;

      const radius = powerLaw(sizeMin, sizeMax, 2.0);
      const n = sampler.normal(x, z);
      nrm.set(n[0], n[1], n[2]);
      const [px, py, pz] = sampler.surface(x, z, params);
      const geometrySet = radius < 2.2 ? 'small' : 'large';
      const index = Math.floor(rand() * library[geometrySet].length);
      const geometry = library[geometrySet][index];

      target.copy(up).lerp(nrm, tiltFollow).normalize();
      qTilt.setFromUnitVectors(up, target);
      qYaw.setFromAxisAngle(up, rand() * Math.PI * 2);
      axis.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      qTumble.setFromAxisAngle(axis, (rand() - 0.5) * 0.6 * (1 - tiltFollow * 0.5));
      q.copy(qTilt).multiply(qYaw).multiply(qTumble);

      const sx = radius * (0.85 + rand() * 0.3), sy = radius * (0.8 + rand() * 0.4), sz = radius * (0.85 + rand() * 0.3);
      s.set(sx, sy, sz);
      const sink = geometry.userData.height * sy * 0.5 * params.rockEmbed;
      p.set(px, py, pz).addScaledVector(nrm, -sink).addScaledVector(up, -geometry.userData.bottom * sy * (1 - params.rockEmbed) * 0.2);
      m.compose(p, q, s);
      const tone = 0.82 + rand() * 0.3;
      const warm = (rand() - 0.5) * 0.08;
      placements.push({ set: geometrySet, index, matrix: m.clone(), kind: 'scatter', color: [tone + warm, tone, tone - warm] });
    }
  }
  // ---- pebbles: dense small stones on scree aprons and river beds -----------------------------
  const pebbleDensity = params.pebblesOn ? Math.max(0, params.pebbleDensity || 0) : 0;
  if (pebbleDensity > 0 && library.pebble) {
    const pSpacing = size / Math.round(160 + 420 * pebbleDensity);
    const pSteps = Math.floor(size / pSpacing);
    const pMax = Math.max(0.08, params.pebbleSize || 0.5);
    let count = 0;
    for (let j = 0; j < pSteps && count < MAX_PEBBLES; j++) {
      for (let i = 0; i < pSteps && count < MAX_PEBBLES; i++) {
        const x = (i + 0.5 + (rand() - 0.5) * 0.95) * pSpacing - size * 0.5;
        const z = (j + 0.5 + (rand() - 0.5) * 0.95) * pSpacing - size * 0.5;
        if (Math.abs(x) > size * 0.495 || Math.abs(z) > size * 0.495) continue;
        const deposit = sampler.map('deposit', x, z);
        const bed = field.river ? sampler.map('river', x, z) : 0;
        const where = Math.max(smoothstep(0.15, 0.6, deposit), smoothstep(0.4, 0.9, bed));
        if (where <= 0.01) continue;
        const h = sampler.height(x, z);
        if (params.waterEnabled && h < params.seaLevel - 0.5) continue;
        if (field.waterLevel && sampler.map('waterLevel', x, z) > h + 0.6) continue;
        if (field.road && sampler.map('road', x, z) > 0.2) continue;
        const slope = sampler.map('slope', x, z);
        if (slope > 1.1) continue;
        if (rand() > pebbleDensity * where * 0.9) continue;
        const radius = powerLaw(0.08, pMax, 1.6);
        const n = sampler.normal(x, z);
        nrm.set(n[0], n[1], n[2]);
        const [px, py, pz] = sampler.surface(x, z, params);
        const index = Math.floor(rand() * library.pebble.length);
        const geometry = library.pebble[index];
        target.copy(up).lerp(nrm, 0.8).normalize();
        qTilt.setFromUnitVectors(up, target);
        qYaw.setFromAxisAngle(up, rand() * Math.PI * 2);
        axis.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
        qTumble.setFromAxisAngle(axis, (rand() - 0.5) * 1.2);
        q.copy(qTilt).multiply(qYaw).multiply(qTumble);
        s.set(radius * (0.8 + rand() * 0.4), radius * (0.55 + rand() * 0.4), radius * (0.8 + rand() * 0.4));
        p.set(px, py, pz).addScaledVector(nrm, -geometry.userData.height * s.y * 0.5 * 0.55);
        m.compose(p, q, s);
        const tone = 0.75 + rand() * 0.45;
        const warm = (rand() - 0.5) * 0.1;
        placements.push({ set: 'pebble', index, matrix: m.clone(), kind: 'pebble', color: [tone + warm, tone, tone - warm] });
        count++;
      }
    }
  }
  return placements;
}

export function buildRockMeshes(placements, library, material) {
  const groupsByKey = new Map();
  for (const pl of placements) {
    const key = `${pl.set}:${pl.index}`;
    let list = groupsByKey.get(key);
    if (!list) { list = []; groupsByKey.set(key, list); }
    list.push(pl);
  }
  const meshes = [];
  const color = new THREE.Color();
  for (const [key, items] of groupsByKey) {
    const [set, index] = key.split(':');
    const geometry = library[set][Number(index)];
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    items.forEach((pl, i) => { mesh.setMatrixAt(i, pl.matrix); mesh.setColorAt(i, color.setRGB(...pl.color)); });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.name = `rocks-${key}`;
    meshes.push(mesh);
  }
  return meshes;
}
