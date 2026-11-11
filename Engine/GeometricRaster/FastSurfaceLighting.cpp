/*============================================================================================================================================
                                                 FASTSURFACELIGHTING.CPP
============================================================================================================================================*/
// 🧩 CPU reference calculations that remain numerically aligned with SurfaceLighting.slang for deterministic validation

#include "Engine/GeometricRaster/FastSurfaceLighting.h"

#include <algorithm>
#include <cmath>
#include <numbers>

namespace Frontier::GeometricRaster
{

namespace
{

[[nodiscard]] ViewVector3 Normalize(ViewVector3 Vector) noexcept
{
    const float Length = std::sqrt(Vector.X * Vector.X + Vector.Y * Vector.Y + Vector.Z * Vector.Z);
    if (Length <= 0.000001f)
    {
        return { 0.0f, 0.0f, 1.0f };
    }

    return { Vector.X / Length, Vector.Y / Length, Vector.Z / Length };
}

[[nodiscard]] float Dot(ViewVector3 First, ViewVector3 Second) noexcept
{
    return First.X * Second.X + First.Y * Second.Y + First.Z * Second.Z;
}

[[nodiscard]] UVSpace::ColorTriplet Add(UVSpace::ColorTriplet First, UVSpace::ColorTriplet Second) noexcept
{
    return { First.Red + Second.Red, First.Green + Second.Green, First.Blue + Second.Blue };
}

[[nodiscard]] UVSpace::ColorTriplet Multiply(UVSpace::ColorTriplet First, UVSpace::ColorTriplet Second) noexcept
{
    return { First.Red * Second.Red, First.Green * Second.Green, First.Blue * Second.Blue };
}

[[nodiscard]] UVSpace::ColorTriplet Scale(UVSpace::ColorTriplet Colour, float Scalar) noexcept
{
    return { Colour.Red * Scalar, Colour.Green * Scalar, Colour.Blue * Scalar };
}

[[nodiscard]] UVSpace::ColorTriplet Interpolate(
    UVSpace::ColorTriplet First,
    UVSpace::ColorTriplet Second,
    float                  Ratio) noexcept
{
    const float ClampedRatio = std::clamp(Ratio, 0.0f, 1.0f);
    return {
        First.Red + (Second.Red - First.Red) * ClampedRatio,
        First.Green + (Second.Green - First.Green) * ClampedRatio,
        First.Blue + (Second.Blue - First.Blue) * ClampedRatio,
    };
}

[[nodiscard]] UVSpace::ColorTriplet StackColour(
    UVSpace::ColorTriplet            Accumulated,
    UVSpace::ColorTriplet            Foreground,
    float                            Opacity,
    UVSpace::MatcapStackMethod       Method) noexcept
{
    const float ClampedOpacity = std::clamp(Opacity, 0.0f, 1.0f);
    switch (Method)
    {
    case UVSpace::MatcapStackMethod::Over:
        return Interpolate(Accumulated, Foreground, ClampedOpacity);
    case UVSpace::MatcapStackMethod::Additive:
        return Add(Accumulated, Scale(Foreground, ClampedOpacity));
    case UVSpace::MatcapStackMethod::Multiply:
        return Multiply(Accumulated, Interpolate({ 1.0f, 1.0f, 1.0f }, Foreground, ClampedOpacity));
    }

    return Accumulated;
}

[[nodiscard]] UVSpace::ColorTriplet EvaluateAppearanceRadiance(
    const SurfaceLightingSample&        LightingSample,
    const UVSpace::SurfaceAppearance&   Appearance,
    ViewVector3                          Normal,
    ViewVector3                          Viewer,
    ViewVector3                          Light,
    std::span<const UVSpace::ColorTriplet> MatcapImageColours) noexcept
{
    const float LambertTerm = std::max(0.0f, Dot(Normal, Light));
    const float Visibility = 1.0f + (LightingSample.ShadowVisibility - 1.0f) *
                                         std::clamp(Appearance.ShadowInfluence, 0.0f, 1.0f);
    const float GlossExponent = std::clamp(Appearance.GlossExponent, 1.0f, 1024.0f);
    const ViewVector3 HalfVector = Normalize({ Light.X + Viewer.X, Light.Y + Viewer.Y, Light.Z + Viewer.Z });
    const float BlinnTerm = LambertTerm > 0.0f
                                ? std::pow(std::max(0.0f, Dot(Normal, HalfVector)), GlossExponent)
                                : 0.0f;
    const float BlinnNormalization = (GlossExponent + 8.0f) / (8.0f * std::numbers::pi_v<float>);

    const UVSpace::ColorTriplet DirectDiffuse = Scale(LightingSample.DirectionalIlluminance, LambertTerm * Visibility);
    const UVSpace::ColorTriplet DiffuseRadiance = Multiply(
        Appearance.DiffuseReflectance,
        Add(LightingSample.AmbientIlluminance, DirectDiffuse));
    const UVSpace::ColorTriplet SpecularRadiance = Multiply(
        Appearance.SpecularReflectance,
        Scale(LightingSample.DirectionalIlluminance, BlinnTerm * BlinnNormalization * Visibility));
    UVSpace::ColorTriplet AppearanceRadiance = Add(DiffuseRadiance, SpecularRadiance);

    if (Appearance.MatcapImageIndex < MatcapImageColours.size() && Appearance.MatcapOpacity > 0.0f)
    {
        AppearanceRadiance = StackColour(
            AppearanceRadiance,
            MatcapImageColours[Appearance.MatcapImageIndex],
            Appearance.MatcapOpacity,
            Appearance.MatcapStack);
    }

    return AppearanceRadiance;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                             FAST SURFACE LIGHTING QUERIES
//------------------------------------------------------------------------------------------------------------------------

MatcapTextureCoordinate ConstructMatcapTextureCoordinate(ViewVector3 NormalInViewSpace) noexcept
{
    const ViewVector3 Normal = Normalize(NormalInViewSpace);
    const float Denominator  = 2.0f * std::sqrt(std::max(0.0001f, Normal.Z + 1.0f));
    return {
        .U = std::clamp(Normal.X / Denominator + 0.5f, 0.0f, 1.0f),
        .V = std::clamp(Normal.Y / Denominator + 0.5f, 0.0f, 1.0f),
    };
}

SurfaceLightingResult EvaluateFastSurfaceLighting(
    const SurfaceLightingSample&                    LightingSample,
    std::span<const UVSpace::SurfaceAppearance>     OrderedAppearances,
    std::span<const UVSpace::ColorTriplet>          MatcapImageColours) noexcept
{
    const ViewVector3 Normal = Normalize(LightingSample.NormalInViewSpace);
    const ViewVector3 Viewer = Normalize(LightingSample.ViewerVector);
    const ViewVector3 Light  = Normalize(LightingSample.LightVector);

    SurfaceLightingResult Result{};
    Result.MatcapCoordinate = ConstructMatcapTextureCoordinate(Normal);

    for (std::size_t AppearanceIndex = 0u; AppearanceIndex < OrderedAppearances.size(); ++AppearanceIndex)
    {
        const UVSpace::SurfaceAppearance& Appearance = OrderedAppearances[AppearanceIndex];
        const UVSpace::ColorTriplet AppearanceRadiance = EvaluateAppearanceRadiance(
            LightingSample,
            Appearance,
            Normal,
            Viewer,
            Light,
            MatcapImageColours);
        Result.Radiance = StackColour(
            Result.Radiance,
            AppearanceRadiance,
            Appearance.LayerOpacity,
            AppearanceIndex == 0u ? UVSpace::MatcapStackMethod::Over : Appearance.LayerStack);
    }

    return Result;
}

} // namespace Frontier::GeometricRaster
