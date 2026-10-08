// Heightfield + local SDF chunks, seamless by construction.  Pure JS, no Three dependency.
//
//  1. A heightfield h(x,z) (here: cheap procedural ridges + an escarpment) is the ground truth
//     everywhere; it is what erosion would produce in production.
//  2. Cells whose slope exceeds a threshold are "cliff".  A blurred weight W(x,z) ∈ [0,1] is
//     built around them; a chunk (block of C×C heightfield cells) is active if any of its
//     nodes has W > 0.  By construction W == 0 on every face shared with an inactive chunk.
//  3. Inside active chunks a scalar field is sampled on a voxel grid:
//        f(p) = mix( y − h(x,z),                       // plain, exactly linear along grid edges
//                    (y − h) / |(−hx, 1, −hz)| + d(p), // true-ish distance + 3D carving
//                    W(x,z) )
//     d(p) ≥ 0 removes rock: soft beds (a function of y) carved by 3D noise, only on steep
//     faces.  Because soft beds are undercut while hard beds stay, the iso-surface develops
//     genuine overhangs, notches and shelters that a heightfield cannot represent.
//  4. The grid is polygonised with marching tetrahedra.  Where W == 0 (all faces towards the
//     plain heightfield) f is linear along x, z and y edges and along face diagonals, so every
//     iso-crossing lies exactly on the heightfield's piecewise-linear boundary curve: the chunk
//     mesh is watertight with the surrounding heightfield mesh, no stitching needed.  Neighbour
//     chunks share the same f, the same node planes and the same tetra split → watertight too.
//  5. The heightfield mesh simply skips the quads covered by active chunks.

// ---------------------------------------------------------------- noise helpers
function hash3(ix, iy, iz) {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function fade(t) { return t * t * (3 - 2 * t); }
export function value3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
  const c = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz);
  const x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * fx;
  const x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * fx;
  const x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * fx;
  const x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * fx;
  const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}
export function fbm3(x, y, z, octaves) {
  let a = 0.5, s = 0, n = 0;
  for (let i = 0; i < octaves; i++) { s += a * value3(x, y, z); n += a; x = x * 2.03 + 17.1; y = y * 2.01 + 3.7; z = z * 1.97 + 9.3; a *= 0.5; }
  return s / n;
}
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ---------------------------------------------------------------- heightfield
export function makeHeightfield(p) {
  const N = p.nodes; // nodes per side, (N-1) cells
  const size = p.worldSize, spacing = size / (N - 1);
  const h = new Float32Array(N * N);
  const seed = p.seed * 13.7;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = i * spacing - size / 2, z = j * spacing - size / 2;
      // gentle base relief
      const base = (fbm3(x * 0.012 + seed, 0.3, z * 0.012, 4) - 0.5) * 2 * p.baseAmplitude;
      // escarpment: a warped step across the map, height cliffHeight, plus a second ridge step
      const warp = (fbm3(x * 0.02 + seed * 2, 1.7, z * 0.02, 3) - 0.5) * 60;
      const edge = x * 0.6 + z * 0.8 + warp;
      const step1 = smoothstep(-p.cliffWidth, p.cliffWidth, edge - 10) * p.cliffHeight;
      const edge2 = -x * 0.3 + z * 0.95 + warp * 0.7 - 40;
      const step2 = smoothstep(-p.cliffWidth * 0.8, p.cliffWidth * 0.8, edge2) * p.cliffHeight * 0.55;
      // a tower/buttress
      const dx = x - 20 - seed % 30, dz = z + 30;
      const tower = smoothstep(26, 14, Math.sqrt(dx * dx + dz * dz) + warp * 0.2) * p.cliffHeight * 0.8;
      h[j * N + i] = base + step1 + Math.max(step2, tower);
    }
  }
  return { N, size, spacing, h };
}

