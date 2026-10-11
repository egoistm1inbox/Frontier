import React from 'react';

export function SlopeGauge({ angle = 38, repose = 35 }) {
  const rad = (angle * Math.PI) / 180;
  const x = 110 + 90 * Math.cos(Math.PI - rad);
  const y = 110 - 90 * Math.sin(rad);

  return (
    <div className="slope-gauge-diagram">
      <svg viewBox="0 0 240 135" role="img" aria-label={`Slope angle ${angle} degrees`}>
        {/* Horizon and base plane */}
        <line x1="20" y1="110" x2="220" y2="110" stroke="#ffffff1a" strokeWidth="1" />
        {/* Arc guide */}
        <path d="M 200 110 A 90 90 0 0 0 110 20" fill="none" stroke="#ffffff0a" strokeWidth="1" strokeDasharray="3 4" />
        
        {/* Slope line */}
        <line x1="110" y1="110" x2={x} y2={y} stroke="#c3af8a" strokeWidth="2" strokeLinecap="round" />
        
        {/* Angle wedge fill */}
        <path
          d={`M 110 110 L ${110 + 40 * Math.cos(Math.PI - rad)} ${110 - 40 * Math.sin(rad)} A 40 40 0 0 1 150 110 Z`}
          fill="#c3af8a1e"
        />

        {/* Repose line dashed */}
        {repose && (
          <line
            x1="110"
            y1="110"
            x2={110 + 80 * Math.cos(Math.PI - (repose * Math.PI) / 180)}
            y2={110 - 80 * Math.sin((repose * Math.PI) / 180)}
            stroke="#e07a5f"
            strokeWidth="1"
            strokeDasharray="2 3"
          />
        )}

        <circle cx="110" cy="110" r="3" fill="#e3c79b" />
        <circle cx={x} cy={y} r="4" fill="#f4cd75" />

        <text x="110" y="128" fill="#7d7d7d" fontSize="9" textAnchor="middle">0° Datum</text>
        <text x="25" y="105" fill="#7d7d7d" fontSize="9">90° Cliff</text>
        <text x="175" y="65" fill="#c3af8a" fontSize="12" fontWeight="300">{angle}°</text>
        {repose && <text x="60" y="45" fill="#e07a5f" fontSize="8">Repose {repose}°</text>}
      </svg>
    </div>
  );
}
