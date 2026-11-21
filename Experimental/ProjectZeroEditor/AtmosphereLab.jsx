import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Plot, Clamp } from "./LiveGraph.jsx";
const Defaults = {
  Ozone: 1.2,
  "Mie Anisotropy": 0.78,
  "Rayleigh Scale H": 8000,
  "Mie Scale H": 1200,
  Atmosphere: 60000,
  "Sky Tint": "#ffffff",
  "Sky Brightness": 1,
  "Ground Albedo": "#796e60",
  "Planet radius": 6371,
  "Horizon Glow": 1,
  "White Line": 1,
};
function Hex(Text) {
  return /^#[\da-f]{6}$/i.test(Text)
    ? [1, 3, 5].map((I) => parseInt(Text.slice(I, I + 2), 16) / 255)
    : [1, 1, 1];
}
export function AtmosphereProfile({ V, Change, Mode }) {
  const Probe =
    V("Atmosphere probe " + Mode) ?? (Mode === "height" ? 8000 : 550);
  const Domain =
    Mode === "height"
      ? [0, V("Atmosphere")]
      : Mode === "haze"
        ? [0, 10]
        : [380, 780];
  let Series, Range, Note;
  if (Mode === "height") {
    Series = [
      {
        Name: "Molecules",
        At: (H) => Math.exp(-H / V("Rayleigh Scale H")),
        Colour: "#9dbdd6",
      },
      {
        Name: "Aerosols",
        At: (H) => Math.exp(-H / V("Mie Scale H")),
        Colour: "#d2b88d",
      },
    ];
    Range = [0, 1];
    Note =
      "Relative density exp(−altitude / scale height). Both scale heights contribute.";
  } else if (Mode === "haze") {
    Series = [
      {
        Name: "Transmission",
        At: (X) => 100 * Math.exp(-0.2 * V("Mie") * X),
        Colour: "#cbbd9b",
      },
    ];
    Range = [0, 100];
    Note =
      "Illustrative normalized path: exp(−0.2 × Mie × path), not measured visibility.";
  } else if (Mode === "ozone") {
    Series = [
      {
        Name: "Transmission",
        At: (L) =>
          100 * Math.exp(-V("Ozone") * Math.exp(-Math.pow((L - 600) / 80, 2))),
        Colour: "#b8a3c9",
      },
    ];
    Range = [0, 100];
    Note =
      "Illustrative visible-band absorption envelope; not a calibrated ozone cross-section.";
  } else {
    Series = [
      {
        Name: "Rayleigh",
        At: (L) => V("Rayleigh") * (550 / L) ** 4,
        Colour: "#98bad6",
      },
      {
        Name: "Mie",
        At: (L) => V("Mie") * (550 / L) ** 1.3,
        Colour: "#c9b997",
      },
    ];
    Range = [0, 20];
    Note =
      "Relative wavelength response. Rayleigh λ⁻⁴; illustrative aerosol λ⁻¹·³.";
  }
  return (
    <Plot
      Name={"Atmosphere " + Mode + " graph"}
      Domain={Domain}
      Range={Range}
      Series={Series}
      Value={Clamp(Probe, ...Domain)}
      Change={(Next) => Change("Atmosphere probe " + Mode, Next)}
      XUnit={Mode === "height" ? "m" : Mode === "haze" ? "path" : "nm"}
      YUnit={Mode === "haze" || Mode === "ozone" ? "%" : ""}
      Note={Note}
    />
  );
}
// Sky colour from the authored scattering: an illustrative single-scatter estimate, enough to show how each preset
// differs at noon and at sunset. Rayleigh scatters blue (λ⁻⁴), aerosols (Mie) scatter all colours and whiten the
// horizon, ozone takes some green and red out of the long sunset path.
const Wavelength = [0.43, 1, 2.23];
function SkyColours(Settings) {
  const S = { ...Defaults, Rayleigh: 1, Mie: 1, ...Settings };
  const Rayleigh = Wavelength.map((K) => 0.11 * S.Rayleigh * K * (S["Rayleigh Scale H"] / 8000));
  const Mie = 0.045 * S.Mie * Math.sqrt(S["Mie Scale H"] / 1200);
  const Ozone = [0.035, 0.06, 0.008].map((K) => K * S.Ozone);
  const Tint = Hex(S["Sky Tint"]), Albedo = Hex(S["Ground Albedo"]), Gain = S["Sky Brightness"];
  const Develop = (Rgb) =>
    "rgb(" + Rgb.map((C, I) => Math.round(255 * Math.pow((1 - Math.exp(-1.7 * C * Tint[I] * Gain)) / (1 - Math.exp(-1.7)), 1 / 1.6))).join(",") + ")";
  const Sunset = Wavelength.map((_, I) => Math.exp(-22 * (Rayleigh[I] + Mie + Ozone[I])));
  return {
    Overhead: Develop(Wavelength.map((_, I) => 2.6 * (1 - Math.exp(-(Rayleigh[I] + 0.35 * Mie))))),
    Skyline: Develop(Wavelength.map((_, I) => 1.15 * (1 - Math.exp(-7 * (Rayleigh[I] + Mie))) * Math.exp(-Ozone[I]))),
    DuskOverhead: Develop(Wavelength.map((_, I) => 0.55 * (1 - Math.exp(-2.5 * Rayleigh[I])) + 0.9 * Sunset[I] * Mie)),
    DuskSkyline: Develop(Wavelength.map((_, I) => 3.2 * Sunset[I] * (1 - Math.exp(-7 * (Rayleigh[I] + Mie))) + 0.04)),
    Sun: Develop(Sunset.map((C) => 0.4 + 2 * C)),
    Ground: Develop(Albedo.map((C) => C * 0.55)),
    DuskGround: Develop(Albedo.map((C, I) => C * (0.05 + 0.3 * Sunset[I]))),
  };
}

