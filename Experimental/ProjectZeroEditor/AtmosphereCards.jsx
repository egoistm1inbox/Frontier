//============================================================================================================================================
//                                                           ATMOSPHERECARDS.JSX
//============================================================================================================================================
// 🧩 The Atmosphere panel's first card, in three designs to choose from (stored as "Atmosphere card design"):
//   A · Cross-section  the air from the ground to 100 km: troposphere, ozone layer, stratosphere, mesosphere; molecule and aerosol
//                      density curves from the scale heights; a sunbeam bending down through it and losing blue on the way.
//   B · Planet limb    the planet's edge from orbit: the glowing ring and the sunset band where day turns to night, coloured by the
//                      settings.
//   C · Scattering     one sunbeam meeting a parcel of air: molecules send blue everywhere (Rayleigh), aerosols push haze forward
//                      (Mie, shaped by the anisotropy), and what is left continues as sunset light; sky swatches underneath.
// Colours come from SkyDome.jsx's single-scatter estimate (SkyMedium / SkyRadiance), so they follow Rayleigh, Mie, ozone, the scale
// heights, tint and brightness. The sun height is the preview sun shared with the sky ("Sky preview elevation"). Illustrative only:
// not the native sky.

import React from "react";
import { SkyMedium, SkyRadiance, AirMass, Direction } from "./SkyDome.jsx";

export const AtmosphereDesigns = [
  ["section", "A", "Cross-section"],
  ["limb", "B", "Planet limb"],
  ["scatter", "C", "Scattering"],
];

