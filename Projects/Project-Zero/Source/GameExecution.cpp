//============================================================================================================================================
//                                                      GAMEEXECUTION.CPP
//============================================================================================================================================
// 🧩 Project-Zero entry point — one dedicated open celestial material-test scene, with an explicit Visibility Raster /
//    ReSTIR path selector and the celestial editor embedded in Frontier Editor mode. There is no scene selector here.

#include "../../../Engine/DeviceExchange/SwapchainExchange.h"
#include "../../../Engine/DisplayPresentation/ReSTIRIntegrator.h"
#include "../../../Engine/DisplayPresentation/ShadingTableCodec.h"
#include "../../../Engine/DisplayPresentation/RenderScheduler.h"
#include "../../../Engine/DisplayPresentation/CelestialTier.h"
#include "CelestialSequence.h"
#include "../../../Engine/Editor/EditorInstance.h"
#include "../../../Engine/DeviceExchange/DiagnosticMetrics.h"
#include "../../../Engine/DisplayPresentation/ControlCentreHost.h"
#include "../../../Engine/DisplayPresentation/PixelSpace.h"
#include "../../../Engine/DisplayPresentation/FidelityClassifier.h"
#include "../../../Engine/DisplayPresentation/NotificationQueue.h"
#include "../../../Engine/DisplayPresentation/TelemetryMetrics.h"
#include "../../../Engine/DisplayPresentation/TypefaceRegistry.h"
#include "../../../Engine/DisplayPresentation/ConfigurationRegistry.h"
#include "../../../Engine/DisplayPresentation/DiagnosticInspector.h"
#include "../../../Engine/ContentInterchange/ContentCodec.h"
#include "../../../Engine/GeometricRaster/SceneStructure.h"
#include "../../../Engine/GeometricRaster/TraversalIndex.h"
#include "FlyThroughSolver.h"
#include "RayTracingSolver.h"
#include "EditorFeedSequence.h"

#include <algorithm>
#include <chrono>
#include <thread>
#include <string>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <iostream>

