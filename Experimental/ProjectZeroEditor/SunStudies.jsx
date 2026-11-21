// Follow-up 43: one preview per Sun card, each drawn differently, so no two cards are the same "number, line chart,
// slider" shape. Every preview edits the same authored fields as the controls under it. All of them are illustrative
// browser drawings; the solar geometry comes from the NOAA solver in Solar.mjs, nothing here runs the native renderer.
import React, { useRef } from "react";
import { Solar } from "./Solar.mjs";
import "./SkyStudies.css";

const Rad = Math.PI / 180;
export const Limit = (Amount, Low, High) => Math.max(Low, Math.min(High, Number(Amount) || 0));

// Pointer position in the SVG's own units.
export function SvgPoint(Event) {
  const Svg = Event.currentTarget.ownerSVGElement || Event.currentTarget;
  const Point = Svg.createSVGPoint();
  Point.x = Event.clientX;
  Point.y = Event.clientY;
  const Local = Point.matrixTransform(Svg.getScreenCTM().inverse());
  return [Local.x, Local.y];
}
// Press-and-drag handlers that report SVG coordinates.
export function DragProps(Apply) {
  return {
    onPointerDown: (Event) => {
      Event.currentTarget.setPointerCapture(Event.pointerId);
      Apply(...SvgPoint(Event));
    },
    onPointerMove: (Event) => {
      if (Event.buttons & 1) Apply(...SvgPoint(Event));
    },
  };
}
// Arrow / Page / Home / End keys for an SVG that acts as a slider.
export function SliderKeys(Now, Low, High, Step, Big, Apply) {
  return (Event) => {
    const Moves = { ArrowRight: Step, ArrowUp: Step, ArrowLeft: -Step, ArrowDown: -Step, PageUp: Big, PageDown: -Big };
    let Next;
    if (Event.key in Moves) Next = Now + Moves[Event.key];
    else if (Event.key === "Home") Next = Low;
    else if (Event.key === "End") Next = High;
    else return;
    Event.preventDefault();
    Apply(Limit(Next, Low, High));
  };
}
export function StudyFacts({ Items }) {
  return (
    <div className="study-facts">
      {Items.map(([Label, Text, Swatch]) => (
        <div key={Label} data-study-fact={Label}>
          <small>{Label}</small>
          <b>
            {Swatch && <i style={{ background: Swatch }} />}
            {Text}
          </b>
        </div>
      ))}
    </div>
  );
}
export const Clock = (Hours) => {
  const Minutes = Math.round((((Hours % 24) + 24) % 24) * 60) % 1440;
  return String(Math.floor(Minutes / 60)).padStart(2, "0") + ":" + String(Minutes % 60).padStart(2, "0");
};
// Blackbody colour as 0..1 RGB (Tanner Helland's fit, the same curve the Sun now card uses).
export function KelvinRgb(K) {
  const T = Limit(K, 1000, 40000) / 100;
  const Red = T <= 66 ? 255 : 329.7 * (T - 60) ** -0.1332;
  const Green = T <= 66 ? 99.47 * Math.log(T) - 161.12 : 288.12 * (T - 60) ** -0.0755;
  const Blue = T >= 66 ? 255 : T <= 19 ? 0 : 138.52 * Math.log(T - 10) - 305.04;
  return [Red, Green, Blue].map((C) => Limit(C, 0, 255) / 255);
}
export const HexRgb = (Text = "#ffffff") => {
  const Clean = String(Text).replace("#", "");
  return [0, 2, 4].map((At) => parseInt(Clean.slice(At, At + 2), 16) / 255 || 0);
};
export const Css = (Rgb, Scale = 1) =>
  "rgb(" + Rgb.map((C) => Math.round(255 * Limit(C * Scale, 0, 1))).join(",") + ")";
const Place = (V) => ({ Month: V("Month"), Day: V("Day of Month"), Latitude: V("Latitude"), Longitude: V("Longitude") });
const DayOfYear = (Month, Day) => Math.round((Date.UTC(2026, Month - 1, Day) - Date.UTC(2026, 0, 0)) / 86400000);
const FromDayOfYear = (Ordinal) => {
  const Calendar = new Date(Date.UTC(2026, 0, Math.round(Ordinal)));
  return [Calendar.getUTCMonth() + 1, Calendar.getUTCDate()];
};
const Phase = (Elevation) =>
  Elevation >= 6 ? "day" : Elevation >= -0.83 ? "golden" : Elevation >= -6 ? "civil" : Elevation >= -12 ? "nautical" : Elevation >= -18 ? "astronomical" : "night";
const PhaseColour = { day: "#e8d3a2", golden: "#d9984f", civil: "#56679a", nautical: "#323d66", astronomical: "#1f2540", night: "#121520" };
const SunColour = (V) => (V("Colour source") ? KelvinRgb(V("Temperature")) : HexRgb(V("Sun Tint")));

