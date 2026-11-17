/*==========================================================================================================================================
                                                           PLACEMENTGIZMO.H
==========================================================================================================================================*/
// 🧩 The viewport's transform handles for the selected object (W move, E rotate, R scale): GizmoSpace's handles (SolidArc's
//    gizmo) drawn over the presented image with the camera it was rendered with, and dragged with the left button. Move
//    follows the world axes, their planes or the screen, Rotate the object's Euler angles (OrientationDegrees: Z, then Y,
//    then X) and Scale the object's own axes or all three at once.

#pragma once

#include "Engine/Scene/EngineConfigurations.h"
#include "Frontier/Engine/Scene/Profiles/ProfileConcepts.h"

#include <imgui.h>

#include <array>
#include <cstdint>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    TYPES
//------------------------------------------------------------------------------------------------------------------------

enum class PlacementGizmoMode : uint32_t
{
    Move,
    Rotate,
    Scale,
};

// 📝 The viewport camera the image was rendered with (z up, metres) and where the image sits on screen.
struct PlacementView
{
    std::array<double, 3> Eye{};
    std::array<double, 3> Forward{1.0, 0.0, 0.0};
    std::array<double, 3> Right{0.0, -1.0, 0.0};
    std::array<double, 3> Up{0.0, 0.0, 1.0};
    double                VerticalFieldOfView = 1.0471975511965976;   // [rad]
    ImVec2                StageMin{};                                 // [px]
    ImVec2                StageExtent{};                              // [px]

    // 📝 The camera from its position, forward and up (right = forward × up, then up = right × forward).
    static PlacementView Resolve(const std::array<double, 3>& Eye, const std::array<double, 3>& Forward, const std::array<double, 3>& Up,
                                 double VerticalFieldOfView, ImVec2 StageMin, ImVec2 StageExtent) noexcept;
    // 📝 The screen point of a world point; false behind the camera.
    [[nodiscard]] bool   Project(const std::array<double, 3>& World, ImVec2& OutScreen) const noexcept;
    // 📝 The world ray through a screen point (unit direction).
    void                 ResolveRay(ImVec2 Screen, std::array<double, 3>& OutOrigin, std::array<double, 3>& OutDirection) const noexcept;
    // 📝 Metres per screen pixel at a world point's depth.
    [[nodiscard]] double ResolvePixelMetres(const std::array<double, 3>& World) const noexcept;
};

struct PlacementGizmoOutcome
{
    bool Hovered  = false;   // [-] the pointer is over a handle
    bool Engaged  = false;   // [-] a handle is held
    bool Changed  = false;   // [-] the transform changed this tick
    bool Finished = false;   // [-] a drag ended this tick
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    PLACEMENT GIZMO
//------------------------------------------------------------------------------------------------------------------------

class PlacementGizmo
{
  public:
    // 📝 The handle under a screen point: 0–2 the axes (X, Y, Z), 3 Scale's uniform ring, 4–6 Move's plane quads (normal X, Y,
    //    Z), 7 Move's centre ring (the screen plane), −1 none.
    [[nodiscard]] int Probe(const PlacementView& View, PlacementGizmoMode Mode, const SpatialConfiguration& Spatial, ImVec2 Pointer,
                            float Scale) const;

    template <SpatialEditable EntryT>
    [[nodiscard]] int Probe(const PlacementView& View, PlacementGizmoMode Mode, const EntryT& Editable, ImVec2 Pointer, float Scale) const
    {
        const SpatialConfiguration Configuration = BridgeSpatial(Editable.Spatial);
        return Probe(View, Mode, Configuration, Pointer, Scale);
    }

    // 📝 Draws the handles and drags them: a left press on a handle (PressAllowed: the press began on the stage) holds it until
    //    the release. Snap (Ctrl) rounds to 0.25 m, 15° and 0.1.
    PlacementGizmoOutcome Construct(ImDrawList* DrawList, const PlacementView& View, PlacementGizmoMode Mode, SpatialConfiguration& Spatial,
                                    bool Snap, bool PressAllowed, float Scale);

    template <SpatialEditable EntryT>
    PlacementGizmoOutcome Construct(ImDrawList* DrawList, const PlacementView& View, PlacementGizmoMode Mode, EntryT& Editable,
                                    bool Snap, bool PressAllowed, float Scale)
    {
        SpatialConfiguration Configuration = BridgeSpatial(Editable.Spatial);
        const PlacementGizmoOutcome Outcome = Construct(DrawList, View, Mode, Configuration, Snap, PressAllowed, Scale);
        if (Outcome.Changed) ApplySpatial(Editable.Spatial, Configuration);
        return Outcome;
    }

    [[nodiscard]] bool QueryEngaged() const noexcept { return Handle_ >= 0; }

    // 📝 Ends a drag and puts the transform back where it began (Escape).
    void Cancel(SpatialConfiguration& Spatial) noexcept;

    template <SpatialEditable EntryT>
    void Cancel(EntryT& Editable) noexcept
    {
        if (!QueryEngaged()) return;
        SpatialConfiguration Configuration = BridgeSpatial(Editable.Spatial);
        Cancel(Configuration);
        ApplySpatial(Editable.Spatial, Configuration);
    }

  private:
    [[nodiscard]] static SpatialConfiguration BridgeSpatial(const SpatialProfile& Profile) noexcept
    {
        SpatialConfiguration Configuration;
        Configuration.ApplySpatialProfile(Profile);
        return Configuration;
    }

    static void ApplySpatial(SpatialProfile& Profile, const SpatialConfiguration& Configuration) noexcept
    {
        const uint64_t Revision = Profile.Revision;
        Profile = Configuration.ToSpatialProfile();
        Profile.Revision = Revision + 1u;
    }

    int                  Handle_ = -1;
    PlacementGizmoMode   Mode_   = PlacementGizmoMode::Move;
    SpatialConfiguration Start_{};
    ImVec2               PressPointer_{};
    double               PressParameter_ = 0.0;   // [m] along the axis (Move), [rad] about the centre (Rotate), [px] along the axis (Scale)
    std::array<double, 3> PressHit_{};            // [m] where the press met a plane handle's plane (plane and screen moves)
    double               Swept_          = 0.0;   // [rad] Rotate: the angle swept so far
    double               LastAngle_      = 0.0;   // [rad]
};

} // namespace Frontier
