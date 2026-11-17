/*============================================================================================================================================
                                                           QUADRATURESEQUENCE.H
============================================================================================================================================*/
// 🧩 Fixed Owen-scrambled Sobol' (0,2) quadrature sequence pairs matching Experimental/DeterministicPathTracer/Source/QuadratureSequence.wgsl

#pragma once

#include <cstdint>
#include <utility>

namespace Frontier::Mathematics
{

[[nodiscard]] constexpr uint32_t AvalancheKey(uint32_t Input) noexcept
{
    uint32_t Mixed = Input;
    Mixed ^= Mixed >> 16u;
    Mixed *= 0x7feb352du;
    Mixed ^= Mixed >> 15u;
    Mixed *= 0x846ca68bu;
    Mixed ^= Mixed >> 16u;
    return Mixed;
}

[[nodiscard]] constexpr uint32_t ReverseBits32(uint32_t X) noexcept
{
    X = ((X & 0x55555555u) << 1u) | ((X & 0xaaaaaaaau) >> 1u);
    X = ((X & 0x33333333u) << 2u) | ((X & 0xccccccccu) >> 2u);
    X = ((X & 0x0f0f0f0fu) << 4u) | ((X & 0xf0f0f0f0u) >> 4u);
    X = ((X & 0x00ff00ffu) << 8u) | ((X & 0xff00ff00u) >> 8u);
    return (X << 16u) | (X >> 16u);
}

[[nodiscard]] constexpr uint32_t LaineKarrasPermutation(uint32_t Input, uint32_t Key) noexcept
{
    uint32_t Permuted = Input + Key;
    Permuted ^= Permuted * 0x6c50b47cu;
    Permuted ^= Permuted * 0xb82f1e52u;
    Permuted ^= Permuted * 0xc7afe638u;
    Permuted ^= Permuted * 0x8d22f6e6u;
    return Permuted;
}

[[nodiscard]] constexpr uint32_t NestedDigitPermutation(uint32_t Input, uint32_t Key) noexcept
{
    return ReverseBits32(LaineKarrasPermutation(ReverseBits32(Input), Key));
}

[[nodiscard]] constexpr uint32_t SobolSecondDimension(uint32_t Index) noexcept
{
    uint32_t Bits = Index;
    Bits ^= (Bits & 0xaaaaaaaau) >> 1u;
    Bits ^= (Bits & 0xccccccccu) >> 2u;
    Bits ^= (Bits & 0xf0f0f0f0u) >> 4u;
    Bits ^= (Bits & 0xff00ff00u) >> 8u;
    Bits ^= (Bits & 0xffff0000u) >> 16u;
    return ReverseBits32(Bits);
}

[[nodiscard]] inline std::pair<float, float> ScrambledQuadraturePair(
    uint32_t SampleIndex,
    uint32_t PairIndex,
    uint32_t PixelKey,
    uint32_t ShiftX = 0u,
    uint32_t ShiftY = 0u) noexcept
{
    const uint32_t PairKey       = AvalancheKey(PairIndex * 0x9e3779b9u + 0x85ebca6bu) ^ PixelKey;
    const uint32_t ShuffledIndex = NestedDigitPermutation(SampleIndex, PairKey);
    const uint32_t FirstDigits   = NestedDigitPermutation(ReverseBits32(ShuffledIndex), AvalancheKey(PairKey ^ 0xa511e9b3u));
    const uint32_t SecondDigits  = NestedDigitPermutation(SobolSecondDimension(ShuffledIndex), AvalancheKey(PairKey ^ 0x63d83595u));
    return {
        static_cast<float>((FirstDigits ^ ShiftX) >> 8u) * (1.0f / 16777216.0f),
        static_cast<float>((SecondDigits ^ ShiftY) >> 8u) * (1.0f / 16777216.0f)
    };
}

} // namespace Frontier::Mathematics
