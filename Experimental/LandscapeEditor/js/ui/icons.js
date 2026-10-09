// Inline SVG glyphs in the 24-unit stroke style used by the Frontier editors. Static strings only.
const svg = (body) =>
  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  noise: svg('<path d="M2 19c2-5 4-8 7-6s4 6 6 1 3-7 7-4"/>'),
  ridged: svg('<path d="M2 19 8 6l3 6 3-7 8 14z"/>'),
  island: svg('<circle cx="12" cy="12" r="8.5"/><path d="M5 12c2-2 4 2 7 0s5-2 7 0"/>'),
  base: svg('<path d="M3 14h18M3 18h18"/><path d="M3 10h18" stroke-dasharray="2 3"/>'),
  ramp: svg('<path d="M3 19 21 7"/><path d="M3 19h18"/>'),
  erosion: svg('<path d="M12 3c0 0-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z"/>'),
  terrace: svg('<path d="M3 18h6v-4h6v-4h6V6"/>'),
  smooth: svg('<path d="M3 12c3-6 6-6 9 0s6 6 9 0"/>'),
  levels: svg('<path d="M5 20V12M10 20V6M15 20v-9M20 20V4"/>'),
  satmap: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>'),
  terrain: svg('<path d="M2 20 9 9l4 6 3-4 6 9z"/><circle cx="18" cy="5" r="2"/>'),
  eye: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  duplicate: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'),
  open: svg('<path d="M3 7h6l2 2h10v10H3z"/>'),
  save: svg('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/>'),
  dice: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><circle cx="16" cy="16" r="1"/><circle cx="12" cy="12" r="1"/>'),
  grip: svg('<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>'),
};

export const GROUP_ICON = {
  primitive: 'noise',
  shape: 'island',
  generator: 'ridged',
  erosion: 'erosion',
  shaping: 'terrace',
  texture: 'satmap',
};
