/*==========================================================================================================================================
                                                 SOLARSKYENVIRONMENT.SLANG
==========================================================================================================================================*/
// 🧩 Coupled Bruneton/Hillaire atmospheric sky, limb-darkened solar disc NEE, and cloud-slab transmittance.

static const float SolarSkyPi               = 3.14159265358979323846;
static const float SolarSkyGroundRadiusKm   = 6360.0;
static const float SolarSkyTopRadiusKm      = 6460.0;
static const float3 SolarSkyRayleighScatter = float3(5.802e-3, 13.558e-3, 33.1e-3);
static const float SolarSkyRayleighScaleKm  = 8.0;
static const float SolarSkyMieScatter       = 3.996e-3;
static const float SolarSkyMieExtinction    = 4.400e-3;
static const float SolarSkyMieScaleKm       = 1.2;
static const float3 SolarSkyOzoneAbsorption = float3(0.65e-3, 1.881e-3, 0.085e-3);
static const float SolarSkyOzonePeakKm      = 25.0;
static const float SolarSkyOzoneWidthKm     = 15.0;

//------------------------------------------------------------------------------------------------------------------------
//                                           PAYLOAD ACCESS AND ORTHONORMAL FRAMES
//------------------------------------------------------------------------------------------------------------------------

bool SkyRadianceActive()
{
    return (Extent.Primary.w & 1073741824u) != 0;
}

float4 SolarSkyPayloadWord(uint WordIndex)
{
    uint Base = Extent.Primary.y + 48u + WordIndex * 4u;
    return float4(Angles[Base], Angles[Base + 1u], Angles[Base + 2u], Angles[Base + 3u]);
}

void BuildSolarSkyBasis(float3 Axis, out float3 Tangent, out float3 Bitangent)
{
    float3 Anchor = abs(Axis.z) < 0.999 ? float3(0.0, 0.0, 1.0) : float3(1.0, 0.0, 0.0);
    Tangent = Unit(cross(Anchor, Axis));
    Bitangent = cross(Axis, Tangent);
}

//------------------------------------------------------------------------------------------------------------------------
//                                       ATMOSPHERIC OPTICAL DEPTH AND TRANSMITTANCE
//------------------------------------------------------------------------------------------------------------------------

float SolarSkyRaySphereAhead(float3 PositionKm, float3 Direction, float RadiusKm)
{
    float B = dot(PositionKm, Direction);
    float C = dot(PositionKm, PositionKm) - RadiusKm * RadiusKm;
    float Disc = B * B - C;
    if (Disc < 0.0) return -1.0;
    float Root = sqrt(Disc);
    float Near = -B - Root;
    return Near >= 0.0 ? Near : (-B + Root >= 0.0 ? -B + Root : -1.0);
}

float SolarSkyRayleighDensity(float AltitudeKm)
{
    return exp(-max(AltitudeKm, 0.0) / SolarSkyRayleighScaleKm);
}

float SolarSkyMieDensity(float AltitudeKm)
{
    return exp(-max(AltitudeKm, 0.0) / SolarSkyMieScaleKm);
}

float SolarSkyOzoneDensity(float AltitudeKm)
{
    return max(1.0 - abs(AltitudeKm - SolarSkyOzonePeakKm) / SolarSkyOzoneWidthKm, 0.0);
}

float SolarSkyRayleighPhase(float CosTheta)
{
    return 3.0 / (16.0 * SolarSkyPi) * (1.0 + CosTheta * CosTheta);
}

float SolarSkyCornetteShanksPhase(float CosTheta, float AsymmetryG)
{
    float Cosine = clamp(CosTheta, -1.0, 1.0);
    float G = clamp(AsymmetryG, -0.99, 0.99);
    float Denom = max(1.0 + G * G - 2.0 * G * Cosine, 1e-6);
    float Hg = (1.0 - G * G) / (4.0 * SolarSkyPi * Denom * sqrt(Denom));
    return Hg * 1.5 * (1.0 + Cosine * Cosine) / (2.0 + G * G);
}

