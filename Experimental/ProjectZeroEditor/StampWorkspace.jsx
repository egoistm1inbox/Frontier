//============================================================================================================================================
//                                                              STAMPWORKSPACE.JSX
//============================================================================================================================================
// 🧩 The ShaderEditor's Stamp tab (Follow-up 71): the Texture Studio's Stamp studio, laid out again for the ShaderEditor window.
// Everything it does comes from the Texture Studio's stamp model (useStampStudioModel in TextureStudio/src/StampStudio.jsx): the 512 × 512
// composition with text, SVG, image and vector components, the G / R / S transforms, the vector canvas, masks, arrays, the 15 channel
// targets, the preset library and the exports. Only the arrangement is new:
//   • One bar on top: the stamp's name and status, Composition | Vector, undo and redo, a ⋯ menu and Press onto material.
//   • Under it, a toolbar across the top (Follow-up 72): the G / R / S transforms and the artwork to add — or, in Vector, the vector
//     canvas's own drawing tools — then the canvas size and the exports.
//   • The left rail shows Components or Presets. Components is drawn as the editor's Outliner (ArtworkOutliner.jsx); each row has its
//     eye and lock, and the order, duplicate and delete buttons sit in its footer.
//   • The canvas takes the middle.
//   • The inspector turns pages: Component, Targets (the channels the stamp writes and their amounts) and Place (where it lands on the
//     material, with a preview over the material's current colour).
// Press onto material composites the stamp into every targeted channel of the bound material (SurfaceTextures.js).

import React, { useEffect, useMemo, useState } from "react";
import {
  Type, Code2, ImagePlus, Plus, Copy, Trash2, LockKeyhole, UnlockKeyhole, ArrowUp, ArrowDown, Undo2, Redo2, Save,
  FolderOpen, Download, Move, RotateCw, Scaling, MoreHorizontal, Stamp, FilePlus2, X, LibraryBig, Layers3,
} from "lucide-react";
import ArtworkOutliner, { OutlinerHeading } from "./ArtworkOutliner.jsx";
import { useStampStudioModel, StampChannelControls, SVGMarkupEditor } from "../TextureStudio/src/StampStudio.jsx";
import ArtworkArrayControls from "../TextureStudio/src/ArtworkArrayControls.jsx";
import ArtworkMaskCanvas from "../TextureStudio/src/ArtworkMaskCanvas.jsx";
import ArtworkMaskStackRow from "../TextureStudio/src/ArtworkMaskStackRow.jsx";
import ArtworkMaskControls from "../TextureStudio/src/ArtworkMaskControls.jsx";
import { shapeTools, ArtworkAlignmentTools } from "../TextureStudio/src/ShapeEditorToolbar.jsx";
import StampVectorCanvas from "../TextureStudio/src/StampVectorCanvas.jsx";
import StampVectorProperties from "../TextureStudio/src/StampVectorProperties.jsx";
import { alignSelection } from "../TextureStudio/src/shapeEditorGeometry.js";
import { VectorPaintStyle, StampVectorCanvasDocument, StampDocumentFromVectorCanvas } from "../TextureStudio/src/StampVectorProjection.js";
import { StampVectorGeometry } from "../TextureStudio/src/VectorArtwork.js";
import { patternLayer } from "../TextureStudio/src/patternDocument.js";
import AuthoringNameField from "../TextureStudio/src/AuthoringNameField.jsx";
import StampRichTextEditor from "../TextureStudio/src/StampRichTextEditor.jsx";
import { Slider } from "../TextureStudio/src/MaterialControls.jsx";
import { composeStampSVG, outlineStampText } from "../TextureStudio/src/stampRaster.js";
import { STAMP_LAYER_LIMIT, createStampDocument, removeStampPreset, stampId } from "../TextureStudio/src/stampDocument.js";
import { PageStrip, PageTurn, PageLook } from "./PageCarousel.jsx";
import { Popover } from "./PatternWorkspace.jsx";
import { RestingPlacement, StampTargets, ChannelCanvas } from "./SurfaceTextures.js";
import "./SurfaceWorkspaces.css";

const GlyphOf = (Layer) => (Layer.kind === "vector" ? shapeTools.find(([Shape]) => Shape === Layer.vector.kind)?.[3] || Code2 : Layer.kind === "text" ? Type : Layer.kind === "svg" ? Code2 : ImagePlus);
const Pages = [
  { Id: "component", Label: "Component" },
  { Id: "targets", Label: "Targets" },
  { Id: "place", Label: "Place" },
];
const Shapes = [
  ["rect", "Rectangle"],
  ["ellipse", "Ellipse"],
  ["triangle", "Triangle"],
  ["diamond", "Diamond"],
  ["polygon", "Polygon"],
  ["star", "Star"],
];

