// Hydrological routing on a height grid.
//
// routeFlow() fills closed depressions with the Priority-Flood algorithm (Barnes, Lehman and
// Mulla 2014) using a small epsilon so every interior cell drains, then routes each cell to its
// steepest lower D8 neighbour. The pop order of the flood is a topological order of the
// receivers, so accumulate() can sum upstream area in a single pass.

const EPSILON = 1e-9;

export function routeFlow(height, size) {
  const total = size * size;
  const filled = new Float64Array(total);
  for (let i = 0; i < total; i += 1) filled[i] = height[i];
  const receiver = new Int32Array(total).fill(-1);
  const order = new Uint32Array(total);
  const open = new Uint8Array(total);
  const keys = new Float64Array(total);
  const values = new Int32Array(total);
  let heapSize = 0;

  const push = (key, value) => {
    let i = heapSize;
    heapSize += 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[i] = keys[parent];
      values[i] = values[parent];
      i = parent;
    }
    keys[i] = key;
    values[i] = value;
  };

  const pop = () => {
    const top = values[0];
    heapSize -= 1;
    if (heapSize > 0) {
      const key = keys[heapSize];
      const value = values[heapSize];
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= heapSize) break;
        if (child + 1 < heapSize && keys[child + 1] < keys[child]) child += 1;
        if (keys[child] >= key) break;
        keys[i] = keys[child];
        values[i] = values[child];
        i = child;
      }
      keys[i] = key;
      values[i] = value;
    }
    return top;
  };

  const seed = (index) => {
    if (open[index]) return;
    open[index] = 1;
    push(filled[index], index);
  };
  for (let x = 0; x < size; x += 1) {
    seed(x);
    seed((size - 1) * size + x);
  }
  for (let y = 1; y < size - 1; y += 1) {
    seed(y * size);
    seed(y * size + size - 1);
  }

  let count = 0;
  while (heapSize > 0) {
    const cell = pop();
    order[count] = cell;
    count += 1;
    const cx = cell % size;
    const cy = (cell - cx) / size;
    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = cy + dy;
      if (ny < 0 || ny >= size) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = cx + dx;
        if ((dx === 0 && dy === 0) || nx < 0 || nx >= size) continue;
        const next = ny * size + nx;
        if (open[next]) continue;
        open[next] = 1;
        if (filled[next] <= filled[cell]) filled[next] = filled[cell] + EPSILON;
        receiver[next] = cell;
        push(filled[next], next);
      }
    }
  }

  // Steepest descent on the filled surface. Every interior cell has at least its flood parent
  // as a strictly lower neighbour, so this never leaves a cell without a receiver.
  const diagonal = Math.SQRT2;
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const cell = y * size + x;
      let best = -1;
      let bestDrop = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const next = (y + dy) * size + (x + dx);
          const drop = (filled[cell] - filled[next]) / (dx !== 0 && dy !== 0 ? diagonal : 1);
          if (drop > bestDrop) {
            bestDrop = drop;
            best = next;
          }
        }
      }
      if (best >= 0) receiver[cell] = best;
    }
  }
  return { filled, order, receiver };
}

// Upstream contributing area in cells (each cell counts itself once).
export function accumulate(order, receiver, total) {
  const area = new Float64Array(total).fill(1);
  for (let k = total - 1; k >= 0; k -= 1) {
    const cell = order[k];
    const next = receiver[cell];
    if (next >= 0) area[next] += area[cell];
  }
  return area;
}

// Logarithmic flow accumulation scaled to [0, 1] for display and river masks.
export function flowIntensity(area) {
  let max = 1;
  for (let i = 0; i < area.length; i += 1) if (area[i] > max) max = area[i];
  const scale = 1 / Math.log1p(max);
  const out = new Float32Array(area.length);
  for (let i = 0; i < area.length; i += 1) out[i] = Math.log1p(area[i]) * scale;
  return out;
}
