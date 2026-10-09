// Outliner: the layer stacks as Frontier outliner rows. Rows show the top layer
// first, so the list reads the way the stack is evaluated from the top down.
import React from "react";
import Glyph, { GroupGlyph } from "./Glyph.jsx";
import { FindOperation } from "../engine/LayerSpecification.js";

function StatusOf(Layer, Operation, Report) {
  if (Operation && Operation.Status === "Deferred") return { Glyph: "voxel", Text: "Deferred" };
  if (!Layer.Enabled) return { Glyph: "close", Text: "Off" };
  if (Report && Report.Skipped) return { Glyph: "warning", Text: "Skipped" };
  return { Glyph: "check", Text: "Live" };
}

function LayerRow({ Kind, Layer, Selected, Report, OnSelect, OnToggle, OnDrop }) {
  const Operation = FindOperation(Kind, Layer.Operation);
  const Status = StatusOf(Layer, Operation, Report);
  const MaskText = Layer.Masks.length ? `${Layer.Masks.length} mask${Layer.Masks.length > 1 ? "s" : ""}` : "";
  const Meta = [Operation ? Operation.Gaea : "", MaskText].filter(Boolean).join(" · ");
  return (
    <div
      role="treeitem"
      aria-selected={Selected}
      tabIndex={0}
      draggable
      className={"outliner-row " + (Selected ? "selected " : "") + (Layer.Enabled ? "" : "hidden-row")}
      style={{ "--depth": 1 }}
      onClick={() => OnSelect(Kind, Layer.Id)}
      onKeyDown={(Event) => {
        if (Event.key === "Enter" || Event.key === " ") {
          Event.preventDefault();
          OnSelect(Kind, Layer.Id);
        }
      }}
      onDragStart={(Event) => {
        Event.dataTransfer.setData("text/plain", Layer.Id);
        Event.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(Event) => Event.preventDefault()}
      onDrop={(Event) => {
        Event.preventDefault();
        OnDrop(Kind, Event.dataTransfer.getData("text/plain"), Layer.Id);
      }}
    >
      <span className="row-disclosure empty" aria-hidden="true" />
      <span className="row-icon">
        <Glyph Name={GroupGlyph(Operation ? Operation.Group : "")} Size={20} />
      </span>
      <div className="row-identity">
        <span className="row-name">{Layer.Name}</span>
        <small title={Meta}>{Meta || (Operation ? Operation.Name : "")}</small>
      </div>
      <span className={"row-status " + Status.Glyph} title={Status.Text}>
        <Glyph Name={Status.Glyph} Size={11} />
      </span>
      <button
        className="visibility"
        aria-label={`Toggle ${Layer.Name}`}
        onClick={(Event) => {
          Event.stopPropagation();
          OnToggle(Layer.Id);
        }}
      >
        <Glyph Name={Layer.Enabled ? "eye" : "close"} Size={13} />
      </button>
    </div>
  );
}

export default function OutlinerPanel({ Stack, Selection, OnSelect, OnToggle, OnDrop, OnConstruct, Snapshot, Busy, Progress, Failure }) {
  const Reports = Snapshot && Snapshot.Reports ? Snapshot.Reports : [];
  const ReportFor = (LayerId) => Reports.find((Entry) => Entry.Id === LayerId) || null;
  const TerrainTopFirst = [...Stack.Terrain].reverse();
  const TextureTopFirst = [...Stack.Texture].reverse();
  const Stats = Snapshot ? Snapshot.Stats : null;
  const Stage = Failure ? "Error" : Busy ? (Progress ? `${Progress.Index + 1}/${Progress.Count}` : "Working") : "Ready";
  return (
    <>
      <div className="outliner-heading">
        <h1>Outliner</h1>
        <small>{Stack.Name} · {Stack.Terrain.length} terrain · {Stack.Texture.length} texture</small>
        <button aria-label="Add layer" onClick={() => OnConstruct("Terrain")}>
          <Glyph Name="plus" />
        </button>
      </div>
      <div className="outliner-rows" role="tree" aria-label="Layer stacks">
        <div
          role="treeitem"
          aria-selected={Selection.Kind === "Heightfield"}
          tabIndex={0}
          className={"outliner-row " + (Selection.Kind === "Heightfield" ? "selected " : "")}
          style={{ "--depth": 0 }}
          onClick={() => OnSelect("Heightfield", null)}
        >
          <span className="row-disclosure empty" aria-hidden="true" />
          <span className="row-icon"><Glyph Name="heightfield" Size={20} /></span>
          <div className="row-identity">
            <span className="row-name">Heightfield</span>
            <small>{Stack.Heightfield.Resolution}² cells · {Stack.Heightfield.Size} m</small>
          </div>
          <span className="row-status check"><Glyph Name="check" Size={11} /></span>
        </div>

        <p className="outliner-group">
          <span>Terrain stack</span>
          <button aria-label="Add terrain layer" onClick={() => OnConstruct("Terrain")}><Glyph Name="plus" Size={12} /></button>
        </p>
        {TerrainTopFirst.map((Layer) => (
          <LayerRow key={Layer.Id} Kind="Terrain" Layer={Layer} Selected={Selection.Id === Layer.Id} Report={ReportFor(Layer.Id)} OnSelect={OnSelect} OnToggle={OnToggle} OnDrop={OnDrop} />
        ))}

        <p className="outliner-group">
          <span>Texturing stack</span>
          <button aria-label="Add texture layer" onClick={() => OnConstruct("Texture")}><Glyph Name="plus" Size={12} /></button>
        </p>
        {TextureTopFirst.map((Layer) => (
          <LayerRow key={Layer.Id} Kind="Texture" Layer={Layer} Selected={Selection.Id === Layer.Id} Report={null} OnSelect={OnSelect} OnToggle={OnToggle} OnDrop={OnDrop} />
        ))}
        {Stack.Texture.length === 0 && <p className="empty-results">No texture layers yet</p>}
      </div>
      <footer className="outliner-footer">
        <span><small>CELLS</small><b>{Snapshot ? `${Snapshot.N}²` : "—"}</b></span>
        <span><small>HEIGHT</small><b>{Stats ? `${Math.round(Stats.MinimumHeight)}–${Math.round(Stats.MaximumHeight)} m` : "—"}</b></span>
        <span><small>WATER</small><b>{Stats ? `${(100 * Stats.WetShare).toFixed(1)}%` : "—"}</b></span>
        <span><small>STATUS</small><b>{Stage}</b></span>
      </footer>
    </>
  );
}
