/*==========================================================================================================================================
                                                     REPLICATIONEXTENSION.H
==========================================================================================================================================*/
// 🧩 Engine-wide multiplayer replication: FP1 wire framing, 32-bit ack bitfields, smallest-three quaternions, generic delta snapshots,
//    GRIT 48-byte vehicle quantization, cubic Hermite jitter interpolation, and client-side prediction/reconciliation.

#pragma once

#include "Engine/Foundation/Math.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <vector>

namespace Frontier::Networking
{

//------------------------------------------------------------------------------------------------------------------------
//                                             NETWORK ROTATION QUATERNION
//------------------------------------------------------------------------------------------------------------------------

struct UnitQuaternion
{
    float X = 0.0f;
    float Y = 0.0f;
    float Z = 0.0f;
    float W = 1.0f;

    [[nodiscard]] UnitQuaternion Normalized() const noexcept
    {
        const float Len = std::sqrt(X * X + Y * Y + Z * Z + W * W);
        return (Len > 1.0e-7f)
            ? UnitQuaternion{ X / Len, Y / Len, Z / Len, W / Len }
            : UnitQuaternion{ 0.0f, 0.0f, 0.0f, 1.0f };
    }

    [[nodiscard]] static UnitQuaternion FromAxisAngle(Vec3 Axis, float Radians) noexcept
    {
        const Vec3  N = Normalise(Axis);
        const float H = 0.5f * Radians;
        const float S = std::sin(H);
        return UnitQuaternion{ N.X * S, N.Y * S, N.Z * S, std::cos(H) }.Normalized();
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                  FP1 WIRE FRAMING & RELIABILITY SEQUENCE HEADER
//------------------------------------------------------------------------------------------------------------------------

// Matches Project-Networking TransportCodec.h ('F' 'P' '1' | WireVersion=1 | Channel u8 | Length u16BE).
enum class Fp1WireChannel : std::uint8_t
{
    HandshakeProbe = 0,
    WorldSnapshot  = 1,
    CommandStream  = 2
};

struct ReliabilityEnvelope
{
    std::uint16_t LocalSequence      = 0u; // [-] monotonically wrapping packet sequence
    std::uint16_t RemoteAckSequence  = 0u; // [-] highest remote sequence received
    std::uint32_t RemoteAckBitfield  = 0u; // [-] bit k = 1 iff (RemoteAckSequence - 1 - k) was received
    std::uint32_t SimulationTick     = 0u; // [-] authoritative or client simulation tick
    std::uint32_t BaselineTick       = 0u; // [-] 0 = full keyframe; >0 = delta against confirmed tick
};

class Fp1WireFrameCodec
{
public:
    static constexpr std::uint8_t WireVersion     = 1u;
    static constexpr std::size_t  Fp1HeaderBytes  = 7u;
    static constexpr std::size_t  EnvelopeBytes   = 16u;
    static constexpr std::size_t  MaxPayloadBytes = 4096u;
    static constexpr std::size_t  MaxPacketBytes  = Fp1HeaderBytes + MaxPayloadBytes;

    [[nodiscard]] static bool EncodeFrame(
        Fp1WireChannel              Channel,
        const ReliabilityEnvelope&  Envelope,
        const std::uint8_t*         BodyBytes,
        std::size_t                 BodyLength,
        std::vector<std::uint8_t>&  OutWirePacket);

    [[nodiscard]] static bool DecodeFrame(
        const std::uint8_t*         WireBytes,
        std::size_t                 WireLength,
        Fp1WireChannel&             OutChannel,
        ReliabilityEnvelope&        OutEnvelope,
        const std::uint8_t*&        OutBodyBytes,
        std::size_t&                OutBodyLength) noexcept;
};

class SequenceAckTracker
{
public:
    ReliabilityEnvelope PrepareOutgoingEnvelope(std::uint32_t SimulationTick, std::uint32_t BaselineTick) noexcept;
    void RecordIncomingEnvelope(const ReliabilityEnvelope& Incoming, double ArrivalTimeSeconds) noexcept;

    [[nodiscard]] std::uint32_t HighestConfirmedBaselineTick() const noexcept { return ConfirmedBaselineTick_; }
    [[nodiscard]] double SmoothedRoundTripMillis() const noexcept             { return SmoothedRttMillis_; }
    [[nodiscard]] double PacketLossFraction() const noexcept                  { return LossFraction_; }
    [[nodiscard]] std::uint32_t ConfirmedPacketCount() const noexcept         { return ConfirmedCount_; }

private:
    struct SentRecord
    {
        std::uint16_t Sequence      = 0u;
        std::uint32_t Tick          = 0u;
        double        SentTimeSec   = 0.0;
        bool          Occupied      = false;
        bool          Acknowledged  = false;
    };

    std::array<SentRecord, 128> SentWindow_{};
    std::uint16_t               NextOutgoingSequence_  = 1u;
    std::uint16_t               HighestRemoteSequence_ = 0u;
    std::uint32_t               RemoteReceiveBitfield_ = 0u;
    bool                        RemoteInitialized_     = false;
    std::uint32_t               ConfirmedBaselineTick_ = 0u;
    std::uint32_t               ConfirmedCount_        = 0u;
    double                      SmoothedRttMillis_     = 25.0;
    double                      LossFraction_          = 0.0;
};

//------------------------------------------------------------------------------------------------------------------------
//                           SMALLEST-THREE 32-BIT QUATERNION & 48-BYTE GRIT VEHICLE CODEC
//------------------------------------------------------------------------------------------------------------------------

[[nodiscard]] std::uint32_t  PackSmallestThreeQuaternion(const UnitQuaternion& Rotation) noexcept;
[[nodiscard]] UnitQuaternion UnpackSmallestThreeQuaternion(std::uint32_t Packed) noexcept;

#pragma pack(push, 1)
struct CompactVehicleWireRecord
{
    std::uint32_t ObjectIdentifier         = 0u;            // [4B]  unique networked vehicle token
    float         PositionX                = 0.0f;          // [4B]  world X [m]
    float         PositionY                = 0.0f;          // [4B]  world Y [m]
    float         PositionZ                = 0.0f;          // [4B]  world Z [m]
    std::uint32_t PackedOrientation        = 0u;            // [4B]  smallest-three quaternion (<0.08 deg error)
    std::int16_t  LinearVelCentimetresS[3] = { 0, 0, 0 };   // [6B]  [-327.67..+327.67 m/s] @ 0.01 m/s precision
    std::int16_t  AngularVelMilliradS[3]   = { 0, 0, 0 };   // [6B]  [-163.8..+163.8 rad/s] @ 0.005 rad/s precision
    std::uint8_t  SuspensionDeflection[4]  = { 0, 0, 0, 0 };// [4B]  [0..0.50 m] @ 2 mm precision
    std::int8_t   WheelSpinHalfRadS[4]     = { 0, 0, 0, 0 };// [4B]  [-254..+254 rad/s] @ 2 rad/s step
    std::int8_t   SteeringQuantized        = 0;             // [1B]  [-1..+1]
    std::uint8_t  ThrottleQuantized        = 0u;            // [1B]  [0..1]
    std::uint8_t  BrakeQuantized           = 0u;            // [1B]  [0..1]
    std::uint8_t  GearAndIgnitionBits      = 0u;            // [1B]  low 4 bits = gear+2, bit4 = N2O, bit5..6 = smoke/fire
    std::uint8_t  BoostTenthsBar           = 0u;            // [1B]  [0..25.5 bar] @ 0.1 bar
    std::uint8_t  FuelOrSocPercent         = 100u;          // [1B]  [0..100 %]
    std::uint16_t EngineHectoRpm           = 9u;            // [2B]  RPM / 10 (0..655,350 RPM)
};
#pragma pack(pop)

static_assert(sizeof(CompactVehicleWireRecord) == 48u, "GRIT P2P compact vehicle wire record must equal exactly 48 bytes.");

struct DecodedVehicleReplicationSample
{
    std::uint32_t        ObjectIdentifier      = 0u;
    Vec3                 Position              = { 0.0f, 0.0f, 0.0f };
    UnitQuaternion       Orientation           = { 0.0f, 0.0f, 0.0f, 1.0f };
    Vec3                 LinearVelocity        = { 0.0f, 0.0f, 0.0f };
    Vec3                 AngularVelocity       = { 0.0f, 0.0f, 0.0f };
    std::array<float, 4> SuspensionDeflectionM = { 0.0f, 0.0f, 0.0f, 0.0f };
    std::array<float, 4> WheelSpinRadSec       = { 0.0f, 0.0f, 0.0f, 0.0f };
    float                Steering              = 0.0f;
    float                Throttle              = 0.0f;
    float                Brake                 = 0.0f;
    int                  GearNumber            = 1;
    bool                 AdditiveActive        = false;
    bool                 SmokingActive         = false;
    bool                 TyreIgnited           = false;
    float                ManifoldBoostBar      = 0.0f;
    float                EnergyReservePercent  = 100.0f;
    float                EngineRpm             = 900.0f;
};

[[nodiscard]] CompactVehicleWireRecord        QuantizeVehicleSample(const DecodedVehicleReplicationSample& Sample) noexcept;
[[nodiscard]] DecodedVehicleReplicationSample DequantizeVehicleSample(const CompactVehicleWireRecord& Wire) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                           GENRE-AGNOSTIC DELTA SNAPSHOT WORLD REPLICATION REGISTRY
//------------------------------------------------------------------------------------------------------------------------

struct ReplicatedObjectDescriptor
{
    std::uint32_t        ObjectIdentifier    = 0u;
    std::uint16_t        ArchetypeIdentifier = 0u;
    std::uint16_t        OwnerPeerOrdinal    = 0u;
    Vec3                 Position            = { 0.0f, 0.0f, 0.0f };
    UnitQuaternion       Orientation         = { 0.0f, 0.0f, 0.0f, 1.0f };
    Vec3                 LinearVelocity      = { 0.0f, 0.0f, 0.0f };
    std::array<float, 4> CustomChannels      = { 0.0f, 0.0f, 0.0f, 0.0f };
    float                InterestRadiusM     = 250.0f;
};

class WorldReplicationRegistry
{
public:
    static constexpr std::size_t MaxHistorySnapshots = 32u;

    void UpsertObject(const ReplicatedObjectDescriptor& Object);
    void RemoveObject(std::uint32_t ObjectIdentifier) noexcept;
    void CaptureTickSnapshot(std::uint32_t SimulationTick);

    [[nodiscard]] bool BuildDeltaSnapshotPacket(
        std::uint32_t               SimulationTick,
        std::uint32_t               BaselineTick,
        Vec3                        ObserverPosition,
        SequenceAckTracker&         AckTracker,
        std::vector<std::uint8_t>&  OutFp1Packet,
        std::uint32_t&              OutEncodedObjectCount);

    [[nodiscard]] bool ApplyIncomingSnapshotPacket(
        const std::uint8_t*         Fp1Bytes,
        std::size_t                 Fp1Length,
        double                      ArrivalTimeSeconds,
        SequenceAckTracker&         AckTracker,
        std::uint32_t&              OutSimulationTick);

    [[nodiscard]] const std::vector<ReplicatedObjectDescriptor>& Objects() const noexcept { return CurrentObjects_; }
    [[nodiscard]] const ReplicatedObjectDescriptor* FindObject(std::uint32_t ObjectIdentifier) const noexcept;

private:
    struct HistoricalTickEntry
    {
        std::uint32_t                           Tick = 0u;
        std::vector<ReplicatedObjectDescriptor> Objects;
    };

    std::vector<ReplicatedObjectDescriptor>              CurrentObjects_;
    std::array<HistoricalTickEntry, MaxHistorySnapshots> History_{};
    std::size_t                                          HistoryWriteSlot_ = 0u;
};

//------------------------------------------------------------------------------------------------------------------------
//                          CUBIC HERMITE JITTER-BUFFERED INTERPOLATION & CLIENT PREDICTION
//------------------------------------------------------------------------------------------------------------------------

class HermitePoseInterpolator
{
public:
    explicit HermitePoseInterpolator(double InterpolationBackoffSeconds = 0.065) noexcept
        : BackoffSeconds_(InterpolationBackoffSeconds) {}

    void PushTimedSample(double TimestampSeconds, Vec3 Position, UnitQuaternion Orientation, Vec3 LinearVelocity) noexcept;
    void EvaluateAtRenderTime(
        double          RenderClockSeconds,
        Vec3&           OutPosition,
        UnitQuaternion& OutOrientation,
        Vec3&           OutVelocity) const noexcept;

private:
    struct Keyframe
    {
        double         Timestamp = 0.0;
        Vec3           Position  = { 0.0f, 0.0f, 0.0f };
        UnitQuaternion Rotation  = { 0.0f, 0.0f, 0.0f, 1.0f };
        Vec3           Velocity  = { 0.0f, 0.0f, 0.0f };
        bool           Valid     = false;
    };

    std::array<Keyframe, 16> Buffer_{};
    std::size_t              Count_          = 0u;
    double                   BackoffSeconds_ = 0.065;
};

struct NetworkCommandFrame
{
    std::uint32_t Tick            = 0u;
    float         MoveForward     = 0.0f;
    float         MoveLateral     = 0.0f;
    float         LookYawRadians  = 0.0f;
    std::uint32_t ActionBitmask   = 0u;
};

class ClientPredictionReconciler
{
public:
    using DeterministicStepFn = std::function<void(Vec3& InOutPos, Vec3& InOutVel, const NetworkCommandFrame& Cmd, float Dt)>;

    void RecordPredictedTick(const NetworkCommandFrame& Command, Vec3 PredictedPos, Vec3 PredictedVel) noexcept;

    [[nodiscard]] bool EncodeRedundantCommandPacket(
        std::uint32_t              LatestConfirmedServerTick,
        SequenceAckTracker&        AckTracker,
        std::vector<std::uint8_t>& OutFp1Packet) const;

    [[nodiscard]] static bool DecodeCommandPacket(
        const std::uint8_t*               Fp1Bytes,
        std::size_t                       Fp1Length,
        double                            ArrivalTimeSeconds,
        SequenceAckTracker&               AckTracker,
        std::vector<NetworkCommandFrame>& OutCommands);

    bool ReconcileAuthoritativePose(
        std::uint32_t              ServerTick,
        Vec3                       AuthoritativePos,
        Vec3                       AuthoritativeVel,
        float                      FixedStepSeconds,
        float                      ErrorThresholdMetres,
        const DeterministicStepFn& StepCallback,
        Vec3&                      OutCorrectedPos,
        Vec3&                      OutCorrectedVel);

    [[nodiscard]] std::uint32_t ReconciliationReplayCount() const noexcept { return ReplayCounter_; }

private:
    struct PredictedEntry
    {
        NetworkCommandFrame Command{};
        Vec3                Position = { 0.0f, 0.0f, 0.0f };
        Vec3                Velocity = { 0.0f, 0.0f, 0.0f };
        bool                Occupied = false;
    };

    std::array<PredictedEntry, 128> Ring_{};
    std::uint32_t                   LatestTick_    = 0u;
    std::uint32_t                   ReplayCounter_ = 0u;
};

} // namespace Frontier::Networking
