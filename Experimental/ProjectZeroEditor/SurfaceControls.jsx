//============================================================================================================================================
//                                                             SURFACECONTROLS.JSX
//============================================================================================================================================
// 🧩 The Texture Studio's controls as the ShaderEditor draws them (Follow-up 74). Build.mjs points every import of the Texture Studio's
// MaterialControls.jsx at this module, so its Pattern and Stamp panels keep their own fields while each slider is the editor's own: the
// label above a value pill (number and unit) and the wide pill track with its round thumb (Inspectors.jsx Control, Editor.css .field,
// .slider-pill, .split-value). Everything else is the Texture Studio's module, unchanged.
//   • The Texture Studio's slider props are kept: log (a logarithmic track), extend (typing past the top widens the track), percentage
//     (a 0–1 value shown as 0–100 %), unit, low and high (end captions), valueLabel and ariaLabel.

import React, { useEffect, useState } from "react";
export * from "../TextureStudio/src/MaterialControls.jsx";

const Readable = (Amount, Percentage) => String(Percentage ? Math.round(Amount * 100) : Number((+Amount).toPrecision(6)));

export function Slider({ label, ariaLabel, valueLabel, disabled = false, value = 0, onChange, min = 0, max = 1, step = 0.01, log = false, extend = false, unit = "", percentage = false, low, high }) {
  const Amount = Number.isFinite(+value) ? +value : 0;
  const Scale = percentage ? 100 : 1;
  const [Draft, Edit] = useState(Readable(Amount, percentage));
  useEffect(() => Edit(Readable(Amount, percentage)), [Amount, percentage]);
  const Top = extend ? Math.max(max, Amount) : max;
  const Bottom = extend && Amount > 0 ? Math.min(min, Amount) : min;
  const Low = log ? Math.log10(Math.max(0.000001, Bottom)) : Bottom;
  const High = log ? Math.log10(Top) : Top;
  const At = log ? Math.log10(Math.max(0.000001, Amount)) : Amount;
  const Fill = Math.max(0, Math.min(100, ((At - Low) / (High - Low || 1)) * 100));
  const Settle = (Text, Final = false) => {
    if (Text.trim() === "" || !Number.isFinite(Number(Text))) {
      if (Final) Edit(Readable(Amount, percentage));
      return;
    }
    const Typed = Number(Text) / Scale;
    if (Typed < min && !Final) return;
    const Next = Math.min(extend ? 1000000 : max, Math.max(extend ? 0.000001 : min, Typed));
    onChange(Next);
    if (Final) Edit(Readable(Next, percentage));
  };
  const Name = ariaLabel || (typeof label === "string" ? label : "Amount");
  return (
    <label className="field compact surface-slider" data-native-property={typeof label === "string" ? label : undefined}>
      <span>{label}</span>
      <div className="slider-pill">
        <div className="split-value">
          <input
            aria-label={valueLabel || Name + " value"}
            type="number"
            disabled={disabled}
            min={extend ? 0.000001 : min * Scale}
            max={(extend ? 1000000 : max) * Scale}
            step={step * Scale}
            value={Draft}
            onChange={(Event) => {
              Edit(Event.target.value);
              Settle(Event.target.value);
            }}
            onBlur={() => Settle(Draft, true)}
            onKeyDown={(Event) => Event.key === "Enter" && Event.currentTarget.blur()}
          />
          <small>{percentage ? "%" : unit}</small>
        </div>
        <input
          aria-label={Name}
          type="range"
          disabled={disabled}
          min={Low}
          max={High}
          step={log ? 0.001 : step}
          value={At}
          style={{ "--fill": Fill + "%" }}
          onChange={(Event) => onChange(log ? Number(Math.pow(10, Number(Event.target.value)).toPrecision(5)) : Number(Event.target.value))}
        />
      </div>
      {(low || log) && (
        <div className="surface-slider-ends">
          <span>{low || `${Bottom.toLocaleString()} ${unit}`}</span>
          <span>{high || `${Top.toLocaleString()} ${unit}`}</span>
        </div>
      )}
    </label>
  );
}
