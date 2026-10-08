// Procedural rock surface injected into MeshStandardMaterial (keeps Three's PBR lighting,
// shadows, environment and fog). Everything is analytic and world-space — no textures, no UVs.
//
// Layers (each contributes height + analytic gradient → one normal perturbation):
//   1. strata colour bands with geological dip, bed seams and oxide pockets
//   2. aggregate grain  — 3D value noise, analytic gradient
//   3. mineral flakes   — three stacked plate layers, each with its own colour, size, height,
//                          shape and crystal share (crystals glint); revealed by the hardness
//                          channel and oxidised by the flow channel
//   4. spalling         — irregular patches where a thin sheet flaked off: a shallow bevelled
//                          step (height + normal), paler fresh rock, weathering pits
//   5. cover            — runoff staining, pebble gravel, vegetation, moss, snow
//
// Vertex aux = (deposit, flow, hardness, cavity) from the erosion pipeline (zeros on rocks).

import * as THREE from 'three';
import { makeBedTable, makeStrataFrame } from './strata-model.js';
import { ruggedFieldParams } from './rugged.js';

const vertexHead = /* glsl */`
attribute vec4 aux;
attribute vec4 aux2;
varying vec4 vAux;
varying vec4 vAux2;
varying vec3 vWorldPos;
`;

const vertexBody = /* glsl */`
{
  vec4 wp4 = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    wp4 = instanceMatrix * wp4;
  #endif
  vWorldPos = ( modelMatrix * wp4 ).xyz;
  vAux = aux;
  vAux2 = aux2;
}
`;

