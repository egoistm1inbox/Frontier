// Follow-up 43: one preview per Atmosphere card, each its own kind of picture instead of a shared line chart. They
// edit the same authored fields as the controls under them. Colours are illustrative single-scatter estimates in the
// browser, not the native atmosphere march.
import React from "react";
import { Limit, SvgPoint, DragProps, SliderKeys, StudyFacts, HexRgb, Css } from "./SunStudies.jsx";
import "./SkyStudies.css";

// Relative scattering per channel (red, green, blue), the same weights AtmosphereLab uses.
const Weights = [0.43, 1, 2.23];
const Mix = (A, B, T) => A.map((C, Channel) => C + (B[Channel] - C) * T);
const Bright = (Rgb, Peak = 0.82) => {
  const Top = Math.max(...Rgb, 1e-6);
  return Rgb.map((C) => (C / Top) * Peak);
};

// Atmospheric scattering: a beam of white sunlight crossing one path of air. Blue is knocked sideways first (the glow
// around the beam is the sky colour); what survives to the far end is the reddened sun. Drag to move the probe.
export function AirBeam({ V, Change }) {
  const Rayleigh = V("Rayleigh"), Mie = V("Mie");
  const Probe = Limit(V("Atmosphere probe beam") ?? 0.5, 0, 1);
  const Depth = (Channel) => 0.9 * Rayleigh * Weights[Channel] + 0.22 * Mie;
  const Through = (Along) => Weights.map((_, Channel) => Math.exp(-Depth(Channel) * Along));
  const Scatter = (Along) => {
    const Survive = Through(Along);
    return Weights.map((Weight, Channel) => (Survive[Channel] * (0.9 * Rayleigh * Weight + 0.22 * Mie)) / (0.9 * 2.23 + 0.22));
  };
  const Left = 30, Right = 266, Count = 30, Step = (Right - Left) / Count;
  const Across = (Along) => Left + Along * (Right - Left);
  const Set = (Next) => Change("Atmosphere probe beam", Math.round(Limit(Next, 0, 1) * 100) / 100);
  const Sky = Scatter(Probe), Sun = Through(Probe);
  return (
    <>
      <div className="study-head">
        <span>
          Rayleigh <b>{Rayleigh.toFixed(2)} ×</b>
        </span>
        <span>blue scatters ~5× red</span>
      </div>
      <svg
        className="sky-study air-beam"
        viewBox="0 0 280 150"
        role="slider"
        tabIndex={0}
        aria-label="Scattering probe along the beam"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Probe}
        onKeyDown={SliderKeys(Probe, 0, 1, 0.02, 0.1, Set)}
        {...DragProps((X) => Set((X - Left) / (Right - Left)))}
      >
        <defs>
          <linearGradient id="beam-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset=".5" stopColor="#ffffff" stopOpacity=".95" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <mask id="beam-mask">
            <rect x="0" y="14" width="280" height="104" fill="url(#beam-fade)" />
          </mask>
          <radialGradient id="beam-sun">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width="280" height="132" rx="10" fill="#08090c" />
        <g mask="url(#beam-mask)">
          {Array.from({ length: Count }, (_, At) => (
            <rect key={At} x={Left + At * Step} y="14" width={Step + 0.5} height="104" fill={Css(Scatter((At + 0.5) / Count))} fillOpacity=".75" />
          ))}
        </g>
        {Array.from({ length: Count }, (_, At) => (
          <rect key={At} x={Left + At * Step} y="61" width={Step + 0.5} height="10" fill={Css(Through((At + 0.5) / Count))} data-beam-segment="" />
        ))}
        {Array.from({ length: 9 }, (_, At) => {
          const Along = (At + 0.5) / 9, X = Across(Along), Tint = Css(Scatter(Along), 1.1);
          return (
            <g key={At} stroke={Tint} strokeOpacity=".7">
              <line x1={X} y1="58" x2={X - 6} y2="40" />
              <line x1={X} y1="74" x2={X + 6} y2="92" />
            </g>
          );
        })}
        <circle cx="16" cy="66" r="18" fill="url(#beam-sun)" />
        <circle cx="16" cy="66" r="7" fill="#ffffff" />
        <line x1={Across(Probe)} x2={Across(Probe)} y1="18" y2="118" stroke="#ffffff" strokeOpacity=".7" strokeDasharray="2 3" />
        <circle cx={Across(Probe)} cy="66" r="6" fill="none" stroke="#ffffff" strokeWidth="1.5" />
        <text x="8" y="126" className="study-faint">white sunlight in</text>
        <text x="272" y="126" textAnchor="end" className="study-faint">after one path of air</text>
        <text x="272" y="26" textAnchor="end" className="study-faint">glow = light scattered sideways</text>
        <text x={Across(Probe)} y="146" textAnchor="middle" className="study-strong">{Math.round(Probe * 100)}% along</text>
      </svg>
      <StudyFacts
        Items={[
          ["Side glow", "sky", Css(Bright(Sky))],
          ["Through", Math.round((100 * (Sun[0] + Sun[1] + Sun[2])) / 3) + "%", Css(Sun)],
          ["Far end", "sun", Css(Bright(Through(1)))],
        ]}
      />
    </>
  );
}

