// Inspector: parameters, masks and results for the selected layer, built from
// the layer specification so every control matches the engine's keys.
import React, { useState } from "react";
import Glyph from "./Glyph.jsx";
import {
  FindOperation, FindMaskMethod, MaskMethods, MaskCommonParameters,
  TerrainCombineModes, TextureCombineModes, MaskCombineModes, CombineHelp,
} from "../engine/LayerSpecification.js";

// Field descriptor controls, mirroring the Frontier editor's Control component.
export function Control({ Field, Current, Change, Disabled = false, Compact = false }) {
  if (!Field) return null;
  const Label = Field.Label;
  if (Field.Control === "Switch") {
    return (
      <label className="switch-row">
        <span>{Label}</span>
        <button className={"toggle " + (Current ? "on" : "")} role="switch" aria-checked={!!Current} aria-label={Label} disabled={Disabled} onClick={() => Change(!Current)}>
          <i />
        </button>
      </label>
    );
  }
  if (Field.Control === "Select") {
    return (
      <label className="field">
        <span>{Label}</span>
        <select value={Current ?? Field.Default} disabled={Disabled} aria-label={Label} onChange={(Event) => Change(Event.target.value)}>
          {Field.Options.map((Option) => (
            <option value={Option} key={Option}>{Option}</option>
          ))}
        </select>
      </label>
    );
  }
  if (Field.Control === "Colour") {
    const Hex = Current || Field.Default;
    return (
      <label className="colour-field">
        <span>{Label}</span>
        <input aria-label={Label} type="color" value={Hex} disabled={Disabled} onChange={(Event) => Change(Event.target.value)} />
        <output>{Hex.toUpperCase()}</output>
      </label>
    );
  }
  const Minimum = Field.Minimum ?? 0;
  const Maximum = Field.Maximum ?? 100;
  const Decimals = Field.Decimals ?? 2;
  const Numeric = Number.isFinite(+Current) ? +Current : Field.Default;
  const Write = (Input) => {
    const Parsed = +Input;
    if (Number.isFinite(Parsed)) Change(Math.min(Maximum, Math.max(Minimum, Parsed)));
  };
  const Fill = Maximum > Minimum ? (100 * (Numeric - Minimum)) / (Maximum - Minimum) : 0;
  return (
    <label className={"field " + (Compact ? "compact" : "")} data-native-property={Label}>
      <span>{Label}</span>
      <div className="slider-pill">
        <div className="split-value">
          <input aria-label={Label + " value"} type="number" min={Minimum} max={Maximum} step={10 ** -Decimals} disabled={Disabled} value={Number(Numeric.toFixed(Decimals))} onChange={(Event) => Write(Event.target.value)} />
          <small>{Field.Unit}</small>
        </div>
        <input aria-label={Label} type="range" min={Minimum} max={Maximum} step={10 ** -Decimals} value={Numeric} disabled={Disabled} style={{ "--fill": `${Fill}%` }} onChange={(Event) => Write(Event.target.value)} />
      </div>
    </label>
  );
}

export function Card({ Title, Wide = false, Accent, children }) {
  return (
    <section className={"property-card " + (Wide ? "span-two" : "")} style={{ "--accent": Accent || "#bababa" }} data-card={Title}>
      <h3><span>{Title}</span></h3>
      {children}
    </section>
  );
}

function MaskAdder({ OnAdd }) {
  const [Pick, SetPick] = useState(MaskMethods[0].Id);
  return (
    <div className="mask-adder">
      <select aria-label="Mask method" value={Pick} onChange={(Event) => SetPick(Event.target.value)}>
        {MaskMethods.map((Method) => (
          <option key={Method.Id} value={Method.Id}>{Method.Name} · {Method.Gaea}</option>
        ))}
      </select>
      <button type="button" onClick={() => OnAdd(Pick)}>
        <Glyph Name="plus" Size={14} /> Add mask
      </button>
    </div>
  );
}

