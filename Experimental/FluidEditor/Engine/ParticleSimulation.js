//------------------------------------------------------------------------------------------------------------------------
//                                                  PARTICLE SIMULATION
//     GPU Owner for Every Particle System Node: Per-System Ping-Pong State, Emit / Cloner Update, Sprite + Streak Render
//
//  The simulation is deliberately decoupled from the fluid solver: it only borrows the solver's force-generator
//  uniforms (so the same gizmos drive gas and particles), its velocity volume (gas coupling) and its grid layout.
//  Each scene node of Kind 'Particles' owns one state record keyed by node Id; records are created lazily and
//  destroyed when their node disappears, so adding and deleting systems at runtime is free of bookkeeping elsewhere.
//------------------------------------------------------------------------------------------------------------------------

import * as ParticleShaders from './ParticleShaders.js';
import { FullscreenVertex, sparse } from './FluidShaders.js';
import { ParticleShapes, ParticleModes, ParticleColourModes, ParticleBlendModes, ParticleRenderStyles, ParticleRampSources, ParticleSprites, ParticleSizeModes, ParticleTrailModes, ParticleTrailColours, MaximumPaletteStops, particleTextureSide, effectiveTrailLength, HaltedParticleSystems } from './ParticleCatalog.js';
import { ColourRamps, timingEnvelope } from './ForceGeneratorCatalog.js';

