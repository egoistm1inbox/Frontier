/*==========================================================================================================================================
                                                        PARTICLELIBRARYVALIDATION.CPP
==========================================================================================================================================*/
// 🧩 The C++ Particle editor's library and GPU payloads against the approved prototype: the 52 presets decoded from
//    ParticleLibrary.particlespace, every effect uniform, light-fibre uniform and path samples, the refresh constants, the wind
//    components, the acceleration fields, the lensing block and the eos force taxonomy's readings.
//
//     ParticleLibraryValidation <repository root>
//
// 📝 The reference is Exhibits/ParticleEditor/Results/PackingReference.toml (ExportPackingReference.mjs). Float payloads must
//    match bit for bit except the fibre paths and the camera-derived values, which go through sin, cos, tan and atan2 (V8's
//    fdlibm against the C library) and may differ by one unit in the last place; those report their exact share.

#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleEffectLibrary.h"
#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleFieldTaxonomy.h"
#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleLightning.h"
#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleUniformPacking.h"

#include <toml++/toml.hpp>

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <map>
#include <string>
#include <vector>

using namespace Frontier;

namespace
{

int Failures = 0;
int Assertions = 0;

void Expect(bool Condition, const std::string& Claim)
{
    ++Assertions;
    if (!Condition)
    {
        ++Failures;
        std::printf("  🔴 %s\n", Claim.c_str());
    }
}

template <typename NodeView>
std::vector<double> ReadNumbers(const NodeView& View)
{
    std::vector<double> Values;
    if (const toml::array* Array = View.as_array())
    {
        for (const toml::node& Entry : *Array)
        {
            Values.push_back(Entry.value<double>().value_or(std::nan("")));
        }
    }
    return Values;
}

// 📝 Distance in float units in the last place; signed zeros and equal values are 0.
uint32_t UnitsApart(float A, float B)
{
    if (A == B)
    {
        return 0;
    }
    if (std::isnan(A) || std::isnan(B))
    {
        return 0xffffffffu;
    }
    const auto Ordered = [](float Value)
    {
        const int32_t Bits = std::bit_cast<int32_t>(Value);
        return Bits < 0 ? static_cast<int64_t>(INT32_MIN) - Bits : static_cast<int64_t>(Bits);
    };
    const int64_t Apart = Ordered(A) - Ordered(B);
    return static_cast<uint32_t>(std::min<int64_t>(std::llabs(Apart), 0xffffffffll));
}

struct FloatComparison
{
    size_t   Values      = 0;
    size_t   Exact       = 0;
    uint32_t Largest     = 0;     // ulp
    double   LargestGap  = 0.0;   // absolute
    size_t   Unexplained = 0;     // values more than 4 ulp and more than 1e-9 apart
};

FloatComparison CompareFloats(std::span<const float> Packed, const std::vector<double>& Reference)
{
    FloatComparison Result;
    Result.Values = Reference.size();
    if (Packed.size() != Reference.size())
    {
        Result.Largest = 0xffffffffu;
        return Result;
    }
    for (size_t Index = 0; Index < Packed.size(); ++Index)
    {
        const float    Expected = static_cast<float>(Reference[Index]);
        const uint32_t Apart    = UnitsApart(Packed[Index], Expected);
        const double   Gap      = std::fabs(static_cast<double>(Packed[Index]) - static_cast<double>(Expected));
        Result.Exact += Apart == 0 ? 1 : 0;
        Result.Largest    = std::max(Result.Largest, Apart);
        Result.LargestGap = std::max(Result.LargestGap, Gap);
        Result.Unexplained += (Apart > 4 && Gap > 1e-9) ? 1 : 0;
    }
    return Result;
}

double RelativeError(double A, double B)
{
    const double Scale = std::max({ std::fabs(A), std::fabs(B), 1e-300 });
    return A == B ? 0.0 : std::fabs(A - B) / Scale;
}

} // namespace

