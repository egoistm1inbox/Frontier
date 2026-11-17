// Texture Workspace host validation: in-process open/close of a material library folder through TextureWorkspaceHost,
// backend attach/detach protocol (fake GPU backend), revision-driven selection publishing, close-request flow, and PPM
// evidence. Headless: no Vulkan device, no window; the null-backend seams stay unbound and the panels still draw.

#include "UI/Editor/TextureWorkspaceHost.h"
#include "UI/Editor/ControlCentrePanel.h"
#include "UI/TextureStudio/MaterialLibraryPanel.h"
#include "Engine/ContentInterchange/ProjectSpaceCodec.h"
#include "Engine/Interface/TypefaceRegistry.h"
#include "Exhibits/ControlCentre/Code/CpuRasterization.h"

#include <imgui.h>

#include <algorithm>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace
{

void Confirm(bool Condition, const char* Description)
{
    if (!Condition) throw std::runtime_error(Description);
}

// 🧪 Fake GPU backend: records the host protocol (bind/unbind/publish/record/confirm) and proves the panel reaches the
//    seams by counting thumbnail queries issued during real frame ticks.
struct FakeTextureBackend : Frontier::TextureWorkspaceBackend
{
    int Binds = 0, Unbinds = 0, Publishes = 0, Records = 0, Confirms = 0, ThumbnailQueries = 0;
    bool ThrowOnBind = false;
    std::filesystem::path LastPublishedSelection;

    void Bind(Frontier::MaterialLibraryPanel& Library) override
    {
        if (ThrowOnBind) throw std::runtime_error("fake bind fault");
        ++Binds;
        Library.QueryThumbnail = [this](const std::filesystem::path&)
        {
            ++ThumbnailQueries;
            return Frontier::MaterialPreviewImage{};
        };
    }
    void Unbind(Frontier::MaterialLibraryPanel& Library) noexcept override
    {
        ++Unbinds;
        Library.QueryThumbnail = {};
    }
    void PublishSelection(const std::filesystem::path& Selection, const Frontier::CompiledSurfaceMaterial&) override
    {
        ++Publishes;
        LastPublishedSelection = Selection;
    }
    void ConstructCommands(void*, uint64_t, uint64_t) override { ++Records; }
    void ConfirmSubmission() noexcept override { ++Confirms; }
};

} // namespace

