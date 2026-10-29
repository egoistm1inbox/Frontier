//============================================================================================================================================
//                                                             DRIVECOURSE.H
//============================================================================================================================================
// 🧩 Project-Drive proving-ground geometry, 3D surface contact query, Jolt heightfield sampler, and course triangle collector.

#pragma once

#include "Engine/Physics/ProjectDrive/RigidWheel.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace Frontier::Drive
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    COURSE CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

struct CourseConstants
{
    static constexpr float PadHalfExtent   = 60.0f;    // [m]  - Half width/length of checker proving pad
    static constexpr float CheckerCell     = 4.0f;     // [m]  - Edge length of each checker tile
    static constexpr float RampNearX       = 9.0f;     // [m]  - Ramp toe coordinate along +X
    static constexpr float RampRunX        = 6.0f;     // [m]  - Horizontal length of launch ramp
    static constexpr float RampRise        = 1.35f;    // [m]  - Crest elevation of launch ramp
    static constexpr float RampHalfWidth   = 3.2f;     // [m]  - Lateral half width of launch ramp
    static constexpr int   BumpCount       = 3;        // [-]  - Rounded cosine speed bumps behind spawn
    static constexpr float BumpFirstX      = -7.0f;    // [m]  - First speed bump centre along -X
    static constexpr float BumpSpacingX    = -4.5f;    // [m]  - Longitudinal step between speed bumps
    static constexpr float BumpHeight      = 0.11f;    // [m]  - Crest height of each speed bump
    static constexpr float BumpHalfWidthY  = 4.0f;     // [m]  - Lateral half width of speed bumps
    static constexpr float BumpHalfLenX    = 0.55f;    // [m]  - Half chord length of each speed bump
    static constexpr int   ConeCount       = 8;        // [-]  - Slalom traffic cones downrange of ramp
    static constexpr float ConeRadius      = 0.22f;    // [m]  - Base radius of each slalom cone
    static constexpr float ConeHeight      = 0.55f;    // [m]  - Vertical height of each slalom cone
    static constexpr float ConeMassKg      = 4.5f;     // [kg] - Mass of each dynamic Jolt traffic cone
    static constexpr float BarrierCentreX  = 64.0f;    // [m]  - End-of-pad safety barrier wall X position
    static constexpr float BarrierHalfY    = 14.0f;    // [m]  - Safety barrier lateral half width
    static constexpr float BarrierHalfZ    = 1.10f;    // [m]  - Safety barrier vertical half height
};

struct KerbConstants
{
    static constexpr float CentreY = 3.20f;    // [m] - Inner vertical face along +Y side of pad
    static constexpr float Height  = 0.120f;   // [m] - Standard kerb upstand height
    static constexpr float Depth   = 0.300f;   // [m] - Lateral depth extending toward +Y
    static constexpr float NearX   = -14.0f;   // [m] - Start coordinate along X
    static constexpr float FarX    = 26.0f;    // [m] - End coordinate along X
};

enum CourseMaterial : uint32_t
{
    MatCheckerLight   = 0u,
    MatCheckerDark    = 1u,
    MatSurround       = 2u,
    MatRamp           = 3u,
    MatBump           = 4u,
    MatCone           = 5u,
    MatBodyPaint      = 6u,
    MatVehicleGlass   = 7u,
    MatVehiclePlastic = 8u,
    MatTyre           = 9u,
    MatHub            = 10u,
    MatBrake          = 11u,
    MatVehicleTrim    = 12u,
    MatHeadlight      = 13u,
    MatTaillight      = 14u,
    MatVehicleDefault = 15u,
    MatCount          = 16u,
    MatCabinTablet    = 16u,
    MatCabinCluster   = 17u,
    MatCabinLamp      = 18u,
    MatCabinBezel     = 19u,
    MatCabinCount     = 20u
};

//------------------------------------------------------------------------------------------------------------------------
//                                                 SURFACE CONTACT QUERIES
//------------------------------------------------------------------------------------------------------------------------

