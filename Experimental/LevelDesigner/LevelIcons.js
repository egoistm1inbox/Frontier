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
