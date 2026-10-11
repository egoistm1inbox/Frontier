import React from 'react';

export function StrataDiagram({ frequency = 18, hardness = 0.72 }) {
  const bands = Array.from({ length: 8 }, (_, i) => {
    const isHard = (i % 2 === 0);
    const width = isHard ? 180 + hardness * 30 : 160 - hardness * 20;
    return {
      y: 12 + i * 14,
      width,
      color: isHard ? '#5a5246' : '#3e372e',
      border: isHard ? '#7d7262' : '#4d453a'
    };
  });

  return (
    <svg className="strata-diagram" viewBox="0 0 240 135" role="img" aria-label="Geological Strata Preview">
      <defs>
        <pattern id="rockgrain" width="4" height="4" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="0.6" fill="#ffffff12" />
        </pattern>
      </defs>
      <rect x="20" y="10" width="200" height="115" rx="6" fill="#181818" stroke="#ffffff0a" />
      {bands.map((b, i) => (
        <g key={i}>
          <rect x={120 - b.width / 2} y={b.y} width={b.width} height="11" rx="2" fill={b.color} stroke={b.border} strokeWidth="0.8" />
          <rect x={120 - b.width / 2} y={b.y} width={b.width} height="11" fill="url(#rockgrain)" />
        </g>
      ))}
      <text x="120" y="132" fill="#757575" fontSize="8" textAnchor="middle">
        {frequency} STRATA LAYERS · HARDNESS {(hardness * 100).toFixed(0)}%
      </text>
    </svg>
  );
}

export function MaskRamp({ min = 50, max = 250, falloff = 25, total = 500, label = 'Altitude' }) {
  const toX = (val) => 20 + (Math.max(0, Math.min(total, val)) / total) * 200;
  const xMin = toX(min);
  const xMax = toX(max);
  const xMinStart = toX(min - falloff);
  const xMaxEnd = toX(max + falloff);

  const path = `M 20 80 L ${xMinStart} 80 L ${xMin} 25 L ${xMax} 25 L ${xMaxEnd} 80 L 220 80`;

  return (
    <div className="mask-ramp-diagram">
      <svg viewBox="0 0 240 95" role="img" aria-label={`${label} distribution ramp`}>
        <path d="M 20 80 H 220" stroke="#ffffff12" strokeWidth="1" />
        <path d="M 20 25 H 220" stroke="#ffffff08" strokeDasharray="2 4" strokeWidth="0.7" />
        <path d={path} fill="none" stroke="#e0c28d" strokeWidth="1.6" strokeLinecap="round" />
        <path d={`${path} V 80 H 20 Z`} fill="#e0c28d14" />
        <circle cx={xMin} cy="25" r="3.5" fill="#e0c28d" />
        <circle cx={xMax} cy="25" r="3.5" fill="#e0c28d" />
        <text x="20" y="92" fill="#666666" fontSize="8">0</text>
        <text x="220" y="92" fill="#666666" fontSize="8" textAnchor="end">{total}</text>
        <text x={(xMin + xMax) / 2} y="18" fill="#e0c28d" fontSize="9" textAnchor="middle">
          {min} – {max} (±{falloff})
        </text>
      </svg>
    </div>
  );
}
