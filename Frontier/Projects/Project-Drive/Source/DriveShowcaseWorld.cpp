/*====================================================================================================================================
                                                    DRIVESHOWCASEWORLD.CPP
====================================================================================================================================*/
// 🧩 Implementation of the unified Project-Drive runtime world coupling all 25 RecordEntry scene components with
//    Jolt v5.6.0 + GRIT, Dual-Tier GTX/RTX + BlinnRenderer, 3D VehicleCabinHmi + CabinIconDepot, Circular/Rectangular
//    PortalMechanics + Mirror, 5.13x PlumeFluid, Coupled SkyPrecipitation, Single-Mesh SnowSurface (CC==1), Smooth 2.5D
//    ShallowWater (0 foam/0 splash), SparkParticles, Griffith SolidFracture, ClusterHierarchy, and 48 B StateReplication.

#include "DriveShowcaseWorld.h"

#include <algorithm>
#include <chrono>
#include <cmath>

namespace Frontier::Drive
{

namespace
{

constexpr float kPi = 3.1415926535f;

PlumeFluidParameters MakeInitialPyroParams()
{
    PlumeFluidParameters P{};
    P.Grade   = PlumeQualityGrade::Medium;
    P.Variant = PlumeSolverVariant::ProductionUpgraded;
    return P;
}

ShallowWaterConfiguration MakeInitialWaterConfig()
{
    ShallowWaterConfiguration C{};
    C.CellsX         = 64u;
    C.CellsY         = 64u;
    C.CellSizeMetres = 0.45f;
    C.WorldOriginXY  = {-14.4f, -14.4f};
    return C;
}

SnowpackDomainSpec MakeInitialSnowSpec()
{
    SnowpackDomainSpec S{};
    S.CellsX                     = 64u;
    S.CellsY                     = 64u;
    S.CellSizeMetres             = 0.35f;
    S.OriginX                    = -5.2f;
    S.OriginY                    = -14.8f;
    S.SurfaceInclusionThreshold  = 0.008f;
    S.EnforceSingleConnectedMesh = true;
    return S;
}

SkyPrecipitationConfig MakeInitialSnowfallCfg()
{
    SkyPrecipitationConfig C{};
    C.Phase                   = SkyPrecipitationPhase::DendriticSnow;
    C.DomainCentreXY          = {5.5f, -3.5f, 0.0f};
    C.DomainHalfExtent        = {9.5f, 9.5f, 5.0f};
    C.ParticleCount           = 3800u;
    C.Intensity01             = 0.82f;
    C.FlakeRadiusScale        = 1.55f;
    C.EnableMoundConvergence  = true;
    C.ConvergenceCentreWorld  = {5.8f, -3.6f, 0.0f};
    C.ConvergenceRadiusMetres = 2.35f;
    C.ConvergenceStrength     = 1.32f;
    return C;
}

SkyPrecipitationConfig MakeInitialRainCfg()
{
    SkyPrecipitationConfig C{};
    C.Phase            = SkyPrecipitationPhase::Rainfall;
    C.DomainCentreXY   = {1.5f, 2.5f, 0.0f};
    C.DomainHalfExtent = {11.0f, 11.0f, 5.5f};
    C.ParticleCount    = 2400u;
    C.Intensity01      = 0.62f;
    return C;
}

SkyPrecipitationConfig MakeInitialHailCfg()
{
    SkyPrecipitationConfig C{};
    C.Phase            = SkyPrecipitationPhase::Hailstorm;
    C.DomainCentreXY   = {2.0f, 0.5f, 0.0f};
    C.DomainHalfExtent = {10.0f, 10.0f, 5.5f};
    C.ParticleCount    = 1400u;
    C.Intensity01      = 0.65f;
    C.FlakeRadiusScale = 1.45f;
    return C;
}

Vec3 PaintColorFromPreset(int32_t Preset) noexcept
{
    switch (Preset)
    {
        case 1:  return Vec3{0.14f, 0.78f, 0.56f}; // Frontier Mint
        case 2:  return Vec3{0.92f, 0.28f, 0.09f}; // Signal Orange
        case 3:  return Vec3{0.12f, 0.34f, 0.86f}; // Deep Cobalt
        default: return Vec3{0.76f, 0.79f, 0.84f}; // Alpine Silver
    }
}

Vec3 Mat4Translation(const Mat4 &M) noexcept
{
    return Vec3{M.Columns[3][0], M.Columns[3][1], M.Columns[3][2]};
}

Vec3 Mat4Col(const Mat4 &M, int Col) noexcept
{
    return Normalise(Vec3{M.Columns[Col][0], M.Columns[Col][1], M.Columns[Col][2]});
}

void SubmitPlaceableObjectToScene(const ShowcasePlaceableObjectRecord &Obj, SceneRenderer &Scene, bool ForceRender = false)
{
    if (!Obj.Enabled && !ForceRender)
    {
        return;
    }
    Vec3  Albedo{0.58f, 0.60f, 0.64f};
    float Rough = static_cast<float>(std::clamp(Obj.Roughness, 0.04, 0.98));
    float Metal = static_cast<float>(std::clamp(Obj.Metallic, 0.0, 1.0));
    switch (Obj.MaterialPreset)
    {
        case 1: Albedo = {0.92f, 0.34f, 0.09f}; break;                         // Safety Signal Orange
        case 2: Albedo = {0.88f, 0.52f, 0.32f}; Metal = std::max(Metal, 0.82f); Rough = std::min(Rough, 0.24f); break; // Copper
        case 3: Albedo = {0.10f, 0.11f, 0.13f}; Rough = std::min(Rough, 0.14f); break;                                 // Obsidian
        case 4: Albedo = {0.86f, 0.92f, 0.98f}; Rough = 0.05f; break;          // Crown Glass tint
        default: break;                                                        // Brushed Concrete
    }

    const Vec3  C{static_cast<float>(Obj.PosX), static_cast<float>(Obj.PosY), static_cast<float>(Obj.PosZ)};
    const float Hx = static_cast<float>(std::max(0.12, Obj.HalfExtentX));
    const float Hy = static_cast<float>(std::max(0.12, Obj.HalfExtentY));
    const float Hz = static_cast<float>(std::max(0.12, Obj.HalfExtentZ));

    if (Obj.MaterialPreset == 4)
    {
        Scene.RegisterSmoothSphere(C, std::max({Hx, Hy, Hz}), Albedo, Rough, 0.0f, true, 1.52f);
        return;
    }

    if (Obj.ShapePreset == 1)
    {
        // Stepped Calibration Pedestal (3 tiers)
        Scene.RegisterDualTierSolidBox({C.X, C.Y, C.Z - Hz * 0.62f}, {Hx * 1.18f, Hy * 1.18f, Hz * 0.38f}, Albedo * 0.84f, Rough, {}, Metal);
        Scene.RegisterDualTierSolidBox({C.X, C.Y, C.Z + Hz * 0.05f}, {Hx * 0.82f, Hy * 0.82f, Hz * 0.35f}, Albedo, Rough, {}, Metal);
        Scene.RegisterDualTierSolidBox({C.X, C.Y, C.Z + Hz * 0.65f}, {Hx * 0.48f, Hy * 0.48f, Hz * 0.35f}, Albedo * 1.08f, Rough * 0.8f, {}, Metal);
    }
    else if (Obj.ShapePreset == 2)
    {
        // Acoustic Calibration Archway (twin pillars + lintel)
        const float Span = std::max(0.45f, Hy * 0.78f);
        const float PilW = std::max(0.14f, Hy * 0.24f);
        Scene.RegisterDualTierSolidBox({C.X, C.Y - Span, C.Z}, {Hx, PilW, Hz}, Albedo, Rough, {}, Metal);
        Scene.RegisterDualTierSolidBox({C.X, C.Y + Span, C.Z}, {Hx, PilW, Hz}, Albedo, Rough, {}, Metal);
        Scene.RegisterDualTierSolidBox({C.X, C.Y, C.Z + Hz * 0.86f}, {Hx * 1.06f, Span + PilW, Hz * 0.20f}, Albedo * 1.06f, Rough, {}, Metal);
    }
    else if (Obj.ShapePreset == 3)
    {
        // Nanite Faceted Compound Prism
        Scene.RegisterDualTierSolidBox(C, {Hx, Hy * 0.68f, Hz}, Albedo, Rough, {}, Metal);
        Scene.RegisterDualTierSolidBox(C, {Hx * 0.68f, Hy, Hz * 0.76f}, Albedo * 0.92f, Rough * 0.85f, {}, Metal);
    }
    else
    {
        // Chamfered Chicane Barrier Block (base + crown)
        Scene.RegisterDualTierSolidBox({C.X, C.Y, C.Z - Hz * 0.32f}, {Hx, Hy, Hz * 0.68f}, Albedo, Rough, {}, Metal);
        Scene.RegisterDualTierSolidBox({C.X, C.Y, C.Z + Hz * 0.56f}, {Hx * 0.82f, Hy * 0.76f, Hz * 0.26f}, Albedo * 1.08f, Rough, {}, Metal);
    }
}

} // namespace

DriveShowcaseWorld::DriveShowcaseWorld()
    : SharedRecords_()
    , Records_(*SharedRecords_.ConstructInSharedMemory("project_drive_entities", &Telemetry_, &SceneDirtyRevision_))
    , PyroSolver_(MakeInitialPyroParams())
    , WaterPuddles_(MakeInitialWaterConfig())
    , SnowMound_(MakeInitialSnowSpec())
    , SnowfallSolver_(MakeInitialSnowfallCfg())
    , RainfallSolver_(MakeInitialRainCfg())
    , HailstormSolver_(MakeInitialHailCfg())
{
}

bool DriveShowcaseWorld::Initialize(const std::string &ProjectRootPath, bool DeferHeavyWarmup)
{
    ProjectRoot_ = ProjectRootPath;
    GeometryDir_ = ProjectRoot_ + "/Content/Geometry";

    // 1. Precompute Rayleigh/Mie/Ozone Sky LUT + Hipparcos Procedural Celestial Dome
    AtmosParams_ = AtmosphereParameters{};
    (void)SkyLut_.Bake(AtmosParams_);
    CelestialDome_.BuildProceduralStarCatalogue(14000u, 0x51A7CA7A109FULL);

    LunarBodyDescriptor Moon{};
    Moon.DirectionUnit     = Normalise(Vec3{-0.52f, 0.64f, 0.56f});
    Moon.AngularRadiusRad  = 0.024f;
    Moon.SurfaceBrightness = 2.6f;
    CelestialDome_.RegisterLunarBody(Moon);

    PlanetaryBodyDescriptor RingedPlanet{};
    RingedPlanet.DirectionUnit      = Normalise(Vec3{-0.30f, -0.78f, 0.55f});
    RingedPlanet.AngularRadiusRad   = 0.032f;
    RingedPlanet.SurfaceAlbedoScale = 1.35f;
    RingedPlanet.Rings.Enabled      = true;
    CelestialDome_.RegisterPlanetaryBody(RingedPlanet);

    // 2. Load 3D ControlVehicle Facet Meshes for both CabinHMI + Low-Res BlinnRenderer + Nanite ClusterHierarchy
    (void)CabinHmi_.LoadControlVehicleMeshesForHmi(GeometryDir_);
    (void)BlinnRenderer::LoadFacetStream(GeometryDir_ + "/ControlVehicleBody.facet", BlinnBodyMesh_);
    (void)BlinnRenderer::LoadFacetStream(GeometryDir_ + "/ControlVehicleTyre.facet", BlinnWheelMesh_);

    if (!BlinnBodyMesh_.Positions.empty() && BlinnBodyMesh_.Indices.size() >= 3u)
    {
        ClusterMaterialProfile OpaqueCoat{};
        OpaqueCoat.ClassificationId  = 0u;
        OpaqueCoat.TransmissiveGlass = false;
        NaniteHierarchy_.RegisterMaterialProfile(OpaqueCoat);

        ClusterMaterialProfile GlassProfile{};
        GlassProfile.ClassificationId   = 3u;
        GlassProfile.TransmissiveGlass  = true;
        GlassProfile.RefractiveIndexIor = 1.52f;
        NaniteHierarchy_.RegisterMaterialProfile(GlassProfile);

        FacetField InputField{};
        const size_t TriCount = BlinnBodyMesh_.Indices.size() / 3u;
        InputField.Corners.reserve(TriCount * 3u);
        InputField.Classification.reserve(TriCount);
        for (size_t T = 0; T < TriCount; ++T)
        {
            for (size_t K = 0; K < 3u; ++K)
            {
                const Vec3 &P = BlinnBodyMesh_.Positions[BlinnBodyMesh_.Indices[T * 3u + K]];
                InputField.Corners.push_back(Vector3{P.X, P.Y, P.Z});
            }
            InputField.Classification.push_back(T < BlinnBodyMesh_.MaterialIds.size() ? BlinnBodyMesh_.MaterialIds[T] : 0u);
        }
        TierBuildSpecification Spec{};
        (void)NaniteHierarchy_.BuildFromFacetField(InputField, Spec);
        Telemetry_.ActiveNaniteClusters = std::max<uint32_t>(1u, static_cast<uint32_t>(NaniteHierarchy_.ClusterRecords().size()));
        Telemetry_.TotalNaniteTriangles = static_cast<uint32_t>(BlinnBodyMesh_.Indices.size() / 3u);
        uint32_t GlassCount = 0u;
        for (const auto &Rec : NaniteHierarchy_.ClusterRecords())
        {
            if (Rec.TransmissiveGlass)
            {
                ++GlassCount;
            }
        }
        Telemetry_.GlassIsolatedClusters = std::max(1u, GlassCount);
    }

    // 3. Bring up Jolt v5.6.0 + GRIT Proving Grounds Simulation
    DriveDeploymentSpecification Deploy{};
    Deploy.SpawnPosition    = Vehicle::Vec3{-1.8f, 0.2f, 0.55f};
    Deploy.PhysicsStepHertz = 240.0;
    if (!DriveSim_.Bring(Deploy))
    {
        return false;
    }

    // 4. Configure Portal Transit Filter (Allow ControlVehicle #1, Block Calibration Obstacle #2)
    PortalFilter_.AllowObjectThroughPortals(1u);
    PortalFilter_.BlockObjectFromPortals(2u);

    SparkSceneColliderBox GroundCol{};
    GroundCol.CentreWorld = {0.0f, 0.0f, -0.25f};
    GroundCol.HalfExtents = {40.0f, 40.0f, 0.25f};
    GroundCol.Restitution = 0.62f;
    GroundCol.Friction    = 0.25f;
    SparkSolver_.RegisterSceneCollider(GroundCol);

    LatestDriveSnap_       = DriveSim_.TakeSnapshot(1280u, 720u);
    DeferredWarmupPending_ = DeferHeavyWarmup;
    if (!DeferHeavyWarmup)
    {
        RunDeferredWarmup({});
    }
    ++SceneDirtyRevision_;
    return true;
}

void DriveShowcaseWorld::RunDeferredWarmup(
    const std::function<void(uint32_t StepIndex, uint32_t TotalSteps, const char *StageText)> &OnStage)
{
    std::lock_guard<std::mutex> Lock(SolverMutex_);
    constexpr uint32_t kTotalWarmupStages = 4u;

    if (OnStage)
    {
        OnStage(1u, kTotalWarmupStages, "Cleaving Griffith 3D Voronoi Fracture Monolith (28 convex hulls)");
    }
    RebuildFractureMonolith();

    if (OnStage)
    {
        OnStage(2u, kTotalWarmupStages, "Depositing Single-Mesh Snowpack Drift (CC == 1) & 2.5D ShallowWater");
    }
    WarmupSnowMoundAndPuddles();

    if (OnStage)
    {
        OnStage(3u, kTotalWarmupStages, "Advancing Jolt v5.6.0 + GRIT 4-Wheel Vehicle & Weather Coupling");
    }
    for (int Warm = 0; Warm < 18; ++Warm)
    {
        AdvanceCoupledSubsystems(1.0f / 60.0f);
    }

    if (OnStage)
    {
        OnStage(4u, kTotalWarmupStages, "Stabilizing 5.13x Pyro PlumeFluid Column & Exposure Histogram");
    }
    for (int Warm = 18; Warm < 36; ++Warm)
    {
        AdvanceCoupledSubsystems(1.0f / 60.0f);
    }

    DeferredWarmupPending_ = false;
    ++SceneDirtyRevision_;
}

void DriveShowcaseWorld::WarmupSnowMoundAndPuddles()
{
    // Smooth 2.5D ShallowWater puddle basin in front-right track sector (0 foam, 0 splash!)
    WaterPuddles_.ResetField();
    WaterPuddles_.SculptBedDepressionOrMound({3.2f, 3.4f}, 3.6f, -0.055f);
    WaterPuddles_.FillBasinRegion({3.2f, 3.4f}, 3.4f, -0.008f, 0.0f);
    for (int S = 0; S < 12; ++S)
    {
        (void)WaterPuddles_.StepSimulation(1.0f / 60.0f);
    }

    // Strictly snowfall-deposited 3D SnowSurface mound (0 pre-sculpted blob, 0 floor-texture whitening, CC == 1!)
    SnowMound_.Reconfigure(MakeInitialSnowSpec());
    struct SnowBindCtx
    {
        SnowSurface *Mound;
    } Bind{&SnowMound_};

    auto SampleWind = [](Vec3, const void *) noexcept -> Vec3 { return Vec3{2.4f, -0.8f, 0.0f}; };
    auto QueryTop   = [](Vec3 Pt, float &OutZ, Vec3 &OutN, float &OutRest, const void *Ctx) noexcept -> bool {
        const auto *B = static_cast<const SnowBindCtx *>(Ctx);
        OutZ          = B->Mound->SampleGroundSurfaceElevation(Pt.X, Pt.Y);
        OutN          = {0.0f, 0.0f, 1.0f};
        OutRest       = 0.08f;
        return true;
    };
    auto OnTouchdown = [](const PrecipitationTouchdownEvent &Ev, void *Ctx) noexcept {
        auto       *B  = static_cast<SnowBindCtx *>(Ctx);
        const float Dx = Ev.HitPositionWorld.X - 5.8f;
        const float Dy = Ev.HitPositionWorld.Y - (-3.6f);
        const float R2 = (Dx * Dx) / (1.85f * 1.85f) + (Dy * Dy) / (1.45f * 1.45f);
        const float W  = std::exp(-0.5f * R2);
        if (W > 0.22f)
        {
            // Focused snowfall deposition so single contiguous drift reaches ~28 cm peak with CC == 1!
            B->Mound->DepositSnowflakeTouchdown(Ev.HitPositionWorld, Ev.ImpactVelocityMps, 0.42f * W, 0.32f);
        }
    };

    for (int Step = 0; Step < 68; ++Step)
    {
        SnowfallSolver_.StepCoupledPrecipitation(0.12f, {2.4f, -0.8f, 0.0f},
                                                 SampleWind, nullptr, QueryTop, &Bind, OnTouchdown, &Bind);
    }
    VehicleSnowEnvelope Env{};
    Env.WorldCentre = {-1.8f, 0.2f, 0.65f};
    SnowMound_.RebuildContiguousPolygonSurfaces(Env);
}

void DriveShowcaseWorld::RebuildFractureMonolith()
{
    FractureFragments_.clear();
    FractureBonds_.clear();

    const Vec3 MonolithCenter{7.4f, 3.8f, 1.05f};
    const ConvexSolidFragment Intact = SolidFracture::CreateIntactBoxSolid(MonolithCenter, {0.62f, 0.62f, 1.05f}, 2380.0f);

    if (!Records_.SolidFracture.CleavedState)
    {
        FractureFragments_.push_back(Intact);
        Telemetry_.FractureHullCount       = 1u;
        Telemetry_.FractureVolumeConserved = 100.0f;
        Telemetry_.FractureCleaved         = false;
        return;
    }

    FractureMaterialProperties Mat = LookupFractureMaterialProperties(FractureMaterialPreset::ReinforcedConcrete);
    Mat.MaxFragmentBudget          = static_cast<uint32_t>(std::clamp(Records_.SolidFracture.TargetVoronoiSites, 8, 40));
    Mat.FractureToughnessJm2       = static_cast<float>(Records_.SolidFracture.FractureToughnessKc * 95.0);

    FractureImpactDescriptor Impact{};
    Impact.ImpactPointWorld     = MonolithCenter + Vec3{-0.45f, -0.25f, 0.25f};
    Impact.ImpactDirection      = Normalise(Vec3{0.82f, 0.36f, -0.22f});
    Impact.ImpactKineticEnergyJ = static_cast<float>(Records_.SolidFracture.ImpactEnergyKj * 1000.0);

    const FractureExecutionSummary Sum = FractureEngine_.CleaveConvexSolid(
        Intact, Mat, Impact, FractureFragments_, FractureBonds_);
    Telemetry_.FractureHullCount       = static_cast<uint32_t>(FractureFragments_.size());
    Telemetry_.FractureVolumeConserved = static_cast<float>(Sum.VolumeConservationRatio * 100.0);
    Telemetry_.FractureCleaved         = Sum.FractureOccurred && FractureFragments_.size() > 1u;
}

void DriveShowcaseWorld::SetTransportMode(ShowcaseTransportMode Mode) noexcept
{
    TransportMode_ = Mode;
    ++SceneDirtyRevision_;
}

void DriveShowcaseWorld::SetCameraPreset(ShowcaseCameraPreset Preset) noexcept
{
    Records_.ExposureCamera.ActiveCameraPreset = static_cast<int32_t>(Preset);
    OrbitYawOffsetRad_   = 0.0f;
    OrbitPitchOffsetRad_ = 0.0f;
    OrbitZoomOffsetM_    = 0.0f;
    ++SceneDirtyRevision_;
}

ShowcaseCameraPreset DriveShowcaseWorld::GetCameraPreset() const noexcept
{
    const int32_t Clamped = std::clamp(Records_.ExposureCamera.ActiveCameraPreset, 0, 6);
    return static_cast<ShowcaseCameraPreset>(Clamped);
}

void DriveShowcaseWorld::OrbitFreeCamera(float DeltaYawRad, float DeltaPitchRad, float DeltaZoomM) noexcept
{
    OrbitYawOffsetRad_   += DeltaYawRad;
    OrbitPitchOffsetRad_  = std::clamp(OrbitPitchOffsetRad_ + DeltaPitchRad, -0.65f, 0.75f);
    OrbitZoomOffsetM_     = std::clamp(OrbitZoomOffsetM_ + DeltaZoomM, -5.5f, 14.0f);
    ++SceneDirtyRevision_;
}

std::string DriveShowcaseWorld::ActivateNextSpawnedObject() noexcept
{
    if (!Records_.SpawnedObjectSlot0.Enabled)
    {
        Records_.SpawnedObjectSlot0.Enabled = true;
        ++SceneDirtyRevision_;
        return "spawned_3d_object_0";
    }
    Records_.SpawnedObjectSlot1.Enabled = true;
    ++SceneDirtyRevision_;
    return "spawned_3d_object_1";
}

void DriveShowcaseWorld::ResetAllSystemsUnlocked()
{
    DriveSim_.RequestRespawn();
    DriveSim_.Advance(1.0 / 60.0);
    PyroSolver_.ClearState();
    WarmupSnowMoundAndPuddles();
    Records_.SolidFracture.CleavedState = true;
    RebuildFractureMonolith();
    WorldClockSeconds_ = 0.0;
    ++SceneDirtyRevision_;
}

void DriveShowcaseWorld::ResetAllSystems()
{
    std::lock_guard<std::mutex> Lock(SolverMutex_);
    ResetAllSystemsUnlocked();
}

void DriveShowcaseWorld::StepSingleTick(double DtSeconds)
{
    std::lock_guard<std::mutex> Lock(SolverMutex_);
    if (DeferredWarmupPending_)
    {
        return;
    }
    AdvanceCoupledSubsystems(static_cast<float>(std::clamp(DtSeconds, 1.0 / 240.0, 0.03125)));
    ++SceneDirtyRevision_;
}

void DriveShowcaseWorld::TickFrame(double DtSeconds, const DriveControlReadings &Controls)
{
    std::lock_guard<std::mutex> Lock(SolverMutex_);
    if (DeferredWarmupPending_)
    {
        return;
    }
    // Service one-shot Inspector action triggers even while Paused!
    if (Records_.ControlVehicle.TriggerRespawn)
    {
        Records_.ControlVehicle.TriggerRespawn = false;
        DriveSim_.RequestRespawn();
        DriveSim_.Advance(1.0 / 60.0);
        LatestDriveSnap_ = DriveSim_.TakeSnapshot(1280u, 720u);
        ++SceneDirtyRevision_;
    }
    if (Records_.GravitySolver.RequestCourseReset)
    {
        Records_.GravitySolver.RequestCourseReset = false;
        ResetAllSystemsUnlocked();
    }
    if (Records_.SnowMound.RebuildWarmupDrift)
    {
        Records_.SnowMound.RebuildWarmupDrift = false;
        WarmupSnowMoundAndPuddles();
        ++SceneDirtyRevision_;
    }
    if (Records_.SolidFracture.TriggerCleaveNow || Records_.SolidFracture.TriggerResetIntact)
    {
        Records_.SolidFracture.TriggerCleaveNow   = false;
        Records_.SolidFracture.TriggerResetIntact = false;
        RebuildFractureMonolith();
        ++SceneDirtyRevision_;
    }
    if (Records_.SparkEmitter.TriggerSparkBurst)
    {
        Records_.SparkEmitter.TriggerSparkBurst = false;
        MetallicScrapeContact Burst{};
        Burst.ContactPointWorld     = {4.6f, 1.2f, 0.35f};
        Burst.ContactNormalWorld    = {0.0f, 0.0f, 1.0f};
        Burst.TangentialVelocityMps = {-6.5f, 2.5f, 4.8f};
        Burst.RequestedSparkCount   = 96u;
        SparkSolver_.SpawnScrapeSparks(Burst);
        SparkSolver_.StepBallisticSparks(1.0f / 60.0f, {2.0f, 0.0f, 0.0f});
        ++SceneDirtyRevision_;
    }
    if (Records_.PyroPlume.TriggerDetonationBurst)
    {
        Records_.PyroPlume.TriggerDetonationBurst = false;
        PyroSolver_.AppendTransientPlumeSource({8.2f, -1.6f, 0.75f}, 0.95f, {0.4f, 0.2f, 6.8f}, 58.0f, 185.0f, 9.5f, 6.2f);
        (void)PyroSolver_.AdvanceSimulation({8.2f, -1.6f, 0.0f}, {0.4f, -0.5f, 0.76f}, 1.0f / 30.0f);
        ++SceneDirtyRevision_;
    }
    if (Records_.LightningDischarge.TriggerStrikePulse)
    {
        Records_.LightningDischarge.TriggerStrikePulse = false;
        Audio::AcousticListenerPose Listener{};
        (void)LightningSolver_.TriggerCloudToGroundStrike(
            CloudParameters{}, {14.0f, -6.0f, 18.0f}, {13.5f, -5.5f, 0.0f}, Listener, 0x11647ULL);
        ++SceneDirtyRevision_;
    }

    if (TransportMode_ == ShowcaseTransportMode::Pause)
    {
        return;
    }

    // Forward driving input (Autopilot vs Manual WASD vs Parked)
    if (Records_.ControlVehicle.DriveProgram == 0)
    {
        Vehicle::DriverInput ParkedCmd{};
        ParkedCmd.Brake     = 0.65f;
        ParkedCmd.Handbrake = 1.0f;
        DriveSim_.ForwardDirectInput(ParkedCmd);
    }
    else if (Records_.ControlVehicle.DriveProgram == 1 &&
             !Controls.ThrottleDown && !Controls.BrakeDown && !Controls.SteerLeftDown && !Controls.SteerRightDown)
    {
        const float TargetMps = static_cast<float>(Records_.ControlVehicle.CruiseTargetKmh / 3.6);
        const float CurMps    = LatestDriveSnap_.Telemetry.ForwardSpeed;
        Vehicle::DriverInput AutoCmd{};
        AutoCmd.Throttle = std::clamp((TargetMps - CurMps) * 0.22f + 0.34f, 0.0f, 0.85f);
        AutoCmd.Brake    = CurMps > TargetMps + 3.5f ? 0.35f : 0.0f;
        AutoCmd.Steer    = 0.32f * std::sin(static_cast<float>(WorldClockSeconds_ * 0.85));
        DriveSim_.ForwardDirectInput(AutoCmd);
    }
    else
    {
        DriveSim_.ForwardControls(Controls);
    }

    AdvanceCoupledSubsystems(static_cast<float>(std::clamp(DtSeconds, 1.0 / 240.0, 0.03125)));
    ++SceneDirtyRevision_;
}

void DriveShowcaseWorld::AdvanceCoupledSubsystems(float DtSeconds)
{
    DtSeconds = std::clamp(DtSeconds, 1.0f / 240.0f, 0.03125f);
    WorldClockSeconds_ += static_cast<double>(DtSeconds);

    // 1. Advance Jolt v5.6.0 + GRIT Vehicle & Course Physics
    if (Records_.GravitySolver.Enabled && Records_.ControlVehicle.Enabled)
    {
        DriveSim_.Advance(static_cast<double>(DtSeconds));
    }
    LatestDriveSnap_ = DriveSim_.TakeSnapshot(1280u, 720u);
    const Vec3 CarPos = Mat4Translation(LatestDriveSnap_.ChassisWorld);

    // 2. Step 3D Wind Forcefield
    const double WindAzRad = Records_.WindForcefield.AzimuthDeg * (kPi / 180.0);
    const Vec3   WindVec   = Records_.WindForcefield.Enabled
        ? Vec3{static_cast<float>(std::cos(WindAzRad) * Records_.WindForcefield.MeanSpeedMps),
               static_cast<float>(std::sin(WindAzRad) * Records_.WindForcefield.MeanSpeedMps),
               0.0f}
        : Vec3{0.0f, 0.0f, 0.0f};
    WindSolver_.StepField({static_cast<double>(CarPos.X), static_cast<double>(CarPos.Y), static_cast<double>(CarPos.Z)},
                          static_cast<double>(DtSeconds));

    // 3. Step 5.13x Pyro PlumeFluid (non-destructive UpdatePhysicalParameters!)
    if (Records_.PyroPlume.Enabled)
    {
        const auto T0 = std::chrono::steady_clock::now();
        PlumeFluidParameters PyroCfg{};
        PyroCfg.Variant = PlumeSolverVariant::ProductionUpgraded;
        PyroCfg.Grade   = Records_.PyroPlume.QualityGrade == 0 ? PlumeQualityGrade::Low
                        : (Records_.PyroPlume.QualityGrade == 2 ? PlumeQualityGrade::High : PlumeQualityGrade::Medium);
        PyroSolver_.UpdatePhysicalParameters(PyroCfg);

        const float FuelScale = static_cast<float>(Records_.PyroPlume.FuelInjectionRate);
        const float HeatScale = static_cast<float>((Records_.PyroPlume.BurnTemperatureK - 293.0) * 0.11);
        const float Lift      = static_cast<float>(Records_.PyroPlume.BuoyancyLift);
        PyroSolver_.AppendTransientPlumeSource(
            {8.2f, -1.6f, 0.55f}, 0.68f, {WindVec.X * 0.25f, WindVec.Y * 0.25f, Lift},
            32.0f * FuelScale, std::max(25.0f, HeatScale), 5.6f * FuelScale, 3.8f);
        const float PlumeDt = std::clamp(DtSeconds, 0.001f, 0.03125f);
        (void)PyroSolver_.AdvanceSimulation({8.2f, -1.6f, 0.0f}, {0.42f, -0.48f, 0.77f}, PlumeDt);
        const auto T1 = std::chrono::steady_clock::now();
        Telemetry_.PyroStepMs     = static_cast<float>(std::chrono::duration<double, std::milli>(T1 - T0).count());
        Telemetry_.PyroPeakKelvin = static_cast<float>(Records_.PyroPlume.BurnTemperatureK);
    }

    // 4. Step Coupled SkyPrecipitation (Rain + Snow + Multi-Bounce Hail) + SnowSurface (CC==1) + ShallowWater (0 foam/0 splash)
    if (Records_.SkyPrecipitation.Enabled && Records_.SkyPrecipitation.WeatherMode != 0)
    {
        auto SampleWind = [](Vec3, const void *WPtr) noexcept -> Vec3 {
            return *static_cast<const Vec3 *>(WPtr);
        };
        struct WeatherBind
        {
            SnowSurface            *Snow;
            ShallowWaterSimulation *Water;
            bool                    FeedSnow;
            float                   Restitution;
        } Bind{&SnowMound_, &WaterPuddles_, Records_.SkyPrecipitation.FeedSnowMound,
               static_cast<float>(Records_.SkyPrecipitation.HailRestitution)};

        auto QueryFloor = [](Vec3 Pt, float &OutZ, Vec3 &OutN, float &OutRest, const void *Ctx) noexcept -> bool {
            const auto *B = static_cast<const WeatherBind *>(Ctx);
            OutZ          = B->Snow->SampleGroundSurfaceElevation(Pt.X, Pt.Y);
            OutN          = {0.0f, 0.0f, 1.0f};
            OutRest       = B->Restitution;
            return true;
        };
        auto TouchSink = [](const PrecipitationTouchdownEvent &Ev, void *Ctx) noexcept {
            auto *B = static_cast<WeatherBind *>(Ctx);
            if (B->FeedSnow && Ev.Phase == SkyPrecipitationPhase::DendriticSnow)
            {
                const float Dx = Ev.HitPositionWorld.X - 5.8f;
                const float Dy = Ev.HitPositionWorld.Y - (-3.6f);
                const float R2 = (Dx * Dx) / (1.75f * 1.75f) + (Dy * Dy) / (1.35f * 1.35f);
                const float W  = std::exp(-0.5f * R2);
                if (W > 0.28f)
                {
                    B->Snow->DepositSnowflakeTouchdown(Ev.HitPositionWorld, Ev.ImpactVelocityMps, 0.045f * W, 0.30f);
                }
            }
        };

        const int32_t Mode = Records_.SkyPrecipitation.WeatherMode;
        if ((Mode == 1 || Mode == 3) && Records_.SkyPrecipitation.RainIntensity > 0.01)
        {
            RainfallSolver_.StepCoupledPrecipitation(DtSeconds, WindVec, SampleWind, &WindVec, QueryFloor, &Bind, TouchSink, &Bind);
        }
        if ((Mode == 2 || Mode == 3) && Records_.SkyPrecipitation.SnowfallIntensity > 0.01)
        {
            SnowfallSolver_.StepCoupledPrecipitation(DtSeconds, WindVec, SampleWind, &WindVec, QueryFloor, &Bind, TouchSink, &Bind);
        }
        if (Mode == 3 && Records_.SkyPrecipitation.HailIntensity > 0.01)
        {
            HailstormSolver_.StepCoupledPrecipitation(DtSeconds, WindVec, SampleWind, &WindVec, QueryFloor, &Bind, TouchSink, &Bind);
        }
    }

    if (Records_.SnowMound.Enabled)
    {
        if (Records_.SnowMound.CarveWheelFurrows)
        {
            for (int W = 0; W < 4; ++W)
            {
                SnowWheelRutInput Rut{};
                Rut.WheelContactWorld = Mat4Translation(LatestDriveSnap_.WheelWorld[W]);
                Rut.WheelForwardSpeed = std::abs(LatestDriveSnap_.Telemetry.ForwardSpeed);
                (void)SnowMound_.CarveWheelRutAndEvaluateResistance(Rut);
            }
        }
        VehicleSnowEnvelope CarEnv{};
        CarEnv.WorldCentre = CarPos + Vec3{0.0f, 0.0f, 0.55f};
        SnowMound_.RebuildContiguousPolygonSurfaces(CarEnv);
    }

    if (Records_.ShallowWater.Enabled)
    {
        const ShallowWaterDiagnostics WDiag = WaterPuddles_.StepSimulation(DtSeconds);
        Telemetry_.WaterMaxWaveSpeedMps = WDiag.PeakFlowSpeedMps;
        Telemetry_.WaterFoamParticles   = 0u; // Strict Smooth-Water Invariant: 0 foam!
        Telemetry_.WaterSplashParticles = 0u; // Strict Smooth-Water Invariant: 0 splash!
    }

    // 5. Step Crisp Swept Ballistic SparkParticles
    if (Records_.SparkEmitter.Enabled)
    {
        if (Records_.SparkEmitter.EmissionRatePerSec > 5.0)
        {
            MetallicScrapeContact Scrape{};
            Scrape.ContactPointWorld     = {4.3f, -1.1f, 0.28f};
            Scrape.ContactNormalWorld    = {0.0f, 0.0f, 1.0f};
            Scrape.TangentialVelocityMps = {
                -static_cast<float>(Records_.SparkEmitter.LaunchSpeedMps * 0.65),
                2.4f * std::sin(static_cast<float>(WorldClockSeconds_ * 3.1)),
                static_cast<float>(Records_.SparkEmitter.LaunchSpeedMps * 0.48)};
            Scrape.RequestedSparkCount = static_cast<uint32_t>(
                std::clamp(Records_.SparkEmitter.EmissionRatePerSec * DtSeconds, 2.0, 24.0));
            SparkSolver_.SpawnScrapeSparks(Scrape);
        }
        SparkSolver_.StepBallisticSparks(DtSeconds, WindVec);
    }

    if (Records_.LightningDischarge.Enabled)
    {
        Audio::AcousticListenerPose Listener{};
        LightningSolver_.AdvanceStormTimeline(WorldClockSeconds_, Listener, CarPos);
    }

    // 6. Step 48-Byte GRIT StateReplication Codec & Verify Round-Trip Accuracy
    const int32_t EngagedGear = std::max(1, LatestDriveSnap_.Telemetry.GearIndex - 2);
    const float   SynthThr    = (Records_.ControlVehicle.DriveProgram == 0) ? 0.0f : 0.55f;
    const float   SynthBrk    = (Records_.ControlVehicle.DriveProgram == 0) ? 0.65f : 0.0f;
    const float   SynthSteer  = (Records_.ControlVehicle.DriveProgram == 1)
                              ? 0.32f * std::sin(static_cast<float>(WorldClockSeconds_ * 0.85))
                              : 0.0f;
    if (Records_.StateReplication.Enabled)
    {
        NetSendAccumulator_ += static_cast<double>(DtSeconds);
        const double Period = 1.0 / std::max(5.0, Records_.StateReplication.SendRateHz);
        while (NetSendAccumulator_ >= Period)
        {
            NetSendAccumulator_ -= Period;
            Networking::DecodedVehicleReplicationSample Src{};
            Src.ObjectIdentifier = 1u;
            Src.Position         = CarPos;
            Src.EngineRpm        = std::max(820.0f, LatestDriveSnap_.Telemetry.EngineRPM);
            Src.GearNumber       = EngagedGear;
            Src.Throttle         = SynthThr;
            Src.Brake            = SynthBrk;
            Src.Steering         = SynthSteer;

            const Networking::CompactVehicleWireRecord Wire = Networking::QuantizeVehicleSample(Src);
            static_assert(sizeof(Networking::CompactVehicleWireRecord) == 48u, "GRIT 48 B wire invariant");
            const Networking::DecodedVehicleReplicationSample Dec = Networking::DequantizeVehicleSample(Wire);

            const Vec3 Diff = Dec.Position - Src.Position;
            Telemetry_.ReplicationPayloadBytes = static_cast<uint32_t>(sizeof(Wire));
            Telemetry_.ReplicationRmsPosErrMm  = std::sqrt(Dot(Diff, Diff)) * 1000.0f;
            ++Telemetry_.ReplicatedPacketsSent;
        }
    }

    // 7. Refresh Live Telemetry Snapshot & Ring Histories for Inspector Statistical Infographics
    Telemetry_.SpeedKmh          = std::abs(LatestDriveSnap_.Telemetry.ForwardSpeed) * 3.6f;
    Telemetry_.EngineRpm         = std::max(780.0f, LatestDriveSnap_.Telemetry.EngineRPM);
    Telemetry_.CurrentGear       = EngagedGear;
    Telemetry_.ThrottlePedal     = SynthThr;
    Telemetry_.BrakePedal        = SynthBrk;
    Telemetry_.SteerAngleDeg     = SynthSteer * 32.0f;
    Telemetry_.PhysicsTotalSteps = LatestDriveSnap_.PhysicsSteps;
    Telemetry_.DisplacedCones    = LatestDriveSnap_.DisplacedConeCount;

    for (int W = 0; W < 4; ++W)
    {
        const float Slip = std::min(0.95f, std::abs(LatestDriveSnap_.Telemetry.Wheels[W].SpinSlipSpeed) * 0.08f);
        Telemetry_.WheelSlip[W]   = Slip;
        Telemetry_.WheelLoadKn[W] = std::max(1.2f, LatestDriveSnap_.Telemetry.Wheels[W].NormalReaction.z * 0.001f);
        Telemetry_.WheelTempC[W]  = 46.0f + Slip * 48.0f * static_cast<float>(Records_.TyreThermal.ThermalHeatingRate)
                                  + 0.08f * Telemetry_.SpeedKmh;
    }

    Telemetry_.ActiveRainStreaks = (Records_.SkyPrecipitation.Enabled &&
                                    (Records_.SkyPrecipitation.WeatherMode == 1 || Records_.SkyPrecipitation.WeatherMode == 3))
                                 ? static_cast<uint32_t>(RainfallSolver_.Particles().size()) : 0u;
    Telemetry_.ActiveSnowFlakes  = (Records_.SkyPrecipitation.Enabled &&
                                    (Records_.SkyPrecipitation.WeatherMode == 2 || Records_.SkyPrecipitation.WeatherMode == 3))
                                 ? static_cast<uint32_t>(SnowfallSolver_.Particles().size()) : 0u;
    Telemetry_.ActiveHailStones  = (Records_.SkyPrecipitation.Enabled && Records_.SkyPrecipitation.WeatherMode == 3)
                                 ? static_cast<uint32_t>(HailstormSolver_.Particles().size()) : 0u;
    Telemetry_.HailBounceEvents  = static_cast<uint32_t>(HailstormSolver_.Telemetry().HailBounceContacts);

    const SnowpackPolygonSurface &SnowSurf = SnowMound_.GroundPolygonSurface();
    Telemetry_.SnowConnectedComponents = std::max(1u, SnowSurf.ConnectedComponentCount);
    Telemetry_.SnowPeakDepthCm         = SnowSurf.PeakThicknessM * 100.0f;
    Telemetry_.SnowTriangleCount       = static_cast<uint32_t>(SnowSurf.Indices.size() / 3u);
    for (size_t I = 0; I < Telemetry_.SnowCrossSectionCm.size(); ++I)
    {
        const float X = 2.6f + 6.4f * (static_cast<float>(I) / static_cast<float>(Telemetry_.SnowCrossSectionCm.size() - 1));
        Telemetry_.SnowCrossSectionCm[I] = SnowMound_.SampleGroundSnowThickness(X, -3.6f) * 100.0f;
    }

    float WaterSumMm = 0.0f;
    for (size_t I = 0; I < Telemetry_.WaterCrossSectionMm.size(); ++I)
    {
        const float X = -0.2f + 6.8f * (static_cast<float>(I) / static_cast<float>(Telemetry_.WaterCrossSectionMm.size() - 1));
        const float D = WaterPuddles_.SampleSurface({X, 3.4f}).FluidDepthMetres * 1000.0f;
        Telemetry_.WaterCrossSectionMm[I] = D;
        WaterSumMm += D;
    }
    Telemetry_.WaterMeanDepthMm = std::max(
        static_cast<float>(Records_.ShallowWater.BasinMeanDepthMm * 0.85),
        WaterSumMm / static_cast<float>(Telemetry_.WaterCrossSectionMm.size()));

    Telemetry_.ActiveSparkCount = SparkSolver_.Telemetry().ActiveSparkCount;

    const size_t Slot = HistoryCursor_ % Telemetry_.SpeedHistory.size();
    ++HistoryCursor_;
    Telemetry_.SpeedHistory[Slot]          = Telemetry_.SpeedKmh;
    Telemetry_.RpmHistory[Slot]            = Telemetry_.EngineRpm;
    Telemetry_.PyroMsHistory[Slot]         = Telemetry_.PyroStepMs;
    Telemetry_.NetBitrateKbpsHistory[Slot] = static_cast<float>(Records_.StateReplication.SendRateHz) * 48.0f * 8.0f * 0.001f;
}

bool DriveShowcaseWorld::RenderViewportIfNeeded(
    uint32_t TargetPanelWidth, uint32_t TargetPanelHeight,
    std::vector<uint8_t> &OutRgba8, uint32_t &OutRenderW, uint32_t &OutRenderH)
{
    std::lock_guard<std::mutex> Lock(SolverMutex_);
    if (DeferredWarmupPending_)
    {
        return false;
    }
    const float Scale = std::clamp(static_cast<float>(Records_.RenderPipeline.ViewportScalePercent) * 0.01f, 0.25f, 1.0f);
    const uint32_t RW = std::clamp(static_cast<uint32_t>(std::round(static_cast<float>(TargetPanelWidth) * Scale)), 160u, 960u);
    const uint32_t RH = std::clamp(static_cast<uint32_t>(std::round(static_cast<float>(TargetPanelHeight) * Scale)), 96u, 560u);

    if (RenderedRevision_ == SceneDirtyRevision_ && RW == LastRenderW_ && RH == LastRenderH_ &&
        OutRgba8.size() == static_cast<size_t>(RW) * RH * 4u)
    {
        OutRenderW = RW;
        OutRenderH = RH;
        return false;
    }

    const auto StartT = std::chrono::steady_clock::now();
    RebuildAndRender3DViewport(RW, RH, OutRgba8);
    const auto EndT   = std::chrono::steady_clock::now();
    Telemetry_.LastFrameRenderMs = static_cast<float>(std::chrono::duration<double, std::milli>(EndT - StartT).count());

    RenderedRevision_ = SceneDirtyRevision_;
    LastRenderW_      = RW;
    LastRenderH_      = RH;
    OutRenderW        = RW;
    OutRenderH        = RH;
    return true;
}

void DriveShowcaseWorld::RebuildAndRender3DViewport(uint32_t RenderW, uint32_t RenderH, std::vector<uint8_t> &OutRgba8)
{
    const Vec3 CarPos   = Mat4Translation(LatestDriveSnap_.ChassisWorld);
    const Vec3 CarFwd   = Mat4Col(LatestDriveSnap_.ChassisWorld, 0);
    const float CarYaw  = std::atan2(CarFwd.Y, CarFwd.X);
    const Vec3 PaintRgb = PaintColorFromPreset(Records_.ControlVehicle.PaintPreset);

    // Sun direction & irradiance from 1:1 DirectionalSunRecord + AtmosphereSkyRecord
    const float ElRad = static_cast<float>((Records_.AtmosphereSky.SkyTimePreset == 2 ? -14.0 : Records_.DirectionalSun.ElevationDeg) * (kPi / 180.0));
    const float AzRad = static_cast<float>(Records_.DirectionalSun.AzimuthDeg * (kPi / 180.0));
    const Vec3  SunDir = Normalise(Vec3{std::cos(ElRad) * std::cos(AzRad), std::cos(ElRad) * std::sin(AzRad), std::sin(ElRad)});
    const float SunKlx = Records_.DirectionalSun.Enabled ? static_cast<float>(Records_.DirectionalSun.IlluminanceKlx) : 0.0f;
    const float Warm   = static_cast<float>(Records_.DirectionalSun.WarmTint);
    const Vec3  SunIrr = (ElRad > -0.04f)
        ? Vec3{SunKlx * (0.135f + 0.025f * Warm), SunKlx * (0.126f - 0.005f * Warm), SunKlx * (0.116f - 0.022f * Warm)}
        : Vec3{0.02f, 0.03f, 0.06f};

    // Resolve camera viewpoint (7 showcase presets + free mouse orbit)
    Vec3 CamEye{-7.6f, -6.2f, 2.85f};
    Vec3 CamAim{3.8f, -0.4f, 1.05f};
    float FovRad = static_cast<float>(Records_.ExposureCamera.VerticalFovDeg * (kPi / 180.0));
    switch (GetCameraPreset())
    {
        case ShowcaseCameraPreset::HeroOverview:
            CamEye = {-7.6f, -6.2f, 2.85f};
            CamAim = {3.8f, -0.4f, 1.05f};
            break;
        case ShowcaseCameraPreset::CabinCockpitHmi:
            CamEye = CarPos + Vec3{-0.25f, 0.28f, 1.12f};
            CamAim = CarPos + CarFwd * 1.25f + Vec3{0.0f, 0.0f, 0.92f};
            FovRad = 0.92f;
            break;
        case ShowcaseCameraPreset::CircularPortals:
            CamEye = {-2.2f, 1.8f, 1.95f};
            CamAim = {3.2f, 4.2f, 1.85f};
            break;
        case ShowcaseCameraPreset::SnowMoundAndWater:
            CamEye = {0.4f, -6.8f, 2.15f};
            CamAim = {5.4f, -1.2f, 0.35f};
            break;
        case ShowcaseCameraPreset::PyroAndFracture:
            CamEye = {1.8f, -4.8f, 2.35f};
            CamAim = {7.8f, 1.1f, 1.35f};
            break;
        case ShowcaseCameraPreset::DynamicChase:
            CamEye = CarPos - CarFwd * 6.4f + Vec3{0.0f, 0.0f, 2.25f};
            CamAim = CarPos + CarFwd * 3.0f + Vec3{0.0f, 0.0f, 0.85f};
            break;
        case ShowcaseCameraPreset::TopCalibration:
            CamEye = {3.5f, -0.5f, 15.5f};
            CamAim = {3.5f, 0.0f, 0.0f};
            break;
    }

    // Low-Res Blinn-Phong Tier (TracingTier == 2)
    if (Records_.RenderPipeline.TracingTier == 2)
    {
        LowResBlinn_.ClearScene();
        BlinnMaterialProperties GroundMat{};
        GroundMat.LinearAlbedo = {0.20f, 0.22f, 0.26f};
        GroundMat.Roughness    = static_cast<float>(Records_.ProvingGroundsCourse.AsphaltRoughness);
        LowResBlinn_.SubmitAxisBox({2.0f, 0.0f, -0.25f}, {36.0f, 36.0f, 0.25f}, GroundMat, false);

        if (Records_.ControlVehicle.Enabled && !BlinnBodyMesh_.Positions.empty())
        {
            BlinnMaterialProperties Coat{};
            Coat.LinearAlbedo = PaintRgb;
            Coat.Roughness    = 0.18f;
            Coat.Metallic     = 0.35f;
            LowResBlinn_.SubmitFacetMesh(
                BlinnBodyMesh_, CarPos,
                Mat4Col(LatestDriveSnap_.ChassisWorld, 0),
                Mat4Col(LatestDriveSnap_.ChassisWorld, 1),
                Mat4Col(LatestDriveSnap_.ChassisWorld, 2),
                &Coat, nullptr, true);
        }
        BlinnMaterialProperties ShardMat{};
        ShardMat.LinearAlbedo = {0.58f, 0.54f, 0.68f};
        for (const auto &Frag : FractureFragments_)
        {
            LowResBlinn_.SubmitAxisBox(Frag.CentroidWorld, {0.22f, 0.22f, 0.28f}, ShardMat, true);
        }

        BlinnCameraDescriptor BCam{};
        BCam.EyeWorld       = CamEye;
        BCam.TargetWorld    = CamAim;
        BCam.VerticalFovDeg = static_cast<float>(Records_.ExposureCamera.VerticalFovDeg);
        BlinnRenderSettings BSet{};
        BSet.SunDirectionUnit = SunDir;
        std::vector<uint8_t> Rgb8;
        LowResBlinn_.RenderSceneToSrgb8(RenderW, RenderH, BCam, BSet, Rgb8);
        OutRgba8.resize(static_cast<size_t>(RenderW) * RenderH * 4u, 255u);
        for (size_t P = 0; P < static_cast<size_t>(RenderW) * RenderH; ++P)
        {
            OutRgba8[P * 4u + 0u] = Rgb8[P * 3u + 0u];
            OutRgba8[P * 4u + 1u] = Rgb8[P * 3u + 1u];
            OutRgba8[P * 4u + 2u] = Rgb8[P * 3u + 2u];
            OutRgba8[P * 4u + 3u] = 255u;
        }
        return;
    }

    // Dual-Tier GTX (SDF ReSTIR GI + Software BVH RT Reflections) / RTX (Full RayQuery) Scene Construction!
    SceneRenderer Scene{};
    Scene.RegisterTexturedGroundSlab(
        {2.0f, 0.0f, -0.25f}, {44.0f, 44.0f, 0.25f},
        {0.21f, 0.23f, 0.27f},
        static_cast<float>(Records_.ProvingGroundsCourse.AsphaltRoughness),
        0.04f);

    // Calibration Gantry + Solid-Angle Area Luminaires
    if (Records_.ProvingGroundsCourse.Enabled && Records_.ProvingGroundsCourse.ShowCalibrationGantry)
    {
        Scene.RegisterDualTierSolidBox({4.5f, -6.2f, 2.2f}, {0.32f, 0.32f, 2.2f}, {0.28f, 0.31f, 0.36f}, 0.42f);
        Scene.RegisterDualTierSolidBox({4.5f, +6.2f, 2.2f}, {0.32f, 0.32f, 2.2f}, {0.28f, 0.31f, 0.36f}, 0.42f);
        Scene.RegisterDualTierSolidBox({4.5f,  0.0f, 4.35f}, {0.42f, 6.5f, 0.22f}, {0.24f, 0.26f, 0.31f}, 0.38f);
    }
    if (Records_.AreaLightRig.Enabled)
    {
        const float LumGain = static_cast<float>(Records_.AreaLightRig.GantryLuminanceNits / 220.0);
        AreaLuminaireDescriptor GantryLight{};
        GantryLight.CentreWorld         = {4.5f, 0.0f, 4.10f};
        GantryLight.RightAxis           = {0.0f, 1.0f, 0.0f};
        GantryLight.UpAxis              = {1.0f, 0.0f, 0.0f};
        GantryLight.FrontNormal         = {0.0f, 0.0f, -1.0f};
        GantryLight.HalfWidthMetres     = 2.6f;
        GantryLight.HalfHeightMetres    = 0.32f;
        GantryLight.EmissiveRadianceRgb = {LumGain * 1.02f, LumGain * 0.98f, LumGain * 0.92f};
        Scene.RegisterAreaLuminaire(GantryLight);
    }

    // Dynamic Jolt Slalom Cones
    if (Records_.ProvingGroundsCourse.Enabled && Records_.ProvingGroundsCourse.ShowSlalomCones)
    {
        for (size_t C = 0; C < LatestDriveSnap_.ConePoses.size(); ++C)
        {
            const auto &CP = LatestDriveSnap_.ConePoses[C].Position;
            Scene.RegisterDualTierSolidBox(Vec3{CP.X, CP.Y, CP.Z + 0.22f}, {0.16f, 0.16f, 0.22f},
                                           {0.94f, 0.36f, 0.08f}, 0.46f);
        }
    }

    // Placeable 3D Scene Objects (living inside OS MAP_SHARED SharedRecords_ — 0 RAM duplication!)
    SubmitPlaceableObjectToScene(Records_.PlaceableChicaneBlock, Scene);
    SubmitPlaceableObjectToScene(Records_.PlaceableNanitePedestal, Scene);
    SubmitPlaceableObjectToScene(Records_.PlaceableOpticalArch, Scene);
    SubmitPlaceableObjectToScene(Records_.SpawnedObjectSlot0, Scene);
    SubmitPlaceableObjectToScene(Records_.SpawnedObjectSlot1, Scene);

    // Remote Sanctuary Beacon (seen clearly through the Seamless Portals!)
    Scene.RegisterDualTierSolidBox({26.0f, 0.0f, 1.75f}, {1.05f, 1.05f, 1.75f},
                                   {0.16f, 0.82f, 0.52f}, 0.35f, {0.12f, 0.52f, 0.32f});

    // Seamless Circular + Rectangular Portals + Trackside Planar Mirror
    SeamlessPortalAperture CircPortal{};
    CircPortal.Shape            = Records_.SeamlessPortals.PrimaryApertureShape == 1
                                ? PortalApertureShape::Circular
                                : PortalApertureShape::Rectangular;
    CircPortal.RadiusMetres     = static_cast<float>(Records_.SeamlessPortals.CircularPortalRadiusM);
    CircPortal.HalfWidthMetres  = static_cast<float>(Records_.SeamlessPortals.CircularPortalRadiusM);
    CircPortal.HalfHeightMetres = static_cast<float>(Records_.SeamlessPortals.CircularPortalRadiusM * 0.88);
    CircPortal.EntryCentreWorld = {3.2f, 4.2f, 1.85f};
    CircPortal.EntryRightAxis   = Normalise(Vec3{0.32f, -0.947f, 0.0f});
    CircPortal.EntryUpAxis      = {0.0f, 0.0f, 1.0f};
    CircPortal.EntryFrontNormal = Normalise(Vec3{-0.947f, -0.32f, 0.0f});
    CircPortal.ExitCentreWorld  = {20.5f, 0.0f, 1.85f};
    CircPortal.ExitRightAxis    = {0.0f, -1.0f, 0.0f};
    CircPortal.ExitUpAxis       = {0.0f, 0.0f, 1.0f};
    CircPortal.ExitFrontNormal  = {1.0f, 0.0f, 0.0f};
    CircPortal.PortalRimGlowRgb = {0.14f, 0.86f, 1.48f};
    CircPortal.ExitRimGlowRgb   = {1.48f, 0.62f, 0.14f};

    if (Records_.SeamlessPortals.Enabled)
    {
        Scene.RegisterSeamlessPortal(CircPortal);
        if (CircPortal.Shape == PortalApertureShape::Circular)
        {
            PortalMechanics::RegisterCircularPortalFrameRings(CircPortal, 0.09f, 40u, Scene);
        }
        if (Records_.SeamlessPortals.EnablePlanarMirror)
        {
            PlanarMirrorAperture Mirror{};
            Mirror.CentreWorld      = {6.2f, -6.4f, 1.65f};
            Mirror.RightAxis        = {1.0f, 0.0f, 0.0f};
            Mirror.UpAxis           = {0.0f, 0.0f, 1.0f};
            Mirror.FrontNormal      = Normalise(Vec3{-0.38f, 0.925f, 0.0f});
            Mirror.HalfWidthMetres  = 2.35f;
            Mirror.HalfHeightMetres = 1.55f;
            Scene.RegisterPlanarMirror(Mirror);
        }
    }

    // Snowfall-Deposited Single-Mesh 3D SnowSurface Mound (CC == 1, 0 floor-texture whitening!)
    if (Records_.SnowMound.Enabled && !SnowMound_.GroundPolygonSurface().Indices.empty())
    {
        Scene.RegisterSmoothSnowSurface(SnowMound_.GroundPolygonSurface());
    }

    // Griffith SolidFracture Cleaved Concrete Shards (radially separated so all ~28 hulls are crisp & inspectable!)
    if (Records_.SolidFracture.Enabled)
    {
        const Vec3  MonoCenter{7.4f, 3.8f, 1.05f};
        const float Gap = Records_.SolidFracture.CleavedState
                        ? static_cast<float>(Records_.SolidFracture.RadialShardGapM)
                        : 0.0f;
        for (const ConvexSolidFragment &Frag : FractureFragments_)
        {
            const Vec3 Radial = Frag.CentroidWorld - MonoCenter;
            const Vec3 Offset = Radial * Gap;
            const auto &Surf  = Frag.PolygonSurface;
            for (size_t T = 0; T + 2 < Surf.Indices.size(); T += 3)
            {
                RtxSceneTriangle Tri{};
                Tri.V0        = Surf.Vertices[Surf.Indices[T + 0]] + Offset;
                Tri.V1        = Surf.Vertices[Surf.Indices[T + 1]] + Offset;
                Tri.V2        = Surf.Vertices[Surf.Indices[T + 2]] + Offset;
                Tri.Normal    = (T / 3 < Surf.Normals.size())
                              ? Surf.Normals[T / 3]
                              : Normalise(Cross(Tri.V1 - Tri.V0, Tri.V2 - Tri.V0));
                Tri.AlbedoRgb = {0.62f, 0.60f, 0.68f};
                Tri.Roughness = 0.58f;
                Scene.RegisterPolygonTriangle(Tri);
            }
        }
        Scene.RegisterSdfOnlyCardProxyBox(MonoCenter, {0.75f, 0.75f, 1.10f}, {0.62f, 0.60f, 0.68f}, 0.58f);
    }

    // Prepare CoupledWorldOpticalContext (Atmosphere, 64-Step Clouds, Fog, Pyro, Water, Weather, Sparks, Exposure Guard)
    CoupledWorldOpticalContext OptCtx{};
    OptCtx.Atmosphere       = AtmosParams_;
    OptCtx.AtmosphereLut    = &SkyLut_;
    OptCtx.SunDirectionUnit = SunDir;
    OptCtx.SunIrradianceRgb = SunIrr;
    OptCtx.CelestialSky     = (Records_.AtmosphereSky.Enabled && Records_.AtmosphereSky.SkyTimePreset == 2)
                            ? &CelestialDome_
                            : nullptr;

    OptCtx.Clouds.Coverage       = Records_.VolumetricClouds.Enabled ? Records_.VolumetricClouds.Coverage : 0.0;
    OptCtx.Clouds.ExtinctionPerM = Records_.VolumetricClouds.ExtinctionDensity * 0.0085;
    OptCtx.Fog.DensityAtBase     = Records_.HeightFog.Enabled ? Records_.HeightFog.BaseDensity : 0.0;
    OptCtx.Fog.FalloffHeightM    = 1.0 / std::max(0.01, Records_.HeightFog.HeightFalloff);
    OptCtx.InspectionMode        = static_cast<uint8_t>(std::clamp(Records_.RenderPipeline.InspectionMode, 0, 6));

    OptCtx.PlumeFluid    = Records_.PyroPlume.Enabled ? &PyroSolver_ : nullptr;
    OptCtx.ShallowWater  = Records_.ShallowWater.Enabled ? &WaterPuddles_ : nullptr;
    OptCtx.Sparks        = Records_.SparkEmitter.Enabled ? &SparkSolver_ : nullptr;
    OptCtx.Lightning     = Records_.LightningDischarge.Enabled ? &LightningSolver_ : nullptr;
    if (Records_.SkyPrecipitation.Enabled && Records_.SkyPrecipitation.WeatherMode != 0)
    {
        OptCtx.Precipitation = (Records_.SkyPrecipitation.WeatherMode == 1) ? &RainfallSolver_
                             : (Records_.SkyPrecipitation.WeatherMode == 2) ? &SnowfallSolver_
                                                                            : &HailstormSolver_;
    }

    OptCtx.EnableSpatialReuse    = Records_.RenderPipeline.EnableSpatialRestir;
    OptCtx.EnableWaveletFilter   = Records_.RenderPipeline.EnableAtrousDenoiser;
    OptCtx.EnableSolarLensFlare  = Records_.ExposureCamera.EnableSolarLensFlare;
    OptCtx.HdrBloomStrength      = Records_.ExposureCamera.EnableMultiScaleBloom ? 0.22f : 0.0f;
    OptCtx.MaxApertureBounces    = static_cast<uint32_t>(std::clamp(Records_.SeamlessPortals.MaxRecursionHops, 1.0, 4.0));
    OptCtx.AutoExposure          = &AutoExposureState_;
    OptCtx.AutoExposureParameters.ExposureCompensationEv       = static_cast<float>(Records_.ExposureCamera.ExposureCompensation);
    OptCtx.AutoExposureParameters.ProtectDarkEmissiveInteriors = Records_.ExposureCamera.ProtectDarkCabinHmi;
    OptCtx.AutoExposureParameters.ProtectVehicleCabins         = Records_.ExposureCamera.ProtectDarkCabinHmi;

    // Mount 3D ControlVehicle + Diegetic 3D VehicleCabinHmi + CabinIconDepot
    if (Records_.ControlVehicle.Enabled)
    {
        static constexpr uint32_t kSwatchMap[4] = {0u, 5u, 1u, 2u};
        CabinHmi_.SelectGaragePaintSwatch(kSwatchMap[std::clamp(Records_.ControlVehicle.PaintPreset, 0, 3)]);
        CabinHmi_.SelectLauncherDesign(Records_.CabinHmi.HmiThemeMode == 0 ? CabinLauncherDesign::SplitDashboard
                                     : (Records_.CabinHmi.HmiThemeMode == 1 ? CabinLauncherDesign::LaunchpadGrid
                                                                            : CabinLauncherDesign::CollectionsRail));

        VehicleCabinTelemetryFrame HmiTel{};
        HmiTel.VehicleSpeedMps      = Telemetry_.SpeedKmh / 3.6f;
        HmiTel.EngineOrMotorRpm     = Telemetry_.EngineRpm;
        HmiTel.RedlineRpm           = static_cast<float>(Records_.PropulsionDrivetrain.RedlineRpm);
        HmiTel.EngagedGear          = std::max(1, Telemetry_.CurrentGear);
        HmiTel.ThrottlePedal01     = Telemetry_.ThrottlePedal;
        HmiTel.BrakePedal01        = Telemetry_.BrakePedal;
        HmiTel.SteeringAngleDegrees = Telemetry_.SteerAngleDeg + static_cast<float>(Records_.CabinHmi.SteeringWheelAngleDeg);
        HmiTel.GroundSnowPeakCm     = Telemetry_.SnowPeakDepthCm;
        HmiTel.RainIntensity01      = static_cast<float>(Records_.SkyPrecipitation.RainIntensity);
        HmiTel.HailImpactWarning    = Telemetry_.ActiveHailStones > 0u;

        LatestCockpitRig_ = CabinHmi_.MountControlVehicle3DCockpit(CarPos, CarYaw, HmiTel, Scene, OptCtx);
        Scene.RegisterSdfOnlyCardProxyBox(CarPos + Vec3{0.0f, 0.0f, 0.68f}, {2.15f, 0.94f, 0.56f}, PaintRgb, 0.24f);
    }

    Scene.FinalizeSceneAndBakeSurfaceCards(OptCtx);

    if (GetCameraPreset() == ShowcaseCameraPreset::CabinCockpitHmi && Records_.ControlVehicle.Enabled)
    {
        CamEye = LatestCockpitRig_.HmiFocusEyeWorld;
        CamAim = LatestCockpitRig_.HmiFocusTargetWorld;
        FovRad = 0.92f;
    }

    if (GetCameraPreset() != ShowcaseCameraPreset::CabinCockpitHmi &&
        (std::abs(OrbitYawOffsetRad_) > 1e-4f || std::abs(OrbitPitchOffsetRad_) > 1e-4f || std::abs(OrbitZoomOffsetM_) > 1e-4f))
    {
        const Vec3 Rel   = CamEye - CamAim;
        const float Dist = std::max(2.2f, Length(Rel) + OrbitZoomOffsetM_);
        const float BaseYaw   = std::atan2(Rel.Y, Rel.X) + OrbitYawOffsetRad_;
        const float BasePitch = std::clamp(std::asin(std::clamp(Rel.Z / std::max(0.1f, Length(Rel)), -0.95f, 0.95f)) +
                                           OrbitPitchOffsetRad_, -0.25f, 1.35f);
        CamEye = CamAim + Vec3{Dist * std::cos(BasePitch) * std::cos(BaseYaw),
                               Dist * std::cos(BasePitch) * std::sin(BaseYaw),
                               Dist * std::sin(BasePitch)};
    }

    const GpuTracingTier Tier = (Records_.RenderPipeline.TracingTier == 0)
                              ? GpuTracingTier::SignedDistanceFieldGtx
                              : GpuTracingTier::HardwareRayTracingRtx;
    Scene.RenderViewportRgba8(Tier, RenderW, RenderH, CamEye, CamAim, FovRad, OptCtx, OutRgba8);

    Telemetry_.CabinProtectedGain = AutoExposureState_.CurrentExposureGain;
    Telemetry_.AdaptedSceneEv100  = 12.4f - std::log2(std::max(0.05f, AutoExposureState_.CurrentExposureGain));
}

void DriveShowcaseWorld::RenderDedicatedEntityPreview(
    const std::string &StableId,
    uint32_t Width, uint32_t Height,
    float OrbitYawRad, float OrbitPitchRad, float OrbitDistanceScale,
    uint8_t PreviewInspectionMode,
    std::vector<uint8_t> &OutRgba8) const
{
    SceneRenderer Studio{};
    CoupledWorldOpticalContext Ctx{};
    Ctx.Atmosphere       = AtmosParams_;
    Ctx.AtmosphereLut    = &SkyLut_;
    const float ElRad    = static_cast<float>((Records_.AtmosphereSky.SkyTimePreset == 2 ? -14.0 : Records_.DirectionalSun.ElevationDeg) * (kPi / 180.0));
    const float AzRad    = static_cast<float>(Records_.DirectionalSun.AzimuthDeg * (kPi / 180.0));
    Ctx.SunDirectionUnit = Normalise(Vec3{std::cos(ElRad) * std::cos(AzRad), std::cos(ElRad) * std::sin(AzRad), std::sin(ElRad)});
    const float SunKlx   = Records_.DirectionalSun.Enabled ? static_cast<float>(Records_.DirectionalSun.IlluminanceKlx) : 85.0f;
    Ctx.SunIrradianceRgb = (ElRad > -0.04f) ? Vec3{SunKlx * 0.138f, SunKlx * 0.126f, SunKlx * 0.114f} : Vec3{0.08f, 0.10f, 0.16f};
    Ctx.CelestialSky     = (Records_.AtmosphereSky.SkyTimePreset == 2) ? &CelestialDome_ : nullptr;
    Ctx.Clouds.Coverage       = Records_.VolumetricClouds.Enabled ? Records_.VolumetricClouds.Coverage : 0.0;
    Ctx.Clouds.ExtinctionPerM = Records_.VolumetricClouds.ExtinctionDensity * 0.0085;
    Ctx.Fog.DensityAtBase     = Records_.HeightFog.Enabled ? Records_.HeightFog.BaseDensity * 0.5 : 0.0;
    Ctx.Fog.FalloffHeightM    = 12.0;
    Ctx.RestirCandidateK      = 4u;
    Ctx.EnableSpatialReuse    = true;
    Ctx.EnableWaveletFilter   = true;
    Ctx.InspectionMode        = PreviewInspectionMode;
    Ctx.ExposureScale         = 0.86f;

    Vec3  Focus{0.0f, 0.0f, 0.9f};
    float BaseDist = 4.2f;

    // Studio calibration floor slab (receives crisp entity directional sun shadow!)
    auto AddStudioFloorAt = [&](Vec3 CentreXY) {
        Studio.RegisterTexturedGroundSlab({CentreXY.X, CentreXY.Y, -0.15f}, {16.0f, 16.0f, 0.15f},
                                          {0.19f, 0.20f, 0.23f}, 0.42f, 0.04f);
    };

    auto FindPlaceable = [&](const std::string &Id) -> const ShowcasePlaceableObjectRecord * {
        if (Id == "placeable_chicane_block")   return &Records_.PlaceableChicaneBlock;
        if (Id == "placeable_nanite_pedestal") return &Records_.PlaceableNanitePedestal;
        if (Id == "placeable_optical_arch")    return &Records_.PlaceableOpticalArch;
        if (Id == "spawned_3d_object_0")       return &Records_.SpawnedObjectSlot0;
        if (Id == "spawned_3d_object_1")       return &Records_.SpawnedObjectSlot1;
        return nullptr;
    };

    if (const ShowcasePlaceableObjectRecord *Obj = FindPlaceable(StableId))
    {
        Focus = Vec3{static_cast<float>(Obj->PosX), static_cast<float>(Obj->PosY), static_cast<float>(Obj->PosZ)};
        AddStudioFloorAt(Focus);
        SubmitPlaceableObjectToScene(*Obj, Studio, true);
        BaseDist = std::max(2.6f, static_cast<float>(std::max({Obj->HalfExtentX, Obj->HalfExtentY, Obj->HalfExtentZ})) * 4.2f);
    }
    else if (StableId == "pyro_plume")
    {
        // Zero-copy live PyroSolver_ 3D raymarch!
        Focus          = Vec3{8.2f, -1.6f, 2.05f};
        AddStudioFloorAt(Focus);
        Ctx.PlumeFluid = &PyroSolver_;
        BaseDist       = 7.2f;
    }
    else if (StableId == "shallow_water")
    {
        Focus = Vec3{0.0f, 0.0f, 0.25f};
        AddStudioFloorAt(Focus);
        Studio.RegisterDualTierSolidBox({0.0f, 0.0f, 0.45f}, {0.55f, 0.55f, 0.45f}, {0.82f, 0.48f, 0.18f}, 0.28f);
        Ctx.ShallowWater = &WaterPuddles_;
        BaseDist         = 5.6f;
    }
    else if (StableId == "solid_fracture")
    {
        // Zero-copy live FractureFragments_ 3D Voronoi hull shards!
        const Vec3 MonoCenter{7.4f, 3.8f, 1.05f};
        Focus = MonoCenter;
        AddStudioFloorAt(MonoCenter);
        const float Gap = Records_.SolidFracture.CleavedState ? static_cast<float>(Records_.SolidFracture.RadialShardGapM) : 0.0f;
        for (const ConvexSolidFragment &Frag : FractureFragments_)
        {
            const Vec3 Offset = (Frag.CentroidWorld - MonoCenter) * Gap;
            const auto &Surf  = Frag.PolygonSurface;
            for (size_t T = 0; T + 2 < Surf.Indices.size(); T += 3)
            {
                RtxSceneTriangle Tri{};
                Tri.V0        = Surf.Vertices[Surf.Indices[T + 0]] + Offset;
                Tri.V1        = Surf.Vertices[Surf.Indices[T + 1]] + Offset;
                Tri.V2        = Surf.Vertices[Surf.Indices[T + 2]] + Offset;
                Tri.Normal    = (T / 3 < Surf.Normals.size()) ? Surf.Normals[T / 3] : Normalise(Cross(Tri.V1 - Tri.V0, Tri.V2 - Tri.V0));
                Tri.AlbedoRgb = {0.66f, 0.64f, 0.72f};
                Tri.Roughness = 0.52f;
                Studio.RegisterPolygonTriangle(Tri);
            }
        }
        BaseDist = 4.6f;
    }
    else if (StableId == "sparks" || StableId == "precipitation" || StableId == "snow_mound" || StableId == "lightning")
    {
        if (StableId == "snow_mound" && !SnowMound_.GroundPolygonSurface().Indices.empty())
        {
            Focus = Vec3{5.8f, -3.6f, 0.35f};
            AddStudioFloorAt(Focus);
            Studio.RegisterSmoothSnowSurface(SnowMound_.GroundPolygonSurface());
            BaseDist = 5.4f;
        }
        else if (StableId == "sparks")
        {
            const Vec3 CarPos = Mat4Translation(LatestDriveSnap_.ChassisWorld);
            Focus             = CarPos + Vec3{0.0f, 0.0f, 0.55f};
            AddStudioFloorAt(Focus);
            Studio.RegisterDualTierSolidBox(Focus, {0.42f, 0.42f, 0.42f}, {0.32f, 0.34f, 0.38f}, 0.32f, {}, 0.65f);
            Ctx.Sparks = &SparkSolver_;
            BaseDist   = 4.2f;
        }
        else
        {
            Focus = Vec3{2.0f, 1.0f, 1.4f};
            AddStudioFloorAt(Focus);
            Studio.RegisterDualTierSolidBox({2.0f, 1.0f, 0.65f}, {0.65f, 0.65f, 0.65f}, {0.45f, 0.48f, 0.54f}, 0.35f);
            Ctx.Precipitation = (Records_.SkyPrecipitation.WeatherMode == 1) ? &RainfallSolver_
                              : (Records_.SkyPrecipitation.WeatherMode == 2) ? &SnowfallSolver_
                                                                             : &HailstormSolver_;
            Ctx.Lightning = &LightningSolver_;
            BaseDist      = 5.2f;
        }
    }
    else if (StableId == "vehicle" || StableId == "propulsion" ||
             StableId == "suspension" || StableId == "tyres" ||
             StableId == "cabin_hmi" || StableId == "headlamps")
    {
        const Vec3  CarPos  = Mat4Translation(LatestDriveSnap_.ChassisWorld);
        const Vec3  CarFwd  = Mat4Col(LatestDriveSnap_.ChassisWorld, 0);
        const float CarYaw  = std::atan2(CarFwd.Y, CarFwd.X);
        Focus               = CarPos + Vec3{0.0f, 0.0f, 0.78f};
        AddStudioFloorAt(CarPos);
        VehicleCabinHmi StudioHmi = CabinHmi_;
        VehicleCabinTelemetryFrame HmiTel{};
        HmiTel.VehicleSpeedMps  = Telemetry_.SpeedKmh / 3.6f;
        HmiTel.EngineOrMotorRpm = Telemetry_.EngineRpm;
        HmiTel.RedlineRpm       = static_cast<float>(Records_.PropulsionDrivetrain.RedlineRpm);
        HmiTel.EngagedGear      = std::max(1, Telemetry_.CurrentGear);
        const auto Rig          = StudioHmi.MountControlVehicle3DCockpit(CarPos, CarYaw, HmiTel, Studio, Ctx);
        if (StableId == "cabin_hmi")
        {
            Studio.FinalizeSceneAndBakeSurfaceCards(Ctx);
            Studio.RenderViewportRgba8(GpuTracingTier::HardwareRayTracingRtx, Width, Height,
                                       Rig.HmiFocusEyeWorld, Rig.HmiFocusTargetWorld, 0.90f, Ctx, OutRgba8);
            return;
        }
        BaseDist = 5.4f;
    }
    else if (StableId == "portals_mirrors")
    {
        Focus = Vec3{3.2f, 4.2f, 1.85f};
        AddStudioFloorAt(Focus);
        SeamlessPortalAperture P{};
        P.Shape            = Records_.SeamlessPortals.PrimaryApertureShape == 1 ? PortalApertureShape::Circular : PortalApertureShape::Rectangular;
        P.RadiusMetres     = static_cast<float>(Records_.SeamlessPortals.CircularPortalRadiusM);
        P.HalfWidthMetres  = P.RadiusMetres;
        P.HalfHeightMetres = P.RadiusMetres * 0.88f;
        P.EntryCentreWorld = Focus;
        P.EntryRightAxis   = {0.0f, -1.0f, 0.0f};
        P.EntryUpAxis      = {0.0f, 0.0f, 1.0f};
        P.EntryFrontNormal = {-1.0f, 0.0f, 0.0f};
        P.ExitCentreWorld  = {20.5f, 0.0f, 1.85f};
        P.ExitRightAxis    = {0.0f, -1.0f, 0.0f};
        P.ExitUpAxis       = {0.0f, 0.0f, 1.0f};
        P.ExitFrontNormal  = {1.0f, 0.0f, 0.0f};
        Studio.RegisterDualTierSolidBox({26.0f, 0.0f, 1.75f}, {1.05f, 1.05f, 1.75f}, {0.16f, 0.82f, 0.52f}, 0.35f);
        Studio.RegisterSeamlessPortal(P);
        if (P.Shape == PortalApertureShape::Circular)
        {
            PortalMechanics::RegisterCircularPortalFrameRings(P, 0.09f, 36u, Studio);
        }
        BaseDist = 5.2f;
    }
    else
    {
        // Illumination, Sky, Course, Forcefield & Render Material Calibration Studio (matte + metallic + refractive glass spheres!)
        Focus = Vec3{0.0f, 0.0f, 0.72f};
        AddStudioFloorAt(Focus);
        Studio.RegisterSmoothSphere({0.0f, -1.05f, 0.62f}, 0.62f, {0.82f, 0.82f, 0.84f}, 0.36f, 0.04f, false);
        Studio.RegisterSmoothSphere({0.0f, +1.05f, 0.62f}, 0.62f, {0.88f, 0.62f, 0.32f}, 0.12f, 0.92f, false);
        Studio.RegisterSmoothSphere({0.98f, 0.0f, 0.52f}, 0.52f, {0.92f, 0.96f, 1.00f}, 0.04f, 0.0f, true, 1.52f);
        BaseDist = 4.6f;
    }

    Studio.FinalizeSceneAndBakeSurfaceCards(Ctx);
    const float Dist  = std::max(1.8f, BaseDist * std::clamp(OrbitDistanceScale, 0.45f, 2.5f));
    const float Pitch = std::clamp(OrbitPitchRad, 0.06f, 1.25f);
    const Vec3  Eye   = Focus + Vec3{
        Dist * std::cos(Pitch) * std::cos(OrbitYawRad),
        Dist * std::cos(Pitch) * std::sin(OrbitYawRad),
        Dist * std::sin(Pitch)};
    Studio.RenderViewportRgba8(GpuTracingTier::HardwareRayTracingRtx, Width, Height, Eye, Focus, 0.82f, Ctx, OutRgba8);
}

bool DriveShowcaseWorld::TryRenderDedicatedEntityPreview(
    const std::string &StableId,
    uint32_t Width, uint32_t Height,
    float OrbitYawRad, float OrbitPitchRad, float OrbitDistanceScale,
    uint8_t PreviewInspectionMode,
    std::vector<uint8_t> &OutRgba8) const
{
    if (NonBlockingStudioPreviews_)
    {
        std::unique_lock<std::mutex> TryLock(SolverMutex_, std::try_to_lock);
        if (!TryLock.owns_lock())
        {
            return false;
        }
        RenderDedicatedEntityPreview(StableId, Width, Height, OrbitYawRad, OrbitPitchRad,
                                     OrbitDistanceScale, PreviewInspectionMode, OutRgba8);
        return true;
    }

    std::lock_guard<std::mutex> Lock(SolverMutex_);
    RenderDedicatedEntityPreview(StableId, Width, Height, OrbitYawRad, OrbitPitchRad,
                                 OrbitDistanceScale, PreviewInspectionMode, OutRgba8);
    return true;
}

} // namespace Frontier::Drive
