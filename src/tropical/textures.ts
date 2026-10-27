/**
 * Procedural texture atlas (1024², 2×2 tiles of 480px pattern + 16px gutter).
 *
 * Tiles carry mostly luminance detail — bark grain, leaf veins, fibre — and
 * are multiplied by the per-vertex flat colours, so one atlas serves every
 * species. Patterns are drawn wrap-aware (each primitive stamped at ±480
 * offsets) which makes them perfectly tileable; the gutter repeats the
 * wrapped pattern so mip bleeding stays inside the tile.
 *
 * Tile ids: 0 bark · 1 leaf (veins along length) · 2 leaf (cross veins) · 3 stem.
 * Layout in GL space (v up): tile t at ((t%2)·½, ⌊t/2⌋·½). Canvas upload uses
 * flipY, so tiles are blitted vertically flipped rows.
 */

import { Random } from '../core/random';
import { ATLAS } from './export';

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

function ctx2d(c: AnyCanvas): Ctx {
  const ctx = (c as HTMLCanvasElement).getContext('2d') as Ctx | null;
  if (!ctx) throw new Error('2d context unavailable');
  return ctx;
}

const S = ATLAS.pattern; // 480

/** Run a draw call at all 9 wrap offsets so the pattern tiles seamlessly. */
function wrapped(ctx: Ctx, fn: () => void): void {
  for (const ox of [-S, 0, S]) {
    for (const oy of [-S, 0, S]) {
      ctx.save();
      ctx.translate(ox, oy);
      fn();
      ctx.restore();
    }
  }
}

function speckle(ctx: Ctx, rng: Random, n: number, alpha: number, dark: boolean, rMax = 1.6): void {
  for (let i = 0; i < n; i++) {
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const r = rng.range(0.4, rMax);
    ctx.fillStyle = dark ? `rgba(28,24,18,${alpha * rng.range(0.4, 1)})` : `rgba(255,252,240,${alpha * rng.range(0.4, 1)})`;
    wrapped(ctx, () => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.2832);
      ctx.fill();
    });
  }
}

