//------------------------------------------------------------------------------------------------------------------------
//                                                  PARTICLE CATALOG
//                     Mograph-style Particle / VFX System Data Model: Shapes, Modes, Colour Rules, Templates
//
//  This file is the portable specification of the particle module. It contains no WebGL — only enumerations, numeric
//  codes (which the GLSL and a future C++ port share) and factory helpers. ParticleShaders.js implements the behaviour
//  on the GPU and ParticleSimulation.js owns the per-system state. Adding a shape, colour rule or template means adding
//  one entry here plus its branch in the shader; nothing else in the studio needs to change.
//------------------------------------------------------------------------------------------------------------------------

import { allocateNodeId } from './ForceGeneratorCatalog.js';

export const MaximumParticleSystems = 4;
export const MaximumParticlesPerSystem = 16384;

/** Spawn / cloner shapes. Code = index. Direction acts as the shape axis for Disc, Ring, Line and Grid. */
export const ParticleShapes = Object.freeze(['Point', 'Sphere', 'Box', 'Disc', 'Ring', 'Line', 'Grid']);

/** Emit = particles are born, age and die. Cloner = a fixed formation displaced by forces and pulled home by a spring. */
export const ParticleModes = Object.freeze(['Emit', 'Cloner']);

/** Colour rules. Code = index. */
export const ParticleColourModes = Object.freeze(['Life', 'Speed', 'Displacement', 'Height', 'Seed', 'Swatch', 'Cycle']);
export const ParticleColourLabels = Object.freeze({ Life: 'Gradient over life', Speed: 'Speed', Displacement: 'Distance from home', Height: 'Height', Seed: 'Random hue', Swatch: 'Random palette swatch', Cycle: 'Palette cycling in time' });
/** Where Speed / Displacement / Height take their gradient from. */
export const ParticleRampSources = Object.freeze(['Palette', 'Ramp']);
export const MaximumPaletteStops = 8;
export const PalettePresets = Object.freeze({
    Fire: ['#fff3c4', '#ffb454', '#ff5a1f', '#b3120a'],
    Ice: ['#ffffff', '#bfe9ff', '#38bdf8', '#1d4ed8'],
    Candy: ['#ff5f7e', '#ffb454', '#fef08a', '#34c759', '#38bdf8', '#a78bfa'],
    Neon: ['#f472b6', '#a78bfa', '#38bdf8', '#34c759'],
    Mono: ['#ffffff', '#71717a'],
    Earth: ['#d6c7ad', '#b89c74', '#8a7a5c', '#4b4038'],
});

export const ParticleBlendModes = Object.freeze(['Alpha', 'Additive']);
export const ParticleRenderStyles = Object.freeze(['Point', 'Streak']);
/** Sprite footprint. Code = index. */
export const ParticleSprites = Object.freeze(['Glow', 'Disc', 'Bokeh', 'Star', 'Square']);
export const ParticleSizeModes = Object.freeze(['World', 'Pixels']);
/** Trail rendering. Off = sprites only. Ribbon = spline ribbons behind each particle. Only = ribbons without head sprites. */
export const ParticleTrailModes = Object.freeze(['Off', 'Ribbon', 'Only']);
export const ParticleTrailColours = Object.freeze(['Particle', 'Along']);
export const MaximumTrailLength = 96;
export const MaximumTrailTexels = 8192;
/** History samples actually allocated: capped so the trail texture height stays within GPU limits. */
export function effectiveTrailLength(count, requested)
{
    return Math.max(2, Math.min(requested, Math.floor(MaximumTrailTexels / particleTextureSide(count))));
}

export const ParticleCategories = Object.freeze(['Cinematic', 'Trails', 'Emitters', 'Cloners', 'Environment']);

