// Seeded random sources. Every stochastic layer draws from these, so the same
// stack and seed always produce the same terrain and texture.

// Mulberry32 sequence: returns a function that yields floats in [0, 1).
export function CreateRandom(Seed) {
  let State = (Seed >>> 0) || 0x9e3779b9;
  return function NextUnit() {
    State = (State + 0x6d2b79f5) >>> 0;
    let Mixed = State;
    Mixed = Math.imul(Mixed ^ (Mixed >>> 15), Mixed | 1);
    Mixed ^= Mixed + Math.imul(Mixed ^ (Mixed >>> 7), Mixed | 61);
    return ((Mixed ^ (Mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// Stateless integer-lattice hash in [0, 1). Used for per-cell and per-cell-of-grid draws.
export function HashUnit(X, Y, Seed) {
  let Hashed = Math.imul(X | 0, 374761393) + Math.imul(Y | 0, 668265263) + Math.imul(Seed | 0, 2246822519);
  Hashed = Math.imul(Hashed ^ (Hashed >>> 13), 1274126177);
  Hashed ^= Hashed >>> 16;
  return (Hashed >>> 0) / 4294967296;
}

// Stable 32-bit FNV-1a hash of a string. Used to key the layer depot.
export function TextHash(Text) {
  let Hashed = 0x811c9dc5;
  for (let Index = 0; Index < Text.length; Index++) {
    Hashed ^= Text.charCodeAt(Index);
    Hashed = Math.imul(Hashed, 16777619) >>> 0;
  }
  return Hashed >>> 0;
}
