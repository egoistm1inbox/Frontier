// Viewport: the relief in Three.js, or a 2D map of any single field. The 2D
// modes read the same arrays as the 3D view, so they always agree.
import React, { useEffect, useRef } from "react";
import Glyph from "./Glyph.jsx";
import { CreateReliefScene } from "../render/ReliefScene.js";
import { Normalise, SlopeDegrees } from "../engine/HeightfieldSpace.js";

export const ViewModes = [
  ["3D", "Relief", "layers"],
  ["Colour", "Texture", "palette"],
  ["Height", "Height", "heightfield"],
  ["Water", "Water", "wave"],
  ["Mask", "Mask", "mask"],
  ["Effect", "Effect", "flow"],
];

function Hillshade(Height, N, Cell) {
  const Out = new Float32Array(N * N);
  const Light = [-0.6, 0.6, 0.55];
  const LightLength = Math.hypot(...Light);
  for (let Row = 0; Row < N; Row++) {
    for (let Column = 0; Column < N; Column++) {
      const Xl = Math.max(0, Column - 1), Xr = Math.min(N - 1, Column + 1);
      const Yd = Math.max(0, Row - 1), Yu = Math.min(N - 1, Row + 1);
      const Dx = (Height[Row * N + Xr] - Height[Row * N + Xl]) / ((Xr - Xl) * Cell);
      const Dy = (Height[Yu * N + Column] - Height[Yd * N + Column]) / ((Yu - Yd) * Cell);
      const Length = Math.hypot(-Dx, -Dy, 1);
      const Lit = (-Dx * Light[0] - Dy * Light[1] + Light[2]) / (Length * LightLength);
      Out[Row * N + Column] = Math.max(0, Lit) * 0.85 + 0.15;
    }
  }
  return Out;
}

// Draws one 2D view onto a canvas sized to the raster.
function DrawMap(Canvas, Snapshot, Mode) {
  const N = Snapshot.N;
  Canvas.width = N;
  Canvas.height = N;
  const Context = Canvas.getContext("2d");
  const Image = Context.createImageData(N, N);
  const Pixels = Image.data;
  const Count = N * N;
  const Put = (Index, R, G, B) => {
    Pixels[Index * 4] = R;
    Pixels[Index * 4 + 1] = G;
    Pixels[Index * 4 + 2] = B;
    Pixels[Index * 4 + 3] = 255;
  };
  if (Mode === "Colour") {
    for (let Index = 0; Index < Count; Index++) {
      Put(Index, Snapshot.Colour[Index * 3] * 255, Snapshot.Colour[Index * 3 + 1] * 255, Snapshot.Colour[Index * 3 + 2] * 255);
    }
  } else if (Mode === "Height") {
    const Unit = Normalise(Snapshot.Height);
    for (let Index = 0; Index < Count; Index++) Put(Index, Unit[Index] * 255, Unit[Index] * 255, Unit[Index] * 255);
  } else if (Mode === "Water") {
    const Shade = Hillshade(Snapshot.Height, N, Snapshot.Cell);
    const Tint = { 1: [0.36, 0.62, 0.66], 2: [0.42, 0.7, 0.58], 3: [0.3, 0.46, 0.5] };
    for (let Index = 0; Index < Count; Index++) {
      const Source = Snapshot.WaterSource[Index];
      const Base = Shade[Index] * 230;
      const Colour = Tint[Source] || [1, 1, 1];
      Put(Index, Base * Colour[0], Base * Colour[1], Base * Colour[2]);
    }
  } else if (Mode === "Mask") {
    const Mask = Snapshot.Preview ? Snapshot.Preview.Mask : null;
    for (let Index = 0; Index < Count; Index++) {
      const Value = Mask ? Mask[Index] * 255 : 90;
      Put(Index, Value, Value, Value);
    }
  } else if (Mode === "Effect") {
    const Effect = Snapshot.Preview ? Snapshot.Preview.Effect : null;
    for (let Index = 0; Index < Count; Index++) {
      if (!Effect) {
        Put(Index, 60, 60, 60);
        continue;
      }
      const Value = Effect[Index];
      if (Value >= 0) Put(Index, 40 + 215 * Value, 40 + 60 * Value, 40);
      else Put(Index, 40, 40 - 20 * Value, 40 + 215 * -Value);
    }
  }
  Context.putImageData(Image, 0, 0);
}

