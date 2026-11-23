//============================================================================================================================================
//                                                              BAKEWORKSPACE.JSX
//============================================================================================================================================
// 🧩 The ShaderEditor's Baking tab (Follow-up 74): geometry maps baked from the preview shape the viewport shows, and the material's own
// channels baked into pictures. Drawn for the ShaderEditor, on the same viewport as the Material tab.
//   • Three docks, as in Pattern, Stamp and Texture paint: LayerStack | Viewport | Inspector. The LayerStack lists the geometry maps; the
//     eye takes a map into (or out of) the next bake, and a baked map shows its picture.
//   • The Viewport shows the lit material (Lit), the chosen map laid flat on the shape (Map) or every baked map side by side (Sheet).
//     Bake runs the Texture Studio's mesh-map baker (TextureStudio/src/baking/meshBakeCore.js) on the shape itself — ambient occlusion,
//     curvature, cavity, convexity, edge wear, dirt, dust, thickness, bevel, world normal, position, UV islands and the UV wireframe —
//     in the page, a slice at a time, and can be cancelled.
//   • Inspector pages: Settings (resolution, samples and each map's reach), Map (the chosen map: use it as the material's occlusion or
//     subsurface thickness, multiply it into the base colour, save it) and Material (gradients, GLSL and linked channels baked into
//     pictures, and every channel saved as a PNG).
// Baked maps are kept by the ShaderEditor (Bakes), so Texture paint can paint through them as masks.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Flame, Download, CircleStop, Check } from "lucide-react";
import * as THREE from "three";
import ArtworkOutliner from "./ArtworkOutliner.jsx";
import { DockTabs, ViewportHeader } from "./SurfaceDocks.jsx";
import { PageStrip, PageTurn, PageLook } from "./PageCarousel.jsx";
import { Control, Card, Metric } from "./Inspectors.jsx";
import ShaderViewport, { PreviewGeometry, PreviewShapes, BoundShape } from "./ShaderViewport.jsx";
import { OverlappingUvs } from "./BoundSurface.js";
import GeometryMapIcon from "./GeometryMapIcons.jsx";
import { SdfView, SdfPanel } from "./SdfWorkspace.jsx";
import { ChannelPicture } from "./PaintWorkspace.jsx";
import { MaterialChannels, ShownChannel } from "./MaterialSpecification.js";
import { TextureEdge, ChannelCanvas, EncodePicture, WithPicture } from "./SurfaceTextures.js";
import { bakeMeshMaps, encodeBakeMap, dilateBakePixels } from "../TextureStudio/src/baking/meshBakeCore.js";
import { MESH_MAPS } from "../TextureStudio/src/baking/meshMaps.js";
import "./SurfaceWorkspaces.css";

const FieldOf = (Id) => MaterialChannels.find((Each) => Each.Id === Id);
export const BakeMaps = ["occlusion", "curvature", "cavity", "convexity", "edge-wear", "dirt", "dust", "thickness", "bevel-mask", "world-normal", "position", "uv-island", "wireframe"];
const Short = {
  occlusion: "Ambient occlusion",
  curvature: "Curvature",
  cavity: "Cavity",
  convexity: "Convexity",
  "edge-wear": "Edge wear",
  dirt: "Dirt",
  dust: "Dust",
  thickness: "Thickness",
  "bevel-mask": "Bevel",
  "world-normal": "World normal",
  position: "Position",
  "uv-island": "UV islands",
  wireframe: "UV wireframe",
};
const Pages = [
  { Id: "settings", Label: "Settings" },
  { Id: "map", Label: "Map" },
  { Id: "material", Label: "Material" },
  // Follow-up 75: the signed distance field (SdfWorkspace.jsx) belongs to Baking; it needs a scene object rather than a preview shape.
  { Id: "sdf", Label: "Distance field" },
];
const Resolutions = [128, 256, 512];
const DustAxes = ["+Y", "-Y", "+X", "-X", "+Z", "-Z"];
const Unscaled = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// The baker writes each texel once, so a shape needs its own non-overlapping UVs inside the 0–1 tile.
const Unbakeable = {
  "Shader ball": "its UVs run outside the 0–1 tile",
  "Rounded cube": "all six faces share one UV square",
};

