// Dry-mass erosion: thermal (talus) and aeolian (wind) transport.
//
// erodeThermal: material above the talus angle slides to lower neighbours. Each pass moves a
//   fraction of the excess height difference, so slopes relax towards the angle of repose and
//   scree aprons form at the base of cliffs. Mass is conserved exactly.
// erodeWind: saltation transport. Wind speed is modulated by the terrain slope along the wind
//   direction (speed-up on windward slopes, shelter in the lee), grains only move above a
//   threshold, and flux divergence removes sand where the flux accelerates and deposits it where
//   it slows, which builds dunes in the lee of obstacles.

export async function erodeThermal(height, size, params, ctx) {
  const total = size * size;
  const cell = ctx.cellMetres;
  const maxHeight = ctx.maxHeight;
  const iterations = Math.max(0, Math.round(params.iterations));
  const tanTalus = Math.tan((params.talusAngle * Math.PI) / 180);
  const rate = params.transfer;
  const diagonal = params.neighbours >= 8;

  const offX = diagonal ? [1, -1, 0, 0, 1, 1, -1, -1] : [1, -1, 0, 0];
  const offY = diagonal ? [0, 0, 1, -1, 1, -1, 1, -1] : [0, 0, 1, -1];
  const offD = diagonal ? [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2] : [1, 1, 1, 1];
  const count = offX.length;

  const z = new Float64Array(total);
  for (let i = 0; i < total; i += 1) z[i] = height[i] * maxHeight;
  const delta = new Float64Array(total);
  let moved = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    if (iteration > 0) for (let i = 0; i < total; i += 1) height[i] = z[i] / maxHeight;
    await ctx.checkpoint(iteration / iterations, height);
    delta.fill(0);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const c = y * size + x;
        const zc = z[c];
        // Each cell sends material only to its steepest neighbour that is over the talus angle.
        // Sending to every neighbour at once overshoots and makes a checkerboard that never settles.
        let bestExcess = 0;
        let best = -1;
        for (let k = 0; k < count; k += 1) {
          const nx = x + offX[k];
          const ny = y + offY[k];
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const excess = zc - z[ny * size + nx] - tanTalus * offD[k] * cell;
          if (excess > bestExcess) {
            bestExcess = excess;
            best = ny * size + nx;
          }
        }
        if (best < 0) continue;
        // Move half the excess (scaled by the transfer rate), and never more than half the column.
        const amount = Math.min((rate * 0.5 * bestExcess), zc * 0.5);
        delta[c] -= amount;
        delta[best] += amount;
        moved += amount;
      }
    }
    for (let i = 0; i < total; i += 1) z[i] += delta[i];
  }
  for (let i = 0; i < total; i += 1) height[i] = z[i] / maxHeight;
  const cellArea = cell * cell;
  return { removedVolume: moved * cellArea, depositedVolume: moved * cellArea };
}

export async function erodeWind(height, size, params, ctx) {
  const total = size * size;
  const cell = ctx.cellMetres;
  const maxHeight = ctx.maxHeight;
  const iterations = Math.max(0, Math.round(params.iterations));
  const angle = (params.direction * Math.PI) / 180;
  const wx = Math.cos(angle);
  const wy = Math.sin(angle);
  const threshold = params.threshold;
  const speedUp = params.speedUp;
  const mobility = params.mobility;
  const maxStep = params.maxStep;
  const last = size - 1;

  const z = new Float64Array(total);
  for (let i = 0; i < total; i += 1) z[i] = height[i] * maxHeight;
  const flux = new Float64Array(total);
  const change = new Float64Array(total);
  let removed = 0;
  let deposited = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    if (iteration > 0) for (let i = 0; i < total; i += 1) height[i] = z[i] / maxHeight;
    await ctx.checkpoint(iteration / iterations, height);

    // Saltation flux per cell from the local wind speed.
    for (let y = 0; y < size; y += 1) {
      const yu = y > 0 ? y - 1 : y;
      const yd = y < last ? y + 1 : y;
      for (let x = 0; x < size; x += 1) {
        const xl = x > 0 ? x - 1 : x;
        const xr = x < last ? x + 1 : x;
        const gx = (z[y * size + xr] - z[y * size + xl]) / ((xr - xl) * cell);
        const gy = (z[yd * size + x] - z[yu * size + x]) / ((yd - yu) * cell);
        const along = gx * wx + gy * wy;
        const speed = Math.min(3, Math.max(0.2, 1 + speedUp * along));
        flux[y * size + x] = speed > threshold ? mobility * (speed * speed - threshold * threshold) * speed : 0;
      }
    }

    // Upwind flux divergence. Edge cells use a zero-gradient ghost, so the map edges do not
    // create artificial trenches or piles.
    let largest = 0;
    for (let y = 0; y < size; y += 1) {
      const yu = y > 0 ? y - 1 : y;
      const yd = y < last ? y + 1 : y;
      for (let x = 0; x < size; x += 1) {
        const xl = x > 0 ? x - 1 : x;
        const xr = x < last ? x + 1 : x;
        const c = y * size + x;
        const qc = flux[c];
        const dX = wx >= 0 ? qc - flux[y * size + xl] : flux[y * size + xr] - qc;
        const dY = wy >= 0 ? qc - flux[yu * size + x] : flux[yd * size + x] - qc;
        const rate = -(wx * dX + wy * dY) / cell;
        change[c] = rate;
        if (Math.abs(rate) > largest) largest = Math.abs(rate);
      }
    }
    // Limit the largest change per pass so the explicit step stays stable.
    const scale = largest > 0 ? Math.min(1, maxStep / largest) : 0;
    for (let i = 0; i < total; i += 1) {
      const dz = change[i] * scale;
      if (dz < 0) removed -= dz;
      else deposited += dz;
      z[i] = Math.max(0, z[i] + dz);
    }
  }
  const cellArea = cell * cell;
  for (let i = 0; i < total; i += 1) height[i] = z[i] / maxHeight;
  return { removedVolume: removed * cellArea, depositedVolume: deposited * cellArea };
}
