//============================================================================================================================================
//                                                              SCENESTUDIOS.JSX
//============================================================================================================================================
// 🧩 The ShaderEditor's object workspaces (Follow-up 75): UV, Fracture and Nanite. Where Material, Pattern, Stamp, Texture paint and
// Baking work on the bound material, these work on the bound scene object itself — the one "Bound to" names, or the selection when the
// ShaderEditor follows it — and write into that object's own values, exactly as the in-viewport edit tools do:
//   • UV — Values["UV Layout"] (island edits on the projection unwrap) and Values["Unwrapped UVs"] (paint and bake through this layout).
//   • Fracture — Values.Fracture (the recipe, its points and the bake stamp).
//   • Nanite — Values["LOD Clusters"] (the Geometry Compiler's cluster DAG settings and bake stamp).
// Every one has the same three docks as the other tabs: Outliner | Viewport | Inspector.
//   • The Outliner lists what the tool is made of: UV islands, fracture points and pieces, cluster DAG levels.
//   • The Viewport has the live 3D view the Material tab uses (ShaderViewport, showing the tool's own model) and the tool's diagram view
//     from the edit workspace (UvView's UV space, FractureView's exploded diagram, ClusterView's level DAG).
//   • The Inspector carries the tool's own cards (UvPanel, FracturePanelBody, ClusterPanel) and an Object page.

