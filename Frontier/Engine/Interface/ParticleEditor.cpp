/*==========================================================================================================================================
                                                        PARTICLEEDITOR.CPP
==========================================================================================================================================*/
// 🧩 The Particle editor window: a title bar with the live readout, the space's file and Close, and the editor's columns below;
//    the record's .particlespace is attached when the window opens and written back when it closes.

#include "Engine/Interface/ParticleEditor.h"

#if FRONTIER_EDITOR && defined(FRONTIER_WITH_INTERFACE_SDK)

#include "Engine/Interface/ContentDirectory.h"
#include "Engine/Interface/InspectorControls.h"
#include "Engine/Interface/InspectorRuntime.h"
#include "Engine/Interface/ParticleEditor/ParticleEditorWorkspace.h"
#include "Engine/Interface/ProjectContent.h"
#include "Engine/Scene/SceneDirectory.h"

#include <algorithm>
#include <cstdio>
#include <filesystem>
#include <memory>

namespace Frontier
{

namespace
{

// 📝 The library beside the executable (EngineContent/ParticleArchives), whatever the working folder: an editor opened through
//    Windows' Open with starts in the document's folder.
std::filesystem::path ResolveLibraryFile()
{
    const std::filesystem::path Primary  = std::filesystem::path("ParticleArchives") / "ParticleLibrary.particlespace";
    const std::filesystem::path Fallback = std::filesystem::path("ParticleArchives") / "ParticleLibrary.toml";
    const std::filesystem::path Engine   = QueryEngineContentDirectory();
    std::error_code             Failure;
    if (!Engine.empty() && std::filesystem::is_regular_file(Engine / Primary, Failure)) return Engine / Primary;
    if (!Engine.empty() && std::filesystem::is_regular_file(Engine / Fallback, Failure)) return Engine / Fallback;
    const std::filesystem::path ResolvedPrimary = ResolveContentDirectory("EngineContent") / Primary;
    if (std::filesystem::is_regular_file(ResolvedPrimary, Failure)) return ResolvedPrimary;
    return ResolveContentDirectory("EngineContent") / Fallback;
}

std::unique_ptr<ParticleEditorWorkspace>& ResolveWorkspace()
{
    static std::unique_ptr<ParticleEditorWorkspace> Workspace;
    if (!Workspace) Workspace = std::make_unique<ParticleEditorWorkspace>(ResolveLibraryFile());
    return Workspace;
}

} // namespace

ParticleEditorWorkspace* ParticleEditor::AccessWorkspace()
{
    return ResolveWorkspace().get();
}

bool ParticleEditor::SaveSpace()
{
    return ResolveWorkspace()->SaveSpaceFile();
}

std::string ParticleEditor::NameSpaceFile(const std::filesystem::path& LevelFile, const std::string& RecordName)
{
    std::string Name = LevelFile.stem().string() + "." + RecordName;
    for (char& Letter : Name)
    {
        const bool Kept = (Letter >= 'a' && Letter <= 'z') || (Letter >= 'A' && Letter <= 'Z') || (Letter >= '0' && Letter <= '9') || Letter == '-' ||
                          Letter == '_' || Letter == '.';
        if (!Kept) Letter = '_';
    }
    return Name + ".particlespace";
}

std::filesystem::path ParticleEditor::ResolveSpaceFile(const ParticleConfiguration& Parameters)
{
    const std::filesystem::path& Level = InspectorRuntime::Instance().QueryLevelFile();
    if (Level.empty() || Parameters.SpaceFile.empty()) return {};
    return Level.parent_path() / DecodeUtf8Path(Parameters.SpaceFile);
}

void ParticleEditor::ConstructInterface(RecordToken Token, ParticleConfiguration& Parameters)
{
    ParticleEditorWorkspace& Workspace = *ResolveWorkspace();
    InspectorRuntime&        Runtime   = InspectorRuntime::Instance();
    Workspace.Presenter                = Runtime.QueryParticleViewportPresenter();
    Workspace.LevelFieldSampler        = [] { return InspectorRuntime::Instance().AcquireLevelFieldSampler(); };
    Workspace.LevelFieldAvailable       = static_cast<bool>(Runtime.QueryLevelFieldSamplerProvider());

    // 📝 The record's space: named on first use (the level then saves the name), read or created beside the level.
    if (!Runtime.QueryLevelFile().empty())
    {
        if (Parameters.SpaceFile.empty())
        {
            Parameters.SpaceFile = NameSpaceFile(Runtime.QueryLevelFile(), SceneDirectory::Instance().QueryName(Token));
            Parameters.AdvanceRevision();
        }
        const std::filesystem::path File = ResolveSpaceFile(Parameters);
        if (Workspace.QuerySpaceFile() != File) (void)Workspace.AttachSpaceFile(File);
    }

    const InspectorPalette Palette = InspectorPalette::Resolve();
    const EditorTypefaces  Faces   = EditorTypefaces::Resolve();
    const float            Scale   = Runtime.ResolveInterfaceScale();
    const ImGuiViewport*   Main    = ImGui::GetMainViewport();
    const ImVec2           Margin(28.0f * Scale, 24.0f * Scale);
    const ImVec2           Position(Main->WorkPos.x + Margin.x, Main->WorkPos.y + Margin.y);
    const ImVec2           Size(std::max(1100.0f, Main->WorkSize.x - Margin.x * 2.0f), std::max(640.0f, Main->WorkSize.y - Margin.y * 2.0f));

    // 📝 A modal popup: it stays above the workspace, dims it and keeps the pointer from the panels behind it, as long as the
    //    record's editor is the active one.
    constexpr const char* WindowName = "##ParticleEditorWindow";
    if (!ImGui::IsPopupOpen(WindowName)) ImGui::OpenPopup(WindowName);
    ImGui::SetNextWindowPos(Position, ImGuiCond_Always);
    ImGui::SetNextWindowSize(Size, ImGuiCond_Always);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 16.0f * Scale);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    ImGui::PushStyleColor(ImGuiCol_PopupBg, ImGui::ColorConvertU32ToFloat4(Palette.ViewportBg));
    ImGui::PushStyleColor(ImGuiCol_ModalWindowDimBg, ImVec4(0.02f, 0.02f, 0.03f, 0.55f));
    const bool Shown = ImGui::BeginPopupModal(WindowName, nullptr,
                                              ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings |
                                                  ImGuiWindowFlags_NoScrollWithMouse);
    ImGui::PopStyleColor(2);
    ImGui::PopStyleVar(3);
    if (Shown)
    {
        ImDrawList* Ink    = ImGui::GetWindowDrawList();
        const float Header = 50.0f * Scale;
        Ink->AddRect(Position, ImVec2(Position.x + Size.x, Position.y + Size.y), Palette.EdgeBorder, 16.0f * Scale, 0, 1.5f);
        Ink->AddRectFilled(Position, ImVec2(Position.x + Size.x, Position.y + Header), Palette.InspectorTopBg, 16.0f * Scale, ImDrawFlags_RoundCornersTop);
        Ink->AddLine(ImVec2(Position.x, Position.y + Header), ImVec2(Position.x + Size.x, Position.y + Header), Palette.EdgeBorder, 1.0f);
        ConstructEditorGlyph(Ink, ImVec2(Position.x + 24.0f * Scale, Position.y + 25.0f * Scale), 8.0f * Scale, Palette.ThemeAccent, "Sparkles", 1.5f);
        Ink->AddText(Faces.Medium, 14.0f * Scale, ImVec2(Position.x + 42.0f * Scale, Position.y + 16.5f * Scale), Palette.TextPrimary, "Frontier \xC2\xB7 Particle editor");
        char Readout[256];
        const std::string File = Workspace.QuerySpaceFile().empty() ? std::string("no level file") : Workspace.QuerySpaceFile().filename().string();
        std::snprintf(Readout, sizeof(Readout), "LIVE \xC2\xB7 %s \xC2\xB7 %zu EFFECTS \xC2\xB7 %zu FIELDS \xC2\xB7 %s%s", SceneDirectory::Instance().QueryName(Token).c_str(),
                      Workspace.AccessSpace().Effects.size(), Workspace.AccessSpace().Fields.size(), File.c_str(), Workspace.QuerySpaceChanged() ? " \xC2\xB7 UNSAVED" : "");
        Ink->AddText(Faces.Monospace, 10.5f * Scale, ImVec2(Position.x + 300.0f * Scale, Position.y + 19.5f * Scale), Palette.LiveGreen, Readout);
        const float  CloseW = 108.0f * Scale;
        const ImVec2 CloseMin(Position.x + Size.x - CloseW - 14.0f * Scale, Position.y + 10.0f * Scale);
        ImGui::SetCursorScreenPos(CloseMin);
        const bool Closing = ImGui::InvisibleButton("##CloseParticleEditor", ImVec2(CloseW, 30.0f * Scale));
        const bool Hovered = ImGui::IsItemHovered();
        Ink->AddRectFilled(CloseMin, ImVec2(CloseMin.x + CloseW, CloseMin.y + 30.0f * Scale), Hovered ? Palette.SegmentedActiveBg : Palette.CountCardBg, 9.0f * Scale);
        Ink->AddRect(CloseMin, ImVec2(CloseMin.x + CloseW, CloseMin.y + 30.0f * Scale), Palette.InsetFieldBorder, 9.0f * Scale);
        Ink->AddText(Faces.Medium, 11.0f * Scale, ImVec2(CloseMin.x + 18.0f * Scale, CloseMin.y + 8.5f * Scale), Palette.TextPrimary, "Close Editor");

        const ImVec2 BodyMin(Position.x + 12.0f * Scale, Position.y + Header + 12.0f * Scale);
        const ImVec2 BodyMax(Position.x + Size.x - 12.0f * Scale, Position.y + Size.y - 12.0f * Scale);
        Workspace.Construct(BodyMin, BodyMax, Scale, ImGui::GetIO().DeltaTime);
        if (Closing)
        {
            (void)Workspace.SaveSpaceFile();
            ImGui::CloseCurrentPopup();
            Runtime.CloseActiveEditor();
        }
        ImGui::EndPopup();
    }
}

} // namespace Frontier

#elif FRONTIER_EDITOR

namespace Frontier
{
void ParticleEditor::ConstructInterface(RecordToken, ParticleConfiguration&) {}
ParticleEditorWorkspace* ParticleEditor::AccessWorkspace() { return nullptr; }
bool ParticleEditor::SaveSpace() { return false; }
std::filesystem::path ParticleEditor::ResolveSpaceFile(const ParticleConfiguration&) { return {}; }
std::string ParticleEditor::NameSpaceFile(const std::filesystem::path&, const std::string&) { return {}; }
} // namespace Frontier

#endif
