/*==========================================================================================================================================
                                                      PARTICLESIMULATIONSEQUENCE.CPP
==========================================================================================================================================*/
// 🧩 eos engine.js on the device exchange: stores, programs, the refresh's dispatches and raster, the readbacks.

#include "Frontier/Engine/Rendering/ParticleSimulation/ParticleSimulationSequence.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>

namespace Frontier::ParticleSimulation
{

namespace
{

constexpr VkDeviceSize ParticleBytes      = 80;     // eos PART_BYTES
constexpr VkDeviceSize GuideBytes         = 28;     // eos LINE_BYTES
constexpr uint32_t     GuideVertexLimit   = 4096;   // eos MAX_LINE_VERTS
constexpr uint32_t     WindCells          = ParticleDomainDimensions[0] * ParticleDomainDimensions[1] * ParticleDomainDimensions[2];
constexpr uint32_t     MolecularCells     = ParticleMolecularGridLimit * ParticleMolecularGridLimit * ParticleMolecularGridLimit;

uint32_t Groups(uint32_t Count, uint32_t Width = 64u) noexcept
{
    return (Count + Width - 1u) / Width;
}

ColorTarget ResolveTarget(bool Blend, bool Additive)
{
    ColorTarget Target;
    Target.Format       = TextureFormat::Rgba8Unorm;
    Target.BlendEnabled = Blend;
    if (Blend)
    {
        // 📝 eos ADD (one, one) and OVER (one, one − source alpha), both on colour and alpha.
        const BlendFactor Destination = Additive ? BlendFactor::One : BlendFactor::OneMinusSourceAlpha;
        Target.Color = { BlendOperation::Add, BlendFactor::One, Destination };
        Target.Alpha = { BlendOperation::Add, BlendFactor::One, Destination };
    }
    return Target;
}

float DecodeHalf(uint16_t Half) noexcept
{
    const uint32_t Sign     = (Half >> 15u) & 1u;
    const uint32_t Exponent = (Half >> 10u) & 0x1fu;
    const uint32_t Fraction = Half & 0x3ffu;
    const float    Signed   = Sign ? -1.0f : 1.0f;
    if (Exponent == 0u) return Signed * std::ldexp(static_cast<float>(Fraction) / 1024.0f, -14);
    if (Exponent == 31u) return Fraction ? std::nanf("") : Signed * INFINITY;
    return Signed * std::ldexp(1.0f + static_cast<float>(Fraction) / 1024.0f, static_cast<int>(Exponent) - 15);
}

// 📝 IEEE-754 binary16, round-to-nearest-even; non-finite inputs become zero and finite overflow saturates.
uint16_t EncodeHalf(float Scalar) noexcept
{
    if (!std::isfinite(Scalar)) Scalar = 0.0f;
    Scalar = std::clamp(Scalar, -65504.0f, 65504.0f);
    uint32_t Bits = 0;
    std::memcpy(&Bits, &Scalar, sizeof(Bits));
    const uint32_t Sign = (Bits >> 16u) & 0x8000u;
    const int32_t Exponent = static_cast<int32_t>((Bits >> 23u) & 0xffu) - 127 + 15;
    uint32_t Mantissa = Bits & 0x7fffffu;
    if (Exponent <= 0)
    {
        if (Exponent < -10) return static_cast<uint16_t>(Sign);
        Mantissa |= 0x800000u;
        const uint32_t Shift = static_cast<uint32_t>(14 - Exponent);
        uint32_t Half = Mantissa >> Shift;
        const uint32_t Rest = Mantissa & ((1u << Shift) - 1u);
        const uint32_t Mid = 1u << (Shift - 1u);
        if (Rest > Mid || (Rest == Mid && (Half & 1u))) ++Half;
        return static_cast<uint16_t>(Sign | Half);
    }
    if (Exponent >= 31) return static_cast<uint16_t>(Sign | 0x7bffu);
    uint32_t Half = Sign | (static_cast<uint32_t>(Exponent) << 10u) | (Mantissa >> 13u);
    const uint32_t Rest = Mantissa & 0x1fffu;
    if (Rest > 0x1000u || (Rest == 0x1000u && (Half & 1u))) ++Half;
    return static_cast<uint16_t>(std::min<uint32_t>(Half, Sign | 0x7bffu));
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    EFFECT STORES
//------------------------------------------------------------------------------------------------------------------------

// 📝 One effect's device resources (eos SystemGPU). Only molecular effects own a neighbour lattice; the rest share a vacant one.
struct ParticleSimulationSequence::EffectStores
{
    std::string                      Token;
    uint64_t                         Generation = 0;
    uint32_t                         Capacity   = 0;
    bool                             Molecular  = false;
    bool                             Fibre      = false;
    bool                             Seen       = false;
    std::shared_ptr<DeviceRegion>    Particles, Snapshot, Census, Uniform, CellCount, CellSlots, FibreUniform, FibrePath;
    std::shared_ptr<DescriptorGroup> SimulationGroup, RasterGroup, FibreGroup;
    ParticleCensus                   Reading;
    uint64_t                         Bytes = 0;
};

ParticleSimulationSequence::ParticleSimulationSequence() = default;

ParticleSimulationSequence::~ParticleSimulationSequence()
{
    if (Exchange_)
    {
        Exchange_->AwaitIdle();
    }
    Stores_.clear();
}

ParticleSimulationSequence::EffectStores& ParticleSimulationSequence::ResolveStores(const ParticleEffectInstance& Effect)
{
    const ParticleEffectParameters& P         = Effect.Parameters;
    const uint32_t                  Capacity  = ResolveParticleCapacity(P);
    const bool                      Molecular = EvaluateParticleMolecular(P);
    const bool                      Fibre     = P.Behaviour == ParticleBehaviour::LightFibre;
    for (auto& Stores : Stores_)
    {
        if (Stores->Token == Effect.Token && Stores->Generation == Effect.StoreGeneration && Stores->Capacity == Capacity
            && Stores->Molecular == Molecular && Stores->Fibre == Fibre)
        {
            return *Stores;
        }
    }
    std::erase_if(Stores_, [&](const std::unique_ptr<EffectStores>& Stores) { return Stores->Token == Effect.Token; });
    auto Created        = std::make_unique<EffectStores>();
    Created->Token      = Effect.Token;
    Created->Generation = Effect.StoreGeneration;
    Created->Capacity   = Capacity;
    Created->Molecular  = Molecular;
    Created->Fibre      = Fibre;
    const std::string Label = "Particle effect " + Effect.Token;
    Created->Particles = Exchange_->ConstructRegion(Capacity * ParticleBytes, Label + " particles");
    Created->Snapshot  = Exchange_->ConstructRegion(Capacity * ParticleBytes, Label + " snapshot");
    Created->Census    = Exchange_->ConstructRegion(32, Label + " census");
    Created->Uniform   = Exchange_->ConstructRegion(256, Label + " constants");
    Created->Bytes     = 2u * Capacity * ParticleBytes + 32u + 256u;
    if (Molecular)
    {
        Created->CellCount = Exchange_->ConstructRegion(MolecularCells * 4u, Label + " cell counts");
        Created->CellSlots = Exchange_->ConstructRegion(static_cast<VkDeviceSize>(MolecularCells) * ParticleMolecularSlots * 4u, Label + " cell slots");
        Created->Bytes += MolecularCells * 4u + static_cast<uint64_t>(MolecularCells) * ParticleMolecularSlots * 4u;
    }
    else
    {
        Created->CellCount = VacantCellCount_;
        Created->CellSlots = VacantCellSlots_;
    }
    Created->SimulationGroup = Exchange_->ConstructDescriptorGroup(SimulationLayout_, { Created->Uniform, Created->Particles, Created->Census,
                                                                                        Created->CellCount, Created->CellSlots, Created->Snapshot,
                                                                                        Fields_ }, Label + " simulation");
    Created->RasterGroup     = Exchange_->ConstructDescriptorGroup(RasterLayout_, { Created->Uniform, Created->Particles, Segments_ }, Label + " raster");
    if (Fibre)
    {
        Created->FibreUniform = Exchange_->ConstructRegion(512, Label + " fibre constants");
        Created->FibrePath    = Exchange_->ConstructRegion(LightFibrePathSamples * 16u, Label + " fibre path");
        Created->FibreGroup   = Exchange_->ConstructDescriptorGroup(RasterLayout_, { Created->FibreUniform, Created->FibrePath, Segments_ }, Label + " fibre");
        Created->Bytes += 512u + LightFibrePathSamples * 16u;
    }
    Stores_.push_back(std::move(Created));
    return *Stores_.back();
}

const ParticleCensus* ParticleSimulationSequence::QueryCensus(std::string_view Token) const noexcept
{
    for (const auto& Stores : Stores_)
    {
        if (Stores->Token == Token)
        {
            return &Stores->Reading;
        }
    }
    return nullptr;
}

uint64_t ParticleSimulationSequence::QueryStoreBytes() const noexcept
{
    uint64_t Total = 0;
    for (const auto& Stores : Stores_) Total += Stores->Bytes;
    return Total;
}

VkImageView ParticleSimulationSequence::QueryPresentedView() const noexcept
{
    return LensedView_ ? LensedView_->Handle : VK_NULL_HANDLE;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

bool ParticleSimulationSequence::Construct(const VulkanDeviceAccess* HostDevice, const std::filesystem::path& ShaderFolder,
                                           std::string* Diagnostic)
{
    Exchange_ = std::make_unique<DeviceExchange>();
    if (HostDevice != nullptr ? !Exchange_->AttachDevice(*HostDevice, Diagnostic) : !Exchange_->Initialize("", Diagnostic)) return false;
    Adapter_ = Exchange_->AdapterDescription();

    const DescriptorSlot Refresh[]    = { { DescriptorCode::Uniform }, { DescriptorCode::Texture3D }, { DescriptorCode::Sampler } };
    const DescriptorSlot Simulation[] = { { DescriptorCode::Uniform }, { DescriptorCode::Storage },     { DescriptorCode::Storage },
                                          { DescriptorCode::Storage }, { DescriptorCode::Storage },     { DescriptorCode::StorageRead },
                                          { DescriptorCode::StorageRead } };
    const DescriptorSlot Raster[]     = { { DescriptorCode::Uniform }, { DescriptorCode::StorageRead }, { DescriptorCode::StorageRead } };
    const DescriptorSlot Wind[]       = { { DescriptorCode::Uniform }, { DescriptorCode::StorageRead },
                                          { DescriptorCode::StorageTexture3D, TextureFormat::Rgba16Float } };
    const DescriptorSlot Lensing[]    = { { DescriptorCode::Uniform }, { DescriptorCode::Texture2D }, { DescriptorCode::Sampler } };
    RefreshLayout_    = Exchange_->ConstructDescriptorLayout(Refresh, "Particle refresh");
    SimulationLayout_ = Exchange_->ConstructDescriptorLayout(Simulation, "Particle simulation");
    RasterLayout_     = Exchange_->ConstructDescriptorLayout(Raster, "Particle raster");
    WindLayout_       = Exchange_->ConstructDescriptorLayout(Wind, "Particle wind lattice");
    LensingLayout_    = Exchange_->ConstructDescriptorLayout(Lensing, "Particle lensing");

    RefreshConstants_ = Exchange_->ConstructRegion(208, "Particle refresh constants");
    Components_       = Exchange_->ConstructRegion(ParticleWindComponentLimit * 32u, "Particle wind components");
    Segments_         = Exchange_->ConstructRegion(ParticleLightningSegmentLimit * 2u * 16u, "Particle lightning segments");
    Guides_           = Exchange_->ConstructRegion(GuideVertexLimit * GuideBytes, "Particle guides");
    VacantEffect_     = Exchange_->ConstructRegion(256, "Particle vacant constants");
    VacantParticles_  = Exchange_->ConstructRegion(ParticleBytes, "Particle vacant particles");
    Fields_           = Exchange_->ConstructRegion(512, "Particle acceleration fields");
    VacantCellCount_  = Exchange_->ConstructRegion(16, "Particle vacant cell counts");
    VacantCellSlots_  = Exchange_->ConstructRegion(16, "Particle vacant cell slots");
    LensingConstants_ = Exchange_->ConstructRegion(128, "Particle lensing constants");

    TextureSpecification Lattice;
    Lattice.Label         = "Particle wind lattice";
    Lattice.Width         = ParticleDomainDimensions[0];
    Lattice.Height        = ParticleDomainDimensions[1];
    Lattice.DepthOrLayers = ParticleDomainDimensions[2];
    Lattice.Dimension     = TextureDimension::Volumetric;
    Lattice.Format        = TextureFormat::Rgba16Float;
    Lattice.Usage         = TextureUsage::Storage | TextureUsage::Sampled | TextureUsage::CopySource | TextureUsage::CopyTarget;
    WindTexture_          = Exchange_->ConstructTexture(Lattice);
    TextureViewSpecification Volume;
    Volume.Dimension    = ViewDimension::Volumetric;
    Volume.DimensionSet = true;
    WindView_           = Exchange_->ConstructView(WindTexture_, Volume);
    SamplerSpecification Linear;
    Linear.MagFilter = FilterMode::Linear;
    Linear.MinFilter = FilterMode::Linear;
    WindSampler_     = Exchange_->ConstructSampler(Linear);
    LensingSampler_  = Exchange_->ConstructSampler(Linear);

    RefreshGroup_ = Exchange_->ConstructDescriptorGroup(RefreshLayout_, { RefreshConstants_, WindView_, WindSampler_ }, "Particle refresh");
    WindGroup_    = Exchange_->ConstructDescriptorGroup(WindLayout_, { RefreshConstants_, Components_, WindView_ }, "Particle wind lattice");
    VacantGroup_  = Exchange_->ConstructDescriptorGroup(RasterLayout_, { VacantEffect_, VacantParticles_, Segments_ }, "Particle vacant");
    return ConstructPrograms(ShaderFolder, Diagnostic);
}

bool ParticleSimulationSequence::ConstructPrograms(const std::filesystem::path& Folder, std::string* Diagnostic)
{
    const auto Spirv = [&](const char* Unit, const char* Entry) { return (Folder / (std::string(Unit) + "." + Entry + ".spv")).string(); };
    const auto Compute = [&](const char* Unit, const char* Entry, std::vector<std::shared_ptr<DescriptorLayout>> Layouts)
    {
        return Exchange_->ConstructComputeProgram(Spirv(Unit, Entry), Entry, std::move(Layouts), {}, Diagnostic);
    };
    WindProgram_         = Compute("WindLattice", "ConstructWindLattice", { WindLayout_ });
    ReleaseProgram_      = Compute("ParticleSimulation", "ReleaseParticles", { RefreshLayout_, SimulationLayout_ });
    AdvanceProgram_      = Compute("ParticleSimulation", "AdvanceParticles", { RefreshLayout_, SimulationLayout_ });
    ClearCensusProgram_  = Compute("ParticleSimulation", "ClearCensus", { RefreshLayout_, SimulationLayout_ });
    GatherCensusProgram_ = Compute("ParticleSimulation", "GatherCensus", { RefreshLayout_, SimulationLayout_ });
    ClearCellsProgram_   = Compute("ParticleSimulation", "ClearMolecularCells", { RefreshLayout_, SimulationLayout_ });
    InsertCellsProgram_  = Compute("ParticleSimulation", "InsertMolecularCells", { RefreshLayout_, SimulationLayout_ });
    MoleculesProgram_    = Compute("ParticleSimulation", "AdvanceMolecules", { RefreshLayout_, SimulationLayout_ });
    SwarmProgram_        = Compute("ParticleSimulation", "AdvanceSwarm", { RefreshLayout_, SimulationLayout_ });
    if (!WindProgram_ || !ReleaseProgram_ || !AdvanceProgram_ || !ClearCensusProgram_ || !GatherCensusProgram_ || !ClearCellsProgram_
        || !InsertCellsProgram_ || !MoleculesProgram_ || !SwarmProgram_)
    {
        return false;
    }

    // 📝 eos mkR: depth tested (less) without writes; the floor alone writes depth.
    const auto Raster = [&](const char* Unit, const char* Vertex, const char* Fragment, bool Blend, bool Additive, bool DepthWrite = false,
                            VkPrimitiveTopology Topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST, std::vector<VertexLayout> Layouts = {})
    {
        RasterProgramSpecification Specification;
        Specification.Label             = std::string("Particle ") + Vertex;
        Specification.VertexSpirvPath   = Spirv(Unit, Vertex);
        Specification.VertexEntry       = Vertex;
        Specification.FragmentSpirvPath = Spirv(Unit, Fragment);
        Specification.FragmentEntry     = Fragment;
        Specification.VertexLayouts     = std::move(Layouts);
        Specification.Topology          = Topology;
        Specification.DepthEnabled      = true;
        Specification.DepthFormat       = TextureFormat::Depth32Float;
        Specification.DepthWrite        = DepthWrite;
        Specification.DepthCompare      = CompareFunction::Less;
        Specification.Targets           = { ResolveTarget(Blend, Additive) };
        Specification.Layouts           = { RefreshLayout_, RasterLayout_ };
        return Exchange_->ConstructRasterProgram(Specification, Diagnostic);
    };
    ParticleAdditive_  = Raster("ParticleRasterization", "ParticleVertex", "ParticleFragment", true, true);
    ParticleAlphaOver_ = Raster("ParticleRasterization", "ParticleVertex", "ParticleFragment", true, false);
    CubeProgram_       = Raster("ParticleRasterization", "CubeVertex", "CubeFragment", true, false);
    ShardProgram_      = Raster("ParticleRasterization", "ShardVertex", "CubeFragment", true, false);
    ButterflyProgram_  = Raster("ParticleRasterization", "ButterflyVertex", "ButterflyFragment", true, false);
    LightningProgram_  = Raster("ParticleRasterization", "LightningVertex", "LightningFragment", true, true);
    ArrowProgram_      = Raster("ParticleRasterization", "WindArrowVertex", "WindArrowFragment", true, true);
    FibreProgram_      = Raster("LightFibreRasterization", "FibreVertex", "FibreFragment", true, true);
    FibreSparkProgram_ = Raster("LightFibreRasterization", "FibreSparkVertex", "FibreSparkFragment", true, true);
    FloorProgram_      = Raster("ParticleRasterization", "FloorVertex", "FloorFragment", false, false, true);
    GuideProgram_      = Raster("ParticleRasterization", "GuideVertex", "GuideFragment", true, false, false, VK_PRIMITIVE_TOPOLOGY_LINE_LIST,
                                { { static_cast<uint32_t>(GuideBytes), false, { { 0, 0, VertexFormat::Float32x3 }, { 1, 12, VertexFormat::Float32x4 } } } });

    RasterProgramSpecification Lensing;
    Lensing.Label             = "Particle lensing";
    Lensing.VertexSpirvPath   = Spirv("LensingRasterization", "LensingVertex");
    Lensing.VertexEntry       = "LensingVertex";
    Lensing.FragmentSpirvPath = Spirv("LensingRasterization", "LensingFragment");
    Lensing.FragmentEntry     = "LensingFragment";
    Lensing.Targets           = { ResolveTarget(false, false) };
    Lensing.Layouts           = { LensingLayout_ };
    LensingProgram_           = Exchange_->ConstructRasterProgram(Lensing, Diagnostic);
    return ParticleAdditive_ && ParticleAlphaOver_ && CubeProgram_ && ShardProgram_ && ButterflyProgram_ && LightningProgram_ && ArrowProgram_
        && FibreProgram_ && FibreSparkProgram_ && FloorProgram_ && GuideProgram_ && LensingProgram_;
}

bool ParticleSimulationSequence::ConstructTargets(uint32_t Width, uint32_t Height)
{
    if (Extent_[0] == Width && Extent_[1] == Height && Colour_)
    {
        return true;
    }
    // 📝 The host may still sample the previous image: let the queue drain before replacing it.
    Exchange_->AwaitIdle();
    TextureSpecification Image;
    Image.Width  = Width;
    Image.Height = Height;
    Image.Format = TextureFormat::Rgba8Unorm;
    Image.Usage  = TextureUsage::RenderAttachment | TextureUsage::Sampled | TextureUsage::CopySource;
    Image.Label  = "Particle raster";
    Colour_      = Exchange_->ConstructTexture(Image);
    Image.Label  = "Particle image";
    Lensed_      = Exchange_->ConstructTexture(Image);
    TextureSpecification DepthImage;
    DepthImage.Label  = "Particle depth";
    DepthImage.Width  = Width;
    DepthImage.Height = Height;
    DepthImage.Format = TextureFormat::Depth32Float;
    DepthImage.Usage  = TextureUsage::RenderAttachment;
    Depth_            = Exchange_->ConstructTexture(DepthImage);
    if (!Colour_ || !Lensed_ || !Depth_)
    {
        return false;
    }
    ColourView_   = Exchange_->ConstructView(Colour_);
    LensedView_   = Exchange_->ConstructView(Lensed_);
    DepthView_    = Exchange_->ConstructView(Depth_);
    LensingGroup_ = Exchange_->ConstructDescriptorGroup(LensingLayout_, { LensingConstants_, ColourView_, LensingSampler_ }, "Particle lensing");
    Extent_       = { Width, Height };
    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    REFRESH
//------------------------------------------------------------------------------------------------------------------------

bool ParticleSimulationSequence::Refresh(const ParticleRefreshPlan& Plan, std::span<const ParticleEffectInstance> Effects, std::string* Diagnostic,
                                          const IFieldSampler* SharedFieldSampler)
{
    if (Plan.SharedFieldActive && SharedFieldSampler == nullptr)
    {
        if (Diagnostic) *Diagnostic = "the particle plan follows the level ForceField, but no shared IFieldSampler was supplied";
        return false;
    }
    const auto Started = std::chrono::steady_clock::now();
    if (!Exchange_ || !ConstructTargets(Plan.ViewWidth, Plan.ViewHeight))
    {
        if (Diagnostic) *Diagnostic = "the particle image could not be allocated";
        return false;
    }

    // ① stores: one set per effect; an effect gone from the space releases its own
    for (auto& Stores : Stores_) Stores->Seen = false;
    std::vector<EffectStores*> JobStores(Plan.Jobs.size(), nullptr);
    for (size_t Index = 0; Index < Plan.Jobs.size(); ++Index)
    {
        EffectStores& Stores = ResolveStores(Effects[Plan.Jobs[Index].EffectIndex]);
        JobStores[Index]     = &Stores;
    }
    for (const ParticleEffectInstance& Effect : Effects)
    {
        for (auto& Stores : Stores_)
        {
            if (Stores->Token == Effect.Token) Stores->Seen = true;
        }
    }
    if (std::any_of(Stores_.begin(), Stores_.end(), [](const auto& Stores) { return !Stores->Seen; }))
    {
        Exchange_->AwaitIdle();
        std::erase_if(Stores_, [](const std::unique_ptr<EffectStores>& Stores) { return !Stores->Seen; });
    }

    // ② queue writes (eos render: glob, comps, segments, fields, lines, then each job's uniform)
    Exchange_->WriteRegion(RefreshConstants_, 0, Plan.Constants.data(), sizeof(float) * Plan.Constants.size());
    Exchange_->WriteRegion(Components_, 0, Plan.Components.data(), sizeof(float) * Plan.Components.size());
    if (Plan.SegmentCount) Exchange_->WriteRegion(Segments_, 0, Plan.Segments.data(), sizeof(float) * 8u * Plan.SegmentCount);
    Exchange_->WriteRegion(Fields_, 0, Plan.Fields.data(), sizeof(float) * Plan.Fields.size());
    const uint32_t GuideCount = static_cast<uint32_t>(std::min<size_t>(Plan.Guides.size() / 7u, GuideVertexLimit));
    if (GuideCount) Exchange_->WriteRegion(Guides_, 0, Plan.Guides.data(), sizeof(float) * 7u * GuideCount);
    for (size_t Index = 0; Index < Plan.Jobs.size(); ++Index)
    {
        const ParticleRefreshJob& Job    = Plan.Jobs[Index];
        EffectStores&             Stores = *JobStores[Index];
        if (Job.Rasterize) Exchange_->WriteRegion(Stores.Uniform, 0, Job.Uniform.data(), sizeof(float) * Job.Uniform.size());
        if (Job.LightFibre && Stores.FibreUniform)
        {
            Exchange_->WriteRegion(Stores.FibreUniform, 0, Job.FibreUniform.data(), sizeof(float) * Job.FibreUniform.size());
            if (!Job.FibrePath.empty()) Exchange_->WriteRegion(Stores.FibrePath, 0, Job.FibrePath.data(), sizeof(float) * Job.FibrePath.size());
        }
    }
    // 📝 With no lens and no shimmer the lensing program copies the image unchanged.
    Exchange_->WriteRegion(LensingConstants_, 0, Plan.Lensing.data(), sizeof(float) * Plan.Lensing.size());

    const bool UseSharedField = Plan.SharedFieldActive && SharedFieldSampler != nullptr;
    if (UseSharedField)
    {
        const std::vector<float> Flow = SampleParticleWindLattice(*SharedFieldSampler, Plan.SharedFieldOriginMetres, true);
        std::vector<uint16_t> Packed(Flow.size());
        std::transform(Flow.begin(), Flow.end(), Packed.begin(), EncodeHalf);
        Exchange_->WriteTexture(WindTexture_, 0, Packed.data(), Packed.size() * sizeof(uint16_t),
                                ParticleDomainDimensions[0], ParticleDomainDimensions[1], ParticleDomainDimensions[2]);
    }

    CommandSequence Sequence = Exchange_->BeginSequence();

    // ③ the wind lattice: either the ForceField sampler baked over all 6,912 cells or Particle's standalone local wind builder.
    if (!UseSharedField)
    {
        Sequence.BindProgram(WindProgram_);
        Sequence.BindGroup(0, WindGroup_);
        Sequence.Dispatch(ParticleDomainDimensions[0] / 4u, ParticleDomainDimensions[1] / 4u, ParticleDomainDimensions[2] / 4u);
    }

    // ④ the effects
    const auto Dispatch = [&](const std::shared_ptr<DeviceProgram>& Program, const EffectStores& Stores, uint32_t Count)
    {
        Sequence.BindProgram(Program);
        Sequence.BindGroup(0, RefreshGroup_);
        Sequence.BindGroup(1, Stores.SimulationGroup);
        Sequence.Dispatch(Count);
    };
    for (size_t Index = 0; Index < Plan.Jobs.size(); ++Index)
    {
        const ParticleRefreshJob& Job = Plan.Jobs[Index];
        if (!Job.Simulate) continue;
        EffectStores&  Stores   = *JobStores[Index];
        const uint32_t Capacity = Stores.Capacity;
        if (Job.Molecular)
        {
            if (Job.Release > 0) Dispatch(ReleaseProgram_, Stores, Groups(Job.Release));
            const uint32_t Cells = Job.GridDimension * Job.GridDimension * Job.GridDimension;
            for (uint32_t Step = 0; Step < Job.Steps; ++Step)
            {
                Dispatch(ClearCellsProgram_, Stores, Groups(Cells));
                Dispatch(InsertCellsProgram_, Stores, Groups(Capacity));
                // 📝 The snapshot: every lane reads one consistent previous refresh.
                Sequence.CopyRegion(Stores.Particles, 0, Stores.Snapshot, 0, Capacity * ParticleBytes);
                Dispatch(MoleculesProgram_, Stores, Groups(Capacity));
            }
        }
        else
        {
            if (Job.Release > 0) Dispatch(ReleaseProgram_, Stores, Groups(Job.Release));
            if (Job.Swarm)
            {
                // 📝 Swarms read their neighbours from a snapshot taken after the release (race-free).
                Sequence.CopyRegion(Stores.Particles, 0, Stores.Snapshot, 0, Capacity * ParticleBytes);
            }
            Dispatch(Job.Swarm ? SwarmProgram_ : AdvanceProgram_, Stores, Groups(Capacity));
        }
        // 📝 The census: alive, species and kinetic energy.
        Dispatch(ClearCensusProgram_, Stores, 1u);
        Dispatch(GatherCensusProgram_, Stores, Groups(Capacity));
    }

    // ⑤ the raster (eos render pass order: floor, guides, arrows, fibres, particles, lightning)
    const ColorAttachment Clear{ ColourView_, LoadOperation::Clear,
                                 Plan.TransparentBackground ? std::array<float, 4>{0.0f, 0.0f, 0.0f, 0.0f}
                                                           : std::array<float, 4>{Plan.Clear[0], Plan.Clear[1], Plan.Clear[2], 1.0f} };
    const DepthAttachment Depth{ DepthView_, LoadOperation::Clear, 1.0f };
    Sequence.BeginRaster(std::span<const ColorAttachment>(&Clear, 1), &Depth, "Particle raster");
    const auto Bind = [&](const std::shared_ptr<DeviceProgram>& Program, const std::shared_ptr<DescriptorGroup>& Group)
    {
        Sequence.BindProgram(Program);
        Sequence.BindGroup(0, RefreshGroup_);
        Sequence.BindGroup(1, Group);
    };
    if (Plan.Floor)
    {
        Bind(FloorProgram_, VacantGroup_);
        Sequence.Draw(6);
    }
    if (GuideCount)
    {
        Bind(GuideProgram_, VacantGroup_);
        Sequence.BindVertexRegion(0, Guides_);
        Sequence.Draw(GuideCount);
    }
    if (Plan.Arrows)
    {
        Bind(ArrowProgram_, VacantGroup_);
        Sequence.Draw(6, WindCells);
    }
    for (size_t Index = 0; Index < Plan.Jobs.size(); ++Index)
    {
        const ParticleRefreshJob& Job = Plan.Jobs[Index];
        if (!Job.LightFibre || !JobStores[Index]->FibreGroup) continue;
        Bind(FibreProgram_, JobStores[Index]->FibreGroup);
        Sequence.Draw(Job.Strands * Job.Segments * 6u);
        if (Job.Sparks)
        {
            Bind(FibreSparkProgram_, JobStores[Index]->FibreGroup);
            Sequence.Draw(Job.Strands * 6u);
        }
    }
    for (size_t Index = 0; Index < Plan.Jobs.size(); ++Index)
    {
        const ParticleRefreshJob& Job = Plan.Jobs[Index];
        if (!Job.Rasterize) continue;
        const EffectStores& Stores = *JobStores[Index];
        if (Job.Cube)
        {
            Bind(CubeProgram_, Stores.RasterGroup);
            Sequence.Draw(36, Stores.Capacity);
        }
        else
        {
            Bind(Job.AlphaOver ? ParticleAlphaOver_ : ParticleAdditive_, Stores.RasterGroup);
            Sequence.Draw(6, Stores.Capacity);
        }
        if (Job.Shards)
        {
            // 📝 Eight shards (2 × 2 × 2) per cube, 36 vertices each.
            Bind(ShardProgram_, Stores.RasterGroup);
            Sequence.Draw(288, Stores.Capacity);
        }
        if (Job.Butterflies)
        {
            Bind(ButterflyProgram_, Stores.RasterGroup);
            Sequence.Draw(6, Stores.Capacity);
        }
    }
    if (Plan.SegmentCount)
    {
        Bind(LightningProgram_, VacantGroup_);
        Sequence.Draw(6, Plan.SegmentCount);
    }
    Sequence.EndRaster();

    // ⑥ lensing into the presented image
    const ColorAttachment Presented{ LensedView_, LoadOperation::Clear,
                                      { 0.0f, 0.0f, 0.0f, Plan.TransparentBackground ? 0.0f : 1.0f } };
    Sequence.BeginRaster(std::span<const ColorAttachment>(&Presented, 1), nullptr, "Particle lensing");
    Sequence.BindProgram(LensingProgram_);
    Sequence.BindGroup(0, LensingGroup_);
    Sequence.Draw(3);
    Sequence.EndRaster();

    if (!Exchange_->Submit(Sequence, Diagnostic)) return false;

    // ⑦ readbacks: the census of the jobs that asked for it, the probe cell
    for (size_t Index = 0; Index < Plan.Jobs.size(); ++Index)
    {
        if (!Plan.Jobs[Index].ReadCensus) continue;
        EffectStores&        Stores = *JobStores[Index];
        std::vector<uint8_t> Bytes;
        if (Exchange_->ReadRegion(Stores.Census, 0, 32, Bytes) && Bytes.size() >= 32)
        {
            uint32_t Counts[8];
            std::memcpy(Counts, Bytes.data(), sizeof(Counts));
            Stores.Reading = { Counts[0], Counts[1], Counts[2], Counts[3], Counts[4] / 1000.0, true };
        }
    }
    if (Plan.ProbeCell)
    {
        std::vector<uint8_t> Bytes;
        if (Exchange_->ReadTexture(WindTexture_, 0, 0, Bytes) && Bytes.size() >= WindCells * 8u)
        {
            const auto&    Cell   = *Plan.ProbeCell;
            const uint32_t Texel  = Cell[0] + ParticleDomainDimensions[0] * (Cell[1] + ParticleDomainDimensions[1] * Cell[2]);
            uint16_t       Halves[4];
            std::memcpy(Halves, Bytes.data() + static_cast<size_t>(Texel) * 8u, sizeof(Halves));
            Probe_ = { Cell, { DecodeHalf(Halves[0]), DecodeHalf(Halves[1]), DecodeHalf(Halves[2]) }, DecodeHalf(Halves[3]), true };
        }
    }
    const double Milliseconds = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - Started).count();
    RefreshMilliseconds_      = RefreshMilliseconds_ <= 0.0 ? Milliseconds : RefreshMilliseconds_ * 0.9 + Milliseconds * 0.1;
    return true;
}

bool ParticleSimulationSequence::ReadPresentedImage(std::vector<uint8_t>& Rgba, std::string* Diagnostic)
{
    if (!Lensed_ || !Exchange_->ReadTexture(Lensed_, 0, 0, Rgba))
    {
        if (Diagnostic) *Diagnostic = "the particle image could not be read back";
        return false;
    }
    return true;
}

bool ParticleSimulationSequence::ReadWindLattice(std::vector<float>& Cells, std::string* Diagnostic)
{
    std::vector<uint8_t> Bytes;
    if (!WindTexture_ || !Exchange_->ReadTexture(WindTexture_, 0, 0, Bytes) || Bytes.size() < WindCells * 8u)
    {
        if (Diagnostic) *Diagnostic = "the wind lattice could not be read back";
        return false;
    }
    Cells.resize(static_cast<size_t>(WindCells) * 4u);
    for (size_t Index = 0; Index < Cells.size(); ++Index)
    {
        uint16_t Half;
        std::memcpy(&Half, Bytes.data() + Index * 2u, sizeof(Half));
        Cells[Index] = DecodeHalf(Half);
    }
    return true;
}

} // namespace Frontier::ParticleSimulation
