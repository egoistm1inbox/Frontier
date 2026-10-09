// Geological landforms: finite shapes with a centre and a radius. They stay where they are placed, so they do not
// need a falloff to stop them. The family follows the Primitive/Geological group of Hesiod (GPL-3.0). These are
// independent implementations of the same kinds of shape. No code from Hesiod is used.
//
// Each generator returns a signed field: positive is uplift, negative is a depression. The field is scaled so the
// tallest feature reaches `height` half-ranges, and its zero level is 0.5. A layer in Add mode therefore raises
// and lowers the terrain below it, and nothing outside the landform changes.
import { makeNoise, fbm } from '../core/noise.js';
import { clamp, hashString } from '../core/rng.js';
import { seedFor } from './primitives.js';

export const GEOLOGICAL_IDS = ['cone', 'range', 'stump', 'inselberg', 'crater', 'rift'];

// Samples fn(r, ux, uy, X, Y, detail, noise) on a W x W grid.
//   r        distance from the centre in units of the radius (1 at the radius)
//   ux, uy   offsets from the centre in units of the radius
//   X, Y     map position, 0..1
//   detail   fBm noise at map position (X, Y), in about [-1, 1]
//   noise    the raw 2D noise function, for shapes that sample it along a circle
function field(W, p, seed, fn) {
  const noise = makeNoise(seed);
  const oct = clamp(Math.round(p.octaves ?? 4), 1, 8);
  const freq = clamp(p.frequency ?? 3, 0.1, 24);
  const detail = (X, Y) => fbm(noise, X * freq, Y * freq, oct, 2, 0.5);
  const R = clamp((p.radius ?? 50) / 100, 0.05, 1.5);
  const cx = clamp((p.centreX ?? 50) / 100, 0, 1);
  const cy = clamp((p.centreY ?? 50) / 100, 0, 1);
  const half = 0.5 * R;
  const out = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    const Y = (y + 0.5) / W;
    const dy = Y - cy;
    for (let x = 0; x < W; x++) {
      const X = (x + 0.5) / W;
      const dx = X - cx;
      out[y * W + x] = fn(Math.hypot(dx, dy) / half, dx / half, dy / half, X, Y, detail, noise);
    }
  }
  return out;
}

// Scales a signed field so its largest feature reaches half the height range times `height`, centred on 0.5.
function finish(raw, p) {
  let m = 0;
  for (let i = 0; i < raw.length; i++) {
    const a = Math.abs(raw[i]);
    if (a > m) m = a;
  }
  const k = m > 1e-9 ? (0.5 * clamp(p.height ?? 1, 0, 2)) / m : 0;
  const off = clamp(p.offset ?? 0, -0.5, 0.5);
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = clamp(0.5 + off + k * raw[i], 0, 1);
  return out;
}