int main(int argc, char** argv)
{
    (void)argc; (void)argv; // one-scene workflow: command-line scene selection is intentionally not supported
    // Project Zero is intentionally not a scene browser. The generated glTF is only a transport/cache for this
    //    one source scene and is always named after the workflow, never after a sample level.
    const std::string ScenePath = "Projects/Project-Zero/Content/Scenes/ProjectZeroCelestial.gltf";

    //──────────────────────────────────────────────────────────────────────────
    // Telemetry sink
    //──────────────────────────────────────────────────────────────────────────
    Frontier::DiagnosticConfiguration DiagnosticConfig{};
    DiagnosticConfig.DestinationFolder          = "Diagnostics";
    DiagnosticConfig.OutputFileStem             = "ProjectZero_TelemetryReport";
    DiagnosticConfig.FileExtension              = ".md";
    DiagnosticConfig.TimestampPrefixEnabled     = true;
    DiagnosticConfig.ConsoleEchoEnabled         = true;    // 💡 mirror telemetry into the console so a failed bring-up is visible
    DiagnosticConfig.MarkdownTableFormatEnabled = true;

    Frontier::DiagnosticMetrics Logger(DiagnosticConfig);
    if (!Logger.InitializeSink())
        std::cerr << "[Project-Zero] Telemetry sink could not be opened; continuing with console output only.\n";
    Logger.RecordMessage(Frontier::DiagnosticSeverity::Information,
                         "Bootstrap", "Project-Zero windowed ReSTIR renderer starting.");

    //──────────────────────────────────────────────────────────────────────────
    // The one Project Zero scene — authored by the analytical source and imported through the production codec.
    // The codec path is important: CPU proof, Visibility Raster and ReSTIR consume the same material records.
    //──────────────────────────────────────────────────────────────────────────
    Frontier::ProjectZero::RayTracingSolver Scene;
    {
        std::error_code FsError;
        if (!std::filesystem::exists(ScenePath, FsError))
        {
            std::filesystem::create_directories(std::filesystem::path(ScenePath).parent_path(), FsError);
            std::string Error;
            Frontier::SceneEncodeConfiguration Naming{};
            Naming.Name  = "ProjectZeroCelestial";
            Naming.Spans = &Scene.QuerySpans();
            if (Frontier::SceneCodec::Encode(ScenePath, Frontier::ReSTIRIntegrator::BuildTriangleIndex(Scene),
                                             Frontier::ReSTIRIntegrator::BuildMaterialDescriptors(Scene), &Error, Naming))
                std::cerr << "[Scene] Generated the dedicated Project Zero celestial material test scene at " << ScenePath << "\n";
            else
                std::cerr << "[Scene] Celestial scene generation failed: " << Error << "\n";
        }
    }

    Frontier::ConfigurationRegistry Configuration;
    if (!Configuration.Load("Projects/Project-Zero/Content/Slate.config.toml"))
        std::cerr << "[Configuration] " << Configuration.QueryPath() << ": " << Configuration.QueryLastError() << " - using defaults\n";

    Frontier::SceneStructure Level;
    Frontier::TextureIndex   Textures;
    uint32_t MaxTextureLevels = 1u;   // R6 row 3: deepest mip chain resident (F3 scene-census row; computed once below)
    // Celestial moon atlas: bindless slots, filled right after the scene registers its own textures (below) and
    //    handed to the sequence after Decode. Outer scope because registration and assignment straddle the scene
    //    block; kNoMoonSlot until filled.
    uint32_t MoonSlots[Frontier::kMoonAtlasCount];
    for (uint32_t M = 0u; M < Frontier::kMoonAtlasCount; ++M) MoonSlots[M] = 0xFFFFFFFFu;
    {
        Frontier::SceneDecodeConfiguration Decode;
        Decode.UniformScale = 1.0f; // the dedicated scene has one authored scale; Project Zero has no scene-scale selector
        Decode.SlabLimit    = Configuration.Query().Backend.SlabLimit;
        std::string Error;
        if (!Frontier::ContentCodec::Decode(ScenePath, Level, &Textures, Decode, &Error))   // .gltf/.glb/.fbx/.obj by extension
        {
            Logger.RecordMessage(Frontier::DiagnosticSeverity::Fatal, "Scene", ("Cannot import " + ScenePath + ": " + Error).c_str());
            Logger.TerminateSink();
            std::cerr << "\nProject-Zero could not import the scene. Press Enter to close this console.\n";
            std::cin.get();
            return 1;
        }
        if (!Error.empty()) std::cerr << "[Scene] " << Error << "\n";
        // Celestial moons — the six albedos join the shared index BEFORE Textures.Decode, so they ride the same
        //    decode/upload path as the scene and land in the bindless table the kernel samples. Colour, not
        //    data (Linear=false): they upload SRGB and the shader reads linear albedos.
        for (uint32_t M = 0u; M < Frontier::kMoonAtlasCount; ++M)
        {
            char MoonPath[128];
            std::snprintf(MoonPath, sizeof(MoonPath), "%s%s",
                          Frontier::kMoonTextureDirectory, Frontier::kMoonAtlas[M].File);
            MoonSlots[M] = Textures.RegisterPath(MoonPath, /*Linear=*/false);
        }
        Level.AssignName(std::filesystem::path(ScenePath).stem().string());
        const Frontier::Vector3 Lo = Level.QueryBoundsMinimum(), Hi = Level.QueryBoundsMaximum();
        char Line[256];
        std::snprintf(Line, sizeof(Line), "%s: %u triangles, %zu instances, %zu clusters, %zu materials, %zu luminaires, bounds [%.2f %.2f %.2f]..[%.2f %.2f %.2f] m",
                      Level.QueryName().c_str(), Level.QueryTriangleCount(), Level.QueryInstances().size(), Level.QueryClusters().size(),
                      (size_t)Level.QueryMaterials().QueryCount(), Level.QueryLuminaires().size(), Lo.x, Lo.y, Lo.z, Hi.x, Hi.y, Hi.z);
        Logger.RecordMessage(Frontier::DiagnosticSeverity::Information, "Scene", Line);
        {
            const Frontier::MaterialIndexMetrics& M = Level.QueryMaterials().QueryMetrics();
            std::vector<std::string> TextureReport;
            (void)Textures.Decode(Configuration.Query().Backend.TextureEdgeLimit, &TextureReport);
            for (const Frontier::TextureDescriptor& T : Textures.QueryTextures())
                MaxTextureLevels = std::max(MaxTextureLevels, T.LevelCount);   // R6 row 3: LOD census for the F3 popup
            for (const std::string& L : TextureReport) Logger.RecordMessage(Frontier::DiagnosticSeverity::Information, "Textures", L.c_str());
            std::snprintf(Line, sizeof(Line), "Materials: %u descriptors -> %u records, %u slabs (limit %u, %u folded), %zu placements, %zu cameras, %zu punctual lights",
                          M.DescriptorCount, M.DescriptorCount, M.SlabCount, M.SlabLimit, M.FoldedCount, Level.QueryPlacements().size(), Level.QueryCameras().size(), Level.QueryPunctualLuminaires().size());
            Logger.RecordMessage(Frontier::DiagnosticSeverity::Information, "Materials", Line);
        }
    }
    const uint32_t LuminaireCount = static_cast<uint32_t>(Level.QueryLuminaires().size());
    uint32_t AlphaMaskedMaterialCount = 0u;   // R4b: > 0 switches shadow rays to the alpha-mask-aware walk
    for (const Frontier::MaterialRecord& R : Level.QueryMaterials().QueryRecords())
        if (R.Flags & Frontier::MaterialFlagAlphaMask) ++AlphaMaskedMaterialCount;

    // R3: Tier A acceleration structure — tinybvh binned SAH → CWBVH over the flat world-space triangles.
    // D1: built through the bottom-level entry point. The whole level is currently ONE identity-transformed
    //     instance, so object space is world space and this is bit-for-bit what Build() produced before
    //     (Scratchpad/CheckTraversalIdentity.sh is the gate). Per-instance transforms arrive in D2/D3.
    Frontier::TraversalIndex Traversal;
    {
        // SBVH; ~2× build time for ~10 % fewer steps. The drop level opts OUT: spatial splits cut triangles,
        //    which makes the tree unrefittable, and movable geometry is worth more here than the traversal gain.
        const bool HighQuality = Level.QueryTriangleCount() <= 2'000'000u;
        Traversal.BuildBottomLevel(Level.QueryFlatTriangles(), HighQuality);
        const Frontier::TraversalMetrics& M = Traversal.QueryMetrics();
        char Line[256];
        std::snprintf(Line, sizeof(Line), "CWBVH: %u triangles → %u nodes, %.1f KB nodes + %.1f KB leaves (%.1f B/tri), SAH %.2f, built in %.1f ms (%s)",
                      M.TriangleCount, M.NodeCount, M.NodeByteCount / 1024.0, M.LeafByteCount / 1024.0,
                      double(M.NodeByteCount + M.LeafByteCount) / std::max(1u, M.TriangleCount), M.SahCost, M.BuildMilliseconds,
                      M.HighQuality ? "spatial splits" : "binned SAH");
        Logger.RecordMessage(Frontier::DiagnosticSeverity::Information, "Traversal", Line);
    }

    //──────────────────────────────────────────────────────────────────────────
    // Camera — a stable outdoor framing for the one celestial material test scene.
    //──────────────────────────────────────────────────────────────────────────
    Frontier::ProjectZero::FlyThroughConfiguration CameraConfig
    { 2.5f, 3.0f, 0.00125f, 0.5f, 12.0f };
    Frontier::ProjectZero::FlyThroughSolver Camera(CameraConfig);
    Camera.AssignSpatialLocation(Frontier::Vector3{ 0.0f, -6.0f, 2.15f });
    Camera.AssignOrientationEuler(7.0f * 3.14159265f / 180.0f, 0.0f, 0.0f);
    Camera.AssignFieldOfView(55.0f);
    Camera.AssignAspectRatio(1280.0f / 720.0f);

    //──────────────────────────────────────────────────────────────────────────
    // ReSTIR integrator — owns dispatch parameters, accumulation index
    //──────────────────────────────────────────────────────────────────────────
    // Designated initialisers, NOT positional. This list was positional and silently bound 1.05f (the exposure) to
    //    SpatialTapCount the moment R10 added a tier-keyed field ahead of it — the struct's own defaults for the
    //    new fields were skipped and the exposure landed in a uint32_t. Naming each member means a future field can
    //    be inserted anywhere without quietly repointing every value after it.
    Frontier::ReSTIRIntegratorConfiguration IntegratorConfig
    {
        .CandidatesPerPixel  = 8u,      // [-]  primary DI candidates per pixel
        .ExtraCandidateCount = 2u,      // [-]  extra same-pixel candidates
        .Exposure            = 1.05f,   // [-]  ACES exposure
        .AmbientStrength     = 0.015f   // [-]  ambient strength
    };

    Frontier::ReSTIRIntegrator Integrator(IntegratorConfig);

    // User directive 2026-09-11: no adaptive exposure in the engine build. Frame-median metering keys to the
    //    background on wide framings (small bright subject blows out) and the 0.4/2.2 s adaptation lags flash
    //    white/black on every turn. Manual holds the slider value above, so the frame is a pure function of the
    //    scene and the camera. The struct default stays Adaptive: the proofs seat their own configurations and
    //    must be untouched by this.
    {
        Frontier::ExposureConfiguration ExposureSeed = Integrator.Exposure().QueryConfiguration();
        ExposureSeed.Mode = Frontier::ExposureModeCategory::Manual;
        ExposureSeed.ManualExposure = IntegratorConfig.Exposure;
        Integrator.Exposure().AssignConfiguration(ExposureSeed);
    }

    //──────────────────────────────────────────────────────────────────────────
    // Swapchain exchange — GLFW window + Vulkan surface + compute pipeline
    //──────────────────────────────────────────────────────────────────────────
    Frontier::SwapchainConfiguration SurfaceConfig
    {
        1280u,
        720u,
        "Project-Zero  |  Celestial Material Test  |  Frontier Engine",
        true        // validation layers — set true for debugging
    };

    // Slate.config.toml is read before the device comes up: [render] ray_tracing_tier decides which traversal backend
    //    the swapchain resolves (missing file = defaults = Auto).

    Frontier::SwapchainExchange Surface(SurfaceConfig);
    Surface.AssignRayTracingRequest(static_cast<Frontier::RayTracingRequestCategory>(Configuration.Query().Backend.RayTracingTier));

    if (!Surface.Bring())
    {
        Logger.RecordMessage(Frontier::DiagnosticSeverity::Fatal,
                             "Bootstrap", "SwapchainExchange bring-up failed - see the [SwapchainExchange] lines above for the failing stage.");
        Logger.TerminateSink();
        std::cerr << "\nProject-Zero could not open its window. Press Enter to close this console.\n";
        std::cin.get();
        return 1;
    }

    Logger.RecordMessage(Frontier::DiagnosticSeverity::Information,
                         "Bootstrap", "Window and Vulkan swapchain ready.");

    {
        const Frontier::ShadingTableSet Tables = Frontier::ShadingTableCodec::Bake();   // R4b: GGX energy + LTC sheen LUTs
        Surface.UploadShadingTables(Tables.Energy.data(), Tables.Sheen.data(), Frontier::ShadingTableSet::kResolution);
    }
    Surface.UploadScene(Level, Traversal, &Textures);

    // The scene is static by design. Keep a copy for the Editor sheet API; no hidden animation or showroom physics
    //    branch can change the production geometry behind a proof frame.
    std::vector<Frontier::InstanceRecord> AnimatedInstances = Level.QueryInstances();

    //──────────────────────────────────────────────────────────────────────────
    // ImGui panel — apply theme once after context exists
    //──────────────────────────────────────────────────────────────────────────
    Frontier::RenderScheduler Panel;
    // The sky, the weather and everything that carries them. Prepared once; ticked with the frame.
    Frontier::ProjectZero::CelestialSequence Celestial;
    Celestial.Prepare();
    Frontier::VisibilityRaster SoftwareRaster;
    std::vector<unsigned char> SoftwareRasterPixels;
    // The moon atlas arrives after Decode: slots were registered with the scene (above), and the descriptors
    //    now carry pixels the CPU raster can borrow. A missing file degrades to the index's 1x1 placeholder —
    //    a pale disc, logged at decode — never a refusal to start.
    Celestial.AssignMoonAtlas(MoonSlots, Textures);
    // Moon atlas census: which bindless slots the kernel's MoonAlong will sample, against what is resident.
    //    A slot past the resident count samples an unbound descriptor — white on most drivers — so this line
    //    next to the "Textures: N resident" line is the whole diagnosis for a textureless moon.
    {
        uint32_t Lo = 0xFFFFFFFFu, Hi = 0u;
        for (uint32_t M = 0u; M < Frontier::kMoonAtlasCount; ++M)
        {
            if (MoonSlots[M] < Lo) Lo = MoonSlots[M];
            if (MoonSlots[M] > Hi) Hi = MoonSlots[M];
        }
        char MoonLine[128];
        std::snprintf(MoonLine, sizeof(MoonLine), "%u textures resident, moon slots %u..%u%s.",
                      Textures.QueryCount(), Lo, Hi,
                      Hi < Textures.QueryCount() ? "" : " PAST THE TABLE (moons sample unbound)");
        Logger.RecordMessage(Hi < Textures.QueryCount() ? Frontier::DiagnosticSeverity::Information
                                                        : Frontier::DiagnosticSeverity::Warning,
                             "Moons", MoonLine);
    }
    // The star tables upload once, now the catalogue is loaded: cells then binned stars into binding 23.
    //    Skipped — never called — when the catalogue is empty, so the bring-up zeros stand and the packer's
    //    zero brightness keeps the kernel's star loop off. Static for the run: the sky's rotation is time, not
    //    data, and it rides the per-frame record instead.
    {
        const Frontier::StarCatalogueIndex& Stars = Celestial.Stars();
        if (!Stars.Empty())
        {
            Surface.UploadStarTables(Stars.QueryCells().data(), static_cast<uint32_t>(Stars.QueryCells().size()),
                                     Stars.QueryStars().data(), static_cast<uint32_t>(Stars.QueryStars().size()));
            char StarLine[96];
            std::snprintf(StarLine, sizeof(StarLine), "%u stars in %u cells uploaded to binding 23.",
                          static_cast<uint32_t>(Stars.QueryStars().size()),
                          static_cast<uint32_t>(Stars.QueryCells().size()));
            Logger.RecordMessage(Frontier::DiagnosticSeverity::Information, "Stars", StarLine);
        }
        else
        {
            Logger.RecordMessage(Frontier::DiagnosticSeverity::Warning, "Stars",
                                 "Catalogue empty or missing — the night sky renders starless.");
        }
    }
    uint32_t CelestialFirstRow = Frontier::kNoEditorInstance;

    Panel.ApplyTheme();

    //──────────────────────────────────────────────────────────────────────────
    // Control Centre — top notch + pull-down shade (engine overlay, drawn above every ImGui window)
    //──────────────────────────────────────────────────────────────────────────
    // Typefaces: every static face under EngineContent/FontArchives, loaded once into the dynamic atlas (Vulkan backend
    //    rasterises glyphs on demand). The Fonts tab reads the registry; PixelSpace text honours the applied face.
    Frontier::TypefaceRegistry Typefaces;
    (void)Typefaces.Load("EngineContent/FontArchives");
    Frontier::TypefaceRegistry::Install(&Typefaces);

    Frontier::ControlCentreHost ControlCentre;
    ControlCentre.AssignProjectName("Project-Zero");
    (void)ControlCentre.Initialize(Surface.QueryWidth(), Surface.QueryHeight());

    // The hosts are seeded from the configuration loaded before bring-up; every Apply / debounced dashboard change
    //    writes the file back.
    ControlCentre.SeedSettings(Configuration.Query().Render);
    ControlCentre.AccessAppearance().Seed(Configuration.Query().Appearance);
    ControlCentre.AccessInput().Seed(Configuration.Query().Input);
    ControlCentre.AccessNotifications().Seed(Configuration.Query().Notifications);
    Frontier::PixelSpace OverlaySurface;

    // R2 debug popup (F3) — seeded from [render] debug_view / occlusion_culling / alias_pick.
    Frontier::DiagnosticInspector Diagnostics;
    Diagnostics.Seed(static_cast<Frontier::DebugViewCategory>(Configuration.Query().Backend.DebugView), Configuration.Query().Backend.OcclusionCulling,
                     Configuration.Query().Backend.AliasPick);
    Integrator.AssignAliasPick(Configuration.Query().Backend.AliasPick);   // R6 row 3: persisted F5 state applies from the first frame

    // Dashboard-driven engine services: quality ladder, toasts, frame telemetry
    Frontier::FidelityClassifier Fidelity;
    Frontier::NotificationQueue  Notifications;
    Frontier::TelemetryMetrics   Telemetry;
    {
        // R1: announce the resolved ray-tracing backend once; a downgrade from an explicit request is an Info toast.
        const Frontier::RayTracingRequestCategory Req = Surface.QueryRayTracingRequest();
        const Frontier::RayTracingTierCategory    Use = Surface.QueryRayTracingTier();
        const bool Downgraded = Req != Frontier::RayTracingRequestCategory::Auto && static_cast<uint32_t>(Use) + 1u < static_cast<uint32_t>(Req);
        if (Downgraded)
        {
            char Body[128];
            std::snprintf(Body, sizeof(Body), "%s requested, device supports %s", Frontier::RayTracingCapabilitySet::RequestName(Req), Frontier::RayTracingCapabilitySet::TierName(Use));
            Notifications.Push("Ray-tracing tier downgraded", Body);
        }
    }
    uint32_t AppliedSettingsRevision = ~0u;   // forces the first application
    float    SettingsQuietSeconds    = 0.0f;  // [s] since the last change; the toast waits for the slider to rest
    bool     SettingsToastPending    = false;
    uint32_t AppliedAppearanceRevision = 0u;
    bool     AppearanceEverApplied     = false;
    float    FrameCapSeconds           = 0.0f;   // [s] 0 = unlimited (Display → Frame Cap)
    uint32_t FixedRenderHeight         = 0u;     // [px] 0 = native  (Display → Resolution)   // AppearanceInspector::Apply bumps its own revision
    uint32_t AppliedInputRevision      = 0u;
    uint32_t AppliedNotifyRevision     = 0u;
    Frontier::SkyConstantRecord  LastSky{};    // last sky bytes pushed (④d); a change restarts the accumulation
    Frontier::MoonConstantRecord LastMoons{};  // last moon bytes pushed (④e); a change restarts the accumulation
    Frontier::PostConstantRecord LastPost{};   // last post bytes pushed (④f); a change restarts the accumulation
    bool     BakeAnnounced             = false;  // "Baking Complete" = temporal accumulation reached BakeFrameCount
    constexpr uint32_t BakeFrameCount  = 256u;
    std::string LastSaveError;                   // de-duplicates the "Autosave Errors" toast

    Frontier::ShadowCriteria SoftwareShadowCriteria{};

    // Push the Control Centre settings into the renderer. Called whenever the settings revision changes.
    auto ApplyControlCentreSettings = [&](const Frontier::ControlCentreSettings& S, bool Announce)
    {
        Fidelity.AssignCategory(S.Quality);
        const Frontier::RenderPathMode RequestedPath = S.RenderPath == Frontier::RenderPathSelection::VisibilityRaster
            ? Frontier::RenderPathMode::VisibilityRaster : Frontier::RenderPathMode::ReSTIR;
        if (Surface.QueryRenderPath() != RequestedPath)
            Integrator.ResetAccumulation();
        Surface.AssignRenderPath(RequestedPath);
        const Frontier::FidelityCriteria Criteria = Fidelity.QueryActiveCriteria();

        // The quality tier sets the ReSTIR budget; the GI / AA tiles override the tier's own defaults.
        Integrator.AssignCandidatesPerPixel(Criteria.ReSTIRCandidateSampleCount);
        Integrator.AssignExtraCandidateCount(Criteria.ReSTIRExtraCandidateCount);
        Integrator.AssignSpatialTapCount(Criteria.ReSTIRSpatialTapCount);
        Integrator.AssignDenoiseLevelCount(Criteria.DenoiseLevelCount);
        Integrator.AssignGlobalIllumination(S.GlobalIllumination);
        Integrator.AssignAntiAliasing(S.AntiAliasing);
        Notifications.AssignEnabled(S.Notifications);

        // R10 — the GI-off shadow stage. The tier picks the technique, the kernel width and a default map side;
        //    the Control Centre's "Shadow resolution" dropdown then OVERRIDES that side and stands regardless of
        //    which tier is selected (WithShadowResolution leaves the tier's value alone only for Auto). That
        //    separation is deliberate: resolution is the setting a user is most likely to want to pin against the
        //    tier's judgement, on a machine whose memory or bandwidth the tier cannot know about.
        {
            const Frontier::FidelityCriteria ShadowCriteria = Frontier::WithShadowResolution(Criteria, S.ShadowResolution);
            Frontier::ShadowFrameConfiguration Shadow{};
            Shadow.MapSide    = ShadowCriteria.ShadowMapSide;
            Shadow.FilterTaps = ShadowCriteria.ShadowFilterTapCount;
            switch (ShadowCriteria.ShadowTechnique)
            {
                case Frontier::ShadowTechniqueCategory::HardShadowMap:
                    Shadow.Filter = Frontier::ShadowFilterCategory::Hard; break;
                case Frontier::ShadowTechniqueCategory::WidePercentageCloserFilter:
                    Shadow.Filter = Frontier::ShadowFilterCategory::Pcf;  break;
                case Frontier::ShadowTechniqueCategory::PercentageCloserSoftShadow:
                default:
                    Shadow.Filter = Frontier::ShadowFilterCategory::Pcss; break;
            }
            SoftwareShadowCriteria.MapSide = Shadow.MapSide;
            SoftwareShadowCriteria.TapCount = Shadow.FilterTaps;
            SoftwareShadowCriteria.Filter = Shadow.Filter == Frontier::ShadowFilterCategory::Hard
                ? Frontier::ShadowFilterKind::HardShadowMap
                : Shadow.Filter == Frontier::ShadowFilterCategory::Pcf
                    ? Frontier::ShadowFilterKind::WidePercentageCloserFilter
                    : Frontier::ShadowFilterKind::PercentageCloserSoftShadow;
            Surface.AssignShadowFrame(Shadow);
        }

        // The celestial budget comes from the SAME tier, through CelestialTier — the one translation from a
        //    quality tier to celestial settings (CheckCelestialTiers forbids reading those fields by hand).
        //
        // The sample counts in it reach the GPU every frame: PackSkyRecord folds Budget.AtmosphereSamples and
        //    Budget.AtmosphereLightSamples into the record RefreshSky pushes to binding 21, so the kernel's sky
        //    integral spends what the tier granted. (A dedicated raster sky pass, SkyView.slang, still does not
        //    exist — the CPU raster reads the same budget through ApplyTo — but the kernel path is live, and both
        //    consumers read this same budget rather than a second copy of the ladder.)
        Celestial.Budget = Frontier::CelestialTier::BudgetFor(Criteria);

        if (Announce)
        {
            char Body[96];
            std::snprintf(Body, sizeof(Body), "%s  |  %s  |  %u candidates, %u extra, GI %s, AA %s, scale %d%%",
                          Frontier::FidelityLabel(S.Quality), Frontier::RenderPathLabel(S.RenderPath),
                          Criteria.ReSTIRCandidateSampleCount, Criteria.ReSTIRExtraCandidateCount,
                          S.GlobalIllumination ? "on" : "off", S.AntiAliasing ? "on" : "off",
                          static_cast<int>(S.RenderScale * 100.0f + 0.5f));
            if (ControlCentre.QueryNotifications().QueryApplied().RenderFinished) Notifications.Push("Render settings applied", Body);
        }
    };

    Camera.AssignAspectRatio(
        static_cast<float>(Surface.QueryWidth()) /
        static_cast<float>(Surface.QueryHeight()));

    Logger.RecordMessage(Frontier::DiagnosticSeverity::Information,
                         "Bootstrap", "Entering render loop.");

    // The celestial controls are screen-space Frontier Editor UI, not a showroom world-space panel. The resolved
    //    image remains a clean production frame so proof captures contain only scene geometry and celestial transport.

    //──────────────────────────────────────────────────────────────────────────
    // Input exchange — filled each frame by GLFW callbacks
    //──────────────────────────────────────────────────────────────────────────
    Frontier::InputExchange Input;

    //──────────────────────────────────────────────────────────────────────────
    // Render loop
    //──────────────────────────────────────────────────────────────────────────
    using Clock    = std::chrono::high_resolution_clock;
    using Duration = std::chrono::duration<float>;

    auto PreviousTime = Clock::now();

    // Scene editor feed — the roster fills once from the live level; the sheet rebuilds whenever the
//    pick moves. One write-back crosses back every tick: the folder tint mirror; the orbit's home
//    seats from the fly camera below.
    //    Without FRONTIER_DEVELOPMENT the panel below ignores all of this (see the ifdef at the feed block).
    Frontier::EditorInstance   SceneInstances[Frontier::kMaxEditorInstances] = {};
    Frontier::ProjectZero::EditorFeedSequence Feed;
    Frontier::EditorSheet    PickedSheet = {};
    bool                     SceneReady = false;
    uint32_t                 SceneRowCount = 0u;
    uint32_t                 SheetFor     = Frontier::kNoEditorInstance;
    Frontier::EditorProperty* TintMirror  = nullptr;
    uint32_t                 AppliedOrbit = 0u;

    while (!Surface.CloseRequested() && !Panel.Convert<bool>())
    {
        const auto  NowTime = Clock::now();
        float       Δτ      = std::chrono::duration_cast<Duration>(NowTime - PreviousTime).count();
        PreviousTime        = NowTime;

        // Clamp Δτ to prevent spiral-of-death on window drag or breakpoints
        if (Δτ > 0.1f) Δτ = 0.1f;

        // ① Poll input — GLFW callbacks forward into Input
        Surface.PollInput(Input);

        // ①b Control Centre owns the pointer while hovered / grabbed / pulled down; the camera never sees those clicks
        //    Display → UI Scale: the overlay lives in logical pixels (physical ÷ scale); the pointer is mapped the same way.
        const float    InterfaceScale = std::clamp(ControlCentre.QueryAppearance().QueryApplied().InterfaceScale / 100.0f, 0.5f, 2.0f);
        const uint32_t LogicalWidth   = std::max(1u, static_cast<uint32_t>(static_cast<float>(Surface.QueryWidth())  / InterfaceScale + 0.5f));
        const uint32_t LogicalHeight  = std::max(1u, static_cast<uint32_t>(static_cast<float>(Surface.QueryHeight()) / InterfaceScale + 0.5f));
        ControlCentre.Resize(LogicalWidth, LogicalHeight);
        ControlCentre.AdvanceInteraction(Input, Input.QueryCursorPositionX() / InterfaceScale, Input.QueryCursorPositionY() / InterfaceScale);
        ControlCentre.AdvanceLocomotion(Δτ);
        Notifications.Advance(Δτ);
        Configuration.Advance(Δτ);
        Telemetry.RecordFrame(Δτ);

        // ①a' The sky and the weather. Ticked here, beside the other per-frame advances, so the clock, the wind
        //     phase and the precipitation pool all move exactly once and in a fixed order. The camera position
        //     is what the precipitation emitter follows — it is a world-space cylinder about the viewer, with no
        //     view direction, which is what keeps rain from following where you look.
        {
            const Frontier::Vector3 Eye = Camera.Convert<Frontier::Vector3>();
            const float CameraWorld[3] = { Eye.x, Eye.y, Eye.z };
            Celestial.Tick(static_cast<float>(Δτ), CameraWorld, 0.0f);
        }

        // ①b' F3 debug popup: view / HiZ / alias-pick toggles persist to [render] and restart the accumulation.
        // R6 row 3: the scheduler's Alias-pick checkbox writes the integrator directly — mirror it into the popup
        //    member before edge-detecting F5 so both toggles converge on one flag.
        Diagnostics.AssignAliasPick(Integrator.QueryConfiguration().AliasPick);
        if (Diagnostics.AdvanceInteraction(Input))
        {
            Configuration.Access().Backend.DebugView        = static_cast<Frontier::DebugViewSelection>(Diagnostics.QueryView());
            Configuration.Access().Backend.OcclusionCulling = Diagnostics.QueryOcclusion();
            Configuration.Access().Backend.AliasPick        = Diagnostics.QueryAliasPick();
            Configuration.MarkDirty();
            Integrator.AssignAliasPick(Diagnostics.QueryAliasPick());   // R6 row 3: F5 flips the kernel's pick live
            Integrator.ResetAccumulation();
        }

        // ①c Dashboard settings → renderer (only when something changed)
        {
            const Frontier::ControlCentreSettings& S = ControlCentre.QuerySettings();
            if (S.Revision != AppliedSettingsRevision)
            {
                const bool First = AppliedSettingsRevision == ~0u;
                ApplyControlCentreSettings(S, false);      // renderer follows every tick (live slider)
                AppliedSettingsRevision = S.Revision;
                if (!First) { Configuration.Access().Render = S; Configuration.MarkDirty(); }   // debounced write, one per gesture
                SettingsQuietSeconds = 0.0f;
                SettingsToastPending = !First;
            }
            else if (SettingsToastPending)
            {
                SettingsQuietSeconds += Δτ;
                if (SettingsQuietSeconds >= 0.4f)          // one toast per gesture, not per drag tick
                {
                    ApplyControlCentreSettings(S, true);
                    SettingsToastPending = false;
                }
            }
        }

        // ①d Appearance page → Apply (explicit, dialogue-confirmed when leaving dirty). Display settings are consumed
        //    here: V-Sync → swapchain present mode, fullscreen → GLFW monitor switch, frame cap → loop pacing below,
        //    resolution → render-target size (step ④).
        {
            const Frontier::AppearanceInspector& A = ControlCentre.QueryAppearance();
            if (A.QueryRevision() != AppliedAppearanceRevision)
            {
                const Frontier::AppearanceSettings& P = A.QueryApplied();
                AppliedAppearanceRevision = A.QueryRevision();
                const bool FirstAppearance = !AppearanceEverApplied;
                AppearanceEverApplied = true;
                if (!FirstAppearance)   // start-up seed: apply silently, nothing to persist or announce
                {
                    Configuration.Access().Appearance = P;
                    if (!Configuration.Save()) std::cerr << "[Configuration] save failed: " << Configuration.QueryLastError() << "\n";
                }
                Surface.AssignPresentPacing(P.VerticalSync == Frontier::VerticalSyncCategory::Off      ? Frontier::PresentPacingCategory::VerticalSyncOff
                                          : P.VerticalSync == Frontier::VerticalSyncCategory::Adaptive ? Frontier::PresentPacingCategory::VerticalSyncAdaptive
                                                                                                        : Frontier::PresentPacingCategory::VerticalSyncOn);
                Surface.AssignFullscreen(P.Fullscreen);
                FrameCapSeconds = P.FrameCap == Frontier::FrameCapCategory::Cap60  ? 1.0f / 60.0f
                                : P.FrameCap == Frontier::FrameCapCategory::Cap120 ? 1.0f / 120.0f
                                : P.FrameCap == Frontier::FrameCapCategory::Cap144 ? 1.0f / 144.0f : 0.0f;
                FixedRenderHeight = P.Resolution == Frontier::RenderResolutionCategory::Quad1440 ? 1440u
                                  : P.Resolution == Frontier::RenderResolutionCategory::Full1080 ? 1080u
                                  : P.Resolution == Frontier::RenderResolutionCategory::Half720  ? 720u : 0u;
                char Body[128];
                const Frontier::TypefaceFamily* Fam = Typefaces.QueryFamily(P.FontFamily);
                std::snprintf(Body, sizeof(Body), "%s  |  %s  |  UI %d%%  |  radius %dpx  |  V-Sync %s%s",
                              Frontier::AppearanceInspector::QueryThemeName(P.Theme), Fam ? Fam->Name.c_str() : "default face", static_cast<int>(P.InterfaceScale),
                              static_cast<int>(P.CornerRadius),
                              P.VerticalSync == Frontier::VerticalSyncCategory::Off ? "off" : P.VerticalSync == Frontier::VerticalSyncCategory::On ? "on" : "adaptive",
                              P.Fullscreen ? "  |  fullscreen" : "");
                if (!FirstAppearance && ControlCentre.QueryNotifications().QueryApplied().RenderFinished) Notifications.Push("Appearance applied", Body);
            }
        }

        // ①e Input page → Save keybindings: sensitivity % → rad/px (50 % = base 0.00125, linear 0.25 × … 2 ×) and
        //    Invert Y-Axis into the fly-through configuration. Profile / shortcut fields are persisted but not yet
        //    consumed by the solver (flagged in the step report).
        {
            const Frontier::InputInspector& I = ControlCentre.QueryInput();
            if (I.QueryRevision() != AppliedInputRevision)
            {
                const bool First = AppliedInputRevision == 0u;
                AppliedInputRevision = I.QueryRevision();
                const Frontier::InputPreferences& P = I.QueryApplied();
                Frontier::ProjectZero::FlyThroughConfiguration C = Camera.QueryConfiguration();
                C.MouseSensitivity = 0.00125f * (0.25f + (P.MouseSensitivity / 100.0f) * 1.75f);
                C.InvertPitch      = P.InvertPitch;
                Camera.AssignConfiguration(C);
                if (!First)
                {
                    Configuration.Access().Input = P;
                    if (!Configuration.Save()) std::cerr << "[Configuration] save failed: " << Configuration.QueryLastError() << "\n";
                    char Body[96];
                    std::snprintf(Body, sizeof(Body), "%s  |  sensitivity %d%%  |  Y-axis %s",
                                  Frontier::InputInspector::QueryProfileName(P.Profile), static_cast<int>(P.MouseSensitivity), P.InvertPitch ? "inverted" : "normal");
                    if (ControlCentre.QueryNotifications().QueryApplied().RenderFinished) Notifications.Push("Keybindings saved", Body);
                }
            }
        }

        // ①f Notifications page → Save Preferences: overlay rows, toast dwell, alert gates.
        {
            const Frontier::NotificationInspector& N = ControlCentre.QueryNotifications();
            if (N.QueryRevision() != AppliedNotifyRevision)
            {
                const bool First = AppliedNotifyRevision == 0u;
                AppliedNotifyRevision = N.QueryRevision();
                const Frontier::NotificationPreferences& P = N.QueryApplied();
                Notifications.AssignHoldSeconds(P.HoldSeconds);
                Frontier::TelemetryRowStructure Rows = Telemetry.QueryRows();
                Rows.ShowMemory = P.ShowMemoryUsage;
                Rows.ShowScene  = P.ShowSceneMetadata;
                Telemetry.AssignRows(Rows);
                if (!First)
                {
                    Configuration.Access().Notifications = P;
                    if (!Configuration.Save()) std::cerr << "[Configuration] save failed: " << Configuration.QueryLastError() << "\n";
                    if (P.RenderFinished) Notifications.Push("Notification preferences saved");
                }
            }
        }

        // ①g Alert gates: "Autosave Errors" (preference writes), "Baking Complete" (accumulation converged),
        //    "Frame-rate Drops" (2 s average under 30 fps, once per episode).
        {
            const Frontier::NotificationPreferences& P = ControlCentre.QueryNotifications().QueryApplied();
            if (P.AutosaveErrors && !Configuration.QueryLastError().empty() && Configuration.QueryLastError() != LastSaveError)
            {
                LastSaveError = Configuration.QueryLastError();
                Notifications.Push("Configuration could not be saved", LastSaveError);
            }
            if (Integrator.QueryAccumulationIndex() < BakeFrameCount) BakeAnnounced = false;
            else if (!BakeAnnounced)
            {
                BakeAnnounced = true;
                if (P.BakingComplete) { char Body[64]; std::snprintf(Body, sizeof(Body), "%u frames accumulated", BakeFrameCount); Notifications.Push("Baking complete", Body); }
            }
            if (Telemetry.ConsumeFrameRateDrop(30.0f) && P.FrameRateDrops)
            {
                char Body[64]; std::snprintf(Body, sizeof(Body), "%.0f fps average over the last 2 s", static_cast<double>(Telemetry.QueryAverageFramesPerSecond()));
                Notifications.Push("Frame-rate drop", Body);
            }
        }

        // ①c Text-queue drain. No text consumer remains — the development editor reads keystrokes
        //    through ImGui itself — so the queue is drained every tick and Escape still closes the window.
        for (uint32_t I = 0u; I < Input.QueryEditKeyCount(); ++I)
            if (Input.QueryEditKey(I) == 256u) Surface.RequestClose();
        Input.ClearTextQueue();

        // ② Advance camera kinematics (frozen while the Control Centre owns the pointer, or an ImGui
        //    window has captured the pointer or keyboard — a drag that started on a panel must not fly
        //    the camera, and a keystroke typed into one must not fire a shortcut).
        if (!ControlCentre.CoversPointer() && !Panel.QueryEditorCapturesPointer()
            && !Panel.QueryEditorCapturesKeyboard())
            Camera.AdvanceLocomotion(Input, Δτ);
        Camera.AssignAspectRatio(
            static_cast<float>(Surface.QueryWidth()) /
            static_cast<float>(Surface.QueryHeight()));

        // ③ Build ImGui draw data (calls ImGui::NewFrame → ImGui::Render internally); the Control Centre records
        //    itself onto the foreground list between NewFrame and Render via the overlay hook.
        // ②c Scene editor feed: the roster fills once, the sheet follows the pick, and the folder
        //    tint mirror carries back onto the row every tick. Development only: without the define the
        //    editor records nothing, so feeding it would be dead work on a shipping build.
#ifdef FRONTIER_DEVELOPMENT
        if (!SceneReady)
        {
            SceneRowCount = Feed.FillRoster(SceneInstances, Level);
            // The celestial entities follow the scene's own rows, under their own folder. Appended rather
            //    than merged so the scene walk stays exactly what it was.
            CelestialFirstRow = SceneRowCount;
            SceneRowCount += Celestial.AppendRoster(SceneInstances, SceneRowCount, Frontier::kMaxEditorInstances);
            Frontier::ViewportOrbit Home;
            float Middle[3] = { 0.0f, 0.0f, 0.0f };
            Frontier::ProjectZero::QueryLevelCentre(Level, Middle);
            const Frontier::Vector3 At = Camera.Convert<Frontier::Vector3>();
            const float Dx = At.x - Middle[0], Dy = At.y - Middle[1], Dz = At.z - Middle[2];
            Home.Yaw      = Camera.QueryYawRadians();
            Home.Pitch    = Camera.QueryPitchRadians();
            Home.Distance = std::sqrt(Dx * Dx + Dy * Dy + Dz * Dz);
            if (Home.Distance < 0.5f)
                Home.Distance = 4.5f;
            Home.Target[0] = Middle[0]; Home.Target[1] = Middle[1]; Home.Target[2] = Middle[2];
            Home.Ortho = false; Home.ViewPoint = 0u; Home.Revision = 0u;
            Panel.SeatViewportOrbit(Home);
            AppliedOrbit = 0u;
            SceneReady   = true;
        }
        const uint32_t PickedNow = Panel.QueryPickedInstance();
        Frontier::ProjectZero::CelestialEntity PickedCelestial{};
        const bool CelestialPicked = CelestialFirstRow != Frontier::kNoEditorInstance
                                  && Celestial.Owns(PickedNow, CelestialFirstRow, PickedCelestial);
        if (PickedNow != SheetFor)
        {
            if (CelestialPicked)
            {
                Celestial.BuildSheet(PickedCelestial, PickedSheet);
                TintMirror = nullptr;   // celestial rows carry no folder tint to mirror back
            }
            else
            {
                TintMirror = Feed.BuildSheet(PickedNow, SceneInstances, SceneRowCount, &PickedSheet,
                                             Camera, Level, AnimatedInstances);
            }
            SheetFor   = PickedNow;
        }
        else if (CelestialPicked)
        {
            // The panel edits the sheet in place, so the write-back happens every tick the row stays picked.
            //    Read-outs are then refreshed from the state the edit just changed.
            Celestial.ApplySheet(PickedCelestial, PickedSheet);
            Celestial.BuildSheet(PickedCelestial, PickedSheet);
        }
        // The outliner's eye toggles live on the rows; carry them back so hiding a row hides the thing.
        if (CelestialFirstRow != Frontier::kNoEditorInstance)
        {
            Celestial.Enabled = SceneInstances[CelestialFirstRow].Visible;
            for (uint32_t E = 0; E < Frontier::ProjectZero::kCelestialEntityCount; ++E)
            {
                const uint32_t Row = CelestialFirstRow + 1u + E;
                if (Row < SceneRowCount) Celestial.Shown[E] = SceneInstances[Row].Visible;
            }
        }
#else
        (void)SceneReady; (void)SceneRowCount; (void)SheetFor; (void)TintMirror; (void)AppliedOrbit;
#endif

        Panel.Present(Integrator, Camera, Scene,
                      Surface.QueryWidth(), Surface.QueryHeight(),
                      SceneInstances, SceneRowCount, &PickedSheet,
                      [&]()
                      {
                          if (OverlaySurface.Begin(Frontier::SurfaceLayer::Above,
                                                   static_cast<float>(Surface.QueryWidth()),
                                                   static_cast<float>(Surface.QueryHeight()),
                                                   InterfaceScale))
                          {
                              // Scene overlays hang from the closed notch line; the pulled-down sheet covers the FPS
                              //    readout, while toasts are drawn after the shade so a settings change is acknowledged
                              //    on top of the dashboard that caused it.
                              const float NotchLine = ControlCentre.QueryHandleHeight();
                              if (ControlCentre.QuerySettings().FrameRateOverlay)
                                  Telemetry.ConstructTelemetryLayout(OverlaySurface, NotchLine);
                              Diagnostics.ConstructInspectorLayout(OverlaySurface, NotchLine, static_cast<float>(LogicalWidth),
                                                                   Surface.QueryVisibilityTelemetry(), Surface.QueryClusterCount(), Surface.QueryDrawIndirectCount(),
                                                                   Integrator.QueryConfiguration(), Level.QueryMaterials().QueryMetrics(),
                                                                   Textures.QueryMetrics(), MaxTextureLevels);
                              ControlCentre.ConstructControlLayout(OverlaySurface);
                              Notifications.ConstructNotificationLayout(OverlaySurface, NotchLine);
                          }

                      });

#ifdef FRONTIER_DEVELOPMENT
        // ②d The tint write-back: a folder tint edited in the sheet lands back on its row.
        if (TintMirror != nullptr && PickedNow < SceneRowCount)
        {
            SceneInstances[PickedNow].Tint[0] = TintMirror->ColourTint[0];
            SceneInstances[PickedNow].Tint[1] = TintMirror->ColourTint[1];
            SceneInstances[PickedNow].Tint[2] = TintMirror->ColourTint[2];
        }
        // ②f The view write-back: a fresh orbit revision poses the fly camera (the eye off the orbit's
        //    figures), so the views menu and the gizmo steer the rendered view.
        const Frontier::ViewportOrbit& Orbit = Panel.QueryViewportOrbit();
        if (Orbit.Revision != AppliedOrbit)
        {
            const float Cy = std::cos(Orbit.Yaw), Sy = std::sin(Orbit.Yaw);
            const float Cp = std::cos(Orbit.Pitch), Sp = std::sin(Orbit.Pitch);
            const float Fx = Sy * Cp, Fy = Cy * Cp, Fz = Sp;
            Camera.AssignSpatialLocation(Frontier::Vector3{ Orbit.Target[0] - Fx * Orbit.Distance,
                                                            Orbit.Target[1] - Fy * Orbit.Distance,
                                                            Orbit.Target[2] - Fz * Orbit.Distance });
            Camera.AssignOrientationEuler(Orbit.Pitch, Orbit.Yaw, 0.0f);
            AppliedOrbit = Orbit.Revision;
        }
#endif

        // ④ Build dispatch configuration from live camera + integrator state (camera motion restarts accumulation)
        //    Render scale: the kernel runs on a sub-rectangle of the storage image and the blit stretches it.
        //    Display → Resolution: Native follows the dashboard render-scale slider; a fixed preset renders at that
        //    height (window aspect preserved), never above the swapchain size, and the scale slider still multiplies it.
        const float    RenderScale  = ControlCentre.QuerySettings().RenderScale;
        const float    FixedFactor  = FixedRenderHeight > 0u ? std::min(1.0f, static_cast<float>(FixedRenderHeight) / static_cast<float>(std::max(1u, Surface.QueryHeight()))) : 1.0f;
        const uint32_t RenderWidth  = std::max(1u, static_cast<uint32_t>(static_cast<float>(Surface.QueryWidth())  * RenderScale * FixedFactor + 0.5f));
        const uint32_t RenderHeight = std::max(1u, static_cast<uint32_t>(static_cast<float>(Surface.QueryHeight()) * RenderScale * FixedFactor + 0.5f));

        // A6b — adaptive exposure. The measurement is one or two frames stale because it is read from the cycle
        //    slot the GPU has already finished with; against time constants of half a second and up that is
        //    invisible, and it is what keeps the read from stalling the CPU on the GPU.
        {
            const float Measured = Surface.QueryAverageLogLuminance();
            if (Measured > -1.0e8f) Integrator.Exposure().ObserveLuminance(Measured);
            Integrator.Exposure().Advance(Δτ);
        }

        Integrator.ObserveCamera(Camera, RenderWidth, RenderHeight);
        if (Telemetry.QueryRows().ShowScene)
        {
            char Line[192];
            const Frontier::ControlCentreSettings& RenderSettings = ControlCentre.QuerySettings();
            std::snprintf(Line, sizeof(Line), "%s  |  %s  |  GI %s  |  %u tris  |  %u luminaire tris  |  %ux%u  |  frame %u  |  %s",
                          Level.QueryName().c_str(), Frontier::RenderPathLabel(RenderSettings.RenderPath),
                          RenderSettings.GlobalIllumination ? "on" : "off", Level.QueryTriangleCount(), LuminaireCount,
                          RenderWidth, RenderHeight, Integrator.QueryAccumulationIndex(),
                          Frontier::RayTracingCapabilitySet::TierName(Surface.QueryRayTracingTier()));
            Frontier::TelemetryRowStructure Rows = Telemetry.QueryRows(); Rows.SceneLine = Line; Telemetry.AssignRows(Rows);
        }

        const Frontier::DispatchConfiguration Dispatch = Integrator.BuildDispatch(
            Camera,
            RenderWidth,
            RenderHeight,
            AlphaMaskedMaterialCount,
            LuminaireCount);

        // ④b R2 front end: same camera, reverse-Z infinite projection; AA jitter is a per-frame Halton(2,3) offset shared
        //    by the raster and the resolve (pixel centre when AA is off).
        {
            Frontier::VisibilityFrameConfiguration Frame{};
            Frame.Camera.Origin             = Camera.QuerySpatialLocation();
            Frame.Camera.Forward            = Camera.QueryForwardVector();
            Frame.Camera.Right              = Camera.QueryRightVector();
            Frame.Camera.Up                 = Camera.QueryUpwardVector();
            Frame.Camera.TanHalfFieldOfView = Dispatch.FieldOfViewTanHalf;
            Frame.Camera.AspectRatio        = Camera.QueryAspectRatio();
            Frame.Camera.NearDistance       = Camera.QueryNearPlaneDistance();
            Frame.RenderWidth               = RenderWidth;
            Frame.RenderHeight              = RenderHeight;
            const auto Halton = [](uint32_t Index, uint32_t Base) { float F = 1.0f, R = 0.0f; for (Index += 1u; Index > 0u; Index /= Base) { F /= static_cast<float>(Base); R += F * static_cast<float>(Index % Base); } return R; };
            const bool Jittered = Integrator.QueryConfiguration().AntiAliasing;
            Frame.JitterX          = Jittered ? Halton(Integrator.QueryAccumulationIndex(), 2u) : 0.5f;
            Frame.JitterY          = Jittered ? Halton(Integrator.QueryAccumulationIndex(), 3u) : 0.5f;
            Frame.FrameIndex       = Integrator.QueryAccumulationIndex();
            Frame.DebugView        = Diagnostics.QueryView();
            Frame.OcclusionCulling = Diagnostics.QueryOcclusion();
            Frame.ConeCulling      = false;   // the kernel shades both faces; cone culling would remove back-facing walls seen from outside
            Surface.AssignVisibilityFrame(Frame);
        }

        // ④d GPU sky — the kernel reads the packed record at binding 21 on every miss and every escaped bounce.
        //     Pushed every frame like the instances: 320 bytes of atmosphere and weather, and the sun moves.
        //     Refusal is impossible here by construction (the size is pinned by static_assert and the device is up),
        //     so the nodiscard is cast away — there is nothing to fall back to, and the previous contents stand,
        //     which is a stale sky rather than a torn one.
        {
            const Frontier::SkyConstantRecord Sky = Celestial.PackSkyRecord();
            (void)Surface.RefreshSky(&Sky, sizeof(Sky));
            // A slider step on a converged frame is absorbed at 1/n — invisible until the camera restarts the
            //    history, which is why panel edits used to land only when the view moved. Compare the packed
            //    bytes and restart the accumulation the tick the sky changes, so sliders, presets, visibility
            //    toggles and the moving sun all show at once. The packer zero-fills then assigns every field,
            //    so padding is deterministic and the compare is exact; while the sun animates the history
            //    restarts every tick — noisy while moving, exactly like the camera, instead of a smeared trail.
            if (std::memcmp(&Sky, &LastSky, sizeof(Sky)) != 0)
            {
                LastSky = Sky;
                Integrator.ResetAccumulation();
            }
        }

        // ④e GPU moons — the roster reads the packed record at binding 22 on every miss and every escaped
        //     bounce, and the direct fill lights the primary hit. Pushed every frame beside the sky: 288 bytes,
        //     and Luna moves. Same no-fallback shape as the sky — the previous roster stands, which is stale
        //     moons rather than torn ones.
        {
            const Frontier::MoonConstantRecord Moons = Celestial.PackMoonRecord();
            (void)Surface.RefreshMoons(&Moons, sizeof(Moons));
            // Same shape as the sky above: a moon slider step is absorbed at 1/n on a converged frame, so the
            //    roster bytes are compared and the accumulation restarts the tick anything lands.
            if (std::memcmp(&Moons, &LastMoons, sizeof(Moons)) != 0)
            {
                LastMoons = Moons;
                Integrator.ResetAccumulation();
            }
        }

        // ④f GPU post — stars, flare and rainbow ride one 128-byte record at binding 24. The flare's occlusion
        //     is a single camera→sun ray through the CPU traversal: the header's "never per frame" guidance
        //     targets per-pixel tracing, and one ray is microseconds — the one query the flare's own spec
        //     demands (light that never entered the lens cannot bounce in it). Pushed every frame beside the
        //     sky and moons, and compared like them, so star/flare/bow sliders land the tick they move.
        {
            const Frontier::Vector3 Eye = Camera.QuerySpatialLocation();
            const float EyeArray[3] = { Eye.x, Eye.y, Eye.z };
            const Frontier::CelestialFrame& Frame = Celestial.Frame();
            float SunVisibility = 1.0f;
            if (Traversal.IsReady())
            {
                float HitDistance = 0.0f; uint32_t HitPrimitive = 0u;
                if (Traversal.TraceClosest(EyeArray, Frame.Sun.Direction, HitDistance, HitPrimitive))
                    SunVisibility = 0.0f;
            }
            const Frontier::Vector3 Forward = Camera.QueryForwardVector();
            const Frontier::Vector3 Right   = Camera.QueryRightVector();
            const Frontier::Vector3 Upward  = Camera.QueryUpwardVector();
            const float ForwardArray[3] = { Forward.x, Forward.y, Forward.z };
            const float RightArray[3]   = { Right.x, Right.y, Right.z };
            const float UpArray[3]      = { Upward.x, Upward.y, Upward.z };
            const Frontier::PostConstantRecord Post =
                Celestial.PackPostRecord(ForwardArray, RightArray, UpArray, Dispatch.FieldOfViewTanHalf,
                                         Camera.QueryAspectRatio(), RenderHeight, SunVisibility);
            (void)Surface.RefreshPost(&Post, sizeof(Post));
            if (std::memcmp(&Post, &LastPost, sizeof(Post)) != 0)
            {
                LastPost = Post;
                Integrator.ResetAccumulation();
            }
        }

        // ⑤ The explicit software path executes the production CPU VisibilityRaster and uploads its result. It is
        //    intentionally independent of the quality ladder and of ReSTIR GI; the latter is never used as a fallback.
        if (ControlCentre.QuerySettings().RenderPath == Frontier::RenderPathSelection::VisibilityRaster)
        {
            Celestial.ApplyTo(SoftwareRaster, Celestial.Budget);
            SoftwareRaster.AssignShadowCriteria(SoftwareShadowCriteria);
            SoftwareRasterPixels.resize(static_cast<size_t>(RenderWidth) * RenderHeight * 4u);
            const Frontier::Vector3 Eye = Camera.QuerySpatialLocation();
            const Frontier::Vector3 Forward = Camera.QueryForwardVector();
            const Frontier::Vector3 Right = Camera.QueryRightVector();
            const Frontier::Vector3 Upward = Camera.QueryUpwardVector();
            double MeanLuminance = 0.0;
            const bool Rendered = SoftwareRaster.Render(
                Level, &Eye.x, &Forward.x, &Right.x, &Upward.x,
                Camera.QueryFieldOfViewRadians(), RenderWidth, RenderHeight,
                SoftwareRasterPixels.data(), MeanLuminance);
            if (!Rendered || !Surface.UploadSoftwareRasterFrame(SoftwareRasterPixels.data(), RenderWidth, RenderHeight))
            {
                // The strict Swapchain branch shows its deterministic diagnostic colour; it never dispatches ReSTIR.
                SoftwareRasterPixels.clear();
                Surface.InvalidateSoftwareRasterFrame();
            }
        }

        // ⑥ Cull → raster → HiZ → resolve → kernel, or the CPU software upload, then blit/present ImGui.
        Surface.RecordAndPresent(Dispatch);

        Integrator.IncrementAccumulationIndex();

        // Display → Frame Cap: sleep out the remainder of the frame budget (coarse sleep, then spin the last ~1 ms so
        //    the cap holds on Windows' 1 ms timer granularity). Unlimited = 0 → no pacing.
        if (FrameCapSeconds > 0.0f)
        {
            const auto Deadline = NowTime + std::chrono::duration_cast<Clock::duration>(Duration(FrameCapSeconds));
            const auto Coarse   = Deadline - std::chrono::milliseconds(1);
            if (Clock::now() < Coarse) std::this_thread::sleep_until(Coarse);
            while (Clock::now() < Deadline) { }
        }

        // Keep the on-disk telemetry current even if the process is killed mid-run.
        if ((Integrator.QueryAccumulationIndex() & 63u) == 0u) Logger.FlushSink();
    }

    //──────────────────────────────────────────────────────────────────────────
    // Shutdown
    //──────────────────────────────────────────────────────────────────────────
    Surface.Retire();

    Logger.RecordMessage(Frontier::DiagnosticSeverity::Information,
                         "Shutdown", "Render loop exited cleanly.");

    Logger.TerminateSink();

    return 0;
}
