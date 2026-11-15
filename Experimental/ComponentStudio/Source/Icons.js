// Icons for the Component Studio. Same rules as Experimental/StudioIconSet (24 × 24 grid, 2 px margin, 1.5 px round
// strokes, a neutral `main` layer and one `accent` layer in the family colour). Shared tools are imported straight from
// the Studio Icon Set definitions; studio-specific glyphs (components, compile steps) are added here in the same style.
import { ICONS as STUDIO_ICONS } from './IconDefinitions.js';

const dot = (x, y, r = 1.5) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;
const ring = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}"/>`;
const p = (d, extra = '') => `<path d="${d}"${extra ? ' ' + extra : ''}/>`;
const dashed = (d) => p(d, 'stroke-dasharray="2 2.6"');
const rect = (x, y, w, h, r = 1.5) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;

const studio = Object.fromEntries(STUDIO_ICONS.map((i) => [i.id, { main: i.main, accent: i.accent }]));

export const COLOURS = {
  amber: '#ffb238', blue: '#4d9bff', green: '#46d267', orange: '#ff8a4c', violet: '#b58cff', teal: '#38d1c4', rose: '#ff6b8b', grey: '#9a9a9a',
};

const OWN = {
  root: { main: ring(12, 12, 7.5), accent: dot(12, 12, 2.2) },
  mesh: { main: p('M12 3l8 4.5v9L12 21l-8-4.5v-9z') + p('M4 7.5l8 4.5 8-4.5M12 12v9'), accent: dot(12, 12, 1.6) },
  wheel: { main: ring(12, 12, 8.5), accent: ring(12, 12, 3.2) + p('M12 3.5v5.3M12 15.2v5.3M3.5 12h5.3M15.2 12h5.3') },
  tyre: { main: ring(12, 12, 8.5) + ring(12, 12, 5), accent: p('M12 3.5v1.6M12 18.9v1.6M3.5 12h1.6M18.9 12h1.6M6 6l1.1 1.1M16.9 16.9L18 18M6 18l1.1-1.1M16.9 7.1L18 6') },
  rim: { main: ring(12, 12, 6.5), accent: dot(12, 12, 1.6) + p('M12 6.5V10M12 14v3.5M6.5 12H10M14 12h3.5') },
  body: { main: p('M3 15.5V13l2.5-4.5h9L18 12l3 1v2.5z'), accent: ring(7.5, 16, 1.8) + ring(16.5, 16, 1.8) },
  vehicle: { main: p('M3 15.5V13l2.5-4.5h9L18 12l3 1v2.5z') + p('M7 8.5L8 12h8'), accent: ring(7.5, 16, 1.8) + ring(16.5, 16, 1.8) },
  camera: { main: p('M3.5 8h11v9h-11z'), accent: p('M14.5 11l6-3v9l-6-3') },
  light: { main: p('M8.5 14.5a6 6 0 1 1 7 0c-.7.6-1 1.5-1 2.5h-5c0-1-.3-1.9-1-2.5zM10 20.5h4'), accent: p('M12 7v4') },
  sensor: { main: ring(12, 14, 2) + p('M7.5 9.5a6.5 6.5 0 0 1 9 0M4.8 6.8a10.3 10.3 0 0 1 14.4 0'), accent: dot(12, 14, 1.2) + p('M12 16v4.5') },
  ballast: { main: p('M5.5 9h13l2 11h-17z'), accent: ring(12, 6, 2.5) },
  aero: { main: p('M3 10c5-3 13-3 18 0l-1 2.5c-5-2-11-2-16 0z'), accent: p('M8 12.5v6M16 12.5v6') },
  movement: { main: rect(3.5, 5.5, 17, 13, 2.5), accent: p('M7 15l3-4 3 2.5 4-5') },
  plus: { main: p('M12 5v14M5 12h14'), accent: '' },
  check: { main: p('M5 12.5l4.5 4.5L19 7.5'), accent: '' },
  close: { main: p('M6 6l12 12M18 6L6 18'), accent: '' },
  chevron: { main: p('M9 6l6 6-6 6'), accent: '' },
  caret: { main: p('M7 10l5 5 5-5'), accent: '' },
  play: { main: p('M7 4.5l12 7.5-12 7.5z'), accent: '' },
  stop: { main: rect(6, 6, 12, 12, 2), accent: '' },
  trash: { main: p('M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13'), accent: p('M10.5 10.5v6M13.5 10.5v6') },
  eye: { main: p('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z'), accent: ring(12, 12, 3) },
  eyeOff: { main: p('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z'), accent: p('M4 20L20 4') },
  source: { main: p('M6 3h8l4 4v14H6z') + p('M14 3v4h4'), accent: p('M9 13h6M9 16.5h4') },
  geometry: { main: p('M4 18L12 4l8 14z'), accent: dashed('M8 11h8') + dot(12, 4, 1.6) + dot(4, 18, 1.6) + dot(20, 18, 1.6) },
  uv: studio['uv-unwrap'] || { main: rect(3.5, 3.5, 17, 17), accent: '' },
  checker: studio['uv-checker'],
  sdf: { main: rect(3.5, 3.5, 17, 17, 2), accent: ring(12, 12, 3) + p('M12 6.2a5.8 5.8 0 1 1 0 11.6a5.8 5.8 0 1 1 0-11.6', 'stroke-dasharray="1.6 2"') },
  lod: studio['studio-cluster-lod'],
  icon: { main: rect(3.5, 3.5, 17, 17, 3.5), accent: p('M8 14.5l3-3 2 2 3-3') + dot(9, 8.5, 1.3) },
  meta: { main: p('M4 4h9l7 7-9 9-7-7z'), accent: dot(8.5, 8.5, 1.7) },
  import: studio['general-import'],
  export: studio['general-export'],
  search: studio['general-search'],
  frame: studio['general-frame'],
  grid: studio['general-grid'],
  settings: studio['general-settings'],
  visible: studio['general-visible'],
  lock: studio['general-lock'],
  duplicate: studio['general-duplicate'],
  undo: studio['general-undo'],
  move: studio['general-move'],
  rotate: studio['general-rotate'],
  scale: studio['general-scale'],
  pivot: studio['general-pivot'],
  curve: studio['particle-curve'],
  heat: studio['force-heatmap'],
  wire: { main: p('M12 3l9 16H3z'), accent: p('M12 3v16M7.5 11h9') },
  layers: { main: p('M12 3l9 4.5-9 4.5-9-4.5z') + p('M3 12l9 4.5 9-4.5'), accent: p('M3 16.5L12 21l9-4.5') },
  folder: { main: p('M3 6.5h6l2 2h10v10.5H3z'), accent: '' },
  load: { main: p('M12 4v16'), accent: p('M6 14l6 6 6-6') },
  com: { main: ring(12, 12, 7.5), accent: p('M12 4.5V12h7.5') + filled('M12 4.5A7.5 7.5 0 0 1 19.5 12H12z') },
  patch: { main: rect(5, 8, 14, 8, 3), accent: dot(9, 12, 1.2) + dot(12, 12, 1.2) + dot(15, 12, 1.2) },
  spring: { main: p('M12 3v3M12 18v3'), accent: p('M8 6h8l-8 3h8l-8 3h8l-8 3h8') },
  bounds: { main: dashed('M4 4h16v16H4z'), accent: dot(4, 4, 1.4) + dot(20, 20, 1.4) },
  slip: { main: p('M4 16h12'), accent: p('M6 18l12-10M14 7.5l4.5.5-.5 4.5') },
  warning: { main: p('M12 3.5l9.5 16.5h-19z'), accent: p('M12 9.5v5M12 17.2v.3') },
  compile: { main: p('M5 4.5h14v15H5z'), accent: p('M9 9l-2.5 3L9 15M15 9l2.5 3L15 15M13 8l-2 8') },
  dots: { main: dot(6, 12, 1.4) + dot(12, 12, 1.4) + dot(18, 12, 1.4), accent: '' },
  blueprint: { main: rect(3.5, 4, 17, 16, 2.5) + p('M3.5 8.5h17'), accent: rect(6.5, 11.5, 4, 5, 1) + p('M13 12.5h4.5M13 15.5h3') },
  sample: { main: p('M12 3c4 4.8 6.5 8 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 11 8 7.8 12 3z'), accent: p('M9 15a3 3 0 0 0 3 3') },
  download: { main: p('M4.5 15.5V19a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-3.5'), accent: p('M12 4v11M7.5 10.5L12 15l4.5-4.5') },
  help: { main: ring(12, 12, 8.5), accent: p('M9.5 9.5a2.6 2.6 0 1 1 3.8 2.3c-.8.4-1.3 1-1.3 2M12 16.8v.2') },
  reset: { main: p('M19.5 12a7.5 7.5 0 1 1-2.4-5.5M17.5 2.5v4.2h-4.2'), accent: '' },
  // Fracture Editor
  fracture: { main: p('M12 3l8 4.5v9L12 21l-8-4.5v-9z'), accent: p('M12 3l-1.5 6 3 2.5-2 4.5L12 21M10.5 9L4 7.5M13.5 11.5l6.5-4M11.5 16l-7.5.5') },
  impact: { main: ring(12, 12, 7.5), accent: ring(12, 12, 2.4) + p('M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4') },
  seeds: { main: p('M4 4h16v16H4z', 'stroke-dasharray="2 2.6"'), accent: dot(8, 9, 1.5) + dot(15.5, 7.5, 1.5) + dot(11, 15, 1.5) + dot(17, 16.5, 1.5) },
  explode: { main: p('M9 9L4.5 4.5M15 9l4.5-4.5M9 15l-4.5 4.5M15 15l4.5 4.5'), accent: rect(9.5, 9.5, 5, 5, 1) + p('M4.5 8V4.5H8M16 4.5h3.5V8M4.5 16v3.5H8M16 19.5h3.5V16') },
  assemble: { main: p('M4.5 4.5L9 9M19.5 4.5L15 9M4.5 19.5L9 15M19.5 19.5L15 15'), accent: rect(9, 9, 6, 6, 1) },
  cube: { main: p('M12 3l8 4.5v9L12 21l-8-4.5v-9z') + p('M4 7.5l8 4.5 8-4.5M12 12v9'), accent: '' },
  sphere: { main: ring(12, 12, 8.5), accent: '<ellipse cx="12" cy="12" rx="3.6" ry="8.5"/><ellipse cx="12" cy="12" rx="8.5" ry="3.2"/>' },
  cylinder: { main: '<ellipse cx="12" cy="6" rx="7" ry="2.6"/>' + p('M5 6v12c0 3.4 14 3.4 14 0V6'), accent: p('M5 18c0-3.4 14-3.4 14 0', 'stroke-dasharray="2 2.4"') },
  cone: { main: p('M5 18L12 3.5 19 18'), accent: '<ellipse cx="12" cy="18" rx="7" ry="2.6"/>' },
  pane: { main: p('M5 4.5h14v15H5z'), accent: p('M12 11l-4-4M12 11l5-2M12 11l-1 6M12 11l5 5') + dot(12, 11, 1.2) },
  beam: { main: p('M3 9.5l4-3h14l-4 3zM3 9.5h14v8H3zM17 9.5l4-3v8l-4 3'), accent: p('M7 13.5h6', 'stroke-dasharray="2 2"') },
  rock: { main: p('M4 15l2-6.5L11 4l6.5 2 3 6.5-2.5 6L11 20l-5-1.5z'), accent: p('M11 4l1 7-6 -2.5M12 11l6.5 1.5M12 11l-1 9') },
  material: { main: p('M9 3.5h6M10 3.5v5L5 18a2 2 0 0 0 1.8 2.5h10.4A2 2 0 0 0 19 18l-5-9.5v-5'), accent: p('M7.5 14h9') },
  quality: { main: p('M4 19L12 5l8 14z'), accent: p('M8 19l4-7 4 7M12 12V5') },
  receipt: { main: p('M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21z'), accent: p('M9 8h6M9 11.5h6M9 15h3.5') },
  bake: { main: rect(3.5, 6, 17, 13, 2.5), accent: p('M7 6V4M12 6V4M17 6V4') + p('M8 12.5h8M8 15.5h5') },
  dice: { main: rect(4, 4, 16, 16, 3), accent: dot(8.5, 8.5) + dot(15.5, 15.5) + dot(12, 12) + dot(15.5, 8.5) + dot(8.5, 15.5) },
  external: { main: p('M13 4.5h6.5V11M19.5 4.5L11 13'), accent: p('M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10') },
  // Material workspace
  finish: { main: ring(12, 12, 8), accent: p('M7.2 9.2a5.6 5.6 0 0 1 4-3') + dot(15, 15, 1.2) },
  field: { main: p('M12 3.5l3.5 2v4L12 11.5l-3.5-2v-4zM5.5 13.5l3.5 2v4L5.5 21.5 2 19.5v-4zM18.5 13.5l3.5 2v4l-3.5 2-3.5-2v-4z'), accent: dot(12, 7.5, 1.1) },
  mask: { main: rect(3.5, 3.5, 17, 17, 3), accent: p('M3.5 15.5c4-1 6-6 9-8s5-1 8 0', 'fill="currentColor" fill-opacity="0.25"') },
  transition: { main: ring(8.5, 12, 5.5), accent: ring(15.5, 12, 5.5) },
  link: { main: p('M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1'), accent: p('M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1') },
  clock: { main: ring(12, 12, 8.5), accent: p('M12 7.5V12l3 2') },
  swatch: { main: rect(4, 4, 7, 7, 2) + rect(13, 4, 7, 7, 2) + rect(4, 13, 7, 7, 2), accent: rect(13, 13, 7, 7, 2) },
  snapshot: { main: rect(3.5, 6.5, 17, 13, 2.5) + p('M8.5 6.5l1.5-2.5h4l1.5 2.5'), accent: ring(12, 13, 3.2) },
  budget: { main: rect(3, 8, 18, 8, 2.5), accent: p('M6 12h7') },
  lobes: { main: ring(12, 12, 8.5), accent: p('M12 3.5v17M5 7.5c4 2 10 2 14 0M5 16.5c4-2 10-2 14 0') },
};
function filled(d) { return p(d, 'fill="currentColor" stroke="none" fill-opacity="0.35"'); }

export function icon(name, { size = 16, accent = null, weight = 1.6 } = {}) {
  const def = OWN[name] || studio[name] || OWN.dots;
  const tone = accent || 'currentColor';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g>${def.main}</g>${def.accent ? `<g color="${tone}">${def.accent}</g>` : ''}</svg>`;
}

// Fills every [data-icon] element that is still empty. data-accent picks a family colour name or a hex value.
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((node) => {
    if (node.dataset.iconDone === node.dataset.icon) return;
    const size = +(node.dataset.size || 16);
    const accent = node.dataset.accent ? COLOURS[node.dataset.accent] || node.dataset.accent : null;
    node.innerHTML = icon(node.dataset.icon, { size, accent });
    node.dataset.iconDone = node.dataset.icon;
  });
}