int main(int ArgumentCount, char** Arguments)
{
    using namespace Frontier;
    try
    {
        ImGui::CreateContext();
        ImGui::StyleColorsDark();
        ImGuiIO& IO = ImGui::GetIO();
        IO.DisplaySize = ImVec2(1560.0f, 1000.0f);
        IO.DeltaTime = 1.0f / 60.0f;
        // The Vulkan backend reports RendererHasTextures, so the font atlas never locks; mirror that headless or
        // fonts added after the first frame (ControlCentre registries) cannot bake sizes and crash text rendering.
        IO.BackendFlags |= ImGuiBackendFlags_RendererHasTextures;
        TypefaceRegistry   FontRegistry;
        static const char* WantedFonts[] = { "DM Sans", "JetBrains Mono" };
        const char*        ArchiveRoot   = ArgumentCount >= 3 ? Arguments[2] : "EngineContent/FontArchives";
        const uint32_t     FontFamilies  = FontRegistry.Load(ArchiveRoot, WantedFonts, 2);
        if (ArgumentCount >= 3) Confirm(FontFamilies == 2, "The font archive root did not yield DM Sans and JetBrains Mono");
        if (FontFamilies == 0) IO.Fonts->AddFontDefault();
        else TypefaceRegistry::Install(&FontRegistry);
        IO.Fonts->Build();

        // 0. A two-material scratch library copied from the shipped archives.
        const char* MaterialRoot = ArgumentCount >= 4 ? Arguments[3] : "EngineContent/MaterialArchives/TextureStudio";
        std::vector<std::filesystem::path> Shipped;
        for (const auto& Entry : std::filesystem::directory_iterator(MaterialRoot))
            if (Entry.is_regular_file() && Entry.path().extension() == ".material") Shipped.push_back(Entry.path());
        std::sort(Shipped.begin(), Shipped.end());
        Confirm(Shipped.size() >= 2, "The material archive root did not yield two .material files");
        const std::filesystem::path Scratch = std::filesystem::temp_directory_path() / "TextureWorkspaceHostValidation";
        std::error_code Status;
        std::filesystem::remove_all(Scratch, Status);
        std::filesystem::create_directories(Scratch, Status);
        Confirm(!Status, "The scratch library folder could not be created");
        const std::filesystem::path First = Shipped[0].filename(), Second = Shipped[1].filename();
        const std::filesystem::path Staged[] = { Shipped[0], Shipped[1] };
        for (const auto& Source : Staged)
        {
            std::filesystem::copy_file(Source, Scratch / Source.filename(), Status);
            Confirm(!Status, "A scratch material could not be staged");
            // The material compiles its referenced maps at open, so each staged material carries its Textures/ files.
            std::ifstream MaterialText(Source);
            const std::string MaterialSource((std::istreambuf_iterator<char>(MaterialText)), std::istreambuf_iterator<char>());
            for (size_t Found = MaterialSource.find("\"Textures/"); Found != std::string::npos;
                 Found = MaterialSource.find("\"Textures/", Found + 1))
            {
                const size_t End = MaterialSource.find('"', Found + 1);
                Confirm(End != std::string::npos, "A staged material held a truncated texture reference");
                const std::filesystem::path Reference(MaterialSource.substr(Found + 1, End - Found - 1));
                std::filesystem::create_directories(Scratch / Reference.parent_path(), Status);
                std::filesystem::copy_file(std::filesystem::path(MaterialRoot) / Reference, Scratch / Reference, Status);
                Confirm(!Status, "A staged material map could not be staged");
            }
        }

        TextureWorkspaceHost Host;
        FakeTextureBackend Fake, SecondFake;

        // 1. Refusals: missing folder and file-as-folder open nothing and explain why.
        Confirm(!Host.IsOpen(), "The host opened before Open");
        std::string Refusal;
        Confirm(!Host.Open(Scratch / "missing-folder", &Refusal), "Open accepted a missing folder");
        Confirm(!Refusal.empty(), "A missing folder carried no refusal");
        Confirm(!Host.IsOpen(), "A refused open left the host open");
        Confirm(!Host.QueryState().Open, "A refused open probed open");
        Confirm(!Host.QueryDiagnostic().empty(), "A refused open kept no diagnostic");
        Confirm(!Host.Open(Scratch / First, &Refusal), "Open accepted a material file as a folder");
        Confirm(!Host.SelectMaterial(First), "Select reached a closed host");
        Confirm(!Host.RequestClose(), "RequestClose reached a closed host");

        // 2. Attach before open fails; the host stays unbound.
        Confirm(!Host.AttachBackend(&Fake), "Attach reached a closed host");
        Confirm(Host.QueryBackend() == nullptr, "A refused attach left a backend behind");
        Confirm(Fake.Binds == 0, "A refused attach bound the backend");

        // 3. Open stages the catalogue; selection probes through the state snapshot.
        Confirm(Host.Open(Scratch, &Refusal), ("Open refused the scratch library: " + Refusal).c_str());
        Confirm(Host.IsOpen(), "Open did not open the host");
        Confirm(Host.QueryBackend() == nullptr, "Open bound a backend by itself");
        TextureWorkspaceState State = Host.QueryState();
        Confirm(State.Open && !State.BackendBound, "The open snapshot misreported the host");
        Confirm(State.EntryCount == 2, "The open snapshot miscounted the catalogue");
        Confirm(State.Revision != 0, "ConfigureDirectory left the catalogue revision at zero");
        Confirm(Host.SelectMaterial(Second), "SelectMaterial refused the second material");
        Confirm(!Host.SelectMaterial("missing.material"), "SelectMaterial accepted a missing material");
        State = Host.QueryState();
        Confirm(State.Selection.find(Second.string()) != std::string::npos, "The snapshot missed the selection");

        // 4. Headless frames with no backend: panels tick and draw, nothing publishes.
        const auto Frame = [&]()
        {
            ImGui::NewFrame();
            Host.Synchronize();
            ImGui::Render();
        };
        Host.ConfigurePlatform();
        Host.RecoverPlatformWindows();
        for (int Tick = 0; Tick < 8; ++Tick) Frame();
        Confirm(Fake.Publishes == 0, "A null backend published a selection");
        Confirm(Host.QueryState().EntryCount == 2, "Headless frames lost catalogue entries");

        // 5. Backend protocol: attach binds once, double-bind refuses, same-pointer reattach is idempotent.
        Confirm(Host.AttachBackend(&Fake), "Attach refused the fake backend");
        Confirm(Host.QueryBackend() == &Fake, "Attach did not probe the fake backend");
        Confirm(Fake.Binds == 1, "Attach bound the backend more than once");
        Confirm(Host.QueryState().BackendBound, "The snapshot missed the bound backend");
        Confirm(!Host.AttachBackend(&SecondFake), "A second backend attached over the first");
        Confirm(SecondFake.Binds == 0, "The refused second backend bound anyway");
        Confirm(Host.QueryBackend() == &Fake, "The refused attach displaced the backend");
        Confirm(!Host.AttachBackend(nullptr), "A null backend attached");
        Confirm(Host.AttachBackend(&Fake), "Reattaching the same backend refused");
        Confirm(Fake.Binds == 1, "Reattaching rebound the backend");

        // 6. Revision-driven publishing: one selection change publishes once, then stays quiet.
        Confirm(Host.SelectMaterial(First), "SelectMaterial refused the first material");
        Frame();
        Confirm(Fake.Publishes == 1, "The selection change published no selection");
        Confirm(Fake.LastPublishedSelection.filename() == First, "The published selection named the wrong material");
        Frame();
        Frame();
        Confirm(Fake.Publishes == 1, "An idle catalogue republished its selection");
        for (int Tick = 0; Tick < 6; ++Tick) Frame();
        Confirm(Fake.ThumbnailQueries > 0, "The gallery issued no thumbnail seam queries");

        // 7. Record/confirm forwards reach the backend.
        Host.ConstructWorkspaceCommands(nullptr, 0, 1);
        Host.ConfirmWorkspaceSubmission();
        Confirm(Fake.Records == 1, "ConstructWorkspaceCommands did not forward");
        Confirm(Fake.Confirms == 1, "ConfirmWorkspaceSubmission did not forward");

        // 8. Throwing Bind reports false, keeps the host unbound, and the host recovers.
        Host.DetachBackend();
        Confirm(Fake.Unbinds == 1, "Detach did not unbind the backend");
        Confirm(Host.QueryBackend() == nullptr, "Detach left the backend probed");
        Confirm(!Host.QueryState().BackendBound, "Detach left the snapshot bound");
        SecondFake.ThrowOnBind = true;
        Confirm(!Host.AttachBackend(&SecondFake), "A throwing Bind reported success");
        Confirm(Host.QueryBackend() == nullptr, "A throwing Bind left the backend probed");
        Confirm(Host.AttachBackend(&Fake), "The host did not recover after a throwing Bind");
        Confirm(Fake.Binds == 2, "The recovery attach did not bind");

        // 9. Close-request flow: request latches, consume clears, close detaches and finalizes.
        Confirm(Host.RequestClose(), "RequestClose refused the open host");
        Frame();
        Confirm(Host.QueryState().CloseRequested, "The request did not latch into the snapshot");
        Confirm(Host.ConsumeCloseRequest(), "Consume missed the latched request");
        Confirm(!Host.ConsumeCloseRequest(), "Consume reported the request twice");
        Confirm(!Host.QueryState().CloseRequested, "Consume left the snapshot latched");
        Host.Close();
        Confirm(!Host.IsOpen(), "Close left the host open");
        Confirm(Fake.Unbinds == 2, "Close did not detach the backend");
        Confirm(Host.QueryBackend() == nullptr, "Close left the backend probed");
        Host.Close();
        Confirm(!Host.IsOpen(), "A double close reopened the host");

        // 10. Reopen proves teardown is complete; evidence renders the hosted workspace.
        Confirm(Host.Open(Scratch, &Refusal), ("Reopen refused the scratch library: " + Refusal).c_str());
        Confirm(Host.QueryState().EntryCount == 2, "Reopen miscounted the catalogue");
        Confirm(Host.AttachBackend(&Fake), "Reopen refused the backend");
        for (int Tick = 0; Tick < 8; ++Tick) Frame();
        if (ArgumentCount >= 2)
        {
            IO.AddMousePosEvent(-1.0f, -1.0f);
            Frame();
            FrontierExhibit::AcknowledgeTextures();
            const int Width  = static_cast<int>(IO.DisplaySize.x * IO.DisplayFramebufferScale.x);
            const int Height = static_cast<int>(IO.DisplaySize.y * IO.DisplayFramebufferScale.y);
            std::vector<unsigned char> Pixels(static_cast<size_t>(Width) * Height * 3, 0x18);
            const ImDrawData* DrawData = ImGui::GetDrawData();
            for (const ImDrawList* DrawList : DrawData->CmdLists)
                FrontierExhibit::RasterizeCommands(DrawList, Pixels.data(), Width, Height, DrawData->DisplayPos, DrawData->FramebufferScale);
            std::ofstream Image(Arguments[1], std::ios::binary);
            Image << "P6\n" << Width << ' ' << Height << "\n255\n";
            Image.write(reinterpret_cast<const char*>(Pixels.data()), static_cast<std::streamsize>(Pixels.size()));
            if (!Image) throw std::runtime_error("Could not write Texture Workspace host PPM evidence");
        }
        // 11. Layout persistence round-trips through the linked control centre's personal projectspace.
        ControlCentrePanel Appearance(ArchiveRoot, Scratch / "Personal.projectspace");
        Confirm(Appearance.Initialize() && Appearance.Activate(), "The validation appearance failed to activate");
        Host.ConfigureControlCentre(&Appearance);
        std::string LayoutMessage;
        Confirm(Host.PersistLayout(LayoutMessage), ("Persist refused the seated layout: " + LayoutMessage).c_str());
        Confirm(LayoutMessage.empty(), "A persisted layout carried a message");
        Confirm(std::filesystem::is_regular_file(Scratch / "Personal.projectspace"), "Persist wrote no preferences file");
        {
            std::ifstream Prefs(Scratch / "Personal.projectspace");
            const std::string PrefsText((std::istreambuf_iterator<char>(Prefs)), std::istreambuf_iterator<char>());
            Confirm(PrefsText.find(TextureWorkspaceLayoutKey) != std::string::npos,
                "The preferences file holds no texture layout section");
        }
        // Session-only (no personal projectspace) persists silently.
        ControlCentrePanel SessionOnly(ArchiveRoot, std::filesystem::path{});
        Confirm(SessionOnly.Initialize() && SessionOnly.Activate(), "The session-only appearance failed to activate");
        Host.ConfigureControlCentre(&SessionOnly);
        Confirm(Host.PersistLayout(LayoutMessage), "A session-only persist refused");
        Confirm(LayoutMessage.empty(), "A session-only persist carried a message");

        // 12. Restore applies the saved layout pre-seat, refuses once seated, and isolates bad saves.
        Host.Close();
        Confirm(Host.Open(Scratch, &Refusal), ("Reopen refused the scratch library: " + Refusal).c_str());
        Host.ConfigureControlCentre(&Appearance);
        std::string LayoutDiagnostic;
        Confirm(Host.RestoreLayout(LayoutDiagnostic), ("Restore refused the saved layout: " + LayoutDiagnostic).c_str());
        Confirm(Host.QueryState().EntryCount == 2, "A restored host miscounted the catalogue");
        for (int Tick = 0; Tick < 8; ++Tick) Frame();
        Confirm(!Host.RestoreLayout(LayoutDiagnostic), "Restore accepted a seated layout");
        Confirm(!LayoutDiagnostic.empty(), "A seated restore carried no diagnostic");
        // A bad table refuses without blocking the session: a later valid restore still applies.
        {
            ProjectSpaceDocument Saved;
            std::string CodecMessage;
            Confirm(ProjectSpaceCodec::Decode(Scratch / "Personal.projectspace", Saved, CodecMessage),
                ("The saved preferences did not decode: " + CodecMessage).c_str());
            auto* SavedSection = Saved.Sections["workspace"][TextureWorkspaceLayoutKey].as_table();
            Confirm(SavedSection != nullptr, "The saved preferences hold no texture layout table");
            SavedSection->insert_or_assign("format", int64_t(2));
            Confirm(ProjectSpaceCodec::Encode(Scratch / "Bogus.projectspace", Saved, CodecMessage),
                ("The bogus preferences did not encode: " + CodecMessage).c_str());
        }
        ControlCentrePanel BogusAppearance(ArchiveRoot, Scratch / "Bogus.projectspace");
        Confirm(BogusAppearance.Initialize() && BogusAppearance.Activate(), "The bogus appearance failed to activate");
        Host.Close();
        Confirm(Host.Open(Scratch, &Refusal), ("Reopen refused the scratch library: " + Refusal).c_str());
        Host.ConfigureControlCentre(&BogusAppearance);
        Confirm(!Host.RestoreLayout(LayoutDiagnostic), "Restore accepted a bad layout table");
        Confirm(!LayoutDiagnostic.empty(), "A refused table carried no diagnostic");
        Host.ConfigureControlCentre(&Appearance);
        Confirm(Host.RestoreLayout(LayoutDiagnostic), "A refused table blocked a later valid restore");
        // Unreadable preferences refuse the restore and block saving for the session.
        {
            std::ofstream Corrupt(Scratch / "Corrupt.projectspace", std::ios::binary);
            Corrupt << "[[[ this is not a projectspace";
        }
        ControlCentrePanel CorruptAppearance(ArchiveRoot, Scratch / "Corrupt.projectspace");
        Confirm(CorruptAppearance.Initialize() && CorruptAppearance.Activate(), "The corrupt appearance failed to activate");
        Host.Close();
        Confirm(Host.Open(Scratch, &Refusal), ("Reopen refused the scratch library: " + Refusal).c_str());
        Host.ConfigureControlCentre(&CorruptAppearance);
        Confirm(!Host.RestoreLayout(LayoutDiagnostic), "Restore accepted unreadable preferences");
        Confirm(!LayoutDiagnostic.empty(), "A refused restore carried no diagnostic");
        Confirm(!Host.PersistLayout(LayoutMessage), "Persist saved while blocked");
        Confirm(!LayoutMessage.empty(), "A blocked persist carried no message");

        // 13. A null control centre link is safe across ticks and platform updates.
        Host.ConfigureControlCentre(nullptr);
        Host.ConfigurePlatform();
        for (int Tick = 0; Tick < 4; ++Tick) Frame();
        Confirm(!Host.RestoreLayout(LayoutDiagnostic), "Restore reached an unlinked host");
        Confirm(!Host.PersistLayout(LayoutMessage), "Persist reached an unlinked host");
        Host.Close();
        Confirm(!Host.RestoreLayout(LayoutDiagnostic), "Restore reached a closed host");
        Confirm(!Host.PersistLayout(LayoutMessage), "Persist reached a closed host");

        Host.Close();
        std::filesystem::remove_all(Scratch, Status);
        std::puts("TextureWorkspaceHostValidation: all host checks passed.");
        return 0;
    }
    catch (const std::exception& Failure)
    {
        std::fprintf(stderr, "TextureWorkspaceHostValidation: %s\n", Failure.what());
        return 1;
    }
}
