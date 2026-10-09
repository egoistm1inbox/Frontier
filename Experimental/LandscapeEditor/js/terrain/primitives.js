// Primitive layer types: the base generators. Each entry in PRIMITIVES is one algorithm with its own
// parameters. None of them combines several algorithms, so each one can be added, removed and tuned on its own.
//
// Every raw field is standardised and scaled by the layer's relief and offset in finishField(), so all types
// sit on one height scale. Constant is the only type that is not standardised.
//
// Sources: Perlin (2002) for classic noise; Gustavson's simplex noise; lattice value noise; Worley (1996) for
// the F_n distances, the crackle form (F2 - F1) and distance-weighted cell values; Lagae et al. (2009, 2010) for
// Gabor and sparse convolution noise; Cook & DeRose (2005) for wavelet noise, here a simplified band-pass tile;
// Musgrave (1994) for fBm, ridged multifractal and billow. Swiss and Jordan are interpretations written for this
// editor, in the same style as the published forms; they are not published definitions. Gaea's (QuadSpinner) node
// implementations are proprietary and are not reproduced here.
import { mulberry32, clamp, smoothstep } from '../core/rng.js';
import { makeNoise, fbm, ridgedFbm } from '../core/noise.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// Stateless integer hash to [0, 1). Any cell can be evaluated in any order, so results never depend on scan order.
export function hashIJ(i, j, s) {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul((s | 0) + 0x632be5ab, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Same seed mixing as the generators used before this file existed, so existing seeds keep their character.
export function seedFor(terrainSeed, layerSeed, salt) {
  return ((terrainSeed * 2654435761) ^ (layerSeed * 40503) ^ salt) >>> 0;
}

const saltOf = (type) => {
  let h = 2166136261;
  for (let k = 0; k < type.length; k++) h = Math.imul(h ^ type.charCodeAt(k), 16777619);
  return h >>> 0;
};

function permutation(seed) {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

// Classic Perlin noise (Perlin 2002): eight gradient directions and the quintic fade curve.
function makePerlin(seed) {
  const perm = permutation(seed);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y) => {
    switch (h & 7) {
      case 0: return x + y;
      case 1: return y - x;
      case 2: return x - y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  };
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[X] + Y];
    const ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y];
    const bb = perm[perm[X + 1] + Y + 1];
    const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf));
    const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
    return x1 + v * (x2 - x1);
  };
}