/** Asset-browser templates. Each is a full set of overrides for createParticleSystem. */
export const ParticleTemplates = Object.freeze([
    {
        Id: 'field-streamlines', Name: 'Field Streamlines', Category: 'Trails', Icon: 'streamlines', Tint: '#34c759',
        Summary: 'Diagnostic tool: massless tracers that follow the force field exactly, coloured by speed — see what your gizmos are doing.',
        Defaults: { Mode: 'Emit', Shape: 'Box', Radius: 2.4, Count: 2048, Rate: 1.5, Lifetime: 12, Linger: 2, Speed: 0.05, Spread: 1.0, Gravity: 0, Drag: 4.0, Noise: 0, FieldInfluence: 3.0, GasInfluence: 0, Bounce: -0.05, SizeStart: 0.01, SizeEnd: 0.01, SizeRandom: 0.2, SizeMode: 'World', Sprite: 'Disc', Glow: 0.3, ColourMode: 'Speed', RampSource: 'Ramp', Ramp: 'Turbo', MaxSpeed: 4, Palette: ['#34c759', '#ffb454'], Blend: 'Alpha', Style: 'Point', Brightness: 1.1, Trail: 'Only', TrailLength: 64, TrailInterval: 0.08, TrailWidth: 0.008, TrailTaper: 0.4, TrailFade: 0.5, TrailSubdivisions: 2, TrailColour: 'Particle', TrailRatio: 1 },
    },
    {
        Id: 'meteor-shower', Name: 'Meteor Shower', Category: 'Trails', Icon: 'meteor', Tint: '#fdba74',
        Summary: 'Fast diagonal streaks from the top of the domain with white-hot heads and orange tails that linger after impact.',
        Defaults: { Mode: 'Emit', Shape: 'Box', Radius: 2.5, Direction: [-0.6, -1, 0.2], Count: 256, Rate: 1.2, Lifetime: 1.6, Linger: 1.8, Speed: 9, Spread: 0.03, Gravity: 2, Drag: 0, Noise: 0, Bounce: -0.05, SizeStart: 0.03, SizeEnd: 0.02, SizeRandom: 0.4, SizeMode: 'World', Sprite: 'Glow', Glow: 1.0, ColourMode: 'Life', Palette: ['#ffffff', '#fde68a', '#fb923c'], Flicker: 0.2, Blend: 'Additive', Style: 'Point', Brightness: 1.8, Trail: 'Ribbon', TrailLength: 32, TrailInterval: 0.025, TrailWidth: 0.02, TrailTaper: 0.95, TrailFade: 0.8, TrailSubdivisions: 1, TrailColour: 'Along', TrailRatio: 1 },
    },
    {
        Id: 'light-strands', Name: 'Light Strands', Category: 'Trails', Icon: 'strands', Tint: '#7dd3fc',
        Summary: 'Aerodynamic streamlines: long thin blue ribbons riding the wind with sparkling heads.',
        Defaults: { Mode: 'Emit', Shape: 'Disc', Radius: 1.4, Direction: [1, 0, 0], Count: 1024, Rate: 0.6, Lifetime: 24, Speed: 1.1, Spread: 0.06, Gravity: 0, Drag: 0.1, Noise: 0.25, NoiseScale: 0.45, NoiseSpeed: 0.06, FieldInfluence: 1, GasInfluence: 0, Bounce: -0.05, SizeStart: 0.03, SizeEnd: 0.02, SizeRandom: 0.5, SizeMode: 'World', Sprite: 'Glow', Glow: 0.8, FocusDistance: 0, ColourMode: 'Life', Palette: ['#ffffff', '#bfe9ff', '#60a5fa', '#312e81'], BrightnessJitter: 0.3, Flicker: 0.4, Blend: 'Additive', Style: 'Point', Brightness: 1.3, Trail: 'Ribbon', TrailLength: 96, TrailInterval: 0.1, TrailWidth: 0.012, TrailTaper: 0.7, TrailFade: 0.6, TrailSubdivisions: 2, TrailColour: 'Along', TrailRatio: 1, Linger: 4 },
    },
    {
        Id: 'silk-ribbons', Name: 'Silk Ribbons', Category: 'Trails', Icon: 'silk', Tint: '#f472b6',
        Summary: 'A twisting bundle of magenta strands with loose sparks — the woven X-Particles trail look.',
        Defaults: { Mode: 'Emit', Shape: 'Disc', Radius: 0.5, Direction: [1, 0.1, 0], Count: 1536, Rate: 0.7, Lifetime: 26, Speed: 0.8, Spread: 0.1, Gravity: 0, Drag: 0.08, Noise: 0.55, NoiseScale: 0.4, NoiseSpeed: 0.05, FieldInfluence: 1, Bounce: -0.05, SizeStart: 0.02, SizeEnd: 0.012, SizeRandom: 0.8, SizeMode: 'World', Sprite: 'Glow', Glow: 0.7, FocusDistance: 6, Aperture: 0.5, ColourMode: 'Swatch', Palette: ['#ff7ab6', '#f472b6', '#c084fc', '#fb7185', '#fff1f2'], HueJitter: 0.05, BrightnessJitter: 0.4, Flicker: 0.2, Blend: 'Additive', Style: 'Point', Brightness: 1.2, Trail: 'Ribbon', TrailLength: 96, TrailInterval: 0.12, TrailWidth: 0.016, TrailTaper: 0.5, TrailFade: 0.5, TrailSubdivisions: 3, TrailColour: 'Particle', TrailRatio: 1, Linger: 4 },
    },
    {
        Id: 'neon-filaments', Name: 'Neon Filaments', Category: 'Trails', Icon: 'filaments', Tint: '#a78bfa',
        Summary: 'Pink-to-blue fibre-optic filaments spiralling out of a ring; heads glow, tails fade.',
        Defaults: { Mode: 'Emit', Shape: 'Ring', Radius: 0.8, Direction: [0, 1, 0], Count: 2048, Rate: 0.8, Lifetime: 22, Speed: 0.6, Spread: 0.35, Gravity: 0, Drag: 0.15, Noise: 0.4, NoiseScale: 0.55, NoiseSpeed: 0.08, FieldInfluence: 1, Bounce: -0.05, SizeStart: 0.025, SizeEnd: 0.015, SizeRandom: 0.6, SizeMode: 'World', Sprite: 'Glow', Glow: 0.9, FocusDistance: 0, ColourMode: 'Height', RampSource: 'Palette', Palette: ['#38bdf8', '#818cf8', '#c084fc', '#f472b6'], BrightnessJitter: 0.3, Flicker: 0.3, Blend: 'Additive', Style: 'Point', Brightness: 1.3, Trail: 'Ribbon', TrailLength: 96, TrailInterval: 0.1, TrailWidth: 0.01, TrailTaper: 0.6, TrailFade: 0.55, TrailSubdivisions: 2, TrailColour: 'Particle', TrailRatio: 1, Linger: 4 },
    },
    {
        Id: 'stardust', Name: 'Stardust Ribbon', Category: 'Cinematic', Icon: 'stardust', Tint: '#c8b8ff',
        Summary: 'Sixteen thousand micro-motes swept into ribbons by a large-scale turbulence field, gold and ice-blue with soft bokeh.',
        Defaults: { Mode: 'Emit', Shape: 'Box', Radius: 2.2, Count: 16384, Rate: 3, Lifetime: 14, Speed: 0.15, Spread: 1.0, Gravity: 0, Drag: 0.9, Noise: 1.4, NoiseScale: 0.35, NoiseSpeed: 0.12, FieldInfluence: 1, GasInfluence: 0, Bounce: -0.05, SizeStart: 0.012, SizeEnd: 0.008, SizeRandom: 0.9, SizeMode: 'World', Sprite: 'Glow', Glow: 0.5, FocusDistance: 6, Aperture: 0.4, ColourMode: 'Swatch', Palette: ['#fff1c9', '#ffd27a', '#bfe9ff', '#8ea8ff', '#ffffff'], BrightnessJitter: 0.6, Flicker: 0.5, Blend: 'Additive', Style: 'Point', Brightness: 1.4 },
    },
    {
        Id: 'nebula', Name: 'Nebula Burst', Category: 'Cinematic', Icon: 'nebula', Tint: '#7dd3fc',
        Summary: 'A slow-blooming cloud: warm core, cold blue filaments, curl-noise tendrils and sparse large bokeh.',
        Defaults: { Mode: 'Emit', Shape: 'Sphere', Radius: 0.5, Count: 16384, Rate: 2.5, Lifetime: 12, Speed: 0.9, Spread: 1.0, Gravity: 0, Drag: 0.7, Noise: 1.8, NoiseScale: 0.6, NoiseSpeed: 0.2, Bounce: -0.05, SizeStart: 0.008, SizeEnd: 0.005, SizeRandom: 0.8, SizeMode: 'World', Sprite: 'Glow', Glow: 0.5, FocusDistance: 6, Aperture: 0.35, ColourMode: 'Height', RampSource: 'Palette', Palette: ['#7dd3fc', '#bfe9ff', '#ffd9a8', '#ff9f5a'], HueJitter: 0.05, BrightnessJitter: 0.5, Flicker: 0.25, Blend: 'Additive', Style: 'Point', Brightness: 1.2 },
    },
    {
        Id: 'dissolving-sphere', Name: 'Dissolving Sphere', Category: 'Cinematic', Icon: 'swarm', Tint: '#fbcfe8',
        Summary: 'A solid particle sphere whose surface peels into flowing noise — the Trapcode Form look, soft peach on alpha blend.',
        Defaults: { Mode: 'Cloner', Shape: 'Sphere', Radius: 1.3, Fill: 0.7, Count: 16384, Spring: 4, Damping: 2.0, Dissolve: 0.5, NoiseScale: 0.8, NoiseSpeed: 0.15, FieldInfluence: 1, Gravity: 0, Drag: 0, Noise: 0, SizeStart: 0.014, SizeEnd: 0.014, SizeRandom: 0.6, SizeMode: 'World', Sprite: 'Disc', Glow: 0.15, FocusDistance: 6, Aperture: 0.35, ColourMode: 'Displacement', RampSource: 'Palette', Palette: ['#fde7d9', '#f9c6b0', '#f5a98a', '#ffffff'], DisplacementRange: 0.9, BrightnessJitter: 0.25, Blend: 'Alpha', Style: 'Point' },
    },
    {
        Id: 'bioluminescent', Name: 'Bioluminescent Bloom', Category: 'Cinematic', Icon: 'bloom', Tint: '#6ee7b7',
        Summary: 'Green spores lifting off a disc with bokeh rings, sparkle and lazy turbulence.',
        Defaults: { Mode: 'Emit', Shape: 'Disc', Radius: 1.8, Count: 12288, Rate: 4, Lifetime: 9, Speed: 0.45, Spread: 0.5, Direction: [0, 1, 0], Gravity: 0, Drag: 1.1, Noise: 1.0, NoiseScale: 0.7, NoiseSpeed: 0.25, Bounce: -0.05, SizeStart: 0.006, SizeEnd: 0.014, SizeRandom: 0.85, SizeMode: 'World', Sprite: 'Bokeh', Glow: 0.4, FocusDistance: 5.5, Aperture: 0.45, ColourMode: 'Life', Palette: ['#d9fff0', '#6ee7b7', '#10b981', '#064e3b'], HueJitter: 0.06, BrightnessJitter: 0.5, Flicker: 0.7, Blend: 'Additive', Style: 'Point', Brightness: 1.3 },
    },
    {
        Id: 'fireworks', Name: 'Fireworks', Category: 'Emitters', Icon: 'fireworks', Tint: '#fb7185',
        Summary: 'Keyed shell burst every 2.5 s: a radial sphere of streaking embers that arc down and fade — timing keys + radial launch.',
        Defaults: { Mode: 'Emit', Shape: 'Point', Radius: 0.05, Count: 4096, Rate: 400, Lifetime: 2.8, Linger: 1.5, Speed: 7, Spread: 0.15, Radial: 1, Gravity: 3.5, Drag: 1.1, Noise: 0.15, Bounce: -0.05, SizeStart: 0.012, SizeEnd: 0.004, SizeRandom: 0.6, SizeMode: 'World', Sprite: 'Glow', Glow: 0.8, ColourMode: 'Swatch', Palette: ['#fff1c9', '#fb7185', '#f59e0b', '#38bdf8', '#a78bfa'], BrightnessJitter: 0.4, Flicker: 0.6, Blend: 'Additive', Style: 'Point', Brightness: 1.5, Trail: 'Ribbon', TrailLength: 24, TrailInterval: 0.03, TrailWidth: 0.006, TrailTaper: 0.9, TrailFade: 1.2, TrailSubdivisions: 1, TrailColour: 'Particle', TrailRatio: 1, StartTime: 0.5, Duration: 0.08, Fade: 0.02, Repeat: 2.5 },
    },
    {
        Id: 'pulse-ring', Name: 'Pulse Ring', Category: 'Emitters', Icon: 'pulsering', Tint: '#38bdf8',
        Summary: 'Expanding shock ring: a planar ring launched radially outward every 1.5 s, thinning as it grows.',
        Defaults: { Mode: 'Emit', Shape: 'Ring', Radius: 0.3, Direction: [0, 1, 0], Count: 4096, Rate: 400, Lifetime: 2.2, Linger: 0.6, Speed: 3.5, Spread: 0.02, Radial: 1, Gravity: 0, Drag: 0.9, Noise: 0.05, Bounce: -0.05, SizeStart: 0.012, SizeEnd: 0.003, SizeRandom: 0.4, SizeMode: 'World', Sprite: 'Glow', Glow: 0.9, ColourMode: 'Life', Palette: ['#ffffff', '#7dd3fc', '#38bdf8', '#1e3a8a'], Flicker: 0.1, Blend: 'Additive', Style: 'Point', Brightness: 1.6, StartTime: 0.3, Duration: 0.06, Fade: 0.02, Repeat: 1.5 },
    },
    {
        Id: 'electric-sparks', Name: 'Electric Sparks', Category: 'Emitters', Icon: 'electric', Tint: '#e0f2fe',
        Summary: 'Short-lived violent arcs: star sprites, hard flicker, jittery turbulence, white-blue.',
        Defaults: { Mode: 'Emit', Shape: 'Sphere', Radius: 0.12, Count: 2048, Rate: 30, Lifetime: 0.35, Linger: 0.1, Speed: 6, Spread: 1.0, Gravity: 2, Drag: 2.5, Noise: 4, NoiseScale: 3.5, NoiseSpeed: 2, Bounce: 0.4, SizeStart: 0.02, SizeEnd: 0.004, SizeRandom: 0.7, SizeMode: 'World', Sprite: 'Star', Glow: 1.2, ColourMode: 'Life', Palette: ['#ffffff', '#e0f2fe', '#60a5fa'], Flicker: 1.0, Blend: 'Additive', Style: 'Streak', Brightness: 2.0 },
    },
    {
        Id: 'sparks', Name: 'Sparks', Category: 'Emitters', Icon: 'sparks', Tint: '#ffb454',
        Summary: 'Hot ballistic sparks that streak, cool and fall.',
        Defaults: { Mode: 'Emit', Shape: 'Point', Radius: 0.1, Count: 4096, Rate: 18, Lifetime: 1.4, Speed: 4.5, Spread: 0.55, Direction: [0, 1, 0], Gravity: 6, Drag: 0.6, Noise: 0.4, Bounce: 0.2, SizeStart: 3.5, SizeEnd: 1.0, ColourMode: 'Life', Palette: ['#fff3c4', '#ffb454', '#ff5a1f', '#b3120a'], BrightnessJitter: 0.3, Blend: 'Additive', Style: 'Streak' },
    },
    {
        Id: 'confetti', Name: 'Confetti Cannon', Category: 'Emitters', Icon: 'confetti', Tint: '#f472b6',
        Summary: 'Rainbow confetti blasted from a nozzle, fluttering down and settling.',
        Defaults: { Mode: 'Emit', Shape: 'Disc', Radius: 0.25, Count: 4096, Rate: 10, Lifetime: 5, Speed: 9, Spread: 0.3, Direction: [0.3, 1, 0], Gravity: 5, Drag: 1.6, Noise: 1.8, Bounce: 0.25, SizeStart: 4.5, SizeEnd: 4.0, ColourMode: 'Swatch', Palette: ['#ff5f7e', '#ffb454', '#fef08a', '#34c759', '#38bdf8', '#a78bfa'], HueJitter: 0.08, Blend: 'Alpha', Style: 'Point' },
    },
    {
        Id: 'fireflies', Name: 'Fireflies', Category: 'Emitters', Icon: 'fireflies', Tint: '#d9ff7a',
        Summary: 'Slow pulsing motes wandering on curl noise.',
        Defaults: { Mode: 'Emit', Shape: 'Sphere', Radius: 1.4, Count: 1024, Rate: 1.5, Lifetime: 7, Speed: 0.25, Spread: 1.0, Gravity: 0, Drag: 1.2, Noise: 1.3, Bounce: 0, SizeStart: 3.5, SizeEnd: 2.5, ColourMode: 'Life', Palette: ['#f7ffb0', '#d9ff7a', '#5c8a00'], HueJitter: 0.06, Blend: 'Additive', Style: 'Point', Flicker: 1.0 },
    },
    {
        Id: 'fountain', Name: 'Fountain', Category: 'Emitters', Icon: 'fountain', Tint: '#38bdf8',
        Summary: 'Water-like jet that arcs under gravity and splashes on the floor.',
        Defaults: { Mode: 'Emit', Shape: 'Disc', Radius: 0.12, Count: 8192, Rate: 25, Lifetime: 3, Speed: 6.5, Spread: 0.12, Direction: [0, 1, 0], Gravity: 9.8, Drag: 0.2, Noise: 0.2, Bounce: 0.15, SizeStart: 2.5, SizeEnd: 2.0, ColourMode: 'Speed', RampSource: 'Palette', Palette: ['#1d6fa8', '#38bdf8', '#bfe9ff', '#ffffff'], Blend: 'Alpha', Style: 'Streak' },
    },
    {
        Id: 'galaxy-disc', Name: 'Galaxy Disc', Category: 'Cloners', Icon: 'galaxy', Tint: '#c4b5fd',
        Summary: 'Sixteen thousand points on a sunflower disc with a gentle dissolve — add a Rigid Spin or Vortex gizmo and it becomes a spiral galaxy.',
        Defaults: { Mode: 'Cloner', Shape: 'Disc', Radius: 2.2, Direction: [0, 1, 0], Count: 16384, Spring: 1.2, Damping: 0.8, Dissolve: 0.12, NoiseScale: 0.6, NoiseSpeed: 0.05, FieldInfluence: 1, Gravity: 0, Drag: 0, Noise: 0, SizeStart: 0.008, SizeEnd: 0.008, SizeRandom: 0.9, SizeMode: 'World', Sprite: 'Glow', Glow: 0.5, FocusDistance: 7, Aperture: 0.3, ColourMode: 'Displacement', RampSource: 'Palette', Palette: ['#fff7ed', '#c4b5fd', '#60a5fa', '#312e81'], DisplacementRange: 1.2, BrightnessJitter: 0.6, Flicker: 0.3, Blend: 'Additive', Style: 'Point', Brightness: 1.2 },
    },
    {
        Id: 'grid-cloner', Name: 'Grid Cloner', Category: 'Cloners', Icon: 'gridcloner', Tint: '#a78bfa',
        Summary: 'Lattice of points held by springs — forces push it, colour shows the displacement.',
        Defaults: { Mode: 'Cloner', Shape: 'Grid', Radius: 1.6, Count: 4096, Spring: 7, Damping: 3.5, FieldInfluence: 1.0, GasInfluence: 0.0, Gravity: 0, Drag: 0, Noise: 0, SizeStart: 4.0, SizeEnd: 4.0, ColourMode: 'Displacement', RampSource: 'Palette', Palette: ['#8b7cf6', '#38bdf8', '#34c759', '#ffb454', '#f472b6'], DisplacementRange: 0.8, Blend: 'Alpha', Style: 'Point' },
    },
    {
        Id: 'ring-cloner', Name: 'Ring Cloner', Category: 'Cloners', Icon: 'ringcloner', Tint: '#34c759',
        Summary: 'Circle of clones that ripples around the ring under any field.',
        Defaults: { Mode: 'Cloner', Shape: 'Ring', Radius: 1.5, Count: 512, Spring: 9, Damping: 4, FieldInfluence: 1.0, GasInfluence: 0.0, Gravity: 0, Drag: 0, Noise: 0, SizeStart: 6.0, SizeEnd: 6.0, ColourMode: 'Displacement', RampSource: 'Palette', Palette: ['#34c759', '#fef08a', '#ffb454', '#ff5f7e'], DisplacementRange: 0.6, Blend: 'Alpha', Style: 'Point' },
    },
    {
        Id: 'sphere-swarm', Name: 'Sphere Swarm', Category: 'Cloners', Icon: 'swarm', Tint: '#f59e0b',
        Summary: 'Fibonacci sphere shell with a loose spring and gentle noise — a breathing swarm.',
        Defaults: { Mode: 'Cloner', Shape: 'Sphere', Radius: 1.3, Count: 2048, Spring: 3, Damping: 1.5, FieldInfluence: 1.0, GasInfluence: 0.0, Gravity: 0, Drag: 0, Noise: 0.6, SizeStart: 3.5, SizeEnd: 3.5, ColourMode: 'Displacement', RampSource: 'Palette', Palette: ['#ffb454', '#f97316', '#ef4444', '#f472b6'], DisplacementRange: 0.7, BrightnessJitter: 0.2, Blend: 'Additive', Style: 'Point' },
    },
    {
        Id: 'line-cloner', Name: 'Line Cloner', Category: 'Cloners', Icon: 'linecloner', Tint: '#38bdf8',
        Summary: 'Row of clones along the axis — a wave-table that reacts to every gizmo you drag through it.',
        Defaults: { Mode: 'Cloner', Shape: 'Line', Radius: 2.2, Count: 256, Spring: 10, Damping: 3, FieldInfluence: 1.0, GasInfluence: 0.0, Gravity: 0, Drag: 0, Noise: 0, SizeStart: 7.0, SizeEnd: 7.0, ColourMode: 'Displacement', RampSource: 'Palette', Palette: ['#38bdf8', '#a78bfa', '#f472b6'], DisplacementRange: 0.5, Blend: 'Alpha', Style: 'Point' },
    },
    {
        Id: 'bubbles', Name: 'Bubbles', Category: 'Environment', Icon: 'bubbles', Tint: '#a5f3fc',
        Summary: 'Buoyant bokeh rings wobbling upward (negative gravity) and popping at the top.',
        Defaults: { Mode: 'Emit', Shape: 'Disc', Radius: 1.2, Direction: [0, 1, 0], Count: 1024, Rate: 1.5, Lifetime: 7, Linger: 0.2, Speed: 0.3, Spread: 0.3, Gravity: -1.2, Drag: 1.6, Noise: 0.6, NoiseScale: 1.5, NoiseSpeed: 0.6, GasInfluence: 0.8, Bounce: -0.05, SizeStart: 0.015, SizeEnd: 0.05, SizeRandom: 0.8, SizeMode: 'World', Sprite: 'Bokeh', Glow: 0.2, ColourMode: 'Life', Palette: ['#ecfeff', '#a5f3fc', '#67e8f9'], Flicker: 0, Blend: 'Alpha', Style: 'Point', Brightness: 1.0 },
    },
    {
        Id: 'mist-spray', Name: 'Mist Spray', Category: 'Environment', Icon: 'mist', Tint: '#e2e8f0',
        Summary: 'Dense fine spray from a nozzle that drifts, slows and hangs in the air — droplets, not smoke.',
        Defaults: { Mode: 'Emit', Shape: 'Disc', Radius: 0.08, Direction: [1, 0.35, 0], Count: 16384, Rate: 12, Lifetime: 5, Linger: 0.5, Speed: 4, Spread: 0.18, Gravity: 1.5, Drag: 2.2, Noise: 0.5, NoiseScale: 1.2, NoiseSpeed: 0.4, GasInfluence: 1.0, Bounce: 0.05, SizeStart: 0.004, SizeEnd: 0.009, SizeRandom: 0.7, SizeMode: 'World', Sprite: 'Glow', Glow: 0.2, ColourMode: 'Life', Palette: ['#ffffff', '#e2e8f0', '#94a3b8'], BrightnessJitter: 0.3, Blend: 'Alpha', Style: 'Point', Brightness: 0.9 },
    },
    {
        Id: 'snowfall', Name: 'Snowfall', Category: 'Environment', Icon: 'snow', Tint: '#e2e8f0',
        Summary: 'Slow flakes drifting down through the gas flow.',
        Defaults: { Mode: 'Emit', Shape: 'Box', Radius: 2.4, Count: 4096, Rate: 4, Lifetime: 9, Speed: 0.4, Spread: 0.4, Direction: [0, -1, 0], Gravity: 0.5, Drag: 1.8, Noise: 0.7, GasInfluence: 1.5, Bounce: 0, SizeStart: 2.5, SizeEnd: 2.5, ColourMode: 'Life', Palette: ['#ffffff', '#cbd5e1'], BrightnessJitter: 0.25, Blend: 'Alpha', Style: 'Point' },
    },
    {
        Id: 'ground-dust', Name: 'Ground Dust', Category: 'Environment', Icon: 'dust', Tint: '#b89c74',
        Summary: 'Floor-hugging motes picked up by whatever the gas is doing.',
        Defaults: { Mode: 'Emit', Shape: 'Disc', Radius: 2.4, Count: 4096, Rate: 6, Lifetime: 6, Speed: 0.1, Spread: 1.0, Gravity: 0.3, Drag: 1.0, Noise: 0.3, GasInfluence: 3.0, Bounce: 0, SizeStart: 2.0, SizeEnd: 1.5, ColourMode: 'Speed', RampSource: 'Palette', Palette: ['#8a7a5c', '#b89c74', '#d6c7ad', '#fff3c4'], BrightnessJitter: 0.3, Blend: 'Alpha', Style: 'Point' },
    },
    {
        Id: 'rain', Name: 'Rain', Category: 'Environment', Icon: 'rain', Tint: '#60a5fa',
        Summary: 'Fast streaks falling straight through the domain.',
        Defaults: { Mode: 'Emit', Shape: 'Box', Radius: 2.4, Count: 8192, Rate: 12, Lifetime: 2, Speed: 7, Spread: 0.02, Direction: [0, -1, 0], Gravity: 4, Drag: 0.1, Noise: 0.05, GasInfluence: 0.4, Bounce: 0.1, SizeStart: 1.5, SizeEnd: 1.5, ColourMode: 'Life', Palette: ['#bfdbfe', '#60a5fa'], Blend: 'Alpha', Style: 'Streak' },
    },
]);

