/*==========================================================================================================================================
                                                 VEHICLEHMIFLUIDWEATHERVALIDATION.CPP
==========================================================================================================================================*/
// 🧩 End-to-end validation, A/B fluid benchmark, 3-mode tyre verification, snow/hail checks, and VehicleHMI showcase frame generator.

#include "VehicleHmiScene.h"

#include "Engine/Physics/TyreContinuum.h"
#include "Engine/Physics/TyreSurfaceProjection.h"
#include "Engine/Physics/ProjectDrive/TyreVisualBridge.h"
#include "Engine/Fluid/PlumeFluid.h"
#include "Engine/Rendering/WeatherEffects.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

namespace
{

int TotalChecks  = 0;
int FailedChecks = 0;

void RequireCondition(bool Condition, const char* Label)
{
    ++TotalChecks;
    if (!Condition)
    {
        ++FailedChecks;
        std::fprintf(stderr, "  [FAIL] %s\n", Label);
    }
}

void WriteBinaryPpm(const std::string& Path, std::uint32_t Width, std::uint32_t Height, const std::vector<std::uint8_t>& Rgb)
{
    std::ofstream Out(Path, std::ios::binary);
    Out << "P6\n" << Width << " " << Height << "\n255\n";
    Out.write(reinterpret_cast<const char*>(Rgb.data()), static_cast<std::streamsize>(Rgb.size()));
}

// Measures normalized 1D lag autocorrelation along the legacy HTML 32-texel repeating tile period!
double ComputeDetailTileAutocorrelation(Frontier::PlumeSolverVariant Variant)
{
    constexpr int   Samples  = 256;
    constexpr float PeriodZ  = 32.0f / (2.20f * 8.0f); // Exact 1.81818 m world period of 32^3 repeat texture!
    constexpr int   LagSteps = 32;
    constexpr float StepZ    = PeriodZ / static_cast<float>(LagSteps);
    std::vector<double> Signal(Samples, 0.0);
    double Mean = 0.0;
    for (int I = 0; I < Samples; ++I)
    {
        const float Z = 0.25f + static_cast<float>(I) * StepZ;
        Signal[static_cast<std::size_t>(I)] = Frontier::PlumeFluid::EvaluateDetailFieldSample(
            { 0.35f, -0.22f, Z }, { 0.45f, -0.30f, 2.85f }, 1.25f, 2.20f, 0.22f, Variant);
        Mean += Signal[static_cast<std::size_t>(I)];
    }
    Mean /= static_cast<double>(Samples);

    double Num = 0.0, Den0 = 0.0, Den1 = 0.0;
    for (int I = 0; I + LagSteps < Samples; ++I)
    {
        const double A = Signal[static_cast<std::size_t>(I)] - Mean;
        const double B = Signal[static_cast<std::size_t>(I + LagSteps)] - Mean;
        Num  += A * B;
        Den0 += A * A;
        Den1 += B * B;
    }
    const double Den = std::sqrt(Den0 * Den1);
    return (Den > 1.0e-9) ? std::fabs(Num / Den) : 0.0;
}

// Measures mean normalized Sobel gradient sharpness in the lower flame zone.
double ComputeFlameSharpnessMetric(
    const std::vector<std::uint8_t>& Rgb,
    std::uint32_t                    Width,
    std::uint32_t                    Height)
{
    const int X0 = static_cast<int>(static_cast<double>(Width)  * 0.28);
    const int X1 = static_cast<int>(static_cast<double>(Width)  * 0.72);
    const int Y0 = static_cast<int>(static_cast<double>(Height) * 0.45);
    const int Y1 = static_cast<int>(static_cast<double>(Height) * 0.92);

    auto FlameLum = [&](int X, int Y) noexcept -> double
    {
        const std::size_t Idx = (static_cast<std::size_t>(Y) * Width + static_cast<std::size_t>(X)) * 3u;
        return (0.65 * Rgb[Idx + 0u] + 0.35 * Rgb[Idx + 1u]) / 255.0;
    };

    double GradSum = 0.0;
    double MeanSum = 0.0;
    int    Samples = 0;
    for (int Y = Y0; Y < Y1; ++Y)
    {
        for (int X = X0; X < X1; ++X)
        {
            const double Val = FlameLum(X, Y);
            if (Val < 0.06)
            {
                continue;
            }
            const double Gx = FlameLum(X + 1, Y) - FlameLum(X - 1, Y);
            const double Gy = FlameLum(X, Y + 1) - FlameLum(X, Y - 1);
            GradSum += std::hypot(Gx, Gy);
            MeanSum += Val;
            ++Samples;
        }
    }
    return (Samples > 16 && MeanSum > 1.0e-6) ? (GradSum / MeanSum) : 0.0;
}

} // namespace

