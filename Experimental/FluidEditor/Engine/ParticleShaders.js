//------------------------------------------------------------------------------------------------------------------------
//                                                  PARTICLE SHADERS
//          GLSL ES 3.00 — Shape Sampling, Emit / Cloner Integration against the Force Field + Gas, Sprite Rendering
//------------------------------------------------------------------------------------------------------------------------

import { VolumeChunk, NoiseChunk, ForceFieldChunk, RampChunk } from './FluidShaders.js';

/** Deterministic shape sampling shared by spawning (random salt) and cloner homes (lattice salt = -1). */
export const ParticleShapeChunk = `
uniform int   uShape;        // 0 Point, 1 Sphere, 2 Box, 3 Disc, 4 Ring, 5 Line, 6 Grid
uniform vec3  uOrigin;
uniform vec3  uAxis;
uniform float uRadius;
uniform int   uCount;
uniform float uFill;

void ShapeBasis(out vec3 t, out vec3 b)
{
    vec3 n = uAxis;
    vec3 helper = abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    t = normalize(cross(helper, n));
    b = cross(n, t);
}

// index/count drive lattice placement for cloners; rnd (3 uniform randoms) drives emission spawns.
vec3 ShapePoint(int index, vec3 rnd, bool lattice)
{
    vec3 t, b; ShapeBasis(t, b);
    float count = float(max(uCount, 1));
    float i = float(index);
    if (uShape == 1)
    {
        if (lattice)
        {
            float golden = 2.39996323;
            float y = 1.0 - (i + 0.5) / count * 2.0;
            float r = sqrt(max(0.0, 1.0 - y * y));
            float a = golden * i;
            float shell = mix(1.0, pow(Hash31(vec3(i, 3.1, 7.7)), 1.0 / 3.0), uFill);
            return uOrigin + vec3(cos(a) * r, y, sin(a) * r) * uRadius * shell;
        }
        vec3 d = normalize(rnd * 2.0 - 1.0 + 1e-4);
        return uOrigin + d * uRadius * pow(Hash31(rnd.zxy + 2.7), 1.0 / 3.0);
    }
    if (uShape == 2 || uShape == 6)
    {
        if (lattice || uShape == 6)
        {
            float side = ceil(pow(count, 1.0 / 3.0));
            float x = mod(i, side), y = mod(floor(i / side), side), z = floor(i / (side * side));
            vec3 cell = (vec3(x, y, z) + 0.5) / side * 2.0 - 1.0;
            return uOrigin + (t * cell.x + uAxis * cell.y + b * cell.z) * uRadius;
        }
        vec3 cell = rnd * 2.0 - 1.0;
        return uOrigin + (t * cell.x + uAxis * cell.y + b * cell.z) * uRadius;
    }
    if (uShape == 3)
    {
        float a, r;
        if (lattice) { a = 2.39996323 * i; r = sqrt((i + 0.5) / count); }
        else { a = rnd.x * 6.2831853; r = sqrt(rnd.y); }
        return uOrigin + (t * cos(a) + b * sin(a)) * r * uRadius;
    }
    if (uShape == 4)
    {
        float a = lattice ? i / count * 6.2831853 : rnd.x * 6.2831853;
        return uOrigin + (t * cos(a) + b * sin(a)) * uRadius;
    }
    if (uShape == 5)
    {
        float s = lattice ? (i + 0.5) / count * 2.0 - 1.0 : rnd.x * 2.0 - 1.0;
        return uOrigin + uAxis * s * uRadius;
    }
    return uOrigin;
}
`;

