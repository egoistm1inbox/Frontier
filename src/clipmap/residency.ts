// Residency manager for the sparse clipmap.
//
//  * Each level keeps a toroidal window of GRID bricks centred on the camera. A texel of the
//    page table always holds the brick whose index ≡ texel (mod GRID), so moving the camera
//    only touches the bricks on the entering face (no re-indexing of the whole window).
//  * Bricks are classified (uniform air / uniform solid / mixed) with a conservative CPU test.
//    Uniform bricks cost no atlas slot. Mixed bricks are generated on the GPU, budgeted per frame.
//  * When the atlas is full, the farthest resident brick is evicted if the candidate is much closer.
//  * Edited bricks are read back to a CPU cache when they leave the window or are evicted, and
//    re-uploaded from that cache on return. Unedited bricks are simply regenerated.
import { STREAM, POOL } from '../config.ts';
import { SlotPool } from './slotPool.ts';
import {
  GRID, GRID_TEXELS, LEVELS, type V3, brickCenter, pageCodeIndex, posMod, texelIndex,
  windowBase, PAGE_DIMS, brickSize,
} from './layout.ts';

export const CODE_AIR = -1;
export const CODE_SOLID = -2;
export const CODE_PENDING = -3;

export type BrickClass = 'air' | 'solid' | 'mixed';
export type BrickState = 'unclassified' | 'air' | 'solid' | 'needs-gen' | 'resident';

export interface Brick {
  level: number;
  x: number;
  y: number;
  z: number;
  state: BrickState;
  slot: number;
  edited: boolean;
  texel: number;
}

export interface ClipBackend {
  /** Generate the analytic base field (plus fine octave) into a slot. */
  generate(slot: number, level: number, x: number, y: number, z: number): void;
  /** Upload stored samples (34³, cell-normalised floats) into a slot. */
  upload(slot: number, data: Float32Array): void;
  /** Read stored samples back from a slot. */
  readback(slot: number): Float32Array;
  /** Replace the whole page-table texture. */
  writePage(codes: Int16Array): void;
}

export type Classifier = (level: number, x: number, y: number, z: number) => BrickClass;

export interface ResidencyStats {
  classified: number;
  generated: number;
  uploaded: number;
  pressureEvictions: number;
  windowRetirements: number;
  readbacks: number;
  resident: number;
  uniformAir: number;
  uniformSolid: number;
  pending: number;
  cached: number;
}

function brickKey(level: number, x: number, y: number, z: number): string {
  return `${level}/${x}/${y}/${z}`;
}

export class ClipmapResidency {
  /** Per level: current window base (brick index of texel (0,0,0) before toroidal wrap). */
  readonly base: V3[];
  private readonly texels: Array<Array<Brick | null>>;
  readonly pageCodes: Int16Array;
  readonly pool: SlotPool;
  /** Edited brick samples, keyed by "level/x/y/z". Survives window changes. */
  readonly cache = new Map<string, Float32Array>();
  private pageDirty = true;
  private readbacksThisFrame = 0;
  private cam: V3 = [0, 0, 0];
  readonly stats: ResidencyStats = {
    classified: 0, generated: 0, uploaded: 0, pressureEvictions: 0, windowRetirements: 0,
    readbacks: 0, resident: 0, uniformAir: 0, uniformSolid: 0, pending: 0, cached: 0,
  };

  private readonly backend: ClipBackend;
  private readonly classify: Classifier;

  constructor(backend: ClipBackend, classify: Classifier, slots: number = POOL.slots) {
    this.backend = backend;
    this.classify = classify;
    this.pool = new SlotPool(slots);
    this.base = Array.from({ length: LEVELS }, () => [NaN, NaN, NaN] as V3);
    this.texels = Array.from({ length: LEVELS }, () => new Array<Brick | null>(GRID_TEXELS).fill(null));
    this.pageCodes = new Int16Array(PAGE_DIMS[0] * PAGE_DIMS[1] * PAGE_DIMS[2]).fill(CODE_PENDING);
  }

  /** Advance windows around the camera (world metres, f64) and run the streaming budgets. */
  update(cam: V3): void {
    this.cam = cam;
    this.readbacksThisFrame = 0;
    for (let lv = 0; lv < LEVELS; lv++) {
      const nb = windowBase(lv, cam);
      const cur = this.base[lv];
      if (Number.isNaN(cur[0]) || nb[0] !== cur[0] || nb[1] !== cur[1] || nb[2] !== cur[2]) {
        this.shiftWindow(lv, nb);
      }
    }
    this.classifyBudgeted();
    this.generateBudgeted();
    if (this.pageDirty) {
      this.backend.writePage(this.pageCodes);
      this.pageDirty = false;
    }
    this.refreshStats();
  }

