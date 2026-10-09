import React from 'react';

// Stroke glyphs for buttons. Colour-coded layer icons live in public/icons instead.
const PATHS = {
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  chevron: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  up: 'M6 15l6-6 6 6',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm4.8 11.2L20 20',
  eye: 'M2 12c2.6-4.6 6-7 10-7s7.4 2.4 10 7c-2.6 4.6-6 7-10 7S4.6 16.6 2 12Zm10 3.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  filter: 'M4 6h16M7 12h10M10 18h4',
  play: 'M8 5.5v13l10-6.5Z',
  stop: 'M7 7h10v10H7z',
  reset: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4.5h4.5',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  upload: 'M12 16V4m0 0-5 5m5-5 5 5M4 16v4h16v-4',
  download: 'M12 4v12m0 0-5-5m5 5 5-5M4 20h16',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 9h.01',
  duplicate: 'M9 9h10v10H9zM5 15V5h10',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  dice: 'M5 5h14v14H5zM9 9h.01M15 15h.01M12 12h.01M9 15h.01M15 9h.01',
  focus: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  wire: 'M4 6h16v12H4zM4 12h16M12 6v12M8 6l4 6-4 6M16 6l-4 6 4 6',
  water: 'M3 15c2.5-2 4-2 6 0s3.5 2 6 0 3.5-2 6 0M3 19c2.5-2 4-2 6 0s3.5 2 6 0 3.5-2 6 0M8 11V4l4 4 4-4v7',
  sun: 'M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8',
  layers: 'M12 4 3 9l9 5 9-5-9-5Zm-9 9 9 5 9-5m-18 4 9 5 9-5',
  landscape: 'M2 19 9 9l4 5 3-3 6 8Z',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  open: 'M3 7h6l2 2h10v10H3zM3 7V5h6l2 2',
  sliders: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6',
};

export default function Glyph({ name, size = 16, className = '', title }) {
  const d = PATHS[name] ?? PATHS.plus;
  return (
    <svg
      className={'glyph ' + className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={d} />
    </svg>
  );
}
