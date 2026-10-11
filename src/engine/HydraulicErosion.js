// Physically-Based Hydraulic (Fluvial) Erosion Engine
// Simulates water droplet kinetic energy, bedrock dissolution, sediment transport,
// alluvial fan deposition, and dendritic drainage gully formation.

export class HydraulicErosionEngine {
  constructor(size = 256) {
    this.size = size;
  }

  // Bilinear interpolation of height and gradient at sub-pixel coordinate (x, y)
  calculateHeightAndGradient(heightMap, size, x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(size - 1, x0 + 1);
    const y1 = Math.min(size - 1, y0 + 1);

    const u = x - x0;
    const v = y - y0;

    const idx00 = y0 * size + x0;
    const idx10 = y0 * size + x1;
    const idx01 = y1 * size + x0;
    const idx11 = y1 * size + x1;

    const h00 = heightMap[idx00];
    const h10 = heightMap[idx10];
    const h01 = heightMap[idx01];
    const h11 = heightMap[idx11];

    const h = (1 - u) * (1 - v) * h00 + u * (1 - v) * h10 + (1 - u) * v * h01 + u * v * h11;

    // Gradient vectors
    const gx = (h10 - h00) * (1 - v) + (h11 - h01) * v;
    const gy = (h01 - h00) * (1 - u) + (h11 - h10) * u;

    return { height: h, gx, gy, x0, y0, x1, y1, u, v };
  }

