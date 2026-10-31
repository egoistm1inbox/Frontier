/*==========================================================================================================================================
                                                         EVERESTWORKSPACE.CPP
==========================================================================================================================================*/
// 🧩 1:1 VehicleHMI Proving Grounds workspace hosted on PanelDockspace, ControlCentrePanel, LogStreamPanel, and InspectorCatalogue.

#include "EverestWorkspace.h"

#include "Engine/Diagnostics/LogStream.h"
#include "Engine/Interface/DropdownControls.h"
#include "Engine/Interface/EverestInterfaceKit.h"
#include "Engine/Interface/LogStreamPanelRegistration.h"
#include "Engine/Scene/SceneDirectory.h"

#include <imgui_internal.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <stdexcept>
#include <vector>

namespace Frontier
{

namespace
{

constexpr std::array<const char *, 8> CanonicalGroupOrder = {
    "Render", "Environment", "Forcefield", "Objects", "Vehicle", "Effects", "Destruction", "Level",
};

bool ContainsCaseInsensitive(const std::string &Haystack, const char *Needle)
{
    if (Needle == nullptr || Needle[0] == '\0')
    {
        return true;
    }
    const size_t NeedleLen = std::strlen(Needle);
    if (NeedleLen > Haystack.size())
    {
        return false;
    }
    for (size_t Offset = 0; Offset + NeedleLen <= Haystack.size(); ++Offset)
    {
        bool Match = true;
        for (size_t CharIndex = 0; CharIndex < NeedleLen; ++CharIndex)
        {
            const unsigned char Left  = static_cast<unsigned char>(Haystack[Offset + CharIndex]);
            const unsigned char Right = static_cast<unsigned char>(Needle[CharIndex]);
            if (std::tolower(Left) != std::tolower(Right))
            {
                Match = false;
                break;
            }
        }
        if (Match)
        {
            return true;
        }
    }
    return false;
}

EverestGlyphCategory ResolveRowGlyph(const InspectorProfileEntry &Profile, const std::string &Name) noexcept
{
    if (Profile.AuthoringCategory == InspectorAuthoringCategory::ProjectCustom && Profile.GroupCaption == "Vehicle")
    {
        return EverestGlyphCategory::Car;
    }
    if (Profile.StudioDomain == DedicatedStudioDomain::FractureStudio)
    {
        return EverestGlyphCategory::Gem;
    }
    if (Profile.StudioDomain == DedicatedStudioDomain::ParticleStudio)
    {
        return EverestGlyphCategory::Sparkles;
    }
    switch (Profile.EngineDomain)
    {
        case EngineInspectorDomain::Diagnostics:             return EverestGlyphCategory::Activity;
        case EngineInspectorDomain::GeometryClusters:        return EverestGlyphCategory::Boxes;
        case EngineInspectorDomain::RenderSettings:          return EverestGlyphCategory::Zap;
        case EngineInspectorDomain::AccelerationAndDistance: return EverestGlyphCategory::GridLattice;
        case EngineInspectorDomain::SurfaceCache:            return EverestGlyphCategory::LayoutGrid;
        case EngineInspectorDomain::Sun:                     return EverestGlyphCategory::Sun;
        case EngineInspectorDomain::Clouds:
        case EngineInspectorDomain::LocalCloud:
        case EngineInspectorDomain::HeightFog:
        case EngineInspectorDomain::AtmosphericFog:
        case EngineInspectorDomain::LocalVolumetricFog:      return EverestGlyphCategory::CloudFog;
        case EngineInspectorDomain::Wind:                    return EverestGlyphCategory::Wind;
        case EngineInspectorDomain::Atmosphere:              return EverestGlyphCategory::Sunrise;
        default:                                             break;
    }
    if (Name.find("Cone") != std::string::npos)
    {
        return EverestGlyphCategory::Cone;
    }
    return EverestGlyphCategory::Layers;
}

const char *ResolveStudioButtonTitle(DedicatedStudioDomain Studio) noexcept
{
    switch (Studio)
    {
        case DedicatedStudioDomain::ParticleStudio:   return "Particle Studio";
        case DedicatedStudioDomain::FractureStudio:   return "Fracture Studio";
        case DedicatedStudioDomain::FluidPlumeStudio: return "Fluid Studio";
        case DedicatedStudioDomain::ClusterStudio:    return "Cluster Studio";
        default:                                      return nullptr;
    }
}

void PaintVerticalGradientRect(ImDrawList *Canvas, ImVec2 Minimum, ImVec2 Maximum, ImU32 TopInk, ImU32 BottomInk,
                               float Radius = 0.0f)
{
    const int StartVert = Canvas->VtxBuffer.Size;
    Canvas->AddRectFilled(Minimum, Maximum, IM_COL32_WHITE, Radius);
    const int EndVert = Canvas->VtxBuffer.Size;
    if (EndVert > StartVert)
    {
        ImGui::ShadeVertsLinearColorGradientKeepAlpha(Canvas, StartVert, EndVert, Minimum,
                                                      ImVec2(Minimum.x, Maximum.y), TopInk, BottomInk);
    }
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                               CONSTRUCTION & LIFECYCLE
//------------------------------------------------------------------------------------------------------------------------

EverestWorkspace::EverestWorkspace(ControlCentrePanel &ControlCentreHost)
    : Centre(ControlCentreHost)
{
    Centre.ConfigureContentBrowserVisibility(false);
    SelectedRecordToken = Scene.QueryRenderSettingsToken();

    Panels.ConfigureDockspaceKey("Project Everest Workspace");
    // Top 32 px leaves crisp room for ControlCentrePanel's top-centre notch; bottom 28 px hosts #status.
    Panels.ConfigureWorkspaceInsets(32.0f, 28.0f);
    Panels.ConfigureTabExtent(126.0f, 24.0f);

    if (!Panels.Register({"outliner", "Outliner", [this]() { ConstructOutlinerPanel(); }, true}) ||
        !Panels.Register({"scene", "Scene", [this]() { ConstructSceneViewportPanel(); }, true}) ||
        !Panels.Register(MakeLogStreamPanelSpecification(StreamPanel)) ||
        !Panels.Register({"inspector", "Inspector", [this]() { ConstructInspectorPanel(); }, true}))
    {
        throw std::runtime_error("Project Everest panel registration failed.");
    }

    // PanelDockspace requires ConfigureStackedPanels BEFORE ConfigureColumns, fractional weights in (0, 1],
    // and StackedLowerKey ("LogStream") as the middle column representative.
    if (!Panels.ConfigureStackedPanels("scene", "LogStream", 640.0f) ||
        !Panels.ConfigureColumns({{"outliner", 0.160f}, {"LogStream", 0.632f}, {"inspector", 0.208f}}))
    {
        throw std::runtime_error("Project Everest 3-column dockspace configuration failed.");
    }
    ImGui::GetIO().IniFilename = nullptr;

    SeedInitialLogTraffic();
}

EverestWorkspace::~EverestWorkspace()
{
    Centre.ConfigureDockedPanels(false, false);
    Centre.ConfigureContentBrowserVisibility(true);
}

bool EverestWorkspace::ConfigurePlatform() noexcept
{
    Panels.ConfigureDetachedWindows(Centre.QueryDetachedWindows());
    return Panels.ConfigurePlatform();
}

void EverestWorkspace::SelectRecord(RecordToken Token) noexcept
{
    if (Token.IsValid())
    {
        SelectedRecordToken = Token;
    }
}

void EverestWorkspace::OpenDedicatedStudio(DedicatedStudioDomain Studio)
{
    ActiveStudioWorkbench = Studio;
    switch (Studio)
    {
        case DedicatedStudioDomain::ParticleStudio:
            SelectedRecordToken = Scene.QueryParticlesToken();
            break;
        case DedicatedStudioDomain::FractureStudio:
            SelectedRecordToken = Scene.QueryFractureToken();
            break;
        case DedicatedStudioDomain::FluidPlumeStudio:
            SelectedRecordToken = Scene.QueryVehicleToken();
            Scene.Vehicle.ActiveDivisionTab = 3;
            Scene.Vehicle.ActiveTyreSubTab  = 2;
            break;
        case DedicatedStudioDomain::ClusterStudio:
            SelectedRecordToken   = Scene.QueryRenderSettingsToken();
            ActiveStudioWorkbench = DedicatedStudioDomain::None;
            break;
        default:
            ActiveStudioWorkbench = DedicatedStudioDomain::None;
            break;
    }
}

void EverestWorkspace::SeedInitialLogTraffic()
{
    IlluminationLogToken = RegisterLogCategory("Illumination", LogColour::Mint).Token;
    DrivetrainLogToken   = RegisterLogCategory("Drivetrain", LogColour::Amber).Token;
    TyreLogToken         = RegisterLogCategory("TyreContact", LogColour::Blue).Token;
    AtmosphereLogToken   = RegisterLogCategory("Atmosphere", LogColour::Purple).Token;
    DestructionLogToken  = RegisterLogCategory("Destruction", LogColour::Pink).Token;

    WriteLog(IlluminationLogToken, LogSeverity::Info, LogVerbosity::Display,
             "Project Everest Proving Grounds mounted \xC2\xB7 30 RecordEntry items registered in SceneDirectory",
             "EverestSceneAssembly.cpp");
    WriteLog(IlluminationLogToken, LogSeverity::Info, LogVerbosity::Display,
             "FacetCdfPreparation cache published (466 emissive facets, 0.000000 RMSE delta, 0.0001 target floor)",
             "FacetCdfPreparation.slang");
    WriteLog(AtmosphereLogToken, LogSeverity::Info, LogVerbosity::Log,
             "Hillaire multi-scattering sky LUT + 16x16x4 clustered light bitmasks synchronized (44 lights)",
             "EngineReusableInspectors.cpp");
    WriteLog(DrivetrainLogToken, LogSeverity::Info, LogVerbosity::Log,
             "ControlVehicle 6-speed powertrain + Jolt 64-pt convex hull active (84 km/h, 5,420 rpm, 1.18 bar)",
             "EverestSceneAssembly.cpp");
    WriteLog(TyreLogToken, LogSeverity::Warning, LogVerbosity::Display,
             "Rear-right 3D Hex8 Neo-Hookean FEM tread at 124.0 C \xC2\xB7 toroidal smoke lattice resident",
             "EverestSceneAssembly.cpp");
    WriteLog(DestructionLogToken, LogSeverity::Info, LogVerbosity::Log,
             "Fracture convex recipes validated: 16/18 props intact, 34 fragments in dynamic SDF pool",
             "EverestSceneAssembly.cpp");

    StreamPanel.Synchronize(LogStore(), LogCategories(), 0.25);
    StreamPanel.Synchronize(LogStore(), LogCategories(), 0.80);
}

void EverestWorkspace::SynchronizeSimulation(double DeltaSeconds)
{
    ElapsedSeconds += DeltaSeconds;
    ++SimulatedTickIndex;
    StreamPanel.Synchronize(LogStore(), LogCategories(), DeltaSeconds);

    if (Scene.PendingStudioRequest != DedicatedStudioDomain::None)
    {
        OpenDedicatedStudio(Scene.PendingStudioRequest);
        Scene.PendingStudioRequest = DedicatedStudioDomain::None;
    }
}

void EverestWorkspace::ConstructInterface()
{
    SynchronizeSimulation(std::max(1.0 / 144.0, static_cast<double>(ImGui::GetIO().DeltaTime)));
    const float Scale = Centre.QueryAppearance().QueryApplied().InterfaceScale / 100.0f;
    Panels.ConstructInterface(Scale);
    ConstructBottomStatusStrip(Scale);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 1:1 OUTLINER PANEL
//------------------------------------------------------------------------------------------------------------------------

void EverestWorkspace::ConstructOutlinerPanel()
{
    SceneDirectory            &Directory  = SceneDirectory::Instance();
    InspectorCatalogue        &Inspectors = InspectorCatalogue::Instance();
    const KitFaces             Faces      = ResolveKitFaces();
    const EverestSurfaceTokens Tokens     = ResolveEverestTokens();
    ImDrawList                *Canvas     = ImGui::GetWindowDrawList();

    const ImVec2 WinPos     = ImGui::GetWindowPos();
    const ImVec2 WinSize    = ImGui::GetWindowSize();
    const float  ContentTop = ImGui::GetCursorScreenPos().y;
    const float  LeftX      = WinPos.x + 12.0f;
    const float  RightLim   = WinPos.x + WinSize.x - 12.0f;
    const float  InnerW     = std::max(100.0f, RightLim - LeftX);

    Canvas->AddRectFilled(ImVec2(WinPos.x, ContentTop), ImVec2(WinPos.x + WinSize.x, WinPos.y + WinSize.y),
                          Tokens.Column);
    Canvas->AddLine(ImVec2(WinPos.x + WinSize.x - 1.0f, ContentTop),
                    ImVec2(WinPos.x + WinSize.x - 1.0f, WinPos.y + WinSize.y), Tokens.Edge);

    // .brand-row ("frontier." + "ENGINE / 01" + "< Browser")
    float CursorY = ContentTop + 10.0f;
    KitDrawText(Canvas, Faces.Medium, 17.5f, ImVec2(LeftX, CursorY), Tokens.TextPrimary, "frontier.");
    PaintTrackedLabel(Canvas, Faces.Medium, 9.5f, ImVec2(LeftX + 74.0f, CursorY + 5.0f), Tokens.TextFaint,
                      "ENGINE / 01", 9.5f * 0.11f);
    {
        const char  *BackCaption = "Browser";
        const float  BackW       = KitTextWidth(Faces.Medium, 11.0f, BackCaption) + 26.0f;
        const ImVec2 BackMin(RightLim - BackW, CursorY - 1.0f);
        bool         Hovered = false;
        if (KitTarget("##EverestReturnBrowser", BackMin, ImVec2(BackW, 22.0f), Hovered,
                      "Return to Frontier Project Browser") &&
            EvaluateReturnToBrowser)
        {
            EvaluateReturnToBrowser();
        }
        KitPillSurface(Canvas, BackMin, ImVec2(BackMin.x + BackW, BackMin.y + 22.0f),
                       Hovered ? Tokens.RowSelectedTop : Tokens.Inset, Tokens.Edge, 999.0f);
        PaintChevronGlyph(Canvas, ImVec2(BackMin.x + 10.0f, BackMin.y + 11.0f), 3.0f, 2, Tokens.TextSoft);
        KitDrawText(Canvas, Faces.Medium, 11.0f, ImVec2(BackMin.x + 16.5f, BackMin.y + 5.5f), Tokens.TextSoft,
                    BackCaption);
    }
    CursorY += 28.0f;

    // WORKSPACE card + Proving Grounds.scene
    {
        const ImVec2 CardMin(LeftX, CursorY);
        const ImVec2 CardMax(RightLim, CursorY + 46.0f);
        Canvas->AddRectFilled(CardMin, CardMax, Tokens.Inset, 11.0f);
        Canvas->AddRect(CardMin, CardMax, Tokens.Edge, 11.0f);
        Canvas->AddCircleFilled(ImVec2(CardMin.x + 12.0f, CardMin.y + 13.0f), 3.2f, Tokens.LiveGreen);
        PaintTrackedLabel(Canvas, Faces.Medium, 9.5f, ImVec2(CardMin.x + 20.0f, CardMin.y + 8.5f), Tokens.TextMuted,
                          "WORKSPACE \xC2\xB7 PROJECT EVEREST", 9.5f * 0.09f);
        KitDrawText(Canvas, Faces.Medium, 13.0f, ImVec2(CardMin.x + 12.0f, CardMin.y + 24.0f), Tokens.TextPrimary,
                    "Proving Grounds.scene");
        CursorY += 54.0f;
    }

    // Count Enabled / Disabled across registered tokens
    uint32_t EnabledCount  = 0u;
    uint32_t DisabledCount = 0u;
    for (const RecordToken Token : Scene.QueryOrderedTokens())
    {
        if (!Directory.QueryRegistered(Token))
        {
            continue;
        }
        if (Directory.QueryVisible(Token))
        {
            ++EnabledCount;
        }
        else
        {
            ++DisabledCount;
        }
    }

    // 2-col .count-tiles (Enabled / Disabled)
    {
        const float TileGap = 6.0f;
        const float TileW   = (InnerW - TileGap) * 0.5f;
        const float TileH   = 40.0f;
        char EnabledBuf[24]  = {};
        char DisabledBuf[24] = {};
        std::snprintf(EnabledBuf, sizeof(EnabledBuf), "%u", EnabledCount);
        std::snprintf(DisabledBuf, sizeof(DisabledBuf), "%u", DisabledCount);

        const ImVec2 LeftTile(LeftX, CursorY);
        Canvas->AddRectFilled(LeftTile, ImVec2(LeftTile.x + TileW, LeftTile.y + TileH), Tokens.StatCell, 10.0f);
        Canvas->AddRect(LeftTile, ImVec2(LeftTile.x + TileW, LeftTile.y + TileH), Tokens.EdgeSubtle, 10.0f);
        KitDrawTracked(Canvas, Faces.Medium, 9.5f, ImVec2(LeftTile.x + 10.0f, LeftTile.y + 6.5f), Tokens.TextMuted,
                       "ENABLED", 9.5f * 0.08f);
        KitDrawText(Canvas, Faces.Medium, 14.5f, ImVec2(LeftTile.x + 10.0f, LeftTile.y + 20.0f), Tokens.LiveGreen,
                    EnabledBuf);

        const ImVec2 RightTile(LeftX + TileW + TileGap, CursorY);
        Canvas->AddRectFilled(RightTile, ImVec2(RightTile.x + TileW, RightTile.y + TileH), Tokens.StatCell, 10.0f);
        Canvas->AddRect(RightTile, ImVec2(RightTile.x + TileW, RightTile.y + TileH), Tokens.EdgeSubtle, 10.0f);
        KitDrawTracked(Canvas, Faces.Medium, 9.5f, ImVec2(RightTile.x + 10.0f, RightTile.y + 6.5f), Tokens.TextMuted,
                       "DISABLED", 9.5f * 0.08f);
        KitDrawText(Canvas, Faces.Medium, 14.5f, ImVec2(RightTile.x + 10.0f, RightTile.y + 20.0f),
                    DisabledCount > 0 ? Tokens.WarmAmber : Tokens.TextSoft, DisabledBuf);
        CursorY += TileH + 10.0f;
    }

    // Outliner [NN] heading
    {
        KitDrawText(Canvas, Faces.Medium, 13.5f, ImVec2(LeftX, CursorY), Tokens.TextPrimary, "Outliner");
        char TotalBadge[24] = {};
        std::snprintf(TotalBadge, sizeof(TotalBadge), "%u", EnabledCount + DisabledCount);
        const float BadgeW = KitTextWidth(Faces.Medium, 11.0f, TotalBadge) + 14.0f;
        KitPillSurface(Canvas, ImVec2(RightLim - BadgeW, CursorY - 1.0f),
                       ImVec2(RightLim, CursorY + 18.0f), Tokens.Inset, Tokens.Edge, 999.0f);
        KitDrawText(Canvas, Faces.Medium, 11.0f, ImVec2(RightLim - BadgeW + 7.0f, CursorY + 2.5f), Tokens.TextSoft,
                    TotalBadge);
        CursorY += 23.0f;
    }

    // Search input ("Find an object...")
    {
        const ImVec2 SearchMin(LeftX, CursorY);
        const ImVec2 SearchMax(RightLim, CursorY + 30.0f);
        Canvas->AddRectFilled(SearchMin, SearchMax, Tokens.Inset, 9.0f);
        Canvas->AddRect(SearchMin, SearchMax, Tokens.Edge, 9.0f);
        ImGui::SetCursorScreenPos(ImVec2(SearchMin.x + 10.0f, SearchMin.y + 7.0f));
        ImGui::PushFont(Faces.Regular, 12.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(0.0f, 0.0f));
        ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0, 0, 0, 0));
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.86f, 0.86f, 0.86f, 1.0f));
        ImGui::SetNextItemWidth(InnerW - 20.0f);
        ImGui::InputTextWithHint("##EverestOutlinerSearch", "Find an object...", OutlinerSearchBuffer.data(),
                                 OutlinerSearchBuffer.size());
        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar();
        ImGui::PopFont();
        CursorY += 36.0f;
    }

