//============================================================================================================================================
//                                                               LAYERSTACK.JS
//============================================================================================================================================
// 🧩 Gas volume layer stack (Fluid layer stack plan, phases 1–2). A gas volume's behaviour is an ordered list of layers, each an instance of
// a LayerSpecifications.toml category. Evaluation folds the enabled layers, in order, into the flat blocks the solver and volume renderer
// already read (scene.Domain and scene.Visualizers.Volume), so the GPU code is unchanged and a converted preset simulates bit-identically.
//
// Unknown categories and unknown parameters are kept verbatim (inert) and written back unchanged, so newer files never lose data here.

import { LayerSpecificationDocument, SpecificationHash } from './LayerSpecifications.js';
import { parseToml, writeToml } from './TomlSubset.js';

function deepFreeze(value)
{
    if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
    return value;
}

export { SpecificationHash };
export const LayerDocumentFormat = 'frontier-effect-stack';
export const LayerDocumentRevision = 1;
export const MaximumLayers = LayerSpecificationDocument.Document.MaximumLayers;
export const LayerSpecifications = deepFreeze(JSON.parse(JSON.stringify(LayerSpecificationDocument.Layer)));
export const LayerSpecificationByCode = Object.freeze(Object.fromEntries(LayerSpecifications.map((layer) => [layer.Code, layer])));
export const GasLayerSpecifications = Object.freeze(LayerSpecifications.filter((layer) => layer.Stack === 'GasVolume'));
export const GasVolumeCategory = 1;
export const PhaseOrder = Object.freeze(['Inject', 'Advance', 'Shade', 'Overlay']);
export const BlendModes = Object.freeze([
    Object.freeze({ Code: 0, Token: 'Replace', Label: 'Replace' }),
    Object.freeze({ Code: 1, Token: 'Add', Label: 'Add' }),
    Object.freeze({ Code: 2, Token: 'Multiply', Label: 'Multiply' }),
    Object.freeze({ Code: 3, Token: 'Maximum', Label: 'Maximum' }),
]);
export const DomainLayerCode = 101;
export const SourceLayerCode = 102;

// Every parameter that writes into an evaluated block, by block and field name → { Layer, Parameter }.
export const ParameterOwners = Object.freeze(Object.fromEntries(['Domain', 'Volume'].map((target) => [target, Object.freeze(Object.fromEntries(
    GasLayerSpecifications.flatMap((layer) => layer.Parameter.filter((parameter) => parameter.Target === target).map((parameter) => [parameter.Name, Object.freeze({ Layer: layer, Parameter: parameter })])),
))])));

let LayerSequence = 0;
function allocateLayerToken(specification) { LayerSequence += 1; return `layer-${specification ? specification.Token : 'unknown'}-${LayerSequence}`; }

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const choiceToken = (parameter, code) => ((parameter.Options || []).find((option) => option.Code === code) || parameter.Options[0]).Token;
const choiceCode = (parameter, token) => { const option = (parameter.Options || []).find((entry) => entry.Token === token || entry.Code === token); return option ? option.Code : parameter.Default; };

/** Clamps / coerces an amount to its parameter type, or returns the Default when the amount is unusable. */
export function coerceAmount(parameter, value)
{
    switch (parameter.Type)
    {
        case 'Float32': return Number.isFinite(value) ? Math.min(parameter.Maximum, Math.max(parameter.Minimum, value)) : parameter.Default;
        case 'Int32': case 'UInt32': return Number.isFinite(value) ? Math.round(Math.min(parameter.Maximum, Math.max(parameter.Minimum, value))) : parameter.Default;
        case 'Bool': return typeof value === 'boolean' ? value : parameter.Default;
        case 'ColourLinear': return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : parameter.Default;
        case 'Choice': return (parameter.Options || []).some((option) => option.Code === value) ? value : choiceCode(parameter, value);
        case 'Token': return typeof value === 'string' ? value : parameter.Default;
        case 'Vector3': return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) ? [...value] : clone(parameter.Default);
        default: return clone(value);
    }
}

