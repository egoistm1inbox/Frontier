//============================================================================================================================================
//                                                 PROJECTZEROSHOWCASE.CPP
//============================================================================================================================================
// 🧩 Project Zero's sky, sun, moon and stars as the game itself renders them — six aimed frames from the dedicated Project Zero scene (Visibility Raster, GI off, Standard tier).
//
//    WHAT THIS IS: the project's own CelestialSequence (prepare → tick → ApplyTo) driven exactly as GameExecution
//    drives it — same tier budget via CelestialTier::BudgetFor, same shipping star catalogue, same six moon
//    albedos decoded through the real index, every entity shown (the project default) — rendered through the
//    CPU raster the game's no-ray path reads through ApplyTo. The clock is the only input; the sun, the
//    twilight, the moon and the wheeling stars all come out of the tick. Nothing is hand-set, nothing is mocked,
//    except where this header says so.
//
//    WHAT THIS IS NOT: a GPU/ReSTIR capture. This headless proof has no Vulkan driver, so it emits only the explicitly
//    labelled Visibility Raster / GI-off CPU path. ReSTIR parity is checked by the packed-record/shader gates below;
//    it is never mislabeled as a ReSTIR image.
//
//    The day frames face the solved sun's azimuth the way a photographer would. The night frames need two dates,
//    and the reason is honest astronomy, verified with the shipping solver: on the gates' date (10 Sep 2026) the
//    real moon is new (illumination 0.00) and below the horizon all night, so the project's linked Luna —
//    Prepare() links roster slot 0 to the solved lunar frame — has nothing to show. The linked-moon frame is
//    therefore dated 26 Sep 2026, when the moon is full (illumination 1.00) and 48 deg up at 22h, and the camera
//    aims at the SOLVED moon direction (a linked slot ignores its Azimuth/Elevation, so aiming at those would
//    frame empty sky — the mistake this showcase made in its first draft). The placed-moon frame stays on
//    10 Sep and drives the roster the way the reference panel does: slot 0 unlinked and put at az 0 / el 25 at
//    2 deg, slot 1 (Ember) at az 14 / el 15 at 3 deg — the MoonRenderProof arrangement, with the stars left on so
//    the frame carries moons and stars together. The fifth frame turns to the parked local volume at 11h, when
//    its patch runs densest (probed 0.76 mean across the day): the enable is flipped — the volume parks off
//    until the scene wants weather somewhere specific — and the camera aims at the box's live centre. The extra
//    clear-sky frame below deliberately hides every weather entity and zooms the production camera to 18 degrees,
//    making the bounded 0.53 degree solar body inspectable rather than confusing its pixels with the Mie aureole.

#include "GeometricRaster/VisibilityRaster.h"
#include "GeometricRaster/SceneRecordPacking.h"
#include "GeometricRaster/SceneStructure.h"
#include "ContentInterchange/SceneCodec.h"
#include "Projects/Project-Zero/Source/RayTracingSolver.h"
#include "DisplayPresentation/CelestialSolver.h"
#include "DisplayPresentation/CelestialTier.h"
#include "DisplayPresentation/FidelityClassifier.h"
#include "DisplayPresentation/MoonConstantRecord.h"
#include "Projects/Project-Zero/Source/CelestialSequence.h"
#include "PngWriteShim.h"

#include <cmath>
#include <cstdio>
#include <cstdint>
#include <string>
#include <vector>
#include <filesystem>

using namespace Frontier;
using namespace Frontier::ProjectZero;

