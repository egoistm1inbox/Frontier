#include "Frontier/Engine/Rendering/VisualEffects/EffectSpace.h"

#include <cmath>
#include <cstdio>
#include <filesystem>
#include <limits>
#include <string>

namespace
{
int Checks = 0;
int Failures = 0;

void Confirm(bool Condition, const char* Message)
{
    ++Checks;
    if (!Condition)
    {
        ++Failures;
        std::fprintf(stderr, "[FAIL] %s\n", Message);
    }
}

Frontier::VisualEffectProfile MakeEffect(std::string Identifier, Frontier::VisualEffectKind Kind)
{
    Frontier::VisualEffectProfile Effect;
    Effect.Identifier = std::move(Identifier);
    Effect.Kind = Kind;
    Effect.Spatial.PositionMetres = { 1.0, 2.0, 3.0 };
    Effect.Spatial.Scale = { 4.0, 5.0, 6.0 };
    Effect.Parameters = { 0.25, 0.5, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0 };
    return Effect;
}
} // namespace

int main()
{
    using namespace Frontier;
    std::string Diagnostic;
    EffectSpace Space;
    Space.Effects = {
        MakeEffect("solar-flare", VisualEffectKind::OpticalLensFlare),
        MakeEffect("plume-distortion", VisualEffectKind::HeatDistortion),
        MakeEffect("camera-motion", VisualEffectKind::MotionBlur),
        MakeEffect("impact-shake", VisualEffectKind::CameraImpulseShake),
    };
    Space.Effects.back().Replication.Enabled = true;
    Space.Effects.back().Replication.Authority = ReplicationAuthority::HostAuthoritative;
    Space.Effects.back().Replication.Channel = ReplicationChannel::Impulse;
    Space.Effects.back().Replication.UpdateFrequencyHz = 60.0f;

    Confirm(ValidateEffectSpace(Space, &Diagnostic), "All four effect kinds form a valid declarative effect space");
    std::string Text;
    Confirm(EncodeEffectSpaceText(Space, Text, &Diagnostic), "Effect space encodes with the generic SpaceCodec");
    Confirm(Text.find("frontier.effectspace") != std::string::npos, "Codec writes the .effectspace format tag");
    EffectSpace Decoded;
    Confirm(DecodeEffectSpaceText(Text, Decoded, &Diagnostic), "Effect space decodes after schema and semantic validation");
    Confirm(Decoded.Effects.size() == 4 && Decoded.Effects[0].Kind == VisualEffectKind::OpticalLensFlare &&
            Decoded.Effects[3].Kind == VisualEffectKind::CameraImpulseShake, "Codec preserves all effect categories");
    Confirm(Decoded.Effects[3].Replication.IsActive() && Decoded.Effects[3].Replication.Channel == ReplicationChannel::Impulse &&
            Decoded.Effects[3].Replication.UpdateFrequencyHz == 60.0f, "Per-effect replication profile round-trips");
    Confirm(Decoded.Effects[1].Spatial.PositionMetres == Vec3d{ 1.0, 2.0, 3.0 } &&
            Decoded.Effects[1].Spatial.Scale == Vec3d{ 4.0, 5.0, 6.0 }, "Spatial effect volume round-trips");

    EffectSpace Invalid = Space;
    Invalid.Effects[1].Identifier = Invalid.Effects[0].Identifier;
    Confirm(!ValidateEffectSpace(Invalid, &Diagnostic), "Duplicate effect identifiers are rejected");
    Invalid = Space;
    Invalid.Effects[0].Kind = static_cast<VisualEffectKind>(99);
    Confirm(!ValidateEffectSpace(Invalid, &Diagnostic), "Unknown effect kinds are rejected");
    Invalid = Space;
    Invalid.Effects[0].Parameters[2] = std::numeric_limits<double>::quiet_NaN();
    Confirm(!ValidateEffectSpace(Invalid, &Diagnostic), "Non-finite effect parameters are rejected");
    Invalid = Space;
    Invalid.Effects[0].Spatial.Scale.X = 0.0;
    Confirm(!ValidateEffectSpace(Invalid, &Diagnostic), "Non-positive effect volume scale is rejected");
    Invalid = Space;
    Invalid.Effects[0].Replication.UpdateFrequencyHz = 500.0f;
    Confirm(!ValidateEffectSpace(Invalid, &Diagnostic), "Out-of-range replication rates are rejected");
    Invalid = Space;
    Invalid.Effects[0].Replication.Authority = static_cast<ReplicationAuthority>(99);
    Confirm(!ValidateEffectSpace(Invalid, &Diagnostic), "Unknown replication authority is rejected");
    Invalid = Space;
    Invalid.Effects[0].Replication.Channel = static_cast<ReplicationChannel>(99);
    Confirm(!ValidateEffectSpace(Invalid, &Diagnostic), "Unknown replication channel is rejected");

    EffectSpace Preserve = Space;
    const std::string InvalidKindText =
        "format = \"frontier.effectspace\"\nversion = 1\n\n[[effects]]\nidentifier = \"bad\"\nkind = 99\n"
        "enabled = true\nparameters = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]\n";
    Confirm(!DecodeEffectSpaceText(InvalidKindText, Preserve, &Diagnostic), "Invalid serialized effect kind is refused");
    Confirm(Preserve.Effects.size() == Space.Effects.size(), "Failed decoding leaves the existing effect space unchanged");

    const std::filesystem::path Temp = std::filesystem::temp_directory_path() / "FrontierEffectSpaceValidation.effectspace";
    Confirm(EncodeEffectSpaceFile(Temp, Space, &Diagnostic), "Effect space writes to the dedicated file extension");
    EffectSpace FromFile;
    Confirm(DecodeEffectSpaceFile(Temp, FromFile, &Diagnostic) && FromFile.Effects.size() == Space.Effects.size(),
            "Effect space file round-trips");
    std::filesystem::remove(Temp);
    Confirm(!EncodeEffectSpaceFile(Temp.string() + ".toml", Space, &Diagnostic), "Plain .toml extension is refused");

    std::fprintf(stdout, "EffectSpaceValidation: %d of %d checks passed\n", Checks - Failures, Checks);
    return Failures == 0 ? 0 : 1;
}