int main(int ArgumentCount, char** Arguments)
{
    const std::filesystem::path Root = ArgumentCount > 1 ? Arguments[1] : ".";
    std::printf("🧩 ParticleLibraryValidation\n");

    //--------------------------------------------------------------------------------------------------------------------
    //                                                LIBRARY
    //--------------------------------------------------------------------------------------------------------------------

    ParticleEffectLibrary Library;
    std::string           Diagnostic;
    if (!Library.Decode(Root / "EngineContent/ParticleArchives/ParticleLibrary.particlespace", Diagnostic))
    {
        std::printf("  🔴 ParticleLibrary.particlespace: %s\n", Diagnostic.c_str());
        return 1;
    }
    std::map<int, int> Behaviours;
    for (const ParticlePreset& Preset : Library.Presets)
    {
        ++Behaviours[static_cast<int>(Preset.Parameters.Behaviour)];
        Expect(!Preset.Group.empty() && !Preset.Blurb.empty(), Preset.Identifier + " carries its group and blurb");
        Expect(Preset.Parameters.LightFibre.has_value() == (Preset.Parameters.Behaviour == ParticleBehaviour::LightFibre),
               Preset.Identifier + " has light-fibre parameters exactly when it is a light fibre");
        if (Preset.Parameters.LightFibre)
        {
            Expect(ResolveLightFibrePathIndex(Preset.Parameters.LightFibre->PathShape) >= 0,
                   Preset.Identifier + " follows a known path");
            Expect(!Preset.Parameters.LightFibre->Stops.empty(), Preset.Identifier + " has colour stops");
        }
    }
    Expect(Library.Presets.size() == 52, "52 presets");
    Expect(Library.Groups.size() == 14, "14 groups");
    Expect(Library.DefaultScene == std::vector<std::string>{ "sparks", "leaves", "atoms", "chemicals" },
           "the default scene is sparks, leaves, atoms and chemicals");
    Expect(Behaviours[0] == 14 && Behaviours[1] == 10 && Behaviours[3] == 1 && Behaviours[4] == 1 && Behaviours[5] == 19
           && Behaviours[6] == 2 && Behaviours[7] == 5, "behaviours 14 / 10 / 1 / 1 / 19 / 2 / 5");
    Expect(Library.Fields.size() == 4 && Library.Fields[0].Enabled && Library.Fields[1].Enabled && !Library.Fields[2].Enabled
           && !Library.Fields[3].Enabled, "the default force list: prevailing and gust on, tornado and suction off");
    Expect(Library.Wind.Turbulence == 0.35 && Library.Wind.Swirl == 1.2 && !Library.Wind.ShowArrows, "the default wind");
    const ParticlePreset* Tornado = Library.ResolvePreset("tornado");
    Expect(Tornado && Tornado->WindLink && Tornado->WindLink->Category == ParticleFieldCategory::Tornado && Tornado->WindLink->Local
           && Tornado->WindLink->RadiusMetres == 2.4 && Tornado->WindLink->Strength == 9.0, "the tornado preset links its column");
    std::printf("  library: %zu presets, %zu groups, %zu default fields\n", Library.Presets.size(), Library.Groups.size(),
                Library.Fields.size());

    //--------------------------------------------------------------------------------------------------------------------
    //                                                REFERENCE
    //--------------------------------------------------------------------------------------------------------------------

    const std::filesystem::path ReferencePath = Root / "Exhibits/ParticleEditor/Results/PackingReference.toml";
    toml::table                 Reference;
    try
    {
        Reference = toml::parse_file(ReferencePath.string());
    }
    catch (const toml::parse_error& Error)
    {
        std::printf("  🔴 PackingReference.toml: %s\n", std::string(Error.description()).c_str());
        return 1;
    }
    const toml::table& Refresh      = *Reference["refresh"].as_table();
    const double       TimeSeconds  = Refresh["time_seconds"].value<double>().value_or(0.0);
    const double       DeltaSeconds = Refresh["delta_seconds"].value<double>().value_or(0.0);
    const uint32_t     Step         = static_cast<uint32_t>(Refresh["step"].value<int64_t>().value_or(0));
    const uint32_t     Release      = static_cast<uint32_t>(Refresh["release_count"].value<int64_t>().value_or(0));
    const uint32_t     Head         = static_cast<uint32_t>(Refresh["head"].value<int64_t>().value_or(0));
    const double       ViewWidth    = Refresh["view_width"].value<double>().value_or(1.0);
    const double       ViewHeight   = Refresh["view_height"].value<double>().value_or(1.0);
    const double       Flash        = Refresh["lightning_flash"].value<double>().value_or(0.0);

    //--------------------------------------------------------------------------------------------------------------------
    //                                                EFFECT UNIFORMS
    //--------------------------------------------------------------------------------------------------------------------

    size_t EffectValues = 0, EffectExact = 0, FibreValues = 0, FibreExact = 0, EffectsSeen = 0;
    if (const toml::array* Effects = Reference["effect"].as_array())
    {
        for (const toml::node& Entry : *Effects)
        {
            const toml::table&    Effect     = *Entry.as_table();
            const std::string     Identifier = Effect["identifier"].value<std::string>().value_or("");
            const ParticlePreset* Preset     = Library.ResolvePreset(Identifier);
            if (!Preset)
            {
                Expect(false, "the library holds " + Identifier);
                continue;
            }
            ++EffectsSeen;
            const ParticleEffectParameters& P      = Preset->Parameters;
            const uint32_t                  Number = static_cast<uint32_t>(Effect["number"].value<int64_t>().value_or(0));
            Expect(ResolveParticleCapacity(P) == static_cast<uint32_t>(Effect["capacity"].value<int64_t>().value_or(0)),
                   Identifier + " capacity");
            if (P.Behaviour == ParticleBehaviour::LightFibre)
            {
                LightFibreUniform Packed{};
                LightFibreRefresh FibreRefresh;
                FibreRefresh.LoopFraction    = std::fmod(TimeSeconds / P.LightFibre->LoopSeconds, 1.0);
                FibreRefresh.ProjectionScale = (0.5 * ViewHeight) / std::tan(std::numbers::pi / 8.0);
                FibreRefresh.ViewWidth       = ViewWidth;
                FibreRefresh.ViewHeight      = ViewHeight;
                PackLightFibreUniform(Packed, P, FibreRefresh);
                const FloatComparison Result = CompareFloats(Packed, ReadNumbers(Effect["fibre_uniform"]));
                FibreValues += Result.Values;
                FibreExact += Result.Exact;
                // 📝 The projection scale goes through tan: one unit in the last place is allowed there only.
                Expect(Result.Largest <= 1 && Result.Exact + 1 >= Result.Values, Identifier + " light-fibre uniform matches");
                continue;
            }
            const bool     Molecular = EvaluateParticleMolecular(P);
            const uint32_t Grid      = ResolveParticleGridDimension(P);
            const uint32_t Steps     = Molecular ? static_cast<uint32_t>(std::clamp(std::round(DeltaSeconds / P.IntegrationStepSeconds), 1.0,
                                                                                    8.0))
                                                 : 0u;
            Expect(Grid == static_cast<uint32_t>(Effect["grid_dimension"].value<int64_t>().value_or(0)), Identifier + " lattice size");
            Expect(Steps == static_cast<uint32_t>(Effect["molecular_steps"].value<int64_t>().value_or(0)), Identifier + " sub-steps");
            ParticleEffectRefresh EffectRefresh;
            EffectRefresh.OriginMetres  = P.OriginMetres;
            EffectRefresh.StepSeconds   = Molecular ? std::min(DeltaSeconds / Steps, P.IntegrationStepSeconds * 1.25) : DeltaSeconds;
            EffectRefresh.TimeSeconds   = TimeSeconds;
            EffectRefresh.Step          = Step;
            EffectRefresh.Capacity      = ResolveParticleCapacity(P);
            EffectRefresh.ReleaseCount  = Release;
            EffectRefresh.Head          = Head;
            EffectRefresh.Seed          = Step * 7919u + Number * 104729u;
            EffectRefresh.Molecular     = Molecular;
            EffectRefresh.GridDimension = Grid;
            EffectRefresh.CellMetres    = Molecular ? (2.0 * P.BoxHalfMetres[0]) / Grid : 1.0;
            ParticleEffectUniform Packed{};
            PackParticleEffectUniform(Packed, P, EffectRefresh);
            const FloatComparison Result = CompareFloats(Packed, ReadNumbers(Effect["uniform"]));
            EffectValues += Result.Values;
            EffectExact += Result.Exact;
            Expect(Result.Values == 64 && Result.Exact == 64, Identifier + " effect uniform matches bit for bit (largest "
                                                                  + std::to_string(Result.Largest) + " ulp)");
        }
    }
    Expect(EffectsSeen == 52, "every preset has a reference uniform");
    std::printf("  effect uniforms: %zu / %zu floats exact; light-fibre uniforms: %zu / %zu exact\n", EffectExact, EffectValues,
                FibreExact, FibreValues);

    //--------------------------------------------------------------------------------------------------------------------
    //                                                FIBRE PATHS
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Where a curve crosses zero (cos π/2 and the like) the two sine and cosine implementations leave different residues
    //    near 1e-13 m; those are millions of ulp apart and nothing in metres, so a value passes within 4 ulp or 1e-9 m.
    size_t PathValues = 0, PathExact = 0, PathUnexplained = 0;
    double PathGap = 0.0;
    if (const toml::array* Paths = Reference["fibre_path"].as_array())
    {
        for (const toml::node& Entry : *Paths)
        {
            const toml::table&        Path    = *Entry.as_table();
            const std::string         Shape   = Path["shape"].value<std::string>().value_or("");
            const std::vector<double> Planar  = ReadNumbers(Path["planar"]);
            const std::vector<float>  Sampled = SampleLightFibrePath(Shape, Path["size_metres"].value<double>().value_or(5.0));
            std::vector<float>        Pairs;
            for (size_t Sample = 0; Sample < Sampled.size() / 4; ++Sample)
            {
                Pairs.push_back(Sampled[Sample * 4]);
                Pairs.push_back(Sampled[Sample * 4 + 1]);
            }
            const FloatComparison Result = CompareFloats(Pairs, Planar);
            PathValues += Result.Values;
            PathExact += Result.Exact;
            PathUnexplained += Result.Unexplained;
            PathGap = std::max(PathGap, Result.LargestGap);
            Expect(Result.Values == LightFibrePathSamples * 2 && Result.Unexplained == 0, Shape + " path within 4 ulp or 1e-9 m");
        }
    }
    std::printf("  fibre paths: %zu / %zu floats exact, the rest within %.3g m (%zu beyond the tolerance)\n", PathExact, PathValues,
                PathGap, PathUnexplained);

    //--------------------------------------------------------------------------------------------------------------------
    //                                                SCENE PAYLOADS
    //--------------------------------------------------------------------------------------------------------------------

    std::vector<ParticleField> Fields;
    if (!DecodeParticleFields(ReferencePath, Fields, Diagnostic))
    {
        std::printf("  🔴 reference forces: %s\n", Diagnostic.c_str());
        return 1;
    }
    const toml::table& Scene       = *Reference["scene"].as_table();
    const double       SceneTime   = Scene["time_seconds"].value<double>().value_or(0.0);
    const double       Aspect      = Scene["aspect"].value<double>().value_or(1.0);
    const auto         CameraSpecs = ReadNumbers(Scene["camera"]);
    ParticleOrbitCamera Orbit;
    Orbit.Yaw      = CameraSpecs[0];
    Orbit.Pitch    = CameraSpecs[1];
    Orbit.Distance = CameraSpecs[2];
    Orbit.Target   = { CameraSpecs[3], CameraSpecs[4], CameraSpecs[5] };
    const ParticleCameraReading Camera   = ResolveParticleCamera(Orbit, Aspect);
    const ParticleFieldPayloads Payloads = ResolveParticleFieldPayloads(Fields);
    Expect(Payloads.Lattice.size() == static_cast<size_t>(Scene["flow_count"].value<int64_t>().value_or(-1)), "flow component count");

    ParticleWindSettings Wind = Library.Wind;
    ParticleRefreshReadings Readings;
    Readings.TimeSeconds    = TimeSeconds;
    Readings.DeltaSeconds   = DeltaSeconds;
    Readings.Step           = Step;
    Readings.LightningFlash = Flash;
    Readings.FlowCount      = static_cast<uint32_t>(Payloads.Lattice.size());
    ParticleRefreshConstants Constants{};
    PackParticleRefreshConstants(Constants, Camera, Wind, Readings);
    const FloatComparison ConstantsResult = CompareFloats(Constants, ReadNumbers(Scene["refresh_constants"]));
    Expect(ConstantsResult.Values == 52 && ConstantsResult.Largest <= 1, "refresh constants within 1 ulp");

    ParticleWindComponents Components{};
    PackParticleWindComponents(Components, Payloads.Lattice);
    const FloatComparison ComponentsResult = CompareFloats(Components, ReadNumbers(Scene["wind_components"]));
    Expect(ComponentsResult.Values == 128 && ComponentsResult.Largest <= 1, "wind components within 1 ulp");

    std::vector<ParticleEffectPlacement> Placements;
    for (const char* Identifier : { "black-hole", "magnetic-particles", "heat-shimmer" })
    {
        const ParticlePreset* Preset = Library.ResolvePreset(Identifier);
        Placements.push_back({ Preset ? &Preset->Parameters : nullptr });
    }
    const ParticleFieldPayloads Timed = ResolveParticleFieldPayloads(Fields, SceneTime);
    // 📝 The prototype packs no drag volume or current (no GPU path in eos); the C++ engine packs them as types 4 and 5. Parity
    //    is checked on the prototype's own entries, and the extension apart.
    std::vector<ParticleAccelerationEntry> PrototypeEntries;
    size_t                                 BoxEntries = 0;
    for (const ParticleAccelerationEntry& Entry : Timed.Accelerations)
    {
        if (Entry.Slot >= 4) ++BoxEntries;
        else PrototypeEntries.push_back(Entry);
    }
    ParticleAccelerationBlock Accelerations{};
    PackParticleAccelerationFields(Accelerations, Placements, PrototypeEntries, SceneTime);
    const FloatComparison AccelerationResult = CompareFloats(Accelerations, ReadNumbers(Scene["acceleration_fields"]));
    Expect(AccelerationResult.Values == 128 && AccelerationResult.Exact == 128, "acceleration fields match bit for bit");
    Expect(BoxEntries > 0, "the reference's drag volume and current reach the field program (types 4 and 5)");

    ParticleLensingBlock Lensing{};
    const ParticleLensingReading LensingCounts = PackParticleLensing(Lensing, Placements, Camera, Aspect, SceneTime);
    const FloatComparison        LensingResult = CompareFloats(Lensing, ReadNumbers(Scene["lensing"]));
    Expect(LensingCounts.HoleCount == static_cast<uint32_t>(Scene["lensing_count"].value<int64_t>().value_or(-1))
           && LensingCounts.ShimmerCount == static_cast<uint32_t>(Scene["shimmer_count"].value<int64_t>().value_or(-1)),
           "one black hole and one shimmer on screen");
    Expect(LensingResult.Values == 32 && LensingResult.Largest <= 1, "lensing block within 1 ulp");
    std::printf("  refresh constants %zu / 52 exact (largest %u ulp); wind components %zu / 128 (%u); acceleration fields "
                "%zu / 128; lensing %zu / 32 (%u)\n",
                ConstantsResult.Exact, ConstantsResult.Largest, ComponentsResult.Exact, ComponentsResult.Largest,
                AccelerationResult.Exact, LensingResult.Exact, LensingResult.Largest);

    //--------------------------------------------------------------------------------------------------------------------
    //                                                TAXONOMY
    //--------------------------------------------------------------------------------------------------------------------

    Fields[6].ActsOn  = { "debris" };
    Fields[11].ActsOn = { "leaves", "debris" };
    const std::vector<std::vector<std::string>> Channels = { {}, { "debris" }, { "leaves" } };
    double WorstSample = 0.0, WorstResolved = 0.0, WorstAdvanced = 0.0;
    size_t ReadingCount = 0, FlowingMismatches = 0;
    if (const toml::array* Records = Reference["reading"].as_array())
    {
        for (const toml::node& Entry : *Records)
        {
            const toml::table&          Record = *Entry.as_table();
            const double                Time   = Record["time_seconds"].value<double>().value_or(0.0);
            const std::vector<double>   AtList = ReadNumbers(Record["at_metres"]);
            const std::array<double, 3> At     = { AtList[0], AtList[1], AtList[2] };
            const std::vector<double>   Each   = ReadNumbers(Record["each"]);
            for (size_t Index = 0; Index < Fields.size(); ++Index)
            {
                const std::array<double, 3> Sample = SampleParticleField(Fields[Index], At, Time);
                for (size_t Axis = 0; Axis < 3; ++Axis)
                {
                    WorstSample = std::max(WorstSample, RelativeError(Sample[Axis], Each[Index * 3 + Axis]));
                }
            }
            for (size_t Set = 0; Set < Channels.size(); ++Set)
            {
                const ParticleFieldResolution Acting   = ResolveParticleFields(Fields, At, Time, Channels[Set]);
                const std::vector<double>     Resolved = ReadNumbers(Record["resolved_" + std::to_string(Set)]);
                const std::vector<double>     Advanced = ReadNumbers(Record["advanced_" + std::to_string(Set)]);
                const double Mine[8] = { Acting.Flow[0], Acting.Flow[1], Acting.Flow[2], Acting.Flowing ? 1.0 : 0.0,
                                         Acting.Accelerate[0], Acting.Accelerate[1], Acting.Accelerate[2], Acting.Damp };
                FlowingMismatches += (Mine[3] != Resolved[3]) ? 1 : 0;
                for (size_t Index = 0; Index < 8; ++Index)
                {
                    WorstResolved = std::max(WorstResolved, RelativeError(Mine[Index], Resolved[Index]));
                }
                const std::array<double, 3> Next = AdvanceParticleReceiver({ 0.5, -1.0, 0.25 }, Acting, 2.5, 1.0 / 60.0);
                for (size_t Axis = 0; Axis < 3; ++Axis)
                {
                    WorstAdvanced = std::max(WorstAdvanced, RelativeError(Next[Axis], Advanced[Axis]));
                }
            }
            ++ReadingCount;
        }
    }
    Expect(ReadingCount == 72, "72 taxonomy readings");
    Expect(FlowingMismatches == 0, "flowing agrees at every point");
    Expect(WorstSample <= 1e-12 && WorstResolved <= 1e-12 && WorstAdvanced <= 1e-12, "taxonomy readings within 1e-12");
    std::printf("  taxonomy: %zu readings x %zu fields, worst relative error: sample %.3g, resolved %.3g, advanced %.3g\n",
                ReadingCount, Fields.size(), WorstSample, WorstResolved, WorstAdvanced);

    //--------------------------------------------------------------------------------------------------------------------
    //                                                LIGHTNING
    //--------------------------------------------------------------------------------------------------------------------

    {
        const toml::table&                       Recorded = *Reference["lightning"].as_table();
        ParticleLightning                        Lightning;
        const std::array<double, 3>              First    = Lightning.Strike(0.5);
        const std::array<double, 3>              Second   = Lightning.Strike(1.0);
        const std::vector<std::array<double, 3>> Points   = { { 0.0, 1.0, 0.0 }, { 3.0, 1.0, -2.0 }, { -2.0, 2.0, 1.0 }, { 1.0, 3.0, 3.0 } };
        const uint32_t                           Links    = Lightning.Web(1.2, Points, 2, 0.5);
        const std::vector<std::array<double, 3>> Hits     = Lightning.Advance(1.0 / 60.0, 1.6);
        std::vector<float>                       Segments;
        const uint32_t                           Count    = Lightning.Pack(1.65, Segments);
        const auto Same = [](const std::array<double, 3>& Mine, const std::vector<double>& Theirs)
        {
            return Theirs.size() == 3 && RelativeError(Mine[0], Theirs[0]) <= 1e-12 && RelativeError(Mine[1], Theirs[1]) <= 1e-12
                && RelativeError(Mine[2], Theirs[2]) <= 1e-12;
        };
        Expect(Same(First, ReadNumbers(Recorded["first_strike"])) && Same(Second, ReadNumbers(Recorded["second_strike"])),
               "lightning strikes land where the prototype's do");
        Expect(Links == static_cast<uint32_t>(Recorded["web_links"].value<int64_t>().value_or(-1)), "the lightning web makes the same links");
        Expect(Hits.size() == 1 && Same(Hits[0], ReadNumbers(Recorded["automatic_strike"])), "the automatic strike at 1.5 s");
        Expect(RelativeError(Lightning.NextStrikeSeconds, Recorded["next_strike_seconds"].value<double>().value_or(0.0)) <= 1e-12
               && RelativeError(Lightning.Flash, Recorded["flash"].value<double>().value_or(0.0)) <= 1e-12, "next strike time and flash");
        const std::vector<double> SegmentCounts = ReadNumbers(Recorded["bolt_segments"]);
        const std::vector<double> Seeds         = ReadNumbers(Recorded["bolt_seeds"]);
        bool                      Bolts         = SegmentCounts.size() == Lightning.Bolts.size() && Seeds.size() == Lightning.Bolts.size();
        for (size_t Index = 0; Bolts && Index < Lightning.Bolts.size(); ++Index)
        {
            Bolts = Lightning.Bolts[Index].Segments.size() == static_cast<size_t>(SegmentCounts[Index])
                 && RelativeError(Lightning.Bolts[Index].Seed, Seeds[Index]) <= 1e-12;
        }
        Expect(Bolts, "every bolt has the prototype's segments and seed");
        const std::vector<double> Packed = ReadNumbers(Recorded["segments"]);
        const FloatComparison     Result = CompareFloats(std::span<const float>(Segments.data(), static_cast<size_t>(Count) * 8u), Packed);
        Expect(Count == static_cast<uint32_t>(Recorded["segment_count"].value<int64_t>().value_or(-1)) && Result.Largest <= 1,
               "packed lightning segments within 1 ulp");
        std::printf("  lightning: %zu bolts, %u segments, %zu / %zu floats exact (largest %u ulp)\n", Lightning.Bolts.size(), Count, Result.Exact,
                    Result.Values, Result.Largest);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                HYPOT
    //--------------------------------------------------------------------------------------------------------------------

    const std::vector<double> HypotArguments = ReadNumbers(Reference["hypot"]["arguments"]);
    const std::vector<double> HypotResults   = ReadNumbers(Reference["hypot"]["results"]);
    size_t                    HypotExact     = 0;
    for (size_t Index = 0; Index < HypotResults.size(); ++Index)
    {
        const std::span<const double> Values(HypotArguments.data() + Index * 3, Index % 3 == 0 ? 2 : 3);
        HypotExact += ResolveCompensatedHypotenuse(Values) == HypotResults[Index] ? 1 : 0;
    }
    Expect(!HypotResults.empty() && HypotExact == HypotResults.size(), "Math.hypot reproduced bit for bit");
    std::printf("  hypot: %zu / %zu bit-exact\n", HypotExact, HypotResults.size());

    std::printf("%s %d / %d assertions\n", Failures == 0 ? "✔️" : "🔴", Assertions - Failures, Assertions);
    return Failures == 0 ? 0 : 1;
}
