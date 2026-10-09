// Inspector building blocks: pill sliders with a numeric field, dropdowns, switches, cards and stat tiles.
// Styling follows the ProjectZero editor (the same class names as Experimental/ParticleEditor).
import { el, fmt } from './dom.js';
import { clamp } from '../core/rng.js';

// A range control. `onInput` runs while dragging (live preview), `onChange` runs on release (commit).
export function rangeRow(spec, value, handlers) {
  const digits = spec.digits ?? 2;
  const range = el('input', { type: 'range', min: spec.min, max: spec.max, step: spec.step, value, 'aria-label': spec.label });
  const num = el('input', { type: 'number', class: 'num', min: spec.min, max: spec.max, step: spec.step, value: fmt(value, digits), 'aria-label': spec.label + ' value' });
  const fill = () => {
    const span = spec.max - spec.min || 1;
    range.style.setProperty('--fill', ((+range.value - spec.min) / span) * 100 + '%');
  };
  fill();
  range.addEventListener('input', () => {
    const v = +range.value;
    num.value = fmt(v, digits);
    fill();
    handlers.onInput?.(v);
  });
  range.addEventListener('change', () => handlers.onChange?.(+range.value));
  num.addEventListener('change', () => {
    const typed = +num.value;
    if (!Number.isFinite(typed)) {
      num.value = fmt(+range.value, digits);
      return;
    }
    const v = clamp(typed, spec.min, spec.max);
    range.value = v;
    num.value = fmt(v, digits);
    fill();
    handlers.onInput?.(v);
    handlers.onChange?.(v);
  });
  const help = spec.help ? { title: spec.help } : {};
  return el('label', { class: 'row', ...help },
    el('span', { class: 'row-k', text: spec.label }),
    range,
    num,
    el('em', { class: 'unit', text: spec.unit || '' }),
  );
}

export function selectRow(spec, value, onChange) {
  const select = el('select', { 'aria-label': spec.label });
  for (const [v, label] of spec.options) {
    select.append(el('option', { value: String(v), text: label, selected: String(v) === String(value) }));
  }
  select.value = String(value);
  select.addEventListener('change', () => {
    const raw = select.value;
    const original = spec.options.find(([v]) => String(v) === raw);
    onChange(original ? original[0] : raw);
  });
  return el('label', { class: 'row select-row', ...(spec.help ? { title: spec.help } : {}) }, el('span', { class: 'row-k', text: spec.label }), select);
}

export function checkRow(label, checked, onChange) {
  const box = el('input', { type: 'checkbox', checked, 'aria-label': label });
  box.addEventListener('change', () => onChange(box.checked));
  return el('label', { class: 'row check' }, el('span', { class: 'row-k', text: label }), box);
}

export function card(title, kicker, ...body) {
  return el('section', { class: 'pcard' },
    el('header', { class: 'pcard-h' }, el('h3', { text: title }), kicker ? el('span', { class: 'kicker', text: kicker }) : null),
    el('div', { class: 'pcard-b' }, ...body),
  );
}

export function statTile(label, value, key) {
  return el('div', { class: 'stat' },
    el('span', { class: 'stat-k', text: label }),
    el('span', { class: 'stat-v', ...(key ? { 'data-stat': key } : {}), text: value }),
  );
}

export function note(text) {
  return el('p', { class: 'note', text });
}

export function button(label, opts = {}) {
  return el('button', {
    type: 'button',
    class: 'btn ' + (opts.cls || ''),
    onClick: opts.onClick,
    title: opts.title,
    disabled: opts.disabled,
    'aria-label': opts.aria || label,
    icon: opts.icon || undefined,
  }, label ? el('span', { text: label }) : null);
}
