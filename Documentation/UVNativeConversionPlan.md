# UV Native C++20 Conversion and Surface Lighting Plan

## Imported Baselines

| Source | Imported role | Verification |
| :--- | :--- | :--- |
| `unassignedinbox/Frontier` revision `7fa86e5` | Frontier C++20 workspace, build tooling, UI components, Experimental studios | Imported into this branch as `87d32eb` |
| `c7egoist/Frontier` revision `3350774` | Latest UV Studio reference, including GPU selection, wire drawing, UDIM, packing, and Texture Studio bridge | Compared against `Experimental/UVEditor/` and completed `UVValidation.mjs` successfully |

The browser studio remains the behavioural and visual specification. Native C++20 source belongs under `Engine/`; GPU drawing belongs in `.slang` units only.

## First Native Increment

| Requirement | Native mechanism now | GPU layout |
| :--- | :--- | :--- |
| One appearance on any facet | `SurfaceAppearanceRegister` assigns an ordered identifier sequence per facet | `SurfaceFacetAppearanceGpu` points at the first identifier and count |
| Several facets share one appearance | Registered appearance identifiers are reusable without copying image settings | One `SurfaceAppearanceGpu` entry can be read by any facet |
| Many matcaps on one surface | Each facet accepts an unbounded ordered appearance sequence; each appearance optionally names one matcap image | Descriptor-indexed matcap image sequence plus a compact index sequence |
| Fast direct lighting | CPU verification mirror and `SurfaceLighting.slang` use normalized Blinn-Phong diffuse and specular terms | Fragment rasterization |
| Basic shadows | Per-facet shadow influence with a filtered 2 by 2 directional-depth comparison | Directional depth image and comparison sampler |

The initial increment deliberately does not invent an EON formula. The documented EON BRDF commonly concerns rough diffuse reflection, while the requested "EON specular" needs an exact equation or reference before it can be represented faithfully. Blinn-Phong is live in this increment; EON remains an isolated, replaceable lobe after confirmation.

## Native Conversion Order

| Order | C++20 work | `.slang` work | Completion evidence |
| :--- | :--- | :--- | :--- |
| 1 | Bring in the current UV Studio specification and preserve its JavaScript validation | None | `UVValidation.mjs` completes successfully |
| 2 | Define surface topology, welded UV corners, seams, pins, island extraction, facet selection, and undo revisions | GPU facet identifiers for selection | Native topology validation and a deterministic image |
| 3 | Port OBJ intake/output, UDIM coordinate conversion, chart diagnostics, and texel-density calculations | UV grid, checker, stretch, density, and importance visualisation | Round-trip, UDIM, overlap, and distortion checks |
| 4 | Port LSCM, Smart UV, analytic projections, relax, stitch, weld, split, align, and rectify operations | GPU selection and live preview updates | Numerical parity cases taken from the browser studio |
| 5 | Port importance budgets, exact-shape packing, rotations, margin dilation, and automatic UDIM overflow | Packing diagnostic drawing | Target share and zero-overlap checks |
| 6 | Add the native Editor UV workspace: 2D sheet, 3D viewport, outliner, inspector, shortcuts, and revision controls | Face identifier picking, wire drawing, seam drawing, vertex drawing, brush, and box selection | Editor exhibit image plus interaction validation |
| 7 | Bind the initial fast lighting route: Blinn-Phong, ordered matcaps, directional shadows, then the confirmed EON lobe | `SurfaceLighting.slang`, depth comparison, descriptor-indexed images | Lighting validation image and GPU comparison reading |
| 8 | Connect the UV-to-texture transfer format and the Texture Studio authoring route | UV bake and paint rasterization | Layout transfer round-trip validation |

## Rendering Rules

1. A facet owns an ordered sequence of appearance identifiers, not a single material field.
2. An appearance can be reused across many facets. Its matcap image, direct-light channels, shadow influence, and blend choices stay local to that appearance.
3. A matcap uses camera-space normal coordinates. Matcap order is explicit: `Over`, `Additive`, or `Multiply`.
4. Direct light remains inexpensive: one directional light, ambient term, normalized Blinn half vector, exponent-limited specular term, and a four-reading directional shadow filter.
5. Lighting runs in linear colour. Image intake converts sRGB images to linear before the lighting calculation; display conversion occurs later in the radiometric stack.
6. GPU selection, seam, wire, grid, brush, and transform drawings remain `.slang` rasterization work. ImGui owns panels and chrome only.

## Prerequisites and Decisions

| Need | Why it blocks a final implementation | Proposed default until confirmed |
| :--- | :--- | :--- |
| Exact EON reference | "EON specular" has no single unambiguous equation | Keep Blinn-Phong; reserve a small lobe switch point |
| Matcap image intake rules | Image encoding and alpha meaning affect appearance parity | PNG/JPEG, sRGB decode, premultiplied alpha disabled |
| GPU capability floor | Unlimited ordered layers need descriptor indexing | Vulkan 1.3 with descriptor indexing; a bounded compatibility route can follow |
| Shadow choice | Directional-only and local-light shadows use different depth layouts | One directional depth image, 2 by 2 comparison filter, slope-aware bias next |
| Layer order policy | Multiple matcaps need repeatable authoring results | Ordered sequence, `Over` by default |
| Performance ceiling | Authoring and runtime targets may require different limits | Unlimited authoring sequence; telemetry warning after eight active image samples per facet |
| Import priority | OBJ is ready in the reference; glTF and FBX have broader material needs | OBJ first, glTF second, FBX after interchange groundwork |

## Quality Gates

- The imported browser UV validation stays green before every native parity increment.
- Native calculations receive deterministic CTest validation and an image under `Exhibits/Images/`.
- C++ and `.slang` GPU structures retain fixed-width fields, 16-byte alignment, and compile-time size checks.
- Editor-only code stays out of Development and Shipping profiles; reusable UV, lighting, and interchange calculations remain portable.
- No CPU or ImGui viewport overlay replaces GPU `.slang` drawing.
