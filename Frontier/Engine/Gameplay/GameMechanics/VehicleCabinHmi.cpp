/*==========================================================================================================================================
                                                      VEHICLECABINHMI.CPP
==========================================================================================================================================*/
// 🧩 HTML VehicleHMI port into ControlVehicle: 3D cockpit fixtures (SlateCabinLayout/Fittings), 4 shaped instrument clusters
//    (Hexagon KINETIK / Arc / Trapezoid / Pill), 12 multicolour SVG icons (IconDepot), and live 3D ControlVehicle Garage turntable.

#include "Engine/Gameplay/GameMechanics/VehicleCabinHmi.h"
#include "Engine/Gameplay/GameMechanics/CabinIconDepot.h"
#include "Engine/Rendering/SceneRenderer.h"

#include <algorithm>
#include <cmath>
#include <string>

namespace Frontier
{
namespace
{
constexpr float PiHmi = 3.1415926535f;

struct RgbaColor
{
    uint8_t R = 0u;
    uint8_t G = 0u;
    uint8_t B = 0u;
    uint8_t A = 255u;
};

constexpr std::array<Vec3, 6u> GaragePaintSwatches = {{
    {0.90f, 0.92f, 0.95f}, // 0: Pearl White
    {0.82f, 0.11f, 0.14f}, // 1: Crimson Corsa
    {0.10f, 0.42f, 0.92f}, // 2: Electric Cobalt
    {0.92f, 0.66f, 0.12f}, // 3: Solar Gold
    {0.11f, 0.13f, 0.16f}, // 4: Obsidian Matte
    {0.08f, 0.58f, 0.36f}  // 5: Emerald Racing
}};

struct RasterCanvas
{
    uint32_t              Width  = 0u;
    uint32_t              Height = 0u;
    std::vector<uint8_t>& Pixels;

    void BlendPixel(int X, int Y, RgbaColor Src, float Coverage01) noexcept
    {
        if (X < 0 || Y < 0 || X >= static_cast<int>(Width) || Y >= static_cast<int>(Height))
        {
            return;
        }
        const float Alpha = std::clamp(Coverage01 * (static_cast<float>(Src.A) / 255.0f), 0.0f, 1.0f);
        if (Alpha <= 1.0e-3f)
        {
            return;
        }
        const size_t Idx = (static_cast<size_t>(Y) * Width + static_cast<size_t>(X)) * 4u;
        const float  Inv = 1.0f - Alpha;
        Pixels[Idx + 0u] = static_cast<uint8_t>(std::clamp(Src.R * Alpha + Pixels[Idx + 0u] * Inv, 0.0f, 255.0f));
        Pixels[Idx + 1u] = static_cast<uint8_t>(std::clamp(Src.G * Alpha + Pixels[Idx + 1u] * Inv, 0.0f, 255.0f));
        Pixels[Idx + 2u] = static_cast<uint8_t>(std::clamp(Src.B * Alpha + Pixels[Idx + 2u] * Inv, 0.0f, 255.0f));
        Pixels[Idx + 3u] = static_cast<uint8_t>(std::clamp(255.0f * (Alpha + (Pixels[Idx + 3u] / 255.0f) * Inv), 0.0f, 255.0f));
    }

    void FillRoundedCard(float Left, float Top, float W, float H, float Radius, RgbaColor Fill) noexcept
    {
        const int X0 = std::max(0, static_cast<int>(std::floor(Left - 1.0f)));
        const int Y0 = std::max(0, static_cast<int>(std::floor(Top - 1.0f)));
        const int X1 = std::min(static_cast<int>(Width) - 1, static_cast<int>(std::ceil(Left + W + 1.0f)));
        const int Y1 = std::min(static_cast<int>(Height) - 1, static_cast<int>(std::ceil(Top + H + 1.0f)));

        const float Cx = Left + 0.5f * W;
        const float Cy = Top + 0.5f * H;
        const float Hx = std::max(0.0f, 0.5f * W - Radius);
        const float Hy = std::max(0.0f, 0.5f * H - Radius);

        for (int Y = Y0; Y <= Y1; ++Y)
        {
            for (int X = X0; X <= X1; ++X)
            {
                const float Dx = std::max(0.0f, std::abs((static_cast<float>(X) + 0.5f) - Cx) - Hx);
                const float Dy = std::max(0.0f, std::abs((static_cast<float>(Y) + 0.5f) - Cy) - Hy);
                const float Sd = std::sqrt(Dx * Dx + Dy * Dy) - Radius;
                if (Sd < 0.75f)
                {
                    BlendPixel(X, Y, Fill, std::clamp(0.5f - Sd, 0.0f, 1.0f));
                }
            }
        }
    }

    void DrawLineSegment(float Ax, float Ay, float Bx, float By, float HalfThick, RgbaColor Col) noexcept
    {
        const int X0 = std::max(0, static_cast<int>(std::floor(std::min(Ax, Bx) - HalfThick - 2.0f)));
        const int Y0 = std::max(0, static_cast<int>(std::floor(std::min(Ay, By) - HalfThick - 2.0f)));
        const int X1 = std::min(static_cast<int>(Width) - 1, static_cast<int>(std::ceil(std::max(Ax, Bx) + HalfThick + 2.0f)));
        const int Y1 = std::min(static_cast<int>(Height) - 1, static_cast<int>(std::ceil(std::max(Ay, By) + HalfThick + 2.0f)));

        const float Vx  = Bx - Ax;
        const float Vy  = By - Ay;
        const float Den = Vx * Vx + Vy * Vy;
        for (int Y = Y0; Y <= Y1; ++Y)
        {
            for (int X = X0; X <= X1; ++X)
            {
                const float Px = (static_cast<float>(X) + 0.5f) - Ax;
                const float Py = (static_cast<float>(Y) + 0.5f) - Ay;
                const float H  = (Den > 1.0e-5f) ? std::clamp((Px * Vx + Py * Vy) / Den, 0.0f, 1.0f) : 0.0f;
                const float Dx = Px - Vx * H;
                const float Dy = Py - Vy * H;
                const float Sd = std::sqrt(Dx * Dx + Dy * Dy) - HalfThick;
                if (Sd < 0.8f)
                {
                    BlendPixel(X, Y, Col, std::clamp(0.6f - Sd, 0.0f, 1.0f));
                }
            }
        }
    }

    void FillRadialArc(
        float     Cx,
        float     Cy,
        float     InnerR,
        float     OuterR,
        float     StartAngleRad,
        float     SweepFraction01,
        float     TotalSweepRad,
        RgbaColor TrackCol,
        RgbaColor ActiveCol) noexcept
    {
        const int X0 = std::max(0, static_cast<int>(std::floor(Cx - OuterR - 2.0f)));
        const int Y0 = std::max(0, static_cast<int>(std::floor(Cy - OuterR - 2.0f)));
        const int X1 = std::min(static_cast<int>(Width) - 1, static_cast<int>(std::ceil(Cx + OuterR + 2.0f)));
        const int Y1 = std::min(static_cast<int>(Height) - 1, static_cast<int>(std::ceil(Cy + OuterR + 2.0f)));

        const float MidR         = 0.5f * (InnerR + OuterR);
        const float HalfT        = 0.5f * (OuterR - InnerR);
        const float ClampedSweep = std::clamp(SweepFraction01, 0.0f, 1.0f);

        for (int Y = Y0; Y <= Y1; ++Y)
        {
            for (int X = X0; X <= X1; ++X)
            {
                const float Dx = (static_cast<float>(X) + 0.5f) - Cx;
                const float Dy = (static_cast<float>(Y) + 0.5f) - Cy;
                const float R  = std::sqrt(Dx * Dx + Dy * Dy);
                const float Rd = std::abs(R - MidR) - HalfT;
                if (Rd < 0.8f)
                {
                    float Ang = std::atan2(Dy, Dx) - StartAngleRad;
                    while (Ang < 0.0f) Ang += 2.0f * PiHmi;
                    while (Ang >= 2.0f * PiHmi) Ang -= 2.0f * PiHmi;
                    if (Ang <= TotalSweepRad)
                    {
                        const float Cov = std::clamp(0.6f - Rd, 0.0f, 1.0f);
                        const bool  Lit = (Ang <= TotalSweepRad * ClampedSweep);
                        BlendPixel(X, Y, Lit ? ActiveCol : TrackCol, Cov);
                    }
                }
            }
        }
    }

