/*==========================================================================================================================================
                                                  PATHREPLAYRESERVOIR.SLANG
==========================================================================================================================================*/
// 🧩 Reservoir sampling of replayable diffuse or rough-opaque random sequences in a common positive-support domain.
// 📝 Every reused sequence is fully retraced in the current scene via ordered/legacy software BVH or VK_KHR_ray_query.
#include "LightInfluence.slang"
float2 EncodeReplaySeed(uint Seed) { return float2(float(Seed & 65535u), float(Seed >> 16u)); }
uint DecodeReplaySeed(float2 Packed) { return uint(Packed.x) | (uint(Packed.y) << 16u); }
// 📝 Keep float-to-int conversion defined even for extreme or non-finite reprojected coordinates.
bool ReplayMotionConvertible(float2 Pixel)
{
    return isfinite(Pixel.x) && isfinite(Pixel.y) && abs(Pixel.x) < 1073741824.0 && abs(Pixel.y) < 1073741824.0;
}
float3 ReplayDirection(float3 Normal, inout uint Bits)
{
    float Radius = sqrt(RandomUnit(Bits)), Azimuth = 6.283185307179586 * RandomUnit(Bits);
    float3 Tangent = Unit(cross(abs(Normal.z) < .999 ? float3(0,0,1) : float3(0,1,0), Normal));
    float3 Bitangent = cross(Normal, Tangent);
    return Unit(Tangent * (Radius * cos(Azimuth)) + Bitangent * (Radius * sin(Azimuth)) +
                Normal * sqrt(max(0, 1 - Radius * Radius)));
}
// 📝 The GGX NDF samples all microfacet normals, including ones whose reflections leave the upper hemisphere.
//    Such draws are zero-contribution events, not resampled. Cosine retains support over the whole hemisphere.
float ReplayImportancePdf(SurfacePoint Receiver, float3 Direction)
{
    float3 N = Unit(Receiver.NormalRoughness.xyz), V = Unit(Receiver.ViewMetallic.xyz);
    float NL = max(0, dot(N, Direction));
    if (NL <= 0) return 0;
    float3 H = Unit(V + Direction);
    float NH = max(0, dot(N, H)), VH = max(0, dot(V, H));
    float Ggx = VH > 0 ? EvaluateGgxDistribution(NH, Receiver.NormalRoughness.w) * NH / (4 * VH) : 0;
    return .5 * (NL / 3.141592653589793 + Ggx);
}
bool ReplayImportanceDirection(SurfacePoint Receiver, inout uint Bits, out float3 Direction, out float Pdf)
{
    float3 N = Unit(Receiver.NormalRoughness.xyz), V = Unit(Receiver.ViewMetallic.xyz);
    Direction = 0;
    Pdf = 0;
    if (RandomUnit(Bits) < .5)
        Direction = ReplayDirection(N, Bits);
    else
    {
        float U = RandomUnit(Bits), Azimuth = 6.283185307179586 * RandomUnit(Bits);
        float Roughness = Receiver.NormalRoughness.w, α = Roughness * Roughness, α2 = α * α;
        float Cosine = sqrt((1 - U) / (1 + (α2 - 1) * U));
        float Sine = sqrt(max(0, 1 - Cosine * Cosine));
        float3 Tangent = Unit(cross(abs(N.z) < .999 ? float3(0,0,1) : float3(0,1,0), N));
        float3 Half = Unit(Tangent * (Sine * cos(Azimuth)) + cross(N, Tangent) * (Sine * sin(Azimuth)) + N * Cosine);
        float ViewHalf = dot(V, Half);
        if (ViewHalf <= 0) return false;
        Direction = Unit(2 * ViewHalf * Half - V);
        if (dot(N, Direction) <= 0) return false;
    }
    Pdf = ReplayImportancePdf(Receiver, Direction);
    return Pdf > 0;
}
// 📝 Evaluate multi-strata PBR mixture density (or SampleGgx direction when SampleMode == true) using pure scalar
//    accumulators over Angles[] so SPIR-V compilers never emit dynamic local-array gather/scatter cascades.
bool EvaluateOrSampleReplayPbrLobes(SurfacePoint Receiver, bool SampleMode, float Selector, float U1, float U2,
                                    inout float3 Direction, out float Pdf)
{
    Pdf = 0.0;
    float3 N = Unit(Receiver.NormalRoughness.xyz), V = Unit(Receiver.ViewMetallic.xyz);
    float NV = saturate(dot(N, V));
    if (NV <= 0.0) return false;
    uint Address = MaterialAddress(Receiver);
    uint AuthoredCount = Address > 0u ? min(uint(Angles[Address - 1u]), 8u) : 0u;
    float DiffuseWeight = 0.5;
    float SingleRough = clamp(Receiver.NormalRoughness.w, 0.04, 1.0);
    float SpecSum = 0.0;

    if (AuthoredCount <= 1u)
    {
        float Ior = max(Receiver.AlbedoIor.w, 1.0), Ratio = (Ior - 1.0) / (Ior + 1.0);
        float Metallic = saturate(Receiver.ViewMetallic.w);
        float Dielectric = Ratio * Ratio * saturate(Receiver.ResidualSpecular.w) * 2.0;
        float3 BaseAlbedo = clamp(Receiver.AlbedoIor.xyz, 0.0, 1.0);
        float3 F0 = lerp(float3(Dielectric), BaseAlbedo, Metallic);
        float3 Fresnel = F0 + (1.0 - F0) * pow(1.0 - NV, 5.0);
        float SpecEnergy = max(Power(Fresnel), 0.02);
        float DiffEnergy = (1.0 - Metallic) * Power(BaseAlbedo) * max(0.0, 1.0 - Power(Fresnel));
        if (AuthoredCount == 1u)
        {
            uint SheenBase = (Address - 1u) + 24u;
            float SheenAlpha = saturate(Angles[SheenBase + 3u]);
            if (SheenAlpha > 0.0)
            {
                float3 SheenRgb = saturate(float3(Angles[SheenBase], Angles[SheenBase + 1u], Angles[SheenBase + 2u]));
                DiffEnergy += SheenAlpha * Power(SheenRgb);
            }
        }
        float SpecWeight = clamp(SpecEnergy / (SpecEnergy + DiffEnergy + 1e-4), 0.15, 0.90);
        DiffuseWeight = 1.0 - SpecWeight;
        SpecSum = SpecWeight;
    }
    else
    {
        uint BaseOffset = Address - 1u;
        float Transmission = 1.0, DiffAccum = 0.0;
        [loop]
        for (int Layer = int(AuthoredCount) - 1; Layer >= 0; --Layer)
        {
            uint P = BaseOffset + 8u + uint(Layer) * 24u;
            float3 Albedo = Layer == 0
                ? clamp(Receiver.AlbedoIor.xyz, 0.0, 1.0)
                : saturate(float3(Angles[P], Angles[P + 1u], Angles[P + 2u]));
            float Metallic = saturate(Layer == 0 ? Receiver.ViewMetallic.w : Angles[P + 4u]);
            float Ior = max(Angles[P + 5u], 1.0), R0 = (Ior - 1.0) / (Ior + 1.0);
            R0 *= R0;
            float Coverage = saturate(Angles[P + 6u]);
            float3 F0 = lerp(float3(R0), Albedo, Metallic);
            float FresnelPower = Power(F0 + (1.0 - F0) * pow(1.0 - NV, 5.0));
            if (uint(Angles[P + 12u]) == 1u)
            {
                SpecSum += Transmission * Coverage * max(FresnelPower, 0.22);
                Transmission *= max(0.05, 1.0 - Coverage * FresnelPower);
            }
            else
            {
                SpecSum += Transmission * Coverage * max(FresnelPower, 0.04);
                float SheenAlpha = saturate(Angles[P + 19u]);
                float3 SheenRgb = saturate(float3(Angles[P + 16u], Angles[P + 17u], Angles[P + 18u]));
                DiffAccum += Transmission * Coverage *
                    ((1.0 - Metallic) * Power(Albedo) * max(0.0, 1.0 - FresnelPower) +
                     SheenAlpha * Power(SheenRgb));
                Transmission *= max(0.0, 1.0 - Coverage);
            }
        }
        float DiffBudget = max(DiffAccum, 0.08);
        DiffuseWeight = clamp(DiffBudget / (SpecSum + DiffBudget + 1e-6), 0.10, 0.80);
    }

    // 📝 Normalize positive lobe weights by their actual sum. Below 1e-20, bound the reciprocal by using
    //     only the full-support cosine proposal; the BRDF itself remains unchanged.
    DiffuseWeight = SpecSum < 1e-20 ? 1.0 : DiffuseWeight;
    float SpecScale = (1.0 - DiffuseWeight) / max(SpecSum, 1e-20);

    if (SampleMode)
    {
        float3 Tangent = Unit(cross(abs(N.z) < 0.999 ? float3(0, 0, 1) : float3(0, 1, 0), N));
        float3 Bitangent = cross(N, Tangent);
        float Azimuth = 6.283185307179586 * U2;
        if (Selector < DiffuseWeight)
        {
            float Radius = sqrt(U1);
            Direction = Unit(Tangent * (Radius * cos(Azimuth)) + Bitangent * (Radius * sin(Azimuth)) +
                             N * sqrt(max(0.0, 1.0 - Radius * Radius)));
        }
        else
        {
            float ChosenRoughness = SingleRough;
            if (AuthoredCount > 1u)
            {
                uint BaseOffset = Address - 1u;
                float Transmission = 1.0, Cumulative = DiffuseWeight;
                [loop]
                for (int Layer = int(AuthoredCount) - 1; Layer >= 0; --Layer)
                {
                    uint P = BaseOffset + 8u + uint(Layer) * 24u;
                    float3 Albedo = Layer == 0
                        ? clamp(Receiver.AlbedoIor.xyz, 0.0, 1.0)
                        : saturate(float3(Angles[P], Angles[P + 1u], Angles[P + 2u]));
                    float LayerRough = clamp(Layer == 0 ? Receiver.NormalRoughness.w : Angles[P + 3u], 0.04, 1.0);
                    float Metallic = saturate(Layer == 0 ? Receiver.ViewMetallic.w : Angles[P + 4u]);
                    float Ior = max(Angles[P + 5u], 1.0), R0 = (Ior - 1.0) / (Ior + 1.0);
                    R0 *= R0;
                    float Coverage = saturate(Angles[P + 6u]);
                    float3 F0 = lerp(float3(R0), Albedo, Metallic);
                    float FresnelPower = Power(F0 + (1.0 - F0) * pow(1.0 - NV, 5.0));
                    bool IsCoating = uint(Angles[P + 12u]) == 1u;
                    float LobeWeight = SpecScale * Transmission * Coverage *
                                       max(FresnelPower, IsCoating ? 0.22 : 0.04);
                    Transmission *= IsCoating ? max(0.05, 1.0 - Coverage * FresnelPower) : max(0.0, 1.0 - Coverage);
                    Cumulative += LobeWeight;
                    // 📝 Ignore zero-weight lobes, including exact CDF boundaries and rounding fallback.
                    ChosenRoughness = LobeWeight > 0.0 ? LayerRough : ChosenRoughness;
                    if (Selector < Cumulative) break;
                }
            }
            float Alpha = ChosenRoughness * ChosenRoughness, Alpha2 = Alpha * Alpha;
            float Cosine = sqrt((1.0 - U1) / (1.0 + (Alpha2 - 1.0) * U1));
            float Sine = sqrt(max(0.0, 1.0 - Cosine * Cosine));
            float3 Half = Unit(Tangent * (Sine * cos(Azimuth)) + Bitangent * (Sine * sin(Azimuth)) + N * Cosine);
            float ViewHalf = dot(V, Half);
            if (ViewHalf <= 0.0) return false;
            Direction = Unit(2.0 * ViewHalf * Half - V);
        }
    }

    float NL = max(0.0, dot(N, Direction));
    if (NL <= 0.0) return false;
    float Density = DiffuseWeight * (NL / 3.141592653589793);
    float3 H = Unit(V + Direction);
    float NH = max(0.0, dot(N, H)), VH = max(0.0, dot(V, H));
    if (VH > 0.0)
    {
        if (AuthoredCount <= 1u)
        {
            Density += (1.0 - DiffuseWeight) * (EvaluateGgxDistribution(NH, SingleRough) * NH / (4.0 * VH));
        }
        else
        {
            uint BaseOffset = Address - 1u;
            float Transmission = 1.0;
            [loop]
            for (int Layer = int(AuthoredCount) - 1; Layer >= 0; --Layer)
            {
                uint P = BaseOffset + 8u + uint(Layer) * 24u;
                float3 Albedo = Layer == 0
                    ? clamp(Receiver.AlbedoIor.xyz, 0.0, 1.0)
                    : saturate(float3(Angles[P], Angles[P + 1u], Angles[P + 2u]));
                float LayerRough = clamp(Layer == 0 ? Receiver.NormalRoughness.w : Angles[P + 3u], 0.04, 1.0);
                float Metallic = saturate(Layer == 0 ? Receiver.ViewMetallic.w : Angles[P + 4u]);
                float Ior = max(Angles[P + 5u], 1.0), R0 = (Ior - 1.0) / (Ior + 1.0);
                R0 *= R0;
                float Coverage = saturate(Angles[P + 6u]);
                float3 F0 = lerp(float3(R0), Albedo, Metallic);
                float FresnelPower = Power(F0 + (1.0 - F0) * pow(1.0 - NV, 5.0));
                bool IsCoating = uint(Angles[P + 12u]) == 1u;
                float LobeWeight = SpecScale * Transmission * Coverage *
                                   max(FresnelPower, IsCoating ? 0.22 : 0.04);
                Transmission *= IsCoating ? max(0.05, 1.0 - Coverage * FresnelPower) : max(0.0, 1.0 - Coverage);
                Density += LobeWeight * (EvaluateGgxDistribution(NH, LayerRough) * NH / (4.0 * VH));
            }
        }
    }
    Pdf = Density;
    return Pdf > 0.0;
}
float ReplayActiveImportancePdf(SurfacePoint Receiver, float3 Direction)
{
    if ((Extent.Primary.w & 134217728u) == 0)
        return ReplayImportancePdf(Receiver, Direction);
    float Pdf;
    float3 DirCopy = Direction;
    return EvaluateOrSampleReplayPbrLobes(Receiver, false, 0.0, 0.0, 0.0, DirCopy, Pdf) ? Pdf : 0.0;
}
bool ReplayActiveImportanceDirection(SurfacePoint Receiver, inout uint Bits, out float3 Direction, out float Pdf)
{
    if ((Extent.Primary.w & 134217728u) == 0)
        return ReplayImportanceDirection(Receiver, Bits, Direction, Pdf);
    Direction = 0;
    float Selector = RandomUnit(Bits), U1 = RandomUnit(Bits), U2 = RandomUnit(Bits);
    return EvaluateOrSampleReplayPbrLobes(Receiver, true, Selector, U1, U2, Direction, Pdf);
}
float ReplayMisWeight(float Ratio, bool BsdfSample)
{
    // 📝 A positive infinite BSDF/source density ratio belongs entirely to the BSDF technique.
    //     NaN or negative infinity is invalid and contributes nothing instead of propagating NaNs.
    if (!isfinite(Ratio)) return Ratio > 0.0 ? (BsdfSample ? 1.0 : 0.0) : 0.0;
    if (Ratio <= 0.0) return BsdfSample ? 0.0 : 1.0;
    if ((Extent.Primary.w & 33554432u) == 0)
        return BsdfSample ? (Ratio / (1.0 + Ratio)) : (1.0 / (1.0 + Ratio));
    float Small = Ratio <= 1.0 ? Ratio : (1.0 / Ratio);
    float Squared = Small * Small;
    float Low = Squared / (1.0 + Squared);
    float High = 1.0 / (1.0 + Squared);
    return BsdfSample ? (Ratio <= 1.0 ? Low : High) : (Ratio <= 1.0 ? High : Low);
}
float ReplaySourceMisWeight(float Ratio, float Competitor)
{
    // 📝 An unreachable BSDF source path has density zero, even when Ratio overflowed to infinity.
    return ReplayMisWeight(Competitor > 0.0 ? Ratio * Competitor : 0.0, false);
}
float ReplaySheetTransmissionProbability(float Reflectance)
{
    float SheetReflectance = (2.0 * Reflectance) / (1.0 + Reflectance);
    return 1.0 - clamp(SheetReflectance, 0.08, 0.92);
}
float3 EvaluateThinSheetPaneTransmit(FacetCorners F, float2 Barycentric, float3 Direction,
                                    out float TransmissionProbability)
{
    uint Offset = uint(F.Emissive.w) - 1u;
    float3 PaneNormal =
        Unit(F.NormalA.xyz * (1.0 - Barycentric.x - Barycentric.y) + F.NormalB.xyz * Barycentric.x +
             F.NormalC.xyz * Barycentric.y);
    float Cosine = max(0.05, abs(dot(PaneNormal, Direction)));
    float PaneIor = max(Angles[Offset + 13u], 1.0), R0 = (PaneIor - 1.0) / (PaneIor + 1.0);
    R0 *= R0;
    float Reflectance = R0 + (1.0 - R0) * pow(1.0 - Cosine, 5.0);
    TransmissionProbability = ReplaySheetTransmissionProbability(Reflectance);
    float3 AuthoredSigma = max(0.0, float3(Angles[Offset + 16u], Angles[Offset + 17u], Angles[Offset + 18u]));
    float AuthoredThickness = max(0.0, Angles[Offset + 19u]);
    float3 OpticalDepth = AuthoredThickness > 0.0 ? AuthoredSigma * AuthoredThickness
                                                  : float3(0.8, 0.15, 0.4) * 0.006;
    return ((1.0 - Reflectance) / (1.0 + Reflectance)) * exp(-OpticalDepth / Cosine);
}
// 📝 The direct source proposal analytically crosses panes; its competing BSDF proposal must include
//     the probability of selecting transmission at each pane and enough remaining bounces to reach the source.
float3 ReplaySegmentTransmittance(float3 Origin, float3 Direction, float Distance, uint Endpoint,
                                  out float TransmissionProbability, out uint PaneCount)
{
    TransmissionProbability = 1.0;
    PaneCount = 0u;
    bool AuthoredMaterials = (Extent.Primary.w & 134217728u) != 0;
#ifdef FRONTIER_HARDWARE_RAY_QUERY
    if (Extent.Sampling.z == 0 || Distance <= 0.0) return float3(1.0);
    InterlockedAdd(Counters[2], 1);
    float3 Throughput = 1.0;
    RayDesc Ray;
    Ray.Origin = Origin;
    Ray.Direction = Direction;
    Ray.TMin = AuthoredMaterials ? 0.0001 : 1e-6;
    Ray.TMax = Distance;
    RayQuery<RAY_FLAG_FORCE_NON_OPAQUE> Query;
    Query.TraceRayInline(SceneAcceleration, RAY_FLAG_FORCE_NON_OPAQUE, 0xffu, Ray);
    while (Query.Proceed())
    {
        if (Query.CandidateType() == CANDIDATE_NON_OPAQUE_TRIANGLE)
        {
            uint Index = Query.CandidatePrimitiveIndex();
            float HitT = Query.CandidateTriangleRayT();
            if (Index == Endpoint || HitT <= 0.0 || HitT >= (AuthoredMaterials ? Distance - 1e-4 : Distance)) continue;
            if (!AuthoredMaterials)
            {
                Query.CommitNonOpaqueTriangleHit();
                return 0.0;
            }
            FacetCorners F = Facets[Index];
            uint Address = F.Emissive.w > 0.0 ? uint(F.Emissive.w) : 0u;
            if (Address == 0u || uint(Angles[Address]) != 2u)
            {
                Query.CommitNonOpaqueTriangleHit();
                return 0.0;
            }
            ++PaneCount;
            float PaneProbability;
            Throughput *= EvaluateThinSheetPaneTransmit(F, Query.CandidateTriangleBarycentrics(), Direction,
                                                         PaneProbability);
            TransmissionProbability *= PaneProbability;
        }
    }
    return Query.CommittedStatus() == COMMITTED_TRIANGLE_HIT ? float3(0.0) : Throughput;
#else
    if (Extent.Grid.w == 0 || Distance <= 0.0) return float3(1.0);
    InterlockedAdd(Counters[2], 1);
    float3 Throughput = 1.0;
    bool Ordered = (Extent.Primary.w & 8388608u) != 0;
    float MinT = AuthoredMaterials ? 0.0001 : 0.0;
    float MaxT = AuthoredMaterials ? Distance - 1e-4 : Distance;
    float3 AbsDir = abs(Direction);
    bool PreferLower = AbsDir.x >= AbsDir.y
        ? (AbsDir.x >= AbsDir.z ? Direction.x >= 0.0 : Direction.z >= 0.0)
        : (AbsDir.y >= AbsDir.z ? Direction.y >= 0.0 : Direction.z >= 0.0);
    uint Stack[64], Count = 1;
    Stack[0] = 0;
    uint MaxStack = min(64u, max(1u, Extent.Sampling.w));
    while (Count > 0)
    {
        FacetEnclosure Box = Enclosures[Stack[--Count]];
        ++ReplayThreadBoxTests;
        if (!IntersectsBox(Box, Origin, Direction, Distance)) continue;
        if (Box.Links.z != 0)
        {
            for (uint I = 0; I < Box.Links.y; ++I)
            {
                uint Index = Box.Links.x + I;
                if (Index != Endpoint)
                {
                    float3 Strike;
                    ++ReplayThreadTriTests;
                    if (FacetStrike(Facets[Index], Origin, Direction, MinT, MaxT, Strike))
                    {
                        if (!AuthoredMaterials) return 0.0;
                        FacetCorners F = Facets[Index];
                        uint Address = F.Emissive.w > 0.0 ? uint(F.Emissive.w) : 0u;
                        if (Address == 0u || uint(Angles[Address]) != 2u) return 0.0;
                        ++PaneCount;
                        float PaneProbability;
                        Throughput *= EvaluateThinSheetPaneTransmit(F, Strike.yz, Direction, PaneProbability);
                        TransmissionProbability *= PaneProbability;
                    }
                }
            }
        }
        else
        {
            if (Count + 2 > MaxStack)
            {
                InterlockedAdd(Counters[3], 1);
                // 📝 The fallback visits all facets, including any already visited: discard partial pane products.
                Throughput = 1.0;
                TransmissionProbability = 1.0;
                PaneCount = 0u;
                for (uint I = 0; I < Extent.Sampling.z; ++I)
                {
                    if (I != Endpoint)
                    {
                        float3 Strike;
                        ++ReplayThreadTriTests;
                        if (FacetStrike(Facets[I], Origin, Direction, MinT, MaxT, Strike))
                        {
                            if (!AuthoredMaterials) return 0.0;
                            FacetCorners F = Facets[I];
                            uint Address = F.Emissive.w > 0.0 ? uint(F.Emissive.w) : 0u;
                            if (Address == 0u || uint(Angles[Address]) != 2u) return 0.0;
                            ++PaneCount;
                            float PaneProbability;
                            Throughput *= EvaluateThinSheetPaneTransmit(F, Strike.yz, Direction, PaneProbability);
                            TransmissionProbability *= PaneProbability;
                        }
                    }
                }
                return Throughput;
            }
            if (Ordered)
            {
                Stack[Count++] = PreferLower ? Box.Links.y : Box.Links.x;
                Stack[Count++] = PreferLower ? Box.Links.x : Box.Links.y;
            }
            else
            {
                Stack[Count++] = Box.Links.x;
                Stack[Count++] = Box.Links.y;
            }
        }
    }
    return Throughput;
#endif
}
// 📝 A half-uniform mixture bounds each emitter's selection probability below by 0.5 / FacetCount.
float ReplayFacetProbability(uint Entry, uint FacetCount)
{
    float Probability = Angles[Entry + 1];
    if ((Extent.Primary.w & 16384u) != 0)
        Probability = .5 * Probability + .5 / float(FacetCount);
    return Probability;
}