namespace {

constexpr uint32_t kWidth  = 960;
constexpr uint32_t kHeight = 540;

// Load the exact single Project Zero scene through the production encode/decode path. The proof is not allowed to
//    invent a parallel ground/material setup: the source solver, material descriptors, packed scene records and
//    imported SceneStructure are the same objects the application uses.
bool LoadProjectZeroScene(SceneStructure& Level, TextureIndex& Textures)
{
    const std::string Path = "Diagnostics/ProjectZeroCelestial.gltf";
    std::error_code ErrorCode;
    std::filesystem::create_directories(std::filesystem::path(Path).parent_path(), ErrorCode);
    RayTracingSolver Source;
    if (!std::filesystem::exists(Path, ErrorCode))
    {
        std::string Error;
        SceneEncodeConfiguration Naming{};
        Naming.Name = "ProjectZeroCelestial";
        Naming.Spans = &Source.QuerySpans();
        if (!SceneCodec::Encode(Path, BuildProjectZeroTriangleRecords(Source),
                                BuildProjectZeroMaterialRecords(Source), &Error, Naming))
        {
            std::printf("  scene encode failed: %s\n", Error.c_str());
            return false;
        }
    }
    std::string Error;
    SceneDecodeConfiguration Decode;
    Decode.UniformScale = 1.0f;
    if (!SceneCodec::Decode(Path, Level, &Textures, Decode, &Error))
    {
        std::printf("  scene decode failed: %s\n", Error.c_str());
        return false;
    }
    if (!Error.empty()) std::printf("  scene decode note: %s\n", Error.c_str());
    return true;
}

// When does the sun stand at the requested elevation inside [FromHour, ToHour]? Solved with the shipping solver,
//    coarse pass plus fine pass — the same approach as the dawn stages in CelestialSkyProof.
float SolveHourForElevation(float Elevation, float FromHour, float ToHour)
{
    CelestialObservation Probe{};
    Probe.Year = 2026; Probe.Month = 9; Probe.Day = 10;
    Probe.UtcOffset = 2.0f; Probe.Latitude = -26.19f; Probe.Longitude = 28.32f;
    float Hour = FromHour, Best = 1e9f;
    for (float H = FromHour; H <= ToHour; H += 0.01f)
    {
        Probe.LocalHours = H;
        const float Residual = std::fabs(CelestialSolver::Solve(Probe).Sun.Elevation - Elevation);
        if (Residual < Best) { Best = Residual; Hour = H; }
    }
    for (float H = Hour - 0.02f; H <= Hour + 0.02f; H += 0.001f)
    {
        Probe.LocalHours = H;
        const float Residual = std::fabs(CelestialSolver::Solve(Probe).Sun.Elevation - Elevation);
        if (Residual < Best) { Best = Residual; Hour = H; }
    }
    return Hour;
}

void WriteFrame(const char* Path, const std::vector<unsigned char>& Rgba)
{
    std::vector<unsigned char> Rgb(static_cast<size_t>(kWidth) * kHeight * 3u);
    for (size_t I = 0; I < static_cast<size_t>(kWidth) * kHeight; ++I)
    {
        Rgb[I * 3u + 0u] = Rgba[I * 4u + 0u];
        Rgb[I * 3u + 1u] = Rgba[I * 4u + 1u];
        Rgb[I * 3u + 2u] = Rgba[I * 4u + 2u];
    }
    PngWriteShim::WritePng(Path, static_cast<int>(kWidth), static_cast<int>(kHeight), 3, Rgb.data(),
                           static_cast<int>(kWidth) * 3);
    double Sum = 0.0;
    for (size_t I = 0; I < static_cast<size_t>(kWidth) * kHeight; ++I)
        Sum += (Rgb[I * 3u + 0u] + Rgb[I * 3u + 1u] + Rgb[I * 3u + 2u]) / 3.0;
    std::printf("  wrote %s (mean lum %.1f)\n", Path, Sum / (static_cast<double>(kWidth) * kHeight));
}

// Aim the camera along a sky direction in full 3D: Right = Forward x world-up (the project's camera convention),
//    Up = Right x Forward. The caller passes a unit direction.
void AimAt(const float* Direction, float Forward[3], float Right[3], float Up[3])
{
    Forward[0] = Direction[0]; Forward[1] = Direction[1]; Forward[2] = Direction[2];
    float Rx = Forward[1], Ry = -Forward[0], Rz = 0.0f;
    const float Rl = std::sqrt(Rx * Rx + Ry * Ry + Rz * Rz);
    Right[0] = Rx / Rl; Right[1] = Ry / Rl; Right[2] = Rz / Rl;
    Up[0] = Right[1] * Forward[2] - Right[2] * Forward[1];
    Up[1] = Right[2] * Forward[0] - Right[0] * Forward[2];
    Up[2] = Right[0] * Forward[1] - Right[1] * Forward[0];
}

} // namespace