// Sun direction: the sky folded flat onto a ground plate (zenith in the middle, horizon on the rim) with a pole at the
// centre. The sun sits on its day path; the pole's shadow points away from it and its tip traces the sundial curve.
// A side view under the plate shows the elevation angle and the shadow length. Drag the sun or the shadow to set time.
export function ShadowPlate({ V, Change }) {
  const Where = Place(V), Hours = V("Local Hours");
  const Now = Solar({ ...Where, LocalHours: Hours });
  const Cx = 140, Cy = 118, R = 96, Pole = 26;
  const Sky = (Az, El) => {
    const Reach = (R * (90 - Math.max(El, 0))) / 90;
    return [Cx + Reach * Math.sin(Az * Rad), Cy - Reach * Math.cos(Az * Rad)];
  };
  const Tip = (Az, El) => {
    if (El <= 1) return null;
    const Length = Math.min(R * 1.6, Pole / Math.tan(El * Rad));
    return [Cx - Length * Math.sin(Az * Rad), Cy + Length * Math.cos(Az * Rad)];
  };
  const Samples = Array.from({ length: 241 }, (_, Step) => ({ Hours: Step / 10, ...Solar({ ...Where, LocalHours: Step / 10 }) }));
  const Up = Samples.filter((Sample) => Sample.Elevation > 0);
  const Line = (Points) => Points.map((Point, At) => (At ? "L" : "M") + Point[0].toFixed(1) + " " + Point[1].toFixed(1)).join("");
  const Path = Line(Up.map((Sample) => Sky(Sample.Azimuth, Sample.Elevation)));
  const Trace = Line(Samples.filter((Sample) => Sample.Elevation > 4).map((Sample) => Tip(Sample.Azimuth, Sample.Elevation)));
  const SunAt = Sky(Now.Azimuth, Now.Elevation), ShadowAt = Tip(Now.Azimuth, Now.Elevation);
  const Pick = (X, Y) => {
    let Best = null, Distance = 18;
    for (const Sample of Up) {
      for (const Point of [Sky(Sample.Azimuth, Sample.Elevation), Tip(Sample.Azimuth, Sample.Elevation)]) {
        if (!Point) continue;
        const Gap = Math.hypot(Point[0] - X, Point[1] - Y);
        if (Gap < Distance) (Distance = Gap), (Best = Sample.Hours);
      }
    }
    if (Best != null) Change("Local Hours", Best);
  };
  // Side view.
  const Ground = 296, Foot = 116, Height = 30;
  const Cast = Now.Elevation > 1 ? Math.min(150, Height / Math.tan(Now.Elevation * Rad)) : 150;
  const Beam = Math.min(70, 40 / Math.max(0.2, Math.sin(Math.max(0, Now.Elevation) * Rad)));
  const Ray = [Foot - Beam * Math.cos(Math.max(0, Now.Elevation) * Rad), Ground - Height - Beam * Math.sin(Math.max(0, Now.Elevation) * Rad)];
  const Shade = Now.Elevation > 0.5 ? 1 / Math.tan(Now.Elevation * Rad) : Infinity;
  const Glow = Css(SunColour(V));
  const Compass = ["N", "E", "S", "W"];
  return (
    <>
      <svg
        className="sky-study shadow-plate"
        viewBox="0 0 280 312"
        role="slider"
        tabIndex={0}
        aria-label="Sun shadow plate"
        aria-valuemin={0}
        aria-valuemax={24}
        aria-valuenow={Hours}
        aria-valuetext={Clock(Hours)}
        onKeyDown={SliderKeys(Hours, 0, 23.9, 0.25, 1, (Next) => Change("Local Hours", Math.round(Next * 100) / 100))}
        {...DragProps(Pick)}
      >
        <defs>
          <radialGradient id="plate-floor">
            <stop offset="0" stopColor="#2a2d31" />
            <stop offset="1" stopColor="#17191c" />
          </radialGradient>
          <clipPath id="plate-clip">
            <circle cx={Cx} cy={Cy} r={R} />
          </clipPath>
        </defs>
        <circle cx={Cx} cy={Cy} r={R} fill="url(#plate-floor)" stroke="#3b3f45" />
        {[30, 60].map((Ring) => (
          <circle key={Ring} cx={Cx} cy={Cy} r={(R * (90 - Ring)) / 90} fill="none" stroke="#ffffff" strokeOpacity=".07" strokeDasharray="2 4" />
        ))}
        {Array.from({ length: 24 }, (_, Step) => {
          const Angle = Step * 15 * Rad, Long = Step % 6 === 0;
          return (
            <line
              key={Step}
              x1={Cx + (R - (Long ? 9 : 4)) * Math.sin(Angle)}
              y1={Cy - (R - (Long ? 9 : 4)) * Math.cos(Angle)}
              x2={Cx + R * Math.sin(Angle)}
              y2={Cy - R * Math.cos(Angle)}
              stroke="#ffffff"
              strokeOpacity={Long ? 0.45 : 0.18}
            />
          );
        })}
        {Compass.map((Name, Step) => (
          <text key={Name} x={Cx + (R + 9) * Math.sin(Step * 90 * Rad)} y={Cy - (R + 9) * Math.cos(Step * 90 * Rad) + 3} textAnchor="middle" className={Name === "N" ? "study-strong" : ""}>
            {Name}
          </text>
        ))}
        <g clipPath="url(#plate-clip)">
          <path d={Trace} fill="none" stroke="#8fa3b4" strokeOpacity=".55" strokeWidth="1" strokeDasharray="1 3" strokeLinecap="round" />
          {ShadowAt && (
            <path
              d={(() => {
                const [Tx, Ty] = ShadowAt, Dx = Tx - Cx, Dy = Ty - Cy, Size = Math.hypot(Dx, Dy) || 1;
                const Nx = -Dy / Size, Ny = Dx / Size;
                return `M${Cx + Nx * 3.5} ${Cy + Ny * 3.5}L${Tx + Nx * 1.4} ${Ty + Ny * 1.4}L${Tx - Nx * 1.4} ${Ty - Ny * 1.4}L${Cx - Nx * 3.5} ${Cy - Ny * 3.5}Z`;
              })()}
              fill="#050608"
              fillOpacity=".85"
            />
          )}
          <path d={Path} fill="none" stroke={Glow} strokeOpacity=".7" strokeWidth="1.2" strokeDasharray="2 3" />
          {Up.filter((Sample) => Sample.Hours % 1 === 0).map((Sample) => {
            const [X, Y] = Sky(Sample.Azimuth, Sample.Elevation);
            return (
              <g key={Sample.Hours}>
                <circle cx={X} cy={Y} r="1.6" fill={Glow} fillOpacity=".8" />
                {Sample.Hours % 3 === 0 && (
                  <text x={X} y={Y - 5} textAnchor="middle" className="study-faint">
                    {String(Sample.Hours).padStart(2, "0")}h
                  </text>
                )}
              </g>
            );
          })}
        </g>
        <circle cx={Cx} cy={Cy} r="3.5" fill="#d7dde2" />
        {Now.Elevation > 0 && (
          <g data-plate-sun="">
            <circle cx={SunAt[0]} cy={SunAt[1]} r="11" fill={Glow} fillOpacity=".18" />
            <circle cx={SunAt[0]} cy={SunAt[1]} r="5.5" fill={Glow} />
            <circle cx={SunAt[0]} cy={SunAt[1]} r="2.6" fill="#fffdf6" />
          </g>
        )}
        {Now.Elevation <= 0 && (
          <text x={Cx} y={Cy + 22} textAnchor="middle">
            Sun below the horizon · no shadow
          </text>
        )}
        <text x="0" y="12" className="study-faint">TOP DOWN</text>
        <text x="280" y="12" textAnchor="end" className="study-faint">zenith centre · horizon rim</text>
        {/* Side view */}
        <line x1="0" x2="280" y1="236" y2="236" stroke="#ffffff" strokeOpacity=".06" />
        <text x="0" y="252" className="study-faint">SIDE VIEW</text>
        <line x1="14" x2="268" y1={Ground} y2={Ground} stroke="#ffffff" strokeOpacity=".3" />
        <rect x={Foot} y={Ground - 2} width={Cast} height="4" fill="#050608" rx="1" />
        <line x1={Foot} x2={Foot} y1={Ground} y2={Ground - Height} stroke="#d7dde2" strokeWidth="3" strokeLinecap="round" />
        {Now.Elevation > 0 && (
          <>
            <line x1={Ray[0]} y1={Ray[1]} x2={Foot + Cast} y2={Ground} stroke={Glow} strokeOpacity=".6" strokeDasharray="3 3" />
            <circle cx={Ray[0]} cy={Ray[1]} r="5" fill={Glow} />
            <path
              d={`M${Foot + Cast - 22} ${Ground} A22 22 0 0 1 ${Foot + Cast - 22 * Math.cos(Now.Elevation * Rad)} ${Ground - 22 * Math.sin(Now.Elevation * Rad)}`}
              fill="none"
              stroke="#ffffff"
              strokeOpacity=".5"
            />
            <text x={Foot + Cast + 6} y={Ground - 6} className="study-strong">
              {Now.Elevation.toFixed(1)}°
            </text>
          </>
        )}
        <text x={Foot + Math.min(Cast, 150) / 2} y={Ground + 12} textAnchor="middle" className="study-faint">
          shadow {Shade === Infinity ? "—" : Shade > 20 ? "20+" : Shade.toFixed(1)} × height
        </text>
      </svg>
      <StudyFacts
        Items={[
          ["Azimuth", Now.Azimuth.toFixed(1) + "°"],
          ["Elevation", Now.Elevation.toFixed(1) + "°"],
          ["Shadow", Shade === Infinity ? "none" : Shade > 20 ? "20+ ×" : Shade.toFixed(2) + " ×"],
        ]}
      />
      <p className="study-note">Drag the sun or the shadow tip to set the time · angles are solved from date and location</p>
    </>
  );
}

