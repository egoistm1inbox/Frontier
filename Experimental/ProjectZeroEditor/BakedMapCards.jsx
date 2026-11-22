//============================================================================================================================================
//                                                              BAKEDMAPCARDS.JSX
//============================================================================================================================================
// 🧩 The BAKING sections' maps (BakedMaps.js): each shows the image the 3D viewport uses, what it is, its size and format, when it was
// baked and how long that took, with Bake again and Save PNG. Maps bake again by themselves when their settings change. Also the Lens
// Flare's composite card preview, drawn by the viewport's own flare code (LensFlare.js) over a dusk sky.

import React, { useEffect, useRef, useState } from "react";
import { FlareAtlasMap } from "./BakedMaps.js";
import { PaintFlare } from "./LensFlare.js";
import "./BakedMapCards.css";

// One map. Make(Again) bakes it (or returns the held bake when nothing it reads changed); Signature is everything it reads, so the
// card bakes again when that changes. Marker ({ At: 0–1 across, Label }) points at a column, e.g. the sun's elevation now.
export function BakedMap({ Name, Make, Signature, Caption, Marker = null, Legend = null, Pixelated = false }) {
  const Shown = useRef(null);
  const [Result, Keep] = useState(null);
  const Run = (Again) => {
    try {
      Keep(Make(Again));
    } catch (Problem) {
      Keep({ Problem: String(Problem?.message || Problem) });
    }
  };
  useEffect(() => {
    const Timer = setTimeout(() => Run(false), 40);
    return () => clearTimeout(Timer);
  }, [Signature]);
  useEffect(() => {
    const Target = Shown.current;
    if (!Target || !Result?.Canvas) return;
    Target.width = Result.Width;
    Target.height = Result.Height;
    Target.getContext("2d").drawImage(Result.Canvas, 0, 0);
  }, [Result]);
  const Save = () =>
    Shown.current?.toBlob((Picture) => {
      if (!Picture) return;
      const Link = document.createElement("a");
      Link.href = URL.createObjectURL(Picture);
      Link.download = Name.replace(/\s+/g, "-") + ".png";
      Link.click();
      setTimeout(() => URL.revokeObjectURL(Link.href), 2000);
    }, "image/png");
  return (
    <figure className="baked-map" data-baked-map={Name} data-baked-count={Result?.Count || 0} data-baked-size={Result?.Canvas ? `${Result.Width}x${Result.Height}` : ""}>
      <div className={"baked-map-image" + (Pixelated ? " pixelated" : "")} style={{ aspectRatio: Result?.Canvas ? `${Result.Width} / ${Result.Height}` : "2 / 1" }}>
        <canvas ref={Shown} aria-label={Name} />
        {!Result && <span className="baked-map-wait">Baking…</span>}
        {Result?.Problem && <span className="baked-map-wait">Bake failed · {Result.Problem}</span>}
        {Marker && (
          <i className="baked-map-marker" style={{ left: `${Math.max(0, Math.min(1, Marker.At)) * 100}%` }}>
            <span>{Marker.Label}</span>
          </i>
        )}
      </div>
      {Legend && <div className="baked-map-legend">{Legend.map((Each) => <span key={Each}>{Each}</span>)}</div>}
      <figcaption>
        <strong>{Name}</strong>
        <span>{Result?.Canvas ? `${Result.Width} × ${Result.Height} · ${Result.Format}` : "–"}</span>
      </figcaption>
      {Caption && <p className="baked-map-use">{Caption}</p>}
      <div className="baked-map-status">
        <span>{Result?.Canvas ? `Baked ${new Date(Result.At).toLocaleTimeString()} · ${Result.Milliseconds.toFixed(0)} ms` : "Not baked yet"}</span>
        <button type="button" onClick={() => Run(true)}>
          Bake again
        </button>
        <button type="button" onClick={Save} disabled={!Result?.Canvas}>
          Save PNG
        </button>
      </div>
    </figure>
  );
}

// The Flare composite card: the flare as the viewport draws it (same atlas, same compositing) for a sun at Preview X / Y over a dusk
// sky. Dragging moves the sun; only this preview changes.
export function FlarePreview({ Settings, Tint, X, Y, Move }) {
  const Box = useRef(null), Shown = useRef(null);
  const [Size, Resize] = useState([320, 196]);
  useEffect(() => {
    const Watch = new ResizeObserver(() => Box.current && Resize([Box.current.clientWidth, Box.current.clientHeight]));
    Watch.observe(Box.current);
    return () => Watch.disconnect();
  }, []);
  const Key = JSON.stringify([Settings, Tint, X, Y, Size]);
  useEffect(() => {
    const Target = Shown.current;
    if (!Target) return;
    const [Width, Height] = Size, Ratio = window.devicePixelRatio || 1;
    Target.width = Math.max(1, Math.round(Width * Ratio));
    Target.height = Math.max(1, Math.round(Height * Ratio));
    const Brush = Target.getContext("2d");
    Brush.setTransform(Ratio, 0, 0, Ratio, 0, 0);
    const Sky = Brush.createLinearGradient(0, 0, 0, Height);
    Sky.addColorStop(0, "#0d1426");
    Sky.addColorStop(0.62, "#2a2c3e");
    Sky.addColorStop(0.8, "#5a4038");
    Sky.addColorStop(0.81, "#141210");
    Sky.addColorStop(1, "#0a0909");
    Brush.fillStyle = Sky;
    Brush.fillRect(0, 0, Width, Height);
    const Atlas = Settings.Enabled ? FlareAtlasMap(Settings, Tint).Canvas : null;
    const Drawn = PaintFlare(Brush, Atlas, Settings, { X: X * Width, Y: Y * Height, Width, Height, Strength: 1 });
    Target.dataset.sprites = String(Drawn);
  }, [Key]);
  return (
    <div
      ref={Box}
      className="flare-preview"
      onPointerDown={(Event) => {
        Event.currentTarget.setPointerCapture(Event.pointerId);
        Drag(Event);
      }}
      onPointerMove={(Event) => Event.buttons && Drag(Event)}
    >
      <canvas ref={Shown} data-flare-preview aria-label="Lens flare preview" />
    </div>
  );
  function Drag(Event) {
    const Rect = Event.currentTarget.getBoundingClientRect();
    Move(Math.max(0.06, Math.min(0.94, (Event.clientX - Rect.left) / Rect.width)), Math.max(0.08, Math.min(0.92, (Event.clientY - Rect.top) / Rect.height)));
  }
}
