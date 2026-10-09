import React, { useEffect, useRef } from 'react';
import Glyph from './Glyph.jsx';
import { drawHeights, drawRgba } from './colour.js';

// Inspector building blocks. They reuse the Frontier property-card, field and slider classes.

export function Card({ title, glyph, children, wide = false, className = '', accent, aside }) {
  return (
    <section
      className={'property-card ' + (wide ? 'span-two ' : '') + className}
      style={accent ? { '--accent': accent } : undefined}
      data-card={title}
    >
      <h3>
        {glyph && <Glyph name={glyph} size={16} />}
        <span>{title}</span>
        {aside && <em className="lx-card-aside">{aside}</em>}
      </h3>
      {children}
    </section>
  );
}

// value is in stored units. scale converts for display (e.g. 100 shows percentages).
export function NumberControl({ label, value, min, max, step = 1, decimals = 0, unit = '', scale = 1, disabled = false, onChange }) {
  const dMin = min * scale;
  const dMax = max * scale;
  const dStep = step * scale;
  const raw = Number.isFinite(value) ? value * scale : dMin;
  const shown = Number(raw.toFixed(decimals));
  const fill = dMax > dMin ? ((raw - dMin) / (dMax - dMin)) * 100 : 0;
  const commit = (text) => {
    const parsed = parseFloat(text);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.min(dMax, Math.max(dMin, parsed));
    onChange(clamped / scale);
  };
  return (
    <label className="field">
      <span>{label}</span>
      <div className="slider-pill">
        <div className="split-value">
          <input
            aria-label={label + ' value'}
            type="number"
            min={dMin}
            max={dMax}
            step={dStep}
            disabled={disabled}
            value={shown}
            onChange={(event) => commit(event.target.value)}
          />
          <small>{unit}</small>
        </div>
        <input
          aria-label={label}
          type="range"
          min={dMin}
          max={dMax}
          step={dStep}
          value={raw}
          disabled={disabled}
          style={{ '--fill': `${fill}%` }}
          onChange={(event) => commit(event.target.value)}
        />
      </div>
    </label>
  );
}

export function SelectControl({ label, value, options, disabled = false, onChange }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        aria-label={label}
        value={String(value)}
        disabled={disabled}
        onChange={(event) => {
          const picked = options.find((option) => String(option.value) === event.target.value);
          if (picked) onChange(picked.value);
        }}
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SwitchControl({ label, value, disabled = false, onChange }) {
  return (
    <label className="switch-row">
      <span>{label}</span>
      <button
        type="button"
        className={'toggle ' + (value ? 'on' : '')}
        role="switch"
        aria-checked={!!value}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!value)}
      >
        <i />
      </button>
    </label>
  );
}

export function TextControl({ label, value, placeholder = '', onChange }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        className="lx-text"
        type="text"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function ColourControl({ label, value, onChange }) {
  return (
    <label className="colour-field">
      <span>{label}</span>
      <span className="colour-chip">
        <code>{value}</code>
        <input type="color" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
      </span>
    </label>
  );
}

export function Readout({ label, value, title }) {
  return (
    <div className="readout" title={title}>
      <span>{label}</span>
      <output>{value}</output>
    </div>
  );
}

export function Button({ children, onClick, primary = false, disabled = false, title, className = '', ...rest }) {
  return (
    <button
      type="button"
      className={(primary ? 'lx-primary ' : '') + 'lx-button ' + className}
      onClick={onClick}
      disabled={disabled}
      title={title}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Note({ children }) {
  return <p className="lx-note">{children}</p>;
}

// Canvas previews. Sizes are CSS-driven; the bitmap is drawn at the data resolution.
export function HeightPreview({ heights, size, seaLevel, maxHeight, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && heights && size) drawHeights(ref.current, heights, size, seaLevel, maxHeight);
  }, [heights, size, seaLevel, maxHeight]);
  return <canvas ref={ref} className={'lx-preview ' + className} width={size} height={size} aria-label="Height preview" />;
}

export function RgbaPreview({ rgba, size, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && rgba && size) drawRgba(ref.current, rgba, size);
  }, [rgba, size]);
  return <canvas ref={ref} className={'lx-preview ' + className} width={size} height={size} aria-label="Satmap preview" />;
}
