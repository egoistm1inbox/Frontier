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
import { ScenePresets, createDomain, createEmitter, createForceGenerator, createCollider, createVisualizerSet, ForceTypeById, resolveDomainGrid, emitterTransform, gridWindowCentre, gridTileOf } from './ForceGeneratorCatalog.js';
import { ParticleSimulation } from './ParticleSimulation.js';
import { createParticleSystem, ParticleTemplateById, MaximumParticleSystems } from './ParticleCatalog.js';

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
        if (!this.supported || !this.scene) return;
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
                if (domain.SceneLoop > 0 && this.solver.time >= domain.SceneLoop) { this.solver.reset(); this.particles.resetAll(); this.recentreGrid(); }
                this.followGrid();
                this.solver.step(this.scene, deltaTime);
                this.solver.updateTracers(deltaTime, this.scene.Visualizers.Tracers.Lifetime);
                this.solver.updateDebris(deltaTime, this.scene.Visualizers.Debris);
                this.particles.update(this.scene, deltaTime);
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
        const preset = ScenePresets.find((candidate) => candidate.Id === presetId) || ScenePresets[0];
        const domain = createDomain({ ...preset.Domain, Boundary: preset.Boundary });
        this.scene = {
            Name: preset.Name,
            PresetId: preset.Id,
            Domain: domain,
            Emitters: (preset.Emitters || []).map((emitter) => createEmitter(emitter)),
            Forces: (preset.Forces || []).map((force) => createForceGenerator(force.Type, force)),
            Colliders: (preset.Colliders || []).map((collider) => createCollider(collider)),
            Particles: (preset.Particles || []).map((node) => createParticleSystem(node.Template, node)),
            Visualizers: createVisualizerSet(),
        };
        Object.assign(this.scene.Visualizers.Volume, preset.Look || {});
        this.particles.resetAll();
        for (const [key, overrides] of Object.entries(preset.Visualizers || {})) Object.assign(this.scene.Visualizers[key], overrides);
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
        return { scene: this.scene, selection: this.selection, playing: this.playing, node: this.findNode(this.selection) };
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
        else if (node.Kind === 'Emitter') { copy = createEmitter({ ...node, Name: node.Name + ' Copy' }); this.scene.Emitters.push(copy); }
        else if (node.Kind === 'Particles') { if (this.scene.Particles.length >= MaximumParticleSystems) return null; copy = createParticleSystem(node.Template, { ...node, Name: node.Name + ' Copy' }); this.scene.Particles.push(copy); }
        else { copy = createCollider({ ...node, Name: node.Name + ' Copy' }); this.scene.Colliders.push(copy); }
        copy.Position = [node.Position[0] + 0.4, node.Position[1], node.Position[2]];
        this.select(copy.Id);
        return copy;
    }

    updateNode(id, key, value)
    {
        const node = this.findNode(id);
        if (!node) return;
        node[key] = value;
        this.afterNodeUpdate(node, key);
        this.notify();
    }

    applyLook(id, look)
    {
        const node = this.findNode(id);
        if (!node) return;
        Object.assign(node, look);
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
            for (const list of [this.scene.Emitters, this.scene.Forces, this.scene.Colliders, this.scene.Particles || []]) for (const item of list) item.Position = [item.Position[0], item.Position[1] + lift, item.Position[2]];
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
        const { Domain, Emitters, Forces, Colliders, Particles, Visualizers, Name } = this.scene;
        return JSON.stringify({ Format: 'FrontierFluidScene', Version: 2, Name, Domain, Emitters, Forces, Colliders, Particles, Visualizers }, null, 2);
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
                node.Position = position.map((value, axis) => Math.max(centre[axis] - half[axis] * 1.5, Math.min(centre[axis] + half[axis] * 1.5, Math.round(value * 100) / 100)));
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