// Sunlight intensity: a white ball on the ground lit by the authored gain at a fixed camera exposure. Highlights that
// clip get zebra stripes. The gauge on the right is in photographic stops (each step doubles the light).
export function LitSphere({ V, Change }) {
  const Intensity = V("Intensity"), Direct = V("Direct"), Gain = Intensity * Direct;
  const Where = Place(V), Now = Solar({ ...Where, LocalHours: V("Local Hours") });
  const Colour = SunColour(V);
  const Exposure = (Gain / 55) * 1.6;
  const Tone = (Light) => 1 - Math.exp(-Light);
  const Shades = [1, 0.82, 0.52, 0.24, 0.07];
  const Ambient = [0.05, 0.065, 0.085];
  const Paint = (Shade) => Css(Colour.map((C, Channel) => Tone(Exposure * Shade * C) + Ambient[Channel] * (1 - Shade)));
  const Bx = 92, By = 100, Br = 46;
  const Side = Math.sin(Now.Azimuth * Rad) || 0.0001;
  const Lift = Math.max(0.15, Math.sin(Math.max(0, Now.Elevation) * Rad));
  const Hx = Bx - Side * Br * 0.5, Hy = By - Br * (0.15 + 0.35 * Lift);
  const ClipShade = 3 / Math.max(Exposure, 0.001);
  const Zebra = ClipShade < 1 ? (Math.acos(Math.pow(ClipShade, 1 / 1.4)) * 2) / Math.PI : 0;
  const Cast = Now.Elevation > 1 ? Math.min(90, (Br * 0.9) / Math.tan(Now.Elevation * Rad)) : 0;
  // Gauge.
  const Top = 22, Bottom = 172, Scale = Math.log2(61);
  const At = (Level) => Bottom - (Math.log2(1 + Level) / Scale) * (Bottom - Top);
  const Back = (Y) => Math.round((2 ** (((Bottom - Limit(Y, Top, Bottom)) / (Bottom - Top)) * Scale) - 1) * 2) / 2;
  const Set = (Next) => Change("Intensity", Limit(+Number(Next).toFixed(1), 0, 60));
  const Stops = Gain > 0 ? Math.log2(Gain / 55) : -Infinity;
  return (
    <>
      <div className="study-head">
        <span>
          Combined <b>{Gain.toFixed(Gain >= 100 ? 0 : 1)} ×</b>
        </span>
        <span>{Stops === -Infinity ? "no light" : (Stops >= 0 ? "+" : "") + Stops.toFixed(1) + " stops from default"}</span>
      </div>
      <svg className="sky-study lit-sphere" viewBox="0 0 280 190" aria-label="Sunlit ball at a fixed exposure">
        <defs>
          <radialGradient id="ball-light" gradientUnits="userSpaceOnUse" cx={Hx} cy={Hy} r={Br * 1.45}>
            {Shades.map((Shade, Step) => (
              <stop key={Step} offset={Step / (Shades.length - 1)} stopColor={Paint(Shade)} />
            ))}
          </radialGradient>
          <radialGradient id="ball-floor" cx="50%" cy="40%" r="60%">
            <stop offset="0" stopColor={Css(Colour, 0.06 + 0.12 * Tone(Exposure * 0.3))} />
            <stop offset="1" stopColor="#151618" />
          </radialGradient>
          <pattern id="ball-zebra" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="3" height="6" fill="#000000" fillOpacity=".55" />
          </pattern>
          <clipPath id="ball-clip">
            <circle cx={Bx} cy={By} r={Br} />
          </clipPath>
          <filter id="ball-soft">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <rect x="0" y="0" width="186" height="190" rx="12" fill="#101113" />
        <ellipse cx="93" cy="150" rx="88" ry="30" fill="url(#ball-floor)" />
        {Cast > 0 && (
          <ellipse cx={Bx + Side * Cast * 0.7} cy={By + Br - 2} rx={Br * 0.7 + Cast * 0.45} ry="8" fill="#000000" fillOpacity=".6" filter="url(#ball-soft)" />
        )}
        <circle cx={Bx} cy={By} r={Br} fill="url(#ball-light)" />
        {Zebra > 0 && <circle cx={Hx} cy={Hy} r={Zebra * Br * 1.45} fill="url(#ball-zebra)" clipPath="url(#ball-clip)" data-zebra="" />}
        <text x="10" y="16" className="study-faint">FIXED EXPOSURE</text>
        <text x="10" y="182" className="study-faint">{Zebra > 0 ? "stripes · highlight clipped" : "no clipping"}</text>
        {/* Gauge */}
        <g
          role="slider"
          tabIndex={0}
          aria-label="Sunlight gain graph"
          aria-valuemin={0}
          aria-valuemax={60}
          aria-valuenow={Intensity}
          onKeyDown={SliderKeys(Intensity, 0, 60, 0.5, 5, Set)}
          {...DragProps((_, Y) => Set(Back(Y)))}
          className="study-grab"
        >
          <rect x="196" y="8" width="84" height="178" fill="transparent" />
          <rect x="226" y={Top} width="8" height={Bottom - Top} rx="4" fill="#26282b" />
          <rect x="226" y={At(Intensity)} width="8" height={Bottom - At(Intensity)} rx="4" fill={Css(Colour, 0.85)} />
          {[0, 1, 3, 7, 15, 30, 60].map((Level) => (
            <g key={Level}>
              <line x1="238" x2="244" y1={At(Level)} y2={At(Level)} stroke="#ffffff" strokeOpacity=".3" />
              <text x="248" y={At(Level) + 3}>{Level}×</text>
            </g>
          ))}
          <circle cx="230" cy={At(Intensity)} r="7" fill="#f2f2f2" />
          <text x="222" y={At(Intensity) + 3} textAnchor="end" className="study-strong">
            {Number(Intensity).toFixed(1)}
          </text>
          <text x="230" y="14" textAnchor="middle" className="study-faint">INTENSITY</text>
        </g>
      </svg>
      <p className="study-note">Ball is lit by Intensity × Direct ({Number(Direct).toFixed(2)} ×). Relative authored gain, not measured lux.</p>
    </>
  );
}

