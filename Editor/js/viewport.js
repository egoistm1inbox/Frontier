/* ══════════════════════════════════════════════════════════════════════════════════════════════
   VIEWPORT.JS — ViewportPanel.cpp. The rail (brand · dock pair · Add — Edit | Simulate | Play —
   projection · markers · status · gear) over the 2 px convergence hairline; the dark view with
   the orbit compass; the command console with its suggestion stack; the stats footer.

   The scene draws each outliner entry as its own coloured box — a different colour per entry —
   and the transform gizmo over the picked one is the editor's own: GizmoFigures.cpp's figures
   (cones 0.06/0.18 at TIP·0.95, corner quads at half 0.08, arcs of a 31° sweep at radius
   TIP·0.62, the billboarded white ring at 0.16) ported with its pointer arithmetic — closest
   point along an axis under the ray, ray ∧ plane, angle around the axis — and Blender's drag
   rules: Ctrl snaps to 0.25 units / 0.1× / 5°.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

"use strict";

/* ── the gizmo's figures, verbatim from GizmoFigures.h ───────────────────────────────────── */
const GIZMO = {
  tip: 0.95, coneR: 0.06, coneH: 0.18,
  cylR: 0.06, cylH: 0.14, cylInset: 0.28,
  quadHalf: 0.08, quadAlpha: 0.28, quadHoverAlpha: 0.55,
  arcR: 0.95 * 0.62, arcBand: 0.038, arcSweep: 0.5410521,
  ringR: 0.16,
  tints: { X: "#e01414", Y: "#12d40a", Z: "#1560e0",
           PX: "#1fc7c7", PY: "#c81ec8", PZ: "#e0cd12", ring: "#ffffff" },
  snapMove: 0.25, snapScale: 0.1, snapTurn: 0.0872665,
};

