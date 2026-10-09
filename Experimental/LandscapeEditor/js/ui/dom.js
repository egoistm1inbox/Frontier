// Tiny DOM helpers. Text is always set with textContent, so layer names and file contents cannot inject markup.
// The only innerHTML use is for the static SVG icons in icons.js.

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'icon') node.innerHTML = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'draggable') node[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function fmt(value, digits = 2) {
  const v = Number(value);
  if (!Number.isFinite(v)) return '–';
  return v.toFixed(digits);
}

export function fmtInt(value) {
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// Metres with a thousands separator, or kilometres above 10 km.
export function fmtMetres(m) {
  if (!Number.isFinite(m)) return '–';
  if (Math.abs(m) >= 10000) return (m / 1000).toFixed(1) + ' km';
  return Math.round(m).toLocaleString('en-US') + ' m';
}

// Volumes in cubic metres, shown in millions or billions for readability.
export function fmtVolume(m3) {
  if (!Number.isFinite(m3)) return '–';
  const a = Math.abs(m3);
  if (a >= 1e9) return (m3 / 1e9).toFixed(2) + ' km³';
  if (a >= 1e6) return (m3 / 1e6).toFixed(1) + ' M m³';
  if (a >= 1e3) return (m3 / 1e3).toFixed(0) + ' k m³';
  return Math.round(m3) + ' m³';
}

export function fmtMs(ms) {
  if (!Number.isFinite(ms)) return '–';
  return ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(2) + ' s';
}

export function percentText(v) {
  return Math.round(v * 100) + '%';
}
