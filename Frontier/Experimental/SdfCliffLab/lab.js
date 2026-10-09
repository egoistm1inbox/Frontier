import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { defaults, makeHeightfield, makeSampler, makeCliffWeight, samplerForMap, selectChunks, makeField, buildChunkMesh, buildHeightfieldMesh } from './hybrid.js';

// ------------------------------------------------------------------ params + UI
const params = { ...defaults };
const sliders = [
  ['Terrain', [
    ['seed', 'Seed', 1, 20, 1, ''],
    ['nodes', 'Heightfield nodes', 65, 257, 64, ''],
    ['cliffHeight', 'Escarpment height', 10, 70, 1, 'm'],
    ['cliffWidth', 'Face width (softness)', 3, 25, 0.5, 'm'],
    ['baseAmplitude', 'Base relief', 0, 20, 0.5, 'm'],
  ]],
  ['Chunking', [
    ['cliffAngle', 'Cliff angle threshold', 30, 80, 1, '°'],
    ['blendCells', 'Blend margin', 1, 5, 1, 'cells'],
    ['chunkCells', 'Chunk size', 4, 16, 4, 'cells'],
    ['voxelsPerCell', 'Voxels per cell', 1, 4, 1, ''],
  ]],
  ['Carving (3D)', [
    ['carveDepth', 'Undercut depth', 0, 8, 0.1, 'm'],
    ['bedThickness', 'Bed thickness', 1.5, 14, 0.5, 'm'],
    ['bedWarp', 'Bed undulation', 0, 10, 0.5, 'm'],
    ['noiseScale', 'Pocket scale', 1, 12, 0.5, 'm'],
    ['pitAmount', 'Pits', 0, 1, 0.05, ''],
    ['jointAmount', 'Joints / chimneys', 0, 1.5, 0.05, ''],
    ['roughness', 'Fine roughness', 0, 1.5, 0.05, ''],
  ]],
];
const view = { heightfieldOnly: false, tint: true, bounds: false, wireframe: false };
const controls = document.getElementById('controls');
for (const [title, list] of sliders) {
  controls.insertAdjacentHTML('beforeend', `<h2>${title}</h2>`);
  for (const [key, label, min, max, step, unit] of list) {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<label><span>${label}</span><small><b data-v="${key}">${params[key]}</b> ${unit}</small></label><input type="range" min="${min}" max="${max}" step="${step}" value="${params[key]}" data-k="${key}">`;
    controls.appendChild(row);
  }
}
controls.insertAdjacentHTML('beforeend', `<h2>View</h2><div class="toggles">
  <label><input type="checkbox" data-t="heightfieldOnly"> Heightfield only (compare)</label>
  <label><input type="checkbox" data-t="tint" checked> Tint SDF chunks</label>
  <label><input type="checkbox" data-t="bounds"> Show chunk bounds</label>
  <label><input type="checkbox" data-t="wireframe"> Wireframe</label></div>`);
controls.addEventListener('input', (e) => {
  const k = e.target.dataset.k; if (!k) return;
  params[k] = Number(e.target.value);
  if (k === 'nodes') { params.nodes = Math.round((params.nodes - 1) / 64) * 64 + 1; e.target.value = params.nodes; }
  controls.querySelector(`[data-v="${k}"]`).textContent = params[k];
});
controls.addEventListener('change', (e) => { const t = e.target.dataset.t; if (!t) return; view[t] = e.target.checked; applyView(); });
window.addEventListener('keydown', (e) => {
  const map = { h: 'heightfieldOnly', c: 'tint', b: 'bounds', w: 'wireframe' };
  const t = map[e.key.toLowerCase()]; if (!t || e.target.tagName === 'INPUT') return;
  view[t] = !view[t]; controls.querySelector(`[data-t="${t}"]`).checked = view[t]; applyView();
});

// ------------------------------------------------------------------ scene
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb8d6); scene.fog = new THREE.Fog(0x9fb8d6, 180, 520);
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2000);
camera.position.set(45, 60, -140);
const orbit = new OrbitControls(camera, canvas); orbit.target.set(10, 20, 0); orbit.enableDamping = true;
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6); sun.position.set(80, 120, 60); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = sun.shadow.camera.bottom = -130; sun.shadow.camera.right = sun.shadow.camera.top = 130; sun.shadow.camera.far = 400; sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.3;
scene.add(sun, new THREE.HemisphereLight(0xbfd4ee, 0x5a4a3a, 0.9));

// strata + slope colouring in world space so heightfield and chunk meshes shade identically
function makeMaterial(tinted) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBed = { value: params.bedThickness };
    sh.uniforms.uTint = { value: tinted ? 1 : 0 };
    m.userData.shader = sh;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec3 vWn;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz; vWn = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec3 vWn; uniform float uBed; uniform float uTint;\nfloat hsh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float band = 0.5 + 0.5 * sin(vWp.y * 6.2831853 / uBed + sin(vWp.x * 0.05) * 1.5);
        float lam = 0.5 + 0.5 * sin(vWp.y * 6.2831853 / uBed * 5.0);
        vec3 hard = vec3(0.70, 0.60, 0.50), soft = vec3(0.52, 0.42, 0.35);
        vec3 rock = mix(hard, soft, smoothstep(0.35, 0.7, band)) * (0.93 + 0.07 * lam);
        rock *= 0.9 + 0.2 * hsh(floor(vWp * 2.0));
        float flat_ = smoothstep(0.55, 0.8, vWn.y);
        vec3 grass = vec3(0.36, 0.44, 0.22) * (0.9 + 0.2 * hsh(floor(vWp * 0.7)));
        vec3 col = mix(rock, grass, flat_);
        // down-facing (overhang ceilings) a touch darker + cooler
        col *= mix(1.0, 0.75, smoothstep(0.0, -0.4, vWn.y));
        col = mix(col, col * vec3(0.85, 0.95, 1.25), uTint * 0.6);
        diffuseColor.rgb *= col;`);
  };
  return m;
}
const matGround = makeMaterial(false), matChunk = makeMaterial(true);
const group = new THREE.Group(); scene.add(group);
const boundsGroup = new THREE.Group(); scene.add(boundsGroup);
let groundMesh = null, groundFull = null, chunkMeshes = [];

