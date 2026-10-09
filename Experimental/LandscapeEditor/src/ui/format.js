// Number formatting for the readouts. Kept free of React so the tests can import it.

export function formatVolume(cubicMetres) {
  const v = Math.abs(cubicMetres || 0);
  if (v >= 1e9) return (cubicMetres / 1e9).toFixed(2) + ' G m³';
  if (v >= 1e6) return (cubicMetres / 1e6).toFixed(2) + ' M m³';
  if (v >= 1e3) return (cubicMetres / 1e3).toFixed(1) + ' k m³';
  return (cubicMetres || 0).toFixed(0) + ' m³';
}

export function formatMetres(value) {
  return Math.round(value).toLocaleString('en-GB') + ' m';
}

export function formatKm(metres) {
  return (metres / 1000).toFixed(metres >= 10000 ? 0 : 1) + ' km';
}

export function formatMs(ms) {
  if (!Number.isFinite(ms)) return '—';
  return ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : Math.round(ms) + ' ms';
}
