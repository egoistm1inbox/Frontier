/*==========================================================================================================================================
                                                      ASSETBROWSERWORKSPACECATALOGUE.CPP
==========================================================================================================================================*/
// 🧩 The Asset Browser catalogue: 150 read-only records aggregated 1:1 from the six workspace query APIs — Particle 52
//    presets, Fluid 18 presets, Fracture 6 materials + 6 solvers + 8 presets + 7 construct seeds, Force Fields 17
//    types, Photometric 7 lights + 6 moons + 7 measured + 8 analytical IES profiles + 4 rig scenarios, UV 4 sample
//    assets. Folders, kinds, ids, and meta mirror the HTML prototype exactly so the two browsers stay interchangeable.
//    Filtering, sorting, selection, favorites, recents, and the workspace link live here too: pure state logic the
//    validation drives without rendering.

#include "Frontier/Engine/Interface/Workspaces/AssetBrowserWorkspace.h"

#include "Frontier/Engine/Interface/Workspaces/FluidWorkspace.h"
#include "Frontier/Engine/Interface/Workspaces/ForceFieldWorkspace.h"
#include "Frontier/Engine/Interface/Workspaces/FractureWorkspace.h"
#include "Frontier/Engine/Interface/Workspaces/ParticleWorkspace.h"
#include "Frontier/Engine/Interface/Workspaces/PhotometricWorkspace.h"
#include "Frontier/Engine/Interface/Workspaces/UvWorkspace.h"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstring>

