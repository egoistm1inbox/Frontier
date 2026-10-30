/*==========================================================================================================================================
                                                SOLARSKYENVIRONMENTPAYLOAD.CPP
==========================================================================================================================================*/
// 🧩 Compile and verify physical solar/sky/cloud payloads and double-precision CPU reference quadratures.

#include "SkyRadiance.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace Frontier
{
namespace
{

constexpr double Pi = 3.14159265358979323846;

double DotVector(SpatialVector A, SpatialVector B) noexcept
{
    return A.X * B.X + A.Y * B.Y + A.Z * B.Z;
}

double LengthVector(SpatialVector V) noexcept
{
    return std::sqrt(DotVector(V, V));
}

SpatialVector NormalizeVector(SpatialVector V)
{
    const double Length = LengthVector(V);
    if (!std::isfinite(Length) || Length <= 1e-9)
    {
        throw std::invalid_argument("Solar/sky vector must be finite and non-zero");
    }
    return {V.X / Length, V.Y / Length, V.Z / Length};
}

SpatialVector CrossVector(SpatialVector A, SpatialVector B) noexcept
{
    return {A.Y * B.Z - A.Z * B.Y, A.Z * B.X - A.X * B.Z, A.X * B.Y - A.Y * B.X};
}

void BuildOrthonormalFrame(SpatialVector Axis, SpatialVector& Tangent, SpatialVector& Bitangent) noexcept
{
    const SpatialVector Anchor = std::abs(Axis.Z) < 0.999 ? SpatialVector{0.0, 0.0, 1.0} : SpatialVector{1.0, 0.0, 0.0};
    Tangent = CrossVector(Anchor, Axis);
    const double TangentLen = LengthVector(Tangent);
    Tangent = TangentLen > 1e-12 ? SpatialVector{Tangent.X / TangentLen, Tangent.Y / TangentLen, Tangent.Z / TangentLen}
                                 : SpatialVector{1.0, 0.0, 0.0};
    Bitangent = CrossVector(Axis, Tangent);
}

void BuildCanonicalAtmosphereVectors(SpatialVector Zenith,
                                     SpatialVector Direction,
                                     SpatialVector SolarDirection,
                                     double        RadiusKm,
                                     SpatialVector& CanonicalObserverKm,
                                     SpatialVector& CanonicalDirection,
                                     SpatialVector& CanonicalSun) noexcept
{
    SpatialVector East{}, North{};
    BuildOrthonormalFrame(Zenith, East, North);
    CanonicalObserverKm = {0.0, RadiusKm, 0.0};
    CanonicalDirection  = {DotVector(Direction, East), DotVector(Direction, Zenith), DotVector(Direction, North)};
    CanonicalSun        = {DotVector(SolarDirection, East), DotVector(SolarDirection, Zenith), DotVector(SolarDirection, North)};
}

double SmoothStep(double Edge0, double Edge1, double X) noexcept
{
    if (Edge1 <= Edge0)
    {
        return X >= Edge1 ? 1.0 : 0.0;
    }
    const double T = std::clamp((X - Edge0) / (Edge1 - Edge0), 0.0, 1.0);
    return T * T * (3.0 - 2.0 * T);
}

double EvaluateCloudHorizontalPattern(double HorizontalU, double HorizontalV, double Coverage) noexcept
{
    if (Coverage <= 0.0)
    {
        return 0.0;
    }
    const double WaveA = 0.5 + 0.5 * std::sin(HorizontalU * 2.10 + 0.45) * std::cos(HorizontalV * 1.85 - 0.30);
    const double WaveB = 0.5 + 0.5 * std::sin((HorizontalU * 0.72 - HorizontalV * 0.68) * 4.30 + 1.15);
    const double Field = 0.65 * WaveA + 0.35 * WaveB;
    const double Threshold = 1.0 - std::clamp(Coverage, 0.0, 1.0);
    return SmoothStep(Threshold, std::min(1.0, Threshold + 0.28), Field);
}

void RequireSolarSky(bool Condition, const char* Message)
{
    if (!Condition)
    {
        throw std::invalid_argument(Message);
    }
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                           PAYLOAD COMPILATION AND VALIDATION
//------------------------------------------------------------------------------------------------------------------------

std::array<float, SkyRadiancePayloadFloats> CompileSkyRadiancePayload(
    const SkyRadianceSpecification& Specification)
{
    const SpatialVector Sun    = NormalizeVector(Specification.SolarDirection);
    const SpatialVector Zenith = NormalizeVector(Specification.ZenithDirection);

    RequireSolarSky(std::isfinite(Specification.SolarAngularRadius) &&
                        Specification.SolarAngularRadius >= 5e-4 &&
                        Specification.SolarAngularRadius <= 0.35,
                    "Solar angular radius lies outside [0.0005, 0.35] radians");
    RequireSolarSky(std::isfinite(Specification.ObserverAltitudeKm) &&
                        Specification.ObserverAltitudeKm >= 0.0 &&
                        Specification.ObserverAltitudeKm <= 80.0,
                    "Observer altitude lies outside [0, 80] km");
    RequireSolarSky(std::isfinite(Specification.SolarIrradiance.R) && Specification.SolarIrradiance.R >= 0.0 &&
                        std::isfinite(Specification.SolarIrradiance.G) && Specification.SolarIrradiance.G >= 0.0 &&
                        std::isfinite(Specification.SolarIrradiance.B) && Specification.SolarIrradiance.B >= 0.0,
                    "Solar top-of-atmosphere irradiance must be finite and non-negative");
    RequireSolarSky(std::isfinite(Specification.LimbDarkeningU1) && std::isfinite(Specification.LimbDarkeningU2) &&
                        Specification.LimbDarkeningU1 >= 0.0 && Specification.LimbDarkeningU2 >= 0.0 &&
                        Specification.LimbDarkeningU1 + Specification.LimbDarkeningU2 <= 0.98,
                    "Solar limb-darkening coefficients violate positivity on the disc limb");
    RequireSolarSky(std::isfinite(Specification.MultipleScatterScale) &&
                        Specification.MultipleScatterScale >= 0.0 &&
                        Specification.MultipleScatterScale <= 4.0,
                    "Multiple-scattering scale lies outside [0, 4]");
    RequireSolarSky(std::isfinite(Specification.CloudBaseKm) && std::isfinite(Specification.CloudTopKm) &&
                        Specification.CloudBaseKm >= 0.05 &&
                        Specification.CloudTopKm > Specification.CloudBaseKm &&
                        Specification.CloudTopKm <= 30.0,
                    "Cloud slab altitude bounds are invalid");
    RequireSolarSky(std::isfinite(Specification.CloudExtinctionKm) && Specification.CloudExtinctionKm >= 0.0 &&
                        Specification.CloudExtinctionKm <= 50.0 &&
                        std::isfinite(Specification.CloudCoverage) &&
                        Specification.CloudCoverage >= 0.0 && Specification.CloudCoverage <= 1.0,
                    "Cloud slab optical parameters are invalid");

    std::array<float, SkyRadiancePayloadFloats> Payload{};
    Payload[0]  = static_cast<float>(Sun.X);
    Payload[1]  = static_cast<float>(Sun.Y);
    Payload[2]  = static_cast<float>(Sun.Z);
    Payload[3]  = static_cast<float>(Specification.SolarAngularRadius);

    Payload[4]  = static_cast<float>(Zenith.X);
    Payload[5]  = static_cast<float>(Zenith.Y);
    Payload[6]  = static_cast<float>(Zenith.Z);
    Payload[7]  = static_cast<float>(Specification.ObserverAltitudeKm);

    Payload[8]  = static_cast<float>(Specification.SolarIrradiance.R);
    Payload[9]  = static_cast<float>(Specification.SolarIrradiance.G);
    Payload[10] = static_cast<float>(Specification.SolarIrradiance.B);
    Payload[11] = static_cast<float>(Specification.MultipleScatterScale);

    Payload[12] = static_cast<float>(Specification.LimbDarkeningU1);
    Payload[13] = static_cast<float>(Specification.LimbDarkeningU2);
    Payload[14] = static_cast<float>(std::clamp(Specification.Atmosphere.GroundAlbedo, 0.0, 1.0));
    Payload[15] = static_cast<float>(std::clamp(Specification.Atmosphere.MiePhaseG, -0.99, 0.99));

    Payload[16] = static_cast<float>(Specification.CloudBaseKm);
    Payload[17] = static_cast<float>(Specification.CloudTopKm);
    Payload[18] = static_cast<float>(Specification.CloudExtinctionKm);
    Payload[19] = static_cast<float>(Specification.CloudCoverage);
    return Payload;
}

void ValidateSkyRadiancePayload(std::span<const float> Payload)
{
    RequireSolarSky(Payload.size() >= SkyRadiancePayloadFloats,
                    "Solar/sky environment payload requires twenty floats");
    for (std::uint32_t Index = 0; Index < SkyRadiancePayloadFloats; ++Index)
    {
        RequireSolarSky(std::isfinite(Payload[Index]), "Solar/sky environment payload contains non-finite float");
    }
    const double SunLength = std::sqrt(double(Payload[0]) * Payload[0] +
                                       double(Payload[1]) * Payload[1] +
                                       double(Payload[2]) * Payload[2]);
    const double ZenithLength = std::sqrt(double(Payload[4]) * Payload[4] +
                                          double(Payload[5]) * Payload[5] +
                                          double(Payload[6]) * Payload[6]);
    RequireSolarSky(std::abs(SunLength - 1.0) <= 1e-3 && std::abs(ZenithLength - 1.0) <= 1e-3,
                    "Solar/sky environment unit axes are not normalized");
    RequireSolarSky(Payload[3] >= 5e-4f && Payload[3] <= 0.35f,
                    "Solar/sky environment angular radius is out of bounds");
    RequireSolarSky(Payload[7] >= 0.0f && Payload[7] <= 80.0f,
                    "Solar/sky environment observer altitude is out of bounds");
    RequireSolarSky(Payload[8] >= 0.0f && Payload[9] >= 0.0f && Payload[10] >= 0.0f &&
                        Payload[11] >= 0.0f && Payload[11] <= 4.0f,
                    "Solar/sky environment irradiance or multiple-scatter scale is out of bounds");
    RequireSolarSky(Payload[12] >= 0.0f && Payload[13] >= 0.0f && (Payload[12] + Payload[13]) <= 0.985f &&
                        Payload[14] >= 0.0f && Payload[14] <= 1.0f &&
                        std::abs(Payload[15]) < 0.995f,
                    "Solar/sky environment limb-darkening or phase parameters are out of bounds");
    RequireSolarSky(Payload[16] >= 0.05f && Payload[17] > Payload[16] && Payload[17] <= 30.0f &&
                        Payload[18] >= 0.0f && Payload[18] <= 50.0f &&
                        Payload[19] >= 0.0f && Payload[19] <= 1.0f,
                    "Solar/sky environment cloud slab parameters are out of bounds");
}

//------------------------------------------------------------------------------------------------------------------------
//                                           REFERENCE RADIANCE AND IRRADIANCE
//------------------------------------------------------------------------------------------------------------------------

double EvaluateCloudSlabTransmittance(const SkyRadianceSpecification& Specification,
                                      SpatialVector                           OriginMeters,
                                      SpatialVector                           Direction) noexcept
{
    if (Specification.CloudExtinctionKm <= 0.0 || Specification.CloudCoverage <= 0.0)
    {
        return 1.0;
    }
    const double ZenithLength = LengthVector(Specification.ZenithDirection);
    const double DirLength    = LengthVector(Direction);
    if (ZenithLength <= 1e-9 || DirLength <= 1e-9)
    {
        return 1.0;
    }
    const SpatialVector Zenith = {Specification.ZenithDirection.X / ZenithLength,
                                  Specification.ZenithDirection.Y / ZenithLength,
                                  Specification.ZenithDirection.Z / ZenithLength};
    const SpatialVector UnitDir = {Direction.X / DirLength, Direction.Y / DirLength, Direction.Z / DirLength};
    const double CosZenith = DotVector(UnitDir, Zenith);
    if (CosZenith <= 1e-3)
    {
        return 1.0;
    }

    SpatialVector East{}, North{};
    BuildOrthonormalFrame(Zenith, East, North);
    const double OriginAltitudeKm = Specification.ObserverAltitudeKm + 1e-3 * DotVector(OriginMeters, Zenith);
    if (OriginAltitudeKm >= Specification.CloudTopKm)
    {
        return 1.0;
    }
    const double EntryAltitudeKm = std::max(Specification.CloudBaseKm, OriginAltitudeKm);
    const double EntryDistanceKm = (EntryAltitudeKm - OriginAltitudeKm) / CosZenith;
    const double ExitDistanceKm  = (Specification.CloudTopKm - OriginAltitudeKm) / CosZenith;
    const double SegmentKm       = std::max(0.0, ExitDistanceKm - EntryDistanceKm);
    if (SegmentKm <= 0.0)
    {
        return 1.0;
    }

    const SpatialVector OriginKm = {1e-3 * OriginMeters.X, 1e-3 * OriginMeters.Y, 1e-3 * OriginMeters.Z};
    constexpr std::uint32_t SlabSteps = 6u;
    double OpticalDepth = 0.0;
    for (std::uint32_t Step = 0; Step < SlabSteps; ++Step)
    {
        const double Fraction = (static_cast<double>(Step) + 0.5) / static_cast<double>(SlabSteps);
        const double DistanceKm = EntryDistanceKm + Fraction * SegmentKm;
        const SpatialVector SampleKm = {OriginKm.X + UnitDir.X * DistanceKm,
                                        OriginKm.Y + UnitDir.Y * DistanceKm,
                                        OriginKm.Z + UnitDir.Z * DistanceKm};
        const double AltitudeKm = OriginAltitudeKm + DistanceKm * CosZenith;
        const double LayerFraction = std::clamp(
            (AltitudeKm - Specification.CloudBaseKm) / (Specification.CloudTopKm - Specification.CloudBaseKm), 0.0, 1.0);
        const double VerticalEnvelope = 4.0 * LayerFraction * (1.0 - LayerFraction);
        const double HorizontalDensity = EvaluateCloudHorizontalPattern(
            DotVector(SampleKm, East), DotVector(SampleKm, North), Specification.CloudCoverage);
        OpticalDepth += Specification.CloudExtinctionKm * VerticalEnvelope * HorizontalDensity *
                        (SegmentKm / static_cast<double>(SlabSteps));
    }
    return std::exp(-OpticalDepth);
}

SpectrumRgb EvaluateSkyContinuumRadiance(const SkyRadianceSpecification& Specification,
                                              SpatialVector                           OriginMeters,
                                              SpatialVector                           Direction,
                                              std::uint32_t                           Steps) noexcept
{
    const double ZenithLength = LengthVector(Specification.ZenithDirection);
    const double DirLength    = LengthVector(Direction);
    const double SunLength    = LengthVector(Specification.SolarDirection);
    if (ZenithLength <= 1e-9 || DirLength <= 1e-9 || SunLength <= 1e-9)
    {
        return {};
    }
    const SpatialVector Zenith  = {Specification.ZenithDirection.X / ZenithLength,
                                   Specification.ZenithDirection.Y / ZenithLength,
                                   Specification.ZenithDirection.Z / ZenithLength};
    const SpatialVector UnitDir = {Direction.X / DirLength, Direction.Y / DirLength, Direction.Z / DirLength};
    const SpatialVector UnitSun = {Specification.SolarDirection.X / SunLength,
                                   Specification.SolarDirection.Y / SunLength,
                                   Specification.SolarDirection.Z / SunLength};

    const double LocalAltitudeKm = std::max(0.0, Specification.ObserverAltitudeKm + 1e-3 * DotVector(OriginMeters, Zenith));
    const double RadiusKm        = Specification.Atmosphere.GroundRadiusKm + std::max(LocalAltitudeKm, 1e-3);

    SpatialVector CanonicalObserver{}, CanonicalDir{}, CanonicalSun{};
    BuildCanonicalAtmosphereVectors(Zenith, UnitDir, UnitSun, RadiusKm, CanonicalObserver, CanonicalDir, CanonicalSun);

    const SpectrumRgb Single = SingleScattering(
        Specification.Atmosphere, CanonicalObserver, CanonicalDir, CanonicalSun, Specification.SolarIrradiance, nullptr, Steps);
    const SpectrumRgb Multi = MultipleScatteringApprox(
        Specification.Atmosphere, CanonicalObserver, CanonicalDir, CanonicalSun, Single, Specification.SolarIrradiance);

    const double CloudTransmittance = EvaluateCloudSlabTransmittance(Specification, OriginMeters, UnitDir);
    const double CloudSunlit        = std::max(0.0, DotVector(UnitSun, Zenith));
    const SpectrumRgb SunTop        = TransmittanceToTop(Specification.Atmosphere, RadiusKm, DotVector(UnitSun, Zenith), 32u);
    const double CloudInscatter     = (1.0 - CloudTransmittance) * (0.18 + 0.52 * CloudSunlit) / Pi;

    const SpectrumRgb ClearSky = {
        Single.R + Specification.MultipleScatterScale * Multi.R,
        Single.G + Specification.MultipleScatterScale * Multi.G,
        Single.B + Specification.MultipleScatterScale * Multi.B,
    };
    return {
        ClearSky.R * CloudTransmittance + Specification.SolarIrradiance.R * SunTop.R * CloudInscatter,
        ClearSky.G * CloudTransmittance + Specification.SolarIrradiance.G * SunTop.G * CloudInscatter,
        ClearSky.B * CloudTransmittance + Specification.SolarIrradiance.B * SunTop.B * CloudInscatter,
    };
}

SpectrumRgb EvaluateSolarDiscLimbRadiance(const SkyRadianceSpecification& Specification,
                                          SpatialVector                           OriginMeters,
                                          SpatialVector                           Direction,
                                          std::uint32_t                           Steps) noexcept
{
    const double ZenithLength = LengthVector(Specification.ZenithDirection);
    const double DirLength    = LengthVector(Direction);
    const double SunLength    = LengthVector(Specification.SolarDirection);
    if (ZenithLength <= 1e-9 || DirLength <= 1e-9 || SunLength <= 1e-9)
    {
        return {};
    }
    const SpatialVector Zenith  = {Specification.ZenithDirection.X / ZenithLength,
                                   Specification.ZenithDirection.Y / ZenithLength,
                                   Specification.ZenithDirection.Z / ZenithLength};
    const SpatialVector UnitDir = {Direction.X / DirLength, Direction.Y / DirLength, Direction.Z / DirLength};
    const SpatialVector UnitSun = {Specification.SolarDirection.X / SunLength,
                                   Specification.SolarDirection.Y / SunLength,
                                   Specification.SolarDirection.Z / SunLength};

    const double CosEdge  = std::cos(Specification.SolarAngularRadius);
    const double CosAngle = DotVector(UnitDir, UnitSun);
    if (CosAngle < CosEdge)
    {
        return {};
    }
    const double CosZenith = DotVector(UnitDir, Zenith);
    if (CosZenith <= -0.02)
    {
        return {};
    }

    const double OneMinusEdge = std::max(1.0 - CosEdge, 1e-12);
    const double CapFraction  = std::clamp((CosAngle - CosEdge) / OneMinusEdge, 0.0, 1.0);
    const double MuLimb       = std::sqrt(CapFraction);
    const double OneMinusMu   = 1.0 - MuLimb;
    const double LimbProfile  = std::max(
        0.0, 1.0 - Specification.LimbDarkeningU1 * OneMinusMu - Specification.LimbDarkeningU2 * OneMinusMu * OneMinusMu);
    const double MeanLimb     = std::max(1e-6, 1.0 - Specification.LimbDarkeningU1 / 3.0 - Specification.LimbDarkeningU2 / 6.0);
    const double SolidAngle   = 2.0 * Pi * OneMinusEdge;
    const double NormalizedDisc = (LimbProfile / MeanLimb) / SolidAngle;

    const double LocalAltitudeKm = std::max(0.0, Specification.ObserverAltitudeKm + 1e-3 * DotVector(OriginMeters, Zenith));
    const double RadiusKm        = Specification.Atmosphere.GroundRadiusKm + std::max(LocalAltitudeKm, 1e-3);
    const SpectrumRgb AtmosphericTransmittance = TransmittanceToTop(Specification.Atmosphere, RadiusKm, CosZenith, Steps);
    const double CloudTransmittance = EvaluateCloudSlabTransmittance(Specification, OriginMeters, UnitDir);
    const double Scale = NormalizedDisc * CloudTransmittance;

    return {
        Specification.SolarIrradiance.R * AtmosphericTransmittance.R * Scale,
        Specification.SolarIrradiance.G * AtmosphericTransmittance.G * Scale,
        Specification.SolarIrradiance.B * AtmosphericTransmittance.B * Scale,
    };
}

SpectrumRgb EvaluateSkyTotalRadiance(const SkyRadianceSpecification& Specification,
                                          SpatialVector                           OriginMeters,
                                          SpatialVector                           Direction,
                                          std::uint32_t                           Steps) noexcept
{
    const SpectrumRgb Sky  = EvaluateSkyContinuumRadiance(Specification, OriginMeters, Direction, Steps);
    const SpectrumRgb Disc = EvaluateSolarDiscLimbRadiance(Specification, OriginMeters, Direction, Steps + 16u);
    return {Sky.R + Disc.R, Sky.G + Disc.G, Sky.B + Disc.B};
}

SpectrumRgb IntegrateSolarDiscIrradiance(const SkyRadianceSpecification& Specification,
                                         SpatialVector                           OriginMeters,
                                         SpatialVector                           SurfaceNormal,
                                         std::uint32_t                           RadialRings,
                                         std::uint32_t                           AzimuthSectors) noexcept
{
    const double NormalLength = LengthVector(SurfaceNormal);
    const double SunLength    = LengthVector(Specification.SolarDirection);
    if (NormalLength <= 1e-9 || SunLength <= 1e-9 || RadialRings == 0 || AzimuthSectors == 0)
    {
        return {};
    }
    const SpatialVector Normal  = {SurfaceNormal.X / NormalLength, SurfaceNormal.Y / NormalLength, SurfaceNormal.Z / NormalLength};
    const SpatialVector UnitSun = {Specification.SolarDirection.X / SunLength,
                                   Specification.SolarDirection.Y / SunLength,
                                   Specification.SolarDirection.Z / SunLength};
    SpatialVector Tangent{}, Bitangent{};
    BuildOrthonormalFrame(UnitSun, Tangent, Bitangent);

    const double CosEdge      = std::cos(Specification.SolarAngularRadius);
    const double OneMinusEdge = std::max(1.0 - CosEdge, 1e-12);
    const double CellSolidAngle = (2.0 * Pi * OneMinusEdge) /
                                  static_cast<double>(RadialRings * AzimuthSectors);

    SpectrumRgb Sum{};
    for (std::uint32_t Ring = 0; Ring < RadialRings; ++Ring)
    {
        const double CapU     = (static_cast<double>(Ring) + 0.5) / static_cast<double>(RadialRings);
        const double CosTheta = CosEdge + CapU * OneMinusEdge;
        const double SinTheta = std::sqrt(std::max(0.0, 1.0 - CosTheta * CosTheta));
        for (std::uint32_t Sector = 0; Sector < AzimuthSectors; ++Sector)
        {
            const double Phi = 2.0 * Pi * (static_cast<double>(Sector) + 0.5) / static_cast<double>(AzimuthSectors);
            const double CosPhi = std::cos(Phi);
            const double SinPhi = std::sin(Phi);
            const SpatialVector Omega = {
                UnitSun.X * CosTheta + (Tangent.X * CosPhi + Bitangent.X * SinPhi) * SinTheta,
                UnitSun.Y * CosTheta + (Tangent.Y * CosPhi + Bitangent.Y * SinPhi) * SinTheta,
                UnitSun.Z * CosTheta + (Tangent.Z * CosPhi + Bitangent.Z * SinPhi) * SinTheta,
            };
            const double CosSurface = std::max(0.0, DotVector(Normal, Omega));
            if (CosSurface <= 0.0)
            {
                continue;
            }
            const SpectrumRgb Disc = EvaluateSolarDiscLimbRadiance(Specification, OriginMeters, Omega, 48u);
            Sum.R += Disc.R * CosSurface * CellSolidAngle;
            Sum.G += Disc.G * CosSurface * CellSolidAngle;
            Sum.B += Disc.B * CosSurface * CellSolidAngle;
        }
    }
    return Sum;
}

} // namespace Frontier