    // Scrollable tree region above 34 px .outliner-bottom
    const float FooterHeight = 34.0f;
    const float TreeHeight   = std::max(80.0f, (WinPos.y + WinSize.y - FooterHeight) - CursorY);
    ImGui::SetCursorScreenPos(ImVec2(WinPos.x, CursorY));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
    if (ImGui::BeginChild("##EverestOutlinerScroll", ImVec2(WinSize.x - 1.0f, TreeHeight), false))
    {
        ImDrawList *TreeCanvas = ImGui::GetWindowDrawList();
        const ImVec2 ScrollOrigin = ImGui::GetCursorScreenPos();
        float RowY = ScrollOrigin.y + 2.0f;

        for (const char *GroupName : CanonicalGroupOrder)
        {
            std::vector<RecordToken> GroupMembers;
            for (const RecordToken Token : Scene.QueryOrderedTokens())
            {
                if (!Directory.QueryRegistered(Token))
                {
                    continue;
                }
                const InspectorProfileEntry *Profile = Inspectors.QueryProfile(Token);
                if (Profile == nullptr || Profile->GroupCaption != GroupName)
                {
                    continue;
                }
                const std::string Name = Directory.QueryName(Token);
                if (!ContainsCaseInsensitive(Name, OutlinerSearchBuffer.data()))
                {
                    continue;
                }
                GroupMembers.push_back(Token);
            }
            if (GroupMembers.empty())
            {
                continue;
            }

            // Collapsible group header
            const bool Collapsed = (CollapsedOutlinerGroups.count(GroupName) > 0);
            bool GroupHovered    = false;
            ImGui::PushID(GroupName);
            if (KitTarget("##GroupFold", ImVec2(LeftX, RowY), ImVec2(InnerW, 24.0f), GroupHovered))
            {
                if (Collapsed)
                {
                    CollapsedOutlinerGroups.erase(GroupName);
                }
                else
                {
                    CollapsedOutlinerGroups.insert(GroupName);
                }
            }
            ImGui::PopID();

            PaintChevronGlyph(TreeCanvas, ImVec2(LeftX + 5.5f, RowY + 11.5f), 2.8f, Collapsed ? 1 : 0,
                              Tokens.TextMuted);
            std::string UpperGroup = GroupName;
            for (char &Character : UpperGroup)
            {
                Character = static_cast<char>(std::toupper(static_cast<unsigned char>(Character)));
            }
            PaintTrackedLabel(TreeCanvas, Faces.Medium, 10.0f, ImVec2(LeftX + 14.0f, RowY + 6.5f),
                              GroupHovered ? Tokens.TextPrimary : Tokens.TextMuted, UpperGroup.c_str(),
                              10.0f * 0.11f);
            char GroupCount[16] = {};
            std::snprintf(GroupCount, sizeof(GroupCount), "%zu", GroupMembers.size());
            const float CountW = KitTextWidth(Faces.Regular, 10.5f, GroupCount);
            KitDrawText(TreeCanvas, Faces.Regular, 10.5f, ImVec2(RightLim - CountW - 2.0f, RowY + 6.0f),
                        Tokens.TextFaint, GroupCount);
            RowY += 25.0f;

            if (Collapsed)
            {
                continue;
            }

            // 38 px .tree-row entries (1:1 FrontierEditor.css parity)
            for (const RecordToken MemberToken : GroupMembers)
            {
                const InspectorProfileEntry *Profile = Inspectors.QueryProfile(MemberToken);
                if (Profile == nullptr)
                {
                    continue;
                }
                const std::string Name      = Directory.QueryName(MemberToken);
                const bool        Visible   = Directory.QueryVisible(MemberToken);
                const bool        Selected  = (MemberToken == SelectedRecordToken);
                const bool        HasParent = Directory.QueryParent(MemberToken).IsValid();
                const float       Indent    = HasParent ? 22.0f : 0.0f;
                const float       RowH      = 36.0f;
                const ImVec2      RowMin(LeftX + Indent, RowY);
                const ImVec2      RowMax(RightLim, RowY + RowH);
                const float       RowW      = RowMax.x - RowMin.x;

                ImGui::PushID(static_cast<int>(MemberToken.Value));
                bool EyeHovered = false;
                const ImVec2 EyeMin(RowMax.x - 26.0f, RowMin.y + 6.0f);
                const bool EyeClicked = KitTarget("##EyeToggle", EyeMin, ImVec2(24.0f, 24.0f), EyeHovered,
                                                  "Toggle visibility");
                bool RowHovered = false;
                const bool RowClicked = KitTarget("##RowSelect", RowMin, ImVec2(std::max(24.0f, RowW - 28.0f), RowH),
                                                  RowHovered);
                ImGui::PopID();

                if (EyeClicked)
                {
                    Directory.ConfigureVisible(MemberToken, !Visible);
                }
                if (RowClicked)
                {
                    SelectedRecordToken = MemberToken;
                }

                if (Selected)
                {
                    PaintVerticalGradientRect(TreeCanvas, RowMin, RowMax, Tokens.RowSelectedTop, Tokens.RowSelectedBot,
                                              9.0f);
                    TreeCanvas->AddRect(RowMin, RowMax, KitInkHex(0x3f3f3f), 9.0f);
                }
                else if (RowHovered)
                {
                    TreeCanvas->AddRectFilled(RowMin, RowMax, Tokens.RowHover, 9.0f);
                }

                const ImU32 AccentInk = ConvertRgbToInk(Profile->AccentColourRgb, Visible ? 255 : 110);
                TreeCanvas->AddRectFilled(ImVec2(RowMin.x + 5.0f, RowMin.y + 10.0f),
                                          ImVec2(RowMin.x + 7.0f, RowMin.y + 26.0f), AccentInk, 1.0f);
                PaintEverestGlyph(TreeCanvas, ResolveRowGlyph(*Profile, Name),
                                  ImVec2(RowMin.x + 18.0f, RowMin.y + RowH * 0.5f), 13.0f,
                                  Visible ? AccentInk : Tokens.TextFaint);

                KitDrawText(TreeCanvas, Selected ? Faces.Medium : Faces.Regular, 12.5f,
                            ImVec2(RowMin.x + 30.0f, RowMin.y + 11.0f),
                            Visible ? Tokens.TextPrimary : Tokens.TextFaint, Name.c_str());

                // State dot + meta caption + eye icon
                PaintEverestGlyph(TreeCanvas, Visible ? EverestGlyphCategory::Eye : EverestGlyphCategory::EyeOff,
                                  ImVec2(RowMax.x - 14.0f, RowMin.y + RowH * 0.5f), 12.0f,
                                  EyeHovered ? Tokens.TextPrimary : (Visible ? Tokens.TextMuted : Tokens.TextFaint));
                TreeCanvas->AddCircleFilled(ImVec2(RowMax.x - 32.0f, RowMin.y + RowH * 0.5f), 2.6f,
                                            Visible ? Tokens.LiveGreen : Tokens.TextFaint);

                if (!Profile->MetaCaption.empty() && RowW > 175.0f)
                {
                    const float MetaW = KitTextWidth(Faces.Regular, 10.5f, Profile->MetaCaption.c_str());
                    KitDrawText(TreeCanvas, Faces.Regular, 10.5f,
                                ImVec2(RowMax.x - 40.0f - MetaW, RowMin.y + 12.5f), Tokens.TextFaint,
                                Profile->MetaCaption.c_str());
                }

                RowY += RowH + 2.0f;
            }
            RowY += 4.0f;
        }

        ImGui::SetCursorScreenPos(ImVec2(LeftX, RowY));
        ImGui::Dummy(ImVec2(1.0f, 8.0f));
    }
    ImGui::EndChild();
    ImGui::PopStyleColor();

