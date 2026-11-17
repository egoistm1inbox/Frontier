/*==========================================================================================================================================
                                                             EFFECTSPACE.H
==========================================================================================================================================*/
// 🧩 Declarative, spatially scoped visual-effect profiles and the `.effectspace` container codec.
//    This is the data/configuration layer; it does not claim a GPU effect sequence or render-target integration.

#pragma once

#include "Frontier/Engine/Scene/Profiles/ProfileSchemas.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace Frontier
{

enum class VisualEffectKind : uint32_t
{
    OpticalLensFlare = 0,
    HeatDistortion = 1,
    MotionBlur = 2,
    CameraImpulseShake = 3,
};

struct VisualEffectProfile
{
    std::string Identifier{};
    VisualEffectKind Kind = VisualEffectKind::HeatDistortion;
    bool Enabled = true;
    SpatialProfile Spatial{};
    ReplicationProfile Replication{};
    std::array<double, 8> Parameters{};
};

struct EffectSpace
{
    std::vector<VisualEffectProfile> Effects{};
};

template <>
struct SpaceSchema<VisualEffectProfile>
{
    static constexpr auto Bindings() noexcept
    {
        return std::make_tuple(
            MakeFieldBinding("identifier", &VisualEffectProfile::Identifier),
            MakeFieldBinding("kind", &VisualEffectProfile::Kind),
            MakeFieldBinding("enabled", &VisualEffectProfile::Enabled),
            MakeFieldBinding("spatial", &VisualEffectProfile::Spatial),
            MakeFieldBinding("replication", &VisualEffectProfile::Replication),
            MakeFieldBinding("parameters", &VisualEffectProfile::Parameters));
    }
};

template <>
struct SpaceSchema<EffectSpace>
{
    static constexpr auto Bindings() noexcept
    {
        return std::make_tuple(MakeFieldBinding("effects", &EffectSpace::Effects));
    }
};

[[nodiscard]] inline bool ValidateEffectSpace(const EffectSpace& Space, std::string* OutDiagnostic = nullptr)
{
    if (Space.Effects.size() > 4096)
    {
        if (OutDiagnostic != nullptr) *OutDiagnostic = "Effect space may contain at most 4096 profiles";
        return false;
    }
    std::vector<std::string_view> Identifiers;
    Identifiers.reserve(Space.Effects.size());
    for (const VisualEffectProfile& Effect : Space.Effects)
    {
        if (Effect.Identifier.empty())
        {
            if (OutDiagnostic != nullptr) *OutDiagnostic = "Visual-effect identifiers must not be empty";
            return false;
        }
        if (std::find(Identifiers.begin(), Identifiers.end(), Effect.Identifier) != Identifiers.end())
        {
            if (OutDiagnostic != nullptr) *OutDiagnostic = "Visual-effect identifiers must be unique";
            return false;
        }
        Identifiers.push_back(Effect.Identifier);
        switch (Effect.Kind)
        {
            case VisualEffectKind::OpticalLensFlare:
            case VisualEffectKind::HeatDistortion:
            case VisualEffectKind::MotionBlur:
            case VisualEffectKind::CameraImpulseShake: break;
            default:
                if (OutDiagnostic != nullptr) *OutDiagnostic = "Visual-effect kind is not supported";
                return false;
        }
        if (!std::isfinite(Effect.Spatial.PositionMetres.X) || !std::isfinite(Effect.Spatial.PositionMetres.Y) ||
            !std::isfinite(Effect.Spatial.PositionMetres.Z) || !std::isfinite(Effect.Spatial.OrientationDegrees.X) ||
            !std::isfinite(Effect.Spatial.OrientationDegrees.Y) || !std::isfinite(Effect.Spatial.OrientationDegrees.Z) ||
            !std::isfinite(Effect.Spatial.Scale.X) || !std::isfinite(Effect.Spatial.Scale.Y) ||
            !std::isfinite(Effect.Spatial.Scale.Z) || Effect.Spatial.Scale.X <= 0.0 || Effect.Spatial.Scale.Y <= 0.0 ||
            Effect.Spatial.Scale.Z <= 0.0)
        {
            if (OutDiagnostic != nullptr) *OutDiagnostic = "Visual-effect spatial profile must be finite and have positive scale";
            return false;
        }
        for (double Parameter : Effect.Parameters)
        {
            if (!std::isfinite(Parameter))
            {
                if (OutDiagnostic != nullptr) *OutDiagnostic = "Visual-effect parameters must be finite";
                return false;
            }
        }
        if (!std::isfinite(Effect.Replication.UpdateFrequencyHz) || Effect.Replication.UpdateFrequencyHz < 1.0f ||
            Effect.Replication.UpdateFrequencyHz > 240.0f)
        {
            if (OutDiagnostic != nullptr) *OutDiagnostic = "Visual-effect replication rate must be within 1 to 240 Hz";
            return false;
        }
        switch (Effect.Replication.Authority)
        {
            case ReplicationAuthority::Disabled:
            case ReplicationAuthority::HostAuthoritative:
            case ReplicationAuthority::InterpolatedProxy:
            case ReplicationAuthority::OwnerCommand: break;
            default:
                if (OutDiagnostic != nullptr) *OutDiagnostic = "Visual-effect replication authority is not supported";
                return false;
        }
        switch (Effect.Replication.Channel)
        {
            case ReplicationChannel::State:
            case ReplicationChannel::Transform:
            case ReplicationChannel::Impulse:
            case ReplicationChannel::Stream: break;
            default:
                if (OutDiagnostic != nullptr) *OutDiagnostic = "Visual-effect replication channel is not supported";
                return false;
        }
    }
    return true;
}

[[nodiscard]] inline bool EncodeEffectSpaceText(const EffectSpace& Space, std::string& OutText,
                                                 std::string* OutDiagnostic = nullptr)
{
    if (!ValidateEffectSpace(Space, OutDiagnostic)) return false;
    return EncodeSpaceText("frontier.effectspace", 1, Space, OutText);
}

[[nodiscard]] inline bool DecodeEffectSpaceText(std::string_view Text, EffectSpace& OutSpace,
                                                 std::string* OutDiagnostic = nullptr)
{
    EffectSpace Decoded;
    if (!DecodeSpaceText(Text, "frontier.effectspace", 1, Decoded, OutDiagnostic)) return false;
    if (!ValidateEffectSpace(Decoded, OutDiagnostic)) return false;
    OutSpace = std::move(Decoded);
    return true;
}

[[nodiscard]] inline bool EncodeEffectSpaceFile(const std::filesystem::path& Path, const EffectSpace& Space,
                                                 std::string* OutDiagnostic = nullptr)
{
    if (!ValidateEffectSpace(Space, OutDiagnostic)) return false;
    return EncodeSpaceFile(Path, ".effectspace", "frontier.effectspace", 1, Space, OutDiagnostic);
}

[[nodiscard]] inline bool DecodeEffectSpaceFile(const std::filesystem::path& Path, EffectSpace& OutSpace,
                                                 std::string* OutDiagnostic = nullptr)
{
    EffectSpace Decoded;
    if (!DecodeSpaceFile(Path, ".effectspace", "frontier.effectspace", 1, Decoded, OutDiagnostic)) return false;
    if (!ValidateEffectSpace(Decoded, OutDiagnostic)) return false;
    OutSpace = std::move(Decoded);
    return true;
}

} // namespace Frontier
