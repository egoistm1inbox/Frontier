import React, { useEffect, useRef, useState } from "react";
import TransformPanel from "./TransformPanel.jsx";
import PrimitiveGlyph from "./PrimitiveIcons.jsx";
import "./PrimitiveInspector.css";

// 🧩 Inspector for the Showcase primitives (Cube, Sphere, Cylinder, Torus, Cone): square quick controls first, then
//    Transform, then a category carousel — Overview · Physics · Geometry · Material · Rendering · Fracture.
// 📝 Every edit is a browser draft stored through Change(Key, Next) like the rest of the HTML editor; nothing reaches
//    the native scene. Quick controls and carousel pages share the same keys (PHYSICS, DYNAMIC, "Cast shadows", GI,
//    LOCKED), so a toggle in one place shows in the other.

const TabStorageKey = "Frontier.ProjectZeroHtml.PrimitiveTab";

const Shapes = {
  cube: {
    Name: "Cube",
    Collider: "Box",
    Purpose: "Reference cube for judging scale, flat-face lighting and hard shadow edges.",
    Reason: "Its six flat faces show how the key light, GI bounce and shadow softness read on planar surfaces.",
    Tags: ["reference", "lighting"],
    Parameters: [
      ["Size X", "Geometry Size X", 1, 0.01, 100, 0.01, "m"],
      ["Size Y", "Geometry Size Y", 1, 0.01, 100, 0.01, "m"],
      ["Size Z", "Geometry Size Z", 1, 0.01, 100, 0.01, "m"],
      ["Bevel", "Geometry Bevel", 0, 0, 0.25, 0.005, "m"],
      ["Bevel segments", "Geometry Bevel Segments", 1, 1, 8, 1, ""],
    ],
  },
  sphere: {
    Name: "Sphere",
    Collider: "Sphere",
    Purpose: "Smooth reference sphere for checking specular highlights, roughness and the terminator line.",
    Reason: "A curved surface shows the full range of light angles at once, so material and exposure changes are easy to judge.",
    Tags: ["reference", "material"],
    Parameters: [
      ["Radius", "Geometry Radius", 0.5, 0.01, 50, 0.01, "m"],
      ["Segments", "Geometry Segments", 32, 3, 128, 1, ""],
      ["Rings", "Geometry Rings", 16, 2, 64, 1, ""],
    ],
  },
  cylinder: {
    Name: "Cylinder",
    Collider: "Capsule",
    Purpose: "Upright cylinder for checking curved-to-flat transitions and contact shadows on the ground.",
    Reason: "Its caps and wall together test smoothing groups, ambient occlusion at the base and rolling physics.",
    Tags: ["reference", "physics"],
    Parameters: [
      ["Radius", "Geometry Radius", 0.5, 0.01, 50, 0.01, "m"],
      ["Height", "Geometry Height", 1, 0.01, 100, 0.01, "m"],
      ["Segments", "Geometry Segments", 32, 3, 128, 1, ""],
    ],
    Caps: true,
  },
  torus: {
    Name: "Torus",
    Collider: "Mesh",
    Purpose: "Ring that tests self-shadowing, the inner cavity's GI and concave collision.",
    Reason: "Light has to bounce into the hole, so it shows whether indirect light and occlusion behave on concave shapes.",
    Tags: ["reference", "GI"],
    Parameters: [
      ["Major radius", "Geometry Major Radius", 0.5, 0.05, 50, 0.01, "m"],
      ["Minor radius", "Geometry Minor Radius", 0.15, 0.01, 20, 0.005, "m"],
      ["Segments", "Geometry Segments", 48, 3, 192, 1, ""],
      ["Sides", "Geometry Sides", 16, 3, 64, 1, ""],
    ],
  },
  cone: {
    Name: "Cone",
    Collider: "Convex",
    Purpose: "Cone for checking a sharp apex, tapering silhouettes and pointed shadow tips.",
    Reason: "The narrowing surface shows normal interpolation and shadow-bias problems near the tip.",
    Tags: ["reference", "silhouette"],
    Parameters: [
      ["Radius", "Geometry Radius", 0.5, 0.01, 50, 0.01, "m"],
      ["Height", "Geometry Height", 1, 0.01, 100, 0.01, "m"],
      ["Segments", "Geometry Segments", 32, 3, 128, 1, ""],
    ],
    Caps: true,
  },
};

const Densities = [
  ["Plastic", 950],
  ["Wood", 700],
  ["Rubber", 1100],
  ["Concrete", 2400],
  ["Glass", 2500],
  ["Aluminium", 2700],
  ["Steel", 7850],
];

const Categories = [
  ["overview", "Overview", "overview", "#7cb7ff"],
  ["physics", "Physics", "physics-tab", "#ff9f5a"],
  ["geometry", "Geometry", "geometry", "#5fe0a0"],
  ["material", "Material", "material", "#ff7eb6"],
  ["rendering", "Rendering", "rendering", "#b39bff"],
  ["fracture", "Fracture", "fracture", "#ff6b6b"],
];

//------------------------------------------------------------------------------------------------------------------------
//                                                   MEASUREMENT
//------------------------------------------------------------------------------------------------------------------------

export function ShapeOf(Subject) {
  const Key = String(Subject.Icon || "").replace(/^editor-/, "");
  return Shapes[Key] ? Key : Shapes[Subject.Id] ? Subject.Id : "cube";
}

