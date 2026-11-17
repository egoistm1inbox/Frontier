/*==========================================================================================================================================
                                                         PHOTOMETRICWORKSPACE.CPP
==========================================================================================================================================*/
// 🧩 The Photometric Workspace root shell: rig tab bar, luminaire + environment outliner, quick photometry chips,
//    lens/camera HUD, luminaire stage, diurnal transport, console drawer, inspector host, and the IES goniometer
//    matrix. Value edits touch shell-local state only; every engine/filesystem-bound command is an explicit NOOP
//    with a toast and a warm log line. The matrix sheet and the add-light drawer live in their own child windows so
//    their keys receive presses; the veil dismisses on outside presses.

#include "Engine/Interface/Workspaces/PhotometricWorkspace.h"

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/ControlTheme.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/Controls/GlyphSymbol.h"
#include "Engine/Interface/Controls/Toast.h"
#include "Frontier/Engine/Interface/Workspaces/PhotometricIesFileDialog.h"
#include "Engine/Interface/InspectorControls.h"

#include <imgui_internal.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace Frontier
{
namespace
{

void RecordRect(PhotometricWorkspaceState& State, const char* Name, ImVec2 Min, ImVec2 Max)
{
    State.Rects[Name] = ImVec4(Min.x, Min.y, Max.x, Max.y);
}

struct PanelCursor
{
    ImDrawList*            DrawList = nullptr;
    const EditorTypefaces* Faces    = nullptr;
    float                  S        = 1.0f;
    float                  X        = 0.0f;
    float                  Width    = 0.0f;
    float                  Y        = 0.0f;

    ImVec2 Space(float CssHeight, float MarginTop = 0.0f, float MarginBottom = 0.0f)
    {
        Y += MarginTop * S;
        const ImVec2 Top(X, Y);
        Y += CssHeight * S + MarginBottom * S;
        return Top;
    }

    [[nodiscard]] float Measure(ImFont* Face, float Size, const char* Text, float Tracking = 0.0f) const
    {
        return GlyphRun::Rasterize(nullptr, Faces, Face, Size * S, ImVec2(0.0f, 0.0f), 0, Text, Tracking * S, true);
    }

    float Text(ImFont* Face, float Size, float AtX, float Top, float LineHeight, ImU32 Colour, const char* Content,
               float Tracking = 0.0f) const
    {
        return GlyphRun::Rasterize(DrawList, Faces, Face, Size * S, ImVec2(AtX, GlyphRun::ResolveBaseline(Top, Size * S, LineHeight)),
                                   Colour, Content, Tracking * S, false);
    }
};

bool InvisibleRect(const char* Id, ImVec2 Min, ImVec2 Max)
{
    ImGui::SetCursorScreenPos(Min);
    return ImGui::InvisibleButton(Id, ImVec2(Max.x - Min.x, Max.y - Min.y), ImGuiButtonFlags_EnableNav);
}

bool QueryMatches(const char* Haystack, const std::string& Needle)
{
    if (Needle.empty() || Haystack == nullptr) return true;
    const size_t HayLength    = std::strlen(Haystack);
    const size_t NeedleLength = Needle.size();
    if (NeedleLength > HayLength) return false;
    for (size_t Start = 0; Start + NeedleLength <= HayLength; ++Start)
    {
        bool Hit = true;
        for (size_t Index = 0; Index < NeedleLength; ++Index)
        {
            const char Hay = Haystack[Start + Index];
            const char Want = Needle[Index];
            const char HayLow  = Hay >= 'A' && Hay <= 'Z' ? static_cast<char>(Hay + 32) : Hay;
            const char WantLow = Want >= 'A' && Want <= 'Z' ? static_cast<char>(Want + 32) : Want;
            if (HayLow != WantLow) Hit = false;
        }
        if (Hit) return true;
    }
    return false;
}

void FormatFluxBadge(const PhotometricWorkspaceState& State, const PhotometricLight& Light, char* Text, size_t Size) noexcept
{
    if (Light.Type == 0 || Light.Type == 1)
        std::snprintf(Text, Size, "%.0f cd", Light.Props.Intensity);
    else if (Light.Type == 2)
    {
        const int Custom = Light.Props.CustomIesProfile;
        const char* Src = Light.Props.UseMeasuredIes && Custom >= 0 && Custom < static_cast<int>(State.LoadedIesProfiles.size())
                              ? State.LoadedIesProfiles[Custom].Name.c_str()
                              : (Light.Props.UseMeasuredIes ? QueryPhotometricMeasuredIes(Light.Props.MeasuredProfile)
                                                            : QueryPhotometricPresetIes(Light.Props.PresetProfile));
        std::snprintf(Text, Size, "%.0f lm · %s", Light.Props.Lumens * Light.Props.Multiplier, Src);
    }
    else std::snprintf(Text, Size, "%.0f lm", QueryPhotometricFlux(Light.Type, Light.Props));
}

int QueryVisibleCount(const PhotometricWorkspaceState& State) noexcept
{
    int N = 0;
    for (int I = 0; I < 8; ++I)
        if (State.Lights[I].Visible) ++N;
    return N;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    TOP BAR
//------------------------------------------------------------------------------------------------------------------------

void ConstructTopBar(PhotometricWorkspaceState& State, PanelCursor& Root)
{
    const EditorTypefaces& Faces    = *Root.Faces;
    ImDrawList* const      DrawList = Root.DrawList;
    const ImVec2           Bar      = Root.Space(46.0f, 0.0f, 8.0f);
    const float            Left     = Bar.x;
    const float            Right    = Bar.x + Root.Width;

    Root.Text(Faces.SemiBold, 14.0f, Left, Bar.y + 23.0f - 0.5f * 14.0f * 1.3f, 1.3f,
              ResolveCssColour(0xF1F1F1FF), "Frontier", -0.3f);
    const float BrandW = Root.Measure(Faces.SemiBold, 14.0f, "Frontier", -0.3f);
    Root.Text(Faces.Regular, 13.0f, Left + BrandW + 5.0f, Bar.y + 23.0f - 0.5f * 13.0f * 1.4f, 1.4f,
              ResolveCssColour(0x5E5E5EFF), "/");
    Root.Text(Faces.Regular, 13.0f, Left + BrandW + 15.0f, Bar.y + 23.0f - 0.5f * 13.0f * 1.4f, 1.4f,
              ResolveCssColour(0xBCBCBCFF), "Photometric Studio");

    // 📝 Right action cluster first so the tabs can never overlap it.
    struct Action
    {
        const char* Tag;
        const char* Id;
        const char* Label;
        const char* Glyph;
        bool        Accent;
    };
    static const Action Actions[4] = {
        { "TopBar/Load", "##TopLoad", "Load .ies", "StudioDownload", false },
        { "TopBar/Goniometer", "##TopGonio", "Goniometer", "StudioGrid", false },
        { "TopBar/ExportIes", "##TopExportIes", "Export .ies", "StudioDownload", false },
        { "TopBar/ExportRig", "##TopExportRig", "Export Rig", "StudioDownload", true },
    };
    float ActionX = Right;
    for (int I = 3; I >= 0; --I)
    {
        const float  Wide = Root.Measure(Faces.Medium, 11.0f, Actions[I].Label) + 30.0f;
        const ImVec2 KeyMax(ActionX, Bar.y + 38.0f);
        const ImVec2 KeyMin(ActionX - Wide, Bar.y + 8.0f);
        ActionX -= Wide + 8.0f;
        DrawList->AddRectFilled(KeyMin, KeyMax,
                                ResolveCssColour(Actions[I].Accent ? 0xE8C27AFF : 0x1A1A1AFF), 15.0f);
        if (!Actions[I].Accent)
            DrawList->AddRect(KeyMin, KeyMax, ResolveCssColour(0xFFFFFF14), 15.0f, ImDrawFlags_None, 1.0f);
        Root.Text(Faces.Medium, 11.0f, KeyMin.x + 15.0f, Bar.y + 23.0f - 0.5f * 11.0f * 1.38f, 1.38f,
                  ResolveCssColour(Actions[I].Accent ? 0x1A1A1AFF : 0xD8D8D8FF), Actions[I].Label);
        ImGui::PushID(90 + I);
        RecordRect(State, Actions[I].Tag, KeyMin, KeyMax);
        if (InvisibleRect(Actions[I].Id, KeyMin, KeyMax))
        {
            if (I == 0)
            {
                State.LoadIesError.clear();
                const std::string ChosenPath = BrowsePhotometricIesFile();
                if (!ChosenPath.empty()) (void)LoadPhotometricWorkspaceIes(State, ChosenPath, State.LoadIesError);
                else if (!PhotometricIesFileDialogAvailable()) State.LoadIesPopupRequested = true;
            }
            else if (I == 1) State.MatrixOpen = true;
            else if (I == 2)
                NoopPhotometricWorkspaceCommand(State, "EXPORT", "Export .ies refused",
                                                "Exporting .ies is a NOOP in this shell");
            else
                NoopPhotometricWorkspaceCommand(State, "EXPORT", "Export rig refused",
                                                "Exporting the rig is a NOOP in this shell");
        }
        ImGui::PopID();
    }

    static const char* Suites[4] = { "Particle", "Fracture", "Light / IES", "Force Field" };
    float              SuiteX    = ActionX - 12.0f;
    for (int I = 3; I >= 0; --I)
    {
        const float  Wide = Root.Measure(Faces.Medium, 10.5f, Suites[I]) + 20.0f;
        const ImVec2 KeyMax(SuiteX, Bar.y + 36.0f);
        const ImVec2 KeyMin(SuiteX - Wide, Bar.y + 10.0f);
        SuiteX -= Wide + 6.0f;
        const bool Current = I == 2;
        if (Current) DrawList->AddRectFilled(KeyMin, KeyMax, ResolveCssColour(0xFFFFFF12), 13.0f);
        Root.Text(Faces.Medium, 10.5f, KeyMin.x + 10.0f, Bar.y + 23.0f - 0.5f * 10.5f * 1.38f, 1.38f,
                  ResolveCssColour(Current ? 0xEFEFEFFF : 0x848484FF), Suites[I]);
        char SuiteTag[32]{};
        std::snprintf(SuiteTag, sizeof(SuiteTag), "TopBar/Suite%d", I);
        ImGui::PushID(80 + I);
        RecordRect(State, SuiteTag, KeyMin, KeyMax);
        if (InvisibleRect("##Suite", KeyMin, KeyMax) && !Current)
            NoopPhotometricWorkspaceCommand(State, "SCENE", "Cross-studio link refused",
                                            "Suite navigation is a NOOP in this shell");
        ImGui::PopID();
    }

    static const char* Rigs[4] = { "ECE Roadway Bay", "Architectural Gallery", "Softbox & COB Rig",
                                   "Night & Lunar Field" };
    float              TabX    = Left + BrandW + 15.0f + Root.Measure(Faces.Regular, 13.0f, "Photometric Studio") + 18.0f;
    for (int Tab = 0; Tab < 4; ++Tab)
    {
        const float  Wide = Root.Measure(Faces.Medium, 10.5f, Rigs[Tab]) + 22.0f;
        const ImVec2 TabMin(TabX, Bar.y + 8.0f);
        const ImVec2 TabMax(TabX + Wide, Bar.y + 38.0f);
        const bool   Active = State.Scenario == Tab;
        DrawList->AddRectFilled(TabMin, TabMax, ResolveCssColour(Active ? 0xE8C27A26 : 0x1E1E1EFF), 15.0f);
        DrawList->AddRect(TabMin, TabMax, ResolveCssColour(Active ? 0xE8C27A66 : 0xFFFFFF14), 15.0f,
                          ImDrawFlags_None, 1.0f);
        Root.Text(Faces.Medium, 10.5f, TabMin.x + 11.0f, Bar.y + 23.0f - 0.5f * 10.5f * 1.38f, 1.38f,
                  ResolveCssColour(Active ? 0xE8C27AFF : 0xBCBCBCFF), Rigs[Tab]);
        char RigTag[32]{};
        std::snprintf(RigTag, sizeof(RigTag), "TopBar/Rig%d", Tab);
        ImGui::PushID(70 + Tab);
        RecordRect(State, RigTag, TabMin, TabMax);
        if (InvisibleRect("##RigTab", TabMin, TabMax)) ApplyPhotometricScenario(State, Tab);
        ImGui::PopID();
        TabX = TabMax.x + 6.0f;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    OUTLINER
//------------------------------------------------------------------------------------------------------------------------

void ConstructOutlinerPanel(PhotometricWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Min, ImVec2 Max,
                          AssetBrowserLink* Link)
{
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x121212FF), 22.0f);
    DrawList->AddRect(Min, Max, ResolveCssColour(0xFFFFFF0E), 22.0f, ImDrawFlags_None, 1.0f);
    PanelCursor Panel{ DrawList, &Faces, 1.0f, Min.x + 14.0f, Max.x - Min.x - 28.0f, Min.y + 12.0f };

    const ImVec2 Search = Panel.Space(32.0f, 0.0f, 8.0f);
    {
        PanelCursor Cursor{ DrawList, &Faces, 1.0f, Search.x, Panel.Width - 40.0f, Search.y };
        const ImVec2 BoxMax(Search.x + Panel.Width - 40.0f, Search.y + 32.0f);
        DrawList->AddRectFilled(Search, BoxMax, ResolveCssColour(0x0E0F12D6), 10.0f);
        DrawList->AddRect(Search, BoxMax, ResolveCssColour(0xFFFFFF12), 10.0f, ImDrawFlags_None, 1.0f);
        (void)GlyphSymbol::Construct(DrawList, "StudioSearch", ImVec2(Search.x + 9.0f, Search.y + 10.0f), 12.0f,
                                     1.8f, ResolveCssColour(0x5E5E5EFF));
        if (State.SearchQuery.empty())
            Cursor.Text(Faces.Regular, 11.0f, Search.x + 28.0f, Search.y + 16.0f - 0.5f * 11.0f * 1.4f, 1.4f,
                        ResolveCssColour(0x5E5E5EFF), "Search lights, IES, sky…");
        ImGui::PushID("OutlinerSearch");
        RecordRect(State, "Outliner/Search", Search, BoxMax);
        char Buffer[128]{};
        std::snprintf(Buffer, sizeof(Buffer), "%s", State.SearchQuery.c_str());
        ImGui::SetCursorScreenPos(ImVec2(Search.x + 26.0f, Search.y + 2.0f));
        ImGui::SetNextItemWidth(BoxMax.x - Search.x - 32.0f);
        ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0, 0, 0, 0));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 0.0f);
        ImGui::PushStyleColor(ImGuiCol_Text, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0xD8D8D8FF)));
        if (ImGui::InputText("##Search", Buffer, sizeof(Buffer), ImGuiInputTextFlags_EscapeClearsAll))
            State.SearchQuery = Buffer;
        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar();
        ImGui::PopID();
        const ImVec2 AddMin(BoxMax.x + 8.0f, Search.y);
        const ImVec2 AddMax(AddMin.x + 32.0f, Search.y + 32.0f);
        DrawList->AddRectFilled(AddMin, AddMax, ResolveCssColour(0x1A1A1AFF), 10.0f);
        (void)GlyphSymbol::Construct(DrawList, "StudioPlus", ImVec2(AddMin.x + 10.0f, AddMin.y + 10.0f), 12.0f, 1.8f,
                                     ResolveCssColour(0xBCBCBCFF));
        RecordRect(State, "Outliner/Add", AddMin, AddMax);
        if (InvisibleRect("##OutlinerAdd", AddMin, AddMax)) State.AddDrawerOpen = !State.AddDrawerOpen;
    }

    const double Klm = QueryPhotometricCensusLumens(State.Lights, 8) / 1000.0;
    const ImVec2 Census = Panel.Space(56.0f, 0.0f, 8.0f);
    const float  TileWide = (Panel.Width - 8.0f) * 0.5f;
    for (int Tile = 0; Tile < 2; ++Tile)
    {
        const ImVec2 TileMin(Census.x + Tile * (TileWide + 8.0f), Census.y);
        const ImVec2 TileMax(TileMin.x + TileWide, Census.y + 56.0f);
        DrawList->AddRectFilled(TileMin, TileMax, ResolveCssColour(0x1E1E1EFF), 12.0f);
        Panel.Text(Faces.Regular, 9.0f, TileMin.x + 10.0f, TileMin.y + 6.0f, 1.4f, ResolveCssColour(0x848484FF),
                   Tile == 0 ? "LUMINAIRES" : "ENVIRONMENT", 0.9f);
        char Figure[32]{}, Sub[48]{};
        if (Tile == 0)
        {
            std::snprintf(Figure, sizeof(Figure), "%d / 8", QueryVisibleCount(State));
            std::snprintf(Sub, sizeof(Sub), "%.2f klm active", Klm);
        }
        else
        {
            std::snprintf(Figure, sizeof(Figure), "%s%.1f°", State.SunSolved.ElevationDeg >= 0 ? "+" : "",
                          State.SunSolved.ElevationDeg);
            std::snprintf(Sub, sizeof(Sub), "IBL %.2fx · EV %.2f", State.Dome.SkylightIntensity,
                          State.Post.ExposureEv);
        }
        Panel.Text(Faces.SemiBold, 14.0f, TileMin.x + 10.0f, TileMin.y + 19.0f, 1.3f,
                   ResolveCssColour(0xEFEFEFFF), Figure);
        Panel.Text(Faces.Regular, 9.5f, TileMin.x + 10.0f, TileMin.y + 38.0f, 1.4f, ResolveCssColour(0x5E5E5EFF),
                   Sub);
    }

    const ImVec2 LumHead = Panel.Space(20.0f, 0.0f, 2.0f);
    Panel.Text(Faces.SemiBold, 9.5f, LumHead.x, LumHead.y, 1.4f, ResolveCssColour(0x848484FF), "SCENE LUMINAIRES",
               0.9f);
    Panel.Text(Faces.Regular, 9.5f, LumHead.x + Panel.Width - 12.0f, LumHead.y, 1.4f,
               ResolveCssColour(0x5E5E5EFF), "8");
    for (int I = 0; I < 8; ++I)
    {
        const PhotometricLight& Light = State.Lights[I];
        char                    Hay[128]{};
        std::snprintf(Hay, sizeof(Hay), "%s %s", Light.Name.c_str(), QueryPhotometricLightSpec(Light.Type).Id);
        if (!QueryMatches(Hay, State.SearchQuery)) continue;
        const ImVec2 RowMin(Panel.X, Panel.Y);
        const ImVec2 RowMax(Panel.X + Panel.Width, Panel.Y + 48.0f);
        Panel.Y += 50.0f;
        const bool Current = State.Selected == I;
        if (Current) DrawList->AddRectFilled(RowMin, RowMax, ResolveCssColour(0xE8C27A14), 12.0f);
        DrawList->AddCircleFilled(ImVec2(RowMin.x + 14.0f, RowMin.y + 24.0f), 5.0f,
                                  ResolveCssColour(QueryPhotometricLightSpec(Light.Type).Accent), 16);
        Panel.Text(Faces.Medium, 11.5f, RowMin.x + 28.0f, RowMin.y + 6.0f, 1.38f,
                   ResolveCssColour(Light.Visible ? 0xEFEFEFFF : 0x5E5E5EFF), Light.Name.c_str());
        char Badge[96]{};
        FormatFluxBadge(State, Light, Badge, sizeof(Badge));
        Panel.Text(Faces.Regular, 10.0f, RowMin.x + 28.0f, RowMin.y + 24.0f, 1.4f, ResolveCssColour(0x848484FF),
                   Badge);
        ImGui::PushID(400 + I);
        const ImVec2 EyeMax(RowMax.x - 8.0f, RowMin.y + 36.0f);
        const ImVec2 EyeMin(EyeMax.x - 26.0f, RowMin.y + 12.0f);
        (void)GlyphSymbol::Construct(DrawList, Light.Visible ? "StudioEye" : "StudioEyeOff",
                                     ImVec2(EyeMin.x + 6.0f, EyeMin.y + 5.0f), 14.0f, 1.6f,
                                     ResolveCssColour(Light.Visible ? 0xBCBCBCFF : 0x5E5E5EFF));
        char EyeTag[48]{};
        std::snprintf(EyeTag, sizeof(EyeTag), "Outliner/Eye%d", I);
        RecordRect(State, EyeTag, EyeMin, EyeMax);
        if (InvisibleRect("##LightEye", EyeMin, EyeMax))
        {
            State.Lights[I].Visible = !State.Lights[I].Visible;
            LogPhotometricWorkspaceValue(State, "PARAM", Light.Name.c_str(),
                                          State.Lights[I].Visible ? "shown" : "hidden");
        }
        char RowTag[48]{};
        std::snprintf(RowTag, sizeof(RowTag), "Outliner/Light%d", I);
        RecordRect(State, RowTag, RowMin, RowMax);
        if (InvisibleRect("##LightRow", RowMin, RowMax)) SelectPhotometricWorkspaceNode(State, I);
        ImGui::PopID();
    }

    static const char* EnvNames[7] = { "HDRI / Sky Dome", "Directional Sun", "Lunar Bodies", "Star Field",
                                       "Lens Flare", "Atmosphere & Fog", "Post Exposure & Lux" };
    static const char* EnvMetas[7] = { "IBL · Equirectangular", "NOAA Solar Ephemeris", "6 Worlds · Phase Dial",
                                       "300 Stars · Twinkle", "Anamorphic · Ghosts", "Rayleigh · Mie · Fog",
                                       "ACES · Isolux Scale" };
    static const ImU32 EnvAccents[7] = { 0x9FC7E8FF, 0xE8C27AFF, 0xDCE2ECFF, 0xB48FE8FF,
                                         0xE8823CFF, 0x8FD3C4FF, 0x9AA3A8FF };
    const ImVec2       EnvHead       = Panel.Space(20.0f, 6.0f, 2.0f);
    Panel.Text(Faces.SemiBold, 9.5f, EnvHead.x, EnvHead.y, 1.4f, ResolveCssColour(0x848484FF), "ENVIRONMENT LIGHTS",
               0.9f);
    Panel.Text(Faces.Regular, 9.5f, EnvHead.x + Panel.Width - 12.0f, EnvHead.y, 1.4f,
               ResolveCssColour(0x5E5E5EFF), "7");
    for (int I = 0; I < 7; ++I)
    {
        char Hay[128]{};
        std::snprintf(Hay, sizeof(Hay), "%s %s", EnvNames[I], EnvMetas[I]);
        if (!QueryMatches(Hay, State.SearchQuery)) continue;
        const ImVec2 RowMin(Panel.X, Panel.Y);
        const ImVec2 RowMax(Panel.X + Panel.Width, Panel.Y + 44.0f);
        Panel.Y += 46.0f;
        const bool Current = State.Selected == PhotometricWorkspaceState::SelectedEnvDome + I;
        if (Current) DrawList->AddRectFilled(RowMin, RowMax, ResolveCssColour(0xE8C27A14), 12.0f);
        DrawList->AddCircleFilled(ImVec2(RowMin.x + 14.0f, RowMin.y + 22.0f), 5.0f,
                                  ResolveCssColour(EnvAccents[I]), 16);
        Panel.Text(Faces.Medium, 11.5f, RowMin.x + 28.0f, RowMin.y + 5.0f, 1.38f, ResolveCssColour(0xEFEFEFFF),
                   EnvNames[I]);
        Panel.Text(Faces.Regular, 10.0f, RowMin.x + 28.0f, RowMin.y + 22.0f, 1.4f, ResolveCssColour(0x848484FF),
                   EnvMetas[I]);
        char RowTag[48]{};
        std::snprintf(RowTag, sizeof(RowTag), "Outliner/Env%d", I);
        ImGui::PushID(500 + I);
        RecordRect(State, RowTag, RowMin, RowMax);
        if (InvisibleRect("##EnvRow", RowMin, RowMax))
            SelectPhotometricWorkspaceNode(State, PhotometricWorkspaceState::SelectedEnvDome + I);
        ImGui::PopID();
    }

    const ImVec2 QuickHead = Panel.Space(20.0f, 6.0f, 4.0f);
    Panel.Text(Faces.SemiBold, 9.5f, QuickHead.x, QuickHead.y, 1.4f, ResolveCssColour(0x848484FF), "QUICK PHOTOMETRY",
               0.9f);
    // 📝 The scenario/curve shortcut chips moved out to the shared Asset Browser; the lux lens toggle stays local.
    static const char* Chips[2] = { "Browse light assets\u2026", "Isolux Scan" };
    float              ChipX = Panel.X, ChipY = Panel.Y;
    for (int I = 0; I < 2; ++I)
    {
        const float ChipWide = Panel.Measure(Faces.Medium, 10.0f, Chips[I]) + 20.0f;
        if (ChipX + ChipWide > Panel.X + Panel.Width)
        {
            ChipX = Panel.X;
            ChipY += 30.0f;
        }
        const ImVec2 ChipMin(ChipX, ChipY);
        const ImVec2 ChipMax(ChipX + ChipWide, ChipY + 24.0f);
        DrawList->AddRectFilled(ChipMin, ChipMax, ResolveCssColour(0x1A1A1AFF), 12.0f);
        Panel.Text(Faces.Medium, 10.0f, ChipMin.x + 10.0f, ChipY + 12.0f - 0.5f * 10.0f * 1.38f, 1.38f,
                   ResolveCssColour(0xBCBCBCFF), Chips[I]);
        char ChipTag[40]{};
        std::snprintf(ChipTag, sizeof(ChipTag), "Quick/Chip%d", I);
        ImGui::PushID(600 + I);
        RecordRect(State, ChipTag, ChipMin, ChipMax);
        if (InvisibleRect("##QuickChip", ChipMin, ChipMax))
        {
            if (I == 0)
            {
                if (Link != nullptr)
                {
                    Link->OpenRequested = true;
                    Link->OpenWorkspace = AssetBrowserWorkspacePhotometric;
                }
                else Toast::Show("The Asset Browser is not attached in this shell.");
            }
            else
                State.Lens = State.Lens == PhotometricWorkspaceState::LensLux
                                 ? PhotometricWorkspaceState::LensPbr
                                 : PhotometricWorkspaceState::LensLux;
        }
        ImGui::PopID();
        ChipX = ChipMax.x + 6.0f;
    }
    Panel.Y = ChipY + 30.0f;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    ADD-LIGHT DRAWER
