//============================================================================================================================================
//                                                             RENDERSETTINGS.JS
//============================================================================================================================================
// 🎛️ Per-camera render settings. The option lists, quality presets, defaults and clamping are translated from the FrontierWorldMirror
// gallery (unassignedinbox/Frontier, branch arena/28ada475-frontier, ShowcaseGalleryScene.js). That source keeps one permanent
// "Render Settings" row under the Editor Camera; here every camera row carries its own copy in Values["Render Settings"].
// Browser authoring only: nothing is sent to a renderer.

export const RenderSettingsKey = "Render Settings";

// Algorithms mirrored from ShadowAlgorithmLab (no SDF shadows, no SDF reflections). `label` is the source wording; `pick` is the
// shorter name that fits the inspector's select.
export const SHADOW_ALGORITHMS = [
  { id: "contact_pcss", label: "Contact + PCSS (No SDF)", pick: "Contact + PCSS", desc: "Screen/tight contact rays plus Vogel-disk PCSS. No SDF." },
  { id: "pcss", label: "Shadow Map · PCSS + Filter", pick: "PCSS + filter", desc: "Vogel blocker search, geometric penumbra and the plane filter." },
  { id: "smrt", label: "SMRT · Depth Ray Trace", pick: "SMRT depth trace", desc: "EEVEE-Next style quadratic ray marching through the depth map." },
  { id: "pcf", label: "Shadow Map · 3×3 PCF", pick: "3 × 3 PCF", desc: "Bilinear-weighted 3 × 3 percentage-closer filtering." },
  { id: "bvh", label: "BVH Raytraced", pick: "BVH ray traced", desc: "Stochastic Vogel-disk and rectangular-area visibility through the BVH." },
];

export const GI_ALGORITHMS = [
  { id: "sdf", label: "SDF Cone GI", pick: "SDF cone GI", desc: "Multi-bounce radiosity with solid-angle diffuse cones through the distance field." },
  { id: "bvh", label: "BVH Raytraced GI", pick: "BVH ray traced", desc: "Two-bounce cosine-hemisphere path tracing over every light." },
  { id: "off", label: "Off (Ambient Fill)", pick: "Off · ambient fill", desc: "Direct light plus the calibrated sky, moon and star ambient fill only." },
];

export const REFLECTION_ALGORITHMS = [
  { id: "bvh", label: "BVH Raytraced Refl", pick: "BVH ray traced", desc: "Multi-bounce Fresnel reflections traced through the BVH." },
  { id: "env", label: "Sky / Env Only", pick: "Sky / env only", desc: "Reflects the physical sky, clouds, moon and stars only." },
];

export const RENDER_ENGINES = [
  { id: "matcap", ordinal: 0, label: "0. MatCap (Studio Normal)", short: "MatCap", pick: "MatCap studio", desc: "Studio MatCap normal/roughness shading. No GI, no SDF." },
  { id: "openpbr_direct", ordinal: 1, label: "1. OpenPBR Direct", short: "OpenPBR", pick: "OpenPBR direct", desc: "Direct OpenPBR with LTC area lights and the shadow lab. No GI, no SDF." },
  { id: "gtx_sdf_gi", ordinal: 2, label: "2. RealTime GI · GTX Low-End", short: "GTX GI", pick: "GTX real-time GI", desc: "Hybrid cone penumbra with multi-bounce cone GI." },
  { id: "highend_bvh4_gi", ordinal: 3, label: "3. RealTime GI · High-End BVH4", short: "BVH4 GI", desc: "BVH4 two-bounce GI with Heitz projected-disk VNDF reflections. No SDF." },
  { id: "pt_realtime", ordinal: 4, label: "4. Path Tracer · GameRealtime", short: "PT game", pick: "Path tracer · game", desc: "Deterministic path tracer with blue-noise R2 sampling and reconstruction." },
  { id: "pt_final", ordinal: 5, label: "5. Path Tracer · SceneFinalRender", short: "PT final", pick: "Path tracer · final", desc: "Deterministic path tracer with shared Sobol sampling to exact convergence." },
];

export const SDF_PENUMBRA_MODES = [
  { id: "point_sdf", ordinal: 0, label: "0. Point-Sample (No Penumbra)", pick: "Point sample", desc: "Crisp point-centroid occlusion with no penumbra spread." },
  { id: "analytic_cone", ordinal: 1, label: "1. Analytic Cone Penumbra", pick: "Analytic cone", desc: "Closed-form solid-angle cone penumbra across area emitters." },
  { id: "voxel_clipmap", ordinal: 2, label: "2. 3D Voxel Clipmap Penumbra", pick: "Voxel clipmap", desc: "Stratified 3D clipmap, cone-traced area penumbra." },
  { id: "voxel_cone_gi", ordinal: 3, label: "3. 3D Voxel Penumbra + Cone GI", pick: "Voxel + cone GI", desc: "Clipmap penumbra coupled with multi-cone indirect bounce GI." },
  { id: "hybrid_sobol_cap", ordinal: 4, label: "4. Hybrid + Sobol Spherical Cap", pick: "Sobol spherical cap", desc: "Owen-scrambled Sobol spherical-cap penumbra integration." },
  { id: "sdf_mc_ref", ordinal: 5, label: "5. Monte Carlo PT Ref (96 SPP)", pick: "Monte Carlo 96 SPP", desc: "High-sample Monte Carlo reference penumbra." },
];