// Aerosol haze: five ridges at growing distance, each washed toward the haze colour by exp(−0.2 × Mie × distance),
// and the Mie phase lobe showing how strongly aerosols throw light forward (Mie Anisotropy). Drag the lobe to change it.
const Ridges = [1, 2.5, 4.5, 7, 10];
export function HazeRidges({ V, Change }) {
  const Mie = V("Mie"), Lean = V("Mie Anisotropy") ?? 0.78;
  const Clear = [0.36, 0.52, 0.76], Milk = [0.74, 0.77, 0.8], Land = [0.12, 0.15, 0.12];
  const Sky = Mix(Clear, Milk, 1 - Math.exp(-0.45 * Mie));
  const Fade = (Distance) => 1 - Math.exp(-0.2 * Mie * Distance);
  const Ridge = (Index) => {
    const Base = 108 - (Ridges.length - 1 - Index) * 14, Seed = Index * 1.7 + 0.4;
    const Points = Array.from({ length: 29 }, (_, Step) => {
      const X = (Step / 28) * 280;
      return [X, Base - 10 - 7 * Math.sin(X / 37 + Seed) - 5 * Math.sin(X / 13 + Seed * 2.3) - Index * 2];
    });
    return "M0 118" + Points.map(([X, Y]) => "L" + X.toFixed(1) + " " + Y.toFixed(1)).join("") + "L280 118Z";
  };
  const Visible = Mie > 0 ? 3.912 / (0.2 * Mie) : Infinity;
  // Henyey-Greenstein lobe on a three-decade log radius so the back lobe stays visible.
  const Phase = (Angle) => (1 - Lean * Lean) / Math.pow(1 + Lean * Lean - 2 * Lean * Math.cos(Angle), 1.5);
  const Peak = Phase(0);
  const Cx = 110, Cy = 186, Reach = 46;
  const Lobe =
    Array.from({ length: 145 }, (_, Step) => {
      const Angle = (Step / 144) * 2 * Math.PI, Size = Reach * Math.max(0.06, 1 + Math.log10(Phase(Angle) / Peak) / 3);
      return (Step ? "L" : "M") + (Cx + Size * Math.cos(Angle)).toFixed(1) + " " + (Cy + Size * Math.sin(Angle)).toFixed(1);
    }).join("") + "Z";
  const SetLean = (Next) => Change("Mie Anisotropy", Math.round(Limit(Next, 0, 0.99) * 1000) / 1000);
  return (
    <>
      <svg className="sky-study haze-ridges" viewBox="0 0 280 236" aria-label="Haze over distance and the aerosol phase lobe">
        <defs>
          <clipPath id="haze-clip">
            <rect x="0" y="0" width="280" height="118" rx="10" />
          </clipPath>
        </defs>
        <g clipPath="url(#haze-clip)">
          <rect x="0" y="0" width="280" height="118" fill={Css(Sky)} />
          {Ridges.map((Distance, Index) => (
            <path key={Distance} d={Ridge(Ridges.length - 1 - Index)} fill={Css(Mix(Land, Sky, Fade(Distance)))} data-ridge={Distance} />
          )).reverse()}
        </g>
        {Ridges.map((Distance, Index) => (
          <text key={Distance} x={14 + Index * 56} y="132" className="study-faint">
            {Distance} · {Math.round(100 * (1 - Fade(Distance)))}%
          </text>
        ))}
        <text x="8" y="14" className="study-faint" style={{ fill: "#1a1d22" }}>
          DISTANCE · CONTRAST LEFT
        </text>
        <line x1="0" x2="280" y1="142" y2="142" stroke="#ffffff" strokeOpacity=".06" />
        <g
          role="slider"
          tabIndex={0}
          aria-label="Mie anisotropy lobe"
          aria-valuemin={0}
          aria-valuemax={0.99}
          aria-valuenow={Lean}
          onKeyDown={SliderKeys(Lean, 0, 0.99, 0.01, 0.1, SetLean)}
          {...DragProps((X) => SetLean((X - 60) / 200))}
          className="study-grab"
        >
          <rect x="0" y="146" width="280" height="90" fill="transparent" />
          <line x1="14" x2={Cx - 6} y1={Cy} y2={Cy} stroke="#fff3d6" strokeOpacity=".7" />
          <path d={`M${Cx - 12} ${Cy - 4}L${Cx - 5} ${Cy}L${Cx - 12} ${Cy + 4}`} fill="none" stroke="#fff3d6" strokeOpacity=".7" />
          <circle cx="14" cy={Cy} r="4" fill="#fff3d6" />
          <circle cx={Cx} cy={Cy} r={Reach} fill="none" stroke="#ffffff" strokeOpacity=".08" strokeDasharray="2 3" />
          <path d={Lobe} fill="#cbbd9b" fillOpacity=".22" stroke="#cbbd9b" strokeWidth="1.3" data-lobe="" />
          <circle cx={Cx} cy={Cy} r="2.5" fill="#f2f2f2" />
          <text x="10" y="160" className="study-faint">WHERE AEROSOLS THROW LIGHT · LOG</text>
          <text x="272" y="176" textAnchor="end" className="study-strong">g {Lean.toFixed(2)}</text>
          <text x="272" y="190" textAnchor="end">{Lean > 0.6 ? "bright glow around the sun" : Lean > 0.25 ? "soft forward glow" : "light spread evenly"}</text>
          <text x="272" y="228" textAnchor="end" className="study-faint">drag sideways · 0 even, 0.99 forward</text>
        </g>
      </svg>
      <StudyFacts
        Items={[
          ["Mie", Mie.toFixed(2) + " ×"],
          ["Fades by", Visible === Infinity ? "never" : Visible.toFixed(1) + " path"],
          ["Haze", "sky", Css(Sky)],
        ]}
      />
    </>
  );
}

