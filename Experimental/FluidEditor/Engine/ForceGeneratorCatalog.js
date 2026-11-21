//============================================================================================================================================
//                                                     FORCEGENERATORCATALOG.JS
//                  Force Generator Type Registry — GLSL Type Codes, Parameter Schemas, Falloff Envelopes,
//                                 Emitter Shapes, Colour Ramps, and Scene Presets
//============================================================================================================================================

export const MaximumForceGenerators = 16;
export const MaximumEmitters = 6;
export const MaximumColliders = 4;

export const FalloffCurves = ['SmoothStep', 'Linear', 'InverseSquare', 'Constant', 'Gaussian', 'Plateau', 'Cosine'];
export const FalloffLabels = { SmoothStep: 'Smooth', Linear: 'Linear', InverseSquare: 'Inverse²', Constant: 'Infinite', Gaussian: 'Gaussian', Plateau: 'Plateau', Cosine: 'Interpolated' };
export const ForceCategories = ['Directional', 'Attraction', 'Rotational', 'Turbulence', 'Burst', 'Damping', 'Thermal'];
export const EmitterShapes = ['Sphere', 'Disc', 'Box'];
export const ColourRamps = ['Turbo', 'Engineering', 'Plasma', 'Diverging'];
export const SliceAxes = ['X', 'Y', 'Z'];
export const ScalarChannels = ['Speed', 'Pressure', 'Vorticity', 'Temperature', 'Density', 'Divergence', 'ForceMagnitude'];
export const AdvectionSchemes = ['SemiLagrangian', 'MacCormack'];
export const BoundaryModes = ['ClosedBox', 'OpenTop', 'OpenAll'];
export const VolumeFilters = ['Smooth', 'Voxel'];
export const VectorModes = ['Slice', 'Volume'];

//------------------------------------------------------------------------------------------------------------------------
//                                                  FORCE GENERATOR TYPES
//------------------------------------------------------------------------------------------------------------------------

export const ForceGeneratorTypes = Object.freeze([
    // ---------------------------------------------------------------- Directional
    {
        Id: 'DirectionalWind', Code: 0, Category: 'Directional', Name: 'Directional Wind', Icon: 'wind', Tint: '#38bdf8',
        Summary: 'Uniform directional push across the whole domain or a bounded reach, with optional gusting.',
        Defaults: { Strength: 6, Radius: 2.0, Direction: [1, 0, 0], Falloff: 'Constant', Frequency: 0.6, Secondary: 0.35, Tertiary: 0 },
        Labels: { Frequency: 'Gust Rate', Secondary: 'Gust Depth' },
    },
    {
        Id: 'WindShear', Code: 17, Category: 'Directional', Name: 'Wind Shear', Icon: 'shear', Tint: '#60a5fa',
        Summary: 'Crosswind whose heading rotates with height along the axis — layered, twisting flow.',
        Defaults: { Strength: 5, Radius: 2.0, Direction: [0, 1, 0], Falloff: 'Constant', Frequency: 0, Secondary: 1.0, Tertiary: 0 },
        Labels: { Secondary: 'Twist (half-turns)' },
    },
    {
        Id: 'FlowStream', Code: 16, Category: 'Directional', Name: 'Flow Stream', Icon: 'stream', Tint: '#7dd3fc',
        Summary: 'Steers gas toward a target velocity along the axis — a soft conveyor rather than a push.',
        Defaults: { Strength: 3, Radius: 1.2, Direction: [1, 0, 0], Falloff: 'SmoothStep', Frequency: 2.5, Secondary: 0, Tertiary: 0 },
        Labels: { Frequency: 'Target Speed' },
    },
    {
        Id: 'DirectionalBurst', Code: 14, Category: 'Burst', Name: 'Directional Burst', Icon: 'dburst', Tint: '#fb923c',
        Summary: 'Periodic impulse along one axis — cannon shots, piston puffs, muzzle blasts.',
        Defaults: { Strength: 45, Radius: 0.9, Direction: [0, 1, 0], Falloff: 'SmoothStep', Frequency: 1.5, Secondary: 0.1, Tertiary: 0 },
        Labels: { Frequency: 'Pulse Period', Secondary: 'Pulse Width', Tertiary: 'Start Delay' },
    },
    // ---------------------------------------------------------------- Attraction
    {
        Id: 'PointAttractor', Code: 1, Category: 'Attraction', Name: 'Point Attractor', Icon: 'attractor', Tint: '#a78bfa',
        Summary: 'Pulls fluid toward a centre; negative strength repels.',
        Defaults: { Strength: 14, Radius: 1.4, Direction: [0, 1, 0], Falloff: 'SmoothStep', Frequency: 0, Secondary: 0.1, Tertiary: 0 },
        Labels: { Secondary: 'Core Softness' },
    },
    {
        Id: 'PointRepulsor', Code: 2, Category: 'Attraction', Name: 'Point Repulsor', Icon: 'repulsor', Tint: '#f472b6',
        Summary: 'Pushes fluid away from a centre in all directions.',
        Defaults: { Strength: 14, Radius: 1.2, Direction: [0, 1, 0], Falloff: 'SmoothStep', Frequency: 0, Secondary: 0.1, Tertiary: 0 },
        Labels: { Secondary: 'Core Softness' },
    },
    {
        Id: 'AxisAttractor', Code: 8, Category: 'Attraction', Name: 'Axis Attractor', Icon: 'axis', Tint: '#22d3ee',
        Summary: 'Pulls fluid toward an infinite line through its centre.',
        Defaults: { Strength: 10, Radius: 1.8, Direction: [0, 1, 0], Falloff: 'Linear', Frequency: 0, Secondary: 0, Tertiary: 0 },
        Labels: {},
    },
    {
        Id: 'Orbit', Code: 10, Category: 'Attraction', Name: 'Orbit', Icon: 'orbit', Tint: '#c4b5fd',
        Summary: 'Tangential circulation about a point with centripetal pull — gas orbits the centre.',
        Defaults: { Strength: 10, Radius: 1.6, Direction: [0, 1, 0], Falloff: 'Linear', Frequency: 0, Secondary: 0.5, Tertiary: 0 },
        Labels: { Secondary: 'Centripetal Pull' },
    },
    {
        Id: 'Containment', Code: 11, Category: 'Attraction', Name: 'Containment', Icon: 'containment', Tint: '#2dd4bf',
        Summary: 'Spring that pushes gas back inside its radius — an invisible soft bottle.',
        Defaults: { Strength: 20, Radius: 1.2, Direction: [0, 1, 0], Falloff: 'Linear', Frequency: 0, Secondary: 0.4, Tertiary: 0 },
        Labels: { Secondary: 'Wall Softness' },
    },
    {
        Id: 'MagneticDipole', Code: 19, Category: 'Attraction', Name: 'Magnetic Dipole', Icon: 'dipole', Tint: '#e879f9',
        Summary: 'Dipole field lines looping pole to pole — gas follows the magnetic flux.',
        Defaults: { Strength: 10, Radius: 1.8, Direction: [0, 1, 0], Falloff: 'SmoothStep', Frequency: 0, Secondary: 0.25, Tertiary: 0 },
        Labels: { Secondary: 'Core Radius' },
    },
    // ---------------------------------------------------------------- Rotational
    {
        Id: 'VortexColumn', Code: 3, Category: 'Rotational', Name: 'Vortex Column', Icon: 'vortex', Tint: '#34d399',
        Summary: 'Swirls fluid around an axis with optional inward pull and axial lift.',
        Defaults: { Strength: 12, Radius: 1.6, Direction: [0, 1, 0], Falloff: 'Linear', Frequency: 0.4, Secondary: 2.5, Tertiary: 0 },
        Labels: { Frequency: 'Inward Pull', Secondary: 'Axial Lift' },
    },
    {
        Id: 'VortexRing', Code: 9, Category: 'Rotational', Name: 'Vortex Ring', Icon: 'ring', Tint: '#c084fc',
        Summary: 'Toroidal circulation around a ring — launches smoke rings.',
        Defaults: { Strength: 16, Radius: 0.9, Direction: [0, 1, 0], Falloff: 'SmoothStep', Frequency: 0.35, Secondary: 0, Tertiary: 0 },
        Labels: { Frequency: 'Tube Radius' },
    },
    {
        Id: 'Spin', Code: 18, Category: 'Rotational', Name: 'Rigid Spin', Icon: 'spin', Tint: '#4ade80',
        Summary: 'Solid-body rotation: tangential force grows with distance from the axis.',
        Defaults: { Strength: 6, Radius: 1.5, Direction: [0, 1, 0], Falloff: 'Plateau', Frequency: 0, Secondary: 0, Tertiary: 0 },
        Labels: {},
    },
    // ---------------------------------------------------------------- Turbulence
    {
        Id: 'CurlNoiseTurbulence', Code: 4, Category: 'Turbulence', Name: 'Curl Noise Turbulence', Icon: 'turbulence', Tint: '#fbbf24',
        Summary: 'Divergence-free animated curl noise that breaks up laminar flow.',
        Defaults: { Strength: 9, Radius: 2.4, Direction: [0, 1, 0], Falloff: 'SmoothStep', Frequency: 1.8, Secondary: 0.7, Tertiary: 0 },
        Labels: { Frequency: 'Noise Scale', Secondary: 'Evolution Speed' },
    },
    {
        Id: 'BrownianJitter', Code: 15, Category: 'Turbulence', Name: 'Brownian Jitter', Icon: 'brownian', Tint: '#facc15',
        Summary: 'Per-cell random kicks re-rolled at a fixed rate — fine-grained, incoherent agitation.',
        Defaults: { Strength: 6, Radius: 1.5, Direction: [0, 1, 0], Falloff: 'SmoothStep', Frequency: 6, Secondary: 12, Tertiary: 0 },
        Labels: { Frequency: 'Cell Scale', Secondary: 'Re-roll Rate (Hz)' },
    },
    // ---------------------------------------------------------------- Burst
    {
        Id: 'RadialBurst', Code: 6, Category: 'Burst', Name: 'Radial Burst', Icon: 'burst', Tint: '#fb7185',
        Summary: 'Pulsing outward blast filling the reach — detonation kick.',
        Defaults: { Strength: 40, Radius: 1.5, Direction: [0, 1, 0], Falloff: 'Linear', Frequency: 1.2, Secondary: 0.12, Tertiary: 0 },
        Labels: { Frequency: 'Pulse Period', Secondary: 'Pulse Width', Tertiary: 'Start Delay' },
    },
    {
        Id: 'ShockwaveShell', Code: 12, Category: 'Burst', Name: 'Shockwave Shell', Icon: 'shockwave', Tint: '#f87171',
        Summary: 'A thin spherical pressure front expanding from the centre to the reach radius each period.',
        Defaults: { Strength: 60, Radius: 2.0, Direction: [0, 1, 0], Falloff: 'Constant', Frequency: 1.6, Secondary: 0.12, Tertiary: 0 },
        Labels: { Frequency: 'Period', Secondary: 'Shell Thickness', Tertiary: 'Start Delay' },
    },
    {
        Id: 'Implosion', Code: 13, Category: 'Burst', Name: 'Implosion', Icon: 'implosion', Tint: '#fda4af',
        Summary: 'Periodic inward collapse toward the centre — the pre-blast suck of a fireball.',
        Defaults: { Strength: 35, Radius: 1.5, Direction: [0, 1, 0], Falloff: 'Linear', Frequency: 1.5, Secondary: 0.15, Tertiary: 0 },
        Labels: { Frequency: 'Pulse Period', Secondary: 'Pulse Width', Tertiary: 'Start Delay' },
    },
    // ---------------------------------------------------------------- Damping / Thermal
    {
        Id: 'DragBaffle', Code: 5, Category: 'Damping', Name: 'Drag Baffle', Icon: 'drag', Tint: '#94a3b8',
        Summary: 'Damps velocity inside its reach — a soft brake on the flow.',
        Defaults: { Strength: 4, Radius: 1.0, Direction: [0, 1, 0], Falloff: 'SmoothStep', Frequency: 0, Secondary: 0, Tertiary: 0 },
        Labels: {},
    },
    {
        Id: 'ThermalUpdraft', Code: 7, Category: 'Thermal', Name: 'Thermal Updraft', Icon: 'updraft', Tint: '#f97316',
        Summary: 'Cylindrical column of lift along its axis.',
        Defaults: { Strength: 8, Radius: 0.8, Direction: [0, 1, 0], Falloff: 'SmoothStep', Frequency: 0, Secondary: 0, Tertiary: 0 },
        Labels: {},
    },
]);

