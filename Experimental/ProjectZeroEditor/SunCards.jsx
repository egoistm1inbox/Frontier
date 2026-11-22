//============================================================================================================================================
//                                                               SUNCARDS.JSX
//============================================================================================================================================
// 🧩 The Sun panel's first card, in three designs to choose from (stored as "Sun card design" on the sun):
//   A · Solar dial      a 24 hour watch face: night, twilight and day on the band; the sun's height drawn as a radial curve around a
//                       compass (the horizon is the dashed ring); sunrise and sunset marks on the bezel; a shadow hand in the compass.
//   B · Horizon         a 360° strip round the horizon: the sun's path for the day over a skyline, the light's colour along the
//                       day underneath, and a figure casting its shadow.
//   C · Sunlight sheet  an infographic: the sunbeam crossing the air down to the ground, with the numbers that matter for lighting
//                       (illuminance, air mass, UV, shadow length) and the light's colour on a blackbody bar.
// All three use Solar.mjs, so they agree with the Sun direction card. Each one scrubs Local Hours by dragging. The illuminance and UV
// figures are clear-sky estimates.

import React from "react";
import { Solar } from "./Solar.mjs";

export const SunDesigns = [
  ["dial", "A", "Solar dial"],
  ["horizon", "B", "Horizon"],
  ["sheet", "C", "Sunlight sheet"],
];

const Rad = Math.PI / 180;
const Compass = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const Bearing = (Azimuth) => Compass[Math.round((((Azimuth % 360) + 360) % 360) / 22.5) % 16];
const Wrap24 = (Hours) => ((Hours % 24) + 24) % 24;
export const Clock = (Hours) => {
  const Minutes = Math.round(Wrap24(Hours) * 60) % 1440;
  return String(Math.floor(Minutes / 60)).padStart(2, "0") + ":" + String(Minutes % 60).padStart(2, "0");
};
const Span = (Hours) => Math.floor(Hours) + "h " + String(Math.round((Hours % 1) * 60)).padStart(2, "0");

export function DaylightName(Elevation) {
  if (Elevation >= 50) return "High sun";
  if (Elevation >= 25) return "Full day";
  if (Elevation >= 6) return "Low sun";
  if (Elevation >= -0.83) return "Golden hour";
  if (Elevation >= -6) return "Civil twilight";
  if (Elevation >= -12) return "Nautical twilight";
  if (Elevation >= -18) return "Astronomical twilight";
  return "Night";
}

// Blackbody colour as [r, g, b] 0–255 (Tanner Helland's fit).
export function KelvinRgb(K) {
  const T = Math.max(1000, Math.min(40000, K)) / 100;
  const Red = T <= 66 ? 255 : 329.7 * (T - 60) ** -0.1332;
  const Green = T <= 66 ? 99.47 * Math.log(T) - 161.12 : 288.12 * (T - 60) ** -0.0755;
  const Blue = T >= 66 ? 255 : T <= 19 ? 0 : 138.52 * Math.log(T - 10) - 305.04;
  return [Red, Green, Blue].map((C) => Math.max(0, Math.min(255, Math.round(C))));
}
const Rgb = (Channels, Alpha = 1) => (Alpha < 1 ? `rgba(${Channels.join(",")},${Alpha})` : `rgb(${Channels.join(",")})`);
const Mix = (A, B, T) => A.map((C, Index) => Math.round(C + (B[Index] - C) * Math.max(0, Math.min(1, T))));

// Kasten-Young relative air mass.
const AirMass = (Elevation) => {
  const Zenith = Math.min(90.5, 90 - Elevation);
  return 1 / (Math.cos(Zenith * Rad) + 0.50572 * Math.pow(96.07995 - Zenith, -1.6364));
};
const UvBand = (Index) => (Index < 3 ? "low" : Index < 6 ? "moderate" : Index < 8 ? "high" : Index < 11 ? "very high" : "extreme");

