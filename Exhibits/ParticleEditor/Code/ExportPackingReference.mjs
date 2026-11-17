/*==========================================================================================================================================
                                                        EXPORTPACKINGREFERENCE.MJS
==========================================================================================================================================*/
// 🧩 The approved Particle editor prototype's GPU payloads, written as TOML for ParticleLibraryValidation: every preset's effect
//    uniform, the light-fibre uniforms and path tables, the refresh constants, the wind components, the acceleration fields,
//    the lensing block and the eos force taxonomy's readings.
//
//     node Exhibits/ParticleEditor/Code/ExportPackingReference.mjs
//
// 📝 The packing functions are the prototype's own: the eos engine (Experimental/ParticleEditor/Engine, unchanged) and the
//    matrix, field and lensing functions sliced out of Experimental/ParticleEditor/ParticleEditor.js and evaluated here. Only
//    the refresh-constant block is written out below, because the prototype builds it inline in Advance(); it is copied from
//    there line for line.
// 📝 Float32 payloads are written with 9 significant digits, which names one float exactly; the taxonomy's doubles with 17.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const Root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EngineFolder = join(Root, 'Experimental/ParticleEditor/Engine');
const { PE } = await import(pathToFileURL(join(EngineFolder, 'pe.js')).href);
await import(pathToFileURL(join(EngineFolder, 'fibres.js')).href);
await import(pathToFileURL(join(EngineFolder, 'forcefields.js')).href);
await import(pathToFileURL(join(EngineFolder, 'presets.js')).href);
await import(pathToFileURL(join(EngineFolder, 'engine.js')).href);
await import(pathToFileURL(join(EngineFolder, 'lightning.js')).href);

//------------------------------------------------------------------------------------------------------------------------
//                                                    PROTOTYPE FUNCTIONS
//------------------------------------------------------------------------------------------------------------------------

const EditorSource = readFileSync(join(Root, 'Experimental/ParticleEditor/ParticleEditor.js'), 'utf8');
const Slice = (From, To) =>
{
    const Start = EditorSource.indexOf(From), End = EditorSource.indexOf(To, Start + From.length);
    if (Start < 0 || End < 0) throw new Error(`ParticleEditor.js no longer holds ${From}`);
    return EditorSource.slice(Start, End);
};
const Scene = { Effects: [], Forces: [], Time: 0, Camera: null };
const Prototype = new Function('PE', 'Scene', [
    Slice('const Dot3 =', 'const FormatInteger'),
    Slice('function MultiplyProjection', '//-----'),
    Slice('function ResolveCamera', '// 📝 eos buildLines'),
    Slice('function PackFields', '// 📝 eos packLens'),
    Slice('function PackLens', '//-----'),
    'return { ResolveCamera, PackFields, PackLens };',
].join('\n'))(PE, Scene);

//------------------------------------------------------------------------------------------------------------------------
//                                                    TOML TEXT
//------------------------------------------------------------------------------------------------------------------------

const Single = Reading => (Object.is(Reading, -0) ? '-0.0' : Number.isInteger(Reading) ? Reading.toFixed(1)
                                                                                            : Number(Reading).toPrecision(9));
const Double = Reading => (Number.isInteger(Reading) ? Reading.toFixed(1) : Number(Reading).toPrecision(17));
const Singles = Values => `[${Array.from(Values, Single).join(', ')}]`;
const Doubles = Values => `[${Array.from(Values, Double).join(', ')}]`;
const Text = Reading => `"${String(Reading).replaceAll('"', '\\"')}"`;
const Lines = [
    '#===========================================================================================================================================',
    '#                                                          PACKINGREFERENCE.TOML',
    '#===========================================================================================================================================',
    '# 🧩 The Particle editor prototype\'s GPU payloads for ParticleLibraryValidation.',
    '# 📝 Written by Exhibits/ParticleEditor/Code/ExportPackingReference.mjs; regenerate it rather than editing it.',
];

//------------------------------------------------------------------------------------------------------------------------
//                                                    REFRESH INPUTS
//------------------------------------------------------------------------------------------------------------------------

// 📝 One refresh, held fixed: 12.5 s in, step 750 at 60 Hz, 37 particles released at head 5, a 960 × 540 view.
const Refresh = { Time: 12.5, Delta: 1 / 60, Step: 750, Release: 37, Head: 5, Width: 960, Height: 540, Flash: 0.25 };
Lines.push('', '[refresh]', `time_seconds = ${Double(Refresh.Time)}`, `delta_seconds = ${Double(Refresh.Delta)}`,
           `step = ${Refresh.Step}`, `release_count = ${Refresh.Release}`, `head = ${Refresh.Head}`,
           `view_width = ${Refresh.Width}`, `view_height = ${Refresh.Height}`, `lightning_flash = ${Double(Refresh.Flash)}`);