void AccumulateSolarSkyWarpedNode(float3 StartKm, float3 Delta, float LengthKm, float NodeU, float WeightU,
                                  inout float TauR, inout float TauM, inout float TauO)
{
    float Fraction   = NodeU * NodeU;
    float JacobianKm = (2.0 * NodeU * WeightU) * LengthKm;
    float3 At        = StartKm + Delta * Fraction;
    float AltitudeKm = max(length(At) - SolarSkyGroundRadiusKm, 0.0);
    TauR += SolarSkyRayleighDensity(AltitudeKm) * JacobianKm;
    TauM += SolarSkyMieDensity(AltitudeKm) * JacobianKm;
    TauO += SolarSkyOzoneDensity(AltitudeKm) * JacobianKm;
}

// 📝 Quadratic-warped 6-point Gauss-Legendre quadrature (t = L * u^2) concentrates nodes inside the 1.2 km Mie boundary layer.
float3 SolarSkyOpticalDepthSegment(float3 StartKm, float3 EndKm, uint Steps)
{
    float3 Delta   = EndKm - StartKm;
    float LengthKm = length(Delta);
    if (LengthKm <= 0.0 || Steps == 0u) return 0.0;
    static const float Nodes[6]   = {0.03376524, 0.16939531, 0.38069041, 0.61930959, 0.83060469, 0.96623476};
    static const float Weights[6] = {0.08566225, 0.18038079, 0.23395697, 0.23395697, 0.18038079, 0.08566225};
    float TauR = 0.0, TauM = 0.0, TauO = 0.0;
    [loop]
    for (uint NodeIndex = 0u; NodeIndex < 6u; ++NodeIndex)
    {
        AccumulateSolarSkyWarpedNode(StartKm, Delta, LengthKm, Nodes[NodeIndex], Weights[NodeIndex], TauR, TauM, TauO);
    }
    return SolarSkyRayleighScatter * TauR + SolarSkyMieExtinction * TauM + SolarSkyOzoneAbsorption * TauO;
}

float3 SolarSkyOpticalDepthEndpointPair(float3 StartKm, float3 EndKm)
{
    float LengthKm = length(EndKm - StartKm);
    if (LengthKm <= 0.0) return 0.0;
    float Alt0 = max(length(StartKm) - SolarSkyGroundRadiusKm, 0.0);
    float Alt1 = max(length(EndKm) - SolarSkyGroundRadiusKm, 0.0);
    float AltM = max(length(0.5 * (StartKm + EndKm)) - SolarSkyGroundRadiusKm, 0.0);
    float TauR = (SolarSkyRayleighDensity(Alt0) + 4.0 * SolarSkyRayleighDensity(AltM) + SolarSkyRayleighDensity(Alt1)) * (LengthKm / 6.0);
    float TauM = (SolarSkyMieDensity(Alt0) + 4.0 * SolarSkyMieDensity(AltM) + SolarSkyMieDensity(Alt1)) * (LengthKm / 6.0);
    float TauO = (SolarSkyOzoneDensity(Alt0) + 4.0 * SolarSkyOzoneDensity(AltM) + SolarSkyOzoneDensity(Alt1)) * (LengthKm / 6.0);
    return SolarSkyRayleighScatter * TauR + SolarSkyMieExtinction * TauM + SolarSkyOzoneAbsorption * TauO;
}

float3 SolarSkyTransmittanceToTop(float RadiusKm, float CosZenith, uint Steps)
{
    float ClampedMu = clamp(CosZenith, -1.0, 1.0);
    float SinZenith = sqrt(max(1.0 - ClampedMu * ClampedMu, 0.0));
    float3 PositionKm = float3(0.0, RadiusKm, 0.0);
    float3 Direction = float3(0.0, ClampedMu, SinZenith);
    float ToGround = SolarSkyRaySphereAhead(PositionKm, Direction, SolarSkyGroundRadiusKm);
    float ToTop = SolarSkyRaySphereAhead(PositionKm, Direction, SolarSkyTopRadiusKm);
    float LengthKm = ToTop;
    if (ToGround > 1e-4 && (LengthKm < 0.0 || ToGround < LengthKm))
        LengthKm = ToGround;
    if (LengthKm < 0.0) return 1.0;
    return exp(-SolarSkyOpticalDepthSegment(PositionKm, PositionKm + Direction * LengthKm, Steps));
}

//------------------------------------------------------------------------------------------------------------------------
//                                           CLOUD SLAB TRANSMITTANCE
//------------------------------------------------------------------------------------------------------------------------