function blotches(ctx: Ctx, rng: Random, n: number, alpha: number, dark: boolean, rMin: number, rMax: number): void {
  for (let i = 0; i < n; i++) {
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const r = rng.range(rMin, rMax);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = alpha * rng.range(0.5, 1);
    g.addColorStop(0, dark ? `rgba(30,26,20,${a})` : `rgba(255,253,242,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    wrapped(ctx, () => ctx.fillRect(x - r, y - r, r * 2, r * 2));
  }
}

// ── tile painters ────────────────────────────────────────────────────────────

function paintBark(ctx: Ctx, rng: Random): void {
  ctx.fillStyle = '#d8d2c6';
  ctx.fillRect(0, 0, S, S);
  blotches(ctx, rng, 26, 0.1, true, 40, 130);
  blotches(ctx, rng, 18, 0.08, false, 30, 90);
  // Vertical fibre streaks (v runs along the trunk).
  for (let i = 0; i < 340; i++) {
    const x = rng.range(0, S);
    const w = rng.range(0.6, 2.6);
    const dark = rng.next() < 0.62;
    const a = rng.range(0.05, 0.22);
    ctx.strokeStyle = dark ? `rgba(52,44,34,${a})` : `rgba(250,246,235,${a})`;
    ctx.lineWidth = w;
    const wob = rng.range(-3, 3);
    const y0 = rng.range(-40, S * 0.5);
    const y1 = y0 + rng.range(S * 0.35, S * 0.9);
    wrapped(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.quadraticCurveTo(x + wob, (y0 + y1) / 2, x + wob * 0.4, y1);
      ctx.stroke();
    });
  }
  // Horizontal scar bands.
  for (let y = 12; y < S; y += 52) {
    const yy = y + rng.range(-5, 5);
    const g = ctx.createLinearGradient(0, yy - 7, 0, yy + 7);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(46,38,28,0.34)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    wrapped(ctx, () => ctx.fillRect(-4, yy - 7, S + 8, 14));
    ctx.fillStyle = 'rgba(250,247,238,0.13)';
    wrapped(ctx, () => ctx.fillRect(-4, yy + 5, S + 8, 2.5));
  }
  // Short cracks.
  for (let i = 0; i < 150; i++) {
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const len = rng.range(6, 26);
    ctx.strokeStyle = `rgba(30,24,17,${rng.range(0.18, 0.4)})`;
    ctx.lineWidth = rng.range(0.7, 1.5);
    wrapped(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rng.range(-2, 2), y + len);
      ctx.stroke();
    });
  }
  speckle(ctx, rng, 2600, 0.16, true);
  speckle(ctx, rng, 1400, 0.1, false);
}

function midribBands(ctx: Ctx, rng: Random): void {
  // Midribs at u = 0.25 / 0.75 (underside keel / top ridge), margins at 0 / 0.5 / 1.
  for (const cx of [S * 0.25, S * 0.75]) {
    const g = ctx.createLinearGradient(cx - 9, 0, cx + 9, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(255,255,244,0.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    wrapped(ctx, () => ctx.fillRect(cx - 9, -4, 18, S + 8));
    ctx.fillStyle = 'rgba(40,52,26,0.12)';
    wrapped(ctx, () => {
      ctx.fillRect(cx - 11, -4, 2, S + 8);
      ctx.fillRect(cx + 9, -4, 2, S + 8);
    });
  }
  for (const mx of [0, S * 0.5]) {
    ctx.fillStyle = 'rgba(38,46,22,0.24)';
    wrapped(ctx, () => ctx.fillRect(mx - 1.5, -4, 3, S + 8));
  }
  void rng;
}

function paintLeafLong(ctx: Ctx, rng: Random): void {
  const grad = ctx.createLinearGradient(0, 0, S, 0);
  grad.addColorStop(0, '#d3dec9');
  grad.addColorStop(0.5, '#dde6d2');
  grad.addColorStop(1, '#d3dec9');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  // Parallel veins running along the leaf (vertical in tile space).
  for (let x = 2; x < S; x += 3) {
    const strong = x % 15 < 3;
    ctx.strokeStyle = strong ? 'rgba(58,74,38,0.32)' : 'rgba(70,88,46,0.16)';
    ctx.lineWidth = strong ? 1.3 : 0.7;
    const wob = rng.range(-1.2, 1.2);
    ctx.beginPath();
    ctx.moveTo(x, -4);
    ctx.quadraticCurveTo(x + wob, S / 2, x, S + 4);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,246,0.14)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x + 1.2, -4);
    ctx.quadraticCurveTo(x + 1.2 + wob, S / 2, x + 1.2, S + 4);
    ctx.stroke();
  }
  midribBands(ctx, rng);
  blotches(ctx, rng, 20, 0.07, true, 24, 80);
  blotches(ctx, rng, 12, 0.05, false, 20, 60);
  speckle(ctx, rng, 900, 0.08, true, 1.1);
}

function paintLeafCross(ctx: Ctx, rng: Random): void {
  const grad = ctx.createLinearGradient(0, 0, S, 0);
  grad.addColorStop(0, '#d6e2cc');
  grad.addColorStop(0.5, '#e0e9d6');
  grad.addColorStop(1, '#d6e2cc');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  // Banana-style parallel veins from midrib to margin: fine horizontal lines.
  for (let y = 1; y < S; y += 4) {
    ctx.strokeStyle = 'rgba(62,80,40,0.22)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-4, y);
    ctx.lineTo(S + 4, y + rng.range(-1, 1));
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,246,0.13)';
    ctx.beginPath();
    ctx.moveTo(-4, y + 1.1);
    ctx.lineTo(S + 4, y + 1.1);
    ctx.stroke();
  }
  // A few stronger "tear shadows" between veins.
  for (let i = 0; i < 7; i++) {
    const y = rng.range(0, S);
    ctx.strokeStyle = 'rgba(40,52,24,0.4)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-4, y);
    ctx.lineTo(S + 4, y + rng.range(-3, 3));
    ctx.stroke();
  }
  midribBands(ctx, rng);
  blotches(ctx, rng, 18, 0.07, true, 24, 84);
  speckle(ctx, rng, 800, 0.08, true, 1.1);
}

function paintStem(ctx: Ctx, rng: Random): void {
  ctx.fillStyle = '#ddd8cb';
  ctx.fillRect(0, 0, S, S);
  // Fine vertical fibres.
  for (let i = 0; i < 520; i++) {
    const x = rng.range(0, S);
    const dark = rng.next() < 0.55;
    ctx.strokeStyle = dark ? `rgba(64,58,42,${rng.range(0.05, 0.18)})` : `rgba(252,250,240,${rng.range(0.05, 0.16)})`;
    ctx.lineWidth = rng.range(0.5, 1.4);
    const y0 = rng.range(-30, S * 0.4);
    const y1 = y0 + rng.range(S * 0.4, S);
    wrapped(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x + rng.range(-2.5, 2.5), y1);
      ctx.stroke();
    });
  }
  // Short angled husk strokes (for nuts).
  for (let i = 0; i < 220; i++) {
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const a = rng.range(-0.5, 0.5);
    const len = rng.range(5, 15);
    ctx.strokeStyle = `rgba(72,60,40,${rng.range(0.08, 0.2)})`;
    ctx.lineWidth = rng.range(0.7, 1.6);
    wrapped(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.sin(a) * len, y + Math.cos(a) * len);
      ctx.stroke();
    });
  }
  blotches(ctx, rng, 16, 0.08, true, 30, 90);
  speckle(ctx, rng, 1500, 0.1, true, 1.2);
  speckle(ctx, rng, 700, 0.08, false, 1.2);
}

// ── atlas composition ────────────────────────────────────────────────────────

const PAINTERS = [paintBark, paintLeafLong, paintLeafCross, paintStem];

export function createAtlasCanvas(seed = 1234): AnyCanvas {
  const atlas = makeCanvas(ATLAS.size, ATLAS.size);
  const actx = ctx2d(atlas);
  const rng = new Random(seed);

  for (let t = 0; t < 4; t++) {
    // Pattern canvas (480, tileable).
    const pat = makeCanvas(S, S);
    PAINTERS[t](ctx2d(pat), rng.fork());
    // Cell canvas (512): pattern + wrapped gutter on every side.
    const cell = makeCanvas(ATLAS.cell, ATLAS.cell);
    const cctx = ctx2d(cell);
    const g = ATLAS.gutter;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) cctx.drawImage(pat, g + ox, g + oy);
    // Blit into the atlas. Canvas is uploaded with flipY (three.js default),
    // so GL tile row cy lives at canvas row (1 - cy), drawn flipped.
    const cx = t % 2;
    const cy = Math.floor(t / 2);
    actx.save();
    actx.translate(cx * ATLAS.cell, (1 - cy) * ATLAS.cell + ATLAS.cell);
    actx.scale(1, -1);
    actx.drawImage(cell, 0, 0);
    actx.restore();
  }
  return atlas;
}

/** PNG bytes of the atlas (for GLB embedding); null where unsupported. */
export async function atlasPngBytes(seed = 1234): Promise<ArrayBuffer | undefined> {
  try {
    const c = createAtlasCanvas(seed);
    if (typeof OffscreenCanvas !== 'undefined' && c instanceof OffscreenCanvas) {
      const blob = await c.convertToBlob({ type: 'image/png' });
      return await blob.arrayBuffer();
    }
    const blob = await new Promise<Blob | null>((res) => (c as HTMLCanvasElement).toBlob(res, 'image/png'));
    return blob ? await blob.arrayBuffer() : undefined;
  } catch {
    return undefined;
  }
}
