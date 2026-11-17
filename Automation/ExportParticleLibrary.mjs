/*==========================================================================================================================================
                                                        EXPORTPARTICLELIBRARY.MJS
==========================================================================================================================================*/
// 🧩 The Particle editor's preset library as engine content: every eos preset, the default wind and the default force list,
//    written as TOML for ParticleEffectLibrary (Frontier/Engine/PhysicalDynamics/ParticleDynamics/).
//
//     node Automation/ExportParticleLibrary.mjs [output file]
//
// 📝 The source is the eos engine kept unchanged in Experimental/ParticleEditor/Engine/ (eos 549c477). Numbers are written with
//    JavaScript's shortest round-trip form, so the C++ decoder reads back the same doubles the prototype holds; the sRGB hex
//    colours are already linear here (PE.hexLinear), so C++ never repeats that conversion.
// 📝 Renamed for the engine's vocabulary: behaviour, appearance, release, lensing, event radius, launch distance and hold
//    minimum stand for the eos kind, shape, emit, blackHole, horizon, shell and holdBase.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const Root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EngineFolder = join(Root, 'Experimental/ParticleEditor/Engine');
const { PE } = await import(pathToFileURL(join(EngineFolder, 'pe.js')).href);
await import(pathToFileURL(join(EngineFolder, 'fibres.js')).href);
await import(pathToFileURL(join(EngineFolder, 'forcefields.js')).href);
await import(pathToFileURL(join(EngineFolder, 'presets.js')).href);

//------------------------------------------------------------------------------------------------------------------------
//                                                    VOCABULARY
//------------------------------------------------------------------------------------------------------------------------

const Behaviours    = { 0: 'ballistic', 1: 'wind_driven', 3: 'lennard_jones', 4: 'reactive', 5: 'visual_effect', 6: 'flocking',
                        7: 'light_fibre' };
const Appearances   = ['streak', 'sphere', 'leaf', 'soft_glow', 'cube', 'coin', 'bubble'];
const ReleaseShapes = ['point', 'sphere', 'disc', 'box', 'cube_surface'];
const LeafSurfaces  = ['leaf', 'paper'];
const Blends        = { add: 'additive', alpha: 'alpha_over' };
const FlowLattice   = ['prevailing', 'gust', 'tornado', 'outflow'];
const Integers      = new Set(['capacity', 'burstCount', 'strands', 'segments', 'seed']);

//------------------------------------------------------------------------------------------------------------------------
//                                                    TOML TEXT
//------------------------------------------------------------------------------------------------------------------------

const Text = Reading => `"${String(Reading).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}"`;

function Figure(Reading, Key)
{
    if (!Number.isFinite(Reading)) throw new Error(`Non-finite number for ${Key}`);
    if (Integers.has(Key))
    {
        if (!Number.isInteger(Reading)) throw new Error(`${Key} must be an integer, found ${Reading}`);
        return String(Reading);
    }
    const Shortest = String(Reading);
    return /[.eE]/.test(Shortest) ? Shortest : Shortest + '.0';
}

const Vector = (Values, Key) => `[${Array.from(Values, One => Figure(One, Key)).join(', ')}]`;