    // .outliner-bottom
    const char *ArchShort = (Scene.Render.ArchitectureTierIndex == 0) ? "RTX RayQuery" : "GTX SDF+BVH";
    ConstructInspectorFooter(Canvas, Faces, Tokens, ImVec2(WinPos.x, WinPos.y + WinSize.y - FooterHeight), WinSize.x,
                             "IlluminationHost", ArchShort);
}

//------------------------------------------------------------------------------------------------------------------------
//                                             1:1 SCENE VIEWPORT PANEL
//------------------------------------------------------------------------------------------------------------------------

void EverestWorkspace::PaintSynthesizedProvingGroundsViewport(ImDrawList *Canvas, ImVec2 CanvasMin, ImVec2 CanvasMax)
{
    const KitFaces             Faces    = ResolveKitFaces();
    const EverestSurfaceTokens Tokens   = ResolveEverestTokens();
    const float                Width    = CanvasMax.x - CanvasMin.x;
    const float                Height   = CanvasMax.y - CanvasMin.y;
    const float                HorizonY = CanvasMin.y + Height * 0.46f;
    const bool                 RtxMode  = (Scene.Render.ArchitectureTierIndex == 0);
    const size_t               Preset   = Scene.Environment.LightingPresetIndex;

    // 1. Atmospheric sky gradient driven by LightingPreset & SunElevation
    ImU32 ZenithInk  = KitInkHex(0x16293d);
    ImU32 HorizonInk = KitInkHex(0x4c6b82);
    if (Preset == 1) // Golden hour
    {
        ZenithInk  = KitInkHex(0x212438);
        HorizonInk = KitInkHex(0x8c563c);
    }
    else if (Preset == 2) // Overcast
    {
        ZenithInk  = KitInkHex(0x2c333a);
        HorizonInk = KitInkHex(0x525a61);
    }
    else if (Preset == 3 || Scene.Environment.SunElevationDegrees < 0.0f) // Night
    {
        ZenithInk  = KitInkHex(0x090d14);
        HorizonInk = KitInkHex(0x16202e);
    }
    PaintVerticalGradientRect(Canvas, CanvasMin, ImVec2(CanvasMax.x, HorizonY), ZenithInk, HorizonInk);

    // 2. Wet/dry proving-grounds asphalt gradient
    PaintVerticalGradientRect(Canvas, ImVec2(CanvasMin.x, HorizonY), CanvasMax, KitInkHex(0x1d2124),
                              KitInkHex(0x0f1214));

    // 3. Solar disc & atmospheric glow when above horizon
    if (Scene.Environment.SunElevationDegrees > -2.0f)
    {
        const float AzimuthNorm = (Scene.Environment.SunAzimuthDegrees + 180.0f) / 360.0f;
        const float ElevNorm    = std::clamp(Scene.Environment.SunElevationDegrees / 90.0f, 0.0f, 1.0f);
        const ImVec2 SunScreen(CanvasMin.x + Width * (0.20f + 0.60f * AzimuthNorm),
                               HorizonY - Height * (0.06f + 0.32f * ElevNorm));
        Canvas->AddCircleFilled(SunScreen, 44.0f, KitInkRgba(255, 214, 140, 32), 32);
        Canvas->AddCircleFilled(SunScreen, 18.0f, KitInkRgba(255, 230, 175, 76), 24);
        Canvas->AddCircleFilled(SunScreen, 7.5f, KitInkHex(0xfff1d0), 20);

        // Specular road sun streak (sharper in RTX BVH mode, softer in GTX SDF+BVH mode)
        PaintVerticalGradientRect(Canvas, ImVec2(SunScreen.x - (RtxMode ? 16.0f : 28.0f), HorizonY),
                                  ImVec2(SunScreen.x + (RtxMode ? 16.0f : 28.0f), CanvasMax.y),
                                  KitInkRgba(255, 215, 150, RtxMode ? 64 : 38), KitInkRgba(255, 215, 150, 0));
    }

    // 4. Perspective proving-grounds grid & calibration lane markings
    const float VanishX = CanvasMin.x + Width * 0.52f;
    for (int GridLine = -7; GridLine <= 7; ++GridLine)
    {
        const float BottomX = VanishX + static_cast<float>(GridLine) * (Width * 0.11f);
        Canvas->AddLine(ImVec2(VanishX + static_cast<float>(GridLine) * 14.0f, HorizonY),
                        ImVec2(BottomX, CanvasMax.y), KitInkRgba(255, 255, 255, 18), 1.0f);
    }
    for (int DepthStep = 1; DepthStep <= 6; ++DepthStep)
    {
        const float T  = static_cast<float>(DepthStep) / 6.0f;
        const float Y  = HorizonY + (CanvasMax.y - HorizonY) * (T * T);
        Canvas->AddLine(ImVec2(CanvasMin.x, Y), ImVec2(CanvasMax.x, Y), KitInkRgba(255, 255, 255, 15), 1.0f);
    }

    // 5. Distant proving-grounds hangar & street-lamp IES emitters
    const float HangarLeft  = CanvasMin.x + Width * 0.10f;
    const float HangarRight = CanvasMin.x + Width * 0.34f;
    Canvas->AddRectFilled(ImVec2(HangarLeft, HorizonY - 38.0f), ImVec2(HangarRight, HorizonY + 2.0f),
                          KitInkHex(0x171b20), 3.0f);
    Canvas->AddLine(ImVec2(HangarLeft + 14.0f, HorizonY - 26.0f), ImVec2(HangarRight - 14.0f, HorizonY - 26.0f),
                    KitInkHex(0xffc978), 2.5f);
    for (int LampIdx = 0; LampIdx < 4; ++LampIdx)
    {
        const float LampX = CanvasMin.x + Width * (0.62f + 0.08f * static_cast<float>(LampIdx));
        Canvas->AddLine(ImVec2(LampX, HorizonY - 46.0f), ImVec2(LampX, HorizonY + 6.0f), KitInkHex(0x353c42), 2.0f);
        Canvas->AddCircleFilled(ImVec2(LampX - 4.0f, HorizonY - 46.0f), 3.2f, KitInkHex(0xffd796));
        Canvas->AddTriangleFilled(ImVec2(LampX - 4.0f, HorizonY - 44.0f),
                                  ImVec2(LampX - 28.0f, HorizonY + 12.0f),
                                  ImVec2(LampX + 20.0f, HorizonY + 12.0f), KitInkRgba(255, 205, 130, 22));
    }

    // 6. Rubber drift marks + volumetric tyre smoke plume + ControlVehicle coupe
    const float CarX = CanvasMin.x + Width * 0.48f;
    const float CarY = HorizonY + Height * 0.24f;
    if (Scene.Vehicle.LayRubberMarksEnabled)
    {
        Canvas->AddBezierQuadratic(ImVec2(CarX - 180.0f, CanvasMax.y - 8.0f), ImVec2(CarX - 90.0f, CarY + 42.0f),
                                   ImVec2(CarX - 44.0f, CarY + 20.0f), KitInkRgba(8, 8, 9, 175), 7.0f);
        Canvas->AddBezierQuadratic(ImVec2(CarX - 120.0f, CanvasMax.y - 8.0f), ImVec2(CarX - 40.0f, CarY + 44.0f),
                                   ImVec2(CarX + 38.0f, CarY + 20.0f), KitInkRgba(8, 8, 9, 175), 7.0f);
    }
    if (Scene.Vehicle.SharedSmokeDomainEnabled)
    {
        for (int Puff = 0; Puff < 6; ++Puff)
        {
            const float Offset = static_cast<float>(Puff);
            Canvas->AddCircleFilled(ImVec2(CarX - 58.0f - Offset * 22.0f, CarY + 8.0f - Offset * 7.0f),
                                    16.0f + Offset * 7.5f, KitInkRgba(196, 202, 208, 36 - Puff * 4), 24);
        }
    }

    // Glossy reflection underbody bounce (ReSTIR / Surface-card GI)
    Canvas->AddRectFilled(ImVec2(CarX - 78.0f, CarY + 20.0f), ImVec2(CarX + 82.0f, CarY + 36.0f),
                          RtxMode ? KitInkRgba(120, 175, 215, 42) : KitInkRgba(143, 179, 164, 34), 8.0f);

    // ControlVehicle body shell + glazing + tail/headlight emitters
    const ImVec2 BodyPoly[8] = {
        ImVec2(CarX - 80.0f, CarY + 16.0f), ImVec2(CarX - 76.0f, CarY - 4.0f),
        ImVec2(CarX - 38.0f, CarY - 12.0f), ImVec2(CarX - 12.0f, CarY - 30.0f),
        ImVec2(CarX + 32.0f, CarY - 28.0f), ImVec2(CarX + 66.0f, CarY - 8.0f),
        ImVec2(CarX + 82.0f, CarY + 4.0f),  ImVec2(CarX + 80.0f, CarY + 16.0f),
    };
    Canvas->AddConvexPolyFilled(BodyPoly, 8, KitInkHex(0x2d353d));
    Canvas->AddPolyline(BodyPoly, 8, KitInkHex(0x9cb4c9), ImDrawFlags_Closed, 1.6f);
    Canvas->AddCircleFilled(ImVec2(CarX - 48.0f, CarY + 18.0f), 14.0f, KitInkHex(0x141618), 20);
    Canvas->AddCircle(ImVec2(CarX - 48.0f, CarY + 18.0f), 9.0f, KitInkHex(0xc9c785), 16, 1.6f);
    Canvas->AddCircleFilled(ImVec2(CarX + 50.0f, CarY + 18.0f), 14.0f, KitInkHex(0x141618), 20);
    Canvas->AddCircle(ImVec2(CarX + 50.0f, CarY + 18.0f), 9.0f, KitInkHex(0xc9c785), 16, 1.6f);
    Canvas->AddRectFilled(ImVec2(CarX - 77.0f, CarY - 2.0f), ImVec2(CarX - 68.0f, CarY + 4.0f),
                          KitInkHex(0xff4d4d), 2.0f);
    if (Scene.Vehicle.HeadlightBeamIndex > 0)
    {
        Canvas->AddTriangleFilled(ImVec2(CarX + 82.0f, CarY + 4.0f), ImVec2(CarX + 250.0f, CarY + 42.0f),
                                  ImVec2(CarX + 250.0f, CarY - 6.0f), KitInkRgba(235, 245, 255, 36));
    }

    // Slalom cones & breakable prop markers
    for (int ConeIdx = 0; ConeIdx < 4; ++ConeIdx)
    {
        const float ConeX = CarX + 125.0f + static_cast<float>(ConeIdx) * 48.0f;
        const float ConeY = CarY + 26.0f - static_cast<float>(ConeIdx) * 7.0f;
        Canvas->AddTriangleFilled(ImVec2(ConeX, ConeY - 13.0f), ImVec2(ConeX - 6.0f, ConeY),
                                  ImVec2(ConeX + 6.0f, ConeY), KitInkHex(0xe87b35));
    }

    // Optional inspection channel badge tint if non-default mode chosen
    if (Scene.Render.InspectionModeIndex != 0)
    {
        size_t ModeCount = 0;
        const char *const *Modes = QueryEverestInspectionModes(ModeCount);
        const char *ModeTitle    = Modes[std::min(Scene.Render.InspectionModeIndex, ModeCount - 1)];
        KitPillSurface(Canvas, ImVec2(CanvasMin.x + Width * 0.5f - 95.0f, CanvasMin.y + 12.0f),
                       ImVec2(CanvasMin.x + Width * 0.5f + 95.0f, CanvasMin.y + 36.0f),
                       KitInkRgba(16, 16, 16, 215), Tokens.LiveGreen, 999.0f);
        KitDrawText(Canvas, Faces.Medium, 11.5f, ImVec2(CanvasMin.x + Width * 0.5f - 82.0f, CanvasMin.y + 18.0f),
                    Tokens.LiveGreen, ModeTitle);
    }
}