// 📝 The Engine CDF is ordered by facet index. Return zero for a source outside that distribution.
float ReplayFacetInverseProbability(uint FacetIndex)
{
    uint FacetCount = Extent.Reconstruction.z;
    if ((Extent.Primary.w & 8192u) == 0) return float(FacetCount);
    uint Offset = asuint(Extent.Maximum.y), Low = 0, High = FacetCount;
    while (Low < High)
    {
        uint Mid = (Low + High) / 2;
        if (uint(Angles[Offset + 1 + Mid * 4]) < FacetIndex) Low = Mid + 1;
        else High = Mid;
    }
    if (Low >= FacetCount || uint(Angles[Offset + 1 + Low * 4]) != FacetIndex) return 0;
    return 1 / ReplayFacetProbability(Offset + 1 + Low * 4, FacetCount);
}

float ReplayClusteredFacetInverseProbability(float3 SampleOrigin, uint FacetIndex)
{
    float GlobalInverse = ReplayFacetInverseProbability(FacetIndex);
    float Result        = GlobalInverse;
    if (GlobalInverse > 0.0 && PhotometricClustersEnabled())
    {
        if ((Extent.Primary.w & 8192u) != 0u)
        {
            uint SlotsPerCell       = uint(PhotometricHeaderWord(3u).x);
            uint ClusterTableOffset = uint(PhotometricHeaderWord(3u).y);
            if (ClusterTableOffset != 0u && SlotsPerCell > 0u)
            {
                uint CellIndex = 0u;
                if (LocatePhotometricClusterCell(SampleOrigin, CellIndex))
                {
                    uint CellBase   = ClusterTableOffset + CellIndex * (1u + 5u * SlotsPerCell);
                    uint LocalCount = uint(Angles[CellBase]);
                    if (LocalCount > 0u)
                    {
                        float LocalProb  = EvaluateClusteredLocalFacetProbability(CellBase, LocalCount, FacetIndex);
                        float GlobalProb = 1.0 / GlobalInverse;
                        float GlobalMix  = PhotometricHeaderWord(2u).w;
                        float MixedProb  = (1.0 - GlobalMix) * LocalProb + GlobalMix * GlobalProb;
                        Result           = 1.0 / max(MixedProb, 1e-20);
                    }
                }
            }
        }
        bool AnalyticMultiplexed = (Extent.Primary.w & 128u) != 0u && Extent.Reconstruction.z > 0u &&
                                   PhotometricHeaderWord(3u).w > 0.5 && uint(PhotometricHeaderWord(0u).w) > 0u;
        if (AnalyticMultiplexed)
        {
            Result *= 2.0;
        }
    }
    return Result;
}