// Simplex noise (Gustavson 2005): a triangular lattice, so there are no axis-aligned artefacts.
const GRAD12 = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0, 1], [0, -1]];
function makeSimplex(seed) {
  const perm = permutation(seed);
  const mod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) mod12[i] = perm[i] % 12;
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  return (xin, yin) => {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = 1 - i1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      t0 *= t0;
      const g = GRAD12[mod12[ii + perm[jj]]];
      n += t0 * t0 * (g[0] * x0 + g[1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      t1 *= t1;
      const g = GRAD12[mod12[ii + i1 + perm[jj + j1]]];
      n += t1 * t1 * (g[0] * x1 + g[1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      t2 *= t2;
      const g = GRAD12[mod12[ii + 1 + perm[jj + 1]]];
      n += t2 * t2 * (g[0] * x2 + g[1] * y2);
    }
    return 70 * n;
  };
}

// Feature points for the cell-based primitives: one jittered point per integer cell, in a padded window.
function featureGrid(freq, jitter, s) {
  const lo = -3;
  const hi = Math.ceil(freq) + 3;
  const M = hi - lo;
  const fx = new Float32Array(M * M);
  const fy = new Float32Array(M * M);
  const hv = new Float32Array(M * M);
  for (let cj = lo; cj < hi; cj++) {
    for (let ci = lo; ci < hi; ci++) {
      const k = (cj - lo) * M + (ci - lo);
      fx[k] = ci + 0.5 + (hashIJ(ci, cj, s) - 0.5) * jitter;
      fy[k] = cj + 0.5 + (hashIJ(ci, cj, s + 1) - 0.5) * jitter;
      hv[k] = hashIJ(ci, cj, s + 2);
    }
  }
  return { lo, M, fx, fy, hv };
}

// Voronoi F1..F4: distance to the nth nearest feature point. 'crackle' is F2 - F1, which is zero along cell edges.
function voronoi(W, p, s, which) {
  const freq = p.frequency;
  const { lo, M, fx, fy } = featureGrid(freq, clamp(p.jitter, 0, 1), s);
  const out = new Float32Array(W * W);
  const inv = freq / (W - 1);
  const width = clamp(p.width ?? 0.15, 0.01, 0.5);
  for (let y = 0; y < W; y++) {
    const v = y * inv;
    const cj0 = Math.floor(v);
    for (let x = 0; x < W; x++) {
      const u = x * inv;
      const ci0 = Math.floor(u);
      let d0 = Infinity;
      let d1 = Infinity;
      let d2 = Infinity;
      let d3 = Infinity;
      for (let cj = cj0 - 2; cj <= cj0 + 2; cj++) {
        const rowBase = (cj - lo) * M - lo;
        for (let ci = ci0 - 2; ci <= ci0 + 2; ci++) {
          const k = rowBase + ci;
          const dx = fx[k] - u;
          const dy = fy[k] - v;
          const dd = dx * dx + dy * dy;
          if (dd < d3) {
            if (dd < d1) {
              d3 = d2;
              d2 = d1;
              if (dd < d0) {
                d1 = d0;
                d0 = dd;
              } else {
                d1 = dd;
              }
            } else if (dd < d2) {
              d3 = d2;
              d2 = dd;
            } else {
              d3 = dd;
            }
          }
        }
      }
      let val;
      if (which === 'crackle') val = smoothstep(0, width, Math.sqrt(d1) - Math.sqrt(d0));
      else if (which === 1) val = Math.sqrt(d0);
      else if (which === 2) val = Math.sqrt(d1);
      else if (which === 3) val = Math.sqrt(d2);
      else val = Math.sqrt(d3);
      out[y * W + x] = val;
    }
  }
  return out;
}

// Worley cell values: each feature point carries a random height, blended by inverse distance.
function worley(W, p, s) {
  const freq = p.frequency;
  const { lo, M, fx, fy, hv } = featureGrid(freq, clamp(p.jitter, 0, 1), s);
  const e = clamp(p.sharpness, 0.5, 12) * 0.5;
  const out = new Float32Array(W * W);
  const inv = freq / (W - 1);
  for (let y = 0; y < W; y++) {
    const v = y * inv;
    const cj0 = Math.floor(v);
    for (let x = 0; x < W; x++) {
      const u = x * inv;
      const ci0 = Math.floor(u);
      let sw = 0;
      let swh = 0;
      for (let cj = cj0 - 1; cj <= cj0 + 1; cj++) {
        const rowBase = (cj - lo) * M - lo;
        for (let ci = ci0 - 1; ci <= ci0 + 1; ci++) {
          const k = rowBase + ci;
          const dx = fx[k] - u;
          const dy = fy[k] - v;
          const w = Math.pow(dx * dx + dy * dy + 1e-9, -e);
          sw += w;
          swh += w * hv[k];
        }
      }
      out[y * W + x] = swh / sw;
    }
  }
  return out;
}

// Cellular automaton: random seed cells, a cave rule run on a coarse periodic grid, then smoothed and resampled.
function cellular(W, p, s) {
  const M = clamp(Math.round(p.frequency * 12), 16, 96);
  const fill = clamp(p.fill, 0.2, 0.7);
  const steps = clamp(Math.round(p.steps), 1, 12);
  let a = new Uint8Array(M * M);
  let b = new Uint8Array(M * M);
  for (let i = 0; i < M * M; i++) a[i] = hashIJ(i % M, (i / M) | 0, s) < fill ? 1 : 0;
  for (let t = 0; t < steps; t++) {
    for (let y = 0; y < M; y++) {
      for (let x = 0; x < M; x++) {
        let c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            c += a[((y + dy + M) % M) * M + ((x + dx + M) % M)];
          }
        }
        const i = y * M + x;
        b[i] = c >= 5 || (a[i] && c >= 4) ? 1 : 0;
      }
    }
    const tmp = a;
    a = b;
    b = tmp;
  }
  // Local density (0..1) on the coarse grid, then bilinear resampling to W with wrap-around.
  const dens = new Float32Array(M * M);
  for (let y = 0; y < M; y++) {
    for (let x = 0; x < M; x++) {
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) c += a[((y + dy + M) % M) * M + ((x + dx + M) % M)];
      dens[y * M + x] = c / 9;
    }
  }
  const out = new Float32Array(W * W);
  const inv = M / (W - 1);
  for (let y = 0; y < W; y++) {
    const fy = y * inv;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = x * inv;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const xa = x0 % M;
      const xb = (x0 + 1) % M;
      const ya = y0 % M;
      const yb = (y0 + 1) % M;
      const top = dens[ya * M + xa] * (1 - tx) + dens[ya * M + xb] * tx;
      const bot = dens[yb * M + xa] * (1 - tx) + dens[yb * M + xb] * tx;
      out[y * W + x] = top * (1 - ty) + bot * ty;
    }
  }
  return out;
}

