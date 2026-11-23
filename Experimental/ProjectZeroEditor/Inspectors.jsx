import { CloudEdit, CloudValue } from "./CloudSpecification.js";
import CloudDeckPanel from "./CloudDeckPanel.jsx";
import { FogBeamChamber } from "./FogPanel.jsx";
import HeightFogVisual from "./HeightFogVisual.jsx";
import { HeightFogLayer, FogLightStudy, AerialRidges } from "./FogCards.jsx";
import FracturePanel from "./FracturePanel.jsx";
import { RenderComponentCards } from "./RenderComponents.jsx";
import { UvPreviewCard, WorkspaceLaunchCard, FracturePreviewCard, SdfPreviewCard, LodPreviewCard } from "./WorkspacePreviews.jsx";
import { ComponentPanel, ComponentSheet, ComponentsCard, ComponentStack, OwnerKind } from "./ObjectComponents.jsx";
import AtmosphereLab, { AtmosphereProfile } from "./AtmosphereLab.jsx";
import MoonGlobe from "./MoonGlobe.jsx";
import {
  GraphContext,
  SunGraph,
  FogGraph,
  FogSpectrum,
  FogDensity,
  CloudSection,
  CloudBounds,
} from "./LiveGraph.jsx";
import FogShapePanel from "./FogShapePanel.jsx";
import { IsEditorCamera } from "./ScenePolicy.js";
import TransformPanel from "./TransformPanel.jsx";
import { CameraMountPage } from "./CameraMount.jsx";
import MaterialPanel from "./MaterialPanel.jsx";
import PrimitiveInspector, { ObjectComponentCards } from "./PrimitiveInspector.jsx";
import { EffectSheets, IsEffectPanel, EffectStudy } from "./PostEffects.jsx";
import {
  EnvironmentPanel,
  EnvironmentSheet,
  EnvironmentStudy,
  EnvironmentSymbols,
} from "./EnvironmentLight.jsx";
import PostEffectIcon, { IsEffectIcon } from "./PostEffectIcons.jsx";
import { LightGlyphSource } from "./LightGlyphs.js";
import { ColourSlotDropProps } from "./ColourCodex.js";
import ActionIcon, { QuickSymbol } from "./ActionIcon.jsx";
import React, { useState, useEffect, useRef } from "react";
import { SunGizmo } from "../FrontierEditor/environment-graphics.jsx";
import { DepthOfField } from "../FrontierEditor/camera-graphics.jsx";
import { Iris, CloudCoverage } from "../FrontierEditor/property-graphics.jsx";
import {
  CelestialRotation,
  TwinkleSignal,
} from "../FrontierEditor/celestial-controls.jsx";
import { LunarSphere } from "../FrontierEditor/moon-controls.jsx";
import Native from "./NativePanels.json";
import { SpecifyPanels, SpecificationNoteMark, MoonSlotCount, MoonPresets, MoonPresetSizes, SensorGates, GodRaysPanel } from "./ProjectZeroSpecification.js";
import { Solar } from "./Solar.mjs";
import SunCard from "./SunCards.jsx";
import { SkyMedium, SunAngularRadius } from "./SkyShader.js";
import { SunLight } from "./Viewport3D.jsx";
import { TransmittanceMap, SkyViewMap, SunLightingMap, SunDiscMap, StarMap, StarSettings, FlareAtlasMap, LightingSpan, TransmittanceSpan, TransmittanceElevation } from "./BakedMaps.js";
import { FlareSettings } from "./LensFlare.js";
import { BakedMap, FlarePreview } from "./BakedMapCards.jsx";
import { InspectorTabs } from "./InspectorTabs.jsx";
import { CameraBodies, CameraBodyOf } from "./EditorAssets.js";
import "./SunCards.css";
import { SensorField } from "./OpticalGraphic.jsx";
import SensorFormats, { Formats } from "./SensorFormats.jsx";
import { WorkspacePanel } from "./Workspaces.jsx";
import { VehicleInspector, VehiclePanel, VehicleSheet } from "./VehicleComponents.jsx";
import { VehicleAssetInspector, VehicleAssetPanel, VehicleAssetSheet } from "./VehicleAssetInspector.jsx";