namespace Frontier
{

namespace
{

constexpr const char* WorkspaceNames[AssetBrowserWorkspaceCount] = {
    "Particle Lab", "Fluid Studio", "Fracture Lab", "Force Fields", "Photometric", "UV Studio"
};

// 📝 Tag slug: lowercase, & becomes "and", every other non-alphanumeric run becomes one dash.
std::string Slug(const char* Text)
{
    std::string Out;
    bool        Dash = false;
    for (const char* P = Text; *P != '\0'; ++P)
    {
        const unsigned char C = static_cast<unsigned char>(*P);
        if (std::isalnum(C) != 0)
        {
            Out += static_cast<char>(std::tolower(C));
            Dash = false;
        }
        else if (*P == '&')
        {
            Out += "and";
            Dash = false;
        }
        else if (!Dash && !Out.empty())
        {
            Out += '-';
            Dash = true;
        }
    }
    while (!Out.empty() && Out.back() == '-') Out.pop_back();
    return Out;
}

const char* ForceFieldContributionLabel(int Contribution) noexcept
{
    if (Contribution == ForceFieldContributionAccelerate) return "Accelerate";
    if (Contribution == ForceFieldContributionDamp) return "Damp";
    return "Flow";
}

void PushRecord(std::vector<AssetBrowserRecord>& Records, AssetBrowserRecord&& Record)
{
    Records.push_back(std::move(Record));
}

void BuildParticleRecords(std::vector<AssetBrowserRecord>& Records)
{
    for (int I = 0; I < QueryParticlePresetCount(); ++I)
    {
        const ParticleWorkspacePreset& Preset = QueryParticlePreset(I);
        AssetBrowserRecord Record;
        Record.Id             = std::string("particle/") + Preset.Id;
        Record.Name           = Preset.Name;
        Record.Workspace      = WorkspaceNames[AssetBrowserWorkspaceParticle];
        Record.Folder         = Record.Workspace + "/" + Preset.Group;
        Record.Kind           = "Preset";
        Record.Blurb          = Preset.Blurb;
        Record.Glyph          = Preset.Glyph;
        Record.Colour         = Preset.Colour;
        Record.WorkspaceIndex = AssetBrowserWorkspaceParticle;
        Record.Meta.push_back({ "Behaviour", QueryParticleBehaviourName(Preset.Behaviour) });
        Record.Meta.push_back({ "Appearance", QueryParticleAppearanceName(Preset.Appearance) });
        Record.Meta.push_back({ "Group", Preset.Group });
        Record.Tags.push_back(Slug(Preset.Group));
        Record.Tags.push_back(Slug(QueryParticleBehaviourName(Preset.Behaviour)));
        PushRecord(Records, std::move(Record));
    }
}

void BuildFluidRecords(std::vector<AssetBrowserRecord>& Records)
{
    for (int I = 0; I < QueryFluidPresetCount(); ++I)
    {
        const FluidWorkspacePreset& Preset = QueryFluidPreset(I);
        const char*                 Group  = QueryFluidGroupName(Preset.Group);
        AssetBrowserRecord          Record;
        Record.Id             = std::string("fluid/") + Preset.Id;
        Record.Name           = Preset.Name;
        Record.Workspace      = WorkspaceNames[AssetBrowserWorkspaceFluid];
        Record.Folder         = Record.Workspace + "/" + Group;
        Record.Kind           = "Preset";
        Record.Blurb          = Preset.Blurb;
        Record.Glyph          = Preset.Glyph;
        Record.Colour         = Preset.Colour;
        Record.WorkspaceIndex = AssetBrowserWorkspaceFluid;
        Record.Meta.push_back({ "Group", Group });
        Record.Tags.push_back(Slug(Group));
        PushRecord(Records, std::move(Record));
    }
}

void BuildFractureRecords(std::vector<AssetBrowserRecord>& Records)
{
    for (int I = 0; I < QueryFractureMaterialCount(); ++I)
    {
        const FractureWorkspaceMaterial& Material = QueryFractureMaterial(I);
        char                             Density[32]{};
        std::snprintf(Density, sizeof(Density), "%.1f kg/m³", Material.Density);
        AssetBrowserRecord Record;
        Record.Id             = std::string("fracture-mat/") + Material.Id;
        Record.Name           = Material.Label;
        Record.Workspace      = WorkspaceNames[AssetBrowserWorkspaceFracture];
        Record.Folder         = Record.Workspace + "/Materials";
        Record.Kind           = "Material";
        Record.Blurb          = std::string(Material.ShortLabel) + " · " + Material.FractureCategory + " fracture model.";
        Record.Glyph          = "Gem";
        Record.Colour         = Material.Exterior;
        Record.WorkspaceIndex = AssetBrowserWorkspaceFracture;
        Record.Meta.push_back({ "Model", Material.FractureCategory });
        Record.Meta.push_back({ "Density", Density });
        Record.Tags.emplace_back("material");
        Record.Tags.push_back(Slug(Material.FractureCategory));
        PushRecord(Records, std::move(Record));
    }
    for (int I = 0; I < QueryFractureSolverCount(); ++I)
    {
        const FractureWorkspaceSolver& Solver = QueryFractureSolver(I);
        AssetBrowserRecord             Record;
        Record.Id             = std::string("fracture-solver/") + Solver.Id;
        Record.Name           = Solver.Name;
        Record.Workspace      = WorkspaceNames[AssetBrowserWorkspaceFracture];
        Record.Folder         = Record.Workspace + "/Solvers";
        Record.Kind           = "Solver";
        Record.Blurb          = Solver.Mechanism;
        Record.Glyph          = "StudioGauge";
        Record.Colour         = 0x9ECFFFFF;
        Record.WorkspaceIndex = AssetBrowserWorkspaceFracture;
        Record.Meta.push_back({ "Backend", Solver.Lineage });
        Record.Meta.push_back({ "Cost", Solver.Cpu });
        Record.Meta.push_back({ "Tier", Solver.Realtime });
        Record.Tags.emplace_back("solver");
        PushRecord(Records, std::move(Record));
    }
    for (int I = 0; I < QueryFracturePresetCount(); ++I)
    {
        const FractureWorkspacePreset& Preset = QueryFracturePreset(I);
        const int                      Mat    = QueryFractureMaterialById(Preset.Material);
        const int                      Solver = QueryFractureSolverById(Preset.Solver);
        AssetBrowserRecord             Record;
        Record.Id             = std::string("fracture/") + Preset.Category + "-" + Preset.Material;
        Record.Name           = Preset.Title;
        Record.Workspace      = WorkspaceNames[AssetBrowserWorkspaceFracture];
        Record.Folder         = Record.Workspace + "/Presets";
        Record.Kind           = "Preset";
        Record.Blurb          = Preset.Blurb;
        Record.Glyph          = "Boxes";
        Record.Colour         = 0xE8C27AFF;
        Record.WorkspaceIndex = AssetBrowserWorkspaceFracture;
        Record.Meta.push_back({ "Mesh", Preset.Category });
        Record.Meta.push_back({ "Material", Mat >= 0 ? QueryFractureMaterial(Mat).Label : Preset.Material });
        Record.Meta.push_back({ "Solver", Solver >= 0 ? QueryFractureSolver(Solver).Name : Preset.Solver });
        Record.Meta.push_back({ "Group", Preset.Group });
        Record.Tags.push_back(Slug(Preset.Group));
        PushRecord(Records, std::move(Record));
    }
    for (int I = 0; I < QueryFractureConstructSeedCount(); ++I)
    {
        const FractureConstructSeed& Seed = QueryFractureConstructSeed(I);
        char                         Cells[16]{};
        std::snprintf(Cells, sizeof(Cells), "%d", Seed.PrimaryNucleusCells);
        AssetBrowserRecord Record;
        Record.Id             = std::string("fracture/") + Seed.Id;
        Record.Name           = Seed.Title;
        Record.Workspace      = WorkspaceNames[AssetBrowserWorkspaceFracture];
        Record.Folder         = Record.Workspace + "/Constructs";
        Record.Kind           = "Construct";
        Record.Blurb          = std::string(Seed.SolidCategory) + " · " + Seed.Pipeline + " · " + Cells + " fragments.";
        Record.Glyph          = "StudioLayers";
        Record.Colour         = 0x8FD3C4FF;
        Record.WorkspaceIndex = AssetBrowserWorkspaceFracture;
        Record.Meta.push_back({ "Mesh", Seed.SolidCategory });
        Record.Meta.push_back({ "Mode", Seed.Pipeline });
        Record.Meta.push_back({ "Fragments", Cells });
        Record.Tags.emplace_back("construct");
        Record.Tags.emplace_back(Seed.Pipeline);
        PushRecord(Records, std::move(Record));
    }
}

void BuildForceFieldRecords(std::vector<AssetBrowserRecord>& Records)
{
    for (int I = 0; I < QueryForceFieldTypeCount(); ++I)
    {
        const ForceFieldWorkspaceType& Type  = QueryForceFieldType(I);
        const char*                    Label = ForceFieldContributionLabel(Type.Contribution);
        AssetBrowserRecord             Record;
        Record.Id             = std::string("forcefield/") + Type.Id;
        Record.Name           = Type.Name;
        Record.Workspace      = WorkspaceNames[AssetBrowserWorkspaceForceField];
        Record.Folder         = Record.Workspace + "/" + Label;
        Record.Kind           = "Field Type";
        Record.Blurb          = Type.Blurb;
        Record.Glyph          = Type.Glyph;
        Record.Colour         = Type.Colour;
        Record.WorkspaceIndex = AssetBrowserWorkspaceForceField;
        Record.Meta.push_back({ "Contribution", Label });
        Record.Tags.push_back(Slug(Label));
        PushRecord(Records, std::move(Record));
    }
}

void BuildPhotometricRecords(std::vector<AssetBrowserRecord>& Records)
{
    for (int I = 0; I < QueryPhotometricLightSpecCount(); ++I)
    {
        const PhotometricLightSpec& Spec = QueryPhotometricLightSpec(I);
        AssetBrowserRecord          Record;
        Record.Id             = std::string("photo-light/") + Spec.Id;
        Record.Name           = Spec.Label;
        Record.Workspace      = WorkspaceNames[AssetBrowserWorkspacePhotometric];
        Record.Folder         = Record.Workspace + "/Lights";
        Record.Kind           = "Light";
        Record.Blurb          = std::string(Spec.ShortLabel) + " · output in " + Spec.Unit + ".";
        Record.Glyph          = "Lightbulb";
        Record.Colour         = Spec.Accent;
        Record.WorkspaceIndex = AssetBrowserWorkspacePhotometric;
        Record.Meta.push_back({ "Unit", Spec.Unit });
        Record.Tags.emplace_back("light");
        PushRecord(Records, std::move(Record));
    }
    for (int I = 0; I < QueryPhotometricMoonCount(); ++I)
    {
        const PhotometricMoonSpec& Moon = QueryPhotometricMoon(I);
        AssetBrowserRecord         Record;
        Record.Id             = std::string("photo-moon/") + Moon.Id;
        Record.Name           = Moon.Name;
        Record.Workspace      = WorkspaceNames[AssetBrowserWorkspacePhotometric];
        Record.Folder         = Record.Workspace + "/Moons";
        Record.Kind           = "Moon";
        Record.Blurb          = Moon.Subtitle;
        Record.Glyph          = "Moon";
        Record.Colour         = Moon.Tint;
        Record.WorkspaceIndex = AssetBrowserWorkspacePhotometric;
        Record.Meta.push_back({ "Body", Moon.Name });
        Record.Tags.emplace_back("moon");
        Record.Tags.emplace_back("celestial");
        PushRecord(Records, std::move(Record));
    }
    for (int I = 0; I < QueryPhotometricMeasuredIesCount(); ++I)
    {
        const char*        Name = QueryPhotometricMeasuredIes(I);
        AssetBrowserRecord Record;
        Record.Id             = std::string("photo-ies-m/") + Name;
        Record.Name           = Name;
        Record.Workspace      = WorkspaceNames[AssetBrowserWorkspacePhotometric];
        Record.Folder         = Record.Workspace + "/IES Measured";
        Record.Kind           = "IES Profile";
        Record.Blurb          = "Measured LM-63 goniometer profile.";
        Record.Glyph          = "StudioActivity";
        Record.Colour         = 0xE8C27AFF;
        Record.WorkspaceIndex = AssetBrowserWorkspacePhotometric;
        Record.Meta.push_back({ "Source", "Measured LM-63" });
        Record.Tags.emplace_back("ies");
        Record.Tags.emplace_back("measured");
        PushRecord(Records, std::move(Record));
    }
    for (int I = 0; I < QueryPhotometricPresetIesCount(); ++I)
    {
        const char*        Name = QueryPhotometricPresetIes(I);
        AssetBrowserRecord Record;
        Record.Id             = std::string("photo-ies-p/") + Name;
        Record.Name           = Name;
        Record.Workspace      = WorkspaceNames[AssetBrowserWorkspacePhotometric];
        Record.Folder         = Record.Workspace + "/IES Presets";
        Record.Kind           = "IES Profile";
        Record.Blurb          = "Analytical Project Zero preset curve.";
        Record.Glyph          = "StudioActivity";
        Record.Colour         = 0x9ECFFFFF;
        Record.WorkspaceIndex = AssetBrowserWorkspacePhotometric;
        Record.Meta.push_back({ "Source", "Analytical preset" });
        Record.Tags.emplace_back("ies");
        Record.Tags.emplace_back("preset");
        PushRecord(Records, std::move(Record));
    }
    // 📝 Rig display strings are pinned from the HTML prototype; behaviour stays with ApplyPhotometricScenario.
    static constexpr const char* RigIds[4]     = { "roadway", "gallery", "studio", "lunar" };
    static constexpr const char* RigNames[4]   = { "Roadway Rig", "Gallery Rig", "Studio Rig", "Lunar Field" };
    static constexpr const char* RigBlurbs[4]  = { "ECE low beam + key spot · night roadway homologation.",
                                                   "Architectural downlight · 0.72x IBL.",
                                                   "Softbox + tube + COB · noon sun parked.",
                                                   "Moonlight-only · Ember moon 2.6x." };
    static constexpr const char* RigCensus[4]  = { "5.19 klm", "6.03 klm", "9.69 klm", "1.40 klm" };
    for (int I = 0; I < 4; ++I)
    {
        AssetBrowserRecord Record;
        Record.Id             = std::string("photo-rig/") + RigIds[I];
        Record.Name           = RigNames[I];
        Record.Workspace      = WorkspaceNames[AssetBrowserWorkspacePhotometric];
        Record.Folder         = Record.Workspace + "/Rigs";
        Record.Kind           = "Rig";
        Record.Blurb          = RigBlurbs[I];
        Record.Glyph          = "StudioGrid";
        Record.Colour         = 0xEFF4CFFF;
        Record.WorkspaceIndex = AssetBrowserWorkspacePhotometric;
        Record.Meta.push_back({ "Census", RigCensus[I] });
        Record.Tags.emplace_back("rig");
        PushRecord(Records, std::move(Record));
    }
}

void BuildUvRecords(std::vector<AssetBrowserRecord>& Records)
{
    for (int I = 0; I < QueryUvAssetCount(); ++I)
    {
        const UvAssetSpec& Asset = QueryUvAsset(I);
        std::string        Tiles;
        for (int T = 0; T < QueryUvTileCount(I); ++T)
        {
            if (T != 0) Tiles += " · ";
            Tiles += std::to_string(QueryUvTile(I, T).Id);
        }
        char Islands[16]{};
        std::snprintf(Islands, sizeof(Islands), "%d", QueryUvIslandCount(I));
        char Stretch[16]{};
        std::snprintf(Stretch, sizeof(Stretch), "%.1f%%", Asset.MeanStretchPct);
        AssetBrowserRecord Record;
        Record.Id             = std::string("uv/") + Asset.Id;
        Record.Name           = Asset.Label;
        Record.Workspace      = WorkspaceNames[AssetBrowserWorkspaceUv];
        Record.Folder         = Record.Workspace + "/Assets";
        Record.Kind           = "Asset";
        Record.Blurb          = Asset.Subtitle;
        Record.Glyph          = "StudioMap";
        Record.Colour         = 0xE8C27AFF;
        Record.WorkspaceIndex = AssetBrowserWorkspaceUv;
        Record.Meta.push_back({ "Islands", Islands });
        Record.Meta.push_back({ "UDIMs", Tiles });
        Record.Meta.push_back({ "Stretch", Stretch });
        Record.Tags.emplace_back("uv");
        Record.Tags.emplace_back("asset");
        PushRecord(Records, std::move(Record));
    }
}

struct PinnedCatalogue
{
    std::vector<AssetBrowserRecord> Records;
    std::vector<std::string>        Kinds;

