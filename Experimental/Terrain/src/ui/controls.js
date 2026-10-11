// Inspector controls. Every control calls onInput(v) continuously and onCommit(v) when an edit is finished.
import { h, ic } from './dom.js';
import { clamp } from '../core/math.js';

export function fmt(v, d = {}) {
  const u = d.unit || '';
  if (u === '%') return Math.round(v * 100) + '%';
  if (u === 'm') return Math.abs(v) >= 1000 ? (v / 1000).toFixed(Math.abs(v) >= 10000 ? 1 : 2) + ' km' : (Math.abs(v) >= 100 ? Math.round(v) : +v.toFixed(Math.abs(v) >= 10 ? 1 : 2)) + ' m';
  if (u === 'km') return +v.toFixed(v >= 10 ? 1 : 2) + ' km';
  if (u === '°') return Math.round(v * 10) / 10 + '°';
  if (u === '×') return v.toFixed(2) + '×';
  if (d.type === 'int') return String(Math.round(v));
  const st = d.step ?? 0.01;
  const dec = st >= 1 ? 0 : st >= 0.1 ? 1 : st >= 0.01 ? 2 : 3;
  return v.toFixed(dec) + (u ? ' ' + u : '');
}
export function metricParts(v, d = {}) {
  const u = d.unit || '';
  if (u === '%') return [String(Math.round(v * 100)), '%'];
  if (u === 'm') return Math.abs(v) >= 1000 ? [(v / 1000).toFixed(2), 'km'] : [String(Math.round(v)), 'm'];
  if (u === 'km') return [(+v).toFixed(v >= 10 ? 1 : 2), 'km'];
  if (u === '°') return [String(Math.round(v)), '°'];
  if (u === '×') return [(+v).toFixed(2), '×'];
  if (d.type === 'int') return [String(Math.round(v)), ''];
  return [(+v).toFixed(2), u];
}

const toT = (v, d) => d.curve === 'log' ? Math.log(v / d.min) / Math.log(d.max / d.min) : (v - d.min) / (d.max - d.min);
const fromT = (t, d) => d.curve === 'log' ? d.min * Math.pow(d.max / d.min, t) : d.min + t * (d.max - d.min);
const snap = (v, d) => { const st = d.type === 'int' ? 1 : (d.step || 0.001); return clamp(Math.round(v / st) * st, d.min, d.max); };

export function sliderRow(d, value, { onInput, onCommit, accent } = {}) {
  let v = value;
  const val = h('span.ctl-v', fmt(v, d));
  const tr = h('div.tr'), th = h('div.th');
  const sl = h('div.slider', tr, th);
  if (accent) sl.style.setProperty('--acc', accent);
  const el = h('div.ctl', h('div.ctl-top', h('span.ctl-l', d.label), val), sl,
    d.hint ? h('div.hints', h('span', d.hint[0]), h('span', d.hint[1])) : null);
  const paint = () => { const t = clamp(toT(v, d), 0, 1); sl.style.setProperty('--p', (t * 100).toFixed(2) + '%'); val.textContent = fmt(v, d); };
  paint();
  let dragging = false, startX = 0, startT = 0;
  const fromEvent = (e) => {
    const r = sl.getBoundingClientRect();
    if (e.shiftKey) return clamp(startT + (e.clientX - startX) / r.width * 0.1, 0, 1);
    return clamp((e.clientX - r.left) / r.width, 0, 1);
  };
  sl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true; sl.classList.add('drag'); sl.setPointerCapture(e.pointerId);
    startX = e.clientX; startT = toT(v, d);
    const nv = snap(fromT(fromEvent(e), d), d);
    if (nv !== v) { v = nv; paint(); onInput?.(v); }
  });
  sl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const nv = snap(fromT(fromEvent(e), d), d);
    if (nv !== v) { v = nv; paint(); onInput?.(v); }
  });
  const end = () => { if (!dragging) return; dragging = false; sl.classList.remove('drag'); onCommit?.(v); };
  sl.addEventListener('pointerup', end);
  sl.addEventListener('pointercancel', end);
  sl.addEventListener('dblclick', () => { if (d.default !== undefined) { v = d.default; paint(); onInput?.(v); onCommit?.(v); } });
  val.addEventListener('click', () => {
    const inp = h('input', { value: d.unit === '%' ? Math.round(v * 100) : +(+v).toFixed(4) });
    val.textContent = ''; val.append(inp); inp.focus(); inp.select();
    const done = (ok) => {
      if (ok) { let n = parseFloat(inp.value); if (!isNaN(n)) { if (d.unit === '%') n /= 100; v = snap(n, d); onInput?.(v); onCommit?.(v); } }
      paint();
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); e.stopPropagation(); });
    inp.addEventListener('blur', () => done(true));
  });
  el.set = (nv) => { v = nv; paint(); };
  return el;
}

