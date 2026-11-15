// Small stroke glyphs for chrome (tabs, toolbar, playback). Asset-like icons (primitives, materials, impact) come
// from Icons/, the native Project Zero set.
const s = (body, fill = false) => `<svg viewBox="0 0 24 24" ${fill ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"'} aria-hidden="true">${body}</svg>`;

export const GLYPHS = {
  close: s('<path d="M6 6l12 12M18 6 6 18"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>'),
  sliders: s('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  check: s('<path d="m6 12.5 4 4 8-9"/>'),
  triangle: s('<path d="M12 5 20 19H4Z"/>'),
  search: s('<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>'),
  filter: s('<path d="M4 7h16M7 12h10M10 17h4"/>'),
  chevron: s('<path d="m7 10 5 5 5-5"/>'),
  'chevron-right': s('<path d="m10 7 5 5-5 5"/>'),
  pencil: s('<path d="M5 19l1-4L16 5l3 3L9 18Z"/><path d="m14 7 3 3"/>'),
  flask: s('<path d="M10 4h4M10.5 4v6L5 19a1 1 0 0 0 .9 1.5h12.2A1 1 0 0 0 19 19l-5.5-9V4"/><path d="M7.5 15h9"/>'),
  play: s('<path d="M8 5.5v13a.6.6 0 0 0 .9.5l10.2-6.5a.6.6 0 0 0 0-1L8.9 5a.6.6 0 0 0-.9.5Z"/>', true),
  pause: s('<rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/>', true),
  frame: s('<path d="M4 9V5h4M16 5h4v4M20 15v4h-4M8 19H4v-4"/><rect x="9" y="9" width="6" height="6" rx="1"/>'),
  sphere: s('<circle cx="12" cy="12" r="7.5"/><path d="M4.5 12c2.5 2 12.5 2 15 0"/><path d="M12 4.5c-2 2.5-2 12.5 0 15" opacity=".5"/>'),
  wire: s('<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9Z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>'),
  dots: s('<circle cx="6" cy="8" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="18" cy="15" r="1.6"/><circle cx="9" cy="17" r="1.6"/><path d="M7.5 8.5 13.5 6M16 7.5l1.5 6M16.5 15.5l-6 1.5" opacity=".55"/>'),
  grid: s('<path d="M4 9h16M4 15h16M9 4v16M15 4v16"/>'),
  'skip-start': s('<path d="M7 6v12"/><path d="M18 6.5v11a.5.5 0 0 1-.8.4L10 12.4a.5.5 0 0 1 0-.8l7.2-5.5a.5.5 0 0 1 .8.4Z" fill="currentColor"/>'),
  'skip-end': s('<path d="M17 6v12"/><path d="M6 6.5v11a.5.5 0 0 0 .8.4l7.2-5.5a.5.5 0 0 0 0-.8L6.8 6.1a.5.5 0 0 0-.8.4Z" fill="currentColor"/>'),
  loop: s('<path d="M17 4l3 3-3 3"/><path d="M20 7H9a5 5 0 0 0-5 5"/><path d="M7 20l-3-3 3-3"/><path d="M4 17h11a5 5 0 0 0 5-5"/>'),
  dice: s('<rect x="4.5" y="4.5" width="15" height="15" rx="3.5"/><circle cx="9" cy="9" r="1.1" fill="currentColor"/><circle cx="15" cy="15" r="1.1" fill="currentColor"/><circle cx="15" cy="9" r="1.1" fill="currentColor"/><circle cx="9" cy="15" r="1.1" fill="currentColor"/>'),
  'arrow-ne': s('<path d="M8 16 16 8M9 8h7v7"/>'),
  reset: s('<path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M5 4v4h4"/>'),
  eye: s('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>'),
  'eye-off': s('<path d="M4 4l16 16"/><path d="M9.6 6A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.7M6.4 7.6A17 17 0 0 0 2.5 12s3.5 6.5 9.5 6.5a9 9 0 0 0 3.6-.7"/>'),
  target: s('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  hold: s('<rect x="6" y="10" width="12" height="9" rx="2"/><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"/>'),
  release: s('<rect x="6" y="10" width="12" height="9" rx="2"/><path d="M8.5 10V7.5a3.5 3.5 0 0 1 6.8-1.2"/>'),
};

// Fill every [data-glyph] (replace contents) and [data-glyph-before] (prepend) under root.
export function hydrateGlyphs(root = document) {
  for (const el of root.querySelectorAll('[data-glyph]')) { const g = GLYPHS[el.dataset.glyph]; if (g) el.innerHTML = g; }
  for (const el of root.querySelectorAll('[data-glyph-before]')) { const g = GLYPHS[el.dataset.glyphBefore]; if (g && !el.querySelector(':scope > svg.lead')) el.insertAdjacentHTML('afterbegin', g.replace('<svg', '<svg class="lead"')); }
}
export const glyph = (name, cls = '') => (GLYPHS[name] || '').replace('<svg', `<svg class="${cls}"`);
