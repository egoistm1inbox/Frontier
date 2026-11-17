/*==========================================================================================================================================
                                                        PARTICLESPACEVALIDATION.CPP
==========================================================================================================================================*/
// 🧩 The default Everest sidecar and the ParticleSpace: its opening presets match the library; a space holding every preset,
//    edited settings, forces and an override origin is written, read and written again; every number and GPU refresh survives;
//    the live scene camera stays aligned across the Z-up/Y-up axis conversion and its FOV drives screen-space effects; level
//    wind and box volumes reach the field program; malformed files are refused without touching the space they were read into.
//
//     ParticleSpaceValidation <repository root> <scratch folder>

#include "Engine/PhysicalDynamics/ForceField.h"
#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleSpaceCodec.h"

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <numbers>
#include <string>

using namespace Frontier;

namespace
{

int Failures   = 0;
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

bool Same(double Left, double Right)
{
    return std::bit_cast<uint64_t>(Left) == std::bit_cast<uint64_t>(Right);
}

template <size_t Count> bool Same(const std::array<double, Count>& Left, const std::array<double, Count>& Right)
{
    for (size_t Index = 0; Index < Count; ++Index)
        if (!Same(Left[Index], Right[Index])) return false;
    return true;
}

// 📝 The parameters whose values are least likely to print exactly: fractions, colours, lifetimes, fibre stops.
bool SameParameters(const ParticleEffectParameters& Left, const ParticleEffectParameters& Right)
{
    bool Equal = Left.Behaviour == Right.Behaviour && Left.Appearance == Right.Appearance && Left.Capacity == Right.Capacity &&
                 Left.Visible == Right.Visible && Same(Left.ReleaseRate, Right.ReleaseRate) && Same(Left.OriginMetres, Right.OriginMetres) &&
                 Same(Left.Direction, Right.Direction) && Same(Left.SpreadRadians, Right.SpreadRadians) && Same(Left.SpeedMinimum, Right.SpeedMinimum) &&
                 Same(Left.SpeedMaximum, Right.SpeedMaximum) && Same(Left.LifeMinimumSeconds, Right.LifeMinimumSeconds) &&
                 Same(Left.LifeMaximumSeconds, Right.LifeMaximumSeconds) && Same(Left.ColourA, Right.ColourA) && Same(Left.ColourB, Right.ColourB) &&
                 Same(Left.ColourC, Right.ColourC) && Same(Left.IntegrationStepSeconds, Right.IntegrationStepSeconds) &&
                 Left.Transition.has_value() == Right.Transition.has_value() && Left.Attractor.has_value() == Right.Attractor.has_value() &&
                 Left.Lensing.has_value() == Right.Lensing.has_value() && Left.HeatShimmer.has_value() == Right.HeatShimmer.has_value() &&
                 Left.MagneticDipole.has_value() == Right.MagneticDipole.has_value() && Left.LightFibre.has_value() == Right.LightFibre.has_value();
    if (Equal && Left.LightFibre)
    {
        Equal = Left.LightFibre->Stops.size() == Right.LightFibre->Stops.size() && Left.LightFibre->PathShape == Right.LightFibre->PathShape &&
                Same(Left.LightFibre->AccentColour, Right.LightFibre->AccentColour);
        for (size_t Stop = 0; Equal && Stop < Left.LightFibre->Stops.size(); ++Stop)
            Equal = Same(Left.LightFibre->Stops[Stop].Position, Right.LightFibre->Stops[Stop].Position) &&
                    Same(Left.LightFibre->Stops[Stop].Colour, Right.LightFibre->Stops[Stop].Colour);
    }
    if (Equal && Left.Transition) Equal = Same(Left.Transition->BurstShare, Right.Transition->BurstShare) && Left.Transition->Butterflies == Right.Transition->Butterflies;
    if (Equal && Left.Attractor) Equal = Same(Left.Attractor->Strength, Right.Attractor->Strength) && Same(Left.Attractor->Swirl, Right.Attractor->Swirl);
    return Equal;
}

struct CoordinateFieldSampler final : IFieldSampler
{
    bool Enabled = true;
    [[nodiscard]] bool QueryFieldEnabled() const noexcept override { return Enabled; }
    [[nodiscard]] double QueryGroundPlaneYMeters() const noexcept override { return 0.0; }
    [[nodiscard]] Vec3d SampleFieldFlow(const Vec3d& Point, double, bool) const noexcept override { return Point; }
    [[nodiscard]] Vec3d SampleFieldContribution(ForceContribution, const Vec3d&, double, bool, int32_t) const noexcept override { return {}; }
    [[nodiscard]] FieldPointSample EvaluateFullField(const Vec3d& Point, bool, double) const noexcept override
    {
        FieldPointSample Reading;
        Reading.AirVelocityMps = Point;
        return Reading;
    }
};

} // namespace