export function makeSampler(field) {
  const { N, size, spacing, h } = field;
  const half = size / 2;
  function height(x, z) {
    const u = clamp((x + half) / spacing, 0, N - 1.000001), v = clamp((z + half) / spacing, 0, N - 1.000001);
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const a = h[j * N + i], b = h[j * N + i + 1], c = h[(j + 1) * N + i], d = h[(j + 1) * N + i + 1];
    return (a + (b - a) * fu) * (1 - fv) + (c + (d - c) * fu) * fv;
  }
  function gradient(x, z) { // analytic gradient of the bilinear patch
    const u = clamp((x + half) / spacing, 0, N - 1.000001), v = clamp((z + half) / spacing, 0, N - 1.000001);
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const a = h[j * N + i], b = h[j * N + i + 1], c = h[(j + 1) * N + i], d = h[(j + 1) * N + i + 1];
    return [((b - a) * (1 - fv) + (d - c) * fv) / spacing, ((c - a) * (1 - fu) + (d - b) * fu) / spacing];
  }
  return { height, gradient, N, size, spacing, half };
}

// ---------------------------------------------------------------- cliff weight + chunk selection
export function makeCliffWeight(field, p) {
  const { N, spacing, h } = field;
  const tan = Math.tan((p.cliffAngle * Math.PI) / 180);
  const mask = new Uint8Array(N * N);
  for (let j = 1; j < N - 1; j++) {
    for (let i = 1; i < N - 1; i++) {
      const gx = (h[j * N + i + 1] - h[j * N + i - 1]) / (2 * spacing);
      const gz = (h[(j + 1) * N + i] - h[(j - 1) * N + i]) / (2 * spacing);
      if (Math.hypot(gx, gz) > tan) mask[j * N + i] = 1;
    }
  }
  // weight: 1 on cliff nodes, falling to 0 over `blendCells` cells (distance-based)
  const r = Math.max(1, p.blendCells | 0);
  const W = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      let best = 0;
      for (let dj = -r; dj <= r; dj++) {
        const jj = j + dj; if (jj < 0 || jj >= N) continue;
        for (let di = -r; di <= r; di++) {
          const ii = i + di; if (ii < 0 || ii >= N) continue;
          if (!mask[jj * N + ii]) continue;
          const w = 1 - Math.sqrt(di * di + dj * dj) / (r + 1);
          if (w > best) best = w;
        }
      }
      // map border nodes stay 0 so border chunks fade to the plain heightfield there too
      W[j * N + i] = best > 0 && i > 0 && j > 0 && i < N - 1 && j < N - 1 ? smoothstep(0, 1, best) : 0;
    }
  }
  return { W, mask };
}

export function samplerForMap(field, map) {
  return makeSampler({ ...field, h: map }).height;
}

export function selectChunks(field, W, C) {
  const { N } = field; const cells = N - 1; const nc = cells / C;
  if (nc !== Math.floor(nc)) throw new Error(`cells (${cells}) must be a multiple of chunk size (${C})`);
  const active = new Uint8Array(nc * nc);
  const list = [];
  for (let cj = 0; cj < nc; cj++) {
    for (let ci = 0; ci < nc; ci++) {
      let any = false, hmin = Infinity, hmax = -Infinity;
      for (let j = cj * C; j <= cj * C + C && !any; j++) for (let i = ci * C; i <= ci * C + C; i++) if (W[j * N + i] > 0) { any = true; break; }
      if (!any) continue;
      for (let j = cj * C; j <= cj * C + C; j++) for (let i = ci * C; i <= ci * C + C; i++) { const v = field.h[j * N + i]; if (v < hmin) hmin = v; if (v > hmax) hmax = v; }
      active[cj * nc + ci] = 1;
      list.push({ ci, cj, hmin, hmax });
    }
  }
  return { active, list, nc };
}