[[nodiscard]] inline bool WithinKerb(float PointX, float PointY) noexcept
{
    return PointX >= KerbConstants::NearX &&
           PointX <= KerbConstants::FarX &&
           PointY >= KerbConstants::CentreY &&
           PointY <= KerbConstants::CentreY + KerbConstants::Depth;
}

[[nodiscard]] inline float SampleCourseHeight(float PointX, float PointY) noexcept
{
    if (WithinKerb(PointX, PointY))
    {
        return KerbConstants::Height;
    }

    if (PointX >= CourseConstants::RampNearX &&
        PointX <= CourseConstants::RampNearX + CourseConstants::RampRunX &&
        std::fabs(PointY) <= CourseConstants::RampHalfWidth)
    {
        return CourseConstants::RampRise * (PointX - CourseConstants::RampNearX) / CourseConstants::RampRunX;
    }

    if (std::fabs(PointY) <= CourseConstants::BumpHalfWidthY)
    {
        float Elevation = 0.0f;
        for (int BumpIndex = 0; BumpIndex < CourseConstants::BumpCount; ++BumpIndex)
        {
            const float CentreX = CourseConstants::BumpFirstX + static_cast<float>(BumpIndex) * CourseConstants::BumpSpacingX;
            const float OffsetX = PointX - CentreX;
            if (std::fabs(OffsetX) < CourseConstants::BumpHalfLenX)
            {
                Elevation += CourseConstants::BumpHeight * 0.5f *
                             (1.0f + std::cos(3.14159265f * OffsetX / CourseConstants::BumpHalfLenX));
            }
        }
        return Elevation;
    }

    return 0.0f;
}

inline void SampleCourseNormal(float PointX, float PointY, float& OutNormalX, float& OutNormalY, float& OutNormalZ) noexcept
{
    constexpr float Step    = 0.15f;
    const float     SlopeX  = (SampleCourseHeight(PointX + Step, PointY) - SampleCourseHeight(PointX - Step, PointY)) / (2.0f * Step);
    const float     SlopeY  = (SampleCourseHeight(PointX, PointY + Step) - SampleCourseHeight(PointX, PointY - Step)) / (2.0f * Step);
    OutNormalX              = -SlopeX;
    OutNormalY              = -SlopeY;
    OutNormalZ              = 1.0f;
    const float NormalNorm  = std::sqrt(OutNormalX * OutNormalX + OutNormalY * OutNormalY + OutNormalZ * OutNormalZ);
    if (NormalNorm > 0.0f)
    {
        OutNormalX /= NormalNorm;
        OutNormalY /= NormalNorm;
        OutNormalZ /= NormalNorm;
    }
}

[[nodiscard]] inline Vehicle::Vec3 ProjectOntoCourseTriangle(
    const Vehicle::Vec3& Point,
    const Vehicle::Vec3& VertexAlpha,
    const Vehicle::Vec3& VertexBeta,
    const Vehicle::Vec3& VertexGamma) noexcept
{
    using Vehicle::Dot;

    const Vehicle::Vec3 EdgeAlphaBeta  = VertexBeta - VertexAlpha;
    const Vehicle::Vec3 EdgeAlphaGamma = VertexGamma - VertexAlpha;
    const Vehicle::Vec3 RelAlpha       = Point - VertexAlpha;

    const float Dot1 = Dot(EdgeAlphaBeta, RelAlpha);
    const float Dot2 = Dot(EdgeAlphaGamma, RelAlpha);
    if (Dot1 <= 0.0f && Dot2 <= 0.0f)
    {
        return VertexAlpha;
    }

    const Vehicle::Vec3 RelBeta = Point - VertexBeta;
    const float         Dot3    = Dot(EdgeAlphaBeta, RelBeta);
    const float         Dot4    = Dot(EdgeAlphaGamma, RelBeta);
    if (Dot3 >= 0.0f && Dot4 <= Dot3)
    {
        return VertexBeta;
    }

    const float BaryGamma = Dot1 * Dot4 - Dot3 * Dot2;
    if (BaryGamma <= 0.0f && Dot1 >= 0.0f && Dot3 <= 0.0f)
    {
        return VertexAlpha + EdgeAlphaBeta * (Dot1 / (Dot1 - Dot3));
    }

    const Vehicle::Vec3 RelGamma = Point - VertexGamma;
    const float         Dot5     = Dot(EdgeAlphaBeta, RelGamma);
    const float         Dot6     = Dot(EdgeAlphaGamma, RelGamma);
    if (Dot6 >= 0.0f && Dot5 <= Dot6)
    {
        return VertexGamma;
    }

    const float BaryBeta = Dot5 * Dot2 - Dot1 * Dot6;
    if (BaryBeta <= 0.0f && Dot2 >= 0.0f && Dot6 <= 0.0f)
    {
        return VertexAlpha + EdgeAlphaGamma * (Dot2 / (Dot2 - Dot6));
    }

    const float BaryAlpha = Dot3 * Dot6 - Dot5 * Dot4;
    if (BaryAlpha <= 0.0f && (Dot4 - Dot3) >= 0.0f && (Dot5 - Dot6) >= 0.0f)
    {
        return VertexBeta + (VertexGamma - VertexBeta) * ((Dot4 - Dot3) / ((Dot4 - Dot3) + (Dot5 - Dot6)));
    }

    const float Reciprocal = 1.0f / (BaryAlpha + BaryBeta + BaryGamma);
    return VertexAlpha + EdgeAlphaBeta * (BaryBeta * Reciprocal) + EdgeAlphaGamma * (BaryGamma * Reciprocal);
}

