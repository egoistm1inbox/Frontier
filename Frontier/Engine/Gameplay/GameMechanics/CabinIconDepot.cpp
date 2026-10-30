/*==========================================================================================================================================
                                                      CABINICONDEPOT.CPP
==========================================================================================================================================*/
// 🧩 12 multicolour vector SVG infotainment icons ported from Experimental/VehicleHmiPrototype/Source/Cabin/IconDepot.js.

#include "Engine/Gameplay/GameMechanics/CabinIconDepot.h"

#include <algorithm>
#include <cmath>

namespace Frontier
{
namespace
{
struct RgbCol
{
    float R = 0.0f;
    float G = 0.0f;
    float B = 0.0f;
};

struct IconGradientTheme
{
    RgbCol TopLeft{};
    RgbCol BottomRight{};
    RgbCol Accent{};
};

[[nodiscard]] IconGradientTheme ResolveIconTheme(CabinApplicationSlot Slot) noexcept
{
    // Exact multicolour palettes from Experimental/VehicleHmiPrototype/Source/Cabin/IconDepot.js!
    switch (Slot)
    {
        case CabinApplicationSlot::Navigation:       return {{0.10f, 0.72f, 0.98f}, {0.08f, 0.34f, 0.88f}, {0.65f, 0.96f, 1.00f}};
        case CabinApplicationSlot::MediaPlayer:      return {{0.98f, 0.24f, 0.52f}, {0.58f, 0.14f, 0.86f}, {1.00f, 0.78f, 0.90f}};
        case CabinApplicationSlot::ClimateHvac:      return {{0.12f, 0.86f, 0.74f}, {0.06f, 0.48f, 0.72f}, {0.98f, 0.66f, 0.24f}};
        case CabinApplicationSlot::Contacts:         return {{0.18f, 0.88f, 0.42f}, {0.06f, 0.56f, 0.28f}, {0.85f, 1.00f, 0.90f}};
        case CabinApplicationSlot::Messages:         return {{0.24f, 0.62f, 1.00f}, {0.14f, 0.30f, 0.86f}, {0.82f, 0.94f, 1.00f}};
        case CabinApplicationSlot::DriveRoom:        return {{1.00f, 0.60f, 0.12f}, {0.88f, 0.20f, 0.16f}, {1.00f, 0.92f, 0.55f}};
        case CabinApplicationSlot::VehicleSetup:     return {{0.28f, 0.36f, 0.48f}, {0.12f, 0.16f, 0.24f}, {0.32f, 0.84f, 1.00f}};
        case CabinApplicationSlot::GarageBay:        return {{0.52f, 0.32f, 0.96f}, {0.20f, 0.14f, 0.58f}, {0.38f, 0.92f, 1.00f}};
        case CabinApplicationSlot::TyreMonitor:      return {{0.98f, 0.74f, 0.14f}, {0.84f, 0.36f, 0.08f}, {1.00f, 0.95f, 0.72f}};
        case CabinApplicationSlot::TelemetryLab:     return {{0.08f, 0.82f, 0.94f}, {0.10f, 0.24f, 0.54f}, {1.00f, 0.44f, 0.28f}};
        case CabinApplicationSlot::AccountCloud:     return {{0.34f, 0.56f, 0.98f}, {0.22f, 0.26f, 0.72f}, {0.86f, 0.92f, 1.00f}};
        case CabinApplicationSlot::CabinPreferences: return {{0.46f, 0.50f, 0.58f}, {0.20f, 0.23f, 0.29f}, {0.72f, 0.86f, 1.00f}};
    }
    return {{0.24f, 0.52f, 0.92f}, {0.12f, 0.24f, 0.62f}, {0.85f, 0.94f, 1.00f}};
}

[[nodiscard]] float SdRoundedBox(float Px, float Py, float HalfW, float HalfH, float Radius) noexcept
{
    const float Qx = std::abs(Px) - (HalfW - Radius);
    const float Qy = std::abs(Py) - (HalfH - Radius);
    const float Ox = std::max(Qx, 0.0f);
    const float Oy = std::max(Qy, 0.0f);
    return std::sqrt(Ox * Ox + Oy * Oy) + std::min(std::max(Qx, Qy), 0.0f) - Radius;
}

[[nodiscard]] float SdSegment(float Px, float Py, float Ax, float Ay, float Bx, float By) noexcept
{
    const float Pax = Px - Ax;
    const float Pay = Py - Ay;
    const float Bax = Bx - Ax;
    const float Bay = By - Ay;
    const float Den = Bax * Bax + Bay * Bay;
    const float H   = (Den > 1.0e-6f) ? std::clamp((Pax * Bax + Pay * Bay) / Den, 0.0f, 1.0f) : 0.0f;
    const float Dx  = Pax - Bax * H;
    const float Dy  = Pay - Bay * H;
    return std::sqrt(Dx * Dx + Dy * Dy);
}

[[nodiscard]] float SdCircle(float Px, float Py, float Cx, float Cy, float Radius) noexcept
{
    const float Dx = Px - Cx;
    const float Dy = Py - Cy;
    return std::sqrt(Dx * Dx + Dy * Dy) - Radius;
}

[[nodiscard]] float SdRing(float Px, float Py, float Cx, float Cy, float Radius, float HalfThick) noexcept
{
    return std::abs(SdCircle(Px, Py, Cx, Cy, Radius)) - HalfThick;
}

// Evaluates normalized glyph SDF in [-1, +1]^2 icon local coordinates; returns primary white mask & secondary colour accent mask.
void EvaluateVectorGlyphMasks(
    CabinApplicationSlot Slot,
    float                Ux,
    float                Uy,
    float&               OutPrimaryAlpha,
    float&               OutAccentAlpha) noexcept
{
    float DPrimary = 10.0f;
    float DAccent  = 10.0f;

    switch (Slot)
    {
        case CabinApplicationSlot::Navigation:
        {
            // Compass navigation dart + route ring (IconDepot.js navigation SVG)
            DAccent  = SdRing(Ux, Uy, 0.0f, 0.0f, 0.56f, 0.045f);
            const float L1 = SdSegment(Ux, Uy,  0.00f, -0.44f,  0.30f,  0.34f) - 0.065f;
            const float L2 = SdSegment(Ux, Uy,  0.00f, -0.44f, -0.30f,  0.34f) - 0.065f;
            const float L3 = SdSegment(Ux, Uy, -0.26f,  0.28f,  0.00f,  0.12f) - 0.060f;
            const float L4 = SdSegment(Ux, Uy,  0.26f,  0.28f,  0.00f,  0.12f) - 0.060f;
            DPrimary = std::min({L1, L2, L3, L4});
            break;
        }
        case CabinApplicationSlot::MediaPlayer:
        {
            // Double eighth-note musical beam + glowing vinyl wave
            const float HeadL = SdCircle(Ux, Uy, -0.24f, 0.26f, 0.14f);
            const float HeadR = SdCircle(Ux, Uy,  0.22f, 0.18f, 0.14f);
            const float StemL = SdSegment(Ux, Uy, -0.11f,  0.24f, -0.11f, -0.32f) - 0.055f;
            const float StemR = SdSegment(Ux, Uy,  0.35f,  0.16f,  0.35f, -0.40f) - 0.055f;
            const float Beam  = SdSegment(Ux, Uy, -0.11f, -0.32f,  0.35f, -0.40f) - 0.075f;
            DPrimary = std::min({HeadL, HeadR, StemL, StemR, Beam});
            DAccent  = SdRing(Ux, Uy, -0.24f, 0.26f, 0.26f, 0.030f);
            break;
        }
        case CabinApplicationSlot::ClimateHvac:
        {
            // 6-spoke crystal snowflake + warm sun airflow wave
            for (int K = 0; K < 3; ++K)
            {
                const float Ang = static_cast<float>(K) * 1.04719755f;
                const float Cx  = std::cos(Ang) * 0.44f;
                const float Cy  = std::sin(Ang) * 0.44f;
                DPrimary = std::min(DPrimary, SdSegment(Ux, Uy, -Cx, -Cy, Cx, Cy) - 0.052f);
            }
            DPrimary = std::min(DPrimary, SdRing(Ux, Uy, 0.0f, 0.0f, 0.18f, 0.042f));
            DAccent  = SdCircle(Ux, Uy, 0.34f, -0.34f, 0.14f);
            break;
        }
        case CabinApplicationSlot::Contacts:
        {
            // Avatar silhouette + signal arc
            const float Head = SdCircle(Ux, Uy, 0.0f, -0.20f, 0.18f);
            const float Body = (Uy > 0.04f) ? (SdRing(Ux, Uy, 0.0f, 0.46f, 0.40f, 0.085f)) : 10.0f;
            DPrimary = std::min(Head, Body);
            DAccent  = (Ux > 0.15f && Uy < 0.0f) ? SdRing(Ux, Uy, 0.12f, -0.12f, 0.42f, 0.038f) : 10.0f;
            break;
        }
        case CabinApplicationSlot::Messages:
        {
            // Rounded speech bubble + 3 typing dots
            const float Bubble = SdRoundedBox(Ux, Uy + 0.04f, 0.48f, 0.34f, 0.16f);
            const float Tail   = SdSegment(Ux, Uy, -0.22f, 0.26f, -0.36f, 0.44f) - 0.085f;
            DPrimary = std::min(Bubble, Tail);
            const float Dots = std::min({
                SdCircle(Ux, Uy, -0.22f, -0.04f, 0.058f),
                SdCircle(Ux, Uy,  0.00f, -0.04f, 0.058f),
                SdCircle(Ux, Uy,  0.22f, -0.04f, 0.058f)});
            DPrimary = std::max(DPrimary, -Dots);
            DAccent  = Dots;
            break;
        }
        case CabinApplicationSlot::DriveRoom:
        {
            // Motorsport tachometer arc + redline needle
            if (Uy < 0.26f)
            {
                DPrimary = SdRing(Ux, Uy, 0.0f, 0.08f, 0.48f, 0.062f);
            }
            DAccent  = std::min(SdSegment(Ux, Uy, 0.0f, 0.08f, 0.30f, -0.24f) - 0.058f, SdCircle(Ux, Uy, 0.0f, 0.08f, 0.10f));
            break;
        }
        case CabinApplicationSlot::VehicleSetup:
        {
            // Top-down sculpted vehicle silhouette + active chassis suspension nodes
            DPrimary = SdRoundedBox(Ux, Uy, 0.24f, 0.46f, 0.11f);
            const float CabinGlass = SdRoundedBox(Ux, Uy + 0.02f, 0.15f, 0.22f, 0.05f);
            DPrimary = std::max(DPrimary, -CabinGlass);
            DAccent  = std::min({
                SdCircle(Ux, Uy, -0.32f, -0.28f, 0.075f),
                SdCircle(Ux, Uy,  0.32f, -0.28f, 0.075f),
                SdCircle(Ux, Uy, -0.32f,  0.28f, 0.075f),
                SdCircle(Ux, Uy,  0.32f,  0.28f, 0.075f)});
            break;
        }
        case CabinApplicationSlot::GarageBay:
        {
            // 3D wireframe cube + studio car pedestal ring (Garage 3D ControlVehicle Studio icon!)
            const float Ring = SdRing(Ux, Uy * 1.65f - 0.36f, 0.0f, 0.0f, 0.46f, 0.048f);
            const float Roof = std::min(
                SdSegment(Ux, Uy, -0.36f, -0.06f, 0.0f, -0.38f) - 0.055f,
                SdSegment(Ux, Uy,  0.36f, -0.06f, 0.0f, -0.38f) - 0.055f);
            const float CarBody = SdRoundedBox(Ux, Uy - 0.06f, 0.32f, 0.13f, 0.06f);
            DPrimary = std::min(Roof, CarBody);
            DAccent  = Ring;
            break;
        }
        case CabinApplicationSlot::TyreMonitor:
        {
            // Radial tyre cross-section + tread grooves + pressure exclamation/core
            DPrimary = std::min(
                SdRing(Ux, Uy, 0.0f, 0.0f, 0.44f, 0.085f),
                SdRing(Ux, Uy, 0.0f, 0.0f, 0.20f, 0.045f));
            DAccent  = SdCircle(Ux, Uy, 0.0f, 0.0f, 0.09f);
            break;
        }
        case CabinApplicationSlot::TelemetryLab:
        {
            // Multi-channel telemetry waveform + peak marker
            const float S1 = SdSegment(Ux, Uy, -0.48f,  0.14f, -0.20f,  0.14f) - 0.052f;
            const float S2 = SdSegment(Ux, Uy, -0.20f,  0.14f, -0.04f, -0.36f) - 0.052f;
            const float S3 = SdSegment(Ux, Uy, -0.04f, -0.36f,  0.14f,  0.34f) - 0.052f;
            const float S4 = SdSegment(Ux, Uy,  0.14f,  0.34f,  0.28f, -0.06f) - 0.052f;
            const float S5 = SdSegment(Ux, Uy,  0.28f, -0.06f,  0.48f, -0.06f) - 0.052f;
            DPrimary = std::min({S1, S2, S3, S4, S5});
            DAccent  = SdCircle(Ux, Uy, -0.04f, -0.36f, 0.095f);
            break;
        }
        case CabinApplicationSlot::AccountCloud:
        {
            // Cloud sync contour
            const float C1 = SdCircle(Ux, Uy, -0.20f,  0.08f, 0.22f);
            const float C2 = SdCircle(Ux, Uy,  0.04f, -0.08f, 0.28f);
            const float C3 = SdCircle(Ux, Uy,  0.26f,  0.10f, 0.19f);
            const float Base = SdRoundedBox(Ux, Uy - 0.14f, 0.34f, 0.14f, 0.08f);
            DPrimary = std::min({C1, C2, C3, Base});
            DAccent  = SdSegment(Ux, Uy, 0.0f, -0.04f, 0.0f, 0.22f) - 0.048f;
            break;
        }
        case CabinApplicationSlot::CabinPreferences:
        {
            // Precision 6-tooth settings gear + cyan bearing ring
            float Gear = SdRing(Ux, Uy, 0.0f, 0.0f, 0.32f, 0.085f);
            for (int K = 0; K < 6; ++K)
            {
                const float Ang = static_cast<float>(K) * 1.04719755f;
                Gear = std::min(Gear, SdCircle(Ux, Uy, std::cos(Ang) * 0.42f, std::sin(Ang) * 0.42f, 0.085f));
            }
            DPrimary = Gear;
            DAccent  = SdCircle(Ux, Uy, 0.0f, 0.0f, 0.12f);
            break;
        }
    }

    OutPrimaryAlpha = std::clamp(0.5f - DPrimary * 18.0f, 0.0f, 1.0f);
    OutAccentAlpha  = std::clamp(0.5f - DAccent * 18.0f, 0.0f, 1.0f);
}

} // namespace

void DrawMulticolourSvgAppIcon(
    std::vector<uint8_t>& Rgba8Buffer,
    uint32_t              BufferWidth,
    uint32_t              BufferHeight,
    CabinApplicationSlot  Slot,
    float                 CentreX,
    float                 CentreY,
    float                 TileSizePx,
    bool                  Highlighted) noexcept
{
    if (TileSizePx < 6.0f || BufferWidth == 0u || BufferHeight == 0u)
    {
        return;
    }

    const IconGradientTheme Theme = ResolveIconTheme(Slot);
    const float Half   = 0.5f * TileSizePx;
    const float Radius = 0.24f * TileSizePx;
    const float Pad    = std::max(4.0f, 0.18f * TileSizePx);

    const int XMin = std::max(0, static_cast<int>(std::floor(CentreX - Half - Pad)));
    const int XMax = std::min(static_cast<int>(BufferWidth) - 1, static_cast<int>(std::ceil(CentreX + Half + Pad)));
    const int YMin = std::max(0, static_cast<int>(std::floor(CentreY - Half - Pad)));
    const int YMax = std::min(static_cast<int>(BufferHeight) - 1, static_cast<int>(std::ceil(CentreY + Half + Pad)));

    for (int Py = YMin; Py <= YMax; ++Py)
    {
        for (int Px = XMin; Px <= XMax; ++Px)
        {
            const float Dx = (static_cast<float>(Px) + 0.5f) - CentreX;
            const float Dy = (static_cast<float>(Py) + 0.5f) - CentreY;

            // Soft drop shadow (and cyan selection halo when Highlighted)
            const float ShadowDist  = SdRoundedBox(Dx, Dy - 0.06f * TileSizePx, Half, Half, Radius);
            const float ShadowAlpha = 0.42f * std::exp(-std::max(0.0f, ShadowDist) * (3.5f / std::max(4.0f, 0.15f * TileSizePx))) *
                                      (ShadowDist > -1.0f ? 1.0f : 0.0f);

            const float TileDist  = SdRoundedBox(Dx, Dy, Half, Half, Radius);
            const float TileAlpha = std::clamp(0.5f - TileDist, 0.0f, 1.0f);

            const size_t Off = (static_cast<size_t>(Py) * BufferWidth + static_cast<size_t>(Px)) * 4u;
            float DstR = static_cast<float>(Rgba8Buffer[Off + 0u]) * (1.0f / 255.0f);
            float DstG = static_cast<float>(Rgba8Buffer[Off + 1u]) * (1.0f / 255.0f);
            float DstB = static_cast<float>(Rgba8Buffer[Off + 2u]) * (1.0f / 255.0f);

            if (ShadowAlpha > 1.0e-3f && TileAlpha < 0.99f)
            {
                DstR *= (1.0f - ShadowAlpha);
                DstG *= (1.0f - ShadowAlpha);
                DstB *= (1.0f - ShadowAlpha);
            }

            if (Highlighted && TileDist > -1.5f && TileDist < 3.2f)
            {
                const float RingA = std::clamp(1.0f - std::abs(TileDist - 1.2f) * 0.75f, 0.0f, 1.0f);
                DstR = DstR + (Theme.Accent.R - DstR) * RingA;
                DstG = DstG + (Theme.Accent.G - DstG) * RingA;
                DstB = DstB + (Theme.Accent.B - DstB) * RingA;
            }

            if (TileAlpha > 1.0e-3f)
            {
                const float GradT = std::clamp(0.5f + 0.38f * (Dx + Dy) / std::max(1.0f, Half), 0.0f, 1.0f);
                float IconR = Theme.TopLeft.R + (Theme.BottomRight.R - Theme.TopLeft.R) * GradT;
                float IconG = Theme.TopLeft.G + (Theme.BottomRight.G - Theme.TopLeft.G) * GradT;
                float IconB = Theme.TopLeft.B + (Theme.BottomRight.B - Theme.TopLeft.B) * GradT;

                // Top glass specular sheen + thin 1 px inner rim
                const float Sheen = std::max(0.0f, -Dy / std::max(1.0f, Half)) * 0.16f;
                const float Rim   = std::clamp(1.0f - std::abs(TileDist + 1.0f), 0.0f, 1.0f) * 0.26f;
                IconR = std::min(1.0f, IconR + Sheen + Rim);
                IconG = std::min(1.0f, IconG + Sheen + Rim);
                IconB = std::min(1.0f, IconB + Sheen + Rim);

                // Vector SVG glyph paths in normalized [-1, +1]^2
                const float Ux = Dx / (Half * 0.78f);
                const float Uy = Dy / (Half * 0.78f);
                if (std::abs(Ux) <= 1.2f && std::abs(Uy) <= 1.2f)
                {
                    float PrimA = 0.0f;
                    float AccA  = 0.0f;
                    EvaluateVectorGlyphMasks(Slot, Ux, Uy, PrimA, AccA);
                    if (AccA > 1.0e-3f)
                    {
                        IconR = IconR + (Theme.Accent.R - IconR) * AccA;
                        IconG = IconG + (Theme.Accent.G - IconG) * AccA;
                        IconB = IconB + (Theme.Accent.B - IconB) * AccA;
                    }
                    if (PrimA > 1.0e-3f)
                    {
                        IconR = IconR + (0.99f - IconR) * PrimA;
                        IconG = IconG + (0.99f - IconG) * PrimA;
                        IconB = IconB + (1.00f - IconB) * PrimA;
                    }
                }

                DstR = DstR + (IconR - DstR) * TileAlpha;
                DstG = DstG + (IconG - DstG) * TileAlpha;
                DstB = DstB + (IconB - DstB) * TileAlpha;
            }

            Rgba8Buffer[Off + 0u] = static_cast<uint8_t>(std::clamp(DstR * 255.0f + 0.5f, 0.0f, 255.0f));
            Rgba8Buffer[Off + 1u] = static_cast<uint8_t>(std::clamp(DstG * 255.0f + 0.5f, 0.0f, 255.0f));
            Rgba8Buffer[Off + 2u] = static_cast<uint8_t>(std::clamp(DstB * 255.0f + 0.5f, 0.0f, 255.0f));
            Rgba8Buffer[Off + 3u] = 255u;
        }
    }
}

} // namespace Frontier