// 📝 Unified loop-free direct emitter / clustered analytic luminaire / spherical solar-cap sampler.
bool SampleReplayDirectCandidate(uint SourceChannel, SurfacePoint Receiver, float3 Origin, uint RemainingBounces,
                                 inout uint Bits, out float3 OutDirection, out float3 OutFactor)
{
    OutDirection = 0;
    OutFactor = 0;
    float3 N = Unit(Receiver.NormalRoughness.xyz);
    float3 Direction = 0;
    float3 EmittedRadiance = 0;
    float SolidAngleMeasure = 0;
    float MaxDistance = 1e20;
    uint IgnoreFacet = 0xffffffffu;
    bool PunctualDeltaSource = false;

    if (SourceChannel == 0u)
    {
        uint FacetCount     = Extent.Reconstruction.z;
        bool FacetsActive   = (Extent.Primary.w & 128u) != 0u && FacetCount > 0u;
        bool AnalyticActive = PhotometricClustersEnabled() && PhotometricHeaderWord(3u).w > 0.5 &&
                              uint(PhotometricHeaderWord(0u).w) > 0u;
        if (!FacetsActive && !AnalyticActive) return false;
        bool PickAnalytic = AnalyticActive && (!FacetsActive || RandomUnit(Bits) < 0.5);
        if (PickAnalytic)
        {
            uint AnalyticCount = uint(PhotometricHeaderWord(0u).w);
            uint CellCapacity  = uint(PhotometricHeaderWord(1u).w);
            if (CellCapacity == 0u) return false;
            uint CellIndex  = 0u;
            bool InsideGrid = LocatePhotometricClusterCell(Receiver.PositionHit.xyz, CellIndex);
            uint CellFirst  = CellIndex * (CellCapacity + 1u);
            bool WholeList  = !InsideGrid;
            uint IterCount  = AnalyticCount;
            if (!WholeList)
            {
                IterCount = Cells[CellFirst];
                if (IterCount > CellCapacity)
                {
                    WholeList = true;
                    IterCount = AnalyticCount;
                }
            }
            if (WholeList) InterlockedAdd(Counters[1], 1u);
            if (IterCount == 0u) return false;
            InterlockedAdd(Counters[0], 1u);

            uint   PickSlot   = NextRandom(Bits) % IterCount;
            uint   LightIdx   = WholeList ? PickSlot : Cells[CellFirst + 1u + PickSlot];
            float  ChosenDist = 1e20;
            EmittedRadiance   = EvaluateAnalyticArrivalLoopFree(Lights[LightIdx], Receiver.PositionHit.xyz,
                                                                Direction, ChosenDist);
            if (all(EmittedRadiance <= 0.0)) return false;
            SolidAngleMeasure   = float(IterCount) * (FacetsActive ? 2.0 : 1.0);
            MaxDistance         = ChosenDist < 1e20 ? max(ChosenDist - 0.003, 0.0) : 1e20;
            PunctualDeltaSource = true;
        }
        else
        {
            uint Offset = asuint(Extent.Maximum.y), FacetIndex = 0u;
            float InverseProbability = 0.0;
            if ((Extent.Primary.w & 8192u) != 0)
            {
                bool SampledFromCluster = false;
                if (PhotometricClustersEnabled())
                {
                    uint SlotsPerCell       = uint(PhotometricHeaderWord(3u).x);
                    uint ClusterTableOffset = uint(PhotometricHeaderWord(3u).y);
                    if (ClusterTableOffset != 0u && SlotsPerCell > 0u)
                    {
                        uint CellIndex = 0u;
                        if (LocatePhotometricClusterCell(Origin, CellIndex))
                        {
                            uint CellBase   = ClusterTableOffset + CellIndex * (1u + 5u * SlotsPerCell);
                            uint LocalCount = uint(Angles[CellBase]);
                            if (LocalCount > 0u && RandomUnit(Bits) >= PhotometricHeaderWord(2u).w)
                            {
                                uint AliasStart    = CellBase + 1u + 2u * SlotsPerCell;
                                uint AliasSlot     = NextRandom(Bits) % LocalCount;
                                uint BaseAddr      = AliasStart + 3u * AliasSlot;
                                FacetIndex         = RandomUnit(Bits) < Angles[BaseAddr + 1u]
                                                   ? uint(Angles[BaseAddr])
                                                   : uint(Angles[BaseAddr + 2u]);
                                SampledFromCluster = true;
                            }
                        }
                    }
                }
                if (!SampledFromCluster)
                {
                    bool UniformDraw = false;
                    if ((Extent.Primary.w & 16384u) != 0) UniformDraw = RandomUnit(Bits) < .5;
                    uint Selected;
                    if (UniformDraw)
                    {
                        uint Threshold = (0u - FacetCount) % FacetCount, SampleBits;
                        do { SampleBits = NextRandom(Bits); } while (SampleBits < Threshold);
                        Selected = SampleBits % FacetCount;
                    }
                    else
                    {
                        float Draw = RandomUnit(Bits);
                        uint Low = 0, High = FacetCount - 1;
                        while (Low < High)
                        {
                            uint Mid = (Low + High) / 2;
                            if (Draw < Angles[Offset + 1 + Mid * 4 + 3]) High = Mid;
                            else Low = Mid + 1;
                        }
                        Selected = Low;
                    }
                    uint Entry = Offset + 1 + Selected * 4;
                    FacetIndex = uint(Angles[Entry]);
                }
                InverseProbability = ReplayClusteredFacetInverseProbability(Origin, FacetIndex);
            }
            else
            {
                // 📝 Rejection removes modulo bias for a uniformly distributed 32-bit draw.
                uint Threshold = (0u - FacetCount) % FacetCount, SampleBits;
                do { SampleBits = NextRandom(Bits); } while (SampleBits < Threshold);
                FacetIndex = uint(Angles[Offset + SampleBits % FacetCount]);
                InverseProbability = float(FacetCount) * (AnalyticActive ? 2.0 : 1.0);
            }
            FacetCorners F = Facets[FacetIndex];
            float3 EdgeA = F.B.xyz - F.A.xyz, EdgeB = F.C.xyz - F.A.xyz;
            float3 AreaNormal = cross(EdgeA, EdgeB);
            float DoubleArea = length(AreaNormal);
            float Root = sqrt(RandomUnit(Bits)), Along = RandomUnit(Bits);
            float3 Point = F.A.xyz * (1 - Root) + F.B.xyz * (Root * (1 - Along)) + F.C.xyz * (Root * Along);
            float3 Delta = Point - Origin;
            float DistanceSquared = dot(Delta, Delta);
            if (DoubleArea <= 0 || DistanceSquared <= 1e-10) return false;
            float Distance = sqrt(DistanceSquared);
            Direction = Delta / Distance;
            float SourceCosine = abs(dot(AreaNormal / DoubleArea, Direction));
            if (SourceCosine <= 0) return false;
            float PhotometricGain = EvaluateFacetPhotometricFactor(FacetIndex, -Direction);
            if (PhotometricGain <= 0.0) return false;
            SolidAngleMeasure = SourceCosine * (.5 * DoubleArea) * InverseProbability / DistanceSquared;
            EmittedRadiance = max(F.Emissive.xyz, 0) * PhotometricGain;
            MaxDistance = Distance;
            IgnoreFacet = FacetIndex;
        }
    }
    else
    {
        if (!SkyRadianceActive()) return false;
        float CapU = RandomUnit(Bits);
        float CapPhi = 6.283185307179586 * RandomUnit(Bits);
        float OneMinusEdge = 0.0;
        float SolidAngle = SolarDiscSolidAngle(OneMinusEdge);
        float OneMinusCos = CapU * OneMinusEdge;
        float CosTheta = 1.0 - OneMinusCos;
        float SinTheta = sqrt(max(0.0, OneMinusCos * (2.0 - OneMinusCos)));

        float3 UnitSun = Unit(SolarSkyPayloadWord(0u).xyz);
        float3 Tangent, Bitangent;
        BuildSolarSkyBasis(UnitSun, Tangent, Bitangent);
        Direction = Unit(UnitSun * CosTheta + (Tangent * cos(CapPhi) + Bitangent * sin(CapPhi)) * SinTheta);

        float DiscPdf = 0.0;
        EmittedRadiance = EvaluateSolarDiscRadiance(Receiver.PositionHit.xyz, Direction, DiscPdf);
        if (DiscPdf <= 0.0 || all(EmittedRadiance <= 0.0)) return false;
        SolidAngleMeasure = SolidAngle;
    }

    float DirectionCosine = max(0.0, dot(N, Direction));
    if (DirectionCosine <= 0.0) return false;

    float TransmissionProbability;
    uint PaneCount;
    float3 Transmittance = ReplaySegmentTransmittance(Origin, Direction, MaxDistance, IgnoreFacet,
                                                      TransmissionProbability, PaneCount);
    if (all(Transmittance <= 0.0)) return false;

    float MisWeight = 1.0;
    if (!PunctualDeltaSource && (Extent.Primary.w & 1024u) != 0)
    {
        float Competitor = PaneCount < RemainingBounces ? TransmissionProbability : 0.0;
        float BsdfPdf = (Extent.Primary.w & 4096u) != 0
            ? ReplayActiveImportancePdf(Receiver, Direction)
            : (DirectionCosine / 3.141592653589793);
        MisWeight = ReplaySourceMisWeight(BsdfPdf * SolidAngleMeasure, Competitor);
    }
    OutDirection = Direction;
    OutFactor = Transmittance * EmittedRadiance * (DirectionCosine * SolidAngleMeasure * MisWeight);
    return true;
}

