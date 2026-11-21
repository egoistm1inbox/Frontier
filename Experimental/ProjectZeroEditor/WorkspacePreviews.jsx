//============================================================================================================================================
//                                                          WORKSPACEPREVIEWS.JSX
//============================================================================================================================================
// 🧰 Inspector preview cards for the edit-mode workspaces. The UV card shows the unwrap in its UDIM tiles and the fracture card the
// current shatter with its recipe figures; each opens the full workspace. Both read the same data the workspaces edit.

import React from "react";
import { pieceStats as PieceStats, bakeState as BakeState, storageEstimate as StorageEstimate, STATE_TEXT, MATERIAL, formatEnergy as FormatEnergy, formatLength as FormatLength, formatBytes as FormatBytes } from "../FractureEditor/FractureModel.js";
import { useUvLayout, useShatter, PaintFracture, WorkspaceGlyph } from "./Workspaces.jsx";
import { Surface, Hue } from "./WorkspaceSurface.jsx";
import { CheckerTexture } from "./WorkspaceGeometry.js";

// UDIM numbering: 1001 + U tile + 10 × V tile, ten tiles per row.
export const UdimOf = (U, V) => 1001 + Math.max(0, Math.min(9, Math.floor(U))) + 10 * Math.max(0, Math.floor(V));

function IslandTiles(Layout, Uvs) {
  return Layout.charts.map((Chart) => {
    let MinU = Infinity, MinV = Infinity, MaxU = -Infinity, MaxV = -Infinity;
    for (const Triangle of Chart.triangles)
      for (let K = 0; K < 6; K += 2) {
        const U = Uvs[Triangle * 6 + K], V = Uvs[Triangle * 6 + K + 1];
        MinU = Math.min(MinU, U); MaxU = Math.max(MaxU, U);
        MinV = Math.min(MinV, V); MaxV = Math.max(MaxV, V);
      }
    return UdimOf((MinU + MaxU) / 2, (MinV + MaxV) / 2);
  });
}

function OpenButton({ Tool, Label, Open }) {
  return (
    <div className="ws-actions">
      <button type="button" className="ws-open" disabled={!Open} onClick={Open}>
        <WorkspaceGlyph Tool={Tool} Size={14} />
        {Label}
      </button>
    </div>
  );
}

export function UvPreviewCard({ Subject, Values, Open, Kit }) {
  const { Card, Control, Metric } = Kit;
  const { Layout, Uvs, Statistics, Angle } = useUvLayout(Subject, Values);
  const Tiles = IslandTiles(Layout, Uvs);
  const Counts = new Map();
  Tiles.forEach((Tile) => Counts.set(Tile, (Counts.get(Tile) || 0) + 1));
  const Strip = [1001, 1002, 1003, 1004];
  const Elsewhere = [...Counts.keys()].filter((Tile) => !Strip.includes(Tile));
  // Main tile on the left, the next three UDIMs stacked on the right; each tile draws the islands that land in it.
  const Paint = (Brush, Width, Height) => {
    const Side = Math.min(Height - 8, Width - 78), Small = (Side - 12) / 3;
    const Rects = [[1001, 4, 4, Side], ...[1002, 1003, 1004].map((Tile, Index) => [Tile, Side + 16, 4 + Index * (Small + 6), Small])];
    const Checker = CheckerTexture(8);
    for (const [Tile, Left, Top, Size] of Rects) {
      const Offset = [(Tile - 1001) % 10, Math.floor((Tile - 1001) / 10)];
      Brush.save();
      Brush.beginPath();
      Brush.roundRect(Left, Top, Size, Size, 6);
      Brush.fillStyle = "#151515";
      Brush.fill();
      Brush.clip();
      Brush.globalAlpha = 0.16;
      Brush.drawImage(Checker, Left, Top, Size, Size);
      Brush.globalAlpha = 1;
      const X = (U) => Left + (U - Offset[0]) * Size, Y = (V) => Top + (1 - (V - Offset[1])) * Size;
      Layout.charts.forEach((Chart, Index) => {
        if (Tiles[Index] !== Tile) return;
        Brush.beginPath();
        for (const Triangle of Chart.triangles) {
          const A = Triangle * 6;
          Brush.moveTo(X(Uvs[A]), Y(Uvs[A + 1]));
          Brush.lineTo(X(Uvs[A + 2]), Y(Uvs[A + 3]));
          Brush.lineTo(X(Uvs[A + 4]), Y(Uvs[A + 5]));
          Brush.closePath();
        }
        Brush.fillStyle = `hsla(${Hue(Index)} 38% 56% / 0.5)`;
        Brush.fill();
        Brush.strokeStyle = "#ffffff30";
        Brush.lineWidth = 0.5;
        Brush.stroke();
      });
      Brush.restore();
      Brush.strokeStyle = Counts.get(Tile) ? "#ffffff40" : "#ffffff14";
      Brush.beginPath();
      Brush.roundRect(Left + 0.5, Top + 0.5, Size - 1, Size - 1, 6);
      Brush.stroke();
      Brush.fillStyle = Counts.get(Tile) ? "#d6d6d6" : "#6a6a6a";
      Brush.font = "9px 'DM Sans', sans-serif";
      Brush.fillText(String(Tile), Left + 6, Top + Size - 6);
    }
  };
  return (
    <Card Title="UV preview" Class="ws-preview-card">
      <Metric
        Value={(Statistics.uvArea * 100).toFixed(1)}
        Unit="% of 1001 used"
        Caption={`${Layout.charts.length} islands · ${Layout.seams.length} seam edges · ${Counts.size} UDIM tile${Counts.size === 1 ? "" : "s"} in use`}
      />
      <button type="button" className="ws-preview-canvas ws-preview-uv" onClick={Open} disabled={!Open} aria-label="Open the UV workspace">
        <Surface Paint={Paint} Label={`${Subject.Name} UV tiles`} Deps={[Values["UV Layout"]]} />
      </button>
      <div className="ws-udims" aria-label="UDIM tiles">
        {Strip.map((Tile) => (
          <span key={Tile} className={Counts.get(Tile) ? "on" : ""}>
            <b>{Tile}</b>
            <small>{Counts.get(Tile) ? `${Counts.get(Tile)} island${Counts.get(Tile) > 1 ? "s" : ""}` : "empty"}</small>
          </span>
        ))}
      </div>
      {Elsewhere.length > 0 && <p className="ws-note">Also in {Elsewhere.sort((A, B) => A - B).join(", ")}.</p>}
      <Control Field={{ Label: "Texel scale", Control: "Readout" }} Value={Statistics.texelScale.toFixed(3) + " UV/m"} />
      <Control Field={{ Label: "Unwrap angle", Control: "Readout" }} Value={Angle + "°"} />
      <OpenButton Tool="uv" Label="Edit in UV workspace" Open={Open} />
    </Card>
  );
}

