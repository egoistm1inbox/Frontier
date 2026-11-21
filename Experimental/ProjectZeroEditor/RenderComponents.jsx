//============================================================================================================================================
//                                                          RENDERCOMPONENTS.JSX
//============================================================================================================================================
// 🎛️ Render settings as camera components. Every camera (Editor, Cine and any placed from Construct) has five component rows, split
// by render path: Render Engine (engine, quality tier, output), MatCap, Shadow Maps, SDF Tracing and Ray Tracing. All five edit the
// camera's one Values["Render Settings"] record (RenderSettings.js: option lists, presets and the engine → GI coupling from the
// FrontierWorldMirror source). Each component says whether the current engine uses it. Browser authoring only: no renderer is driven.

import React from "react";
import {
  RenderSettingsKey,
  ResolveRenderSettings,
  CanonicalRenderSettings,
  SHADOW_ALGORITHMS,
  GI_ALGORITHMS,
  REFLECTION_ALGORITHMS,
  RENDER_ENGINES,
  SDF_PENUMBRA_MODES,
  QUALITY_PRESETS,
  RENDER_SCALES,
  MATCAP_CHANNELS,
  ShadowQualityPatch,
  GiQualityPatch,
  ReflectionQualityPatch,
  MasterQualityPatch,
  EnginePatch,
  MasterTier,
  UsesShadowMap,
  UsesPcss,
  SampleBudget,
  Find,
} from "./RenderSettings.js";
import { PenumbraStudy, HemisphereStudy, BounceStudy, ScaleStudy, KernelStudy, SdfTraceStudy, MatcapBall, BudgetBar } from "./RenderStudies.jsx";
import "./RenderSettings.css";

const Tones = { Shadow: "#7ab8ff", Gi: "#7be0ad", Reflection: "#c5a3ff" };
const Traced = ["highend_bvh4_gi", "pt_realtime", "pt_final"];
const MapAlgorithms = SHADOW_ALGORITHMS.filter((Option) => Option.id !== "bvh");

// Component, baked icon, description, the engine that runs it (for the "Use …" button).
export const RenderComponentTypes = [
  ["Render Engine", "render-settings", "Engine, quality tier and output", null],
  ["MatCap", "render-matcap", "Studio sphere shading for the MatCap engine", "matcap"],
  ["Shadow Maps", "render-shadow-maps", "Raster shadows: PCSS, SMRT and PCF", "openpbr_direct"],
  ["SDF Tracing", "render-sdf", "Distance-field penumbra and cone GI", "gtx_sdf_gi"],
  ["Ray Tracing", "render-ray-tracing", "BVH shadows, GI and reflections", "highend_bvh4_gi"],
];

// Engine families, in ladder order.
export const EngineFamilies = [
  ["MatCap", ["matcap"]],
  ["Raster", ["openpbr_direct"]],
  ["SDF", ["gtx_sdf_gi"]],
  ["Ray traced", Traced],
];

// Which render components the current settings actually use.
export function RenderUse(Settings) {
  const Matcap = Settings.RenderEngine === "matcap", Pathed = Traced.includes(Settings.RenderEngine);
  return {
    "Render Engine": true,
    MatCap: Matcap,
    "Shadow Maps": !Matcap && !Pathed && UsesShadowMap(Settings),
    "SDF Tracing": !Matcap && (Settings.RenderEngine === "gtx_sdf_gi" || Settings.GiAlgorithm === "sdf"),
    "Ray Tracing": !Matcap && (Pathed || Settings.ShadowAlgorithm === "bvh" || Settings.GiAlgorithm === "bvh" || Settings.ReflectionAlgorithm === "bvh"),
  };
}

const TierName = (Settings) => {
  const Tier = MasterTier(Settings);
  return Tier < 0 ? "Custom tiers" : QUALITY_PRESETS[Tier].label;
};

