/*==========================================================================================================================================
                                                       NETWORKINGSPACEVALIDATION.CPP
==========================================================================================================================================*/
// 🧩 The networking scaffold end to end in one process: a host level and a client level joined by the loopback transport. The
//    host replicates its records, the client absorbs them into its own level, then only the records that change travel again;
//    a removal travels as one message; the wire form refuses damaged packets.
//
//     NetworkingSpaceValidation [ledger.md]

#include "Frontier/Extensions/Networking/NetworkingExtension.h"

#include "Frontier/Engine/Scene/WorldSpace.h"

#include <toml++/toml.hpp>

#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

using namespace Frontier;

namespace
{

int                      Failures   = 0;
int                      Assertions = 0;
std::vector<std::string> Ledger;

void Expect(bool Condition, const std::string& Claim)
{
    ++Assertions;
    if (!Condition) ++Failures;
    Ledger.push_back(std::string("| ") + (Condition ? "🟢" : "🔴") + " | " + Claim + " |");
    if (!Condition) std::printf("  🔴 %s\n", Claim.c_str());
}

std::string ConfigurationOf(const SceneRecordBase& Record)
{
    toml::table Configuration;
    Record.SerializeConfiguration(Configuration);
    std::ostringstream Out;
    Out << Configuration;
    return Out.str();
}

const SceneRecordBase* FindNamed(const WorldSpace& World, const char* Type, const std::string& Name)
{
    for (const SceneRecordBase* Record : World.FindAllByType(Type))
        if (Record->QueryRecordName() == Name) return Record;
    return nullptr;
}

} // namespace

