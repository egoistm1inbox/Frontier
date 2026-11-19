// FILAMENT.JS
// 🧩 Particle showroom: the ControlVehicle on a dark stage with ten GPU particle looks seen on new cars' screens and
//    in motion-graphics tools: light-speed streaks, a dust "digital twin" that assembles the car, wind-tunnel airflow,
//    Particular-style emitters, a MoGraph clone field, a charging flow, and (from reference stills) light threads
//    orbiting a glass sphere, particle flowers with bokeh, a vehicle transition and a fibre-optic wave. Orbit the camera, tune count, speed,
//    trail, size, glow, turbulence and palette, and switch how the car body shows.
// 📝 URL options (for captures): ?look=Airflow&time=6&palette=Ice&variant=1&car=Ghost&count=80000&aperture=0.1&still=1&ui=0&capture=1

import { THREE, AssembleVehicle, DefaultFinish, PanelEnvironment, Family } from '../Shared/VehicleAssembly.js';
import { ScatterSurface, SilhouetteProfile, Seeded } from './SurfaceScatter.js';
import { Prelude, Projection, Fragment, Looks, Palettes } from './FilamentLooks.js';
import { BloomChain } from './BloomChain.js';
import { SweepJag } from './FilamentFibres.js';

const Query = new URLSearchParams(location.search);
const MaxCount = 160000;
const Radian = Math.PI / 180;

//------------------------------------------------------------------------------------------------------------------------
//                                                    RENDERER AND STAGE
//------------------------------------------------------------------------------------------------------------------------

const Canvas = document.getElementById('Scene');
const Capture = Query.get('capture') === '1';                       // headless captures: no animation loop, one frame per Seek
const Renderer = new THREE.WebGLRenderer({ canvas: Canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: Capture });
Renderer.setPixelRatio(Capture ? 1 : Math.min(window.devicePixelRatio, 1.5));
Renderer.toneMapping = THREE.NoToneMapping;
Renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
Renderer.setClearColor(0x010203, 1);
const Glow = new BloomChain(Renderer);

const Scene = new THREE.Scene();
const Camera = new THREE.PerspectiveCamera(36, 1, 0.1, 400);
Scene.environment = PanelEnvironment(Renderer, [
    { Colour: '#dfe9ff', Intensity: 1.3, Position: [0, 9, 0], Size: [14, 4], Facing: [0, 0, 0] },
    { Colour: '#6fb6ff', Intensity: 0.9, Position: [-10, 3, 6], Size: [6, 3] },
    { Colour: '#ffb07a', Intensity: 0.6, Position: [10, 2.5, -6], Size: [6, 2] },
], '#020305');
Scene.add(new THREE.HemisphereLight('#9fb8ff', '#000000', 0.5));
const KeyLight = new THREE.DirectionalLight('#ffffff', 1.6);
KeyLight.position.set(4, 9, 5);
const RimLight = new THREE.DirectionalLight('#8fd8ff', 1.4);
RimLight.position.set(-6, 3, -7);
Scene.add(KeyLight, RimLight);

// Backdrop: a gradient dome per look (black for the car looks, indigo, deep green or teal for the reference looks).
const DomeTop = new THREE.Color('#010203'), DomeBottom = new THREE.Color('#010203');
const Dome = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uTop: { value: DomeTop }, uBottom: { value: DomeBottom } },
    vertexShader: 'varying vec3 vDirection; void main() { vDirection = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uTop, uBottom; varying vec3 vDirection; void main() { gl_FragColor = vec4(mix(uBottom, uTop, smoothstep(-0.35, 0.55, vDirection.y)), 1.0); }',
}));
Dome.renderOrder = -10;
Scene.add(Dome);