export function createLayer(categoryCode, overrides = {})
{
    const specification = LayerSpecificationByCode[categoryCode];
    if (!specification) throw new Error(`Unknown layer category ${categoryCode}`);
    const parameters = {};
    for (const parameter of specification.Parameter)
        parameters[parameter.Name] = coerceAmount(parameter, overrides.Parameters && parameter.Name in overrides.Parameters ? overrides.Parameters[parameter.Name] : clone(parameter.Default));
    return {
        Token: overrides.Token || allocateLayerToken(specification),
        Category: categoryCode,
        Enabled: overrides.Enabled ?? true,
        Solo: overrides.Solo ?? false,
        Weight: Number.isFinite(overrides.Weight) ? Math.min(1, Math.max(0, overrides.Weight)) : 1,
        Blend: BlendModes.some((mode) => mode.Code === overrides.Blend) ? overrides.Blend : 0,
        Parameters: parameters,
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  PRESET CONVERSION
//------------------------------------------------------------------------------------------------------------------------

/** The amount an evaluated block holds for a parameter, in specification units (Choice → code). */
function blockAmount(block, parameter)
{
    const value = block[parameter.Name];
    return parameter.Type === 'Choice' ? choiceCode(parameter, value) : value;
}

/**
 * Builds the gas stack that reproduces an already-resolved scene exactly: the Domain layer always, a Source layer per emitter, and each
 * behaviour or shading layer whenever any of its parameters differs from the Neutral amount. Amounts are copied, never rounded or
 * clamped, so evaluate(convert(scene)) equals the scene field for field (FluidValidation checks all 36 presets).
 */
export function convertSceneToGasStack(scene)
{
    const layers = [];
    for (const specification of GasLayerSpecifications)
    {
        if (specification.Code === SourceLayerCode)
        {
            for (const emitter of scene.Emitters || []) layers.push(createLinkedSource(emitter));
            continue;
        }
        const block = (specification.Parameter[0].Target === 'Volume') ? scene.Visualizers.Volume : scene.Domain;
        const amounts = Object.fromEntries(specification.Parameter.map((parameter) => [parameter.Name, blockAmount(block, parameter)]));
        const differs = specification.Parameter.some((parameter) => JSON.stringify(amounts[parameter.Name]) !== JSON.stringify(parameter.Neutral));
        if (!specification.Required && !differs) continue;
        const layer = createLayer(specification.Code);
        layer.Parameters = amounts;
        layers.push(layer);
    }
    return { Token: 'gas-volume', Category: GasVolumeCategory, Layers: layers };
}

export function createLinkedSource(emitter)
{
    return createLayer(SourceLayerCode, { Enabled: emitter.Enabled !== false, Parameters: { Emitter: emitter.Id } });
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  EVALUATION
//------------------------------------------------------------------------------------------------------------------------

function mixColour(from, to, amount)
{
    if (amount >= 1) return to;
    if (amount <= 0) return from;
    // Mix in linear light (plan §3.1 rule 7), then back to sRGB hex.
    const toLinear = (channel) => { const c = channel / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const toSrgb = (linear) => Math.round(255 * Math.min(1, Math.max(0, linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055)));
    const parse = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    const a = parse(from), b = parse(to);
    return '#' + a.map((channel, index) => toSrgb(toLinear(channel) + (toLinear(b[index]) - toLinear(channel)) * amount).toString(16).padStart(2, '0')).join('');
}

function blendAmount(parameter, current, amount, weight, blend)
{
    if (parameter.Type === 'ColourLinear') return mixColour(current, amount, weight);
    if (parameter.Type === 'Float32' || parameter.Type === 'Int32' || parameter.Type === 'UInt32')
    {
        // Weight 1 + Replace copies the amount exactly (no floating-point drift on converted presets).
        let next;
        if (blend === 1) next = current + (amount - parameter.Neutral) * weight;
        else if (blend === 2) next = current * (1 + (amount - 1) * weight);
        else if (blend === 3) next = Math.max(current, weight >= 1 ? amount : current + (amount - current) * weight);
        else next = weight >= 1 ? amount : current + (amount - current) * weight;
        return parameter.Type === 'Float32' ? next : Math.round(next);
    }
    // Bool, Choice, Vector3, Token: a contributing layer (Weight > 0) replaces.
    return amount;
}

/**
 * Folds the stack into evaluated blocks. Returns { Domain, Volume, Links, Problems, Stopped, Contributing }. `Stopped` is a reason when the
 * volume must not simulate (missing or misplaced required layer, capacity exceeded); the rest of the scene keeps running.
 */
export function evaluateGasStack(stack, emitters = [])
{
    const blocks = { Domain: {}, Volume: {} };
    const neutral = {};
    for (const [target, owners] of Object.entries(ParameterOwners))
        for (const [name, { Parameter }] of Object.entries(owners)) { blocks[target][name] = clone(Parameter.Neutral); neutral[name] = Parameter.Neutral; }
    const problems = [];
    let stopped = null;
    const layers = (stack && stack.Layers) || [];
    if (layers.length > MaximumLayers) { stopped = `More than ${MaximumLayers} layers`; problems.push({ Severity: 'Stop', Text: stopped }); }
    const required = GasLayerSpecifications.filter((specification) => specification.Required);
    for (const specification of required)
    {
        const index = layers.findIndex((layer) => layer.Category === specification.Code);
        if (index < 0) { stopped = stopped || `${specification.Name} layer missing`; problems.push({ Severity: 'Stop', Text: `${specification.Name} layer is required` }); }
        else if (index !== 0) { stopped = stopped || `${specification.Name} must be the first layer`; problems.push({ Severity: 'Stop', Token: layers[index].Token, Text: `${specification.Name} must be the first layer` }); }
    }
    const counts = {};
    for (const layer of layers)
    {
        const specification = LayerSpecificationByCode[layer.Category];
        if (!specification) { problems.push({ Severity: 'Info', Token: layer.Token, Text: `Unknown category ${layer.Category}: kept, not evaluated` }); continue; }
        if (specification.Stack !== 'GasVolume') { problems.push({ Severity: 'Stop', Token: layer.Token, Text: `${specification.Name} belongs to a ${specification.Stack}` }); stopped = stopped || `${specification.Name} is not a gas layer`; continue; }
        counts[layer.Category] = (counts[layer.Category] || 0) + 1;
        if (counts[layer.Category] > specification.Capacity) { problems.push({ Severity: 'Stop', Token: layer.Token, Text: `${specification.Name}: at most ${specification.Capacity}` }); stopped = stopped || `Too many ${specification.Name} layers`; }
    }
    const soloing = layers.some((layer) => layer.Solo && layer.Enabled);
    const contributing = new Set();
    const links = {};
    for (const layer of layers)
    {
        const specification = LayerSpecificationByCode[layer.Category];
        if (!specification || specification.Stack !== 'GasVolume') continue;
        const live = layer.Enabled && (!soloing || layer.Solo || specification.Required) && (specification.Required || layer.Weight > 0);
        if (specification.Linked === 'Emitter')
        {
            const token = layer.Parameters.Emitter;
            if (!emitters.some((emitter) => emitter.Id === token)) problems.push({ Severity: 'Warning', Token: layer.Token, Text: 'Linked emitter not found' });
            links[token] = Boolean(live);
            if (live) contributing.add(layer.Token);
            continue;
        }
        if (!live) continue;
        contributing.add(layer.Token);
        // The required layer always evaluates at full weight: a half-weighted Domain has no meaning.
        const weight = specification.Required ? 1 : layer.Weight;
        for (const parameter of specification.Parameter)
        {
            if (!(parameter.Target in blocks)) continue;
            const amount = layer.Parameters[parameter.Name];
            if (amount === undefined) continue;
            blocks[parameter.Target][parameter.Name] = blendAmount(parameter, blocks[parameter.Target][parameter.Name], amount, weight, layer.Blend);
        }
    }
    // Choice codes become the tokens the solver reads.
    for (const [target, owners] of Object.entries(ParameterOwners))
        for (const [name, { Parameter }] of Object.entries(owners)) if (Parameter.Type === 'Choice') blocks[target][name] = choiceToken(Parameter, blocks[target][name]);
    return { Domain: blocks.Domain, Volume: blocks.Volume, Links: links, Problems: problems, Stopped: stopped, Contributing: contributing };
}

/** Writes an evaluation into the scene blocks the solver and renderer read. */
export function applyGasEvaluation(scene, evaluation)
{
    Object.assign(scene.Domain, evaluation.Domain);
    Object.assign(scene.Visualizers.Volume, evaluation.Volume);
    for (const emitter of scene.Emitters || []) if (emitter.Id in evaluation.Links) emitter.Enabled = evaluation.Links[emitter.Id];
}

/** Which layer an inspector edit of a flat field belongs to: the last live layer of the owning category (it wins), else null. */
export function owningLayer(stack, target, name)
{
    const owner = ParameterOwners[target] && ParameterOwners[target][name];
    if (!owner) return null;
    const candidates = stack.Layers.filter((layer) => layer.Category === owner.Layer.Code);
    const live = candidates.filter((layer) => layer.Enabled);
    return { Owner: owner, Layer: (live.length ? live : candidates).at(-1) || null };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  DOCUMENTS
//------------------------------------------------------------------------------------------------------------------------

/** Reads one stack from a document (JSON object or parsed TOML). Unknown categories / parameters stay verbatim. */
export function readGasStack(source)
{
    const layers = [];
    for (const raw of (source && (source.Layers || source.Layer)) || [])
    {
        const specification = LayerSpecificationByCode[raw.Category];
        if (!specification)
        {
            layers.push(clone(raw));
            continue;
        }
        const layer = createLayer(raw.Category, raw);
        // Keep unknown parameter names (newer files) next to the known, coerced ones.
        for (const [name, value] of Object.entries(raw.Parameters || {})) if (!(name in layer.Parameters)) layer.Parameters[name] = clone(value);
        layers.push(layer);
    }
    return { Token: (source && source.Token) || 'gas-volume', Category: GasVolumeCategory, Layers: layers };
}

export function writeStackDocument(stacks)
{
    return {
        Document: { Format: LayerDocumentFormat, Revision: LayerDocumentRevision, SpecificationHash },
        Volume: stacks.map((stack) => ({ Token: stack.Token, Category: stack.Category, Layer: stack.Layers.map((layer) => clone(layer)) })),
    };
}

export function writeStackToml(stacks) { return writeToml(writeStackDocument(stacks), new Set(['Weight'])); }

export function readStackToml(text)
{
    const document = parseToml(text);
    if (!document.Document || document.Document.Format !== LayerDocumentFormat) throw new Error(`Not a ${LayerDocumentFormat} document`);
    if (document.Document.Revision > LayerDocumentRevision) throw new Error(`Revision ${document.Document.Revision} is newer than this editor (${LayerDocumentRevision})`);
    return { Hash: document.Document.SpecificationHash, Stacks: (document.Volume || []).map((volume) => readGasStack(volume)) };
}
