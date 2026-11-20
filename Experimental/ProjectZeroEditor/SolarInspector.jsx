import React, { useState } from "react";
import { SunGizmo } from "../FrontierEditor/environment-graphics.jsx";
import { PropertyGraph, SunGraph } from "./LiveGraph.jsx";
import { Solar } from "./Solar.mjs";

/* ── Bespoke Solar Instrument Icon Family (Project-Zero Editor) ── */

export function SolarCoreGlyph({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.4" fill="currentColor" fillOpacity=".2" />
      <path d="M12 2.2v2.4M12 19.4v2.4M2.2 12h2.4M19.4 12h2.4" />
      <path d="m5.07 5.07 1.7 1.7m10.46 10.46 1.7 1.7m0-13.86-1.7 1.7M6.77 17.23l-1.7 1.7" strokeOpacity=".72" />
    </svg>
  );
}

export function SolarOrbitGlyph({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="16.5" rx="9" ry="3.4" strokeOpacity=".5" />
      <path d="M4.2 15.4C5.6 8.2 9.1 4.6 12 4.6s6.4 3.6 7.8 10.8" />
      <circle cx="14.8" cy="6.6" r="2.5" fill="currentColor" fillOpacity=".26" />
      <path d="M14.8 9.2v7.1" strokeDasharray="1.6 2.2" strokeOpacity=".6" />
    </svg>
  );
}

export function SolarDiurnalGlyph({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 15.5h19" strokeOpacity=".65" />
      <path d="M6.5 15.5a5.5 5.5 0 0 1 11 0" fill="currentColor" fillOpacity=".16" />
      <path d="M12 5v2.2M5.6 8.8l1.5 1.5M18.4 8.8l-1.5 1.5" />
      <path d="M7.4 18.5c1.3 1.4 3 2.1 4.6 2.1s3.3-.7 4.6-2.1" strokeDasharray="1.8 2.4" strokeOpacity=".55" />
    </svg>
  );
}

export function SolarFluxGlyph({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5h16" strokeOpacity=".65" />
      <path d="M6.2 4.5 9.8 15M11.5 3.5 14.5 14M16.8 5.2 18.8 12.2" />
      <path d="m8 13.4 1.8 1.6 1.2-2.1" />
      <path d="M9.8 19.5a4.8 4.8 0 0 1 7.6-3.9" strokeOpacity=".6" />
      <circle cx="6.2" cy="4.5" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SolarKelvinGlyph({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 18.5h18" strokeOpacity=".45" />
      <path d="M3.5 18.5C6.2 18.5 7.4 5.5 10.6 5.5c3.3 0 4.8 10.6 9.9 12.4" fill="currentColor" fillOpacity=".14" />
      <circle cx="10.6" cy="5.5" r="2.1" fill="currentColor" fillOpacity=".35" />
      <path d="M10.6 7.8v10.7" strokeDasharray="1.6 2.2" strokeOpacity=".55" />
    </svg>
  );
}

export function SolarDiscGlyph({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.3" fill="currentColor" fillOpacity=".24" />
      <circle cx="12" cy="12" r="8" strokeDasharray="2.2 2.6" strokeOpacity=".65" />
      <path d="M3 8.5v7M21 8.5v7" strokeOpacity=".55" />
    </svg>
  );
}

export function SolarEphemerisGlyph({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.2" fill="currentColor" fillOpacity=".1" />
      <ellipse cx="12" cy="12" rx="3.8" ry="8.2" transform="rotate(-18 12 12)" strokeOpacity=".75" />
      <path d="M4.2 14.4 19.8 9.6" strokeOpacity=".75" />
      <path d="M14.8 2.4 9.2 21.6" strokeDasharray="1.6 2.2" strokeOpacity=".5" />
    </svg>
  );
}

export function SolarFlareGlyph({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 12h19" strokeOpacity=".55" />
      <path d="m9.5 4.8 1.5 4.2 4.2 1.5-4.2 1.5-1.5 4.2-1.5-4.2-4.2-1.5 4.2-1.5Z" fill="currentColor" fillOpacity=".2" />
      <polygon points="16.8,13.4 18.9,14.6 18.9,17 16.8,18.2 14.7,17 14.7,14.6" strokeOpacity=".75" />
    </svg>
  );
}

export function SolarBakeGlyph({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 12.5 20.5 16.5 12 20.5 3.5 16.5Z" fill="currentColor" fillOpacity=".14" />
      <path d="M12 3.5v8.2m0 0-2.6-2.6m2.6 2.6 2.6-2.6" />
      <circle cx="18" cy="6" r="1.6" fill="currentColor" stroke="none" opacity=".8" />
    </svg>
  );
}

function DiagArrow({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 11.5 11.5 4.5M6 4.5h5.5V10" />
    </svg>
  );
}

function ChevronStep({ dir = -1 }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir < 0 ? <path d="m10 3.5-4.5 4.5L10 12.5" /> : <path d="m6 3.5 4.5 4.5L6 12.5" />}
    </svg>
  );
}

