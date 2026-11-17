//============================================================================================================================================
//                                                        ROADEDITORSEQUENCE.JS
//============================================================================================================================================
// Dedicated In-World Road Studio Workspace for VehicleProvingGrounds.
// Authors multi-lane cubic Bézier roads, tangent-filleted junctions, and connected steel/concrete girder highway bridges
// DIRECTLY inside the live WebGPU Proving Grounds 3D world (plus linked 2D World Plan), powered by Source/RoadStudio/Core/*.

import { VertexStride, OccupantRole } from "./FacetStructure.js";
import {
    RoadStudioVertexCapacity,
    StudioPointToWorld,
    WorldPointToStudio,
    StudioDirectionToWorld,
    PlaceTemplateInWorld,
    CreateStarterStudioProject,
    CompileStudioProjectForWorld,
    ResolveSpawnPoseForSelection,
    makeDemo,
    makeTemplate,
    parseProject,
    presets,
    patterns,
    patternNames,
    railStyles,
    railNames,
    roadDefaults,
    templateCatalog,
    getNode,
    controlPoints,
    insertRoad,
    splitRoad,
    findSnap,
    sampleAlignment,
    moveNode,
    deleteSelection,
    insertConnectedBridge
} from "./RoadStudioAdapter.js";

export const RoadEditorVertexCapacity = RoadStudioVertexCapacity;

const NewRoadStylePresets = Object.freeze([
    { Id: "boulevard", Label: "Urban Boulevard",   Settings: { lanes: 4, laneWidth: 3.4, median: 1.2, sidewalk: 2.2, curbStyle: "granite", markingStyle: "urban", drainage: false, manholes: false, signs: false } },
    { Id: "street",    Label: "2-Lane Street",     Settings: { lanes: 2, laneWidth: 3.5, sidewalk: 2.0, curbStyle: "granite", markingStyle: "urban", drainage: false, manholes: false, signs: false } },
    { Id: "motorway",  Label: "4-Lane Motorway",   Settings: { lanes: 4, laneWidth: 3.75, median: 1.4, shoulderWidth: 1.4, sidewalk: 0.6, markingStyle: "motorway", guardrails: true, railStyle: "wbeam", drainage: false, manholes: false, signs: false } },
    { Id: "bridge",    Label: "Steel Bridge Span", Settings: { lanes: 2, laneWidth: 3.75, shoulderWidth: 1.2, sidewalk: 0.9, markingStyle: "motorway", bridge: true, bridgeFrom: 0.0, bridgeTo: 1.0, structure: "steel", bridgeDepth: 1.45, pierSpacing: 26, guardrails: true, railStyle: "parapet", drainage: false, manholes: false, signs: false } },
    { Id: "race",      Label: "Grand Prix Kerb",   Settings: { lanes: 2, laneWidth: 4.2, sidewalk: 0.7, curbStyle: "race", markingStyle: "center-only", guardrails: true, railStyle: "thrie", drainage: false, manholes: false, signs: false } },
    { Id: "cycle",     Label: "Protected Cycleway",Settings: { lanes: 2, laneWidth: 3.3, sidewalk: 2.2, cycleMode: "protected", cycleWidth: 2.0, curbStyle: "granite", markingStyle: "urban", drainage: false, manholes: false, signs: false } },
    { Id: "ramp",      Label: "Interchange Ramp",  Settings: { lanes: 1, laneWidth: 4.4, shoulderWidth: 1.0, sidewalk: 0.6, oneWay: true, markingStyle: "motorway", guardrails: true, railStyle: "wbeam", embankment: true, drainage: false, manholes: false, signs: false } }
]);

export class RoadEditorSequence
{
    constructor(Scene, LevelKey = "inversion")
    {
        this.Scene = Scene;
        this.LevelKey = LevelKey;
        this.Host = null;
        this.Enabled = true;
        this.ActiveWorkspace = "proving"; // "proving" | "roadstudio"

        this.ToolMode = "select"; // "select" | "draw" | "bridge" | "split" | "delete"
        this.ActivePresetId = "boulevard";
        this.SnapEnabled = true;
        this.InspectorTab = "geometry"; // "geometry" | "surface" | "bridge" | "details"

        this.Project = CreateStarterStudioProject(LevelKey);
        this.Selection = this.Project.roads[0]
            ? { kind: "road", id: this.Project.roads[0].id }
            : (this.Project.nodes[0] ? { kind: "node", id: this.Project.nodes[0].id } : null);

        this.DrawChainNodeId = null;
        this.HoverWorld = null;
        this.HoverSnap = null;
        this.HoverHit = null;
        this.DragState = null;
        this.PriorFreeCamera = false;
        this.StudioCameraFramed = false;

        // Linked 2D Plan pan/zoom state
        this.PlanCenter = [275.0, 0.0];
        this.PlanScale = 0.72; // px per meter
        this.PlanDrag = null;

        this.UndoStack = [];
        this.RedoStack = [];
        this.Compiled = null;
        this.RegisteredSurfaces = [];
        this.DomBound = false;

        this.RebuildWorldNetwork();
    }