struct ReplaySecondaryVertex
{
    float3 Position;
    float3 Normal;
    float3 Outgoing;
    float PrimaryPdf;
    uint Mode;
};

uint EncodeOctahedralNormal11(float3 Normal)
{
    float3 UnitN = Unit(Normal);
    float InvL1 = 1.0 / max(abs(UnitN.x) + abs(UnitN.y) + abs(UnitN.z), 1e-12);
    float2 Oct = UnitN.xy * InvL1;
    float2 Wrapped = (1.0 - abs(Oct.yx)) * select(Oct >= 0.0, float2(1.0, 1.0), float2(-1.0, -1.0));
    Oct = select((UnitN.z < 0.0).xx, Wrapped, Oct);
    float2 Unorm = saturate(Oct * 0.5 + 0.5);
    uint Qu = uint(floor(Unorm.x * 2046.0 + 0.5));
    uint Qv = uint(floor(Unorm.y * 2046.0 + 0.5));
    return 2u + Qu + (Qv << 11u);
}

float3 DecodeOctahedralNormal11(uint Code)
{
    uint Payload = max(Code, 2u) - 2u;
    uint Qu = Payload & 2047u;
    uint Qv = (Payload >> 11u) & 2047u;
    float2 Oct = float2(float(Qu), float(Qv)) * (2.0 / 2046.0) - 1.0;
    float Nz = 1.0 - abs(Oct.x) - abs(Oct.y);
    float2 Wrapped = (1.0 - abs(Oct.yx)) * select(Oct >= 0.0, float2(1.0, 1.0), float2(-1.0, -1.0));
    float2 Nxy = select((Nz < 0.0).xx, Wrapped, Oct);
    return Unit(float3(Nxy.x, Nxy.y, Nz));
}

void WriteReplaySecondaryVertex(uint Pixel, ReplaySecondaryVertex Secondary)
{
    bool Valid = (Secondary.Mode != 0u) && (Secondary.PrimaryPdf > 0.0) &&
                 all(isfinite(Secondary.Position)) && all(isfinite(Secondary.Outgoing));
    float PackedNormal = float(EncodeOctahedralNormal11(Secondary.Normal));
    OutputColour[ReplaySlot(21u, Pixel)] = select(Valid.xxxx, float4(Secondary.Position, Secondary.PrimaryPdf), 0.0);
    OutputColour[ReplaySlot(22u, Pixel)] = select(Valid.xxxx, float4(max(Secondary.Outgoing, 0.0), PackedNormal), 0.0);
}

