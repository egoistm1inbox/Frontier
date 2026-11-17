# CurveSpace and shared CurvePlot foundation

`Frontier/Engine/Foundation/Curves/CurveSpace.h` provides scalar `CurveProfile<double>` evaluation with clamped piecewise
linear, cubic Hermite, and monotonic PCHIP interpolation; transactional key validation; fixed-size uniform lookup-table
baking; and a `SpaceCodec` schema for `.curvespace` files.

`Frontier/Engine/Interface/Controls/CurvePlot.{h,cpp}` is the first shared UI control for this foundation. It displays the
live evaluated profile, provides an interpolation selector, and lets users drag existing knots. Endpoint input coordinates
remain fixed, interior inputs remain ordered, and edits that fail the selected interpolation's validation are rejected
without mutating the specification. It is not yet connected to a domain inspector and does not add or remove knots.

## Verification

The engine validation checks interpolation bounds, uneven PCHIP monotonicity, invalid-key rejection and transactionality,
lookup-table baking, codec round trips, invalid TOML rejection, and the required `.curvespace` extension.

`CurvePlotValidation` runs the real ImGui control headlessly: it drags an interior knot, verifies the authored specification
changes, then verifies a non-monotone PCHIP edit is rejected transactionally. Its CMake/CTest target links the production
`FrontierSceneEditorUI` library. On this Linux host the same focused test was directly compiled with GCC 12.2 and pinned
ImGui sources because CMake is not installed. The exhibit-only CPU rasterizer captured the actual ImGui draw commands to
`Images/CurvePlot-CPU.png`; this is not native GPU evidence.

## Not yet implemented

- Integrate `CurvePlot` into domain inspectors after the shared editor UI foundation is complete.
- Knot insertion/removal, per-curve domain/range controls, and keyboard-accessible knot editing.
- Non-scalar curve value traits and integration into Physics, ForceField, Particle, Fluid, and Visual Effects.
- `EffectSpace`, the `VisualEffects/` pipeline, motion/distortion targets, or GPU effect evaluations.
