//============================================================================================================================================
//                                                          RENDERSETTINGSCARDS.JSX
//============================================================================================================================================
// 🎛️ Render settings cards shown under every camera row (Editor Camera, Cine Camera and each camera placed from Construct). Each camera
// stores its own copy in Values["Render Settings"]. Pages, presets and the engine → GI coupling follow the FrontierWorldMirror inspector
// (unassignedinbox/Frontier, arena/28ada475-frontier); the cards use the editor's own Card / Control / Metric. No renderer is driven.

import React, { useState } from "react";
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
import "./RenderSettings.css";

const Tones = { Shadow: "#7ab8ff", Gi: "#7be0ad", Reflection: "#c5a3ff" };
const Pages = [
  ["quality", "Quality"],
  ["lighting", "Lighting"],
  ["output", "Output"],
];

//------------------------------------------------------------------------------------------------------------------------
//                                                   STUDIES
//------------------------------------------------------------------------------------------------------------------------

// Engine ladder: the six engines as rising steps, the active one lit.
function EngineLadder({ Active }) {
  const Step = 300 / RENDER_ENGINES.length;
  return (
    <svg className="rs-study" viewBox="0 0 300 106" role="img" aria-label="Render engine ladder">
      {RENDER_ENGINES.map((Engine, Index) => {
        const Height = 22 + Index * 11, X = Index * Step + 3, On = Engine.id === Active;
        return (
          <g key={Engine.id}>
            <rect x={X} y={82 - Height} width={Step - 6} height={Height} rx="5" fill={On ? "#e6e6e6" : "#2a2a2a"} stroke={On ? "#ffffff" : "#ffffff14"} />
            <text x={X + (Step - 6) / 2} y={78} textAnchor="middle" style={{ fill: On ? "#151515" : "#8a8a8a", fontSize: 13 }}>{Engine.ordinal}</text>
            <text x={X + (Step - 6) / 2} y={98} textAnchor="middle" style={{ fill: On ? "#ececec" : "#7a7a7a", fontSize: 10.5 }}>{Engine.short}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Area light over an occluder: umbra and penumbra on the ground follow the softness; ticks show shadow-map texels or traced rays.
function PenumbraStudy({ Settings }) {
  const Ground = 110, Light = 30, Blocker = 66, Reach = (Ground - Light) / (Blocker - Light);
  const Width = 14 + 34 * Settings.ShadowSoftness, Centre = 150;
  const [Ll, Lr] = [Centre - Width / 2, Centre + Width / 2];
  const [O1, O2] = [118, 182];
  const At = (L, O) => L + (O - L) * Reach;
  const OuterLeft = At(Lr, O1), InnerLeft = At(Ll, O1), InnerRight = At(Lr, O2), OuterRight = At(Ll, O2);
  const UmbraLeft = Math.min(InnerLeft, (InnerLeft + InnerRight) / 2), UmbraRight = Math.max(UmbraLeft, InnerRight);
  const Map_ = UsesShadowMap(Settings);
  const Texel = (Settings.ShadowMapRes === 1024 ? 12 : 6) * (Settings.HalfResShadows ? 2 : 1);
  const Rays = Settings.ShadowAlgorithm === "bvh" || Settings.ShadowAlgorithm === "contact_pcss" ? Settings.ShadowRays : Settings.ShadowAlgorithm === "smrt" ? Settings.SmrtRays : 0;
  const Probe = (OuterLeft + InnerLeft) / 2;
  return (
    <svg className="rs-study" viewBox="0 0 300 132" role="img" aria-label="Shadow penumbra study">
      <defs>
        <linearGradient id="rs-pen-left" x1="0" x2="1">
          <stop offset="0" stopColor="#7ab8ff" stopOpacity="0" />
          <stop offset="1" stopColor="#7ab8ff" stopOpacity="0.42" />
        </linearGradient>
        <linearGradient id="rs-pen-right" x1="1" x2="0">
          <stop offset="0" stopColor="#7ab8ff" stopOpacity="0" />
          <stop offset="1" stopColor="#7ab8ff" stopOpacity="0.42" />
        </linearGradient>
      </defs>
      <rect x={Ll} y={Light - 3} width={Width} height="6" rx="3" fill="#f2e2b8" />
      <text x="8" y="14" style={{ fill: "#8a8a8a", fontSize: 12.5 }}>area light · softness {Settings.ShadowSoftness.toFixed(2)}</text>
      <g stroke="#ffffff22" strokeWidth="0.8" strokeDasharray="2 3">
        <path d={`M${Lr} ${Light}L${OuterLeft} ${Ground}M${Ll} ${Light}L${InnerLeft} ${Ground}M${Ll} ${Light}L${OuterRight} ${Ground}M${Lr} ${Light}L${InnerRight} ${Ground}`} />
      </g>
      <rect x={O1} y={Blocker - 3} width={O2 - O1} height="6" rx="2" fill="#5a5a5a" />
      <rect x={OuterLeft} y={Ground - 7} width={Math.max(0, InnerLeft - OuterLeft)} height="7" fill="url(#rs-pen-left)" />
      <rect x={UmbraLeft} y={Ground - 7} width={Math.max(0, UmbraRight - UmbraLeft)} height="7" fill="#7ab8ff" opacity="0.5" />
      <rect x={InnerRight} y={Ground - 7} width={Math.max(0, OuterRight - InnerRight)} height="7" fill="url(#rs-pen-right)" />
      <path d={`M8 ${Ground}H292`} stroke="#6a6a6a" />
      {Map_ &&
        Array.from({ length: Math.floor(284 / Texel) + 1 }, (_, Index) => (
          <path key={Index} d={`M${8 + Index * Texel} ${Ground}v4`} stroke="#ffffff26" />
        ))}
      {Array.from({ length: Math.min(16, Rays) }, (_, Index) => {
        const Target = Ll + ((Index + 0.5) / Math.min(16, Rays)) * Width;
        return <path key={"r" + Index} d={`M${Probe} ${Ground}L${Target} ${Light}`} stroke="#7ab8ff" strokeOpacity="0.55" strokeWidth="0.7" />;
      })}
      <text x="8" y={Ground + 18} style={{ fill: "#8a8a8a", fontSize: 12.5 }}>
        penumbra {(InnerLeft - OuterLeft).toFixed(0)} px · {Map_ ? `${Settings.ShadowMapRes}² map${Settings.HalfResShadows ? " · half res" : ""}` : "no shadow map"}
      </text>
    </svg>
  );
}

// Hemisphere above a shading point: cones for SDF GI, cosine-distributed rays for BVH GI, a flat dome for ambient fill.
function HemisphereStudy({ Settings }) {
  const Cx = 150, Cy = 104, R = 82;
  const Mode = Settings.GiAlgorithm;
  return (
    <svg className="rs-study" viewBox="0 0 300 130" role="img" aria-label="Indirect light hemisphere">
      <path d={`M${Cx - R} ${Cy}A${R} ${R} 0 0 1 ${Cx + R} ${Cy}`} fill={Mode === "off" ? "#7be0ad14" : "none"} stroke="#ffffff1c" />
      <path d={`M14 ${Cy}H286`} stroke="#6a6a6a" />
      {Mode === "sdf" &&
        Array.from({ length: Settings.GiCones }, (_, Index) => {
          const Angle = Math.PI * ((Index + 0.5) / Settings.GiCones), Half = (Math.PI / Settings.GiCones) * 0.36;
          const P = (A, L) => [Cx + Math.cos(Math.PI - A) * L, Cy - Math.sin(A) * L];
          const [X1, Y1] = P(Angle - Half, R * 0.94), [X2, Y2] = P(Angle + Half, R * 0.94);
          return <path key={Index} d={`M${Cx} ${Cy}L${X1} ${Y1}A${R * 0.94} ${R * 0.94} 0 0 1 ${X2} ${Y2}Z`} fill="#7be0ad" fillOpacity={0.12 + 0.22 * Math.sin(Angle)} stroke="#7be0ad" strokeOpacity="0.5" strokeWidth="0.7" />;
        })}
      {Mode === "bvh" &&
        Array.from({ length: Settings.GiSamples }, (_, Index) => {
          // Cosine-weighted directions on a Fibonacci spiral, projected onto the section plane.
          const U = (Index + 0.5) / Settings.GiSamples, Phi = Index * 2.39996;
          const Sin = Math.sqrt(U), X = Sin * Math.cos(Phi), Up = Math.sqrt(1 - U);
          const Length = R * (0.55 + 0.4 * Up);
          return <path key={Index} d={`M${Cx} ${Cy}L${Cx + X * Length} ${Cy - Up * Length}`} stroke="#7be0ad" strokeOpacity="0.75" strokeWidth="0.9" />;
        })}
      <circle cx={Cx} cy={Cy} r="3" fill="#e6e6e6" />
      <text x="14" y="14" style={{ fill: "#8a8a8a", fontSize: 12.5 }}>
        {Mode === "sdf" ? `${Settings.GiCones} cones through the distance field` : Mode === "bvh" ? `${Settings.GiSamples} samples / pixel · 2 bounces` : "no tracing · sky and ambient fill only"}
      </text>
      <text x="286" y="124" textAnchor="end" style={{ fill: "#8a8a8a", fontSize: 12.5 }}>fill × {Settings.FillBoost.toFixed(2)}</text>
    </svg>
  );
}

// A reflected ray between the floor and a wall, one segment per bounce; extra rays fan out at the first hit.
function BounceStudy({ Settings }) {
  const Traced = Settings.ReflectionAlgorithm === "bvh";
  const Points = [[40, 18], [118, 98]];
  const Bounces = Traced ? Settings.ReflectionBounces : 0;
  for (let Index = 0; Index < Bounces; Index++) Points.push(Index % 2 === 0 ? [256, 52 + Index * 6] : [170 + Index * 6, 98]);
  const Spread = Traced ? Settings.ReflectionRays : 0;
  return (
    <svg className="rs-study" viewBox="0 0 300 118" role="img" aria-label="Reflection bounce study">
      <path d="M10 98H290M256 4V98" stroke="#6a6a6a" />
      <circle cx="40" cy="18" r="4" fill="#e6e6e6" />
      <polyline points={Points.map((Point) => Point.join(",")).join(" ")} fill="none" stroke="#c5a3ff" strokeWidth="1.3" />
      {Array.from({ length: Math.max(0, Spread - 1) }, (_, Index) => {
        const Tilt = ((Index + 1) / Spread - 0.5) * 0.6;
        return <path key={Index} d={`M118 98l${Math.cos(-0.62 + Tilt) * 70} ${Math.sin(-0.62 + Tilt) * 70}`} stroke="#c5a3ff" strokeOpacity="0.4" strokeWidth="0.8" />;
      })}
      {!Traced && <path d="M118 98L170 22" stroke="#c5a3ff" strokeDasharray="3 3" />}
      {Points.slice(1).map(([X, Y], Index) => (
        <circle key={Index} cx={X} cy={Y} r="2.6" fill="#c5a3ff" />
      ))}
      <text x="14" y="114" style={{ fill: "#8a8a8a", fontSize: 12.5 }}>
        {Traced ? `${Settings.ReflectionRays} rays · ${Settings.ReflectionBounces} bounce${Settings.ReflectionBounces > 1 ? "s" : ""}` : "sky, clouds, moon and stars only"}
      </text>
    </svg>
  );
}

// Output frame against the internal render frame for the resolution scale.
function ScaleStudy({ Settings }) {
  const Fraction = Settings.RenderScale / 100;
  const Width = 176, Height = 99, Left = 62, Top = 8;
  const Inner = [Width * Math.min(Fraction, 1.25), Height * Math.min(Fraction, 1.25)];
  return (
    <svg className="rs-study" viewBox="0 0 300 126" role="img" aria-label="Resolution scale study">
      <rect x={Left} y={Top} width={Width} height={Height} rx="4" fill="#202020" stroke="#ffffff30" />
      <rect x={Left + (Width - Inner[0]) / 2} y={Top + (Height - Inner[1]) / 2} width={Inner[0]} height={Inner[1]} rx="3" fill="none" stroke="#e6e6e6" strokeDasharray={Fraction > 1 ? "4 3" : "none"} />
      <text x={Left + Width / 2} y={Top + Height / 2 + 3} textAnchor="middle" style={{ fill: "#cfcfcf", fontSize: 9 }}>
        {Math.round(1920 * Fraction)} × {Math.round(1080 * Fraction)}
      </text>
      <text x={Left + Width / 2} y={Top + Height + 14} textAnchor="middle" style={{ fill: "#8a8a8a", fontSize: 12.5 }}>
        for 1920 × 1080 output · {Fraction > 1 ? "supersampled" : Fraction < 1 ? "upscaled" : "native"}
      </text>
    </svg>
  );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   CARDS
//------------------------------------------------------------------------------------------------------------------------

export default function RenderSettingsCards({ Subject, Values, Change, Kit }) {
  const { Card, Control, Metric, Icon } = Kit;
  const [Page, Turn] = useState("quality");
  const Settings = ResolveRenderSettings(Values[RenderSettingsKey]);
  const Assign = (Patch) => Change(RenderSettingsKey, { ...Settings, ...Patch });
  const Budget = SampleBudget(Settings);
  const Engine = Find(RENDER_ENGINES, Settings.RenderEngine);
  const Penumbra = Find(SDF_PENUMBRA_MODES, Settings.SdfPenumbraMode);
  const Shadow = Find(SHADOW_ALGORITHMS, Settings.ShadowAlgorithm);
  const Gi = Find(GI_ALGORITHMS, Settings.GiAlgorithm);
  const Reflection = Find(REFLECTION_ALGORITHMS, Settings.ReflectionAlgorithm);
  const Tier = MasterTier(Settings);
  const Changed = Object.keys(CanonicalRenderSettings).filter((Key) => Settings[Key] !== CanonicalRenderSettings[Key]).length;
  // Selects in this editor carry an index; these map an option list onto one.
  const Pick = (Label, List, Id, Apply, Disabled = false) => (
    <Control
      Field={{ Label, Control: "Select", Options: List.map((Option) => Option.pick || Option.label) }}
      Value={Math.max(0, List.findIndex((Option) => Option.id === Id))}
      Disabled={Disabled}
      Change={(Index) => Apply(List[Index].id)}
    />
  );
  const Slide = (Label, Key, Minimum, Maximum, Decimals = 0, Unit = "") => (
    <Control
      Field={{ Label, Minimum, Maximum, Decimals, Unit, Default: CanonicalRenderSettings[Key] }}
      Value={Settings[Key]}
      Change={(Next) => Assign({ [Key]: Decimals ? Next : Math.round(Next) })}
    />
  );
  const Switch = (Label, Key) => <Control Field={{ Label, Control: "Switch" }} Value={Settings[Key]} Change={(Next) => Assign({ [Key]: Next })} />;
  const Tiers = QUALITY_PRESETS.map((Preset) => Preset.label);
  return (
    <section className="rs-section" data-render-settings={Subject.Id}>
      <div className="rs-heading">
        <Icon Name="render-settings" Size={30} />
        <div>
          <b>Render settings</b>
          <small>{Subject.Name} · this camera's own copy</small>
        </div>
        <button type="button" disabled={!Changed} onClick={() => Change(RenderSettingsKey, { ...CanonicalRenderSettings })} title="Restore the source defaults">
          Reset
        </button>
      </div>
      <div className="rs-summary" aria-label="Active shadow, GI and reflection methods">
        <span><i style={{ background: Tones.Shadow }} />{Shadow.label}{UsesShadowMap(Settings) ? ` · ${Settings.ShadowMapRes}²` : ""}</span>
        <span><i style={{ background: Tones.Gi }} />{Gi.label}</span>
        <span><i style={{ background: Tones.Reflection }} />{Reflection.label}</span>
      </div>
      <div className="rs-tabs" role="tablist" aria-label="Render settings pages">
        {Pages.map(([Key, Label]) => (
          <button key={Key} type="button" role="tab" aria-selected={Page === Key} onClick={() => Turn(Key)}>
            {Label}
          </button>
        ))}
      </div>

      {Page === "quality" && (
        <>
          <Card Title="World render engine" Class="rs-card">
            <Metric Value={Budget.Total.toFixed(Budget.Total < 10 ? 1 : 0)} Unit="samples / pixel" Caption={`Shadows ${Budget.Shadow} per light · GI ${Budget.Gi} · reflections ${Budget.Reflection}${Budget.Scale !== 1 ? ` · × ${Budget.Scale.toFixed(2)} for scale` : ""}`} />
            <div className="graphic rs-graphic">
              <EngineLadder Active={Settings.RenderEngine} />
            </div>
            {Pick("Engine", RENDER_ENGINES, Settings.RenderEngine, (Id) => Assign(EnginePatch(Id)))}
            <p className="rs-note">{Engine.desc}</p>
            {Pick("Penumbra mode", SDF_PENUMBRA_MODES, Settings.SdfPenumbraMode, (Id) => Assign({ SdfPenumbraMode: Id }))}
            <p className="rs-note">{Penumbra.desc}</p>
            <Control
              Field={{ Label: "Global quality tier", Control: "Select", Options: [...Tiers, "Custom (mixed tiers)"] }}
              Value={Tier < 0 ? Tiers.length : Tier}
              Change={(Index) => Index < Tiers.length && Assign(MasterQualityPatch(Index))}
            />
            <p className="rs-note">A tier sets shadow, GI and reflection counts together. Changing one of them afterwards shows Custom.</p>
          </Card>
        </>
      )}

      {Page === "lighting" && (
        <>
          <Card Title="Shadows" Class="rs-card" Accent={Tones.Shadow}>
            <Metric Value={String(Budget.Shadow)} Unit={Settings.ShadowAlgorithm === "pcss" || Settings.ShadowAlgorithm === "pcf" ? "taps / light" : "samples / light"} Caption={Shadow.desc} />
            <div className="graphic rs-graphic">
              <PenumbraStudy Settings={Settings} />
            </div>
            {Pick("Algorithm", SHADOW_ALGORITHMS, Settings.ShadowAlgorithm, (Id) => Assign({ ShadowAlgorithm: Id }))}
            <Control Field={{ Label: "Shadow quality", Control: "Select", Options: Tiers }} Value={Settings.ShadowQuality} Change={(Index) => Assign(ShadowQualityPatch(Index))} />
            {UsesShadowMap(Settings) && (
              <Control Field={{ Label: "Shadow map resolution", Control: "Select", Options: ["1024²", "2048²"] }} Value={Settings.ShadowMapRes === 1024 ? 0 : 1} Change={(Index) => Assign({ ShadowMapRes: Index ? 2048 : 1024 })} />
            )}
            <Control Field={{ Label: "Area emitters", Control: "Select", Options: ["Shadowed", "Unshadowed"] }} Value={Settings.EmissiveShadowMode === "unshadowed" ? 1 : 0} Change={(Index) => Assign({ EmissiveShadowMode: Index ? "unshadowed" : "shadowed" })} />
            {Slide("Penumbra softness", "ShadowSoftness", 0.25, 2.5, 2, "×")}
            {UsesPcss(Settings) && Slide("PCSS taps", "PcssTaps", 8, 48)}
            {Settings.ShadowAlgorithm === "smrt" && Slide("SMRT rays", "SmrtRays", 2, 12)}
            {(Settings.ShadowAlgorithm === "contact_pcss" || Settings.ShadowAlgorithm === "bvh") && Slide(Settings.ShadowAlgorithm === "bvh" ? "BVH shadow rays" : "Contact trace rays", "ShadowRays", 1, 16)}
            {UsesPcss(Settings) && Switch("Plane filter", "PlaneFilter")}
            {UsesShadowMap(Settings) && Switch("Half-resolution shadows", "HalfResShadows")}
          </Card>
          <Card Title="Global illumination" Class="rs-card" Accent={Tones.Gi}>
            <Metric Value={Settings.GiAlgorithm === "off" ? "Off" : Settings.GiIntensity.toFixed(2)} Unit={Settings.GiAlgorithm === "off" ? "" : "× bounce"} Caption={Gi.desc} />
            <div className="graphic rs-graphic">
              <HemisphereStudy Settings={Settings} />
            </div>
            {Pick("Algorithm", GI_ALGORITHMS, Settings.GiAlgorithm, (Id) => Assign({ GiAlgorithm: Id }))}
            {Settings.GiAlgorithm !== "off" && (
              <>
                <Control Field={{ Label: "GI quality", Control: "Select", Options: Tiers }} Value={Settings.GiQuality} Change={(Index) => Assign(GiQualityPatch(Index))} />
                {Settings.GiAlgorithm === "sdf" && Slide("Cone directions", "GiCones", 4, 14)}
                {Settings.GiAlgorithm === "bvh" && Slide("Samples / pixel", "GiSamples", 2, 20)}
                {Slide("Bounce intensity", "GiIntensity", 0, 2.5, 2, "×")}
              </>
            )}
            {Slide("Sky & ambient fill", "FillBoost", 0.2, 2.5, 2, "×")}
          </Card>
          <Card Title="Reflections" Class="rs-card" Accent={Tones.Reflection}>
            <Metric Value={String(Budget.Reflection)} Unit="rays / pixel" Caption={Reflection.desc} />
            <div className="graphic rs-graphic">
              <BounceStudy Settings={Settings} />
            </div>
            {Pick("Mode", REFLECTION_ALGORITHMS, Settings.ReflectionAlgorithm, (Id) => Assign({ ReflectionAlgorithm: Id }))}
            {Settings.ReflectionAlgorithm !== "env" && (
              <>
                <Control Field={{ Label: "Reflection quality", Control: "Select", Options: Tiers }} Value={Settings.ReflectionQuality} Change={(Index) => Assign(ReflectionQualityPatch(Index))} />
                {Slide("Rays", "ReflectionRays", 1, 8)}
                {Slide("Bounces", "ReflectionBounces", 1, 3)}
              </>
            )}
          </Card>
        </>
      )}

      {Page === "output" && (
        <Card Title="Camera & output" Class="rs-card">
          <Metric Value={String(Settings.RenderScale)} Unit="% scale" Caption={`Exposure gain ${Settings.ExposureGain.toFixed(2)} × · edge AA ${Settings.AntiAliasing ? "on" : "off"}`} />
          <div className="graphic rs-graphic">
            <ScaleStudy Settings={Settings} />
          </div>
          {Slide("Exposure gain", "ExposureGain", 0.2, 3.5, 2, "×")}
          <Control Field={{ Label: "Resolution scale", Control: "Select", Options: RENDER_SCALES.map((Each) => Each + " %") }} Value={RENDER_SCALES.indexOf(Settings.RenderScale)} Change={(Index) => Assign({ RenderScale: RENDER_SCALES[Index] })} />
          {Switch("Edge anti-aliasing", "AntiAliasing")}
        </Card>
      )}
      <p className="rs-note rs-footer">
        {Changed ? `${Changed} of ${Object.keys(CanonicalRenderSettings).length} settings differ from the defaults.` : "Source defaults."} Stored on this camera only · browser draft, no renderer connected.
      </p>
    </section>
  );
}
