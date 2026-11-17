/*==========================================================================================================================================
                                                       FRACTUREWORKSPACECATALOGUE.CPP
==========================================================================================================================================*/
// Pinned fracture catalogues (materials, solvers, spawn presets, initial constructs), native solver receipts,
// SDF-footprint accounting, the Spencer/Kasten-Young solar ephemeris, and the .fracture.toml encoder.

#include "Frontier/Engine/Interface/Workspaces/FractureWorkspace.h"
#include "Frontier/Engine/Interface/Controls/Toast.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace Frontier
{
namespace
{

const FractureWorkspaceMaterial Materials[] = {
    { "concrete", "Reinforced Concrete", "Concrete", "bulk-brittle", 2350.0, 140.0, 30.0, 0.20, 1.15, 0x8D908BFF },
    { "granite", "Bedded Granite", "Granite", "bulk-brittle", 2700.0, 95.0, 55.0, 0.25, 1.40, 0x6F7378FF },
    { "wood", "Spruce Wood", "Spruce Wood", "fibrous", 520.0, 320.0, 11.0, 0.35, 11.0, 0xB3824CFF },
    { "glass", "Float Glass", "Float Glass", "plate-brittle", 2500.0, 7.0, 70.0, 0.22, 1.0, 0xB8DCE4FF },
    { "tempered", "Tempered Glass", "Tempered", "plate-brittle", 2500.0, 7.0, 70.0, 0.22, 1.0, 0xA8D8E6FF },
    { "plastic", "Ductile ABS", "ABS", "ductile", 1050.0, 460.0, 2.2, 0.35, 1.0, 0x3A3F4AFF }
};

const FractureWorkspaceSolver Solvers[] = {
    { "runtime_boussinesq", "Fast Runtime Boussinesq Flat-BSP", "Zero-Alloc CSR Arena + 1-Draw DataTexture",
      "0.25–1.25 ms", "Primary (<1 ms)", "Convex Proxy",
      "Closed-form Boussinesq–Hertz stress + 1-clip CSR bisectors + O(N) CutToken bonds" },
    { "engineering_fem", "Engineering Navier–Cauchy + Fractography", "3D Continuum Lattice + Interlocking",
      "20–110 ms", "Pre-Baked + Hybrid", "Primary Bake",
      "3×3 Cauchy eigenstresses, Rankine/Mohr–Coulomb, wake T-junctions, Bouchaud H=0.78 roughness" },
    { "griffith", "Griffith Stress-Budgeted Clipping", "Frontier- (Fragmentation)",
      "4.5–15 ms", "Interactive (≤24)", "Supported + SDF",
      "Hertzian cone + 2·Gc·A surface energy budget + grain anisotropy + tempering dicing" },
    { "wavefront", "LEFM Crack-Tip Wavefront", "Frontier- (Propagation)",
      "0.8–2.0 ms", "Thin-Plate Live", "Supported",
      "Mott Rayleigh crack speed 0.6 cR, radial star spokes + flexural T-junction rings" },
    { "voronoi", "Clustered 3D Voronoi + Strain Bonds", "Frontier (EverestInterface)",
      "4.0–26 ms", "Hybrid Bonds", "Supported + 128³ SDF",
      "Golden-angle Poisson seed bisectors + impact envelope + Delaunay tensile bonds" },
    { "dendritic", "Dendritic Lightning & Core-Rind Spall", "RockGenerator CSG Paradigm",
      "9.0–120 ms", "Bake Only", "Supported + SDF",
      "Outer spall slabs + stochastic branching internal lightning fracture polylines" },
};

const FractureWorkspacePreset Presets[] = {
    { "monolith", "concrete", "engineering_fem", "Engineering", "Calibration Monolith",
      "3D Navier–Cauchy concrete pillar + H=0.78 interlocking" },
    { "curtain_pane", "tempered", "runtime_boussinesq", "Brittle", "Tempered Curtain Lite",
      "Fast Boussinesq Flat-BSP 46 kJ/m³ dicing curtain pane" },
    { "curtain_pane", "glass", "wavefront", "Brittle", "Annealed Crown Plate",
      "LEFM Mott radial star spokes & T-junction rings" },
    { "boulder", "granite", "engineering_fem", "Stone & Timber", "Bedded Basalt Erratic",
      "Anisotropic bedding planes + Mode I/II granite fractography" },
    { "timber_beam", "wood", "runtime_boussinesq", "Stone & Timber", "Orthotropic Spruce Joist",
      "High-anisotropy longitudinal splintering along grain" },
    { "cube", "concrete", "voronoi", "Voronoi", "Voronoi Delaunay Block",
      "Clustered impact-biased Voronoi cells + tensile bond graph" },
    { "cone", "glass", "dendritic", "Brittle", "Obsidian Ballistic Spire",
      "Dendritic core-rind lightning spall cones" },
    { "cylinder", "plastic", "griffith", "Ductile", "Ductile ABS Drum",
      "Griffith stress-budgeted plastic containment cylinder" },
};

FractureSpec MakeSpec(int Solver, int Material, double Energy, int Seed, int Ceiling, double MinimumSize,
                      double GrainAngleDeg, double BondStrengthScale, bool PieceSdf, int SdfResolution,
                      double Px, double Py, double Pz, double Nx, double Ny, double Nz)
{
    FractureSpec Spec;
    Spec.Solver = Solver;
    Spec.Material = Material;
    Spec.Energy = Energy;
    Spec.Seed = Seed;
    Spec.Ceiling = Ceiling;
    Spec.MinimumSize = MinimumSize;
    Spec.GrainAngleDeg = GrainAngleDeg;
    Spec.BondStrengthScale = BondStrengthScale;
    Spec.PieceSdf = PieceSdf;
    Spec.SdfResolution = SdfResolution;
    Spec.ImpactPoint[0] = Px; Spec.ImpactPoint[1] = Py; Spec.ImpactPoint[2] = Pz;
    Spec.ImpactNormal[0] = Nx; Spec.ImpactNormal[1] = Ny; Spec.ImpactNormal[2] = Nz;
    return Spec;
}

const FractureConstructSeed Seeds[] = {
    { "construct-monolith", "Monolith Pillar", "monolith", "baked", true, 26,
      {} }, // 🧩 Spec filled below; aggregate init keeps the table const-adjacent.
    { "construct-tempered", "Tempered Safety Glazing", "curtain_pane", "realtime", false, 1492, {} },
    { "construct-float-glass", "Annealed Float Pane", "curtain_pane", "realtime", false, 921, {} },
    { "construct-granite", "Bedded Granite Erratic", "boulder", "baked", true, 512, {} },
    { "construct-spruce", "Orthotropic Timber Beam", "timber_beam", "realtime", false, 900, {} },
    { "construct-voronoi", "Voronoi Vault Cube", "cube", "baked", true, 726, {} },
    { "construct-polymer", "Ductile ABS Containment", "cylinder", "realtime", false, 656, {} },
};

FractureSpec SeedSpec(int Index)
{
    switch (Index)
    {
    case 0: return MakeSpec(1, 0, 4600.0, 42, 32, 0.04, 0.0, 1.0, true, 64, 0.05, 0.24, 0.48, 0.0, 0.0, -1.0);
    case 1: return MakeSpec(0, 4, 1200.0, 108, 64, 0.032, 0.0, 0.5, false, 64, 0.18, 0.10, 0.032, 0.0, 0.0, -1.0);
    case 2: return MakeSpec(3, 3, 1850.0, 77, 44, 0.035, 0.0, 0.7, false, 64, -0.12, 0.08, 0.032, 0.0, 0.0, -1.0);
    case 3: return MakeSpec(1, 1, 5200.0, 314, 32, 0.05, 18.0, 1.15, true, 64, 0.15, 0.22, 0.55, -0.15, -0.1, -0.98);
    case 4: return MakeSpec(0, 2, 2600.0, 64, 30, 0.038, 0.0, 0.95, false, 32, 0.0, 0.14, 0.14, 0.0, -0.5, -0.86);
    case 5: return MakeSpec(4, 0, 3900.0, 91, 52, 0.05, 0.0, 1.05, true, 128, 0.22, 0.16, 0.66, 0.0, 0.0, -1.0);
    default: return MakeSpec(2, 5, 4100.0, 23, 16, 0.075, 0.0, 1.3, false, 32, 0.1, 0.25, 0.60, 0.0, 0.0, -1.0);
    }
}

uint32_t HashU32(uint32_t X) noexcept
{
    X ^= X >> 16;
    X *= 0x7FEB352Du;
    X ^= X >> 15;
    X *= 0x846CA68Bu;
    X ^= X >> 16;
    return X;
}

double Clamp01(double V) noexcept
{
    return V < 0.0 ? 0.0 : (V > 1.0 ? 1.0 : V);
}

} // namespace

int QueryFractureMaterialCount() noexcept
{
    return 6;
}

const FractureWorkspaceMaterial& QueryFractureMaterial(int Index) noexcept
{
    return Materials[Index < 0 || Index >= 6 ? 0 : Index];
}

int QueryFractureMaterialById(const char* Id) noexcept
{
    if (Id == nullptr) return -1;
    for (int I = 0; I < 6; ++I)
        if (std::strcmp(Materials[I].Id, Id) == 0) return I;
    return -1;
}

int QueryFractureSolverCount() noexcept
{
    return 6;
}

const FractureWorkspaceSolver& QueryFractureSolver(int Index) noexcept
{
    return Solvers[Index < 0 || Index >= 6 ? 0 : Index];
}

int QueryFractureSolverById(const char* Id) noexcept
{
    if (Id == nullptr) return -1;
    for (int I = 0; I < 6; ++I)
        if (std::strcmp(Solvers[I].Id, Id) == 0) return I;
    return -1;
}

int QueryFracturePresetCount() noexcept
{
    return 8;
}

const FractureWorkspacePreset& QueryFracturePreset(int Index) noexcept
{
    return Presets[Index < 0 || Index >= 8 ? 0 : Index];
}

int QueryFractureConstructSeedCount() noexcept
{
    return 7;
}

const FractureConstructSeed& QueryFractureConstructSeed(int Index) noexcept
{
    return Seeds[Index < 0 || Index >= 7 ? 0 : Index];
}

FractureSpec QueryFractureConstructSeedSpec(int Index) noexcept
{
    return SeedSpec(Index < 0 || Index >= 7 ? 0 : Index);
}

void ApplyFractureSolverResult(FractureWorkspaceConstruct& Construct, const Fracture::Result& Result) noexcept
{
    try
    {
        Construct.NativeResult = Result;
        Construct.NativeResultValid = Result.Success;
        FractureReceipt& Out = Construct.Receipt;
        Out.FragmentCount = static_cast<int>(Result.Fragments.size());
        Out.BondCount = static_cast<int>(Result.Bonds.size());
        Out.IntactBondCount = static_cast<int>(std::count_if(Result.Bonds.begin(), Result.Bonds.end(),
            [](const Fracture::Bond& Bond) { return !Bond.BrokenOnImpact; }));
        Out.TotalCrackArea = Result.TotalCrackAreaM2;
        Out.VolumeDriftRatio = Result.VolumeDriftRatio;
        Out.SpentSurfaceEnergy = Result.SpentSurfaceEnergyJ;
        Out.BudgetPercent = Result.TotalEnergyBudgetJ > 0.0
                                 ? std::clamp(100.0 * Result.SpentSurfaceEnergyJ / Result.TotalEnergyBudgetJ, 0.0, 100.0)
                                 : 0.0;
        Out.RayleighSpeedMps = Result.RayleighSpeedMps;
        Out.WaveHazard = Result.RayleighSpeedMps / 3400.0 * (1.0 + Result.TotalCrackAreaM2 / 10.0);
        Out.StepMilliseconds = Result.ComputeMilliseconds;
        Out.WatertightManifold = Result.WatertightManifold;
    }
    catch (...)
    {
        Construct.NativeResultValid = false;
        Construct.Receipt = FractureReceipt{};
        Construct.Receipt.WatertightManifold = false;
    }
}

void RecomputeFractureReceipt(FractureWorkspaceConstruct& Construct) noexcept
{
    try
    {
        Fracture::SolidKind Solid = Fracture::SolidKind::Monolith;
        if (Construct.SolidCategory == "curtain_pane") Solid = Fracture::SolidKind::CurtainPane;
        else if (Construct.SolidCategory == "timber_beam") Solid = Fracture::SolidKind::TimberBeam;
        else if (Construct.SolidCategory == "boulder") Solid = Fracture::SolidKind::Boulder;
        else if (Construct.SolidCategory == "hollow_core") Solid = Fracture::SolidKind::HollowCore;
        else if (Construct.SolidCategory == "cube") Solid = Fracture::SolidKind::Cube;
        else if (Construct.SolidCategory == "cylinder") Solid = Fracture::SolidKind::Cylinder;
        else if (Construct.SolidCategory == "cone") Solid = Fracture::SolidKind::Cone;

        Fracture::Request Request;
        Request.Algorithm = static_cast<Fracture::Solver>(std::clamp(Construct.Spec.Solver, 0, 5));
        Request.EnergyJoules = Construct.Spec.Energy;
        Request.Seed = static_cast<uint32_t>(std::max(1, Construct.Spec.Seed));
        Request.FragmentCeiling = static_cast<uint32_t>(std::clamp(Construct.Spec.Ceiling, 2, 256));
        Request.MinimumPieceSizeMetres = Construct.Spec.MinimumSize;
        Request.GrainAngleDegrees = Construct.Spec.GrainAngleDeg;
        Request.BondStrengthScale = Construct.Spec.BondStrengthScale;
        Request.ImpactPointMetres = { Construct.Spec.ImpactPoint[0], Construct.Spec.ImpactPoint[1], Construct.Spec.ImpactPoint[2] };
        Request.ImpactNormal = { Construct.Spec.ImpactNormal[0], Construct.Spec.ImpactNormal[1], Construct.Spec.ImpactNormal[2] };
        const Fracture::Material Material = Fracture::ResolveMaterialById(QueryFractureMaterial(Construct.Spec.Material).Id);
        Construct.NativeResult = Fracture::Execute(Fracture::ConstructSolid(Solid, { 1.0, 1.0, 1.0 }, Request.Seed),
                                                    Request, Material);
        const Fracture::Result& Result = Construct.NativeResult;
        Construct.NativeResultValid = Result.Success;
        FractureReceipt& Out = Construct.Receipt;
        Out.FragmentCount = static_cast<int>(Result.Fragments.size());
        Out.BondCount = static_cast<int>(Result.Bonds.size());
        Out.IntactBondCount = static_cast<int>(std::count_if(Result.Bonds.begin(), Result.Bonds.end(),
            [](const Fracture::Bond& Bond) { return !Bond.BrokenOnImpact; }));
        Out.TotalCrackArea = Result.TotalCrackAreaM2;
        Out.VolumeDriftRatio = Result.VolumeDriftRatio;
        Out.SpentSurfaceEnergy = Result.SpentSurfaceEnergyJ;
        Out.BudgetPercent = Result.TotalEnergyBudgetJ > 0.0
                                 ? std::clamp(100.0 * Result.SpentSurfaceEnergyJ / Result.TotalEnergyBudgetJ, 0.0, 100.0)
                                 : 0.0;
        Out.RayleighSpeedMps = Result.RayleighSpeedMps;
        Out.WaveHazard = Result.RayleighSpeedMps / 3400.0 * (1.0 + Result.TotalCrackAreaM2 / 10.0);
        Out.StepMilliseconds = Result.ComputeMilliseconds;
        Out.WatertightManifold = Result.WatertightManifold;
    }
    catch (...)
    {
        Construct.NativeResult = {};
        Construct.NativeResultValid = false;
        Construct.Receipt = FractureReceipt{};
        Construct.Receipt.WatertightManifold = false;
    }
}

double QueryFractureSdfMegabytes(int FragmentCount, int Resolution, bool Enabled) noexcept
{
    if (!Enabled || FragmentCount <= 0) return 0.0;
    const double Voxels = static_cast<double>(FragmentCount) * Resolution * Resolution * Resolution;
    return Voxels * 2.0 / (1024.0 * 1024.0); // 🧩 R16F half-float distance bricks.
}

namespace
{

constexpr double Pi = 3.14159265358979323846;
constexpr int    DaysBeforeMonth[13] = { 0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334 };

void SolveSolarAtHour(const FractureSunParams& P, double Hour, double& ElevationDeg, double& AzimuthDeg, double& AirMass) noexcept
{
    const int    Month     = P.Month < 1 ? 1 : (P.Month > 12 ? 12 : P.Month);
    const int    Day       = P.Day < 1 ? 1 : (P.Day > 31 ? 31 : P.Day);
    const int    DayOfYear = DaysBeforeMonth[Month] + Day;
    const double Gamma     = (2.0 * Pi / 365.0) * (DayOfYear - 1 + (Hour - 12.0) / 24.0);

    // 🧩 Spencer (1971) equation of time [min] and declination δ [rad].
    const double EoT = 229.18 * (0.000075 + 0.001868 * std::cos(Gamma) - 0.032077 * std::sin(Gamma) -
                                 0.014615 * std::cos(2 * Gamma) - 0.040849 * std::sin(2 * Gamma));
    const double Dec = 0.006918 - 0.399912 * std::cos(Gamma) + 0.070257 * std::sin(Gamma) - 0.006758 * std::cos(2 * Gamma) +
                       0.000907 * std::sin(2 * Gamma) - 0.002697 * std::cos(3 * Gamma) + 0.00148 * std::sin(3 * Gamma);

    const double LatRad = P.LatitudeDeg * Pi / 180.0;
    const double HourRad = ((Hour + EoT / 60.0 - 12.0) * 15.0 * Pi) / 180.0;
    double       SinEl  = std::sin(LatRad) * std::sin(Dec) + std::cos(LatRad) * std::cos(Dec) * std::cos(HourRad);
    SinEl              = SinEl < -1.0 ? -1.0 : (SinEl > 1.0 ? 1.0 : SinEl);
    const double ElRad = std::asin(SinEl);
    ElevationDeg       = ElRad * 180.0 / Pi;

    const double CosEl = std::cos(ElRad) < 1e-5 ? 1e-5 : std::cos(ElRad);
    const double CosLat = std::cos(LatRad) < 1e-5 ? 1e-5 : std::cos(LatRad);
    const double SinAz = (-std::cos(Dec) * std::sin(HourRad)) / CosEl;
    const double CosAz = (std::sin(Dec) - std::sin(LatRad) * SinEl) / (CosLat * CosEl);
    double       AzRad = std::atan2(SinAz, CosAz);
    if (AzRad < 0) AzRad += 2.0 * Pi;
    AzimuthDeg = AzRad * 180.0 / Pi;

    // 🧩 Kasten & Young (1989) optical air mass.
    if (ElevationDeg > -0.5)
    {
        const double ElPos  = ElRad > 0 ? ElRad : 0;
        const double DegArg = ElevationDeg + 6.07995 > 0.2 ? ElevationDeg + 6.07995 : 0.2;
        const double Denom  = std::sin(ElPos) + 0.50572 * std::pow(DegArg, -1.6364);
        AirMass             = 1.0 / (Denom > 0.015 ? Denom : 0.015);
        if (AirMass > 38.0) AirMass = 38.0;
    }
    else AirMass = 38.0;
}

} // namespace

void EvaluateFractureSun(const FractureSunParams& Params, FractureSunSolved& Solved) noexcept
{
    SolveSolarAtHour(Params, Params.LocalHours, Solved.ElevationDeg, Solved.AzimuthDeg, Solved.AirMass);
    Solved.SunriseHour = 0.0;
    Solved.SunsetHour  = 0.0;
    Solved.SolarNoonHour = 12.0;
    double Peak = -90.0, PrevEl = 0.0, PrevH = 0.0;
    bool   HavePrev = false, HaveRise = false;
    for (int I = 0; I <= 96; ++I)
    {
        const double H = (I / 96.0) * 24.0;
        double       El = 0.0, Az = 0.0, Am = 0.0;
        SolveSolarAtHour(Params, H, El, Az, Am);
        if (El > Peak)
        {
            Peak = El;
            Solved.SolarNoonHour = H;
        }
        if (HavePrev)
        {
            if (PrevEl <= 0 && El > 0 && !HaveRise)
            {
                Solved.SunriseHour = PrevH + (0 - PrevEl) / (El - PrevEl) * 0.25;
                HaveRise           = true;
            }
            if (PrevEl > 0 && El <= 0) Solved.SunsetHour = PrevH + (PrevEl - 0) / (PrevEl - El) * 0.25;
        }
        PrevEl = El;
        PrevH  = H;
        HavePrev = true;
    }
    const char* Phase = "Daylight";
    if (Solved.ElevationDeg < -18) Phase = "Astronomical Night";
    else if (Solved.ElevationDeg < -12) Phase = "Astronomical Twilight";
    else if (Solved.ElevationDeg < -6) Phase = "Nautical Twilight";
    else if (Solved.ElevationDeg < 0) Phase = "Civil Twilight";
    else if (Solved.ElevationDeg < 8) Phase = "Golden Low Sun";
    std::snprintf(Solved.PhaseLabel, sizeof(Solved.PhaseLabel), "%s", Phase);
}

void EncodeFractureToml(const FractureWorkspaceState& State, int Construct, char* Text, size_t TextSize) noexcept
{
    if (Text == nullptr || TextSize == 0) return;
    const int                          Safe = Construct < 0 || Construct >= 7 ? 0 : Construct;
    const FractureWorkspaceConstruct&  Cst  = State.Constructs[Safe];
    const FractureSpec&                Spec = Cst.Spec;
    const FractureReceipt&             Rec  = Cst.Receipt;
    std::snprintf(Text, TextSize,
                  "# Frontier Fracture Studio Archive\n"
                  "[Construct]\n"
                  "Identifier = \"construct-%d\"\n"
                  "Label = \"%s\"\n"
                  "SolidCategory = \"%s\"\n"
                  "Pipeline = \"%s\"\n"
                  "\n"
                  "[FractureRecipe]\n"
                  "Solver = \"%s\"\n"
                  "Material = \"%s\"\n"
                  "EnergyJoules = %d\n"
                  "DeterministicSeed = %d\n"
                  "ShardCeiling = %d\n"
                  "MinimumSpanMetres = %.3f\n"
                  "GrainAngleDegrees = %d\n"
                  "BondStrengthScale = %.2f\n"
                  "ImpactPoint = [%.2f, %.2f, %.2f]\n"
                  "ImpactNormal = [%.2f, %.2f, %.2f]\n"
                  "\n"
                  "[PieceSdf]\n"
                  "Enabled = %s\n"
                  "VoxelResolution = %d\n"
                  "\n"
                  "[GeometryReceipt]\n"
                  "FragmentCount = %d\n"
                  "TotalCrackAreaM2 = %.4f\n"
                  "VolumeDriftRatio = %.4e\n"
                  "WatertightManifold = %s\n",
                  Safe, Cst.Title.c_str(), Cst.SolidCategory.c_str(), Cst.Pipeline.c_str(),
                  QueryFractureSolver(Spec.Solver).Id, QueryFractureMaterial(Spec.Material).Id,
                  static_cast<int>(std::round(Spec.Energy)), Spec.Seed, Spec.Ceiling, Spec.MinimumSize,
                  static_cast<int>(std::round(Spec.GrainAngleDeg)), Spec.BondStrengthScale,
                  Spec.ImpactPoint[0], Spec.ImpactPoint[1], Spec.ImpactPoint[2],
                  Spec.ImpactNormal[0], Spec.ImpactNormal[1], Spec.ImpactNormal[2],
                  Spec.PieceSdf ? "true" : "false", Spec.SdfResolution,
                  Rec.FragmentCount, Rec.TotalCrackArea, Rec.VolumeDriftRatio,
                  Rec.WatertightManifold ? "true" : "false");
}

void ConstructFractureWorkspaceState(FractureWorkspaceState& State)
{
    State.CubeComparisonOpen = true;
    State.CubeComparisonReady = false;
    for (int I = 0; I < FractureWorkspaceState::CardCount; ++I) State.OpenCards[I] = true;
    for (int I = 0; I < 7; ++I)
    {
        const FractureConstructSeed& Seed = QueryFractureConstructSeed(I);
        FractureWorkspaceConstruct&  Dst  = State.Constructs[I];
        Dst.Title                 = Seed.Title;
        Dst.SolidCategory         = Seed.SolidCategory;
        Dst.Pipeline              = Seed.Pipeline;
        Dst.BakedResident         = Seed.BakedResident;
        Dst.PrimaryNucleusCells   = Seed.PrimaryNucleusCells;
        Dst.Spec                  = QueryFractureConstructSeedSpec(I);
    }
    RecomputeFractureReceipt(State.Constructs[State.ActiveConstruct]);
    EvaluateFractureSun(State.Sun, State.SunSolved);
    State.Log.clear();
    AppendFractureWorkspaceLog(State, "WORKSPACE", "Fracture workspace ready", "7 constructs · 4 celestials");
}

void AppendFractureWorkspaceLog(FractureWorkspaceState& State, const char* Channel, const char* Message, const char* Detail)
{
    FractureWorkspaceLogEntry Entry;
    Entry.Channel = Channel ? Channel : "";
    Entry.Message = Message ? Message : "";
    Entry.Detail  = Detail ? Detail : "";
    State.Log.push_front(std::move(Entry));
    while (State.Log.size() > 64) State.Log.pop_back();
}

void NoopFractureWorkspaceCommand(FractureWorkspaceState& State, const char* Channel, const char* Message, const char* ToastText)
{
    Toast::Show(ToastText);
    AppendFractureWorkspaceLog(State, Channel, Message, "explicit NOOP");
}

void LogFractureWorkspaceValue(FractureWorkspaceState& State, const char* Channel, const char* Label, const char* Shown)
{
    char Message[192]{};
    std::snprintf(Message, sizeof(Message), "%s → %s", Label, Shown);
    AppendFractureWorkspaceLog(State, Channel, Message);
}

void SelectFractureWorkspaceNode(FractureWorkspaceState& State, int Selection) noexcept
{
    State.Selected = Selection;
    if (Selection >= 0 && Selection < 7)
    {
        State.ActiveConstruct = Selection;
        if (!State.Constructs[Selection].NativeResultValid) RecomputeFractureReceipt(State.Constructs[Selection]);
    }
    if (Selection == FractureWorkspaceState::SelectedCloudsLocal) State.Clouds.ActiveScope = 1;
    if (Selection == FractureWorkspaceState::SelectedCloudsGlobal) State.Clouds.ActiveScope = 0;
    State.InspectorTab = FractureWorkspaceState::TabOverview; // 🧩 Silent: the prototype resets to overview.
}

void RecordFractureWorkspaceRect(FractureWorkspaceState& State, const char* Name, ImVec2 Min, ImVec2 Max)
{
    State.Rects[Name] = ImVec4(Min.x, Min.y, Max.x, Max.y);
}

bool QueryFractureWorkspaceRect(const FractureWorkspaceState& State, const char* Name, ImVec2& Min, ImVec2& Max) noexcept
{
    const auto It = State.Rects.find(Name ? Name : "");
    if (It == State.Rects.end()) return false;
    Min = ImVec2(It->second.x, It->second.y);
    Max = ImVec2(It->second.z, It->second.w);
    return true;
}

} // namespace Frontier
