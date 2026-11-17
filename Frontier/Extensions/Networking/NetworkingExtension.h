/*==========================================================================================================================================
                                                           NETWORKINGEXTENSION.H
==========================================================================================================================================*/
// 🧩 The bridge between a level and its peers: the host replicates WorldSpace records and ReplicationProfile-enabled domains
//    through an INetworkTransport (LoopbackTransport, EosRelayAdapter, or PhotonRelayAdapter), and clients absorb them.

#pragma once

#include "Frontier/Extensions/Networking/NetworkTransport.h"
#include "Frontier/Extensions/Networking/NetworkingSpace.h"
#include "Frontier/Extensions/Networking/ReplicationExchange.h"

#include "Frontier/Engine/Scene/RecordToken.h"

#include <cstdint>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace Frontier
{

class WorldSpace;

class NetworkingExtension
{
  public:
    NetworkingExtension(NetworkingSpace& Space, INetworkTransport& Transport) noexcept
        : Space(Space), Transport(Transport)
    {
    }

    // 📝 Introduces the local peer to the others (name and role).
    void Greet();

    // 📝 Host: every record whose level TOML changed since the last call leaves as one RecordConfiguration message; records gone from
    //    the level leave as RecordRemoval. Returns the messages posted.
    size_t Replicate(const WorldSpace& World);

    // 📝 Selective ReplicationProfile-driven replication pass (only records carrying an active replication subtable, throttled
    //    to SnapshotIntervalSec via ReplicationProfile frequency checks or fallback cadence).
    size_t ReplicateFiltered(const WorldSpace& World, double DeltaSeconds);

    // 📝 Moves posted messages to the transport and received ones into the space.
    void Exchange();

    // 📝 Client: applies the received messages. A host record is matched to the local record of the same type and name (both
    //    sides opened the same level) or constructed. Returns the messages applied.
    size_t Absorb(WorldSpace& World);

    [[nodiscard]] size_t QueryMatchedRecords() const noexcept { return Matched.size(); }

  private:
    NetworkingSpace&                          Space;
    INetworkTransport&                        Transport;
    std::unordered_map<uint64_t, std::string> Sent;       // host record token -> last payload sent
    std::unordered_map<uint64_t, RecordToken> Matched;    // host record token -> local record
    double                                    FilterTimerSec_ = 0.0;
};

} // namespace Frontier