export const ForceTypeById = Object.fromEntries(ForceGeneratorTypes.map((type) => [type.Id, type]));

//------------------------------------------------------------------------------------------------------------------------
//                                                  COLOUR RAMPS (Overlay Legend Mirror)
//------------------------------------------------------------------------------------------------------------------------

export const RampStops = Object.freeze({
    Turbo: ['#30123b', '#4662d7', '#36aaf9', '#1ae4b6', '#72fe5e', '#c8ef34', '#faba39', '#f66b19', '#ca2a04', '#7a0403'],
    Engineering: ['#0b1f3a', '#12518a', '#1aa0c8', '#5fd0a0', '#e5e36a', '#f28b2d', '#d9281c'],
    Plasma: ['#0d0887', '#5b02a3', '#9a179b', '#cb4679', '#ed7953', '#fdb32f', '#f0f921'],
    Diverging: ['#2166ac', '#67a9cf', '#d1e5f0', '#f7f7f7', '#fddbc7', '#ef8a62', '#b2182b'],
});

//------------------------------------------------------------------------------------------------------------------------
//                                                  SCENE PRESETS
//------------------------------------------------------------------------------------------------------------------------

export const SmokeLooks = Object.freeze({
    Soot: { Albedo: '#4b4b4f', Absorption: 4.0, Anisotropy: 0.4 },
    Grey: { Albedo: '#8e8f94', Absorption: 3.2, Anisotropy: 0.45 },
    Steam: { Albedo: '#d9dde3', Absorption: 2.2, Anisotropy: 0.6 },
    Dust: { Albedo: '#b89c74', Absorption: 2.6, Anisotropy: 0.3 },
});

export const FireLooks = Object.freeze({
    Wood: { FireEmber: '#ff2a05', FireFlame: '#ff8a16', FireCore: '#fff3cf' },
    Gas: { FireEmber: '#1f4bff', FireFlame: '#58a6ff', FireCore: '#e6f2ff' },
    Fuel: { FireEmber: '#b3120a', FireFlame: '#ff6a00', FireCore: '#ffd27a' },
    Magic: { FireEmber: '#5b0bb5', FireFlame: '#c84bff', FireCore: '#f6e3ff' },
});