function GridToggleIcon({ isGrid }) {
  return isGrid ? (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="9" height="10" rx="2" />
      <path d="M13.5 4.5v7" />
    </svg>
  ) : (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" rx="1.2" />
      <rect x="9" y="2" width="5" height="5" rx="1.2" />
      <rect x="2" y="9" width="5" height="5" rx="1.2" />
      <rect x="9" y="9" width="5" height="5" rx="1.2" />
    </svg>
  );
}

/* ── Helpers ── */

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compassOf = (az) => COMPASS[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];

export function kelvinToCSS(K) {
  const t = Math.max(1000, Math.min(40000, K)) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.47 * Math.log(t) - 161.12;
  } else {
    r = 329.7 * Math.pow(t - 60, -0.1332);
    g = 288.12 * Math.pow(t - 60, -0.0755);
  }
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.52 * Math.log(t - 10) - 305.04;
  const c = (x) => Math.max(0, Math.min(255, Math.round(x)));
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}

function phaseOfElevation(alt) {
  if (alt >= 45) return { name: "High Sun", tone: "day" };
  if (alt >= 12) return { name: "Full Daylight", tone: "day" };
  if (alt >= 0) return { name: "Golden Hour", tone: "golden" };
  if (alt >= -8) return { name: "Civil Twilight", tone: "twilight" };
  return { name: "Below Horizon", tone: "night" };
}

