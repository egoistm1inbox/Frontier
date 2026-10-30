/*====================================================================================================================================
                                                  DEDICATEDENTITYEDITORS.CPP
====================================================================================================================================*/
// 🧩 Implementation of per-entity Dedicated Popup Editor Studio windows (#if defined(FRONTIER_EDITOR_PROFILE)).

#include "DedicatedEntityEditors.h"

#if defined(FRONTIER_EDITOR_PROFILE) && defined(FRONTIER_WITH_INTERFACE_SDK)

#include "Engine/Interface/StackRailControls.h"
#include "Engine/Scene/SceneDirectory.h"

#include <imgui_internal.h>
#if defined(FRONTIER_UI_VULKAN) && FRONTIER_UI_VULKAN
#ifndef VK_NO_PROTOTYPES
#define VK_NO_PROTOTYPES
#endif
#include <imgui_impl_vulkan.h>
#endif

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace Frontier::Drive
{

namespace
{

std::string ResolveStudioFamily(const std::string &StableId)
{
    if (StableId == "pyro_plume" || StableId == "shallow_water")
    {
        return "FLUID STUDIO / PYRO PLUME & SWE";
    }
    if (StableId == "sparks" || StableId == "precipitation" ||
        StableId == "snow_mound" || StableId == "lightning")
    {
        return "PARTICLE & WEATHER STUDIO";
    }
    if (StableId == "solid_fracture")
    {
        return "FRACTURE & VORONOI CHAOS STUDIO";
    }
    if (StableId.find("placeable_") == 0 || StableId.find("spawned_3d_") == 0 ||
        StableId == "proving_grounds" || StableId == "portals_mirrors")
    {
        return "3D OBJECT & NANITE CLUSTER STUDIO";
    }
    if (StableId == "vehicle" || StableId == "propulsion" ||
        StableId == "suspension" || StableId == "tyres" ||
        StableId == "cabin_hmi" || StableId == "headlamps")
    {
        return "VEHICLE DYNAMICS & 3D CABIN STUDIO";
    }
    return "ILLUMINATION & ATMOSPHERE STUDIO";
}

const RecordEditorDescription *FindEditorDescriptionByStableId(const std::string &StableId, RecordToken *OutToken = nullptr)
{
    SceneDirectory &Dir = SceneDirectory::Instance();
    std::vector<RecordToken> Tokens;
    Dir.CopyRegistrationOrder(Tokens);
    for (const RecordToken Tok : Tokens)
    {
        if (const RecordEditorDescription *Desc = Dir.QueryEditorDescription(Tok);
            Desc != nullptr && Desc->StableId == StableId)
        {
            if (OutToken != nullptr)
            {
                *OutToken = Tok;
            }
            return Desc;
        }
    }
    return nullptr;
}

double ReadFieldScalar(const RecordEditorScalarField &Field) noexcept
{
    if (Field.Target != nullptr) return *Field.Target;
    if (Field.FloatTarget != nullptr) return static_cast<double>(*Field.FloatTarget);
    return 0.0;
}

bool WriteFieldScalar(const RecordEditorScalarField &Field, double Next) noexcept
{
    Next = std::clamp(Next, Field.Minimum, Field.Maximum);
    if (Field.Target != nullptr)
    {
        if (std::abs(*Field.Target - Next) > 1e-12)
        {
            *Field.Target = Next;
            return true;
        }
        return false;
    }
    if (Field.FloatTarget != nullptr)
    {
        const float F = static_cast<float>(Next);
        if (std::abs(*Field.FloatTarget - F) > 1e-7f)
        {
            *Field.FloatTarget = F;
            return true;
        }
    }
    return false;
}

} // namespace

DedicatedEntityEditorHost::~DedicatedEntityEditorHost()
{
    CloseAllEditors(true);
}

void DedicatedEntityEditorHost::ReclaimCompletedRetiredTextures(bool ForceImmediate) noexcept
{
    for (size_t I = 0u; I < RetiredTextures_.size();)
    {
        ImTextureData *Tex = RetiredTextures_[I].get();
        if (Tex == nullptr)
        {
            RetiredTextures_.erase(RetiredTextures_.begin() + static_cast<std::ptrdiff_t>(I));
            continue;
        }
        const bool CanReclaim = ForceImmediate || (Tex->BackendUserData == nullptr) ||
                                (Tex->Status == ImTextureStatus_Destroyed) || (Tex->UnusedFrames >= 4);
        if (!CanReclaim)
        {
            ++I;
            continue;
        }
        if (ImGui::GetCurrentContext() != nullptr)
        {
#if defined(FRONTIER_UI_VULKAN) && FRONTIER_UI_VULKAN
            if (Tex->BackendUserData != nullptr && ImGui::GetIO().BackendRendererUserData != nullptr)
            {
                Tex->SetStatus(ImTextureStatus_WantDestroy);
                Tex->UnusedFrames = 16;
                ImGui_ImplVulkan_UpdateTexture(Tex);
            }
#endif
            if (Tex->RefCount > 0)
            {
                ImGui::UnregisterUserTexture(Tex);
            }
        }
        Tex->DestroyPixels();
        RetiredTextures_.erase(RetiredTextures_.begin() + static_cast<std::ptrdiff_t>(I));
    }
}

void DedicatedEntityEditorHost::RetireWindowTexture(OpenStudioWindow &Win, bool GpuConfirmedIdle) noexcept
{
    if (Win.TextureRegistered && Win.PreviewTexture)
    {
        if (GpuConfirmedIdle || ImGui::GetCurrentContext() == nullptr || ImGui::GetIO().BackendRendererUserData == nullptr)
        {
            if (ImGui::GetCurrentContext() != nullptr)
            {
#if defined(FRONTIER_UI_VULKAN) && FRONTIER_UI_VULKAN
                if (Win.PreviewTexture->BackendUserData != nullptr && ImGui::GetIO().BackendRendererUserData != nullptr)
                {
                    Win.PreviewTexture->SetStatus(ImTextureStatus_WantDestroy);
                    Win.PreviewTexture->UnusedFrames = 16;
                    ImGui_ImplVulkan_UpdateTexture(Win.PreviewTexture.get());
                }
#endif
                if (Win.PreviewTexture->RefCount > 0)
                {
                    ImGui::UnregisterUserTexture(Win.PreviewTexture.get());
                }
            }
            Win.PreviewTexture->DestroyPixels();
        }
        else
        {
            Win.PreviewTexture->WantDestroyNextFrame = true;
            RetiredTextures_.push_back(std::move(Win.PreviewTexture));
            Win.PreviewTexture = std::make_unique<ImTextureData>();
        }
        Win.TextureRegistered = false;
    }
}

void DedicatedEntityEditorHost::OpenEditorForEntity(const std::string &StableId, DriveShowcaseWorld &World)
{
    if (StableId.empty())
    {
        return;
    }
    for (OpenStudioWindow &Existing : Windows_)
    {
        if (Existing.StableId == StableId)
        {
            Existing.Open       = true;
            Existing.NeedsFocus = true;
            return;
        }
    }

    const RecordEditorDescription *Desc = FindEditorDescriptionByStableId(StableId);
    if (Desc == nullptr)
    {
        return;
    }

    // Cap open floating studios to 3 at a time so CPU/VRAM stays lean while supporting multi-window editing
    if (Windows_.size() >= 3u)
    {
        RetireWindowTexture(Windows_.front(), false);
        Windows_.erase(Windows_.begin());
    }

    OpenStudioWindow Win{};
    Win.StableId     = StableId;
    Win.StudioFamily = ResolveStudioFamily(StableId);
    const std::string DisplayLabel = Desc->DisplayName != nullptr ? Desc->DisplayName : StableId;
    Win.WindowTitle  = DisplayLabel + " \xE2\x80\x94 Dedicated Studio###Studio_" + StableId;
    Win.Open         = true;
    Win.NeedsFocus   = true;
    (void)World;
    Windows_.push_back(std::move(Win));
}

void DedicatedEntityEditorHost::CloseEditorForEntity(const std::string &StableId)
{
    for (size_t I = 0; I < Windows_.size(); ++I)
    {
        if (Windows_[I].StableId == StableId)
        {
            RetireWindowTexture(Windows_[I], false);
            Windows_.erase(Windows_.begin() + static_cast<std::ptrdiff_t>(I));
            return;
        }
    }
}

void DedicatedEntityEditorHost::CloseAllEditors(bool GpuConfirmedIdle)
{
    for (OpenStudioWindow &Win : Windows_)
    {
        RetireWindowTexture(Win, GpuConfirmedIdle);
    }
    Windows_.clear();
    if (GpuConfirmedIdle)
    {
        ReclaimCompletedRetiredTextures(true);
    }
}

size_t DedicatedEntityEditorHost::OpenWindowCount() const noexcept
{
    size_t Cnt = 0u;
    for (const OpenStudioWindow &W : Windows_)
    {
        if (W.Open) ++Cnt;
    }
    return Cnt;
}

bool DedicatedEntityEditorHost::IsEditorOpen(const std::string &StableId) const noexcept
{
    for (const OpenStudioWindow &W : Windows_)
    {
        if (W.Open && W.StableId == StableId) return true;
    }
    return false;
}

bool DedicatedEntityEditorHost::VerifyZeroCopySharedAddresses(const DriveShowcaseWorld &World) const noexcept
{
    const auto *Base = static_cast<const uint8_t *>(World.SharedMemory().BaseAddress());
    const size_t Len = World.SharedMemory().MappedSizeBytes();
    if (Base == nullptr || Len < sizeof(ShowcaseRecordBundle))
    {
        return false;
    }
    for (const OpenStudioWindow &W : Windows_)
    {
        if (!W.Open) continue;
        const RecordEditorDescription *Desc = FindEditorDescriptionByStableId(W.StableId);
        if (Desc == nullptr || Desc->Enabled == nullptr)
        {
            return false;
        }
        const auto *FieldPtr = reinterpret_cast<const uint8_t *>(Desc->Enabled);
        if (FieldPtr < Base || FieldPtr >= Base + Len)
        {
            return false;
        }
    }
    return true;
}

void DedicatedEntityEditorHost::DrawStudioPresetBank(const std::string &StableId, DriveShowcaseWorld &World)
{
    const KitFaces Faces = ResolveKitFaces();
    ImDrawList    *Ink   = ImGui::GetWindowDrawList();
    ShowcaseRecordBundle &Rec = World.Records();

    struct PresetDef
    {
        const char *Label;
        int         Index;
    };

    auto DrawPresetGrid = [&](const char *Heading, const PresetDef *Presets, size_t Count, auto &&OnApply) {
        const ImVec2 Start = ImGui::GetCursorScreenPos();
        const float  W     = std::max(180.0f, ImGui::GetContentRegionAvail().x - 4.0f);
        const size_t Cols  = 3u;
        const size_t Rows  = (Count + Cols - 1u) / Cols;
        const float  CardH = 34.0f + static_cast<float>(Rows) * 30.0f;

        KitPillSurface(Ink, Start, ImVec2(Start.x + W, Start.y + CardH), KitInkHex(0x1c1c1c), KitInkHex(0x2e2e2e), 14.0f);
        Ink->AddCircleFilled(ImVec2(Start.x + 15.0f, Start.y + 16.0f), 3.0f, KitInkHex(0x3ec46d), 10);
        KitDrawTracked(Ink, Faces.Medium, 9.0f, ImVec2(Start.x + 24.0f, Start.y + 10.5f), KitInkHex(0xa8a8a8), Heading, 1.1f);

        const float Gap  = 5.0f;
        const float BtnW = (W - 24.0f - Gap * static_cast<float>(Cols - 1u)) / static_cast<float>(Cols);
        for (size_t I = 0; I < Count; ++I)
        {
            const size_t R  = I / Cols;
            const size_t C  = I % Cols;
            const float  BX = Start.x + 12.0f + static_cast<float>(C) * (BtnW + Gap);
            const float  BY = Start.y + 28.0f + static_cast<float>(R) * 29.0f;
            ImGui::PushID(static_cast<int>(I + 9100));
            ImGui::SetCursorScreenPos(ImVec2(BX, BY));
            ImGui::InvisibleButton("##StudioPresetBtn", ImVec2(BtnW, 25.0f));
            const bool Hov = ImGui::IsItemHovered();
            KitPillSurface(Ink, ImVec2(BX, BY), ImVec2(BX + BtnW, BY + 25.0f),
                           Hov ? KitInkHex(0x2c2c2c) : KitInkHex(0x131313),
                           Hov ? KitInkHex(0x525252) : KitInkHex(0x292929), 7.5f);
            const float TW = KitTextWidth(Faces.Medium, 9.5f, Presets[I].Label);
            KitDrawText(Ink, Faces.Medium, 9.5f, ImVec2(BX + (BtnW - TW) * 0.5f, BY + 6.5f),
                        Hov ? KitInkHex(0xf2f2f2) : KitInkHex(0xc8c8c8), Presets[I].Label);
            if (ImGui::IsItemClicked())
            {
                OnApply(Presets[I].Index);
                World.ForceViewportDirty();
            }
            ImGui::PopID();
        }
        ImGui::SetCursorScreenPos(ImVec2(Start.x, Start.y + CardH + 8.0f));
        ImGui::Dummy(ImVec2(1.0f, 0.0f));
    };

    if (StableId == "pyro_plume")
    {
        // Ported 1:1 from Experimental/Fluid/src/FluidPanel.js + presets.js (all 9 Pyro Plume presets!)
        static const PresetDef kPyroPresets[9] = {
            {"Campfire",       0}, {"Pyroclastic", 1}, {"Fireball",      2},
            {"Smokestack",     3}, {"Diesel",      4}, {"Rocket Plume",  5},
            {"Dry Ice Fog",    6}, {"Signal Flare",7}, {"Reset Default", 8},
        };
        DrawPresetGrid("EXPERIMENTAL/FLUID PYRO PLUME PRESETS (9)", kPyroPresets, 9, [&](int P) {
            auto &Pyro = Rec.PyroPlume;
            Pyro.Enabled = true;
            switch (P)
            {
                case 0: Pyro.PlumePreset = 0; Pyro.BurnTemperatureK = 1350; Pyro.BuoyancyLift = 5.2; Pyro.VorticityConfinement = 3.2; Pyro.FuelInjectionRate = 1.10; break;
                case 1: Pyro.PlumePreset = 1; Pyro.BurnTemperatureK = 1820; Pyro.BuoyancyLift = 9.8; Pyro.VorticityConfinement = 5.4; Pyro.FuelInjectionRate = 2.15; Pyro.TriggerDetonationBurst = true; break;
                case 2: Pyro.PlumePreset = 1; Pyro.BurnTemperatureK = 2050; Pyro.BuoyancyLift = 11.4; Pyro.VorticityConfinement = 5.8; Pyro.FuelInjectionRate = 2.65; Pyro.TriggerDetonationBurst = true; break;
                case 3: Pyro.PlumePreset = 0; Pyro.BurnTemperatureK = 820;  Pyro.BuoyancyLift = 4.1; Pyro.VorticityConfinement = 2.4; Pyro.FuelInjectionRate = 1.65; break;
                case 4: Pyro.PlumePreset = 2; Pyro.BurnTemperatureK = 760;  Pyro.BuoyancyLift = 3.2; Pyro.VorticityConfinement = 4.2; Pyro.FuelInjectionRate = 1.40; break;
                case 5: Pyro.PlumePreset = 1; Pyro.BurnTemperatureK = 2120; Pyro.BuoyancyLift = 12.0; Pyro.VorticityConfinement = 4.8; Pyro.FuelInjectionRate = 2.90; break;
                case 6: Pyro.PlumePreset = 0; Pyro.BurnTemperatureK = 700;  Pyro.BuoyancyLift = 0.8; Pyro.VorticityConfinement = 1.5; Pyro.FuelInjectionRate = 0.90; break;
                case 7: Pyro.PlumePreset = 0; Pyro.BurnTemperatureK = 1680; Pyro.BuoyancyLift = 6.4; Pyro.VorticityConfinement = 3.8; Pyro.FuelInjectionRate = 1.55; break;
                default:Pyro.PlumePreset = 0; Pyro.BurnTemperatureK = 1680; Pyro.BuoyancyLift = 4.8; Pyro.VorticityConfinement = 2.6; Pyro.FuelInjectionRate = 1.25; break;
            }
        });
    }
    else if (StableId == "solid_fracture")
    {
        static const PresetDef kFracPresets[6] = {
            {"Intact Wall", 0}, {"12-Shard Crack", 1}, {"28-Shard Cleave", 2},
            {"42-Shard Blast", 3}, {"Wide Gap 0.45m", 4}, {"Rebuild Reset", 5},
        };
        DrawPresetGrid("VORONOI FRACTURE STUDIO PRESETS", kFracPresets, 6, [&](int P) {
            auto &Fr = Rec.SolidFracture;
            Fr.Enabled = true;
            switch (P)
            {
                case 0: Fr.CleavedState = false; Fr.TriggerResetIntact = true; break;
                case 1: Fr.TargetVoronoiSites = 12; Fr.RadialShardGapM = 0.14; Fr.CleavedState = true; Fr.TriggerCleaveNow = true; break;
                case 2: Fr.TargetVoronoiSites = 28; Fr.RadialShardGapM = 0.24; Fr.CleavedState = true; Fr.TriggerCleaveNow = true; break;
                case 3: Fr.TargetVoronoiSites = 42; Fr.RadialShardGapM = 0.36; Fr.CleavedState = true; Fr.TriggerCleaveNow = true; break;
                case 4: Fr.RadialShardGapM = 0.45; Fr.CleavedState = true; break;
                default:Fr.TargetVoronoiSites = 28; Fr.RadialShardGapM = 0.22; Fr.CleavedState = true; Fr.TriggerCleaveNow = true; break;
            }
        });
    }
    else if (StableId == "sparks" || StableId == "precipitation" || StableId == "snow_mound" || StableId == "lightning")
    {
        static const PresetDef kPartPresets[6] = {
            {"Welding Shower", 0}, {"Rim Scrape", 1}, {"Clear Sunlit", 2},
            {"Rain Squall",    3}, {"Alpine Snow", 4}, {"Hailstorm",    5},
        };
        DrawPresetGrid("PARTICLE & PRECIPITATION STUDIO PRESETS", kPartPresets, 6, [&](int P) {
            switch (P)
            {
                case 0: Rec.SparkEmitter.Enabled = true; Rec.SparkEmitter.EmissionRatePerSec = 320.0; Rec.SparkEmitter.LaunchSpeedMps = 15.5; Rec.SparkEmitter.TriggerSparkBurst = true; break;
                case 1: Rec.SparkEmitter.Enabled = true; Rec.SparkEmitter.EmissionRatePerSec = 140.0; Rec.SparkEmitter.BounceRestitution = 0.78; break;
                case 2: Rec.SkyPrecipitation.WeatherMode = 0; break;
                case 3: Rec.SkyPrecipitation.Enabled = true; Rec.SkyPrecipitation.WeatherMode = 1; Rec.SkyPrecipitation.RainIntensity = 0.85; break;
                case 4: Rec.SkyPrecipitation.Enabled = true; Rec.SkyPrecipitation.WeatherMode = 2; Rec.SkyPrecipitation.SnowfallIntensity = 0.92; break;
                default:Rec.SkyPrecipitation.Enabled = true; Rec.SkyPrecipitation.WeatherMode = 3; Rec.SkyPrecipitation.HailIntensity = 0.88; break;
            }
        });
    }
    else if (StableId.find("placeable_") == 0 || StableId.find("spawned_3d_") == 0)
    {
        ShowcasePlaceableObjectRecord *Obj = nullptr;
        if (StableId == "placeable_chicane_block")   Obj = &Rec.PlaceableChicaneBlock;
        if (StableId == "placeable_nanite_pedestal") Obj = &Rec.PlaceableNanitePedestal;
        if (StableId == "placeable_optical_arch")    Obj = &Rec.PlaceableOpticalArch;
        if (StableId == "spawned_3d_object_0")       Obj = &Rec.SpawnedObjectSlot0;
        if (StableId == "spawned_3d_object_1")       Obj = &Rec.SpawnedObjectSlot1;
        if (Obj != nullptr)
        {
            static const PresetDef kObjPresets[6] = {
                {"Concrete", 0}, {"Signal Orange", 1}, {"Anodized Cu", 2},
                {"Obsidian", 3}, {"Crown Glass",   4}, {"Snap Ground", 5},
            };
            DrawPresetGrid("3D OBJECT MATERIAL & PLACEMENT PRESETS", kObjPresets, 6, [Obj](int P) {
                Obj->Enabled = true;
                if (P <= 4)
                {
                    Obj->MaterialPreset = P;
                }
                else
                {
                    Obj->PosZ = Obj->HalfExtentZ;
                }
            });
        }
    }
    else if (StableId == "sun" || StableId == "sky_atmosphere" || StableId == "render_pipeline" || StableId == "clouds" || StableId == "fog")
    {
        static const PresetDef kSunPresets[6] = {
            {"Crisp Shadows", 0}, {"Golden Hour", 1}, {"High Noon", 2},
            {"Night Sky",     3}, {"RTX Full RT", 4}, {"GTX SDF GI", 5},
        };
        DrawPresetGrid("ILLUMINATION & TIER STUDIO PRESETS", kSunPresets, 6, [&](int P) {
            switch (P)
            {
                case 0: Rec.AtmosphereSky.SkyTimePreset = 0; Rec.DirectionalSun.ElevationDeg = 28.5; Rec.DirectionalSun.AzimuthDeg = 118.0; Rec.VolumetricClouds.Coverage = 0.26; break;
                case 1: Rec.AtmosphereSky.SkyTimePreset = 0; Rec.DirectionalSun.ElevationDeg = 9.5;  Rec.DirectionalSun.AzimuthDeg = 128.0; Rec.DirectionalSun.WarmTint = 0.78; break;
                case 2: Rec.AtmosphereSky.SkyTimePreset = 0; Rec.DirectionalSun.ElevationDeg = 64.0; Rec.DirectionalSun.AzimuthDeg = 155.0; Rec.DirectionalSun.WarmTint = 0.05; break;
                case 3: Rec.AtmosphereSky.SkyTimePreset = 2; break;
                case 4: Rec.RenderPipeline.TracingTier = 1; break;
                default:Rec.RenderPipeline.TracingTier = 0; break;
            }
        });
    }
    else
    {
        static const PresetDef kVehPresets[6] = {
            {"Alpine Silver", 0}, {"Frontier Mint", 1}, {"Crimson Corsa", 2},
            {"Deep Cobalt",   3}, {"Autopilot",     4}, {"Parked Studio", 5},
        };
        DrawPresetGrid("VEHICLE & CABIN STUDIO PRESETS", kVehPresets, 6, [&](int P) {
            if (P <= 3) Rec.ControlVehicle.PaintPreset = P;
            else if (P == 4) Rec.ControlVehicle.DriveProgram = 1;
            else Rec.ControlVehicle.DriveProgram = 0;
        });
    }
}

void DedicatedEntityEditorHost::DrawSingleStudioWindow(OpenStudioWindow &Win, DriveShowcaseWorld &World, size_t WindowIndex)
{
    const RecordEditorDescription *Desc = FindEditorDescriptionByStableId(Win.StableId);
    if (Desc == nullptr)
    {
        Win.Open = false;
        return;
    }

    ImGui::SetNextWindowSize(ImVec2(820.0f, 548.0f), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowPos(
        ImVec2(240.0f + static_cast<float>(WindowIndex) * 34.0f, 84.0f + static_cast<float>(WindowIndex) * 28.0f),
        ImGuiCond_FirstUseEver);
    if (Win.NeedsFocus)
    {
        ImGui::SetNextWindowFocus();
        Win.NeedsFocus = false;
    }

    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.067f, 0.067f, 0.067f, 0.99f));     // #111111 Dark OLED
    ImGui::PushStyleColor(ImGuiCol_TitleBg, ImVec4(0.045f, 0.045f, 0.045f, 1.00f));      // #0b0b0b
    ImGui::PushStyleColor(ImGuiCol_TitleBgActive, ImVec4(0.085f, 0.085f, 0.085f, 1.00f));// #161616
    ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.22f, 0.22f, 0.22f, 1.00f));          // #383838
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 14.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(14.0f, 12.0f));

    if (ImGui::Begin(Win.WindowTitle.c_str(), &Win.Open, ImGuiWindowFlags_NoDocking | ImGuiWindowFlags_NoCollapse))
    {
        const KitFaces Faces = ResolveKitFaces();
        ImDrawList    *Ink   = ImGui::GetWindowDrawList();
        const ImVec2   WPos  = ImGui::GetWindowPos();
        const ImVec2   Cur0  = ImGui::GetCursorScreenPos();
        const float    AvailW = ImGui::GetContentRegionAvail().x;

        // Top Zero-Copy Shared Memory Studio Banner
        KitDrawTracked(Ink, Faces.Medium, 8.5f, ImVec2(Cur0.x + 2.0f, Cur0.y + 1.0f),
                       KitInkHex(0x888888), Win.StudioFamily.c_str(), 1.3f);
        KitDrawText(Ink, Faces.Medium, 16.0f, ImVec2(Cur0.x + 2.0f, Cur0.y + 14.0f),
                    KitInkHex(0xececec), Desc->DisplayName != nullptr ? Desc->DisplayName : Win.StableId.c_str());

        char ShmBadge[96] = {};
        std::snprintf(ShmBadge, sizeof(ShmBadge), "SHM %s \xC2\xB7 %p \xC2\xB7 0 B DUP",
                      World.SharedMemory().IsOsSharedMapping() ? "MAP_SHARED" : "SHARED",
                      static_cast<const void *>(Desc->Enabled));
        const float BadgeW = KitTextWidth(Faces.Medium, 9.5f, ShmBadge) + 24.0f;
        const float BadgeX = Cur0.x + AvailW - BadgeW;
        KitPillSurface(Ink, ImVec2(BadgeX, Cur0.y + 6.0f), ImVec2(BadgeX + BadgeW, Cur0.y + 30.0f),
                       KitInkHex(0x17261d), KitInkHex(0x2f6d45), 12.0f);
        Ink->AddCircleFilled(ImVec2(BadgeX + 11.0f, Cur0.y + 18.0f), 3.0f, KitInkHex(0x3ec46d), 10);
        KitDrawText(Ink, Faces.Medium, 9.5f, ImVec2(BadgeX + 18.0f, Cur0.y + 11.5f), KitInkHex(0x9be6b8), ShmBadge);

        Ink->AddLine(ImVec2(WPos.x, Cur0.y + 39.0f), ImVec2(WPos.x + ImGui::GetWindowSize().x, Cur0.y + 39.0f),
                     KitInkHex(0x262626), 1.0f);
        ImGui::SetCursorScreenPos(ImVec2(Cur0.x, Cur0.y + 47.0f));

        // Split Body: Left = Live 3D Isolated Entity Viewport | Right = Ported Presets + Live Shared-Memory Controls
        const float BodyH = std::max(180.0f, ImGui::GetContentRegionAvail().y - 4.0f);
        const float LeftW = std::clamp(AvailW * 0.45f, 280.0f, 390.0f);

        if (Win.AutoTurntable)
        {
            Win.OrbitYawRad += 0.018f;
        }

        // Render live 3D studio preview directly from SharedRecords_ + live solvers (0 RAM duplication!)
        constexpr uint32_t PrevW = 240u;
        constexpr uint32_t PrevH = 180u;
        ++Win.FrameThrottle;
        const uint64_t CurWorldRev = World.SceneDirtyRevision();
        const bool NeedsPreviewUpdate = !Win.TextureRegistered || Win.AutoTurntable ||
                                        (Win.LastRenderedWorldRev != CurWorldRev) ||
                                        (!World.NonBlockingStudioPreviews() && (Win.FrameThrottle % 4u == 1u));
        if (NeedsPreviewUpdate)
        {
            if (World.TryRenderDedicatedEntityPreview(Win.StableId, PrevW, PrevH,
                                                      Win.OrbitYawRad, Win.OrbitPitchRad, Win.OrbitDistanceScale,
                                                      Win.PreviewInspectMode, Win.PreviewRgba))
            {
                Win.LastRenderedWorldRev = CurWorldRev;
                if (!Win.TextureRegistered)
                {
                    Win.PreviewTexture = std::make_unique<ImTextureData>();
                    Win.PreviewTexture->Create(ImTextureFormat_RGBA32, static_cast<int>(PrevW), static_cast<int>(PrevH));
                    std::memcpy(Win.PreviewTexture->GetPixels(), Win.PreviewRgba.data(), PrevW * PrevH * 4u);
                    ImGui::RegisterUserTexture(Win.PreviewTexture.get());
                    Win.TextureRegistered = true;
                }
                else
                {
                    std::memcpy(Win.PreviewTexture->GetPixels(), Win.PreviewRgba.data(), PrevW * PrevH * 4u);
                    Win.PreviewTexture->UpdateRect = ImTextureRect{
                        0u, 0u, static_cast<unsigned short>(PrevW), static_cast<unsigned short>(PrevH)};
                    Win.PreviewTexture->UsedRect = Win.PreviewTexture->UpdateRect;
                    if (Win.PreviewTexture->Status == ImTextureStatus_OK)
                    {
                        Win.PreviewTexture->SetStatus(ImTextureStatus_WantUpdates);
                    }
                }
            }
        }

        ImGui::BeginChild("##StudioLeft3D", ImVec2(LeftW, BodyH), false);
        {
            ImDrawList *LInk = ImGui::GetWindowDrawList();
            const ImVec2 VP  = ImGui::GetCursorScreenPos();
            const float  VH  = std::max(140.0f, BodyH - 72.0f);

            KitPillSurface(LInk, VP, ImVec2(VP.x + LeftW, VP.y + VH), KitInkHex(0x0a0a0a), KitInkHex(0x2c2c2c), 12.0f);
            if (Win.TextureRegistered && Win.PreviewTexture)
            {
                ImGui::SetCursorScreenPos(ImVec2(VP.x + 2.0f, VP.y + 2.0f));
                ImGui::Image(Win.PreviewTexture->GetTexRef(), ImVec2(LeftW - 4.0f, VH - 4.0f));
                if (ImGui::IsItemHovered())
                {
                    ImGuiIO &IO = ImGui::GetIO();
                    if (ImGui::IsMouseDragging(ImGuiMouseButton_Left) || ImGui::IsMouseDragging(ImGuiMouseButton_Right))
                    {
                        Win.OrbitYawRad   -= IO.MouseDelta.x * 0.012f;
                        Win.OrbitPitchRad  = std::clamp(Win.OrbitPitchRad + IO.MouseDelta.y * 0.010f, 0.06f, 1.24f);
                        Win.FrameThrottle  = 0u;
                    }
                    if (std::abs(IO.MouseWheel) > 0.01f)
                    {
                        Win.OrbitDistanceScale = std::clamp(Win.OrbitDistanceScale - IO.MouseWheel * 0.10f, 0.45f, 2.4f);
                        Win.FrameThrottle      = 0u;
                    }
                }
            }

            // Overlay hint on 3D preview
            KitPillSurface(LInk, ImVec2(VP.x + 10.0f, VP.y + 10.0f), ImVec2(VP.x + 178.0f, VP.y + 30.0f),
                           IM_COL32(10, 10, 10, 200), KitInkHex(0x2c2c2c), 8.0f);
            KitDrawText(LInk, Faces.Regular, 9.5f, ImVec2(VP.x + 18.0f, VP.y + 14.0f),
                        KitInkHex(0xc8c8c8), "3D Live View \xC2\xB7 Drag Orbit");

            // Studio View Mode Bar (Lit | Shadows | GI | Normals | Turntable)
            const float BarY = VP.y + VH + 8.0f;
            KitPillSurface(LInk, ImVec2(VP.x, BarY), ImVec2(VP.x + LeftW, BarY + 28.0f),
                           KitInkHex(0x111111), KitInkHex(0x282828), 9.0f);
            struct ViewModeOpt { const char *Label; uint8_t Mode; };
            static const ViewModeOpt kModes[4] = {{"Lit 3D", 0}, {"Shadows", 1}, {"ReSTIR GI", 2}, {"Normals", 5}};
            const float MW = (LeftW - 84.0f) * 0.25f;
            for (int M = 0; M < 4; ++M)
            {
                const float MX  = VP.x + 4.0f + static_cast<float>(M) * MW;
                const bool  Act = (Win.PreviewInspectMode == kModes[M].Mode);
                ImGui::PushID(8200 + M);
                ImGui::SetCursorScreenPos(ImVec2(MX, BarY + 3.0f));
                ImGui::InvisibleButton("##VMode", ImVec2(MW - 2.0f, 22.0f));
                if (ImGui::IsItemClicked())
                {
                    Win.PreviewInspectMode = kModes[M].Mode;
                    Win.FrameThrottle      = 0u;
                }
                if (Act)
                {
                    KitPillSurface(LInk, ImVec2(MX, BarY + 3.0f), ImVec2(MX + MW - 2.0f, BarY + 25.0f),
                                   KitInkHex(0x2d2d2d), KitInkHex(0x424242), 6.5f);
                }
                const float TW = KitTextWidth(Faces.Regular, 9.5f, kModes[M].Label);
                KitDrawText(LInk, Faces.Regular, 9.5f, ImVec2(MX + (MW - TW) * 0.5f, BarY + 7.5f),
                            Act ? KitInkHex(0xf0f0f0) : KitInkHex(0x888888), kModes[M].Label);
                ImGui::PopID();
            }
            const float TurnX = VP.x + LeftW - 76.0f;
            ImGui::SetCursorScreenPos(ImVec2(TurnX, BarY + 3.0f));
            ImGui::InvisibleButton("##TurntableToggle", ImVec2(72.0f, 22.0f));
            if (ImGui::IsItemClicked())
            {
                Win.AutoTurntable = !Win.AutoTurntable;
            }
            KitPillSurface(LInk, ImVec2(TurnX, BarY + 3.0f), ImVec2(TurnX + 72.0f, BarY + 25.0f),
                           Win.AutoTurntable ? KitInkHex(0x1f3a29) : KitInkHex(0x1d1d1d),
                           Win.AutoTurntable ? KitInkHex(0x3ec46d) : KitInkHex(0x323232), 6.5f);
            KitDrawText(LInk, Faces.Medium, 9.5f, ImVec2(TurnX + 12.0f, BarY + 7.5f),
                        Win.AutoTurntable ? KitInkHex(0x9be6b8) : KitInkHex(0xa8a8a8), "Turntable");

            KitDrawText(LInk, Faces.Regular, 9.5f, ImVec2(VP.x + 2.0f, BarY + 36.0f), KitInkHex(0x7d7d7d),
                        "Edits mutate SharedRecords_ in-place -> updates Scene + Studio live.");
        }
        ImGui::EndChild();

        ImGui::SameLine(0.0f, 12.0f);

        // Right Pane: Ported Dedicated Studio Presets + Live Zero-Copy Parameters
        ImGui::BeginChild("##StudioRightControls", ImVec2(0.0f, BodyH), false);
        {
            DrawStudioPresetBank(Win.StableId, World);

            if (Desc->ConstructInfographic)
            {
                Desc->ConstructInfographic();
            }

            ImDrawList *RInk = ImGui::GetWindowDrawList();
            const float RW   = std::max(180.0f, ImGui::GetContentRegionAvail().x - 4.0f);

            // Live Shared-Memory Scalar Sliders (exact FrontierEditor.css 3px #c8c8c8 platinum rail)
            if (!Desc->ScalarFields.empty())
            {
                const ImVec2 CardP = ImGui::GetCursorScreenPos();
                const float  RowH  = 44.0f;
                const float  CardH = 36.0f + static_cast<float>(Desc->ScalarFields.size()) * RowH;
                KitPillSurface(RInk, CardP, ImVec2(CardP.x + RW, CardP.y + CardH),
                               KitInkHex(0x1c1c1c), KitInkHex(0x2e2e2e), 14.0f);
                KitDrawTracked(RInk, Faces.Medium, 9.0f, ImVec2(CardP.x + 14.0f, CardP.y + 11.0f),
                               KitInkHex(0xa8a8a8), "SHARED-MEMORY LIVE PARAMETERS", 1.1f);

                for (size_t K = 0; K < Desc->ScalarFields.size(); ++K)
                {
                    const auto &Field = Desc->ScalarFields[K];
                    const float RY    = CardP.y + 32.0f + static_cast<float>(K) * RowH;
                    double      Val   = ReadFieldScalar(Field);

                    KitDrawText(RInk, Faces.Regular, 10.0f, ImVec2(CardP.x + 14.0f, RY + 1.0f),
                                KitInkHex(0xb8b8b8), Field.Label != nullptr ? Field.Label : "");

                    char VStr[40] = {};
                    std::snprintf(VStr, sizeof(VStr), "%.*f %s", std::clamp(Field.Digits, 0, 4), Val,
                                  (Field.Unit != nullptr && std::string(Field.Unit) != "-") ? Field.Unit : "");
                    const float VW = KitTextWidth(Faces.Medium, 10.0f, VStr);
                    KitDrawText(RInk, Faces.Medium, 10.0f, ImVec2(CardP.x + RW - VW - 14.0f, RY + 1.0f),
                                KitInkHex(0xe8e8e8), VStr);

                    const float SX    = CardP.x + 14.0f;
                    const float SW    = RW - 28.0f;
                    const float RailY = RY + 26.0f;
                    ImGui::PushID(static_cast<int>(K + 9500));
                    ImGui::SetCursorScreenPos(ImVec2(SX, RailY - 8.0f));
                    ImGui::InvisibleButton("##StudioSlider", ImVec2(SW, 16.0f));
                    if (ImGui::IsItemActive())
                    {
                        const float T = std::clamp((ImGui::GetIO().MousePos.x - SX) / SW, 0.0f, 1.0f);
                        double Next   = Field.Minimum + static_cast<double>(T) * (Field.Maximum - Field.Minimum);
                        if (Field.Step > 0.0) Next = std::round(Next / Field.Step) * Field.Step;
                        if (WriteFieldScalar(Field, Next))
                        {
                            Val = ReadFieldScalar(Field);
                            if (Desc->Revision != nullptr) ++(*Desc->Revision);
                            Win.FrameThrottle = 0u;
                        }
                    }
                    const float Norm = (Field.Maximum > Field.Minimum)
                        ? static_cast<float>(std::clamp((Val - Field.Minimum) / (Field.Maximum - Field.Minimum), 0.0, 1.0))
                        : 0.0f;
                    RInk->AddRectFilled(ImVec2(SX, RailY - 1.5f), ImVec2(SX + SW, RailY + 1.5f), KitInkHex(0x3e3e3e), 2.0f);
                    if (Norm > 0.004f)
                    {
                        RInk->AddRectFilled(ImVec2(SX, RailY - 1.5f), ImVec2(SX + SW * Norm, RailY + 1.5f), KitInkHex(0xc8c8c8), 2.0f);
                    }
                    RInk->AddCircleFilled(ImVec2(SX + SW * Norm, RailY), 7.0f, KitInkHex(0x1c1c1c), 14);
                    RInk->AddCircleFilled(ImVec2(SX + SW * Norm, RailY), 4.6f, KitInkHex(0xeaeaea), 14);
                    ImGui::PopID();
                }
                ImGui::SetCursorScreenPos(ImVec2(CardP.x, CardP.y + CardH + 10.0f));
                ImGui::Dummy(ImVec2(1.0f, 0.0f));
            }
        }
        ImGui::EndChild();
    }
    ImGui::End();
    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor(4);
}

