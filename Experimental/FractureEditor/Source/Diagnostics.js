// Diagnostics: a movable, resizable readout over the viewport, after Project Zero's debug readout. It samples the
// render loop every animation frame and is told about every bake, so each number is something this page measured.
// F3 or the toolbar pulse button opens it; Esc closes it. Position, size and choices persist in localStorage.

const SAVE_KEY = 'frontier.fracture-editor.diagnostics.v1';
const KEEP_MS = 60000;   // samples older than the longest history choice are dropped
const KEEP_BAKES = 48;
const PLOT_H = 132;
const METRICS = [
  { id: 'fps', label: 'Frame rate', accent: '' },
  { id: 'interval', label: 'Frame interval', accent: '' },
  { id: 'bake', label: 'Bake timing', accent: 'warm' },
  { id: 'fracture', label: 'Fracture result', accent: '' },
  { id: 'kinetic', label: 'Simulation · kinetic energy', accent: 'hot' },
];
const VIEWS = [['both', 'Plot + stats'], ['plot', 'Plot only'], ['list', 'Stats only']];
const SECONDS = [15, 30, 60];

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const fmtJ = (j) => (Math.abs(j) >= 1000 ? `${(j / 1000).toFixed(2)} kJ` : `${j < 10 ? j.toFixed(2) : j.toFixed(0)} J`);
const fmtMs = (ms) => `${ms < 10 ? ms.toFixed(2) : ms.toFixed(ms < 100 ? 1 : 0)} ms`;
function numberHtml(amount, decimals, unit, fraction = '') {
  const [i, f] = amount.toFixed(decimals).split('.');
  return `${Number(i).toLocaleString('en-US')}${f ? `<span>.${f}</span>` : ''}${fraction ? `<span>&nbsp;${esc(fraction.trim())}</span>` : ''}${unit ? `<small>${unit}</small>` : ''}`;
}
function percentile(list, p) {
  if (!list.length) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}
const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);