//------------------------------------------------------------------------------------------------------------------------

void ConstructAddDrawer(PhotometricWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 RailMin, float RailWide,
                      AssetBrowserLink* Link)
{
    if (!State.AddDrawerOpen) return;
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();
    const ImVec2      Min(RailMin.x + 10.0f, RailMin.y + 52.0f);
    const ImVec2      Max(Min.x + RailWide - 20.0f, Min.y + 300.0f);
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x161616FF), 16.0f);
    DrawList->AddRect(Min, Max, ResolveCssColour(0xFFFFFF24), 16.0f, ImDrawFlags_None, 1.0f);

    ImGui::PushID("AddDrawer");
    ImGui::SetCursorScreenPos(ImVec2(Min.x + 12.0f, Min.y + 10.0f));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
    ImGui::BeginChild("##AddScroll", ImVec2(RailWide - 44.0f, 280.0f), false,
                      ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
    ImDrawList* const Inner = ImGui::GetWindowDrawList();
    PanelCursor       Panel{ Inner, &Faces, 1.0f, Min.x + 12.0f, RailWide - 44.0f, Min.y + 10.0f };
    const ImVec2 Head = Panel.Space(24.0f, 0.0f, 6.0f);
    Panel.Text(Faces.Medium, 11.5f, Head.x, Head.y, 1.38f, ResolveCssColour(0xD8D8D8FF), "Add Physical Light");
    const ImVec2 CloseMax(Min.x + RailWide - 32.0f, Head.y + 24.0f);
    const ImVec2 CloseMin(CloseMax.x - 24.0f, Head.y);
    (void)GlyphSymbol::Construct(Inner, "StudioClose", ImVec2(CloseMin.x + 6.0f, CloseMin.y + 6.0f), 12.0f, 1.8f,
                                 ResolveCssColour(0xBCBCBCFF));
    RecordRect(State, "AddDrawer/Close", CloseMin, CloseMax);
    if (InvisibleRect("##AddClose", CloseMin, CloseMax)) State.AddDrawerOpen = false;

    // 📝 Luminaire browsing moved out to the shared Asset Browser; the drawer keeps its chrome and hands off.
    {
        const ImVec2 BrowseMin(Panel.X, Panel.Y);
        const ImVec2 BrowseMax(Panel.X + Panel.Width, Panel.Y + 56.0f);
        Panel.Y += 60.0f;
        DrawList->AddRectFilled(BrowseMin, BrowseMax, ResolveCssColour(0x1E1E1EFF), 10.0f);
        DrawList->AddRect(BrowseMin, BrowseMax, ResolveCssColour(0xE8C27A66), 10.0f, ImDrawFlags_None, 1.0f);
        Panel.Text(Faces.Medium, 11.5f, BrowseMin.x + 12.0f, BrowseMin.y + 8.0f, 1.38f, ResolveCssColour(0xE8C27AFF),
                   "Browse luminaires\u2026");
        Panel.Text(Faces.Regular, 9.5f, BrowseMin.x + 12.0f, BrowseMin.y + 30.0f, 1.4f, ResolveCssColour(0x848484FF),
                   "7 lights \u00B7 opens the shared Asset Browser");
        RecordRect(State, "AddDrawer/Browse", BrowseMin, BrowseMax);
        if (InvisibleRect("##AddBrowse", BrowseMin, BrowseMax))
        {
            if (Link != nullptr)
            {
                Link->OpenRequested = true;
                Link->OpenWorkspace = AssetBrowserWorkspacePhotometric;
            }
            else Toast::Show("The Asset Browser is not attached in this shell.");
            State.AddDrawerOpen = false;
        }
    }
    ImGui::SetCursorScreenPos(ImVec2(Panel.X, Panel.Y));
    ImGui::Dummy(ImVec2(1.0f, 1.0f));
    ImGui::EndChild();
    ImGui::PopStyleColor();
    ImGui::PopID();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    STAGE + HUD
//------------------------------------------------------------------------------------------------------------------------

void ConstructStageHud(PhotometricWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min,
                       ImVec2 Max)
{
    // 📝 One compact pill row like the reference: lenses, cameras, then the room toggles. The telemetry chip
    //    rides the stage bottom-right instead of crowding this row.
    PanelCursor Hud{ DrawList, &Faces, 1.0f, Min.x, Max.x - Min.x, Min.y };
    static const char* Lenses[4] = { "ACES PBR", "False-Colour Lux", "Goniometer", "Homologation" };
    static const char* Cams[4]   = { "Orbit", "Top Plan", "Wall Screen", "Roadway" };
    float              PillX     = Min.x + 14.0f;
    const float        PillY     = Min.y + 12.0f;
    const float        PillLimit = Max.x - 14.0f;
    for (int I = 0; I < 4; ++I)
    {
        const float  Wide = Hud.Measure(Faces.Medium, 10.0f, Lenses[I]) + 15.0f;
        if (PillX + Wide > PillLimit) break;
        const ImVec2 PillMin(PillX, PillY);
        const ImVec2 PillMax(PillX + Wide, PillY + 26.0f);
        const bool   Active = State.Lens == I;
        DrawList->AddRectFilled(PillMin, PillMax, ResolveCssColour(Active ? 0xE8C27A26 : 0x0E0F12D6), 13.0f);
        Hud.Text(Faces.Medium, 10.0f, PillMin.x + 7.5f, PillY + 13.0f - 0.5f * 10.0f * 1.38f, 1.38f,
                 ResolveCssColour(Active ? 0xE8C27AFF : 0xBCBCBCFF), Lenses[I]);
        char LensTag[32]{};
        std::snprintf(LensTag, sizeof(LensTag), "Stage/Lens%d", I);
        ImGui::PushID(700 + I);
        RecordRect(State, LensTag, PillMin, PillMax);
        if (InvisibleRect("##Lens", PillMin, PillMax)) State.Lens = I;
        ImGui::PopID();
        PillX = PillMax.x + 5.0f;
    }
    PillX += 3.0f;
    for (int I = 0; I < 4; ++I)
    {
        const float  Wide = Hud.Measure(Faces.Medium, 10.0f, Cams[I]) + 15.0f;
        if (PillX + Wide > PillLimit) break;
        const ImVec2 PillMin(PillX, PillY);
        const ImVec2 PillMax(PillX + Wide, PillY + 26.0f);
        const bool   Active = State.Camera == I;
        DrawList->AddRectFilled(PillMin, PillMax, ResolveCssColour(Active ? 0xE8C27A26 : 0x0E0F12D6), 13.0f);
        Hud.Text(Faces.Medium, 10.0f, PillMin.x + 7.5f, PillY + 13.0f - 0.5f * 10.0f * 1.38f, 1.38f,
                 ResolveCssColour(Active ? 0xE8C27AFF : 0xBCBCBCFF), Cams[I]);
        char CamTag[32]{};
        std::snprintf(CamTag, sizeof(CamTag), "Stage/Cam%d", I);
        ImGui::PushID(710 + I);
        RecordRect(State, CamTag, PillMin, PillMax);
        if (InvisibleRect("##Cam", PillMin, PillMax)) State.Camera = I;
        ImGui::PopID();
        PillX = PillMax.x + 5.0f;
    }
    {
        const char* Label = State.DarkRoom ? "Dark Fog Room" : "Environment Sky";
        const float Wide  = Hud.Measure(Faces.Medium, 10.0f, "Environment Sky") + 15.0f;
        if (PillX + 3.0f + Wide <= PillLimit)
        {
            const ImVec2 PillMin(PillX + 3.0f, PillY);
            const ImVec2 PillMax(PillMin.x + Wide, PillY + 26.0f);
            DrawList->AddRectFilled(PillMin, PillMax, ResolveCssColour(State.DarkRoom ? 0xE8C27A26 : 0x0E0F12D6), 13.0f);
            Hud.Text(Faces.Medium, 10.0f, PillMin.x + 7.5f, PillY + 13.0f - 0.5f * 10.0f * 1.38f, 1.38f,
                     ResolveCssColour(State.DarkRoom ? 0xE8C27AFF : 0xBCBCBCFF), Label);
            RecordRect(State, "Stage/DarkRoom", PillMin, PillMax);
            if (InvisibleRect("##DarkRoom", PillMin, PillMax)) State.DarkRoom = !State.DarkRoom;
            PillX = PillMax.x + 5.0f;
        }
    }
    {
        const float Wide = Hud.Measure(Faces.Medium, 10.0f, "Volumetrics") + 15.0f;
        if (PillX + Wide <= PillLimit)
        {
            const ImVec2 PillMin(PillX, PillY);
            const ImVec2 PillMax(PillX + Wide, PillY + 26.0f);
            DrawList->AddRectFilled(PillMin, PillMax, ResolveCssColour(State.ShowGizmos ? 0xE8C27A26 : 0x0E0F12D6), 13.0f);
            Hud.Text(Faces.Medium, 10.0f, PillMin.x + 7.5f, PillY + 13.0f - 0.5f * 10.0f * 1.38f, 1.38f,
                     ResolveCssColour(State.ShowGizmos ? 0xE8C27AFF : 0xBCBCBCFF), "Volumetrics");
            RecordRect(State, "Stage/Gizmos", PillMin, PillMax);
            if (InvisibleRect("##Gizmos", PillMin, PillMax)) State.ShowGizmos = !State.ShowGizmos;
        }
    }
}

SceneViewportRequest ConstructPhotometricPreviewRequestImpl(const PhotometricWorkspaceState& State, float Width, float Height,
                                                            float PixelDensity, double DeltaSeconds)
{
    SceneViewportRequest Request;
    Request.PanelWidth = Width;
    Request.PanelHeight = Height;
    Request.PixelDensity = PixelDensity;
    Request.DeltaSeconds = std::clamp(DeltaSeconds, 0.0, 0.25);
    Request.ReplaceLuminaires = true;
    Request.OverrideSolar = true;
    Request.SolarEnabled = State.Sun.Enabled;
    Request.SolarElevationDegrees = State.SunSolved.ElevationDeg;
    Request.SolarAzimuthDegrees = State.SunSolved.AzimuthDeg;
    Request.SolarIlluminanceKilolux = std::clamp(State.Sun.Intensity * State.Sun.DirectGain, 0.0, 200.0);
    Request.SolarAngularDiameterDegrees = std::clamp(State.Sun.DiameterDeg, 0.05, 2.0);
    Request.SolarTemperatureKelvin = std::clamp(State.Sun.TemperatureK, 1000.0, 12000.0);
    Request.PreviewSkyScale = std::clamp(State.Dome.SkylightIntensity * State.Dome.DiffuseMultiplier, 0.0, 4.0);
    Request.PreviewReflectionScale = std::clamp(State.Dome.ReflectionGain, 0.0, 4.0);
    const std::array<double, 3> PreviewTarget{-40.0, 0.0, 1.5};
    Request.CameraTarget = PreviewTarget;
    Request.CameraPosition = State.Camera == PhotometricWorkspaceState::CameraTop ? std::array<double, 3>{-40.0, -0.1, 16.0}
                            : State.Camera == PhotometricWorkspaceState::CameraWall ? std::array<double, 3>{-47.0, -5.5, 4.0}
                            : State.Camera == PhotometricWorkspaceState::CameraRoadway ? std::array<double, 3>{-49.0, -12.0, 6.0}
                            : std::array<double, 3>{-47.0, -9.0, 6.0};
    if (State.Camera == PhotometricWorkspaceState::CameraTop) Request.CameraUp = {0.0, 1.0, 0.0};

    auto Linear = [](double Channel) { return Channel <= 0.04045 ? Channel / 12.92 : std::pow((Channel + 0.055) / 1.055, 2.4); };
    Request.Luminaires.reserve(8);
    for (const PhotometricLight& Source : State.Lights)
    {
        if (!Source.Visible) continue;
        const PhotometricLightProps& Props = Source.Props;
        SceneViewportLuminaire Light;
        Light.Category = Source.Type == 0 ? 0u : 5u; // Omni for points; engine floodlight for generic spots and luminous surfaces.
        if (Source.Type == 2 && Props.UseMeasuredIes && Props.CustomIesProfile < 0)
        {
            // The native C++ light library has these measured luminaire families; use their real beam models, not a generic cone.
            switch (Props.MeasuredProfile)
            {
            case 0: Light.Category = 2u; break; // low beam
            case 1: Light.Category = 3u; break; // high beam
            case 2: Light.Category = 4u; break; // fog cutoff
            case 3: Light.Category = 1u; break; // roadway batwing
            default: Light.Category = 5u; break;
            }
        }
        Light.Position = {-40.0 + Props.Position[0], Props.Position[2], Props.Position[1]}; // prototype Y-up → renderer Z-up.
        if (Props.HasTarget)
        {
            const double Dx = Props.Target[0] - Props.Position[0];
            const double Dy = Props.Target[1] - Props.Position[1];
            const double Dz = Props.Target[2] - Props.Position[2];
            const double Length = std::max(1.0e-9, std::sqrt(Dx * Dx + Dy * Dy + Dz * Dz));
            Light.Direction = {Dx / Length, Dz / Length, Dy / Length};
        }
        else Light.Direction = {0.0, 0.0, -1.0};
        const unsigned R = std::strtoul(Props.ColorHex + 1, nullptr, 16);
        Light.Colour = {Linear(static_cast<double>((R >> 16) & 0xFF) / 255.0), Linear(static_cast<double>((R >> 8) & 0xFF) / 255.0),
                        Linear(static_cast<double>(R & 0xFF) / 255.0)};
        const double OuterDegrees = Source.Type == 1 ? Props.Angle : Props.Cone * 0.5;
        const double InnerDegrees = OuterDegrees * (1.0 - std::clamp(Props.Penumbra, 0.0, 0.98));
        Light.Params = {std::cos(InnerDegrees * 0.017453292519943295), std::cos(OuterDegrees * 0.017453292519943295),
                        static_cast<double>(Props.MeasuredProfile), 1.0};
        if (Light.Category == 1u) Light.Params = {0.70, 0.20, 1.0, 1.0};
        else if (Light.Category == 2u) Light.Params = {0.90, 0.60, 0.0, 1.0};
        else if (Light.Category == 3u) Light.Params = {0.98, 0.85, 0.0, 1.0};
        else if (Light.Category == 4u) Light.Params = {0.85, 0.40, 0.0, 1.0};
        if (Source.Type == 0) Light.Intensity = Props.Intensity * Props.Multiplier;
        else if (Source.Type == 1) Light.Intensity = Props.Intensity * Props.Multiplier;
        else if (Source.Type == 2 || Source.Type == 3 || Source.Type == 4) Light.Intensity = Props.Lumens * Props.Multiplier / (4.0 * 3.141592653589793);
        else if (Source.Type == 5) Light.Intensity = Props.Watts * Props.Efficacy * Props.Dimmer / (4.0 * 3.141592653589793);
        else Light.Intensity = Props.LumensPerMetre * Props.Length * Props.Dimmer / (4.0 * 3.141592653589793);
        Light.Reach = Source.Type == 0 ? Props.Distance : (Source.Type == 1 ? Props.Distance : Props.Range);
        Request.Luminaires.push_back(Light);
    }
    return Request;
}

void ConstructLightStage(PhotometricWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList,
                         ImVec2 Min, ImVec2 Max, const SceneViewportImage& Rendered)
{
    PanelCursor Surface{ DrawList, &Faces, 1.0f, Min.x, Max.x - Min.x, Min.y };
    const float Wide    = Max.x - Min.x;
    const float Tall    = Max.y - Min.y;
    const float CentreX = Min.x + Wide * 0.5f;
    const float FloorY  = Min.y + Tall * 0.72f;

    DrawList->AddRectFilled(Min, Max, ResolveCssColour(State.DarkRoom ? 0x0B0B0BFF : 0x101418FF), 0.0f);
    const bool NativeImage = Rendered.Texture != 0;
    if (NativeImage) DrawList->AddImage(static_cast<ImTextureID>(Rendered.Texture), Min, Max);
    if (!NativeImage)
    {
    for (int I = -8; I <= 8; ++I)
    {
        const float X = CentreX + I * 52.0f;
        DrawList->AddLine(ImVec2(X, FloorY), ImVec2(CentreX + I * 14.0f, Min.y + Tall), ResolveCssColour(0xFFFFFF10));
    }
    for (int I = 0; I < 6; ++I)
    {
        const float Y = FloorY + I * (Min.y + Tall - FloorY) / 5.0f;
        DrawList->AddLine(ImVec2(Min.x + 20.0f, Y), ImVec2(Max.x - 20.0f, Y), ResolveCssColour(0xFFFFFF0C));
    }
    // 📝 Wall screen plane + cove strip.
    DrawList->AddRectFilled(ImVec2(CentreX - 190.0f, Min.y + 60.0f), ImVec2(CentreX + 190.0f, FloorY),
                            ResolveCssColour(0xFFFFFF06), 4.0f);

    auto Project = [&](const double P[3]) {
        return ImVec2(CentreX + static_cast<float>(P[0] * 72.0 - P[2] * 22.0),
                      FloorY - static_cast<float>(P[1] * 110.0) + static_cast<float>(P[2] * 14.0));
    };
    for (int I = 0; I < 8; ++I)
    {
        const PhotometricLight& Light = State.Lights[I];
        if (!Light.Visible) continue;
        const ImVec2 At     = Project(Light.Props.Position);
        const ImU32  Accent = ResolveCssColour(QueryPhotometricLightSpec(Light.Type).Accent);
        if (State.ShowGizmos && (Light.Type == 1 || Light.Type == 2))
        {
            const ImVec2 Aim = Project(Light.Props.Target);
            DrawList->AddLine(At, Aim, (Accent & 0x00FFFFFF) | (0x66u << 24), 1.5f);
            const float Spread = Light.Type == 1 ? static_cast<float>(Light.Props.Angle) : static_cast<float>(Light.Props.Cone * 0.5);
            const ImVec2 Dir(Aim.x - At.x, Aim.y - At.y);
            const float  Len = std::sqrt(Dir.x * Dir.x + Dir.y * Dir.y) + 1.0f;
            const ImVec2 N(-Dir.y / Len, Dir.x / Len);
            const float  W = std::tan(Spread * 3.14159265f / 180.0f) * Len * 0.6f;
            DrawList->AddLine(At, ImVec2(Aim.x + N.x * W, Aim.y + N.y * W), (Accent & 0x00FFFFFF) | (0x44u << 24),
                              1.0f);
            DrawList->AddLine(At, ImVec2(Aim.x - N.x * W, Aim.y - N.y * W), (Accent & 0x00FFFFFF) | (0x44u << 24),
                              1.0f);
        }
        DrawList->AddCircleFilled(At, 10.0f, (Accent & 0x00FFFFFF) | (0x30u << 24), 20);
        DrawList->AddCircleFilled(At, 4.5f, Accent, 16);
        if (State.Selected == I) DrawList->AddCircle(At, 9.0f, ResolveCssColour(0xE8C27AFF), 20, 1.5f);
        char Tag[64]{};
        std::snprintf(Tag, sizeof(Tag), "%s", Light.Name.c_str());
        Surface.Text(Faces.Regular, 9.5f, At.x + 14.0f, At.y - 8.0f, 1.4f, ResolveCssColour(0x848484FF), Tag);
    }
    }

    if (!NativeImage && State.Lens == PhotometricWorkspaceState::LensLux)
    {
        static const char* Ticks[6] = { "0.1", "5", "25", "100", "300", "1000+" };
        const ImVec2 LegMin(Min.x + 14.0f, Min.y + 6.0f);
        const ImVec2 LegMax(LegMin.x + 228.0f, LegMin.y + 62.0f);
        DrawList->AddRectFilled(LegMin, LegMax, ResolveCssColour(0x14161CF2), 10.0f);
        DrawList->AddRect(LegMin, LegMax, ResolveCssColour(0xFFFFFF2E), 10.0f, ImDrawFlags_None, 1.0f);
        Surface.Text(Faces.SemiBold, 9.0f, LegMin.x + 10.0f, LegMin.y + 6.0f, 1.4f, ResolveCssColour(0xD8D8D8FF),
                     "Illuminance Isolux Scale (lx)", 0.4f);
        static const ImU32 Ramp[6] = { 0x1A2B4AFF, 0x1F7A8CFF, 0x3EC46DFF, 0xE8C27AFF, 0xE8823CFF, 0xE85C5CFF };
        for (int I = 0; I < 6; ++I)
        {
            const float X = LegMin.x + 10.0f + I * 34.5f;
            DrawList->AddRectFilled(ImVec2(X, LegMin.y + 26.0f), ImVec2(X + 34.5f, LegMin.y + 40.0f),
                                    ResolveCssColour(Ramp[I]), 0.0f);
            Surface.Text(Faces.Regular, 8.5f, X, LegMin.y + 44.0f, 1.4f, ResolveCssColour(0xBCBCBCFF), Ticks[I]);
        }
    }

    if (!NativeImage)
        Surface.Text(Faces.Regular, 10.0f, Min.x + 14.0f, Max.y - 26.0f, 1.4f, ResolveCssColour(0x5E5E5EFF),
                     "NO HOST RENDERER · schematic preview only");

    // 📝 Report the backend that actually presented the image; CPU lux remains a secondary staged estimate, never a renderer claim.
    {
        const double Klm = QueryPhotometricCensusLumens(State.Lights, 8) / 1000.0;
        char Summary[128]{};
        const char* Backend = NativeImage ? Rendered.Readout.RendererTag.c_str() : "SCHEMATIC ONLY";
        if (NativeImage)
            std::snprintf(Summary, sizeof(Summary), "%u × %u · %.1f ms", Rendered.Readout.ScreenExtent[0],
                          Rendered.Readout.ScreenExtent[1], Rendered.Readout.RefreshMilliseconds);
        else
            std::snprintf(Summary, sizeof(Summary), "%.2f klm staged · no GPU image", Klm);
        const float  BackWide = Surface.Measure(Faces.SemiBold, 9.5f, Backend, 0.4f);
        const float  SumWide  = Surface.Measure(Faces.Regular, 10.0f, Summary);
        const float  ChipWide = (BackWide > SumWide ? BackWide : SumWide) + 24.0f;
        const ImVec2 ChipMax(Max.x - 14.0f, Max.y - 12.0f);
        const ImVec2 ChipMin(ChipMax.x - ChipWide, ChipMax.y - 52.0f);
        DrawList->AddRectFilled(ChipMin, ChipMax, ResolveCssColour(0x0E0F12D6), 12.0f);
        Surface.Text(Faces.SemiBold, 9.5f, ChipMin.x + 12.0f, ChipMin.y + 7.0f, 1.4f,
                     ResolveCssColour(NativeImage ? 0x7FD08AFF : 0xE8C27AFF), Backend, 0.4f);
        Surface.Text(Faces.Regular, 10.0f, ChipMin.x + 12.0f, ChipMin.y + 25.0f, 1.4f,
                     ResolveCssColour(0xBCBCBCFF), Summary);
    }

    ImGui::PushID("LightStage");
    RecordRect(State, "Stage/Surface", Min, Max);
    ImGui::SetCursorScreenPos(Min);
    ImGui::InvisibleButton("##LightStage", ImVec2(Wide, Tall), ImGuiButtonFlags_EnableNav);
    ImGui::PopID();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    TRANSPORT + CONSOLE
//------------------------------------------------------------------------------------------------------------------------

void ConstructTransportStrip(PhotometricWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList,
                             ImVec2 Min, ImVec2 Max)
{
    PanelCursor Strip{ DrawList, &Faces, 1.0f, Min.x, Max.x - Min.x, Min.y };
    DrawList->AddLine(ImVec2(Min.x, Min.y), ImVec2(Max.x, Min.y), ResolveCssColour(0xFFFFFF12));

    auto RoundKey = [&](const char* Id, const char* RectTag, const char* Glyph, ImVec2 KeyMin, bool Accent) {
        const ImVec2 KeyMax(KeyMin.x + 32.0f, KeyMin.y + 32.0f);
        const ImVec2 Centre(KeyMin.x + 16.0f, KeyMin.y + 16.0f);
        DrawList->AddCircleFilled(Centre, 16.0f,
                                  ResolveCssColour(Accent ? 0xE8C27AFF : 0x1A1A1AFF), 32);
        if (!Accent) DrawList->AddCircle(Centre, 16.0f, ResolveCssColour(0xFFFFFF24), 32, 1.0f);
        (void)GlyphSymbol::Construct(DrawList, Glyph, ImVec2(KeyMin.x + 9.5f, KeyMin.y + 9.5f), 13.0f, 1.8f,
                                     ResolveCssColour(Accent ? 0x1A1A1AFF : 0xD8D8D8FF));
        RecordRect(State, RectTag, KeyMin, KeyMax);
        return InvisibleRect(Id, KeyMin, KeyMax);
    };

    float KeyX = Min.x + 14.0f;
    const float KeyY = Min.y + 16.0f;
    if (RoundKey("##StepBack", "Transport/StepBack", "StudioStep", ImVec2(KeyX, KeyY), false))
    {
        State.Sun.LocalHours -= 1.0;
        if (State.Sun.LocalHours < 0) State.Sun.LocalHours += 24.0;
        EvaluatePhotometricSun(State.Sun, State.SunSolved);
    }
    KeyX += 40.0f;
    if (RoundKey("##SweepPlay", "Transport/Play", State.SweepPlaying ? "StudioPause" : "StudioPlay", ImVec2(KeyX, KeyY),
                 true))
        State.SweepPlaying = !State.SweepPlaying;
    KeyX += 40.0f;
    if (RoundKey("##StepFwd", "Transport/StepFwd", "StudioStep", ImVec2(KeyX, KeyY), false))
    {
        State.Sun.LocalHours += 1.0;
        if (State.Sun.LocalHours >= 24.0) State.Sun.LocalHours -= 24.0;
        EvaluatePhotometricSun(State.Sun, State.SunSolved);
    }
    KeyX += 40.0f;
    if (RoundKey("##SweepReset", "Transport/Reset", "StudioReset", ImVec2(KeyX, KeyY), false))
    {
        State.SweepPlaying   = false;
        State.Sun.LocalHours = 12.0;
        EvaluatePhotometricSun(State.Sun, State.SunSolved);
    }
    KeyX += 52.0f;

    Strip.Text(Faces.Regular, 11.0f, KeyX, Min.y + 8.0f, 1.4f, ResolveCssColour(0x848484FF), "Diurnal Sweep");
    const int   HoursInt = static_cast<int>(State.Sun.LocalHours) % 24;
    const int   Mins     = static_cast<int>((State.Sun.LocalHours - std::floor(State.Sun.LocalHours)) * 60.0) % 60;
    char        Clock[64]{};
    std::snprintf(Clock, sizeof(Clock), "%02d:%02d UTC+2 · El %.1f°", HoursInt, Mins, State.SunSolved.ElevationDeg);
    const float ClockWide = Strip.Measure(Faces.Monospace, 11.0f, "00:00 UTC+2 · El -00.0°");
    const float ConsoleWide = Strip.Measure(Faces.Medium, 11.0f, "Console  00") + 30.0f;
    const float TrackRight  = Max.x - 14.0f - ConsoleWide - 12.0f - ClockWide - 12.0f;
    Strip.Text(Faces.Monospace, 11.0f, TrackRight + 12.0f, Min.y + 8.0f, 1.4f, ResolveCssColour(0xBCBCBCFF), Clock);
    const ImVec2 TrackMin(KeyX, Min.y + 28.0f);
    const ImVec2 TrackMax(TrackRight, Min.y + 44.0f);
    DrawList->AddRectFilled(ImVec2(TrackMin.x, TrackMin.y + 6.0f), ImVec2(TrackMax.x, TrackMax.y - 6.0f),
                            ResolveCssColour(0x1E1E1EFF), 2.0f);
    DrawList->AddCircleFilled(ImVec2(TrackMin.x + (TrackMax.x - TrackMin.x) * static_cast<float>(State.Sun.LocalHours / 24.0),
                                     Min.y + 36.0f),
                              6.0f, ResolveCssColour(0xE8C27AFF), 16);
    RecordRect(State, "Transport/Scrub", TrackMin, TrackMax);
    ImGui::PushID("DiurnalScrub");
    ImGui::SetCursorScreenPos(TrackMin);
    if (ImGui::InvisibleButton("##Scrub", ImVec2(TrackMax.x - TrackMin.x, 16.0f), ImGuiButtonFlags_EnableNav) ||
        (ImGui::IsItemActive() && ImGui::IsMouseDragging(ImGuiMouseButton_Left)))
    {
        const ImVec2 Mouse = ImGui::GetIO().MousePos;
        double           F     = (Mouse.x - TrackMin.x) / (TrackMax.x - TrackMin.x);
        if (F < 0.0) F = 0.0;
        if (F > 1.0) F = 1.0;
        State.Sun.LocalHours = F * 24.0;
        EvaluatePhotometricSun(State.Sun, State.SunSolved);
    }
    ImGui::PopID();

    const ImVec2 ConsoleMax(Max.x - 14.0f, Min.y + 50.0f);
    const ImVec2 ConsoleMin(ConsoleMax.x - ConsoleWide, Min.y + 16.0f);
    DrawList->AddRectFilled(ConsoleMin, ConsoleMax, ResolveCssColour(0x1A1A1AFF), 10.0f);
    DrawList->AddRect(ConsoleMin, ConsoleMax, ResolveCssColour(0xFFFFFF14), 10.0f, ImDrawFlags_None, 1.0f);
    char ConsoleLabel[48]{};
    std::snprintf(ConsoleLabel, sizeof(ConsoleLabel), "Console  %d", static_cast<int>(State.Log.size()));
    Strip.Text(Faces.Medium, 11.0f, ConsoleMin.x + 12.0f, Min.y + 33.0f - 0.5f * 11.0f * 1.38f, 1.38f,
               ResolveCssColour(0xD8D8D8FF), ConsoleLabel);
    RecordRect(State, "Transport/Console", ConsoleMin, ConsoleMax);
    if (InvisibleRect("##Console", ConsoleMin, ConsoleMax)) State.ConsoleOpen = !State.ConsoleOpen;
}

void ConstructConsoleDrawer(PhotometricWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Min, ImVec2 Max)
{
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x121212FF), 16.0f);
    DrawList->AddRect(Min, Max, ResolveCssColour(0xFFFFFF0E), 16.0f, ImDrawFlags_None, 1.0f);

    PanelCursor Panel{ DrawList, &Faces, 1.0f, Min.x, Max.x - Min.x, Min.y };
    const ImVec2 Head = Panel.Space(36.0f);
    DrawList->AddLine(ImVec2(Min.x, Head.y + 36.0f), ImVec2(Max.x, Head.y + 36.0f), ResolveCssColour(0xFFFFFF12));
    Panel.Text(Faces.Light, 12.5f, Min.x + 16.0f, Head.y + 18.0f - 0.5f * 12.5f * 1.4f, 1.4f,
               ResolveCssColour(0xDADADADA), "Photometric Console & Validation Log", -0.2f);
    const float ClearWide = Panel.Measure(Faces.Medium, 11.0f, "Clear") + 18.0f;
    const ImVec2 ClearMax(Max.x - 16.0f, Head.y + 29.0f);
    const ImVec2 ClearMin(ClearMax.x - ClearWide, Head.y + 7.0f);
    Panel.Text(Faces.Medium, 11.0f, ClearMin.x + 9.0f, Head.y + 18.0f - 0.5f * 11.0f * 1.38f, 1.38f,
               ResolveCssColour(0xBCBCBCFF), "Clear");
    ImGui::PushID("ConsoleDrawer");
    RecordRect(State, "Console/Clear", ClearMin, ClearMax);
    if (InvisibleRect("##ConsoleClear", ClearMin, ClearMax)) State.Log.clear();

    ImGui::SetCursorScreenPos(ImVec2(Min.x, Head.y + 36.0f));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
    ImGui::BeginChild("##ConsoleScroll", ImVec2(Max.x - Min.x, Max.y - Head.y - 36.0f), false,
                      ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
    ImDrawList* const InnerList = ImGui::GetWindowDrawList();
    PanelCursor       Content{ InnerList, &Faces, 1.0f, Min.x + 12.0f, Max.x - Min.x - 24.0f, Head.y + 36.0f + 8.0f };
    for (const PhotometricWorkspaceLogEntry& Entry : State.Log)
    {
        const ImVec2 Row = Content.Space(22.0f);
        Content.Text(Faces.SemiBold, 10.0f, Row.x + 4.0f, Row.y + 4.0f, 1.4f, ResolveCssColour(0xE8C27AFF),
                     Entry.Channel.c_str());
        // 📝 NOOP lines read warm so refused commands stand out from staged values.
        const bool Noop = Entry.Message.find("explicit NOOP") != std::string::npos;
        Content.Text(Faces.Regular, 11.0f, Row.x + 4.0f + 96.0f, Row.y + 3.0f, 1.4f,
                     ResolveCssColour(Noop ? 0xE8C27AFF : 0x848484FF), Entry.Message.c_str());
    }
    ImGui::SetCursorScreenPos(ImVec2(Content.X, Content.Y));
    ImGui::Dummy(ImVec2(1.0f, 1.0f));
    ImGui::EndChild();
    ImGui::PopStyleColor();
    ImGui::PopID();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    NATIVE IES IMPORT
//------------------------------------------------------------------------------------------------------------------------

void ConstructLoadIesPopup(PhotometricWorkspaceState& State)
{
    static constexpr const char* PopupId = "Import LM-63 Type-C IES";
    if (State.LoadIesPopupRequested)
    {
        ImGui::OpenPopup(PopupId);
        State.LoadIesPopupRequested = false;
    }
    const ImGuiViewport* Viewport = ImGui::GetMainViewport();
    ImGui::SetNextWindowPos(Viewport->GetCenter(), ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
    ImGui::SetNextWindowSize(ImVec2(560.0f, 245.0f), ImGuiCond_Appearing);
    if (!ImGui::BeginPopupModal(PopupId, nullptr, ImGuiWindowFlags_NoSavedSettings)) return;

    ImGui::TextWrapped("Import a Type-C LM-63 profile. TILT=NONE is required; the selected file is limited to 4 MiB.");
    ImGui::Spacing();
    ImGui::SetNextItemWidth(-1.0f);
    ImGui::InputText("IES file path", State.LoadIesPath, sizeof(State.LoadIesPath));
    if (!State.LoadIesError.empty())
    {
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 0.48f, 0.36f, 1.0f));
        ImGui::TextWrapped("%s", State.LoadIesError.c_str());
        ImGui::PopStyleColor();
    }
    const float ButtonWidth = 142.0f;
    ImGui::SetCursorPosX(ImGui::GetWindowWidth() - ButtonWidth * 2.0f - ImGui::GetStyle().ItemSpacing.x - 16.0f);
    if (ImGui::Button("Import profile", ImVec2(ButtonWidth, 32.0f)))
    {
        if (LoadPhotometricWorkspaceIes(State, State.LoadIesPath, State.LoadIesError)) ImGui::CloseCurrentPopup();
    }
    RecordRect(State, "LoadIes/Import", ImGui::GetItemRectMin(), ImGui::GetItemRectMax());
    ImGui::SameLine();
    if (ImGui::Button("Cancel", ImVec2(ButtonWidth, 32.0f)))
    {
        State.LoadIesError.clear();
        ImGui::CloseCurrentPopup();
    }
    RecordRect(State, "LoadIes/Cancel", ImGui::GetItemRectMin(), ImGui::GetItemRectMax());
    ImGui::EndPopup();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    IES MATRIX
//------------------------------------------------------------------------------------------------------------------------

void ConstructIesMatrix(PhotometricWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 RootMin, ImVec2 RootMax,
                      AssetBrowserLink* Link)
{
    if (!State.MatrixOpen) return;
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();

    const float SheetWide = 760.0f;
    const float SheetTall = 640.0f;
    const ImVec2 SheetMin(0.5f * (RootMin.x + RootMax.x - SheetWide), 0.5f * (RootMin.y + RootMax.y - SheetTall));
    const ImVec2 SheetMax(SheetMin.x + SheetWide, SheetMin.y + SheetTall);
    DrawList->AddRectFilled(RootMin, RootMax, ResolveCssColour(0x050507C2));
    DrawList->AddRectFilled(SheetMin, SheetMax, ResolveCssColour(0x121212FF), 24.0f);
    DrawList->AddRect(SheetMin, SheetMax, ResolveCssColour(0xFFFFFF24), 24.0f, ImDrawFlags_None, 1.0f);

    ImGui::PushID("IesVeil");
    ImGui::SetCursorScreenPos(ImVec2(SheetMin.x + 24.0f, SheetMin.y + 20.0f));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
    ImGui::BeginChild("##MatrixScroll", ImVec2(SheetWide - 48.0f, SheetTall - 40.0f), false,
                      ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
    ImDrawList* const DialogList = ImGui::GetWindowDrawList();
    PanelCursor Dialog{ DialogList, &Faces, 1.0f, SheetMin.x + 24.0f, SheetWide - 48.0f, SheetMin.y + 20.0f };

    const ImVec2 Head = Dialog.Space(52.0f, 0.0f, 8.0f);
    Dialog.Text(Faces.Light, 17.0f, Head.x, Head.y, 1.3f, ResolveCssColour(0xEFEFEFFF),
                "IES Photometric Goniometer & LM-63 Catalogue");
    Dialog.Text(Faces.Regular, 10.5f, Head.x, Head.y + 28.0f, 1.4f, ResolveCssColour(0x848484FF),
                "Profile browsing moved to the shared Asset Browser.");
    const ImVec2 CloseMax(SheetMin.x + SheetWide - 24.0f, Head.y + 30.0f);
    const ImVec2 CloseMin(CloseMax.x - 30.0f, Head.y);
    DialogList->AddRectFilled(CloseMin, CloseMax, ResolveCssColour(0x1A1A1AFF), 15.0f);
    (void)GlyphSymbol::Construct(DialogList, "StudioClose", ImVec2(CloseMin.x + 9.0f, CloseMin.y + 9.0f), 12.0f, 1.8f,
                                 ResolveCssColour(0xBCBCBCFF));
    RecordRect(State, "Matrix/Close", CloseMin, CloseMax);
    if (InvisibleRect("##MatrixClose", CloseMin, CloseMax)) State.MatrixOpen = false;

    // 📝 The 15-tile IES gallery moved out to the shared Asset Browser; the dialog keeps its chrome and hands off.
    {
        const ImVec2 Browse = Dialog.Space(64.0f, 8.0f, 0.0f);
        const ImVec2 BrowseMin(Browse.x, Browse.y);
        const ImVec2 BrowseMax(Browse.x + Dialog.Width, Browse.y + 64.0f);
        DialogList->AddRectFilled(BrowseMin, BrowseMax, ResolveCssColour(0x1E1E1EFF), 12.0f);
        DialogList->AddRect(BrowseMin, BrowseMax, ResolveCssColour(0xE8C27A66), 12.0f, ImDrawFlags_None, 1.0f);
        Dialog.Text(Faces.Medium, 12.5f, BrowseMin.x + 14.0f, BrowseMin.y + 9.0f, 1.35f, ResolveCssColour(0xE8C27AFF),
                    "Browse IES profiles\u2026");
        Dialog.Text(Faces.Regular, 10.0f, BrowseMin.x + 14.0f, BrowseMin.y + 32.0f, 1.4f, ResolveCssColour(0x848484FF),
                    "7 measured \u00B7 8 analytical \u00B7 opens the shared Asset Browser");
        Dialog.Text(Faces.Medium, 13.0f, BrowseMax.x - 30.0f, BrowseMin.y + 19.0f, 1.35f, ResolveCssColour(0xE8C27AFF),
                    "\u2197");
        RecordRect(State, "Matrix/Browse", BrowseMin, BrowseMax);
        if (InvisibleRect("##MatrixBrowse", BrowseMin, BrowseMax))
        {
            if (Link != nullptr)
            {
                Link->OpenRequested = true;
                Link->OpenWorkspace = AssetBrowserWorkspacePhotometric;
            }
            else Toast::Show("The Asset Browser is not attached in this shell.");
            State.MatrixOpen = false;
        }
    }
    ImGui::SetCursorScreenPos(ImVec2(Dialog.X, Dialog.Y));
    ImGui::Dummy(ImVec2(1.0f, 1.0f));
    ImGui::EndChild();
    ImGui::PopStyleColor();

    // 📝 The veil submits last so the sheet keys win their presses; outside presses dismiss.
    ImGui::SetCursorScreenPos(RootMin);
    if (ImGui::InvisibleButton("##IesVeil", ImVec2(RootMax.x - RootMin.x, RootMax.y - RootMin.y)))
        State.MatrixOpen = false;
    ImGui::PopID();
}

} // namespace

SceneViewportRequest BuildPhotometricPreviewRequest(const PhotometricWorkspaceState& State, float Width, float Height,
                                                     float PixelDensity, double DeltaSeconds)
{
    return ConstructPhotometricPreviewRequestImpl(State, Width, Height, PixelDensity, DeltaSeconds);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    ROOT
//------------------------------------------------------------------------------------------------------------------------

void ApplyPhotometricWorkspaceLink(PhotometricWorkspaceState& State, AssetBrowserLink* Link)
{
    if (Link == nullptr || !Link->HasHandoff() || Link->OpenRecordWorkspace != AssetBrowserWorkspacePhotometric) return;
    static constexpr const char* RigPrefix   = "photo-rig/";
    static constexpr const char* LightPrefix = "photo-light/";
    static constexpr const char* MoonPrefix  = "photo-moon/";
    static constexpr const char* IesMPrefix  = "photo-ies-m/";
    static constexpr const char* IesPPrefix  = "photo-ies-p/";
    // 📝 Rig ids are pinned from the HTML prototype, like the browser catalogue.
    static constexpr const char* RigIds[4] = { "roadway", "gallery", "studio", "lunar" };
    const char*                  Raw       = Link->OpenRecordId;
    if (std::strncmp(Raw, RigPrefix, std::strlen(RigPrefix)) == 0)
    {
        for (int I = 0; I < 4; ++I)
            if (std::strcmp(Raw + std::strlen(RigPrefix), RigIds[I]) == 0) ApplyPhotometricScenario(State, I);
    }
    else if (std::strncmp(Raw, LightPrefix, std::strlen(LightPrefix)) == 0)
    {
        const int Type = QueryPhotometricLightSpecById(Raw + std::strlen(LightPrefix));
        // 📝 The handoff refuses exactly like the old drawer key did.
        char Message[192]{};
        std::snprintf(Message, sizeof(Message), "Add %s refused",
                      Type >= 0 ? QueryPhotometricLightSpec(Type).Label : Raw);
        NoopPhotometricWorkspaceCommand(State, "ADD", Message, "Adding lights is a NOOP in this shell");
    }
    else if (std::strncmp(Raw, MoonPrefix, std::strlen(MoonPrefix)) == 0)
    {
        int Found = -1;
        for (int I = 0; I < QueryPhotometricMoonCount(); ++I)
            if (std::strcmp(QueryPhotometricMoon(I).Id, Raw + std::strlen(MoonPrefix)) == 0) Found = I;
        if (Found < 0)
        {
            char Message[192]{};
            std::snprintf(Message, sizeof(Message), "Asset \u201C%s\u201D is not a known moon.", Raw);
            AppendPhotometricWorkspaceLog(State, "MOON", Message);
        }
        else
        {
            State.Moon.Slot = Found;
            SelectPhotometricWorkspaceNode(State, PhotometricWorkspaceState::SelectedMoon);
            char Message[160]{};
            std::snprintf(Message, sizeof(Message), "Moon \u201C%s\u201D applied from the Asset Browser.",
                          QueryPhotometricMoon(Found).Name);
            AppendPhotometricWorkspaceLog(State, "MOON", Message);
        }
    }
    else if (std::strncmp(Raw, IesMPrefix, std::strlen(IesMPrefix)) == 0 ||
             std::strncmp(Raw, IesPPrefix, std::strlen(IesPPrefix)) == 0)
    {
        const bool Measured = std::strncmp(Raw, IesMPrefix, std::strlen(IesMPrefix)) == 0;
        const char* Name = Raw + (Measured ? std::strlen(IesMPrefix) : std::strlen(IesPPrefix));
        int Found = -1;
        const int Count = Measured ? QueryPhotometricMeasuredIesCount() : QueryPhotometricPresetIesCount();
        for (int I = 0; I < Count; ++I)
        {
            const char* Candidate = Measured ? QueryPhotometricMeasuredIes(I) : QueryPhotometricPresetIes(I);
            if (std::strcmp(Candidate, Name) == 0) Found = I;
        }
        if (Found >= 0)
        {
            // 📝 The handoff re-curves exactly like the old matrix tile did.
            int Target = -1;
            if (State.Selected >= 0 && State.Selected < 8 && State.Lights[State.Selected].Type == 2)
                Target = State.Selected;
            else
                for (int L = 0; L < 8; ++L)
                    if (State.Lights[L].Type == 2)
                    {
                        Target = L;
                        break;
                    }
            if (Target >= 0)
            {
                if (Measured)
                {
                    State.Lights[Target].Props.UseMeasuredIes  = true;
                    State.Lights[Target].Props.MeasuredProfile = Found;
                    State.Lights[Target].Props.CustomIesProfile = -1;
                }
                else
                {
                    State.Lights[Target].Props.UseMeasuredIes = false;
                    State.Lights[Target].Props.PresetProfile  = Found;
                    State.Lights[Target].Props.CustomIesProfile = -1;
                }
                SelectPhotometricWorkspaceNode(State, Target);
                char Message[192]{};
                std::snprintf(Message, sizeof(Message), "Assigned photometric curve \u201C%s\u201D from the Asset Browser to %s",
                              Name, State.Lights[Target].Name.c_str());
                AppendPhotometricWorkspaceLog(State, "IES", Message);
            }
            State.MatrixOpen = false;
        }
    }
    Link->ClearHandoff();
}

void ConstructPhotometricWorkspace(PhotometricWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Size,
                                   AssetBrowserLink* Link, const PhotometricViewportPresenter& Present, double DeltaSeconds)
{
    ApplyPhotometricWorkspaceLink(State, Link);
    State.Rects.clear();
    ImGui::SetNextWindowPos(ImVec2(0.0f, 0.0f));
    ImGui::SetNextWindowSize(Size);
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0x0B0B0BFF)));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    ImGui::Begin("##PhotometricWorkspace", nullptr,
                 ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoScrollbar |
                     ImGuiWindowFlags_NoScrollWithMouse);
    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor();
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();

    PanelCursor Root{ DrawList, &Faces, 1.0f, 12.0f, Size.x - 24.0f, 10.0f };
    ConstructTopBar(State, Root);

    const float WorkspaceY = Root.Y;
    const float WorkspaceH = Size.y - 10.0f - WorkspaceY;
    const float RailWide   = Size.x >= 1280.0f ? 296.0f : 256.0f;
    const float InspectorWide = Size.x >= 1280.0f ? 392.0f : 348.0f;
    const ImVec2 RailMin(12.0f, WorkspaceY);
    const ImVec2 RailMax(12.0f + RailWide, WorkspaceY + WorkspaceH);
    const ImVec2 InspectorMax(Size.x - 12.0f, WorkspaceY + WorkspaceH);
    const ImVec2 InspectorMin(InspectorMax.x - InspectorWide, WorkspaceY);
    const ImVec2 CentreMin(RailMax.x + 10.0f, WorkspaceY);
    const ImVec2 CentreMax(InspectorMin.x - 10.0f, WorkspaceY + WorkspaceH);

    ConstructOutlinerPanel(State, Faces, RailMin, RailMax, Link);
    ConstructAddDrawer(State, Faces, RailMin, RailWide, Link);

    // 📝 Centre column: stage plus transport, with the console drawer above the transport when open.
    constexpr float StripTall = 64.0f;
    const float ConsoleTall = State.ConsoleOpen ? 220.0f : 0.0f;
    const float ConsoleGap  = State.ConsoleOpen ? 10.0f : 0.0f;
    const ImVec2 StageMax(CentreMax.x, CentreMax.y - StripTall - 10.0f - ConsoleTall - ConsoleGap);
    DrawList->AddRectFilled(CentreMin, StageMax, ResolveCssColour(0x121212FF), 22.0f);
    // 📝 The HUD submits before the stage surface so its pills win the shared strip; the surface starts below
    //    row two so neither paints over the other.
    ConstructStageHud(State, Faces, DrawList, CentreMin, ImVec2(StageMax.x, CentreMin.y + 120.0f));
    const ImVec2 SurfaceMin(CentreMin.x, CentreMin.y + 46.0f);
    SceneViewportImage Preview;
    if (Present)
    {
        const ImGuiViewport* Viewport = ImGui::GetWindowViewport();
        const float Density = Viewport != nullptr ? Viewport->FramebufferScale.y : 1.0f;
        const SceneViewportRequest Request = BuildPhotometricPreviewRequest(State, StageMax.x - SurfaceMin.x,
                                                                                StageMax.y - SurfaceMin.y, Density, DeltaSeconds);
        Preview = Present(Request);
    }
    ConstructLightStage(State, Faces, DrawList, SurfaceMin, StageMax, Preview);
    DrawList->AddRect(CentreMin, StageMax, ResolveCssColour(0xFFFFFF0E), 22.0f, ImDrawFlags_None, 1.0f);

    if (State.ConsoleOpen)
        ConstructConsoleDrawer(State, Faces, ImVec2(CentreMin.x, StageMax.y + 10.0f),
                               ImVec2(CentreMax.x, StageMax.y + 10.0f + ConsoleTall));
    const ImVec2 StripMin(CentreMin.x, CentreMax.y - StripTall);
    DrawList->AddRectFilled(StripMin, CentreMax, ResolveCssColour(0x121212FF), 22.0f);
    ConstructTransportStrip(State, Faces, DrawList, StripMin, CentreMax);
    DrawList->AddRect(StripMin, CentreMax, ResolveCssColour(0xFFFFFF0E), 22.0f, ImDrawFlags_None, 1.0f);

    // 📝 Inspector panel: fixed header with the page between header and footer.
    DrawList->AddRectFilled(InspectorMin, InspectorMax, ResolveCssColour(0x121212FF), 22.0f);
    DrawList->AddRect(InspectorMin, InspectorMax, ResolveCssColour(0xFFFFFF0E), 22.0f, ImDrawFlags_None, 1.0f);
    PanelCursor Inspector{ DrawList, &Faces, 1.0f, InspectorMin.x, InspectorMax.x - InspectorMin.x, InspectorMin.y };
    const ImVec2 InspectorHead = Inspector.Space(44.0f);
    DrawList->AddLine(ImVec2(InspectorMin.x, InspectorHead.y + 44.0f), ImVec2(InspectorMax.x, InspectorHead.y + 44.0f),
                      ResolveCssColour(0xFFFFFF12));
    Inspector.Text(Faces.Light, 13.5f, InspectorMin.x + 16.0f, InspectorHead.y + 22.0f - 0.5f * 13.5f * 1.4f, 1.4f,
                   ResolveCssColour(0xDADADADA), "Inspector", -0.2f);
    const ImVec2 InspectorFootMin(InspectorMin.x, InspectorMax.y - 30.0f);
    DrawList->AddLine(ImVec2(InspectorMin.x, InspectorFootMin.y), ImVec2(InspectorMax.x, InspectorFootMin.y),
                      ResolveCssColour(0xFFFFFF12));

    ImGui::SetCursorScreenPos(ImVec2(InspectorMin.x, InspectorHead.y + 44.0f));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
    ImGui::BeginChild("##InspectorScroll", ImVec2(InspectorMax.x - InspectorMin.x, InspectorFootMin.y - InspectorHead.y - 44.0f),
                      false, ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
    {
        const ControlTheme Theme = ControlTheme::ResolveRemastered();
        ControlColumn Column(Theme, Faces, 1.0f, ImVec2(InspectorMin.x + 12.0f, InspectorHead.y + 44.0f + 12.0f),
                             InspectorMax.x - InspectorMin.x - 24.0f);
        ConstructPhotometricWorkspaceInspector(State, Faces, Column);
        Column.Finalize();
    }
    ImGui::EndChild();
    ImGui::PopStyleColor();

    ConstructIesMatrix(State, Faces, ImVec2(0.0f, 0.0f), Size, Link);
    ConstructLoadIesPopup(State);
    Toast::Construct();
    ImGui::End();
}

} // namespace Frontier