// Impulse noise: random kernels scattered one per cell, summed in a 3x3 neighbourhood. Gabor kernels carry an
// oriented cosine (directional); sparse convolution uses an isotropic Gaussian with the same scattering.
function impulses(W, p, s, gabor) {
  const freq = p.frequency;
  const sigma = clamp(p.bandwidth, 0.12, 0.5);
  const K = clamp(Math.round(p.impulses), 1, 6);
  const th = (gabor ? p.angle : 0) * DEG;
  const ct = Math.cos(th);
  const st = Math.sin(th);
  const carrier = gabor ? p.carrier * TAU : 0;
  const s2 = sigma * sigma;
  const norm = Math.PI / s2;
  const out = new Float32Array(W * W);
  const inv = freq / (W - 1);
  for (let y = 0; y < W; y++) {
    const v = y * inv;
    const cj0 = Math.floor(v);
    for (let x = 0; x < W; x++) {
      const u = x * inv;
      const ci0 = Math.floor(u);
      let sum = 0;
      for (let cj = cj0 - 1; cj <= cj0 + 1; cj++) {
        for (let ci = ci0 - 1; ci <= ci0 + 1; ci++) {
          for (let k = 0; k < K; k++) {
            const salt = s + 97 * k;
            const px = ci + hashIJ(ci, cj, salt + 1);
            const py = cj + hashIJ(ci, cj, salt + 2);
            const dx = u - px;
            const dy = v - py;
            const r2 = dx * dx + dy * dy;
            if (r2 > 9 * s2) continue;
            const weight = hashIJ(ci, cj, salt + 3) * 2 - 1;
            let g = Math.exp(-norm * r2);
            if (gabor) g *= Math.cos(carrier * (dx * ct + dy * st) + hashIJ(ci, cj, salt + 4) * TAU);
            sum += weight * g;
          }
        }
      }
      out[y * W + x] = sum;
    }
  }
  return out;
}

