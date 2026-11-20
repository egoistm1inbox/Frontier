import React, { useState, useId } from 'react';
import { ChevronLeft, ChevronRight, LayoutGrid, GalleryHorizontalEnd } from 'lucide-react';
import { SunGizmo } from './environment-graphics.jsx';

/* ── Bespoke Solar Instrument Icon Family (distinct icon per card & control) ── */

export function SolarCoreIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.4" fill="currentColor" fillOpacity=".18" />
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

export function DiagArrowGlyph({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 11.5 11.5 4.5M6 4.5h5.5V10" />
    </svg>
  );
}

/* ── Helpers ── */

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const bearingCompass = (az) => COMPASS[Math.round((((az % 360) + 360) % 360) / 45) % 8];

function kelvinToHex(k) {
  const t = Math.max(1500, Math.min(15000, k)) / 100;
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
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
}

function solarPhaseLabel(elevation) {
  if (elevation >= 45) return { name: 'High Sun', tone: 'day' };
  if (elevation >= 14) return { name: 'Daylight', tone: 'day' };
  if (elevation >= 0) return { name: 'Golden Hour', tone: 'golden' };
  if (elevation >= -8) return { name: 'Civil Twilight', tone: 'twilight' };
  return { name: 'Below Horizon', tone: 'night' };
}