function MaskEntry({ Mask, Edit }) {
  const Method = FindMaskMethod(Mask.Method);
  const Fields = [...MaskCommonParameters, ...(Method ? Method.Parameters : [])];
  return (
    <div className={"mask-entry " + (Mask.Enabled ? "" : "disabled")}>
      <header>
        <Glyph Name="mask" Size={14} />
        <strong>{Method ? Method.Name : Mask.Method}</strong>
        <small>{Method ? Method.Gaea : ""}</small>
        <button className="icon-button" aria-label={`Remove ${Method ? Method.Name : ""} mask`} onClick={() => Edit.RemoveMask(Mask.Id)}>
          <Glyph Name="trash" Size={14} />
        </button>
      </header>
      <Control Field={{ Label: "Enabled", Control: "Switch" }} Current={Mask.Enabled} Change={(Value) => Edit.Mask(Mask.Id, { Enabled: Value }, "")} />
      <Control Field={{ Label: "Invert", Control: "Switch" }} Current={Mask.Invert} Change={(Value) => Edit.Mask(Mask.Id, { Invert: Value }, "")} />
      <Control Field={{ Label: "Opacity", Control: "Slider", Minimum: 0, Maximum: 1, Default: 1, Decimals: 2 }} Current={Mask.Opacity} Change={(Value) => Edit.Mask(Mask.Id, { Opacity: Value }, "mask-opacity:" + Mask.Id)} />
      <Control Field={{ Label: "Combine", Control: "Select", Options: MaskCombineModes, Default: "Multiply" }} Current={Mask.Combine} Change={(Value) => Edit.Mask(Mask.Id, { Combine: Value }, "")} />
      {Fields.map((Field) => (
        <Control key={Field.Key} Field={Field} Current={Mask.Parameters[Field.Key]} Change={(Value) => Edit.MaskParameter(Mask.Id, Field.Key, Value)} />
      ))}
    </div>
  );
}

function Metric({ Label, Value }) {
  return (
    <div className="result-row">
      <dt>{Label}</dt>
      <dd>{Value}</dd>
    </div>
  );
}

function HeightfieldInspector({ Stack, Snapshot, Edit }) {
  const Heightfield = Stack.Heightfield;
  const Stats = Snapshot ? Snapshot.Stats : null;
  const Layers = Stack.Terrain.filter((Layer) => Layer.Enabled).length;
  return (
    <>
      <header className="inspector-heading">
        <span className="eyebrow">Stack root</span>
        <h1>{Stack.Name}</h1>
      </header>
      <div className="inspector-scroll">
        <Card Title="Heightfield">
          <Control Field={{ Key: "Size", Label: "Size", Control: "Slider", Minimum: 256, Maximum: 8192, Default: 1024, Unit: "m", Decimals: 0 }} Current={Heightfield.Size} Change={(Value) => Edit.Heightfield({ Size: Value }, "heightfield:size")} />
          <Control Field={{ Label: "Resolution", Control: "Select", Options: ["128", "256", "512"], Default: "256" }} Current={String(Heightfield.Resolution)} Change={(Value) => Edit.Heightfield({ Resolution: +Value }, "")} />
          <Control Field={{ Key: "Seed", Label: "Seed", Control: "Slider", Minimum: 0, Maximum: 999, Default: 7, Decimals: 0 }} Current={Heightfield.Seed} Change={(Value) => Edit.Heightfield({ Seed: Value }, "heightfield:seed")} />
        </Card>
        <Card Title="Stack">
          <dl className="result-list">
            <Metric Label="Terrain layers" Value={`${Stack.Terrain.length} (${Layers} enabled)`} />
            <Metric Label="Texture layers" Value={String(Stack.Texture.length)} />
            <Metric Label="Voxel slot" Value="Deferred" />
          </dl>
          <p className="muted">Layers run bottom to top. Each layer blends into the one below through its mask, opacity and combine mode.</p>
        </Card>
        {Stats && (
          <Card Title="Result">
            <dl className="result-list">
              <Metric Label="Height" Value={`${Math.round(Stats.MinimumHeight)}–${Math.round(Stats.MaximumHeight)} m`} />
              <Metric Label="Water" Value={`${(100 * Stats.WetShare).toFixed(2)}% of cells`} />
              <Metric Label="Rivers" Value={`${(100 * Stats.RiverShare).toFixed(2)}%`} />
              <Metric Label="Lakes" Value={`${(100 * Stats.LakeShare).toFixed(2)}%`} />
              <Metric Label="Sea" Value={`${(100 * Stats.SeaShare).toFixed(2)}%`} />
              <Metric Label="Compute" Value={`${Math.round(Snapshot.Milliseconds.Total)} ms`} />
            </dl>
          </Card>
        )}
      </div>
    </>
  );
}

