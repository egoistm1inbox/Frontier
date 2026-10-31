/*==========================================================================================================================================
                                                         EVERESTINTERFACEKIT.H
==========================================================================================================================================*/
// 🧩 Pixel-accurate 1:1 VehicleHMI editor controls, cards, and vector instruments built on ControlKit and TypefaceRegistry.

#pragma once

#if defined(FRONTIER_WITH_INTERFACE_SDK)

#include "Engine/Interface/StackRailControls.h"

#include <imgui.h>

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    DESIGN TOKENS
//------------------------------------------------------------------------------------------------------------------------

struct EverestSurfaceTokens
{
    ImU32 Ground          = 0; // [rgba] - #101010 root ground
    ImU32 Column          = 0; // [rgba] - #161616 Outliner / Inspector column surface
    ImU32 ColumnHeader    = 0; // [rgba] - #181818 top bar surface
    ImU32 StatusStrip     = 0; // [rgba] - #0d0d0d 28 px status strip
    ImU32 CardTop         = 0; // [rgba] - #222222 card upper gradient stop
    ImU32 CardBottom      = 0; // [rgba] - #1f1f1f card lower gradient stop
    ImU32 Inset           = 0; // [rgba] - #171717 recessed field / segmented tray
    ImU32 StatCell        = 0; // [rgba] - #181818 statistic cell
    ImU32 ReadoutBox      = 0; // [rgba] - #151515 diagnostic readout surface
    ImU32 RowHover        = 0; // [rgba] - hovered Outliner row
    ImU32 RowSelectedTop  = 0; // [rgba] - #333333 selected Outliner row top
    ImU32 RowSelectedBot  = 0; // [rgba] - #292929 selected Outliner row bottom
    ImU32 Edge            = 0; // [rgba] - #2a2a2a 1 px structural border
    ImU32 EdgeSubtle      = 0; // [rgba] - #232323 subtle inner border
    ImU32 TextPrimary     = 0; // [rgba] - #dcdcdc primary copy
    ImU32 TextSoft        = 0; // [rgba] - #b4b4b4 secondary label
    ImU32 TextMuted       = 0; // [rgba] - #7d7d7d explanatory copy
    ImU32 TextFaint       = 0; // [rgba] - #5c5c5c hint / disabled copy
    ImU32 ActivePillFill  = 0; // [rgba] - #ececec active category pill
    ImU32 ActivePillInk   = 0; // [rgba] - #121212 active category text
    ImU32 AccentNeutral   = 0; // [rgba] - #c5c5c5 slider active fill
    ImU32 LiveGreen       = 0; // [rgba] - #3ec46d live / enabled indicator
    ImU32 LiveGreenDim    = 0; // [rgba] - translucent live pill background
    ImU32 WarmAmber       = 0; // [rgba] - #e0a24a warm / warning indicator
    ImU32 WarmAmberDim    = 0; // [rgba] - translucent warm pill background
    ImU32 DangerCoral     = 0; // [rgba] - #ff6b6b destructive button / alert
    ImU32 DangerCoralDim  = 0; // [rgba] - translucent danger surface
    ImU32 PropSwitchOn    = 0; // [rgba] - #2f6d45 property pill enabled
    ImU32 PropSwitchOff   = 0; // [rgba] - #cc7673 property pill disabled
    float ScaleFactor     = 1.0f; // [-] - ControlCentre interface scale multiplier
};

enum class EverestGlyphCategory : uint8_t
{
    Boxes        = 0,
    Zap          = 1,
    Aperture     = 2,
    Monitor      = 3,
    Sparkles     = 4,
    Bug          = 5,
    Activity     = 6,
    GridLattice  = 7,
    LayoutGrid   = 8,
    Sunrise      = 9,
    Orbit        = 10,
    Lightbulb    = 11,
    CloudFog     = 12,
    Wind         = 13,
    Car          = 14,
    Shield       = 15,
    Gauge        = 16,
    CircleDot    = 17,
    MoveVertical = 18,
    Sun          = 19,
    Camera       = 20,
    Eye          = 21,
    EyeOff       = 22,
    Flame        = 23,
    Droplets     = 24,
    Gem          = 25,
    Layers       = 26,
    Scan         = 27,
    RotateCcw    = 28,
    Trash2       = 29,
    Hammer       = 30,
    Cone         = 31,
    MapPin       = 32,
};