// ---------------------------------------------------------------- the field
export function makeField(sampler, weightAt, p) {
  const bedK = (2 * Math.PI) / Math.max(0.5, p.bedThickness);
  const ns = 1 / Math.max(0.3, p.noiseScale);
  const seed = p.seed * 7.3;
  function carve(x, y, z, w) {
    const [gx, gz] = sampler.gradient(x, z);
    const steep = smoothstep(0.6, 1.6, Math.hypot(gx, gz));
    if (steep <= 0) return 0;
    // bedding: soft beds are a band of a sine whose thickness drifts and whose planes undulate
    const kVar = 1 + (value3(x * 0.02 + seed, 2.5, z * 0.02) - 0.5) * 0.6;
    const warp = (value3(x * 0.05 + seed, y * 0.05, z * 0.05) - 0.5) * p.bedWarp;
    const sPhase = 0.5 + 0.5 * Math.sin((y + warp) * bedK * kVar + x * 0.01);
    let soft = smoothstep(0.35, 0.55, sPhase) * (1 - smoothstep(0.85, 0.95, sPhase));
    // beds pinch out laterally so the face is not a stack of identical pancakes
    const lateral = fbm3(x * 0.06 + seed * 3, y * 0.015, z * 0.06, 2);
    soft *= smoothstep(0.3, 0.62, lateral);
    const n = fbm3(x * ns + seed, y * ns * 1.4, z * ns, 3);
    const pockets = smoothstep(0.4, 0.7, n);
    // near-vertical joints / chimneys: low y-frequency noise cuts
    const jn = value3(x * 0.12 + seed * 5, y * 0.02, z * 0.12);
    const joint = smoothstep(0.78, 0.9, jn) * p.jointAmount;
    // fine roughness, slightly negative allowed (small bumps)
    const rough = (value3(x * 1.3, y * 1.3, z * 1.3) - 0.45) * 0.5 * p.roughness;
    const d = p.carveDepth * (soft * (0.25 + 0.75 * pockets) + p.pitAmount * smoothstep(0.62, 0.8, n) + joint) + rough;
    return d * steep * w;
  }
  function f(x, y, z) {
    const hh = sampler.height(x, z);
    const plain = y - hh;
    const w = weightAt(x, z);
    if (w <= 0) return plain;
    const [gx, gz] = sampler.gradient(x, z);
    const dist = plain / Math.sqrt(1 + gx * gx + gz * gz);
    return plain + (dist + carve(x, y, z, w) - plain) * w;
  }
  return f;
}

// ---------------------------------------------------------------- marching tetrahedra
const CORNER = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const TETS = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];

