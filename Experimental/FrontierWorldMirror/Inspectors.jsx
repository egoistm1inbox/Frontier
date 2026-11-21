import { CloudEdit, CloudValue } from "./CloudSpecification.js";
import CloudDeckPanel from "./CloudDeckPanel.jsx";
import { FogBeamChamber } from "./FogPanel.jsx";
import HeightFogVisual from "./HeightFogVisual.jsx";
import FracturePanel from "./FracturePanel.jsx";
import AtmosphereLab, { AtmosphereProfile } from "./AtmosphereLab.jsx";
import {
  GraphContext,
  PropertyGraph,
  SunGraph,
  FogGraph,
  FogSpectrum,
  CloudSection,
  CloudBounds,
} from "./LiveGraph.jsx";
import FogShapePanel from "./FogShapePanel.jsx";
import { IsEditorCamera } from "./ScenePolicy.js";
import {
  CanonicalEditorCamera,
  CanonicalRenderSettings,
  GI_ALGORITHMS,
  QUALITY_PRESETS,
  REFLECTION_ALGORITHMS,
  ResolveRenderSettings,
  SHADOW_ALGORITHMS,
} from "./ShowcaseGalleryScene.js";
import { WindInspector, WindBinding } from "./WindPanel.jsx";
import TransformPanel from "./TransformPanel.jsx";
import MaterialPanel from "./MaterialPanel.jsx";
import { ColourSlotDropProps } from "./ColourCodex.js";
import ActionIcon, { QuickSymbol } from "./ActionIcon.jsx";
import ForceFieldPanel, { ForceModelSvg } from "./ForceFieldPanel.jsx";
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
import { Solar } from "./Solar.mjs";
import { SensorField } from "./OpticalGraphic.jsx";
import { FACE_KEYS, FACE_LABELS, HasActiveFaceColors } from "./WorldPropLibrary.js";
import SectionStageSwitcher from "./SectionStageSwitcher.jsx";