export default function StampWorkspace({ Material, Owner, Press }) {
  const [Placement, Place] = useState(RestingPlacement);
  const [Pressing, Busy] = useState(false), [Pressed, Report] = useState("");
  // Press onto material: the model saves the stamp as a preset first (as Use in Texture does), then hands it here.
  const Model = useStampStudioModel({
    onUse: async (Preset) => {
      Busy(true);
      try {
        const { svg } = await composeStampSVG(Preset.project);
        const Targets = await Press(Preset.project, svg, Placement);
        Report(Targets.length ? `Pressed into ${Targets.join(", ")}` : "No channel targets — enable some under Targets");
        setTimeout(() => Report(""), 3600);
      } catch (Failure) {
        Model.setError(Failure.message);
      } finally {
        Busy(false);
      }
    },
  });
  const {
    doc, VectorMode, ConfigureVectorMode, ComponentQuery, ConfigureComponentQuery, ComponentFilter, ConfigureComponentFilter,
    CanvasAppearance, ConfigureCanvasAppearance, ComponentMatches, VectorSelection, VectorCanvas, DrawingPaint, current, selectedId,
    MaskIdentity, ConfigureMaskIdentity, undo, redo, revision, error, setError, status, presets, preview, fontWarning, transform, board,
    input, busy, selected, MaskActive, InspectorTarget, ConfigureInspectorTarget, ArrayProjection, previewDoc, shown, commit, patchLayer,
    ApplyVectorPaint, choose, travel, add, pickFile, importFile, savePreset, exportArtwork,
  } = Model;
  const [Rail, ShowRail] = useState("components");
  const [Page, TurnTo] = useState(0);
  const Motion = PageTurn(Page);
  const Turn = (At) => {
    Motion.Turn(At);
    TurnTo(At);
  };
  // The material's colour as it is now, under the placement preview.
  const [Ground, ShowGround] = useState("");
  useEffect(() => {
    let Live = true;
    if (Pages[Page].Id === "place")
      ChannelCanvas(Material, "colour", 256)
        .then((Canvas) => Live && ShowGround(Canvas.toDataURL()))
        .catch(() => {});
    return () => {
      Live = false;
    };
  }, [Material, Page]);
  const Finished = () => !(VectorCanvas.current && !VectorCanvas.current.prepareExport());
  const Reorder = (Layer, Step) => {
    const Layers = [...doc.layers], At = Layers.indexOf(Layer);
    if (At + Step < 0 || At + Step >= Layers.length) return;
    [Layers[At + Step], Layers[At]] = [Layers[At], Layers[At + Step]];
    commit({ ...doc, layers: Layers });
  };
  const Unmapped = doc.channels.filter((Id) => !StampTargets[Id]);
  const AddShape = (Shape, Caption) => {
    transform.cancel();
    ConfigureVectorMode(true);
    add("vector", { name: Caption, vector: patternLayer(Shape, DrawingPaint) });
  };
  const [ToolSlot, PlaceToolSlot] = useState(null);

  // ── Left rail: the components, drawn as the editor's Outliner (ArtworkOutliner.jsx) ───────────────────────────────────────────────
  const SetComponents = (Id, Change) => commit({ ...doc, layers: doc.layers.map((Each) => (Each.id === Id ? Change(Each) : Each)) });
  const ComponentRows = ComponentMatches.map((Layer) => {
    const Glyph = GlyphOf(Layer);
    return {
      Id: Layer.id,
      Name: Layer.name,
      Label: `stamp component ${Layer.name}`,
      Detail: `${Layer.kind} · ${Math.round(Layer.opacity * 100)}%${Layer.mask ? " · masked" : ""}`,
      Picture: (
        <span className="ao-glyph">
          <Glyph size={14} />
        </span>
      ),
      Chosen: !MaskActive && (VectorMode ? VectorSelection.includes(Layer.id) : selectedId === Layer.id),
      Hidden: !Layer.visible,
      Locked: Layer.locked,
      Pick: (Event) => {
        const Adding = Event.ctrlKey || Event.metaKey || Event.shiftKey;
        if (Adding) {
          transform.cancel();
          ConfigureVectorMode(true);
        }
        const IDs = Adding ? (VectorSelection.includes(Layer.id) ? VectorSelection.filter((Each) => Each !== Layer.id) : [...VectorSelection, Layer.id]) : [Layer.id];
        choose(IDs.at(-1), IDs);
      },
      Show: () => {
        choose(Layer.id);
        SetComponents(Layer.id, (Each) => ({ ...Each, visible: !Each.visible }));
      },
      Lock: () => SetComponents(Layer.id, (Each) => ({ ...Each, locked: !Each.locked })),
      Below: Layer.mask ? (
        <ArtworkMaskStackRow
          Mask={Layer.mask}
          Name={Layer.name}
          Selected={MaskActive && MaskIdentity === Layer.id}
          Locked={Layer.locked}
          OnSelect={() => {
            if (!Finished()) return;
            choose(Layer.id);
            ConfigureMaskIdentity(Layer.id);
          }}
          OnChange={(Mask) => {
            if (!Layer.locked) commit({ ...current.current, layers: current.current.layers.map((Entry) => (Entry.id === Layer.id ? { ...Entry, mask: Mask } : Entry)) });
          }}
        />
      ) : null,
    };
  });
  const Components = (
    <ArtworkOutliner
      Title="Components"
      Detail={`${doc.layers.length}/${STAMP_LAYER_LIMIT} · ${doc.channels.length} targets`}
      Label="Stamp components"
      Actions={
        <>
          <Popover Label="Add stamp component" Glyph={<Plus size={15} />} Align="side" Disabled={doc.layers.length >= STAMP_LAYER_LIMIT}>
            <span className="sfw-menu-title">Artwork</span>
            <button data-closes onClick={() => add("text")}>
              <Type size={13} /> Text
            </button>
            <button data-closes onClick={() => add("svg")}>
              <Code2 size={13} /> SVG markup
            </button>
            <button data-closes onClick={() => pickFile("svg")}>
              <FolderOpen size={13} /> Import SVG…
            </button>
            <button data-closes onClick={() => pickFile("image")}>
              <ImagePlus size={13} /> Image…
            </button>
            <span className="sfw-menu-title">Vector shapes</span>
            <div className="sfw-menu-grid">
              {Shapes.map(([Shape, Caption]) => {
                const Glyph = shapeTools.find(([Each]) => Each === Shape)?.[3] || Code2;
                return (
                  <button key={Shape} data-closes onClick={() => AddShape(Shape, Caption)}>
                    <Glyph size={13} /> {Caption}
                  </button>
                );
              })}
            </div>
          </Popover>
          <button type="button" className="ao-round" aria-label="Show the stamp presets" title="Stamp presets" onClick={() => ShowRail("presets")}>
            <LibraryBig size={15} />
          </button>
        </>
      }
      Visible={doc.layers.filter((Layer) => Layer.visible).length}
      Hidden={doc.layers.filter((Layer) => !Layer.visible).length}
      ShowAll={() => commit({ ...doc, layers: doc.layers.map((Layer) => (Layer.visible ? Layer : { ...Layer, visible: true })) })}
      HideAll={() => commit({ ...doc, layers: doc.layers.map((Layer) => (Layer.locked || !Layer.visible ? Layer : { ...Layer, visible: false })) })}
      Query={ComponentQuery}
      Search={ConfigureComponentQuery}
      Filter={ComponentFilter}
      Sift={ConfigureComponentFilter}
      Rows={ComponentRows}
      Empty={
        doc.layers.length ? (
          <>
            No matching components.{" "}
            <button className="sfw-link" onClick={() => (ConfigureComponentQuery(""), ConfigureComponentFilter("all"))}>
              Clear filters
            </button>
          </>
        ) : (
          "No components yet. Add artwork with +."
        )
      }
      Footer={
        <>
          <span>
            <small>COMPONENTS</small>
            <b>
              {doc.layers.length} / {STAMP_LAYER_LIMIT}
            </b>
          </span>
          <span className="ao-footer-actions" role="toolbar" aria-label="Component order">
            <button aria-label="Move stamp component up" title="Bring forward" disabled={!selected || selected.locked || doc.layers.indexOf(selected) === 0} onClick={() => Reorder(selected, -1)}>
              <ArrowUp size={13} />
            </button>
            <button aria-label="Move stamp component down" title="Send backward" disabled={!selected || selected.locked || doc.layers.indexOf(selected) === doc.layers.length - 1} onClick={() => Reorder(selected, 1)}>
              <ArrowDown size={13} />
            </button>
            <button
              aria-label="Duplicate stamp component"
              title="Duplicate"
              disabled={!selected || selected.locked || doc.layers.length >= STAMP_LAYER_LIMIT}
              onClick={() => add(selected.kind, { ...selected, id: stampId(), name: `${selected.name} copy`, x: selected.x + 12, y: selected.y + 12 })}
            >
              <Copy size={13} />
            </button>
            <button
              aria-label="Delete stamp component"
              title="Delete"
              disabled={!selected || selected.locked}
              onClick={() => {
                const Layers = doc.layers.filter((Each) => Each.id !== selectedId);
                commit({ ...doc, layers: Layers }, null, Layers[0]?.id);
              }}
            >
              <Trash2 size={13} />
            </button>
          </span>
        </>
      }
    />
  );
  const Presets = (
    <div className="sfw-rail-body">
      <button className="sfw-wide" disabled={busy} onClick={() => savePreset()} aria-label="Save stamp preset">
        <Save size={13} /> Save this stamp as a preset
      </button>
      <div className="sfw-presets">
        {presets.length ? (
          presets.map((Preset) => (
            <div className="sfw-preset" key={Preset.id}>
              <button aria-label={`Open stamp preset ${Preset.name}`} onClick={() => commit(Preset.project, null, Preset.project.layers[0]?.id)}>
                <img src={Preset.raster.dataUrl} alt="" />
                <span>
                  <b>{Preset.name}</b>
                  <small>
                    {Preset.project.layers.length} components · {Preset.project.channels.length} targets
                  </small>
                </span>
              </button>
              <button
                className="sfw-layer-toggle"
                aria-label={`Delete stamp preset ${Preset.name}`}
                title="Remove from the library; materials keep what was pressed into them"
                onClick={() => {
                  try {
                    removeStampPreset(Preset.id);
                  } catch (Failure) {
                    setError(Failure.message);
                  }
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))
        ) : (
          <p className="sfw-hint">Saved stamps appear here and are shared with the Texture Studio.</p>
        )}
      </div>
    </div>
  );

  // ── Inspector pages ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const ComponentPage = (
    <>
      <section className="sfw-card">
        <header>
          <b>Stamp</b>
          <small>{doc.layers.length} components</small>
        </header>
        <label className="sfw-column">
          Name
          <AuthoringNameField ariaLabel="Stamp name" value={doc.name} onChange={(Name) => commit({ ...current.current, name: Name }, "stamp-name")} />
        </label>
      </section>
      {!VectorMode && !MaskActive && selected && (
        <section className="sfw-card">
          <header>
            <b>Align to canvas</b>
          </header>
          <div className="sfw-align">
            {ArtworkAlignmentTools.map(([Alignment, Caption, Glyph]) => (
              <button
                key={Alignment}
                title={Caption}
                aria-label={Caption}
                disabled={selected.locked || !selected.visible}
                onClick={() => {
                  const Projection = StampVectorCanvasDocument(current.current), Index = Projection.layers.findIndex((Layer) => Layer.id === selected.id);
                  const Next = StampDocumentFromVectorCanvas(alignSelection(Projection, [Index], Alignment), current.current, [Index]);
                  commit(Next.Document, null, Next.SelectedIDs[0], Next.SelectedIDs);
                }}
              >
                <Glyph size={14} />
              </button>
            ))}
          </div>
        </section>
      )}
      {!MaskActive && <div ref={ConfigureInspectorTarget} className="artwork-selection-inspector" />}
      {VectorSelection.length > 1 && VectorMode && (
        <section className="sfw-card">
          <header>
            <b>{VectorSelection.length} selected</b>
            <small>Shared edits reach every unlocked component</small>
          </header>
          <label className="sfw-row">
            Opacity
            <input
              aria-label="Selection opacity"
              type="number"
              min="0"
              max="1"
              step=".05"
              placeholder="Mixed"
              value={doc.layers.filter((Layer) => VectorSelection.includes(Layer.id)).every((Layer) => Layer.opacity === selected?.opacity) ? selected?.opacity ?? "" : ""}
              onChange={(Event) => {
                if (Event.target.value === "") return;
                commit({ ...current.current, layers: current.current.layers.map((Layer) => (VectorSelection.includes(Layer.id) && !Layer.locked ? { ...Layer, opacity: Math.max(0, Math.min(1, Number(Event.target.value))) } : Layer)) }, null, selectedId, VectorSelection);
              }}
            />
          </label>
        </section>
      )}
      {(VectorMode || selected?.kind === "vector") && (VectorSelection.length <= 1 || doc.layers.some((Layer) => VectorSelection.includes(Layer.id) && Layer.kind === "vector")) && (
        <StampVectorProperties
          key={VectorSelection.length > 1 ? "multiple-selection" : selected?.kind === "vector" ? selected.id : "drawing-defaults"}
          Geometry={
            selected?.kind === "vector"
              ? StampVectorGeometry(selected)
              : VectorSelection.length > 1 && doc.layers.some((Layer) => VectorSelection.includes(Layer.id) && Layer.kind === "vector")
                ? StampVectorGeometry(doc.layers.find((Layer) => VectorSelection.includes(Layer.id) && Layer.kind === "vector"))
                : DrawingPaint
          }
          Disabled={selected?.kind === "vector" && selected.locked}
          Drawing={selected?.kind !== "vector"}
          OnChange={ApplyVectorPaint}
        />
      )}
      {selected && !(VectorMode && VectorSelection.length > 1) && (
        <section className="sfw-card">
          <header>
            <AuthoringNameField ariaLabel="Stamp component name" disabled={selected.locked} value={selected.name} onChange={(Name) => patchLayer({ name: Name }, "name")} />
            <button className={"sfw-layer-toggle" + (selected.locked ? " on" : "")} aria-label={selected.locked ? "Unlock stamp component" : "Lock stamp component"} onClick={() => patchLayer({ locked: !selected.locked })}>
              {selected.locked ? <LockKeyhole size={13} /> : <UnlockKeyhole size={13} />}
            </button>
          </header>
          {selected.kind === "text" && (
            <StampRichTextEditor
              key={selected.id}
              runs={selected.runs}
              disabled={selected.locked}
              onChange={(Runs, Meta) => {
                try {
                  if (JSON.stringify(Runs) === JSON.stringify(selected.runs)) return false;
                  const Before = outlineStampText(selected.runs), After = outlineStampText(Runs);
                  return patchLayer(
                    { runs: Runs, width: selected.width * (After.width / Math.max(1, Before.width)), height: selected.height * (After.height / Math.max(1, Before.height)) },
                    Meta?.key ? `rich-text-${Meta.key}` : null,
                  );
                } catch (Failure) {
                  setError(Failure.message);
                  return false;
                }
              }}
            />
          )}
          {selected.kind === "svg" && <SVGMarkupEditor key={selected.id} layer={selected} onChange={(Svg) => patchLayer({ svg: Svg })} onImport={() => pickFile("svg")} />}
          {selected.kind === "image" && (
            <div className="sfw-image-source">
              <img src={selected.image.dataUrl} alt={selected.image.name} />
              <button disabled={selected.locked} onClick={() => pickFile("image")}>
                <ImagePlus size={13} /> Replace image
              </button>
            </div>
          )}
          <div className="sfw-sliders">
            <Slider label="Position X" ariaLabel="Stamp position X" min={-512} max={1024} step={1} value={shown.x} disabled={selected.locked} onChange={(X) => patchLayer({ x: X }, "x")} />
            <Slider label="Position Y" ariaLabel="Stamp position Y" min={-512} max={1024} step={1} value={shown.y} disabled={selected.locked} onChange={(Y) => patchLayer({ y: Y }, "y")} />
            <Slider label="Width" ariaLabel="Stamp width" min={1} max={1024} step={1} value={shown.width} disabled={selected.locked} onChange={(Width) => patchLayer({ width: Width }, "width")} />
            <Slider label="Height" ariaLabel="Stamp height" min={1} max={1024} step={1} value={shown.height} disabled={selected.locked} onChange={(Height) => patchLayer({ height: Height }, "height")} />
            <Slider label="Rotation" ariaLabel="Stamp rotation" min={-360} max={360} step={1} unit="°" value={shown.rotation} disabled={selected.locked} onChange={(Rotation) => patchLayer({ rotation: Rotation }, "rotation")} />
            <Slider label="Opacity" ariaLabel="Stamp component opacity" percentage value={selected.opacity} disabled={selected.locked} onChange={(Opacity) => patchLayer({ opacity: Opacity }, "opacity")} />
          </div>
        </section>
      )}
      {selected && VectorSelection.length <= 1 && (
        <fieldset className="sfw-fieldset" disabled={selected.locked}>
          <ArtworkMaskControls
            Mask={selected.mask}
            Editing={MaskActive}
            OnEdit={() => {
              if (!Finished()) return;
              transform.cancel();
              ConfigureMaskIdentity(selected.id);
            }}
            OnChange={(Mask) => patchLayer({ mask: Mask })}
            OnError={setError}
          />
        </fieldset>
      )}
      {!MaskActive && selected && (
        <ArtworkArrayControls
          Document={ArrayProjection}
          Selection={ArrayProjection.layers.flatMap((Layer, Index) => ((VectorMode ? VectorSelection : [selectedId]).includes(Layer.id) ? [Index] : []))}
          Limit={STAMP_LAYER_LIMIT}
          OnError={setError}
          OnFinalize={(Next, Indices) => {
            const Converted = StampDocumentFromVectorCanvas(Next, current.current, Indices);
            if (commit(Converted.Document, null, Converted.SelectedIDs.at(-1), Converted.SelectedIDs)) ConfigureVectorMode(true);
          }}
        />
      )}
      {!selected && <p className="sfw-hint sfw-card">Select a component on the canvas or in the list, or add one with +.</p>}
    </>
  );
  const TargetsPage = (
    <>
      <div className="sfw-card sfw-targets">
        <StampChannelControls channels={doc.channels} values={doc.channelValues} onChange={(Changes) => commit({ ...doc, ...Changes }, Changes.channelValues ? "channel-values" : null)} />
      </div>
      <section className="sfw-card">
        <label className="sfw-row">
          Mask
          <select aria-label="Stamp mask interpretation" value={doc.maskMode} onChange={(Event) => commit({ ...doc, maskMode: Event.target.value })}>
            <option value="alpha">Artwork alpha / silhouette</option>
            <option value="luminance">Luminance × alpha</option>
          </select>
        </label>
        <p className="sfw-hint">Colour comes from the artwork; height and normal follow its luminance. Every other target is written at its amount inside the mask.</p>
        {!!Unmapped.length && <p className="sfw-hint">Not in this material: {Unmapped.join(", ")}.</p>}
      </section>
    </>
  );
  const PlacePage = (
    <>
      <section className="sfw-card">
        <header>
          <b>On the material</b>
          <small>{Owner}</small>
        </header>
        <div className="sfw-place" aria-label="Stamp placement preview" style={{ backgroundImage: Ground ? `url("${Ground}")` : undefined }}>
          {preview && (
            <img
              src={preview}
              alt=""
              style={{
                left: `${Placement.U * 100}%`,
                top: `${Placement.V * 100}%`,
                width: `${Placement.Size * 100}%`,
                transform: `translate(-50%,-50%) rotate(${Placement.Turn}deg)`,
              }}
            />
          )}
        </div>
        <div className="sfw-sliders">
          <Slider label="Across (U)" ariaLabel="Stamp placement U" min={0} max={1} step={0.01} value={Placement.U} onChange={(U) => Place({ ...Placement, U })} />
          <Slider label="Down (V)" ariaLabel="Stamp placement V" min={0} max={1} step={0.01} value={Placement.V} onChange={(V) => Place({ ...Placement, V })} />
          <Slider label="Size" ariaLabel="Stamp placement size" percentage min={0.05} max={1} value={Placement.Size} onChange={(Size) => Place({ ...Placement, Size })} />
          <Slider label="Turn" ariaLabel="Stamp placement turn" min={-180} max={180} step={1} unit="°" value={Placement.Turn} onChange={(Turn) => Place({ ...Placement, Turn })} />
        </div>
        <button className="sfw-link" onClick={() => Place(RestingPlacement)}>
          Reset placement
        </button>
      </section>
      <section className="sfw-card">
        <p className="sfw-hint">
          Pressing writes the stamp over what each targeted channel shows now — its fill or its picture — so earlier stamps and patterns stay. It is baked into the channel picture; to take it back, choose the channel’s source again in Material.
        </p>
        <button className="sfw-primary sfw-wide" disabled={busy || Pressing} onClick={() => savePreset(true)}>
          <Stamp size={14} /> {Pressing ? "Pressing…" : "Press onto material"}
        </button>
      </section>
    </>
  );
  const PageBodies = [ComponentPage, TargetsPage, PlacePage];

  // ── The canvas ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const Composition = (
    <div className={"sfw-stamp-surround" + (transform.active ? ` stamp-transform-${transform.active.mode}` : "")}>
      <div
        className="stamp-canvas sfw-stamp-canvas"
        ref={board}
        aria-label="Stamp composition canvas"
        role="region"
        tabIndex={0}
        data-transform-mode={transform.active?.mode || ""}
        data-transform-axis={transform.active?.axis || ""}
        data-transform-source={transform.active?.source || ""}
      >
        {preview && <img src={preview} alt="Stamp preview" draggable={false} />}
        {previewDoc.layers
          .filter((Layer) => Layer.visible)
          .map((Component) => (
            <button
              key={Component.id}
              className={`stamp-canvas-object ${selectedId === Component.id ? "selected" : ""}`}
              aria-label={`Canvas stamp component ${Component.name}`}
              style={{
                left: `${(Component.x / 512) * 100}%`,
                top: `${(Component.y / 512) * 100}%`,
                width: `${(Component.width / 512) * 100}%`,
                height: `${(Component.height / 512) * 100}%`,
                transform: `translate(-50%,-50%) rotate(${Component.rotation}deg)`,
                zIndex: doc.layers.length - doc.layers.findIndex((Layer) => Layer.id === Component.id),
              }}
              onClick={() => choose(Component.id)}
              onPointerDown={(Event) => transform.startDrag(Event, Component)}
              onKeyDown={(Event) => {
                if (transform.gesture.current) return;
                const Arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[Event.key];
                if (!Arrow || Component.locked) return;
                Event.preventDefault();
                const Amount = Event.shiftKey ? 10 : 1;
                choose(Component.id);
                commit({ ...doc, layers: doc.layers.map((Layer) => (Layer.id === Component.id ? { ...Layer, x: Layer.x + Arrow[0] * Amount, y: Layer.y + Arrow[1] * Amount } : Layer)) });
              }}
            >
              {selectedId === Component.id && (
                <>
                  <span className="stamp-object-label">{Component.name}</span>
                  <span role="button" tabIndex={0} aria-label="Resize selected stamp component" className="stamp-resize-handle" onPointerDown={(Event) => transform.startDrag(Event, Component, "resize")} />
                </>
              )}
            </button>
          ))}
      </div>
    </div>
  );
  const Help =
    transform.active?.source === "modal"
      ? `${{ move: "Move", rotate: "Rotate", scale: "Scale" }[transform.active.mode]}${transform.active.axis ? ` · ${transform.active.axis.toUpperCase()} axis` : ""}${transform.active.mode !== "rotate" ? " · X/Y constrain" : ""} · Shift snaps · Click/Enter confirms · Esc cancels`
      : "Drag to move · G move · R rotate · S scale · Shift snaps";

  // ── The toolbar along the top: the G / R / S transforms and the artwork to add (Composition), or the vector canvas's own drawing tools
  // (Vector, placed here by StampVectorCanvas), then the canvas size and the exports.
  const Toolbar = (
    <div className="sfw-toolbar" role="toolbar" aria-label="Stamp tools">
      {MaskActive ? (
        <span className="sfw-toolbar-note">Painting the mask of {selected?.name} · its brushes sit on the mask canvas</span>
      ) : VectorMode ? (
        <span className="sfw-toolbar-slot" ref={PlaceToolSlot} />
      ) : (
        <>
          <span className="sfw-toolbar-family" role="group" aria-label="Transform">
            {[
              ["move", "Move", "G", Move],
              ["rotate", "Rotate", "R", RotateCw],
              ["scale", "Scale", "S", Scaling],
            ].map(([Mode, Caption, Shortcut, Glyph]) => (
              <button
                key={Mode}
                className={"sfw-tool labelled" + (transform.active?.mode === Mode ? " on" : "")}
                aria-label={`${Caption} stamp component`}
                aria-keyshortcuts={Shortcut}
                aria-pressed={transform.active?.mode === Mode}
                disabled={!selected || selected.locked || !selected.visible}
                title={`${Caption} (${Shortcut}) · click or Enter confirms · Esc cancels`}
                onClick={() => transform.startModal(Mode)}
              >
                <Glyph size={15} />
                <kbd>{Shortcut}</kbd>
              </button>
            ))}
          </span>
          <span className="sfw-toolbar-split" />
          <span className="sfw-toolbar-family" role="group" aria-label="Add artwork">
            <button className="sfw-tool" aria-label="Add text" title="Add text" disabled={doc.layers.length >= STAMP_LAYER_LIMIT} onClick={() => add("text")}>
              <Type size={15} />
            </button>
            <button className="sfw-tool" aria-label="Add SVG markup" title="Add SVG markup" disabled={doc.layers.length >= STAMP_LAYER_LIMIT} onClick={() => add("svg")}>
              <Code2 size={15} />
            </button>
            <button className="sfw-tool" aria-label="Import an image" title="Import an image" disabled={doc.layers.length >= STAMP_LAYER_LIMIT} onClick={() => pickFile("image")}>
              <ImagePlus size={15} />
            </button>
          </span>
          <span className="sfw-toolbar-split" />
          <span className="sfw-toolbar-family" role="group" aria-label="Add a vector shape">
            {Shapes.map(([Shape, Caption]) => {
              const Glyph = shapeTools.find(([Each]) => Each === Shape)?.[3] || Code2;
              return (
                <button key={Shape} className={"sfw-tool" + (["triangle", "diamond"].includes(Shape) ? " spare" : "")} aria-label={`Add ${Caption.toLowerCase()}`} title={`Add a ${Caption.toLowerCase()} · opens the vector canvas`} disabled={doc.layers.length >= STAMP_LAYER_LIMIT} onClick={() => AddShape(Shape, Caption)}>
                  <Glyph size={15} />
                </button>
              );
            })}
          </span>
        </>
      )}
      <span className="sfw-toolbar-gap" />
      <span className="sfw-toolbar-note">512 × 512</span>
      <button className="sfw-tool labelled" onClick={() => exportArtwork("svg")} title="Export SVG">
        SVG
      </button>
      <button className="sfw-tool labelled" onClick={() => exportArtwork("png")} title="Export PNG">
        PNG <Download size={12} />
      </button>
    </div>
  );

  return (
    <div
      className="surface-workspace stamp-workspace alloy-scope studio-themed"
      data-surface-workspace="stamp"
    >
      <header className="sfw-bar">
        <div className="sfw-title">
          <input
            aria-label="Stamp title"
            value={doc.name}
            onChange={(Event) => commit({ ...current.current, name: Event.target.value }, "stamp-name")}
          />
          <small>.stamp</small>
          <span className="sfw-status" role="status">
            {Pressed || status}
          </span>
        </div>
        <div className="sfw-views" role="group" aria-label="Stamp canvas mode">
          <button
            aria-pressed={!VectorMode && !MaskActive}
            onClick={() => {
              if (!Finished()) return;
              ConfigureMaskIdentity(null);
              ConfigureVectorMode(false);
            }}
          >
            Composition
          </button>
          <button
            aria-pressed={VectorMode && !MaskActive}
            onClick={() => {
              transform.cancel();
              ConfigureMaskIdentity(null);
              ConfigureVectorMode(true);
            }}
          >
            Vector
          </button>
        </div>
        <div className="sfw-actions">
          <button className="sfw-icon-button" aria-label="Undo stamp edit" title="Undo · Ctrl/⌘ Z" disabled={!undo.current.length} onClick={() => travel("undo")}>
            <Undo2 size={15} />
          </button>
          <button className="sfw-icon-button" aria-label="Redo stamp edit" title="Redo · Ctrl/⌘ Shift Z" disabled={!redo.current.length} onClick={() => travel("redo")}>
            <Redo2 size={15} />
          </button>
          <Popover Label="Stamp document" Glyph={<MoreHorizontal size={15} />} Align="end">
            <button
              data-closes
              onClick={() => {
                VectorCanvas.current?.cancelInteraction();
                const Next = createStampDocument();
                commit({ ...Next, name: "Untitled stamp" }, null, Next.layers[0]?.id);
              }}
            >
              <FilePlus2 size={13} /> New stamp
            </button>
            <button data-closes onClick={() => pickFile("project")}>
              <FolderOpen size={13} /> Open project…
            </button>
            <button data-closes onClick={() => exportArtwork("json")}>
              <Save size={13} /> Save project
            </button>
            <button data-closes disabled={busy} onClick={() => savePreset(false, true)}>
              <Copy size={13} /> Save as new preset
            </button>
          </Popover>
          <button className="sfw-primary" disabled={busy || Pressing} onClick={() => (Pages[Page].Id === "place" ? savePreset(true) : Turn(2))} title={`Press this stamp into ${Owner}'s targeted channels`}>
            <Stamp size={14} /> {Pressing ? "Pressing…" : Pages[Page].Id === "place" ? "Press onto material" : "Place on material"}
          </button>
        </div>
      </header>
      {Toolbar}
      <div className="sfw-body">
        <aside className="sfw-rail ao-rail">
          {Rail === "components" ? (
            Components
          ) : (
            <>
              <OutlinerHeading Title="Presets" Detail={`${presets.length} saved stamps`}>
                <button type="button" className="ao-round" aria-label="Show the stamp components" title="Stamp components" onClick={() => ShowRail("components")}>
                  <Layers3 size={15} />
                </button>
              </OutlinerHeading>
              {Presets}
            </>
          )}
        </aside>
        <main className="sfw-centre" data-mask-editing={MaskActive || undefined}>
          {MaskActive ? (
            <ArtworkMaskCanvas
              key={selected.id}
              Mask={selected.mask}
              Name={selected.name}
              Disabled={selected.locked}
              OnSave={() => exportArtwork("json")}
              OnClose={() => ConfigureMaskIdentity(null)}
              OnHistory={travel}
              OnError={setError}
              OnChange={(Mask) => {
                if (!selected.locked) commit({ ...current.current, layers: current.current.layers.map((Entry) => (Entry.id === selected.id ? { ...Entry, mask: Mask } : Entry)) });
              }}
            />
          ) : VectorMode ? (
            <StampVectorCanvas
              InspectorTarget={InspectorTarget}
              Appearance={CanvasAppearance}
              OnAppearance={ConfigureCanvasAppearance}
              ref={VectorCanvas}
              Document={doc}
              SelectedIDs={VectorSelection.includes(selectedId) ? VectorSelection : selectedId ? [selectedId] : []}
              OnSelection={(IDs) => choose(IDs.at(-1), IDs)}
              OnFinalize={commit}
              OnError={setError}
              OnHistory={travel}
              Paint={selected?.kind === "vector" ? VectorPaintStyle(StampVectorGeometry(selected)) : DrawingPaint}
              OnPaint={ApplyVectorPaint}
              OnAddText={(Position) => add("text", Position)}
              OnImportSVG={() => pickFile("svg")}
              ToolbarTarget={ToolSlot}
            />
          ) : (
            <>
              {Composition}
              <p className="sfw-canvas-note" role="status" aria-live="polite">
                {Help}
              </p>
            </>
          )}
          {(error || fontWarning) && (
            <p className="sfw-error" role="alert">
              {error || fontWarning}
              {error && (
                <button aria-label="Dismiss" onClick={() => setError("")}>
                  <X size={12} />
                </button>
              )}
            </p>
          )}
        </main>
        <aside className="sfw-inspector" data-mask-editing={MaskActive || undefined}>
          <PageStrip Owner="Stamp" Pages={Pages} Index={Page} Pick={Turn} />
          <div className="sfw-pages">
            {PageBodies.map((Body, At) => (
              <div key={Pages[At].Id} {...PageLook(At, Page, Motion)} data-page={Pages[At].Id}>
                {Body}
              </div>
            ))}
          </div>
        </aside>
      </div>
      <footer className="sfw-foot">
        {doc.layers.length} components · {doc.channels.length} targets · {revision} edits
      </footer>
      <input
        type="file"
        ref={input}
        hidden
        onChange={(Event) => {
          const File = Event.target.files[0];
          Event.target.value = "";
          importFile(File);
        }}
      />
    </div>
  );
}