// Temperature: a white cube under this light next to the same cube under 6500 K daylight, over a blackbody ribbon
// with everyday light sources marked. Dragging the ribbon switches the colour source to Temperature.
const Sources = [
  [1900, "candle", -1],
  [2700, "tungsten", 1],
  [3500, "sunrise", -1],
  [5500, "noon", 1],
  [6500, "overcast", -1],
  [9000, "shade", 1],
  [15000, "blue sky", -1],
];
function Cube({ X, Light, Label, Sub }) {
  const Face = (Shade) => Css(Light.map((C) => 0.08 + 0.9 * C * Shade));
  return (
    <g>
      <rect x={X} y="0" width="136" height="98" rx="10" fill={Css(Light, 0.13)} />
      <rect x={X} y="66" width="136" height="32" fill={Css(Light, 0.22)} />
      <ellipse cx={X + 80} cy="80" rx="38" ry="7" fill="#000000" fillOpacity=".35" />
      <path d={`M${X + 46} 38 L${X + 68} 28 L${X + 92} 38 L${X + 70} 48Z`} fill={Face(1)} />
      <path d={`M${X + 46} 38 L${X + 70} 48 L${X + 70} 78 L${X + 46} 68Z`} fill={Face(0.74)} />
      <path d={`M${X + 70} 48 L${X + 92} 38 L${X + 92} 68 L${X + 70} 78Z`} fill={Face(0.48)} />
      <text x={X + 8} y="14" className="study-faint">{Label}</text>
      <text x={X + 8} y="92" className="study-strong">{Sub}</text>
    </g>
  );
}
export function KelvinRibbon({ V, Change }) {
  const UseKelvin = !!V("Colour source"), K = V("Temperature");
  const Light = SunColour(V);
  const Left = 10, Span = 260, Y = 128;
  const Across = (Kelvin) => Left + (Math.log(Kelvin / 1000) / Math.log(40)) * Span;
  const Back = (X) => Math.round((1000 * 40 ** (Limit(X - Left, 0, Span) / Span)) / 50) * 50;
  const Set = (Next) => {
    if (!UseKelvin) Change("Colour source", 1);
    Change("Temperature", Limit(Math.round(Next), 1000, 40000));
  };
  return (
    <>
      <svg className="sky-study kelvin-ribbon" viewBox="0 0 280 172" aria-label="Sun colour comparison">
        <Cube X={0} Light={Light} Label="THIS LIGHT" Sub={UseKelvin ? K + " K" : "RGB tint"} />
        <Cube X={144} Light={KelvinRgb(6500)} Label="DAYLIGHT REFERENCE" Sub="6500 K" />
        <g
          role="slider"
          tabIndex={0}
          aria-label="Sun colour temperature"
          aria-valuemin={1000}
          aria-valuemax={40000}
          aria-valuenow={K}
          onKeyDown={SliderKeys(K, 1000, 40000, 100, 1000, Set)}
          {...DragProps((X) => Set(Back(X)))}
          className={"study-grab" + (UseKelvin ? "" : " study-dim")}
        >
          <rect x="0" y="104" width="280" height="68" fill="transparent" />
          {Array.from({ length: 52 }, (_, Step) => {
            const Kelvin = 1000 * 40 ** (Step / 52);
            return <rect key={Step} x={Across(Kelvin)} y={Y} width={Span / 52 + 0.6} height="12" fill={Css(KelvinRgb(Kelvin))} />;
          })}
          {Sources.map(([Kelvin, Name, Row]) => (
            <g key={Name}>
              <line x1={Across(Kelvin)} x2={Across(Kelvin)} y1={Row < 0 ? Y - 4 : Y + 12} y2={Row < 0 ? Y : Y + 16} stroke="#ffffff" strokeOpacity=".4" />
              <text x={Across(Kelvin)} y={Row < 0 ? Y - 7 : Y + 25} textAnchor="middle" className="study-faint">
                {Name}
              </text>
            </g>
          ))}
          {[1000, 2000, 5000, 10000, 40000].map((Kelvin) => (
            <text key={Kelvin} x={Across(Kelvin)} y={Y + 40} textAnchor={Kelvin === 1000 ? "start" : Kelvin === 40000 ? "end" : "middle"}>
              {Kelvin / 1000}k
            </text>
          ))}
          {UseKelvin && (
            <g data-kelvin-thumb="">
              <rect x={Across(K) - 4} y={Y - 3} width="8" height="18" rx="3" fill="none" stroke="#ffffff" strokeWidth="2" />
            </g>
          )}
        </g>
      </svg>
      <p className="study-note">{UseKelvin ? "Drag the ribbon to pick a blackbody temperature." : "Using the RGB tint. Drag the ribbon to switch to a blackbody temperature."}</p>
    </>
  );
}

