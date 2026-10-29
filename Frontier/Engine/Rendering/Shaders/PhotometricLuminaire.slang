/*==========================================================================================================================================
                                                   PHOTOMETRICLUMINAIRE.SLANG
==========================================================================================================================================*/
// 🧩 Loop-free polar-cone cell predicates, uniform (theta, phi) Type-C LM-63 grids, and O(1) Vose-alias luminaire sampling.

static const uint PathReplayPhotometricBit   = 4u;
static const uint PhotometricTightClusterBit = 128u;

bool PhotometricClustersEnabled()
{
    return (Extent.Primary.w & PathReplayPhotometricBit) != 0u &&
           Extent.Dimensions.z == 0u &&
           asuint(Extent.Maximum.z) != 0u;
}

uint PhotometricHeaderStart()
{
    return asuint(Extent.Maximum.z) - 1u;
}

float4 PhotometricHeaderWord(uint WordIndex)
{
    uint Base = PhotometricHeaderStart() + WordIndex * 4u;
    return float4(Angles[Base], Angles[Base + 1u], Angles[Base + 2u], Angles[Base + 3u]);
}

bool IntersectsPolarConeBox(float3 ConeApex, float ReachRadius, float3 ForwardInput, float CosineThetaMax,
                            float3 BoxLow, float3 BoxHigh)
{
    float3 ClampedApex = clamp(ConeApex, BoxLow, BoxHigh);
    float3 BoxDelta    = ConeApex - ClampedApex;
    float  Squared     = dot(BoxDelta, BoxDelta);
    float  RadiusSq    = ReachRadius * ReachRadius;
    bool   WithinReach = (ReachRadius <= 0.0) ||
                         (Squared <= RadiusSq + 64.0 * 1.1920929e-7 * max(1.0, max(Squared, RadiusSq)));
    bool Result = WithinReach;
    if (WithinReach && Squared > 1e-12 && CosineThetaMax > -0.999999)
    {
        float3 ForwardUnit = Unit(ForwardInput);
        float  ClampedCos  = clamp(CosineThetaMax, -1.0, 1.0);
        bool   HalfSpaceOk = true;
        if (ClampedCos >= 0.0)
        {
            float3 LowProj  = (BoxLow - ConeApex) * ForwardUnit;
            float3 HighProj = (BoxHigh - ConeApex) * ForwardUnit;
            float3 MaxProj  = max(LowProj, HighProj);
            HalfSpaceOk     = (MaxProj.x + MaxProj.y + MaxProj.z) > -1e-5;
        }
        if (!HalfSpaceOk)
        {
            Result = false;
        }
        else
        {
            float3 BoxCentre    = 0.5 * (BoxLow + BoxHigh);
            float3 HalfExtent   = 0.5 * (BoxHigh - BoxLow);
            float  BoxRadius    = length(HalfExtent);
            float3 CentreOffset = BoxCentre - ConeApex;
            float  CentreDist   = length(CentreOffset);
            if (CentreDist > BoxRadius + 1e-6)
            {
                float SineAlpha   = BoxRadius / CentreDist;
                float CosineAlpha = sqrt(max(0.0, 1.0 - SineAlpha * SineAlpha));
                float SineMax     = sqrt(max(0.0, 1.0 - ClampedCos * ClampedCos));
                bool  ObtuseCover = (ClampedCos < 0.0) && (SineAlpha >= SineMax - 1e-6);
                if (!ObtuseCover)
                {
                    float MinCosSum = ClampedCos * CosineAlpha - SineMax * SineAlpha;
                    Result          = dot(CentreOffset, ForwardUnit) >= CentreDist * MinCosSum - 1e-5 * (CentreDist + BoxRadius);
                }
            }
        }
    }
    return Result;
}

float ExtractAnalyticPolarCosine(LightShape L)
{
    float CosineBound = (L.RadianceCategory.w == 2.0) ? clamp(L.UpOuter.w, -1.0, 1.0) : -1.0;
    if (L.Profile.y > 0u)
    {
        float EncodedCosine = L.PeakActive.w;
        float ProfileCosine = -1.0;
        if (EncodedCosine >= 0.5 && EncodedCosine <= 3.5)
        {
            ProfileCosine = clamp(EncodedCosine - 2.0, -1.0, 1.0);
        }
        else
        {
            float MaxDeg = Angles[L.Profile.x + L.Profile.y - 1u];
            if (MaxDeg < 179.999)
            {
                ProfileCosine = cos(MaxDeg * (3.141592653589793 / 180.0));
            }
        }
        CosineBound = max(CosineBound, ProfileCosine);
    }
    return CosineBound;
}

