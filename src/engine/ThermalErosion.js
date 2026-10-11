// Thermal Erosion Engine (Angle-of-Repose Talus & Scree Relaxation)
// Relaxes over-steepened cliffs into realistic conical talus scree aprons,
// mimicking natural rockfall and frost-shatter weathering.

export class ThermalErosionEngine {
  constructor(size = 256) {
    this.size = size;
  }

  simulate(heightMap, size, options = {}) {
    const {
      iterations = 12,
      reposeAngleDegrees = 38.0,
      talusRate = 0.45,
      smoothing = 0.1
    } = options;

    const talusMask = new Float32Array(size * size);
    const tempHeight = new Float32Array(heightMap);

    // Tan of angle of repose normalized to grid scale
    // Normalizing grid cell spacing dx = 1.0 / size
    const cellSize = 1.0 / size;
    const tanRepose = Math.tan((reposeAngleDegrees * Math.PI) / 180.0) * cellSize * 0.4;

    const neighbors = [
      [-1, 0, 1.0],
      [1, 0, 1.0],
      [0, -1, 1.0],
      [0, 1, 1.0],
      [-1, -1, 1.414],
      [1, -1, 1.414],
      [-1, 1, 1.414],
      [1, 1, 1.414]
    ];

    for (let iter = 0; iter < iterations; iter++) {
      for (let y = 1; y < size - 1; y++) {
        for (let x = 1; x < size - 1; x++) {
          const idx = y * size + x;
          const h0 = tempHeight[idx];

          let maxExcess = 0;
          let targetX = 0;
          let targetY = 0;
          let totalExcess = 0;

          // Check 8 neighbors
          for (let n = 0; n < 8; n++) {
            const nx = x + neighbors[n][0];
            const ny = y + neighbors[n][1];
            const dist = neighbors[n][2];
            const hn = tempHeight[ny * size + nx];

            const diff = h0 - hn;
            const threshold = tanRepose * dist;

            if (diff > threshold) {
              const excess = diff - threshold;
              totalExcess += excess;
              if (excess > maxExcess) {
                maxExcess = excess;
                targetX = nx;
                targetY = ny;
              }
            }
          }

          if (totalExcess > 0 && maxExcess > 0) {
            const slideAmount = (maxExcess * 0.5) * talusRate;
            heightMap[idx] -= slideAmount;
            const targetIdx = targetY * size + targetX;
            heightMap[targetIdx] += slideAmount;

            // Accumulate talus scree mask
            talusMask[targetIdx] += slideAmount * 10.0;
          }
        }
      }

      // Copy updated height to temp for next iteration
      tempHeight.set(heightMap);
    }

    // Normalize talus mask
    let maxTalus = 0;
    for (let i = 0; i < size * size; i++) {
      if (talusMask[i] > maxTalus) maxTalus = talusMask[i];
    }
    if (maxTalus > 0) {
      for (let i = 0; i < size * size; i++) {
        talusMask[i] = Math.min(1.0, talusMask[i] / maxTalus);
      }
    }

    return { heightMap, talusMask };
  }
}
