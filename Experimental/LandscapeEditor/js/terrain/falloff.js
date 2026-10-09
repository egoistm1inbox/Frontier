// Falloff: a mask that limits a generator layer to a region, so noise does not run on to the edges of the map.
// The mask multiplies the layer's opacity cell by cell. Where the mask is 0 the layer has no effect in any blend
// mode, so the terrain below shows through. Inside the region the layer is unchanged.
//
// Units are percentages, so the inspector sliders read directly:
//   centreX, centreY  centre of the region, 0..100 (50 is the middle of the map)
//   radius            edge of the region, 5..150 (100 reaches the middle of each edge of the map)
//   softness          width of the fade inside the edge, 0..100 (share of the radius)
//   strength          how much the region limits the layer, 0..100 (100 removes it completely outside)
import { clamp, smoothstep } from '../core/rng.js';

export const FALLOFF_SHAPES = [
  ['circle', 'Circle'],
  ['square', 'Square'],
  ['diamond', 'Diamond'],
];

// Off by default, so existing stacks keep their look.
export const FALLOFF_DEFAULTS = { enabled: false, shape: 'circle', centreX: 50, centreY: 50, radius: 80, softness: 40, strength: 100 };

const num = (v, lo, hi, fallback) => {
  const x = Number(v);
  return Number.isFinite(x) ? clamp(x, lo, hi) : fallback;
};

// Sanitises a falloff block read from a file. Missing or unknown fields fall back to the defaults.
export function normaliseFalloff(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: r.enabled === true,
    shape: FALLOFF_SHAPES.some(([id]) => id === r.shape) ? r.shape : FALLOFF_DEFAULTS.shape,
    centreX: num(r.centreX, 0, 100, FALLOFF_DEFAULTS.centreX),
    centreY: num(r.centreY, 0, 100, FALLOFF_DEFAULTS.centreY),
    radius: num(r.radius, 5, 150, FALLOFF_DEFAULTS.radius),
    softness: num(r.softness, 0, 100, FALLOFF_DEFAULTS.softness),
    strength: num(r.strength, 0, 100, FALLOFF_DEFAULTS.strength),
  };
}

// Mask for an N x N grid, or null when the falloff is off. Values are 1 inside the region and 0 beyond it, with a
// smooth band across the softness. Distances are measured in half-map units, so a circle of radius 100 touches the
// middle of each edge.
export function falloffMask(N, f) {
  if (!f || !f.enabled) return null;
  const cx = clamp(f.centreX, 0, 100) / 100;
  const cy = clamp(f.centreY, 0, 100) / 100;
  const R = clamp(f.radius, 5, 150) / 100;
  const inner = R * (1 - clamp(f.softness, 0, 100) / 100);
  const s = clamp(f.strength, 0, 100) / 100;
  const sharp = R - inner < 1e-6;
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const dy = ((y + 0.5) / N - cy) / 0.5;
    for (let x = 0; x < N; x++) {
      const dx = ((x + 0.5) / N - cx) / 0.5;
      const d = f.shape === 'square' ? Math.max(Math.abs(dx), Math.abs(dy))
        : f.shape === 'diamond' ? Math.abs(dx) + Math.abs(dy)
          : Math.hypot(dx, dy);
      const m = sharp ? (d <= R ? 1 : 0) : 1 - smoothstep(inner, R, d);
      out[y * N + x] = 1 - s * (1 - m);
    }
  }
  return out;
}
