// Terrain host: owns the stack, the undo history, the selection and the
// evaluation worker, and lays out the Frontier three-dock workspace.
import React, { useEffect, useRef, useState } from "react";
import { CreateIdentifier, CreateLayer, CreateMask, CreatePreset, StackPresetNames } from "./engine/PresetSpecification.js";
import { ColourSamples, EncodePng, HeightSamples, UnitSamples } from "./engine/ImageCodec.js";
import Glyph from "./ui/Glyph.jsx";
import OutlinerPanel from "./ui/OutlinerPanel.jsx";
import InspectorPanel from "./ui/InspectorPanel.jsx";
import ViewportPanel from "./ui/ViewportPanel.jsx";
import ConstructPanel from "./ui/ConstructPanel.jsx";

const StorageKey = "Frontier.TerrainEditor.v1";
const HistoryLimit = 80;

function ReadSavedStack() {
  try {
    const Saved = JSON.parse(window.localStorage.getItem(StorageKey) || "null");
    if (Saved && Saved.Format === "frontier-terrain-stack" && Array.isArray(Saved.Terrain)) return Saved;
  } catch (Problem) {
    // Unreadable storage falls back to the starter preset.
  }
  return CreatePreset("Ridge country");
}

function FindLayer(Stack, LayerId) {
  if (!LayerId) return null;
  for (const Kind of ["Terrain", "Texture"]) {
    const Index = Stack[Kind].findIndex((Entry) => Entry.Id === LayerId);
    if (Index >= 0) return { Kind, Index, Layer: Stack[Kind][Index] };
  }
  return null;
}

function Download(FileName, Blob) {
  const Url = URL.createObjectURL(Blob);
  const Anchor = document.createElement("a");
  Anchor.href = Url;
  Anchor.download = FileName;
  document.body.appendChild(Anchor);
  Anchor.click();
  Anchor.remove();
  setTimeout(() => URL.revokeObjectURL(Url), 1000);
}