export function pills(options, value, onChange) {
  const el = h('div.pills');
  const btns = options.map((o, i) => {
    const b = h('button' + (i === value ? '.on' : ''), o);
    b.addEventListener('click', () => { btns.forEach(x => x.classList.remove('on')); b.classList.add('on'); onChange(i); });
    return b;
  });
  el.append(...btns);
  return el;
}

export function selectCtl(options, value, onChange) {
  const s = h('select.sel', options.map((o, i) => h('option', { value: i, selected: i === value }, o)));
  s.addEventListener('change', () => onChange(+s.value));
  return s;
}

export function enumRow(d, value, onChange) {
  return h('div.ctl', h('div.ctl-top', h('span.ctl-l', d.label)), d.options.length <= 4 ? pills(d.options, value, onChange) : selectCtl(d.options, value, onChange));
}

export function toggle(on, onChange) {
  const t = h('button.tog' + (on ? '.on' : ''));
  t.addEventListener('click', () => { on = !on; t.classList.toggle('on', on); onChange(on); });
  return t;
}
export function toggleRow(label, on, onChange) { return h('div.line', h('span.ctl-l', label), toggle(on, onChange)); }

export function colorRow(label, hex, { onInput, onCommit }) {
  const inp = h('input', { type: 'color', value: hex });
  const sw = h('div.sw', { style: { background: hex } }, inp);
  const tx = h('input.hex', { value: hex, spellcheck: false });
  inp.addEventListener('input', () => { sw.style.background = inp.value; tx.value = inp.value; onInput?.(inp.value); });
  inp.addEventListener('change', () => onCommit?.(inp.value));
  tx.addEventListener('keydown', (e) => e.stopPropagation());
  tx.addEventListener('change', () => {
    const v = tx.value.trim();
    if (/^#?[0-9a-f]{6}$/i.test(v)) { const c = v[0] === '#' ? v : '#' + v; inp.value = c; sw.style.background = c; onInput?.(c); onCommit?.(c); }
  });
  return h('div.ctl', h('div.ctl-top', h('span.ctl-l', label)), h('div.color', sw, tx));
}

// XY pad for normalised positions; optional background preview drawn by caller (bg canvas).
export function xyPad(x, y, { onInput, onCommit, bg }) {
  const hd = h('div.hd');
  const pad = h('div.xy', bg || null, h('div.gl', { style: { left: '50%', top: 0, bottom: 0, width: '1px' } }), h('div.gl', { style: { top: '50%', left: 0, right: 0, height: '1px' } }), hd);
  const paint = () => { hd.style.left = (x * 100) + '%'; hd.style.top = (y * 100) + '%'; };
  paint();
  let drag = false;
  const at = (e) => { const r = pad.getBoundingClientRect(); x = clamp((e.clientX - r.left) / r.width, 0, 1); y = clamp((e.clientY - r.top) / r.height, 0, 1); paint(); onInput?.(x, y); };
  pad.addEventListener('pointerdown', (e) => { drag = true; pad.setPointerCapture(e.pointerId); at(e); });
  pad.addEventListener('pointermove', (e) => drag && at(e));
  pad.addEventListener('pointerup', () => { if (drag) { drag = false; onCommit?.(x, y); } });
  pad.set = (nx, ny) => { x = nx; y = ny; paint(); };
  return pad;
}

export function dialRow(d, value, { onInput, onCommit, accent }) {
  let v = value;
  const tick = h('div.tick');
  const dial = h('div.dial', h('span.nn', 'N'), tick);
  if (accent) dial.style.setProperty('--acc', accent);
  const slider = sliderRow(d, v, { onInput: (nv) => { v = nv; paint(); onInput?.(nv); }, onCommit, accent });
  const paint = () => { tick.style.transform = `rotate(${v}deg)`; };
  paint();
  let drag = false;
  const at = (e) => {
    const r = dial.getBoundingClientRect();
    let a = Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180 / Math.PI;
    if (d.min >= 0) a = (a + 360) % 360;
    if (e.shiftKey) a = Math.round(a / 15) * 15;
    v = clamp(Math.round(a), d.min, d.max); paint(); slider.set(v); onInput?.(v);
  };
  dial.addEventListener('pointerdown', (e) => { drag = true; dial.setPointerCapture(e.pointerId); at(e); });
  dial.addEventListener('pointermove', (e) => drag && at(e));
  dial.addEventListener('pointerup', () => { if (drag) { drag = false; onCommit?.(v); } });
  const el = h('div.dialrow', dial, h('div', { style: { flex: '1' } }, slider));
  el.set = (nv) => { v = nv; paint(); slider.set(nv); };
  return el;
}

// Monotone curve editor over [0,1]²: click to add, drag to move, double-click a point to remove.
export function curveEditor(points, { onInput, onCommit, accent = '#9fc3d8' }) {
  let pts = points.map(p => [...p]);
  const cv = h('canvas');
  const box = h('div.curve', cv);
  let drag = -1;
  const draw = () => {
    const r = box.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(10, r.width * dpr); cv.height = Math.max(10, r.height * dpr);
    const c = cv.getContext('2d');
    const W = cv.width, H = cv.height, pad = 10 * dpr;
    c.clearRect(0, 0, W, H);
    c.strokeStyle = 'rgba(255,255,255,.06)'; c.lineWidth = dpr;
    for (let i = 1; i < 4; i++) { const x = pad + (W - 2 * pad) * i / 4, y = pad + (H - 2 * pad) * i / 4; c.beginPath(); c.moveTo(x, pad); c.lineTo(x, H - pad); c.stroke(); c.beginPath(); c.moveTo(pad, y); c.lineTo(W - pad, y); c.stroke(); }
    c.strokeStyle = 'rgba(255,255,255,.12)'; c.setLineDash([3 * dpr, 4 * dpr]); c.beginPath(); c.moveTo(pad, H - pad); c.lineTo(W - pad, pad); c.stroke(); c.setLineDash([]);
    const s = sortPts();
    c.strokeStyle = accent; c.lineWidth = 2 * dpr; c.beginPath();
    for (let i = 0; i <= 100; i++) { const x = i / 100, y = evalCurve(s, x); const px = pad + x * (W - 2 * pad), py = H - pad - y * (H - 2 * pad); i ? c.lineTo(px, py) : c.moveTo(px, py); }
    c.stroke();
    for (const p of s) { c.fillStyle = '#e8e8e8'; c.beginPath(); c.arc(pad + p[0] * (W - 2 * pad), H - pad - p[1] * (H - 2 * pad), 4.5 * dpr, 0, 7); c.fill(); }
  };
  const sortPts = () => [...pts].sort((a, b) => a[0] - b[0]);
  const toN = (e) => { const r = box.getBoundingClientRect(); const pad = 10; return [clamp((e.clientX - r.left - pad) / (r.width - 2 * pad), 0, 1), clamp(1 - (e.clientY - r.top - pad) / (r.height - 2 * pad), 0, 1)]; };
  const nearest = (n) => { let bi = -1, bd = 0.06; pts.forEach((p, i) => { const d = Math.hypot(p[0] - n[0], (p[1] - n[1]) * 0.7); if (d < bd) { bd = d; bi = i; } }); return bi; };
  box.addEventListener('pointerdown', (e) => {
    const n = toN(e);
    drag = nearest(n);
    if (drag < 0) { pts.push(n); drag = pts.length - 1; onInput?.(sortPts()); }
    box.setPointerCapture(e.pointerId); draw();
  });
  box.addEventListener('pointermove', (e) => { if (drag < 0) return; pts[drag] = toN(e); draw(); onInput?.(sortPts()); });
  box.addEventListener('pointerup', () => { if (drag >= 0) { drag = -1; pts = sortPts(); onCommit?.(pts); } });
  box.addEventListener('dblclick', (e) => { const i = nearest(toN(e)); if (i >= 0 && pts.length > 2) { pts.splice(i, 1); pts = sortPts(); draw(); onInput?.(pts); onCommit?.(pts); } });
  new ResizeObserver(draw).observe(box);
  box.set = (np) => { pts = np.map(p => [...p]); draw(); };
  return box;
}
// Monotone cubic (Fritsch–Carlson) evaluation shared with the engine's LUT builder.
export function evalCurve(s, x) {
  if (!s.length) return x;
  if (x <= s[0][0]) return s[0][1];
  if (x >= s[s.length - 1][0]) return s[s.length - 1][1];
  let i = 0; while (i < s.length - 2 && x > s[i + 1][0]) i++;
  const [x0, y0] = s[i], [x1, y1] = s[i + 1];
  const t = (x - x0) / Math.max(x1 - x0, 1e-6);
  return y0 + (y1 - y0) * (t * t * (3 - 2 * t));
}

export function seedRow(value, { onCommit }) {
  const inp = h('input', { value, inputmode: 'numeric' });
  inp.addEventListener('keydown', (e) => e.stopPropagation());
  inp.addEventListener('change', () => { const n = Math.max(0, Math.floor(+inp.value || 0)); inp.value = n; onCommit(n); });
  const dice = h('button.ibtn', { title: 'New seed' }, ic('dices', 15));
  dice.addEventListener('click', () => { const n = Math.floor(Math.random() * 99999); inp.value = n; onCommit(n); });
  return h('div.ctl', h('div.ctl-top', h('span.ctl-l', 'Seed')), h('div.seed', inp, dice));
}

// Dual-thumb range with falloff band; d = {min,max,step,unit}
export function rangeRow(d, lo, hi, fall, { onInput, onCommit, accent }) {
  const fill = h('div.fill'), fa = h('div.fall'), fb = h('div.fall'), t0 = h('div.th'), t1 = h('div.th');
  const rg = h('div.range', h('div.tr'), fa, fb, fill, t0, t1);
  if (accent) rg.style.setProperty('--acc', accent);
  const T = (v) => clamp((v - d.min) / (d.max - d.min), 0, 1) * 100;
  const paint = () => {
    const a = T(lo), b = T(hi), f = (fall / (d.max - d.min)) * 100;
    fill.style.left = a + '%'; fill.style.width = Math.max(0, b - a) + '%';
    fa.style.left = Math.max(0, a - f) + '%'; fa.style.width = Math.min(a, f) + '%';
    fb.style.left = b + '%'; fb.style.width = Math.min(100 - b, f) + '%';
    t0.style.left = a + '%'; t1.style.left = b + '%';
  };
  paint();
  let which = -1;
  const val = (e) => { const r = rg.getBoundingClientRect(); const t = clamp((e.clientX - r.left) / r.width, 0, 1); const st = d.step || 0.01; return Math.round((d.min + t * (d.max - d.min)) / st) * st; };
  rg.addEventListener('pointerdown', (e) => {
    const v = val(e);
    which = Math.abs(v - lo) <= Math.abs(v - hi) ? 0 : 1;
    if (lo === hi) which = v < lo ? 0 : 1;
    rg.setPointerCapture(e.pointerId);
    move(e);
  });
  const move = (e) => {
    if (which < 0) return;
    const v = val(e);
    if (which === 0) lo = Math.min(v, hi); else hi = Math.max(v, lo);
    paint(); onInput?.(lo, hi);
  };
  rg.addEventListener('pointermove', move);
  rg.addEventListener('pointerup', () => { if (which >= 0) { which = -1; onCommit?.(lo, hi); } });
  rg.set = (a, b, f) => { lo = a; hi = b; fall = f; paint(); };
  return rg;
}
