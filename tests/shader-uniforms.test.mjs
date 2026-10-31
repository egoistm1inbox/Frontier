import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import * as erosionShaders from '../src/erosion/erosion-shaders.js';
import * as pipelineShaders from '../src/erosion/pipeline-shaders.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const engineSrc = readFileSync(resolve(root, 'src/erosion/gpu-erosion-engine.js'), 'utf8');
// The terrain stack pipeline re-binds some engine programs, so its uploads count too.
const pipelineSrc = readFileSync(resolve(root, 'src/erosion/terrain-stack-pipeline.js'), 'utf8');
const uploaderSrc = engineSrc + '\n' + pipelineSrc;
const allShaderSources = { ...erosionShaders, ...pipelineShaders };

/** Extracts `uniform <type> <name>[optional]` declarations from GLSL source. */
function declaredUniforms(src) {
  const out = new Set();
  const re = /^\s*uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?\w+\s+(\w+)/gm;
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  return out;
}

const declaredByShader = new Map();
for (const [name, src] of Object.entries(allShaderSources)) {
  if (typeof src === 'string' && src.includes('#version 300 es')) {
    declaredByShader.set(name, declaredUniforms(src));
  }
}

// A few shaders (e.g. the telemetry pass) live inline in the engine module.
const localShaderRe = /const\s+(\w+_FRAG|\w+_VERT)\s*=\s*`/g;
const localShaders = new Map();
let sm;
while ((sm = localShaderRe.exec(engineSrc))) {
  const start = sm.index + sm[0].length - 1;
  let i = start + 1;
  while (i < engineSrc.length && !(engineSrc[i] === '`' && engineSrc[i - 1] !== '\\')) i++;
  localShaders.set(sm[1], engineSrc.slice(start, i + 1));
}
for (const [name, src] of localShaders) declaredByShader.set(name, declaredUniforms(src));

const allDeclared = new Set();
for (const set of declaredByShader.values()) for (const u of set) allDeclared.add(u);

// Every program the engine links, resolved to its vertex + fragment shader constants.
const programRe = /this\.(prog\w+)\s*=\s*createProgram\(\s*gl\s*,\s*(\w+)\s*,\s*(\w+)/g;
const programs = [];
let pm;
while ((pm = programRe.exec(engineSrc))) {
  programs.push({ prog: pm[1], vert: pm[2], frag: pm[3] });
}

const located = new Set();
const locRe = /getUniformLocation\(\s*[^,]+,\s*'([^']+)'\s*\)/g;
let lm;
while ((lm = locRe.exec(uploaderSrc))) located.add(lm[1]);
// Texture units are bound through the _bindTex(prog, '<name>', ...) helper.
const bindRe = /_bindTex\(\s*[^,]+,\s*'([^']+)'/g;
let bm;
while ((bm = bindRe.exec(uploaderSrc))) located.add(bm[1]);

test('every engine program links shaders that this module can resolve', () => {
  assert.ok(programs.length >= 10, `expected the engine to link many programs, found ${programs.length}`);
  for (const p of programs) {
    assert.ok(allShaderSources[p.vert] || localShaders.has(p.vert), `${p.prog}: unknown vertex shader ${p.vert}`);
    assert.ok(allShaderSources[p.frag] || localShaders.has(p.frag), `${p.prog}: unknown fragment shader ${p.frag}`);
  }
});

test('every declared uniform is actually uploaded by the engine (no silent defaults)', () => {
  const orphaned = [];
  for (const [prog, p] of Object.entries(Object.fromEntries(programs.map((x) => [x.prog, x])))) {
    const decl = new Set([
      ...(declaredByShader.get(p.vert) || []),
      ...(declaredByShader.get(p.frag) || []),
    ]);
    for (const u of decl) if (!located.has(u)) orphaned.push(`${prog}.${u}`);
  }
  assert.deepEqual(orphaned, [], `uniforms never uploaded (they would read as 0): ${orphaned.join(', ')}`);
});

test('every getUniformLocation name is declared by some shader (catches typos)', () => {
  const typos = [...located].filter((u) => !allDeclared.has(u));
  assert.deepEqual(typos, [], `getUniformLocation on undeclared uniforms: ${typos.join(', ')}`);
});

test('render + cryo uniforms the recent work depends on exist and are wired', () => {
  for (const u of ['uFlatColors', 'uLayerVis', 'uRenderDomain', 'uSunCryo', 'uWindCryo', 'uClimate']) {
    assert.ok(allDeclared.has(u), `${u} must be declared by a shader`);
    assert.ok(located.has(u), `${u} must be uploaded by the engine`);
  }
});

test('rain wash is fed into the cryosphere sun uniform (4th component)', () => {
  const m = engineSrc.match(/getUniformLocation\(this\.progSnowCryo,\s*'uSunCryo'\),([\s\S]{0,400}?)\);/);
  assert.ok(m, 'uSunCryo upload must exist for the cryosphere pass');
  const args = [];
  let depth = 0;
  let cur = '';
  for (const ch of m[1]) {
    if (ch === '[' || ch === '(') depth++;
    if (ch === ']' || ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      args.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) args.push(cur.trim());
  assert.equal(args.length, 4, 'uSunCryo must be uploaded as a vec4 (sun xyz + rain wash)');
  assert.match(args[3], /rainIntensity/, 'the 4th component must be driven by rain intensity');
});
