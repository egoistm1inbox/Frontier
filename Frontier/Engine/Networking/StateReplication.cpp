/*==========================================================================================================================================
                                                    REPLICATIONEXTENSION.CPP
==========================================================================================================================================*/
// 🧩 Engine-wide multiplayer replication implementation.

#include "Engine/Networking/StateReplication.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace Frontier::Networking
{

namespace
{

constexpr float InvSqrtTwo  = 0.70710678118654752440f;
constexpr float SqrtTwo     = 1.41421356237309504880f;

void WriteU16Be(std::uint8_t* Dst, std::uint16_t Val) noexcept
{
    Dst[0] = static_cast<std::uint8_t>((Val >> 8u) & 0xFFu);
    Dst[1] = static_cast<std::uint8_t>(Val & 0xFFu);
}

std::uint16_t ReadU16Be(const std::uint8_t* Src) noexcept
{
    return static_cast<std::uint16_t>((static_cast<std::uint16_t>(Src[0]) << 8u) | Src[1]);
}

void WriteU32Be(std::uint8_t* Dst, std::uint32_t Val) noexcept
{
    Dst[0] = static_cast<std::uint8_t>((Val >> 24u) & 0xFFu);
    Dst[1] = static_cast<std::uint8_t>((Val >> 16u) & 0xFFu);
    Dst[2] = static_cast<std::uint8_t>((Val >> 8u)  & 0xFFu);
    Dst[3] = static_cast<std::uint8_t>(Val & 0xFFu);
}

std::uint32_t ReadU32Be(const std::uint8_t* Src) noexcept
{
    return (static_cast<std::uint32_t>(Src[0]) << 24u) |
           (static_cast<std::uint32_t>(Src[1]) << 16u) |
           (static_cast<std::uint32_t>(Src[2]) << 8u)  |
           static_cast<std::uint32_t>(Src[3]);
}

void WriteF32Le(std::uint8_t* Dst, float Val) noexcept
{
    std::uint32_t Bits = 0u;
    std::memcpy(&Bits, &Val, sizeof(float));
    Dst[0] = static_cast<std::uint8_t>(Bits & 0xFFu);
    Dst[1] = static_cast<std::uint8_t>((Bits >> 8u) & 0xFFu);
    Dst[2] = static_cast<std::uint8_t>((Bits >> 16u) & 0xFFu);
    Dst[3] = static_cast<std::uint8_t>((Bits >> 24u) & 0xFFu);
}

float ReadF32Le(const std::uint8_t* Src) noexcept
{
    const std::uint32_t Bits =
        static_cast<std::uint32_t>(Src[0]) |
        (static_cast<std::uint32_t>(Src[1]) << 8u) |
        (static_cast<std::uint32_t>(Src[2]) << 16u) |
        (static_cast<std::uint32_t>(Src[3]) << 24u);
    float Out = 0.0f;
    std::memcpy(&Out, &Bits, sizeof(float));
    return Out;
}

bool SequenceGreaterThan(std::uint16_t S1, std::uint16_t S2) noexcept
{
    return ((S1 > S2) && (static_cast<std::uint32_t>(S1 - S2) <= 32768u)) ||
           ((S1 < S2) && (static_cast<std::uint32_t>(S2 - S1) >  32768u));
}

std::uint16_t SequenceDistance(std::uint16_t Newer, std::uint16_t Older) noexcept
{
    return static_cast<std::uint16_t>(Newer - Older);
}

bool ObjectsMeaningfullyDiffer(const ReplicatedObjectDescriptor& A, const ReplicatedObjectDescriptor& B) noexcept
{
    if (A.ArchetypeIdentifier != B.ArchetypeIdentifier || A.OwnerPeerOrdinal != B.OwnerPeerOrdinal)
    {
        return true;
    }
    const Vec3 DeltaPos = A.Position - B.Position;
    if (Dot(DeltaPos, DeltaPos) > 1.0e-6f)
    {
        return true;
    }
    const float DotQ = std::abs(A.Orientation.X * B.Orientation.X + A.Orientation.Y * B.Orientation.Y +
                                A.Orientation.Z * B.Orientation.Z + A.Orientation.W * B.Orientation.W);
    if (DotQ < 0.99995f)
    {
        return true;
    }
    for (std::size_t C = 0u; C < 4u; ++C)
    {
        if (std::abs(A.CustomChannels[C] - B.CustomChannels[C]) > 1.0e-4f)
        {
            return true;
        }
    }
    return false;
}

UnitQuaternion SlerpShortestArc(const UnitQuaternion& Qa, const UnitQuaternion& Qb, float T) noexcept
{
    UnitQuaternion A = Qa.Normalized();
    UnitQuaternion B = Qb.Normalized();
    float CosTheta = A.X * B.X + A.Y * B.Y + A.Z * B.Z + A.W * B.W;
    if (CosTheta < 0.0f)
    {
        B.X = -B.X; B.Y = -B.Y; B.Z = -B.Z; B.W = -B.W;
        CosTheta = -CosTheta;
    }
    if (CosTheta > 0.9995f)
    {
        return UnitQuaternion{
            A.X + T * (B.X - A.X),
            A.Y + T * (B.Y - A.Y),
            A.Z + T * (B.Z - A.Z),
            A.W + T * (B.W - A.W)
        }.Normalized();
    }
    const float Theta    = std::acos(std::clamp(CosTheta, -1.0f, 1.0f));
    const float SinTheta = std::sin(Theta);
    const float Wa       = std::sin((1.0f - T) * Theta) / SinTheta;
    const float Wb       = std::sin(T * Theta) / SinTheta;
    return UnitQuaternion{
        Wa * A.X + Wb * B.X,
        Wa * A.Y + Wb * B.Y,
        Wa * A.Z + Wb * B.Z,
        Wa * A.W + Wb * B.W
    }.Normalized();
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                  FP1 WIRE FRAMING & RELIABILITY SEQUENCE HEADER
//------------------------------------------------------------------------------------------------------------------------

bool Fp1WireFrameCodec::EncodeFrame(
    Fp1WireChannel              Channel,
    const ReliabilityEnvelope&  Envelope,
    const std::uint8_t*         BodyBytes,
    std::size_t                 BodyLength,
    std::vector<std::uint8_t>&  OutWirePacket)
{
    const std::size_t PayloadBytes = EnvelopeBytes + BodyLength;
    if (PayloadBytes > MaxPayloadBytes || (BodyLength > 0u && BodyBytes == nullptr))
    {
        return false;
    }

    OutWirePacket.resize(Fp1HeaderBytes + PayloadBytes);
    OutWirePacket[0] = 'F';
    OutWirePacket[1] = 'P';
    OutWirePacket[2] = '1';
    OutWirePacket[3] = WireVersion;
    OutWirePacket[4] = static_cast<std::uint8_t>(Channel);
    WriteU16Be(&OutWirePacket[5], static_cast<std::uint16_t>(PayloadBytes));

    std::uint8_t* Env = &OutWirePacket[Fp1HeaderBytes];
    WriteU16Be(Env + 0u,  Envelope.LocalSequence);
    WriteU16Be(Env + 2u,  Envelope.RemoteAckSequence);
    WriteU32Be(Env + 4u,  Envelope.RemoteAckBitfield);
    WriteU32Be(Env + 8u,  Envelope.SimulationTick);
    WriteU32Be(Env + 12u, Envelope.BaselineTick);

    if (BodyLength > 0u)
    {
        std::memcpy(Env + EnvelopeBytes, BodyBytes, BodyLength);
    }
    return true;
}

bool Fp1WireFrameCodec::DecodeFrame(
    const std::uint8_t*         WireBytes,
    std::size_t                 WireLength,
    Fp1WireChannel&             OutChannel,
    ReliabilityEnvelope&        OutEnvelope,
    const std::uint8_t*&        OutBodyBytes,
    std::size_t&                OutBodyLength) noexcept
{
    OutBodyBytes  = nullptr;
    OutBodyLength = 0u;
    if (WireBytes == nullptr || WireLength < Fp1HeaderBytes + EnvelopeBytes || WireLength > MaxPacketBytes)
    {
        return false;
    }
    if (WireBytes[0] != 'F' || WireBytes[1] != 'P' || WireBytes[2] != '1')
    {
        return false;
    }
    if (WireBytes[3] != WireVersion || WireBytes[4] > static_cast<std::uint8_t>(Fp1WireChannel::CommandStream))
    {
        return false;
    }

    const std::size_t DeclaredPayload = ReadU16Be(&WireBytes[5]);
    if (DeclaredPayload < EnvelopeBytes || DeclaredPayload > MaxPayloadBytes || Fp1HeaderBytes + DeclaredPayload != WireLength)
    {
        return false;
    }

    OutChannel = static_cast<Fp1WireChannel>(WireBytes[4]);
    const std::uint8_t* Env = &WireBytes[Fp1HeaderBytes];
    OutEnvelope.LocalSequence     = ReadU16Be(Env + 0u);
    OutEnvelope.RemoteAckSequence = ReadU16Be(Env + 2u);
    OutEnvelope.RemoteAckBitfield = ReadU32Be(Env + 4u);
    OutEnvelope.SimulationTick    = ReadU32Be(Env + 8u);
    OutEnvelope.BaselineTick      = ReadU32Be(Env + 12u);

    OutBodyLength = DeclaredPayload - EnvelopeBytes;
    OutBodyBytes  = (OutBodyLength > 0u) ? (Env + EnvelopeBytes) : nullptr;
    return true;
}

ReliabilityEnvelope SequenceAckTracker::PrepareOutgoingEnvelope(
    std::uint32_t SimulationTick,
    std::uint32_t BaselineTick) noexcept
{
    const std::uint16_t Seq = NextOutgoingSequence_++;
    SentRecord& Slot = SentWindow_[Seq % SentWindow_.size()];
    Slot.Sequence     = Seq;
    Slot.Tick         = SimulationTick;
    Slot.SentTimeSec  = 0.0;
    Slot.Occupied     = true;
    Slot.Acknowledged = false;

    ReliabilityEnvelope Env{};
    Env.LocalSequence     = Seq;
    Env.RemoteAckSequence = HighestRemoteSequence_;
    Env.RemoteAckBitfield = RemoteReceiveBitfield_;
    Env.SimulationTick    = SimulationTick;
    Env.BaselineTick      = BaselineTick;
    return Env;
}

void SequenceAckTracker::RecordIncomingEnvelope(const ReliabilityEnvelope& Incoming, double ArrivalTimeSeconds) noexcept
{
    if (!RemoteInitialized_)
    {
        HighestRemoteSequence_ = Incoming.LocalSequence;
        RemoteReceiveBitfield_ = 0u;
        RemoteInitialized_     = true;
    }
    else if (SequenceGreaterThan(Incoming.LocalSequence, HighestRemoteSequence_))
    {
        const std::uint16_t Shift = SequenceDistance(Incoming.LocalSequence, HighestRemoteSequence_);
        if (Shift >= 32u)
        {
            RemoteReceiveBitfield_ = (Shift == 32u) ? (1u << 31u) : 0u;
        }
        else
        {
            RemoteReceiveBitfield_ = (RemoteReceiveBitfield_ << Shift) | (1u << (Shift - 1u));
        }
        HighestRemoteSequence_ = Incoming.LocalSequence;
    }
    else if (Incoming.LocalSequence != HighestRemoteSequence_)
    {
        const std::uint16_t Offset = SequenceDistance(HighestRemoteSequence_, Incoming.LocalSequence);
        if (Offset >= 1u && Offset <= 32u)
        {
            RemoteReceiveBitfield_ |= (1u << (Offset - 1u));
        }
    }

    auto ConfirmSentSequence = [&](std::uint16_t AckedSeq) noexcept
    {
        SentRecord& Slot = SentWindow_[AckedSeq % SentWindow_.size()];
        if (Slot.Occupied && Slot.Sequence == AckedSeq && !Slot.Acknowledged)
        {
            Slot.Acknowledged = true;
            ++ConfirmedCount_;
            if (Slot.Tick > ConfirmedBaselineTick_)
            {
                ConfirmedBaselineTick_ = Slot.Tick;
            }
            if (Slot.SentTimeSec > 0.0 && ArrivalTimeSeconds >= Slot.SentTimeSec)
            {
                const double RttMs = (ArrivalTimeSeconds - Slot.SentTimeSec) * 1000.0;
                SmoothedRttMillis_ = 0.85 * SmoothedRttMillis_ + 0.15 * RttMs;
            }
        }
    };

    ConfirmSentSequence(Incoming.RemoteAckSequence);
    for (std::uint32_t Bit = 0u; Bit < 32u; ++Bit)
    {
        if ((Incoming.RemoteAckBitfield & (1u << Bit)) != 0u)
        {
            ConfirmSentSequence(static_cast<std::uint16_t>(Incoming.RemoteAckSequence - 1u - Bit));
        }
    }

    std::uint32_t Eligible = 0u;
    std::uint32_t Missing  = 0u;
    for (const SentRecord& S : SentWindow_)
    {
        if (S.Occupied && SequenceDistance(NextOutgoingSequence_, S.Sequence) > 4u)
        {
            ++Eligible;
            if (!S.Acknowledged)
            {
                ++Missing;
            }
        }
    }
    LossFraction_ = (Eligible > 0u) ? (static_cast<double>(Missing) / static_cast<double>(Eligible)) : 0.0;
}

//------------------------------------------------------------------------------------------------------------------------
//                           SMALLEST-THREE 32-BIT QUATERNION & 48-BYTE GRIT VEHICLE CODEC
//------------------------------------------------------------------------------------------------------------------------

std::uint32_t PackSmallestThreeQuaternion(const UnitQuaternion& Rotation) noexcept
{
    const UnitQuaternion Q = Rotation.Normalized();
    const float Comps[4] = { Q.X, Q.Y, Q.Z, Q.W };

    std::uint32_t MaxIndex = 0u;
    float MaxAbs = std::abs(Comps[0]);
    for (std::uint32_t I = 1u; I < 4u; ++I)
    {
        const float A = std::abs(Comps[I]);
        if (A > MaxAbs)
        {
            MaxAbs   = A;
            MaxIndex = I;
        }
    }

    const float SignFlip = (Comps[MaxIndex] < 0.0f) ? -1.0f : 1.0f;
    std::uint32_t Packed = (MaxIndex & 0x3u) << 30u;
    std::uint32_t Shift  = 20u;

    for (std::uint32_t I = 0u; I < 4u; ++I)
    {
        if (I == MaxIndex)
        {
            continue;
        }
        const float Val  = std::clamp(Comps[I] * SignFlip, -InvSqrtTwo, InvSqrtTwo);
        const float Norm = (Val + InvSqrtTwo) / SqrtTwo;
        const std::uint32_t Quant = static_cast<std::uint32_t>(std::llround(Norm * 1023.0f)) & 0x3FFu;
        Packed |= (Quant << Shift);
        Shift = (Shift >= 10u) ? (Shift - 10u) : 0u;
    }
    return Packed;
}

UnitQuaternion UnpackSmallestThreeQuaternion(std::uint32_t Packed) noexcept
{
    const std::uint32_t MaxIndex = (Packed >> 30u) & 0x3u;
    const std::uint32_t Q0 = (Packed >> 20u) & 0x3FFu;
    const std::uint32_t Q1 = (Packed >> 10u) & 0x3FFu;
    const std::uint32_t Q2 = Packed & 0x3FFu;
    const std::uint32_t Quant[3] = { Q0, Q1, Q2 };

    float Comps[4] = { 0.0f, 0.0f, 0.0f, 0.0f };
    float SumSq    = 0.0f;
    std::uint32_t Cursor = 0u;
    for (std::uint32_t I = 0u; I < 4u; ++I)
    {
        if (I == MaxIndex)
        {
            continue;
        }
        const float Norm = static_cast<float>(Quant[Cursor++]) / 1023.0f;
        const float Val  = Norm * SqrtTwo - InvSqrtTwo;
        Comps[I] = Val;
        SumSq   += Val * Val;
    }
    Comps[MaxIndex] = std::sqrt(std::max(0.0f, 1.0f - SumSq));
    return UnitQuaternion{ Comps[0], Comps[1], Comps[2], Comps[3] }.Normalized();
}

CompactVehicleWireRecord QuantizeVehicleSample(const DecodedVehicleReplicationSample& Sample) noexcept
{
    CompactVehicleWireRecord W{};
    W.ObjectIdentifier  = Sample.ObjectIdentifier;
    W.PositionX         = Sample.Position.X;
    W.PositionY         = Sample.Position.Y;
    W.PositionZ         = Sample.Position.Z;
    W.PackedOrientation = PackSmallestThreeQuaternion(Sample.Orientation);

    const float Lin[3] = { Sample.LinearVelocity.X, Sample.LinearVelocity.Y, Sample.LinearVelocity.Z };
    const float Ang[3] = { Sample.AngularVelocity.X, Sample.AngularVelocity.Y, Sample.AngularVelocity.Z };
    for (int K = 0; K < 3; ++K)
    {
        W.LinearVelCentimetresS[K] = static_cast<std::int16_t>(std::clamp(std::llround(Lin[K] * 100.0f), -32767LL, 32767LL));
        W.AngularVelMilliradS[K]   = static_cast<std::int16_t>(std::clamp(std::llround(Ang[K] * 200.0f), -32767LL, 32767LL));
    }

    for (std::size_t C = 0u; C < 4u; ++C)
    {
        W.SuspensionDeflection[C] = static_cast<std::uint8_t>(std::clamp(std::llround(Sample.SuspensionDeflectionM[C] * 500.0f), 0LL, 255LL));
        W.WheelSpinHalfRadS[C]    = static_cast<std::int8_t>(std::clamp(std::llround(Sample.WheelSpinRadSec[C] * 0.5f), -127LL, 127LL));
    }

    W.SteeringQuantized = static_cast<std::int8_t>(std::clamp(std::llround(Sample.Steering * 127.0f), -127LL, 127LL));
    W.ThrottleQuantized = static_cast<std::uint8_t>(std::clamp(std::llround(Sample.Throttle * 255.0f), 0LL, 255LL));
    W.BrakeQuantized    = static_cast<std::uint8_t>(std::clamp(std::llround(Sample.Brake    * 255.0f), 0LL, 255LL));

    const std::uint8_t GearBits = static_cast<std::uint8_t>(std::clamp(Sample.GearNumber + 2, 0, 15)) & 0x0Fu;
    W.GearAndIgnitionBits = GearBits
                          | (Sample.AdditiveActive ? 0x10u : 0x00u)
                          | (Sample.SmokingActive  ? 0x20u : 0x00u)
                          | (Sample.TyreIgnited    ? 0x40u : 0x00u);

    W.BoostTenthsBar   = static_cast<std::uint8_t>(std::clamp(std::llround(Sample.ManifoldBoostBar * 10.0f), 0LL, 255LL));
    W.FuelOrSocPercent = static_cast<std::uint8_t>(std::clamp(std::llround(Sample.EnergyReservePercent), 0LL, 100LL));
    W.EngineHectoRpm   = static_cast<std::uint16_t>(std::clamp(std::llround(Sample.EngineRpm * 0.1f), 0LL, 65535LL));
    return W;
}

DecodedVehicleReplicationSample DequantizeVehicleSample(const CompactVehicleWireRecord& Wire) noexcept
{
    DecodedVehicleReplicationSample S{};
    S.ObjectIdentifier = Wire.ObjectIdentifier;
    S.Position         = Vec3{ Wire.PositionX, Wire.PositionY, Wire.PositionZ };
    S.Orientation      = UnpackSmallestThreeQuaternion(Wire.PackedOrientation);
    S.LinearVelocity   = Vec3{
        static_cast<float>(Wire.LinearVelCentimetresS[0]) * 0.01f,
        static_cast<float>(Wire.LinearVelCentimetresS[1]) * 0.01f,
        static_cast<float>(Wire.LinearVelCentimetresS[2]) * 0.01f
    };
    S.AngularVelocity  = Vec3{
        static_cast<float>(Wire.AngularVelMilliradS[0]) * 0.005f,
        static_cast<float>(Wire.AngularVelMilliradS[1]) * 0.005f,
        static_cast<float>(Wire.AngularVelMilliradS[2]) * 0.005f
    };
    for (std::size_t C = 0u; C < 4u; ++C)
    {
        S.SuspensionDeflectionM[C] = static_cast<float>(Wire.SuspensionDeflection[C]) * 0.002f;
        S.WheelSpinRadSec[C]       = static_cast<float>(Wire.WheelSpinHalfRadS[C]) * 2.0f;
    }
    S.Steering             = static_cast<float>(Wire.SteeringQuantized) / 127.0f;
    S.Throttle             = static_cast<float>(Wire.ThrottleQuantized) / 255.0f;
    S.Brake                = static_cast<float>(Wire.BrakeQuantized) / 255.0f;
    S.GearNumber           = static_cast<int>(Wire.GearAndIgnitionBits & 0x0Fu) - 2;
    S.AdditiveActive       = (Wire.GearAndIgnitionBits & 0x10u) != 0u;
    S.SmokingActive        = (Wire.GearAndIgnitionBits & 0x20u) != 0u;
    S.TyreIgnited          = (Wire.GearAndIgnitionBits & 0x40u) != 0u;
    S.ManifoldBoostBar     = static_cast<float>(Wire.BoostTenthsBar) * 0.1f;
    S.EnergyReservePercent = static_cast<float>(Wire.FuelOrSocPercent);
    S.EngineRpm            = static_cast<float>(Wire.EngineHectoRpm) * 10.0f;
    return S;
}

//------------------------------------------------------------------------------------------------------------------------
//                           GENRE-AGNOSTIC DELTA SNAPSHOT WORLD REPLICATION REGISTRY
//------------------------------------------------------------------------------------------------------------------------

void WorldReplicationRegistry::UpsertObject(const ReplicatedObjectDescriptor& Object)
{
    for (ReplicatedObjectDescriptor& Existing : CurrentObjects_)
    {
        if (Existing.ObjectIdentifier == Object.ObjectIdentifier)
        {
            Existing = Object;
            return;
        }
    }
    CurrentObjects_.push_back(Object);
}

void WorldReplicationRegistry::RemoveObject(std::uint32_t ObjectIdentifier) noexcept
{
    CurrentObjects_.erase(
        std::remove_if(CurrentObjects_.begin(), CurrentObjects_.end(),
            [ObjectIdentifier](const ReplicatedObjectDescriptor& O) { return O.ObjectIdentifier == ObjectIdentifier; }),
        CurrentObjects_.end());
}

const ReplicatedObjectDescriptor* WorldReplicationRegistry::FindObject(std::uint32_t ObjectIdentifier) const noexcept
{
    for (const ReplicatedObjectDescriptor& O : CurrentObjects_)
    {
        if (O.ObjectIdentifier == ObjectIdentifier)
        {
            return &O;
        }
    }
    return nullptr;
}

void WorldReplicationRegistry::CaptureTickSnapshot(std::uint32_t SimulationTick)
{
    HistoricalTickEntry& Slot = History_[HistoryWriteSlot_ % MaxHistorySnapshots];
    Slot.Tick    = SimulationTick;
    Slot.Objects = CurrentObjects_;
    ++HistoryWriteSlot_;
}

bool WorldReplicationRegistry::BuildDeltaSnapshotPacket(
    std::uint32_t               SimulationTick,
    std::uint32_t               BaselineTick,
    Vec3                        ObserverPosition,
    SequenceAckTracker&         AckTracker,
    std::vector<std::uint8_t>&  OutFp1Packet,
    std::uint32_t&              OutEncodedObjectCount)
{
    OutEncodedObjectCount = 0u;
    const HistoricalTickEntry* BaselineEntry = nullptr;
    if (BaselineTick > 0u)
    {
        for (const HistoricalTickEntry& H : History_)
        {
            if (H.Tick == BaselineTick)
            {
                BaselineEntry = &H;
                break;
            }
        }
    }

    const std::uint32_t EffectiveBaseline = (BaselineEntry != nullptr) ? BaselineTick : 0u;
    constexpr std::size_t ObjectWireStride = 52u;
    const std::size_t MaxObjectsInMtu = (Fp1WireFrameCodec::MaxPayloadBytes - Fp1WireFrameCodec::EnvelopeBytes - 4u) / ObjectWireStride;

    std::vector<const ReplicatedObjectDescriptor*> Candidates;
    Candidates.reserve(CurrentObjects_.size());

    for (const ReplicatedObjectDescriptor& Obj : CurrentObjects_)
    {
        const Vec3 Delta = Obj.Position - ObserverPosition;
        if (Dot(Delta, Delta) > (Obj.InterestRadiusM * Obj.InterestRadiusM))
        {
            continue;
        }

        if (BaselineEntry != nullptr)
        {
            bool FoundUnchanged = false;
            for (const ReplicatedObjectDescriptor& Prev : BaselineEntry->Objects)
            {
                if (Prev.ObjectIdentifier == Obj.ObjectIdentifier)
                {
                    FoundUnchanged = !ObjectsMeaningfullyDiffer(Obj, Prev);
                    break;
                }
            }
            if (FoundUnchanged)
            {
                continue;
            }
        }
        Candidates.push_back(&Obj);
    }

    std::sort(Candidates.begin(), Candidates.end(), [&](const ReplicatedObjectDescriptor* A, const ReplicatedObjectDescriptor* B) {
        const Vec3 Da = A->Position - ObserverPosition;
        const Vec3 Db = B->Position - ObserverPosition;
        return Dot(Da, Da) < Dot(Db, Db);
    });

    const std::size_t CountToEncode = std::min(Candidates.size(), MaxObjectsInMtu);
    std::vector<std::uint8_t> Body(4u + CountToEncode * ObjectWireStride, 0u);
    WriteU32Be(Body.data(), static_cast<std::uint32_t>(CountToEncode));

    for (std::size_t I = 0u; I < CountToEncode; ++I)
    {
        const ReplicatedObjectDescriptor& O = *Candidates[I];
        std::uint8_t* Cursor = Body.data() + 4u + I * ObjectWireStride;
        WriteU32Be(Cursor + 0u,  O.ObjectIdentifier);
        WriteU16Be(Cursor + 4u,  O.ArchetypeIdentifier);
        WriteU16Be(Cursor + 6u,  O.OwnerPeerOrdinal);
        WriteF32Le(Cursor + 8u,  O.Position.X);
        WriteF32Le(Cursor + 12u, O.Position.Y);
        WriteF32Le(Cursor + 16u, O.Position.Z);
        WriteU32Be(Cursor + 20u, PackSmallestThreeQuaternion(O.Orientation));
        WriteF32Le(Cursor + 24u, O.LinearVelocity.X);
        WriteF32Le(Cursor + 28u, O.LinearVelocity.Y);
        WriteF32Le(Cursor + 32u, O.LinearVelocity.Z);
        for (std::size_t C = 0u; C < 4u; ++C)
        {
            WriteF32Le(Cursor + 36u + C * 4u, O.CustomChannels[C]);
        }
    }

    OutEncodedObjectCount = static_cast<std::uint32_t>(CountToEncode);
    const ReliabilityEnvelope Env = AckTracker.PrepareOutgoingEnvelope(SimulationTick, EffectiveBaseline);
    return Fp1WireFrameCodec::EncodeFrame(Fp1WireChannel::WorldSnapshot, Env, Body.data(), Body.size(), OutFp1Packet);
}

bool WorldReplicationRegistry::ApplyIncomingSnapshotPacket(
    const std::uint8_t*         Fp1Bytes,
    std::size_t                 Fp1Length,
    double                      ArrivalTimeSeconds,
    SequenceAckTracker&         AckTracker,
    std::uint32_t&              OutSimulationTick)
{
    Fp1WireChannel      Channel{};
    ReliabilityEnvelope Env{};
    const std::uint8_t* Body   = nullptr;
    std::size_t         Length = 0u;
    if (!Fp1WireFrameCodec::DecodeFrame(Fp1Bytes, Fp1Length, Channel, Env, Body, Length) ||
        Channel != Fp1WireChannel::WorldSnapshot || Length < 4u)
    {
        return false;
    }

    constexpr std::size_t ObjectWireStride = 52u;
    const std::uint32_t ObjectCount = ReadU32Be(Body);
    if (4u + static_cast<std::size_t>(ObjectCount) * ObjectWireStride != Length)
    {
        return false;
    }

    AckTracker.RecordIncomingEnvelope(Env, ArrivalTimeSeconds);
    OutSimulationTick = Env.SimulationTick;

    for (std::uint32_t I = 0u; I < ObjectCount; ++I)
    {
        const std::uint8_t* Cursor = Body + 4u + static_cast<std::size_t>(I) * ObjectWireStride;
        ReplicatedObjectDescriptor O{};
        O.ObjectIdentifier    = ReadU32Be(Cursor + 0u);
        O.ArchetypeIdentifier = ReadU16Be(Cursor + 4u);
        O.OwnerPeerOrdinal    = ReadU16Be(Cursor + 6u);
        O.Position            = Vec3{ ReadF32Le(Cursor + 8u), ReadF32Le(Cursor + 12u), ReadF32Le(Cursor + 16u) };
        O.Orientation         = UnpackSmallestThreeQuaternion(ReadU32Be(Cursor + 20u));
        O.LinearVelocity      = Vec3{ ReadF32Le(Cursor + 24u), ReadF32Le(Cursor + 28u), ReadF32Le(Cursor + 32u) };
        for (std::size_t C = 0u; C < 4u; ++C)
        {
            O.CustomChannels[C] = ReadF32Le(Cursor + 36u + C * 4u);
        }
        UpsertObject(O);
    }

    CaptureTickSnapshot(Env.SimulationTick);
    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                          CUBIC HERMITE JITTER-BUFFERED INTERPOLATION & CLIENT PREDICTION
//------------------------------------------------------------------------------------------------------------------------

void HermitePoseInterpolator::PushTimedSample(
    double         TimestampSeconds,
    Vec3           Position,
    UnitQuaternion Orientation,
    Vec3           LinearVelocity) noexcept
{
    if (Count_ > 0u && TimestampSeconds <= Buffer_[Count_ - 1u].Timestamp)
    {
        return;
    }
    if (Count_ == Buffer_.size())
    {
        for (std::size_t I = 1u; I < Buffer_.size(); ++I)
        {
            Buffer_[I - 1u] = Buffer_[I];
        }
        --Count_;
    }
    Buffer_[Count_++] = Keyframe{ TimestampSeconds, Position, Orientation.Normalized(), LinearVelocity, true };
}

void HermitePoseInterpolator::EvaluateAtRenderTime(
    double          RenderClockSeconds,
    Vec3&           OutPosition,
    UnitQuaternion& OutOrientation,
    Vec3&           OutVelocity) const noexcept
{
    if (Count_ == 0u)
    {
        OutPosition    = Vec3{ 0.0f, 0.0f, 0.0f };
        OutOrientation = UnitQuaternion{ 0.0f, 0.0f, 0.0f, 1.0f };
        OutVelocity    = Vec3{ 0.0f, 0.0f, 0.0f };
        return;
    }

    const double TargetTime = RenderClockSeconds - BackoffSeconds_;
    if (Count_ == 1u || TargetTime <= Buffer_[0].Timestamp)
    {
        OutPosition    = Buffer_[0].Position;
        OutOrientation = Buffer_[0].Rotation;
        OutVelocity    = Buffer_[0].Velocity;
        return;
    }

    const Keyframe& Latest = Buffer_[Count_ - 1u];
    if (TargetTime >= Latest.Timestamp)
    {
        const float DtExtrap = static_cast<float>(std::min(0.150, TargetTime - Latest.Timestamp));
        OutPosition    = Latest.Position + Latest.Velocity * DtExtrap;
        OutOrientation = Latest.Rotation;
        OutVelocity    = Latest.Velocity;
        return;
    }

    std::size_t Seg = 0u;
    for (std::size_t I = 0u; I + 1u < Count_; ++I)
    {
        if (TargetTime >= Buffer_[I].Timestamp && TargetTime <= Buffer_[I + 1u].Timestamp)
        {
            Seg = I;
            break;
        }
    }

    const Keyframe& K0 = Buffer_[Seg];
    const Keyframe& K1 = Buffer_[Seg + 1u];
    const float Span   = static_cast<float>(std::max(1.0e-5, K1.Timestamp - K0.Timestamp));
    const float U      = std::clamp(static_cast<float>((TargetTime - K0.Timestamp) / Span), 0.0f, 1.0f);
    const float U2     = U * U;
    const float U3     = U2 * U;

    const float H00 =  2.0f * U3 - 3.0f * U2 + 1.0f;
    const float H10 =         U3 - 2.0f * U2 + U;
    const float H01 = -2.0f * U3 + 3.0f * U2;
    const float H11 =         U3 -        U2;

    OutPosition = Vec3{
        H00 * K0.Position.X + H10 * Span * K0.Velocity.X + H01 * K1.Position.X + H11 * Span * K1.Velocity.X,
        H00 * K0.Position.Y + H10 * Span * K0.Velocity.Y + H01 * K1.Position.Y + H11 * Span * K1.Velocity.Y,
        H00 * K0.Position.Z + H10 * Span * K0.Velocity.Z + H01 * K1.Position.Z + H11 * Span * K1.Velocity.Z
    };
    OutOrientation = SlerpShortestArc(K0.Rotation, K1.Rotation, U);

    const float dH00 = ( 6.0f * U2 - 6.0f * U) / Span;
    const float dH10 = ( 3.0f * U2 - 4.0f * U + 1.0f);
    const float dH01 = (-6.0f * U2 + 6.0f * U) / Span;
    const float dH11 = ( 3.0f * U2 - 2.0f * U);
    OutVelocity = Vec3{
        dH00 * K0.Position.X + dH10 * K0.Velocity.X + dH01 * K1.Position.X + dH11 * K1.Velocity.X,
        dH00 * K0.Position.Y + dH10 * K0.Velocity.Y + dH01 * K1.Position.Y + dH11 * K1.Velocity.Y,
        dH00 * K0.Position.Z + dH10 * K0.Velocity.Z + dH01 * K1.Position.Z + dH11 * K1.Velocity.Z
    };
}

void ClientPredictionReconciler::RecordPredictedTick(
    const NetworkCommandFrame& Command,
    Vec3                       PredictedPos,
    Vec3                       PredictedVel) noexcept
{
    PredictedEntry& Slot = Ring_[Command.Tick % Ring_.size()];
    Slot.Command  = Command;
    Slot.Position = PredictedPos;
    Slot.Velocity = PredictedVel;
    Slot.Occupied = true;
    if (Command.Tick > LatestTick_)
    {
        LatestTick_ = Command.Tick;
    }
}

bool ClientPredictionReconciler::EncodeRedundantCommandPacket(
    std::uint32_t              LatestConfirmedServerTick,
    SequenceAckTracker&        AckTracker,
    std::vector<std::uint8_t>& OutFp1Packet) const
{
    std::vector<NetworkCommandFrame> Frames;
    Frames.reserve(8u);
    const std::uint32_t StartTick = (LatestTick_ > 7u) ? std::max(LatestConfirmedServerTick + 1u, LatestTick_ - 7u) : 1u;
    for (std::uint32_t T = StartTick; T <= LatestTick_; ++T)
    {
        const PredictedEntry& Slot = Ring_[T % Ring_.size()];
        if (Slot.Occupied && Slot.Command.Tick == T)
        {
            Frames.push_back(Slot.Command);
        }
    }

    constexpr std::size_t CmdStride = 20u;
    std::vector<std::uint8_t> Body(1u + Frames.size() * CmdStride, 0u);
    Body[0] = static_cast<std::uint8_t>(Frames.size());
    for (std::size_t I = 0u; I < Frames.size(); ++I)
    {
        std::uint8_t* C = Body.data() + 1u + I * CmdStride;
        WriteU32Be(C + 0u,  Frames[I].Tick);
        WriteF32Le(C + 4u,  Frames[I].MoveForward);
        WriteF32Le(C + 8u,  Frames[I].MoveLateral);
        WriteF32Le(C + 12u, Frames[I].LookYawRadians);
        WriteU32Be(C + 16u, Frames[I].ActionBitmask);
    }

    const ReliabilityEnvelope Env = AckTracker.PrepareOutgoingEnvelope(LatestTick_, LatestConfirmedServerTick);
    return Fp1WireFrameCodec::EncodeFrame(Fp1WireChannel::CommandStream, Env, Body.data(), Body.size(), OutFp1Packet);
}

bool ClientPredictionReconciler::DecodeCommandPacket(
    const std::uint8_t*               Fp1Bytes,
    std::size_t                       Fp1Length,
    double                            ArrivalTimeSeconds,
    SequenceAckTracker&               AckTracker,
    std::vector<NetworkCommandFrame>& OutCommands)
{
    Fp1WireChannel      Channel{};
    ReliabilityEnvelope Env{};
    const std::uint8_t* Body   = nullptr;
    std::size_t         Length = 0u;
    if (!Fp1WireFrameCodec::DecodeFrame(Fp1Bytes, Fp1Length, Channel, Env, Body, Length) ||
        Channel != Fp1WireChannel::CommandStream || Length < 1u)
    {
        return false;
    }

    constexpr std::size_t CmdStride = 20u;
    const std::size_t Count = Body[0];
    if (1u + Count * CmdStride != Length)
    {
        return false;
    }

    AckTracker.RecordIncomingEnvelope(Env, ArrivalTimeSeconds);
    OutCommands.resize(Count);
    for (std::size_t I = 0u; I < Count; ++I)
    {
        const std::uint8_t* C = Body + 1u + I * CmdStride;
        OutCommands[I].Tick           = ReadU32Be(C + 0u);
        OutCommands[I].MoveForward    = ReadF32Le(C + 4u);
        OutCommands[I].MoveLateral    = ReadF32Le(C + 8u);
        OutCommands[I].LookYawRadians = ReadF32Le(C + 12u);
        OutCommands[I].ActionBitmask  = ReadU32Be(C + 16u);
    }
    return true;
}

bool ClientPredictionReconciler::ReconcileAuthoritativePose(
    std::uint32_t              ServerTick,
    Vec3                       AuthoritativePos,
    Vec3                       AuthoritativeVel,
    float                      FixedStepSeconds,
    float                      ErrorThresholdMetres,
    const DeterministicStepFn& StepCallback,
    Vec3&                      OutCorrectedPos,
    Vec3&                      OutCorrectedVel)
{
    const PredictedEntry& Historical = Ring_[ServerTick % Ring_.size()];
    if (!Historical.Occupied || Historical.Command.Tick != ServerTick)
    {
        OutCorrectedPos = AuthoritativePos;
        OutCorrectedVel = AuthoritativeVel;
        return false;
    }

    const Vec3 Delta = AuthoritativePos - Historical.Position;
    if (Dot(Delta, Delta) <= (ErrorThresholdMetres * ErrorThresholdMetres))
    {
        const PredictedEntry& Latest = Ring_[LatestTick_ % Ring_.size()];
        OutCorrectedPos = Latest.Position;
        OutCorrectedVel = Latest.Velocity;
        return false;
    }

    ++ReplayCounter_;
    Vec3 Pos = AuthoritativePos;
    Vec3 Vel = AuthoritativeVel;
    Ring_[ServerTick % Ring_.size()].Position = Pos;
    Ring_[ServerTick % Ring_.size()].Velocity = Vel;

    for (std::uint32_t T = ServerTick + 1u; T <= LatestTick_; ++T)
    {
        PredictedEntry& Slot = Ring_[T % Ring_.size()];
        if (Slot.Occupied && Slot.Command.Tick == T)
        {
            StepCallback(Pos, Vel, Slot.Command, FixedStepSeconds);
            Slot.Position = Pos;
            Slot.Velocity = Vel;
        }
    }

    OutCorrectedPos = Pos;
    OutCorrectedVel = Vel;
    return true;
}

} // namespace Frontier::Networking
