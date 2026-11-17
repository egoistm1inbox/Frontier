/*==========================================================================================================================================
                                                          NETWORKINGTRANSPORT.CPP
==========================================================================================================================================*/
// 🧩 Wire framing, bounded chunked fragmentation/reassembly, LoopbackTransport, and EOS/Photon relay adapters.

#include "Frontier/Extensions/Networking/NetworkTransport.h"

#include <algorithm>
#include <cstring>

namespace Frontier
{

namespace
{

constexpr size_t HeaderBytes = 24;

void WriteLe(std::string& Bytes, uint64_t Value, size_t Width)
{
    for (size_t Index = 0; Index < Width; ++Index)
    {
        Bytes.push_back(static_cast<char>((Value >> (8 * Index)) & 0xffu));
    }
}

uint64_t ReadLe(std::string_view Bytes, size_t Offset, size_t Width)
{
    uint64_t Value = 0;
    for (size_t Index = 0; Index < Width; ++Index)
    {
        Value |= static_cast<uint64_t>(static_cast<unsigned char>(Bytes[Offset + Index])) << (8 * Index);
    }
    return Value;
}

bool TryReadChunkHeader(std::string_view Bytes, NetworkChunkHeader& OutHeader) noexcept
{
    if (Bytes.size() < NetworkChunkHeaderSize)
    {
        return false;
    }
    const uint32_t Magic = static_cast<uint32_t>(ReadLe(Bytes, 0, 4));
    if (Magic != NetworkChunkMagic)
    {
        return false;
    }
    OutHeader.Magic       = Magic;
    OutHeader.MessageId   = static_cast<uint32_t>(ReadLe(Bytes, 4, 4));
    OutHeader.ChunkIndex  = static_cast<uint16_t>(ReadLe(Bytes, 8, 2));
    OutHeader.ChunkCount  = static_cast<uint16_t>(ReadLe(Bytes, 10, 2));
    OutHeader.TotalBytes  = static_cast<uint32_t>(ReadLe(Bytes, 12, 4));
    OutHeader.ChunkLength = static_cast<uint32_t>(ReadLe(Bytes, 16, 4));
    return OutHeader.ChunkCount > 0 && OutHeader.ChunkIndex < OutHeader.ChunkCount &&
           NetworkChunkHeaderSize + OutHeader.ChunkLength == Bytes.size();
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    WIRE FORM
//------------------------------------------------------------------------------------------------------------------------

std::string EncodeNetworkMessage(const NetworkMessage& Message)
{
    std::string Bytes;
    Bytes.reserve(HeaderBytes + Message.Payload.size());
    WriteLe(Bytes, Message.From, 4);
    WriteLe(Bytes, Message.To, 4);
    WriteLe(Bytes, static_cast<uint64_t>(Message.Topic), 4);
    WriteLe(Bytes, Message.Sequence, 8);
    WriteLe(Bytes, Message.Payload.size(), 4);
    Bytes += Message.Payload;
    return Bytes;
}

bool DecodeNetworkMessage(std::string_view Bytes, NetworkMessage& Message)
{
    if (Bytes.size() < HeaderBytes)
    {
        return false;
    }
    const uint64_t Length = ReadLe(Bytes, 20, 4);
    const uint64_t Topic  = ReadLe(Bytes, 8, 4);
    if (Bytes.size() != HeaderBytes + Length || Topic > static_cast<uint64_t>(NetworkTopic::Farewell))
    {
        return false;
    }
    Message.From     = static_cast<uint32_t>(ReadLe(Bytes, 0, 4));
    Message.To       = static_cast<uint32_t>(ReadLe(Bytes, 4, 4));
    Message.Topic    = static_cast<NetworkTopic>(Topic);
    Message.Sequence = ReadLe(Bytes, 12, 8);
    Message.Payload  = std::string(Bytes.substr(HeaderBytes));
    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    FRAGMENTATION
//------------------------------------------------------------------------------------------------------------------------

std::vector<std::string> NetworkChunkReassembler::Fragment(std::string_view Bytes,
                                                           uint32_t         MessageId,
                                                           size_t           MaxPacketBytes)
{
    if (Bytes.size() <= MaxPacketBytes &&
        (Bytes.size() < 4 || static_cast<uint32_t>(ReadLe(Bytes, 0, 4)) != NetworkChunkMagic))
    {
        return { std::string(Bytes) };
    }
    const size_t PayloadCap = std::max<size_t>(16, MaxPacketBytes - NetworkChunkHeaderSize);
    const size_t ChunkCount = std::max<size_t>(1, (Bytes.size() + PayloadCap - 1) / PayloadCap);
    std::vector<std::string> Frames;
    Frames.reserve(ChunkCount);
    for (size_t Index = 0; Index < ChunkCount; ++Index)
    {
        const size_t Offset = Index * PayloadCap;
        const size_t Length = std::min(PayloadCap, Bytes.size() - Offset);
        std::string  Frame;
        Frame.reserve(NetworkChunkHeaderSize + Length);
        WriteLe(Frame, NetworkChunkMagic, 4);
        WriteLe(Frame, MessageId, 4);
        WriteLe(Frame, Index, 2);
        WriteLe(Frame, ChunkCount, 2);
        WriteLe(Frame, Bytes.size(), 4);
        WriteLe(Frame, Length, 4);
        Frame.append(Bytes.substr(Offset, Length));
        Frames.push_back(std::move(Frame));
    }
    return Frames;
}

std::vector<NetworkMessage> NetworkChunkReassembler::IngestFrame(std::string_view FrameBytes)
{
    std::vector<NetworkMessage> Ready;
    NetworkChunkHeader          Header;
    if (!TryReadChunkHeader(FrameBytes, Header))
    {
        NetworkMessage Single;
        if (DecodeNetworkMessage(FrameBytes, Single))
        {
            Ready.push_back(std::move(Single));
        }
        return Ready;
    }
    if (Header.TotalBytes == 0 || Header.TotalBytes > MaxMessageBytes_)
    {
        return Ready;
    }
    if (Pending_.find(Header.MessageId) == Pending_.end() && Pending_.size() >= MaxBufferedMessages_)
    {
        Pending_.erase(Pending_.begin());
    }
    AssemblyBuffer& Slot = Pending_[Header.MessageId];
    if (Slot.ChunkCount == 0)
    {
        Slot.TotalBytes = Header.TotalBytes;
        Slot.ChunkCount = Header.ChunkCount;
        Slot.Chunks.resize(Header.ChunkCount);
        Slot.Seen.assign(Header.ChunkCount, 0u);
    }
    else if (Slot.TotalBytes != Header.TotalBytes || Slot.ChunkCount != Header.ChunkCount)
    {
        Pending_.erase(Header.MessageId);
        return Ready;
    }
    if (!Slot.Seen[Header.ChunkIndex])
    {
        Slot.Seen[Header.ChunkIndex]   = 1u;
        Slot.Chunks[Header.ChunkIndex] = std::string(FrameBytes.substr(NetworkChunkHeaderSize));
        ++Slot.Received;
    }
    if (Slot.Received == Slot.ChunkCount)
    {
        std::string Assembled;
        Assembled.reserve(Slot.TotalBytes);
        for (const std::string& Piece : Slot.Chunks)
        {
            Assembled += Piece;
        }
        Pending_.erase(Header.MessageId);
        if (Assembled.size() == Header.TotalBytes)
        {
            NetworkMessage Decoded;
            if (DecodeNetworkMessage(Assembled, Decoded))
            {
                Ready.push_back(std::move(Decoded));
            }
        }
    }
    return Ready;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    LOOPBACK
//------------------------------------------------------------------------------------------------------------------------

void LoopbackTransport::Connect(LoopbackTransport& First, LoopbackTransport& Second) noexcept
{
    First.Partner_  = &Second;
    Second.Partner_ = &First;
}

bool LoopbackTransport::Send(const NetworkMessage& Message)
{
    if (Partner_ == nullptr)
    {
        return false;
    }
    const std::string Wire   = EncodeNetworkMessage(Message);
    const size_t      Budget = std::min(MaxPacketBytes_, Partner_->MaxPacketBytes_);
    std::vector<std::string> Frames =
        NetworkChunkReassembler::Fragment(Wire, NextMessageId_++, Budget);
    for (std::string& Frame : Frames)
    {
        Partner_->Packets_.push_back(std::move(Frame));
    }
    return true;
}

std::vector<NetworkMessage> LoopbackTransport::Receive()
{
    std::vector<NetworkMessage> Messages;
    for (const std::string& Frame : Packets_)
    {
        std::vector<NetworkMessage> Decoded = Reassembler_.IngestFrame(Frame);
        for (NetworkMessage& Item : Decoded)
        {
            Messages.push_back(std::move(Item));
        }
    }
    Packets_.clear();
    return Messages;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 RELAY ADAPTER
//------------------------------------------------------------------------------------------------------------------------

void RelayTransportAdapter::PushIncomingBytes(const uint8_t* Data, size_t Length)
{
    if (Data != nullptr && Length > 0)
    {
        LocalInbox_.emplace_back(Data, Data + Length);
    }
}

bool RelayTransportAdapter::Send(const NetworkMessage& Message)
{
    if (!Hooks_.SendFrame)
    {
        return false;
    }
    const std::string        Wire     = EncodeNetworkMessage(Message);
    const bool               Reliable = Message.Topic != NetworkTopic::Greeting;
    std::vector<std::string> Frames   = NetworkChunkReassembler::Fragment(Wire, NextMessageId_++, Hooks_.MaxPacketBytes);
    for (const std::string& Frame : Frames)
    {
        const auto* Bytes = reinterpret_cast<const uint8_t*>(Frame.data());
        if (!Hooks_.SendFrame(Bytes, Frame.size(), Reliable))
        {
            return false;
        }
    }
    return true;
}

std::vector<NetworkMessage> RelayTransportAdapter::Receive()
{
    if (Hooks_.PollFrames)
    {
        Hooks_.PollFrames(LocalInbox_);
    }
    std::vector<NetworkMessage> Messages;
    for (const std::vector<uint8_t>& Frame : LocalInbox_)
    {
        const std::string_view View(reinterpret_cast<const char*>(Frame.data()), Frame.size());
        std::vector<NetworkMessage> Decoded = Reassembler_.IngestFrame(View);
        for (NetworkMessage& Item : Decoded)
        {
            Messages.push_back(std::move(Item));
        }
    }
    LocalInbox_.clear();
    return Messages;
}

} // namespace Frontier