void EverestWorkspace::ConstructSceneViewportPanel()
{
    const KitFaces             Faces      = ResolveKitFaces();
    const EverestSurfaceTokens Tokens     = ResolveEverestTokens();
    ImDrawList                *Canvas     = ImGui::GetWindowDrawList();
    const ImVec2               WinPos     = ImGui::GetWindowPos();
    const ImVec2               WinSz      = ImGui::GetWindowSize();
    const float                ContentTop = ImGui::GetCursorScreenPos().y;
    const ImVec2               PanelTop(WinPos.x, ContentTop);

    // If a Dedicated Studio workbench is active in the center pane, render its 2-column studio + return pill!
    if (ActiveStudioWorkbench != DedicatedStudioDomain::None)
    {
        if (ActiveStudioWorkbench == DedicatedStudioDomain::ParticleStudio)
        {
            Scene.ConstructParticleStudioInterface();
        }
        else if (ActiveStudioWorkbench == DedicatedStudioDomain::FractureStudio)
        {
            Scene.ConstructFractureStudioInterface();
        }
        else if (ActiveStudioWorkbench == DedicatedStudioDomain::FluidPlumeStudio)
        {
            Scene.ConstructFluidPlumeStudioInterface();
        }
        const char  *ReturnCap = "3D Scene";
        const float  ReturnW   = KitTextWidth(Faces.Medium, 11.5f, ReturnCap) + 28.0f;
        const ImVec2 ReturnMin(WinPos.x + WinSz.x - ReturnW - 140.0f, ContentTop + 9.0f);
        bool Hovered = false;
        if (KitTarget("##ReturnFromStudio", ReturnMin, ImVec2(ReturnW, 26.0f), Hovered,
                      "Return to 3D Proving Grounds Scene"))
        {
            ActiveStudioWorkbench = DedicatedStudioDomain::None;
        }
        KitPillSurface(Canvas, ReturnMin, ImVec2(ReturnMin.x + ReturnW, ReturnMin.y + 26.0f),
                       Hovered ? Tokens.RowSelectedTop : Tokens.Inset, Tokens.LiveGreen, 999.0f);
        PaintChevronGlyph(Canvas, ImVec2(ReturnMin.x + 11.0f, ReturnMin.y + 13.0f), 3.0f, 2, Tokens.LiveGreen);
        KitDrawText(Canvas, Faces.Medium, 11.5f, ImVec2(ReturnMin.x + 18.0f, ReturnMin.y + 7.0f), Tokens.LiveGreen,
                    ReturnCap);
        return;
    }

    Canvas->AddRectFilled(PanelTop, ImVec2(WinPos.x + WinSz.x, WinPos.y + WinSz.y), Tokens.Ground);

    // 44 px .viewport-bar (1:1 VehicleHMI index.html chrome)
    const float BarHeight = 44.0f;
    const float BarCY     = ContentTop + BarHeight * 0.5f;
    Canvas->AddRectFilled(PanelTop, ImVec2(WinPos.x + WinSz.x, ContentTop + BarHeight), Tokens.ColumnHeader);
    Canvas->AddLine(ImVec2(WinPos.x, ContentTop + BarHeight - 1.0f),
                    ImVec2(WinPos.x + WinSz.x, ContentTop + BarHeight - 1.0f), Tokens.Edge);

    float LeftCursor = WinPos.x + 14.0f;
    KitDrawText(Canvas, Faces.Medium, 13.5f, ImVec2(LeftCursor, BarCY - 7.0f), Tokens.TextPrimary, "Scene");
    LeftCursor += KitTextWidth(Faces.Medium, 13.5f, "Scene") + 10.0f;

    const bool  RtxActive = (Scene.Render.ArchitectureTierIndex == 0);
    const char *PipeText  = RtxActive ? "Vulkan \xC2\xB7 distance-field GI \xC2\xB7 ReSTIR"
                                      : "Vulkan \xC2\xB7 SDF GI \xC2\xB7 SAH-2 BVH reflections";
    if (WinSz.x > 820.0f)
    {
        KitDrawText(Canvas, Faces.Regular, 12.0f, ImVec2(LeftCursor, BarCY - 6.0f), Tokens.TextMuted, PipeText);
        LeftCursor += KitTextWidth(Faces.Regular, 12.0f, PipeText) + 12.0f;
    }

    // LIVE pill
    {
        const ImVec2 PillMin(LeftCursor, BarCY - 12.0f);
        KitPillSurface(Canvas, PillMin, ImVec2(PillMin.x + 54.0f, PillMin.y + 24.0f), Tokens.LiveGreenDim,
                       Tokens.LiveGreen, 999.0f);
        Canvas->AddCircleFilled(ImVec2(PillMin.x + 12.0f, BarCY), 3.2f, Tokens.LiveGreen);
        KitDrawTracked(Canvas, Faces.SemiBold, 10.0f, ImVec2(PillMin.x + 20.0f, BarCY - 5.0f), Tokens.LiveGreen,
                       "LIVE", 10.0f * 0.08f);
        LeftCursor += 62.0f;
    }

    // Particles studio button
    {
        const float BtnW = KitTextWidth(Faces.Medium, 11.5f, "Particles") + 28.0f;
        const ImVec2 BtnMin(LeftCursor, BarCY - 13.0f);
        bool Hovered = false;
        if (KitTarget("##ViewportParticlesBtn", BtnMin, ImVec2(BtnW, 26.0f), Hovered,
                      "Open Particle Authoring Studio"))
        {
            OpenDedicatedStudio(DedicatedStudioDomain::ParticleStudio);
        }
        KitPillSurface(Canvas, BtnMin, ImVec2(BtnMin.x + BtnW, BtnMin.y + 26.0f),
                       Hovered ? Tokens.RowSelectedTop : Tokens.Inset, Tokens.Edge, 8.0f);
        PaintEverestGlyph(Canvas, EverestGlyphCategory::Sparkles, ImVec2(BtnMin.x + 12.0f, BarCY), 11.0f,
                          ConvertRgbToInk(0xd49a6au));
        KitDrawText(Canvas, Faces.Medium, 11.5f, ImVec2(BtnMin.x + 21.0f, BarCY - 5.75f), Tokens.TextPrimary,
                    "Particles");
    }

    // Right-aligned controls: 5 icon buttons + 195 px InspectionModes dropdown + 168 px Chase|Free segmented
    float RightCursor = WinPos.x + WinSz.x - 12.0f;
    struct ViewportToolIcon
    {
        const char          *Id;
        const char          *Tip;
        EverestGlyphCategory Glyph;
        bool                 Active;
    };
    const ViewportToolIcon ToolIcons[5] = {
        {"##VpClean", "Clean view (V)", EverestGlyphCategory::Eye, CleanViewportActive},
        {"##VpReasm", "Reassemble props", EverestGlyphCategory::Layers, false},
        {"##VpRespawn", "Respawn vehicle (R)", EverestGlyphCategory::RotateCcw, false},
        {"##VpSlice", "Distance slice inset (I)", EverestGlyphCategory::GridLattice,
         Scene.Render.DistanceSliceInsetEnabled},
        {"##VpHud", "Readout overlay (H)", EverestGlyphCategory::Activity, Scene.Render.ReadoutOverlayVisible},
    };
    for (int ToolIdx = 0; ToolIdx < 5; ++ToolIdx)
    {
        RightCursor -= 30.0f;
        const ImVec2 BtnMin(RightCursor, BarCY - 14.0f);
        bool Hovered = false;
        if (KitTarget(ToolIcons[ToolIdx].Id, BtnMin, ImVec2(28.0f, 28.0f), Hovered, ToolIcons[ToolIdx].Tip))
        {
            if (ToolIdx == 0) CleanViewportActive = !CleanViewportActive;
            if (ToolIdx == 1)
            {
                Scene.Fracture.IntactPropCount     = Scene.Fracture.TotalPropCount;
                Scene.Fracture.ActiveFragmentCount = 0u;
            }
            if (ToolIdx == 2) Scene.Vehicle.SpeedKilometresPerHour = 0.0f;
            if (ToolIdx == 3) Scene.Render.DistanceSliceInsetEnabled = !Scene.Render.DistanceSliceInsetEnabled;
            if (ToolIdx == 4) Scene.Render.ReadoutOverlayVisible = !Scene.Render.ReadoutOverlayVisible;
        }
        Canvas->AddRectFilled(BtnMin, ImVec2(BtnMin.x + 28.0f, BtnMin.y + 28.0f),
                              ToolIcons[ToolIdx].Active ? Tokens.RowSelectedTop : Tokens.Inset, 7.0f);
        Canvas->AddRect(BtnMin, ImVec2(BtnMin.x + 28.0f, BtnMin.y + 28.0f),
                        ToolIcons[ToolIdx].Active ? Tokens.AccentNeutral : Tokens.Edge, 7.0f);
        PaintEverestGlyph(Canvas, ToolIcons[ToolIdx].Glyph, ImVec2(BtnMin.x + 14.0f, BarCY), 13.0f,
                          ToolIcons[ToolIdx].Active ? Tokens.TextPrimary : Tokens.TextSoft);
        RightCursor -= 5.0f;
    }

    // 190 px InspectionModes dropdown
    if (RightCursor - LeftCursor > 380.0f)
    {
        size_t ModeCount = 0;
        const char *const *Modes = QueryEverestInspectionModes(ModeCount);
        const float DropW = 186.0f;
        RightCursor -= DropW;
        const ImVec2 DropMin(RightCursor, BarCY - 14.0f);
        bool Hovered = false;
        if (KitTarget("##VpInspectCombo", DropMin, ImVec2(DropW, 28.0f), Hovered))
        {
            ImGui::OpenPopup("##VpInspectPopup");
        }
        Canvas->AddRectFilled(DropMin, ImVec2(DropMin.x + DropW, DropMin.y + 28.0f),
                              Hovered ? Tokens.CardTop : Tokens.Inset, 8.0f);
        Canvas->AddRect(DropMin, ImVec2(DropMin.x + DropW, DropMin.y + 28.0f), Tokens.Edge, 8.0f);
        KitDrawText(Canvas, Faces.Regular, 11.5f, ImVec2(DropMin.x + 10.0f, BarCY - 5.75f), Tokens.TextPrimary,
                    Modes[std::min(Scene.Render.InspectionModeIndex, ModeCount - 1)]);
        PaintChevronGlyph(Canvas, ImVec2(DropMin.x + DropW - 12.0f, BarCY + 0.5f), 3.3f, 0, Tokens.TextMuted);
        ImGui::SetNextWindowPos(ImVec2(DropMin.x, DropMin.y + 32.0f), ImGuiCond_Appearing);
        if (DropdownControlSurface::BeginMenu("##VpInspectPopup"))
        {
            for (size_t Idx = 0; Idx < ModeCount; ++Idx)
            {
                if (DropdownControlSurface::Option(Modes[Idx], Idx == Scene.Render.InspectionModeIndex))
                {
                    Scene.Render.InspectionModeIndex = Idx;
                }
            }
            DropdownControlSurface::EndMenu();
        }
        RightCursor -= 8.0f;

        // Chase | Free · F8 segmented control
        const float SegW = 158.0f;
        RightCursor -= SegW;
        const ImVec2 SegMin(RightCursor, BarCY - 14.0f);
        Canvas->AddRectFilled(SegMin, ImVec2(SegMin.x + SegW, SegMin.y + 28.0f), Tokens.Inset, 8.0f);
        Canvas->AddRect(SegMin, ImVec2(SegMin.x + SegW, SegMin.y + 28.0f), Tokens.Edge, 8.0f);
        const char *CamLabels[2] = {"Chase", "Free \xC2\xB7 F8"};
        for (int SegIdx = 0; SegIdx < 2; ++SegIdx)
        {
            const float HalfW = (SegW - 4.0f) * 0.5f;
            const ImVec2 CellMin(SegMin.x + 2.0f + HalfW * static_cast<float>(SegIdx), SegMin.y + 2.0f);
            bool CellHover = false;
            ImGui::PushID(SegIdx);
            if (KitTarget("##VpCamSeg", CellMin, ImVec2(HalfW, 24.0f), CellHover))
            {
                Scene.Vehicle.FreeCameraActive = (SegIdx == 1);
            }
            ImGui::PopID();
            const bool Active = (Scene.Vehicle.FreeCameraActive == (SegIdx == 1));
            if (Active)
            {
                Canvas->AddRectFilled(CellMin, ImVec2(CellMin.x + HalfW, CellMin.y + 24.0f), Tokens.RowSelectedTop,
                                      6.0f);
            }
            const float Tw = KitTextWidth(Faces.Medium, 11.0f, CamLabels[SegIdx]);
            KitDrawText(Canvas, Faces.Medium, 11.0f, ImVec2(CellMin.x + (HalfW - Tw) * 0.5f, CellMin.y + 6.5f),
                        Active ? Tokens.TextPrimary : Tokens.TextMuted, CamLabels[SegIdx]);
        }
    }

    // Viewport 3D canvas body
    const ImVec2 CanvasMin(WinPos.x, ContentTop + BarHeight);
    const ImVec2 CanvasMax(WinPos.x + WinSz.x, WinPos.y + WinSz.y);
    if (CanvasMax.y - CanvasMin.y < 40.0f)
    {
        return;
    }
    Canvas->PushClipRect(CanvasMin, CanvasMax, true);
    PaintSynthesizedProvingGroundsViewport(Canvas, CanvasMin, CanvasMax);

    if (!CleanViewportActive)
    {
        // #inset-frame corner framing brackets
        const float Inset = 12.0f;
        const float Arm   = 14.0f;
        const ImU32 Brk   = KitInkRgba(255, 255, 255, 48);
        Canvas->AddLine(ImVec2(CanvasMin.x + Inset, CanvasMin.y + Inset),
                        ImVec2(CanvasMin.x + Inset + Arm, CanvasMin.y + Inset), Brk, 1.2f);
        Canvas->AddLine(ImVec2(CanvasMin.x + Inset, CanvasMin.y + Inset),
                        ImVec2(CanvasMin.x + Inset, CanvasMin.y + Inset + Arm), Brk, 1.2f);
        Canvas->AddLine(ImVec2(CanvasMax.x - Inset, CanvasMin.y + Inset),
                        ImVec2(CanvasMax.x - Inset - Arm, CanvasMin.y + Inset), Brk, 1.2f);
        Canvas->AddLine(ImVec2(CanvasMax.x - Inset, CanvasMin.y + Inset),
                        ImVec2(CanvasMax.x - Inset, CanvasMin.y + Inset + Arm), Brk, 1.2f);

        // .scene-pill ("Proving Grounds · Chase")
        const char *CamTitle = Scene.Vehicle.FreeCameraActive ? "Proving Grounds \xC2\xB7 Free Cam"
                                                              : "Proving Grounds \xC2\xB7 Chase";
        const float PillW = KitTextWidth(Faces.Medium, 11.5f, CamTitle) + 28.0f;
        const ImVec2 ScenePillMin(CanvasMin.x + 22.0f, CanvasMin.y + 18.0f);
        KitPillSurface(Canvas, ScenePillMin, ImVec2(ScenePillMin.x + PillW, ScenePillMin.y + 26.0f),
                       KitInkRgba(16, 16, 16, 196), Tokens.Edge, 999.0f);
        Canvas->AddCircleFilled(ImVec2(ScenePillMin.x + 12.0f, ScenePillMin.y + 13.0f), 3.2f, Tokens.LiveGreen);
        KitDrawText(Canvas, Faces.Medium, 11.5f, ImVec2(ScenePillMin.x + 20.0f, ScenePillMin.y + 7.0f),
                    Tokens.TextPrimary, CamTitle);

        // #hud telemetry card (bottom-left of viewport)
        if (Scene.Render.ReadoutOverlayVisible && (CanvasMax.y - CanvasMin.y) > 210.0f)
        {
            const float HudW = 248.0f;
            const float HudH = 128.0f;
            const ImVec2 HudMin(CanvasMin.x + 22.0f, CanvasMax.y - HudH - 18.0f);
            const ImVec2 HudMax(HudMin.x + HudW, HudMin.y + HudH);
            Canvas->AddRectFilled(HudMin, HudMax, KitInkRgba(16, 18, 20, 214), 14.0f);
            Canvas->AddRect(HudMin, HudMax, Tokens.Edge, 14.0f);

            char Line1[64] = {}, Line2[64] = {}, Line3[64] = {}, Line4[64] = {}, Line5[64] = {};
            std::snprintf(Line1, sizeof(Line1), "144 FPS \xC2\xB7 %.2f ms",
                          static_cast<double>(Scene.Render.FrameDurationMilliseconds));
            std::snprintf(Line2, sizeof(Line2), "TIER   %s",
                          RtxActive ? "RTX VK_KHR_ray_query" : "GTX SDF + SAH-2 BVH");
            std::snprintf(Line3, sizeof(Line3), "SUN    %.1f\xC2\xB0  \xC2\xB7  %.0f K",
                          static_cast<double>(Scene.Environment.SunElevationDegrees),
                          static_cast<double>(Scene.Environment.SunTemperatureKelvin));
            std::snprintf(Line4, sizeof(Line4), "DRIVE  %.0f km/h  \xC2\xB7  G%d  \xC2\xB7  %.2f bar",
                          static_cast<double>(Scene.Vehicle.SpeedKilometresPerHour), Scene.Vehicle.EngagedGear,
                          static_cast<double>(Scene.Vehicle.TurboBoostBar));
            std::snprintf(Line5, sizeof(Line5), "DEBRIS %u fragments  \xC2\xB7  drift %.1f\xC2\xB0",
                          Scene.Fracture.ActiveFragmentCount, static_cast<double>(Scene.Vehicle.DriftAngleDegrees));

            KitDrawText(Canvas, Faces.SemiBold, 12.5f, ImVec2(HudMin.x + 14.0f, HudMin.y + 12.0f), Tokens.LiveGreen,
                        Line1);
            KitDrawText(Canvas, Faces.Regular, 11.0f, ImVec2(HudMin.x + 14.0f, HudMin.y + 34.0f), Tokens.TextPrimary,
                        Line2);
            KitDrawText(Canvas, Faces.Regular, 11.0f, ImVec2(HudMin.x + 14.0f, HudMin.y + 53.0f), Tokens.TextSoft,
                        Line3);
            KitDrawText(Canvas, Faces.Regular, 11.0f, ImVec2(HudMin.x + 14.0f, HudMin.y + 72.0f), Tokens.TextSoft,
                        Line4);
            KitDrawText(Canvas, Faces.Regular, 11.0f, ImVec2(HudMin.x + 14.0f, HudMin.y + 91.0f), Tokens.TextMuted,
                        Line5);
        }

        // #overlay-dock Distance-Field Slice inset (bottom-right of viewport)
        if (Scene.Render.DistanceSliceInsetEnabled && WinSz.x > 640.0f && (CanvasMax.y - CanvasMin.y) > 210.0f)
        {
            const float SliceW = 192.0f;
            const float SliceH = 128.0f;
            const ImVec2 SliceMin(CanvasMax.x - SliceW - 22.0f, CanvasMax.y - SliceH - 18.0f);
            const ImVec2 SliceMax(SliceMin.x + SliceW, SliceMin.y + SliceH);
            Canvas->AddRectFilled(SliceMin, SliceMax, KitInkRgba(14, 17, 20, 224), 14.0f);
            Canvas->AddRect(SliceMin, SliceMax, Tokens.Edge, 14.0f);
            KitDrawTracked(Canvas, Faces.Medium, 9.5f, ImVec2(SliceMin.x + 12.0f, SliceMin.y + 10.0f), Tokens.TextMuted,
                           "TOROIDAL SDF SLICE", 9.5f * 0.09f);
            const ImVec2 FieldCenter(SliceMin.x + SliceW * 0.5f, SliceMin.y + SliceH * 0.58f);
            for (int Ring = 4; Ring >= 1; --Ring)
            {
                const float Rad = static_cast<float>(Ring) * 14.0f;
                Canvas->AddCircle(FieldCenter, Rad,
                                  Ring == 1 ? KitInkHex(0xe0a24a) : KitInkRgba(92, 168, 198, 95), 24, 1.4f);
            }
            Canvas->AddRectFilled(ImVec2(FieldCenter.x - 12.0f, FieldCenter.y - 6.0f),
                                  ImVec2(FieldCenter.x + 12.0f, FieldCenter.y + 6.0f), KitInkHex(0xc9c785), 2.0f);
            char SliceFoot[48] = {};
            std::snprintf(SliceFoot, sizeof(SliceFoot), "y = %.2f m \xC2\xB7 12,288 bricks",
                          static_cast<double>(Scene.Render.SliceHeightMetres));
            KitDrawText(Canvas, Faces.Regular, 10.0f, ImVec2(SliceMin.x + 12.0f, SliceMax.y - 18.0f), Tokens.TextSoft,
                        SliceFoot);
        }
    }
    Canvas->PopClipRect();
}

