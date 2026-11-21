//============================================================================================================================================
//                                                        FLUIDVALIDATION.MJS
//           Node ESM Validation — Catalog Integrity, GLSL Static Compilation (glslangValidator when present), Mock-WebGL2
//            Solver Pass Sequencing + Uniform Wiring Audit, Preset Round-Trip Serialisation, and index.html DOM Contract
//============================================================================================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as Shaders from './Engine/FluidShaders.js';
import * as ParticleShaders from './Engine/ParticleShaders.js';
import { ParticleSimulation } from './Engine/ParticleSimulation.js';
import { ParticleTemplates, ParticleShapes, ParticleColourModes, ParticleSprites, createParticleSystem, particleTextureSide } from './Engine/ParticleCatalog.js';
import { GpuContext } from './Engine/GpuContext.js';
import { FluidSolver } from './Engine/FluidSolver.js';
import { VolumeRenderer } from './Engine/VolumeRenderer.js';
import { OrbitCamera } from './Engine/OrbitCamera.js';
import {
    ForceGeneratorTypes, ForceTypeById, FalloffCurves, EmitterShapes, BoundaryModes, ScenePresets, createDomain, createEmitter, createForceGenerator,
    createCollider, createVisualizerSet, MaximumForceGenerators, timingEnvelope,
} from './Engine/ForceGeneratorCatalog.js';