import React, { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { RotateCw, FlipHorizontal2, LayoutGrid, MousePointerClick, Move, Dices, Grid3x3, Check } from "lucide-react";
import ArtworkOutliner from "./ArtworkOutliner.jsx";
import { DockTabs, ViewportHeader } from "./SurfaceDocks.jsx";
import { PageStrip, PageTurn, PageLook } from "./PageCarousel.jsx";
import { Control, Card, Metric } from "./Inspectors.jsx";
import ShaderViewport, { BoundShape } from "./ShaderViewport.jsx";
import { UvLayoutOf, UvView, UvPanel, FractureView, FracturePanelBody, useShatter, PointsOf, PointsPatch, PointTone, WorkspaceGlyph } from "./Workspaces.jsx";
import { ClusterView, ClusterPanel, useClusters, Cut, LevelTones, ClusterKey, ErrorText } from "./ClusterWorkspace.jsx";
import { packCharts } from "../GeometryCompiler/Engine/UvCharts.js";
import { CheckerTexture } from "./WorkspaceGeometry.js";
import { Hue } from "./WorkspaceSurface.jsx";
import { UnwrapGeometry, LayoutKey, ForPreview } from "./BoundSurface.js";
import { MATERIAL, MAX_POINTS, formatLength as FormatLength } from "../FractureEditor/FractureModel.js";
import "./Workspaces.css";
import "./SurfaceWorkspaces.css";

const Kit = { Card, Control, Metric };
// A tool's look (camera, selection, display switches) in the shape the edit workspaces expect: SetLook takes a patch function or a
// whole look; null (the edit workspaces' "leave") keeps the current one, since a tab is left with the tab strip.
function useLook(Initial) {
  const [Look, Keep] = useState(Initial);
  return [Look, (Next) => Keep((Before) => (typeof Next === "function" ? Next(Before) : Next) || Before)];
}
// The material's own fills (colour, roughness, metallic) for surfaces drawn without UVs.
function PlainLook(Material, Fallback = "#a29d94") {
  const Fill = (Id) => Material?.Channels?.[Id]?.Fill;
  const Colour = /^#[\da-f]{6}$/i.test(Fill("colour") || "") ? Fill("colour") : Fallback;
  return new THREE.MeshStandardMaterial({ color: Colour, roughness: Math.max(0.04, Math.min(1, +Fill("roughness") || 0.5)), metalness: Math.max(0, Math.min(1, +Fill("metallic") || 0)) });
}
// Disposes a model built for the viewport (its geometries, materials and textures) once it is replaced.
function useDisposal(Model) {
  useEffect(
    () => () => {
      Model?.traverse((Each) => {
        Each.geometry?.dispose();
        for (const Look of [].concat(Each.material || [])) {
          if (Look.map && !Look.map.userData.Kept) Look.map.dispose();
          Look.dispose();
        }
      });
    },
    [Model],
  );
}

// The three docks every object workspace shares.
function StudioDocks({ Studio, OutlinerName, Outliner, Header, Centre, Foot, Pages, PageBodies, Owner }) {
  const [Shut, ShutDocks] = useState({});
  const [Page, TurnTo] = useState(0);
  const Motion = PageTurn(Page);
  const Turn = (At) => {
    Motion.Turn(At);
    TurnTo(At);
  };
  return (
    <div className={"surface-workspace scene-studio " + Studio + "-studio"} data-surface-workspace={Studio}>
      <div className={"sfw-body sfw-docks" + (Shut.left ? " no-left" : "") + (Shut.right ? " no-right" : "")}>
        {!Shut.left && (
          <section className="sfw-rail ao-rail sfw-pane left" aria-label="Outliner dock">
            <DockTabs Label="Outliner dock" Tabs={[{ Id: "outliner", Label: OutlinerName }]} Active="outliner" Close={() => ShutDocks((Before) => ({ ...Before, left: true }))} />
            {Outliner}
          </section>
        )}
        <section className="sfw-pane centre" aria-label="Viewport dock">
          <DockTabs Label="Viewport dock" Tabs={[{ Id: "viewport", Label: "Viewport" }]} Active="viewport" Restore={Shut.left || Shut.right ? () => ShutDocks({}) : undefined} />
          {Header}
          <main className="sfw-centre os-centre">{Centre}</main>
          <div className="sfw-view-foot">{Foot}</div>
        </section>
        {!Shut.right && (
          <section className="sfw-inspector sfw-pane right" aria-label="Inspector dock">
            <DockTabs Label="Inspector dock" Tabs={[{ Id: "inspector", Label: "Inspector" }]} Active="inspector" Close={() => ShutDocks((Before) => ({ ...Before, right: true }))} />
            <PageStrip Owner={Owner} Pages={Pages} Index={Page} Pick={Turn} />
            <div className="sfw-pages os-pages">
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
const Picture = ({ Tool }) => (
  <span className="sfw-view-picture">
    <WorkspaceGlyph Tool={Tool} Size={15} />
  </span>
);
const ToolButton = ({ Caption, Pressed, Act, Glyph, Disabled, Labelled }) => (
  <button type="button" className={"sfw-tool" + (Labelled ? " labelled" : "") + (Pressed ? " on" : "")} aria-label={Caption} aria-pressed={Pressed === undefined ? undefined : !!Pressed} title={Caption} disabled={Disabled} onClick={Act}>
    <Glyph size={15} />
    {Labelled && <span>{Labelled}</span>}
  </button>
);
const Swatch = ({ Tone }) => <span className="os-swatch" style={{ background: Tone }} />;
function useSift() {
  const [Query, Search] = useState(""), [Filter, Sift] = useState("all");
  const Matches = (Text) => String(Text).toLowerCase().includes(Query.toLowerCase());
  return { Query, Search, Filter, Sift, Matches };
}

// The Object page: what the workspaces are bound to, and the other object workspaces one click away.
function BoundCard({ Subject, Values, Here, OpenStudio, Facts = [] }) {
  const Others = [
    ["uv", "UV", "uv"],
    ["fracture", "Fracture", "fracture"],
    ["nanite", "Nanite", "lod"],
    ["sdf", "Distance field", "sdf"],
  ].filter(([Id]) => Id !== Here);
  return (
    <Card Title="Bound object">
      <div className="os-bound">
        <b>{Subject.Name}</b>
        <small>#{Subject.Id}</small>
      </div>
      <div className="ws-readouts">
        {Facts.map(([Label, Text]) => (
          <Control key={Label} Field={{ Label, Control: "Readout" }} Value={Text} />
        ))}
        <Control Field={{ Label: "Painting and baking", Control: "Readout" }} Value={Values[LayoutKey] ? "through the UV tab's layout" : "through the primitive's own UVs"} />
      </div>
      {OpenStudio && (
        <div className="ws-actions os-open">
          {Others.map(([Id, Caption, Tool]) => (
            <button key={Id} type="button" onClick={() => OpenStudio(Id)}>
              <WorkspaceGlyph Tool={Tool} Size={13} /> {Caption}
            </button>
          ))}
        </div>
      )}
      <p className="card-foot">These tabs change the object itself; switch the object with "Bound to" above, or let it follow the selection.</p>
    </Card>
  );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   UV
//------------------------------------------------------------------------------------------------------------------------

export function UvStudio({ Subject, Values, Change, Material, OpenStudio }) {
  const [Look, SetLook] = useLook({ Tool: "uv", Selection: [], Checker: true, Seams: true, Cells: 8 });
  const [Mode, ChooseMode] = useState("3d");
  const [Skin, ChooseSkin] = useState("checker");
  const Unwrap = UvLayoutOf(Subject, Values);
  const { Layout, Uvs, Edits, Statistics } = Unwrap;
  const Selection = (Look.Selection || []).filter((Index) => Index < Layout.charts.length);
  const Chosen = new Set(Selection);
  const EditsKey = JSON.stringify(Edits);
  const InUse = !!Values[LayoutKey];
  const WriteEdits = (Charts) => Change("UV Layout", { Key: Unwrap.Key, Angle: Unwrap.Angle, Charts });
  const Targets = Selection.length ? Selection : Layout.charts.map((_, Index) => Index);
  const Apply = (Edit) => WriteEdits(Edits.map((Each, Index) => (Targets.includes(Index) ? Edit(Each) : Each)));
  const Pack = () => {
    const Copy = { ...Layout, charts: Layout.charts.map((Chart, Index) => ({ ...Chart, rotation: Edits[Index].R & 3, mirror: Edits[Index].M })) };
    packCharts(Copy);
    WriteEdits(Copy.charts.map((Chart) => ({ R: Chart.rotation, M: !!Chart.mirror, C: Chart.center.slice() })));
  };
  const Select = (Next) => SetLook((Before) => ({ ...Before, Selection: Next }));
  // Each island's share of the 0–1 tile.
  const Areas = useMemo(
    () =>
      Layout.charts.map((Chart) => {
        let Area = 0;
        for (const Triangle of Chart.triangles) {
          const At = Triangle * 6;
          Area += Math.abs((Uvs[At + 2] - Uvs[At]) * (Uvs[At + 5] - Uvs[At + 1]) - (Uvs[At + 4] - Uvs[At]) * (Uvs[At + 3] - Uvs[At + 1])) / 2;
        }
        return Area;
      }),
    [Unwrap.Key, EditsKey],
  );
  // The 3D model: the unwrap with the checker through its UVs; chosen islands tinted amber.
  const Model = useMemo(() => {
    if (Skin !== "checker") return null;
    const Geometry = UnwrapGeometry(Unwrap);
    const Tint = new Float32Array(Layout.triangleCount * 9).fill(1);
    Layout.charts.forEach((Chart, Index) => {
      if (!Chosen.has(Index)) return;
      for (const Triangle of Chart.triangles) for (let K = 0; K < 3; K++) Tint.set([1, 0.72, 0.4], (Triangle * 3 + K) * 3);
    });
    Geometry.setAttribute("color", new THREE.BufferAttribute(Tint, 3));
    const Texture = new THREE.CanvasTexture(CheckerTexture(Look.Cells || 8));
    Texture.colorSpace = THREE.SRGBColorSpace;
    Texture.anisotropy = 4;
    const Checkered = new THREE.Mesh(Geometry, new THREE.MeshStandardMaterial({ map: Texture, vertexColors: true, roughness: 0.62 }));
    Checkered.castShadow = Checkered.receiveShadow = true;
    return Checkered;
  }, [Skin, Unwrap.Key, EditsKey, Selection.join(), Look.Cells]);
  useDisposal(Model);
  const Bound = useMemo(() => ({ Name: Subject.Name, Key: Unwrap.Key + EditsKey, Unwrapped: true, Make: () => ForPreview(UnwrapGeometry(Unwrap)) }), [Unwrap.Key, EditsKey, Subject.Name]);
  // Picking an island in 3D: the triangle under the click names its island.
  const IslandOfTriangle = useMemo(() => {
    const Owner = new Int32Array(Layout.triangleCount);
    Layout.charts.forEach((Chart, Index) => Chart.triangles.forEach((Triangle) => (Owner[Triangle] = Index)));
    return Owner;
  }, [Unwrap.Key]);
  const PickIsland = (Hit, Event) => {
    if (!Hit) return Event.shiftKey ? null : Select([]);
    const Island = IslandOfTriangle[Hit.Face];
    if (Event.shiftKey || Event.ctrlKey || Event.metaKey) Select(Chosen.has(Island) ? Selection.filter((Each) => Each !== Island) : [...Selection, Island]);
    else Select([Island]);
  };

  const Sift = useSift();
  const Rows = Layout.charts
    .map((Chart, Index) => ({
      Id: "island-" + Index,
      Name: "Island " + (Index + 1),
      Label: "UV island " + (Index + 1),
      Detail: `${Chart.triangles.length} triangles · ${(Areas[Index] * 100).toFixed(1)}% of the tile${Edits[Index].R & 3 ? ` · ${(Edits[Index].R & 3) * 90}°` : ""}${Edits[Index].M ? " · mirrored" : ""}`,
      Picture: <Swatch Tone={`hsl(${Hue(Index)} 40% 55%)`} />,
      Chosen: Chosen.has(Index),
      Pick: (Event) => (Event?.shiftKey || Event?.ctrlKey || Event?.metaKey ? Select(Chosen.has(Index) ? Selection.filter((Each) => Each !== Index) : [...Selection, Index]) : Select([Index])),
    }))
    .filter((Row) => Sift.Matches(Row.Name) && (Sift.Filter === "visible" ? Row.Chosen : Sift.Filter === "hidden" ? !Row.Chosen : true));
  const Outliner = (
    <ArtworkOutliner
      Title="UV islands"
      Detail={`${Layout.charts.length} islands · ${(Statistics.uvArea * 100).toFixed(1)}% of the tile used`}
      Tallies={[
        ["Islands", Layout.charts.length, () => Select(Layout.charts.map((_, Index) => Index)), "Select every island"],
        ["Chosen", Selection.length, () => Select([]), "Clear the island selection"],
      ]}
      {...Sift}
      Label="UV islands"
      Rows={Rows}
      Empty="No island matches"
      Footer={
        <>
          <span>
            <small>Seams</small>
            <b>{Layout.seams.length}</b>
          </span>
          <span>
            <small>Shift-click</small>Adds an island to the selection
          </span>
        </>
      }
    />
  );
  const Header = (
    <ViewportHeader
      Picture={<Picture Tool="uv" />}
      Name={<span className="sfw-view-name">{Subject.Name}</span>}
      Detail={<span role="status">{`UV · ${Layout.charts.length} islands · ${Selection.length ? Selection.length + " chosen" : "none chosen · edits apply to all"}`}</span>}
      Badge={InUse ? "Painting through this layout" : null}
      ModesLabel="UV view"
      Modes={[
        ["3d", "3D", Mode === "3d", () => ChooseMode("3d")],
        ["split", "Split", Mode === "split", () => ChooseMode("split")],
        ["uv", "UV", Mode === "uv", () => ChooseMode("uv")],
      ]}
      Actions={null}
      Primary={
        <button type="button" className={"sfw-apply" + (InUse ? " on" : "")} aria-pressed={InUse} onClick={() => Change(LayoutKey, !InUse)} title={InUse ? "Texture paint and Baking read this layout · press to go back to the primitive's own UVs" : "Paint and bake this object through this layout"}>
          {InUse ? <Check size={14} /> : <WorkspaceGlyph Tool="uv" Size={14} />} {InUse ? "Layout in use" : "Use for paint & bake"}
        </button>
      }
      Tools={
        <>
          <span className="sfw-view-family" role="group" aria-label="Island edits">
            <ToolButton Caption="Rotate 90°" Glyph={RotateCw} Act={() => Apply((Each) => ({ ...Each, R: (Each.R + 1) & 3 }))} />
            <ToolButton Caption="Mirror U" Glyph={FlipHorizontal2} Act={() => Apply((Each) => ({ ...Each, M: !Each.M }))} />
            <ToolButton Caption="Pack islands" Glyph={LayoutGrid} Act={Pack} />
          </span>
          <span className="sfw-view-divider" />
          <span className="sfw-view-family" role="group" aria-label="UV display">
            <ToolButton Caption="Show seams" Glyph={Grid3x3} Pressed={Look.Seams !== false} Act={() => SetLook((Before) => ({ ...Before, Seams: Before.Seams === false }))} />
          </span>
        </>
      }
      Trailing={
        Mode === "3d" ? (
          <span className="sfw-view-modes os-skin" role="group" aria-label="Surface">
            <button type="button" className={Skin === "checker" ? "active" : ""} aria-pressed={Skin === "checker"} onClick={() => ChooseSkin("checker")}>
              Checker
            </button>
            <button type="button" className={Skin === "material" ? "active" : ""} aria-pressed={Skin === "material"} onClick={() => ChooseSkin("material")}>
              Material
            </button>
          </span>
        ) : (
          <span className="sfw-view-note">Drag islands in UV space</span>
        )
      }
    />
  );
  const Centre =
    Mode === "3d" ? (
      <ShaderViewport
        Material={Material}
        Eyebrow={"UV / " + (Skin === "checker" ? "CHECKER" : "MATERIAL")}
        Title={Subject.Name}
        Note={`${Layout.charts.length} islands · ${(Statistics.uvArea * 100).toFixed(1)}% of the tile · click an island to choose it`}
        Shape={BoundShape}
        ChooseShape={() => {}}
        Bound={Bound}
        Model={Model}
        ModelKey={Unwrap.Key}
        Pick={Skin === "checker" ? PickIsland : null}
      />
    ) : (
      <UvView Subject={Subject} Values={Values} Change={Change} Workspace={Look} SetWorkspace={SetLook} Panes={Mode === "uv" ? "uv" : "both"} />
    );
  const Pages = [
    { Id: "unwrap", Label: "Unwrap" },
    { Id: "bound", Label: "Target" },
  ];
  const PageBodies = [
    <UvPanel Subject={Subject} Values={Values} Change={Change} Workspace={Look} SetWorkspace={SetLook} Kit={Kit} />,
    <>
      <Card Title="Paint and bake through">
        <Control Field={{ Label: "Use this layout", Control: "Switch" }} Value={InUse} Change={(Next) => Change(LayoutKey, !!Next)} />
        <p className="card-foot">On: Texture paint and Baking draw {Subject.Name} through this unwrap. Its islands never overlap, so every object can be baked. Off: the primitive's own UVs.</p>
      </Card>
      <BoundCard Subject={Subject} Values={Values} Here="uv" OpenStudio={OpenStudio} Facts={[["Islands", String(Layout.charts.length)], ["Triangles", Layout.triangleCount.toLocaleString("en-US")]]} />
    </>,
  ];
  return (
    <StudioDocks
      Studio="uv"
      Owner="UV"
      OutlinerName="Outliner"
      Outliner={Outliner}
      Header={Header}
      Centre={Centre}
      Foot={Mode === "3d" ? "Click an island to choose it · Shift-click adds · drag to orbit" : "Drag islands in UV space · Shift-click adds to the selection · the object pane orbits"}
      Pages={Pages}
      PageBodies={PageBodies}
    />
  );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   FRACTURE
//------------------------------------------------------------------------------------------------------------------------

// The pieces as three.js meshes, pushed apart from their impact by Explode as the diagram does; outer faces take the material's
// fills, inner (cut) faces the fracture material's tone.
function PiecesModel(Result, Settings, Owner, Explode, Material, Points, ChosenPiece) {
  const Group = new THREE.Group();
  const Radius = Math.hypot(...Owner.Scale) / 2;
  const Offset = (Cell) => {
    if (!Settings.Enabled) return [0, 0, 0];
    const From = Result.impacts?.[Cell.nearest] || Result.impact || [0, 0, 0];
    const D = [Cell.centroid[0] - From[0] * 0.3, Cell.centroid[1] - From[1] * 0.3, Cell.centroid[2] - From[2] * 0.3];
    const Length = Math.hypot(...D) || 1;
    return D.map((Each) => (Each / Length) * Explode * Radius * (0.4 + Length / Radius));
  };
  const Outer = PlainLook(Material, MATERIAL[Settings.Material]?.tone);
  const Inner = new THREE.MeshStandardMaterial({ color: "#b9a48c", roughness: 0.92 });
  const Lit = Outer.clone();
  Lit.emissive = new THREE.Color("#ff9a2e");
  Lit.emissiveIntensity = 0.45;
  const LitInner = Inner.clone();
  LitInner.emissive = new THREE.Color("#ff9a2e");
  LitInner.emissiveIntensity = 0.45;
  Result.cells.forEach((Cell, Index) => {
    const Sides = { outer: [], inner: [] };
    for (const Face of Cell.faces) {
      if (Face.pts.length < 3) continue;
      const List = Face.kind === "inner" ? Sides.inner : Sides.outer;
      for (let K = 1; K < Face.pts.length - 1; K++) List.push(...Face.pts[0], ...Face.pts[K], ...Face.pts[K + 1]);
    }
    const Positions = new Float32Array([...Sides.outer, ...Sides.inner]);
    if (!Positions.length) return;
    const Geometry = new THREE.BufferGeometry();
    Geometry.setAttribute("position", new THREE.BufferAttribute(Positions, 3));
    Geometry.addGroup(0, Sides.outer.length / 3, 0);
    Geometry.addGroup(Sides.outer.length / 3, Sides.inner.length / 3, 1);
    Geometry.computeVertexNormals();
    const Picked = Index === ChosenPiece;
    const Piece = new THREE.Mesh(Geometry, Picked ? [Lit, LitInner] : [Outer, Inner]);
    const Shift = Offset(Cell);
    Piece.position.set(...Shift);
    Piece.userData.Cell = Index;
    Piece.userData.Shift = Shift;
    Piece.castShadow = Piece.receiveShadow = true;
    Group.add(Piece);
  });
  // Fracture point markers (not pickable), sized to the object.
  if (Settings.Enabled)
    Points.forEach((Point, Index) => {
      const Marker = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.012, Radius * 0.045), 16, 12), new THREE.MeshBasicMaterial({ color: PointTone(Index), depthTest: false }));
      Marker.position.set(Point.X, Point.Y, Point.Z);
      Marker.renderOrder = 5;
      Marker.userData.debug = true;
      Group.add(Marker);
    });
  return Group;
}

export function FractureStudio({ Subject, Values, Change, Material, OpenStudio }) {
  const [Look, SetLook] = useLook({ Tool: "fracture", Explode: 0.25, FracturePoint: 0, FractureClick: "add" });
  const [Mode, ChooseMode] = useState("3d");
  const [ChosenPiece, ChoosePiece] = useState(-1);
  const { Owner, Settings, Result } = useShatter(Subject, Values);
  const List = PointsOf(Settings);
  const Selected = Math.min(Look.FracturePoint ?? 0, List.length - 1);
  const Explode = Look.Explode ?? 0.25;
  const Store = (Next) => Change("Fracture", { ...Settings, ...PointsPatch(Next), EditedAt: Date.now() });
  const Assign = (Patch) => Change("Fracture", { ...Settings, ...Patch, EditedAt: Date.now() });
  const ClickMode = (Look.FractureClick || "add") === "add" && List.length < MAX_POINTS ? "add" : "move";
  const Fill = Material?.Channels?.colour?.Fill;
  const Model = useMemo(() => PiecesModel(Result, Settings, Owner, Explode, Material, List, ChosenPiece), [Result, Settings.Enabled, Explode, Fill, Material?.Channels?.roughness?.Fill, Material?.Channels?.metallic?.Fill, JSON.stringify(List), ChosenPiece]);
  useDisposal(Model);
  // A click on a piece places a fracture point where it was hit (in the unexploded object), as the diagram does.
  const Place = (Hit) => {
    if (!Hit || !Settings.Enabled) return;
    const Shift = Hit.Part.userData.Shift || [0, 0, 0];
    const At = [0, 1, 2].map((Axis) => +(Hit.Point.getComponent(Axis) - Shift[Axis]).toFixed(3));
    ChoosePiece(Hit.Part.userData.Cell ?? -1);
    if (ClickMode === "add") {
      Store([...List, { X: At[0], Y: At[1], Z: At[2], Energy: List[Selected]?.Energy ?? 2500 }]);
      SetLook((Before) => ({ ...Before, FracturePoint: List.length }));
    } else Store(List.map((Each, Slot) => (Slot === Selected ? { ...Each, X: At[0], Y: At[1], Z: At[2] } : Each)));
  };

  const Sift = useSift();
  const [Folded, Fold] = useState({ pieces: Result.cells.length > 24 });
  const PointRows = List.map((Each, Index) => ({
    Id: "point-" + Index,
    Name: "Point " + (Index + 1),
    Label: "Fracture point " + (Index + 1),
    Detail: `${Each.X.toFixed(2)}, ${Each.Y.toFixed(2)}, ${Each.Z.toFixed(2)} m · ${Math.round(Each.Energy).toLocaleString("en-US")} J`,
    Picture: <Swatch Tone={PointTone(Index)} />,
    Depth: 1,
    Chosen: Index === Selected,
    Pick: () => SetLook((Before) => ({ ...Before, FracturePoint: Index })),
  })).filter((Row) => Sift.Matches(Row.Name));
  const Biggest = Math.max(...Result.cells.map((Cell) => Cell.size)) || 1;
  const PieceRows = Result.cells
    .map((Cell, Index) => ({
      Id: "piece-" + Index,
      Name: "Piece " + (Index + 1),
      Label: "Fracture piece " + (Index + 1),
      Detail: `${FormatLength(Cell.size)} · ${Cell.faces.filter((Face) => Face.kind === "inner").length} cut faces`,
      Picture: <Swatch Tone={`hsl(28 30% ${Math.round(30 + 40 * (Cell.size / Biggest))}%)`} />,
      Depth: 1,
      Chosen: Index === ChosenPiece,
      Pick: () => ChoosePiece(Index === ChosenPiece ? -1 : Index),
    }))
    .filter((Row) => Sift.Matches(Row.Name));
  const Folder = (Id, Name, Detail, Tool) => ({ Id, Name, Detail, Folder: true, Folded: !!Folded[Id], Fold: () => Fold((Before) => ({ ...Before, [Id]: !Before[Id] })), Picture: <WorkspaceGlyph Tool={Tool} Size={15} />, Pick: () => Fold((Before) => ({ ...Before, [Id]: !Before[Id] })) });
  const Rows = Settings.Enabled
    ? [
        Folder("points", "Fracture points", `${List.length} of ${MAX_POINTS}`, "fracture"),
        ...(Folded.points ? [] : PointRows),
        Folder("pieces", "Pieces", `${Result.cells.length} pieces · ${MATERIAL[Settings.Material].name}`, "collision"),
        ...(Folded.pieces ? [] : PieceRows),
      ]
    : [];
  const Outliner = (
    <ArtworkOutliner
      Title="Fracture"
      Detail={Settings.Enabled ? `${Result.cells.length} pieces · ${List.length} point${List.length === 1 ? "" : "s"}` : "Fracture is off"}
      Tallies={[
        ["Pieces", Settings.Enabled ? Result.cells.length : 0, () => ChoosePiece(-1), "Clear the chosen piece"],
        ["Points", List.length, () => SetLook((Before) => ({ ...Before, FracturePoint: 0 })), "Choose the first point"],
      ]}
      {...Sift}
      Label="Fracture points and pieces"
      Rows={Rows}
      Empty={Settings.Enabled ? "Nothing matches" : "Turn fracture on to shatter this object"}
      Footer={
        <>
          <span>
            <small>Click</small>
            {ClickMode === "add" ? "adds a point" : `moves point ${Selected + 1}`}
          </span>
        </>
      }
    />
  );
  const Header = (
    <ViewportHeader
      Picture={<Picture Tool="fracture" />}
      Name={<span className="sfw-view-name">{Subject.Name}</span>}
      Detail={<span role="status">{Settings.Enabled ? `Fracture · ${Result.cells.length} pieces · ${MATERIAL[Settings.Material].name}` : "Fracture · off"}</span>}
      ModesLabel="Fracture view"
      Modes={[
        ["3d", "3D", Mode === "3d", () => ChooseMode("3d")],
        ["diagram", "Diagram", Mode === "diagram", () => ChooseMode("diagram")],
      ]}
      Actions={null}
      Primary={
        <button type="button" className={"sfw-apply" + (Settings.Enabled ? " on" : "")} aria-pressed={Settings.Enabled} onClick={() => Assign({ Enabled: !Settings.Enabled })}>
          {Settings.Enabled ? <Check size={14} /> : <WorkspaceGlyph Tool="fracture" Size={14} />} {Settings.Enabled ? "Fracture on" : "Enable fracture"}
        </button>
      }
      Tools={
        <span className="sfw-view-family" role="group" aria-label="Clicking the object">
          <ToolButton Caption="Click adds a point" Glyph={MousePointerClick} Pressed={ClickMode === "add"} Disabled={!Settings.Enabled || List.length >= MAX_POINTS} Act={() => SetLook((Before) => ({ ...Before, FractureClick: "add" }))} />
          <ToolButton Caption={`Click moves point ${Selected + 1}`} Glyph={Move} Pressed={ClickMode === "move"} Disabled={!Settings.Enabled} Act={() => SetLook((Before) => ({ ...Before, FractureClick: "move" }))} />
          <ToolButton Caption="New seed" Glyph={Dices} Disabled={!Settings.Enabled} Act={() => Assign({ Seed: 1 + Math.floor(Math.random() * 9998) })} />
        </span>
      }
      Trailing={
        <label className="pw-size" title="Explode view">
          <input type="range" aria-label="Explode view" min={0} max={1} step={0.01} value={Explode} style={{ "--fill": Explode * 100 + "%" }} onChange={(Event) => SetLook((Before) => ({ ...Before, Explode: +Event.target.value }))} />
          <output>{Explode.toFixed(2)}</output>
        </label>
      }
    />
  );
  const Centre =
    Mode === "3d" ? (
      <ShaderViewport
        Material={Material}
        Eyebrow={"FRACTURE / " + (Settings.Enabled ? MATERIAL[Settings.Material].name.toUpperCase() : "OFF")}
        Title={Subject.Name}
        Note={Settings.Enabled ? `${Result.cells.length} pieces · ${List.length} point${List.length === 1 ? "" : "s"} · click a piece to ${ClickMode === "add" ? "add a point" : `move point ${Selected + 1}`}` : "Turn fracture on to shatter this object"}
        Model={Model}
        ModelKey={Subject.Id}
        Bound={{ Name: Subject.Name }}
        Pick={Place}
      />
    ) : (
      <FractureView Subject={Subject} Values={Values} Change={Change} Workspace={Look} SetWorkspace={SetLook} />
    );
  const Pages = [
    { Id: "shatter", Label: "Shatter" },
    { Id: "bound", Label: "Target" },
  ];
  const PageBodies = [
    <FracturePanelBody Subject={Subject} Values={Values} Change={Change} Workspace={Look} SetWorkspace={SetLook} Kit={Kit} />,
    <BoundCard Subject={Subject} Values={Values} Here="fracture" OpenStudio={OpenStudio} Facts={[["Pieces", Settings.Enabled ? String(Result.cells.length) : "–"], ["Size", Owner.Scale.map((Each) => Each.toFixed(2)).join(" × ") + " m"]]} />,
  ];
  return (
    <StudioDocks
      Studio="fracture"
      Owner="Fracture"
      OutlinerName="Outliner"
      Outliner={Outliner}
      Header={Header}
      Centre={Centre}
      Foot={Mode === "3d" ? "Click a piece to place a point · drag to orbit · the chosen piece glows" : "Drag a marker to move it · click the object to add or move a point"}
      Pages={Pages}
      PageBodies={PageBodies}
    />
  );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   NANITE (Geometry Compiler)
//------------------------------------------------------------------------------------------------------------------------

// The triangles of the current cut, one colour per cluster (or level, group, part), with the triangle edges over them.
function CutModel(Build, Current, Colouring, Wire) {
  const H = Build.Dag, P = Build.Body.Positions;
  const Positions = [], Colours = [], Tone = new THREE.Color();
  for (const [First, Count] of Current.Ranges)
    for (let Corner = First; Corner < First + Count; Corner += 3) {
      const Cluster = H.cornerCluster[Corner];
      if (Colouring === 1) Tone.set(LevelTones[H.clusterLevel[Cluster] % LevelTones.length]);
      else {
        const Index = Colouring === 2 ? Math.max(0, H.clusterGroupSelf[Cluster]) + 7 : Colouring === 3 ? Math.max(0, H.clusterFamily[Cluster]) * 3 + 2 : Cluster;
        Tone.setHSL(Hue(Index) / 360, 0.4, 0.55);
      }
      for (let Offset = 0; Offset < 3; Offset++) {
        const V = H.cornerVertex[Corner + Offset] * 3;
        Positions.push(P[V], P[V + 1], P[V + 2]);
        Colours.push(Tone.r, Tone.g, Tone.b);
      }
    }
  const Geometry = new THREE.BufferGeometry();
  Geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(Positions), 3));
  Geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(Colours), 3));
  Geometry.computeVertexNormals();
  const Group = new THREE.Group();
  const Surface = new THREE.Mesh(Geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true }));
  Surface.castShadow = Surface.receiveShadow = true;
  Group.add(Surface);
  if (Wire) {
    const Edges = new THREE.Mesh(Geometry.clone(), new THREE.MeshBasicMaterial({ color: "#000000", wireframe: true, transparent: true, opacity: 0.28 }));
    Edges.userData.debug = true;
    Group.add(Edges);
  }
  return Group;
}