// Everything the three designs read, solved once per render.
export function SunDay(V) {
  const Place = { Month: V("Month"), Day: V("Day of Month"), Latitude: V("Latitude"), Longitude: V("Longitude") };
  const Hours = V("Local Hours");
  const { Elevation, Azimuth } = Solar({ ...Place, LocalHours: Hours });
  // Every six minutes; sunrise and sunset use the upper limb, 0.83° below the geometric horizon.
  const Samples = Array.from({ length: 241 }, (_, Step) => ({ Hours: Step / 10, ...Solar({ ...Place, LocalHours: Step / 10 }) }));
  const Crossing = (Rising, Height = -0.83) => {
    for (let Step = 1; Step < Samples.length; Step++) {
      const [A, B] = [Samples[Step - 1].Elevation - Height, Samples[Step].Elevation - Height];
      if (Rising ? A < 0 && B >= 0 : A >= 0 && B < 0) return Samples[Step - 1].Hours + (A / (A - B)) * 0.1;
    }
    return null;
  };
  const Rise = Crossing(true), Sunset = Crossing(false);
  const Length = Rise != null && Sunset != null ? (Sunset - Rise + 24) % 24 : Samples[120].Elevation > 0 ? 24 : 0;
  const Peak = Samples.reduce((Best, Sample) => (Sample.Elevation > Best.Elevation ? Sample : Best), Samples[0]);
  const Rated = V("Temperature") ?? 6500;
  const ApparentAt = (El) => Rated + (1800 - Rated) * Math.max(0, Math.min(1, (12 - El) / 18)) ** 0.7;
  const Apparent = ApparentAt(Elevation);
  const Sine = Math.sin(Math.max(0, Elevation) * Rad);
  const Lux = Elevation > 0 ? 128 * Sine * Math.exp(-0.21 / Math.max(0.05, Sine)) + 18 * Math.sqrt(Sine) : 0;
  const Shadow = Elevation > 0.5 ? 1 / Math.tan(Elevation * Rad) : Infinity;
  const Uv = Elevation > 0 ? 12.5 * Sine ** 2.42 : 0;
  return {
    Place, Hours, Elevation, Azimuth, Samples, Rise, Sunset, Length, Peak, Rated, ApparentAt, Apparent,
    Glow: KelvinRgb(Apparent), Lux, Shadow, Uv, Mass: Elevation > -0.5 ? AirMass(Elevation) : null,
  };
}

// Light at an elevation as a colour: blackbody by day, deep blues through twilight, near black at night.
function LightAt(Day, El) {
  if (El > -0.83) return Mix([120, 70, 50], KelvinRgb(Day.ApparentAt(El)), Math.min(1, (El + 0.83) / 8 + 0.35));
  if (El > -6) return Mix([38, 40, 92], [120, 70, 50], (El + 6) / 5.2);
  if (El > -12) return Mix([20, 22, 52], [38, 40, 92], (El + 12) / 6);
  if (El > -18) return Mix([10, 11, 22], [20, 22, 52], (El + 18) / 6);
  return [10, 11, 22];
}
const PhaseOf = (El) => (El > 6 ? "day" : El > -0.83 ? "golden" : El > -6 ? "civil" : El > -12 ? "nautical" : El > -18 ? "astronomical" : "night");
const PhaseTone = { day: "#ffd98a", golden: "#ff9452", civil: "#7065c4", nautical: "#3a4290", astronomical: "#1f2550", night: "#0d1024" };

// SVG pointer → viewBox coordinates.
const SvgPoint = (Event) => {
  const Svg = Event.currentTarget.ownerSVGElement || Event.currentTarget;
  const Point = Svg.createSVGPoint();
  Point.x = Event.clientX;
  Point.y = Event.clientY;
  return Point.matrixTransform(Svg.getScreenCTM().inverse());
};
const Dragging = (Apply) => ({
  onPointerDown: (Event) => {
    Event.currentTarget.setPointerCapture(Event.pointerId);
    Apply(Event);
  },
  onPointerMove: (Event) => Event.buttons & 1 && Apply(Event),
});
const HourKeys = (Hours, Change) => (Event) => {
  const Moves = { ArrowRight: 0.25, ArrowLeft: -0.25, ArrowUp: 1, ArrowDown: -1 };
  if (!(Event.key in Moves)) return;
  Event.preventDefault();
  Change("Local Hours", Math.round(Wrap24(Hours + Moves[Event.key]) * 100) / 100);
};
const SetHours = (Change, Hours, Step = 0.05) => Change("Local Hours", Math.round(Math.max(0, Math.min(23.99, Wrap24(Hours))) / Step) * Step);

// ------------------------------------------------------------------------------------------------------------------------- A · dial
const DialC = 130;
const AtHour = (Radius, Hours) => {
  const A = ((Hours - 12) / 24) * 2 * Math.PI;
  return [DialC + Radius * Math.sin(A), DialC - Radius * Math.cos(A)];
};
const Arc = (Radius, From, To) => {
  const [X0, Y0] = AtHour(Radius, From), [X1, Y1] = AtHour(Radius, To);
  return `M${X0.toFixed(2)} ${Y0.toFixed(2)}A${Radius} ${Radius} 0 ${To - From > 12 ? 1 : 0} 1 ${X1.toFixed(2)} ${Y1.toFixed(2)}`;
};
const Horizon = 66, PerDegree = 0.27;
const CurveR = (El) => Horizon + Math.max(-90, Math.min(90, El)) * PerDegree;