const Fixed = (Amount, Digits = 2) =>
  Number.isFinite(Amount) ? Amount.toFixed(Digits) : "–";

// Bounds, volume, area and a closed-mesh vertex count (Euler: V = F / 2 + 2, or F / 2 for the genus-1 torus).
export function Measure(Shape, Read, Scale) {
  const P = (Key, Initial) => +Read(Key, Initial);
  const [Sx, Sy, Sz] = Scale.map((Axis) => Math.abs(+Axis || 0));
  let Bounds, Volume, Area, Triangles, Closed = true;
  if (Shape === "cube") {
    const X = P("Geometry Size X", 1), Y = P("Geometry Size Y", 1), Z = P("Geometry Size Z", 1);
    const Bevel = P("Geometry Bevel", 0), Steps = P("Geometry Bevel Segments", 1);
    Bounds = [X, Y, Z];
    Volume = X * Y * Z;
    Area = 2 * (X * Y + Y * Z + X * Z);
    Triangles = 12 + (Bevel > 0 ? 24 * Steps + 8 * Steps * Steps : 0);
  } else if (Shape === "sphere") {
    const R = P("Geometry Radius", 0.5), S = P("Geometry Segments", 32), Rings = P("Geometry Rings", 16);
    Bounds = [2 * R, 2 * R, 2 * R];
    Volume = (4 / 3) * Math.PI * R ** 3;
    Area = 4 * Math.PI * R * R;
    Triangles = 2 * S * (Rings - 1);
  } else if (Shape === "cylinder") {
    const R = P("Geometry Radius", 0.5), H = P("Geometry Height", 1), S = P("Geometry Segments", 32);
    const Caps = Read("Geometry Caps", true) !== false;
    Bounds = [2 * R, H, 2 * R];
    Volume = Math.PI * R * R * H;
    Area = 2 * Math.PI * R * H + (Caps ? 2 * Math.PI * R * R : 0);
    Triangles = 2 * S + (Caps ? 2 * (S - 2) : 0);
    Closed = Caps;
  } else if (Shape === "torus") {
    const Major = P("Geometry Major Radius", 0.5), Minor = P("Geometry Minor Radius", 0.15);
    const S = P("Geometry Segments", 48), Sides = P("Geometry Sides", 16);
    Bounds = [2 * (Major + Minor), 2 * Minor, 2 * (Major + Minor)];
    Volume = 2 * Math.PI ** 2 * Major * Minor * Minor;
    Area = 4 * Math.PI ** 2 * Major * Minor;
    Triangles = 2 * S * Sides;
  } else {
    const R = P("Geometry Radius", 0.5), H = P("Geometry Height", 1), S = P("Geometry Segments", 32);
    const Caps = Read("Geometry Caps", true) !== false;
    Bounds = [2 * R, H, 2 * R];
    Volume = (Math.PI * R * R * H) / 3;
    Area = Math.PI * R * Math.hypot(R, H) + (Caps ? Math.PI * R * R : 0);
    Triangles = S + (Caps ? S - 2 : 0);
    Closed = Caps;
  }
  const Vertices =
    Shape === "torus" ? Triangles / 2 : Shape === "cone" && !Closed ? P("Geometry Segments", 32) + 1
      : Shape === "cylinder" && !Closed ? 2 * P("Geometry Segments", 32) : Triangles / 2 + 2;
  return {
    Bounds: [Bounds[0] * Sx, Bounds[1] * Sy, Bounds[2] * Sz],
    Volume: Volume * Sx * Sy * Sz,
    Area: Area * Math.cbrt(Sx * Sy * Sz) ** 2,
    Triangles: Math.round(Triangles),
    Vertices: Math.round(Vertices),
    Closed,
  };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONTROLS
//------------------------------------------------------------------------------------------------------------------------

function Slider({ Label, Reading, Assign, Minimum, Maximum, Step = 0.01, Unit = "", Digits = 2, Disabled, Tone }) {
  const Shown = Number.isFinite(+Reading) ? +Reading : Minimum;
  const Fill = ((Shown - Minimum) / (Maximum - Minimum)) * 100;
  return (
    <label className={"pi-slider" + (Disabled ? " is-disabled" : "")}>
      <span className="pi-slider-line">
        <span>{Label}</span>
        <span className="pi-number">
          <input
            type="number"
            min={Minimum}
            max={Maximum}
            step={Step}
            disabled={Disabled}
            aria-label={Label}
            value={+Shown.toFixed(Digits)}
            onChange={(Event) => Event.target.value !== "" && Assign(Math.min(Maximum, Math.max(Minimum, +Event.target.value)))}
          />
          {Unit && <small>{Unit}</small>}
        </span>
      </span>
      <input
        type="range"
        min={Minimum}
        max={Maximum}
        step={Step}
        disabled={Disabled}
        aria-label={Label + " slider"}
        value={Shown}
        style={{ "--pi-fill": Math.max(0, Math.min(100, Fill)) + "%", ...(Tone ? { "--pi-tone": Tone } : {}) }}
        onChange={(Event) => Assign(+Event.target.value)}
      />
    </label>
  );
}

function Switch({ Label, Detail, On, Assign, Disabled, Tone }) {
  return (
    <button
      type="button"
      className={"pi-switch" + (On ? " on" : "")}
      role="switch"
      aria-checked={!!On}
      disabled={Disabled}
      onClick={() => Assign(!On)}
      style={Tone ? { "--pi-tone": Tone } : undefined}
    >
      <span className="pi-switch-text">
        <span>{Label}</span>
        {Detail && <small>{Detail}</small>}
      </span>
      <span className="pi-switch-track">
        <span />
      </span>
    </button>
  );
}

function Segmented({ Label, Choices, Current, Assign, Disabled }) {
  return (
    <div className={"pi-segmented-block" + (Disabled ? " is-disabled" : "")}>
      {Label && <span className="pi-caption">{Label}</span>}
      <div className="pi-segmented" role="radiogroup" aria-label={Label}>
        {Choices.map(([Caption, Key]) => (
          <button
            key={Key}
            type="button"
            role="radio"
            aria-checked={Current === Key}
            className={Current === Key ? "active" : ""}
            disabled={Disabled}
            onClick={() => Assign(Key)}
          >
            {Caption}
          </button>
        ))}
      </div>
    </div>
  );
}

// Dial gauge from the order-status reference: hatched disc, a wedge filling clockwise from twelve o'clock, a dotted
// needle up to the percentage, ticks on a dashed ring. Drag up or down, scroll, or use the arrow keys.
function Dial({ Label, Reading, Assign, Tone, Disabled }) {
  const Drag = useRef(null);
  const Ratio = Math.max(0, Math.min(1, +Reading || 0));
  const Angle = Ratio * Math.PI * 2;
  const Cx = 60, Cy = 66, R = 25;
  const End = [Cx + R * Math.sin(Angle), Cy - R * Math.cos(Angle)];
  const Wedge =
    Ratio >= 0.999
      ? `M${Cx} ${Cy - R}A${R} ${R} 0 1 1 ${Cx - 0.01} ${Cy - R}Z`
      : `M${Cx} ${Cy}L${Cx} ${Cy - R}A${R} ${R} 0 ${Ratio > 0.5 ? 1 : 0} 1 ${End[0].toFixed(2)} ${End[1].toFixed(2)}Z`;
  const Pattern = "pi-hatch-" + Label.replace(/\W/g, "");
  const Nudge = (Delta) => Assign(+Math.max(0, Math.min(1, Ratio + Delta)).toFixed(2));
  return (
    <div
      className={"pi-dial" + (Disabled ? " is-disabled" : "")}
      role="slider"
      tabIndex={Disabled ? -1 : 0}
      aria-label={Label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Ratio * 100)}
      style={{ "--pi-tone": Tone }}
      onKeyDown={(Event) => {
        if (Disabled) return;
        if (["ArrowUp", "ArrowRight"].includes(Event.key)) { Event.preventDefault(); Nudge(0.01); }
        if (["ArrowDown", "ArrowLeft"].includes(Event.key)) { Event.preventDefault(); Nudge(-0.01); }
      }}
      onWheel={(Event) => !Disabled && Nudge(Event.deltaY < 0 ? 0.01 : -0.01)}
      onPointerDown={(Event) => {
        if (Disabled || Event.button !== 0) return;
        Drag.current = { Y: Event.clientY, Start: Ratio };
        Event.currentTarget.setPointerCapture(Event.pointerId);
      }}
      onPointerMove={(Event) => {
        if (!Drag.current) return;
        const Next = Drag.current.Start + (Drag.current.Y - Event.clientY) / 160;
        Assign(+Math.max(0, Math.min(1, Next)).toFixed(2));
      }}
      onPointerUp={() => (Drag.current = null)}
      onPointerCancel={() => (Drag.current = null)}
    >
      <svg viewBox="0 0 120 112" aria-hidden="true">
        <defs>
          <pattern id={Pattern} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="4" fill="#2a2a2a" />
            <rect width="1.4" height="4" fill="#333" />
          </pattern>
        </defs>
        {Array.from({ length: 8 }, (_, Index) => {
          const A = (Index / 8) * Math.PI * 2 + Math.PI / 8;
          return (
            <line
              key={Index}
              x1={Cx + 37 * Math.sin(A)} y1={Cy - 37 * Math.cos(A)}
              x2={Cx + 41 * Math.sin(A)} y2={Cy - 41 * Math.cos(A)}
              stroke="#8a8a8a" strokeWidth="1.2" strokeLinecap="round"
            />
          );
        })}
        <circle cx={Cx} cy={Cy} r="32" fill="none" stroke="#5a5a5a" strokeWidth=".8" strokeDasharray="1.5 2.5" />
        <circle cx={Cx} cy={Cy} r="29" fill="#141414" />
        <circle cx={Cx} cy={Cy} r={R} fill={`url(#${Pattern})`} />
        {Ratio > 0.002 && <path d={Wedge} fill="var(--pi-tone)" />}
        <line x1={Cx} y1={Cy} x2={Cx} y2="14" stroke="#e8e8e8" strokeWidth="1.2" strokeDasharray="1.6 2" />
        <circle cx={Cx} cy={Cy} r="2.6" fill="#f2f2f2" />
      </svg>
      <span className="pi-dial-reading">
        {Math.round(Ratio * 100)}
        <small>%</small>
      </span>
      <span className="pi-dial-label">{Label}</span>
    </div>
  );
}

