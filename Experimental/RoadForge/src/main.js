// RoadForge — boot, input, frame loop.

import { Renderer } from './gpu/renderer.js';
import { Scene } from './app/scene.js';
import { OrbitCamera, Gizmo, LineBatch, pickNode, pickEdge, rayPlaneY } from './app/viewport.js';
import { EditorUI } from './ui/app.js';
import { clamp, smoothstep, v3 } from './core/math.js';

const canvas = document.getElementById('gpu');
const loader = document.getElementById('loader');
const loaderMsg = document.getElementById('loaderMsg');
const loaderBar = document.getElementById('loaderBar');
const viewportEl = document.getElementById('viewport');

function progress(msg, pct) {
  loaderMsg.textContent = msg;
  loaderBar.style.width = `${pct}%`;
}

function fail(msg) {
  loader.classList.remove('hide');
  loader.innerHTML = `<div><h2>WebGPU unavailable</h2><p class="err">${msg}</p></div>`;
}

async function boot() {
  if (!navigator.gpu) {
    fail('This browser does not expose navigator.gpu. RoadForge needs WebGPU — try Chrome 121+, Edge 121+, or Safari 18+ with WebGPU enabled.');
    return;
  }
  progress('Requesting GPU adapter', 8);

  let renderer;
  try {
    renderer = await Renderer.create(canvas);
  } catch (e) {
    fail(`Could not create a WebGPU device.<br><br>${String(e && e.message ? e.message : e)}`);
    return;
  }

  progress('Baking procedural surfaces', 28);
  const scene = new Scene(renderer);
  scene.bakeAll();

  progress('Generating road network', 52);
  scene.generate(scene.settings.preset);

  progress('Starting renderer', 88);

  const camera = new OrbitCamera();
  camera.frame(scene.stats.bounds);
  const gizmo = new Gizmo();
  const lines = new LineBatch(65536);

  const state = {
    tool: 'select',
    view: { wire: false, grid: false, markings: true, traffic: true },
    hoverNode: null,
    selNode: null,
    selEdge: null,
    paused: false,
  };

  /* ------------------------------------------------------------- UI */

  const ui = new EditorUI(scene, {
    rebuild: () => {
      scene.rebuild();
      ui.renderStats();
      syncSelection();
    },
    bake: () => { scene.bakeAll(); },
    bakeSlot: (id) => { scene.bakeSlot(id); },
    generate: () => {
      scene.generate(scene.settings.preset);
      camera.frame(scene.stats.bounds);
      state.selNode = null; state.selEdge = null;
      ui.render();
    },
    focus: (nodeId) => {
      if (nodeId) {
        const n = scene.net.node(nodeId);
        if (n) { camera.target = [n.x, n.y, n.z]; camera.dist = clamp(camera.dist, 18, 60); return; }
      }
      camera.frame(scene.stats.bounds);
    },
    setTool: (t) => { state.tool = t; },
    setView: (v) => {
      state.view = v;
      if (v.wire && !renderer.road?.wbuf) { scene.wantWire = true; scene.rebuild(); }
    },
  });
  ui.render();

  function syncSelection() {
    const chip = ui.el.selChip;
    if (state.selNode) {
      const n = scene.net.node(state.selNode);
      const deg = n ? scene.net.degree(n.id) : 0;
      chip.innerHTML = `<span class="dot"></span><b>${deg}-arm intersection</b> · ${n ? n.x.toFixed(1) : 0}, ${n ? n.z.toFixed(1) : 0} m · drag to move`;
    } else if (state.selEdge) {
      const e = scene.net.edges.get(state.selEdge);
      chip.innerHTML = `<span class="dot"></span><b>${e ? e.cls : ''}</b> · ${(scene.build.curves.get(state.selEdge)?.length ?? 0).toFixed(0)} m`;
    } else {
      chip.innerHTML = '<span class="dot"></span><b>No selection</b>';
    }
  }

  /* ---------------------------------------------------------- input */

  let drag = null;
  const pointer = { x: 0, y: 0, inside: false };

  const rayAt = (ev) => {
    const r = canvas.getBoundingClientRect();
    return camera.ray(ev.clientX - r.left, ev.clientY - r.top, r.width, r.height);
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    const ray = rayAt(ev);
    pointer.x = ev.clientX; pointer.y = ev.clientY;

    if (ev.button === 0 && state.tool === 'select' && state.selNode) {
      const n = scene.net.node(state.selNode);
      if (n) {
        const c = [n.x, n.y, n.z];
        const s = gizmo.scaleFor(camera, c);
        const hit = gizmo.hitTest(ray, c, s);
        if (hit) {
          gizmo.begin(hit, ray, c);
          scene.beginDrag(state.selNode);
          drag = { mode: 'gizmo' };
          return;
        }
      }
    }
    if (ev.button === 0 && state.tool === 'select') {
      drag = { mode: 'maybe-pick', x: ev.clientX, y: ev.clientY, moved: 0 };
      return;
    }
    if (ev.button === 2 || ev.button === 1 || state.tool === 'pan') {
      drag = { mode: 'pan' };
      return;
    }
    drag = { mode: 'orbit' };
  });

  canvas.addEventListener('pointermove', (ev) => {
    const dx = ev.clientX - pointer.x;
    const dy = ev.clientY - pointer.y;
    pointer.x = ev.clientX; pointer.y = ev.clientY;
    pointer.inside = true;

    if (drag?.mode === 'gizmo') {
      const ray = rayAt(ev);
      const n = scene.net.node(state.selNode);
      if (n) {
        const p = gizmo.move(ray, [n.x, n.y, n.z]);
        if (p) {
          scene.dragTo(state.selNode, p);
          syncSelection();
        }
      }
      return;
    }
    if (drag?.mode === 'maybe-pick') {
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved > 5) drag.mode = 'orbit';
      return;
    }
    if (drag?.mode === 'orbit') { camera.orbit(dx, dy); return; }
    if (drag?.mode === 'pan') { camera.pan(dx, dy); return; }

    // hover
    const ray = rayAt(ev);
    if (state.selNode) {
      const n = scene.net.node(state.selNode);
      if (n) {
        const c = [n.x, n.y, n.z];
        gizmo.hover = gizmo.hitTest(ray, c, gizmo.scaleFor(camera, c));
        if (gizmo.hover) { state.hoverNode = null; canvas.style.cursor = 'grab'; return; }
      }
    }
    const hit = pickNode(scene.net, scene.build, ray);
    state.hoverNode = hit ? hit.node.id : null;
    canvas.style.cursor = hit ? 'pointer' : 'default';
  });

  const endDrag = (ev) => {
    if (drag?.mode === 'gizmo') {
      gizmo.end();
      scene.endDrag();
      ui.renderStats();
      ui.renderInspector();
    } else if (drag?.mode === 'maybe-pick') {
      const ray = rayAt(ev);
      const hit = pickNode(scene.net, scene.build, ray);
      if (hit) {
        state.selNode = hit.node.id;
        state.selEdge = null;
        ui.setSelectionFromViewport('node', hit.node.id);
      } else {
        const e = pickEdge(scene.net, scene.build, ray);
        if (e) {
          state.selEdge = e.edge.id;
          state.selNode = null;
          ui.setSelectionFromViewport('edge', e.edge.id);
        } else {
          state.selNode = null; state.selEdge = null;
        }
      }
      syncSelection();
    }
    drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { gizmo.end(); drag = null; });
  canvas.addEventListener('pointerleave', () => { pointer.inside = false; state.hoverNode = null; });

  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    camera.zoom(ev.deltaY);
  }, { passive: false });

  window.addEventListener('keydown', (ev) => {
    if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
    const k = ev.key.toLowerCase();
    if (k === 'f') ui.hooks.focus(state.selNode);
    if (k === 't') {
      state.view.wire = !state.view.wire;
      if (state.view.wire && !renderer.road?.wbuf) { scene.wantWire = true; scene.rebuild(); }
      syncRail();
    }
    if (k === 'l') { state.view.grid = !state.view.grid; syncRail(); }
    if (k === 'm') { state.view.markings = !state.view.markings; syncRail(); }
    if (k === 'p') { state.view.traffic = !state.view.traffic; scene.settings.traffic = state.view.traffic; syncRail(); }
    if (k === 'g') ui.hooks.generate();
    if (k === 'escape') { state.selNode = null; state.selEdge = null; syncSelection(); }
  });

  function syncRail() {
    for (const b of ui.el.rail.querySelectorAll('button[data-view]')) {
      const k = b.dataset.view;
      if (k in state.view) b.classList.toggle('on', state.view[k]);
    }
    ui.view = state.view;
  }

  /* --------------------------------------------------------- resize */

  const ro = new ResizeObserver(() => {
    const r = viewportEl.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(r.width * dpr));
    const h = Math.max(2, Math.round(r.height * dpr));
    canvas.width = w; canvas.height = h;
    renderer.resize(w, h);
  });
  ro.observe(viewportEl);

  /* ----------------------------------------------------------- loop */

  let last = performance.now();
  let frames = 0;
  let fpsT = last;
  let fps = 0;

  function env() {
    const s = scene.settings;
    const t = s.timeOfDay;
    const h = ((t - 6) / 12) * Math.PI;             // 06:00 sunrise, 18:00 sunset
    const elev = Math.sin(h);
    const az = s.sunAzimuth;
    const sunDir = v3.norm([
      Math.cos(az) * Math.max(0.12, Math.cos(h)),
      Math.max(elev, -0.25),
      Math.sin(az) * Math.max(0.12, Math.cos(h)),
    ]);
    const night = clamp(smoothstep(-0.12, 0.14, -elev + 0.02), 0, 1);
    const warm = clamp(1 - Math.max(elev, 0) * 2.2, 0, 1);
    const sunColor = [
      1.0,
      clamp(0.95 - warm * 0.34, 0.3, 1),
      clamp(0.88 - warm * 0.62, 0.12, 1),
    ];
    const sunI = clamp(elev * 4.6 + 0.22, 0.0, 4.4) * (1 - s.cloudCover * 0.45);
    return {
      sunDir,
      sunColor,
      sunIntensity: sunI,
      ambient: clamp(0.33 - night * 0.26 + s.cloudCover * 0.1, 0.045, 0.5),
      exposure: s.exposure,
      night,
      cloudCover: s.cloudCover,
      fogDensity: s.fog,
      fogFalloff: 0.021,
      fogStartY: 0,
      wetness: s.wetness,
      shadows: s.shadows && elev > -0.02,
      shadowBias: 0.0016,
      aoStrength: s.ao,
      vignette: s.vignette,
      grain: s.grain,
      quality: 1,
    };
  }

  function overlayLines(e) {
    lines.reset();
    const push = (a, b, c, al) => lines.push(a, b, c, al);

    // lane graph
    if (state.view.grid && scene.traffic) {
      const g = scene.traffic.graph;
      for (const lane of g.lanes) {
        const n = Math.max(2, Math.min(26, Math.round(lane.length / 8)));
        let prev = null;
        for (let i = 0; i <= n; i++) {
          const p = g.laneAt(lane, (lane.length * i) / n);
          const cur = [p.x, p.y + 0.09, p.z];
          if (prev) push(prev, cur, [0.3, 0.75, 0.95], 0.5);
          prev = cur;
        }
      }
      for (const c of g.conns) {
        let prev = null;
        for (let i = 0; i <= 8; i++) {
          const p = g.connAt(c, (c.length * i) / 8);
          const cur = [p.x, p.y + 0.09, p.z];
          if (prev) push(prev, cur, [0.95, 0.65, 0.25], 0.42);
          prev = cur;
        }
      }
    }

    // live drag ghost: the arms of the junction being moved
    if (scene.preview) {
      for (const item of scene.preview.edges) {
        const curve = item.curve;
        const prof = item.profile;
        if (!curve || !prof) continue;
        const n = Math.max(2, Math.round(curve.length / 3));
        for (const u of [-prof.roadHalf, 0, prof.roadHalf]) {
          let prev = null;
          for (let i = 0; i <= n; i++) {
            const fr = curve.frameAt((curve.length * i) / n);
            const cur = [fr.p[0] + fr.right[0] * u, fr.p[1] + 0.12, fr.p[2] + fr.right[2] * u];
            if (prev) push(prev, cur, u === 0 ? [0.55, 0.85, 1.0] : [1, 0.86, 0.36], u === 0 ? 0.5 : 0.95);
            prev = cur;
          }
        }
      }
    }

    // hover highlight
    if (state.hoverNode && state.hoverNode !== state.selNode) {
      const n = scene.net.node(state.hoverNode);
      if (n) ring(push, [n.x, n.y + 0.07, n.z], pickRadius(n), [0.75, 0.8, 0.85], 0.7);
    }

    // selection + gizmo
    if (state.selNode) {
      const n = scene.net.node(state.selNode);
      if (n) {
        const c = [n.x, n.y, n.z];
        const plan = scene.build.plans.get(n.id);
        gizmo.lines(push, c, gizmo.scaleFor(camera, c), plan);
      }
    } else if (state.selEdge) {
      const curve = scene.build.curves.get(state.selEdge);
      const prof = scene.build.profiles.get(state.selEdge);
      if (curve && prof) {
        for (const side of [-1, 1]) {
          let prev = null;
          const n = Math.max(2, Math.round(curve.length / 2.5));
          for (let i = 0; i <= n; i++) {
            const fr = curve.frameAt((curve.length * i) / n);
            const u = side * prof.roadHalf;
            const cur = [fr.p[0] + fr.right[0] * u, fr.p[1] + 0.09, fr.p[2] + fr.right[2] * u];
            if (prev) push(prev, cur, [1, 0.86, 0.36], 0.9);
            prev = cur;
          }
        }
      }
    }
    void e;
    renderer.setLines(lines.data, lines.count);
  }

  function pickRadius(n) {
    const plan = scene.build?.plans.get(n.id);
    let r = 4.5;
    if (plan) for (const a of plan.arms) r = Math.max(r, (a.w || 4) + 1.4);
    return r;
  }

  function ring(push, c, r, col, alpha) {
    const N = 28;
    let prev = null;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const p = [c[0] + Math.cos(a) * r, c[1], c[2] + Math.sin(a) * r];
      if (prev) push(prev, p, col, alpha);
      prev = p;
    }
  }

  window.addEventListener('roadforge-gpu-error', (ev) => {
    const msg = ev.detail?.message || String(ev.detail || 'unknown');
    ui.el.perf.innerHTML = `<b style="color:#d08a8a">GPU error</b> · see console`;
    console.error('[RoadForge]', msg);
  });

  loader.classList.add('hide');
  setTimeout(() => { loader.style.display = 'none'; }, 400);

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    frames++;
    if (now - fpsT > 500) {
      fps = (frames * 1000) / (now - fpsT);
      frames = 0; fpsT = now;
      ui.el.perf.innerHTML = `<b>${fps.toFixed(0)}</b> fps · ${renderer.stats.draws} draws · ${(renderer.stats.tris / 1000).toFixed(0)}k tris · ${scene.traffic ? scene.traffic.vehicles.length : 0} vehicles`;
    }

    const e = env();
    scene.update(dt, e);
    overlayLines(e);

    renderer.render({
      camera,
      env: e,
      time: now / 1000,
      markings: state.view.markings ? 1 : 0,
      wireframe: state.view.wire,
      selected: -1,
      hover: -1,
      overlay: 0,
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.RoadForge = { scene, renderer, camera, ui, state };
}

boot().catch((e) => {
  console.error(e);
  fail(String(e && e.stack ? e.stack : e));
});
