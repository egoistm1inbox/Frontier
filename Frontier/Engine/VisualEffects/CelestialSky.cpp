/*==========================================================================================================================================
                                              CELESTIALPLANETARYEXTENSION.CPP
==========================================================================================================================================*/
// 🧩 Implementation of the 41k Hipparcos octahedral star catalogue, Milky Way band, custom stars, textured Moon + 6-body
//    lunar presets, and 3D ringed planets with simulated spherical Rayleigh/Mie/Ozone atmospheres & mutual shadows.

#include "Engine/VisualEffects/CelestialSky.h"

#include <algorithm>
#include <cmath>
#include <fstream>

namespace Frontier
{
namespace
{
constexpr float PiF = 3.14159265358979323846f;

float SmoothStepF(float Edge0, float Edge1, float X) noexcept
{
    const float Denom = ( std::abs(Edge1 - Edge0) > 1.0e-7f ) ? (Edge1 - Edge0) : 1.0e-7f;
    const float T     = std::clamp((X - Edge0) / Denom, 0.0f, 1.0f);
    return T * T * (3.0f - 2.0f * T);
}

Vec3 LerpVec3(Vec3 A, Vec3 B, float T) noexcept
{
    return A * (1.0f - T) + B * T;
}

Vec3 CompMul(Vec3 A, Vec3 B) noexcept
{
    return {A.X * B.X, A.Y * B.Y, A.Z * B.Z};
}

Vec3 ExpNeg(Vec3 OpticalDepth) noexcept
{
    return {std::exp(-OpticalDepth.X), std::exp(-OpticalDepth.Y), std::exp(-OpticalDepth.Z)};
}

// Ray from origin O=(0,0,0) (or arbitrary Ro) along unit Dir against sphere at Centre with radius R.
bool IntersectRaySphere(Vec3 Ro, Vec3 Dir, Vec3 Centre, float Radius, float& OutT0, float& OutT1) noexcept
{
    const Vec3  Oc   = Ro - Centre;
    const float B    = Dot(Oc, Dir);
    const float C    = Dot(Oc, Oc) - Radius * Radius;
    const float Disc = B * B - C;
    if (Disc < 0.0f)
    {
        return false;
    }
    const float Sq = std::sqrt(Disc);
    OutT0          = -B - Sq;
    OutT1          = -B + Sq;
    return OutT1 > 0.0f;
}

float Hash31(Vec3 P) noexcept
{
    const float S = std::sin(P.X * 127.1f + P.Y * 311.7f + P.Z * 74.7f) * 43758.5453f;
    return S - std::floor(S);
}

float LatticeNoise3D(Vec3 P) noexcept
{
    const Vec3 Fl{std::floor(P.X), std::floor(P.Y), std::floor(P.Z)};
    const Vec3 Fr{P.X - Fl.X, P.Y - Fl.Y, P.Z - Fl.Z};
    const Vec3 U{Fr.X * Fr.X * (3.0f - 2.0f * Fr.X), Fr.Y * Fr.Y * (3.0f - 2.0f * Fr.Y), Fr.Z * Fr.Z * (3.0f - 2.0f * Fr.Z)};

    auto Corner = [&](float Dx, float Dy, float Dz) { return Hash31({Fl.X + Dx, Fl.Y + Dy, Fl.Z + Dz}); };
    const float N00 = Corner(0, 0, 0) * (1.0f - U.X) + Corner(1, 0, 0) * U.X;
    const float N10 = Corner(0, 1, 0) * (1.0f - U.X) + Corner(1, 1, 0) * U.X;
    const float N01 = Corner(0, 0, 1) * (1.0f - U.X) + Corner(1, 0, 1) * U.X;
    const float N11 = Corner(0, 1, 1) * (1.0f - U.X) + Corner(1, 1, 1) * U.X;
    const float Ny0 = N00 * (1.0f - U.Y) + N10 * U.Y;
    const float Ny1 = N01 * (1.0f - U.Y) + N11 * U.Y;
    return Ny0 * (1.0f - U.Z) + Ny1 * U.Z;
}

float Fbm3D(Vec3 P) noexcept
{
    float Sum = 0.0f;
    float Amp = 0.5f;
    for (int Oct = 0; Oct < 4; ++Oct)
    {
        Sum += Amp * LatticeNoise3D(P);
        P    = P * 2.07f;
        Amp *= 0.5f;
    }
    return Sum;
}

// Multi-zone Saturn/exoplanet radial ring structure: C-ring, B-ring, Cassini Division, A-ring, Encke Gap, F-ring!
void SampleRingRadialProfile(
    const PlanetaryRingDescriptor& Rings,
    float                          RadiusInPlanetUnits,
    float&                         OutNormalTau,
    Vec3&                          OutRingAlbedo) noexcept
{
    if (!Rings.Enabled || RadiusInPlanetUnits < Rings.InnerRadiusRatio || RadiusInPlanetUnits > Rings.OuterRadiusRatio)
    {
        OutNormalTau  = 0.0f;
        OutRingAlbedo = {0.0f, 0.0f, 0.0f};
        return;
    }

    const float Span = std::max(0.05f, Rings.OuterRadiusRatio - Rings.InnerRadiusRatio);
    const float U    = std::clamp((RadiusInPlanetUnits - Rings.InnerRadiusRatio) / Span, 0.0f, 1.0f);

    // Fine concentric density-wave ringlets
    const float Ringlets = 0.84f + 0.16f * std::sin(U * 145.0f) * std::cos(U * 63.0f + 0.7f);

    float Profile = 0.0f;
    float IceFrac = U;
    if (U < 0.22f)
    {
        // Translucent dusky inner C-ring
        Profile = 0.24f * SmoothStepF(0.0f, 0.06f, U) * (0.75f + 0.25f * std::sin(U * 90.0f));
        IceFrac = 0.18f;
    }
    else if (U < 0.58f)
    {
        // Dense bright B-ring
        Profile = (0.78f + 0.22f * std::sin((U - 0.22f) * 38.0f)) * SmoothStepF(0.20f, 0.25f, U);
        IceFrac = 0.85f;
    }
    else if (U < 0.65f)
    {
        // Sharp dark Cassini Division!
        const float GapBell = std::exp(-std::pow((U - 0.615f) / 0.022f, 4.0f));
        Profile             = 0.62f * (1.0f - 0.94f * GapBell);
        IceFrac             = 0.35f;
    }
    else if (U < 0.94f)
    {
        // Outer A-ring with sharp Encke Gap at U ~ 0.855
        const float Encke = std::exp(-std::pow((U - 0.855f) / 0.009f, 4.0f));
        Profile           = 0.56f * (1.0f - 0.92f * Encke) * (1.0f - 0.18f * (U - 0.65f) / 0.29f);
        IceFrac           = 0.92f;
    }
    else
    {
        // Narrow outer F-ring filament after Roche gap
        const float Filament = std::exp(-std::pow((U - 0.975f) / 0.008f, 2.0f));
        Profile              = 0.38f * Filament;
        IceFrac              = 0.95f;
    }

    OutNormalTau  = std::max(0.0f, Rings.PeakOpticalDepth * Profile * Ringlets);
    OutRingAlbedo = LerpVec3(Rings.InnerTintRgb, Rings.OuterTintRgb, IceFrac) * (0.88f + 0.12f * Ringlets);
}

// Evaluates solar transmittance through the ring plane for a point P on the planet/atmosphere!
float EvaluateRingShadowTransmittance(
    const PlanetaryRingDescriptor& Rings,
    Vec3                           PlanetCentre,
    Vec3                           PointInPlanetSpace,
    Vec3                           SunDirUnit,
    bool&                          OutShadowedByRings) noexcept
{
    OutShadowedByRings = false;
    if (!Rings.Enabled)
    {
        return 1.0f;
    }
    const float Denom = Dot(SunDirUnit, Rings.RingNormalUnit);
    if (std::abs(Denom) < 1.0e-5f)
    {
        return 1.0f;
    }
    const float TPlane = Dot(PlanetCentre - PointInPlanetSpace, Rings.RingNormalUnit) / Denom;
    if (TPlane <= 0.0f)
    {
        return 1.0f;
    }
    const Vec3  RingHit = PointInPlanetSpace + SunDirUnit * TPlane;
    const float Rad     = Length(RingHit - PlanetCentre);
    float       TauN    = 0.0f;
    Vec3        DummyAlb{};
    SampleRingRadialProfile(Rings, Rad, TauN, DummyAlb);
    if (TauN <= 1.0e-4f)
    {
        return 1.0f;
    }
    const float SlantTau = TauN / std::max(0.12f, std::abs(Denom));
    const float Trans    = std::exp(-SlantTau);
    if (Trans < 0.85f)
    {
        OutShadowedByRings = true;
    }
    return Trans;
}

} // namespace

/*------------------------------------------------------------------------------------------------------------------------------------------
                                        KELVIN BLACKBODY & OCTAHEDRAL CELL MAPPING
------------------------------------------------------------------------------------------------------------------------------------------*/
Vec3 CelestialSky::KelvinToBlackbodyChromaticity(float Kelvin) noexcept
{
    const float TempHecto = std::clamp(Kelvin, 1200.0f, 40000.0f) * 0.01f;
    float       R         = 1.0f;
    float       G         = 1.0f;
    float       B         = 1.0f;

    if (TempHecto <= 66.0f)
    {
        R = 1.0f;
        G = std::clamp(0.39008158f * std::log(std::max(1.0f, TempHecto)) - 0.63184144f, 0.0f, 1.0f);
        B = (TempHecto <= 19.0f)
            ? 0.0f
            : std::clamp(0.54320679f * std::log(std::max(1.0f, TempHecto - 10.0f)) - 1.19625409f, 0.0f, 1.0f);
    }
    else
    {
        R = std::clamp(1.29293618f * std::pow(TempHecto - 60.0f, -0.13320476f), 0.0f, 1.0f);
        G = std::clamp(1.12989086f * std::pow(TempHecto - 60.0f, -0.07551485f), 0.0f, 1.0f);
        B = 1.0f;
    }
    // Convert approximate sRGB chromaticity to linear chromaticity normalized to max component = 1
    Vec3 Lin{std::pow(R, 2.2f), std::pow(G, 2.2f), std::pow(B, 2.2f)};
    const float Peak = std::max({Lin.X, Lin.Y, Lin.Z, 1.0e-4f});
    return Lin * (1.0f / Peak);
}

uint32_t CelestialSky::OctahedralCellForDirection(Vec3 D) noexcept
{
    const float L1 = std::abs(D.X) + std::abs(D.Y) + std::abs(D.Z);
    if (L1 < 1.0e-8f)
    {
        return 0u;
    }
    float Px = D.X / L1;
    float Py = D.Y / L1;
    if (D.Z < 0.0f)
    {
        const float Ox = (1.0f - std::abs(Py)) * (Px >= 0.0f ? 1.0f : -1.0f);
        const float Oy = (1.0f - std::abs(Px)) * (Py >= 0.0f ? 1.0f : -1.0f);
        Px             = Ox;
        Py             = Oy;
    }
    const float    U   = std::clamp(Px * 0.5f + 0.5f, 0.0f, 0.999999f);
    const float    V   = std::clamp(Py * 0.5f + 0.5f, 0.0f, 0.999999f);
    const uint32_t Col = std::min(OctahedralGridAxis - 1u, static_cast<uint32_t>(U * OctahedralGridAxis));
    const uint32_t Row = std::min(OctahedralGridAxis - 1u, static_cast<uint32_t>(V * OctahedralGridAxis));
    return Row * OctahedralGridAxis + Col;
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                             LIFECYCLE & STAR CATALOGUE INDEX
------------------------------------------------------------------------------------------------------------------------------------------*/
CelestialSky::CelestialSky()
{
    BuildProceduralStarCatalogue(8000u, 0x51A7CA7A109FULL);
}

void CelestialSky::ClearBodies() noexcept
{
    CustomStars_.clear();
    Moons_.clear();
    Planets_.clear();
}

void CelestialSky::RebuildOctahedralStarIndex(const std::vector<StarRecord>& Records)
{
    BinnedStars_.clear();
    for (auto& Cell : StarCells_)
    {
        Cell = CellSpan{};
    }
    SourceStarCount_ = static_cast<uint32_t>(Records.size());
    if (Records.empty())
    {
        return;
    }

    constexpr float StarGlowRadiusRad = 0.0038f;
    std::vector<std::vector<BinnedCatalogueStar>> Buckets(OctahedralCellCount);

    for (const auto& Sr : Records)
    {
        const Vec3 Dir = Normalise(Vec3{
            static_cast<float>(Sr.Direction.X),
            static_cast<float>(Sr.Direction.Y),
            static_cast<float>(Sr.Direction.Z)});

        // Ballesteros (2012) B-V colour index -> stellar effective temperature [K]
        const float Bv     = std::clamp(static_cast<float>(Sr.ColourIndex), -0.45f, 2.10f);
        const float TempK  = 4600.0f * (1.0f / (0.92f * Bv + 1.70f) + 1.0f / (0.92f * Bv + 0.62f));
        const Vec3  Chroma = KelvinToBlackbodyChromaticity(TempK);
        const float Mag    = static_cast<float>(Sr.Magnitude);
        const float Flux   = std::pow(10.0f, -0.4f * Mag);

        BinnedCatalogueStar Entry{Dir, Chroma, Flux, Mag};

        // Insert into primary cell + 4 orthogonal rim offsets so boundary stars never clip at cell edges!
        const Vec3 RefAxis = (std::abs(Dir.Z) < 0.92f) ? Vec3{0.0f, 0.0f, 1.0f} : Vec3{1.0f, 0.0f, 0.0f};
        const Vec3 TanU    = Normalise(Cross(Dir, RefAxis));
        const Vec3 TanV    = Cross(Dir, TanU);

        uint32_t Touched[5]{};
        uint32_t TouchedCount = 0u;
        auto AddUniqueCell = [&](uint32_t C)
        {
            for (uint32_t I = 0u; I < TouchedCount; ++I)
            {
                if (Touched[I] == C)
                {
                    return;
                }
            }
            if (TouchedCount < 5u)
            {
                Touched[TouchedCount++] = C;
            }
        };

        AddUniqueCell(OctahedralCellForDirection(Dir));
        AddUniqueCell(OctahedralCellForDirection(Normalise(Dir + TanU * StarGlowRadiusRad)));
        AddUniqueCell(OctahedralCellForDirection(Normalise(Dir - TanU * StarGlowRadiusRad)));
        AddUniqueCell(OctahedralCellForDirection(Normalise(Dir + TanV * StarGlowRadiusRad)));
        AddUniqueCell(OctahedralCellForDirection(Normalise(Dir - TanV * StarGlowRadiusRad)));

        for (uint32_t I = 0u; I < TouchedCount; ++I)
        {
            Buckets[Touched[I]].push_back(Entry);
        }
    }

    uint32_t Offset = 0u;
    for (uint32_t C = 0u; C < OctahedralCellCount; ++C)
    {
        // Sort brightest stars first in each cell for coherent evaluation
        auto& Vec = Buckets[C];
        std::sort(Vec.begin(), Vec.end(), [](const BinnedCatalogueStar& A, const BinnedCatalogueStar& B)
        {
            return A.RelativeFlux > B.RelativeFlux;
        });
        StarCells_[C].First = Offset;
        StarCells_[C].Count = static_cast<uint32_t>(Vec.size());
        Offset             += StarCells_[C].Count;
    }

    BinnedStars_.reserve(Offset);
    for (uint32_t C = 0u; C < OctahedralCellCount; ++C)
    {
        for (const auto& Entry : Buckets[C])
        {
            BinnedStars_.push_back(Entry);
        }
    }
}

bool CelestialSky::LoadHipparcosCatalogueCsv(
    const std::string& CsvPath,
    double             JulianUt1,
    double             LatitudeDeg,
    double             LongitudeDeg)
{
    std::ifstream Stream(CsvPath);
    if (!Stream.is_open())
    {
        return false;
    }
    const std::vector<StarRecord> Decoded = DecodeHipparcosCatalogue(Stream, JulianUt1, LatitudeDeg, LongitudeDeg);
    if (Decoded.empty())
    {
        return false;
    }
    RebuildOctahedralStarIndex(Decoded);
    return true;
}

void CelestialSky::BuildProceduralStarCatalogue(uint32_t StarCount, uint64_t Seed)
{
    const std::vector<StarRecord> Gen = GenerateStarCatalogue(StarCount, Seed);
    RebuildOctahedralStarIndex(Gen);
}

bool CelestialSky::LoadLunaAlbedoMapPpm(const std::string& PpmPath)
{
    return LunaAlbedoMap_.LoadPpm(PpmPath.c_str());
}

void CelestialSky::RegisterCustomStar(const CustomStarDescriptor& Star)
{
    CustomStarDescriptor Clean = Star;
    Clean.DirectionUnit        = Normalise(Star.DirectionUnit);
    CustomStars_.push_back(Clean);
}

void CelestialSky::RegisterLunarBody(const LunarBodyDescriptor& Moon)
{
    LunarBodyDescriptor Clean = Moon;
    Clean.DirectionUnit       = Normalise(Moon.DirectionUnit);
    Moons_.push_back(Clean);
}

void CelestialSky::RegisterPlanetaryBody(const PlanetaryBodyDescriptor& Planet)
{
    PlanetaryBodyDescriptor Clean = Planet;
    Clean.DirectionUnit           = Normalise(Planet.DirectionUnit);
    Clean.SpinAxisUnit            = Normalise(Planet.SpinAxisUnit);
    Clean.Rings.RingNormalUnit    = Normalise(Planet.Rings.RingNormalUnit);
    Planets_.push_back(Clean);
}

void CelestialSky::ConfigureStarfieldAppearance(
    float StarBrightnessGain,
    float MagnitudeLimit,
    float MilkyWayBandStrength,
    float ScintillationAmount,
    float TimeSeconds) noexcept
{
    StarBrightnessGain_   = StarBrightnessGain;
    MagnitudeLimit_       = MagnitudeLimit;
    MilkyWayBandStrength_ = MilkyWayBandStrength;
    ScintillationAmount_  = ScintillationAmount;
    TimeSeconds_          = TimeSeconds;
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                      STARS, MILKY WAY & CUSTOM AUTHORED STARS
------------------------------------------------------------------------------------------------------------------------------------------*/
Vec3 CelestialSky::EvaluateCatalogueStarsAndMilkyWay(
    Vec3  D,
    float NightVisibilityFactor,
    float PixelFootprintRad) const noexcept
{
    if (NightVisibilityFactor <= 1.0e-4f || StarBrightnessGain_ <= 0.0f || D.Z <= -0.02f)
    {
        return {0.0f, 0.0f, 0.0f};
    }

    const float HorizonFade = SmoothStepF(-0.01f, 0.08f, D.Z);
    const float Airmass     = 1.0f / std::max(0.10f, D.Z + 0.06f);
    const float Extinction  = std::exp(-0.055f * (Airmass - 1.0f));

    const uint32_t CellIdx = OctahedralCellForDirection(D);
    const CellSpan Span    = StarCells_[CellIdx];

    // Resolution-aware subpixel PSF width so stars look crisp & pinpoint, never single-pixel aliasing or huge blobs!
    const float SigmaRad = std::max(0.00055f, PixelFootprintRad * 0.92f);
    const float InvW2    = 1.0f / (SigmaRad * SigmaRad);

    Vec3 StarSum{0.0f, 0.0f, 0.0f};
    for (uint32_t I = 0u; I < Span.Count; ++I)
    {
        const auto& S = BinnedStars_[Span.First + I];
        if (S.Magnitude > MagnitudeLimit_)
        {
            break; // Sorted brightest first!
        }
        const Vec3  Delta   = D - S.DirectionUnit;
        const float Radius2 = Dot(Delta, Delta) * InvW2;
        if (Radius2 > 14.0f)
        {
            continue;
        }
        const float Core  = std::exp(-Radius2 * 1.65f);
        const float Halo  = std::exp(-Radius2 * 0.32f) * std::min(0.18f, std::sqrt(S.RelativeFlux) * 0.08f);
        const float Phase = S.DirectionUnit.X * 91.7f + S.DirectionUnit.Y * 213.1f + S.DirectionUnit.Z * 57.3f;
        const float Twink = 1.0f + ScintillationAmount_ * 0.25f * std::sin(TimeSeconds_ * 6.283f + Phase);
        const float Gain  = std::min(16.0f, 0.06f + 4.8f * std::pow(std::max(0.0f, S.RelativeFlux), 0.62f));
        StarSum           = StarSum + S.ChromaticityRgb * ((Core + Halo) * Gain * Twink);
    }

    // Structured Milky Way galactic band + central dark dust rift!
    const Vec3  GalacticPole = Normalise(Vec3{0.32f, 0.78f, 0.54f});
    const float GalLat       = Dot(D, GalacticPole);
    const float CloudStruct  = 0.55f + 0.45f * Fbm3D(D * 7.5f + Vec3{3.1f, 1.7f, 5.9f});
    const float Band         = std::exp(-(GalLat * GalLat) / 0.024f) * CloudStruct;
    const float RiftOffset  = GalLat + 0.022f * (LatticeNoise3D(D * 11.0f) - 0.5f);
    const float DustRift    = 1.0f - 0.78f * std::exp(-(RiftOffset * RiftOffset) / 0.0018f) * (0.65f + 0.35f * LatticeNoise3D(D * 19.0f));
    const Vec3  MilkyRgb     = Vec3{0.024f, 0.030f, 0.048f} * (Band * DustRift * MilkyWayBandStrength_);

    return (StarSum * StarBrightnessGain_ + MilkyRgb) * (NightVisibilityFactor * HorizonFade * Extinction);
}

Vec3 CelestialSky::EvaluateCustomStarsAlongRay(
    Vec3  D,
    float PixelFootprintRad) const noexcept
{
    Vec3 Total{0.0f, 0.0f, 0.0f};
    for (const auto& Cs : CustomStars_)
    {
        if (D.Z <= -0.02f)
        {
            continue;
        }
        const float CosAng = std::clamp(Dot(D, Cs.DirectionUnit), -1.0f, 1.0f);
        const float Ang    = std::acos(CosAng);
        if (Ang > 0.35f)
        {
            continue;
        }

        const Vec3  StarCol = KelvinToBlackbodyChromaticity(Cs.TemperatureKelvin);
        const float EffR    = std::max(Cs.AngularRadiusRad, PixelFootprintRad * 0.85f);

        // Limb-darkened stellar photosphere disc
        float Disc = 0.0f;
        if (Ang < EffR + PixelFootprintRad)
        {
            const float Edge = 1.0f - SmoothStepF(std::max(0.0f, EffR - PixelFootprintRad), EffR + PixelFootprintRad, Ang);
            const float Mu   = std::sqrt(std::max(0.0f, 1.0f - std::min(1.0f, (Ang / EffR) * (Ang / EffR))));
            const float Limb = 0.42f + 0.58f * Mu;
            Disc             = Edge * Limb * 14.0f;
        }

        // Multi-scale stellar corona + 6-blade needle-sharp Airy diffraction spikes (constant perpendicular thickness)!
        const Vec3  RefUp       = (std::abs(Cs.DirectionUnit.Z) < 0.95f) ? Vec3{0.0f, 0.0f, 1.0f} : Vec3{1.0f, 0.0f, 0.0f};
        const Vec3  TanU        = Normalise(Cross(Cs.DirectionUnit, RefUp));
        const Vec3  TanV        = Cross(Cs.DirectionUnit, TanU);
        const float Dx          = Dot(D, TanU);
        const float Dy          = Dot(D, TanV);
        const float Theta       = std::atan2(Dy, Dx) + 0.26f;
        const float NeedleWidth = std::max(PixelFootprintRad * 1.15f, 0.00085f);
        const float PerpDist    = Ang * std::abs(std::sin(3.0f * Theta));
        const float SpikeNeedle = std::exp(-(PerpDist * PerpDist) / (NeedleWidth * NeedleWidth));
        const float SpikeReach  = std::exp(-Ang / std::max(0.018f, EffR * 15.0f));
        const float Spikes      = SpikeNeedle * SpikeReach;
        const float Corona      = (std::exp(-Ang / (EffR * 1.65f)) * 0.42f +
                                   std::exp(-Ang / (EffR * 5.2f)) * 0.045f +
                                   Spikes * 0.52f) * Cs.CoronaGlowStrength;

        Total = Total + StarCol * (Cs.RadianceGain * (Disc + Corona) * SmoothStepF(-0.01f, 0.05f, D.Z));
    }
    return Total;
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                       TEXTURED CRATERED MOON & 6-BODY LUNAR ATLAS
------------------------------------------------------------------------------------------------------------------------------------------*/
CelestialRaySample CelestialSky::EvaluateSingleMoon(
    const LunarBodyDescriptor& Moon,
    Vec3                       RayDirUnit,
    Vec3                       SunDirUnit,
    Vec3                       SunColRgb,
    float                      PixelFootprintRad) const noexcept
{
    CelestialRaySample Out{};
    if (Moon.AngularRadiusRad <= 1.0e-5f || RayDirUnit.Z <= -0.02f || Moon.DirectionUnit.Z <= -0.05f)
    {
        return Out;
    }

    const float CosAng = std::clamp(Dot(RayDirUnit, Moon.DirectionUnit), -1.0f, 1.0f);
    const float Ang    = std::acos(CosAng);
    const float R      = Moon.AngularRadiusRad;

    // Soft atmospheric lunar corona halo outside and across limb
    const float PhaseAngle = std::acos(std::clamp(Dot(Moon.DirectionUnit * -1.0f, SunDirUnit), -1.0f, 1.0f));
    const float IllumFrac  = 0.5f * (1.0f + std::cos(PhaseAngle));
    const float Halo       = (std::exp(-Ang / (R * 1.8f)) * 0.045f + std::exp(-Ang * 8.0f) * 0.004f)
                           * Moon.SurfaceBrightness * (0.25f + 0.75f * IllumFrac);
    Out.RadianceRgb        = Vec3{0.72f, 0.80f, 0.96f} * Halo;

    if (Ang > R * (1.0f + 0.08f * Moon.AtmosphericHaze) + PixelFootprintRad * 1.5f)
    {
        return Out;
    }

    // Orthographic selenographic disc coordinates
    const Vec3  RefUp = (std::abs(Moon.DirectionUnit.Z) < 0.98f) ? Vec3{0.0f, 0.0f, 1.0f} : Vec3{0.0f, 1.0f, 0.0f};
    const Vec3  East  = Normalise(Cross(RefUp, Moon.DirectionUnit));
    const Vec3  North = Cross(Moon.DirectionUnit, East);
    const float SinR  = std::max(1.0e-6f, std::sin(R));
    const float DiscA = Dot(RayDirUnit, East) / SinR;
    const float DiscB = Dot(RayDirUnit, North) / SinR;
    const float Rho2  = DiscA * DiscA + DiscB * DiscB;

    const float Edge = 1.0f - SmoothStepF(R * (1.0f - 0.06f * Moon.AtmosphericHaze) - PixelFootprintRad, R + PixelFootprintRad, Ang);
    if (Edge <= 1.0e-4f)
    {
        return Out;
    }

    const float DiscZ = std::sqrt(std::max(0.0f, 1.0f - std::min(1.0f, Rho2)));
    // World-space unit normal on the lunar sphere
    const Vec3 SphereNormalWorld = Normalise(East * DiscA + North * DiscB + Moon.DirectionUnit * DiscZ);

    // Axial-tilted selenographic coordinates for texture/procedural surface sampling
    const float Ct = std::cos(Moon.AxialTiltRad);
    const float St = std::sin(Moon.AxialTiltRad);
    const Vec3  LocalN{
        DiscA,
        DiscB * Ct + DiscZ * St,
        -DiscB * St + DiscZ * Ct};

    const double LatRad = std::asin(std::clamp(static_cast<double>(LocalN.Y), -1.0, 1.0));
    const double LonRad = std::atan2(static_cast<double>(LocalN.X), static_cast<double>(LocalN.Z)) + Moon.SpinLongitudeRad;

    // Multi-scale selenographic crater normal relief (enhances terminator craters realistically!)
    const Vec3  SurfP  = LocalN * 14.0f;
    const float CratH0 = Fbm3D(SurfP);
    const float CratHx = Fbm3D(SurfP + Vec3{0.08f, 0.0f, 0.0f});
    const float CratHy = Fbm3D(SurfP + Vec3{0.0f, 0.08f, 0.0f});
    const float ReliefScale = (Moon.Preset == LunarSurfacePreset::ShroudTitan) ? 0.02f : 0.24f;
    const Vec3  PerturbedN  = Normalise(
        SphereNormalWorld
        + East * ((CratH0 - CratHx) * ReliefScale * 4.0f)
        + North * ((CratH0 - CratHy) * ReliefScale * 4.0f));

    const double Mu0 = std::max(0.0, static_cast<double>(Dot(PerturbedN, SunDirUnit)));
    const double Mu  = std::max(1.0e-3, static_cast<double>(DiscZ));

    Vec3 SurfaceRadiance{};
    if (Moon.Preset == LunarSurfacePreset::LunaSelenographic && LunaAlbedoMap_.Loaded())
    {
        const SpectrumRgb SolarSpec{SunColRgb.X, SunColRgb.Y, SunColRgb.Z};
        const SpectrumRgb Eval = EvaluateLunarDiscRadiance(
            LunaAlbedoMap_,
            static_cast<double>(DiscA),
            static_cast<double>(DiscB),
            Moon.SpinLongitudeRad,
            static_cast<double>(Moon.AxialTiltRad * 0.25f),
            Mu0,
            Mu,
            static_cast<double>(PhaseAngle),
            SolarSpec,
            static_cast<double>(Moon.EarthshineStrength));
        SurfaceRadiance = Vec3{static_cast<float>(Eval.R), static_cast<float>(Eval.G), static_cast<float>(Eval.B)} * Moon.SurfaceBrightness;
    }
    else
    {
        // High-detail procedural selenographic mare + highlands + 6-body lunar presets!
        const float MareNoise = Fbm3D(LocalN * 2.8f + Vec3{1.4f, 2.7f, 0.9f});
        const float Mare      = SmoothStepF(0.44f, 0.62f, MareNoise);
        const float RayCrater = std::pow(std::max(0.0f, LatticeNoise3D(LocalN * 22.0f) - 0.58f) * 2.3f, 2.0f);

        Vec3 Albedo{0.16f, 0.155f, 0.148f};
        Vec3 ThermalGlow{0.0f, 0.0f, 0.0f};
        switch (Moon.Preset)
        {
            case LunarSurfacePreset::LunaSelenographic:
                Albedo = LerpVec3({0.075f, 0.074f, 0.078f}, {0.22f, 0.215f, 0.205f}, Mare) + Vec3{0.18f, 0.18f, 0.19f} * RayCrater;
                break;
            case LunarSurfacePreset::EmberVolcanic:
                Albedo      = LerpVec3({0.05f, 0.045f, 0.045f}, {0.16f, 0.09f, 0.06f}, Mare);
                ThermalGlow = Vec3{1.8f, 0.35f, 0.04f} * std::pow(std::max(0.0f, 1.0f - MareNoise * 1.55f), 3.0f);
                break;
            case LunarSurfacePreset::GlacierEuropa:
                Albedo = LerpVec3({0.58f, 0.68f, 0.78f}, {0.86f, 0.90f, 0.95f}, Mare) - Vec3{0.22f, 0.12f, 0.04f} * RayCrater;
                break;
            case LunarSurfacePreset::SulfurIo:
                Albedo = LerpVec3({0.78f, 0.66f, 0.18f}, {0.92f, 0.85f, 0.38f}, Mare);
                break;
            case LunarSurfacePreset::ShroudTitan:
                Albedo = LerpVec3({0.68f, 0.42f, 0.16f}, {0.82f, 0.55f, 0.24f}, 0.5f + 0.5f * LocalN.Y);
                break;
            case LunarSurfacePreset::ShardCaptured:
                Albedo = LerpVec3({0.06f, 0.06f, 0.065f}, {0.14f, 0.135f, 0.13f}, Mare);
                break;
        }
        (void)LonRad;
        (void)LatRad;

        const float Lommel = (Mu0 > 0.0) ? static_cast<float>((2.0 * Mu0) / (Mu0 + Mu)) : 0.0f;
        const float OppDim = std::exp(-0.65f * PhaseAngle);
        const Vec3  EarthS = Vec3{0.045f, 0.062f, 0.095f} * Moon.EarthshineStrength;
        const float RimH   = std::pow(1.0f - static_cast<float>(Mu), 3.0f) * Moon.AtmosphericHaze * 0.35f;
        SurfaceRadiance    = CompMul(Albedo, SunColRgb) * (Lommel * OppDim * Moon.SurfaceBrightness * 0.085f)
                           + CompMul(Albedo, EarthS) * Moon.SurfaceBrightness
                           + Vec3{0.85f, 0.72f, 0.55f} * RimH
                           + ThermalGlow;
    }

    Out.HitLunarDisc           = true;
    Out.OcclusionTransmittance = 1.0f - Edge;
    Out.RadianceRgb            = Out.RadianceRgb + SurfaceRadiance * Edge;
    return Out;
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                         SIMULATED PLANETARY ATMOSPHERE + BANDED BODY + PLANETARY RINGS
------------------------------------------------------------------------------------------------------------------------------------------*/
CelestialRaySample CelestialSky::EvaluateSinglePlanetAndRings(
    const PlanetaryBodyDescriptor& Planet,
    Vec3                           RayDirUnit,
    Vec3                           SunDirUnit,
    Vec3                           SunColRgb,
    float                          PixelFootprintRad) const noexcept
{
    CelestialRaySample Out{};
    if (Planet.AngularRadiusRad <= 1.0e-5f || RayDirUnit.Z <= -0.04f)
    {
        return Out;
    }

    // Place unit-radius planet sphere in ray space at distance Dp = 1 / sin(AngularRadiusRad)!
    const float SinAlpha     = std::sin(std::clamp(Planet.AngularRadiusRad, 1.0e-4f, 0.85f));
    const float PlanetDist   = 1.0f / SinAlpha;
    const Vec3  PlanetCentre = Planet.DirectionUnit * PlanetDist;
    const float Rp           = 1.0f;
    const float Ra           = Rp * (1.0f + std::max(0.005f, Planet.Atmosphere.ShellHeightFraction));

    // Quick bounding cone cull around outer ring / atmosphere
    const float MaxOuterRatio = Planet.Rings.Enabled ? std::max(Ra, Planet.Rings.OuterRadiusRatio + 0.15f) : (Ra + 0.1f);
    const float MaxConeSin    = std::min(0.99f, MaxOuterRatio / PlanetDist);
    if (Dot(RayDirUnit, Planet.DirectionUnit) < std::sqrt(std::max(0.0f, 1.0f - MaxConeSin * MaxConeSin)) - 0.05f)
    {
        return Out;
    }

    // 1. Intersect Planet solid/cloud-top sphere (Rp) and outer Atmosphere sphere (Ra)
    float SolidT0 = -1.0f;
    float SolidT1 = -1.0f;
    const bool HitSolid = IntersectRaySphere({0.0f, 0.0f, 0.0f}, RayDirUnit, PlanetCentre, Rp, SolidT0, SolidT1) && (SolidT0 > 0.0f);

    float AtmoT0 = -1.0f;
    float AtmoT1 = -1.0f;
    const bool HitAtmo = Planet.Atmosphere.Enabled
                      && IntersectRaySphere({0.0f, 0.0f, 0.0f}, RayDirUnit, PlanetCentre, Ra, AtmoT0, AtmoT1)
                      && (AtmoT1 > 0.0f);

    // 2. Intersect Tilted Ring Plane (and evaluate ring shading + planet shadow on rings!)
    bool  RingHitValid = false;
    float RingT        = 1.0e9f;
    Vec3  RingRadRgb{0.0f, 0.0f, 0.0f};
    float RingAlpha    = 0.0f;

    if (Planet.Rings.Enabled)
    {
        const float Denom = Dot(RayDirUnit, Planet.Rings.RingNormalUnit);
        if (std::abs(Denom) > 1.0e-5f)
        {
            const float TPlane = Dot(PlanetCentre, Planet.Rings.RingNormalUnit) / Denom;
            if (TPlane > 0.0f)
            {
                const Vec3  RingPt = RayDirUnit * TPlane;
                const float RingR  = Length(RingPt - PlanetCentre);
                float       TauN   = 0.0f;
                Vec3        RingAlb{};
                SampleRingRadialProfile(Planet.Rings, RingR, TauN, RingAlb);

                if (TauN > 1.0e-4f)
                {
                    RingHitValid       = true;
                    RingT              = TPlane;
                    Out.HitPlanetaryRings = true;

                    const float SlantTau = TauN / std::max(0.08f, std::abs(Denom));
                    RingAlpha            = std::clamp(1.0f - std::exp(-SlantTau), 0.0f, 1.0f);

                    // Check Planet Umbra + Penumbra + Atmospheric Limb Tint onto the Rings!
                    const Vec3  RelRing  = RingPt - PlanetCentre;
                    const float ProjSun  = Dot(RelRing, SunDirUnit);
                    float       SunVis   = 1.0f;
                    Vec3        SunTint  = {1.0f, 1.0f, 1.0f};

                    if (ProjSun < 0.0f)
                    {
                        const float PerpDist = Length(RelRing - SunDirUnit * ProjSun);
                        // Soft solar penumbra width (~0.018 Rp) + atmospheric refraction/reddening through Ra!
                        SunVis = SmoothStepF(Rp - 0.015f, Rp + 0.018f, PerpDist);
                        if (SunVis < 0.5f)
                        {
                            Out.InPlanetShadowOnRings = true;
                        }
                        if (Planet.Atmosphere.Enabled && PerpDist > Rp - 0.01f && PerpDist < Ra)
                        {
                            const float LimbFrac = SmoothStepF(Rp, Ra, PerpDist);
                            SunTint              = LerpVec3({0.85f, 0.28f, 0.08f}, {1.0f, 1.0f, 1.0f}, LimbFrac);
                        }
                    }

                    // Henyey-Greenberg ice-crystal phase + backlit forward scatter + subtle Saturnshine from planet!
                    const float CosScatter  = Dot(RayDirUnit, SunDirUnit);
                    const float G           = Planet.Rings.IcePhaseAsymmetryG;
                    const float HgDenom     = std::pow(std::max(0.05f, 1.0f + G * G - 2.0f * G * CosScatter), 1.5f);
                    const float PhaseIce    = 0.65f + 0.35f * ((1.0f - G * G) / HgDenom);
                    const float SunOblique  = 0.28f + 0.72f * std::abs(Dot(SunDirUnit, Planet.Rings.RingNormalUnit));
                    const Vec3  PlanetShine = RingAlb * 0.018f;

                    // Physical Lambertian 1/pi ring reflectance preserves ringlets, C-ring duskiness, Cassini & Encke gaps!
                    RingRadRgb = CompMul(CompMul(RingAlb, SunColRgb), SunTint) *
                                     (SunVis * SunOblique * PhaseIce * RingAlpha * Planet.SurfaceAlbedoScale * 0.115f)
                               + PlanetShine * RingAlpha;
                }
            }
        }
    }

    // 3. Evaluate Banded Planet Surface / Cloud Deck if solid sphere hit
    Vec3  PlanetBodyRad{0.0f, 0.0f, 0.0f};
    float PlanetEdgeCoverage = 0.0f;
    if (HitSolid)
    {
        Out.HitPlanetBody     = true;
        const float CenterAng = std::acos(std::clamp(Dot(RayDirUnit, Planet.DirectionUnit), -1.0f, 1.0f));
        PlanetEdgeCoverage    = 1.0f - SmoothStepF(
            Planet.AngularRadiusRad - PixelFootprintRad,
            Planet.AngularRadiusRad + PixelFootprintRad,
            CenterAng);

        const Vec3 HitWorld   = RayDirUnit * SolidT0;
        const Vec3 UnitSphere = Normalise(HitWorld - PlanetCentre);

        // Build planet-local latitude/longitude coordinates around SpinAxisUnit
        const Vec3  AxisZ = Planet.SpinAxisUnit;
        const Vec3  RefX  = (std::abs(AxisZ.Z) < 0.92f) ? Vec3{0.0f, 0.0f, 1.0f} : Vec3{1.0f, 0.0f, 0.0f};
        const Vec3  AxisX = Normalise(Cross(RefX, AxisZ));
        const Vec3  AxisY = Cross(AxisZ, AxisX);
        const float LatSin = std::clamp(Dot(UnitSphere, AxisZ), -1.0f, 1.0f);
        const float Lon    = std::atan2(Dot(UnitSphere, AxisY), Dot(UnitSphere, AxisX)) + Planet.SpinPhaseRad;

        Vec3 CloudDeckAlbedo{0.75f, 0.68f, 0.56f};
        float SpecularGlint = 0.0f;

        if (Planet.Archetype == PlanetarySurfaceArchetype::BandedGasGiant)
        {
            // Zonal jet-stream bands + Kelvin-Helmholtz wave shear + Great Anticyclonic Storm Oval!
            const float Warp    = 0.045f * (Fbm3D({std::cos(Lon) * 3.5f, std::sin(Lon) * 3.5f, LatSin * 9.0f}) - 0.5f);
            const float L       = LatSin + Warp;
            const float Band1   = 0.5f + 0.5f * std::cos(L * 22.0f);
            const float Band2   = 0.5f + 0.5f * std::sin(L * 47.0f + 1.1f);
            const Vec3  ZoneCol = {0.90f, 0.83f, 0.70f};
            const Vec3  BeltCol = {0.66f, 0.46f, 0.30f};
            const Vec3  PoleCol = {0.36f, 0.42f, 0.52f};
            CloudDeckAlbedo     = LerpVec3(BeltCol, ZoneCol, 0.65f * Band1 + 0.35f * Band2);
            CloudDeckAlbedo     = LerpVec3(CloudDeckAlbedo, PoleCol, SmoothStepF(0.68f, 0.95f, std::abs(LatSin)));

            // Great Storm Oval at Southern Tropical Belt (LatSin ~ -0.34, Lon ~ 0.0)
            const float DLon = std::sin(0.5f * (Lon - Planet.SpinPhaseRad - 0.35f)) * 2.0f;
            const float DLat = (LatSin + 0.32f) * 2.6f;
            const float StormR2 = (DLon * DLon) / 0.11f + (DLat * DLat) / 0.045f;
            if (StormR2 < 1.0f)
            {
                const float Swirl = SmoothStepF(1.0f, 0.15f, StormR2);
                CloudDeckAlbedo   = LerpVec3(CloudDeckAlbedo, {0.86f, 0.38f, 0.22f}, Swirl * 0.82f);
            }
        }
        else if (Planet.Archetype == PlanetarySurfaceArchetype::OceanicTerrestrial)
        {
            const float Cont  = Fbm3D(UnitSphere * 3.4f + Vec3{2.1f, 0.8f, 4.3f});
            const float Polar = SmoothStepF(0.74f, 0.88f, std::abs(LatSin));
            const bool  Land  = Cont > 0.52f;
            CloudDeckAlbedo   = Land ? LerpVec3({0.14f, 0.32f, 0.12f}, {0.48f, 0.40f, 0.26f}, SmoothStepF(0.52f, 0.74f, Cont))
                                     : Vec3{0.03f, 0.09f, 0.24f};
            CloudDeckAlbedo   = LerpVec3(CloudDeckAlbedo, {0.92f, 0.94f, 0.97f}, Polar);
            const float CloudSwirl = SmoothStepF(0.48f, 0.75f, Fbm3D(UnitSphere * 5.8f + Vec3{6.2f, 1.3f, 2.9f}));
            CloudDeckAlbedo   = LerpVec3(CloudDeckAlbedo, {0.90f, 0.92f, 0.95f}, CloudSwirl * 0.75f);
            if (!Land && Polar < 0.3f)
            {
                const Vec3 HalfV = Normalise(SunDirUnit - RayDirUnit);
                SpecularGlint    = std::pow(std::max(0.0f, Dot(UnitSphere, HalfV)), 42.0f) * 0.45f * (1.0f - CloudSwirl);
            }
        }
        else if (Planet.Archetype == PlanetarySurfaceArchetype::RustyDesertWorld)
        {
            const float Basin = Fbm3D(UnitSphere * 4.2f);
            CloudDeckAlbedo   = LerpVec3({0.28f, 0.14f, 0.08f}, {0.72f, 0.36f, 0.16f}, Basin);
            CloudDeckAlbedo   = LerpVec3(CloudDeckAlbedo, {0.92f, 0.90f, 0.88f}, SmoothStepF(0.84f, 0.95f, std::abs(LatSin)));
        }
        else
        {
            const float Band = 0.5f + 0.5f * std::cos(LatSin * 16.0f);
            CloudDeckAlbedo  = LerpVec3({0.16f, 0.48f, 0.78f}, {0.38f, 0.78f, 0.92f}, Band);
        }

        // Ring Shadow Cast Onto Planet Cloud Tops!
        bool  RingShadowHit = false;
        const float RingTrans = EvaluateRingShadowTransmittance(Planet.Rings, PlanetCentre, HitWorld, SunDirUnit, RingShadowHit);
        if (RingShadowHit && Dot(UnitSphere, SunDirUnit) > 0.02f)
        {
            Out.InRingShadowOnPlanet = true;
        }

        // Minnaert / Lambertian 1/pi cloud-top & surface reflectance (preserves rich zonal bands, continents & storm ovals!)
        const float NdotL    = std::max(0.0f, Dot(UnitSphere, SunDirUnit));
        const float NdotV    = std::max(0.08f, Dot(UnitSphere, RayDirUnit * -1.0f));
        const float Minnaert = std::pow(NdotL, 0.84f) * std::pow(NdotV, -0.14f);
        PlanetBodyRad        = CompMul(CloudDeckAlbedo, SunColRgb) * (Minnaert * RingTrans * Planet.SurfaceAlbedoScale * 0.145f)
                             + SunColRgb * (SpecularGlint * RingTrans * 0.18f)
                             + CloudDeckAlbedo * 0.012f;
    }

    // 4. Simulated Spherical Planetary Atmosphere Ray-March (Rayleigh + Cornette-Shanks Mie + Absorption)!
    Vec3  AtmoInscatter{0.0f, 0.0f, 0.0f};
    Vec3  AtmoViewTrans{1.0f, 1.0f, 1.0f};
    if (HitAtmo)
    {
        Out.HitPlanetAtmosphere = true;
        const float TStart      = std::max(0.0f, AtmoT0);
        const float TEnd        = HitSolid ? std::min(AtmoT1, SolidT0) : AtmoT1;

        if (TEnd > TStart)
        {
            const auto& AP        = Planet.Atmosphere;
            const float ShellSpan = std::max(1.0e-4f, Ra - Rp);
            const float Hr        = std::max(1.0e-4f, AP.RayleighScaleFraction * Rp);
            const float Hm        = std::max(1.0e-4f, AP.MieScaleFraction * Rp);
            const float PhysScale = AP.OpticalDensityScale;

            const Vec3  BetaR = AP.RayleighScattering;
            const Vec3  BetaM{AP.MieScattering, AP.MieScattering, AP.MieScattering};
            const Vec3  BetaO = AP.AbsorptionCoefficients;

            const float Mu  = Dot(RayDirUnit, SunDirUnit);
            const float G   = AP.MieAnisotropyG;
            const float PhR = (3.0f / (16.0f * PiF)) * (1.0f + Mu * Mu);
            const float PhM = (3.0f / (8.0f * PiF)) * ((1.0f - G * G) * (1.0f + Mu * Mu))
                            / ((2.0f + G * G) * std::pow(std::max(0.04f, 1.0f + G * G - 2.0f * G * Mu), 1.5f));

            constexpr int ViewSteps  = 12;
            constexpr int LightSteps = 6;
            const float   Dt         = (TEnd - TStart) / static_cast<float>(ViewSteps);

            float OdR  = 0.0f;
            float OdM  = 0.0f;
            Vec3  SumR = {0.0f, 0.0f, 0.0f};
            Vec3  SumM = {0.0f, 0.0f, 0.0f};

            for (int Step = 0; Step < ViewSteps; ++Step)
            {
                const float Tm  = TStart + (static_cast<float>(Step) + 0.5f) * Dt;
                const Vec3  Pos = RayDirUnit * Tm;
                const float Alt = std::max(0.0f, Length(Pos - PlanetCentre) - Rp);
                if (Alt > ShellSpan * 1.05f)
                {
                    continue;
                }

                const float SegPhys = Dt * PhysScale;
                const float RhoR    = std::exp(-Alt / Hr) * SegPhys;
                const float RhoM    = std::exp(-Alt / Hm) * SegPhys;
                OdR += RhoR;
                OdM += RhoM;

                // Sun ray through planetary atmosphere (occulted if planet core blocks sun!)
                float SunCore0 = -1.0f;
                float SunCore1 = -1.0f;
                const bool BlockedByPlanetCore = IntersectRaySphere(Pos, SunDirUnit, PlanetCentre, Rp * 0.992f, SunCore0, SunCore1)
                                              && (SunCore0 > 0.0f);
                if (!BlockedByPlanetCore)
                {
                    float SunAtm0 = -1.0f;
                    float SunAtm1 = -1.0f;
                    if (IntersectRaySphere(Pos, SunDirUnit, PlanetCentre, Ra, SunAtm0, SunAtm1) && SunAtm1 > 0.0f)
                    {
                        const float DtSun = SunAtm1 / static_cast<float>(LightSteps);
                        float       OlR   = 0.0f;
                        float       OlM   = 0.0f;
                        for (int Ls = 0; Ls < LightSteps; ++Ls)
                        {
                            const Vec3  QPos = Pos + SunDirUnit * ((static_cast<float>(Ls) + 0.5f) * DtSun);
                            const float QAlt = std::max(0.0f, Length(QPos - PlanetCentre) - Rp);
                            OlR += std::exp(-QAlt / Hr) * (DtSun * PhysScale);
                            OlM += std::exp(-QAlt / Hm) * (DtSun * PhysScale);
                        }

                        bool  DummyRingShad = false;
                        const float RingAtt = EvaluateRingShadowTransmittance(Planet.Rings, PlanetCentre, Pos, SunDirUnit, DummyRingShad);
                        const Vec3  TauTot  = BetaR * (OdR + OlR) + BetaM * (1.1f * (OdM + OlM)) + BetaO * (OdR + OlR);
                        const Vec3  Att     = ExpNeg(TauTot) * RingAtt;
                        SumR                = SumR + Att * RhoR;
                        SumM                = SumM + Att * RhoM;
                    }
                }
            }

            AtmoViewTrans = ExpNeg(BetaR * OdR + BetaM * (1.1f * OdM) + BetaO * OdR);
            AtmoInscatter = CompMul((CompMul(SumR, BetaR) * PhR + CompMul(SumM, BetaM) * PhM), SunColRgb) * 1.45f;
        }
    }

    // 5. Exact Depth-Sorted Front-Ring / Planet+Atmosphere / Back-Ring Compositing!
    const float PlanetMidT    = HitSolid ? SolidT0 : (HitAtmo ? 0.5f * (std::max(0.0f, AtmoT0) + AtmoT1) : 1.0e9f);
    const Vec3  PlanetTotal   = CompMul(PlanetBodyRad, AtmoViewTrans) * PlanetEdgeCoverage + AtmoInscatter;
    const float PlanetTransBg = HitSolid ? ((1.0f - PlanetEdgeCoverage) * AtmoViewTrans.Y) : AtmoViewTrans.Y;

    if (RingHitValid)
    {
        if (RingT < PlanetMidT)
        {
            // Front ring arc passes in front of planet & atmosphere!
            Out.RadianceRgb            = RingRadRgb + PlanetTotal * (1.0f - RingAlpha);
            Out.OcclusionTransmittance = (1.0f - RingAlpha) * PlanetTransBg;
        }
        else
        {
            // Back ring arc lies behind planet (occluded by solid body & attenuated by atmospheric limb!)
            const Vec3 BackRingBehindPlanet = CompMul(RingRadRgb, AtmoViewTrans) * (HitSolid ? (1.0f - PlanetEdgeCoverage) : 1.0f);
            Out.RadianceRgb                 = PlanetTotal + BackRingBehindPlanet;
            Out.OcclusionTransmittance      = PlanetTransBg * (1.0f - RingAlpha);
        }
    }
    else
    {
        Out.RadianceRgb            = PlanetTotal;
        Out.OcclusionTransmittance = PlanetTransBg;
    }

    return Out;
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                        UNIFIED CELESTIAL SKY & NOCTURNAL LIGHTING
------------------------------------------------------------------------------------------------------------------------------------------*/
CelestialRaySample CelestialSky::EvaluateCelestialRay(
    Vec3  DirectionUnit,
    Vec3  PrimarySunDirectionUnit,
    Vec3  PrimarySunRadianceRgb,
    float SolarElevationDegrees,
    float PixelFootprintRad) const noexcept
{
    const Vec3 D   = Normalise(DirectionUnit);
    const Vec3 Sun = Normalise(PrimarySunDirectionUnit);

    // Smooth twilight fade for background starfield (-2 deg civil dusk -> -12 deg astronomical night)
    const float NightVis = 1.0f - SmoothStepF(-13.0f, -1.5f, SolarElevationDegrees);

    Vec3  BgStarsAndCustom = EvaluateCatalogueStarsAndMilkyWay(D, NightVis, PixelFootprintRad)
                           + EvaluateCustomStarsAlongRay(D, PixelFootprintRad);

    CelestialRaySample Final{};
    Final.OcclusionTransmittance = 1.0f;

    // Composite distant Ringed Planets (front of stars, behind local Moons)
    Vec3 PlanetAccum{0.0f, 0.0f, 0.0f};
    for (const auto& Planet : Planets_)
    {
        const CelestialRaySample Ps = EvaluateSinglePlanetAndRings(Planet, D, Sun, PrimarySunRadianceRgb, PixelFootprintRad);
        PlanetAccum                 = PlanetAccum * Ps.OcclusionTransmittance + Ps.RadianceRgb;
        Final.OcclusionTransmittance *= Ps.OcclusionTransmittance;
        Final.HitPlanetBody          = Final.HitPlanetBody || Ps.HitPlanetBody;
        Final.HitPlanetAtmosphere    = Final.HitPlanetAtmosphere || Ps.HitPlanetAtmosphere;
        Final.HitPlanetaryRings      = Final.HitPlanetaryRings || Ps.HitPlanetaryRings;
        Final.InPlanetShadowOnRings  = Final.InPlanetShadowOnRings || Ps.InPlanetShadowOnRings;
        Final.InRingShadowOnPlanet   = Final.InRingShadowOnPlanet || Ps.InRingShadowOnPlanet;
    }

    // Composite local Moons (occluding both background stars and planets)
    Vec3  MoonAccum{0.0f, 0.0f, 0.0f};
    float MoonTrans = 1.0f;
    for (const auto& Moon : Moons_)
    {
        const CelestialRaySample Ms = EvaluateSingleMoon(Moon, D, Sun, PrimarySunRadianceRgb, PixelFootprintRad);
        MoonAccum                   = MoonAccum * Ms.OcclusionTransmittance + Ms.RadianceRgb;
        MoonTrans                  *= Ms.OcclusionTransmittance;
        Final.HitLunarDisc          = Final.HitLunarDisc || Ms.HitLunarDisc;
    }

    Final.RadianceRgb            = (BgStarsAndCustom * Final.OcclusionTransmittance + PlanetAccum) * MoonTrans + MoonAccum;
    Final.OcclusionTransmittance *= MoonTrans;
    return Final;
}

Vec3 CelestialSky::EvaluateNocturnalDirectIrradiance(
    Vec3 SurfaceNormalUnit,
    Vec3 PrimarySunDirectionUnit,
    Vec3 PrimarySunRadianceRgb) const noexcept
{
    Vec3 TotalIrr{0.0f, 0.0f, 0.0f};
    const Vec3 Sun = Normalise(PrimarySunDirectionUnit);

    for (const auto& Cs : CustomStars_)
    {
        if (Cs.DirectionUnit.Z <= 0.0f || Cs.SceneIrradianceGain <= 0.0f)
        {
            continue;
        }
        const float NdotL = std::max(0.0f, Dot(SurfaceNormalUnit, Cs.DirectionUnit));
        if (NdotL > 0.0f)
        {
            TotalIrr = TotalIrr + KelvinToBlackbodyChromaticity(Cs.TemperatureKelvin) * (Cs.SceneIrradianceGain * NdotL);
        }
    }

    for (const auto& Moon : Moons_)
    {
        if (Moon.DirectionUnit.Z <= 0.0f || Moon.SceneBounceIrradiance <= 0.0f)
        {
            continue;
        }
        const float NdotM = std::max(0.0f, Dot(SurfaceNormalUnit, Moon.DirectionUnit));
        if (NdotM > 0.0f)
        {
            const float PhaseAng  = std::acos(std::clamp(Dot(Moon.DirectionUnit * -1.0f, Sun), -1.0f, 1.0f));
            const float PhaseGain = std::exp(-0.9f * PhaseAng) * 0.5f * (1.0f + std::cos(PhaseAng));
            const float SunNorm   = 1.0f / std::max(1.0f, Length(PrimarySunRadianceRgb));
            const Vec3  MoonTint  = CompMul({0.78f, 0.84f, 0.96f}, PrimarySunRadianceRgb * SunNorm);
            TotalIrr              = TotalIrr + MoonTint * (Moon.SceneBounceIrradiance * (0.08f + 0.92f * PhaseGain) * NdotM);
        }
    }

    return TotalIrr;
}

} // namespace Frontier