export const ParticleUpdateFragment = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${VolumeChunk}
${NoiseChunk}
${ForceFieldChunk}
${ParticleShapeChunk}
uniform sampler2D uPositions;    // xyz, age
uniform sampler2D uVelocities;   // xyz, seed
uniform sampler2D uVelocity;     // gas velocity volume
uniform int   uOutput;           // 0 positions, 1 velocities
uniform int   uReset;
uniform int   uMode;             // 0 emit, 1 cloner
uniform ivec2 uParticleSize;
uniform float uDeltaTime;
uniform float uEnvelope;         // timing-key envelope
uniform float uRate;
uniform float uLifetime;
uniform float uSpeed;
uniform float uSpread;
uniform float uRadial;
uniform float uGravity;
uniform float uDrag;
uniform float uNoise;
uniform float uFieldInfluence;
uniform float uGasInfluence;
uniform float uSpring;
uniform float uDamping;
uniform float uBounce;
uniform float uNoiseScale;
uniform float uNoiseSpeed;
uniform float uDissolve;
uniform float uLinger;
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
    int index = int(pixel.x) + int(pixel.y) * uParticleSize.x;
    vec4 p = texelFetch(uPositions, ivec2(pixel), 0);
    vec4 v = texelFetch(uVelocities, ivec2(pixel), 0);
    float seed = Hash31(vec3(pixel, 4.2));
    vec3 home = ShapePoint(index, vec3(0.0), true);
    if (uDissolve > 0.0) home += CurlNoise(home * uNoiseScale + vec3(uTime * uNoiseSpeed, 2.7, -uTime * uNoiseSpeed * 0.6)) * uDissolve;
    if (uReset == 1)
    {
        if (uMode == 1) fragColour = uOutput == 0 ? vec4(home, seed * uLifetime) : vec4(0.0, 0.0, 0.0, seed);
        else fragColour = uOutput == 0 ? vec4(0.0, -1e4, 0.0, uLifetime + 1.0) : vec4(0.0, 0.0, 0.0, seed);
        return;
    }
    vec3 position = p.xyz;
    vec3 velocity = v.xyz;
    float age = p.w;
    vec3 half_ = GridHalf();
    bool alive = uMode == 1 || age < uLifetime;
    bool lingering = !alive && age < uLifetime + uLinger;
    if (index >= uCount) { fragColour = uOutput == 0 ? vec4(0.0, -1e4, 0.0, uLifetime + 1.0) : vec4(0.0, 0.0, 0.0, seed); return; }

    if (lingering) age += uDeltaTime;
    if (!alive && !lingering)
    {
        float chance = uRate * uEnvelope * uDeltaTime;
        if (Hash31(vec3(pixel, uTime)) < chance)
        {
            vec3 rnd = vec3(Hash31(vec3(pixel, uTime + 1.3)), Hash31(vec3(pixel.yx, uTime + 2.9)), Hash31(vec3(pixel + 7.0, uTime + 4.1)));
            position = ShapePoint(index, rnd, false);
            vec3 random = RandomDirection(vec3(pixel, uTime + 8.8));
            vec3 outward = position - uOrigin;
            outward = length(outward) > 1e-4 ? normalize(outward) : random;
            vec3 launch = normalize(mix(uAxis, outward, uRadial) + 1e-4);
            velocity = normalize(mix(launch, random, uSpread) + 1e-4) * uSpeed * (0.75 + 0.5 * Hash31(vec3(pixel, uTime + 6.6)));
            age = 0.0;
            alive = true;
        }
    }
    if (alive)
    {
        age += uDeltaTime;
        vec3 acceleration = vec3(0.0, -uGravity, 0.0);
        if (uFieldInfluence != 0.0) acceleration += EvaluateForceField(position, velocity) * uFieldInfluence;
        if (uNoise != 0.0) acceleration += CurlNoise(position * uNoiseScale + vec3(uTime * uNoiseSpeed, v.w * 0.7, -uTime * uNoiseSpeed * 0.4)) * uNoise * 3.0;
        if (uGasInfluence != 0.0)
        {
            vec3 gas = SampleVolume(uVelocity, CellFromWorld(position)).xyz;
            acceleration += (gas - velocity) * uGasInfluence;
        }
        if (uMode == 1) acceleration += (home - position) * uSpring - velocity * uDamping;
        velocity += acceleration * uDeltaTime;
        velocity *= exp(-uDrag * uDeltaTime);
        position += velocity * uDeltaTime;
        float floorY = uGridCentre.y - half_.y + 0.01;
        if (position.y < floorY && uBounce >= 0.0)
        {
            position.y = floorY;
            velocity.y = abs(velocity.y) * uBounce;
            velocity.xz *= 0.7;
        }
        vec3 local = position - uGridCentre;
        if (uMode == 0 && (any(greaterThan(abs(local.xz), half_.xz * 1.05)) || local.y > half_.y * 1.2 || local.y < -half_.y * 1.5)) age = max(age, uLifetime);
    }
    fragColour = uOutput == 0 ? vec4(position, age) : vec4(velocity, v.w);
}
`;

/** Shared per-particle shading (colour rules, palette, jitter, flicker, life fade). Used by sprites and trails. */
export const ParticleShadeChunk = `
uniform int   uMode;          // 0 emit, 1 cloner
uniform int   uColourMode;    // 0 life, 1 speed, 2 displacement, 3 height, 4 random hue, 5 swatch, 6 cycle
uniform int   uRampMode;
uniform int   uRampSource;    // 0 palette gradient, 1 analytic ramp
uniform vec3  uPalette[8];
uniform int   uPaletteCount;
uniform float uHueJitter;
uniform float uBrightnessJitter;
uniform float uCycleSpeed;
uniform float uBrightness;
uniform float uLifetime;
uniform float uLinger;
uniform float uMaxSpeed;
uniform float uDisplacementRange;
uniform float uFlicker;
uniform float uTime;
uniform float uDomainHeight;
float gLinger = 1.0;
vec3 HueToRgb(float h)
{
    vec3 k = mod(vec3(5.0, 3.0, 1.0) + h * 6.0, 6.0);
    return 1.0 - clamp(min(k, 4.0 - k), 0.0, 1.0) * 0.85;
}
vec3 PaletteGradient(float t)
{
    int count = max(uPaletteCount, 1);
    if (count == 1) return uPalette[0];
    float x = clamp(t, 0.0, 1.0) * float(count - 1);
    int i = int(min(floor(x), float(count - 2)));
    return mix(uPalette[i], uPalette[i + 1], x - float(i));
}
vec3 PaletteSwatch(float seed)
{
    return uPalette[int(min(floor(seed * float(uPaletteCount)), float(uPaletteCount - 1)))];
}
vec3 Gradient(float t) { return uRampSource == 1 ? Ramp(uRampMode, t) : PaletteGradient(t); }
vec3 HueRotate(vec3 colour, float angle)
{
    const vec3 k = vec3(0.57735);
    float c = cos(angle), s = sin(angle);
    return colour * c + cross(k, colour) * s + k * dot(k, colour) * (1.0 - c);
}
// Returns rgb; writes life (0..1), alpha (alive × life fade × flicker) and flicker.
vec3 ParticleShade(int particle, vec4 current, vec4 velocity, out float life, out float alpha, out float flicker)
{
    float alive = (uMode == 1 || current.w < uLifetime) && particle < uCount ? 1.0 : 0.0;
    life = uMode == 1 ? 0.5 : clamp(current.w / max(uLifetime, 1e-3), 0.0, 1.0);
    float speed = length(velocity.xyz);
    float t;
    vec3 colour;
    if (uColourMode == 1) { t = clamp(speed / max(uMaxSpeed, 1e-3), 0.0, 1.0); colour = Gradient(t); }
    else if (uColourMode == 2) { vec3 home = ShapePoint(particle, vec3(0.0), true); t = clamp(distance(current.xyz, home) / max(uDisplacementRange, 1e-3), 0.0, 1.0); colour = Gradient(t); }
    else if (uColourMode == 3) { t = clamp(current.y / max(uDomainHeight, 1e-3) + 0.5, 0.0, 1.0); colour = Gradient(t); }
    else if (uColourMode == 4) { colour = HueToRgb(velocity.w); t = life; }
    else if (uColourMode == 5) { colour = PaletteSwatch(fract(velocity.w * 7.31 + 0.137)); t = life; }
    else if (uColourMode == 6) { t = fract(uTime * uCycleSpeed + velocity.w * 0.35 + float(particle) / float(max(uCount, 1)) * 0.5); colour = PaletteGradient(abs(t * 2.0 - 1.0)); }
    else { t = life; colour = PaletteGradient(life); }
    if (uHueJitter > 0.0) colour = HueRotate(colour, (fract(velocity.w * 13.7) - 0.5) * uHueJitter * 6.2831853);
    if (uBrightnessJitter > 0.0) colour *= 1.0 + (fract(velocity.w * 29.3) - 0.5) * 2.0 * uBrightnessJitter;
    colour = max(colour, 0.0) * uBrightness;
    flicker = uFlicker > 0.0 ? mix(1.0, 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (3.0 + 5.0 * velocity.w) + velocity.w * 50.0)), uFlicker) : 1.0;
    float fade = uMode == 1 ? 1.0 : smoothstep(0.0, 0.05, life) * (1.0 - smoothstep(0.75, 1.0, life));
    alpha = alive * fade * flicker;
    // Trails outlive the particle: expose the linger fade (1 while alive → 0 at lifetime + linger).
    gLinger = uMode == 1 ? 1.0 : (particle < uCount ? clamp(1.0 - (current.w - uLifetime) / max(uLinger, 1e-3), 0.0, 1.0) : 0.0);
    if (uColourMode != 4) colour *= 0.85 + 0.3 * flicker;
    return colour;
}
`;

export const ParticleRenderVertex = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${NoiseChunk}
${RampChunk}
${ParticleShapeChunk}
${ParticleShadeChunk}
uniform sampler2D uPositions;
uniform sampler2D uVelocities;
uniform sampler2D uPrevious;
uniform mat4  uViewProjection;
uniform ivec2 uParticleSize;
uniform int   uTrail;
uniform float uSizeStart;
uniform float uSizeEnd;
uniform float uPixelRatio;
uniform float uSizeRandom;
uniform int   uSizeMode;      // 0 world metres, 1 pixels
uniform float uFocalPixels;   // viewport height / (2 tan(fov/2))
uniform vec3  uCameraPosition;
uniform vec3  uCameraForward;
uniform float uFocusDistance; // 0 = DOF off
uniform float uAperture;
uniform float uHaloScale;     // 1 = main pass, >1 = glow halo pass
uniform float uHaloAlpha;
out vec4 vColour;
out float vSoft;
out float vAcross;
void main()
{
    vAcross = 0.0;
    int particle = uTrail == 1 ? gl_VertexID / 2 : gl_VertexID;
    int end = uTrail == 1 ? gl_VertexID - particle * 2 : 0;
    ivec2 pixel = ivec2(particle - (particle / uParticleSize.x) * uParticleSize.x, particle / uParticleSize.x);
    vec4 current = texelFetch(uPositions, pixel, 0);
    vec4 previous = texelFetch(uPrevious, pixel, 0);
    vec4 velocity = texelFetch(uVelocities, pixel, 0);
    bool respawned = current.w < previous.w || distance(current.xyz, previous.xyz) > 1.0;
    vec3 position = (end == 1 && !respawned) ? previous.xyz : current.xyz;
    float life, alpha, flicker;
    vec3 colour = ParticleShade(particle, current, velocity, life, alpha, flicker);
    float speed = length(velocity.xyz);
    if (end == 1) alpha *= 0.3 * smoothstep(0.2, 2.5, speed);
    // Size: log-spread randomness gives the Particular "dust + bokeh" mix; world mode shrinks with distance.
    float sizeSeed = fract(velocity.w * 41.7);
    float sizeRandom = exp2((sizeSeed - 0.5) * 3.0 * uSizeRandom);
    float size = mix(uSizeStart, uSizeEnd, life) * sizeRandom;
    float depth = dot(position - uCameraPosition, uCameraForward);
    float pixels = uSizeMode == 0 ? size * uFocalPixels / max(depth, 0.05) : size * uPixelRatio;
    // Depth of field: out-of-focus sprites grow and fade (energy conserving-ish).
    float coc = uFocusDistance > 0.0 ? clamp(abs(depth - uFocusDistance) / max(uFocusDistance, 0.1) * uAperture * 3.0, 0.0, 1.0) : 0.0;
    float blurGrow = 1.0 + coc * 6.0;
    pixels *= blurGrow * uHaloScale;
    alpha *= uHaloAlpha / (blurGrow * blurGrow * 0.6 + 0.4);
    if (depth <= 0.05) alpha = 0.0;
    vColour = vec4(colour, alpha);
    vSoft = uTrail == 1 ? 0.0 : 1.0;
    gl_Position = uViewProjection * vec4(position, 1.0);
    gl_PointSize = clamp(pixels, 1.0, 256.0);
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                                  TRAILS (X-Particles-style spline ribbons)
//------------------------------------------------------------------------------------------------------------------------

/** History ring buffer: texture (side × side·L). Texel (x, y) = particle (x, y / L), slot y % L. */
export const TrailUpdateFragment = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uTrails;
uniform sampler2D uPositions;
uniform sampler2D uPrevious;
uniform int   uTrailLength;
uniform int   uHead;
uniform int   uAdvance;
uniform int   uReset;
uniform float uLifetime;
out vec4 fragColour;
void main()
{
    ivec2 texel = ivec2(floor(gl_FragCoord.xy));
    ivec2 pixel = ivec2(texel.x, texel.y / uTrailLength);
    int slot = texel.y - pixel.y * uTrailLength;
    vec4 current = texelFetch(uPositions, pixel, 0);
    vec4 previous = texelFetch(uPrevious, pixel, 0);
    vec4 old = texelFetch(uTrails, texel, 0);
    bool respawned = uReset == 1 || current.w < previous.w || old.w < 0.5 || distance(current.xyz, previous.xyz) > 2.0;
    if (respawned) { fragColour = vec4(current.xyz, 1.0); return; }
    bool frozen = current.w >= uLifetime && uLifetime > 0.0;
    fragColour = (uAdvance == 1 && slot == uHead && !frozen) ? vec4(current.xyz, 1.0) : old;
}
`;