    AttachHost(Host)
    {
        this.Host = Host;
        this.PushGeometryToGpu();
        this.SyncPhysicsSurfaces();
        this.SyncTrafficSignals();
        this.BindWorkspaceDom();
        this.FitPlanToNetwork();
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                              DEDICATED IN-WORLD ROAD STUDIO WORKSPACE SWITCHER
    //--------------------------------------------------------------------------------------------------------------------

    BindWorkspaceDom()
    {
        if (typeof document === "undefined" || this.DomBound)
            return;
        this.DomBound = true;

        const Bar = document.getElementById("workspace-bar");
        if (Bar)
        {
            Bar.querySelectorAll("[data-workspace-tab]").forEach((Btn) =>
            {
                Btn.addEventListener("click", () =>
                {
                    const Target = Btn.getAttribute("data-workspace-tab");
                    if (Target === "roadstudio")
                        this.OpenWorkspace();
                    else
                        this.CloseWorkspace();
                });
            });

            const OpenBtn = Bar.querySelector("[data-workspace-action='open-studio']");
            if (OpenBtn)
            {
                OpenBtn.addEventListener("click", () =>
                {
                    if (this.ActiveWorkspace === "roadstudio")
                        this.CloseWorkspace();
                    else
                        this.OpenWorkspace();
                });
            }

            const DriveBtn = Bar.querySelector("[data-workspace-action='drive-network']");
            if (DriveBtn)
            {
                DriveBtn.addEventListener("click", () =>
                {
                    this.CloseWorkspace();
                    this.DriveOnSelectedRoad();
                });
            }

            const DDayBtn = Bar.querySelector("[data-workspace-action='open-dday']");
            if (DDayBtn)
            {
                if (this.LevelKey === "dday")
                    DDayBtn.textContent = "⚔️ Reset Assault";
                DDayBtn.addEventListener("click", () =>
                {
                    this.CloseWorkspace();
                    if (this.LevelKey === "dday")
                    {
                        this.Host?.DDay?.ResetAssault(true);
                    }
                    else if (this.Host)
                    {
                        this.Host.Settings.Level = "dday";
                        this.Host.ApplySetting("Level");
                    }
                });
            }

            const CityBtn = Bar.querySelector("[data-workspace-action='open-city-pursuit']");
            if (CityBtn)
            {
                if (this.LevelKey === "city")
                    CityBtn.textContent = "🧠 AI Self-Train";
                CityBtn.addEventListener("click", () =>
                {
                    this.CloseWorkspace();
                    if (this.LevelKey === "city")
                    {
                        this.Host?.Police?.ToggleSelfPlayMode();
                    }
                    else if (this.Host)
                    {
                        this.Host.Settings.Level = "city";
                        this.Host.ApplySetting("Level");
                    }
                });
            }
        }

        const FitBtn = document.getElementById("studio-plan-fit");
        if (FitBtn)
            FitBtn.addEventListener("click", () => { this.FitPlanToNetwork(); this.RenderPlanCanvas(); });

        this.BuildStudioToolbar();
        this.BuildStudioInspectorTabs();
        this.BindViewportGizmoEvents();
        this.BindPlanCanvasEvents();
        this.RefreshStudioPanels();
        this.UpdateWorkspaceBarUi();
    }

    UpdateWorkspaceBarUi()
    {
        if (typeof document === "undefined")
            return;

        const IsStudio = this.ActiveWorkspace === "roadstudio";
        document.body?.classList.toggle("workspace-road-studio", IsStudio);

        const ModePill = document.getElementById("viewport-mode-pill");
        if (ModePill)
            ModePill.textContent = IsStudio ? "Road Studio · Live World"
                                 : (this.LevelKey === "dday" ? "D-Day Assault" : (this.LevelKey === "city" ? "City Pursuit & AI" : "Proving Grounds"));
        this.Host?.DDay?.RefreshControlStrip?.();

        const Bar = document.getElementById("workspace-bar");
        if (!Bar)
            return;

        Bar.querySelectorAll("[data-workspace-tab]").forEach((Btn) =>
        {
            const Active = Btn.getAttribute("data-workspace-tab") === this.ActiveWorkspace;
            Btn.classList.toggle("active", Active);
            Btn.setAttribute("aria-selected", Active ? "true" : "false");
        });

        const OpenBtn = Bar.querySelector("[data-workspace-action='open-studio']");
        if (OpenBtn)
            OpenBtn.textContent = IsStudio ? "Back to Driving" : "Road Studio";

        const Meta = document.getElementById("workspace-network-meta");
        if (Meta)
        {
            const S = this.QuerySummary();
            Meta.textContent = `${S.ProjectName} · ${S.RoadCount} road${S.RoadCount === 1 ? "" : "s"} · ${S.BridgeCount} bridge${S.BridgeCount === 1 ? "" : "s"}`;
        }
    }

    OpenWorkspace()
    {
        this.SetActiveWorkspace("roadstudio");
        return true;
    }

    CloseWorkspace()
    {
        this.SetActiveWorkspace("proving");
        return false;
    }

    ToggleWorkspace()
    {
        if (this.ActiveWorkspace === "roadstudio")
        {
            this.CloseWorkspace();
            return false;
        }
        this.OpenWorkspace();
        return true;
    }

    ToggleFloatingStudio()
    {
        return this.ToggleWorkspace();
    }

    SetActiveWorkspace(Mode)
    {
        const Next = Mode === "roadstudio" ? "roadstudio" : "proving";
        if (this.ActiveWorkspace === Next)
            return;
        this.ActiveWorkspace = Next;
        this.DrawChainNodeId = null;
        this.DragState = null;

        if (this.Host)
        {
            if (Next === "roadstudio")
            {
                this.PriorFreeCamera = Boolean(this.Host.FreeCamera);
                this.Host.AssignCamera(true);
                if (!this.StudioCameraFramed)
                {
                    this.FrameNetworkIn3D();
                    this.StudioCameraFramed = true;
                }
            }
            else if (!this.PriorFreeCamera)
            {
                this.Host.AssignCamera(false);
            }
            this.Host.PriorValid = false;
        }

        this.UpdateWorkspaceBarUi();
        this.RefreshStudioPanels();
    }

    FrameNetworkIn3D(TargetWorld = null)
    {
        if (!this.Host?.Flight)
            return;
        this.Host.AssignCamera(true);
        const Anchor = this.Compiled?.Anchor ?? [0.0, 0.0, 0.0];
        if (TargetWorld)
        {
            const Eye = [TargetWorld[0] - 52.0, TargetWorld[1] - 46.0, Math.max(26.0, TargetWorld[2] + 28.0)];
            this.Host.Flight.AssignFromChase(Eye, TargetWorld);
            this.Host.PriorValid = false;
            return;
        }
        const B = this.Compiled?.Network?.bounds;
        if (B && Number.isFinite(B.min[0]))
        {
            const CX = Anchor[0] + 0.5 * (B.min[0] + B.max[0]);
            const CY = Anchor[1] - 0.5 * (B.min[2] + B.max[2]);
            const Span = Math.max(90.0, Math.hypot(B.max[0] - B.min[0], B.max[2] - B.min[2]));
            const Dist = Math.min(260.0, Span * 0.55);
            this.Host.Flight.AssignFromChase([CX - Dist * 0.72, CY - Dist * 0.62, Math.max(38.0, Dist * 0.48)], [CX, CY, 2.0]);
        }
        else
        {
            this.Host.Flight.AssignFromChase([200.0, -76.0, 52.0], [288.0, 4.0, 2.0]);
        }
        this.Host.PriorValid = false;
    }

    HandleStudioKeyDown(Event)
    {
        if (this.ActiveWorkspace !== "roadstudio")
            return false;
        if ((Event.ctrlKey || Event.metaKey) && Event.code === "KeyZ")
        {
            Event.preventDefault();
            if (Event.shiftKey) this.Redo();
            else this.Undo();
            return true;
        }
        if ((Event.ctrlKey || Event.metaKey) && Event.code === "KeyY")
        {
            Event.preventDefault();
            this.Redo();
            return true;
        }
        if (Event.code === "Escape")
        {
            if (this.DrawChainNodeId)
            {
                this.DrawChainNodeId = null;
                return true;
            }
            return false;
        }
        if ((Event.code === "Delete" || Event.code === "Backspace") && !Event.repeat)
        {
            Event.preventDefault();
            this.DeleteSelected();
            return true;
        }
        return false;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                              3D CAMERA PROJECTION, RAYCASTING & IN-WORLD AUTHORING
    //--------------------------------------------------------------------------------------------------------------------

    ProjectWorldPoint(WorldPt, Width, Height, Cam = this.Host?.CameraState)
    {
        if (!Cam)
            return null;
        const RX = WorldPt[0] - Cam.Position[0];
        const RY = WorldPt[1] - Cam.Position[1];
        const RZ = WorldPt[2] - Cam.Position[2];
        const Depth = RX * Cam.Forward[0] + RY * Cam.Forward[1] + RZ * Cam.Forward[2];
        if (Depth <= 0.2)
            return null;
        const RightProj = RX * Cam.Right[0] + RY * Cam.Right[1] + RZ * Cam.Right[2];
        const UpProj    = RX * Cam.Up[0]    + RY * Cam.Up[1]    + RZ * Cam.Up[2];
        const NdcX = RightProj / (Depth * Cam.TanY * Cam.Aspect);
        const NdcY = UpProj    / (Depth * Cam.TanY);
        return [
            (NdcX * 0.5 + 0.5) * Width,
            (0.5 - NdcY * 0.5) * Height,
            Depth
        ];
    }

    ScreenToWorldRay(LocalX, LocalY, Width, Height, Cam = this.Host?.CameraState)
    {
        if (!Cam)
            return null;
        const NX = (LocalX / Math.max(Width, 1.0)) * 2.0 - 1.0;
        const NY = 1.0 - (LocalY / Math.max(Height, 1.0)) * 2.0;
        const ScaleR = NX * Cam.TanY * Cam.Aspect;
        const ScaleU = NY * Cam.TanY;
        let DX = Cam.Forward[0] + Cam.Right[0] * ScaleR + Cam.Up[0] * ScaleU;
        let DY = Cam.Forward[1] + Cam.Right[1] * ScaleR + Cam.Up[1] * ScaleU;
        let DZ = Cam.Forward[2] + Cam.Right[2] * ScaleR + Cam.Up[2] * ScaleU;
        const Len = Math.hypot(DX, DY, DZ) || 1.0;
        return {
            Origin: Cam.Position,
            Dir:    [DX / Len, DY / Len, DZ / Len]
        };
    }

    IntersectRayPlaneZ(Ray, PlaneZ = 0.0)
    {
        if (!Ray || Math.abs(Ray.Dir[2]) < 1.0e-4)
            return null;
        const T = (PlaneZ - Ray.Origin[2]) / Ray.Dir[2];
        if (T < 0.25 || T > 3200.0)
            return null;
        return [
            Ray.Origin[0] + Ray.Dir[0] * T,
            Ray.Origin[1] + Ray.Dir[1] * T,
            PlaneZ
        ];
    }

    HitTestGizmos3D(Sx, Sy, Width, Height)
    {
        const Cam = this.Host?.CameraState;
        if (!Cam || !this.Project)
            return null;
        const Anchor = this.Compiled?.Anchor ?? [0.0, 0.0, 0.0];

        // ① Tangent handles (`h1`, `h2`) of selected road first so sculpting curves is effortless
        const SelectedRoad = this.GetSelectedRoad();
        if (SelectedRoad && this.ToolMode === "select")
        {
            const Pts = controlPoints(this.Project, SelectedRoad);
            const H1W = StudioPointToWorld(Pts[1], Anchor);
            const H2W = StudioPointToWorld(Pts[2], Anchor);
            const P1 = this.ProjectWorldPoint(H1W, Width, Height, Cam);
            if (P1 && Math.hypot(P1[0] - Sx, P1[1] - Sy) <= 13.0)
                return { kind: "handle", roadId: SelectedRoad.id, handle: "h1", world: H1W };
            const P2 = this.ProjectWorldPoint(H2W, Width, Height, Cam);
            if (P2 && Math.hypot(P2[0] - Sx, P2[1] - Sy) <= 13.0)
                return { kind: "handle", roadId: SelectedRoad.id, handle: "h2", world: H2W };
        }

        // ② Shared Junction Nodes (`node`)
        let BestNode = null, BestNodeDist = 14.0;
        for (const Node of this.Project.nodes)
        {
            const NW = StudioPointToWorld(Node.position, Anchor);
            const PN = this.ProjectWorldPoint([NW[0], NW[1], NW[2] + 0.22], Width, Height, Cam);
            if (!PN)
                continue;
            const D = Math.hypot(PN[0] - Sx, PN[1] - Sy);
            if (D < BestNodeDist)
            {
                BestNodeDist = D;
                BestNode = { kind: "node", id: Node.id, world: NW };
            }
        }
        if (BestNode)
            return BestNode;

        // ③ Road alignments (polyline screen distance -> exact curve parameter `t`)
        let BestRoad = null, BestRoadDist = 12.0;
        for (const Road of this.Project.roads)
        {
            const Sampled = sampleAlignment(this.Project, Road, 28);
            const St = Sampled.stations;
            for (let I = 0; I < St.length - 1; ++I)
            {
                const WA = StudioPointToWorld(St[I].p, Anchor);
                const WB = StudioPointToWorld(St[I + 1].p, Anchor);
                const SA = this.ProjectWorldPoint([WA[0], WA[1], WA[2] + 0.18], Width, Height, Cam);
                const SB = this.ProjectWorldPoint([WB[0], WB[1], WB[2] + 0.18], Width, Height, Cam);
                if (!SA || !SB)
                    continue;
                const VX = SB[0] - SA[0], VY = SB[1] - SA[1];
                const LenSq = VX * VX + VY * VY;
                const U = LenSq > 1.0e-3 ? Math.max(0.0, Math.min(1.0, ((Sx - SA[0]) * VX + (Sy - SA[1]) * VY) / LenSq)) : 0.0;
                const D = Math.hypot(Sx - (SA[0] + VX * U), Sy - (SA[1] + VY * U));
                if (D < BestRoadDist)
                {
                    BestRoadDist = D;
                    const TParam = St[I].t + (St[I + 1].t - St[I].t) * U;
                    BestRoad = {
                        kind:  "road",
                        id:    Road.id,
                        t:     TParam,
                        world: [WA[0] + (WB[0] - WA[0]) * U, WA[1] + (WB[1] - WA[1]) * U, WA[2] + (WB[2] - WA[2]) * U]
                    };
                }
            }
        }
        return BestRoad;
    }

    BindViewportGizmoEvents()
    {
        if (typeof document === "undefined")
            return;
        const Canvas = document.getElementById("road-studio-gizmo");
        if (!Canvas)
            return;

        Canvas.addEventListener("contextmenu", (Ev) => Ev.preventDefault());

        Canvas.addEventListener("wheel", (Ev) =>
        {
            if (this.ActiveWorkspace !== "roadstudio" || !this.Host?.Flight)
                return;
            Ev.preventDefault();
            const Bounds = Canvas.getBoundingClientRect();
            const Ray = this.ScreenToWorldRay(Ev.clientX - Bounds.left, Ev.clientY - Bounds.top, Bounds.width, Bounds.height);
            if (!Ray)
                return;
            const Step = -Math.sign(Ev.deltaY) * Math.min(28.0, Math.max(4.0, Math.abs(this.Host.Flight.Position[2]) * 0.22));
            this.Host.Flight.Position[0] += Ray.Dir[0] * Step;
            this.Host.Flight.Position[1] += Ray.Dir[1] * Step;
            this.Host.Flight.Position[2] = Math.max(1.2, this.Host.Flight.Position[2] + Ray.Dir[2] * Step);
            this.Host.PriorValid = false;
        }, { passive: false });

        Canvas.addEventListener("pointerdown", (Ev) =>
        {
            if (this.ActiveWorkspace !== "roadstudio")
                return;
            const Bounds = Canvas.getBoundingClientRect();
            const Sx = Ev.clientX - Bounds.left;
            const Sy = Ev.clientY - Bounds.top;
            Canvas.setPointerCapture(Ev.pointerId);

            // Right-click in Draw mode ends the current draw chain cleanly (or starts camera look on drag)
            if (Ev.button === 2 || Ev.button === 1 || Ev.altKey)
            {
                if (Ev.button === 2 && this.DrawChainNodeId)
                    this.DrawChainNodeId = null;
                this.DragState = { mode: "camera", lastX: Ev.clientX, lastY: Ev.clientY };
                return;
            }
            if (Ev.button !== 0)
                return;

            const Hit = this.HitTestGizmos3D(Sx, Sy, Bounds.width, Bounds.height);
            const Ray = this.ScreenToWorldRay(Sx, Sy, Bounds.width, Bounds.height);
            const Anchor = this.Compiled?.Anchor ?? [0.0, 0.0, 0.0];

            if (this.ToolMode === "draw")
            {
                const GroundPt = Hit?.world ? [...Hit.world] : this.IntersectRayPlaneZ(Ray, 0.0);
                if (!GroundPt)
                    return;
                const StudioPt = WorldPointToStudio(GroundPt, Anchor);
                const Snap = this.SnapEnabled ? findSnap(this.Project, StudioPt, 4.5) : null;
                const FinalStudioPt = Snap ? [...Snap.position] : StudioPt;

                if (!this.DrawChainNodeId)
                {
                    if (Snap?.nodeId)
                    {
                        this.DrawChainNodeId = Snap.nodeId;
                        this.Selection = { kind: "node", id: Snap.nodeId };
                    }
                    else if (Snap?.roadId)
                    {
                        this.PushUndoSnapshot();
                        const SplitNode = splitRoad(this.Project, Snap.roadId, Snap.t);
                        this.DrawChainNodeId = SplitNode.id;
                        this.Selection = { kind: "node", id: SplitNode.id };
                        this.CommitChanges("Split road for new junction");
                    }
                    else
                    {
                        this.DrawChainNodeId = { pendingStart: FinalStudioPt };
                    }
                    this.RefreshStudioPanels();
                    return;
                }

                const FromPt = typeof this.DrawChainNodeId === "string"
                    ? (getNode(this.Project, this.DrawChainNodeId)?.position ?? FinalStudioPt)
                    : this.DrawChainNodeId.pendingStart;
                const PresetCfg = NewRoadStylePresets.find((P) => P.Id === this.ActivePresetId)?.Settings ?? {};
                const Created = this.AddRoadBetween(FromPt, FinalStudioPt, PresetCfg);
                if (Created)
                {
                    this.DrawChainNodeId = Created.end;
                    this.RefreshStudioPanels();
                }
                return;
            }

            if (this.ToolMode === "bridge")
            {
                if (Hit?.kind === "road")
                {
                    this.InsertBridgeOnRoad(Hit.id);
                    this.RefreshStudioPanels();
                }
                return;
            }

            if (this.ToolMode === "split")
            {
                if (Hit?.kind === "road")
                {
                    this.PushUndoSnapshot();
                    const Node = splitRoad(this.Project, Hit.id, Math.max(0.12, Math.min(0.88, Hit.t ?? 0.5)));
                    this.Selection = { kind: "node", id: Node.id };
                    this.CommitChanges(`Inserted junction ${Node.name}`);
                    this.RefreshStudioPanels();
                }
                return;
            }

            if (this.ToolMode === "delete")
            {
                if (Hit && (Hit.kind === "road" || Hit.kind === "node"))
                {
                    this.Selection = { kind: Hit.kind, id: Hit.id };
                    this.DeleteSelected();
                    this.RefreshStudioPanels();
                }
                return;
            }

            // Select / Sculpt mode
            if (Hit?.kind === "handle")
            {
                this.PushUndoSnapshot();
                this.DragState = {
                    mode:       "handle",
                    roadId:     Hit.roadId,
                    handle:     Hit.handle,
                    planeZ:     Hit.world[2],
                    lastY:      Ev.clientY,
                    hasMoved:   false
                };
                return;
            }

            if (Hit?.kind === "node")
            {
                this.Selection = { kind: "node", id: Hit.id };
                this.RefreshStudioPanels();
                this.PushUndoSnapshot();
                this.DragState = {
                    mode:     "node",
                    nodeId:   Hit.id,
                    planeZ:   Hit.world[2],
                    lastY:    Ev.clientY,
                    hasMoved: false
                };
                return;
            }

            if (Hit?.kind === "road")
            {
                this.Selection = { kind: "road", id: Hit.id };
                this.RefreshStudioPanels();
                return;
            }

            // Left-drag on empty sky/ground rotates camera gently for effortless 3D navigation
            this.DragState = { mode: "camera", lastX: Ev.clientX, lastY: Ev.clientY };
        });

        Canvas.addEventListener("pointermove", (Ev) =>
        {
            if (this.ActiveWorkspace !== "roadstudio")
                return;
            const Bounds = Canvas.getBoundingClientRect();
            const Sx = Ev.clientX - Bounds.left;
            const Sy = Ev.clientY - Bounds.top;
            const Anchor = this.Compiled?.Anchor ?? [0.0, 0.0, 0.0];

            if (this.DragState)
            {
                if (this.DragState.mode === "camera" && this.Host?.Flight)
                {
                    const DX = Ev.clientX - this.DragState.lastX;
                    const DY = Ev.clientY - this.DragState.lastY;
                    this.DragState.lastX = Ev.clientX;
                    this.DragState.lastY = Ev.clientY;
                    this.Host.Flight.Yaw -= DX * 0.004;
                    this.Host.Flight.Pitch = Math.max(-1.5, Math.min(1.5, this.Host.Flight.Pitch - DY * 0.004));
                    this.Host.PriorValid = false;
                    return;
                }

                if (this.DragState.mode === "node")
                {
                    const Node = getNode(this.Project, this.DragState.nodeId);
                    if (!Node)
                        return;
                    if (Ev.shiftKey)
                    {
                        const DY = Ev.clientY - this.DragState.lastY;
                        this.DragState.lastY = Ev.clientY;
                        Node.position[1] = Math.max(0.0, Math.min(24.0, Node.position[1] - DY * 0.06));
                        this.DragState.planeZ = Node.position[1];
                    }
                    else
                    {
                        this.DragState.lastY = Ev.clientY;
                        const Ray = this.ScreenToWorldRay(Sx, Sy, Bounds.width, Bounds.height);
                        const HitW = this.IntersectRayPlaneZ(Ray, this.DragState.planeZ);
                        if (!HitW)
                            return;
                        const RawStudio = WorldPointToStudio(HitW, Anchor);
                        moveNode(this.Project, Node.id, RawStudio);
                    }
                    this.DragState.hasMoved = true;
                    this.LiveStreamEdit();
                    return;
                }

                if (this.DragState.mode === "handle")
                {
                    const Road = this.Project.roads.find((R) => R.id === this.DragState.roadId);
                    if (!Road)
                        return;
                    const AnchorNode = getNode(this.Project, this.DragState.handle === "h1" ? Road.start : Road.end);
                    const Vec = this.DragState.handle === "h1" ? Road.h1 : Road.h2;
                    if (!AnchorNode || !Vec)
                        return;
                    if (Ev.shiftKey)
                    {
                        const DY = Ev.clientY - this.DragState.lastY;
                        this.DragState.lastY = Ev.clientY;
                        Vec[1] = Math.max(-18.0, Math.min(24.0, Vec[1] - DY * 0.06));
                        this.DragState.planeZ = AnchorNode.position[1] + Vec[1];
                    }
                    else
                    {
                        this.DragState.lastY = Ev.clientY;
                        const Ray = this.ScreenToWorldRay(Sx, Sy, Bounds.width, Bounds.height);
                        const HitW = this.IntersectRayPlaneZ(Ray, this.DragState.planeZ);
                        if (!HitW)
                            return;
                        const StudioPt = WorldPointToStudio(HitW, Anchor);
                        Vec[0] = StudioPt[0] - AnchorNode.position[0];
                        Vec[2] = StudioPt[2] - AnchorNode.position[2];
                    }
                    this.DragState.hasMoved = true;
                    this.LiveStreamEdit();
                    return;
                }
            }

            // Passive hover updates for crisp 3D cursor & snap rings
            this.HoverHit = this.HitTestGizmos3D(Sx, Sy, Bounds.width, Bounds.height);
            const Ray = this.ScreenToWorldRay(Sx, Sy, Bounds.width, Bounds.height);
            const GroundW = this.HoverHit?.world ? [...this.HoverHit.world] : this.IntersectRayPlaneZ(Ray, 0.0);
            this.HoverWorld = GroundW;
            if (GroundW && this.SnapEnabled && this.ToolMode === "draw")
            {
                const StudioPt = WorldPointToStudio(GroundW, Anchor);
                this.HoverSnap = findSnap(this.Project, StudioPt, 4.5);
            }
            else
            {
                this.HoverSnap = null;
            }
            Canvas.style.cursor = (this.HoverHit && this.ToolMode !== "draw") ? "pointer" : "crosshair";
        });

        const EndDrag = () =>
        {
            if (!this.DragState)
                return;
            const Moved = this.DragState.hasMoved;
            const WasEdit = this.DragState.mode === "node" || this.DragState.mode === "handle";
            this.DragState = null;
            if (WasEdit)
            {
                if (Moved)
                    this.CommitChanges();
                else
                    this.UndoStack.pop();
                this.RefreshStudioPanels();
            }
        };
        Canvas.addEventListener("pointerup", EndDrag);
        Canvas.addEventListener("pointercancel", EndDrag);
    }

    LiveStreamEdit()
    {
        try
        {
            this.RebuildWorldNetwork();
            this.PushGeometryToGpu();
            this.SyncPhysicsSurfaces();
            this.SyncTrafficSignals();
            this.RenderPlanCanvas();
            this.UpdateWorkspaceBarUi();
        }
        catch (_Err)
        {
            // Ignore transient degenerate handle states mid-drag
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                              3D IN-WORLD SPLINE, NODE & TANGENT GIZMO RENDERER
    //--------------------------------------------------------------------------------------------------------------------

    RenderViewportGizmos(CameraState = this.Host?.CameraState)
    {
        if (this.ActiveWorkspace !== "roadstudio" || typeof document === "undefined")
            return;
        const Canvas = document.getElementById("road-studio-gizmo");
        if (!Canvas || !CameraState)
            return;
        const Dpr = Math.min(2.0, window.devicePixelRatio || 1.0);
        const W = Math.max(1, Canvas.clientWidth);
        const H = Math.max(1, Canvas.clientHeight);
        if (Canvas.width !== Math.round(W * Dpr) || Canvas.height !== Math.round(H * Dpr))
        {
            Canvas.width = Math.round(W * Dpr);
            Canvas.height = Math.round(H * Dpr);
        }
        const Ctx = Canvas.getContext("2d");
        if (!Ctx || !Ctx.clearRect)
            return;
        Ctx.setTransform(Dpr, 0, 0, Dpr, 0, 0);
        Ctx.clearRect(0, 0, W, H);

        const Anchor = this.Compiled?.Anchor ?? [0.0, 0.0, 0.0];

        // ① Draw subtle centerlines on all roads + bright Sun-Gold highlight on selected/hovered road
        for (const Road of this.Project.roads)
        {
            const IsSelected = this.Selection?.kind === "road" && this.Selection.id === Road.id;
            const IsHovered = this.HoverHit?.kind === "road" && this.HoverHit.id === Road.id;
            const Sampled = sampleAlignment(this.Project, Road, 36);
            Ctx.beginPath();
            let Started = false;
            for (const St of Sampled.stations)
            {
                const WP = StudioPointToWorld(St.p, Anchor);
                const SP = this.ProjectWorldPoint([WP[0], WP[1], WP[2] + 0.20], W, H, CameraState);
                if (!SP)
                {
                    Started = false;
                    continue;
                }
                if (!Started) { Ctx.moveTo(SP[0], SP[1]); Started = true; }
                else Ctx.lineTo(SP[0], SP[1]);
            }
            Ctx.strokeStyle = IsSelected
                ? "rgba(240, 201, 117, 0.96)"
                : (IsHovered ? "rgba(120, 215, 255, 0.85)" : "rgba(232, 184, 92, 0.34)");
            Ctx.lineWidth = IsSelected ? 2.6 : (IsHovered ? 2.0 : 1.2);
            Ctx.setLineDash(IsSelected ? [] : [6, 5]);
            Ctx.stroke();
            Ctx.setLineDash([]);

            // Midpoint label on selected road
            if (IsSelected && Sampled.stations.length >= 2)
            {
                const Mid = Sampled.stations[Math.floor(Sampled.stations.length * 0.5)];
                const MW = StudioPointToWorld(Mid.p, Anchor);
                const MP = this.ProjectWorldPoint([MW[0], MW[1], MW[2] + 1.2], W, H, CameraState);
                if (MP)
                {
                    const Label = `${Road.name} · ${Math.round(Sampled.length)} m${Road.bridge ? ` · ${Road.structure.toUpperCase()} BRIDGE` : ""}`;
                    Ctx.font = "500 11px 'DM Sans', sans-serif";
                    const Tw = Ctx.measureText(Label).width + 14;
                    Ctx.fillStyle = "rgba(15, 14, 11, 0.86)";
                    Ctx.strokeStyle = "rgba(240, 201, 117, 0.65)";
                    Ctx.lineWidth = 1;
                    Ctx.beginPath();
                    Ctx.roundRect(MP[0] - Tw * 0.5, MP[1] - 11, Tw, 22, 6);
                    Ctx.fill();
                    Ctx.stroke();
                    Ctx.fillStyle = "#f5e3b8";
                    Ctx.textAlign = "center";
                    Ctx.textBaseline = "middle";
                    Ctx.fillText(Label, MP[0], MP[1]);
                }
            }
        }

        // ② Draw Cubic Bézier Tangent Arms & Sun-Gold Diamond Handles (`h1`, `h2`) for the selected road
        const ActiveRoad = this.GetSelectedRoad();
        if (ActiveRoad && this.ToolMode === "select")
        {
            const Pts = controlPoints(this.Project, ActiveRoad);
            const Pairs = [[Pts[0], Pts[1], "h1"], [Pts[3], Pts[2], "h2"]];
            for (const [BaseS, HandleS, Tag] of Pairs)
            {
                const BW = StudioPointToWorld(BaseS, Anchor);
                const HW = StudioPointToWorld(HandleS, Anchor);
                const BP = this.ProjectWorldPoint([BW[0], BW[1], BW[2] + 0.24], W, H, CameraState);
                const HP = this.ProjectWorldPoint([HW[0], HW[1], HW[2] + 0.24], W, H, CameraState);
                if (!BP || !HP)
                    continue;
                Ctx.beginPath();
                Ctx.moveTo(BP[0], BP[1]);
                Ctx.lineTo(HP[0], HP[1]);
                Ctx.strokeStyle = "rgba(244, 198, 104, 0.85)";
                Ctx.lineWidth = 1.6;
                Ctx.setLineDash([4, 3]);
                Ctx.stroke();
                Ctx.setLineDash([]);

                // Glowing Sun-Gold diamond handle
                const R = (this.HoverHit?.kind === "handle" && this.HoverHit.handle === Tag) ? 7.5 : 6.0;
                Ctx.save();
                Ctx.translate(HP[0], HP[1]);
                Ctx.rotate(Math.PI * 0.25);
                Ctx.fillStyle = "#f5cc6a";
                Ctx.strokeStyle = "#191306";
                Ctx.lineWidth = 1.8;
                Ctx.fillRect(-R, -R, R * 2, R * 2);
                Ctx.strokeRect(-R, -R, R * 2, R * 2);
                Ctx.restore();
            }
        }

        // ③ Draw Shared Junction Pivot Nodes
        for (const Node of this.Project.nodes)
        {
            const NW = StudioPointToWorld(Node.position, Anchor);
            const NP = this.ProjectWorldPoint([NW[0], NW[1], NW[2] + 0.25], W, H, CameraState);
            if (!NP)
                continue;
            const IsSel = this.Selection?.kind === "node" && this.Selection.id === Node.id;
            const IsHov = this.HoverHit?.kind === "node" && this.HoverHit.id === Node.id;
            const Rad = IsSel ? 7.5 : (IsHov ? 7.0 : 5.2);

            Ctx.beginPath();
            Ctx.arc(NP[0], NP[1], Rad + 2.5, 0, Math.PI * 2);
            Ctx.fillStyle = "rgba(12, 12, 12, 0.72)";
            Ctx.fill();

            Ctx.beginPath();
            Ctx.arc(NP[0], NP[1], Rad, 0, Math.PI * 2);
            Ctx.fillStyle = IsSel ? "#3ec46d" : (Node.signals ? "#f0b952" : "#dcdcdc");
            Ctx.fill();
            Ctx.strokeStyle = "#111";
            Ctx.lineWidth = 1.6;
            Ctx.stroke();

            if (NW[2] > 0.25 || IsSel)
            {
                Ctx.font = "500 10px 'JetBrains Mono', monospace";
                Ctx.fillStyle = "#f0d79a";
                Ctx.textAlign = "center";
                Ctx.fillText(NW[2] > 0.25 ? `+${NW[2].toFixed(1)}m` : Node.name, NP[0], NP[1] - 13);
            }
        }

        // ④ Live `Draw Road` 3D World Cursor & Rubber-Band Preview
        if (this.ToolMode === "draw" && this.HoverWorld)
        {
            const TargetW = this.HoverSnap
                ? StudioPointToWorld(this.HoverSnap.position, Anchor)
                : this.HoverWorld;
            const TP = this.ProjectWorldPoint([TargetW[0], TargetW[1], TargetW[2] + 0.15], W, H, CameraState);
            if (TP)
            {
                if (this.DrawChainNodeId)
                {
                    const StartStudio = typeof this.DrawChainNodeId === "string"
                        ? getNode(this.Project, this.DrawChainNodeId)?.position
                        : this.DrawChainNodeId.pendingStart;
                    if (StartStudio)
                    {
                        const SW = StudioPointToWorld(StartStudio, Anchor);
                        const SP = this.ProjectWorldPoint([SW[0], SW[1], SW[2] + 0.20], W, H, CameraState);
                        if (SP)
                        {
                            Ctx.beginPath();
                            Ctx.moveTo(SP[0], SP[1]);
                            Ctx.lineTo(TP[0], TP[1]);
                            Ctx.strokeStyle = "#f2c96b";
                            Ctx.lineWidth = 2.4;
                            Ctx.setLineDash([7, 5]);
                            Ctx.stroke();
                            Ctx.setLineDash([]);

                            const Dist = Math.hypot(TargetW[0] - SW[0], TargetW[1] - SW[1]);
                            Ctx.font = "500 11px 'JetBrains Mono', monospace";
                            Ctx.fillStyle = "#f6dc99";
                            Ctx.textAlign = "left";
                            Ctx.fillText(`${Dist.toFixed(1)} m`, TP[0] + 14, TP[1] - 10);
                        }
                    }
                }

                Ctx.beginPath();
                Ctx.arc(TP[0], TP[1], this.HoverSnap ? 10.0 : 7.0, 0, Math.PI * 2);
                Ctx.strokeStyle = this.HoverSnap ? "#3ec46d" : "#f2c96b";
                Ctx.lineWidth = 2.2;
                Ctx.stroke();
            }
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                              LINKED 2D WORLD PLAN CANVAS (LEFT COLUMN DOCK)
    //--------------------------------------------------------------------------------------------------------------------

    FitPlanToNetwork()
    {
        const Anchor = this.Compiled?.Anchor ?? [0.0, 0.0, 0.0];
        const B = this.Compiled?.Network?.bounds;
        if (!B || !Number.isFinite(B.min[0]))
            return;
        const MinWX = Anchor[0] + B.min[0], MaxWX = Anchor[0] + B.max[0];
        const MinWY = Anchor[1] - B.max[2], MaxWY = Anchor[1] - B.min[2];
        this.PlanCenter = [0.5 * (MinWX + MaxWX), 0.5 * (MinWY + MaxWY)];
        const Span = Math.max(80.0, MaxWX - MinWX, MaxWY - MinWY);
        this.PlanScale = Math.max(0.12, Math.min(3.0, 176.0 / Span));
    }

    WorldToPlan(WX, WY, Width, Height)
    {
        return [
            Width * 0.5 + (WX - this.PlanCenter[0]) * this.PlanScale,
            Height * 0.5 - (WY - this.PlanCenter[1]) * this.PlanScale
        ];
    }

    PlanToWorld(Px, Py, Width, Height)
    {
        return [
            this.PlanCenter[0] + (Px - Width * 0.5) / this.PlanScale,
            this.PlanCenter[1] - (Py - Height * 0.5) / this.PlanScale
        ];
    }

    BindPlanCanvasEvents()
    {
        if (typeof document === "undefined")
            return;
        const Canvas = document.getElementById("studio-plan-canvas");
        if (!Canvas)
            return;
        Canvas.addEventListener("contextmenu", (Ev) => Ev.preventDefault());
        Canvas.addEventListener("wheel", (Ev) =>
        {
            Ev.preventDefault();
            const Factor = Ev.deltaY < 0 ? 1.15 : 1.0 / 1.15;
            this.PlanScale = Math.max(0.08, Math.min(6.0, this.PlanScale * Factor));
            this.RenderPlanCanvas();
        }, { passive: false });

        Canvas.addEventListener("pointerdown", (Ev) =>
        {
            const Rect = Canvas.getBoundingClientRect();
            const Px = Ev.clientX - Rect.left, Py = Ev.clientY - Rect.top;
            Canvas.setPointerCapture(Ev.pointerId);
            if (Ev.button !== 0 || Ev.altKey)
            {
                this.PlanDrag = { mode: "pan", lastX: Ev.clientX, lastY: Ev.clientY };
                return;
            }
            const Anchor = this.Compiled?.Anchor ?? [0.0, 0.0, 0.0];
            for (const Node of this.Project.nodes)
            {
                const NW = StudioPointToWorld(Node.position, Anchor);
                const [Nx, Ny] = this.WorldToPlan(NW[0], NW[1], Rect.width, Rect.height);
                if (Math.hypot(Nx - Px, Ny - Py) <= 9.0)
                {
                    this.Selection = { kind: "node", id: Node.id };
                    this.PushUndoSnapshot();
                    this.PlanDrag = { mode: "node", nodeId: Node.id, z: Node.position[1], moved: false };
                    this.RefreshStudioPanels();
                    return;
                }
            }
            this.PlanDrag = { mode: "pan", lastX: Ev.clientX, lastY: Ev.clientY };
        });

        Canvas.addEventListener("pointermove", (Ev) =>
        {
            if (!this.PlanDrag)
                return;
            const Rect = Canvas.getBoundingClientRect();
            if (this.PlanDrag.mode === "pan")
            {
                const DX = Ev.clientX - this.PlanDrag.lastX;
                const DY = Ev.clientY - this.PlanDrag.lastY;
                this.PlanDrag.lastX = Ev.clientX;
                this.PlanDrag.lastY = Ev.clientY;
                this.PlanCenter[0] -= DX / this.PlanScale;
                this.PlanCenter[1] += DY / this.PlanScale;
                this.RenderPlanCanvas();
                return;
            }
            if (this.PlanDrag.mode === "node")
            {
                const [WX, WY] = this.PlanToWorld(Ev.clientX - Rect.left, Ev.clientY - Rect.top, Rect.width, Rect.height);
                const Anchor = this.Compiled?.Anchor ?? [0.0, 0.0, 0.0];
                moveNode(this.Project, this.PlanDrag.nodeId, WorldPointToStudio([WX, WY, this.PlanDrag.z], Anchor));
                this.PlanDrag.moved = true;
                this.LiveStreamEdit();
            }
        });

        const EndPlanDrag = () =>
        {
            if (this.PlanDrag?.mode === "node")
            {
                if (this.PlanDrag.moved) this.CommitChanges();
                else this.UndoStack.pop();
                this.RefreshStudioPanels();
            }
            this.PlanDrag = null;
        };
        Canvas.addEventListener("pointerup", EndPlanDrag);
        Canvas.addEventListener("pointercancel", EndPlanDrag);
    }

    RenderPlanCanvas()
    {
        if (typeof document === "undefined")
            return;
        const Canvas = document.getElementById("studio-plan-canvas");
        if (!Canvas)
            return;
        const Ctx = Canvas.getContext("2d");
        if (!Ctx || !Ctx.beginPath)
            return;
        const W = Canvas.width, H = Canvas.height;
        Ctx.clearRect(0, 0, W, H);

        // Subtle metric grid
        Ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
        Ctx.lineWidth = 1;
        const StepM = this.PlanScale > 0.8 ? 25.0 : (this.PlanScale > 0.3 ? 50.0 : 100.0);
        const [MinWX, MaxWY] = this.PlanToWorld(0, 0, W, H);
        const [MaxWX, MinWY] = this.PlanToWorld(W, H, W, H);
        for (let X = Math.floor(MinWX / StepM) * StepM; X <= MaxWX; X += StepM)
        {
            const [Px] = this.WorldToPlan(X, 0, W, H);
            Ctx.beginPath(); Ctx.moveTo(Px, 0); Ctx.lineTo(Px, H); Ctx.stroke();
        }
        for (let Y = Math.floor(MinWY / StepM) * StepM; Y <= MaxWY; Y += StepM)
        {
            const [, Py] = this.WorldToPlan(0, Y, W, H);
            Ctx.beginPath(); Ctx.moveTo(0, Py); Ctx.lineTo(W, Py); Ctx.stroke();
        }

        // Main Arena East Wall reference line (`X = 220.5`) so gateways are clearly visible in 2D Plan!
        if (this.LevelKey === "inversion")
        {
            const [WallX, TopY] = this.WorldToPlan(220.5, 180.0, W, H);
            const [, BotY] = this.WorldToPlan(220.5, -180.0, W, H);
            Ctx.strokeStyle = "rgba(92, 168, 255, 0.25)";
            Ctx.setLineDash([4, 4]);
            Ctx.beginPath(); Ctx.moveTo(WallX, TopY); Ctx.lineTo(WallX, BotY); Ctx.stroke();
            Ctx.setLineDash([]);
        }

        const Anchor = this.Compiled?.Anchor ?? [0.0, 0.0, 0.0];
        for (const Road of this.Project.roads)
        {
            const Sampled = sampleAlignment(this.Project, Road, 24);
            const IsSel = this.Selection?.kind === "road" && this.Selection.id === Road.id;
            Ctx.beginPath();
            Sampled.stations.forEach((St, Idx) =>
            {
                const WP = StudioPointToWorld(St.p, Anchor);
                const [Px, Py] = this.WorldToPlan(WP[0], WP[1], W, H);
                if (Idx === 0) Ctx.moveTo(Px, Py);
                else Ctx.lineTo(Px, Py);
            });
            Ctx.strokeStyle = IsSel ? "#f2c96b" : (Road.bridge ? "#60b6ff" : "#9c9c9c");
            Ctx.lineWidth = IsSel ? 3.0 : (Road.bridge ? 2.5 : 2.0);
            Ctx.stroke();
        }

        for (const Node of this.Project.nodes)
        {
            const WP = StudioPointToWorld(Node.position, Anchor);
            const [Px, Py] = this.WorldToPlan(WP[0], WP[1], W, H);
            const IsSel = this.Selection?.kind === "node" && this.Selection.id === Node.id;
            Ctx.beginPath();
            Ctx.arc(Px, Py, IsSel ? 4.8 : 3.4, 0, Math.PI * 2);
            Ctx.fillStyle = IsSel ? "#3ec46d" : "#ececec";
            Ctx.fill();
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                      ROAD STUDIO TOOLBAR, HIERARCHY & 4-TAB INSPECTOR (NO ASSET LIBRARY)
    //--------------------------------------------------------------------------------------------------------------------

    BuildStudioToolbar()
    {
        if (typeof document === "undefined")
            return;
        const Bar = document.getElementById("studio-toolbar");
        if (!Bar)
            return;
        Bar.innerHTML = "";

        const MakeTool = (Id, Label, Title) =>
        {
            const Btn = document.createElement("button");
            Btn.type = "button";
            Btn.className = `studio-tool-btn${this.ToolMode === Id ? " active" : ""}`;
            Btn.textContent = Label;
            Btn.title = Title;
            Btn.dataset.studioTool = Id;
            Btn.addEventListener("click", () =>
            {
                this.ToolMode = Id;
                this.DrawChainNodeId = null;
                this.RefreshStudioToolbarState();
            });
            Bar.appendChild(Btn);
        };

        MakeTool("select", "Select / Sculpt", "Select roads & junctions or drag curve handles directly in the 3D world");
        MakeTool("draw",   "Draw Road",       "Click in the 3D world to draw connected spline roads onto the level");
        MakeTool("bridge", "Bridge Span",     "Click a road in the 3D world to convert/insert an elevated highway bridge");
        MakeTool("split",  "Split Junction",  "Click along a road in the 3D world to insert a shared junction node");
        MakeTool("delete", "Delete",          "Click a road or junction to remove it");

        const PresetSelect = document.createElement("select");
        PresetSelect.className = "studio-select";
        PresetSelect.title = "Road cross-section preset for newly drawn roads";
        for (const P of NewRoadStylePresets)
        {
            const Opt = document.createElement("option");
            Opt.value = P.Id;
            Opt.textContent = P.Label;
            if (P.Id === this.ActivePresetId) Opt.selected = true;
            PresetSelect.appendChild(Opt);
        }
        PresetSelect.addEventListener("change", () => { this.ActivePresetId = PresetSelect.value; });
        Bar.appendChild(PresetSelect);

        const SnapBtn = document.createElement("button");
        SnapBtn.type = "button";
        SnapBtn.className = `studio-tool-btn${this.SnapEnabled ? " active" : ""}`;
        SnapBtn.textContent = "Snap";
        SnapBtn.addEventListener("click", () =>
        {
            this.SnapEnabled = !this.SnapEnabled;
            SnapBtn.classList.toggle("active", this.SnapEnabled);
        });
        Bar.appendChild(SnapBtn);

        const Fill = document.createElement("span");
        Fill.className = "bar-fill";
        Bar.appendChild(Fill);

        const MakeAction = (Label, OnClick, ExtraClass = "") =>
        {
            const B = document.createElement("button");
            B.type = "button";
            B.className = `studio-tool-btn ${ExtraClass}`.trim();
            B.textContent = Label;
            B.addEventListener("click", OnClick);
            Bar.appendChild(B);
        };

        MakeAction("Undo", () => { this.Undo(); this.RefreshStudioPanels(); });
        MakeAction("Redo", () => { this.Redo(); this.RefreshStudioPanels(); });
        MakeAction("Frame Demo", () => this.FrameNetworkIn3D());
        MakeAction("Drive Here", () => { this.CloseWorkspace(); this.DriveOnSelectedRoad(); }, "active");
    }

    RefreshStudioToolbarState()
    {
        if (typeof document === "undefined")
            return;
        const Bar = document.getElementById("studio-toolbar");
        if (!Bar)
            return;
        Bar.querySelectorAll("[data-studio-tool]").forEach((Btn) =>
        {
            Btn.classList.toggle("active", Btn.getAttribute("data-studio-tool") === this.ToolMode);
        });
    }

    BuildStudioInspectorTabs()
    {
        if (typeof document === "undefined")
            return;
        const HostEl = document.getElementById("studio-inspector-tabs");
        if (!HostEl)
            return;
        HostEl.innerHTML = "";
        for (const [Id, Label] of [["geometry", "Geometry"], ["surface", "Surface"], ["bridge", "Bridge"], ["details", "Details"]])
        {
            const Btn = document.createElement("button");
            Btn.type = "button";
            Btn.className = `studio-insp-tab${this.InspectorTab === Id ? " active" : ""}`;
            Btn.textContent = Label;
            Btn.dataset.inspTab = Id;
            Btn.addEventListener("click", () =>
            {
                this.InspectorTab = Id;
                HostEl.querySelectorAll("[data-insp-tab]").forEach((B) =>
                    B.classList.toggle("active", B.getAttribute("data-insp-tab") === Id));
                this.RenderStudioInspector();
            });
            HostEl.appendChild(Btn);
        }
    }

    RefreshStudioPanels()
    {
        this.RefreshStudioToolbarState();
        this.RenderStudioHierarchy();
        this.RenderStudioInspector();
        this.RenderPlanCanvas();
    }

    RenderStudioHierarchy()
    {
        if (typeof document === "undefined")
            return;
        const Container = document.getElementById("studio-hierarchy");
        if (!Container)
            return;
        Container.innerHTML = "";
        const Anchor = this.Compiled?.Anchor ?? [0.0, 0.0, 0.0];

        const Bridges = this.Project.roads.filter((R) => R.bridge);
        const Streets = this.Project.roads.filter((R) => !R.bridge);

        const AddGroup = (Title, Count, Items, Kind, DotClass) =>
        {
            if (Items.length === 0)
                return;
            const Hdr = document.createElement("div");
            Hdr.className = "studio-group-label";
            Hdr.innerHTML = `<span>${Title}</span><span>${Count}</span>`;
            Container.appendChild(Hdr);

            for (const Item of Items)
            {
                const Row = document.createElement("div");
                const Active = this.Selection?.kind === Kind && this.Selection.id === Item.id;
                Row.className = `studio-item${Active ? " active" : ""}`;
                const Dot = document.createElement("span");
                Dot.className = `studio-item-dot ${DotClass}`;
                const Name = document.createElement("span");
                Name.className = "studio-item-name";
                Name.textContent = Item.name;
                const Meta = document.createElement("span");
                Meta.className = "studio-item-meta";
                Meta.textContent = Kind === "road" ? `${Item.lanes}L` : `+${Item.position[1].toFixed(0)}m`;
                const Focus = document.createElement("button");
                Focus.type = "button";
                Focus.className = "studio-item-focus";
                Focus.textContent = "Go";
                Focus.title = "Frame in 3D World";
                Focus.addEventListener("click", (Ev) =>
                {
                    Ev.stopPropagation();
                    this.Selection = { kind: Kind, id: Item.id };
                    if (Kind === "node")
                        this.FrameNetworkIn3D(StudioPointToWorld(Item.position, Anchor));
                    else
                    {
                        const Pts = controlPoints(this.Project, Item);
                        const Mid = [0.5 * (Pts[0][0] + Pts[3][0]), 0.5 * (Pts[0][1] + Pts[3][1]), 0.5 * (Pts[0][2] + Pts[3][2])];
                        this.FrameNetworkIn3D(StudioPointToWorld(Mid, Anchor));
                    }
                    this.RefreshStudioPanels();
                });

                Row.append(Dot, Name, Meta, Focus);
                Row.addEventListener("click", () =>
                {
                    this.Selection = { kind: Kind, id: Item.id };
                    this.RefreshStudioPanels();
                });
                Container.appendChild(Row);
            }
        };

        AddGroup("Highway Bridges", Bridges.length, Bridges, "road", "bridge");
        AddGroup("Spline Roads", Streets.length, Streets, "road", "");
        AddGroup("Shared Junctions", this.Project.nodes.length, this.Project.nodes, "node", "node");
    }

    RenderStudioInspector()
    {
        if (typeof document === "undefined")
            return;
        const Body = document.getElementById("studio-inspector-body");
        if (!Body)
            return;
        Body.innerHTML = "";

        const Road = this.GetSelectedRoad() || this.Project.roads[0] || null;
        const Node = (this.Selection?.kind === "node" ? getNode(this.Project, this.Selection.id) : null)
                     || (Road ? getNode(this.Project, Road.start) : this.Project.nodes[0]) || null;

        const Card = (Title, Sub = "") =>
        {
            const El = document.createElement("div");
            El.className = "studio-card";
            const T = document.createElement("div");
            T.className = "studio-card-title";
            T.textContent = Title;
            El.appendChild(T);
            if (Sub)
            {
                const S = document.createElement("div");
                S.className = "studio-card-sub";
                S.textContent = Sub;
                El.appendChild(S);
            }
            Body.appendChild(El);
            return El;
        };

        const AddRange = (Parent, Label, Value, Min, Max, Step, Unit, OnInput) =>
        {
            const Wrap = document.createElement("div");
            Wrap.className = "studio-field";
            const Head = document.createElement("div");
            Head.className = "studio-field-head";
            const L = document.createElement("span");
            L.textContent = Label;
            const V = document.createElement("span");
            V.className = "studio-field-val";
            const Dec = Step < 0.1 ? 2 : (Step < 1 ? 1 : 0);
            V.textContent = `${Number(Value).toFixed(Dec)}${Unit}`;
            Head.append(L, V);
            const Input = document.createElement("input");
            Input.type = "range";
            Input.min = String(Min);
            Input.max = String(Max);
            Input.step = String(Step);
            Input.value = String(Value);
            Input.addEventListener("change", () => this.PushUndoSnapshot());
            Input.addEventListener("input", () =>
            {
                const Num = Number(Input.value);
                V.textContent = `${Num.toFixed(Dec)}${Unit}`;
                OnInput(Num);
                this.LiveStreamEdit();
            });
            Wrap.append(Head, Input);
            Parent.appendChild(Wrap);
        };

        const AddSelect = (Parent, Label, Value, Options, OnChange) =>
        {
            const Wrap = document.createElement("div");
            Wrap.className = "studio-field";
            const Head = document.createElement("div");
            Head.className = "studio-field-head";
            Head.textContent = Label;
            const Sel = document.createElement("select");
            for (const [Val, Text] of Options)
            {
                const Opt = document.createElement("option");
                Opt.value = Val;
                Opt.textContent = Text;
                if (String(Val) === String(Value)) Opt.selected = true;
                Sel.appendChild(Opt);
            }
            Sel.addEventListener("change", () =>
            {
                this.PushUndoSnapshot();
                OnChange(Sel.value);
                this.CommitChanges();
                this.RefreshStudioPanels();
            });
            Wrap.append(Head, Sel);
            Parent.appendChild(Wrap);
        };

        const AddCheck = (Parent, Label, Checked, OnChange) =>
        {
            const Row = document.createElement("label");
            Row.className = "studio-check-row";
            const Span = document.createElement("span");
            Span.textContent = Label;
            const Box = document.createElement("input");
            Box.type = "checkbox";
            Box.checked = Boolean(Checked);
            Box.addEventListener("change", () =>
            {
                this.PushUndoSnapshot();
                OnChange(Box.checked);
                this.CommitChanges();
                this.RefreshStudioPanels();
            });
            Row.append(Span, Box);
            Parent.appendChild(Row);
        };

        if (this.InspectorTab === "geometry")
        {
            if (Road)
            {
                const C1 = Card(Road.name, "Alignment & cross-section geometry");
                AddSelect(C1, "Apply section preset", "", [
                    ["", "— Choose road preset —"],
                    ...presets.map((P) => [P.id, P.name])
                ], (Id) => { if (Id) this.ApplyRoadPreset(Id); });
                AddRange(C1, "Traffic lanes", Road.lanes, 1, 6, 1, "", (V) => { Road.lanes = V; });
                AddRange(C1, "Lane width", Road.laneWidth, 2.75, 4.5, 0.05, " m", (V) => { Road.laneWidth = V; });
                AddRange(C1, "Central median", Road.median, 0, 4.0, 0.1, " m", (V) => { Road.median = V; });
                AddRange(C1, "Shoulder width", Road.shoulderWidth, 0, 3.0, 0.1, " m", (V) => { Road.shoulderWidth = V; });

                const Row = document.createElement("div");
                Row.className = "studio-btn-row";
                const StraightBtn = document.createElement("button");
                StraightBtn.className = "studio-btn";
                StraightBtn.textContent = "Straighten Handles";
                StraightBtn.addEventListener("click", () =>
                {
                    const A = getNode(this.Project, Road.start), B = getNode(this.Project, Road.end);
                    if (!A || !B) return;
                    this.PushUndoSnapshot();
                    const DX = (B.position[0] - A.position[0]) / 3.0;
                    const DY = (B.position[1] - A.position[1]) / 3.0;
                    const DZ = (B.position[2] - A.position[2]) / 3.0;
                    Road.h1 = [DX, DY, DZ];
                    Road.h2 = [-DX, -DY, -DZ];
                    this.CommitChanges("Reset cubic handles to 1/3 chord");
                    this.RefreshStudioPanels();
                });
                Row.appendChild(StraightBtn);
                C1.appendChild(Row);
            }
            if (Node)
            {
                const C2 = Card(Node.name, "Shared junction pivot & corner fillets");
                AddRange(C2, "Junction elevation Z", Node.position[1], 0, 20, 0.2, " m", (V) => { Node.position[1] = V; });
                AddRange(C2, "Corner fillet radius", Node.radius, 2, 18, 0.5, " m", (V) => { Node.radius = V; });
            }
        }
        else if (this.InspectorTab === "surface" && Road)
        {
            const C1 = Card("Carriageway & Kerbs", "Skidmark-ready materials & markings");
            AddSelect(C1, "Surface material", Road.surface, [
                ["asphalt", "Hot-mix Asphalt"],
                ["concrete", "Brushed Concrete"],
                ["cobble", "Granite Cobblestone"],
                ["pavers", "Architectural Pavers"]
            ], (V) => { Road.surface = V; });
            AddSelect(C1, "Lane marking standard", Road.markingStyle, [
                ["urban", "Urban Street"],
                ["motorway", "Motorway / Highway"],
                ["center-only", "Center Line Only"]
            ], (V) => { Road.markingStyle = V; });
            AddCheck(C1, "Paint lane markings", Road.markings, (V) => { Road.markings = V; });
            AddSelect(C1, "Kerb profile", Road.curbStyle, [
                ["granite", "Granite Kerb"],
                ["stone", "Cut Stone"],
                ["race", "Red / White Race Kerb"],
                ["flush", "Flush Edge"]
            ], (V) => { Road.curbStyle = V; });
            AddRange(C1, "Sidewalk width", Road.sidewalk, 0, 5.0, 0.1, " m", (V) => { Road.sidewalk = V; });

            const C2 = Card("Active Mobility & Parking", "Cycleways, bus priority & bays");
            AddSelect(C2, "Cycleway", Road.cycleMode, [
                ["none", "None"],
                ["painted", "Painted Cycle Lane"],
                ["protected", "Protected Kerb Cycleway"]
            ], (V) => { Road.cycleMode = V; });
            AddSelect(C2, "Bus lanes", Road.busLane, [
                ["none", "None"],
                ["curbside", "Curbside Bus Priority"],
                ["median", "Median BRT Lanes"]
            ], (V) => { Road.busLane = V; });
            AddCheck(C2, "Parallel parking bays", Road.parking === "parallel", (V) => { Road.parking = V ? "parallel" : "none"; });
        }
        else if (this.InspectorTab === "bridge" && Road)
        {
            const C1 = Card("Highway Bridge Superstructure", "Girders, bearings, piers & 2:1 embankments");
            AddCheck(C1, "Elevated bridge span", Road.bridge, (V) => { Road.bridge = V; });
            AddSelect(C1, "Superstructure", Road.structure, [
                ["steel", "Steel Plate I-Girders"],
                ["concrete", "Precast Concrete Girders"]
            ], (V) => { Road.structure = V; });
            AddRange(C1, "Bridge start (t)", Road.bridgeFrom, 0.0, 0.85, 0.02, "", (V) =>
            {
                Road.bridgeFrom = Math.min(V, Road.bridgeTo - 0.05);
            });
            AddRange(C1, "Bridge end (t)", Road.bridgeTo, 0.15, 1.0, 0.02, "", (V) =>
            {
                Road.bridgeTo = Math.max(V, Road.bridgeFrom + 0.05);
            });
            AddRange(C1, "Girder depth", Road.bridgeDepth, 0.75, 2.4, 0.05, " m", (V) => { Road.bridgeDepth = V; });
            AddRange(C1, "Pier spacing", Road.pierSpacing, 16, 50, 1, " m", (V) => { Road.pierSpacing = V; });
            AddCheck(C1, "2:1 Earth embankment on approaches", Road.embankment, (V) => { Road.embankment = V; });

            const C2 = Card("Roadside Barriers & Parapets", "Physical 3D rail & collision hull");
            AddCheck(C2, "Enable barriers / parapets", Road.guardrails, (V) => { Road.guardrails = V; });
            AddSelect(C2, "Barrier profile", Road.railStyle,
                      railStyles.map((Key) => [Key, railNames[Key] || Key]),
                      (V) => { Road.railStyle = V; });

            const Row = document.createElement("div");
            Row.className = "studio-btn-row";
            const SplitBridge = document.createElement("button");
            SplitBridge.className = "studio-btn gold";
            SplitBridge.textContent = "Convert / Split Highway Bridge";
            SplitBridge.addEventListener("click", () =>
            {
                this.InsertBridgeOnRoad(Road.id);
                this.RefreshStudioPanels();
            });
            Row.appendChild(SplitBridge);
            C2.appendChild(Row);
        }
        else
        {
            if (Node)
            {
                const C1 = Card(Node.name, "Intersection robotics & crossings");
                AddCheck(C1, "Hovering 4-lamp traffic signal", Node.signals, (V) => { Node.signals = V; });
                AddCheck(C1, "Pedestrian zebra crossings", Node.crossings, (V) => { Node.crossings = V; });
            }

            const C2 = Card("World Network Templates", "Load complete interchanges into the level");
            AddSelect(C2, "Load template", "", [
                ["", "— Choose template —"],
                ["demo", "Spline & Highway Bridge Demo (Connected)"],
                ...templateCatalog.map((T) => [T.id, T.name])
            ], (Id) =>
            {
                if (!Id) return;
                this.LoadTemplate(Id);
                this.FitPlanToNetwork();
                this.FrameNetworkIn3D();
            });

            const Row = document.createElement("div");
            Row.className = "studio-btn-row";
            const CopyB = document.createElement("button");
            CopyB.className = "studio-btn";
            CopyB.textContent = "Copy JSON";
            CopyB.addEventListener("click", () =>
            {
                if (navigator.clipboard?.writeText)
                    navigator.clipboard.writeText(this.ExportJson()).then(() => this.Host?.Shell?.Announce("Copied Road Studio JSON"));
            });
            const ResetB = document.createElement("button");
            ResetB.className = "studio-btn";
            ResetB.textContent = "Reset Connected Demo";
            ResetB.addEventListener("click", () =>
            {
                this.ResetToDefault();
                this.FitPlanToNetwork();
                this.FrameNetworkIn3D();
                this.RefreshStudioPanels();
            });
            Row.append(CopyB, ResetB);
            C2.appendChild(Row);
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                          COMPILATION, WEBGPU VERTEX STREAMING & 480 HZ PHYSICS SYNC
    //--------------------------------------------------------------------------------------------------------------------

    PushUndoSnapshot()
    {
        this.UndoStack.push(JSON.stringify(this.Project));
        if (this.UndoStack.length > 40)
            this.UndoStack.shift();
        this.RedoStack.length = 0;
    }

    RebuildWorldNetwork()
    {
        this.Compiled = CompileStudioProjectForWorld(this.Project, {
            LevelKey:       this.LevelKey,
            VertexCapacity: RoadEditorVertexCapacity
        });
    }

    PushGeometryToGpu()
    {
        const Block = this.Scene?.RoadEditorBlock;
        if (!Block)
            return;
        const Set = this.Scene.FacetSets[Block.FacetSet];
        const Occ = this.Scene.Occupants[Block.Occupant];
        const Compiled = this.Compiled;
        if (!Set || !Occ || !Compiled)
            return;

        const ClampedVerts = Math.min(Compiled.VertexCount, Set.VertexCapacity || RoadEditorVertexCapacity);
        Set.Vertices = Compiled.Vertices.subarray(0, ClampedVerts * 8);
        Set.VertexCount = ClampedVerts;

        if (ClampedVerts > 0 && this.Enabled)
        {
            Occ.Roles |= OccupantRole.Raster;
            Occ.Inactive = false;
        }
        else
        {
            Occ.Roles &= ~OccupantRole.Raster;
            Occ.Inactive = true;
        }

        const Device = this.Host?.Exchange?.Device;
        const VertexBuffer = this.Host?.VertexRecords;
        if (Device && VertexBuffer && Number.isInteger(Set.FirstVertex) && ClampedVerts > 0)
        {
            const ByteOffset = Set.FirstVertex * VertexStride;
            Device.queue.writeBuffer(
                VertexBuffer,
                ByteOffset,
                Set.Vertices.buffer,
                Set.Vertices.byteOffset,
                ClampedVerts * VertexStride
            );
            if (this.Host)
                this.Host.PriorValid = false;
        }
    }

    SyncPhysicsSurfaces()
    {
        const Vehicle = this.Host?.Vehicle;
        if (!Vehicle || !Array.isArray(Vehicle.Surfaces))
            return;

        const OldSet = new Set(this.RegisteredSurfaces);
        const BaseSurfaces = Vehicle.Surfaces.filter((S) => !OldSet.has(S));
        const NextStudio = (this.Enabled && this.Compiled?.PhysicsSurfaces?.length)
            ? this.Compiled.PhysicsSurfaces
            : [];

        this.RegisteredSurfaces = NextStudio.slice();
        const Combined = [...BaseSurfaces, ...NextStudio];
        Vehicle.Surfaces = Combined;
        if (this.Host?.Chase)
            this.Host.Chase.Surfaces = Combined;
    }

    SyncTrafficSignals()
    {
        const Traffic = this.Scene?.TrafficLights;
        if (!Traffic)
            return;
        Traffic.SyncEditorJunctionSignals(this.Enabled ? (this.Compiled?.DynamicSignals ?? []) : []);
        this.Host?.UploadTrafficLightOccupants?.();
    }

    CommitChanges(Announcement = null)
    {
        this.RebuildWorldNetwork();
        this.PushGeometryToGpu();
        this.SyncPhysicsSurfaces();
        this.SyncTrafficSignals();
        this.UpdateWorkspaceBarUi();
        this.RenderPlanCanvas();
        if (Announcement && this.Host?.Shell)
            this.Host.Shell.Announce(Announcement);
        this.Host?.Shell?.Refresh?.();
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                  PROGRAMMATIC ROAD, BRIDGE & TEMPLATE OPERATIONS
    //--------------------------------------------------------------------------------------------------------------------

    LoadTemplate(TemplateId)
    {
        this.PushUndoSnapshot();
        let Next;
        if (TemplateId === "demo")
            Next = CreateStarterStudioProject(this.LevelKey);
        else if (TemplateId === "district")
            Next = PlaceTemplateInWorld(makeDemo(), this.LevelKey);
        else
            Next = PlaceTemplateInWorld(makeTemplate(TemplateId), this.LevelKey);

        this.Project = Next;
        const BridgeRoad = this.Project.roads.find((R) => R.bridge) || this.Project.roads[0];
        this.Selection = BridgeRoad ? { kind: "road", id: BridgeRoad.id } : null;
        this.CommitChanges(`Loaded ${this.Project.name}`);
        return this.Project;
    }

    AddPresetTemplate(TemplateId)
    {
        return this.LoadTemplate(TemplateId);
    }

    ApplyRoadPreset(PresetId)
    {
        const Preset = presets.find((P) => P.id === PresetId);
        if (!Preset)
            return false;
        const TargetRoad = this.GetSelectedRoad() || this.Project.roads[0];
        if (!TargetRoad)
            return false;
        this.PushUndoSnapshot();
        const Preserved = {
            bridge:      TargetRoad.bridge,
            bridgeFrom:  TargetRoad.bridgeFrom,
            bridgeTo:    TargetRoad.bridgeTo,
            embankment:  TargetRoad.embankment,
            structure:   TargetRoad.structure,
            bridgeDepth: TargetRoad.bridgeDepth,
            pierSpacing: TargetRoad.pierSpacing
        };
        Object.assign(TargetRoad, roadDefaults, Preset.settings, Preserved);
        this.CommitChanges(`Applied ${Preset.name}`);
        return true;
    }

    AddRoadBetween(StartPos, EndPos, Settings = {})
    {
        this.PushUndoSnapshot();
        const CreatedId = insertRoad(this.Project, StartPos, EndPos, { ...roadDefaults, ...Settings });
        if (!CreatedId)
            return null;
        const Created = this.Project.roads.find((R) => R.id === CreatedId) || null;
        this.Selection = { kind: "road", id: CreatedId };
        this.CommitChanges(`Added ${Created?.name || CreatedId}`);
        return Created;
    }

    InsertBridgeOnRoad(RoadId = null, RiseMeters = 7.2, Structure = "steel")
    {
        const TargetId = RoadId || this.GetSelectedRoad()?.id || this.Project.roads[0]?.id;
        if (!TargetId)
            return null;
        this.PushUndoSnapshot();
        try
        {
            const Result = insertConnectedBridge(this.Project, TargetId, { rise: RiseMeters, structure: Structure });
            const DeckId = Result?.deck?.id || Result?.deckId || TargetId;
            this.Selection = { kind: "road", id: DeckId };
            this.CommitChanges(`Inserted ${Structure} highway bridge (${RiseMeters.toFixed(1)} m)`);
            return Result || true;
        }
        catch (_Err)
        {
            const Road = this.Project.roads.find((R) => R.id === TargetId);
            if (!Road)
                return null;
            Road.bridge = true;
            Road.structure = Structure;
            Road.bridgeFrom = 0.18;
            Road.bridgeTo = 0.82;
            Road.guardrails = true;
            const StartNode = this.Project.nodes.find((N) => N.id === Road.start);
            const EndNode = this.Project.nodes.find((N) => N.id === Road.end);
            if (StartNode && EndNode && StartNode.position[1] < 1.0 && EndNode.position[1] < 1.0)
            {
                Road.h1[1] = RiseMeters;
                Road.h2[1] = RiseMeters;
            }
            this.Selection = { kind: "road", id: Road.id };
            this.CommitChanges(`Converted ${Road.name} to ${Structure} bridge span`);
            return Road;
        }
    }

    MoveJunction(NodeId, Position)
    {
        if (!NodeId || !Array.isArray(Position))
            return false;
        this.PushUndoSnapshot();
        moveNode(this.Project, NodeId, Position);
        this.CommitChanges("Moved shared junction pivot");
        return true;
    }

    ExportJson()
    {
        return JSON.stringify(this.Project, null, 2);
    }

    ImportJson(JsonString)
    {
        const Data = typeof JsonString === "string" ? JSON.parse(JsonString) : JsonString;
        this.PushUndoSnapshot();
        const Parsed = parseProject(Data);
        Parsed.worldSpace = Data.worldSpace !== false;
        this.Project = Parsed;
        this.Selection = this.Project.roads[0] ? { kind: "road", id: this.Project.roads[0].id } : null;
        this.CommitChanges(`Imported ${this.Project.name}`);
        return true;
    }

    DeleteSelected()
    {
        if (!this.Selection)
            return false;
        this.PushUndoSnapshot();
        deleteSelection(this.Project, this.Selection.kind, this.Selection.id);
        this.Selection = this.Project.roads[0] ? { kind: "road", id: this.Project.roads[0].id } : null;
        this.CommitChanges("Removed selected element");
        return true;
    }

    Undo()
    {
        if (this.UndoStack.length === 0)
            return false;
        this.RedoStack.push(JSON.stringify(this.Project));
        const Raw = JSON.parse(this.UndoStack.pop());
        this.Project = Raw;
        this.CommitChanges("Undo road network edit");
        return true;
    }

    Redo()
    {
        if (this.RedoStack.length === 0)
            return false;
        this.UndoStack.push(JSON.stringify(this.Project));
        const Raw = JSON.parse(this.RedoStack.pop());
        this.Project = Raw;
        this.CommitChanges("Redo road network edit");
        return true;
    }

    ResetToDefault()
    {
        this.PushUndoSnapshot();
        this.Project = CreateStarterStudioProject(this.LevelKey);
        this.Selection = this.Project.roads[0] ? { kind: "road", id: this.Project.roads[0].id } : null;
        this.CommitChanges("Reset to Connected Spline & Highway Bridge Demo");
    }

    GetSelectedRoad()
    {
        if (this.Selection?.kind === "road")
            return this.Project.roads.find((R) => R.id === this.Selection.id) || null;
        return null;
    }

    DriveOnSelectedRoad(CustomSelection = null)
    {
        if (!this.Host || !this.Compiled)
            return null;
        this.Host.Training?.Cancel?.();
        const Pose = ResolveSpawnPoseForSelection(this.Compiled, this.Project, CustomSelection || this.Selection);
        this.Host.Vehicle.Respawn(Pose.Position, Pose.YawRad);
        if (this.Host.Recovery)
            this.Host.Recovery.Safe = { Position: [Pose.Position[0], Pose.Position[1]], Yaw: Pose.YawRad };
        this.Host.AfterVehicleMoved();
        this.Host.Shell?.Announce(`Driving on ${Pose.Name}`);
        return Pose;
    }

    QuerySummary()
    {
        const Net = this.Compiled?.Network;
        const Title = this.Project?.name || "Spline & Highway Bridge Demo";
        return {
            Name:          Title,
            ProjectName:   Title,
            Workspace:     this.ActiveWorkspace,
            Enabled:       this.Enabled,
            NodeCount:     this.Project?.nodes?.length ?? 0,
            RoadCount:     this.Project?.roads?.length ?? 0,
            SpanCount:     Net?.spans?.length ?? 0,
            JunctionCount: Net?.junctions?.length ?? 0,
            BridgeCount:   Net?.bridges?.filter((B) => B.kind === "span").length ?? 0,
            PhysicsCount:  this.Compiled?.PhysicsSurfaces?.length ?? 0,
            SignalCount:   this.Compiled?.DynamicSignals?.length ?? 0,
            LengthMeters:  Math.round(Net?.length ?? 0),
            TriangleCount: this.Compiled?.TriangleCount ?? 0,
            VertexCount:   this.Compiled?.VertexCount ?? 0,
            Anchor:        this.Compiled?.Anchor ?? [0.0, 0.0, 0.0]
        };
    }
}
