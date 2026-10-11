// Advanced Geological Multi-fractal & Cellular Noise Engine
// Includes Simplex, Gradient Perlin, Ridged Multifractal, Worley/Voronoi, and Domain Warping

export class GeologicalNoise {
  constructor(seed = 1337) {
    this.seed = seed;
    this.perm = new Uint8Array(512);
    this.grad3 = [
      [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
      [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
      [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]
    ];
    this.initPermutations(seed);
  }

  setSeed(seed) {
    this.seed = seed;
    this.initPermutations(seed);
  }

  initPermutations(seed) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Fisher-Yates shuffle with seeded LCG
    let s = (seed ^ 0x9e3779b9) >>> 0;
    const lcg = () => {
      s = (Math.imul(1664525, s) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(lcg() * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
    }
  }

  fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  lerp(a, b, t) {
    return a + t * (b - a);
  }

  grad2d(hash, x, y) {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  // 2D Perlin Gradient Noise in range [-1, 1]
  perlin2D(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const u = this.fade(xf);
    const v = this.fade(yf);

    const aa = this.perm[this.perm[X] + Y];
    const ab = this.perm[this.perm[X] + Y + 1];
    const ba = this.perm[this.perm[X + 1] + Y];
    const bb = this.perm[this.perm[X + 1] + Y + 1];

    const x1 = this.lerp(this.grad2d(aa, xf, yf), this.grad2d(ba, xf - 1, yf), u);
    const x2 = this.lerp(this.grad2d(ab, xf, yf - 1), this.grad2d(bb, xf - 1, yf - 1), u);

    return this.lerp(x1, x2, v);
  }

  // Fractional Brownian Motion (fBm) in range [0, 1]
  fbm(x, y, octaves = 6, lacunarity = 2.0, persistence = 0.5) {
    let total = 0;
    let frequency = 1.0;
    let amplitude = 1.0;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      total += this.perlin2D(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      frequency *= lacunarity;
      amplitude *= persistence;
    }

    return (total / maxValue + 1.0) * 0.5;
  }

  // Ridged Multi-fractal: Alpine Peaks, knife-edge aretes and craggy ridges
  ridgedMultifractal(x, y, octaves = 6, lacunarity = 2.0, gain = 0.5, sharpness = 2.0) {
    let total = 0;
    let frequency = 1.0;
    let amplitude = 1.0;
    let weight = 1.0;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      // 1.0 - abs(noise) creates inverted V crests
      let signal = Math.abs(this.perlin2D(x * frequency, y * frequency));
      signal = 1.0 - signal;
      // Exponentiate for knife-edge ridges
      signal = Math.pow(signal, sharpness);
      signal *= weight;
      weight = Math.min(1.0, signal * 2.0);

      total += signal * amplitude;
      maxValue += amplitude;
      frequency *= lacunarity;
      amplitude *= gain;
    }

    return total / maxValue;
  }

  // Billow noise: rounded domes, puffy hills, volcanic pillows
  billow(x, y, octaves = 6, lacunarity = 2.0, persistence = 0.5) {
    let total = 0;
    let frequency = 1.0;
    let amplitude = 1.0;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      let signal = 2.0 * Math.abs(this.perlin2D(x * frequency, y * frequency)) - 1.0;
      total += signal * amplitude;
      maxValue += amplitude;
      frequency *= lacunarity;
      amplitude *= persistence;
    }

    return (total / maxValue + 1.0) * 0.5;
  }

  // Worley / Voronoi Cellular Noise: Crystalline crags, tectonic block joints, basalt fractures
  voronoi(x, y, jitter = 0.8) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;

    let minDist1 = 999.0;
    let minDist2 = 999.0;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = (xi + dx) & 255;
        const cy = (yi + dy) & 255;
        const hash = this.perm[this.perm[cx] + cy];
        const hash2 = this.perm[(hash + 107) & 255];

        const px = dx + (hash / 255.0) * jitter;
        const py = dy + (hash2 / 255.0) * jitter;

        const dist = Math.hypot(px - xf, py - yf);
        if (dist < minDist1) {
          minDist2 = minDist1;
          minDist1 = dist;
        } else if (dist < minDist2) {
          minDist2 = dist;
        }
      }
    }

    // F1, F2 - F1 (ridges), F1 normalized
    return {
      f1: Math.min(1.0, minDist1),
      f2: Math.min(1.0, minDist2),
      crag: Math.min(1.0, minDist2 - minDist1) // high at cellular cell boundaries
    };
  }

  // Domain Warping: Simulates metamorphic rock folding, fluid shear, and tectonic distortion
  domainWarp(x, y, warpStrength = 1.5, warpFreq = 1.0) {
    const qx = this.perlin2D(x * warpFreq, y * warpFreq);
    const qy = this.perlin2D((x + 5.2) * warpFreq, (y + 1.3) * warpFreq);

    const rx = this.perlin2D((x + 4.0 * qx + 1.7) * warpFreq, (y + 4.0 * qy + 9.2) * warpFreq);
    const ry = this.perlin2D((x + 4.0 * qx + 8.3) * warpFreq, (y + 4.0 * qy + 2.8) * warpFreq);

    return {
      x: x + warpStrength * rx,
      y: y + warpStrength * ry
    };
  }
}