float SampleUniformCandelaGrid(uint GridOffset, float ThetaDeg, float PhiDeg)
{
    float WrappedPhi = fmod(PhiDeg + 360.0, 360.0);
    if (WrappedPhi < 0.0) WrappedPhi += 360.0;
    float ThetaCoord = clamp(ThetaDeg, 0.0, 180.0);
    float PhiCoord   = clamp(WrappedPhi * 0.2, 0.0, 72.0);
    uint  ThetaIdx   = min(uint(ThetaCoord), 179u);
    uint  PhiIdx     = min(uint(PhiCoord), 71u);
    float ThetaFrac  = ThetaCoord - float(ThetaIdx);
    float PhiFrac    = PhiCoord - float(PhiIdx);
    uint  ColumnA    = GridOffset + PhiIdx * 181u + ThetaIdx;
    uint  ColumnB    = ColumnA + 181u;
    float RowA       = lerp(Angles[ColumnA], Angles[ColumnA + 1u], ThetaFrac);
    float RowB       = lerp(Angles[ColumnB], Angles[ColumnB + 1u], ThetaFrac);
    return max(0.0, lerp(RowA, RowB, PhiFrac));
}

float EvaluateFacetPhotometricFactor(uint FacetIndex, float3 DirectionFromSourceToReceiver)
{
    float Factor = 1.0;
    if (PhotometricClustersEnabled())
    {
        uint TableOffset = uint(PhotometricHeaderWord(3u).z);
        if (TableOffset != 0u)
        {
            uint MappedFacets = uint(Angles[TableOffset]);
            if (FacetIndex < MappedFacets)
            {
                uint EntryBase = uint(Angles[TableOffset + 1u + FacetIndex]);
                if (EntryBase != 0u)
                {
                    float3 ForwardUnit = float3(Angles[EntryBase], Angles[EntryBase + 1u], Angles[EntryBase + 2u]);
                    uint   GridOffset  = uint(Angles[EntryBase + 3u]);
                    float3 RightUnit   = float3(Angles[EntryBase + 4u], Angles[EntryBase + 5u], Angles[EntryBase + 6u]);
                    float  CosineBound = Angles[EntryBase + 7u];
                    bool   TwoSided    = Angles[EntryBase + 8u] > 0.5;

                    float3 Toward      = Unit(DirectionFromSourceToReceiver);
                    float3 UpUnit      = cross(ForwardUnit, RightUnit);
                    float  PolarCosine = clamp(dot(ForwardUnit, Toward), -1.0, 1.0);
                    if (!TwoSided && (PolarCosine <= 0.0 || PolarCosine < CosineBound - 1e-5))
                    {
                        Factor = 0.0;
                    }
                    else
                    {
                        float EffectiveCos = TwoSided ? abs(PolarCosine) : PolarCosine;
                        float ThetaDeg     = acos(clamp(EffectiveCos, -1.0, 1.0)) * (180.0 / 3.141592653589793);
                        float PhiDeg       = atan2(dot(Toward, RightUnit), dot(Toward, UpUnit)) * (180.0 / 3.141592653589793);
                        Factor             = SampleUniformCandelaGrid(GridOffset, ThetaDeg, PhiDeg);
                    }
                }
            }
        }
    }
    return Factor;
}