// Outliner value line for a render component.
export function RenderSummary(Component, Values = {}) {
  const Settings = ResolveRenderSettings(Values[RenderSettingsKey]);
  const Idle = RenderUse(Settings)[Component] ? "" : " · idle";
  if (Component === "Render Engine") return `${Find(RENDER_ENGINES, Settings.RenderEngine).short} · ${TierName(Settings)} · ${Settings.RenderScale} %`;
  if (Component === "MatCap") return `${Find(MATCAP_CHANNELS, Settings.MatcapChannel).label} · light ${Settings.MatcapLight}°` + Idle;
  if (Component === "Shadow Maps") {
    const Map_ = UsesShadowMap(Settings) ? Find(SHADOW_ALGORITHMS, Settings.ShadowAlgorithm).pick : "Off";
    return `${Map_} · ${Settings.ShadowMapRes}²` + Idle;
  }
  if (Component === "SDF Tracing") return `${Find(SDF_PENUMBRA_MODES, Settings.SdfPenumbraMode).pick} · ${Settings.GiCones} cones` + Idle;
  const Passes = [Settings.ShadowAlgorithm === "bvh" && "shadows", Settings.GiAlgorithm === "bvh" && "GI", Settings.ReflectionAlgorithm === "bvh" && "reflections"].filter(Boolean);
  return (Passes.length ? "Traced " + Passes.join(", ") : "Nothing traced") + Idle;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   SHARED PIECES
//------------------------------------------------------------------------------------------------------------------------

// Radio tiles: a small grid of choices with a short line each.
function Tiles({ Label, Options, Active, Choose, Columns = 2 }) {
  return (
    <div className="rc-tiles" role="radiogroup" aria-label={Label} style={{ "--rc-columns": Columns }}>
      {Options.map((Option) => (
        <button key={Option.id} type="button" role="radio" aria-checked={Option.id === Active} onClick={() => Choose(Option.id)}>
          <b>{Option.title || Option.pick || Option.label}</b>
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

// Whether the current engine runs this component, with a one-click switch to the engine that does.
function UseStrip({ Component, Settings, Assign }) {
  const Engine = Find(RENDER_ENGINES, Settings.RenderEngine);
  const On = RenderUse(Settings)[Component];
  const Target = RenderComponentTypes.find(([Name]) => Name === Component)?.[3];
  return (
    <div className={"rc-use" + (On ? " on" : "")} data-in-use={On}>
      <i />
      <span>
        <b>{On ? "In use" : "Not used"}</b>
        <small>{`${Engine.pick || Engine.short} ${On ? "uses" : "doesn't use"} these settings`}</small>
      </span>
      {!On && Target && (
        <button type="button" onClick={() => Assign(EnginePatch(Target))}>
          Use {Find(RENDER_ENGINES, Target).pick || Find(RENDER_ENGINES, Target).short}
        </button>
      )}
    </div>
  );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   COMPONENT CARDS
//------------------------------------------------------------------------------------------------------------------------

export function RenderComponentCards({ Component, Owner, Values, Change, Kit, Scene }) {
  const { Card, Control, Metric } = Kit;
  const Settings = ResolveRenderSettings(Values[RenderSettingsKey]);
  const Assign = (Patch) => Change(RenderSettingsKey, { ...Settings, ...Patch });
  const Budget = SampleBudget(Settings);
  const Tiers = QUALITY_PRESETS.map((Preset) => Preset.label);
  const Use = RenderUse(Settings);
  const Slide = (Label, Key, Minimum, Maximum, Decimals = 0, Unit = "") => (
    <Control
      Field={{ Label, Minimum, Maximum, Decimals, Unit, Default: CanonicalRenderSettings[Key] }}
      Value={Settings[Key]}
      Change={(Next) => Assign({ [Key]: Decimals ? Next : Math.round(Next) })}
    />
  );
  const Switch = (Label, On, Flip) => <Control Field={{ Label, Control: "Switch" }} Value={On} Change={Flip} />;
  const TierPick = (Label, Key, Patch) => <Control Field={{ Label, Control: "Select", Options: Tiers }} Value={Settings[Key]} Change={(Index) => Assign(Patch(Index))} />;
  const Strip = <UseStrip Component={Component} Settings={Settings} Assign={Assign} />;

  if (Component === "Render Engine") {
    const Tier = MasterTier(Settings);
    const Changed = Object.keys(CanonicalRenderSettings).filter((Key) => Settings[Key] !== CanonicalRenderSettings[Key]).length;
    const Engine = Find(RENDER_ENGINES, Settings.RenderEngine);
    return (
      <div className="rc-cards" data-render-component={Component}>
        <Card Title="Engine" Class="rs-card rc-engine-card">
          <Metric Value={Engine.short} Unit={`engine ${Engine.ordinal}`} Caption={Engine.desc} />
          <div className="rc-families">
            {EngineFamilies.map(([Family, Ids]) => (
              <div key={Family} className="rc-family" data-family={Family}>
                <span>{Family}</span>
                <div>
                  {Ids.map((Id) => {
                    const Each = Find(RENDER_ENGINES, Id);
                    return (
                      <button key={Id} type="button" aria-pressed={Settings.RenderEngine === Id} onClick={() => Assign(EnginePatch(Id))} title={Each.desc}>
                        <i>{Each.ordinal}</i>
                        {Each.pick || Each.label.replace(/^\d\.\s*/, "")}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="rc-uses" aria-label="Components this engine uses">
            {RenderComponentTypes.slice(1).map(([Name]) => {
              const Row = Scene?.Rows?.find((Each) => Each.Parent === Owner.Id && Each.Component === Name);
              return (
                <button key={Name} type="button" className={Use[Name] ? "on" : ""} disabled={!Row} onClick={() => Row && Scene.SelectRow(Row.Id)}>
                  <i />
                  {Name}
                </button>
              );
            })}
          </div>
        </Card>
        <Card Title="Quality" Class="rs-card">
          <Metric Value={Budget.Total.toFixed(Budget.Total < 10 ? 1 : 0)} Unit="samples / pixel" Caption={`${Tier < 0 ? "Custom: the passes use different tiers" : QUALITY_PRESETS[Tier].label + " on every pass"}${Budget.Scale !== 1 ? ` · × ${Budget.Scale.toFixed(2)} for scale` : ""}`} />
          <div className="graphic rs-graphic">
            <BudgetBar Budget={Budget} Tones={Tones} />
          </div>
          <Segments Label="Global quality tier" Options={QUALITY_PRESETS.map((Preset) => [Preset.id, Preset.label.replace(" (GTX)", "")])} Active={Tier} Choose={(Index) => Assign(MasterQualityPatch(Index))} />
          <p className="rs-note">A tier sets shadow, GI and reflection counts together; each component can still change its own.</p>
        </Card>
        <Card Title="Output" Class="rs-card">
          <Metric Value={String(Settings.RenderScale)} Unit="% scale" Caption={`Exposure gain ${Settings.ExposureGain.toFixed(2)} × · edge AA ${Settings.AntiAliasing ? "on" : "off"}`} />
          <div className="graphic rs-graphic">
            <ScaleStudy Settings={Settings} />
          </div>
          {Slide("Exposure gain", "ExposureGain", 0.2, 3.5, 2, "×")}
          <Segments Label="Resolution scale" Options={RENDER_SCALES.map((Each) => [Each, Each + " %"])} Active={Settings.RenderScale} Choose={(Next) => Assign({ RenderScale: Next })} />
          {Switch("Edge anti-aliasing", Settings.AntiAliasing, (Next) => Assign({ AntiAliasing: Next }))}
        </Card>
        <div className="rc-reset">
          <span>{Changed ? `${Changed} of ${Object.keys(CanonicalRenderSettings).length} settings differ from the defaults` : "Source defaults"} · this camera only</span>
          <button type="button" disabled={!Changed} onClick={() => Change(RenderSettingsKey, { ...CanonicalRenderSettings })}>
            Reset
          </button>
        </div>
      </div>
    );
  }

  if (Component === "MatCap") {
    const Channel = Find(MATCAP_CHANNELS, Settings.MatcapChannel);
    return (
      <div className="rc-cards" data-render-component={Component}>
        {Strip}
        <Card Title="Studio sphere" Class="rs-card rc-matcap-card">
          <div className="rc-matcap-stage">
            <MatcapBall Settings={Settings} SetLight={(Next) => Assign({ MatcapLight: Next })} />
            <small>drag around the sphere to move the light</small>
          </div>
          <Segments Label="Channel" Options={MATCAP_CHANNELS.map((Option) => [Option.id, Option.label])} Active={Settings.MatcapChannel} Choose={(Id) => Assign({ MatcapChannel: Id })} />
          <p className="rs-note">{Channel.desc}</p>
        </Card>
        <Card Title="Studio light" Class="rs-card">
          {Slide("Light angle", "MatcapLight", 0, 360, 0, "°")}
          {Slide("Rim", "MatcapRim", 0, 1, 2)}
          {Slide("Cavity", "MatcapCavity", 0, 1, 2)}
          <Control Field={{ Label: "Clay tint", Control: "Colour" }} Value={Settings.MatcapTint} Change={(Next) => Assign({ MatcapTint: Next })} />
          {Switch("Wire overlay", Settings.MatcapWire, (Next) => Assign({ MatcapWire: Next }))}
          <p className="rs-note">No GI, no SDF and no shadows: MatCap reads shape only.</p>
        </Card>
      </div>
    );
  }

  if (Component === "Shadow Maps") {
    const Mapped = UsesShadowMap(Settings);
    const Shadow = Find(SHADOW_ALGORITHMS, Settings.ShadowAlgorithm);
    const Texel = ((40 / Settings.ShadowMapRes) * (Settings.HalfResShadows ? 2 : 1) * 100).toFixed(1);
    return (
      <div className="rc-cards" data-render-component={Component}>
        {Strip}
        <Card Title="Shadow map" Class="rs-card" Accent={Tones.Shadow}>
          <Metric Value={Mapped ? `${Settings.ShadowMapRes}²` : "Off"} Unit={Mapped ? "texels" : ""} Caption={Mapped ? `${Texel} cm per texel across a 40 m light view · ${Shadow.desc}` : "Shadows are ray traced; pick an algorithm to go back to a map."} />
          <div className="graphic rs-graphic">
            <KernelStudy Settings={Mapped ? Settings : { ...Settings, ShadowAlgorithm: "contact_pcss" }} />
          </div>
          <Tiles
            Label="Map algorithm"
            Options={MapAlgorithms.map((Option) => ({ ...Option, line: Option.desc.split(".")[0] }))}
            Active={Mapped ? Settings.ShadowAlgorithm : null}
            Choose={(Id) => Assign({ ShadowAlgorithm: Id })}
          />
          <Segments Label="Map resolution" Options={[[1024, "1024²"], [2048, "2048²"]]} Active={Settings.ShadowMapRes} Choose={(Next) => Assign({ ShadowMapRes: Next })} />
          {TierPick("Shadow quality", "ShadowQuality", ShadowQualityPatch)}
          {Switch("Half-resolution shadows", Settings.HalfResShadows, (Next) => Assign({ HalfResShadows: Next }))}
          {UsesPcss(Settings) && Switch("Plane filter", Settings.PlaneFilter, (Next) => Assign({ PlaneFilter: Next }))}
        </Card>
        <Card Title="Penumbra" Class="rs-card" Accent={Tones.Shadow}>
          <Metric Value={Settings.ShadowSoftness.toFixed(2)} Unit="× softness" Caption={`Area emitters ${Settings.EmissiveShadowMode}`} />
          <div className="graphic rs-graphic">
            <PenumbraStudy Settings={Mapped ? Settings : { ...Settings, ShadowAlgorithm: "contact_pcss" }} />
          </div>
          {Slide("Penumbra softness", "ShadowSoftness", 0.25, 2.5, 2, "×")}
          {UsesPcss(Settings) && Slide("PCSS taps", "PcssTaps", 8, 48)}
          {Settings.ShadowAlgorithm === "smrt" && Slide("SMRT march steps", "SmrtRays", 2, 12)}
          {Settings.ShadowAlgorithm === "contact_pcss" && Slide("Contact trace rays", "ShadowRays", 1, 16)}
          <Control Field={{ Label: "Area emitters", Control: "Select", Options: ["Shadowed", "Unshadowed"] }} Value={Settings.EmissiveShadowMode === "unshadowed" ? 1 : 0} Change={(Index) => Assign({ EmissiveShadowMode: Index ? "unshadowed" : "shadowed" })} />
        </Card>
      </div>
    );
  }

  if (Component === "SDF Tracing") {
    const Mode = Find(SDF_PENUMBRA_MODES, Settings.SdfPenumbraMode);
    const Cones = Settings.GiAlgorithm === "sdf";
    return (
      <div className="rc-cards" data-render-component={Component}>
        {Strip}
        <Card Title="Distance-field penumbra" Class="rs-card" Accent={Tones.Gi}>
          <Metric Value={String(Mode.ordinal)} Unit={Mode.pick} Caption={Mode.desc} />
          <div className="graphic rs-graphic">
            <SdfTraceStudy Settings={Settings} Ordinal={Mode.ordinal} />
          </div>
          <ol className="rc-rail" aria-label="Penumbra mode">
            {SDF_PENUMBRA_MODES.map((Each) => (
              <li key={Each.id}>
                <button type="button" aria-pressed={Each.id === Settings.SdfPenumbraMode} onClick={() => Assign({ SdfPenumbraMode: Each.id })}>
                  <i>{Each.ordinal}</i>
                  <span>
                    <b>{Each.pick}</b>
                    <small>{Each.desc}</small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </Card>
        <Card Title="Cone GI" Class="rs-card" Accent={Tones.Gi}>
          <Metric Value={Cones ? String(Settings.GiCones) : "Off"} Unit={Cones ? "cones" : ""} Caption={Cones ? `Bounce × ${Settings.GiIntensity.toFixed(2)} · ${QUALITY_PRESETS[Settings.GiQuality].label}` : Settings.GiAlgorithm === "bvh" ? "GI is ray traced (see Ray Tracing)." : "Direct light and ambient fill only."} />
          <div className="graphic rs-graphic">
            <HemisphereStudy Settings={Cones ? Settings : { ...Settings, GiAlgorithm: "off" }} />
          </div>
          {Switch("SDF cone GI", Cones, (Next) => Assign({ GiAlgorithm: Next ? "sdf" : "off" }))}
          {Cones && (
            <>
              {Slide("Cone directions", "GiCones", 4, 14)}
              {Slide("Bounce intensity", "GiIntensity", 0, 2.5, 2, "×")}
              {TierPick("GI quality", "GiQuality", GiQualityPatch)}
            </>
          )}
          {Slide("Sky & ambient fill", "FillBoost", 0.2, 2.5, 2, "×")}
        </Card>
      </div>
    );
  }

  // Ray Tracing: one lane per traced pass, each switched on its own.
  const TracedShadows = Settings.ShadowAlgorithm === "bvh", TracedGi = Settings.GiAlgorithm === "bvh", TracedReflections = Settings.ReflectionAlgorithm === "bvh";
  const Rays = (TracedShadows ? Settings.ShadowRays : 0) + (TracedGi ? Settings.GiSamples * 2 : 0) + (TracedReflections ? Settings.ReflectionRays * Settings.ReflectionBounces : 0);
  return (
    <div className="rc-cards" data-render-component={Component}>
      {Strip}
      <Card Title="Ray budget" Class="rs-card" Accent={Tones.Reflection}>
        <Metric Value={String(Rays)} Unit="rays / pixel" Caption={`${[TracedShadows, TracedGi, TracedReflections].filter(Boolean).length} of 3 passes traced through the BVH${Traced.includes(Settings.RenderEngine) ? ` · ${Find(RENDER_ENGINES, Settings.RenderEngine).short} traces everything` : ""}`} />
        <div className="graphic rs-graphic">
          <BudgetBar Budget={{ Shadow: TracedShadows ? Settings.ShadowRays : 0, Gi: TracedGi ? Settings.GiSamples * 2 : 0, Reflection: TracedReflections ? Settings.ReflectionRays * Settings.ReflectionBounces : 0 }} Tones={Tones} />
        </div>
        <div className="rc-lanes">
          {[["Shadows", TracedShadows, Tones.Shadow, (Next) => Assign({ ShadowAlgorithm: Next ? "bvh" : "contact_pcss" })], ["GI", TracedGi, Tones.Gi, (Next) => Assign({ GiAlgorithm: Next ? "bvh" : "off" })], ["Reflections", TracedReflections, Tones.Reflection, (Next) => Assign({ ReflectionAlgorithm: Next ? "bvh" : "env" })]].map(([Label, On, Tone, Flip]) => (
            <button key={Label} type="button" role="switch" aria-checked={On} aria-label={"Trace " + Label} onClick={() => Flip(!On)} style={{ "--rc-tone": Tone }}>
              <i />
              {Label}
              <small>{On ? "traced" : "off"}</small>
            </button>
          ))}
        </div>
      </Card>
      {TracedShadows && (
        <Card Title="Traced shadows" Class="rs-card" Accent={Tones.Shadow}>
          <div className="graphic rs-graphic">
            <PenumbraStudy Settings={Settings} />
          </div>
          {Slide("Shadow rays", "ShadowRays", 1, 16)}
          {Slide("Penumbra softness", "ShadowSoftness", 0.25, 2.5, 2, "×")}
        </Card>
      )}
      {TracedGi && (
        <Card Title="Traced GI" Class="rs-card" Accent={Tones.Gi}>
          <div className="graphic rs-graphic">
            <HemisphereStudy Settings={Settings} />
          </div>
          {Slide("Samples / pixel", "GiSamples", 2, 20)}
          {Slide("Bounce intensity", "GiIntensity", 0, 2.5, 2, "×")}
          {TierPick("GI quality", "GiQuality", GiQualityPatch)}
        </Card>
      )}
      {TracedReflections && (
        <Card Title="Traced reflections" Class="rs-card" Accent={Tones.Reflection}>
          <div className="graphic rs-graphic">
            <BounceStudy Settings={Settings} />
          </div>
          {Slide("Rays", "ReflectionRays", 1, 8)}
          {Slide("Bounces", "ReflectionBounces", 1, 3)}
          {TierPick("Reflection quality", "ReflectionQuality", ReflectionQualityPatch)}
        </Card>
      )}
      {!TracedReflections && <p className="rs-note">Reflections show the sky, clouds, moon and stars only. {Find(REFLECTION_ALGORITHMS, "env").desc}</p>}
      {!TracedGi && Settings.GiAlgorithm !== "off" && <p className="rs-note">GI: {Find(GI_ALGORITHMS, Settings.GiAlgorithm).label} (SDF Tracing).</p>}
    </div>
  );
}