//------------------------------------------------------------------------------------------------------------------------
//                                              1:1 MODULAR INSPECTOR PANEL
//------------------------------------------------------------------------------------------------------------------------

void EverestWorkspace::ConstructInspectorPanel()
{
    SceneDirectory            &Directory  = SceneDirectory::Instance();
    InspectorCatalogue        &Inspectors = InspectorCatalogue::Instance();
    const KitFaces             Faces      = ResolveKitFaces();
    const EverestSurfaceTokens Tokens     = ResolveEverestTokens();
    ImDrawList                *Canvas     = ImGui::GetWindowDrawList();
    const ImVec2               WinPos     = ImGui::GetWindowPos();
    const ImVec2               WinSz      = ImGui::GetWindowSize();
    const float                ContentTop = ImGui::GetCursorScreenPos().y;
    const ImVec2               PanelTop(WinPos.x, ContentTop);

    Canvas->AddRectFilled(PanelTop, ImVec2(WinPos.x + WinSz.x, WinPos.y + WinSz.y), Tokens.Column);
    Canvas->AddLine(PanelTop, ImVec2(WinPos.x, WinPos.y + WinSz.y), Tokens.Edge);

    const InspectorProfileEntry *Profile = Inspectors.QueryProfile(SelectedRecordToken);
    if (Profile == nullptr || !Directory.QueryRegistered(SelectedRecordToken))
    {
        ConstructInspectorTopBar(Faces, Tokens, PanelTop, WinSz.x, "No selection");
        return;
    }

    const char *StudioButton = ResolveStudioButtonTitle(Profile->StudioDomain);
    if (ConstructInspectorTopBar(Faces, Tokens, PanelTop, WinSz.x, Profile->GroupCaption.c_str(), StudioButton))
    {
        OpenDedicatedStudio(Profile->StudioDomain);
    }

    float CursorY       = ContentTop + 44.0f;
    bool  VisibleFlag   = Directory.QueryVisible(SelectedRecordToken);
    float IdentityBlock = 0.0f;
    const std::string RecordName = Directory.QueryName(SelectedRecordToken);
    if (ConstructInspectorIdentity(Faces, Tokens, ImVec2(WinPos.x, CursorY), WinSz.x, Profile->EyebrowCaption.c_str(),
                                   RecordName.c_str(), Profile->AccentColourRgb, VisibleFlag, IdentityBlock))
    {
        Directory.ConfigureVisible(SelectedRecordToken, VisibleFlag);
    }
    CursorY += IdentityBlock;

    const float FooterH = 34.0f;
    const float ScrollH = std::max(80.0f, (WinPos.y + WinSz.y - FooterH) - CursorY);
    ImGui::SetCursorScreenPos(ImVec2(WinPos.x + 1.0f, CursorY));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
    if (ImGui::BeginChild("##EverestInspectorBody", ImVec2(WinSz.x - 2.0f, ScrollH), false))
    {
        const ImVec2 ChildOrigin = ImGui::GetCursorScreenPos();
        if (Profile->AuthoringCategory == InspectorAuthoringCategory::EngineReusable)
        {
            EngineReusableInspectorContext ReusableContext;
            ReusableContext.Render      = &Scene.Render;
            ReusableContext.Environment = &Scene.Environment;
            ReusableContext.Spatial     = static_cast<EngineSpatialParameters *>(Profile->PayloadAddress);
            ReusableContext.OpenStudio  = &Scene.PendingStudioRequest;
            const float Consumed        = ConstructEngineReusableInspectorBody(
                Profile->EngineDomain, Profile->AccentColourRgb, ChildOrigin.x, ChildOrigin.y, WinSz.x - 2.0f,
                ReusableContext);
            ImGui::SetCursorScreenPos(ImVec2(ChildOrigin.x, ChildOrigin.y + Consumed));
            ImGui::Dummy(ImVec2(1.0f, 8.0f));
        }
        else if (Profile->ConstructCustomContent)
        {
            Profile->ConstructCustomContent();
        }
    }
    ImGui::EndChild();
    ImGui::PopStyleColor();

    // Footer displaying modular inspector tier + RAII RecordToken
    const char *TierName = "EngineReusable";
    if (Profile->AuthoringCategory == InspectorAuthoringCategory::ProjectCustom)
    {
        TierName = "ProjectCustom";
    }
    else if (Profile->AuthoringCategory == InspectorAuthoringCategory::DedicatedStudio)
    {
        TierName = "DedicatedStudio";
    }
    char TokenLabel[48] = {};
    std::snprintf(TokenLabel, sizeof(TokenLabel), "RecordToken #%llu",
                  static_cast<unsigned long long>(SelectedRecordToken.Value));
    ConstructInspectorFooter(Canvas, Faces, Tokens, ImVec2(WinPos.x, WinPos.y + WinSz.y - FooterH), WinSz.x, TierName,
                             TokenLabel);
}

