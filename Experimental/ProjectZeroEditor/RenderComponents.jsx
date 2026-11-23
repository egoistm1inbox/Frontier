//============================================================================================================================================
//                                                          RENDERCOMPONENTS.JSX
//============================================================================================================================================
// 🎛️ The camera's Camera Settings component (named Render Engine before Follow-up 77). Every camera (Editor, Cine and any placed from
// Construct) has one component row. Its inspector is a page carousel: Overview picks the render type (PBR, SDF, Ray traced, MatCap) and
// lists that renderer's settings; the next pages are that renderer's own (Shadows, GI, AO, Reflections, Lighting, MatCap type), then
// Output. Each renderer keeps its own keys, so switching renderer never loses another renderer's setup. All tabs
// edit the camera's Values["Render Settings"] (RenderSettings.js). Browser authoring only: no renderer is driven.

import React, { useState } from "react";
import {
  RenderSettingsKey,
  ResolveRenderSettings,
  CanonicalRenderSettings,
  RENDER_ENGINES,
  RENDERERS,
  RendererOf,
  RendererPatch,
  EnginePatch,
  PBR_SHADOWS,
  SDF_SHADOWS,
  RAY_SHADOWS,
  MATCAP_SHADOWS,
  MATCAP_CHANNELS,
  QUALITY_PRESETS,
  RENDER_SCALES,
  REFLECTION_SOURCES,
  TRACE_RESOLUTIONS,
  PbrShadowPatch,
  SdfShadowPatch,
  SdfGiPatch,
  RayShadowPatch,
  RayGiPatch,
  RayReflectionPatch,
  MasterQualityPatch,
  MasterTier,
  SampleBudget,
  RendererLines,
  Find,
  SDF_AO,
  RAY_AO,
  OcclusionOf,
} from "./RenderSettings.js";
import { InspectorTabs } from "./InspectorTabs.jsx";
import { PenumbraStudy, HemisphereStudy, BounceStudy, ScaleStudy, KernelStudy, SdfTraceStudy, MatcapBall, BudgetBar, StudioShadowStudy, OcclusionStudy } from "./RenderStudies.jsx";
import "./RenderSettings.css";

const Tones = { Shadow: "#7ab8ff", Gi: "#7be0ad", Reflection: "#c5a3ff", Occlusion: "#e0b07b" };

// Component, baked icon, description. One component per camera.
export const RenderComponentTypes = [["Camera Settings", "render-settings", "Render type, its shadows, lighting, GI, AO and reflections, quality and output"]];
// Follow-up 77: the component was called Render Engine; saved scenes rename it (ObjectComponents.jsx).
export const RenamedRenderComponents = { "Render Engine": "Camera Settings" };
// Components earlier drafts split the settings into (Follow-up 41); saved scenes drop them (ObjectComponents.jsx).
export const RetiredRenderComponents = ["MatCap", "Shadow Maps", "SDF Tracing", "Ray Tracing"];

// The renderer that draws with the current settings, per renderer id.
export const RenderUse = (Settings) => Object.fromEntries(RENDERERS.map((Renderer) => [Renderer.id, RendererOf(Settings.RenderEngine).id === Renderer.id]));

const TierName = (Settings) => {
  const Tier = MasterTier(Settings);
  return Tier < 0 ? "Custom tiers" : QUALITY_PRESETS[Tier].label.replace(" (GTX)", "");
};

// Outliner value line.
export function RenderSummary(Component, Values = {}) {
  const Settings = ResolveRenderSettings(Values[RenderSettingsKey]);
  const Renderer = RendererOf(Settings.RenderEngine);
  const Engine = Renderer.id === "ray" ? ` (${Find(RENDER_ENGINES, Settings.RenderEngine).short})` : "";
  return `${Renderer.label}${Engine} · ${TierName(Settings)} · ${Settings.RenderScale} %`;
}

// The common shape the studies read, per renderer.
const PbrStudy = (S) => ({ ShadowAlgorithm: S.PbrShadow, ShadowSoftness: S.PbrSoftness, ShadowMapRes: S.PbrMapRes, HalfResShadows: S.PbrHalfRes, ShadowRays: S.PbrContactRays, SmrtRays: S.PbrSmrtRays, PcssTaps: S.PbrPcssTaps });
const SdfGiStudy = (S) => ({ GiAlgorithm: S.SdfGi ? "sdf" : "off", GiCones: S.SdfCones, GiSamples: 0, FillBoost: S.SdfFill });
const RayShadowStudy = (S) => ({ ShadowAlgorithm: "bvh", ShadowSoftness: S.RaySoftness, ShadowRays: S.RayShadowRays, ShadowMapRes: 2048, HalfResShadows: false });
const RayGiStudy = (S) => ({ GiAlgorithm: S.RayGi ? "bvh" : "off", GiSamples: S.RayGiSamples, GiCones: 0, FillBoost: S.RayFill });
const RayBounceStudy = (S) => ({ ReflectionAlgorithm: S.RayReflections ? "bvh" : "env", ReflectionRays: S.RayReflectionRays, ReflectionBounces: S.RayReflectionBounces });