int main(int ArgumentCount, char** Arguments)
{
    WorldSpace Host, Client;
    const RecordToken Sun   = Host.ConstructRecord("Solar", "Sun");
    const RecordToken Crate = Host.ConstructRecord("RigidBody", "Crate");
    const RecordToken Mist  = Host.ConstructRecord("Clouds", "Cumulus");
    (void)Client.ConstructRecord("Solar", "Sun");   // 📝 the client opened the same level: its Sun matches by name
    if (auto* Body = dynamic_cast<RigidBodyRecord*>(Host.FindRecord(Crate)))
    {
        Body->AccessSpatial().PositionMetres[0] = 4.5f;
        Body->AccessSpatial().PositionMetres[2] = 12.0f;
        Body->AccessPhysics().Mass.MassKilograms = 80.0f;
    }

    NetworkingSpace   HostSpace, ClientSpace;
    LoopbackTransport HostEnd, ClientEnd;
    LoopbackTransport::Connect(HostEnd, ClientEnd);
    (void)HostSpace.ConfigureLocalPeer("Host", NetworkRole::Host);
    (void)ClientSpace.ConfigureLocalPeer("Client", NetworkRole::Client);
    NetworkingExtension HostBridge(HostSpace, HostEnd), ClientBridge(ClientSpace, ClientEnd);

    // ① greeting and the first replication
    HostBridge.Greet();
    ClientBridge.Greet();
    const size_t First = HostBridge.Replicate(Host);
    HostBridge.Exchange();
    ClientBridge.Exchange();
    HostBridge.Exchange();
    const size_t Applied = ClientBridge.Absorb(Client);
    (void)HostBridge.Absorb(Host);
    std::printf("first replication: %zu record messages, %zu applied on the client\n", First, Applied);
    Expect(First == 3, "the host's first replication sends its 3 records (" + std::to_string(First) + ")");
    Expect(Applied == 4, "the client applies the greeting and the 3 records (" + std::to_string(Applied) + ")");
    Expect(HostSpace.QueryPeers().size() == 2 && ClientSpace.QueryPeers().size() == 2, "each side knows both peers after the greetings");
    Expect(Client.QueryRecordCount() == 3, "the client level holds 3 records (" + std::to_string(Client.QueryRecordCount()) + ")");
    Expect(ClientBridge.QueryMatchedRecords() == 3, "every host record is matched to a client record");
    for (const char* Type : { "Solar", "RigidBody", "Clouds" })
    {
        for (const SceneRecordBase* Original : Host.FindAllByType(Type))
        {
            const SceneRecordBase* Copy = FindNamed(Client, Type, Original->QueryRecordName());
            Expect(Copy != nullptr && ConfigurationOf(*Copy) == ConfigurationOf(*Original), std::string(Type) + " '" + Original->QueryRecordName() + "' arrives with the same configuration");
        }
    }

    // ② nothing changed: nothing travels; one change: one message
    Expect(HostBridge.Replicate(Host) == 0, "an unchanged level sends nothing");
    if (auto* Solar = dynamic_cast<SolarRecord*>(Host.FindRecord(Sun)))
    {
        Solar->AccessConfiguration().ElevationDegrees = 12.5f;
        Solar->AccessConfiguration().AdvanceRevision();
    }
    const size_t Changed = HostBridge.Replicate(Host);
    HostBridge.Exchange();
    ClientBridge.Exchange();
    (void)ClientBridge.Absorb(Client);
    Expect(Changed == 1, "moving the sun sends one message (" + std::to_string(Changed) + ")");
    const SceneRecordBase* ClientSun = FindNamed(Client, "Solar", "Sun");
    Expect(ClientSun && ConfigurationOf(*ClientSun) == ConfigurationOf(*Host.FindRecord(Sun)), "the client's sun follows (elevation 12.5°)");

    // ③ a removal
    (void)Host.DestroyRecord(Mist);
    const size_t Removed = HostBridge.Replicate(Host);
    HostBridge.Exchange();
    ClientBridge.Exchange();
    (void)ClientBridge.Absorb(Client);
    Expect(Removed == 1 && FindNamed(Client, "Clouds", "Cumulus") == nullptr, "removing the clouds removes them on the client");
    Expect(Client.QueryRecordCount() == 2, "the client level holds 2 records");

    // ④ the wire form
    NetworkMessage Message{ 7, 9, NetworkTopic::RecordConfiguration, 42, "token = 1" };
    const std::string Packet = EncodeNetworkMessage(Message);
    NetworkMessage    Decoded;
    Expect(DecodeNetworkMessage(Packet, Decoded) && Decoded.From == 7 && Decoded.To == 9 && Decoded.Sequence == 42 && Decoded.Payload == "token = 1",
           "a packet decodes to the message it encodes (" + std::to_string(Packet.size()) + " bytes)");
    Expect(!DecodeNetworkMessage(std::string_view(Packet).substr(0, Packet.size() - 1), Decoded), "a truncated packet is refused");
    Expect(!DecodeNetworkMessage(std::string_view(Packet).substr(0, 10), Decoded), "a packet shorter than its header is refused");

    // ⑤ tallies agree
    const NetworkTally& Sent     = HostSpace.QueryTally();
    const NetworkTally& Received = ClientSpace.QueryTally();
    Expect(Sent.MessagesSent == Received.MessagesReceived && Sent.BytesSent == Received.BytesReceived,
           "the client received every message and byte the host sent (" + std::to_string(Sent.MessagesSent) + " messages, " + std::to_string(Sent.BytesSent) + " B)");

    std::printf("%s %d / %d assertions\n", Failures == 0 ? "🟢" : "🔴", Assertions - Failures, Assertions);
    if (ArgumentCount > 1)
    {
        std::ofstream Out(Arguments[1]);
        Out << "# NetworkingSpaceValidation\n\nHost and client levels joined by the loopback transport.\n\n| Result | Claim |\n|---|---|\n";
        for (const std::string& Line : Ledger) Out << Line << '\n';
        Out << "\n" << Assertions - Failures << " / " << Assertions << " assertions.\n";
    }
    return Failures == 0 ? 0 : 1;
}