export default function InspectorPanel({ Stack, Selection, Found, Snapshot, Edit }) {
  if (Selection.Kind === "Heightfield" || !Found) {
    return <HeightfieldInspector Stack={Stack} Snapshot={Snapshot} Edit={Edit} />;
  }
  const { Kind, Index, Layer } = Found;
  const Operation = FindOperation(Kind, Layer.Operation);
  const Combines = Kind === "Texture" ? TextureCombineModes : TerrainCombineModes;
  const Count = Stack[Kind].length;
  const Report = Snapshot && Snapshot.Reports ? Snapshot.Reports.find((Entry) => Entry.Id === Layer.Id) : null;
  const Deferred = Operation && Operation.Status === "Deferred";
  return (
    <>
      <header className="inspector-heading">
        <span className="eyebrow">{Kind === "Texture" ? "Texturing stack" : "Terrain stack"} · {Operation ? Operation.Group : "Layer"}</span>
        <h1>{Layer.Name}</h1>
        <div className="inspector-actions">
          <button aria-label="Move layer up" title="Move up the stack" disabled={Index >= Count - 1} onClick={() => Edit.Move(1)}><Glyph Name="up" Size={15} /></button>
          <button aria-label="Move layer down" title="Move down the stack" disabled={Index <= 0} onClick={() => Edit.Move(-1)}><Glyph Name="down" Size={15} /></button>
          <button aria-label="Duplicate layer" title="Duplicate" onClick={() => Edit.Duplicate()}><Glyph Name="duplicate" Size={15} /></button>
          <button aria-label="Delete layer" title="Delete (Del)" onClick={() => Edit.Remove()}><Glyph Name="trash" Size={15} /></button>
        </div>
      </header>
      <div className="inspector-scroll" key={Layer.Id}>
        <Card Title="Layer">
          <label className="field">
            <span>Name</span>
            <input aria-label="Layer name" value={Layer.Name} onChange={(Event) => Edit.LayerPatch({ Name: Event.target.value }, "name:" + Layer.Id)} />
          </label>
          <Control Field={{ Label: "Enabled", Control: "Switch" }} Current={Layer.Enabled} Change={(Value) => Edit.LayerPatch({ Enabled: Value }, "")} />
          <Control Field={{ Label: "Opacity", Control: "Slider", Minimum: 0, Maximum: 1, Default: 1, Decimals: 2 }} Current={Layer.Opacity} Change={(Value) => Edit.LayerPatch({ Opacity: Value }, "opacity:" + Layer.Id)} />
          <Control Field={{ Label: "Combine", Control: "Select", Options: Combines, Default: "Normal" }} Current={Layer.Combine} Change={(Value) => Edit.LayerPatch({ Combine: Value }, "")} />
          <p className="combine-help">{CombineHelp[Layer.Combine]}</p>
          <Control Field={{ Key: "Seed", Label: "Seed", Control: "Slider", Minimum: 0, Maximum: 999, Default: 1, Decimals: 0 }} Current={Layer.Seed} Change={(Value) => Edit.LayerPatch({ Seed: Value }, "seed:" + Layer.Id)} />
          {Operation && (
            <dl className="result-list">
              <Metric Label="Operation" Value={Operation.Name} />
              <Metric Label="Gaea family" Value={Operation.Gaea} />
            </dl>
          )}
        </Card>

        {Deferred ? (
          <Card Title="Status" Accent="#c9a86a">
            <p className="muted">Voxel cliffs are deferred. This slot keeps the voxel representation in the stack without changing the heightfield yet. The heightfield remains the first priority.</p>
          </Card>
        ) : (
          <Card Title="Parameters">
            {Operation && Operation.Parameters.map((Field) => (
              <Control key={Field.Key} Field={Field} Current={Layer.Parameters[Field.Key]} Change={(Value) => Edit.Parameter(Field.Key, Value)} />
            ))}
            {Operation && Operation.Parameters.length === 0 && <p className="muted">No parameters.</p>}
          </Card>
        )}

        <Card Title="Masks" Wide>
          <MaskAdder OnAdd={Edit.AddMask} />
          {Layer.Masks.length === 0 && <p className="muted">No masks. This layer applies everywhere it is enabled.</p>}
          {Layer.Masks.map((Mask) => (
            <MaskEntry key={Mask.Id} Mask={Mask} Edit={Edit} />
          ))}
        </Card>

        {Report && (
          <Card Title="Result">
            <dl className="result-list">
              <Metric Label="Time" Value={Report.Skipped ? "Skipped" : Report.Cached ? "Cached" : `${Math.round(Report.Milliseconds)} ms`} />
              {Report.MinimumHeight !== undefined && <Metric Label="Height" Value={`${Math.round(Report.MinimumHeight)}–${Math.round(Report.MaximumHeight)} m`} />}
              {Report.ChangedShare !== undefined && <Metric Label="Changed" Value={`${(100 * Report.ChangedShare).toFixed(1)}% of cells`} />}
              {Report.Carved !== undefined && <Metric Label="Channel cells" Value={String(Report.Carved)} />}
              {Report.WaterShare !== undefined && <Metric Label="Water" Value={`${(100 * Report.WaterShare).toFixed(2)}%`} />}
            </dl>
          </Card>
        )}
      </div>
    </>
  );
}
