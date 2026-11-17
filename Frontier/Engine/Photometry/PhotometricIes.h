/*==========================================================================================================================================
                                                            PHOTOMETRICIES.H
==========================================================================================================================================*/
// 📝 Bounded LM-63 Type-C photometric profile reader shared by the Photometric workspace and lighting tools.

#pragma once

#include <array>
#include <cstdint>
#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace Frontier
{

inline constexpr uint32_t PhotometricIesAzimuthSamples = 16;
inline constexpr uint32_t PhotometricIesPolarSamples = 32;
inline constexpr uint64_t PhotometricIesMaximumFileBytes = 4ull * 1024ull * 1024ull;

struct PhotometricIesProfile
{
    std::string Name;
    std::string SourcePath; // UTF-8 path; empty for an in-memory parse.
    uint32_t NumberOfLamps = 0;
    double LumensPerLamp = 0.0; // LM-63 may use -1 for absolute photometry.
    double CandelaMultiplier = 1.0;
    uint32_t PhotometricType = 1; // LM-63 value 1 is Type C.
    uint32_t UnitsType = 2;       // LM-63 value 1 is feet; 2 is metres.
    double InputWatts = 0.0;
    double PeakCandela = 0.0;

    // Full candela grid in LM-63 order: horizontal/C-plane major, vertical/polar minor.
    std::vector<float> VerticalAnglesDeg;
    std::vector<float> HorizontalAnglesDeg;
    std::vector<float> Candela;

    // Peak-normalized periodic atlas for stable inspector and renderer sampling.
    std::array<float, PhotometricIesAzimuthSamples * PhotometricIesPolarSamples> NormalizedDistribution{};
};

// Accepts Type-C photometry only and requires TILT=NONE. On failure, leaves Profile unchanged and explains why in Error.
[[nodiscard]] bool ParsePhotometricIes(std::string_view Text, const std::string& Name, PhotometricIesProfile& Profile,
                                       std::string& Error);

// Reads a bounded file, derives its display name from the stem, and records its UTF-8 source path.
[[nodiscard]] bool LoadPhotometricIesFile(const std::filesystem::path& Path, PhotometricIesProfile& Profile,
                                          std::string& Error);

// Bilinear sample of the normalized 16 × 32 periodic atlas; angles are degrees.
[[nodiscard]] float SamplePhotometricIes(const PhotometricIesProfile& Profile, double AzimuthDeg,
                                         double PolarDeg) noexcept;

} // namespace Frontier
