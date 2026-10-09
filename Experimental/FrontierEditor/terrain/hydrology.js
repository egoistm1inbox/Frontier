// Water routing on a square heightfield of N×N cells (row-major, index = y * N + x).
// Depression filling (Barnes priority-flood), D8 flow routing, flow accumulation and a multi-source distance
// transform. The river and lake layers are built from these, so channels follow real drainage instead of
// painted-on blue.

const NEIGHBOURS = [[-1, -1, Math.SQRT2], [0, -1, 1], [1, -1, Math.SQRT2], [-1, 0, 1], [1, 0, 1], [-1, 1, Math.SQRT2], [0, 1, 1], [1, 1, Math.SQRT2]];

// Minimal binary min-heap keyed by a Float32Array of priorities.
class MinHeap {
    constructor(keys) {
        this.keys = keys;
        this.items = [];
    }
    push(index) {
        const a = this.items;
        a.push(index);
        let i = a.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.keys[a[p]] <= this.keys[a[i]]) break;
            [a[p], a[i]] = [a[i], a[p]];
            i = p;
        }
    }
    pop() {
        const a = this.items;
        const top = a[0];
        const last = a.pop();
        if (a.length) {
            a[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < a.length && this.keys[a[l]] < this.keys[a[m]]) m = l;
                if (r < a.length && this.keys[a[r]] < this.keys[a[m]]) m = r;
                if (m === i) break;
                [a[m], a[i]] = [a[i], a[m]];
                i = m;
            }
        }
        return top;
    }
    get size() {
        return this.items.length;
    }
}

// Priority-flood: raises pits to their spill height (plus a tiny epsilon so every cell still drains).
export function fillDepressions(height, N, epsilon = 1e-3) {
    const filled = Float32Array.from(height);
    const open = new Uint8Array(N * N);
    const heap = new MinHeap(filled);
    for (let x = 0; x < N; x++) {
        for (const y of [0, N - 1]) {
            const i = y * N + x;
            if (!open[i]) { open[i] = 1; heap.push(i); }
        }
    }
    for (let y = 1; y < N - 1; y++) {
        for (const x of [0, N - 1]) {
            const i = y * N + x;
            if (!open[i]) { open[i] = 1; heap.push(i); }
        }
    }
    while (heap.size) {
        const c = heap.pop();
        const cx = c % N, cy = (c - cx) / N;
        for (const [dx, dy] of NEIGHBOURS) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
            const n = ny * N + nx;
            if (open[n]) continue;
            open[n] = 1;
            if (filled[n] < filled[c] + epsilon) filled[n] = filled[c] + epsilon;
            heap.push(n);
        }
    }
    return filled;
}

// D8 steepest-descent receiver on the filled surface. Border cells are outlets (-1).
export function flowReceivers(filled, N, cell) {
    const down = new Int32Array(N * N).fill(-1);
    for (let y = 1; y < N - 1; y++) {
        for (let x = 1; x < N - 1; x++) {
            const c = y * N + x;
            let best = 0, bestN = -1;
            for (const [dx, dy, dist] of NEIGHBOURS) {
                const n = (y + dy) * N + (x + dx);
                const slope = (filled[c] - filled[n]) / (dist * cell);
                if (slope > best) { best = slope; bestN = n; }
            }
            down[c] = bestN;
        }
    }
    return down;
}

// Upstream catchment area in cells (each cell counts itself once).
export function flowAccumulation(filled, down, N) {
    const order = Array.from({ length: N * N }, (_, i) => i);
    order.sort((a, b) => filled[b] - filled[a]);
    const acc = new Float32Array(N * N).fill(1);
    for (const c of order) {
        const d = down[c];
        if (d >= 0) acc[d] += acc[c];
    }
    return acc;
}

// Multi-source BFS over the 8-neighbourhood: for every cell, the distance (in cells) to the nearest source and
// that source's index. Used to spread a channel's width and bed level across its banks.
export function distanceFrom(sources, N, maxDistance = Infinity) {
    const dist = new Float32Array(N * N).fill(Infinity);
    const owner = new Int32Array(N * N).fill(-1);
    const queue = [];
    for (let i = 0; i < N * N; i++) {
        if (sources[i]) { dist[i] = 0; owner[i] = i; queue.push(i); }
    }
    for (let head = 0; head < queue.length; head++) {
        const c = queue[head];
        if (dist[c] >= maxDistance) continue;
        const cx = c % N, cy = (c - cx) / N;
        for (const [dx, dy, step] of NEIGHBOURS) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
            const n = ny * N + nx;
            const nd = dist[c] + step;
            if (nd < dist[n]) {
                dist[n] = nd;
                owner[n] = owner[c];
                queue.push(n);
            }
        }
    }
    return { dist, owner };
}

// Slope magnitude (degrees) and the 3×3 Laplacian (curvature) of a heightfield.
export function slopeAndCurvature(height, N, cell) {
    const slope = new Float32Array(N * N), curv = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const xl = Math.max(0, x - 1), xr = Math.min(N - 1, x + 1);
            const yd = Math.max(0, y - 1), yu = Math.min(N - 1, y + 1);
            const dzdx = (height[y * N + xr] - height[y * N + xl]) / ((xr - xl) * cell || 1);
            const dzdy = (height[yu * N + x] - height[yd * N + x]) / ((yu - yd) * cell || 1);
            slope[y * N + x] = Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI;
            const c = height[y * N + x];
            curv[y * N + x] = (height[y * N + xl] + height[y * N + xr] + height[yd * N + x] + height[yu * N + x] - 4 * c) / (cell * cell);
        }
    }
    return { slope, curvature: curv };
}