function Line(Lines, Key, Reading, SourceKey)
{
    if (Reading === undefined) return;
    if (typeof Reading === 'boolean') Lines.push(`${Key} = ${Reading}`);
    else if (typeof Reading === 'string') Lines.push(`${Key} = ${Text(Reading)}`);
    else if (Array.isArray(Reading)) Lines.push(`${Key} = ${Vector(Reading, SourceKey || Key)}`);
    else Lines.push(`${Key} = ${Figure(Reading, SourceKey || Key)}`);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SECTIONS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Every base parameter, in presets.js order, with its TOML key. A preset carries all of them (P() merges the defaults).
const ParameterKeys = [
    ['capacity', 'capacity'], ['rate', 'release_rate'], ['origin', 'origin_metres'], ['radius', 'radius_metres'],
    ['boxHalf', 'box_half_metres'], ['dir', 'direction'], ['spread', 'spread_radians'], ['speedMin', 'speed_minimum_mps'],
    ['speedMax', 'speed_maximum_mps'], ['drag', 'drag'], ['gravity', 'gravity'], ['lifeMin', 'life_minimum_seconds'],
    ['lifeMax', 'life_maximum_seconds'], ['sizeStart', 'size_start_metres'], ['sizeEnd', 'size_end_metres'],
    ['sizeScale', 'size_scale'], ['colA', 'colour_a'], ['colB', 'colour_b'], ['colC', 'colour_c'],
    ['windCoupling', 'wind_coupling'], ['bounce', 'bounce'], ['buoyancy', 'buoyancy'], ['flutter', 'flutter'],
    ['temperature', 'temperature'], ['epsilon', 'epsilon'], ['sigma', 'sigma'], ['damping', 'damping'],
    ['reactRate', 'react_rate'], ['dissociation', 'dissociation'], ['reactRadius', 'react_radius'], ['fracA', 'fraction_a'],
    ['simDt', 'integration_step_seconds'], ['pulseHz', 'pulse_hz'], ['pulseDepth', 'pulse_depth'],
    ['swarmRadius', 'swarm_radius_metres'], ['burstEvery', 'burst_every_seconds'], ['burstCount', 'burst_count'],
    ['burstAtOrigin', 'burst_at_origin'], ['visible', 'visible'],
];
const Enumerated = new Set(['kind', 'shape', 'leafMode', 'blend', 'emitShape']);
const Nested     = new Set(['fibre', 'transition', 'attractor', 'blackHole', 'heatShimmer', 'magneticField']);

const FibreKeys = [
    ['shape', 'shape'], ['strands', 'strands'], ['segments', 'segments'], ['seed', 'seed'], ['loopSeconds', 'loop_seconds'],
    ['scale', 'scale'], ['length', 'length_metres'], ['spread', 'spread_metres'], ['amplitude', 'amplitude_metres'],
    ['frequency', 'frequency'], ['sheetWidth', 'sheet_width_metres'], ['ripple', 'ripple'], ['waves', 'waves'],
    ['phaseSpread', 'phase_spread'], ['trailLength', 'trail_length'], ['pathShape', 'path_shape'],
    ['pathSize', 'path_size_metres'], ['harmonic', 'harmonic'], ['windowCycles', 'window_cycles'], ['window', 'window'],
    ['thickness', 'thickness'], ['taper', 'taper'], ['intensity', 'intensity'], ['halo', 'halo'], ['baseline', 'baseline'],
    ['colourMode', 'colour_mode'], ['colC', 'accent_colour'], ['accentMix', 'accent_mix'], ['sparks', 'sparks'],
    ['sparkSize', 'spark_size'], ['sparkBrightness', 'spark_brightness'], ['pulseRate', 'pulse_rate'],
    ['pulseDepth', 'pulse_depth'], ['pulseShape', 'pulse_shape'],
];
const TransitionKeys = [
    ['holdBase', 'hold_minimum_seconds'], ['holdSpread', 'hold_spread_seconds'], ['burstShare', 'burst_share'],
    ['fragment', 'fragment'], ['childLife', 'fragment_life_seconds'], ['wave', 'wave'], ['assemble', 'assemble'],
    ['shell', 'launch_distance_metres'], ['after', 'after'],
];
const AttractorKeys = [['enabled', 'enabled'], ['strength', 'strength'], ['radius', 'radius_metres'], ['swirl', 'swirl'],
                       ['swallow', 'swallow_metres']];
const LensingKeys   = [['horizon', 'event_radius_metres'], ['einstein', 'einstein_ratio']];
const ShimmerKeys   = [['radius', 'radius_metres'], ['strength', 'strength'], ['freq', 'frequency'], ['rate', 'rate']];
const DipoleKeys    = [['strength', 'strength'], ['guide', 'guide'], ['radius', 'radius_metres']];

function Section(Lines, Header, Source, Keys, Known)
{
    if (!Source) return;
    const Seen = new Set(Keys.map(([Key]) => Key));
    for (const Key of Object.keys(Source))
        if (!Seen.has(Key) && !(Known && Known.has(Key))) throw new Error(`${Header}: unexported key ${Key}`);
    Lines.push('', `[${Header}]`);
    for (const [Key, TomlKey] of Keys) Line(Lines, TomlKey, Source[Key], Key);
}

function ExportPreset(Lines, Preset)
{
    const P = Preset.p;
    if (!(P.kind in Behaviours)) throw new Error(`${Preset.id}: unknown kind ${P.kind}`);
    Lines.push('', '[[preset]]');
    Line(Lines, 'identifier', Preset.id);
    Line(Lines, 'name', Preset.name);
    Line(Lines, 'group', Preset.group);
    Line(Lines, 'blurb', Preset.blurb);
    Line(Lines, 'behaviour', Behaviours[P.kind]);
    Line(Lines, 'appearance', Appearances[P.shape]);
    Line(Lines, 'leaf_surface', LeafSurfaces[P.leafMode]);
    Line(Lines, 'blend', Blends[P.blend]);
    Line(Lines, 'release_shape', ReleaseShapes[P.emitShape]);
    const Known = new Set(ParameterKeys.map(([Key]) => Key));
    for (const Key of Object.keys(P))
        if (!Known.has(Key) && !Enumerated.has(Key) && !Nested.has(Key)) throw new Error(`${Preset.id}: unexported key ${Key}`);
    for (const [Key, TomlKey] of ParameterKeys) Line(Lines, TomlKey, P[Key], Key);
    if (Preset.windLink)
    {
        const Link = Preset.windLink, Changes = Link.set || {};
        Lines.push('', '[preset.wind_link]');
        Line(Lines, 'category', FlowLattice[Link.type]);
        Line(Lines, 'name', Link.name);
        Line(Lines, 'local', !!Link.local);
        Line(Lines, 'radius_metres', Changes.radius);
        Line(Lines, 'strength', Changes.strength);
        Line(Lines, 'bearing_degrees', Changes.bearing);
        Line(Lines, 'rate_hz', Changes.freq);
    }
    Section(Lines, 'preset.transition', P.transition, TransitionKeys);
    Section(Lines, 'preset.attractor', P.attractor, AttractorKeys);
    Section(Lines, 'preset.lensing', P.blackHole, LensingKeys);
    Section(Lines, 'preset.heat_shimmer', P.heatShimmer, ShimmerKeys);
    Section(Lines, 'preset.magnetic_dipole', P.magneticField, DipoleKeys);
    if (P.fibre)
    {
        Section(Lines, 'preset.light_fibre', P.fibre, FibreKeys, new Set(['stops']));
        for (const Stop of P.fibre.stops || [])
        {
            Lines.push('', '[[preset.light_fibre.stop]]');
            Line(Lines, 'position', Stop.pos);
            Line(Lines, 'colour', Stop.col);
        }
    }
}

function ExportForce(Lines, Field)
{
    Lines.push('', '[[force]]');
    Line(Lines, 'category', Field.Kind);
    Line(Lines, 'name', Field.Name);
    Line(Lines, 'enabled', Field.Enabled);
    Line(Lines, 'centre_metres', Field.Centre);
    Line(Lines, 'direction', Field.Direction);
    Line(Lines, 'strength', Field.Strength);
    Line(Lines, 'radius_metres', Field.Radius);
    Line(Lines, 'reach', Field.Reaches);
    Line(Lines, 'falloff', Field.Fades.replaceAll('-', '_'));
    Line(Lines, 'swirl', Field.Swirl);
    Line(Lines, 'rate_hz', Field.Rate);
    Line(Lines, 'swallow_metres', Field.Swallow);
    Lines.push(`acts_on = [${Field.Acts.map(Text).join(', ')}]`);
    Line(Lines, 'begins_seconds', Field.Begins);
    Line(Lines, 'lasts_seconds', Field.Lasts);
    Line(Lines, 'repeats_seconds', Field.Repeats);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    MAIN
//------------------------------------------------------------------------------------------------------------------------

const Output = process.argv[2] || join(Root, 'EngineContent/ParticleArchives/ParticleLibrary.particlespace');
const Digest = Name => createHash('sha256').update(readFileSync(join(EngineFolder, Name))).digest('hex');
const Groups = [...new Set(PE.Presets.map(Preset => Preset.group))];
const Wind = PE.defaultWind();
const Lines = [
    '#===========================================================================================================================================',
    '#                                                       PARTICLELIBRARY.PARTICLESPACE',
    '#===========================================================================================================================================',
    '# 🧩 The Particle editor\'s preset library: the eos presets, the default wind and the default force list.',
    '# 📝 Generated by Automation/ExportParticleLibrary.mjs from Experimental/ParticleEditor/Engine (eos 549c477); regenerate it',
    '#    rather than editing it. Lengths in metres, speeds in m/s, times in seconds, colours linear RGBA.',
    '',
    'format = "frontier.particlelibrary"',
    'version = 1',
    '',
    '[library]',
    `source = ${Text('eosclient0001-rgb/Frontier arena/24b8f4ad-frontier 549c477454b0f93b23f0e295ee4b2f0d6e688ed1')}`,
    `presets_sha256 = ${Text(Digest('presets.js'))}`,
    `fibres_sha256 = ${Text(Digest('fibres.js'))}`,
    `forces_sha256 = ${Text(Digest('forcefields.js'))}`,
    `preset_count = ${PE.Presets.length}`,
    `groups = [${Groups.map(Text).join(', ')}]`,
    `default_scene = [${PE.defaultScene.map(Text).join(', ')}]`,
    '',
    '# 📝 The prototype opens with the lattice arrows off; its field overlay replaces them.',
    '[wind]',
];
Line(Lines, 'wind_scale', Wind.windScale);
Line(Lines, 'turbulence', Wind.turbulence);
Line(Lines, 'arrow_reference_mps', Wind.arrowRef);
Line(Lines, 'arrow_stride', Wind.arrowStride);
Line(Lines, 'show_arrows', false);
Line(Lines, 'show_floor', Wind.showFloor);
Line(Lines, 'show_domain', Wind.showDomain);
Line(Lines, 'swirl', Wind.swirl);
for (const Field of PE.Forces.DefaultForces()) ExportForce(Lines, Field);
for (const Preset of PE.Presets) ExportPreset(Lines, Preset);
const Document = Lines.join('\n') + '\n';
mkdirSync(dirname(Output), { recursive: true });
writeFileSync(Output, Document, 'utf8');
console.log(`${relative(Root, Output)}: ${PE.Presets.length} presets in ${Groups.length} groups, ${Document.length} bytes`);