const fragmentHead = /* glsl */`
varying vec4 vAux;
varying vec4 vAux2;
varying vec3 vWorldPos;
uniform vec3 uRockA, uRockB, uRockC, uFresh, uOxide, uGrassA, uGrassB, uDry, uMoss, uSnow, uGravel, uRoad, uSilt;
uniform float uShoreWet, uRoadOn, uBedOn;
uniform float uStrataBand, uStrataContrast, uDipX, uDipZ, uSeamStrength, uSeamWidth, uLaminae, uBedGradient, uHardnessTint;
uniform sampler2D uBedTex;   // stratigraphic column: (top, hardness, tint, thickness) per bed
uniform int uBedCount;
uniform float uBedBase, uWorldSize, uBedLateral;
uniform float uBreakAmp, uFaultScale, uFaultWidth, uPlateSeed, uLatAmp;  // broken plates + lateral warp (metres)
uniform float uSubCount, uSubStrength;                                   // substrata paint
uniform float uRugOn, uRugScale, uRugSeed, uRugWarp, uRugWidth;           // rugged plate shading
uniform float uGrainSize, uGrainStrength, uGrainContrast, uGrainFineness;
uniform float uOxideAmount, uOxideScale;
uniform float uCavityStrength;
uniform float uFlakeStrength, uFlakeSheen, uFlakeEdge, uFlakeOxide, uFlakeSparkle;
uniform vec3 uFlakeCol[3];
uniform float uFlakeOn[3], uFlakeSize[3], uFlakeDensity[3], uFlakeHeight[3], uFlakeCrystal[3], uFlakeVar[3], uFlakeShape[3], uFlakeReveal[3];
uniform float uPeelStrength, uPeelScale, uPeelCoverage, uPeelThickness, uPeelBedding, uPeelFresh, uPeelPits, uPeelShadow, uPeelSecond;
uniform float uWetness, uStreakScale, uStreakAmount;
uniform float uGravelAmount, uGravelScale, uGravelRelief, uGravelVariation;
uniform vec3 uSunDir;
uniform float uVegetation, uVegScale, uVegSlope, uVegPatchiness, uDryness;
uniform float uMossiness, uMossScale;
uniform float uSnowLine, uSnowSlopeCos, uSnowSoftness, uSnowRoughness;
uniform float uBumpScale, uBaseRoughness;
uniform float uSeaLevel, uSeed, uIsRock, uDebugView;

// lateral bed-thickness jitter — must match bedJitter() in strata-model.js
float bedJitter( float x, float z ) {
  float a = sin( x * 0.0091 + 0.7 * sin( z * 0.0063 + 1.3 ) );
  float b = cos( z * 0.0077 + 0.5 * sin( x * 0.0052 + 0.4 ) );
  return 1.0 + uBedLateral * ( 0.6 * a + 0.4 * b );
}
// bed containing tilted elevation t (binary search in the column texture)
vec4 bedLookup( float t, out float base ) {
  int lo = 0, hi = uBedCount - 1;
  for ( int k = 0; k < 13; k++ ) {
    if ( lo >= hi ) break;
    int mid = ( lo + hi ) / 2;
    if ( t < texelFetch( uBedTex, ivec2( mid, 0 ), 0 ).x ) hi = mid; else lo = mid + 1;
  }
  vec4 b = texelFetch( uBedTex, ivec2( lo, 0 ), 0 );
  base = b.x - b.w;
  return b;
}

// ---- shared Voronoi plates (bit-identical with noise.js) -------------------------------------
// The SAME plates position the heightfield's rugged relief, the strata fault offsets, the SDF
// crevice carve and this shading — geometry and colour always agree. uint(int) wraps negative
// cell indices mod 2^32 exactly like the JS path, and the plate value blends
// symmetrically (average on the bisector) so a float-vs-double tie-break flip cannot tear it.
uint plateHash( int x, int y, uint seed ) {
  uint h = uint( x ) * 374761393u ^ uint( y ) * 668265263u ^ seed * 2246822519u;
  h = ( h ^ ( h >> 13u ) ) * 1274126177u;
  h ^= h >> 16u;
  return h;
}
// mirror of voronoi2() in noise.js: (F1 value, F2 value, F2-F1 edge) in cell units
vec3 voronoi2( vec2 p, uint seed ) {
  ivec2 ip = ivec2( floor( p ) );
  float f1 = 8.0, f2 = 8.0, v1 = 0.0, v2 = 0.0;
  for ( int dz = -1; dz <= 1; dz++ ) for ( int dx = -1; dx <= 1; dx++ ) {
    ivec2 c = ip + ivec2( dx, dz );
    float hx = float( plateHash( c.x, c.y, seed ) ) / 4294967296.0;
    float hz = float( plateHash( c.x, c.y, seed ^ 0x9e3779b9u ) ) / 4294967296.0;
    float hv = float( plateHash( c.x, c.y, seed ^ 0x51ed2703u ) ) / 4294967296.0;
    vec2 fp = vec2( c ) + 0.5 + ( vec2( hx, hz ) - 0.5 ) * 0.9;
    float d = length( p - fp );
    float v = hv * 2.0 - 1.0;
    if ( d < f1 ) { f2 = f1; v2 = v1; f1 = d; v1 = v; }
    else if ( d < f2 ) { f2 = d; v2 = v; }
  }
  return vec3( v1, v2, f2 - f1 );
}
// Gaea broken-strata frame offset in metres — identical to plateField() in strata-model.js
float plateOffset( float x, float z ) {
  if ( uBreakAmp <= 0.0 ) return 0.0;
  vec3 vn = voronoi2( vec2( x, z ) / uFaultScale, uint( uPlateSeed + 0.5 ) );
  float t = smoothstep( 0.0, max( 1e-3, uFaultWidth / uFaultScale ), vn.z );
  float avg = ( vn.x + vn.y ) * 0.5;
  return ( avg + ( vn.x - avg ) * t ) * uBreakAmp;
}
// Gaea lateral stratification warp in metres — identical to lateralWarp() in strata-model.js
float lateralWarp( float x, float z ) {
  if ( uLatAmp <= 0.0 ) return 0.0;
  float a = sin( x * 0.0042 + 1.7 * sin( z * 0.0031 + 0.6 ) );
  float b = cos( z * 0.0037 + 1.3 * sin( x * 0.0029 + 2.1 ) );
  return uLatAmp * ( 0.55 * a + 0.45 * b );
}
// mirror of ruggedWarp() in rugged.js (note: w uses the updated u, like the JS)
vec2 ruggedWarp( vec2 p, float warp, float seed ) {
  if ( warp <= 0.0 ) return p;
  float a = warp * 0.42;
  float sm = mod( seed, 64.0 );
  float s1 = sin( sm * 0.37 ), s2 = sin( sm * 1.13 + 2.0 );
  float u = p.x + a * ( 0.65 * sin( p.y * 1.9 + s1 ) + 0.35 * sin( ( p.x * 0.8 + p.y ) * 3.1 + s2 ) );
  float w = p.y + a * ( 0.65 * sin( u * 1.7 + s2 ) + 0.35 * sin( ( p.y * 0.8 - u ) * 2.7 + s1 ) );
  return vec2( u, w );
}

float cgHash( uvec3 q ) {
  uint h = q.x * 1597334677u ^ q.y * 3812015801u ^ q.z * 2798796415u;
  h = ( h ^ ( h >> 16u ) ) * 2246822519u;
  h = ( h ^ ( h >> 13u ) ) * 3266489917u;
  return float( h ^ ( h >> 16u ) ) / 4294967295.0;
}
float cgHash2( ivec2 c, float seed ) { return cgHash( uvec3( ivec3( c, int( seed * 7.0 ) + 1000 ) ) ); }
float cgHash3( ivec3 c ) { return cgHash( uvec3( c + ivec3( 4096 ) ) ); }

// 3D value noise with analytic gradient: (value, dx, dy, dz)
vec4 cgNoise3( vec3 p ) {
  ivec3 cell = ivec3( floor( p ) );
  vec3 f = fract( p );
  vec3 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  vec3 du = 30.0 * f * f * ( f * ( f - 2.0 ) + 1.0 );
  float a = cgHash3( cell ), b = cgHash3( cell + ivec3( 1, 0, 0 ) );
  float c = cgHash3( cell + ivec3( 0, 1, 0 ) ), d = cgHash3( cell + ivec3( 1, 1, 0 ) );
  float e = cgHash3( cell + ivec3( 0, 0, 1 ) ), f1 = cgHash3( cell + ivec3( 1, 0, 1 ) );
  float g = cgHash3( cell + ivec3( 0, 1, 1 ) ), h = cgHash3( cell + ivec3( 1, 1, 1 ) );
  float ab = mix( a, b, u.x ), cd = mix( c, d, u.x ), ef = mix( e, f1, u.x ), gh = mix( g, h, u.x );
  float lower = mix( ab, cd, u.y ), upper = mix( ef, gh, u.y );
  vec3 grad = vec3(
    mix( mix( b - a, d - c, u.y ), mix( f1 - e, h - g, u.y ), u.z ),
    mix( cd - ab, gh - ef, u.z ),
    upper - lower ) * du;
  return vec4( mix( lower, upper, u.z ), grad );
}
vec4 cgFbm3( vec3 p, int octaves ) {
  vec4 sum = vec4( 0.0 );
  float amp = 0.5, freq = 1.0, norm = 0.0;
  for ( int o = 0; o < 5; o++ ) {
    if ( o >= octaves ) break;
    vec4 n = cgNoise3( p * freq + float( o ) * 17.3 );
    sum += vec4( n.x, n.yzw * freq ) * amp;
    norm += amp;
    amp *= 0.5; freq *= 2.1;
  }
  return sum / norm;
}

// ---- spalling ("peel") ---------------------------------------------------------------------
// Thin sheets flaked off the face: irregular patches recessed by the sheet thickness with a soft
// bevelled rim (height + analytic normal), a second generation of smaller spalls stepping down
// inside and around them, and sparse weathering pits. No cells, no Voronoi.
struct SpallOut { float h; vec2 g; float fresh; float rim; float pit; };
vec3 spallNoise( vec2 p, float seed ) {   // (value, d/dx, d/dy) of a 3-octave blobby field
  vec4 a = cgNoise3( vec3( p, seed ) );
  vec4 b = cgNoise3( vec3( p * 2.3 + 7.1, seed + 3.0 ) );
  vec4 c = cgNoise3( vec3( p * 5.1 + 2.9, seed + 6.0 ) );
  return vec3( a.x * 0.6 + b.x * 0.28 + c.x * 0.12, a.yz * 0.6 + b.yz * ( 2.3 * 0.28 ) + c.yz * ( 5.1 * 0.12 ) );
}
SpallOut spallLayer( vec2 p, float scale, float coverage, float second, float pits, float aa, float seed ) {
  SpallOut o; o.h = 0.0; o.g = vec2( 0.0 ); o.fresh = 0.0; o.rim = 0.0; o.pit = 0.0;
  vec2 q = p / scale;
  vec3 n1 = spallNoise( q, seed );
  float th = mix( 0.72, 0.44, coverage );
  float w = max( 0.03, aa * 1.2 );
  float t = clamp( ( n1.x - th ) / w + 0.5, 0.0, 1.0 );
  float s1 = t * t * ( 3.0 - 2.0 * t );
  float ds1 = 6.0 * t * ( 1.0 - t ) / w;
  vec2 g1 = ds1 * n1.yz / scale;
  // second generation: smaller spalls, stepping down inside the first and dotted around them
  vec3 n2 = spallNoise( q * 2.9 + 11.0, seed + 29.0 );
  float th2 = mix( 0.78, 0.5, coverage );
  float w2 = max( 0.035, aa * 2.9 * 1.2 );
  float t2 = clamp( ( n2.x - th2 ) / w2 + 0.5, 0.0, 1.0 );
  float s2 = ( t2 * t2 * ( 3.0 - 2.0 * t2 ) ) * second;
  float ds2 = 6.0 * t2 * ( 1.0 - t2 ) / w2 * second;
  vec2 g2 = ds2 * n2.yz * 2.9 / scale;
  o.h = -( s1 + 0.6 * s2 );
  o.g = -( g1 + 0.6 * g2 );
  o.fresh = clamp( s1 + 0.7 * s2, 0.0, 1.0 );
  o.rim = clamp( ( 6.0 * t * ( 1.0 - t ) + 6.0 * t2 * ( 1.0 - t2 ) * second ) / 1.5, 0.0, 1.0 );
  // weathering pits: sparse small craters
  if ( pits > 0.001 ) {
    float ps = scale * 0.14;
    vec2 pq = p / ps;
    ivec2 pc = ivec2( floor( pq ) );
    vec2 pf = fract( pq );
    float paa = aa * scale / ps;
    for ( int y = -1; y <= 1; y++ ) for ( int x = -1; x <= 1; x++ ) {
      ivec2 c = pc + ivec2( x, y );
      float pr = cgHash2( c, seed + 51.0 );
      if ( pr > pits * 0.35 ) continue;
      vec2 centre = vec2( x, y ) + vec2( cgHash2( c, seed + 52.0 ), cgHash2( c, seed + 53.0 ) );
      vec2 dv = pf - centre;
      float d = length( dv );
      float r = 0.12 + 0.16 * cgHash2( c, seed + 54.0 );
      if ( d > r + paa ) continue;
      float x1 = clamp( d / r, 0.0, 1.0 );
      float crater = 1.0 - x1 * x1 * ( 3.0 - 2.0 * x1 );
      float dcr = -6.0 * x1 * ( 1.0 - x1 ) / r;
      vec2 gc = dcr * ( d > 1e-4 ? dv / d : vec2( 0.0 ) ) / ps;
      o.h -= 0.5 * crater;
      o.g += 0.5 * gc;
      o.pit = max( o.pit, crater );
    }
  }
  return o;
}

// ---- mineral flakes ------------------------------------------------------------------------
// Three stacked layers of plates. Every layer has its own colour, size, density, height, shape and
// crystal share; every plate gets a small tint jitter around the layer colour, its own tilt and a
// bevelled rim. The front-most plate wins so plates occlude rather than add.
struct FlakeOut { float cover; vec2 g; vec3 jitter; float crystal; float edge; vec2 facet; };
FlakeOut flakeLayer( vec2 p, float scale, float density, float shape, float aa, float seed ) {
  FlakeOut o; o.cover = 0.0; o.g = vec2( 0.0 ); o.jitter = vec3( 0.5 ); o.crystal = 1.0; o.edge = 0.0; o.facet = vec2( 0.0 );
  vec2 q = p / scale;
  ivec2 cell = ivec2( floor( q ) );
  vec2 f = fract( q );
  float front = -1.0;
  for ( int y = -1; y <= 1; y++ ) for ( int x = -1; x <= 1; x++ ) {
    ivec2 c = cell + ivec2( x, y );
    float pr = cgHash2( c, seed );
    if ( pr < 1.0 - density ) continue;
    vec2 centre = vec2( x, y ) + vec2( cgHash2( c, seed + 1.0 ), cgHash2( c, seed + 2.0 ) );
    float ang = cgHash2( c, seed + 3.0 ) * 6.2831853;
    float ca = cos( ang ), sa = sin( ang );
    mat2 R = mat2( ca, sa, -sa, ca );
    vec2 local = R * ( f - centre );
    float h4 = cgHash2( c, seed + 4.0 ), h5 = cgHash2( c, seed + 5.0 );
    vec2 axes = vec2( 0.8 + h4 * 0.65, 0.75 + pr * 0.8 );
    vec2 d = abs( local ) * axes;
    // angular: box ∩ bevel ∩ oblique cut; rounded: ellipse; shape blends them.
    float bevel = dot( d, vec2( 0.6 + pr * 0.25, 0.55 + h5 * 0.35 ) );
    float cut = dot( local, normalize( vec2( pr - 0.35, 0.65 ) ) ) * 1.18;
    float dPoly = max( max( d.x, d.y ), max( bevel, cut ) );
    float dRound = length( local * axes ) * 0.92;
    float dist = mix( dPoly, dRound, shape );
    float radius = 0.27 + h4 * 0.38;
    float cover = 1.0 - smoothstep( radius - aa, radius + aa, dist );
    if ( cover > 0.001 && pr > front ) {
      front = pr;
      o.cover = cover;
      vec2 tilt = ( vec2( h5, cgHash2( c, seed + 6.0 ) ) - 0.5 ) * 2.0;
      vec2 edgeDir = transpose( R ) * ( sign( local ) * axes );
      float edge = 1.0 - smoothstep( aa, aa + 0.06, abs( dist - radius ) );
      o.edge = edge * cover;
      // plate tilt plus a bevel at the rim [1/cell]
      o.g = transpose( R ) * tilt * cover * 4.0 + edgeDir * o.edge * 3.0;
      o.jitter = vec3( cgHash2( c, seed + 8.0 ), cgHash2( c, seed + 9.0 ), cgHash2( c, seed + 10.0 ) );
      o.crystal = cgHash2( c, seed + 11.0 );
      o.facet = ( vec2( cgHash2( c, seed + 12.0 ), cgHash2( c, seed + 13.0 ) ) - 0.5 ) * 2.0;
    }
  }
  return o;
}

// ---- gravel pebbles ------------------------------------------------------------------------
// Rounded stones packed in a sandy matrix: two generations of jittered-cell ellipsoid domes with a
// proper dome normal and per-stone tone. Front stone wins. Anti-aliased by the pixel footprint.
struct PebbleOut { float cover; vec2 g; float tone; float hue; };
PebbleOut pebbleLayer( vec2 p, float size, float aa, float seed ) {
  PebbleOut o; o.cover = 0.0; o.g = vec2( 0.0 ); o.tone = 0.5; o.hue = 0.5;
  vec2 q = p / size;
  ivec2 cell = ivec2( floor( q ) );
  vec2 f = fract( q );
  float front = -1.0;
  for ( int y = -1; y <= 1; y++ ) for ( int x = -1; x <= 1; x++ ) {
    ivec2 c = cell + ivec2( x, y );
    float pr = cgHash2( c, seed );
    if ( pr < 0.22 ) continue;
    vec2 centre = vec2( x, y ) + 0.5 + ( vec2( cgHash2( c, seed + 1.0 ), cgHash2( c, seed + 2.0 ) ) - 0.5 ) * 0.55;
    float ang = cgHash2( c, seed + 3.0 ) * 3.1415926;
    float ca = cos( ang ), sa = sin( ang );
    mat2 R = mat2( ca, sa, -sa, ca );
    vec2 local = R * ( f - centre );
    vec2 axes = vec2( 1.0, 0.65 + 0.5 * cgHash2( c, seed + 4.0 ) );
    vec2 le = local * axes;
    float d = length( le );
    float r = 0.3 + 0.2 * cgHash2( c, seed + 5.0 );
    float cover = 1.0 - smoothstep( r - aa, r + aa, d );
    if ( cover > 0.001 && pr > front ) {
      front = pr;
      o.cover = cover;
      float x1 = clamp( d / r, 0.0, 0.97 );
      float slope = x1 / sqrt( 1.0 - x1 * x1 );                 // dome: h = r·sqrt(1−x²)
      vec2 dir = d > 1e-4 ? transpose( R ) * ( le * axes / d ) : vec2( 0.0 );
      o.g = -dir * slope * cover * 0.6;                         // [1/cell], scaled by height later
      o.tone = cgHash2( c, seed + 6.0 );
      o.hue = cgHash2( c, seed + 7.0 );
    }
  }
  return o;
}

struct Surface { vec3 albedo; vec3 normalW; float roughness; float ao; float metal; vec3 emissive; };

Surface evaluateCliffSurface( vec3 wp, vec3 n, vec4 aux, vec4 aux2 ) {
  float road = aux2.x * ( 1.0 - uIsRock ) * uRoadOn;
  float riverBed = aux2.y * ( 1.0 - uIsRock ) * uBedOn;
  float lakeBed = aux2.z * ( 1.0 - uIsRock ) * uBedOn;
  float localWater = mix( -1.0e6, aux2.w, 1.0 - uIsRock );
  float waterLine = max( uSeaLevel, localWater );
  float bedCover = clamp( max( road, max( riverBed, lakeBed ) ), 0.0, 1.0 );
  float deposit = aux.x * ( 1.0 - uIsRock );
  float flow = aux.y * ( 1.0 - uIsRock );
  float hardness = aux.z;
  float cavity = aux.w;
  float footprint = max( length( dFdx( wp ) ), length( dFdy( wp ) ) ) + 1e-5;
  float wall = 1.0 - abs( n.y );

  // ---- cover masks first, so rock micro-detail only grows where rock is exposed ----------------
  float speckle = cgNoise3( wp * 2.3 ).x;
  float vegSlopeCos = uVegSlope;
  float flatness = smoothstep( vegSlopeCos - 0.14, vegSlopeCos + 0.1, n.y );
  float vegNoise = cgNoise3( wp / uVegScale ).x * 0.5 + cgNoise3( wp / uVegScale * 5.5 + 2.0 ).x * 0.5;
  float belowSnow = 1.0 - smoothstep( uSnowLine - 160.0, uSnowLine - 20.0, wp.y );
  float aboveWater = smoothstep( uSeaLevel + 1.0, uSeaLevel + 7.0, wp.y );
  float gravelMix = smoothstep( 0.1, 0.6, deposit ) * uGravelAmount;
  float vegThreshold = mix( 0.25, 0.6, uVegPatchiness );
  float veg = uVegetation * flatness * smoothstep( vegThreshold - 0.15, vegThreshold + 0.15, vegNoise + uVegetation * 0.35 - 0.15 ) * ( 1.0 - gravelMix * 0.8 ) * ( 1.0 - uIsRock * 0.9 ) * belowSnow * aboveWater;
  veg = clamp( veg, 0.0, 1.0 ) * ( 1.0 - smoothstep( 0.15, 0.6, bedCover ) );
  float snowNoise = cgNoise3( wp * 0.02 ).x * 70.0 * uSnowSoftness;
  float snowAlt = smoothstep( uSnowLine - 45.0 * uSnowSoftness + snowNoise, uSnowLine + 45.0 * uSnowSoftness + snowNoise, wp.y );
  float rockMask = ( 1.0 - veg ) * ( 1.0 - gravelMix ) * ( 1.0 - snowAlt * smoothstep( uSnowSlopeCos - 0.2, uSnowSlopeCos + 0.1, n.y ) ) * ( 1.0 - smoothstep( 0.2, 0.7, bedCover ) );

  // Triplanar weights
  vec3 w = pow( abs( n ), vec3( 5.0 ) );
  w /= dot( w, vec3( 1.0 ) );

  vec3 G = vec3( 0.0 );
  float fresh = 0.0, rim = 0.0, pit = 0.0;
  float flakeCover = 0.0, flakeCrystal = 0.0, flakeEdge = 0.0;
  vec3 flakeCol = vec3( 0.0 ), flakeFacet = vec3( 0.0 );
  float pebbleCover = 0.0, pebbleTone = 0.0, pebbleHue = 0.0;

  // spalling happens in patches (uPeelCoverage = share of the rock), on exposed rock only
  float peelAmount = uPeelStrength * rockMask;
  float peelThick = uPeelThickness * peelAmount;                 // [m] sheet thickness
  float flakeAmount = uFlakeStrength * rockMask;
  float gravelHere = max( gravelMix, smoothstep( 0.3, 0.9, riverBed ) );
  float hsel = smoothstep( 0.3, 0.7, hardness );

  for ( int axis = 0; axis < 3; axis++ ) {
    float wa = axis == 0 ? w.x : ( axis == 1 ? w.y : w.z );
    if ( wa < 0.02 ) continue;
    vec2 pp = axis == 0 ? wp.yz : ( axis == 1 ? wp.xz : wp.xy );
    pp += vec2( float( axis ) * 37.0, uSeed );
    vec2 g2 = vec2( 0.0 );
    // vertical projections: compress the up axis so spalls follow bedding
    vec2 bedStretch = axis == 1 ? vec2( 1.0 ) : ( axis == 0 ? vec2( 1.0 - 0.4 * uPeelBedding, 1.0 + 0.4 * uPeelBedding ) : vec2( 1.0 + 0.4 * uPeelBedding, 1.0 - 0.4 * uPeelBedding ) );

    if ( peelAmount > 0.003 ) {
      float sc = uPeelScale;
      float fade = 1.0 - smoothstep( 0.1, 0.4, footprint / sc );
      if ( fade > 0.0 ) {
        SpallOut sp = spallLayer( pp * bedStretch, sc, uPeelCoverage, uPeelSecond, uPeelPits, max( 0.01, 1.2 * footprint / sc ), uSeed + float( axis ) * 13.0 );
        g2 += sp.g * bedStretch * peelThick * fade;
        fresh += sp.fresh * fade * wa;
        rim += sp.rim * fade * wa;
        pit += sp.pit * fade * wa;
      }
    }

    if ( flakeAmount > 0.003 ) {
      // bottom → top; the top layer occludes the ones below
      float cov = 0.0, cry = 0.0, edg = 0.0; vec3 col = vec3( 0.0 ), fac = vec3( 0.0 ); vec2 gf = vec2( 0.0 );
      for ( int L = 0; L < 3; L++ ) {
        if ( uFlakeOn[L] < 0.5 ) continue;
        float ls = uFlakeSize[L];
        float vis = 1.0 - smoothstep( 0.12, 0.5, footprint / ls );
        if ( vis < 0.001 ) continue;
        FlakeOut f = flakeLayer( pp + vec2( float( L ) * 19.0, 7.0 ), ls, uFlakeDensity[L], uFlakeShape[L], max( 0.02, 1.3 * footprint / ls ), uSeed + 211.0 + float( L ) * 71.0 + float( axis ) * 7.0 );
        // reveal by the erosion hardness channel: +1 only on hard beds, −1 only on soft beds
        float rv = uFlakeReveal[L];
        float reveal = rv >= 0.0 ? mix( 1.0, hsel, rv ) : mix( 1.0, 1.0 - hsel, -rv );
        float alpha = f.cover * vis * reveal;
        vec3 jit = ( f.jitter - 0.5 ) * uFlakeVar[L];
        vec3 lc = uFlakeCol[L] * ( 1.0 + jit.x * 0.7 ) * ( vec3( 1.0 ) + vec3( jit.y, 0.0, -jit.y ) * 0.25 );
        float isCry = step( f.crystal, uFlakeCrystal[L] );
        lc = mix( lc, lc * 1.25 + vec3( 0.03, 0.04, 0.06 ), isCry );
        cov = mix( cov, 1.0, alpha );
        col = mix( col, lc, alpha );
        cry = mix( cry, isCry, alpha );
        edg = mix( edg, f.edge, alpha );
        fac = mix( fac, vec3( f.facet, 0.0 ), alpha );
        gf = mix( gf, f.g / ls * uFlakeHeight[L] * 0.001, alpha );
      }
      g2 += gf * flakeAmount;
      flakeCover += cov * wa;
      flakeCol += col * wa;
      flakeCrystal += cry * wa;
      flakeEdge += edg * wa;
      flakeFacet += fac * wa;
    }

    if ( gravelHere > 0.003 && uGravelAmount > 0.001 ) {
      float ps = uGravelScale;
      float v1 = 1.0 - smoothstep( 0.12, 0.5, footprint / ps );
      if ( v1 > 0.001 ) {
        PebbleOut pa = pebbleLayer( pp + vec2( 5.0, 23.0 ), ps, max( 0.02, 1.3 * footprint / ps ), uSeed + 307.0 + float( axis ) * 7.0 );
        float ps2 = ps * 0.45;
        float v2 = 1.0 - smoothstep( 0.12, 0.5, footprint / ps2 );
        PebbleOut pb = pebbleLayer( pp + vec2( 41.0, 3.0 ), ps2, max( 0.02, 1.3 * footprint / ps2 ), uSeed + 331.0 + float( axis ) * 7.0 );
        // small stones fill the gaps between the big ones
        float ca = pa.cover * v1, cb = pb.cover * v2 * ( 1.0 - ca );
        float cov = ca + cb;
        vec2 gp = ( pa.g / ps * ps * 0.5 * ca + pb.g / ps2 * ps2 * 0.5 * cb );   // dome height ≈ half the stone size
        g2 += gp * uGravelRelief * gravelHere;
        pebbleCover += cov * wa;
        pebbleTone += ( pa.tone * ca + pb.tone * cb ) * wa;
        pebbleHue += ( pa.hue * ca + pb.hue * cb ) * wa;
      }
    }

    vec3 g3 = axis == 0 ? vec3( 0.0, g2.x, g2.y ) : ( axis == 1 ? vec3( g2.x, 0.0, g2.y ) : vec3( g2.x, g2.y, 0.0 ) );
    G += g3 * wa;
  }
  flakeCol = flakeCover > 1e-4 ? flakeCol / flakeCover : vec3( 0.5 );
  flakeCrystal = flakeCover > 1e-4 ? flakeCrystal / flakeCover : 0.0;
  flakeFacet = flakeCover > 1e-4 ? flakeFacet / flakeCover : vec3( 0.0 );
  flakeCover = clamp( flakeCover * flakeAmount, 0.0, 1.0 );
  pebbleTone = pebbleCover > 1e-4 ? pebbleTone / pebbleCover : 0.5;
  pebbleHue = pebbleCover > 1e-4 ? pebbleHue / pebbleCover : 0.5;
  pebbleCover = clamp( pebbleCover, 0.0, 1.0 );
  fresh = clamp( fresh, 0.0, 1.0 ); rim = clamp( rim, 0.0, 1.0 ); pit = clamp( pit, 0.0, 1.0 );

  // Aggregate grain (3D, no projection needed)
  float grainFade = 1.0 - smoothstep( 0.15, 0.6, footprint / uGrainSize );
  vec4 grain = cgFbm3( wp / uGrainSize, 4 );
  float fineScale = uGrainSize * mix( 0.5, 0.12, uGrainFineness );
  vec4 grainFine = cgFbm3( wp / fineScale + 11.0, 3 );
  float grainAmp = 0.035 * uGrainStrength * grainFade * ( 0.3 + 0.7 * rockMask );
  G += ( grain.yzw / uGrainSize * grainAmp + grainFine.yzw / fineScale * grainAmp * 0.25 * ( 1.0 - smoothstep( 0.15, 0.6, footprint / fineScale ) ) );

  // Normal perturbation from the composite height gradient
  vec3 Gt = ( G - n * dot( n, G ) ) * uBumpScale;
  vec3 nW = normalize( n - Gt );

  // ---- colour --------------------------------------------------------------------------------
  // strata: beds of varying thickness in the dipped frame, wavy, with soft broken seams
  // same frame as the heightfield / 3-D chunks: x,z measured from the tile corner, tilted by the
  // dip, shifted by fault blocks + lateral warp, thinned / thickened by the lateral jitter, then
  // looked up in the stratigraphic column
  float sxj = wp.x + uWorldSize * 0.5, szj = wp.z + uWorldSize * 0.5;
  float bandY = wp.y + uDipX * sxj + uDipZ * szj + plateOffset( sxj, szj ) + lateralWarp( sxj, szj );
  float warp = cgNoise3( wp * 0.012 ).x * 1.5 + cgNoise3( wp * 0.07 + 3.0 ).x * 0.5;
  float bedBase;
  vec4 bedRec = bedLookup( ( bandY + warp ) / ( bedJitter( sxj, szj ) * uStrataBand ), bedBase );
  float bf = clamp( ( ( bandY + warp ) / ( bedJitter( sxj, szj ) * uStrataBand ) - bedBase ) / max( 0.01, bedRec.w ), 0.0, 1.0 );
  float bedHard = bedRec.y;
  float bh = bedRec.z;
  float bh2 = fract( bh * 7.31 + 0.17 );
  float bh3 = fract( bh * 13.7 + 0.43 );
  float lam = floor( bh3 * 3.0 * uLaminae ) + 1.0;
  float sf = fract( bf * lam );
  // colour follows hardness (hard beds pale and clean, soft beds darker / warmer) with the bed's
  // own tint on top, so what was carved is what is painted
  vec3 bandCol = mix( uRockB, uRockA, smoothstep( 0.25, 0.7, bedHard ) );
  bandCol = mix( bandCol, mix( uRockA, uRockB, smoothstep( 0.3, 0.7, bh ) ), 0.45 );
  bandCol = mix( bandCol, uRockC, smoothstep( 0.72, 0.95, bh2 ) * 0.85 );
  bandCol *= 1.0 - uBedGradient * ( 0.25 * ( 1.0 - bf ) + 0.12 * ( 1.0 - sf ) );
  float seamNoise = smoothstep( 0.35, 0.7, cgNoise3( wp * vec3( 0.09, 0.4, 0.09 ) ).x );
  float seam = ( 1.0 - smoothstep( 0.0, uSeamWidth, min( bf, 1.0 - bf ) ) ) * seamNoise;
  bandCol *= 1.0 - uSeamStrength * seam;
  // substrata: fine seams + faint tone steps inside each bed (same sub-phase the heightfield
  // terraced and the chunks carved lips from)
  if ( uSubStrength > 0.001 ) {
    float subF = fract( bf * uSubCount );
    float subSeam = ( 1.0 - smoothstep( 0.0, uSeamWidth * 1.4, min( subF, 1.0 - subF ) ) ) * seamNoise;
    bandCol *= 1.0 - uSubStrength * 0.4 * subSeam;
    bandCol *= 1.0 - uSubStrength * 0.10 * ( 0.5 - subF );
  }
  vec3 rock = mix( uRockA, bandCol, uStrataContrast );
  vec3 strataOnly = rock;
  // terrain beds carry the erosion hardness: caprock paler and cleaner, soft beds darker and warmer
  rock = mix( rock, rock * 1.12 + uRockC * 0.06, hardness * uHardnessTint * ( 1.0 - uIsRock ) );
  rock = mix( rock, rock * vec3( 0.86, 0.78, 0.7 ), ( 1.0 - hardness ) * 0.6 * uHardnessTint * ( 1.0 - uIsRock ) );

  // mottle & grain tint
  rock *= 1.0 - uGrainContrast * 0.45 + uGrainContrast * 0.9 * ( grain.x * 0.5 + 0.5 );
  rock *= 1.0 - uGrainContrast * 0.2 + uGrainContrast * 0.4 * ( grainFine.x * 0.5 + 0.5 );

  float streakPre = smoothstep( 0.56, 0.78, cgNoise3( vec3( wp.x, wp.y * 0.05, wp.z ) / uStreakScale ).x * 0.6 + cgNoise3( vec3( wp.x * 3.6, wp.y * 0.1, wp.z * 3.6 ) / uStreakScale + 5.0 ).x * 0.4 ) * wall;

  // oxide pockets
  float ox = smoothstep( 0.52, 0.8, cgNoise3( wp / uOxideScale + 7.0 ).x * 0.6 + cgNoise3( wp / uOxideScale * 3.4 ).x * 0.4 );
  rock = mix( rock, uOxide, ox * uOxideAmount );

  // spalls: paler fresh rock where the sheet is gone, a soft shadow in the bevel, dark pits
  rock = mix( rock, mix( rock, uFresh, uPeelFresh ), fresh );
  rock *= 1.0 - rim * 0.22 * uPeelShadow;
  rock *= 1.0 - pit * 0.45;

  // flakes: layer colours (already composited top-over-bottom), oxidised by the erosion channels,
  // bright bevel at the rims
  float oxidise = clamp( ox * 0.7 + flow * 0.6 + streakPre * 0.4, 0.0, 1.0 ) * uFlakeOxide;
  vec3 plateCol = mix( flakeCol, uOxide * ( 0.7 + 0.5 * flakeCol.g ), oxidise );
  rock = mix( rock, plateCol, flakeCover );
  rock += vec3( 0.08 ) * clamp( flakeEdge, 0.0, 1.0 ) * flakeAmount * uFlakeEdge;

  // cavity / convexity
  rock *= 1.0 + cavity * 0.35 * uCavityStrength;

  // rugged outcrops: darken the same crevices the heightfield broke and the chunks carved, and
  // give each plate a faint tone so the shattering reads at a glance. Terrain only (scattered
  // rocks carry their own form), faded out where the pixel footprint swallows the slots.
  if ( uRugOn > 0.5 ) {
    float rugFade = ( 1.0 - uIsRock ) * ( 1.0 - smoothstep( 0.15, 0.6, footprint / max( 0.5, uRugWidth * uRugScale ) ) );
    if ( rugFade > 0.001 ) {
      vec2 rp = ruggedWarp( vec2( sxj, szj ) / uRugScale, uRugWarp, uRugSeed );
      vec3 rv = voronoi2( rp, uint( uRugSeed + 0.5 ) );
      float crev = 1.0 - smoothstep( 0.0, uRugWidth, rv.z );
      float plateTone = ( rv.x + rv.y ) * 0.5;
      rock *= 1.0 - crev * 0.30 * rugFade;
      rock *= 1.0 + plateTone * 0.045 * rugFade;
    }
  }

  // runoff staining
  float streak = cgNoise3( vec3( wp.x, wp.y * 0.05, wp.z ) / uStreakScale ).x * 0.6 + cgNoise3( vec3( wp.x * 3.6, wp.y * 0.1, wp.z * 3.6 ) / uStreakScale + 5.0 ).x * 0.4;
  streak = smoothstep( 0.56, 0.78, streak ) * uStreakAmount;
  float wet = clamp( uWetness * ( flow * 0.9 + streak * wall * 0.7 ), 0.0, 1.0 );
  rock *= 1.0 - wet * 0.5;

  // scree gravel on deposits: pebbles in a sandy matrix
  vec3 matrix = mix( uGravel, uSilt, 0.5 ) * 0.8 * ( 0.9 + 0.2 * speckle );
  vec3 stone = uGravel * ( 1.0 - uGravelVariation * 0.5 + uGravelVariation * pebbleTone ) * ( vec3( 1.0 ) + vec3( pebbleHue - 0.5, 0.0, 0.5 - pebbleHue ) * 0.25 * uGravelVariation );
  vec3 gravel = mix( matrix, stone, pebbleCover );
  rock = mix( rock, gravel, gravelMix );

  // drawn features: river beds (cobbles → silt towards the banks), lake beds (silt), roads
  float cobble = cgNoise3( wp * 2.6 ).x * 0.5 + cgNoise3( wp * 9.0 + 3.0 ).x * 0.5;
  vec3 bedCol = mix( uSilt, mix( uGravel * ( 0.65 + 0.7 * cobble ), gravel, step( 0.001, uGravelAmount ) ), smoothstep( 0.45, 0.95, riverBed ) );
  bedCol = mix( bedCol, uSilt * ( 0.9 + 0.2 * speckle ), lakeBed * ( 1.0 - riverBed ) );
  float bedMix = smoothstep( 0.05, 0.5, max( riverBed, lakeBed ) );
  rock = mix( rock, bedCol, bedMix );
  float roadSurf = smoothstep( 0.5, 0.75, road );
  float shoulder = smoothstep( 0.1, 0.4, road ) * ( 1.0 - roadSurf );
  vec3 roadCol = uRoad * ( 0.9 + 0.2 * cgNoise3( wp * 1.7 ).x ) * ( 0.94 + 0.12 * cgNoise3( wp * 14.0 ).x );
  rock = mix( rock, mix( uGravel, uDry, 0.4 ) * ( 0.85 + 0.3 * speckle ), shoulder );
  rock = mix( rock, roadCol, roadSurf );

  // vegetation: grass with dry patches and bare soil
  float dry = smoothstep( 0.45, 0.7, cgNoise3( wp / uVegScale * 2.5 + 23.0 ).x ) * uDryness;
  vec3 grass = mix( uGrassA, uGrassB, cgNoise3( wp * 0.12 ).x * 0.7 + 0.15 );
  grass = mix( grass, uDry, dry );
  grass *= 0.85 + 0.3 * speckle;

  // moss in sheltered concavities
  float moss = uMossiness * ( 0.35 + 0.65 * smoothstep( 0.0, 0.6, -cavity ) ) * smoothstep( 0.05, 0.7, n.y + 0.2 )
    * smoothstep( 0.5, 0.78, cgNoise3( wp / uMossScale ).x * 0.6 + cgNoise3( wp / uMossScale * 0.15 + 9.0 ).x * 0.4 ) * belowSnow * aboveWater * ( 1.0 - fresh * 0.5 );
  moss = clamp( moss, 0.0, 1.0 );

  vec3 color = mix( rock, grass, veg );
  color = mix( color, uMoss * ( 0.8 + 0.4 * speckle ), moss * 0.8 );

  // snow
  float snow = snowAlt * smoothstep( uSnowSlopeCos - 0.12, uSnowSlopeCos + 0.1, nW.y );
  snow = clamp( snow * ( 1.0 + deposit * 0.6 + max( 0.0, -cavity ) * 0.4 ), 0.0, 1.0 );
  color = mix( color, uSnow, snow );

  // wet band at the shoreline and darker, cooler ground under water
  float shore = 1.0 - smoothstep( waterLine - 0.3, waterLine + 1.2 * uShoreWet + 0.3, wp.y );
  color *= mix( 1.0, 0.62, shore * uShoreWet );
  float under = 1.0 - smoothstep( waterLine - 2.5, waterLine, wp.y );
  color = mix( color, color * vec3( 0.55, 0.62, 0.62 ), under );

  float roughness = uBaseRoughness - wet * 0.4 - fresh * 0.05 - shore * 0.35 * uShoreWet;
  roughness = mix( roughness, 0.95, roadSurf );
  roughness = mix( roughness, 0.45, flakeCover * uFlakeSheen );
  float crystalMask = flakeCover * flakeCrystal;
  roughness = mix( roughness, 0.12, crystalMask );
  float metal = 0.35 * crystalMask;
  // glitter: each crystal plate is a tiny facet; a sharp highlight when it lines up with the sun
  vec3 V = normalize( cameraPosition - wp );
  vec3 H = normalize( V + normalize( uSunDir ) );
  vec3 facetN = normalize( nW + flakeFacet * 0.35 );
  float glint = pow( max( dot( facetN, H ), 0.0 ), 260.0 );
  vec3 emissive = vec3( glint * crystalMask * uFlakeSparkle * 2.5 ) * ( 1.0 - snow ) * ( 1.0 - veg );
  roughness = mix( roughness, 0.95, veg );
  roughness = mix( roughness, uSnowRoughness, snow );

  float ao = ( 1.0 - rim * 0.25 * uPeelShadow ) * ( 1.0 - pit * 0.4 ) * ( 1.0 - max( 0.0, -cavity ) * 0.4 * uCavityStrength );
  ao = mix( ao, 1.0, snow * 0.6 );

  vec3 nFinal = normalize( mix( nW, n, max( snow, veg * 0.8 ) ) );

  Surface s;
  s.albedo = color;
  s.normalW = nFinal;
  s.roughness = clamp( roughness, 0.08, 1.0 );
  s.ao = ao;
  s.metal = metal;
  s.emissive = emissive;
  if ( uDebugView > 0.5 ) {
    // Isolate one layer so its contribution can be judged on its own (lit, flat normal).
    vec3 dbg = vec3( 0.0 );
    if ( uDebugView < 1.5 ) dbg = strataOnly;
    else if ( uDebugView < 2.5 ) dbg = vec3( 0.5 + 0.5 * grain.x ) * ( 1.0 - uGrainContrast * 0.5 + uGrainContrast * ( 0.5 + 0.5 * grainFine.x ) ) * ( 0.3 + 0.7 * uGrainStrength );
    else if ( uDebugView < 3.5 ) dbg = mix( vec3( 0.12 ), flakeCol + vec3( 0.25 ) * clamp( flakeEdge, 0.0, 1.0 ) * uFlakeEdge + vec3( 0.3, 0.3, 0.6 ) * flakeCrystal, flakeCover );
    else if ( uDebugView < 4.5 ) dbg = vec3( 0.15 ) + vec3( 0.0, 0.7, 0.9 ) * fresh + vec3( 0.9, 0.2, 0.1 ) * rim + vec3( 0.0, 0.0, 0.6 ) * pit;
    else if ( uDebugView < 5.5 ) dbg = mix( vec3( 0.1 ), vec3( 0.3 + 0.6 * pebbleTone ), pebbleCover ) * ( 0.3 + 0.7 * gravelHere );
    else if ( uDebugView < 6.5 ) dbg = vec3( 0.12 ) + vec3( 0.1, 0.7, 0.1 ) * veg + vec3( 0.05, 0.3, 0.15 ) * moss + vec3( 0.9 ) * snow + vec3( 0.5, 0.4, 0.3 ) * gravelMix;
    else if ( uDebugView < 7.5 ) dbg = vec3( rockMask, wet, hardness );
    else dbg = vec3( road, riverBed, lakeBed ) + vec3( 0.0, 0.0, 0.4 ) * under;
    s.albedo = dbg;
    s.normalW = n;
    s.roughness = 1.0;
    s.ao = 1.0;
    s.metal = 0.0;
    s.emissive = vec3( 0.0 );
  }
  return s;
}
`;