export function buildChunkMesh(chunk, field, f, p) {
  const { spacing, size } = field;
  const C = p.chunkCells, k = p.voxelsPerCell, vox = spacing / k;
  const nx = C * k, nz = C * k;
  const x0 = chunk.ci * C * spacing - size / 2, z0 = chunk.cj * C * spacing - size / 2;
  // y range snapped to a global voxel lattice so neighbours share node planes
  // carving d metres along the normal of a face with slope factor s moves the iso-surface up to
  // d·s vertically, so leave room for steep faces (s ≈ 3 at 70°)
  const yLo = Math.floor((chunk.hmin - p.carveDepth * (1 + p.pitAmount) * 3 - 2 * vox) / vox) * vox;
  const yHi = Math.ceil((chunk.hmax + 1 + 2 * vox) / vox) * vox;
  const ny = Math.round((yHi - yLo) / vox);
  const sx = nx + 1, sy = ny + 1, sz = nz + 1;
  const vals = new Float32Array(sx * sy * sz);
  for (let jz = 0; jz < sz; jz++) {
    const z = z0 + jz * vox;
    for (let jy = 0; jy < sy; jy++) {
      const y = yLo + jy * vox;
      for (let jx = 0; jx < sx; jx++) vals[(jz * sy + jy) * sx + jx] = f(x0 + jx * vox, y, z);
    }
  }
  const idx = (ix, iy, iz) => (iz * sy + iy) * sx + ix;
  const pos = [];
  const cv = new Float64Array(8), cp = new Float64Array(24);
  const tv = new Float64Array(4), tp = new Float64Array(12);
  const cross = new Float64Array(12);
  const inside = [], outside = [];
  function edgePoint(a, b, out, o) {
    const va = tv[a], vb = tv[b];
    const t = va / (va - vb);
    out[o] = tp[a * 3] + (tp[b * 3] - tp[a * 3]) * t;
    out[o + 1] = tp[a * 3 + 1] + (tp[b * 3 + 1] - tp[a * 3 + 1]) * t;
    out[o + 2] = tp[a * 3 + 2] + (tp[b * 3 + 2] - tp[a * 3 + 2]) * t;
  }
  function emitTri(a, b, c) { // a,b,c: offsets into cross; orient away from inside corners
    let ix = 0, iy = 0, iz = 0, ox = 0, oy = 0, oz = 0;
    for (const q of inside) { ix += tp[q * 3]; iy += tp[q * 3 + 1]; iz += tp[q * 3 + 2]; }
    for (const q of outside) { ox += tp[q * 3]; oy += tp[q * 3 + 1]; oz += tp[q * 3 + 2]; }
    const dx = ox / outside.length - ix / inside.length, dy = oy / outside.length - iy / inside.length, dz = oz / outside.length - iz / inside.length;
    const ux = cross[b] - cross[a], uy = cross[b + 1] - cross[a + 1], uz = cross[b + 2] - cross[a + 2];
    const vx = cross[c] - cross[a], vy = cross[c + 1] - cross[a + 1], vz = cross[c + 2] - cross[a + 2];
    const nx_ = uy * vz - uz * vy, ny_ = uz * vx - ux * vz, nz_ = ux * vy - uy * vx;
    if (nx_ * dx + ny_ * dy + nz_ * dz < 0) { const t = b; b = c; c = t; }
    pos.push(cross[a], cross[a + 1], cross[a + 2], cross[b], cross[b + 1], cross[b + 2], cross[c], cross[c + 1], cross[c + 2]);
  }
  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        let neg = 0, posC = 0;
        for (let c = 0; c < 8; c++) {
          const v = vals[idx(ix + CORNER[c][0], iy + CORNER[c][1], iz + CORNER[c][2])];
          cv[c] = v; if (v < 0) neg++; else posC++;
          cp[c * 3] = x0 + (ix + CORNER[c][0]) * vox; cp[c * 3 + 1] = yLo + (iy + CORNER[c][1]) * vox; cp[c * 3 + 2] = z0 + (iz + CORNER[c][2]) * vox;
        }
        if (neg === 0 || posC === 0) continue;
        for (const tet of TETS) {
          inside.length = 0; outside.length = 0;
          for (let q = 0; q < 4; q++) {
            tv[q] = cv[tet[q]]; tp[q * 3] = cp[tet[q] * 3]; tp[q * 3 + 1] = cp[tet[q] * 3 + 1]; tp[q * 3 + 2] = cp[tet[q] * 3 + 2];
            (tv[q] < 0 ? inside : outside).push(q);
          }
          if (inside.length === 0 || inside.length === 4) continue;
          if (inside.length === 1 || inside.length === 3) {
            const one = inside.length === 1 ? inside[0] : outside[0];
            const others = inside.length === 1 ? outside : inside;
            edgePoint(one, others[0], cross, 0); edgePoint(one, others[1], cross, 3); edgePoint(one, others[2], cross, 6);
            emitTri(0, 3, 6);
          } else {
            const [a, b] = inside, [c, d] = outside;
            edgePoint(a, c, cross, 0); edgePoint(a, d, cross, 3); edgePoint(b, d, cross, 6); edgePoint(b, c, cross, 9);
            emitTri(0, 3, 6); emitTri(0, 6, 9);
          }
        }
      }
    }
  }
  const positions = new Float32Array(pos);
  // normals = trilinear interpolation of the grid gradient (no extra field evaluations). Where
  // W == 0 the field is y − h, so this reproduces the heightfield normal at the chunk border.
  const normals = new Float32Array(positions.length);
  const gAt = (ix, iy, iz, out) => {
    const xa = Math.max(0, ix - 1), xb = Math.min(nx, ix + 1), ya = Math.max(0, iy - 1), yb = Math.min(ny, iy + 1), za = Math.max(0, iz - 1), zb = Math.min(nz, iz + 1);
    out[0] = (vals[idx(xb, iy, iz)] - vals[idx(xa, iy, iz)]) / (xb - xa);
    out[1] = (vals[idx(ix, yb, iz)] - vals[idx(ix, ya, iz)]) / (yb - ya);
    out[2] = (vals[idx(ix, iy, zb)] - vals[idx(ix, iy, za)]) / (zb - za);
  };
  const g = new Float64Array(3);
  for (let i = 0; i < positions.length; i += 3) {
    const u = Math.min(nx - 1e-6, Math.max(0, (positions[i] - x0) / vox)), v = Math.min(ny - 1e-6, Math.max(0, (positions[i + 1] - yLo) / vox)), w = Math.min(nz - 1e-6, Math.max(0, (positions[i + 2] - z0) / vox));
    const ix = Math.floor(u), iy = Math.floor(v), iz = Math.floor(w), fx = u - ix, fy = v - iy, fz = w - iz;
    let sx_ = 0, sy_ = 0, sz_ = 0;
    for (let c = 0; c < 8; c++) {
      const wgt = (CORNER[c][0] ? fx : 1 - fx) * (CORNER[c][1] ? fy : 1 - fy) * (CORNER[c][2] ? fz : 1 - fz);
      if (wgt === 0) continue;
      gAt(ix + CORNER[c][0], iy + CORNER[c][1], iz + CORNER[c][2], g);
      sx_ += g[0] * wgt; sy_ += g[1] * wgt; sz_ += g[2] * wgt;
    }
    const l = Math.hypot(sx_, sy_, sz_) || 1;
    normals[i] = sx_ / l; normals[i + 1] = sy_ / l; normals[i + 2] = sz_ / l;
  }
  return { positions, normals, voxels: nx * ny * nz, bounds: [x0, yLo, z0, x0 + nx * vox, yHi, z0 + nz * vox] };
}

