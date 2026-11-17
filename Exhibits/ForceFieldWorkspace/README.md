# Force Field + Wind Workspace

This exhibit is a native-backed authoring workspace. Its live map and oblique views sample the existing `ForceFieldSpace` evaluator; source types, ambient wind, and the field configuration export as native `ForceField`, `Wind`, and `ForceSource` records in `.levelspace` format.

## Validation

`ForceFieldWorkspaceValidation` exercises bounded ambient wind and localized generator time response, all 17 source conversions, source editing and placement, field navigation, lab/corridor/storm/blank presets, timeline playback and Fire, and Inspector export. It loads both the complete 17-source round-trip and the Inspector export through `WorldSpace::LoadLevelSpace`.

From the repository root, build and run it with the configured CMake tree:

```sh
cmake --build build/forcefield-workspace --target ForceFieldWorkspaceValidation --parallel 2
ctest --test-dir build/forcefield-workspace -R '^ForceFieldWorkspaceValidation$' --output-on-failure
```

CTest writes source, wind, and master-field PPM captures plus round-trip/export `.levelspace` files beneath `build/forcefield-workspace/`. To refresh the committed PNG evidence from those unmodified RGB captures:

```sh
python Exhibits/TextureStudio/Code/EncodeRgbCapture.py build/forcefield-workspace/ForceFieldWorkspaceValidation-source.ppm Exhibits/ForceFieldWorkspace/Images/VerifiedSource.png
python Exhibits/TextureStudio/Code/EncodeRgbCapture.py build/forcefield-workspace/ForceFieldWorkspaceValidation-wind.ppm Exhibits/ForceFieldWorkspace/Images/VerifiedWind.png
python Exhibits/TextureStudio/Code/EncodeRgbCapture.py build/forcefield-workspace/ForceFieldWorkspaceValidation-field.ppm Exhibits/ForceFieldWorkspace/Images/VerifiedField.png
```

The committed `Images/Verified{Source,Wind,Field}.png` captures show the interactive workspace and the corresponding Inspector pages.
