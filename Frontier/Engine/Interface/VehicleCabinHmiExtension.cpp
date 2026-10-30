/*==========================================================================================================================================
                                                VEHICLECABINHMIEXTENSION.CPP
==========================================================================================================================================*/
// 🧩 Native Vehicle Cabin Digital Cluster, 12-App Central Infotainment Screen (5 launcher layouts), and Windshield HUD Telemetry.

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/Interface/VehicleCabinHmiExtension.h"

#include <algorithm>
#include <cmath>

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

        const float MidR  = 0.5f * (InnerR + OuterR);
        const float HalfT = 0.5f * (OuterR - InnerR);
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
                    while (Ang < 0.0f)
                    {
                        Ang += 2.0f * PiHmi;
                    }
                    while (Ang >= 2.0f * PiHmi)
                    {
                        Ang -= 2.0f * PiHmi;
                    }
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

    // Crisp 7-segment vector digit renderer ('0'..'9', '-', 'R', 'N').
    void StampSevenSegmentGlyph(char Ch, float Left, float Top, float W, float H, float Thick, RgbaColor Col) noexcept
    {
        // Bitmask: 0=top, 1=top-left, 2=top-right, 3=mid, 4=bot-left, 5=bot-right, 6=bot
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
    // Cold blue (275 K) -> optimal emerald green (345 K) -> hot amber (385 K) -> critical crimson (425 K)!
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
} // namespace

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                   CATALOGUE & ALERT EVALUATION
------------------------------------------------------------------------------------------------------------------------------------------*/
VehicleCabinHmiExtension::VehicleCabinHmiExtension() = default;

const std::array<CabinApplicationMetadata, VehicleCabinHmiExtension::ApplicationCount>&
VehicleCabinHmiExtension::Catalogue() noexcept
{
    static constexpr std::array<CabinApplicationMetadata, ApplicationCount> Apps = {{
        {CabinApplicationSlot::VehicleSetup, "vehicle", "Vehicle", "Make it your own", {0.64f, 0.90f, 0.75f}, 0u},
        {CabinApplicationSlot::DriveRoom, "drive-room", "Drive Room", "Your people. Your race.", {1.00f, 0.81f, 0.53f}, 3u},
        {CabinApplicationSlot::Messages, "messages", "Messages", "Keep the conversation going", {0.58f, 0.79f, 1.00f}, 2u},
        {CabinApplicationSlot::Contacts, "contacts", "Contacts", "People worth driving with", {0.96f, 0.69f, 0.61f}, 0u},
        {CabinApplicationSlot::Navigation, "navigation", "Navigation", "Find your next road", {0.56f, 0.88f, 0.82f}, 0u},
        {CabinApplicationSlot::MediaPlayer, "media", "Media", "Set the pace", {0.94f, 0.65f, 0.84f}, 0u},
        {CabinApplicationSlot::TyreMonitor, "tyres", "Tyres", "Every corner counts", {0.67f, 0.85f, 0.91f}, 0u},
        {CabinApplicationSlot::TelemetryLab, "telemetry", "Telemetry", "Know your machine", {0.80f, 0.70f, 0.94f}, 0u},
        {CabinApplicationSlot::ClimateHvac, "climate", "Climate", "Your comfort zone", {0.64f, 0.86f, 0.91f}, 0u},
        {CabinApplicationSlot::GarageBay, "garage", "Garage", "A place for your car", {0.90f, 0.75f, 0.58f}, 0u},
        {CabinApplicationSlot::AccountCloud, "account", "Account", "Always your space", {0.73f, 0.71f, 0.96f}, 0u},
        {CabinApplicationSlot::CabinPreferences, "settings", "Settings", "The little things", {0.77f, 0.81f, 0.82f}, 0u},
    }};
    return Apps;
}

CabinHmiAlertDigest VehicleCabinHmiExtension::EvaluateAlerts(const VehicleCabinTelemetryFrame& Telemetry) noexcept
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
                                        DIGITAL INSTRUMENT CLUSTER SYNTHESIS (RGBA8)
