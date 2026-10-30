/*====================================================================================================================================
                                                      INFOGRAPHICWIDGETS.H
====================================================================================================================================*/
// 🧩 Interactive statistical infographic widgets inspired by SourceImages/General UI & Telemetry references,
//    drawn natively with ImDrawList + KitFaces so every component adapts seamlessly to active ControlCentre themes.

#pragma once

#include <cstddef>
#include <cstdint>

namespace Frontier::Drive::Infographics
{

struct KpiBadgeItem
{
    const char *Label     = "";         // [text] - Uppercase micro-caption
    const char *Value     = "";         // [text] - Primary numeric readout
    const char *SubLabel  = "";         // [text] - Secondary unit / delta note
    uint32_t    AccentHex = 0x38bdf8u;  // [rgb]  - 0xRRGGBB accent colour
};

struct SegmentSlice
{
    const char *Label     = "";         // [text] - Segment legend name
    float       Fraction  = 0.0f;       // [0..1] - Normalised share
    uint32_t    ColourHex = 0x38bdf8u;  // [rgb]  - Segment colour
};

// Full-width row of 2 or 3 statistical KPI cards.
void DrawKpiRow(const KpiBadgeItem *Items, size_t Count);

// Multi-segment proportional distribution bar + interactive hover legend (SourceImages/General UI budget/storage cards).
void DrawSegmentedDistributionCard(const char *Title, const char *RightSummary,
                                   const SegmentSlice *Slices, size_t SliceCount);

// Filled area telemetry sparkline card with live hover scrub readout.
void DrawSparklineCard(const char *Title, const char *LiveReadout,
                       const float *Samples, size_t SampleCount,
                       float MinValue, float MaxValue, uint32_t AccentHex);

// Twin 270-degree radial arc gauges inside a statistical card (RPM / Speed / Solver / Tyre Temp).
void DrawTwinRadialGauges(const char *LeftTitle, float LeftVal, float LeftMin, float LeftMax, const char *LeftUnit, uint32_t LeftHex,
                          const char *RightTitle, float RightVal, float RightMin, float RightMax, const char *RightUnit, uint32_t RightHex);

// Polar azimuth compass rose with wind vector + gust envelope (Forcefield / Hailstorm).
void DrawPolarVectorCompass(const char *Title, float AzimuthDeg, float SpeedMps, float GustMps,
                            const char *RightBadge, uint32_t AccentHex);

// Blackbody combustion temperature gradient ramp (293 K -> 2000 K) with live peak marker for PlumeFluid / Sparks.
void DrawBlackbodyRampCard(const char *Title, float PeakKelvin, float ActiveVoxelsPct);

// 2D heightfield cross-section profile card for SnowSurface single-mesh (CC=1) mound & ShallowWater puddles.
void DrawProfileCrossSectionCard(const char *Title, const char *RightBadge,
                                 const float *ProfileHeights, size_t Count,
                                 float MaxHeightScale, uint32_t FillHex);

// 4-corner vehicle wheel/tyre thermal & slip matrix card (1:1 VehicleHMI + GRIT .tyrx telemetry).
void DrawQuadWheelMatrixCard(const float TempCelsius[4], const float LoadKn[4], const float SlipRatio[4]);

} // namespace Frontier::Drive::Infographics