function toMesh(data, material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  const m = new THREE.Mesh(g, material); m.castShadow = m.receiveShadow = true; return m;
}
function clear() {
  for (const m of [groundMesh, groundFull, ...chunkMeshes]) if (m) { group.remove(m); m.geometry.dispose(); }
  boundsGroup.clear(); groundMesh = groundFull = null; chunkMeshes = [];
}
function applyView() {
  if (groundMesh) groundMesh.visible = !view.heightfieldOnly;
  if (groundFull) groundFull.visible = view.heightfieldOnly;
  for (const m of chunkMeshes) { m.visible = !view.heightfieldOnly; m.material = view.tint ? matChunk : matGround; }
  boundsGroup.visible = view.bounds && !view.heightfieldOnly;
  matGround.wireframe = matChunk.wireframe = view.wireframe;
}

// ------------------------------------------------------------------ build (async, chunk by chunk)
const btn = document.getElementById('build'), bar = document.querySelector('#progress i'), stats = document.getElementById('stats');
const sleep = () => new Promise((r) => setTimeout(r, 0));
async function build() {
  btn.disabled = true; clear();
  const t0 = performance.now();
  const p = { ...params };
  const field = makeHeightfield(p); const sampler = makeSampler(field);
  const { W, mask } = makeCliffWeight(field, p); const weightAt = samplerForMap(field, W);
  const chunks = selectChunks(field, W, p.chunkCells);
  const f = makeField(sampler, weightAt, p);
  groundMesh = toMesh(buildHeightfieldMesh(field, chunks, p), matGround);
  groundFull = toMesh(buildHeightfieldMesh(field, { active: new Uint8Array(chunks.active.length), nc: chunks.nc }, p), matGround);
  group.add(groundMesh, groundFull);
  for (const m of [matGround, matChunk]) if (m.userData.shader) m.userData.shader.uniforms.uBed.value = p.bedThickness;
  let voxels = 0, tris = 0, seamMax = 0, seamN = 0;
  const span = p.chunkCells * field.spacing, half = field.size / 2;
  for (let n = 0; n < chunks.list.length; n++) {
    const c = chunks.list[n];
    const data = buildChunkMesh(c, field, f, p);
    voxels += data.voxels; tris += data.positions.length / 9;
    const mesh = toMesh(data, matChunk); chunkMeshes.push(mesh); group.add(mesh);
    const b = data.bounds;
    const box = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5])), 0xd8c38a); boundsGroup.add(box);
    // seam proof: vertices on faces towards inactive chunks must sit on the heightfield
    const nb = (di, dj) => { const i = c.ci + di, j = c.cj + dj; return i < 0 || j < 0 || i >= chunks.nc || j >= chunks.nc ? 0 : chunks.active[j * chunks.nc + i]; };
    const x0 = c.ci * span - half, x1 = x0 + span, z0 = c.cj * span - half, z1 = z0 + span;
    const pos = data.positions;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], z = pos[i + 2];
      const outer = (Math.abs(x - x0) < 1e-6 && !nb(-1, 0)) || (Math.abs(x - x1) < 1e-6 && !nb(1, 0)) || (Math.abs(z - z0) < 1e-6 && !nb(0, -1)) || (Math.abs(z - z1) < 1e-6 && !nb(0, 1));
      if (!outer) continue;
      seamN++; seamMax = Math.max(seamMax, Math.abs(pos[i + 1] - sampler.height(x, z)));
    }
    bar.style.width = `${((n + 1) / chunks.list.length) * 100}%`;
    if (n % 4 === 3) await sleep();
  }
  applyView();
  let cliffNodes = 0; for (let i = 0; i < mask.length; i++) cliffNodes += mask[i];
  const vox = field.spacing / p.voxelsPerCell;
  stats.textContent = [
    `heightfield   ${field.N}² nodes · ${field.spacing.toFixed(2)} m · ${field.size} m world`,
    `cliff nodes   ${cliffNodes} (> ${p.cliffAngle}°)`,
    `SDF chunks    ${chunks.list.length} / ${chunks.nc * chunks.nc} · voxel ${vox.toFixed(3)} m`,
    `voxels        ${voxels.toLocaleString('en-US')}`,
    `triangles     ground ${(groundMesh.geometry.getAttribute('position').count / 3).toLocaleString('en-US')} · chunks ${tris.toLocaleString('en-US')}`,
    `seam check    ${seamN} border verts, max off-heightfield ${seamMax < 1e-4 ? '< 0.1 mm' : seamMax.toFixed(4) + ' m'}`,
    `build         ${((performance.now() - t0) / 1000).toFixed(2)} s`,
  ].join('\n');
  btn.disabled = false;
}
btn.addEventListener('click', build);

function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
renderer.setAnimationLoop(() => { orbit.update(); renderer.render(scene, camera); });
build();
