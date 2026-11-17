/*============================================================================================================================================
                                                      QUADRATURESEQUENCE.SLANG
============================================================================================================================================*/
// 🧩 Fixed Owen-scrambled Sobol' (0,2) pairs matching Experimental/DeterministicPathTracer/Source/QuadratureSequence.wgsl

module QuadratureSequence;

uint AvalancheKey(uint Input)
{
    uint Mixed = Input;
    Mixed ^= Mixed >> 16u;
    Mixed *= 0x7feb352du;
    Mixed ^= Mixed >> 15u;
    Mixed *= 0x846ca68bu;
    Mixed ^= Mixed >> 16u;
    return Mixed;
}

uint LaineKarrasPermutation(uint Input, uint Key)
{
    uint Permuted = Input + Key;
    Permuted ^= Permuted * 0x6c50b47cu;
    Permuted ^= Permuted * 0xb82f1e52u;
    Permuted ^= Permuted * 0xc7afe638u;
    Permuted ^= Permuted * 0x8d22f6e6u;
    return Permuted;
}

uint NestedDigitPermutation(uint Input, uint Key)
{
    return reversebits(LaineKarrasPermutation(reversebits(Input), Key));
}

uint SobolSecondDimension(uint Index)
{
    uint Bits = Index;
    Bits ^= (Bits & 0xaaaaaaaau) >> 1u;
    Bits ^= (Bits & 0xccccccccu) >> 2u;
    Bits ^= (Bits & 0xf0f0f0f0u) >> 4u;
    Bits ^= (Bits & 0xff00ff00u) >> 8u;
    Bits ^= (Bits & 0xffff0000u) >> 16u;
    return reversebits(Bits);
}

float2 ScrambledQuadraturePair(uint SampleIndex, uint PairIndex, uint PixelKey, uint2 DigitShift = uint2(0u, 0u))
{
    uint PairKey       = AvalancheKey(PairIndex * 0x9e3779b9u + 0x85ebca6bu) ^ PixelKey;
    uint ShuffledIndex = NestedDigitPermutation(SampleIndex, PairKey);
    uint FirstDigits   = NestedDigitPermutation(reversebits(ShuffledIndex), AvalancheKey(PairKey ^ 0xa511e9b3u));
    uint SecondDigits  = NestedDigitPermutation(SobolSecondDimension(ShuffledIndex), AvalancheKey(PairKey ^ 0x63d83595u));
    return float2(float((FirstDigits ^ DigitShift.x) >> 8u), float((SecondDigits ^ DigitShift.y) >> 8u)) * (1.0 / 16777216.0);
}