function formatClock(hours) {
  const wrapped = ((Number(hours) % 24) + 24) % 24;
  const hh = Math.floor(wrapped);
  const mm = Math.floor((wrapped - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

const PZ_SOLAR_PRESETS = [
  { id: "dawn", label: "Dawn", hours: 6.25, kelvin: 3400 },
  { id: "morning", label: "Morning", hours: 9.0, kelvin: 5200 },
  { id: "noon", label: "Transit", hours: 12.0, kelvin: 6200 },
  { id: "golden", label: "Golden", hours: 17.25, kelvin: 3800 },
  { id: "dusk", label: "Twilight", hours: 18.75, kelvin: 4300 },
  { id: "night", label: "Midnight", hours: 0.0, kelvin: 6800 },
];

function DiurnalTickRuler({ hours, onPick }) {
  const count = 33;
  const active = Math.round((Math.max(0, Math.min(24, hours)) / 24) * (count - 1));
  return (
    <div className="pz-sun-ruler" role="group" aria-label="Solar day timeline">
      <div className="pz-sun-ruler-labels">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>
      <div className="pz-sun-ruler-bars">
        {Array.from({ length: count }, (_, i) => {
          const h = (i / (count - 1)) * 24;
          const isDay = h >= 6 && h <= 18;
          return (
            <button
              key={i}
              type="button"
              className={`pz-sun-ruler-tick ${isDay ? "is-day" : ""} ${i === active ? "is-current" : ""}`}
              title={`Set Local Hours to ${formatClock(h)}`}
              aria-label={`Set Local Hours ${formatClock(h)}`}
              onClick={() => onPick(+h.toFixed(2))}
            />
          );
        })}
      </div>
    </div>
  );
}

export function SunBakeCard({ Title }) {
  return (
    <section
      className="property-card pz-sun-card pz-sun-bake-card"
      data-card={Title}
    >
      <div className="pz-sun-card-head">
        <div className="pz-sun-card-title">
          <span className="pz-sun-icon-badge" style={{ color: "#e6be74" }}>
            <SolarBakeGlyph size={17} />
          </span>
          <div>
            <span className="pz-sun-eyebrow">LIGHTMAP &amp; SKY CAPTURE</span>
            <h3><span>{Title}</span></h3>
          </div>
        </div>
        <span className="pz-sun-tag">Procedural</span>
      </div>
      <div className="pz-sun-bake-row">
        <button
          type="button"
          className="quick-tile large off pz-bake-tile"
          disabled
          title="Not connected in the HTML UI copy"
          aria-label="Use baked image"
          data-quick-action="Use baked image"
        >
          <span className="pz-sun-icon-badge is-muted">
            <SolarBakeGlyph size={17} />
          </span>
          <span className="quick-label">Use baked image</span>
          <small className="quick-status">UNAVAILABLE</small>
        </button>
        <div className="pz-sun-bake-actions">
          <button type="button" disabled>Bake capture</button>
          <button type="button" disabled>Load image</button>
          <p>Renderer / imported-image binding unavailable in HTML preview.</p>
        </div>
      </div>
      <PropertyGraph Title={Title} Children={null} />
    </section>
  );
}

export default function SolarInspector({
  V,
  AssignProperty,
  F,
  Hidden,
  ToggleHidden,
  SelectEntity,
}) {
  const [slideIndex, setSlideIndex] = useState(0);
  const [viewMode, setViewMode] = useState("carousel");

  const Time = Number(V("Local Hours") ?? 15.5);
  const Month = Number(V("Month") ?? 10);
  const Day = Number(V("Day of Month") ?? 4);
  const Latitude = Number(V("Latitude") ?? -26.19);
  const Longitude = Number(V("Longitude") ?? 28.32);
  const Intensity = Number(V("Intensity") ?? 22);
  const Direct = Number(V("Direct") ?? 2.5);
  const Temperature = Number(V("Temperature") ?? 6500);
  const ColourMode = Number(V("Colour source") ?? 0);
  const SunTint = V("Sun Tint") || "#ffffff";
  const AngularDiameter = Number(V("Angular Diameter") ?? 0.533);
  const Animate = Boolean(V("Animate"));

  const Solved = Solar({
    LocalHours: Time,
    Month,
    Day,
    Latitude,
    Longitude,
  });
  const { Elevation, Azimuth } = Solved;
  const phase = phaseOfElevation(Elevation);
  const activeSwatch = ColourMode ? kelvinToCSS(Temperature) : SunTint;
  const combinedGain = +(Intensity * Direct).toFixed(1);
  const gainPct = Math.min(100, Math.round((combinedGain / 300) * 100));

  const CATEGORIES = [
    { id: "trajectory", label: "Trajectory", Icon: SolarOrbitGlyph, slides: [0, 1] },
    { id: "photometry", label: "Photometry", Icon: SolarFluxGlyph, slides: [2, 3] },
    { id: "ephemeris", label: "Optics & Orbit", Icon: SolarEphemerisGlyph, slides: [4, 5] },
  ];

  const activeCategory =
    CATEGORIES.find((c) => c.slides.includes(slideIndex)) || CATEGORIES[0];

  const jumpToSlide = (idx) => {
    setSlideIndex(Math.max(0, Math.min(5, idx)));
    setViewMode("carousel");
  };

  const scrollToBaking = () => {
    document
      .querySelector('[data-card="Sun lighting bake"]')
      ?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  const SLIDES = [
    {
      id: "direction",
      title: "Sun direction",
      eyebrow: "NOAA SOLVED VECTOR",
      Icon: SolarOrbitGlyph,
      accent: "#f0be67",
      extraClass: "direction-card",
      graphHandled: true,
      body: (
        <>
          <div className="pz-sun-hero-row">
            <div>
              <div className="pz-sun-big-num">
                <span>{Elevation >= 0 ? `+${Elevation.toFixed(1)}` : Elevation.toFixed(1)}</span>
                <small>°</small>
              </div>
              <p className="pz-sun-caption">
                {Elevation < 0
                  ? "Below local horizon · twilight/nocturnal"
                  : `${compassOf(Azimuth)} ${Azimuth.toFixed(1)}° · solved by NOAA clock`}
              </p>
            </div>
            <span className={`pz-sun-phase-pill tone-${phase.tone}`}>
              <i />
              {phase.name}
            </span>
          </div>
          <div
            className="pz-sun-gizmo-frame"
            title="Solved direction. Scrub Local Hours or presets to orbit the sun."
          >
            <SunGizmo
              azimuth={Azimuth}
              elevation={Elevation}
              onChange={(nextAz) => {
                const approxHours = (((6 + (nextAz - 90) / 15) % 24) + 24) % 24;
                AssignProperty("Local Hours", +approxHours.toFixed(2));
              }}
            />
          </div>
          {F("Local Hours")}
          <div className="pz-solved-pair">
            <div className="pz-solved-cell">
              <small>Solved Azimuth</small>
              <strong>{Azimuth.toFixed(1)}° · {compassOf(Azimuth)}</strong>
              <div className="pz-mini-bar">
                <i style={{ width: `${(Azimuth / 360) * 100}%` }} />
              </div>
            </div>
            <div className="pz-solved-cell">
              <small>Solved Elevation</small>
              <strong>{Elevation >= 0 ? `+${Elevation.toFixed(1)}` : Elevation.toFixed(1)}°</strong>
              <div className="pz-mini-bar">
                <i style={{ width: `${((Elevation + 90) / 180) * 100}%` }} />
              </div>
            </div>
          </div>
        </>
      ),
    },
    {
      id: "cycle",
      title: "Daylight cycle",
      eyebrow: "24-HOUR DIURNAL ARC",
      Icon: SolarDiurnalGlyph,
      accent: "#e7c57c",
      graphHandled: true,
      body: (
        <>
          <div className="pz-sun-hero-row">
            <div>
              <div className="pz-sun-big-num">
                <span>{formatClock(Time).split(":")[0]}</span>
                <span className="pz-muted-colon">:{formatClock(Time).split(":")[1]}</span>
              </div>
              <p className="pz-sun-caption">Solar altitude over 24 local hours</p>
            </div>
            <span className="pz-sun-tag">
              {Animate ? "Animated clock" : "Manual scrub"}
            </span>
          </div>
          <SunGraph V={V} Change={AssignProperty} Mode="day" />
          {F("Local Hours")}
          <DiurnalTickRuler
            hours={Time}
            onPick={(h) => AssignProperty("Local Hours", h)}
          />
        </>
      ),
    },
    {
      id: "intensity",
      title: "Sunlight intensity",
      eyebrow: "RADIOMETRIC GAIN",
      Icon: SolarFluxGlyph,
      accent: "#ecc86e",
      graphHandled: true,
      body: (
        <>
          <div className="pz-sun-hero-row">
            <div>
              <div className="pz-sun-big-num">
                <span>{Intensity.toFixed(1)}</span>
                <small>× gain</small>
              </div>
              <p className="pz-sun-caption">
                Combined direct output {combinedGain}× ({Direct.toFixed(2)}× direct beam)
              </p>
            </div>
            <span className="pz-sun-callout-pill">{gainPct}% ceiling</span>
          </div>
          <SunGraph V={V} Change={AssignProperty} Mode="gain" />
          {F("Intensity")}
          {F("Direct")}
          <div className="pz-range-ends">
            <span>0 × · Dark</span>
            <span>30 × · Studio</span>
            <span>60 × · Peak</span>
          </div>
        </>
      ),
    },
    {
      id: "temperature",
      title: "Temperature",
      eyebrow: "PLANCK BLACKBODY & TINT",
      Icon: SolarKelvinGlyph,
      accent: "#efa57b",
      graphHandled: true,
      body: (
        <>
          <div className="pz-sun-hero-row">
            <div>
              <div className="pz-sun-big-num">
                <span>{ColourMode ? Math.round(Temperature).toLocaleString("en-US") : "RGB"}</span>
                {ColourMode ? <small>K</small> : <small>tint</small>}
              </div>
              <p className="pz-sun-caption">
                {ColourMode
                  ? "Blackbody Planck chromaticity curve"
                  : "Direct linear RGB photosphere tint"}
              </p>
            </div>
            <span className="pz-sun-phase-pill">
              <i style={{ background: activeSwatch }} />
              {ColourMode ? `${Math.round(Temperature / 100) / 10}kK` : SunTint.toUpperCase()}
            </span>
          </div>
          {F("Colour source")}
          <div className="temperature-spectrum" />
          <SunGraph V={V} Change={AssignProperty} Mode="temperature" />
          <div className="pz-kelvin-chips" role="group" aria-label="Kelvin presets">
            {[
              ["2700K", 2700],
              ["3800K", 3800],
              ["5600K", 5600],
              ["6500K", 6500],
              ["9000K", 9000],
            ].map(([lbl, kv]) => (
              <button
                key={kv}
                type="button"
                className={ColourMode && Math.abs(Temperature - kv) < 160 ? "is-active" : ""}
                onClick={() => {
                  AssignProperty("Colour source", 1);
                  AssignProperty("Temperature", kv);
                }}
              >
                <i style={{ background: kelvinToCSS(kv) }} />
                {lbl}
              </button>
            ))}
          </div>
          {F("Temperature", !ColourMode)}
          {F("Sun Tint", !!ColourMode)}
        </>
      ),
    },
    {
      id: "disc",
      title: "Sun disc",
      eyebrow: "ANGULAR LIMB & CORONA",
      Icon: SolarDiscGlyph,
      accent: "#f2bf72",
      graphHandled: false,
      body: (
        <>
          <div className="pz-disc-bento">
            <div>
              <div className="pz-sun-big-num">
                <span>{AngularDiameter.toFixed(2)}</span>
                <small>°</small>
              </div>
              <p className="pz-sun-caption">Apparent solar disc angle (0.53° physical)</p>
              <div className="pz-stepper-row" role="group" aria-label="Sun disc fine steppers">
                <button
                  type="button"
                  className="pz-circle-stepper"
                  aria-label="Decrease angular diameter"
                  onClick={() =>
                    AssignProperty(
                      "Angular Diameter",
                      +Math.max(0.1, AngularDiameter - 0.05).toFixed(2),
                    )
                  }
                >
                  −
                </button>
                <button
                  type="button"
                  className="pz-stepper-pill"
                  onClick={() => AssignProperty("Angular Diameter", 0.53)}
                >
                  0.53° Earth
                </button>
                <button
                  type="button"
                  className="pz-circle-stepper"
                  aria-label="Increase angular diameter"
                  onClick={() =>
                    AssignProperty(
                      "Angular Diameter",
                      +Math.min(5.0, AngularDiameter + 0.05).toFixed(2),
                    )
                  }
                >
                  +
                </button>
              </div>
            </div>
            <div className="pz-disc-chamber" aria-hidden="true">
              <div
                className="pz-disc-halo"
                style={{
                  width: Math.min(116, 30 + AngularDiameter * 22),
                  height: Math.min(116, 30 + AngularDiameter * 22),
                  borderColor: activeSwatch,
                }}
              />
              <div
                className="pz-disc-core"
                style={{
                  width: Math.min(92, 16 + AngularDiameter * 18),
                  height: Math.min(92, 16 + AngularDiameter * 18),
                  background: activeSwatch,
                }}
              />
              <span>Ø {AngularDiameter.toFixed(2)}°</span>
            </div>
          </div>
          {F("Angular Diameter")}
        </>
      ),
    },
    {
      id: "dynamic",
      title: "Dynamic settings",
      eyebrow: "EPHEMERIS, LOCATION & SEASON",
      Icon: SolarEphemerisGlyph,
      accent: "#a8d5ba",
      graphHandled: true,
      body: (
        <>
          <SunGraph V={V} Change={AssignProperty} Mode="year" />
          <div className="pz-ephemeris-groups">
            <div className="pz-ephemeris-box">
              <span className="pz-ephemeris-label">CLOCK &amp; ORBIT PLAYBACK</span>
              {F("Animate")}
              {F("Speed")}
              {F("Day duration")}
            </div>
            <div className="pz-ephemeris-box">
              <span className="pz-ephemeris-label">OBSERVER COORDINATES &amp; DATE</span>
              {F("Latitude")}
              {F("Longitude")}
              {F("Month")}
              {F("Day of Month")}
            </div>
          </div>
          <div className="pz-solved-pair">
            <div className="pz-solved-cell">
              <small>Solar Declination</small>
              <strong>{Solved.Declination.toFixed(2)}°</strong>
            </div>
            <div className="pz-solved-cell">
              <small>Equation of Time</small>
              <strong>{Solved.EquationOfTime.toFixed(2)} min</strong>
            </div>
          </div>
        </>
      ),
    },
  ];

  return (
    <div className="pz-sun-redesign">
      {/* 1. Solar Moment Preset Pill Strip (Images 3 & 4) */}
      <div className="pz-sun-presets" role="group" aria-label="Solar time presets">
        {PZ_SOLAR_PRESETS.map((p) => {
          const isCurrent = Math.abs(Time - p.hours) < 0.45;
          return (
            <button
              key={p.id}
              type="button"
              className={`pz-preset-pill ${isCurrent ? "is-active" : ""}`}
              onClick={() => AssignProperty("Local Hours", p.hours)}
            >
              <i style={{ background: kelvinToCSS(p.kelvin) }} />
              <span>{p.label}</span>
              <small>{formatClock(p.hours)}</small>
            </button>
          );
        })}
      </div>

      {/* 2. Dual Status & Comparison KPI Row (Images 2 & 4) */}
      <div className="pz-kpi-duo">
        <div
          className={`pz-kpi-card tone-${phase.tone}`}
          role="button"
          tabIndex={0}
          onClick={() => jumpToSlide(0)}
          onKeyDown={(e) => e.key === "Enter" && jumpToSlide(0)}
        >
          <div className="pz-kpi-head">
            <span className="pz-kpi-bar" />
            <span className="pz-kpi-title">{phase.name}</span>
            <span className="pz-kpi-corner"><DiagArrow /></span>
          </div>
          <div className="pz-kpi-delta">
            <span className={Elevation >= 0 ? "is-up" : "is-down"}>
              {Elevation >= 0 ? "▲ Above horizon" : "▼ Below horizon"}
            </span>
          </div>
          <div className="pz-kpi-foot">
            <strong className="pz-kpi-num">
              {Elevation >= 0 ? `+${Elevation.toFixed(1)}` : Elevation.toFixed(1)}
              <small>°</small>
            </strong>
            <span className="pz-kpi-meta">{compassOf(Azimuth)} · {formatClock(Time)}</span>
          </div>
        </div>

        <div
          className="pz-kpi-card"
          role="button"
          tabIndex={0}
          onClick={() => jumpToSlide(2)}
          onKeyDown={(e) => e.key === "Enter" && jumpToSlide(2)}
        >
          <div className="pz-kpi-head">
            <span className="pz-kpi-bar is-amber" />
            <span className="pz-kpi-title">Combined Gain</span>
            <span className="pz-kpi-corner"><DiagArrow /></span>
          </div>
          <div className="pz-kpi-foot">
            <strong className="pz-kpi-num">
              {combinedGain}
              <small>× flux</small>
            </strong>
            <span className="pz-kpi-meta">
              {ColourMode ? `${Math.round(Temperature)}K` : SunTint}
            </span>
          </div>
          <div className="pz-compare-pair" aria-hidden="true">
            <div className="pz-compare-hatch">
              <small>Ceiling</small>
              <span>300×</span>
            </div>
            <div className="pz-compare-solid" style={{ "--pz-flux": activeSwatch }}>
              <small>Active</small>
              <span>{gainPct}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Smart-Home Tactile Bento Quick Tiles (.tiles.sun-tiles preserved!) */}
      <div className="tiles sun-tiles pz-smart-tiles">
        <div className={`pz-smart-tile ${!Hidden ? "is-on is-spotlight" : "is-off"}`}>
          <div className="pz-smart-top">
            <span className="pz-sun-icon-badge">
              <SolarCoreGlyph size={17} />
            </span>
            <button
              type="button"
              className="pz-corner-btn"
              aria-label="Inspect Sun direction"
              onClick={() => jumpToSlide(0)}
            >
              <DiagArrow />
            </button>
          </div>
          <div className="pz-smart-copy">
            <strong>Sun Light</strong>
            <span>{!Hidden ? `On · ${formatClock(Time)}` : "Hidden in world"}</span>
          </div>
          <div className="pz-smart-bottom">
            <button
              type="button"
              className={`pz-capsule-toggle ${!Hidden ? "is-on" : ""}`}
              aria-label="Enabled"
              aria-pressed={!Hidden}
              data-quick-action="Enabled"
              onClick={ToggleHidden}
            >
              <span className="pz-capsule-thumb" />
            </button>
          </div>
        </div>

        <div className={`pz-smart-tile ${Animate ? "is-on" : "is-off"}`}>
          <div className="pz-smart-top">
            <span className="pz-sun-icon-badge">
              <SolarDiurnalGlyph size={17} />
            </span>
            <button
              type="button"
              className="pz-corner-btn"
              aria-label="Inspect Daylight cycle"
              onClick={() => jumpToSlide(1)}
            >
              <DiagArrow />
            </button>
          </div>
          <div className="pz-smart-copy">
            <strong>Day Cycle</strong>
            <span>{Animate ? `Dynamic · ${V("Day duration")}h` : "Static clock"}</span>
          </div>
          <div className="pz-smart-bottom">
            <button
              type="button"
              className={`pz-capsule-toggle ${Animate ? "is-on" : ""}`}
              aria-label="Day cycle"
              aria-pressed={Animate}
              data-quick-action="Day cycle"
              onClick={() => AssignProperty("Animate", !Animate)}
            >
              <span className="pz-capsule-thumb" />
            </button>
          </div>
        </div>

        <div className={`pz-smart-tile ${ColourMode ? "is-on" : "is-off"}`}>
          <div className="pz-smart-top">
            <span className="pz-sun-icon-badge" style={{ color: activeSwatch }}>
              <SolarKelvinGlyph size={17} />
            </span>
            <button
              type="button"
              className="pz-corner-btn"
              aria-label="Inspect Temperature"
              onClick={() => jumpToSlide(3)}
            >
              <DiagArrow />
            </button>
          </div>
          <div className="pz-smart-copy">
            <strong>Blackbody K</strong>
            <span>{ColourMode ? `${Math.round(Temperature)} K` : "RGB Tint mode"}</span>
          </div>
          <div className="pz-smart-bottom">
            <button
              type="button"
              className={`pz-capsule-toggle ${ColourMode ? "is-on" : ""}`}
              aria-label="Blackbody temperature mode"
              aria-pressed={!!ColourMode}
              onClick={() => AssignProperty("Colour source", ColourMode ? 0 : 1)}
            >
              <span className="pz-capsule-thumb" />
            </button>
          </div>
        </div>

        <button
          type="button"
          className="pz-smart-tile is-sublink"
          onClick={() => SelectEntity?.("flare")}
        >
          <div className="pz-smart-top">
            <span className="pz-sun-icon-badge" style={{ color: "#ebb584" }}>
              <SolarFlareGlyph size={17} />
            </span>
            <span className="pz-corner-btn">
              <DiagArrow />
            </span>
          </div>
          <div className="pz-smart-copy">
            <strong>Lens Flare</strong>
            <span>Optical ghosts &amp; streaks</span>
          </div>
          <div className="pz-smart-bottom">
            <span className="pz-sub-badge">Open</span>
          </div>
        </button>
      </div>

      {/* 4. Categorized Sun Carousel (.sun-properties preserved!) */}
      <div className="card-grid sun-properties pz-sun-carousel-shell">
        <div className="pz-cat-header">
          <div className="pz-cat-tabs" role="tablist" aria-label="Sun data categories">
            {CATEGORIES.map((cat) => {
              const CatIcon = cat.Icon;
              const active = activeCategory.id === cat.id && viewMode === "carousel";
              return (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`pz-cat-tab ${active ? "is-active" : ""}`}
                  onClick={() => jumpToSlide(cat.slides[0])}
                >
                  <CatIcon size={13} />
                  <span>{cat.label}</span>
                  <sup>{cat.slides.length}</sup>
                </button>
              );
            })}
            <button
              type="button"
              className="pz-cat-tab"
              onClick={scrollToBaking}
              title="Scroll to Sun baking cards"
            >
              <SolarBakeGlyph size={13} />
              <span>Baking</span>
              <sup>2</sup>
            </button>
          </div>

          <button
            type="button"
            className="pz-view-btn"
            onClick={() => setViewMode((m) => (m === "carousel" ? "grid" : "carousel"))}
            title={viewMode === "carousel" ? "Expand all cards" : "Collapse into carousel"}
          >
            <GridToggleIcon isGrid={viewMode === "grid"} />
            <span>{viewMode === "carousel" ? "All" : "Deck"}</span>
          </button>
        </div>

        {viewMode === "carousel" && (
          <>
            <div className="pz-progress-rail" role="group" aria-label="Sun slide progress">
              {SLIDES.map((s, idx) => {
                const inCat = activeCategory.slides.includes(idx);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-label={`Slide ${idx + 1}: ${s.title}`}
                    aria-current={slideIndex === idx ? "step" : undefined}
                    className={`pz-progress-seg ${slideIndex === idx ? "is-current" : inCat ? "is-cat" : ""}`}
                    onClick={() => setSlideIndex(idx)}
                  />
                );
              })}
            </div>

            <div className="pz-carousel-bar">
              <div className="pz-slide-chips">
                {activeCategory.slides.map((idx) => (
                  <button
                    key={SLIDES[idx].id}
                    type="button"
                    className={`pz-slide-chip ${slideIndex === idx ? "is-active" : ""}`}
                    onClick={() => setSlideIndex(idx)}
                  >
                    {SLIDES[idx].title}
                  </button>
                ))}
              </div>
              <div className="pz-nav-arrows">
                <span className="pz-slide-counter">
                  {String(slideIndex + 1).padStart(2, "0")} / {String(SLIDES.length).padStart(2, "0")}
                </span>
                <button
                  type="button"
                  className="pz-arrow-btn"
                  aria-label="Previous sun card"
                  onClick={() => setSlideIndex((i) => (i - 1 + SLIDES.length) % SLIDES.length)}
                >
                  <ChevronStep dir={-1} />
                </button>
                <button
                  type="button"
                  className="pz-arrow-btn"
                  aria-label="Next sun card"
                  onClick={() => setSlideIndex((i) => (i + 1) % SLIDES.length)}
                >
                  <ChevronStep dir={1} />
                </button>
              </div>
            </div>
          </>
        )}

        <div className={`pz-carousel-viewport ${viewMode === "grid" ? "is-grid" : ""}`}>
          <div
            className="pz-carousel-track"
            style={
              viewMode === "carousel"
                ? { transform: `translate3d(-${slideIndex * 100}%, 0, 0)` }
                : undefined
            }
          >
            {SLIDES.map((slide, idx) => {
              const SlideIcon = slide.Icon;
              return (
                <div
                  key={slide.id}
                  className="pz-carousel-slide"
                  onFocusCapture={() => {
                    if (viewMode === "carousel" && slideIndex !== idx) setSlideIndex(idx);
                  }}
                >
                  <section
                    className={`property-card pz-sun-card ${slide.extraClass || ""}`}
                    data-card={slide.title}
                  >
                    <div className="pz-sun-card-head">
                      <div className="pz-sun-card-title">
                        <span className="pz-sun-icon-badge" style={{ color: slide.accent }}>
                          <SlideIcon size={17} />
                        </span>
                        <div>
                          <span className="pz-sun-eyebrow">{slide.eyebrow}</span>
                          <h3><span>{slide.title}</span></h3>
                        </div>
                      </div>
                      <span className="pz-sun-tag">{activeCategory.label}</span>
                    </div>
                    {slide.body}
                    {!slide.graphHandled && (
                      <PropertyGraph Children={slide.body} Title={slide.title} />
                    )}
                  </section>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