//------------------------------------------------------------------------------------------------------------------------
//                                                    EFFECT UNIFORMS
//------------------------------------------------------------------------------------------------------------------------

// 📝 As Advance() fills each job: the molecular kinds take the lattice dimension and cell size from their box and σ.
PE.Presets.forEach((Preset, Index) =>
{
    const P = JSON.parse(JSON.stringify(Preset.p));
    const Number_ = Index + 1;
    const Capacity = Math.max(64, Math.floor(P.capacity));
    Lines.push('', '[[effect]]', `identifier = ${Text(Preset.id)}`, `number = ${Number_}`, `capacity = ${Capacity}`);
    if (P.kind === 7)
    {
        const Packed = new Float32Array(128);
        const Fibre = P.fibre;
        PE.fillFibre(Packed, P, { lf: (Refresh.Time / Fibre.loopSeconds) % 1, projScale: (0.5 * Refresh.Height) / Math.tan(Math.PI / 8),
                                  viewW: Refresh.Width, viewH: Refresh.Height });
        Lines.push(`fibre_uniform = ${Singles(Packed)}`);
        return;
    }
    const Molecular = P.kind === 3 || P.kind === 4;
    const Half = P.boxHalf[0];
    const Cutoff = 2.5 * P.sigma;
    const Clamp = (Reading, Lower, Upper) => Math.min(Upper, Math.max(Lower, Reading));
    const GridDimension = Molecular ? Clamp(Math.floor((2 * Half) / Cutoff), 1, PE.MAX_GD) : 1;
    const Steps = Molecular ? Clamp(Math.round(Refresh.Delta / P.simDt), 1, 8) : 0;
    const StepDelta = Molecular ? Math.min(Refresh.Delta / Steps, P.simDt * 1.25) : Refresh.Delta;
    const Packed = new Float32Array(64);
    PE.fillSys(Packed, P, { origin: P.origin, dt: StepDelta, time: Refresh.Time, frame: Refresh.Step, cap: Capacity,
                            emitN: Refresh.Release, head: Refresh.Head, seed: (Refresh.Step * 7919 + Number_ * 104729) >>> 0,
                            mol: Molecular, gd: GridDimension, cellSize: Molecular ? (2 * Half) / GridDimension : 1 });
    Lines.push(`grid_dimension = ${GridDimension}`, `molecular_steps = ${Steps}`, `uniform = ${Singles(Packed)}`);
});

//------------------------------------------------------------------------------------------------------------------------
//                                                    FIBRE PATHS
//------------------------------------------------------------------------------------------------------------------------

