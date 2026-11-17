/*============================================================================================================================================
                                                      STARFIELDROTATIONPROOF.CPP
============================================================================================================================================*/
// Visual Proof & Rotational Invariance Validation for Fixed Astronomical Starfield Catalogue (Sirius, Canopus, Vega, Polaris)

#include "Engine/Codecs/ImageCodec.h"
#include "Engine/GeometricRaster/Atmosphere/AstronomicalStarfieldCatalogue.h"
#include "Engine/GeometricRaster/Atmosphere/LunarStarfieldSequence.h"
#include "Exhibits/SoftwareCanvasRasterizer.h"

#include <cmath>
#include <cstdio>
#include <filesystem>
#include <vector>

using namespace Frontier;
using namespace Frontier::GeometricRaster;

int main()
{
    const uint32_t Width  = 400u;
    const uint32_t Height = 300u;

    const auto& Stars = AstronomicalCatalogueTable::QueryStars();
    std::printf("[StarfieldProof] Catalogue contains %zu fixed prominent stars.\n", Stars.size());

    // Render 3 camera yaw rotations: 0 deg, 45 deg, 90 deg
    const float Yaws[3] = { 0.0f, 45.0f, 90.0f };
    std::vector<std::vector<uint8_t>> Frames(3);

    StarfieldConfiguration StarCfg {};
    StarCfg.StarfieldEnabled     = true;
    StarCfg.ScintillationEnabled = false; // Steady for exact verification
    StarCfg.LimitingMagnitude    = 6.0f;
    StarCfg.BrightnessMultiplier = 2.2f;
    StarCfg.PointSizeScale       = 1.5f;

    std::array<LunarBodyConfiguration, 4u> NoMoons {};
    for (auto& M : NoMoons) M.Visible = false;

    Mathematics::Axis3D SunDir = { 0.0f, 0.0f, -1.0f }; // True midnight

    for (int FrameIdx = 0; FrameIdx < 3; ++FrameIdx)
    {
        Frames[FrameIdx].assign(Width * Height * 4u, 255u);
        const float YawDeg = Yaws[FrameIdx];
        const float YawRad = YawDeg * 3.14159265359f / 180.0f;
        const float CosY   = std::cos(YawRad);
        const float SinY   = std::sin(YawRad);

        // Forward vector in world
        const Mathematics::Axis3D Fwd = { CosY, SinY, 0.35f };
        const Mathematics::Axis3D Up  = { 0.0f, 0.0f, 1.0f };
        const Mathematics::Axis3D Rgt = { -SinY, CosY, 0.0f };

        uint32_t LitPixelCount = 0u;
        for (uint32_t Y = 0u; Y < Height; ++Y)
        {
            for (uint32_t X = 0u; X < Width; ++X)
            {
                const float NdcX = (static_cast<float>(X) + 0.5f) / static_cast<float>(Width) * 2.0f - 1.0f;
                const float NdcY = 1.0f - (static_cast<float>(Y) + 0.5f) / static_cast<float>(Height) * 2.0f;

                Mathematics::Axis3D Ray = {
                    Fwd.X + Rgt.X * NdcX * 0.8f + Up.X * NdcY * 0.6f,
                    Fwd.Y + Rgt.Y * NdcX * 0.8f + Up.Y * NdcY * 0.6f,
                    Fwd.Z + Rgt.Z * NdcX * 0.8f + Up.Z * NdcY * 0.6f,
                };
                const float Len = std::sqrt(Ray.X * Ray.X + Ray.Y * Ray.Y + Ray.Z * Ray.Z);
                Ray.X /= Len; Ray.Y /= Len; Ray.Z /= Len;

                const auto Col = LunarStarfieldSequence::EvaluateCelestialField(
                    Ray, SunDir, NoMoons, StarCfg, 0.0f);

                const std::size_t Px = (Y * Width + X) * 4u;
                const auto ToByte = [](float V) { return static_cast<uint8_t>(std::clamp(V * 255.0f, 0.0f, 255.0f)); };
                Frames[FrameIdx][Px + 0] = ToByte(Col.R);
                Frames[FrameIdx][Px + 1] = ToByte(Col.G);
                Frames[FrameIdx][Px + 2] = ToByte(Col.B);
                Frames[FrameIdx][Px + 3] = 255u;

                if (Col.R + Col.G + Col.B > 0.05f)
                {
                    ++LitPixelCount;
                }
            }
        }
        std::printf("[StarfieldProof] Yaw %.1f deg: %u lit star pixels rendered.\n", YawDeg, LitPixelCount);
    }

    // Combine into 3-pane side-by-side composite
    const uint32_t CompW = Width * 3u;
    const uint32_t CompH = Height;
    std::vector<uint8_t> Comp(CompW * CompH * 4u, 255u);

    for (uint32_t Y = 0u; Y < Height; ++Y)
    {
        for (int F = 0; F < 3; ++F)
        {
            for (uint32_t X = 0u; X < Width; ++X)
            {
                const std::size_t Src = (Y * Width + X) * 4u;
                const std::size_t Dst = (Y * CompW + (F * Width + X)) * 4u;
                Comp[Dst + 0] = Frames[F][Src + 0];
                Comp[Dst + 1] = Frames[F][Src + 1];
                Comp[Dst + 2] = Frames[F][Src + 2];
                Comp[Dst + 3] = 255u;
            }
        }
    }

    const std::filesystem::path OutPath = "Exhibits/Images/Atmosphere/01-FixedAstronomicalStarfieldCatalogue.png";
    Exhibits::SoftwareRasterCanvas Canvas(CompW, CompH, { 0u, 0u, 0u, 255u });
    Canvas.BlitRgbaRegion(0u, 0u, CompW, CompH, Comp.data());
    Canvas.WritePngFile(OutPath);
    std::printf("[StarfieldProof] Generated visual proof: %s\n", OutPath.c_str());
    return 0;
}