int main(int ArgumentCount, char** Arguments)
{
    if (ArgumentCount < 3)
    {
        std::printf("usage: ParticleSpaceValidation <repository root> <scratch folder>\n");
        return 2;
    }
    const std::filesystem::path Root    = Arguments[1];
    const std::filesystem::path Scratch = Arguments[2];
    std::filesystem::create_directories(Scratch);

    ParticleEffectLibrary Library;
    std::string           Diagnostic;
    if (!Library.Decode(Root / "EngineContent" / "ParticleArchives" / "ParticleLibrary.particlespace", Diagnostic))
    {
        std::printf("🔴 library: %s\n", Diagnostic.c_str());
        return 1;
    }

    // ⓪ The default Everest Particles record points at a valid sidecar with the library's four opening presets.
    {
        ParticleSpace Expected;
        Expected.ConstructDefault(Library);
        ParticleSpace FromLevel;
        const std::filesystem::path File = Root / "Projects" / "Everest" / "Content" / "Levels" / "Default.Particle_Effects.particlespace";
        std::string Diagnostic;
        const bool Read = ReadParticleSpace(File, FromLevel, Diagnostic);
        Expect(Read, "read default Everest particle sidecar (" + Diagnostic + ")");
        bool PresetsMatch = Read && FromLevel.Effects.size() == Expected.Effects.size() && FromLevel.Fields.size() == Expected.Fields.size();
        for (size_t Index = 0; PresetsMatch && Index < Expected.Effects.size(); ++Index)
        {
            const ParticleEffectInstance& A = FromLevel.Effects[Index];
            const ParticleEffectInstance& B = Expected.Effects[Index];
            PresetsMatch = A.PresetIdentifier == B.PresetIdentifier && A.Name == B.Name && A.Number == B.Number &&
                           SameParameters(A.Parameters, B.Parameters);
        }
        Expect(PresetsMatch, "default sidecar matches the library's effects, parameters, and force count");
    }

    // ① The live Everest camera keeps its pixel projection when the Z-up scene pose is rotated into the particle Y-up axes.
    {
        constexpr double Pi = 3.14159265358979323846;
        const ParticleCameraPose SceneCamera{{-61.9997, -34.0018, 9.0052}, {-10.0, 6.0, 3.0}, {0.0, 0.0, 1.0}, Pi / 3.0};
        const ParticleCameraPose ParticleCamera = ConvertSceneCameraToParticleAxes(SceneCamera);
        const ParticleCameraReading CameraReading = ResolveParticleCamera(ParticleCamera, 16.0 / 9.0);
        Expect(Same(ParticleCamera.Position, std::array<double, 3>{-61.9997, 9.0052, 34.0018}) &&
                   Same(ParticleCamera.Target, std::array<double, 3>{-10.0, 3.0, -6.0}) &&
                   ParticleCamera.Up[0] == 0.0 && ParticleCamera.Up[1] == 1.0 && ParticleCamera.Up[2] == 0.0,
               "the scene camera pose maps into right-handed Y-up particle axes");

        const auto Dot = [](const std::array<double, 3>& Left, const std::array<double, 3>& Right) {
            return Left[0] * Right[0] + Left[1] * Right[1] + Left[2] * Right[2];
        };
        const auto Subtract = [](const std::array<double, 3>& Left, const std::array<double, 3>& Right) {
            return std::array<double, 3>{Left[0] - Right[0], Left[1] - Right[1], Left[2] - Right[2]};
        };
        const auto Cross = [](const std::array<double, 3>& Left, const std::array<double, 3>& Right) {
            return std::array<double, 3>{Left[1] * Right[2] - Left[2] * Right[1], Left[2] * Right[0] - Left[0] * Right[2],
                                         Left[0] * Right[1] - Left[1] * Right[0]};
        };
        const auto Normalize = [](std::array<double, 3> Axis) {
            const double Length = std::hypot(Axis[0], Axis[1], Axis[2]);
            for (double& Component : Axis) Component /= Length;
            return Axis;
        };
        const std::array<double, 3> SceneForward = Normalize(Subtract(SceneCamera.Target, SceneCamera.Position));
        const std::array<double, 3> SceneRight   = Normalize(Cross(SceneForward, SceneCamera.Up));
        const std::array<double, 3> SceneUp      = Cross(SceneRight, SceneForward);
        std::array<double, 3>       Point         = SceneCamera.Target;
        for (size_t Axis = 0; Axis < 3; ++Axis) Point[Axis] += SceneRight[Axis] * 2.0 + SceneUp[Axis];
        const std::array<double, 3> ParticlePoint{Point[0], Point[2], -Point[1]};
        std::array<double, 4>       Clip{};
        for (int Row = 0; Row < 4; ++Row)
        {
            Clip[Row] = CameraReading.ViewProjection[Row] * ParticlePoint[0] + CameraReading.ViewProjection[4 + Row] * ParticlePoint[1] +
                        CameraReading.ViewProjection[8 + Row] * ParticlePoint[2] + CameraReading.ViewProjection[12 + Row];
        }
        const double Depth = Dot(Subtract(SceneCamera.Target, SceneCamera.Position), SceneForward);
        const double Focal = 1.0 / std::tan(SceneCamera.VerticalFieldOfView * 0.5);
        const double ExpectedX = 2.0 * Focal / (Depth * (16.0 / 9.0));
        const double ExpectedY = Focal / Depth;
        Expect(std::fabs(Clip[0] / Clip[3] - ExpectedX) < 1.0e-5 && std::fabs(Clip[1] / Clip[3] - ExpectedY) < 1.0e-5,
               "scene and particle camera project the same off-centre world point");

        ParticleSpace CameraSpace;
        CameraSpace.ConstructDefault(Library);
        const ParticleRefreshPlan Plan = CameraSpace.Advance(1.0 / 60.0, 1280, 720, &ParticleCamera);
        Expect(Same(Plan.Camera.Eye, ParticleCamera.Position), "refresh plan uses the live scene camera eye");
        Expect(!Plan.TransparentBackground, "regular Particle editor plans retain their opaque background");

        ParticleEffectParameters LensParameters;
        LensParameters.OriginMetres = ParticleCamera.Target;
        LensParameters.Lensing = ParticleLensing{1.0, 0.5};
        const std::array<ParticleEffectPlacement, 1> LensPlacement = {{{&LensParameters}}};
        ParticleLensingBlock LensSixty{}, LensFortyFive{};
        (void)PackParticleLensing(LensSixty, LensPlacement, CameraReading, 16.0 / 9.0, 0.0, Pi / 3.0);
        (void)PackParticleLensing(LensFortyFive, LensPlacement, CameraReading, 16.0 / 9.0, 0.0, Pi / 4.0);
        const double FocalSixty = 1.0 / std::tan(Pi / 6.0);
        const double FocalFortyFive = 1.0 / std::tan(Pi / 8.0);
        Expect(std::fabs(static_cast<double>(LensSixty[2] / LensFortyFive[2]) - FocalSixty / FocalFortyFive) < 1.0e-5,
               "lensing radii use the selected camera field of view");

        const bool AddedFibre = CameraSpace.AddEffect(Library, "light-streaks") != nullptr;
        const ParticleRefreshPlan FibrePlan = CameraSpace.Advance(1.0 / 60.0, 1280, 720, &ParticleCamera);
        const auto FibreJob = std::find_if(FibrePlan.Jobs.begin(), FibrePlan.Jobs.end(), [](const ParticleRefreshJob& Job) { return Job.LightFibre; });
        const double ExpectedFibreScale = (0.5 * 720.0) / std::tan(SceneCamera.VerticalFieldOfView * 0.5);
        Expect(AddedFibre && FibreJob != FibrePlan.Jobs.end() &&
                   std::fabs(static_cast<double>(FibreJob->FibreUniform[26]) - ExpectedFibreScale) < 1.0e-3,
               "light-fibre projection scale uses the selected camera field of view");
        std::printf("scene camera: %.6f × %.6f NDC projection, FOV %.1f°\n", Clip[0] / Clip[3], Clip[1] / Clip[3],
                    SceneCamera.VerticalFieldOfView * 180.0 / Pi);
    }

    // ② a space with every preset, edited settings, a disabled force and an override origin
    ParticleSpace Original;
    Original.ConstructDefault(Library);
    for (const ParticlePreset& Preset : Library.Presets) (void)Original.AddEffect(Library, Preset.Identifier);
    Original.Camera                  = { 1.234567890123, 0.4142135623731, 17.25, { 0.1, 2.0 / 3.0, -0.3 } };
    Original.Wind.WindScale          = 1.0 / 3.0;
    Original.Wind.ShowArrows         = true;
    Original.LightningWeb.Enabled    = true;
    Original.LightningWeb.Links      = 3;
    Original.Lightning.Automatic     = false;
    Original.TimeScale               = 0.7;
    Original.Probe                   = { 0.25, 1.75, -2.125 };
    Original.Effects[3].Parameters.Visible = false;
    Original.Effects[5].OverrideOrigin     = std::array<double, 3>{ 1.0 / 7.0, 0.0, -1.0 / 9.0 };
    if (!Original.Fields.empty()) Original.Fields.front().Enabled = false;
    std::printf("space: %zu effects, %zu forces\n", Original.Effects.size(), Original.Fields.size());

    // ③ write, read, write: one text
    const std::string First = EncodeParticleSpace(Original);
    ParticleSpace     Read;
    Expect(DecodeParticleSpace(First, Read, Diagnostic), "the written space reads back (" + Diagnostic + ")");
    const std::string Second = EncodeParticleSpace(Read);
    Expect(First == Second, "write → read → write gives the same text");
    std::printf("text: %zu bytes, %s\n", First.size(), First == Second ? "identical after the round trip" : "DIFFERENT after the round trip");

    // ④ every effect, force and setting survives bit for bit
    Expect(Read.Effects.size() == Original.Effects.size(), "effect count");
    size_t SameEffects = 0;
    for (size_t Index = 0; Index < std::min(Read.Effects.size(), Original.Effects.size()); ++Index)
    {
        const ParticleEffectInstance& A = Original.Effects[Index];
        const ParticleEffectInstance& B = Read.Effects[Index];
        const bool Equal = A.Token == B.Token && A.Name == B.Name && A.PresetIdentifier == B.PresetIdentifier && A.Number == B.Number &&
                           A.OverrideOrigin.has_value() == B.OverrideOrigin.has_value() && (!A.OverrideOrigin || Same(*A.OverrideOrigin, *B.OverrideOrigin)) &&
                           SameParameters(A.Parameters, B.Parameters);
        SameEffects += Equal ? 1 : 0;
        Expect(Equal, "effect " + A.Token + " (" + A.PresetIdentifier + ") survives");
    }
    std::printf("effects: %zu / %zu identical\n", SameEffects, Original.Effects.size());
    Expect(Read.Fields.size() == Original.Fields.size(), "force count");
    for (size_t Index = 0; Index < std::min(Read.Fields.size(), Original.Fields.size()); ++Index)
    {
        const ParticleField& A = Original.Fields[Index];
        const ParticleField& B = Read.Fields[Index];
        Expect(A.Category == B.Category && A.Name == B.Name && A.Enabled == B.Enabled && Same(A.Centre, B.Centre) && Same(A.Direction, B.Direction) &&
                   Same(A.Strength, B.Strength) && Same(A.Radius, B.Radius) && A.Reach == B.Reach && A.Falloff == B.Falloff && A.ActsOn == B.ActsOn,
               "force " + std::to_string(Index + 1) + " (" + A.Name + ") survives");
    }
    Expect(Same(Read.Camera.Yaw, Original.Camera.Yaw) && Same(Read.Camera.Pitch, Original.Camera.Pitch) && Same(Read.Camera.Target, Original.Camera.Target),
           "camera");
    Expect(Same(Read.Wind.WindScale, Original.Wind.WindScale) && Read.Wind.ShowArrows, "wind settings");
    Expect(Read.LightningWeb.Enabled && Read.LightningWeb.Links == 3 && !Read.Lightning.Automatic, "lightning settings");
    Expect(Same(Read.TimeScale, 0.7) && Same(Read.Probe, Original.Probe), "clock and probe");
    Expect(Read.NextNumber == Original.NextNumber, "next effect number");

    // ⑤ the read space plans the same GPU work as the original
    ParticleSpace Fresh;
    Fresh.ConstructDefault(Library);
    for (const ParticlePreset& Preset : Library.Presets) (void)Fresh.AddEffect(Library, Preset.Identifier);
    ParticleSpace FreshRead;
    (void)DecodeParticleSpace(EncodeParticleSpace(Fresh), FreshRead, Diagnostic);
    size_t SameJobs = 0, Jobs = 0;
    for (int Refresh = 0; Refresh < 30; ++Refresh)
    {
        const ParticleRefreshPlan A = Fresh.Advance(1.0 / 60.0, 1280, 720);
        const ParticleRefreshPlan B = FreshRead.Advance(1.0 / 60.0, 1280, 720);
        Expect(A.Jobs.size() == B.Jobs.size(), "refresh " + std::to_string(Refresh) + " job count");
        for (size_t Job = 0; Job < std::min(A.Jobs.size(), B.Jobs.size()); ++Job)
        {
            ++Jobs;
            const bool Equal = std::memcmp(&A.Jobs[Job].Uniform, &B.Jobs[Job].Uniform, sizeof(A.Jobs[Job].Uniform)) == 0 &&
                               std::memcmp(&A.Jobs[Job].FibreUniform, &B.Jobs[Job].FibreUniform, sizeof(A.Jobs[Job].FibreUniform)) == 0 &&
                               A.Jobs[Job].Release == B.Jobs[Job].Release && A.Jobs[Job].FibrePath == B.Jobs[Job].FibrePath;
            SameJobs += Equal ? 1 : 0;
        }
        Expect(std::memcmp(&A.Constants, &B.Constants, sizeof(A.Constants)) == 0 && std::memcmp(&A.Fields, &B.Fields, sizeof(A.Fields)) == 0,
               "refresh " + std::to_string(Refresh) + " constants and fields");
    }
    Expect(SameJobs == Jobs, "every job uniform of 30 refreshes is identical");
    std::printf("refresh plans: %zu / %zu job uniforms identical over 30 refreshes\n", SameJobs, Jobs);

    // ⑥ the legacy anchor-sampled fallback adds one prevailing flow when no shared native sampler is supplied
    {
        ParticleSpace Still, Windy, Waiting;
        for (ParticleSpace* Space : { &Still, &Windy, &Waiting }) Space->ConstructDefault(Library);
        Windy.LevelWind.Follow    = true;
        Windy.LevelWind.FlowMps   = std::array<double, 3>{ 6.0, 0.5, -2.0 };
        Waiting.LevelWind.Follow  = true;   // no Force Field sampled yet
        const ParticleRefreshPlan A = Still.Advance(1.0 / 60.0, 640, 360);
        const ParticleRefreshPlan B = Windy.Advance(1.0 / 60.0, 640, 360);
        const ParticleRefreshPlan C = Waiting.Advance(1.0 / 60.0, 640, 360);
        const auto StillFlows = static_cast<uint32_t>(A.Constants[39]), WindyFlows = static_cast<uint32_t>(B.Constants[39]);
        Expect(WindyFlows == StillFlows + 1, "following the level adds one flow (" + std::to_string(StillFlows) + " → " + std::to_string(WindyFlows) + ")");
        Expect(std::memcmp(&A.Components, &C.Components, sizeof(A.Components)) == 0, "following without a sampled flow changes nothing");
        std::printf("level wind: %u flows still, %u following 6.3 m/s\n", StillFlows, WindyFlows);
        ParticleSpace Reread;
        Windy.LevelWind.AnchorMetres = { 120.0, -45.5, 8.0 };
        Expect(DecodeParticleSpace(EncodeParticleSpace(Windy), Reread, Diagnostic) && Reread.LevelWind.Follow && Same(Reread.LevelWind.AnchorMetres, Windy.LevelWind.AnchorMetres) &&
                   !Reread.LevelWind.FlowMps,
               "the file keeps following and the anchor, never the sampled flow");
    }

    // ⑦ a shared native sampler replaces duplicate local flow sources, samples every 3D lattice cell, and preserves local acceleration.
    {
        CoordinateFieldSampler Field;
        ParticleSpace Shared;
        Shared.ConstructDefault(Library);
        Shared.LevelWind.Follow = true;
        Shared.LevelWind.AnchorMetres = { 12.0, -34.0, 56.0 };
        ParticleField Attractor = ConstructParticleField(ParticleFieldCategory::Attract);
        Attractor.Centre = { 0.0, 1.0, 0.0 };
        Attractor.Radius = 3.0;
        Attractor.Strength = 2.0;
        Shared.Fields.push_back(Attractor);

        const ParticleRefreshPlan Plan = Shared.Advance(1.0 / 60.0, 640, 360, nullptr, &Field);
        const std::array<double, 3> ExpectedOrigin{ 12.0, 56.0, 34.0 };
        const bool ZeroLocalFlow = std::all_of(Plan.Components.begin(), Plan.Components.end(), [](float Value) { return Value == 0.0f; });
        Expect(Plan.SharedFieldActive && Same(Plan.SharedFieldOriginMetres, ExpectedOrigin),
               "the shared ForceField origin converts world Z-up into native field axes");
        Expect(Plan.Constants[39] == 0.0f && ZeroLocalFlow, "following the shared field suppresses duplicate Particle flow components");
        Expect(Shared.LevelWind.FlowMps && Same(*Shared.LevelWind.FlowMps, ExpectedOrigin), "the Wind page reads the same native sampler at its anchor");

        const std::vector<float> Samples = SampleParticleWindLattice(Field, Plan.SharedFieldOriginMetres, false);
        const double CellX = ParticleDomainSize[0] / ParticleDomainDimensions[0];
        const double CellY = ParticleDomainSize[1] / ParticleDomainDimensions[1];
        const double CellZ = ParticleDomainSize[2] / ParticleDomainDimensions[2];
        const std::array<double, 3> ExpectedFirst{ ExpectedOrigin[0] + ParticleDomainMinimum[0] + 0.5 * CellX,
                                                   ExpectedOrigin[1] + ParticleDomainMinimum[1] + 0.5 * CellY,
                                                   ExpectedOrigin[2] + ParticleDomainMinimum[2] + 0.5 * CellZ };
        Expect(Samples.size() == static_cast<size_t>(ParticleDomainDimensions[0] * ParticleDomainDimensions[1] * ParticleDomainDimensions[2] * 4u) &&
                   std::fabs(Samples[0] - ExpectedFirst[0]) < 1.0e-5 && std::fabs(Samples[1] - ExpectedFirst[1]) < 1.0e-5 &&
                   std::fabs(Samples[2] - ExpectedFirst[2]) < 1.0e-5,
               "the native sampler is evaluated at the first texel centre, with x-fastest RGBA packing");
        bool AccelerationPacked = false;
        const uint32_t FieldCount = static_cast<uint32_t>(Plan.Fields[0]);
        for (uint32_t Entry = 0; Entry < FieldCount; ++Entry)
        {
            const size_t Offset = (1u + 3u * Entry) * 4u;
            AccelerationPacked |= Plan.Fields[Offset + 4u] == 0.0f && std::fabs(Plan.Fields[Offset + 5u] - 2.0f) < 1.0e-6f;
        }
        Expect(AccelerationPacked, "Particle-specific acceleration fields remain active while shared environmental flow is used");

        ForceFieldSpace Native;
        PlanetaryWindProfile Profile;
        Profile.BearingRadians = 0.35;
        Profile.SpeedMetersPerSecond = 5.0;
        Profile.GustAmplitude = 0.0;
        Profile.ShearPerKilometer = 0.0;
        Profile.VeerRadiansPerKilometer = 0.0;
        Profile.SwirlStrength = 0.0;
        Profile.MesoscaleStrength = 0.0;
        Native.SetWindProfile(Profile);
        Native.SetElapsedSeconds(0.0);
        const std::vector<float> NativeSamples = SampleParticleWindLattice(Native, ExpectedOrigin, false);
        Expect(std::any_of(NativeSamples.begin(), NativeSamples.end(), [](float Value) { return std::fabs(Value) > 0.01f; }),
               "the native ForceFieldSpace supplies the Particle wind lattice without copied ForceSource records");

        CoordinateFieldSampler DisabledField;
        DisabledField.Enabled = false;
        ParticleSpace Fallback;
        Fallback.ConstructDefault(Library);
        Fallback.LevelWind.Follow = true;
        Fallback.LevelWind.FlowMps = std::array<double, 3>{ 9.0, 8.0, 7.0 };
        ParticleField LocalFlow = ConstructParticleField(ParticleFieldCategory::Prevailing);
        LocalFlow.Name = "standalone fallback flow";
        LocalFlow.Strength = 2.0;
        Fallback.Fields.push_back(LocalFlow);
        const ParticleRefreshPlan FallbackPlan = Fallback.Advance(1.0 / 60.0, 640, 360, nullptr, &DisabledField);
        const bool LocalFlowRetained = std::any_of(FallbackPlan.Components.begin(), FallbackPlan.Components.end(),
                                                    [](float Value) { return Value != 0.0f; });
        Expect(!FallbackPlan.SharedFieldActive && !Fallback.LevelWind.FlowMps && LocalFlowRetained,
               "a disabled sampler clears its stale readout and preserves standalone Particle-local flow");
    }

    // ⑨ the drag volume and the current reach the field program (types 4 and 5) instead of staying authored only
    {
        ParticleSpace Boxes;
        Boxes.ConstructDefault(Library);
        ParticleField Drag = ConstructParticleField(ParticleFieldCategory::Drag);
        Drag.Enabled = true, Drag.Centre = { 0.0, 1.0, 0.0 }, Drag.Radius = 3.0, Drag.Strength = 2.0;
        ParticleField Current = ConstructParticleField(ParticleFieldCategory::Current);
        Current.Enabled = true, Current.Centre = { 1.0, 1.0, 0.0 }, Current.Radius = 5.0, Current.Strength = 4.0, Current.Direction = { 2.0, 0.0, 0.0 };
        Boxes.Fields.push_back(Drag);
        Boxes.Fields.push_back(Current);
        Expect(EvaluateParticleFieldPackable(Drag) && EvaluateParticleFieldPackable(Current), "drag volume and current have a GPU path");
        const ParticleRefreshPlan Plan  = Boxes.Advance(1.0 / 60.0, 640, 360);
        const auto                Count = static_cast<uint32_t>(Plan.Fields[0]);
        bool                      DragPacked = false, CurrentPacked = false;
        for (uint32_t Entry = 0; Entry < Count; ++Entry)
        {
            const float* A = &Plan.Fields[(1u + 3u * Entry) * 4u];
            const float* B = A + 4;
            if (B[0] == 4.0f) DragPacked = A[3] == 3.0f && B[1] == 2.0f;
            if (B[0] == 5.0f) CurrentPacked = A[3] == 5.0f && B[1] == 4.0f && B[2] == 0.0f && B[3] == 0.0f;
        }
        Expect(DragPacked, "the drag volume packs as type 4: half size 3 m, 2 per second");
        Expect(CurrentPacked, "the current packs as type 5 with its flow (4, 0, 0) m/s");
        std::printf("box volumes: drag %s, current %s, %u field entries\n", DragPacked ? "packed" : "MISSING", CurrentPacked ? "packed" : "MISSING", Count);
    }

    // ⑧ the file on disk
    const std::filesystem::path File = Scratch / "Validation.particlespace";
    Expect(WriteParticleSpace(Original, File, Diagnostic), "write " + File.filename().string() + " (" + Diagnostic + ")");
    ParticleSpace FromFile;
    Expect(ReadParticleSpace(File, FromFile, Diagnostic), "read " + File.filename().string() + " (" + Diagnostic + ")");
    Expect(EncodeParticleSpace(FromFile) == First, "the file holds the same text");
    ParticleSpaceSummary Summary;
    Expect(SummarizeParticleSpace(File, Summary, Diagnostic) && Summary.Effects == Original.Effects.size() &&
               Summary.VisibleEffects == Original.Effects.size() - 1 && Summary.Forces == Original.Fields.size(),
           "the inspector's summary");

    // ⑨ malformed files are refused and leave the space alone
    const auto Refused = [&](const std::string& Text, const char* Claim)
    {
        ParticleSpace Kept = Read;
        std::string   Reason;
        const bool    Decoded = DecodeParticleSpace(Text, Kept, Reason);
        Expect(!Decoded && !Reason.empty() && EncodeParticleSpace(Kept) == Second, std::string("refuses ") + Claim + " (" + Reason + ")");
        std::printf("refused %s: %s\n", Claim, Reason.c_str());
    };
    Refused("format = \"frontier.levelspace\"\nversion = 1\n", "another format");
    Refused("format = \"frontier.particlespace\"\nversion = 99\n", "a newer version");
    Refused("format = \"frontier.particlespace\"\nversion = 1\n[[force]]\ncategory = \"whirlpool\"\n", "an unknown force");
    Refused("format = \"frontier.particlespace\"\nversion = 1\n[[effect]]\npreset = \"a\"\nnumber = 2\n[[effect]]\npreset = \"b\"\nnumber = 2\n",
            "a number used twice");
    Refused("format = \"frontier.particlespace\"\nversion = 1\n[[effect]]\npreset = \"a\"\ncapacity = \"many\"\n", "a mistyped parameter");
    Refused("format = \"frontier.particlespace\"\nversion = 1\n[[effect]\n", "broken TOML");

    std::printf("%s %d / %d assertions\n", Failures == 0 ? "🟢" : "🔴", Assertions - Failures, Assertions);
    return Failures == 0 ? 0 : 1;
}
