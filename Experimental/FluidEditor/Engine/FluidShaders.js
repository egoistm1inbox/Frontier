//============================================================================================================================================
//                                                         FLUIDSHADERS.JS
//               GLSL ES 3.00 Kernels — Tiled 3D Eulerian Gas Solver (MacCormack Advection, Buoyancy, Combustion,
//            Vorticity Confinement, Jacobi Pressure Projection), Analytic Force Generators, Volume Ray-Marcher,
//                         Velocity Vector / Scalar Slice / Tracer Overlays, and Gizmo Line Rendering
//============================================================================================================================================

export const FullscreenVertex = `#version 300 es
layout(location = 0) in vec2 aPosition;
out vec2 vUv;
void main()
{
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                                  SHARED VOLUME ADDRESSING
//------------------------------------------------------------------------------------------------------------------------

export const VolumeChunk = `
uniform ivec3 uGrid;
uniform ivec2 uTiles;
uniform vec2  uTexSize;
uniform float uCellSize;
uniform vec3  uGridCentre;   // world-space centre of the simulated window (World Grid tile origin × tile pitch)
uniform ivec3 uCellOrigin;   // world cell index of cell (0,0,0) — only consulted by the Infinite boundary mode

vec3 GridHalf()
{
    return vec3(uGrid) * uCellSize * 0.5;
}

ivec3 CellFromFragment(vec2 fragment)
{
    ivec2 pixel = ivec2(fragment);
    int tileX = pixel.x / uGrid.x;
    int tileY = pixel.y / uGrid.y;
    return ivec3(pixel.x - tileX * uGrid.x, pixel.y - tileY * uGrid.y, tileY * uTiles.x + tileX);
}

bool CellInside(ivec3 cell)
{
    return all(greaterThanEqual(cell, ivec3(0))) && all(lessThan(cell, uGrid));
}

ivec2 PixelFromCell(ivec3 cell)
{
    int tileX = cell.z - (cell.z / uTiles.x) * uTiles.x;
    int tileY = cell.z / uTiles.x;
    return ivec2(tileX * uGrid.x + cell.x, tileY * uGrid.y + cell.y);
}

vec4 FetchCell(sampler2D field, ivec3 cell)
{
    cell = clamp(cell, ivec3(0), uGrid - 1);
    return texelFetch(field, PixelFromCell(cell), 0);
}

// Trilinear sample; coordinate in cell units where the centre of cell i sits at i + 0.5.
vec4 SampleVolume(sampler2D field, vec3 coordinate)
{
    vec3 p = clamp(coordinate - 0.5, vec3(0.0), vec3(uGrid) - 1.0);
    float z0 = floor(p.z);
    float fz = p.z - z0;
    int sliceA = int(z0);
    int sliceB = min(sliceA + 1, uGrid.z - 1);
    vec2 inner = p.xy + 0.5;
    ivec2 tileA = ivec2(sliceA - (sliceA / uTiles.x) * uTiles.x, sliceA / uTiles.x);
    ivec2 tileB = ivec2(sliceB - (sliceB / uTiles.x) * uTiles.x, sliceB / uTiles.x);
    vec2 uvA = (vec2(tileA * uGrid.xy) + inner) / uTexSize;
    vec2 uvB = (vec2(tileB * uGrid.xy) + inner) / uTexSize;
    return mix(texture(field, uvA), texture(field, uvB), fz);
}

vec3 WorldFromCell(vec3 cellCentre)
{
    return (cellCentre - vec3(uGrid) * 0.5) * uCellSize + uGridCentre;
}