// Ozone absorption: ozone is why the sky overhead stays blue after sunset. Two twilight skies with the sun 3° below
// the horizon, one without ozone and one with the authored amount, over the visible spectrum with the Chappuis band
// taken out. Drag the dip up or down to set Ozone.
const Chappuis = [0.55, 0.9, 0.05];
function Twilight(Ozone) {
  const Overhead = Weights.map((Weight, Channel) => Weight * Math.exp(-1.2 * Weight) * Math.exp(-Ozone * Chappuis[Channel] * 1.6));
  const Low = Weights.map((Weight, Channel) => Math.exp(-2.5 * Weight) * Math.exp(-Ozone * Chappuis[Channel] * 0.6));
  return { Overhead: Bright(Overhead, 0.62), Middle: Bright(Mix(Overhead, Low.map((C) => C * 0.5), 0.5), 0.5), Low: Bright(Low, 0.85) };
}
function Spectral(Wavelength) {
  const L = Wavelength;
  let Rgb = L < 440 ? [(440 - L) / 60, 0, 1] : L < 490 ? [0, (L - 440) / 50, 1] : L < 510 ? [0, 1, (510 - L) / 20] : L < 580 ? [(L - 510) / 70, 1, 0] : L < 645 ? [1, (645 - L) / 65, 0] : [1, 0, 0];
  const Edge = L < 420 ? 0.3 + (0.7 * (L - 380)) / 40 : L > 700 ? 0.3 + (0.7 * (780 - L)) / 80 : 1;
  return Rgb.map((C) => C * Edge);
}
export function OzoneZenith({ V, Change }) {
  const Ozone = V("Ozone");
  const Panels = [
    [0, "WITHOUT OZONE", Twilight(0)],
    [144, "OZONE " + Ozone.toFixed(2) + " ×", Twilight(Ozone)],
  ];
  const Keep = (Wavelength) => Math.exp(-Ozone * 0.9 * Math.exp(-(((Wavelength - 600) / 70) ** 2)));
  const Top = 138, Depth = 40;
  const Across = (Wavelength) => 10 + ((Wavelength - 380) / 400) * 260;
  const Curve = Array.from({ length: 81 }, (_, Step) => {
    const Wavelength = 380 + Step * 5;
    return (Step ? "L" : "M") + Across(Wavelength).toFixed(1) + " " + (Top + Depth * (1 - Keep(Wavelength))).toFixed(1);
  }).join("");
  const SetOzone = (Next) => Change("Ozone", Math.round(Limit(Next, 0, 4) * 100) / 100);
  const FromY = (Y) => -Math.log(Math.max(0.01, 1 - Limit((Y - Top) / Depth, 0, 0.99))) / 0.9;
  return (
    <>
      <svg className="sky-study ozone-zenith" viewBox="0 0 280 200" aria-label="Twilight sky with and without ozone">
        <defs>
          {Panels.map(([X, , Sky], At) => (
            <linearGradient key={At} id={"ozone-sky-" + At} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={Css(Sky.Overhead)} />
              <stop offset=".6" stopColor={Css(Sky.Middle)} />
              <stop offset="1" stopColor={Css(Sky.Low)} />
            </linearGradient>
          ))}
        </defs>
        {Panels.map(([X, Label], At) => (
          <g key={At}>
            <rect x={X} y="0" width="136" height="104" rx="10" fill={`url(#ozone-sky-${At})`} data-ozone-sky={At} />
            <rect x={X} y="90" width="136" height="14" fill="#07080a" />
            <text x={X + 8} y="14" className="study-faint" style={{ fill: "#e6e8ec" }}>{Label}</text>
          </g>
        ))}
        <text x="0" y="118" className="study-faint">sun 3° below the horizon · overhead colour</text>
        <g
          role="slider"
          tabIndex={0}
          aria-label="Ozone absorption depth"
          aria-valuemin={0}
          aria-valuemax={4}
          aria-valuenow={Ozone}
          onKeyDown={SliderKeys(Ozone, 0, 4, 0.05, 0.5, SetOzone)}
          {...DragProps((_, Y) => SetOzone(FromY(Y)))}
          className="study-grab"
        >
          <rect x="0" y="124" width="280" height="76" fill="transparent" />
          {Array.from({ length: 80 }, (_, Step) => {
            const Wavelength = 382.5 + Step * 5;
            return (
              <g key={Step}>
                <rect x={Across(Wavelength - 2.5)} y={Top} width="3.9" height={Depth} fill={Css(Spectral(Wavelength), 0.28)} />
                <rect x={Across(Wavelength - 2.5)} y={Top} width="3.9" height={Depth * Keep(Wavelength)} fill={Css(Spectral(Wavelength), 0.9)} />
              </g>
            );
          })}
          <path d={Curve} fill="none" stroke="#ffffff" strokeOpacity=".85" strokeWidth="1.2" data-series="" />
          <circle cx={Across(600)} cy={Top + Depth * (1 - Keep(600))} r="5" fill="#f2f2f2" />
          {[400, 500, 600, 700].map((Wavelength) => (
            <text key={Wavelength} x={Across(Wavelength)} y={Top + Depth + 12} textAnchor="middle" className="study-faint">
              {Wavelength}
            </text>
          ))}
          <text x="280" y={Top + Depth + 12} textAnchor="end" className="study-faint">nm</text>
          <text x={Across(600)} y={Top - 4} textAnchor="middle" className="study-strong">
            Chappuis band · {Math.round(100 * (1 - Keep(600)))}% taken
          </text>
        </g>
      </svg>
      <p className="study-note">Drag the dip to set Ozone. Illustrative band shape, not a calibrated cross-section.</p>
    </>
  );
}