enum class EverestButtonStyle : uint8_t
{
    Secondary = 0, // [-] - Standard dark bordered pill button
    Primary   = 1, // [-] - High-contrast light fill button
    Danger    = 2, // [-] - Coral destructive action button
    Studio    = 3, // [-] - Accent-tinted dedicated studio launcher
};

struct EverestStatisticCell
{
    const char *Caption = ""; // [text] - Uppercase metric title
    std::string Reading = ""; // [text] - Formatted numeric reading + unit
};

struct EverestPropertyToggle
{
    const char *Caption = "";      // [text] - Short pill title (Shadows, Spot, Disc, Haze, Aerial)
    bool       *Enabled = nullptr; // [-] - Bound boolean toggle
};

struct EverestMaterialChip
{
    const char *Caption         = "";        // [text] - Material display title
    uint32_t    SwatchColourRgb = 0x8fb3a4u; // [rgb] - Leading swatch dot colour
};

struct EverestActionButton
{
    const char          *Caption = "";                           // [text] - Button label
    EverestGlyphCategory Glyph   = EverestGlyphCategory::Layers; // [-] - Leading vector icon
    EverestButtonStyle   Style   = EverestButtonStyle::Secondary;// [-] - Visual tone
};

struct EverestCardRegion
{
    ImVec2 Origin{0.0f, 0.0f};      // [px] - Card top-left screen position
    float  Width          = 0.0f;   // [px] - Outer card width
    float  InnerLeft      = 0.0f;   // [px] - Content left coordinate
    float  InnerWidth     = 0.0f;   // [px] - Content inner width
    float  CursorY        = 0.0f;   // [px] - Advancing vertical cursor inside card
    int    BackgroundChan = 0;      // [-] - ImDrawList splitter channel reservation
    uint32_t AccentRgb    = 0u;     // [rgb] - Card accent colour
};

//------------------------------------------------------------------------------------------------------------------------
//                                                 TOKEN & GLYPH ACCESS
//------------------------------------------------------------------------------------------------------------------------

[[nodiscard]] EverestSurfaceTokens ResolveEverestTokens() noexcept;
[[nodiscard]] ImU32                ConvertRgbToInk(uint32_t Rgb, int Alpha = 255) noexcept;
void PaintEverestGlyph(ImDrawList *Canvas, EverestGlyphCategory Glyph, ImVec2 Centre, float Extent, ImU32 Colour);

void PaintTrackedLabel(ImDrawList *Canvas, ImFont *Font, float FontSize, ImVec2 Origin, ImU32 Colour,
                       const char *Caption, float TrackingPixels);

void PaintChevronGlyph(ImDrawList *Canvas, ImVec2 Centre, float HalfExtent, int DirectionIndex, ImU32 Colour);

//------------------------------------------------------------------------------------------------------------------------
//                                                 INSPECTOR CHROME
//------------------------------------------------------------------------------------------------------------------------

// 44 px .inspector-top bar ("Inspector > <Group>" + "Changes apply live" or optional Studio button). Returns Studio click.
bool ConstructInspectorTopBar(const KitFaces &Faces, const EverestSurfaceTokens &Tokens, ImVec2 Origin, float Width,
                              const char *GroupCaption, const char *StudioButtonCaption = nullptr);

// .object-header block: uppercase eyebrow, 19 px title, and interactive .enabled-pill. Returns true if enabled toggled.
bool ConstructInspectorIdentity(const KitFaces &Faces, const EverestSurfaceTokens &Tokens, ImVec2 Origin, float Width,
                                const char *EyebrowCaption, const char *TitleCaption, uint32_t AccentRgb,
                                bool &EnabledCondition, float &OutConsumedHeight);

// Multi-row wrapping pill tab bar (.inspector-categories / .vs-system-nav / .vs-wheel-nav / .vs-tyre-nav).
bool ConstructCategoryTabStrip(const KitFaces &Faces, const EverestSurfaceTokens &Tokens, const char *StripIdentifier,
                               ImVec2 Origin, float Width, const char *const *Captions, size_t Count,
                               size_t &SelectedIndex, float &OutConsumedHeight);

// .property-switches pill bar (#2f6d45 ON / #cc7673 OFF).
bool ConstructPropertySwitchRow(const KitFaces &Faces, const EverestSurfaceTokens &Tokens, const char *RowIdentifier,
                                ImVec2 Origin, float Width, const EverestPropertyToggle *Toggles, size_t Count,
                                float &OutConsumedHeight);