export const QUALITY_PRESETS = [
  { id: 0, label: "Low", bvhRays: 1, smrtRays: 2, pcssTaps: 8, giSamples: 4, giCones: 4, reflRays: 1 },
  { id: 1, label: "Medium (GTX)", bvhRays: 2, smrtRays: 4, pcssTaps: 16, giSamples: 6, giCones: 6, reflRays: 2 },
  { id: 2, label: "High", bvhRays: 4, smrtRays: 6, pcssTaps: 24, giSamples: 10, giCones: 8, reflRays: 4 },
  { id: 3, label: "Ultra", bvhRays: 8, smrtRays: 8, pcssTaps: 32, giSamples: 14, giCones: 10, reflRays: 6 },
  { id: 4, label: "Reference", bvhRays: 16, smrtRays: 12, pcssTaps: 48, giSamples: 20, giCones: 14, reflRays: 8 },
];

export const RENDER_SCALES = [50, 75, 100, 125];

// CanonicalEditorCamera.ExposureGain in the source scene is 1.35.
export const CanonicalRenderSettings = {
  RenderEngine: "gtx_sdf_gi",
  SdfPenumbraMode: "voxel_cone_gi",
  ShadowAlgorithm: "contact_pcss",
  ShadowQuality: 1,
  ShadowRays: 2,
  PcssTaps: 16,
  SmrtRays: 4,
  ShadowMapRes: 2048,
  PlaneFilter: true,
  HalfResShadows: false,
  ShadowSoftness: 1.0,
  EmissiveShadowMode: "shadowed",

  GiAlgorithm: "sdf",
  GiQuality: 1,
  GiSamples: 6,
  GiCones: 6,
  GiIntensity: 1.25,
  FillBoost: 1.15,

  ReflectionAlgorithm: "bvh",
  ReflectionQuality: 1,
  ReflectionRays: 2,
  ReflectionBounces: 2,

  ExposureGain: 1.35,
  RenderScale: 100,
  AntiAliasing: true,
};

const Bounded = (Amount, Minimum, Maximum, Fallback, Whole = false) => {
  const Numeric = Number(Amount);
  const Safe = Number.isFinite(Numeric) ? Numeric : Fallback;
  const Clamped = Math.max(Minimum, Math.min(Maximum, Safe));
  return Whole ? Math.round(Clamped) : Clamped;
};
const Known = (List, Id, Fallback) => (List.some((Option) => Option.id === Id) ? Id : Fallback);

// Source behaviour: unknown ids fall back to the defaults, every count and gain is clamped to the lab's range.
export function ResolveRenderSettings(Stored) {
  const Merged = { ...CanonicalRenderSettings, ...(Stored && typeof Stored === "object" ? Stored : {}) };
  const C = CanonicalRenderSettings;
  return {
    RenderEngine: Known(RENDER_ENGINES, Merged.RenderEngine, C.RenderEngine),
    SdfPenumbraMode: Known(SDF_PENUMBRA_MODES, Merged.SdfPenumbraMode, C.SdfPenumbraMode),
    ShadowAlgorithm: Known(SHADOW_ALGORITHMS, Merged.ShadowAlgorithm, C.ShadowAlgorithm),
    ShadowQuality: Bounded(Merged.ShadowQuality, 0, 4, C.ShadowQuality, true),
    ShadowRays: Bounded(Merged.ShadowRays, 1, 16, C.ShadowRays, true),
    PcssTaps: Bounded(Merged.PcssTaps, 8, 48, C.PcssTaps, true),
    SmrtRays: Bounded(Merged.SmrtRays, 2, 12, C.SmrtRays, true),
    ShadowMapRes: Number(Merged.ShadowMapRes) === 1024 ? 1024 : 2048,
    PlaneFilter: Merged.PlaneFilter !== false,
    HalfResShadows: Boolean(Merged.HalfResShadows),
    ShadowSoftness: Bounded(Merged.ShadowSoftness, 0.25, 2.5, C.ShadowSoftness),
    EmissiveShadowMode: Merged.EmissiveShadowMode === "unshadowed" ? "unshadowed" : "shadowed",
    GiAlgorithm: Known(GI_ALGORITHMS, Merged.GiAlgorithm, C.GiAlgorithm),
    GiQuality: Bounded(Merged.GiQuality, 0, 4, C.GiQuality, true),
    GiSamples: Bounded(Merged.GiSamples, 2, 20, C.GiSamples, true),
    GiCones: Bounded(Merged.GiCones, 4, 14, C.GiCones, true),
    GiIntensity: Bounded(Merged.GiIntensity, 0, 2.5, C.GiIntensity),
    FillBoost: Bounded(Merged.FillBoost, 0.2, 2.5, C.FillBoost),
    ReflectionAlgorithm: Known(REFLECTION_ALGORITHMS, Merged.ReflectionAlgorithm, C.ReflectionAlgorithm),
    ReflectionQuality: Bounded(Merged.ReflectionQuality, 0, 4, C.ReflectionQuality, true),
    ReflectionRays: Bounded(Merged.ReflectionRays, 1, 8, C.ReflectionRays, true),
    ReflectionBounces: Bounded(Merged.ReflectionBounces, 1, 3, C.ReflectionBounces, true),
    ExposureGain: Bounded(Merged.ExposureGain, 0.2, 3.5, C.ExposureGain),
    RenderScale: RENDER_SCALES.includes(Number(Merged.RenderScale)) ? Number(Merged.RenderScale) : 100,
    AntiAliasing: Merged.AntiAliasing !== false,
  };
}