export function FracturePreviewCard({ Subject, Values, Open, Kit }) {
  const { Card, Control, Metric } = Kit;
  const { Owner, Settings, Result } = useShatter(Subject, Values);
  const Stats = PieceStats(Result.cells);
  const Standing = BakeState(Owner, Settings);
  const Material = MATERIAL[Settings.Material];
  const Storage = StorageEstimate(Stats.count, Settings);
  const Readout = (Label, Text) => <Control key={Label} Field={{ Label, Control: "Readout" }} Value={Text} />;
  const Paint = (Brush, Width, Height) => PaintFracture(Brush, Width, Height, { Owner, Settings, Result, Yaw: 0.7, Pitch: 0.42, Zoom: 1.05, Explode: Settings.Enabled ? 0.3 : 0 });
  return (
    <Card Title="Fracture preview" Class="ws-preview-card">
      <Metric
        Value={Settings.Enabled ? String(Stats.count) : "Off"}
        Unit={Settings.Enabled ? "pieces" : ""}
        Caption={Settings.Enabled ? `${Material.note} ${FormatEnergy(Settings.Energy)} impact · limited by ${Result.budget.limiter}.` : "Fracture is off for this object. The preview shows it whole."}
      />
      <button type="button" className="ws-preview-canvas ws-preview-fracture" onClick={Open} disabled={!Open} aria-label="Open the fracture workspace">
        <Surface Paint={Paint} Label={`${Subject.Name} fracture preview`} />
      </button>
      {Readout("Material", Material.name)}
      {Readout("Impact energy", FormatEnergy(Settings.Energy))}
      {Readout("Impact point", `${Settings.X.toFixed(2)}, ${Settings.Y.toFixed(2)}, ${Settings.Z.toFixed(2)} m`)}
      {Readout("Median piece", Settings.Enabled ? FormatLength(Stats.median) : "–")}
      {Readout("Largest / smallest", Settings.Enabled ? `${FormatLength(Stats.largest)} / ${FormatLength(Stats.smallest)}` : "–")}
      {Readout("Ceiling · seed", `${Settings.Ceiling} pieces · ${Settings.Seed}`)}
      {Readout("Execution", Settings.Mode === "baked" ? "Baked" : "Dynamic")}
      {Readout("Baked storage", Settings.Enabled ? FormatBytes(Storage.total) : "–")}
      <p className="ws-note">{STATE_TEXT[Standing]}</p>
      <OpenButton Tool="fracture" Label="Edit in fracture workspace" Open={Open} />
    </Card>
  );
}