const fragmentBody = /* glsl */`
{
  vec3 geomN = inverseTransformDirection( normal, viewMatrix );
  Surface s = evaluateCliffSurface( vWorldPos, geomN, vAux, vAux2 );
  diffuseColor.rgb = s.albedo;
  #ifdef USE_COLOR
    diffuseColor.rgb *= vColor.rgb;
  #endif
  roughnessFactor = s.roughness;
  metalnessFactor = s.metal;
  normal = normalize( ( viewMatrix * vec4( s.normalW, 0.0 ) ).xyz );
  cgAO = s.ao;
  cgEmissive = s.emissive;
}
`;

const colorKeys = { uRoad: 'roadColor', uSilt: 'siltColor', uRockA: 'rockA', uRockB: 'rockB', uRockC: 'rockC', uFresh: 'fresh', uOxide: 'oxide', uGrassA: 'grassA', uGrassB: 'grassB', uDry: 'dryColor', uMoss: 'mossColor', uSnow: 'snowColor', uGravel: 'gravelColor' };

// uniform → [value key, enable key (optional), scale]
const scalarKeys = {
  uStrataContrast: ['strataContrast', 'strataOn'], uSeamStrength: ['seamStrength', 'strataOn'], uSeamWidth: ['seamWidth'], uLaminae: ['laminae', 'strataOn'], uBedGradient: ['bedGradient', 'strataOn'], uHardnessTint: ['hardnessTint', 'strataOn'],
  uGrainSize: ['grainSize'], uGrainStrength: ['grainStrength', 'grainOn'], uGrainContrast: ['grainContrast', 'grainOn'], uGrainFineness: ['grainFineness'],
  uOxideAmount: ['oxideAmount', 'oxideOn'], uOxideScale: ['oxideScale'], uCavityStrength: ['cavityStrength'],
  uFlakeStrength: ['flakeStrength', 'flakesOn'], uFlakeSheen: ['flakeSheen'], uFlakeEdge: ['flakeEdge'], uFlakeOxide: ['flakeOxide'], uFlakeSparkle: ['flakeSparkle'],
  uPeelStrength: ['peelStrength', 'peelOn'], uPeelScale: ['peelScale'], uPeelCoverage: ['peelCoverage'], uPeelThickness: ['peelThickness'], uPeelBedding: ['peelBedding'], uPeelFresh: ['peelFresh'], uPeelPits: ['peelPits'], uPeelShadow: ['peelShadow'], uPeelSecond: ['peelSecond'],
  uWetness: ['wetness', 'runoffOn'], uStreakScale: ['streakScale'], uStreakAmount: ['streakAmount'],
  uGravelAmount: ['gravelAmount', 'gravelOn'], uGravelScale: ['gravelScale'], uGravelRelief: ['gravelRelief'], uGravelVariation: ['gravelVariation'],
  uVegetation: ['vegetation', 'vegOn'], uVegScale: ['vegScale'], uVegPatchiness: ['vegPatchiness'], uDryness: ['dryness'],
  uMossiness: ['mossiness', 'mossOn'], uMossScale: ['mossScale'],
  uSnowSoftness: ['snowSoftness'], uSnowRoughness: ['snowRoughness'],
  uBumpScale: ['bumpScale'], uBaseRoughness: ['baseRoughness'], uDebugView: ['debugView'], uShoreWet: ['shoreWet'], uRoadOn: ['roadShading'], uBedOn: ['bedShading'],
};