// Preset fan-out, as in the source inspector: one tier choice rewrites the counts that tier controls.
export const ShadowQualityPatch = (Tier) => {
  const Preset = QUALITY_PRESETS[Tier] || QUALITY_PRESETS[1];
  return { ShadowQuality: Preset.id, ShadowRays: Preset.bvhRays, PcssTaps: Preset.pcssTaps, SmrtRays: Preset.smrtRays, ShadowMapRes: Preset.id === 0 ? 1024 : 2048 };
};
export const GiQualityPatch = (Tier) => {
  const Preset = QUALITY_PRESETS[Tier] || QUALITY_PRESETS[1];
  return { GiQuality: Preset.id, GiSamples: Preset.giSamples, GiCones: Preset.giCones };
};
export const ReflectionQualityPatch = (Tier) => {
  const Preset = QUALITY_PRESETS[Tier] || QUALITY_PRESETS[1];
  return { ReflectionQuality: Preset.id, ReflectionRays: Preset.reflRays, ReflectionBounces: Preset.id >= 2 ? 3 : Preset.id >= 1 ? 2 : 1 };
};
export const MasterQualityPatch = (Tier) => ({ ...ShadowQualityPatch(Tier), ...GiQualityPatch(Tier), ...ReflectionQualityPatch(Tier) });

// Picking an engine also picks the GI family that engine runs (source: openpbr → off, gtx → sdf, BVH4/path tracers → bvh).
export function EnginePatch(Id) {
  const Patch = { RenderEngine: Id };
  if (Id === "openpbr_direct") Patch.GiAlgorithm = "off";
  else if (Id === "gtx_sdf_gi") Patch.GiAlgorithm = "sdf";
  else if (Id === "highend_bvh4_gi" || Id === "pt_realtime" || Id === "pt_final") Patch.GiAlgorithm = "bvh";
  return Patch;
}

// The tier shared by all three, or -1 when they differ ("custom").
export const MasterTier = (Settings) =>
  Settings.ShadowQuality === Settings.GiQuality && Settings.GiQuality === Settings.ReflectionQuality ? Settings.ShadowQuality : -1;

export const UsesShadowMap = (Settings) => ["contact_pcss", "pcss", "smrt", "pcf"].includes(Settings.ShadowAlgorithm);
export const UsesPcss = (Settings) => Settings.ShadowAlgorithm === "contact_pcss" || Settings.ShadowAlgorithm === "pcss";

// Per-pixel work, per light for shadows: what each algorithm spends with the current counts.
export function SampleBudget(Settings) {
  const Shadow = {
    contact_pcss: Settings.ShadowRays + Settings.PcssTaps,
    pcss: Settings.PcssTaps,
    smrt: Settings.SmrtRays,
    pcf: 9,
    bvh: Settings.ShadowRays,
  }[Settings.ShadowAlgorithm];
  const Gi = Settings.GiAlgorithm === "sdf" ? Settings.GiCones : Settings.GiAlgorithm === "bvh" ? Settings.GiSamples * 2 : 0;
  const Reflection = Settings.ReflectionAlgorithm === "bvh" ? Settings.ReflectionRays * Settings.ReflectionBounces : 0;
  const Scale = (Settings.RenderScale / 100) ** 2;
  // Half-resolution shadows trace a quarter of the pixels.
  const ShadowShare = Settings.HalfResShadows && UsesShadowMap(Settings) ? 0.25 : 1;
  return { Shadow, Gi, Reflection, Scale, Total: (Shadow * ShadowShare + Gi + Reflection) * Scale };
}

export const Find = (List, Id) => List.find((Option) => Option.id === Id) || List[0];
