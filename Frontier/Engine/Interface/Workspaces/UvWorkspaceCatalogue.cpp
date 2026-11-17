/*==========================================================================================================================================
                                                          UVWORKSPACECATALOGUE.CPP
==========================================================================================================================================*/
// 🧩 Pinned UV catalogues (4 sample assets, importance groups, UDIM tiles, all 85 islands with Node-measured face
//    counts, texel densities, UV areas, bounds, tile homes, and group assignments, plus the 4 selection modes, 8
//    tools, 6 overlay lenses, and 7 3D shadings) plus the shell-local closed-form derivations: per-group actual
//    area shares, remainder pool share, per-tile occupancy, and the clean overlap/flip diagnostics. Deterministic
//    in the pinned tables; no solver calls. Island census was measured with Node over
//    Experimental Remastered/UVEditor/Engine/SampleAssets.js (coupe 30, crate 20, bust 15, udim_kit 20).

#include "Frontier/Engine/Interface/Workspaces/UvWorkspace.h"
#include "Frontier/Engine/Interface/Controls/Toast.h"

#include <cmath>
#include <cstdio>
#include <cstring>

namespace Frontier
{
namespace
{

const UvAssetSpec Assets[] = {
    { "coupe", "Aero Coupe GT", "30 islands · 70/10/Rest demo", 380, 285, 109, 5.50, 17.72 },
    { "crate", "Tactical Crate", "20 islands · Hard-surface quads", 120, 90, 98, 4.77, 0.00 },
    { "bust", "Armored Bust", "15 islands · Organic LSCM + trim", 322, 254, 80, 14.57, 16.77 },
    { "udim_kit", "UDIM Arch Kit", "4 UDIMs (1001–1004) · Multi-res", 215, 170, 107, 7.48, 15.06 },
};

const UvGroupSpec Groups_coupe[] = {
    { "hero", "Hero Body Panels", 70.0, 0xEFF4CFFF, 1001 },
    { "secondary", "Trim & Glass", 10.0, 0x9ECFFFFF, 1001 },
};

const UvGroupSpec Groups_crate[] = {
    { "hero", "Hull & Lid Panels", 65.0, 0xEFF4CFFF, 1001 },
    { "secondary", "Corner Bumpers", 18.0, 0x9ECFFFFF, 1001 },
};

const UvGroupSpec Groups_bust[] = {
    { "hero", "Head & Armor Hero", 72.0, 0xEFF4CFFF, 1001 },
    { "secondary", "Straps & Buckles", 12.0, 0x9ECFFFFF, 1001 },
};

const UvGroupSpec Groups_udim_kit[] = {
    { "arch", "1001 · Stone Arch", 100.0, 0xEFF4CFFF, 1001 },
    { "columns", "1002 · Marble Columns", 100.0, 0x9ECFFFFF, 1002 },
    { "timber", "1003 · Timber Door", 100.0, 0xE8C27AFF, 1003 },
    { "hardware", "1004 · Iron Hardware", 100.0, 0x9BDAC5FF, 1004 },
};

const UvTileSpec Tiles_coupe[] = {
    { 1001, "Main Chassis Atlas", 4096, "color" },
    { 1002, "Aux Wheels & Decals", 2048, "uv" },
};

const UvTileSpec Tiles_crate[] = {
    { 1001, "Crate Atlas", 2048, "color" },
};

const UvTileSpec Tiles_bust[] = {
    { 1001, "Character Head & Torso", 4096, "color" },
};

const UvTileSpec Tiles_udim_kit[] = {
    { 1001, "Stone Archway", 4096, "color" },
    { 1002, "Marble Columns", 2048, "uv" },
    { 1003, "Timber Door", 2048, "checker" },
    { 1004, "Iron Hardware", 1024, "color" },
};

static const UvIslandSpec Islands_coupe[] = {
    { "Hood Hero", 20, 10.8, 12.1, 1001, 0, 0.0069f, 0.0069f, 0.3784f, 0.3319f },
    { "Roof Shell", 12, 10.8, 8.6, 1001, 0, 0.0069f, 0.6389f, 0.3157f, 0.9182f },
    { "Left Flank & Door", 18, 10.8, 11.8, 1001, 0, 0.3854f, 0.2361f, 0.9152f, 0.4583f },
    { "Right Flank & Door", 18, 10.8, 11.8, 1001, 0, 0.3854f, 0.0069f, 0.9152f, 0.2291f },
    { "Rear Decklid", 15, 10.8, 9.4, 1001, 0, 0.3750f, 0.4653f, 0.7468f, 0.7188f },
    { "Windshield", 8, 4.3, 1.1, 1001, 1, 0.8056f, 0.6250f, 0.8878f, 0.7542f },
    { "Rear Glass", 8, 4.3, 0.8, 1001, 1, 0.8021f, 0.4653f, 0.8717f, 0.5830f },
    { "Front Splitter", 6, 4.3, 1.9, 1001, 1, 0.3229f, 0.7292f, 0.6907f, 0.8148f },
    { "Rear Diffuser", 6, 4.3, 2.0, 1001, 1, 0.8924f, 0.2813f, 0.9843f, 0.6532f },
    { "GT Rear Wing", 6, 4.3, 1.1, 1001, 1, 0.7569f, 0.4653f, 0.7966f, 0.7766f },
    { "Wing Endplate L", 6, 4.3, 0.2, 1001, 1, 0.6354f, 0.8403f, 0.7148f, 0.8925f },
    { "Wing Endplate R", 6, 4.3, 0.2, 1001, 1, 0.4861f, 0.8472f, 0.5384f, 0.9266f },
    { "Mirror L", 6, 4.3, 0.1, 1001, 1, 0.9549f, 0.7222f, 0.9883f, 0.7786f },
    { "Mirror R", 6, 4.3, 0.1, 1001, 1, 0.8542f, 0.8785f, 0.9106f, 0.9119f },
    { "Front Grille", 6, 4.3, 0.2, 1001, 1, 0.9479f, 0.1458f, 0.9834f, 0.2837f },
    { "Front Left Tyre", 12, 4.6, 0.7, 1001, -1, 0.9236f, 0.0069f, 0.9746f, 0.1364f },
    { "Front Left Tyre Rim", 12, 4.6, 0.4, 1001, -1, 0.8368f, 0.7986f, 0.9103f, 0.8721f },
    { "Front Right Tyre", 12, 4.6, 0.7, 1001, -1, 0.8958f, 0.6632f, 0.9468f, 0.7927f },
    { "Front Right Tyre Rim", 12, 4.6, 0.4, 1001, -1, 0.9167f, 0.8264f, 0.9901f, 0.8999f },
    { "Rear Left Tyre", 12, 4.6, 0.7, 1001, -1, 0.6979f, 0.7847f, 0.8274f, 0.8357f },
    { "Rear Left Tyre Rim", 12, 4.6, 0.4, 1001, -1, 0.3229f, 0.8229f, 0.3964f, 0.8964f },
    { "Rear Right Tyre", 12, 4.6, 0.7, 1001, -1, 0.5174f, 0.7951f, 0.6468f, 0.8461f },
    { "Rear Right Tyre Rim", 12, 4.6, 0.4, 1001, -1, 0.4063f, 0.8229f, 0.4797f, 0.8964f },
    { "Undertray", 6, 4.6, 10.2, 1001, -1, 0.0069f, 0.3403f, 0.3654f, 0.6297f },
    { "Headlight L", 6, 4.6, 0.2, 1001, -1, 0.3229f, 0.6389f, 0.3630f, 0.7168f },
    { "Headlight R", 6, 4.6, 0.2, 1001, -1, 0.7222f, 0.8438f, 0.8001f, 0.8838f },
    { "Taillight L", 6, 4.6, 0.1, 1001, -1, 0.5486f, 0.8611f, 0.6332f, 0.8923f },
    { "Taillight R", 6, 4.6, 0.1, 1001, -1, 0.9549f, 0.6285f, 0.9860f, 0.7131f },
    { "Exhaust L", 6, 4.6, 0.1, 1001, -1, 0.6910f, 0.7292f, 0.7355f, 0.7692f },
    { "Exhaust R", 6, 4.6, 0.1, 1001, -1, 0.8021f, 0.8646f, 0.8466f, 0.9047f },
};
static_assert(sizeof(Islands_coupe)/sizeof(Islands_coupe[0]) == 30, "island pin drift");

static const UvIslandSpec Islands_crate[] = {
    { "Crate Hull", 1, 3.4, 4.4, 1001, 0, 0.4583f, 0.1979f, 0.7065f, 0.3740f },
    { "Crate Hull · 02", 1, 3.4, 4.4, 1001, 0, 0.7153f, 0.1979f, 0.9634f, 0.3740f },
    { "Crate Hull · 03", 1, 3.4, 4.5, 1001, 0, 0.4583f, 0.0069f, 0.7065f, 0.1880f },
    { "Crate Hull · 04", 1, 3.4, 4.5, 1001, 0, 0.7153f, 0.0069f, 0.9634f, 0.1880f },
    { "Crate Hull · 05", 1, 3.4, 3.2, 1001, 0, 0.0069f, 0.4306f, 0.1880f, 0.6066f },
    { "Crate Hull · 06", 1, 3.4, 3.2, 1001, 0, 0.1979f, 0.4896f, 0.3790f, 0.6656f },
    { "Reinforced Lid", 6, 3.4, 12.7, 1001, 0, 0.0069f, 0.0069f, 0.4496f, 0.3289f },
    { "Data Nameplate", 6, 3.4, 1.5, 1001, 0, 0.0069f, 0.6146f, 0.2249f, 0.7554f },
    { "Foot Guard 1", 6, 4.9, 1.6, 1001, 1, 0.8021f, 0.3854f, 0.9588f, 0.5944f },
    { "Lid Corner 1", 6, 4.9, 1.0, 1001, 1, 0.7882f, 0.6771f, 0.9069f, 0.8386f },
    { "Foot Guard 2", 6, 4.9, 1.6, 1001, 1, 0.5347f, 0.5000f, 0.7437f, 0.6567f },
    { "Lid Corner 2", 6, 4.9, 1.0, 1001, 1, 0.3715f, 0.7292f, 0.4903f, 0.8907f },
    { "Foot Guard 3", 6, 4.9, 1.6, 1001, 1, 0.3889f, 0.5625f, 0.5979f, 0.7192f },
    { "Lid Corner 3", 6, 4.9, 1.0, 1001, 1, 0.0069f, 0.7847f, 0.1684f, 0.9035f },
    { "Foot Guard 4", 6, 4.9, 1.6, 1001, 1, 0.7049f, 0.5625f, 0.9139f, 0.7192f },
    { "Lid Corner 4", 6, 4.9, 1.0, 1001, 1, 0.6910f, 0.7292f, 0.8097f, 0.8907f },
    { "Latch L", 6, 7.2, 1.5, 1001, -1, 0.5035f, 0.6667f, 0.7154f, 0.8716f },
    { "Latch R", 6, 7.2, 1.5, 1001, -1, 0.1563f, 0.6736f, 0.3611f, 0.8856f },
    { "Grip Handle L", 6, 7.2, 3.5, 1001, -1, 0.0208f, 0.3194f, 0.4589f, 0.4819f },
    { "Grip Handle R", 6, 7.2, 3.5, 1001, -1, 0.4063f, 0.3819f, 0.8443f, 0.5444f },
};
static_assert(sizeof(Islands_crate)/sizeof(Islands_crate[0]) == 20, "island pin drift");

static const UvIslandSpec Islands_bust[] = {
    { "Head & Face Hero", 140, 15.5, 26.6, 1001, 0, 0.0069f, 0.0069f, 0.5230f, 0.5230f },
    { "Chestplate Front", 15, 15.5, 7.8, 1001, 0, 0.5313f, 0.3021f, 0.8485f, 0.5473f },
    { "Backplate", 15, 15.5, 7.4, 1001, 0, 0.0069f, 0.5313f, 0.3179f, 0.7682f },
    { "Pauldron L", 12, 15.5, 2.8, 1001, 0, 0.3264f, 0.5313f, 0.5116f, 0.6817f },
    { "Pauldron R", 12, 15.5, 2.8, 1001, 0, 0.5208f, 0.5556f, 0.7061f, 0.7060f },
    { "Strap 1", 6, 15.2, 1.4, 1001, 1, 0.6215f, 0.6007f, 0.8584f, 0.8302f },
    { "Buckle 1", 6, 15.2, 0.6, 1001, 1, 0.8785f, 0.2153f, 0.9747f, 0.3337f },
    { "Strap 2", 6, 15.2, 1.4, 1001, 1, 0.2118f, 0.6910f, 0.4413f, 0.9279f },
    { "Buckle 2", 6, 15.2, 0.6, 1001, 1, 0.8576f, 0.3125f, 0.9539f, 0.4310f },
    { "Strap 3", 6, 15.2, 1.4, 1001, 1, 0.4514f, 0.7153f, 0.6883f, 0.9448f },
    { "Buckle 3", 6, 15.2, 0.6, 1001, 1, 0.8681f, 0.6806f, 0.9865f, 0.7768f },
    { "Strap 4", 6, 15.2, 1.4, 1001, 1, 0.6806f, 0.7431f, 0.9175f, 0.9726f },
    { "Buckle 4", 6, 15.2, 0.6, 1001, 1, 0.0069f, 0.7778f, 0.1254f, 0.8740f },
    { "Plinth Pedestal", 6, 9.8, 8.2, 1001, -1, 0.5313f, 0.0069f, 0.9149f, 0.2947f },
    { "Neck Collar", 6, 9.8, 2.4, 1001, -1, 0.8194f, 0.4410f, 0.9729f, 0.6712f },
};
static_assert(sizeof(Islands_bust)/sizeof(Islands_bust[0]) == 15, "island pin drift");

static const UvIslandSpec Islands_udim_kit[] = {
    { "Arch Voussoirs", 32, 13.2, 14.1, 1001, 0, 0.0069f, 0.3958f, 0.5836f, 0.6409f },
    { "Carved Keystone", 6, 13.2, 11.6, 1001, 0, 0.2847f, 0.5972f, 0.9047f, 0.9912f },
    { "Plinth Left", 6, 13.2, 15.3, 1001, 0, 0.0069f, 0.0069f, 0.5882f, 0.3880f },
    { "Plinth Right", 6, 13.2, 15.3, 1001, 0, 0.5972f, 0.0069f, 0.9783f, 0.5882f },
    { "Column Left", 12, 7.1, 18.8, 1002, 1, 1.0069f, 0.0069f, 1.7076f, 0.2750f },
    { "Column Left Rim", 12, 7.1, 1.7, 1002, 1, 1.7153f, 0.0069f, 1.8678f, 0.1595f },
    { "Column Right", 12, 7.1, 18.8, 1002, 1, 1.0069f, 0.2847f, 1.7076f, 0.5528f },
    { "Column Right Rim", 12, 7.1, 1.7, 1002, 1, 1.8403f, 0.1076f, 1.9928f, 0.2602f },
    { "Capital Left", 6, 7.1, 12.1, 1002, 1, 1.0069f, 0.5625f, 1.5186f, 0.8875f },
    { "Capital Right", 6, 7.1, 12.1, 1002, 1, 1.6493f, 0.3090f, 1.9743f, 0.8207f },
    { "Door Plank 1", 6, 3.0, 4.3, 1003, 2, 2.3264f, 0.0382f, 2.8887f, 0.5816f },
    { "Door Plank 2", 6, 3.0, 4.3, 1003, 2, 2.0069f, 0.0069f, 2.5693f, 0.5503f },
    { "Door Plank 3", 6, 3.0, 4.3, 1003, 2, 2.0556f, 0.3403f, 2.5989f, 0.9026f },
    { "Door Plank 4", 6, 3.0, 4.3, 1003, 2, 2.3958f, 0.3889f, 2.9582f, 0.9323f },
    { "Crossbeam Low", 6, 3.0, 1.9, 1003, 2, 2.6458f, 0.0903f, 2.9409f, 0.1662f },
    { "Crossbeam High", 6, 3.0, 1.9, 1003, 2, 2.6458f, 0.0069f, 2.9409f, 0.0829f },
    { "Iron Strap Low", 6, 9.1, 14.4, 1004, 3, 3.0139f, 0.0139f, 3.6868f, 0.2972f },
    { "Iron Strap High", 6, 9.1, 14.4, 1004, 3, 3.0139f, 0.3125f, 3.6868f, 0.5958f },
    { "Lock Escutcheon", 6, 9.1, 9.3, 1004, 3, 3.4375f, 0.4167f, 3.9687f, 0.9302f },
    { "Ring Pull", 6, 9.1, 4.7, 1004, 3, 3.6076f, 0.0486f, 3.9618f, 0.3851f },
};
static_assert(sizeof(Islands_udim_kit)/sizeof(Islands_udim_kit[0]) == 20, "island pin drift");

const char* SelectionModes[] = { "1 Vert", "2 Edge", "3 Face", "4 Island" };
const char* Tools[]          = { "Tweak Select (W)", "Grab / Move (G)",   "Rotate (R)", "Scale (S)",
                                 "Box Select (B)",   "Circle Select (C)", "Seam Brush (K)", "Place 2D Cursor" };
const char* Lenses[]         = { "Importance Zones", "Clean Wireframe", "Texel Density",
                                 "Angle Stretch", "Area Stretch", "Overlaps & Flipped" };
const char* Shades[]         = { "UV Checker", "Flat Shaded", "Matcap Clay", "Matcap Satin",
                                 "Importance", "Texel Density", "UV Stretch" };

struct AssetTables
{
    const UvGroupSpec*  Groups;
    int                 GroupCount;
    const UvTileSpec*   Tiles;
    int                 TileCount;
    const UvIslandSpec* Islands;
    int                 IslandCount;
};

#define UV_ASSET_TABLES(Name)                                                                                          \
    { Groups_##Name, static_cast<int>(sizeof(Groups_##Name) / sizeof(Groups_##Name[0])), Tiles_##Name,                 \
      static_cast<int>(sizeof(Tiles_##Name) / sizeof(Tiles_##Name[0])), Islands_##Name,                                \
      static_cast<int>(sizeof(Islands_##Name) / sizeof(Islands_##Name[0])) }

const AssetTables Tables[] = {
    UV_ASSET_TABLES(coupe),
    UV_ASSET_TABLES(crate),
    UV_ASSET_TABLES(bust),
    UV_ASSET_TABLES(udim_kit),
};

int ClampAsset(int Asset) noexcept
{
    return Asset < 0 || Asset >= 4 ? 0 : Asset;
}

} // namespace

int QueryUvAssetCount() noexcept
{
    return 4;
}

const UvAssetSpec& QueryUvAsset(int Index) noexcept
{
    return Assets[ClampAsset(Index)];
}

int QueryUvGroupCount(int Asset) noexcept
{
    return Tables[ClampAsset(Asset)].GroupCount;
}

const UvGroupSpec& QueryUvGroup(int Asset, int Index) noexcept
{
    const AssetTables& T = Tables[ClampAsset(Asset)];
    return T.Groups[Index < 0 || Index >= T.GroupCount ? 0 : Index];
}

int QueryUvTileCount(int Asset) noexcept
{
    return Tables[ClampAsset(Asset)].TileCount;
}

const UvTileSpec& QueryUvTile(int Asset, int Index) noexcept
{
    const AssetTables& T = Tables[ClampAsset(Asset)];
    return T.Tiles[Index < 0 || Index >= T.TileCount ? 0 : Index];
}

int QueryUvTileIndex(int Asset, int UdimId) noexcept
{
    const AssetTables& T = Tables[ClampAsset(Asset)];
    for (int I = 0; I < T.TileCount; ++I)
        if (T.Tiles[I].Id == UdimId) return I;
    return -1;
}

int QueryUvIslandCount(int Asset) noexcept
{
    return Tables[ClampAsset(Asset)].IslandCount;
}

const UvIslandSpec& QueryUvIsland(int Asset, int Index) noexcept
{
    const AssetTables& T = Tables[ClampAsset(Asset)];
    return T.Islands[Index < 0 || Index >= T.IslandCount ? 0 : Index];
}

int QueryUvSelectionModeCount() noexcept
{
    return 4;
}

const char* QueryUvSelectionMode(int Index) noexcept
{
    return SelectionModes[Index < 0 || Index >= 4 ? 3 : Index];
}

int QueryUvToolCount() noexcept
{
    return 8;
}

const char* QueryUvTool(int Index) noexcept
{
    return Tools[Index < 0 || Index >= 8 ? 0 : Index];
}

int QueryUvLensCount() noexcept
{
    return 6;
}

const char* QueryUvLens(int Index) noexcept
{
    return Lenses[Index < 0 || Index >= 6 ? 0 : Index];
}

int QueryUvShadeCount() noexcept
{
    return 7;
}

const char* QueryUvShade(int Index) noexcept
{
    return Shades[Index < 0 || Index >= 7 ? 0 : Index];
}

double QueryUvGroupActualShare(int Asset, int Group) noexcept
{
    const AssetTables& T = Tables[ClampAsset(Asset)];
    double GroupArea = 0.0, TotalArea = 0.0;
    for (int I = 0; I < T.IslandCount; ++I)
    {
        TotalArea += T.Islands[I].AreaPct;
        if (T.Islands[I].Group == Group) GroupArea += T.Islands[I].AreaPct;
    }
    return TotalArea > 0.0 ? 100.0 * GroupArea / TotalArea : 0.0;
}

double QueryUvRemainderActualShare(int Asset) noexcept
{
    const AssetTables& T = Tables[ClampAsset(Asset)];
    double RemArea = 0.0, TotalArea = 0.0;
    for (int I = 0; I < T.IslandCount; ++I)
    {
        TotalArea += T.Islands[I].AreaPct;
        if (T.Islands[I].Group < 0) RemArea += T.Islands[I].AreaPct;
    }
    return TotalArea > 0.0 ? 100.0 * RemArea / TotalArea : 0.0;
}

int QueryUvGroupIslandCount(int Asset, int Group) noexcept
{
    const AssetTables& T = Tables[ClampAsset(Asset)];
    int N = 0;
    for (int I = 0; I < T.IslandCount; ++I)
        if (T.Islands[I].Group == Group) ++N;
    return N;
}

int QueryUvRemainderIslandCount(int Asset) noexcept
{
    const AssetTables& T = Tables[ClampAsset(Asset)];
    int N = 0;
    for (int I = 0; I < T.IslandCount; ++I)
        if (T.Islands[I].Group < 0) ++N;
    return N;
}

double QueryUvTileOccupancy(int Asset, int UdimId) noexcept
{
    const AssetTables& T = Tables[ClampAsset(Asset)];
    double Occupancy = 0.0;
    for (int I = 0; I < T.IslandCount; ++I)
        if (T.Islands[I].Udim == UdimId) Occupancy += T.Islands[I].AreaPct;
    return Occupancy;
}

int QueryUvTileIslandCount(int Asset, int UdimId) noexcept
{
    const AssetTables& T = Tables[ClampAsset(Asset)];
    int N = 0;
    for (int I = 0; I < T.IslandCount; ++I)
        if (T.Islands[I].Udim == UdimId) ++N;
    return N;
}

int QueryUvOverlapCount(int Asset) noexcept
{
    (void)Asset;
    return 0; // 🧩 Every pinned asset validates at 0 overlaps in Node.
}

int QueryUvFlippedCount(int Asset) noexcept
{
    (void)Asset;
    return 0; // 🧩 Every pinned asset validates at 0 flipped faces in Node.
}

void StageUvAssetCopies(UvWorkspaceState& State) noexcept
{
    const int Asset = ClampAsset(State.Asset);
    for (int I = 0; I < 4; ++I)
    {
        State.GroupTarget[I] = I < Tables[Asset].GroupCount ? Tables[Asset].Groups[I].TargetPct : 0.0;
        State.TileRes[I]     = I < Tables[Asset].TileCount ? Tables[Asset].Tiles[I].Resolution : 2048;
        int Backing          = 0;
        if (I < Tables[Asset].TileCount)
        {
            const char* Mode = Tables[Asset].Tiles[I].Backing;
            if (std::strcmp(Mode, "uv") == 0) Backing = 1;
            else if (std::strcmp(Mode, "checker") == 0) Backing = 2;
            else if (std::strcmp(Mode, "blank") == 0) Backing = 3;
        }
        State.TileBacking[I] = Backing;
    }
}

void ConstructUvWorkspaceState(UvWorkspaceState& State)
{
    State = UvWorkspaceState{};
    for (int I = 0; I < UvWorkspaceState::CardCount; ++I) State.OpenCards[I] = true;
    StageUvAssetCopies(State);
    State.AssetName = QueryUvAsset(0).Label;
    char Boot[160]{};
    std::snprintf(Boot, sizeof(Boot), "%s staged · %d islands · UDIM 1001", QueryUvAsset(0).Label,
                  QueryUvIslandCount(0));
    AppendUvWorkspaceLog(State, "DOC", Boot);
}

void AppendUvWorkspaceLog(UvWorkspaceState& State, const char* Channel, const char* Message)
{
    UvWorkspaceLogEntry Entry;
    Entry.Channel = Channel != nullptr ? Channel : "";
    Entry.Message = Message != nullptr ? Message : "";
    State.Log.push_front(Entry);
    while (State.Log.size() > 220) State.Log.pop_back();
}

void NoopUvWorkspaceCommand(UvWorkspaceState& State, const char* Channel, const char* Message, const char* ToastText)
{
    Toast::Show(ToastText);
    ++State.NoopCount;
    char Line[256]{};
    std::snprintf(Line, sizeof(Line), "%s · explicit NOOP", Message);
    AppendUvWorkspaceLog(State, Channel, Line);
    if (std::strcmp(Channel, "EXPORT") == 0) State.ExportObjNoopRaised = true;
    if (std::strcmp(Channel, "PACK") == 0) State.PackNoopRaised = true;
    if (std::strcmp(Channel, "UNWRAP") == 0) State.UnwrapNoopRaised = true;
}

void LogUvWorkspaceValue(UvWorkspaceState& State, const char* Channel, const char* Label, const char* Shown)
{
    char Message[192]{};
    std::snprintf(Message, sizeof(Message), "%s → %s", Label, Shown);
    AppendUvWorkspaceLog(State, Channel, Message);
}

void SelectUvWorkspaceAsset(UvWorkspaceState& State, int Asset)
{
    State.Asset       = ClampAsset(Asset);
    State.Selected    = -1;
    State.ActiveUdim  = 1001;
    StageUvAssetCopies(State);
    State.AssetName   = QueryUvAsset(State.Asset).Label;
    std::memset(State.IslandLocked, 0, sizeof(State.IslandLocked));
    std::memset(State.IslandHidden, 0, sizeof(State.IslandHidden));
    std::memset(State.IslandPicked, 0, sizeof(State.IslandPicked));
    char Staged[160]{};
    std::snprintf(Staged, sizeof(Staged), "%s staged · %d islands · UDIM 1001", QueryUvAsset(State.Asset).Label,
                  QueryUvIslandCount(State.Asset));
    AppendUvWorkspaceLog(State, "DOC", Staged);
}

void SelectUvWorkspaceIsland(UvWorkspaceState& State, int Island, bool Additive) noexcept
{
    const int Count = QueryUvIslandCount(State.Asset);
    if (Island < 0 || Island >= Count || Count > 32)
    {
        State.Selected = -1;
        return;
    }
    if (!Additive)
    {
        std::memset(State.IslandPicked, 0, sizeof(State.IslandPicked));
        State.IslandPicked[Island] = true;
        State.Selected             = Island;
        return;
    }
    State.IslandPicked[Island] = !State.IslandPicked[Island];
    State.Selected             = State.IslandPicked[Island] ? Island : -1;
}

void RecordUvWorkspaceRect(UvWorkspaceState& State, const char* Name, ImVec2 Min, ImVec2 Max)
{
    State.Rects[Name] = ImVec4(Min.x, Min.y, Max.x, Max.y);
}

bool QueryUvWorkspaceRect(const UvWorkspaceState& State, const char* Name, ImVec2& Min, ImVec2& Max) noexcept
{
    const auto Found = State.Rects.find(Name != nullptr ? Name : "");
    if (Found == State.Rects.end()) return false;
    Min = ImVec2(Found->second.x, Found->second.y);
    Max = ImVec2(Found->second.z, Found->second.w);
    return true;
}

} // namespace Frontier