export const ParticleTemplateById = Object.freeze(Object.fromEntries(ParticleTemplates.map((template) => [template.Id, template])));

export function createParticleSystem(templateId, overrides = {})
{
    const template = ParticleTemplateById[templateId] || ParticleTemplates[0];
    const base = { ...template.Defaults, ...overrides };
    return {
        Id: allocateNodeId('particles'),
        Kind: 'Particles',
        Template: template.Id,
        Name: overrides.Name || template.Name,
        Enabled: true,
        Visible: true,
        Mode: base.Mode || 'Emit',
        Shape: base.Shape || 'Point',
        Position: [...(base.Position || [0, 0, 0])],
        Direction: [...(base.Direction || [0, 1, 0])],
        Radius: base.Radius ?? 0.5,
        Count: Math.min(MaximumParticlesPerSystem, Math.max(16, Math.round(base.Count ?? 2048))),
        Rate: base.Rate ?? 8,                      // respawn probability per second for dead particles
        Lifetime: base.Lifetime ?? 3,
        Fill: base.Fill ?? 0,                      // sphere / disc formations: 0 = shell, 1 = solid volume
        Dissolve: base.Dissolve ?? 0,              // cloner homes drift on curl noise (Form-style dissolve)
        NoiseScale: base.NoiseScale ?? 1.3,        // spatial frequency of the turbulence field
        NoiseSpeed: base.NoiseSpeed ?? 0.5,        // evolution speed of the turbulence field
        Speed: base.Speed ?? 2,
        Spread: base.Spread ?? 0.5,                // 0 = all along Direction, 1 = fully random
        Radial: base.Radial ?? 0,                  // blend launch direction toward 'outward from the shape origin'
        Gravity: base.Gravity ?? 0,
        Drag: base.Drag ?? 0.5,
        Noise: base.Noise ?? 0,                    // curl-noise wander strength
        FieldInfluence: base.FieldInfluence ?? 1,  // how much scene force generators accelerate the particles
        GasInfluence: base.GasInfluence ?? 0,      // coupling to the fluid velocity field
        Spring: base.Spring ?? 6,                  // cloner return stiffness
        Damping: base.Damping ?? 3,
        Bounce: base.Bounce ?? 0.2,
        SizeStart: base.SizeStart ?? 3,
        SizeEnd: base.SizeEnd ?? 1,
        SizeRandom: base.SizeRandom ?? 0.3,        // 0 = uniform, 1 = log-spread from micro dust to big bokeh
        SizeMode: base.SizeMode || 'Pixels',
        Sprite: base.Sprite || 'Disc',
        Glow: base.Glow ?? 0,                      // additive halo pass strength
        FocusDistance: base.FocusDistance ?? 0,    // 0 = depth of field off
        Aperture: base.Aperture ?? 0.5,
        ColourMode: base.ColourMode || 'Life',
        Palette: [...(base.Palette && base.Palette.length ? base.Palette : [base.ColourStart || '#ffffff', base.ColourEnd || '#808080'])].slice(0, MaximumPaletteStops),
        RampSource: base.RampSource || 'Palette',
        HueJitter: base.HueJitter ?? 0,
        BrightnessJitter: base.BrightnessJitter ?? 0,
        CycleSpeed: base.CycleSpeed ?? 0.5,
        Brightness: base.Brightness ?? 1,
        Ramp: base.Ramp || 'Turbo',
        DisplacementRange: base.DisplacementRange ?? 1,
        MaxSpeed: base.MaxSpeed ?? 6,
        Flicker: base.Flicker ?? 0,
        Blend: base.Blend || 'Alpha',
        Style: base.Style || 'Point',
        Trail: base.Trail || 'Off',
        TrailLength: Math.min(MaximumTrailLength, Math.max(2, Math.round(base.TrailLength ?? 24))),
        TrailInterval: base.TrailInterval ?? 0.08,   // seconds between history samples (longer = longer trails)
        TrailWidth: base.TrailWidth ?? 0.01,         // same units as SizeMode
        TrailTaper: base.TrailTaper ?? 0.6,
        TrailFade: base.TrailFade ?? 0.7,
        TrailSubdivisions: Math.min(4, Math.max(1, Math.round(base.TrailSubdivisions ?? 2))),
        TrailColour: base.TrailColour || 'Particle',
        TrailRatio: base.TrailRatio ?? 1,            // fraction of particles that draw a trail
        Linger: base.Linger ?? (base.Trail && base.Trail !== 'Off' ? 3 : 0.6),  // seconds a dead particle's trail keeps fading before respawn
        StartTime: base.StartTime ?? 0,
        Duration: base.Duration ?? 0,
        Fade: base.Fade ?? 0.15,
        Repeat: base.Repeat ?? 0,
    };
}

/** Square texture side that holds `count` particles. */
export function particleTextureSide(count)
{
    const side = Math.ceil(Math.sqrt(Math.max(16, Math.min(MaximumParticlesPerSystem, count))));
    return Math.min(128, Math.max(4, Math.ceil(side / 4) * 4));
}