function Card({ Title, Glyph, Tone, Aside, Pastel, children, className = "" }) {
  return (
    <section className={"pi-card " + (Pastel ? "pi-pastel pi-pastel-" + Pastel + " " : "") + className}>
      {(Title || Aside) && (
        <header className="pi-card-head">
          {Glyph && (
            <span className="pi-card-glyph" style={Tone ? { color: Tone } : undefined}>
              <PrimitiveGlyph Name={Glyph} Size={16} />
            </span>
          )}
          <h3>{Title}</h3>
          {Aside && <span className="pi-card-aside">{Aside}</span>}
        </header>
      )}
      {children}
    </section>
  );
}

function BigFigure({ Whole, Unit, Caption }) {
  const [Integer, Fraction] = String(Whole).split(".");
  return (
    <div className="pi-figure">
      <span className="pi-figure-number">
        {Integer}
        {Fraction !== undefined && <span className="pi-figure-fraction">.{Fraction}</span>}
      </span>
      {Unit && <small>{Unit}</small>}
      {Caption && <p>{Caption}</p>}
    </div>
  );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  QUICK CONTROLS
//------------------------------------------------------------------------------------------------------------------------

const QuickSet = [
  ["Visible", "visible", "#2fd27a"],
  ["Dynamic", "dynamic", "#ff8a3d"],
  ["Shadows", "shadow", "#9b7bff"],
  ["GI", "gi", "#ffc93d"],
  ["Physics", "physics", "#3db4ff"],
  ["Locked", "lock", "#ff4d6d"],
];

function QuickGrid({ Values, Change, Hidden, ToggleHidden }) {
  const Switches = {
    Visible: [!Hidden, ToggleHidden],
    Dynamic: [!!Values.DYNAMIC, () => { const Next = !Values.DYNAMIC; Change("DYNAMIC", Next); if (!Next) Change("PHYSICS", false); }],
    Shadows: [Values["Cast shadows"] ?? true, () => Change("Cast shadows", !(Values["Cast shadows"] ?? true))],
    GI: [Values.GI ?? true, () => Change("GI", !(Values.GI ?? true))],
    Physics: [!!Values.PHYSICS, () => { const Next = !Values.PHYSICS; Change("PHYSICS", Next); if (Next) Change("DYNAMIC", true); }],
    Locked: [!!Values.LOCKED, () => Change("LOCKED", !Values.LOCKED)],
  };
  const Count = Object.values(Switches).filter(([On]) => On).length;
  return (
    <section className="pi-card pi-quick" data-card="Quick controls">
      <header className="pi-card-head">
        <h3>Quick controls</h3>
        <span className="pi-card-aside">
          <b>{Count}</b> / 6 on
        </span>
      </header>
      <div className="pi-quick-grid">
        {QuickSet.map(([Label, Glyph, Tone]) => {
          const [On, Toggle] = Switches[Label];
          return (
            <button
              key={Label}
              type="button"
              className={"pi-quick-tile" + (On ? " on" : "")}
              style={{ "--pi-tone": Tone }}
              aria-pressed={!!On}
              aria-label={Label}
              data-quick-action={Label}
              onClick={Toggle}
            >
              <span className="pi-quick-seat">
                <PrimitiveGlyph Name={Glyph} Size={22} />
              </span>
              <span className="pi-quick-label">{Label}</span>
              <span className="pi-quick-status">{On ? "ON" : "OFF"}</span>
            </button>
          );
        })}
      </div>
      <p className="pi-footnote">
        {Values.DYNAMIC ? "Dynamic" : "Static"} · {Values.PHYSICS ? "physics on" : "physics off"}
        {Values.LOCKED ? " · transform locked" : ""}. Authored flags; native execution is pending.
      </p>
    </section>
  );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     PAGES
//------------------------------------------------------------------------------------------------------------------------

function Checks({ Values, Hidden, Size }) {
  const Scale = Array.isArray(Values.Scale) ? Values.Scale : [1, 1, 1];
  const Rows = [];
  const Uniform = Scale.every((Axis) => Math.abs(Axis - Scale[0]) < 1e-6);
  Rows.push(Uniform ? ["check", "Uniform scale", "Collision and UVs stay true"] : ["warning", "Non-uniform scale", Scale.map((Axis) => Fixed(+Axis, 2)).join(" × ")]);
  if (Values.PHYSICS) {
    const Mass = +Values["Physics Mass Manual"] || 0;
    Rows.push(Values["Physics Mass Mode"] === "manual" && Mass < 0.05 ? ["warning", "Very light body", Fixed(Mass, 3) + " kg may jitter"] : ["check", "Physics ready", "Mass and collider set"]);
  }
  if (Hidden && (Values["Cast shadows"] ?? true)) Rows.push(["warning", "Hidden but casting shadows", "Turn Shadows off to remove it fully"]);
  if (!Size.Closed) Rows.push(["warning", "Open mesh", "No caps: volume and mass are estimates"]);
  if (Values.LOCKED) Rows.push(["check", "Transform locked", "Protected from accidental edits"]);
  if (Size.Triangles > 20000) Rows.push(["warning", "Dense mesh", Size.Triangles.toLocaleString("en-US") + " triangles"]);
  return Rows;
}

function OverviewPage({ Shape, Read, Change, Values, Hidden, Size }) {
  const Profile = Shapes[Shape];
  const Tags = Array.isArray(Values.Tags) ? Values.Tags : Profile.Tags;
  const [Draft, EditDraft] = useState("");
  const Rows = Checks({ Values, Hidden, Size });
  const Passed = Rows.filter(([Verdict]) => Verdict === "check").length;
  return (
    <>
      <Card Title="Purpose" Glyph="purpose" Pastel="yellow" Aside={Profile.Name}>
        <label className="pi-text-block">
          <span>What it does</span>
          <textarea
            rows={3}
            aria-label="What it does"
            value={Read("Purpose", Profile.Purpose)}
            onChange={(Event) => Change("Purpose", Event.target.value)}
          />
        </label>
        <label className="pi-text-block">
          <span>Why it's here</span>
          <textarea
            rows={3}
            aria-label="Why it's here"
            value={Read("Reason", Profile.Reason)}
            onChange={(Event) => Change("Reason", Event.target.value)}
          />
        </label>
      </Card>

      <div className="pi-chip-row" aria-label="Summary">
        <span className="pi-chip"><b>{Size.Triangles.toLocaleString("en-US")}</b> tris</span>
        <span className="pi-chip"><b>{Size.Vertices.toLocaleString("en-US")}</b> verts</span>
        <span className="pi-chip"><b>1</b> material</span>
        <span className="pi-chip"><b>{Values.DYNAMIC ? "Dynamic" : "Static"}</b></span>
      </div>

      <div className="pi-status-pair">
        <div className="pi-status">
          <span className="pi-status-icon ok"><PrimitiveGlyph Name="check" Size={12} /></span>
          <span className="pi-status-label">Checks passed</span>
          <span className="pi-status-number">{Passed}</span>
        </div>
        <div className="pi-status">
          <span className="pi-status-icon warn"><PrimitiveGlyph Name="warning" Size={12} /></span>
          <span className="pi-status-label">Warnings</span>
          <span className="pi-status-number">{Rows.length - Passed}</span>
        </div>
      </div>

      <Card Title="Footprint" Glyph="ruler" Tone="#5fe0a0" Aside="World size">
        <BigFigure Whole={Fixed(Size.Volume, 3)} Unit="m³" Caption="Volume" />
        <div className="pi-stat-grid">
          <div><span>Width</span><b>{Fixed(Size.Bounds[0])}<small> m</small></b></div>
          <div><span>Height</span><b>{Fixed(Size.Bounds[1])}<small> m</small></b></div>
          <div><span>Depth</span><b>{Fixed(Size.Bounds[2])}<small> m</small></b></div>
        </div>
        <p className="pi-footnote">Surface ≈ {Fixed(Size.Area)} m² · bounds include scale.</p>
      </Card>

      <Card Title="Checks" Glyph="check" Tone="#2fd27a" Aside={`${Passed} / ${Rows.length}`}>
        <ul className="pi-checks">
          {Rows.map(([Verdict, Title, Detail]) => (
            <li key={Title}>
              <span className={"pi-status-icon " + (Verdict === "check" ? "ok" : "warn")}>
                <PrimitiveGlyph Name={Verdict} Size={11} />
              </span>
              <span>
                <b>{Title}</b>
                <small>{Detail}</small>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card Title="Tags" Glyph="tag" Tone="#7cb7ff">
        <div className="pi-tags">
          {Tags.map((Tag) => (
            <span className="pi-tag" key={Tag}>
              {Tag}
              <button type="button" aria-label={"Remove tag " + Tag} onClick={() => Change("Tags", Tags.filter((Each) => Each !== Tag))}>
                <PrimitiveGlyph Name="close" Size={10} />
              </button>
            </span>
          ))}
          <form
            className="pi-tag-add"
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
      </Card>

      <Card Title="Notes" Glyph="notes" Tone="#c9c9c9" Aside="Shared with the header">
        <textarea
          className="pi-notes"
          rows={3}
          aria-label="Notes"
          placeholder="Ownership, review notes, links…"
          value={Values.Notes || ""}
          onChange={(Event) => Change("Notes", Event.target.value)}
        />
      </Card>
    </>
  );
}

function PhysicsPage({ Shape, Read, Change, Values, Size }) {
  const Simulate = !!Values.PHYSICS;
  const Body = !Values.DYNAMIC ? "static" : Read("Physics Body", "dynamic");
  const Density = Read("Physics Density", "Plastic");
  const DensityKg = (Densities.find(([Name]) => Name === Density) || Densities[0])[1];
  const Manual = Read("Physics Mass Mode", "auto") === "manual";
  const Mass = Manual ? +Read("Physics Mass Manual", 1) : DensityKg * Size.Volume;
  const Off = !Simulate;
  return (
    <>
      <Card Title="Simulation" Glyph="physics-tab" Tone="#ff9f5a">
        <Switch
          Label="Simulate physics"
          Detail={Simulate ? "Rigid body in the physics world" : "Off: the object never moves on its own"}
          On={Simulate}
          Tone="#ff9f5a"
          Assign={(Next) => { Change("PHYSICS", Next); if (Next) Change("DYNAMIC", true); }}
        />
        <Segmented
          Label="Body type"
          Current={Body}
          Choices={[["Static", "static"], ["Dynamic", "dynamic"], ["Kinematic", "kinematic"]]}
          Assign={(Next) => {
            if (Next === "static") { Change("DYNAMIC", false); Change("PHYSICS", false); return; }
            Change("DYNAMIC", true);
            Change("Physics Body", Next);
          }}
        />
      </Card>

      <Card Title="Mass" Glyph="weight" Pastel="blue" Aside={Manual ? "Manual" : "From density"}>
        <BigFigure Whole={Mass >= 100 ? Fixed(Mass, 0) : Fixed(Mass, Mass < 1 ? 3 : 1)} Unit="kg" />
        <Segmented
          Current={Manual ? "manual" : "auto"}
          Choices={[["From density", "auto"], ["Manual", "manual"]]}
          Assign={(Next) => {
            if (Next === "manual") Change("Physics Mass Manual", +Mass.toFixed(3));
            Change("Physics Mass Mode", Next);
          }}
        />
        {Manual ? (
          <Slider Label="Mass" Reading={Mass} Minimum={0.01} Maximum={5000} Step={0.01} Unit="kg" Assign={(Next) => Change("Physics Mass Manual", Next)} />
        ) : (
          <div className="pi-density">
            {Densities.map(([Name, Kg]) => (
              <button key={Name} type="button" className={Name === Density ? "active" : ""} onClick={() => Change("Physics Density", Name)}>
                {Name}
                <small>{Kg}</small>
              </button>
            ))}
          </div>
        )}
        <p className="pi-footnote">{Fixed(Size.Volume, 3)} m³ × {DensityKg} kg/m³{Manual ? " (ignored)" : ""}</p>
      </Card>

      <Card Title="Surface response" Glyph="physics" Tone="#ffc93d" Aside={Off ? "Simulation off" : "Drag a dial"} className={"pi-dial-card" + (Off ? " is-muted" : "")}>
        <div className="pi-dial-grid">
          <Dial Label="Friction" Tone="#e6cf72" Reading={Read("Physics Friction", 0.6)} Assign={(Next) => Change("Physics Friction", Next)} />
          <Dial Label="Bounciness" Tone="#a9bfdc" Reading={Read("Physics Bounciness", 0.2)} Assign={(Next) => Change("Physics Bounciness", Next)} />
          <Dial Label="Linear damping" Tone="#f2f2f2" Reading={Read("Physics Linear Damping", 0.05)} Assign={(Next) => Change("Physics Linear Damping", Next)} />
          <Dial Label="Angular damping" Tone="#ea6b45" Reading={Read("Physics Angular Damping", 0.1)} Assign={(Next) => Change("Physics Angular Damping", Next)} />
        </div>
      </Card>

      <Card Title="Collision" Glyph="geometry" Tone="#3db4ff">
        <Segmented
          Label="Collider"
          Current={Read("Physics Collider", Shapes[Shape].Collider)}
          Choices={[["Box", "Box"], ["Sphere", "Sphere"], ["Capsule", "Capsule"], ["Convex", "Convex"], ["Mesh", "Mesh"]]}
          Assign={(Next) => Change("Physics Collider", Next)}
        />
        <Switch Label="Collides" Detail="Other bodies bump into it" On={Read("Physics Collides", true)} Assign={(Next) => Change("Physics Collides", Next)} />
        <Slider Label="Gravity scale" Reading={Read("Physics Gravity Scale", 1)} Minimum={-2} Maximum={4} Step={0.05} Unit="×" Disabled={Off} Assign={(Next) => Change("Physics Gravity Scale", Next)} />
        <Switch Label="Continuous collision" Detail="Stops fast bodies tunnelling through thin walls" On={Read("Physics CCD", false)} Disabled={Off} Assign={(Next) => Change("Physics CCD", Next)} />
        <Switch Label="Start asleep" Detail="Wakes on first contact" On={Read("Physics Asleep", false)} Disabled={Off} Assign={(Next) => Change("Physics Asleep", Next)} />
      </Card>
    </>
  );
}

const PivotRows = ["Top", "Middle", "Bottom"];
const PivotColumns = ["Left", "Centre", "Right"];

function GeometryPage({ Shape, Read, Change, Values, Size }) {
  const Profile = Shapes[Shape];
  const Locked = !!Values.LOCKED;
  const Pivot = Array.isArray(Values.Origin) ? Values.Origin : [1, 1];
  const Offset = [(Pivot[0] - 1) * Size.Bounds[0] * 0.5, (1 - Pivot[1]) * Size.Bounds[1] * 0.5, 0];
  const Position = Array.isArray(Values.Position) ? Values.Position : [0, 0, 0];
  const Shading = Read("Geometry Shading", "smooth");
  return (
    <>
      <Card Title={Profile.Name + " shape"} Glyph="geometry" Tone="#5fe0a0" Aside={Locked ? "Locked" : "Primitive"}>
        {Profile.Parameters.map(([Label, Key, Initial, Minimum, Maximum, Step, Unit]) => (
          <Slider
            key={Key}
            Label={Label}
            Reading={Read(Key, Initial)}
            Minimum={Minimum}
            Maximum={Maximum}
            Step={Step}
            Unit={Unit}
            Digits={Step >= 1 ? 0 : Step >= 0.01 ? 2 : 3}
            Disabled={Locked}
            Tone="#5fe0a0"
            Assign={(Next) => Change(Key, Step >= 1 ? Math.round(Next) : Next)}
          />
        ))}
        {Profile.Caps && (
          <Switch Label="Caps" Detail="Close the ends" On={Read("Geometry Caps", true) !== false} Disabled={Locked} Assign={(Next) => Change("Geometry Caps", Next)} />
        )}
        <div className="pi-stat-grid">
          <div><span>Triangles</span><b>{Size.Triangles.toLocaleString("en-US")}</b></div>
          <div><span>Vertices</span><b>{Size.Vertices.toLocaleString("en-US")}</b></div>
          <div><span>Closed</span><b>{Size.Closed ? "Yes" : "No"}</b></div>
        </div>
      </Card>

      <Card Title="Origin" Glyph="pivot" Tone="#ffc93d" Aside={PivotRows[Pivot[1]] + " · " + PivotColumns[Pivot[0]]}>
        <div className="pi-origin">
          <div className="pi-pivot-grid" role="radiogroup" aria-label="Origin point">
            {PivotRows.map((Row, RowIndex) =>
              PivotColumns.map((Column, ColumnIndex) => {
                const Active = Pivot[0] === ColumnIndex && Pivot[1] === RowIndex;
                return (
                  <button
                    key={Row + Column}
                    type="button"
                    role="radio"
                    aria-checked={Active}
                    aria-label={Row + " " + Column}
                    className={Active ? "active" : ""}
                    disabled={Locked}
                    onClick={() => Change("Origin", [ColumnIndex, RowIndex])}
                  >
                    <span />
                  </button>
                );
              }),
            )}
          </div>
          <div className="pi-origin-readout">
            <span>Offset from centre</span>
            <b>{Offset.map((Axis) => Fixed(Axis, 2)).join("  ")}</b>
            <small>metres, X Y Z</small>
          </div>
        </div>
        <div className="pi-actions">
          <button type="button" disabled={Locked} onClick={() => Change("Origin", [1, 1])}>Origin to centre</button>
          <button type="button" disabled={Locked} onClick={() => Change("Origin", [1, 2])}>Origin to bottom</button>
          <button type="button" disabled={Locked} onClick={() => Change("Position", [0, 0, 0])}>Move to world origin</button>
          <button
            type="button"
            disabled={Locked}
            onClick={() => Change("Position", [Position[0], +(Size.Bounds[1] * 0.5 + Offset[1]).toFixed(4), Position[2]])}
          >
            Drop to floor
          </button>
        </div>
      </Card>

      <Card Title="Surface" Glyph="material" Tone="#ff7eb6">
        <Segmented Label="Shading" Current={Shading} Choices={[["Smooth", "smooth"], ["Auto", "auto"], ["Flat", "flat"]]} Disabled={Locked} Assign={(Next) => Change("Geometry Shading", Next)} />
        {Shading === "auto" && (
          <Slider Label="Smoothing angle" Reading={Read("Geometry Smooth Angle", 40)} Minimum={0} Maximum={180} Step={1} Digits={0} Unit="°" Disabled={Locked} Assign={(Next) => Change("Geometry Smooth Angle", Next)} />
        )}
        <Segmented Label="UV projection" Current={Read("Geometry UV", Shape === "sphere" ? "sphere" : Shape === "cube" ? "box" : "cylinder")} Choices={[["Box", "box"], ["Cylinder", "cylinder"], ["Sphere", "sphere"]]} Disabled={Locked} Assign={(Next) => Change("Geometry UV", Next)} />
        <Slider Label="UV scale" Reading={Read("Geometry UV Scale", 1)} Minimum={0.05} Maximum={20} Step={0.05} Unit="×" Disabled={Locked} Assign={(Next) => Change("Geometry UV Scale", Next)} />
      </Card>
    </>
  );
}

function RenderingPage({ Read, Change, Values, Size }) {
  return (
    <>
      <Card Title="Shadows & light" Glyph="shadow" Tone="#9b7bff">
        <Switch Label="Cast shadows" Detail="Same as the Shadows quick control" On={Values["Cast shadows"] ?? true} Tone="#9b7bff" Assign={(Next) => Change("Cast shadows", Next)} />
        <Switch Label="Receive shadows" On={Read("Receive shadows", true)} Tone="#9b7bff" Assign={(Next) => Change("Receive shadows", Next)} />
        <Switch Label="Contribute to GI" Detail="Same as the GI quick control" On={Values.GI ?? true} Tone="#ffc93d" Assign={(Next) => Change("GI", Next)} />
        <Segmented Label="Shadow detail" Current={Read("Shadow detail", "high")} Choices={[["Low", "low"], ["Medium", "medium"], ["High", "high"]]} Assign={(Next) => Change("Shadow detail", Next)} />
      </Card>
      <Card Title="Visibility" Glyph="visible" Tone="#2fd27a">
        <Slider Label="Draw distance" Reading={Read("Draw distance", 1000)} Minimum={10} Maximum={5000} Step={10} Digits={0} Unit="m" Tone="#2fd27a" Assign={(Next) => Change("Draw distance", Next)} />
        <Slider Label="LOD bias" Reading={Read("LOD bias", 0)} Minimum={-2} Maximum={2} Step={0.1} Digits={1} Tone="#2fd27a" Assign={(Next) => Change("LOD bias", Next)} />
        <Switch Label="Visible in reflections" On={Read("Visible in reflections", true)} Assign={(Next) => Change("Visible in reflections", Next)} />
        <Switch Label="Motion vectors" Detail="For motion blur and temporal AA" On={Read("Motion vectors", true)} Assign={(Next) => Change("Motion vectors", Next)} />
      </Card>
      <Card Title="Cost" Glyph="rendering" Tone="#b39bff" Aside="Per frame">
        <div className="pi-stat-grid">
          <div><span>Draw calls</span><b>1</b></div>
          <div><span>Triangles</span><b>{Size.Triangles.toLocaleString("en-US")}</b></div>
          <div><span>Shadow casts</span><b>{(Values["Cast shadows"] ?? true) ? "Yes" : "No"}</b></div>
        </div>
      </Card>
    </>
  );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    CAROUSEL
//------------------------------------------------------------------------------------------------------------------------

function RememberedTab() {
  try {
    const Saved = localStorage.getItem(TabStorageKey);
    return Categories.some(([Key]) => Key === Saved) ? Saved : "overview";
  } catch {
    return "overview";
  }
}

function Carousel({ Pages }) {
  const [Current, Choose] = useState(RememberedTab);
  const [Direction, Turn] = useState("none");
  const Rail = useRef(null);
  const Index = Math.max(0, Categories.findIndex(([Key]) => Key === Current));
  const Go = (Next) => {
    const Target = (Next + Categories.length) % Categories.length;
    Turn(Target >= Index ? "next" : "previous");
    Choose(Categories[Target][0]);
    try { localStorage.setItem(TabStorageKey, Categories[Target][0]); } catch {}
  };
  useEffect(() => {
    const Pill = Rail.current?.querySelector('[aria-selected="true"]');
    Pill?.scrollIntoView?.({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [Current]);
  const Swipe = useRef(null);
  const [Key, Label, , Tone] = Categories[Index];
  return (
    <section className="pi-carousel" aria-label="Categories">
      <div className="pi-carousel-bar">
        <button type="button" className="pi-round" aria-label="Previous category" onClick={() => Go(Index - 1)}>
          <span className="pi-flip"><PrimitiveGlyph Name="chevron" Size={14} /></span>
        </button>
        <div className="pi-pill-rail" role="tablist" ref={Rail}>
          {Categories.map(([Each, Caption, Glyph, EachTone], Slot) => (
            <button
              key={Each}
              type="button"
              role="tab"
              aria-selected={Each === Key}
              aria-label={Caption}
              title={Caption}
              className={"pi-pill" + (Each === Key ? " active" : "")}
              style={{ "--pi-tone": EachTone }}
              onClick={() => Go(Slot)}
              onKeyDown={(Event) => {
                if (Event.key === "ArrowRight") { Event.preventDefault(); Go(Index + 1); }
                if (Event.key === "ArrowLeft") { Event.preventDefault(); Go(Index - 1); }
              }}
            >
              <PrimitiveGlyph Name={Glyph} Size={15} />
              <span className="pi-pill-caption">{Caption}</span>
            </button>
          ))}
        </div>
        <button type="button" className="pi-round" aria-label="Next category" onClick={() => Go(Index + 1)}>
          <PrimitiveGlyph Name="chevron" Size={14} />
        </button>
      </div>
      <div className="pi-carousel-meta">
        <span style={{ color: Tone }}>{Label}</span>
        <span className="pi-dots" aria-hidden="true">
          {Categories.map(([Each]) => (
            <i key={Each} className={Each === Key ? "active" : ""} />
          ))}
        </span>
        <span>
          {Index + 1} / {Categories.length}
        </span>
      </div>
      <div
        key={Key}
        className={"pi-page pi-enter-" + Direction}
        role="tabpanel"
        aria-label={Label}
        data-page={Key}
        onPointerDown={(Event) => {
          if (Event.target.closest("input, textarea, button, select, [role=slider], label")) return;
          Swipe.current = { X: Event.clientX, Y: Event.clientY };
        }}
        onPointerUp={(Event) => {
          const Start = Swipe.current;
          Swipe.current = null;
          if (!Start) return;
          const Dx = Event.clientX - Start.X, Dy = Event.clientY - Start.Y;
          if (Math.abs(Dx) > 60 && Math.abs(Dx) > Math.abs(Dy) * 1.5) Go(Index + (Dx < 0 ? 1 : -1));
        }}
      >
        {Pages[Key]}
      </div>
    </section>
  );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    INSPECTOR
//------------------------------------------------------------------------------------------------------------------------

export default function PrimitiveInspector({ Subject, Values, Change, Hidden, ToggleHidden, MaterialCards, FractureCards }) {
  const Shape = ShapeOf(Subject);
  const Read = (Key, Initial) => (Values[Key] === undefined ? Initial : Values[Key]);
  const Size = Measure(Shape, Read, Array.isArray(Values.Scale) ? Values.Scale : [1, 1, 1]);
  const Shared = { Shape, Read, Change, Values, Hidden, Size };
  return (
    <div className="primitive-inspector">
      <QuickGrid Values={Values} Change={Change} Hidden={Hidden} ToggleHidden={ToggleHidden} />
      <TransformPanel Values={Values} Change={Change} />
      <Carousel
        Pages={{
          overview: <OverviewPage {...Shared} />,
          physics: <PhysicsPage {...Shared} />,
          geometry: <GeometryPage {...Shared} />,
          material: MaterialCards,
          rendering: <RenderingPage {...Shared} />,
          fracture: FractureCards,
        }}
      />
    </div>
  );
}