// Density falloff: the air column from the ground to the top of the atmosphere (square-root altitude scale so the
// low aerosol layer is readable). Each column fades as exp(−altitude / scale height); drag the handles to set them.
const Landmarks = [
  [8849, "Everest"],
  [11000, "airliner"],
  [25000, "ozone layer"],
  [50000, "stratopause"],
  [100000, "Kármán line"],
];
export function AltitudeColumn({ V, Change }) {
  const Top = V("Atmosphere") ?? 60000, Molecules = V("Rayleigh Scale H"), Aerosols = V("Mie Scale H");
  const Floor = 214, Ceiling = 20, Span = Floor - Ceiling;
  const Y = (Height) => Floor - Math.sqrt(Limit(Height / Top, 0, 1)) * Span;
  const Back = (At) => Top * ((Floor - Limit(At, Ceiling, Floor)) / Span) ** 2;
  const Columns = [
    ["Rayleigh Scale H", "MOLECULES", Molecules, 64, "157,189,214", [2000, 15000], 100],
    ["Mie Scale H", "AEROSOLS", Aerosols, 136, "210,184,141", [300, 4000], 50],
  ];
  const Slices = 60;
  const Kilometres = (Height) => (Height >= 10000 ? (Height / 1000).toFixed(0) : (Height / 1000).toFixed(1)) + " km";
  return (
    <>
      <svg className="sky-study altitude-column" viewBox="0 0 280 236" aria-label="Air density with altitude">
        <rect x="0" y={Ceiling - 6} width="280" height={Floor - Ceiling + 6} rx="8" fill="#0b0d11" />
        {[1000, 2000, 5000, 10000, 20000, 40000, 80000].filter((Height) => Height < Top).map((Height) => (
          <g key={Height}>
            <line x1="40" x2="46" y1={Y(Height)} y2={Y(Height)} stroke="#ffffff" strokeOpacity=".35" />
            <text x="36" y={Y(Height) + 3} textAnchor="end" className="study-faint">{Height / 1000}</text>
          </g>
        ))}
        <text x="36" y={Floor + 3} textAnchor="end" className="study-faint">0</text>
        <text x="8" y="12" className="study-faint">km</text>
        <line x1="46" x2="46" y1={Ceiling} y2={Floor} stroke="#ffffff" strokeOpacity=".2" />
        {Columns.map(([Field, Label, Scale, X, Rgb, [Low, High], Step]) => {
          const Set = (Next) => Change(Field, Math.round(Limit(Next, Low, High)));
          return (
            <g
              key={Field}
              role="slider"
              tabIndex={0}
              aria-label={Field + " handle"}
              aria-valuemin={Low}
              aria-valuemax={High}
              aria-valuenow={Scale}
              onKeyDown={SliderKeys(Scale, Low, High, Step, Step * 10, Set)}
              {...DragProps((_, At) => Set(Back(At)))}
              className="study-grab"
            >
              {Array.from({ length: Slices }, (_, At) => {
                const A = Top * (At / Slices) ** 2, B = Top * ((At + 1) / Slices) ** 2;
                return <rect key={At} x={X} y={Y(B)} width="56" height={Y(A) - Y(B) + 0.4} fill={`rgb(${Rgb})`} fillOpacity={0.92 * Math.exp(-(A + B) / 2 / Scale)} />;
              })}
              <rect x={X} y={Ceiling} width="56" height={Span} fill="none" stroke="#ffffff" strokeOpacity=".08" />
              <line x1={X - 4} x2={X + 60} y1={Y(Scale)} y2={Y(Scale)} stroke="#ffffff" strokeDasharray="3 2" strokeOpacity=".8" />
              <circle cx={X + 60} cy={Y(Scale)} r="5.5" fill="#f2f2f2" />
              <text x={X + 28} y={Floor + 12} textAnchor="middle" className="study-faint">{Label}</text>
              <text x={X + 28} y={Y(Scale) - 5} textAnchor="middle" className="study-strong">{Kilometres(Scale)}</text>
            </g>
          );
        })}
        {Landmarks.filter(([Height]) => Height < Top).map(([Height, Name]) => (
          <g key={Name}>
            <line x1="206" x2="214" y1={Y(Height)} y2={Y(Height)} stroke="#ffffff" strokeOpacity=".4" />
            <text x="218" y={Y(Height) + 3} className="study-faint">{Name}</text>
          </g>
        ))}
        <line x1="46" x2="280" y1={Ceiling} y2={Ceiling} stroke="#ffffff" strokeOpacity=".3" strokeDasharray="1 3" />
        <text x="276" y={Ceiling - 9} textAnchor="end" className="study-faint">top of atmosphere {Kilometres(Top)}</text>
      </svg>
      <StudyFacts
        Items={[
          ["Half air", "< " + Kilometres(Molecules * Math.LN2)],
          ["Half haze", "< " + Kilometres(Aerosols * Math.LN2)],
          ["At H", "37% left"],
        ]}
      />
      <p className="study-note">Drag a handle to set its scale height. Square-root altitude scale.</p>
    </>
  );
}

