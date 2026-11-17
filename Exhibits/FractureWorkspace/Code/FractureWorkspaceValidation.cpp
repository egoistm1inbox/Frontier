// Fracture Studio validation: native solver geometry, Jolt fragment bodies, scripted workspace interactions, and
// PPM evidence for the Overview / Physics / Bonds / SDF tabs.

#include "Frontier/Engine/Interface/Workspaces/FractureWorkspace.h"
#include "Frontier/Engine/Interface/Controls/Toast.h"
#include "Frontier/Engine/Interface/InspectorControls.h"
#include "Frontier/Extensions/Physics/FractureStudioRuntime.h"
#include "Engine/Interface/TypefaceRegistry.h"
#include "Exhibits/ControlCentre/Code/CpuRasterization.h"

#include <imgui.h>
#include <Jolt/Jolt.h>
#include <Jolt/Core/IssueReporting.h>

#include <array>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace
{

bool ReportJoltAssertion(const char* Expression, const char* Message, const char* File, JPH::uint Line)
{
    std::fprintf(stderr, "Jolt assertion: %s%s%s (%s:%u)\n", Expression,
                 Message != nullptr ? " — " : "", Message != nullptr ? Message : "", File, Line);
    std::fflush(stderr);
    return false;
}

void Confirm(bool Condition, const char* Description)
{
    if (!Condition) throw std::runtime_error(Description);
}

void CheckNativeSolvers()
{
    using namespace Frontier::Fracture;
    const Polyhedron Base = ConstructSolid(SolidKind::Monolith, { 1.0, 1.0, 1.0 }, 42);
    const Material Concrete = ResolveMaterial(MaterialKind::Concrete);
    const std::array<SolidKind, 8> Solids = { SolidKind::Monolith, SolidKind::CurtainPane, SolidKind::TimberBeam,
                                              SolidKind::Boulder, SolidKind::Cube, SolidKind::Cylinder,
                                              SolidKind::Cone, SolidKind::HollowCore };
    for (SolidKind Kind : Solids)
    {
        const Polyhedron Source = ConstructSolid(Kind, { 1.0, 1.0, 1.0 }, 42);
        const Metrics Shape = EvaluateMetrics(Source);
        Confirm(Source.Vertices.size() >= 4 && !Source.Faces.empty() && Shape.Volume > 1.0e-5,
                "A native source-solid constructor produced no positive-volume closed shape");
    }

    for (int SolverIndex = 0; SolverIndex < 6; ++SolverIndex)
    {
        Request Specification;
        Specification.Algorithm = static_cast<Solver>(SolverIndex);
        Specification.EnergyJoules = 4600.0;
        Specification.Seed = 42;
        Specification.FragmentCeiling = 24;
        Specification.MinimumPieceSizeMetres = 0.04;
        Result Partition = Execute(Base, Specification, Concrete);
        Confirm(Partition.Success, "A native fracture solver failed its geometry checks");
        Confirm(Partition.Fragments.size() > 1 && Partition.Fragments.size() <= Specification.FragmentCeiling,
                "A native solver returned a fragment count outside its ceiling");
        Confirm(Partition.VolumeDriftRatio < 1.0e-4 && Partition.WatertightManifold,
                "A native solver failed volume conservation or closed-manifold validation");
        Confirm(Partition.TotalCrackAreaM2 > 0.0 && Partition.ComputeMilliseconds >= 0.0,
                "A native solver returned missing crack-area or timing measurements");
        for (const Fragment& Piece : Partition.Fragments)
            Confirm(Piece.Shape.Vertices.size() >= 4 && Piece.ShapeMetrics.Volume > 0.0 && Piece.MassKg > 0.0,
                    "A native solver emitted a degenerate shard");
        for (const Bond& Bond : Partition.Bonds)
            Confirm(Bond.FragmentA < Partition.Fragments.size() && Bond.FragmentB < Partition.Fragments.size(),
                    "A native solver emitted a bond with an invalid fragment index");
    }
}

void CheckJoltRuntime(Frontier::FractureStudioRuntime& Runtime)
{
    using namespace Frontier::Fracture;
    const Polyhedron Base = ConstructSolid(SolidKind::Monolith, { 1.0, 1.0, 1.0 }, 42);
    Request Specification;
    Specification.Algorithm = Solver::RuntimeBoussinesq;
    Specification.EnergyJoules = 4600.0;
    Specification.Seed = 42;
    Specification.FragmentCeiling = 24;
    Specification.MinimumPieceSizeMetres = 0.04;
    const Material Concrete = ResolveMaterial(MaterialKind::Concrete);
    std::string Diagnostic;
    if (!Runtime.Bake(Base, Specification, Concrete, &Diagnostic))
        throw std::runtime_error("Jolt fracture bake failed: " + Diagnostic);
    Confirm(Runtime.QueryPhysicsReady(), "Jolt did not publish a ready fracture world");
    Confirm(Runtime.QueryResult().Success && Runtime.QueryFragmentBodyCount() == Runtime.QueryResult().Fragments.size(),
            "The Jolt body roster did not match the native fracture result");
    const Frontier::PhysicsSpace* Space = Runtime.QueryPhysicsSpace();
    Confirm(Space != nullptr && Space->QueryBodyCount() == Runtime.QueryFragmentBodyCount() + 1,
            "The Jolt world is missing shard bodies or its temporary ground body");
    Confirm(Space->QuerySettings().GravityMps2[1] < -9.0,
            "The Studio runtime did not preserve the reference Y-up gravity convention");
    Confirm(Space->QueryDescriptor(0).Shape == Frontier::PhysicsShape::ConvexHull,
            "A generated shard was not installed as a Jolt convex hull");
    Confirm(Space->QueryDescriptor(static_cast<uint32_t>(Runtime.QueryFragmentBodyCount())).Shape == Frontier::PhysicsShape::Box,
            "The isolated runtime ground plane was not installed");
    bool HasImpactVelocity = false;
    for (const Fragment& Piece : Runtime.QueryResult().Fragments)
    {
        const double Speed = std::sqrt(Piece.InitialVelocityMps[0] * Piece.InitialVelocityMps[0] +
                                       Piece.InitialVelocityMps[1] * Piece.InitialVelocityMps[1] +
                                       Piece.InitialVelocityMps[2] * Piece.InitialVelocityMps[2]);
        HasImpactVelocity = HasImpactVelocity || Speed > 0.01;
    }
    Confirm(HasImpactVelocity, "Native impact energy did not produce shard ejection velocities");
    BodyPose PoseBeforeStep;
    Confirm(Runtime.QueryFragmentBody(0, PoseBeforeStep), "The first Jolt shard pose could not be queried");
    Runtime.Step(1.0 / 30.0, 2);
    Confirm(Runtime.QuerySimulatedSeconds() >= 1.0 / 30.0 - 1.0e-9,
            "Jolt did not advance the fracture scene by the requested step");
    BodyPose PoseAfterStep;
    Confirm(Runtime.QueryFragmentBody(0, PoseAfterStep), "The stepped Jolt shard pose could not be queried");
    Confirm(std::isfinite(PoseAfterStep.PositionMetres[0]) && std::isfinite(PoseAfterStep.PositionMetres[1]) &&
                std::isfinite(PoseAfterStep.PositionMetres[2]),
            "Jolt produced a non-finite shard pose");

    const Vec3 StrikePoint{ -0.20, 0.18, 0.48 };
    const Vec3 StrikeNormal{ 0.0, 0.0, -1.0 };
    if (!Runtime.Strike(StrikePoint, StrikeNormal, 5200.0, &Diagnostic))
        throw std::runtime_error("Jolt fracture strike failed: " + Diagnostic);
    Confirm(Runtime.QueryResult().Success && Runtime.QueryFragmentBodyCount() > 1,
            "A runtime strike did not recompute and release convex shards");
    if (!Runtime.Reassemble(&Diagnostic))
        throw std::runtime_error("Jolt fracture reassembly failed: " + Diagnostic);
    Confirm(Runtime.QueryResult().Success && Runtime.QueryResult().Fragments.size() == 1 &&
                Runtime.QueryFragmentBodyCount() == 1 && Runtime.QueryPhysicsSpace()->QueryBodyCount() == 2,
            "Reassembly did not replace the shard world with one intact body and the ground plane");
}

} // namespace

