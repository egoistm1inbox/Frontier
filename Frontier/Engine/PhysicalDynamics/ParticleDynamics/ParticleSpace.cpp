/*==========================================================================================================================================
                                                            PARTICLESPACE.CPP
==========================================================================================================================================*/
// 🧩 The particle space and its refresh in C++ (the prototype's Scene): effects with their wind links, bursts, molecular sub-steps, the jobs, the guides.

#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleSpace.h"
#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleSpaceCodec.h"

#include <toml++/toml.hpp>

#include <algorithm>
#include <cmath>
#include <numbers>
#include <sstream>

namespace Frontier
{

namespace
{

using Point  = std::array<double, 3>;
using Colour = std::array<float, 4>;

constexpr uint32_t GuideVertexLimit = 4096;   // eos MAX_LINE_VERTS

void AppendGuide(std::vector<float>& Out, const Point& A, const Point& B, const Colour& Tint)
{
    for (const Point* End : { &A, &B })
    {
        Out.insert(Out.end(), { static_cast<float>((*End)[0]), static_cast<float>((*End)[1]), static_cast<float>((*End)[2]), Tint[0], Tint[1],
                                Tint[2], Tint[3] });
    }
}

void AppendCross(std::vector<float>& Out, const Point& Centre, double Size, const Colour& Tint)
{
    AppendGuide(Out, { Centre[0] - Size, Centre[1], Centre[2] }, { Centre[0] + Size, Centre[1], Centre[2] }, Tint);
    AppendGuide(Out, { Centre[0], Centre[1] - Size, Centre[2] }, { Centre[0], Centre[1] + Size, Centre[2] }, Tint);
    AppendGuide(Out, { Centre[0], Centre[1], Centre[2] - Size }, { Centre[0], Centre[1], Centre[2] + Size }, Tint);
}

void AppendBox(std::vector<float>& Out, const Point& Low, const Point& High, const Colour& Tint)
{
    const Point Corners[8] = { { Low[0], Low[1], Low[2] },  { High[0], Low[1], Low[2] },  { High[0], Low[1], High[2] },  { Low[0], Low[1], High[2] },
                               { Low[0], High[1], Low[2] }, { High[0], High[1], Low[2] }, { High[0], High[1], High[2] }, { Low[0], High[1], High[2] } };
    constexpr int Edges[12][2] = { { 0, 1 }, { 1, 2 }, { 2, 3 }, { 3, 0 }, { 4, 5 }, { 5, 6 }, { 6, 7 }, { 7, 4 }, { 0, 4 }, { 1, 5 }, { 2, 6 }, { 3, 7 } };
    for (const auto& Edge : Edges)
    {
        AppendGuide(Out, Corners[Edge[0]], Corners[Edge[1]], Tint);
    }
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    EFFECTS
//------------------------------------------------------------------------------------------------------------------------

double ParticleSpace::Random() noexcept
{
    // 📝 mulberry32, standing in for Math.random.
    RandomCounter  = RandomCounter + 0x6d2b79f5u;
    uint32_t Mixed = RandomCounter;
    Mixed          = (Mixed ^ (Mixed >> 15u)) * (Mixed | 1u);
    Mixed         ^= Mixed + (Mixed ^ (Mixed >> 7u)) * (Mixed | 61u);
    return static_cast<double>(Mixed ^ (Mixed >> 14u)) / 4294967296.0;
}

uint32_t ParticleSpace::CountFlowFields() const noexcept
{
    return static_cast<uint32_t>(std::count_if(Fields.begin(), Fields.end(), [](const ParticleField& Field)
                                               { return ResolveParticleFieldDescriptor(Field.Category).Contribution == ForceContribution::Flow; }));
}

void ParticleSpace::ApplyWindLink(const ParticlePreset& Preset)
{
    if (!Preset.WindLink)
    {
        return;
    }
    const ParticleWindLink& Link  = *Preset.WindLink;
    auto                    Found = std::find_if(Fields.begin(), Fields.end(), [&](const ParticleField& Field) { return Field.Category == Link.Category; });
    if (Found == Fields.end())
    {
        if (CountFlowFields() >= ParticleWindComponentLimit)
        {
            return;
        }
        ParticleField Field = ConstructParticleField(Link.Category);
        Field.Name          = Link.Name;
        Field.Enabled       = false;
        Field.Centre        = { 0.0, 0.0, 0.0 };
        Field.Radius        = 2.0;
        Field.Strength      = 4.0;
        Field.Rate          = 0.0;
        Field.Direction     = ResolveParticleFieldAlong(0.0);
        Fields.push_back(std::move(Field));
        Found = Fields.end() - 1;
    }
    if (Link.RadiusMetres) Found->Radius = *Link.RadiusMetres;
    if (Link.Strength) Found->Strength = *Link.Strength;
    if (Link.BearingDegrees) Found->Direction = ResolveParticleFieldAlong(*Link.BearingDegrees);
    if (Link.RateHz) Found->Rate = *Link.RateHz;
    if (Link.Local)
    {
        Found->Centre[0] = Preset.Parameters.OriginMetres[0];
        Found->Centre[2] = Preset.Parameters.OriginMetres[2];
    }
    Found->Enabled = true;
}

void ParticleSpace::SampleLevelForceField(const IFieldSampler& Field)
{
    if (!Field.QueryFieldEnabled())
    {
        if (LevelWind.FlowMps)
        {
            LevelWind.FlowMps.reset();
            AdvanceRevision();
        }
        return;
    }
    const Vec3d Anchor{ LevelWind.AnchorMetres[0], LevelWind.AnchorMetres[1], LevelWind.AnchorMetres[2] };
    const Vec3d Flow = Field.SampleFieldFlow(WorldToFieldAxes(Anchor), 0.0, true);
    const std::array<double, 3> Reading{ Flow.X, Flow.Y, Flow.Z };
    if (!LevelWind.FlowMps || *LevelWind.FlowMps != Reading)
    {
        LevelWind.FlowMps = Reading;
        AdvanceRevision();
    }
}

void ParticleSpace::SerializeDomainState(toml::table& Out) const
{
    Out = toml::parse(EncodeParticleSpace(*this));
}

void ParticleSpace::DeserializeDomainState(const toml::table& In)
{
    std::ostringstream Stream;
    Stream << In;
    ParticleSpace Loaded;
    std::string   Diagnostic;
    if (!DecodeParticleSpace(Stream.str(), Loaded, Diagnostic))
    {
        return;   // 📝 a malformed replication payload leaves the local space untouched
    }
    *this = std::move(Loaded);
    AdvanceRevision();
}

void ParticleSpace::ConstructDefault(const ParticleEffectLibrary& Library, const std::vector<std::string>* Presets)
{
    Effects.clear();
    FibrePaths.clear();
    Fields     = Library.Fields.empty() ? ConstructDefaultParticleFields() : Library.Fields;
    Wind       = Library.Wind;
    NextNumber = 1;
    Selected   = "Field";
    for (const std::string& Identifier : Presets ? *Presets : Library.DefaultScene)
    {
        const ParticlePreset* Preset = Library.ResolvePreset(Identifier);
        if (!Preset)
        {
            continue;
        }
        ApplyWindLink(*Preset);
        ParticleEffectInstance Effect;
        Effect.Token            = "fx_" + std::to_string(NextNumber);
        Effect.Number           = NextNumber++;
        Effect.PresetIdentifier = Preset->Identifier;
        Effect.Name             = Preset->Name;
        Effect.Parameters       = Preset->Parameters;
        Effects.push_back(std::move(Effect));
    }
}

ParticleEffectInstance* ParticleSpace::AddEffect(const ParticleEffectLibrary& Library, std::string_view PresetIdentifier)
{
    const ParticlePreset* Preset = Library.ResolvePreset(PresetIdentifier);
    if (!Preset)
    {
        return nullptr;
    }
    const auto Same = std::count_if(Effects.begin(), Effects.end(), [&](const ParticleEffectInstance& Effect) { return Effect.PresetIdentifier == PresetIdentifier; });
    ApplyWindLink(*Preset);
    ParticleEffectInstance Effect;
    Effect.Token            = "fx_" + std::to_string(NextNumber);
    Effect.Number           = NextNumber++;
    Effect.PresetIdentifier = Preset->Identifier;
    Effect.Name             = Same > 0 ? Preset->Name + " " + std::to_string(Same + 1) : Preset->Name;
    Effect.Parameters       = Preset->Parameters;
    Effects.push_back(std::move(Effect));
    Selected = Effects.back().Token;
    return &Effects.back();
}

ParticleEffectInstance* ParticleSpace::DuplicateEffect(const ParticleEffectLibrary& Library, std::string_view Token)
{
    const ParticleEffectInstance* Source = ResolveEffect(Token);
    if (!Source)
    {
        return nullptr;
    }
    // 📝 As the prototype's ConstructEffect, the copy switches its preset's wind on again.
    if (const ParticlePreset* Preset = Library.ResolvePreset(Source->PresetIdentifier))
    {
        ApplyWindLink(*Preset);
        Source = ResolveEffect(Token);
    }
    ParticleEffectInstance Copy;
    Copy.Token               = "fx_" + std::to_string(NextNumber);
    Copy.Number              = NextNumber++;
    Copy.PresetIdentifier    = Source->PresetIdentifier;
    Copy.Name                = Source->Name + " copy";
    Copy.Parameters          = Source->Parameters;
    Copy.Parameters.OriginMetres = { Source->Parameters.OriginMetres[0] + 1.0, Source->Parameters.OriginMetres[1],
                                     Source->Parameters.OriginMetres[2] + 1.0 };
    Effects.push_back(std::move(Copy));
    Selected = Effects.back().Token;
    return &Effects.back();
}

bool ParticleSpace::RemoveEffect(std::string_view Token)
{
    const auto Before = Effects.size();
    std::erase_if(Effects, [&](const ParticleEffectInstance& Effect) { return Effect.Token == Token; });
    std::erase_if(FibrePaths, [&](const FibrePathKey& Key) { return Key.Token == Token; });
    Selected = "Field";
    return Effects.size() != Before;
}

ParticleEffectInstance* ParticleSpace::ResolveEffect(std::string_view Token) noexcept
{
    const auto Found = std::find_if(Effects.begin(), Effects.end(), [&](const ParticleEffectInstance& Effect) { return Effect.Token == Token; });
    return Found == Effects.end() ? nullptr : &*Found;
}

void ParticleSpace::ResetEffects()
{
    for (ParticleEffectInstance& Effect : Effects)
    {
        Effect.NeedFill     = true;
        Effect.Head         = 0;
        Effect.Accumulated  = 0.0;
        Effect.PendingBurst = 0;
        ++Effect.StoreGeneration;
    }
    Lightning.Bolts.clear();
    Lightning.Flash = 0.0;
}

void ParticleSpace::ReceiveStrike(const std::array<double, 3>& Hit)
{
    for (ParticleEffectInstance& Effect : Effects)
    {
        if (Effect.PresetIdentifier == "strikeSparks")
        {
            Effect.PendingBurst += 160;
            Effect.OverrideOrigin = Hit;
        }
    }
}

std::array<double, 3> ParticleSpace::StrikeNow()
{
    const std::array<double, 3> Hit = Lightning.Strike(TimeSeconds);
    ReceiveStrike(Hit);
    return Hit;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    GUIDES AND PROBE
//------------------------------------------------------------------------------------------------------------------------

std::vector<float> ParticleSpace::ConstructGuides() const
{
    std::vector<float> Out;
    if (Wind.ShowDomain)
    {
        AppendBox(Out, ParticleDomainMinimum,
                  { ParticleDomainMinimum[0] + ParticleDomainSize[0], ParticleDomainMinimum[1] + ParticleDomainSize[1],
                    ParticleDomainMinimum[2] + ParticleDomainSize[2] },
                  { 0.45f, 0.6f, 0.85f, 0.55f });
    }
    for (const ParticleEffectInstance& Effect : Effects)
    {
        const ParticleEffectParameters& P = Effect.Parameters;
        if (!P.Visible)
        {
            continue;
        }
        const Point& Origin = P.OriginMetres;
        const bool   Chosen = Selected == Effect.Token;
        AppendCross(Out, Origin, 0.12, Chosen ? Colour{ 1.0f, 0.75f, 0.25f, 1.0f } : Colour{ 0.6f, 0.65f, 0.75f, 0.6f });
        if (EvaluateParticleMolecular(P))
        {
            const double Half = P.BoxHalfMetres[0];
            AppendBox(Out, { Origin[0] - Half, Origin[1] - Half, Origin[2] - Half }, { Origin[0] + Half, Origin[1] + Half, Origin[2] + Half },
                      Chosen ? Colour{ 1.0f, 0.75f, 0.25f, 0.9f } : Colour{ 0.5f, 0.9f, 1.0f, 0.35f });
        }
        if (P.ReleaseShape == ParticleReleaseShape::Box && static_cast<uint32_t>(P.Behaviour) < 3u)
        {
            const Point& Half = P.BoxHalfMetres;
            AppendBox(Out, { Origin[0] - Half[0], Origin[1] - Half[1], Origin[2] - Half[2] },
                      { Origin[0] + Half[0], Origin[1] + Half[1], Origin[2] + Half[2] }, { 0.6f, 0.7f, 0.9f, 0.3f });
        }
    }
    if (ProbeEnabled)
    {
        AppendCross(Out, Probe, 0.18, { 1.0f, 0.9f, 0.3f, 1.0f });
    }
    Out.resize(std::min<size_t>(Out.size(), static_cast<size_t>(GuideVertexLimit) * 7u));
    return Out;
}

std::array<uint32_t, 3> ParticleSpace::ResolveProbeCell() const noexcept
{
    std::array<uint32_t, 3> Cell{};
    for (int Axis = 0; Axis < 3; ++Axis)
    {
        const double Size  = ParticleDomainSize[Axis] / ParticleDomainDimensions[Axis];
        const double Index = std::floor((Probe[Axis] - ParticleDomainMinimum[Axis]) / Size);
        Cell[Axis] = static_cast<uint32_t>(std::clamp(Index, 0.0, static_cast<double>(ParticleDomainDimensions[Axis] - 1)));
    }
    return Cell;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    REFRESH
//------------------------------------------------------------------------------------------------------------------------

ParticleRefreshPlan ParticleSpace::Advance(double RealDeltaSeconds, uint32_t ViewWidth, uint32_t ViewHeight,
                                           const ParticleCameraPose* CameraOverride,
                                           const IFieldSampler* SharedFieldSampler)
{
    ParticleRefreshPlan Plan;
    Plan.ViewWidth  = std::max(1u, ViewWidth);
    Plan.ViewHeight = std::max(1u, ViewHeight);
    const double RealDelta = std::clamp(RealDeltaSeconds, 0.0, 0.05);
    if (RealDelta > 0.0)
    {
        RefreshRate = RefreshRate * 0.9 + (1.0 / RealDelta) * 0.1;
    }
    const double Delta = Playing ? RealDelta * TimeScale : 0.0;
    TimeSeconds += Delta;
    ++Step;

    for (const std::array<double, 3>& Hit : Lightning.Advance(Delta, TimeSeconds))
    {
        ReceiveStrike(Hit);
    }
    if (LightningWeb.Enabled && TimeSeconds >= LightningWeb.NextSeconds)
    {
        std::vector<std::array<double, 3>> Origins;
        for (const ParticleEffectInstance& Effect : Effects)
        {
            if (Effect.Parameters.Visible)
            {
                Origins.push_back(Effect.Parameters.OriginMetres);
            }
        }
        if (Origins.size() >= 2)
        {
            Lightning.Web(TimeSeconds, Origins, LightningWeb.Links, LightningWeb.IntervalSeconds * 0.9);
        }
        LightningWeb.NextSeconds = TimeSeconds + LightningWeb.IntervalSeconds;
    }

    const double Aspect = static_cast<double>(Plan.ViewWidth) / static_cast<double>(std::max(1u, Plan.ViewHeight));
    const double VerticalFieldOfView = CameraOverride != nullptr ? CameraOverride->VerticalFieldOfView : std::numbers::pi / 4.0;
    Plan.Camera = CameraOverride != nullptr ? ResolveParticleCamera(*CameraOverride, Aspect) : ResolveParticleCamera(Camera, Aspect);
    Plan.SharedFieldActive = LevelWind.Follow && SharedFieldSampler != nullptr && SharedFieldSampler->QueryFieldEnabled();
    if (LevelWind.Follow && SharedFieldSampler != nullptr) SampleLevelForceField(*SharedFieldSampler);
    if (Plan.SharedFieldActive)
    {
        const Vec3d Origin = WorldToFieldAxes({ LevelWind.AnchorMetres[0], LevelWind.AnchorMetres[1], LevelWind.AnchorMetres[2] });
        Plan.SharedFieldOriginMetres = { Origin.X, Origin.Y, Origin.Z };
    }

    // 📝 A followed native ForceField already includes ambient wind and authored environmental flows. Do not also pack
    //    Particle's legacy flow generators into the same lattice; its acceleration and damping fields below remain local.
    std::vector<ParticleField> Flowing;
    if (!Plan.SharedFieldActive) Flowing.assign(Fields.begin(), Fields.end());
    if (!Plan.SharedFieldActive && LevelWind.Follow && LevelWind.FlowMps && CountFlowFields() < ParticleWindComponentLimit)
    {
        const double Speed = std::hypot((*LevelWind.FlowMps)[0], (*LevelWind.FlowMps)[2]);
        if (Speed > 1.0e-6)
        {
            ParticleField Level = ConstructParticleField(ParticleFieldCategory::Prevailing);
            Level.Name          = "Level wind";
            Level.Enabled       = true;
            Level.Strength      = Speed;
            Level.Direction     = { (*LevelWind.FlowMps)[0] / Speed, 0.0, (*LevelWind.FlowMps)[2] / Speed };
            Level.Rate          = 0.0;
            Flowing.push_back(std::move(Level));
        }
    }
    const ParticleFieldPayloads Flow = ResolveParticleFieldPayloads(Flowing);
    ParticleRefreshReadings     Readings;
    Readings.TimeSeconds    = TimeSeconds;
    Readings.DeltaSeconds   = Delta;
    Readings.Step           = Step;
    Readings.LightningFlash = Lightning.Flash;
    Readings.FlowCount      = static_cast<uint32_t>(Flow.Lattice.size());
    PackParticleRefreshConstants(Plan.Constants, Plan.Camera, Wind, Readings);
    PackParticleWindComponents(Plan.Components, Flow.Lattice);

    for (uint32_t Index = 0; Index < Effects.size(); ++Index)
    {
        ParticleEffectInstance&         Effect = Effects[Index];
        const ParticleEffectParameters& P      = Effect.Parameters;
        if (!P.Visible)
        {
            continue;
        }
        ParticleRefreshJob Job;
        Job.EffectIndex = Index;
        if (P.Behaviour == ParticleBehaviour::LightFibre && P.LightFibre)
        {
            // 📝 Light fibres are analytic: a uniform and, when the trail's path changed, its arc-length samples.
            const LightFibreParameters& Fibre = *P.LightFibre;
            const std::string           Key   = Fibre.PathShape + "|" + std::to_string(Fibre.PathSizeMetres);
            auto Cached = std::find_if(FibrePaths.begin(), FibrePaths.end(), [&](const FibrePathKey& Entry) { return Entry.Token == Effect.Token; });
            if (Cached == FibrePaths.end() || Cached->Generation != Effect.StoreGeneration || Cached->Key != Key)
            {
                Job.FibrePath = SampleLightFibrePath(Fibre.PathShape, Fibre.PathSizeMetres);
                if (Cached == FibrePaths.end())
                {
                    FibrePaths.push_back({ Effect.Token, Effect.StoreGeneration, Key });
                }
                else
                {
                    *Cached = { Effect.Token, Effect.StoreGeneration, Key };
                }
            }
            LightFibreRefresh FibreRefresh;
            FibreRefresh.LoopFraction    = std::fmod(TimeSeconds / Fibre.LoopSeconds, 1.0);
            FibreRefresh.ProjectionScale = (0.5 * Plan.ViewHeight) / std::tan(VerticalFieldOfView * 0.5);
            FibreRefresh.ViewWidth       = Plan.ViewWidth;
            FibreRefresh.ViewHeight      = Plan.ViewHeight;
            PackLightFibreUniform(Job.FibreUniform, P, FibreRefresh);
            Job.LightFibre = true;
            Job.Strands    = static_cast<uint32_t>(std::max(0, Fibre.Strands));
            Job.Segments   = static_cast<uint32_t>(std::max(0, Fibre.Segments));
            Job.Sparks     = Fibre.Sparks > 0.0;
            Plan.Jobs.push_back(std::move(Job));
            continue;
        }
        const uint32_t Capacity  = ResolveParticleCapacity(P);
        const bool     Molecular = EvaluateParticleMolecular(P);
        const bool     Simulate  = Playing && Delta > 0.0;
        uint32_t       Release   = 0;
        uint32_t       Steps     = 0;
        double         StepDelta = Delta;
        uint32_t       Head      = Effect.Head;
        Point          Origin    = P.OriginMetres;
        if (Simulate)
        {
            if (P.BurstEverySeconds > 0.0)
            {
                Effect.BurstTimerSeconds = Effect.BurstTimerSeconds.value_or(0.0) - Delta;
                if (*Effect.BurstTimerSeconds <= 0.0)
                {
                    Effect.BurstTimerSeconds = P.BurstEverySeconds * (0.7 + 0.6 * Random());
                    Effect.PendingBurst += static_cast<uint32_t>(std::max(0, P.BurstCount));
                    if (P.BurstAtOrigin)
                    {
                        Effect.OverrideOrigin.reset();
                    }
                    else
                    {
                        const double X = -3.0 + 6.0 * Random();
                        const double Y = 3.5 + 2.5 * Random();
                        const double Z = -3.0 + 6.0 * Random();
                        Effect.OverrideOrigin = Point{ X, Y, Z };
                    }
                }
            }
            if (Effect.OverrideOrigin)
            {
                Origin = *Effect.OverrideOrigin;
                Effect.OverrideOrigin.reset();
            }
            if (Molecular)
            {
                // 📝 Sub-steps at or below 1.25 × the integration step keep the Lennard-Jones forces stable when the rate drops.
                Steps     = static_cast<uint32_t>(std::clamp(std::round(Delta / P.IntegrationStepSeconds), 1.0, 8.0));
                StepDelta = std::min(Delta / Steps, P.IntegrationStepSeconds * 1.25);
                if (Effect.NeedFill)
                {
                    Release         = Capacity;
                    Effect.NeedFill = false;
                    Head            = 0;
                }
            }
            else
            {
                Effect.Accumulated += P.ReleaseRate * Delta;
                const double Whole = std::floor(Effect.Accumulated);
                Effect.Accumulated -= Whole;
                Release             = std::min<uint32_t>(Capacity, static_cast<uint32_t>(Whole) + Effect.PendingBurst);
                Effect.PendingBurst = 0;
                Effect.Head         = (Head + Release) % Capacity;
            }
        }
        const uint32_t        Grid = ResolveParticleGridDimension(P);
        ParticleEffectRefresh Refresh;
        Refresh.OriginMetres  = Origin;
        Refresh.StepSeconds   = StepDelta;
        Refresh.TimeSeconds   = TimeSeconds;
        Refresh.Step          = Step;
        Refresh.Capacity      = Capacity;
        Refresh.ReleaseCount  = Release;
        Refresh.Head          = Head;
        Refresh.Seed          = Step * 7919u + Effect.Number * 104729u;
        Refresh.Molecular     = Molecular;
        Refresh.GridDimension = Grid;
        Refresh.CellMetres    = Molecular ? (2.0 * P.BoxHalfMetres[0]) / Grid : 1.0;
        PackParticleEffectUniform(Job.Uniform, P, Refresh);
        Job.Simulate      = Simulate;
        Job.Molecular     = Molecular;
        Job.Release       = Release;
        Job.Steps         = Steps;
        Job.GridDimension = Grid;
        Job.Swarm         = P.Behaviour == ParticleBehaviour::Flocking;
        Job.ReadCensus    = Simulate && Step % 3u == 0u;
        Job.Rasterize     = true;
        Job.AlphaOver     = P.Blend == ParticleBlend::AlphaOver;
        Job.Cube          = P.Appearance == ParticleAppearance::Cube;
        Job.Shards        = P.Transition && P.Transition->Fragment;
        Job.Butterflies   = P.Transition && P.Transition->Butterflies;
        Plan.Jobs.push_back(std::move(Job));
    }

    Plan.SegmentCount = Lightning.Pack(TimeSeconds, Plan.Segments);
    Plan.Guides       = ConstructGuides();
    if (ProbeEnabled && Step % 4u == 0u)
    {
        Plan.ProbeCell = ResolveProbeCell();
    }
    std::vector<ParticleEffectPlacement> Placements;
    Placements.reserve(Effects.size());
    for (const ParticleEffectInstance& Effect : Effects)
    {
        Placements.push_back({ &Effect.Parameters });
    }
    Plan.LensingCounts = PackParticleLensing(Plan.Lensing, Placements, Plan.Camera, Aspect, TimeSeconds, VerticalFieldOfView);
    PackParticleAccelerationFields(Plan.Fields, Placements, ResolveParticleFieldPayloads(Fields, TimeSeconds).Accelerations, TimeSeconds);
    const float Flash = static_cast<float>(Lightning.Flash * 0.22);
    Plan.Clear  = { 0.035f + Flash, 0.037f + Flash, 0.045f + Flash };
    Plan.Floor  = Wind.ShowFloor;
    Plan.Arrows = Wind.ShowArrows;
    return Plan;
}

} // namespace Frontier