// Ground reflectance: a white ball standing on the ground, its underside lit by light bouncing off the ground colour,
// next to a reflectance scale with familiar surfaces for reference (not presets; the colour field sets the ground).
const Surfaces = [
  [0.85, "fresh snow"],
  [0.4, "desert sand"],
  [0.25, "grass"],
  [0.07, "asphalt"],
];
const Linear = (C) => (C <= 0.04045 ? C / 12.92 : ((C + 0.055) / 1.055) ** 2.4);
export function GroundBounce({ V }) {
  const Ground = HexRgb(V("Ground Albedo")), Lit = Ground.map(Linear);
  const Reflect = 0.2126 * Lit[0] + 0.7152 * Lit[1] + 0.0722 * Lit[2];
  const Scale = (Amount) => 128 - Math.sqrt(Limit(Amount, 0, 1)) * 112;
  const Bounce = Css(Ground, Limit(0.4 + Reflect * 2.2, 0, 1.2));
  return (
    <svg className="sky-study ground-bounce" viewBox="0 0 280 140" aria-label="Light bounced from the ground">
      <defs>
        <linearGradient id="bounce-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4f79ad" />
          <stop offset="1" stopColor="#a8c2db" />
        </linearGradient>
        <linearGradient id="bounce-ball" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbf6ec" />
          <stop offset=".55" stopColor="#8d9099" />
          <stop offset="1" stopColor={Bounce} />
        </linearGradient>
        <clipPath id="bounce-clip">
          <rect x="0" y="0" width="176" height="140" rx="10" />
        </clipPath>
      </defs>
      <g clipPath="url(#bounce-clip)">
        <rect x="0" y="0" width="176" height="80" fill="url(#bounce-sky)" />
        <path d="M0 80 L176 80 L176 140 L0 140Z" fill={Css(Ground)} data-ground="" />
        <path d="M0 80 L176 80 L176 92 L0 92Z" fill="#ffffff" fillOpacity=".06" />
        <ellipse cx="88" cy="112" rx="34" ry="6" fill="#000000" fillOpacity=".4" />
        <circle cx="88" cy="78" r="32" fill="url(#bounce-ball)" />
        <circle cx="88" cy="78" r="32" fill={Bounce} fillOpacity={Limit(Reflect * 1.4, 0.05, 0.45)} clipPath="none" style={{ mixBlendMode: "soft-light" }} />
        {[-18, 0, 18].map((Shift) => (
          <g key={Shift} stroke={Css(Ground, 1.5)} strokeOpacity={Limit(0.25 + Reflect * 2, 0.25, 0.95)}>
            <line x1={88 + Shift * 1.8} y1="132" x2={88 + Shift * 0.8} y2="114" />
            <path d={`M${88 + Shift * 0.8 - 3} ${118}L${88 + Shift * 0.8} ${114}L${88 + Shift * 0.8 + 3} ${118}`} fill="none" />
          </g>
        ))}
        <text x="8" y="14" className="study-faint" style={{ fill: "#1b2533" }}>BOUNCE LIGHT</text>
      </g>
      <line x1="196" x2="196" y1="16" y2="128" stroke="#ffffff" strokeOpacity=".25" />
      {Surfaces.map(([Amount, Name]) => (
        <g key={Name}>
          <line x1="192" x2="200" y1={Scale(Amount)} y2={Scale(Amount)} stroke="#ffffff" strokeOpacity=".35" />
          <text x="206" y={Scale(Amount) + 3} className="study-faint">
            {Name} {Math.round(Amount * 100)}%
          </text>
        </g>
      ))}
      <rect x="186" y={Scale(Reflect) - 5} width="20" height="10" rx="3" fill={Css(Ground)} stroke="#f2f2f2" strokeWidth="1.5" data-reflectance="" />
      <text x="182" y={Scale(Reflect) + 3} textAnchor="end" className="study-strong">{Math.round(Reflect * 100)}%</text>
      <text x="196" y="10" textAnchor="middle" className="study-faint">reflects</text>
    </svg>
  );
}