float3 EvaluateReplayPathUnified(SurfacePoint Receiver, uint Seed, bool ReconnectMode, float3 SourceOriginWorld,
                                 ReplaySecondaryVertex ReconnectVertex, out ReplaySecondaryVertex Secondary,
                                 out float ShiftJacobian, out bool ShiftValid)
{
    Secondary = (ReplaySecondaryVertex)0;
    ShiftJacobian = 1.0;
    ShiftValid = !ReconnectMode;
    uint Bits = Seed;
    float3 Normal = Unit(Receiver.NormalRoughness.xyz);
    float3 Origin = Receiver.PositionHit.xyz + Normal * .001;
    float3 Throughput = 1, Radiance = 0;
    bool RoughOpaque = (Extent.Primary.w & 64u) != 0, SampleFacets = (Extent.Primary.w & 128u) != 0;
    bool ImportanceRough = (Extent.Primary.w & 4096u) != 0;
    bool AuthoredMaterials = (Extent.Primary.w & 134217728u) != 0;
    bool SolarEnvironment = SkyRadianceActive();

    float3 ReconnectDir = 0.0;
    float ReconnectMaxDist = 1e30;
    float ReconnectAreaJacobian = 1.0;
    float ReconnectPssJacobian = 1.0;
    bool ReconnectReady = true;
    (void)SourceOriginWorld;
    if (ReconnectMode)
    {
        float3 EvalDelta = ReconnectVertex.Position - Origin;
        float RawDistSq  = dot(EvalDelta, EvalDelta);
        float EvalDistSq = max(RawDistSq, 1e-12);
        float EvalDist   = sqrt(EvalDistSq);
        ReconnectDir     = EvalDelta / EvalDist;
        float SecCosEval = dot(ReconnectVertex.Normal, -ReconnectDir);
        ReconnectMaxDist = max(EvalDist - 0.002, 0.0002);
        ReconnectAreaJacobian = SecCosEval / EvalDistSq;
        ReconnectReady   = (ReconnectVertex.PrimaryPdf > 0.0) && (RawDistSq >= 0.0064) &&
                           (SecCosEval > 0.01) && (dot(Normal, ReconnectDir) > 1e-4);
    }

    // 📝 Retain the most recent non-delta directional proposal across straight sheet transmissions.
    float3 SourceOrigin = 0, SourceDirection = 0;
    float SourcePdf = 0, TransmissionProbability = 1;
    bool SourceProposalAvailable = false, SolarProposalAvailable = false;
    float3 BounceZeroDirect = 0.0, FirstBounceWeight = 0.0;
    bool CandidateSecondarySurface = false;
    SurfacePoint Current = Receiver;
    uint MaxBounces = (ReconnectMode && !ReconnectReady) ? 0u : (ReconnectMode ? 1u : Extent.Primary.z);
    [loop]
    for (uint Bounce = 0; Bounce < MaxBounces; ++Bounce)
    {
        bool ThinSheet = AuthoredMaterials && MaterialAddress(Current) > 0 && MaterialTransport(Current) == 2u;
        float3 NeeDirection = 0, NeeFactor = 0;
        float3 SolarDirection = 0, SolarFactor = 0;
        bool FacetDirectReady = false, SolarDirectReady = false;
        bool DirectChannelZero = SampleFacets || (PhotometricClustersEnabled() && PhotometricHeaderWord(3u).w > 0.5 &&
                                                  uint(PhotometricHeaderWord(0u).w) > 0u);
        if (!ThinSheet)
        {
            [loop]
            for (uint SourceChannel = 0u; SourceChannel < 2u; ++SourceChannel)
            {
                bool Enabled = SourceChannel == 0u ? DirectChannelZero : SolarEnvironment;
                if (Enabled)
                {
                    float3 CandDir = 0, CandFactor = 0;
                    if (SampleReplayDirectCandidate(SourceChannel, Current, Origin, Extent.Primary.z - Bounce, Bits,
                                                    CandDir, CandFactor))
                    {
                        if (SourceChannel == 0u) { FacetDirectReady = true; NeeDirection = CandDir; NeeFactor = CandFactor; }
                        else { SolarDirectReady = true; SolarDirection = CandDir; SolarFactor = CandFactor; }
                    }
                }
            }
        }

        float3 Direction = 0, Strike = 0;
        float BouncePdf = 0.0, BounceScale = 3.141592653589793;
        bool ValidBounce = true;
        if (ThinSheet)
        {
            uint Offset = MaterialAddress(Current) - 1u;
            float3 IncomingDir = -Unit(Current.ViewMetallic.xyz);
            float Cosine = max(0.05, saturate(dot(Normal, -IncomingDir)));
            float PaneIor = max(Angles[Offset + 13u], 1.0), R0 = (PaneIor - 1.0) / (PaneIor + 1.0);
            R0 *= R0;
            float F = R0 + (1.0 - R0) * pow(1.0 - Cosine, 5.0);
            float SheetReflect = (2.0 * F) / (1.0 + F);
            float3 AuthoredSigma = max(0.0, float3(Angles[Offset + 16u], Angles[Offset + 17u], Angles[Offset + 18u]));
            float AuthoredThickness = max(0.0, Angles[Offset + 19u]);
            float3 OpticalDepth = AuthoredThickness > 0.0 ? AuthoredSigma * AuthoredThickness
                                                          : float3(0.8, 0.15, 0.4) * 0.006;
            float3 SheetTransmit = ((1.0 - F) / (1.0 + F)) * exp(-OpticalDepth / Cosine);
            float TransmitProbability = ReplaySheetTransmissionProbability(F);
            float ReflectProb = 1.0 - TransmitProbability;
            float Selector = RandomUnit(Bits);
            (void)RandomUnit(Bits);
            (void)RandomUnit(Bits);
            if (Selector < ReflectProb)
            {
                Direction = Unit(reflect(IncomingDir, Normal));
                Throughput *= SheetReflect / ReflectProb;
                SourceProposalAvailable = false;
                SolarProposalAvailable = false;
            }
            else
            {
                Direction = IncomingDir;
                Throughput *= SheetTransmit / TransmitProbability;
                TransmissionProbability *= TransmitProbability;
            }
            // 📝 Straight transmission stays collinear with the source proposal across sheet offsets.
            Origin = Current.PositionHit.xyz + Direction * 0.002;
        }
        else
        {
            if (ImportanceRough)
            {
                Direction = ReconnectDir;
                if (!AuthoredMaterials)
                {
                    if (ReconnectMode)
                    {
                        BouncePdf = ReplayImportancePdf(Current, Direction);
                        ValidBounce = BouncePdf > 1e-6;
                    }
                    else
                    {
                        ValidBounce = ReplayImportanceDirection(Current, Bits, Direction, BouncePdf);
                    }
                }
                else
                {
                    float Sel = ReconnectMode ? 0.0 : RandomUnit(Bits);
                    float U1  = ReconnectMode ? 0.0 : RandomUnit(Bits);
                    float U2  = ReconnectMode ? 0.0 : RandomUnit(Bits);
                    ValidBounce = EvaluateOrSampleReplayPbrLobes(Current, !ReconnectMode, Sel, U1, U2, Direction, BouncePdf);
                    if (ReconnectMode) ValidBounce = ValidBounce && (BouncePdf > 1e-6);
                }
                if (ValidBounce) BounceScale = max(0.0, dot(Normal, Direction)) / BouncePdf;
            }
            else
            {
                Direction = ReconnectMode ? ReconnectDir : ReplayDirection(Normal, Bits);
                BouncePdf = max(0.0, dot(Normal, Direction)) / 3.141592653589793;
                if (ReconnectMode)
                {
                    ValidBounce = BouncePdf > 1e-6;
                    if (ValidBounce) BounceScale = max(0.0, dot(Normal, Direction)) / BouncePdf;
                }
            }
            if (ReconnectMode && ValidBounce)
            {
                ReconnectPssJacobian = (BouncePdf * ReconnectAreaJacobian) / max(ReconnectVertex.PrimaryPdf, 1e-20);
                ValidBounce = isfinite(ReconnectPssJacobian) &&
                              (ReconnectPssJacobian >= (1.0 / 64.0)) && (ReconnectPssJacobian <= 64.0);
            }

            float3 NeeBrdf = clamp(Current.AlbedoIor.xyz, 0, 1) / 3.141592653589793;
            float3 SolarBrdf = NeeBrdf;
            float3 BounceBrdf = clamp(Current.AlbedoIor.xyz, 0, 1);
            if (RoughOpaque)
            {
                [loop]
                for (uint BrdfSlot = 0u; BrdfSlot < 3u; ++BrdfSlot)
                {
                    bool Active = BrdfSlot == 0u ? FacetDirectReady
                                : (BrdfSlot == 1u ? SolarDirectReady : ValidBounce);
                    if (Active)
                    {
                        float3 EvalDir = BrdfSlot == 0u ? NeeDirection
                                       : (BrdfSlot == 1u ? SolarDirection : Direction);
                        float3 Val = Brdf(Current, EvalDir);
                        if (BrdfSlot == 0u) NeeBrdf = Val;
                        else if (BrdfSlot == 1u) SolarBrdf = Val;
                        else BounceBrdf = BounceScale * Val;
                    }
                }
            }
            float3 DirectTerm = 0.0;
            if (FacetDirectReady) DirectTerm += Throughput * NeeBrdf * NeeFactor;
            if (SolarDirectReady) DirectTerm += Throughput * SolarBrdf * SolarFactor;
            Radiance += DirectTerm;
            if (Bounce == 0u) BounceZeroDirect = DirectTerm;
            if (!ValidBounce)
            {
                if (ReconnectMode) Radiance = 0.0;
                break;
            }
            if (Bounce == 0u) FirstBounceWeight = BounceBrdf;
            Throughput *= BounceBrdf;
            SourceOrigin = Origin;
            SourceDirection = Direction;
            SourcePdf = ImportanceRough ? BouncePdf : max(0.0, dot(Normal, Direction)) / 3.141592653589793;
            TransmissionProbability = 1.0;
            SourceProposalAvailable = SampleFacets && Extent.Reconstruction.z > 0;
            SolarProposalAvailable = SolarEnvironment;
        }
        if (!ReconnectMode && max(Throughput.x, max(Throughput.y, Throughput.z)) <= 0) break;
        if (ReconnectMode) InterlockedAdd(Counters[10], 1);
        else InterlockedAdd(Counters[8], 1);
        uint Index = NearestFacet(Origin, Direction, .0001, ReconnectMode ? ReconnectMaxDist : 1e30, Strike);
        if (ReconnectMode && Index != 0xffffffffu)
        {
            Radiance = 0.0;
            break;
        }
        if (Index == 0xffffffffu)
        {
            if (ReconnectMode)
            {
                Radiance += Throughput * ReconnectVertex.Outgoing;
                ShiftJacobian = ReconnectPssJacobian;
                ShiftValid = ReconnectReady && all(isfinite(Radiance));
                if (!ShiftValid) Radiance = 0.0;
            }
            else if (SolarEnvironment)
            {
                float3 SkyContinuum = EvaluateSolarSkyContinuum(Current.PositionHit.xyz, Direction);
                {
                    float DiscPdf = 0.0;
                    float3 DiscRadiance = EvaluateSolarDiscRadiance(Current.PositionHit.xyz, Direction, DiscPdf);
                    float3 SkyTotal = SkyContinuum;
                    if (DiscPdf > 0.0)
                    {
                        if (!SolarProposalAvailable || (Extent.Primary.w & 256u) != 0)
                            SkyTotal += DiscRadiance;
                        else if ((Extent.Primary.w & 1024u) != 0)
                            SkyTotal += DiscRadiance * ReplayMisWeight((SourcePdf * TransmissionProbability) / DiscPdf, true);
                    }
                    Radiance += Throughput * SkyTotal;
                    if (Bounce == 0u && !ThinSheet && DiscPdf <= 0.0 && SourcePdf > 1e-6)
                    {
                        Secondary.Position = Origin + Direction * 2048.0;
                        Secondary.Normal = -Direction;
                        Secondary.PrimaryPdf = SourcePdf * (1.0 / 4194304.0);
                        Secondary.Outgoing = SkyContinuum;
                        Secondary.Mode = 1u;
                    }
                }
            }
            else
            {
                {
                    float3 EnvRad = max(Extent.Minimum.xyz, 0.0);
                    Radiance += Throughput * EnvRad; // Uniform environment, not an importance map.
                    if (Bounce == 0u && !ThinSheet && SourcePdf > 1e-6)
                    {
                        Secondary.Position = Origin + Direction * 2048.0;
                        Secondary.Normal = -Direction;
                        Secondary.PrimaryPdf = SourcePdf * (1.0 / 4194304.0);
                        Secondary.Outgoing = EnvRad;
                        Secondary.Mode = 1u;
                    }
                }
            }
            break;
        }
        FacetCorners F = Facets[Index];
        float3 FacetEmitted = max(F.Emissive.xyz, 0);
        if (any(FacetEmitted > 0))
            FacetEmitted *= EvaluateFacetPhotometricFactor(Index, -Direction);
        bool HitIsEmissive = any(FacetEmitted > 0);
        bool EmissiveMisWeighted = false;
        if (!SourceProposalAvailable || (Extent.Primary.w & 256u) != 0)
            Radiance += Throughput * FacetEmitted;
        else if (HitIsEmissive)
        {
            float InverseProbability = ReplayClusteredFacetInverseProbability(SourceOrigin, Index);
            if (InverseProbability == 0)
                Radiance += Throughput * FacetEmitted;
            else if ((Extent.Primary.w & 1024u) != 0)
            {
                EmissiveMisWeighted = true;
                float3 AreaNormal = cross(F.B.xyz - F.A.xyz, F.C.xyz - F.A.xyz);
                float DoubleArea = length(AreaNormal);
                float3 LightPosition = Origin + Direction * Strike.x;
                float3 SourceDelta = LightPosition - SourceOrigin;
                float DistanceSquared = ThinSheet ? dot(SourceDelta, SourceDelta) : Strike.x * Strike.x;
                if (DoubleArea > 0 && DistanceSquared > 0)
                {
                    float SourceCosine = abs(dot(AreaNormal / DoubleArea, SourceDirection));
                    float Ratio = SourcePdf * TransmissionProbability * SourceCosine * (.5 * DoubleArea) *
                                  InverseProbability / DistanceSquared;
                    Radiance += Throughput * FacetEmitted * ReplayMisWeight(Ratio, true);
                }
            }
            else EmissiveMisWeighted = true;
        }
        float3 GeometricNormal =
            Unit(F.NormalA.xyz * (1 - Strike.y - Strike.z) + F.NormalB.xyz * Strike.y + F.NormalC.xyz * Strike.z);
        if (dot(GeometricNormal, Direction) > 0) GeometricNormal = -GeometricNormal;
        float3 HitPosition = Origin + Direction * Strike.x;
        Current = (SurfacePoint)0;
        Current.PositionHit = float4(HitPosition, 1);
        Current.NormalRoughness = float4(GeometricNormal, F.AlbedoRoughness.w);
        Current.ViewMetallic = float4(-Direction, F.OpticalToken.x);
        Current.AlbedoIor = float4(F.AlbedoRoughness.xyz, F.OpticalToken.y);
        Current.ResidualSpecular.w = F.OpticalToken.z;
        if (((Extent.Primary.w & 2048u) != 0 || AuthoredMaterials) && F.Emissive.w > 0)
        {
            ApplyRayMaterial(Current, F, Strike.yz);
            if (AuthoredMaterials &&
                (dot(Current.NormalRoughness.xyz, GeometricNormal) < 0.05 ||
                 dot(Current.NormalRoughness.xyz, Current.ViewMetallic.xyz) <= 1e-4))
                Current.NormalRoughness.xyz = GeometricNormal;
        }
        if (Bounce == 0u && !ThinSheet && !EmissiveMisWeighted && SourcePdf > 1e-6 && Strike.x >= 0.08)
        {
            bool SecondaryThinSheet = AuthoredMaterials && MaterialAddress(Current) > 0 &&
                                      MaterialTransport(Current) == 2u;
            bool SecondaryViewIndependent = !RoughOpaque || Extent.Primary.z == 1u ||
                                            (Current.NormalRoughness.w >= 0.35 && Current.ViewMetallic.w < 0.25);
            float SecCosSrc = dot(GeometricNormal, -Direction);
            if (!SecondaryThinSheet && SecondaryViewIndependent && SecCosSrc > 0.015)
            {
                Secondary.Position = HitPosition + GeometricNormal * 0.0015;
                Secondary.Normal = GeometricNormal;
                Secondary.PrimaryPdf = SourcePdf * (SecCosSrc / max(Strike.x * Strike.x, 0.0064));
                CandidateSecondarySurface = true;
            }
        }
        Normal = Unit(Current.NormalRoughness.xyz);
        Origin = HitPosition + GeometricNormal * .001;
    }
    if (CandidateSecondarySurface && all(FirstBounceWeight > 1e-4))
    {
        float3 IndirectTotal = max(Radiance - BounceZeroDirect, 0.0);
        Secondary.Outgoing = IndirectTotal / FirstBounceWeight;
        Secondary.Mode = 1u;
    }
    return Radiance;
}