float EvaluateSolarCloudPattern(float HorizontalU, float HorizontalV, float Coverage)
{
    if (Coverage <= 0.0) return 0.0;
    float WaveA = 0.5 + 0.5 * sin(HorizontalU * 2.10 + 0.45) * cos(HorizontalV * 1.85 - 0.30);
    float WaveB = 0.5 + 0.5 * sin((HorizontalU * 0.72 - HorizontalV * 0.68) * 4.30 + 1.15);
    float Field = 0.65 * WaveA + 0.35 * WaveB;
    float Threshold = 1.0 - saturate(Coverage);
    float EdgeHigh = min(1.0, Threshold + 0.28);
    if (EdgeHigh <= Threshold) return Field >= EdgeHigh ? 1.0 : 0.0;
    float T = saturate((Field - Threshold) / (EdgeHigh - Threshold));
    return T * T * (3.0 - 2.0 * T);
}

float EvaluateSolarCloudTransmittance(float3 OriginMeters, float3 Direction)
{
    float4 CloudWord = SolarSkyPayloadWord(4u);
    float CloudBaseKm = CloudWord.x, CloudTopKm = CloudWord.y;
    float CloudExtinctionKm = CloudWord.z, CloudCoverage = CloudWord.w;
    if (CloudExtinctionKm <= 0.0 || CloudCoverage <= 0.0) return 1.0;

    float4 ZenithWord = SolarSkyPayloadWord(1u);
    float3 Zenith = Unit(ZenithWord.xyz);
    float3 UnitDir = Unit(Direction);
    float CosZenith = dot(UnitDir, Zenith);
    if (CosZenith <= 1e-3) return 1.0;

    float OriginAltitudeKm = ZenithWord.w + 1e-3 * dot(OriginMeters, Zenith);
    if (OriginAltitudeKm >= CloudTopKm) return 1.0;

    float EntryAltitudeKm = max(CloudBaseKm, OriginAltitudeKm);
    float EntryDistanceKm = (EntryAltitudeKm - OriginAltitudeKm) / CosZenith;
    float ExitDistanceKm = (CloudTopKm - OriginAltitudeKm) / CosZenith;
    float SegmentKm = max(0.0, ExitDistanceKm - EntryDistanceKm);
    if (SegmentKm <= 0.0) return 1.0;

    float3 East, North;
    BuildSolarSkyBasis(Zenith, East, North);
    float3 OriginKm = 1e-3 * OriginMeters;
    float OpticalDepth = 0.0;
    static const float3 Nodes   = float3(0.11270167, 0.50000000, 0.88729833);
    static const float3 Weights = float3(0.27777778, 0.44444444, 0.27777778);
    [loop]
    for (uint Tap = 0u; Tap < 3u; ++Tap)
    {
        float Fraction = Nodes[Tap];
        float DistanceKm = EntryDistanceKm + Fraction * SegmentKm;
        float3 SampleKm = OriginKm + UnitDir * DistanceKm;
        float AltitudeKm = OriginAltitudeKm + DistanceKm * CosZenith;
        float LayerFraction = saturate((AltitudeKm - CloudBaseKm) / max(CloudTopKm - CloudBaseKm, 1e-4));
        float VerticalEnvelope = 4.0 * LayerFraction * (1.0 - LayerFraction);
        float HorizontalDensity = EvaluateSolarCloudPattern(dot(SampleKm, East), dot(SampleKm, North), CloudCoverage);
        OpticalDepth += CloudExtinctionKm * VerticalEnvelope * HorizontalDensity * (SegmentKm * Weights[Tap]);
    }
    return exp(-OpticalDepth);
}

//------------------------------------------------------------------------------------------------------------------------
//                                      CONTINUUM SKY AND LIMB-DARKENED SOLAR DISC
//------------------------------------------------------------------------------------------------------------------------

float3 SolarSkySegmentMeanFactor(float3 TauComponent, float3 TauTotal, float3 SegmentTransmittance)
{
    float3 SafeTotal = max(TauTotal, 1e-7);
    float3 Ratio = (TauComponent / SafeTotal) * (1.0 - SegmentTransmittance);
    return select(TauTotal > 1e-7, Ratio, 0.0);
}

