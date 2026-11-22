//============================================================================================================================================
//                                                        FLUIDSTUDIOAPP.JS
//              Fluid Studio Application State — Scene Graph (Domain · Emitters · Forces · Colliders · Visualizers),
//           Preset Loading, Transport (Play / Pause / Step / Reset), Viewport Input (Orbit / Pan / Dolly / Pick / Drag),
//                                        JSON Serialisation, and Live Metric Reporting
//============================================================================================================================================

import { GpuContext } from './GpuContext.js';
import { FluidSolver } from './FluidSolver.js';
import { VolumeRenderer } from './VolumeRenderer.js';
import { OrbitCamera, Vec3 } from './OrbitCamera.js';
import { createDomain, createEmitter, createForceGenerator, createCollider, createVisualizerSet, ForceTypeById, resolveDomainGrid, emitterTransform, gridWindowCentre, gridTileOf } from './ForceGeneratorCatalog.js';
import { ParticleSimulation } from './ParticleSimulation.js';
import { createParticleSystem, evaluateParticleSystem, ParticleTemplateById, MaximumParticleSystems } from './ParticleCatalog.js';
import {
    convertSceneToGasStack, evaluateGasStack, applyGasEvaluation, owningLayer, createLayer, createLinkedSource, readGasStack, coerceAmount,
    LayerSpecificationByCode, SourceLayerCode, MaximumLayers, SpecificationHash, FloatKeys, evaluateParticleStack, insertLayerInPhaseOrder,
} from './LayerStack.js';
import { ScenePresets, ScenePresetById, buildSceneFromDocument, sceneToDocument } from './PresetScenes.js';
import { writeToml } from './TomlSubset.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                  FLIPBOOK LAYOUT
//------------------------------------------------------------------------------------------------------------------------

export const FlipbookChoices = Object.freeze({ Count: [4, 16, 32, 64], Size: [64, 128, 256, 512], Rate: [12, 24, 30, 60] });

/** Sheet layout for a bake: a near-square grid of `Count` tiles of `Size` pixels. */
export function specifyFlipbook(count, size, rate, warmup)
{
    if (!FlipbookChoices.Count.includes(count) || !FlipbookChoices.Size.includes(size) || !FlipbookChoices.Rate.includes(rate) || !Number.isFinite(warmup) || warmup < 0 || warmup > 3)
        throw new Error('Choose a supported frame count, tile size, frame rate and a 0–3 second warm-up.');
    const columns = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / columns);
    return { Count: count, Size: size, Rate: rate, Warmup: warmup, Columns: columns, Rows: rows, Width: columns * size, Height: rows * size };
}

/** GL rows run bottom-up; flip them, and for transparent frames turn premultiplied colour into straight alpha. */
export function unpackFrame(bytes, size, transparent)
{
    const pixels = new Uint8ClampedArray(bytes.length);
    for (let row = 0; row < size; row += 1)
        for (let column = 0; column < size; column += 1)
        {
            const source = ((size - 1 - row) * size + column) * 4;
            const target = (row * size + column) * 4;
            const alpha = transparent ? Math.max(bytes[source + 3], bytes[source], bytes[source + 1], bytes[source + 2]) : 255;
            for (let channel = 0; channel < 3; channel += 1)
                pixels[target + channel] = transparent ? (alpha ? Math.round(bytes[source + channel] * 255 / alpha) : 0) : bytes[source + channel];
            pixels[target + 3] = alpha;
        }
    return pixels;
}

export class FluidStudioApp
{
    constructor({ canvas, onMetrics, onStateChange, onError })
    {
        this.canvas = canvas;
        this.onMetrics = onMetrics || (() => {});
        this.onStateChange = onStateChange || (() => {});
        this.onError = onError || ((error) => console.error(error));
        this.camera = new OrbitCamera();
        this.scene = null;
        this.selection = null;
        this.playing = true;
        this.stepRequested = false;
        this.fixedDeltaTime = 1 / 60;
        this.cameraFollowsGrid = true;
        this.lastFrameTime = 0;
        this.frameTimes = [];
        this.pointer = { mode: null, x: 0, y: 0, dragNode: null, dragPlanePoint: null, dragOffset: null, moved: false };
        this.hover = null;
        this.supported = true;
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  LIFECYCLE
    //------------------------------------------------------------------------------------------------------------------------

    init()
    {
        try
        {
            this.context = new GpuContext(this.canvas);
            this.solver = new FluidSolver(this.context);
            this.renderer = new VolumeRenderer(this.context, this.solver);
            this.particles = new ParticleSimulation(this.context, this.solver);
            this.renderer.particles = this.particles;
        }
        catch (error)
        {
            this.supported = false;
            this.onError(error);
            return;
        }
        this.loadPreset(ScenePresets[0].Id, false);
        this.attachInput();
        this.resize();
        window.addEventListener('resize', () => this.resize());
        requestAnimationFrame((time) => this.frame(time));
    }

    resize()
    {
        const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
        const rect = this.canvas.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width * ratio));
        const height = Math.max(1, Math.floor(rect.height * ratio));
        if (this.canvas.width !== width || this.canvas.height !== height)
        {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        this.camera.setViewport(rect.width, rect.height);
    }

