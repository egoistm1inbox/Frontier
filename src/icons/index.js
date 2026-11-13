import { uvIcons } from './uv-editor.js';
import { forcefieldIcons } from './forcefields.js';
import { vectorFieldIcons } from './vector-fields.js';
import { modellingIcons } from './modelling.js';

export const CATEGORIES = [
  { id: 'all', name: 'All Categories', count: 62, icon: 'layers' },
  { id: 'UV Editor', name: 'UV Editor', count: uvIcons.length, icon: 'grid', color: 'text-amber-400', border: 'border-amber-500/40' },
  { id: 'Forcefield', name: 'Forcefield', count: forcefieldIcons.length, icon: 'wind', color: 'text-sky-400', border: 'border-sky-500/40' },
  { id: 'Vector Fields', name: 'Vector Fields', count: vectorFieldIcons.length, icon: 'compass', color: 'text-emerald-400', border: 'border-emerald-500/40' },
  { id: 'Modelling', name: 'Modelling', count: modellingIcons.length, icon: 'box', color: 'text-orange-400', border: 'border-orange-500/40' },
];

export const ALL_ICONS = [
  ...uvIcons,
  ...forcefieldIcons,
  ...vectorFieldIcons,
  ...modellingIcons
];

export function getIconById(id) {
  return ALL_ICONS.find(icon => icon.id === id);
}

export function searchIcons(query, category = 'all') {
  let list = ALL_ICONS;
  if (category && category !== 'all') {
    list = list.filter(icon => icon.category === category);
  }
  if (!query || query.trim() === '') {
    return list;
  }
  const q = query.toLowerCase().trim();
  return list.filter(icon => {
    return (
      icon.name.toLowerCase().includes(q) ||
      icon.category.toLowerCase().includes(q) ||
      icon.description.toLowerCase().includes(q) ||
      icon.tags.some(t => t.toLowerCase().includes(q)) ||
      Object.values(icon.hotkeys || {}).some(h => h.toLowerCase().includes(q))
    );
  });
}