float3 EvaluateSolarSkyContinuum(float3 OriginMeters, float3 Direction)
{
    float4 SunWord    = SolarSkyPayloadWord(0u);
    float4 ZenithWord = SolarSkyPayloadWord(1u);
    float4 IrradWord  = SolarSkyPayloadWord(2u);
    float4 LimbWord   = SolarSkyPayloadWord(3u);

    float3 Zenith  = Unit(ZenithWord.xyz);
    float3 UnitDir = Unit(Direction);
    float3 UnitSun = Unit(SunWord.xyz);

    float3 East, North;
    BuildSolarSkyBasis(Zenith, East, North);

    float LocalAltitudeKm = max(0.0, ZenithWord.w + 1e-3 * dot(OriginMeters, Zenith));
    float RadiusKm        = SolarSkyGroundRadiusKm + max(LocalAltitudeKm, 1e-3);
    float3 CanonicalPos   = float3(0.0, RadiusKm, 0.0);
    float3 CanonicalDir   = float3(dot(UnitDir, East), dot(UnitDir, Zenith), dot(UnitDir, North));
    float3 CanonicalSun   = float3(dot(UnitSun, East), dot(UnitSun, Zenith), dot(UnitSun, North));

    float ToGround = SolarSkyRaySphereAhead(CanonicalPos, CanonicalDir, SolarSkyGroundRadiusKm);
    float ToTop    = SolarSkyRaySphereAhead(CanonicalPos, CanonicalDir, SolarSkyTopRadiusKm);
    float LengthKm = ToTop;
    if (ToGround > 1e-4 && (LengthKm < 0.0 || ToGround < LengthKm))
        LengthKm = ToGround;

    float3 Single = 0.0;
    if (LengthKm > 0.0)
    {
        static const float Edges[7] = {0.0, 0.025, 0.09, 0.22, 0.44, 0.72, 1.0};
        float CosTheta = dot(CanonicalDir, CanonicalSun);
        float PhaseR   = SolarSkyRayleighPhase(CosTheta);
        float PhaseM   = SolarSkyCornetteShanksPhase(CosTheta, LimbWord.w);
        float3 ViewT   = 1.0;

        [loop]
        for (uint Step = 0u; Step < 6u; ++Step)
        {
            float T0 = LengthKm * Edges[Step];
            float T1 = LengthKm * Edges[Step + 1u];
            float Dt = T1 - T0;
            float3 At0 = CanonicalPos + CanonicalDir * T0;
            float3 At1 = CanonicalPos + CanonicalDir * T1;
            float3 SegDepth = SolarSkyOpticalDepthEndpointPair(At0, At1);
            float3 SegT     = exp(-SegDepth);

            float3 Mid = 0.5 * (At0 + At1);
            float SunGround = SolarSkyRaySphereAhead(Mid, CanonicalSun, SolarSkyGroundRadiusKm);
            if (SunGround < 0.0 || SunGround <= 1e-4)
            {
                float MidRadius  = length(Mid);
                float AltitudeKm = max(MidRadius - SolarSkyGroundRadiusKm, 0.0);
                float CosSun     = dot(Mid / max(MidRadius, 1e-6), CanonicalSun);
                float3 SunT      = SolarSkyTransmittanceToTop(MidRadius, CosSun, 6u);
                float DnsR       = SolarSkyRayleighDensity(AltitudeKm);
                float DnsM       = SolarSkyMieDensity(AltitudeKm);
                float3 SegR      = SolarSkyRayleighScatter * (DnsR * Dt);
                float3 SegM      = float3(SolarSkyMieScatter * (DnsM * Dt));
                float3 Scatter   = PhaseR * SolarSkySegmentMeanFactor(SegR, SegDepth, SegT) +
                                   PhaseM * SolarSkySegmentMeanFactor(SegM, SegDepth, SegT);
                Single += ViewT * SunT * IrradWord.xyz * Scatter;
            }
            ViewT *= SegT;
        }
    }

    float3 AverageT = 0.0;
    [loop]
    for (uint Ring = 0u; Ring < 4u; ++Ring)
    {
        float Mu = -0.75 + 0.5 * float(Ring);
        AverageT += 0.25 * SolarSkyTransmittanceToTop(RadiusKm, Mu, 6u);
    }
    float CosSunObs = dot(float3(0.0, 1.0, 0.0), CanonicalSun);
    float ObsGround = SolarSkyRaySphereAhead(CanonicalPos, CanonicalSun, SolarSkyGroundRadiusKm);
    float3 SunObsT  = (ObsGround < 0.0 || ObsGround <= 1e-4)
                        ? SolarSkyTransmittanceToTop(RadiusKm, CosSunObs, 16u)
                        : float3(0.0);
    float AirAlbedo  = clamp(0.6 * SolarSkyRayleighDensity(LocalAltitudeKm) + 0.1, 0.0, 0.9);
    float3 Psi       = clamp(AverageT * (AirAlbedo * 0.35) + LimbWord.z * 0.06, 0.0, 0.55);
    float3 MultiFactor = clamp(Psi / max(1.0 - Psi, 1e-4), 0.0, 1.2) * SunObsT;
    float3 ClearSky  = Single * (1.0 + IrradWord.w * MultiFactor);

    float CloudT = EvaluateSolarCloudTransmittance(OriginMeters, UnitDir);
    float CloudSunlit = max(0.0, dot(UnitSun, Zenith));
    float CloudInscatter = (1.0 - CloudT) * (0.18 + 0.52 * CloudSunlit) / SolarSkyPi;
    return max(0.0, ClearSky * CloudT + IrradWord.xyz * SunObsT * CloudInscatter);
}