  // Run hydraulic erosion simulation on heightmap Float32Array
  // Returns updated heightmap, flowMask (Float32Array), sedimentMask (Float32Array)
  simulate(heightMap, size, options = {}) {
    const {
      iterations = 45000,
      inertia = 0.15,
      sedimentCapacityFactor = 4.0,
      minSedimentCapacity = 0.01,
      erodeSpeed = 0.35,
      depositSpeed = 0.35,
      evaporateSpeed = 0.02,
      gravity = 9.8,
      maxDropletLifetime = 45,
      initialWaterVolume = 1.0,
      initialSpeed = 1.0,
      rainDistribution = 'uniform' // 'uniform' or 'ridge-concentrated'
    } = options;

    const flowMask = new Float32Array(size * size);
    const sedimentMask = new Float32Array(size * size);

    // Pre-calculate random or ridge-weighted rain positions
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const margin = 2;
    const maxCoord = size - margin - 1;

    for (let iter = 0; iter < iterations; iter++) {
      let x = margin + rnd() * (maxCoord - margin);
      let y = margin + rnd() * (maxCoord - margin);

      let dirX = 0;
      let dirY = 0;
      let speed = initialSpeed;
      let water = initialWaterVolume;
      let sediment = 0;

      for (let step = 0; step < maxDropletLifetime; step++) {
        const nodeX = Math.floor(x);
        const nodeY = Math.floor(y);

        if (nodeX < margin || nodeX >= maxCoord || nodeY < margin || nodeY >= maxCoord) {
          break;
        }

        const sample = this.calculateHeightAndGradient(heightMap, size, x, y);

        // Record accumulated water flow for texturing river channels and gullies
        const centerIdx = nodeY * size + nodeX;
        flowMask[centerIdx] += water * 0.05;

        // Calculate direction with inertia
        dirX = dirX * inertia - sample.gx * (1 - inertia);
        dirY = dirY * inertia - sample.gy * (1 - inertia);

        // Normalize direction
        const len = Math.hypot(dirX, dirY);
        if (len !== 0) {
          dirX /= len;
          dirY /= len;
        } else {
          // If flat, give tiny random nudge
          dirX = (rnd() - 0.5) * 0.1;
          dirY = (rnd() - 0.5) * 0.1;
        }

        const newX = x + dirX;
        const newY = y + dirY;

        if (newX < margin || newX >= maxCoord || newY < margin || newY >= maxCoord) {
          break;
        }

        const newSample = this.calculateHeightAndGradient(heightMap, size, newX, newY);
        const deltaHeight = newSample.height - sample.height;

        // Calculate sediment transport capacity
        // Steeper downhill and faster water carries vastly more sediment
        const sedimentCapacity = Math.max(-deltaHeight, minSedimentCapacity) * speed * water * sedimentCapacityFactor;

        if (sediment > sedimentCapacity || deltaHeight > 0) {
          // Deposition: droplet is carrying more than its capacity or hitting an uphill slope
          const amountToDeposit = deltaHeight > 0
            ? Math.min(deltaHeight, sediment)
            : (sediment - sedimentCapacity) * depositSpeed;

          sediment -= amountToDeposit;

          // Distribute deposited sediment onto 4 surrounding grid points
          const d00 = amountToDeposit * (1 - sample.u) * (1 - sample.v);
          const d10 = amountToDeposit * sample.u * (1 - sample.v);
          const d01 = amountToDeposit * (1 - sample.u) * sample.v;
          const d11 = amountToDeposit * sample.u * sample.v;

          heightMap[sample.y0 * size + sample.x0] += d00;
          heightMap[sample.y0 * size + sample.x1] += d10;
          heightMap[sample.y1 * size + sample.x0] += d01;
          heightMap[sample.y1 * size + sample.x1] += d11;

          // Record sediment deposition mask
          sedimentMask[sample.y0 * size + sample.x0] += d00;
          sedimentMask[sample.y0 * size + sample.x1] += d10;
          sedimentMask[sample.y1 * size + sample.x0] += d01;
          sedimentMask[sample.y1 * size + sample.x1] += d11;
        } else {
          // Erosion: droplet dissolves bedrock into carried sediment
          const amountToErode = Math.min((sedimentCapacity - sediment) * erodeSpeed, -deltaHeight);

          sediment += amountToErode;

          const e00 = amountToErode * (1 - sample.u) * (1 - sample.v);
          const e10 = amountToErode * sample.u * (1 - sample.v);
          const e01 = amountToErode * (1 - sample.u) * sample.v;
          const e11 = amountToErode * sample.u * sample.v;

          heightMap[sample.y0 * size + sample.x0] = Math.max(0, heightMap[sample.y0 * size + sample.x0] - e00);
          heightMap[sample.y0 * size + sample.x1] = Math.max(0, heightMap[sample.y0 * size + sample.x1] - e10);
          heightMap[sample.y1 * size + sample.x0] = Math.max(0, heightMap[sample.y1 * size + sample.x0] - e01);
          heightMap[sample.y1 * size + sample.x1] = Math.max(0, heightMap[sample.y1 * size + sample.x1] - e11);
        }

        // Kinetic acceleration: v^2 = v0^2 + 2*g*dh
        speed = Math.sqrt(Math.max(0.01, speed * speed + deltaHeight * gravity));
        water *= (1 - evaporateSpeed);

        x = newX;
        y = newY;
      }
    }

    // Normalize flowMask and sedimentMask into [0, 1] range
    let maxFlow = 0;
    let maxSediment = 0;
    for (let i = 0; i < size * size; i++) {
      if (flowMask[i] > maxFlow) maxFlow = flowMask[i];
      if (sedimentMask[i] > maxSediment) maxSediment = sedimentMask[i];
    }

    if (maxFlow > 0) {
      for (let i = 0; i < size * size; i++) {
        // Logarithmic scale so fine gullies are crisp
        flowMask[i] = Math.min(1.0, Math.log1p(flowMask[i] * 5.0) / Math.log1p(maxFlow * 5.0));
      }
    }

    if (maxSediment > 0) {
      for (let i = 0; i < size * size; i++) {
        sedimentMask[i] = Math.min(1.0, Math.sqrt(sedimentMask[i] / maxSediment));
      }
    }

    return { heightMap, flowMask, sedimentMask };
  }
}
