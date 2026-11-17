/*==========================================================================================================================================
                                                      PARTICLEEDITORWORKSPACE.CPP
==========================================================================================================================================*/
// 🧩 The Particle editor's layout: Outliner, viewport with HUD and field overlay, Log Stream, Inspector and the preset library.

#include "Engine/Interface/ParticleEditor/ParticleEditorWorkspace.h"

#if FRONTIER_EDITOR && defined(FRONTIER_WITH_INTERFACE_SDK)

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/ControlTheme.h"
#include "Engine/Interface/Controls/GlyphSymbol.h"
#include "Engine/Interface/InspectorControls.h"
#include "Engine/PhysicalDynamics/ParticleDynamics/ParticleSpaceCodec.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <ctime>

namespace Frontier
{

namespace
{

constexpr float OutlinerWidth  = 292.0f;
constexpr float InspectorWidth = 404.0f;
constexpr float LogHeight      = 150.0f;
constexpr float HeaderHeight   = 54.0f;
constexpr float Gutter         = 10.0f;

struct Look
{
    InspectorPalette Palette = InspectorPalette::Resolve();
    EditorTypefaces  Faces   = EditorTypefaces::Resolve();
    float            Scale   = 1.0f;

    ImFont* Pick(ImFont* Font) const { return Font ? Font : ImGui::GetFont(); }
    void    Text(ImDrawList* Ink, ImFont* Font, float Size, ImVec2 At, ImU32 Colour, const char* Words) const
    {
        Ink->AddText(Pick(Font), Size * Scale, At, Colour, Words);
    }
    float Measure(ImFont* Font, float Size, const char* Words) const
    {
        return Pick(Font)->CalcTextSizeA(Size * Scale, FLT_MAX, 0.0f, Words).x;
    }
};

ImU32 DisplayColour(const std::array<double, 4>& Linear, float Alpha = 1.0f)
{
    const auto Encode = [](double Channel)
    {
        Channel = std::clamp(Channel, 0.0, 1.0);
        const double Display = Channel <= 0.0031308 ? Channel * 12.92 : 1.055 * std::pow(Channel, 1.0 / 2.4) - 0.055;
        return static_cast<int>(std::lround(std::clamp(Display, 0.0, 1.0) * 255.0));
    };
    return IM_COL32(Encode(Linear[0]), Encode(Linear[1]), Encode(Linear[2]), static_cast<int>(Alpha * 255.0f));
}

const char* ResolveGroupGlyph(const std::string& Group)
{
    static const std::pair<const char*, const char*> Glyphs[] = {
        { "Transitions", "Boxes" }, { "VFX", "Flame" },     { "Wind-blown", "Wind" }, { "Light fibres", "Zap" }, { "Water", "Droplets" },
        { "Ambient", "Sparkles" },  { "Effects", "Sparkles" }, { "Weather", "CloudFog" }, { "Fields", "Magnet" }, { "Ground", "Layers" },
        { "Physics", "Atom" },      { "Storms", "Tornado" },  { "Aircraft", "Jet" },    { "Space", "Globe" },
    };
    for (const auto& [Name, Glyph] : Glyphs)
    {
        if (Group == Name) return Glyph;
    }
    return "Sparkles";
}

const char* ResolveForceGlyph(ParticleFieldCategory Category)
{
    switch (Category)
    {
    case ParticleFieldCategory::Prevailing: return "Wind";
    case ParticleFieldCategory::Gust: return "Front";
    case ParticleFieldCategory::Tornado: return "Tornado";
    case ParticleFieldCategory::Outflow: return "Blast";
    case ParticleFieldCategory::Attract: return "Attract";
    case ParticleFieldCategory::Repel: return "Repel";
    case ParticleFieldCategory::Lift: return "Lift";
    case ParticleFieldCategory::Magnetic: return "Magnet";
    case ParticleFieldCategory::Gravity: return "Gravity";
    case ParticleFieldCategory::Orbit: return "Orbit";
    case ParticleFieldCategory::Drag: return "Damp";
    case ParticleFieldCategory::Current: return "Current";
    }
    return "Wind";
}

// 📝 A rounded pill button; true when pressed.
bool ConstructPillButton(const Look& Style, ImDrawList* Ink, const char* Id, ImVec2 At, const char* Label, bool Active, const char* Glyph = nullptr,
                         float* OutWidth = nullptr)
{
    const float Height = 30.0f * Style.Scale;
    const float Width  = Style.Measure(Style.Faces.Medium, 11.0f, Label) + (Glyph ? 34.0f : 22.0f) * Style.Scale;
    ImGui::SetCursorScreenPos(At);
    const bool Pressed = ImGui::InvisibleButton(Id, ImVec2(Width, Height));
    const bool Hovered = ImGui::IsItemHovered();
    Ink->AddRectFilled(At, ImVec2(At.x + Width, At.y + Height), Active ? Style.Palette.SegmentedActiveBg : Hovered ? Style.Palette.RowHoverBg : Style.Palette.CountCardBg,
                       9.0f * Style.Scale);
    Ink->AddRect(At, ImVec2(At.x + Width, At.y + Height), Style.Palette.InsetFieldBorder, 9.0f * Style.Scale);
    float Left = At.x + 11.0f * Style.Scale;
    if (Glyph)
    {
        GlyphSymbol::Construct(Ink, Glyph, ImVec2(Left, At.y + 8.0f * Style.Scale), 14.0f * Style.Scale, 1.4f, Style.Palette.TextSecondary);
        Left += 19.0f * Style.Scale;
    }
    Style.Text(Ink, Style.Faces.Medium, 11.0f, ImVec2(Left, At.y + 8.5f * Style.Scale), Active ? Style.Palette.TextPrimary : Style.Palette.TextSecondary, Label);
    if (OutWidth) *OutWidth = Width;
    return Pressed;
}

std::string ResolveClock()
{
    const std::time_t Now = std::time(nullptr);
    std::tm           Local{};
#if defined(_WIN32)
    localtime_s(&Local, &Now);
#else
    localtime_r(&Now, &Local);
#endif
    char Text[16];
    std::snprintf(Text, sizeof(Text), "%02d:%02d:%02d", Local.tm_hour, Local.tm_min, Local.tm_sec);
    return Text;
}

std::string Lowered(std::string Text)
{
    std::transform(Text.begin(), Text.end(), Text.begin(), [](unsigned char Letter) { return static_cast<char>(std::tolower(Letter)); });
    return Text;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    STATE
//------------------------------------------------------------------------------------------------------------------------

ParticleEditorWorkspace::ParticleEditorWorkspace(const std::filesystem::path& LibraryFile)
{
    if (!Library.Decode(LibraryFile, Diagnostic))
    {
        Diagnostic = "Particle library: " + Diagnostic;
        return;
    }
    Space.ConstructDefault(Library);
    AppendLog("FORCES", "Field overlay: the Force Field editor\xE2\x80\x99s visualization", "flow read back from the GPU lattice; acceleration from fieldAccel");
}

ParticleEditorWorkspace::~ParticleEditorWorkspace()
{
    (void)SaveSpaceFile();
}

bool ParticleEditorWorkspace::AttachSpaceFile(const std::filesystem::path& File)
{
    if (File == SpaceFile) return true;
    (void)SaveSpaceFile();
    std::string     Failure;
    std::error_code Missing;
    if (std::filesystem::exists(File, Missing))
    {
        ParticleSpace Loaded;
        if (!ReadParticleSpace(File, Loaded, Failure))
        {
            AppendLog("SPACE", "Could not read " + File.filename().string(), Failure, true);
            return false;
        }
        Space = std::move(Loaded);
        AppendLog("SPACE", "Opened " + File.filename().string(), std::to_string(Space.Effects.size()) + " effects \xC2\xB7 " + std::to_string(Space.Fields.size()) + " forces");
    }
    else
    {
        Space = ParticleSpace{};
        Space.ConstructDefault(Library);
        if (!WriteParticleSpace(Space, File, Failure))
        {
            AppendLog("SPACE", "Could not create " + File.filename().string(), Failure, true);
            return false;
        }
        AppendLog("SPACE", "Created " + File.filename().string(), "from the library's opening space");
    }
    SpaceFile   = File;
    SavedText   = EncodeParticleSpace(Space);
    Changed     = false;
    ChangeClock = 0.0;
    Planned     = false;
    Image       = ParticleViewportImage{};
    return true;
}

bool ParticleEditorWorkspace::SaveSpaceFile()
{
    if (SpaceFile.empty()) return false;
    std::string Encoded = EncodeParticleSpace(Space);
    if (Encoded == SavedText) return true;
    std::string Failure;
    if (!WriteParticleSpace(Space, SpaceFile, Failure))
    {
        AppendLog("SPACE", "Could not save " + SpaceFile.filename().string(), Failure, true);
        return false;
    }
    SavedText = std::move(Encoded);
    Changed   = false;
    AppendLog("SPACE", "Saved " + SpaceFile.filename().string());
    return true;
}

bool ParticleEditorWorkspace::QuerySpaceChanged()
{
    if (SpaceFile.empty()) return false;
    if (ChangeClock >= 0.5)
    {
        Changed     = EncodeParticleSpace(Space) != SavedText;
        ChangeClock = 0.0;
    }
    return Changed;
}

void ParticleEditorWorkspace::AppendLog(std::string Category, std::string Text, std::string Detail, bool Warm)
{
    Log.push_back({ ResolveClock(), std::move(Category), std::move(Text), std::move(Detail), Warm });
    if (Log.size() > 200) Log.erase(Log.begin());
}

bool ParticleEditorWorkspace::Perform(std::string_view Action)
{
    const auto Colon    = Action.find(':');
    const auto Verb     = Action.substr(0, Colon);
    const auto Argument = Colon == std::string_view::npos ? std::string_view{} : Action.substr(Colon + 1);
    if (Verb == "select")
    {
        Space.Selected = std::string(Argument);
        return true;
    }
    if (Verb == "add")
    {
        const ParticleEffectInstance* Effect = Space.AddEffect(Library, Argument);
        if (!Effect) return false;
        const ParticlePreset* Preset = Library.ResolvePreset(Argument);
        char Detail[96];
        std::snprintf(Detail, sizeof(Detail), "%s \xC2\xB7 %s \xC2\xB7 %u capacity", Preset->Group.c_str(), ResolveParticleBehaviourLabel(Effect->Parameters.Behaviour),
                      ResolveParticleCapacity(Effect->Parameters));
        AppendLog("PARTICLES", "Added " + Effect->Name, Detail);
        LibraryShown = false;
        return true;
    }
    if (Verb == "duplicate")
    {
        const ParticleEffectInstance* Copy = Space.DuplicateEffect(Library, Argument);
        if (Copy) AppendLog("PARTICLES", "Duplicated " + Copy->Name.substr(0, Copy->Name.size() - 5));
        return Copy != nullptr;
    }
    if (Verb == "remove")
    {
        std::string Name;
        if (const ParticleEffectInstance* Effect = Space.ResolveEffect(Argument)) Name = Effect->Name;
        const bool Removed = Space.RemoveEffect(Argument);
        if (Removed) AppendLog("PARTICLES", "Removed " + Name, {}, true);
        return Removed;
    }
    if (Verb == "rebuild")
    {
        ParticleEffectInstance* Effect = Space.ResolveEffect(Argument);
        if (!Effect) return false;
        Effect->NeedFill     = true;
        Effect->Head         = 0;
        Effect->Accumulated  = 0.0;
        Effect->PendingBurst = 0;
        ++Effect->StoreGeneration;
        return true;
    }
    if (Verb == "add-force")
    {
        const ParticleFieldDescriptor* Descriptor = ResolveParticleFieldDescriptor(Argument);
        if (!Descriptor) return false;
        if (Descriptor->Contribution == ForceContribution::Flow && Space.CountFlowFields() >= ParticleWindComponentLimit) return false;
        ParticleField Field = ConstructParticleField(Descriptor->Category);
        Field.Centre        = { 0.0, 1.0, 0.0 };
        Field.Radius        = Descriptor->Reach == ForceReach::Everywhere ? 8.0 : 3.0;
        Space.Fields.push_back(std::move(Field));
        Space.Selected = "force:" + std::to_string(Space.Fields.size() - 1);
        AppendLog("FORCES", std::string("Added ") + Descriptor->Name, "at the domain centre");
        return true;
    }
    if (Verb == "remove-force")
    {
        const size_t Index = static_cast<size_t>(std::atoi(std::string(Argument).c_str()));
        if (Index >= Space.Fields.size()) return false;
        AppendLog("FORCES", "Removed " + Space.Fields[Index].Name, {}, true);
        Space.Fields.erase(Space.Fields.begin() + static_cast<std::ptrdiff_t>(Index));
        Space.Selected = "Field";
        return true;
    }
    if (Verb == "reset")
    {
        Space.ResetEffects();
        AppendLog("PARTICLES", "Every effect cleared and re-seeded", {}, true);
        return true;
    }
    if (Verb == "strike")
    {
        const std::array<double, 3> Hit = Space.StrikeNow();
        char Detail[96];
        std::snprintf(Detail, sizeof(Detail), "at (%.1f, %.1f, %.1f) m \xC2\xB7 thunder after %.1f s", Hit[0], Hit[1], Hit[2], Space.Lightning.DistanceMetres / 343.0);
        AppendLog("LIGHTNING", "Strike", Detail, true);
        return true;
    }
    if (Verb == "pause" || Verb == "play")
    {
        Space.Playing = Verb == "play";
        return true;
    }
    if (Verb == "time-scale")
    {
        Space.TimeScale = std::clamp(std::atof(std::string(Argument).c_str()), 0.0, 4.0);
        return true;
    }
    if (Verb == "library")
    {
        LibraryShown = Argument != "off";
        return true;
    }
    if (Verb == "overlay")
    {
        Overlay.Settings.Enabled = Argument != "off";
        AppendLog("FORCES", Overlay.Settings.Enabled ? "Field overlay on" : "Field overlay off");
        return true;
    }
    if (Verb == "contribution")
    {
        Overlay.Settings.Contribution = Argument == "accelerate" ? ForceContribution::Accelerate : Argument == "damp" ? ForceContribution::Damp : ForceContribution::Flow;
        return true;
    }
    if (Verb == "camera")
    {
        double Yaw = Space.Camera.Yaw, Pitch = Space.Camera.Pitch, Distance = Space.Camera.Distance;
        if (std::sscanf(std::string(Argument).c_str(), "%lf,%lf,%lf", &Yaw, &Pitch, &Distance) < 2) return false;
        Space.Camera.Yaw      = Yaw;
        Space.Camera.Pitch    = std::clamp(Pitch, -0.1, 1.5);
        Space.Camera.Distance = std::clamp(Distance, 2.0, 60.0);
        return true;
    }
    if (Verb == "top-view")
    {
        Space.Camera.Pitch = Space.Camera.Pitch > 1.3 ? 0.3 : 1.45;
        return true;
    }
    if (Verb == "save")
    {
        if (Argument.empty()) return SaveSpaceFile();
        std::string Failure;
        if (!WriteParticleSpace(Space, std::filesystem::path(std::string(Argument)), Failure)) return false;
        SpaceFile = std::filesystem::path(std::string(Argument));
        SavedText = EncodeParticleSpace(Space);
        Changed   = false;
        AppendLog("SPACE", "Saved " + SpaceFile.filename().string());
        return true;
    }
    if (Verb == "load")
    {
        return AttachSpaceFile(std::filesystem::path(std::string(Argument)));
    }
    return false;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    REFRESH
//------------------------------------------------------------------------------------------------------------------------

void ParticleEditorWorkspace::Present(uint32_t Width, uint32_t Height, double DeltaSeconds)
{
    if (Library.Presets.empty()) return;
    // 📝 One immutable ForceField snapshot drives both the Wind-page anchor reading and all 6,912 lattice cells this refresh.
    std::shared_ptr<const IFieldSampler> FieldSampler;
    if (Space.LevelWind.Follow && LevelFieldAvailable && LevelFieldSampler) FieldSampler = LevelFieldSampler();
    if (!FieldSampler) Space.LevelWind.FlowMps.reset();
    Plan = Space.Advance(Planned ? DeltaSeconds : 0.0, Width, Height, nullptr, FieldSampler.get());
    Planned = true;
    ChangeClock += DeltaSeconds;
    if (!Presenter)
    {
        Image.Failure = "The particle viewport needs the editor's Vulkan device.";
        return;
    }
    LatticeClock += DeltaSeconds;
    ParticleViewportRequest Request;
    Request.Plan        = &Plan;
    Request.Effects     = &Space.Effects;
    Request.FieldSampler = std::move(FieldSampler);
    Request.ReadLattice = Overlay.Settings.Enabled && LatticeClock >= 0.15;
    const bool Fresh    = Image.Adapter.empty();
    ParticleViewportImage Next = Presenter(Request);
    // 📝 The census arrives every third refresh: keep the last reading of an effect the host did not read this time.
    for (const ParticleEffectCensus& Previous : Image.Census)
    {
        const bool Present = std::any_of(Next.Census.begin(), Next.Census.end(), [&](const ParticleEffectCensus& Census) { return Census.Token == Previous.Token; });
        if (!Present && Space.ResolveEffect(Previous.Token)) Next.Census.push_back(Previous);
    }
    if (!Next.ProbeValid && Image.ProbeValid)
    {
        Next.ProbeValid = true;
        Next.Probe      = Image.Probe;
    }
    if (!Next.Lattice)
    {
        Next.Lattice             = Image.Lattice;
        Next.LatticeMilliseconds = Image.LatticeMilliseconds;
    }
    else
    {
        LatticeClock = 0.0;
    }
    if (Request.ReadLattice && Next.Lattice) Overlay.ConfigureLattice(Next.Lattice, Space, Plan);
    Image = std::move(Next);
    if (Fresh && !Image.Adapter.empty())
    {
        char Detail[96];
        std::snprintf(Detail, sizeof(Detail), "%zu effects \xC2\xB7 %zu presets in the library", Space.Effects.size(), Library.Presets.size());
        AppendLog("PARTICLES", "Vulkan ready \xC2\xB7 " + Image.Adapter, Detail);
    }
}

void ParticleEditorWorkspace::Construct(ImVec2 Minimum, ImVec2 Maximum, float Scale, double DeltaSeconds)
{
    ImDrawList* Ink = ImGui::GetWindowDrawList();
    if (Library.Presets.empty())
    {
        const Look Style{ InspectorPalette::Resolve(), EditorTypefaces::Resolve(), Scale };
        Style.Text(Ink, Style.Faces.Medium, 13.0f, ImVec2(Minimum.x + 24.0f, Minimum.y + 24.0f), Style.Palette.WarmAmber, Diagnostic.c_str());
        return;
    }
    const float  Gap      = Gutter * Scale;
    const ImVec2 LeftMax(Minimum.x + OutlinerWidth * Scale, Maximum.y);
    const ImVec2 RightMin(Maximum.x - InspectorWidth * Scale, Minimum.y);
    const ImVec2 CentreMin(LeftMax.x + Gap, Minimum.y);
    const ImVec2 CentreMax(RightMin.x - Gap, Maximum.y - LogHeight * Scale - Gap);
    const ImVec2 LogMin(CentreMin.x, CentreMax.y + Gap);
    const ImVec2 LogMax(CentreMax.x, Maximum.y);

    // 📝 The image follows the viewport's pixels (header excluded), at the window's framebuffer scale.
    const float  Density = ImGui::GetWindowViewport() ? ImGui::GetWindowViewport()->FramebufferScale.y : 1.0f;
    const uint32_t Width  = static_cast<uint32_t>(std::max(64.0f, (CentreMax.x - CentreMin.x) * Density));
    const uint32_t Height = static_cast<uint32_t>(std::max(64.0f, (CentreMax.y - CentreMin.y - HeaderHeight * Scale) * Density));
    ViewExtent            = { Width, Height };
    Present(Width, Height, DeltaSeconds);

    ConstructOutliner(Ink, Minimum, LeftMax, Scale);
    ConstructViewport(Ink, CentreMin, CentreMax, Scale);
    ConstructLogStream(Ink, LogMin, LogMax, Scale);
    ConstructInspector(RightMin, Maximum, Scale);
    if (LibraryShown) ConstructLibrarySheet(Ink, Minimum, Maximum, Scale);

    // 📝 Space pauses, L strikes, V shows the overlay, Escape closes the library (the prototype's keys).
    if (!ImGui::GetIO().WantTextInput)
    {
        if (ImGui::IsKeyPressed(ImGuiKey_Space, false)) Requests.push_back(Space.Playing ? "pause" : "play");
        if (ImGui::IsKeyPressed(ImGuiKey_L, false)) Requests.push_back("strike");
        if (ImGui::IsKeyPressed(ImGuiKey_V, false)) Requests.push_back(Overlay.Settings.Enabled ? "overlay:off" : "overlay:on");
        if (ImGui::IsKeyPressed(ImGuiKey_Escape, false) && LibraryShown) LibraryShown = false;
    }
    std::vector<std::string> Pending;
    Pending.swap(Requests);
    for (const std::string& Action : Pending) Perform(Action);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    OUTLINER
//------------------------------------------------------------------------------------------------------------------------

void ParticleEditorWorkspace::ConstructOutliner(ImDrawList* Ink, ImVec2 Minimum, ImVec2 Maximum, float Scale)
{
    const Look Style{ InspectorPalette::Resolve(), EditorTypefaces::Resolve(), Scale };
    const auto& P = Style.Palette;
    Ink->AddRectFilled(Minimum, Maximum, P.ColumnBg, 14.0f * Scale);
    Ink->AddRect(Minimum, Maximum, P.EdgeBorder, 14.0f * Scale);
    float       Top  = Minimum.y + 16.0f * Scale;
    const float Left = Minimum.x + 16.0f * Scale, Right = Maximum.x - 16.0f * Scale;
    Style.Text(Ink, Style.Faces.Medium, 22.0f, ImVec2(Left, Top), P.TextPrimary, "Outliner");
    char Subtitle[64];
    const size_t Records = 3 + Space.Fields.size() + Space.Effects.size();
    std::snprintf(Subtitle, sizeof(Subtitle), "Particle space \xC2\xB7 %zu records", Records);
    Style.Text(Ink, Style.Faces.Regular, 11.0f, ImVec2(Left, Top + 30.0f * Scale), P.TextSecondary, Subtitle);
    Top += 56.0f * Scale;

    // 📝 The two count cards.
    const size_t Visible = static_cast<size_t>(std::count_if(Space.Effects.begin(), Space.Effects.end(), [](const ParticleEffectInstance& Effect) { return Effect.Parameters.Visible; }));
    const float  CardW   = (Right - Left - 8.0f * Scale) / 2.0f;
    for (int Card = 0; Card < 2; ++Card)
    {
        const ImVec2 Corner(Left + Card * (CardW + 8.0f * Scale), Top);
        Ink->AddRectFilled(Corner, ImVec2(Corner.x + CardW, Corner.y + 58.0f * Scale), P.CountCardBg, 12.0f * Scale);
        Ink->AddRect(Corner, ImVec2(Corner.x + CardW, Corner.y + 58.0f * Scale), P.CountCardBorder, 12.0f * Scale);
        GlyphSymbol::Construct(Ink, Card == 0 ? "Eye" : "EyeOff", ImVec2(Corner.x + 12.0f * Scale, Corner.y + 10.0f * Scale), 16.0f * Scale, 1.4f,
                               Card == 0 ? P.LiveGreen : P.TextMuted);
        Style.Text(Ink, Style.Faces.Regular, 10.5f, ImVec2(Corner.x + 12.0f * Scale, Corner.y + 36.0f * Scale), P.TextSecondary, Card == 0 ? "Visible effects" : "Hidden");
        char Figure[16];
        std::snprintf(Figure, sizeof(Figure), "%zu", Card == 0 ? Visible : Space.Effects.size() - Visible);
        Style.Text(Ink, Style.Faces.Light, 26.0f, ImVec2(Corner.x + CardW - Style.Measure(Style.Faces.Light, 26.0f, Figure) - 12.0f * Scale, Corner.y + 14.0f * Scale),
                   P.TextPrimary, Figure);
    }
    Top += 70.0f * Scale;
    float Width = 0.0f;
    if (ConstructPillButton(Style, Ink, "##ParticleOpenLibrary", ImVec2(Left, Top), "Library", LibraryShown, "Library", &Width)) Requests.push_back("library:on");
    Top += 42.0f * Scale;

    // 📝 The tree: the environment (Force Field, its Wind guest and forces, Lightning), then the effects.
    const auto Row = [&](const std::string& Token, int Depth, const char* Glyph, ImU32 Tint, const std::string& Name, const std::string& Meta, bool* Eye)
    {
        const float  Height  = 40.0f * Scale;
        const ImVec2 RowMin(Left - 4.0f * Scale, Top);
        const ImVec2 RowMax(Right + 4.0f * Scale, Top + Height);
        const bool   Chosen  = Space.Selected == Token;
        ImGui::SetCursorScreenPos(RowMin);
        ImGui::PushID(Token.c_str());
        const bool Pressed = ImGui::InvisibleButton("##Row", ImVec2(RowMax.x - RowMin.x - 30.0f * Scale, Height));
        const bool Hovered = ImGui::IsItemHovered();
        if (Pressed) Requests.push_back("select:" + Token);
        if (Chosen || Hovered) Ink->AddRectFilled(RowMin, RowMax, Chosen ? P.RowSelectedTop : P.RowHoverBg, 9.0f * Scale);
        if (Chosen) Ink->AddRect(RowMin, RowMax, P.RowSelectedBorder, 9.0f * Scale);
        const float Indent = Left + Depth * 16.0f * Scale;
        const ImVec2 Tile(Indent, Top + 7.0f * Scale);
        Ink->AddRectFilled(Tile, ImVec2(Tile.x + 26.0f * Scale, Tile.y + 26.0f * Scale), P.CountCardBg, 7.0f * Scale);
        GlyphSymbol::Construct(Ink, Glyph, ImVec2(Tile.x + 5.0f * Scale, Tile.y + 5.0f * Scale), 16.0f * Scale, 1.4f, Tint);
        Style.Text(Ink, Style.Faces.Medium, 12.5f, ImVec2(Indent + 36.0f * Scale, Top + 5.0f * Scale), P.TextPrimary, Name.c_str());
        Style.Text(Ink, Style.Faces.Regular, 10.0f, ImVec2(Indent + 36.0f * Scale, Top + 22.0f * Scale), P.TextSecondary, Meta.c_str());
        if (Eye)
        {
            const ImVec2 EyeAt(Right - 18.0f * Scale, Top + 12.0f * Scale);
            ImGui::SetCursorScreenPos(ImVec2(EyeAt.x - 4.0f * Scale, EyeAt.y - 4.0f * Scale));
            if (ImGui::InvisibleButton("##Eye", ImVec2(24.0f * Scale, 24.0f * Scale))) *Eye = !*Eye;
            GlyphSymbol::Construct(Ink, *Eye ? "Eye" : "EyeOff", EyeAt, 15.0f * Scale, 1.3f, *Eye ? P.TextSecondary : P.TextFaint);
        }
        ImGui::PopID();
        Top += Height + 2.0f * Scale;
    };
    const auto Group = [&](const char* Title, size_t Count)
    {
        char Text[64];
        std::snprintf(Text, sizeof(Text), "%s", Title);
        Style.Text(Ink, Style.Faces.SemiBold, 9.5f, ImVec2(Left, Top + 4.0f * Scale), P.TextMuted, Text);
        char Figure[16];
        std::snprintf(Figure, sizeof(Figure), "%zu", Count);
        Style.Text(Ink, Style.Faces.Regular, 9.5f, ImVec2(Right - Style.Measure(Style.Faces.Regular, 9.5f, Figure), Top + 4.0f * Scale), P.TextMuted, Figure);
        Top += 22.0f * Scale;
    };

    const ImVec2 ListMin(Minimum.x + 2.0f * Scale, Top);
    const ImVec2 ListMax(Maximum.x - 2.0f * Scale, Maximum.y - 40.0f * Scale);
    ImGui::SetCursorScreenPos(ListMin);
    ImGui::BeginChild("##ParticleOutlinerList", ImVec2(ListMax.x - ListMin.x, ListMax.y - ListMin.y), ImGuiChildFlags_None,
                      ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoBackground);
    Ink = ImGui::GetWindowDrawList();
    Top = ImGui::GetCursorScreenPos().y;
    Group("ENVIRONMENT", 3 + Space.Fields.size());
    char Meta[128];
    std::snprintf(Meta, sizeof(Meta), "Master \xC2\xB7 %zu fields \xC2\xB7 overlay %s", Space.Fields.size(), Overlay.Settings.Enabled ? "on" : "off");
    Row("Field", 0, "GridLattice", IM_COL32(143, 211, 196, 255), "Force Field", Meta, &Overlay.Settings.Enabled);
    std::snprintf(Meta, sizeof(Meta), "Guest \xC2\xB7 lattice 24 \xC3\x97 12 \xC3\x97 24 \xC2\xB7 \xC3\x97%.2g", Space.Wind.WindScale);
    Row("Wind", 1, "Wind", IM_COL32(143, 211, 196, 255), "Wind", Meta, nullptr);
    for (size_t Index = 0; Index < Space.Fields.size(); ++Index)
    {
        ParticleField&                 Field      = Space.Fields[Index];
        const ParticleFieldDescriptor& Descriptor = ResolveParticleFieldDescriptor(Field.Category);
        const char* Contribution = Descriptor.Contribution == ForceContribution::Flow ? "Flow" : Descriptor.Contribution == ForceContribution::Accelerate ? "Accelerate" : "Damp";
        char        Reach[32];
        if (Field.Reach == ForceReach::Everywhere) std::snprintf(Reach, sizeof(Reach), "everywhere");
        else std::snprintf(Reach, sizeof(Reach), "%.1f m", Field.Radius);
        std::snprintf(Meta, sizeof(Meta), "%s \xC2\xB7 %.3g %s \xC2\xB7 %s", Contribution, Field.Strength, Descriptor.Unit, Reach);
        const ImU32 Tint = Descriptor.Contribution == ForceContribution::Flow ? IM_COL32(143, 211, 196, 255)
                         : Descriptor.Contribution == ForceContribution::Accelerate ? IM_COL32(232, 194, 122, 255) : IM_COL32(185, 163, 232, 255);
        Row("force:" + std::to_string(Index), 2, ResolveForceGlyph(Field.Category), Tint, Field.Name, Meta, &Field.Enabled);
    }
    std::snprintf(Meta, sizeof(Meta), "%u strikes \xC2\xB7 %s", Space.Lightning.Strikes, Space.Lightning.Automatic ? "automatic" : "manual");
    Row("Lightning", 0, "Zap", IM_COL32(201, 184, 240, 255), "Lightning", Meta, &Space.Lightning.Automatic);
    Top += 6.0f * Scale;
    Group("PARTICLE EFFECTS", Space.Effects.size());
    for (ParticleEffectInstance& Effect : Space.Effects)
    {
        const ParticlePreset*       Preset = Library.ResolvePreset(Effect.PresetIdentifier);
        const ParticleEffectCensus* Census = ParticleEditorPages::ResolveCensus(Image, Effect.Token);
        if (Effect.Parameters.Behaviour == ParticleBehaviour::LightFibre && Effect.Parameters.LightFibre)
            std::snprintf(Meta, sizeof(Meta), "%s \xC2\xB7 %d strands", ResolveParticleBehaviourLabel(Effect.Parameters.Behaviour), Effect.Parameters.LightFibre->Strands);
        else
            std::snprintf(Meta, sizeof(Meta), "%s \xC2\xB7 %u alive", ResolveParticleBehaviourLabel(Effect.Parameters.Behaviour), Census ? Census->Alive : 0u);
        Row(Effect.Token, 0, Preset ? ResolveGroupGlyph(Preset->Group) : "Sparkles", DisplayColour(Effect.Parameters.ColourA), Effect.Name, Meta, &Effect.Parameters.Visible);
    }
    Top += 6.0f * Scale;
    const ImVec2 AddMin(Left - 4.0f * Scale, Top);
    const ImVec2 AddMax(Right + 4.0f * Scale, Top + 36.0f * Scale);
    ImGui::SetCursorScreenPos(AddMin);
    if (ImGui::InvisibleButton("##ParticleAddFromLibrary", ImVec2(AddMax.x - AddMin.x, AddMax.y - AddMin.y))) Requests.push_back("library:on");
    Ink->AddRect(AddMin, AddMax, ImGui::IsItemHovered() ? P.TextMuted : P.InsetFieldBorder, 10.0f * Scale, 0, 1.0f);
    const char* AddLabel = "+  Add from the library";
    Style.Text(Ink, Style.Faces.Medium, 11.5f, ImVec2((AddMin.x + AddMax.x - Style.Measure(Style.Faces.Medium, 11.5f, AddLabel)) / 2.0f, AddMin.y + 10.0f * Scale),
               P.TextSecondary, AddLabel);
    ImGui::SetCursorScreenPos(ImVec2(AddMin.x, AddMax.y + 8.0f * Scale));
    ImGui::Dummy(ImVec2(1.0f, 1.0f));
    ImGui::EndChild();

    Ink = ImGui::GetWindowDrawList();
    char Footer[64];
    std::snprintf(Footer, sizeof(Footer), "RECORDS %zu   \xC2\xB7   SELECTED 1", Records);
    Style.Text(Ink, Style.Faces.Monospace, 9.5f, ImVec2(Left, Maximum.y - 26.0f * Scale), P.TextMuted, Footer);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    VIEWPORT
//------------------------------------------------------------------------------------------------------------------------

void ParticleEditorWorkspace::ConstructViewport(ImDrawList* Ink, ImVec2 Minimum, ImVec2 Maximum, float Scale)
{
    const Look  Style{ InspectorPalette::Resolve(), EditorTypefaces::Resolve(), Scale };
    const auto& P = Style.Palette;
    Ink->AddRectFilled(Minimum, Maximum, P.ColumnBg, 14.0f * Scale);
    Ink->AddRect(Minimum, Maximum, P.EdgeBorder, 14.0f * Scale);

    // 📝 The bar: title, the live pill, Pause · Reset · Strike, the time scale and the overlay and top-view switches.
    const float Left = Minimum.x + 14.0f * Scale;
    const float BarY = Minimum.y + 12.0f * Scale;
    Ink->AddRectFilled(ImVec2(Left, BarY), ImVec2(Left + 30.0f * Scale, BarY + 30.0f * Scale), P.CountCardBg, 8.0f * Scale);
    GlyphSymbol::Construct(Ink, "Sparkles", ImVec2(Left + 7.0f * Scale, BarY + 7.0f * Scale), 16.0f * Scale, 1.4f, P.TextSecondary);
    Style.Text(Ink, Style.Faces.Medium, 13.0f, ImVec2(Left + 40.0f * Scale, BarY + 1.0f * Scale), P.TextPrimary, "Particle space");
    Style.Text(Ink, Style.Faces.Regular, 10.0f, ImVec2(Left + 40.0f * Scale, BarY + 18.0f * Scale), P.TextSecondary, "eos engine on Vulkan");
    float       Cursor = Left + 200.0f * Scale;
    const bool  Live   = Image.Texture != 0;
    const char* Pill   = Live ? "VULKAN \xC2\xB7 LIVE" : "NO DEVICE";
    const float PillW  = Style.Measure(Style.Faces.Medium, 10.0f, Pill) + 30.0f * Scale;
    Ink->AddRectFilled(ImVec2(Cursor, BarY + 3.0f * Scale), ImVec2(Cursor + PillW, BarY + 27.0f * Scale), IM_COL32(18, 40, 28, 255), 12.0f * Scale);
    Ink->AddCircleFilled(ImVec2(Cursor + 12.0f * Scale, BarY + 15.0f * Scale), 3.5f * Scale, Live ? P.LiveGreen : P.WarmAmber);
    Style.Text(Ink, Style.Faces.Medium, 10.0f, ImVec2(Cursor + 21.0f * Scale, BarY + 8.5f * Scale), Live ? P.LiveGreen : P.WarmAmber, Pill);
    Cursor += PillW + 12.0f * Scale;
    float Width = 0.0f;
    if (ConstructPillButton(Style, Ink, "##ParticlePause", ImVec2(Cursor, BarY), Space.Playing ? "Pause" : "Play", !Space.Playing, Space.Playing ? "Pause" : "Play", &Width))
        Requests.push_back(Space.Playing ? "pause" : "play");
    Cursor += Width + 6.0f * Scale;
    if (ConstructPillButton(Style, Ink, "##ParticleReset", ImVec2(Cursor, BarY), "Reset", false, "RotateCcw", &Width)) Requests.push_back("reset");
    Cursor += Width + 6.0f * Scale;
    if (ConstructPillButton(Style, Ink, "##ParticleStrike", ImVec2(Cursor, BarY), "Strike", false, "Zap", &Width)) Requests.push_back("strike");
    Cursor += Width + 14.0f * Scale;
    constexpr std::pair<const char*, double> Speeds[4] = { { "\xC3\x97" "0.25", 0.25 }, { "\xC3\x97" "0.5", 0.5 }, { "\xC3\x97" "1", 1.0 }, { "\xC3\x97" "2", 2.0 } };
    for (const auto& [Label, Factor] : Speeds)
    {
        char Id[32];
        std::snprintf(Id, sizeof(Id), "##ParticleSpeed%.2f", Factor);
        if (ConstructPillButton(Style, Ink, Id, ImVec2(Cursor, BarY), Label, std::fabs(Space.TimeScale - Factor) < 1e-6, nullptr, &Width))
            Requests.push_back("time-scale:" + std::to_string(Factor));
        Cursor += Width + 3.0f * Scale;
    }
    Cursor += 11.0f * Scale;
    if (ConstructPillButton(Style, Ink, "##ParticleFieldToggle", ImVec2(Cursor, BarY), "Field", Overlay.Settings.Enabled, "GridLattice", &Width))
        Requests.push_back(Overlay.Settings.Enabled ? "overlay:off" : "overlay:on");
    Cursor += Width + 6.0f * Scale;
    if (ConstructPillButton(Style, Ink, "##ParticleTopView", ImVec2(Cursor, BarY), "Top", Space.Camera.Pitch > 1.3, "Map", &Width)) Requests.push_back("top-view");

    // 📝 The image, the overlay and the readouts.
    const ImVec2 StageMin(Minimum.x + 8.0f * Scale, Minimum.y + HeaderHeight * Scale);
    const ImVec2 StageMax(Maximum.x - 8.0f * Scale, Maximum.y - 26.0f * Scale);
    Ink->AddRectFilled(StageMin, StageMax, IM_COL32(9, 9, 12, 255), 8.0f * Scale);
    if (Image.Texture != 0)
    {
        Ink->AddImageRounded(static_cast<ImTextureID>(Image.Texture), StageMin, StageMax, ImVec2(0, 0), ImVec2(1, 1), IM_COL32_WHITE, 8.0f * Scale);
    }
    else
    {
        const char* Reason = !Image.Failure.empty() ? Image.Failure.c_str() : "Starting the particle engine\xE2\x80\xA6";
        Style.Text(Ink, Style.Faces.Medium, 12.0f, ImVec2(StageMin.x + 24.0f * Scale, StageMin.y + 24.0f * Scale), P.WarmAmber, Reason);
    }
    Ink->PushClipRect(StageMin, StageMax, true);
    Overlay.Render(Ink, Style.Faces, StageMin, StageMax, Space, Scale);

    // 📝 Orbit: drag turns, right-drag pans, the wheel zooms (the minimap keeps its own clicks).
    const ImVec2 MinimapMin(StageMax.x - 182.0f * Scale, StageMin.y + 12.0f * Scale);
    const ImVec2 MinimapMax(StageMax.x - 12.0f * Scale, StageMin.y + 182.0f * Scale);
    ImGui::SetCursorScreenPos(StageMin);
    ImGui::SetNextItemAllowOverlap();   // the minimap, submitted after, keeps its clicks
    ImGui::InvisibleButton("##ParticleOrbit", ImVec2(StageMax.x - StageMin.x, StageMax.y - StageMin.y), ImGuiButtonFlags_MouseButtonLeft | ImGuiButtonFlags_MouseButtonRight);
    if (ImGui::IsItemActive())
    {
        const ImVec2 Delta = ImGui::GetIO().MouseDelta;
        if (ImGui::IsMouseDown(ImGuiMouseButton_Left))
        {
            Space.Camera.Yaw -= Delta.x * 0.006;
            Space.Camera.Pitch = std::clamp(Space.Camera.Pitch + Delta.y * 0.006, -0.1, 1.5);
        }
        else if (ImGui::IsMouseDown(ImGuiMouseButton_Right))
        {
            const ParticleCameraReading Reading = ResolveParticleCamera(Space.Camera, 1.0);
            const double                Step    = Space.Camera.Distance * 0.0016;
            for (int Axis = 0; Axis < 3; ++Axis) Space.Camera.Target[Axis] += (-Reading.Right[Axis] * Delta.x + Reading.Up[Axis] * Delta.y) * Step;
        }
    }
    if (ImGui::IsItemHovered() && ImGui::GetIO().MouseWheel != 0.0f)
        Space.Camera.Distance = std::clamp(Space.Camera.Distance * std::exp(-ImGui::GetIO().MouseWheel * 0.1), 2.0, 60.0);

    // 📝 The HUD: particles, refresh rate, GPU time and the clock, then the probe.
    uint32_t Alive = 0, Capacity = 0;
    for (const ParticleEffectInstance& Effect : Space.Effects)
    {
        if (Effect.Parameters.Behaviour == ParticleBehaviour::LightFibre || !Effect.Parameters.Visible) continue;
        Capacity += ResolveParticleCapacity(Effect.Parameters);
        if (const ParticleEffectCensus* Census = ParticleEditorPages::ResolveCensus(Image, Effect.Token)) Alive += Census->Alive;
    }
    char Hud[160];
    std::snprintf(Hud, sizeof(Hud), "PARTICLES %u / %u   RATE %.0f fps   GPU %.2f ms   t %.1f s", Alive, Capacity, Space.RefreshRate, Image.RefreshMilliseconds, Space.TimeSeconds);
    const ImVec2 HudAt(StageMin.x + 12.0f * Scale, StageMin.y + 12.0f * Scale);
    const float  HudW = Style.Measure(Style.Faces.Monospace, 10.5f, Hud) + 20.0f * Scale;
    Ink->AddRectFilled(HudAt, ImVec2(HudAt.x + HudW, HudAt.y + 26.0f * Scale), IM_COL32(12, 13, 17, 215), 7.0f * Scale);
    Style.Text(Ink, Style.Faces.Monospace, 10.5f, ImVec2(HudAt.x + 10.0f * Scale, HudAt.y + 6.5f * Scale), P.TextPrimary, Hud);
    if (Space.ProbeEnabled)
    {
        const auto Cell = Space.ResolveProbeCell();
        char Lines[4][128];
        std::snprintf(Lines[0], sizeof(Lines[0]), "PROBE (%.1f, %.1f, %.1f) m \xC2\xB7 cell %u, %u, %u", Space.Probe[0], Space.Probe[1], Space.Probe[2], Cell[0], Cell[1], Cell[2]);
        std::snprintf(Lines[1], sizeof(Lines[1]), "wind %.2f  %.2f  %.2f m/s", Image.Probe[0], Image.Probe[1], Image.Probe[2]);
        std::snprintf(Lines[2], sizeof(Lines[2]), "|v| %.2f \xC2\xB7 horizontal %.2f m/s", Image.Probe[3], std::hypot(Image.Probe[0], Image.Probe[2]));
        std::snprintf(Lines[3], sizeof(Lines[3]), "readback %.2f ms \xC2\xB7 8 B", Image.LatticeMilliseconds);
        float ProbeW = 0.0f;
        for (const auto& Line : Lines) ProbeW = std::max(ProbeW, Style.Measure(Style.Faces.Monospace, 10.0f, Line));
        const ImVec2 ProbeAt(HudAt.x, HudAt.y + 34.0f * Scale);
        Ink->AddRectFilled(ProbeAt, ImVec2(ProbeAt.x + ProbeW + 20.0f * Scale, ProbeAt.y + 74.0f * Scale), IM_COL32(12, 13, 17, 215), 7.0f * Scale);
        for (int Line = 0; Line < 4; ++Line)
            Style.Text(Ink, Style.Faces.Monospace, 10.0f, ImVec2(ProbeAt.x + 10.0f * Scale, ProbeAt.y + (8.0f + Line * 15.5f) * Scale), Line == 0 ? P.TextPrimary : P.TextSecondary,
                       Lines[Line]);
    }
    if (Overlay.Settings.Enabled && Image.Lattice)
    {
        Ink->AddRectFilled(MinimapMin, ImVec2(MinimapMax.x, MinimapMax.y + 20.0f * Scale), IM_COL32(12, 13, 17, 225), 9.0f * Scale);
        Overlay.Slice.ConstructMinimap("##ParticleMinimap", Ink, ImVec2(MinimapMin.x + 8.0f * Scale, MinimapMin.y + 8.0f * Scale),
                                       ImVec2(MinimapMax.x - 8.0f * Scale, MinimapMax.y - 8.0f * Scale), Space.TimeSeconds, Scale);
        Style.Text(Ink, Style.Faces.Regular, 9.5f, ImVec2(MinimapMin.x + 8.0f * Scale, MinimapMax.y - 2.0f * Scale), P.TextSecondary, "Lattice domain");
        Style.Text(Ink, Style.Faces.Regular, 9.5f, ImVec2(MinimapMax.x - Style.Measure(Style.Faces.Regular, 9.5f, "12 \xC3\x97 12 m") - 8.0f * Scale, MinimapMax.y - 2.0f * Scale),
                   P.TextSecondary, "12 \xC3\x97 12 m");
    }
    const char* Hint = "Drag to orbit \xC2\xB7 right-drag pans \xC2\xB7 wheel zooms \xC2\xB7 Space pauses \xC2\xB7 L strikes \xC2\xB7 V field overlay";
    const float HintW = Style.Measure(Style.Faces.Regular, 10.0f, Hint);
    Style.Text(Ink, Style.Faces.Regular, 10.0f, ImVec2(StageMax.x - HintW - 14.0f * Scale, StageMax.y - 20.0f * Scale), IM_COL32(200, 205, 214, 170), Hint);
    Ink->PopClipRect();

    char Footer[160];
    std::snprintf(Footer, sizeof(Footer), "VULKAN   ADAPTER %s", Image.Adapter.empty() ? "\xE2\x80\x94" : Image.Adapter.c_str());
    Style.Text(Ink, Style.Faces.Monospace, 9.5f, ImVec2(StageMin.x + 6.0f * Scale, Maximum.y - 19.0f * Scale), P.TextMuted, Footer);
    std::snprintf(Footer, sizeof(Footer), "LATTICE READBACK 54 KB \xC2\xB7 %.1f MS \xC2\xB7 STORES %.1f MB", Image.LatticeMilliseconds, Image.StoreBytes / 1048576.0);
    Style.Text(Ink, Style.Faces.Monospace, 9.5f, ImVec2(StageMax.x - Style.Measure(Style.Faces.Monospace, 9.5f, Footer) - 6.0f * Scale, Maximum.y - 19.0f * Scale), P.TextMuted,
               Footer);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    LOG STREAM
//------------------------------------------------------------------------------------------------------------------------

void ParticleEditorWorkspace::ConstructLogStream(ImDrawList* Ink, ImVec2 Minimum, ImVec2 Maximum, float Scale)
{
    const Look  Style{ InspectorPalette::Resolve(), EditorTypefaces::Resolve(), Scale };
    const auto& P = Style.Palette;
    Ink->AddRectFilled(Minimum, Maximum, P.ColumnBg, 14.0f * Scale);
    Ink->AddRect(Minimum, Maximum, P.EdgeBorder, 14.0f * Scale);
    const float Left = Minimum.x + 14.0f * Scale;
    Style.Text(Ink, Style.Faces.Medium, 13.0f, ImVec2(Left, Minimum.y + 12.0f * Scale), P.TextPrimary, "Log Stream");
    const float Pill = Left + Style.Measure(Style.Faces.Medium, 13.0f, "Log Stream") + 12.0f * Scale;
    Ink->AddRectFilled(ImVec2(Pill, Minimum.y + 10.0f * Scale), ImVec2(Pill + 50.0f * Scale, Minimum.y + 30.0f * Scale), IM_COL32(18, 40, 28, 255), 10.0f * Scale);
    Ink->AddCircleFilled(ImVec2(Pill + 10.0f * Scale, Minimum.y + 20.0f * Scale), 3.0f * Scale, P.LiveGreen);
    Style.Text(Ink, Style.Faces.Medium, 9.5f, ImVec2(Pill + 18.0f * Scale, Minimum.y + 14.0f * Scale), P.LiveGreen, "LIVE");
    char Count[32];
    std::snprintf(Count, sizeof(Count), "%zu entries", Log.size());
    Style.Text(Ink, Style.Faces.Regular, 10.0f, ImVec2(Maximum.x - Style.Measure(Style.Faces.Regular, 10.0f, Count) - 16.0f * Scale, Minimum.y + 15.0f * Scale), P.TextSecondary, Count);
    float      Top   = Minimum.y + 44.0f * Scale;
    const size_t Rows = static_cast<size_t>(std::max(0.0f, (Maximum.y - Top - 6.0f * Scale) / (24.0f * Scale)));
    const size_t First = Log.size() > Rows ? Log.size() - Rows : 0;
    for (size_t Index = Log.size(); Index-- > First;)
    {
        const ParticleLogLine& Line = Log[Index];
        Ink->AddCircleFilled(ImVec2(Left + 4.0f * Scale, Top + 8.0f * Scale), 3.0f * Scale, Line.Warm ? P.WarmAmber : P.LiveGreen);
        Style.Text(Ink, Style.Faces.Monospace, 9.5f, ImVec2(Left + 18.0f * Scale, Top + 2.0f * Scale), P.TextMuted, Line.Time.c_str());
        const float  CategoryW = Style.Measure(Style.Faces.Medium, 8.5f, Line.Category.c_str()) + 16.0f * Scale;
        const ImVec2 Chip(Left + 86.0f * Scale, Top);
        Ink->AddRect(Chip, ImVec2(Chip.x + CategoryW, Chip.y + 17.0f * Scale), P.InsetFieldBorder, 8.0f * Scale);
        Style.Text(Ink, Style.Faces.Medium, 8.5f, ImVec2(Chip.x + 8.0f * Scale, Chip.y + 3.5f * Scale), P.TextSecondary, Line.Category.c_str());
        const float TextX = Chip.x + std::max(CategoryW, 84.0f * Scale) + 12.0f * Scale;
        Style.Text(Ink, Style.Faces.Medium, 11.0f, ImVec2(TextX, Top + 1.5f * Scale), P.TextPrimary, Line.Text.c_str());
        if (!Line.Detail.empty())
        {
            const std::string Detail = "\xC2\xB7 " + Line.Detail;
            Style.Text(Ink, Style.Faces.Regular, 10.5f, ImVec2(TextX + Style.Measure(Style.Faces.Medium, 11.0f, Line.Text.c_str()) + 8.0f * Scale, Top + 2.0f * Scale),
                       P.TextSecondary, Detail.c_str());
        }
        Top += 24.0f * Scale;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    INSPECTOR
//------------------------------------------------------------------------------------------------------------------------

void ParticleEditorWorkspace::ConstructInspector(ImVec2 Minimum, ImVec2 Maximum, float Scale)
{
    const Look  Style{ InspectorPalette::Resolve(), EditorTypefaces::Resolve(), Scale };
    ImDrawList* Ink = ImGui::GetWindowDrawList();
    Ink->AddRectFilled(Minimum, Maximum, Style.Palette.ColumnBg, 14.0f * Scale);
    Ink->AddRect(Minimum, Maximum, Style.Palette.EdgeBorder, 14.0f * Scale);
    ImGui::SetCursorScreenPos(ImVec2(Minimum.x + 1.0f, Minimum.y + 1.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    if (ImGui::BeginChild("##ParticleInspector", ImVec2(Maximum.x - Minimum.x - 2.0f, Maximum.y - Minimum.y - 2.0f), ImGuiChildFlags_None,
                          ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoBackground))
    {
        const ControlTheme    Theme = ControlTheme::ResolveNative();
        ControlColumn         Page(Theme, Style.Faces, Scale);
        ParticleEditorContext Context{ Space, Library, Overlay.Settings, Image, Planned ? &Plan : nullptr, Requests,
                                       LevelFieldAvailable };
        const std::string&    Selected = Space.Selected;
        if (Selected == "Wind") ParticleEditorPages::ConstructWindPage(Page, Context);
        else if (Selected == "Lightning") ParticleEditorPages::ConstructLightningPage(Page, Context);
        else if (Selected.rfind("force:", 0) == 0) ParticleEditorPages::ConstructForcePage(Page, Context, static_cast<size_t>(std::atoi(Selected.c_str() + 6)));
        else if (ParticleEffectInstance* Effect = Space.ResolveEffect(Selected)) ParticleEditorPages::ConstructEffectPage(Page, Context, *Effect);
        else ParticleEditorPages::ConstructFieldPage(Page, Context);
        Page.Finalize();
    }
    ImGui::EndChild();
    ImGui::PopStyleVar();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    LIBRARY
//------------------------------------------------------------------------------------------------------------------------

void ParticleEditorWorkspace::ConstructLibrarySheet(ImDrawList*, ImVec2 Minimum, ImVec2 Maximum, float Scale)
{
    const Look  Style{ InspectorPalette::Resolve(), EditorTypefaces::Resolve(), Scale };
    const auto& P = Style.Palette;
    // 📝 A child over the whole editor, created last so it draws above the columns and takes the pointer from them.
    ImGui::SetCursorScreenPos(Minimum);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    if (ImGui::BeginChild("##ParticleLibraryVeil", ImVec2(Maximum.x - Minimum.x, Maximum.y - Minimum.y), ImGuiChildFlags_None,
                          ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoScrollWithMouse))
    {
        ImDrawList* Ink = ImGui::GetWindowDrawList();
        Ink->AddRectFilled(Minimum, Maximum, IM_COL32(4, 5, 8, 175), 14.0f * Scale);
        const float  SheetW = std::min(980.0f * Scale, Maximum.x - Minimum.x - 80.0f * Scale);
        const float  SheetH = std::min(680.0f * Scale, Maximum.y - Minimum.y - 60.0f * Scale);
        const ImVec2 SheetMin((Minimum.x + Maximum.x - SheetW) / 2.0f, (Minimum.y + Maximum.y - SheetH) / 2.0f);
        const ImVec2 SheetMax(SheetMin.x + SheetW, SheetMin.y + SheetH);
        // 📝 A click on the veil outside the sheet closes the library.
        ImGui::SetCursorScreenPos(Minimum);
        if (ImGui::InvisibleButton("##ParticleLibraryOutside", ImVec2(Maximum.x - Minimum.x, Maximum.y - Minimum.y)))
        {
            const ImVec2 Pointer = ImGui::GetIO().MousePos;
            if (Pointer.x < SheetMin.x || Pointer.x > SheetMax.x || Pointer.y < SheetMin.y || Pointer.y > SheetMax.y) LibraryShown = false;
        }
        Ink->AddRectFilled(SheetMin, SheetMax, P.ColumnBg, 16.0f * Scale);
        Ink->AddRect(SheetMin, SheetMax, P.EdgeBorder, 16.0f * Scale);
        const float Left = SheetMin.x + 22.0f * Scale;
        Style.Text(Ink, Style.Faces.Medium, 20.0f, ImVec2(Left, SheetMin.y + 18.0f * Scale), P.TextPrimary, "Preset library");
        char Subtitle[96];
        std::snprintf(Subtitle, sizeof(Subtitle), "%zu presets in %zu groups \xC2\xB7 the eos library, unchanged", Library.Presets.size(), Library.Groups.size());
        Style.Text(Ink, Style.Faces.Regular, 11.0f, ImVec2(Left, SheetMin.y + 46.0f * Scale), P.TextSecondary, Subtitle);
        float Width = 0.0f;
        if (ConstructPillButton(Style, Ink, "##ParticleLibraryClose", ImVec2(SheetMax.x - 120.0f * Scale, SheetMin.y + 18.0f * Scale), "Close (Esc)", false, "X", &Width))
            LibraryShown = false;
        // 📝 The search field in the inspector's inset look.
        ImGui::SetCursorScreenPos(ImVec2(SheetMax.x - 420.0f * Scale, SheetMin.y + 18.0f * Scale));
        ImGui::SetNextItemWidth(280.0f * Scale);
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 9.0f * Scale);
        ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(12.0f * Scale, 8.0f * Scale));
        ImGui::PushStyleColor(ImGuiCol_FrameBg, ImGui::ColorConvertU32ToFloat4(P.InsetFieldBg));
        ImGui::PushStyleColor(ImGuiCol_FrameBgHovered, ImGui::ColorConvertU32ToFloat4(P.InsetFieldBg));
        ImGui::PushStyleColor(ImGuiCol_FrameBgActive, ImGui::ColorConvertU32ToFloat4(P.InsetFieldBg));
        ImGui::PushStyleColor(ImGuiCol_Border, ImGui::ColorConvertU32ToFloat4(P.InsetFieldBorder));
        ImGui::PushStyleColor(ImGuiCol_Text, ImGui::ColorConvertU32ToFloat4(P.TextPrimary));
        ImGui::PushStyleColor(ImGuiCol_TextDisabled, ImGui::ColorConvertU32ToFloat4(P.TextMuted));
        ImGui::PushFont(Style.Pick(Style.Faces.Regular), 11.5f * Scale);
        ImGui::InputTextWithHint("##ParticleLibrarySearch", "Search presets", LibraryQuery, sizeof(LibraryQuery));
        ImGui::PopFont();
        ImGui::PopStyleColor(6);
        ImGui::PopStyleVar(3);

        float ChipX = Left;
        float ChipY = SheetMin.y + 74.0f * Scale;
        std::vector<std::string> Groups = { "All" };
        Groups.insert(Groups.end(), Library.Groups.begin(), Library.Groups.end());
        for (const std::string& Group : Groups)
        {
            const float W = Style.Measure(Style.Faces.Medium, 10.5f, Group.c_str()) + 20.0f * Scale;
            if (ChipX + W > SheetMax.x - 22.0f * Scale)
            {
                ChipX = Left;
                ChipY += 30.0f * Scale;
            }
            ImGui::SetCursorScreenPos(ImVec2(ChipX, ChipY));
            ImGui::PushID(Group.c_str());
            if (ImGui::InvisibleButton("##Chip", ImVec2(W, 24.0f * Scale))) LibraryGroup = Group;
            ImGui::PopID();
            const bool Active = LibraryGroup == Group;
            Ink->AddRectFilled(ImVec2(ChipX, ChipY), ImVec2(ChipX + W, ChipY + 24.0f * Scale), Active ? P.SegmentedActiveBg : P.CountCardBg, 12.0f * Scale);
            Style.Text(Ink, Style.Faces.Medium, 10.5f, ImVec2(ChipX + 10.0f * Scale, ChipY + 5.0f * Scale), Active ? P.TextPrimary : P.TextSecondary, Group.c_str());
            ChipX += W + 6.0f * Scale;
        }

        // 📝 The cards scroll in their own child.
        const ImVec2 CardsMin(Left, ChipY + 36.0f * Scale);
        const ImVec2 CardsMax(SheetMax.x - 22.0f * Scale, SheetMax.y - 16.0f * Scale);
        ImGui::SetCursorScreenPos(CardsMin);
        if (ImGui::BeginChild("##ParticleLibraryCards", ImVec2(CardsMax.x - CardsMin.x, CardsMax.y - CardsMin.y), ImGuiChildFlags_None,
                              ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoBackground))
        {
            ImDrawList*       Sheet  = ImGui::GetWindowDrawList();
            const ImVec2      Origin = ImGui::GetCursorScreenPos();
            const float       CardW  = (CardsMax.x - CardsMin.x - 20.0f * Scale) / 3.0f;
            const float       CardH  = 92.0f * Scale;
            const std::string Query  = Lowered(LibraryQuery);
            int               Shown  = 0;
            for (const ParticlePreset& Preset : Library.Presets)
            {
                if (LibraryGroup != "All" && Preset.Group != LibraryGroup) continue;
                if (!Query.empty() && Lowered(Preset.Name + " " + Preset.Group + " " + Preset.Blurb).find(Query) == std::string::npos) continue;
                const int    Column = Shown % 3, Line = Shown / 3;
                const ImVec2 CardMin(Origin.x + Column * (CardW + 10.0f * Scale), Origin.y + Line * (CardH + 10.0f * Scale));
                const ImVec2 CardMax(CardMin.x + CardW, CardMin.y + CardH);
                ImGui::SetCursorScreenPos(CardMin);
                ImGui::PushID(Preset.Identifier.c_str());
                if (ImGui::InvisibleButton("##Card", ImVec2(CardW, CardH))) Requests.push_back("add:" + Preset.Identifier);
                const bool Hovered = ImGui::IsItemHovered();
                ImGui::PopID();
                Sheet->AddRectFilled(CardMin, CardMax, Hovered ? P.RowHoverBg : P.CountCardBg, 12.0f * Scale);
                Sheet->AddRect(CardMin, CardMax, Hovered ? P.RowSelectedBorder : P.CountCardBorder, 12.0f * Scale);
                Sheet->AddRectFilled(ImVec2(CardMin.x + 12.0f * Scale, CardMin.y + 12.0f * Scale), ImVec2(CardMin.x + 38.0f * Scale, CardMin.y + 38.0f * Scale),
                                     DisplayColour(Preset.Parameters.ColourA, 0.25f), 8.0f * Scale);
                GlyphSymbol::Construct(Sheet, ResolveGroupGlyph(Preset.Group), ImVec2(CardMin.x + 17.0f * Scale, CardMin.y + 17.0f * Scale), 16.0f * Scale, 1.4f,
                                       DisplayColour(Preset.Parameters.ColourA));
                Style.Text(Sheet, Style.Faces.Medium, 12.5f, ImVec2(CardMin.x + 48.0f * Scale, CardMin.y + 11.0f * Scale), P.TextPrimary, Preset.Name.c_str());
                char Facts[96];
                std::snprintf(Facts, sizeof(Facts), "%s \xC2\xB7 %s", Preset.Group.c_str(), ResolveParticleBehaviourLabel(Preset.Parameters.Behaviour));
                Style.Text(Sheet, Style.Faces.Regular, 10.0f, ImVec2(CardMin.x + 48.0f * Scale, CardMin.y + 28.0f * Scale), P.TextSecondary, Facts);
                Sheet->PushClipRect(ImVec2(CardMin.x + 12.0f * Scale, CardMin.y + 46.0f * Scale), ImVec2(CardMax.x - 10.0f * Scale, CardMax.y - 8.0f * Scale), true);
                Sheet->AddText(Style.Pick(Style.Faces.Regular), 10.0f * Scale, ImVec2(CardMin.x + 12.0f * Scale, CardMin.y + 48.0f * Scale), P.TextMuted,
                               Preset.Blurb.c_str(), nullptr, CardW - 24.0f * Scale);
                Sheet->PopClipRect();
                ++Shown;
            }
            ImGui::SetCursorScreenPos(ImVec2(Origin.x, Origin.y + ((Shown + 2) / 3) * (CardH + 10.0f * Scale)));
            ImGui::Dummy(ImVec2(1.0f, 4.0f * Scale));
        }
        ImGui::EndChild();
    }
    ImGui::EndChild();
    ImGui::PopStyleVar();
}

} // namespace Frontier

#endif