  /** Brick currently occupying the window for (level, x, y, z), or null if outside the window. */
  brickAt(level: number, x: number, y: number, z: number): Brick | null {
    const b = this.base[level];
    if (Number.isNaN(b[0])) return null;
    const q = [x - b[0], y - b[1], z - b[2]];
    if (q.some((v, a) => v < 0 || v >= GRID[a])) return null;
    const t = texelIndex(posMod(x, GRID[0]), posMod(y, GRID[1]), posMod(z, GRID[2]));
    const brick = this.texels[level][t];
    return brick && brick.x === x && brick.y === y && brick.z === z ? brick : null;
  }

  /**
   * Make every brick overlapping the world-space box resident (classifying / generating on demand),
   * and mark them edited. Used by sculpting: edits are applied to resident data only.
   */
  materializeRegion(level: number, min: V3, max: V3): Brick[] {
    const bs = brickSize(level);
    const lo = [0, 1, 2].map((a) => Math.floor(min[a] / bs));
    const hi = [0, 1, 2].map((a) => Math.floor(max[a] / bs));
    const out: Brick[] = [];
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
      const b = this.brickAt(level, x, y, z);
      if (!b) continue;
      if (b.state === 'unclassified') this.classifyOne(b);
      if (b.state === 'air' || b.state === 'solid') {
        b.state = 'needs-gen';
        this.setBrickPage(b, CODE_PENDING);
      }
      if (b.state === 'needs-gen') {
        const slot = this.acquireSlot(this.distanceTo(b), true);
        if (slot < 0) continue;
        this.fill(b, slot);
      }
      if (b.state === 'resident') {
        b.edited = true;
        out.push(b);
      }
    }
    if (out.length > 0) this.refreshStats();
    return out;
  }

  /** Force a resident brick's current data into the CPU cache (used when the caller edits in place). */
  residentBricks(): Brick[] {
    const out: Brick[] = [];
    for (const row of this.texels) for (const b of row) if (b && b.state === 'resident') out.push(b);
    return out;
  }

  /** Centre of a brick relative to the camera, in f64 (caller converts to f32 for GPU). */
  brickCenterRel(b: Brick): V3 {
    const c = brickCenter(b.level, b.x, b.y, b.z);
    return [c[0] - this.cam[0], c[1] - this.cam[1], c[2] - this.cam[2]];
  }

  static key(level: number, x: number, y: number, z: number): string {
    return brickKey(level, x, y, z);
  }

  // ---------------------------------------------------------------- internals

  private shiftWindow(lv: number, nb: V3): void {
    const texels = this.texels[lv];
    for (let tz = 0; tz < GRID[2]; tz++) for (let ty = 0; ty < GRID[1]; ty++) for (let tx = 0; tx < GRID[0]; tx++) {
      const bx = nb[0] + posMod(tx - nb[0], GRID[0]);
      const by = nb[1] + posMod(ty - nb[1], GRID[1]);
      const bz = nb[2] + posMod(tz - nb[2], GRID[2]);
      const t = texelIndex(tx, ty, tz);
      const cur = texels[t];
      if (cur && cur.x === bx && cur.y === by && cur.z === bz) continue;
      if (cur) {
        this.retire(cur);
        this.stats.windowRetirements++;
      }
      texels[t] = { level: lv, x: bx, y: by, z: bz, state: 'unclassified', slot: -1, edited: false, texel: t };
      this.setPage(lv, tx, ty, tz, CODE_PENDING);
    }
    this.base[lv] = nb;
  }

  /** Leave the window: free the slot, keeping edited data in the cache. */
  private retire(b: Brick): void {
    if (b.state === 'resident') {
      this.storeAndFree(b, false);
    }
  }

  private setPage(lv: number, tx: number, ty: number, tz: number, code: number): void {
    const idx = pageCodeIndex(lv, tx, ty, tz);
    if (this.pageCodes[idx] !== code) {
      this.pageCodes[idx] = code;
      this.pageDirty = true;
    }
  }

  private setBrickPage(b: Brick, code: number): void {
    const tx = posMod(b.x, GRID[0]), ty = posMod(b.y, GRID[1]), tz = posMod(b.z, GRID[2]);
    this.setPage(b.level, tx, ty, tz, code);
  }

  private classifyOne(b: Brick): void {
    const key = brickKey(b.level, b.x, b.y, b.z);
    if (this.cache.has(key)) {
      b.state = 'needs-gen';
      return;
    }
    this.stats.classified++;
    const c = this.classify(b.level, b.x, b.y, b.z);
    if (c === 'air') {
      b.state = 'air';
      this.setBrickPage(b, CODE_AIR);
    } else if (c === 'solid') {
      b.state = 'solid';
      this.setBrickPage(b, CODE_SOLID);
    } else {
      b.state = 'needs-gen';
    }
  }

  private classifyBudgeted(): void {
    const todo = this.collect((b) => b.state === 'unclassified');
    if (todo.length === 0) return;
    todo.sort((a, b) => this.distanceTo(a) - this.distanceTo(b));
    const n = Math.min(todo.length, STREAM.classifyPerFrame);
    for (let i = 0; i < n; i++) this.classifyOne(todo[i]);
  }

  private generateBudgeted(): void {
    const todo = this.collect((b) => b.state === 'needs-gen');
    if (todo.length === 0) return;
    todo.sort((a, b) => this.distanceTo(a) - this.distanceTo(b));
    let done = 0;
    for (const b of todo) {
      if (done >= STREAM.generatePerFrame) break;
      const slot = this.acquireSlot(this.distanceTo(b), false);
      if (slot < 0) break;
      this.fill(b, slot);
      done++;
    }
  }

  /** Fill a slot with brick data (cache upload or GPU generation). */
  private fill(b: Brick, slot: number): void {
    const key = brickKey(b.level, b.x, b.y, b.z);
    const cached = this.cache.get(key);
    if (cached) {
      this.backend.upload(slot, cached);
      this.stats.uploaded++;
    } else {
      this.backend.generate(slot, b.level, b.x, b.y, b.z);
      this.stats.generated++;
    }
    b.slot = slot;
    b.state = 'resident';
    this.setBrickPage(b, slot);
  }

  /** Get a slot, evicting the farthest resident brick when the pool is full and the candidate is much closer. */
  private acquireSlot(candidateDist: number, urgent: boolean): number {
    const s = this.pool.acquire();
    if (s >= 0) return s;
    let worst: Brick | null = null;
    let worstD = -1;
    for (const row of this.texels) for (const b of row) {
      if (b && b.state === 'resident') {
        const d = this.distanceTo(b);
        if (d > worstD) { worstD = d; worst = b; }
      }
    }
    if (!worst || worstD < candidateDist * STREAM.evictHysteresis) return -1;
    if (worst.edited && this.readbacksThisFrame >= STREAM.readbacksPerFrame && !urgent) return -1;
    this.stats.pressureEvictions++;
    this.storeAndFree(worst, true);
    return this.pool.acquire();
  }

  /** Free a resident brick's slot. Edited data goes to the cache first. */
  private storeAndFree(b: Brick, pressure: boolean): void {
    if (b.edited) {
      this.cache.set(brickKey(b.level, b.x, b.y, b.z), this.backend.readback(b.slot));
      this.stats.readbacks++;
      if (pressure) this.readbacksThisFrame++;
    }
    this.pool.release(b.slot);
    b.slot = -1;
    if (pressure) {
      // Still inside the window: will be regenerated (or restored from cache) later.
      b.state = 'needs-gen';
      this.setBrickPage(b, CODE_PENDING);
    }
  }

  private distanceTo(b: Brick): number {
    const c = brickCenter(b.level, b.x, b.y, b.z);
    const dx = c[0] - this.cam[0], dy = c[1] - this.cam[1], dz = c[2] - this.cam[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private collect(pred: (b: Brick) => boolean): Brick[] {
    const out: Brick[] = [];
    for (const row of this.texels) for (const b of row) if (b && pred(b)) out.push(b);
    return out;
  }

  private refreshStats(): void {
    const s = this.stats;
    s.resident = s.uniformAir = s.uniformSolid = s.pending = 0;
    for (const row of this.texels) for (const b of row) {
      if (!b) continue;
      if (b.state === 'resident') s.resident++;
      else if (b.state === 'air') s.uniformAir++;
      else if (b.state === 'solid') s.uniformSolid++;
      else s.pending++;
    }
    s.cached = this.cache.size;
  }
}

