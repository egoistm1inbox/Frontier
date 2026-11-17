/*==========================================================================================================================================
                                                            NETWORKINGSPACE.CPP
==========================================================================================================================================*/
// 🧩 The session's peers and message queues.

#include "Frontier/Extensions/Networking/NetworkingSpace.h"

#include <algorithm>

namespace Frontier
{

uint32_t NetworkingSpace::ConfigureLocalPeer(std::string Name, NetworkRole Role)
{
    LocalIdentifier = AdmitPeer(std::move(Name), Role);
    return LocalIdentifier;
}

uint32_t NetworkingSpace::AdmitPeer(std::string Name, NetworkRole Role)
{
    NetworkPeer Peer;
    Peer.Identifier = NextIdentifier++;
    Peer.Name       = std::move(Name);
    Peer.Role       = Role;
    Peers.push_back(std::move(Peer));
    return Peers.back().Identifier;
}

void NetworkingSpace::DismissPeer(uint32_t Identifier)
{
    for (NetworkPeer& Peer : Peers)
        if (Peer.Identifier == Identifier) Peer.Connected = false;
}

const NetworkPeer* NetworkingSpace::QueryLocalPeer() const noexcept
{
    const auto Found = std::find_if(Peers.begin(), Peers.end(), [&](const NetworkPeer& Peer) { return Peer.Identifier == LocalIdentifier; });
    return Found == Peers.end() ? nullptr : &*Found;
}

bool NetworkingSpace::QueryHosting() const noexcept
{
    const NetworkPeer* Local = QueryLocalPeer();
    return Local != nullptr && Local->Role == NetworkRole::Host;
}

void NetworkingSpace::Post(NetworkTopic Topic, std::string Payload, uint32_t To)
{
    NetworkMessage Message;
    Message.From     = LocalIdentifier;
    Message.To       = To;
    Message.Topic    = Topic;
    Message.Sequence = NextSequence++;
    Message.Payload  = std::move(Payload);
    ++Tally.MessagesSent;
    Tally.BytesSent += Message.Payload.size();
    Outgoing.push_back(std::move(Message));
}

std::vector<NetworkMessage> NetworkingSpace::TakeOutgoing()
{
    std::vector<NetworkMessage> Taken;
    Taken.swap(Outgoing);
    return Taken;
}

void NetworkingSpace::Deliver(NetworkMessage Message)
{
    if (Message.To != 0 && Message.To != LocalIdentifier) return;
    ++Tally.MessagesReceived;
    Tally.BytesReceived += Message.Payload.size();
    Incoming.push_back(std::move(Message));
}

std::vector<NetworkMessage> NetworkingSpace::TakeIncoming()
{
    std::vector<NetworkMessage> Taken;
    Taken.swap(Incoming);
    return Taken;
}

} // namespace Frontier