// Daylight cycle: a 24-hour dial, midnight at the bottom and noon at the top. The ring is coloured by what the sky is
// doing at each hour (day, golden hour, the three twilights, night); the curve inside is the sun's height.
export function DayDial({ V, Change }) {
  const Where = Place(V), Hours = V("Local Hours");
  const Cx = 140, Cy = 118, R = 88;
  const Point = (Hour, Reach) => [Cx - Reach * Math.sin((Hour / 24) * 2 * Math.PI), Cy + Reach * Math.cos((Hour / 24) * 2 * Math.PI)];
  const Samples = Array.from({ length: 241 }, (_, Step) => ({ Hours: Step / 10, ...Solar({ ...Where, LocalHours: Step / 10 }) }));
  const Runs = [];
  Samples.forEach((Sample) => {
    const Name = Phase(Sample.Elevation);
    if (Runs.length && Runs.at(-1).Name === Name) Runs.at(-1).End = Sample.Hours;
    else Runs.push({ Name, Start: Math.max(0, Sample.Hours - 0.05), End: Sample.Hours });
  });
  const Arc = (Start, End, Reach) => {
    const [Ax, Ay] = Point(Start, Reach), [Bx, By] = Point(End, Reach);
    return `M${Ax.toFixed(2)} ${Ay.toFixed(2)}A${Reach} ${Reach} 0 ${End - Start > 12 ? 1 : 0} 1 ${Bx.toFixed(2)} ${By.toFixed(2)}`;
  };
  const Height = (Elevation) => 42 + (Elevation / 90) * 30;
  const Curve = Samples.map((Sample, At) => {
    const [X, Y] = Point(Sample.Hours, Height(Sample.Elevation));
    return (At ? "L" : "M") + X.toFixed(1) + " " + Y.toFixed(1);
  }).join("") + "Z";
  const Crossing = (Rising) => {
    for (let Step = 1; Step < Samples.length; Step++) {
      const A = Samples[Step - 1].Elevation + 0.83, B = Samples[Step].Elevation + 0.83;
      if (Rising ? A < 0 && B >= 0 : A >= 0 && B < 0) return Samples[Step - 1].Hours + (A / (A - B)) * 0.1;
    }
    return null;
  };
  const Rise = Crossing(true), Sunset = Crossing(false);
  const Length = Rise != null && Sunset != null ? (Sunset - Rise + 24) % 24 : Samples[120].Elevation > 0 ? 24 : 0;
  const Now = Solar({ ...Where, LocalHours: Hours });
  const [Hx, Hy] = Point(Hours, R);
  const Pick = (X, Y) => {
    const Angle = Math.atan2(-(X - Cx), Y - Cy);
    Change("Local Hours", Math.round(((((Angle / (2 * Math.PI)) * 24) % 24) + 24) % 24 * 20) / 20);
  };
  return (
    <>
      <svg
        className="sky-study day-dial"
        viewBox="0 0 280 236"
        role="slider"
        tabIndex={0}
        aria-label="Sun daylight graph"
        aria-valuemin={0}
        aria-valuemax={24}
        aria-valuenow={Hours}
        aria-valuetext={Clock(Hours)}
        onKeyDown={SliderKeys(Hours, 0, 23.95, 0.25, 1, (Next) => Change("Local Hours", Math.round(Next * 100) / 100))}
        {...DragProps(Pick)}
      >
        {Runs.map((Run, At) => (
          <path key={At} d={Arc(Run.Start, Math.min(24, Run.End + 0.05), R)} fill="none" stroke={PhaseColour[Run.Name]} strokeWidth="16" data-phase={Run.Name} />
        ))}
        <circle cx={Cx} cy={Cy} r={Height(0)} fill="none" stroke="#ffffff" strokeOpacity=".16" strokeDasharray="2 3" />
        <path d={Curve} fill="#e8d3a2" fillOpacity=".06" stroke="#e8d3a2" strokeOpacity=".75" strokeWidth="1.2" data-series="" />
        {[0, 6, 12, 18].map((Hour) => {
          const [X, Y] = Point(Hour, R + 17);
          return (
            <text key={Hour} x={X} y={Y + 3} textAnchor="middle">
              {String(Hour).padStart(2, "0")}
            </text>
          );
        })}
        {Array.from({ length: 24 }, (_, Hour) => {
          const [Ax, Ay] = Point(Hour, R - 8), [Bx, By] = Point(Hour, R - 4);
          return <line key={Hour} x1={Ax} y1={Ay} x2={Bx} y2={By} stroke="#000000" strokeOpacity=".45" />;
        })}
        {[Rise, Sunset].map(
          (Hour, At) =>
            Hour != null && (
              <g key={At}>
                <line x1={Point(Hour, R - 8)[0]} y1={Point(Hour, R - 8)[1]} x2={Point(Hour, R + 10)[0]} y2={Point(Hour, R + 10)[1]} stroke="#ffffff" strokeOpacity=".7" />
              </g>
            ),
        )}
        <line x1={Cx} y1={Cy} x2={Hx} y2={Hy} stroke="#ffffff" strokeOpacity=".5" />
        <circle cx={Hx} cy={Hy} r="9" fill="#101113" stroke="#ffffff" strokeWidth="2" />
        <circle cx={Hx} cy={Hy} r="4" fill={Now.Elevation > 0 ? "#fff3d6" : "#7f8db8"} />
        <text x={Cx} y={Cy - 2} textAnchor="middle" className="study-clock">
          {Clock(Hours)}
        </text>
        <text x={Cx} y={Cy + 13} textAnchor="middle">
          {Phase(Now.Elevation) === "astronomical" ? "astro twilight" : Phase(Now.Elevation)} · {Now.Elevation.toFixed(0)}°
        </text>
      </svg>
      <StudyFacts
        Items={[
          ["Sunrise", Rise != null ? Clock(Rise) : "—"],
          ["Sunset", Sunset != null ? Clock(Sunset) : "—"],
          ["Daylight", Math.floor(Length) + "h " + String(Math.round((Length % 1) * 60)).padStart(2, "0")],
        ]}
      />
      <div className="study-legend">
        {["day", "golden", "civil", "nautical", "astronomical", "night"].map((Name) => (
          <span key={Name}>
            <i style={{ background: PhaseColour[Name] }} />
            {Name === "astronomical" ? "astro" : Name}
          </span>
        ))}
      </div>
    </>
  );
}