    void StampSevenSegmentGlyph(char Ch, float Left, float Top, float W, float H, float Thick, RgbaColor Col) noexcept
    {
        uint8_t Mask = 0u;
        switch (Ch)
        {
            case '0': Mask = 0b1110111u; break;
            case '1': Mask = 0b0100100u; break;
            case '2': Mask = 0b1011101u; break;
            case '3': Mask = 0b1101101u; break;
            case '4': Mask = 0b0101110u; break;
            case '5': Mask = 0b1101011u; break;
            case '6': Mask = 0b1111011u; break;
            case '7': Mask = 0b0100101u; break;
            case '8': Mask = 0b1111111u; break;
            case '9': Mask = 0b1101111u; break;
            case '-': Mask = 0b0001000u; break;
            case 'N': Mask = 0b0110111u; break;
            case 'R': Mask = 0b0011111u; break;
            default: return;
        }

        const float HalfH = 0.5f * H;
        if (Mask & (1u << 0u)) FillRoundedCard(Left + Thick * 0.5f, Top, W - Thick, Thick, Thick * 0.4f, Col);
        if (Mask & (1u << 1u)) FillRoundedCard(Left, Top + Thick * 0.5f, Thick, HalfH - Thick * 0.5f, Thick * 0.4f, Col);
        if (Mask & (1u << 2u)) FillRoundedCard(Left + W - Thick, Top + Thick * 0.5f, Thick, HalfH - Thick * 0.5f, Thick * 0.4f, Col);
        if (Mask & (1u << 3u)) FillRoundedCard(Left + Thick * 0.5f, Top + HalfH - Thick * 0.5f, W - Thick, Thick, Thick * 0.4f, Col);
        if (Mask & (1u << 4u)) FillRoundedCard(Left, Top + HalfH, Thick, HalfH - Thick * 0.5f, Thick * 0.4f, Col);
        if (Mask & (1u << 5u)) FillRoundedCard(Left + W - Thick, Top + HalfH, Thick, HalfH - Thick * 0.5f, Thick * 0.4f, Col);
        if (Mask & (1u << 6u)) FillRoundedCard(Left + Thick * 0.5f, Top + H - Thick, W - Thick, Thick, Thick * 0.4f, Col);
    }