export function NaniteStudio({ Subject, Values, Change, Material, OpenStudio }) {
  const [Look, SetLook] = useLook({ Tool: "lod" });
  const [Mode, ChooseMode] = useState("3d");
  const Build = useClusters(Subject, Values);
  const { Settings, Dag } = Build;
  const Current = Dag ? Cut(Build, Look) : null;
  const Level = Look.LodLevel ?? -1, Colouring = Look.LodColour ?? 0, Wire = Look.LodWire !== false;
  const Patch = (Next) => SetLook((Before) => ({ ...Before, ...Next }));
  const CutKey = Current ? Current.Ranges.map((Each) => Each.join(":")).join() : "";
  const Model = useMemo(() => (Current ? CutModel(Build, Current, Colouring, Wire) : null), [Build.Key, CutKey, Colouring, Wire]);
  useDisposal(Model);
  const Source = Build.Body.Indices.length / 3;

  const Sift = useSift();
  const Rows = Dag
    ? [
        {
          Id: "level-auto",
          Name: "Error cut",
          Label: "Automatic level by screen error",
          Detail: Current ? `${Current.Triangles.toLocaleString("en-US")} triangles · ${Current.Clusters.size} clusters` : "–",
          Picture: <WorkspaceGlyph Tool="lod" Size={15} />,
          Chosen: Level < 0,
          Pick: () => Patch({ LodLevel: -1 }),
        },
        ...Dag.levels
          .map((Each, Index) => ({
            Id: "level-" + Index,
            Name: "Level " + Index + (Index === 0 ? " · full detail" : Index === Dag.levels.length - 1 ? " · coarsest" : ""),
            Label: "Force level " + Index,
            Detail: `${Each.clusters} clusters · ${Each.triangles.toLocaleString("en-US")} triangles · error ${ErrorText(Each.error, Index)}`,
            Picture: <Swatch Tone={LevelTones[Index % LevelTones.length]} />,
            Depth: 1,
            Chosen: Level === Index,
            Picked: Level < 0 && !!Current?.LevelClusters[Index],
            Pick: () => Patch({ LodLevel: Level === Index ? -1 : Index }),
          }))
          .filter((Row) => Sift.Matches(Row.Name)),
      ]
    : [];
  const Outliner = (
    <ArtworkOutliner
      Title="Cluster DAG"
      Detail={Dag ? `${Dag.levels.length} levels · ${Dag.clusterCount} clusters · ${Dag.groupCount} groups` : Build.Problem || "Building…"}
      Tallies={[
        ["Levels", Dag ? Dag.levels.length : 0, () => Patch({ LodLevel: -1 }), "Back to the automatic error cut"],
        ["In the cut", Current ? Current.Clusters.size : 0, () => Patch({ LodLevel: -1 }), "Clusters drawn now"],
      ]}
      {...Sift}
      Label="Cluster DAG levels"
      Rows={Rows}
      Empty={Build.Problem || "No level matches"}
      Footer={
        <>
          <span>
            <small>Source</small>
            <b>{Source.toLocaleString("en-US")}</b>
          </span>
          <span>
            <small>Pick a level</small>Forces the cut to it
          </span>
        </>
      }
    />
  );
  const Colourings = ["Cluster", "Level", "Group", "Part"];
  const Bake = () => Change(ClusterKey, { ...Settings, Baked: { Signature: Build.Signature, At: Date.now(), Levels: Dag.levels.length, Clusters: Dag.clusterCount, Groups: Dag.groupCount } });
  const Header = (
    <ViewportHeader
      Picture={<Picture Tool="lod" />}
      Name={<span className="sfw-view-name">{Subject.Name}</span>}
      Detail={<span role="status">{Current ? `Nanite · ${Current.Triangles.toLocaleString("en-US")} of ${Source.toLocaleString("en-US")} triangles · ${Current.Clusters.size} clusters` : Build.Problem || "Building clusters…"}</span>}
      Badge={Build.Standing === "ready" ? "Baked" : Build.Standing === "stale" ? "Bake out of date" : null}
      ModesLabel="Nanite view"
      Modes={[
        ["3d", "3D", Mode === "3d", () => ChooseMode("3d")],
        ["dag", "DAG", Mode === "dag", () => ChooseMode("dag")],
      ]}
      Actions={null}
      Primary={
        <button type="button" className="sfw-apply" disabled={!Dag} onClick={Bake} title="Stamp the cluster DAG on the object (the Geometry Compiler builds it from these settings)">
          <WorkspaceGlyph Tool="lod" Size={14} /> {Build.Standing === "ready" ? "Bake again" : "Bake clusters"}
        </button>
      }
      Tools={
        <span className="sfw-view-modes os-skin" role="group" aria-label="Colour by">
          {Colourings.map((Caption, Index) => (
            <button key={Caption} type="button" className={Colouring === Index ? "active" : ""} aria-pressed={Colouring === Index} onClick={() => Patch({ LodColour: Index })}>
              {Caption}
            </button>
          ))}
        </span>
      }
      Trailing={<ToolButton Caption="Triangle edges" Glyph={Grid3x3} Pressed={Wire} Act={() => Patch({ LodWire: !Wire })} />}
    />
  );
  const Centre =
    Mode === "3d" ? (
      Model ? (
        <ShaderViewport
          Material={Material}
          Eyebrow={"NANITE / " + (Level < 0 ? "ERROR CUT" : "LEVEL " + Level)}
          Title={Subject.Name}
          Note={Current ? `${Current.Triangles.toLocaleString("en-US")} triangles · ${Current.Clusters.size} clusters · ${(Look.LodThreshold ?? 1).toFixed(2)} px at ${(Look.LodDistance ?? 4).toFixed(1)} m` : ""}
          Model={Model}
          ModelKey={Subject.Id}
          Bound={{ Name: Subject.Name }}
        />
      ) : (
        <p className="bw-empty">{Build.Problem || "Building clusters…"}</p>
      )
    ) : (
      <ClusterView Subject={Subject} Values={Values} Workspace={Look} SetWorkspace={SetLook} />
    );
  const Pages = [
    { Id: "clusters", Label: "Clusters" },
    { Id: "bound", Label: "Target" },
  ];
  const PageBodies = [
    <ClusterPanel Subject={Subject} Values={Values} Change={Change} Workspace={Look} SetWorkspace={SetLook} Kit={Kit} />,
    <BoundCard Subject={Subject} Values={Values} Here="nanite" OpenStudio={OpenStudio} Facts={[["Source triangles", Source.toLocaleString("en-US")], ["Bake", Build.Standing === "ready" ? "up to date" : Build.Standing === "stale" ? "out of date" : "not baked"]]} />,
  ];
  return (
    <StudioDocks
      Studio="nanite"
      Owner="Nanite"
      OutlinerName="Outliner"
      Outliner={Outliner}
      Header={Header}
      Centre={Centre}
      Foot={Mode === "3d" ? "The cut is chosen for a 1080p view from the inspector's view distance · drag to orbit" : "Cluster DAG · coarsest level on top · lit blocks are drawn"}
      Pages={Pages}
      PageBodies={PageBodies}
    />
  );
}

// What the object workspaces show when the ShaderEditor is not bound to a primitive (a library material or a vehicle mesh).
export function UnboundStudio({ Studio, Subject, Reason }) {
  const Names = { uv: "UV", fracture: "Fracture", nanite: "Nanite" };
  const Tools = { uv: "uv", fracture: "fracture", nanite: "lod" };
  return (
    <div className="surface-workspace scene-studio os-unbound" data-surface-workspace={Studio}>
      <div className="os-unbound-card">
        <WorkspaceGlyph Tool={Tools[Studio]} Size={30} />
        <b>{Names[Studio]} works on a scene object</b>
        <p>
          {Subject.Name} is {Reason}. Choose a primitive with "Bound to", or turn on "Follow selection" and select one in the scene.
        </p>
      </div>
    </div>
  );
}