// Sun disc: the disc magnified against the Moon's size (dashed), with limb darkening, and what the disc size does to
// shadows: a bigger disc blurs every shadow edge. Drag the disc rim to resize it.
export function SolarDisc({ V, Change }) {
  const Diameter = V("Angular Diameter");
  const Hold = useRef(null);
  const Scale = Hold.current ?? Math.min(110, 120 / Diameter);
  const Radius = (Diameter * Scale) / 2;
  const Cx = 72, Cy = 68;
  const Light = SunColour(V);
  const Blur = 1000 * Math.tan(Diameter * Rad);
  const Band = Limit(Blur * 2.2, 2, 104);
  const Set = (Next) => Change("Angular Diameter", Limit(+Number(Next).toFixed(2), 0.1, 5));
  return (
    <>
      <svg className="sky-study solar-disc-study" viewBox="0 0 280 160" aria-label="Sun disc size and shadow softness">
        <defs>
          <radialGradient id="disc-limb">
            <stop offset="0" stopColor="#fffdf6" />
            <stop offset=".62" stopColor={Css(Light.map((C) => 0.55 + 0.45 * C))} />
            <stop offset=".92" stopColor={Css(Light.map((C, Channel) => C * [0.95, 0.68, 0.38][Channel]))} />
            <stop offset="1" stopColor={Css(Light.map((C, Channel) => C * [0.8, 0.45, 0.2][Channel]))} />
          </radialGradient>
          <radialGradient id="disc-glow">
            <stop offset="0" stopColor={Css(Light)} stopOpacity=".35" />
            <stop offset="1" stopColor={Css(Light)} stopOpacity="0" />
          </radialGradient>
          <linearGradient id="disc-edge" x1="0" x2="1">
            <stop offset="0" stopColor="#060708" />
            <stop offset="1" stopColor={Css(Light, 0.55)} />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="144" height="144" rx="10" fill="#0f1828" />
        <circle cx={Cx} cy={Cy} r={Radius * 2.6} fill="url(#disc-glow)" />
        <g
          role="slider"
          tabIndex={0}
          aria-label="Sun disc size"
          aria-valuemin={0.1}
          aria-valuemax={5}
          aria-valuenow={Diameter}
          onKeyDown={SliderKeys(Diameter, 0.1, 5, 0.01, 0.25, Set)}
          onPointerDown={(Event) => {
            Hold.current = Scale;
            Event.currentTarget.setPointerCapture(Event.pointerId);
          }}
          onPointerMove={(Event) => {
            if (!(Event.buttons & 1)) return;
            const [X, Y] = SvgPoint(Event);
            Set((2 * Math.hypot(X - Cx, Y - Cy)) / Hold.current);
          }}
          onPointerUp={() => (Hold.current = null)}
          className="study-grab"
        >
          <rect x="0" y="0" width="144" height="144" fill="transparent" />
          <circle cx={Cx} cy={Cy} r={Radius} fill="url(#disc-limb)" />
        </g>
        <circle cx={Cx} cy={Cy} r={(0.52 * Scale) / 2} fill="none" stroke="#d6dde6" strokeOpacity=".7" strokeDasharray="2 2.5" pointerEvents="none" />
        <line x1="10" x2={10 + 0.5 * Scale} y1="134" y2="134" stroke="#ffffff" strokeOpacity=".6" />
        <text x="10" y="129" className="study-faint">0.5°</text>
        <text x="136" y="14" textAnchor="end" className="study-faint">--- Moon 0.52°</text>
        <text x="8" y="14" className="study-faint">MAGNIFIED</text>
        {/* Shadow edge */}
        <text x="156" y="14" className="study-faint">SHADOW EDGE</text>
        <rect x="156" y="24" width="124" height="84" rx="8" fill={Css(Light, 0.55)} />
        <rect x="156" y="24" width={Limit(62 - Band / 2, 0, 124)} height="84" rx="8" fill="#060708" />
        <rect x={156 + Limit(62 - Band / 2, 0, 124)} y="24" width={Band} height="84" fill="url(#disc-edge)" data-penumbra="" />
        <text x="162" y="122" className="study-strong">{Blur >= 100 ? (Blur / 100).toFixed(2) + " m" : Blur.toFixed(1) + " cm"}</text>
        <text x="162" y="136">soft edge, 10 m from the caster</text>
      </svg>
      <p className="study-note">Drag the disc rim to resize · real sun 0.53°. Bigger discs give softer shadows.</p>
    </>
  );
}