vec3 CellFromWorld(vec3 world)
{
    return (world - uGridCentre) / uCellSize + vec3(uGrid) * 0.5;
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                                  SPARSE (INFINITE) TILE ADDRESSING
//------------------------------------------------------------------------------------------------------------------------

// Drop-in replacement for VolumeChunk: the world is an unbounded lattice of T³ tiles. Active tiles live in slots of a 2D
// atlas; a lookup texture (64×16×64 tiles around a sliding focus) maps tile coordinates → slot. "Cells" keep the same
// meaning for every kernel — integer coordinates relative to uCellOrigin, the min corner of the active tiles' bounding
// box — so advection, projection, overlays and particles run unchanged. Fetches into tiles that are not resident read 0;
// CellInside() is "tile resident", which the boundary code treats as an open face (gas flows out, the CPU scheduler then
// allocates the neighbour and the gas carries on).
export const SparseVolumeChunk = `
uniform ivec3 uGrid;          // bounding box of resident tiles, in cells
uniform ivec2 uTiles;         // unused in sparse mode (kept so shared uniform code is identical)
uniform vec2  uTexSize;       // atlas size in texels
uniform float uCellSize;
uniform vec3  uGridCentre;    // world centre of the bounding box
uniform ivec3 uCellOrigin;    // world cell index of bounding-box cell (0,0,0)
uniform int   uTileCells;     // T: cells per tile edge
uniform int   uSlotsX;        // atlas slots per row
uniform int   uSliceCols;     // z-slices per row inside one slot block
uniform int   uSliceRows;
uniform ivec3 uLookupOrigin;  // tile coordinate of lookup texel (0,0,0)
uniform highp isampler2D uTileLookup; // 64 × 1024 (x, z + 64·y) → slot index, −1 when not resident
uniform highp isampler2D uSlotTable;  // slots × 1 → (tx, ty, tz, active)
const ivec3 LookupSize = ivec3(64, 16, 64);
const ivec3 OutsideCell = ivec3(-1000000);

vec3 GridHalf()
{
    return vec3(uGrid) * uCellSize * 0.5;
}

ivec3 TileOfWorldCell(ivec3 worldCell)
{
    return ivec3(floor(vec3(worldCell) / float(uTileCells)));
}

int SlotOfTile(ivec3 tile)
{
    ivec3 r = tile - uLookupOrigin;
    if (any(lessThan(r, ivec3(0))) || any(greaterThanEqual(r, LookupSize))) return -1;
    return texelFetch(uTileLookup, ivec2(r.x, r.z + LookupSize.z * r.y), 0).x;
}

ivec2 SlotBlock(int slot)
{
    return ivec2(slot - (slot / uSlotsX) * uSlotsX, slot / uSlotsX) * ivec2(uTileCells * uSliceCols, uTileCells * uSliceRows);
}

ivec2 PixelFromWorldCell(ivec3 worldCell, ivec3 tile, int slot)
{
    ivec3 local = worldCell - tile * uTileCells;
    int sx = local.z - (local.z / uSliceCols) * uSliceCols;
    int sy = local.z / uSliceCols;
    return SlotBlock(slot) + ivec2(sx * uTileCells + local.x, sy * uTileCells + local.y);
}

ivec3 CellFromFragment(vec2 fragment)
{
    ivec2 pixel = ivec2(fragment);
    int blockW = uTileCells * uSliceCols, blockH = uTileCells * uSliceRows;
    int slot = pixel.x / blockW + (pixel.y / blockH) * uSlotsX;
    ivec4 entry = texelFetch(uSlotTable, ivec2(slot, 0), 0);
    if (entry.w == 0) return OutsideCell;
    int bx = pixel.x - (pixel.x / blockW) * blockW, by = pixel.y - (pixel.y / blockH) * blockH;
    int slice = (by / uTileCells) * uSliceCols + bx / uTileCells;
    if (slice >= uTileCells) return OutsideCell;
    ivec3 local = ivec3(bx - (bx / uTileCells) * uTileCells, by - (by / uTileCells) * uTileCells, slice);
    return entry.xyz * uTileCells + local - uCellOrigin;
}

bool CellInside(ivec3 cell)
{
    if (cell.x <= -1000000) return false;
    return SlotOfTile(TileOfWorldCell(cell + uCellOrigin)) >= 0;
}

ivec2 PixelFromCell(ivec3 cell)
{
    ivec3 worldCell = cell + uCellOrigin;
    ivec3 tile = TileOfWorldCell(worldCell);
    int slot = SlotOfTile(tile);
    return slot < 0 ? ivec2(-1) : PixelFromWorldCell(worldCell, tile, slot);
}

vec4 FetchCell(sampler2D field, ivec3 cell)
{
    ivec3 worldCell = cell + uCellOrigin;
    ivec3 tile = TileOfWorldCell(worldCell);
    int slot = SlotOfTile(tile);
    if (slot < 0) return vec4(0.0);
    return texelFetch(field, PixelFromWorldCell(worldCell, tile, slot), 0);
}

// Trilinear sample in cell units (centre of cell i at i + 0.5). Fast path: all eight corners in one resident tile → two
// hardware-bilinear slice taps; otherwise eight tile-aware fetches (corners in non-resident tiles read as empty).
vec4 SampleVolume(sampler2D field, vec3 coordinate)
{
    vec3 p = coordinate - 0.5;
    vec3 base = floor(p);
    vec3 f = p - base;
    ivec3 c0 = ivec3(base) + uCellOrigin;
    ivec3 t0 = TileOfWorldCell(c0), t1 = TileOfWorldCell(c0 + 1);
    if (all(equal(t0, t1)))
    {
        int slot = SlotOfTile(t0);
        if (slot < 0) return vec4(0.0);
        ivec3 local = c0 - t0 * uTileCells;
        ivec2 block = SlotBlock(slot);
        int zA = local.z, zB = local.z + 1;
        vec2 inner = vec2(local.xy) + f.xy + 0.5;
        ivec2 sliceA = ivec2(zA - (zA / uSliceCols) * uSliceCols, zA / uSliceCols);
        ivec2 sliceB = ivec2(zB - (zB / uSliceCols) * uSliceCols, zB / uSliceCols);
        vec2 uvA = (vec2(block + sliceA * uTileCells) + inner) / uTexSize;
        vec2 uvB = (vec2(block + sliceB * uTileCells) + inner) / uTexSize;
        return mix(texture(field, uvA), texture(field, uvB), f.z);
    }
    ivec3 b = ivec3(base);
    vec4 x00 = mix(FetchCell(field, b), FetchCell(field, b + ivec3(1, 0, 0)), f.x);
    vec4 x10 = mix(FetchCell(field, b + ivec3(0, 1, 0)), FetchCell(field, b + ivec3(1, 1, 0)), f.x);
    vec4 x01 = mix(FetchCell(field, b + ivec3(0, 0, 1)), FetchCell(field, b + ivec3(1, 0, 1)), f.x);
    vec4 x11 = mix(FetchCell(field, b + ivec3(0, 1, 1)), FetchCell(field, b + ivec3(1, 1, 1)), f.x);
    return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
}

vec3 WorldFromCell(vec3 cellCentre)
{
    return (cellCentre + vec3(uCellOrigin)) * uCellSize;
}

vec3 CellFromWorld(vec3 world)
{
    return world / uCellSize - vec3(uCellOrigin);
}
`;

/** Rewrites any kernel built on VolumeChunk to the sparse tile addressing. */
export function sparse(source)
{
    return source.split(VolumeChunk).join(SparseVolumeChunk);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  NOISE + FORCE GENERATORS
//------------------------------------------------------------------------------------------------------------------------

export const NoiseChunk = `
float Hash31(vec3 p)
{
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
}

vec3 Hash33(vec3 p)
{
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453123) * 2.0 - 1.0;
}

// Gradient (Perlin-style) noise with quintic fade: no lattice-aligned blobs, unlike value noise.
float GradientNoise(vec3 p)
{
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float n000 = dot(Hash33(i + vec3(0.0, 0.0, 0.0)), f - vec3(0.0, 0.0, 0.0));
    float n100 = dot(Hash33(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));
    float n010 = dot(Hash33(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));
    float n110 = dot(Hash33(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));
    float n001 = dot(Hash33(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));
    float n101 = dot(Hash33(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));
    float n011 = dot(Hash33(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));
    float n111 = dot(Hash33(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));
    float x00 = mix(n000, n100, u.x), x10 = mix(n010, n110, u.x), x01 = mix(n001, n101, u.x), x11 = mix(n011, n111, u.x);
    return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

// Three-octave fractal gradient noise, remapped to 0..1.
float ValueNoise(vec3 p)
{
    const mat3 rotate = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
    float sum = GradientNoise(p);
    p = rotate * p * 2.02;
    sum += 0.5 * GradientNoise(p);
    p = rotate * p * 2.03;
    sum += 0.25 * GradientNoise(p);
    return clamp(sum / 1.75 * 0.75 + 0.5, 0.0, 1.0);
}

vec3 PotentialNoise(vec3 p)
{
    return vec3(GradientNoise(p), GradientNoise(p + vec3(31.7, 17.3, 9.1)), GradientNoise(p + vec3(-12.9, 44.2, 23.6)));
}

// Curl of a vector potential is divergence-free: ideal for turbulence injection.
vec3 CurlNoise(vec3 p)
{
    const float e = 0.03;
    vec3 dx = PotentialNoise(p + vec3(e, 0.0, 0.0)) - PotentialNoise(p - vec3(e, 0.0, 0.0));
    vec3 dy = PotentialNoise(p + vec3(0.0, e, 0.0)) - PotentialNoise(p - vec3(0.0, e, 0.0));
    vec3 dz = PotentialNoise(p + vec3(0.0, 0.0, e)) - PotentialNoise(p - vec3(0.0, 0.0, e));
    return vec3(dy.z - dz.y, dz.x - dx.z, dx.y - dy.x) / (2.0 * e);
}
`;

export const ForceFieldChunk = `
#define MAX_FORCES 16
uniform int   uForceCount;
uniform vec4  uForceA[MAX_FORCES];   // position.xyz, radius
uniform vec4  uForceB[MAX_FORCES];   // direction.xyz, strength
uniform vec4  uForceC[MAX_FORCES];   // type, falloff, frequency, secondary
uniform vec4  uForceD[MAX_FORCES];   // tertiary, reserved
uniform float uTime;

// 0 SmoothStep · 1 Linear · 2 InverseSquare · 3 Infinite · 4 Gaussian · 5 Plateau · 6 Cosine (interpolated)
float Falloff(int mode, float d)
{
    if (mode == 3) return 1.0;
    if (d >= 1.0) return 0.0;
    if (mode == 0) return 1.0 - smoothstep(0.0, 1.0, d);
    if (mode == 1) return 1.0 - d;
    if (mode == 4) return exp(-d * d * 5.0) * (1.0 - smoothstep(0.9, 1.0, d));
    if (mode == 5) return 1.0 - smoothstep(0.55, 1.0, d);
    if (mode == 6) return 0.5 + 0.5 * cos(d * 3.14159265);
    return (1.0 / (1.0 + 16.0 * d * d)) * (1.0 - smoothstep(0.85, 1.0, d));
}

float PulseEnvelope(float period, float width, float delay)
{
    float local = uTime - delay;
    if (local < 0.0) return 0.0;
    float phase = fract(local / max(period, 0.05));
    return exp(-phase / max(width, 0.01)) * (1.0 - smoothstep(0.8, 1.0, phase));
}

vec3 SafeNormalise(vec3 v)
{
    float l = length(v);
    return l > 1e-5 ? v / l : vec3(0.0, 1.0, 0.0);
}

vec3 EvaluateForceGenerator(int index, vec3 position, vec3 velocity)
{
    vec4 a = uForceA[index];
    vec4 b = uForceB[index];
    vec4 c = uForceC[index];
    float tertiary = uForceD[index].x;
    int type = int(c.x + 0.5);
    int falloffMode = int(c.y + 0.5);
    float frequency = c.z;
    float secondary = c.w;
    vec3 centre = a.xyz;
    float radius = max(a.w, 1e-3);
    vec3 axis = SafeNormalise(b.xyz);
    float strength = b.w;
    vec3 r = position - centre;
    float distance = length(r);
    vec3 radial = r - axis * dot(r, axis);
    float radialDistance = length(radial);

    if (type == 0)
    {
        float w = Falloff(falloffMode, distance / radius);
        float gust = ValueNoise(position * 0.6 + vec3(uTime * frequency, 0.0, uTime * frequency * 0.7)) * 2.0 - 1.0;
        return axis * strength * (1.0 + secondary * gust) * w;
    }
    if (type == 1 || type == 2)
    {
        float w = Falloff(falloffMode, distance / radius);
        float core = distance / (distance + max(secondary, 0.02) * radius + 1e-4);
        vec3 direction = distance > 1e-4 ? r / distance : vec3(0.0);
        return direction * strength * w * core * (type == 1 ? -1.0 : 1.0);
    }
    if (type == 3)
    {
        float w = Falloff(falloffMode, radialDistance / radius);
        vec3 radialDirection = radialDistance > 1e-4 ? radial / radialDistance : vec3(0.0);
        vec3 tangent = cross(axis, radialDirection);
        float core = radialDistance / (radialDistance + 0.12 * radius);
        return (tangent * strength * core - radialDirection * strength * 0.3 * frequency + axis * secondary) * w;
    }
    if (type == 4)
    {
        float w = Falloff(falloffMode, distance / radius);
        return CurlNoise(position * frequency + vec3(0.0, uTime * secondary, uTime * secondary * 0.31)) * strength * w * 0.35;
    }
    if (type == 5)
    {
        float w = Falloff(falloffMode, distance / radius);
        return -velocity * strength * w;
    }
    if (type == 6 || type == 13)
    {
        float pulse = PulseEnvelope(frequency, secondary, tertiary);
        float w = Falloff(falloffMode, distance / radius);
        vec3 direction = distance > 1e-4 ? r / distance : vec3(0.0);
        return direction * strength * pulse * w * (type == 13 ? -1.0 : 1.0);
    }
    if (type == 14)
    {
        float pulse = PulseEnvelope(frequency, secondary, tertiary);
        float w = Falloff(falloffMode, distance / radius);
        return axis * strength * pulse * w;
    }
    if (type == 12)
    {
        float local = uTime - tertiary;
        if (local < 0.0) return vec3(0.0);
        float phase = fract(local / max(frequency, 0.05));
        float shellRadius = phase * radius;
        float thickness = max(secondary, 0.02) * radius;
        float shell = exp(-pow((distance - shellRadius) / thickness, 2.0));
        vec3 direction = distance > 1e-4 ? r / distance : vec3(0.0);
        return direction * strength * shell * (1.0 - phase * 0.7);
    }
    if (type == 10)
    {
        float w = Falloff(falloffMode, distance / radius);
        vec3 radialDirection = radialDistance > 1e-4 ? radial / radialDistance : vec3(0.0);
        vec3 tangent = cross(axis, radialDirection);
        vec3 toCentre = distance > 1e-4 ? -r / distance : vec3(0.0);
        float core = radialDistance / (radialDistance + 0.1 * radius);
        return (tangent * core + toCentre * secondary) * strength * w;
    }
    if (type == 11)
    {
        float overshoot = distance - radius * (1.0 - max(secondary, 0.02));
        if (overshoot <= 0.0) return vec3(0.0);
        float wall = clamp(overshoot / (max(secondary, 0.02) * radius), 0.0, 1.0);
        vec3 direction = distance > 1e-4 ? -r / distance : vec3(0.0);
        return direction * strength * wall * wall;
    }
    if (type == 15)
    {
        float w = Falloff(falloffMode, distance / radius);
        vec3 kick = Hash33(floor(position * frequency) + floor(uTime * max(secondary, 0.1)) * 17.0);
        return kick * strength * w;
    }
    if (type == 16)
    {
        float w = Falloff(falloffMode, distance / radius);
        return (axis * frequency - velocity) * strength * w;
    }
    if (type == 17)
    {
        float w = Falloff(falloffMode, distance / radius);
        float height = clamp(dot(r, axis) / radius, -1.0, 1.0);
        vec3 u = SafeNormalise(cross(axis, abs(axis.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
        vec3 v = cross(axis, u);
        float angle = height * secondary * 3.14159265;
        return (u * cos(angle) + v * sin(angle)) * strength * w;
    }
    if (type == 18)
    {
        float w = Falloff(falloffMode, radialDistance / radius);
        return cross(axis, radial) / radius * strength * w;
    }
    if (type == 19)
    {
        float w = Falloff(falloffMode, distance / radius);
        float core = max(secondary, 0.05) * radius;
        float d = max(distance, core);
        vec3 n = r / max(distance, 1e-4);
        vec3 field = 3.0 * n * dot(axis, n) - axis;
        float scale = (core * core * core) / (d * d * d);
        return SafeNormalise(field) * strength * w * mix(scale, 1.0, 0.35);
    }
    if (type == 7)
    {
        float w = Falloff(falloffMode, radialDistance / radius);
        return axis * strength * w;
    }
    if (type == 8)
    {
        float w = Falloff(falloffMode, radialDistance / radius);
        vec3 radialDirection = radialDistance > 1e-4 ? radial / radialDistance : vec3(0.0);
        return -radialDirection * strength * w;
    }
    if (type == 9)
    {
        float tube = max(frequency, 0.05);
        vec3 radialDirection = radialDistance > 1e-4 ? radial / radialDistance : vec3(1.0, 0.0, 0.0);
        vec3 ringPoint = centre + radialDirection * radius;
        vec3 d = position - ringPoint;
        float coreDistance = length(d);
        float w = Falloff(falloffMode, coreDistance / tube);
        vec3 ringTangent = cross(axis, radialDirection);
        vec3 circulation = cross(ringTangent, d / max(coreDistance, 1e-4));
        return circulation * strength * w;
    }
    return vec3(0.0);
}

vec3 EvaluateForceField(vec3 position, vec3 velocity)
{
    vec3 total = vec3(0.0);
    for (int i = 0; i < MAX_FORCES; i++)
    {
        if (i >= uForceCount) break;
        total += EvaluateForceGenerator(i, position, velocity);
    }
    return total;
}
`;

export const ColliderChunk = `
#define MAX_COLLIDERS 4
uniform int  uColliderCount;
uniform vec4 uColliders[MAX_COLLIDERS];

bool SolidAtWorld(vec3 world)
{
    for (int i = 0; i < MAX_COLLIDERS; i++)
    {
        if (i >= uColliderCount) break;
        if (distance(world, uColliders[i].xyz) < uColliders[i].w) return true;
    }
    return false;
}

bool SolidAtCell(ivec3 cell)
{
    return SolidAtWorld(WorldFromCell(vec3(cell) + 0.5));
}
`;

export const BoundaryChunk = `
uniform int uBoundaryMode; // 0 closed box, 1 open top, 2 open everywhere

// Returns true when stepping across this face leaves through an open boundary.
bool OpenFace(ivec3 neighbour)
{
    if (uBoundaryMode == 3) return neighbour.y + uCellOrigin.y >= 0;
    if (uBoundaryMode == 2) return true;
    if (uBoundaryMode == 1 && neighbour.y >= uGrid.y) return true;
    return false;
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                                  SOLVER KERNELS
//------------------------------------------------------------------------------------------------------------------------

export const AdvectFragment = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${VolumeChunk}
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform float uDeltaTime;
uniform float uDissipation;
uniform float uDirection; // +1 forward trace, -1 reverse trace (MacCormack)
out vec4 fragColour;
void main()
{
    ivec3 cell = CellFromFragment(gl_FragCoord.xy);
    if (!CellInside(cell)) { fragColour = vec4(0.0); return; }
    vec3 centre = vec3(cell) + 0.5;
    vec3 velocity = FetchCell(uVelocity, cell).xyz;
    vec3 midpoint = centre - uDirection * 0.5 * uDeltaTime * velocity / uCellSize;
    vec3 midVelocity = SampleVolume(uVelocity, midpoint).xyz;
    vec3 origin = centre - uDirection * uDeltaTime * midVelocity / uCellSize;
    fragColour = SampleVolume(uSource, origin) * uDissipation;
}
`;

export const MacCormackFragment = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${VolumeChunk}
uniform sampler2D uVelocity;
uniform sampler2D uSource;     // phi_n
uniform sampler2D uForward;    // phi_hat_{n+1}
uniform sampler2D uBackward;   // phi_hat_n
uniform float uDeltaTime;
uniform float uDissipation;
out vec4 fragColour;
void main()
{
    ivec3 cell = CellFromFragment(gl_FragCoord.xy);
    if (!CellInside(cell)) { fragColour = vec4(0.0); return; }
    vec3 centre = vec3(cell) + 0.5;
    vec3 velocity = FetchCell(uVelocity, cell).xyz;
    vec3 origin = centre - uDeltaTime * velocity / uCellSize;
    vec4 forward = FetchCell(uForward, cell);
    vec4 backward = FetchCell(uBackward, cell);
    vec4 source = FetchCell(uSource, cell);
    vec4 corrected = forward + 0.5 * (source * uDissipation - backward);
    // Clamp to the extrema of the semi-Lagrangian stencil to stay monotone.
    ivec3 base = ivec3(floor(clamp(origin - 0.5, vec3(0.0), vec3(uGrid) - 1.0)));
    vec4 lo = vec4(1e9), hi = vec4(-1e9);
    for (int z = 0; z < 2; z++)
    for (int y = 0; y < 2; y++)
    for (int x = 0; x < 2; x++)
    {
        vec4 s = FetchCell(uSource, base + ivec3(x, y, z)) * uDissipation;
        lo = min(lo, s); hi = max(hi, s);
    }
    fragColour = clamp(corrected, lo, hi);
}
`;

export const InjectFragment = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${VolumeChunk}
${NoiseChunk}
#define MAX_EMITTERS 6
uniform sampler2D uTarget;
uniform int   uMode;              // 0 velocity, 1 state (density, temperature, fuel)
uniform int   uEmitterCount;
uniform vec4  uEmitterA[MAX_EMITTERS];  // position.xyz, radius
uniform vec4  uEmitterB[MAX_EMITTERS];  // velocity.xyz, density
uniform vec4  uEmitterC[MAX_EMITTERS];  // temperature, fuel, jitter, shape
uniform vec4  uEmitterD[MAX_EMITTERS];  // orientation.xyz, pulse period
uniform float uDeltaTime;
uniform float uTime;
out vec4 fragColour;

float EmitterMask(int index, vec3 world)
{
    vec4 a = uEmitterA[index];
    vec4 c = uEmitterC[index];
    vec4 d = uEmitterD[index];
    vec3 r = world - a.xyz;
    float radius = max(a.w, uCellSize);
    int shape = int(c.w + 0.5);
    float edge = uCellSize * 1.5;
    float mask;
    if (shape == 0)
    {
        mask = 1.0 - smoothstep(radius - edge, radius, length(r));
    }
    else if (shape == 1)
    {
        vec3 n = normalize(d.xyz);
        float along = abs(dot(r, n));
        float radial = length(r - n * dot(r, n));
        mask = (1.0 - smoothstep(radius - edge, radius, radial)) * (1.0 - smoothstep(edge * 0.6, edge * 1.4, along));
    }
    else
    {
        vec3 q = abs(r) - vec3(radius);
        float boxDistance = max(q.x, max(q.y, q.z));
        mask = 1.0 - smoothstep(-edge, 0.0, boxDistance);
    }
    float jitter = c.z;
    if (jitter > 0.0)
    {
        float n = ValueNoise(world * (2.2 / radius) + vec3(0.0, uTime * 1.6, uTime * 0.9));
        mask *= mix(1.0, smoothstep(0.25, 0.8, n) * 1.4, clamp(jitter, 0.0, 1.0));
    }
    float pulse = d.w;
    if (pulse > 0.0)
    {
        float phase = fract(uTime / pulse);
        mask *= exp(-phase * 7.0) * step(phase, 0.45);
    }
    return clamp(mask, 0.0, 1.0);
}

void main()
{
    ivec3 cell = CellFromFragment(gl_FragCoord.xy);
    if (!CellInside(cell)) { fragColour = vec4(0.0); return; }
    vec3 world = WorldFromCell(vec3(cell) + 0.5);
    vec4 value = FetchCell(uTarget, cell);
    float blend = min(1.0, uDeltaTime * 10.0);
    for (int i = 0; i < MAX_EMITTERS; i++)
    {
        if (i >= uEmitterCount) break;
        float mask = EmitterMask(i, world);
        if (mask <= 0.0) continue;
        vec4 b = uEmitterB[i];
        vec4 c = uEmitterC[i];
        if (uMode == 0)
        {
            if (dot(b.xyz, b.xyz) > 0.0) value.xyz = mix(value.xyz, b.xyz, mask * blend);
        }
        else
        {
            value.x = min(value.x + mask * b.w * uDeltaTime * 6.0, max(value.x, b.w * 1.5));
            value.y = mix(value.y, max(value.y, c.x), mask * blend);
            value.z = min(value.z + mask * c.y * uDeltaTime * 6.0, max(value.z, c.y * 1.5));
        }
    }
    fragColour = value;
}
`;

export const ForcesFragment = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${VolumeChunk}
${NoiseChunk}
${ForceFieldChunk}
${ColliderChunk}
uniform sampler2D uVelocity;
uniform sampler2D uState;
uniform float uDeltaTime;
uniform float uBuoyancy;
uniform float uGravity;
uniform float uAmbientTemperature;
out vec4 fragColour;
void main()
{
    ivec3 cell = CellFromFragment(gl_FragCoord.xy);
    if (!CellInside(cell)) { fragColour = vec4(0.0); return; }
    vec3 world = WorldFromCell(vec3(cell) + 0.5);
    if (SolidAtWorld(world)) { fragColour = vec4(0.0); return; }
    vec3 velocity = FetchCell(uVelocity, cell).xyz;
    vec4 state = FetchCell(uState, cell);
    float temperature = state.y - uAmbientTemperature;
    vec3 acceleration = vec3(0.0, uBuoyancy * temperature - uGravity * state.x, 0.0);
    acceleration += EvaluateForceField(world, velocity);
    fragColour = vec4(velocity + acceleration * uDeltaTime, 0.0);
}
`;

export const CurlFragment = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${VolumeChunk}
uniform sampler2D uVelocity;
out vec4 fragColour;
void main()
{
    ivec3 cell = CellFromFragment(gl_FragCoord.xy);
    if (!CellInside(cell)) { fragColour = vec4(0.0); return; }
    vec3 xp = FetchCell(uVelocity, cell + ivec3(1, 0, 0)).xyz, xm = FetchCell(uVelocity, cell - ivec3(1, 0, 0)).xyz;
    vec3 yp = FetchCell(uVelocity, cell + ivec3(0, 1, 0)).xyz, ym = FetchCell(uVelocity, cell - ivec3(0, 1, 0)).xyz;
    vec3 zp = FetchCell(uVelocity, cell + ivec3(0, 0, 1)).xyz, zm = FetchCell(uVelocity, cell - ivec3(0, 0, 1)).xyz;
    float inv = 0.5 / uCellSize;
    vec3 curl = vec3((yp.z - ym.z) - (zp.y - zm.y), (zp.x - zm.x) - (xp.z - xm.z), (xp.y - xm.y) - (yp.x - ym.x)) * inv;
    fragColour = vec4(curl, length(curl));
}
`;

export const VorticityFragment = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${VolumeChunk}
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float uDeltaTime;
uniform float uConfinement;
out vec4 fragColour;
void main()
{
    ivec3 cell = CellFromFragment(gl_FragCoord.xy);
    if (!CellInside(cell)) { fragColour = vec4(0.0); return; }
    vec3 velocity = FetchCell(uVelocity, cell).xyz;
    vec4 centre = FetchCell(uCurl, cell);
    vec3 eta = vec3(
        FetchCell(uCurl, cell + ivec3(1, 0, 0)).w - FetchCell(uCurl, cell - ivec3(1, 0, 0)).w,
        FetchCell(uCurl, cell + ivec3(0, 1, 0)).w - FetchCell(uCurl, cell - ivec3(0, 1, 0)).w,
        FetchCell(uCurl, cell + ivec3(0, 0, 1)).w - FetchCell(uCurl, cell - ivec3(0, 0, 1)).w) * (0.5 / uCellSize);
    float magnitude = length(eta);
    vec3 n = magnitude > 1e-5 ? eta / magnitude : vec3(0.0);
    vec3 force = uConfinement * uCellSize * cross(n, centre.xyz);
    fragColour = vec4(velocity + force * uDeltaTime, 0.0);
}
`;

export const DivergenceFragment = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${VolumeChunk}
${ColliderChunk}
${BoundaryChunk}
uniform sampler2D uVelocity;
out vec4 fragColour;
float Component(ivec3 cell, ivec3 neighbour, int axis, float centreComponent)
{
    if (!CellInside(neighbour))
    {
        return OpenFace(neighbour) ? centreComponent : 0.0;
    }
    if (SolidAtCell(neighbour)) return 0.0;
    vec3 v = FetchCell(uVelocity, neighbour).xyz;
    return axis == 0 ? v.x : (axis == 1 ? v.y : v.z);
}
void main()
{
    ivec3 cell = CellFromFragment(gl_FragCoord.xy);
    if (!CellInside(cell)) { fragColour = vec4(0.0); return; }
    vec3 c = FetchCell(uVelocity, cell).xyz;
    float xp = Component(cell, cell + ivec3(1, 0, 0), 0, c.x), xm = Component(cell, cell - ivec3(1, 0, 0), 0, c.x);
    float yp = Component(cell, cell + ivec3(0, 1, 0), 1, c.y), ym = Component(cell, cell - ivec3(0, 1, 0), 1, c.y);
    float zp = Component(cell, cell + ivec3(0, 0, 1), 2, c.z), zm = Component(cell, cell - ivec3(0, 0, 1), 2, c.z);
    float divergence = 0.5 * ((xp - xm) + (yp - ym) + (zp - zm)) / uCellSize;
    fragColour = vec4(divergence, 0.0, 0.0, 0.0);
}
`;

export const PressureFragment = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${VolumeChunk}
${ColliderChunk}
${BoundaryChunk}
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
out vec4 fragColour;
float Neighbour(ivec3 neighbour, float centre)
{
    if (!CellInside(neighbour)) return OpenFace(neighbour) ? 0.0 : centre;
    if (SolidAtCell(neighbour)) return centre;
    return FetchCell(uPressure, neighbour).x;
}
void main()
{
    ivec3 cell = CellFromFragment(gl_FragCoord.xy);
    if (!CellInside(cell)) { fragColour = vec4(0.0); return; }
    float centre = FetchCell(uPressure, cell).x;
    float divergence = FetchCell(uDivergence, cell).x;
    float sum = Neighbour(cell + ivec3(1, 0, 0), centre) + Neighbour(cell - ivec3(1, 0, 0), centre)
              + Neighbour(cell + ivec3(0, 1, 0), centre) + Neighbour(cell - ivec3(0, 1, 0), centre)
              + Neighbour(cell + ivec3(0, 0, 1), centre) + Neighbour(cell - ivec3(0, 0, 1), centre);
    float h2 = uCellSize * uCellSize;
    fragColour = vec4((sum - divergence * h2) / 6.0, 0.0, 0.0, 0.0);
}
`;

export const GradientFragment = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${VolumeChunk}
${ColliderChunk}
${BoundaryChunk}
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
out vec4 fragColour;
float Neighbour(ivec3 neighbour, float centre)
{
    if (!CellInside(neighbour)) return OpenFace(neighbour) ? 0.0 : centre;
    if (SolidAtCell(neighbour)) return centre;
    return FetchCell(uPressure, neighbour).x;
}
void main()
{
    ivec3 cell = CellFromFragment(gl_FragCoord.xy);
    if (!CellInside(cell)) { fragColour = vec4(0.0); return; }
    if (SolidAtCell(cell)) { fragColour = vec4(0.0); return; }
    float centre = FetchCell(uPressure, cell).x;
    vec3 gradient = vec3(
        Neighbour(cell + ivec3(1, 0, 0), centre) - Neighbour(cell - ivec3(1, 0, 0), centre),
        Neighbour(cell + ivec3(0, 1, 0), centre) - Neighbour(cell - ivec3(0, 1, 0), centre),
        Neighbour(cell + ivec3(0, 0, 1), centre) - Neighbour(cell - ivec3(0, 0, 1), centre)) * (0.5 / uCellSize);
    vec3 velocity = FetchCell(uVelocity, cell).xyz - gradient;
    // Enforce no-penetration on closed walls.
    if (!CellInside(cell - ivec3(1, 0, 0)) && !OpenFace(cell - ivec3(1, 0, 0))) velocity.x = max(velocity.x, 0.0);
    if (!CellInside(cell + ivec3(1, 0, 0)) && !OpenFace(cell + ivec3(1, 0, 0))) velocity.x = min(velocity.x, 0.0);
    if (!CellInside(cell - ivec3(0, 1, 0)) && !OpenFace(cell - ivec3(0, 1, 0))) velocity.y = max(velocity.y, 0.0);
    if (!CellInside(cell + ivec3(0, 1, 0)) && !OpenFace(cell + ivec3(0, 1, 0))) velocity.y = min(velocity.y, 0.0);
    if (!CellInside(cell - ivec3(0, 0, 1)) && !OpenFace(cell - ivec3(0, 0, 1))) velocity.z = max(velocity.z, 0.0);
    if (!CellInside(cell + ivec3(0, 0, 1)) && !OpenFace(cell + ivec3(0, 0, 1))) velocity.z = min(velocity.z, 0.0);
    fragColour = vec4(velocity, 0.0);
}
`;

export const ThermodynamicsFragment = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${VolumeChunk}
${BoundaryChunk}
uniform sampler2D uState;
uniform float uDeltaTime;
uniform float uCooling;
uniform float uCombustion;
uniform float uAmbientTemperature;
out vec4 fragColour;
// Retention factor that fades gas out across a band of cells next to every open face, so plumes leave the
// domain instead of flattening against the lid.
float OutflowSponge(ivec3 cell)
{
    if (uBoundaryMode == 3) return 1.0;
    float keep = 1.0;
    float band = max(3.0, float(max(uGrid.x, max(uGrid.y, uGrid.z))) * 0.07);
    if (OpenFace(ivec3(cell.x, uGrid.y, cell.z))) keep *= smoothstep(0.0, band, float(uGrid.y - 1 - cell.y));
    if (OpenFace(ivec3(cell.x, -1, cell.z))) keep *= smoothstep(0.0, band, float(cell.y));
    if (OpenFace(ivec3(uGrid.x, cell.y, cell.z))) keep *= smoothstep(0.0, band, float(uGrid.x - 1 - cell.x));
    if (OpenFace(ivec3(-1, cell.y, cell.z))) keep *= smoothstep(0.0, band, float(cell.x));
    if (OpenFace(ivec3(cell.x, cell.y, uGrid.z))) keep *= smoothstep(0.0, band, float(uGrid.z - 1 - cell.z));
    if (OpenFace(ivec3(cell.x, cell.y, -1))) keep *= smoothstep(0.0, band, float(cell.z));
    return mix(0.82, 1.0, keep);
}

void main()
{
    ivec3 cell = CellFromFragment(gl_FragCoord.xy);
    if (!CellInside(cell)) { fragColour = vec4(0.0); return; }
    vec4 state = FetchCell(uState, cell);
    float sponge = OutflowSponge(cell);
    float density = state.x * sponge, temperature = uAmbientTemperature + (state.y - uAmbientTemperature) * sponge, fuel = state.z * sponge;
    const float ignition = 0.9;
    if (fuel > 0.0 && temperature > ignition && uCombustion > 0.0)
    {
        float burn = min(fuel, uCombustion * 2.5 * uDeltaTime * fuel * smoothstep(ignition, ignition + 1.0, temperature));
        fuel -= burn;
        temperature += burn * 12.0;
        density += burn * 0.55;
    }
    float excess = temperature - uAmbientTemperature;
    // Newtonian + radiative (T^4 shaped) cooling.
    excess = max(0.0, excess - uDeltaTime * uCooling * (0.35 * excess + 0.02 * excess * excess * excess));
    temperature = uAmbientTemperature + excess;
    fragColour = vec4(max(density, 0.0), temperature, max(fuel, 0.0), 0.0);
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                                  TRACER PARTICLES
//------------------------------------------------------------------------------------------------------------------------

export const TracerUpdateFragment = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${VolumeChunk}
${NoiseChunk}
uniform sampler2D uTracers;
uniform sampler2D uVelocity;
uniform float uDeltaTime;
uniform float uTime;
uniform float uLifetime;
uniform int   uReset;
out vec4 fragColour;
vec3 SpawnPosition(vec2 pixel, float salt)
{
    vec3 extent = vec3(uGrid) * uCellSize;
    vec3 u = vec3(Hash31(vec3(pixel, salt)), Hash31(vec3(pixel.yx, salt + 7.3)), Hash31(vec3(pixel + 3.1, salt + 19.7)));
    return uGridCentre + (u - 0.5) * extent * 0.96;
}
void main()
{
    vec2 pixel = floor(gl_FragCoord.xy);
    vec4 tracer = texelFetch(uTracers, ivec2(pixel), 0);
    if (uReset == 1)
    {
        fragColour = vec4(SpawnPosition(pixel, 0.0), Hash31(vec3(pixel, 3.3)) * uLifetime);
        return;
    }
    vec3 position = tracer.xyz;
    float age = tracer.w + uDeltaTime;
    vec3 v1 = SampleVolume(uVelocity, CellFromWorld(position)).xyz;
    vec3 mid = position + 0.5 * uDeltaTime * v1;
    vec3 v2 = SampleVolume(uVelocity, CellFromWorld(mid)).xyz;
    position += uDeltaTime * v2;
    vec3 half_ = GridHalf();
    bool outside = any(greaterThan(abs(position - uGridCentre), half_));
    if (age > uLifetime || outside)
    {
        position = SpawnPosition(pixel, uTime);
        age = 0.0;
    }
    fragColour = vec4(position, age);
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                                  WORLD GRID RELOCATION
//------------------------------------------------------------------------------------------------------------------------

// Slides a field by a whole number of cells when the simulated window steps to a neighbouring World Grid tile: the gas
// stays exactly where it was in world space, cells that scroll in from outside the old window start empty.
export const ShiftFragment = `#version 300 es
precision highp float;
precision highp sampler2D;
${VolumeChunk}
uniform sampler2D uSource;
uniform ivec3 uShift;
out vec4 fragColour;
void main()
{
    ivec3 cell = CellFromFragment(gl_FragCoord.xy);
    ivec3 source = cell + uShift;
    fragColour = CellInside(source) ? FetchCell(uSource, source) : vec4(0.0);
}
`;

// Per-slot occupancy for the Infinite grid scheduler: one row per slot, three columns —
//   0: (density sum, density max, speed max, resident flag)
//   1: band density next to the −X, +X, −Y, +Y faces      2: band density next to −Z, +Z
// Sampled with a stride so a 32³ tile costs ~4k taps; read back every few frames to allocate / free tiles.
export const OccupancyFragment = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${SparseVolumeChunk}
uniform sampler2D uState;
uniform sampler2D uVelocity;
uniform int uStride;
uniform int uBand;
out vec4 fragColour;
void main()
{
    int slot = int(gl_FragCoord.y);
    int column = int(gl_FragCoord.x);
    ivec4 entry = texelFetch(uSlotTable, ivec2(slot, 0), 0);
    if (entry.w == 0) { fragColour = vec4(0.0); return; }
    ivec2 block = SlotBlock(slot);
    vec4 result = vec4(0.0);
    for (int z = 0; z < 64; z += 1)
    {
        int lz = z * uStride; if (lz >= uTileCells) break;
        ivec2 sliceOrigin = block + ivec2(lz - (lz / uSliceCols) * uSliceCols, lz / uSliceCols) * uTileCells;
        for (int y = 0; y < 64; y += 1)
        {
            int ly = y * uStride; if (ly >= uTileCells) break;
            for (int x = 0; x < 64; x += 1)
            {
                int lx = x * uStride; if (lx >= uTileCells) break;
                ivec2 pixel = sliceOrigin + ivec2(lx, ly);
                float density = texelFetch(uState, pixel, 0).x;
                if (column == 0)
                {
                    result.x += density;
                    result.y = max(result.y, density);
                    result.z = max(result.z, length(texelFetch(uVelocity, pixel, 0).xyz));
                }
                else if (column == 1)
                {
                    if (lx < uBand) result.x += density;
                    if (lx >= uTileCells - uBand) result.y += density;
                    if (ly < uBand) result.z += density;
                    if (ly >= uTileCells - uBand) result.w += density;
                }
                else
                {
                    if (lz < uBand) result.x += density;
                    if (lz >= uTileCells - uBand) result.y += density;
                }
            }
        }
    }
    if (column == 0) result.w = 1.0;
    fragColour = result;
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                                  COLOUR RAMPS
//------------------------------------------------------------------------------------------------------------------------

export const RampChunk = `
vec3 TurboRamp(float t)
{
    t = clamp(t, 0.0, 1.0);
    const vec4 kR = vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234);
    const vec4 kG = vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333);
    const vec4 kB = vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771);
    const vec2 kR2 = vec2(-152.94239396, 59.28637943);
    const vec2 kG2 = vec2(4.27729857, 2.82956604);
    const vec2 kB2 = vec2(-89.90310912, 27.34824973);
    vec4 v4 = vec4(1.0, t, t * t, t * t * t);
    vec2 v2 = v4.zw * v4.z;
    return vec3(dot(v4, kR) + dot(v2, kR2), dot(v4, kG) + dot(v2, kG2), dot(v4, kB) + dot(v2, kB2));
}
vec3 PlasmaRamp(float t)
{
    t = clamp(t, 0.0, 1.0);
    vec3 c0 = vec3(0.0509, 0.0298, 0.5279), c1 = vec3(2.1763, 0.2383, 0.7539), c2 = vec3(-2.6895, -7.4559, 3.1107);
    vec3 c3 = vec3(6.1303, 42.3461, -28.5188), c4 = vec3(-11.1074, -82.6663, 60.1398), c5 = vec3(10.0231, 71.4136, -54.0721), c6 = vec3(-3.6587, -22.9315, 18.1919);
    return c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6)))));
}
vec3 EngineeringRamp(float t)
{
    t = clamp(t, 0.0, 1.0) * 6.0;
    vec3 stops[7];
    stops[0] = vec3(0.043, 0.122, 0.227); stops[1] = vec3(0.071, 0.318, 0.541); stops[2] = vec3(0.102, 0.627, 0.784);
    stops[3] = vec3(0.373, 0.816, 0.627); stops[4] = vec3(0.898, 0.890, 0.416); stops[5] = vec3(0.949, 0.545, 0.176); stops[6] = vec3(0.851, 0.157, 0.110);
    int i = int(min(floor(t), 5.0));
    return mix(stops[i], stops[i + 1], fract(t));
}
vec3 DivergingRamp(float t)
{
    t = clamp(t, 0.0, 1.0) * 6.0;
    vec3 stops[7];
    stops[0] = vec3(0.129, 0.400, 0.675); stops[1] = vec3(0.404, 0.663, 0.812); stops[2] = vec3(0.820, 0.898, 0.941);
    stops[3] = vec3(0.969, 0.969, 0.969); stops[4] = vec3(0.992, 0.859, 0.780); stops[5] = vec3(0.937, 0.541, 0.384); stops[6] = vec3(0.698, 0.094, 0.169);
    int i = int(min(floor(t), 5.0));
    return mix(stops[i], stops[i + 1], fract(t));
}
vec3 Ramp(int mode, float t)
{
    if (mode == 1) return EngineeringRamp(t);
    if (mode == 2) return PlasmaRamp(t);
    if (mode == 3) return DivergingRamp(t);
    return TurboRamp(t);
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                                  SCENE RAY-MARCHER
//------------------------------------------------------------------------------------------------------------------------

export const SceneFragment = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${VolumeChunk}
${NoiseChunk}
${ColliderChunk}
uniform sampler2D uState;
uniform vec3  uCameraPosition;
uniform mat4  uInverseViewProjection;
uniform vec2  uViewport;
uniform vec3  uLightDirection;
uniform vec3  uLightColour;
uniform vec3  uAlbedo;
uniform float uDensityScale;
uniform float uAbsorption;
uniform float uFireIntensity;
uniform vec3  uFireEmber;
uniform vec3  uFireFlame;
uniform vec3  uFireCore;
uniform float uFireThreshold;
uniform float uFireSoftness;
uniform float uFireOpacity;
uniform float uExposure;
uniform float uAnisotropy;
uniform float uLightIntensity;
uniform vec3  uAmbientColour;
uniform int   uSteps;
uniform int   uShadowSteps;
uniform float uGroundHeight;
uniform int   uShowVolume;
uniform int   uVoxelPreview;
uniform int   uFrame;
uniform int   uSelectedCollider;
out vec4 fragColour;

vec2 IntersectBox(vec3 origin, vec3 direction, vec3 boxMin, vec3 boxMax)
{
    vec3 inv = 1.0 / direction;
    vec3 t0 = (boxMin - origin) * inv;
    vec3 t1 = (boxMax - origin) * inv;
    vec3 tmin = min(t0, t1), tmax = max(t0, t1);
    return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

float IntersectSphere(vec3 origin, vec3 direction, vec3 centre, float radius)
{
    vec3 oc = origin - centre;
    float b = dot(oc, direction);
    float c = dot(oc, oc) - radius * radius;
    float h = b * b - c;
    if (h < 0.0) return -1.0;
    return -b - sqrt(h);
}

// Editable incandescence ramp: ember -> flame -> white-hot core, radiance growing with temperature.
vec3 FireRadiance(float temperature)
{
    float t = clamp((temperature - uFireThreshold) / max(uFireSoftness, 0.05), 0.0, 1.0);
    vec3 colour = t < 0.5 ? mix(uFireEmber, uFireFlame, t * 2.0) : mix(uFireFlame, uFireCore, (t - 0.5) * 2.0);
    return colour * (0.2 + 4.0 * t * t);
}

float FirePresence(float temperature)
{
    return smoothstep(uFireThreshold * 0.7, uFireThreshold * 1.15, temperature);
}

// Henyey-Greenstein phase function for forward-scattering silver linings.
float HenyeyGreenstein(float cosTheta, float g)
{
    float g2 = g * g;
    return (1.0 - g2) / (4.0 * 3.14159265 * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
}

vec3 AcesFilm(vec3 x)
{
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

float GroundGrid(vec3 world)
{
    vec2 coordinate = world.xz;
    vec2 minor = abs(fract(coordinate - 0.5) - 0.5) / fwidth(coordinate);
    vec2 major = abs(fract(coordinate * 0.2 - 0.5) - 0.5) / fwidth(coordinate * 0.2);
    float minorLine = 1.0 - min(min(minor.x, minor.y), 1.0);
    float majorLine = 1.0 - min(min(major.x, major.y), 1.0);
    return max(minorLine * 0.35, majorLine * 0.7);
}

float ShadowTransmittance(vec3 world, vec3 boxMin, vec3 boxMax)
{
    if (uShadowSteps <= 0) return 1.0;
    vec2 span = IntersectBox(world, uLightDirection, boxMin, boxMax);
    float length_ = max(span.y, 0.0);
    float step_ = length_ / float(uShadowSteps);
    float optical = 0.0;
    for (int i = 0; i < 16; i++)
    {
        if (i >= uShadowSteps) break;
        vec3 p = world + uLightDirection * (float(i) + 0.5) * step_;
        optical += SampleVolume(uState, CellFromWorld(p)).x * uDensityScale * uAbsorption * step_;
    }
    return exp(-optical);
}

void main()
{
    vec2 ndc = (gl_FragCoord.xy / uViewport) * 2.0 - 1.0;
    vec4 far = uInverseViewProjection * vec4(ndc, 1.0, 1.0);
    vec3 direction = normalize(far.xyz / far.w - uCameraPosition);
    vec3 origin = uCameraPosition;

    // Background gradient.
    float horizon = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 colour = mix(vec3(0.055, 0.058, 0.068), vec3(0.028, 0.029, 0.034), pow(horizon, 0.6));

    float sceneDepth = 1e9;
    // Ground plane with 1 m engineering grid.
    if (direction.y < -1e-4)
    {
        float t = (uGroundHeight - origin.y) / direction.y;
        vec3 hit = origin + direction * t;
        float fade = exp(-length(hit.xz) * 0.09);
        vec3 ground = vec3(0.075, 0.078, 0.088);
        float grid = GroundGrid(hit) * fade;
        colour = mix(ground * fade + colour * (1.0 - fade), vec3(0.32, 0.34, 0.40), grid);
        sceneDepth = t;
    }

    // Analytic sphere colliders.
    for (int i = 0; i < MAX_COLLIDERS; i++)
    {
        if (i >= uColliderCount) break;
        float t = IntersectSphere(origin, direction, uColliders[i].xyz, uColliders[i].w);
        if (t > 0.0 && t < sceneDepth)
        {
            vec3 hit = origin + direction * t;
            vec3 n = normalize(hit - uColliders[i].xyz);
            float diffuse = max(dot(n, uLightDirection), 0.0);
            float rim = pow(1.0 - max(dot(n, -direction), 0.0), 3.0);
            vec3 base = i == uSelectedCollider ? vec3(0.86, 0.72, 0.36) : vec3(0.42, 0.44, 0.50);
            colour = base * (0.18 + 0.82 * diffuse) + rim * 0.25;
            sceneDepth = t;
        }
    }

    if (uShowVolume == 1)
    {
        vec3 half_ = GridHalf();
        vec2 span = IntersectBox(origin, direction, uGridCentre - half_, uGridCentre + half_);
        float entry = max(span.x, 0.0);
        float exit = min(span.y, sceneDepth);
        if (exit > entry)
        {
            float marchLength = exit - entry;
            float step_ = marchLength / float(uSteps);
            float jitter = Hash31(vec3(gl_FragCoord.xy, float(uFrame)));
            float transmittance = 1.0;
            vec3 accumulated = vec3(0.0);
            float phase = HenyeyGreenstein(dot(direction, uLightDirection), uAnisotropy) * 4.0 * 3.14159265;
            vec3 sunLight = uLightColour * uLightIntensity * mix(1.0, phase, 0.6);
            for (int i = 0; i < 256; i++)
            {
                if (i >= uSteps || transmittance < 0.005) break;
                vec3 p = origin + direction * (entry + (float(i) + jitter) * step_);
                vec3 coordinate = CellFromWorld(p);
                vec4 state = uVoxelPreview == 1 ? FetchCell(uState, ivec3(floor(coordinate))) : SampleVolume(uState, coordinate);
                float density = state.x * uDensityScale;
                float temperature = state.y;
                float fire = FirePresence(temperature);
                if (density < 0.002 && fire < 0.002) continue;
                vec3 emission = FireRadiance(temperature) * uFireIntensity * fire;
                float sigmaSmoke = density * uAbsorption;
                float sigmaFire = fire * uFireOpacity;
                float sigma = sigmaSmoke + sigmaFire;
                float lightTransmittance = (sigmaSmoke > 0.0) ? ShadowTransmittance(p, uGridCentre - half_, uGridCentre + half_) : 1.0;
                // Soot is lit by the sun, the ambient sky, and the flame it is wrapped around.
                vec3 scattering = uAlbedo * (uAmbientColour + sunLight * lightTransmittance + emission * 0.6);
                vec3 contribution = scattering * sigmaSmoke * step_ + emission * (1.0 + sigmaFire) * step_;
                accumulated += transmittance * contribution;
                transmittance *= exp(-sigma * step_);
            }
            colour = colour * transmittance + accumulated;
        }
    }

    // ACES filmic tone map with editable exposure.
    colour = AcesFilm(colour * uExposure);
    colour = pow(colour, vec3(1.0 / 2.2));
    fragColour = vec4(colour, 1.0);
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                                  VELOCITY VECTOR OVERLAY
//------------------------------------------------------------------------------------------------------------------------

export const VectorVertex = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${VolumeChunk}
${RampChunk}
uniform sampler2D uVelocity;
uniform mat4  uViewProjection;
uniform int   uAxis;
uniform int   uSlice;
uniform int   uStride;
uniform float uScale;
uniform float uMaxSpeed;
uniform int   uRampMode;
uniform int   uHeads;
out vec4 vColour;
void main()
{
    int vertexInArrow = uHeads == 1 ? 0 : gl_VertexID - (gl_VertexID / 2) * 2;
    int arrow = uHeads == 1 ? gl_VertexID : gl_VertexID / 2;
    ivec2 planeSize = uAxis == 0 ? uGrid.yz : (uAxis == 1 ? uGrid.xz : uGrid.xy);
    int columns = (planeSize.x + uStride - 1) / uStride;
    int u = (arrow - (arrow / columns) * columns) * uStride + uStride / 2;
    int v = (arrow / columns) * uStride + uStride / 2;
    ivec3 cell = uAxis == 0 ? ivec3(uSlice, u, v) : (uAxis == 1 ? ivec3(u, uSlice, v) : ivec3(u, v, uSlice));
    vec3 velocity = FetchCell(uVelocity, cell).xyz;
    float speed = length(velocity);
    vec3 origin = WorldFromCell(vec3(cell) + 0.5);
    float cap = float(uStride) * uCellSize * 1.6;
    vec3 tip = origin + velocity * uScale * min(1.0, cap / max(speed * uScale, 1e-4));
    vec3 position = (vertexInArrow == 1 || uHeads == 1) ? tip : origin;
    float t = clamp(speed / max(uMaxSpeed, 1e-3), 0.0, 1.0);
    float alpha = smoothstep(0.0, 0.05, t) * (0.35 + 0.65 * t);
    vColour = vec4(Ramp(uRampMode, t), alpha);
    if (!CellInside(cell) || v >= planeSize.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColour.a = 0.0; }
    else gl_Position = uViewProjection * vec4(position, 1.0);
    gl_PointSize = 3.0;
}
`;

export const ForceVectorVertex = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${VolumeChunk}
${NoiseChunk}
${ForceFieldChunk}
${RampChunk}
uniform sampler2D uVelocity;
uniform mat4  uViewProjection;
uniform int   uMode;     // 0 slice, 1 sparse volume
uniform int   uAxis;
uniform int   uSlice;
uniform int   uStride;
uniform float uScale;
uniform float uMaxForce;
uniform int   uRampMode;
uniform int   uHeads;
out vec4 vColour;
void main()
{
    int vertexInArrow = uHeads == 1 ? 0 : gl_VertexID - (gl_VertexID / 2) * 2;
    int arrow = uHeads == 1 ? gl_VertexID : gl_VertexID / 2;
    ivec3 cell;
    bool valid = true;
    if (uMode == 0)
    {
        ivec2 planeSize = uAxis == 0 ? uGrid.yz : (uAxis == 1 ? uGrid.xz : uGrid.xy);
        int columns = (planeSize.x + uStride - 1) / uStride;
        int u = (arrow - (arrow / columns) * columns) * uStride + uStride / 2;
        int v = (arrow / columns) * uStride + uStride / 2;
        cell = uAxis == 0 ? ivec3(uSlice, u, v) : (uAxis == 1 ? ivec3(u, uSlice, v) : ivec3(u, v, uSlice));
        valid = v < planeSize.y;
    }
    else
    {
        ivec3 counts = (uGrid + uStride - 1) / uStride;
        int x = arrow - (arrow / counts.x) * counts.x;
        int rest = arrow / counts.x;
        int y = rest - (rest / counts.y) * counts.y;
        int z = rest / counts.y;
        cell = ivec3(x, y, z) * uStride + uStride / 2;
        valid = z < counts.z;
    }
    vec3 origin = WorldFromCell(vec3(cell) + 0.5);
    vec3 velocity = FetchCell(uVelocity, cell).xyz;
    vec3 force = EvaluateForceField(origin, velocity);
    float magnitude = length(force);
    float cap = float(uStride) * uCellSize * 1.5;
    vec3 tip = origin + force * uScale * min(1.0, cap / max(magnitude * uScale, 1e-4));
    vec3 position = (vertexInArrow == 1 || uHeads == 1) ? tip : origin;
    float t = clamp(magnitude / max(uMaxForce, 1e-3), 0.0, 1.0);
    float alpha = smoothstep(0.0, 0.04, t) * (0.3 + 0.7 * t);
    vColour = vec4(Ramp(uRampMode, t), alpha);
    if (!valid || !CellInside(cell)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColour.a = 0.0; }
    else gl_Position = uViewProjection * vec4(position, 1.0);
    gl_PointSize = 3.0;
}
`;

export const ColourFragment = `#version 300 es
precision highp float;
in vec4 vColour;
out vec4 fragColour;
void main() { if (vColour.a <= 0.0) discard; fragColour = vColour; }
`;

//------------------------------------------------------------------------------------------------------------------------
//                                                  SCALAR SLICE OVERLAY
//------------------------------------------------------------------------------------------------------------------------

export const SliceVertex = `#version 300 es
precision highp float;
uniform mat4 uViewProjection;
uniform vec3 uCorner;
uniform vec3 uEdgeU;
uniform vec3 uEdgeV;
out vec3 vWorld;
void main()
{
    int id = gl_VertexID;
    vec2 uv = vec2((id == 1 || id == 2 || id == 4) ? 1.0 : 0.0, (id == 2 || id == 4 || id == 5) ? 1.0 : 0.0);
    vWorld = uCorner + uEdgeU * uv.x + uEdgeV * uv.y;
    gl_Position = uViewProjection * vec4(vWorld, 1.0);
}
`;

export const SliceFragment = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${VolumeChunk}
${NoiseChunk}
${ForceFieldChunk}
${RampChunk}
uniform sampler2D uVelocity;
uniform sampler2D uState;
uniform sampler2D uPressure;
uniform sampler2D uCurl;
uniform sampler2D uDivergence;
uniform int   uChannel;
uniform float uRange;
uniform float uOpacity;
uniform int   uRampMode;
in vec3 vWorld;
out vec4 fragColour;
void main()
{
    vec3 coordinate = CellFromWorld(vWorld);
    float value;
    bool signed_ = false;
    if (uChannel == 0) value = length(SampleVolume(uVelocity, coordinate).xyz);
    else if (uChannel == 1) { value = SampleVolume(uPressure, coordinate).x; signed_ = true; }
    else if (uChannel == 2) value = SampleVolume(uCurl, coordinate).w;
    else if (uChannel == 3) value = SampleVolume(uState, coordinate).y;
    else if (uChannel == 4) value = SampleVolume(uState, coordinate).x;
    else if (uChannel == 5) { value = SampleVolume(uDivergence, coordinate).x; signed_ = true; }
    else value = length(EvaluateForceField(vWorld, SampleVolume(uVelocity, coordinate).xyz));
    float t = signed_ ? clamp(value / uRange * 0.5 + 0.5, 0.0, 1.0) : clamp(value / uRange, 0.0, 1.0);
    vec3 colour = Ramp(uRampMode, t);
    float magnitude = signed_ ? abs(t - 0.5) * 2.0 : t;
    float alpha = uOpacity * (0.18 + 0.82 * smoothstep(0.0, 0.3, magnitude));
    fragColour = vec4(colour, alpha);
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                                  TRACER RENDER
//------------------------------------------------------------------------------------------------------------------------

export const TracerRenderVertex = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${RampChunk}
uniform sampler2D uTracers;
uniform sampler2D uPrevious;
uniform mat4  uViewProjection;
uniform ivec2 uTracerSize;
uniform float uMaxSpeed;
uniform float uPointSize;
uniform float uDeltaTime;
uniform float uRespawnDistance;
uniform int   uTrail;
uniform int   uRampMode;
uniform float uLifetime;
out vec4 vColour;
void main()
{
    int particle = uTrail == 1 ? gl_VertexID / 2 : gl_VertexID;
    int end = uTrail == 1 ? gl_VertexID - particle * 2 : 0;
    ivec2 pixel = ivec2(particle - (particle / uTracerSize.x) * uTracerSize.x, particle / uTracerSize.x);
    vec4 current = texelFetch(uTracers, pixel, 0);
    vec4 previous = texelFetch(uPrevious, pixel, 0);
    bool respawned = current.w < previous.w || distance(current.xyz, previous.xyz) > uRespawnDistance;
    vec3 position = (end == 1 && !respawned) ? previous.xyz : current.xyz;
    float speed = respawned ? 0.0 : distance(current.xyz, previous.xyz) / max(uDeltaTime, 1e-4);
    float t = clamp(speed / max(uMaxSpeed, 1e-3), 0.0, 1.0);
    float life = current.w / max(uLifetime, 1e-3);
    float fade = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.85, 1.0, life));
    float alpha = fade * (0.08 + 0.92 * smoothstep(0.0, 0.08, t));
    vColour = vec4(Ramp(uRampMode, t), alpha * (end == 1 ? 0.25 : 1.0));
    gl_Position = uViewProjection * vec4(position, 1.0);
    gl_PointSize = uPointSize * (0.6 + 0.8 * t);
}
`;


//------------------------------------------------------------------------------------------------------------------------
//                                                  DEBRIS PARTICLES
//------------------------------------------------------------------------------------------------------------------------

export const DebrisUpdateFragment = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${VolumeChunk}
${NoiseChunk}
#define MAX_EMITTERS 6
uniform sampler2D uPositions;     // xyz position, w age
uniform sampler2D uVelocities;    // xyz velocity, w seed
uniform sampler2D uVelocity;      // gas velocity volume
uniform int   uOutput;            // 0 positions, 1 velocities
uniform int   uReset;
uniform int   uEmitterCount;
uniform vec4  uEmitterA[MAX_EMITTERS];  // position.xyz, radius
uniform vec4  uEmitterB[MAX_EMITTERS];  // velocity.xyz, density
uniform vec4  uEmitterE[MAX_EMITTERS];  // debris amount, debris speed, envelope, kind (0 rubble, 1 ember, 2 paper)
uniform float uDeltaTime;
uniform float uTime;
uniform float uLifetime;
uniform float uGravity;
uniform float uDrag;
uniform float uBounce;
out vec4 fragColour;
vec3 RandomDirection(vec3 seed)
{
    float z = Hash31(seed) * 2.0 - 1.0;
    float a = Hash31(seed.zxy + 5.1) * 6.2831853;
    float r = sqrt(max(0.0, 1.0 - z * z));
    return vec3(r * cos(a), z, r * sin(a));
}
void main()
{
    vec2 pixel = floor(gl_FragCoord.xy);
    vec4 p = texelFetch(uPositions, ivec2(pixel), 0);
    vec4 v = texelFetch(uVelocities, ivec2(pixel), 0);
    float seed = Hash31(vec3(pixel, 11.7));
    if (uReset == 1)
    {
        fragColour = uOutput == 0 ? vec4(0.0, -1e4, 0.0, uLifetime + 1.0) : vec4(0.0, 0.0, 0.0, seed);
        return;
    }
    vec3 position = p.xyz;
    float age = p.w;
    vec3 velocity = v.xyz;
    vec3 half_ = GridHalf();
    bool dead = age >= uLifetime;
    if (dead && uEmitterCount > 0)
    {
        int index = int(mod(pixel.x + pixel.y * 7.0, float(uEmitterCount)));
        vec4 e = uEmitterE[index];
        float chance = e.x * e.z * uDeltaTime * 9.0;
        if (Hash31(vec3(pixel, uTime)) < chance)
        {
            vec4 a = uEmitterA[index];
            vec3 direction = RandomDirection(vec3(pixel, uTime + 3.3));
            position = a.xyz + direction * a.w * Hash31(vec3(pixel.yx, uTime));
            float speed = e.y * (0.35 + 0.65 * Hash31(vec3(pixel, uTime + 9.1)));
            velocity = uEmitterB[index].xyz + direction * speed + vec3(0.0, 0.45 * e.y, 0.0);
            v.w = floor(e.w + 0.5) + fract(v.w);
            age = 0.0;
            dead = false;
        }
    }
    if (!dead)
    {
        age += uDeltaTime;
        int kind = int(floor(v.w));
        float seedValue = fract(v.w);
        vec3 gas = SampleVolume(uVelocity, CellFromWorld(position)).xyz;
        float gravityScale = kind == 1 ? 0.12 : (kind == 2 ? 0.3 : 1.0);
        float dragScale = kind == 1 ? 3.0 : (kind == 2 ? 4.0 : 1.0);
        velocity += vec3(0.0, -uGravity * gravityScale, 0.0) * uDeltaTime;
        if (kind == 1) velocity += vec3(0.0, 0.9 + 0.6 * seedValue, 0.0) * uDeltaTime * exp(-age * 0.6);
        if (kind != 0) velocity += CurlNoise(position * 1.7 + vec3(uTime * 0.8, seedValue * 9.0, 0.0)) * (kind == 2 ? 1.6 : 0.5) * uDeltaTime;
        velocity += (gas - velocity) * min(1.0, uDrag * dragScale * uDeltaTime * (0.6 + 0.8 * seedValue));
        position += velocity * uDeltaTime;
        float floorY = uGridCentre.y - half_.y + uCellSize * 0.5;
        if (position.y < floorY)
        {
            position.y = floorY;
            velocity.y = abs(velocity.y) * uBounce;
            velocity.xz *= 0.55;
            if (velocity.y < 0.25) velocity = vec3(0.0);
            if (kind == 1) age = uLifetime;
        }
        vec3 local = position - uGridCentre;
        if (any(greaterThan(abs(local.xz), half_.xz)) || local.y > half_.y) age = uLifetime;
    }
    fragColour = uOutput == 0 ? vec4(position, age) : vec4(velocity, v.w);
}
`;

export const DebrisRenderVertex = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uPositions;
uniform sampler2D uVelocities;
uniform sampler2D uPrevious;
uniform mat4  uViewProjection;
uniform ivec2 uParticleSize;
uniform float uPointSize;
uniform float uLifetime;
uniform float uGlow;
uniform int   uTrail;
out vec4 vColour;
void main()
{
    int particle = uTrail == 1 ? gl_VertexID / 2 : gl_VertexID;
    int end = uTrail == 1 ? gl_VertexID - particle * 2 : 0;
    ivec2 pixel = ivec2(particle - (particle / uParticleSize.x) * uParticleSize.x, particle / uParticleSize.x);
    vec4 current = texelFetch(uPositions, pixel, 0);
    vec4 previous = texelFetch(uPrevious, pixel, 0);
    vec4 velocity = texelFetch(uVelocities, pixel, 0);
    bool respawned = current.w < previous.w;
    vec3 position = (end == 1 && !respawned) ? previous.xyz : current.xyz;
    int kind = int(floor(velocity.w));
    float seed = fract(velocity.w);
    float alive = current.w < uLifetime ? 1.0 : 0.0;
    float life = current.w / max(uLifetime, 1e-3);
    float heat = exp(-current.w * (1.6 / max(uGlow, 0.05))) * (0.6 + 0.4 * seed);
    vec3 colour;
    float sizeScale = 1.0;
    if (kind == 1)
    {
        float flicker = 0.7 + 0.3 * sin(current.w * (14.0 + 20.0 * seed) + seed * 40.0);
        heat = (1.0 - life) * flicker;
        colour = mix(vec3(0.9, 0.18, 0.02), vec3(1.0, 0.78, 0.35), seed * 0.6 + 0.4 * heat) * (1.2 + 1.8 * heat);
        sizeScale = 0.55 + 0.5 * heat;
    }
    else if (kind == 2)
    {
        float tumble = 0.55 + 0.45 * abs(sin(current.w * (5.0 + 6.0 * seed) + seed * 20.0));
        colour = mix(vec3(0.78, 0.74, 0.66), vec3(0.96, 0.94, 0.88), seed) * tumble;
        sizeScale = 1.4 + 0.8 * seed;
        heat = 0.0;
    }
    else
    {
        vec3 ember = mix(vec3(0.95, 0.22, 0.04), vec3(1.0, 0.85, 0.45), seed);
        vec3 ash = mix(vec3(0.16, 0.14, 0.13), vec3(0.32, 0.29, 0.26), seed);
        colour = mix(ash, ember * (1.0 + 1.5 * heat), smoothstep(0.0, 0.5, heat));
    }
    float speed = length(velocity.xyz);
    float fade = 1.0 - smoothstep(0.8, 1.0, life);
    float alpha = alive * fade * (end == 1 ? (kind == 2 ? 0.0 : 0.35 * smoothstep(0.3, 3.0, speed)) : 0.95);
    vColour = vec4(colour, alpha);
    gl_Position = uViewProjection * vec4(position, 1.0);
    gl_PointSize = uPointSize * sizeScale * (0.55 + 0.9 * seed) * (1.0 + 0.8 * heat);
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                                  GIZMO LINES
//------------------------------------------------------------------------------------------------------------------------

export const LineVertex = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec4 aColour;
uniform mat4 uViewProjection;
out vec4 vColour;
void main()
{
    vColour = aColour;
    gl_Position = uViewProjection * vec4(aPosition, 1.0);
}
`;