// Wavelet noise, simplified (Cook & DeRose 2005 style): a periodic random tile is split into two band-pass
// levels with a B3-spline blur, then sampled with periodic bicubic interpolation. Band-limited, not isotropic.
function waveletTile(s) {
  const T = 64;
  const r = new Float32Array(T * T);
  let mean = 0;
  for (let j = 0; j < T; j++) {
    for (let i = 0; i < T; i++) {
      const v = hashIJ(i, j, s) * 2 - 1;
      r[j * T + i] = v;
      mean += v;
    }
  }
  mean /= T * T;
  for (let k = 0; k < T * T; k++) r[k] -= mean;
  // Periodic separable Gaussian blur. A dilated (a trous) kernel leaves a period-two comb in the band, which
  // reads as fine grain, so the blur uses every sample within 3 sigma instead.
  const gauss = (sigma) => {
    const R = Math.max(1, Math.ceil(sigma * 3));
    const w = new Float32Array(2 * R + 1);
    let sum = 0;
    for (let t = -R; t <= R; t++) {
      w[t + R] = Math.exp(-(t * t) / (2 * sigma * sigma));
      sum += w[t + R];
    }
    for (let t = 0; t < w.length; t++) w[t] /= sum;
    return (src) => {
      const tmp = new Float32Array(T * T);
      const dst = new Float32Array(T * T);
      for (let j = 0; j < T; j++) {
        for (let i = 0; i < T; i++) {
          let acc = 0;
          for (let t = -R; t <= R; t++) acc += w[t + R] * src[j * T + ((i + t + 4 * T) % T)];
          tmp[j * T + i] = acc;
        }
      }
      for (let j = 0; j < T; j++) {
        for (let i = 0; i < T; i++) {
          let acc = 0;
          for (let t = -R; t <= R; t++) acc += w[t + R] * tmp[((j + t + 4 * T) % T) * T + i];
          dst[j * T + i] = acc;
        }
      }
      return dst;
    };
  };
  // The texture is the band between two scales, centred on features a few samples across. The finest residual
  // (r - G1) is white noise, so it gets only a small weight.
  const G1 = gauss(1.5)(r);
  const G2 = gauss(3)(G1);
  const tile = new Float32Array(T * T);
  let sq = 0;
  for (let k = 0; k < T * T; k++) {
    const v = G1[k] - G2[k] + 0.15 * (r[k] - G1[k]);
    tile[k] = v;
    sq += v * v;
  }
  const sd = Math.sqrt(sq / (T * T)) || 1;
  for (let k = 0; k < T * T; k++) tile[k] /= sd;
  return { T, tile };
}

const catmull = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));

function wavelet(W, p, s) {
  const { T, tile } = waveletTile(s);
  const freq = p.frequency;
  const out = new Float32Array(W * W);
  const inv = freq / (W - 1);
  const at = (xi, yi) => tile[((yi % T) + T) % T * T + (((xi % T) + T) % T)];
  for (let y = 0; y < W; y++) {
    const qy = y * inv;
    const fy = (qy - Math.floor(qy)) * T;
    const yi = Math.floor(fy);
    const ty = fy - yi;
    for (let x = 0; x < W; x++) {
      const qx = x * inv;
      const fx = (qx - Math.floor(qx)) * T;
      const xi = Math.floor(fx);
      const tx = fx - xi;
      const col = [0, 0, 0, 0];
      for (let m = -1; m <= 2; m++) {
        col[m + 1] = catmull(at(xi - 1, yi + m), at(xi, yi + m), at(xi + 1, yi + m), at(xi + 2, yi + m), tx);
      }
      out[y * W + x] = catmull(col[0], col[1], col[2], col[3], ty);
    }
  }
  return out;
}

// Fractal sums. Each one evaluates a Perlin-style noise on a frequency grid that stays in map units.
function fractalGrid(W, freq, fn) {
  const out = new Float32Array(W * W);
  const inv = freq / (W - 1);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) out[y * W + x] = fn(x * inv, y * inv);
  return out;
}

function fbmRaw(W, p, s) {
  const noise = makeNoise(s);
  const warpN = makeNoise(s ^ 0x5bd1e995);
  const oct = Math.max(1, Math.round(p.octaves));
  const warp = p.warp ?? 0;
  return fractalGrid(W, p.frequency, (x, y) => {
    let sx = x;
    let sy = y;
    if (warp > 0) {
      sx += warp * 1.4 * fbm(warpN, x + 5.2, y + 1.3, 3, 2, 0.5);
      sy += warp * 1.4 * fbm(warpN, x + 1.7, y + 9.2, 3, 2, 0.5);
    }
    return fbm(noise, sx, sy, oct, p.lacunarity, p.gain);
  });
}

function ridgedRaw(W, p, s) {
  const noise = makeNoise(s);
  const warpN = makeNoise(s ^ 0x1d2c3b4a);
  const oct = Math.max(1, Math.round(p.octaves));
  const warp = p.warp ?? 0;
  return fractalGrid(W, p.frequency, (x, y) => {
    let sx = x;
    let sy = y;
    if (warp > 0) {
      sx += warp * 1.1 * fbm(warpN, x + 3.1, y + 7.7, 3, 2, 0.5);
      sy += warp * 1.1 * fbm(warpN, x + 8.3, y + 2.9, 3, 2, 0.5);
    }
    return ridgedFbm(noise, sx, sy, oct, p.lacunarity, p.gain, p.sharpness);
  });
}