// The preview shape as the baker reads a mesh: positions, normals, triangle corners and UVs in one object (low and high alike).
function BakeSurface(Geometry) {
  const Count = Geometry.attributes.position.count;
  if (!Geometry.attributes.normal) Geometry.computeVertexNormals();
  const Flat = (Name, Size) => {
    const Attribute = Geometry.attributes[Name], Out = new Float32Array(Count * Size);
    for (let At = 0; At < Count; At++) for (let C = 0; C < Size; C++) Out[At * Size + C] = Attribute.getComponent(At, C);
    return Out;
  };
  return {
    objectToWorld: Unscaled,
    positions: Flat("position", 3),
    normals: Flat("normal", 3),
    indices: Geometry.index ? Uint32Array.from(Geometry.index.array) : Uint32Array.from({ length: Count }, (_, At) => At),
    uvs: Flat("uv", 2).map((Each) => Math.min(1, Math.max(0, Each))), // three.js poles sit half a segment past the tile
    colors: null,
    partIds: new Float32Array(Count),
    chartIds: null,
  };
}
// One baked field as a picture: encoded as the Texture Studio encodes it, grown past the UV edges by Padding texels, then opaque.
function FieldPicture(Key, Field, Resolution, Coverage, Padding) {
  const Encoded = encodeBakeMap(Field, Resolution, Resolution, { colorSpace: MESH_MAPS[Key].colorSpace, normalY: "+Y" }, Coverage);
  const Grown = dilateBakePixels(Encoded, Resolution, Resolution, Coverage, Padding);
  for (let At = 3; At < Grown.length; At += 4) Grown[At] = 255;
  const Canvas = document.createElement("canvas");
  Canvas.width = Canvas.height = Resolution;
  Canvas.getContext("2d").putImageData(new ImageData(Grown, Resolution, Resolution), 0, 0);
  return Canvas;
}
const Larger = (Canvas, Edge = TextureEdge) => {
  const Out = document.createElement("canvas");
  Out.width = Out.height = Edge;
  const Brush = Out.getContext("2d");
  Brush.imageSmoothingQuality = "high";
  Brush.drawImage(Canvas, 0, 0, Edge, Edge);
  return Out;
};
const Save = (Canvas, Name) => {
  const Link = document.createElement("a");
  Link.href = Canvas.toDataURL("image/png");
  Link.download = Name.replace(/[\\/:*?"<>|]/g, " ") + ".png";
  Link.click();
};
function Picture({ Canvas, Size = 26 }) {
  const Own = useRef(null);
  React.useEffect(() => {
    const Brush = Own.current?.getContext("2d");
    if (!Brush || !Canvas) return;
    Brush.clearRect(0, 0, Size * 2, Size * 2);
    Brush.drawImage(Canvas, 0, 0, Size * 2, Size * 2);
  }, [Canvas, Size]);
  return <canvas ref={Own} className="pw-thumbnail" width={Size * 2} height={Size * 2} style={{ width: Size, height: Size }} aria-hidden="true" />;
}

// Scene: { Subject, Values, Change } of the bound scene object (a primitive), for the distance field; Open: "sdf" opens on it.
export default function BakeWorkspace({ Material, Latest, Owner, Apply, Bakes, KeepBakes, Shape, ChooseShape, Bound = null, OpenStudio, Scene = null, Open = "", OpenAt = 0 }) {
  const Shapes = Bound ? [...PreviewShapes, BoundShape] : PreviewShapes;
  const ShapeName = (Name) => (Name === BoundShape ? Bound?.Name || "bound object" : Name);
  // The bound object bakes when its UVs allow it (the UV tab's layout always does; a primitive's own UVs may overlap).
  const BoundRefusal = useMemo(() => {
    if (Shape !== BoundShape || !Bound) return null;
    const Geometry = Bound.Make(), Problem = OverlappingUvs(Geometry);
    Geometry.dispose();
    return Problem;
  }, [Shape, Bound?.Key]);
  const [Chosen, Choose] = useState(() => new Set(["occlusion", "curvature", "cavity", "edge-wear", "thickness"]));
  const [Focus, FocusOn] = useState(() => Object.keys(Bakes)[0] || "occlusion");
  const [Mode, ChooseMode] = useState(Open === "sdf" ? "sdf" : "lit");
  const [FieldLook, LookAtField] = useState({ Tool: "sdf" });
  const SetFieldLook = (Next) => LookAtField((Before) => (typeof Next === "function" ? Next(Before) : Next) || Before);
  const [Settings, Tune] = useState({ resolution: 256, samples: 16, aoDistance: 0.35, curvatureRadius: 0.03, thicknessRange: 1.2, padding: 6, maskStrength: 3, dustAxis: "+Y", dustFalloff: 2 });
  const [Progress, Report] = useState(null); // { Phase, Done, Total } while baking
  const [Status, Say] = useState("");
  const Stop = useRef(null);

  const Bake = async () => {
    const Channels = BakeMaps.filter((Id) => Chosen.has(Id));
    if (!Channels.length || (Shape === BoundShape ? BoundRefusal : Unbakeable[Shape])) return;
    const Stopper = new AbortController();
    Stop.current = Stopper;
    const Started = performance.now();
    Report({ Phase: "Preparing the " + ShapeName(Shape).toLowerCase(), Done: 0, Total: 1 });
    Say("");
    const Geometry = PreviewGeometry(Shape, Bound);
    try {
      const Surface = BakeSurface(Geometry);
      const Result = await bakeMeshMaps(
        Surface,
        Surface,
        { ...Settings, channels: Channels, projection: "nearest", front: 0.02, back: 0.02, nearestFallback: true },
        null,
        {
          signal: Stopper.signal,
          onProgress: ({ phase, done, total }) => Report({ Phase: phase, Done: done, Total: total || 1 }),
        },
      );
      const Seconds = (performance.now() - Started) / 1000;
      const Made = {};
      for (const Key of Channels)
        if (Result.maps[Key])
          Made[Key] = { Canvas: FieldPicture(Key, Result.maps[Key], Settings.resolution, Result.coverage, Settings.padding), Label: Short[Key], Resolution: Settings.resolution, Shape, Named: ShapeName(Shape), Seconds, At: Date.now() };
      KeepBakes((Before) => ({ ...Before, ...Made }));
      if (!Made[Focus]) FocusOn(Object.keys(Made)[0]);
      Say(`Baked ${Object.keys(Made).length} map${Object.keys(Made).length === 1 ? "" : "s"} · ${Settings.resolution}² · ${Seconds.toFixed(1)} s`);
    } catch (Problem) {
      Say(Problem?.name === "AbortError" ? "Bake cancelled" : String(Problem?.message || Problem));
    } finally {
      Geometry.dispose();
      Stop.current = null;
      Report(null);
    }
  };

  // ── Using a map ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const Focused = Bakes[Focus];
  const Refusal = Shape === BoundShape ? BoundRefusal : Unbakeable[Shape];
  const UseAs = (Id) => {
    Apply(WithPicture(Latest.current, Id, EncodePicture(Larger(Focused.Canvas), `Baked ${Short[Focus]}`), 1));
    Say(`${Short[Focus]} is now ${Owner}'s ${FieldOf(Id).Label.toLowerCase()}`);
  };
  const MultiplyIntoColour = async () => {
    const Colour = await ChannelCanvas(Latest.current, "colour");
    const Brush = Colour.getContext("2d");
    Brush.globalCompositeOperation = "multiply";
    Brush.drawImage(Focused.Canvas, 0, 0, Colour.width, Colour.height);
    Apply(WithPicture(Latest.current, "colour", EncodePicture(Colour, "Base colour × " + Short[Focus]), 1));
    Say(`${Short[Focus]} multiplied into the base colour`);
  };

  // ── Material channels baked into pictures ─────────────────────────────────────────────────────────────────────────────────────
  const Procedural = Material.Used.filter((Id) => {
    const Owned = Material.Channels[Id];
    return Owned.Source === "Code" || Owned.Source === "Link" || ShownChannel(Owned).Source === "Gradient";
  });
  const [Flattening, Busy] = useState(false);
  const Flatten = async () => {
    Busy(true);
    try {
      let Next = Latest.current;
      for (const Id of Procedural) Next = WithPicture(Next, Id, EncodePicture(await ChannelPicture(Latest.current, Id), `Baked ${FieldOf(Id).Label}`), 1);
      Apply(Next);
      Say(`Baked ${Procedural.length} channel${Procedural.length === 1 ? "" : "s"} into pictures`);
    } catch (Problem) {
      Say(String(Problem?.message || Problem));
    } finally {
      Busy(false);
    }
  };
  const SaveChannels = async () => {
    for (const Id of Material.Used) Save(await ChannelPicture(Latest.current, Id), `${Material.Name} ${FieldOf(Id).Label}`);
  };

  // ── LayerStack: the geometry maps─────────────────────────────────────────────────────────────────────────────────────────────────
  const [Query, Search] = useState(""), [Filter, Sift] = useState("all");
  const Flip = (Id) =>
    Choose((Before) => {
      const Next = new Set(Before);
      Next.has(Id) ? Next.delete(Id) : Next.add(Id);
      return Next;
    });
  const Rows = BakeMaps.filter((Id) => Short[Id].toLowerCase().includes(Query.toLowerCase()))
    .filter((Id) => (Filter === "visible" ? Chosen.has(Id) : Filter === "hidden" ? !Chosen.has(Id) : true))
    .map((Id) => ({
      Id,
      Name: Short[Id],
      Label: Short[Id] + " map",
      Detail: Bakes[Id] ? `Baked · ${Bakes[Id].Resolution}² · ${Bakes[Id].Named.toLowerCase()}` : Chosen.has(Id) ? "In the next bake" : "Skipped",
      Picture: Bakes[Id] ? <Picture Canvas={Bakes[Id].Canvas} /> : <GeometryMapIcon Name={Id} />,
      Chosen: Focus === Id && Mode !== "sdf",
      Pick: () => {
        FocusOn(Id);
        if (Mode === "sdf" || (Bakes[Id] && Mode === "lit")) ChooseMode(Bakes[Id] ? "map" : "lit");
      },
      Hidden: !Chosen.has(Id),
      Show: () => Flip(Id),
    }));
  // The distance field, last: it is baked from the scene object on its own page rather than through the UVs.
  if ("distance field".includes(Query.toLowerCase()) && Filter !== "hidden")
    Rows.push({
      Id: "distance-field",
      Name: "Distance field",
      Label: "Signed distance field",
      Detail: Scene ? `Sparse SDF · ${Scene.Subject.Name}` : "Needs a scene object",
      Picture: <GeometryMapIcon Name="distance-field" />,
      Chosen: Mode === "sdf",
      Pick: () => ShowField(),
    });

  const [Page, TurnTo] = useState(Open === "sdf" ? 3 : 0);
  const Motion = PageTurn(Page);
  const Turn = (At) => {
    Motion.Turn(At);
    TurnTo(At);
  };
  const [Shut, ShutDocks] = useState({});
  const ShowField = () => {
    ChooseMode("sdf");
    Turn(Pages.findIndex((Each) => Each.Id === "sdf"));
  };
  useEffect(() => {
    if (Open === "sdf" && OpenAt) ShowField();
  }, [OpenAt]);
  const Unbound = (
    <Card Title="Distance field">
      <p className="card-foot">The distance field is baked from a scene object. Bind a primitive with "Bound to" (or follow the selection) to bake it.</p>
    </Card>
  );
  const FieldKit = { Card, Control, Metric };
  const Tuner = (Key) => (Amount) => Tune((Before) => ({ ...Before, [Key]: Amount }));
  const PageBodies = [
    <>
      <Card Title="Bake">
        <Control Field={{ Label: "Resolution", Control: "Select", Options: Resolutions.map((Each) => `${Each} × ${Each}`) }} Value={Resolutions.indexOf(Settings.resolution)} Change={(At) => Tuner("resolution")(Resolutions[At])} />
        <Control Field={{ Label: "Samples", Minimum: 4, Maximum: 64, Decimals: 0, Default: 16 }} Value={Settings.samples} Change={(Amount) => Tuner("samples")(Math.round(Amount))} />
        <Control Field={{ Label: "Padding", Minimum: 0, Maximum: 16, Decimals: 0, Unit: "px", Default: 6 }} Value={Settings.padding} Change={(Amount) => Tuner("padding")(Math.round(Amount))} />
        <Control Field={{ Label: "Preview shape", Control: "Select", Options: Shapes.map(ShapeName) }} Value={Math.max(0, Shapes.indexOf(Shape))} Change={(At) => ChooseShape(Shapes[At])} />
        <p className="card-foot">{Refusal ? `The ${ShapeName(Shape).toLowerCase()} cannot be baked: ${Refusal}. The sphere, the draped cloth and an object unwrapped in the UV tab can.` : "The shape is baked against itself, through its own UVs."}</p>
      </Card>
      <Card Title="Reach">
        <Control Field={{ Label: "Occlusion distance", Minimum: 0.02, Maximum: 1.5, Decimals: 2, Unit: "m", Default: 0.35 }} Value={Settings.aoDistance} Change={Tuner("aoDistance")} />
        <Control Field={{ Label: "Curvature radius", Minimum: 0.005, Maximum: 0.2, Decimals: 3, Unit: "m", Default: 0.03 }} Value={Settings.curvatureRadius} Change={Tuner("curvatureRadius")} />
        <Control Field={{ Label: "Thickness range", Minimum: 0.1, Maximum: 4, Decimals: 2, Unit: "m", Default: 1.2 }} Value={Settings.thicknessRange} Change={Tuner("thicknessRange")} />
        <Control Field={{ Label: "Edge and dirt strength", Minimum: 0, Maximum: 16, Decimals: 1, Default: 3 }} Value={Settings.maskStrength} Change={Tuner("maskStrength")} />
        <Control Field={{ Label: "Dust falls from", Control: "Select", Options: DustAxes }} Value={DustAxes.indexOf(Settings.dustAxis)} Change={(At) => Tuner("dustAxis")(DustAxes[At])} />
        <Control Field={{ Label: "Dust falloff", Minimum: 0.1, Maximum: 8, Decimals: 1, Default: 2 }} Value={Settings.dustFalloff} Change={Tuner("dustFalloff")} />
      </Card>
    </>,
    <>
      <Card Title={Short[Focus]}>
        {Focused ? (
          <>
            <div className="pw-canvas-preview">
              <Picture Canvas={Focused.Canvas} Size={180} />
            </div>
            <p>
              {Focused.Resolution} × {Focused.Resolution} · {Focused.Named} · {Focused.Seconds.toFixed(1)} s
            </p>
          </>
        ) : (
          <p>Not baked yet. Take it into the bake with its eye in the LayerStack, then press Bake.</p>
        )}
        <p className="card-foot">{MESH_MAPS[Focus].description}</p>
      </Card>
      {Focused && (
        <Card Title="Use it">
          <div className="pw-buttons column">
            {Focus === "occlusion" && (
              <>
                <button type="button" className="sfw-icon-button" onClick={() => UseAs("occlusion")}>
                  <Check size={13} /> Use as occlusion
                </button>
                <button type="button" className="sfw-icon-button" onClick={MultiplyIntoColour}>
                  <Check size={13} /> Multiply into base colour
                </button>
              </>
            )}
            {Focus === "thickness" && (
              <button type="button" className="sfw-icon-button" onClick={() => UseAs("thickness")}>
                <Check size={13} /> Use as subsurface thickness
              </button>
            )}
            <button type="button" className="sfw-icon-button" onClick={() => Save(Focused.Canvas, `${Material.Name} ${Short[Focus]}`)}>
              <Download size={13} /> Save PNG
            </button>
          </div>
          <p className="card-foot">{["occlusion", "curvature", "cavity", "convexity", "edge-wear", "dirt", "dust", "thickness", "bevel-mask"].includes(Focus) ? "Texture paint can paint through this map (its Mask page)." : "A reference map for checking the shape and its UVs."}</p>
        </Card>
      )}
    </>,
    <>
      <Card Title="Channels into pictures">
        {Procedural.length ? (
          <ul className="bw-list">
            {Procedural.map((Id) => (
              <li key={Id}>
                {FieldOf(Id).Label}
                <small>{Material.Channels[Id].Source === "Code" ? "GLSL" : Material.Channels[Id].Source === "Link" ? "Linked" : "Gradient"}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p>Every channel is already a fill or a picture.</p>
        )}
        <div className="pw-buttons column">
          <button type="button" className="sfw-icon-button" disabled={!Procedural.length || Flattening} onClick={Flatten}>
            <Flame size={13} /> {Flattening ? "Baking…" : "Bake into pictures"}
          </button>
          <button type="button" className="sfw-icon-button" disabled={!Material.Used.length} onClick={SaveChannels}>
            <Download size={13} /> Save every channel as PNG
          </button>
        </div>
        <p className="card-foot">Gradients, GLSL and linked channels become {TextureEdge} × {TextureEdge} pictures the engine reads directly.</p>
      </Card>
    </>,
    Scene ? <SdfPanel {...Scene} Workspace={FieldLook} SetWorkspace={SetFieldLook} Kit={FieldKit} /> : Unbound,
  ];

  const Baked = BakeMaps.filter((Id) => Bakes[Id]);
  const Showing = Mode === "map" && Focused ? Focused.Canvas : null;
  return (
    <div className="surface-workspace bake-workspace" data-surface-workspace="bake">
      <div className={"sfw-body sfw-docks" + (Shut.left ? " no-left" : "") + (Shut.right ? " no-right" : "")}>
        {!Shut.left && (
          <section className="sfw-rail ao-rail sfw-pane left" aria-label="LayerStack dock">
            <DockTabs Label="LayerStack dock" Tabs={[{ Id: "maps", Label: "LayerStack" }]} Active="maps" Close={() => ShutDocks((Before) => ({ ...Before, left: true }))} />
            <ArtworkOutliner
              Title="Geometry maps"
              Detail={`${Chosen.size} to bake · ${Baked.length} baked`}
              Visible={Chosen.size}
              Hidden={BakeMaps.length - Chosen.size}
              ShowAll={() => Choose(new Set(BakeMaps))}
              HideAll={() => Choose(new Set())}
              Query={Query}
              Search={Search}
              Filter={Filter}
              Sift={Sift}
              Label="Geometry maps"
              Rows={Rows}
              Empty="No map matches"
              Footer={
                <>
                  <span>
                    <small>Bake</small>
                    <b>
                      {Chosen.size} / {BakeMaps.length}
                    </b>
                  </span>
                  <span>
                    <small>Eye</small>Takes a map into the bake
                  </span>
                </>
              }
            />
          </section>
        )}
        <section className="sfw-pane centre" aria-label="Viewport dock">
          <DockTabs Label="Viewport dock" Tabs={[{ Id: "viewport", Label: "Viewport" }]} Active="viewport" Restore={Shut.left || Shut.right ? () => ShutDocks({}) : undefined} />
          <ViewportHeader
            Picture={
              <span className="sfw-view-picture">
                <Flame size={15} />
              </span>
            }
            Name={<span className="sfw-view-name pw-name">{Material.Name}</span>}
            Detail={<span role="status">{Progress ? `${Progress.Phase} · ${Math.round((100 * Progress.Done) / Progress.Total)} %` : Status || `Baking · ${ShapeName(Shape).toLowerCase()} · ${Baked.length} maps baked`}</span>}
            ModesLabel="Bake view"
            Modes={[
              ["lit", "Lit", Mode === "lit", () => ChooseMode("lit")],
              ["map", "Map", Mode === "map", () => ChooseMode("map")],
              ["sheet", "Sheet", Mode === "sheet", () => ChooseMode("sheet")],
              ["sdf", "Distance field", Mode === "sdf", ShowField],
            ]}
            Actions={null}
            Primary={
              Progress ? (
                <button type="button" className="sfw-apply" onClick={() => Stop.current?.abort()}>
                  <CircleStop size={14} /> Cancel
                </button>
              ) : (
                <button type="button" className="sfw-apply" disabled={!Chosen.size || !!Refusal} onClick={Bake} title={Refusal ? `The ${ShapeName(Shape).toLowerCase()} cannot be baked: ${Refusal}` : `Bake the chosen maps from the ${ShapeName(Shape).toLowerCase()}`}>
                  <Flame size={14} /> Bake {Chosen.size} map{Chosen.size === 1 ? "" : "s"}
                </button>
              )
            }
            Tools={
              <span className="sfw-view-family" role="group" aria-label="Resolution">
                {Resolutions.map((Each) => (
                  <button key={Each} type="button" className={"sfw-tool labelled" + (Settings.resolution === Each ? " on" : "")} aria-pressed={Settings.resolution === Each} onClick={() => Tuner("resolution")(Each)} disabled={!!Progress}>
                    {Each}²
                  </button>
                ))}
              </span>
            }
            Trailing={
              <>
                {Progress && (
                  <span className="bw-progress" aria-hidden="true">
                    <i style={{ width: (100 * Progress.Done) / Progress.Total + "%" }} />
                  </span>
                )}
                <span className="sfw-view-note">{Settings.samples} samples</span>
              </>
            }
          />
          <main className="sfw-centre pw-centre">
            {Refusal && !Progress && Mode !== "sdf" && (
              <div className="bw-refusal" role="note">
                <span>
                  The {ShapeName(Shape).toLowerCase()} cannot be baked: {Refusal}.
                </span>
                {Shape === BoundShape && OpenStudio ? (
                  <button type="button" onClick={() => OpenStudio("uv")}>
                    Unwrap in the UV tab
                  </button>
                ) : (
                  <button type="button" onClick={() => ChooseShape(Bound ? BoundShape : "Sphere")}>
                    {Bound ? `Bake on ${Bound.Name}` : "Bake on the sphere"}
                  </button>
                )}
                <button type="button" onClick={() => ChooseShape("Draped cloth")}>
                  Draped cloth
                </button>
              </div>
            )}
            {Progress ? (
              // The live viewport steps aside while the baker runs, so the page's time goes to the bake.
              <div className="bw-baking" role="status">
                <Flame size={28} />
                <b>{Progress.Phase}</b>
                <span className="bw-progress large">
                  <i style={{ width: (100 * Progress.Done) / Progress.Total + "%" }} />
                </span>
                <small>
                  {Math.round((100 * Progress.Done) / Progress.Total)} % · {Chosen.size} maps · {Settings.resolution}² · {Settings.samples} samples
                </small>
              </div>
            ) : Mode === "sdf" ? (
              Scene ? (
                <div className="bw-field">
                  <SdfView {...Scene} Workspace={FieldLook} SetWorkspace={SetFieldLook} />
                </div>
              ) : (
                <p className="bw-empty">The distance field is baked from a scene object · bind one with "Bound to" above.</p>
              )
            ) : Mode === "sheet" ? (
              <div className="bw-sheet">
                {Baked.length ? (
                  Baked.map((Id) => (
                    <button key={Id} type="button" className={"bw-tile" + (Focus === Id ? " on" : "")} onClick={() => FocusOn(Id)}>
                      <Picture Canvas={Bakes[Id].Canvas} Size={150} />
                      <span>{Short[Id]}</span>
                      <small>
                        {Bakes[Id].Resolution}² · {Bakes[Id].Named}
                      </small>
                    </button>
                  ))
                ) : (
                  <p className="bw-empty">Nothing baked yet. Choose maps with their eyes in the LayerStack and press Bake.</p>
                )}
              </div>
            ) : (
              <ShaderViewport
                Material={Material}
                Eyebrow={Mode === "map" ? "BAKED MAP" : "BAKING / " + ShapeName(Shape).toUpperCase()}
                Title={Mode === "map" ? Short[Focus] : Material.Name}
                Note={Mode === "map" ? (Focused ? `${Focused.Resolution} × ${Focused.Resolution} · baked on the ${Focused.Named.toLowerCase()}` : "Not baked yet") : `${Chosen.size} maps chosen · ${Settings.resolution}² · ${Settings.samples} samples`}
                Shape={Shape}
                ChooseShape={ChooseShape}
                Showing={Showing}
                Bound={Bound}
              />
            )}
          </main>
          <div className="sfw-view-foot">{Mode === "sdf" ? "Sparse signed distance field of the bound object · drag to orbit · the slice reads the field inside it" : Mode === "map" && Focused && Focused.Shape !== Shape ? `Baked on the ${Focused.Named.toLowerCase()} · shown on the ${ShapeName(Shape).toLowerCase()}` : "Bakes in the page · the shape is baked against itself"}</div>
        </section>
        {!Shut.right && (
          <section className="sfw-inspector sfw-pane right" aria-label="Inspector dock">
            <DockTabs Label="Inspector dock" Tabs={[{ Id: "inspector", Label: "Inspector" }]} Active="inspector" Close={() => ShutDocks((Before) => ({ ...Before, right: true }))} />
            <PageStrip Owner="Baking" Pages={Pages} Index={Page} Pick={Turn} />
            <div className="sfw-pages pw-pages">
              {PageBodies.map((Body, At) => (
                <div key={Pages[At].Id} {...PageLook(At, Page, Motion)} data-page={Pages[At].Id}>
                  {Body}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
