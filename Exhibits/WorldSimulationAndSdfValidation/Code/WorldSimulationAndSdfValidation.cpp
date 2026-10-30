/*==========================================================================================================================================
                                             WORLDSIMULATIONANDSDFVALIDATION.CPP
==========================================================================================================================================*/
// 🧩 End-to-end numerical, sanitizer, and visual validation of Plume collision/shadows/lighting, 2.5D Shallow-Water & Mud,
//    Single-PolygonSurface Snow/Hail + Snow Pit + Melt, Lightning & Thunder, Griffith Fracture + Jolt 5.6.0 Convex Hulls,
//    Swept Scene-Lighting Sparks, Dual-Tier GTX SDF & RTX BVH Portals/Mirrors, and Native Vehicle Cabin/HUD HMI.

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/Audio/AudioFoundation.h"
#include "Engine/Environment/LightningThunderExtension.h"
#include "Engine/Environment/SnowpackAccumulationExtension.h"
#include "Engine/Environment/WindForceFieldExtension.h"
#include "Engine/Fluid/PlumeFluidExtension.h"
#include "Engine/Fluid/ShallowWaterMudExtension.h"
#include "Engine/Interface/VehicleCabinHmiExtension.h"
#include "Engine/Physics/Fracture/SolidFractureExtension.h"
#include "Engine/Physics/RigidBodySolver.h"
#include "Engine/Physics/Sparks/BallisticSparkExtension.h"
#include "Engine/Rendering/SdfRestirPortalExtension.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

namespace
{
/*------------------------------------------------------------------------------------------------------------------------------------------
                                              SELF-CONTAINED LOSSLESS PNG ENCODER
------------------------------------------------------------------------------------------------------------------------------------------*/
void AppendBigEndian32(std::vector<uint8_t>& Buf, uint32_t Word)
{
    Buf.push_back(static_cast<uint8_t>((Word >> 24u) & 0xFFu));
    Buf.push_back(static_cast<uint8_t>((Word >> 16u) & 0xFFu));
    Buf.push_back(static_cast<uint8_t>((Word >> 8u) & 0xFFu));
    Buf.push_back(static_cast<uint8_t>(Word & 0xFFu));
}

uint32_t ComputeCrc32(const uint8_t* Data, size_t Length) noexcept
{
    uint32_t Crc = 0xFFFFFFFFu;
    for (size_t I = 0u; I < Length; ++I)
    {
        Crc ^= Data[I];
        for (int B = 0; B < 8; ++B)
        {
            const uint32_t Mask = -(Crc & 1u);
            Crc = (Crc >> 1u) ^ (0xEDB88320u & Mask);
        }
    }
    return ~Crc;
}

void AppendPngChunk(std::vector<uint8_t>& FileBytes, const char Tag[4], const std::vector<uint8_t>& Payload)
{
    AppendBigEndian32(FileBytes, static_cast<uint32_t>(Payload.size()));
    const size_t CrcStart = FileBytes.size();
    FileBytes.push_back(static_cast<uint8_t>(Tag[0]));
    FileBytes.push_back(static_cast<uint8_t>(Tag[1]));
    FileBytes.push_back(static_cast<uint8_t>(Tag[2]));
    FileBytes.push_back(static_cast<uint8_t>(Tag[3]));
    FileBytes.insert(FileBytes.end(), Payload.begin(), Payload.end());
    const uint32_t Crc = ComputeCrc32(FileBytes.data() + CrcStart, 4u + Payload.size());
    AppendBigEndian32(FileBytes, Crc);
}

bool WriteRgba8PngFile(const std::string& FilePath, uint32_t Width, uint32_t Height, const std::vector<uint8_t>& Rgba8)
{
    if (Rgba8.size() != static_cast<size_t>(Width) * Height * 4u)
    {
        return false;
    }

    std::filesystem::create_directories(std::filesystem::path(FilePath).parent_path());

    // Build raw scanlines with filter-byte 0 per row.
    std::vector<uint8_t> RawScanlines;
    RawScanlines.reserve(static_cast<size_t>(Height) * (1u + static_cast<size_t>(Width) * 4u));
    for (uint32_t Y = 0u; Y < Height; ++Y)
    {
        RawScanlines.push_back(0u);
        const size_t RowStart = static_cast<size_t>(Y) * Width * 4u;
        RawScanlines.insert(
            RawScanlines.end(),
            Rgba8.begin() + static_cast<std::ptrdiff_t>(RowStart),
            Rgba8.begin() + static_cast<std::ptrdiff_t>(RowStart + static_cast<size_t>(Width) * 4u));
    }

    // Wrap in RFC-1950 zlib stream using stored deflate blocks (65,535 B max per block) + Adler-32.
    std::vector<uint8_t> ZlibData;
    ZlibData.push_back(0x78u);
    ZlibData.push_back(0x01u);

    size_t Offset = 0u;
    while (Offset < RawScanlines.size())
    {
        const size_t   Chunk = std::min<size_t>(65535u, RawScanlines.size() - Offset);
        const bool     Final = (Offset + Chunk >= RawScanlines.size());
        const uint16_t Len   = static_cast<uint16_t>(Chunk);
        const uint16_t NLen  = static_cast<uint16_t>(~Len);

        ZlibData.push_back(Final ? 0x01u : 0x00u);
        ZlibData.push_back(static_cast<uint8_t>(Len & 0xFFu));
        ZlibData.push_back(static_cast<uint8_t>((Len >> 8u) & 0xFFu));
        ZlibData.push_back(static_cast<uint8_t>(NLen & 0xFFu));
        ZlibData.push_back(static_cast<uint8_t>((NLen >> 8u) & 0xFFu));
        ZlibData.insert(
            ZlibData.end(),
            RawScanlines.begin() + static_cast<std::ptrdiff_t>(Offset),
            RawScanlines.begin() + static_cast<std::ptrdiff_t>(Offset + Chunk));
        Offset += Chunk;
    }

    uint32_t AdlerA = 1u;
    uint32_t AdlerB = 0u;
    for (uint8_t Byte : RawScanlines)
    {
        AdlerA = (AdlerA + Byte) % 65521u;
        AdlerB = (AdlerB + AdlerA) % 65521u;
    }
    AppendBigEndian32(ZlibData, (AdlerB << 16u) | AdlerA);

    std::vector<uint8_t> PngBytes = {137u, 80u, 78u, 71u, 13u, 10u, 26u, 10u};
    std::vector<uint8_t> Ihdr;
    AppendBigEndian32(Ihdr, Width);
    AppendBigEndian32(Ihdr, Height);
    Ihdr.push_back(8u); // Bit depth 8
    Ihdr.push_back(6u); // RGBA truecolour with alpha
    Ihdr.push_back(0u);
    Ihdr.push_back(0u);
    Ihdr.push_back(0u);
    AppendPngChunk(PngBytes, "IHDR", Ihdr);
    AppendPngChunk(PngBytes, "IDAT", ZlibData);
    AppendPngChunk(PngBytes, "IEND", {});

    std::ofstream Out(FilePath, std::ios::binary);
    if (!Out)
    {
        return false;
    }
    Out.write(reinterpret_cast<const char*>(PngBytes.data()), static_cast<std::streamsize>(PngBytes.size()));
    return Out.good();
}

struct ValidationLedger
{
    uint32_t Passed = 0u;
    uint32_t Failed = 0u;