float3 EvaluateReplayPathWithSecondary(SurfacePoint Receiver, uint Seed, out ReplaySecondaryVertex Secondary)
{
    float UnusedJacobian;
    bool UnusedValid;
    return EvaluateReplayPathUnified(Receiver, Seed, false, 0.0, (ReplaySecondaryVertex)0,
                                     Secondary, UnusedJacobian, UnusedValid);
}

float3 EvaluateReplayPath(SurfacePoint Receiver, uint Seed)
{
    ReplaySecondaryVertex UnusedSecondary;
    float UnusedJacobian;
    bool UnusedValid;
    return EvaluateReplayPathUnified(Receiver, Seed, false, 0.0, (ReplaySecondaryVertex)0,
                                     UnusedSecondary, UnusedJacobian, UnusedValid);
}

bool PrimarySurfaceReconnectable(SurfacePoint R)
{
    if (R.PositionHit.w == 0 || R.MotionPositionToken.w <= 0) return false;
    bool RoughOpaque = (Extent.Primary.w & 64u) != 0;
    bool AuthoredMaterials = (Extent.Primary.w & 134217728u) != 0;
    if (AuthoredMaterials && MaterialAddress(R) > 0u && MaterialTransport(R) == 2u) return false;
    if (MaterialAddress(R) != 0u) return false; float Roughness = RoughOpaque ? R.NormalRoughness.w : 1.0;
    return Roughness >= 0.25 && all(R.AlbedoIor.xyz > 1e-3);
}

