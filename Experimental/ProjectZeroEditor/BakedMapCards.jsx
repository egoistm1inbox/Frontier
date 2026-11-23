//============================================================================================================================================
//                                                              BAKEDMAPCARDS.JSX
//============================================================================================================================================
// 🧩 The BAKING sections' maps (BakedMaps.js): unbaked, the bake tab; Bake opens the bake settings (resolution, format, size); baked,
// the image the 3D viewport uses on labelled axes under a Baked badge (its details in the badge's tooltip) with Rebake and Save PNG
// icons and a cursor readout. Baked maps bake again by themselves when their settings change. Also the Lens Flare's composite card preview, drawn by the viewport's own flare code (LensFlare.js) over black.

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FlareAtlasMap, HeldBake, WatchBakes, BakeSizes, BakeSizeOf, ChooseBakeSize, ForgetBake } from "./BakedMaps.js";
import { PaintFlare } from "./LensFlare.js";
import "./BakedMapCards.css";

// One map. Make(Again) bakes it (or returns the held bake when nothing it reads changed); Signature is everything it reads. A map nobody
// has baked yet (here or in the viewport) shows the bake tab (Kit.Tile, Kit.Glyph from the inspector); Planned[1] is its format; once baked it stays live, baking again when its settings change. Axes ({ X, Y }: { Name, At(0–1) → amount or label, Unit,
// Ticks }) label the image and give the cursor readout. Marker ({ At: 0–1 across, Label }) points at a column.
const Reading = (Axis, Fraction, Fine) => {
  const Amount = Axis.At(Fraction);
  return typeof Amount === "number" ? Amount.toFixed(Fine ? (Math.abs(Amount) < 10 ? 2 : 1) : 0) + (Axis.Unit || "") : Amount;
};
// Follow-up 76: three faces. Not baked: the default card (the bake tile, Bake and Load image). Bake opens the bake settings on the card —
// the table's resolution (from BakedMaps.js BakeSizes), its format, texel count and memory — and Bake there bakes at that size. Baked:
// the image on its axes under a bar with the Baked badge (its details — resolution, format, time, axes — are the badge's tooltip),
// Rebake (forgets the bake and goes back to the default card) and Save PNG. The cursor readout sits under the image while pointing.
const Bytes = (Count) => (Count >= 1048576 ? (Count / 1048576).toFixed(Count >= 10485760 ? 0 : 1) + " MB" : Math.round(Count / 1024) + " KB");
const Icon = ({ Path, Size = 13 }) => (
  <svg viewBox="0 0 24 24" width={Size} height={Size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={Path} />
  </svg>
);
const Icons = {
  Baked: "M20 6 9 17l-5-5",
  Rebake: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  Save: "M12 4v11M7 10l5 5 5-5M5 20h14",
};
export function BakedMap({ Name, Make, Signature, Planned, Axes = null, Marker = null, Pixelated = false, Kit }) {
  const Shown = useRef(null);
  const [Result, Keep] = useState(() => HeldBake(Name));
  const [Cursor, Point] = useState(null);
  const [Setting, OpenSettings] = useState(false);
  // The details tooltip is drawn on the page (fixed, under the badge) so the inspector card never clips it.
  const [TipAt, PlaceTip] = useState(null);
  const ShowTip = (Event) => {
    const Rect = Event.currentTarget.getBoundingClientRect();
    PlaceTip({ Left: Math.max(8, Math.min(Rect.left, window.innerWidth - 268)), Top: Rect.bottom + 6 });
  };
  const Sizes = BakeSizes[Name] || { Options: [BakeSizeOf(Name)], Default: BakeSizeOf(Name) };
  const [Size, ChooseSize] = useState(() => BakeSizeOf(Name));
  // After Rebake the card stays on its default face until Bake is pressed, even if the viewport bakes the map again meanwhile.
  const Forgotten = useRef(false);
  const Run = (Again) => {
    try {
      Keep(Make(Again));
    } catch (Problem) {
      Keep({ Problem: String(Problem?.message || Problem) });
    }
  };
  useEffect(() => {
    const Timer = setTimeout(() => (HeldBake(Name) && !Forgotten.current ? Run(false) : Keep(null)), 40);
    return () => clearTimeout(Timer);
  }, [Signature]);
  // The viewport may bake it first.
  useEffect(() => WatchBakes((Baked) => Baked === Name && !Result && !Forgotten.current && Run(false)), [Result]);
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
  const BakeNow = () => {
    ChooseBakeSize(Name, Size);
    Forgotten.current = false;
    OpenSettings(false);
    Run(true);
  };
  const Rebake = () => {
    ForgetBake(Name);
    Forgotten.current = true;
    ChooseSize(BakeSizeOf(Name));
    Point(null);
    Keep(null);
    OpenSettings(false);
  };
  const Baked = !!Result?.Canvas;
  if (!Baked && !Result?.Problem && Setting) {
    const [Width, Height] = Size, Texels = Width * Height;
    return (
      <figure className="baked-map bake-settings" data-baked-map={Name} data-baked-count={0} data-baked-size="" data-baked-state="settings">
        <header className="baked-map-bar">
          <b>Bake settings</b>
          <small>{Name}</small>
        </header>
        <div className="baked-map-sizes" role="radiogroup" aria-label={`${Name} resolution`}>
          {Sizes.Options.map(([W, H]) => {
            const On = W === Width && H === Height;
            return (
              <button key={W + "x" + H} type="button" role="radio" aria-checked={On} className={On ? "on" : ""} data-bake-size={`${W}x${H}`} onClick={() => ChooseSize([W, H])}>
                <b>
                  {W} × {H}
                </b>
                <small>{W === Sizes.Default[0] && H === Sizes.Default[1] ? "default" : Bytes(W * H * 4)}</small>
              </button>
            );
          })}
        </div>
        <dl className="baked-map-facts">
          <dt>Resolution</dt>
          <dd data-bake-planned>
            {Width} × {Height}
          </dd>
          <dt>Format</dt>
          <dd>{Planned[1]}</dd>
          <dt>Texels</dt>
          <dd>{Texels.toLocaleString("en-US")}</dd>
          <dt>Size</dt>
          <dd>{Bytes(Texels * 4)} · 4 bytes a texel</dd>
          {Axes && (
            <>
              <dt>X</dt>
              <dd>{`${Axes.X.Name} ${Reading(Axes.X, 0, false)} → ${Reading(Axes.X, 1, false)} · ${Width} columns`}</dd>
              <dt>Y</dt>
              <dd>{`${Axes.Y.Name} ${Reading(Axes.Y, 0, false)} → ${Reading(Axes.Y, 1, false)} · ${Height} rows`}</dd>
            </>
          )}
        </dl>
        <div className="baked-map-status">
          <button type="button" onClick={() => OpenSettings(false)}>
            Cancel
          </button>
          <button type="button" className="baked-map-go" onClick={BakeNow} aria-label={"Bake " + Name + " now"}>
            <Kit.Glyph Name="bake" /> Bake
          </button>
        </div>
      </figure>
    );
  }
  if (!Baked && !Result?.Problem)
    return (
      <figure className="baked-map unbaked" data-baked-map={Name} data-baked-count={0} data-baked-size="" data-baked-state="unbaked">
        <div className="bake-content">
          <Kit.Tile Label="Use baked image" Disabled IconName="bake" />
          <div>
            <button type="button" onClick={() => OpenSettings(true)} aria-label={"Bake " + Name}>
              <Kit.Glyph Name="bake" /> Bake
            </button>
            <button disabled>↥　Load image</button>
            <p>Not baked · {BakeSizeOf(Name).join(" × ")}</p>
          </div>
        </div>
      </figure>
    );
  const Ticks = (Axis) => (Axis.Ticks || [0, 0.25, 0.5, 0.75, 1]).map((Fraction) => [Fraction, Reading(Axis, Fraction, false)]);
  const Track = (Event) => {
    const Rect = Event.currentTarget.getBoundingClientRect();
    const U = Math.max(0, Math.min(0.9999, (Event.clientX - Rect.left) / Rect.width)), V = Math.max(0, Math.min(0.9999, (Event.clientY - Rect.top) / Rect.height));
    const Pixel = Result.Canvas.getContext("2d").getImageData(Math.floor(U * Result.Width), Math.floor(V * Result.Height), 1, 1).data;
    Point({ U, V, Colour: [Pixel[0], Pixel[1], Pixel[2]] });
  };
  return (
    <figure className="baked-map" data-baked-map={Name} data-baked-count={Result?.Count || 0} data-baked-size={Baked ? `${Result.Width}x${Result.Height}` : ""} data-baked-state="baked">
      <header className="baked-map-bar">
        <span
          className={"baked-map-badge" + (Baked ? "" : " failed")}
          tabIndex={0}
          aria-describedby={"tip-" + Name.replace(/\W+/g, "-")}
          onPointerEnter={ShowTip}
          onPointerLeave={() => PlaceTip(null)}
          onFocus={ShowTip}
          onBlur={() => PlaceTip(null)}
        >
          <Icon Path={Baked ? Icons.Baked : "M12 8v5M12 16.5v.5"} />
          {Baked ? "Baked" : "Failed"}
          {createPortal(
          <span className={"baked-map-tip" + (TipAt ? " shown" : "")} role="tooltip" id={"tip-" + Name.replace(/\W+/g, "-")} style={TipAt ? { left: TipAt.Left, top: TipAt.Top } : undefined}>
            <dl className="baked-map-facts">
              <dt>Map</dt>
              <dd>{Name}</dd>
              <dt>Resolution</dt>
              <dd data-baked-resolution>{Baked ? `${Result.Width} × ${Result.Height}` : "–"}</dd>
              <dt>Format</dt>
              <dd>{Result?.Format || "–"}</dd>
              <dt>Size</dt>
              <dd>{Baked ? Bytes(Result.Width * Result.Height * 4) : "–"}</dd>
              <dt>Baked</dt>
              <dd>{Baked ? `${new Date(Result.At).toLocaleTimeString()} · ${Result.Milliseconds.toFixed(0)} ms · #${Result.Count}` : Result?.Problem}</dd>
              {Axes && (
                <>
                  <dt>X</dt>
                  <dd>{`${Axes.X.Name} ${Reading(Axes.X, 0, false)} → ${Reading(Axes.X, 1, false)}`}</dd>
                  <dt>Y</dt>
                  <dd>{`${Axes.Y.Name} ${Reading(Axes.Y, 0, false)} → ${Reading(Axes.Y, 1, false)}`}</dd>
                </>
              )}
            </dl>
          </span>,
          document.body,
          )}
        </span>
        <small>{Baked ? `${Result.Width} × ${Result.Height}` : ""}</small>
        <span className="baked-map-icons">
          <button type="button" className="baked-map-icon" onClick={Rebake} aria-label={"Rebake " + Name} title="Rebake · forget this bake and choose its settings again">
            <Icon Path={Icons.Rebake} />
          </button>
          <button type="button" className="baked-map-icon" onClick={Save} disabled={!Baked} aria-label={"Save " + Name + " as PNG"} title="Save PNG">
            <Icon Path={Icons.Save} />
          </button>
        </span>
      </header>
      <div className={"baked-map-plot" + (Axes ? " with-axes" : "")}>
        {Axes && (
          <div className="baked-map-y" aria-hidden="true">
            {Ticks(Axes.Y).map(([Fraction, Label]) => (
              <span key={Fraction} style={{ top: Fraction * 100 + "%" }}>
                {Label}
              </span>
            ))}
          </div>
        )}
        <div
          className={"baked-map-image" + (Pixelated ? " pixelated" : "")}
          style={{ aspectRatio: Baked ? `${Result.Width} / ${Result.Height}` : "2 / 1" }}
          onPointerMove={Baked ? Track : undefined}
          onPointerLeave={() => Point(null)}
        >
          <canvas ref={Shown} aria-label={Name} />
          {Result?.Problem && <span className="baked-map-wait">Bake failed · {Result.Problem}</span>}
          {Marker && (
            <i className="baked-map-marker" style={{ left: `${Math.max(0, Math.min(1, Marker.At)) * 100}%` }}>
              <span>{Marker.Label}</span>
            </i>
          )}
          {Cursor && <i className="baked-map-cursor" style={{ left: Cursor.U * 100 + "%", top: Cursor.V * 100 + "%" }} />}
        </div>
        {Axes && (
          <div className="baked-map-x" aria-hidden="true">
            {Ticks(Axes.X).map(([Fraction, Label]) => (
              <span key={Fraction} style={{ left: Fraction * 100 + "%" }}>
                {Label}
              </span>
            ))}
          </div>
        )}
      </div>
      <p className="baked-map-readout" data-baked-cursor>
        {Cursor ? (
          <>
            {Axes ? `${Reading(Axes.X, Cursor.U, true)}, ${Reading(Axes.Y, Cursor.V, true)}` : `${Math.floor(Cursor.U * Result.Width)}, ${Math.floor(Cursor.V * Result.Height)} px`}
            <b style={{ background: `rgb(${Cursor.Colour.join(",")})` }} />
            {`rgb(${Cursor.Colour.join(", ")})`}
          </>
        ) : (
          "Point at the image to read it"
        )}
      </p>
    </figure>
  );
}

// The Flare composite card: the flare as the viewport draws it (same atlas, same compositing) for a sun at Preview X / Y over black. Dragging moves the sun; only this preview changes.
export function FlarePreview({ Settings, Tint, X, Y, Move }) {
  const Box = useRef(null), Shown = useRef(null);
  const [Size, Resize] = useState([320, 196]);
  useEffect(() => {
    // A shut tab measures 0 × 0; keep the last real size.
    const Watch = new ResizeObserver(() => Box.current?.clientWidth && Resize([Box.current.clientWidth, Box.current.clientHeight]));
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
    // Follow-up 76: a plain black field, so only the flare's own light shows.
    Brush.fillStyle = "#000";
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
