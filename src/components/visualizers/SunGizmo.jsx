import React, { useRef, useId } from 'react';

// Solar orbit in a vertical plane above a gridded horizon.
// Azimuth turns the orbital plane; elevation moves the sun along it.
export function SunGizmo({ azimuth, elevation, onChange }) {
  const drag = useRef(null);
  const id = useId().replace(/:/g, '');
  const r = 103, cx = 180, cy = 143;
  const angle = ((azimuth - 135) * Math.PI) / 180;

  const point = (t) => [
    cx - r * Math.cos(t) * Math.cos(angle),
    cy - r * Math.sin(t) + r * 0.45 * Math.cos(t) * Math.sin(angle)
  ];

  const arc = (start) => Array.from({ length: 81 }, (_, i) => {
    const p = point(start + (i * Math.PI) / 80);
    return `${i ? 'L' : 'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  }).join(' ');

  const [x, y] = point((elevation * Math.PI) / 180);
  const [hx, hy] = point(0);
  const night = elevation < 0;

  const move = (e) => {
    if (!drag.current || !onChange) return;
    const d = drag.current;
    const nextAz = Math.round(((d.a + (e.clientX - d.x) * 0.65) % 360 + 360) % 360);
    const nextEl = Math.round(Math.max(-90, Math.min(90, d.e - (e.clientY - d.y) * 0.6)));
    onChange(nextAz, nextEl);
  };

  return (
    <div
      className="gizmo solar-orbit-gizmo"
      title="Drag horizontally for azimuth, vertically for elevation"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, a: azimuth, e: elevation };
      }}
      onPointerMove={move}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
    >
      <svg viewBox="0 0 360 260" role="img" aria-label={`Solar orbit: azimuth ${azimuth}°, elevation ${elevation}°`}>
        <defs>
          <clipPath id={id + 'horizon'}><ellipse cx={cx} cy={cy} rx={r} ry="49" /></clipPath>
          <radialGradient id={id + 'glow'}>
            <stop stopColor="#ffda87" stopOpacity="0.35" />
            <stop offset="1" stopColor="#ffda87" stopOpacity="0" />
          </radialGradient>
        </defs>

        <ellipse cx={cx} cy={cy} rx={r} ry="49" fill="#151515" fillOpacity="0.6" />
        <g clipPath={`url(#${id}horizon)`}>
          {Array.from({ length: 17 }, (_, i) => (
            <path key={i} d={`M${77 + i * 13} 94 V192 M77 ${94 + i * 13} H283`} stroke="#ffffff0e" strokeWidth="0.65" />
          ))}
        </g>
        <ellipse cx={cx} cy={cy} rx={r} ry="49" fill="none" stroke="#707070" strokeOpacity="0.65" strokeWidth="0.9" />
        <path d={arc(Math.PI)} fill="none" stroke="#77736b" strokeOpacity="0.5" strokeWidth="1" strokeDasharray="2 3" />
        <path d={arc(0)} fill="none" stroke="#e2ac5b" strokeWidth="1.8" strokeLinecap="round" />
        <line x1={x} y1={y} x2={hx} y2={hy} stroke="#b8aa8e" strokeDasharray="2 4" strokeWidth="0.8" opacity="0.55" />
        <ellipse cx={x} cy={hy} rx="6" ry="2.3" fill="#c5c0b6" opacity="0.32" />
        <circle cx={hx} cy={hy} r="5.5" fill="#181818" stroke="#f1efe7" strokeWidth="1.7" />

        {!night && <circle cx={x} cy={y} r="22" fill={`url(#${id}glow)`} />}
        <circle
          className="orbit-sun"
          cx={x}
          cy={y}
          r="8"
          fill={night ? '#9b805c' : '#f4cd75'}
          stroke={night ? '#9b805c' : '#b89045'}
          strokeWidth="1"
        />
        {!night && <circle cx={x} cy={y} r="4" fill="#fff4c7" />}

        <g textAnchor="middle" fill="#888888" fontSize="10">
          <text x="180" y="24">12h</text>
          <text x="180" y="250">24h</text>
          <text x="180" y="81">N</text>
          <text x="180" y="210">S</text>
          <text x="47" y="147">W</text>
          <text x="313" y="147">E</text>
        </g>
      </svg>
    </div>
  );
}