// per-layer flake uniforms (arrays of 3): uniform → value key prefix (key = prefix + layer index 1..3)
const flakeArrayKeys = { uFlakeOn: 'flakeOn', uFlakeSize: 'flakeSize', uFlakeDensity: 'flakeDensity', uFlakeHeight: 'flakeHeight', uFlakeCrystal: 'flakeCrystal', uFlakeVar: 'flakeVar', uFlakeShape: 'flakeShape', uFlakeReveal: 'flakeReveal' };

export function makeSurfaceUniforms() {
  const u = {};
  for (const k of Object.keys(colorKeys)) u[k] = { value: new THREE.Color(0.5, 0.5, 0.5) };
  for (const k of Object.keys(scalarKeys)) u[k] = { value: 0 };
  for (const k of Object.keys(flakeArrayKeys)) u[k] = { value: [0, 0, 0] };
  u.uFlakeCol = { value: [new THREE.Color(), new THREE.Color(), new THREE.Color()] };
  u.uSunDir = { value: new THREE.Vector3(0.3, 0.8, 0.5) };
  Object.assign(u, {
    uStrataBand: { value: 1 }, uDipX: { value: 0 }, uDipZ: { value: 0 },
    uBedTex: { value: makeBedTexture(new Float32Array(4), 1) }, uBedCount: { value: 1 }, uBedBase: { value: -1500 }, uWorldSize: { value: 2048 }, uBedLateral: { value: 0.18 },
    uBreakAmp: { value: 0 }, uFaultScale: { value: 120 }, uFaultWidth: { value: 6 }, uPlateSeed: { value: 0 }, uLatAmp: { value: 0 },
    uSubCount: { value: 3 }, uSubStrength: { value: 0 },
    uRugOn: { value: 0 }, uRugScale: { value: 45 }, uRugSeed: { value: 0 }, uRugWarp: { value: 0.4 }, uRugWidth: { value: 0.15 },
    uVegSlope: { value: 0.72 }, uSnowLine: { value: 430 }, uSnowSlopeCos: { value: 0.67 },
    uSeaLevel: { value: 0 }, uSeed: { value: 428 },
  });
  return u;
}