// Signed field for a geological type, before scaling. Exported for the tests.
export function geologicalRaw(type, W, p, terrainSeed) {
  const seed = seedFor(terrainSeed, p.seed ?? 0, hashString(type));
  switch (type) {
    case 'cone': {
      // A cone with a sharp summit. The rugged detail is multiplied by the cone, so the foot stays smooth.
      const sharp = clamp(p.sharpness ?? 1.6, 0.5, 4);
      const rug = clamp(p.rugosity ?? 0.25, 0, 1);
      return field(W, p, seed, (r, ux, uy, X, Y, detail) => Math.max(0, 1 - r) ** sharp * (1 + rug * detail(X, Y)));
    }
    case 'range': {
      // Ridges along spokes. The noise is sampled around a circle, so each ridge runs out from the centre.
      const sharp = clamp(p.sharpness ?? 1.5, 0.5, 6);
      const rough = clamp(p.roughness ?? 0.4, 0, 1);
      const spokes = clamp(p.spokes ?? 7, 3, 14) / 2.2;
      return field(W, p, seed, (r, ux, uy, X, Y, detail, noise) => {
        const th = Math.atan2(uy, ux);
        const warp = 0.5 * r; // the ridges bend a little with distance
        const n = noise(Math.cos(th) * spokes + warp, Math.sin(th) * spokes + warp * 0.7);
        const ridge = Math.max(0, 1 - Math.abs(n)) ** sharp;
        const envelope = Math.max(0, 1 - r) ** 0.8;
        // The ridges fade in from a short distance out, so they do not pinch to a point in the middle.
        const t = clamp((r - 0.15) / 0.45, 0, 1);
        const crest = t * t * (3 - 2 * t);
        const massif = 0.7 * Math.max(0, 1 - r) ** 2.5;
        return (envelope * ridge * crest + massif) * (1 + rough * 0.6 * detail(X, Y));
      });
    }
    case 'stump': {
      // A cone cut off at a flat top, with steep sides.
      const steep = clamp(p.steepness ?? 2.5, 1, 5);
      const top = clamp(p.plateau ?? 0.6, 0.2, 1);
      const rug = clamp(p.rugosity ?? 0.15, 0, 1);
      return field(W, p, seed, (r, ux, uy, X, Y, detail) => {
        const cone = Math.max(0, 1 - r) ** 1.2 * steep;
        return Math.min(cone, top) * (1 + rug * detail(X, Y));
      });
    }
    case 'inselberg': {
      // An isolated dome. A higher roundness gives steeper sides and a flatter top.
      const q = clamp(p.roundness ?? 3, 1.5, 6);
      const rug = clamp(p.rugosity ?? 0.3, 0, 1);
      return field(W, p, seed, (r, ux, uy, X, Y, detail) => Math.sqrt(Math.max(0, 1 - r ** q)) * (1 + rug * detail(X, Y)));
    }
    case 'crater': {
      // A bowl inside a raised rim, an optional central peak, and ejecta that thins outside the rim.
      const w = clamp(p.rimWidth ?? 0.12, 0.02, 0.5);
      const rim = clamp(p.rim ?? 0.5, 0, 1);
      const depth = clamp(p.depth ?? 0.6, 0, 1.5);
      const peak = clamp(p.peak ?? 0.2, 0, 1);
      const rug = clamp(p.rugosity ?? 0.2, 0, 1);
      return field(W, p, seed, (r, ux, uy, X, Y, detail) => {
        const rimH = rim * Math.exp(-(((r - 1) / w) ** 2));
        const bowl = -depth * Math.max(0, 1 - r * r);
        const centre = peak * Math.exp(-((r / 0.18) ** 2));
        const ejecta = r > 1 ? 0.15 * rim * Math.exp(-(r - 1) / 0.5) : 0;
        const roughness = rug * 0.25 * Math.exp(-(((r - 1) / 0.6) ** 2)) * detail(X, Y);
        return rimH + bowl + centre + ejecta + roughness;
      });
    }
    case 'rift': {
      // A valley along an axis, with raised shoulders on either side. It tapers to nothing at the radius.
      const th0 = ((p.angle ?? 30) * Math.PI) / 180;
      const ca = Math.cos(th0);
      const sa = Math.sin(th0);
      const w = clamp(p.width ?? 0.25, 0.05, 0.8);
      const depth = clamp(p.depth ?? 0.8, 0, 1.5);
      const shoulder = clamp(p.shoulder ?? 0.3, 0, 1);
      const rug = clamp(p.rugosity ?? 0.2, 0, 1);
      return field(W, p, seed, (r, ux, uy, X, Y, detail) => {
        const along = ux * ca + uy * sa;
        const across = -ux * sa + uy * ca;
        const taper = Math.sqrt(Math.max(0, 1 - along * along));
        const valley = -depth * Math.exp(-((across / w) ** 2));
        const shoulders = shoulder * Math.exp(-(((Math.abs(across) - 1.8 * w) / (0.9 * w)) ** 2));
        const roughness = rug * 0.3 * Math.exp(-((across / (2.5 * w)) ** 2)) * detail(X, Y);
        return taper * (valley + shoulders + roughness);
      });
    }
    default:
      throw new Error('Unknown geological type ' + type);
  }
}

// Final height field of a geological layer, in [0, 1], with 0.5 as the zero level.
export function generateGeological(type, W, p, terrainSeed) {
  return finish(geologicalRaw(type, W, p, terrainSeed), p);
}