for (const Shape of PE.FIBRE_PATHS)
{
    const Path = PE.samplePath(Shape, 5, PE.PATH_SAMPLES);
    const Planar = [];
    for (let Sample = 0; Sample < PE.PATH_SAMPLES; Sample++) Planar.push(Path[Sample * 4], Path[Sample * 4 + 1]);
    Lines.push('', '[[fibre_path]]', `shape = ${Text(Shape)}`, 'size_metres = 5.0', `samples = ${PE.PATH_SAMPLES}`,
               `planar = ${Singles(Float32Array.from(Planar))}`);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SCENE PAYLOADS
//------------------------------------------------------------------------------------------------------------------------

// 📝 A force list holding every eos kind once at least, with windows that are open, closed and repeating at the sample time.
const F = PE.Forces;
const Forces = F.DefaultForces();
const Add = (Id, Changes) => Forces.push({ ...F.BaseField(Id), ...Changes });
Add('attract', { Name: 'Drain', Centre: [1, 1.5, -1], Radius: 3, Strength: 6, Swirl: 2.5, Swallow: 0.2 });
Add('repel', { Name: 'Push', Centre: [-2, 1, 2], Radius: 2.5, Strength: 4, Fades: F.Falloff.Linear });
Add('lift', { Name: 'Updraft', Centre: [3, 0, 3], Radius: 2, Strength: 3, Begins: 2, Lasts: 4 });
Add('magnetic', { Name: 'Coil', Centre: [0, 2, 0], Radius: 4, Strength: 2, Swirl: 0.7, Begins: 1, Lasts: 1, Repeats: 3 });
Add('gravity', { Name: 'Gravity', Strength: 9.81 });
Add('orbit', { Name: 'Orbit', Centre: [2, 1, -3], Radius: 3.5, Strength: 1.5, Fades: F.Falloff.InverseSquare });
Add('drag', { Name: 'Water', Centre: [0, 0.5, 0], Radius: 3, Strength: 1.2, Fades: F.Falloff.None });
Add('current', { Name: 'Stream', Centre: [-3, 0.5, 1], Radius: 2, Strength: 2, Direction: F.Along(30) });
Add('lift', { Name: 'Late lift', Centre: [0, 0, 0], Radius: 2, Strength: 3, Begins: 20 });
Add('gust', { Name: 'Second gust', Centre: [2, 0, 2], Radius: 3, Strength: 4, Rate: 0.5, Direction: F.Along(200) });
const SceneTime = 3.0;
Scene.Forces = Forces;
Scene.Time = SceneTime;
Scene.Effects = ['black-hole', 'magnetic-particles', 'heat-shimmer'].map((Id, Index) =>
    ({ Token: 'fx_' + (Index + 1), P: JSON.parse(JSON.stringify(PE.presetById(Id).p)) }));
Scene.Camera = { Yaw: 0.6, Pitch: 0.3, Distance: 12.5, Target: [0, 1.6, 0] };
const Aspect = Refresh.Width / Refresh.Height;
const Camera = Prototype.ResolveCamera(Aspect);

// 📝 The refresh constants, copied from ParticleEditor.js Advance() (the 52-float glob).
const Wind = Object.assign(PE.defaultWind(), { showArrows: false });
const Domain = { Minimum: PE.WIND.min, Size: PE.WIND.size, Dimensions: PE.WIND.dim };
const Global = new Float32Array(52);
const Offsets = PE.GLOB_OFF;
Global.set(Camera.ViewProjection, Offsets.viewProj);
Global.set([Camera.Right[0], Camera.Right[1], Camera.Right[2], 0], Offsets.camRight);
Global.set([Camera.Up[0], Camera.Up[1], Camera.Up[2], 0], Offsets.camUp);
Global.set([Camera.Eye[0], Camera.Eye[1], Camera.Eye[2], 1], Offsets.camPos);
Global.set([Domain.Minimum[0], Domain.Minimum[1], Domain.Minimum[2], 0], Offsets.windMin);
Global.set([Domain.Size[0], Domain.Size[1], Domain.Size[2], 0], Offsets.windSize);
const Flow = F.ForGpu(Forces).Lattice;
Global.set([Domain.Dimensions[0], Domain.Dimensions[1], Domain.Dimensions[2], Flow.length], Offsets.windDim);
Global.set([Refresh.Time, Refresh.Delta, Refresh.Step, Wind.windScale], Offsets.timing);
Global.set([Wind.arrowRef, 0.012, Refresh.Flash, Wind.turbulence], Offsets.viz);
Global.set([Wind.swirl, 0.45, 0.22, Wind.arrowStride || 3], Offsets.swirl);
const Components = new Float32Array(PE.WIND.maxComps * 8);
Flow.slice(0, PE.WIND.maxComps).forEach((Component, Index) =>
{
    Components.set([Component.x, Component.z, Math.max(0.5, Component.radius), Component.type, Component.strength,
                    (Component.bearing * Math.PI) / 180, Component.freq, Component.enabled ? 1 : 0], Index * 8);
});
const Lens = Prototype.PackLens(Camera, Aspect);
Lines.push('', '[scene]', `time_seconds = ${Double(SceneTime)}`, `aspect = ${Double(Aspect)}`,
           `camera = ${Doubles([0.6, 0.3, 12.5, 0, 1.6, 0])}`, `flow_count = ${Flow.length}`,
           `refresh_constants = ${Singles(Global)}`, `wind_components = ${Singles(Components)}`,
           `acceleration_fields = ${Singles(Prototype.PackFields())}`, `lensing_count = ${Lens.Count}`,
           `shimmer_count = ${Lens.ShimmerCount}`, `lensing = ${Singles(Lens.Packed)}`);

//------------------------------------------------------------------------------------------------------------------------
//                                                    TAXONOMY READINGS
//------------------------------------------------------------------------------------------------------------------------

// 📝 The same force list as authored records, then its readings: each field alone, the resolved sum per receiver channel set,
//    and one advance step, at points inside, on the edge of and outside the fields, at three times.
for (const Field of Forces)
{
    Lines.push('', '[[force]]', `category = ${Text(Field.Kind)}`, `name = ${Text(Field.Name)}`, `enabled = ${Field.Enabled}`,
               `centre_metres = ${Doubles(Field.Centre)}`, `direction = ${Doubles(Field.Direction)}`,
               `strength = ${Double(Field.Strength)}`, `radius_metres = ${Double(Field.Radius)}`, `reach = ${Text(Field.Reaches)}`,
               `falloff = ${Text(Field.Fades.replaceAll('-', '_'))}`, `swirl = ${Double(Field.Swirl)}`, `rate_hz = ${Double(Field.Rate)}`,
               `swallow_metres = ${Double(Field.Swallow)}`, `acts_on = [${Field.Acts.map(Text).join(', ')}]`,
               `begins_seconds = ${Double(Field.Begins)}`, `lasts_seconds = ${Double(Field.Lasts)}`,
               `repeats_seconds = ${Double(Field.Repeats)}`);
}
Forces[6].Acts = ['debris'];
Forces[11].Acts = ['leaves', 'debris'];
Lines.push('', '# 📝 Before the readings, field 7 acts on "debris" only and field 12 on "leaves" and "debris".');
const Points = [[0, 0, 0], [1, 1.5, -1], [1.1, 1.6, -0.8], [2.9, 1.5, -1], [-2, 1, 2], [-1, 1.2, 1.4], [3, 0.4, 3], [3.8, 1, 3.6],
                [0, 2, 0], [0, 2.5, 3.9], [2, 1, -3], [4.5, 1, -3], [0, 0.5, 0], [2.2, 1.4, 1.9], [-3, 0.5, 1], [-1.5, 0.8, 0.9],
                [-4, 0.2, 0], [-6, 3, -6], [5.9, 7.5, 5.9], [2, 0, 2], [0.5, 4, -0.5], [-2, 0.3, -4], [0, 0, -2], [1.7, 1.1, -1.2]];
const Times = [0.5, 3.0, 7.25];
const ChannelSets = [[], ['debris'], ['leaves']];
for (const Time of Times)
{
    for (const At of Points)
    {
        const Single_ = Forces.map(Field => F.SampleField(Field, At, Time)).flat();
        Lines.push('', '[[reading]]', `time_seconds = ${Double(Time)}`, `at_metres = ${Doubles(At)}`, `each = ${Doubles(Single_)}`);
        ChannelSets.forEach((Channels, Index) =>
        {
            const Acting = F.Resolve(Forces, At, Time, Channels);
            const Next = F.Advance([0.5, -1, 0.25], Acting, 2.5, 1 / 60);
            Lines.push(`resolved_${Index} = ${Doubles([...Acting.Flow, Acting.Flowing ? 1 : 0, ...Acting.Accelerate, Acting.Damp])}`,
                       `advanced_${Index} = ${Doubles(Next)}`);
        });
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    LIGHTNING
//------------------------------------------------------------------------------------------------------------------------

// 📝 The seeded bolts: two strikes, a web between four points, the automatic strike due at 1.5 s, then the packed segments.
{
    const Lightning = new PE.Lightning();
    const First = Lightning.strike(0.5);
    const Second = Lightning.strike(1.0);
    const Links = Lightning.web(1.2, [[0, 1, 0], [3, 1, -2], [-2, 2, 1], [1, 3, 3]], { k: 2, life: 0.5 });
    const Hits = Lightning.update(1 / 60, 1.6);
    const Count = Lightning.pack(1.65);
    Lines.push('', '[lightning]', `first_strike = ${Doubles(First)}`, `second_strike = ${Doubles(Second)}`, `web_links = ${Links}`,
               `automatic_strike = ${Doubles(Hits[0] || [0, 0, 0])}`, `next_strike_seconds = ${Double(Lightning.nextAt)}`,
               `flash = ${Double(Lightning.flash)}`, `bolt_segments = [${Lightning.bolts.map(Bolt => Bolt.segs.length).join(', ')}]`,
               `bolt_seeds = ${Doubles(Lightning.bolts.map(Bolt => Bolt.seed))}`, `segment_count = ${Count}`,
               `segments = ${Singles(Lightning.dataBuf.subarray(0, Count * 8))}`);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    HYPOT
//------------------------------------------------------------------------------------------------------------------------

// 📝 Math.hypot as V8 computes it, for ResolveCompensatedHypotenuse: two and three arguments over many magnitudes.
let Seed = 20261104;
const Random = () => ((Seed = (Seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const Arguments = [], Hypotenuses = [];
for (let Index = 0; Index < 96; Index++)
{
    const Magnitude = 10 ** (Math.floor(Random() * 12) - 6);
    const Values = [0, 1, 2].map(() => (Random() - 0.5) * Magnitude);
    if (Index % 3 === 0) Values[2] = 0;
    Arguments.push(...Values);
    Hypotenuses.push(Index % 3 === 0 ? Math.hypot(Values[0], Values[1]) : Math.hypot(...Values));
}
Lines.push('', '# 📝 Every third triple is a two-argument hypot of its first two values.', '[hypot]',
           `arguments = ${Doubles(Arguments)}`, `results = ${Doubles(Hypotenuses)}`);

const Output = join(Root, 'Exhibits/ParticleEditor/Results/PackingReference.toml');
mkdirSync(dirname(Output), { recursive: true });
writeFileSync(Output, Lines.join('\n') + '\n', 'utf8');
console.log(`PackingReference.toml: ${PE.Presets.length} effects, ${PE.FIBRE_PATHS.length} fibre paths, ${Forces.length} forces, `
            + `${Times.length * Points.length} readings`);
