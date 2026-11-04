// Sculpt tools. A dab is applied to every resident brick that overlaps the brush, at every level
// whose cell size is small enough to see the brush. Bricks outside the camera's windows are never
// touched, so edits cost only what is near the camera.
import { SCULPT } from '../config.ts';
import { LEVELS, type V3, GRID, brickSize, cellSize } from '../clipmap/layout.ts';
import type { ClipmapResidency } from '../clipmap/residency.ts';
import type { ClipAtlas, SculptBrick } from '../gpu/atlas.ts';
import { POOL } from '../config.ts';

export type Tool = 'raise' | 'lower' | 'smooth' | 'flatten';
export const TOOL_ID: Record<Tool, number> = { raise: 0, lower: 1, smooth: 2, flatten: 3 };

export class Sculptor {
  tool: Tool = 'raise';
  radius: number = SCULPT.defaultRadiusM;
  strength: number = SCULPT.defaultStrength;
  /** Flatten target (world metres), latched when a stroke starts. */
  private flatY = 0;
  lastDabBricks = 0;

  setRadius(r: number): void {
    this.radius = Math.min(SCULPT.maxRadiusM, Math.max(SCULPT.minRadiusM, r));
  }

  setStrength(s: number): void {
    this.strength = Math.min(1, Math.max(0.05, s));
  }

  beginStroke(hit: V3): void {
    this.flatY = hit[1];
  }

  /** Is the point inside the finest window with a safety margin (edits must stay within every level). */
  inSafeRange(hit: V3, cam: V3): boolean {
    const bs = brickSize(0);
    for (let a = 0; a < 3; a++) {
      const half = (GRID[a] / 2) * bs;
      if (Math.abs(hit[a] - cam[a]) > half - bs) return false; // keep one brick of margin inside the window
    }
    return true;
  }

  /** Apply one dab of the current tool at `hit` (world metres). `dt` scales the blend amount. */
  dab(res: ClipmapResidency, gpu: ClipAtlas, hit: V3, normal: V3, cam: V3, dt: number): boolean {
    if (!this.inSafeRange(hit, cam)) return false;
    const r = this.radius;
    const amount = 1 - Math.exp(-this.strength * 10 * dt);
    let total = 0;
    for (let lv = 0; lv < LEVELS; lv++) {
      const cs = cellSize(lv);
      if (cs > 2 * r) break;
      const pad = r + cs;
      const min: V3 = [hit[0] - pad, hit[1] - pad, hit[2] - pad];
      const max: V3 = [hit[0] + pad, hit[1] + pad, hit[2] + pad];
      const bricks = res.materializeRegion(lv, min, max);
      if (bricks.length === 0) continue;
      const list = bricks.slice(0, POOL.scratchBricks);
      const bs = brickSize(lv);
      const sculptBricks: SculptBrick[] = list.map((b) => ({
        slot: b.slot,
        level: lv,
        rel: [b.x * bs - cam[0], b.y * bs - cam[1], b.z * bs - cam[2]] as V3,
      }));
      gpu.sculptBricks(
        sculptBricks,
        {
          tool: TOOL_ID[this.tool],
          center: hit,
          normal,
          radius: r,
          amount,
          flatY: this.flatY - cam[1],
          smoothOff: Math.max(2 * cs, 0.15 * r),
        },
        res,
        cam,
        cellLengths(),
      );
      total += list.length;
    }
    this.lastDabBricks = total;
    return true;
  }
}

function cellLengths(): number[] {
  return Array.from({ length: LEVELS }, (_, lv) => cellSize(lv));
}