// Glass sphere for the Orbits look: fresnel rim, one sharp highlight and faint feathered fibres inside. It writes depth,
// so the threads passing behind it disappear.
const GlobeCentre = new THREE.Vector3(0, 1.6, 0);
const Globe = new THREE.Mesh(new THREE.SphereGeometry(1.32, 96, 64), new THREE.ShaderMaterial({
    uniforms: { uFade: { value: 0 }, uRim: { value: new THREE.Color() }, uInner: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vNormal, vView, vSpot; void main() { vSpot = position; vec4 P = modelViewMatrix * vec4(position, 1.0); vView = -P.xyz; vNormal = normalMatrix * normal; gl_Position = projectionMatrix * P; }',
    fragmentShader: `uniform float uFade; uniform vec3 uRim, uInner; varying vec3 vNormal, vView, vSpot;
        void main()
        {
            vec3 N = normalize(vNormal), V = normalize(vView), D = normalize(vSpot);
            float Facing = clamp(dot(N, V), 0.0, 1.0), Fresnel = pow(1.0 - Facing, 3.0);
            float Spec = pow(max(dot(N, normalize(normalize(vec3(-0.4, 0.7, 0.6)) + V)), 0.0), 140.0);
            float Wisp = 0.5 + 0.5 * sin(D.y * 7.0 + D.z * 5.0) * sin(D.x * 6.0 - D.y * 4.0);
            float Feather = pow(0.5 + 0.5 * sin(atan(D.y - 0.15, D.x) * 46.0 + D.z * 9.0 + Wisp * 3.0), 18.0) * smoothstep(0.2, 0.95, Facing) * Wisp * 0.12;
            vec3 Colour = uInner * (0.035 + 0.06 * Facing + Feather) + uRim * Fresnel * 1.5 + vec3(Spec * 3.0);
            gl_FragColor = vec4(Colour * uFade, 1.0);
        }`,
}));
Globe.position.copy(GlobeCentre);
Globe.visible = false;
Scene.add(Globe);

//------------------------------------------------------------------------------------------------------------------------
//                                                    SETTINGS
//------------------------------------------------------------------------------------------------------------------------

const Settings = {
    Look: Math.max(0, Looks.findIndex((Each) => Each.Key === Query.get('look'))),
    Count: 60000, Speed: 1, Tail: 0.07, Size: 1, Glow: 1, Turbulence: 0.5, Aperture: 0, Palette: 'Ice', Car: 'Auto', Variant: 0,
    Orbit: Query.get('orbit') === '1', Paused: Query.get('still') === '1',
};

const Sliders = [
    { Key: 'Count',      Label: 'Particles',  Min: 5000, Max: MaxCount, Step: 5000, Show: (V) => `${Math.round(V / 1000)}k` },
    { Key: 'Speed',      Label: 'Speed',      Min: 0.1,  Max: 3,   Step: 0.05, Show: (V) => `${V.toFixed(2)}×` },
    { Key: 'Tail',       Label: 'Trail',      Min: 0,    Max: 0.4, Step: 0.01, Show: (V) => `${Math.round(V * 1000)} ms` },
    { Key: 'Size',       Label: 'Size',       Min: 0.3,  Max: 3,   Step: 0.05, Show: (V) => `${V.toFixed(2)}×` },
    { Key: 'Glow',       Label: 'Glow',       Min: 0,    Max: 3,   Step: 0.05, Show: (V) => `${V.toFixed(2)}` },
    { Key: 'Turbulence', Label: 'Turbulence', Min: 0,    Max: 2.5, Step: 0.05, Show: (V) => `${V.toFixed(2)}` },
    { Key: 'Aperture',   Label: 'Depth of field', Min: 0, Max: 0.3, Step: 0.01, Show: (V) => (V > 0 ? `${Math.round(V * 100)} cm lens` : 'Off') },
];
const CarModes = ['Auto', 'Paint', 'Ghost', 'Glass', 'Hidden'];

//------------------------------------------------------------------------------------------------------------------------
//                                                    CAR
//------------------------------------------------------------------------------------------------------------------------

const Vehicle = await AssembleVehicle({ Finish: DefaultFinish({ 6: { color: '#3a4049', metalness: 0.6, roughness: 0.3 }, 13: { emissiveIntensity: 1.1 }, 14: { emissiveIntensity: 1.2 } }) });
Scene.add(Vehicle.Root);
const GhostCoat = new THREE.MeshPhysicalMaterial({ color: '#020304', metalness: 1, roughness: 0.16, clearcoat: 1, transparent: true, opacity: 1 });
const GlassCoat = new THREE.MeshBasicMaterial({ color: '#0b1a26', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const Edges = new THREE.Group();
const EdgeLine = new THREE.LineBasicMaterial({ color: '#7ff3ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.3 });
Vehicle.Root.updateMatrixWorld(true);
Vehicle.Root.traverse((Mesh) =>
{
    if (!Mesh.isMesh) return;
    Mesh.userData.Painted = Mesh.material;
    Mesh.castShadow = false; Mesh.receiveShadow = false;
    const Lines = new THREE.LineSegments(new THREE.EdgesGeometry(Mesh.geometry, 28), EdgeLine);
    Lines.matrixAutoUpdate = false;
    Lines.matrix.copy(Mesh.matrixWorld);
    Edges.add(Lines);
});
Scene.add(Edges);

// Vehicle transition: every paint material is patched so the same jagged edge the particles use (SweepJag) clips the
// mesh (reveal / dissolve), swaps the body coat from one colour to the other (restyle) and glows where it crosses.
// uSweepMode 0 hidden · 1 visible behind the edge · 2 recolour behind the edge · 3 visible ahead of it · 4 untouched.
const Sweep = {
    uSweepFront: { value: 99 }, uSweepMode: { value: 4 }, uSweepClock: { value: 0 },
    uSweepFrom: { value: new THREE.Color('#3a4049').convertSRGBToLinear() }, uSweepTo: { value: new THREE.Color('#b8d032').convertSRGBToLinear() },
    uSweepSeam: { value: new THREE.Color() },
};
const SweepHeader = `uniform float uSweepFront, uSweepMode, uSweepClock, uSweepCoat; uniform vec3 uSweepFrom, uSweepTo, uSweepSeam; varying vec3 vSweepSpot;\n${SweepJag}\n`;
for (const [Key, Material] of Object.entries(Vehicle.Finish))
{
    const Coat = +Key === Family.BodyCoat ? 1 : 0;
    Material.onBeforeCompile = (Shader) =>
    {
        Object.assign(Shader.uniforms, Sweep, { uSweepCoat: { value: Coat } });
        Shader.vertexShader = 'varying vec3 vSweepSpot;\n' + Shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n    vSweepSpot = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        Shader.fragmentShader = SweepHeader + Shader.fragmentShader
            .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
    float SweepGap = vSweepSpot.x + SweepJag(vSweepSpot, uSweepClock) - uSweepFront;
    bool SweepDone = SweepGap > 0.0;
    if (uSweepMode < 0.5 || (uSweepMode < 1.5 && !SweepDone) || (uSweepMode > 2.5 && uSweepMode < 3.5 && SweepDone)) discard;`)
            .replace('#include <color_fragment>', `#include <color_fragment>
    if (uSweepCoat > 0.5 && uSweepMode < 3.5) diffuseColor.rgb = (uSweepMode > 2.5 || (uSweepMode > 1.5 && SweepDone)) ? uSweepTo : uSweepFrom;`)
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    if (uSweepMode > 0.5 && uSweepMode < 3.5) totalEmissiveRadiance += uSweepSeam * exp(-abs(SweepGap) * 26.0) * 5.0;`);
    };
    Material.customProgramCacheKey = () => `Sweep${Coat}`;
    Material.needsUpdate = true;
}

let ShownCar = '';
function DressCar(Mode)
{
    if (Mode === ShownCar) return;
    ShownCar = Mode;
    Vehicle.Root.visible = Mode !== 'Hidden';
    Edges.visible = Mode === 'Glass' || Mode === 'Ghost';
    EdgeLine.opacity = Mode === 'Glass' ? 0.32 : 0.08;
    Vehicle.Root.traverse((Mesh) =>
    {
        if (!Mesh.isMesh) return;
        Mesh.material = Mode === 'Paint' ? Mesh.userData.Painted : (Mode === 'Glass' ? GlassCoat : GhostCoat);
        Mesh.renderOrder = Mode === 'Glass' ? 2 : 0;
    });
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    PARTICLES
//------------------------------------------------------------------------------------------------------------------------

const Scatter = ScatterSurface(Vehicle, MaxCount, 11);
const Silhouette = SilhouetteProfile(Scatter);
const Geometry = new THREE.InstancedBufferGeometry();
Geometry.setIndex([0, 1, 2, 0, 2, 3]);
Geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
Geometry.setAttribute('aCorner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
const Random = Seeded(23), Seeds = new Float32Array(MaxCount * 4);
for (let Slot = 0; Slot < Seeds.length; Slot++) Seeds[Slot] = Random();
Geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(Seeds, 4));
Geometry.setAttribute('aAnchor', new THREE.InstancedBufferAttribute(Scatter.Positions, 3));
Geometry.setAttribute('aFacing', new THREE.InstancedBufferAttribute(Scatter.Normals, 3));
Geometry.setAttribute('aFamily', new THREE.InstancedBufferAttribute(Scatter.Families, 1));
Geometry.instanceCount = Settings.Count;

const Shared = {
    uClock: { value: 0 }, uSpeed: { value: 1 }, uTail: { value: 0.07 }, uSize: { value: 1 }, uTurbulence: { value: 0.5 },
    uSide: { value: 200 }, uVariant: { value: 0 }, uCount: { value: 60000 }, uAperture: { value: 0 }, uFocus: { value: 10 },
    uFront: { value: 99 }, uFrontSpeed: { value: 1 }, uSweepMode: { value: 0 },
    uMorph: { value: 0 }, uMorphRate: { value: 0 }, uRelease: { value: 0 }, uReleaseRate: { value: 0 }, uScan: { value: -1 }, uCharge: { value: 0 },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uTone0: { value: new THREE.Color() }, uTone1: { value: new THREE.Color() }, uTone2: { value: new THREE.Color() }, uTone3: { value: new THREE.Color() },
    uProfile: { value: Silhouette.Texture }, uProfileFrom: { value: Silhouette.From }, uProfileSpan: { value: Silhouette.Span },
    uCarMin: { value: Scatter.Min }, uCarMax: { value: Scatter.Max },
};
const Layers = Looks.map((Look) =>
{
    const Material = new THREE.ShaderMaterial({
        vertexShader: Prelude + Look.Track + Projection, fragmentShader: Fragment,
        uniforms: { ...Shared, uFade: { value: 0 } },
        transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    });
    const Mesh = new THREE.Mesh(Geometry, Material);
    Mesh.frustumCulled = false;
    Mesh.renderOrder = 3;
    Mesh.visible = false;
    Scene.add(Mesh);
    return { Look, Mesh, Material, Fade: 0 };
});

//------------------------------------------------------------------------------------------------------------------------
//                                                    CAMERA
//------------------------------------------------------------------------------------------------------------------------

const Orbit = { Yaw: 0, Pitch: 10, Distance: 10, Target: new THREE.Vector3() };
const Goal = { Yaw: 0, Pitch: 10, Distance: 10, Target: new THREE.Vector3() };
function AimAt(View, Snap)
{
    Goal.Yaw = Orbit.Yaw + ((((View.Yaw - Orbit.Yaw) % 360) + 540) % 360 - 180);
    Goal.Pitch = View.Pitch; Goal.Distance = View.Distance; Goal.Target.fromArray(View.Target);
    if (Snap) { Orbit.Yaw = Goal.Yaw; Orbit.Pitch = Goal.Pitch; Orbit.Distance = Goal.Distance; Orbit.Target.copy(Goal.Target); }
}
function PlaceCamera(Seconds)
{
    if (Settings.Orbit) Goal.Yaw += Seconds * 6;
    const Ease = 1 - Math.exp(-Seconds * 3.2);
    Orbit.Yaw += (Goal.Yaw - Orbit.Yaw) * Ease;
    Orbit.Pitch += (Goal.Pitch - Orbit.Pitch) * Ease;
    Orbit.Distance += (Goal.Distance - Orbit.Distance) * Ease;
    Orbit.Target.lerp(Goal.Target, Ease);
    const Yaw = Orbit.Yaw * Radian, Pitch = Orbit.Pitch * Radian;
    Camera.position.set(Math.cos(Pitch) * Math.cos(Yaw), Math.sin(Pitch), Math.cos(Pitch) * Math.sin(Yaw)).multiplyScalar(Orbit.Distance).add(Orbit.Target);
    Camera.lookAt(Orbit.Target);
}
let Drag = null;
Canvas.addEventListener('pointerdown', (Event) => { Drag = { X: Event.clientX, Y: Event.clientY }; Canvas.setPointerCapture(Event.pointerId); Canvas.classList.add('Dragging'); });
Canvas.addEventListener('pointermove', (Event) =>
{
    if (!Drag) return;
    Goal.Yaw += (Event.clientX - Drag.X) * 0.3;
    Goal.Pitch = Math.min(80, Math.max(-2, Goal.Pitch + (Event.clientY - Drag.Y) * 0.25));
    Drag = { X: Event.clientX, Y: Event.clientY };
});
const EndDrag = () => { Drag = null; Canvas.classList.remove('Dragging'); };
Canvas.addEventListener('pointerup', EndDrag);
Canvas.addEventListener('pointercancel', EndDrag);
Canvas.addEventListener('wheel', (Event) => { Event.preventDefault(); Goal.Distance = Math.min(40, Math.max(4, Goal.Distance * Math.exp(Event.deltaY * 0.001))); }, { passive: false });

//------------------------------------------------------------------------------------------------------------------------
//                                                    PANEL
//------------------------------------------------------------------------------------------------------------------------

const Build = (Tag, Class, Html) => { const Made = document.createElement(Tag); if (Class) Made.className = Class; if (Html !== undefined) Made.innerHTML = Html; return Made; };
const Controls = document.getElementById('Controls');
const Readings = {};
for (const Slider of Sliders)
{
    const Row = Build('label', 'Control');
    const Head = Build('header', '', `<span>${Slider.Label}</span><output></output>`);
    const Input = Build('input');
    Object.assign(Input, { type: 'range', min: Slider.Min, max: Slider.Max, step: Slider.Step });
    Input.addEventListener('input', () => { Settings[Slider.Key] = +Input.value; Head.querySelector('output').textContent = Slider.Show(+Input.value); });
    Row.append(Head, Input);
    Controls.append(Row);
    Readings[Slider.Key] = { Input, Output: Head.querySelector('output'), Slider };
}
function Segments(Host, Label, Options, Pick)
{
    Host.replaceChildren();
    if (!Options) return;
    const Row = Build('div', 'Control', `<header><span>${Label}</span></header>`);
    const Bar = Build('div', 'Segments');
    Options.forEach((Option, Slot) =>
    {
        const Button = Build('button', '', Option);
        Button.addEventListener('click', () => { Pick(Slot); Bar.querySelectorAll('button').forEach((Each, Other) => Each.classList.toggle('On', Other === Slot)); });
        Bar.append(Button);
    });
    Row.append(Bar);
    Host.append(Row);
    return Bar;
}
const CarBar = Segments(document.getElementById('CarRow'), 'Car body', CarModes, (Slot) => { Settings.Car = CarModes[Slot]; });
const PaletteRow = document.getElementById('Palettes');
for (const [Name, Tones] of Object.entries(Palettes))
{
    const Swatch = Build('button', 'Swatch');
    Swatch.title = Name;
    Swatch.style.background = `linear-gradient(135deg, ${Tones[0]} 0 34%, ${Tones[1]} 34% 67%, ${Tones[3]} 67%)`;
    Swatch.dataset.palette = Name;
    Swatch.addEventListener('click', () => SetPalette(Name));
    PaletteRow.append(Swatch);
}
function SetPalette(Name)
{
    Settings.Palette = Name;
    Palettes[Name].forEach((Hex, Slot) => Shared[`uTone${Slot}`].value.set(Hex).convertSRGBToLinear());
    EdgeLine.color.set(Palettes[Name][1]);
    Globe.material.uniforms.uRim.value.set(Palettes[Name][1]).convertSRGBToLinear();
    Globe.material.uniforms.uInner.value.set(Palettes[Name][2]).convertSRGBToLinear();
    Sweep.uSweepSeam.value.set(Palettes[Name][1]).convertSRGBToLinear();
    PaletteRow.querySelectorAll('.Swatch').forEach((Each) => Each.classList.toggle('On', Each.dataset.palette === Name));
}
function SyncPanel()
{
    for (const { Input, Output, Slider } of Object.values(Readings)) { Input.value = Settings[Slider.Key]; Output.textContent = Slider.Show(Settings[Slider.Key]); }
    CarBar.querySelectorAll('button').forEach((Each, Slot) => Each.classList.toggle('On', CarModes[Slot] === Settings.Car));
}
const OrbitButton = document.getElementById('Orbit'), PauseButton = document.getElementById('Pause');
const SyncToggles = () => { OrbitButton.classList.toggle('On', Settings.Orbit); PauseButton.textContent = Settings.Paused ? 'Play' : 'Pause'; };
OrbitButton.addEventListener('click', () => { Settings.Orbit = !Settings.Orbit; SyncToggles(); });
PauseButton.addEventListener('click', () => { Settings.Paused = !Settings.Paused; SyncToggles(); });
document.getElementById('Reset').addEventListener('click', () => SetLook(Settings.Look, true));

const Strip = document.getElementById('Strip');
Looks.forEach((Look, Slot) =>
{
    const Button = Build('button', 'Pick', `<i>${(Slot + 1) % 10}</i><b>${Look.Name}</b>`);
    Button.addEventListener('click', () => SetLook(Slot));
    Strip.append(Button);
});

function SetLook(Slot, Reapply = Slot !== Settings.Look || !SetLook.Done)
{
    const Look = Looks[Slot];
    Settings.Look = Slot;
    if (Reapply)
    {
        Object.assign(Settings, { Count: Look.Defaults.Count, Speed: Look.Defaults.Speed, Tail: Look.Defaults.Tail, Size: Look.Defaults.Size, Turbulence: Look.Defaults.Turbulence, Aperture: Look.Defaults.Aperture ?? 0, Variant: 0 });
        SetPalette(Look.Defaults.Palette);
        AimAt(Look.View, !SetLook.Done);
        Cycle = 0;
    }
    SetLook.Done = true;
    document.getElementById('LookName').textContent = Look.Name;
    document.getElementById('LookTagline').textContent = Look.Tagline;
    Strip.querySelectorAll('.Pick').forEach((Each, Other) => Each.classList.toggle('On', Other === Slot));
    const VariantBar = Segments(document.getElementById('VariantRow'), Look.Variant?.Label, Look.Variant?.Options, (Pick) => { Settings.Variant = Pick; });
    VariantBar?.querySelectorAll('button').forEach((Each, Other) => Each.classList.toggle('On', Other === Settings.Variant));
    SyncPanel();
}

window.addEventListener('keydown', (Event) =>
{
    if (Event.target.tagName === 'INPUT' && Event.target.type !== 'range') return;
    const Digit = Number.parseInt(Event.key, 10);
    if (Digit === 0 && Looks.length >= 10) SetLook(9);
    else if (Digit >= 1 && Digit <= Looks.length) SetLook(Digit - 1);
    else if (Event.code === 'Space') { Event.preventDefault(); Settings.Paused = !Settings.Paused; SyncToggles(); }
    else if (Event.key === 'h' || Event.key === 'H') document.body.classList.toggle('Bare');
    else if (Event.key === 'o' || Event.key === 'O') { Settings.Orbit = !Settings.Orbit; SyncToggles(); }
});

//------------------------------------------------------------------------------------------------------------------------
//                                                    TIMELINES
//------------------------------------------------------------------------------------------------------------------------

// Digital twin: 0–4.5 s assemble, hold, 6–8.5 s scan, hold, 10–13.5 s blow away, 0.5 s dark. Charging: 0 → 100 % in 20 s.
let Clock = 0, Cycle = 0;
const Readout = document.getElementById('Readout');
const Span = (Time, From, To) => Math.min(1, Math.max(0, (Time - From) / (To - From)));
function RunTimelines(Seconds)
{
    const Look = Looks[Settings.Look].Key;
    Cycle += Seconds * Settings.Speed;
    let CycleFade = 1, GhostOpacity = 1, Text = '';
    if (Look === 'Assemble')
    {
        const Time = Cycle % 14;
        const Rate = Settings.Speed;
        Shared.uMorph.value = Span(Time, 0, 4.5);
        Shared.uMorphRate.value = Time < 4.5 ? Rate / 4.5 : 0;
        Shared.uScan.value = Time > 6 && Time < 8.5 ? Span(Time, 6, 8.5) : -1;
        Shared.uRelease.value = Span(Time, 10, 13.5);
        Shared.uReleaseRate.value = Time > 10 && Time < 13.5 ? Rate / 3.5 : 0;
        CycleFade = Math.min(Span(Time, 0, 0.6), 1 - Span(Time, 12.6, 13.5));
        GhostOpacity = Math.min(1, Math.max(0, (Shared.uMorph.value - 0.8) / 0.2)) * (1 - Math.min(1, Shared.uRelease.value * 2.5));
        Text = Time < 4.5 ? 'Assembling' : Time > 6 && Time < 8.5 ? 'Scanning' : Time > 10 ? 'Releasing' : 'Ready';
    }
    Sweep.uSweepMode.value = 4;
    if (Look === 'Transition')
    {
        // 17.5 s loop: dust · reveal sweep · hold · restyle sweep · hold · dissolve sweep · dark. Each sweep takes 4 s.
        const Time = Cycle % 17.5, Start = Scatter.Max.x + 0.7, End = Scatter.Min.x - 0.7;
        const Stages = [[0, 1.2, 0, 'Dust twin'], [1.2, 5.2, 1, 'Materialising'], [5.2, 7, 1, 'Graphite'], [7, 11, 2, 'Restyling'], [11, 12.8, 2, 'Lime'], [12.8, 16.8, 3, 'Dematerialising'], [16.8, 17.5, 3, '']];
        const [From, To, Mode, Label] = Stages.find(([Begin, Finish]) => Time < Finish) ?? Stages[Stages.length - 1];
        const Moving = Math.abs(To - From - 4) < 1e-6;
        const Front = Mode === 0 ? Start : Moving ? Start + (End - Start) * Span(Time, From, From + 4) : End;
        Shared.uFront.value = Front; Shared.uFrontSpeed.value = (Start - End) / 4 * Settings.Speed; Shared.uSweepMode.value = Mode;
        Sweep.uSweepFront.value = Front; Sweep.uSweepMode.value = Mode; Sweep.uSweepClock.value = Clock;
        CycleFade = Math.min(Span(Time, 0, 0.6), 1 - Span(Time, 16.8, 17.5));
        Text = Label;
    }
    if (Look === 'Charge')
    {
        const Level = (Cycle % 20) / 20;
        Shared.uCharge.value = Level;
        const Power = Level < 0.55 ? 250 : Math.round(250 - (Level - 0.55) / 0.45 * 180);
        Text = `Charging <b>${Math.round(Level * 100)} %</b> · ${Power} kW · +${Math.round(Level * 520)} km`;
    }
    Readout.innerHTML = Text;
    Readout.classList.toggle('On', Text !== '');
    return { CycleFade, GhostOpacity };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    LOOP
//------------------------------------------------------------------------------------------------------------------------

function Resize()
{
    const Width = window.innerWidth, Height = window.innerHeight, Ratio = Renderer.getPixelRatio();
    Renderer.setSize(Width, Height, false);
    Camera.aspect = Width / Height;
    Camera.updateProjectionMatrix();
    Glow.Resize(Math.round(Width * Ratio), Math.round(Height * Ratio));
    Shared.uViewport.value.set(Math.round(Width * Ratio), Math.round(Height * Ratio));
}
window.addEventListener('resize', Resize);

const Scratch = new THREE.Color();
function Advance(Seconds)
{
    if (!Settings.Paused) Clock += Seconds;
    const { CycleFade, GhostOpacity } = RunTimelines(Settings.Paused ? 0 : Seconds);
    const Look = Looks[Settings.Look];
    Shared.uClock.value = Clock;
    Shared.uSpeed.value = Settings.Speed;
    Shared.uTail.value = Settings.Tail;
    Shared.uSize.value = Settings.Size;
    Shared.uTurbulence.value = Settings.Turbulence;
    Shared.uVariant.value = Settings.Variant;
    Shared.uAperture.value = Settings.Aperture;
    Shared.uFocus.value = Orbit.Distance;
    const Side = Math.floor(Math.sqrt(Settings.Count));
    Shared.uSide.value = Side;
    Geometry.instanceCount = Look.Key === 'Clones' ? Side * Side : Settings.Count;
    Shared.uCount.value = Geometry.instanceCount;
    const Backdrop = Look.Backdrop ?? ['#010203', '#010203'], Blend = Math.min(1, Seconds * 4);
    DomeTop.lerp(Scratch.set(Backdrop[0]), Blend);                     // hex used as linear on purpose: a visible tint after ACES
    DomeBottom.lerp(Scratch.set(Backdrop[1]), Blend);
    const Orbiting = Layers.find((Layer) => Layer.Look.Sphere);
    Globe.material.uniforms.uFade.value = Orbiting.Fade;
    Globe.visible = Orbiting.Fade > 0.01;
    for (const Layer of Layers)
    {
        const Target = Layer.Look === Look ? 1 : 0;
        Layer.Fade += (Target - Layer.Fade) * Math.min(1, Seconds * 5);
        if (Target === 0 && Layer.Fade < 0.01) Layer.Fade = 0;
        Layer.Mesh.visible = Layer.Fade > 0;
        Layer.Material.uniforms.uFade.value = Layer.Fade * (Target ? CycleFade : 1);
    }
    DressCar(Settings.Car === 'Auto' ? Look.Car : Settings.Car);
    GhostCoat.opacity = Settings.Car === 'Auto' && Look.Key === 'Assemble' ? GhostOpacity : 1;
    GhostCoat.visible = GhostCoat.opacity > 0.01;
    if (ShownCar === 'Ghost') EdgeLine.opacity = 0.08 * GhostCoat.opacity;
    Glow.Strength = Settings.Glow;
    PlaceCamera(Seconds);
    Glow.Render(Scene, Camera, Clock);
}

let Last = performance.now();
function Loop(Now)
{
    const Seconds = Math.min(0.05, (Now - Last) / 1000);
    Last = Now;
    Advance(Seconds);
    requestAnimationFrame(Loop);
}

// Capture hook: jump straight to a moment (runs the timelines in 1/30 s steps so cycles land where they would live).
window.Filament = {
    Looks: Looks.map((Each) => Each.Key),
    SetLook: (Key) => SetLook(Math.max(0, Looks.findIndex((Each) => Each.Key === Key))),
    Seek(Seconds)
    {
        Clock = 0; Cycle = 0;
        for (const Layer of Layers) Layer.Fade = Layer.Look === Looks[Settings.Look] ? 1 : 0;
        const Backdrop = Looks[Settings.Look].Backdrop ?? ['#010203', '#010203'];
        DomeTop.set(Backdrop[0]); DomeBottom.set(Backdrop[1]);
        const Paused = Settings.Paused; Settings.Paused = false;
        for (let Time = 0; Time < Seconds; Time += 1 / 30) { Clock += 1 / 30; RunTimelines(1 / 30); }
        Settings.Paused = Paused;
        PlaceCamera(10);
        Advance(0);
    },
    Settings,
};

Resize();
SetLook(Settings.Look);
for (const Key of ['Count', 'Speed', 'Tail', 'Size', 'Glow', 'Turbulence', 'Aperture']) if (Query.has(Key.toLowerCase())) Settings[Key] = +Query.get(Key.toLowerCase());
if (Query.has('palette') && Palettes[Query.get('palette')]) SetPalette(Query.get('palette'));
if (Query.has('car') && CarModes.includes(Query.get('car'))) Settings.Car = Query.get('car');
if (Query.has('variant')) Settings.Variant = +Query.get('variant');
if (Query.get('ui') === '0') document.body.classList.add('Bare');
SyncPanel(); SyncToggles();
SetLook(Settings.Look, false);
if (Query.has('time')) window.Filament.Seek(+Query.get('time'));
if (!Capture) requestAnimationFrame(Loop);
else if (!Query.has('time')) window.Filament.Seek(0);
document.body.classList.add('Ready');
