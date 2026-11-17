/*==========================================================================================================================================
                                                          TEXTUREWORKSPACEHOST.CPP
==========================================================================================================================================*/
// 🧩 Portable half of the in-process Texture workspace host: panel activation, per-frame UI ticks, and catalogue-revision
//    publishing to the attached GPU backend. Mirrors the CPU wiring of the standalone Texture Workspace application
//    (Experimental/TextureStudio/Native/TextureStudioApplication.cpp); GPU construction and the seam lambdas live in
//    TextureWorkspaceHostVulkan.cpp.

#include "UI/Editor/TextureWorkspaceHost.h"

#include "Engine/ContentInterchange/MaterialLibrary.h"
#include "Engine/ContentInterchange/ProjectSpaceCodec.h"
#include "Engine/Diagnostics/DiagnosticJournal.h"
#include "Engine/Interface/IconPresentation.h"
#include "Engine/Interface/TypefaceRegistry.h"
#include "Engine/Lifecycle/ActivationSequence.h"
#include "UI/Editor/ControlCentrePanel.h"
#include "UI/TextureStudio/MaterialLibraryPanel.h"

#include <imgui.h>

#include <set>
#include <utility>

namespace Frontier
{

struct TextureWorkspaceHost::Implementation
{
    ActivationOwnership LibraryOwnership;
    MaterialLibraryPanel *Library = nullptr;
    TextureWorkspaceBackend *Backend = nullptr;
    float InterfaceScale = 1.0f;
    uint64_t RenderingRevision = 0;
    bool CloseLatched = false;
    std::string Diagnostic;
    ControlCentrePanel *Centre = nullptr;
    uint64_t ResetRevision = 0;
    bool LayoutBlocked = false;
    std::set<std::string> FaultedKeys;
    std::function<PlanePoint(PlanePoint)> NavigationEvaluator;

