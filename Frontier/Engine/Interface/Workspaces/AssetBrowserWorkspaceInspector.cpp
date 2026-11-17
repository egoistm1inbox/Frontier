/*==========================================================================================================================================
                                                      ASSETBROWSERWORKSPACEINSPECTOR.CPP
==========================================================================================================================================*/
// 🧩 The Asset Browser inspector: hero glyph with kind badge, name, folder path, blurb, meta table, tag pills that
//    feed the search field, and the workspace actions. Open in <workspace> hands the record to the owning shell
//    through the shared AssetBrowserLink; Add to scene is an honest NOOP (toast + log, nothing staged).

#include "Frontier/Engine/Interface/Workspaces/AssetBrowserWorkspace.h"

#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/Controls/GlyphSymbol.h"
#include "Engine/Interface/Controls/Toast.h"
#include "Frontier/Engine/Interface/Controls/ControlTheme.h"
#include "Frontier/Engine/Interface/InspectorControls.h"

#include <algorithm>
#include <cstdio>
#include <cstring>

namespace Frontier
{
namespace
{

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
    if (Max.x <= Min.x || Max.y <= Min.y) return false;
    ImGui::SetCursorScreenPos(Min);
    return ImGui::InvisibleButton(Id, ImVec2(Max.x - Min.x, Max.y - Min.y));
}

void HandToWorkspace(AssetBrowserWorkspaceState& State, AssetBrowserLink* Link, int Index)
{
    const AssetBrowserRecord& Record = QueryAssetBrowserRecord(Index);
    if (Link != nullptr)
    {
        std::snprintf(Link->OpenRecordId, sizeof(Link->OpenRecordId), "%s", Record.Id.c_str());
        Link->OpenRecordWorkspace = Record.WorkspaceIndex;
    }
    char Message[192]{};
    std::snprintf(Message, sizeof(Message), "Handed “%s” to %s", Record.Name.c_str(), Record.Workspace.c_str());
    AppendAssetBrowserWorkspaceLog(State, "OPEN", Message, Record.Id.c_str());
    Toast::Show(Message);
}

} // namespace

