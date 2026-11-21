// "Sun now": a small lit set (a block, a post and a ball on a ground plate with a north arrow) seen from a fixed camera,
// lit by the sun at the authored time: real shadow directions and lengths, sun-coloured light, sky behind. A day track
// under it shows night, twilight and daylight; drag the set or the track to change Local Hours. Then the figures that
// matter for lighting. Uses the same solar solver as the Sun direction card, so the two always agree.
import React, { useRef } from "react";
import { Solar } from "./Solar.mjs";

const Compass = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const Bearing = (Azimuth) => Compass[Math.round((((Azimuth % 360) + 360) % 360) / 22.5) % 16];
const Clock = (Hours) => {
  const Minutes = Math.round((((Hours % 24) + 24) % 24) * 60) % 1440;
  return String(Math.floor(Minutes / 60)).padStart(2, "0") + ":" + String(Minutes % 60).padStart(2, "0");
};

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

// Blackbody colour (Tanner Helland's fit).
function Kelvin(K) {
  const T = Math.max(1000, Math.min(40000, K)) / 100;
  const Red = T <= 66 ? 255 : 329.7 * (T - 60) ** -0.1332;
  const Green = T <= 66 ? 99.47 * Math.log(T) - 161.12 : 288.12 * (T - 60) ** -0.0755;
  const Blue = T >= 66 ? 255 : T <= 19 ? 0 : 138.52 * Math.log(T - 10) - 305.04;
  return "rgb(" + [Red, Green, Blue].map((C) => Math.max(0, Math.min(255, Math.round(C)))).join(",") + ")";
}

// Sky colour pairs (zenith, horizon) by sun elevation.
const Sky = [
  [-20, "#04060d", "#080b16"],
  [-10, "#06080f", "#131b33"],
  [-5, "#0a0f21", "#2b3157"],
  [-1, "#122045", "#7d5a6a"],
  [3, "#1d3566", "#e08a4a"],
  [9, "#245089", "#e5b273"],
  [20, "#2a63a8", "#bcd0e2"],
  [45, "#2f6dc0", "#a9c9ea"],
  [75, "#2b6ecb", "#9dc4ee"],
];
function Blend(A, B, T) {
  const Pa = parseInt(A.slice(1), 16), Pb = parseInt(B.slice(1), 16);
  const Channel = (Shift) => Math.round(((Pa >> Shift) & 255) + (((Pb >> Shift) & 255) - ((Pa >> Shift) & 255)) * T);
  return `rgb(${Channel(16)},${Channel(8)},${Channel(0)})`;
}
function SkyStops(Elevation) {
  let Index = 0;
  while (Index < Sky.length - 2 && Elevation > Sky[Index + 1][0]) Index++;
  const [A0, Z0, H0] = Sky[Index], [A1, Z1, H1] = Sky[Index + 1];
  const T = Math.max(0, Math.min(1, (Elevation - A0) / (A1 - A0)));
  return [Blend(Z0, Z1, T), Blend(H0, H1, T)];
}