    PinnedCatalogue()
    {
        BuildParticleRecords(Records);
        BuildFluidRecords(Records);
        BuildFractureRecords(Records);
        BuildForceFieldRecords(Records);
        BuildPhotometricRecords(Records);
        BuildUvRecords(Records);
        for (const AssetBrowserRecord& Record : Records)
            if (std::find(Kinds.begin(), Kinds.end(), Record.Kind) == Kinds.end()) Kinds.push_back(Record.Kind);
        std::sort(Kinds.begin(), Kinds.end());
    }
};

const PinnedCatalogue& Pinned()
{
    static const PinnedCatalogue Catalogue;
    return Catalogue;
}

bool FolderSelected(const char* Folder, const std::string& Selected)
{
    if (Selected == "all") return true;
    if (Selected == "fav" || Selected == "recent") return false;
    const size_t Length = Selected.size();
    if (std::strncmp(Folder, Selected.c_str(), Length) != 0) return false;
    return Folder[Length] == '\0' || Folder[Length] == '/';
}

std::string Lowered(std::string Text)
{
    for (char& C : Text) C = static_cast<char>(std::tolower(static_cast<unsigned char>(C)));
    return Text;
}

bool QueryMatches(const AssetBrowserRecord& Record, const char* Query)
{
    std::string Hay = Record.Name + " " + Record.Blurb + " " + Record.Workspace + " " + Record.Folder + " " +
                      Record.Kind + " " + Record.Id;
    for (const std::string& Tag : Record.Tags) Hay += " " + Tag;
    for (const AssetBrowserMeta& Meta : Record.Meta) Hay += " " + Meta.Key + " " + Meta.Value;
    Hay = Lowered(Hay);
    const std::string Needle = Lowered(Query);
    size_t            At     = 0;
    while (At < Needle.size())
    {
        while (At < Needle.size() && std::isspace(static_cast<unsigned char>(Needle[At])) != 0) ++At;
        if (At >= Needle.size()) break;
        size_t End = At;
        while (End < Needle.size() && std::isspace(static_cast<unsigned char>(Needle[End])) == 0) ++End;
        if (Hay.find(Needle.substr(At, End - At)) == std::string::npos) return false;
        At = End;
    }
    return true;
}

} // namespace

int QueryAssetBrowserRecordCount() noexcept
{
    return static_cast<int>(Pinned().Records.size());
}

const AssetBrowserRecord& QueryAssetBrowserRecord(int Index) noexcept
{
    const auto& Records = Pinned().Records;
    if (Index < 0 || Index >= static_cast<int>(Records.size()))
    {
        static const AssetBrowserRecord Empty;
        return Empty;
    }
    return Records[static_cast<size_t>(Index)];
}

int QueryAssetBrowserRecordById(const char* Id) noexcept
{
    if (Id == nullptr) return -1;
    const auto& Records = Pinned().Records;
    for (size_t I = 0; I < Records.size(); ++I)
        if (Records[I].Id == Id) return static_cast<int>(I);
    return -1;
}

int QueryAssetBrowserWorkspaceRecordCount(int Workspace) noexcept
{
    if (Workspace < 0 || Workspace >= AssetBrowserWorkspaceCount) return 0;
    int Count = 0;
    for (const AssetBrowserRecord& Record : Pinned().Records)
        if (Record.WorkspaceIndex == Workspace) ++Count;
    return Count;
}

const char* QueryAssetBrowserWorkspaceName(int Workspace) noexcept
{
    if (Workspace < 0 || Workspace >= AssetBrowserWorkspaceCount) return "";
    return WorkspaceNames[Workspace];
}

int QueryAssetBrowserKindCount() noexcept
{
    return static_cast<int>(Pinned().Kinds.size());
}

const char* QueryAssetBrowserKindName(int Kind) noexcept
{
    const auto& Kinds = Pinned().Kinds;
    if (Kind < 0 || Kind >= static_cast<int>(Kinds.size())) return "";
    return Kinds[static_cast<size_t>(Kind)].c_str();
}

void ConstructAssetBrowserWorkspaceState(AssetBrowserWorkspaceState& State)
{
    State = AssetBrowserWorkspaceState{};
    AppendAssetBrowserWorkspaceLog(State, "BROWSER", "Asset Browser ready — 150 records across 6 libraries");
}

void AppendAssetBrowserWorkspaceLog(AssetBrowserWorkspaceState& State, const char* Channel, const char* Message,
                                    const char* Detail)
{
    AssetBrowserLogEntry Entry;
    Entry.Channel = Channel != nullptr ? Channel : "";
    Entry.Message = Message != nullptr ? Message : "";
    Entry.Detail  = Detail != nullptr ? Detail : "";
    char When[16]{};
    std::snprintf(When, sizeof(When), "%02d:%02d:%02d", 0, 0, static_cast<int>(State.Log.size()) % 60);
    Entry.When = When;
    State.Log.push_front(std::move(Entry));
    while (State.Log.size() > 80) State.Log.pop_back();
}

void SelectAssetBrowserRecord(AssetBrowserWorkspaceState& State, int Index) noexcept
{
    if (Index < -1 || Index >= QueryAssetBrowserRecordCount()) return;
    State.Selected = Index;
    if (Index < 0) return;
    State.Recents.erase(std::remove(State.Recents.begin(), State.Recents.end(), Index), State.Recents.end());
    State.Recents.insert(State.Recents.begin(), Index);
    while (State.Recents.size() > 12) State.Recents.pop_back();
}

void ToggleAssetBrowserFavorite(AssetBrowserWorkspaceState& State, int Index) noexcept
{
    if (Index < 0 || Index >= QueryAssetBrowserRecordCount()) return;
    const auto At = std::find(State.Favorites.begin(), State.Favorites.end(), Index);
    if (At == State.Favorites.end()) State.Favorites.push_back(Index);
    else State.Favorites.erase(At);
}

void ApplyAssetBrowserLink(AssetBrowserWorkspaceState& State, AssetBrowserLink* Link) noexcept
{
    if (Link == nullptr || !Link->OpenRequested) return;
    Link->OpenRequested = false;
    State.SheetOpen     = true;
    if (Link->OpenWorkspace >= 0 && Link->OpenWorkspace < AssetBrowserWorkspaceCount)
    {
        State.Folder = QueryAssetBrowserWorkspaceName(Link->OpenWorkspace);
        char Detail[64]{};
        std::snprintf(Detail, sizeof(Detail), "Filtered to %s", State.Folder.c_str());
        AppendAssetBrowserWorkspaceLog(State, "LINK", "Workspace requested the browser", Detail);
    }
    else
    {
        Link->OpenWorkspace = -1;
        AppendAssetBrowserWorkspaceLog(State, "LINK", "Workspace requested the browser");
    }
}

void QueryAssetBrowserFiltered(const AssetBrowserWorkspaceState& State, std::vector<int>& Out)
{
    const auto& Records = Pinned().Records;
    const bool  Fav     = State.Folder == "fav";
    const bool  Recent  = State.Folder == "recent";
    const char* Kind    = State.Kind >= 0 ? QueryAssetBrowserKindName(State.Kind) : nullptr;
    Out.clear();
    for (size_t I = 0; I < Records.size(); ++I)
    {
        const AssetBrowserRecord& Record = Records[I];
        const int                 Index  = static_cast<int>(I);
        if (Fav && std::find(State.Favorites.begin(), State.Favorites.end(), Index) == State.Favorites.end()) continue;
        if (Recent && std::find(State.Recents.begin(), State.Recents.end(), Index) == State.Recents.end()) continue;
        if (!Fav && !Recent && !FolderSelected(Record.Folder.c_str(), State.Folder)) continue;
        if (Kind != nullptr && Record.Kind != Kind) continue;
        if (State.SearchText[0] != '\0' && !QueryMatches(Record, State.SearchText)) continue;
        Out.push_back(Index);
    }
    const auto ByName = [&](int A, int B) { return Records[static_cast<size_t>(A)].Name < Records[static_cast<size_t>(B)].Name; };
    if (State.Sort == AssetBrowserWorkspaceState::SortWorkspace)
        std::sort(Out.begin(), Out.end(),
                  [&](int A, int B)
                  {
                      const AssetBrowserRecord& RA = Records[static_cast<size_t>(A)];
                      const AssetBrowserRecord& RB = Records[static_cast<size_t>(B)];
                      if (RA.Workspace != RB.Workspace) return RA.Workspace < RB.Workspace;
                      return RA.Name < RB.Name;
                  });
    else if (State.Sort == AssetBrowserWorkspaceState::SortKind)
        std::sort(Out.begin(), Out.end(),
                  [&](int A, int B)
                  {
                      const AssetBrowserRecord& RA = Records[static_cast<size_t>(A)];
                      const AssetBrowserRecord& RB = Records[static_cast<size_t>(B)];
                      if (RA.Kind != RB.Kind) return RA.Kind < RB.Kind;
                      return RA.Name < RB.Name;
                  });
    else std::sort(Out.begin(), Out.end(), ByName);
    if (Recent)
    {
        std::sort(Out.begin(), Out.end(),
                  [&](int A, int B)
                  {
                      const auto FA = std::find(State.Recents.begin(), State.Recents.end(), A);
                      const auto FB = std::find(State.Recents.begin(), State.Recents.end(), B);
                      return FA < FB;
                  });
    }
}

void RecordAssetBrowserWorkspaceRect(AssetBrowserWorkspaceState& State, const char* Name, ImVec2 Min, ImVec2 Max)
{
    State.Rects[Name] = ImVec4(Min.x, Min.y, Max.x, Max.y);
}

bool QueryAssetBrowserWorkspaceRect(const AssetBrowserWorkspaceState& State, const char* Name, ImVec2& Min,
                                    ImVec2& Max) noexcept
{
    if (Name == nullptr) return false;
    const auto At = State.Rects.find(Name);
    if (At == State.Rects.end()) return false;
    Min = ImVec2(At->second.x, At->second.y);
    Max = ImVec2(At->second.z, At->second.w);
    return true;
}

} // namespace Frontier
