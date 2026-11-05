// App shell: builds the world, residency manager, GPU atlas and renderer, then runs the frame loop.
import './app/style.css';
import { VRAM_BUDGET_BYTES, WORLD } from './config.ts';
import { africaPolygonM } from './world/africa.ts';
import { bakeCoastField, type CoastField } from './world/coastField.ts';
import { lonLatToWorld } from './world/macroParams.ts';
import { macroHeight, type MacroField } from './world/macroReference.ts';
import { ClipmapResidency } from './clipmap/residency.ts';
import { classifyBrick } from './clipmap/classify.ts';
import { LEVELS, atlasDims, brickSize, cellSize, estimateVram, type V3 } from './clipmap/layout.ts';
import { createGl, maxTexture3D } from './gpu/gl.ts';
import { ClipAtlas } from './gpu/atlas.ts';
import { Renderer } from './gpu/renderer.ts';
import { Sculptor, type Tool } from './sculpt/brush.ts';
import { FlyCamera } from './app/camera.ts';

const TOOLS: Tool[] = ['raise', 'lower', 'smooth', 'flatten'];

function fmtMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function boot(): void {
  const hud = document.getElementById('hud')!;
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const showError = (msg: string) => {
    hud.innerHTML = `<span class="err">${msg.replace(/</g, '&lt;')}</span>`;
  };

  let gl: WebGL2RenderingContext;
  try {
    gl = createGl(canvas);
  } catch (e) {
    showError(String((e as Error).message));
    return;
  }

  const dims = atlasDims();
  if (maxTexture3D(gl) < Math.max(...dims)) {
    showError(`MAX_3D_TEXTURE_SIZE ${maxTexture3D(gl)} < atlas ${dims.join('×')}. Lower POOL.slots in config.ts.`);
    return;
  }

  // Start-up: bake the continent's 2D coastline SDF once (CPU, ~tens of ms).
  const coast: CoastField = bakeCoastField(africaPolygonM(), WORLD.coastTexels, WORLD.halfExtentM / 1000, WORLD.coastBandKm);
  const field: MacroField = { coast };

  const atlas = new ClipAtlas(gl, coast);
  const residency = new ClipmapResidency(atlas, (lv, x, y, z) => classifyBrick(field, lv, x, y, z));
  const renderer = new Renderer(atlas);
  const sculptor = new Sculptor();

  // Spawn near Benoni, Gauteng (lon 28.32, lat -26.19) on the surface.
  const [sx, sz] = lonLatToWorld(28.32, -26.19);
  const spawnY = macroHeight(field, sx, sz, 8) + 4;
  const camera = new FlyCamera([sx, spawnY, sz]);

  let sculptMode = false;
  let shadows = true;
  let paused = false;
  let mouseDown = false;
  let strokeActive = false;
  let lastHit: V3 | null = null;
  let lastNormal: V3 = [0, 1, 0];
  let hudTimer = 0;
  let fps = 0;
  const frameTimes: number[] = [];
  let last = performance.now();

  const vram = estimateVram(WORLD.coastTexels);

  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) void canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas) mouseDown = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) camera.look(e.movementX, e.movementY);
  });
  canvas.addEventListener('mousedown', (e) => { if (e.button === 0) mouseDown = true; });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) { mouseDown = false; strokeActive = false; } });

  window.addEventListener('keydown', (e) => {
    if (e.repeat && !['BracketLeft', 'BracketRight'].includes(e.code)) return;
    camera.keys.add(e.code);
    switch (e.code) {
      case 'KeyB': sculptMode = !sculptMode; break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4':
        sculptor.tool = TOOLS[Number(e.code.slice(-1)) - 1];
        sculptMode = true;
        break;
      case 'BracketLeft': sculptor.setRadius(sculptor.radius * 0.85); break;
      case 'BracketRight': sculptor.setRadius(sculptor.radius / 0.85); break;
      case 'Minus': sculptor.setStrength(sculptor.strength - 0.1); break;
      case 'Equal': sculptor.setStrength(sculptor.strength + 0.1); break;
      case 'KeyF': shadows = !shadows; break;
      case 'KeyP': paused = !paused; break;
      case 'Escape': void document.exitPointerLock(); break;
    }
    if (e.code.startsWith('Digit') || e.code.startsWith('Bracket') || e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => camera.keys.delete(e.code));

  const resize = () => {
    const scale = Math.min(window.devicePixelRatio, 1.5);
    canvas.width = Math.floor(window.innerWidth * scale);
    canvas.height = Math.floor(window.innerHeight * scale);
    renderer.resize(canvas.width, canvas.height);
  };
  window.addEventListener('resize', resize);
  resize();

  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frameTimes.push(dt);
    if (frameTimes.length > 60) frameTimes.shift();

    camera.update(dt, (x, z) => macroHeight(field, x, z, 6));
    const cam = camera.pos;
    if (!paused) residency.update(cam);

    const basis = camera.basis();
    const rc = { pos: cam, right: basis.right, up: basis.up, fwd: basis.fwd, focal: 1 / Math.tan((60 * Math.PI) / 360) };
    const brushOn = sculptMode;

    // Pick the surface under the crosshair (screen centre) for the brush preview and for sculpting.
    lastHit = null;
    const opts = { shadows, brush: { on: brushOn, center: [0, 0, 0] as V3, radius: sculptor.radius }, maxDist: 200000 };
    if (brushOn) {
      const hit = renderer.pick(renderer.width / 2, renderer.height / 2, residency, rc, opts);
      if (hit) {
        lastHit = [hit.pos[0] + cam[0], hit.pos[1] + cam[1], hit.pos[2] + cam[2]];
        lastNormal = hit.normal;
        opts.brush.center = hit.pos;
      }
    }
    if (brushOn && mouseDown && lastHit && !paused && document.pointerLockElement === canvas) {
      if (!strokeActive) { sculptor.beginStroke(lastHit); strokeActive = true; }
      sculptor.dab(residency, atlas, lastHit, lastNormal, cam, dt);
    }

    renderer.draw(residency, rc, opts);

    hudTimer += dt;
    if (hudTimer > 0.25) {
      hudTimer = 0;
      const s = residency.stats;
      const avg = frameTimes.reduce((a, b) => a + b, 0) / Math.max(1, frameTimes.length);
      fps = 1 / Math.max(1e-6, avg);
      const brickBytes = vram.brickBytes;
      const slotBytes = residency.pool.inUse * brickBytes;
      const cacheBytes = s.cached * brickBytes;
      const totalVram = vram.atlasBytes + vram.scratchBytes + vram.pageBytes + vram.coastBytes;
      hud.textContent =
        `FPS ${fps.toFixed(0)}   ${sculptMode ? `SCULPT · ${sculptor.tool} r=${sculptor.radius.toFixed(1)}m s=${sculptor.strength.toFixed(1)}` : 'fly'}\n` +
        `pos ${cam[0].toFixed(0)} ${cam[1].toFixed(0)} ${cam[2].toFixed(0)} m   alt ${(cam[1] - macroHeight(field, cam[0], cam[2], 4)).toFixed(0)} m\n` +
        `levels ${LEVELS} · cell ${cellSize(0)}m…${cellSize(LEVELS - 1)}m · brick ${brickSize(0)}m…${brickSize(LEVELS - 1)}m\n` +
        `bricks  resident ${s.resident}  pending ${s.pending}  uniform air ${s.uniformAir} solid ${s.uniformSolid}\n` +
        `atlas   ${residency.pool.inUse}/${residency.pool.capacity} slots (${slotBytes ? fmtMB(slotBytes) : '0 MB'})  cache ${s.cached} edited (${fmtMB(cacheBytes)} RAM)\n` +
        `gpu     ${fmtMB(totalVram)} / ${fmtMB(VRAM_BUDGET_BYTES)} budget  (atlas ${fmtMB(vram.atlasBytes)})\n` +
        `stream  gen ${s.generated} · upload ${s.uploaded} · evict ${s.pressureEvictions} · readback ${s.readbacks}` +
        `${paused ? '\nSTREAMING PAUSED (P)' : ''}`;
    }

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

try {
  boot();
} catch (e) {
  document.getElementById('hud')!.innerHTML = `<span class="err">${String((e as Error).stack ?? e).replace(/</g, '&lt;')}</span>`;
}
