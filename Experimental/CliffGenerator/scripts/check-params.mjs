// Wiring check: every inspector control key must exist in defaults, every group must have an
// icon and an outliner slot, every preset key must be a real parameter.
// Usage: node scripts/check-params.mjs
import { defaults, presets, groups, outlinerSections, stageOf } from '../src/params.js';
import { groupIcons } from '../src/icons.js';

let failures = 0;
const fail = (m) => { failures++; console.log(`FAIL: ${m}`); };

const known = new Set(Object.keys(defaults));
known.add('palette'); known.add('features');
const seen = new Set();
for (const g of groups) {
  if (!groupIcons[g.id]) fail(`group '${g.id}' has no icon`);
  if (!['terrain', 'rocks', 'mesh', 'live'].includes(g.stage)) fail(`group '${g.id}' bad stage '${g.stage}'`);
  for (const card of g.cards) {
    for (const [key, , min, max, step, unit] of card.controls || []) {
      if (!known.has(key)) fail(`control '${key}' (${g.id} / ${card.title}) not in defaults`);
      if (seen.has(key)) fail(`control '${key}' declared twice`);
      seen.add(key);
      if (unit !== 'color' && unit !== 'enum' && (min === undefined || max === undefined || !(max > min))) {
        fail(`control '${key}' has bad range [${min}, ${max}]`);
      }
      stageOf(key); // must not throw
    }
  }
}
const slotted = new Set(outlinerSections.flatMap((s) => s.ids));
for (const g of groups) if (!slotted.has(g.id)) fail(`group '${g.id}' missing from outlinerSections`);
for (const id of slotted) if (!groups.some((g) => g.id === id)) fail(`outliner slot '${id}' has no group`);
for (const [name, p] of Object.entries(presets)) {
  for (const k of Object.keys(p)) if (!known.has(k)) fail(`preset '${name}' sets unknown key '${k}'`);
}
// new-feature spot checks
for (const k of ['ruggedAmount', 'ruggedScale', 'strataBreak', 'strataSub', 'strataLateralMode', 'sdfRugged']) {
  if (!seen.has(k)) fail(`new param '${k}' has no inspector control`);
}
console.log(`${groups.length} groups, ${seen.size} controls, ${Object.keys(presets).length} presets`);
console.log(failures ? `${failures} PARAM FAILURE(S)` : 'PARAMS OK');
process.exit(failures ? 1 : 0);