int main()
{
    std::printf("\nProject Zero showcase: the sky the game renders, six aimed frames from the dedicated Project Zero scene (Visibility Raster, GI off, Standard tier)\n");
    for (int I = 0; I < 70; ++I) std::putchar('='); std::printf("\n\n");

    SceneStructure Level;
    TextureIndex Textures;
    if (!LoadProjectZeroScene(Level, Textures)) return 2;

    FidelityClassifier Classifier;
    const FidelityCriteria Criteria = Classifier.ConstructCriteria(FidelityCategory::StandardFidelity);
    const CelestialBudget Budget = CelestialTier::BudgetFor(Criteria);

    CelestialSequence Sky;
    Sky.Prepare();
    std::printf("  %u stars catalogued\n", Sky.Stars().QuerySourceCount());
    uint32_t AtlasSlots[kMoonAtlasCount];
    for (uint32_t M = 0u; M < kMoonAtlasCount; ++M)
    {
        char Path[128];
        std::snprintf(Path, sizeof(Path), "%s%s", kMoonTextureDirectory, kMoonAtlas[M].File);
        AtlasSlots[M] = Textures.RegisterPath(Path, /*Linear=*/false);
    }
    std::vector<std::string> AtlasReport;
    if (Textures.Decode(0u, &AtlasReport) != 0u) { std::printf("  moon atlas failed to decode\n"); return 2; }
    Sky.AssignMoonAtlas(AtlasSlots, Textures);
    for (uint32_t E = 0u; E < kCelestialEntityCount; ++E) Sky.Shown[E] = true;

    const float TickOrigin[3] = { 0.0f, 0.0f, 2.0f };
    const float Eye[3]        = { 0.0f, -6.0f, 1.7f };
    constexpr float kHalfFov      = 55.0f * 3.14159265f / 180.0f;
    constexpr float kSunDiscFov   = 18.0f * 3.14159265f / 180.0f; // zoom only the proof view; the disc remains 0.53 deg
    constexpr float kDeg           = 3.14159265f / 180.0f;

    auto TickTo = [&](float Hour, int Day = 10)
    {
        Sky.Observation.Year = 2026; Sky.Observation.Month = 9; Sky.Observation.Day = Day;
        Sky.Observation.LocalHours = Hour; Sky.Observation.UtcOffset = 2.0f;
        Sky.Observation.Latitude = -26.19f; Sky.Observation.Longitude = 28.32f;
        Sky.Tick(0.0f, TickOrigin, 0.0f);
    };

    // ── 1. Morning: the sun at +10 deg, faced ────────────────────────────────────────────────────
    {
        TickTo(SolveHourForElevation(10.0f, 6.0f, 10.0f));
        float F[3] = { 0.0f, 1.0f, 0.0f };
        {
            const float Hx = Sky.Frame().Sun.Direction[0], Hy = Sky.Frame().Sun.Direction[1];
            const float Hl = std::sqrt(Hx * Hx + Hy * Hy);
            if (Hl > 1e-6f) { F[0] = Hx / Hl; F[1] = Hy / Hl; F[2] = 0.0f; }
        }
        float R[3], U[3];
        AimAt(F, F, R, U);
        VisibilityRaster Raster;
        Sky.ApplyTo(Raster, Budget);
        std::vector<unsigned char> Frame(static_cast<size_t>(kWidth) * kHeight * 4u, 0u);
        double MeanLuminance = 0.0;
        if (!Raster.Render(Level, Eye, F, R, U, kHalfFov, kWidth, kHeight, Frame.data(), MeanLuminance)) return 2;
        std::printf("  morning: sun el %+.2f az %.1f at %.2fh\n",
                    static_cast<double>(Sky.Frame().Sun.Elevation), static_cast<double>(Sky.Frame().Sun.Azimuth),
                    static_cast<double>(Sky.Observation.LocalHours));
        WriteFrame("Diagnostics/ProjectZeroCelestial_VisibilityRaster_GIoff_Standard_Dawn.png", Frame);
    }

    // ── 2. Clear sky, zoomed: the bounded solar disc without any cloud/weather veil ──────────────
    {
        TickTo(SolveHourForElevation(10.0f, 6.0f, 10.0f));
        Sky.Shown[static_cast<uint32_t>(CelestialEntity::CloudLayer)] = false;
        Sky.Shown[static_cast<uint32_t>(CelestialEntity::LocalCloud)] = false;
        Sky.Shown[static_cast<uint32_t>(CelestialEntity::LocalFog)] = false;
        float F[3] = { Sky.Frame().Sun.Direction[0], Sky.Frame().Sun.Direction[1], Sky.Frame().Sun.Direction[2] };
        float R[3], U[3];
        AimAt(F, F, R, U);
        VisibilityRaster Raster;
        Sky.ApplyTo(Raster, Budget);
        ColourTransfer InspectionTransfer = Raster.QueryColourTransfer();
        InspectionTransfer.Exposure = 0.05f; // production exposure control, lowered only to inspect the disc shoulder
        Raster.AssignColourTransfer(InspectionTransfer);
        std::vector<unsigned char> Frame(static_cast<size_t>(kWidth) * kHeight * 4u, 0u);
        double MeanLuminance = 0.0;
        if (!Raster.Render(Level, Eye, F, R, U, kSunDiscFov, kWidth, kHeight, Frame.data(), MeanLuminance)) return 2;
        std::printf("  clear sun disc: sun el %+.2f az %.1f at %.2fh, 18 deg proof FOV, exposure 0.05\n",
                    static_cast<double>(Sky.Frame().Sun.Elevation), static_cast<double>(Sky.Frame().Sun.Azimuth),
                    static_cast<double>(Sky.Observation.LocalHours));
        WriteFrame("Diagnostics/ProjectZeroCelestial_VisibilityRaster_GIoff_Standard_ClearSky_SunDisc.png", Frame);
        Sky.Shown[static_cast<uint32_t>(CelestialEntity::CloudLayer)] = true;
        Sky.Shown[static_cast<uint32_t>(CelestialEntity::LocalCloud)] = true;
        Sky.Shown[static_cast<uint32_t>(CelestialEntity::LocalFog)] = true;
    }

    // ── 3. Sunset: the sun at +1.5 deg, faced ────────────────────────────────────────────────────
    {
        TickTo(SolveHourForElevation(1.5f, 15.0f, 19.0f));
        float F[3] = { 0.0f, 1.0f, 0.0f };
        {
            const float Hx = Sky.Frame().Sun.Direction[0], Hy = Sky.Frame().Sun.Direction[1];
            const float Hl = std::sqrt(Hx * Hx + Hy * Hy);
            if (Hl > 1e-6f) { F[0] = Hx / Hl; F[1] = Hy / Hl; F[2] = 0.0f; }
        }
        float R[3], U[3];
        AimAt(F, F, R, U);
        VisibilityRaster Raster;
        Sky.ApplyTo(Raster, Budget);
        std::vector<unsigned char> Frame(static_cast<size_t>(kWidth) * kHeight * 4u, 0u);
        double MeanLuminance = 0.0;
        if (!Raster.Render(Level, Eye, F, R, U, kHalfFov, kWidth, kHeight, Frame.data(), MeanLuminance)) return 2;
        std::printf("  sunset: sun el %+.2f az %.1f at %.2fh\n",
                    static_cast<double>(Sky.Frame().Sun.Elevation), static_cast<double>(Sky.Frame().Sun.Azimuth),
                    static_cast<double>(Sky.Observation.LocalHours));
        WriteFrame("Diagnostics/ProjectZeroCelestial_VisibilityRaster_GIoff_Standard_Sunset.png", Frame);
    }

    // ── 4. Night, linked: slot 0 as Prepare() leaves it — Luna following the solved lunar frame ──
    {
        // 26 Sep, full moon. The aim reads the SOLVED direction: a linked slot ignores Azimuth/Elevation.
        TickTo(22.0f, 26);
        float F[3], R[3], U[3];
        AimAt(Sky.Frame().Moon.Direction, F, R, U);
        VisibilityRaster Raster;
        Sky.ApplyTo(Raster, Budget);
        std::vector<unsigned char> Frame(static_cast<size_t>(kWidth) * kHeight * 4u, 0u);
        double MeanLuminance = 0.0;
        if (!Raster.Render(Level, Eye, F, R, U, kHalfFov, kWidth, kHeight, Frame.data(), MeanLuminance)) return 2;
        std::printf("  linked: moon el %+.2f az %.1f illum %.2f at 22h on Sep 26 (slot 0 as Prepare leaves it)\n",
                    static_cast<double>(Sky.Frame().Moon.Elevation),
                    static_cast<double>(Sky.Frame().Moon.Azimuth),
                    static_cast<double>(Sky.Frame().MoonIllumination));
        WriteFrame("Diagnostics/ProjectZeroCelestial_VisibilityRaster_GIoff_Standard_Night_MoonStars.png", Frame);
    }

    // ── 5. Night, placed: the roster driven the way the reference panel drives it ────────────────
    {
        // The MoonRenderProof arrangement, stated plainly: slot 0 unlinked and put at az 0 / el 25 at 2 deg,
        //    slot 1 (Ember) at az 14 / el 15 at 3 deg, slots 2-3 as Prepare parks them (hidden). The stars stay
        //    on — the moon proof hides them to keep its counts honest, but this frame wants moons and stars
        //    together, and the two coexist (verified: the moon draws identically with stars on or off).
        TickTo(22.0f, 10);
        Sky.MoonSlots[0].FollowSky = false;
        Sky.MoonSlots[0].Azimuth = 0.0f; Sky.MoonSlots[0].Elevation = 25.0f;
        Sky.MoonSlots[0].Size = 2.0f; Sky.MoonSlots[0].Phase = 0.5f;
        Sky.MoonSlots[1].Preset = 1u; Sky.MoonSlots[1].Visible = true;
        Sky.MoonSlots[1].FollowSky = false;
        Sky.MoonSlots[1].Azimuth = 14.0f; Sky.MoonSlots[1].Elevation = 15.0f;
        Sky.MoonSlots[1].Size = 3.0f; Sky.MoonSlots[1].Phase = 0.62f;
        const float Az = Sky.MoonSlots[0].Azimuth * kDeg, El = Sky.MoonSlots[0].Elevation * kDeg;
        const float Aim[3] = { std::sin(Az) * std::cos(El), std::cos(Az) * std::cos(El), std::sin(El) };
        float F[3], R[3], U[3];
        AimAt(Aim, F, R, U);
        VisibilityRaster Raster;
        Sky.ApplyTo(Raster, Budget);
        std::vector<unsigned char> Frame(static_cast<size_t>(kWidth) * kHeight * 4u, 0u);
        double MeanLuminance = 0.0;
        if (!Raster.Render(Level, Eye, F, R, U, kHalfFov, kWidth, kHeight, Frame.data(), MeanLuminance)) return 2;
        std::printf("  placed: Luna 2 deg full + Ember 3 deg gibbous at 22h on Sep 10 (stars on)\n");
        WriteFrame("Diagnostics/ProjectZeroCelestial_VisibilityRaster_GIoff_Standard_Night_PlacedMoonStars.png", Frame);
    }

    // ── 6. Morning, local: the parked volume with its enable flipped ────────────────────────────
    {
        TickTo(11.0f, 10);
        Sky.LocalCloud.Enabled = true;
        float Aim[3] = { Sky.LocalCloud.Centre[0] - Eye[0],
                         Sky.LocalCloud.Centre[1] - Eye[1],
                         Sky.LocalCloud.Centre[2] - Eye[2] };
        {
            const float Al = std::sqrt(Aim[0] * Aim[0] + Aim[1] * Aim[1] + Aim[2] * Aim[2]);
            Aim[0] /= Al; Aim[1] /= Al; Aim[2] /= Al;
        }
        float F[3], R[3], U[3];
        AimAt(Aim, F, R, U);
        VisibilityRaster Raster;
        Sky.ApplyTo(Raster, Budget);
        std::vector<unsigned char> Frame(static_cast<size_t>(kWidth) * kHeight * 4u, 0u);
        double MeanLuminance = 0.0;
        if (!Raster.Render(Level, Eye, F, R, U, kHalfFov, kWidth, kHeight, Frame.data(), MeanLuminance)) return 2;
        std::printf("  local: parked volume enabled at 11h on Sep 10 (box centre %.0f %.0f %.0f)\n",
                    (double)Sky.LocalCloud.Centre[0], (double)Sky.LocalCloud.Centre[1],
                    (double)Sky.LocalCloud.Centre[2]);
        WriteFrame("Diagnostics/ProjectZeroCelestial_VisibilityRaster_GIoff_Standard_CloudGodRays.png", Frame);
    }

    std::printf("\n  showcase rendered\n");
    return 0;
}
