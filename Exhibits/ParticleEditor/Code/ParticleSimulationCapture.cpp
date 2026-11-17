/*==========================================================================================================================================
                                                       PARTICLESIMULATIONCAPTURE.CPP
==========================================================================================================================================*/
// 🧩 The C++ particle engine offscreen: the prototype's default scene and showcased presets refreshed at 60 Hz on an own Vulkan
//    device, each captured with its census, probe and refresh cost.
//
//     ParticleSimulationCapture <repository root> <shader folder> <output folder> [capture]
//
// 📝 The same CPU scene (ParticleSpace) and GPU sequence (ParticleSimulationSequence) the editor runs. Each capture starts a fresh
//    scene, advances it by fixed 1/60 s ticks and writes <capture>.png plus a line of figures to Captures.tsv.

#include "Engine/PhysicalDynamics/ForceField.h"
#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleEffectLibrary.h"
#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleSpace.h"
#include "Frontier/Engine/Rendering/ParticleSimulation/ParticleSimulationSequence.h"

#include <stb_image_write.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <functional>
#include <string>
#include <vector>

using namespace Frontier;

namespace
{

struct CaptureScene
{
    const char*                                  Name;
    std::vector<std::string>                     Presets;   // empty = the library's default scene
    double                                       Seconds;
    std::function<void(ParticleSpace&)>          Arrange;
    bool                                         SharedForceField = false;
};

} // namespace

