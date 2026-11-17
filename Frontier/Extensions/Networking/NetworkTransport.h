/*==========================================================================================================================================
                                                            NETWORKTRANSPORT.H
==========================================================================================================================================*/
// 🧩 Wire message framing, chunked fragmentation & reassembly, and pluggable transport adapters (Loopback, EOS, Photon).

#pragma once

#include "Frontier/Extensions/Networking/NetworkingSpace.h"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace Frontier
{

// 📝 Wire envelope: 24-byte little-endian header (sender, receiver, topic, sequence, payload length) followed by payload.
[[nodiscard]] std::string EncodeNetworkMessage(const NetworkMessage& Message);
bool                      DecodeNetworkMessage(std::string_view Bytes, NetworkMessage& Message);

//------------------------------------------------------------------------------------------------------------------------
//                                              CHUNKED FRAGMENTATION & REASSEMBLY
//------------------------------------------------------------------------------------------------------------------------

inline constexpr uint32_t NetworkChunkMagic      = 0x4B4E4346u;   // 'FCNK'
inline constexpr size_t   NetworkChunkHeaderSize = 20;            // magic(4) + id(4) + index(2) + count(2) + total(4) + len(4)
inline constexpr size_t   DefaultMaxPacketBytes  = 3840;          // fits comfortably inside PacketCodec::MaxPayload (4096)

struct NetworkChunkHeader
{
    uint32_t Magic       = NetworkChunkMagic;
    uint32_t MessageId   = 0;
    uint16_t ChunkIndex  = 0;
    uint16_t ChunkCount  = 0;
    uint32_t TotalBytes  = 0;
    uint32_t ChunkLength = 0;
};

class NetworkChunkReassembler
{
  public:
    explicit NetworkChunkReassembler(size_t MaxBufferedMessages = 64, size_t MaxMessageBytes = 4u * 1024u * 1024u) noexcept
        : MaxBufferedMessages_(MaxBufferedMessages), MaxMessageBytes_(MaxMessageBytes)
    {
    }

    // 📝 Encodes Bytes into 1+ transport packets if larger than MaxPacketBytes; returns the frame(s) ready to transmit.
    [[nodiscard]] static std::vector<std::string> Fragment(std::string_view Bytes,
                                                           uint32_t         MessageId,
                                                           size_t           MaxPacketBytes = DefaultMaxPacketBytes);

    // 📝 Feeds one incoming transport frame (either a raw encoded message or an 'FCNK' fragment). Returns decoded messages.
    [[nodiscard]] std::vector<NetworkMessage> IngestFrame(std::string_view FrameBytes);

    void Clear() noexcept { Pending_.clear(); }
    [[nodiscard]] size_t QueryPendingCount() const noexcept { return Pending_.size(); }

  private:
    struct AssemblyBuffer
    {
        uint32_t                 TotalBytes = 0;
        uint16_t                 ChunkCount = 0;
        uint16_t                 Received   = 0;
        std::vector<std::string> Chunks;
        std::vector<uint8_t>     Seen;
    };

    size_t                                         MaxBufferedMessages_;
    size_t                                         MaxMessageBytes_;
    std::unordered_map<uint32_t, AssemblyBuffer>   Pending_;
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    TRANSPORT INTERFACE
//------------------------------------------------------------------------------------------------------------------------

class INetworkTransport
{
  public:
    virtual ~INetworkTransport() = default;

    virtual bool                                      Send(const NetworkMessage& Message) = 0;
    [[nodiscard]] virtual std::vector<NetworkMessage> Receive()                           = 0;
    [[nodiscard]] virtual const char*                 QueryName() const noexcept          = 0;
    [[nodiscard]] virtual size_t QueryMaxPacketBytes() const noexcept { return DefaultMaxPacketBytes; }
    virtual void                 Flush() noexcept {}
};

using NetworkTransport = INetworkTransport;

// 📝 Two ends in one process: what one sends, the other receives, chunked and framed in the exact wire format.
class LoopbackTransport final : public INetworkTransport
{
  public:
    static void Connect(LoopbackTransport& First, LoopbackTransport& Second) noexcept;

    void ConfigureMaxPacketBytes(size_t MaxBytes) noexcept
    {
        MaxPacketBytes_ = MaxBytes > 64 ? MaxBytes : 64;
    }

    bool                                      Send(const NetworkMessage& Message) override;
    [[nodiscard]] std::vector<NetworkMessage> Receive() override;
    [[nodiscard]] const char*                 QueryName() const noexcept override { return "Loopback"; }
    [[nodiscard]] size_t                      QueryMaxPacketBytes() const noexcept override { return MaxPacketBytes_; }

  private:
    LoopbackTransport*      Partner_        = nullptr;
    size_t                  MaxPacketBytes_ = DefaultMaxPacketBytes;
    uint32_t                NextMessageId_  = 1;
    std::vector<std::string> Packets_;
    NetworkChunkReassembler Reassembler_{};
};

//------------------------------------------------------------------------------------------------------------------------
//                                               RELAY ADAPTERS (EOS / PHOTON)
//------------------------------------------------------------------------------------------------------------------------

struct RelayTransportHooks
{
    using SendFrameFn     = std::function<bool(const uint8_t* Data, size_t Length, bool Reliable)>;
    using PollFramesFn    = std::function<void(std::vector<std::vector<uint8_t>>& OutFrames)>;
    using QueryReadyFn    = std::function<bool()>;

    SendFrameFn  SendFrame;
    PollFramesFn PollFrames;
    QueryReadyFn IsReady;
    size_t       MaxPacketBytes = DefaultMaxPacketBytes;
};

class RelayTransportAdapter : public INetworkTransport
{
  public:
    RelayTransportAdapter(std::string AdapterName, RelayTransportHooks Hooks = {}) noexcept
        : Name_(std::move(AdapterName)), Hooks_(std::move(Hooks))
    {
    }

    void ConfigureHooks(RelayTransportHooks Hooks) noexcept { Hooks_ = std::move(Hooks); }
    void PushIncomingBytes(const uint8_t* Data, size_t Length);
    [[nodiscard]] bool QueryReady() const noexcept { return Hooks_.IsReady ? Hooks_.IsReady() : static_cast<bool>(Hooks_.SendFrame); }

    bool                                      Send(const NetworkMessage& Message) override;
    [[nodiscard]] std::vector<NetworkMessage> Receive() override;
    [[nodiscard]] const char*                 QueryName() const noexcept override { return Name_.c_str(); }
    [[nodiscard]] size_t                      QueryMaxPacketBytes() const noexcept override { return Hooks_.MaxPacketBytes; }

  private:
    std::string                      Name_;
    RelayTransportHooks              Hooks_{};
    uint32_t                         NextMessageId_ = 1;
    std::vector<std::vector<uint8_t>> LocalInbox_;
    NetworkChunkReassembler          Reassembler_{};
};

class EosRelayAdapter final : public RelayTransportAdapter
{
  public:
    explicit EosRelayAdapter(RelayTransportHooks Hooks = {}) noexcept : RelayTransportAdapter("EOS", std::move(Hooks)) {}
};

class PhotonRelayAdapter final : public RelayTransportAdapter
{
  public:
    explicit PhotonRelayAdapter(RelayTransportHooks Hooks = {}) noexcept : RelayTransportAdapter("Photon", std::move(Hooks)) {}
};

} // namespace Frontier