function formatClock(hours) {
  const wrapped = ((hours % 24) + 24) % 24;
  const hh = Math.floor(wrapped);
  const mm = Math.round((wrapped - hh) * 60) % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

const SOLAR_PRESETS = [
  { id: 'dawn', label: 'Dawn', time: 6.0, azimuth: 92, elevation: 4, temperature: 3400, intensity: 36 },
  { id: 'morning', label: 'Morning', time: 9.0, azimuth: 118, elevation: 32, temperature: 5100, intensity: 94 },
  { id: 'zenith', label: 'Zenith', time: 12.0, azimuth: 180, elevation: 64, temperature: 5800, intensity: 132 },
  { id: 'golden', label: 'Golden', time: 16.5, azimuth: 242, elevation: 12, temperature: 3800, intensity: 68 },
  { id: 'dusk', label: 'Twilight', time: 19.0, azimuth: 274, elevation: -5, temperature: 4200, intensity: 14 },
  { id: 'night', label: 'Night', time: 0.0, azimuth: 0, elevation: -38, temperature: 6800, intensity: 0 },
];

/* ── Reference-Inspired Telemetry Charts ── */

function BentoIlluminanceChart({ intensity }) {
  const uid = useId().replace(/:/g, '');
  const t = Math.max(0, Math.min(1, intensity / 150));
  const yAt = (u) => 104 - 76 * (1 - Math.cos((u * Math.PI) / 2));
  const fullPath = Array.from({ length: 65 }, (_, i) => {
    const u = i / 64;
    return `${i ? 'L' : 'M'}${(18 + u * 344).toFixed(1)},${yAt(u).toFixed(1)}`;
  }).join(' ');
  const activePath = Array.from({ length: 49 }, (_, i) => {
    const u = (t * i) / 48;
    return `${i ? 'L' : 'M'}${(18 + u * 344).toFixed(1)},${yAt(u).toFixed(1)}`;
  }).join(' ');
  const cx = 18 + t * 344;
  const cy = yAt(t);
  const pct = Math.round(t * 100);
  const pillX = Math.max(54, Math.min(306, cx));
  const pillY = Math.max(24, cy - 22);

  return (
    <svg className="sun-bento-svg" viewBox="0 0 380 128" role="img" aria-label={`Illuminance response: ${intensity} of 150 kilolux`}>
      <defs>
        <pattern id={`${uid}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(42)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#f0c36d" strokeOpacity=".22" strokeWidth="1.4" />
        </pattern>
        <linearGradient id={`${uid}-wash`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f0c36d" stopOpacity=".24" />
          <stop offset="100%" stopColor="#f0c36d" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[28, 54, 80, 104].map((gy) => (
        <line key={gy} x1="18" y1={gy} x2="362" y2={gy} stroke="#ffffff" strokeOpacity=".06" strokeDasharray={gy === 54 ? '3 4' : undefined} />
      ))}
      {[18, 104, 190, 276, 362].map((gx) => (
        <line key={gx} x1={gx} y1="18" x2={gx} y2="104" stroke="#ffffff" strokeOpacity=".045" />
      ))}
      <path d={`${fullPath} L362,104 L18,104 Z`} fill="#ffffff" fillOpacity=".02" />
      <path d={fullPath} fill="none" stroke="#ffffff" strokeOpacity=".18" strokeWidth="1.3" />
      {t > 0.005 && (
        <>
          <path d={`${activePath} L${cx.toFixed(1)},104 L18,104 Z`} fill={`url(#${uid}-wash)`} />
          <path d={`${activePath} L${cx.toFixed(1)},104 L18,104 Z`} fill={`url(#${uid}-hatch)`} />
          <path d={activePath} fill="none" stroke="#f3c878" strokeWidth="2" strokeLinecap="round" />
        </>
      )}
      <line x1={cx} y1="18" x2={cx} y2="104" stroke="#f3c878" strokeOpacity=".35" strokeDasharray="2 3" />
      <circle cx={cx} cy={cy} r="9" fill="#f3c878" fillOpacity=".15" />
      <circle cx={cx} cy={cy} r="3.8" fill="#111316" stroke="#f7d996" strokeWidth="2" />
      <g transform={`translate(${pillX}, ${pillY})`}>
        <rect x="-32" y="-11" width="64" height="20" rx="10" fill="#e06342" />
        <text x="0" y="2.5" textAnchor="middle" fill="#fff8f4" fontSize="9.5" fontWeight="600">
          {pct}% flux
        </text>
      </g>
      <g fill="#7c828d" fontSize="8.5">
        <text x="18" y="120">0 klux</text>
        <text x="104" y="120">38k</text>
        <text x="190" y="120" textAnchor="middle">75k</text>
        <text x="276" y="120" textAnchor="middle">112k</text>
        <text x="362" y="120" textAnchor="end">150 klux</text>
      </g>
    </svg>
  );
}

function BentoDiurnalChart({ time }) {
  const uid = useId().replace(/:/g, '');
  const yAt = (t) => 66 - 42 * Math.sin(((t - 6) / 24) * Math.PI * 2);
  const full = Array.from({ length: 97 }, (_, i) => {
    const h = i / 4;
    return `${i ? 'L' : 'M'}${(18 + (i / 96) * 344).toFixed(1)},${yAt(h).toFixed(1)}`;
  }).join(' ');
  const dayArc = Array.from({ length: 49 }, (_, i) => {
    const h = 6 + i / 4;
    return `${i ? 'L' : 'M'}${(104 + (i / 48) * 172).toFixed(1)},${yAt(h).toFixed(1)}`;
  }).join(' ');
  const cx = 18 + (time / 24) * 344;
  const cy = yAt(time);
  const isDay = time >= 6 && time < 18;
  const label = formatClock(time);
  const pillX = Math.max(42, Math.min(338, cx));

  return (
    <svg className="sun-bento-svg" viewBox="0 0 380 138" role="img" aria-label={`24-hour daylight cycle, selected time ${label}`}>
      <defs>
        <linearGradient id={`${uid}-day`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f2c46d" stopOpacity=".22" />
          <stop offset="100%" stopColor="#f2c46d" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="104" y="16" width="172" height="88" rx="8" fill="#f2c46d" fillOpacity=".035" />
      <line x1="18" y1="66" x2="362" y2="66" stroke="#ffffff" strokeOpacity=".16" strokeDasharray="3 4" />
      <text x="358" y="61" textAnchor="end" fill="#7c828d" fontSize="8">HORIZON 0°</text>
      <path d={full} fill="none" stroke="#8a909c" strokeOpacity=".38" strokeWidth="1.35" />
      <path d={`${dayArc} L276,66 L104,66 Z`} fill={`url(#${uid}-day)`} />
      <path d={dayArc} fill="none" stroke="#f3c774" strokeWidth="2" strokeLinecap="round" />
      <line x1={cx} y1="16" x2={cx} y2="106" stroke="#e5ebf5" strokeOpacity=".42" />
      <circle cx={cx} cy={cy} r="10" fill={isDay ? '#f3c774' : '#8ea6dc'} fillOpacity=".18" />
      <circle cx={cx} cy={cy} r="4.2" fill="#0f1114" stroke={isDay ? '#fde2a3' : '#b7caef'} strokeWidth="2" />
      {[0, 6, 12, 18, 24].map((tick) => {
        const tx = 18 + (tick / 24) * 344;
        return (
          <text key={tick} x={tx} y="124" textAnchor={tick === 0 ? 'start' : tick === 24 ? 'end' : 'middle'} fill="#757b86" fontSize="8.5">
            {String(tick).padStart(2, '0')}:00
          </text>
        );
      })}
      <g transform={`translate(${pillX}, 121)`}>
        <rect x="-22" y="-10" width="44" height="16" rx="8" fill="#f2f4f8" />
        <text x="0" y="1" textAnchor="middle" fill="#0e1013" fontSize="8.5" fontWeight="600">
          {label}
        </text>
      </g>
    </svg>
  );
}

function BentoKelvinChart({ temperature }) {
  const uid = useId().replace(/:/g, '');
  const t = Math.max(0, Math.min(1, (temperature - 2000) / 8000));
  const cx = 18 + t * 344;
  const bell = (u) => {
    const center = 0.12 + t * 0.72;
    return 94 - 64 * Math.exp(-Math.pow((u - center) / 0.28, 2));
  };
  const curve = Array.from({ length: 65 }, (_, i) => {
    const u = i / 64;
    return `${i ? 'L' : 'M'}${(18 + u * 344).toFixed(1)},${bell(u).toFixed(1)}`;
  }).join(' ');
  const cy = bell(t);
  const swatch = kelvinToHex(temperature);

  return (
    <svg className="sun-bento-svg" viewBox="0 0 380 116" role="img" aria-label={`Blackbody colour temperature ${temperature} Kelvin`}>
      <defs>
        <linearGradient id={`${uid}-kelvin`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ff9b52" />
          <stop offset="32%" stopColor="#ffd79c" />
          <stop offset="56%" stopColor="#fff4e4" />
          <stop offset="80%" stopColor="#cde0ff" />
          <stop offset="100%" stopColor="#9ec0ff" />
        </linearGradient>
      </defs>
      {[32, 63, 94].map((gy) => (
        <line key={gy} x1="18" y1={gy} x2="362" y2={gy} stroke="#ffffff" strokeOpacity=".055" />
      ))}
      <path d={`${curve} L362,94 L18,94 Z`} fill={`url(#${uid}-kelvin)`} fillOpacity=".12" />
      <path d={curve} fill="none" stroke={`url(#${uid}-kelvin)`} strokeWidth="2" strokeLinecap="round" />
      <rect x="18" y="101" width="344" height="4" rx="2" fill={`url(#${uid}-kelvin)`} opacity=".82" />
      <line x1={cx} y1="22" x2={cx} y2="105" stroke={swatch} strokeOpacity=".5" strokeDasharray="2 3" />
      <circle cx={cx} cy={cy} r="4.2" fill="#101215" stroke={swatch} strokeWidth="2.2" />
    </svg>
  );
}

function SolarTickRuler({ time, onSelectTime }) {
  const ticks = 33;
  const activeIdx = Math.round((Math.max(0, Math.min(24, time)) / 24) * (ticks - 1));
  return (
    <div className="sun-tick-ruler" role="group" aria-label="Diurnal timeline">
      <div className="sun-tick-labels">
        <span>00:00</span>
        <span>06:00 RISE</span>
        <span>12:00 NOON</span>
        <span>18:00 SET</span>
        <span>24:00</span>
      </div>
      <div className="sun-tick-track">
        {Array.from({ length: ticks }, (_, i) => {
          const hour = (i / (ticks - 1)) * 24;
          const isDay = hour >= 6 && hour <= 18;
          const isCurrent = i === activeIdx;
          return (
            <button
              key={i}
              type="button"
              className={`sun-tick-bar ${isDay ? 'is-day' : ''} ${isCurrent ? 'is-current' : ''}`}
              title={`Set solar clock to ${formatClock(hour)}`}
              aria-label={`Solar clock ${formatClock(hour)}`}
              onClick={() => onSelectTime(Math.round(hour * 2) / 2)}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ── Main FrontierEditor Redesigned Sun Inspector ── */

export default function SolarInspector({ v, set, slider, num, featureOn, flareChild, onSelectChild }) {
  const [slideIndex, setSlideIndex] = useState(0);
  const [viewMode, setViewMode] = useState('carousel');

  const elevation = v('elevation');
  const azimuth = v('azimuth');
  const intensity = v('intensity');
  const temperature = v('temperature');
  const time = v('time');
  const discSize = v('discSize');

  const phase = solarPhaseLabel(elevation);
  const kelvinColor = kelvinToHex(temperature);
  const fluxPct = Math.round((intensity / 150) * 100);

  const CATEGORIES = [
    {
      id: 'trajectory',
      label: 'Trajectory',
      icon: SolarOrbitGlyph,
      slides: [0, 1],
    },
    {
      id: 'photometry',
      label: 'Photometry',
      icon: SolarFluxGlyph,
      slides: [2, 3],
    },
    {
      id: 'disc',
      label: 'Solar Disc',
      icon: SolarDiscGlyph,
      slides: [4],
    },
  ];

  const activeCategory = CATEGORIES.find((cat) => cat.slides.includes(slideIndex)) || CATEGORIES[0];

  const applyPreset = (preset) => {
    set('time', preset.time);
    set('azimuth', preset.azimuth);
    set('elevation', preset.elevation);
    set('temperature', preset.temperature);
    set('intensity', preset.intensity);
  };

  const jumpToSlide = (idx) => {
    setSlideIndex(Math.max(0, Math.min(4, idx)));
    setViewMode('carousel');
  };

  const scrollToBaking = () => {
    const el = document.querySelector('.bake-quick-area');
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  const smartTiles = [
    {
      key: 'Illuminance',
      label: 'Sunlight',
      subtitle: featureOn('Illuminance') ? `On · ${intensity} klux` : 'Muted · 0 klux',
      Icon: SolarFluxGlyph,
      on: featureOn('Illuminance'),
      slide: 2,
      inverted: true,
    },
    {
      key: 'Sun disc',
      label: 'Sun disc',
      subtitle: featureOn('Sun disc') ? `On · ${Number(discSize).toFixed(2)}° limb` : 'Hidden in sky',
      Icon: SolarDiscGlyph,
      on: featureOn('Sun disc'),
      slide: 4,
    },
    {
      key: 'Daylight cycle',
      label: 'Day cycle',
      subtitle: featureOn('Daylight cycle') ? `Active · ${formatClock(time)}` : 'Locked clock',
      Icon: SolarDiurnalGlyph,
      on: featureOn('Daylight cycle'),
      slide: 1,
    },
  ];

  const SLIDES = [
    {
      id: 'direction',
      category: 'trajectory',
      title: 'Sun direction',
      eyebrow: 'ORBIT & BEARING',
      Icon: SolarOrbitGlyph,
      featureKey: null,
      accent: '#f0be67',
      body: (
        <>
          <div className="sun-slide-hero-row">
            <div>
              <div className="sun-bento-figure">
                {num('elevation', '°')}
              </div>
              <p className="sun-bento-sub">
                {elevation < 0 ? 'Solar vector below local horizon' : `${bearingCompass(azimuth)} bearing · ${azimuth}° clockwise`}
              </p>
            </div>
            <span className={`sun-phase-chip tone-${phase.tone}`}>
              <i />
              {phase.name}
            </span>
          </div>
          <div className="sun-orbit-stage">
            <SunGizmo
              azimuth={azimuth}
              elevation={elevation}
              onChange={(a, e) => {
                set('azimuth', a);
                set('elevation', e);
              }}
            />
          </div>
          <div className="sun-dual-sliders">
            <label className="sun-slider-box">
              <div className="sun-slider-head">
                <span>Azimuth</span>
                <strong>{azimuth}° · {bearingCompass(azimuth)}</strong>
              </div>
              {slider('azimuth', 0, 360)}
            </label>
            <label className="sun-slider-box">
              <div className="sun-slider-head">
                <span>Elevation</span>
                <strong>{elevation > 0 ? `+${elevation}` : elevation}°</strong>
              </div>
              {slider('elevation', -90, 90)}
            </label>
          </div>
        </>
      ),
    },
    {
      id: 'cycle',
      category: 'trajectory',
      title: 'Daylight cycle',
      eyebrow: 'DIURNAL PROGRESSION',
      Icon: SolarDiurnalGlyph,
      featureKey: 'Daylight cycle',
      accent: '#e7c57c',
      body: (
        <>
          <div className="sun-slide-hero-row">
            <div>
              <div className="sun-bento-figure sun-clock-figure">
                <span>{String(Math.floor(time)).padStart(2, '0')}</span>
                <span className="sun-clock-muted">:{time % 1 >= 0.5 ? '30' : '00'}</span>
              </div>
              <p className="sun-bento-sub">Local solar time · 24-hour diurnal curve</p>
            </div>
            <span className="sun-pill-tag">
              {time < 6 || time >= 18 ? 'Nocturnal' : time < 12 ? 'Morning climb' : time < 17 ? 'Afternoon' : 'Golden dusk'}
            </span>
          </div>
          <BentoDiurnalChart time={time} />
          {slider('time', 0, 24, 0.5)}
          <SolarTickRuler time={time} onSelectTime={(h) => set('time', h)} />
        </>
      ),
    },
    {
      id: 'illuminance',
      category: 'photometry',
      title: 'Illuminance',
      eyebrow: 'DIRECT SOLAR FLUX',
      Icon: SolarFluxGlyph,
      featureKey: 'Illuminance',
      accent: '#ecc86e',
      body: (
        <>
          <div className="sun-activity-split">
            <div className="sun-activity-left">
              <div className="sun-bento-figure">{num('intensity', 'klux')}</div>
              <p className="sun-bento-sub">Direct beam on datum</p>
              <div className="sun-mini-kpis">
                <div>
                  <span>Peak ratio</span>
                  <strong>{fluxPct}%</strong>
                  <em className={fluxPct >= 50 ? 'up' : 'warm'}>{fluxPct >= 50 ? 'High' : 'Soft'}</em>
                </div>
                <div>
                  <span>Atm. airmass</span>
                  <strong>{elevation > 3 ? `${(1 / Math.max(0.08, Math.sin((elevation * Math.PI) / 180))).toFixed(1)} AM` : 'Twil.'}</strong>
                  <em className="muted">{elevation}°</em>
                </div>
              </div>
            </div>
            <div className="sun-activity-right">
              <BentoIlluminanceChart intensity={intensity} />
            </div>
          </div>
          {slider('intensity', 0, 150)}
          <div className="sun-range-ends">
            <span>0 klux · Dark</span>
            <span>75 klux · Overcast</span>
            <span>150 klux · Desert noon</span>
          </div>
        </>
      ),
    },
    {
      id: 'temperature',
      category: 'photometry',
      title: 'Temperature',
      eyebrow: 'BLACKBODY CHROMATICITY',
      Icon: SolarKelvinGlyph,
      featureKey: null,
      accent: '#efa57b',
      body: (
        <>
          <div className="sun-slide-hero-row">
            <div>
              <div className="sun-bento-figure">{num('temperature', 'K')}</div>
              <p className="sun-bento-sub">
                {temperature < 4200 ? 'Low-angle warm amber spectrum' : temperature > 7000 ? 'Cool sky-dominated daylight' : 'Balanced natural photosphere'}
              </p>
            </div>
            <span className="sun-kelvin-badge">
              <i style={{ background: kelvinColor }} />
              {temperature < 4200 ? 'Warm' : temperature > 7000 ? 'Cool' : 'Daylight'}
            </span>
          </div>
          <BentoKelvinChart temperature={temperature} />
          <div className="temperature-track">{slider('temperature', 2000, 10000, 100)}</div>
          <div className="sun-kelvin-presets" role="group" aria-label="Kelvin presets">
            {[
              ['Candle · 2700K', 2700],
              ['Golden · 3800K', 3800],
              ['Noon · 5600K', 5600],
              ['Shade · 7500K', 7500],
            ].map(([label, k]) => (
              <button
                key={k}
                type="button"
                className={Math.abs(temperature - k) <= 150 ? 'is-active' : ''}
                onClick={() => set('temperature', k)}
              >
                <i style={{ background: kelvinToHex(k) }} />
                {label}
              </button>
            ))}
          </div>
        </>
      ),
    },
    {
      id: 'disc',
      category: 'disc',
      title: 'Sun disc',
      eyebrow: 'ANGULAR LIMB & PENUMBRA',
      Icon: SolarDiscGlyph,
      featureKey: 'Sun disc',
      accent: '#f2bf72',
      body: (
        <>
          <div className="sun-disc-bento">
            <div className="sun-disc-readout">
              <div className="sun-bento-figure">{num('discSize', '°', 2)}</div>
              <p className="sun-bento-sub">Apparent photosphere diameter (Earth mean 0.53°)</p>
              <div className="sun-stepper-row" role="group" aria-label="Fine angular diameter steppers">
                <button
                  type="button"
                  className="sun-circle-stepper"
                  aria-label="Decrease sun disc size"
                  onClick={() => set('discSize', +Math.max(0.1, discSize - 0.05).toFixed(2))}
                >
                  −
                </button>
                <button
                  type="button"
                  className="sun-stepper-reset"
                  onClick={() => set('discSize', 0.53)}
                >
                  0.53° Earth
                </button>
                <button
                  type="button"
                  className="sun-circle-stepper"
                  aria-label="Increase sun disc size"
                  onClick={() => set('discSize', +Math.min(2, discSize + 0.05).toFixed(2))}
                >
                  +
                </button>
              </div>
            </div>
            <div className="sun-disc-chamber" aria-hidden="true">
              <div className="sun-disc-halo" style={{ width: 34 + discSize * 38, height: 34 + discSize * 38, borderColor: kelvinColor }} />
              <div className="sun-disc-core" style={{ width: 16 + discSize * 28, height: 16 + discSize * 28, background: kelvinColor }} />
              <span className="sun-disc-caliper">Ø {Number(discSize).toFixed(2)}°</span>
            </div>
          </div>
          {slider('discSize', 0.1, 2, 0.01)}
          <div className="sun-range-ends">
            <span>0.10° · Razor shadow</span>
            <span>0.53° · Physical</span>
            <span>2.00° · Soft penumbra</span>
          </div>
        </>
      ),
    },
  ];

  return (
    <div className="sun-redesign-shell">
      {/* 1. Preset Moment Pill Strip (Image 3 & 4) */}
      <div className="sun-preset-strip" role="group" aria-label="Solar time presets">
        {SOLAR_PRESETS.map((preset) => {
          const active = Math.abs(time - preset.time) < 0.6 && Math.abs(elevation - preset.elevation) < 8;
          return (
            <button
              key={preset.id}
              type="button"
              className={`sun-preset-pill ${active ? 'is-active' : ''}`}
              onClick={() => applyPreset(preset)}
            >
              <span className="sun-preset-dot" style={{ background: kelvinToHex(preset.temperature) }} />
              <span>{preset.label}</span>
              <small>{formatClock(preset.time)}</small>
            </button>
          );
        })}
      </div>

      {/* 2. Dual Bento Telemetry KPI Row (Image 2 vertical-bar status + Image 4 hatched comparison) */}
      <div className="sun-kpi-duo">
        <div className={`sun-kpi-card tone-${phase.tone}`} onClick={() => jumpToSlide(0)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && jumpToSlide(0)}>
          <div className="sun-kpi-head">
            <span className="sun-kpi-bar" />
            <span className="sun-kpi-title">{phase.name}</span>
            <span className="sun-kpi-corner"><DiagArrowGlyph /></span>
          </div>
          <div className="sun-kpi-delta">
            <span className={elevation >= 0 ? 'is-up' : 'is-down'}>
              {elevation >= 0 ? '▲ Above horizon' : '▼ Below horizon'}
            </span>
          </div>
          <div className="sun-kpi-bottom">
            <strong className="sun-kpi-big">
              {elevation > 0 ? `+${elevation}` : elevation}
              <small>°</small>
            </strong>
            <span className="sun-kpi-meta">{bearingCompass(azimuth)} · {formatClock(time)}</span>
          </div>
        </div>

        <div className="sun-kpi-card is-flux" onClick={() => jumpToSlide(2)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && jumpToSlide(2)}>
          <div className="sun-kpi-head">
            <span className="sun-kpi-bar is-amber" />
            <span className="sun-kpi-title">Direct Radiance</span>
            <span className="sun-kpi-corner"><DiagArrowGlyph /></span>
          </div>
          <div className="sun-kpi-bottom is-compact">
            <strong className="sun-kpi-big">
              {intensity}
              <small>klux</small>
            </strong>
            <span className="sun-kpi-meta">{temperature.toLocaleString('en-US')} K</span>
          </div>
          <div className="sun-compare-blocks" aria-hidden="true">
            <div className="sun-compare-hatched">
              <small>Ceiling</small>
              <span>150k</span>
            </div>
            <div className="sun-compare-solid" style={{ '--flux-fill': kelvinColor }}>
              <small>Output</small>
              <span>{fluxPct}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Smart-Home Tactile Bento Quick Tiles (Image 5) */}
      <div className="sun-smart-grid" role="group" aria-label="Sun feature switches">
        {smartTiles.map((tile) => {
          const TileIcon = tile.Icon;
          return (
            <div
              key={tile.key}
              className={`sun-smart-tile ${tile.on ? 'is-on' : 'is-off'} ${tile.inverted && tile.on ? 'is-spotlight' : ''}`}
            >
              <div className="sun-smart-top">
                <span className="sun-icon-circle">
                  <TileIcon size={17} />
                </span>
                <button
                  type="button"
                  className="sun-corner-jump"
                  aria-label={`Inspect ${tile.label}`}
                  title={`Open ${tile.label} card`}
                  onClick={() => jumpToSlide(tile.slide)}
                >
                  <DiagArrowGlyph />
                </button>
              </div>
              <div className="sun-smart-copy">
                <strong>{tile.label}</strong>
                <span>{tile.subtitle}</span>
              </div>
              <div className="sun-smart-foot">
                <button
                  type="button"
                  className={`sun-capsule-switch ${tile.on ? 'is-on' : ''}`}
                  aria-label={`Toggle ${tile.label}`}
                  aria-pressed={tile.on}
                  onClick={() => set('feature:' + tile.key, !tile.on)}
                >
                  <span className="sun-capsule-thumb" />
                </button>
              </div>
            </div>
          );
        })}

        {flareChild && (
          <button
            type="button"
            className="sun-smart-tile is-subcomponent"
            onClick={() => onSelectChild(flareChild.id)}
          >
            <div className="sun-smart-top">
              <span className="sun-icon-circle is-flare">
                <SolarFlareGlyph size={17} />
              </span>
              <span className="sun-corner-jump">
                <DiagArrowGlyph />
              </span>
            </div>
            <div className="sun-smart-copy">
              <strong>{flareChild.name}</strong>
              <span>Optical ghosts & streaks</span>
            </div>
            <div className="sun-smart-foot">
              <span className="sun-sub-pill">Subcomponent</span>
            </div>
          </button>
        )}
      </div>

      {/* 4. Categorized Carousel Navigation + Segmented Progress Rail (Images 2, 5, 6) */}
      <div className="sun-carousel-shell">
        <div className="sun-category-bar">
          <div className="sun-category-tabs" role="tablist" aria-label="Sun inspector categories">
            {CATEGORIES.map((cat) => {
              const CatIcon = cat.icon;
              const isActive = activeCategory.id === cat.id && viewMode === 'carousel';
              return (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`sun-cat-tab ${isActive ? 'is-active' : ''}`}
                  onClick={() => jumpToSlide(cat.slides[0])}
                >
                  <CatIcon size={14} />
                  <span>{cat.label}</span>
                  <sup>{cat.slides.length}</sup>
                </button>
              );
            })}
            <button
              type="button"
              className="sun-cat-tab is-bake-jump"
              onClick={scrollToBaking}
              title="Scroll to Baking cards"
            >
              <SolarBakeGlyph size={14} />
              <span>Baking</span>
              <sup>2</sup>
            </button>
          </div>

          <div className="sun-carousel-actions">
            <button
              type="button"
              className="sun-view-toggle"
              aria-label={viewMode === 'carousel' ? 'Show all sun cards in grid' : 'Switch to carousel view'}
              title={viewMode === 'carousel' ? 'Grid view' : 'Carousel view'}
              onClick={() => setViewMode((m) => (m === 'carousel' ? 'grid' : 'carousel'))}
            >
              {viewMode === 'carousel' ? <LayoutGrid size={14} /> : <GalleryHorizontalEnd size={14} />}
              <span>{viewMode === 'carousel' ? 'Grid' : 'Carousel'}</span>
            </button>
          </div>
        </div>

        {/* Image-6 Segmented Progress Indicator Bars */}
        {viewMode === 'carousel' && (
          <>
            <div className="sun-progress-rail" role="group" aria-label="Carousel slide progress">
              {SLIDES.map((slide, idx) => {
                const inCat = activeCategory.slides.includes(idx);
                return (
                  <button
                    key={slide.id}
                    type="button"
                    aria-label={`Slide ${idx + 1}: ${slide.title}`}
                    aria-current={slideIndex === idx ? 'step' : undefined}
                    className={`sun-progress-seg ${slideIndex === idx ? 'is-current' : inCat ? 'is-cat' : ''}`}
                    onClick={() => setSlideIndex(idx)}
                  />
                );
              })}
            </div>

            <div className="sun-carousel-nav">
              <div className="sun-slide-pills">
                {activeCategory.slides.map((idx) => {
                  const s = SLIDES[idx];
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`sun-slide-pill ${slideIndex === idx ? 'is-active' : ''}`}
                      onClick={() => setSlideIndex(idx)}
                    >
                      {s.title}
                    </button>
                  );
                })}
              </div>
              <div className="sun-arrow-pair">
                <span className="sun-slide-count">
                  {String(slideIndex + 1).padStart(2, '0')} / {String(SLIDES.length).padStart(2, '0')}
                </span>
                <button
                  type="button"
                  className="sun-nav-circle"
                  aria-label="Previous sun card"
                  onClick={() => setSlideIndex((i) => (i - 1 + SLIDES.length) % SLIDES.length)}
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  type="button"
                  className="sun-nav-circle"
                  aria-label="Next sun card"
                  onClick={() => setSlideIndex((i) => (i + 1) % SLIDES.length)}
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </>
        )}

        {/* Carousel Viewport / Grid Track */}
        <div className={`sun-carousel-viewport ${viewMode === 'grid' ? 'is-grid' : ''}`}>
          <div
            className="sun-carousel-track"
            style={viewMode === 'carousel' ? { transform: `translate3d(-${slideIndex * 100}%, 0, 0)` } : undefined}
          >
            {SLIDES.map((slide, idx) => {
              const SlideIcon = slide.Icon;
              const disabled = slide.featureKey && !featureOn(slide.featureKey);
              return (
                <div
                  key={slide.id}
                  className="sun-carousel-slide"
                  onFocusCapture={() => {
                    if (viewMode === 'carousel' && slideIndex !== idx) setSlideIndex(idx);
                  }}
                >
                  <section
                    className={`card sun-bento-card ${disabled ? 'feature-disabled' : ''}`}
                    style={{ '--card-icon': slide.accent }}
                    data-sun-slide={slide.id}
                  >
                    <div className="sun-card-head">
                      <div className="sun-card-title-group">
                        <span className="sun-card-icon-badge" style={{ color: slide.accent }}>
                          <SlideIcon size={18} />
                        </span>
                        <div>
                          <span className="sun-card-eyebrow">{slide.eyebrow}</span>
                          <h3>{slide.title}</h3>
                        </div>
                      </div>
                      {disabled ? (
                        <button
                          type="button"
                          className="sun-card-enable-chip"
                          onClick={() => set('feature:' + slide.featureKey, true)}
                        >
                          OFF · Enable
                        </button>
                      ) : (
                        <span className="sun-card-cat-tag">{activeCategory.label}</span>
                      )}
                    </div>
                    <fieldset className="card-body sun-card-body" disabled={!!disabled} inert={disabled ? '' : undefined}>
                      {slide.body}
                    </fieldset>
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
