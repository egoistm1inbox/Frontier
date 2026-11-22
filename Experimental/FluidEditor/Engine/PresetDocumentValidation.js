//============================================================================================================================================
//                                                       PRESETDOCUMENTVALIDATION.JS
//============================================================================================================================================
// 🧩 Rules for `frontier-fluid-preset` documents. Kept apart from PresetScenes.js so the generator can check documents before the bundle
// (Engine/PresetLibrary.js) exists.

import { SourceLayerCode, LayerSpecificationByCode } from './LayerStack.js';

export const PresetDocumentFormat = 'frontier-fluid-preset';
export const PresetDocumentRevision = 1;

/** Rules a preset document must follow; an empty list means it loads. */
export function validatePresetDocument(document)
{
    const problems = [];
    const label = (document.Scene && document.Scene.Id) || 'preset';
    if (!document.Document || document.Document.Format !== PresetDocumentFormat) problems.push(`${label}: Document.Format must be "${PresetDocumentFormat}"`);
    if (document.Document && document.Document.Revision > PresetDocumentRevision) problems.push(`${label}: revision ${document.Document.Revision} is newer than this editor`);
    if (!document.Scene || !document.Scene.Id || !document.Scene.Name) problems.push(`${label}: Scene needs Id and Name`);
    if (!document.Grid || !Array.isArray(document.Grid.Resolution)) problems.push(`${label}: Grid.Resolution is required`);
    const volumes = document.Volume || [];
    if (volumes.length !== 1) problems.push(`${label}: exactly one gas volume expected (found ${volumes.length})`);
    const emitterTokens = new Set((document.Emitter || []).map((emitter) => emitter.Token));
    if (emitterTokens.size !== (document.Emitter || []).length) problems.push(`${label}: every emitter needs a unique Token`);
    for (const volume of volumes)
        for (const layer of volume.Layer || [])
        {
            if (layer.Category === SourceLayerCode && !emitterTokens.has(layer.Parameters.Emitter)) problems.push(`${label}: Source layer ${layer.Token} links a missing emitter`);
            if (!LayerSpecificationByCode[layer.Category]) problems.push(`${label}: layer ${layer.Token} has unknown category ${layer.Category}`);
        }
    for (const emitter of document.Emitter || [])
        if (!volumes.some((volume) => (volume.Layer || []).some((layer) => layer.Category === SourceLayerCode && layer.Parameters.Emitter === emitter.Token))) problems.push(`${label}: emitter ${emitter.Token} has no Source layer`);
    return problems;
}

