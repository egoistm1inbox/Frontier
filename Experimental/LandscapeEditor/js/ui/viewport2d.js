// Top-down views of the evaluated terrain: satmap, height with contours, slope, flow and sediment.
// All colours are computed from the arrays the worker returns, so a view always matches the numbers
// shown in the inspector.
import { clamp, smoothstep } from '../core/rng.js';

const RAMPS = {
  slope: [[0, [34, 74, 42]], [0.35, [196, 186, 84]], [0.68, [208, 118, 52]], [1, [186, 48, 40]]],
  flow: [[0, [8, 16, 30]], [0.5, [38, 104, 152]], [1, [186, 230, 244]]],
  sediment: [[0, [16, 12, 9]], [0.5, [126, 92, 52]], [1, [232, 204, 146]]],
};

function ramp(stops, t) {
  const x = clamp(t, 0, 1);
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const k = (x - t0) / Math.max(1e-6, t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}

export class View2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.off = document.createElement('canvas');
    this.model = null;
    this.rect = null;
    this.dpr = 1;
  }

  setModel(model) {
    this.model = model;
    this.draw();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight));
    this.dpr = dpr;
    if (this.canvas.width !== Math.floor(w * dpr) || this.canvas.height !== Math.floor(h * dpr)) {
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
    }
    this.draw();
  }

  // Square map rectangle inside the canvas, in CSS pixels.
  layout() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const side = Math.max(16, Math.min(w, h) - 56);
    this.rect = { x: (w - side) / 2, y: (h - side) / 2, w: side, h: side };
    return this.rect;
  }

  draw() {
    const ctx = this.ctx;
    const { canvas } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const m = this.model;
    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!m || !m.result) {
      this.message('Computing the first result…');
      return;
    }
    const r = m.result;
    const N = r.N;
    const rect = this.layout();
    const d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);

    if (m.mode === 'satmap' && r.colour) {
      const S = r.colourSize;
      this.blit(S, S, r.colour, rect, true);
    } else {
      const rgba = new Uint8ClampedArray(N * N * 4);
      const sea = m.terrain.seaLevel;
      const water = m.water;
      if (m.mode === 'slope') this.fill(rgba, N, (i) => ramp(RAMPS.slope, r.slope[i] / 45));
      else if (m.mode === 'flow') {
        const logMax = Math.log1p(maxOf(r.flow));
        this.fill(rgba, N, (i) => ramp(RAMPS.flow, Math.log1p(r.flow[i]) / logMax));
      }
      else if (m.mode === 'sediment') {
        if (!r.deposition) {
          this.message('No sediment yet. Add a hydraulic or thermal erosion layer to deposit material.');
          return;
        }
        this.fill(rgba, N, (i) => ramp(RAMPS.sediment, r.deposition[i]));
      } else {
        // Height: grey ramp with contour lines every 5% of the height range.
        this.fill(rgba, N, (i) => {
          const hv = clamp(r.height[i], 0, 1);
          const g = 26 + hv * 214;
          const band = Math.floor(hv * 20);
          const edge = (i % N < N - 1 && Math.floor(clamp(r.height[i + 1], 0, 1) * 20) !== band) || (Math.floor(i / N) < N - 1 && Math.floor(clamp(r.height[i + N], 0, 1) * 20) !== band);
          if (edge) return [g * 0.55, g * 0.55, g * 0.55];
          return [g, g, g];
        });
      }
      if (water && m.mode !== 'satmap') {
        for (let i = 0; i < N * N; i++) {
          if (r.height[i] < sea) {
            const depth = smoothstep(0, sea * 0.6, sea - r.height[i]);
            rgba[i * 4] = rgba[i * 4] * (1 - 0.55 * depth) + 18 * 0.55 * depth;
            rgba[i * 4 + 1] = rgba[i * 4 + 1] * (1 - 0.55 * depth) + 86 * 0.55 * depth;
            rgba[i * 4 + 2] = rgba[i * 4 + 2] * (1 - 0.55 * depth) + 128 * 0.55 * depth;
          }
        }
      }
      this.blit(N, N, rgba, rect, false);
    }
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x - 0.5, rect.y - 0.5, rect.w + 1, rect.h + 1);
    this.caption(m);
  }

  fill(rgba, N, fn) {
    for (let i = 0; i < N * N; i++) {
      const c = fn(i);
      rgba[i * 4] = c[0];
      rgba[i * 4 + 1] = c[1];
      rgba[i * 4 + 2] = c[2];
      rgba[i * 4 + 3] = 255;
    }
  }

  blit(W, H, rgba, rect, smooth) {
    if (this.off.width !== W || this.off.height !== H) {
      this.off.width = W;
      this.off.height = H;
    }
    const octx = this.off.getContext('2d');
    octx.putImageData(new ImageData(new Uint8ClampedArray(rgba), W, H), 0, 0);
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = smooth || rect.w >= W;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.off, rect.x, rect.y, rect.w, rect.h);
  }

  message(text) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#8a8a8a';
    ctx.font = '12px "DM Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, this.canvas.clientWidth / 2, this.canvas.clientHeight / 2);
    ctx.textAlign = 'start';
  }

  caption(m) {
    const ctx = this.ctx;
    const label = { satmap: 'Satmap', height: 'Height · contours every 5%', slope: 'Slope', flow: 'Drainage · log scale', sediment: 'Sediment deposition' }[m.mode] || '';
    ctx.font = '11px "DM Sans", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(label, this.rect.x, this.rect.y - 10);
    const N = m.result.N;
    const km = (m.terrain.extentM / 1000).toFixed(1);
    ctx.textAlign = 'end';
    ctx.fillText(`${km} km · ${N}²`, this.rect.x + this.rect.w, this.rect.y - 10);
    ctx.textAlign = 'start';
  }

  // Map cell under a CSS-pixel point, or null outside the map.
  cellAt(px, py) {
    const rect = this.rect;
    if (!rect || !this.model?.result) return null;
    const N = this.model.result.N;
    const u = (px - rect.x) / rect.w;
    const v = (py - rect.y) / rect.h;
    if (u < 0 || v < 0 || u > 1 || v > 1) return null;
    const x = Math.min(N - 1, Math.max(0, Math.round(u * (N - 1))));
    const y = Math.min(N - 1, Math.max(0, Math.round(v * (N - 1))));
    return { x, y, i: y * N + x };
  }
}

function maxOf(arr) {
  let m = 1;
  for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
  return m;
}
