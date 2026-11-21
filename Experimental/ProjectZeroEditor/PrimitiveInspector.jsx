import React, { useEffect, useRef, useState } from "react";
import TransformPanel from "./TransformPanel.jsx";
import PrimitiveGlyph from "./PrimitiveIcons.jsx";
import "./PrimitiveInspector.css";

// 🧩 Inspector for the Showcase primitives (Cube, Sphere, Cylinder, Torus, Cone): one category carousel —
//    Overview (purpose, info cards, quick controls last) · Physics · Geometry (Transform first) · Material · Fracture.
// 📝 Every edit is a browser draft stored through Change(Key, Next) like the rest of the HTML editor; nothing reaches
//    the native scene. Quick controls and carousel pages share the same keys (PHYSICS, DYNAMIC, "Cast shadows", GI,
//    LOCKED), so a toggle in one place shows in the other.

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

function Card({ Title, Glyph, Tone, Aside, children, className = "" }) {
  return (
    <section className={"pi-card " + className} data-card={Title}>
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
  ["Visible", "visible"],
  ["Dynamic", "dynamic"],
  ["Shadows", "shadow"],
  ["GI", "gi"],
  ["Physics", "physics"],
  ["Locked", "lock"],
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
        {QuickSet.map(([Label, Glyph]) => {
          const [On, Toggle] = Switches[Label];
          return (
            <button
              key={Label}
              type="button"
              className={"pi-quick-tile" + (On ? " on" : "")}
              aria-pressed={!!On}
              aria-label={Label}
              data-quick-action={Label}
              onClick={Toggle}
            >
              <span className={"pi-status-icon " + (On ? "ok" : "idle")}>
                <PrimitiveGlyph Name={Glyph} Size={17} />
              </span>
              <span className="pi-quick-label">{Label}</span>
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

function OverviewPage({ Shape, Read, Change, Values, Hidden, ToggleHidden, Size }) {
  const Profile = Shapes[Shape];
  const Tags = Array.isArray(Values.Tags) ? Values.Tags : Profile.Tags;
  const [Draft, EditDraft] = useState("");
  const Rows = Checks({ Values, Hidden, Size });
  const Passed = Rows.filter(([Verdict]) => Verdict === "check").length;
  return (
    <>
      <Card Title="Purpose" Glyph="purpose" Tone="#e6cf72" Aside={Profile.Name} className="pi-purpose">
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

      <QuickGrid Values={Values} Change={Change} Hidden={Hidden} ToggleHidden={ToggleHidden} />
    </>
  );
}

// Drop study: the body is released from 3 m and integrated for two seconds with the authored gravity scale, linear
// damping and bounciness (restitution), so every one of those controls reshapes the drawn path.
const DropHeight = 3, DropSeconds = 2;
function SimulateDrop({ Gravity, Damping, Restitution }) {
  const G = 9.81 * Gravity, Step = 1 / 240, Path = [[0, DropHeight]];
  let Height = DropHeight, Velocity = 0, Impact = null, ImpactSpeed = 0, Rebound = 0, Settle = null, Peak = 0, Rising = false;
  for (let Time = Step; Time <= DropSeconds + 1e-9; Time += Step) {
    Velocity += (-G - Damping * Velocity) * Step;
    Height += Velocity * Step;
    if (Height <= 0 && Velocity < 0) {
      Height = 0;
      if (Impact === null) { Impact = Time; ImpactSpeed = -Velocity; }
      Velocity = -Velocity * Restitution;
      if (Velocity < 0.05) { Velocity = 0; if (Settle === null) Settle = Time; }
      Rising = true;
      Peak = 0;
    }
    if (Rising) {
      Peak = Math.max(Peak, Height);
      if (Velocity <= 0 && Height > 0) { if (!Rebound) Rebound = Peak; Rising = false; }
    }
    if (Settle !== null && Height <= 0) Height = 0;
    Path.push([Time, Math.min(Height, DropHeight * 1.6)]);
  }
  return { Path, Impact, ImpactSpeed, Rebound, Settle };
}

function ShapeMark({ Shape, X, Y, Size, ...Rest }) {
  const H = Size / 2;
  if (Shape === "cube") return <rect x={X - H} y={Y - Size} width={Size} height={Size} rx="1.5" {...Rest} />;
  if (Shape === "cone") return <path d={`M${X - H} ${Y}L${X} ${Y - Size}L${X + H} ${Y}Z`} {...Rest} />;
  if (Shape === "cylinder") return <rect x={X - H * 0.8} y={Y - Size} width={Size * 0.8} height={Size} rx={H * 0.4} {...Rest} />;
  if (Shape === "torus")
    return <ellipse cx={X} cy={Y - H * 0.6} rx={H} ry={H * 0.6} fill="none" strokeWidth={H * 0.45} {...Rest} stroke={Rest.fill} />;
  return <circle cx={X} cy={Y - H} r={H} {...Rest} />;
}

function DropStudy({ Shape, Body, Simulate, Gravity, Damping, Restitution }) {
  const Left = 36, Right = 290, Top = 16, Ground = 128;
  const Px = (Time) => Left + (Time / DropSeconds) * (Right - Left);
  const Py = (Height) => Ground - (Height / (DropHeight * 1.15)) * (Ground - Top);
  const Moving = Simulate && Body === "dynamic";
  const Run = SimulateDrop({ Gravity, Damping, Restitution });
  const Line = Run.Path.filter((_, Index) => Index % 4 === 0).map(([T, H]) => `${Px(T).toFixed(1)},${Py(H).toFixed(1)}`).join(" ");
  const Ghosts = Moving ? Run.Path.filter((_, Index) => Index % 48 === 0 && Index > 0) : [];
  return (
    <svg className="pi-study-svg" viewBox="0 0 300 150" role="img" aria-label="Drop study" data-study="drop">
      {[0, 1, 2, 3].map((Metre) => (
        <g key={Metre}>
          <line x1={Left} x2={Right} y1={Py(Metre)} y2={Py(Metre)} stroke="#ffffff10" strokeDasharray={Metre ? "2 4" : ""} />
          <text x={Left - 8} y={Py(Metre) + 3} textAnchor="end">{Metre} m</text>
        </g>
      ))}
      {[0, 0.5, 1, 1.5, 2].map((Second) => (
        <text key={Second} x={Px(Second)} y={Ground + 14} textAnchor="middle">{Second} s</text>
      ))}
      <line x1={Left} x2={Right} y1={Ground} y2={Ground} stroke="#6a6a6a" />
      {Array.from({ length: 26 }, (_, Index) => (
        <line key={Index} x1={Left + Index * 10} x2={Left + Index * 10 - 5} y1={Ground + 1} y2={Ground + 5} stroke="#3a3a3a" />
      ))}
      {Moving ? (
        <>
          <polyline points={Line} fill="none" stroke="#ff9f5a" strokeWidth="1.6" strokeLinejoin="round" />
          {Ghosts.map(([T, H], Index) => (
            <ShapeMark key={Index} Shape={Shape} X={Px(T)} Y={Py(H)} Size={9} fill="#ff9f5a" opacity={0.18 + 0.5 * (1 - Index / Ghosts.length)} />
          ))}
          {Run.Impact !== null && (
            <g>
              <line x1={Px(Run.Impact)} x2={Px(Run.Impact)} y1={Top} y2={Ground} stroke="#ffffff30" strokeDasharray="2 3" />
              <text x={Px(Run.Impact) + 4} y={Top + 8} className="pi-study-accent">impact {Run.Impact.toFixed(2)} s</text>
            </g>
          )}
          <ShapeMark Shape={Shape} X={Px(0)} Y={Py(DropHeight)} Size={14} fill="#f2f2f2" />
        </>
      ) : (
        <>
          <polyline points={Line} fill="none" stroke="#8a8a8a" strokeWidth="1.2" strokeDasharray="3 3" opacity=".35" />
          <text x={Px(1.55)} y={Py(1.6)} textAnchor="middle" opacity=".7">if simulated as dynamic</text>
          <line x1={Left} x2={Right} y1={Body === "kinematic" && Simulate ? Py(DropHeight) : Ground - 0.5} y2={Body === "kinematic" && Simulate ? Py(DropHeight) : Ground - 0.5} stroke="#8a8a8a" strokeDasharray="4 4" />
          <ShapeMark Shape={Shape} X={Px(0.9)} Y={Body === "kinematic" && Simulate ? Py(DropHeight) : Ground} Size={18} fill="#9a9a9a" />
          <text x={Px(1)} y={Top + 10} textAnchor="middle" className="pi-study-accent">
            {!Simulate ? "Simulation off · stays where it is placed" : Body === "kinematic" ? "Kinematic · moved by animation, ignores gravity" : "Static · never moves"}
          </text>
        </>
      )}
    </svg>
  );
}

// Mass on a logarithmic ruler from 10 g to 10 t, next to everyday objects, so the number has a feel.
const Everyday = [
  ["Phone", 0.2],
  ["Brick", 2.5],
  ["Bowling ball", 7],
  ["Person", 75],
  ["Piano", 300],
  ["Car", 1500],
];
function MassRuler({ Mass, Name }) {
  const Left = 18, Right = 282, Axis = 66;
  const Lowest = -2, Highest = 4;
  const Px = (Kg) => Left + ((Math.log10(Math.max(1e-6, Kg)) - Lowest) / (Highest - Lowest)) * (Right - Left);
  const X = Math.max(Left, Math.min(Right, Px(Mass)));
  const Nearest = NearestEveryday(Mass);
  const Bubble = `${Name} ${Mass >= 100 ? Mass.toFixed(0) : Mass.toFixed(Mass < 1 ? 3 : 1)} kg`;
  const BubbleWidth = Bubble.length * 5.2 + 14;
  const BubbleX = Math.max(4, Math.min(296 - BubbleWidth, X - BubbleWidth / 2));
  return (
    <svg className="pi-study-svg" viewBox="0 0 300 112" role="img" aria-label="Mass ruler" data-study="mass">
      {["10 g", "100 g", "1 kg", "10 kg", "100 kg", "1 t", "10 t"].map((Label, Index) => {
        const Tx = Left + (Index / 6) * (Right - Left);
        return (
          <g key={Label}>
            <line x1={Tx} x2={Tx} y1={Axis - 10} y2={Axis - 5} stroke="#4a4a4a" />
            <text x={Tx} y={Axis - 14} textAnchor="middle">{Label}</text>
          </g>
        );
      })}
      <rect x={Left} y={Axis - 3} width={Right - Left} height="6" rx="3" fill="#0e0e0e" />
      <rect x={Left} y={Axis - 3} width={Math.max(0, X - Left)} height="6" rx="3" fill="#a9bfdc" opacity=".85" />
      {Everyday.map(([Label, Kg], Index) => {
        const Tx = Px(Kg), Row = Index % 2 ? 100 : 86, Close = Label === Nearest[0];
        return (
          <g key={Label} opacity={Close ? 1 : 0.6}>
            <circle cx={Tx} cy={Axis} r="2.2" fill={Close ? "#f2f2f2" : "#5a5a5a"} />
            <line x1={Tx} x2={Tx} y1={Axis + 5} y2={Row - 8} stroke="#3a3a3a" />
            <text x={Tx} y={Row} textAnchor="middle" className={Close ? "pi-study-accent" : ""}>{Label}</text>
          </g>
        );
      })}
      <rect x={BubbleX} y="4" width={BubbleWidth} height="18" rx="9" fill="#f2f2f2" />
      <text x={BubbleX + BubbleWidth / 2} y="16" textAnchor="middle" className="pi-study-dark">{Bubble}</text>
      <path d={`M${X - 4} 24L${X + 4} 24L${X} 29Z`} fill="#f2f2f2" />
      <line x1={X} x2={X} y1="29" y2={Axis - 4} stroke="#f2f2f2" strokeDasharray="1.5 2" />
    </svg>
  );
}

function NearestEveryday(Mass) {
  return Everyday.reduce((Best, Each) => (Math.abs(Math.log(Each[1] / Mass)) < Math.abs(Math.log(Best[1] / Mass)) ? Each : Best));
}
const Comparison = (Mass) => {
  const [Label, Kg] = NearestEveryday(Mass), Ratio = Mass / Kg;
  return `≈ ${Ratio >= 10 ? Ratio.toFixed(0) : Ratio.toFixed(Ratio < 1 ? 2 : 1)} × ${Label.toLowerCase()}`;
};

function PhysicsPage({ Shape, Read, Change, Values, Size }) {
  const Simulate = !!Values.PHYSICS;
  const Body = !Values.DYNAMIC ? "static" : Read("Physics Body", "dynamic");
  const Density = Read("Physics Density", "Plastic");
  const DensityKg = (Densities.find(([Name]) => Name === Density) || Densities[0])[1];
  const Manual = Read("Physics Mass Mode", "auto") === "manual";
  const Mass = Manual ? +Read("Physics Mass Manual", 1) : DensityKg * Size.Volume;
  const Off = !Simulate;
  const Gravity = +Read("Physics Gravity Scale", 1);
  const Damping = +Read("Physics Linear Damping", 0.05);
  const Restitution = +Read("Physics Bounciness", 0.2);
  const Run = SimulateDrop({ Gravity, Damping, Restitution });
  const Moving = Simulate && Body === "dynamic";
  const Speed = Moving && Run.Impact !== null ? Fixed(Run.ImpactSpeed, 1) : "0.0";
  return (
    <>
      <Card Title="Simulation" Glyph="physics-tab" Tone="#ff9f5a" Aside={Moving ? "Drop from 3 m" : Off ? "Off" : Body} className="pi-study-card">
        <BigFigure
          Whole={Speed}
          Unit="m/s"
          Caption={
            Moving
              ? Run.Impact !== null
                ? `Impact speed · lands after ${Run.Impact.toFixed(2)} s`
                : "Never lands within 2 s · gravity too weak or negative"
              : "Impact speed · body is not simulated"
          }
        />
        <div className="pi-study">
          <DropStudy Shape={Shape} Body={Body} Simulate={Simulate} Gravity={Gravity} Damping={Damping} Restitution={Restitution} />
        </div>
        <p className="pi-study-note">Illustrative drop in a vacuum column · uses gravity scale, linear damping and bounciness.</p>
        <div className="pi-stat-grid">
          <div><span>Rebound</span><b>{Moving && Run.Rebound ? Fixed(Run.Rebound, 2) : "–"}<small> m</small></b></div>
          <div><span>Comes to rest</span><b>{Moving && Run.Settle !== null ? Fixed(Run.Settle, 2) : "–"}<small> s</small></b></div>
          <div><span>Gravity</span><b>{Fixed(9.81 * Gravity, 1)}<small> m/s²</small></b></div>
        </div>
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
        <Slider Label="Gravity scale" Reading={Gravity} Minimum={-2} Maximum={4} Step={0.05} Unit="×" Disabled={Off} Tone="#ff9f5a" Assign={(Next) => Change("Physics Gravity Scale", Next)} />
        <Switch Label="Collides" Detail="Other bodies bump into it" On={Read("Physics Collides", true)} Assign={(Next) => Change("Physics Collides", Next)} />
        <Switch Label="Continuous collision" Detail="Stops fast bodies tunnelling through thin walls" On={Read("Physics CCD", false)} Disabled={Off} Assign={(Next) => Change("Physics CCD", Next)} />
        <Switch Label="Start asleep" Detail="Wakes on first contact" On={Read("Physics Asleep", false)} Disabled={Off} Assign={(Next) => Change("Physics Asleep", Next)} />
      </Card>

      <Card Title="Mass" Glyph="weight" Tone="#a9bfdc" Aside={Manual ? "Manual" : "From density"} className="pi-study-card">
        <BigFigure
          Whole={Mass >= 100 ? Fixed(Mass, 0) : Fixed(Mass, Mass < 1 ? 3 : 1)}
          Unit="kg"
          Caption={`${Comparison(Mass)} · ${Manual ? "set by hand" : `${Fixed(Size.Volume, 3)} m³ × ${DensityKg} kg/m³`}`}
        />
        <div className="pi-study">
          <MassRuler Mass={Mass} Name={Shapes[Shape].Name} />
        </div>
        <Segmented
          Current={Manual ? "manual" : "auto"}
          Choices={[["From density", "auto"], ["Manual", "manual"]]}
          Assign={(Next) => {
            if (Next === "manual") Change("Physics Mass Manual", +Mass.toFixed(3));
            Change("Physics Mass Mode", Next);
          }}
        />
        {Manual ? (
          <Slider Label="Mass" Reading={Mass} Minimum={0.01} Maximum={5000} Step={0.01} Unit="kg" Tone="#a9bfdc" Assign={(Next) => Change("Physics Mass Manual", Next)} />
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
      </Card>

      <Card Title="Surface response" Glyph="physics" Tone="#ffc93d" Aside={Off ? "Simulation off" : "Drag a dial"} className={"pi-dial-card" + (Off ? " is-muted" : "")}>
        <div className="pi-dial-grid">
          <Dial Label="Friction" Tone="#e6cf72" Reading={Read("Physics Friction", 0.6)} Assign={(Next) => Change("Physics Friction", Next)} />
          <Dial Label="Bounciness" Tone="#a9bfdc" Reading={Restitution} Assign={(Next) => Change("Physics Bounciness", Next)} />
          <Dial Label="Linear damping" Tone="#f2f2f2" Reading={Damping} Assign={(Next) => Change("Physics Linear Damping", Next)} />
          <Dial Label="Angular damping" Tone="#ea6b45" Reading={Read("Physics Angular Damping", 0.1)} Assign={(Next) => Change("Physics Angular Damping", Next)} />
        </div>
      </Card>
    </>
  );
}

// Shading study. The primitive's cross-section (segments around the axis, or the torus tube sides, or the bevelled
// cube square) is drawn twice: from above with its normals, and as a lit low-poly band. Flat gives one normal per
// face, Smooth averages normals at every vertex, Auto averages only where the corner is below the smoothing angle.
function CrossSection(Shape, Read) {
  if (Shape === "cube") {
    const Bevel = Math.min(0.24, +Read("Geometry Bevel", 0)), Steps = Bevel > 0 ? Math.round(+Read("Geometry Bevel Segments", 1)) : 0;
    const Points = [], Half = 0.5, Round = Bevel * 2;
    for (const [Cx, Cy, Start] of [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]]) {
      if (!Steps) { Points.push([Cx * Half, Cy * Half]); continue; }
      for (let Index = 0; Index <= Steps; Index++) {
        const A = ((Start + (90 * Index) / Steps) * Math.PI) / 180;
        Points.push([Cx * (Half - Round / 2) + (Round / 2) * Math.cos(A), Cy * (Half - Round / 2) + (Round / 2) * Math.sin(A)]);
      }
    }
    const Turn = Math.PI / 6;
    return Points.map(([X, Y]) => [X * Math.cos(Turn) - Y * Math.sin(Turn), X * Math.sin(Turn) + Y * Math.cos(Turn)]).map(([X, Y]) => [X * 1.3, Y * 1.3]);
  }
  const Count = Math.max(3, Math.min(64, Math.round(+Read(Shape === "torus" ? "Geometry Sides" : "Geometry Segments", Shape === "torus" ? 16 : Shape === "sphere" ? 32 : 32))));
  return Array.from({ length: Count }, (_, Index) => {
    const A = (Index / Count) * Math.PI * 2 + Math.PI / Count + Math.PI / 2;
    return [0.62 * Math.cos(A), 0.62 * Math.sin(A)];
  });
}

const Normalise = ([X, Y]) => { const L = Math.hypot(X, Y) || 1; return [X / L, Y / L]; };
const LightDirection = Normalise([-0.65, -0.75]);

function ShadeProfile(Points, Mode, Threshold, Flip) {
  const Count = Points.length;
  const Faces = Points.map((A, Index) => {
    const B = Points[(Index + 1) % Count];
    const N = Normalise([B[1] - A[1], -(B[0] - A[0])]);
    const Mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    const Outward = N[0] * Mid[0] + N[1] * Mid[1] >= 0 ? N : [-N[0], -N[1]];
    return { A, B, Normal: Flip ? [-Outward[0], -Outward[1]] : Outward };
  });
  // Vertex Index joins face Index − 1 and face Index.
  const Corners = Points.map((Point, Index) => {
    const Before = Faces[(Index - 1 + Count) % Count].Normal, After = Faces[Index].Normal;
    const Angle = (Math.acos(Math.max(-1, Math.min(1, Before[0] * After[0] + Before[1] * After[1]))) * 180) / Math.PI;
    const Hard = Mode === "flat" || (Mode === "auto" && Angle > Threshold);
    const Shared = Normalise([Before[0] + After[0], Before[1] + After[1]]);
    return { Point, Angle, Hard, Before, After, Shared };
  });
  const Ends = Faces.map((Face, Index) => {
    const Start = Corners[Index], Finish = Corners[(Index + 1) % Count];
    return [Start.Hard ? Face.Normal : Start.Shared, Finish.Hard ? Face.Normal : Finish.Shared];
  });
  return { Faces, Corners, Ends, HardCount: Corners.filter((Corner) => Corner.Hard).length };
}
const Lambert = ([X, Y]) => 0.1 + 0.9 * Math.max(0, X * LightDirection[0] + Y * LightDirection[1]);
const Grey = (Amount) => { const Level = Math.round(28 + Amount * 212); return `rgb(${Level},${Level},${Level})`; };

function ShadingStudy({ Points, Mode, Threshold, Flip }) {
  const { Faces, Corners, Ends } = ShadeProfile(Points, Mode, Threshold, Flip);
  const Ox = 72, Oy = 76, Scale = 62;
  const At = ([X, Y]) => [Ox + X * Scale, Oy - Y * Scale];
  // Lit band: viewer looks along −Y (from the bottom of the top view); the light comes from upper left.
  const Bx = 222, Top = 30, Bottom = 124, Depth = 20, Wide = 70;
  const Band = ([X, Y], Level) => [Bx + X * Wide, Level - Y * Depth * 0.5];
  const Front = Faces.map((Face, Index) => ({ Face, Index })).filter(({ Face }) => (Face.A[1] + Face.B[1]) / 2 < 0.02);
  return (
    <svg className="pi-study-svg" viewBox="0 0 300 150" role="img" aria-label="Shading study" data-study="shading">
      <defs>
        {Front.map(({ Index, Face }) => {
          const [Start, Finish] = Ends[Index];
          return (
            <linearGradient key={Index} id={"pi-shade-" + Index} gradientUnits="userSpaceOnUse" x1={Band(Face.A, 0)[0]} x2={Band(Face.B, 0)[0]} y1="0" y2="0">
              <stop offset="0" stopColor={Grey(Lambert(Start))} />
              <stop offset="1" stopColor={Grey(Lambert(Finish))} />
            </linearGradient>
          );
        })}
      </defs>
      <text x="8" y="12">TOP VIEW · NORMALS</text>
      <text x="292" y="12" textAnchor="end">LIT BAND</text>
      <polygon points={Points.map((Point) => At(Point).join(",")).join(" ")} fill="#151515" stroke="#6a6a6a" strokeWidth="1" />
      {Mode === "flat"
        ? Faces.map((Face, Index) => {
            const Mid = At([(Face.A[0] + Face.B[0]) / 2, (Face.A[1] + Face.B[1]) / 2]);
            return <line key={Index} x1={Mid[0]} y1={Mid[1]} x2={Mid[0] + Face.Normal[0] * 12} y2={Mid[1] - Face.Normal[1] * 12} stroke="#5fe0a0" strokeWidth="1.2" strokeLinecap="round" />;
          })
        : Corners.map((Corner, Index) => {
            const P = At(Corner.Point);
            const Arrows = Corner.Hard ? [Corner.Before, Corner.After] : [Corner.Shared];
            return (
              <g key={Index}>
                {Arrows.map((N, Each) => (
                  <line key={Each} x1={P[0]} y1={P[1]} x2={P[0] + N[0] * 12} y2={P[1] - N[1] * 12} stroke={Corner.Hard ? "#ffc93d" : "#5fe0a0"} strokeWidth="1.2" strokeLinecap="round" />
                ))}
                <circle cx={P[0]} cy={P[1]} r={Corner.Hard ? 2.2 : 1.4} fill={Corner.Hard ? "#ffc93d" : "#bdbdbd"} />
              </g>
            );
          })}
      <path d={`M${Ox - 66} ${Oy + 58}L${Ox - 50} ${Oy + 42}M${Ox - 50} ${Oy + 42}l-7 1M${Ox - 50} ${Oy + 42}l-1 7`} stroke="#e6cf72" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <text x={Ox - 66} y={Oy + 36} className="pi-study-accent">light</text>
      <polygon points={Points.map((Point) => Band(Point, Top).join(",")).join(" ")} fill="#5a5a5a" stroke="#2a2a2a" strokeWidth=".6" />
      {Front.map(({ Face, Index }) => {
        const Corner = [Band(Face.A, Top), Band(Face.B, Top), Band(Face.B, Bottom), Band(Face.A, Bottom)];
        return <polygon key={Index} points={Corner.map((Point) => Point.join(",")).join(" ")} fill={`url(#pi-shade-${Index})`} stroke={Mode === "smooth" ? "none" : "#00000030"} strokeWidth=".5" />;
      })}
      <text x={Bx} y="146" textAnchor="middle">{Mode === "flat" ? "faceted" : Mode === "smooth" ? "continuous" : "hard where corners exceed " + Math.round(Threshold) + "°"}</text>
      <text x={Ox} y="146" textAnchor="middle">{Points.length} faces in profile</text>
    </svg>
  );
}

function GeometryPage({ Shape, Read, Change, Values, Size }) {
  const Primitive = Shapes[Shape];
  const Locked = !!Values.LOCKED;
  const Shading = Read("Geometry Shading", "smooth");
  const Threshold = +Read("Geometry Smooth Angle", 40);
  const Flip = !!Read("Geometry Flip Normals", false);
  const Points = CrossSection(Shape, Read);
  const Result = ShadeProfile(Points, Shading, Threshold, Flip);
  const CornerAngle = Result.Corners.reduce((Largest, Corner) => Math.max(Largest, Corner.Angle), 0);
  const Groups = Shading === "smooth" ? 1 : Shading === "flat" ? Points.length : Math.max(1, Result.HardCount);
  return (
    <>
      <TransformPanel Values={Values} Change={Change} />
      <Card Title={Primitive.Name + " shape"} Glyph="geometry" Tone="#5fe0a0" Aside={Locked ? "Locked" : "Primitive"}>
        {Primitive.Parameters.map(([Label, Key, Initial, Minimum, Maximum, Step, Suffix]) => (
          <Slider
            key={Key}
            Label={Label}
            Reading={Read(Key, Initial)}
            Minimum={Minimum}
            Maximum={Maximum}
            Step={Step}
            Unit={Suffix}
            Digits={Step >= 1 ? 0 : Step >= 0.01 ? 2 : 3}
            Disabled={Locked}
            Tone="#5fe0a0"
            Assign={(Next) => Change(Key, Step >= 1 ? Math.round(Next) : Next)}
          />
        ))}
        {Primitive.Caps && (
          <Switch Label="Caps" Detail="Close the ends" On={Read("Geometry Caps", true) !== false} Disabled={Locked} Assign={(Next) => Change("Geometry Caps", Next)} />
        )}
        <div className="pi-stat-grid">
          <div><span>Triangles</span><b>{Size.Triangles.toLocaleString("en-US")}</b></div>
          <div><span>Vertices</span><b>{Size.Vertices.toLocaleString("en-US")}</b></div>
          <div><span>Closed</span><b>{Size.Closed ? "Yes" : "No"}</b></div>
        </div>
      </Card>

      <Card Title="Shading" Glyph="material" Tone="#ff7eb6" Aside={Shading === "auto" ? "Auto smooth" : Shading === "flat" ? "Flat" : "Smooth"} className="pi-study-card">
        <BigFigure
          Whole={Shading === "auto" ? Fixed(Threshold, 0) : Shading === "flat" ? String(Points.length) : "1"}
          Unit={Shading === "auto" ? "° smoothing angle" : Shading === "flat" ? "flat faces" : "smooth surface"}
          Caption={`Profile corners turn ${Fixed(CornerAngle, 1)}° · ${Result.HardCount} of ${Points.length} shown hard`}
        />
        <div className="pi-study">
          <ShadingStudy Points={Points} Mode={Shading} Threshold={Threshold} Flip={Flip} />
        </div>
        <Segmented Label="Shading" Current={Shading} Choices={[["Smooth", "smooth"], ["Auto", "auto"], ["Flat", "flat"]]} Disabled={Locked} Assign={(Next) => Change("Geometry Shading", Next)} />
        <Slider Label="Smoothing angle" Reading={Threshold} Minimum={0} Maximum={180} Step={1} Digits={0} Unit="°" Disabled={Locked || Shading !== "auto"} Tone="#ff7eb6" Assign={(Next) => Change("Geometry Smooth Angle", Next)} />
        <p className="pi-study-note">
          Green: shared normals (soft). Amber: split normals (hard edge). Raise the segments to make the same angle read smoother.
        </p>
      </Card>

      <Card Title="Normals" Glyph="geometry" Tone="#7cb7ff" Aside={Flip ? "Flipped" : "Outward"}>
        <div className="pi-stat-grid">
          <div><span>Smoothing groups</span><b>{Groups}</b></div>
          <div><span>Hard edges</span><b>{Result.HardCount}</b></div>
          <div><span>Largest corner</span><b>{Fixed(CornerAngle, 0)}<small>°</small></b></div>
        </div>
        <Switch Label="Weighted normals" Detail="Big faces pull shared normals towards them" On={Read("Geometry Weighted Normals", true)} Disabled={Locked} Assign={(Next) => Change("Geometry Weighted Normals", Next)} />
        <Switch Label="Double-sided" Detail="Render back faces too" On={Read("Geometry Double Sided", false)} Disabled={Locked} Assign={(Next) => Change("Geometry Double Sided", Next)} />
        <Switch Label="Flip normals" Detail={Flip ? "Inside-out: the lit side faces away from the light" : "Point normals inwards"} On={Flip} Disabled={Locked} Assign={(Next) => Change("Geometry Flip Normals", Next)} />
      </Card>
    </>
  );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    CAROUSEL
//------------------------------------------------------------------------------------------------------------------------

function Carousel({ Pages }) {
  const [Current, Choose] = useState("overview");
  const [Direction, Turn] = useState("none");
  const Rail = useRef(null);
  const Index = Math.max(0, Categories.findIndex(([Key]) => Key === Current));
  const Go = (Next) => {
    const Target = (Next + Categories.length) % Categories.length;
    Turn(Target >= Index ? "next" : "previous");
    Choose(Categories[Target][0]);
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
  const Shared = { Shape, Read, Change, Values, Hidden, ToggleHidden, Size };
  return (
    <div className="primitive-inspector">
      <Carousel
        key={Subject.Id}
        Pages={{
          overview: <OverviewPage {...Shared} />,
          physics: <PhysicsPage {...Shared} />,
          geometry: <GeometryPage {...Shared} />,
          material: MaterialCards,
          fracture: FractureCards,
        }}
      />
    </div>
  );
}