//------------------------------------------------------------------------------------------------------------------------
//                                                   SHARED PIECES
//------------------------------------------------------------------------------------------------------------------------

// Radio tiles: a small grid of choices with a short line each.
function Tiles({ Label, Options, Active, Choose, Columns = 2 }) {
  return (
    <div className="rc-tiles" role="radiogroup" aria-label={Label} style={{ "--rc-columns": Columns }}>
      {Options.map((Option) => (
        <button key={Option.id} type="button" role="radio" aria-checked={Option.id === Active} onClick={() => Choose(Option.id)}>
          <b>{Option.pick || Option.label}</b>
          {Option.line && <small>{Option.line}</small>}
        </button>
      ))}
    </div>
  );
}

// Pill segments for a short ordered choice.
function Segments({ Label, Options, Active, Choose }) {
  return (
    <div className="rc-segments" role="radiogroup" aria-label={Label}>
      {Options.map(([Id, Text]) => (
        <button key={Id} type="button" role="radio" aria-checked={Id === Active} onClick={() => Choose(Id)}>
          {Text}
        </button>
      ))}
    </div>
  );
}

// Follow-up 77: the Camera Settings inspector reads in two steps. The Overview page picks the render type (four cards, each saying what
// it draws) and lists the chosen renderer's settings, one line per page; the carousel then holds only that renderer's pages, in its own
// order (Ray traced: Tracer | GI | Shadows | AO | Reflections; MatCap: Shadows | Lighting | MatCap type), with Output last. The other renderers'
// settings are kept (each renderer has its own keys) and come back when it is picked again.
export const RenderPages = {
  pbr: [["shadows", "Shadows"], ["lighting", "Lighting"], ["ao", "AO"]],
  sdf: [["shadows", "Shadows"], ["gi", "GI"], ["ao", "AO"]],
  ray: [["tracer", "Tracer"], ["gi", "GI"], ["shadows", "Shadows"], ["ao", "AO"], ["reflections", "Reflections"]],
  matcap: [["shadows", "Shadows"], ["lighting", "Lighting"], ["matcap", "MatCap type"]],
};
// One line a page sums up, for the Overview's list.
export function PageLine(Settings, Renderer, Page) {
  const S = Settings;
  if (Page === "ao") return OcclusionOf(S)?.Line || "None";
  if (Renderer === "pbr")
    return { shadows: `${Find(PBR_SHADOWS, S.PbrShadow).pick} · ${S.PbrMapRes}²`, lighting: `${S.PbrAreaLights ? "LTC area lights" : "Point lights"} · fill × ${S.PbrFill.toFixed(2)}` }[Page];
  if (Renderer === "sdf") return { shadows: `${Find(SDF_SHADOWS, S.SdfShadow).pick} · ${S.SdfSteps} steps`, gi: S.SdfGi ? `Cone GI · ${S.SdfCones} cones` : "Off · ambient fill" }[Page];
  if (Renderer === "ray")
    return {
      tracer: Find(RENDER_ENGINES, S.RayTracer).pick,
      gi: S.RayGi ? `Traced GI · ${S.RayGiSamples} samples` : "Off · ambient fill",
      shadows: `${Find(RAY_SHADOWS, S.RayShadow).pick.replace("WideTree RayQuery · ", "BVH ")} · ${S.RayShadowRays} rays`,
      reflections: S.RayReflections ? `Traced · ${S.RayReflectionRays} × ${S.RayReflectionBounces} bounces` : "Sky / environment",
    }[Page];
  return { shadows: Find(MATCAP_SHADOWS, S.MatcapShadow).pick, lighting: `Studio light ${S.MatcapLight}° · rim ${S.MatcapRim.toFixed(2)}`, matcap: Find(MATCAP_CHANNELS, S.MatcapChannel).label }[Page];
}
// What each render type is, in a line, on its card.
const TypeLines = {
  pbr: "Raster with shadow maps; sky fill instead of GI",
  sdf: "Distance-field shadows with real-time cone GI",
  ray: "BVH or path-traced light, shadows and reflections",
  matcap: "Clay studio shading to read shape; no scene lights",
};
// A small sphere per render type: lit raster, distance-field contours, traced bounce, clay MatCap.
function TypeThumb({ Renderer, Large = false }) {
  const Id = "rt-" + Renderer + (Large ? "-large" : "");
  return (
    <svg className={"rc-type-thumb" + (Large ? " large" : "")} viewBox="0 0 72 52" aria-hidden="true">
      <defs>
        <radialGradient id={Id} cx="0.36" cy="0.32" r="0.75">
          {Renderer === "matcap" ? (
            <>
              <stop offset="0" stopColor="#f1e7da" />
              <stop offset="0.6" stopColor="#a99d8f" />
              <stop offset="1" stopColor="#3d3833" />
            </>
          ) : Renderer === "ray" ? (
            <>
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.25" stopColor="#c9b8ff" />
              <stop offset="1" stopColor="#2b2340" />
            </>
          ) : Renderer === "sdf" ? (
            <>
              <stop offset="0" stopColor="#e9fff4" />
              <stop offset="0.5" stopColor="#7fcfa6" />
              <stop offset="1" stopColor="#1d3a2c" />
            </>
          ) : (
            <>
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.35" stopColor="#9cc7ff" />
              <stop offset="1" stopColor="#1c2a3d" />
            </>
          )}
        </radialGradient>
      </defs>
      <path d="M4 44 H68" stroke="#ffffff1a" />
      {Renderer === "pbr" && <ellipse cx="44" cy="44" rx="17" ry="3.2" fill="#000" opacity="0.65" />}
      {Renderer === "sdf" && (
        <g fill="none" stroke="#7be0ad" opacity="0.35">
          <ellipse cx="42" cy="44" rx="20" ry="4" />
          <ellipse cx="42" cy="44" rx="13" ry="2.6" />
        </g>
      )}
      {Renderer === "ray" && <path d="M8 8 L30 22 L52 6 M30 22 L60 40" fill="none" stroke="#c5a3ff" strokeWidth="1" strokeDasharray="2 2.5" opacity="0.8" />}
      {Renderer === "matcap" && <ellipse cx="36" cy="44" rx="15" ry="2.6" fill="#000" opacity="0.4" />}
      <circle cx="36" cy="26" r="15" fill={`url(#${Id})`} />
      {Renderer === "matcap" && <circle cx="36" cy="26" r="15" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="1.2" strokeDasharray="0 31 30 40" />}
    </svg>
  );
}

