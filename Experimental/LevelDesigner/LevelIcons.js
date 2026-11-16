// Level Designer glyphs. Uses the shared studio set (Shared/Studio/Icons.js) and adds the few a level needs — the
// select arrow, move cross, turn ring, sun, sky, floor, walls, turntable, light strip and lobby pieces — drawn on the
// same 24 px grid with the same 1.6 stroke so they sit next to the Component Viewer icons without standing out.
import { icon as studioIcon } from '../Shared/Studio/Icons.js';

const P = {
  cursor: '<path d="M5.5 3.5 18 11.2l-5.6 1.3-2.9 5.4z"/><path d="m12.6 12.8 4 5.7"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="m9 5.8 3-2.8 3 2.8M9 18.2l3 2.8 3-2.8M5.8 9 3 12l2.8 3M18.2 9 21 12l-2.8 3"/>',
  turn: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.8 3.8v3.6h-3.6"/><circle cx="12" cy="12" r="1.5"/>',
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  sky: '<path d="M3 17.5a9 9 0 0 1 18 0"/><path d="M3 17.5h18"/><path d="M8.2 13.6c.4-1.6 1.8-2.6 3.3-2.6 1.4 0 2.6.8 3.1 2.1 1.4 0 2.4 1 2.4 2.2" opacity=".7"/>',
  floor: '<path d="M2.8 16.5 8 8.5h8l5.2 8z"/><path d="M8.6 12.5h6.8M12 8.5v8" opacity=".55"/>',
  wall: '<path d="M3.5 19.5h17"/><path d="M5 19.5c0-3 1-4.6 3-4.6V5.5h10.5v14"/>',
  turntable: '<ellipse cx="12" cy="15" rx="8.5" ry="3"/><path d="M3.5 15v1.6c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3V15"/><path d="M8.5 8.5a4.6 4.6 0 0 1 7.4-1.6"/><path d="m16.4 4.6-.4 2.5-2.4-.6"/>',
  strip: '<path d="M4 20V10a8 8 0 0 1 16 0v10"/><path d="M8 20v-9.5a4 4 0 0 1 8 0V20" opacity=".55"/>',
  plinth: '<ellipse cx="12" cy="9" rx="7" ry="2.6"/><path d="M5 9v6.4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V9"/>',
  panel: '<path d="M7 20.5 9 3.5h7.5l-2 17z"/><path d="M14.5 20.5 16.5 3.5"/>',
  arch: '<path d="M4.5 20.5v-9a7.5 7.5 0 0 1 15 0v9"/><path d="M8.5 20.5v-9a3.5 3.5 0 0 1 7 0v9"/>',
  premium: '<path d="M4 8.5 8.2 12 12 5.5l3.8 6.5L20 8.5l-1.6 9H5.6z"/><path d="M6 20h12"/>',
  exit: '<path d="M14 4.5h4.5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H14"/><path d="M10 8 5.5 12l4.5 4M5.5 12H15"/>',
  save: '<path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  magnet: '<path d="M6 4v8a6 6 0 0 0 12 0V4"/><path d="M6 8h3M15 8h3M9 4v8a3 3 0 0 0 6 0V4"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.2-1.5-1.2-2.6 0-.9.7-1.5 1.7-1.5h2.2a4 4 0 0 0 4-4c0-4-3.8-7.2-8.5-7.2z"/><circle cx="7.6" cy="11.4" r="1.1"/><circle cx="10.4" cy="7.4" r="1.1"/><circle cx="15" cy="7.8" r="1.1"/>',
  // scene pieces
  tree: '<path d="M12 21v-6"/><path d="M12 3.5c-3.3 0-5.6 2.6-5.6 5.6 0 .7.1 1.3.4 1.9A3.6 3.6 0 0 0 8.4 17h7.2a3.6 3.6 0 0 0 1.6-6c.3-.6.4-1.2.4-1.9 0-3-2.3-5.6-5.6-5.6z"/><path d="M8.5 21h7"/>',
  plant: '<path d="M7.5 15h9l-1.2 5.5H8.7z"/><path d="M12 15V9.5M12 11c-2.6 0-4.4-1.6-4.6-4.6 2.8 0 4.6 1.6 4.6 4.6zM12 9.5c0-3 1.9-5 5-5 0 3-2 5-5 5z"/>',
  hedge: '<path d="M3.5 18.5V12c0-2.4 1.6-3.5 3.3-3.5.6-1.5 1.9-2.5 3.6-2.5s2.9.9 3.5 2.2c.4-.2.9-.2 1.3-.2 2.4 0 5.3 1.4 5.3 4.3v6.2z"/><path d="M2.5 18.5h19"/>',
  rock: '<path d="M3.5 18.5 6 11l4.4-4 5.2 1.6 3.6 5.2.8 4.7z"/><path d="m10.4 7 1.6 5.4-3.7 6M12 12.4l5 1.2"/>',
  grass: '<path d="M4 20c0-3 1-5.5 2.6-7M8 20c0-4.6 1-8.2 3-11M12.5 20c0-4-.5-7.3-1.8-10M15 20c.5-3.5 2-6.4 4.5-8.4M18.5 20c0-1.8.4-3.4 1.4-4.6"/><path d="M3 20.5h18"/>',
  glass: '<path d="M4.5 3.5h15v17h-15z"/><path d="M12 3.5v17M7 8.5l3-3M14.5 11l3-3M7 13.5l2-2"/>',
  column: '<path d="M7 4h10M7 20h10M8 4v1.5h8V4M8 20v-1.5h8V20"/><path d="M9.5 5.5v13M12 5.5v13M14.5 5.5v13"/>',
  stairs: '<path d="M3.5 20.5h17v-17h-4v4h-4v4h-4v4h-5z"/>',
  garage: '<path d="M3 20.5V9.2L12 4l9 5.2v11.3"/><path d="M6.5 20.5v-8h11v8M6.5 15h11M6.5 17.8h11"/>',
  tyre: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r="1"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6"/>',
  toolbox: '<path d="M3.5 9.5h17v10h-17z"/><path d="M9 9.5V6.5h6v3M3.5 13.5h17M10.5 13.5v2h3v-2"/>',
  bench: '<path d="M3 10.5h18v3H3z"/><path d="M5.5 13.5v6M18.5 13.5v6M4 7h16M8 7v3.5M16 7v3.5"/>',
  lift: '<path d="M5 20.5V3.5M19 20.5V3.5M3 20.5h4M17 20.5h4"/><path d="M5 11h14M8 11v-2h8v2M7 8.5l1.5-3h7l1.5 3"/>',
  drum: '<ellipse cx="12" cy="5.5" rx="6" ry="2"/><path d="M6 5.5v13c0 1.1 2.7 2 6 2s6-.9 6-2v-13M6 10c0 1.1 2.7 2 6 2s6-.9 6-2M6 14.5c0 1.1 2.7 2 6 2s6-.9 6-2"/>',
  cone: '<path d="M10.2 4h3.6l4.4 15H5.8z"/><path d="M4 19.5h16M8.6 10.5h6.8M7.4 14.8h9.2"/>',
  chair: '<path d="M7 3.5h10l-.8 7.5H7.8z"/><path d="M6 11h12v3H6zM7.5 14v6.5M16.5 14v6.5"/>',
  sofa: '<path d="M5 10V7.5A2 2 0 0 1 7 5.5h10a2 2 0 0 1 2 2V10"/><path d="M3 11.5a1.5 1.5 0 0 1 3 0V14h12v-2.5a1.5 1.5 0 0 1 3 0V17H3zM5 17v2M19 17v2"/>',
  table: '<path d="M3 8.5h18v2.5H3z"/><path d="M5 11v9M19 11v9M8 11v3.5h8V11"/>',
  desk: '<path d="M2.5 7.5h19v2.5h-19z"/><path d="M4 10v10.5M14 10v10.5h6V10M14 14h6M14 17.3h6"/>',
  stool: '<ellipse cx="12" cy="6" rx="5.5" ry="1.8"/><path d="M8 7.5 6 20.5M16 7.5l2 13M12 7.8v12.7M7.2 14.5h9.6"/>',
  rug: '<path d="M5 6.5h14v11H5z"/><path d="M8 9.5h8v5H8zM3.5 7v10M20.5 7v10" opacity=".8"/>',
  banner: '<path d="M5 20.5V3.5M19 20.5V3.5"/><path d="M5 5h14v10l-7-2.6L5 15z"/>',
  // light fixtures
  softbox: '<path d="M4 4h10v8H4z"/><path d="M14 5.5 17.5 8 14 10.5M9 12v8.5M5 20.5h8M7 16h4"/>',
  stripbox: '<path d="M9 3h5v11H9z"/><path d="M11.5 14v6.5M8 20.5h7"/><path d="M15.5 5.5h2M15.5 8.5h3M15.5 11.5h2" opacity=".6"/>',
  overhead: '<path d="M3 5h18v4H3z"/><path d="M6 3v2M18 3v2"/><path d="M5 11.5l-1.5 3M12 11.5v3M19 11.5l1.5 3" opacity=".6"/><path d="M3 20.5h18"/>',
  fresnel: '<path d="M5 7.5h8v8H5z"/><circle cx="13" cy="11.5" r="2.6"/><path d="M15.5 7.5 19 5M15.5 15.5 19 18M9 15.5v5M6 20.5h6"/>',
  track: '<path d="M3 4h18"/><path d="M7 4v3M12 4v3M17 4v3"/><path d="m5.5 7 3 0-1 4.5h-1zM10.5 7h3l-.6 4.5h-1.8zM15.5 7h3l-1 4.5h-1z"/><path d="M7 14l-1 3M12 14v3M17 14l1 3" opacity=".55"/>',
  pendant: '<path d="M12 2.5v6"/><path d="M5.5 15a6.5 6.5 0 0 1 13 0z"/><path d="M10.5 17.5a1.5 1.5 0 0 0 3 0"/><path d="M12 20.5v1" opacity=".55"/>',
  battens: '<path d="M3 5h7v2.5H3zM14 5h7v2.5h-7zM3 11h7v2.5H3zM14 11h7v2.5h-7z"/><path d="M3 20.5h18"/>',
  halo: '<ellipse cx="12" cy="8" rx="8.5" ry="3"/><path d="M8 2.5 9.2 5.2M16 2.5l-1.2 2.7"/><path d="M6 14.5l-1.5 3M12 14.5v3M18 14.5l1.5 3" opacity=".55"/><path d="M3 20.5h18"/>',
  washer: '<path d="M7 16.5h10l-1 4H8z"/><path d="M12 13.5V9M8.5 13.5 5 7M15.5 13.5 19 7" opacity=".6"/><path d="M3 20.5h18"/>',
  sliders: '<path d="M5 6h9M18 6h1M5 12h3M12 12h7M5 18h11M20 18h-1"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
};

export function icon(name, size = 16) {
  if (!P[name]) return studioIcon(name, size);
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`;
}

export function hydrate(root = document) {
  for (const node of root.querySelectorAll('[data-icon]')) {
    if (node.dataset.iconDone) continue;
    node.insertAdjacentHTML('afterbegin', icon(node.dataset.icon, +(node.dataset.iconSize || 16)));
    node.dataset.iconDone = '1';
  }
}

export function iconEl(name, size = 16, cls = '') {
  const s = document.createElement('span');
  s.className = `ico ${cls}`.trim();
  s.innerHTML = icon(name, size);
  return s;
}
