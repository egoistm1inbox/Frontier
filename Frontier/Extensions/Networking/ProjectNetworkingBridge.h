/*==========================================================================================================================================
                                                        PROJECTNETWORKINGBRIDGE.H
==========================================================================================================================================*/
// 🧩 Header-only contract adapter bridging Project-Networking's PacketCodec / EOS / Photon transport APIs onto INetworkTransport.

#pragma once

#include "Frontier/Extensions/Networking/NetworkTransport.h"
#include "Frontier/Projects/Project-Networking/Source/TransportCodec.h"

#include <cstdint>
#include <vector>

namespace Frontier
{

// 📝 Builds RelayTransportHooks that wrap Frontier network messages inside Project-Networking's FP1 PacketCodec frames
//    (ReplicationKind::Snapshot) before calling Project-Networking's SendFn / PollFn.
template <typename SendPacketCallable, typename PollRawCallable, typename ReadyCallable>
[[nodiscard]] RelayTransportHooks MakeProjectNetworkingRelayHooks(SendPacketCallable&& SendFn,
                                                                  PollRawCallable&&    PollFn,
                                                                  ReadyCallable&&      ReadyFn)
{
    RelayTransportHooks Hooks;
    Hooks.MaxPacketBytes = DefaultMaxPacketBytes;
    Hooks.SendFrame      = [Send = std::forward<SendPacketCallable>(SendFn)](const uint8_t* Data, size_t Length,
                                                                        bool Reliable) -> bool {
        std::vector<uint8_t> Framed;
        if (!Networking::PacketCodec::Encode(Networking::ReplicationKind::Snapshot, Data, Length, Framed))
        {
            return false;
        }
        return Send(Framed.data(), Framed.size(), Reliable);
    };
    Hooks.PollFrames = [Poll = std::forward<PollRawCallable>(PollFn)](std::vector<std::vector<uint8_t>>& OutFrames) {
        std::vector<std::vector<uint8_t>> RawPackets;
        Poll(RawPackets);
        for (const std::vector<uint8_t>& Packet : RawPackets)
        {
            Networking::ReplicationKind Kind          = Networking::ReplicationKind::Probe;
            const uint8_t*              Payload       = nullptr;
            size_t                      PayloadLength = 0;
            if (Networking::PacketCodec::Decode(Packet.data(), Packet.size(), Kind, Payload, PayloadLength) &&
                Kind == Networking::ReplicationKind::Snapshot && Payload != nullptr && PayloadLength > 0)
            {
                OutFrames.emplace_back(Payload, Payload + PayloadLength);
            }
        }
    };
    Hooks.IsReady = std::forward<ReadyCallable>(ReadyFn);
    return Hooks;
}

} // namespace Frontier
