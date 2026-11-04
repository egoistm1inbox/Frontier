// Compiles every fragment program with glslang (WASM) as a validation step.
// The engine targets WebGL2 (GLSL ES 3.00); glslang compiles the Vulkan-flavoured equivalent, which
// catches syntax, type and reserved-word errors without needing a GPU.
//   npm run check:glsl
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const glslangFactory = require('@webgpu/glslang/dist/node-devel/glslang.js');
const passes = await import(pathToFileURL(resolve(here, '../src/gpu/shaders/passes.ts')).href);
const glslang = glslangFactory();

function toVulkan(src) {
  let binding = 0;
  let out = src.replace('#version 300 es', '#version 450').replace(/^precision .*$/gm, '');
  out = out.replace(/^uniform (highp )?((?:i|u)?sampler[23]D|(?:i|u)?sampler2D) (\w+);/gm,
    (_m, _p, t, n) => `layout(binding=${binding++}) uniform ${t} ${n};`);
  out = out.replace(/^uniform (?!layout)([^;\n]+);/gm,
    (_m, body) => `layout(binding=${binding++}, std140) uniform U${binding} { ${body}; };`);
  out = out.replace(/^out (\w+) (\w+);/gm, (_m, t, n) => `layout(location=0) out ${t} ${n};`);
  return out;
}

const programs = { GEN: passes.GEN_FS, COPY: passes.COPY_FS, SCULPT: passes.SCULPT_FS, RAYMARCH: passes.RAYMARCH_FS };
let ok = true;
for (const [name, src] of Object.entries(programs)) {
  try {
    const words = glslang.compileGLSL(toVulkan(src), 'fragment', false).length;
    console.log(`${name.padEnd(9)} OK  (${words} SPIR-V words)`);
  } catch (e) {
    ok = false;
    console.log(`${name.padEnd(9)} FAILED\n${String(e.message ?? e).split('\n').slice(0, 30).join('\n')}`);
  }
}
process.exit(ok ? 0 : 1);