const Viewport = (() => {
  let canvas, ctx, W = 0, H = 0, dpr = 1;
  let fps = 60, lastT = performance.now(), frames = 0, fpsClock = 0;

  /* the orbit (ViewportOrbit) — the scene's data is Y-up, depth on Z (glTF-style), so yaw 0
     stands at +Z looking toward the room's open face, positive pitch climbs above the scene */
  const orbit = { yaw: 0.45, pitch: 0.32, dist: 9.5, target: [0, 1.0, -2.0], ortho: false, viewpoint: 0 };
  const SNAPS = [
    null, { yaw: 0, pitch: 0 }, { yaw: Math.PI, pitch: 0 },
    { yaw: Math.PI / 2, pitch: 0 }, { yaw: -Math.PI / 2, pitch: 0 },
    { yaw: 0, pitch: -Math.PI / 2 }, { yaw: 0, pitch: Math.PI / 2 },
  ];
  const SNAP_NAMES = ["", "Front", "Back", "Right", "Left", "Top", "Bottom"];

  let gizmoMode = 0;           // 0 translate · 1 rotate · 2 scale
  let gizmoHot = null;          // the grip under the pointer
  let gizmoDrag = null;         // the seated drag
  let markersOn = true;
  let hitAreas = [];            // this frame's grip hit targets
  let samples = 0; const SAMPLE_TARGET = 256;

  /* ── vector helpers (the solver's own basis) ───────────────────────────────────────────── */
  const V = {
    add: (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]],
    sub: (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]],
    mul: (a, s) => [a[0]*s, a[1]*s, a[2]*s],
    dot: (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
    cross: (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    norm(a) { const l = V.len(a) || 1; return [a[0]/l, a[1]/l, a[2]/l]; },
  };
  function basis(yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const F = [-sy*cp, sp, -cy*cp];
    let R = V.cross(F, [0, 1, 0]);
    const rl = V.len(R);
    if (rl < 1e-4) R = [cy, 0, -sy]; else R = V.mul(R, 1 / rl);
    const U = V.cross(R, F);
    return { F, R, U };
  }
  const eyePos = () => {
    const { F } = basis(orbit.yaw, orbit.pitch);
    return V.sub(orbit.target, V.mul(F, orbit.dist));
  };
  const focal = () => {
    const rad = (Ed.fov * Math.PI) / 360;
    return (H * 0.5) / Math.tan(rad);
  };
  function project(P) {
    const eye = eyePos();
    const { F, R, U } = basis(orbit.yaw, orbit.pitch);
    const d = V.sub(P, eye);
    const z = V.dot(d, F);
    if (z < 0.05) return null;
    const f = focal();
    return {
      x: W/2 + (V.dot(d, R) * f) / z,
      y: H/2 - (V.dot(d, U) * f) / z,
      z,
    };
  }
  function pointerRay(px, py) {
    const eye = eyePos();
    const { F, R, U } = basis(orbit.yaw, orbit.pitch);
    const f = focal();
    const dir = V.norm(V.add(V.add(F, V.mul(R, (px - W/2) / f)), V.mul(U, -(py - H/2) / f)));
    return { O: eye, D: dir };
  }

  /* ── the gizmo's pointer arithmetic, ported from GizmoFigures.cpp ──────────────────────── */
  function alongAxisUnderRay(A, O, RO, RD) {
    const W0 = V.sub(O, RO);
    const a = V.dot(A, A), b = V.dot(A, RD), c = V.dot(RD, RD);
    const d = V.dot(A, W0), e = V.dot(RD, W0);
    const den = a*c - b*b;
    if (Math.abs(den) < 1e-6) return 0;
    return (b*e - c*d) / den;
  }
  function touchPlaneUnderRay(N, O, RO, RD) {
    const facing = V.dot(RD, N);
    if (Math.abs(facing) < 1e-8) return null;
    const along = V.dot(V.sub(O, RO), N) / facing;
    if (along < 0) return null;
    return V.add(RO, V.mul(RD, along));
  }
  function angleUnderRay(A, Zero, O, RO, RD) {
    const T = touchPlaneUnderRay(A, O, RO, RD);
    if (!T) return null;
    const Swing = V.sub(T, O);
    const Ref = V.norm(V.sub(Zero, V.mul(A, V.dot(Zero, A))));
    const Perp = V.norm(V.cross(A, Ref));
    return Math.atan2(V.dot(Swing, Perp), V.dot(Swing, Ref));
  }

  /* ── the frame loop ────────────────────────────────────────────────────────────────────── */
  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    W = r.width; H = r.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function frame(now) {
    const dt = (now - lastT) / 1000; lastT = now;
    frames++; fpsClock += dt;
    if (fpsClock >= 0.5) {
      fps = frames / fpsClock; frames = 0; fpsClock = 0; Readout.fps = fps;
      renderFoot(); Outliner.renderFoot(); Inspector.updateFooter();
    }
    // the accumulation: fills toward the target, resets when the view moves
    if (Ed.transport.realtime || Ed.transport.mode !== 0) {
      samples = Math.min(SAMPLE_TARGET * 4, samples + Math.max(1, Math.round(dt * 90)));
    }
    draw();
    requestAnimationFrame(frame);
  }
  function bumpView() { samples = 0; }

  /* ── the draw ──────────────────────────────────────────────────────────────────────────── */
  function draw() {
    ctx.clearRect(0, 0, W, H);
    hitAreas = [];
    drawGrid();
    drawBoxes();
    const picked = pickedBoxRow();
    if (picked) drawGizmo(picked);
    if (markersOn) drawMarkers();
    drawCompass();
    Readout.triangles = triCount();
    Readout.cam = [orbit.target[0], orbit.target[2], orbit.dist];
    const hint = document.getElementById("vp-hint");
    hint.hidden = Ed.roster.some((r) => r.box && r.visible);
  }

  function pickedBoxRow() {
    for (let k = Ed.picked.length - 1; k >= 0; k--) {
      const r = Ed.roster[Ed.picked[k]];
      if (r && r.box) return r;
    }
    return null;
  }

  function visibleEntries() {
    return Ed.roster.map((r, i) => ({ r, i })).filter(({ r }) => r.box && r.visible);
  }

  function triCount() {
    return visibleEntries().length * 12 + 44 * 2;
  }

  /* the ground grid on Y = 0 (X right in red, Z toward the open face in blue) */
  function drawGrid() {
    ctx.lineWidth = 1;
    for (let i = -6; i <= 6; i++) {
      const pairs = [
        { a: [i, 0, -6], b: [i, 0, 6], axis: i === 0 ? "rgba(91,140,255,.5)" : null },
        { a: [-6, 0, i], b: [6, 0, i], axis: i === 0 ? "rgba(239,83,80,.5)" : null },
      ];
      for (const { a, b, axis } of pairs) {
        const p = project(a), q = project(b);
        if (!p || !q) continue;
        ctx.strokeStyle = axis || "rgba(255,255,255,.06)";
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
    }
  }

  /* each entry as its own coloured box */
  function drawBoxes() {
    const eye = eyePos();
    const faces = [];
    for (const { r } of visibleEntries()) {
      const b = r.box;
      const c = b.p, h = b.h;
      const verts = [];
      for (let k = 0; k < 8; k++)
        verts.push([c[0] + (k & 1 ? h[0] : -h[0]), c[1] + (k & 2 ? h[1] : -h[1]), c[2] + (k & 4 ? h[2] : -h[2])]);
      const FACES = [[0,1,3,2,[0,0,-1]],[4,6,7,5,[0,0,1]],[0,4,5,1,[0,-1,0]],
                     [2,3,7,6,[0,1,0]],[0,2,6,4,[-1,0,0]],[1,5,7,3,[1,0,0]]];
      const picked = Ed.picked.includes(Ed.roster.indexOf(r));
      for (const [a, b2, c2, d, n] of FACES) {
        const centre = V.mul(V.add(V.add(verts[a], verts[b2]), V.add(verts[c2], verts[d])), 0.25);
        const dist = V.len(V.sub(centre, eye));
        faces.push({ verts: [verts[a], verts[b2], verts[c2], verts[d]], n, dist, row: r, picked, wire: b.wire, cloth: b.cloth, glow: b.glow, shell: b.shell });
      }
    }
    faces.sort((p, q) => q.dist - p.dist);
    const sun = V.norm([0.5, 0.8, 0.4]);
    for (const f of faces) {
      const pts = f.verts.map(project);
      if (pts.some((p) => !p)) continue;
      const lit = 0.42 + 0.58 * Math.max(0, V.dot(f.n, sun));
      const hue = f.row.hue ?? 210;
      if (f.wire) {
        ctx.strokeStyle = `hsla(${hue},70%,62%,.75)`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath(); ctx.stroke();
        continue;
      }
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      if (f.shell) {
        // the room shell reads as tinted glass so the volumes inside keep their own colours
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = `hsla(${hue},40%,${30 + lit * 34}%,1)`;
        ctx.fill();
        ctx.globalAlpha = f.picked ? 0.95 : 0.30;
        ctx.strokeStyle = f.picked ? "rgba(255,255,255,.9)" : `hsla(${hue},50%,72%,1)`;
        ctx.lineWidth = f.picked ? 1.6 : 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.fillStyle = f.glow
        ? `hsla(${hue},95%,${58 + lit * 16}%,1)`
        : `hsla(${hue},${f.cloth ? 55 : 48}%,${18 + lit * 40}%,1)`;
      ctx.fill();
      if (f.glow) {                       // a halo by two cheap strokes, not a shadow blur
        ctx.strokeStyle = `hsla(${hue},95%,65%,.35)`;
        ctx.lineWidth = 5; ctx.stroke();
      }
      ctx.strokeStyle = f.picked ? "rgba(255,255,255,.9)" : `hsla(${hue},60%,70%,.28)`;
      ctx.lineWidth = f.picked ? 1.6 : 1;
      ctx.stroke();
    }
  }

  /* the marker billboards over each entry */
  function drawMarkers() {
    ctx.font = "10px 'DM Sans',sans-serif";
    for (const { r, i } of visibleEntries()) {
      const top = [r.box.p[0], r.box.p[1] + r.box.h[1], r.box.p[2]];
      const p = project(top);
      if (!p) continue;
      const label = r.label;
      const w = ctx.measureText(label).width + 12;
      const y = p.y - 14;
      const picked = Ed.picked.includes(i);
      ctx.fillStyle = picked ? "rgba(255,255,255,.92)" : "rgba(10,12,14,.72)";
      roundRect(p.x - w/2, y - 8, w, 15, 7);
      ctx.fill();
      ctx.fillStyle = picked ? "#111" : `hsla(${r.hue ?? 210},70%,72%,1)`;
      ctx.fillText(label, p.x - w/2 + 6, y + 3);
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ── the gizmo — GizmoFigures' vocabulary, projected ───────────────────────────────────── */
  function gizmoPose(r) {
    const reach = Math.max(0.7, Math.max(r.box.h[0], r.box.h[1], r.box.h[2]) * 1.9 + 0.25);
    return { O: r.box.p.slice(), reach };
  }
  function drawGizmo(r) {
    const { O, reach } = gizmoPose(r);
    const AXES = [[1,0,0],[0,1,0],[0,0,1]];
    const planeTint = ["PX", "PY", "PZ"];
    const axisName = ["X", "Y", "Z"];

    // draw order: far pieces first — sort grips by depth
    const pieces = [];
    AXES.forEach((A, ai) => {
      const others = AXES.filter((_, k) => k !== ai);
      if (gizmoMode === 0) {
        pieces.push({ kind: "quad", ai, A, U: others[0], Vv: others[1], depth: 0 });
        pieces.push({ kind: "cone", ai, A, depth: 0 });
      } else if (gizmoMode === 1) {
        pieces.push({ kind: "arc", ai, A, U: others[0], Vv: others[1], depth: 0 });
      } else {
        pieces.push({ kind: "cyl", ai, A, depth: 0 });
      }
    });
    for (const pc of pieces) {
      const tip = project(V.add(O, V.mul(pc.A, GIZMO.tip * reach)));
      pc.depth = tip ? tip.z : 0;
    }
    pieces.sort((a, b) => b.depth - a.depth);

    for (const pc of pieces) {
      const tint = GIZMO.tints[axisName[pc.ai]];
      const hot = gizmoHot && gizmoHot.mode === gizmoMode && gizmoHot.ai === pc.ai;
      if (pc.kind === "cone") drawConeGrip(O, pc.A, reach, tint, hot, pc.ai, "move");
      if (pc.kind === "quad") drawQuadGrip(O, pc.U, pc.Vv, reach, GIZMO.tints[planeTint[pc.ai]], hot, pc.ai, "plane");
      if (pc.kind === "arc")  drawArcGrip(O, pc.A, pc.U, pc.Vv, reach, tint, hot, pc.ai, "turn");
      if (pc.kind === "cyl")  drawCylGrip(O, pc.A, reach, tint, hot, pc.ai, "scale");
    }
    drawRing(O, reach);
  }

  function drawConeGrip(O, A, reach, tint, hot, ai, grip) {
    const tip = V.add(O, V.mul(A, (GIZMO.tip + GIZMO.coneH * 0.5) * reach));
    const baseC = V.add(O, V.mul(A, (GIZMO.tip - GIZMO.coneH * 0.5) * reach));
    const pTip = project(tip), pBase = project(baseC), pO = project(O);
    if (!pTip || !pBase || !pO) return;
    // the axis line
    ctx.strokeStyle = tint; ctx.lineWidth = hot ? 3 : 2;
    ctx.beginPath(); ctx.moveTo(pO.x, pO.y); ctx.lineTo(pBase.x, pBase.y); ctx.stroke();
    // the cone, as the base circle's screen radius + apex
    const f = focal();
    const rPx = (GIZMO.coneR * reach * f) / pBase.z;
    const dir2d = norm2(pTip.x - pBase.x, pTip.y - pBase.y);
    const perp = [-dir2d[1], dir2d[0]];
    ctx.fillStyle = hot ? lighten(tint) : tint;
    ctx.beginPath();
    ctx.moveTo(pTip.x, pTip.y);
    ctx.lineTo(pBase.x + perp[0] * rPx, pBase.y + perp[1] * rPx);
    ctx.lineTo(pBase.x - perp[0] * rPx, pBase.y - perp[1] * rPx);
    ctx.closePath(); ctx.fill();
    hitAreas.push({ grip: { mode: gizmoMode, ai, family: grip }, type: "circle", x: pTip.x, y: pTip.y, r: Math.max(9, rPx + 5), z: pTip.z });
  }

  function drawQuadGrip(O, U, Vv, reach, tint, hot, ai, grip) {
    const half = GIZMO.quadHalf * reach;
    const corner = V.add(O, V.mul(V.add(U, Vv), (GIZMO.tip - GIZMO.quadHalf) * reach));
    const A = V.sub(V.sub(corner, V.mul(U, half)), V.mul(Vv, half));
    const B = V.add(V.sub(corner, V.mul(U, half)), V.mul(Vv, half));
    const C = V.add(V.add(corner, V.mul(U, half)), V.mul(Vv, half));
    const D = V.add(V.sub(corner, V.mul(U, half)), V.mul(Vv, half));
    const backU = V.sub(C, V.mul(U, 2 * half));
    const backV = V.sub(C, V.mul(Vv, 2 * half));
    const pts = [A, B, C, D].map(project);
    const pBU = project(backU), pC = project(C), pBV = project(backV);
    if (pts.some((p) => !p) || !pBU || !pC || !pBV) return;
    ctx.globalAlpha = hot ? GIZMO.quadHoverAlpha : GIZMO.quadAlpha;
    ctx.fillStyle = tint;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    // the two opaque edges: backU → outer → backV
    ctx.strokeStyle = tint; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(pBU.x, pBU.y); ctx.lineTo(pC.x, pC.y); ctx.lineTo(pBV.x, pBV.y); ctx.stroke();
    hitAreas.push({ grip: { mode: gizmoMode, ai, family: grip }, type: "poly", pts: pts.map((p) => [p.x, p.y]), z: pC.z });
  }

  function drawArcGrip(O, A, U, Vv, reach, tint, hot, ai, grip) {
    const inner = (GIZMO.arcR - GIZMO.arcBand) * reach;
    const outer = (GIZMO.arcR + GIZMO.arcBand) * reach;
    const start = Math.PI / 4 - GIZMO.arcSweep / 2;
    const IN = [], OUT = [], mid = [];
    for (let i = 0; i <= 20; i++) {
      const a = start + (GIZMO.arcSweep * i) / 20;
      const D = V.add(V.mul(U, Math.cos(a)), V.mul(Vv, Math.sin(a)));
      IN.push(project(V.add(O, V.mul(D, inner))));
      OUT.push(project(V.add(O, V.mul(D, outer))));
      if (i === 10) mid.push(V.add(O, V.mul(D, (inner + outer) / 2)));
    }
    if (IN.some((p) => !p) || OUT.some((p) => !p)) return;
    ctx.fillStyle = hot ? lighten(tint) : tint;
    ctx.beginPath();
    OUT.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    for (let i = IN.length - 1; i >= 0; i--) ctx.lineTo(IN[i].x, IN[i].y);
    ctx.closePath(); ctx.fill();
    const pm = project(mid[0]);
    if (pm) hitAreas.push({ grip: { mode: gizmoMode, ai, family: grip }, type: "circle", x: pm.x, y: pm.y, r: 14, z: pm.z });
  }

  function drawCylGrip(O, A, reach, tint, hot, ai, grip) {
    const end = V.add(O, V.mul(A, (GIZMO.tip - GIZMO.cylInset) * reach));
    const pO = project(O), pE = project(end);
    if (!pO || !pE) return;
    ctx.strokeStyle = tint; ctx.lineWidth = hot ? 3 : 2;
    ctx.beginPath(); ctx.moveTo(pO.x, pO.y); ctx.lineTo(pE.x, pE.y); ctx.stroke();
    // the grip: a small cube at the cylinder's end
    const s = GIZMO.cylR * reach * 1.15;
    const corners = [];
    for (let k = 0; k < 8; k++) {
      const off = [
        (k & 1 ? s : -s), (k & 2 ? s : -s), (k & 4 ? s : -s),
      ];
      corners.push(project(V.add(end, off)));
    }
    if (corners.some((c) => !c)) return;
    const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
    const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
    ctx.fillStyle = hot ? lighten(tint) : tint;
    roundRect(minx, miny, maxx - minx, maxy - miny, 2);
    ctx.fill();
    hitAreas.push({ grip: { mode: gizmoMode, ai, family: grip }, type: "circle", x: pE.x, y: pE.y, r: Math.max(10, (maxx - minx) * 0.7), z: pE.z });
  }

  function drawRing(O, reach) {
    // the billboarded white ring — TorusGeometry(0.16, 0.008) toward the eye
    const { R, U } = basis(orbit.yaw, orbit.pitch);
    const r = GIZMO.ringR * reach;
    ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.lineWidth = Math.max(1.2, (0.008 * reach * focal()) / (project(O)?.z || 1) * 2.2);
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const t = (i / 48) * Math.PI * 2;
      const P = V.add(O, V.add(V.mul(R, Math.cos(t) * r), V.mul(U, Math.sin(t) * r)));
      const p = project(P);
      if (!p) return;
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
    }
    ctx.stroke();
  }

  function norm2(x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }
  function lighten(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, (n >> 16) + 70), g = Math.min(255, ((n >> 8) & 255) + 70), b = Math.min(255, (n & 255) + 70);
    return `rgb(${r},${g},${b})`;
  }

  /* ── the orbit compass (Blender's compass) ────────────────────────────────────────────── */
  const compass = { hot: -1, held: false, moved: false, downX: 0, downY: 0 };
  const AXIS_TINTS = ["#ef5350", "#69d06d", "#5b8cff"];
  function compassCentre() { return { x: W - 52, y: H - 52 }; }
  function compassPads() {
    const { F, R, U } = basis(orbit.yaw, orbit.pitch);
    const C = compassCentre();
    const AX = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    return AX.map((a) => {
      const dx = a[0]*R[0] + a[1]*R[1] + a[2]*R[2];
      const dy = a[0]*U[0] + a[1]*U[1] + a[2]*U[2];
      const toward = -(a[0]*F[0] + a[1]*F[1] + a[2]*F[2]);
      return { x: C.x + dx * 20, y: C.y - dy * 20, front: toward > 0, axis: Math.floor(AX.indexOf(a) / 2) };
    });
  }
  function drawCompass() {
    const pads = compassPads();
    ctx.lineWidth = 2;
    for (let a = 0; a < 3; a++) {
      ctx.strokeStyle = AXIS_TINTS[a] + "8c";
      ctx.beginPath();
      ctx.moveTo(pads[a*2].x, pads[a*2].y); ctx.lineTo(pads[a*2+1].x, pads[a*2+1].y);
      ctx.stroke();
    }
    pads.forEach((p, i) => {
      ctx.globalAlpha = p.front ? 1 : 0.35;
      ctx.fillStyle = AXIS_TINTS[p.axis];
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill();
      if (compass.hot === i) {
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });
    ctx.font = "11px 'DM Sans',sans-serif";
    ["X", "Y", "Z"].forEach((n, a) => {
      const p = pads[a * 2];
      ctx.globalAlpha = p.front ? 1 : 0.4;
      ctx.fillStyle = AXIS_TINTS[a];
      ctx.fillText(n, p.x + 9, p.y - 7);
      ctx.globalAlpha = 1;
    });
  }
  const PAD_VIEWS = [3, 4, 2, 1, 5, 6];

  /* ── pointer handling: orbit · pick · gizmo drags ──────────────────────────────────────── */
  let viewDrag = null;
  function attachInput() {
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;

      // the compass takes its own clicks
      const pads = compassPads();
      for (let i = 0; i < 6; i++) {
        if (Math.hypot(px - pads[i].x, py - pads[i].y) < 13) {
          compass.held = true; compass.moved = false;
          compass.downX = px; compass.downY = py; compass.hot = i;
          return;
        }
      }
      // a grip beats everything
      const grip = probeGrip(px, py);
      if (grip) { beginGizmoDrag(grip, px, py); return; }
      viewDrag = { x: e.clientX, y: e.clientY, pan: e.button === 1 || e.shiftKey, moved: false, px, py };
    });

    canvas.addEventListener("pointermove", (e) => {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;

      if (compass.held) {
        if (Math.abs(px - compass.downX) + Math.abs(py - compass.downY) > 4) compass.moved = true;
        if (compass.moved) { orbitBy(e.movementX, e.movementY); }
        return;
      }
      if (gizmoDrag) { advanceGizmoDrag(px, py, e.ctrlKey || e.metaKey); return; }
      if (viewDrag) {
        if (Math.hypot(e.clientX - viewDrag.x, e.clientY - viewDrag.y) > 3) viewDrag.moved = true;
        if (viewDrag.moved) {
          if (viewDrag.pan) panBy(e.movementX, e.movementY);
          else orbitBy(e.movementX, e.movementY);
        }
        return;
      }
      // hover probe
      gizmoHot = probeGrip(px, py);
      canvas.classList.toggle("gizmo-hot", !!gizmoHot);
      const pads = compassPads();
      compass.hot = -1;
      pads.forEach((p, i) => { if (Math.hypot(px - p.x, py - p.y) < 13) compass.hot = i; });
    });

    canvas.addEventListener("pointerup", (e) => {
      if (compass.held) {
        if (!compass.moved && compass.hot >= 0) snapView(PAD_VIEWS[compass.hot]);
        compass.held = false; compass.hot = -1;
        return;
      }
      if (gizmoDrag) { endGizmoDrag(); return; }
      if (viewDrag && !viewDrag.moved) {
        const rect = canvas.getBoundingClientRect();
        pickAt(e.clientX - rect.left, e.clientY - rect.top, e.shiftKey);
      }
      viewDrag = null;
    });

    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      orbit.dist *= e.deltaY < 0 ? 0.88 : 1.13;
      orbit.dist = Math.min(120, Math.max(0.2, orbit.dist));
      bumpView(); renderRailStatus(); renderFoot();
    }, { passive: false });

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  function orbitBy(dx, dy) {
    orbit.yaw -= dx * 0.008;
    orbit.pitch += dy * 0.008;
    orbit.pitch = Math.min(1.55, Math.max(-1.55, orbit.pitch));
    orbit.viewpoint = 0;
    bumpView(); renderRailStatus(); renderFoot();
  }
  function panBy(dx, dy) {
    const { R, U } = basis(orbit.yaw, orbit.pitch);
    const f = Math.max(0.1, orbit.dist) * 0.002;
    orbit.target = V.add(orbit.target, V.add(V.mul(R, -dx * f), V.mul(U, dy * f)));
    bumpView(); renderFoot();
  }
  function snapView(v) {
    orbit.yaw = SNAPS[v].yaw; orbit.pitch = SNAPS[v].pitch;
    orbit.viewpoint = v;
    bumpView(); renderRailStatus(); renderFoot();
    toast("View", SNAP_NAMES[v] + " snap seated");
  }

  function probeGrip(px, py) {
    // nearest hit area containing the pointer (depth breaks ties toward the camera)
    let best = null;
    for (const a of hitAreas) {
      let inside = false;
      if (a.type === "circle") inside = Math.hypot(px - a.x, py - a.y) <= a.r;
      if (a.type === "poly") inside = pointInPoly(px, py, a.pts);
      if (!inside) continue;
      if (!best || a.z < best.z) best = a;
    }
    return best ? best.grip : null;
  }
  function pointInPoly(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /* pick a box with a slab test along the pointer ray */
  function pickAt(px, py, additive) {
    const { O, D } = pointerRay(px, py);
    let best = -1, bestT = Infinity;
    Ed.roster.forEach((r, i) => {
      if (!r.box || !r.visible) return;
      const t = rayBox(O, D, r.box.p, r.box.h);
      if (t !== null && t < bestT) { bestT = t; best = i; }
    });
    if (best >= 0) {
      if (additive) {
        const at = Ed.picked.indexOf(best);
        if (at >= 0) Ed.picked.splice(at, 1); else Ed.picked.push(best);
      } else Ed.picked = [best];
    } else if (!additive) Ed.picked = [];
    App.refreshAll();
  }
  function rayBox(O, D, c, h) {
    let tmin = 0, tmax = Infinity;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(D[i]) < 1e-9) {
        if (O[i] < c[i] - h[i] || O[i] > c[i] + h[i]) return null;
      } else {
        let t1 = (c[i] - h[i] - O[i]) / D[i], t2 = (c[i] + h[i] - O[i]) / D[i];
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    return tmin;
  }

  /* ── the gizmo's drag, line for line from GizmoFigures.cpp ─────────────────────────────── */
  const AXES = [[1,0,0],[0,1,0],[0,0,1]];
  function beginGizmoDrag(grip, px, py) {
    const r = pickedBoxRow(); if (!r) return;
    const { O, reach } = gizmoPose(r);
    const { O: RO, D: RD } = pointerRay(px, py);
    const A = AXES[grip.ai];
    gizmoDrag = { grip, O, reach, A };
    if (grip.family === "move" || grip.family === "scale") {
      gizmoDrag.startAlong = alongAxisUnderRay(A, O, RO, RD);
      gizmoDrag.startH = r.box.h.slice();
    } else if (grip.family === "plane") {
      const others = AXES.filter((_, k) => k !== grip.ai);
      const touch = touchPlaneUnderRay(A, O, RO, RD);
      if (!touch) { gizmoDrag = null; return; }
      gizmoDrag.U = others[0]; gizmoDrag.Vv = others[1];
      gizmoDrag.startTouch = touch;
      gizmoDrag.startP = r.box.p.slice();
    } else if (grip.family === "turn") {
      const others = AXES.filter((_, k) => k !== grip.ai);
      const ang = angleUnderRay(A, others[0], O, RO, RD);
      if (ang === null) { gizmoDrag = null; return; }
      gizmoDrag.startAngle = ang;
      gizmoDrag.startRot = (r.state.rot ?? [0,0,0]).slice();
    }
    canvas.classList.add("gizmo-drag");
  }
  function advanceGizmoDrag(px, py, snap) {
    const r = pickedBoxRow(); if (!r || !gizmoDrag) return;
    const { O: RO, D: RD } = pointerRay(px, py);
    const { grip, O, A } = gizmoDrag;
    const letter = "XYZ"[grip.ai];
    const ro = document.getElementById("vp-gizmo-readout");

    if (grip.family === "move") {
      let delta = alongAxisUnderRay(A, O, RO, RD) - gizmoDrag.startAlong;
      if (snap) delta = Math.round(delta / GIZMO.snapMove) * GIZMO.snapMove;
      r.box.p = V.add(gizmoDragStartPos(), V.mul(A, delta));
      if (r.state.pos) r.state.pos = r.box.p.map((v) => +v.toFixed(3));
      ro.textContent = `${letter}  move ${delta.toFixed(3)}`;
    } else if (grip.family === "plane") {
      const touch = touchPlaneUnderRay(A, O, RO, RD);
      if (!touch) return;
      let mv = V.sub(touch, gizmoDrag.startTouch);
      if (snap) {
        const au = Math.round(V.dot(mv, gizmoDrag.U) / GIZMO.snapMove) * GIZMO.snapMove;
        const av = Math.round(V.dot(mv, gizmoDrag.Vv) / GIZMO.snapMove) * GIZMO.snapMove;
        mv = V.add(V.mul(gizmoDrag.U, au), V.mul(gizmoDrag.Vv, av));
      }
      r.box.p = V.add(gizmoDrag.startP, mv);
      if (r.state.pos) r.state.pos = r.box.p.map((v) => +v.toFixed(3));
      ro.textContent = `${letter}-plane  move ${V.len(mv).toFixed(3)}`;
    } else if (grip.family === "scale") {
      const delta = alongAxisUnderRay(A, O, RO, RD) - gizmoDrag.startAlong;
      let factor = 1 + delta;
      if (snap) factor = Math.max(GIZMO.snapScale, Math.round(factor / GIZMO.snapScale) * GIZMO.snapScale);
      factor = Math.max(0.05, factor);
      r.box.h = gizmoDrag.startH.map((v, i) => (i === grip.ai ? v * factor : v));
      if (r.state.scl) r.state.scl[grip.ai] = +factor.toFixed(3);
      ro.textContent = `${letter}  scale ${factor.toFixed(3)}x`;
    } else if (grip.family === "turn") {
      const others = AXES.filter((_, k) => k !== grip.ai);
      const ang = angleUnderRay(A, others[0], O, RO, RD);
      if (ang === null) return;
      let swept = ang - gizmoDrag.startAngle;
      if (snap) swept = Math.round(swept / GIZMO.snapTurn) * GIZMO.snapTurn;
      if (!r.state.rot) r.state.rot = [0, 0, 0];
      r.state.rot[grip.ai] = gizmoDrag.startRot[grip.ai] + swept * 57.29577951;
      ro.textContent = `${letter}  rotate ${(swept * 57.29577951).toFixed(1)}°`;
    }
    gizmoHot = grip;
    ro.hidden = false;
    ro.style.left = px + 18 + "px";
    ro.style.top = py + 6 + "px";
    Outliner.renderTree();
  }
  function gizmoDragStartPos() {
    if (!gizmoDrag.startP) gizmoDrag.startP = pickedBoxRow().box.p.slice();
    return gizmoDrag.startP;
  }
  function endGizmoDrag() {
    gizmoDrag = null;
    canvas.classList.remove("gizmo-drag");
    document.getElementById("vp-gizmo-readout").hidden = true;
    App.refreshAll();
  }

  function setGizmoMode(m) {
    gizmoMode = m;
    renderRail();
  }

  /* ══ THE RAIL ═══════════════════════════════════════════════════════════════════════════ */
  function renderRail() {
    const rail = document.getElementById("vp-rail");
    const T = Ed.transport;
    const running = T.mode !== 0;
    const playLabel = T.mode === 1 && T.paused ? "Paused" : "Play";
    const simLabel = T.mode === 2 && T.paused ? "Paused" : "Simulate";
    const viewLabel = orbit.viewpoint === 0
      ? (orbit.ortho ? "Orthographic" : "Perspective")
      : `${SNAP_NAMES[orbit.viewpoint]} ${orbit.ortho ? "Ortho" : "Persp"}`;

    rail.innerHTML = `
      <div class="rail-row">
        <div class="rail-left">
          <div class="brand-tile">F</div>
          <div class="dock-pair">
            <button class="dock-seg${Ed.dockLeft ? " on" : ""}" id="dock-left" title="Outliner column">${Glyphs.grid}</button>
            <button class="dock-seg${Ed.dockRight ? " on" : ""}" id="dock-right" title="Inspector column">${Glyphs.grid}</button>
          </div>
          <button class="rail-pill" id="vp-add">${Glyphs.plus}<span>Add</span></button>
        </div>
        <div class="rail-mid">
          <div class="mode-pill">
            <button class="mode-seg${!running ? " sel" : ""}" data-mode="0">Edit</button>
            <button class="mode-seg${T.mode === 2 ? " sel run-sim" : ""}${T.mode === 2 && T.paused ? " held" : ""}" data-mode="2"><span class="mdot"></span>${simLabel}</button>
            <button class="mode-seg${T.mode === 1 ? " sel run-play" : ""}${T.mode === 1 && T.paused ? " held" : ""}" data-mode="1"><span class="mdot"></span>${playLabel}</button>
          </div>
          <div class="transport-run" style="width:${running ? 3 * 30 + 11 : 0}px;opacity:${running ? 1 : 0};transition:.18s">
            <button class="run-btn" id="tb-pause" title="Pause / resume">${T.paused ? Glyphs.play : Glyphs.pause}</button>
            <button class="run-btn" id="tb-step" title="Step one frame">${Glyphs.step}</button>
            <button class="run-btn" id="tb-stop" title="Stop and restore">${Glyphs.stop}</button>
          </div>
        </div>
        <div class="rail-right">
          <button class="rail-pill" id="vp-view">${viewLabel}${!orbit.ortho ? ` <span class="fov">${Math.round(Ed.fov)}°</span>` : ""}<span class="caret"></span></button>
          <button class="rail-pill${markersOn ? " on" : ""}" id="vp-markers" title="Volume markers in the view">${Glyphs.pivot}</button>
          <span class="rail-rule"></span>
          <button class="rail-pill status-pill ${T.paused ? "held" : running ? "running" : T.realtime ? "live" : "static"}" id="vp-status">
            <span class="led"></span>${T.paused ? "Held" : running ? "Running" : T.realtime ? "Live" : "Static"}
            <span class="samples" id="vp-samples">${samples}</span>
          </button>
          <button class="gear-btn${Ed.shadeOpen ? " on" : ""}" id="vp-gear" title="Viewport settings">${Glyphs.gear}</button>
        </div>
      </div>
      <div class="rail-hairline"><div class="fill${samples >= SAMPLE_TARGET ? " refining" : ""}" id="vp-hairline" style="width:${Math.min(100, (samples / SAMPLE_TARGET) * 100)}%"></div></div>`;

    // wiring
    rail.querySelector("#dock-left").addEventListener("click", () => App.toggleDock("outliner"));
    rail.querySelector("#dock-right").addEventListener("click", () => App.toggleDock("inspector"));
    rail.querySelector("#vp-add").addEventListener("click", (e) => openAddMenu(e.currentTarget));
    rail.querySelectorAll(".mode-seg").forEach((b) =>
      b.addEventListener("click", () => {
        const m = +b.dataset.mode;
        if (m === 0) setTransport(0);
        else if (m === 2) setTransport(T.mode === 2 ? 0 : 2);
        else setTransport(T.mode === 1 ? 0 : 1);
      }));
    rail.querySelector("#tb-pause")?.addEventListener("click", () => { T.paused = !T.paused; renderRail(); });
    rail.querySelector("#tb-step")?.addEventListener("click", () => { if (T.paused) toast("Transport", "Stepped one frame"); });
    rail.querySelector("#tb-stop")?.addEventListener("click", () => setTransport(0));
    rail.querySelector("#vp-view").addEventListener("click", (e) => openViewMenu(e.currentTarget));
    rail.querySelector("#vp-markers").addEventListener("click", () => { markersOn = !markersOn; renderRail(); });
    rail.querySelector("#vp-status").addEventListener("click", () => {
      if (!running) { T.realtime = !T.realtime; bumpView(); renderRail(); toast("Viewport", T.realtime ? "Realtime on" : "Clock held"); }
    });
    rail.querySelector("#vp-gear").addEventListener("click", () => App.toggleShade());
  }

  function renderRailStatus() {
    const s = document.getElementById("vp-samples");
    if (s) s.textContent = samples;
    const fill = document.getElementById("vp-hairline");
    if (fill) {
      fill.style.width = Math.min(100, (samples / SAMPLE_TARGET) * 100) + "%";
      fill.classList.toggle("refining", samples >= SAMPLE_TARGET);
    }
  }

  function setTransport(m) {
    Ed.transport.mode = m;
    Ed.transport.paused = false;
    if (m === 0) toast("Transport", "Edit — the editor owns the world");
    else if (m === 1) toast("Transport", "Play — running through a scene camera");
    else toast("Transport", "Simulate — running the world");
    renderRail();
  }

  /* the views menu: two projections, then the six compass snaps */
  function openViewMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    const box = document.createElement("div");
    const rows = ["Perspective", "Orthographic", null, ...SNAP_NAMES.slice(1)];
    rows.forEach((label, i) => {
      if (label === null) {
        const sep = document.createElement("div");
        sep.className = "popup-sep";
        box.appendChild(sep);
        return;
      }
      const it = document.createElement("div");
      const ticked = i < 2 ? (i === 1) === orbit.ortho && orbit.viewpoint === 0
        : orbit.viewpoint === i - 1;
      it.className = "popup-item" + (ticked ? " on" : "");
      it.innerHTML = `${ticked ? '<span class="ptick"></span>' : ""}<span>${label}</span>`;
      it.addEventListener("click", () => {
        Popup.close();
        if (i < 2) { orbit.ortho = i === 1; orbit.viewpoint = 0; bumpView(); renderRail(); }
        else snapView(i - 1);
      });
      box.appendChild(it);
    });
    Popup.open(r.left, r.bottom + 7, box);
    document.getElementById("popup").classList.add("round20");
  }

  /* the Add menu — the C++ rail's menu, plus this redesign's new items families */
  function openAddMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    const groups = [
      { name: "Lights", items: [
        { name: "Directional Light (Sun)", art: "Sun", make: () => spawnRow("Sun Light", "light", "Sun") },
        { name: "Point Light", art: "EditorPointLight", make: () => spawnRow("Point Light", "light", "EditorPointLight") },
        { name: "Spot Light", art: "EditorSpotlight", make: () => spawnRow("Spot Light", "light", "EditorSpotlight") },
        { name: "Rect / Area Light", art: "EditorAreaLight", make: () => spawnRow("Area Light", "light", "EditorAreaLight") },
      ]},
      { name: "World & Celestial", items: [
        { name: "Sky Atmosphere", art: "Clouds", make: () => spawnRow("Sky Atmosphere", "geometry", "Clouds") },
        { name: "Cloud Layer", art: "Clouds", make: () => spawnRow("Cloud Layer", "geometry", "Clouds") },
        { name: "Local Volumetric Fog", art: "Fog", make: () => spawnRow("Local Fog", "geometry", "Fog") },
        { name: "Wind Field", art: "Wind", make: () => spawnRow("Wind Field", "geometry", "Wind") },
        { name: "Rainbow", art: "Rainbow", make: () => spawnRow("Rainbow", "geometry", "Rainbow") },
        { name: "Lens Flare", art: "LensFlare", make: () => spawnRow("Lens Flare", "geometry", "LensFlare") },
        { name: "Moon / Satellite", art: "Moon", make: () => spawnRow("Moon", "geometry", "Moon") },
      ]},
      { name: "Cameras", items: [
        { name: "Main Camera", art: "Camera", make: () => spawnRow("Camera", "camera", "Camera", "camera") },
        { name: "Cine Camera (35mm)", art: "Camera", make: () => spawnRow("Cine 35mm", "camera", "Camera", "camera") },
        { name: "Cine Camera (50mm)", art: "Camera", make: () => spawnRow("Cine 50mm", "camera", "Camera", "camera") },
        { name: "Cine Camera (85mm)", art: "Camera", make: () => spawnRow("Cine 85mm", "camera", "Camera", "camera") },
        { name: "Post Process Volume", art: "EditorInstance", make: () => spawnRow("Post Process", "geometry", "EditorInstance", "post") },
      ]},
      { name: "Geometry Primitives", items: [
        { name: "Plane / Ground", art: "EditorGrid", make: () => spawnRow("Plane", "geometry", "EditorGrid") },
        { name: "Cube / Box", art: "EditorCube", make: () => spawnRow("Cube", "geometry", "EditorCube") },
        { name: "Sphere", art: "EditorSphere", make: () => spawnRow("Sphere", "geometry", "EditorSphere") },
        { name: "Cylinder", art: "EditorCylinder", make: () => spawnRow("Cylinder", "geometry", "EditorCylinder") },
        { name: "Cone", art: "EditorCone", make: () => spawnRow("Cone", "geometry", "EditorCone") },
        { name: "Torus", art: "EditorTorus", make: () => spawnRow("Torus", "geometry", "EditorTorus") },
      ]},
      { name: "Vehicles", items: [
        { name: "Show Coupé", art: "EditorVehicle", make: () => spawnRow("Coupé", "geometry", "EditorVehicle", "vehicle") },
        { name: "Rally Tyre", art: "EditorTyre", make: () => spawnRow("Tyre", "geometry", "EditorTyre", "tyre") },
        { name: "Wheel Rim", art: "EditorWheelRim", make: () => spawnRow("Wheel Rim", "geometry", "EditorWheelRim", "tyre") },
        { name: "Tread Sample", art: "EditorTread", make: () => spawnRow("Tread", "geometry", "EditorTread", "tread") },
      ]},
      { name: "Cloth & Foliage", items: [
        { name: "Silk Canopy", art: "SlateFabric", make: () => spawnRow("Canopy", "geometry", "SlateFabric", "cloth") },
        { name: "Tree", art: "EditorTree", make: () => spawnRow("Tree", "geometry", "EditorTree", "foliage") },
        { name: "Plant", art: "EditorPlant", make: () => spawnRow("Plant", "geometry", "EditorPlant", "foliage") },
      ]},
    ];
    Popup.open(r.left, r.bottom + 7, Popup.addMenu(groups, (it) => it.make()));
  }

  /* ConstructEntity's HTML twin: append a placement row + its coloured box */
  function spawnRow(base, category, art, appearance = "generic") {
    const R = Ed.roster;
    let name = base;
    for (let n = 2; R.some((r) => r.label === name); n++) name = `${base} ${n}`;
    const folderIdx = category === "camera" ? R.findIndex((r) => r.label === "Scene")
      : R.findIndex((r) => r.label === "World");
    const at = folderIdx >= 0 ? runEnd(R, folderIdx) : R.length;
    const hueSeed = R.filter((r) => r.box).length;
    const p = [(Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3 + 1, 0.4 + Math.random() * 0.6];
    const nr = row({
      label: name, depth: folderIdx >= 0 ? 1 : 0, category,
      tint: category === "camera" ? T.camera : category === "light" ? T.light : [0.85, 0.86, 0.9],
      art, narrowing: category === "light" ? "lights" : category === "camera" ? "camera" : "bodies",
      dynamic: true, appearance,
      box: { p, h: [0.35, 0.35, 0.35] },
      state: { pos: p.slice(), rot: [0, 0, 0], scl: [1, 1, 1] },
    });
    nr.hue = ENTRY_HUES[hueSeed % ENTRY_HUES.length];
    R.splice(at, 0, nr);
    Ed.picked = [R.indexOf(nr)];
    toast("Construct", `${name} seated in the world`);
    App.refreshAll();
  }

  /* ── the console ───────────────────────────────────────────────────────────────────────── */
  const QUICK = [
    { label: "Play — run through a camera", sub: "transport", run: () => setTransport(1) },
    { label: "Simulate — run the world", sub: "transport", run: () => setTransport(2) },
    { label: "Pause / resume", sub: "transport", run: () => { Ed.transport.paused = !Ed.transport.paused; renderRail(); } },
    { label: "Step one frame", sub: "transport", run: () => toast("Transport", "Stepped one frame") },
    { label: "Stop and restore", sub: "transport", run: () => setTransport(0) },
    { label: "Realtime — hold / release the clock", sub: "viewport", run: () => { Ed.transport.realtime = !Ed.transport.realtime; renderRail(); } },
  ];
  function renderConsole() {
    const host = document.getElementById("vp-console");
    host.innerHTML = `
      ${Glyphs.command}
      <input type="text" id="console-input" placeholder="Type a command…" spellcheck="false">
      <span class="k">esc</span>
      <div class="suggest-stack" id="suggest-stack" hidden></div>`;
    const input = host.querySelector("#console-input");
    const stack = host.querySelector("#suggest-stack");
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      const hits = QUICK.filter((c) => !q || c.label.toLowerCase().includes(q));
      if (!hits.length) { stack.hidden = true; return; }
      stack.hidden = false;
      stack.innerHTML = "";
      hits.forEach((c, i) => {
        const d = document.createElement("div");
        d.className = "sug-row" + (i === 0 ? " sel" : "");
        d.innerHTML = `${Glyphs.command}<span>${c.label}</span><span class="sug-sub">${c.sub}</span>`;
        d.addEventListener("click", () => { c.run(); toggleConsole(false); });
        stack.appendChild(d);
      });
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const q = input.value.trim().toLowerCase();
        const hit = QUICK.find((c) => !q || c.label.toLowerCase().includes(q));
        if (hit) hit.run();
        toggleConsole(false);
      }
      if (e.key === "Escape") toggleConsole(false);
    });
    setTimeout(() => input.focus(), 0);
  }
  function toggleConsole(force) {
    const c = document.getElementById("vp-console");
    const show = force ?? c.hidden;
    c.hidden = !show;
    if (show) renderConsole();
  }

  /* ── the stats footer ──────────────────────────────────────────────────────────────────── */
  function renderFoot() {
    const host = document.getElementById("vp-foot");
    if (!host) return;
    const entries = visibleEntries().length;
    const shown = Ed.roster.filter((r) => r.box && r.visible).length;
    const cam = `${orbit.yaw >= 0 ? "+" : ""}${(orbit.yaw * 57.29578).toFixed(0)}° ${orbit.pitch >= 0 ? "+" : ""}${(orbit.pitch * 57.29578).toFixed(0)}° ${orbit.dist.toFixed(1)}m`;
    const band = fps >= 50 ? "good" : fps < 24 ? "poor" : "fair";
    host.innerHTML = `
      <div class="vp-cell"><span class="c-label">FPS</span><span class="c-fig ${band}">${Math.round(fps)}</span><span class="c-sub">· ${(fps > 0 ? 1000 / fps : 0).toFixed(1)} ms</span></div>
      <div class="vp-cell"><span class="c-label">TRIS</span><span class="c-fig">${Readout.triangles}</span></div>
      <div class="vp-cell"><span class="c-label">INSTANCES</span><span class="c-fig">${entries}</span><span class="c-sub">· ${shown} visible</span></div>
      <div class="vp-cell"><span class="c-label">CAMERA</span><span class="c-fig">${cam}</span></div>`;
  }

  /* ── boot ──────────────────────────────────────────────────────────────────────────────── */
  function init() {
    canvas = document.getElementById("vp-canvas");
    ctx = canvas.getContext("2d");
    resize();
    window.addEventListener("resize", resize);
    attachInput();
    renderRail();
    renderFoot();
    requestAnimationFrame(frame);
  }

  return { init, renderRail, renderRailStatus, renderFoot, toggleConsole, setGizmoMode, get mode() { return gizmoMode; } };
})();
