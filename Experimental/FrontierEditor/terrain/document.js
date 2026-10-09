// Document model (version 1): plain JSON with world settings, a terrain stack and a texturing stack.
// Saves and hand-edited files may omit ids, flags or parameters. normalizeDoc fills those in and drops
// layers of unknown type, so the UI keys and the evaluator never see a missing field, and a duplicate
// id can never make two rows collide.

import { TERRAIN_TYPES, TERRAIN_BLEND_MODES } from './catalog-terrain.js';
import { TEXTURE_TYPES, TEXTURE_BLEND_MODES } from './catalog-texture.js';
import { MASK_TYPES, MASK_BLEND_MODES } from './catalog-mask.js';
import { defaultParams, newId } from './stack.js';

export const DOC_VERSION = 1;

const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 1);
const hasId = (x, seen) => typeof x === 'string' && x.length > 0 && !seen.has(x);

// Parameters keep their defaults for anything missing; unknown keys are dropped.
function normParams(specs, given) {
  const out = defaultParams(specs);
  if (given && typeof given === 'object') {
    for (const s of specs) {
      if (!(s.key in given)) continue;
      const v = given[s.key];
      if (s.options) { if (s.options.some((o) => (o.id ?? o) === v)) out[s.key] = v; continue; }
      if (typeof s.value === 'string') { if (typeof v === 'string') out[s.key] = v; continue; }
      const n = Number(v);
      if (Number.isFinite(n)) out[s.key] = Math.min(s.max, Math.max(s.min, n));
    }
  }
  return out;
}

function normMask(m, seen) {
  const def = m && MASK_TYPES[m.type];
  if (!def) return null;
  const id = hasId(m.id, seen) ? m.id : newId('m');
  seen.add(id);
  const blend = MASK_BLEND_MODES.some((b) => b.id === m.blend) ? m.blend : 'multiply';
  return {
    id, type: m.type, enabled: m.enabled !== false, invert: m.invert === true,
    opacity: clamp01(m.opacity), blend, params: normParams(def.params, m.params),
  };
}

function normLayer(l, seen, { types, blends, prefix, defaultBlend, withMasks }) {
  const def = l && types[l.type];
  if (!def) return null;
  const id = hasId(l.id, seen) ? l.id : newId(prefix);
  seen.add(id);
  const allowed = blends(def);
  const blend = allowed.includes(l.blend) ? l.blend : defaultBlend(def);
  const out = {
    id, type: l.type, enabled: l.enabled !== false, opacity: clamp01(l.opacity),
    blend, params: normParams(def.params, l.params),
  };
  if (withMasks) {
    const maskIds = new Set(seen);
    out.masks = Array.isArray(l.masks) ? l.masks.map((m) => normMask(m, maskIds)).filter(Boolean) : [];
    for (const m of out.masks) seen.add(m.id);
  }
  return out;
}

const terrainBlends = (def) => (TERRAIN_BLEND_MODES[def.kind] || []).map((b) => b.id);
const terrainDefaultBlend = (def) => (def.kind === 'generator' ? 'add' : 'normal');
const textureBlends = () => TEXTURE_BLEND_MODES.map((b) => b.id);
const textureDefaultBlend = (def) => def.blend;

function normWorld(w) {
  const src = w && typeof w === 'object' ? w : {};
  const size = Number.isFinite(src.size) ? Math.min(8192, Math.max(64, src.size)) : 1024;
  const res = Number.isFinite(src.resolution) ? Math.min(1024, Math.max(64, Math.round(src.resolution))) : 256;
  const seed = Number.isFinite(src.seed) ? Math.round(src.seed) : 7;
  return { ...src, size, resolution: res, seed };
}

// Returns a normalised copy, or null when the input is not a version-1 document at all.
export function normalizeDoc(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== DOC_VERSION) return null;
  if (!Array.isArray(raw.terrain) || !Array.isArray(raw.texturing)) return null;
  const seenTerrain = new Set(), seenTexture = new Set();
  const terrain = raw.terrain
    .map((l) => normLayer(l, seenTerrain, { types: TERRAIN_TYPES, blends: terrainBlends, prefix: 't', defaultBlend: terrainDefaultBlend, withMasks: true }))
    .filter(Boolean);
  const texturing = raw.texturing
    .map((l) => normLayer(l, seenTexture, { types: TEXTURE_TYPES, blends: textureBlends, prefix: 'x', defaultBlend: textureDefaultBlend, withMasks: true }))
    .filter(Boolean);
  return {
    version: DOC_VERSION,
    world: normWorld(raw.world),
    terrain,
    texturing,
    view: { mode: typeof raw.view?.mode === 'string' ? raw.view.mode : 'shaded' },
    ...(typeof raw.preset === 'string' ? { preset: raw.preset } : {}),
  };
}
