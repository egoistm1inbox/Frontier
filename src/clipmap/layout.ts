// Pure layout math for the clipmap: cell/brick sizes, camera-centred windows, toroidal page
// addressing and the atlas memory budget. No GPU or DOM access here.
import { BRICK, LOD, POOL } from '../config.ts';

export type V3 = [number, number, number];

export const GRID: V3 = [LOD.grid[0], LOD.grid[1], LOD.grid[2]];
export const GRID_TEXELS = GRID[0] * GRID[1] * GRID[2];
export const LEVELS = LOD.levels;

export function cellSize(level: number): number {
  return LOD.baseCellM * 2 ** level;
}

/** World size of one brick edge at a level (BRICK.cells cells). */
export function brickSize(level: number): number {
  return cellSize(level) * BRICK.cells;
}

export function posMod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Index of the brick (in level units) whose window starts at the camera's brick minus half the grid. */
export function windowBase(level: number, cam: V3): V3 {
  const bs = brickSize(level);
  return [0, 1, 2].map((a) => Math.floor(cam[a] / bs) - Math.floor(GRID[a] / 2)) as V3;
}

/** World-space centre of a brick. */
export function brickCenter(level: number, x: number, y: number, z: number): V3 {
  const bs = brickSize(level);
  return [(x + 0.5) * bs, (y + 0.5) * bs, (z + 0.5) * bs];
}

/** Flat index of a toroidal texel (tx,ty,tz) within a level's window. */
export function texelIndex(tx: number, ty: number, tz: number): number {
  return (tz * GRID[1] + ty) * GRID[0] + tx;
}

/** Index into the packed page-code array (page texture is GX × (GY·LEVELS) × GZ). */
export function pageCodeIndex(level: number, tx: number, ty: number, tz: number): number {
  const y = level * GRID[1] + ty;
  return (tz * GRID[1] * LEVELS + y) * GRID[0] + tx;
}

export const PAGE_DIMS: V3 = [GRID[0], GRID[1] * LEVELS, GRID[2]];

/** Atlas slot grid: POOL.slotsPerLayerXY² slots per z-block; each slot is one 34³ brick. */
export function slotsZBlocks(): number {
  return Math.ceil(POOL.slots / (POOL.slotsPerLayerXY * POOL.slotsPerLayerXY));
}

export function atlasDims(): V3 {
  const t = BRICK.texels;
  return [POOL.slotsPerLayerXY * t, POOL.slotsPerLayerXY * t, slotsZBlocks() * t];
}

/** Origin (in atlas texels) of a slot. */
export function slotOrigin(slot: number): V3 {
  const n = POOL.slotsPerLayerXY;
  const t = BRICK.texels;
  return [(slot % n) * t, (Math.floor(slot / n) % n) * t, Math.floor(slot / (n * n)) * t];
}

export interface VramEstimate {
  atlasBytes: number;
  scratchBytes: number;
  pageBytes: number;
  coastBytes: number;
  totalBytes: number;
  brickBytes: number;
  maxResidentBricks: number;
}

export function estimateVram(coastTexels: number): VramEstimate {
  const [aw, ah, ad] = atlasDims();
  const atlasBytes = aw * ah * ad * 2; // R16F
  const t = BRICK.texels;
  const scratchBytes = t * t * t * POOL.scratchBricks * 2;
  const pageBytes = PAGE_DIMS[0] * PAGE_DIMS[1] * PAGE_DIMS[2] * 2; // R16I
  const coastBytes = coastTexels * coastTexels * 2; // R16F
  const brickBytes = t * t * t * 2;
  return {
    atlasBytes,
    scratchBytes,
    pageBytes,
    coastBytes,
    totalBytes: atlasBytes + scratchBytes + pageBytes + coastBytes,
    brickBytes,
    maxResidentBricks: POOL.slots,
  };
}