function hexToRgb(hex)
{
    const value = parseInt(hex.replace('#', ''), 16);
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function normalise(vector)
{
    const length = Math.hypot(vector[0], vector[1], vector[2]);
    return length > 1e-6 ? [vector[0] / length, vector[1] / length, vector[2] / length] : [0, 1, 0];
}

export class ParticleSimulation
{
    get programs()
    {
        const key = this.solver.sparse ? 'sparse' : 'fixed';
        if (!this.programSets[key]) this.programSets[key] = this.buildPrograms(this.solver.sparse);
        return this.programSets[key];
    }

    buildPrograms(sparseMode)
    {
        const context = this.context;
        const t = sparseMode ? sparse : (source) => source;
        const suffix = sparseMode ? '.sparse' : '';
        return {
            update: context.createProgram('ParticleUpdate' + suffix, FullscreenVertex, t(ParticleShaders.ParticleUpdateFragment)),
            render: context.createProgram('ParticleRender' + suffix, t(ParticleShaders.ParticleRenderVertex), ParticleShaders.ParticleFragment),
            trailUpdate: context.createProgram('TrailUpdate' + suffix, FullscreenVertex, t(ParticleShaders.TrailUpdateFragment)),
            trails: context.createProgram('Trails' + suffix, t(ParticleShaders.TrailVertex), ParticleShaders.ParticleFragment),
        };
    }

    constructor(context, solver)
    {
        this.context = context;
        this.gl = context.gl;
        this.solver = solver;
        this.records = new Map();
        this.programSets = {};
        this.emptyVao = this.gl.createVertexArray();
        this.statistics = { systems: 0, particles: 0 };
        this.paletteScratch = new Float32Array(MaximumPaletteStops * 3);
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  STATE RECORDS
    //------------------------------------------------------------------------------------------------------------------------

    record(node)
    {
        const side = particleTextureSide(node.Count);
        let record = this.records.get(node.Id);
        if (record && record.side !== side) { this.destroyRecord(record); record = null; }
        if (!record)
        {
            const context = this.context;
            record = {
                side,
                positions: context.createPingPong(side, side, { rgba32f: true, nearest: true }),
                velocities: context.createPingPong(side, side, { rgba32f: true, nearest: true }),
                previous: context.createTarget(side, side, { rgba32f: true, nearest: true }),
                needsReset: true,
                signature: '',
            };
            this.records.set(node.Id, record);
        }
        // Formation-defining parameters rebuild the cloner homes; emitters simply keep flowing.
        const signature = `${node.Mode}|${node.Shape}|${node.Count}`;
        if (record.signature !== signature) { record.needsReset = true; record.signature = signature; }
        // Trail history is allocated on demand and rebuilt when its length changes.
        const wantsTrail = node.Trail && node.Trail !== 'Off';
        const trailLength = effectiveTrailLength(node.Count, node.TrailLength);
        if (wantsTrail && (!record.trails || record.trailLength !== trailLength))
        {
            if (record.trails) this.context.destroyPingPong(record.trails);
            record.trails = this.context.createPingPong(side, side * trailLength, { rgba32f: true, nearest: true });
            record.trailLength = trailLength;
            record.trailHead = 0;
            record.trailClock = 0;
            record.trailNeedsReset = true;
        }
        else if (!wantsTrail && record.trails) { this.context.destroyPingPong(record.trails); record.trails = null; }
        return record;
    }

    destroyRecord(record)
    {
        this.context.destroyPingPong(record.positions);
        this.context.destroyPingPong(record.velocities);
        this.context.destroyTarget(record.previous);
        if (record.trails) this.context.destroyPingPong(record.trails);
    }

    updateTrails(node, record, deltaTime)
    {
        const gl = this.gl, context = this.context;
        record.trailClock += deltaTime;
        const advance = record.trailClock >= node.TrailInterval || record.trailNeedsReset;
        if (advance)
        {
            record.trailClock = 0;
            record.trailHead = (record.trailHead + 1) % record.trailLength;
        }
        const uniforms = context.use(this.programs.trailUpdate);
        context.bindTexture('uTrails', record.trails.read.texture);
        context.bindTexture('uPositions', record.positions.read.texture);
        context.bindTexture('uPrevious', record.previous.texture);
        gl.uniform1i(uniforms.uTrailLength, record.trailLength);
        gl.uniform1i(uniforms.uHead, record.trailHead);
        gl.uniform1i(uniforms.uAdvance, advance ? 1 : 0);
        gl.uniform1i(uniforms.uReset, record.trailNeedsReset ? 1 : 0);
        gl.uniform1f(uniforms.uLifetime, node.Mode === 'Cloner' ? 0 : Math.max(0.05, node.Lifetime));
        context.dispatch(record.trails.write);
        record.trails.swap();
        record.trailNeedsReset = false;
    }

    prune(scene)
    {
        const live = new Set(scene.Particles.map((node) => node.Id));
        for (const [id, record] of [...this.records]) if (!live.has(id)) { this.destroyRecord(record); this.records.delete(id); }
    }

    resetAll()
    {
        for (const record of this.records.values()) record.needsReset = true;
    }

    reset(nodeId)
    {
        const record = this.records.get(nodeId);
        if (record) record.needsReset = true;
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  SHAPE UNIFORMS (shared by update + render)
    //------------------------------------------------------------------------------------------------------------------------

    applyShapeUniforms(uniforms, node, record)
    {
        const gl = this.gl;
        const axis = normalise(node.Direction);
        gl.uniform1i(uniforms.uShape, Math.max(0, ParticleShapes.indexOf(node.Shape)));
        gl.uniform3f(uniforms.uOrigin, node.Position[0], node.Position[1], node.Position[2]);
        gl.uniform3f(uniforms.uAxis, axis[0], axis[1], axis[2]);
        gl.uniform1f(uniforms.uRadius, Math.max(0.01, node.Radius));
        gl.uniform1f(uniforms.uFill, node.Fill);
        gl.uniform1i(uniforms.uCount, Math.min(node.Count, record.side * record.side));
        gl.uniform2i(uniforms.uParticleSize, record.side, record.side);
        gl.uniform1i(uniforms.uMode, Math.max(0, ParticleModes.indexOf(node.Mode)));
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  UPDATE
    //------------------------------------------------------------------------------------------------------------------------

    update(scene, deltaTime)
    {
        const solver = this.solver;
        if (!solver.fields) return;
        this.prune(scene);
        const gl = this.gl, context = this.context;
        gl.disable(gl.BLEND);
        this.statistics.systems = 0;
        this.statistics.particles = 0;
        for (const node of scene.Particles)
        {
            // A stack that cannot evaluate (no Spawn layer, over capacity) holds this system; the rest of the scene keeps running.
            if (!node.Enabled || HaltedParticleSystems.has(node)) continue;
            const record = this.record(node);
            if (deltaTime <= 0 && !record.needsReset) continue;
            this.statistics.systems += 1;
            this.statistics.particles += node.Count;
            const copyPrevious = () =>
            {
                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, record.positions.read.framebuffer);
                gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, record.previous.framebuffer);
                gl.blitFramebuffer(0, 0, record.side, record.side, 0, 0, record.side, record.side, gl.COLOR_BUFFER_BIT, gl.NEAREST);
                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
                gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
            };
            copyPrevious();
            const uniforms = context.use(this.programs.update);
            solver.applyVolumeUniforms(uniforms);
            solver.applyForceUniforms(uniforms);
            this.applyShapeUniforms(uniforms, node, record);
            gl.uniform1f(uniforms.uDeltaTime, deltaTime);
            gl.uniform1f(uniforms.uEnvelope, timingEnvelope(node, solver.time));
            gl.uniform1f(uniforms.uRate, node.Rate);
            gl.uniform1f(uniforms.uLifetime, Math.max(0.05, node.Lifetime));
            gl.uniform1f(uniforms.uSpeed, node.Speed);
            gl.uniform1f(uniforms.uSpread, node.Spread);
            gl.uniform1f(uniforms.uRadial, node.Radial);
            gl.uniform1f(uniforms.uGravity, node.Gravity);
            gl.uniform1f(uniforms.uDrag, node.Drag);
            gl.uniform1f(uniforms.uNoise, node.Noise);
            gl.uniform1f(uniforms.uFieldInfluence, node.FieldInfluence);
            gl.uniform1f(uniforms.uGasInfluence, node.GasInfluence);
            gl.uniform1f(uniforms.uSpring, node.Spring);
            gl.uniform1f(uniforms.uDamping, node.Damping);
            gl.uniform1f(uniforms.uBounce, node.Bounce);
            gl.uniform1f(uniforms.uNoiseScale, node.NoiseScale);
            gl.uniform1f(uniforms.uNoiseSpeed, node.NoiseSpeed);
            gl.uniform1f(uniforms.uDissolve, node.Dissolve);
            gl.uniform1f(uniforms.uLinger, node.Linger);
            for (const output of [0, 1])
            {
                context.textureUnit = 0;
                context.bindTexture('uPositions', record.positions.read.texture);
                context.bindTexture('uVelocities', record.velocities.read.texture);
                context.bindTexture('uVelocity', solver.fields.velocity.read.texture);
                gl.uniform1i(uniforms.uOutput, output);
                gl.uniform1i(uniforms.uReset, record.needsReset ? 1 : 0);
                context.dispatch(output === 0 ? record.positions.write : record.velocities.write);
            }
            record.positions.swap();
            record.velocities.swap();
            if (record.needsReset) { record.needsReset = false; record.trailNeedsReset = true; copyPrevious(); }
            if (record.trails) this.updateTrails(node, record, deltaTime);
        }
    }

    applyShadeUniforms(uniforms, node)
    {
        const gl = this.gl;
        const palette = node.Palette && node.Palette.length ? node.Palette.slice(0, MaximumPaletteStops) : ['#ffffff'];
        this.paletteScratch.fill(0);
        palette.forEach((hex, index) => this.paletteScratch.set(hexToRgb(hex), index * 3));
        gl.uniform3fv(uniforms.uPalette, this.paletteScratch);
        gl.uniform1i(uniforms.uPaletteCount, palette.length);
        gl.uniform1i(uniforms.uColourMode, Math.max(0, ParticleColourModes.indexOf(node.ColourMode)));
        gl.uniform1i(uniforms.uRampMode, Math.max(0, ColourRamps.indexOf(node.Ramp)));
        gl.uniform1i(uniforms.uRampSource, Math.max(0, ParticleRampSources.indexOf(node.RampSource)));
        gl.uniform1f(uniforms.uHueJitter, node.HueJitter);
        gl.uniform1f(uniforms.uBrightnessJitter, node.BrightnessJitter);
        gl.uniform1f(uniforms.uCycleSpeed, node.CycleSpeed);
        gl.uniform1f(uniforms.uBrightness, node.Brightness);
        gl.uniform1f(uniforms.uLifetime, Math.max(0.05, node.Lifetime));
        gl.uniform1f(uniforms.uLinger, node.Linger);
        gl.uniform1f(uniforms.uMaxSpeed, node.MaxSpeed);
        gl.uniform1f(uniforms.uDisplacementRange, node.DisplacementRange);
        gl.uniform1f(uniforms.uFlicker, node.Flicker);
        gl.uniform1f(uniforms.uTime, this.solver.time);
        gl.uniform1f(uniforms.uDomainHeight, this.solver.domainHalfExtent[1] * 2);
    }

    applyCameraUniforms(uniforms, node, camera, pixelRatio)
    {
        const gl = this.gl;
        const viewportHeight = camera ? camera.viewport[1] * pixelRatio : 720;
        const fovY = camera ? camera.fovY : 0.733;
        gl.uniform1f(uniforms.uFocalPixels, viewportHeight / (2 * Math.tan(fovY / 2)));
        const cameraPosition = camera ? camera.position : [0, 0, 10];
        const cameraForward = camera ? camera.forward : [0, 0, -1];
        gl.uniform3f(uniforms.uCameraPosition, cameraPosition[0], cameraPosition[1], cameraPosition[2]);
        gl.uniform3f(uniforms.uCameraForward, cameraForward[0], cameraForward[1], cameraForward[2]);
        gl.uniform1i(uniforms.uSizeMode, Math.max(0, ParticleSizeModes.indexOf(node.SizeMode)));
    }

    renderTrails(node, record, matrices, camera, pixelRatio)
    {
        const gl = this.gl, context = this.context;
        const uniforms = context.use(this.programs.trails);
        context.bindTexture('uPositions', record.positions.read.texture);
        context.bindTexture('uVelocities', record.velocities.read.texture);
        context.bindTexture('uTrails', record.trails.read.texture);
        this.applyShapeUniforms(uniforms, node, record);
        this.applyShadeUniforms(uniforms, node);
        this.applyCameraUniforms(uniforms, node, camera, pixelRatio);
        gl.uniformMatrix4fv(uniforms.uViewProjection, false, matrices.viewProjection);
        gl.uniform1i(uniforms.uTrailLength, record.trailLength);
        gl.uniform1i(uniforms.uHead, record.trailHead);
        gl.uniform1i(uniforms.uSubdivisions, node.TrailSubdivisions);
        const stride = Math.max(1, Math.round(1 / Math.max(0.01, node.TrailRatio)));
        gl.uniform1i(uniforms.uStride, stride);
        const viewport = camera ? [camera.viewport[0] * pixelRatio, camera.viewport[1] * pixelRatio] : [1280, 720];
        gl.uniform2f(uniforms.uViewport, viewport[0], viewport[1]);
        gl.uniform1f(uniforms.uWidth, node.TrailWidth * (ParticleSizeModes.indexOf(node.SizeMode) === 1 ? pixelRatio : 1));
        gl.uniform1f(uniforms.uTaper, node.TrailTaper);
        gl.uniform1f(uniforms.uTrailFade, node.TrailFade);
        gl.uniform1i(uniforms.uTrailColour, Math.max(0, ParticleTrailColours.indexOf(node.TrailColour)));
        gl.uniform1i(uniforms.uSprite, 4);
        const count = Math.min(node.Count, record.side * record.side);
        const trailed = Math.ceil(count / stride);
        const vertices = trailed * record.trailLength * node.TrailSubdivisions * 6;
        gl.bindVertexArray(this.emptyVao);
        if (node.Glow > 0)
        {
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
            gl.uniform1f(uniforms.uHaloScale, 3.0);
            gl.uniform1f(uniforms.uHaloAlpha, 0.12 * node.Glow);
            gl.drawArrays(gl.TRIANGLES, 0, vertices);
            gl.blendFunc(gl.SRC_ALPHA, ParticleBlendModes.indexOf(node.Blend) === 1 ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
        }
        gl.uniform1f(uniforms.uHaloScale, 1);
        gl.uniform1f(uniforms.uHaloAlpha, 1);
        gl.drawArrays(gl.TRIANGLES, 0, vertices);
        gl.bindVertexArray(null);
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  RENDER
    //------------------------------------------------------------------------------------------------------------------------

    render(scene, matrices, pixelRatio = 1, camera = null)
    {
        const gl = this.gl, context = this.context, solver = this.solver;
        if (!solver.fields) return;
        gl.enable(gl.BLEND);
        for (const node of scene.Particles)
        {
            if (!node.Visible || !node.Enabled || HaltedParticleSystems.has(node)) continue;
            const record = this.records.get(node.Id);
            if (!record) continue;
            const additive = ParticleBlendModes.indexOf(node.Blend) === 1;
            gl.blendFunc(gl.SRC_ALPHA, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
            const trailMode = ParticleTrailModes.indexOf(node.Trail);
            if (record.trails && trailMode > 0) this.renderTrails(node, record, matrices, camera, pixelRatio);
            if (trailMode === 2) continue;
            const uniforms = context.use(this.programs.render);
            context.bindTexture('uPositions', record.positions.read.texture);
            context.bindTexture('uVelocities', record.velocities.read.texture);
            context.bindTexture('uPrevious', record.previous.texture);
            this.applyShapeUniforms(uniforms, node, record);
            this.applyShadeUniforms(uniforms, node);
            this.applyCameraUniforms(uniforms, node, camera, pixelRatio);
            gl.uniformMatrix4fv(uniforms.uViewProjection, false, matrices.viewProjection);
            gl.uniform1f(uniforms.uSizeStart, node.SizeStart);
            gl.uniform1f(uniforms.uSizeEnd, node.SizeEnd);
            gl.uniform1f(uniforms.uPixelRatio, pixelRatio);
            gl.uniform1f(uniforms.uSizeRandom, node.SizeRandom);
            gl.uniform1f(uniforms.uFocusDistance, node.FocusDistance);
            gl.uniform1f(uniforms.uAperture, node.Aperture);
            gl.uniform1i(uniforms.uSprite, Math.max(0, ParticleSprites.indexOf(node.Sprite)));
            const count = Math.min(node.Count, record.side * record.side);
            gl.bindVertexArray(this.emptyVao);
            gl.uniform1f(uniforms.uHaloScale, 1);
            gl.uniform1f(uniforms.uHaloAlpha, 1);
            if (ParticleRenderStyles.indexOf(node.Style) === 1)
            {
                gl.uniform1i(uniforms.uTrail, 1);
                gl.drawArrays(gl.LINES, 0, count * 2);
            }
            gl.uniform1i(uniforms.uTrail, 0);
            gl.drawArrays(gl.POINTS, 0, count);
            if (node.Glow > 0)
            {
                // Cheap bloom: a second, larger, fainter additive halo pass with the soft glow sprite.
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
                gl.uniform1i(uniforms.uSprite, 0);
                gl.uniform1f(uniforms.uHaloScale, 3.2);
                gl.uniform1f(uniforms.uHaloAlpha, 0.16 * node.Glow);
                gl.drawArrays(gl.POINTS, 0, count);
            }
            gl.bindVertexArray(null);
        }
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    destroy()
    {
        for (const record of this.records.values()) this.destroyRecord(record);
        this.records.clear();
    }
}