// Native sheets with the Follow-up 48 Project Zero specification overlay (ProjectZeroSpecification.js).
export const Panels = SpecifyPanels({
  ...Native.Panels,
  ...EffectSheets,
  [EnvironmentPanel]: EnvironmentSheet,
  [VehiclePanel]: VehicleSheet,
  [VehicleAssetPanel]: VehicleAssetSheet,
  [ComponentPanel]: ComponentSheet,
});
// 📝 marker beside a label: the field is in the editor but not in the Project Zero specification. Kept for the user to decide.
export function SpecificationNote({ Field }) {
  const Note = Field?.SpecificationNote || Field?.Note;
  if (!Note) return null;
  return (
    <span className="specification-note" title={"Not in the Project Zero specification · " + Note + " Kept until you decide."} aria-label={"Specification note: " + Note} data-specification-note={Field.Label}>
      {SpecificationNoteMark}
    </span>
  );
}
const VerticalFov = (Focal, Sensor, Aspect) => ((2 * Math.atan(Sensor / Aspect / (2 * Focal)) * 180) / Math.PI).toFixed(1) + "°";
export function Glyph({ Name, Size = 18 }) {
  if (Name === "celestial-orbit")
    return (
      <svg
        width={Size}
        height={Size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M19.071 19.071A10 10 0 1 1 20.91 7.46" />
        <circle cx="19" cy="5" r="2" />
        <circle cx="5" cy="19" r="2" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  const Aliases = {
    gear: "SettingsGear",
    sun: "SunIllumination",
    filter: "SlidersQuality",
    eye: "EyeVisible",
    back: "ChevronBack",
    arrow: "ChevronForward",
    chevron: "ChevronDown",
    close: "CloseCross",
  };
  const NativePath = window.NativeAssets?.Glyphs[Aliases[Name] || Name];
  if (NativePath)
    return (
      <svg
        width={Size}
        height={Size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={NativePath} />
      </svg>
    );
  return (
    <svg
      width={Size}
      height={Size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {Name === "close" ? (
        <path d="m7 7 10 10M17 7 7 17" />
      ) : Name === "plus" ? (
        <path d="M12 5v14M5 12h14" />
      ) : Name === "chevron" ? (
        <path d="m8 10 4 4 4-4" />
      ) : Name === "search" ? (
        <>
          <circle cx="10" cy="10" r="6" />
          <path d="m15 15 5 5" />
        </>
      ) : Name === "eye" ? (
        <>
          <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : Name === "power" ? (
        <>
          <path d="M12 3v9M7 5a8 8 0 1 0 10 0" />
        </>
      ) : Name === "arrow" ? (
        <path d="m9 5 7 7-7 7" />
      ) : Name === "back" ? (
        <path d="m15 5-7 7 7 7" />
      ) : Name === "gear" ? (
        <>
          <path d="m10 2 4 0 .7 3 2 .9 2.7-.8 2 3.5-2.2 2.1v2.6l2.2 2.2-2 3.5-2.7-.8-2 .9-.7 3h-4l-.7-3-2-.9-2.7.8-2-3.5L4.8 13v-2.6L2.6 8.3l2-3.5 2.7.8 2-.9Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : Name === "filter" ? (
        <>
          <path d="M4 6h16M4 12h16M4 18h16" />
          <circle cx="8" cy="6" r="2" fill="#171717" />
          <circle cx="16" cy="12" r="2" fill="#171717" />
          <circle cx="10" cy="18" r="2" fill="#171717" />
        </>
      ) : Name === "check" ? (
        <path d="m5 12 4 4L19 6" />
      ) : Name === "lock" ? (
        <>
          <rect x="6" y="10" width="12" height="11" rx="3" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </>
      ) : Name === "bake" ? (
        <>
          <path d="M12 5h7l2 2v12l-2 2H7l-2-2v-6M2 9h11L9 5m4 4-4 4M3 2v3M1.5 3.5h3" />
          <rect x="14" y="14" width="3" height="3" />
        </>
      ) : Name === "play" ? (
        <path d="m9 6 9 6-9 6Z" />
      ) : Name === "pause" ? (
        <path d="M8 6v12M16 6v12" />
      ) : (
        <>
          <circle cx="12" cy="12" r="4" />
          {Array.from({ length: 8 }, (_, Index) => (
            <path
              key={Index}
              transform={`rotate(${Index * 45} 12 12)`}
              d="M12 2v2"
            />
          ))}
        </>
      )}
    </svg>
  );
}
export function Icon({ Name, Size = 24 }) {
  if (Name === "outliner-precipitation")
    return (
      <span
        className="native-icon precipitation-symbol"
        data-native-icon={Name}
        style={{ color: "#91b7cd", display: "inline-flex" }}
      >
        <ActionIcon Name="rain" Size={Size} />
      </span>
    );
  if (IsEffectIcon(Name)) return <PostEffectIcon Name={Name} Size={Size} />;
  const Source = LightGlyphSource(Name) || window.NativeAssets?.Icons[Name];
  return Source ? (
    <img
      className="native-icon"
      width={Size}
      height={Size}
      src={Source}
      alt=""
      data-native-icon={Name}
    />
  ) : (
    <Glyph Name={Name} Size={Size} />
  );
}
export function Control({
  Field,
  Value,
  Change,
  Disabled = false,
  Compact = false,
}) {
  const LatestChange = useRef(Change);
  LatestChange.current = Change;
  if (!Field) return null;
  const ReadOnly = Disabled || Field.ReadOnly;
  const Label = Field.Label;
  if (Field.Control === "Readout")
    return (
      <div className="readout">
        <span>{Label}<SpecificationNote Field={Field} /></span>
        <output>{Value ?? Field.Default}</output>
      </div>
    );
  if (Field.Control === "Switch")
    return (
      <label className="switch-row">
        <span>{Label}<SpecificationNote Field={Field} /></span>
        <button
          className={"toggle " + (Value ? "on" : "")}
          role="switch"
          aria-checked={!!Value}
          aria-label={Label}
          disabled={ReadOnly}
          onClick={() => Change(!Value)}
        >
          <i />
        </button>
      </label>
    );
  if (Field.Control === "Select")
    return (
      <label className="field">
        <span>{Label}<SpecificationNote Field={Field} /></span>
        <select
          value={Value ?? 0}
          disabled={ReadOnly}
          aria-label={Label}
          onChange={(Event) => Change(+Event.target.value)}
        >
          {Field.Options.map((Option, Index) => (
            <option value={Index} key={Index}>
              {Option}
            </option>
          ))}
        </select>
      </label>
    );
  if (Field.Control === "Colour")
    return (
      <label
        className="colour-field"
        {...(!ReadOnly
          ? ColourSlotDropProps({
              Label,
              AssignHex: (Hex) => LatestChange.current(Hex),
            })
          : {})}
      >
        <span>{Label}<SpecificationNote Field={Field} /></span>
        <input
          aria-label={Label}
          type="color"
          value={Value || "#ffffff"}
          disabled={ReadOnly}
          onChange={(Event) => LatestChange.current(Event.target.value)}
        />
        <output>{(Value || "#ffffff").toUpperCase()}</output>
      </label>
    );
  if (Field.Control === "Axes")
    return (
      <div className="field">
        <span>{Label}<SpecificationNote Field={Field} /></span>
        <div className="axes">
          {["X", "Y", "Z"].map((Axis, Index) => (
            <label key={Axis}>
              <b>{Axis}</b>
              <input
                type="number"
                aria-label={Label + " " + Axis}
                disabled={ReadOnly}
                value={Value?.[Index] ?? 0}
                onChange={(Event) =>
                  Change(
                    (Value || [0, 0, 0]).map((Number, Slot) =>
                      Slot === Index ? +Event.target.value : Number,
                    ),
                  )
                }
              />
            </label>
          ))}
        </div>
      </div>
    );
  const Minimum = Field.Minimum ?? 0,
    Maximum = Field.Maximum ?? 100,
    Decimals = Field.Decimals ?? 2;
  const Safe = Number.isFinite(+Value) ? +Value : Field.Default;
  // Curve (optional power, e.g. 3) gives the low end of a wide range most of the slider travel.
  const Curve = Field.Curve > 0 && Field.Curve !== 1 ? Field.Curve : 0;
  const Linear = Math.min(1, Math.max(0, (Safe - Minimum) / (Maximum - Minimum)));
  const Travel = Curve ? Linear ** (1 / Curve) : Linear;
  // DisplayScale shows a stored fraction as a percentage (e.g. cloud cover 0–1 shown 0–100 %); storage is unchanged.
  const Shown = Field.DisplayScale > 0 ? Field.DisplayScale : 1;
  const Write = (Input) => {
    const Numeric = +Input;
    if (Number.isFinite(Numeric))
      Change(Math.min(Maximum, Math.max(Minimum, Numeric)));
  };
  return (
    <label
      className={"field " + (Compact ? "compact" : "")}
      data-native-property={Label}
    >
      <span>{Label}<SpecificationNote Field={Field} /></span>
      <div className="slider-pill">
        <div className="split-value">
          <input
            aria-label={Label + " value"}
            type="number"
            min={Minimum * Shown}
            max={Maximum * Shown}
            step={10 ** -Decimals}
            disabled={ReadOnly}
            value={Number((Safe * Shown).toFixed(Decimals))}
            onChange={(Event) => Write(Event.target.value / Shown)}
          />
          <small>{Field.Unit}</small>
        </div>
        <input
          aria-label={Label}
          type="range"
          min={Curve ? 0 : Minimum}
          max={Curve ? 1 : Maximum}
          step={Curve ? 0.001 : 10 ** -Decimals / Shown}
          value={Curve ? Travel : Safe}
          disabled={ReadOnly}
          style={{
            "--fill": `${100 * Travel}%`,
          }}
          onChange={(Event) =>
            Write(
              Curve
                ? +(Minimum + (Maximum - Minimum) * (+Event.target.value) ** Curve).toFixed(Decimals)
                : Event.target.value,
            )
          }
        />
      </div>
    </label>
  );
}
export function Card({
  Title,
  Children,
  children,
  Height,
  Wide = false,
  Accent,
  Class = "",
  GraphHandled = false,
}) {
  const Mark = {
    "Sun now": "sun",
    "Sun direction": "celestial-orbit",
    "Sunlight intensity": "sun",
    Temperature: "SparklesAntiAliasing",
    "Daylight cycle": "sun",
    "Sun disc": "sun",
    "Sun lighting bake": "bake",
    "Sun disk bake": "bake",
    "Dynamic settings": "celestial-orbit",
  }[Title];
  return (
    <section
      className={"property-card " + (Wide ? "span-two " : "") + Class}
      style={{ minHeight: Height, "--accent": Accent || "#bababa" }}
      data-card={Title}
    >
      <h3>
        {Mark && <Glyph Name={Mark} Size={16} />}
        <span>{Title}</span>
      </h3>
      {children || Children}
    </section>
  );
}
export function Tile({
  Label,
  On,
  Action,
  Disabled = false,
  IconName = null,
  Context = "",
  Large = false,
}) {
  return (
    <button
      className={"quick-tile " + (Large ? "large " : "") + (On ? "on" : "off")}
      disabled={Disabled}
      title={Disabled ? "Not connected in the HTML UI copy" : Label}
      onClick={Action}
      aria-pressed={Disabled ? undefined : !!On}
      aria-label={Label}
      data-quick-action={Label}
    >
      <span className="quick-icon-seat">
        <ActionIcon Name={QuickSymbol(Label, Context, IconName)} Size={26} />
      </span>
      <span className="quick-label">{Label}</span>
      {/* The icon seat carries on/off (lit or dimmed); only an unavailable action is spelled out. */}
      {Disabled && <small className="quick-status">UNAVAILABLE</small>}
    </button>
  );
}
export function Metric({ Value, Unit, Caption }) {
  return (
    <>
      <div className="metric">
        {typeof Value === "string" || typeof Value === "number" ? (
          <>
            <span>{String(Value).split(".")[0]}</span>
            {String(Value).includes(".") && (
              <span className="metric-fraction">
                .{String(Value).split(".").slice(1).join(".")}
              </span>
            )}
          </>
        ) : (
          Value
        )}
        <small>{Unit}</small>
      </div>
      {Caption && <p>{Caption}</p>}
    </>
  );
}
export function EntityNotes({ Value = "", Change }) {
  const [Open, SetOpen] = useState(Boolean(Value));
  if (!Open)
    return (
      <button
        className="entity-notes-add"
        onClick={() => SetOpen(true)}
        aria-label="Add notes"
      >
        <Glyph Name="plus" Size={13} />
        Add notes
      </button>
    );
  return (
    <section className="entity-notes" aria-label="Optional entity notes">
      <div>
        <strong>Notes</strong>
        <small>Optional</small>
        <button onClick={() => SetOpen(false)}>Hide</button>
      </div>
      <textarea
        aria-label="Instance notes"
        placeholder="Purpose, ownership, review notes…"
        value={Value}
        onChange={(Event) => Change(Event.target.value)}
      />
    </section>
  );
}

// Follow-up 65: every paged inspector opens on an Overview page (or its first page) that ends with the same three cards: Quick controls
// (one switch each, lit green when on, grey when off), Tags and Notes. The header no longer carries its own Add notes button there.
export const PanelTags = {
  sun: ["environment", "sky", "light"],
  moon: ["environment", "sky", "night"],
  stars: ["environment", "sky", "night"],
  atmosphere: ["environment", "sky"],
  rainbow: ["environment", "optics"],
  wind: ["environment", "air"],
  "height-fog": ["environment", "fog"],
  "aerial-fog": ["environment", "fog"],
  "local-fog": ["environment", "fog"],
  clouds: ["environment", "weather"],
  "local-cloud": ["environment", "weather"],
  precipitation: ["environment", "weather"],
  "god-rays": ["environment", "light"],
  light: ["lighting"],
  "environment-light": ["lighting", "sky"],
  camera: ["camera"],
  flare: ["camera", "optics"],
  "motion-blur": ["camera", "effect"],
  post: ["post process"],
  "vehicle-asset": ["vehicle"],
};
// The panels whose first page ends with the Tags and Notes cards.
export const NotesInPage = (Panel) => (Object.hasOwn(PanelTags, Panel) && Panel !== "vehicle-asset") || IsEffectPanel(Panel);
// Quick controls: Tiles are { Label, On, Action, Icon, Disabled }.
export function QuickControls({ Tiles, Context = "", Note = null }) {
  const Live = Tiles.filter((Each) => !Each.Disabled);
  return (
    <section className="property-card quick-controls" data-card="Quick controls">
      <h3>
        <span>Quick controls</span>
        <small className="quick-count">
          <b>{Live.filter((Each) => Each.On).length}</b> / {Live.length} on
        </small>
      </h3>
      <div className="quick-grid">
        {Tiles.map((Each) => (
          <Tile key={Each.Label} Label={Each.Label} On={Each.On} Action={Each.Action} IconName={Each.Icon} Context={Context} Disabled={Each.Disabled} />
        ))}
      </div>
      {Note && <p className="card-foot">{Note}</p>}
    </section>
  );
}
// Tags: free words on the row (Values.Tags), starting from the panel's defaults.
export function TagsCard({ Values, Change, Panel }) {
  const Tags = Array.isArray(Values.Tags) ? Values.Tags : PanelTags[Panel] || (IsEffectPanel(Panel) ? ["post process", "effect"] : []);
  const [Draft, EditDraft] = useState("");
  return (
    <section className="property-card tags-card" data-card="Tags">
      <h3>
        <span>Tags</span>
        <small className="quick-count">{Tags.length}</small>
      </h3>
      <div className="tag-list">
        {Tags.map((Tag) => (
          <span className="tag-chip" key={Tag}>
            {Tag}
            <button type="button" aria-label={"Remove tag " + Tag} onClick={() => Change("Tags", Tags.filter((Each) => Each !== Tag))}>
              ×
            </button>
          </span>
        ))}
        <form
          className="tag-add"
          onSubmit={(Event) => {
            Event.preventDefault();
            const Next = Draft.trim();
            if (Next && !Tags.includes(Next)) Change("Tags", [...Tags, Next]);
            EditDraft("");
          }}
        >
          <input aria-label="New tag" placeholder="Add tag" value={Draft} onChange={(Event) => EditDraft(Event.target.value)} />
        </form>
      </div>
    </section>
  );
}
// Notes: the row's notes (Values.Notes, the same text the header's Add notes edits elsewhere).
export function NotesCard({ Values, Change }) {
  return (
    <section className="property-card notes-card" data-card="Notes">
      <h3>
        <span>Notes</span>
      </h3>
      <textarea
        aria-label="Instance notes"
        rows={4}
        placeholder="Purpose, ownership, review notes…"
        value={Values.Notes || ""}
        onChange={(Event) => Change("Notes", Event.target.value)}
      />
    </section>
  );
}

function Bake({ Title, Sun = false }) {
  return (
    <Card Title={Title} Height={Sun ? 225 : 162}>
      {Sun && <small className="procedural-source">Procedural source</small>}
      <div className="bake-content">
        <Tile Label="Use baked image" Disabled Large={Sun} IconName="bake" />
        <div>
          <button disabled>
            <Glyph Name="bake" /> Bake
          </button>
          <button disabled>↥　Load image</button>
          <p>No image source connected.</p>
        </div>
      </div>
      <p className="card-foot">Renderer / imported-image binding unavailable</p>
    </Card>
  );
}
// The bake tab's parts for the BAKING maps (BakedMapCards.jsx).
const BakeKit = { Tile, Glyph };
function MoonImage({ Preset = 0, Phase = 0.62, Size = 150, Rotation = 0 }) {
  return (
    <div
      className="moon-disc"
      style={{
        width: Size,
        height: Size,
        transform: `rotate(${Rotation}deg)`,
        backgroundImage: `linear-gradient(90deg,rgba(0,0,0,${Math.abs(0.5 - Phase) * 1.5}),transparent 65%),url(${window.NativeAssets.Moons[Preset]})`,
      }}
    />
  );
}
export function Inspector({
  Subject,
  Values,
  Change,
  Hidden,
  ToggleHidden,
  OpenShader,
  OpenFracture,
  OpenWind,
  ReferenceCards = null,
  CloudCoverageCards = null,
  ReferenceDetailCards = null,
  Workspace = null,
  OpenWorkspace = null,
  OpenStudio = null, // Follow-up 75: opens a ShaderEditor workspace ("uv", "fracture", "nanite", "sdf") on this object
  SetWorkspace = null,
  Scene = null,
}) {
  const Sheet = Panels[Subject.Panel] || Panels.geometry;
  const [MoonSlot, SelectMoon] = useState(0);
  const Prefix = Subject.Panel === "moon" ? "moon" + MoonSlot + ":" : "";
  const V = (Name) =>
    (["clouds", "local-cloud"].includes(Subject.Panel)
      ? CloudValue(Values, Name, Subject.Panel)
      : Values[Prefix + Name]) ??
    (Subject.Panel === "moon" && Name === "Preset"
      ? MoonSlot
      : Subject.Panel === "moon" && Name === "Visible"
        ? MoonSlot === 0
        : Subject.Panel === "moon" && Name === "Size"
          ? MoonPresetSizes[MoonSlot]
          : Sheet.find((Field) => Field.Label === Name)?.Default);
  const AssignProperty = (Name, Next) => {
    if (
      Subject.Panel === "local-cloud" &&
      ["Base", "Thickness"].includes(Name)
    ) {
      for (const [Key, Numeric] of Object.entries(
        CloudEdit(Values, Name, Next, Subject.Panel),
      ))
        Change(Key, Numeric);
      return;
    }
    Change(Prefix + Name, Next);
    if (Subject.Panel === "moon" && Name === "Preset")
      Change(Prefix + "Size", MoonPresetSizes[Next]);
    if (Subject.Panel === "camera" && Name === "Sensor gate" && SensorGates[Next]?.[1])
      Change("Sensor Width", SensorGates[Next][1]);
    if (Subject.Panel === "camera" && Name === "Sensor Width") Change("Sensor gate", 0);
    if (Subject.Panel === "sun" && Name === "Speed" && Next < 4)
      Change("Day duration", 24 / [1, 8, 30, 100][Next]);
    if (Subject.Panel === "sun" && Name === "Day duration") Change("Speed", 4);
  };
  const Latest = useRef(Values);
  Latest.current = Values;
  // The scene's sky and sun for the BAKING sections' maps (the same readers as the 3D viewport, so both share one bake).
  const Baking = () => {
    const Medium = SkyMedium(Subject.Panel === "atmosphere" ? V : Scene?.Air || (() => undefined));
    return { Medium, Light: SunLight(Subject.Panel === "sun" ? V : Scene?.Sun || (() => undefined), Medium) };
  };
  useEffect(() => {
    if (Subject.Panel !== "sun" || !Values.Animate) return;
    let Before = performance.now();
    const Timer = setInterval(() => {
      const Now = performance.now(),
        Hours = Latest.current["Local Hours"] ?? 12,
        Duration = Latest.current["Day duration"] ?? 3;
      Change(
        "Local Hours",
        (Hours + (((Now - Before) / 1000) * 24) / Duration / 3600) % 24,
      );
      Before = Now;
    }, 100);
    return () => clearInterval(Timer);
  }, [Subject.Id, Values.Animate]);
  // Follow-up 67: Real time sets the sun's date and time from this computer's clock, now and every 20 seconds.
  useEffect(() => {
    if (Subject.Panel !== "sun" || !Values["Real time"]) return;
    const Follow = () => {
      const Now = new Date();
      Change("Local Hours", Now.getHours() + Now.getMinutes() / 60 + Now.getSeconds() / 3600);
      Change("Day of Month", Now.getDate());
      Change("Month", Now.getMonth() + 1);
      Change("Year", Now.getFullYear());
      Change("UTC offset", -Now.getTimezoneOffset() / 60);
    };
    Follow();
    const Timer = setInterval(Follow, 20000);
    return () => clearInterval(Timer);
  }, [Subject.Id, Values["Real time"]]);
  // Labels the panel drew through F; specification fields it did not draw are listed in a closing card.
  const Drawn = new Set();
  const F = (Name, Disabled = false) => {
    Drawn.add(Name);
    const Field = Sheet.find((Item) => Item.Label === Name);
    return Field ? (
      <Control
        key={Name}
        Field={Field}
        Value={V(Name)}
        Change={(Next) => AssignProperty(Name, Next)}
        Disabled={Disabled}
      />
    ) : null;
  };
  const Fields = (...Names) => Names.map((Name) => F(Name));
  // Follow-up 65: the shared first-page cards. Switch(Label, Icon) is a quick control for a switch field (it counts as drawn); a
  // card of fields is Group(Title, ...Labels); TagsAndNotes() is the Tags and Notes cards.
  const Switch = (Label, Icon) => {
    Drawn.add(Label);
    return { Label, Icon, On: !!V(Label), Action: () => AssignProperty(Label, !V(Label)) };
  };
  const Quick = (Tiles, Note = null) => <QuickControls Tiles={Tiles} Context={Subject.Panel} Note={Note} />;
  const Group = (Title, ...Labels) => (
    <Card Title={Title} key={Title}>
      {Fields(...Labels)}
    </Card>
  );
  const TagsAndNotes = () => (
    <>
      <TagsCard Values={Values} Change={Change} Panel={Subject.Panel} />
      <NotesCard Values={Values} Change={Change} />
    </>
  );
  // A sheet-driven inspector in pages: Overview (Top, Quick controls from First and the sheet's switch fields, Tags, Notes), then the
  // other fields by group, one card each: on one Settings page when there are ten or fewer, otherwise a page per group. Skip leaves
  // fields out (another card draws them); Last closes the final page.
  const SheetPages = ({ Owner, Look, Top = null, First = [], Skip = [], Symbols = {}, Last = null, More = [] }) => {
    const Groups = [...new Set(Sheet.map((Field) => Field.Group))]
      .map((Name) => [Name, Sheet.filter((Field) => Field.Group === Name && Field.Control !== "Switch" && !Skip.includes(Field.Label))])
      .filter(([, Members]) => Members.length);
    const Count = Groups.reduce((Sum, [, Members]) => Sum + Members.length, 0);
    const Cards = (List) =>
      List.map(([Name, Members]) => (
        <Card Title={Name} key={Name}>
          {Members.map((Field) => F(Field.Label))}
        </Card>
      ));
    const Switches = Sheet.filter((Field) => Field.Control === "Switch" && !Skip.includes(Field.Label)).map((Field) =>
      Switch(Field.Label, Symbols[Field.Label]),
    );
    const Rest =
      Count <= 10
        ? [{ Id: "settings", Label: "Settings", Content: Cards(Groups) }]
        : Groups.map(([Name, Members]) => ({ Id: Name.toLowerCase().replace(/\W+/g, "-"), Label: Name, Content: Cards([[Name, Members]]) }));
    const Pages = [
      { Id: "overview", Label: "Overview", Content: (<>{Top}{Quick([...First, ...Switches])}{TagsAndNotes()}</>) },
      ...(Groups.length ? Rest : []),
      ...More,
    ];
    if (Last) {
      const End = Pages[Pages.length - 1];
      End.Content = (<>{End.Content}{Last}</>);
    }
    return <InspectorTabs Owner={Owner} Look={Look} Pages={Pages} />;
  };
  const Tiles = (Names, Large = false) => (
    <div className="tiles">
      {Names.map((Name) => (
        <Tile
          key={Name}
          Label={Name}
          Context={Subject.Panel}
          On={V(Name)}
          Large={Large}
          Action={() => AssignProperty(Name, !V(Name))}
        />
      ))}
    </div>
  );
  const Header = (Category, Title = Subject.Name) => (
    <header className="inspector-heading">
      <div className="breadcrumbs">Inspector / {Category}</div>
      <h1 title={Title}>{Title}</h1>
      <p className="eyebrow">{Subject.Description}</p>
      {/* Inspectors with a Notes card on their first page (Follow-up 65) leave the header's Add notes out. */}
      {!NotesInPage(Subject.Panel) && (
        <EntityNotes
          Value={Values.Notes || ""}
          Change={(Next) => Change("Notes", Next)}
        />
      )}
    </header>
  );
  const Capabilities = () => (
    <section
      className="generic-card entity-capabilities"
      data-card="Quick controls"
    >
      <h4>QUICK CONTROLS</h4>
      <div className="tiles">
        <Tile
          Label={Subject.Panel === "post" ? "Enabled" : "Visible"}
          Context={Subject.Panel}
          IconName="visible"
          On={!Hidden}
          Action={ToggleHidden}
        />
        {(Subject.Panel === "geometry"
          ? [
              ["Dynamic", "DYNAMIC", false, "motion"],
              ["Cast shadows", "Cast shadows", true, "shadow"],
              ["GI", "GI", true, "gi"],
              ["Physics", "PHYSICS", false, "collision"],
              ["Locked", "LOCKED", false, "lock"],
            ]
          : Subject.Panel === "light"
            ? [
                ["Cast shadows", "Cast shadows", true, "shadow"],
                ["GI", "GI", true, "gi"],
              ]
            : []
        ).map(([Label, Key, Default, Symbol]) => (
          <Tile
            key={Key}
            Label={Label}
            IconName={Symbol}
            On={Values[Key] ?? Default}
            Action={() => {
              const Next = !(Values[Key] ?? Default);
              Change(Key, Next);
              if (Key === "PHYSICS" && Next) Change("DYNAMIC", true);
              if (Key === "DYNAMIC" && !Next) Change("PHYSICS", false);
            }}
          />
        ))}
      </div>
      {Subject.Panel === "geometry" && (
        <p>
          {Values.DYNAMIC ? "Dynamic object" : "Static object"} ·{" "}
          {Values.PHYSICS ? "Physics requested" : "Physics off"}. Shadows, GI
          and physics are authored flags; native execution is pending.
        </p>
      )}
      {Subject.Panel === "light" && (
        <p>
          Shadow and GI participation are authored flags; native execution is
          pending.
        </p>
      )}
    </section>
  );
  const Showcase = () => (
    <>
      {Header("Geometry")}
      {Workspace && SetWorkspace ? (
        <WorkspacePanel
          Subject={Subject}
          Values={Values}
          Change={Change}
          Workspace={Workspace}
          SetWorkspace={SetWorkspace}
          Kit={{ Card, Control, Metric }}
        />
      ) : (
      <PrimitiveInspector
        Kit={{ Card, Control, Metric }}
        Subject={Subject}
        Values={Values}
        Change={Change}
        Hidden={Hidden}
        ToggleHidden={ToggleHidden}
        MaterialCards={
          <MaterialPanel
            Subject={Subject}
            Values={Values}
            Change={Change}
            Expand={OpenShader}
            Compact
          />
        }
        UvCards={
          <UvPreviewCard
            Subject={Subject}
            Values={Values}
            Open={OpenWorkspace && (() => OpenWorkspace("uv"))}
            Studio={OpenStudio && (() => OpenStudio("uv"))}
            Kit={{ Card, Control, Metric }}
          />
        }
        SdfCards={
          <SdfPreviewCard
            Subject={Subject}
            Values={Values}
            Open={OpenWorkspace && (() => OpenWorkspace("sdf"))}
            Studio={OpenStudio && (() => OpenStudio("sdf"))}
            Kit={{ Card, Control, Metric }}
          />
        }
        LodCards={
          <LodPreviewCard
            Subject={Subject}
            Values={Values}
            Open={OpenWorkspace && (() => OpenWorkspace("lod"))}
            Studio={OpenStudio && (() => OpenStudio("nanite"))}
            Kit={{ Card, Control, Metric }}
          />
        }
        Components={
          <>
            <ComponentsCard
              Owner={Subject}
              Values={Values}
              Scene={Scene}
              Kit={{ Icon }}
            />
            <WorkspaceLaunchCard
              Tool="capture"
              Title="Icon capture"
              Caption="Frame the object in a square box and capture a transparent PNG thumbnail."
              Label="Open Icon Capture"
              Open={OpenWorkspace && (() => OpenWorkspace("capture"))}
              Kit={{ Card }}
            />
          </>
        }
        Focus={Scene?.Focus}
        ComponentPage={
          <ComponentStack
            Owner={Scene?.Rows?.find((Each) => Each.Id === Subject.Id) || Subject}
            Values={Values}
            Change={Change}
            Scene={Scene}
            Focus={Scene?.Focus}
            Kit={{ Card, Control, Metric, Icon }}
            Notes={(Component) => (
              // Stored on the owner under the component's name, so it doesn't overwrite the object's own notes.
              <EntityNotes Value={Values[`${Component} Notes`] || ""} Change={(Next) => Change(`${Component} Notes`, Next)} />
            )}
          />
        }
        ComponentTools={
          <WorkspaceLaunchCard
            Tool="collision"
            Title="Collision fit"
            Caption="Fit box, sphere and capsule proxies, compare how tightly each wraps the object and check the surface is closed."
            Label="Open Collision Fit"
            Open={OpenWorkspace && (() => OpenWorkspace("collision"))}
            Kit={{ Card }}
          />
        }
        FractureCards={
          <>
            <FracturePanel
              Subject={Subject}
              Values={Values}
              Change={Change}
              Expand={OpenFracture}
            />
            <FracturePreviewCard
              Subject={Subject}
              Values={Values}
              Open={OpenWorkspace && (() => OpenWorkspace("fracture"))}
              Studio={OpenStudio && (() => OpenStudio("fracture"))}
              Kit={{ Card, Control, Metric }}
            />
          </>
        }
      />
      )}
    </>
  );
  const Unlock = Values.ReferenceInspector?.Locked && (
    <button onClick={() => Change("ReferenceInspector", { ...Values.ReferenceInspector, Locked: false })}>Unlock editing</button>
  );
  // Follow-up 65: lights open on Overview (the light's summary from its reference sheet, its quick controls, tags, notes) with the
  // light's source and controls on Source. The reference sheet already carries Cast shadows and the light's aim, so the sheet's
  // own Cast shadows tile and LIGHT / AIM groups are left out.
  const LightPages = () => (
    <>
      {Header("Lighting")}
      {Unlock}
      {SheetPages({
        Owner: "light",
        Look: "light",
        Top: ReferenceCards,
        First: [
          { Label: "Visible", Icon: "visible", On: !Hidden, Action: ToggleHidden },
          ...(Subject.ReferenceOnly ? [] : [{ Label: "GI", Icon: "gi", On: Values.GI ?? true, Action: () => Change("GI", !(Values.GI ?? true)) }]),
        ],
        Skip: Sheet.map((Field) => Field.Label),
        More: ReferenceDetailCards ? [{ Id: "source", Label: "Source", Content: ReferenceDetailCards }] : [],
      })}
    </>
  );
  const Generic = () =>
    Subject.Panel === "geometry" && Subject.Parent === "showcase" ? (
      Showcase()
    ) : Subject.Panel === "light" ? (
      LightPages()
    ) : Subject.Panel === "post" ? (
      <>
        {Header("Post processing")}
        {SheetPages({ Owner: "post", Look: "effect", First: [{ Label: "Enabled", Icon: "visible", On: !Hidden, Action: ToggleHidden }] })}
      </>
    ) : Subject.Panel === GodRaysPanel ? (
      <>
        {Header("Environment")}
        {SheetPages({ Owner: "god-rays", Look: "rays", Symbols: { Enabled: "sunlight", "Cloud interaction": "cloud", "Fog interaction": "fog" } })}
      </>
    ) : (
    <>
      {Header(
        Subject.Panel === "light"
          ? "Lighting"
          : Subject.Panel === "geometry"
            ? "Geometry"
            : Subject.Panel === "post"
              ? "Post processing"
              : "Scene",
      )}
      {Subject.Panel === "light" && ReferenceCards}
      {Subject.Panel === "light" && Values.ReferenceInspector?.Locked && (
        <button
          onClick={() =>
            Change("ReferenceInspector", {
              ...Values.ReferenceInspector,
              Locked: false,
            })
          }
        >
          Unlock editing
        </button>
      )}
      {Subject.Panel === "geometry" && (
        <TransformPanel Values={Values} Change={Change} Gizmo />
      )}
      {Capabilities()}
      {Subject.Panel === "light" && ReferenceDetailCards}
      {Subject.Panel === "geometry" && (
        <MaterialPanel
          Subject={Subject}
          Values={Values}
          Change={Change}
          Expand={OpenShader}
          Compact
        />
      )}
      {[...new Set(Sheet.map((Field) => Field.Group))]
        .filter(
          (Group) =>
            Subject.Panel !== "geometry" ||
            !["Transform", "Surface"].includes(Group),
        )
        .map((Group) => (
          <details open className="generic-card" key={Group}>
            <summary>{Group}</summary>
            {Sheet.filter((Field) => Field.Group === Group).map((Field) =>
              F(Field.Label),
            )}
          </details>
        ))}
      {Subject.Panel === "geometry" && (
        <FracturePanel
          Subject={Subject}
          Values={Values}
          Change={Change}
          Expand={OpenFracture}
        />
      )}
    </>
    );
  if (Subject.Panel === ComponentPanel) {
    const Owner = Scene?.Rows?.find((Each) => Each.Id === Subject.Parent);
    return (
      <div className="generic-inspector object-component-inspector" data-panel={Subject.Panel}>
        <header className="inspector-heading">
          <div className="breadcrumbs">Inspector / {Owner ? Owner.Name : "Component"}</div>
          <h1>{Subject.Name}</h1>
          <p className="eyebrow">{Subject.Description}</p>
          {/* Stored on the owner under the component's name, so it doesn't overwrite the object's own notes. */}
          <EntityNotes Value={Values[`${Subject.Component} Notes`] || ""} Change={(Next) => Change(`${Subject.Component} Notes`, Next)} />
        </header>
        {Owner ? (
          <>
            <button type="button" className="vc-asset-link oc-owner" onClick={() => Scene?.SelectRow?.(Owner.Id)} title={`Select ${Owner.Name}`}>
              <Icon Name={Owner.Icon} Size={22} />
              <span>
                <b>{Owner.Name}</b>
                <small>Component of this {OwnerKind(Owner) === "camera" ? "camera" : "object"} · values are stored on it</small>
              </span>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {OwnerKind(Owner) === "camera" ? (
              <RenderComponentCards Component={Subject.Component} Owner={Owner} Values={Values} Change={Change} Kit={{ Card, Control, Metric }} Scene={Scene} />
            ) : (
              <ObjectComponentCards Component={Subject.Component} Owner={Owner} Values={Values} Change={Change} Kit={{ Card, Control, Metric }} />
            )}
          </>
        ) : (
          <p className="vc-note">The object this component belonged to was removed.</p>
        )}
      </div>
    );
  }
  if (Subject.Panel === VehicleAssetPanel)
    return (
      <div className="generic-inspector vehicle-asset-inspector" data-panel={Subject.Panel}>
        {Header("Vehicles")}
        <VehicleAssetInspector Subject={Subject} Values={Values} Change={Change} Kit={{ Card, Metric, Icon }} Scene={Scene} />
      </div>
    );
  if (Subject.Panel === VehiclePanel)
    return (
      <div className="generic-inspector vehicle-component-inspector" data-panel={Subject.Panel}>
        {Header("Vehicle")}
        <VehicleInspector Subject={Subject} Values={Values} Change={Change} Kit={{ Card, Control, Metric, Icon }} Scene={Scene} Hidden={Hidden} ToggleHidden={ToggleHidden} OpenShader={OpenShader} />
      </div>
    );
  const Environment = Subject.Panel === EnvironmentPanel;
  if (IsEffectPanel(Subject.Panel) || Environment) {
    const Symbols = {
      ...EnvironmentSymbols,
      "Object motion": "motion",
      "Camera motion": "orbit",
      "Show mask": "image",
      "Colour drift": "split",
      Coloured: "rainbow",
      Animated: "play",
      "Phosphor mask": "diagnostics",
    };
    return (
      <div className="generic-inspector effect-inspector" data-panel={Subject.Panel}>
        {Header(
          Environment
            ? "Lighting"
            : Subject.Panel === "motion-blur"
              ? "Camera"
              : "Post processing",
        )}
        {SheetPages({
          Owner: Subject.Panel,
          Look: Environment ? "environment" : "effect",
          Top: Environment ? (
            <EnvironmentStudy Read={V} Assign={AssignProperty} Active={!Hidden} />
          ) : (
            <EffectStudy Panel={Subject.Panel} Read={V} Assign={AssignProperty} Active={!Hidden} />
          ),
          First: [{ Label: "Enabled", Icon: "visible", On: !Hidden, Action: ToggleHidden }],
          Symbols,
        })}
      </div>
    );
  }
  if (["geometry", "light", "post", "group"].includes(Subject.Panel))
    return (
      <GraphContext.Provider
        value={
          ["light", "post"].includes(Subject.Panel)
            ? { Panel: Subject.Panel }
            : null
        }
      >
        <div
          className={
            "generic-inspector " +
            (["light", "post"].includes(Subject.Panel)
              ? "environment-live"
              : "")
          }
          data-panel={Subject.Panel}
        >
          {Generic()}
        </div>
      </GraphContext.Provider>
    );
  // Specification controls card (Follow-up 48): fields the specification adds that no panel card draws. Called where it should appear:
  // before a panel's BAKING cards (bakes stay last), otherwise at the end. Fields() calls after it would repeat here.
  let SpecificationPlaced = false;
  const SpecificationCard = () => {
    SpecificationPlaced = true;
    const Undrawn = Sheet.filter((Field) => Field.Added && !Drawn.has(Field.Label));
    const UndrawnGroups = [...new Set(Undrawn.map((Field) => Field.Group))];
    return (
      Undrawn.length > 0 && (
        <Card Title="Specification controls" Wide Class="specification-card">
          <p className="specification-caption">
            {Undrawn[0].Section} · controls added by the Project Zero specification. Authored values only; no renderer is driven.
          </p>
          {UndrawnGroups.map((Group) => (
            <div className="specification-group" key={Group} data-specification-group={Group}>
              <h4>{Group}</h4>
              {Undrawn.filter((Field) => Field.Group === Group).map((Field) =>
                Field.Label === "Vertical FOV" ? (
                  <Control key={Field.Label} Field={Field} Value={VerticalFov(V("Focal Length"), V("Sensor Width"), Subject.Id === "cine" ? 1.5 : 16 / 9)} />
                ) : (
                  <Control
                    key={Field.Label}
                    Field={Field}
                    Value={V(Field.Label)}
                    Change={(Next) => AssignProperty(Field.Label, Next)}
                    Disabled={
                      (Field.Label.startsWith("Manual ") && Field.Label !== "Manual direction" && !V("Manual direction")) ||
                      (Field.Label === "Prism sides" && V("Shape") !== 1) ||
                      (Field.Label === "Ortho width" && V("Projection") !== 1) ||
                      (Field.Label === "Zodiacal radiance" && !V("Zodiacal light")) ||
                      (["Atmosphere intensity", "Thickness scale", "Atmosphere tint"].includes(Field.Label) && !V("Has atmosphere")) ||
                      (Field.Label === "Location lag speed" && !V("Location lag")) ||
                      (Field.Label === "Rotation lag speed" && !V("Rotation lag")) ||
                      (Field.Label === "Maximum lag distance" && !V("Location lag")) ||
                      (["Maximum blur radius", "Bokeh blades"].includes(Field.Label) && !V("Depth of field")) ||
                      (Field.Label.startsWith("Vignette ") && !V("Vignette"))
                    }
                  />
                ),
              )}
            </div>
          ))}
        </Card>
      )
    );
  };
  let Content;
  if (Subject.Panel === "sun") {
    const Time = V("Local Hours");
    const Solved = Solar({
      LocalHours: Time,
      Month: V("Month"),
      Day: V("Day of Month"),
      Latitude: V("Latitude"),
      Longitude: V("Longitude"),
    });
    // Manual direction overrides the solved angles (date, time and location still drive the readouts below).
    const Manual = !!V("Manual direction");
    const Elevation = Manual ? V("Manual elevation") : Solved.Elevation,
      Azimuth = Manual ? V("Manual azimuth") : Solved.Azimuth;
    // Follow-up 65: Overview (the old Now and Light pages in one), then Temperature, Sun disc and Dynamic each on their own page, then
    // Baking. Each value shows once: the time in Sun now (and the Daylight cycle), the solved angles in Sun direction.
    for (const Name of ["Manual direction", "Manual azimuth", "Manual elevation", "Cast shadows", "Animate", "Real time"]) Drawn.add(Name);
    // Steering by hand: Manual direction takes the sun over from its present angles, then the changed angles land.
    const Steer = (Angles) => {
      if (!Manual) {
        AssignProperty("Real time", false);
        AssignProperty("Animate", false);
        AssignProperty("Manual azimuth", Math.round(Azimuth * 10) / 10);
        AssignProperty("Manual elevation", Math.round(Elevation * 10) / 10);
        AssignProperty("Manual direction", true);
      }
      for (const [Name, Angle] of Object.entries(Angles)) AssignProperty(Name, Angle);
    };
    Content = (
      <>
        {Header("Environment")}
        <InspectorTabs Owner="sun" Look="arc" Pages={[
          { Id: "overview", Label: "Overview", Content: (<>
        <Card Title="Sun now" Class="sun-now" GraphHandled>
          <SunCard V={V} Change={AssignProperty} Air={Scene?.Air} />
        </Card>
        {Quick([
          { Label: "Enabled", Icon: "sunlight", On: !Hidden, Action: ToggleHidden },
          // Follow-up 67: Real time replaces Cast shadows (the sun always shadows the viewport): the sun follows this computer's clock.
          // It, the Day cycle and Manual direction each take the sun over, so turning one on turns the other two off.
          {
            Label: "Real time",
            Icon: "clock",
            On: !!V("Real time"),
            Action: () => {
              const Next = !V("Real time");
              AssignProperty("Real time", Next);
              if (Next) {
                AssignProperty("Animate", false);
                AssignProperty("Manual direction", false);
              }
            },
          },
          {
            ...Switch("Animate", "cycle"),
            Label: "Day cycle",
            Action: () => {
              const Next = !V("Animate");
              AssignProperty("Animate", Next);
              if (Next) {
                AssignProperty("Real time", false);
                AssignProperty("Manual direction", false);
              }
            },
          },
          {
            ...Switch("Manual direction", "compass"),
            Action: () => {
              const Next = !V("Manual direction");
              AssignProperty("Manual direction", Next);
              if (Next) {
                AssignProperty("Real time", false);
                AssignProperty("Animate", false);
              }
            },
          },
        ])}
        {/* Follow-up 76: the original Sun direction card (follow-up 65) is back: the two angles over the orbit gizmo. With Manual direction on,
            dragging the gizmo's sun steers it like the Manual azimuth / elevation sliders below. */}
        <Card Title="Sun direction" Class="direction-card">
          {/* Follow-up 81: Azimuth and Elevation are sliders. They show the solved angles; moving one (or dragging the gizmo's sun) turns
              Manual direction on from where the sun is now, so it never jumps, and turns Real time and the Day cycle off. */}
          <div className="direction-sliders">
            <Control Field={{ ...Sheet.find((Each) => Each.Label === "Manual azimuth"), Label: "Azimuth" }} Value={Math.round(Azimuth * 10) / 10} Change={(Next) => Steer({ "Manual azimuth": Next })} />
            <Control Field={{ ...Sheet.find((Each) => Each.Label === "Manual elevation"), Label: "Elevation" }} Value={Math.round(Elevation * 10) / 10} Change={(Next) => Steer({ "Manual elevation": Next })} />
          </div>
          <div className="graphic tall solved-gizmo" title={Manual ? "Manual direction · drag the sun" : "Solved direction · drag the sun or a slider to steer it by hand"}>
            <SunGizmo
              azimuth={Azimuth}
              elevation={Elevation}
              onChange={(NextAzimuth, NextElevation) => Steer({ "Manual azimuth": Math.round(NextAzimuth * 10) / 10, "Manual elevation": Math.round(NextElevation * 10) / 10 })}
            />
          </div>
          <p>
            {Elevation < 0 ? "Below the horizon" : "Above the horizon"} ·{" "}
            {Manual ? "manual direction, the solved angles are overridden" : "solved from the date, time and place"}
          </p>
        </Card>
        <Card Title="Sunlight intensity" GraphHandled>
          <Metric Value={Number(V("Intensity")).toFixed(1)} Unit="×" Caption="Sunlight intensity multiplier" />
          <SunGraph V={V} Change={AssignProperty} Mode="gain" />
          {F("Intensity")}
          <div className="ends">
            <span>0 ×</span>
            <span>60 ×</span>
          </div>
        </Card>
        {TagsAndNotes()}
        </>) },
          { Id: "temperature", Label: "Temperature", Content: (<>
          <Card Title="Temperature" GraphHandled>
            <Metric
              Value={V("Colour source") ? V("Temperature") : "RGB"}
              Unit={V("Colour source") ? "K" : ""}
            />
            {F("Colour source")}
            <div className="temperature-spectrum" />
            <SunGraph V={V} Change={AssignProperty} Mode="temperature" />
            <div className="ends">
              <span>Warm</span>
              <span>Cool</span>
            </div>
            {F("Temperature", !V("Colour source"))}
            <p>Blackbody tint approximation · linear RGB</p>
            {F("Sun Tint", !!V("Colour source"))}
          </Card>
        </>) },
          { Id: "disc", Label: "Sun disc", Content: (<>
          <Card Title="Sun disc">
            <Metric Value={Number(V("Angular Diameter")).toFixed(2) + "°"} />
            <div
              className="solar-disc"
              style={{
                "--diameter":
                  Math.min(120, 20 + V("Angular Diameter") * 30) + "px",
              }}
            />
            {F("Angular Diameter")}
            {F("Appearance")}
            {F("Flare / glare")}
          </Card>
        </>) },
          { Id: "dynamic", Label: "Dynamic", Content: (<>
        <Card Title="Daylight cycle" GraphHandled>
          <Metric
            Value={`${String(Math.floor(Time)).padStart(2, "0")}:${String(Math.floor((Time % 1) * 60)).padStart(2, "0")}`}
            Caption={V("Animate") ? "Day cycle running" : "Day cycle stopped · Quick controls on the Overview start it"}
          />
          <SunGraph V={V} Change={AssignProperty} Mode="day" />
          {F("Local Hours")}
        </Card>
        <Card Title="Dynamic settings">
          {Fields("Day duration", "Speed", "Direct")}
        </Card>
        <Card Title="Observer and date" GraphHandled>
          <SunGraph V={V} Change={AssignProperty} Mode="year" />
          {Fields("Latitude", "Longitude", "Day of Month", "Month", "Year", "UTC offset")}
          <div className="readout">
            <span>Declination</span>
            <output>{Solved.Declination.toFixed(2)}°</output>
          </div>
          <div className="readout">
            <span>Equation of Time</span>
            <output>{Solved.EquationOfTime.toFixed(2)} min</output>
          </div>
          <p className="native-note">Solar position uses the native NOAA calculation, translated to JavaScript.</p>
        </Card>
        {SpecificationCard()}
        </>) },
          { Id: "baking", Label: "Baking", Content: (<>
        <div className="section-caption">
          BAKING <small>Browser bakes · the 3D viewport uses these</small>
        </div>
        {(() => {
          const { Medium, Light } = Baking();
          return (
            <>
              <Card Title="Sun lighting bake">
                <BakedMap
                  Name="Sun lighting LUT"
                  Make={(Again) => SunLightingMap(Medium, Light.Tint, Again)}
                  Signature={JSON.stringify([Medium, Light.Tint])}
                  Marker={{ At: (Light.Elevation - LightingSpan.Low) / (LightingSpan.High - LightingSpan.Low), Label: `Now ${Light.Elevation.toFixed(1)}°` }}
                  Kit={BakeKit}
                  Planned={["256 × 64", "RGBA8 sRGB · beam over fill"]}
                  Axes={{
                    X: { Name: "Sun elevation", Unit: "°", At: (U) => LightingSpan.Low + (LightingSpan.High - LightingSpan.Low) * U },
                    Y: { Name: "Light", At: (V) => (V < 0.5 ? "Beam" : "Fill"), Ticks: [0.25, 0.75] },
                  }}
                />
              </Card>
              <Card Title="Sun disk bake">
                <BakedMap
                  Name="Sun disc map"
                  Make={(Again) => SunDiscMap(Medium, Light, Again)}
                  Signature={JSON.stringify([Medium, Light.Elevation, Light.Azimuth, Light.Tint])}
                  Kit={BakeKit}
                  Planned={["192 × 192", "RGBA8 sRGB · perspective"]}
                  Axes={{
                    X: { Name: "Off sun", Unit: "°", At: (U) => (U * 2 - 1) * SunAngularRadius * 12 * (180 / Math.PI), Ticks: [0, 0.5, 1] },
                    Y: { Name: "Off sun", Unit: "°", At: (V) => (1 - V * 2) * SunAngularRadius * 12 * (180 / Math.PI), Ticks: [0, 0.5, 1] },
                  }}
                />
              </Card>
            </>
          );
        })()}
        </>) },
        ]} />
      </>
    );
  } else if (Subject.Panel === "camera") {
    const Focal = V("Focal Length"),
      Sensor = V("Sensor Width"),
      Aperture = V("Aperture"),
      Distance = V("Subject Distance"),
      Aspect = Subject.Id === "cine" ? 1.5 : 16 / 9,
      H = (Focal * Focal) / (Aperture * 0.03) + Focal,
      S = Distance * 1000;
    const Optics = {
      horizontalFov: (2 * Math.atan(Sensor / (2 * Focal)) * 180) / Math.PI,
      verticalFov:
        (2 * Math.atan(Sensor / Aspect / (2 * Focal)) * 180) / Math.PI,
      pupil: Focal / Aperture,
      near: (H * S) / (H + S - Focal) / 1000,
      far: H - (S - Focal) > 0 ? (H * S) / (H - S + Focal) / 1000 : Infinity,
      hyperfocal: H / 1000,
      frameWidth: (Distance * Sensor) / Focal,
      frameHeight: (Distance * Sensor) / Aspect / Focal,
    };
    Content = (
      <>
        {Header(
          "Scene / Cameras",
          Subject.Id === "cine" ? "Cine Camera · lens study" : Subject.Name,
        )}
        {IsEditorCamera(Subject) && (
          <div className="editor-camera-note">
            Editor navigation camera · always present. Cannot be deleted or
            hidden. Construct adds separate scene cameras.
          </div>
        )}
        <InspectorTabs Owner="camera" Look="viewfinder" Pages={[
          { Id: "overview", Label: "Overview", Content: (<>
        <Card Title="Lens + field of view">
          <Metric Value={Focal.toFixed(1)} Unit="mm" />
          <div className="graphic lens">
            <SensorField
              sensor={Sensor}
              aspect={Aspect}
              focal={Focal}
              aperture={Aperture}
              focus={Distance}
              optics={Optics}
            />
          </div>
          <p>
            Optical schematic · not to scale. Sensor height follows the viewport
            aspect for the live camera.
          </p>
          {F("Focal Length")}
          <p>
            Vertical FOV {Optics.verticalFov.toFixed(1)}° · frame at subject{" "}
            {Optics.frameWidth.toFixed(2)} × {Optics.frameHeight.toFixed(2)} m
          </p>
        </Card>
        {Quick([
          { Label: "Tripod", Icon: "tripod", On: V("Tripod") !== false, Action: () => AssignProperty("Tripod", V("Tripod") === false) },
          Switch("Depth of field", "focus"),
          Switch("Vignette", "vignette"),
          Switch("Location lag", "motion"),
          Switch("Rotation lag", "orbit"),
        ])}
        {TagsAndNotes()}
        </>) },
          // Follow-up 78: scene cameras stand in the viewport, on a tripod or floating, at their own position and angle.
          ...(IsEditorCamera(Subject) ? [] : [{ Id: "mount", Label: "Mount", Content: (
            <CameraMountPage Subject={Subject} Values={Values} Assign={AssignProperty} Kit={{ Card, Control, Metric }} Body={CameraBodyOf(Subject.Id, V("Camera body"))} />
          ) }]),
          { Id: "focus", Label: "Focus", Content: (<>
        <div className="card-grid">
          <Card Title="Aperture study">
            <Metric Value={"f / " + Aperture.toFixed(1)} />
            <p>
              Entrance pupil and acceptable-sharpness limits update together. No
              renderer exposure or blur is changed.
            </p>
            <div className="graphic iris">
              <Iris opening={Math.min(1, Math.max(0, (16 / Aperture - 1) / (16 / 1.4 - 1)))} />
            </div>
            {F("Aperture")}
            <p>Pupil diameter {Optics.pupil.toFixed(1)} mm</p>
          </Card>
          <Card Title="Subject plane + sharpness">
            <Metric Value={Distance.toFixed(1)} Unit="m" />
            <p>
              Drag the subject plane. Thin-lens diagnostic · circle of confusion
              0.03 mm.
            </p>
            <DepthOfField
              focus={Distance}
              optics={Optics}
              enabled
              onChange={(Next) => AssignProperty("Subject Distance", Next)}
            />
            {F("Subject Distance")}
            <p>
              Near {Optics.near.toFixed(1)} m / far{" "}
              {Number.isFinite(Optics.far)
                ? Optics.far.toFixed(1) + " m"
                : "infinity"}
            </p>
          </Card>
        </div>
        </>) },
          { Id: "body", Label: "Body", Content: (<>
        {(() => {
          // The camera's editor asset (EditorAssets.js): what the viewport stands on a tripod and the outliner shows.
          const Chosen = CameraBodies.find((Body) => Body.Id === CameraBodyOf(Subject.Id, V("Camera body")));
          return (
            <Card Title="Camera body" Class="camera-body-card">
              <div className="camera-body-hero" data-camera-body-shown={Chosen.Id}>
                <Icon Name={Chosen.Icon} Size={168} />
                <div>
                  <b>
                    {Chosen.Letter} · {Chosen.Name}
                  </b>
                  <small>{Chosen.Caption}</small>
                </div>
              </div>
              <div className="camera-body-choices" role="radiogroup" aria-label="Camera body">
                {CameraBodies.map((Body) => (
                  <button
                    key={Body.Id}
                    type="button"
                    role="radio"
                    aria-checked={Body.Id === Chosen.Id}
                    className={Body.Id === Chosen.Id ? "on" : ""}
                    data-camera-body={Body.Id}
                    onClick={() => AssignProperty("Camera body", Body.Id)}
                  >
                    <Icon Name={Body.Icon} Size={52} />
                    <span>
                      <b>{Body.Letter}</b> {Body.Name}
                    </span>
                  </button>
                ))}
              </div>
            </Card>
          );
        })()}
        <Card Title="Sensor" Class="sensor-card">
          <Metric
            Value={(36 / Sensor).toFixed(2)}
            Unit="× crop"
            Caption={`${Formats.reduce((Best, Format) => (Math.abs(Format[1] - Sensor) < Math.abs(Best[1] - Sensor) ? Format : Best), Formats[0])[0]} · ${Optics.horizontalFov.toFixed(1)}° horizontal field`}
          />
          <div className="graphic sensor-graphic">
            <SensorFormats Width={Sensor} Aspect={Aspect} Focal={Focal} Change={(Next) => AssignProperty("Sensor Width", Next)} />
          </div>
          {F("Sensor Width")}
          <Control Field={{ Label: "Sensor height", Control: "Readout" }} Value={(Sensor / Aspect).toFixed(2) + " mm"} />
          <Control Field={{ Label: "Aspect", Control: "Readout" }} Value={Aspect.toFixed(3) + " : 1"} />
          <Control Field={{ Label: "Hyperfocal distance", Control: "Readout" }} Value={Optics.hyperfocal.toFixed(1) + " m"} />
          <p>Pinhole renderer: the sensor sets the field of view and depth of field, not exposure.</p>
        </Card>
        </>) },
          { Id: "render", Label: "Render", Content: (<>
        {/* Follow-up 66: the render settings (formerly in the viewport's gear menu) sit with the camera's render components. */}
        {Scene?.RenderSettings && (
          <Card Title="Render settings" Class="render-settings-card">
            {Scene.RenderSettings}
          </Card>
        )}
        <ComponentsCard Owner={Subject} Values={Values} Scene={Scene} Kit={{ Icon }} Title="Render" />
          {SpecificationCard()}
          </>) },
        ]} />
      </>
    );
  } else if (Subject.Panel === "stars") {
    // Follow-up 65: Overview (the field, its switches, tags, notes), Motion, Renderer (scale and the zodiacal glow), Baking.
    Content = (
      <>
        {Header("Environment", "Stars")}
        <InspectorTabs Owner="stars" Look="constellation" Pages={[
          { Id: "overview", Label: "Overview", Content: (<>
        <Card Title="Star field">
          <Metric
            Value={V("Limiting magnitude").toFixed(1)}
            Unit="mag"
            Caption="Higher values reveal fainter stars"
          />
          <svg
            className="star-field"
            viewBox="0 0 420 194"
            role="img"
            aria-label="Equatorial star chart"
          >
            {Array.from({ length: 300 }, (_, Index) => {
              let X = (Math.sin(Index * 78.233) * 43758.54) % 1,
                Y = (Math.sin(Index * 32.213) * 22578.3) % 1;
              return (
                <circle
                  key={Index}
                  cx={Math.abs(X) * 420}
                  cy={Math.abs(Y) * 194}
                  r={0.4 + Math.abs(X) * 1.2}
                  fill="#cfc6eb"
                  opacity={
                    V("Star field") && Index % 8 <= V("Limiting magnitude")
                      ? 0.7
                      : 0
                  }
                />
              );
            })}
          </svg>
          {F("Limiting magnitude")}
          <p>Equatorial chart study · no live star catalogue connection</p>
        </Card>
        {Quick([
          Switch("Star field", "stars"),
          Switch("Twinkle", "twinkle"),
          Switch("Bright star catalogue", "stars"),
          Switch("Milky Way", "galaxy"),
          Switch("Zodiacal light", "zodiac"),
        ])}
        {TagsAndNotes()}
        </>) },
          { Id: "motion", Label: "Motion", Content: (<>
        <div className="card-grid">
          <Card Title="Twinkle">
            <Metric
              Value={V("Twinkle depth")}
              Unit="%"
              Caption="Modulation depth"
            />
            <TwinkleSignal
              strength={V("Twinkle depth")}
              rate={V("Twinkle rate")}
              active={V("Twinkle") && V("Star field")}
            />
            {Fields("Twinkle depth", "Twinkle rate")}
          </Card>
          <Card Title="Celestial rotation">
            <Metric
              Value={V("Celestial rotation").toFixed(0) + "°"}
              Caption="Rotate the field around the celestial pole"
            />
            <CelestialRotation
              angle={V("Celestial rotation")}
              onChange={(Next) => AssignProperty("Celestial rotation", Next)}
            />
            {F("Celestial rotation")}
          </Card>
        </div>
        </>) },
          { Id: "renderer", Label: "Renderer", Content: (<>
        <Card Title="Renderer scale">
          {Fields("Brightness", "Point Size", "Loaded", "Sidereal Time")}
          <p>The chart omits atmosphere and daylight extinction. The pole dial is a schematic.</p>
        </Card>
        {/* Follow-up 67: the same Zodiacal light switch as the Overview's quick control, beside the radiance it unlocks. */}
        <Card Title="Zodiacal light">
          {F("Zodiacal light")}
          {F("Zodiacal radiance", !V("Zodiacal light"))}
        </Card>
        {SpecificationCard()}
        </>) },
          { Id: "baking", Label: "Baking", Content: (<>
        <div className="section-caption">
          BAKING <small>Browser bake · the 3D viewport uses this</small>
        </div>
        <Card Title="Star field bake">
          <BakedMap
            Name="Star map"
            Make={(Again) => StarMap(StarSettings(V), Again)}
            Signature={JSON.stringify(StarSettings(V))}
            Kit={BakeKit}
            Planned={["1024 × 512", "RGBA8 sRGB · equirectangular, celestial"]}
            Axes={{
              X: { Name: "Right ascension", Unit: "h", At: (U) => U * 24 },
              Y: { Name: "Declination", Unit: "°", At: (V) => 90 - V * 180 },
            }}
          />
        </Card>
        </>) },
        ]} />
      </>
    );
  } else if (Subject.Panel === "moon") {
    const Preset = V("Preset");
    // Follow-up 65: Overview (the slot, its phase, quick controls, tags, notes), Appearance (which moon, its light, size and atmosphere),
    // Position (where it sits and how it is turned).
    Content = (
      <>
        {Header("Environment", "Moon")}
        <InspectorTabs Owner="moon" Look="phases" Pages={[
          { Id: "overview", Label: "Overview", Content: (<>
        <Card Title="Moon slot" Class="moon-slot-card">
          <select
            className="moon-instance"
            aria-label="Active moon instance"
            value={MoonSlot}
            onChange={(Event) => SelectMoon(+Event.target.value)}
          >
            {Array.from({ length: MoonSlotCount }, (_, Slot) => (
              <option key={Slot} value={Slot}>
                {`Moon ${Slot + 1} · ${MoonPresets[Values["moon" + Slot + ":Preset"] ?? Slot]}`}
              </option>
            ))}
          </select>
          <p>Six moons can be up at once; every card edits the slot chosen here.</p>
        </Card>
        <Card Title="Lunar phase">
          <Metric
            Value={(V("Phase") * 29.53).toFixed(1)}
            Unit="days"
            Caption={`${Math.round((1 - Math.cos(V("Phase") * Math.PI * 2)) * 0.5 * 100)}% illuminated`}
          />
          <p>Position in the 29.53-day synodic cycle</p>
          <MoonImage Preset={Preset} Phase={V("Phase")} />
          {F("Phase", V("Follow Sky"))}
        </Card>
        {Quick([Switch("Visible", "visible"), Switch("Follow Sky", "orbit"), Switch("Has atmosphere", "cloud")])}
        {TagsAndNotes()}
        </>) },
          { Id: "appearance", Label: "Appearance", Content: (<>
        <Card Title="Moon catalogue">
          <div className="moon-catalogue">
            {["Luna", "Ember", "Glacier", "Sulfur", "Shroud", "Shard"].map(
              (Name, Index) => (
                <button
                  key={Name}
                  className={Preset === Index ? "selected" : ""}
                  onClick={() => AssignProperty("Preset", Index)}
                >
                  <MoonImage Preset={Index} Size={88} />
                  {Name}
                </button>
              ),
            )}
          </div>
        </Card>
        {/* Follow-up 65: moonlight, size and the moon's atmosphere share one preview, the moon as it sits in the night sky. */}
        <Card Title="Moonlight, size and atmosphere" Class="moon-look">
          <div className="moon-look-readings">
            <span><b>{V("Bright").toFixed(2)}×</b> moonlight</span>
            <span><b>{V("Size").toFixed(2)}°</b> across</span>
            <span><b>{V("Has atmosphere") ? V("Atmosphere intensity").toFixed(2) + "×" : "None"}</b> atmosphere</span>
          </div>
          <MoonGlobe
            Class="moon-look-preview"
            Label="Moonlight, size and atmosphere preview"
            Preset={Preset}
            Width={300}
            Height={210}
            // Angular size, compressed for oversized moons (the dashed ring is Luna's natural 0.52°).
            Radius={Math.min(78, 14 + 26 * Math.sqrt(V("Size")))}
            Natural={14 + 26 * Math.sqrt(0.52)}
            Phase={V("Phase")}
            Roll={V("Roll")}
            Pitch={V("Pitch")}
            Bright={V("Bright")}
            Glow={V("Glow")}
            Air={V("Has atmosphere") ? { Intensity: V("Atmosphere intensity"), Thickness: V("Thickness scale"), Tint: V("Atmosphere tint") } : null}
            Backdrop
          />
          <div className="moon-look-group">Moonlight</div>
          {Fields("Bright", "Glow")}
          <div className="moon-look-group">Size</div>
          {F("Size")}
          <button onClick={() => AssignProperty("Size", 0.52)}>Natural size · 0.52°</button>
          <div className="moon-look-group">Atmosphere</div>
          {/* Follow-up 67: the same Has atmosphere switch as the Overview's quick control (one key, two places). */}
          {F("Has atmosphere")}
          {F("Atmosphere intensity", !V("Has atmosphere"))}
          {F("Thickness scale", !V("Has atmosphere"))}
          {F("Atmosphere tint", !V("Has atmosphere"))}
        </Card>
        </>) },
          { Id: "position", Label: "Position", Content: (<>
        <div className="card-grid">
          <Card Title="Lunar position">
            <p>
              {V("Follow Sky")
                ? "Solved direction · Follow sky is ON"
                : "Position in the sky · drag the spherical dial"}
            </p>
            <LunarSphere
              azimuth={V("Azimuth")}
              elevation={V("Elevation")}
              rotation={V("Roll")}
              size={V("Size")}
              onChange={(Az, El) => {
                if (!V("Follow Sky")) {
                  AssignProperty("Azimuth", Az);
                  AssignProperty("Elevation", El);
                }
              }}
            />
            {F("Azimuth", V("Follow Sky"))}
            {F("Elevation", V("Follow Sky"))}
          </Card>
          <Card Title="Moon rotation">
            <p>Surface orientation · independent of sky position</p>
            {/* Follow-up 65: a lit sphere, so Pitch tips the surface toward or away from the viewer as Roll turns it. */}
            <MoonGlobe Preset={Preset} Radius={84} Roll={V("Roll")} Pitch={V("Pitch")} Label="Moon orientation preview" Class="moon-turn" />
            {Fields("Roll", "Pitch")}
            <button
              onClick={() => {
                AssignProperty("Roll", 0);
                AssignProperty("Pitch", 0);
              }}
            >
              Reset orientation
            </button>
          </Card>
        </div>
        {SpecificationCard()}
        </>) },
        ]} />
      </>
    );
  } else if (Subject.Panel === "atmosphere") {
    // Follow-up 65: Overview, Scattering (what the air does to light), Density (how it thins with height), Sky colour, View (the planet
    // from space and the observer), Baking.
    Content = (
      <>
        {Header("Environment", "Atmosphere")}
        <InspectorTabs Owner="atmosphere" Look="strata" Pages={[
          { Id: "overview", Label: "Overview", Content: (<>
        <AtmosphereLab V={V} Change={AssignProperty} Part="overview" />
        {Quick([
          { Label: "Visible", Icon: "visible", On: !Hidden, Action: ToggleHidden },
          Switch("Line at civil only", "horizon"),
          Switch("Orbital view", "orbit"),
        ])}
        {TagsAndNotes()}
        </>) },
          { Id: "scattering", Label: "Scattering", Content: (<>
        <Card Title="Atmospheric scattering" GraphHandled>
          <Metric
            Value={V("Rayleigh").toFixed(1)}
            Unit="×"
            Caption="How air molecules scatter sunlight"
          />
          <AtmosphereProfile V={V} Change={AssignProperty} Mode="spectrum" />
          {F("Rayleigh")}
        </Card>
        <div className="card-grid">
          <Card Title="Aerosol haze" GraphHandled>
            <Metric
              Value={V("Mie").toFixed(2)}
              Unit="×"
              Caption="Suspended particles soften and attenuate light"
            />
            <AtmosphereProfile V={V} Change={AssignProperty} Mode="haze" />
            {F("Mie")}
            {F("Mie Anisotropy")}
          </Card>
          <Card Title="Ozone absorption" GraphHandled>
            <Metric
              Value={V("Ozone").toFixed(2)}
              Unit="×"
              Caption="Selective absorption across visible wavelengths"
            />
            <AtmosphereProfile V={V} Change={AssignProperty} Mode="ozone" />
            {F("Ozone")}
          </Card>
        </div>
        </>) },
          { Id: "density", Label: "Density", Content: (<>
        <Card Title="Density falloff" GraphHandled>
          {F("Rayleigh Scale H")}
          <AtmosphereProfile V={V} Change={AssignProperty} Mode="height" />
          {F("Mie Scale H")}
        </Card>
        {Group("Planet and air", "Atmosphere", "Planet radius", "Air Mass")}
        </>) },
          { Id: "colour", Label: "Sky colour", Content: (<>
        {Group("Sky colour", "Sky Tint", "Sky Brightness", "Horizon Glow", "White Line")}
        <Card Title="Ground reflectance">
          {F("Ground Albedo")}
          <p>
            Original RGB ground albedo · applied separately, not stored in the
            smooth dome bake.
          </p>
        </Card>
        </>) },
          { Id: "view", Label: "View", Content: (<>
        <AtmosphereLab V={V} Change={AssignProperty} Part="space" />
        {Group("Wind binding", "Wind source")}
        {SpecificationCard()}
        </>) },
          { Id: "baking", Label: "Baking", Content: (<>
        <div className="section-caption">
          BAKING <small>Browser bakes · the 3D viewport uses these</small>
        </div>
        {(() => {
          const { Medium, Light } = Baking();
          return (
            <Card Title="Atmosphere bake">
              <BakedMap
                Name="Transmittance LUT"
                Make={(Again) => TransmittanceMap(Medium, Again)}
                Signature={JSON.stringify(Medium)}
                Pixelated
                Kit={BakeKit}
                Planned={["256 × 64", "RGBA8 sRGB · elevation × altitude"]}
                Axes={{
                  X: { Name: "View elevation", Unit: "°", At: TransmittanceElevation, Ticks: [0, 0.35, 0.6, 0.8, 1] },
                  Y: { Name: "Altitude", Unit: " km", At: (V) => (2 + (Medium.Top - 2) * (1 - V) ** 2) / 1000, Ticks: [0, 0.5, 1] },
                }}
              />
              <BakedMap
                Name="Sky-view map"
                Make={(Again) => SkyViewMap(Medium, Light, Again)}
                Signature={JSON.stringify([Medium, Light.Elevation, Light.Azimuth, Light.Tint])}
                Kit={BakeKit}
                Planned={["1024 × 512", "RGBA8 sRGB · equirectangular"]}
                Axes={{
                  X: { Name: "Azimuth", Unit: "°", At: (U) => U * 360 },
                  Y: { Name: "Elevation", Unit: "°", At: (V) => 90 - V * 180 },
                }}
              />
            </Card>
          );
        })()}
        <Card Title="Baked atmosphere">
          <div className="empty-image">No native dome image loaded</div>
          <p>
            Loading a dome image from disk needs the native engine. The browser
            bakes above are what the 3D viewport draws.
          </p>
          {F("Fetch Baked Dome", true)}
          {Fields("Dome Path", "Sheet", "Tier Samples")}
        </Card>
        </>) },
        ]} />
      </>
    );
  } else if (Subject.Panel === "flare") {
    // Follow-up 65: Overview (the composite, its layer switches and source), Optics (layers and ghosts), Halo, Baking. The preview pose
    // is the composite's drag (no separate fields); the aperture blades sit with the ghosts they shape.
    Drawn.add("Preview X");
    Drawn.add("Preview Y");
    Content = (
      <>
        {Header("Camera / Optics", "Lens Flare")}
        <InspectorTabs Owner="flare" Look="aperture" Pages={[
          { Id: "overview", Label: "Overview", Content: (<>
        <Card Title="Flare composite">
          <Metric Value={V("Intensity").toFixed(2)} Unit="×" />
          <FlarePreview
            Settings={FlareSettings(V)}
            Tint={Baking().Light.Colour}
            X={V("Preview X")}
            Y={V("Preview Y")}
            Move={(X, Y) => {
              AssignProperty("Preview X", X);
              AssignProperty("Preview Y", Y);
            }}
          />
          <p>
            Drag the sun · drawn by the 3D viewport's flare code from the atlas
            below, over black. Only this preview moves.
          </p>
        </Card>
        {Quick([Switch("Enabled", "starburst"), Switch("Anamorphic", "anamorphic"), Switch("Streaks", "streaks"), Switch("Starburst", "starburst")])}
        {Group("Flare source", "Intensity", "Type", "Style")}
        {TagsAndNotes()}
        </>) },
          { Id: "optics", Label: "Optics", Content: (<>
        <div className="card-grid">
          <Card Title="Flare layers">
            <p>
              Combine layers instead of choosing just one. Editing a layer
              selects Custom layers.
            </p>
            {Fields("Spread", "Rotation", "Ray pairs", "Streak gain")}
          </Card>
          <Card Title="Lens ghosts">
            <Metric Value={V("Ghosts")} Unit="elements" />
            {Fields(
              "Ghosts",
              "Ghost brightness",
              "Ghost spacing",
              "Ghost shape",
              "Aperture Blades",
            )}
          </Card>
        </div>
        </>) },
          { Id: "halo", Label: "Halo", Content: (<>
        <Card Title="Halo & optical response">
          {Fields("Halo Radius", "Halo brightness", "Halo width", "Chromatic")}
        </Card>
        {SpecificationCard()}
        </>) },
          { Id: "baking", Label: "Baking", Content: (<>
        <div className="section-caption">
          BAKING <small>Browser bake · the 3D viewport uses this</small>
        </div>
        <Card Title="Lens flare image">
          <BakedMap
            Name="Flare atlas"
            Make={(Again) => FlareAtlasMap(FlareSettings(V), Baking().Light.Colour, Again)}
            Signature={JSON.stringify([FlareSettings(V), Baking().Light.Colour.map((C) => +C.toFixed(2))])}
            Kit={BakeKit}
            Planned={["1024 × 512", "RGBA8 sRGB · 4 × 2 sprites"]}
            Axes={{
              X: { Name: "Sprite", At: (U) => String(Math.min(3, Math.floor(U * 4)) + 1), Ticks: [0.125, 0.375, 0.625, 0.875] },
              Y: { Name: "Row", At: (V) => (V < 0.5 ? "Lights" : "Ghosts"), Ticks: [0.25, 0.75] },
            }}
          />
        </Card>
        </>) },
        ]} />
      </>
    );
  } else if (Subject.Panel === "wind") {
    // Follow-up 65: Overview (the field, its switches, tags, notes; F67: the WindEditor button is gone) and Air (the stored atmospheric descriptors).
    Content = (
      <>
        {Header("Environment", Subject.Name)}
        <InspectorTabs Owner="wind" Look="wind" Pages={[
          { Id: "overview", Label: "Overview", Content: (<>
        {ReferenceCards}
        {Quick([{ Label: "Enabled", Icon: "wind", On: !Hidden, Action: ToggleHidden }, Switch("Air shear", "shear")])}
        {TagsAndNotes()}
        </>) },
          { Id: "air", Label: "Air", Content: (<>
        <Card Title="Atmospheric modifiers · native draft">
          {Fields("Shear", "Veer", "Turbulence", "Steadiness")}
          {F("Force")}
          <p>
            Stored atmospheric descriptors for the native mirror. Altitude
            shear, veer and turbulence are not evaluated by this horizontal 2D
            field preview.
          </p>
        </Card>
        </>) },
        ]} />
      </>
    );
  } else if (Subject.Panel === "precipitation") {
    // Follow-up 65: Overview (the type, its switches, tags, notes), Particles, Simulation.
    Content = (
      <>
        {Header("Environment", "Precipitation")}
        <InspectorTabs Owner="precipitation" Look="precipitation" Pages={[
          { Id: "overview", Label: "Overview", Content: (<>
        <Card Title="Precipitation type">
          <div className="precip-types">
            {["Rain", "Drizzle", "Hail", "Snow", "Sleet"].map((Name, Index) => (
              <button
                className={V("Precipitation") === Index ? "selected" : ""}
                key={Name}
                onClick={() => AssignProperty("Precipitation", Index)}
              >
                <Icon
                  Name={
                    Index === 2
                      ? "weather-hail"
                      : Index >= 3
                        ? "weather-snow"
                        : "weather-rain"
                  }
                  Size={32}
                />
                {Name}
              </button>
            ))}
          </div>
        </Card>
        {Quick([Switch("Enabled", "rain"), Switch("Follow Wind", "wind"), Switch("Spawn from Clouds", "cloud-spawn"), Switch("Ground Collision", "collision")])}
        {TagsAndNotes()}
        </>) },
          { Id: "particles", Label: "Particles", Content: (<>
        <div className="card-grid">
          <Card Title="Fall + density">
            {Fields("Intensity", "Density", "Particle Size", "Wind Drift")}
          </Card>
          <Card Title="Particle scale">
            <Metric
              Value={(V("Particle Size") * 3).toFixed(2)}
              Unit="mm"
              Caption="Nominal diameter · type radius × size scale"
            />
            <div className="particle-scale">
              <Icon Name="weather-rain" Size={96} />
            </div>
            <p>
              Magnified physical-size reference, not a particle count preview.
            </p>
          </Card>
        </div>
        </>) },
          { Id: "simulation", Label: "Simulation", Content: (<>
        <Card Title="Simulation + settling">
          {Fields("Accumulation", "Particles", "Snow Depth")}
          <p>
            Native simulation disconnected in HTML. No live particle count is
            fabricated.
          </p>
        </Card>
        </>) },
        ]} />
      </>
    );
  } else if (Subject.Panel === "rainbow") {
    // Follow-up 65: Overview (the preview, its switches, tags, notes), Bow (its response), Baking.
    Content = (
      <>
        {Header("Environment", "Rainbow")}
        <InspectorTabs Owner="rainbow" Look="rainbow" Pages={[
          { Id: "overview", Label: "Overview", Content: (<>
        <Card Title="Optical preview">
          <div
            className="rainbow-preview"
            style={{ opacity: V("Enabled") ? Math.min(1, V("Intensity")) : 0 }}
          >
            <div />
          </div>
          <p>
            Liquid-water optics · illustrative HTML preview, not the spectral
            kernel.
          </p>
        </Card>
        {Quick([Switch("Enabled", "rainbow"), Switch("Alexander's Band", "band")])}
        {TagsAndNotes()}
        </>) },
          { Id: "bow", Label: "Bow", Content: (<>
        <Card Title="Bow response">
          {Fields("Intensity", "Width", "Secondary", "Minimum Path")}
        </Card>
        {SpecificationCard()}
        </>) },
          { Id: "baking", Label: "Baking", Content: (<>
        <Bake Title="Bake / image" />
        </>) },
        ]} />
      </>
    );
  } else if (["clouds", "local-cloud"].includes(Subject.Panel)) {
    const Local = Subject.Panel === "local-cloud";
    // Follow-up 65: Overview (the cloud study, its switch, tags, notes), Coverage, Layer (base, thickness, bounds and shape), Body, then
    // for the global layer Wind and Quality (march, render scale, cloud shadows).
    Content = (
      <>
        {Header("Environment", Local ? "Local Cloud" : "Clouds")}
        <InspectorTabs Owner={Subject.Panel} Look="clouds" Pages={[
          { Id: "overview", Label: "Overview", Content: (<>
        {Values.ReferenceInspector?.Locked && (
          <button
            onClick={() =>
              Change("ReferenceInspector", {
                ...Values.ReferenceInspector,
                Locked: false,
              })
            }
          >
            Unlock editing
          </button>
        )}
        {ReferenceCards}
        {Quick([Switch("Enabled", "cloud")])}
        {TagsAndNotes()}
        </>) },
          { Id: "coverage", Label: "Coverage", Content: (<>
        <section
          className="cloud-coverage-replacement"
          data-card="Cloud coverage"
        >
          {CloudCoverageCards}
          {F("Coverage")}
        </section>
        </>) },
          { Id: "layer", Label: "Layer", Content: (<>
        <div className="card-grid">
          <Card Title="Cloud base" GraphHandled>
            <Metric
              Value={(V("Base") / 1000).toFixed(2)}
              Unit="km"
              Caption={
                Local
                  ? "Lower bound · centre Z − half height"
                  : "World Z altitude · drag the base line"
              }
            />
            <CloudDeckPanel V={V} Change={AssignProperty} Local={Local} />
            {!Local && F("Base")}
          </Card>
          <Card Title="Layer thickness" GraphHandled>
            <Metric
              Value={(V("Thickness") / 1000).toFixed(2)}
              Unit="km"
              Caption={
                Local
                  ? "Bounded depth · twice half height"
                  : "Vertical development · density profile"
              }
            />
            <CloudSection V={V} Change={AssignProperty} Local={Local} />
            {!Local && F("Thickness")}
          </Card>
        </div>
        {Local && (
          <Card Title="Local bounds">
            <TransformPanel
              Values={Values}
              Change={Change}
              Compact
              Space="WORLD SPACE"
              Rows={[
                [
                  "Centre",
                  "m",
                  Sheet.find((Field) => Field.Label === "Centre").Default,
                  -100000,
                  100000,
                  1,
                ],
                [
                  "Half Size",
                  "m",
                  Sheet.find((Field) => Field.Label === "Half Size").Default,
                  0.001,
                  100000,
                  1,
                ],
              ]}
            />
            <CloudBounds V={V} Change={AssignProperty} />
          </Card>
        )}
        {Local && (
          <Card Title="Shape">
            {F("Shape")}
            {F("Prism sides", V("Shape") !== 1)}
            {Fields("Yaw", "Edge softness")}
          </Card>
        )}
        </>) },
          { Id: "body", Label: "Body", Content: (<>
        <Card Title="Cloud body">
          {Fields(
            "Density",
            "Feature Scale",
            "Anisotropy",
            ...(!Local ? ["Type", "Anvil", "Ceiling"] : []),
          )}
        </Card>
        {Local && SpecificationCard()}
        </>) },
          ...(Local ? [] : [
          { Id: "wind", Label: "Wind", Content: (<>
        {Group("Cloud wind", "Wind speed", "Wind bearing", "Wind shear", "Wind veer", "Turbulence")}
        </>) },
          { Id: "quality", Label: "Quality", Content: (<>
        {Group("Quality", "March steps", "Render scale")}
        {!Local && (
          <details className="property-card">
            <summary>GPU cloud shadows · separate field</summary>
            {Sheet.filter((Field) =>
              ["Cloud Shadows", "Shadow Clock", "Tier Budget"].includes(
                Field.Group,
              ),
            ).map((Field) => F(Field.Label))}
          </details>
        )}
        {SpecificationCard()}
        </>) },
          ]),
        ]} />
      </>
    );
  } else if (Subject.Panel === "height-fog") {
    // Height Fog: its own cards (layer cut-away, density profile, light in the fog).
    const Ground = FogDensity("height-fog", V, 0, true),
      Falloff = Math.max(10, V("Falloff Height")),
      Readout = (Label, Text) => <Control key={Label} Field={{ Label, Control: "Readout" }} Value={Text} />,
      Far = (Sigma) => (Sigma > 1e-9 ? 3.912 / Sigma : Infinity),
      Metres = (Value) => (!isFinite(Value) ? "clear" : Value >= 1000 ? (Value / 1000).toFixed(1) + " km" : Math.round(Value) + " m");
    // Follow-up 65: Overview (the layer, its switch, tags, notes), Density, Light.
    Content = (
      <>
        {Header("Environment")}
        <InspectorTabs Owner="height-fog" Look="fog" Pages={[
          { Id: "overview", Label: "Overview", Content: (<>
        <Card Title="Fog layer" Class="fog-own-card" GraphHandled>
          <Metric Value={Metres(Far(Ground))} Caption="How far you can see at ground level" />
          <div className="graphic fog-scene-wrap">
            <HeightFogLayer V={V} Change={AssignProperty} />
          </div>
          {Fields("Density", "Falloff Height")}
        </Card>
        {Quick([Switch("Enabled", "fog")])}
        {TagsAndNotes()}
        </>) },
          { Id: "density", Label: "Density", Content: (<>
          <Card Title="Density by altitude" Class="fog-own-card" GraphHandled>
            <HeightFogVisual V={V} Change={AssignProperty} />
            {Readout("Visibility at 0 m", Metres(Far(Ground)))}
            {Readout(`Visibility at ${Metres(Falloff)}`, Metres(Far(FogDensity("height-fog", V, Falloff, true))))}
            {Readout("Looking straight up", Number((Math.exp(-V("Density") * Falloff) * 100).toPrecision(2)) + " % of the light")}
          </Card>
        </>) },
          { Id: "light", Label: "Light", Content: (<>
          <Card Title="Light in the fog" Class="fog-own-card" GraphHandled>
            <Metric Value={Number(V("Sun Scatter")).toFixed(2)} Unit="×" Caption="Forward glow around the sun" />
            <div className="graphic fog-scene-wrap">
              <FogLightStudy V={V} />
            </div>
            {Fields("Sun Scatter")}
            {F("Colour")}
          </Card>
        </>) },
        ]} />
      </>
    );
  } else if (Subject.Panel === "aerial-fog") {
    // Atmospheric Fog: its own cards (receding ridges, haze colour).
    const Sigma = FogDensity("aerial-fog", V, 2, true),
      Probe = V("Probe distance") ?? 200,
      Metres = (Value) => (!isFinite(Value) ? "clear" : Value >= 1000 ? (Value / 1000).toFixed(1) + " km" : Math.round(Value) + " m");
    // Follow-up 65: Overview (the ridges, the switch, tags, notes) and Spectrum.
    Content = (
      <>
        {Header("Environment")}
        <InspectorTabs Owner="aerial-fog" Look="fog" Pages={[
          { Id: "overview", Label: "Overview", Content: (<>
        <Card Title="Aerial perspective" Class="fog-own-card" GraphHandled>
          <Metric Value={Metres(Sigma > 1e-9 ? 3.912 / Sigma + V("Start") : Infinity)} Caption="Visibility, counting the clear air before Start" />
          <div className="graphic fog-scene-wrap">
            <AerialRidges V={V} Change={AssignProperty} />
          </div>
          {Fields("Density", "Start")}
          <p>
            {(Math.exp(-Sigma * Probe) * 100).toFixed(1)} % of the light survives {Metres(Probe)} of haze. Illustrative σ = 0.001 × density / m, not a
            native atmosphere march.
          </p>
        </Card>
        {Quick([Switch("Enabled", "fog")])}
        {TagsAndNotes()}
        </>) },
          { Id: "spectrum", Label: "Spectrum", Content: (<>
        <Card Title="Spectral transmission" Class="fog-own-card" GraphHandled>
          <Metric Value={Math.round(V("Mie Blend") * 100)} Unit="% aerosol" Caption={V("Mie Blend") < 0.5 ? "Blue, clean-air haze" : "Grey-white, dusty haze"} />
          <FogSpectrum V={V} Change={AssignProperty} />
          {Fields("Mie Blend")}
        </Card>
        </>) },
        ]} />
      </>
    );
  } else if (Subject.Panel.includes("fog")) {
    // Local Fog keeps the shared fog cards. Follow-up 65: Overview (visibility, the switch, tags, notes), Medium, Shape.
    Content = (
      <>
        {Header("Environment")}
        <InspectorTabs Owner={Subject.Panel} Look="fog" Pages={[
          { Id: "overview", Label: "Overview", Content: (<>
        <Card Title="Visibility through fog" GraphHandled>
          <FogGraph Kind={Subject.Panel} V={V} Change={AssignProperty} />
        </Card>
        {Quick([Switch("Enabled", "fog")])}
        {TagsAndNotes()}
        </>) },
          { Id: "medium", Label: "Medium", Content: (<>
          <Card Title="Medium">
            {Fields("Density", "Coverage", "Feature Scale", "Anisotropy")}
            <FogBeamChamber Kind={Subject.Panel} V={V} />
          </Card>
        </>) },
          { Id: "shape", Label: "Shape", Content: (<>
        <FogShapePanel Values={Values} Change={Change} />
        </>) },
        ]} />
      </>
    );
  } else Content = Generic();
  const Closing = SpecificationPlaced ? null : SpecificationCard();
  return (
    <GraphContext.Provider value={{ Panel: Subject.Panel }}>
      <div
        className={"specialized-inspector environment-live " + Subject.Panel}
        data-panel={Subject.Panel}
      >
        {Content}
        {Closing}
      </div>
    </GraphContext.Provider>
  );
}