//------------------------------------------------------------------------------------------------------------------------
//                                                  MODULAR CARDS
//------------------------------------------------------------------------------------------------------------------------

// Opens a 18 px rounded gradient .card using a 2-channel ImDrawList splitter so background wraps dynamic height cleanly.
EverestCardRegion BeginEverestCard(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                                   ImVec2 Origin, float Width, const char *TitleCaption, EverestGlyphCategory Glyph,
                                   uint32_t AccentRgb, int CardOrdinal = 0, const char *SubtitleCaption = nullptr);

// Seals the card background + border and returns total outer height consumed (including trailing 10 px gap).
float EndEverestCard(ImDrawList *Canvas, const EverestSurfaceTokens &Tokens, EverestCardRegion &Card);

void ConstructHeroMetric(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                         EverestCardRegion &Card, const char *PrimaryFigure, const char *UnitCaption,
                         const char *PillCaption = nullptr, bool WarmTone = false);

void ConstructMutedParagraph(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                             EverestCardRegion &Card, const char *ParagraphText);

bool ConstructPrecisionSlider(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                              EverestCardRegion &Card, const char *ControlIdentifier, const char *Caption,
                              float &ScalarReading, float MinimumLimit, float MaximumLimit, const char *UnitSuffix,
                              int DecimalPlaces = 2, const char *LowHint = nullptr, const char *HighHint = nullptr);

bool ConstructCapsuleSlider(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                            EverestCardRegion &Card, const char *ControlIdentifier, const char *Caption,
                            float &ScalarReading, float MinimumLimit, float MaximumLimit, const char *UnitSuffix,
                            int DecimalPlaces = 2);

bool ConstructToggleRow(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                        EverestCardRegion &Card, const char *ControlIdentifier, const char *Caption,
                        bool &EnabledCondition, const char *DetailCaption = nullptr);

bool ConstructSegmentedRow(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                           EverestCardRegion &Card, const char *ControlIdentifier, const char *LabelCaption,
                           const char *const *OptionCaptions, size_t OptionCount, size_t &SelectedIndex);

bool ConstructDropdownRow(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                          EverestCardRegion &Card, const char *PopupIdentifier, const char *LabelCaption,
                          const char *const *OptionCaptions, size_t OptionCount, size_t &SelectedIndex);

void ConstructStatisticRow(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                           EverestCardRegion &Card, const EverestStatisticCell *Cells, size_t CellCount);

void ConstructMonospaceReadout(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                               EverestCardRegion &Card, const std::vector<std::string> &Lines);

bool ConstructMaterialChips(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                            EverestCardRegion &Card, const char *GridIdentifier, const EverestMaterialChip *Chips,
                            size_t ChipCount, size_t &SelectedIndex);

// Returns index of clicked button, or -1 if none clicked.
int ConstructActionButtons(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                           EverestCardRegion &Card, const char *RowIdentifier, const EverestActionButton *Buttons,
                           size_t ButtonCount);

bool ConstructWorldTransformCard(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                                 ImVec2 Origin, float Width, uint32_t AccentRgb, float Coordinates[3],
                                 bool &OutFocusRequested, float &OutConsumedHeight);

//------------------------------------------------------------------------------------------------------------------------
//                                               VECTOR INSTRUMENTS
//------------------------------------------------------------------------------------------------------------------------

void ConstructSunArcInstrument(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                               EverestCardRegion &Card, float ElevationDegrees, float AzimuthDegrees);

void ConstructTorqueCurveInstrument(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                                    EverestCardRegion &Card, float CurrentEngineRpm);

void ConstructCollisionHullInstrument(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                                      EverestCardRegion &Card, bool OverlayActive);

void ConstructSmokeDecayInstrument(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                                   EverestCardRegion &Card, float DissipationRate, float CoolingRate);

void ConstructBlackbodyRampInstrument(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                                      EverestCardRegion &Card, float TipKelvin, float CoreKelvin);

void ConstructImpactBreakInstrument(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                                    EverestCardRegion &Card, float ReducedMassKg, float ThresholdJoules);

void ConstructInspectorFooter(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                              ImVec2 Origin, float Width, const char *LeftCaption, const char *RightCaption);

} // namespace Frontier

#endif // FRONTIER_WITH_INTERFACE_SDK
