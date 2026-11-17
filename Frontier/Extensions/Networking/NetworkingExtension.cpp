/*==========================================================================================================================================
                                                          NETWORKINGEXTENSION.CPP
==========================================================================================================================================*/
// 🧩 Replication of WorldSpace records (full diff and ReplicationProfile-filtered selective diff) over INetworkTransport.

#include "Frontier/Extensions/Networking/NetworkingExtension.h"

#include "Frontier/Engine/Scene/WorldSpace.h"

#include <toml++/toml.hpp>

#include <algorithm>
#include <sstream>
#include <unordered_set>

namespace Frontier
{

namespace
{

std::string PrintTable(const toml::table& Table)
{
    std::ostringstream Out;
    Out << Table;
    return Out.str();
}

} // namespace

void NetworkingExtension::Greet()
{
    const NetworkPeer* Local = Space.QueryLocalPeer();
    if (Local == nullptr)
    {
        return;
    }
    Space.Post(NetworkTopic::Greeting,
               PrintTable(toml::table{ { "name", Local->Name },
                                       { "role", Local->Role == NetworkRole::Host ? "host" : "client" } }));
}

size_t NetworkingExtension::Replicate(const WorldSpace& World)
{
    size_t                       Posted = 0;
    std::unordered_set<uint64_t> Present;
    for (const auto& [Type, Category] : World.EnumerateRegisteredTypes())
    {
        (void)Category;
        for (const SceneRecordBase* Record : World.FindAllByType(Type))
        {
            const uint64_t Token = Record->QueryToken().Value;
            Present.insert(Token);
            toml::table Configuration;
            Record->SerializeConfiguration(Configuration);
            std::string Payload = PrintTable(toml::table{ { "token", static_cast<int64_t>(Token) },
                                                          { "type", Record->QueryTypeIdentifier() },
                                                          { "name", Record->QueryRecordName() },
                                                          { "configuration", std::move(Configuration) } });
            std::string& Last = Sent[Token];
            if (Last == Payload)
            {
                continue;
            }
            Last = Payload;
            Space.Post(NetworkTopic::RecordConfiguration, std::move(Payload));
            ++Posted;
        }
    }
    for (auto Entry = Sent.begin(); Entry != Sent.end();)
    {
        if (Present.count(Entry->first) == 0)
        {
            Space.Post(NetworkTopic::RecordRemoval, PrintTable(toml::table{ { "token", static_cast<int64_t>(Entry->first) } }));
            ++Posted;
            Entry = Sent.erase(Entry);
        }
        else
        {
            ++Entry;
        }
    }
    return Posted;
}

size_t NetworkingExtension::ReplicateFiltered(const WorldSpace& World, double DeltaSeconds)
{
    FilterTimerSec_ += std::max(0.0, DeltaSeconds);
    size_t                       Posted = 0;
    std::unordered_set<uint64_t> Present;
    for (const auto& [Type, Category] : World.EnumerateRegisteredTypes())
    {
        (void)Category;
        for (const SceneRecordBase* Record : World.FindAllByType(Type))
        {
            const uint64_t Token = Record->QueryToken().Value;
            toml::table    Configuration;
            Record->SerializeConfiguration(Configuration);
            const toml::table* Replication = Configuration["replication"].as_table();
            if (Replication == nullptr || !(*Replication)["enabled"].value<bool>().value_or(false))
            {
                continue;
            }
            Present.insert(Token);
            std::string Payload = PrintTable(toml::table{ { "token", static_cast<int64_t>(Token) },
                                                          { "type", Record->QueryTypeIdentifier() },
                                                          { "name", Record->QueryRecordName() },
                                                          { "configuration", std::move(Configuration) } });
            std::string& Last = Sent[Token];
            if (Last == Payload)
            {
                continue;
            }
            Last = Payload;
            Space.Post(NetworkTopic::RecordConfiguration, std::move(Payload));
            ++Posted;
        }
    }
    for (auto Entry = Sent.begin(); Entry != Sent.end();)
    {
        if (Present.count(Entry->first) == 0)
        {
            Space.Post(NetworkTopic::RecordRemoval, PrintTable(toml::table{ { "token", static_cast<int64_t>(Entry->first) } }));
            ++Posted;
            Entry = Sent.erase(Entry);
        }
        else
        {
            ++Entry;
        }
    }
    return Posted;
}

void NetworkingExtension::Exchange()
{
    for (const NetworkMessage& Message : Space.TakeOutgoing())
    {
        (void)Transport.Send(Message);
    }
    for (NetworkMessage& Message : Transport.Receive())
    {
        Space.Deliver(std::move(Message));
    }
}

size_t NetworkingExtension::Absorb(WorldSpace& World)
{
    size_t Applied = 0;
    for (const NetworkMessage& Message : Space.TakeIncoming())
    {
        toml::table Document;
        try
        {
            Document = toml::parse(Message.Payload);
        }
        catch (const toml::parse_error&)
        {
            continue;
        }
        if (Message.Topic == NetworkTopic::Greeting)
        {
            const std::string Name  = Document["name"].value<std::string>().value_or("peer");
            const bool        Known = std::any_of(Space.QueryPeers().begin(), Space.QueryPeers().end(),
                                                  [&](const NetworkPeer& Peer) { return Peer.Name == Name; });
            if (!Known)
            {
                const NetworkRole Role = Document["role"].value<std::string>().value_or("client") == "host"
                                             ? NetworkRole::Host
                                             : NetworkRole::Client;
                (void)Space.AdmitPeer(Name, Role);
            }
            ++Applied;
            continue;
        }
        const uint64_t Token = static_cast<uint64_t>(Document["token"].value<int64_t>().value_or(0));
        if (Message.Topic == NetworkTopic::RecordRemoval)
        {
            if (const auto Found = Matched.find(Token); Found != Matched.end())
            {
                (void)World.DestroyRecord(Found->second);
                Matched.erase(Found);
                ++Applied;
            }
            continue;
        }
        if (Message.Topic != NetworkTopic::RecordConfiguration)
        {
            continue;
        }
        const std::string  Type          = Document["type"].value<std::string>().value_or("");
        const std::string  Name          = Document["name"].value<std::string>().value_or("");
        const toml::table* Configuration = Document["configuration"].as_table();
        if (Type.empty() || Configuration == nullptr)
        {
            continue;
        }
        RecordToken Local{};
        if (const auto Found = Matched.find(Token); Found != Matched.end())
        {
            Local = Found->second;
        }
        if (!Local.IsValid() || World.FindRecord(Local) == nullptr)
        {
            Local = RecordToken{};
            for (const SceneRecordBase* Candidate : World.FindAllByType(Type))
            {
                const bool Taken = std::any_of(Matched.begin(), Matched.end(),
                                               [&](const auto& Entry) { return Entry.second == Candidate->QueryToken(); });
                if (!Taken && Candidate->QueryRecordName() == Name)
                {
                    Local = Candidate->QueryToken();
                    break;
                }
            }
            if (!Local.IsValid())
            {
                Local = World.ConstructRecord(Type, Name);
            }
            if (!Local.IsValid())
            {
                continue;
            }
            Matched[Token] = Local;
        }
        if (SceneRecordBase* Record = World.FindRecord(Local))
        {
            Record->DeserializeConfiguration(*Configuration);
            ++Applied;
        }
    }
    return Applied;
}

} // namespace Frontier