float SolarDiscSolidAngle(out float OneMinusCosEdge)
{
    float AngularRadius = clamp(SolarSkyPayloadWord(0u).w, 5e-4, 0.35);
    float SinHalf = sin(0.5 * AngularRadius);
    OneMinusCosEdge = max(2.0 * SinHalf * SinHalf, 1e-9);
    return 2.0 * SolarSkyPi * OneMinusCosEdge;
}

float3 EvaluateSolarDiscRadiance(float3 OriginMeters, float3 Direction, out float DiscSolidAnglePdf)
{
    DiscSolidAnglePdf = 0.0;
    float4 SunWord    = SolarSkyPayloadWord(0u);
    float4 ZenithWord = SolarSkyPayloadWord(1u);
    float4 IrradWord  = SolarSkyPayloadWord(2u);
    float4 LimbWord   = SolarSkyPayloadWord(3u);

    float3 UnitSun = Unit(SunWord.xyz);
    float3 UnitDir = Unit(Direction);
    float3 Zenith  = Unit(ZenithWord.xyz);

    float OneMinusEdge = 0.0;
    float SolidAngle   = SolarDiscSolidAngle(OneMinusEdge);
    float3 Chord       = UnitDir - UnitSun;
    float OneMinusCos  = 0.5 * dot(Chord, Chord);
    if (OneMinusCos > OneMinusEdge) return 0.0;

    DiscSolidAnglePdf = 1.0 / SolidAngle;
    float CosZenith = dot(UnitDir, Zenith);
    if (CosZenith <= -0.02) return 0.0;

    float CapFraction = saturate(1.0 - OneMinusCos / OneMinusEdge);
    float MuLimb      = sqrt(CapFraction);
    float OneMinusMu  = 1.0 - MuLimb;
    float LimbProfile = max(0.0, 1.0 - LimbWord.x * OneMinusMu - LimbWord.y * OneMinusMu * OneMinusMu);
    float MeanLimb    = max(1e-5, 1.0 - LimbWord.x / 3.0 - LimbWord.y / 6.0);

    float LocalAltitudeKm = max(0.0, ZenithWord.w + 1e-3 * dot(OriginMeters, Zenith));
    float RadiusKm        = SolarSkyGroundRadiusKm + max(LocalAltitudeKm, 1e-3);
    float3 AtmosT         = SolarSkyTransmittanceToTop(RadiusKm, CosZenith, 24u);
    float CloudT          = EvaluateSolarCloudTransmittance(OriginMeters, UnitDir);
    return max(0.0, IrradWord.xyz * AtmosT * (CloudT * (LimbProfile / MeanLimb) * DiscSolidAnglePdf));
}

float3 EvaluateSkyTotalRadiance(float3 OriginMeters, float3 Direction)
{
    float UnusedPdf = 0.0;
    return EvaluateSolarSkyContinuum(OriginMeters, Direction) +
           EvaluateSolarDiscRadiance(OriginMeters, Direction, UnusedPdf);
}