export default function TerrainHost() {
  const [Stack, SetStack] = useState(ReadSavedStack);
  const [History, SetHistory] = useState({ Past: [], Future: [] });
  const [Selection, SetSelection] = useState({ Kind: "Heightfield", Id: null });
  const [ViewMode, SetViewMode] = useState("3D");
  const [Exaggeration, SetExaggeration] = useState(1);
  const [Snapshot, SetSnapshot] = useState(null);
  const [Busy, SetBusy] = useState(false);
  const [Progress, SetProgress] = useState(null);
  const [Failure, SetFailure] = useState(null);
  const [Construct, SetConstruct] = useState(null);
  const [PresetMenu, SetPresetMenu] = useState(false);
  const [Widths, SetWidths] = useState({ Left: 316, Right: 340 });
  const [ResetToken, SetResetToken] = useState(0);
  const WorkerRef = useRef(null);
  const RequestRef = useRef(0);
  const LastEditRef = useRef({ Label: "", Time: 0 });
  const DividerRef = useRef(null);

  const Found = FindLayer(Stack, Selection.Id);
  const PreviewTarget = (ViewMode === "Mask" || ViewMode === "Effect") && Found ? { Stack: Found.Kind, Id: Found.Layer.Id } : null;
  const PreviewKey = PreviewTarget ? `${PreviewTarget.Stack}:${PreviewTarget.Id}` : "";

  useEffect(() => {
    const Evaluator = new Worker(new URL("./workers/TerrainWorker.js", import.meta.url), { type: "module" });
    WorkerRef.current = Evaluator;
    Evaluator.onmessage = (Event) => {
      const Message = Event.data;
      if (Message.Id !== RequestRef.current) return;
      if (Message.Progress) {
        SetProgress(Message.Progress);
        return;
      }
      SetBusy(false);
      SetProgress(null);
      if (!Message.Ok) {
        SetFailure(Message.Message);
        return;
      }
      SetFailure(null);
      SetSnapshot(Message);
    };
    return () => Evaluator.terminate();
  }, []);

  useEffect(() => {
    const Timer = setTimeout(() => {
      const Id = RequestRef.current + 1;
      RequestRef.current = Id;
      SetBusy(true);
      WorkerRef.current.postMessage({ Id, Stack, Preview: PreviewTarget });
    }, 140);
    return () => clearTimeout(Timer);
  }, [Stack, PreviewKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(StorageKey, JSON.stringify(Stack));
    } catch (Problem) {
      // Storage can be full or disabled; the session still works.
    }
  }, [Stack]);

  useEffect(() => {
    const Move = (Event) => {
      const Drag = DividerRef.current;
      if (!Drag) return;
      const Delta = Event.clientX - Drag.Start;
      SetWidths((Previous) => ({
        ...Previous,
        [Drag.Side]: Math.min(520, Math.max(240, Drag.Width + (Drag.Side === "Left" ? Delta : -Delta))),
      }));
    };
    const Release = () => {
      if (!DividerRef.current) return;
      DividerRef.current = null;
      document.body.classList.remove("resizing");
    };
    window.addEventListener("pointermove", Move);
    window.addEventListener("pointerup", Release);
    return () => {
      window.removeEventListener("pointermove", Move);
      window.removeEventListener("pointerup", Release);
    };
  }, []);

  function StartDivide(Side, Event) {
    DividerRef.current = { Side, Start: Event.clientX, Width: Widths[Side] };
    document.body.classList.add("resizing");
  }

  // Edits made within 900 ms on the same label merge into one undo step (a slider drag).
  function Commit(NextStack, Label = "") {
    const Now = Date.now();
    const Last = LastEditRef.current;
    const Merge = Label && Last.Label === Label && Now - Last.Time < 900;
    LastEditRef.current = { Label, Time: Now };
    if (!Merge) SetHistory((Previous) => ({ Past: [...Previous.Past, Stack].slice(-HistoryLimit), Future: [] }));
    SetStack(NextStack);
  }

  function Undo() {
    if (!History.Past.length) return;
    const Target = History.Past[History.Past.length - 1];
    SetHistory({ Past: History.Past.slice(0, -1), Future: [Stack, ...History.Future].slice(0, HistoryLimit) });
    SetStack(Target);
    LastEditRef.current = { Label: "", Time: 0 };
  }

  function Redo() {
    if (!History.Future.length) return;
    const [Target, ...Rest] = History.Future;
    SetHistory({ Past: [...History.Past, Stack].slice(-HistoryLimit), Future: Rest });
    SetStack(Target);
    LastEditRef.current = { Label: "", Time: 0 };
  }

  function ReplaceLayer(Current, Kind, Index, Next) {
    return { ...Current, [Kind]: Current[Kind].map((Entry, Slot) => (Slot === Index ? Next : Entry)) };
  }

  function EditSelected(Mutate, Label) {
    if (!Found) return;
    Commit(ReplaceLayer(Stack, Found.Kind, Found.Index, Mutate(Found.Layer)), Label);
  }

  const Edit = {
    LayerPatch: (Patch, Label) => EditSelected((Layer) => ({ ...Layer, ...Patch }), Label),
    Parameter: (Key, Value) => EditSelected((Layer) => ({ ...Layer, Parameters: { ...Layer.Parameters, [Key]: Value } }), `param:${Selection.Id}:${Key}`),
    Mask: (MaskId, Patch, Label) => EditSelected((Layer) => ({
      ...Layer,
      Masks: Layer.Masks.map((Mask) => (Mask.Id === MaskId ? { ...Mask, ...Patch } : Mask)),
    }), Label),
    MaskParameter: (MaskId, Key, Value) => EditSelected((Layer) => ({
      ...Layer,
      Masks: Layer.Masks.map((Mask) => (Mask.Id === MaskId ? { ...Mask, Parameters: { ...Mask.Parameters, [Key]: Value } } : Mask)),
    }), `mask:${MaskId}:${Key}`),
    AddMask: (MethodId) => EditSelected((Layer) => ({
      ...Layer,
      Masks: [...Layer.Masks, CreateMask(MethodId, { Seed: Layer.Seed + Layer.Masks.length + 1 })],
    }), ""),
    RemoveMask: (MaskId) => EditSelected((Layer) => ({ ...Layer, Masks: Layer.Masks.filter((Mask) => Mask.Id !== MaskId) }), ""),
    Heightfield: (Patch, Label) => Commit({ ...Stack, Heightfield: { ...Stack.Heightfield, ...Patch } }, Label),
    Move: (Delta) => {
      if (!Found) return;
      const List = [...Stack[Found.Kind]];
      const Target = Found.Index + Delta;
      if (Target < 0 || Target >= List.length) return;
      [List[Found.Index], List[Target]] = [List[Target], List[Found.Index]];
      Commit({ ...Stack, [Found.Kind]: List }, "");
    },
    Duplicate: () => {
      if (!Found) return;
      const Copy = {
        ...Found.Layer,
        Id: CreateIdentifier("layer"),
        Name: `${Found.Layer.Name} copy`,
        Masks: Found.Layer.Masks.map((Mask) => ({ ...Mask, Id: CreateIdentifier("mask") })),
      };
      const List = [...Stack[Found.Kind]];
      List.splice(Found.Index + 1, 0, Copy);
      Commit({ ...Stack, [Found.Kind]: List }, "");
      SetSelection({ Kind: Found.Kind, Id: Copy.Id });
    },
    Remove: () => {
      if (!Found) return;
      const List = Stack[Found.Kind].filter((Entry) => Entry.Id !== Found.Layer.Id);
      Commit({ ...Stack, [Found.Kind]: List }, "");
      const Neighbour = List[Math.min(Found.Index, List.length - 1)];
      SetSelection({ Kind: Found.Kind, Id: Neighbour ? Neighbour.Id : null });
    },
  };

  function ToggleLayer(LayerId) {
    const Where = FindLayer(Stack, LayerId);
    if (!Where) return;
    Commit(ReplaceLayer(Stack, Where.Kind, Where.Index, { ...Where.Layer, Enabled: !Where.Layer.Enabled }), "");
  }

  function AddLayer(Kind, OperationId) {
    const Layer = CreateLayer(Kind, OperationId);
    const Existing = Stack[Kind];
    const Insert = Found && Found.Kind === Kind ? Found.Index + 1 : Existing.length;
    const Next = [...Existing.slice(0, Insert), Layer, ...Existing.slice(Insert)];
    Commit({ ...Stack, [Kind]: Next }, "");
    SetSelection({ Kind, Id: Layer.Id });
    SetConstruct(null);
  }

  function MoveLayerOnto(Kind, SourceId, TargetId) {
    const List = [...Stack[Kind]];
    const From = List.findIndex((Entry) => Entry.Id === SourceId);
    const To = List.findIndex((Entry) => Entry.Id === TargetId);
    if (From < 0 || To < 0 || From === To) return;
    const [Moved] = List.splice(From, 1);
    List.splice(To, 0, Moved);
    Commit({ ...Stack, [Kind]: List }, "");
  }

  function LoadPreset(Name) {
    Commit(CreatePreset(Name), "");
    SetSelection({ Kind: "Heightfield", Id: null });
    SetPresetMenu(false);
  }

  function ExportHeightfield() {
    if (!Snapshot) return;
    const Bytes = EncodePng(Snapshot.N, Snapshot.N, HeightSamples(Snapshot.Height, Snapshot.Stats.MinimumHeight, Snapshot.Stats.MaximumHeight), 1, 16);
    Download(`heightfield-${Snapshot.N}-16bit.png`, new Blob([Bytes], { type: "image/png" }));
  }

  function ExportTexture() {
    if (!Snapshot) return;
    const Bytes = EncodePng(Snapshot.N, Snapshot.N, ColourSamples(Snapshot.Colour), 3, 8);
    Download(`texture-${Snapshot.N}.png`, new Blob([Bytes], { type: "image/png" }));
  }

  function ExportWater() {
    if (!Snapshot) return;
    const Mask = UnitSamples(Snapshot.WaterSource.map((Source) => (Source ? 1 : 0)));
    Download(`water-mask-${Snapshot.N}.png`, new Blob([EncodePng(Snapshot.N, Snapshot.N, Mask, 1, 8)], { type: "image/png" }));
  }

  function SaveStack() {
    Download(`${Stack.Name.replace(/\s+/g, "-").toLowerCase()}.terrain.json`, new Blob([JSON.stringify(Stack, null, 2)], { type: "application/json" }));
  }

  function OpenStack(Event) {
    const File = Event.target.files && Event.target.files[0];
    Event.target.value = "";
    if (!File) return;
    File.text()
      .then((Text) => {
        const Parsed = JSON.parse(Text);
        if (Parsed.Format !== "frontier-terrain-stack") throw new Error("This file is not a terrain stack.");
        Commit(Parsed, "");
        SetSelection({ Kind: "Heightfield", Id: null });
      })
      .catch((Problem) => SetFailure(String(Problem.message || Problem)));
  }

  useEffect(() => {
    const OnKey = (Event) => {
      const Typing = Event.target && Event.target.closest && Event.target.closest("input, textarea, select");
      const Modifier = Event.ctrlKey || Event.metaKey;
      if (Modifier && !Typing && Event.key.toLowerCase() === "z") {
        Event.preventDefault();
        if (Event.shiftKey) Redo();
        else Undo();
      } else if (Modifier && !Typing && Event.key.toLowerCase() === "y") {
        Event.preventDefault();
        Redo();
      } else if ((Event.key === "Delete" || Event.key === "Backspace") && !Typing && Found) {
        Event.preventDefault();
        Edit.Remove();
      }
    };
    window.addEventListener("keydown", OnKey);
    return () => window.removeEventListener("keydown", OnKey);
  });

  const Heading = Selection.Kind === "Heightfield" || !Found ? `${Stack.Name}` : Found.Layer.Name;
  const Blurb = Selection.Kind === "Heightfield" || !Found
    ? `${Stack.Heightfield.Size} m · ${Stack.Heightfield.Resolution}² cells`
    : `${Found.Kind === "Texture" ? "Texturing" : "Terrain"} layer · ${Found.Index + 1} of ${Stack[Found.Kind].length}`;

  return (
    <>
      <main className="workspace" style={{ "--left": Widths.Left + "px", "--right": Widths.Right + "px" }}>
        <section className="dock left" aria-label="Left editor dock">
          <div className="tab-strip" role="tablist">
            <button className="document-tab active" role="tab" aria-selected="true">Outliner</button>
          </div>
          <OutlinerPanel
            Stack={Stack}
            Selection={Selection}
            OnSelect={(Kind, Id) => SetSelection({ Kind, Id })}
            OnToggle={ToggleLayer}
            OnDrop={MoveLayerOnto}
            OnConstruct={(Kind) => SetConstruct(Kind)}
            Snapshot={Snapshot}
            Busy={Busy}
            Progress={Progress}
            Failure={Failure}
          />
          <div className="divider left" role="separator" aria-orientation="vertical" aria-label="Resize outliner" onPointerDown={(Event) => StartDivide("Left", Event)} />
        </section>

        <section className="dock centre" aria-label="Viewport dock">
          <div className="tab-strip" role="tablist">
            <button className="document-tab active" role="tab" aria-selected="true">{Stack.Name}</button>
            <div className="tab-actions">
              <button aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!History.Past.length} onClick={Undo}><Glyph Name="undo" Size={15} /></button>
              <button aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!History.Future.length} onClick={Redo}><Glyph Name="redo" Size={15} /></button>
              <span className="tab-divider" aria-hidden="true" />
              <div className="preset-anchor">
                <button aria-label="Presets" aria-expanded={PresetMenu} onClick={() => SetPresetMenu(!PresetMenu)}><Glyph Name="preset" Size={15} /> Presets</button>
                {PresetMenu && (
                  <div className="preset-menu" role="menu">
                    {StackPresetNames.map((Name) => (
                      <button key={Name} role="menuitem" onClick={() => LoadPreset(Name)}>{Name}</button>
                    ))}
                  </div>
                )}
              </div>
              <button aria-label="Add layer" onClick={() => SetConstruct(Found ? Found.Kind : "Terrain")}><Glyph Name="plus" Size={15} /> Layer</button>
              <span className="tab-divider" aria-hidden="true" />
              <button aria-label="Export heightfield PNG" title="16-bit heightfield PNG" disabled={!Snapshot} onClick={ExportHeightfield}><Glyph Name="export" Size={15} /> Height</button>
              <button aria-label="Export texture PNG" title="Texture PNG" disabled={!Snapshot} onClick={ExportTexture}><Glyph Name="export" Size={15} /> Texture</button>
              <button aria-label="Export water mask PNG" title="Water mask PNG" disabled={!Snapshot} onClick={ExportWater}><Glyph Name="export" Size={15} /> Water</button>
              <button aria-label="Save stack" title="Save terrain stack (JSON)" onClick={SaveStack}><Glyph Name="duplicate" Size={15} /> Save</button>
              <label className="file-button" title="Open terrain stack (JSON)">
                <Glyph Name="upload" Size={15} /> Open
                <input type="file" accept="application/json,.json" aria-label="Open terrain stack" onChange={OpenStack} />
              </label>
            </div>
          </div>
          <ViewportPanel
            Snapshot={Snapshot}
            ViewMode={ViewMode}
            SetViewMode={SetViewMode}
            Exaggeration={Exaggeration}
            SetExaggeration={SetExaggeration}
            Busy={Busy}
            Progress={Progress}
            Failure={Failure}
            ResetToken={ResetToken}
            OnReset={() => SetResetToken((Count) => Count + 1)}
            Heading={Heading}
            Blurb={Blurb}
          />
        </section>

        <section className="dock right" aria-label="Inspector dock">
          <div className="tab-strip" role="tablist">
            <button className="document-tab active" role="tab" aria-selected="true">Inspector</button>
          </div>
          <InspectorPanel Stack={Stack} Selection={Selection} Found={Found} Snapshot={Snapshot} Edit={Edit} />
          <div className="divider right" role="separator" aria-orientation="vertical" aria-label="Resize inspector" onPointerDown={(Event) => StartDivide("Right", Event)} />
        </section>
      </main>
      {Construct && (
        <ConstructPanel
          Kind={Construct}
          SetKind={SetConstruct}
          OnAdd={(OperationId) => AddLayer(Construct, OperationId)}
          OnClose={() => SetConstruct(null)}
        />
      )}
    </>
  );
}