// ---------------------------------------------------------------- heightfield mesh with holes
export function buildHeightfieldMesh(field, chunks, p) {
  const { N, spacing, size, h } = field; const C = p.chunkCells; const { active, nc } = chunks;
  const pos = [], nrm = [];
  const normalAt = (i, j) => {
    const i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(N - 1, j + 1);
    const gx = (h[j * N + i1] - h[j * N + i0]) / ((i1 - i0) * spacing), gz = (h[j1 * N + i] - h[j0 * N + i]) / ((j1 - j0) * spacing);
    const l = Math.hypot(gx, 1, gz); return [-gx / l, 1 / l, -gz / l];
  };
  const vert = (i, j) => { pos.push(i * spacing - size / 2, h[j * N + i], j * spacing - size / 2); nrm.push(...normalAt(i, j)); };
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      if (active[Math.floor(j / C) * nc + Math.floor(i / C)]) continue;
      vert(i, j); vert(i, j + 1); vert(i + 1, j);
      vert(i + 1, j); vert(i, j + 1); vert(i + 1, j + 1);
    }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm) };
}

// ---------------------------------------------------------------- one-shot build
export function buildHybrid(p, onProgress) {
  const t0 = performance.now();
  const field = makeHeightfield(p);
  const sampler = makeSampler(field);
  const { W, mask } = makeCliffWeight(field, p);
  const weightAt = samplerForMap(field, W);
  const chunks = selectChunks(field, W, p.chunkCells);
  const f = makeField(sampler, weightAt, p);
  const ground = buildHeightfieldMesh(field, chunks, p);
  const chunkMeshes = [];
  let voxels = 0;
  chunks.list.forEach((c, i) => {
    const m = buildChunkMesh(c, field, f, p);
    voxels += m.voxels; chunkMeshes.push(m);
    if (onProgress) onProgress((i + 1) / chunks.list.length);
  });
  let cliffNodes = 0; for (let i = 0; i < mask.length; i++) cliffNodes += mask[i];
  return { field, sampler, f, W, chunks, ground, chunkMeshes, stats: { ms: performance.now() - t0, chunks: chunks.list.length, voxels, cliffNodes, chunkTris: chunkMeshes.reduce((n, m) => n + m.positions.length / 9, 0), groundTris: ground.positions.length / 9 } };
}

export const defaults = {
  seed: 3, nodes: 129, worldSize: 160, baseAmplitude: 6, cliffHeight: 38, cliffWidth: 9,
  cliffAngle: 55, blendCells: 2, chunkCells: 8, voxelsPerCell: 2,
  carveDepth: 3, bedThickness: 5, bedWarp: 3, noiseScale: 4, pitAmount: 0.25, jointAmount: 0.6, roughness: 0.6,
};