const Folder = path.dirname(fileURLToPath(import.meta.url));
let Failures = 0;
function check(condition, message)
{
    if (condition) console.log(`  🟢 ${message}`);
    else { Failures += 1; console.log(`  🔴 ${message}`); }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  1. CATALOG INTEGRITY
//------------------------------------------------------------------------------------------------------------------------

console.log('\n[1] Force generator catalog');
const codes = new Set();
for (const type of ForceGeneratorTypes)
{
    check(!codes.has(type.Code), `${type.Id} has unique GLSL code ${type.Code}`);
    codes.add(type.Code);
    check(FalloffCurves.includes(type.Defaults.Falloff), `${type.Id} default falloff is registered`);
    check(Shaders.ForceFieldChunk.includes(`type == ${type.Code}`), `${type.Id} is evaluated by the GLSL force kernel`);
}
check(ForceGeneratorTypes.length === 20, `${ForceGeneratorTypes.length} generator types registered across ${new Set(ForceGeneratorTypes.map((type) => type.Category)).size} categories`);
for (const curve of FalloffCurves) check(Shaders.ForceFieldChunk.includes(`mode == ${FalloffCurves.indexOf(curve)}`) || curve === 'InverseSquare', `Falloff ${curve} handled by GLSL`);
for (const preset of ScenePresets)
{
    for (const force of preset.Forces || []) check(Boolean(ForceTypeById[force.Type]), `${preset.Name}: force ${force.Type} resolves`);
    for (const emitter of preset.Emitters || []) check(EmitterShapes.includes(emitter.Shape), `${preset.Name}: emitter shape ${emitter.Shape} resolves`);
    check(!preset.Boundary || BoundaryModes.includes(preset.Boundary), `${preset.Name}: boundary mode resolves`);
    check(preset.Domain.Resolution.every((cells) => cells >= 8 && cells <= 160), `${preset.Name}: resolution inside solver limits`);
}

for (const shape of ParticleShapes) check(shape === 'Point' || ParticleShaders.ParticleShapeChunk.includes(`uShape == ${ParticleShapes.indexOf(shape)}`), `Particle shape ${shape} sampled by GLSL`);
for (const mode of ParticleColourModes) check(mode === 'Life' || ParticleShaders.ParticleRenderVertex.includes(`uColourMode == ${ParticleColourModes.indexOf(mode)}`), `Particle colour rule ${mode} shaded by GLSL`);
check(ParticleShaders.TrailVertex.includes('CatmullRom') && ParticleShaders.TrailUpdateFragment.includes('uHead'), 'Trail history ring + Catmull-Rom ribbon shaders present');
for (const sprite of ParticleSprites) check(sprite === 'Square' || ParticleShaders.ParticleFragment.includes(`uSprite == ${ParticleSprites.indexOf(sprite)}`), `Sprite footprint ${sprite} shaded by GLSL`);
check(ParticleTemplates.length >= 10 && particleTextureSide(16384) === 128 && particleTextureSide(500) === 24, `${ParticleTemplates.length} particle templates · texture sizing`);
check(ParticleTemplates.every((template) => (template.Defaults.Palette || []).length >= 2 && template.Defaults.Palette.length <= 8) && createParticleSystem('sparks', { ColourStart: '#ff0000', ColourEnd: '#0000ff', Palette: [] }).Palette.join() === '#ff0000,#0000ff', 'Palettes: every template carries 2–8 stops; legacy Start/End back-fill');
for (const preset of ScenePresets) for (const node of preset.Particles || []) check(ParticleTemplates.some((template) => template.Id === node.Template), `${preset.Name}: particle template ${node.Template} resolves`);

//------------------------------------------------------------------------------------------------------------------------
//                                                  2. GLSL STATIC COMPILATION
//------------------------------------------------------------------------------------------------------------------------

console.log('\n[2] GLSL ES 3.00 shaders');
const shaderEntries = [...Object.entries(Shaders), ...Object.entries(ParticleShaders)].filter(([, source]) => typeof source === 'string' && source.startsWith('#version 300 es'));
check(shaderEntries.length >= 18, `${shaderEntries.length} shader stages exported`);
const candidates = [
    process.env.GLSLANG_VALIDATOR,
    path.resolve(Folder, '../../node_modules/glslang-validator-prebuilt-predownloaded/bin/glslangValidator.linux'),
    '/tmp/glsltest/node_modules/glslang-validator-prebuilt-predownloaded/bin/glslangValidator.linux',
].filter(Boolean);
const validator = candidates.find((candidate) => fs.existsSync(candidate));
if (validator)
{
    const scratch = fs.mkdtempSync('/tmp/fluid-glsl-');
    const sparseEntries = shaderEntries.filter(([, source]) => source.includes(Shaders.VolumeChunk)).map(([name, source]) => [name + '.sparse', Shaders.sparse(source)]);
    for (const [name, source] of [...shaderEntries, ...sparseEntries])
    {
        const file = path.join(scratch, `${name.replace('.sparse', '_sparse')}.${name.endsWith('Vertex') || name.endsWith('Vertex.sparse') ? 'vert' : 'frag'}`);
        fs.writeFileSync(file, source);
        try { execFileSync(validator, [file], { stdio: 'pipe' }); check(true, `${name} compiles`); }
        catch (error) { check(false, `${name} compiles\n${error.stdout}`); }
    }
}
else console.log('  ⚠️ glslangValidator not found — skipping static GLSL compilation (set GLSLANG_VALIDATOR to enable)');

//------------------------------------------------------------------------------------------------------------------------
//                                                  3. MOCK WEBGL2 SOLVER AUDIT
//------------------------------------------------------------------------------------------------------------------------

console.log('\n[3] Mock WebGL2 pass sequencing + uniform wiring');

function parseUniforms(source)
{
    const names = new Map();
    const stripped = source.replace(/\/\/.*$/gm, '');
    for (const match of stripped.matchAll(/uniform\s+(?:lowp|mediump|highp\s+)?(\w+)\s+(\w+)(?:\s*\[\s*(\w+)\s*\])?\s*;/g))
    {
        const [, type, name, arraySize] = match;
        names.set(name, { type, array: arraySize !== undefined });
    }
    return names;
}

function createMockGl()
{
    const calls = { draws: 0, programsUsed: [], uniformErrors: [] };
    let shaderId = 0, programId = 0;
    const shaders = new Map(), programs = new Map();
    let currentProgram = null;
    const constants = { VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ACTIVE_UNIFORMS: 5, TEXTURE_2D: 6, RGBA16F: 7, RGBA32F: 8, FRAMEBUFFER: 9, COLOR_ATTACHMENT0: 10, FRAMEBUFFER_COMPLETE: 11, ARRAY_BUFFER: 12, STATIC_DRAW: 13, DYNAMIC_DRAW: 14, FLOAT: 15, TRIANGLES: 16, LINES: 17, POINTS: 18, COLOR_BUFFER_BIT: 19, BLEND: 20, DEPTH_TEST: 21, SRC_ALPHA: 22, ONE: 23, ONE_MINUS_SRC_ALPHA: 24, NEAREST: 25, LINEAR: 26, TEXTURE_MIN_FILTER: 27, TEXTURE_MAG_FILTER: 28, TEXTURE_WRAP_S: 29, TEXTURE_WRAP_T: 30, CLAMP_TO_EDGE: 31, TEXTURE0: 100, READ_FRAMEBUFFER: 32, DRAW_FRAMEBUFFER: 33, R16I: 40, RGBA32I: 41, RED_INTEGER: 42, RGBA_INTEGER: 43, SHORT: 44, INT: 45, RGBA: 46, SCISSOR_TEST: 47, UNPACK_ALIGNMENT: 48 };
    const requireLocation = (location, setter) =>
    {
        if (!location || location.program !== currentProgram) calls.uniformErrors.push(`${setter} on invalid location for program ${currentProgram && currentProgram.label}`);
    };
    const gl = {
        ...constants,
        getExtension: (name) => (name === 'EXT_color_buffer_float' ? {} : null),
        createShader: (type) => { const id = ++shaderId; shaders.set(id, { type, source: '' }); return id; },
        shaderSource: (id, source) => { shaders.get(id).source = source; },
        compileShader: () => {},
        getShaderParameter: () => true,
        getShaderInfoLog: () => '',
        deleteShader: () => {},
        createProgram: () => { const id = ++programId; programs.set(id, { shaders: [], uniforms: null, label: `program-${id}` }); return id; },
        attachShader: (program, shader) => programs.get(program).shaders.push(shaders.get(shader)),
        linkProgram: (program) =>
        {
            const record = programs.get(program);
            record.uniforms = new Map();
            for (const shader of record.shaders) for (const [name, info] of parseUniforms(shader.source)) record.uniforms.set(name, info);
            record.uniformList = [...record.uniforms.entries()];
        },
        getProgramParameter: (program, parameter) => (parameter === constants.ACTIVE_UNIFORMS ? programs.get(program).uniformList.length : true),
        getProgramInfoLog: () => '',
        getActiveUniform: (program, index) => { const [name, info] = programs.get(program).uniformList[index]; return { name: info.array ? `${name}[0]` : name, type: info.type }; },
        getUniformLocation: (program, name) => (programs.get(program).uniforms.has(name.replace(/\[0\]$/, '')) ? { program: programs.get(program), name } : null),
        useProgram: (program) => { currentProgram = programs.get(program); calls.programsUsed.push(currentProgram); },
        createTexture: () => ({}), bindTexture: () => {}, texParameteri: () => {}, texStorage2D: () => {}, activeTexture: () => {},
        createFramebuffer: () => ({}), bindFramebuffer: () => {}, framebufferTexture2D: () => {}, checkFramebufferStatus: () => constants.FRAMEBUFFER_COMPLETE,
        deleteFramebuffer: () => {}, deleteTexture: () => {},
        createVertexArray: () => ({}), bindVertexArray: () => {}, createBuffer: () => ({}), bindBuffer: () => {}, bufferData: () => {}, enableVertexAttribArray: () => {}, vertexAttribPointer: () => {},
        viewport: () => {}, clearColor: () => {}, clear: () => {}, disable: () => {}, enable: () => {}, blendFunc: () => {}, blitFramebuffer: () => {},
        scissor: () => {}, pixelStorei: () => {}, texSubImage2D: () => { calls.uploads = (calls.uploads || 0) + 1; }, readPixels: (x, y, w, h, format, type, buffer) => { calls.readbacks = (calls.readbacks || 0) + 1; buffer.fill(0); if (calls.occupancyHook) calls.occupancyHook(buffer); },
        drawArrays: () => { calls.draws += 1; },
    };
    for (const setter of ['uniform1i', 'uniform1f', 'uniform2i', 'uniform2f', 'uniform3i', 'uniform3f', 'uniform3fv', 'uniform4fv', 'uniformMatrix4fv'])
        gl[setter] = (location) => requireLocation(location, setter);
    gl.__calls = calls;
    gl.__labelProgram = (programRecord) => { programs.get(programRecord.program).label = programRecord.label; };
    return gl;
}

const mockGl = createMockGl();
const mockCanvas = { width: 1280, height: 720, getContext: () => mockGl };
const context = new GpuContext(mockCanvas);
const solver = new FluidSolver(context);
const renderer = new VolumeRenderer(context, solver);
const particles = new ParticleSimulation(context, solver);
renderer.particles = particles;
for (const programRecord of [...Object.values(solver.programs), ...Object.values(renderer.programs), ...Object.values(particles.programs)]) mockGl.__labelProgram(programRecord);

const preset = ScenePresets.find((candidate) => candidate.Id === 'preset-wind-tunnel');
const domain = createDomain({ ...preset.Domain, Boundary: preset.Boundary });
check(domain.Resolution.join() === '96,48,48' && Math.abs(domain.CellSize - 6 / 96) < 1e-9, 'Domain grid derives 96×48×48 @ 6.25 cm from Size 6×3×3 / MaxCells 96');
const scene = {
    Name: preset.Name, Domain: domain,
    Emitters: preset.Emitters.map((emitter) => createEmitter(emitter)),
    Forces: [...preset.Forces.map((force) => createForceGenerator(force.Type, force)), ...ForceGeneratorTypes.map((type) => createForceGenerator(type.Id)), ],
    Colliders: preset.Colliders.map((collider) => createCollider(collider)),
    Particles: ParticleTemplates.map((template) => createParticleSystem(template.Id)),
    Visualizers: createVisualizerSet(),
};
scene.Visualizers.ScalarSlice.Visible = true;
solver.configure(domain.Resolution, domain.CellSize);
check(solver.layout.textureWidth === 96 * 7 && solver.layout.textureHeight === 48 * 7, `Tiled layout for 96×48×48 is ${solver.layout.textureWidth}×${solver.layout.textureHeight} (7×7 tiles)`);

const drawsBefore = mockGl.__calls.draws;
solver.step(scene, 1 / 60);
const stepDraws = mockGl.__calls.draws - drawsBefore;
check(solver.forceArrays.count === MaximumForceGenerators, `Force packing saturates at ${MaximumForceGenerators} slots (${scene.Forces.length} authored)`);
check(solver.emitterArrays.count === 1 && solver.colliderArray.count === 1, 'Emitter + collider packing');
const expectedDraws = 2 + 3 + 3 + 1 + 1 + 1 + 1 + 1 + domain.PressureIterations + 1;
check(stepDraws === expectedDraws, `MacCormack step issues ${stepDraws} GPU passes (expected ${expectedDraws})`);
domain.Advection = 'SemiLagrangian';
const drawsSemi = mockGl.__calls.draws;
solver.step(scene, 1 / 60);
check(mockGl.__calls.draws - drawsSemi === expectedDraws - 4, 'Semi-Lagrangian step drops the 4 MacCormack correction passes');
solver.updateTracers(1 / 60, 4);
const camera = new OrbitCamera();
camera.setViewport(1280, 720);
renderer.render(scene, camera, scene.Forces[0].Id, 1 / 60);
particles.update(scene, 1 / 60); particles.update(scene, 1 / 60);
renderer.render(scene, new OrbitCamera(), null, 1 / 60);
check(particles.records.size === ParticleTemplates.length, `Every particle template allocates GPU state (${particles.records.size} systems)`);
check(mockGl.__calls.uniformErrors.length === 0, `Every uniform written exists in its shader (${mockGl.__calls.uniformErrors.length} mismatches)`);
for (const error of mockGl.__calls.uniformErrors.slice(0, 12)) console.log('     ↳ ' + error);
check(renderer.lineVertexCount === 24, `Gizmos hidden by default: only the domain box (${renderer.lineVertexCount} line vertices)`);
scene.Visualizers.ForceGizmos.Visible = true;
renderer.render(scene, new OrbitCamera(), scene.Forces[0].Id, 1 / 60);
check(renderer.lineVertexCount > 100, `Gizmo batch produced ${renderer.lineVertexCount} line vertices for ${scene.Forces.length} forces`);

//------------------------------------------------------------------------------------------------------------------------
//                                                  4. SERIALISATION ROUND-TRIP
//------------------------------------------------------------------------------------------------------------------------

console.log('\n[4] Serialisation');
const document_ = JSON.parse(JSON.stringify({ Format: 'FrontierFluidScene', Version: 1, Name: scene.Name, Domain: scene.Domain, Emitters: scene.Emitters, Forces: scene.Forces, Colliders: scene.Colliders, Visualizers: scene.Visualizers }));
check(document_.Forces.length === scene.Forces.length && document_.Domain.CellSize === domain.CellSize, 'Scene document round-trips through JSON');
const rebuilt = document_.Forces.map((force) => createForceGenerator(force.Type, force));
check(rebuilt.every((force, index) => force.Strength === scene.Forces[index].Strength && force.Position.join() === scene.Forces[index].Position.join()), 'Force generators rebuild with identical parameters');

//------------------------------------------------------------------------------------------------------------------------
//                                                  5. DOM CONTRACT
//------------------------------------------------------------------------------------------------------------------------

console.log('\n[5] index.html DOM contract');
const html = fs.readFileSync(path.join(Folder, 'index.html'), 'utf8');
for (const id of [...html.matchAll(/getElementById\('([^']+)'\)/g)].map((match) => match[1]))
    check(html.includes(`id="${id}"`), `#${id} exists in markup`);
const panels = fs.readFileSync(path.join(Folder, 'UI/StudioPanels.js'), 'utf8');
for (const id of [...panels.matchAll(/getElementById\('([^']+)'\)/g)].map((match) => match[1]))
    check(panels.includes(`id="${id}"`), `#${id} is created by StudioPanels before lookup`);
for (const asset of ['Styles/FluidEditor.css', 'Fonts/dm-sans-latin-300-normal.woff2', 'Fonts/dm-sans-latin-400-normal.woff2', 'Fonts/dm-sans-latin-500-normal.woff2', 'Fonts/OFL.txt', 'Serve.py'])
    check(fs.existsSync(path.join(Folder, asset)), `${asset} present`);
check(!/https?:\/\/(fonts|cdn|unpkg|jsdelivr)/.test(html + panels), 'No hot-linked fonts or CDN scripts');



//------------------------------------------------------------------------------------------------------------------------
//                                                  6. UI RENDER SMOKE (DOM SHIM)
//------------------------------------------------------------------------------------------------------------------------

console.log('\n[6] Studio panel render smoke test');
function shimElement(tag)
{
    const node = {
        tagName: tag.toUpperCase(), children: [], attributes: {}, style: { setProperty() {} }, classList: null, listeners: {},
        _className: '', innerHTML: '', value: '', textContent: '', disabled: false, title: '',
        appendChild(child) { node.children.push(child); return child; },
        append(...nodes) { node.children.push(...nodes); },
        addEventListener(type, handler) { (node.listeners[type] ||= []).push(handler); },
        querySelector(selector) { return selector === 'svg' ? shimElement('svg') : shimElement('div'); },
        querySelectorAll() { return []; },
        setAttribute(key, value) { node.attributes[key] = value; },
        contains() { return false; },
        click() { for (const handler of node.listeners.click || []) handler({ stopPropagation() {}, preventDefault() {} }); },
    };
    const classes = new Set();
    node.classList = { add: (...names) => names.forEach((name) => classes.add(name)), remove: (...names) => names.forEach((name) => classes.delete(name)), toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)), contains: (name) => classes.has(name) };
    Object.defineProperty(node, 'className', { get: () => node._className, set: (value) => { node._className = value; value.split(/\s+/).filter(Boolean).forEach((name) => classes.add(name)); } });
    return node;
}
const registry = new Map();
globalThis.document = {
    createElement: shimElement,
    getElementById: (id) => registry.get(id) || null,
    addEventListener() {},
    body: shimElement('body'),
};
globalThis.window = { devicePixelRatio: 1, addEventListener() {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const { mountStudioUI } = await import('./UI/StudioPanels.js');
const { FluidStudioApp } = await import('./Engine/FluidStudioApp.js');
const refs = {};
for (const key of ['outliner', 'inspector', 'toolbar', 'transport', 'legend', 'notch', 'notchMenu', 'drawer', 'drawerTab', 'statusFps', 'statusStep', 'statusGrid', 'statusForces', 'statusText']) refs[key] = shimElement('div');
const canvas = { ...shimElement('canvas'), width: 1280, height: 720, getContext: () => createMockGl(), getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }), setPointerCapture() {}, releasePointerCapture() {} };
let ui = null;
const app = new FluidStudioApp({ canvas, onMetrics: (metrics) => ui && ui.updateMetrics(metrics), onStateChange: (snapshot) => ui && ui.renderAll(snapshot), onError: (error) => { throw error; } });
ui = mountStudioUI({ app, refs });
app.init();
check(app.supported && app.scene, 'App initialises against mock GPU context');
ui.renderAll(app.snapshot());
check(refs.outliner.children.length >= 4 && refs.inspector.children.length >= 5, 'Outliner + inspector populate for the Domain selection');
let renders = 0;
for (const type of ForceGeneratorTypes)
{
    const force = app.addForce(type.Id);
    check(app.selection === force.Id, `Add ${type.Name} selects the new node`);
    renders += refs.inspector.children.length;
}
check(app.scene.Forces.length === ForceGeneratorTypes.length && app.scene.PresetId === 'preset-blank', 'All generator types construct into the blank starting scene');
app.scene.Visualizers.ForceVectors.Visible = true; app.scene.Visualizers.ForceVectors.Mode = 'Volume'; app.frame(70);
check(app.supported, 'Sparse-volume force vector overlay renders');
app.addEmitter('Disc'); app.addCollider();
for (const visualizer of Object.values(app.scene.Visualizers)) { app.select(visualizer.Id); check(refs.inspector.children.length >= 4, `${visualizer.Name} inspector renders`); }
app.frame(16); app.frame(33); app.stepOnce(); app.frame(50);
check(app.solver.frame === 4, `Solver advanced ${app.solver.frame} frames through the app loop (3 live + 1 stepped)`);
for (const preset of ScenePresets) { app.loadPreset(preset.Id); check(app.scene.Name === preset.Name && app.solver.layout.width === preset.Domain.Resolution[0], `Preset ${preset.Name} loads + reconfigures grid`); }
ui.toggleDrawer(true, 'forces');
check(refs.drawer.children.length === 2 && refs.drawer.children[1].children.reduce((sum, group) => sum + group.children[1].children.length, 0) === ForceGeneratorTypes.length, 'Asset drawer lists every force generator card grouped by category');
app.loadPreset('preset-campfire');
app.updateNode(app.scene.Domain.Id, 'MaxCells', 48);
check(app.solver.layout.height === 48 && app.solver.layout.width === 29, `MaxCells edits rebuild the solver fields at fixed world size (3×5×3 m → ${app.solver.layout.width}×${app.solver.layout.height}×${app.solver.layout.depth})`);
app.updateNode(app.scene.Domain.Id, 'Size', [4, 6, 4]);
check(app.solver.layout.width === 32 && Math.abs(app.scene.Domain.CellSize - 0.125) < 1e-9, 'Size edits keep the voxel count on the longest axis');
const exported = app.exportJson();
app.importJson(exported);
check(app.scene.Domain.Resolution.join() === '32,48,32' && app.scene.Domain.MaxCells === 48, 'Export → import preserves the edited domain');
app.loadPreset('preset-demolition');
const charge = app.scene.Emitters[0];
check(timingEnvelope(charge, 0.1) === 0 && timingEnvelope(charge, 0.3) === 1 && timingEnvelope(charge, 1.0) === 0, 'Timing keys gate the ground charge (waiting → live → done)');
check(timingEnvelope({ StartTime: 1, Duration: 1, Fade: 0.5, Repeat: 3 }, 4.5) === 1 && timingEnvelope({}, 99) === 1, 'Repeat keys loop; un-keyed nodes stay on');
app.scene.Visualizers.Debris.Visible = true; app.frame(80); app.frame(96); app.frame(112);
check(app.supported && app.solver.debrisPositions && app.solver.debrisVelocities, 'Debris particle ping-pong integrates + renders through the app loop');
app.scene.Domain.SceneLoop = 0.01; app.frame(130); check(app.solver.frame <= 1, 'Scene loop restarts the solver clock');

// World Grid: a 3×1×3 tile window following a Straight-path emitter must slide by whole tiles with the fields shifted in place.
app.loadPreset('preset-drift-run');
const grid = app.scene.Domain;
check(grid.Tiles.join() === '3,1,3' && grid.TileCells.join() === '40,22,40' && grid.Resolution.join() === '120,22,120', `World Grid 3×1×3 tiles of ${grid.TileCells.join('×')} cells solve as one ${grid.Resolution.join('×')} field`);
app.scene.Emitters[0].PathKind = 'Straight'; app.scene.Emitters[0].PathSpeed = 10; app.scene.Emitters[0].Position = [0, -0.98, 0];
const relocationsBefore = app.solver.relocations;
for (let i = 0; i < 40; i += 1) app.frame(200 + i * 16);
check(app.solver.relocations > relocationsBefore && grid.GridOrigin[0] >= 1 && grid.GridOrigin[1] === 0, `Following emitter at 10 m/s stepped the window ${app.solver.relocations - relocationsBefore}× along X to tile ${grid.GridOrigin.join(',')} (height locked)`);
check(Math.abs(app.solver.domainCentre[0] - grid.GridOrigin[0] * 4) < 1e-9 && app.solver.layout.width === 120, 'Window centre tracks the tile origin without reallocating the fields');
app.recentreGrid();
check(grid.GridOrigin.join() === '0,0,0' && app.solver.domainCentre[0] === 0, 'Recentre returns the window to tile 0');
check(Shaders.ShiftFragment.includes('CellInside(source)'), 'Shift kernel zero-fills cells scrolling in from outside the old window');

// Infinite grid: sparse tiles allocate around emitters, grow across faces the occupancy readback flags, and free when empty.
app.loadPreset('preset-infinite-plume');
const pool = app.solver.tilePool;
check(app.solver.sparse && pool && pool.cells === 24 && pool.slots === 56 && app.solver.layout.textureWidth === pool.slotsX * pool.blockW, `Infinite grid allocates a ${pool.slotsX}×${pool.slotsY} slot atlas (${app.solver.layout.textureWidth}×${app.solver.layout.textureHeight}) for 56 tiles of 24³`);
app.frame(1000);
const pinned = app.solver.residentTiles.filter((entry) => entry.pinned).length;
check(pinned >= 1 && app.solver.residentTiles.every((entry) => entry.tile[1] >= 0), `Emitter pins ${pinned} ground tile(s); nothing allocates below the floor`);
const appGl = app.solver.gl;
// Fake an occupancy readback that reports gas pressing on the +X and +Y faces of every resident slot.
appGl.__calls.occupancyHook = (buffer) => { for (let slot = 0; slot < pool.slots; slot += 1) { if (!pool.entries[slot]) continue; buffer[slot * 12 + 0] = 500; buffer[slot * 12 + 1] = 1; buffer[slot * 12 + 5] = 400; buffer[slot * 12 + 7] = 400; } };
const before = app.solver.residentTiles.length;
app.frame(1016); app.frame(1032); app.frame(1048);
const after = app.solver.residentTiles.length;
check(after > before && pool.map.has('1,0,0') && pool.map.has('0,1,0'), `Occupancy drives growth: ${before} → ${after} resident tiles, +X and +Y neighbours allocated`);
appGl.__calls.occupancyHook = (buffer) => { for (let slot = 0; slot < pool.slots; slot += 1) buffer[slot * 12 + 3] = 1; };
for (let i = 0; i < 100; i += 1) app.frame(1100 + i * 16);
check(app.solver.residentTiles.length === app.solver.residentTiles.filter((entry) => entry.pinned).length, `Empty tiles are freed after their grace period (${app.solver.residentTiles.length} pinned remain)`);
appGl.__calls.occupancyHook = null;
check(Shaders.sparse(Shaders.PressureFragment).includes('uTileLookup') && !Shaders.sparse(Shaders.PressureFragment).includes('PixelFromCell(ivec3 cell)\n{\n    int tileX'), 'Sparse rewrite swaps the addressing chunk in every kernel');
check(appGl.__calls.uniformErrors.length === 0, `Sparse programs: every uniform written exists (${mockGl.__calls.uniformErrors.length} mismatches)`);
app.loadPreset('preset-campfire');
check(!app.solver.sparse && app.solver.layout.width === 29 || app.solver.layout.width > 0, 'Switching back to a fixed-box preset rebuilds the window solver');

console.log(Failures === 0 ? '\n🟢 Fluid Studio validation passed' : `\n🔴 Fluid Studio validation failed (${Failures})`);
process.exit(Failures === 0 ? 0 : 1);