export const Panels = { ...Native.Panels, force: [] };
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
  if (typeof Name === "string" && Name.startsWith("force-model:")) {
    const ModelId = Name.slice("force-model:".length) || "LinearWind";
    return (
      <span
        className="native-icon force-model-symbol"
        data-native-icon={Name}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
      >
        <ForceModelSvg ModelId={ModelId} Size={Math.max(14, Math.min(Size, 20))} />
      </span>
    );
  }
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
  if (Name === "render-settings")
    return (
      <span
        className="native-icon render-settings-symbol"
        data-native-icon={Name}
        style={{
          color: "#d4e6ff",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActionIcon Name="render-settings" Size={Math.max(15, Math.min(Size, 19))} />
      </span>
    );
  if (Name === "vehicle")
    return (
      <span
        className="native-icon vehicle-symbol"
        data-native-icon={Name}
        style={{
          color: "#a7d5f2",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActionIcon Name="vehicle" Size={Math.max(15, Math.min(Size, 19))} />
      </span>
    );
  const Source = window.NativeAssets?.Icons[Name];
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
        <span>{Label}</span>
        <output>{Value ?? Field.Default}</output>
      </div>
    );
  if (Field.Control === "Switch")
    return (
      <label className="switch-row">
        <span>{Label}</span>
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
        <span>{Label}</span>
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
        <span>{Label}</span>
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
        <span>{Label}</span>
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
      <span>{Label}</span>
      <div className="slider-pill">
        <div className="split-value">
          <input
            aria-label={Label + " value"}
            type="number"
            min={Minimum}
            max={Maximum}
            step={10 ** -Decimals}
            disabled={ReadOnly}
            value={Number(Safe.toFixed(Decimals))}
            onChange={(Event) => Write(Event.target.value)}
          />
          <small>{Field.Unit}</small>
        </div>
        <input
          aria-label={Label}
          type="range"
          min={Minimum}
          max={Maximum}
          step={10 ** -Decimals}
          value={Safe}
          disabled={ReadOnly}
          style={{
            "--fill": `${(100 * (Safe - Minimum)) / (Maximum - Minimum)}%`,
          }}
          onChange={(Event) => Write(Event.target.value)}
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
      {!GraphHandled && (
        <PropertyGraph Children={children || Children} Title={Title} />
      )}
    </section>
  );
}
export function Tile({
  Label,
  On,
  Action,
  Disabled = false,
  IconName = "visible",
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
      <small className="quick-status">
        {Disabled ? "UNAVAILABLE" : On ? "ON" : "OFF"}
      </small>
    </button>
  );
}
function Metric({ Value, Unit, Caption }) {
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
  OpenWindField,
  WindFields = [],
  AllRows = [],
  AllValues = {},
  AllHidden = {},
  ReferenceCards = null,
  CloudCoverageCards = null,
  ReferenceDetailCards = null,
  ForceOverlaySettings = null,
  OnChangeForceOverlay = null,
  OnSaveForcePreset = null,
  OnDeleteSubject = null,
  OnSelectSubject = null,
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
          ? [0.52, 1.6, 1.2, 1.1][MoonSlot]
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
    if (
      Subject.Panel === "sun" &&
      ["Local Hours", "Month", "Day of Month", "Latitude", "Longitude"].includes(Name)
    ) {
      const Params = {
        LocalHours: Name === "Local Hours" ? Next : V("Local Hours"),
        Month: Name === "Month" ? Next : V("Month"),
        Day: Name === "Day of Month" ? Next : V("Day of Month"),
        Latitude: Name === "Latitude" ? Next : V("Latitude"),
        Longitude: Name === "Longitude" ? Next : V("Longitude"),
      };
      const Solved = Solar(Params);
      const El = (Solved.Elevation * Math.PI) / 180;
      const Az = (Solved.Azimuth * Math.PI) / 180;
      Change("Direction", [
        Number((Math.cos(El) * Math.sin(Az)).toFixed(4)),
        Number((Math.cos(El) * Math.cos(Az)).toFixed(4)),
        Number(Math.sin(El).toFixed(4)),
      ]);
    }
    if (Subject.Panel === "moon" && Name === "Preset")
      Change(Prefix + "Size", [0.52, 1.6, 1.2, 1.1, 2.4, 0.6][Next]);
    if (Subject.Panel === "sun" && Name === "Speed" && Next < 4)
      Change("Day duration", 24 / [1, 8, 30, 100][Next]);
    if (Subject.Panel === "sun" && Name === "Day duration") Change("Speed", 4);
  };
  const Latest = useRef(Values);
  Latest.current = Values;
  useEffect(() => {
    if (Subject.Panel !== "sun" || !Values.Animate) return;
    let Before = performance.now();
    const Timer = setInterval(() => {
      const Now = performance.now(),
        Hours = Latest.current["Local Hours"] ?? 12,
        Duration = Latest.current["Day duration"] ?? 3;
      const NextHours = (Hours + (((Now - Before) / 1000) * 24) / Duration / 60) % 24;
      Change("Local Hours", NextHours);
      const Solved = Solar({
        LocalHours: NextHours,
        Month: Latest.current.Month ?? 10,
        Day: Latest.current["Day of Month"] ?? 4,
        Latitude: Latest.current.Latitude ?? -26.19,
        Longitude: Latest.current.Longitude ?? 28.32,
      });
      const El = (Solved.Elevation * Math.PI) / 180;
      const Az = (Solved.Azimuth * Math.PI) / 180;
      Change("Direction", [
        Number((Math.cos(El) * Math.sin(Az)).toFixed(4)),
        Number((Math.cos(El) * Math.cos(Az)).toFixed(4)),
        Number(Math.sin(El).toFixed(4)),
      ]);
      Before = Now;
    }, 100);
    return () => clearInterval(Timer);
  }, [Subject.Id, Values.Animate]);
  const F = (Name, Disabled = false) => {
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
      <div className="inspector-heading-top">
        <div className="breadcrumbs">Inspector / {Category}</div>
        <EntityNotes
          Value={Values.Notes || ""}
          Change={(Next) => Change("Notes", Next)}
        />
      </div>
      <h1>{Title}</h1>
      {Subject.Description && <p className="eyebrow">{Subject.Description}</p>}
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
  const Generic = () => {
    const ExtraGroups = [...new Set(Sheet.map((Field) => Field.Group))].filter(
      (Group) =>
        Subject.Panel !== "geometry" ||
        !["Transform", "Surface"].includes(Group),
    );

    const RenderExtraGroupCards = () =>
      ExtraGroups.map((Group) => (
        <details open className="generic-card" key={Group}>
          <summary>{Group}</summary>
          {Sheet.filter((Field) => Field.Group === Group).map((Field) =>
            F(Field.Label),
          )}
          {["light", "post"].includes(Subject.Panel) && (
            <PropertyGraph
              Title={Group}
              Children={Sheet.filter((Field) => Field.Group === Group).map(
                (Field) => F(Field.Label),
              )}
            />
          )}
        </details>
      ));

    const FaceColourSection = Subject.Panel === "geometry" && (
      <section className="generic-card">
        <h4>PER-FACE COLOURS</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={HasActiveFaceColors(Values.FaceColors)}
                onChange={(Ev) => {
                  if (Ev.target.checked) {
                    const BaseHex = Values.Material?.Channels?.colour?.Fill || "#d4d0c8";
                    Change("FaceColors", {
                      Enabled: true,
                      "-Y": BaseHex,
                      "+Y": BaseHex,
                      "-X": "#dc2626",
                      "+X": "#16a34a",
                      "+Z": "#f8fafc",
                      "-Z": "#1f2937",
                    });
                  } else {
                    Change("FaceColors", { ...(Values.FaceColors || {}), Enabled: false });
                  }
                }}
              />
              <span>Individual face colours</span>
            </label>
            {HasActiveFaceColors(Values.FaceColors) && (
              <button
                type="button"
                style={{ fontSize: 11, padding: "3px 8px" }}
                onClick={() => Change("FaceColors", null)}
              >
                Clear
              </button>
            )}
          </div>
          {HasActiveFaceColors(Values.FaceColors) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {FACE_KEYS.map((Key) => {
                const Entry = Values.FaceColors?.[Key];
                const HexVal =
                  typeof Entry === "string"
                    ? Entry
                    : Entry?.Fill || Values.Material?.Channels?.colour?.Fill || "#d4d0c8";
                return (
                  <label
                    key={Key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 6,
                      padding: "4px 7px",
                      borderRadius: 6,
                      background: "rgba(255,255,255,0.04)",
                      fontSize: 11.5,
                    }}
                  >
                    <span>{FACE_LABELS[Key]}</span>
                    <input
                      type="color"
                      aria-label={`Face colour ${Key}`}
                      value={/^#[0-9a-f]{6}$/i.test(HexVal) ? HexVal : "#d4d0c8"}
                      onChange={(Ev) => {
                        const NextColor = Ev.target.value;
                        const Prev = Values.FaceColors || {};
                        const Existing = Prev[Key];
                        Change("FaceColors", {
                          ...Prev,
                          Enabled: true,
                          [Key]:
                            Existing && typeof Existing === "object"
                              ? { ...Existing, Fill: NextColor }
                              : NextColor,
                        });
                      }}
                      style={{ width: 26, height: 22, padding: 0, border: "none", background: "transparent", cursor: "pointer" }}
                    />
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </section>
    );

    if (Subject.Panel === "geometry") {
      return (
        <>
          {Header("Geometry")}
          <SectionStageSwitcher
            ScopeKey="inspector:geometry"
            AriaLabel="Geometry inspector sections"
            Sections={[
              {
                Id: "transform",
                Label: "Transform",
                Subtitle: "Spatial placement & quick flags",
                Accent: "#7ab8ff",
                Content: (
                  <>
                    <TransformPanel Values={Values} Change={Change} />
                    {Capabilities()}
                  </>
                ),
              },
              {
                Id: "material",
                Label: "Material",
                Subtitle: "20-channel OpenPBR surface authoring",
                Accent: "#c9b49a",
                Content: (
                  <MaterialPanel
                    Subject={Subject}
                    Values={Values}
                    Change={Change}
                    Expand={OpenShader}
                    Compact
                  />
                ),
              },
              {
                Id: "faces",
                Label: "Surface",
                Subtitle: "Per-face overrides & object parameters",
                Accent: "#7be0ad",
                Content: (
                  <>
                    {FaceColourSection}
                    {RenderExtraGroupCards()}
                  </>
                ),
              },
              {
                Id: "fracture",
                Label: "Fracture",
                Subtitle: "Voronoi shattering & debris solver",
                Accent: "#f59e0b",
                Content: (
                  <FracturePanel
                    Subject={Subject}
                    Values={Values}
                    Change={Change}
                    Expand={OpenFracture}
                  />
                ),
              },
            ]}
          />
        </>
      );
    }

    if (Subject.Panel === "light") {
      const LightSections = [
        {
          Id: "placement",
          Label: "Transform",
          Subtitle: "Luminaire pose & shadow participation",
          Accent: "#e3d598",
          Content: (
            <>
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
              {(!Subject.ReferenceType || Subject.PropId || Values.PropId) && (
                <TransformPanel Values={Values} Change={Change} />
              )}
              {Capabilities()}
              {ReferenceCards}
            </>
          ),
        },
        {
          Id: "emission",
          Label: "Photometry",
          Subtitle: "Radiometric output & emitter geometry",
          Accent: "#7ab8ff",
          Content: <>{RenderExtraGroupCards()}</>,
        },
      ];
      if (ReferenceDetailCards) {
        LightSections.push({
          Id: "reference",
          Label: "Optics",
          Subtitle: "Reference luminaire profile & beam",
          Accent: "#c5a3ff",
          Content: <>{ReferenceDetailCards}</>,
        });
      }
      return (
        <>
          {Header("Lighting")}
          <SectionStageSwitcher
            ScopeKey="inspector:light"
            AriaLabel="Light inspector sections"
            Sections={LightSections}
          />
        </>
      );
    }

    return (
      <>
        {Header(Subject.Panel === "post" ? "Post processing" : "Scene")}
        <SectionStageSwitcher
          ScopeKey={`inspector:${Subject.Panel}`}
          AriaLabel="Inspector sections"
          Sections={[
            {
              Id: "state",
              Label: "Controls",
              Subtitle: "Activation & primary state",
              Accent: "#7be0ad",
              Content: <>{Capabilities()}</>,
            },
            ...ExtraGroups.map((Group) => ({
              Id: Group.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
              Label: Group,
              Subtitle: `${Group} parameters`,
              Content: (
                <section className="generic-card">
                  <h4>{Group.toUpperCase()}</h4>
                  {Sheet.filter((Field) => Field.Group === Group).map((Field) =>
                    F(Field.Label),
                  )}
                  {["light", "post"].includes(Subject.Panel) && (
                    <PropertyGraph
                      Title={Group}
                      Children={Sheet.filter((Field) => Field.Group === Group).map(
                        (Field) => F(Field.Label),
                      )}
                    />
                  )}
                </section>
              ),
            })),
          ]}
        />
      </>
    );
  };
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
          {Subject.ReferenceOnly && Subject.Panel === "light" ? (
            <>
              {Header("Lighting")}
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
            </>
          ) : (
            Generic()
          )}
        </div>
      </GraphContext.Provider>
    );
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
    const Dir = Array.isArray(Values.Direction) ? Values.Direction : null;
    const DLen = Dir ? Math.hypot(Dir[0] || 0, Dir[1] || 0, Dir[2] || 0) : 0;
    const Elevation =
      DLen > 1e-4
        ? (Math.asin(Math.max(-1, Math.min(1, Dir[2] / DLen))) * 180) / Math.PI
        : Solved.Elevation;
    const Azimuth =
      DLen > 1e-4
        ? ((((Math.atan2(Dir[0], Dir[1]) * 180) / Math.PI) % 360) + 360) % 360
        : Solved.Azimuth;
    Content = (
      <>
        {Header("Environment")}
        <SectionStageSwitcher
          ScopeKey="inspector:sun"
          AriaLabel="Sun inspector sections"
          Sections={[
            {
              Id: "direction",
              Label: "Direction",
              Subtitle: "Solar azimuth, elevation & world vector",
              Accent: "#f59e0b",
              Content: (
                <>
                  <div className="tiles sun-tiles">
                    <Tile
                      Label="Enabled"
                      Context="sun"
                      On={!Hidden}
                      Action={ToggleHidden}
                      Large
                    />
                    <Tile
                      Label="Day cycle"
                      Large
                      IconName="celestial-orbit"
                      On={V("Animate")}
                      Action={() => AssignProperty("Animate", !V("Animate"))}
                    />
                    <Tile
                      Label={V("Animate") ? "Dynamic" : "Static"}
                      Large
                      IconName="celestial-orbit"
                      On={V("Animate")}
                      Action={() => AssignProperty("Animate", !V("Animate"))}
                    />
                  </div>
                  <Card Title="Sun direction" Class="direction-card">
                    <Metric
                      Value={Elevation.toFixed(1) + "°"}
                      Caption={
                        Elevation < 0 ? "Below the horizon" : "Above the horizon"
                      }
                    />
                    <div
                      className="graphic tall solved-gizmo"
                      title="Drag horizontally for azimuth, vertically for elevation (full 24h day & night). Edit Local Hours for exact solar time."
                    >
                      <SunGizmo
                        azimuth={Azimuth}
                        elevation={Elevation}
                        onChange={(NextAz, NextEl) => {
                          const ElRad = (NextEl * Math.PI) / 180;
                          const AzRad = (NextAz * Math.PI) / 180;
                          Change("Direction", [
                            Number((Math.cos(ElRad) * Math.sin(AzRad)).toFixed(4)),
                            Number((Math.cos(ElRad) * Math.cos(AzRad)).toFixed(4)),
                            Number(Math.sin(ElRad).toFixed(4)),
                          ]);
                          let BestH = Time;
                          let BestErr = 1e9;
                          for (let H = 0; H < 24; H += 0.25) {
                            const S = Solar({
                              LocalHours: H,
                              Month: V("Month"),
                              Day: V("Day of Month"),
                              Latitude: V("Latitude"),
                              Longitude: V("Longitude"),
                            });
                            const dEl = S.Elevation - NextEl;
                            const dAz = ((S.Azimuth - NextAz + 540) % 360) - 180;
                            const Err = dEl * dEl + dAz * dAz * 0.25;
                            if (Err < BestErr) {
                              BestErr = Err;
                              BestH = H;
                            }
                          }
                          Change("Local Hours", BestH);
                        }}
                      />
                    </div>
                    {F("Local Hours")}
                    <div className="solved-directions">
                      <div>
                        <small>Azimuth</small>
                        <Metric Value={Azimuth.toFixed(1) + "°"} />
                        <input
                          type="range"
                          disabled
                          value={Azimuth}
                          min="0"
                          max="360"
                        />
                      </div>
                      <div>
                        <small>Elevation</small>
                        <Metric Value={Elevation.toFixed(1) + "°"} />
                        <input
                          type="range"
                          disabled
                          value={Elevation}
                          min="-90"
                          max="90"
                        />
                      </div>
                    </div>
                  </Card>
                  <TransformPanel
                    Values={Values}
                    Change={Change}
                    Space="WORLD DIRECTION"
                    Rows={[["Direction", "axis", [0.42, -0.55, 0.72], -1, 1, 0.01]]}
                  />
                </>
              ),
            },
            {
              Id: "radiometry",
              Label: "Radiometry",
              Subtitle: "Intensity multiplier, Kelvin spectrum & solar disc",
              Accent: "#ffd166",
              Content: (
                <>
                  <Card Title="Sunlight intensity" GraphHandled>
                    <Metric
                      Value={Number(V("Intensity")).toFixed(1)}
                      Unit="×"
                      Caption="Sunlight intensity multiplier"
                    />
                    <SunGraph V={V} Change={AssignProperty} Mode="gain" />
                    {F("Intensity")}
                    <div className="ends">
                      <span>0 ×</span>
                      <span>60 ×</span>
                    </div>
                  </Card>
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
                  </Card>
                </>
              ),
            },
            {
              Id: "ephemeris",
              Label: "Ephemeris",
              Subtitle: "24h daylight cycle, coordinates & calendar",
              Accent: "#7ab8ff",
              Content: (
                <>
                  <Card Title="Daylight cycle" GraphHandled>
                    <Metric
                      Value={`${String(Math.floor(Time)).padStart(2, "0")}:${String(Math.floor((Time % 1) * 60)).padStart(2, "0")}`}
                    />
                    <SunGraph V={V} Change={AssignProperty} Mode="day" />
                    {F("Local Hours")}
                  </Card>
                  <Card Title="Dynamic settings" Wide GraphHandled>
                    <SunGraph V={V} Change={AssignProperty} Mode="year" />
                    {Fields(
                      "Animate",
                      "Day duration",
                      "Speed",
                      "Direct",
                      "Latitude",
                      "Longitude",
                      "Day of Month",
                      "Month",
                    )}
                    <div className="readout">
                      <span>Declination</span>
                      <output>{Solved.Declination.toFixed(2)}°</output>
                    </div>
                    <div className="readout">
                      <span>Equation of Time</span>
                      <output>{Solved.EquationOfTime.toFixed(2)} min</output>
                    </div>
                  </Card>
                </>
              ),
            },
            {
              Id: "optics",
              Label: "Optics",
              Subtitle: "Solar summary, lens flare & bake targets",
              Accent: "#c5a3ff",
              Content: (
                <>
                  {ReferenceCards}
                  <div className="subcomponent">
                    <Icon Name="lens-flare" />
                    <div>
                      Lens Flare<small>Optical effect subcomponent</small>
                    </div>
                    <Glyph Name="arrow" />
                  </div>
                  <div className="card-grid">
                    <Bake Title="Sun lighting bake" Sun />
                    <Bake Title="Sun disk bake" Sun />
                  </div>
                </>
              ),
            },
          ]}
        />
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
        <SectionStageSwitcher
          ScopeKey="inspector:camera"
          AriaLabel="Camera inspector sections"
          Sections={[
            {
              Id: "pose",
              Label: "Pose",
              Subtitle: "World Z-Up camera placement & target",
              Accent: "#7ab8ff",
              Content: (
                <>
                  {IsEditorCamera(Subject) && (
                    <div className="editor-camera-note">
                      Editor navigation camera · synchronized 1:1 with C++ EditorCamera.
                      Orbit (Drag), Pan (Shift+Drag), Dolly (Wheel), or Fly (Right+WASD).
                    </div>
                  )}
                  {IsEditorCamera(Subject) ? (
                    <TransformPanel
                      Values={Values}
                      Change={Change}
                      Space="WORLD Z-UP"
                      Rows={[
                        ["Position", "m", CanonicalEditorCamera.Position, -200, 200, 0.02],
                        ["Target", "m", CanonicalEditorCamera.Target, -200, 200, 0.02],
                      ]}
                    />
                  ) : (
                    <TransformPanel Values={Values} Change={Change} />
                  )}
                  {IsEditorCamera(Subject) && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                      <button
                        type="button"
                        className="generic-card"
                        style={{
                          padding: "9px 10px",
                          cursor: "pointer",
                          color: "#eff4cf",
                          textAlign: "center",
                        }}
                        onClick={() => {
                          Change("Position", [...CanonicalEditorCamera.Position]);
                          Change("Target", [...CanonicalEditorCamera.Target]);
                          Change("Focal Length", CanonicalEditorCamera.FocalLengthMm);
                        }}
                      >
                        Reset Canonical Pose
                      </button>
                      <button
                        type="button"
                        className="generic-card"
                        style={{
                          padding: "9px 10px",
                          cursor: "pointer",
                          color: "#b8dcff",
                          textAlign: "center",
                          borderColor: "rgba(128,184,255,0.35)",
                        }}
                        onClick={() => OnSelectSubject && OnSelectSubject("render-settings")}
                      >
                        Render Settings →
                      </button>
                    </div>
                  )}
                </>
              ),
            },
            {
              Id: "lens",
              Label: "Lens",
              Subtitle: "Focal length & optical field of view",
              Accent: "#7be0ad",
              Content: (
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
                    Optical schematic · sensor height follows live viewport aspect.
                  </p>
                  {F("Focal Length")}
                  <p>
                    Vertical FOV {Optics.verticalFov.toFixed(1)}° · frame at subject{" "}
                    {Optics.frameWidth.toFixed(2)} × {Optics.frameHeight.toFixed(2)} m
                  </p>
                </Card>
              ),
            },
            {
              Id: "focus",
              Label: "Focus",
              Subtitle: "Entrance pupil aperture & sharpness plane",
              Accent: "#e3d598",
              Content: (
                <>
                  <Card Title="Aperture study">
                    <Metric Value={"f / " + Aperture.toFixed(1)} />
                    <div className="graphic iris">
                      <Iris opening={(16 / Aperture - 1) / (16 / 1.4 - 1)} />
                    </div>
                    {F("Aperture")}
                    <p>Pupil diameter {Optics.pupil.toFixed(1)} mm</p>
                  </Card>
                  <Card Title="Subject plane + sharpness">
                    <Metric Value={Distance.toFixed(1)} Unit="m" />
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
                </>
              ),
            },
            {
              Id: "sensor",
              Label: "Sensor",
              Subtitle: "Filmback width & hyperfocal geometry",
              Accent: "#c5a3ff",
              Content: (
                <Card Title="Sensor / support">
                  {F("Sensor Width")}
                  <p>
                    Aspect {Aspect.toFixed(3)} · hyperfocal{" "}
                    {Optics.hyperfocal.toFixed(1)} m · pinhole renderer
                  </p>
                </Card>
              ),
            },
          ]}
        />
      </>
    );
  } else if (Subject.Panel === "render-settings") {
    const Rs = ResolveRenderSettings({ "render-settings": Values });
    const ActiveShadow = SHADOW_ALGORITHMS.find((A) => A.id === Rs.ShadowAlgorithm) || SHADOW_ALGORITHMS[0];
    const ActiveGi = GI_ALGORITHMS.find((A) => A.id === Rs.GiAlgorithm) || GI_ALGORITHMS[0];
    const ActiveRefl = REFLECTION_ALGORITHMS.find((A) => A.id === Rs.ReflectionAlgorithm) || REFLECTION_ALGORITHMS[0];

    const ApplyShadowQuality = (QIdx) => {
      const Preset = QUALITY_PRESETS[QIdx] || QUALITY_PRESETS[1];
      Change("ShadowQuality", Preset.id);
      Change("ShadowRays", Preset.bvhRays);
      Change("PcssTaps", Preset.pcssTaps);
      Change("SmrtRays", Preset.smrtRays);
      Change("ShadowMapRes", Preset.id === 0 ? 1024 : 2048);
    };
    const ApplyGiQuality = (QIdx) => {
      const Preset = QUALITY_PRESETS[QIdx] || QUALITY_PRESETS[1];
      Change("GiQuality", Preset.id);
      Change("GiSamples", Preset.giSamples);
      Change("GiCones", Preset.giCones);
    };
    const ApplyReflQuality = (QIdx) => {
      const Preset = QUALITY_PRESETS[QIdx] || QUALITY_PRESETS[1];
      Change("ReflectionQuality", Preset.id);
      Change("ReflectionRays", Preset.reflRays);
      Change("ReflectionBounces", Preset.id >= 2 ? 3 : Preset.id >= 1 ? 2 : 1);
    };
    const ApplyMasterQuality = (QIdx) => {
      ApplyShadowQuality(QIdx);
      ApplyGiQuality(QIdx);
      ApplyReflQuality(QIdx);
    };

    const RsSelect = (LabelText, Options, Current, OnPick, Note = "") => (
      <label className="field">
        <span>{LabelText}</span>
        <select
          aria-label={LabelText}
          value={String(Current)}
          onChange={(Ev) => {
            const Raw = Ev.target.value;
            const Match = Options.find((O) => String(O.id) === Raw);
            if (Match) OnPick(Match.id);
          }}
        >
          {Options.map((Opt) => (
            <option key={String(Opt.id)} value={String(Opt.id)}>
              {Opt.label}
            </option>
          ))}
        </select>
        {Note ? (
          <p className="rs-desc-banner" style={{ marginTop: 8, marginBottom: 0 }}>
            {Note}
          </p>
        ) : null}
      </label>
    );

    const RsFieldSlider = (LabelText, Key, Val, Min, Max, Step, Unit = "", Decimals = 0) => {
      const Safe = Number.isFinite(+Val) ? +Val : Min;
      const Pct = Math.max(0, Math.min(100, (100 * (Safe - Min)) / Math.max(1e-6, Max - Min)));
      return (
        <label className="field compact" data-native-property={LabelText}>
          <span>{LabelText}</span>
          <div className="slider-pill">
            <div className="split-value">
              <input
                aria-label={`${LabelText} value`}
                type="number"
                min={Min}
                max={Max}
                step={Step}
                value={Number(Safe.toFixed(Decimals))}
                onChange={(Ev) => {
                  const N = +Ev.target.value;
                  if (Number.isFinite(N)) Change(Key, Math.min(Max, Math.max(Min, N)));
                }}
              />
              <small>{Unit}</small>
            </div>
            <input
              aria-label={LabelText}
              type="range"
              min={Min}
              max={Max}
              step={Step}
              value={Safe}
              style={{ "--fill": `${Pct}%` }}
              onChange={(Ev) => Change(Key, +Ev.target.value)}
            />
          </div>
        </label>
      );
    };

    const RsSwitch = (LabelText, Key, Val) => (
      <label className="switch-row">
        <span>{LabelText}</span>
        <button
          type="button"
          className={`toggle ${Val ? "on" : ""}`}
          role="switch"
          aria-checked={!!Val}
          aria-label={LabelText}
          onClick={() => Change(Key, !Val)}
        >
          <i />
        </button>
      </label>
    );

    const UsesShadowMap = Rs.ShadowAlgorithm !== "bvh";
    const UsesPcss = Rs.ShadowAlgorithm === "contact_pcss" || Rs.ShadowAlgorithm === "pcss";
    const UsesSmrt = Rs.ShadowAlgorithm === "smrt";
    const UsesRayCount = Rs.ShadowAlgorithm === "contact_pcss" || Rs.ShadowAlgorithm === "bvh";
    const MasterQuality =
      Rs.ShadowQuality === Rs.GiQuality && Rs.GiQuality === Rs.ReflectionQuality
        ? Rs.ShadowQuality
        : -1;

    Content = (
      <>
        {Header("Cameras / Editor Camera / Component", "Render Settings")}

        <div className="rs-summary-bar">
          <div className="rs-summary-chips">
            <span className="rs-chip">
              <i style={{ background: "#7ab8ff" }} />
              {ActiveShadow.label}
              {UsesShadowMap ? ` · ${Rs.ShadowMapRes}²` : ""}
            </span>
            <span className="rs-chip">
              <i style={{ background: "#7be0ad" }} />
              {ActiveGi.label}
            </span>
            <span className="rs-chip">
              <i style={{ background: "#c5a3ff" }} />
              {ActiveRefl.label}
            </span>
          </div>
          <button
            type="button"
            className="rs-reset-btn"
            onClick={() => {
              for (const [K, VVal] of Object.entries(CanonicalRenderSettings)) {
                Change(K, VVal);
              }
            }}
          >
            ↺ Reset
          </button>
        </div>

        <SectionStageSwitcher
          ScopeKey="inspector:render-settings"
          AriaLabel="Render settings sections"
          Sections={[
            {
              Id: "preset",
              Label: "Output",
              Subtitle: "Master quality tier, exposure & resolution scale",
              Accent: "#e3d598",
              Content: (
                <>
                  <Card Title="Quality Tier" Accent="#b9c8d8" GraphHandled>
                    <div className="rs-sliders">
                      {RsSelect(
                        "Global Quality Tier",
                        [
                          ...(MasterQuality < 0 ? [{ id: -1, label: "Custom (Per-Channel)" }] : []),
                          ...QUALITY_PRESETS.map((Q) => ({ id: Q.id, label: Q.label })),
                        ],
                        MasterQuality,
                        (Id) => {
                          if (Id >= 0) ApplyMasterQuality(Id);
                        },
                      )}
                    </div>
                  </Card>
                  <Card Title="Camera & Output" Accent="#e3d598" GraphHandled>
                    <div className="rs-sliders">
                      {RsFieldSlider("Camera Exposure Gain", "ExposureGain", Rs.ExposureGain, 0.2, 3.5, 0.05, "×", 2)}
                      {RsSelect(
                        "Render Resolution Scale",
                        [
                          { id: 50, label: "50% (Performance)" },
                          { id: 75, label: "75% (Balanced)" },
                          { id: 100, label: "100% (Native)" },
                          { id: 125, label: "125% (Supersampled)" },
                        ],
                        Rs.RenderScale,
                        (V) => Change("RenderScale", V),
                      )}
                      {RsSwitch("Edge Anti-Aliasing", "AntiAliasing", Rs.AntiAliasing)}
                    </div>
                  </Card>
                </>
              ),
            },
            {
              Id: "shadows",
              Label: "Shadows",
              Subtitle: "Direct solar & area-light visibility solver",
              Accent: "#7ab8ff",
              Content: (
                <Card Title="Shadows" Accent="#7ab8ff" GraphHandled>
                  <div className="rs-sliders">
                    {RsSelect(
                      "Shadow Algorithm",
                      SHADOW_ALGORITHMS,
                      Rs.ShadowAlgorithm,
                      (Id) => Change("ShadowAlgorithm", Id),
                      ActiveShadow.desc,
                    )}
                    {RsSelect(
                      "Shadow Quality",
                      QUALITY_PRESETS,
                      Rs.ShadowQuality,
                      ApplyShadowQuality,
                    )}
                    {UsesShadowMap &&
                      RsSelect(
                        "Shadow Map Resolution",
                        [
                          { id: 1024, label: "1024 × 1024 (Fast)" },
                          { id: 2048, label: "2048 × 2048 (Sharp)" },
                        ],
                        Rs.ShadowMapRes,
                        (V) => Change("ShadowMapRes", V),
                      )}
                    {RsSelect(
                      "Area Emitters",
                      [
                        { id: "shadowed", label: "Shadowed Area Lights" },
                        { id: "unshadowed", label: "Unshadowed Area Lights" },
                      ],
                      Rs.EmissiveShadowMode,
                      (V) => Change("EmissiveShadowMode", V),
                    )}
                    <div className="rs-divider" />
                    {RsFieldSlider("Penumbra Softness", "ShadowSoftness", Rs.ShadowSoftness, 0.25, 2.5, 0.05, "×", 2)}
                    {UsesPcss && RsFieldSlider("PCSS Filter Taps", "PcssTaps", Rs.PcssTaps, 8, 48, 2, "taps", 0)}
                    {UsesSmrt && RsFieldSlider("SMRT Depth Rays", "SmrtRays", Rs.SmrtRays, 2, 12, 1, "rays", 0)}
                    {UsesRayCount &&
                      RsFieldSlider(
                        Rs.ShadowAlgorithm === "bvh" ? "BVH Shadow Rays" : "Contact Trace Rays",
                        "ShadowRays",
                        Rs.ShadowRays,
                        1,
                        16,
                        1,
                        "rays",
                        0,
                      )}
                    {UsesPcss && RsSwitch("Plane Filter (Slope Bias Smoothing)", "PlaneFilter", Rs.PlaneFilter)}
                    {UsesShadowMap && RsSwitch("Half-Resolution Shadow Sweep", "HalfResShadows", Rs.HalfResShadows)}
                  </div>
                </Card>
              ),
            },
            {
              Id: "gi",
              Label: "Indirect GI",
              Subtitle: "Multi-bounce diffuse radiosity & ambient sky fill",
              Accent: "#7be0ad",
              Content: (
                <Card Title="Global Illumination" Accent="#7be0ad" GraphHandled>
                  <div className="rs-sliders">
                    {RsSelect(
                      "GI Algorithm",
                      GI_ALGORITHMS,
                      Rs.GiAlgorithm,
                      (Id) => Change("GiAlgorithm", Id),
                      ActiveGi.desc,
                    )}
                    {Rs.GiAlgorithm !== "off" && (
                      <>
                        {RsSelect("GI Quality", QUALITY_PRESETS, Rs.GiQuality, ApplyGiQuality)}
                        {Rs.GiAlgorithm === "sdf" &&
                          RsFieldSlider("Cone GI Directions", "GiCones", Rs.GiCones, 4, 14, 1, "dirs", 0)}
                        {Rs.GiAlgorithm === "bvh" &&
                          RsFieldSlider("BVH GI Samples / Pixel", "GiSamples", Rs.GiSamples, 2, 20, 1, "spp", 0)}
                        {RsFieldSlider("Bounce Intensity", "GiIntensity", Rs.GiIntensity, 0, 2.5, 0.05, "×", 2)}
                      </>
                    )}
                    {RsFieldSlider("Sky & Ambient Fill", "FillBoost", Rs.FillBoost, 0.2, 2.5, 0.05, "×", 2)}
                  </div>
                </Card>
              ),
            },
            {
              Id: "reflections",
              Label: "Reflections",
              Subtitle: "Specular Fresnel raytracing & bounce budget",
              Accent: "#c5a3ff",
              Content: (
                <Card Title="Reflections" Accent="#c5a3ff" GraphHandled>
                  <div className="rs-sliders">
                    {RsSelect(
                      "Reflection Mode",
                      REFLECTION_ALGORITHMS,
                      Rs.ReflectionAlgorithm,
                      (Id) => Change("ReflectionAlgorithm", Id),
                      ActiveRefl.desc,
                    )}
                    {Rs.ReflectionAlgorithm !== "env" && (
                      <>
                        {RsSelect("Reflection Quality", QUALITY_PRESETS, Rs.ReflectionQuality, ApplyReflQuality)}
                        {RsFieldSlider("Reflection Rays / Pixel", "ReflectionRays", Rs.ReflectionRays, 1, 8, 1, "rays", 0)}
                        {RsFieldSlider("Max Reflection Bounces", "ReflectionBounces", Rs.ReflectionBounces, 1, 3, 1, "bnc", 0)}
                      </>
                    )}
                  </div>
                </Card>
              ),
            },
          ]}
        />
      </>
    );
  } else if (Subject.Panel === "stars") {
    Content = (
      <>
        {Header("Environment", "Stars")}
        <SectionStageSwitcher
          ScopeKey="inspector:stars"
          AriaLabel="Stars inspector sections"
          Sections={[
            {
              Id: "chart",
              Label: "Star Chart",
              Subtitle: "Catalogue visibility & limiting magnitude",
              Accent: "#cfc6eb",
              Content: (
                <>
                  <Card Title="Stars settings">
                    <div className="tiles">
                      {["Star field", "Twinkle"].map((Name) => (
                        <Tile
                          key={Name}
                          Label={Name}
                          On={V(Name)}
                          Action={() => AssignProperty(Name, !V(Name))}
                        />
                      ))}
                    </div>
                  </Card>
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
                  </Card>
                </>
              ),
            },
            {
              Id: "motion",
              Label: "Twinkle & Pole",
              Subtitle: "Scintillation modulation & pole rotation",
              Accent: "#7ab8ff",
              Content: (
                <>
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
                </>
              ),
            },
            {
              Id: "scale",
              Label: "Scale & Bake",
              Subtitle: "Point brightness, sidereal clock & baking",
              Accent: "#e3d598",
              Content: (
                <>
                  <Card Title="Renderer scale">
                    {Fields("Brightness", "Point Size", "Loaded", "Sidereal Time")}
                  </Card>
                  <Card Title="Star field bake">
                    <div className="tiles">
                      <Tile Label="Bake" Disabled IconName="bake" />
                      <Tile Label="Use baked" Disabled IconName="bake" />
                    </div>
                  </Card>
                </>
              ),
            },
          ]}
        />
      </>
    );
  } else if (Subject.Panel === "moon") {
    const Preset = V("Preset");
    Content = (
      <>
        {Header("Environment", "Moon")}
        <SectionStageSwitcher
          ScopeKey="inspector:moon"
          AriaLabel="Moon inspector sections"
          Sections={[
            {
              Id: "phase",
              Label: "Phase & Body",
              Subtitle: "Active satellite slot, surface preset & synodic phase",
              Accent: "#cfd8e8",
              Content: (
                <>
                  <Card Title="Moon settings">
                    <select
                      className="moon-instance"
                      aria-label="Active moon instance"
                      value={MoonSlot}
                      onChange={(Event) => SelectMoon(+Event.target.value)}
                    >
                      {[0, 1, 2, 3].map((Slot) => (
                        <option key={Slot} value={Slot}>
                          {
                            ["Luna", "Ember", "Glacier", "Sulfur", "Shroud", "Shard"][
                              Values["moon" + Slot + ":Preset"] ?? Slot
                            ]
                          }
                        </option>
                      ))}
                    </select>
                    <div className="moon-settings-tiles">
                      {["Visible", "Follow Sky"].map((Label) => (
                        <Tile
                          key={Label}
                          Label={Label}
                          Large
                          IconName="celestial-orbit"
                          On={V(Label)}
                          Action={() => AssignProperty(Label, !V(Label))}
                        />
                      ))}
                    </div>
                  </Card>
                  <Card Title="Moon catalogue">
                    <div className="moon-catalogue">
                      {["Luna", "Ember", "Glacier", "Sulfur", "Shroud", "Shard"].map(
                        (Name, Index) => (
                          <button
                            key={Name}
                            className={Preset === Index ? "selected" : ""}
                            onClick={() => AssignProperty("Preset", Index)}
                          >
                            <MoonImage Preset={Index} Size={72} />
                            {Name}
                          </button>
                        ),
                      )}
                    </div>
                  </Card>
                  <Card Title="Lunar phase">
                    <Metric
                      Value={(V("Phase") * 29.53).toFixed(1)}
                      Unit="days"
                      Caption={`${Math.round((1 - Math.cos(V("Phase") * Math.PI * 2)) * 0.5 * 100)}% illuminated`}
                    />
                    <MoonImage Preset={Preset} Phase={V("Phase")} />
                    {F("Phase", V("Follow Sky"))}
                  </Card>
                </>
              ),
            },
            {
              Id: "light",
              Label: "Light & Size",
              Subtitle: "Full-disc brightness, corona glow & angular diameter",
              Accent: "#7ab8ff",
              Content: (
                <>
                  <Card Title="Moonlight">
                    <Metric
                      Value={V("Bright").toFixed(2)}
                      Unit="×"
                      Caption="Full-disc brightness multiplier"
                    />
                    <MoonImage Preset={Preset} Size={86} />
                    {Fields("Bright", "Glow")}
                  </Card>
                  <Card Title="Moon size">
                    <Metric
                      Value={V("Size").toFixed(2) + "°"}
                      Caption="Angular diameter"
                    />
                    <MoonImage
                      Preset={Preset}
                      Size={100 + Math.min(60, V("Size") * 2)}
                    />
                    {F("Size")}
                    <button onClick={() => AssignProperty("Size", 0.52)}>
                      Natural size · 0.52°
                    </button>
                  </Card>
                </>
              ),
            },
            {
              Id: "orbit",
              Label: "Orbit & Pose",
              Subtitle: "Sky dome direction & surface orientation",
              Accent: "#c5a3ff",
              Content: (
                <>
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
                    <MoonImage Preset={Preset} Rotation={V("Roll")} Size={150} />
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
                </>
              ),
            },
          ]}
        />
      </>
    );
  } else if (Subject.Panel === "atmosphere") {
    Content = (
      <>
        {Header("Environment", "Atmosphere")}
        <SectionStageSwitcher
          ScopeKey="inspector:atmosphere"
          AriaLabel="Atmosphere inspector sections"
          Sections={[
            {
              Id: "sky-lab",
              Label: "Sky Dome",
              Subtitle: "Interactive horizon preview & civil line",
              Accent: "#7ab8ff",
              Content: (
                <>
                  <AtmosphereLab V={V} Change={AssignProperty} />
                  <Card Title="Atmosphere settings">{Tiles(["Line at civil only"])}</Card>
                </>
              ),
            },
            {
              Id: "rayleigh",
              Label: "Scattering",
              Subtitle: "Molecular Rayleigh scattering & altitude scale heights",
              Accent: "#7be0ad",
              Content: (
                <>
                  <Card Title="Atmospheric scattering" GraphHandled>
                    <Metric
                      Value={V("Rayleigh").toFixed(1)}
                      Unit="×"
                      Caption="How air molecules scatter sunlight"
                    />
                    <AtmosphereProfile V={V} Change={AssignProperty} Mode="spectrum" />
                    {F("Rayleigh")}
                  </Card>
                  <Card Title="Density falloff" GraphHandled>
                    {F("Rayleigh Scale H")}
                    <AtmosphereProfile V={V} Change={AssignProperty} Mode="height" />
                    {F("Mie Scale H")}
                  </Card>
                </>
              ),
            },
            {
              Id: "aerosols",
              Label: "Haze & Ozone",
              Subtitle: "Mie aerosol turbidity, ozone band & ground albedo",
              Accent: "#e3d598",
              Content: (
                <>
                  <Card Title="Aerosol haze" GraphHandled>
                    <Metric
                      Value={V("Mie").toFixed(2)}
                      Unit="×"
                      Caption="Suspended particles soften and attenuate light"
                    />
                    <AtmosphereProfile V={V} Change={AssignProperty} Mode="haze" />
                    {F("Mie")}
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
                  <Card Title="Ground reflectance">
                    {F("Ground Albedo")}
                  </Card>
                </>
              ),
            },
            {
              Id: "controls",
              Label: "Optics & Bake",
              Subtitle: "Anisotropy, horizon glow, air mass & dome baking",
              Accent: "#c5a3ff",
              Content: (
                <>
                  <Card Title="Native atmosphere controls">
                    {Fields(
                      "Mie Anisotropy",
                      "Atmosphere",
                      "Horizon Glow",
                      "White Line",
                      "Sky Tint",
                      "Sky Brightness",
                      "Air Mass",
                      "Tier Samples",
                    )}
                  </Card>
                  <Bake Title="Atmosphere bake" Sun />
                  <Card Title="Baked atmosphere">
                    <div className="empty-image">No resident atmosphere image</div>
                    {F("Fetch Baked Dome", true)}
                    {Fields("Dome Path", "Sheet")}
                  </Card>
                </>
              ),
            },
          ]}
        />
      </>
    );
  } else if (Subject.Panel === "flare") {
    Content = (
      <>
        {Header("Environment / Optics", "Lens Flare")}
        <SectionStageSwitcher
          ScopeKey="inspector:flare"
          AriaLabel="Lens flare inspector sections"
          Sections={[
            {
              Id: "preview",
              Label: "Source",
              Subtitle: "Interactive optical axis preview & mode toggles",
              Accent: "#ffd166",
              Content: (
                <>
                  <Card Title="Flare settings">
                    {Tiles(["Enabled", "Anamorphic", "Streaks", "Starburst"])}
                  </Card>
                  <Card Title="Flare composite">
                    <Metric Value={V("Intensity").toFixed(2)} Unit="×" />
                    <div
                      className="flare-preview"
                      onPointerDown={(Event) => {
                        Event.currentTarget.setPointerCapture(Event.pointerId);
                      }}
                      onPointerMove={(Event) => {
                        if (Event.buttons) {
                          const Rect = Event.currentTarget.getBoundingClientRect();
                          AssignProperty(
                            "Preview X",
                            Math.max(
                              0.06,
                              Math.min(0.94, (Event.clientX - Rect.left) / Rect.width),
                            ),
                          );
                          AssignProperty(
                            "Preview Y",
                            Math.max(
                              0.08,
                              Math.min(0.92, (Event.clientY - Rect.top) / Rect.height),
                            ),
                          );
                        }
                      }}
                    >
                      <div
                        className="flare-source"
                        style={{
                          left: V("Preview X") * 100 + "%",
                          top: V("Preview Y") * 100 + "%",
                          opacity: V("Enabled") ? Math.min(1, V("Intensity")) : 0,
                        }}
                      />
                      {Array.from({ length: Math.min(24, V("Ghosts")) }, (_, Index) => (
                        <i
                          key={Index}
                          style={{
                            left: ((10 + Index * 12) % 95) + "%",
                            top: ((20 + Index * 9) % 85) + "%",
                            width: 12 + Index * 6,
                            height: 12 + Index * 6,
                          }}
                        />
                      ))}
                    </div>
                    {Fields("Intensity", "Type")}
                  </Card>
                </>
              ),
            },
            {
              Id: "elements",
              Label: "Streaks & Ghosts",
              Subtitle: "Diffraction ray pairs & multi-element lens ghosts",
              Accent: "#7ab8ff",
              Content: (
                <>
                  <Card Title="Flare layers">
                    {Fields("Spread", "Rotation", "Ray pairs", "Streak gain")}
                  </Card>
                  <Card Title="Lens ghosts">
                    <Metric Value={V("Ghosts")} Unit="elements" />
                    {Fields(
                      "Ghosts",
                      "Ghost brightness",
                      "Ghost spacing",
                      "Ghost shape",
                    )}
                  </Card>
                </>
              ),
            },
            {
              Id: "halo",
              Label: "Halo & Bake",
              Subtitle: "Chromatic halo ring, iris blades & baking",
              Accent: "#c5a3ff",
              Content: (
                <>
                  <Card Title="Halo & optical response">
                    {Fields("Halo Radius", "Halo brightness", "Halo width", "Chromatic")}
                  </Card>
                  <Card Title="Iris & preview coordinates">
                    {Fields("Aperture Blades", "Preview X", "Preview Y")}
                  </Card>
                  <Bake Title="Lens flare image" />
                </>
              ),
            },
          ]}
        />
      </>
    );
  } else if (Subject.Panel === "wind") {
    Content = (
      <>
        {Header("Environment", Subject.Name)}
        <SectionStageSwitcher
          ScopeKey="inspector:wind"
          AriaLabel="Wind inspector sections"
          Sections={[
            {
              Id: "flow",
              Label: "Compass & Speed",
              Subtitle: "Horizontal bearing, gust envelope & shear toggle",
              Accent: "#7ab8ff",
              Content: (
                <>
                  <Card Title="Wind controls">
                    <div className="tiles">
                      <Tile
                        Label="Enabled"
                        Context="wind"
                        On={!Hidden}
                        Action={ToggleHidden}
                      />
                      <Tile
                        Label="Air shear"
                        Context="wind"
                        On={V("Air shear")}
                        Action={() => AssignProperty("Air shear", !V("Air shear"))}
                      />
                    </div>
                  </Card>
                  <WindInspector
                    Values={Values}
                    Change={Change}
                    Open={OpenWind}
                    Hidden={Hidden}
                  />
                </>
              ),
            },
            {
              Id: "turbulence",
              Label: "Shear & Gusts",
              Subtitle: "Altitude shear, directional veer & turbulence",
              Accent: "#7be0ad",
              Content: (
                <Card Title="Atmospheric modifiers">
                  {Fields("Shear", "Veer", "Turbulence", "Steadiness")}
                  {F("Force")}
                </Card>
              ),
            },
            ...(ReferenceCards
              ? [
                  {
                    Id: "reference",
                    Label: "Telemetry",
                    Subtitle: "Live wind instrument readout",
                    Accent: "#e3d598",
                    Content: <>{ReferenceCards}</>,
                  },
                ]
              : []),
          ]}
        />
      </>
    );
  } else if (Subject.Panel === "precipitation") {
    Content = (
      <>
        {Header("Environment", "Precipitation")}
        <SectionStageSwitcher
          ScopeKey="inspector:precipitation"
          AriaLabel="Precipitation inspector sections"
          Sections={[
            {
              Id: "type",
              Label: "Weather Type",
              Subtitle: "Hydrometeor phase & collision toggles",
              Accent: "#91b7cd",
              Content: (
                <>
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
                  <Card Title="Spawn & collision">
                    {Tiles([
                      "Enabled",
                      "Follow Wind",
                      "Spawn from Clouds",
                      "Ground Collision",
                    ])}
                  </Card>
                </>
              ),
            },
            {
              Id: "density",
              Label: "Fall & Scale",
              Subtitle: "Drop intensity, wind drift & nominal diameter",
              Accent: "#7ab8ff",
              Content: (
                <>
                  <Card Title="Fall + density">
                    {Fields("Intensity", "Density", "Particle Size", "Wind Drift")}
                  </Card>
                  <Card Title="Drop scale">
                    <Metric
                      Value={(V("Particle Size") * 3).toFixed(2)}
                      Unit="mm"
                      Caption="Nominal hydrometeor diameter"
                    />
                    <div className="particle-scale">
                      <Icon Name="weather-rain" Size={84} />
                    </div>
                  </Card>
                </>
              ),
            },
            {
              Id: "settling",
              Label: "Settling",
              Subtitle: "Surface accumulation & snow depth",
              Accent: "#e3d598",
              Content: (
                <Card Title="Simulation + settling">
                  {Fields("Accumulation", "Particles", "Snow Depth")}
                </Card>
              ),
            },
          ]}
        />
      </>
    );
  } else if (Subject.Panel === "rainbow") {
    Content = (
      <>
        {Header("Environment", "Rainbow")}
        <SectionStageSwitcher
          ScopeKey="inspector:rainbow"
          AriaLabel="Rainbow inspector sections"
          Sections={[
            {
              Id: "preview",
              Label: "Preview",
              Subtitle: "Primary arc visibility & Alexander's band",
              Accent: "#7be0ad",
              Content: (
                <>
                  <Card Title="Visibility">
                    {Tiles(["Enabled", "Alexander's Band"])}
                  </Card>
                  <Card Title="Optical preview">
                    <div
                      className="rainbow-preview"
                      style={{ opacity: V("Enabled") ? Math.min(1, V("Intensity")) : 0 }}
                    >
                      <div />
                    </div>
                  </Card>
                </>
              ),
            },
            {
              Id: "response",
              Label: "Dispersion",
              Subtitle: "Arc intensity, angular width & secondary bow",
              Accent: "#c5a3ff",
              Content: (
                <>
                  <Card Title="Bow response">
                    {Fields("Intensity", "Width", "Secondary", "Minimum Path")}
                  </Card>
                  <Bake Title="Bake / image" />
                </>
              ),
            },
          ]}
        />
      </>
    );
  } else if (["clouds", "local-cloud"].includes(Subject.Panel)) {
    const Local = Subject.Panel === "local-cloud";
    Content = (
      <>
        {Header("Environment", Local ? "Local Cloud" : "Clouds")}
        <SectionStageSwitcher
          ScopeKey={`inspector:${Subject.Panel}`}
          AriaLabel="Cloud inspector sections"
          Sections={[
            {
              Id: "coverage",
              Label: "Coverage",
              Subtitle: "Sky fraction, formation preset & density body",
              Accent: "#7ab8ff",
              Content: (
                <>
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
                  <Card Title="Cloud settings">
                    {Tiles(["Enabled", "Follow Wind"])}
                  </Card>
                  <section
                    className="cloud-coverage-replacement"
                    data-card="Cloud coverage"
                  >
                    {CloudCoverageCards}
                    {F("Coverage")}
                  </section>
                  <Card Title="Cloud body">
                    {Fields(
                      "Density",
                      "Feature Scale",
                      "Anisotropy",
                      ...(!Local ? ["Type", "Anvil", "Ceiling"] : []),
                    )}
                  </Card>
                </>
              ),
            },
            {
              Id: "altitude",
              Label: "Altitude",
              Subtitle: "Cloud base height, vertical thickness & bounds",
              Accent: "#7be0ad",
              Content: (
                <>
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
                </>
              ),
            },
            {
              Id: "shadows-wind",
              Label: "Shadows & Wind",
              Subtitle: "Solar cloud shadow transmittance & wind advection",
              Accent: "#e3d598",
              Content: (
                <>
                  {!Local && (
                    <Card Title="GPU cloud shadows" GraphHandled>
                      {Sheet.filter((Field) =>
                        ["Cloud Shadows", "Shadow Clock", "Tier Budget"].includes(
                          Field.Group,
                        ),
                      ).map((Field) => F(Field.Label))}
                      <PropertyGraph
                        Title="Cloud shadows"
                        Children={Sheet.filter((Field) =>
                          ["Cloud Shadows", "Shadow Clock", "Tier Budget"].includes(
                            Field.Group,
                          ),
                        ).map((Field) => F(Field.Label))}
                      />
                    </Card>
                  )}
                  <WindBinding
                    Values={Values}
                    Change={Change}
                    Fields={WindFields}
                    Open={OpenWindField}
                    AllValues={AllValues}
                    Hidden={AllHidden}
                  />
                  {ReferenceCards}
                </>
              ),
            },
          ]}
        />
      </>
    );
  } else if (Subject.Panel.includes("fog")) {
    const Local = Subject.Panel === "local-fog",
      Aerial = Subject.Panel === "aerial-fog",
      Height = !Local && !Aerial;
    Content = (
      <>
        {Header("Environment")}
        <SectionStageSwitcher
          ScopeKey={`inspector:${Subject.Panel}`}
          AriaLabel="Fog inspector sections"
          Sections={[
            {
              Id: "visibility",
              Label: "Visibility",
              Subtitle: "Optical extinction curve & activation",
              Accent: "#7ab8ff",
              Content: (
                <>
                  <Card Title="Fog settings">
                    {Tiles(Local ? ["Enabled", "Follow Wind"] : ["Enabled"])}
                  </Card>
                  <Card Title="Visibility through fog" GraphHandled>
                    <FogGraph Kind={Subject.Panel} V={V} Change={AssignProperty} />
                  </Card>
                </>
              ),
            },
            {
              Id: "medium",
              Label: "Medium",
              Subtitle: "Scattering density, falloff height & tint",
              Accent: "#7be0ad",
              Content: (
                <>
                  <Card Title="Medium">
                    {Fields(
                      "Density",
                      Local ? "Coverage" : Aerial ? "Start" : "Falloff Height",
                      Local ? "Feature Scale" : Aerial ? "Mie Blend" : "Sun Scatter",
                      ...(Local ? ["Anisotropy"] : []),
                    )}
                    <FogBeamChamber Kind={Subject.Panel} V={V} />
                  </Card>
                  {!Local && (
                    <Card
                      Title={Aerial ? "Spectral transmission" : "Height & tint"}
                      GraphHandled
                    >
                      {Aerial ? (
                        <FogSpectrum V={V} Change={AssignProperty} />
                      ) : (
                        <HeightFogVisual V={V} Change={AssignProperty} />
                      )}
                      {Height && F("Colour")}
                    </Card>
                  )}
                </>
              ),
            },
            {
              Id: "wind",
              Label: Local ? "Shape & Wind" : "Wind",
              Subtitle: Local ? "Volume bounds & wind advection" : "Wind advection source",
              Accent: "#e3d598",
              Content: (
                <>
                  {Local && <FogShapePanel Values={Values} Change={Change} />}
                  <Card Title="Wind source">
                    {Fields("Wind source", "Owned wind component")}
                  </Card>
                </>
              ),
            },
          ]}
        />
      </>
    );
  } else if (Subject.Panel === "force") {
    Content = (
      <ForceFieldPanel
        Subject={Subject}
        Values={Values}
        Change={Change}
        AllRows={AllRows}
        AllValues={AllValues}
        AllHidden={AllHidden}
        OverlaySettings={ForceOverlaySettings}
        OnChangeOverlay={OnChangeForceOverlay}
        OnSavePreset={OnSaveForcePreset}
        OnDeleteSubject={OnDeleteSubject}
      />
    );
  } else Content = Generic();
  return (
    <GraphContext.Provider value={{ Panel: Subject.Panel }}>
      <div
        className={"specialized-inspector environment-live " + Subject.Panel}
        data-panel={Subject.Panel}
      >
        {Content}
      </div>
    </GraphContext.Provider>
  );
}