inline void SampleCourseSurface(
    float  PointX,
    float  PointY,
    float  PointZ,
    float& OutX,
    float& OutY,
    float& OutZ,
    float& OutNormalX,
    float& OutNormalY,
    float& OutNormalZ) noexcept
{
    const bool OnRamp = PointX >= CourseConstants::RampNearX &&
                        PointX <= CourseConstants::RampNearX + CourseConstants::RampRunX &&
                        std::fabs(PointY) <= CourseConstants::RampHalfWidth;
    const float BaseHeight = (WithinKerb(PointX, PointY) || OnRamp) ? 0.0f : SampleCourseHeight(PointX, PointY);

    const float KerbTop = KerbConstants::Height;
    const bool  InsideKerb =
        WithinKerb(PointX, PointY) && PointZ >= 0.0f && PointZ < KerbTop;

    if (InsideKerb)
    {
        const float FaceDistances[5] = {
            PointX - KerbConstants::NearX,
            KerbConstants::FarX - PointX,
            PointY - KerbConstants::CentreY,
            KerbConstants::CentreY + KerbConstants::Depth - PointY,
            KerbTop - PointZ,
        };
        uint32_t NearestFace = 0u;
        for (uint32_t Index = 1u; Index < 5u; ++Index)
        {
            if (FaceDistances[Index] < FaceDistances[NearestFace])
            {
                NearestFace = Index;
            }
        }
        OutX       = PointX;
        OutY       = PointY;
        OutZ       = PointZ;
        OutNormalX = 0.0f;
        OutNormalY = 0.0f;
        OutNormalZ = 0.0f;
        if (NearestFace == 0u) { OutX = KerbConstants::NearX; OutNormalX = -1.0f; }
        if (NearestFace == 1u) { OutX = KerbConstants::FarX; OutNormalX = 1.0f; }
        if (NearestFace == 2u) { OutY = KerbConstants::CentreY; OutNormalY = -1.0f; }
        if (NearestFace == 3u) { OutY = KerbConstants::CentreY + KerbConstants::Depth; OutNormalY = 1.0f; }
        if (NearestFace == 4u) { OutZ = KerbTop; OutNormalZ = 1.0f; }
        return;
    }

    const float ClosestX = std::clamp(PointX, KerbConstants::NearX, KerbConstants::FarX);
    const float ClosestY = std::clamp(PointY, KerbConstants::CentreY, KerbConstants::CentreY + KerbConstants::Depth);
    const float ClosestZ = std::clamp(PointZ, 0.0f, KerbTop);
    const float DeltaX   = PointX - ClosestX;
    const float DeltaY   = PointY - ClosestY;
    const float DeltaZ   = PointZ - ClosestZ;
    const float Distance = std::sqrt(DeltaX * DeltaX + DeltaY * DeltaY + DeltaZ * DeltaZ);
    if (Distance > 1.0e-7f && Distance < (PointZ - BaseHeight))
    {
        OutX       = ClosestX;
        OutY       = ClosestY;
        OutZ       = ClosestZ;
        OutNormalX = DeltaX / Distance;
        OutNormalY = DeltaY / Distance;
        OutNormalZ = DeltaZ / Distance;
        return;
    }

    OutX       = PointX;
    OutY       = PointY;
    OutZ       = BaseHeight;
    OutNormalX = 0.0f;
    OutNormalY = 0.0f;
    OutNormalZ = 1.0f;
    if (PointX < 0.0f && std::fabs(PointY) <= CourseConstants::BumpHalfWidthY)
    {
        SampleCourseNormal(PointX, PointY, OutNormalX, OutNormalY, OutNormalZ);
    }

    using Vehicle::Dot;
    using Vehicle::Vec3;

    const Vec3  Probe{PointX, PointY, PointZ};
    const float Near       = CourseConstants::RampNearX;
    const float Far        = Near + CourseConstants::RampRunX;
    const float Rise       = CourseConstants::RampRise;
    const float Width      = CourseConstants::RampHalfWidth;
    const float Slope      = Rise / CourseConstants::RampRunX;
    const bool  InsideRamp = OnRamp && PointZ >= 0.0f && PointZ <= Slope * (PointX - Near);

    if (PointX < Near - Rise || PointX > Far + Rise || std::fabs(PointY) > Width + Rise)
    {
        return;
    }

    const Vec3  TopNormal  = Vec3{-Slope, 0.0f, 1.0f}.Normalized();
    const Vec3  Projected  = Probe - TopNormal * Dot(Probe - Vec3{Near, 0.0f, 0.0f}, TopNormal);
    const float ClampedX   = std::clamp(Projected.x, Near, Far);
    const Vec3  TopContact {ClampedX, std::clamp(Projected.y, -Width, Width), Slope * (ClampedX - Near)};

    const Vec3 Candidates[4] = {
        TopContact,
        {Far, std::clamp(PointY, -Width, Width), std::clamp(PointZ, 0.0f, Rise)},
        ProjectOntoCourseTriangle(Probe, {Near, -Width, 0.0f}, {Far, -Width, 0.0f}, {Far, -Width, Rise}),
        ProjectOntoCourseTriangle(Probe, {Near, Width, 0.0f}, {Far, Width, 0.0f}, {Far, Width, Rise}),
    };
    const Vec3 FeatureNormals[4] = {
        TopNormal,
        {1.0f, 0.0f, 0.0f},
        {0.0f, -1.0f, 0.0f},
        {0.0f, 1.0f, 0.0f},
    };

    float BestSquared = InsideRamp ? 1.0e30f : (PointZ - BaseHeight) * (PointZ - BaseHeight);
    for (uint32_t Feature = 0u; Feature < 4u; ++Feature)
    {
        const Vec3  Relative = Probe - Candidates[Feature];
        const float Squared  = Dot(Relative, Relative);
        if (Squared < BestSquared)
        {
            BestSquared      = Squared;
            const Vec3 Outer = (InsideRamp || Squared < 1.0e-12f) ? FeatureNormals[Feature] : Relative.Normalized();
            OutX             = Candidates[Feature].x;
            OutY             = Candidates[Feature].y;
            OutZ             = Candidates[Feature].z;
            OutNormalX       = Outer.x;
            OutNormalY       = Outer.y;
            OutNormalZ       = Outer.z;
        }
    }
}