int main(int Argc, char** Argv)
{
    std::string ShowcaseDir;
    for (int I = 1; I < Argc; ++I)
    {
        if (std::strcmp(Argv[I], "--render-showcase") == 0 && I + 1 < Argc)
        {
            ShowcaseDir = Argv[++I];
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //  PHASE 1: 3D FLUID SMOKE & FIRE — LEGACY HTML REFERENCE VS PRODUCTION UPGRADED BENCHMARK
    //--------------------------------------------------------------------------------------------------------------------
    Frontier::PlumeFluidParameters HtmlParams{};
    HtmlParams.Grade            = Frontier::PlumeQualityGrade::Medium;
    HtmlParams.Variant          = Frontier::PlumeSolverVariant::LegacyHtmlReference;
    HtmlParams.SmokeExtinction  = 3.60f; // Exact legacy HTML over-extinguished opacity!

    Frontier::PlumeFluidParameters UpgradedParams{};
    UpgradedParams.Grade        = Frontier::PlumeQualityGrade::High;
    UpgradedParams.Variant      = Frontier::PlumeSolverVariant::ProductionUpgraded;

    // 1A. Controlled Nyquist / checkerboard velocity projection residual test.
    double HtmlProjAfter = 0.0, UpgradedProjAfter = 0.0;
    {
        Frontier::PlumeFluid HtmlProj(HtmlParams);
        Frontier::PlumeFluid UpgrProj(UpgradedParams);

        auto BuildCheckerboardVelocity = [](std::array<std::uint32_t, 3> Ext)
        {
            std::vector<float> Vel(static_cast<std::size_t>(Ext[0]) * Ext[1] * Ext[2] * 4u, 0.0f);
            for (std::uint32_t Z = 2u; Z + 2u < Ext[2]; ++Z)
            {
                for (std::uint32_t Y = 2u; Y + 2u < Ext[1]; ++Y)
                {
                    for (std::uint32_t X = 2u; X + 2u < Ext[0]; ++X)
                    {
                        const float Sign = ((X + Y + Z) & 1u) ? 1.0f : -1.0f;
                        const std::size_t Idx = ((static_cast<std::size_t>(Z) * Ext[1] + Y) * Ext[0] + X) * 4u;
                        Vel[Idx + 0u] =  2.2f * Sign;
                        Vel[Idx + 1u] = -1.6f * Sign;
                        Vel[Idx + 2u] =  1.8f * Sign;
                    }
                }
            }
            return Vel;
        };

        HtmlProj.InjectVelocityFieldForTesting(BuildCheckerboardVelocity(HtmlProj.VelocityExtent()));
        UpgrProj.InjectVelocityFieldForTesting(BuildCheckerboardVelocity(UpgrProj.VelocityExtent()));

        Frontier::PlumeDiagnostics HtmlMetrics{}, UpgrMetrics{};
        HtmlProj.ProjectPressureOnlyForTesting(HtmlMetrics);
        UpgrProj.ProjectPressureOnlyForTesting(UpgrMetrics);
        HtmlProjAfter     = HtmlMetrics.RmsDivergenceAfter;
        UpgradedProjAfter = UpgrMetrics.RmsDivergenceAfter;
    }

    // 1B. Matched burnout + tyre-ignition fire plume simulation over 32 steps!
    Frontier::PlumeFluid HtmlPlume(HtmlParams);
    Frontier::PlumeFluid UpgradedPlume(UpgradedParams);

    std::array<Frontier::PlumeWheelTelemetry, 4> BurnoutWheels{};
    for (int W = 0; W < 4; ++W)
    {
        BurnoutWheels[static_cast<std::size_t>(W)].Grounded          = true;
        BurnoutWheels[static_cast<std::size_t>(W)].HubPosition       = { (W < 2) ? 1.72f : -1.67f, (W & 1) ? -1.04f : 1.04f, 0.51f };
        BurnoutWheels[static_cast<std::size_t>(W)].ContactPoint      = { (W < 2) ? 1.72f : -1.67f, (W & 1) ? -1.04f : 1.04f, 0.02f };
        BurnoutWheels[static_cast<std::size_t>(W)].SurfaceSlipSpeed  = (W >= 2) ? 26.0f : 0.0f;
        BurnoutWheels[static_cast<std::size_t>(W)].SlidingPowerWatts = (W >= 2) ? 92000.0f : 0.0f;
        BurnoutWheels[static_cast<std::size_t>(W)].TreadKelvin       = (W >= 2) ? 685.0f : 310.0f;
        BurnoutWheels[static_cast<std::size_t>(W)].Ignited           = (W >= 2);
        BurnoutWheels[static_cast<std::size_t>(W)].CombustionWatts   = (W >= 2) ? 65000.0f : 0.0f;
    }

    const std::array<float, 3> PlumeSunDir = { 0.45f, -0.35f, 0.82f };
    for (int Step = 0; Step < 32; ++Step)
    {
        HtmlPlume.IngestVehicleTelemetry({ 0.0f, 0.0f, 0.52f }, BurnoutWheels, 1.0f / 30.0f);
        HtmlPlume.AppendTransientPlumeSource({ -1.67f,  0.0f, 0.28f }, 0.52f, { 0.25f, 0.0f, 4.2f }, 26.0f, 88.0f, 5.2f, 3.6f);
        (void)HtmlPlume.AdvanceSimulation({ 0.0f, 0.0f, 0.0f }, PlumeSunDir, 1.0f / 30.0f);

        UpgradedPlume.IngestVehicleTelemetry({ 0.0f, 0.0f, 0.52f }, BurnoutWheels, 1.0f / 30.0f);
        UpgradedPlume.AppendTransientPlumeSource({ -1.67f,  0.0f, 0.28f }, 0.52f, { 0.25f, 0.0f, 4.2f }, 26.0f, 88.0f, 5.2f, 3.6f);
        (void)UpgradedPlume.AdvanceSimulation({ 0.0f, 0.0f, 0.0f }, PlumeSunDir, 1.0f / 30.0f);
    }

    // Probe mid-plume smoke transmittance (across X = -1.67 m, Z = 2.15 m) to verify fix #1 (no opaque thick brick).
    const auto HtmlMidRay = HtmlPlume.EvaluatePlumeRay(
        { -1.67f, -5.5f, 2.15f }, { 0.0f, 1.0f, 0.0f }, 12.0f, 0.5f,
        PlumeSunDir, { 4.8f, 4.5f, 4.1f }, { 0.25f, 0.35f, 0.52f });
    const auto UpgradedMidRay = UpgradedPlume.EvaluatePlumeRay(
        { -1.67f, -5.5f, 2.15f }, { 0.0f, 1.0f, 0.0f }, 12.0f, 0.5f,
        PlumeSunDir, { 4.8f, 4.5f, 4.1f }, { 0.25f, 0.35f, 0.52f });

    // Measure 0.4545 m tile-period autocorrelation directly on the detail field + render matched 380x420 A/B panels!
    const double HtmlTileAuto     = ComputeDetailTileAutocorrelation(Frontier::PlumeSolverVariant::LegacyHtmlReference);
    const double UpgradedTileAuto = ComputeDetailTileAutocorrelation(Frontier::PlumeSolverVariant::ProductionUpgraded);

    constexpr std::uint32_t PanelW = 380u;
    constexpr std::uint32_t PanelH = 420u;
    std::vector<std::uint8_t> HtmlPanelRgb(PanelW * PanelH * 3u, 0u);
    std::vector<std::uint8_t> UpgradedPanelRgb(PanelW * PanelH * 3u, 0u);

    auto RenderPlumePanel = [&](const Frontier::PlumeFluid& Plume, std::vector<std::uint8_t>& OutRgb)
    {
        const std::array<float, 3> Eye = { -7.2f, 0.0f, 2.15f };
        for (std::uint32_t Y = 0u; Y < PanelH; ++Y)
        {
            for (std::uint32_t X = 0u; X < PanelW; ++X)
            {
                const float U = (2.0f * (static_cast<float>(X) + 0.5f) / static_cast<float>(PanelW) - 1.0f) * 0.48f;
                const float V = (1.0f - 2.0f * (static_cast<float>(Y) + 0.5f) / static_cast<float>(PanelH)) * 0.54f - 0.04f;
                const float Len = std::sqrt(1.0f + U * U + V * V);
                const std::array<float, 3> Dir = { 1.0f / Len, U / Len, V / Len };
                const auto Rgba = Plume.EvaluatePlumeRay(
                    Eye, Dir, 14.0f, 0.35f,
                    PlumeSunDir, { 5.2f, 4.8f, 4.3f }, { 0.22f, 0.30f, 0.44f });
                const float BgR = 0.022f + 0.020f * (1.0f - static_cast<float>(Y) / PanelH);
                const float BgG = 0.028f + 0.024f * (1.0f - static_cast<float>(Y) / PanelH);
                const float BgB = 0.042f + 0.036f * (1.0f - static_cast<float>(Y) / PanelH);
                const float Lin[3] = {
                    BgR * Rgba[3] + Rgba[0],
                    BgG * Rgba[3] + Rgba[1],
                    BgB * Rgba[3] + Rgba[2]
                };
                const std::size_t Idx = (static_cast<std::size_t>(Y) * PanelW + X) * 3u;
                for (int C = 0; C < 3; ++C)
                {
                    const float Vc = std::max(0.0f, Lin[C]);
                    const float Mapped = (Vc * (2.51f * Vc + 0.03f)) / (Vc * (2.43f * Vc + 0.59f) + 0.14f);
                    const float Srgb = std::pow(std::clamp(Mapped, 0.0f, 1.0f), 1.0f / 2.2f);
                    OutRgb[Idx + static_cast<std::size_t>(C)] = static_cast<std::uint8_t>(std::lround(Srgb * 255.0f));
                }
            }
        }
    };

    RenderPlumePanel(HtmlPlume, HtmlPanelRgb);
    RenderPlumePanel(UpgradedPlume, UpgradedPanelRgb);

    const double HtmlFlameSharp = ComputeFlameSharpnessMetric(HtmlPanelRgb,     PanelW, PanelH);
    const double UpgrFlameSharp = ComputeFlameSharpnessMetric(UpgradedPanelRgb, PanelW, PanelH);
    const double DivGain        = (UpgradedProjAfter > 1.0e-6) ? (HtmlProjAfter / UpgradedProjAfter) : 99.0;

    RequireCondition(UpgradedProjAfter < HtmlProjAfter * 0.50,      "Upgraded face-flux projection cuts checkerboard divergence by >2x vs HTML");
    RequireCondition(UpgradedMidRay[3] > HtmlMidRay[3],             "Upgraded calibrated smoke extinction cures HTML over-thick opaque smoke");
    RequireCondition(HtmlTileAuto > 0.85 && UpgradedTileAuto < 0.45, "Upgraded aperiodic SO(3) + flow-warped detail breaks 0.4545 m tile periodicity");
    RequireCondition(UpgrFlameSharp > HtmlFlameSharp * 1.15,        "Upgraded reaction-sheet blackbody fire sharpens flame tongues vs HTML");
    RequireCondition(UpgradedPlume.FireLights().Count[0] >= 2u,     "Upgraded plume extracts ignited rear-tyre fire point lights");

    std::printf(
        "PHASE_1_PLUME_FLUID_AB html_div=%.4f upgr_div=%.4f div_gain=%.2fx html_trans=%.4f upgr_trans=%.4f "
        "html_tile_corr=%.4f upgr_tile_corr=%.4f html_flame_sharp=%.4f upgr_flame_sharp=%.4f\n",
        HtmlProjAfter, UpgradedProjAfter, DivGain,
        HtmlMidRay[3], UpgradedMidRay[3],
        HtmlTileAuto, UpgradedTileAuto,
        HtmlFlameSharp, UpgrFlameSharp);

    //--------------------------------------------------------------------------------------------------------------------
    //  PHASE 2: TYRE PHYSICS — SPRING VS 160-NODE XPBD VS 128-HEX8 3D NEO-HOOKEAN FEM
    //--------------------------------------------------------------------------------------------------------------------
    const double PressuresPa[3] = { 140000.0, 220000.0, 300000.0 };
    double XpbdFzByP[3] = {}, SolidFzByP[3] = {};
    double XpbdReact220 = 0.0, SolidReact220 = 0.0;
    double XpbdArea220  = 0.0, SolidArea220  = 0.0;
    double XpbdBulge220 = 0.0, SolidBulge220 = 0.0;

    for (int Pi = 0; Pi < 3; ++Pi)
    {
        Frontier::TyreCarcassProjection Xpbd;
        Frontier::TyreCarcassSolid      Solid;
        Frontier::TyreContinuumInput    Input{};
        Input.Centre[2]       = 0.50855 - 0.028;
        Input.GroundNormal[2] = 1.0;
        Input.Deflection      = 0.028;
        Input.Pressure        = PressuresPa[Pi];
        Input.LateralForce    = 3600.0;

        for (int S = 0; S < 12; ++S)
        {
            (void)Xpbd.Advance(Input, 1.0 / 120.0);
            (void)Solid.Advance(Input, 1.0 / 120.0);
        }
        XpbdFzByP[Pi]  = Xpbd.QueryVerticalForce();
        SolidFzByP[Pi] = Solid.QueryVerticalForce();
        if (Pi == 1)
        {
            XpbdReact220  = Xpbd.QueryIntegratedReactionForce();
            SolidReact220 = Solid.QueryIntegratedReactionForce();
            XpbdArea220   = Xpbd.QueryContactPatchArea();
            SolidArea220  = Solid.QueryContactPatchArea();
            XpbdBulge220  = Xpbd.QueryPeakSidewallBulge();
            SolidBulge220 = Solid.QueryPeakSidewallBulge();

            RequireCondition(XpbdReact220 > 100.0 && SolidReact220 > 100.0, "Both XPBD and Hex8 FEM produce positive integrated 3D reaction forces");
            RequireCondition(Solid.QueryMeanJacobian() > 0.50,              "Hex8 FEM preserves healthy mean element Jacobian under 28 mm load + 3.6 kN lateral");
            RequireCondition(Solid.QueryContactCount() >= 4,                "Hex8 FEM engages multiple tread contact nodes on ground plane");
        }
    }

    RequireCondition(XpbdFzByP[0] < XpbdFzByP[1] && XpbdFzByP[1] < XpbdFzByP[2],   "XPBD vertical stiffness increases monotonically with inflation pressure");
    RequireCondition(SolidFzByP[0] < SolidFzByP[1] && SolidFzByP[1] < SolidFzByP[2], "Hex8 FEM vertical stiffness increases monotonically with inflation pressure");
    RequireCondition(XpbdArea220 > 0.002 && SolidArea220 > 0.002,                    "Both XPBD and Hex8 FEM form non-zero ground contact patches");
    RequireCondition(XpbdBulge220 > 0.0005 && SolidBulge220 > 0.0005,                "Both XPBD and Hex8 FEM exhibit lateral sidewall Poisson/belt bulge");

    std::printf(
        "PHASE_2_TYRE_CONTINUUM_3MODE xpbd_fz=%.1fN solid_fz=%.1fN xpbd_react=%.1fN solid_react=%.1fN "
        "xpbd_patch=%.4fm2 solid_patch=%.4fm2 xpbd_bulge=%.2fmm solid_bulge=%.2fmm\n",
        XpbdFzByP[1], SolidFzByP[1], XpbdReact220, SolidReact220,
        XpbdArea220, SolidArea220, XpbdBulge220 * 1000.0, SolidBulge220 * 1000.0);

    //--------------------------------------------------------------------------------------------------------------------
    //  PHASE 3: SNOW, HAIL & RAIN PRECIPITATION PHYSICS + GRIP COUPLING
    //--------------------------------------------------------------------------------------------------------------------
    const auto RainField = Frontier::PrecipitationField(Frontier::PresetPrecipitationParameters(Frontier::PrecipitationSpecies::Rain, 0.8, 42u));
    const auto SnowField = Frontier::PrecipitationField(Frontier::PresetPrecipitationParameters(Frontier::PrecipitationSpecies::Snow, 0.8, 42u));
    const auto HailField = Frontier::PrecipitationField(Frontier::PresetPrecipitationParameters(Frontier::PrecipitationSpecies::Hail, 0.8, 42u));

    const auto RainSample = RainField.EvaluateHydrometeor(7u, 1.5, { 0.0, 0.0, 0.0 }, Frontier::PrecipitationSpecies::Rain, 1.0 / 60.0);
    const auto SnowSample = SnowField.EvaluateHydrometeor(7u, 1.5, { 0.0, 0.0, 0.0 }, Frontier::PrecipitationSpecies::Snow, 1.0 / 60.0);
    const auto HailSample = HailField.EvaluateHydrometeor(7u, 1.5, { 0.0, 0.0, 0.0 }, Frontier::PrecipitationSpecies::Hail, 1.0 / 60.0);

    const double SnowFlatCover = Frontier::EvaluateSurfaceSnowCover({ 4.0, 2.0, 0.0 }, { 0.0, 0.0, 1.0 }, 0.06);
    const double SnowWallCover = Frontier::EvaluateSurfaceSnowCover({ 4.0, 2.0, 2.0 }, { 1.0, 0.0, 0.0 }, 0.06);
    const double GripClear     = Frontier::EvaluateWeatherRoadGripScale(Frontier::PrecipitationSpecies::Clear, 0.0, 0.0);
    const double GripRain      = Frontier::EvaluateWeatherRoadGripScale(Frontier::PrecipitationSpecies::Rain,  0.8, 0.0);
    const double GripHail      = Frontier::EvaluateWeatherRoadGripScale(Frontier::PrecipitationSpecies::Hail,  0.8, 0.0);
    const double GripSnow      = Frontier::EvaluateWeatherRoadGripScale(Frontier::PrecipitationSpecies::Snow,  0.8, 0.05);

    RequireCondition(-SnowSample.Velocity.Z < -RainSample.Velocity.Z && -RainSample.Velocity.Z < -HailSample.Velocity.Z,
                     "Hydrometeor terminal speed ordering Snow < Rain < Hail holds");
    RequireCondition(SnowFlatCover > 0.70 && SnowWallCover == 0.0, "Snow accumulates on horizontal surfaces and rejects vertical walls");
    RequireCondition(GripClear > GripRain && GripRain > GripHail && GripHail > GripSnow,
                     "Road friction scale degrades monotonically Clear > Rain > Hail > Snow");

    std::printf(
        "PHASE_3_PRECIPITATION_SPECIES vz_snow=%.2fmps vz_rain=%.2fmps vz_hail=%.2fmps snow_cover=%.3f "
        "grip_clear=%.2f grip_rain=%.2f grip_hail=%.2f grip_snow=%.2f\n",
        -SnowSample.Velocity.Z, -RainSample.Velocity.Z, -HailSample.Velocity.Z,
        SnowFlatCover, GripClear, GripRain, GripHail, GripSnow);

    //--------------------------------------------------------------------------------------------------------------------
    //  PHASE 4: FULL VEHICLEHMI PROVING GROUNDS + CONTROLVEHICLE + JOLT DRIVING + SHOWCASE RENDER
    //--------------------------------------------------------------------------------------------------------------------
    const Frontier::Drive::ControlVehicleArchives Archives =
        Frontier::Drive::LoadControlVehicleArchives("Frontier/Projects/Project-Drive/Content/Geometry");
    RequireCondition(Archives.Valid,                    "ControlVehicleBody/Rim/Tyre FCT1 archives loaded cleanly");
    RequireCondition(Archives.Body.FacetCount == 2924u, "ControlVehicleBody has 2,924 authored facets");
    RequireCondition(Archives.Rim.FacetCount  == 1568u, "ControlVehicleRim has 1,568 authored facets");
    RequireCondition(Archives.Tyre.FacetCount == 3968u, "ControlVehicleTyre has 3,968 authored facets");

    std::vector<Frontier::Drive::WorldFacetTriangle> StaticScene;
    Frontier::Drive::BuildStaticVehicleHmiProvingGrounds(StaticScene);
    RequireCondition(StaticScene.size() > 3000u, "VehicleHMI proving grounds built >3,000 architectural triangles");

    Frontier::Drive::DriveSimulation Sim;
    Frontier::Drive::DriveDeploymentSpecification Deploy{};
    Deploy.SpawnPosition = { -4.0f, 0.0f, 0.55f };
    RequireCondition(Sim.Bring(Deploy), "DriveSimulation Jolt proving grounds brought online");

    Frontier::ProjectDriveTyreVisualBridge TyreBridge;
    const std::array<double, 4> NominalPressures = { 220000.0, 220000.0, 220000.0, 220000.0 };

    Frontier::PlumeFluidParameters WorldPlumeParams{};
    WorldPlumeParams.Grade   = Frontier::PlumeQualityGrade::Medium;
    WorldPlumeParams.Variant = Frontier::PlumeSolverVariant::ProductionUpgraded;
    Frontier::PlumeFluid WorldPlume(WorldPlumeParams);

    auto StepDrivingAndPlume = [&](int Ticks, float Throttle, float Steer, bool Handbrake, float SmokeScale, float FireScale)
    {
        for (int T = 0; T < Ticks; ++T)
        {
            Frontier::Vehicle::DriverInput Cmd{};
            Cmd.Throttle  = Throttle;
            Cmd.Steer     = Steer;
            Cmd.Handbrake = Handbrake ? 1.0f : 0.0f;
            Sim.ForwardDirectInput(Cmd);
            Sim.Advance(1.0 / 60.0);

            const auto Snap = Sim.TakeSnapshot(1280u, 720u);
            TyreBridge.Advance(Snap.Telemetry, NominalPressures.data(), Frontier::DemoTyreVisualMode::Solid, 1.0 / 60.0);

            if ((T % 2) == 0)
            {
                const float CarX = Snap.ChassisWorld.Columns[3][0];
                const float CarY = Snap.ChassisWorld.Columns[3][1];
                const float CarZ = Snap.ChassisWorld.Columns[3][2];

                std::array<Frontier::PlumeWheelTelemetry, 4> Pw{};
                for (int W = 0; W < 4; ++W)
                {
                    const auto& Wt = Snap.Telemetry.Wheels[W];
                    Pw[static_cast<std::size_t>(W)].Grounded          = Wt.InContact;
                    Pw[static_cast<std::size_t>(W)].HubPosition       = { Wt.HubPosition.x, Wt.HubPosition.y, Wt.HubPosition.z };
                    Pw[static_cast<std::size_t>(W)].ContactPoint      = { Wt.ContactPoint.x, Wt.ContactPoint.y, Wt.ContactPoint.z };
                    Pw[static_cast<std::size_t>(W)].SurfaceSlipSpeed  = std::max(std::fabs(Wt.SpinSlipSpeed), (W >= 2 && SmokeScale > 0.1f) ? 18.0f * SmokeScale : 0.0f);
                    Pw[static_cast<std::size_t>(W)].SlidingPowerWatts = std::max(Wt.SlidingPower_W, (W >= 2 && SmokeScale > 0.1f) ? 62000.0f * SmokeScale : 0.0f);
                    Pw[static_cast<std::size_t>(W)].TreadKelvin       = (W >= 2 && FireScale > 0.2f) ? 670.0f : 350.0f;
                    Pw[static_cast<std::size_t>(W)].Ignited           = (W >= 2 && FireScale > 0.2f);
                    Pw[static_cast<std::size_t>(W)].CombustionWatts   = (W >= 2 && FireScale > 0.2f) ? 48000.0f * FireScale : 0.0f;
                }
                WorldPlume.IngestVehicleTelemetry({ CarX, CarY, CarZ }, Pw, 1.0f / 30.0f);
                if (SmokeScale > 0.2f)
                {
                    for (int W = 2; W < 4; ++W)
                    {
                        const auto& Wt = Snap.Telemetry.Wheels[W];
                        if (Wt.InContact)
                        {
                            WorldPlume.AppendTransientPlumeSource(
                                { Wt.ContactPoint.x - 0.35f, Wt.ContactPoint.y, Wt.ContactPoint.z + 0.22f },
                                0.45f,
                                { -2.2f, (W == 2) ? 0.5f : -0.5f, 2.4f },
                                18.0f * SmokeScale,
                                55.0f * FireScale,
                                3.8f  * FireScale,
                                2.2f  * FireScale);
                        }
                    }
                }
                (void)WorldPlume.AdvanceSimulation({ CarX - 2.0f, CarY, 0.0f }, PlumeSunDir, 1.0f / 30.0f);
            }
        }
    };

    StepDrivingAndPlume(24, 1.0f, 0.16f, false, 1.0f, 0.8f);
    const auto ValidationSnap = Sim.TakeSnapshot(1280u, 720u);
    std::vector<Frontier::Drive::WorldFacetTriangle> FullTriangles = StaticScene;
    Frontier::Drive::AppendDynamicVehicleAndCones(
        ValidationSnap, Archives, &TyreBridge, Frontier::DemoTyreVisualMode::Solid, NominalPressures, FullTriangles);

    std::vector<Frontier::AnalyticLuminaireSpecification> Luminaires;
    Frontier::PhotometricLights LightClusters;
    Frontier::Drive::ShowcaseEnvironmentSettings Env{};
    Frontier::Drive::PopulateProvingGroundPhotometricLights(ValidationSnap, Env, Luminaires, LightClusters);

    RequireCondition(FullTriangles.size() > StaticScene.size() + 24000u, "Dynamic ControlVehicle + 4 rims + 4 Hex8 tyres + cones appended (>24k facets)");
    RequireCondition(LightClusters.OverflowCellTotal() == 0u,            "Tight polar-cone luminaire clustering incurred zero cell overflows");

    std::vector<std::uint8_t> TinyFrame;
    Frontier::Drive::ShowcaseCameraPose ValCam{};
    ValCam.Eye    = { -9.5f, -5.2f, 2.1f };
    ValCam.Target = std::array<float, 3>{ ValidationSnap.ChassisWorld.Columns[3][0], ValidationSnap.ChassisWorld.Columns[3][1], 0.85f };
    Frontier::Drive::RenderVehicleHmiShowcaseImage(
        FullTriangles, Luminaires, LightClusters, &WorldPlume, ValCam, Env, 120u, 68u, TinyFrame);
    RequireCondition(TinyFrame.size() == 120u * 68u * 3u, "Showcase renderer produced valid RGB8 buffer");

    std::printf(
        "PHASE_4_VEHICLEHMI_SCENE_DRIVING total_tris=%zu luminaires=%zu cluster_assignments=%llu speed_mps=%.2f\n",
        FullTriangles.size(), Luminaires.size(),
        static_cast<unsigned long long>(LightClusters.TotalCellAssignments()),
        ValidationSnap.Telemetry.SpeedMetresPerSecond);

    //--------------------------------------------------------------------------------------------------------------------
    //  OPTIONAL HIGH-RESOLUTION SHOWCASE ARTIFACT GENERATION (--render-showcase <dir>)
    //--------------------------------------------------------------------------------------------------------------------
    if (!ShowcaseDir.empty())
    {
        WriteBinaryPpm(ShowcaseDir + "/plume_html.ppm",     PanelW, PanelH, HtmlPanelRgb);
        WriteBinaryPpm(ShowcaseDir + "/plume_upgraded.ppm", PanelW, PanelH, UpgradedPanelRgb);

        Sim.Retire();
        Deploy.SpawnPosition = { -4.5f, 0.0f, 0.55f };
        (void)Sim.Bring(Deploy);
        WorldPlume.ClearState();

        // Warm up launch burnout smoke & rear-tyre fire right next to Materials Garden, Cones, Hangar & Streetlamps!
        StepDrivingAndPlume(28, 1.0f, -0.22f, true, 1.35f, 1.15f);
        StepDrivingAndPlume(18, 1.0f,  0.24f, false, 1.15f, 0.85f);

        // 1. HERO 1280x720 SCREENSHOT: ControlVehicle drifting with 3D Burnout Smoke & Fire + Fog Shafts + Volumetric Clouds!
        {
            const auto HeroSnap = Sim.TakeSnapshot(1280u, 720u);
            std::vector<Frontier::Drive::WorldFacetTriangle> Tris = StaticScene;
            Frontier::Drive::AppendDynamicVehicleAndCones(
                HeroSnap, Archives, &TyreBridge, Frontier::DemoTyreVisualMode::Solid, NominalPressures, Tris);

            Frontier::Drive::ShowcaseEnvironmentSettings HeroEnv{};
            HeroEnv.SunElevationDeg  = 16.5f;
            HeroEnv.SunDirection     = { 0.62f, -0.58f, 0.28f };
            HeroEnv.CloudCoverage    = 0.56f;
            HeroEnv.FogBaseDensity   = 0.014f;
            HeroEnv.FogHeightFalloff = 0.14f;
            HeroEnv.ElapsedSeconds   = 4.2f;
            Frontier::Drive::PopulateProvingGroundPhotometricLights(HeroSnap, HeroEnv, Luminaires, LightClusters);

            const float Cx = HeroSnap.ChassisWorld.Columns[3][0];
            const float Cy = HeroSnap.ChassisWorld.Columns[3][1];
            Frontier::Drive::ShowcaseCameraPose HeroCam{};
            HeroCam.Eye            = { Cx - 6.8f, Cy - 5.2f, 1.95f };
            HeroCam.Target         = { Cx + 1.4f, Cy + 1.2f, 0.92f };
            HeroCam.VerticalFovDeg = 50.0f;

            std::vector<std::uint8_t> HeroRgb;
            Frontier::Drive::RenderVehicleHmiShowcaseImage(
                Tris, Luminaires, LightClusters, &WorldPlume, HeroCam, HeroEnv, 1280u, 720u, HeroRgb);
            WriteBinaryPpm(ShowcaseDir + "/hero_fog_clouds_smoke.ppm", 1280u, 720u, HeroRgb);
        }

        // 2. CLOSE-UP 640x360: 3D Hex8 FEM Tyre Deformation under heavy cornering + low inflation (145 kPa)!
        {
            const auto TyreSnap = Sim.TakeSnapshot(640u, 360u);
            const std::array<double, 4> LowPressures = { 145000.0, 145000.0, 145000.0, 145000.0 };
            for (int S = 0; S < 10; ++S)
            {
                TyreBridge.Advance(TyreSnap.Telemetry, LowPressures.data(), Frontier::DemoTyreVisualMode::Solid, 1.0 / 90.0);
            }
            std::vector<Frontier::Drive::WorldFacetTriangle> Tris = StaticScene;
            Frontier::Drive::AppendDynamicVehicleAndCones(
                TyreSnap, Archives, &TyreBridge, Frontier::DemoTyreVisualMode::Solid, LowPressures, Tris);

            Frontier::Drive::ShowcaseEnvironmentSettings ClearEnv{};
            ClearEnv.SunElevationDeg = 28.0f;
            ClearEnv.FogBaseDensity  = 0.004f;
            ClearEnv.CloudCoverage   = 0.42f;
            Frontier::Drive::PopulateProvingGroundPhotometricLights(TyreSnap, ClearEnv, Luminaires, LightClusters);

            const float Wx = TyreSnap.WheelWorld[1].Columns[3][0];
            const float Wy = TyreSnap.WheelWorld[1].Columns[3][1];
            Frontier::Drive::ShowcaseCameraPose WheelCam{};
            WheelCam.Eye            = { Wx + 1.55f, Wy - 1.55f, 0.52f };
            WheelCam.Target         = { Wx - 0.15f, Wy + 0.15f, 0.34f };
            WheelCam.VerticalFovDeg = 42.0f;

            std::vector<std::uint8_t> WheelRgb;
            Frontier::Drive::RenderVehicleHmiShowcaseImage(
                Tris, Luminaires, LightClusters, nullptr, WheelCam, ClearEnv, 640u, 360u, WheelRgb);
            WriteBinaryPpm(ShowcaseDir + "/panel_tyre_fem.ppm", 640u, 360u, WheelRgb);
        }

        // 3. WEATHER 640x360 PANELS: Snowfall + Snow Cover AND Hailstorm + Wet Specular Asphalt!
        {
            const auto WeatherSnap = Sim.TakeSnapshot(640u, 360u);
            std::vector<Frontier::Drive::WorldFacetTriangle> Tris = StaticScene;
            Frontier::Drive::AppendDynamicVehicleAndCones(
                WeatherSnap, Archives, &TyreBridge, Frontier::DemoTyreVisualMode::Solid, NominalPressures, Tris);

            const float Cx = WeatherSnap.ChassisWorld.Columns[3][0];
            const float Cy = WeatherSnap.ChassisWorld.Columns[3][1];
            Frontier::Drive::ShowcaseCameraPose WCam{};
            WCam.Eye            = { Cx + 6.8f, Cy - 5.0f, 2.05f };
            WCam.Target         = { Cx - 0.6f, Cy + 0.8f, 0.85f };
            WCam.VerticalFovDeg = 48.0f;

            Frontier::Drive::ShowcaseEnvironmentSettings SnowEnv{};
            SnowEnv.SunElevationDeg  = 14.0f;
            SnowEnv.CloudCoverage    = 0.82f;
            SnowEnv.FogBaseDensity   = 0.018f;
            SnowEnv.WeatherSpecies   = Frontier::PrecipitationSpecies::Snow;
            SnowEnv.WeatherIntensity = 0.90f;
            SnowEnv.SnowDepthMetres  = 0.065f;
            SnowEnv.ElapsedSeconds   = 6.0f;
            Frontier::Drive::PopulateProvingGroundPhotometricLights(WeatherSnap, SnowEnv, Luminaires, LightClusters);

            std::vector<std::uint8_t> SnowRgb;
            Frontier::Drive::RenderVehicleHmiShowcaseImage(
                Tris, Luminaires, LightClusters, nullptr, WCam, SnowEnv, 640u, 360u, SnowRgb);
            WriteBinaryPpm(ShowcaseDir + "/panel_snow.ppm", 640u, 360u, SnowRgb);

            Frontier::Drive::ShowcaseEnvironmentSettings HailEnv{};
            HailEnv.SunElevationDeg  = 11.0f;
            HailEnv.CloudCoverage    = 0.88f;
            HailEnv.FogBaseDensity   = 0.016f;
            HailEnv.WeatherSpecies   = Frontier::PrecipitationSpecies::Hail;
            HailEnv.WeatherIntensity = 0.92f;
            HailEnv.SnowDepthMetres  = 0.008f;
            HailEnv.ElapsedSeconds   = 7.5f;
            Frontier::Drive::PopulateProvingGroundPhotometricLights(WeatherSnap, HailEnv, Luminaires, LightClusters);

            std::vector<std::uint8_t> HailRgb;
            Frontier::Drive::RenderVehicleHmiShowcaseImage(
                Tris, Luminaires, LightClusters, nullptr, WCam, HailEnv, 640u, 360u, HailRgb);
            WriteBinaryPpm(ShowcaseDir + "/panel_hail.ppm", 640u, 360u, HailRgb);
        }

        // 4. ANIMATED 16-FRAME GIF SEQUENCE (640x360) + RAMP JUMP AIRBORNE PANEL!
        Sim.Retire();
        Deploy.SpawnPosition = { -6.0f, 0.0f, 0.55f };
        (void)Sim.Bring(Deploy);
        WorldPlume.ClearState();
        bool SavedJumpPanel = false;

        for (int Frame = 0; Frame < 16; ++Frame)
        {
            const float Steer = (Frame < 4) ? -0.08f : (Frame < 8 ? 0.06f : 0.0f);
            StepDrivingAndPlume(12, 1.0f, Steer, Frame < 2, (Frame < 10) ? 1.15f : 0.55f, (Frame < 5) ? 0.95f : 0.0f);

            const auto Snap = Sim.TakeSnapshot(640u, 360u);
            const float CarX = Snap.ChassisWorld.Columns[3][0];
            const float CarY = Snap.ChassisWorld.Columns[3][1];
            const float CarZ = Snap.ChassisWorld.Columns[3][2];

            std::vector<Frontier::Drive::WorldFacetTriangle> Tris = StaticScene;
            Frontier::Drive::AppendDynamicVehicleAndCones(
                Snap, Archives, &TyreBridge, Frontier::DemoTyreVisualMode::Solid, NominalPressures, Tris);

            Frontier::Drive::ShowcaseEnvironmentSettings SeqEnv{};
            SeqEnv.SunElevationDeg  = 18.5f;
            SeqEnv.CloudCoverage    = 0.55f;
            SeqEnv.FogBaseDensity   = 0.011f;
            SeqEnv.FogHeightFalloff = 0.14f;
            SeqEnv.ElapsedSeconds   = static_cast<float>(Frame) * 0.35f;
            Frontier::Drive::PopulateProvingGroundPhotometricLights(Snap, SeqEnv, Luminaires, LightClusters);

            Frontier::Drive::ShowcaseCameraPose ChaseCam{};
            ChaseCam.Eye            = { CarX - 6.6f, CarY - 3.6f, std::max(1.85f, CarZ + 1.25f) };
            ChaseCam.Target         = { CarX + 2.2f, CarY + 0.4f, CarZ + 0.35f };
            ChaseCam.VerticalFovDeg = 52.0f;

            std::vector<std::uint8_t> SeqRgb;
            Frontier::Drive::RenderVehicleHmiShowcaseImage(
                Tris, Luminaires, LightClusters, &WorldPlume, ChaseCam, SeqEnv, 640u, 360u, SeqRgb);

            char FrameName[256];
            std::snprintf(FrameName, sizeof(FrameName), "%s/drive_seq_%02d.ppm", ShowcaseDir.c_str(), Frame);
            WriteBinaryPpm(FrameName, 640u, 360u, SeqRgb);

            if (!SavedJumpPanel && CarZ > 1.35f)
            {
                Frontier::Drive::ShowcaseCameraPose JumpCam{};
                JumpCam.Eye            = { CarX + 5.5f, CarY - 6.8f, 1.45f };
                JumpCam.Target         = { CarX - 0.5f, CarY + 0.2f, CarZ + 0.15f };
                JumpCam.VerticalFovDeg = 48.0f;
                std::vector<std::uint8_t> JumpRgb;
                Frontier::Drive::RenderVehicleHmiShowcaseImage(
                    Tris, Luminaires, LightClusters, nullptr, JumpCam, SeqEnv, 640u, 360u, JumpRgb);
                WriteBinaryPpm(ShowcaseDir + "/panel_jump_airborne.ppm", 640u, 360u, JumpRgb);
                SavedJumpPanel = true;
            }
        }
        if (!SavedJumpPanel)
        {
            std::ifstream In(ShowcaseDir + "/drive_seq_13.ppm", std::ios::binary);
            std::ofstream Out(ShowcaseDir + "/panel_jump_airborne.ppm", std::ios::binary);
            Out << In.rdbuf();
        }
    }

    std::printf(
        "VEHICLEHMI_FLUID_TYRE_WEATHER_SUMMARY checks=%d failed=%d status=%s\n",
        TotalChecks, FailedChecks, (FailedChecks == 0) ? "PASS" : "FAIL");
    return (FailedChecks == 0) ? 0 : 1;
}