    frame(time)
    {
        requestAnimationFrame((next) => this.frame(next));
        if (!this.supported || !this.scene || this.baking) return;
        const elapsed = this.lastFrameTime ? Math.min(0.1, (time - this.lastFrameTime) / 1000) : this.fixedDeltaTime;
        this.lastFrameTime = time;
        this.frameTimes.push(elapsed);
        if (this.frameTimes.length > 45) this.frameTimes.shift();
        this.resize();
        const domain = this.scene.Domain;
        const deltaTime = this.fixedDeltaTime * domain.TimeScale;
        try
        {
            if (this.playing || this.stepRequested)
            {
                this.advanceSimulation(deltaTime);
                this.stepRequested = false;
            }
            else
            {
                if (this.solver.tracersNeedReset) this.solver.updateTracers(0, this.scene.Visualizers.Tracers.Lifetime);
                if (this.solver.debrisNeedReset) this.solver.updateDebris(0, this.scene.Visualizers.Debris);
                this.particles.update(this.scene, 0);
            }
            this.lastMatrices = this.renderer.render(this.scene, this.camera, this.selection, deltaTime);
        }
        catch (error)
        {
            this.supported = false;
            this.onError(error);
            return;
        }
        this.reportMetrics(elapsed);
    }

    /** One simulation step of everything that moves: grid, tracers, debris and particle systems. */
    advanceSimulation(deltaTime)
    {
        // A gas stack that cannot evaluate (missing Domain layer, over capacity) holds the gas still; particles keep moving.
        if (this.gasEvaluation && this.gasEvaluation.Stopped) { this.particles.update(this.scene, deltaTime); return; }
        const domain = this.scene.Domain;
        if (domain.SceneLoop > 0 && this.solver.time >= domain.SceneLoop) { this.solver.reset(); this.particles.resetAll(); this.recentreGrid(); }
        this.followGrid();
        this.solver.step(this.scene, deltaTime);
        this.solver.updateTracers(deltaTime, this.scene.Visualizers.Tracers.Lifetime);
        this.solver.updateDebris(deltaTime, this.scene.Visualizers.Debris);
        this.particles.update(this.scene, deltaTime);
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  FLIPBOOK BAKE
    //------------------------------------------------------------------------------------------------------------------------

    /**
     * Renders `Count` square frames of the simulation into one sprite sheet (a canvas), left-to-right, top-to-bottom, plus
     * the timing and UV metadata a game engine needs to play it back. Ported from the other fluid editor's FlipbookSequence:
     * same frame counts, tile sizes, rates, warm-up and straight-alpha transparent mode.
     *
     * Unlike that editor, which bakes in a second, isolated WebGL context, this bakes on the live solver: it is paused for
     * the bake, and the viewport carries on from the last baked frame. `Restart` begins the bake from an empty grid.
     */
    async bakeFlipbook(settings, onProgress = () => {}, isCancelled = () => false)
    {
        const layout = specifyFlipbook(settings.Count, settings.Size, settings.Rate, settings.Warmup);
        if (this.baking) throw new Error('A flipbook bake is already running.');
        this.baking = true;
        const wasPlaying = this.playing;
        const camera = this.camera;
        const savedViewport = [...camera.viewport];
        const savedAspect = camera.aspect;
        const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
        const target = this.renderer.createBakeTarget(layout.Size);
        target.transparent = Boolean(settings.Transparent);
        const sheet = document.createElement('canvas');
        sheet.width = layout.Width;
        sheet.height = layout.Height;
        const context2d = sheet.getContext('2d');
        const readback = new Uint8Array(layout.Size * layout.Size * 4);
        const gl = this.context.gl;
        const deltaTime = this.fixedDeltaTime * this.scene.Domain.TimeScale;
        const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));
        const advanceTo = async (time) =>
        {
            let steps = 0;
            while (this.solver.time < time - deltaTime * 0.5)
            {
                if (isCancelled()) throw new Error('Bake cancelled.');
                this.advanceSimulation(deltaTime);
                if (++steps % 4 === 0) await yieldToBrowser();
            }
        };
        try
        {
            if (settings.Restart) { this.solver.reset(); this.particles.resetAll(); this.recentreGrid(); }
            // Square frames: the camera keeps its vertical field of view and frames the same subject as the viewport.
            camera.setViewport(layout.Size / ratio, layout.Size / ratio);
            const start = this.solver.time;
            if (layout.Warmup > 0) { onProgress(0, 'Warming up the simulation…'); await advanceTo(start + layout.Warmup); }
            const frames = [];
            const first = this.solver.time;
            for (let index = 0; index < layout.Count; index += 1)
            {
                await advanceTo(first + (index + 1) / layout.Rate);
                this.renderer.render(this.scene, camera, null, deltaTime, target);
                gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
                gl.readPixels(0, 0, layout.Size, layout.Size, gl.RGBA, gl.UNSIGNED_BYTE, readback);
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                if (gl.isContextLost()) throw new Error('GPU bake interrupted. Lower the voxel resolution or tile size and retry.');
                const x = (index % layout.Columns) * layout.Size;
                const y = Math.floor(index / layout.Columns) * layout.Size;
                context2d.putImageData(new ImageData(unpackFrame(readback, layout.Size, target.transparent), layout.Size, layout.Size), x, y);
                frames.push({ index, x, y, width: layout.Size, height: layout.Size, simulationTime: Number(this.solver.time.toFixed(4)), uv: [x / layout.Width, y / layout.Height, layout.Size / layout.Width, layout.Size / layout.Height] });
                onProgress((index + 1) / layout.Count, `Baking frame ${index + 1} / ${layout.Count}`);
                await yieldToBrowser();
            }
            const name = this.scene.Name.replace(/[^a-z0-9 _-]/gi, '').trim().replace(/\s+/g, '') || 'Scene';
            const metadata = {
                format: 'frontier-fluid-flipbook', version: 1, name, image: `${name}.flipbook.png`,
                width: layout.Width, height: layout.Height, columns: layout.Columns, rows: layout.Rows,
                frameCount: layout.Count, framesPerSecond: layout.Rate, playbackDuration: layout.Count / layout.Rate,
                warmup: layout.Warmup, restarted: Boolean(settings.Restart),
                origin: 'top-left', uvEncoding: 'normalized x, y, width, height', simulationTimeUnits: 'seconds',
                frameOrder: 'left-to-right, top-to-bottom', colourSpace: 'srgb-tonemapped',
                alphaMode: target.transparent ? 'straight-opacity-and-emission-coverage' : 'opaque',
                camera: { position: camera.position, forward: camera.forward, up: camera.up, aspect: 1, fovY: camera.fovY },
                scene: JSON.parse(this.exportJson()),
                frames,
            };
            return { sheet, metadata, name };
        }
        finally
        {
            this.renderer.destroyBakeTarget(target);
            camera.viewport = savedViewport;
            camera.aspect = savedAspect;
            this.baking = false;
            this.playing = wasPlaying;
            this.lastFrameTime = 0;
            this.notify();
        }
    }

    reportMetrics(elapsed)
    {
        const average = this.frameTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, this.frameTimes.length);
        const layout = this.solver.layout;
        this.onMetrics({
            fps: 1 / Math.max(average, 1e-4),
            frameMilliseconds: elapsed * 1000,
            stepMilliseconds: this.solver.statistics.stepMilliseconds,
            passes: this.solver.statistics.passes,
            simulationTime: this.solver.time,
            simulationFrame: this.solver.frame,
            cells: layout.cellCount,
            residentTiles: layout.residentTiles || 0,
            poolSize: layout.poolSize || 0,
            resolution: [layout.width, layout.height, layout.depth],
            textureSize: [layout.textureWidth, layout.textureHeight],
            forces: this.scene.Forces.filter((force) => force.Enabled).length,
            emitters: this.scene.Emitters.filter((emitter) => emitter.Enabled).length,
            particleSystems: this.particles.statistics.systems,
            particles: this.particles.statistics.particles,
            playing: this.playing,
        });
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  SCENE CONSTRUCTION
    //------------------------------------------------------------------------------------------------------------------------

    loadPreset(presetId, announce = true)
    {
        if (this.baking) return;
        const preset = ScenePresetById[presetId] || ScenePresets[0];
        // Presets are documents (Presets/*.toml): grid, emitters, force fields, colliders, particles and the gas layer stack.
        this.scene = buildSceneFromDocument(preset.Document);
        this.particles.resetAll();
        this.selectedLayer = null;
        this.evaluateStack();
        this.applyDomainResolution();
        this.camera.frame(this.solver.domainHalfExtent, this.solver.domainCentre);
        this.selection = this.scene.Forces[0] ? this.scene.Forces[0].Id : 'domain';
        this.playing = true;
        if (announce) this.notify();
    }

    applyDomainResolution()
    {
        const domain = resolveDomainGrid(this.scene.Domain);
        if (domain.Grid === 'Infinite') this.solver.configureInfinite(domain.TileResolution, domain.CellSize, domain.TilePool);
        else this.solver.configure(domain.Resolution, domain.CellSize, gridWindowCentre(domain));
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  WORLD GRID
    //------------------------------------------------------------------------------------------------------------------------

    /** World position the sliding window keeps centred, or null when the grid is static. */
    gridFollowTarget()
    {
        const domain = this.scene.Domain;
        const time = this.solver.time;
        switch (domain.Follow)
        {
            case 'Emitter':
            {
                const emitter = this.scene.Emitters.find((node) => node.Id === domain.FollowId) || this.scene.Emitters.find((node) => node.Enabled) || this.scene.Emitters[0];
                return emitter ? emitterTransform(emitter, time).Position : null;
            }
            case 'Particles':
            {
                const node = (this.scene.Particles || []).find((system) => system.Id === domain.FollowId) || (this.scene.Particles || [])[0];
                return node ? node.Position : null;
            }
            case 'Camera': return this.camera.target;
            default: return null;
        }
    }

    /**
     * Sliding World Grid: when the follow target leaves the centre tile the window steps by whole tiles so the target's
     * tile becomes the centre again. Fields are shifted by an exact cell offset, so smoke already laid down keeps its
     * world position and keeps simulating — the gas is never clipped at the old box. Height only follows when enabled.
     */
    followGrid()
    {
        const domain = this.scene.Domain;
        if (domain.Grid === 'Infinite') return;
        const target = this.gridFollowTarget();
        if (!target) return;
        const tile = gridTileOf(domain, target);
        if (!domain.FollowHeight) tile[1] = domain.GridOrigin[1];
        const delta = tile.map((value, axis) => value - domain.GridOrigin[axis]);
        if (!delta.some((value) => value !== 0)) return;
        domain.GridOrigin = tile;
        const shift = delta.map((value, axis) => value * domain.TileCells[axis]);
        this.solver.relocate(shift, gridWindowCentre(domain));
        if (domain.Follow !== 'Camera' && this.cameraFollowsGrid) this.camera.target = Vec3.add(this.camera.target, shift.map((cells) => cells * domain.CellSize));
        this.notify();
    }

    recentreGrid()
    {
        const domain = this.scene.Domain;
        if (!domain.GridOrigin.some((value) => value !== 0)) return;
        domain.GridOrigin = [0, 0, 0];
        this.solver.relocate([0, 0, 0], gridWindowCentre(domain));
        this.solver.reset();
        this.camera.frame(this.solver.domainHalfExtent, this.solver.domainCentre);
        this.notify();
    }

    notify()
    {
        this.onStateChange(this.snapshot());
    }

    snapshot()
    {
        return { scene: this.scene, selection: this.selection, playing: this.playing, node: this.findNode(this.selection), gas: this.gasEvaluation, selectedLayer: this.selectedLayer };
    }

    findNode(id)
    {
        if (!this.scene || !id) return null;
        if (id === 'domain') return this.scene.Domain;
        for (const list of [this.scene.Emitters, this.scene.Forces, this.scene.Colliders, this.scene.Particles])
        {
            const node = list.find((candidate) => candidate.Id === id);
            if (node) return node;
        }
        for (const visualizer of Object.values(this.scene.Visualizers)) if (visualizer.Id === id) return visualizer;
        return null;
    }

    select(id)
    {
        this.selection = id;
        this.notify();
    }

    addForce(typeId)
    {
        const type = ForceTypeById[typeId];
        const existing = this.scene.Forces.filter((force) => force.Type === typeId).length;
        const half = this.solver.domainHalfExtent, centre = this.solver.domainCentre;
        const force = createForceGenerator(typeId, {
            Name: existing > 0 ? `${type.Name} ${existing + 1}` : type.Name,
            Position: [centre[0] + ((this.scene.Forces.length % 3) - 1) * half[0] * 0.35, centre[1] + (Math.random() - 0.5) * half[1] * 0.4, centre[2]],
        });
        this.scene.Forces.push(force);
        this.select(force.Id);
        return force;
    }

    addEmitter(shape = 'Sphere')
    {
        const half = this.solver.domainHalfExtent, centre = this.solver.domainCentre;
        const emitter = createEmitter({ Name: `${shape} Emitter`, Shape: shape, Position: [centre[0], centre[1] - half[1] * 0.8, centre[2]] });
        this.scene.Emitters.push(emitter);
        this.linkSource(emitter);
        this.select(emitter.Id);
        return emitter;
    }

    addParticles(templateId)
    {
        if (this.scene.Particles.length >= MaximumParticleSystems) return null;
        const template = ParticleTemplateById[templateId];
        const existing = this.scene.Particles.filter((node) => node.Template === templateId).length;
        const half = this.solver.domainHalfExtent, centre = this.solver.domainCentre;
        const node = createParticleSystem(templateId, {
            Name: existing > 0 ? `${template.Name} ${existing + 1}` : template.Name,
            Position: template.Defaults.Mode === 'Cloner' ? [...centre] : [centre[0], centre[1] + (template.Defaults.Direction && template.Defaults.Direction[1] < 0 ? half[1] * 0.9 : -half[1] * 0.85), centre[2]],
        });
        this.scene.Particles.push(node);
        this.select(node.Id);
        return node;
    }

    addCollider()
    {
        const collider = createCollider({ Name: `Sphere Collider ${this.scene.Colliders.length + 1}`, Position: [0, 0, 0] });
        this.scene.Colliders.push(collider);
        this.select(collider.Id);
        return collider;
    }

    removeNode(id)
    {
        for (const key of ['Emitters', 'Forces', 'Colliders', 'Particles'])
        {
            const index = this.scene[key].findIndex((node) => node.Id === id);
            if (index >= 0)
            {
                this.scene[key].splice(index, 1);
                if (key === 'Emitters') { this.scene.GasStack.Layers = this.scene.GasStack.Layers.filter((layer) => !(layer.Category === SourceLayerCode && layer.Parameters.Emitter === id)); this.evaluateStack(); }
                if (this.selection === id) this.selection = 'domain';
                this.notify();
                return true;
            }
        }
        return false;
    }

    duplicateNode(id)
    {
        const node = this.findNode(id);
        if (!node || node.Kind === 'Domain' || node.Kind === 'Visualizer') return null;
        let copy;
        if (node.Kind === 'Force') { copy = createForceGenerator(node.Type, { ...node, Name: node.Name + ' Copy' }); this.scene.Forces.push(copy); }
        else if (node.Kind === 'Emitter') { copy = createEmitter({ ...node, Name: node.Name + ' Copy' }); this.scene.Emitters.push(copy); this.linkSource(copy); }
        else if (node.Kind === 'Particles') { if (this.scene.Particles.length >= MaximumParticleSystems) return null; copy = createParticleSystem(node.Template, { ...node, Name: node.Name + ' Copy' }); this.scene.Particles.push(copy); }
        else { copy = createCollider({ ...node, Name: node.Name + ' Copy' }); this.scene.Colliders.push(copy); }
        this.placeNode(copy, [node.Position[0] + 0.4, node.Position[1], node.Position[2]]);
        this.select(copy.Id);
        return copy;
    }

    updateNode(id, key, value)
    {
        const node = this.findNode(id);
        if (!node) return;
        if (this.routeToLayer(node, key, value)) { this.afterNodeUpdate(node, key); this.notify(); return; }
        node[key] = value;
        this.afterNodeUpdate(node, key);
        this.notify();
    }

    applyLook(id, look)
    {
        const node = this.findNode(id);
        if (!node) return;
        for (const [key, value] of Object.entries(look)) if (!this.routeToLayer(node, key, value)) node[key] = value;
        this.notify();
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  GAS LAYER STACK
    //------------------------------------------------------------------------------------------------------------------------

    /** Re-folds the gas stack into scene.Domain / Visualizers.Volume. Called after every stack edit (phase 4 adds per-step keys). */
    evaluateStack()
    {
        const previousAdvection = this.scene.Domain.Advection;
        this.gasEvaluation = evaluateGasStack(this.scene.GasStack, this.scene.Emitters);
        applyGasEvaluation(this.scene, this.gasEvaluation);
        return previousAdvection !== this.scene.Domain.Advection;
    }

    /**
     * Inspector edits of a flat field the stack owns (Domain dynamics, Volume Render shading, emitter Enabled) are written into the
     * owning layer, so every existing control keeps working and the stack stays the single source. Returns true when routed.
     */
    routeToLayer(node, key, value)
    {
        if (node.Kind === 'Particles') return this.routeToParticleLayer(node, key, value);
        const stack = this.scene && this.scene.GasStack;
        if (!stack) return false;
        if (node.Kind === 'Emitter' && key === 'Enabled')
        {
            const layer = stack.Layers.find((candidate) => candidate.Category === SourceLayerCode && candidate.Parameters.Emitter === node.Id);
            if (!layer) return false;
            layer.Enabled = Boolean(value);
            this.evaluateStack();
            return true;
        }
        const target = node.Kind === 'Domain' ? 'Domain' : node.Id === 'vis-volume' ? 'Volume' : null;
        const found = target && owningLayer(stack, target, key);
        if (!found) return false;
        let layer = found.Layer;
        if (!layer)
        {
            // No layer of this category yet: editing its field adds one, placed by phase order.
            layer = this.insertLayer(found.Owner.Layer.Code);
            if (!layer) return false;
        }
        layer.Parameters[key] = coerceAmount(found.Owner.Parameter, value);
        if (!layer.Enabled) layer.Enabled = true;
        this.evaluateStack();
        return true;
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  PARTICLE LAYER STACKS
    //------------------------------------------------------------------------------------------------------------------------

    /** Folds a particle node's stack into its flat fields; rebuilds the GPU state when the formation (mode, shape, count) changed. */
    evaluateParticles(node)
    {
        const before = `${node.Mode}|${node.Shape}|${node.Count}`;
        const evaluation = evaluateParticleSystem(node);
        if (`${node.Mode}|${node.Shape}|${node.Count}` !== before) this.particles.reset(node.Id);
        return evaluation;
    }

    /** Evaluation of a particle node's stack for the Inspector (problems, contributing layers). Pure; nothing is applied. */
    particleEvaluation(node) { return evaluateParticleStack(node.Stack); }

    /** Flat particle edits (gizmo drag, status tiles) write into the owning layer; a missing layer is added in phase order. */
    routeToParticleLayer(node, key, value)
    {
        if (!node.Stack) return false;
        const found = owningLayer(node.Stack, 'Particles', key);
        if (!found) return false;
        let layer = found.Layer;
        if (!layer)
        {
            // The new layer starts at the node's current (neutral) amounts, so only the edited field moves.
            const current = Object.fromEntries(found.Owner.Layer.Parameter.map((parameter) => [parameter.Name, parameter.Type === 'Choice' ? (parameter.Options.find((option) => option.Token === node[parameter.Name]) || parameter.Options[0]).Code : node[parameter.Name]]));
            layer = insertLayerInPhaseOrder(node.Stack, found.Owner.Layer.Code, { Parameters: current });
            if (!layer) return false;
        }
        layer.Parameters[key] = coerceAmount(found.Owner.Parameter, value);
        if (!layer.Enabled) layer.Enabled = true;
        this.evaluateParticles(node);
        return true;
    }

    /** Moves a node; a particle system's position lives in its Spawn layer. */
    placeNode(node, position)
    {
        if (node.Kind === 'Particles' && this.routeToParticleLayer(node, 'Position', position)) return;
        node.Position = position;
    }

    /** The stack holding a layer token, and the particle node that owns it (null for the gas stack). */
    stackOfLayer(token)
    {
        if (this.scene.GasStack && this.scene.GasStack.Layers.some((layer) => layer.Token === token)) return { stack: this.scene.GasStack, node: null };
        for (const node of this.scene.Particles || []) if (node.Stack && node.Stack.Layers.some((layer) => layer.Token === token)) return { stack: node.Stack, node };
        return { stack: null, node: null };
    }

    /** Re-evaluates whichever stack a layer edit touched. Returns true when the gas advection scheme changed. */
    evaluateOwner(node)
    {
        if (node) { this.evaluateParticles(node); return false; }
        return this.evaluateStack();
    }

    linkSource(emitter)
    {
        const stack = this.scene.GasStack;
        if (!stack) return;
        const layer = createLinkedSource(emitter);
        const lastSource = stack.Layers.map((candidate) => candidate.Category).lastIndexOf(SourceLayerCode);
        stack.Layers.splice(lastSource >= 0 ? lastSource + 1 : Math.min(1, stack.Layers.length), 0, layer);
        this.evaluateStack();
    }

    /** Inserts a new layer after the last layer of the same or an earlier phase; returns null at capacity. */
    insertLayer(categoryCode, stack = this.scene.GasStack)
    {
        return insertLayerInPhaseOrder(stack, categoryCode);
    }

    addLayer(categoryCode)
    {
        if (categoryCode === SourceLayerCode) { this.addEmitter('Sphere'); return null; }
        const specification = LayerSpecificationByCode[categoryCode];
        // Particle layers go into the selected particle system's stack.
        const node = specification && specification.Stack === 'ParticleCloud' ? this.findNode(this.selection) : null;
        if (specification && specification.Stack === 'ParticleCloud' && (!node || node.Kind !== 'Particles')) return null;
        const layer = this.insertLayer(categoryCode, node ? node.Stack : this.scene.GasStack);
        if (!layer) return null;
        this.selectedLayer = layer.Token;
        this.evaluateOwner(node);
        this.notify();
        return layer;
    }

    removeLayer(token)
    {
        const { stack, node } = this.stackOfLayer(token);
        if (!stack) return false;
        const layer = stack.Layers.find((candidate) => candidate.Token === token);
        const specification = LayerSpecificationByCode[layer.Category];
        if (specification && specification.Required) return false;
        if (specification && specification.Code === SourceLayerCode) return this.removeNode(layer.Parameters.Emitter);
        stack.Layers.splice(stack.Layers.indexOf(layer), 1);
        if (this.selectedLayer === token) this.selectedLayer = null;
        this.evaluateOwner(node);
        this.notify();
        return true;
    }

    /** Moves a layer to `index` (drag) — the required Domain layer stays first. */
    moveLayer(token, index)
    {
        const { stack, node } = this.stackOfLayer(token);
        if (!stack) return;
        const layers = stack.Layers;
        const from = layers.findIndex((candidate) => candidate.Token === token);
        const specification = LayerSpecificationByCode[layers[from].Category];
        if (specification && specification.Required) return;
        const [layer] = layers.splice(from, 1);
        const firstFree = layers.findIndex((candidate) => !(LayerSpecificationByCode[candidate.Category] || {}).Required);
        layers.splice(Math.max(firstFree < 0 ? layers.length : firstFree, Math.min(layers.length, index)), 0, layer);
        this.evaluateOwner(node);
        this.notify();
    }

    selectLayer(token)
    {
        this.selectedLayer = token;
        const { stack } = this.stackOfLayer(token);
        const layer = stack && stack.Layers.find((candidate) => candidate.Token === token);
        if (layer && layer.Category === SourceLayerCode && this.findNode(layer.Parameters.Emitter)) { this.select(layer.Parameters.Emitter); return; }
        this.notify();
    }

    /** Edits a layer's own settings (Enabled, Solo, Weight, Blend) or, with `parameter`, one of its parameters. */
    updateLayer(token, key, value, parameter = false)
    {
        const { stack, node } = this.stackOfLayer(token);
        const layer = stack && stack.Layers.find((candidate) => candidate.Token === token);
        if (!layer) return;
        const specification = LayerSpecificationByCode[layer.Category];
        if (parameter)
        {
            const entry = specification && specification.Parameter.find((candidate) => candidate.Name === key);
            if (!entry) return;
            layer.Parameters[key] = coerceAmount(entry, value);
        }
        else if (key === 'Weight') layer.Weight = Math.min(1, Math.max(0, Number(value) || 0));
        else if (key === 'Enabled' || key === 'Solo') layer[key] = Boolean(value);
        else if (key === 'Blend') layer.Blend = [0, 1, 2, 3].includes(value) ? value : 0;
        else return;
        if (specification && specification.Required && key === 'Enabled') layer.Enabled = true;
        const advectionChanged = this.evaluateOwner(node);
        if (advectionChanged) this.afterNodeUpdate(this.scene.Domain, 'Advection');
        this.notify();
    }

    afterNodeUpdate(node, key)
    {
        if (node.Kind === 'Domain' && key === 'Follow') this.followGrid();
        if (node.Kind === 'Domain' && key === 'Grid')
        {
            // The fixed box floor sits at −Size.y/2; the infinite grid's ground is y = 0. Lift / lower every node so the scene
            // keeps standing on the floor when the mode flips.
            const lift = node.Size[1] * 0.5 * (node.Grid === 'Infinite' ? 1 : -1);
            for (const list of [this.scene.Emitters, this.scene.Forces, this.scene.Colliders, this.scene.Particles || []]) for (const item of list) this.placeNode(item, [item.Position[0], item.Position[1] + lift, item.Position[2]]);
            this.applyDomainResolution();
            this.solver.reset();
            this.particles.resetAll();
            this.camera.frame(this.solver.domainHalfExtent, this.solver.domainCentre);
        }
        if (node.Kind === 'Domain' && (key === 'TileSize' || key === 'TileResolution' || key === 'TilePool'))
        {
            this.applyDomainResolution();
        }
        if (node.Kind === 'Domain' && (key === 'Size' || key === 'MaxCells' || key === 'Tiles'))
        {
            node.Size = node.Size.map((extent) => Math.max(0.5, Math.min(20, extent)));
            this.applyDomainResolution();
            this.camera.frame(this.solver.domainHalfExtent, this.solver.domainCentre);
        }
        if (node.Kind === 'Visualizer' && key === 'Lifetime' && node.Id === 'vis-tracers') this.solver.tracersNeedReset = true;
        if (node.Kind === 'Visualizer' && key === 'Lifetime' && node.Id === 'vis-debris') this.solver.debrisNeedReset = true;
        if (node.Kind === 'Particles' && (key === 'Mode' || key === 'Shape' || key === 'Count')) this.particles.reset(node.Id);
        if ((node.Kind === 'Force' || node.Kind === 'Emitter' || node.Kind === 'Particles') && (key === 'StartTime' || key === 'Duration' || key === 'Repeat') && this.solver.time > (node.StartTime || 0) + (node.Duration || 0) + 0.5) this.solver.reset();
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  TRANSPORT
    //------------------------------------------------------------------------------------------------------------------------

    play() { this.playing = true; this.notify(); }
    pause() { this.playing = false; this.notify(); }
    togglePlay() { this.playing = !this.playing; this.notify(); }
    stepOnce() { this.playing = false; this.stepRequested = true; this.notify(); }
    reset() { this.solver.reset(); this.particles.resetAll(); this.notify(); }
    frameDomain() { this.camera.frame(this.solver.domainHalfExtent, this.solver.domainCentre); }

    setCameraPreset(name)
    {
        const presets = { threeQuarter: [-0.65, 0.32], front: [0, 0.08], side: [Math.PI / 2, 0.08], top: [-0.65, 1.35] };
        const [yaw, pitch] = presets[name] || presets.threeQuarter;
        this.camera.yaw = yaw;
        this.camera.pitch = pitch;
        this.camera.frame(this.solver.domainHalfExtent, this.solver.domainCentre);
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  SERIALISATION
    //------------------------------------------------------------------------------------------------------------------------

    exportJson()
    {
        const { Domain, Emitters, Forces, Colliders, Particles, Visualizers, Name, GasStack } = this.scene;
        // Version 3 adds the gas layer stack, Version 4 a layer stack per particle system (Particles[n].Stack). Flat fields still hold the
        // evaluated amounts so Version 2 / 3 readers keep working.
        return JSON.stringify({ Format: 'FrontierFluidScene', Version: 4, SpecificationHash, Name, Domain, Emitters, Forces, Colliders, Particles, Visualizers, GasStack }, null, 2);
    }

    /** Current scene as a `frontier-fluid-preset` TOML document (Save as preset). Add it to Presets/ and run GeneratePresetLibrary.mjs. */
    exportPresetToml(summary = {})
    {
        const document = sceneToDocument(this.scene, summary);
        return `# ${document.Scene.Name} — Fluid Studio scene preset (saved from the editor).\n\n` + writeToml(document, FloatKeys);
    }

    importJson(text)
    {
        const data = JSON.parse(text);
        if (data.Format !== 'FrontierFluidScene') throw new Error('Not a FrontierFluidScene document.');
        const domain = createDomain(data.Domain);
        this.scene = {
            Name: data.Name || 'Imported Scene',
            PresetId: null,
            Domain: domain,
            Emitters: (data.Emitters || []).map((emitter) => createEmitter(emitter)),
            Forces: (data.Forces || []).map((force) => createForceGenerator(force.Type, force)),
            Colliders: (data.Colliders || []).map((collider) => createCollider(collider)),
            Particles: (data.Particles || []).map((node) => createParticleSystem(node.Template, node)),
            Visualizers: Object.fromEntries(Object.entries(createVisualizerSet()).map(([key, defaults]) => [key, { ...defaults, ...((data.Visualizers || {})[key] || {}) }])),
        };
        // Version 2 files have no stack: convert their flat fields exactly. Stack links follow emitter ids only when they still exist.
        this.scene.GasStack = data.GasStack ? readGasStack(data.GasStack) : convertSceneToGasStack(this.scene);
        if (data.GasStack)
        {
            // Emitters get fresh ids on import; carry each Source link across by the emitter's position in the file.
            const renamed = new Map((data.Emitters || []).map((emitter, index) => [emitter.Id, this.scene.Emitters[index] && this.scene.Emitters[index].Id]));
            for (const layer of this.scene.GasStack.Layers) if (layer.Category === SourceLayerCode && renamed.get(layer.Parameters.Emitter)) layer.Parameters.Emitter = renamed.get(layer.Parameters.Emitter);
            const linked = new Set(this.scene.GasStack.Layers.filter((layer) => layer.Category === SourceLayerCode).map((layer) => layer.Parameters.Emitter));
            for (const emitter of this.scene.Emitters) if (!linked.has(emitter.Id)) this.scene.GasStack.Layers.splice(1, 0, createLinkedSource(emitter));
        }
        this.selectedLayer = null;
        this.evaluateStack();
        this.applyDomainResolution();
        this.selection = 'domain';
        this.notify();
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  VIEWPORT INPUT
    //------------------------------------------------------------------------------------------------------------------------

    attachInput()
    {
        const canvas = this.canvas;
        canvas.addEventListener('contextmenu', (event) => event.preventDefault());
        canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
        window.addEventListener('pointermove', (event) => this.onPointerMove(event));
        window.addEventListener('pointerup', (event) => this.onPointerUp(event));
        canvas.addEventListener('wheel', (event) => { event.preventDefault(); this.camera.dolly(event.deltaY); }, { passive: false });
        window.addEventListener('keydown', (event) =>
        {
            if (event.target && (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT' || event.target.tagName === 'TEXTAREA')) return;
            if (event.code === 'Space') { event.preventDefault(); this.togglePlay(); }
            else if (event.key === 'f' || event.key === 'F') this.frameDomain();
            else if (event.key === 'r' || event.key === 'R') this.reset();
            else if (event.key === 'Delete' || event.key === 'Backspace') { if (this.selection && this.selection !== 'domain') this.removeNode(this.selection); }
            else if (event.key === '.') this.stepOnce();
        });
    }

    localPointer(event)
    {
        const rect = this.canvas.getBoundingClientRect();
        return [event.clientX - rect.left, event.clientY - rect.top];
    }

    pickableNodes()
    {
        const nodes = [];
        const show = (node) => (this.scene.Visualizers.ForceGizmos.Visible ? node.Visible : node.Id === this.selection);
        for (const force of this.scene.Forces) if (show(force)) nodes.push(force);
        for (const emitter of this.scene.Emitters) if (show(emitter)) nodes.push(emitter);
        for (const node of this.scene.Particles) if (show(node)) nodes.push(node);
        for (const collider of this.scene.Colliders) if (collider.Visible) nodes.push(collider);
        return nodes;
    }

    pick(x, y)
    {
        if (!this.lastMatrices) return null;
        let best = null, bestDistance = 26;
        for (const node of this.pickableNodes())
        {
            const screen = this.camera.project(this.lastMatrices.viewProjection, node.Kind === 'Emitter' ? emitterTransform(node, this.solver.time).Position : node.Position);
            if (!screen) continue;
            const distance = Math.hypot(screen[0] - x, screen[1] - y);
            if (distance < bestDistance) { best = node; bestDistance = distance; }
        }
        return best;
    }

    onPointerDown(event)
    {
        const [x, y] = this.localPointer(event);
        this.canvas.setPointerCapture(event.pointerId);
        this.pointer.x = x; this.pointer.y = y; this.pointer.moved = false;
        if (event.button === 0)
        {
            const hit = this.pick(x, y);
            if (hit)
            {
                this.pointer.mode = 'drag';
                this.pointer.dragNode = hit;
                this.pointer.dragStart = [...hit.Position];
                this.select(hit.Id);
                return;
            }
            this.pointer.mode = 'orbit';
        }
        else this.pointer.mode = 'pan';
    }

    onPointerMove(event)
    {
        const [x, y] = this.localPointer(event);
        const dx = x - this.pointer.x, dy = y - this.pointer.y;
        if (!this.pointer.mode)
        {
            const hit = this.pick(x, y);
            this.canvas.style.cursor = hit ? 'grab' : 'default';
            return;
        }
        if (Math.abs(dx) + Math.abs(dy) > 0) this.pointer.moved = true;
        if (this.pointer.mode === 'orbit') this.camera.orbit(dx, dy);
        else if (this.pointer.mode === 'pan') this.camera.pan(dx, dy);
        else if (this.pointer.mode === 'drag' && this.lastMatrices)
        {
            // Move the node on the camera-facing plane through its original position.
            const node = this.pointer.dragNode;
            const normal = Vec3.scale(this.camera.forward, -1);
            const ray = this.camera.rayFromScreen(this.lastMatrices.inverseViewProjection, x, y);
            const startRay = this.camera.rayFromScreen(this.lastMatrices.inverseViewProjection, this.pointer.x, this.pointer.y);
            const planePoint = this.pointer.dragStart;
            const intersect = (r) =>
            {
                const denominator = Vec3.dot(r.direction, normal);
                if (Math.abs(denominator) < 1e-6) return null;
                const t = Vec3.dot(Vec3.sub(planePoint, r.origin), normal) / denominator;
                return Vec3.add(r.origin, Vec3.scale(r.direction, t));
            };
            const current = intersect(ray), start = intersect(startRay);
            if (current && start)
            {
                const offset = Vec3.sub(current, start);
                const half = this.solver.domainHalfExtent, centre = this.solver.domainCentre;
                const position = Vec3.add(planePoint, event.shiftKey ? [offset[0], 0, offset[2]] : offset);
                this.placeNode(node, position.map((value, axis) => Math.max(centre[axis] - half[axis] * 1.5, Math.min(centre[axis] + half[axis] * 1.5, Math.round(value * 100) / 100))));
                this.onStateChange(this.snapshot());
            }
            return;
        }
        this.pointer.x = x; this.pointer.y = y;
    }

    onPointerUp(event)
    {
        if (!this.pointer.mode) return;
        if (this.pointer.mode === 'orbit' && !this.pointer.moved)
        {
            this.select('domain');
        }
        this.pointer.mode = null;
        this.pointer.dragNode = null;
        try { this.canvas.releasePointerCapture(event.pointerId); } catch (error) { /* pointer already released */ }
    }
}