function SolarDial({ Day, Change }) {
  const Runs = [];
  Day.Samples.slice(0, 240).forEach((Sample, Step) => {
    const Phase = PhaseOf(Sample.Elevation);
    if (Runs.length && Runs.at(-1).Phase === Phase) Runs.at(-1).End = (Step + 1) / 10;
    else Runs.push({ Phase, Start: Step / 10, End: (Step + 1) / 10 });
  });
  const Curve = Day.Samples.map((Sample) => AtHour(CurveR(Sample.Elevation), Sample.Hours));
  const CurvePath = Curve.map(([X, Y], Index) => (Index ? "L" : "M") + X.toFixed(1) + " " + Y.toFixed(1)).join("") + "Z";
  // The curve's stroke in runs: gold while the sun is up, dim blue below the horizon.
  const Strokes = [];
  Day.Samples.forEach((Sample, Index) => {
    const Above = Sample.Elevation >= 0;
    if (!Strokes.length || Strokes.at(-1).Above !== Above) Strokes.push({ Above, Points: Index ? [Curve[Index - 1]] : [] });
    Strokes.at(-1).Points.push(Curve[Index]);
  });
  const Sun = AtHour(CurveR(Day.Elevation), Day.Hours);
  const Up = Day.Elevation > -0.83;
  // Shadow hand: from the gnomon away from the sun's bearing, on a compass seen from above (north up, east right).
  const Reach = Day.Shadow === Infinity ? 0 : Math.min(27, 8 * Day.Shadow);
  const Away = (Day.Azimuth + 180) * Rad;
  const Pick = (Event) => {
    const P = SvgPoint(Event);
    const Angle = Math.atan2(P.x - DialC, -(P.y - DialC));
    SetHours(Change, 12 + (Angle / (2 * Math.PI)) * 24);
  };
  const Mark = (Hours, Label) => {
    if (Hours == null) return null;
    const [X0, Y0] = AtHour(99, Hours), [X1, Y1] = AtHour(127, Hours);
    return <line key={Label} data-dial-mark={Label} x1={X0} y1={Y0} x2={X1} y2={Y1} stroke={Label === "rise" ? "#ffb066" : "#a596ff"} strokeWidth="1.6" strokeLinecap="round" />;
  };
  return (
    <svg className="sd-dial" viewBox="0 0 260 260" role="slider" tabIndex={0} aria-label="Solar dial: time of day" aria-valuemin={0} aria-valuemax={24} aria-valuenow={Day.Hours} data-sun-design="dial" onKeyDown={HourKeys(Day.Hours, Change)} {...Dragging(Pick)}>
      <defs>
        <radialGradient id="sd-face">
          <stop offset="0" stopColor="#17171b" />
          <stop offset="1" stopColor="#0b0b0d" />
        </radialGradient>
        <radialGradient id="sd-day" cx="50%" cy="50%" r="50%">
          <stop offset="0.66" stopColor="#ffcf7a" stopOpacity="0.05" />
          <stop offset="1" stopColor="#ffcf7a" stopOpacity="0.45" />
        </radialGradient>
        <radialGradient id="sd-glow">
          <stop offset="0" stopColor={Rgb(Day.Glow)} stopOpacity=".9" />
          <stop offset="1" stopColor={Rgb(Day.Glow)} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={DialC} cy={DialC} r="128" fill="url(#sd-face)" stroke="#2a2a2f" />
      {Array.from({ length: 96 }, (_, Step) => {
        const Hour = Step % 4 === 0, [X0, Y0] = AtHour(Hour ? 119 : 121, Step / 4), [X1, Y1] = AtHour(124, Step / 4);
        return <line key={Step} x1={X0} y1={Y0} x2={X1} y2={Y1} stroke="#ffffff" strokeOpacity={Hour ? 0.35 : 0.13} strokeWidth={Hour ? 1.2 : 0.8} />;
      })}
      {Runs.map((Run) => (
        <path key={Run.Start} d={Arc(106, Run.Start, Math.min(24, Run.End + 0.02))} stroke={PhaseTone[Run.Phase]} strokeWidth="12" fill="none" data-dial-phase={Run.Phase} />
      ))}
      {[0, 6, 12, 18].map((Hour) => {
        const [X, Y] = AtHour(91, Hour);
        return <text key={Hour} x={X} y={Y + 3} textAnchor="middle" className="sd-hour">{String(Hour).padStart(2, "0")}</text>;
      })}
      {/* Sun height curve: outside the dashed horizon ring the sun is up. */}
      <path d={CurvePath} fill="url(#sd-day)" />
      <circle cx={DialC} cy={DialC} r={Horizon} fill="#111114" />
      {Strokes.map((Run, Index) => (
        <path key={Index} d={Run.Points.map(([X, Y], At) => (At ? "L" : "M") + X.toFixed(1) + " " + Y.toFixed(1)).join("")} fill="none" stroke={Run.Above ? "#ffd18a" : "#6c74c8"} strokeWidth={Run.Above ? 1.6 : 1.1} strokeOpacity={Run.Above ? 0.95 : 0.7} />
      ))}
      <circle cx={DialC} cy={DialC} r={Horizon} fill="none" stroke="#ffffff" strokeOpacity=".28" strokeDasharray="2 3" />
      <circle cx={DialC} cy={DialC} r={CurveR(-18)} fill="none" stroke="#5560b0" strokeOpacity=".25" strokeDasharray="1 3" />
      {Mark(Day.Rise, "rise")}
      {Mark(Day.Sunset, "set")}
      {/* Hour hand from the compass out to the band. */}
      {(() => {
        const [X0, Y0] = AtHour(34, Day.Hours), [X1, Y1] = AtHour(113, Day.Hours);
        return <line x1={X0} y1={Y0} x2={X1} y2={Y1} stroke="#ffffff" strokeOpacity=".55" strokeWidth="1" />;
      })()}
      <circle cx={Sun[0]} cy={Sun[1]} r="22" fill="url(#sd-glow)" opacity={Up ? 1 : 0.35} />
      <circle cx={Sun[0]} cy={Sun[1]} r="5.5" fill={Up ? "#fffaf0" : "#9aa0c8"} stroke="#000" strokeOpacity=".3" data-dial-sun="" />
      {/* Compass with the shadow hand. */}
      <circle cx={DialC} cy={DialC} r="32" fill="#1a1a1f" stroke="#303036" />
      {["N", "E", "S", "W"].map((Letter, Index) => {
        const A = Index * 90 * Rad;
        return <text key={Letter} x={DialC + 25 * Math.sin(A)} y={DialC - 25 * Math.cos(A) + 2.5} textAnchor="middle" className={"sd-compass" + (Letter === "N" ? " north" : "")}>{Letter}</text>;
      })}
      {Reach > 0 && <line x1={DialC} y1={DialC} x2={DialC + Reach * Math.sin(Away)} y2={DialC - Reach * Math.cos(Away)} stroke="#000" strokeOpacity=".9" strokeWidth="4" strokeLinecap="round" data-dial-shadow="" />}
      {Reach > 0 && <line x1={DialC} y1={DialC} x2={DialC + Reach * Math.sin(Away)} y2={DialC - Reach * Math.cos(Away)} stroke={Rgb(Day.Glow)} strokeOpacity=".35" strokeWidth="1" strokeLinecap="round" />}
      <circle cx={DialC} cy={DialC} r="2.4" fill="#f4f4f4" />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------------- B · horizon
const StripW = 240, Ground = 100, PerElevation = 0.92;
// Deterministic skyline: low hills behind, blocks and a few towers in front.
const Skyline = (() => {
  let Seed = 7;
  const Next = () => ((Seed = (Seed * 16807) % 2147483647) / 2147483647);
  const Blocks = [];
  for (let X = 0; X < StripW; ) {
    const W = 4 + Next() * 9, Tall = Next() < 0.12;
    Blocks.push([X, W, Tall ? 15 + Next() * 12 : 3 + Next() * 9]);
    X += W + (Next() < 0.25 ? 3 + Next() * 8 : 0);
  }
  return Blocks;
})();
function HorizonStrip({ Day, Latitude, Change }) {
  // The view faces the equator, where the sun crosses at noon.
  const Facing = Latitude < 0 ? 0 : 180;
  const Relative = (Azimuth) => ((((Azimuth - Facing + 180) % 360) + 360) % 360) - 180;
  const X = (Azimuth) => StripW / 2 + (Relative(Azimuth) / 360) * StripW;
  const Y = (El) => Ground - El * PerElevation;
  const Path = [];
  let Run = [];
  Day.Samples.forEach((Sample, Index) => {
    const Prev = Day.Samples[Index - 1];
    if (Sample.Elevation < -6 || (Prev && Math.abs(X(Sample.Azimuth) - X(Prev.Azimuth)) > StripW / 2)) {
      if (Run.length > 1) Path.push(Run);
      Run = [];
      if (Sample.Elevation < -6) return;
    }
    Run.push([X(Sample.Azimuth), Y(Sample.Elevation)]);
  });
  if (Run.length > 1) Path.push(Run);
  const Lift = Math.max(0, Math.min(1, (Day.Elevation + 8) / 30));
  const Top = Mix([6, 8, 18], [44, 104, 188], Lift), Low = Mix(Day.Elevation > -6 ? [52, 40, 70] : [12, 14, 26], Day.Elevation > 10 ? [178, 206, 232] : [236, 150, 92], Math.min(1, Math.max(0, (Day.Elevation + 4) / 10)));
  const Silhouette = Mix([4, 5, 9], [24, 26, 34], Lift);
  const Hills = Mix([10, 12, 22], [70, 92, 120], Lift);
  const Rim = Day.Elevation > -1 && Day.Elevation < 25 ? 0.7 * (1 - Day.Elevation / 25) : 0;
  const SunX = X(Day.Azimuth), SunY = Y(Day.Elevation), Up = Day.Elevation > -0.83;
  // Figure and its shadow on the ground plane (view looks toward Facing; screen right is 90° clockwise of it).
  const Toward = Relative(Day.Azimuth) * Rad;
  const Long = Day.Shadow === Infinity ? 0 : Math.min(5, Day.Shadow) * 14;
  const Fx = StripW / 2, Fy = 136;
  // Drag sideways to move through the day: about ten minutes per pixel of the card.
  const Pick = (Event) => SetHours(Change, Day.Hours + (Event.movementX || 0) * 0.17, 0.01);
  const Beads = [6, 9, 12, 15, 18].map((Hour) => ({ Hour, ...Day.Samples[Hour * 10] })).filter((Each) => Each.Elevation > -4);
  return (
    <svg className="sh-strip" viewBox={`0 0 ${StripW} 152`} role="img" aria-label="Horizon panorama with the sun's path" data-sun-design="horizon" onPointerDown={(Event) => Event.currentTarget.setPointerCapture(Event.pointerId)} onPointerMove={(Event) => Event.buttons & 1 && Pick(Event)}>
      <defs>
        <linearGradient id="sh-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={Rgb(Top)} />
          <stop offset="1" stopColor={Rgb(Low)} />
        </linearGradient>
        <radialGradient id="sh-glow">
          <stop offset="0" stopColor={Rgb(Day.Glow)} stopOpacity=".85" />
          <stop offset="1" stopColor={Rgb(Day.Glow)} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="sh-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={Rgb(Mix([16, 16, 18], Mix([150, 138, 116], Day.Glow, 0.3), 0.75 * Lift))} />
          <stop offset="1" stopColor={Rgb(Mix([8, 8, 9], [96, 88, 74], 0.75 * Lift))} />
        </linearGradient>
        <clipPath id="sh-clip">
          <rect width={StripW} height="152" rx="12" />
        </clipPath>
      </defs>
      <g clipPath="url(#sh-clip)">
        <rect width={StripW} height={Ground} fill="url(#sh-sky)" />
        {[15, 30, 45, 60, 75].map((El) => (
          <g key={El}>
            <line x1="0" x2={StripW} y1={Y(El)} y2={Y(El)} stroke="#ffffff" strokeOpacity=".07" />
            <text x="4" y={Y(El) - 2} className="sh-grid">{El}°</text>
          </g>
        ))}
        {Path.map((Points, Index) => (
          <path key={Index} d={Points.map(([Px, Py], At) => (At ? "L" : "M") + Px.toFixed(1) + " " + Py.toFixed(1)).join("")} fill="none" stroke="#fff3d6" strokeOpacity=".75" strokeWidth="1.2" strokeDasharray="1 2.5" data-sun-path="" />
        ))}
        {Beads.map((Each) => (
          <g key={Each.Hour}>
            <circle cx={X(Each.Azimuth)} cy={Y(Each.Elevation)} r="1.8" fill="#fff3d6" />
            <text x={X(Each.Azimuth)} y={Y(Each.Elevation) - 5} textAnchor="middle" className="sh-bead">{String(Each.Hour).padStart(2, "0")}</text>
          </g>
        ))}
        <circle cx={SunX} cy={SunY} r="30" fill="url(#sh-glow)" opacity={Up ? 1 : 0.25} />
        <circle cx={SunX} cy={SunY} r="5" fill="#fffaf0" opacity={Up ? 1 : 0.4} data-horizon-sun="" />
        <path d={`M0 ${Ground}` + Array.from({ length: 25 }, (_, Step) => `L${Step * 10} ${(Ground - 8 - 5 * Math.sin(Step * 0.9) - 3 * Math.sin(Step * 2.3)).toFixed(1)}`).join("") + `L${StripW} ${Ground}Z`} fill={Rgb(Hills)} opacity=".8" />
        {Skyline.map(([Bx, W, H], Index) => (
          <g key={Index}>
            <rect x={Bx} y={Ground - H} width={W} height={H} fill={Rgb(Silhouette)} />
            {Rim > 0 && <line x1={Bx} x2={Bx + W} y1={Ground - H + 0.4} y2={Ground - H + 0.4} stroke={Rgb(Day.Glow)} strokeOpacity={Rim} strokeWidth=".8" />}
          </g>
        ))}
        <rect y={Ground} width={StripW} height={152 - Ground} fill="url(#sh-ground)" />
        {[["N", 0], ["E", 90], ["W", 270]].map(([Letter, Azimuth]) => (
          <text key={Letter} x={X(Azimuth)} y={Ground + 10} textAnchor="middle" className={"sh-compass" + (Letter === "N" ? " north" : "")}>{Letter}</text>
        ))}
        {/* South is the seam of the strip, so it sits at both ends. */}
        <text x="4" y={Ground + 10} textAnchor="start" className="sh-compass">S</text>
        <text x={StripW - 4} y={Ground + 10} textAnchor="end" className="sh-compass">S</text>
        {Long > 0 && (
          <path
            d={`M${Fx - 2.4} ${Fy}L${Fx + 2.4} ${Fy}L${(Fx - Math.sin(Toward) * Long + 1.4).toFixed(1)} ${(Fy + Math.cos(Toward) * Long * 0.32 + 1.2).toFixed(1)}L${(Fx - Math.sin(Toward) * Long - 1.4).toFixed(1)} ${(Fy + Math.cos(Toward) * Long * 0.32 - 1.2).toFixed(1)}Z`}
            fill="#000"
            fillOpacity={0.55 + 0.3 * Math.min(1, Day.Elevation / 30)}
            data-horizon-shadow=""
          />
        )}
        <g fill={Up ? "#d9d4c8" : "#4a4c58"}>
          <circle cx={Fx} cy={Fy - 15} r="2.6" />
          <path d={`M${Fx - 2.6} ${Fy - 11.5}h5.2l-.8 7h-1.1l-.4 8.5h-0.6l-.4-8.5h-1.1z`} />
        </g>
      </g>
    </svg>
  );
}
// The light's colour through the day; click or drag to set the time.
function LightBand({ Day, Change }) {
  const Pick = (Event) => SetHours(Change, ((SvgPoint(Event).x - 4) / (StripW - 8)) * 24);
  const Px = (Hour) => 4 + (Hour / 24) * (StripW - 8);
  return (
    <svg className="sh-band" viewBox={`0 0 ${StripW} 28`} role="slider" tabIndex={0} aria-label="Light colour through the day" aria-valuemin={0} aria-valuemax={24} aria-valuenow={Day.Hours} onKeyDown={HourKeys(Day.Hours, Change)} {...Dragging(Pick)}>
      {Day.Samples.slice(0, 240).map((Sample, Step) => (
        <rect key={Step} x={Px(Step / 10)} y="4" width={(StripW - 8) / 240 + 0.3} height="10" fill={Rgb(LightAt(Day, Sample.Elevation))} />
      ))}
      <rect x={Px(Day.Hours) - 1.5} y="1" width="3" height="16" rx="1.5" fill="#fff" />
      {[0, 6, 12, 18, 24].map((Hour) => (
        <text key={Hour} x={Px(Hour)} y="25" textAnchor={Hour === 0 ? "start" : Hour === 24 ? "end" : "middle"} className="sh-hour">{String(Hour).padStart(2, "0")}</text>
      ))}
    </svg>
  );
}

// ------------------------------------------------------------------------------------------------------------------------ C · sheet
const KelvinStops = [1500, 2500, 3500, 4500, 5500, 6500, 8000, 10000, 12000];
const KelvinX = (K) => 6 + (Math.log(Math.max(1500, Math.min(12000, K)) / 1500) / Math.log(8)) * 228;
function SunlightSheet({ Day, Change }) {
  const Up = Day.Elevation > 0;
  // Illustration: space above, the air layer from y 62 to the ground at y 168. The beam lands on a post at x 74.
  const Air = 62, Floor = 168, PostX = 148, PostH = 24;
  const El = Math.max(3, Day.Elevation) * Rad;
  const Dx = -Math.cos(El), Dy = -Math.sin(El);
  const Start = (() => {
    // Back along the beam from the post top until the sun reaches y 16 or the left edge.
    const T = Math.min((Floor - PostH - 20) / -Dy, (PostX - 16) / -Dx);
    return [PostX + Dx * T, Floor - PostH + Dy * T];
  })();
  const EnterT = (Floor - PostH - Air) / -Dy;
  const Enter = [PostX + Dx * Math.min(EnterT, 1e4), Air];
  const Slanted = Start[1] > Air ? Start : Enter;
  const ShadowEnd = Day.Shadow === Infinity ? null : PostX + Math.min(86, Day.Shadow * PostH);
  const Beam = Rgb(Day.Glow);
  const Numbers = [
    ["1", "Illuminance", Up ? (Day.Lux >= 10 ? Day.Lux.toFixed(0) : Day.Lux.toFixed(1)) : "0", "klx · est."],
    ["2", "Air mass", Day.Mass == null ? "–" : Day.Mass > 20 ? "20+" : Day.Mass.toFixed(1), "× straight up"],
    ["3", "UV index", Up ? Day.Uv.toFixed(Day.Uv < 10 ? 1 : 0) : "0", Up ? UvBand(Day.Uv) + " · est." : "sun down"],
    ["4", "Shadow", Day.Shadow === Infinity ? "–" : Day.Shadow > 20 ? "20+" : Day.Shadow.toFixed(1), "× height"],
  ];
  const Dot = (N, Px, Py) => (
    <g key={N}>
      <circle cx={Px} cy={Py} r="6" fill="#f4f4f4" />
      <text x={Px} y={Py + 2.6} textAnchor="middle" className="ss-dot">{N}</text>
    </g>
  );
  const Pick = (Event) => SetHours(Change, ((SvgPoint(Event).x - 8) / 224) * 24);
  return (
    <div className="ss-sheet" data-sun-design="sheet">
      <svg className="ss-figure" viewBox="0 0 240 176" role="img" aria-label="Sunlight crossing the air to the ground">
        <defs>
          <linearGradient id="ss-air" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4d7fd0" stopOpacity=".05" />
            <stop offset="1" stopColor="#4d7fd0" stopOpacity=".42" />
          </linearGradient>
          <radialGradient id="ss-sun">
            <stop offset="0" stopColor={Beam} stopOpacity=".9" />
            <stop offset="1" stopColor={Beam} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="240" height="176" rx="12" fill="#0c0d11" />
        <text x="8" y="14" className="ss-label">SPACE</text>
        <text x="8" y={Air + 12} className="ss-label">AIR</text>
        <rect y={Air} width="240" height={Floor - Air} fill="url(#ss-air)" />
        <line x1="0" x2="240" y1={Air} y2={Air} stroke="#7da6ff" strokeOpacity=".35" strokeDasharray="3 3" />
        <text x="234" y={Air - 4} textAnchor="end" className="ss-label">top of the air</text>
        <rect y={Floor} width="240" height={176 - Floor} fill="#26231f" />
        {Up ? (
          <>
            <line x1={Start[0]} y1={Start[1]} x2={Slanted[0]} y2={Slanted[1]} stroke="#fffaf0" strokeWidth="2" strokeOpacity=".8" />
            <line x1={Slanted[0]} y1={Slanted[1]} x2={PostX} y2={Floor - PostH} stroke={Beam} strokeWidth="3.4" strokeLinecap="round" data-sheet-beam="" />
            <circle cx={Start[0]} cy={Start[1]} r="20" fill="url(#ss-sun)" />
            <circle cx={Start[0]} cy={Start[1]} r="6" fill="#fffaf0" />
          </>
        ) : (
          <text x="12" y="38" className="ss-label">sun {Math.abs(Day.Elevation).toFixed(0)}° below the horizon</text>
        )}
        {ShadowEnd != null && <rect x={PostX} y={Floor - 1.5} width={ShadowEnd - PostX} height="3" rx="1.5" fill="#000" fillOpacity=".85" data-sheet-shadow="" />}
        <rect x={PostX - 1.5} y={Floor - PostH} width="3" height={PostH} fill="#e8e3d8" />
        {Up && Dot("1", PostX + 13, Floor - PostH - 4)}
        {Up && Dot("2", (Slanted[0] + PostX) / 2 + 5, (Slanted[1] + Floor - PostH) / 2 - 9)}
        {Up && Dot("3", Start[0], Start[1] - 16)}
        {ShadowEnd != null && Dot("4", Math.min(228, (PostX + ShadowEnd) / 2 + 8), Floor + 1)}
        <text x="234" y="14" textAnchor="end" className="ss-big">{Day.Elevation.toFixed(1)}°</text>
        <text x="234" y="26" textAnchor="end" className="ss-label">{Bearing(Day.Azimuth)} {Day.Azimuth.toFixed(0)}°</text>
      </svg>
      <div className="ss-numbers">
        {Numbers.map(([N, Label, Value, Note]) => (
          <div key={N} data-sun-fact={Label}>
            <i>{N}</i>
            <small>{Label}</small>
            <b>{Value}</b>
            <span>{Note}</span>
          </div>
        ))}
      </div>
      <svg className="ss-kelvin" viewBox="0 0 240 46" role="img" aria-label={`Light colour ${Math.round(Day.Apparent)} kelvin`} data-sun-fact="Colour">
        <defs>
          <linearGradient id="ss-blackbody" x1="0" x2="1">
            {KelvinStops.map((K) => (
              <stop key={K} offset={(KelvinX(K) - 6) / 228} stopColor={Rgb(KelvinRgb(K))} />
            ))}
          </linearGradient>
        </defs>
        <text x="6" y="11" className="ss-label">LIGHT COLOUR</text>
        <text x="234" y="11" textAnchor="end" className="ss-kelvin-value">{(Day.Apparent / 1000).toFixed(2)} k</text>
        <rect x="6" y="17" width="228" height="9" rx="4.5" fill="url(#ss-blackbody)" />
        <path d={`M${KelvinX(Day.Apparent)} 15l-3.5 -4h7z`} fill="#fff" />
        <rect x={KelvinX(Day.Apparent) - 1} y="15" width="2" height="13" rx="1" fill="#fff" />
        {[[1900, "candle"], [3200, "tungsten"], [5500, "noon"], [10000, "blue sky"]].map(([K, Label]) => (
          <text key={K} x={KelvinX(K)} y="40" textAnchor="middle" className="ss-label">{Label}</text>
        ))}
      </svg>
      <svg className="ss-hours" viewBox="0 0 240 22" role="slider" tabIndex={0} aria-label="Sun time of day" aria-valuemin={0} aria-valuemax={24} aria-valuenow={Day.Hours} onKeyDown={HourKeys(Day.Hours, Change)} {...Dragging(Pick)}>
        {Array.from({ length: 24 }, (_, Hour) => {
          const Cx = 8 + ((Hour + 0.5) / 24) * 224, Here = Math.floor(Day.Hours) === Hour;
          return (
            <g key={Hour}>
              <circle cx={Cx} cy="8" r={Here ? 4.2 : 3} fill={Rgb(LightAt(Day, Day.Samples[Hour * 10 + 5].Elevation))} stroke={Here ? "#fff" : "none"} strokeWidth="1.4" />
              {Hour % 6 === 0 && <text x={Cx} y="20.5" textAnchor="middle" className="ss-label">{String(Hour).padStart(2, "0")}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------------------ the card
export default function SunCard({ V, Change }) {
  const Day = SunDay(V);
  const Design = SunDesigns.some(([Id]) => Id === V("Sun card design")) ? V("Sun card design") : "dial";
  return (
    <div className="sun-card" data-design={Design}>
      <div className="sun-card-head">
        <b>{Clock(Day.Hours)}</b>
        <span className="sun-card-phase" style={{ "--tone": PhaseTone[PhaseOf(Day.Elevation)] }}>{DaylightName(Day.Elevation)}</span>
        <div className="sun-card-designs" role="radiogroup" aria-label="Card design">
          {SunDesigns.map(([Id, Letter, Name]) => (
            <button key={Id} type="button" role="radio" aria-checked={Design === Id} aria-label={`${Letter} · ${Name}`} title={Name} data-sun-design-pick={Id} onClick={() => Change("Sun card design", Id)}>
              {Letter}
            </button>
          ))}
        </div>
      </div>
      {Design === "dial" && (
        <>
          <SolarDial Day={Day} Change={Change} />
          <div className="sun-card-chips">
            <span data-sun-fact="Sunrise"><i className="up" />{Day.Rise != null ? Clock(Day.Rise) : "—"}</span>
            <span data-sun-fact="Daylight">{Span(Day.Length)} of light</span>
            <span data-sun-fact="Sunset"><i className="down" />{Day.Sunset != null ? Clock(Day.Sunset) : "—"}</span>
          </div>
          <p className="sun-card-note">
            Dashed ring: the horizon. The gold curve is the sun's height through the day, outside the ring above the horizon. Drag round the dial to set the time.
          </p>
        </>
      )}
      {Design === "horizon" && (
        <>
          <HorizonStrip Day={Day} Latitude={Day.Place.Latitude ?? -26} Change={Change} />
          <LightBand Day={Day} Change={Change} />
          <div className="sun-card-row">
            <div data-sun-fact="Position"><small>Sun</small><b>{Day.Elevation.toFixed(1)}°</b><span>{Bearing(Day.Azimuth)} {Day.Azimuth.toFixed(0)}°</span></div>
            <div data-sun-fact="Peak"><small>Highest</small><b>{Day.Peak.Elevation.toFixed(0)}°</b><span>at {Clock(Day.Peak.Hours)}</span></div>
            <div data-sun-fact="Colour"><small>Light</small><b><i style={{ background: Rgb(Day.Glow) }} />{(Day.Apparent / 1000).toFixed(1)}k</b><span>kelvin</span></div>
          </div>
        </>
      )}
      {Design === "sheet" && <SunlightSheet Day={Day} Change={Change} />}
    </div>
  );
}