const Rad = Math.PI / 180;
// Tone map on luminance so bright colours keep their hue.
const Develop = (Linear, Exposure = 2.2) => {
  const Luminance = 0.2126 * Linear[0] + 0.7152 * Linear[1] + 0.0722 * Linear[2] + 1e-9;
  const Scale = (1 - Math.exp(-Luminance * Exposure)) / Luminance;
  return Linear.map((C) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, C * Scale)), 1 / 2.2)));
};
const Css = (Channels) => `rgb(${Channels.join(",")})`;
const Hex = (Text) => (/^#[\da-f]{6}$/i.test(Text || "") ? [1, 3, 5].map((At) => parseInt(Text.slice(At, At + 2), 16)) : [121, 110, 96]);

// What every design reads.
function AtmosphereFigures(V) {
  const Medium = SkyMedium(V);
  const Read = (Name, Fallback) => V(Name) ?? Fallback;
  const SunElevation = Read("Sky preview elevation", 32);
  const Sun = Direction(SunElevation, 0);
  const Sky = (Elevation, Azimuth) => Css(Develop(SkyRadiance(Medium, Direction(Elevation, Azimuth), Elevation, Sun, SunElevation)));
  const SkyAt = (Elevation, Azimuth, SunAt) => Css(Develop(SkyRadiance(Medium, Direction(Elevation, Azimuth), Elevation, Direction(SunAt, 0), SunAt)));
  // Optical depth straight up, per channel, and the sunlight left after a path of `Mass` atmospheres.
  const Depth = [0, 1, 2].map((Channel) => Medium.Rayleigh[Channel] + 1.11 * Medium.Mie + Medium.Ozone[Channel]);
  const Through = (Mass) => Depth.map((Each) => Math.exp(-Each * Mass));
  const Sunlight = (Elevation) => Css(Develop(Through(AirMass(Elevation)).map((Each) => Each * 0.9 * (Elevation >= 0 ? 1 : Math.exp(Elevation * 0.55))), 1.4));
  return {
    Medium,
    SunElevation,
    Sky,
    SkyAt,
    Depth,
    Through,
    Sunlight,
    Rayleigh: Read("Rayleigh", 1),
    Mie: Read("Mie", 1),
    Ozone: Read("Ozone", 1.2),
    RayleighH: Read("Rayleigh Scale H", 8000),
    MieH: Read("Mie Scale H", 1200),
    Top: Read("Atmosphere", 60000),
    Lean: Read("Mie Anisotropy", 0.78),
    Glow: Read("Horizon Glow", 1),
    Planet: Read("Planet radius", 6371),
    Ground: Hex(Read("Ground Albedo", "#796e60")),
  };
}

// ------------------------------------------------------------------------------------------------------------- A · cross-section
const SectionGround = 222, SectionTop = 12;
const AltY = (Km) => SectionGround - Math.sqrt(Math.max(0, Math.min(100, Km)) / 100) * (SectionGround - SectionTop);
const Bands = [
  [0, 12, "troposphere", "#4f7fc4", 0.26],
  [12, 50, "stratosphere", "#3b5ea0", 0.14],
  [50, 85, "mesosphere", "#2c3f74", 0.12],
  [85, 100, "thermosphere", "#20284a", 0.12],
];
function CrossSection({ A }) {
  const Curve = (Scale, Strength) =>
    Array.from({ length: 81 }, (_, Step) => {
      const Km = (Step / 80) ** 2 * 100;
      return [34 + 164 * Math.min(1, Strength) * Math.exp((-Km * 1000) / Scale), AltY(Km)];
    })
      .map(([X, Y], Index) => (Index ? "L" : "M") + X.toFixed(1) + " " + Y.toFixed(1))
      .join("");
  // Sunbeam: straight in real space (horizontal run = height / tan elevation), so the root scale bends it; landing at x 128.
  const El = Math.max(4, A.SunElevation), Land = 128;
  const Run = 100 / Math.tan(El * Rad), Stretch = Math.min(1.6, (196 - Land) / Run);
  const Beam = Array.from({ length: 41 }, (_, Step) => {
    const Km = 100 * (1 - Step / 40);
    return [Land + (Km / Math.tan(El * Rad)) * Stretch, AltY(Km)];
  });
  const BeamPath = Beam.map(([X, Y], Index) => (Index ? "L" : "M") + X.toFixed(1) + " " + Y.toFixed(1)).join("");
  // Colour along the beam: sunlight after the slant path above each height.
  const Stops = [100, 40, 20, 10, 5, 2, 0].map((Km) => {
    const Above = (Scale) => Math.exp((-Km * 1000) / Scale);
    const Mass = AirMass(A.SunElevation);
    const Left = [0, 1, 2].map((Channel) => Math.exp(-(A.Medium.Rayleigh[Channel] * Above(A.RayleighH) + 1.11 * A.Medium.Mie * Above(A.MieH) + A.Medium.Ozone[Channel] * (Km > 30 ? 0.2 : 1)) * Mass));
    return [Km, Css(Develop(Left.map((Each) => Each * 0.95), 1.6))];
  });
  const OzoneOpacity = Math.min(0.6, 0.28 * (A.Ozone / 1.2));
  const TopKm = A.Top / 1000;
  return (
    <svg className="ac-figure" viewBox="0 0 240 236" role="img" aria-label="Cross-section of the atmosphere from the ground to 100 km" data-atmosphere-design="section">
      <defs>
        <linearGradient id="ac-beam" gradientUnits="userSpaceOnUse" x1="0" y1={AltY(100)} x2="0" y2={SectionGround}>
          {Stops.map(([Km, Colour]) => (
            <stop key={Km} offset={(AltY(Km) - AltY(100)) / (SectionGround - AltY(100))} stopColor={Colour} />
          ))}
        </linearGradient>
        <linearGradient id="ac-ozone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff9a4a" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ff9a4a" stopOpacity={OzoneOpacity} />
          <stop offset="1" stopColor="#ff9a4a" stopOpacity="0" />
        </linearGradient>
        <clipPath id="ac-clip">
          <rect width="240" height="236" rx="12" />
        </clipPath>
      </defs>
      <g clipPath="url(#ac-clip)">
        <rect width="240" height="236" fill="#07080c" />
        {Bands.map(([From, To, Name, Colour, Opacity]) => (
          <g key={Name} data-layer={Name}>
            <rect x="0" y={AltY(To)} width="240" height={AltY(From) - AltY(To)} fill={Colour} fillOpacity={Opacity} />
            <line x1="26" x2="240" y1={AltY(To)} y2={AltY(To)} stroke="#ffffff" strokeOpacity=".08" />
            <text x="234" y={AltY(To) + 9} textAnchor="end" className="ac-layer">{Name}</text>
          </g>
        ))}
        <rect x="26" y={AltY(35)} width="214" height={AltY(15) - AltY(35)} fill="url(#ac-ozone)" data-layer="ozone" />
        <text x="234" y={(AltY(35) + AltY(15)) / 2 + 3} textAnchor="end" className="ac-layer ac-ozone">ozone ×{A.Ozone.toFixed(2)}</text>
        <line x1="26" x2="240" y1={AltY(TopKm)} y2={AltY(TopKm)} stroke="#ffffff" strokeOpacity=".55" strokeDasharray="3 3" data-model-top="" />
        <text x="30" y={AltY(TopKm) - 3} className="ac-note">model top {TopKm.toFixed(0)} km</text>
        <path d={Curve(A.RayleighH, 1)} fill="none" stroke="#8fc0ff" strokeWidth={0.8 + Math.min(2.2, A.Rayleigh)} strokeOpacity=".9" data-density="molecules" />
        <path d={Curve(A.MieH, 1)} fill="none" stroke="#e6c48c" strokeWidth={0.8 + Math.min(2.2, A.Mie * 1.5)} strokeOpacity=".9" data-density="aerosols" />
        <text x={36 + 164 * Math.exp(-6000 / A.RayleighH)} y={AltY(6) - 3} className="ac-note" fill="#8fc0ff" style={{ fill: "#8fc0ff" }}>molecules</text>
        <text x={38 + 164 * Math.exp(-1500 / A.MieH)} y={AltY(1.5) + 9} className="ac-note" style={{ fill: "#e6c48c" }}>aerosols</text>
        <path d={BeamPath} fill="none" stroke="url(#ac-beam)" strokeWidth="4" strokeLinecap="round" data-sunbeam="" />
        <circle cx={Beam[0][0]} cy={Beam[0][1]} r="5" fill="#fffaf0" />
        <rect y={SectionGround} width="240" height={236 - SectionGround} fill={Css(A.Ground)} />
        <circle cx={Land} cy={SectionGround} r="3" fill={Stops.at(-1)[1]} stroke="#000" strokeOpacity=".4" />
        <line x1="26" x2="26" y1={SectionTop} y2={SectionGround} stroke="#ffffff" strokeOpacity=".3" />
        {[0, 2, 12, 30, 50, 85, 100].map((Km) => (
          <g key={Km}>
            <line x1="22" x2="26" y1={AltY(Km)} y2={AltY(Km)} stroke="#ffffff" strokeOpacity=".4" />
            <text x="20" y={AltY(Km) + 2.5} textAnchor="end" className="ac-axis">{Km}</text>
          </g>
        ))}
        <text x="4" y="8" className="ac-axis">km</text>
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------- B · planet limb
const Stars = (() => {
  let Seed = 11;
  const Next = () => ((Seed = (Seed * 48271) % 2147483647) / 2147483647);
  return Array.from({ length: 46 }, () => [Next() * 240, Next() * 112, 0.2 + Next() * 0.7, Next()]);
})();
function PlanetLimb({ A }) {
  const Cx = 120, Cy = 540, R = 420;
  const SurfaceTop = Cy - R;
  // Thickness on screen: the authored top over the planet radius, exaggerated so 60 km reads.
  const Exaggerate = 1.3 * (A.Planet / 6371) ** -0.5;
  const Thick = Math.max(8, Math.min(30, (A.Top / 1000) * 0.34 * Exaggerate));
  const LocalSun = (X) => 38 - (X / 240) * 64; // sun height at each point of the limb: day on the left, night on the right.
  const Steps = 13;
  const Light = Array.from({ length: Steps }, (_, Index) => {
    const X = (Index / (Steps - 1)) * 240, Se = LocalSun(X);
    const Scattered = SkyRadiance(A.Medium, Direction(1, 90), 1, Direction(Se, 0), Se).map((C) => C * (0.9 + 0.4 * A.Glow));
    const Band = Math.exp(-(((Se - 1) / 5) ** 2)) * 0.55 * A.Glow;
    const Through = A.Through(AirMass(Math.max(-1, Se)) * 0.7);
    return [X / 240, Css(Develop(Scattered.map((C, Channel) => C + Band * Through[Channel] * 2.2), 2.4))];
  });
  const Layers = 9;
  const Mixed = (A.RayleighH * A.Rayleigh + A.MieH * A.Mie * 0.6) / (A.Rayleigh + A.Mie * 0.6 + 1e-6);
  const Terminator = (38 / 64) * 240;
  const ArcAt = (Radius) => {
    const Half = Math.sqrt(Math.max(0, Radius * Radius - (Cy - 160) ** 2));
    return `M${Cx - Half} 160A${Radius} ${Radius} 0 0 1 ${Cx + Half} 160`;
  };
  const LimbY = (X) => Cy - Math.sqrt(R * R - (X - Cx) ** 2);
  return (
    <svg className="ac-figure" viewBox="0 0 240 160" role="img" aria-label="The planet's limb from orbit" data-atmosphere-design="limb">
      <defs>
        <linearGradient id="ac-limb" x1="0" x2="1">
          {Light.map(([At, Colour]) => (
            <stop key={At} offset={At} stopColor={Colour} />
          ))}
        </linearGradient>
        <linearGradient id="ac-surface" x1="0" x2="1">
          <stop offset="0" stopColor={Css(A.Ground.map((C) => Math.round(C * 0.75)))} />
          <stop offset={Terminator / 240 - 0.08} stopColor={Css(A.Ground.map((C) => Math.round(C * 0.42)))} />
          <stop offset={Terminator / 240 + 0.06} stopColor="#0a0a0d" />
          <stop offset="1" stopColor="#040406" />
        </linearGradient>
        <radialGradient id="ac-sun" cx="0" cy="0.2" r="0.6">
          <stop offset="0" stopColor="#fff6e2" stopOpacity=".55" />
          <stop offset="1" stopColor="#fff6e2" stopOpacity="0" />
        </radialGradient>
        <clipPath id="ac-limb-clip">
          <rect width="240" height="160" rx="12" />
        </clipPath>
      </defs>
      <g clipPath="url(#ac-limb-clip)">
        <rect width="240" height="160" fill="#020203" />
        {Stars.map(([X, Y, Size, Twinkle], Index) => (
          <circle key={Index} cx={X} cy={Y} r={Size} fill="#fff" opacity={X < Terminator ? 0.12 + Twinkle * 0.2 : 0.3 + Twinkle * 0.6} />
        ))}
        <rect width="240" height="160" fill="url(#ac-sun)" />
        {Array.from({ length: Layers }, (_, Index) => {
          const Height = (Index + 0.5) / Layers;
          const Density = Math.exp((-Height * A.Top) / Mixed);
          return <path key={Index} d={ArcAt(R + Height * Thick)} fill="none" stroke="url(#ac-limb)" strokeWidth={Thick / Layers + 0.6} strokeOpacity={Math.min(1, 0.08 + Density * 1.25)} />;
        })}
        <path d={ArcAt(R + 1.2)} fill="none" stroke="url(#ac-limb)" strokeWidth="2.4" strokeOpacity={Math.min(1, 0.4 + A.Mie * 0.4)} data-haze-line="" />
        <circle cx={Cx} cy={Cy} r={R} fill="url(#ac-surface)" />
        <text x="10" y="18" className="ac-note">day side · sun {Math.round(LocalSun(10))}°</text>
        <line x1={Terminator} x2={Terminator} y1={LimbY(Terminator) - Thick - 4} y2="40" stroke="#ffffff" strokeOpacity=".35" strokeDasharray="2 2" />
        <text x={Terminator} y="35" textAnchor="middle" className="ac-note">sunset band</text>
        <text x="232" y="18" textAnchor="end" className="ac-note">night</text>
        <g data-thickness="">
          <line x1="226" x2="226" y1={LimbY(226)} y2={LimbY(226) - Thick} stroke="#ffffff" strokeOpacity=".6" />
          <text x="222" y={LimbY(226) - Thick - 4} textAnchor="end" className="ac-note">{(A.Top / 1000).toFixed(0)} km, drawn ×{Math.round(Thick / (((A.Top / 1000) * R) / A.Planet))}</text>
        </g>
      </g>
    </svg>
  );
}

// ----------------------------------------------------------------------------------------------------------------- C · scattering
const Parcel = [104, 74], ParcelR = 24;
const Speckles = (() => {
  let Seed = 3;
  const Next = () => ((Seed = (Seed * 69621) % 2147483647) / 2147483647);
  return Array.from({ length: 60 }, () => {
    const A = Next() * 2 * Math.PI, D = Math.sqrt(Next()) * (ParcelR - 3);
    return [Parcel[0] + Math.cos(A) * D, Parcel[1] + Math.sin(A) * D];
  });
})();
function Scattering({ A }) {
  const Molecules = Math.max(4, Math.min(40, Math.round(14 * A.Rayleigh)));
  const Aerosols = Math.max(1, Math.min(18, Math.round(6 * A.Mie)));
  const Lobe = (At) =>
    Array.from({ length: 73 }, (_, Step) => {
      const Theta = (Step / 72) * 2 * Math.PI, Reach = At(Math.cos(Theta));
      return [Parcel[0] + Math.cos(Theta) * Reach, Parcel[1] + Math.sin(Theta) * Reach];
    })
      .map(([X, Y], Index) => (Index ? "L" : "M") + X.toFixed(1) + " " + Y.toFixed(1))
      .join("") + "Z";
  const RayleighSize = 8 + 9 * Math.min(2, A.Rayleigh);
  const G = Math.max(0, Math.min(0.95, A.Lean));
  const Hg = (Cos) => (1 - G * G) / Math.pow(1 + G * G - 2 * G * Cos, 1.5);
  const MieScale = (26 + 36 * Math.min(1.5, A.Mie)) / Hg(1);
  const Leftover = A.Sunlight(1.5);
  const Blue = A.Sky(70, 180);
  return (
    <svg className="ac-figure" viewBox="0 0 240 150" role="img" aria-label="How a sunbeam scatters in a parcel of air" data-atmosphere-design="scatter">
      <defs>
        <linearGradient id="ac-out" gradientUnits="userSpaceOnUse" x1={Parcel[0] + ParcelR} x2="236" y1="0" y2="0">
          <stop offset="0" stopColor="#fffaf0" />
          <stop offset="1" stopColor={Leftover} />
        </linearGradient>
        <clipPath id="ac-scatter-clip">
          <rect width="240" height="150" rx="12" />
        </clipPath>
        <marker id="ac-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 0L6 3L0 6z" fill={Blue} />
        </marker>
      </defs>
      <g clipPath="url(#ac-scatter-clip)">
        <rect width="240" height="150" fill="#08090d" />
        <circle cx="16" cy={Parcel[1]} r="9" fill="#fffaf0" />
        {Array.from({ length: 8 }, (_, Index) => {
          const Angle = (Index / 8) * 2 * Math.PI;
          return <line key={Index} x1={16 + Math.cos(Angle) * 12} y1={Parcel[1] + Math.sin(Angle) * 12} x2={16 + Math.cos(Angle) * 15} y2={Parcel[1] + Math.sin(Angle) * 15} stroke="#fffaf0" strokeWidth="1.2" strokeLinecap="round" />;
        })}
        <line x1="30" x2={Parcel[0] - ParcelR} y1={Parcel[1]} y2={Parcel[1]} stroke="#fffaf0" strokeWidth="5" />
        <line x1={Parcel[0] + ParcelR} x2="236" y1={Parcel[1]} y2={Parcel[1]} stroke="url(#ac-out)" strokeWidth={5 * Math.max(0.35, 1 - A.Depth[2] * 1.4)} data-leftover="" />
        <path d={Lobe((Cos) => ParcelR + 3 + RayleighSize * 0.5 * (1 + Cos * Cos))} fill="#6fa8ff" fillOpacity=".16" stroke="#8fc0ff" strokeWidth="1.1" data-lobe="rayleigh" />
        <path d={Lobe((Cos) => ParcelR + 2 + Math.min(100, MieScale * Hg(Cos)))} fill="#e6c48c" fillOpacity=".12" stroke="#e6c48c" strokeWidth="1.1" data-lobe="mie" />
        <circle cx={Parcel[0]} cy={Parcel[1]} r={ParcelR} fill="#0d0f15" stroke="#ffffff" strokeOpacity=".35" strokeDasharray="2 2" />
        {Speckles.slice(0, Molecules).map(([X, Y], Index) => (
          <circle key={"m" + Index} cx={X} cy={Y} r="1" fill="#8fc0ff" />
        ))}
        {Speckles.slice(40, 40 + Aerosols).map(([X, Y], Index) => (
          <circle key={"a" + Index} cx={X + 1} cy={Y - 1} r="2.4" fill="#e6c48c" />
        ))}
        {[-60, -90, -120].map((Angle) => (
          <line key={Angle} x1={Parcel[0] + Math.cos(Angle * Rad) * (ParcelR + 4)} y1={Parcel[1] + Math.sin(Angle * Rad) * (ParcelR + 4)} x2={Parcel[0] + Math.cos(Angle * Rad) * (ParcelR + 26)} y2={Parcel[1] + Math.sin(Angle * Rad) * (ParcelR + 26)} stroke={Blue} strokeWidth="1.6" markerEnd="url(#ac-arrow)" />
        ))}
        <text x={Parcel[0]} y="12" textAnchor="middle" className="ac-note">blue scattered every way → the sky</text>
        <text x="236" y={Parcel[1] - 9} textAnchor="end" className="ac-note">forward haze</text>
        <text x="236" y={Parcel[1] + 16} textAnchor="end" className="ac-note">what's left → sunset light</text>
        <text x="10" y="142" className="ac-note">
          <tspan fill="#8fc0ff">● molecules ×{A.Rayleigh.toFixed(2)}</tspan>
          <tspan dx="8" fill="#e6c48c">● aerosols ×{A.Mie.toFixed(2)} · g {G.toFixed(2)}</tspan>
        </text>
      </g>
    </svg>
  );
}

// ------------------------------------------------------------------------------------------------------------------------ the card
export default function AtmosphereCard({ V, Change }) {
  const A = AtmosphereFigures(V);
  const Design = AtmosphereDesigns.some(([Id]) => Id === V("Atmosphere card design")) ? V("Atmosphere card design") : "section";
  const Ground = Math.round(100 * (A.Through(1)[1]));
  const Swatches =
    Design === "limb"
      ? [["Day limb", A.SkyAt(1, 90, 30)], ["Sunset band", A.Sunlight(0.5)], ["Overhead", A.Sky(90, 0)]]
      : Design === "scatter"
        ? [["Overhead", A.Sky(90, 0)], ["Horizon", A.Sky(3, 150)], ["Near the sun", A.Sky(Math.max(2, A.SunElevation - 4), 0)], ["Sunset", A.SkyAt(3, 0, 0.5)]]
        : [["At the ground", A.Sunlight(A.SunElevation)], ["Overhead", A.Sky(90, 0)], ["Horizon", A.Sky(3, 180)]];
  return (
    <section className="property-card atmosphere-card" data-card="Atmosphere overview" data-design={Design}>
      <header className="atmosphere-card-head">
        <h3>Atmosphere overview</h3>
        <div className="atmosphere-card-designs" role="radiogroup" aria-label="Card design">
          {AtmosphereDesigns.map(([Id, Letter, Name]) => (
            <button key={Id} type="button" role="radio" aria-checked={Design === Id} aria-label={`${Letter} · ${Name}`} title={Name} data-atmosphere-design-pick={Id} onClick={() => Change("Atmosphere card design", Id)}>
              {Letter}
            </button>
          ))}
        </div>
      </header>
      {Design === "section" && <CrossSection A={A} />}
      {Design === "limb" && <PlanetLimb A={A} />}
      {Design === "scatter" && <Scattering A={A} />}
      <div className="atmosphere-card-swatches">
        {Swatches.map(([Label, Colour]) => (
          <div key={Label} data-swatch={Label}>
            <i style={{ background: Colour }} />
            <span>{Label}</span>
          </div>
        ))}
      </div>
      <div className="atmosphere-card-figures">
        <div data-figure="depth"><small>Depth</small><b>{A.Depth[1].toFixed(3)}</b><span>optical, green, straight up</span></div>
        <div data-figure="clear"><small>Through</small><b>{Ground}%</b><span>of green, sun overhead</span></div>
        <div data-figure="heights"><small>Heights</small><b>{(A.RayleighH / 1000).toFixed(1)} / {(A.MieH / 1000).toFixed(1)}</b><span>km scale, air / haze</span></div>
      </div>
      <label className="atmosphere-card-sun">
        <span>Preview sun</span>
        <input type="range" min={-12} max={90} step={0.5} value={A.SunElevation} aria-label="Preview sun height" onChange={(Event) => Change("Sky preview elevation", +Event.target.value)} />
        <b>{A.SunElevation.toFixed(1)}°</b>
      </label>
    </section>
  );
}