int main(int ArgumentCount, char** Arguments)
{
    if (ArgumentCount < 4)
    {
        std::fprintf(stderr, "usage: ParticleSimulationCapture <repository root> <shader folder> <output folder> [capture]\n");
        return 2;
    }
    const std::filesystem::path Root    = Arguments[1];
    const std::filesystem::path Shaders = Arguments[2];
    const std::filesystem::path Output  = Arguments[3];
    const std::string           Only    = ArgumentCount > 4 ? Arguments[4] : "";
    std::filesystem::create_directories(Output);

    ParticleEffectLibrary Library;
    std::string           Diagnostic;
    if (!Library.Decode(Root / "EngineContent/ParticleArchives/ParticleLibrary.particlespace", Diagnostic))
    {
        std::fprintf(stderr, "🔴 library: %s\n", Diagnostic.c_str());
        return 1;
    }
    ParticleSimulation::ParticleSimulationSequence Sequence;
    if (!Sequence.Construct(nullptr, Shaders, &Diagnostic))
    {
        std::fprintf(stderr, "🔴 device: %s\n", Diagnostic.c_str());
        return 1;
    }
    std::printf("🧩 ParticleSimulationCapture on %s\n", Sequence.QueryAdapter().c_str());

    const auto Overview = [](ParticleSpace& Space) { Space.Camera = { 0.6, 0.3, 12.5, { 0.0, 1.6, 0.0 } }; };
    const auto Close    = [](double Yaw, double Pitch, double Distance, std::array<double, 3> Target)
    {
        return [=](ParticleSpace& Space) { Space.Camera = { Yaw, Pitch, Distance, Target }; Space.Lightning.Automatic = false; };
    };
    ForceFieldSpace NativeField;
    PlanetaryWindProfile NativeWind;
    NativeWind.BearingRadians = 0.4;
    NativeWind.SpeedMetersPerSecond = 5.0;
    NativeWind.GustAmplitude = 0.0;
    NativeWind.ShearPerKilometer = 0.0;
    NativeWind.VeerRadiansPerKilometer = 0.0;
    NativeWind.SwirlStrength = 0.0;
    NativeWind.MesoscaleStrength = 0.0;
    NativeField.SetWindProfile(NativeWind);
    NativeField.SetElapsedSeconds(0.0);

    const std::vector<CaptureScene> Scenes = {
        { "DefaultScene", {}, 2.5, Overview },
        { "WindArrows", {}, 1.5, [](ParticleSpace& Space) { Space.Wind.ShowArrows = true; Space.Camera = { 0.6, 0.55, 15.0, { 0.0, 1.0, 0.0 } }; } },
        { "SharedForceField", { "leaves" }, 1.2, Close(0.6, 0.2, 12.0, { 0.0, 2.0, 0.0 }), true },
        { "TornadoDebris", { "tornado" }, 4.0, Close(0.4, 0.22, 11.0, { 0.0, 2.0, -2.0 }) },
        { "Fireworks", { "fireworks" }, 3.0, Close(0.6, 0.12, 14.0, { 0.0, 3.5, 0.0 }) },
        { "FireAndSmoke", { "fire", "smoke" }, 3.0, Close(0.5, 0.18, 7.0, { 0.0, 1.4, 0.0 }) },
        { "LightStreaks", { "light-streaks" }, 2.0, Close(0.6, 0.3, 14.0, { 0.0, 1.0, 0.0 }) },
        { "WeaveTrails", { "weave-trails" }, 2.0, Close(0.6, 0.6, 12.0, { 0.0, 1.0, 0.0 }) },
        { "DerezCube", { "derez-cube" }, 2.6, Close(0.6, 0.25, 6.0, { 0.0, 0.8, 0.0 }) },
        { "DissolveButterflies", { "dissolve-butterflies" }, 2.8, Close(0.6, 0.2, 6.0, { 0.0, 1.0, 0.0 }) },
        { "CoinStack", { "coin-stack" }, 3.5, Close(0.6, 0.2, 5.0, { 0.0, 0.8, 0.0 }) },
        { "BlackHole", { "black-hole" }, 3.0, Close(0.6, 0.35, 10.0, { 0.0, 2.0, 0.0 }) },
        { "Fireflies", { "fireflies" }, 3.0, Close(0.6, 0.2, 8.0, { 0.0, 1.5, 0.0 }) },
        { "Bubbles", { "bubbles" }, 3.0, Close(0.6, 0.2, 7.0, { 0.0, 1.5, 0.0 }) },
        { "MagneticLines", { "magnetic-lines", "magnetic-particles" }, 2.5, Close(0.6, 0.4, 12.0, { 0.0, 2.0, 0.0 }) },
        { "Lightning", { "strikeSparks" }, 1.6,
          [](ParticleSpace& Space) { Space.Camera = { 0.6, 0.15, 16.0, { 0.0, 4.0, 0.0 } }; Space.Lightning.NextStrikeSeconds = 1.45; } },
    };

    std::ofstream Ledger(Output / "Captures.tsv");
    Ledger << "capture\trefreshes\tseconds\talive\tcapacity\tstore_bytes\tmean_ms\tprobe_mps\n";
    constexpr uint32_t Width = 960, Height = 540;
    int Failures = 0;
    for (const CaptureScene& Capture : Scenes)
    {
        if (!Only.empty() && Only != Capture.Name) continue;
        ParticleSpace Space;
        Space.ConstructDefault(Library, Capture.Presets.empty() ? nullptr : &Capture.Presets);
        if (Capture.Arrange) Capture.Arrange(Space);
        const IFieldSampler* SharedFieldSampler = Capture.SharedForceField ? &NativeField : nullptr;
        if (Capture.SharedForceField) Space.LevelWind.Follow = true;
        const uint32_t Refreshes = static_cast<uint32_t>(Capture.Seconds * 60.0 + 0.5);
        double         Total     = 0.0;
        bool           Healthy   = true;
        for (uint32_t Refresh = 0; Refresh < Refreshes && Healthy; ++Refresh)
        {
            // 📝 The first tick of a scene carries no time, as the prototype's first frame.
            const ParticleRefreshPlan Plan  = Space.Advance(Refresh == 0 ? 0.0 : 1.0 / 60.0, Width, Height, nullptr, SharedFieldSampler);
            const auto                Begun = std::chrono::steady_clock::now();
            Healthy = Sequence.Refresh(Plan, Space.Effects, &Diagnostic, SharedFieldSampler);
            Total += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - Begun).count();
        }
        if (!Healthy)
        {
            std::printf("  🔴 %s: %s\n", Capture.Name, Diagnostic.c_str());
            ++Failures;
            continue;
        }
        // 📝 A last refresh that reads every census, so the figures belong to the captured image.
        ParticleRefreshPlan Final = Space.Advance(1.0 / 60.0, Width, Height, nullptr, SharedFieldSampler);
        for (ParticleRefreshJob& Job : Final.Jobs) Job.ReadCensus = Job.Simulate;
        Final.ProbeCell = Space.ResolveProbeCell();
        if (!Sequence.Refresh(Final, Space.Effects, &Diagnostic, SharedFieldSampler))
        {
            std::printf("  🔴 %s: %s\n", Capture.Name, Diagnostic.c_str());
            ++Failures;
            continue;
        }
        if (Capture.SharedForceField)
        {
            std::vector<float> Lattice;
            const bool Read = Sequence.ReadWindLattice(Lattice, &Diagnostic);
            const bool HasFlow = Read && std::any_of(Lattice.begin(), Lattice.end(), [](float Value) { return std::fabs(Value) > 0.01f; });
            const bool NoDuplicateLocalFlow = std::all_of(Final.Components.begin(), Final.Components.end(), [](float Value) { return Value == 0.0f; });
            if (!Final.SharedFieldActive || !HasFlow || !NoDuplicateLocalFlow)
            {
                std::printf("  🔴 %s: native field lattice integration failed (%s)\n", Capture.Name,
                            Read ? "missing field flow or duplicate local flow" : Diagnostic.c_str());
                ++Failures;
                continue;
            }
        }
        std::vector<uint8_t> Rgba;
        if (!Sequence.ReadPresentedImage(Rgba, &Diagnostic) || Rgba.size() < static_cast<size_t>(Width) * Height * 4u)
        {
            std::printf("  🔴 %s: %s\n", Capture.Name, Diagnostic.c_str());
            ++Failures;
            continue;
        }
        std::vector<uint8_t> Rgb(static_cast<size_t>(Width) * Height * 3u);
        uint64_t             Lit = 0;
        for (size_t Pixel = 0; Pixel < static_cast<size_t>(Width) * Height; ++Pixel)
        {
            for (int Channel = 0; Channel < 3; ++Channel) Rgb[Pixel * 3 + Channel] = Rgba[Pixel * 4 + Channel];
            Lit += (Rgba[Pixel * 4] + Rgba[Pixel * 4 + 1] + Rgba[Pixel * 4 + 2]) > 90 ? 1 : 0;
        }
        const std::filesystem::path Target = Output / (std::string(Capture.Name) + ".png");
        if (stbi_write_png(Target.string().c_str(), Width, Height, 3, Rgb.data(), Width * 3) == 0)
        {
            std::printf("  🔴 %s: PNG write failed\n", Capture.Name);
            ++Failures;
            continue;
        }
        uint32_t Alive = 0, Capacity = 0;
        for (const ParticleEffectInstance& Effect : Space.Effects)
        {
            Capacity += Effect.Parameters.Behaviour == ParticleBehaviour::LightFibre ? 0u : ResolveParticleCapacity(Effect.Parameters);
            if (const ParticleSimulation::ParticleCensus* Census = Sequence.QueryCensus(Effect.Token); Census && Census->Valid) Alive += Census->Alive;
        }
        const auto& Probe = Sequence.QueryProbe();
        std::printf("  %-20s %4u refreshes  %6u / %6u alive  %5.1f%% lit  %7.1f ms mean  probe %.2f m/s\n", Capture.Name, Refreshes + 1, Alive,
                    Capacity, 100.0 * static_cast<double>(Lit) / (static_cast<double>(Width) * Height), Total / std::max(1u, Refreshes),
                    Probe.Valid ? Probe.Magnitude : 0.0f);
        for (const ParticleEffectInstance& Effect : Space.Effects)
        {
            if (const ParticleSimulation::ParticleCensus* Census = Sequence.QueryCensus(Effect.Token); Census && Census->Valid)
            {
                std::printf("      %-22s alive %6u  A %5u  B %5u  C %5u  energy %.3f\n", Effect.Name.c_str(), Census->Alive, Census->SpeciesA,
                            Census->SpeciesB, Census->SpeciesC, Census->Energy);
            }
        }
        Ledger << Capture.Name << '\t' << Refreshes + 1 << '\t' << Capture.Seconds << '\t' << Alive << '\t' << Capacity << '\t' << Sequence.QueryStoreBytes()
              << '\t' << Total / std::max(1u, Refreshes) << '\t' << (Probe.Valid ? Probe.Magnitude : 0.0f) << '\n';
    }
    std::printf("%s %d failures\n", Failures == 0 ? "✔️" : "🔴", Failures);
    return Failures == 0 ? 0 : 1;
}
