/**
 * Frontier Landscape Studio — inspector primitives.
 *
 * These mirror the reference editor's card / metric / slider API so the
 * landscape tools are drawn with exactly the same components the rest of the
 * product uses, rather than a second design.
 */

import React from 'react';

export const num = (value, digits = 0) => {
  const n = Number(value);
  if (!isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

const digitsFor = (step) => {
  if (!step || step >= 1) return 0;
  const s = String(step);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : Math.min(4, s.length - dot - 1);
};

/** A Frontier card: accent icon, heading, optional OFF state, fieldset body. */
export function Card({ title, icon: Icon, accent, on = true, children, className = '', caption = null }) {
  return (
    <section
      className={`card ${className} ${on ? '' : 'feature-disabled'}`}
      style={{ '--card-icon': accent }}
    >
      <div className="card-heading">
        <span>{Icon ? <Icon size={16} /> : null}{title}</span>
        {!on ? <span className="card-off-label">OFF</span> : caption}
      </div>
      <fieldset className="card-body" disabled={!on}>{children}</fieldset>
    </section>
  );
}

export function Metric({ value, unit, digits = 0, className = '' }) {
  return (
    <div className={`metric ${className}`}>
      <span>{num(value, digits)}</span>
      {unit ? <small>{unit}</small> : null}
    </div>
  );
}

/** Slider with the live value on the right, exactly like the reference cards. */
export function Slider({
  label, value, min, max, step = 1, unit = '', onChange, hint, disabled, digits,
}) {
  const d = digits === undefined ? digitsFor(step) : digits;
  const progress = max === min ? 0 : ((Number(value) - min) / (max - min)) * 100;
  return (
    <div className="slider-row">
      <label>
        <span>{label}</span>
        <strong>{num(value, d)}{unit ? <small>{unit}</small> : null}</strong>
      </label>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={Number(value)}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ '--progress': `${Math.max(0, Math.min(100, progress))}%` }}
      />
      {hint ? <em>{hint}</em> : null}
    </div>
  );
}

export function RangeLabels({ left, right }) {
  return (
    <div className="range-labels">
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}

export function Select({ label, value, options, onChange, note, disabled }) {
  return (
    <div className="select-block">
      <span>{label}{note ? <em>{note}</em> : null}</span>
      <select
        className="frontier-select"
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          const option = options.find((o) => String(o.value) === raw);
          onChange(option ? option.value : raw);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export function Toggle({ label, value, onChange, hint, disabled }) {
  return (
    <div className="toggle-row">
      <span>{label}{hint ? <small>{hint}</small> : null}</span>
      <button
        type="button"
        className={`toggle ${value ? 'on' : ''}`}
        role="switch"
        aria-checked={!!value}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!value)}
      >
        <span />
      </button>
    </div>
  );
}

export function ColorField({ label, value, onChange }) {
  return (
    <div className="slider-row">
      <label>
        <span>{label}</span>
        <strong style={{ fontSize: 10, letterSpacing: '.4px' }}>{String(value).toUpperCase()}</strong>
      </label>
      <div className="color-field">
        <input type="color" aria-label={label} value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#808080'} onChange={(e) => onChange(e.target.value)} />
        <code>{label}</code>
      </div>
    </div>
  );
}

export function SeedField({ label = 'Seed', value, onChange, onRandomize }) {
  return (
    <div className="slider-row">
      <label>
        <span>{label}</span>
        <strong>{value}</strong>
      </label>
      <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
        <input
          className="frontier-input"
          type="number"
          min={1}
          max={999999}
          aria-label={label}
          value={value}
          onChange={(e) => onChange(Math.max(1, Math.min(999999, parseInt(e.target.value || '1', 10))))}
        />
        {onRandomize ? (
          <button className="frontier-button" type="button" onClick={onRandomize} style={{ flexShrink: 0 }}>
            Shuffle
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ControlBlock({ title, icon: Icon, note, children }) {
  return (
    <div className="control-block">
      {title ? <h4>{Icon ? <Icon size={12} /> : null}{title}{note ? <span>{note}</span> : null}</h4> : null}
      {children}
    </div>
  );
}

export function StatGrid({ items }) {
  return (
    <dl className="stat-grid">
      {items.map(([label, value, unit]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}{unit ? <small>{unit}</small> : null}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionLabel({ left, right }) {
  return (
    <div className="section-label">
      <span>{left}</span>
      {right ? <span>{right}</span> : null}
    </div>
  );
}

export function Note({ children }) {
  return <p className="note">{children}</p>;
}

export function Warning({ icon: Icon, children }) {
  return (
    <div className="warning-strip">
      {Icon ? <Icon size={13} /> : null}
      <span>{children}</span>
    </div>
  );
}

/** Frontier's property switch row: ON/OFF chips above the cards. */
export function PropertySwitch({ label, icon: Icon, on, onClick }) {
  return (
    <button
      type="button"
      className={`property-switch ${on ? 'is-on' : 'is-off'}`}
      aria-pressed={on}
      aria-label={`Toggle ${label}`}
      onClick={onClick}
    >
      <span className="switch-icon">{Icon ? <Icon size={17} strokeWidth={1.7} /> : null}</span>
      <span className="switch-name">{label}</span>
      <span className="switch-state">{on ? 'ON' : 'OFF'}</span>
    </button>
  );
}
