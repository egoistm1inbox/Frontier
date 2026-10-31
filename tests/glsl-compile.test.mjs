import test from 'node:test';
import assert from 'node:assert/strict';

import * as ErosionShaders from '../src/erosion/erosion-shaders.js';
import * as PipelineShaders from '../src/erosion/pipeline-shaders.js';

/**
 * Real GLSL ES 3.00 compilation via the Khronos glslang WASM front-end.
 *
 * This is the only way to catch shader syntax/linking errors without a GPU in CI: WebGL only
 * reports them at runtime, in the browser, where a single bad keyword silently blanks the canvas.
 */
const PROBE_VERT = `#version 300 es
precision highp float;
in vec2 aGridUv;
void main() { gl_Position = vec4(aGridUv, 0.0, 1.0); }`;

const PROBE_FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
void main() { outColor = vec4(1.0); }`;

const shaders = Object.entries({ ...ErosionShaders, ...PipelineShaders }).filter(
  ([, src]) => typeof src === 'string' && src.startsWith('#version')
);

let createValidator = null;
try {
  ({ createValidator } = await import('glslang-wasm-validator'));
} catch {
  createValidator = null;
}

test('every GLSL shader in the project compiles', { skip: !createValidator && 'glslang-wasm-validator not installed' }, async () => {
  assert.ok(shaders.length >= 10, `expected the full shader catalogue, found ${shaders.length}`);
  const validator = await createValidator();
  const failures = [];
  try {
    for (const [name, src] of shaders) {
      const isVert = /_VERT$/.test(name);
      const stages = isVert
        ? { vertex: { name: `${name}.vert`, source: src }, fragment: { name: 'probe.frag', source: PROBE_FRAG } }
        : { vertex: { name: 'probe.vert', source: PROBE_VERT }, fragment: { name: `${name}.frag`, source: src } };
      const result = validator.checkPass(stages);
      const stage = isVert ? 'vertex' : 'fragment';
      const errors = (result.diagnostics || []).filter((d) => d.severity === 'error' && d.stage === stage);
      if (errors.length) {
        failures.push(`${name}: ${errors.slice(0, 3).map((d) => `line ${d.line ?? '?'} ${d.message}`).join(' | ')}`);
      }
    }
  } finally {
    validator.dispose?.();
  }
  assert.deepEqual(failures, [], `GLSL compile failures:\n${failures.join('\n')}`);
});

test('shaders avoid GLSL ES 3.00 reserved words as identifiers', () => {
  // `shared` (a storage qualifier) previously slipped in as a local float name and broke the
  // whole terrain render pipeline at runtime.
  const reserved = [
    'shared', 'input', 'output', 'namespace', 'using', 'layout', 'sample', 'filter',
    'coherent', 'volatile', 'restrict', 'readonly', 'writeonly', 'resource', 'patch',
    'subroutine', 'common', 'partition', 'active', 'asm', 'class', 'union', 'enum',
    'typedef', 'template', 'this', 'packed', 'goto', 'inline', 'noinline', 'public',
    'static', 'extern', 'external', 'interface', 'long', 'short', 'double', 'half',
    'fixed', 'unsigned', 'superp', 'hvec2', 'fvec2', 'sampler3DRect',
  ];
  const typeRe = '(?:float|int|uint|bool|void|vec[234]|ivec[234]|uvec[234]|bvec[234]|mat[234](?:x[234])?|sampler\\w+)';
  const problems = [];
  for (const [name, src] of shaders) {
    for (const word of reserved) {
      if (new RegExp(`\\b${typeRe}\\s+${word}\\b`).test(src)) problems.push(`${name}: '${word}'`);
    }
  }
  assert.deepEqual(problems, [], `reserved words used as identifiers: ${problems.join(', ')}`);
});

test('shaders are brace-balanced and free of ES1-only constructs', () => {
  for (const [name, src] of shaders) {
    const open = (src.match(/{/g) || []).length;
    const close = (src.match(/}/g) || []).length;
    assert.equal(open, close, `${name} has unbalanced braces (${open} vs ${close})`);
    assert.ok(src.startsWith('#version 300 es'), `${name} must target GLSL ES 3.00`);
    assert.ok(!/\btexture2D\s*\(/.test(src), `${name} uses GLSL ES 1.00 texture2D()`);
    assert.ok(!/\bgl_FragColor\b/.test(src), `${name} uses GLSL ES 1.00 gl_FragColor`);
    assert.ok(!/\bvarying\b/.test(src), `${name} uses GLSL ES 1.00 varying`);
  }
});