[[nodiscard]] inline Vehicle::GroundQuery MakeCourseGroundQuery() noexcept
{
    return [](const Vehicle::Vec3& Probe, Vehicle::Vec3& OutSurface, Vehicle::Vec3& OutNormal) -> bool {
        SampleCourseSurface(
            Probe.x,
            Probe.y,
            Probe.z,
            OutSurface.x,
            OutSurface.y,
            OutSurface.z,
            OutNormal.x,
            OutNormal.y,
            OutNormal.z);
        return true;
    };
}

inline void ConeBaseOrigin(int ConeIndex, float& OutX, float& OutY) noexcept
{
    OutX = 18.0f + static_cast<float>(ConeIndex) * 5.0f;
    OutY = (ConeIndex & 1) != 0 ? -2.4f : 2.4f;
}

inline void BuildCourseHeightfieldSamples(
    uint32_t            SampleCount,
    float               OriginX,
    float               OriginY,
    float               Spacing,
    std::vector<float>& OutSamples) noexcept
{
    OutSamples.assign(static_cast<size_t>(SampleCount) * static_cast<size_t>(SampleCount), 0.0f);
    for (uint32_t Row = 0u; Row < SampleCount; ++Row)
    {
        for (uint32_t Column = 0u; Column < SampleCount; ++Column)
        {
            const float WorldX = OriginX + static_cast<float>(Column) * Spacing;
            const float WorldY = OriginY - static_cast<float>(Row) * Spacing;
            float       Height = 0.0f;
            if (!WithinKerb(WorldX, WorldY) &&
                !(WorldX >= CourseConstants::RampNearX &&
                  WorldX <= CourseConstants::RampNearX + CourseConstants::RampRunX &&
                  std::fabs(WorldY) <= CourseConstants::RampHalfWidth))
            {
                Height = SampleCourseHeight(WorldX, WorldY);
            }
            OutSamples[static_cast<size_t>(Row) * static_cast<size_t>(SampleCount) + static_cast<size_t>(Column)] = Height;
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                COURSE TRIANGLE COLLECTOR
//------------------------------------------------------------------------------------------------------------------------

template <typename TriangleReceiver>
inline void CollectCourseTriangles(TriangleReceiver Receiver) noexcept
{
    auto AppendQuad = [&](float Ax, float Ay, float Az,
                          float Bx, float By, float Bz,
                          float Cx, float Cy, float Cz,
                          float Dx, float Dy, float Dz,
                          uint32_t MaterialSlot) {
        Receiver(Ax, Ay, Az, Bx, By, Bz, Cx, Cy, Cz, MaterialSlot);
        Receiver(Ax, Ay, Az, Cx, Cy, Cz, Dx, Dy, Dz, MaterialSlot);
    };

    {
        const float InnerY = KerbConstants::CentreY;
        const float OuterY = KerbConstants::CentreY + KerbConstants::Depth;
        const float TopZ   = KerbConstants::Height;
        AppendQuad(KerbConstants::NearX, InnerY, TopZ, KerbConstants::FarX, InnerY, TopZ,
                   KerbConstants::FarX, OuterY, TopZ, KerbConstants::NearX, OuterY, TopZ, MatSurround);
        AppendQuad(KerbConstants::NearX, InnerY, 0.0f, KerbConstants::FarX, InnerY, 0.0f,
                   KerbConstants::FarX, InnerY, TopZ, KerbConstants::NearX, InnerY, TopZ, MatSurround);
        AppendQuad(KerbConstants::FarX, OuterY, 0.0f, KerbConstants::NearX, OuterY, 0.0f,
                   KerbConstants::NearX, OuterY, TopZ, KerbConstants::FarX, OuterY, TopZ, MatSurround);
    }

    const float GroundExtent = CourseConstants::PadHalfExtent * 4.0f;
    AppendQuad(-GroundExtent, -GroundExtent, -0.02f, GroundExtent, -GroundExtent, -0.02f,
               GroundExtent, GroundExtent, -0.02f, -GroundExtent, GroundExtent, -0.02f, MatSurround);

    const float HalfPad = CourseConstants::PadHalfExtent;
    const float Cell    = CourseConstants::CheckerCell;
    const int   Cells   = static_cast<int>((2.0f * HalfPad) / Cell);
    for (int TileX = 0; TileX < Cells; ++TileX)
    {
        for (int TileY = 0; TileY < Cells; ++TileY)
        {
            const float    X0           = -HalfPad + static_cast<float>(TileX) * Cell;
            const float    X1           = X0 + Cell;
            const float    Y0           = -HalfPad + static_cast<float>(TileY) * Cell;
            const float    Y1           = Y0 + Cell;
            const uint32_t MaterialSlot = ((TileX + TileY) & 1) != 0 ? MatCheckerDark : MatCheckerLight;
            AppendQuad(X0, Y0, 0.0f, X1, Y0, 0.0f, X1, Y1, 0.0f, X0, Y1, 0.0f, MaterialSlot);
        }
    }

    {
        const float Near  = CourseConstants::RampNearX;
        const float Far   = CourseConstants::RampNearX + CourseConstants::RampRunX;
        const float Rise  = CourseConstants::RampRise;
        const float Width = CourseConstants::RampHalfWidth;
        AppendQuad(Near, -Width, 0.0f, Near, Width, 0.0f, Far, Width, Rise, Far, -Width, Rise, MatRamp);
        AppendQuad(Far, -Width, Rise, Far, Width, Rise, Far, Width, 0.0f, Far, -Width, 0.0f, MatRamp);
        Receiver(Near, -Width, 0.0f, Far, -Width, Rise, Far, -Width, 0.0f, MatRamp);
        Receiver(Near, Width, 0.0f, Far, Width, 0.0f, Far, Width, Rise, MatRamp);
    }

    for (int BumpIndex = 0; BumpIndex < CourseConstants::BumpCount; ++BumpIndex)
    {
        const float CentreX = CourseConstants::BumpFirstX + static_cast<float>(BumpIndex) * CourseConstants::BumpSpacingX;
        constexpr int ArcSegments = 10;
        for (int Segment = 0; Segment < ArcSegments; ++Segment)
        {
            const float T0 = -CourseConstants::BumpHalfLenX +
                             (2.0f * CourseConstants::BumpHalfLenX) * (static_cast<float>(Segment) / ArcSegments);
            const float T1 = -CourseConstants::BumpHalfLenX +
                             (2.0f * CourseConstants::BumpHalfLenX) * (static_cast<float>(Segment + 1) / ArcSegments);
            const float Z0 = CourseConstants::BumpHeight * 0.5f *
                             (1.0f + std::cos(3.14159265f * T0 / CourseConstants::BumpHalfLenX));
            const float Z1 = CourseConstants::BumpHeight * 0.5f *
                             (1.0f + std::cos(3.14159265f * T1 / CourseConstants::BumpHalfLenX));
            AppendQuad(CentreX + T0, -CourseConstants::BumpHalfWidthY, Z0,
                       CentreX + T1, -CourseConstants::BumpHalfWidthY, Z1,
                       CentreX + T1, CourseConstants::BumpHalfWidthY, Z1,
                       CentreX + T0, CourseConstants::BumpHalfWidthY, Z0, MatBump);
        }
    }

    for (int ConeIndex = 0; ConeIndex < CourseConstants::ConeCount; ++ConeIndex)
    {
        float BaseX = 0.0f;
        float BaseY = 0.0f;
        ConeBaseOrigin(ConeIndex, BaseX, BaseY);
        constexpr int Segments = 14;
        for (int Segment = 0; Segment < Segments; ++Segment)
        {
            const float Angle0 = (2.0f * 3.14159265f * static_cast<float>(Segment)) / Segments;
            const float Angle1 = (2.0f * 3.14159265f * static_cast<float>(Segment + 1)) / Segments;
            const float X0     = BaseX + CourseConstants::ConeRadius * std::cos(Angle0);
            const float Y0     = BaseY + CourseConstants::ConeRadius * std::sin(Angle0);
            const float X1     = BaseX + CourseConstants::ConeRadius * std::cos(Angle1);
            const float Y1     = BaseY + CourseConstants::ConeRadius * std::sin(Angle1);
            Receiver(X0, Y0, 0.0f, X1, Y1, 0.0f, BaseX, BaseY, CourseConstants::ConeHeight, MatCone);
            Receiver(X1, Y1, 0.0f, X0, Y0, 0.0f, BaseX, BaseY, 0.0f, MatCone);
        }
    }
}

} // namespace Frontier::Drive
