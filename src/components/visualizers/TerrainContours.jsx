import React from 'react';

// Live topographical contour rings diagram directly from Frontier
export function TerrainContours({ altitude = 280, roughness = 65, erosion = 45 }) {
  const rings = Array.from({ length: 11 }, (_, i) => {
    const points = Array.from({ length: 97 }, (_, j) => {
      const a = (j / 96) * Math.PI * 2;
      const r = (14 + i * 9) * Math.sqrt(Math.max(10, altitude) / 500);
      const detail = (roughness / 100) * (1 - erosion / 180);
      const irregular = 1 + detail * (0.2 * Math.sin(a * 3 + i * 0.15) + 0.1 * Math.cos(a * 7));
      return `${310 + Math.cos(a) * r * 1.85 * irregular},${118 + Math.sin(a) * r * 0.76 * irregular}`;
    });
    return points.join(' ');
  });

  return (
    <div className="contour-diagram">
      <svg viewBox="0 0 620 238" role="img" aria-label="Terrain elevation contour diagram">
        <path d="M20 118 H600 M310 10 V225" stroke="#ffffff0c" strokeDasharray="3 5" />
        {rings.map((points, i) => (
          <polygon
            key={i}
            points={points}
            fill={i === 0 ? '#d0ba9322' : 'none'}
            stroke={i % 3 === 0 ? '#c3af8a' : '#7e7360'}
            strokeOpacity={0.85 - i * 0.045}
            strokeWidth={i % 3 === 0 ? 1 : 0.6}
          />
        ))}
        <path d="M305 118 H315 M310 113 V123" stroke="#e3c79b" />
        <text x="325" y="113" fontSize="10" fill="#d3bea0">{altitude} m</text>
        <text x="22" y="218" fontSize="9" fill="#858078">CONTOUR INTERVAL</text>
        <text x="136" y="218" fontSize="9" fill="#c3b498">{Math.max(1, Math.round(altitude / 12))} m</text>
      </svg>
    </div>
  );
}