export const ScenePresets = Object.freeze([
    {
        Id: 'preset-blank', Name: 'Blank Stage', Icon: 'domain', Summary: 'Empty 4 × 6 × 4 m domain — build from the Asset Browser.',
        Domain: { Resolution: [48, 72, 48], Size: [4, 6, 4], Buoyancy: 1.2, AmbientTemperature: 0, Cooling: 0.6, Vorticity: 0.35, Dissipation: 0.996 },
        Look: { Albedo: '#8e8f94', Absorption: 3.2 },
        Emitters: [], Forces: [],
    },
    {
        Id: 'preset-campfire', Name: 'Campfire', Icon: 'flame', Summary: 'Fuel-burning flame with rising embers, soot plume and a gentle crosswind.',
        Domain: { Resolution: [48, 80, 48], Size: [3, 5, 3], Buoyancy: 1.3, AmbientTemperature: 0, Cooling: 1.4, Vorticity: 0.25, Dissipation: 0.994, Combustion: 1.5 },
        Look: { Albedo: '#4b4b4f', Absorption: 4.2, FireIntensity: 5.5, FireSoftness: 3.0, FireOpacity: 1.6 },
        Visualizers: { Debris: { Visible: true, Count: 1024, Lifetime: 3.2, Size: 2.0, Drag: 2.4, Glow: 2.0 } },
        Emitters: [
            { Name: 'Fire Source', Shape: 'Disc', Position: [0, -2.3, 0], Radius: 0.42, Density: 0.3, Temperature: 5.0, Fuel: 1.3, Velocity: [0, 0.8, 0], Jitter: 0.5, Debris: 0.16, DebrisSpeed: 1.4, DebrisKind: 'Ember' },
        ],
        Forces: [
            { Type: 'DirectionalWind', Name: 'Breeze', Position: [0, 0, 0], Strength: 0.35, Direction: [1, 0, 0.2], Falloff: 'Constant', Frequency: 0.3, Secondary: 0.5 },
            { Type: 'CurlNoiseTurbulence', Name: 'Flame Flicker', Position: [0, -1.6, 0], Strength: 0.5, Radius: 0.8, Falloff: 'Gaussian', Frequency: 3.5, Secondary: 1.0 },
        ],
    },
    {
        Id: 'preset-smoke-plume', Name: 'Smoke Plume', Icon: 'smoke', Summary: 'Cold smoke that rises, cools and thins out before the roof of the domain.',
        Domain: { Resolution: [48, 84, 48], Size: [4, 7, 4], Buoyancy: 0.55, AmbientTemperature: 0, Cooling: 0.9, Vorticity: 0.45, Dissipation: 0.996 },
        Look: { Albedo: '#8e8f94', Absorption: 3.2 },
        Emitters: [
            { Name: 'Smoke Stack', Shape: 'Sphere', Position: [0, -3.0, 0], Radius: 0.35, Density: 1.2, Temperature: 0.9, Fuel: 0, Velocity: [0, 0.9, 0], Jitter: 0.3 },
        ],
        Forces: [
            { Type: 'VortexColumn', Position: [0, -0.5, 0], Strength: 4.0, Radius: 1.4, Frequency: 0.4, Secondary: 0.4 },
            { Type: 'DragBaffle', Name: 'Ceiling Brake', Position: [0, 2.7, 0], Strength: 1.2, Radius: 2.2, Falloff: 'Plateau' },
        ],
    },
    {
        Id: 'preset-explosion', Name: 'Explosion', Icon: 'burst', Summary: 'Single keyed detonation — 0.35 s fireball, short roll-up turbulence, then a free-rising mushroom that never reaches the roof.',
        Domain: { Resolution: [60, 80, 60], Size: [6, 8, 6], Buoyancy: 0.8, AmbientTemperature: 0, Cooling: 1.4, Vorticity: 0.5, Dissipation: 0.992, Combustion: 1.8, SceneLoop: 7 },
        Look: { Albedo: '#3f3d3c', Absorption: 4.5, FireIntensity: 6.0, FireOpacity: 2.0, FireSoftness: 4.0, FireEmber: '#b3120a', FireFlame: '#ff6a00', FireCore: '#ffd27a', Exposure: 1.0 },
        Emitters: [
            { Name: 'Detonation Core', Shape: 'Sphere', Position: [0, -3.0, 0], Radius: 0.6, Density: 1.2, Temperature: 6.5, Fuel: 1.4, Velocity: [0, 0, 0], Jitter: 0.8, StartTime: 0.2, Duration: 0.35, Fade: 0.08 },
        ],
        Forces: [
            { Type: 'RadialBurst', Position: [0, -3.0, 0], Strength: 42, Radius: 2.2, Frequency: 6, Secondary: 0.12, Tertiary: 0.2, StartTime: 0.2, Duration: 0.5, Fade: 0.05 },
            { Type: 'CurlNoiseTurbulence', Name: 'Roll-up Turbulence', Position: [0, -1.5, 0], Strength: 2.2, Radius: 2.6, Frequency: 1.2, Secondary: 0.8, StartTime: 0.3, Duration: 2.4, Fade: 0.5 },
            { Type: 'DragBaffle', Name: 'Ceiling Brake', Position: [0, 3.0, 0], Strength: 1.6, Radius: 2.6, Falloff: 'Plateau' },
        ],
    },
    {
        Id: 'preset-demolition', Name: 'Demolition Blast', Icon: 'debris', Summary: 'Ground charge: fireball, floor dust skirt and ballistic debris that arcs, falls and tumbles to rest.',
        Domain: { Resolution: [60, 80, 60], Size: [6, 8, 6], Buoyancy: 0.75, AmbientTemperature: 0, Cooling: 1.5, Vorticity: 0.45, Dissipation: 0.993, Combustion: 1.7, SceneLoop: 8 },
        Look: { Albedo: '#6b645c', Absorption: 4.2, FireIntensity: 5.5, FireOpacity: 1.8, FireSoftness: 4.0, FireEmber: '#a8160c', FireFlame: '#ff7a1a', FireCore: '#ffe3a0', Exposure: 1.0 },
        Visualizers: { Debris: { Visible: true, Count: 3072, Lifetime: 6.5, Size: 3.0, Drag: 0.9, Bounce: 0.35, Glow: 0.8 } },
        Emitters: [
            { Name: 'Ground Charge', Shape: 'Sphere', Position: [0, -3.3, 0], Radius: 0.55, Density: 1.4, Temperature: 6.0, Fuel: 1.3, Velocity: [0, 0, 0], Jitter: 0.8, StartTime: 0.2, Duration: 0.3, Fade: 0.06, Debris: 1.0, DebrisSpeed: 11 },
            { Name: 'Dust Skirt', Shape: 'Disc', Position: [0, -3.7, 0], Radius: 1.5, Density: 1.6, Temperature: 0.5, Fuel: 0, Velocity: [0, 1.8, 0], Jitter: 0.6, StartTime: 0.3, Duration: 0.6, Fade: 0.15 },
        ],
        Forces: [
            { Type: 'RadialBurst', Position: [0, -3.3, 0], Strength: 38, Radius: 2.4, Frequency: 6, Secondary: 0.12, Tertiary: 0.2, StartTime: 0.2, Duration: 0.45, Fade: 0.05 },
            { Type: 'CurlNoiseTurbulence', Name: 'Roll-up Turbulence', Position: [0, -1.6, 0], Strength: 2.0, Radius: 2.6, Frequency: 1.2, Secondary: 0.8, StartTime: 0.3, Duration: 2.2, Fade: 0.5 },
            { Type: 'DragBaffle', Name: 'Ceiling Brake', Position: [0, 3.0, 0], Strength: 1.6, Radius: 2.6, Falloff: 'Plateau' },
        ],
    },
    {
        Id: 'preset-tornado', Name: 'Tornado Funnel', Icon: 'vortex', Summary: 'Tight vortex with inward pull and axis attraction lofting a dust funnel — no turbulence to break the shape.',
        Domain: { Resolution: [48, 84, 48], Size: [4, 7, 4], Buoyancy: 0.15, AmbientTemperature: 0, Cooling: 0.3, Vorticity: 0.1, Dissipation: 0.997 },
        Look: { Albedo: '#b89c74', Absorption: 2.6, Anisotropy: 0.3 },
        Visualizers: { Debris: { Visible: true, Count: 1536, Lifetime: 9, Size: 3.5, Drag: 3.0, Bounce: 0.1, Glow: 0.1 } },
        Emitters: [
            { Name: 'Dust Ring', Shape: 'Disc', Position: [0, -3.4, 0], Radius: 0.9, Density: 0.9, Temperature: 0.1, Fuel: 0, Velocity: [0, 0.4, 0], Jitter: 0.35 },
            { Name: 'Loose Paper', Shape: 'Disc', Position: [0, -3.4, 0], Radius: 1.7, Density: 0, Temperature: 0, Fuel: 0, Velocity: [0, 0, 0], Jitter: 0, Debris: 0.08, DebrisSpeed: 1.2, DebrisKind: 'Paper' },
        ],
        Forces: [
            { Type: 'VortexColumn', Position: [0, 0, 0], Strength: 14, Radius: 1.1, Falloff: 'Plateau', Frequency: 1.8, Secondary: 2.2 },
            { Type: 'AxisAttractor', Name: 'Funnel Core', Position: [0, 0, 0], Strength: 6, Radius: 1.6 },
            { Type: 'DragBaffle', Name: 'Ceiling Brake', Position: [0, 2.8, 0], Strength: 1.5, Radius: 2.0, Falloff: 'Plateau' },
        ],
    },
    {
        Id: 'preset-infinite-drift', Name: 'Infinite Grid · Drift', Icon: 'infinite', Summary: 'No box at all: a car slaloms away for ever and 2 m tiles allocate themselves wherever the smoke goes — every wire cube is a live tile, amber ones hold the emitter, and they free themselves once the smoke has gone.',
        Domain: { Resolution: [24, 24, 24], Size: [4, 4, 4], MaxCells: 24, Grid: 'Infinite', TileSize: 2, TileResolution: 24, TilePool: 56, Buoyancy: 0.12, AmbientTemperature: 0, Cooling: 0.4, Vorticity: 0.3, Dissipation: 0.994, Gravity: 0.3, VelocityDissipation: 0.998, PressureIterations: 18 },
        Boundary: 'OpenAll',
        Look: { Albedo: '#d2d2d6', Absorption: 3.0, Anisotropy: 0.55, Exposure: 1.1 },
        Emitters: [
            { Name: 'Rear Tyre', Shape: 'Disc', Position: [0, 0.22, 0], Radius: 0.24, Density: 2.4, Temperature: 0.4, Fuel: 0, Velocity: [-2.6, 0.6, 0], Jitter: 0.45, Orientation: [1, 0, 0], PathKind: 'Slalom', PathRadius: 1.6, PathSpeed: 2.4 },
        ],
        Forces: [
            { Type: 'DirectionalWind', Name: 'Crosswind', Position: [0, 0, 0], Strength: 0.3, Direction: [0, 0, 1], Falloff: 'Constant', Frequency: 0.4, Secondary: 0.5 },
            { Type: 'DragBaffle', Name: 'Ceiling Brake', Position: [0, 1.9, 0], Strength: 1.4, Radius: 40, Falloff: 'Plateau' },
        ],
    },
    {
        Id: 'preset-infinite-plume', Name: 'Infinite Grid · Plume', Icon: 'infinite', Summary: 'A hot plume rising in open sky with a steady wind: tiles stack upwards and downwind as the smoke climbs, nothing is ever clipped — watch the cubes appear ahead of the gas and vanish behind it.',
        Domain: { Resolution: [24, 24, 24], Size: [4, 4, 4], MaxCells: 24, Grid: 'Infinite', TileSize: 2, TileResolution: 24, TilePool: 56, Buoyancy: 1.1, AmbientTemperature: 0, Cooling: 0.5, Vorticity: 0.4, Dissipation: 0.997, Gravity: 0.1, VelocityDissipation: 0.999, PressureIterations: 18 },
        Boundary: 'OpenAll',
        Look: { Albedo: '#9a9ca3', Absorption: 3.0, Anisotropy: 0.5, Exposure: 1.1 },
        Emitters: [
            { Name: 'Stack', Shape: 'Disc', Position: [0, 0.3, 0], Radius: 0.35, Density: 1.6, Temperature: 1.6, Fuel: 0, Velocity: [0, 2.0, 0], Jitter: 0.3, Orientation: [0, 1, 0] },
        ],
        Forces: [
            { Type: 'DirectionalWind', Name: 'Prevailing Wind', Position: [0, 0, 0], Strength: 0.9, Direction: [1, 0, 0.15], Falloff: 'Constant', Frequency: 0.3, Secondary: 0.5 },
            { Type: 'CurlNoiseTurbulence', Name: 'Gusts', Position: [0, 3, 0], Strength: 1.2, Radius: 30, Falloff: 'Constant', Frequency: 0.25, Secondary: 0.6 },
        ],
    },
    {
        Id: 'preset-tile-crossing', Name: 'Tile Crossing · World Grid', Icon: 'grid', Summary: 'Static 4 × 1 × 2 tile grid: a smoke source in the first tile is blown clean across every seam by a steady wind, curls round a vortex two tiles downstream and leaves at the far end — the bright box is one tile, the dim outline the whole grid.',
        Domain: { Resolution: [144, 30, 72], Size: [3, 2.5, 3], MaxCells: 36, Tiles: [4, 1, 2], Follow: 'None', Buoyancy: 0.25, AmbientTemperature: 0, Cooling: 0.3, Vorticity: 0.4, Dissipation: 0.997, Gravity: 0.1, VelocityDissipation: 0.999, PressureIterations: 20 },
        Boundary: 'OpenAll',
        Look: { Albedo: '#d9dde3', Absorption: 2.6, Anisotropy: 0.55, Exposure: 1.1 },
        Emitters: [
            { Name: 'Smoke Source', Shape: 'Sphere', Position: [-4.6, -0.7, -1.4], Radius: 0.3, Density: 2.0, Temperature: 0.5, Fuel: 0, Velocity: [2.0, 0.6, 0.4], Jitter: 0.3 },
        ],
        Forces: [
            { Type: 'DirectionalWind', Name: 'Tailwind', Position: [0, 0, 0], Strength: 1.6, Direction: [1, 0, 0.12], Falloff: 'Constant', Frequency: 0.3, Secondary: 0.4 },
            { Type: 'VortexColumn', Name: 'Mid-field Vortex', Position: [1.5, -0.3, 0.6], Strength: 3.5, Radius: 1.6, Falloff: 'Gaussian', Direction: [0, 1, 0] },
            { Type: 'DragBaffle', Name: 'Ceiling Brake', Position: [0, 0.9, 0], Strength: 1.2, Radius: 7, Falloff: 'Plateau' },
        ],
    },
    {
        Id: 'preset-drift-run', Name: 'Drift Run · World Grid', Icon: 'track', Summary: 'A car slaloming down an endless strip: the 3 × 1 × 3 tile world grid follows the tyre, so the smoke trail streams back through tile seams and lingers behind instead of hitting a wall.',
        Domain: { Resolution: [120, 22, 120], Size: [4, 2.2, 4], MaxCells: 40, Tiles: [3, 1, 3], Follow: 'Emitter', Buoyancy: 0.1, AmbientTemperature: 0, Cooling: 0.4, Vorticity: 0.3, Dissipation: 0.995, Gravity: 0.3, VelocityDissipation: 0.998, PressureIterations: 20 },
        Boundary: 'OpenAll',
        Look: { Albedo: '#d2d2d6', Absorption: 3.0, Anisotropy: 0.55, Exposure: 1.1 },
        Visualizers: { Debris: { Visible: true, Count: 512, Lifetime: 2.5, Size: 2.0, Drag: 0.6, Bounce: 0.3, Glow: 0.05 } },
        Emitters: [
            { Name: 'Rear Tyre', Shape: 'Disc', Position: [-4, -0.98, 0], Radius: 0.24, Density: 2.4, Temperature: 0.4, Fuel: 0, Velocity: [-2.6, 0.6, 0], Jitter: 0.45, Orientation: [1, 0, 0], PathKind: 'Slalom', PathRadius: 1.3, PathSpeed: 2.2, Debris: 0.05, DebrisSpeed: 3.5, DebrisKind: 'Rubble' },
        ],
        Forces: [
            { Type: 'DirectionalWind', Name: 'Crosswind', Position: [0, 0, 0], Strength: 0.35, Direction: [0, 0, 1], Falloff: 'Constant', Frequency: 0.4, Secondary: 0.5 },
            { Type: 'DragBaffle', Name: 'Ceiling Brake', Position: [0, 0.8, 0], Strength: 1.4, Radius: 6, Falloff: 'Plateau' },
        ],
    },
    {
        Id: 'preset-tyre-drift', Name: 'Tyre Drift Smoke', Icon: 'tyre', Summary: 'A spinning tyre circling the pad: dense white rubber smoke trailing behind, hugging the ground and shearing in the crosswind.',
        Domain: { Resolution: [96, 36, 96], Size: [7, 2.6, 7], Buoyancy: 0.12, AmbientTemperature: 0, Cooling: 0.4, Vorticity: 0.3, Dissipation: 0.994, Gravity: 0.3, VelocityDissipation: 0.998 },
        Boundary: 'OpenAll',
        Look: { Albedo: '#d2d2d6', Absorption: 3.0, Anisotropy: 0.55, Exposure: 1.1 },
        Visualizers: { Debris: { Visible: true, Count: 768, Lifetime: 2.5, Size: 2.0, Drag: 0.6, Bounce: 0.3, Glow: 0.05 } },
        Emitters: [
            { Name: 'Rear Tyre', Shape: 'Disc', Position: [0, -1.18, 0], Radius: 0.26, Density: 2.2, Temperature: 0.4, Fuel: 0, Velocity: [-2.8, 0.7, 0], Jitter: 0.45, Orientation: [1, 0, 0], PathKind: 'Circle', PathRadius: 1.9, PathSpeed: 1.15, Debris: 0.05, DebrisSpeed: 3.5, DebrisKind: 'Rubble' },
        ],
        Forces: [
            { Type: 'DirectionalWind', Name: 'Crosswind', Position: [0, 0, 0], Strength: 0.45, Direction: [0.3, 0, 1], Falloff: 'Constant', Frequency: 0.4, Secondary: 0.5 },
            { Type: 'DragBaffle', Name: 'Ceiling Brake', Position: [0, 1.0, 0], Strength: 1.4, Radius: 3.4, Falloff: 'Plateau' },
        ],
    },
    {
        Id: 'preset-mograph-grid', Name: 'Mograph Field', Icon: 'gridcloner', Summary: 'No smoke — a spring-held grid cloner and a ring cloner displaced by an orbit, a vortex and a repulsor you can drag through them.',
        Domain: { Resolution: [48, 48, 48], Size: [5, 5, 5], Buoyancy: 0, AmbientTemperature: 0, Cooling: 0, Vorticity: 0, Dissipation: 0.99, PressureIterations: 8 },
        Look: { Visible: false },
        Particles: [
            { Template: 'grid-cloner', Name: 'Grid Cloner', Position: [0, 0, 0], Radius: 1.7, Count: 4096, Spring: 5, Damping: 2.5, SizeStart: 5, SizeEnd: 5 },
            { Template: 'ring-cloner', Name: 'Ring Cloner', Position: [0, -2.2, 0], Radius: 2.1, Count: 720, Direction: [0, 1, 0] },
        ],
        Forces: [
            { Type: 'PointRepulsor', Name: 'Push Probe', Position: [0.8, 0.4, 0.3], Strength: 28, Radius: 1.5, Falloff: 'SmoothStep', Secondary: 0.2 },
            { Type: 'RadialBurst', Name: 'Heartbeat', Position: [0, 0, 0], Strength: 30, Radius: 2.6, Falloff: 'Cosine', Frequency: 2.4, Secondary: 0.12 },
            { Type: 'VortexColumn', Name: 'Twist', Position: [0, -2.2, 0], Strength: 6, Radius: 2.4, Falloff: 'Plateau', Frequency: 0.2, Secondary: 0.0 },
            { Type: 'CurlNoiseTurbulence', Position: [0, 0, 0], Strength: 2.2, Radius: 3.0, Frequency: 0.9, Secondary: 0.5 },
        ],
    },
    {
        Id: 'preset-stardust', Name: 'Stardust', Icon: 'stardust', Summary: 'No smoke — Particular-style micro-motes in a slow turbulence field with an orbit and a vortex sweeping them into ribbons; bokeh depth of field.',
        Domain: { Resolution: [48, 32, 48], Size: [9, 6, 9], Buoyancy: 0, AmbientTemperature: 0, Cooling: 0, Vorticity: 0, Dissipation: 0.99, PressureIterations: 8 },
        Look: { Visible: false },
        Particles: [
            { Template: 'stardust', Name: 'Stardust', Position: [0, 0, 0], Radius: 3.6 },
            { Template: 'nebula', Name: 'Nebula Core', Position: [0.6, 0.2, -0.4], Radius: 0.4, Count: 8192, Rate: 1.5 },
        ],
        Forces: [
            { Type: 'VortexColumn', Name: 'Sweep', Position: [0, 0, 0], Strength: 1.6, Radius: 4.2, Falloff: 'Plateau', Direction: [0.3, 1, 0.2], Frequency: 0.25, Secondary: 0.0 },
            { Type: 'WindShear', Name: 'Layered Drift', Position: [0, 0, 0], Strength: 0.35, Radius: 4.5, Falloff: 'Constant', Direction: [1, 0, 0.2], Frequency: 0.3, Secondary: 1.2 },
            { Type: 'PointAttractor', Name: 'Gravity Well', Position: [-1.5, -0.3, 0.8], Strength: 2.5, Radius: 2.6, Falloff: 'Gaussian', Secondary: 0.3 },
        ],
    },
    {
        Id: 'preset-light-strands', Name: 'Light Strands', Icon: 'strands', Summary: 'No smoke — aerodynamic light strands streaming past a sphere collider wake, plus a bundle of silk ribbons twisting through an orbit field.',
        Domain: { Resolution: [96, 36, 48], Size: [16, 6, 8], Buoyancy: 0, AmbientTemperature: 0, Cooling: 0, Vorticity: 0.2, Dissipation: 0.995, VelocityDissipation: 0.999, PressureIterations: 16 },
        Boundary: 'OpenAll',
        Look: { Visible: false },
        Particles: [
            { Template: 'light-strands', Name: 'Streamlines', Position: [-7.4, 0.2, 0], Radius: 1.6, GasInfluence: 1.5, Count: 1536 },
            { Template: 'silk-ribbons', Name: 'Silk Bundle', Position: [-7.0, -1.6, 2.2], Radius: 0.35, Count: 1024 },
        ],
        Forces: [
            { Type: 'DirectionalWind', Name: 'Tunnel Wind', Position: [0, 0, 0], Strength: 0.9, Direction: [1, 0, 0], Falloff: 'Constant', Frequency: 0.2, Secondary: 0.1 },
            { Type: 'Orbit', Name: 'Twist', Position: [2.0, -0.6, 1.4], Strength: 2.2, Radius: 2.6, Falloff: 'Gaussian', Direction: [1, 0.2, 0], Frequency: 0.15, Secondary: 0.3 },
            { Type: 'CurlNoiseTurbulence', Name: 'Weave', Position: [0, 0, 0], Strength: 0.35, Radius: 8, Falloff: 'Plateau', Frequency: 0.4, Secondary: 0.12 },
            { Type: 'DragBaffle', Name: 'Air Resistance', Position: [0, 0, 0], Strength: 0.25, Radius: 9, Falloff: 'Constant' },
        ],
        Colliders: [
            { Name: 'Bluff Body', Position: [-1.0, 0, 0], Radius: 1.0 },
        ],
    },
    {
        Id: 'preset-form', Name: 'Dissolving Form', Icon: 'swarm', Summary: 'No smoke — a solid particle sphere peeling into noise, with a bioluminescent bloom rising beneath it.',
        Domain: { Resolution: [48, 48, 48], Size: [6, 6, 6], Buoyancy: 0, AmbientTemperature: 0, Cooling: 0, Vorticity: 0, Dissipation: 0.99, PressureIterations: 8 },
        Look: { Visible: false },
        Particles: [
            { Template: 'dissolving-sphere', Name: 'Form Sphere', Position: [0, 0.4, 0], Radius: 1.4 },
            { Template: 'bioluminescent', Name: 'Bloom', Position: [0, -2.9, 0], Radius: 2.2, Count: 8192 },
        ],
        Forces: [
            { Type: 'CurlNoiseTurbulence', Name: 'Peel', Position: [0, 0.4, 0], Strength: 1.2, Radius: 2.2, Falloff: 'Gaussian', Frequency: 0.8, Secondary: 0.35 },
            { Type: 'ThermalUpdraft', Name: 'Lift', Position: [0, -1.5, 0], Strength: 0.5, Radius: 2.4, Falloff: 'Plateau' },
        ],
    },
    {
        Id: 'preset-celebration', Name: 'Celebration', Icon: 'confetti', Summary: 'No smoke — two confetti cannons, a sparks fountain and fireflies, all pushed around by a gusting wind gizmo.',
        Domain: { Resolution: [40, 48, 40], Size: [5, 6, 5], Buoyancy: 0, AmbientTemperature: 0, Cooling: 0, Vorticity: 0, Dissipation: 0.99, PressureIterations: 8 },
        Look: { Visible: false },
        Particles: [
            { Template: 'confetti', Name: 'Cannon Left', Position: [-1.8, -2.8, 0], Direction: [0.45, 1, 0.1] },
            { Template: 'confetti', Name: 'Cannon Right', Position: [1.8, -2.8, 0], Direction: [-0.45, 1, -0.1] },
            { Template: 'sparks', Name: 'Spark Fountain', Position: [0, -2.9, 0], Speed: 6, Spread: 0.35 },
            { Template: 'fireflies', Name: 'Fireflies', Position: [0, 0.5, 0], Radius: 2.0 },
        ],
        Forces: [
            { Type: 'DirectionalWind', Name: 'Gust', Position: [0, 0, 0], Strength: 1.2, Direction: [1, 0, 0.3], Falloff: 'Constant', Frequency: 0.6, Secondary: 1.0 },
        ],
    },
    {
        Id: 'preset-wind-tunnel', Name: 'Wind Tunnel', Icon: 'wind', Summary: 'Crosswind jet over a spherical collider with a von Kármán wake.',
        Domain: { Resolution: [96, 48, 48], Size: [6, 3, 3], Buoyancy: 0.0, AmbientTemperature: 0, Cooling: 0.0, Vorticity: 0.45, Dissipation: 0.999 },
        Boundary: 'OpenAll',
        Look: { Albedo: '#d9dde3', Absorption: 2.2, Anisotropy: 0.6 },
        Emitters: [
            { Name: 'Tracer Inlet', Shape: 'Disc', Position: [-2.6, 0, 0], Radius: 0.6, Density: 0.7, Temperature: 0, Fuel: 0, Velocity: [4.5, 0, 0], Jitter: 0.05, Orientation: [1, 0, 0] },
        ],
        Forces: [
            { Type: 'DirectionalWind', Position: [0, 0, 0], Strength: 3.5, Direction: [1, 0, 0], Falloff: 'Constant', Frequency: 0.0, Secondary: 0.0 },
        ],
        Colliders: [
            { Name: 'Bluff Sphere', Position: [-0.8, 0, 0], Radius: 0.45 },
        ],
    },
    {
        Id: 'preset-smoke-ring', Name: 'Smoke Ring Cannon', Icon: 'ring', Summary: 'Vortex ring generator launching toroidal puffs.',
        Domain: { Resolution: [64, 64, 96], Size: [3, 3, 4.5], Buoyancy: 0.15, AmbientTemperature: 0, Cooling: 0.1, Vorticity: 0.2, Dissipation: 0.998 },
        Boundary: 'OpenAll',
        Look: { Albedo: '#d9dde3', Absorption: 2.4, Anisotropy: 0.6 },
        Emitters: [
            { Name: 'Ring Muzzle', Shape: 'Disc', Position: [0, 0, -1.8], Radius: 0.45, Density: 1.2, Temperature: 0.3, Fuel: 0, Velocity: [0, 0, 3.0], Jitter: 0.1, Orientation: [0, 0, 1], Pulse: 1.8 },
        ],
        Forces: [
            { Type: 'VortexRing', Position: [0, 0, -1.3], Strength: 14, Radius: 0.5, Direction: [0, 0, 1], Frequency: 0.3 },
        ],
    },
]);