/** Screen-space extruded Catmull-Rom ribbons. 6 vertices per sub-segment; spans = TrailLength, each split into uSubdivisions. */
export const TrailVertex = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${NoiseChunk}
${RampChunk}
${ParticleShapeChunk}
${ParticleShadeChunk}
uniform sampler2D uPositions;
uniform sampler2D uVelocities;
uniform sampler2D uTrails;
uniform mat4  uViewProjection;
uniform ivec2 uParticleSize;
uniform int   uTrailLength;
uniform int   uHead;
uniform int   uSubdivisions;
uniform int   uStride;         // render every Nth particle
uniform vec2  uViewport;       // pixels
uniform float uWidth;          // pixels (or metres in world mode)
uniform int   uSizeMode;
uniform float uFocalPixels;
uniform vec3  uCameraPosition;
uniform vec3  uCameraForward;
uniform float uTaper;
uniform float uTrailFade;
uniform int   uTrailColour;    // 0 particle colour, 1 palette along trail
uniform float uHaloScale;
uniform float uHaloAlpha;
out vec4 vColour;
out float vSoft;
out float vAcross;

vec3 TrailPoint(ivec2 pixel, int k)
{
    if (k <= 0) return texelFetch(uPositions, pixel, 0).xyz;
    int slot = ((uHead - (k - 1)) % uTrailLength + uTrailLength) % uTrailLength;
    return texelFetch(uTrails, ivec2(pixel.x, pixel.y * uTrailLength + slot), 0).xyz;
}
vec3 CatmullRom(vec3 p0, vec3 p1, vec3 p2, vec3 p3, float u)
{
    float u2 = u * u, u3 = u2 * u;
    return 0.5 * ((2.0 * p1) + (-p0 + p2) * u + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * u2 + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * u3);
}
void main()
{
    int segments = uTrailLength * uSubdivisions;
    int perParticle = segments * 6;
    int slotIndex = gl_VertexID / perParticle;
    int particle = slotIndex * uStride;
    int rest = gl_VertexID - slotIndex * perParticle;
    int segment = rest / 6;
    int corner = rest - segment * 6;
    ivec2 pixel = ivec2(particle - (particle / uParticleSize.x) * uParticleSize.x, particle / uParticleSize.x);
    vec4 current = texelFetch(uPositions, pixel, 0);
    vec4 velocity = texelFetch(uVelocities, pixel, 0);
    float life, alpha, flicker;
    vec3 colour = ParticleShade(particle, current, velocity, life, alpha, flicker);
    // Ribbons ignore the head's life fade: they persist and dissolve over the linger window.
    alpha = gLinger * flicker * smoothstep(0.0, 0.03, life);

    int span = segment / uSubdivisions;
    int sub = segment - span * uSubdivisions;
    float uA = float(sub) / float(uSubdivisions);
    float uB = float(sub + 1) / float(uSubdivisions);
    int kPrev = max(span - 1, 0), kNext = min(span + 2, uTrailLength);
    vec3 p0 = TrailPoint(pixel, kPrev), p1 = TrailPoint(pixel, span), p2 = TrailPoint(pixel, span + 1), p3 = TrailPoint(pixel, kNext);
    vec3 a = CatmullRom(p0, p1, p2, p3, uA);
    vec3 b = CatmullRom(p0, p1, p2, p3, uB);
    bool endVertex = corner == 2 || corner == 4 || corner == 5;
    float side = (corner == 0 || corner == 3 || corner == 5) ? -1.0 : 1.0;
    float along = (float(span) + (endVertex ? uB : uA)) / float(uTrailLength);  // 0 head → 1 tail
    vec3 world = endVertex ? b : a;

    vec4 clipA = uViewProjection * vec4(a, 1.0);
    vec4 clipB = uViewProjection * vec4(b, 1.0);
    vec4 clip = endVertex ? clipB : clipA;
    vec2 ndcA = clipA.xy / max(clipA.w, 1e-4), ndcB = clipB.xy / max(clipB.w, 1e-4);
    vec2 screenDirection = (ndcB - ndcA) * uViewport;
    float directionLength = length(screenDirection);
    vec2 normal = directionLength > 1e-4 ? vec2(-screenDirection.y, screenDirection.x) / directionLength : vec2(0.0, 1.0);
    float depth = dot(world - uCameraPosition, uCameraForward);
    float widthPixels = uSizeMode == 0 ? uWidth * uFocalPixels / max(depth, 0.05) : uWidth;
    widthPixels = max(widthPixels * mix(1.0, 1.0 - along, uTaper) * uHaloScale, 0.75);
    clip.xy += normal * side * widthPixels * 0.5 / uViewport * 2.0 * clip.w;

    if (uTrailColour == 1) colour = PaletteGradient(along) * uBrightness * (0.85 + 0.3 * flicker);
    alpha *= pow(1.0 - along, max(uTrailFade, 0.05)) * uHaloAlpha;
    if (depth <= 0.05 || distance(p1, p2) > 2.0) alpha = 0.0;
    vColour = vec4(colour, alpha);
    vSoft = -1.0;
    vAcross = side;
    gl_Position = clip;
}
`;

export const ParticleFragment = `#version 300 es
precision highp float;
in vec4 vColour;
in float vSoft;
in float vAcross;
uniform int uSprite;   // 0 glow, 1 disc, 2 bokeh ring, 3 star, 4 square
out vec4 fragColour;
void main()
{
    if (vColour.a <= 0.0) discard;
    float alpha = vColour.a;
    if (vSoft > 0.5)
    {
        vec2 q = gl_PointCoord - 0.5;
        float d = length(q) * 2.0;
        if (uSprite == 0) { if (d > 1.0) discard; alpha *= exp(-d * d * 4.5) * (1.0 - smoothstep(0.8, 1.0, d)); }
        else if (uSprite == 1) { if (d > 1.0) discard; alpha *= 1.0 - smoothstep(0.6, 1.0, d); }
        else if (uSprite == 2) { if (d > 1.0) discard; alpha *= 0.22 + 0.78 * smoothstep(0.5, 0.78, d) * (1.0 - smoothstep(0.86, 1.0, d)); }
        else if (uSprite == 3) { float arms = max(exp(-abs(q.x) * 14.0), exp(-abs(q.y) * 14.0)); alpha *= max(arms * (1.0 - d * 0.9), exp(-d * d * 10.0)); if (alpha < 0.01) discard; }
        // 4: square — full footprint.
    }
    else if (vSoft < -0.5) alpha *= 1.0 - vAcross * vAcross;
    fragColour = vec4(vColour.rgb, alpha);
}
`;
