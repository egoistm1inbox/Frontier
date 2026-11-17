/*==========================================================================================================================================
                                                        REPLICATIONPROFILE.H
==========================================================================================================================================*/
// 🧩 Shared opt-in network replication profile across Particle, ForceField, Fluid, Physics, VisualEffects, and World domains.

#pragma once

#include <algorithm>
#include <cstdint>

namespace Frontier
{

enum class ReplicationAuthority : uint8_t
{
    Disabled          = 0,
    HostAuthoritative = 1,
    InterpolatedProxy = 2,
    OwnerCommand      = 3,
};

enum class ReplicationChannel : uint8_t
{
    State     = 0,
    Transform = 1,
    Impulse   = 2,
    Stream    = 3,
};

struct ReplicationProfile
{
    bool                 Enabled                = false;
    ReplicationAuthority Authority              = ReplicationAuthority::HostAuthoritative;
    ReplicationChannel   Channel                = ReplicationChannel::Transform;
    float                UpdateFrequencyHz      = 20.0f;
    uint64_t             OwnerPeerIdentifier    = 0;
    bool                 ReplicateSpatial       = true;
    bool                 ReplicateKinematics    = true;
    bool                 ReplicateParameters    = true;
    bool                 InterpolateProxy       = true;
    uint64_t             LastPublishedRevision  = 0;
    double               PublishAccumulatorSec  = 0.0;

    [[nodiscard]] bool IsActive() const noexcept
    {
        return Enabled && Authority != ReplicationAuthority::Disabled;
    }

    [[nodiscard]] bool ShouldPublishUpdate(uint64_t CurrentRevision, double DeltaSeconds) noexcept
    {
        if (!IsActive())
        {
            return false;
        }
        const double Interval = 1.0 / static_cast<double>(std::max(1.0f, UpdateFrequencyHz));
        PublishAccumulatorSec += std::max(0.0, DeltaSeconds);
        if (CurrentRevision != LastPublishedRevision && PublishAccumulatorSec >= Interval)
        {
            PublishAccumulatorSec -= Interval;
            if (PublishAccumulatorSec > Interval)
            {
                PublishAccumulatorSec = 0.0;
            }
            LastPublishedRevision = CurrentRevision;
            return true;
        }
        return false;
    }

    void AcknowledgeRevision(uint64_t Revision) noexcept
    {
        LastPublishedRevision = Revision;
        PublishAccumulatorSec = 0.0;
    }
};

} // namespace Frontier
