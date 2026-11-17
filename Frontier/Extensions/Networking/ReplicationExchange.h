/*==========================================================================================================================================
                                                         REPLICATIONEXCHANGE.H
==========================================================================================================================================*/
// 🧩 Generic ReplicationProfile + SpaceSchema driven DomainReplicator<SpaceT>, transform interpolation proxy, and .networkspace codec.

#pragma once

#include "Frontier/Engine/Foundation/Math.h"
#include "Frontier/Engine/Scene/Profiles/ReplicationProfile.h"
#include "Frontier/Engine/Scene/Profiles/SpatialProfile.h"
#include "Frontier/Engine/Scene/SpaceCodec.h"
#include "Frontier/Extensions/Networking/NetworkTransport.h"
#include "Frontier/Extensions/Networking/NetworkingSpace.h"

#include <algorithm>
#include <concepts>
#include <cstdint>
#include <filesystem>
#include <sstream>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace Frontier
{

inline constexpr std::string_view NetworkSpaceExtension = ".networkspace";
inline constexpr std::string_view NetworkSpaceFormat    = "frontier.networkspace";
inline constexpr int64_t          NetworkSpaceVersion   = 1;

//------------------------------------------------------------------------------------------------------------------------
//                                              .NETWORKSPACE CONFIGURATION & CODEC
//------------------------------------------------------------------------------------------------------------------------

struct NetworkSpaceConfiguration
{
    std::string SessionName             = "FrontierSession";
    std::string LocalPeerName           = "Host";
    std::string Role                    = "host";          // "host" | "client"
    std::string TransportMode           = "auto";          // "auto" | "loopback" | "eos" | "photon"
    std::string BucketId                = "frontier-dev";
    std::string MapName                 = "ProvingGround";
    std::string ModeName                = "sandbox";
    double      TickRateHz              = 60.0;
    double      SnapshotRateHz          = 20.0;
    double      InterpolationDelaySec   = 0.1;
    int64_t     MaxChunkBytes           = static_cast<int64_t>(DefaultMaxPacketBytes);
    bool        ReplicateWorld          = true;
    bool        ReplicatePhysics        = true;
    bool        ReplicateParticles      = true;
    bool        ReplicateForceFields    = true;
    bool        ReplicateFluids         = true;
    bool        ReplicateEffects        = true;
};

template <>
struct SpaceSchema<NetworkSpaceConfiguration>
{
    static constexpr auto Bindings() noexcept
    {
        using Cfg = NetworkSpaceConfiguration;
        return std::make_tuple(
            MakeFieldBinding("session_name", &Cfg::SessionName),
            MakeFieldBinding("local_peer_name", &Cfg::LocalPeerName),
            MakeFieldBinding("role", &Cfg::Role),
            MakeFieldBinding("transport_mode", &Cfg::TransportMode),
            MakeFieldBinding("bucket_id", &Cfg::BucketId),
            MakeFieldBinding("map_name", &Cfg::MapName),
            MakeFieldBinding("mode_name", &Cfg::ModeName),
            MakeClampedField("tick_rate_hz", &Cfg::TickRateHz, 1.0, 240.0),
            MakeClampedField("snapshot_rate_hz", &Cfg::SnapshotRateHz, 1.0, 120.0),
            MakeClampedField("interpolation_delay_s", &Cfg::InterpolationDelaySec, 0.0, 2.0),
            MakeClampedField("max_chunk_bytes", &Cfg::MaxChunkBytes, 128.0, 65536.0),
            MakeFieldBinding("replicate_world", &Cfg::ReplicateWorld),
            MakeFieldBinding("replicate_physics", &Cfg::ReplicatePhysics),
            MakeFieldBinding("replicate_particles", &Cfg::ReplicateParticles),
            MakeFieldBinding("replicate_force_fields", &Cfg::ReplicateForceFields),
            MakeFieldBinding("replicate_fluids", &Cfg::ReplicateFluids),
            MakeFieldBinding("replicate_effects", &Cfg::ReplicateEffects));
    }
};

inline bool WriteNetworkSpace(const NetworkSpaceConfiguration& Configuration,
                              const std::filesystem::path&     FilePath,
                              std::string*                     OutDiagnostic = nullptr)
{
    return EncodeSpaceFile(FilePath,
                           NetworkSpaceExtension,
                           NetworkSpaceFormat,
                           NetworkSpaceVersion,
                           Configuration,
                           OutDiagnostic);
}

inline bool ReadNetworkSpace(const std::filesystem::path& FilePath,
                             NetworkSpaceConfiguration&   OutConfiguration,
                             std::string*                 OutDiagnostic = nullptr)
{
    return DecodeSpaceFile(FilePath,
                           NetworkSpaceExtension,
                           NetworkSpaceFormat,
                           NetworkSpaceVersion,
                           OutConfiguration,
                           OutDiagnostic);
}

//------------------------------------------------------------------------------------------------------------------------
//                                              SPATIAL INTERPOLATION PROXY
//------------------------------------------------------------------------------------------------------------------------

struct SpatialInterpolationBuffer
{
    SpatialProfile Previous{};
    SpatialProfile Target{};
    double         ElapsedSinceSnapshot = 0.0;
    double         ExpectedIntervalSec  = 0.05;
    bool           Initialized          = false;

    void PushTarget(const SpatialProfile& NextTarget, double IntervalSec = 0.05) noexcept
    {
        if (!Initialized)
        {
            Previous    = NextTarget;
            Target      = NextTarget;
            Initialized = true;
        }
        else
        {
            Previous = Evaluate();
            Target   = NextTarget;
        }
        ElapsedSinceSnapshot = 0.0;
        ExpectedIntervalSec  = std::max(1.0e-3, IntervalSec);
    }

    void Advance(double DeltaSeconds) noexcept
    {
        ElapsedSinceSnapshot += std::max(0.0, DeltaSeconds);
    }

    [[nodiscard]] SpatialProfile Evaluate() const noexcept
    {
        if (!Initialized)
        {
            return {};
        }
        const double Alpha = std::clamp(ElapsedSinceSnapshot / ExpectedIntervalSec, 0.0, 1.0);
        SpatialProfile Blended;
        Blended.PositionMetres = Lerp(Previous.PositionMetres, Target.PositionMetres, Alpha);
        Blended.Scale          = Lerp(Previous.Scale, Target.Scale, Alpha);
        const Quatd Q0         = Previous.RotationQuaternion();
        const Quatd Q1         = Target.RotationQuaternion();
        Blended.OrientationDegrees = Quatd::Slerp(Q0, Q1, Alpha).ToEulerDegreesZYX();
        Blended.Revision       = Target.Revision;
        return Blended;
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                        TEMPLATED GENERIC DOMAIN REPLICATOR<SPACET>
//------------------------------------------------------------------------------------------------------------------------

template <typename DomainT>
concept ReplicableDomainConcept = requires(const DomainT& ConstDom, DomainT& MutDom, toml::table& Out,
                                           const toml::table& In) {
    { ConstDom.QueryDomainIdentifier() } -> std::convertible_to<std::string_view>;
    { ConstDom.QueryDomainRevision() } -> std::convertible_to<uint64_t>;
    { MutDom.AccessReplicationProfile() } -> std::same_as<ReplicationProfile&>;
    { ConstDom.QueryReplicationProfile() } -> std::same_as<const ReplicationProfile&>;
    ConstDom.SerializeDomainState(Out);
    MutDom.DeserializeDomainState(In);
};

template <ReplicableDomainConcept DomainT>
class DomainReplicator
{
  public:
    DomainReplicator(NetworkingSpace& Space, INetworkTransport& Transport) noexcept
        : Space_(Space), Transport_(Transport)
    {
    }

    // 📝 Inspects ReplicationProfile frequency/revision gates on each registered domain entry and posts dirty state.
    size_t ReplicateDomain(DomainT& Domain, double DeltaSeconds)
    {
        ReplicationProfile& Profile = Domain.AccessReplicationProfile();
        const uint64_t      Rev     = Domain.QueryDomainRevision();
        if (!Profile.ShouldPublishUpdate(Rev, DeltaSeconds))
        {
            return 0;
        }
        toml::table State;
        Domain.SerializeDomainState(State);
        std::ostringstream Stream;
        Stream << toml::table{
            { "domain", std::string(Domain.QueryDomainIdentifier()) },
            { "revision", static_cast<int64_t>(Rev) },
            { "channel", static_cast<int64_t>(Profile.Channel) },
            { "state", std::move(State) },
        };
        std::string       Payload = Stream.str();
        const std::string Key     = std::string(Domain.QueryDomainIdentifier());
        if (LastPayloads_[Key] == Payload)
        {
            return 0;
        }
        LastPayloads_[Key] = Payload;
        Space_.Post(NetworkTopic::RecordConfiguration, std::move(Payload));
        return 1;
    }

    void Exchange()
    {
        for (const NetworkMessage& Message : Space_.TakeOutgoing())
        {
            (void)Transport_.Send(Message);
        }
        for (NetworkMessage& Message : Transport_.Receive())
        {
            Space_.Deliver(std::move(Message));
        }
    }

    // 📝 Applies matching incoming domain updates and returns count applied; leaves unrelated messages out for peers.
    template <typename DomainResolverFn>
    size_t AbsorbDomains(DomainResolverFn&& ResolveDomain)
    {
        size_t                      Applied = 0;
        std::vector<NetworkMessage> Remainder;
        for (NetworkMessage& Message : Space_.TakeIncoming())
        {
            if (Message.Topic != NetworkTopic::RecordConfiguration)
            {
                Remainder.push_back(std::move(Message));
                continue;
            }
            toml::table Document;
            try
            {
                Document = toml::parse(Message.Payload);
            }
            catch (const toml::parse_error&)
            {
                Remainder.push_back(std::move(Message));
                continue;
            }
            const auto         DomainId = Document["domain"].value<std::string>();
            const toml::table* State    = Document["state"].as_table();
            if (!DomainId || State == nullptr)
            {
                Remainder.push_back(std::move(Message));
                continue;
            }
            if (DomainT* Target = ResolveDomain(*DomainId))
            {
                Target->DeserializeDomainState(*State);
                Target->AccessReplicationProfile().AcknowledgeRevision(
                    static_cast<uint64_t>(Document["revision"].value<int64_t>().value_or(0)));
                ++Applied;
            }
            else
            {
                Remainder.push_back(std::move(Message));
            }
        }
        for (NetworkMessage& Left : Remainder)
        {
            Space_.Deliver(std::move(Left));
        }
        return Applied;
    }

  private:
    NetworkingSpace&                             Space_;
    INetworkTransport&                           Transport_;
    std::unordered_map<std::string, std::string> LastPayloads_;
};

// 📝 Adapter wrapper exposing any HasSpaceSchema POD/struct + ReplicationProfile directly to DomainReplicator<SchemaDomainAdapter<T>>.
template <HasSpaceSchema T>
struct SchemaDomainAdapter
{
    std::string        Identifier;
    T&                 Data;
    ReplicationProfile& Replication;
    uint64_t           Revision = 1;

    [[nodiscard]] std::string_view          QueryDomainIdentifier() const noexcept { return Identifier; }
    [[nodiscard]] uint64_t                  QueryDomainRevision() const noexcept { return Revision; }
    [[nodiscard]] ReplicationProfile&       AccessReplicationProfile() noexcept { return Replication; }
    [[nodiscard]] const ReplicationProfile& QueryReplicationProfile() const noexcept { return Replication; }

    void SerializeDomainState(toml::table& Out) const { EncodeSpaceTable(Out, Data); }
    void DeserializeDomainState(const toml::table& In)
    {
        DecodeSpaceTable(In, Data);
        ++Revision;
    }
};

} // namespace Frontier
