/**
 * Deterministic forkable PRNG (Mulberry32) so every (preset, seed) pair
 * produces identical high-poly botanical & groom geometry across runs.
 */
export class Random {
  private s: number;

  constructor(seed: number) {
    this.s = (seed >>> 0) || 0x9e3779b9;
  }

  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform unsigned 32-bit integer. */
  nextUint32(): number {
    return (this.next() * 4294967296) >>> 0;
  }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Symmetric uniform in [-1, 1). */
  uniform(): number {
    return this.next() * 2 - 1;
  }

  /** value ± variation. */
  vary(value: number, variation: number): number {
    return value + this.uniform() * variation;
  }

  /** Approximate standard normal via Box-Muller, clamped to [-3.2, 3.2]. */
  gauss(): number {
    const u1 = Math.max(1e-7, this.next());
    const u2 = this.next();
    const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(6.283185307179586 * u2);
    return g < -3.2 ? -3.2 : g > 3.2 ? 3.2 : g;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Fork an independent deterministic child stream. */
  fork(salt = 0x51ed270b): Random {
    return new Random((Math.floor(this.next() * 0xffffffff) ^ salt) >>> 0);
  }
}