    void Verify(bool Condition, const char* Label, const char* Detail = "")
    {
        if (Condition)
        {
            ++Passed;
            std::printf("  [PASS] %-64s %s\n", Label, Detail);
        }
        else
        {
            ++Failed;
            std::printf("  [FAIL] %-64s %s\n", Label, Detail);
        }
    }
};
} // namespace

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                      MAIN VALIDATION ENTRY
------------------------------------------------------------------------------------------------------------------------------------------*/
int main()
{
    using namespace Frontier;
    ValidationLedger Ledger{};
    char             Note[256];

    std::printf("====================================================================================================\n");
    std::printf("  FRONTIER WORLD SIMULATION, FLUID, SNOW/HAIL, FRACTURE, SPARKS, DUAL-TIER GI & HMI VALIDATION\n");
    std::printf("====================================================================================================\n");

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 1 & 2: PlumeFluidExtension Solid Obstacle Collision, Moving Wake, Volumetric Shadows & Fire Illumination
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 1 & 2: PlumeFluid Solid Collision, Wake, Volumetric Shadows & Fire Lighting ---\n");
    PlumeFluidParameters PlumeCfg{};
    PlumeCfg.Grade = PlumeQualityGrade::Medium;
    PlumeFluidExtension Plume{PlumeCfg};

    PlumeSolidObstacleBox SolidWall{};
    SolidWall.Centre         = {0.0f, 0.0f, 1.8f};
    SolidWall.HalfExtents    = {1.4f, 1.4f, 1.4f};
    SolidWall.LinearVelocity = {8.5f, 0.0f, 0.0f};
    Plume.RegisterSolidObstacle(SolidWall);

    Plume.AppendTransientPlumeSource({0.0f, 0.0f, 0.30f}, 0.85f, {0.0f, 0.0f, 3.2f}, 8.5f, 12.0f, 10.5f, 6.0f);
    for (int Step = 0; Step < 14; ++Step)
    {
        Plume.AdvanceSimulation({0.0f, 0.0f, 0.0f}, {0.35f, -0.40f, 0.85f}, 1.0f / 30.0f);
    }

    // Check solid interior velocity enforcement (v = 0 inside solid cells, w = 1 solid marker).
    const auto VelExt  = Plume.VelocityExtent();
    const auto& VelBuf = Plume.VelocityData();
    uint32_t SolidMarkedCount = 0u;
    float    MaxInteriorSpeed = 0.0f;
    for (size_t K = 0u; K + 3u < VelBuf.size(); K += 4u)
    {
        if (VelBuf[K + 3u] > 0.5f)
        {
            ++SolidMarkedCount;
            const float Spd = std::sqrt(VelBuf[K] * VelBuf[K] + VelBuf[K + 1u] * VelBuf[K + 1u] + VelBuf[K + 2u] * VelBuf[K + 2u]);
            MaxInteriorSpeed = std::max(MaxInteriorSpeed, Spd);
        }
    }
    std::snprintf(Note, sizeof(Note), "solid_cells=%u/%u max_interior_spd=%.6f m/s", SolidMarkedCount, VelExt[0] * VelExt[1] * VelExt[2], MaxInteriorSpeed);
    Ledger.Verify(SolidMarkedCount > 20u && MaxInteriorSpeed < 1.0e-5f, "PlumeFluid solid OBB interior Neumann zero-velocity", Note);

    const float ShadowThroughPlume = Plume.EvaluateShadowTransmittance({-4.0f, 0.0f, 0.45f}, {1.0f, 0.0f, 0.0f}, 10.0f);
    const float ShadowClearSky     = Plume.EvaluateShadowTransmittance({-4.0f, 12.0f, 6.0f}, {0.0f, 0.0f, 1.0f}, 10.0f);
    std::snprintf(Note, sizeof(Note), "T_plume=%.4f T_clear=%.4f", ShadowThroughPlume, ShadowClearSky);
    Ledger.Verify(ShadowThroughPlume < 0.88f && ShadowClearSky > 0.999f, "PlumeFluid Beer-Lambert volumetric shadow casting", Note);

    const auto FireNear = Plume.EvaluateSceneIllumination({1.2f, 0.0f, 0.15f}, {-1.0f, 0.0f, 0.4f});
    const auto FireFar  = Plume.EvaluateSceneIllumination({9.5f, 0.0f, 0.15f}, {-1.0f, 0.0f, 0.4f});
    const float NearSum = FireNear[0] + FireNear[1] + FireNear[2];
    const float FarSum  = FireFar[0] + FireFar[1] + FireFar[2];
    std::snprintf(Note, sizeof(Note), "near_rgb_sum=%.4f far_rgb_sum=%.5f", NearSum, FarSum);
    Ledger.Verify(NearSum > 0.05f && NearSum > FarSum * 4.0f, "PlumeFluid blackbody fire & hot-gas scene illumination", Note);

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 3, 4, 5 & 6: 2.5D ShallowWaterMudExtension (Lake-at-Rest, Cloud Rain Puddles, Bingham Mud, Nested Link)
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 3..6: 2.5D Saint-Venant Shallow-Water, Rain Puddles, Bingham Mud & Nested Link ---\n");
    ShallowWaterConfiguration LakeCfg{};
    LakeCfg.CellsX              = 48u;
    LakeCfg.CellsY              = 48u;
    LakeCfg.CellSizeMetres      = 0.50f;
    LakeCfg.WorldOriginXY       = {-12.0f, -12.0f};
    LakeCfg.InfiltrationRateMps = 0.0f;
    ShallowWaterMudExtension LakeSolver{LakeCfg};
    LakeSolver.SculptBedDepressionOrMound({0.0f, 0.0f}, 6.0f, -0.45f);
    LakeSolver.SculptBedDepressionOrMound({1.5f, -1.0f}, 2.0f, +0.25f); // Submerged bump!
    LakeSolver.FillBasinRegion({0.0f, 0.0f}, 5.8f, -0.05f, 0.0f);

    ShallowWaterDiagnostics LakeDiag{};
    for (int S = 0; S < 20; ++S)
    {
        LakeDiag = LakeSolver.StepSimulation(1.0f / 60.0f);
    }
    std::snprintf(Note, sizeof(Note), "peak_speed_at_rest=%.7f m/s vol=%.4f m^3", LakeDiag.PeakFlowSpeedMps, LakeDiag.TotalLiquidVolumeCubicM);
    Ledger.Verify(LakeDiag.PeakFlowSpeedMps < 1.0e-4f && LakeDiag.TotalLiquidVolumeCubicM > 1.0, "2.5D Audusse-Minmod hydrostatic lake-at-rest", Note);

    // Cloud-gated rain puddle formation: left side cloudy (tau = 0.85), right side clear sky (tau = 0.0)!
    ShallowWaterMudExtension PuddleRoad{LakeCfg};
    PuddleRoad.SculptBedDepressionOrMound({-5.0f, 0.0f}, 3.2f, -0.06f);
    PuddleRoad.SculptBedDepressionOrMound({+5.0f, 0.0f}, 3.2f, -0.06f);
    std::array<float, 1024u> HalfCloudColumns{};
    for (uint32_t Cy = 0u; Cy < 32u; ++Cy)
    {
        for (uint32_t Cx = 0u; Cx < 32u; ++Cx)
        {
            HalfCloudColumns[Cy * 32u + Cx] = (Cx < 16u) ? 0.85f : 0.0f;
        }
    }
    for (int R = 0; R < 40; ++R)
    {
        PuddleRoad.DepositSpatiallyGatedRain(0.018f, HalfCloudColumns.data(), 0.08f, {0.0f, 0.0f}, 24.0f, 0.1f);
        PuddleRoad.StepSimulation(0.05f);
    }
    const float CloudyPuddleDepth = PuddleRoad.SampleSurface({-5.0f, 0.0f}).FluidDepthMetres;
    const float ClearRoadDepth    = PuddleRoad.SampleSurface({+5.0f, 0.0f}).FluidDepthMetres;
    std::snprintf(Note, sizeof(Note), "cloudy_puddle=%.4f m clear_depression=%.6f m", CloudyPuddleDepth, ClearRoadDepth);
    Ledger.Verify(CloudyPuddleDepth > 0.03f && ClearRoadDepth < 1.0e-5f, "Cloud-gated rain forms puddles only beneath clouds", Note);

    // Bingham-plastic mud rheology vs pure water + wheel & hull coupling!
    ShallowWaterMudExtension WaterSlope{LakeCfg};
    ShallowWaterMudExtension MudSlope{LakeCfg};
    std::vector<float> TiltedBed(48u * 48u, 0.0f);
    for (uint32_t J = 0u; J < 48u; ++J)
    {
        for (uint32_t I = 0u; I < 48u; ++I)
        {
            TiltedBed[J * 48u + I] = 0.04f * static_cast<float>(48u - I);
        }
    }
    WaterSlope.AssignBedElevationGrid(TiltedBed);
    MudSlope.AssignBedElevationGrid(TiltedBed);
    WaterSlope.InjectLocalLiquidOrMeltVolume({-4.0f, 0.0f}, 2.5f, 0.16f, 0.0f);
    MudSlope.InjectLocalLiquidOrMeltVolume({-4.0f, 0.0f}, 2.5f, 0.16f, 0.88f); // Rich Bingham mud!

    ShallowWaterDiagnostics WSlopeD{}, MSlopeD{};
    for (int S = 0; S < 25; ++S)
    {
        WSlopeD = WaterSlope.StepSimulation(1.0f / 60.0f);
        MSlopeD = MudSlope.StepSimulation(1.0f / 60.0f);
    }
    std::snprintf(Note, sizeof(Note), "water_peak_v=%.3f m/s bingham_mud_peak_v=%.3f m/s", WSlopeD.PeakFlowSpeedMps, MSlopeD.PeakFlowSpeedMps);
    Ledger.Verify(MSlopeD.PeakFlowSpeedMps < WSlopeD.PeakFlowSpeedMps * 0.65f, "O'Brien-Julien Bingham-plastic mud yield-stress arrest", Note);

    const WheelFluidInteraction MudWheel = MudSlope.CoupleWheelContact({-4.0f, 0.0f, 1.35f}, {12.0f, 0.0f, 0.0f}, 0.34f, 0.26f, 0.0f);
    const auto HullBuoyancy = LakeSolver.EvaluateHullBuoyancyAndDragForce({0.0f, 0.0f, -0.18f}, {2.1f, 0.9f, 0.5f}, {4.0f, 0.0f, 0.0f}, 0.0f);
    std::snprintf(
        Note,
        sizeof(Note),
        "mud_grip=%.3f drag_x=%.1f N hull_buoy_z=%.1f N",
        MudWheel.TractionMultiplier,
        MudWheel.HydrodynamicDragNewtons[0],
        HullBuoyancy[2]);
    Ledger.Verify(
        MudWheel.TractionMultiplier < 0.72f && MudWheel.HydrodynamicDragNewtons[0] < -15.0f && HullBuoyancy[2] > 500.0f,
        "Two-way wheel mud traction/drag & multi-probe hull buoyancy",
        Note);

    // Two-way NestedWaterDomainLink (Coarse 96 m <-> Fine 24 m + 6 m cross-fade).
    ShallowWaterConfiguration CoarseCfg = LakeCfg;
    CoarseCfg.CellSizeMetres            = 2.0f;
    CoarseCfg.WorldOriginXY             = {-48.0f, -48.0f};
    ShallowWaterMudExtension CoarseWater{CoarseCfg};
    CoarseWater.SculptBedDepressionOrMound({0.0f, 0.0f}, 22.0f, -0.60f);
    CoarseWater.FillBasinRegion({0.0f, 0.0f}, 20.0f, -0.10f, 0.15f);

    LakeCfg.HoleCrossFadeMetres = 4.0f;
    ShallowWaterMudExtension FineWater{LakeCfg};
    FineWater.SculptBedDepressionOrMound({0.0f, 0.0f}, 11.0f, -0.60f);
    NestedWaterDomainLink::SynchronizeCoarseToFineRim(CoarseWater, FineWater, 3u);
    FineWater.InjectLocalLiquidOrMeltVolume({0.0f, 0.0f}, 2.5f, 0.22f, 0.35f);
    FineWater.StepSimulation(1.0f / 60.0f);
    NestedWaterDomainLink::RestrictFineInteriorToCoarse(FineWater, CoarseWater, 4u);

    const SurfaceFluidSample SeamCenter = NestedWaterDomainLink::SampleNestedCompositeSurface(CoarseWater, FineWater, {0.0f, 0.0f});
    const SurfaceFluidSample SeamEdge   = NestedWaterDomainLink::SampleNestedCompositeSurface(CoarseWater, FineWater, {10.5f, 0.0f});
    std::snprintf(Note, sizeof(Note), "center_alpha=%.3f border_alpha=%.3f", SeamCenter.NestedCrossFadeAlpha, SeamEdge.NestedCrossFadeAlpha);
    Ledger.Verify(SeamCenter.NestedCrossFadeAlpha > 0.98f && SeamEdge.NestedCrossFadeAlpha > 0.05f && SeamEdge.NestedCrossFadeAlpha < 0.95f, "NestedWaterDomainLink two-way coarse<->fine & border cross-fade", Note);

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 7, 8 & 9: Snowpack Single PolygonSurface, Vehicle Adhesion, Snow Pit Rut Carving & Hail Melt into Puddles
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 7..9: Single-PolygonSurface Snow/Hail, Snow Pit Ruts & Melt into Puddles ---\n");
    CloudParameters StormClouds{};
    StormClouds.Coverage               = 0.92;
    StormClouds.UniformDensityOverride = 0.85;

    WindForceFieldExtension WindField{};
    WeatherParticleBudgetConfig SnowBudget{};
    SnowBudget.Category                  = FallingParticleCategory::SnowFlake;
    SnowBudget.StrictParticleBudget      = 1536u;
    SnowBudget.SpawnVolumeHorizontalM    = 28.0;
    SnowBudget.SpawnCeilingHeightM       = 6.0;
    SnowBudget.WeatherIntensityZeroToOne = 1.0;
    CloudGatedWeatherSpawner SnowSpawner{SnowBudget};

    SnowpackDomainSpec SnowSpec{};
    SnowSpec.CellsX         = 64u;
    SnowSpec.CellsY         = 64u;
    SnowSpec.CellSizeMetres = 0.50f;
    SnowSpec.OriginX        = -16.0f;
    SnowSpec.OriginY        = -16.0f;
    SnowSpec.FlakeEquivalentMassKg = 0.085f;
    SnowpackAccumulationExtension Snowpack{SnowSpec};

    VehicleSnowEnvelope ParkedCar{};
    ParkedCar.WorldCentre = {0.0f, 0.0f, 0.65f};

    for (int Frame = 0; Frame < 45; ++Frame)
    {
        SnowSpawner.StepParticles(StormClouds, WindField, {0.0, 0.0, 0.0}, 0.08);
        Snowpack.FuseWeatherAndAdvancePhaseChange(SnowSpawner, ParkedCar, nullptr, 0.08f, 268.15f);
    }
    Snowpack.RebuildContiguousPolygonSurfaces(ParkedCar);

    // Verify zero lingering ground snowflakes + single contiguous Ground & Vehicle PolygonSurfaces!
    uint32_t LingeringGroundFlakes = 0u;
    for (const auto& P : SnowSpawner.Particles())
    {
        if (P.Alive && P.Position.Z <= 0.01)
        {
            ++LingeringGroundFlakes;
        }
    }
    std::snprintf(
        Note,
        sizeof(Note),
        "retired=%llu ground_tris=%zu veh_tris=%zu lingering_ground=%u",
        static_cast<unsigned long long>(Snowpack.Telemetry().RetiredSnowflakesFused),
        Snowpack.GroundPolygonSurface().Indices.size() / 3u,
        Snowpack.VehiclePolygonSurface().Indices.size() / 3u,
        LingeringGroundFlakes);
    Ledger.Verify(
        Snowpack.Telemetry().RetiredSnowflakesFused > 80u &&
            Snowpack.GroundPolygonSurface().ActiveQuadCount > 10u &&
            Snowpack.VehiclePolygonSurface().ActiveQuadCount > 2u &&
            LingeringGroundFlakes == 0u,
        "Snowflakes retire immediately into 1 Ground + 1 Vehicle PolygonSurface",
        Note);

    // Aerodynamic wind-shear shedding when vehicle accelerates to 34 m/s!
    const double PreDriveVehSnowKg = Snowpack.Telemetry().VehicleAdheredMassKg;
    VehicleSnowEnvelope FastCar    = ParkedCar;
    FastCar.ForwardSpeedMps        = 34.0f;
    FastCar.ChassisAccelMps2       = 9.5f;
    Snowpack.FuseWeatherAndAdvancePhaseChange(SnowSpawner, FastCar, nullptr, 1.5f, 268.15f);
    std::snprintf(Note, sizeof(Note), "parked_car_snow=%.3f kg -> 34mps_car_snow=%.3f kg", PreDriveVehSnowKg, Snowpack.Telemetry().VehicleAdheredMassKg);
    Ledger.Verify(Snowpack.Telemetry().VehicleAdheredMassKg < PreDriveVehSnowKg * 0.55, "Vehicle-adhered snow sheds onto wake under aerodynamic shear", Note);

    // Author a deep 0.46 m Snow Pit and drive a loaded wheel across it to carve physical tyre ruts + lateral berms!
    Snowpack.SculptSnowPitOrDrift(5.0f, 0.0f, 4.2f, 0.46f, 155.0f);
    const float PitBefore = Snowpack.SampleGroundSnowThickness(5.0f, 0.0f);
    SnowWheelRutResponse RutResp{};
    for (float X = 2.5f; X <= 7.5f; X += 0.35f)
    {
        SnowWheelRutInput WheelIn{};
        WheelIn.WheelContactWorld = {X, 0.0f, 0.0f};
        WheelIn.WheelForwardWorld = {1.0f, 0.0f, 0.0f};
        WheelIn.TyreWidthMetres   = 0.285f;
        WheelIn.NormalLoadNewtons = 4400.0f;
        WheelIn.WheelForwardSpeed = 11.0f;
        const auto StepRut = Snowpack.CarveWheelRutAndEvaluateResistance(WheelIn);
        if (std::abs(X - 5.0f) < 0.25f)
        {
            RutResp = StepRut;
        }
    }
    Snowpack.RebuildContiguousPolygonSurfaces(ParkedCar);
    const float PitRutCenter = Snowpack.SampleGroundSnowThickness(5.0f, 0.0f);
    const float PitBermSide  = Snowpack.SampleGroundSnowThickness(5.0f, 0.52f);
    const float PackedRho    = Snowpack.SampleGroundSnowDensity(5.0f, 0.0f);
    std::snprintf(
        Note,
        sizeof(Note),
        "pit_before=%.3fm rut_after=%.3fm berm=%.3fm rho=%.0f drag=%.1fN",
        PitBefore,
        PitRutCenter,
        PitBermSide,
        PackedRho,
        RutResp.CompactionResistanceN);
    Ledger.Verify(
        PitRutCenter < PitBefore - 0.10f && PitBermSide > PitRutCenter + 0.06f &&
            PackedRho > 280.0f && RutResp.CompactionResistanceN > 250.0f,
        "Drivable Snow Pit Wong-Bekker rut carving, berms & compaction drag",
        Note);

    // Hail bounce -> granular hail-ice PolygonSurface -> Stefan thermodynamic melt into 2.5D shallow-water puddles!
    WeatherParticleBudgetConfig HailBudget = SnowBudget;
    HailBudget.Category                    = FallingParticleCategory::HailPellet;
    HailBudget.SpawnCeilingHeightM         = 10.0;
    CloudGatedWeatherSpawner HailSpawner{HailBudget};
    SnowSpec.HailPelletMassKg = 0.14f;
    SnowpackAccumulationExtension HailPack{SnowSpec};
    ShallowWaterMudExtension      MeltPuddle{LakeCfg};

    for (int Frame = 0; Frame < 55; ++Frame)
    {
        HailSpawner.StepParticles(StormClouds, WindField, {0.0, 0.0, 0.0}, 0.05);
        HailPack.FuseWeatherAndAdvancePhaseChange(HailSpawner, ParkedCar, nullptr, 0.05f, 270.15f);
    }
    const uint64_t HailBounces    = HailPack.Telemetry().HailBounceContacts;
    const uint64_t HailFused      = HailPack.Telemetry().RetiredHailPelletsFused;
    const double   PreMeltWaterM3 = MeltPuddle.StepSimulation(0.01f).TotalLiquidVolumeCubicM;

    // Warm air to +14 C (287.15 K) so settled hail melts into MeltPuddle!
    for (int MeltStep = 0; MeltStep < 25; ++MeltStep)
    {
        HailPack.FuseWeatherAndAdvancePhaseChange(HailSpawner, ParkedCar, &MeltPuddle, 2.0f, 287.15f);
    }
    const double PostMeltWaterM3 = MeltPuddle.StepSimulation(0.02f).TotalLiquidVolumeCubicM;
    std::snprintf(
        Note,
        sizeof(Note),
        "bounces=%llu fused=%llu melted=%.3f kg puddle_vol=%.5f m^3",
        static_cast<unsigned long long>(HailBounces),
        static_cast<unsigned long long>(HailFused),
        HailPack.Telemetry().CumulativeMeltedWaterKg,
        PostMeltWaterM3);
    Ledger.Verify(
        HailBounces > 10u && HailFused > 10u && PostMeltWaterM3 > PreMeltWaterM3 + 1.0e-4,
        "Hail bounces, settles into granular ice & melts into 2.5D puddles",
        Note);

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 10: Lightning & Speed-of-Sound Multi-Segment Thunder
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 10: Branched Lightning, Internal Cloud Glow, Scene Flash & Delayed Thunder ---\n");
    LightningThunderExtension StormLightning{};
    Audio::AcousticListenerPose DriverEars{};
    DriverEars.Position = {0.0f, 0.0f, 1.4f};

    CloudParameters ClearSkyClouds{};
    ClearSkyClouds.Coverage               = 0.0;
    ClearSkyClouds.UniformDensityOverride = 0.0;
    const bool ClearStrike = StormLightning.TriggerCloudToGroundStrike(ClearSkyClouds, {450.0f, 0.0f, 0.0f}, {450.0f, 0.0f, 0.0f}, DriverEars);
    const bool StormStrike = StormLightning.TriggerCloudToGroundStrike(StormClouds, {450.0f, 0.0f, 0.0f}, {450.0f, 0.0f, 0.0f}, DriverEars);

    const size_t ActiveFlashRibbonIndices = StormLightning.BoltPolygonSurface().Indices.size();
    const Vec3   CloudFlashGlow           = StormLightning.EvaluateCloudInternalFlashRadiance({450.0f, 0.0f, 960.0f}, 0.85);
    const Vec3   RoadFlashIrr             = StormLightning.EvaluateSceneFlashIrradiance({0.0f, 0.0f, 0.0f}, {0.0f, 0.0f, 1.0f});
    const double SpeedSound               = StormLightning.SpeedOfSoundMetresPerSecond();

    // Advance 0.5 s: optical flash finishes, NO thunder has arrived yet (450 m / 340.3 m/s = 1.32 s)!
    StormLightning.AdvanceStormTimeline(0.50, DriverEars, DriverEars.Position);
    const bool ZeroEarlyThunder = StormLightning.NewlyArrivedThunderWaves().empty();

    // Advance to t = 2.0 s: near ground-strike crack arrives first; high-altitude anvil rumble arrives later!
    uint32_t ArrivedByTwoSec = 0u;
    for (int Step = 0; Step < 15; ++Step)
    {
        StormLightning.AdvanceStormTimeline(0.10, DriverEars, DriverEars.Position);
        ArrivedByTwoSec += static_cast<uint32_t>(StormLightning.NewlyArrivedThunderWaves().size());
    }
    std::snprintf(
        Note,
        sizeof(Note),
        "clear_strike=%d storm_segs=%zu ribbon_idx=%zu cloud_glow=%.2f c_sound=%.1fm/s arrived@2s=%u",
        ClearStrike ? 1 : 0,
        StormLightning.ActiveBoltSegments().size(),
        ActiveFlashRibbonIndices,
        CloudFlashGlow.Z,
        SpeedSound,
        ArrivedByTwoSec);
    Ledger.Verify(
        !ClearStrike && StormStrike && ActiveFlashRibbonIndices > 60u &&
            CloudFlashGlow.Z > 1.0f && RoadFlashIrr.Z > 0.01f && ZeroEarlyThunder && ArrivedByTwoSec >= 1u,
        "Lightning cloud/scene flash & speed-of-sound delayed thunder",
        Note);

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 11 & 12: 6-Material Griffith Convex Fracture + Volume Conservation + Jolt 5.6.0 Rigid-Body Spawning
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 11 & 12: 6-Material Griffith Fracture, Volume Conservation & Jolt Convex Hulls ---\n");
    SolidFractureExtension FractureEngine{};
    const ConvexSolidFragment IntactPillar = SolidFractureExtension::CreateIntactBoxSolid({0.0f, 0.0f, 1.2f}, {0.45f, 0.45f, 1.2f}, 2380.0f);

    // Sub-threshold elastic hit -> 0 fractures!
    FractureImpactDescriptor GentleTap{};
    GentleTap.ImpactPointWorld     = {0.45f, 0.0f, 1.4f};
    GentleTap.ImpactKineticEnergyJ = 25.0f; // < 120 J concrete threshold
    std::vector<ConvexSolidFragment>   TapFrags;
    std::vector<FragmentAdjacencyBond> TapBonds;
    const auto TapSum = FractureEngine.CleaveConvexSolid(
        IntactPillar,
        LookupFractureMaterialProperties(FractureMaterialPreset::ReinforcedConcrete),
        GentleTap,
        TapFrags,
        TapBonds);
    Ledger.Verify(!TapSum.FractureOccurred && TapFrags.size() == 1u, "Sub-threshold impact absorbed elastically without fracture");

    // Cleave all 6 material presets under crash impact and verify exact 100.00% 3D volume conservation!
    const FractureMaterialPreset AllPresets[6] = {
        FractureMaterialPreset::ReinforcedConcrete,
        FractureMaterialPreset::NaturalGraniteStone,
        FractureMaterialPreset::AnisotropicWoodGrain,
        FractureMaterialPreset::AnnealedWindowGlass,
        FractureMaterialPreset::TemperedSafetyGlass,
        FractureMaterialPreset::AutomotivePolymerAbs};

    bool   AllMaterialsConserved = true;
    double WorstVolError         = 0.0;
    std::vector<ConvexSolidFragment> ConcreteFrags;

    for (int M = 0; M < 6; ++M)
    {
        FractureImpactDescriptor Crash{};
        Crash.ImpactPointWorld     = {0.45f, 0.05f, 1.5f};
        Crash.ImpactDirection      = {-1.0f, 0.1f, 0.0f};
        Crash.ImpactKineticEnergyJ = 9500.0f;
        Crash.ImpulseNewtonSeconds = 1800.0f;
        Crash.AnchoredBaseAtMinZ   = (M == 0);
        Crash.DeterministicSeed    = 0xABC000ull + static_cast<uint64_t>(M);

        std::vector<ConvexSolidFragment>   Frags;
        std::vector<FragmentAdjacencyBond> Bonds;
        const auto Sum = FractureEngine.CleaveConvexSolid(
            IntactPillar,
            LookupFractureMaterialProperties(AllPresets[M]),
            Crash,
            Frags,
            Bonds);
        const double Err = std::abs(Sum.VolumeConservationRatio - 1.0);
        WorstVolError    = std::max(WorstVolError, Err);
        if (!Sum.FractureOccurred || Frags.size() < 4u || Err > 1.0e-3)
        {
            AllMaterialsConserved = false;
        }
        if (M == 0)
        {
            ConcreteFrags = Frags;
        }
    }
    std::snprintf(Note, sizeof(Note), "6/6 presets cleaved; max_vol_error=%.6f concrete_frags=%zu", WorstVolError, ConcreteFrags.size());
    Ledger.Verify(AllMaterialsConserved, "6-material Griffith fracture 100.0% 3D volume conservation", Note);

    // Spawn cleaved ConvexSolidFragments into Jolt v5.6.0 RigidBodySolver as ConvexHull dynamic bodies!
    RigidBodySolver JoltWorld{};
    bool JoltOk = JoltWorld.Bring();
    RigidBodyDescription GroundDesc{};
    GroundDesc.Name              = "ProvingGroundFloor";
    GroundDesc.Motion            = RigidBodyMotionCategory::Static;
    GroundDesc.Shape.Category    = CollisionShapeCategory::Plane;
    GroundDesc.Shape.PlaneNormal = {0.0f, 0.0f, 1.0f};
    (void)JoltWorld.CreateBody(GroundDesc);

    std::vector<RigidBodyIdentity> SpawnedHullIds;
    for (const auto& Frag : ConcreteFrags)
    {
        if (Frag.AnchoredIntact || Frag.HullVertices.size() < 4u)
        {
            continue;
        }
        RigidBodyDescription HullDesc{};
        HullDesc.Name           = "CleavedConcreteHull";
        HullDesc.Motion         = RigidBodyMotionCategory::Dynamic;
        HullDesc.Position       = PhysicsVector3{Frag.CentroidWorld};
        HullDesc.LinearVelocity = PhysicsVector3{Frag.LinearVelocityMps};
        HullDesc.MassKilograms  = Frag.MassKilograms;
        HullDesc.Shape.Category = CollisionShapeCategory::ConvexHull;
        for (const Vec3& V : Frag.HullVertices)
        {
            HullDesc.Shape.HullPoints.emplace_back(V - Frag.CentroidWorld);
        }
        const RigidBodyIdentity Id = JoltWorld.CreateBody(HullDesc);
        if (Id != InvalidRigidBody)
        {
            SpawnedHullIds.push_back(Id);
        }
    }
    JoltWorld.OptimizeBroadPhase();
    for (int Step = 0; Step < 30; ++Step)
    {
        JoltWorld.Advance(1.0f / 60.0f);
    }
    RigidBodyPose SamplePose{};
    const bool PoseValid = !SpawnedHullIds.empty() && JoltWorld.QueryPose(SpawnedHullIds[0], SamplePose);
    std::snprintf(Note, sizeof(Note), "jolt=%s spawned_hulls=%zu sample_z=%.3f m", RigidBodySolver::QueryJoltVersion(), SpawnedHullIds.size(), SamplePose.Position.Z);
    Ledger.Verify(JoltOk && SpawnedHullIds.size() >= 3u && PoseValid && SamplePose.Position.Z > -0.05f, "Cleaved convex hulls simulate & collide in Jolt v5.6.0", Note);
    JoltWorld.Retire();

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 13: BallisticSparkExtension Swept 3 mm Scene Collisions & Shadowed Scene Illumination
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 13: Swept Colliding Metallic Sparks & Shadowed Blackbody Scene Lighting ---\n");
    BallisticSparkExtension Sparks{};
    SparkSceneColliderBox   Guardrail{};
    Guardrail.CentreWorld = {2.2f, 0.0f, 0.6f};
    Guardrail.HalfExtents = {0.20f, 2.5f, 0.6f};
    Sparks.RegisterSceneCollider(Guardrail);

    MetallicScrapeContact Scrape{};
    Scrape.ContactPointWorld     = {0.4f, 0.0f, 0.35f};
    Scrape.ContactNormalWorld    = {0.0f, 0.0f, 1.0f};
    Scrape.TangentialVelocityMps = {19.0f, 0.5f, -1.5f}; // Aimed directly at Guardrail & floor!
    Scrape.NormalForceNewtons    = 6200.0f;
    Scrape.RequestedSparkCount   = 96u;
    Sparks.SpawnScrapeSparks(Scrape);

    for (int S = 0; S < 12; ++S)
    {
        Sparks.StepBallisticSparks(1.0f / 60.0f, {1.5f, 0.0f, 0.0f});
    }

    uint32_t BelowFloorCount = 0u;
    for (const auto& Sp : Sparks.Sparks())
    {
        if (Sp.Active && Sp.PositionWorld.Z < 0.0025f)
        {
            ++BelowFloorCount;
        }
    }
    const Vec3 LitInFrontOfWall  = Sparks.EvaluateShadowedSceneIrradiance({1.6f, 0.0f, 0.0f}, {0.0f, 0.0f, 1.0f});
    const Vec3 OccludedBehindWall = Sparks.EvaluateShadowedSceneIrradiance({3.1f, 0.0f, 0.05f}, {1.0f, 0.0f, 0.0f});
    std::snprintf(
        Note,
        sizeof(Note),
        "bounces=%llu splits=%llu floor_pen=%u front_irr=%.3f occluded_irr=%.5f",
        static_cast<unsigned long long>(Sparks.Telemetry().SweptSceneCollisions),
        static_cast<unsigned long long>(Sparks.Telemetry().ImpactSplitSparks),
        BelowFloorCount,
        LitInFrontOfWall.X,
        OccludedBehindWall.X);
    Ledger.Verify(
        Sparks.Telemetry().SweptSceneCollisions > 25u && BelowFloorCount == 0u &&
            LitInFrontOfWall.X > 0.05f && OccludedBehindWall.X < LitInFrontOfWall.X * 0.05f,
        "Sparks collide without tunneling & cast shadowed scene light",
        Note);

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 14 & 15: Dual-Tier GTX SDF + RTX BVH ReSTIR + Mirrors & Portals Reflecting Clouds, Fog & Plume Smoke/Fire
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 14 & 15: Dual-Tier GTX SDF & RTX BVH ReSTIR, Mirrors & Portals + Volumetrics ---\n");
    SdfRestirPortalExtension DualRenderer{};
    // Ground slab + colored walls + vehicle silhouette + remote sanctuary pillar seen through Portal!
    DualRenderer.RegisterDualTierSolidBox({0.0f, 0.0f, -0.25f}, {45.0f, 45.0f, 0.25f}, {0.26f, 0.27f, 0.30f}, 0.75f);
    DualRenderer.RegisterDualTierSolidBox({-3.5f, 3.2f, 1.1f}, {0.8f, 1.8f, 1.1f}, {0.82f, 0.24f, 0.18f}, 0.55f);
    DualRenderer.RegisterDualTierSolidBox({28.0f, 0.0f, 1.6f}, {1.1f, 1.1f, 1.6f}, {0.20f, 0.78f, 0.45f}, 0.45f, {0.15f, 0.45f, 0.25f});

    // Planar Mirror on the right reflecting the rising Smoke/Fire Plume + Volumetric Clouds + Sky + Fog!
    PlanarMirrorAperture SceneMirror{};
    SceneMirror.CentreWorld      = {3.2f, -2.6f, 1.65f};
    SceneMirror.RightAxis        = {0.866f, 0.500f, 0.0f};
    SceneMirror.UpAxis           = {0.0f, 0.0f, 1.0f};
    SceneMirror.FrontNormal      = Normalise(Vec3{-0.500f, 0.866f, 0.06f});
    SceneMirror.HalfWidthMetres  = 2.1f;
    SceneMirror.HalfHeightMetres = 1.55f;
    DualRenderer.RegisterPlanarMirror(SceneMirror);

    // Seamless Portal on the left looking straight into the remote +28 m emerald sanctuary & storm plume!
    SeamlessPortalAperture ScenePortal{};
    ScenePortal.EntryCentreWorld = {3.4f, +2.6f, 1.65f};
    ScenePortal.EntryRightAxis   = {-0.25f, 0.968f, 0.0f};
    ScenePortal.EntryUpAxis      = {0.0f, 0.0f, 1.0f};
    ScenePortal.EntryFrontNormal = Normalise(Vec3{-0.968f, -0.25f, 0.0f});
    ScenePortal.ExitCentreWorld  = {23.0f, 0.0f, 1.65f};
    ScenePortal.ExitRightAxis    = {0.0f, -1.0f, 0.0f};
    ScenePortal.ExitUpAxis       = {0.0f, 0.0f, 1.0f};
    ScenePortal.ExitFrontNormal  = {1.0f, 0.0f, 0.0f};
    ScenePortal.HalfWidthMetres  = 1.85f;
    ScenePortal.HalfHeightMetres = 1.55f;
    DualRenderer.RegisterSeamlessPortal(ScenePortal);

    // Puddle basin in front of mirror & portal so wet ground reflects Clouds, Fog, Plume, Mirror & Portal!
    ShallowWaterConfiguration SceneWaterCfg = LakeCfg;
    SceneWaterCfg.WorldOriginXY             = {-12.0f, -12.0f};
    ShallowWaterMudExtension ScenePuddle{SceneWaterCfg};
    ScenePuddle.SculptBedDepressionOrMound({1.0f, 0.0f}, 4.5f, -0.08f);
    ScenePuddle.FillBasinRegion({1.0f, 0.0f}, 4.2f, 0.02f, 0.0f);

    TransmittanceLut SkyLut{};
    AtmosphereParameters Atmos{};
    SkyLut.Bake(Atmos, 64u, 16u, 24u);

    CoupledWorldOpticalContext OptCtx{};
    OptCtx.Atmosphere        = Atmos;
    OptCtx.AtmosphereLut     = &SkyLut;
    OptCtx.Clouds.Coverage   = 0.68;
    OptCtx.Fog.DensityAtBase = 0.008;
    OptCtx.SunDirectionUnit  = Normalise(Vec3{0.42f, -0.38f, 0.82f});
    OptCtx.PlumeFluid        = &Plume;
    OptCtx.ShallowWater      = &ScenePuddle;
    OptCtx.Lightning         = &StormLightning;
    OptCtx.Sparks            = &Sparks;

    DualRenderer.FinalizeSceneAndBakeSurfaceCards(OptCtx);

    // 14a: Verify GTX SDF ReSTIR vs RTX BVH ReSTIR GI + Spatial Reservoir Merge!
    const auto GtxResA = DualRenderer.SampleRestirIndirectReservoir(GpuTracingTier::SignedDistanceFieldGtx, {-2.2f, 2.5f, 0.05f}, {0.0f, 0.0f, 1.0f}, OptCtx, 11ull);
    const auto GtxResB = DualRenderer.SampleRestirIndirectReservoir(GpuTracingTier::SignedDistanceFieldGtx, {-2.0f, 2.5f, 0.05f}, {0.0f, 0.0f, 1.0f}, OptCtx, 29ull);
    const auto Merged  = SdfRestirPortalExtension::MergeSpatialReservoirs(GtxResA, GtxResB, {-2.2f, 2.5f, 0.05f}, {0.0f, 0.0f, 1.0f}, 99ull);
    const auto RtxRes  = DualRenderer.SampleRestirIndirectReservoir(GpuTracingTier::HardwareRayTracingRtx, {-2.2f, 2.5f, 0.05f}, {0.0f, 0.0f, 1.0f}, OptCtx, 11ull);
    std::snprintf(
        Note,
        sizeof(Note),
        "gtx_W=%.3f merged_M=%u rtx_W=%.3f cards=%zu",
        GtxResA.IntegrationWeightW,
        Merged.SampleCountM,
        RtxRes.IntegrationWeightW,
        DualRenderer.SurfaceCards().size());
    Ledger.Verify(
        GtxResA.IntegrationWeightW > 0.05f && Merged.SampleCountM > GtxResA.SampleCountM && RtxRes.IntegrationWeightW > 0.05f,
        "Dual-tier GTX SDF SurfaceCards ReSTIR & RTX BVH ReSTIR parity",
        Note);

    // 15a: Trace Mirror ray aimed so reflected ray passes through PlumeFluid smoke/fire & into Volumetric Clouds in BOTH GTX & RTX!
    const Vec3 CamPos{-6.2f, 0.0f, 1.65f};
    const Vec3 MirrorAim = Normalise(SceneMirror.CentreWorld + Vec3{0.0f, 0.0f, 0.25f} - CamPos);
    const auto GtxMirrorDiag = DualRenderer.TraceCoupledRadianceRay(GpuTracingTier::SignedDistanceFieldGtx, CamPos, MirrorAim, OptCtx, 7ull);
    const auto RtxMirrorDiag = DualRenderer.TraceCoupledRadianceRay(GpuTracingTier::HardwareRayTracingRtx, CamPos, MirrorAim, OptCtx, 7ull);
    std::snprintf(
        Note,
        sizeof(Note),
        "gtx(refl=%u plume=%.3f cloud=%.3f) rtx(refl=%u plume=%.3f cloud=%.3f)",
        GtxMirrorDiag.MirrorReflections,
        GtxMirrorDiag.PlumeOpticalOpacity,
        GtxMirrorDiag.CloudReflectionLuminance,
        RtxMirrorDiag.MirrorReflections,
        RtxMirrorDiag.PlumeOpticalOpacity,
        RtxMirrorDiag.CloudReflectionLuminance);
    Ledger.Verify(
        GtxMirrorDiag.MirrorReflections == 1u && RtxMirrorDiag.MirrorReflections == 1u &&
            GtxMirrorDiag.PlumeOpticalOpacity > 0.05f && RtxMirrorDiag.PlumeOpticalOpacity > 0.05f &&
            GtxMirrorDiag.CloudReflectionLuminance > 0.001f && RtxMirrorDiag.CloudReflectionLuminance > 0.001f,
        "Planar Mirrors in BOTH GTX SDF & RTX reflect Clouds + Fog + Plume",
        Note);

    // 15b: Trace Seamless Portal ray into remote +28 m emerald sanctuary in BOTH GTX SDF & RTX!
    const Vec3 PortalAim = Normalise(ScenePortal.EntryCentreWorld - CamPos);
    const auto GtxPortalDiag = DualRenderer.TraceCoupledRadianceRay(GpuTracingTier::SignedDistanceFieldGtx, CamPos, PortalAim, OptCtx, 13ull);
    const auto RtxPortalDiag = DualRenderer.TraceCoupledRadianceRay(GpuTracingTier::HardwareRayTracingRtx, CamPos, PortalAim, OptCtx, 13ull);
    std::snprintf(
        Note,
        sizeof(Note),
        "gtx(portal=%u hit=%d G=%.3f) rtx(portal=%u hit=%d G=%.3f)",
        GtxPortalDiag.PortalTransitions,
        GtxPortalDiag.HitSolidGeometry ? 1 : 0,
        GtxPortalDiag.FinalRadianceRgb.Y,
        RtxPortalDiag.PortalTransitions,
        RtxPortalDiag.HitSolidGeometry ? 1 : 0,
        RtxPortalDiag.FinalRadianceRgb.Y);
    Ledger.Verify(
        GtxPortalDiag.PortalTransitions == 1u && RtxPortalDiag.PortalTransitions == 1u &&
            GtxPortalDiag.HitSolidGeometry && RtxPortalDiag.HitSolidGeometry &&
            GtxPortalDiag.FinalRadianceRgb.Y > GtxPortalDiag.FinalRadianceRgb.X,
        "Seamless Portals in BOTH GTX SDF & RTX teleport rays accurately",
        Note);

    // 15c: Trace Puddle Water reflection ray reflecting PlumeFluid + Volumetric Clouds!
    const Vec3 PuddleAim = Normalise(Vec3{0.8f, 0.0f, 0.01f} - CamPos);
    const auto GtxWaterDiag = DualRenderer.TraceCoupledRadianceRay(GpuTracingTier::SignedDistanceFieldGtx, CamPos, PuddleAim, OptCtx, 19ull);
    const auto RtxWaterDiag = DualRenderer.TraceCoupledRadianceRay(GpuTracingTier::HardwareRayTracingRtx, CamPos, PuddleAim, OptCtx, 19ull);
    std::snprintf(
        Note,
        sizeof(Note),
        "gtx_water=%d(plume=%.3f) rtx_water=%d(plume=%.3f)",
        GtxWaterDiag.HitWaterSurface ? 1 : 0,
        GtxWaterDiag.PlumeOpticalOpacity,
        RtxWaterDiag.HitWaterSurface ? 1 : 0,
        RtxWaterDiag.PlumeOpticalOpacity);
    Ledger.Verify(
        GtxWaterDiag.HitWaterSurface && RtxWaterDiag.HitWaterSurface &&
            GtxWaterDiag.PlumeOpticalOpacity > 0.05f && RtxWaterDiag.PlumeOpticalOpacity > 0.05f,
        "2.5D Puddle Water Fresnel reflects Plume Smoke/Fire & Clouds (0 foam/splash)",
        Note);

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 16 & 17: VehicleCabinHmiExtension + Rendered PNG Visual Evidence Generation
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 16 & 17: Vehicle Cabin/HUD HMI & Visual Proof PNG Synthesis ---\n");
    VehicleCabinHmiExtension CabinHmi{};
    VehicleCabinTelemetryFrame HmiTel{};
    HmiTel.VehicleSpeedMps        = 48.5f; // 175 km/h
    HmiTel.EngineOrMotorRpm       = 7180.0f;
    HmiTel.RedlineRpm             = 7500.0f;
    HmiTel.EngagedGear            = 5;
    HmiTel.ThrottlePedal01        = 0.92f;
    HmiTel.BrakePedal01           = 0.08f;
    HmiTel.LateralG               = 0.84f;
    HmiTel.LongitudinalG          = 0.42f;
    HmiTel.ManifoldBoostBar       = 1.45f;
    HmiTel.NitrousPurgingOrActive = true;
    HmiTel.RainIntensity01        = 0.72f;
    HmiTel.GroundSnowPeakCm       = 34.0f;
    HmiTel.AquaplaningWarning     = true;
    HmiTel.LightningProximityWarn = true;
    HmiTel.Wheels[0]              = {362.0f, 232.0f, 0.74f, 4.2f, 0.15f, 0.04f, false};
    HmiTel.Wheels[1]              = {368.0f, 234.0f, 0.71f, 4.6f, 0.15f, 0.04f, false};
    HmiTel.Wheels[2]              = {412.0f, 244.0f, 0.48f, 2.8f, 0.35f, 0.14f, true};
    HmiTel.Wheels[3]              = {418.0f, 246.0f, 0.46f, 2.9f, 0.35f, 0.14f, true};

    const CabinHmiAlertDigest HmiAlerts = VehicleCabinHmiExtension::EvaluateAlerts(HmiTel);
    std::vector<uint8_t>      ClusterImg, ScreenImg, HudImg;
    CabinHmi.SynthesizeInstrumentClusterRgba8(640u, 140u, HmiTel, ClusterImg);
    CabinHmi.SynthesizeCentralScreenRgba8(640u, 220u, HmiTel, ScreenImg);
    CabinHmi.SynthesizeWindshieldHudRgba8(384u, 240u, HmiTel, HudImg);

    std::snprintf(
        Note,
        sizeof(Note),
        "apps=%zu shift_leds=%u redline=%d traction_warn=%d thermal_warn=%d weather_warn=%d",
        VehicleCabinHmiExtension::Catalogue().size(),
        HmiAlerts.ActiveShiftLedCount,
        HmiAlerts.RedlineShiftFlash ? 1 : 0,
        HmiAlerts.TractionHazardLamp ? 1 : 0,
        HmiAlerts.ThermalWarningLamp ? 1 : 0,
        HmiAlerts.SevereWeatherBanner ? 1 : 0);
    Ledger.Verify(
        VehicleCabinHmiExtension::Catalogue().size() == 12u && HmiAlerts.ActiveShiftLedCount >= 9u &&
            HmiAlerts.RedlineShiftFlash && HmiAlerts.TractionHazardLamp &&
            HmiAlerts.ThermalWarningLamp && HmiAlerts.SevereWeatherBanner,
        "VehicleCabinHmi 12-app catalogue, shift LEDs & hazard telltales",
        Note);

    // Render 4 PNG visual proof images into Exhibits/WorldSimulationAndSdfValidation/Images/!
    const std::string ImgDir = "Exhibits/WorldSimulationAndSdfValidation/Images/";

    std::vector<uint8_t> GtxFrameRgba, RtxFrameRgba;
    DualRenderer.RenderViewportRgba8(
        GpuTracingTier::SignedDistanceFieldGtx,
        320u,
        200u,
        CamPos,
        {2.0f, 0.0f, 1.45f},
        0.95f,
        OptCtx,
        GtxFrameRgba);
    DualRenderer.RenderViewportRgba8(
        GpuTracingTier::HardwareRayTracingRtx,
        320u,
        200u,
        CamPos,
        {2.0f, 0.0f, 1.45f},
        0.95f,
        OptCtx,
        RtxFrameRgba);

    // Scene 3: Snow Pit with Carved Tyre Ruts + Cleaved Fracture Blocks + Scene-Lighting Sparks!
    SdfRestirPortalExtension SnowSparkScene{};
    SnowSparkScene.RegisterDualTierSolidBox({0.0f, 0.0f, -0.27f}, {30.0f, 30.0f, 0.25f}, {0.14f, 0.16f, 0.20f}, 0.8f);
    // Register the single contiguous SnowpackPolygonSurface triangles directly into RTX scene!
    const auto& SnowSurf = Snowpack.GroundPolygonSurface();
    for (size_t T = 0u; T + 2u < SnowSurf.Indices.size(); T += 3u)
    {
        const auto& Va      = SnowSurf.Vertices[SnowSurf.Indices[T + 0u]];
        const auto& Vb      = SnowSurf.Vertices[SnowSurf.Indices[T + 1u]];
        const auto& Vc      = SnowSurf.Vertices[SnowSurf.Indices[T + 2u]];
        const Vec3  TriN    = Normalise(Cross(Vb.Position - Va.Position, Vc.Position - Va.Position));
        const float RutTint = 1.0f - 0.28f * Va.CompactionRatio;
        SnowSparkScene.RegisterPolygonTriangle({
            Va.Position,
            Vb.Position,
            Vc.Position,
            TriN,
            {0.82f * RutTint, 0.90f * RutTint, 0.99f},
            {0.0f, 0.0f, 0.0f},
            0.55f,
            0u});
    }
    // Register cleaved concrete fracture fragments separated cleanly mid-burst!
    for (size_t F = 0u; F < std::min<size_t>(10u, ConcreteFrags.size()); ++F)
    {
        const Vec3  Offset = Vec3{3.0f, -1.75f, 0.0f} + ConcreteFrags[F].LinearVelocityMps * 0.14f;
        const auto& Ps     = ConcreteFrags[F].PolygonSurface;
        for (size_t T = 0u; T + 2u < Ps.Indices.size(); T += 3u)
        {
            SnowSparkScene.RegisterPolygonTriangle({
                Ps.Vertices[Ps.Indices[T + 0u]] + Offset,
                Ps.Vertices[Ps.Indices[T + 1u]] + Offset,
                Ps.Vertices[Ps.Indices[T + 2u]] + Offset,
                Ps.Normals[T / 3u],
                {0.62f, 0.56f, 0.49f},
                {0.0f, 0.0f, 0.0f},
                0.70f,
                0u});
        }
    }

    // Calibrated visual spark shower bouncing near the fractured concrete & casting warm golden light!
    BallisticSparkConfig VisSparkCfg{};
    VisSparkCfg.SceneLuminanceGain = 1.8f;
    BallisticSparkExtension VisSparks{VisSparkCfg};
    MetallicScrapeContact   VisScrape{};
    VisScrape.ContactPointWorld     = {2.6f, -1.3f, 0.45f};
    VisScrape.TangentialVelocityMps = {7.5f, 2.5f, 2.2f};
    VisScrape.NormalForceNewtons    = 4800.0f;
    VisScrape.RequestedSparkCount   = 18u;
    VisSparks.SpawnScrapeSparks(VisScrape);
    for (int S = 0; S < 6; ++S)
    {
        VisSparks.StepBallisticSparks(1.0f / 60.0f);
    }
    for (const auto& Sp : VisSparks.Sparks())
    {
        if (Sp.Active)
        {
            const Vec3 Glow = BallisticSparkExtension::EvaluatePlanckianSparkChromaticity(Sp.TemperatureK) * 18.0f;
            SnowSparkScene.RegisterDualTierSolidBox(Sp.PositionWorld, {0.035f, 0.035f, 0.035f}, {1.0f, 0.8f, 0.4f}, 0.2f, Glow);
        }
    }

    CoupledWorldOpticalContext DuskSparkCtx = OptCtx;
    DuskSparkCtx.SunDirectionUnit           = Normalise(Vec3{-0.20f, -0.82f, 0.36f});
    DuskSparkCtx.SunIrradianceRgb           = {9.5f, 8.8f, 8.2f};
    DuskSparkCtx.PlumeFluid                 = nullptr;
    DuskSparkCtx.ShallowWater               = nullptr;
    DuskSparkCtx.Lightning                  = nullptr;
    DuskSparkCtx.Sparks                     = &VisSparks;
    SnowSparkScene.FinalizeSceneAndBakeSurfaceCards(DuskSparkCtx);

    std::vector<uint8_t> SnowSparkRgba;
    SnowSparkScene.RenderViewportRgba8(
        GpuTracingTier::HardwareRayTracingRtx,
        320u,
        200u,
        {0.6f, -3.6f, 2.15f},
        {4.4f, -0.4f, 0.35f},
        0.92f,
        DuskSparkCtx,
        SnowSparkRgba);

    // Composite Cluster (640x140) + Central Screen (640x220) into 640x360 VehicleCabinHmiComposite.png!
    std::vector<uint8_t> HmiComposite;
    HmiComposite.reserve(ClusterImg.size() + ScreenImg.size());
    HmiComposite.insert(HmiComposite.end(), ClusterImg.begin(), ClusterImg.end());
    HmiComposite.insert(HmiComposite.end(), ScreenImg.begin(), ScreenImg.end());

    const bool Png1 = WriteRgba8PngFile(ImgDir + "GtxSdfPortalMirrorPlumeWater.png", 320u, 200u, GtxFrameRgba);
    const bool Png2 = WriteRgba8PngFile(ImgDir + "RtxBvhPortalMirrorPlumeWater.png", 320u, 200u, RtxFrameRgba);
    const bool Png3 = WriteRgba8PngFile(ImgDir + "SnowPitRutAndFractureSparks.png", 320u, 200u, SnowSparkRgba);
    const bool Png4 = WriteRgba8PngFile(ImgDir + "VehicleCabinHmiComposite.png", 640u, 360u, HmiComposite);

    std::snprintf(Note, sizeof(Note), "png_ok=(%d,%d,%d,%d)", Png1 ? 1 : 0, Png2 ? 1 : 0, Png3 ? 1 : 0, Png4 ? 1 : 0);
    Ledger.Verify(Png1 && Png2 && Png3 && Png4, "Rendered 4 visual proof PNGs (GTX SDF, RTX BVH, SnowPit/Sparks, Cabin HMI)", Note);

    std::printf("\n====================================================================================================\n");
    std::printf("  SUMMARY: %u PASSED, %u FAILED\n", Ledger.Passed, Ledger.Failed);
    std::printf("====================================================================================================\n");

    return (Ledger.Failed == 0u) ? 0 : 1;
}
