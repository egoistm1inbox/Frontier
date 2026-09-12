//============================================================================================================================================
//                                                     RESTIRINTEGRATOR.CPP
//============================================================================================================================================
// 🧩 Accumulates ReSTIR DI+GI radiance by numerically integrating light transport paths on the GPU compute pipeline.

#include "ReSTIRIntegrator.h"
#include "../GeometricRaster/SceneRecordPacking.h"
#include <algorithm>
#include <string>
#include <cmath>

namespace Frontier {

//============================================================================================================================================
//                                                     LIFECYCLE
//============================================================================================================================================

ReSTIRIntegrator::ReSTIRIntegrator(ReSTIRIntegratorConfiguration InitialConfiguration) noexcept
    : ActiveConfiguration(InitialConfiguration)
    , AccumulationIndex(0u)
    , HistoryOrigin{ 0.0f, 0.0f, 0.0f }
    , HistoryForward{ 0.0f, 0.0f, 0.0f }
    , HistoryWidth(0u)
    , HistoryHeight(0u)
{
}

//============================================================================================================================================
//                                                OBSERVE CAMERA
//============================================================================================================================================

void ReSTIRIntegrator::ObserveCamera(const ProjectZero::FlyThroughSolver& Camera,
                                     uint32_t ViewportWidth, uint32_t ViewportHeight) noexcept
{
    const Vector3& Origin  = Camera.QuerySpatialLocation();
    const Vector3& Forward = Camera.QueryForwardVector();

    constexpr float PositionTolerance  = 1e-5f;   // [m]
    constexpr float DirectionTolerance = 1e-6f;   // [-]

    const Vector3 OriginDelta  = Origin  - HistoryOrigin;
    const Vector3 ForwardDelta = Forward - HistoryForward;

    const bool Moved   = OriginDelta.LengthSquared()  > PositionTolerance  * PositionTolerance;
    const bool Turned  = ForwardDelta.LengthSquared() > DirectionTolerance * DirectionTolerance;
    const bool Resized = ViewportWidth != HistoryWidth || ViewportHeight != HistoryHeight;

    if (Moved || Turned || Resized)
    {
        HistoryOrigin  = Origin;
        HistoryForward = Forward;
        HistoryWidth   = ViewportWidth;
        HistoryHeight  = ViewportHeight;
        ResetAccumulation();
    }
}

//============================================================================================================================================
//                                                  BUILD DISPATCH
//============================================================================================================================================

DispatchConfiguration ReSTIRIntegrator::BuildDispatch(
    const ProjectZero::FlyThroughSolver& Camera,
    uint32_t                             ViewportWidth,
    uint32_t                             ViewportHeight,
    uint32_t                             AlphaMaskedMaterialCount,
    uint32_t                             LuminaireTriangleCount) const noexcept
{
    const Vector3& Origin  = Camera.QuerySpatialLocation();
    const Vector3& Forward = Camera.QueryForwardVector();
    const Vector3& Right   = Camera.QueryRightVector();
    const Vector3& Up      = Camera.QueryUpwardVector();

    const float TanHalf = std::tan(Camera.QueryFieldOfViewRadians() * 0.5f);

    DispatchConfiguration Dispatch{};
    Dispatch.CameraOriginX         = Origin.x;
    Dispatch.CameraOriginY         = Origin.y;
    Dispatch.CameraOriginZ         = Origin.z;
    Dispatch.FieldOfViewTanHalf    = TanHalf;
    Dispatch.CameraForwardX        = Forward.x;
    Dispatch.CameraForwardY        = Forward.y;
    Dispatch.CameraForwardZ        = Forward.z;
    Dispatch.AspectRatio           = Camera.QueryAspectRatio();
    Dispatch.CameraRightX          = Right.x;
    Dispatch.CameraRightY          = Right.y;
    Dispatch.CameraRightZ          = Right.z;
    // A6b. ONE exposure value reaches the shader, whether it came from the slider or from adaptation. Manual
    //    mode returns the configured value unchanged, so every pre-A6b image is still reproducible, and the two
    //    modes cannot become two code paths that disagree about what the tone map receives.
    Dispatch.Exposure              = Adaptation.QueryExposure();
    // A7d. The eye's remaining colour at this adapted level. Taken from the same integrator as the exposure so
    //    the two can never describe different light.
    Dispatch.ColourSaturation      = Adaptation.QueryColourSaturation();
    Dispatch.CameraUpX             = Up.x;
    Dispatch.CameraUpY             = Up.y;
    Dispatch.CameraUpZ             = Up.z;
    Dispatch.AmbientStrength       = ActiveConfiguration.AmbientStrength;
    Dispatch.ViewportWidth         = ViewportWidth;
    Dispatch.ViewportHeight        = ViewportHeight;
    Dispatch.AccumulationIndex     = AccumulationIndex;
    Dispatch.ExtraCandidateCount      = ActiveConfiguration.ExtraCandidateCount;
    Dispatch.SpatialTapCount       = ActiveConfiguration.SpatialTapCount;
    Dispatch.DenoiseLevelCount     = ActiveConfiguration.DenoiseLevelCount;
    Dispatch.CandidatesPerPixel    = ActiveConfiguration.CandidatesPerPixel;
    Dispatch.AlphaMaskedMaterialCount = AlphaMaskedMaterialCount;   // R4b: 0 keeps the any-hit shadow path
    Dispatch.LuminaireTriangleCount = LuminaireTriangleCount;
    Dispatch.FeatureFlags          = (ActiveConfiguration.GlobalIllumination ? DispatchFeatureGlobalIllumination : 0u)
                                   | (ActiveConfiguration.AntiAliasing       ? DispatchFeatureAntiAliasing       : 0u)
                                   | (ActiveConfiguration.AmbientFloor       ? DispatchFeatureAmbientFloor       : 0u)
                                   | (ActiveConfiguration.TemporalReuse      ? DispatchFeatureTemporalReuse      : 0u)
                                   | (ActiveConfiguration.SpatialReuse       ? DispatchFeatureSpatialReuse       : 0u)
                                   | (ActiveConfiguration.AliasPick          ? DispatchFeatureAliasPick          : 0u)
                                   | (ActiveConfiguration.TemporalReprojection ? DispatchFeatureTemporalReprojection : 0u)
                                   | (ActiveConfiguration.Denoise            ? DispatchFeatureDenoise            : 0u);

    for (uint32_t& Reserve : Dispatch.PushReserve) Reserve = 0u;

    return Dispatch;
}

//============================================================================================================================================
//                                               SCENE RECORD BUILDERS
//============================================================================================================================================

uint32_t ReSTIRIntegrator::CountLuminaireTriangles(const ProjectZero::RayTracingSolver& Scene) noexcept
{
    const auto& Triangles = Scene.QueryTriangles();
    const auto& Materials = Scene.QueryMaterials();

    uint32_t Count = 0u;
    for (const auto& Triangle : Triangles)
    {
        if (Triangle.MaterialIndex < Materials.size())
        {
            const auto& Material = Materials[Triangle.MaterialIndex];
            const float EmissiveMagnitude = Material.EmissiveRadiance.x
                                          + Material.EmissiveRadiance.y
                                          + Material.EmissiveRadiance.z;
            if (EmissiveMagnitude > 0.0f) ++Count;
        }
    }
    return Count;
}

std::vector<TriangleIndex> ReSTIRIntegrator::BuildTriangleIndex(
    const ProjectZero::RayTracingSolver& Scene) noexcept
{
    return BuildProjectZeroTriangleRecords(Scene);
}

std::vector<MaterialDescriptor> ReSTIRIntegrator::BuildMaterialDescriptors(
    const ProjectZero::RayTracingSolver& Scene) noexcept
{
    return BuildProjectZeroMaterialRecords(Scene);
}

} // namespace Frontier