//------------------------------------------------------------------------------------------------------------------------
//                                                  TIMING KEYS
//------------------------------------------------------------------------------------------------------------------------

/** Keyed activation envelope (0..1) for a force or emitter at simulation time `time`. Duration 0 = stays on after StartTime. */
export function timingEnvelope(node, time)
{
    const start = node.StartTime || 0;
    const duration = node.Duration || 0;
    const fade = Math.max(0.001, node.Fade ?? 0.15);
    const repeat = node.Repeat || 0;
    if (start <= 0 && duration <= 0) return 1;
    let local = time - start;
    if (local < 0) return 0;
    if (repeat > 0) local = local % repeat;
    const rise = Math.min(1, local / fade);
    if (duration <= 0) return rise;
    if (local >= duration) return 0;
    const fall = Math.min(1, (duration - local) / fade);
    return Math.min(rise, fall);
}

export function isKeyed(node)
{
    return (node.StartTime || 0) > 0 || (node.Duration || 0) > 0;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  FACTORY HELPERS
//------------------------------------------------------------------------------------------------------------------------

let NextNodeIndex = 1;

export function allocateNodeId(prefix)
{
    NextNodeIndex += 1;
    return `${prefix}-${NextNodeIndex.toString(36)}`;
}

export function createForceGenerator(typeId, overrides = {})
{
    const type = ForceTypeById[typeId];
    if (!type) throw new Error(`Unknown force generator type "${typeId}".`);
    return {
        Id: allocateNodeId('force'),
        Kind: 'Force',
        Type: type.Id,
        Name: overrides.Name || type.Name,
        Enabled: true,
        Visible: true,
        Position: [...(overrides.Position || [0, 0, 0])],
        Direction: [...(overrides.Direction || type.Defaults.Direction)],
        Strength: overrides.Strength ?? type.Defaults.Strength,
        Radius: overrides.Radius ?? type.Defaults.Radius,
        Falloff: overrides.Falloff || type.Defaults.Falloff,
        Frequency: overrides.Frequency ?? type.Defaults.Frequency,
        Secondary: overrides.Secondary ?? type.Defaults.Secondary,
        Tertiary: overrides.Tertiary ?? type.Defaults.Tertiary ?? 0,
        StartTime: overrides.StartTime ?? 0,
        Duration: overrides.Duration ?? 0,
        Fade: overrides.Fade ?? 0.15,
        Repeat: overrides.Repeat ?? 0,
    };
}

export const DebrisKinds = Object.freeze(['Rubble', 'Ember', 'Paper']);
export const EmitterPathKinds = Object.freeze(['None', 'Circle', 'Line', 'Figure8', 'Straight', 'Slalom']);
export const GridFollowModes = Object.freeze(['None', 'Emitter', 'Particles', 'Camera']);
export const MaximumGridTiles = 5;
export const GridModes = Object.freeze(['Fixed', 'Infinite']);
export const MaximumTilePool = 160;
export const MaximumInfiniteCells = 1600000;

/** Animated emitter transform: returns { Position, Velocity } for an emitter following its motion path at `time`. */
export function emitterTransform(emitter, time)
{
    const kind = emitter.PathKind || 'None';
    if (kind === 'None') return { Position: emitter.Position, Velocity: emitter.Velocity };
    const radius = emitter.PathRadius || 0, speed = emitter.PathSpeed || 0;
    const angle = time * speed;
    let offset, heading;
    if (kind === 'Circle')
    {
        offset = [Math.cos(angle) * radius, 0, Math.sin(angle) * radius];
        heading = [-Math.sin(angle), 0, Math.cos(angle)];
    }
    else if (kind === 'Line')
    {
        const s = Math.sin(angle);
        offset = [s * radius, 0, 0];
        heading = [Math.cos(angle) >= 0 ? 1 : -1, 0, 0];
    }
    else if (kind === 'Straight')
    {
        // Unbounded drive: PathSpeed is metres per second along +X; PathRadius is ignored. Pair with a following World Grid.
        offset = [time * speed, 0, 0];
        heading = [1, 0, 0];
    }
    else if (kind === 'Slalom')
    {
        // Unbounded drive weaving left/right: PathRadius is the weave half-width, PathSpeed the forward speed.
        const period = Math.max(radius * 2.5, 0.5);
        const weave = time * speed / period;
        offset = [time * speed, 0, Math.sin(weave) * radius];
        const dz = Math.cos(weave) * radius * speed / period;
        const length = Math.hypot(speed, dz) || 1;
        heading = [speed / length, 0, dz / length];
    }
    else
    {
        offset = [Math.sin(angle) * radius, 0, Math.sin(angle * 2) * radius * 0.5];
        const length = Math.hypot(Math.cos(angle), Math.cos(angle * 2)) || 1;
        heading = [Math.cos(angle) / length, 0, Math.cos(angle * 2) / length];
    }
    // Rotate the local exit velocity so "backwards" stays behind the moving source: local x = heading, local z = right.
    const right = [heading[2], 0, -heading[0]];
    const local = emitter.Velocity;
    const velocity = [
        heading[0] * local[0] + right[0] * local[2],
        local[1],
        heading[2] * local[0] + right[2] * local[2],
    ];
    return { Position: [emitter.Position[0] + offset[0], emitter.Position[1] + offset[1], emitter.Position[2] + offset[2]], Velocity: velocity, Heading: heading };
}


export function createEmitter(overrides = {})
{
    return {
        Id: allocateNodeId('emitter'),
        Kind: 'Emitter',
        Name: overrides.Name || 'Emitter',
        Enabled: true,
        Visible: true,
        Shape: overrides.Shape || 'Sphere',
        Position: [...(overrides.Position || [0, -1.5, 0])],
        Orientation: [...(overrides.Orientation || [0, 1, 0])],
        Radius: overrides.Radius ?? 0.4,
        Density: overrides.Density ?? 1.0,
        Temperature: overrides.Temperature ?? 2.0,
        Fuel: overrides.Fuel ?? 0.0,
        Velocity: [...(overrides.Velocity || [0, 1, 0])],
        Jitter: overrides.Jitter ?? 0.4,
        Pulse: overrides.Pulse ?? 0.0,
        StartTime: overrides.StartTime ?? 0,
        Duration: overrides.Duration ?? 0,
        Fade: overrides.Fade ?? 0.15,
        Repeat: overrides.Repeat ?? 0,
        Debris: overrides.Debris ?? 0,
        DebrisSpeed: overrides.DebrisSpeed ?? 6,
        DebrisKind: overrides.DebrisKind || 'Rubble',
        PathKind: overrides.PathKind || 'None',
        PathRadius: overrides.PathRadius ?? 1.5,
        PathSpeed: overrides.PathSpeed ?? 1.0,
    };
}

export function createCollider(overrides = {})
{
    return {
        Id: allocateNodeId('collider'),
        Kind: 'Collider',
        Name: overrides.Name || 'Sphere Collider',
        Enabled: true,
        Visible: true,
        Position: [...(overrides.Position || [0, 0, 0])],
        Radius: overrides.Radius ?? 0.5,
    };
}

export const ResolutionPresets = Object.freeze({ Draft: 32, Low: 48, Medium: 64, High: 96, Ultra: 128, Extreme: 160 });

// Resolution follows the Unreal convention: the domain keeps its world size, `MaxCells` sets the cell count along the
// longest axis, and `CellSize` + per-axis `Resolution` are derived so shrinking the voxel count makes the gas coarser.
export function resolveDomainGrid(domain)
{
    if (domain.Grid === 'Infinite') return resolveInfiniteGrid(domain);
    domain.Grid = 'Fixed';
    // World Grid: the domain `Size` is one tile; the simulated window spans `Tiles` adjacent tiles per axis as a single
    // seamless field. Cells per tile are integers so the window can slide by whole tiles with an exact texel copy.
    const tiles = (domain.Tiles || [1, 1, 1]).map((count) => Math.max(1, Math.min(MaximumGridTiles, Math.round(count || 1))));
    const longest = Math.max(domain.Size[0], domain.Size[1], domain.Size[2]);
    const maxCells = Math.max(8, Math.min(160, Math.round(domain.MaxCells)));
    let cellSize = longest / maxCells;
    // Keep the whole window inside the 160-cell solver limit per axis: coarsen the voxel rather than block the grid.
    for (let axis = 0; axis < 3; axis += 1) cellSize = Math.max(cellSize, domain.Size[axis] * tiles[axis] / 160);
    const multi = tiles[0] * tiles[1] * tiles[2] > 1;
    const tileCells = domain.Size.map((extent) => Math.max(multi ? 4 : 8, Math.round(extent / cellSize)));
    domain.Tiles = tiles;
    domain.TileCells = tileCells;
    domain.CellSize = cellSize;
    domain.Resolution = tileCells.map((cells, axis) => Math.max(8, Math.min(160, cells * tiles[axis])));
    if (!domain.GridOrigin) domain.GridOrigin = [0, 0, 0];
    if (!GridFollowModes.includes(domain.Follow)) domain.Follow = 'None';
    return domain;
}

/**
 * Infinite grid: an unbounded lattice of cubic tiles (`TileSize` m, `TileResolution` cells per edge) allocated on demand
 * from a pool of `TilePool` atlas slots. There is no box at all — the pool size is the only budget, and it is capped so
 * the atlas stays inside a sane GPU memory footprint.
 */
export function resolveInfiniteGrid(domain)
{
    domain.Grid = 'Infinite';
    domain.TileSize = Math.max(0.5, Math.min(8, domain.TileSize || 2));
    domain.TileResolution = Math.max(8, Math.min(48, Math.round(domain.TileResolution || 24)));
    const perTile = domain.TileResolution ** 3;
    domain.TilePool = Math.max(4, Math.min(MaximumTilePool, Math.floor(MaximumInfiniteCells / perTile), Math.round(domain.TilePool || 48)));
    domain.CellSize = domain.TileSize / domain.TileResolution;
    domain.Resolution = [domain.TileResolution, domain.TileResolution, domain.TileResolution];
    domain.Tiles = [1, 1, 1];
    domain.TileCells = [...domain.Resolution];
    if (!domain.GridOrigin) domain.GridOrigin = [0, 0, 0];
    if (!GridFollowModes.includes(domain.Follow)) domain.Follow = 'None';
    return domain;
}

/** World-space centre of the simulated window: tile index × tile pitch (tile 0 is centred on the origin). */
export function gridWindowCentre(domain)
{
    const origin = domain.GridOrigin || [0, 0, 0];
    return [0, 1, 2].map((axis) => origin[axis] * domain.TileCells[axis] * domain.CellSize);
}

/** Tile index containing a world position (tiles are centred on multiples of the tile pitch). */
export function gridTileOf(domain, position)
{
    return [0, 1, 2].map((axis) => Math.floor(position[axis] / (domain.TileCells[axis] * domain.CellSize) + 0.5));
}

export function createDomain(overrides = {})
{
    const size = [...(overrides.Size || [3, 6, 3])];
    const maxCells = overrides.MaxCells || (overrides.Resolution ? Math.max(...overrides.Resolution) : 96);
    return resolveDomainGrid({
        Id: 'domain',
        Kind: 'Domain',
        Name: 'Gas Domain',
        Size: size,
        MaxCells: maxCells,
        Buoyancy: overrides.Buoyancy ?? 1.2,
        AmbientTemperature: overrides.AmbientTemperature ?? 0,
        Cooling: overrides.Cooling ?? 0.6,
        Vorticity: overrides.Vorticity ?? 0.35,
        Dissipation: overrides.Dissipation ?? 0.996,
        VelocityDissipation: overrides.VelocityDissipation ?? 0.999,
        Gravity: overrides.Gravity ?? 0.25,
        PressureIterations: overrides.PressureIterations ?? 36,
        Advection: overrides.Advection || 'MacCormack',
        Boundary: overrides.Boundary || 'OpenTop',
        TimeScale: overrides.TimeScale ?? 1.0,
        Combustion: overrides.Combustion ?? 1.0,
        Expansion: overrides.Expansion ?? 0.6,
        SceneLoop: overrides.SceneLoop ?? 0,
        Tiles: overrides.Tiles ? [...overrides.Tiles] : [1, 1, 1],
        Follow: overrides.Follow || 'None',
        FollowHeight: overrides.FollowHeight ?? false,
        GridOrigin: overrides.GridOrigin ? [...overrides.GridOrigin] : [0, 0, 0],
        Grid: overrides.Grid || 'Fixed',
        TileSize: overrides.TileSize ?? 2,
        TileResolution: overrides.TileResolution ?? 24,
        TilePool: overrides.TilePool ?? 48,
    });
}

export function createVisualizerSet()
{
    return {
        Volume: {
            Id: 'vis-volume', Kind: 'Visualizer', Name: 'Volume Render', Visible: true,
            Density: 1.0, Albedo: '#8e8f94', Absorption: 3.2, Anisotropy: 0.45, Ambient: '#3a414c', LightIntensity: 1.4, Exposure: 1.15,
            FireIntensity: 4.0, FireThreshold: 1.0, FireSoftness: 3.5, FireOpacity: 1.4, FireEmber: '#ff2a05', FireFlame: '#ff8a16', FireCore: '#fff3cf',
            FireLight: 1.0, Steps: 80, ShadowSteps: 8, Filter: 'Smooth',
        },
        VelocityVectors: { Id: 'vis-vectors', Kind: 'Visualizer', Name: 'Velocity Vectors', Visible: true, Axis: 'Z', Offset: 0.5, Stride: 2, Scale: 0.35, Ramp: 'Turbo', MaxSpeed: 6 },
        ScalarSlice: { Id: 'vis-slice', Kind: 'Visualizer', Name: 'Scalar Slice', Visible: false, Axis: 'Y', Offset: 0.35, Channel: 'Speed', Ramp: 'Turbo', Range: 6, Opacity: 0.85 },
        Tracers: { Id: 'vis-tracers', Kind: 'Visualizer', Name: 'Flow Tracers', Visible: false, Count: 8192, Lifetime: 4.0, Ramp: 'Turbo', MaxSpeed: 6, Size: 2.0 },
        Debris: { Id: 'vis-debris', Kind: 'Visualizer', Name: 'Debris', Visible: false, Count: 2048, Lifetime: 5.0, Size: 3.0, Gravity: 9.8, Drag: 1.2, Bounce: 0.35, Glow: 1.0 },
        ForceVectors: { Id: 'vis-forces', Kind: 'Visualizer', Name: 'Force Vectors', Visible: false, Mode: 'Slice', Axis: 'Z', Offset: 0.5, Stride: 3, Scale: 0.04, Ramp: 'Plasma', MaxForce: 20 },
        ForceGizmos: { Id: 'vis-gizmos', Kind: 'Visualizer', Name: 'Force Gizmos', Visible: false, Opacity: 0.9 },
    };
}