    void JournalOnce(const char *Key, const std::string &Message)
    {
        if (FaultedKeys.insert(Key).second) DiagnosticJournal::Append(Key, Message);
    }
};

TextureWorkspaceHost::TextureWorkspaceHost() : Impl(std::make_unique<Implementation>()) {}
TextureWorkspaceHost::~TextureWorkspaceHost() { Close(); }

bool TextureWorkspaceHost::Open(const std::filesystem::path &Folder, std::string *Refusal)
{
    const auto Fail = [&](const std::string &Message)
    {
        Impl->Diagnostic = Message;
        if (Refusal) *Refusal = Message;
        return false;
    };
    if (IsOpen()) Close();
    std::error_code Status;
    if (Folder.empty() || !std::filesystem::is_directory(Folder, Status) || Status)
        return Fail("The texture library folder could not be found.");
    Impl->LibraryOwnership.reset(new MaterialLibraryPanel());
    MaterialLibraryPanel *Library = static_cast<MaterialLibraryPanel *>(Impl->LibraryOwnership.get());
    Impl->Library = Library;
    Library->PresentIcon = [](IconSymbol Symbol, PlanePoint Point, float Size, ColorQuad Tint)
    {
        return IconPresentation::Draw(ImGui::GetWindowDrawList(), Symbol, ImVec2(Point.X, Point.Y), Size, ImGui::GetStyle().Alpha,
            IconDomain::Texture, ImGui::ColorConvertFloat4ToU32(ImVec4(Tint.Red, Tint.Green, Tint.Blue, Tint.Alpha)));
    };
    if (!Library->Initialize() || !Library->Activate())
    {
        Close();
        return Fail("The Material Library panel failed to activate.");
    }
    if (Impl->NavigationEvaluator) Library->EvaluateNavigationDelta = Impl->NavigationEvaluator;
    if (auto *Registry = TypefaceRegistry::QueryCurrent())
    {
        const int32_t Family = Registry->ResolveFamilyIndex("DM Sans");
        if (Family >= 0) Library->ConfigureTypeface(Registry->QueryHandle(uint32_t(Family), FontWeightCategory::Regular),
            Registry->QueryHandle(uint32_t(Family), FontWeightCategory::Light));
    }
    if (!Library->ConfigureDirectory(Folder))
    {
        const std::string Diagnostic = Library->QueryLibrary().QueryDiagnostic();
        Close();
        return Fail(Diagnostic.empty() ? "The texture library folder could not be read." : Diagnostic);
    }
    if (std::filesystem::is_regular_file(Folder / "racing-green.material", Status) && !Status)
        (void)Library->SelectMaterial("racing-green.material");
    Impl->RenderingRevision = 0;
    Impl->CloseLatched = false;
    Impl->Diagnostic.clear();
    return true;
}

void TextureWorkspaceHost::Close() noexcept
{
    DetachBackend();
    Impl->LibraryOwnership.reset();
    Impl->Library = nullptr;
    Impl->RenderingRevision = 0;
    Impl->CloseLatched = false;
}

bool TextureWorkspaceHost::IsOpen() const noexcept { return Impl->Library != nullptr; }

bool TextureWorkspaceHost::AttachBackend(TextureWorkspaceBackend *Backend) noexcept
{
    if (!IsOpen() || !Backend) return false;
    if (Backend == Impl->Backend) return true;
    if (Impl->Backend) return false;
    try
    {
        Backend->Bind(*Impl->Library);
    }
    catch (const std::exception &Failure)
    {
        Impl->Diagnostic = Failure.what();
        return false;
    }
    catch (...)
    {
        Impl->Diagnostic = "The texture workspace backend failed to bind.";
        return false;
    }
    Impl->Backend = Backend;
    return true;
}

void TextureWorkspaceHost::DetachBackend() noexcept
{
    if (Impl->Backend && Impl->Library) Impl->Backend->Unbind(*Impl->Library);
    Impl->Backend = nullptr;
}

TextureWorkspaceBackend *TextureWorkspaceHost::QueryBackend() const noexcept { return Impl->Backend; }

void TextureWorkspaceHost::Synchronize()
{
    if (!IsOpen()) return;
    if (Impl->Centre && Impl->ResetRevision != Impl->Centre->QueryLayoutResetRevision())
    {
        Impl->ResetRevision = Impl->Centre->QueryLayoutResetRevision();
        Impl->Library->QueryPanels().ResetLayout();
        Impl->LayoutBlocked = false;
    }
    Impl->Library->ConfigureInterfaceScale(Impl->InterfaceScale);
    Impl->Library->ConstructInterface();
    if (Impl->Library->ConsumeClose()) Impl->CloseLatched = true;
    if (!Impl->Backend) return;
    const auto &Catalogue = Impl->Library->QueryLibrary();
    if (Catalogue.QueryApplied() && Impl->RenderingRevision != Catalogue.QueryRevision())
    {
        // 📝 Consume the revision even on fault: retrying the identical material every frame would turn one bad
        //    input into an allocation storm (and pool exhaustion). Mirrors the standalone Material-branch tick.
        Impl->RenderingRevision = Catalogue.QueryRevision();
        try
        {
            Impl->Backend->PublishSelection(Catalogue.QuerySelection(), *Catalogue.QueryApplied());
        }
        catch (const std::exception &Failure) { Impl->JournalOnce("TextureWorkspaceSelection", Failure.what()); }
        catch (...) { Impl->JournalOnce("TextureWorkspaceSelection", "unknown selection-publish fault isolated"); }
    }
}

void TextureWorkspaceHost::ConstructWorkspaceCommands(void *Commands, uint64_t Completed, uint64_t Serial)
{
    if (Impl->Backend) Impl->Backend->ConstructCommands(Commands, Completed, Serial);
}

void TextureWorkspaceHost::ConfirmWorkspaceSubmission() noexcept
{
    if (Impl->Backend) Impl->Backend->ConfirmSubmission();
}

void TextureWorkspaceHost::ConfigureInterfaceScale(float Scale) noexcept { Impl->InterfaceScale = Scale; }

void TextureWorkspaceHost::ConfigureNavigation(std::function<PlanePoint(PlanePoint)> Evaluator)
{
    Impl->NavigationEvaluator = std::move(Evaluator);
    if (Impl->Library) Impl->Library->EvaluateNavigationDelta = Impl->NavigationEvaluator;
}

bool TextureWorkspaceHost::SelectMaterial(const std::filesystem::path &RelativePath)
{
    return IsOpen() ? Impl->Library->SelectMaterial(RelativePath) : false;
}

bool TextureWorkspaceHost::RequestClose()
{
    // 📝 The panel authorizes a clean close synchronously (true) and parks a dirty one behind its Unsaved-material
    //    popup (false); the popup decision arrives through ConsumeClose(), polled every Synchronize().
    if (!IsOpen()) return false;
    const bool Authorized = Impl->Library->RequestClose();
    if (Authorized) Impl->CloseLatched = true;
    return Authorized;
}

bool TextureWorkspaceHost::ConsumeCloseRequest() noexcept
{
    if (IsOpen() && Impl->Library->ConsumeClose()) Impl->CloseLatched = true;
    return std::exchange(Impl->CloseLatched, false);
}

void TextureWorkspaceHost::ConfigureControlCentre(ControlCentrePanel *Centre) noexcept
{
    Impl->Centre = Centre;
    if (Impl->Centre) Impl->ResetRevision = Impl->Centre->QueryLayoutResetRevision();
}

bool TextureWorkspaceHost::RestoreLayout(std::string &Diagnostic)
{
    Diagnostic.clear();
    if (!IsOpen()) { Diagnostic = "The texture workspace is not open."; return false; }
    if (!Impl->Centre) { Diagnostic = "The texture workspace has no control centre."; return false; }
    if (Impl->Library->QueryPanels().QuerySeated())
    {
        Diagnostic = "The texture layout is already seated; restore before the first frame.";
        return false;
    }
    const auto &Path = Impl->Centre->QueryPersonalProjectPath();
    if (Path.extension() != ".projectspace") return true;
    if (!std::filesystem::exists(Path)) return true;
    ProjectSpaceDocument Document;
    std::string Message;
    if (!ProjectSpaceCodec::Decode(Path, Document, Message))
    {
        Impl->LayoutBlocked = true;
        Diagnostic = "Texture layout read refused: " + Message;
        Impl->Centre->ConfigureLayoutDiagnostic("Texture layout read refused; defaults remain session-only. " + Message);
        return false;
    }
    const auto Saved = Document.Sections["workspace"][TextureWorkspaceLayoutKey];
    if (!Saved) return true;
    if (!Saved.is_table() || !Impl->Library->QueryPanels().ConfigureLayout(*Saved.as_table(), Message))
    {
        // 📝 A bad table is replaced on the next persist; only unreadable preferences block the session.
        Diagnostic = "Saved texture layout refused; defaults active, a replacement saves on close.";
        Impl->Centre->ConfigureLayoutDiagnostic(Diagnostic + (Message.empty() ? "" : " " + Message));
        return false;
    }
    return true;
}

bool TextureWorkspaceHost::PersistLayout(std::string &Message)
{
    Message.clear();
    if (!IsOpen()) { Message = "The texture workspace is not open."; return false; }
    if (!Impl->Centre) { Message = "The texture workspace has no control centre."; return false; }
    if (Impl->LayoutBlocked) { Message = "Texture layout save refused: preferences are unreadable."; return false; }
    if (Impl->Centre->QueryPersonalProjectPath().extension() != ".projectspace") return true;
    if (!Impl->Library->QueryPanels().QuerySeated()) return true;
    const auto Layout = Impl->Library->QueryPanels().EncodeLayout();
    if (Layout.empty()) return true;
    return Impl->Centre->PersistWorkspaceLayout(Layout, Message, TextureWorkspaceLayoutKey);
}

void TextureWorkspaceHost::ConfigurePlatform()
{
    if (!IsOpen()) return;
    if (Impl->Centre) Impl->Library->QueryPanels().ConfigureDetachedWindows(Impl->Centre->QueryDetachedWindows());
    Impl->Library->ConfigurePlatform();
}

void TextureWorkspaceHost::RecoverPlatformWindows()
{
    if (IsOpen()) Impl->Library->QueryPanels().RecoverPlatformWindows();
}

TextureWorkspaceState TextureWorkspaceHost::QueryState() const
{
    TextureWorkspaceState State;
    State.Open = IsOpen();
    State.BackendBound = Impl->Backend != nullptr;
    State.CloseRequested = Impl->CloseLatched;
    if (!IsOpen()) return State;
    const auto &Catalogue = Impl->Library->QueryLibrary();
    State.EntryCount = Catalogue.QueryEntries().size();
    State.Revision = Catalogue.QueryRevision();
    State.Selection = DiagnosticJournal::EncodePath(Catalogue.QuerySelection());
    return State;
}

std::string TextureWorkspaceHost::QueryDiagnostic() const { return Impl->Diagnostic; }

} // namespace Frontier
