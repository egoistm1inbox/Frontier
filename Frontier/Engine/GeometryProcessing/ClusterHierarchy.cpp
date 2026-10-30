/*==========================================================================================================================================
                                               GLASSAWARECLUSTEREXTENSION.CPP
==========================================================================================================================================*/
// 🧩 Implementation of glass-aware virtualized cluster geometry: locked-border quadric tiers, IOR optical error cut,
//    two-phase Hi-Z pyramid culling (glass exempt from depth occlusion writes), 64 KB LRU residency, and 2-layer glass peel.

#include "Engine/GeometryProcessing/ClusterHierarchy.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <unordered_set>

namespace Frontier
{
namespace
{
constexpr float PiConst = 3.14159265358979323846f;

Vec3 ToVec3(const Vector3& V) noexcept
{
    return {static_cast<float>(V.X), static_cast<float>(V.Y), static_cast<float>(V.Z)};
}

double ProjectedErrorPixels(
    double         ErrorMetres,
    float          OpticalBoost,
    const Vector3& SphereCentre,
    double         SphereRadius,
    const Vec3&    CamOrigin,
    double         ProjFactorPx) noexcept
{
    if (ErrorMetres <= 0.0)
    {
        return 0.0;
    }
    const double Dx   = SphereCentre.X - static_cast<double>(CamOrigin.X);
    const double Dy   = SphereCentre.Y - static_cast<double>(CamOrigin.Y);
    const double Dz   = SphereCentre.Z - static_cast<double>(CamOrigin.Z);
    const double Dist = std::max(0.05, std::sqrt(Dx * Dx + Dy * Dy + Dz * Dz) - SphereRadius);
    return (ErrorMetres * static_cast<double>(OpticalBoost) * ProjFactorPx) / Dist;
}

struct CameraBasis
{
    Vec3  Forward{};
    Vec3  Right{};
    Vec3  Up{};
    float TanHalfV = 0.45f;
    float TanHalfH = 0.80f;
};

CameraBasis BuildCameraBasis(const ClusterCameraView& Cam) noexcept
{
    CameraBasis B{};
    B.Forward        = Normalise(Cam.CameraTarget - Cam.CameraOrigin);
    const Vec3 RefUp = (std::abs(Dot(B.Forward, Cam.CameraUp)) > 0.98f) ? Vec3{0.0f, 1.0f, 0.0f} : Cam.CameraUp;
    B.Right          = Normalise(Cross(B.Forward, RefUp));
    B.Up             = Cross(B.Right, B.Forward);
    B.TanHalfV       = std::tan(0.5f * Cam.VerticalFovRad);
    const float Asp  = static_cast<float>(std::max(1u, Cam.ViewportWidthPx))
                     / static_cast<float>(std::max(1u, Cam.ViewportHeightPx));
    B.TanHalfH       = B.TanHalfV * Asp;
    return B;
}

bool ProjectPointToScreen(
    const Vec3&              WorldPt,
    const ClusterCameraView& Cam,
    const CameraBasis&       Basis,
    float&                   OutScreenX,
    float&                   OutScreenY,
    float&                   OutViewZ) noexcept
{
    const Vec3 Rel = WorldPt - Cam.CameraOrigin;
    OutViewZ       = Dot(Rel, Basis.Forward);
    if (OutViewZ <= 0.04f)
    {
        return false;
    }
    const float NdcX = Dot(Rel, Basis.Right) / (OutViewZ * Basis.TanHalfH);
    const float NdcY = Dot(Rel, Basis.Up) / (OutViewZ * Basis.TanHalfV);
    OutScreenX       = (NdcX * 0.5f + 0.5f) * static_cast<float>(Cam.ViewportWidthPx);
    OutScreenY       = (0.5f - NdcY * 0.5f) * static_cast<float>(Cam.ViewportHeightPx);
    return true;
}

Vec3 HashPastelColour(uint32_t Id) noexcept
{
    uint32_t H = (Id + 1u) * 0x9E3779B1u;
    H ^= H >> 16u;
    H *= 0x85EBCA6Bu;
    H ^= H >> 13u;
    const float R = 0.28f + 0.65f * static_cast<float>((H >> 0u) & 0xFFu) / 255.0f;
    const float G = 0.28f + 0.65f * static_cast<float>((H >> 8u) & 0xFFu) / 255.0f;
    const float B = 0.28f + 0.65f * static_cast<float>((H >> 16u) & 0xFFu) / 255.0f;
    return {R, G, B};
}

uint8_t EncodeSrgb8(float LinearVal) noexcept
{
    const float C = std::clamp(LinearVal, 0.0f, 1.0f);
    const float S = (C <= 0.0031308f) ? (12.92f * C) : (1.055f * std::pow(C, 1.0f / 2.4f) - 0.055f);
    return static_cast<uint8_t>(std::clamp(S * 255.0f + 0.5f, 0.0f, 255.0f));
}
} // namespace

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                       MATERIAL LOOKUP
------------------------------------------------------------------------------------------------------------------------------------------*/
void ClusterHierarchy::RegisterMaterialProfile(const ClusterMaterialProfile& Profile)
{
    for (auto& Existing : Materials_)
    {
        if (Existing.ClassificationId == Profile.ClassificationId)
        {
            Existing = Profile;
            return;
        }
    }
    Materials_.push_back(Profile);
}

const ClusterMaterialProfile& ClusterHierarchy::FindMaterial(uint32_t ClassificationId) const noexcept
{
    for (const auto& M : Materials_)
    {
        if (M.ClassificationId == ClassificationId)
        {
            return M;
        }
    }
    return DefaultMaterial_;
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                            BUILD TIER SEQUENCE & 64 KB PAGES
------------------------------------------------------------------------------------------------------------------------------------------*/
bool ClusterHierarchy::BuildFromFacetField(
    const FacetField&             SourceFacets,
    const TierBuildSpecification& Specification)
{
    Records_.clear();
    TierClusterToGlobal_.clear();
    Pages_.clear();
    Sequence_ = ClusterTierSequence{};

    if (SourceFacets.Classification.empty() || SourceFacets.Corners.size() != SourceFacets.Classification.size() * 3u)
    {
        return false;
    }

    WeldSpecification WeldSpec{};
    WeldSpec.UseCreaseAngle = Specification.UseCreaseAngle;
    WeldSpec.CreaseCosine   = Specification.CreaseCosine;
    const WeldOutcome Welded = WeldFacetField(SourceFacets, WeldSpec);
    if (Welded.Complex.Triangles.empty())
    {
        return false;
    }

    Sequence_ = BuildClusterTierSequence(Welded.Complex, Specification);
    if (Sequence_.Tiers.empty())
    {
        return false;
    }

    TierClusterToGlobal_.resize(Sequence_.Tiers.size());
    for (size_t TierIdx = 0u; TierIdx < Sequence_.Tiers.size(); ++TierIdx)
    {
        const ClusterTier& Tier = Sequence_.Tiers[TierIdx];
        TierClusterToGlobal_[TierIdx].resize(Tier.Clusters.size(), 0u);

        for (size_t ClIdx = 0u; ClIdx < Tier.Clusters.size(); ++ClIdx)
        {
            const FacetCluster&           Fc  = Tier.Clusters[ClIdx];
            const ClusterMaterialProfile& Mat = FindMaterial(Fc.Classification);

            GlassAwareClusterRecord Rec{};
            Rec.TierIndex          = static_cast<uint32_t>(TierIdx);
            Rec.ClusterIndexInTier = static_cast<uint32_t>(ClIdx);
            Rec.GlobalClusterId    = static_cast<uint32_t>(Records_.size());
            Rec.ClassificationId   = Fc.Classification;
            Rec.TransmissiveGlass  = Mat.TransmissiveGlass;
            Rec.RefractiveIndexIor = Mat.TransmissiveGlass ? Mat.RefractiveIndexIor : 1.0f;

            // Curved glass clusters carry a wider normal cone (smaller ConeCutoff -> larger sin(cone_half_angle)),
            // which deflects refracted rays across facets by ~(eta - 1) * sin(theta_cone)!
            if (Mat.TransmissiveGlass)
            {
                const float ClampedCos  = std::clamp(static_cast<float>(Fc.ConeCutoff), -1.0f, 1.0f);
                const float SinHalfCone = std::sqrt(std::max(0.0f, 1.0f - ClampedCos * ClampedCos));
                Rec.OpticalDeviationBoost = 1.0f + 4.5f * std::max(0.0f, Mat.RefractiveIndexIor - 1.0f) * SinHalfCone;
            }
            else
            {
                Rec.OpticalDeviationBoost = 1.0f;
            }

            Rec.SelfDeviationMetres       = (ClIdx < Tier.ClusterDeviation.size()) ? Tier.ClusterDeviation[ClIdx] : 0.0;
            Rec.CoarserDeviationMetres    = 1.0e12;
            Rec.SphereCentre              = Fc.SphereCentre;
            Rec.SphereRadiusMetres        = Fc.SphereRadius;
            Rec.CoarserSphereCentre       = Fc.SphereCentre;
            Rec.CoarserSphereRadiusMetres = Fc.SphereRadius;
            Rec.ConeAxis                  = Fc.ConeAxis;
            Rec.ConeCutoff                = Fc.ConeCutoff;
            Rec.TriangleCount             = static_cast<uint32_t>(Fc.Triangles.size());

            Vec3 BMin{1.0e9f, 1.0e9f, 1.0e9f};
            Vec3 BMax{-1.0e9f, -1.0e9f, -1.0e9f};
            for (uint32_t Tri : Fc.Triangles)
            {
                for (uint32_t K = 0u; K < 3u; ++K)
                {
                    const Vec3 P = ToVec3(Tier.Complex.Positions[Tier.Complex.Triangles[Tri * 3u + K]]);
                    BMin.X       = std::min(BMin.X, P.X);
                    BMin.Y       = std::min(BMin.Y, P.Y);
                    BMin.Z       = std::min(BMin.Z, P.Z);
                    BMax.X       = std::max(BMax.X, P.X);
                    BMax.Y       = std::max(BMax.Y, P.Y);
                    BMax.Z       = std::max(BMax.Z, P.Z);
                }
            }
            Rec.BoundsMin = BMin;
            Rec.BoundsMax = BMax;

            TierClusterToGlobal_[TierIdx][ClIdx] = Rec.GlobalClusterId;
            Records_.push_back(std::move(Rec));
        }
    }

    // Propagate group-coherent CoarserDeviationMetres & CoarserSphere down to enclosed finer clusters!
    for (size_t TierIdx = 1u; TierIdx < Sequence_.Tiers.size(); ++TierIdx)
    {
        const ClusterTier& CoarserTier = Sequence_.Tiers[TierIdx];
        for (size_t ClIdx = 0u; ClIdx < CoarserTier.Clusters.size(); ++ClIdx)
        {
            const uint32_t CoarserGlobal = TierClusterToGlobal_[TierIdx][ClIdx];
            auto&          CoarserRec    = Records_[CoarserGlobal];
            if (ClIdx >= CoarserTier.EnclosedClusters.size())
            {
                continue;
            }
            for (uint32_t FinerInPrev : CoarserTier.EnclosedClusters[ClIdx])
            {
                if (FinerInPrev < TierClusterToGlobal_[TierIdx - 1u].size())
                {
                    const uint32_t FinerGlobal = TierClusterToGlobal_[TierIdx - 1u][FinerInPrev];
                    CoarserRec.EnclosedFinerGlobals.push_back(FinerGlobal);

                    auto& FinerRec = Records_[FinerGlobal];
                    if (FinerRec.CoarserDeviationMetres > 1.0e11 || CoarserRec.SelfDeviationMetres > FinerRec.CoarserDeviationMetres)
                    {
                        FinerRec.CoarserDeviationMetres =
                            std::max(CoarserRec.SelfDeviationMetres, FinerRec.SelfDeviationMetres + 1.0e-6);
                        FinerRec.CoarserSphereCentre       = CoarserRec.SphereCentre;
                        FinerRec.CoarserSphereRadiusMetres = CoarserRec.SphereRadiusMetres;
                    }
                }
            }
        }
    }

    // Pack clusters root-first (coarsest tier -> finest leaf tier) into 64 KB fixed streaming pages!
    const uint32_t CoarsestTier = static_cast<uint32_t>(Sequence_.Tiers.size() - 1u);
    ClusterStreamingPage CurrentPage{};
    CurrentPage.PageIndex        = 0u;
    CurrentPage.PinnedRoot       = true;
    CurrentPage.ResidentInMemory = true;

    for (int TierInt = static_cast<int>(CoarsestTier); TierInt >= 0; --TierInt)
    {
        const uint32_t TierIdx    = static_cast<uint32_t>(TierInt);
        const bool     PinnedTier = (TierIdx == CoarsestTier);

        for (uint32_t GlobalId : TierClusterToGlobal_[TierIdx])
        {
            // Approximate packed GPU cluster payload: 96 B header + 36 B per triangle (quantised pos + corner UV + normal)
            const uint32_t ClusterBytes = 96u + Records_[GlobalId].TriangleCount * 36u;
            if (!CurrentPage.MemberGlobalIds.empty() &&
                (CurrentPage.ByteSize + ClusterBytes > StreamingPageCapacityBytes || (CurrentPage.PinnedRoot && !PinnedTier)))
            {
                Pages_.push_back(std::move(CurrentPage));
                CurrentPage                  = ClusterStreamingPage{};
                CurrentPage.PageIndex        = static_cast<uint32_t>(Pages_.size());
                CurrentPage.PinnedRoot       = PinnedTier;
                CurrentPage.ResidentInMemory = true;
            }
            CurrentPage.PinnedRoot       = CurrentPage.PinnedRoot || PinnedTier;
            CurrentPage.ByteSize        += ClusterBytes;
            Records_[GlobalId].PageSlotIndex = CurrentPage.PageIndex;
            CurrentPage.MemberGlobalIds.push_back(GlobalId);
        }
    }
    if (!CurrentPage.MemberGlobalIds.empty())
    {
        Pages_.push_back(std::move(CurrentPage));
    }

    return true;
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                               64 KB LRU PAGE RESIDENCY STREAMING
------------------------------------------------------------------------------------------------------------------------------------------*/
void ClusterHierarchy::EnforcePageResidencyBudget(
    uint32_t                 MaxResidentBytes,
    const ClusterCameraView& Camera,
    uint64_t                 FrameTick)
{
    if (Pages_.empty())
    {
        return;
    }

    const double ProjFactor = (0.5 * static_cast<double>(Camera.ViewportHeightPx)) / std::tan(0.5 * Camera.VerticalFovRad);

    struct PageScore
    {
        uint32_t PageIdx = 0u;
        double   Priority = 0.0;
    };
    std::vector<PageScore> Scores;
    Scores.reserve(Pages_.size());

    for (auto& Page : Pages_)
    {
        double MaxPx = 0.0;
        for (uint32_t Gid : Page.MemberGlobalIds)
        {
            const auto& R = Records_[Gid];
            const double Px = ProjectedErrorPixels(
                std::max(1.0e-3, R.CoarserDeviationMetres < 1.0e11 ? R.CoarserDeviationMetres : R.SphereRadiusMetres),
                R.OpticalDeviationBoost,
                R.SphereCentre,
                R.SphereRadiusMetres,
                Camera.CameraOrigin,
                ProjFactor);
            MaxPx = std::max(MaxPx, Px);
        }
        if (Page.PinnedRoot)
        {
            MaxPx = 1.0e15;
        }
        Scores.push_back({Page.PageIndex, MaxPx});
    }

    std::sort(Scores.begin(), Scores.end(), [](const PageScore& A, const PageScore& B) { return A.Priority > B.Priority; });

    uint32_t UsedBytes = 0u;
    for (const auto& S : Scores)
    {
        auto& Page = Pages_[S.PageIdx];
        if (Page.PinnedRoot || UsedBytes + Page.ByteSize <= MaxResidentBytes)
        {
            Page.ResidentInMemory = true;
            Page.LastTouchedTick  = FrameTick;
            UsedBytes            += Page.ByteSize;
        }
        else
        {
            Page.ResidentInMemory = false;
        }
    }
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                    RUNTIME CUT + GLASS-EXEMPT CULL + TWO-PHASE HI-Z
------------------------------------------------------------------------------------------------------------------------------------------*/
ClusterRuntimeFrameReport ClusterHierarchy::ExecuteGlassAwareCutAndTwoPhaseHiZ(
    const ClusterCameraView& Camera) const
{
    ClusterRuntimeFrameReport Report{};
    Report.SourceLeafTriangles = Sequence_.SourceTriangleCount;
    if (Sequence_.Tiers.empty() || Records_.empty())
    {
        return Report;
    }

    const double ProjFactor = (0.5 * static_cast<double>(Camera.ViewportHeightPx))
                            / std::tan(0.5 * static_cast<double>(Camera.VerticalFovRad));
    const double ThresholdPx = std::max(0.05, static_cast<double>(Camera.ErrorThresholdPx));

    // Step 1: Karis 2021 Group-Atomic Top-Down DAG Cut!
    // Sibling coarser clusters produced from the same simplified group share EnclosedFinerGlobals; evaluating the cut
    // atomically per sibling group guarantees zero coarse/fine overlap and crack-free group boundaries at all distances.
    std::vector<uint32_t> FrontierStack;
    for (const auto& R : Records_)
    {
        if (R.CoarserDeviationMetres > 1.0e11)
        {
            FrontierStack.push_back(R.GlobalClusterId);
        }
    }
    if (FrontierStack.empty())
    {
        FrontierStack = TierClusterToGlobal_[Sequence_.Tiers.size() - 1u];
    }

    // Reverse index from FinerGid -> CoarserGids at (Tier + 1) so sibling groups are resolved in O(group_size)
    std::vector<std::vector<uint32_t>> FinerToCoarser(Records_.size());
    for (const auto& R : Records_)
    {
        for (uint32_t FinerGid : R.EnclosedFinerGlobals)
        {
            if (FinerGid < FinerToCoarser.size())
            {
                FinerToCoarser[FinerGid].push_back(R.GlobalClusterId);
            }
        }
    }

    std::unordered_set<uint32_t> Visited;
    std::vector<uint32_t>        CutGlobals;

    while (!FrontierStack.empty())
    {
        const uint32_t SeedGid = FrontierStack.back();
        FrontierStack.pop_back();
        if (Visited.count(SeedGid) != 0u)
        {
            continue;
        }

        const auto& SeedRec = Records_[SeedGid];
        if (SeedRec.EnclosedFinerGlobals.empty())
        {
            Visited.insert(SeedGid);
            CutGlobals.push_back(SeedGid);
            continue;
        }

        // Gather the complete connected sibling group at SeedRec.TierIndex sharing EnclosedFinerGlobals
        std::vector<uint32_t>        GroupSiblings = {SeedGid};
        std::unordered_set<uint32_t> GroupFinerSet;
        Visited.insert(SeedGid);

        for (size_t Idx = 0u; Idx < GroupSiblings.size(); ++Idx)
        {
            const uint32_t SibGid = GroupSiblings[Idx];
            for (uint32_t FinerGid : Records_[SibGid].EnclosedFinerGlobals)
            {
                if (GroupFinerSet.insert(FinerGid).second && FinerGid < FinerToCoarser.size())
                {
                    for (uint32_t OtherCoarser : FinerToCoarser[FinerGid])
                    {
                        if (Records_[OtherCoarser].TierIndex == SeedRec.TierIndex && Visited.insert(OtherCoarser).second)
                        {
                            GroupSiblings.push_back(OtherCoarser);
                        }
                    }
                }
            }
        }

        double GroupMaxPx       = 0.0;
        bool   AllFinerResident = true;
        for (uint32_t SibGid : GroupSiblings)
        {
            const auto& Rec = Records_[SibGid];
            GroupMaxPx      = std::max(
                GroupMaxPx,
                ProjectedErrorPixels(
                    Rec.SelfDeviationMetres,
                    Rec.OpticalDeviationBoost,
                    Rec.SphereCentre,
                    Rec.SphereRadiusMetres,
                    Camera.CameraOrigin,
                    ProjFactor));
        }
        for (uint32_t FinerGid : GroupFinerSet)
        {
            const uint32_t PageIdx = Records_[FinerGid].PageSlotIndex;
            if (PageIdx < Pages_.size() && !Pages_[PageIdx].ResidentInMemory)
            {
                AllFinerResident = false;
                break;
            }
        }

        if (GroupMaxPx <= ThresholdPx)
        {
            for (uint32_t SibGid : GroupSiblings)
            {
                CutGlobals.push_back(SibGid);
            }
            continue;
        }

        if (!AllFinerResident)
        {
            Report.FallbackToResidentCoarser += static_cast<uint32_t>(GroupSiblings.size());
            for (uint32_t SibGid : GroupSiblings)
            {
                CutGlobals.push_back(SibGid);
            }
            continue;
        }

        for (uint32_t FinerGid : GroupFinerSet)
        {
            FrontierStack.push_back(FinerGid);
        }
    }

    Report.TotalCutClusters = static_cast<uint32_t>(CutGlobals.size());

    // Step 2: Frustum & Backface Normal-Cone Culling (Transmissive Glass is EXEMPT from backface cone culling!)
    const CameraBasis Basis = BuildCameraBasis(Camera);
    struct ScreenBoundCluster
    {
        uint32_t GlobalId = 0u;
        int      MinX     = 0;
        int      MaxX     = 0;
        int      MinY     = 0;
        int      MaxY     = 0;
        float    NearZ    = 0.0f;
        float    FarZ     = 0.0f;
    };

    std::vector<ScreenBoundCluster> OpaqueCandidates;
    std::vector<ScreenBoundCluster> GlassCandidates;

    for (uint32_t Gid : CutGlobals)
    {
        const auto& Rec    = Records_[Gid];
        const Vec3  Centre = ToVec3(Rec.SphereCentre);
        const float Radius = static_cast<float>(Rec.SphereRadiusMetres);
        const Vec3  ToCam  = Centre - Camera.CameraOrigin;
        const float ViewZ  = Dot(ToCam, Basis.Forward);

        if (ViewZ + Radius <= 0.05f)
        {
            ++Report.FrustumCulledCount;
            continue;
        }
        const float HalfSpanX = ViewZ * Basis.TanHalfH + Radius * std::sqrt(1.0f + Basis.TanHalfH * Basis.TanHalfH);
        const float HalfSpanY = ViewZ * Basis.TanHalfV + Radius * std::sqrt(1.0f + Basis.TanHalfV * Basis.TanHalfV);
        if (std::abs(Dot(ToCam, Basis.Right)) > HalfSpanX || std::abs(Dot(ToCam, Basis.Up)) > HalfSpanY)
        {
            ++Report.FrustumCulledCount;
            continue;
        }

        // Normal-cone backface test: dot(normalize(Centre - Cam), ConeAxis) > sin(cone_half_angle) => all faces point away!
        const float DistToCentre = Length(ToCam);
        if (Rec.ConeCutoff > 0.05 && DistToCentre > Radius + 1.0e-3f)
        {
            const Vec3  ViewDir       = ToCam * (1.0f / DistToCentre);
            const Vec3  Axis          = ToVec3(Rec.ConeAxis);
            const float SinConeHalf   = std::sqrt(std::max(0.0f, 1.0f - static_cast<float>(Rec.ConeCutoff * Rec.ConeCutoff)));
            const float SinSphereSub  = std::min(1.0f, Radius / DistToCentre);
            const float RejectThresh  = std::min(0.99f, SinConeHalf + SinSphereSub);
            if (Dot(ViewDir, Axis) > RejectThresh)
            {
                if (Rec.TransmissiveGlass)
                {
                    ++Report.GlassExemptFromBackface;
                }
                else
                {
                    ++Report.BackfaceConeCulledCount;
                    continue;
                }
            }
        }

        // Project 8 AABB corners for conservative screen-space Hi-Z bounds
        int   SMinX = static_cast<int>(Camera.ViewportWidthPx) - 1;
        int   SMaxX = 0;
        int   SMinY = static_cast<int>(Camera.ViewportHeightPx) - 1;
        int   SMaxY = 0;
        float NearZ = std::max(0.05f, ViewZ - Radius);
        float FarZ  = std::max(NearZ, ViewZ + Radius);
        bool  AnyFront = false;

        for (int Corner = 0; Corner < 8; ++Corner)
        {
            const Vec3 P{
                (Corner & 1) ? Rec.BoundsMax.X : Rec.BoundsMin.X,
                (Corner & 2) ? Rec.BoundsMax.Y : Rec.BoundsMin.Y,
                (Corner & 4) ? Rec.BoundsMax.Z : Rec.BoundsMin.Z};
            float Sx = 0.0f;
            float Sy = 0.0f;
            float Sz = 0.0f;
            if (ProjectPointToScreen(P, Camera, Basis, Sx, Sy, Sz))
            {
                AnyFront = true;
                SMinX    = std::min(SMinX, static_cast<int>(std::floor(Sx)));
                SMaxX    = std::max(SMaxX, static_cast<int>(std::ceil(Sx)));
                SMinY    = std::min(SMinY, static_cast<int>(std::floor(Sy)));
                SMaxY    = std::max(SMaxY, static_cast<int>(std::ceil(Sy)));
            }
        }
        if (!AnyFront)
        {
            ++Report.FrustumCulledCount;
            continue;
        }

        SMinX = std::clamp(SMinX, 0, static_cast<int>(Camera.ViewportWidthPx) - 1);
        SMaxX = std::clamp(SMaxX, 0, static_cast<int>(Camera.ViewportWidthPx) - 1);
        SMinY = std::clamp(SMinY, 0, static_cast<int>(Camera.ViewportHeightPx) - 1);
        SMaxY = std::clamp(SMaxY, 0, static_cast<int>(Camera.ViewportHeightPx) - 1);

        const ScreenBoundCluster Bound{Gid, SMinX, SMaxX, SMinY, SMaxY, NearZ, FarZ};
        if (Rec.TransmissiveGlass)
        {
            GlassCandidates.push_back(Bound);
        }
        else
        {
            OpaqueCandidates.push_back(Bound);
        }
    }

    // Step 3: Two-Phase Coarse Tile Hi-Z Pyramid Occlusion!
    // Sort opaque front-to-back; ONLY opaque triangles write to the coarse Hi-Z depth buffer!
    std::sort(OpaqueCandidates.begin(), OpaqueCandidates.end(), [](const ScreenBoundCluster& A, const ScreenBoundCluster& B)
    {
        return A.NearZ < B.NearZ;
    });

    constexpr uint32_t TileDiv = 4u;
    const uint32_t HiZW        = std::max(1u, (Camera.ViewportWidthPx + TileDiv - 1u) / TileDiv);
    const uint32_t HiZH        = std::max(1u, (Camera.ViewportHeightPx + TileDiv - 1u) / TileDiv);
    std::vector<float> CoarseOpaqueDepth(static_cast<size_t>(HiZW) * HiZH, 1.0e9f);

    // Also track which coarse tiles are covered by glass so we can prove opaque geometry BEHIND glass survives!
    std::vector<uint8_t> GlassCoveredTile(static_cast<size_t>(HiZW) * HiZH, 0u);
    std::vector<float>   GlassNearTile(static_cast<size_t>(HiZW) * HiZH, 1.0e9f);
    for (const auto& Gc : GlassCandidates)
    {
        const int Tx0 = Gc.MinX / static_cast<int>(TileDiv);
        const int Tx1 = Gc.MaxX / static_cast<int>(TileDiv);
        const int Ty0 = Gc.MinY / static_cast<int>(TileDiv);
        const int Ty1 = Gc.MaxY / static_cast<int>(TileDiv);
        for (int Ty = Ty0; Ty <= Ty1; ++Ty)
        {
            for (int Tx = Tx0; Tx <= Tx1; ++Tx)
            {
                const size_t Idx       = static_cast<size_t>(Ty) * HiZW + static_cast<size_t>(Tx);
                GlassCoveredTile[Idx]  = 1u;
                GlassNearTile[Idx]     = std::min(GlassNearTile[Idx], Gc.NearZ);
            }
        }
    }

    auto RasterClusterIntoCoarseHiZ = [&](uint32_t Gid)
    {
        const auto&        Rec  = Records_[Gid];
        const ClusterTier& Tier = Sequence_.Tiers[Rec.TierIndex];
        const FacetCluster& Fc  = Tier.Clusters[Rec.ClusterIndexInTier];
        for (uint32_t Tri : Fc.Triangles)
        {
            float Sx[3]{}, Sy[3]{}, Sz[3]{};
            const Vec3 Vp0 = ToVec3(Tier.Complex.Positions[Tier.Complex.Triangles[Tri * 3u + 0u]]);
            const Vec3 Vp1 = ToVec3(Tier.Complex.Positions[Tier.Complex.Triangles[Tri * 3u + 1u]]);
            const Vec3 Vp2 = ToVec3(Tier.Complex.Positions[Tier.Complex.Triangles[Tri * 3u + 2u]]);
            if (!ProjectPointToScreen(Vp0, Camera, Basis, Sx[0], Sy[0], Sz[0]) ||
                !ProjectPointToScreen(Vp1, Camera, Basis, Sx[1], Sy[1], Sz[1]) ||
                !ProjectPointToScreen(Vp2, Camera, Basis, Sx[2], Sy[2], Sz[2]))
            {
                continue;
            }
            const float Area2 = (Sx[1] - Sx[0]) * (Sy[2] - Sy[0]) - (Sy[1] - Sy[0]) * (Sx[2] - Sx[0]);
            if (std::abs(Area2) < 1.0e-3f)
            {
                continue;
            }
            const int MaxHx = static_cast<int>(HiZW) - 1;
            const int MaxHy = static_cast<int>(HiZH) - 1;
            const int Tx0   = std::clamp(static_cast<int>(std::floor(std::min({Sx[0], Sx[1], Sx[2]}) / TileDiv)), 0, MaxHx);
            const int Tx1   = std::clamp(static_cast<int>(std::floor(std::max({Sx[0], Sx[1], Sx[2]}) / TileDiv)), 0, MaxHx);
            const int Ty0   = std::clamp(static_cast<int>(std::floor(std::min({Sy[0], Sy[1], Sy[2]}) / TileDiv)), 0, MaxHy);
            const int Ty1   = std::clamp(static_cast<int>(std::floor(std::max({Sy[0], Sy[1], Sy[2]}) / TileDiv)), 0, MaxHy);
            const float InvArea = 1.0f / Area2;
            const float MaxTriZ = std::max({Sz[0], Sz[1], Sz[2]});

            for (int Ty = Ty0; Ty <= Ty1; ++Ty)
            {
                for (int Tx = Tx0; Tx <= Tx1; ++Tx)
                {
                    const float Px = (static_cast<float>(Tx) + 0.5f) * static_cast<float>(TileDiv);
                    const float Py = (static_cast<float>(Ty) + 0.5f) * static_cast<float>(TileDiv);
                    const float W0 = ((Sx[1] - Px) * (Sy[2] - Py) - (Sy[1] - Py) * (Sx[2] - Px)) * InvArea;
                    const float W1 = ((Sx[2] - Px) * (Sy[0] - Py) - (Sy[2] - Py) * (Sx[0] - Px)) * InvArea;
                    const float W2 = 1.0f - W0 - W1;
                    if (W0 >= -0.05f && W1 >= -0.05f && W2 >= -0.05f)
                    {
                        const size_t Idx       = static_cast<size_t>(Ty) * HiZW + static_cast<size_t>(Tx);
                        CoarseOpaqueDepth[Idx] = std::min(CoarseOpaqueDepth[Idx], MaxTriZ);
                    }
                }
            }
        }
    };

    for (const auto& Oc : OpaqueCandidates)
    {
        const int Tx0 = Oc.MinX / static_cast<int>(TileDiv);
        const int Tx1 = Oc.MaxX / static_cast<int>(TileDiv);
        const int Ty0 = Oc.MinY / static_cast<int>(TileDiv);
        const int Ty1 = Oc.MaxY / static_cast<int>(TileDiv);

        float FarthestOccluderInFootprint = 0.0f;
        bool  BehindCloserGlass           = false;
        for (int Ty = Ty0; Ty <= Ty1; ++Ty)
        {
            for (int Tx = Tx0; Tx <= Tx1; ++Tx)
            {
                const size_t Idx            = static_cast<size_t>(Ty) * HiZW + static_cast<size_t>(Tx);
                FarthestOccluderInFootprint = std::max(FarthestOccluderInFootprint, CoarseOpaqueDepth[Idx]);
                if (GlassCoveredTile[Idx] != 0u && Oc.NearZ > GlassNearTile[Idx])
                {
                    BehindCloserGlass = true;
                }
            }
        }

        if (Oc.NearZ > FarthestOccluderInFootprint + 0.05f)
        {
            ++Report.HiZOccludedOpaqueCount;
            continue;
        }

        if (BehindCloserGlass)
        {
            ++Report.OpaqueBehindGlassSurvived;
        }

        Report.SelectedOpaqueGlobals.push_back(Oc.GlobalId);
        Report.ActiveTrianglesAfterCull += Records_[Oc.GlobalId].TriangleCount;
        RasterClusterIntoCoarseHiZ(Oc.GlobalId);
    }

    // Test glass clusters against the finalized OPAQUE Hi-Z (never writing glass depth into Hi-Z!)
    for (const auto& Gc : GlassCandidates)
    {
        const int Tx0 = Gc.MinX / static_cast<int>(TileDiv);
        const int Tx1 = Gc.MaxX / static_cast<int>(TileDiv);
        const int Ty0 = Gc.MinY / static_cast<int>(TileDiv);
        const int Ty1 = Gc.MaxY / static_cast<int>(TileDiv);

        float FarthestOccluder = 0.0f;
        for (int Ty = Ty0; Ty <= Ty1; ++Ty)
        {
            for (int Tx = Tx0; Tx <= Tx1; ++Tx)
            {
                FarthestOccluder = std::max(FarthestOccluder, CoarseOpaqueDepth[static_cast<size_t>(Ty) * HiZW + static_cast<size_t>(Tx)]);
            }
        }
        if (Gc.NearZ > FarthestOccluder + 0.05f)
        {
            continue;
        }
        Report.SelectedGlassGlobals.push_back(Gc.GlobalId);
        Report.ActiveTrianglesAfterCull += Records_[Gc.GlobalId].TriangleCount;
    }

    return Report;
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                     VISIBILITY BUFFER & TWO-LAYER GLASS PEEL RASTER
------------------------------------------------------------------------------------------------------------------------------------------*/
void ClusterHierarchy::RasterizeVisibilityAndTwoLayerGlassPeel(
    const ClusterCameraView&            Camera,
    const ClusterRuntimeFrameReport&    CutReport,
    std::vector<VisibilityPixelRecord>& OutPixels,
    std::vector<float>&                 OutOpaqueHiZMip0) const
{
    const uint32_t W = std::max(1u, Camera.ViewportWidthPx);
    const uint32_t H = std::max(1u, Camera.ViewportHeightPx);
    OutPixels.assign(static_cast<size_t>(W) * H, VisibilityPixelRecord{});
    OutOpaqueHiZMip0.assign(static_cast<size_t>(W) * H, 1.0e9f);

    const CameraBasis Basis = BuildCameraBasis(Camera);

    // 1. Opaque visibility buffer raster (writes depth + cluster/triangle IDs + perspective-correct barycentrics)
    for (uint32_t Gid : CutReport.SelectedOpaqueGlobals)
    {
        const auto&         Rec  = Records_[Gid];
        const ClusterTier&  Tier = Sequence_.Tiers[Rec.TierIndex];
        const FacetCluster& Fc   = Tier.Clusters[Rec.ClusterIndexInTier];

        for (uint32_t Tri : Fc.Triangles)
        {
            const Vec3 P0 = ToVec3(Tier.Complex.Positions[Tier.Complex.Triangles[Tri * 3u + 0u]]);
            const Vec3 P1 = ToVec3(Tier.Complex.Positions[Tier.Complex.Triangles[Tri * 3u + 1u]]);
            const Vec3 P2 = ToVec3(Tier.Complex.Positions[Tier.Complex.Triangles[Tri * 3u + 2u]]);

            float Sx[3]{}, Sy[3]{}, Sz[3]{};
            if (!ProjectPointToScreen(P0, Camera, Basis, Sx[0], Sy[0], Sz[0]) ||
                !ProjectPointToScreen(P1, Camera, Basis, Sx[1], Sy[1], Sz[1]) ||
                !ProjectPointToScreen(P2, Camera, Basis, Sx[2], Sy[2], Sz[2]))
            {
                continue;
            }
            const float Area2 = (Sx[1] - Sx[0]) * (Sy[2] - Sy[0]) - (Sy[1] - Sy[0]) * (Sx[2] - Sx[0]);
            if (std::abs(Area2) < 1.0e-4f)
            {
                continue;
            }
            const float InvArea = 1.0f / Area2;
            const Vec3  FaceN   = Normalise(Cross(P1 - P0, P2 - P0));

            const int X0 = std::clamp(static_cast<int>(std::floor(std::min({Sx[0], Sx[1], Sx[2]}))), 0, static_cast<int>(W) - 1);
            const int X1 = std::clamp(static_cast<int>(std::ceil(std::max({Sx[0], Sx[1], Sx[2]}))), 0, static_cast<int>(W) - 1);
            const int Y0 = std::clamp(static_cast<int>(std::floor(std::min({Sy[0], Sy[1], Sy[2]}))), 0, static_cast<int>(H) - 1);
            const int Y1 = std::clamp(static_cast<int>(std::ceil(std::max({Sy[0], Sy[1], Sy[2]}))), 0, static_cast<int>(H) - 1);

            for (int Py = Y0; Py <= Y1; ++Py)
            {
                for (int Px = X0; Px <= X1; ++Px)
                {
                    const float Fx = static_cast<float>(Px) + 0.5f;
                    const float Fy = static_cast<float>(Py) + 0.5f;
                    const float E0 = ((Sx[1] - Fx) * (Sy[2] - Fy) - (Sy[1] - Fy) * (Sx[2] - Fx)) * InvArea;
                    const float E1 = ((Sx[2] - Fx) * (Sy[0] - Fy) - (Sy[2] - Fy) * (Sx[0] - Fx)) * InvArea;
                    const float E2 = 1.0f - E0 - E1;
                    if (E0 < 0.0f || E1 < 0.0f || E2 < 0.0f)
                    {
                        continue;
                    }

                    const float InvZ0 = E0 / Sz[0];
                    const float InvZ1 = E1 / Sz[1];
                    const float InvZ2 = E2 / Sz[2];
                    const float ViewZ = 1.0f / (InvZ0 + InvZ1 + InvZ2);
                    const size_t Idx  = static_cast<size_t>(Py) * W + static_cast<size_t>(Px);

                    if (ViewZ < OutPixels[Idx].OpaqueDepthM)
                    {
                        const Vec3 Bary{InvZ0 * ViewZ, InvZ1 * ViewZ, InvZ2 * ViewZ};
                        auto&      Pix           = OutPixels[Idx];
                        Pix.OpaqueValid          = true;
                        Pix.OpaqueGlobalCluster  = Gid;
                        Pix.OpaqueTierIndex      = Rec.TierIndex;
                        Pix.OpaqueTriangleInTier = Tri;
                        Pix.OpaqueClassification = Rec.ClassificationId;
                        Pix.OpaqueDepthM         = ViewZ;
                        Pix.OpaqueWorldPos       = P0 * Bary.X + P1 * Bary.Y + P2 * Bary.Z;
                        Pix.OpaqueWorldNormal    = (Dot(FaceN, Camera.CameraOrigin - Pix.OpaqueWorldPos) >= 0.0f) ? FaceN : (FaceN * -1.0f);
                        Pix.OpaqueBarycentrics   = Bary;

                        if (Tier.Complex.CarriesUVs && (Tri * 3u + 2u) < Tier.Complex.CornerUVs.size())
                        {
                            const auto& Uv0 = Tier.Complex.CornerUVs[Tri * 3u + 0u];
                            const auto& Uv1 = Tier.Complex.CornerUVs[Tri * 3u + 1u];
                            const auto& Uv2 = Tier.Complex.CornerUVs[Tri * 3u + 2u];
                            Pix.OpaqueUvU   = Bary.X * static_cast<float>(Uv0[0])
                                            + Bary.Y * static_cast<float>(Uv1[0])
                                            + Bary.Z * static_cast<float>(Uv2[0]);
                            Pix.OpaqueUvV   = Bary.X * static_cast<float>(Uv0[1])
                                            + Bary.Y * static_cast<float>(Uv1[1])
                                            + Bary.Z * static_cast<float>(Uv2[1]);
                        }
                        OutOpaqueHiZMip0[Idx] = ViewZ;
                    }
                }
            }
        }
    }

    // 2. Two-Layer Transmissive Glass Peel (tests against OpaqueDepthM WITHOUT modifying OpaqueDepthM!)
    //    Captures nearest entry interface (FrontGlass) and exit interface (BackGlass) per pixel!
    for (uint32_t Gid : CutReport.SelectedGlassGlobals)
    {
        const auto&         Rec  = Records_[Gid];
        const ClusterTier&  Tier = Sequence_.Tiers[Rec.TierIndex];
        const FacetCluster& Fc   = Tier.Clusters[Rec.ClusterIndexInTier];

        for (uint32_t Tri : Fc.Triangles)
        {
            const Vec3 P0 = ToVec3(Tier.Complex.Positions[Tier.Complex.Triangles[Tri * 3u + 0u]]);
            const Vec3 P1 = ToVec3(Tier.Complex.Positions[Tier.Complex.Triangles[Tri * 3u + 1u]]);
            const Vec3 P2 = ToVec3(Tier.Complex.Positions[Tier.Complex.Triangles[Tri * 3u + 2u]]);

            float Sx[3]{}, Sy[3]{}, Sz[3]{};
            if (!ProjectPointToScreen(P0, Camera, Basis, Sx[0], Sy[0], Sz[0]) ||
                !ProjectPointToScreen(P1, Camera, Basis, Sx[1], Sy[1], Sz[1]) ||
                !ProjectPointToScreen(P2, Camera, Basis, Sx[2], Sy[2], Sz[2]))
            {
                continue;
            }
            const float Area2 = (Sx[1] - Sx[0]) * (Sy[2] - Sy[0]) - (Sy[1] - Sy[0]) * (Sx[2] - Sx[0]);
            if (std::abs(Area2) < 1.0e-4f)
            {
                continue;
            }
            const float InvArea = 1.0f / Area2;
            const Vec3  OutwardN = Normalise(Cross(P1 - P0, P2 - P0));

            const int X0 = std::clamp(static_cast<int>(std::floor(std::min({Sx[0], Sx[1], Sx[2]}))), 0, static_cast<int>(W) - 1);
            const int X1 = std::clamp(static_cast<int>(std::ceil(std::max({Sx[0], Sx[1], Sx[2]}))), 0, static_cast<int>(W) - 1);
            const int Y0 = std::clamp(static_cast<int>(std::floor(std::min({Sy[0], Sy[1], Sy[2]}))), 0, static_cast<int>(H) - 1);
            const int Y1 = std::clamp(static_cast<int>(std::ceil(std::max({Sy[0], Sy[1], Sy[2]}))), 0, static_cast<int>(H) - 1);

            for (int Py = Y0; Py <= Y1; ++Py)
            {
                for (int Px = X0; Px <= X1; ++Px)
                {
                    const float Fx = static_cast<float>(Px) + 0.5f;
                    const float Fy = static_cast<float>(Py) + 0.5f;
                    const float E0 = ((Sx[1] - Fx) * (Sy[2] - Fy) - (Sy[1] - Fy) * (Sx[2] - Fx)) * InvArea;
                    const float E1 = ((Sx[2] - Fx) * (Sy[0] - Fy) - (Sy[2] - Fy) * (Sx[0] - Fx)) * InvArea;
                    const float E2 = 1.0f - E0 - E1;
                    if (E0 < 0.0f || E1 < 0.0f || E2 < 0.0f)
                    {
                        continue;
                    }

                    const float InvZ0 = E0 / Sz[0];
                    const float InvZ1 = E1 / Sz[1];
                    const float InvZ2 = E2 / Sz[2];
                    const float ViewZ = 1.0f / (InvZ0 + InvZ1 + InvZ2);
                    const size_t Idx  = static_cast<size_t>(Py) * W + static_cast<size_t>(Px);
                    auto&        Pix  = OutPixels[Idx];

                    // Depth-test against opaque depth ONLY!
                    if (ViewZ >= Pix.OpaqueDepthM)
                    {
                        continue;
                    }

                    const Vec3 Bary{InvZ0 * ViewZ, InvZ1 * ViewZ, InvZ2 * ViewZ};
                    const Vec3 HitPos = P0 * Bary.X + P1 * Bary.Y + P2 * Bary.Z;

                    if (ViewZ < Pix.FrontGlassDepthM - 1.0e-3f)
                    {
                        // Push previous front layer down to back peel if separated!
                        if (Pix.FrontGlassValid && Pix.FrontGlassDepthM < Pix.BackGlassDepthM)
                        {
                            Pix.BackGlassValid  = true;
                            Pix.BackGlassDepthM = Pix.FrontGlassDepthM;
                            Pix.BackGlassPos    = Pix.FrontGlassPos;
                            Pix.BackGlassNormal = Pix.FrontGlassNormal;
                        }
                        Pix.FrontGlassValid     = true;
                        Pix.FrontGlassCluster   = Gid;
                        Pix.FrontGlassTier      = Rec.TierIndex;
                        Pix.GlassClassification = Rec.ClassificationId;
                        Pix.FrontGlassDepthM    = ViewZ;
                        Pix.FrontGlassPos       = HitPos;
                        Pix.FrontGlassNormal    = OutwardN;
                    }
                    else if (ViewZ > Pix.FrontGlassDepthM + 1.0e-3f && ViewZ < Pix.BackGlassDepthM)
                    {
                        Pix.BackGlassValid  = true;
                        Pix.BackGlassDepthM = ViewZ;
                        Pix.BackGlassPos    = HitPos;
                        Pix.BackGlassNormal = OutwardN;
                    }
                }
            }
        }
    }
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                          FOUR-PANEL DIAGNOSTIC SHOWCASE RENDERER
------------------------------------------------------------------------------------------------------------------------------------------*/
void ClusterHierarchy::RenderFourPanelDiagnosticRgba8(
    const ClusterCameraView& Camera,
    std::vector<uint8_t>&    OutRgba8Pixels) const
{
    const uint32_t FullW = std::max(4u, Camera.ViewportWidthPx);
    const uint32_t FullH = std::max(4u, Camera.ViewportHeightPx);
    const uint32_t SubW  = FullW / 2u;
    const uint32_t SubH  = FullH / 2u;

    ClusterCameraView SubCam = Camera;
    SubCam.ViewportWidthPx   = SubW;
    SubCam.ViewportHeightPx  = SubH;

    const ClusterRuntimeFrameReport     Cut = ExecuteGlassAwareCutAndTwoPhaseHiZ(SubCam);
    std::vector<VisibilityPixelRecord>  Vis;
    std::vector<float>                  HiZ;
    RasterizeVisibilityAndTwoLayerGlassPeel(SubCam, Cut, Vis, HiZ);

    const CameraBasis Basis      = BuildCameraBasis(SubCam);
    const Vec3        SunDir     = Normalise(Vec3{0.42f, -0.58f, 0.70f});
    const uint32_t    MaxTierIdx = Sequence_.Tiers.empty() ? 1u : std::max(1u, static_cast<uint32_t>(Sequence_.Tiers.size() - 1u));

    // Pre-shade the resolved opaque image on SubW x SubH so Panel 4's two-layer glass exit ray can refract & sample it!
    std::vector<Vec3> ResolvedOpaque(static_cast<size_t>(SubW) * SubH, Vec3{0.03f, 0.05f, 0.09f});
    for (uint32_t Y = 0u; Y < SubH; ++Y)
    {
        const float SkyT = static_cast<float>(Y) / static_cast<float>(SubH);
        const Vec3  Sky  = Vec3{0.06f, 0.11f, 0.22f} * (1.0f - SkyT) + Vec3{0.22f, 0.32f, 0.46f} * SkyT;
        for (uint32_t X = 0u; X < SubW; ++X)
        {
            const size_t Idx = static_cast<size_t>(Y) * SubW + X;
            const auto&  P   = Vis[Idx];
            if (!P.OpaqueValid)
            {
                ResolvedOpaque[Idx] = Sky;
                continue;
            }
            const auto& Mat = FindMaterial(P.OpaqueClassification);
            const int   ChU = static_cast<int>(std::floor(P.OpaqueUvU * 12.0f));
            const int   ChV = static_cast<int>(std::floor(P.OpaqueUvV * 12.0f));
            const float Checker = ((ChU + ChV) & 1) ? 1.0f : 0.62f;
            const float NdotL   = std::max(0.0f, Dot(P.OpaqueWorldNormal, SunDir));
            const Vec3  ViewDir = Normalise(SubCam.CameraOrigin - P.OpaqueWorldPos);
            const Vec3  HalfVec = Normalise(SunDir + ViewDir);
            const float Spec    = std::pow(std::max(0.0f, Dot(P.OpaqueWorldNormal, HalfVec)), 48.0f) * 0.35f;
            ResolvedOpaque[Idx] = Mat.AlbedoRgb * Checker * (0.20f + 0.88f * NdotL) + Vec3{Spec, Spec, Spec};
        }
    }

    OutRgba8Pixels.assign(static_cast<size_t>(FullW) * FullH * 4u, 255u);

    auto WriteFullPixel = [&](uint32_t Fx, uint32_t Fy, Vec3 LinearCol)
    {
        if (Fx >= FullW || Fy >= FullH)
        {
            return;
        }
        const size_t Base        = (static_cast<size_t>(Fy) * FullW + Fx) * 4u;
        OutRgba8Pixels[Base + 0] = EncodeSrgb8(LinearCol.X);
        OutRgba8Pixels[Base + 1] = EncodeSrgb8(LinearCol.Y);
        OutRgba8Pixels[Base + 2] = EncodeSrgb8(LinearCol.Z);
        OutRgba8Pixels[Base + 3] = 255u;
    };

    for (uint32_t Y = 0u; Y < SubH; ++Y)
    {
        for (uint32_t X = 0u; X < SubW; ++X)
        {
            const size_t Idx = static_cast<size_t>(Y) * SubW + X;
            const auto&  P   = Vis[Idx];

            // Panel 1 (Top-Left): Cluster Visibility IDs + Cyan Glass Wire/Tint
            Vec3 ColId{0.02f, 0.03f, 0.06f};
            if (P.OpaqueValid)
            {
                const float MinBary = std::min({P.OpaqueBarycentrics.X, P.OpaqueBarycentrics.Y, P.OpaqueBarycentrics.Z});
                const float Edge    = (MinBary < 0.048f) ? 0.28f : 1.0f;
                ColId               = HashPastelColour(P.OpaqueGlobalCluster) * Edge;
            }
            if (P.FrontGlassValid)
            {
                const Vec3 GlassTint = HashPastelColour(P.FrontGlassCluster + 97u) * 0.35f + Vec3{0.10f, 0.62f, 0.85f} * 0.65f;
                ColId                = ColId * 0.42f + GlassTint * 0.58f;
            }
            WriteFullPixel(X, Y, ColId);

            // Panel 2 (Top-Right): Live Screen-Space Tier LOD Heatmap (Tier 0 = Warm Red/Gold -> Coarsest = Cool Blue)
            auto TierHeat = [&](uint32_t TierIdx) -> Vec3
            {
                const float T = std::clamp(static_cast<float>(TierIdx) / static_cast<float>(MaxTierIdx), 0.0f, 1.0f);
                if (T < 0.5f)
                {
                    const float K = T * 2.0f;
                    return Vec3{0.96f * (1.0f - K) + 0.18f * K, 0.22f * (1.0f - K) + 0.86f * K, 0.12f * (1.0f - K) + 0.42f * K};
                }
                const float K = (T - 0.5f) * 2.0f;
                return Vec3{0.18f * (1.0f - K) + 0.12f * K, 0.86f * (1.0f - K) + 0.32f * K, 0.42f * (1.0f - K) + 0.96f * K};
            };
            Vec3 ColLod{0.02f, 0.03f, 0.06f};
            if (P.OpaqueValid)
            {
                const float Shade = 0.55f + 0.45f * std::max(0.0f, Dot(P.OpaqueWorldNormal, SunDir));
                ColLod            = TierHeat(P.OpaqueTierIndex) * Shade;
            }
            if (P.FrontGlassValid)
            {
                // Highlight curved glass optical IOR refinement in bright warm rim + tier heat
                const Vec3  ViewDir = Normalise(SubCam.CameraOrigin - P.FrontGlassPos);
                const float Rim     = std::pow(1.0f - std::abs(Dot(P.FrontGlassNormal, ViewDir)), 2.2f);
                ColLod              = ColLod * 0.45f + TierHeat(P.FrontGlassTier) * (0.45f + 0.45f * Rim);
            }
            WriteFullPixel(SubW + X, Y, ColLod);

            // Panel 3 (Bottom-Left): Hi-Z Occluder Depth + Two-Layer Glass Peel Proof (Opaque Behind Glass Preserved!)
            Vec3 ColPeel{0.015f, 0.02f, 0.04f};
            if (P.OpaqueValid)
            {
                const float InvD = std::clamp(3.8f / std::max(0.5f, P.OpaqueDepthM), 0.05f, 1.0f);
                ColPeel          = Vec3{InvD * 0.85f, InvD * 0.88f, InvD * 0.95f};
            }
            if (P.FrontGlassValid && P.BackGlassValid)
            {
                // Two-layer glass peel pixel: golden-emerald overlay while still showing un-culled opaque behind!
                const float Thick = std::clamp(P.BackGlassDepthM - P.FrontGlassDepthM, 0.0f, 2.5f);
                ColPeel           = ColPeel * 0.48f + Vec3{0.85f, 0.72f, 0.12f} * (0.28f + 0.22f * Thick);
            }
            else if (P.FrontGlassValid)
            {
                ColPeel = ColPeel * 0.50f + Vec3{0.10f, 0.82f, 0.45f} * 0.50f;
            }
            WriteFullPixel(X, SubH + Y, ColPeel);

            // Panel 4 (Bottom-Right): Deferred UV Resolve + Two-Layer Snell Refraction & Beer-Lambert Glass Absorption!
            Vec3 ColFinal = ResolvedOpaque[Idx];
            if (P.FrontGlassValid)
            {
                const auto& GMat    = FindMaterial(P.GlassClassification);
                const Vec3  IncDir  = Normalise(P.FrontGlassPos - SubCam.CameraOrigin);
                Vec3        EntryN  = P.FrontGlassNormal;
                if (Dot(EntryN, IncDir) > 0.0f)
                {
                    EntryN = EntryN * -1.0f;
                }
                const float CosI  = std::clamp(-Dot(IncDir, EntryN), 0.0f, 1.0f);
                const float F0    = ((GMat.RefractiveIndexIor - 1.0f) / (GMat.RefractiveIndexIor + 1.0f))
                                  * ((GMat.RefractiveIndexIor - 1.0f) / (GMat.RefractiveIndexIor + 1.0f));
                const float Fres  = F0 + (1.0f - F0) * std::pow(1.0f - CosI, 5.0f);
                const float EtaIn = 1.0f / std::max(1.01f, GMat.RefractiveIndexIor);
                const float KIn   = 1.0f - EtaIn * EtaIn * (1.0f - CosI * CosI);

                Vec3 RefractDir = IncDir;
                if (KIn > 0.0f)
                {
                    RefractDir = Normalise(IncDir * EtaIn + EntryN * (EtaIn * CosI - std::sqrt(KIn)));
                }

                Vec3  SamplePoint = P.FrontGlassPos + RefractDir * 0.65f;
                float ThicknessM  = 0.18f;
                if (P.BackGlassValid)
                {
                    ThicknessM  = std::max(0.02f, Length(P.BackGlassPos - P.FrontGlassPos));
                    Vec3 ExitN  = P.BackGlassNormal;
                    if (Dot(ExitN, RefractDir) > 0.0f)
                    {
                        ExitN = ExitN * -1.0f;
                    }
                    const float CosE   = std::clamp(-Dot(RefractDir, ExitN), 0.0f, 1.0f);
                    const float EtaOut = GMat.RefractiveIndexIor;
                    const float KOut   = 1.0f - EtaOut * EtaOut * (1.0f - CosE * CosE);
                    const Vec3  ExitDir = (KOut > 0.0f)
                        ? Normalise(RefractDir * EtaOut + ExitN * (EtaOut * CosE - std::sqrt(KOut)))
                        : (RefractDir - ExitN * (2.0f * Dot(RefractDir, ExitN)));
                    const float ResumeDist = std::max(0.25f, P.OpaqueDepthM - P.BackGlassDepthM);
                    SamplePoint            = P.BackGlassPos + ExitDir * ResumeDist;
                }

                float Rx = static_cast<float>(X);
                float Ry = static_cast<float>(Y);
                float Rz = 1.0f;
                if (ProjectPointToScreen(SamplePoint, SubCam, Basis, Rx, Ry, Rz))
                {
                    const uint32_t SxClamped = std::clamp(static_cast<uint32_t>(std::max(0.0f, Rx)), 0u, SubW - 1u);
                    const uint32_t SyClamped = std::clamp(static_cast<uint32_t>(std::max(0.0f, Ry)), 0u, SubH - 1u);
                    ColFinal                 = ResolvedOpaque[static_cast<size_t>(SyClamped) * SubW + SxClamped];
                }

                // Beer-Lambert spectral glass absorption + crisp specular highlight + Fresnel sky reflection
                const Vec3 Beer{
                    std::exp(-GMat.SpectralAbsorptionPerMetre.X * ThicknessM),
                    std::exp(-GMat.SpectralAbsorptionPerMetre.Y * ThicknessM),
                    std::exp(-GMat.SpectralAbsorptionPerMetre.Z * ThicknessM)};
                const Vec3 ReflDir  = IncDir - EntryN * (2.0f * Dot(IncDir, EntryN));
                const Vec3 SkyRefl  = Vec3{0.22f, 0.36f, 0.58f} * (0.4f + 0.6f * std::max(0.0f, ReflDir.Z));
                const float SunSpec = std::pow(std::max(0.0f, Dot(ReflDir, SunDir)), 180.0f) * 3.2f;
                ColFinal = Vec3{ColFinal.X * Beer.X, ColFinal.Y * Beer.Y, ColFinal.Z * Beer.Z} * (1.0f - Fres)
                         + SkyRefl * Fres
                         + Vec3{SunSpec, SunSpec * 0.96f, SunSpec * 0.90f};
            }
            // ACES filmic fit on Panel 4
            auto Aces = [](float V)
            {
                return std::clamp((V * (2.51f * V + 0.03f)) / (V * (2.43f * V + 0.59f) + 0.14f), 0.0f, 1.0f);
            };
            WriteFullPixel(SubW + X, SubH + Y, {Aces(ColFinal.X), Aces(ColFinal.Y), Aces(ColFinal.Z)});
        }
    }

    // Crisp 2-pixel divider crosshairs separating the 4 diagnostic quadrants
    for (uint32_t Y = 0u; Y < FullH; ++Y)
    {
        WriteFullPixel(SubW - 1u, Y, {0.85f, 0.88f, 0.94f});
        WriteFullPixel(SubW, Y, {0.85f, 0.88f, 0.94f});
    }
    for (uint32_t X = 0u; X < FullW; ++X)
    {
        WriteFullPixel(X, SubH - 1u, {0.85f, 0.88f, 0.94f});
        WriteFullPixel(X, SubH, {0.85f, 0.88f, 0.94f});
    }
}

} // namespace Frontier