// Native atmosphere controls: the horizon at dusk with the authored glow, the white line, sky tint and brightness.
export function TwilightBand({ V }) {
  const Glow = V("Horizon Glow") ?? 1, Line = V("White Line") ?? 1, Gain = V("Sky Brightness") ?? 1;
  const Tint = HexRgb(V("Sky Tint") ?? "#ffffff");
  const Paint = (Rgb) => Css(Rgb.map((C, Channel) => C * Tint[Channel] * Gain));
  const CivilOnly = V("Line at civil only") ?? true;
  return (
    <svg className="sky-study twilight-band" viewBox="0 0 280 96" aria-label="Horizon glow and white line">
      <defs>
        <linearGradient id="dusk-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={Paint([0.07, 0.1, 0.22])} />
          <stop offset=".7" stopColor={Paint([0.25, 0.24, 0.36])} />
          <stop offset="1" stopColor={Paint([0.62, 0.42, 0.34])} />
        </linearGradient>
        <radialGradient id="dusk-glow" cx="50%" cy="100%" r="70%">
          <stop offset="0" stopColor="#ffb766" stopOpacity={Limit(Glow / 2.2, 0, 1)} />
          <stop offset="1" stopColor="#ffb766" stopOpacity="0" />
        </radialGradient>
        <clipPath id="dusk-clip">
          <rect x="0" y="0" width="280" height="84" rx="10" />
        </clipPath>
      </defs>
      <g clipPath="url(#dusk-clip)">
        <rect x="0" y="0" width="280" height="64" fill="url(#dusk-sky)" />
        <ellipse cx="140" cy="64" rx={60 + Glow * 40} ry={14 + Glow * 12} fill="url(#dusk-glow)" />
        <rect x="0" y={63.5 - Line * 0.6} width="280" height={1 + Line * 1.2} fill="#ffffff" fillOpacity={Limit(Line / 2.4, 0, 1)} data-white-line="" />
        <rect x="0" y="65" width="280" height="20" fill="#06070a" />
      </g>
      <text x="8" y="14" className="study-faint" style={{ fill: "#c7cbd6" }}>DUSK HORIZON</text>
      <text x="0" y="95" className="study-faint">glow {Glow.toFixed(2)} × · line {Line.toFixed(2)} ×</text>
      <text x="280" y="95" textAnchor="end" className="study-faint">{CivilOnly ? "line in civil twilight only" : "line at every sun height"}</text>
    </svg>
  );
}