// Dynamic settings: the analemma, where the sun stands at the authored clock time on every day of the year, plus the
// length of daylight through the year. Drag along the figure (or use the keys) to set the date.
export function Analemma({ V, Change }) {
  const Where = Place(V), Hours = V("Local Hours");
  const Today = DayOfYear(V("Month"), V("Day of Month"));
  const Year = Array.from({ length: 365 }, (_, Step) => {
    const [Month, Day] = FromDayOfYear(Step + 1);
    const Sample = Solar({ ...Where, Month, Day, LocalHours: Hours });
    const Hour = Math.acos(Limit(-Math.tan(Where.Latitude * Rad) * Math.tan(Sample.Declination * Rad), -1, 1)) / Rad;
    return { Ordinal: Step + 1, Month, Day, ...Sample, Light: (2 * Hour) / 15 };
  });
  const Mean = Math.atan2(
    Year.reduce((Sum, Sample) => Sum + Math.sin(Sample.Azimuth * Rad), 0),
    Year.reduce((Sum, Sample) => Sum + Math.cos(Sample.Azimuth * Rad), 0),
  ) / Rad;
  const Offset = (Az) => ((((Az - Mean + 180) % 360) + 360) % 360) - 180;
  const Xs = Year.map((Sample) => Offset(Sample.Azimuth)), Ys = Year.map((Sample) => Sample.Elevation);
  const [X0, X1, Y0, Y1] = [Math.min(...Xs), Math.max(...Xs), Math.min(...Ys), Math.max(...Ys)];
  const Fit = Math.min(12, 250 / Math.max(1, X1 - X0), 110 / Math.max(1, Y1 - Y0));
  const Px = (Sample) => 150 + (Offset(Sample.Azimuth) - (X0 + X1) / 2) * Fit;
  const Py = (Sample) => 84 - (Sample.Elevation - (Y0 + Y1) / 2) * Fit;
  const Figure = Year.map((Sample, At) => (At ? "L" : "M") + Px(Sample).toFixed(1) + " " + Py(Sample).toFixed(1)).join("") + "Z";
  const Gx = Year.reduce((Sum, Sample) => Sum + Px(Sample), 0) / 365, Gy = Year.reduce((Sum, Sample) => Sum + Py(Sample), 0) / 365;
  const Horizon = 84 + ((Y0 + Y1) / 2) * Fit;
  const Current = Year[Limit(Today - 1, 0, 364)];
  const SetDay = (Ordinal) => {
    const [Month, Day] = FromDayOfYear(Limit(Math.round(Ordinal), 1, 365));
    Change("Month", Month);
    Change("Day of Month", Day);
  };
  const Pick = (X, Y) => {
    if (Y > 150) return SetDay(((X - 16) / 270) * 365 + 1);
    let Best = Today, Distance = Infinity;
    for (const Sample of Year) {
      const Gap = Math.hypot(Px(Sample) - X, Py(Sample) - Y);
      if (Gap < Distance) (Distance = Gap), (Best = Sample.Ordinal);
    }
    SetDay(Best);
  };
  const Lights = Year.map((Sample) => Sample.Light), Shortest = Math.min(...Lights), Longest = Math.max(...Lights);
  const Lx = (Ordinal) => 16 + ((Ordinal - 1) / 364) * 270, Ly = (Light) => 198 - ((Light - Shortest + 0.4) / (Longest - Shortest + 0.8)) * 32;
  const Band = "M16 200" + Year.map((Sample) => "L" + Lx(Sample.Ordinal).toFixed(1) + " " + Ly(Sample.Light).toFixed(1)).join("") + "L286 200Z";
  const Letters = "JFMAMJJASOND";
  const Span = (Light) => Math.floor(Light) + "h" + String(Math.round((Light % 1) * 60)).padStart(2, "0");
  return (
    <>
      <svg
        className="sky-study analemma"
        viewBox="0 0 300 222"
        role="slider"
        tabIndex={0}
        aria-label="Sun seasonal graph"
        aria-valuemin={1}
        aria-valuemax={365}
        aria-valuenow={Today}
        aria-valuetext={V("Day of Month") + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][V("Month") - 1]}
        onKeyDown={SliderKeys(Today, 1, 365, 1, 30, SetDay)}
        {...DragProps(Pick)}
      >
        <rect x="0" y="0" width="300" height="150" rx="10" fill="#121418" />
        {Horizon > 0 && Horizon < 150 && (
          <>
            <rect x="0" y={Horizon} width="300" height={150 - Horizon} fill="#08090b" />
            <line x1="0" x2="300" y1={Horizon} y2={Horizon} stroke="#ffffff" strokeOpacity=".25" />
            <text x="294" y={Horizon - 4} textAnchor="end" className="study-faint">horizon</text>
          </>
        )}
        <path d={Figure} fill="none" stroke="#e8d3a2" strokeOpacity=".75" strokeWidth="1.3" />
        {Year.filter((Sample) => Sample.Day === 1).map((Sample) => {
          const Dx = Px(Sample) - Gx, Dy = Py(Sample) - Gy, Size = Math.hypot(Dx, Dy) || 1;
          return (
            <g key={Sample.Month}>
              <circle cx={Px(Sample)} cy={Py(Sample)} r="2" fill="#e8d3a2" />
              <text x={Px(Sample) + (Dx / Size) * 10} y={Py(Sample) + (Dy / Size) * 10 + 3} textAnchor="middle" className="study-faint">
                {Letters[Sample.Month - 1]}
              </text>
            </g>
          );
        })}
        <circle cx={Px(Current)} cy={Py(Current)} r="11" fill="#fff3d6" fillOpacity=".15" />
        <circle cx={Px(Current)} cy={Py(Current)} r="5" fill="#fff3d6" data-analemma-day="" />
        <text x="10" y="16" className="study-faint">THE SUN AT {Clock(Hours)} EVERY DAY OF 2026</text>
        <text x="10" y="142" className="study-faint">az {Current.Azimuth.toFixed(0)}° · el {Current.Elevation.toFixed(0)}°</text>
        <text x="290" y="142" textAnchor="end" className="study-faint">
          declination {Current.Declination.toFixed(1)}°
        </text>
        {/* Daylight through the year */}
        <text x="16" y="158" className="study-faint">DAYLIGHT THROUGH THE YEAR</text>
        <path d={Band} fill="#e8d3a2" fillOpacity=".22" stroke="#e8d3a2" strokeOpacity=".5" />
        <line x1={Lx(Today)} x2={Lx(Today)} y1="160" y2="200" stroke="#ffffff" strokeOpacity=".8" />
        <text x={Lx(Today) + (Today > 300 ? -4 : 4)} y="170" textAnchor={Today > 300 ? "end" : "start"} className="study-strong">
          {Span(Current.Light)}
        </text>
        {Letters.split("").map((Letter, Month) => (
          <text key={Month} x={Lx(DayOfYear(Month + 1, 15))} y="212" textAnchor="middle" className="study-faint">
            {Letter}
          </text>
        ))}
        <text x="300" y="222" textAnchor="end" className="study-faint">
          shortest {Span(Shortest)} · longest {Span(Longest)}
        </text>
      </svg>
      <p className="study-note">Drag along the figure-eight or the daylight strip to set the date. NOAA geometric model.</p>
    </>
  );
}