// Billow: each octave folds the noise into bumps, |n| mapped to a signed range, so the sum looks pillow-like.
function billowRaw(W, p, s) {
  const noise = makeNoise(s);
  const oct = Math.max(1, Math.round(p.octaves));
  return fractalGrid(W, p.frequency, (x, y) => {
    let sum = 0;
    let amp = 1;
    let f = 1;
    for (let o = 0; o < oct; o++) {
      sum += amp * (2 * Math.abs(noise(x * f, y * f)) - 1);
      amp *= p.gain;
      f *= p.lacunarity;
    }
    return sum;
  });
}

// Swiss-style: squared distance from the zero crossings of each octave, with the sampling point fed back by the
// previous octave. The result has ridges with holes between them.
function swissRaw(W, p, s) {
  const noise = makeNoise(s);
  const oct = Math.max(1, Math.round(p.octaves));
  return fractalGrid(W, p.frequency, (x, y) => {
    let px = x;
    let py = y;
    let sum = 0;
    let amp = 1;
    for (let o = 0; o < oct; o++) {
      const nn = noise(px, py);
      const sw = 1 - Math.abs(nn);
      sum += amp * sw * sw;
      px = px * p.lacunarity + p.warp * nn;
      py = py * p.lacunarity + p.warp * nn * 0.7;
      amp *= p.gain;
    }
    return sum;
  });
}

// Jordan-style: two stages of domain warping, each driven by small fBm fields, then a final fBm.
function jordanRaw(W, p, s) {
  const noise = makeNoise(s);
  const oct = Math.max(1, Math.round(p.octaves));
  const w = p.warp;
  const f3 = (a, b) => fbm(noise, a, b, 3, 2, 0.5);
  return fractalGrid(W, p.frequency, (x, y) => {
    const qx = f3(x, y);
    const qy = f3(x + 5.2, y + 1.3);
    const rx = f3(x + 4 * w * qx + 1.7, y + 4 * w * qy + 9.2);
    const ry = f3(x + 4 * w * qx + 8.3, y + 4 * w * qy + 2.8);
    return fbm(noise, x + 4 * w * rx, y + 4 * w * ry, oct, 2, 0.5);
  });
}

function randomRaw(W, p, s) {
  const size = Math.max(1, Math.round(p.cellSize));
  const out = new Float32Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) out[y * W + x] = hashIJ(Math.floor(x / size), Math.floor(y / size), s);
  return out;
}

// Pattern primitives. These have no seed unless they vary per cell, and they are placed by frequency in map units.
function gridRaw(W, p) {
  const f = p.frequency;
  const wd = clamp(p.width, 0.005, 0.45);
  const soft = Math.max(1e-3, clamp(p.softness, 0, 0.4));
  const inv = f / (W - 1);
  const out = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    const v = y * inv;
    const fv = v - Math.floor(v);
    for (let x = 0; x < W; x++) {
      const u = x * inv;
      const fu = u - Math.floor(u);
      const d = Math.min(fu, 1 - fu, fv, 1 - fv);
      out[y * W + x] = 1 - smoothstep(wd, wd + soft, d);
    }
  }
  return out;
}

function hexRaw(W, p) {
  const f = p.frequency;
  const bevel = clamp(p.bevel, 0, 0.45);
  const inv = f / (W - 1);
  const SQ3 = 1.7320508;
  const mod = (a, m) => a - m * Math.floor(a / m);
  const out = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    const py = y * inv;
    for (let x = 0; x < W; x++) {
      const px = x * inv;
      // Offset from the nearest hex centre, from either of the two interleaved lattices.
      const ax = mod(px, 1) - 0.5;
      const ay = mod(py, SQ3) - SQ3 / 2;
      const bx = mod(px - 0.5, 1) - 0.5;
      const by = mod(py - SQ3 / 2, SQ3) - SQ3 / 2;
      const gx = ax * ax + ay * ay < bx * bx + by * by ? ax : bx;
      const gy = ax * ax + ay * ay < bx * bx + by * by ? ay : by;
      // Distance to the nearest edge of a hexagon with inradius 0.5 (edge normals at 0, 60 and 120 degrees).
      const d = Math.max(Math.abs(gx), Math.abs(0.5 * gx + 0.8660254 * gy), Math.abs(-0.5 * gx + 0.8660254 * gy));
      out[y * W + x] = 1 - smoothstep(0.5 - bevel - 1e-3, 0.5, d);
    }
  }
  return out;
}