int main(int ArgumentCount, char** Arguments)
{
    using namespace Frontier;
    try
    {
#ifdef JPH_ENABLE_ASSERTS
        JPH::AssertFailed = &ReportJoltAssertion;
#endif
        CheckNativeSolvers();
        ImGui::CreateContext();
        ImGui::StyleColorsDark();
        ImGuiIO& IO = ImGui::GetIO();
        IO.DisplaySize = ImVec2(1560.0f, 1900.0f);
        IO.DeltaTime = 1.0f / 60.0f;
        // 📝 Production typefaces (DM Sans + the JetBrains Mono symbol fallback) so evidence matches the app;
        //    argv[2] is the font-archive root, defaulting to the in-tree EngineContent path.
        TypefaceRegistry   FontRegistry;
        static const char* WantedFonts[] = { "DM Sans", "JetBrains Mono" };
        const char*        ArchiveRoot   = ArgumentCount >= 3 ? Arguments[2] : "EngineContent/FontArchives";
        const uint32_t     FontFamilies  = FontRegistry.Load(ArchiveRoot, WantedFonts, 2);
        if (ArgumentCount >= 3) Confirm(FontFamilies == 2, "The font archive root did not yield DM Sans and JetBrains Mono");
        if (FontFamilies == 0) IO.Fonts->AddFontDefault();
        else TypefaceRegistry::Install(&FontRegistry);
        IO.Fonts->Build();

        const EditorTypefaces Faces = EditorTypefaces::Resolve();
        FractureWorkspaceState State{};
        ConstructFractureWorkspaceState(State);
        FractureStudioRuntime Runtime;
        CheckJoltRuntime(Runtime);
        AssetBrowserLink Link{};

        const auto Frame = [&]()
        {
            ImGui::NewFrame();
            ConstructFractureWorkspace(State, Faces, IO.DisplaySize, &Link, &Runtime, IO.DeltaTime);
            ImGui::Render();
        };
        const auto RectCentre = [&](const char* Name)
        {
            ImVec2 Min{}, Max{};
            char   Missing[128]{};
            std::snprintf(Missing, sizeof(Missing), "Missing validation rect %s", Name);
            Confirm(QueryFractureWorkspaceRect(State, Name, Min, Max), Missing);
            Confirm(Max.x > Min.x && Max.y > Min.y, Missing);
            return ImVec2(0.5f * (Min.x + Max.x), 0.5f * (Min.y + Max.y));
        };
        const auto Click = [&](const char* Name)
        {
            const ImVec2 At = RectCentre(Name);
            IO.AddMousePosEvent(At.x, At.y);
            Frame();
            IO.AddMouseButtonEvent(ImGuiMouseButton_Left, true);
            Frame();
            IO.AddMouseButtonEvent(ImGuiMouseButton_Left, false);
            Frame();
            Frame();
        };

        // 1. Boot: the monolith selects with the Overview tab; catalogues hold pinned order.
        Frame();
        Frame();
        Confirm(QueryFractureMaterialCount() == 6, "The material catalogue lost entries");
        Confirm(QueryFractureMaterialById("concrete") == 0, "Concrete is out of order");
        Confirm(QueryFractureMaterialById("plastic") == 5, "ABS plastic is out of order");
        Confirm(QueryFractureSolverCount() == 6, "The solver catalogue lost entries");
        Confirm(QueryFractureSolverById("engineering_fem") == 1, "engineering_fem is out of order");
        Confirm(QueryFractureSolverById("dendritic") == 5, "dendritic is out of order");
        Confirm(QueryFracturePresetCount() == 8, "The preset catalogue lost entries");
        Confirm(QueryFractureConstructSeedCount() == 7, "The construct seeds lost entries");
        Confirm(State.Selected == 0, "The workspace did not boot on the monolith");
        Confirm(State.ActiveConstruct == 0, "The workspace did not boot its active construct");
        Confirm(State.InspectorTab == FractureWorkspaceState::TabOverview, "The inspector did not boot on Overview");
        Confirm(State.Log.size() == 1, "The boot produced the wrong number of log lines");
        Confirm(State.Log.front().Channel == "WORKSPACE", "The boot line missed its WORKSPACE channel");
        {
            const FractureReceipt& Rec = State.Constructs[0].Receipt;
            Confirm(Rec.FragmentCount == 32, "Native Engineering FEM diverged from the reference monolith fragment count");
            Confirm(Rec.VolumeDriftRatio <= 1.0e-3, "The monolith drift exceeded its bound");
            Confirm(Rec.WatertightManifold, "The monolith missed its watertight manifold");
            Confirm(Rec.BudgetPercent >= 0.0 && Rec.BudgetPercent <= 100.0, "The monolith budget left 0–100");
            Confirm(std::isfinite(Rec.TotalCrackArea) && std::abs(Rec.TotalCrackArea - 9.64874271838099) < 1.0e-6,
                    "Native Engineering FEM diverged from the reference monolith crack area");
            Confirm(Rec.IntactBondCount <= Rec.BondCount, "Intact bonds exceeded total bonds");
            Confirm(State.SunSolved.ElevationDeg > 20.0 && State.SunSolved.ElevationDeg < 45.0,
                    "The solar elevation left its afternoon band");
            Confirm(State.SunSolved.AirMass > 1.0 && State.SunSolved.AirMass < 3.0, "The air mass left its band");
        }

        // 2. Side-by-side cube showcase: every native solver cuts the same cube, and selecting a tile loads that solver on the cube construct.
        Confirm(State.CubeComparisonOpen && State.CubeComparisonReady,
                "The workspace did not open directly into its cached cube solver comparison");
        for (int Solver = 0; Solver < 6; ++Solver)
        {
            const Fracture::Result& Compared = State.CubeComparisonResults[Solver];
            Confirm(Compared.Success && Compared.Fragments.size() >= 2,
                    "A native solver failed to produce a fracture result in the cube comparison");
        }
        Click("CubeCompare/Griffith");
        Confirm(!State.CubeComparisonOpen && State.ActiveConstruct == 5 && State.Selected == 5,
                "Selecting a cube comparison tile did not transition to the cube construct");
        Confirm(State.Constructs[5].Spec.Solver == 2, "The Griffith comparison tile did not load the Griffith solver");
        Click("Outliner/Row0");
        Confirm(State.ActiveConstruct == 0, "The cube comparison did not return to the monolith construct");

        // 3. Outliner: constructs and celestials select silently and reset to Overview.
        Click("Outliner/Row1");
        Confirm(State.Selected == 1, "Clicking the glazing did not select it");
        Confirm(State.ActiveConstruct == 1, "Clicking the glazing did not activate it");
        Confirm(State.InspectorTab == FractureWorkspaceState::TabOverview, "The glazing missed Overview");
        Click("Outliner/Row7");
        Confirm(State.Selected == 7, "Clicking the sun did not select it");
        Click("Outliner/Row8");
        Confirm(State.Selected == 8, "Clicking the atmosphere did not select it");
        Click("Outliner/Row9");
        Confirm(State.Selected == 9, "Clicking the global slab did not select it");
        Confirm(State.Clouds.ActiveScope == 0, "The global slab missed its scope");
        Click("Outliner/Row10");
        Confirm(State.Selected == 10, "Clicking the local volume did not select it");
        Confirm(State.Clouds.ActiveScope == 1, "The local volume missed its scope");
        Click("Outliner/Row0");
        Confirm(State.Selected == 0, "Reselecting the monolith failed");
        {
            const size_t LogSize = State.Log.size();
            Click("Outliner/Eye0");
            Confirm(!State.Constructs[0].BakedResident, "The monolith eye did not clear baked residency");
            Confirm(State.Log.size() == LogSize + 1, "The eye logged no PARAM line");
            Click("Outliner/Eye0");
            Confirm(State.Constructs[0].BakedResident, "The monolith eye did not restore residency");
        }

        // 4. Tabs: Overview / Physics / Bonds / SDF switch silently.
        Click("Inspector/Tab1");
        Confirm(State.InspectorTab == 1, "Clicking Physics did not switch tabs");
        Click("Inspector/Tab2");
        Confirm(State.InspectorTab == 2, "Clicking Bonds did not switch tabs");
        Click("Inspector/Tab3");
        Confirm(State.InspectorTab == 3, "Clicking SDF did not switch tabs");
        Click("Inspector/Tab0");
        Confirm(State.InspectorTab == 0, "Clicking Overview did not switch back");

        // 5. Transport: play bakes and advances Jolt; step advances physics; reset reassembles the body set.
        {
            const double SimulatedBeforePlay = Runtime.QuerySimulatedSeconds();
            Click("Transport/Play");
            Confirm(State.TimelinePlaying, "The play key did not start the native timeline");
            Confirm(State.BakeExecuted && Runtime.QueryPhysicsReady(), "Play did not bake the active recipe into Jolt");
            Confirm(Runtime.QueryFragmentBodyCount() == State.Constructs[0].Receipt.FragmentCount,
                    "The workspace bake did not create one Jolt body per solver fragment");
            Confirm(Runtime.QuerySimulatedSeconds() > SimulatedBeforePlay, "The playing timeline did not step Jolt");
            Click("Transport/Play");
            Confirm(!State.TimelinePlaying, "The play key did not pause");
        }
        const double SimulatedBeforeStep = Runtime.QuerySimulatedSeconds();
        const double TimelineBeforeStep = State.TimelineActive;
        Click("Transport/Step");
        Confirm(State.PhysicsStepExecuted && Runtime.QuerySimulatedSeconds() > SimulatedBeforeStep,
                "The transport step did not advance the Jolt world");
        Confirm(State.TimelineActive > TimelineBeforeStep, "The transport step did not advance the native timeline");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "TRANSPORT", "The native step logged no TRANSPORT line");
        Click("Transport/Reset");
        Confirm(State.TimelineActive == 0.0, "Reset did not return the timeline to t = 0");
        Confirm(State.ExplodeAmount == 0.0, "Reset did not clear explode = 0");
        Confirm(Runtime.QueryFragmentBodyCount() == 1 && Runtime.QueryResult().Fragments.size() == 1,
                "Reset did not reassemble the Jolt shard bodies");
        Click("Transport/Speed");
        Click("Transport/Speed/Option0");
        Confirm(State.PlaybackRate == 0.10, "The speed option did not restage 0.10×");
        Click("Transport/Speed");
        Click("Transport/Speed/Option3");
        Confirm(State.PlaybackRate == 1.0, "The speed option did not restore 1.0×");
        Click("Transport/Explode");
        Confirm(std::fabs(State.ExplodeAmount - 0.5) < 0.02, "The explode track missed its midpoint");

        // 6. Bake and strike solve the current recipe and replace the isolated Jolt shard world.
        {
            State.StrikeExecuted = false;
            Click("Transport/Strike");
            Confirm(State.StrikeExecuted && Runtime.QueryResult().Success && Runtime.QueryFragmentBodyCount() > 1,
                    "Strike did not solve and release convex shards into Jolt");
            Confirm(Toast::QueryVisible(), "The native strike raised no completion toast");
            Confirm(!State.Log.empty() && State.Log.front().Channel == "STRIKE", "Strike logged no STRIKE line");
            State.BakeExecuted = false;
            Click("Transport/Bake");
            Confirm(State.BakeExecuted && Runtime.QueryResult().Success && Runtime.QueryFragmentBodyCount() > 1,
                    "Bake did not create a Jolt body set from the native partition");
            Confirm(Toast::QueryVisible(), "The native bake raised no completion toast");
            Confirm(!State.Log.empty() && State.Log.front().Channel == "BAKE", "Bake logged no BAKE line");
            State.StrikeExecuted = false;
            Click("Surface/Shards");
            Confirm(State.StrikeExecuted && !State.Log.empty() && State.Log.front().Channel == "STRIKE",
                    "Clicking the shard stage did not issue a native impact strike");
            const Fracture::Metrics& Base = State.Constructs[0].NativeResult.BaseMetrics;
            Confirm(std::fabs(State.Constructs[0].Spec.ImpactPoint[2] - Base.BoundsMax[2]) < 1.0e-3,
                    "The stage click did not map its hit point onto the source solid surface");
            Confirm(Runtime.QueryFragmentBodyCount() == State.Constructs[0].Receipt.FragmentCount,
                    "The stage strike did not refresh the Jolt bodies from its new solver result");
        }

        // 7. Timeline: the ruler scrubs silently.
        Click("Timeline/Ruler");
        Confirm(std::fabs(State.TimelineActive - 2.0) < 0.05, "The ruler scrub missed 2.0 s");
        Confirm(!State.TimelinePlaying, "Scrubbing left the clock playing");

        // 8. Viewport bar: pipeline restages the recipe; lens/camera stay silent; focus/maximize NOOP.
        Click("Viewport/Pipeline");
        Click("Viewport/Pipeline/Option1");
        Confirm(State.Constructs[0].Pipeline == "baked", "Eng.Bake did not restage the pipeline");
        Confirm(State.Constructs[0].Spec.Solver == 1, "Eng.Bake did not remap the solver");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "PARAM", "The pipeline select logged no PARAM line");
        Click("Viewport/Pipeline");
        Click("Viewport/Pipeline/Option0");
        Confirm(State.Constructs[0].Pipeline == "realtime", "Realtime did not restage the pipeline");
        Confirm(State.Constructs[0].Spec.Solver == 0, "Realtime did not remap the solver");
        {
            const size_t LogSize = State.Log.size();
            Click("Viewport/Lens");
            Click("Viewport/Lens/Option2");
            Confirm(State.Lens == 2, "The lens option did not restage the SDF lens");
            Click("Viewport/Camera");
            Click("Viewport/Camera/Option3");
            Confirm(State.Camera == 3, "The camera option did not restage the Top camera");
            Confirm(State.Log.size() == LogSize, "A silent viewport select logged");
            Click("Viewport/Focus");
            Confirm(Toast::QueryVisible(), "Focus raised no toast");
            Confirm(State.Log.size() == LogSize + 1, "Focus logged no VIEW line");
        }
        Click("Viewport/Maximize");
        Confirm(Toast::QueryVisible(), "Maximize raised no toast");

        // 9. Stage tools switch silently; reassemble bakes the selected recipe and restores one Jolt body.
        {
            const size_t LogSize = State.Log.size();
            Click("Surface/Tool1");
            Confirm(State.Tool == 1, "The orbit tool did not engage");
            Click("Surface/Tool2");
            Confirm(State.Tool == 2, "The gizmo tool did not engage");
            Click("Surface/Tool0");
            Confirm(State.Tool == 0, "The strike tool did not re-engage");
            Confirm(State.Log.size() == LogSize, "A silent tool logged");
            Click("Surface/Reassemble");
            Confirm(State.TimelineActive == 0.0, "Reassemble did not restage t = 0");
            Confirm(State.ExplodeAmount == 0.0, "Reassemble did not restage explode = 0");
            Confirm(Runtime.QueryResult().Success && Runtime.QueryFragmentBodyCount() == 1,
                    "The stage reassemble control did not restore the intact Jolt body");
        }

        // 10. Library: browsing delegates to the shared Asset Browser; handoffs spawn-refuse/select/apply.
        Click("Library/Browse");
        Confirm(Link.OpenRequested, "The browse row did not request the browser");
        Confirm(Link.OpenWorkspace == AssetBrowserWorkspaceFracture, "The browse row requested the wrong workspace");
        Link.OpenRequested = false;
        Link.OpenWorkspace = -1;
        const auto HandOff = [&](const char* Id)
        {
            std::snprintf(Link.OpenRecordId, sizeof(Link.OpenRecordId), "%s", Id);
            Link.OpenRecordWorkspace = AssetBrowserWorkspaceFracture;
            Frame();
            Frame();
            Confirm(!Link.HasHandoff(), "The shell did not consume the handoff");
        };
        HandOff("fracture/monolith-concrete");
        Confirm(Toast::QueryVisible(), "The spawn handoff raised no toast");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "SPAWN", "The spawn handoff logged no SPAWN line");
        HandOff("fracture-solver/griffith");
        Confirm(State.Constructs[State.ActiveConstruct].Spec.Solver == QueryFractureSolverById("griffith"),
                "The solver handoff did not apply");
        Confirm(State.Log.front().Channel == "PARAM", "The solver handoff logged no PARAM line");
        HandOff("fracture-mat/granite");
        Confirm(State.Constructs[State.ActiveConstruct].Spec.Material == QueryFractureMaterialById("granite"),
                "The material handoff did not apply");
        Confirm(State.Log.front().Channel == "FRACTURE", "The material handoff logged no FRACTURE line");
        HandOff("fracture/construct-polymer");
        Confirm(State.Selected == 6 && State.ActiveConstruct == 6, "The construct handoff did not open");
        Confirm(State.Log.front().Channel == "FRACTURE", "The construct handoff logged no FRACTURE line");
        HandOff("fracture/construct-monolith");
        Confirm(State.Selected == 0 && State.ActiveConstruct == 0, "The monolith handoff did not restore");

        // 10. Top bar: tabs select silently; add/export/help refuse.
        Click("TopBar/Tab3");
        Confirm(State.ActiveConstruct == 3 && State.Selected == 3, "The erratic tab did not select");
        Click("TopBar/Tab0");
        Confirm(State.ActiveConstruct == 0 && State.Selected == 0, "The monolith tab did not restore");
        Click("TopBar/Add");
        Confirm(Toast::QueryVisible(), "The add key raised no toast");
        Click("TopBar/Export");
        Confirm(Toast::QueryVisible(), "Export raised no toast");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "EXPORT", "Export logged no EXPORT line");
        Click("TopBar/Help");
        Confirm(Toast::QueryVisible(), "Help raised no toast");

        // 11. Solver matrix: rows restage the solver; close and veil dismiss.
        {
            ImVec2 Min{}, Max{};
            Confirm(!QueryFractureWorkspaceRect(State, "Matrix/Close", Min, Max), "The matrix leaked rects while closed");
        }
        Click("TopBar/Solvers");
        Confirm(State.MatrixOpen, "The Solvers key did not open the matrix");
        Click("Matrix/Row2");
        Confirm(State.Constructs[0].Spec.Solver == 2, "The matrix row did not restage griffith");
        Confirm(!State.MatrixOpen, "Picking a solver left the matrix open");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "PARAM", "The matrix pick logged no PARAM line");
        Click("Library/Matrix");
        Confirm(State.MatrixOpen, "The library Matrix key did not reopen the matrix");
        Click("Matrix/Close");
        Confirm(!State.MatrixOpen, "The matrix close key did not dismiss");

        // 12. Inspector reset restores the seed recipe.
        Click("Inspector/Reset");
        Confirm(State.Constructs[0].Spec.Solver == 1, "Reset did not restore engineering_fem");
        Confirm(State.Constructs[0].Spec.Energy == 4600.0, "Reset did not restore 4600 J");
        Confirm(State.Constructs[0].Pipeline == "baked", "Reset did not restore the baked pipeline");
        Confirm(Toast::QueryVisible(), "Reset raised no toast");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "SCENE", "Reset logged no SCENE line");

        // 13. Celestial pages render across their tabs.
        Click("Outliner/Row7");
        Click("Inspector/Tab1");
        Click("Inspector/Tab2");
        Click("Inspector/Tab3");
        Click("Inspector/Tab0");
        Confirm(State.InspectorTab == 0, "The sun missed its Cycle & Arc tab");
        Click("Outliner/Row8");
        Click("Inspector/Tab2");
        Confirm(State.InspectorTab == 2, "The atmosphere missed its Twilight tab");
        Click("Outliner/Row9");
        Frame();
        Click("Outliner/Row0");

        // 14. Evidence: one frame per fracture tab.
        const auto RenderEvidence = [&](const char* Path)
        {
            IO.AddMousePosEvent(-1.0f, -1.0f);
            Frame();
            FrontierExhibit::AcknowledgeTextures();
            const int Width  = static_cast<int>(IO.DisplaySize.x * IO.DisplayFramebufferScale.x);
            const int Height = static_cast<int>(IO.DisplaySize.y * IO.DisplayFramebufferScale.y);
            std::vector<unsigned char> Pixels(static_cast<size_t>(Width) * Height * 3, 0x18);
            const ImDrawData* DrawData = ImGui::GetDrawData();
            for (const ImDrawList* DrawList : DrawData->CmdLists)
                FrontierExhibit::RasterizeCommands(DrawList, Pixels.data(), Width, Height, DrawData->DisplayPos, DrawData->FramebufferScale);
            std::ofstream Image(Path, std::ios::binary);
            Image << "P6\n" << Width << ' ' << Height << "\n255\n";
            Image.write(reinterpret_cast<const char*>(Pixels.data()), static_cast<std::streamsize>(Pixels.size()));
            if (!Image) throw std::runtime_error("Could not write Fracture workspace PPM evidence");
        };
        if (ArgumentCount >= 2)
        {
            std::string Stem = Arguments[1];
            const size_t Dot = Stem.rfind(".ppm");
            if (Dot != std::string::npos && Dot + 4 == Stem.size()) Stem.erase(Dot);
            Click("Outliner/Row0");
            Click("Footer/CubeCompare");
            RenderEvidence((Stem + "-cube-comparison.ppm").c_str());
            Click("Footer/CubeCompare");
            Click("Inspector/Tab0");
            Click("Transport/Reset");
            Click("Transport/Bake");
            IO.DeltaTime = 0.02f;
            Click("Transport/Play");
            for (int FrameIndex = 0; FrameIndex < 5; ++FrameIndex) Frame();
            Click("Transport/Play");
            IO.DeltaTime = 1.0f / 60.0f;
            Confirm(!State.TimelinePlaying && Runtime.QueryFragmentBodyCount() > 1 &&
                        Runtime.QuerySimulatedSeconds() >= 0.10,
                    "The evidence capture did not show a stepped Jolt shard scene");
            RenderEvidence((Stem + "-overview.ppm").c_str());
            Click("Inspector/Tab1");
            RenderEvidence((Stem + "-physics.ppm").c_str());
            Click("Inspector/Tab2");
            RenderEvidence((Stem + "-bonds.ppm").c_str());
            Click("Inspector/Tab3");
            RenderEvidence((Stem + "-sdf.ppm").c_str());
        }

        std::fprintf(stdout, "FractureWorkspaceValidation: boot/select/cube-solver-comparison/tabs/transport/strike-bake/timeline/viewport/tools/library/topbar/matrix/reset/celestial checks passed\n");
        ImGui::DestroyContext();
        return 0;
    }
    catch (const std::exception& Failure)
    {
        ImGui::DestroyContext();
        std::fprintf(stderr, "FractureWorkspaceValidation: %s\n", Failure.what());
        return 1;
    }
}