------------------------------------------------------------------------------------------------------------------------------------------*/
void VehicleCabinHmiExtension::SynthesizeInstrumentClusterRgba8(
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

    // Deep obsidian slate instrument binnacle background.
    Canvas.FillRoundedCard(0.0f, 0.0f, W, H, H * 0.08f, RgbaColor{14u, 18u, 24u, 255u});
    Canvas.FillRoundedCard(W * 0.015f, H * 0.04f, W * 0.97f, H * 0.92f, H * 0.06f, RgbaColor{20u, 26u, 35u, 255u});

    const CabinHmiAlertDigest Alerts = EvaluateAlerts(Telemetry);

    // 1. Top 10-segment Shift-Light Bar (green -> amber -> crimson flash)!
    const float LedW   = W * 0.052f;
    const float LedGap = W * 0.010f;
    const float LedX0  = 0.5f * (W - (10.0f * LedW + 9.0f * LedGap));
    for (uint32_t L = 0u; L < 10u; ++L)
    {
        const bool Lit = (L < Alerts.ActiveShiftLedCount);
        RgbaColor  Col = RgbaColor{36u, 44u, 56u, 255u};
        if (Lit)
        {
            if (Alerts.RedlineShiftFlash || L >= 7u)
            {
                Col = RgbaColor{250u, 62u, 68u, 255u};
            }
            else if (L >= 4u)
            {
                Col = RgbaColor{250u, 192u, 52u, 255u};
            }
            else
            {
                Col = RgbaColor{72u, 232u, 138u, 255u};
            }
        }
        Canvas.FillRoundedCard(LedX0 + static_cast<float>(L) * (LedW + LedGap), H * 0.09f, LedW, H * 0.055f, 3.0f, Col);
    }

    // 2. Left Speedometer Dial (km/h up to 340 km/h)!
    const float SpeedKmh  = std::max(0.0f, Telemetry.VehicleSpeedMps * 3.6f);
    const float SpeedFrac = std::clamp(SpeedKmh / 340.0f, 0.0f, 1.0f);
    const float DialR     = std::min(W * 0.17f, H * 0.36f);
    Canvas.FillRadialArc(
        W * 0.24f,
        H * 0.56f,
        DialR * 0.76f,
        DialR,
        PiHmi * 0.75f,
        SpeedFrac,
        PiHmi * 1.50f,
        RgbaColor{38u, 48u, 64u, 255u},
        RgbaColor{88u, 198u, 252u, 255u});

    Canvas.StampUnsignedNumber(
        static_cast<uint32_t>(std::round(SpeedKmh)),
        3u,
        W * 0.285f,
        H * 0.48f,
        DialR * 0.22f,
        DialR * 0.38f,
        RgbaColor{238u, 245u, 255u, 255u});

    // 3. Right Tachometer / EV Power Dial!
    const float RpmFrac = std::clamp(Telemetry.EngineOrMotorRpm / std::max(1000.0f, Telemetry.RedlineRpm), 0.0f, 1.0f);
    Canvas.FillRadialArc(
        W * 0.76f,
        H * 0.56f,
        DialR * 0.76f,
        DialR,
        PiHmi * 0.75f,
        RpmFrac,
        PiHmi * 1.50f,
        RgbaColor{38u, 48u, 64u, 255u},
        Alerts.RedlineShiftFlash ? RgbaColor{252u, 72u, 76u, 255u} : RgbaColor{124u, 232u, 168u, 255u});

    Canvas.StampUnsignedNumber(
        static_cast<uint32_t>(std::round(Telemetry.EngineOrMotorRpm * 0.01f)),
        2u,
        W * 0.79f,
        H * 0.48f,
        DialR * 0.22f,
        DialR * 0.38f,
        RgbaColor{228u, 242u, 236u, 255u});

    // 4. Centre Engaged Gear Card + Boost / N2O / EV SoC Bars + Warning Telltales!
    Canvas.FillRoundedCard(W * 0.43f, H * 0.24f, W * 0.14f, H * 0.42f, H * 0.05f, RgbaColor{28u, 36u, 48u, 255u});
    const char GearGlyph = (Telemetry.EngagedGear < 0)
                               ? 'R'
                               : ((Telemetry.EngagedGear == 0) ? 'N' : static_cast<char>('0' + std::min(9, Telemetry.EngagedGear)));
    Canvas.StampSevenSegmentGlyph(
        GearGlyph,
        W * 0.472f,
        H * 0.31f,
        W * 0.056f,
        H * 0.28f,
        std::max(3.0f, W * 0.010f),
        Alerts.RedlineShiftFlash ? RgbaColor{255u, 96u, 96u, 255u} : RgbaColor{255u, 218u, 118u, 255u});

    // Boost / Regen bar & Fuel / SoC bar along lower center!
    const float Energy01 = Telemetry.ElectricPropulsionMode ? Telemetry.BatteryCharge01 : Telemetry.FuelLevel01;
    Canvas.FillRoundedCard(W * 0.38f, H * 0.72f, W * 0.24f, H * 0.06f, 3.0f, RgbaColor{36u, 44u, 58u, 255u});
    Canvas.FillRoundedCard(
        W * 0.38f,
        H * 0.72f,
        W * 0.24f * std::clamp(Energy01, 0.02f, 1.0f),
        H * 0.06f,
        3.0f,
        Telemetry.ElectricPropulsionMode ? RgbaColor{86u, 224u, 198u, 255u} : RgbaColor{245u, 184u, 78u, 255u});

    const float Boost01 = std::clamp(Telemetry.ManifoldBoostBar / 2.0f, 0.0f, 1.0f);
    if (Boost01 > 0.01f || Telemetry.NitrousPurgingOrActive)
    {
        Canvas.FillRoundedCard(W * 0.38f, H * 0.81f, W * 0.24f, H * 0.05f, 3.0f, RgbaColor{36u, 44u, 58u, 255u});
        Canvas.FillRoundedCard(
            W * 0.38f,
            H * 0.81f,
            W * 0.24f * std::max(0.08f, Boost01),
            H * 0.05f,
            3.0f,
            Telemetry.NitrousPurgingOrActive ? RgbaColor{110u, 178u, 255u, 255u} : RgbaColor{255u, 136u, 72u, 255u});
    }

    // Hazard telltales (Traction/Ice, Thermal, Storm/Hail/Lightning)!
    if (Alerts.TractionHazardLamp)
    {
        Canvas.FillRoundedCard(W * 0.40f, H * 0.88f, W * 0.05f, H * 0.06f, 3.0f, RgbaColor{252u, 186u, 48u, 255u});
    }
    if (Alerts.ThermalWarningLamp)
    {
        Canvas.FillRoundedCard(W * 0.475f, H * 0.88f, W * 0.05f, H * 0.06f, 3.0f, RgbaColor{250u, 68u, 68u, 255u});
    }
    if (Alerts.SevereWeatherBanner)
    {
        Canvas.FillRoundedCard(W * 0.55f, H * 0.88f, W * 0.05f, H * 0.06f, 3.0f, RgbaColor{132u, 196u, 255u, 255u});
    }
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                        CENTRAL INFOTAINMENT SCREEN SYNTHESIS (RGBA8)
------------------------------------------------------------------------------------------------------------------------------------------*/
void VehicleCabinHmiExtension::SynthesizeCentralScreenRgba8(
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

    // Calm botanical-slate cabin infotainment aesthetic matching AppSpecification.js!
    Canvas.FillRoundedCard(0.0f, 0.0f, W, H, H * 0.04f, RgbaColor{22u, 28u, 32u, 255u});
    Canvas.FillRoundedCard(W * 0.02f, H * 0.025f, W * 0.96f, H * 0.08f, H * 0.02f, RgbaColor{32u, 40u, 46u, 255u});

    const auto& Apps = Catalogue();

    if (ActiveDesign_ == CabinLauncherDesign::LaunchpadGrid)
    {
        // 4x3 full-screen launcher icon grid!
        const float CardW = W * 0.21f;
        const float CardH = H * 0.22f;
        for (uint32_t Row = 0u; Row < 3u; ++Row)
        {
            for (uint32_t Col = 0u; Col < 4u; ++Col)
            {
                const uint32_t Idx = Row * 4u + Col;
                const auto&    App = Apps[Idx];
                const float    Lx  = W * 0.045f + static_cast<float>(Col) * (CardW + W * 0.024f);
                const float    Ty  = H * 0.14f + static_cast<float>(Row) * (CardH + H * 0.03f);
                const bool     Sel = (App.Slot == ActiveApp_);
                Canvas.FillRoundedCard(
                    Lx,
                    Ty,
                    CardW,
                    CardH,
                    H * 0.03f,
                    Sel ? RgbaColor{54u, 68u, 74u, 255u} : RgbaColor{34u, 43u, 49u, 255u});
                Canvas.FillRoundedCard(
                    Lx + CardW * 0.12f,
                    Ty + CardH * 0.18f,
                    CardW * 0.34f,
                    CardH * 0.44f,
                    H * 0.02f,
                    RgbaColor{
                        static_cast<uint8_t>(App.AccentSrgb.X * 255.0f),
                        static_cast<uint8_t>(App.AccentSrgb.Y * 255.0f),
                        static_cast<uint8_t>(App.AccentSrgb.Z * 255.0f),
                        255u});
            }
        }
    }
    else
    {
        // Split Dashboard / Telemetry Stage: Left = 4-Wheel Thermal + Puddle/Mud/Snow Matrix; Right = G-Circle + Weather + Propulsion!
        Canvas.FillRoundedCard(W * 0.03f, H * 0.13f, W * 0.46f, H * 0.68f, H * 0.03f, RgbaColor{30u, 38u, 44u, 255u});
        // Chassis silhouette in centre of 4-wheel diagram.
        Canvas.FillRoundedCard(W * 0.21f, H * 0.25f, W * 0.10f, H * 0.42f, H * 0.03f, RgbaColor{52u, 64u, 74u, 255u});

        const float WheelPosX[4] = {W * 0.09f, W * 0.34f, W * 0.09f, W * 0.34f};
        const float WheelPosY[4] = {H * 0.22f, H * 0.22f, H * 0.52f, H * 0.52f};

        for (size_t K = 0u; K < 4u; ++K)
        {
            const auto&      Wh  = Telemetry.Wheels[K];
            const RgbaColor  Thm = ThermalHeatmapRgba(Wh.TreadTemperatureKelvin);
            Canvas.FillRoundedCard(WheelPosX[K], WheelPosY[K], W * 0.09f, H * 0.20f, H * 0.02f, Thm);

            // Standing water blue bar / Mud amber bar / Snow white bar next to each tyre!
            if (Wh.StandingWaterMm > 0.2f)
            {
                const float HBar = H * 0.18f * std::clamp(Wh.StandingWaterMm / 8.0f, 0.08f, 1.0f);
                Canvas.FillRoundedCard(
                    WheelPosX[K] - W * 0.022f,
                    WheelPosY[K] + H * 0.19f - HBar,
                    W * 0.014f,
                    HBar,
                    2.0f,
                    RgbaColor{76u, 184u, 255u, 255u});
            }
            if (Wh.SnowSinkageMetres > 0.005f)
            {
                const float SBar = H * 0.18f * std::clamp(Wh.SnowSinkageMetres / 0.25f, 0.08f, 1.0f);
                Canvas.FillRoundedCard(
                    WheelPosX[K] + W * 0.098f,
                    WheelPosY[K] + H * 0.19f - SBar,
                    W * 0.014f,
                    SBar,
                    2.0f,
                    RgbaColor{235u, 244u, 255u, 255u});
            }
        }

        // Right-top card: Friction Circle (G-G diagram) + Pedal bars!
        Canvas.FillRoundedCard(W * 0.51f, H * 0.13f, W * 0.46f, H * 0.33f, H * 0.03f, RgbaColor{30u, 38u, 44u, 255u});
        const float GCx = W * 0.64f;
        const float GCy = H * 0.295f;
        const float GR  = H * 0.12f;
        Canvas.FillRadialArc(GCx, GCy, GR * 0.90f, GR, 0.0f, 1.0f, 2.0f * PiHmi, RgbaColor{58u, 70u, 82u, 255u}, RgbaColor{78u, 96u, 110u, 255u});
        const float DotX = GCx + std::clamp(Telemetry.LateralG / 1.5f, -1.0f, 1.0f) * (GR * 0.8f);
        const float DotY = GCy - std::clamp(Telemetry.LongitudinalG / 1.5f, -1.0f, 1.0f) * (GR * 0.8f);
        Canvas.FillRoundedCard(DotX - 5.0f, DotY - 5.0f, 10.0f, 10.0f, 5.0f, RgbaColor{255u, 198u, 82u, 255u});

        // Throttle (green) & Brake (red) vertical telemetry bars!
        Canvas.FillRoundedCard(W * 0.80f, H * 0.18f, W * 0.04f, H * 0.23f, 3.0f, RgbaColor{44u, 54u, 62u, 255u});
        const float ThrotH = H * 0.23f * std::clamp(Telemetry.ThrottlePedal01, 0.0f, 1.0f);
        Canvas.FillRoundedCard(W * 0.80f, H * 0.41f - ThrotH, W * 0.04f, ThrotH, 3.0f, RgbaColor{86u, 232u, 142u, 255u});

        Canvas.FillRoundedCard(W * 0.87f, H * 0.18f, W * 0.04f, H * 0.23f, 3.0f, RgbaColor{44u, 54u, 62u, 255u});
        const float BrakeH = H * 0.23f * std::clamp(Telemetry.BrakePedal01, 0.0f, 1.0f);
        Canvas.FillRoundedCard(W * 0.87f, H * 0.41f - BrakeH, W * 0.04f, BrakeH, 3.0f, RgbaColor{250u, 76u, 78u, 255u});

        // Right-bottom card: Coupled Weather, Puddle, Snowpack & Lightning Radar!
        Canvas.FillRoundedCard(W * 0.51f, H * 0.48f, W * 0.46f, H * 0.33f, H * 0.03f, RgbaColor{30u, 38u, 44u, 255u});
        const float RainW = W * 0.38f * std::clamp(Telemetry.RainIntensity01, 0.04f, 1.0f);
        Canvas.FillRoundedCard(W * 0.55f, H * 0.55f, RainW, H * 0.05f, 3.0f, RgbaColor{88u, 184u, 252u, 255u});
        const float SnowW = W * 0.38f * std::clamp(Telemetry.GroundSnowPeakCm / 45.0f, 0.04f, 1.0f);
        Canvas.FillRoundedCard(W * 0.55f, H * 0.64f, SnowW, H * 0.05f, 3.0f, RgbaColor{232u, 242u, 255u, 255u});
        if (Telemetry.LightningProximityWarn)
        {
            Canvas.FillRoundedCard(W * 0.55f, H * 0.72f, W * 0.38f, H * 0.05f, 3.0f, RgbaColor{188u, 168u, 255u, 255u});
        }
    }

    // Bottom Quick-Launch Dock (6 favourite cabin apps)!
    Canvas.FillRoundedCard(W * 0.14f, H * 0.84f, W * 0.72f, H * 0.13f, H * 0.035f, RgbaColor{32u, 41u, 48u, 255u});
    const uint32_t DockSlots[6] = {0u, 4u, 6u, 7u, 8u, 11u};
    for (uint32_t D = 0u; D < 6u; ++D)
    {
        const auto& App = Apps[DockSlots[D]];
        const float Dx  = W * 0.18f + static_cast<float>(D) * (W * 0.11f);
        Canvas.FillRoundedCard(
            Dx,
            H * 0.865f,
            W * 0.075f,
            H * 0.08f,
            H * 0.02f,
            RgbaColor{
                static_cast<uint8_t>(App.AccentSrgb.X * 255.0f),
                static_cast<uint8_t>(App.AccentSrgb.Y * 255.0f),
                static_cast<uint8_t>(App.AccentSrgb.Z * 255.0f),
                255u});
    }
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                          WINDSHIELD / EXTERIOR HUD SYNTHESIS (RGBA8)
------------------------------------------------------------------------------------------------------------------------------------------*/
void VehicleCabinHmiExtension::SynthesizeWindshieldHudRgba8(
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

    // Translucent collimated phosphor-cyan HUD reticle & speed/gear projection!
    Canvas.FillRoundedCard(W * 0.34f, H * 0.68f, W * 0.32f, H * 0.22f, H * 0.04f, RgbaColor{12u, 28u, 36u, 148u});
    const float SpeedKmh = std::max(0.0f, Telemetry.VehicleSpeedMps * 3.6f);
    Canvas.StampUnsignedNumber(
        static_cast<uint32_t>(std::round(SpeedKmh)),
        3u,
        W * 0.52f,
        H * 0.73f,
        W * 0.042f,
        H * 0.12f,
        RgbaColor{118u, 248u, 232u, 240u});

    const char GearGlyph = (Telemetry.EngagedGear < 0)
                               ? 'R'
                               : ((Telemetry.EngagedGear == 0) ? 'N' : static_cast<char>('0' + std::min(9, Telemetry.EngagedGear)));
    Canvas.StampSevenSegmentGlyph(
        GearGlyph,
        W * 0.56f,
        H * 0.73f,
        W * 0.045f,
        H * 0.12f,
        std::max(2.5f, W * 0.008f),
        RgbaColor{255u, 224u, 118u, 240u});
}

} // namespace Frontier