void ConstructAssetBrowserInspector(AssetBrowserWorkspaceState& State, const EditorTypefaces& Faces,
                                    ImDrawList* DrawList, ImVec2 Min, ImVec2 Max, AssetBrowserLink* Link)
{
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x101010FF), 14.0f);
    ImGui::SetCursorScreenPos(Min);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::BeginChild("##AssetInspector", ImVec2(Max.x - Min.x, Max.y - Min.y), false,
                      ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoDecoration);
    const ImVec2 Origin = ImGui::GetCursorScreenPos();
    PanelCursor  Col{ DrawList, &Faces, 1.0f, Origin.x + 14.0f,
                      (Max.x - Min.x) - 28.0f - ImGui::GetStyle().ScrollbarSize, Origin.y + 12.0f };
    const int    Selected = State.Selected;
    if (Selected < 0 || Selected >= QueryAssetBrowserRecordCount())
    {
        Col.Text(Faces.Medium, 12.0f, Col.X, Col.Y, 1.3f, ResolveCssColour(0x6E6E6EFF), "Inspector");
        Col.Text(Faces.Regular, 11.5f, Col.X, Col.Y + 26.0f, 1.4f, ResolveCssColour(0x8A8A8AFF),
                 "Pick any card or row to preview its metadata, tags, and workspace actions here.");
        ImGui::EndChild();
        ImGui::PopStyleVar();
        return;
    }
    const AssetBrowserRecord& Record = QueryAssetBrowserRecord(Selected);
    const ImU32               Accent = ResolveCssColour(Record.Colour);

    const ImVec2 HeroMin = Col.Space(120.0f);
    const ImVec2 HeroMax(HeroMin.x + Col.Width, HeroMin.y + 120.0f);
    DrawList->AddRectFilled(HeroMin, HeroMax, ResolveAlpha(Accent, 0.12f), 12.0f);
    DrawList->AddRect(HeroMin, HeroMax, ResolveCssColour(0xFFFFFF14), 12.0f, ImDrawFlags_None, 1.0f);
    (void)GlyphSymbol::Construct(DrawList, Record.Glyph.c_str(),
                                 ImVec2(HeroMin.x + (Col.Width - 52.0f) * 0.5f, HeroMin.y + 30.0f), 52.0f, 1.6f,
                                 Accent);
    PanelCursor Badge{ DrawList, &Faces, 1.0f, HeroMin.x, Col.Width, HeroMin.y };
    const float KindWide = Badge.Measure(Faces.Medium, 10.5f, Record.Kind.c_str()) + 20.0f;
    DrawList->AddRectFilled(ImVec2(HeroMax.x - KindWide - 10.0f, HeroMax.y - 30.0f),
                            ImVec2(HeroMax.x - 10.0f, HeroMax.y - 8.0f), ResolveCssColour(0x000000AA), 11.0f);
    Badge.Text(Faces.Medium, 10.5f, HeroMax.x - KindWide, HeroMax.y - 28.0f, 1.3f, Accent, Record.Kind.c_str());

    const ImVec2 NameMin = Col.Space(30.0f, 10.0f, 0.0f);
    Col.Text(Faces.Medium, 17.0f, NameMin.x, NameMin.y, 1.3f, ResolveCssColour(0xF2F2F2FF), Record.Name.c_str());
    const ImVec2 PathMin = Col.Space(20.0f);
    Col.Text(Faces.Regular, 11.0f, PathMin.x, PathMin.y, 1.3f, ResolveCssColour(0x8A8A8AFF), Record.Folder.c_str());
    const ImVec2 BlurbMin = Col.Space(44.0f, 2.0f, 0.0f);
    Col.Text(Faces.Regular, 11.5f, BlurbMin.x, BlurbMin.y, 1.4f, ResolveCssColour(0xB5B5B5FF), Record.Blurb.c_str());

    for (const AssetBrowserMeta& Meta : Record.Meta)
    {
        const ImVec2 RowMin = Col.Space(22.0f);
        DrawList->AddLine(ImVec2(RowMin.x, RowMin.y + 21.0f), ImVec2(RowMin.x + Col.Width, RowMin.y + 21.0f),
                          ResolveCssColour(0xFFFFFF0C), 1.0f);
        Col.Text(Faces.Medium, 11.0f, RowMin.x, RowMin.y + 3.0f, 1.3f, ResolveCssColour(0x8A8A8AFF), Meta.Key.c_str());
        const float ValueX = RowMin.x + 110.0f;
        Col.Text(Faces.Regular, 11.0f, ValueX, RowMin.y + 3.0f, 1.3f, ResolveCssColour(0xD8D8D8FF),
                 Meta.Value.c_str());
    }

    if (!Record.Tags.empty())
    {
        const ImVec2 TagMin = Col.Space(30.0f, 8.0f, 0.0f);
        float        X      = TagMin.x;
        int          Ordinal = 0;
        for (const std::string& Tag : Record.Tags)
        {
            char Label[56]{};
            std::snprintf(Label, sizeof(Label), "#%s", Tag.c_str());
            const float Wide = Col.Measure(Faces.Medium, 10.5f, Label) + 18.0f;
            if (X + Wide > TagMin.x + Col.Width) break;
            const ImVec2 PMin(X, TagMin.y);
            const ImVec2 PMax(X + Wide, TagMin.y + 24.0f);
            DrawList->AddRectFilled(PMin, PMax, ResolveCssColour(0xFFFFFF0D), 12.0f);
            DrawList->AddRect(PMin, PMax, ResolveCssColour(0xFFFFFF1A), 12.0f, ImDrawFlags_None, 1.0f);
            Col.Text(Faces.Medium, 10.5f, X + 9.0f, TagMin.y + 4.0f, 1.3f, Accent, Label);
            if (Ordinal == 0) RecordAssetBrowserWorkspaceRect(State, "Inspector/Tag0", PMin, PMax);
            ImGui::PushID(Ordinal++);
            const bool Pressed = InvisibleRect("##Tag", PMin, PMax);
            ImGui::PopID();
            if (Pressed)
            {
                std::snprintf(State.SearchText, sizeof(State.SearchText), "%s", Tag.c_str());
                State.Folder = "all";
            }
            X += Wide + 8.0f;
        }
    }

    const bool Fav = std::find(State.Favorites.begin(), State.Favorites.end(), Selected) != State.Favorites.end();
    char       OpenLabel[96]{};
    std::snprintf(OpenLabel, sizeof(OpenLabel), "Open in %s", Record.Workspace.c_str());
    const ImVec2 OpenMin = Col.Space(40.0f, 12.0f, 0.0f);
    const ImVec2 OpenMax(OpenMin.x + Col.Width, OpenMin.y + 40.0f);
    DrawList->AddRectFilled(OpenMin, OpenMax, ResolveCssColour(0xE8C27AFF), 10.0f);
    const float OpenWide = Col.Measure(Faces.Medium, 13.0f, OpenLabel);
    Col.Text(Faces.Medium, 13.0f, OpenMin.x + (Col.Width - OpenWide) * 0.5f, OpenMin.y + 10.0f, 1.3f,
             ResolveCssColour(0x221A08FF), OpenLabel);
    RecordAssetBrowserWorkspaceRect(State, "Inspector/Open", OpenMin, OpenMax);
    if (InvisibleRect("##InspOpen", OpenMin, OpenMax)) HandToWorkspace(State, Link, Selected);

    const ImVec2 SubMin   = Col.Space(34.0f, 8.0f, 0.0f);
    const float  HalfWide = (Col.Width - 8.0f) * 0.5f;
    const ImVec2 AddMax(SubMin.x + HalfWide, SubMin.y + 34.0f);
    DrawList->AddRectFilled(SubMin, AddMax, ResolveCssColour(0xFFFFFF0D), 10.0f);
    DrawList->AddRect(SubMin, AddMax, ResolveCssColour(0xFFFFFF1A), 10.0f, ImDrawFlags_None, 1.0f);
    const float AddWide = Col.Measure(Faces.Medium, 11.5f, "Add to scene");
    Col.Text(Faces.Medium, 11.5f, SubMin.x + (HalfWide - AddWide) * 0.5f, SubMin.y + 8.0f, 1.3f,
             ResolveCssColour(0xB5B5B5FF), "Add to scene");
    RecordAssetBrowserWorkspaceRect(State, "Inspector/Add", SubMin, AddMax);
    if (InvisibleRect("##InspAdd", SubMin, AddMax))
    {
        char Message[192]{};
        std::snprintf(Message, sizeof(Message), "“%s” would stage into the scene", Record.Name.c_str());
        AppendAssetBrowserWorkspaceLog(State, "NOOP", Message, Record.Id.c_str());
        Toast::Show(Message);
    }
    const ImVec2 FavMin(SubMin.x + HalfWide + 8.0f, SubMin.y);
    const ImVec2 FavMax(FavMin.x + HalfWide, SubMin.y + 34.0f);
    DrawList->AddRectFilled(FavMin, FavMax, Fav ? ResolveCssColour(0xE8C27A33) : ResolveCssColour(0xFFFFFF0D), 10.0f);
    DrawList->AddRect(FavMin, FavMax, ResolveCssColour(Fav ? 0xE8C27A88 : 0xFFFFFF1A), 10.0f, ImDrawFlags_None, 1.0f);
    const char* FavLabel = Fav ? "* Favorited" : "+ Favorite";
    const float FavWide  = Col.Measure(Faces.Medium, 11.5f, FavLabel);
    Col.Text(Faces.Medium, 11.5f, FavMin.x + (HalfWide - FavWide) * 0.5f, FavMin.y + 8.0f, 1.3f,
             Fav ? ResolveCssColour(0xE8C27AFF) : ResolveCssColour(0xB5B5B5FF), FavLabel);
    RecordAssetBrowserWorkspaceRect(State, "Inspector/Fav", FavMin, FavMax);
    if (InvisibleRect("##InspFav", FavMin, FavMax)) ToggleAssetBrowserFavorite(State, Selected);

    int Related = 0;
    for (int I = 0; I < QueryAssetBrowserRecordCount() && Related < 4; ++I)
    {
        if (I == Selected) continue;
        const AssetBrowserRecord& Other = QueryAssetBrowserRecord(I);
        if (Other.Folder != Record.Folder) continue;
        if (Related == 0)
        {
            const ImVec2 TitleMin = Col.Space(24.0f, 12.0f, 0.0f);
            char Title[96]{};
            const char* Leaf = std::strchr(Record.Folder.c_str(), '/');
            std::snprintf(Title, sizeof(Title), "More in %s", Leaf != nullptr ? Leaf + 1 : Record.Folder.c_str());
            Col.Text(Faces.Medium, 11.0f, TitleMin.x, TitleMin.y + 4.0f, 1.3f, ResolveCssColour(0x8A8A8AFF), Title);
        }
        const ImVec2 RMin = Col.Space(30.0f, 0.0f, 2.0f);
        const ImVec2 RMax(RMin.x + Col.Width, RMin.y + 30.0f);
        DrawList->AddRectFilled(RMin, RMax, ResolveCssColour(0xFFFFFF08), 8.0f);
        DrawList->AddRect(RMin, RMax, ResolveCssColour(0xFFFFFF0C), 8.0f, ImDrawFlags_None, 1.0f);
        (void)GlyphSymbol::Construct(DrawList, Other.Glyph.c_str(), ImVec2(RMin.x + 8.0f, RMin.y + 8.0f), 14.0f, 1.8f,
                                     ResolveCssColour(Other.Colour));
        Col.Text(Faces.Regular, 11.0f, RMin.x + 30.0f, RMin.y + 7.0f, 1.3f, ResolveCssColour(0xD8D8D8FF),
                 Other.Name.c_str());
        if (Related == 0) RecordAssetBrowserWorkspaceRect(State, "Inspector/Rel0", RMin, RMax);
        ImGui::PushID(100 + Related);
        const bool Pressed = InvisibleRect("##Related", RMin, RMax);
        ImGui::PopID();
        if (Pressed)
        {
            State.Folder = Other.Folder;
            SelectAssetBrowserRecord(State, I);
        }
        ++Related;
    }
    char Footer[128]{};
    std::snprintf(Footer, sizeof(Footer), "%s", Record.Id.c_str());
    const ImVec2 FootMin = Col.Space(22.0f, 10.0f, 0.0f);
    Col.Text(Faces.Regular, 10.0f, FootMin.x, FootMin.y + 4.0f, 1.3f, ResolveCssColour(0x6E6E6EFF), Footer);
    ImGui::SetCursorPos(ImVec2(0.0f, Col.Y - Origin.y + 12.0f));
    ImGui::Dummy(ImVec2(1.0f, 1.0f));
    ImGui::EndChild();
    ImGui::PopStyleVar();
}

} // namespace Frontier