export function updateSurfaceUniforms(uniforms, v) {
  for (const [u, key] of Object.entries(colorKeys)) uniforms[u].value.setStyle(v[key] || '#808080');
  for (const [u, [key, enable]] of Object.entries(scalarKeys)) {
    const on = enable ? (v[enable] ? 1 : 0) : 1;
    uniforms[u].value = Number(v[key]) * on;
  }
  for (const [u, prefix] of Object.entries(flakeArrayKeys)) for (let L = 0; L < 3; L++) uniforms[u].value[L] = Number(v[`${prefix}${L + 1}`]);
  for (let L = 0; L < 3; L++) uniforms.uFlakeCol.value[L].setStyle(v[`flakeColor${L + 1}`] || '#808080');
  // the shader divides the tilted elevation by uStrataBand before the table lookup, so the
  // colour-band scale (default 1) stretches the painted beds relative to the carved ones
  uniforms.uStrataBand.value = v.strataBandScale || 1;
  uniforms.uWorldSize.value = v.worldSize;
  uniforms.uBedLateral.value = v.strataLateral == null ? 0.18 : v.strataLateral;
  const bedKey = `${v.seed}|${v.strataBand}|${v.strataVariation}|${v.strataPackaging}|${v.strataHardShare}`;
  if (uniforms.uBedTex.key !== bedKey) {
    const table = makeBedTable(v);
    const count = Math.min(4096, table.count);
    const data = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) { data[i * 4] = table.tops[i]; data[i * 4 + 1] = table.hard[i]; data[i * 4 + 2] = table.tint[i]; data[i * 4 + 3] = table.thick[i]; }
    if (uniforms.uBedTex.value) uniforms.uBedTex.value.dispose();
    uniforms.uBedTex.value = makeBedTexture(data, count);
    uniforms.uBedTex.key = bedKey;
    uniforms.uBedCount.value = count;
    uniforms.uBedBase.value = table.base;
  }
  const dipRad = (v.strataDip * Math.PI) / 180, dirRad = (v.strataDipDirection * Math.PI) / 180;
  uniforms.uDipX.value = Math.tan(dipRad) * Math.cos(dirRad);
  uniforms.uDipZ.value = Math.tan(dipRad) * Math.sin(dirRad);
  // broken plates + lateral warp + substrata: same frame object the heightfield and chunks use
  const frame = makeStrataFrame(v);
  uniforms.uBreakAmp.value = frame.breakAmp;
  uniforms.uFaultScale.value = frame.faultScale;
  uniforms.uFaultWidth.value = frame.faultWidth;
  uniforms.uPlateSeed.value = frame.plateSeed;
  uniforms.uLatAmp.value = frame.lateralAmp;
  uniforms.uSubCount.value = frame.subCount;
  uniforms.uSubStrength.value = frame.subStrength;
  // rugged plate shading: same field the heightfield broke and the chunks carved
  const rugOn = (v.ruggedAmount || 0) > 0 ? 1 : 0;
  uniforms.uRugOn.value = rugOn;
  if (rugOn) {
    const fp = ruggedFieldParams(v);
    uniforms.uRugScale.value = fp.scale;
    uniforms.uRugSeed.value = fp.seed;
    uniforms.uRugWarp.value = fp.warp;
    uniforms.uRugWidth.value = fp.widthCells;
  }
  uniforms.uVegSlope.value = Math.cos((v.vegSlope * Math.PI) / 180);
  uniforms.uSnowLine.value = v.snowOn ? v.snowLine : 1e6;
  uniforms.uSnowSlopeCos.value = Math.cos((v.snowSlope * Math.PI) / 180);
  uniforms.uSeaLevel.value = v.waterEnabled ? v.seaLevel : -1e6;
  uniforms.uSeed.value = v.seed % 1000;
}

function makeBedTexture(data, count) {
  const tex = new THREE.DataTexture(data, count, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false; tex.needsUpdate = true;
  return tex;
}

export function makeSurfaceMaterial(uniforms, { isRock = false } = {}) {
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, color: 0xffffff });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uIsRock: { value: isRock ? 1 : 0 } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vertexHead}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${vertexBody}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragmentHead}\nfloat cgAO = 1.0;\nvec3 cgEmissive = vec3( 0.0 );`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += cgEmissive;')
      .replace('#include <normal_fragment_maps>', fragmentBody)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= cgAO;\nreflectedLight.indirectSpecular *= cgAO;\nreflectedLight.directDiffuse *= mix( 1.0, cgAO, 0.5 );`);
  };
  material.customProgramCacheKey = () => `cliff-surface-${isRock ? 'rock' : 'terrain'}`;
  return material;
}
