import React from 'react';

export function ErosionChannels({ erosion = 45 }) {
  return (
    <svg className="erosion-channels" viewBox="0 0 400 125" role="img" aria-label="Erosion drainage channels">
      <path
        d="M185 6 C165 38 240 65 202 120"
        fill="none"
        stroke="#aa9a7b"
        strokeWidth={1 + erosion / 20}
      />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
        <path
          key={n}
          d={`M${n % 2 ? 300 + n * 9 : 65 + n * 7} ${n * 11 + 3} Q${n % 2 ? 245 : 130} ${n * 12 + 4} ${190 + Math.sin(n) * 12} ${n * 12 + 22}`}
          fill="none"
          stroke="#a99a80"
          strokeWidth={0.4 + erosion / 75}
          opacity={0.2 + erosion / 140}
        />
      ))}
    </svg>
  );
}