    void StampUnsignedNumber(uint32_t Number, uint32_t Digits, float RightX, float TopY, float DigitW, float DigitH, RgbaColor Col) noexcept
    {
        uint32_t Temp = Number;
        for (uint32_t D = 0u; D < Digits; ++D)
        {
            const char Ch = static_cast<char>('0' + (Temp % 10u));
            Temp /= 10u;
            const float X = RightX - static_cast<float>(D + 1u) * (DigitW * 1.28f);
            if (D == 0u || Number >= static_cast<uint32_t>(std::pow(10, D)))
            {
                StampSevenSegmentGlyph(Ch, X, TopY, DigitW, DigitH, std::max(2.0f, DigitW * 0.18f), Col);
            }
        }
    }
};

[[nodiscard]] RgbaColor ThermalHeatmapRgba(float TempKelvin) noexcept
{
    if (TempKelvin < 315.0f)
    {
        const float T = std::clamp((TempKelvin - 270.0f) / 45.0f, 0.0f, 1.0f);
        return RgbaColor{
            static_cast<uint8_t>(65.0f * (1.0f - T) + 48.0f * T),
            static_cast<uint8_t>(145.0f * (1.0f - T) + 215.0f * T),
            static_cast<uint8_t>(240.0f * (1.0f - T) + 150.0f * T),
            255u};
    }
    if (TempKelvin < 385.0f)
    {
        const float T = (TempKelvin - 315.0f) / 70.0f;
        return RgbaColor{
            static_cast<uint8_t>(48.0f * (1.0f - T) + 245.0f * T),
            static_cast<uint8_t>(215.0f * (1.0f - T) + 185.0f * T),
            static_cast<uint8_t>(150.0f * (1.0f - T) + 52.0f * T),
            255u};
    }
    const float T = std::clamp((TempKelvin - 385.0f) / 50.0f, 0.0f, 1.0f);
    return RgbaColor{
        248u,
        static_cast<uint8_t>(185.0f * (1.0f - T) + 58.0f * T),
        static_cast<uint8_t>(52.0f * (1.0f - T) + 62.0f * T),
        255u};
}

// ClusterSequence.js normalized [-1, +1] polygon outlines (Hexagon KINETIK, Arc, Trapezoid, Pill).
[[nodiscard]] std::vector<std::array<float, 2u>> BuildClusterOutlinePolygon(ClusterOutlineShape Shape)
{
    switch (Shape)
    {
        case ClusterOutlineShape::Hexagon:
            return {{
                {-0.76f,  0.92f}, { 0.76f,  0.92f}, { 0.98f,  0.22f},
                { 0.80f, -0.92f}, {-0.80f, -0.92f}, {-0.98f,  0.22f}
            }};
        case ClusterOutlineShape::Trapezoid:
            return {{
                {-0.72f,  0.92f}, { 0.72f,  0.92f}, { 0.96f, -0.88f}, {-0.96f, -0.88f}
            }};
        case ClusterOutlineShape::Pill:
        case ClusterOutlineShape::Arc:
        {
            std::vector<std::array<float, 2u>> Pts;
            Pts.reserve(24u);
            for (uint32_t I = 0u; I < 24u; ++I)
            {
                const float A = (2.0f * PiHmi * static_cast<float>(I)) / 24.0f;
                const float Rx = 0.96f * std::cos(A);
                const float Ry = (Shape == ClusterOutlineShape::Arc)
                    ? (0.88f * std::sin(A) + 0.08f * std::cos(2.0f * A))
                    : (0.86f * std::clamp(std::sin(A) * 1.25f, -1.0f, 1.0f));
                Pts.push_back({Rx, Ry});
            }
            return Pts;
        }
    }
    return {{-0.8f, 0.9f}, {0.8f, 0.9f}, {0.95f, 0.0f}, {0.8f, -0.9f}, {-0.8f, -0.9f}, {-0.95f, 0.0f}};
}

} // namespace

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                   CATALOGUE & ALERT EVALUATION
------------------------------------------------------------------------------------------------------------------------------------------*/
VehicleCabinHmi::VehicleCabinHmi() = default;

bool VehicleCabinHmi::LoadControlVehicleMeshesForHmi(std::string_view GeometryDirectoryPath)
{
    const std::string Base(GeometryDirectoryPath);
    BlinnFacetMesh Body{}, Rim{}, Tyre{};
    if (!BlinnRenderer::LoadFacetStream(Base + "/ControlVehicleBody.facet", Body) ||
        !BlinnRenderer::LoadFacetStream(Base + "/ControlVehicleRim.facet", Rim) ||
        !BlinnRenderer::LoadFacetStream(Base + "/ControlVehicleTyre.facet", Tyre))
    {
        return false;
    }

    // Rebase authored ControlVehicle body around CoM Z (ResolveCoMAuthoredZ = 0.625 m) so wheels & body align identically to VehicleProvingGrounds!
    constexpr float CoMAuthoredZ = 0.625f;
    for (Vec3& P : Body.Positions)
    {
        P.Z -= CoMAuthoredZ;
    }
    BodyMesh_         = std::move(Body);
    RimLeftMesh_      = Rim;
    RimRightMesh_     = BlinnRenderer::MirrorFacetMeshAcrossY(Rim);
    TyreMesh_         = std::move(Tyre);
    HasVehicleMeshes_ = true;
    return true;
}

const std::array<CabinApplicationMetadata, VehicleCabinHmi::ApplicationCount>&
VehicleCabinHmi::Catalogue() noexcept
{
    static constexpr std::array<CabinApplicationMetadata, ApplicationCount> Apps = {{
        {CabinApplicationSlot::VehicleSetup, "vehicle", "Vehicle", "Make it your own", {0.32f, 0.84f, 1.00f}, 0u},
        {CabinApplicationSlot::DriveRoom, "drive-room", "Drive Room", "Your people. Your race.", {1.00f, 0.60f, 0.12f}, 3u},
        {CabinApplicationSlot::Messages, "messages", "Messages", "Keep the conversation going", {0.24f, 0.62f, 1.00f}, 2u},
        {CabinApplicationSlot::Contacts, "contacts", "Contacts", "People worth driving with", {0.18f, 0.88f, 0.42f}, 0u},
        {CabinApplicationSlot::Navigation, "navigation", "Navigation", "Find your next road", {0.10f, 0.72f, 0.98f}, 0u},
        {CabinApplicationSlot::MediaPlayer, "media", "Media", "Set the pace", {0.98f, 0.24f, 0.52f}, 0u},
        {CabinApplicationSlot::TyreMonitor, "tyres", "Tyres", "Every corner counts", {0.98f, 0.74f, 0.14f}, 0u},
        {CabinApplicationSlot::TelemetryLab, "telemetry", "Telemetry", "Know your machine", {0.08f, 0.82f, 0.94f}, 0u},
        {CabinApplicationSlot::ClimateHvac, "climate", "Climate", "Your comfort zone", {0.12f, 0.86f, 0.74f}, 0u},
        {CabinApplicationSlot::GarageBay, "garage", "Garage", "3D ControlVehicle Studio", {0.52f, 0.32f, 0.96f}, 0u},
        {CabinApplicationSlot::AccountCloud, "account", "Account", "Always your space", {0.34f, 0.56f, 0.98f}, 0u},
        {CabinApplicationSlot::CabinPreferences, "settings", "Settings", "The little things", {0.72f, 0.86f, 1.00f}, 0u},
    }};
    return Apps;
}

CabinHmiAlertDigest VehicleCabinHmi::EvaluateAlerts(const VehicleCabinTelemetryFrame& Telemetry) noexcept
{
    CabinHmiAlertDigest Digest{};
    const float RpmFrac = std::clamp(Telemetry.EngineOrMotorRpm / std::max(1000.0f, Telemetry.RedlineRpm), 0.0f, 1.15f);
    if (RpmFrac > 0.55f)
    {
        Digest.ActiveShiftLedCount = static_cast<uint32_t>(std::clamp(std::ceil((RpmFrac - 0.55f) / 0.042f), 0.0f, 10.0f));
    }
    Digest.RedlineShiftFlash = (RpmFrac >= 0.94f);

    bool LowWheelGrip  = false;
    bool HotWheelTread = false;
    for (const auto& W : Telemetry.Wheels)
    {
        if (W.EffectiveGripRatio < 0.52f || W.StandingWaterMm > 3.5f || W.SnowSinkageMetres > 0.08f)
        {
            LowWheelGrip = true;
        }
        if (W.TreadTemperatureKelvin > 405.0f)
        {
            HotWheelTread = true;
        }
    }

    Digest.TractionHazardLamp  = Telemetry.AquaplaningWarning || Telemetry.BlackIceOrHailSlip || LowWheelGrip;
    Digest.ThermalWarningLamp  = (Telemetry.CoolantTempCelsius > 112.0f) || (Telemetry.OilTempCelsius > 130.0f) || HotWheelTread;
    Digest.SevereWeatherBanner = Telemetry.HailImpactWarning || Telemetry.LightningProximityWarn;
    return Digest;
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                             SHAPED INSTRUMENT CLUSTER SYNTHESIS (HEXAGON KINETIK / ARC / TRAPEZOID / PILL)
------------------------------------------------------------------------------------------------------------------------------------------*/
void VehicleCabinHmi::SynthesizeInstrumentClusterRgba8(
    uint32_t                          Width,
    uint32_t                          Height,
    const VehicleCabinTelemetryFrame& Telemetry,
    std::vector<uint8_t>&             OutRgba8) const
{
    OutRgba8.assign(static_cast<size_t>(Width) * Height * 4u, 0u);
    if (Width < 32u || Height < 32u)
    {
        return;
    }

    const float W = static_cast<float>(Width);
    const float H = static_cast<float>(Height);
    RasterCanvas Canvas{Width, Height, OutRgba8};

    Canvas.FillRoundedCard(0.0f, 0.0f, W, H, H * 0.06f, RgbaColor{10u, 13u, 19u, 255u});
    Canvas.FillRoundedCard(W * 0.015f, H * 0.035f, W * 0.97f, H * 0.93f, H * 0.05f, RgbaColor{15u, 20u, 29u, 255u});

    // Draw shaped neon perimeter bezel matching ClusterOutline_ (Hexagon KINETIK default from SourceImages/HMI & ClusterSequence.js)!
    const auto Poly = BuildClusterOutlinePolygon(ClusterOutline_);
    for (size_t I = 0u; I < Poly.size(); ++I)
    {
        const auto& A = Poly[I];
        const auto& B = Poly[(I + 1u) % Poly.size()];
        const float Ax = W * (0.5f + 0.47f * A[0]);
        const float Ay = H * (0.5f - 0.45f * A[1]);
        const float Bx = W * (0.5f + 0.47f * B[0]);
        const float By = H * (0.5f - 0.45f * B[1]);
        Canvas.DrawLineSegment(Ax, Ay, Bx, By, std::max(2.0f, H * 0.012f), RgbaColor{42u, 204u, 250u, 235u});
    }

    const CabinHmiAlertDigest Alerts    = EvaluateAlerts(Telemetry);
    const float               SpeedKmh  = std::max(0.0f, Telemetry.VehicleSpeedMps * 3.6f);
    const float               SpeedFrac = std::clamp(SpeedKmh / 340.0f, 0.0f, 1.0f);
    const float               RpmFrac   = std::clamp(Telemetry.EngineOrMotorRpm / std::max(1000.0f, Telemetry.RedlineRpm), 0.0f, 1.0f);

    // Top 10-segment Shift-Light Bar!
    const float LedW   = W * 0.048f;
    const float LedGap = W * 0.009f;
    const float LedX0  = 0.5f * (W - (10.0f * LedW + 9.0f * LedGap));
    for (uint32_t L = 0u; L < 10u; ++L)
    {
        const bool Lit = (L < Alerts.ActiveShiftLedCount);
        RgbaColor  Col = RgbaColor{30u, 38u, 50u, 255u};
        if (Lit)
        {
            Col = (Alerts.RedlineShiftFlash || L >= 7u) ? RgbaColor{252u, 58u, 68u, 255u}
                                                        : ((L >= 4u) ? RgbaColor{252u, 192u, 48u, 255u}
                                                                     : RgbaColor{64u, 238u, 152u, 255u});
        }
        Canvas.FillRoundedCard(LedX0 + static_cast<float>(L) * (LedW + LedGap), H * 0.10f, LedW, H * 0.050f, 3.0f, Col);
    }

    if (ClusterOutline_ == ClusterOutlineShape::Hexagon)
    {
        // KINETIK Hexagonal Race Cluster: twin angled chevron wing bars + central chamfered speed/gear core!
        for (uint32_t Seg = 0u; Seg < 14u; ++Seg)
        {
            const float T   = static_cast<float>(Seg) / 13.0f;
            const float Y   = H * (0.78f - 0.52f * T);
            const float InX = W * (0.14f + 0.08f * std::abs(T - 0.45f));
            const bool  LitL = (T <= RpmFrac);
            const RgbaColor LeftCol = LitL
                ? ((T > 0.82f) ? RgbaColor{255u, 72u, 68u, 255u} : RgbaColor{38u, 218u, 255u, 255u})
                : RgbaColor{28u, 36u, 48u, 255u};
            Canvas.FillRoundedCard(InX, Y, W * 0.14f, H * 0.026f, 2.5f, LeftCol);

            const float Power01 = std::clamp(0.5f + Telemetry.RegenOrDrivePowerKw / 400.0f + 0.4f * SpeedFrac, 0.0f, 1.0f);
            const bool  LitR    = (T <= Power01);
            const RgbaColor RightCol = LitR ? RgbaColor{255u, 168u, 48u, 255u} : RgbaColor{28u, 36u, 48u, 255u};
            Canvas.FillRoundedCard(W - InX - W * 0.14f, Y, W * 0.14f, H * 0.026f, 2.5f, RightCol);
        }

        // Bold central digital KINETIK speedometer + engaged gear badge!
        Canvas.FillRoundedCard(W * 0.34f, H * 0.22f, W * 0.32f, H * 0.50f, H * 0.05f, RgbaColor{22u, 30u, 42u, 255u});
        Canvas.DrawLineSegment(W * 0.35f, H * 0.22f, W * 0.65f, H * 0.22f, 2.0f, RgbaColor{56u, 218u, 255u, 255u});
        Canvas.StampUnsignedNumber(
            static_cast<uint32_t>(std::round(SpeedKmh)),
            3u,
            W * 0.55f,
            H * 0.29f,
            W * 0.048f,
            H * 0.22f,
            RgbaColor{242u, 248u, 255u, 255u});

        const char GearGlyph = (Telemetry.EngagedGear < 0)
                                   ? 'R'
                                   : ((Telemetry.EngagedGear == 0) ? 'N' : static_cast<char>('0' + std::min(9, Telemetry.EngagedGear)));
        Canvas.FillRoundedCard(W * 0.57f, H * 0.29f, W * 0.07f, H * 0.22f, 4.0f, RgbaColor{32u, 44u, 62u, 255u});
        Canvas.StampSevenSegmentGlyph(
            GearGlyph,
            W * 0.585f,
            H * 0.32f,
            W * 0.040f,
            H * 0.16f,
            std::max(2.5f, W * 0.007f),
            Alerts.RedlineShiftFlash ? RgbaColor{255u, 88u, 88u, 255u} : RgbaColor{255u, 212u, 92u, 255u});
    }
    else
    {
        const float DialR = std::min(W * 0.17f, H * 0.35f);
        Canvas.FillRadialArc(
            W * 0.24f, H * 0.56f, DialR * 0.76f, DialR, PiHmi * 0.75f, SpeedFrac, PiHmi * 1.50f,
            RgbaColor{38u, 48u, 64u, 255u}, RgbaColor{88u, 198u, 252u, 255u});
        Canvas.StampUnsignedNumber(
            static_cast<uint32_t>(std::round(SpeedKmh)), 3u, W * 0.285f, H * 0.48f, DialR * 0.22f, DialR * 0.38f,
            RgbaColor{238u, 245u, 255u, 255u});

        Canvas.FillRadialArc(
            W * 0.76f, H * 0.56f, DialR * 0.76f, DialR, PiHmi * 0.75f, RpmFrac, PiHmi * 1.50f,
            RgbaColor{38u, 48u, 64u, 255u},
            Alerts.RedlineShiftFlash ? RgbaColor{252u, 72u, 76u, 255u} : RgbaColor{124u, 232u, 168u, 255u});
        Canvas.StampUnsignedNumber(
            static_cast<uint32_t>(std::round(Telemetry.EngineOrMotorRpm * 0.01f)), 2u, W * 0.79f, H * 0.48f,
            DialR * 0.22f, DialR * 0.38f, RgbaColor{228u, 242u, 236u, 255u});
    }

    // Bottom Fuel/SoC + Boost + Hazard Telltales!
    const float Energy01 = Telemetry.ElectricPropulsionMode ? Telemetry.BatteryCharge01 : Telemetry.FuelLevel01;
    Canvas.FillRoundedCard(W * 0.34f, H * 0.77f, W * 0.32f, H * 0.055f, 3.0f, RgbaColor{32u, 40u, 54u, 255u});
    Canvas.FillRoundedCard(
        W * 0.34f, H * 0.77f, W * 0.32f * std::clamp(Energy01, 0.03f, 1.0f), H * 0.055f, 3.0f,
        Telemetry.ElectricPropulsionMode ? RgbaColor{72u, 232u, 198u, 255u} : RgbaColor{250u, 184u, 68u, 255u});

    if (Alerts.TractionHazardLamp) Canvas.FillRoundedCard(W * 0.40f, H * 0.86f, W * 0.05f, H * 0.055f, 3.0f, RgbaColor{252u, 186u, 48u, 255u});
    if (Alerts.ThermalWarningLamp) Canvas.FillRoundedCard(W * 0.475f, H * 0.86f, W * 0.05f, H * 0.055f, 3.0f, RgbaColor{250u, 68u, 68u, 255u});
    if (Alerts.SevereWeatherBanner) Canvas.FillRoundedCard(W * 0.55f, H * 0.86f, W * 0.05f, H * 0.055f, 3.0f, RgbaColor{132u, 196u, 255u, 255u});
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                     CENTRAL INFOTAINMENT TABLET: 12 MULTICOLOUR SVG ICONS + LIVE 3D CONTROLVEHICLE TURNTABLE
------------------------------------------------------------------------------------------------------------------------------------------*/
void VehicleCabinHmi::SynthesizeCentralScreenRgba8(
    uint32_t                          Width,
    uint32_t                          Height,
    const VehicleCabinTelemetryFrame& Telemetry,
    std::vector<uint8_t>&             OutRgba8) const
{
    OutRgba8.assign(static_cast<size_t>(Width) * Height * 4u, 0u);
    if (Width < 32u || Height < 32u)
    {
        return;
    }

    const float  W = static_cast<float>(Width);
    const float  H = static_cast<float>(Height);
    RasterCanvas Canvas{Width, Height, OutRgba8};

    // Deep glassmorphic slate-obsidian tablet shell + status header bar!
    Canvas.FillRoundedCard(0.0f, 0.0f, W, H, H * 0.038f, RgbaColor{16u, 21u, 28u, 255u});
    Canvas.FillRoundedCard(W * 0.02f, H * 0.022f, W * 0.96f, H * 0.072f, H * 0.020f, RgbaColor{26u, 34u, 44u, 255u});
    Canvas.StampUnsignedNumber(
        static_cast<uint32_t>(std::max(0.0f, std::round(Telemetry.AmbientTempCelsius))),
        2u, W * 0.94f, H * 0.036f, W * 0.016f, H * 0.044f, RgbaColor{188u, 224u, 255u, 255u});

    const auto& Apps = Catalogue();

    // Helper: renders the LIVE 3D ControlVehicle Studio Turntable into any sub-card [CardX, CardY, CardW, CardH] via BlinnRenderer!
    auto BlitLive3DControlVehicleCard = [&](float CardX, float CardY, float CardW, float CardH)
    {
        Canvas.FillRoundedCard(CardX, CardY, CardW, CardH, H * 0.028f, RgbaColor{22u, 28u, 38u, 255u});
        const uint32_t SubW = std::max(48u, static_cast<uint32_t>(std::round(CardW * 0.94f)));
        const uint32_t SubH = std::max(36u, static_cast<uint32_t>(std::round(CardH * 0.78f)));

        if (HasVehicleMeshes_)
        {
            const Vec3 Paint = GaragePaintSwatches[GaragePaintSwatch_ % GaragePaintSwatches.size()];
            BlinnMaterialProperties BodyCoat{};
            BodyCoat.LinearAlbedo = Paint;
            BodyCoat.Roughness    = (GaragePaintSwatch_ == 4u) ? 0.52f : 0.14f;
            BodyCoat.Metallic     = (GaragePaintSwatch_ == 0u) ? 0.18f : 0.45f;

            BlinnRenderer TurntableRenderer;
            const float   CosT = std::cos(GarageTurntableYawRad_);
            const float   SinT = std::sin(GarageTurntableYawRad_);
            const Vec3    AxX{CosT, SinT, 0.0f};
            const Vec3    AxY{-SinT, CosT, 0.0f};
            const Vec3    AxZ{0.0f, 0.0f, 1.0f};

            TurntableRenderer.SubmitFacetMesh(BodyMesh_, Vec3{0.0f, 0.0f, 0.78f}, AxX, AxY, AxZ, &BodyCoat, nullptr, true);

            // Exact ControlVehicle wheel socket coordinates from VehicleSpecification.js!
            constexpr std::array<std::array<float, 3u>, 4u> WheelSockets = {{
                { 1.7274f,  1.0475f, 0.415f},
                { 1.7274f, -1.0475f, 0.415f},
                {-1.6686f,  1.0475f, 0.415f},
                {-1.6686f, -1.0475f, 0.415f}
            }};
            for (size_t K = 0u; K < 4u; ++K)
            {
                const Vec3 WPos = AxX * WheelSockets[K][0] + AxY * WheelSockets[K][1] + AxZ * WheelSockets[K][2];
                TurntableRenderer.SubmitFacetMesh(TyreMesh_, WPos, AxX, AxY, AxZ, nullptr, nullptr, true);
                TurntableRenderer.SubmitFacetMesh((K % 2u == 0u) ? RimLeftMesh_ : RimRightMesh_, WPos, AxX, AxY, AxZ, nullptr, nullptr, true);
            }

            BlinnCameraDescriptor StudioCam{};
            StudioCam.EyeWorld       = Vec3{5.85f, -3.25f, 2.05f};
            StudioCam.TargetWorld    = Vec3{0.05f, 0.0f, 0.66f};
            StudioCam.VerticalFovDeg = 35.0f;

            BlinnRenderSettings StudioCfg{};
            StudioCfg.ResolutionScale   = 1.0f;
            StudioCfg.CastPlanarShadows = true;
            StudioCfg.DrawGroundChecker = false;
            StudioCfg.StudioBackdrop    = true;
            StudioCfg.WireframeOverlay  = (GarageMode_ == GarageInspectionMode::Wireframe);
            StudioCfg.ShadowPlaneZ      = 0.0f;

            std::vector<uint8_t> CarRgb;
            TurntableRenderer.RenderSceneToSrgb8(SubW, SubH, StudioCam, StudioCfg, CarRgb);

            const int DstX0 = static_cast<int>(std::round(CardX + 0.03f * CardW));
            const int DstY0 = static_cast<int>(std::round(CardY + 0.04f * CardH));
            for (uint32_t Sy = 0u; Sy < SubH; ++Sy)
            {
                for (uint32_t Sx = 0u; Sx < SubW; ++Sx)
                {
                    const size_t Off = (static_cast<size_t>(Sy) * SubW + Sx) * 3u;
                    RgbaColor    Col{CarRgb[Off + 0u], CarRgb[Off + 1u], CarRgb[Off + 2u], 255u};
                    if (GarageMode_ == GarageInspectionMode::Scanline && (Sy % 4u == 0u))
                    {
                        Col.R = static_cast<uint8_t>(std::min(255, static_cast<int>(Col.R) + 28));
                        Col.G = static_cast<uint8_t>(std::min(255, static_cast<int>(Col.G) + 52));
                        Col.B = static_cast<uint8_t>(std::min(255, static_cast<int>(Col.B) + 68));
                    }
                    else if (GarageMode_ == GarageInspectionMode::GhostXRay)
                    {
                        const uint8_t Lum = static_cast<uint8_t>((Col.R * 3u + Col.G * 6u + Col.B) / 10u);
                        Col = RgbaColor{static_cast<uint8_t>(Lum / 2u), Lum, std::min<uint8_t>(255u, static_cast<uint8_t>(Lum + 45u)), 255u};
                    }
                    Canvas.BlendPixel(DstX0 + static_cast<int>(Sx), DstY0 + static_cast<int>(Sy), Col, 1.0f);
                }
            }
        }

        // Paint swatch selector pills along bottom of the 3D Garage card!
        const float SwatchSize = std::min(CardW * 0.075f, CardH * 0.10f);
        for (uint32_t S = 0u; S < 6u; ++S)
        {
            const Vec3  PCol = GaragePaintSwatches[S];
            const float Sx   = CardX + CardW * 0.06f + static_cast<float>(S) * (SwatchSize * 1.45f);
            const float Sy   = CardY + CardH * 0.855f;
            if (S == GaragePaintSwatch_)
            {
                Canvas.FillRoundedCard(Sx - 2.0f, Sy - 2.0f, SwatchSize + 4.0f, SwatchSize + 4.0f, 0.5f * SwatchSize + 2.0f, RgbaColor{250u, 252u, 255u, 255u});
            }
            Canvas.FillRoundedCard(
                Sx, Sy, SwatchSize, SwatchSize, 0.5f * SwatchSize,
                RgbaColor{
                    static_cast<uint8_t>(PCol.X * 255.0f),
                    static_cast<uint8_t>(PCol.Y * 255.0f),
                    static_cast<uint8_t>(PCol.Z * 255.0f),
                    255u});
        }
    };

    if (ActiveDesign_ == CabinLauncherDesign::LaunchpadGrid)
    {
        // 4x3 full-screen launcher with all 12 Multicolour Vector SVG Icons (IconDepot.js)!
        const float CardW = W * 0.215f;
        const float CardH = H * 0.215f;
        for (uint32_t Row = 0u; Row < 3u; ++Row)
        {
            for (uint32_t Col = 0u; Col < 4u; ++Col)
            {
                const uint32_t Idx = Row * 4u + Col;
                const auto&    App = Apps[Idx];
                const float    Lx  = W * 0.040f + static_cast<float>(Col) * (CardW + W * 0.020f);
                const float    Ty  = H * 0.125f + static_cast<float>(Row) * (CardH + H * 0.026f);
                const bool     Sel = (App.Slot == ActiveApp_);
                Canvas.FillRoundedCard(
                    Lx, Ty, CardW, CardH, H * 0.028f,
                    Sel ? RgbaColor{40u, 54u, 68u, 255u} : RgbaColor{25u, 33u, 43u, 255u});
                DrawMulticolourSvgAppIcon(
                    OutRgba8, Width, Height, App.Slot,
                    Lx + CardW * 0.50f, Ty + CardH * 0.44f, std::min(CardW, CardH) * 0.58f, Sel);
            }
        }
    }
    else if (ActiveDesign_ == CabinLauncherDesign::FocusViewport && ActiveApp_ == CabinApplicationSlot::GarageBay)
    {
        // Full-stage 3D ControlVehicle Garage Studio!
        BlitLive3DControlVehicleCard(W * 0.03f, H * 0.115f, W * 0.94f, H * 0.695f);
    }
    else
    {
        // Split Dashboard: Left = LIVE 3D ControlVehicle Studio Turntable (or 4-Wheel Thermal Matrix); Right = Tyres + G-Circle + Weather!
        if (HasVehicleMeshes_)
        {
            BlitLive3DControlVehicleCard(W * 0.025f, H * 0.115f, W * 0.52f, H * 0.695f);
        }
        else
        {
            Canvas.FillRoundedCard(W * 0.025f, H * 0.115f, W * 0.52f, H * 0.695f, H * 0.03f, RgbaColor{26u, 34u, 44u, 255u});
        }

        // Right-top card: 4-Wheel Calibrated Tyre Thermal + Water/Snow Hazard Matrix!
        Canvas.FillRoundedCard(W * 0.565f, H * 0.115f, W * 0.41f, H * 0.335f, H * 0.028f, RgbaColor{25u, 33u, 43u, 255u});
        Canvas.FillRoundedCard(W * 0.735f, H * 0.165f, W * 0.07f, H * 0.23f, H * 0.02f, RgbaColor{48u, 60u, 74u, 255u});
        const float Wx[4] = {W * 0.635f, W * 0.835f, W * 0.635f, W * 0.835f};
        const float Wy[4] = {H * 0.155f, H * 0.155f, H * 0.305f, H * 0.305f};
        for (size_t K = 0u; K < 4u; ++K)
        {
            const auto& Wh = Telemetry.Wheels[K];
            Canvas.FillRoundedCard(Wx[K], Wy[K], W * 0.068f, H * 0.105f, H * 0.016f, ThermalHeatmapRgba(Wh.TreadTemperatureKelvin));
        }

        // Right-bottom card: G-Circle + Pedal Bars + Weather/Snow/Lightning Status!
        Canvas.FillRoundedCard(W * 0.565f, H * 0.475f, W * 0.41f, H * 0.335f, H * 0.028f, RgbaColor{25u, 33u, 43u, 255u});
        const float GCx = W * 0.675f;
        const float GCy = H * 0.640f;
        const float GR  = H * 0.115f;
        Canvas.FillRadialArc(GCx, GCy, GR * 0.88f, GR, 0.0f, 1.0f, 2.0f * PiHmi, RgbaColor{48u, 62u, 78u, 255u}, RgbaColor{64u, 198u, 248u, 255u});
        const float DotX = GCx + std::clamp(Telemetry.LateralG / 1.5f, -1.0f, 1.0f) * (GR * 0.78f);
        const float DotY = GCy - std::clamp(Telemetry.LongitudinalG / 1.5f, -1.0f, 1.0f) * (GR * 0.78f);
        Canvas.FillRoundedCard(DotX - 4.5f, DotY - 4.5f, 9.0f, 9.0f, 4.5f, RgbaColor{255u, 204u, 72u, 255u});

        Canvas.FillRoundedCard(W * 0.82f, H * 0.525f, W * 0.042f, H * 0.23f, 3.0f, RgbaColor{38u, 48u, 60u, 255u});
        const float ThrotH = H * 0.23f * std::clamp(Telemetry.ThrottlePedal01, 0.0f, 1.0f);
        Canvas.FillRoundedCard(W * 0.82f, H * 0.755f - ThrotH, W * 0.042f, ThrotH, 3.0f, RgbaColor{72u, 236u, 146u, 255u});

        Canvas.FillRoundedCard(W * 0.89f, H * 0.525f, W * 0.042f, H * 0.23f, 3.0f, RgbaColor{38u, 48u, 60u, 255u});
        const float BrakeH = H * 0.23f * std::clamp(Telemetry.BrakePedal01, 0.0f, 1.0f);
        Canvas.FillRoundedCard(W * 0.89f, H * 0.755f - BrakeH, W * 0.042f, BrakeH, 3.0f, RgbaColor{252u, 74u, 78u, 255u});
    }

    // Persistent Bottom Glass Dock Bar featuring 6 Multicolour Vector SVG App Icons!
    Canvas.FillRoundedCard(W * 0.11f, H * 0.835f, W * 0.78f, H * 0.138f, H * 0.036f, RgbaColor{26u, 35u, 46u, 255u});
    const CabinApplicationSlot DockSlots[6] = {
        CabinApplicationSlot::Navigation,
        CabinApplicationSlot::MediaPlayer,
        CabinApplicationSlot::GarageBay,
        CabinApplicationSlot::ClimateHvac,
        CabinApplicationSlot::TelemetryLab,
        CabinApplicationSlot::CabinPreferences};
    const float IconSize = std::min(W * 0.072f, H * 0.102f);
    for (uint32_t D = 0u; D < 6u; ++D)
    {
        const float Cx = W * 0.195f + static_cast<float>(D) * (W * 0.122f);
        const float Cy = H * 0.904f;
        DrawMulticolourSvgAppIcon(OutRgba8, Width, Height, DockSlots[D], Cx, Cy, IconSize, DockSlots[D] == ActiveApp_);
    }
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                          WINDSHIELD / EXTERIOR HUD SYNTHESIS (RGBA8)
------------------------------------------------------------------------------------------------------------------------------------------*/
void VehicleCabinHmi::SynthesizeWindshieldHudRgba8(
    uint32_t                          Width,
    uint32_t                          Height,
    const VehicleCabinTelemetryFrame& Telemetry,
    std::vector<uint8_t>&             OutRgba8) const
{
    OutRgba8.assign(static_cast<size_t>(Width) * Height * 4u, 0u);
    if (Width < 32u || Height < 32u)
    {
        return;
    }

    const float  W = static_cast<float>(Width);
    const float  H = static_cast<float>(Height);
    RasterCanvas Canvas{Width, Height, OutRgba8};

    Canvas.FillRoundedCard(W * 0.34f, H * 0.68f, W * 0.32f, H * 0.22f, H * 0.04f, RgbaColor{12u, 28u, 36u, 148u});
    const float SpeedKmh = std::max(0.0f, Telemetry.VehicleSpeedMps * 3.6f);
    Canvas.StampUnsignedNumber(
        static_cast<uint32_t>(std::round(SpeedKmh)), 3u, W * 0.52f, H * 0.73f, W * 0.042f, H * 0.12f,
        RgbaColor{118u, 248u, 232u, 240u});

    const char GearGlyph = (Telemetry.EngagedGear < 0)
                               ? 'R'
                               : ((Telemetry.EngagedGear == 0) ? 'N' : static_cast<char>('0' + std::min(9, Telemetry.EngagedGear)));
    Canvas.StampSevenSegmentGlyph(
        GearGlyph, W * 0.56f, H * 0.73f, W * 0.045f, H * 0.12f, std::max(2.5f, W * 0.008f),
        RgbaColor{255u, 224u, 118u, 240u});
}

/*------------------------------------------------------------------------------------------------------------------------------------------
             MOUNT REAL 3D CONTROLVEHICLE COCKPIT (SLATECABINLAYOUT + SHAPED 3D CLUSTER + 3D TABLET + CABIN EXPOSURE LOCK)
------------------------------------------------------------------------------------------------------------------------------------------*/
MountedControlVehicleCockpitRig VehicleCabinHmi::MountControlVehicle3DCockpit(
    Vec3                              VehicleOriginWorld,
    float                             VehicleYawRadians,
    const VehicleCabinTelemetryFrame& Telemetry,
    SceneRenderer&                    Renderer,
    CoupledWorldOpticalContext&       InOutOpticalContext) const
{
    MountedControlVehicleCockpitRig Rig{};
    const uint32_t StartTriCount = Renderer.TriangleCount();

    const float CosYaw = std::cos(VehicleYawRadians);
    const float SinYaw = std::sin(VehicleYawRadians);
    const Vec3  CarFwd{CosYaw, SinYaw, 0.0f};      // +X forward in ControlVehicle frame!
    const Vec3  CarLeft{-SinYaw, CosYaw, 0.0f};    // +Y left (driver side) in ControlVehicle frame!
    const Vec3  CarUp{0.0f, 0.0f, 1.0f};           // +Z up!

    // CoM height offset when seated on Z = 0 road (0.625 m authored CoM + 0.095 m unloaded tyre clearance).
    const Vec3 CoMWorld = VehicleOriginWorld + CarUp * 0.72f;

    auto BodyToWorld = [&](float Bx, float By, float Bz) noexcept -> Vec3
    {
        return CoMWorld + CarFwd * Bx + CarLeft * By + CarUp * Bz;
    };
    auto DirToWorld = [&](float Dx, float Dy, float Dz) noexcept -> Vec3
    {
        return Normalise(CarFwd * Dx + CarLeft * Dy + CarUp * Dz);
    };

    // Configure ExposureAdaptation vehicle cabin pose (note ExposureAdaptation uses Right = -CarLeft, Forward = CarFwd, Up = CarUp)!
    InOutOpticalContext.HasVehicleCabinExposurePose = true;
    InOutOpticalContext.VehicleCabinOriginWorld     = CoMWorld;
    InOutOpticalContext.VehicleCabinRightWorld      = -CarLeft;
    InOutOpticalContext.VehicleCabinForwardWorld    = CarFwd;
    InOutOpticalContext.VehicleCabinUpWorld         = CarUp;

    // 1. Emit ControlVehicle exterior body + dielectric glass shell + 4 wheels if loaded!
    if (HasVehicleMeshes_)
    {
        const Vec3 Paint = GaragePaintSwatches[GaragePaintSwatch_ % GaragePaintSwatches.size()];
        auto EmitFacetMesh = [&](const BlinnFacetMesh& Mesh, Vec3 OffsetBody, bool AllowPaint)
        {
            const uint32_t TriCnt = static_cast<uint32_t>(Mesh.Indices.size() / 3u);
            for (uint32_t T = 0u; T < TriCnt; ++T)
            {
                const uint32_t I0 = Mesh.Indices[T * 3u + 0u];
                const uint32_t I1 = Mesh.Indices[T * 3u + 1u];
                const uint32_t I2 = Mesh.Indices[T * 3u + 2u];
                const Vec3     P0 = BodyToWorld(Mesh.Positions[I0].X + OffsetBody.X, Mesh.Positions[I0].Y + OffsetBody.Y, Mesh.Positions[I0].Z + OffsetBody.Z);
                const Vec3     P1 = BodyToWorld(Mesh.Positions[I1].X + OffsetBody.X, Mesh.Positions[I1].Y + OffsetBody.Y, Mesh.Positions[I1].Z + OffsetBody.Z);
                const Vec3     P2 = BodyToWorld(Mesh.Positions[I2].X + OffsetBody.X, Mesh.Positions[I2].Y + OffsetBody.Y, Mesh.Positions[I2].Z + OffsetBody.Z);
                const Vec3     FaceCross = Cross(P1 - P0, P2 - P0);
                if (Length(FaceCross) <= 1.0e-7f)
                {
                    continue;
                }
                const uint32_t MatId = (T < Mesh.MaterialIds.size()) ? Mesh.MaterialIds[T] : 0u;
                BlinnMaterialProperties Style = BlinnRenderer::ResolveVehicleMaterial(MatId);
                if (AllowPaint && (MatId == 0u || MatId == 6u))
                {
                    Style.LinearAlbedo = Paint;
                }

                RtxSceneTriangle Tri{};
                Tri.V0 = P0;
                Tri.V1 = P1;
                Tri.V2 = P2;
                Tri.Normal = Normalise(FaceCross);
                if (Mesh.SmoothNormals && Mesh.VertexNormals.size() == Mesh.Positions.size())
                {
                    Tri.V0Normal            = DirToWorld(Mesh.VertexNormals[I0].X, Mesh.VertexNormals[I0].Y, Mesh.VertexNormals[I0].Z);
                    Tri.V1Normal            = DirToWorld(Mesh.VertexNormals[I1].X, Mesh.VertexNormals[I1].Y, Mesh.VertexNormals[I1].Z);
                    Tri.V2Normal            = DirToWorld(Mesh.VertexNormals[I2].X, Mesh.VertexNormals[I2].Y, Mesh.VertexNormals[I2].Z);
                    Tri.SmoothVertexNormals = true;
                }
                Tri.AlbedoRgb   = Style.LinearAlbedo;
                Tri.EmissiveRgb = Style.LinearEmission;
                Tri.Roughness   = Style.Roughness;
                Tri.Metallic    = Style.Metallic;
                if (Style.Opacity < 0.90f)
                {
                    Tri.TransmissiveGlass  = true;
                    Tri.RefractiveIndexIor = 1.50f;
                    Tri.SpectralAbsorption = Vec3{0.08f, 0.04f, 0.04f};
                    Tri.Roughness          = 0.03f;
                }
                Renderer.RegisterPolygonTriangle(Tri);
            }
        };

        EmitFacetMesh(BodyMesh_, Vec3{0.0f, 0.0f, 0.0f}, true);
        constexpr std::array<std::array<float, 3u>, 4u> WheelLocal = {{
            { 1.7274f,  1.0475f, -0.375f},
            { 1.7274f, -1.0475f, -0.375f},
            {-1.6686f,  1.0475f, -0.375f},
            {-1.6686f, -1.0475f, -0.375f}
        }};
        for (size_t K = 0u; K < 4u; ++K)
        {
            const Vec3 WOff{WheelLocal[K][0], WheelLocal[K][1], WheelLocal[K][2]};
            EmitFacetMesh(TyreMesh_, WOff, false);
            EmitFacetMesh((K % 2u == 0u) ? RimLeftMesh_ : RimRightMesh_, WOff, false);
        }
    }

    // 2. Emit 3D Cockpit Interior Fittings (SlateCabinLayout.js: dash, centre tunnel, bucket seats, floor pan)!
    auto EmitOrientedInteriorBox = [&](float Cx, float Cy, float Cz, float Sx, float Sy, float Sz, Vec3 Albedo, float Rough)
    {
        const Vec3 C  = BodyToWorld(Cx, Cy, Cz - 0.625f);
        const Vec3 Ax = CarFwd * (0.5f * Sx);
        const Vec3 Ay = CarLeft * (0.5f * Sy);
        const Vec3 Az = CarUp * (0.5f * Sz);

        auto EmitQuad = [&](Vec3 A, Vec3 B, Vec3 D, Vec3 E, Vec3 N)
        {
            RtxSceneTriangle T0{};
            T0.V0 = A; T0.V1 = B; T0.V2 = D; T0.Normal = N; T0.AlbedoRgb = Albedo; T0.Roughness = Rough;
            Renderer.RegisterPolygonTriangle(T0);
            RtxSceneTriangle T1 = T0;
            T1.V0 = A; T1.V1 = D; T1.V2 = E;
            Renderer.RegisterPolygonTriangle(T1);
        };
        EmitQuad(C + Ax - Ay - Az, C + Ax + Ay - Az, C + Ax + Ay + Az, C + Ax - Ay + Az,  CarFwd);
        EmitQuad(C - Ax + Ay - Az, C - Ax - Ay - Az, C - Ax - Ay + Az, C - Ax + Ay + Az, -CarFwd);
        EmitQuad(C + Ax + Ay - Az, C - Ax + Ay - Az, C - Ax + Ay + Az, C + Ax + Ay + Az,  CarLeft);
        EmitQuad(C - Ax - Ay - Az, C + Ax - Ay - Az, C + Ax - Ay + Az, C - Ax - Ay + Az, -CarLeft);
        EmitQuad(C - Ax + Ay + Az, C - Ax - Ay + Az, C + Ax - Ay + Az, C + Ax + Ay + Az,  CarUp);
        EmitQuad(C - Ax - Ay - Az, C - Ax + Ay - Az, C + Ax + Ay - Az, C + Ax - Ay - Az, -CarUp);
    };

    EmitOrientedInteriorBox( 1.24f,  0.00f, 0.52f, 0.24f, 1.92f, 0.17f, Vec3{0.055f, 0.062f, 0.075f}, 0.62f); // Dash top
    EmitOrientedInteriorBox( 0.30f,  0.00f, 0.05f, 1.28f, 0.28f, 0.30f, Vec3{0.045f, 0.050f, 0.060f}, 0.55f); // Centre tunnel
    EmitOrientedInteriorBox(-0.50f,  0.50f, 0.03f, 0.65f, 0.49f, 0.15f, Vec3{0.070f, 0.075f, 0.088f}, 0.72f); // Driver cushion
    EmitOrientedInteriorBox(-0.50f, -0.50f, 0.03f, 0.65f, 0.49f, 0.15f, Vec3{0.070f, 0.075f, 0.088f}, 0.72f); // Passenger cushion
    EmitOrientedInteriorBox(-0.83f,  0.50f, 0.16f, 0.14f, 0.52f, 0.69f, Vec3{0.070f, 0.075f, 0.088f}, 0.72f); // Driver backrest
    EmitOrientedInteriorBox(-0.83f, -0.50f, 0.16f, 0.14f, 0.52f, 0.69f, Vec3{0.070f, 0.075f, 0.088f}, 0.72f); // Passenger backrest
    EmitOrientedInteriorBox( 0.00f,  0.00f,-0.05f, 2.10f, 1.86f, 0.07f, Vec3{0.035f, 0.038f, 0.045f}, 0.85f); // Cabin floor

    // 3. Synthesize & register high-res RGBA8 textures for the 3D Wheel-Mounted Shaped Cluster & 3D Centre Tablet!
    std::vector<uint8_t> ClusterPixels;
    std::vector<uint8_t> TabletPixels;
    SynthesizeInstrumentClusterRgba8(750u, 420u, Telemetry, ClusterPixels);
    SynthesizeCentralScreenRgba8(960u, 600u, Telemetry, TabletPixels);
    Rig.ClusterDisplayTextureId = Renderer.RegisterEmissiveDisplayTexture(750u, 420u, ClusterPixels);
    Rig.TabletDisplayTextureId  = Renderer.RegisterEmissiveDisplayTexture(960u, 600u, TabletPixels);

    // 4. Emit 3D Toroidal Steering Wheel + Spokes + Shaped 3D Cluster Polygon (SlateCabinFittings.js)!
    //    Wheel = [0.68, 0.42, 0.82], WheelTilt = 0.22 rad, WheelRadius = 0.19 m.
    const Vec3  WheelPivot  = BodyToWorld(0.68f, 0.42f, 0.82f - 0.625f);
    const float WheelTilt   = 0.22f;
    const Vec3  WheelRight0 = -CarLeft; // Viewer's right (-Y in body frame)
    const Vec3  WheelUp0    = Normalise(CarFwd * std::sin(WheelTilt) + CarUp * std::cos(WheelTilt));
    const Vec3  WheelNorm   = Normalise(Cross(WheelRight0, WheelUp0)); // Toward driver!
    const float SteerRad    = Telemetry.SteeringAngleDegrees * (PiHmi / 180.0f);
    const Vec3  WheelRight  = WheelRight0 * std::cos(SteerRad) + WheelUp0 * std::sin(SteerRad);
    const Vec3  WheelUp     = -WheelRight0 * std::sin(SteerRad) + WheelUp0 * std::cos(SteerRad);

    constexpr uint32_t Sectors = 48u;
    constexpr uint32_t Sides   = 10u;
    constexpr float    WheelR  = 0.19f;
    constexpr float    TubeR   = 0.017f;
    auto WheelTorusPt = [&](uint32_t I, uint32_t J, Vec3& OutN) noexcept -> Vec3
    {
        const float A = (2.0f * PiHmi * static_cast<float>(I)) / static_cast<float>(Sectors);
        const float B = (2.0f * PiHmi * static_cast<float>(J)) / static_cast<float>(Sides);
        const Vec3  RadDir = WheelRight * std::cos(A) + WheelUp * std::sin(A);
        OutN = Normalise(RadDir * std::cos(B) + WheelNorm * std::sin(B));
        return WheelPivot + RadDir * (WheelR + TubeR * std::cos(B)) + WheelNorm * (TubeR * std::sin(B));
    };
    for (uint32_t I = 0u; I < Sectors; ++I)
    {
        for (uint32_t J = 0u; J < Sides; ++J)
        {
            Vec3 N00{}, N10{}, N11{}, N01{};
            const Vec3 P00 = WheelTorusPt(I, J, N00);
            const Vec3 P10 = WheelTorusPt(I + 1u, J, N10);
            const Vec3 P11 = WheelTorusPt(I + 1u, J + 1u, N11);
            const Vec3 P01 = WheelTorusPt(I, J + 1u, N01);
            RtxSceneTriangle T0{};
            T0.V0 = P00; T0.V1 = P10; T0.V2 = P11; T0.Normal = Normalise(Cross(P10 - P00, P11 - P00));
            T0.V0Normal = N00; T0.V1Normal = N10; T0.V2Normal = N11; T0.SmoothVertexNormals = true;
            T0.AlbedoRgb = Vec3{0.05f, 0.055f, 0.065f}; T0.Roughness = 0.45f;
            Renderer.RegisterPolygonTriangle(T0);
            RtxSceneTriangle T1 = T0;
            T1.V0 = P00; T1.V1 = P11; T1.V2 = P01; T1.Normal = Normalise(Cross(P11 - P00, P01 - P00));
            T1.V0Normal = N00; T1.V1Normal = N11; T1.V2Normal = N01;
            Renderer.RegisterPolygonTriangle(T1);
        }
    }

    // Shaped 3D Instrument Cluster mounted on the steering hub (0.27 m x 0.151 m, Outline fan with UV mapping)!
    const auto  Outline = BuildClusterOutlinePolygon(ClusterOutline_);
    const float ClusW   = 0.27f;
    const float ClusH   = 0.151f;
    const Vec3  ClusBezelOrigin  = WheelPivot + WheelNorm * 0.018f;
    const Vec3  ClusScreenOrigin = WheelPivot + WheelNorm * 0.023f;
    for (size_t I = 0u; I < Outline.size(); ++I)
    {
        const auto& A = Outline[I];
        const auto& B = Outline[(I + 1u) % Outline.size()];

        // Dark carbon bezel backing
        RtxSceneTriangle Bezel{};
        Bezel.V0        = ClusBezelOrigin;
        Bezel.V1        = ClusBezelOrigin + WheelRight0 * (A[0] * ClusW * 0.54f) + WheelUp0 * (A[1] * ClusH * 0.54f);
        Bezel.V2        = ClusBezelOrigin + WheelRight0 * (B[0] * ClusW * 0.54f) + WheelUp0 * (B[1] * ClusH * 0.54f);
        Bezel.Normal    = WheelNorm;
        Bezel.AlbedoRgb = Vec3{0.03f, 0.035f, 0.045f};
        Bezel.Roughness = 0.28f;
        Renderer.RegisterPolygonTriangle(Bezel);

        // UV-mapped emissive shaped 3D cluster display!
        RtxSceneTriangle Disp{};
        Disp.V0                   = ClusScreenOrigin;
        Disp.V1                   = ClusScreenOrigin + WheelRight0 * (A[0] * ClusW * 0.50f) + WheelUp0 * (A[1] * ClusH * 0.50f);
        Disp.V2                   = ClusScreenOrigin + WheelRight0 * (B[0] * ClusW * 0.50f) + WheelUp0 * (B[1] * ClusH * 0.50f);
        Disp.Normal               = WheelNorm;
        Disp.Roughness            = 0.08f;
        Disp.EmissiveTextureId    = Rig.ClusterDisplayTextureId;
        Disp.DisplayLuminanceGain = 3.2f;
        Disp.UV0                  = {0.5f, 0.5f};
        Disp.UV1                  = {A[0] * 0.5f + 0.5f, 0.5f - A[1] * 0.5f};
        Disp.UV2                  = {B[0] * 0.5f + 0.5f, 0.5f - B[1] * 0.5f};
        Renderer.RegisterPolygonTriangle(Disp);
    }

    // 5. Emit 3D Centre Infotainment Tablet (SlateCabinLayout.js: [0.98, 0.0, 0.62], Tilt = 0.42, 0.30 m x 0.1875 m, slightly angled toward driver)!
    const Vec3  TabBase   = BodyToWorld(0.98f, 0.0f, 0.62f - 0.625f);
    const float TabTilt   = 0.42f;
    const float TabYaw    = 0.14f; // Subtle ergonomic cant toward driver seat!
    const Vec3  TabRight  = Normalise((-CarLeft) * std::cos(TabYaw) - CarFwd * std::sin(TabYaw));
    const Vec3  TabUp     = Normalise(CarFwd * std::sin(TabTilt) + CarUp * std::cos(TabTilt));
    const Vec3  TabNormal = Normalise(Cross(TabRight, TabUp));
    const float HalfTW    = 0.150f;
    const float HalfTH    = 0.09375f;

    // Aluminium/slate bezel backing
    {
        const Vec3 Bc = TabBase + TabNormal * 0.008f;
        const Vec3 R  = TabRight * (HalfTW + 0.012f);
        const Vec3 U  = TabUp * (HalfTH + 0.012f);
        RtxSceneTriangle B0{};
        B0.V0 = Bc - R - U; B0.V1 = Bc + R - U; B0.V2 = Bc + R + U; B0.Normal = TabNormal;
        B0.AlbedoRgb = Vec3{0.08f, 0.09f, 0.11f}; B0.Roughness = 0.24f; B0.Metallic = 0.65f;
        Renderer.RegisterPolygonTriangle(B0);
        RtxSceneTriangle B1 = B0;
        B1.V0 = Bc - R - U; B1.V1 = Bc + R + U; B1.V2 = Bc - R + U;
        Renderer.RegisterPolygonTriangle(B1);
    }

    // UV-mapped 3D Infotainment Screen Quad!
    const Vec3 Sc = TabBase + TabNormal * 0.014f;
    {
        const Vec3 R = TabRight * HalfTW;
        const Vec3 U = TabUp * HalfTH;
        RtxSceneTriangle S0{};
        S0.V0 = Sc - R - U; S0.V1 = Sc + R - U; S0.V2 = Sc + R + U; S0.Normal = TabNormal;
        S0.Roughness = 0.06f; S0.EmissiveTextureId = Rig.TabletDisplayTextureId; S0.DisplayLuminanceGain = 3.0f;
        S0.UV0 = {0.0f, 1.0f}; S0.UV1 = {1.0f, 1.0f}; S0.UV2 = {1.0f, 0.0f};
        Renderer.RegisterPolygonTriangle(S0);

        RtxSceneTriangle S1 = S0;
        S1.V0 = Sc - R - U; S1.V1 = Sc + R + U; S1.V2 = Sc - R + U;
        S1.UV0 = {0.0f, 1.0f}; S1.UV1 = {1.0f, 0.0f}; S1.UV2 = {0.0f, 0.0f};
        Renderer.RegisterPolygonTriangle(S1);
    }

    // 6. Register 3 Kooima-Aimed Planar Mirrors (Left Wing, Right Wing, Interior Rear-View — CabinStructure.js)!
    const Vec3 DriverEye = BodyToWorld(-0.20f, 0.42f, 1.12f - 0.625f);
    auto AddAimedMirror = [&](float Mx, float My, float Mz, Vec3 DesiredReflectedBody, float Mw, float Mh)
    {
        const Vec3 Centre   = BodyToWorld(Mx, My, Mz - 0.625f);
        const Vec3 Incoming = Normalise(Centre - DriverEye);
        const Vec3 Wanted   = DirToWorld(DesiredReflectedBody.X, DesiredReflectedBody.Y, DesiredReflectedBody.Z);
        const Vec3 MNormal  = Normalise(Wanted - Incoming);
        const Vec3 MRight   = Normalise(Cross(CarUp, MNormal));
        const Vec3 MUp      = Normalise(Cross(MNormal, MRight));

        PlanarMirrorAperture Mirror{};
        Mirror.CentreWorld      = Centre;
        Mirror.RightAxis        = MRight;
        Mirror.UpAxis           = MUp;
        Mirror.FrontNormal      = MNormal;
        Mirror.HalfWidthMetres  = 0.5f * Mw;
        Mirror.HalfHeightMetres = 0.5f * Mh;
        Renderer.RegisterPlanarMirror(Mirror);
    };
    AddAimedMirror(1.02f,  1.33f, 0.86f, Vec3{-1.0f,  0.06f, -0.03f},  0.19f, 0.105f);
    AddAimedMirror(1.02f, -1.33f, 0.86f, Vec3{-1.0f, -0.06f, -0.03f},  0.19f, 0.105f);
    AddAimedMirror(0.62f,  0.00f, 1.20f, Vec3{-1.0f,  0.00f, -0.035f}, 0.26f, 0.075f);

    Rig.DriverEyeWorld        = DriverEye;
    Rig.DriverLookTargetWorld = BodyToWorld(1.05f, 0.18f, 0.78f - 0.625f); // Frames BOTH 3D Hexagonal Cluster, 3D Tablet & Windshield!
    Rig.DriverVerticalFovRad  = 68.0f * (PiHmi / 180.0f);
    Rig.HmiFocusEyeWorld      = BodyToWorld(0.08f, 0.24f, 0.96f - 0.625f);
    Rig.HmiFocusTargetWorld   = BodyToWorld(0.86f, 0.16f, 0.70f - 0.625f);
    Rig.CockpitTrianglesAdded = Renderer.TriangleCount() - StartTriCount;
    return Rig;
}

} // namespace Frontier