// The last page opened per camera and renderer comes back with them (InspectorTabs remembers it by Owner).
//------------------------------------------------------------------------------------------------------------------------
//                                                   COMPONENT CARDS
//------------------------------------------------------------------------------------------------------------------------

export function RenderComponentCards({ Component, Owner, Values, Change, Kit }) {
  const { Card, Control, Metric } = Kit;
  const [Wanted, Want] = useState(null);
  const Settings = ResolveRenderSettings(Values[RenderSettingsKey]);
  const Assign = (Patch) => Change(RenderSettingsKey, { ...Settings, ...Patch });
  const Tiers = QUALITY_PRESETS.map((Preset) => Preset.label.replace(" (GTX)", "") + (Preset.note ? " 📝" : ""));
  const Slide = (Label, Key, Minimum, Maximum, Decimals = 0, Unit = "") => (
    <Control Field={{ Label, Minimum, Maximum, Decimals, Unit, Default: CanonicalRenderSettings[Key] }} Value={Settings[Key]} Change={(Next) => Assign({ [Key]: Decimals ? Next : Math.round(Next) })} />
  );
  const Switch = (Label, Key) => <Control Field={{ Label, Control: "Switch" }} Value={Settings[Key]} Change={(Next) => Assign({ [Key]: Next })} />;
  const TierPick = (Label, Key, Patch) => <Control Field={{ Label, Control: "Select", Options: Tiers }} Value={Settings[Key]} Change={(Index) => Assign(Patch(Index))} />;
  const Active = RendererOf(Settings.RenderEngine);
  const Engine = Find(RENDER_ENGINES, Settings.RenderEngine);
  const Wrap = (Id, Cards) => (
    <div className="rc-cards" data-render-component={Component} data-render-tab={Id}>
      {Cards}
    </div>
  );

  //── Overview ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  const Overview = () => {
    const Tier = MasterTier(Settings);
    const Budget = SampleBudget(Settings);
    const Changed = Object.keys(CanonicalRenderSettings).filter((Key) => Settings[Key] !== CanonicalRenderSettings[Key]).length;
    return (
      <>
        {/* Follow-up 78: laid out like the Camera body card: the chosen render type large, then the four to pick from (one at a time). */}
        <Card Title="Render type" Class="rs-card rc-type-card">
          <div className="rc-type-hero" data-render-type-shown={Active.id}>
            <TypeThumb Renderer={Active.id} Large />
            <b>
              {"ABCD"[RENDERERS.indexOf(Active)]} · {Active.label}
            </b>
            <small>{TypeLines[Active.id]}</small>
            <span className="rc-type-pages">
              {RenderPages[Active.id].map(([Id, Label]) => (
                <em key={Id}>{Label}</em>
              ))}
            </span>
          </div>
          <div className="rc-types" role="radiogroup" aria-label="Render type">
            {RENDERERS.map((Each, At) => {
              const On = Each.id === Active.id;
              return (
                <button key={Each.id} type="button" role="radio" aria-checked={On} aria-label={Each.label} className={On ? "on" : ""} data-render-type={Each.id} onClick={() => !On && Assign(RendererPatch(Each.id, Settings))}>
                  <i>{"ABCD"[At]}</i>
                  <TypeThumb Renderer={Each.id} />
                  <span>{Each.label}</span>
                </button>
              );
            })}
          </div>
          <p className="rs-note">{Engine.desc}</p>
        </Card>
        <Card Title={Active.title} Class="rs-card rc-chosen-card">
          <Metric Value={Active.label} Unit={Engine.short} Caption="Each line opens its page" />
          <ul className="rc-page-list" aria-label={`${Active.title} pages`}>
            {RenderPages[Active.id].map(([Id, Label]) => (
              <li key={Id}>
                <button type="button" data-open-page={Id} onClick={() => Want({ Id, Stamp: Date.now() })}>
                  <span>{Label}</span>
                  <b>{PageLine(Settings, Active.id, Id)}</b>
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </li>
            ))}
            <li>
              <button type="button" data-open-page="output" onClick={() => Want({ Id: "output", Stamp: Date.now() })}>
                <span>Output</span>
                <b>{`${Settings.RenderScale} % · exposure × ${Settings.ExposureGain.toFixed(2)}`}</b>
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                  <path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </li>
          </ul>
        </Card>
        <Card Title="Quality" Class="rs-card">
          <Metric Value={Budget.Total.toFixed(Budget.Total < 10 ? 1 : 0)} Unit="samples / pixel" Caption={`${Tier < 0 ? "Custom: the pages use different tiers" : Tiers[Tier] + " on every page"}${Budget.Scale !== 1 ? ` · × ${Budget.Scale.toFixed(2)} for scale` : ""}`} />
          <div className="graphic rs-graphic">
            <BudgetBar Budget={Budget} Tones={Tones} />
          </div>
          <Segments Label="Global quality tier" Options={QUALITY_PRESETS.map((Preset) => [Preset.id, Tiers[Preset.id]])} Active={Tier} Choose={(Index) => Assign(MasterQualityPatch(Index))} />
          <p className="rs-note">A tier sets the shadow, GI and reflection counts of every renderer; each page can still change its own.</p>
        </Card>
        <div className="rc-reset">
          <span>{Changed ? `${Changed} of ${Object.keys(CanonicalRenderSettings).length} settings differ from the defaults` : "Source defaults"} · this camera only</span>
          <button type="button" disabled={!Changed} onClick={() => Change(RenderSettingsKey, { ...CanonicalRenderSettings })}>
            Reset
          </button>
        </div>
      </>
    );
  };

  //── Output (every renderer) ───────────────────────────────────────────────────────────────────────────────────────────
  const Output = () => (
    <Card Title="Output" Class="rs-card">
      <Metric Value={String(Settings.RenderScale)} Unit="% scale" Caption={`Exposure gain ${Settings.ExposureGain.toFixed(2)} × · edge AA ${Settings.AntiAliasing ? "on" : "off"}`} />
      <div className="graphic rs-graphic">
        <ScaleStudy Settings={Settings} />
      </div>
      {Slide("Exposure gain", "ExposureGain", 0.2, 3.5, 2, "×")}
      <Segments Label="Resolution scale" Options={RENDER_SCALES.map((Each) => [Each, Each + " %"])} Active={Settings.RenderScale} Choose={(Next) => Assign({ RenderScale: Next })} />
      {Switch("Edge anti-aliasing", "AntiAliasing")}
      <small className="rc-caption">Reflection source</small>
      <Segments Label="Reflection source" Options={REFLECTION_SOURCES.map((Each) => [Each.id, Each.pick])} Active={Settings.ReflectionSource} Choose={(Next) => Assign({ ReflectionSource: Next })} />
      <small className="rc-caption">Trace resolution</small>
      <Segments Label="Trace resolution" Options={TRACE_RESOLUTIONS.map((Each) => [Each.id, Each.pick])} Active={Settings.TraceResolution} Choose={(Next) => Assign({ TraceResolution: Next })} />
    </Card>
  );

  //── PBR raster ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const Pbr = {
    shadows: () => {
      const Shadow = Find(PBR_SHADOWS, Settings.PbrShadow);
      const Pcss = Settings.PbrShadow === "pcss" || Settings.PbrShadow === "contact_pcss";
      const Texel = ((40 / Settings.PbrMapRes) * (Settings.PbrHalfRes ? 2 : 1) * 100).toFixed(1);
      return (
        <>
          <Card Title="Shadow algorithm" Class="rs-card" Accent={Tones.Shadow}>
            <Metric Value={`${Settings.PbrMapRes}²`} Unit="shadow map" Caption={`${Texel} cm per texel across a 40 m light view · ${Shadow.desc}`} />
            <div className="graphic rs-graphic">
              <KernelStudy Settings={PbrStudy(Settings)} />
            </div>
            <Tiles Label="PBR shadow algorithm" Options={PBR_SHADOWS.map((Option) => ({ ...Option, line: Option.desc.split(".")[0] }))} Active={Settings.PbrShadow} Choose={(Id) => Assign({ PbrShadow: Id })} />
            <Segments Label="Map resolution" Options={[[1024, "1024²"], [2048, "2048²"]]} Active={Settings.PbrMapRes} Choose={(Next) => Assign({ PbrMapRes: Next })} />
            {TierPick("Shadow quality", "PbrShadowQuality", PbrShadowPatch)}
            {Switch("Half-resolution shadows", "PbrHalfRes")}
            {Pcss && Switch("Plane filter", "PbrPlaneFilter")}
          </Card>
          <Card Title="Penumbra" Class="rs-card" Accent={Tones.Shadow}>
            <Metric Value={Settings.PbrSoftness.toFixed(2)} Unit="× softness" Caption={`Area emitters ${Settings.PbrEmitters}`} />
            <div className="graphic rs-graphic">
              <PenumbraStudy Settings={PbrStudy(Settings)} />
            </div>
            {Slide("Penumbra softness", "PbrSoftness", 0.25, 2.5, 2, "×")}
            {Pcss && Slide("PCSS taps", "PbrPcssTaps", 8, 48)}
            {Settings.PbrShadow === "smrt" && Slide("SMRT march steps", "PbrSmrtRays", 2, 12)}
            {Settings.PbrShadow === "contact_pcss" && Slide("Contact trace rays", "PbrContactRays", 1, 16)}
            <Control Field={{ Label: "Area emitters", Control: "Select", Options: ["Shadowed", "Unshadowed"] }} Value={Settings.PbrEmitters === "unshadowed" ? 1 : 0} Change={(Index) => Assign({ PbrEmitters: Index ? "unshadowed" : "shadowed" })} />
          </Card>
        </>
      );
    },
    lighting: () => (
      <Card Title="Direct lighting" Class="rs-card">
        {Switch("LTC area lights", "PbrAreaLights")}
        {Slide("Sky & ambient fill", "PbrFill", 0.2, 2.5, 2, "×")}
        <p className="rs-note">OpenPBR Direct has no GI and no SDF: indirect light is the sky and ambient fill only.</p>
      </Card>
    ),
    ao: () => (
      <Card Title="Ambient occlusion" Class="rs-card rc-ao-card" Accent={Tones.Occlusion}>
        <Metric Value={Settings.XeGtao ? String(Settings.XeGtaoSlices) : "Off"} Unit={Settings.XeGtao ? "XeGTAO slices" : ""} Caption={Settings.XeGtao ? `Screen-space horizon search within ${Settings.XeGtaoRadius.toFixed(2)} m · strength ${Settings.XeGtaoStrength.toFixed(2)} ×` : "No ambient occlusion on the PBR raster."} />
        <div className="graphic rs-graphic">
          <OcclusionStudy Method={Settings.XeGtao ? "xegtao" : "off"} Count={Settings.XeGtaoSlices} Radius={Settings.XeGtaoRadius / 3} />
        </div>
        {Switch("XeGTAO", "XeGtao")}
        {Settings.XeGtao && (
          <>
            {Slide("XeGTAO strength", "XeGtaoStrength", 0, 2, 2, "×")}
            {Slide("Effect radius", "XeGtaoRadius", 0.1, 3, 2, "m")}
            {Slide("Slices", "XeGtaoSlices", 1, 9)}
          </>
        )}
      </Card>
    ),
  };

  //── SDF tracing ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const Sdf = {
    shadows: () => {
      const Mode = Find(SDF_SHADOWS, Settings.SdfShadow);
      return (
        <>
          <Card Title="Distance-field shadows" Class="rs-card" Accent={Tones.Gi}>
            <Metric Value={String(Mode.ordinal)} Unit={Mode.pick} Caption={`${Mode.desc} · ${Settings.SdfSteps} march steps`} />
            <div className="graphic rs-graphic">
              <SdfTraceStudy Settings={{ ShadowSoftness: Settings.SdfSoftness }} Ordinal={Mode.ordinal} />
            </div>
            <ol className="rc-rail" aria-label="SDF shadow algorithm">
              {SDF_SHADOWS.map((Each) => (
                <li key={Each.id}>
                  <button type="button" aria-pressed={Each.id === Settings.SdfShadow} onClick={() => Assign({ SdfShadow: Each.id })}>
                    <i>{Each.ordinal}</i>
                    <span>
                      <b>{Each.pick}</b>
                      <small>{Each.desc}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            {Slide("March steps", "SdfSteps", 8, 96)}
            {Slide("Penumbra softness", "SdfSoftness", 0.25, 2.5, 2, "×")}
            {TierPick("Shadow quality", "SdfShadowQuality", SdfShadowPatch)}
          </Card>
        </>
      );
    },
    gi: () => (
      <>
          <Card Title="Cone GI" Class="rs-card" Accent={Tones.Gi}>
            <Metric Value={Settings.SdfGi ? String(Settings.SdfCones) : "Off"} Unit={Settings.SdfGi ? "cones" : ""} Caption={Settings.SdfGi ? `Bounce × ${Settings.SdfGiIntensity.toFixed(2)} · ${Tiers[Settings.SdfGiQuality]}` : "Direct light and ambient fill only."} />
            <div className="graphic rs-graphic">
              <HemisphereStudy Settings={SdfGiStudy(Settings)} />
            </div>
            {Switch("SDF cone GI", "SdfGi")}
            {Settings.SdfGi && (
              <>
                {Slide("Cone directions", "SdfCones", 4, 14)}
                {Slide("Bounce intensity", "SdfGiIntensity", 0, 2.5, 2, "×")}
                {TierPick("GI quality", "SdfGiQuality", SdfGiPatch)}
              </>
            )}
            {Slide("Sky & ambient fill", "SdfFill", 0.2, 2.5, 2, "×")}
          </Card>
      </>
    ),
    ao: () => (
      <>
          <Card Title="SDF ambient occlusion" Class="rs-card rc-ao-card" Accent={Tones.Occlusion}>
            <Metric Value={Settings.SdfAo ? (Settings.SdfAoMethod === "sdf_multitap" ? String(Settings.SdfAoTaps) : Settings.SdfAoMethod === "sdf_cone" ? String(Settings.SdfAoCones) : "3D") : "Off"} Unit={Settings.SdfAo ? (Settings.SdfAoMethod === "sdf_multitap" ? "taps" : Settings.SdfAoMethod === "sdf_cone" ? "cones" : "clipmap") : ""} Caption={Settings.SdfAo ? `${Find(SDF_AO, Settings.SdfAoMethod).desc} Radius ${Settings.SdfAoRadius.toFixed(2)} m.` : "No ambient occlusion on the SDF tracer."} />
            <div className="graphic rs-graphic">
              <OcclusionStudy Method={Settings.SdfAo ? Settings.SdfAoMethod : "off"} Count={Settings.SdfAoMethod === "sdf_multitap" ? Settings.SdfAoTaps : Settings.SdfAoCones} Radius={Settings.SdfAoRadius / 4} />
            </div>
            {Switch("SDF ambient occlusion", "SdfAo")}
            {Settings.SdfAo && (
              <>
                <Tiles Label="SDF AO method" Options={SDF_AO.map((Option) => ({ ...Option, line: Option.desc.split(";")[0] }))} Active={Settings.SdfAoMethod} Choose={(Id) => Assign({ SdfAoMethod: Id })} />
                {Settings.SdfAoMethod === "sdf_multitap" && Slide("Taps", "SdfAoTaps", 3, 12)}
                {Settings.SdfAoMethod === "sdf_cone" && Slide("Cones", "SdfAoCones", 1, 9)}
                {Slide("AO radius", "SdfAoRadius", 0.1, 4, 2, "m")}
                {Slide("AO strength", "SdfAoStrength", 0, 2, 2, "×")}
              </>
            )}
          </Card>
      </>
    ),
  };

  //── Ray traced ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const Ray = {
    tracer: () => {
      const Parts = { Shadow: Settings.RayShadowRays, Gi: Settings.RayGi ? Settings.RayGiSamples * 2 : 0, Reflection: Settings.RayReflections ? Settings.RayReflectionRays * Settings.RayReflectionBounces : 0 };
      return (
        <Card Title="Tracer" Class="rs-card" Accent={Tones.Reflection}>
          <Metric Value={String(Parts.Shadow + Parts.Gi + Parts.Reflection)} Unit="rays / pixel" Caption={Find(RENDER_ENGINES, Settings.RayTracer).desc} />
          <div className="graphic rs-graphic">
            <BudgetBar Budget={Parts} Tones={Tones} />
          </div>
          <Tiles Label="Tracer" Columns={1} Options={RENDERERS[2].engines.map((Id) => ({ ...Find(RENDER_ENGINES, Id), pick: Find(RENDER_ENGINES, Id).short, line: Find(RENDER_ENGINES, Id).desc }))} Active={Settings.RayTracer} Choose={(Id) => Assign(EnginePatch(Id))} />
        </Card>
      );
    },
    gi: () => (
      <>
          <Card Title="Traced GI" Class="rs-card" Accent={Tones.Gi}>
            <div className="graphic rs-graphic">
              <HemisphereStudy Settings={RayGiStudy(Settings)} />
            </div>
            {Switch("Trace GI", "RayGi")}
            {Settings.RayGi && (
              <>
                {Slide("Samples / pixel", "RayGiSamples", 2, 20)}
                {Slide("Bounce intensity", "RayGiIntensity", 0, 2.5, 2, "×")}
                {TierPick("GI quality", "RayGiQuality", RayGiPatch)}
              </>
            )}
            {Slide("Sky & ambient fill", "RayFill", 0.2, 2.5, 2, "×")}
          </Card>
      </>
    ),
    shadows: () => {
      const Shadow = Find(RAY_SHADOWS, Settings.RayShadow);
      return (
        <>
          <Card Title="Traced shadows" Class="rs-card" Accent={Tones.Shadow}>
            <Metric Value={String(Settings.RayShadowRays)} Unit="shadow rays" Caption={Shadow.desc} />
            <div className="graphic rs-graphic">
              <PenumbraStudy Settings={RayShadowStudy(Settings)} />
            </div>
            <Tiles Label="Ray-traced shadow algorithm" Options={RAY_SHADOWS.map((Option) => ({ ...Option, line: Option.desc.split(";")[1]?.trim() }))} Active={Settings.RayShadow} Choose={(Id) => Assign({ RayShadow: Id })} />
            {Slide("Shadow rays", "RayShadowRays", 1, 16)}
            {Slide("Penumbra softness", "RaySoftness", 0.25, 2.5, 2, "×")}
            {TierPick("Shadow quality", "RayShadowQuality", RayShadowPatch)}
          </Card>
        </>
      );
    },
    ao: () => (
      <>
          <Card Title="Traced ambient occlusion" Class="rs-card rc-ao-card" Accent={Tones.Occlusion}>
            <Metric Value={Settings.RayAo ? (Settings.RayAoMethod === "traced_gi" ? "GI" : String(Settings.RayAoRays)) : "Off"} Unit={Settings.RayAo ? (Settings.RayAoMethod === "traced_gi" ? "occlusion" : "AO rays / pixel") : ""} Caption={Settings.RayAo ? `${Find(RAY_AO, Settings.RayAoMethod).desc}${Settings.RayAoMethod === "traced_gi" ? "" : ` Rays reach ${Settings.RayAoRadius.toFixed(2)} m.`}` : "No ambient occlusion on the ray tracer."} />
            <div className="graphic rs-graphic">
              <OcclusionStudy Method={Settings.RayAo ? Settings.RayAoMethod : "off"} Count={Settings.RayAoRays} Radius={Settings.RayAoRadius / 5} />
            </div>
            {Switch("Traced ambient occlusion", "RayAo")}
            {Settings.RayAo && (
              <>
                <Tiles Label="Ray-traced AO method" Options={RAY_AO.map((Option) => ({ ...Option, line: Option.desc.split(",")[0] }))} Active={Settings.RayAoMethod} Choose={(Id) => Assign({ RayAoMethod: Id })} />
                {Settings.RayAoMethod !== "traced_gi" && (
                  <>
                    {Slide("AO rays", "RayAoRays", 1, 16)}
                    {Slide("AO radius", "RayAoRadius", 0.1, 5, 2, "m")}
                  </>
                )}
                {Slide("AO strength", "RayAoStrength", 0, 2, 2, "×")}
              </>
            )}
          </Card>
      </>
    ),
    reflections: () => (
      <>
          <Card Title="Traced reflections" Class="rs-card" Accent={Tones.Reflection}>
            <div className="graphic rs-graphic">
              <BounceStudy Settings={RayBounceStudy(Settings)} />
            </div>
            {Switch("Trace reflections", "RayReflections")}
            {Settings.RayReflections ? (
              <>
                {Slide("Rays", "RayReflectionRays", 1, 8)}
                {Slide("Bounces", "RayReflectionBounces", 1, 3)}
                {TierPick("Reflection quality", "RayReflectionQuality", RayReflectionPatch)}
              </>
            ) : (
              <p className="rs-note">Reflections show the sky, clouds, moon and stars only.</p>
            )}
          </Card>
      </>
    ),
  };

  //── MatCap ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const Matcap = {
    shadows: () => {
      const Shadow = Find(MATCAP_SHADOWS, Settings.MatcapShadow);
      return (
        <>
        <Card Title="Studio shadow" Class="rs-card" Accent={Tones.Shadow}>
          <Metric Value={Settings.MatcapShadow === "none" ? "Off" : String(Math.round(Settings.MatcapShadowStrength * 100))} Unit={Settings.MatcapShadow === "none" ? "" : "% strength"} Caption={`${Shadow.pick}: ${Shadow.desc.charAt(0).toLowerCase() + Shadow.desc.slice(1)}`} />
          <div className="graphic rs-graphic">
            <StudioShadowStudy Mode={Settings.MatcapShadow} Strength={Settings.MatcapShadowStrength} Softness={Settings.MatcapShadowSoftness} Light={Settings.MatcapLight} />
          </div>
          <Tiles Label="MatCap shadow algorithm" Options={MATCAP_SHADOWS.map((Option) => ({ ...Option, line: Option.desc }))} Active={Settings.MatcapShadow} Choose={(Id) => Assign({ MatcapShadow: Id })} />
          {Settings.MatcapShadow !== "none" && (
            <>
              {Slide("Shadow strength", "MatcapShadowStrength", 0, 1, 2)}
              {Settings.MatcapShadow !== "cavity" && Slide("Shadow softness", "MatcapShadowSoftness", 0.25, 2.5, 2, "×")}
            </>
          )}
        </Card>
        </>
      );
    },
    lighting: () => (
      <>
        <Card Title="Studio light" Class="rs-card">
          {Slide("Light angle", "MatcapLight", 0, 360, 0, "°")}
          {Slide("Rim", "MatcapRim", 0, 1, 2)}
          <Control Field={{ Label: "Clay tint", Control: "Colour" }} Value={Settings.MatcapTint} Change={(Next) => Assign({ MatcapTint: Next })} />
          {Switch("Wire overlay", "MatcapWire")}
          <p className="rs-note">No GI and no SDF: MatCap reads shape only.</p>
        </Card>
      </>
    ),
    matcap: () => {
      const Channel = Find(MATCAP_CHANNELS, Settings.MatcapChannel);
      return (
        <>
        <Card Title="MatCap type" Class="rs-card rc-matcap-card">
          <div className="rc-matcap-stage">
            <MatcapBall Settings={Settings} SetLight={(Next) => Assign({ MatcapLight: Next })} />
            <small>drag around the sphere to move the light</small>
          </div>
          <Segments Label="Channel" Options={MATCAP_CHANNELS.map((Option) => [Option.id, Option.label])} Active={Settings.MatcapChannel} Choose={(Id) => Assign({ MatcapChannel: Id })} />
          <p className="rs-note">{Channel.desc}</p>
          {(Settings.MatcapChannel === "cavity" || Settings.MatcapChannel === "shaded") && Slide("Cavity", "MatcapCavity", 0, 1, 2)}
        </Card>
        </>
      );
    },
  };

  const Sections = { pbr: Pbr, sdf: Sdf, ray: Ray, matcap: Matcap }[Active.id];
  const Pages = [
    { Id: "overview", Label: "Overview", Content: Wrap("overview", Overview()) },
    ...RenderPages[Active.id].map(([Id, Label]) => ({ Id, Label, Content: Wrap(Id, Sections[Id]()) })),
    { Id: "output", Label: "Output", Content: Wrap("output", Output()) },
  ];
  return (
    <div className="rc-settings" data-render-component={Component} data-render-type={Active.id}>
      <InspectorTabs key={Active.id} Owner={`render-${Owner?.Id || "camera"}-${Active.id}`} Look="arc" Pages={Pages} Request={Wanted} />
    </div>
  );
}
