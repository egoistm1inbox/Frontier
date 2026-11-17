/*==========================================================================================================================================
                                                         PHYSICSSPACEVALIDATION.CPP
==========================================================================================================================================*/
// 🧩 PhysicsSpace (Jolt behind Frontier/Extensions/Physics) against closed forms and its own repeat runs: free fall, a box coming
//    to rest and sleeping, a sphere knocking a box, a stable stack, bit-identical repeat runs, the Euler convention, the level
//    bridge (a Geometry record falls onto a pedestal and is put back) and a 1000-box timing. Then the capture: a side view of
//    13 bodies falling and colliding over 5 s, drawn at seven instants with their tracks.
//
//     PhysicsSpaceValidation <Exhibits/Physics>     (writes Results/PhysicsSpaceValidation.md and Images/PhysicsSpaceFalling.png)

#include "Frontier/Extensions/Physics/PhysicsExtension.h"
#include "Frontier/Extensions/Physics/PhysicsSpace.h"

#include "Frontier/Engine/Scene/WorldSpace.h"
#include "Exhibits/ControlCentre/Code/CpuRasterization.h"

#include <imgui.h>
#include <stb_image_write.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

using namespace Frontier;

namespace
{

int                      Failures   = 0;
int                      Assertions = 0;
std::vector<std::string> Ledger;

void Expect(bool Condition, const std::string& Claim)
{
    ++Assertions;
    if (!Condition) ++Failures;
    Ledger.push_back(std::string("| ") + (Condition ? "🟢" : "🔴") + " | " + Claim + " |");
    std::printf("  %s %s\n", Condition ? "🟢" : "🔴", Claim.c_str());
}

std::string Figure(const char* Format, double Value)
{
    char Text[64];
    std::snprintf(Text, sizeof(Text), Format, Value);
    return Text;
}

PhysicsBodyDescriptor GroundSlab()
{
    PhysicsBodyDescriptor Ground;
    Ground.HalfExtentMetres = { 200.0, 200.0, 1.0 };
    Ground.PositionMetres   = { 0.0, 0.0, -1.0 };
    Ground.Motion           = PhysicsMotion::Fixed;
    Ground.Friction         = 0.8;
    return Ground;
}

PhysicsBodyDescriptor Cube(double Half, std::array<double, 3> Position)
{
    PhysicsBodyDescriptor Body;
    Body.HalfExtentMetres = { Half, Half, Half };
    Body.PositionMetres   = Position;
    return Body;
}

void Run(PhysicsSpace& Space, double Seconds)
{
    const int Steps = static_cast<int>(std::lround(Seconds * 60.0));
    for (int Step = 0; Step < Steps; ++Step) Space.Step(1.0 / 60.0);
}

// 📝 A pile of 30 boxes and spheres dropped onto the ground: the determinism scenario.
std::vector<std::array<double, 7>> RunPile()
{
    PhysicsSpaceSettings Settings;
    Settings.Workers = 2;
    PhysicsSpace Space(Settings);
    (void)Space.AddBody(GroundSlab());
    for (int Index = 0; Index < 30; ++Index)
    {
        PhysicsBodyDescriptor Body = Cube(0.3 + 0.05 * (Index % 3), { 0.37 * (Index % 5), 0.21 * (Index % 4), 2.0 + 0.9 * Index });
        Body.Shape       = Index % 4 == 0 ? PhysicsShape::Sphere : PhysicsShape::Box;
        Body.Orientation = ResolvePhysicsOrientation({ 7.0 * Index, 3.0 * Index, 11.0 * Index });
        (void)Space.AddBody(Body);
    }
    Space.Prepare();
    Run(Space, 4.0);
    std::vector<std::array<double, 7>> Result;
    for (uint32_t Index = 1; Index < Space.QueryBodyCount(); ++Index)
    {
        const PhysicsBodyReading Reading = Space.ReadBody(Index);
        Result.push_back({ Reading.PositionMetres[0], Reading.PositionMetres[1], Reading.PositionMetres[2], Reading.Orientation[0], Reading.Orientation[1],
                           Reading.Orientation[2], Reading.Orientation[3] });
    }
    return Result;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    CAPTURE
//------------------------------------------------------------------------------------------------------------------------

constexpr int CaptureWidth  = 1920;
constexpr int CaptureHeight = 1080;

struct Snapshot
{
    double                          Seconds = 0.0;
    std::vector<PhysicsBodyReading> Bodies;
};

// 📝 The side view: level x to the right, z up; y drops out. 64 px per metre about (0, 2.6) m.
ImVec2 Project(const std::array<double, 3>& Point)
{
    return ImVec2(static_cast<float>(CaptureWidth * 0.5 + (Point[0] - 0.5) * 64.0), static_cast<float>(CaptureHeight * 0.80 - Point[2] * 64.0));
}

std::vector<ImVec2> OutlineBox(const PhysicsBodyDescriptor& Body, const PhysicsBodyReading& Reading)
{
    std::vector<ImVec2> Points;
    for (int Corner = 0; Corner < 8; ++Corner)
    {
        const std::array<double, 3> Local = { (Corner & 1 ? 1.0 : -1.0) * Body.HalfExtentMetres[0], (Corner & 2 ? 1.0 : -1.0) * Body.HalfExtentMetres[1],
                                              (Corner & 4 ? 1.0 : -1.0) * Body.HalfExtentMetres[2] };
        const std::array<double, 3> Turned = RotatePhysicsVector(Reading.Orientation, Local);
        Points.push_back(Project({ Reading.PositionMetres[0] + Turned[0], 0.0, Reading.PositionMetres[2] + Turned[2] }));
    }
    // 📝 The convex hull of the eight projected corners (monotone chain), counter-clockwise on screen.
    std::sort(Points.begin(), Points.end(), [](ImVec2 A, ImVec2 B) { return A.x < B.x || (A.x == B.x && A.y < B.y); });
    std::vector<ImVec2> Hull(16);
    size_t              Count = 0;
    const auto Turn = [](ImVec2 O, ImVec2 A, ImVec2 B) { return (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x); };
    for (const ImVec2& Point : Points)
    {
        while (Count >= 2 && Turn(Hull[Count - 2], Hull[Count - 1], Point) <= 0.0f) --Count;
        Hull[Count++] = Point;
    }
    for (size_t Index = Points.size() - 1, Lower = Count + 1; Index-- > 0;)
    {
        while (Count >= Lower && Turn(Hull[Count - 2], Hull[Count - 1], Points[Index]) <= 0.0f) --Count;
        Hull[Count++] = Points[Index];
    }
    Hull.resize(Count > 1 ? Count - 1 : Count);
    return Hull;
}

bool WriteCapture(const std::filesystem::path& Target, const std::filesystem::path& Fonts)
{
    // ① the scene: ground, a pedestal, a tilted ramp; a column of boxes, spheres rolling down the ramp, one thrown sphere
    PhysicsSpaceSettings Settings;
    Settings.Workers = 2;
    PhysicsSpace Space(Settings);
    (void)Space.AddBody(GroundSlab());
    PhysicsBodyDescriptor Pedestal = Cube(1.0, { 0.0, 0.0, 0.5 });
    Pedestal.HalfExtentMetres      = { 1.2, 1.2, 0.5 };
    Pedestal.Motion                = PhysicsMotion::Fixed;
    (void)Space.AddBody(Pedestal);
    PhysicsBodyDescriptor Ramp = Cube(1.0, { -7.0, 0.0, 1.6 });
    Ramp.HalfExtentMetres      = { 3.0, 1.5, 0.15 };
    Ramp.Orientation           = ResolvePhysicsOrientation({ 0.0, 22.0, 0.0 });
    Ramp.Motion                = PhysicsMotion::Fixed;
    (void)Space.AddBody(Ramp);
    for (int Index = 0; Index < 8; ++Index)
    {
        PhysicsBodyDescriptor Body = Cube(0.32, { -0.25 + 0.17 * (Index % 3), 0.0, 2.2 + 0.9 * Index });
        Body.Orientation           = ResolvePhysicsOrientation({ 0.0, 9.0 * Index - 30.0, 0.0 });
        Body.Restitution           = 0.15;
        (void)Space.AddBody(Body);
    }
    for (int Index = 0; Index < 4; ++Index)
    {
        PhysicsBodyDescriptor Ball = Cube(0.0, { -9.0 + 0.7 * Index, 0.0, 3.4 + 0.25 * Index });
        Ball.Shape               = PhysicsShape::Sphere;
        Ball.HalfExtentMetres    = { 0.3, 0.3, 0.3 };
        Ball.Restitution         = 0.35;
        (void)Space.AddBody(Ball);
    }
    PhysicsBodyDescriptor Thrown = Cube(0.0, { 9.0, 0.0, 2.0 });
    Thrown.Shape                 = PhysicsShape::Sphere;
    Thrown.HalfExtentMetres      = { 0.45, 0.45, 0.45 };
    Thrown.MassKilograms         = 900.0;
    Thrown.LinearVelocityMps     = { -7.5, 0.0, 3.5 };
    (void)Space.AddBody(Thrown);
    Space.Prepare();

    // ② seven instants and every body's track
    const double             Instants[] = { 0.0, 0.5, 1.0, 1.5, 2.0, 3.0, 5.0 };
    std::vector<Snapshot>    Snapshots;
    std::vector<std::vector<ImVec2>> Tracks(Space.QueryBodyCount());
    int                      Step = 0;
    for (const double Instant : Instants)
    {
        while (Step < static_cast<int>(std::lround(Instant * 60.0)))
        {
            Space.Step(1.0 / 60.0);
            ++Step;
            if (Step % 3 == 0)
                for (uint32_t Body = 0; Body < Space.QueryBodyCount(); ++Body)
                    if (Space.QueryDescriptor(Body).Motion == PhysicsMotion::Moving) Tracks[Body].push_back(Project(Space.ReadBody(Body).PositionMetres));
        }
        Snapshot Taken{ Instant, {} };
        for (uint32_t Body = 0; Body < Space.QueryBodyCount(); ++Body) Taken.Bodies.push_back(Space.ReadBody(Body));
        Snapshots.push_back(std::move(Taken));
    }

    // ③ the drawing through the exhibits' ImGui rasterizer
    ImGui::CreateContext();
    ImGuiIO& Io    = ImGui::GetIO();
    Io.DisplaySize = ImVec2(static_cast<float>(CaptureWidth), static_cast<float>(CaptureHeight));
    Io.IniFilename = nullptr;
    Io.BackendFlags |= ImGuiBackendFlags_RendererHasTextures | ImGuiBackendFlags_RendererHasVtxOffset;
    ImGui::GetPlatformIO().Renderer_TextureMaxWidth  = 4096;
    ImGui::GetPlatformIO().Renderer_TextureMaxHeight = 4096;
    ImFont* Face = nullptr;
    if (std::filesystem::exists(Fonts / "DMSans" / "DMSans-Regular.ttf")) Face = Io.Fonts->AddFontFromFileTTF((Fonts / "DMSans" / "DMSans-Regular.ttf").string().c_str(), 20.0f);
    if (Face == nullptr) Face = Io.Fonts->AddFontDefault();
    const ImU32 Moving[13] = { IM_COL32(242, 101, 92, 255),  IM_COL32(255, 168, 76, 255),  IM_COL32(246, 214, 92, 255), IM_COL32(130, 214, 110, 255),
                               IM_COL32(86, 200, 186, 255),  IM_COL32(90, 160, 255, 255),  IM_COL32(150, 128, 255, 255), IM_COL32(222, 120, 220, 255),
                               IM_COL32(236, 236, 236, 255), IM_COL32(255, 196, 160, 255), IM_COL32(180, 230, 255, 255), IM_COL32(200, 255, 190, 255),
                               IM_COL32(255, 120, 160, 255) };
    for (int Refresh = 0; Refresh < 3; ++Refresh)
    {
        Io.DeltaTime = 1.0f / 30.0f;
        ImGui::NewFrame();
        ImDrawList* Ink = ImGui::GetBackgroundDrawList();
        Ink->AddRectFilled(ImVec2(0, 0), Io.DisplaySize, IM_COL32(20, 22, 27, 255));
        for (int Metre = -14; Metre <= 15; ++Metre)
            Ink->AddLine(Project({ double(Metre), 0.0, 0.0 }), Project({ double(Metre), 0.0, 12.0 }), IM_COL32(255, 255, 255, Metre % 5 == 0 ? 22 : 9), 1.0f);
        for (int Metre = 1; Metre <= 11; ++Metre)
            Ink->AddLine(Project({ -15.0, 0.0, double(Metre) }), Project({ 16.0, 0.0, double(Metre) }), IM_COL32(255, 255, 255, Metre % 5 == 0 ? 22 : 9), 1.0f);
        Ink->AddRectFilled(Project({ -16.0, 0.0, 0.0 }), Project({ 17.0, 0.0, -6.0 }), IM_COL32(44, 47, 54, 255));
        Ink->AddLine(Project({ -16.0, 0.0, 0.0 }), Project({ 17.0, 0.0, 0.0 }), IM_COL32(180, 184, 192, 255), 2.0f);
        // tracks
        for (uint32_t Body = 0; Body < Space.QueryBodyCount(); ++Body)
            if (Tracks[Body].size() > 1)
                Ink->AddPolyline(Tracks[Body].data(), static_cast<int>(Tracks[Body].size()), (Moving[Body % 13] & 0x00FFFFFFu) | 0x50000000u, ImDrawFlags_None, 1.5f);
        // the instants, faint to solid
        for (size_t Taken = 0; Taken < Snapshots.size(); ++Taken)
        {
            const bool  Last  = Taken + 1 == Snapshots.size();
            const auto  Alpha = static_cast<ImU32>(Last ? 255 : 40 + 25 * Taken);
            for (uint32_t Body = 0; Body < Space.QueryBodyCount(); ++Body)
            {
                const PhysicsBodyDescriptor& Descriptor = Space.QueryDescriptor(Body);
                const PhysicsBodyReading&    Reading    = Snapshots[Taken].Bodies[Body];
                if (Body == 0) continue;
                const bool  Fixed = Descriptor.Motion == PhysicsMotion::Fixed;
                if (Fixed && !Last) continue;
                const ImU32 Tint = Fixed ? IM_COL32(120, 126, 138, 255) : Moving[Body % 13];
                const ImU32 Fill = (Tint & 0x00FFFFFFu) | ((Fixed ? 255u : Alpha * 3u / 5u) << 24);
                const ImU32 Edge = (Tint & 0x00FFFFFFu) | (Alpha << 24);
                if (Descriptor.Shape == PhysicsShape::Sphere)
                {
                    const ImVec2 Centre = Project(Reading.PositionMetres);
                    const float  Radius = static_cast<float>(Descriptor.HalfExtentMetres[0] * 64.0);
                    Ink->AddCircleFilled(Centre, Radius, Fill, 40);
                    Ink->AddCircle(Centre, Radius, Edge, 40, Last ? 2.0f : 1.0f);
                    const std::array<double, 3> Spoke = RotatePhysicsVector(Reading.Orientation, { Descriptor.HalfExtentMetres[0], 0.0, 0.0 });
                    Ink->AddLine(Centre, Project({ Reading.PositionMetres[0] + Spoke[0], 0.0, Reading.PositionMetres[2] + Spoke[2] }), Edge, 1.5f);
                }
                else
                {
                    const std::vector<ImVec2> Hull = OutlineBox(Descriptor, Reading);
                    Ink->AddConvexPolyFilled(Hull.data(), static_cast<int>(Hull.size()), Fill);
                    Ink->AddPolyline(Hull.data(), static_cast<int>(Hull.size()), Edge, ImDrawFlags_Closed, Last ? 2.0f : 1.0f);
                }
            }
        }
        // labels
        char Title[160];
        std::snprintf(Title, sizeof(Title), "PhysicsSpace  \xC2\xB7  JoltPhysics 5.6.0  \xC2\xB7  %zu moving bodies, 3 fixed  \xC2\xB7  5 s at 60 Hz", Space.QueryBodyCount() - 3);
        Ink->AddText(Face, 30.0f, ImVec2(64, 48), IM_COL32(236, 238, 242, 255), Title);
        Ink->AddText(Face, 20.0f, ImVec2(64, 92), IM_COL32(170, 176, 188, 255),
                     "Side view (x right, z up, 1 m grid). Each body at 0, 0.5, 1, 1.5, 2 and 3 s (faint) and 5 s (solid), with its track.");
        char Contacts[96];
        std::snprintf(Contacts, sizeof(Contacts), "%llu contacts added  \xC2\xB7  %zu bodies awake at 5 s", static_cast<unsigned long long>(Space.QueryContactsAdded()),
                      Space.QueryAwakeCount());
        Ink->AddText(Face, 20.0f, ImVec2(64, 122), IM_COL32(170, 176, 188, 255), Contacts);
        ImGui::Render();
        FrontierExhibit::AcknowledgeTextures();
    }
    std::vector<unsigned char> Pixels(static_cast<size_t>(CaptureWidth) * CaptureHeight * 3u, 0u);
    const ImDrawData*          DrawData = ImGui::GetDrawData();
    for (const ImDrawList* List : DrawData->CmdLists)
        FrontierExhibit::RasterizeCommands(List, Pixels.data(), CaptureWidth, CaptureHeight, DrawData->DisplayPos, DrawData->FramebufferScale);
    ImGui::DestroyContext();
    std::filesystem::create_directories(Target.parent_path());
    return stbi_write_png(Target.string().c_str(), CaptureWidth, CaptureHeight, 3, Pixels.data(), CaptureWidth * 3) != 0;
}

} // namespace

int main(int ArgumentCount, char** Arguments)
{
    const std::filesystem::path Exhibit = ArgumentCount > 1 ? std::filesystem::path(Arguments[1]) : std::filesystem::path("Exhibits/Physics");
    const std::filesystem::path Fonts   = Exhibit.parent_path().parent_path() / "EngineContent" / "FontArchives";

    // ① free fall: z = z₀ − g t² / 2 (the semi-implicit step lands within a few centimetres after 1 s)
    {
        PhysicsSpace          Space;
        PhysicsBodyDescriptor Ball = Cube(0.0, { 0.0, 0.0, 20.0 });
        Ball.Shape               = PhysicsShape::Sphere;
        Ball.HalfExtentMetres    = { 0.25, 0.25, 0.25 };
        Ball.LinearDamping       = 0.0;
        (void)Space.AddBody(Ball);
        Run(Space, 1.0);
        const PhysicsBodyReading Reading = Space.ReadBody(0);
        const double             Height  = 20.0 - 0.5 * 9.81;
        Expect(std::abs(Reading.PositionMetres[2] - Height) < 0.15, "free fall: " + Figure("%.3f", Reading.PositionMetres[2]) + " m after 1 s (closed form " + Figure("%.3f", Height) + " m)");
        Expect(std::abs(Reading.LinearVelocityMps[2] + 9.81) < 0.2, "free fall: " + Figure("%.2f", Reading.LinearVelocityMps[2]) + " m/s after 1 s (closed form −9.81)");
    }

    // ② a cube dropped from 3 m comes to rest on the ground and sleeps
    {
        PhysicsSpace Space;
        (void)Space.AddBody(GroundSlab());
        (void)Space.AddBody(Cube(0.5, { 0.0, 0.0, 3.0 }));
        Space.Prepare();
        Run(Space, 4.0);
        const PhysicsBodyReading Reading = Space.ReadBody(1);
        const double Speed = std::hypot(Reading.LinearVelocityMps[0], Reading.LinearVelocityMps[1], Reading.LinearVelocityMps[2]);
        Expect(std::abs(Reading.PositionMetres[2] - 0.5) < 0.02, "a 1 m cube rests on the ground: centre at " + Figure("%.3f", Reading.PositionMetres[2]) + " m");
        Expect(Speed < 0.02 && !Reading.Awake, "it stops (" + Figure("%.4f", Speed) + " m/s) and sleeps");
        Expect(Space.QueryContactsAdded() > 0, "the landing is a contact (" + std::to_string(Space.QueryContactsAdded()) + ")");
    }

    // ③ a sphere rolling at 5 m/s knocks a resting box
    {
        PhysicsSpace Space;
        (void)Space.AddBody(GroundSlab());
        (void)Space.AddBody(Cube(0.4, { 3.0, 0.0, 0.4 }));
        PhysicsBodyDescriptor Ball = Cube(0.0, { 0.0, 0.0, 0.35 });
        Ball.Shape                = PhysicsShape::Sphere;
        Ball.HalfExtentMetres     = { 0.35, 0.35, 0.35 };
        Ball.MassKilograms        = 400.0;
        Ball.LinearVelocityMps    = { 5.0, 0.0, 0.0 };
        (void)Space.AddBody(Ball);
        Space.Prepare();
        Run(Space, 2.0);
        const double Pushed = Space.ReadBody(1).PositionMetres[0] - 3.0;
        Expect(Pushed > 0.05, "the sphere pushes the box " + Figure("%.2f", Pushed) + " m along x");
    }

    // ④ a stack of five half-metre cubes stands
    {
        PhysicsSpace Space;
        (void)Space.AddBody(GroundSlab());
        for (int Level = 0; Level < 5; ++Level) (void)Space.AddBody(Cube(0.25, { 0.0, 0.0, 0.25 + 0.5 * Level + 0.002 * Level }));
        Space.Prepare();
        Run(Space, 5.0);
        const PhysicsBodyReading Top = Space.ReadBody(5);
        Expect(std::abs(Top.PositionMetres[2] - 2.25) < 0.05 && std::hypot(Top.PositionMetres[0], Top.PositionMetres[1]) < 0.05,
               "a stack of five cubes stands: top at " + Figure("%.3f", Top.PositionMetres[2]) + " m");
    }

    // ⑤ the same pile twice: bit-identical
    {
        const auto First = RunPile(), Second = RunPile();
        Expect(First.size() == Second.size() && std::memcmp(First.data(), Second.data(), First.size() * sizeof(First[0])) == 0,
               "a 30-body pile settles bit-identically twice (cross-platform deterministic build)");
    }

    // ⑥ the level's Euler convention survives the quaternion
    {
        double Worst = 0.0;
        for (int Sample = 0; Sample < 200; ++Sample)
        {
            const std::array<double, 3> Euler = { -170.0 + 1.7 * Sample, -85.0 + 0.85 * Sample, 179.0 - 1.79 * Sample };
            const std::array<double, 3> Back  = ResolvePhysicsEulerDegrees(ResolvePhysicsOrientation(Euler));
            for (size_t Axis = 0; Axis < 3; ++Axis) Worst = std::max(Worst, std::abs(std::remainder(Back[Axis] - Euler[Axis], 360.0)));
        }
        Expect(Worst < 1.0e-6, "Euler (Z, then Y, then X) → quaternion → Euler: worst " + Figure("%.1e", Worst) + "°");
    }

    // ⑦ the level bridge: a Geometry record with Physics on falls onto a pedestal record, then goes back
    {
        WorldSpace        World;
        const RecordToken Crate    = World.ConstructRecord("Geometry", "Crate");
        const RecordToken Pedestal = World.ConstructRecord("Geometry", "Pedestal");
        const RecordToken Cones    = World.ConstructRecord("Geometry", "Cones");
        if (auto* ConeRecord = dynamic_cast<GeometryRecord*>(World.FindRecord(Cones)))
        {
            GeometryConfiguration& Group = ConeRecord->AccessConfiguration();
            Group.Physics                = true;   // 📝 six copies share this one transform: the group is held
            Group.Resolved.Shown         = 6;
            Group.Resolved.Extent[0] = Group.Resolved.Extent[1] = Group.Resolved.Extent[2] = 0.5f;
            Group.Resolved.BoundsMinimum[0] = 4.0f, Group.Resolved.BoundsMaximum[0] = 9.0f;
            Group.Resolved.BoundsMinimum[1] = -0.25f, Group.Resolved.BoundsMaximum[1] = 0.25f;
            Group.Resolved.BoundsMinimum[2] = 0.0f, Group.Resolved.BoundsMaximum[2] = 0.5f;
        }
        auto*             CrateRecord    = dynamic_cast<GeometryRecord*>(World.FindRecord(Crate));
        auto*             PedestalRecord = dynamic_cast<GeometryRecord*>(World.FindRecord(Pedestal));
        if (CrateRecord && PedestalRecord)
        {
            GeometryConfiguration& Box = CrateRecord->AccessConfiguration();
            Box.Physics                = true;
            Box.Spatial.PositionMetres[0] = 0.2f, Box.Spatial.PositionMetres[1] = 0.0f, Box.Spatial.PositionMetres[2] = 5.0f;
            Box.Resolved.Extent[0] = Box.Resolved.Extent[1] = Box.Resolved.Extent[2] = 1.0f;
            Box.Resolved.Shown = 1;
            for (int Axis = 0; Axis < 3; ++Axis)
            {
                Box.Resolved.BoundsMinimum[Axis] = Box.Spatial.PositionMetres[Axis] - 0.5f;
                Box.Resolved.BoundsMaximum[Axis] = Box.Spatial.PositionMetres[Axis] + 0.5f;
            }
            GeometryConfiguration& Stand = PedestalRecord->AccessConfiguration();
            Stand.Resolved.Shown         = 1;
            Stand.Resolved.BoundsMinimum[0] = -1.0f, Stand.Resolved.BoundsMinimum[1] = -1.0f, Stand.Resolved.BoundsMinimum[2] = 0.0f;
            Stand.Resolved.BoundsMaximum[0] = 1.0f, Stand.Resolved.BoundsMaximum[1] = 1.0f, Stand.Resolved.BoundsMaximum[2] = 2.0f;
            PhysicsExtension Bridge;
            const size_t     MovingBodies = Bridge.Begin(World);
            for (int Step = 0; Step < 4 * 60; ++Step) (void)Bridge.Step(World, 1.0 / 60.0);
            const float Rested = Box.Spatial.PositionMetres[2];
            Expect(MovingBodies == 1 && Bridge.QueryTally().Fixed == 2, "the bridge makes 1 moving body and 2 colliders (ground, pedestal)");
            Expect(Bridge.QueryTally().Held == 1, "a record with six copies is held, not turned into one body for all of them");
            Expect(std::abs(Rested - 2.5f) < 0.03f, "the crate record lands on the pedestal record: origin at " + Figure("%.3f", Rested) + " m (2.5 expected)");
            Bridge.End(World);
            Expect(Box.Spatial.PositionMetres[2] == 5.0f && Box.Spatial.PositionMetres[0] == 0.2f && !Box.Dynamic, "stopping puts the crate back at 5 m");
        }
        else Expect(false, "Geometry records construct");
    }

    // ⑧ 1000 boxes falling onto the ground: the cost of a step
    double StepMilliseconds = 0.0;
    {
        PhysicsSpace Space;
        (void)Space.AddBody(GroundSlab());
        for (int Index = 0; Index < 1000; ++Index) (void)Space.AddBody(Cube(0.25, { 0.6 * (Index % 10), 0.6 * ((Index / 10) % 10), 1.0 + 0.6 * (Index / 100) }));
        Space.Prepare();
        const auto Start = std::chrono::steady_clock::now();
        Run(Space, 2.0);
        StepMilliseconds = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - Start).count() / 120.0;
        Expect(StepMilliseconds > 0.0, "1000 falling boxes: " + Figure("%.2f", StepMilliseconds) + " ms per 1/60 s step on " + std::to_string(Space.QueryWorkers()) +
                                           " workers (this sandbox, Debug build of the extension)");
    }

    // ⑨ the capture
    const std::filesystem::path Image = Exhibit / "Images" / "PhysicsSpaceFalling.png";
    Expect(WriteCapture(Image, Fonts), "capture written: " + Image.filename().string());

    std::printf("%s %d / %d assertions\n", Failures == 0 ? "🟢" : "🔴", Assertions - Failures, Assertions);
    std::filesystem::create_directories(Exhibit / "Results");
    std::ofstream Out(Exhibit / "Results" / "PhysicsSpaceValidation.md");
    Out << "# PhysicsSpaceValidation\n\nJoltPhysics 5.6.0 behind `Frontier/Extensions/Physics` (cross-platform deterministic, SSE4.2).\n\n| Result | Claim |\n|---|---|\n";
    for (const std::string& Line : Ledger) Out << Line << '\n';
    Out << "\n" << Assertions - Failures << " / " << Assertions << " assertions.\n";
    return Failures == 0 ? 0 : 1;
}
