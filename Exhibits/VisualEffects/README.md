# EffectSpace data foundation

`Frontier/Engine/Rendering/VisualEffects/EffectSpace.h` adds the first declarative layer for `.effectspace`: typed profiles for
optical lens flare, heat distortion, motion blur, and camera impulse shake; spatial transforms; optional replication settings; and
eight scalar effect parameters. The codec validates identifiers, enum values, finite values, positive spatial scales, and
replication frequencies before replacing caller state.

## Verification

```sh
g++ -std=c++20 -Wall -Wextra -Wpedantic \
  -I. -IExternalPackages/tomlpp/include \
  Exhibits/VisualEffects/Code/EffectSpaceValidation.cpp -o /tmp/EffectSpaceValidation
/tmp/EffectSpaceValidation
```

Expected: `EffectSpaceValidation: 19 of 19 checks passed`.

## Remaining

This milestone is data/configuration only. No `IVisualEffectEvaluation` GPU sequence, HDR/depth/velocity/distortion targets,
motion atlas, heat-distortion shader, lens flare pipeline, camera shake integrator, networking transport, or editor UI is claimed.