export class Diagnostics {
  // probe() → { mode, playing, time, result, cache, source, recipe, simulation, live, shares, simMs }
  constructor(probe) {
    this.probe = probe;
    this.el = $('Diag');
    this.host = this.el.parentElement;
    this.tracks = { fps: [], interval: [], kinetic: [], awake: [] };
    this.fractures = []; // { t, ms, seeds, cells, needles, pieces, ceiling }
    this.sims = [];      // { t, ms, steps, settled }
    this.paused = false; this.hover = null; this.paintedAt = 0;
    this.lastAt = 0; this.fpsAt = 0; this.frames = 0;
    this.prefs = { metric: 'fps', view: 'both', seconds: 30, open: false, x: null, y: null, w: 340, h: 560 };
    try { Object.assign(this.prefs, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch { /* defaults */ }
    if (!METRICS.some((m) => m.id === this.prefs.metric)) this.prefs.metric = 'fps';
    this.fill($('DiagMetric'), METRICS.map((m) => [m.id, m.label]), this.prefs.metric);
    this.fill($('DiagView'), VIEWS, this.prefs.view);
    this.fill($('DiagSeconds'), SECONDS.map((s) => [String(s), `${s} s history`]), String(this.prefs.seconds));
    this.wire();
    if (this.prefs.open) this.open(); else this.el.hidden = true;
  }

  fill(select, options, current) {
    select.innerHTML = options.map(([id, label]) => `<option value="${id}"${id === current ? ' selected' : ''}>${esc(label)}</option>`).join('');
  }
  remember() { localStorage.setItem(SAVE_KEY, JSON.stringify(this.prefs)); }
  get isOpen() { return !this.el.hidden; }
  toggle() { this.isOpen ? this.close() : this.open(); }
  open() { this.el.hidden = false; this.prefs.open = true; this.place(); this.paint(); this.remember(); $('DiagBtn')?.classList.add('on'); }
  close() { this.el.hidden = true; this.prefs.open = false; this.remember(); $('DiagBtn')?.classList.remove('on'); }

  // ------------------------------------------------------------------ layout
  place() {
    const W = this.host.clientWidth, H = this.host.clientHeight; if (!W) return;
    const p = this.prefs;
    p.w = Math.max(280, Math.min(p.w, W - 24)); p.h = Math.max(300, Math.min(p.h, H - 24));
    if (p.x === null || p.y === null) { p.x = W - p.w - 16; p.y = 16; }
    p.x = Math.max(8, Math.min(p.x, W - p.w - 8)); p.y = Math.max(8, Math.min(p.y, H - p.h - 8));
    Object.assign(this.el.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${p.w}px`, height: `${p.h}px` });
    $('DiagSize').textContent = `${Math.round(p.w)} × ${Math.round(p.h)} · resize ↘`;
  }
  wire() {
    const drag = (grip, apply) => {
      let from = null;
      grip.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; e.preventDefault(); grip.setPointerCapture(e.pointerId); from = { x: e.clientX, y: e.clientY, ...this.prefs }; });
      grip.addEventListener('pointermove', (e) => { if (!from) return; apply(e.clientX - from.x, e.clientY - from.y, from); this.place(); this.paintPlot(); });
      const end = () => { if (from) { from = null; this.remember(); } };
      grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
    };
    drag($('DiagDrag'), (dx, dy, f) => { this.prefs.x = f.x + dx; this.prefs.y = f.y + dy; });
    drag($('DiagResize'), (dx, dy, f) => { this.prefs.w = f.w + dx; this.prefs.h = f.h + dy; });
    $('DiagClose').addEventListener('click', () => this.close());
    $('DiagReset').addEventListener('click', () => { Object.assign(this.prefs, { x: null, y: null, w: 340, h: 560 }); this.place(); this.paint(); this.remember(); });
    $('DiagMetric').addEventListener('change', (e) => { this.prefs.metric = e.target.value; this.hover = null; this.paint(); this.remember(); });
    $('DiagView').addEventListener('change', (e) => { this.prefs.view = e.target.value; this.paint(); this.remember(); });
    $('DiagSeconds').addEventListener('change', (e) => { this.prefs.seconds = +e.target.value; this.paint(); this.remember(); });
    $('DiagPause').addEventListener('click', () => { this.paused = !this.paused; this.paint(); });
    const plot = $('DiagPlot');
    plot.addEventListener('pointermove', (e) => { const r = plot.getBoundingClientRect(); this.hover = e.clientX - r.left; this.paintPlot(); });
    plot.addEventListener('pointerleave', () => { this.hover = null; this.paintPlot(); });
    for (const k of ['pointerdown', 'wheel', 'click', 'dblclick']) this.el.addEventListener(k, (e) => e.stopPropagation());
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } });
    addEventListener('resize', () => { if (this.isOpen) { this.place(); this.paintPlot(); } });
  }

  // ------------------------------------------------------------------ sampling
  push(track, t, amount) { const list = this.tracks[track]; list.push([t, amount]); while (list.length && t - list[0][0] > KEEP_MS) list.shift(); }
  frame(now) {
    if (this.lastAt && !this.paused) this.push('interval', now, now - this.lastAt);
    this.lastAt = now; this.frames++;
    if (!this.fpsAt) this.fpsAt = now;
    if (now - this.fpsAt >= 250) { if (!this.paused) this.push('fps', now, (this.frames * 1000) / (now - this.fpsAt)); this.frames = 0; this.fpsAt = now; }
    const s = this.probe();
    if (s.mode !== 'edit' && s.cache && !this.paused) { this.push('kinetic', now, s.live.total); this.push('awake', now, s.live.awake); }
    if (this.isOpen && !this.paused && now - this.paintedAt > 220) this.paint();
  }
  bakeFracture(result) {
    const t = result.timings || {};
    this.fractures.push({ t: performance.now(), ms: result.ms, seeds: t.seeds || 0, cells: t.cells || 0, needles: t.needles || 0, pieces: result.pieces.length, ceiling: result.recipe.Ceiling });
    if (this.fractures.length > KEEP_BAKES) this.fractures.shift();
    if (this.isOpen) this.paint();
  }
  bakeSimulation(cache) {
    this.sims.push({ t: performance.now(), ms: cache.ms, steps: cache.steps, settled: cache.settled });
    if (this.sims.length > KEEP_BAKES) this.sims.shift();
    if (this.isOpen) this.paint();
  }

  // ------------------------------------------------------------------ readouts
  recent(track) { const now = performance.now(), span = this.prefs.seconds * 1000; return this.tracks[track].filter(([t]) => now - t <= span); }
  reading() {
    const s = this.probe(), id = this.prefs.metric, span = this.prefs.seconds * 1000, now = performance.now();
    const timeSeries = (list) => ({ kind: 'time', points: list.map(([t, v]) => [1 - (now - t) / span, v]) });
    if (id === 'fps' || id === 'interval') {
      const fps = this.recent('fps').map((p) => p[1]), gaps = this.recent('interval').map((p) => p[1]);
      const latestFps = fps.length ? fps[fps.length - 1] : 0, budget = 1000 / 60;
      const over = gaps.filter((g) => g > budget * 1.5).length;
      const rows = [
        ['Average', id === 'fps' ? `${mean(fps).toFixed(1)} fps` : fmtMs(mean(gaps))],
        ['Minimum', id === 'fps' ? `${(fps.length ? Math.min(...fps) : 0).toFixed(1)} fps` : fmtMs(gaps.length ? Math.min(...gaps) : 0)],
        ['Maximum', id === 'fps' ? `${(fps.length ? Math.max(...fps) : 0).toFixed(1)} fps` : fmtMs(gaps.length ? Math.max(...gaps) : 0)],
        ['1 % low', `${(gaps.length ? 1000 / percentile(gaps, 0.99) : 0).toFixed(1)} fps`],
        ['95th percentile interval', fmtMs(percentile(gaps, 0.95))],
        ['Frames over 25 ms', `${over} of ${gaps.length}`, over ? 'bad' : 'good'],
        ['Phase', `${s.mode.toUpperCase()}${s.playing ? ' · playing' : ''}`],
      ];
      if (id === 'fps') return {
        number: numberHtml(latestFps, 1, 'fps'), source: 'requestAnimationFrame callbacks counted every 250 ms in this tab. Background or headless tabs are throttled by the browser.',
        series: timeSeries(this.recent('fps')), reference: [60, '60 fps display'], format: (v) => `${v.toFixed(1)} fps`, rows,
        native: `samples ${fps.length} · window ${this.prefs.seconds} s · latest ${latestFps.toFixed(2)} fps`,
      };
      const lastGap = gaps.length ? gaps[gaps.length - 1] : 0;
      return {
        number: numberHtml(lastGap, 1, 'ms'), source: 'Time between consecutive animation frames. Spikes line up with fracture and simulation bakes, which run on the main thread.',
        series: timeSeries(this.recent('interval')), reference: [budget, '16.7 ms budget'], format: fmtMs, rows,
        native: `frames ${gaps.length} · mean ${mean(gaps).toFixed(3)} ms · worst ${(gaps.length ? Math.max(...gaps) : 0).toFixed(3)} ms`,
      };
    }
    if (id === 'bake') {
      const last = this.fractures[this.fractures.length - 1], sim = this.sims[this.sims.length - 1], all = this.fractures.map((f) => f.ms);
      const rest = last ? Math.max(0, last.ms - last.seeds - last.cells - last.needles) : 0;
      return {
        number: last ? numberHtml(last.ms, last.ms < 100 ? 1 : 0, 'ms') : '—',
        source: 'Wall time of each fracture bake on the main thread (seeding, Voronoi cells with clipping and seams, needle rejection) and of each rigid-body bake.',
        series: { kind: 'index', points: all.map((v, k) => [all.length > 1 ? k / (all.length - 1) : 1, v]) }, reference: [100, '100 ms interactive'], format: fmtMs,
        split: last ? [['Seeding', last.seeds, '#7aa7e0'], ['Cells + seams', last.cells, '#589979'], ['Needle rejection', last.needles, '#b9a969'], ['Sort + totals', rest, '#8b9283'], ['Rigid-body bake', sim ? sim.ms : 0, '#d0574c']] : null,
        rows: [
          ['Fracture bakes recorded', `${all.length}`], ['Average fracture', fmtMs(mean(all))], ['Slowest fracture', fmtMs(all.length ? Math.max(...all) : 0)],
          ['Last rigid-body bake', sim ? `${fmtMs(sim.ms)} · ${sim.steps} steps` : 'Not baked · Shift+2'],
          ['Cells in last bake', last ? `${last.pieces} pieces` : '—'],
        ],
        native: last ? `fracture ${last.ms.toFixed(2)} ms = seeds ${last.seeds.toFixed(2)} + cells ${last.cells.toFixed(2)} + needles ${last.needles.toFixed(2)} + rest ${rest.toFixed(2)}` : 'No bakes yet',
        empty: 'No fracture bakes yet. Change any recipe value to bake.',
      };
    }
    if (id === 'fracture') {
      const r = s.result, m = r.metrics, st = r.stats || {}, pts = this.fractures.map((f) => f.pieces);
      const worstQ = m.minQ;
      return {
        number: numberHtml(m.pieces, 0, 'pieces', ` / ${r.recipe.Ceiling}`),
        source: 'The current bake as built: closed convex pieces, the Voronoi cells that made them, and how faithfully the facets keep the analytical volume.',
        series: { kind: 'index', points: pts.map((v, k) => [pts.length > 1 ? k / (pts.length - 1) : 1, v]) }, reference: [r.recipe.Ceiling, `ceiling ${r.recipe.Ceiling}`], format: (v) => `${Math.round(v)} pieces`,
        rows: [
          ['Voronoi cells', `${m.cells}${r.plan.capped ? ' · ceiling reached' : ''}`, r.plan.capped ? 'bad' : ''],
          ['Requested by energy', `${r.plan.requested}`],
          ['Seam joins', `${st.rejoined || 0}${st.split ? ` · ${st.split} split` : ''}`],
          ['Seeds refused', `${m.refused}`],
          ['Triangles', m.tris.toLocaleString()],
          ['Volume kept', `${m.occupied.toFixed(2)} %`, Math.abs(m.occupied - 100) < 0.05 ? 'good' : 'bad'],
          ['Faceting error', `${(s.source.faceting * 100).toFixed(2)} %`, Math.abs(s.source.faceting) < 0.01 ? 'good' : ''],
          ['Worst triangle quality', worstQ.toFixed(3), worstQ < 0.02 ? 'bad' : 'good'],
          ['New crack area', `${m.cutArea.toFixed(3)} m²`],
          ['Smallest / largest', `${(m.smallest * 1e3).toFixed(2)} / ${(m.largest * 1e3).toFixed(2)} L`],
          ['GPU estimate', `${(m.bytes / 1024).toFixed(0)} KB`],
        ],
        native: r.log.join('\n'),
        empty: 'Piece history fills as you re-bake.',
      };
    }
    // kinetic
    const k = this.recent('kinetic'), aw = this.recent('awake'), c = s.cache;
    const latest = s.mode !== 'edit' ? s.live.total : 0, peak = c ? Math.max(...c.totals) : 0;
    return {
      number: s.mode === 'edit' ? '—' : latest >= 1000 ? numberHtml(latest / 1000, 2, 'kJ') : numberHtml(latest, latest < 10 ? 2 : 0, 'J'),
      source: 'Summed kinetic energy of every fragment at the playhead, sampled each frame while Sim or Play is shown.',
      series: timeSeries(k), reference: c ? [peak, `peak ${fmtJ(peak)}`] : null, format: fmtJ,
      rows: [
        ['Moving fragments', s.mode === 'edit' ? '—' : `${s.live.awake} of ${s.result.pieces.length}`],
        ['Released by impact', `${s.shares.releasedCount}`],
        ['Peak kinetic (baked)', c ? fmtJ(peak) : 'Not baked'],
        ['Settles at', c ? (c.settled === null ? 'still moving at end' : `${c.settled.toFixed(2)} s`) : '—', c && c.settled === null ? 'bad' : c ? 'good' : ''],
        ['Playhead', `${s.time.toFixed(2)} s of ${(c ? c.duration : s.simulation.Duration).toFixed(2)} s`],
        ['Steps baked', c ? `${c.steps} at ${c.rate} Hz` : '—'],
        ['Collisions', s.simulation.Collisions ? 'Sphere proxies' : 'Off'],
        ['Most moving in window', `${aw.length ? Math.max(...aw.map((p) => p[1])) : 0}`],
      ],
      native: c ? `bake ${c.ms.toFixed(1)} ms · ${c.n} bodies · transfer ${(s.simulation.Transfer * 100).toFixed(0)} % · release ${s.simulation.Release} J` : 'Not baked',
      empty: 'Simulate (Shift+2) or play (Space) to sample kinetic energy.',
    };
  }

  paint() {
    if (!this.isOpen) return;
    this.paintedAt = performance.now();
    const def = METRICS.find((m) => m.id === this.prefs.metric), view = this.prefs.view;
    this.current = this.reading();
    const cur = this.current;
    this.el.classList.toggle('paused', this.paused);
    $('DiagLive').textContent = this.paused ? 'PAUSED' : 'LIVE';
    $('DiagPause').textContent = this.paused ? 'Resume samples' : 'Pause samples';
    $('DiagPause').classList.toggle('on', this.paused);
    const title = $('DiagTitle'); title.querySelector('i').className = def.accent; title.querySelector('span').textContent = def.label;
    $('DiagNumber').innerHTML = cur.number;
    $('DiagSource').textContent = cur.source;
    $('DiagPlot').hidden = view === 'list';
    const stats = $('DiagStats');
    stats.hidden = view === 'plot';
    const split = cur.split ? `<div class="diag-split">${(() => { const top = Math.max(1e-6, ...cur.split.map((p) => p[1])); return cur.split.map(([label, ms, color]) => `<div><span>${label}</span><i><b style="width:${(ms / top) * 100}%;background:${color}"></b></i><em>${fmtMs(ms)}</em></div>`).join(''); })()}</div>` : '';
    stats.innerHTML = split + cur.rows.map(([dt, dd, cls]) => `<div><dt>${esc(dt)}</dt><dd class="${cls || ''}">${esc(dd)}</dd></div>`).join('');
    $('DiagNativeTitle').textContent = `Debug view · ${def.label.toLowerCase()}`;
    $('DiagNative').textContent = cur.native;
    $('DiagNative').style.whiteSpace = 'pre-wrap';
    this.paintPlot();
  }

  // SVG history: dashed grid, reference line, soft area, crisp line, hover probe.
  paintPlot() {
    const box = $('DiagPlot'), cur = this.current;
    if (!cur || box.hidden) return;
    const pts = cur.series.points.filter((p) => p[0] >= 0);
    if (!pts.length) { box.innerHTML = `<div class="diag-empty">${esc(cur.empty || 'Collecting samples…')}</div>`; return; }
    const W = Math.max(200, box.clientWidth || 290), H = PLOT_H, L = 2, R = W - 40, T = 8, B = H - 18;
    const ref = cur.reference ? cur.reference[0] : 0;
    let top = Math.max(1e-6, ref, ...pts.map((p) => p[1])) * 1.12;
    const mag = Math.pow(10, Math.floor(Math.log10(top))), nice = [1, 2, 2.5, 5, 10].find((n) => n * mag >= top) * mag; top = nice;
    const X = (u) => L + u * (R - L), Y = (v) => B - (v / top) * (B - T);
    let grid = '';
    for (let k = 0; k <= 4; k++) {
      const v = (top * k) / 4, y = Y(v).toFixed(1);
      grid += `<line x1="${L}" x2="${R}" y1="${y}" y2="${y}" stroke="#ffffff14" stroke-dasharray="3 4"/><text x="${R + 6}" y="${(+y + 3).toFixed(1)}">${cur.format(v).replace(/\.0+ /, ' ')}</text>`;
    }
    const xl = cur.series.kind === 'time'
      ? [[0, `−${this.prefs.seconds} s`], [0.5, `−${this.prefs.seconds / 2} s`], [1, 'now']]
      : [[0, pts.length > 1 ? `bake −${pts.length - 1}` : ''], [1, 'latest bake']];
    const axis = xl.map(([u, t]) => `<text x="${X(u).toFixed(1)}" y="${H - 3}" text-anchor="${u === 0 ? 'start' : u === 1 ? 'end' : 'middle'}">${t}</text>`).join('');
    const line = pts.map((p, k) => `${k ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join('');
    const area = `${line}L${X(pts[pts.length - 1][0]).toFixed(1)} ${B}L${X(pts[0][0]).toFixed(1)} ${B}Z`;
    const refLine = cur.reference && ref < top ? `<line x1="${L}" x2="${R}" y1="${Y(ref).toFixed(1)}" y2="${Y(ref).toFixed(1)}" stroke="#a3ac9260" stroke-dasharray="6 4"/>` : '';
    const dots = cur.series.kind === 'index' && pts.length <= 48 ? pts.map((p) => `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="2.2" fill="#dbded6"/>`).join('') : '';
    let probe = '', caption = `${pts.length} ${cur.series.kind === 'time' ? 'samples' : 'bakes'} · latest ${cur.format(pts[pts.length - 1][1])}`;
    if (this.hover !== null && this.hover >= L && this.hover <= R + 4) {
      const u = (this.hover - L) / (R - L);
      let best = pts[0]; for (const p of pts) if (Math.abs(p[0] - u) < Math.abs(best[0] - u)) best = p;
      const px = X(best[0]), py = Y(best[1]);
      probe = `<line x1="${px.toFixed(1)}" x2="${px.toFixed(1)}" y1="${T}" y2="${B}" stroke="#b8c9a855"/><circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" fill="#b8c9a8" stroke="#202020" stroke-width="2"/>`;
      caption = cur.series.kind === 'time' ? `${cur.format(best[1])} · ${((1 - best[0]) * this.prefs.seconds).toFixed(1)} s ago` : `${cur.format(best[1])} · bake ${pts.indexOf(best) + 1} of ${pts.length}`;
    }
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(METRICS.find((m) => m.id === this.prefs.metric).label)} history">
      ${grid}${refLine}<path d="${area}" fill="#a3ac920c"/><path d="${line}" fill="none" stroke="#dbded6" stroke-width="1.4" stroke-linejoin="round"/>${dots}${probe}${axis}</svg>
      <div class="diag-caption"><span>${esc(caption)}</span><span>${cur.reference ? `Reference · ${esc(cur.reference[1])}` : 'No reference'}</span></div>`;
  }
}