void DedicatedEntityEditorHost::RenderOpenEditorWindows(DriveShowcaseWorld &World)
{
    ReclaimCompletedRetiredTextures(false);
    for (size_t I = 0; I < Windows_.size();)
    {
        if (!Windows_[I].Open)
        {
            RetireWindowTexture(Windows_[I], false);
            Windows_.erase(Windows_.begin() + static_cast<std::ptrdiff_t>(I));
            continue;
        }
        DrawSingleStudioWindow(Windows_[I], World, I);
        ++I;
    }
}

} // namespace Frontier::Drive

#else

namespace Frontier::Drive
{
DedicatedEntityEditorHost::~DedicatedEntityEditorHost() = default;
void DedicatedEntityEditorHost::OpenEditorForEntity(const std::string &, DriveShowcaseWorld &) {}
void DedicatedEntityEditorHost::CloseEditorForEntity(const std::string &) {}
void DedicatedEntityEditorHost::CloseAllEditors(bool) {}
void DedicatedEntityEditorHost::RenderOpenEditorWindows(DriveShowcaseWorld &) {}
size_t DedicatedEntityEditorHost::OpenWindowCount() const noexcept { return 0u; }
bool DedicatedEntityEditorHost::IsEditorOpen(const std::string &) const noexcept { return false; }
bool DedicatedEntityEditorHost::VerifyZeroCopySharedAddresses(const DriveShowcaseWorld &) const noexcept { return true; }
} // namespace Frontier::Drive

#endif
