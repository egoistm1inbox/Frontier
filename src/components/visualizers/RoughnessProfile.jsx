import React from 'react';

export function RoughnessProfile({ roughness = 62 }) {
  const points = Array.from({ length: 100 }, (_, i) =>
    `${i * 4},${65 - (Math.sin(i * 0.17) * 0.4 + Math.sin(i * 0.72) * 0.24 + Math.sin(i * 1.7) * 0.1) * roughness * 0.65}`
  ).join(' ');

  return (
    <svg className="roughness-profile" viewBox="0 0 400 125" role="img" aria-label="Surface roughness profile">
      <path d="M0 65 H400" stroke="#ffffff13" strokeDasharray="3 4" />
      <polygon points={`0,120 ${points} 400,120`} fill="#bfac9109" />
      <polyline points={points} stroke="#bca887" strokeWidth="1.3" fill="none" />
    </svg>
  );
}
