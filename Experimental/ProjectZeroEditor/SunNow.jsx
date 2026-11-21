// "Sun now": where the sun is at the authored time, drawn as a 360° horizon panorama with the whole day's path, plus
// the figures that matter for lighting (rise / set, day length, light colour, ground light, shadow length). Uses the
// same solar solver as the Sun direction card, so the two always agree. Dragging the panorama scrubs Local Hours.
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

export default function SunNow({ V, Change }) {
  const Place = { Month: V("Month"), Day: V("Day of Month"), Latitude: V("Latitude"), Longitude: V("Longitude") };
  const Hours = V("Local Hours");
  const { Elevation, Azimuth } = Solar({ ...Place, LocalHours: Hours });
  // The day sampled every six minutes: path, sunrise / sunset (upper limb, 0.83° below the geometric horizon).
  const Day = Array.from({ length: 241 }, (_, Step) => ({ Hours: Step / 10, ...Solar({ ...Place, LocalHours: Step / 10 }) }));
  const Crossing = (Rising) => {
    for (let Step = 1; Step < Day.length; Step++) {
      const [A, B] = [Day[Step - 1].Elevation + 0.83, Day[Step].Elevation + 0.83];
      if (Rising ? A < 0 && B >= 0 : A >= 0 && B < 0) return Day[Step - 1].Hours + (A / (A - B)) * 0.1;
    }
    return null;
  };
  const Rise = Crossing(true), Sunset = Crossing(false);
  const Length = Rise != null && Sunset != null ? (Sunset - Rise + 24) % 24 : Day[120].Elevation > 0 ? 24 : 0;
  const Peak = Day.reduce((Best, Sample) => (Sample.Elevation > Best.Elevation ? Sample : Best), Day[0]);

  // Panorama: 360° of bearing across, centred on the bearing of the noon sun.
  const W = 300, H = 132, Skyline = 98;
  const Centre = Math.round(Peak.Azimuth / 90) * 90;
  const Across = (Az) => ((((Az - Centre + 180) % 360) + 360) % 360) / 360 * W;
  const Up = (El) => Skyline - Math.max(-12, El) * ((Skyline - 12) / 90);
  const Runs = [];
  let Run = [];
  Day.forEach((Sample, Index) => {
    const X = Across(Sample.Azimuth);
    if (Index && Math.abs(X - Across(Day[Index - 1].Azimuth)) > W / 2) {
      Runs.push(Run);
      Run = [];
    }
    if (Sample.Elevation > -12) Run.push([X, Up(Sample.Elevation)]);
    else if (Run.length) {
      Runs.push(Run);
      Run = [];
    }
  });
  Runs.push(Run);
  const [Overhead, Low] = SkyStops(Elevation);
  const Base = V("Temperature") ?? 6500;
  const Reddening = Math.max(0, Math.min(1, (12 - Elevation) / 18)) ** 0.7;
  const Apparent = Base + (1800 - Base) * Reddening;
  const Glow = Kelvin(Apparent);
  const Sx = Across(Azimuth), Sy = Up(Elevation);
  const Sine = Math.sin((Math.max(0, Elevation) * Math.PI) / 180);
  // Clear-sky ground illuminance, an estimate: attenuated direct beam plus sky light.
  const Ground = Elevation > 0 ? 128 * Sine * Math.exp(-0.21 / Math.max(0.05, Sine)) + 18 * Math.sqrt(Sine) : 0;
  const Shadow = Elevation > 0.5 ? 1 / Math.tan((Elevation * Math.PI) / 180) : Infinity;
  const HourMarks = [6, 9, 12, 15, 18].map((Hour) => Day[Hour * 10]).filter((Sample) => Sample.Elevation > -4 && Math.hypot(Across(Sample.Azimuth) - Across(Azimuth), Up(Sample.Elevation) - Up(Elevation)) > 16);
  const Plot = useRef(null);
  const Scrub = (Event) => {
    if (!(Event.buttons & 1)) return;
    const Box = Plot.current.getBoundingClientRect();
    const Dx = (Event.movementX || 0) / Box.width;
    Change("Local Hours", Math.round((((Hours + Dx * 12) % 24) + 24) % 24 * 100) / 100);
  };
  const Facts = [
    ["Sunrise", Rise != null ? Clock(Rise) : "—", Rise != null ? Bearing(Day[Math.round(Rise * 10)].Azimuth) : "polar"],
    ["Sunset", Sunset != null ? Clock(Sunset) : "—", Sunset != null ? Bearing(Day[Math.min(240, Math.round(Sunset * 10))].Azimuth) : "polar"],
    ["Daylight", Math.floor(Length) + "h " + String(Math.round((Length % 1) * 60)).padStart(2, "0"), "peak " + Peak.Elevation.toFixed(0) + "°"],
    ["Colour", (Apparent / 1000).toFixed(1) + "k", "kelvin", Glow],
    ["Ground", Ground >= 10 ? Ground.toFixed(0) : Ground.toFixed(1), "klx · estimate"],
    ["Shadow", Shadow === Infinity ? "—" : Shadow > 20 ? "20+" : Shadow.toFixed(1), "× height"],
  ];
  return (
    <div className="sun-now-body">
      <div className="metric">
        <span>{Clock(Hours)}</span>
        <small>{DaylightName(Elevation)}</small>
      </div>
      <p>
        {Elevation >= 0 ? Elevation.toFixed(1) + "° above" : Math.abs(Elevation).toFixed(1) + "° below"} the horizon · {Bearing(Azimuth)}{" "}
        {Azimuth.toFixed(0)}°
      </p>
      <svg
        ref={Plot}
        className="sun-panorama"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Sun panorama"
        data-sun-panorama=""
        onPointerDown={(Event) => Event.currentTarget.setPointerCapture(Event.pointerId)}
        onPointerMove={Scrub}
      >
        <defs>
          <linearGradient id="sun-now-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={Overhead} />
            <stop offset="1" stopColor={Low} />
          </linearGradient>
          <radialGradient id="sun-now-glow">
            <stop offset="0" stopColor={Glow} stopOpacity={0.75} />
            <stop offset="1" stopColor={Glow} stopOpacity="0" />
          </radialGradient>
          <clipPath id="sun-now-clip">
            <rect width={W} height={H - 14} rx="14" />
          </clipPath>
        </defs>
        <g clipPath="url(#sun-now-clip)">
          <rect width={W} height={Skyline} fill="url(#sun-now-sky)" />
          {[30, 60].map((Ring) => (
            <g key={Ring}>
              <line x1="0" x2={W} y1={Up(Ring)} y2={Up(Ring)} stroke="#ffffff" strokeOpacity=".1" strokeDasharray="2 4" />
              <text x="6" y={Up(Ring) - 3} className="sun-now-faint">{Ring}°</text>
            </g>
          ))}
          <circle cx={Sx} cy={Sy} r="44" fill="url(#sun-now-glow)" />
          <rect y={Skyline} width={W} height={H - Skyline} fill="#0b0c0f" />
          {Runs.filter((Points) => Points.length > 1).map((Points, Index) => (
            <path
              key={Index}
              d={Points.map((Point, Each) => (Each ? "L" : "M") + Point[0].toFixed(1) + " " + Point[1].toFixed(1)).join("")}
              fill="none"
              stroke="#fff3d6"
              strokeOpacity=".7"
              strokeWidth="1.1"
              strokeDasharray="1.5 3"
              strokeLinecap="round"
            />
          ))}
          {HourMarks.map((Sample) => (
            <g key={Sample.Hours}>
              <circle cx={Across(Sample.Azimuth)} cy={Up(Sample.Elevation)} r="1.8" fill="#fff3d6" />
              <text x={Across(Sample.Azimuth)} y={Up(Sample.Elevation) - 5} textAnchor="middle" className="sun-now-faint">
                {String(Sample.Hours).padStart(2, "0")}h
              </text>
            </g>
          ))}
          <line x1="0" x2={W} y1={Skyline} y2={Skyline} stroke="#ffffff" strokeOpacity=".22" />
          {Elevation > -12 && (
            <>
              <line x1={Sx} x2={Sx} y1={Math.min(Sy, Skyline)} y2={Skyline} stroke={Glow} strokeOpacity=".5" />
              <circle cx={Sx} cy={Sy} r="6.5" fill={Glow} />
              <circle cx={Sx} cy={Sy} r="3.6" fill="#fffdf6" />
            </>
          )}
          {Compass.filter((_, Index) => Index % 2 === 0).map((Name, Index) => {
            const X = Across(Index * 45);
            return (
              <g key={Name}>
                <line x1={X} x2={X} y1={Skyline} y2={Skyline + 4} stroke="#ffffff" strokeOpacity=".35" />
                <text x={X} y={Skyline + 12} textAnchor="middle" className={Name.length === 1 ? "sun-now-cardinal" : "sun-now-faint"}>
                  {Name}
                </text>
              </g>
            );
          })}
        </g>
        <text x="0" y={H - 2}>Whole day's path · drag to change the time</text>
        <text x={W} y={H - 2} textAnchor="end">{DaylightName(Elevation).toLowerCase()}</text>
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
