//============================================================================================================================================
//                                                              PRESETSCENES.JS
//============================================================================================================================================
// 🧩 Scene presets as data (Fluid layer stack plan §4, phase 2). Each preset is a `frontier-fluid-preset` TOML document in Presets/,
// bundled into Engine/PresetLibrary.js by GeneratePresetLibrary.mjs. Behaviour and shading live in the gas layer stack; grid, emitters,
// force fields and colliders are the document's flat entries (force fields stay flat by design); each particle system entry carries its
// own particle layer stack (phase 3).

import { PresetDocuments, PresetLibraryHash } from './PresetLibrary.js';
import { createDomain, createEmitter, createForceGenerator, createCollider, createVisualizerSet } from './ForceGeneratorCatalog.js';
import { createParticleSystem } from './ParticleCatalog.js';
import { readGasStack, evaluateGasStack, applyGasEvaluation, SourceLayerCode, SpecificationHash, LayerSpecificationByCode } from './LayerStack.js';
import { canonicalJson, specificationHash } from './LayerSpecificationValidation.js';

export { PresetLibraryHash };
export { PresetDocumentFormat, PresetDocumentRevision, validatePresetDocument } from './PresetDocumentValidation.js';
import { PresetDocumentFormat, PresetDocumentRevision } from './PresetDocumentValidation.js';

// Volume Render settings that are renderer choices, not look: they stay outside the stack.
export const RenderKeys = Object.freeze(['Exposure', 'Visible', 'Steps', 'Filter']);

/** Summary rows for the scene browser, plus the flat entries the catalogue checks read. */
export const ScenePresets = Object.freeze(PresetDocuments.map((document) => Object.freeze({
    Id: document.Scene.Id,
    Name: document.Scene.Name,
    Family: document.Scene.Family,
    Icon: document.Scene.Icon,
    Summary: document.Scene.Summary,
    Boundary: document.Scene.Boundary,
    Grid: document.Grid,
    Emitters: document.Emitter || [],
    Forces: document.Force || [],
    Colliders: document.Collider || [],
    Particles: document.Particle || [],
    Document: document,
})));
export const ScenePresetById = Object.freeze(Object.fromEntries(ScenePresets.map((preset) => [preset.Id, preset])));

const strip = (entry, keys) => Object.fromEntries(Object.entries(entry).filter(([key]) => !keys.includes(key)));

/** Builds a live scene from a preset document: entities get fresh ids, Source layers are relinked, the stack is evaluated. */
export function buildSceneFromDocument(document)
{
    const scene = {
        Name: document.Scene.Name,
        PresetId: document.Scene.Id,
        Domain: createDomain({ ...document.Grid, ...(document.Scene.Boundary ? { Boundary: document.Scene.Boundary } : {}) }),
        Emitters: [],
        Forces: (document.Force || []).map((force) => createForceGenerator(force.Type, force)),
        Colliders: (document.Collider || []).map((collider) => createCollider(collider)),
        // Particle entries carry their own layer stack (phase 3); entries without one (older documents) are template + flat overrides.
        Particles: (document.Particle || []).map((node) => createParticleSystem(node.Template, { ...strip(node, ['Template', 'Layer']), ...(node.Layer ? { Stack: { Layer: node.Layer } } : {}) })),
        Visualizers: createVisualizerSet(),
    };
    const relink = new Map();
    for (const entry of document.Emitter || [])
    {
        const emitter = createEmitter(strip(entry, ['Token']));
        relink.set(entry.Token, emitter.Id);
        scene.Emitters.push(emitter);
    }
    Object.assign(scene.Visualizers.Volume, document.Render || {});
    Object.assign(scene.Visualizers.Debris, document.Debris || {});
    const stack = readGasStack(JSON.parse(JSON.stringify(document.Volume[0])));
    for (const layer of stack.Layers) if (layer.Category === SourceLayerCode) layer.Parameters.Emitter = relink.get(layer.Parameters.Emitter) || layer.Parameters.Emitter;
    scene.GasStack = stack;
    applyGasEvaluation(scene, evaluateGasStack(stack, scene.Emitters));
    return scene;
}