export default function ViewportPanel({ Snapshot, ViewMode, SetViewMode, Exaggeration, SetExaggeration, Busy, Progress, Failure, ResetToken, OnReset, Heading, Blurb }) {
  const StageRef = useRef(null);
  const CanvasRef = useRef(null);
  const SceneRef = useRef(null);
  const Is3D = ViewMode === "3D";

  useEffect(() => {
    if (!Is3D || !StageRef.current) return undefined;
    const Scene = CreateReliefScene(StageRef.current);
    SceneRef.current = Scene;
    return () => {
      Scene.Dispose();
      SceneRef.current = null;
    };
  }, [Is3D]);

  useEffect(() => {
    if (Is3D && SceneRef.current && Snapshot) SceneRef.current.Update(Snapshot, Exaggeration);
  }, [Is3D, Snapshot, Exaggeration]);

  useEffect(() => {
    if (Is3D && SceneRef.current && Snapshot) {
      SceneRef.current.ResetCamera();
      SceneRef.current.Update(Snapshot, Exaggeration);
    }
  }, [ResetToken]);

  useEffect(() => {
    if (!Is3D && CanvasRef.current && Snapshot) DrawMap(CanvasRef.current, Snapshot, ViewMode);
  }, [Is3D, Snapshot, ViewMode]);

  const Stats = Snapshot ? Snapshot.Stats : null;
  return (
    <>
      <div className="viewport-toolbar">
        <div className="viewport-modes" role="group" aria-label="View mode">
          {ViewModes.map(([Id, Label, Icon]) => (
            <button key={Id} className={ViewMode === Id ? "active" : ""} aria-pressed={ViewMode === Id} onClick={() => SetViewMode(Id)}>
              <Glyph Name={Icon} Size={14} /> {Label}
            </button>
          ))}
        </div>
        <div className="viewport-settings">
          {Is3D && (
            <label className="field compact viewport-exaggeration">
              <span>Relief scale</span>
              <div className="slider-pill">
                <div className="split-value">
                  <input aria-label="Relief scale value" type="number" min={0.2} max={4} step={0.1} value={Number(Exaggeration.toFixed(2))} onChange={(Event) => SetExaggeration(Math.min(4, Math.max(0.2, +Event.target.value || 1)))} />
                  <small>×</small>
                </div>
                <input aria-label="Relief scale" type="range" min={0.2} max={4} step={0.05} value={Exaggeration} onChange={(Event) => SetExaggeration(+Event.target.value)} />
              </div>
            </label>
          )}
          {Is3D && (
            <button className="viewport-icon-button" aria-label="Reset view" title="Reset view" onClick={OnReset}>
              <Glyph Name="flow" Size={15} />
            </button>
          )}
        </div>
      </div>
      <div className="viewport-heading-row">
        <h2>{Heading}</h2>
        <small>{Blurb}</small>
        {Busy && <span className="busy-chip" role="status">{Progress ? `Computing ${Progress.Index + 1}/${Progress.Count} · ${Progress.Name}` : "Computing"}</span>}
      </div>
      {Failure && <div className="viewport-error" role="alert"><strong>Evaluation failed</strong><pre>{Failure}</pre></div>}
      <div className="viewport-canvas">
        {Is3D ? <div className="relief-stage" ref={StageRef} /> : <div className="map-stage"><canvas ref={CanvasRef} aria-label="Map view" /></div>}
      </div>
      <footer className="viewport-footer">
        <span><small>CELLS</small><b>{Snapshot ? `${Snapshot.N}×${Snapshot.N}` : "—"}</b></span>
        <span><small>EXTENT</small><b>{Snapshot ? `${Snapshot.Size} m` : "—"}</b></span>
        <span><small>HEIGHT</small><b>{Stats ? `${Math.round(Stats.MinimumHeight)} to ${Math.round(Stats.MaximumHeight)} m` : "—"}</b></span>
        <span><small>WATER</small><b>{Stats ? `${(100 * Stats.WetShare).toFixed(1)}%` : "—"}</b></span>
        <span><small>COMPUTE</small><b>{Snapshot ? `${Math.round(Snapshot.Milliseconds.Total)} ms` : "—"}</b></span>
      </footer>
    </>
  );
}

export { SlopeDegrees };
