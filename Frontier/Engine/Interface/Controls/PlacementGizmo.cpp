/*==========================================================================================================================================
                                                          PLACEMENTGIZMO.CPP
==========================================================================================================================================*/
// 🧩 The transform handles: GizmoSpace's handles (SolidArc's gizmo: cones and plane quads to move, arcs to rotate, cylinders and
//    the centre ring to scale), a constant size on screen whatever the distance, drawn by GizmoRasterization; and their drags.

#include "Engine/Interface/Controls/PlacementGizmo.h"

#include "Frontier/Extensions/Interface/GizmoRasterization.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

namespace Frontier
{

namespace
{

using Vector = std::array<double, 3>;

constexpr double Pi              = 3.14159265358979323846;
constexpr double DegreesPerRadian = 180.0 / Pi;
constexpr float  HandlePixels    = 120.0f;  // [px] the gizmo's unit length L on screen (SolidArc: 150 px)
constexpr float  PickPixels      = 8.0f;    // [px] how near the pointer must be

Vector Add(const Vector& Left, const Vector& Right) { return {Left[0] + Right[0], Left[1] + Right[1], Left[2] + Right[2]}; }
Vector Subtract(const Vector& Left, const Vector& Right) { return {Left[0] - Right[0], Left[1] - Right[1], Left[2] - Right[2]}; }
Vector Multiply(const Vector& Value, double Factor) { return {Value[0] * Factor, Value[1] * Factor, Value[2] * Factor}; }
double Dot(const Vector& Left, const Vector& Right) { return Left[0] * Right[0] + Left[1] * Right[1] + Left[2] * Right[2]; }
Vector Cross(const Vector& Left, const Vector& Right)
{
    return {Left[1] * Right[2] - Left[2] * Right[1], Left[2] * Right[0] - Left[0] * Right[2], Left[0] * Right[1] - Left[1] * Right[0]};
}
Vector Normalize(const Vector& Value)
{
    const double Length = std::sqrt(Dot(Value, Value));
    return Length > 1.0e-12 ? Multiply(Value, 1.0 / Length) : Vector{0.0, 0.0, 1.0};
}

// 📝 The rotation of ConstructPlacement, R = Rz(γ) · Ry(β) · Rx(α), as three columns (the object's axes).
std::array<Vector, 3> ResolveObjectAxes(const SpatialConfiguration& Spatial)
{
    const double α = Spatial.OrientationDegrees[0] / DegreesPerRadian, β = Spatial.OrientationDegrees[1] / DegreesPerRadian,
                 γ = Spatial.OrientationDegrees[2] / DegreesPerRadian;
    const double Cα = std::cos(α), Sα = std::sin(α), Cβ = std::cos(β), Sβ = std::sin(β), Cγ = std::cos(γ), Sγ = std::sin(γ);
    return {Vector{Cβ * Cγ, Cβ * Sγ, -Sβ}, Vector{Cγ * Sα * Sβ - Cα * Sγ, Cα * Cγ + Sα * Sβ * Sγ, Cβ * Sα},
            Vector{Cα * Cγ * Sβ + Sα * Sγ, Cα * Sβ * Sγ - Cγ * Sα, Cα * Cβ}};
}

// 📝 The axes each Euler angle turns about: α about Rz(γ)·Ry(β)·X, β about Rz(γ)·Y, γ about Z.
std::array<Vector, 3> ResolveEulerAxes(const SpatialConfiguration& Spatial)
{
    const double β = Spatial.OrientationDegrees[1] / DegreesPerRadian, γ = Spatial.OrientationDegrees[2] / DegreesPerRadian;
    const double Cβ = std::cos(β), Sβ = std::sin(β), Cγ = std::cos(γ), Sγ = std::sin(γ);
    return {Vector{Cβ * Cγ, Cβ * Sγ, -Sβ}, Vector{-Sγ, Cγ, 0.0}, Vector{0.0, 0.0, 1.0}};
}

std::array<Vector, 3> ResolveHandleAxes(PlacementGizmoMode Mode, const SpatialConfiguration& Spatial)
{
    if (Mode == PlacementGizmoMode::Scale) return ResolveObjectAxes(Spatial);
    if (Mode == PlacementGizmoMode::Rotate) return ResolveEulerAxes(Spatial);
    return {Vector{1.0, 0.0, 0.0}, Vector{0.0, 1.0, 0.0}, Vector{0.0, 0.0, 1.0}};
}

// 📝 Handle codes: 0–2 the axes (move along, rotate about, scale along), 3 Scale's uniform centre ring, 4–6 the plane quads
//    (normal X, Y, Z), 7 Move's centre ring (the screen plane).
constexpr int UniformHandle = 3;
constexpr int PlaneHandle   = 4;
constexpr int ScreenHandle  = 7;

int ResolveHandleCode(GizmoHandle Handle, PlacementGizmoMode Mode) noexcept
{
    const int Code = static_cast<int>(Handle);
    if (Handle == GizmoHandle::None) return -1;
    if (Handle == GizmoHandle::Centre) return Mode == PlacementGizmoMode::Scale ? UniformHandle : Mode == PlacementGizmoMode::Move ? ScreenHandle : -1;
    if (Handle >= GizmoHandle::PlaneYZ && Handle <= GizmoHandle::PlaneXY) return PlaneHandle + Code - static_cast<int>(GizmoHandle::PlaneYZ);
    return GizmoHandleAxis(Handle);
}

GizmoHandle ResolveGizmoHandle(int Code, PlacementGizmoMode Mode) noexcept
{
    if (Code < 0) return GizmoHandle::None;
    if (Code == UniformHandle || Code == ScreenHandle) return GizmoHandle::Centre;
    if (Code >= PlaneHandle) return static_cast<GizmoHandle>(static_cast<int>(GizmoHandle::PlaneYZ) + Code - PlaneHandle);
    const GizmoHandle First = Mode == PlacementGizmoMode::Move ? GizmoHandle::TranslateX : Mode == PlacementGizmoMode::Rotate ? GizmoHandle::RotateX
                                                                                                                              : GizmoHandle::ScaleX;
    return static_cast<GizmoHandle>(static_cast<int>(First) + Code);
}

OrbitCameraFrame ResolveCamera(const PlacementView& View)
{
    return ResolveGizmoCamera(View.Eye, View.Forward, View.Up, View.VerticalFieldOfView, View.StageExtent.x, View.StageExtent.y);
}

// 📝 GizmoSpace's pose: the handle axes as a right-handed unit frame (Rotate's Euler axes are orthogonal only while β = 0:
//    the frame keeps the γ axis and the turned Y, so each arc sits about the axis it turns), a constant HandlePixels on screen.
GizmoPose ResolvePose(const OrbitCameraFrame& Camera, PlacementGizmoMode Mode, const SpatialConfiguration& Spatial, float Scale)
{
    std::array<Vector, 3> Axes = ResolveHandleAxes(Mode, Spatial);
    if (Mode == PlacementGizmoMode::Rotate) Axes[0] = Normalize(Cross(Axes[1], Axes[2]));
    GizmoPose Pose;
    Pose.Origin = {Spatial.PositionMetres[0], Spatial.PositionMetres[1], Spatial.PositionMetres[2]};
    for (size_t Axis = 0; Axis < 3; ++Axis) Pose.Axes[Axis] = {Axes[Axis][0], Axes[Axis][1], Axes[Axis][2]};
    Pose.Size   = MeasureGizmoSize(Camera, Pose.Origin, HandlePixels * Scale);
    Pose.Modes  = Mode == PlacementGizmoMode::Move ? GizmoTranslate : Mode == PlacementGizmoMode::Rotate ? GizmoRotate : GizmoScale;
    Pose.Hidden = Mode == PlacementGizmoMode::Rotate ? 1u << static_cast<uint32_t>(GizmoHandle::Centre) : 0u;
    return Pose;
}

// 📝 Where the pointer's ray meets the plane through Centre with Normal; false when it runs along the plane or away from it.
bool ResolvePlaneHit(const PlacementView& View, ImVec2 Pointer, const Vector& Centre, const Vector& Normal, Vector& OutHit)
{
    Vector Origin{}, Direction{};
    View.ResolveRay(Pointer, Origin, Direction);
    const OrbitRay Ray{Origin, Direction};
    const auto     Hit = IntersectGizmoPlane(Ray, {Centre[0], Centre[1], Centre[2]}, {Normal[0], Normal[1], Normal[2]});
    if (!Hit) return false;
    OutHit = {Hit->X, Hit->Y, Hit->Z};
    return true;
}

// 📝 The parameter along the line Centre + s·Axis nearest the ray (Origin, Direction); false when they run parallel.
bool ResolveAxisParameter(const Vector& Centre, const Vector& Axis, const Vector& Origin, const Vector& Direction, double& OutParameter)
{
    const Vector Offset = Subtract(Centre, Origin);
    const double Facing = Dot(Axis, Direction);
    const double Denominator = 1.0 - Facing * Facing;
    if (Denominator < 1.0e-5) return false;
    OutParameter = (Facing * Dot(Direction, Offset) - Dot(Axis, Offset)) / Denominator;
    return true;
}

double WrapDegrees(double Degrees)
{
    Degrees = std::fmod(Degrees + 180.0, 360.0);
    if (Degrees < 0.0) Degrees += 360.0;
    return Degrees - 180.0;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    VIEW
//------------------------------------------------------------------------------------------------------------------------

PlacementView PlacementView::Resolve(const std::array<double, 3>& Eye, const std::array<double, 3>& Forward, const std::array<double, 3>& Up,
                                     double VerticalFieldOfView, ImVec2 StageMin, ImVec2 StageExtent) noexcept
{
    PlacementView View;
    View.Eye                 = Eye;
    View.Forward             = Normalize(Forward);
    View.Right               = Normalize(Cross(View.Forward, Up));
    View.Up                  = Cross(View.Right, View.Forward);
    View.VerticalFieldOfView = VerticalFieldOfView;
    View.StageMin            = StageMin;
    View.StageExtent         = StageExtent;
    return View;
}

bool PlacementView::Project(const std::array<double, 3>& World, ImVec2& OutScreen) const noexcept
{
    const Vector Offset = Subtract(World, Eye);
    const double Depth  = Dot(Offset, Forward);
    if (Depth < 0.05) return false;
    const double Tangent = std::tan(0.5 * VerticalFieldOfView);
    const double Aspect  = StageExtent.y > 0.0f ? static_cast<double>(StageExtent.x) / StageExtent.y : 1.0;
    const double Across  = Dot(Offset, Right) / (Depth * Tangent * Aspect);
    const double Upward  = Dot(Offset, Up) / (Depth * Tangent);
    OutScreen = ImVec2(StageMin.x + static_cast<float>((Across + 1.0) * 0.5) * StageExtent.x,
                       StageMin.y + static_cast<float>((1.0 - Upward) * 0.5) * StageExtent.y);
    return true;
}

void PlacementView::ResolveRay(ImVec2 Screen, std::array<double, 3>& OutOrigin, std::array<double, 3>& OutDirection) const noexcept
{
    const double Tangent = std::tan(0.5 * VerticalFieldOfView);
    const double Aspect  = StageExtent.y > 0.0f ? static_cast<double>(StageExtent.x) / StageExtent.y : 1.0;
    const double Across  = 2.0 * (Screen.x - StageMin.x) / std::max(1.0f, StageExtent.x) - 1.0;
    const double Upward  = 1.0 - 2.0 * (Screen.y - StageMin.y) / std::max(1.0f, StageExtent.y);
    OutOrigin            = Eye;
    OutDirection         = Normalize(Add(Forward, Add(Multiply(Right, Across * Tangent * Aspect), Multiply(Up, Upward * Tangent))));
}

double PlacementView::ResolvePixelMetres(const std::array<double, 3>& World) const noexcept
{
    const double Depth = std::max(0.05, Dot(Subtract(World, Eye), Forward));
    return 2.0 * Depth * std::tan(0.5 * VerticalFieldOfView) / std::max(1.0f, StageExtent.y);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    HANDLES
//------------------------------------------------------------------------------------------------------------------------

int PlacementGizmo::Probe(const PlacementView& View, PlacementGizmoMode Mode, const SpatialConfiguration& Spatial, ImVec2 Pointer, float Scale) const
{
    ImVec2 CentreScreen;
    if (!View.Project({Spatial.PositionMetres[0], Spatial.PositionMetres[1], Spatial.PositionMetres[2]}, CentreScreen)) return -1;
    const OrbitCameraFrame Camera   = ResolveCamera(View);
    const GizmoGeometry    Geometry = BuildGizmoGeometry(ResolvePose(Camera, Mode, Spatial, Scale), Camera, GizmoHandle::None, GizmoHandle::None);
    const GizmoHandle      Handle   = PickGizmoHandle(Geometry, Camera, Pointer.x - View.StageMin.x, Pointer.y - View.StageMin.y, PickPixels * Scale);
    return ResolveHandleCode(Handle, Mode);
}

PlacementGizmoOutcome PlacementGizmo::Construct(ImDrawList* DrawList, const PlacementView& View, PlacementGizmoMode Mode, SpatialConfiguration& Spatial,
                                                bool Snap, bool PressAllowed, float Scale)
{
    PlacementGizmoOutcome Outcome;
    const ImVec2          Pointer = ImGui::GetIO().MousePos;
    if (Handle_ >= 0 && Mode_ != Mode) Cancel(Spatial);

    // ① press and release
    const int Hover = Handle_ >= 0 ? Handle_ : Probe(View, Mode, Spatial, Pointer, Scale);
    Outcome.Hovered = Hover >= 0;
    const Vector StartCentre = {Start_.PositionMetres[0], Start_.PositionMetres[1], Start_.PositionMetres[2]};
    if (Handle_ < 0 && Hover >= 0 && PressAllowed && ImGui::IsMouseClicked(ImGuiMouseButton_Left))
    {
        Handle_       = Hover;
        Mode_         = Mode;
        Start_        = Spatial;
        PressPointer_ = Pointer;
        Swept_        = 0.0;
        const Vector Centre = {Spatial.PositionMetres[0], Spatial.PositionMetres[1], Spatial.PositionMetres[2]};
        ImVec2       CentreScreen;
        (void)View.Project(Centre, CentreScreen);
        if (Mode == PlacementGizmoMode::Move && Handle_ >= PlaneHandle)
        {
            const Vector Normal = Handle_ == ScreenHandle ? View.Forward : ResolveHandleAxes(Mode, Spatial)[static_cast<size_t>(Handle_ - PlaneHandle)];
            if (!ResolvePlaneHit(View, Pointer, Centre, Normal, PressHit_)) PressHit_ = Centre;
        }
        else if (Mode == PlacementGizmoMode::Move)
        {
            Vector Origin{}, Direction{};
            View.ResolveRay(Pointer, Origin, Direction);
            if (!ResolveAxisParameter(Centre, ResolveHandleAxes(Mode, Spatial)[static_cast<size_t>(Handle_)], Origin, Direction, PressParameter_))
                PressParameter_ = 0.0;
        }
        else if (Mode == PlacementGizmoMode::Rotate)
        {
            LastAngle_ = std::atan2(-(Pointer.y - CentreScreen.y), Pointer.x - CentreScreen.x);
        }
        else if (Handle_ < UniformHandle)
        {
            const Vector Axis = ResolveHandleAxes(Mode, Spatial)[static_cast<size_t>(Handle_)];
            ImVec2       Tip;
            const double Length = HandlePixels * Scale * View.ResolvePixelMetres(Centre);
            (void)View.Project(Add(Centre, Multiply(Axis, Length)), Tip);
            const float Dx = Tip.x - CentreScreen.x, Dy = Tip.y - CentreScreen.y;
            const float Span = std::max(1.0f, std::sqrt(Dx * Dx + Dy * Dy));
            PressParameter_ = ((Pointer.x - CentreScreen.x) * Dx + (Pointer.y - CentreScreen.y) * Dy) / Span;
        }
    }
    else if (Handle_ >= 0 && !ImGui::IsMouseDown(ImGuiMouseButton_Left))
    {
        Handle_           = -1;
        Outcome.Finished  = true;
    }

    // ② the drag
    char Readout[64] = {};
    if (Handle_ >= 0)
    {
        Outcome.Engaged = true;
        const size_t Axis = static_cast<size_t>(std::min(Handle_, 2));
        SpatialConfiguration Next = Start_;
        if (Mode == PlacementGizmoMode::Move && Handle_ >= PlaneHandle)
        {
            const Vector Normal = Handle_ == ScreenHandle ? View.Forward : ResolveHandleAxes(Mode, Start_)[static_cast<size_t>(Handle_ - PlaneHandle)];
            Vector       Hit{};
            if (ResolvePlaneHit(View, Pointer, StartCentre, Normal, Hit))
            {
                Vector Travel = Subtract(Hit, PressHit_);
                if (Snap)
                    for (double& Component : Travel) Component = std::round(Component / 0.25) * 0.25;
                for (size_t Component = 0; Component < 3; ++Component)
                    Next.PositionMetres[Component] = static_cast<float>(Start_.PositionMetres[Component] + Travel[Component]);
                if (Handle_ == ScreenHandle)
                    std::snprintf(Readout, sizeof(Readout), "%+.2f %+.2f %+.2f m", Travel[0], Travel[1], Travel[2]);
                else
                {
                    const size_t First = Handle_ == PlaneHandle ? 1 : 0, Second = Handle_ == PlaneHandle + 2 ? 1 : 2;
                    std::snprintf(Readout, sizeof(Readout), "%c%c %+.2f %+.2f m", "XYZ"[First], "XYZ"[Second], Travel[First], Travel[Second]);
                }
            }
            else Next = Spatial;
        }
        else if (Mode == PlacementGizmoMode::Move)
        {
            const Vector Direction = ResolveHandleAxes(Mode, Start_)[Axis];
            Vector       Origin{}, Ray{};
            View.ResolveRay(Pointer, Origin, Ray);
            double Parameter = 0.0;
            if (ResolveAxisParameter(StartCentre, Direction, Origin, Ray, Parameter))
            {
                double Travel = Parameter - PressParameter_;
                if (Snap) Travel = std::round(Travel / 0.25) * 0.25;
                for (size_t Component = 0; Component < 3; ++Component)
                    Next.PositionMetres[Component] = static_cast<float>(Start_.PositionMetres[Component] + Direction[Component] * Travel);
                std::snprintf(Readout, sizeof(Readout), "%c %+.2f m", "XYZ"[Axis], Travel);
            }
            else Next = Spatial;
        }
        else if (Mode == PlacementGizmoMode::Rotate)
        {
            ImVec2 CentreScreen;
            (void)View.Project(StartCentre, CentreScreen);
            const double Angle = std::atan2(-(Pointer.y - CentreScreen.y), Pointer.x - CentreScreen.x);
            Swept_ += std::remainder(Angle - LastAngle_, 2.0 * Pi);
            LastAngle_ = Angle;
            const Vector Turning = ResolveHandleAxes(Mode, Start_)[Axis];
            const double Facing  = Dot(Turning, Subtract(View.Eye, StartCentre)) >= 0.0 ? 1.0 : -1.0;
            double       Degrees = Swept_ * Facing * DegreesPerRadian;
            if (Snap) Degrees = std::round(Degrees / 15.0) * 15.0;
            Next.OrientationDegrees[Axis] = static_cast<float>(WrapDegrees(Start_.OrientationDegrees[Axis] + Degrees));
            std::snprintf(Readout, sizeof(Readout), "%c %+.1f\xC2\xB0", "XYZ"[Axis], Degrees);
        }
        else
        {
            if (Handle_ == UniformHandle)
            {
                double Factor = std::max(0.01, 1.0 + ((Pointer.x - PressPointer_.x) - (Pointer.y - PressPointer_.y)) / (150.0 * Scale));
                for (size_t Component = 0; Component < 3; ++Component)
                {
                    double Value = Start_.Scale[Component] * Factor;
                    if (Snap) Value = std::max(0.1, std::round(Value / 0.1) * 0.1);
                    Next.Scale[Component] = static_cast<float>(Value);
                }
                std::snprintf(Readout, sizeof(Readout), "\xC3\x97 %.2f", Factor);
            }
            else
            {
                ImVec2 CentreScreen, Tip;
                (void)View.Project(StartCentre, CentreScreen);
                const double Length = HandlePixels * Scale * View.ResolvePixelMetres(StartCentre);
                (void)View.Project(Add(StartCentre, Multiply(ResolveHandleAxes(Mode, Start_)[Axis], Length)), Tip);
                const float  Dx = Tip.x - CentreScreen.x, Dy = Tip.y - CentreScreen.y;
                const float  Span   = std::max(1.0f, std::sqrt(Dx * Dx + Dy * Dy));
                const double Along  = ((Pointer.x - CentreScreen.x) * Dx + (Pointer.y - CentreScreen.y) * Dy) / Span;
                const double Factor = std::max(0.01, 1.0 + (Along - PressParameter_) / Span);
                double       Value  = Start_.Scale[Axis] * Factor;
                if (Snap) Value = std::max(0.1, std::round(Value / 0.1) * 0.1);
                Next.Scale[Axis] = static_cast<float>(Value);
                std::snprintf(Readout, sizeof(Readout), "%c \xC3\x97 %.2f", "XYZ"[Axis], Value);
            }
        }
        for (size_t Component = 0; Component < 3; ++Component)
        {
            Outcome.Changed = Outcome.Changed || Next.PositionMetres[Component] != Spatial.PositionMetres[Component] ||
                              Next.OrientationDegrees[Component] != Spatial.OrientationDegrees[Component] ||
                              Next.Scale[Component] != Spatial.Scale[Component];
            Spatial.PositionMetres[Component]     = Next.PositionMetres[Component];
            Spatial.OrientationDegrees[Component] = Next.OrientationDegrees[Component];
            Spatial.Scale[Component]              = Next.Scale[Component];
        }
    }

    // ③ the handles (GizmoSpace, SolidArc's look), a constant HandlePixels on screen
    if (DrawList == nullptr) return Outcome;
    ImVec2 CentreScreen;
    if (!View.Project({Spatial.PositionMetres[0], Spatial.PositionMetres[1], Spatial.PositionMetres[2]}, CentreScreen)) return Outcome;
    const OrbitCameraFrame Camera  = ResolveCamera(View);
    const GizmoHandle      Lit     = ResolveGizmoHandle(Hover, Mode);
    const GizmoHandle      Grabbed = ResolveGizmoHandle(Handle_, Mode);
    RasterizeGizmo(DrawList, BuildGizmoGeometry(ResolvePose(Camera, Mode, Spatial, Scale), Camera, Lit, Grabbed), Camera, View.StageMin);
    if (Readout[0] != '\0')
    {
        const ImVec2 Text(Pointer.x + 16.0f * Scale, Pointer.y + 10.0f * Scale);
        const ImVec2 Size = ImGui::CalcTextSize(Readout);
        DrawList->AddRectFilled(ImVec2(Text.x - 6.0f * Scale, Text.y - 3.0f * Scale), ImVec2(Text.x + Size.x + 6.0f * Scale, Text.y + Size.y + 3.0f * Scale),
                                IM_COL32(18, 18, 18, 220), 6.0f * Scale);
        DrawList->AddText(Text, IM_COL32(240, 240, 240, 255), Readout);
    }
    return Outcome;
}

void PlacementGizmo::Cancel(SpatialConfiguration& Spatial) noexcept
{
    if (Handle_ < 0) return;
    for (size_t Component = 0; Component < 3; ++Component)
    {
        Spatial.PositionMetres[Component]     = Start_.PositionMetres[Component];
        Spatial.OrientationDegrees[Component] = Start_.OrientationDegrees[Component];
        Spatial.Scale[Component]              = Start_.Scale[Component];
    }
    Handle_ = -1;
}

} // namespace Frontier