let SkyCount = 0;
function SkyPanel({ X, Y, W, H, Top, Bottom, Ground, Sun, SunX, SunY, Glow, Label, Round = 10 }) {
  const Id = React.useMemo(() => "sky" + ++SkyCount, []);
  const Skyline = Y + H * 0.76;
  return (
    <g>
      <defs>
        <linearGradient id={Id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={Top} />
          <stop offset="1" stopColor={Bottom} />
        </linearGradient>
        <radialGradient id={Id + "g"} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor={Sun} stopOpacity=".95" />
          <stop offset="1" stopColor={Sun} stopOpacity="0" />
        </radialGradient>
        <clipPath id={Id + "c"}>
          <rect x={X} y={Y} width={W} height={H} rx={Round} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${Id}c)`}>
        <rect x={X} y={Y} width={W} height={Skyline - Y} fill={`url(#${Id})`} />
        <circle cx={SunX} cy={SunY} r={Glow} fill={`url(#${Id}g)`} />
        <circle cx={SunX} cy={SunY} r={Math.max(2, Glow * 0.16)} fill="#fffdf4" />
        <rect x={X} y={Skyline} width={W} height={Y + H - Skyline} fill={Ground} />
      </g>
      {Label && (
        <text x={X + 8} y={Y + 14} className="sky-label">
          {Label}
        </text>
      )}
    </g>
  );
}

// The current sky at noon and at sunset, coloured from the scattering settings. No presets: the cards below edit it.
function SkyPreview({ V }) {
  const Current = SkyColours(Object.fromEntries([...Object.keys(Defaults), "Rayleigh", "Mie"].map((Key) => [Key, V(Key) ?? Defaults[Key]])));
  return (
    <section className="property-card atmosphere-presets" data-card="Sky colour">
      <h3>Sky colour</h3>
      <p>
        Rayleigh {V("Rayleigh").toFixed(2)} × · Mie {V("Mie").toFixed(2)} × · Ozone {(V("Ozone") ?? Defaults.Ozone).toFixed(2)} ×
      </p>
      <svg className="sky-preview" viewBox="0 0 300 116" role="img" aria-label="Current sky at noon and at sunset">
        <SkyPanel X={0} Y={0} W={147} H={100} Top={Current.Overhead} Bottom={Current.Skyline} Ground={Current.Ground} Sun="#fff8e0" SunX={112} SunY={20} Glow={22} Label="NOON" />
        <SkyPanel X={153} Y={0} W={147} H={100} Top={Current.DuskOverhead} Bottom={Current.DuskSkyline} Ground={Current.DuskGround} Sun={Current.Sun} SunX={226} SunY={74} Glow={30} Label="SUNSET" />
        <text x="0" y="113">sun high · 60°</text>
        <text x="300" y="113" textAnchor="end">sun on the horizon · long light path</text>
      </svg>
      <p className="graph-note">Illustrative single-scatter colours from the settings below, not the native sky.</p>
    </section>
  );
}
const Dot = (A, B) => A.reduce((S, V, I) => S + V * B[I], 0),
  Add = (A, B, S = 1) => A.map((V, I) => V + S * B[I]),
  Unit = (A) => {
    const L = Math.hypot(...A);
    return A.map((V) => V / L);
  };
function SphereRay(O, D, R) {
  const B = Dot(O, D),
    C = Dot(O, O) - R * R,
    H = B * B - C;
  if (H < 0) return null;
  return [-B - Math.sqrt(H), -B + Math.sqrt(H)];
}
function Space({ V, Change, Expand, Turn, Orbit }) {
  const Canvas = useRef(null),
    Drag = useRef(null);
  useEffect(() => {
    let Frame = requestAnimationFrame(() => {
      if (Canvas.current.closest("[inert]")) return;
      const C = Canvas.current,
        W = 360,
        H = 232,
        Context = C.getContext("2d");
      C.width = W;
      C.height = H;
      const Image = Context.createImageData(W, H);
      const Rayleigh = V("Rayleigh"),
        Mie = V("Mie"),
        OzoneStrength = V("Ozone"),
        Glow = V("Horizon Glow"),
        White = V("White Line"),
        R = V("Planet radius") ?? 6371,
        Alt = Clamp(V("Space altitude") ?? 15000, 200, 40000),
        Thick = V("Atmosphere") / 1000,
        Ex = V("Limb exaggeration") ?? 8,
        Outer = R + Thick * Ex;
      const Yaw = ((V("Space yaw") ?? 25) * Math.PI) / 180,
        Pitch = ((V("Space pitch") ?? 15) * Math.PI) / 180,
        Eye = Unit([
          Math.cos(Pitch) * Math.cos(Yaw),
          Math.cos(Pitch) * Math.sin(Yaw),
          Math.sin(Pitch),
        ]).map((N) => N * (R + Alt));
      const Forward = Unit(Eye.map((N) => -N)),
        Right = Unit([-Forward[1], Forward[0], 0]),
        Up = [
          Right[1] * Forward[2],
          -Right[0] * Forward[2],
          Right[0] * Forward[1] - Right[1] * Forward[0],
        ];
      const SunAngle = ((V("Space sun angle") ?? 35) * Math.PI) / 180,
        Sun = Unit([Math.cos(SunAngle), -0.35, Math.sin(SunAngle)]),
        Tint = Hex(V("Sky Tint")),
        Ground = Hex(V("Ground Albedo")),
        Brightness = V("Sky Brightness"),
        HR = V("Rayleigh Scale H") / 1000,
        HM = V("Mie Scale H") / 1000,
        G = V("Mie Anisotropy");
      for (let Y = 0; Y < H; Y++)
        for (let X = 0; X < W; X++) {
          const D = Unit(
              Add(
                Add(Forward, Right, ((X / W - 0.5) * 1.25 * W) / H),
                Up,
                (0.5 - Y / H) * 1.25,
              ),
            ),
            Hit = SphereRay(Eye, D, Outer);
          let RGB = [0.00003, 0.00005, 0.0001];
          if (Hit && Hit[1] > 0) {
            const Planet = SphereRay(Eye, D, R),
              Surface = Planet && Planet[0] > 0 ? Planet[0] : null,
              Start = Math.max(0, Hit[0]),
              End = Surface ?? Hit[1],
              Trans = [1, 1, 1],
              Light = [0, 0, 0],
              DS = Math.max(0, End - Start) / 20,
              Mu = Dot(D, Sun),
              RayPhase = 0.75 * (1 + Mu * Mu),
              MiePhase = Math.min(
                8,
                (1 - G * G) / Math.max(0.01, (1 + G * G - 2 * G * Mu) ** 1.5),
              );
            for (let I = 0; I < 20; I++) {
              const P = Add(Eye, D, Start + (I + 0.5) * DS),
                Height = Math.max(0, (Math.hypot(...P) - R) / Ex),
                DR = Math.exp(-Height / HR),
                DM = Math.exp(-Height / HM),
                Ozone = Math.exp(-Math.pow((Height - 25) / 15, 2)),
                Shadow = SphereRay(P, Sun, R),
                Lit = !(Shadow && Shadow[0] > 0),
                BetaR = [0.0058, 0.0135, 0.0331].map((B) => B * Rayleigh * DR),
                BetaM = 0.02 * Mie * DM;
              for (let A = 0; A < 3; A++) {
                const Absorb =
                    [0.00065, 0.00188, 0.00009][A] * OzoneStrength * Ozone,
                  Sigma = BetaR[A] + BetaM + Absorb,
                  Step = DS / Ex;
                Light[A] +=
                  Trans[A] *
                  (BetaR[A] * RayPhase + BetaM * MiePhase) *
                  (Lit ? 1 : 0.015) *
                  Step *
                  0.65 *
                  Tint[A];
                Trans[A] *= Math.exp(-Sigma * Step);
              }
            }
            if (Surface) {
              const P = Unit(Add(Eye, D, Surface)),
                Diffuse = Math.max(0, Dot(P, Sun)),
                Noise =
                  Math.sin(P[0] * 4 + P[2] * 3.1) +
                  0.5 * Math.sin(P[1] * 9 - P[2] * 5 + P[0]) +
                  0.25 * Math.sin(P[0] * 17 + P[1] * 11) +
                  0.15 * Math.cos(P[1] * 23 + P[2] * 17),
                Land = Clamp((Noise - 0.12) * 4, 0, 1),
                Terrestrial = R > 5000;
              RGB = Ground.map(
                (B, A) =>
                  (Terrestrial
                    ? Land * B * 0.22 + (1 - Land) * [0.01, 0.035, 0.07][A]
                    : B * 0.22 * (0.85 + Noise * 0.08)) *
                  (0.008 + Diffuse),
              );
            }
            RGB = RGB.map(
              (B, A) =>
                B * Trans[A] +
                Light[A] * Brightness * (0.8 + 0.12 * Glow + 0.08 * White),
            );
          }
          const Offset = (Y * W + X) * 4;
          for (let A = 0; A < 3; A++)
            Image.data[Offset + A] = Math.round(
              255 * (1 - Math.exp(-Math.max(0, RGB[A]) * 1.8)) ** (1 / 2.2),
            );
          Image.data[Offset + 3] = 255;
        }
      Context.putImageData(Image, 0, 0);
      C.dataset.render = String(performance.now());
    });
    return () => cancelAnimationFrame(Frame);
  });
  const Pointer = (E) => {
    if (!Drag.current) return;
    Change(
      "Space yaw",
      (Drag.current.Yaw + (E.clientX - Drag.current.X) * 0.5 + 360) % 360,
    );
    Change(
      "Space pitch",
      Clamp(Drag.current.Pitch - (E.clientY - Drag.current.Y) * 0.4, -75, 75),
    );
  };
  return (
    <section
      className="property-card atmosphere-space"
      data-card="Atmosphere from space"
    >
      <header>
        <h3>Atmosphere from space</h3>
        {Expand && (
          <button aria-label="Expand AtmosphereLab" onClick={Expand}>
            ↗
          </button>
        )}
      </header>
      <canvas
        ref={Canvas}
        role="img"
        tabIndex={0}
        aria-label="Atmosphere planet preview; drag to orbit"
        onPointerDown={(E) => {
          if (E.button !== 0) return;
          Orbit(false);
          E.currentTarget.setPointerCapture(E.pointerId);
          Drag.current = {
            X: E.clientX,
            Y: E.clientY,
            Yaw: V("Space yaw") ?? 25,
            Pitch: V("Space pitch") ?? 15,
          };
        }}
        onPointerMove={Pointer}
        onPointerUp={() => (Drag.current = null)}
        onPointerCancel={() => (Drag.current = null)}
        onLostPointerCapture={() => (Drag.current = null)}
        onKeyDown={(E) => {
          if (
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(E.key)
          ) {
            E.preventDefault();
            Change(
              "Space yaw",
              ((V("Space yaw") ?? 25) +
                (E.key === "ArrowLeft" ? -5 : E.key === "ArrowRight" ? 5 : 0) +
                360) %
                360,
            );
            Change(
              "Space pitch",
              Clamp(
                (V("Space pitch") ?? 15) +
                  (E.key === "ArrowUp" ? 5 : E.key === "ArrowDown" ? -5 : 0),
                -75,
                75,
              ),
            );
          }
        }}
      />
      <div className="graph-status">
        CPU SINGLE-SCATTER STUDY · NOT NATIVE SKY RENDERING
      </div>
      <button aria-pressed={Turn} onClick={() => Orbit(!Turn)}>
        {Turn ? "Pause orbit" : "Animate orbit"}
      </button>
      <div className="space-controls">
        {[
          ["Space altitude", "Observer altitude · km", 200, 40000, 15000],
          ["Space sun angle", "Preview sun angle · °", -90, 90, 35],
          ["Limb exaggeration", "Limb thickness · visual ×", 1, 16, 8],
        ].map(([Key, Label, Min, Max, Default]) => (
          <label key={Key}>
            {Label}
            <output>{Math.round(V(Key) ?? Default)}</output>
            <input
              aria-label={Label}
              type="range"
              min={Min}
              max={Max}
              value={V(Key) ?? Default}
              onChange={(E) => Change(Key, Number(E.target.value))}
            />
          </label>
        ))}
      </div>
      <p className="graph-note">
        Drag / arrow keys to orbit. Exaggerated shell thickness is a view aid,
        not planet scale. Procedural surface, simplified absorption and single
        scattering; no native bake, measured planet imagery or multiple
        scattering.
      </p>
    </section>
  );
}
export default function AtmosphereLab({ V, Change }) {
  const [Open, Expand] = useState(false),
    Root = useRef(null),
    Opener = useRef(null),
    [Turn, Orbit] = useState(false),
    Latest = useRef({ V, Change });
  Latest.current = { V, Change };
  useEffect(() => {
    if (!Turn) return;
    const Timer = setInterval(
      () =>
        Latest.current.Change(
          "Space yaw",
          ((Latest.current.V("Space yaw") ?? 25) + 2) % 360,
        ),
      180,
    );
    return () => clearInterval(Timer);
  }, [Turn]);
  useEffect(() => {
    if (!Open) return;
    const Editor = document.getElementById("Editor");
    const Previous = Editor.inert;
    Editor.inert = true;
    Root.current.querySelector("button").focus();
    const Escape = (Event) => {
      if (Event.key === "Escape") {
        Event.preventDefault();
        Event.stopPropagation();
        Expand(false);
      }
    };
    document.addEventListener("keydown", Escape, true);
    return () => {
      document.removeEventListener("keydown", Escape, true);
      Editor.inert = Previous;
      Opener.current?.focus();
    };
  }, [Open]);
  const Key = (E) => {
    if (E.key === "Escape") {
      E.stopPropagation();
      Expand(false);
    }
    if (E.key === "Tab") {
      const Nodes = [
        ...Root.current.querySelectorAll('button,input,select,[tabindex="0"]'),
      ].filter((N) => N.getClientRects().length);
      if (E.shiftKey && document.activeElement === Nodes[0]) {
        E.preventDefault();
        Nodes.at(-1).focus();
      } else if (!E.shiftKey && document.activeElement === Nodes.at(-1)) {
        E.preventDefault();
        Nodes[0].focus();
      }
    }
  };
  return (
    <>
      <div className="card-grid atmosphere-lab-cards">
        <SkyPreview V={V} />
        <Space
          Turn={Turn}
          Orbit={Orbit}
          V={V}
          Change={Change}
          Expand={() => {
            Opener.current = document.activeElement;
            Expand(true);
          }}
        />
      </div>
      {Open &&
        createPortal(
          <div className="atmosphere-lab-backdrop">
            <section
              className="atmosphere-lab-window"
              ref={Root}
              role="dialog"
              aria-modal="true"
              aria-label="AtmosphereLab"
              onKeyDown={Key}
            >
              <header>
                <div>
                  <small>ENVIRONMENT / INTERACTIVE STUDIES</small>
                  <h1>AtmosphereLab</h1>
                </div>
                <button
                  aria-label="Close AtmosphereLab"
                  onClick={() => Expand(false)}
                >
                  ×
                </button>
              </header>
              <div className="atmosphere-lab-body">
                <SkyPreview V={V} />
                <Space V={V} Change={Change} Turn={Turn} Orbit={Orbit} />
              </div>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