/**
 * Identity of a resolved scene for conversion checks: every simulated and rendered field, with runtime ids (`emitter-1f` …) replaced
 * by their order of appearance so two loads compare equal. The stacks themselves are excluded; what they evaluate to is included.
 */
export function sceneFingerprint(scene)
{
    const { Name, Domain, Emitters, Forces, Colliders, Particles, Visualizers } = scene;
    const ids = new Map();
    const text = JSON.stringify({ Name, Domain, Emitters, Forces, Colliders, Particles, Visualizers }, (key, value) =>
    {
        if (key === 'Stack') return undefined;      // particle layer stacks: their evaluation (the node fields) is included
        if (typeof value === 'string' && /^(force|emitter|collider|particles)-[0-9a-z]+$/.test(value))
        {
            if (!ids.has(value)) ids.set(value, `node-${ids.size + 1}`);
            return ids.get(value);
        }
        return value;
    });
    return specificationHash(JSON.parse(text));
}

/** Library hash over every document (canonical), so a changed preset is visible in the validation log. */
export function presetLibraryHash(documents = PresetDocuments) { return specificationHash(documents.map((document) => JSON.parse(canonicalJson(document)))); }

/** A particle system as a preset entry: identity and timing flat, everything the GPU reads in its layer stack. */
export function particleEntry(node)
{
    const entry = { Template: node.Template, Name: node.Name };
    if (!node.Enabled) entry.Enabled = false;
    if (!node.Visible) entry.Visible = false;
    for (const key of ['StartTime', 'Duration', 'Fade', 'Repeat']) entry[key] = node[key];
    entry.Layer = node.Stack.Layers.map((layer, index) => ({ ...JSON.parse(JSON.stringify(layer)), Token: `layer-${index + 1}` }));
    return entry;
}

/** Current scene → preset document (Save as preset). Inverse of buildSceneFromDocument for everything the scene owns. */
export function sceneToDocument(scene, summary = {})
{
    const tokens = new Map(scene.Emitters.map((emitter, index) => [emitter.Id, `emitter-${index + 1}`]));
    const grid = Object.fromEntries(['Resolution', 'Size', 'MaxCells', 'Grid', 'TileSize', 'TileResolution', 'TilePool', 'Tiles', 'Follow']
        .filter((key) => scene.Domain[key] !== undefined).map((key) => [key, scene.Domain[key]]));
    const stack = JSON.parse(JSON.stringify(scene.GasStack));
    for (const layer of stack.Layers) if (layer.Category === SourceLayerCode) layer.Parameters.Emitter = tokens.get(layer.Parameters.Emitter) || layer.Parameters.Emitter;
    const drop = ['Id', 'Kind'];
    const document = {
        Document: { Format: PresetDocumentFormat, Revision: PresetDocumentRevision, SpecificationHash },
        Scene: { Id: summary.Id || scene.PresetId || 'preset-custom', Name: summary.Name || scene.Name, Family: summary.Family || 'Custom', Icon: summary.Icon || 'scene', Summary: summary.Summary || '', Boundary: scene.Domain.Boundary },
        Grid: grid,
        Render: Object.fromEntries(RenderKeys.map((key) => [key, scene.Visualizers.Volume[key]])),
        Debris: strip(scene.Visualizers.Debris, drop.concat(['Name'])),
        Volume: [{ Token: stack.Token, Category: stack.Category, Layer: stack.Layers }],
        Emitter: scene.Emitters.map((emitter) => ({ Token: tokens.get(emitter.Id), ...strip(emitter, drop) })),
        Force: scene.Forces.map((force) => strip(force, drop)),
        Collider: scene.Colliders.map((collider) => strip(collider, drop)),
        Particle: scene.Particles.map((node) => particleEntry(node)),
    };
    return document;
}