float3 EvaluateAnalyticArrivalLoopFree(LightShape L, float3 Point, out float3 OutDirection, out float OutDistance)
{
    OutDirection = L.PositionReach.xyz;
    OutDistance  = 1e20;
    float3 Result = 0.0;
    bool Active   = (L.PeakActive.y != 0.0) && any(L.RadianceCategory.xyz > 0.0);
    if (Active)
    {
        if (L.RadianceCategory.w == 0.0)
        {
            OutDirection = Unit(L.PositionReach.xyz);
            Result       = L.RadianceCategory.xyz;
        }
        else
        {
            float3 Delta = L.PositionReach.xyz - Point;
            OutDistance  = length(Delta);
            OutDirection = OutDistance > 0.0 ? Delta / OutDistance : float3(0.0, 0.0, 1.0);
            if (L.PositionReach.w <= 0.0 || OutDistance < L.PositionReach.w)
            {
                float Angular = 1.0;
                if (L.RadianceCategory.w == 2.0 || L.Profile.y != 0u)
                {
                    float3 Forward = Unit(L.DirectionInner.xyz);
                    float3 Toward  = -OutDirection;
                    float  Cosine  = clamp(dot(Forward, Toward), -1.0, 1.0);
                    if (L.RadianceCategory.w == 2.0)
                    {
                        float Ramp = saturate((Cosine - L.UpOuter.w) / max(L.DirectionInner.w - L.UpOuter.w, 1e-6));
                        Angular    = Ramp * Ramp * (3.0 - 2.0 * Ramp);
                    }
                    if (L.Profile.y != 0u && L.Profile.x > 0u)
                    {
                        float3 Right      = Unit(cross(L.UpOuter.xyz, Forward));
                        float3 Up         = cross(Forward, Right);
                        float  ThetaDeg   = acos(Cosine) * (180.0 / 3.141592653589793);
                        float  PhiDeg     = atan2(dot(Toward, Right), dot(Toward, Up)) * (180.0 / 3.141592653589793);
                        uint   GridOffset = uint(Angles[L.Profile.x - 1u]);
                        Angular          *= SampleUniformCandelaGrid(GridOffset, ThetaDeg, PhiDeg);
                    }
                }
                float Window = 1.0;
                if (L.PositionReach.w > 0.0)
                {
                    float Ratio   = OutDistance / L.PositionReach.w;
                    float Quartic = Ratio * Ratio * Ratio * Ratio;
                    Window        = (1.0 - Quartic) * (1.0 - Quartic);
                }
                Result = L.RadianceCategory.xyz * (Angular * Window / max(OutDistance * OutDistance, 1e-6));
            }
        }
    }
    return Result;
}

bool LocatePhotometricClusterCell(float3 WorldPoint, out uint OutCellIndex)
{
    OutCellIndex      = 0u;
    float4 LowWord    = PhotometricHeaderWord(0u);
    float4 HighWord   = PhotometricHeaderWord(1u);
    float4 GridWord   = PhotometricHeaderWord(2u);
    bool   InsideGrid = all(WorldPoint >= LowWord.xyz) && all(WorldPoint < HighWord.xyz);
    if (InsideGrid)
    {
        uint3 GridExtent = uint3(GridWord.xyz);
        uint3 CellCoord  = min(uint3((WorldPoint - LowWord.xyz) / (HighWord.xyz - LowWord.xyz) * GridWord.xyz),
                               GridExtent - 1u);
        OutCellIndex     = (CellCoord.z * GridExtent.y + CellCoord.y) * GridExtent.x + CellCoord.x;
    }
    return InsideGrid;
}

float EvaluateClusteredLocalFacetProbability(uint CellBase, uint LocalCount, uint FacetIndex)
{
    float Probability = 0.0;
    if (LocalCount > 0u)
    {
        uint Low  = 0u;
        uint High = LocalCount;
        {
            uint Mid  = (Low + High) >> 1u;
            bool Less = (Low < High) && (uint(Angles[CellBase + 1u + 2u * Mid]) < FacetIndex);
            Low       = select(Less, Mid + 1u, Low);
            High      = select(Less, High, Mid);
        }
        {
            uint Mid  = (Low + High) >> 1u;
            bool Less = (Low < High) && (uint(Angles[CellBase + 1u + 2u * Mid]) < FacetIndex);
            Low       = select(Less, Mid + 1u, Low);
            High      = select(Less, High, Mid);
        }
        {
            uint Mid  = (Low + High) >> 1u;
            bool Less = (Low < High) && (uint(Angles[CellBase + 1u + 2u * Mid]) < FacetIndex);
            Low       = select(Less, Mid + 1u, Low);
            High      = select(Less, High, Mid);
        }
        {
            uint Mid  = (Low + High) >> 1u;
            bool Less = (Low < High) && (uint(Angles[CellBase + 1u + 2u * Mid]) < FacetIndex);
            Low       = select(Less, Mid + 1u, Low);
            High      = select(Less, High, Mid);
        }
        if (Low < LocalCount && uint(Angles[CellBase + 1u + 2u * Low]) == FacetIndex)
        {
            Probability = Angles[CellBase + 1u + 2u * Low + 1u];
        }
    }
    return Probability;
}