//------------------------------------------------------------------------------------------------------------------------
//                                              28 PX #STATUS STRIP
//------------------------------------------------------------------------------------------------------------------------

void EverestWorkspace::ConstructBottomStatusStrip(float Scale)
{
    (void)Scale;
    const ImGuiViewport *MainViewport = ImGui::GetMainViewport();
    if (MainViewport == nullptr || MainViewport->WorkSize.x <= 0.0f)
    {
        return;
    }
    const float StripH = 28.0f;
    const ImVec2 StripPos(MainViewport->WorkPos.x, MainViewport->WorkPos.y + MainViewport->WorkSize.y - StripH);
    const ImVec2 StripSize(MainViewport->WorkSize.x, StripH);

    ImGui::SetNextWindowPos(StripPos);
    ImGui::SetNextWindowSize(StripSize);
    ImGui::SetNextWindowViewport(MainViewport->ID);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    if (ImGui::Begin("##EverestStatusStrip", nullptr,
                     ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings |
                         ImGuiWindowFlags_NoDocking | ImGuiWindowFlags_NoInputs))
    {
        ImDrawList                *Canvas = ImGui::GetWindowDrawList();
        const KitFaces             Faces  = ResolveKitFaces();
        const EverestSurfaceTokens Tokens = ResolveEverestTokens();
        Canvas->AddRectFilled(StripPos, ImVec2(StripPos.x + StripSize.x, StripPos.y + StripH), Tokens.StatusStrip);
        Canvas->AddLine(StripPos, ImVec2(StripPos.x + StripSize.x, StripPos.y), Tokens.Edge);

        float CursorX     = StripPos.x + 14.0f;
        const float TextY = StripPos.y + 8.0f;
        Canvas->AddCircleFilled(ImVec2(CursorX + 4.0f, StripPos.y + 14.0f), 3.4f, Tokens.LiveGreen);
        KitDrawTracked(Canvas, Faces.SemiBold, 10.5f, ImVec2(CursorX + 12.0f, TextY), Tokens.TextPrimary, "REALTIME",
                       10.5f * 0.08f);
        CursorX += 88.0f;

        char FrameCell[48] = {}, QualCell[48] = {}, SunCell[48] = {}, SpdCell[48] = {}, FragCell[48] = {},
             CamCell[48] = {};
        std::snprintf(FrameCell, sizeof(FrameCell), "FRAME %.2f ms",
                      static_cast<double>(Scene.Render.FrameDurationMilliseconds));
        const char *QualNames[3] = {"LOW", "MEDIUM", "HIGH"};
        std::snprintf(QualCell, sizeof(QualCell), "QUALITY %s",
                      QualNames[std::min<size_t>(Scene.Render.QualityGradeIndex, 2)]);
        std::snprintf(SunCell, sizeof(SunCell), "SUN %.1f\xC2\xB0",
                      static_cast<double>(Scene.Environment.SunElevationDegrees));
        std::snprintf(SpdCell, sizeof(SpdCell), "SPEED %.0f km/h",
                      static_cast<double>(Scene.Vehicle.SpeedKilometresPerHour));
        std::snprintf(FragCell, sizeof(FragCell), "FRAGMENTS %u", Scene.Fracture.ActiveFragmentCount);
        std::snprintf(CamCell, sizeof(CamCell), "CAM %s", Scene.Vehicle.FreeCameraActive ? "FREE" : "CHASE");

        const char *Cells[7] = {FrameCell, QualCell, SunCell, SpdCell, "SMOKE RESIDENT", FragCell, CamCell};
        for (const char *CellText : Cells)
        {
            if (CursorX + 120.0f > StripPos.x + StripSize.x - 280.0f)
            {
                break;
            }
            Canvas->AddLine(ImVec2(CursorX - 10.0f, StripPos.y + 7.0f), ImVec2(CursorX - 10.0f, StripPos.y + 21.0f),
                            Tokens.Edge);
            KitDrawText(Canvas, Faces.Regular, 10.5f, ImVec2(CursorX, TextY), Tokens.TextMuted, CellText);
            CursorX += KitTextWidth(Faces.Regular, 10.5f, CellText) + 22.0f;
        }

        const char *GpuText = (Scene.Render.ArchitectureTierIndex == 0)
                                  ? "GPU  RTX \xC2\xB7 VK_KHR_ray_query \xC2\xB7 ReSTIR GI"
                                  : "GPU  GTX \xC2\xB7 Toroidal SDF GI + SAH-2 BVH Reflections";
        const float GpuW = KitTextWidth(Faces.Medium, 10.5f, GpuText);
        KitDrawText(Canvas, Faces.Medium, 10.5f, ImVec2(StripPos.x + StripSize.x - GpuW - 14.0f, TextY),
                    Scene.Render.ArchitectureTierIndex == 0 ? Tokens.LiveGreen : Tokens.WarmAmber, GpuText);
    }
    ImGui::End();
    ImGui::PopStyleVar(2);
}

} // namespace Frontier