// 📝 Overflow-safe Defensive Canonical Pairwise MIS share (1 - delta) * A^beta / ((B/K)^beta + A^beta)
//    for beta in {1, 2} (Veach 1997 Ch. 9.2.3 + Lin et al. 2022 Eq. 31, delta = 0.20 canonical defense).
float EvaluateCanonicalPairwiseShare(float DonorTerm, float CenterTerm, float ValidNeighborCount)
{
    if (DonorTerm <= 0.0 || !isfinite(DonorTerm)) return 0.0;
    float EffectiveCenter = CenterTerm / max(ValidNeighborCount, 1.0);
    if (EffectiveCenter <= 0.0 || !isfinite(EffectiveCenter)) return 1.0;
    bool PowerBeta = (Extent.Primary.w & 33554432u) != 0;
    float Share = 0.5;
    if (DonorTerm >= EffectiveCenter)
    {
        float Ratio = EffectiveCenter / DonorTerm;
        float Term = PowerBeta ? (Ratio * Ratio) : Ratio;
        Share = 1.0 / (1.0 + Term);
    }
    else
    {
        float Ratio = DonorTerm / EffectiveCenter;
        float Term = PowerBeta ? (Ratio * Ratio) : Ratio;
        Share = Term / (1.0 + Term);
    }
    return 0.80 * Share;
}
float ReplayEffectiveSpecularRoughness(SurfacePoint R)
{
    uint Address = MaterialAddress(R);
    if ((Extent.Primary.w & 134217728u) == 0 || Address == 0u)
        return clamp(R.NormalRoughness.w, 0.04, 1.0);
    if (MaterialTransport(R) == 2u) return 0.04;
    uint Offset = Address - 1u;
    uint Count = min(uint(Angles[Offset]), 8u);
    float Effective = clamp(R.NormalRoughness.w, 0.04, 1.0);
    [loop]
    for (uint Index = 1u; Index < Count; ++Index)
    {
        uint P = Offset + 8u + Index * 24u;
        if (Angles[P + 6u] > 0.05)
            Effective = min(Effective, clamp(Angles[P + 3u], 0.04, 1.0));
    }
    return Effective;
}
// 📝 Every half is an exactly representable uint16, avoiding float-to-uint conversion of corrupt history.
bool ReplaySeedHalfValid(float HalfBits)
{
    return isfinite(HalfBits) && HalfBits >= 0 && HalfBits <= 65535 && floor(HalfBits) == HalfBits;
}
bool ReplayReservoirHistoryValid(float4 SourceSlot)
{
    return ReplaySeedHalfValid(SourceSlot.x) && ReplaySeedHalfValid(SourceSlot.y) &&
        isfinite(SourceSlot.z) && SourceSlot.z > 0 &&
        isfinite(SourceSlot.w) && SourceSlot.w >= 1 && SourceSlot.w <= 68 &&
        floor(SourceSlot.w) == SourceSlot.w;
}
bool ReplaySeedBankValid(float4 First, float4 Second)
{
    float Count = Second.z;
    return isfinite(Count) && Count >= 1 && Count <= 3 && floor(Count) == Count &&
        ReplaySeedHalfValid(First.x) && ReplaySeedHalfValid(First.y) &&
        (Count < 2 || (ReplaySeedHalfValid(First.z) && ReplaySeedHalfValid(First.w))) &&
        (Count < 3 || (ReplaySeedHalfValid(Second.x) && ReplaySeedHalfValid(Second.y)));
}
// 📝 Stratified 4-tap Vogel disk (2.15 px to 6.0 px angular-adaptive radius): r_0 >= 0.76 px guarantees non-zero offsets.
int2 ProjectSpatialDiskOffset(uint Pixel, uint SequenceSeed, uint TapIndex)
{
    uint SpatialBits = (SequenceSeed * 1664525u + 1013904223u) ^ (Pixel * 2246822519u + 3266489917u);
    float Azimuth = 6.283185307179586 * RandomUnit(SpatialBits) + float(TapIndex) * 2.39996323;
    float MaxRadius = clamp(float(min(Extent.History.x, Extent.History.y)) * (6.0 / 192.0), 2.15, 6.0);
    float Radius = MaxRadius * sqrt((float(TapIndex) + 0.5) * 0.25);
    return int2(floor(float2(cos(Azimuth), sin(Azimuth)) * Radius + 0.5));
}
// 📝 Symmetric tangent-plane and normal gate over primary hits; eligibility alone does not prove unbiased reuse.
bool EvaluateSpatialSurfaceCompatibility(SurfacePoint Receiver, SurfacePoint DonorReceiver)
{
    bool RoughEnabled = (Extent.Primary.w & 64u) != 0;
    bool AuthoredMaterials = (Extent.Primary.w & 134217728u) != 0;
    if (DonorReceiver.PositionHit.w == 0 || DonorReceiver.MotionPositionToken.w <= 0 ||
        (DonorReceiver.ViewMetallic.w != 0 && !RoughEnabled))
        return false;
    if (AuthoredMaterials && MaterialTransport(Receiver) != MaterialTransport(DonorReceiver))
        return false;
    float ReceiverNormalSquared = dot(Receiver.NormalRoughness.xyz, Receiver.NormalRoughness.xyz);
    float DonorNormalSquared = dot(DonorReceiver.NormalRoughness.xyz, DonorReceiver.NormalRoughness.xyz);
    if (ReceiverNormalSquared <= 1e-12 || DonorNormalSquared <= 1e-12) return false;
    float3 ReceiverNormal = Receiver.NormalRoughness.xyz * rsqrt(ReceiverNormalSquared);
    float3 DonorNormal = DonorReceiver.NormalRoughness.xyz * rsqrt(DonorNormalSquared);
    float NormalFloor = AuthoredMaterials && ReplayEffectiveSpecularRoughness(Receiver) < 0.14 ? 0.98480775 : 0.90630779;
    if (dot(ReceiverNormal, DonorNormal) < NormalFloor) return false;
    float3 Separation = DonorReceiver.PositionHit.xyz - Receiver.PositionHit.xyz;
    float Footstep = isfinite(Receiver.MotionPixel.z) ? max(Receiver.MotionPixel.z, 0.0) : 0.0;
    float PlaneAllowance = max(0.05, 2.0 * min(Footstep, 0.25));
    if (abs(dot(Separation, ReceiverNormal)) > PlaneAllowance || abs(dot(Separation, DonorNormal)) > PlaneAllowance)
        return false;
    if (RoughEnabled &&
        abs(ReplayEffectiveSpecularRoughness(Receiver) - ReplayEffectiveSpecularRoughness(DonorReceiver)) >
            (AuthoredMaterials ? 0.18 : 0.25))
        return false;
    return true;
}
float ReplayTarget(float3 Radiance) { return max(0, Power(Radiance)) + Extent.Maximum.x; }
void FlushSecondaryTraversalCounters(uint Pixel)
{
    if (ReplayThreadBoxTests > 0) InterlockedAdd(Counters[18], ReplayThreadBoxTests);
    if (ReplayThreadTriTests > 0) InterlockedAdd(Counters[19], ReplayThreadTriTests);
    if ((Extent.Primary.w & 2097152u) != 0)
    {
        float4 Prior = OutputColour[ReplaySlot(9, Pixel)];
        OutputColour[ReplaySlot(9, Pixel)] =
            float4(Prior.xy, Prior.zw + float2(float(ReplayThreadBoxTests), float(ReplayThreadTriTests)));
    }
}
[shader("compute")][numthreads(64,1,1)] void GenerateReplayReservoirs(uint3 Dispatch : SV_DispatchThreadID)
{
    uint Pixel = Dispatch.x;
    if (Pixel >= Extent.Dimensions.x) return;
    ReplayThreadBoxTests = 0;
    ReplayThreadTriTests = 0;
    if ((Extent.Primary.w & 2097152u) != 0 && Extent.Primary.x == 0)
        OutputColour[ReplaySlot(9, Pixel)] = 0;
    bool HybridEnabled = (Extent.Primary.w & 536870912u) != 0;
    SurfacePoint R = Receivers[Pixel];
    float4 Packed = 0, SelectedRadiance = 0;
    ReplaySecondaryVertex SelectedSecondary = (ReplaySecondaryVertex)0;
    if (R.PositionHit.w != 0 && R.MotionPositionToken.w > 0 &&
        (R.ViewMetallic.w == 0 || (Extent.Primary.w & 64u) != 0))
    {
        uint SeedBits = Extent.Sampling.x ^ (Pixel * 747796405u + 2891336453u);
        uint SelectionBits = (Extent.Sampling.x * 277803737u + 1597334677u) ^ (Pixel * 2891336453u + 1u);
        uint Selected = 0u;
        float3 Radiance = 0.0;
        float Target = 0.0, Sum = 0.0, Count = 0.0;
        uint InitialCount = max(Extent.Sampling.y, 1u);

        bool TemporalCandidateReady = false;
        uint TemporalCandidateSeed = 0u;
        float TemporalSourceZ = 0.0, TemporalRetained = 0.0;
        if (Extent.Reconstruction.x != 0 && Extent.History.z != 0 && Extent.History.w == 0 &&
            R.MotionPixel.w != 0 && ReplayMotionConvertible(R.MotionPixel.xy))
        {
            int2 P = int2(floor(R.MotionPixel.xy + .5));
            if (all(P >= 0) && all(P < int2(Extent.History.xy)))
            {
                uint Previous = uint(P.y) * Extent.History.x + uint(P.x);
                float4 Source = OutputColour[ReplaySlot(0, Previous)];
                float4 Guide = OutputColour[ReplaySlot(1, Previous)];
                float3 PriorNormal = OutputColour[ReplaySlot(4, Previous)].xyz;
                float3 MotionNormal = R.MotionNormal.xyz;
                float PriorLength = dot(PriorNormal, PriorNormal), MotionLength = dot(MotionNormal, MotionNormal);
                bool MatchingPosition = all(Guide.xyz == R.MotionPositionToken.xyz);
                if ((Extent.Primary.w & 512u) == 0 && PriorLength > 1e-12 && MotionLength > 1e-12)
                {
                    float3 Delta = Guide.xyz - R.MotionPositionToken.xyz;
                    float Radius = clamp(R.MotionPixel.z, 0.0, .25);
                    MatchingPosition = dot(Delta, Delta) <= Radius * Radius &&
                                       dot(PriorNormal, MotionNormal) >= .9 * sqrt(PriorLength * MotionLength);
                }
                if (ReplayReservoirHistoryValid(Source) && Guide.w == R.MotionPositionToken.w && MatchingPosition)
                {
                    TemporalCandidateReady = true;
                    TemporalCandidateSeed = DecodeReplaySeed(Source.xy);
                    TemporalSourceZ = Source.z;
                    TemporalRetained = min(Source.w, float(max(1u, Extent.Reconstruction.w)));
                }
                else InterlockedAdd(Counters[21], 1);
            }
        }

        uint3 BankSeeds = 0u;
        uint BankCount = 0u;
        if ((Extent.Primary.w & 262144u) != 0 && (Extent.Reconstruction.x != 0 || Extent.Reconstruction.y != 0))
        {
            float4 BankFirst = OutputColour[ReplaySlot(13, Pixel)];
            float4 BankSecond = OutputColour[ReplaySlot(14, Pixel)];
            if (ReplaySeedBankValid(BankFirst, BankSecond))
            {
                uint RetainedCount = uint(BankSecond.z);
                BankCount = Extent.Reconstruction.x != 0 ? min(RetainedCount, 1u) : RetainedCount;
                if (BankCount > 0u) BankSeeds.x = DecodeReplaySeed(BankFirst.xy);
                if (BankCount > 1u) BankSeeds.y = DecodeReplaySeed(BankFirst.zw);
                if (BankCount > 2u) BankSeeds.z = DecodeReplaySeed(BankSecond.xy);
            }
        }

        bool TemporalReplayed = false;
        uint TemporalSeed = 0u;
        float3 TemporalRadiance = 0.0;
        ReplaySecondaryVertex TemporalSecondary = (ReplaySecondaryVertex)0;
        uint TemporalSlot = InitialCount;
        uint BankStart = InitialCount + (TemporalCandidateReady ? 1u : 0u);
        uint TotalProposals = BankStart + BankCount;

        [loop]
        for (uint ProposalIndex = 0u; ProposalIndex < TotalProposals; ++ProposalIndex)
        {
            bool InitialProposal = ProposalIndex < InitialCount;
            bool TemporalProposal = TemporalCandidateReady && ProposalIndex == TemporalSlot;
            uint BankIdx = ProposalIndex - BankStart;
            uint BankCandidate = BankIdx == 0u ? BankSeeds.x : (BankIdx == 1u ? BankSeeds.y : BankSeeds.z);
            uint Candidate = InitialProposal ? NextRandom(SeedBits)
                                             : (TemporalProposal ? TemporalCandidateSeed : BankCandidate);
            bool ReuseTemporalEval = !InitialProposal && !TemporalProposal && TemporalReplayed && Candidate == TemporalSeed;

            ReplaySecondaryVertex CandidateSecondary = ReuseTemporalEval ? TemporalSecondary : (ReplaySecondaryVertex)0;
            float3 CandidateRadiance = ReuseTemporalEval
                ? TemporalRadiance
                : EvaluateReplayPathWithSecondary(R, Candidate, CandidateSecondary);
            float CandidateTarget = ReplayTarget(CandidateRadiance);

            if (TemporalProposal)
            {
                float Weight = CandidateTarget * TemporalSourceZ * TemporalRetained;
                if (Weight > 0.0 && isfinite(Weight) && isfinite(Sum + Weight))
                {
                    Sum += Weight;
                    Count += TemporalRetained;
                    if (RandomUnit(SelectionBits) * Sum < Weight)
                    {
                        Selected = Candidate;
                        Radiance = CandidateRadiance;
                        Target = CandidateTarget;
                        SelectedSecondary = CandidateSecondary;
                    }
                    TemporalReplayed = true;
                    TemporalSeed = Candidate;
                    TemporalRadiance = CandidateRadiance;
                    TemporalSecondary = CandidateSecondary;
                    InterlockedAdd(Counters[20], 1);
                }
                else InterlockedAdd(Counters[21], 1);
            }
            else
            {
                Sum += CandidateTarget;
                Count += 1.0;
                if (ProposalIndex == 0u || RandomUnit(SelectionBits) * Sum < CandidateTarget)
                {
                    Selected = Candidate;
                    Radiance = CandidateRadiance;
                    Target = CandidateTarget;
                    SelectedSecondary = CandidateSecondary;
                }
            }
        }
        Packed = float4(EncodeReplaySeed(Selected), Sum / (Count * Target), Count);
        SelectedRadiance = float4(Radiance, Target);
    }
    OutputColour[ReplaySlot(2, Pixel)] = Packed;
    OutputColour[ReplaySlot(3, Pixel)] = SelectedRadiance;
    if (HybridEnabled)
        WriteReplaySecondaryVertex(Pixel, SelectedSecondary);
    FlushSecondaryTraversalCounters(Pixel);
}
// 📝 Wavefront-partitioned spatial reservoir resolution: diffuse/matte surfaces execute Hybrid Secondary
//    Reconnection in ResolveHybridReplayReservoirs while specular/multi-strata/transmissive surfaces execute
//    full Random-Number Replay in ResolveReplayReservoirs over strictly disjoint pixel subsets.
void ResolveReplayReservoirsCore(uint Pixel, bool HybridKernel)
{
    if (Pixel >= Extent.Dimensions.x) return;
    SurfacePoint R = Receivers[Pixel];
    bool HybridEnabled = (Extent.Primary.w & 536870912u) != 0;
    if (HybridKernel)
    {
        if (!HybridEnabled || !PrimarySurfaceReconnectable(R)) return;
    }
    else
    {
        if (HybridEnabled && PrimarySurfaceReconnectable(R)) return;
    }

    ReplayThreadBoxTests = 0;
    ReplayThreadTriTests = 0;
    float4 Local = OutputColour[ReplaySlot(2, Pixel)];
    float3 Chosen = 0;
    float ChosenTarget = Extent.Maximum.x, Sum = 0, Count = 0;
    uint SelectionBits = (Extent.Sampling.x * 2891336453u + 1013904223u) ^ (Pixel * 277803737u + 13u);
    int2 Centre = int2(Pixel % Extent.History.x, Pixel / Extent.History.x);
    uint ProposalCount = Extent.Reconstruction.y != 0 ? 5u : 1u;
    bool DiskEnabled = (Extent.Primary.w & 1048576u) != 0;
    bool PairwiseEnabled = (Extent.Primary.w & 268435456u) != 0;
    bool CanonicalMode = HybridKernel || PairwiseEnabled || HybridEnabled;
    float3 Indirect = 0.0;

    if (ReplayReservoirHistoryValid(Local))
    {
        float3 CenterRadiance = OutputColour[ReplaySlot(3, Pixel)].xyz;
        float CenterTarget = CanonicalMode ? max(0.0, Power(CenterRadiance)) : ReplayTarget(CenterRadiance);
        uint CenterSeed = DecodeReplaySeed(Local.xy);

        if (!CanonicalMode)
        {
            float Weight0 = CenterTarget * Local.z * Local.w;
            if (isfinite(Weight0))
            {
                Sum += Weight0;
                Count += Local.w;
                if (RandomUnit(SelectionBits) * Sum < Weight0)
                {
                    Chosen = CenterRadiance;
                    ChosenTarget = CenterTarget;
                }
            }
        }

        uint4 ValidDonors = 0u;
        uint ValidDonorCount = 0u;
        [loop]
        for (uint I = 1u; I < ProposalCount; ++I)
        {
            int2 CrossOffset = I == 1u ? int2(-1, 0) : (I == 2u ? int2(1, 0) : (I == 3u ? int2(0, -1) : int2(0, 1)));
            int2 Offset = DiskEnabled ? ProjectSpatialDiskOffset(Pixel, Extent.Sampling.x, I - 1u) : CrossOffset;
            int2 P = Centre + Offset;
            bool InBounds = all(P >= 0) && all(P < int2(Extent.History.xy));
            if (InBounds)
            {
                uint Donor = uint(P.y) * Extent.History.x + uint(P.x);
                SurfacePoint DonorSurface = Receivers[Donor];
                bool Compat = (!DiskEnabled || EvaluateSpatialSurfaceCompatibility(R, DonorSurface)) &&
                              (!HybridKernel || PrimarySurfaceReconnectable(DonorSurface));
                if (!Compat)
                {
                    InterlockedAdd(Counters[9], 1);
                }
                else if (ReplayReservoirHistoryValid(OutputColour[ReplaySlot(2, Donor)]))
                {
                    if (ValidDonorCount == 0u) ValidDonors.x = Donor;
                    else if (ValidDonorCount == 1u) ValidDonors.y = Donor;
                    else if (ValidDonorCount == 2u) ValidDonors.z = Donor;
                    else ValidDonors.w = Donor;
                    ++ValidDonorCount;
                }
            }
        }

        if (CanonicalMode && ValidDonorCount == 0u)
        {
            Indirect = CenterRadiance * Local.z;
        }
        else
        {
            float NeighborCount = float(max(ValidDonorCount, 1u));
            float CenterMisAccum = 0.0;
            uint EvalSteps = CanonicalMode ? (ValidDonorCount * 2u) : ValidDonorCount;

            [loop]
            for (uint Step = 0u; Step < EvalSteps; ++Step)
            {
                uint Tap = CanonicalMode ? (Step >> 1u) : Step;
                bool DonorToCenter = !CanonicalMode || ((Step & 1u) == 0u);
                uint Donor = Tap == 0u ? ValidDonors.x :
                            (Tap == 1u ? ValidDonors.y :
                            (Tap == 2u ? ValidDonors.z : ValidDonors.w));
                float4 Source = OutputColour[ReplaySlot(2, Donor)];
                float DonorTarget = max(0.0, OutputColour[ReplaySlot(3, Donor)].w - Extent.Maximum.x);
                uint DonorSeed = DecodeReplaySeed(Source.xy);

                uint EvalPixel = DonorToCenter ? Pixel : Donor;
                uint SrcPixel  = DonorToCenter ? Donor : Pixel;
                uint SrcSeed   = DonorToCenter ? DonorSeed : CenterSeed;
                ReplaySecondaryVertex SrcSec = (ReplaySecondaryVertex)0;
                if (HybridKernel)
                {
                    float4 F1 = OutputColour[ReplaySlot(21u, SrcPixel)];
                    float4 F2 = OutputColour[ReplaySlot(22u, SrcPixel)];
                    SrcSec.Position = F1.xyz;
                    SrcSec.Normal = DecodeOctahedralNormal11(uint(clamp(F2.w, 2.0, 4194305.0)));
                    SrcSec.Outgoing = max(F2.xyz, 0.0);
                    SrcSec.PrimaryPdf = select(isfinite(F1.w) && (F1.w > 0.0), F1.w, 0.0);
                    SrcSec.Mode = 1u;
                }

                ReplaySecondaryVertex UnusedSec;
                float ShiftJac = 1.0;
                bool ValidShift = false;
                float3 EvalRadiance = EvaluateReplayPathUnified(
                    Receivers[EvalPixel], SrcSeed, HybridKernel, 0.0, SrcSec, UnusedSec, ShiftJac, ValidShift);

                if (!CanonicalMode)
                {
                    float Target = ReplayTarget(EvalRadiance);
                    float Weight = Target * Source.z * Source.w;
                    if (isfinite(Weight) && isfinite(Sum + Weight))
                    {
                        Sum += Weight;
                        Count += Source.w;
                        if (RandomUnit(SelectionBits) * Sum < Weight)
                        {
                            Chosen = EvalRadiance;
                            ChosenTarget = Target;
                        }
                    }
                    InterlockedAdd(Counters[22], 1);
                }
                else if (DonorToCenter)
                {
                    if (ValidShift && ShiftJac > 0.0)
                    {
                        float ShiftedTarget = max(0.0, Power(EvalRadiance));
                        float PhiDonor = EvaluateCanonicalPairwiseShare(
                            Source.w * DonorTarget, Local.w * ShiftedTarget * ShiftJac, NeighborCount);
                        float DonorMis = PhiDonor / NeighborCount;
                        float DonorWeight = DonorMis * ShiftedTarget * Source.z * ShiftJac;
                        if (DonorWeight > 0.0 && isfinite(DonorWeight) && isfinite(Sum + DonorWeight))
                        {
                            Sum += DonorWeight;
                            if (RandomUnit(SelectionBits) * Sum < DonorWeight)
                            {
                                Chosen = EvalRadiance;
                                ChosenTarget = ShiftedTarget;
                            }
                        }
                        InterlockedAdd(Counters[22], 1);
                    }
                }
                else
                {
                    if (ValidShift && ShiftJac > 0.0)
                    {
                        float CenterAtDonorTarget = max(0.0, Power(EvalRadiance));
                        float PhiCenter = EvaluateCanonicalPairwiseShare(
                            Source.w * CenterAtDonorTarget * ShiftJac, Local.w * CenterTarget, NeighborCount);
                        CenterMisAccum += (1.0 - PhiCenter);
                    }
                    else
                    {
                        CenterMisAccum += 1.0;
                    }
                }
            }

            if (CanonicalMode)
            {
                float CenterMis = CenterMisAccum / NeighborCount;
                float CenterWeight = CenterMis * CenterTarget * Local.z;
                if (CenterWeight > 0.0 && isfinite(CenterWeight) && isfinite(Sum + CenterWeight))
                {
                    Sum += CenterWeight;
                    if (RandomUnit(SelectionBits) * Sum < CenterWeight)
                    {
                        Chosen = CenterRadiance;
                        ChosenTarget = CenterTarget;
                    }
                }
                Indirect = (Sum > 0.0 && ChosenTarget > 0.0) ? Chosen * (Sum / ChosenTarget) : float3(0.0);
            }
            else
            {
                Indirect = (Count > 0.0 && ChosenTarget > 0.0) ? Chosen * (Sum / (Count * ChosenTarget)) : float3(0.0);
            }
        }
    }
    OutputColour[Pixel] = float4(Indirect + R.ResidualSpecular.xyz, 1);
    // Persist only pre-spatial history; cross-pixel candidates are retraced, not assumed statistically independent.
    OutputColour[ReplaySlot(0, Pixel)] = Local;
    OutputColour[ReplaySlot(1, Pixel)] = float4(R.PositionHit.xyz, R.PositionHit.w != 0 ? R.MotionPositionToken.w : 0);
    OutputColour[ReplaySlot(4, Pixel)] = float4(R.NormalRoughness.xyz, 0);
    FlushSecondaryTraversalCounters(Pixel);
}

[shader("compute")][numthreads(64,1,1)] void ResolveReplayReservoirs(uint3 Dispatch : SV_DispatchThreadID)
{
    ResolveReplayReservoirsCore(Dispatch.x, false);
}

[shader("compute")][numthreads(64,1,1)] void ResolveHybridReplayReservoirs(uint3 Dispatch : SV_DispatchThreadID)
{
    ResolveReplayReservoirsCore(Dispatch.x, true);
}