function brickRaw(W, p, s) {
  const rows = p.frequency;
  const cols = p.frequency * clamp(p.aspect, 1, 4);
  const mortar = clamp(p.mortar, 0, 0.4);
  const variation = clamp(p.variation, 0, 1);
  const inv = 1 / (W - 1);
  const out = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    const vv = y * inv * rows;
    const row = Math.floor(vv);
    const fv = vv - row;
    const shift = row & 1 ? 0.5 : 0;
    for (let x = 0; x < W; x++) {
      const uu = x * inv * cols + shift;
      const col = Math.floor(uu);
      const fu = uu - col;
      const edge = Math.min(fu, 1 - fu, fv, 1 - fv);
      const perBrick = (hashIJ(col, row, s) - 0.5) * variation;
      out[y * W + x] = smoothstep(mortar, mortar + 0.04, edge) + perBrick;
    }
  }
  return out;
}

function checkerRaw(W, p) {
  const n = p.frequency;
  const soft = Math.max(1e-3, clamp(p.softness, 0, 0.5));
  const inv = 1 / (W - 1);
  const out = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    const cv = y * inv * n;
    const cj = Math.floor(cv);
    const fv = cv - cj;
    for (let x = 0; x < W; x++) {
      const cu = x * inv * n;
      const ci = Math.floor(cu);
      const fu = cu - ci;
      const parity = (ci + cj) & 1 ? 1 : 0;
      const t = smoothstep(0, soft, Math.min(fu, 1 - fu, fv, 1 - fv));
      out[y * W + x] = 0.5 + (parity - 0.5) * t;
    }
  }
  return out;
}

// Wave primitives share one projection: t runs across the map at the chosen angle, in cycles.
function waveRaw(W, p, shape) {
  const th = p.angle * DEG;
  const ct = Math.cos(th) * p.frequency;
  const st = Math.sin(th) * p.frequency;
  const phase = p.phase;
  const inv = 1 / (W - 1);
  const out = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    const v = y * inv;
    for (let x = 0; x < W; x++) {
      const u = x * inv;
      const t = u * ct + v * st + phase;
      const f = t - Math.floor(t);
      let val;
      if (shape === 'sine') val = Math.sin(TAU * t);
      else if (shape === 'sawtooth') val = f;
      else val = 4 * Math.abs(f - 0.5) - 1; // triangle
      out[y * W + x] = val;
    }
  }
  return out;
}

function stripesRaw(W, p) {
  const th = p.angle * DEG;
  const ct = Math.cos(th) * p.frequency;
  const st = Math.sin(th) * p.frequency;
  const soft = Math.max(1e-3, clamp(p.softness, 0, 0.5));
  const duty = clamp(p.duty, 0.02, 0.98);
  const inv = 1 / (W - 1);
  const out = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    const v = y * inv;
    for (let x = 0; x < W; x++) {
      const u = x * inv;
      const t = u * ct + v * st + p.phase;
      const f = t - Math.floor(t);
      out[y * W + x] = smoothstep(-soft, soft, duty - f);
    }
  }
  return out;
}