const Rad = Math.PI / 180;
// Fixed camera: from the south-south-east, 26° above the ground, orthographic.
const CameraBearing = 158 * Rad, CameraPitch = 26 * Rad;
const Forward = [-Math.sin(CameraBearing) * Math.cos(CameraPitch), -Math.sin(CameraPitch), -Math.cos(CameraBearing) * Math.cos(CameraPitch)];
const Right = [-Math.cos(CameraBearing), 0, Math.sin(CameraBearing)];
const Upward = [
  Right[1] * Forward[2] - Right[2] * Forward[1],
  Right[2] * Forward[0] - Right[0] * Forward[2],
  Right[0] * Forward[1] - Right[1] * Forward[0],
].map((C) => -C);
const Dot = (A, B) => A[0] * B[0] + A[1] * B[1] + A[2] * B[2];
const SetW = 300, SetH = 176, Scale = 31, Ox = 150, Oy = 112;
const Screen = (P) => [Ox + Dot(P, Right) * Scale, Oy - Dot(P, Upward) * Scale];
const Depth = (P) => Dot(P, Forward);
const Line = (Points) => Points.map((P, At) => (At ? "L" : "M") + P[0].toFixed(1) + " " + P[1].toFixed(1)).join("") + "Z";
// Convex hull (monotone chain) of 2D points.
function Hull(Points) {
  const Sorted = [...Points].sort((A, B) => A[0] - B[0] || A[1] - B[1]);
  const Cross = (O, A, B) => (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
  const Lower = [], Upper = [];
  for (const P of Sorted) {
    while (Lower.length > 1 && Cross(Lower.at(-2), Lower.at(-1), P) <= 0) Lower.pop();
    Lower.push(P);
  }
  for (const P of Sorted.reverse()) {
    while (Upper.length > 1 && Cross(Upper.at(-2), Upper.at(-1), P) <= 0) Upper.pop();
    Upper.push(P);
  }
  return Lower.slice(0, -1).concat(Upper.slice(0, -1));
}
// Boxes on the plate: [centre x, z, width, height, depth, base grey].
const Blocks = [
  [-1.15, 0.35, 1.1, 1.1, 1.1, 0.74],
  [1.05, -0.55, 0.16, 2.3, 0.16, 0.82],
];
const Ball = { X: 0.55, Z: 1.15, R: 0.5 };
const Plate = 2.6;
const RgbOf = (Text) => (Text.match(/\d+/g) || [255, 255, 255]).slice(0, 3).map((C) => +C / 255);
const Css = (Rgb) => "rgb(" + Rgb.map((C) => Math.round(255 * Math.max(0, Math.min(1, C)))).join(",") + ")";

export default function SunNow({ V, Change }) {
  const Place = { Month: V("Month"), Day: V("Day of Month"), Latitude: V("Latitude"), Longitude: V("Longitude") };
  const Hours = V("Local Hours");
  const { Elevation, Azimuth } = Solar({ ...Place, LocalHours: Hours });
  // The day sampled every six minutes: sunrise / sunset (upper limb, 0.83° below the geometric horizon) and twilight.
  const Day = Array.from({ length: 241 }, (_, Step) => ({ Hours: Step / 10, ...Solar({ ...Place, LocalHours: Step / 10 }) }));
  const Crossing = (Rising, Height = -0.83) => {
    for (let Step = 1; Step < Day.length; Step++) {
      const [A, B] = [Day[Step - 1].Elevation - Height, Day[Step].Elevation - Height];
      if (Rising ? A < 0 && B >= 0 : A >= 0 && B < 0) return Day[Step - 1].Hours + (A / (A - B)) * 0.1;
    }
    return null;
  };
  const Rise = Crossing(true), Sunset = Crossing(false);
  const Length = Rise != null && Sunset != null ? (Sunset - Rise + 24) % 24 : Day[120].Elevation > 0 ? 24 : 0;
  const Peak = Day.reduce((Best, Sample) => (Sample.Elevation > Best.Elevation ? Sample : Best), Day[0]);
  const [Overhead, Low] = SkyStops(Elevation);
  const Rated = V("Temperature") ?? 6500;
  const Reddening = Math.max(0, Math.min(1, (12 - Elevation) / 18)) ** 0.7;
  const Apparent = Rated + (1800 - Rated) * Reddening;
  const Glow = Kelvin(Apparent);
  const Sine = Math.sin((Math.max(0, Elevation) * Math.PI) / 180);
  // Clear-sky ground illuminance, an estimate: attenuated direct beam plus sky light.
  const Ground = Elevation > 0 ? 128 * Sine * Math.exp(-0.21 / Math.max(0.05, Sine)) + 18 * Math.sqrt(Sine) : 0;
  const Shadow = Elevation > 0.5 ? 1 / Math.tan((Elevation * Math.PI) / 180) : Infinity;

  // Light: direction towards the sun (x east, y up, z north), direct strength and sky fill.
  const Toward = [Math.sin(Azimuth * Rad) * Math.cos(Elevation * Rad), Math.sin(Elevation * Rad), Math.cos(Azimuth * Rad) * Math.cos(Elevation * Rad)];
  const Direct = Elevation > 0 ? Math.min(1, 0.25 + 1.1 * Math.sqrt(Sine)) : 0;
  const Light = RgbOf(Glow), Fill = RgbOf(Overhead);
  const Twilight = Math.max(0, Math.min(1, (Elevation + 12) / 14));
  const Ambient = 0.08 + 0.3 * Twilight;
  const Shade = (Normal, Grey) =>
    Css(Light.map((C, Channel) => Grey * (C * Direct * Math.max(0, Dot(Normal, Toward)) * 0.95 + Fill[Channel] * Ambient + 0.03)));
  const Casting = Elevation > 0.6;
  const Project = (P) => {
    const Reach = P[1] / Math.max(0.01, Toward[1]);
    return [P[0] - Toward[0] * Reach, 0, P[2] - Toward[2] * Reach];
  };
  const Faces = [];
  const Shadows = [];
  Blocks.forEach(([X, Z, W, H, D, Grey], Index) => {
    const Corners = [];
    for (const Sx of [-1, 1]) for (const Sy of [0, 1]) for (const Sz of [-1, 1]) Corners.push([X + (Sx * W) / 2, Sy * H, Z + (Sz * D) / 2]);
    if (Casting) Shadows.push(Hull(Corners.map((P) => { const G = Project(P); return [G[0], G[2]]; })));
    const Sides = [
      [[1, 0, 0], (P) => P[0] > X],
      [[-1, 0, 0], (P) => P[0] < X],
      [[0, 1, 0], (P) => P[1] > 0],
      [[0, 0, 1], (P) => P[2] > Z],
      [[0, 0, -1], (P) => P[2] < Z],
    ];
    for (const [Normal, Inside] of Sides) {
      if (Dot(Normal, Forward) >= 0) continue;
      const Quad = Corners.filter(Inside);
      const Flat = Hull(Quad.map(Screen));
      Faces.push({ Key: Index + "-" + Normal.join(""), Depth: Depth([X, H / 2, Z]) - 0.001 * Index, Path: Line(Flat), Fill: Shade(Normal, Grey) });
    }
  });
  if (Casting) {
    const Ring = Array.from({ length: 24 }, (_, Step) => {
      const Angle = (Step / 24) * 2 * Math.PI;
      // Silhouette circle of the ball as seen from the sun, projected to the ground.
      const A = Math.abs(Toward[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
      const U = [Toward[1] * A[2] - Toward[2] * A[1], Toward[2] * A[0] - Toward[0] * A[2], Toward[0] * A[1] - Toward[1] * A[0]];
      const Size = Math.hypot(...U);
      const Un = U.map((C) => C / Size);
      const Vn = [Toward[1] * Un[2] - Toward[2] * Un[1], Toward[2] * Un[0] - Toward[0] * Un[2], Toward[0] * Un[1] - Toward[1] * Un[0]];
      const P = [0, 1, 2].map((C) => [Ball.X, Ball.R, Ball.Z][C] + Ball.R * (Math.cos(Angle) * Un[C] + Math.sin(Angle) * Vn[C]));
      const G = Project(P);
      return [G[0], G[2]];
    });
    Shadows.push(Hull(Ring));
  }
  const BallAt = Screen([Ball.X, Ball.R, Ball.Z]);
  const Lit = [Dot(Toward, Right), -Dot(Toward, Upward)];
  const LitSize = Math.hypot(...Lit) || 1;
  const Highlight = [50 + 32 * (Lit[0] / LitSize) * Math.min(1, LitSize), 50 + 32 * (Lit[1] / LitSize) * Math.min(1, LitSize)];
  const PlateCorners = [[-Plate, 0, -Plate], [Plate, 0, -Plate], [Plate, 0, Plate], [-Plate, 0, Plate]].map(Screen);
  const GroundTone = Css([0.42, 0.4, 0.36].map((Grey, Channel) => Grey * (Light[Channel] * Direct * Toward[1] * 0.9 + Fill[Channel] * Ambient + 0.04)));
  const SunVisible = Elevation > -1 && Depth(Toward) > -0.2;
  const SunAt = Screen(Toward.map((C) => C * 3.6));
  const SunSpot = [Math.max(14, Math.min(SetW - 14, SunAt[0])), Math.max(12, Math.min(SetH - 30, SunAt[1]))];
  const Set = useRef(null);
  const Scrub = (Event) => {
    if (!(Event.buttons & 1)) return;
    const Box = Event.currentTarget.getBoundingClientRect();
    const Dx = (Event.movementX || 0) / Box.width;
    Change("Local Hours", Math.round((((Hours + Dx * 12) % 24) + 24) % 24 * 100) / 100);
  };
  // Day track.
  const Track = (Hour) => 8 + (Hour / 24) * (SetW - 16);
  const Bands = Day.slice(0, 240).map((Sample) => {
    const El = Sample.Elevation;
    return El > 6 ? "#e7d2a1" : El > -0.83 ? "#d99a52" : El > -6 ? "#5d6d9c" : El > -12 ? "#36406a" : El > -18 ? "#232843" : "#15171f";
  });
  const Runs = [];
  Bands.forEach((Colour, Step) => {
    if (Runs.length && Runs.at(-1).Colour === Colour) Runs.at(-1).End = Step + 1;
    else Runs.push({ Colour, Start: Step, End: Step + 1 });
  });
  const Pick = (Event) => {
    const Box = Event.currentTarget.getBoundingClientRect();
    const Hour = (((Event.clientX - Box.left) / Box.width) * SetW - 8) / (SetW - 16) * 24;
    Change("Local Hours", Math.round(Math.max(0, Math.min(23.99, Hour)) * 20) / 20);
  };
  const Facts = [
    ["Sunrise", Rise != null ? Clock(Rise) : "—", Rise != null ? Bearing(Day[Math.round(Rise * 10)].Azimuth) : "polar"],
    ["Sunset", Sunset != null ? Clock(Sunset) : "—", Sunset != null ? Bearing(Day[Math.min(240, Math.round(Sunset * 10))].Azimuth) : "polar"],
    ["Daylight", Math.floor(Length) + "h " + String(Math.round((Length % 1) * 60)).padStart(2, "0"), "peak " + Peak.Elevation.toFixed(0) + "°"],
    ["Colour", (Apparent / 1000).toFixed(1) + "k", "kelvin", Glow],
    ["Ground", Ground >= 10 ? Ground.toFixed(0) : Ground.toFixed(1), "klx · est."],
    ["Shadow", Shadow === Infinity ? "—" : Shadow > 20 ? "20+" : Shadow.toFixed(1), "× height"],
  ];
  return (
    <div className="sun-now-body">
      <div className="sun-now-line">
        <b>{Clock(Hours)}</b>
        <span>{DaylightName(Elevation)}</span>
        <small>
          {Elevation >= 0 ? Elevation.toFixed(1) + "° up" : Math.abs(Elevation).toFixed(1) + "° below"} · {Bearing(Azimuth)} {Azimuth.toFixed(0)}°
        </small>
      </div>
      <svg
        ref={Set}
        className="sun-set"
        viewBox={`0 0 ${SetW} ${SetH}`}
        role="img"
        aria-label="Lit set at the authored time"
        data-sun-set=""
        onPointerDown={(Event) => Event.currentTarget.setPointerCapture(Event.pointerId)}
        onPointerMove={Scrub}
      >
        <defs>
          <linearGradient id="sun-set-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={Overhead} />
            <stop offset="1" stopColor={Low} />
          </linearGradient>
          <radialGradient id="sun-set-glow">
            <stop offset="0" stopColor={Glow} stopOpacity=".8" />
            <stop offset="1" stopColor={Glow} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="sun-set-ball" cx={Highlight[0] + "%"} cy={Highlight[1] + "%"} r="75%">
            <stop offset="0" stopColor={Shade(Toward, 0.92)} />
            <stop offset="0.55" stopColor={Shade([Toward[0] * 0.4, 0.9, Toward[2] * 0.4], 0.62)} />
            <stop offset="1" stopColor={Css(Fill.map((C) => 0.86 * (C * Ambient + 0.03)))} />
          </radialGradient>
          <clipPath id="sun-set-clip">
            <rect width={SetW} height={SetH} rx="14" />
          </clipPath>
          <clipPath id="sun-set-plate">
            <path d={Line(PlateCorners)} />
          </clipPath>
          <filter id="sun-set-soft" x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation={0.5 + 1.4 * Math.min(1, (V("Angular Diameter") ?? 0.53) / 1.5)} />
          </filter>
        </defs>
        <g clipPath="url(#sun-set-clip)">
          <rect width={SetW} height={SetH} fill="url(#sun-set-sky)" />
          {SunVisible && (
            <g data-sun-disc="">
              <circle cx={SunSpot[0]} cy={SunSpot[1]} r="40" fill="url(#sun-set-glow)" />
              <circle cx={SunSpot[0]} cy={SunSpot[1]} r="6" fill="#fffdf4" />
            </g>
          )}
          <path d={Line(PlateCorners)} fill={GroundTone} />
          <g clipPath="url(#sun-set-plate)" stroke="#ffffff" strokeOpacity=".07">
            {[-2, -1, 0, 1, 2].map((At) => (
              <g key={At}>
                <line x1={Screen([At, 0, -Plate])[0]} y1={Screen([At, 0, -Plate])[1]} x2={Screen([At, 0, Plate])[0]} y2={Screen([At, 0, Plate])[1]} />
                <line x1={Screen([-Plate, 0, At])[0]} y1={Screen([-Plate, 0, At])[1]} x2={Screen([Plate, 0, At])[0]} y2={Screen([Plate, 0, At])[1]} />
              </g>
            ))}
          </g>
          <g clipPath="url(#sun-set-plate)">
            <g filter="url(#sun-set-soft)" fill="#000000" fillOpacity={0.55 * Direct}>
              {Shadows.map((Points, Index) => (
                <path key={Index} d={Line(Points.map(([X, Z]) => Screen([X, 0, Z])))} data-sun-shadow="" />
              ))}
            </g>
          </g>
          {(() => {
            const Arrow = [[-2.25, 0, -1.6], [-2.25, 0, -0.9], [-2.4, 0, -1.15], [-2.1, 0, -1.15]].map(Screen);
            const Letter = Screen([-2.25, 0, -0.62]);
            return (
              <g stroke="#ffffff" strokeOpacity=".55" fill="none">
                <line x1={Arrow[0][0]} y1={Arrow[0][1]} x2={Arrow[1][0]} y2={Arrow[1][1]} />
                <path d={`M${Arrow[2][0]} ${Arrow[2][1]}L${Arrow[1][0]} ${Arrow[1][1]}L${Arrow[3][0]} ${Arrow[3][1]}`} />
                <text x={Letter[0]} y={Letter[1]} textAnchor="middle" className="sun-set-north" stroke="none">N</text>
              </g>
            );
          })()}
          {[
            ...Faces.map((Face) => ({ ...Face, Shape: "face" })),
            { Shape: "ball", Key: "ball", Depth: Depth([Ball.X, Ball.R, Ball.Z]) },
          ]
            .sort((A, B) => B.Depth - A.Depth)
            .map((Solid) =>
              Solid.Shape === "ball" ? (
                <circle key="ball" cx={BallAt[0]} cy={BallAt[1]} r={Ball.R * Scale} fill="url(#sun-set-ball)" />
              ) : (
                <path key={Solid.Key} d={Solid.Path} fill={Solid.Fill} stroke="#000000" strokeOpacity=".18" strokeWidth=".6" />
              ),
            )}
          {!SunVisible && Elevation > -1 && <text x={SetW - 10} y="16" textAnchor="end" className="sun-set-note">sun behind the camera</text>}
          {Elevation <= -1 && <text x={SetW - 10} y="16" textAnchor="end" className="sun-set-note">sun below the horizon</text>}
        </g>
      </svg>
      <svg className="sun-track" viewBox={`0 0 ${SetW} 30`} role="slider" aria-label="Sun time of day" aria-valuemin={0} aria-valuemax={24} aria-valuenow={Hours} tabIndex={0}
        onKeyDown={(Event) => {
          const Moves = { ArrowRight: 0.25, ArrowLeft: -0.25, ArrowUp: 1, ArrowDown: -1 };
          if (!(Event.key in Moves)) return;
          Event.preventDefault();
          Change("Local Hours", Math.round(((((Hours + Moves[Event.key]) % 24) + 24) % 24) * 100) / 100);
        }}
        onPointerDown={(Event) => { Event.currentTarget.setPointerCapture(Event.pointerId); Pick(Event); }}
        onPointerMove={(Event) => Event.buttons & 1 && Pick(Event)}
      >
        {Runs.map((Run) => (
          <rect key={Run.Start} x={Track(Run.Start / 10)} y="6" width={Track(Run.End / 10) - Track(Run.Start / 10) + 0.4} height="6" fill={Run.Colour} />
        ))}
        {[0, 6, 12, 18, 24].map((Hour) => (
          <text key={Hour} x={Track(Hour)} y="26" textAnchor={Hour === 0 ? "start" : Hour === 24 ? "end" : "middle"}>{String(Hour).padStart(2, "0")}</text>
        ))}
        <rect x={Track(Hours) - 1.5} y="1" width="3" height="16" rx="1.5" fill="#f4f4f4" />
      </svg>
      <div className="sun-facts">
        {Facts.map(([Label, Value, Note, Swatch]) => (
          <div key={Label} data-sun-fact={Label}>
            <small>{Label}</small>
            <b>
              {Swatch && <i style={{ background: Swatch }} />}
              {Value}
            </b>
            <span>{Note}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