// Registry. Each entry returns a raw field for a W x W grid. Constant is handled in generatePrimitive().
export const PRIMITIVES = {
  perlin: { raw: (W, p, s) => fractalGrid(W, p.frequency, makePerlin(s)) },
  simplex: { raw: (W, p, s) => fractalGrid(W, p.frequency, makeSimplex(s)) },
  value: {
    raw: (W, p, s) => {
      const linear = p.curve !== 'smooth';
      return fractalGrid(W, p.frequency, (x, y) => {
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        let fx = x - xi;
        let fy = y - yi;
        if (!linear) {
          fx = fx * fx * (3 - 2 * fx);
          fy = fy * fy * (3 - 2 * fy);
        }
        const v00 = hashIJ(xi, yi, s) * 2 - 1;
        const v10 = hashIJ(xi + 1, yi, s) * 2 - 1;
        const v01 = hashIJ(xi, yi + 1, s) * 2 - 1;
        const v11 = hashIJ(xi + 1, yi + 1, s) * 2 - 1;
        const top = v00 + (v10 - v00) * fx;
        const bot = v01 + (v11 - v01) * fx;
        return top + (bot - top) * fy;
      });
    },
  },
  voronoi1: { raw: (W, p, s) => voronoi(W, p, s, 1) },
  voronoi2: { raw: (W, p, s) => voronoi(W, p, s, 2) },
  voronoi3: { raw: (W, p, s) => voronoi(W, p, s, 3) },
  voronoi4: { raw: (W, p, s) => voronoi(W, p, s, 4) },
  crackle: { raw: (W, p, s) => voronoi(W, p, s, 'crackle') },
  worley: { raw: (W, p, s) => worley(W, p, s) },
  cellular: { raw: (W, p, s) => cellular(W, p, s) },
  gabor: { raw: (W, p, s) => impulses(W, p, s, true) },
  sparse: { raw: (W, p, s) => impulses(W, p, s, false) },
  wavelet: { raw: (W, p, s) => wavelet(W, p, s) },
  fbm: { raw: (W, p, s) => fbmRaw(W, p, s) },
  ridged: { raw: (W, p, s) => ridgedRaw(W, p, s) },
  billow: { raw: (W, p, s) => billowRaw(W, p, s) },
  swiss: { raw: (W, p, s) => swissRaw(W, p, s) },
  jordan: { raw: (W, p, s) => jordanRaw(W, p, s) },
  random: { raw: (W, p, s) => randomRaw(W, p, s) },
  grid: { raw: (W, p) => gridRaw(W, p) },
  hex: { raw: (W, p) => hexRaw(W, p) },
  brick: { raw: (W, p, s) => brickRaw(W, p, s) },
  checker: { raw: (W, p) => checkerRaw(W, p) },
  stripes: { raw: (W, p) => stripesRaw(W, p) },
  sine: { raw: (W, p) => waveRaw(W, p, 'sine') },
  sawtooth: { raw: (W, p) => waveRaw(W, p, 'sawtooth') },
  triangle: { raw: (W, p) => waveRaw(W, p, 'triangle') },
};

// Standardise to 2.5 sigma, clamp to [-1, 1], then apply relief (fraction of the full height range) and offset.
// For a fractal with a standard deviation of about 0.2 this matches the amplitude the old generators gave.
export function finishField(raw, p) {
  const n = raw.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += raw[i];
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const d = raw[i] - mean;
    sq += d * d;
  }
  const sd = Math.sqrt(sq / n);
  const k = sd > 1e-12 ? 1 / (2.5 * sd) : 0;
  const relief = p.relief ?? 1;
  const off = p.offset ?? 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let z = (raw[i] - mean) * k;
    if (z < -1) z = -1;
    else if (z > 1) z = 1;
    out[i] = clamp(0.5 + off + relief * 0.5 * z, 0, 1);
  }
  return out;
}

// Final height field of a primitive layer, normalised to [0, 1].
export function generatePrimitive(type, W, p, terrainSeed) {
  if (type === 'constant') return new Float32Array(W * W).fill(clamp(p.value, 0, 1));
  const def = PRIMITIVES[type];
  if (!def) throw new Error('Unknown primitive ' + type);
  const seed = seedFor(terrainSeed, p.seed ?? 0, saltOf(type));
  return finishField(def.raw(W, p, seed), p);
}

// Raw field before standardisation, for the tests.
export function primitiveRaw(type, W, p, terrainSeed) {
  const def = PRIMITIVES[type];
  if (!def) throw new Error('Unknown primitive ' + type);
  return def.raw(W, p, seedFor(terrainSeed, p.seed ?? 0, saltOf(type)));
}
