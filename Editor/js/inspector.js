/* ══════════════════════════════════════════════════════════════════════════════════════════════
   INSPECTOR.JS — InspectorPanel.cpp, copied as is: the empty state, the ident strip, the schema
   cards drawn from the picked row's sheet, the instance standing, the notes card and the foot
   strip. Every control edits the feed's own figures through the ControlPanel widget vocabulary.
   Nothing invented, nothing omitted.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

"use strict";

const Inspector = (() => {
  const cardShut = {};   // fold pose per sheet card + the notes card

  function pickedRow() {
    const i = Ed.picked.length ? Ed.picked[Ed.picked.length - 1] : -1;
    return i >= 0 && i < Ed.roster.length ? { row: Ed.roster[i], index: i } : null;
  }

  /* ── the whole panel ───────────────────────────────────────────────────────────────────── */
  function renderAll(embeddedHost) {
    const host = embeddedHost || document.getElementById("inspector-body");
    host.innerHTML = "";
    const picked = pickedRow();

    if (!picked) {
      host.appendChild(emptyState());
      host.appendChild(footer(null));
      return;
    }
    const { row: r, index } = picked;

    host.appendChild(ident(r, index));

    const scroll = document.createElement("div");
    scroll.className = "insp-scroll";
    const cards = document.createElement("div");
    cards.className = "cards";
    for (const g of buildSheet(r)) cards.appendChild(card(g, r, index));
    scroll.appendChild(cards);
    scroll.appendChild(standing(r, index));
    scroll.appendChild(notes(r));
    host.appendChild(scroll);
    host.appendChild(footer(r));
  }

  /* ── "Nothing selected" ────────────────────────────────────────────────────────────────── */
  function emptyState() {
    const d = document.createElement("div");
    d.className = "insp-empty";
    d.innerHTML = `<div class="t1">Nothing selected</div><div class="t2">Pick an instance in the outliner.</div>`;
    return d;
  }

  /* ── the 56 px ident strip ─────────────────────────────────────────────────────────────── */
  function ident(r, index) {
    const d = document.createElement("div");
    d.className = "ident";
    const tint = tintCss(r.tint);
    const suffix = r.locked && !r.visible ? " · locked · hidden"
      : r.locked ? " · locked" : !r.visible ? " · hidden" : "";
    d.innerHTML = `
      <div class="ident-tile" style="background:${tintCss(r.tint, .14)};box-shadow:inset 0 0 0 1px ${tintCss(r.tint, .43)}">
        <span class="id-dot" style="background:${tint}"></span>
      </div>
      <div class="ident-mid">
        <input class="ident-name" type="text" spellcheck="false" value="${escapeAttr(r.label)}">
        <span class="ident-caps">${catLabel(r.category).toUpperCase()}<span class="suffix">${suffix}</span></span>
      </div>
      <button class="ident-btn lock${r.locked ? " on" : ""}" title="Lock">${Glyphs.lock}</button>
      <button class="ident-btn vis${r.visible ? " on" : ""}" title="Visibility">${r.visible ? Glyphs.eye : Glyphs.eyeOff}</button>`;

    const name = d.querySelector(".ident-name");
    name.addEventListener("change", () => {
      r.label = name.value.trim() || r.label;
      name.value = r.label;
      App.refreshAll();
    });
    d.querySelector(".lock").addEventListener("click", (e) => {
      r.locked = !r.locked; renderAll(e.currentTarget.closest("#construct-inspector") ? document.getElementById("construct-inspector") : null);
      App.refreshOutliner();
    });
    d.querySelector(".vis").addEventListener("click", (e) => {
      r.visible = !r.visible; renderAll(e.currentTarget.closest("#construct-inspector") ? document.getElementById("construct-inspector") : null);
      App.refreshOutliner(); App.refreshViewport();
    });
    return d;
  }

  /* ── one schema card ───────────────────────────────────────────────────────────────────── */
  function card(group, r, index) {
    const id = `${index}:${group.title}`;
    const shut = !!cardShut[id];
    const d = document.createElement("div");
    d.className = "card" + (group.stacked ? " stacked" : "");
    const head = document.createElement("div");
    head.className = "card-head";
    head.innerHTML = `<span class="card-chev">${shut ? Glyphs.chevron : Glyphs.chevronUp}</span>
      <span class="card-title">${escapeHtml(group.title)}</span>`;
    head.addEventListener("click", () => {
      cardShut[id] = !cardShut[id];
      renderAllInPlace(d);
    });
    d.appendChild(head);

    if (!shut) {
      if (group.caption) {
        const c = document.createElement("div");
        c.className = "card-caption"; c.textContent = group.caption;
        d.appendChild(c);
      }
      for (const p of group.props ?? []) d.appendChild(prow(p, r));
    }
    return d;
  }

  function renderAllInPlace(cardEl) {
    // Re-render the panel that owns this card (main column or the Construct embed).
    if (cardEl.closest("#construct-inspector")) Construct.renderEmbedded();
    else renderAll();
  }

  /* ── one property row: label + zone widget (ProwHeight per category) ───────────────────── */
  function prow(p, r) {
    const d = document.createElement("div");
    d.className = "prow " + p.cat;
    const label = document.createElement("span");
    label.className = "p-label";
    label.textContent = p.label;
    d.appendChild(label);
    const zone = document.createElement("div");
    zone.className = "p-zone";

    const dirty = () => { App.refreshOutliner(); App.refreshViewport(); };
    switch (p.cat) {
      case "slider":  zone.appendChild(Widgets.slider(p, () => { dirty(); syncSheetSideEffects(r, p); })); break;
      case "switch":  zone.appendChild(Widgets.switch(p, dirty)); break;
      case "vec3":    zone.appendChild(Widgets.vec3(p, () => { dirty(); syncTransform(r, p); })); break;
      case "colour":  zone.appendChild(Widgets.colour(p, dirty)); break;
      case "select":  zone.appendChild(Widgets.dropdown(p, dirty)); break;
      case "readout": zone.appendChild(Widgets.readout(p)); break;
    }
    d.appendChild(zone);
    return d;
  }

  /* Sliders that write back into the shared world (Sun elevation, camera rows…) */
  function syncSheetSideEffects(r, p) {
    if (r.appearance === "sun") {
      if (p.label === "Elevation") Readout.sunElevation = p.figure;
      if (p.label === "Azimuth" || p.label === "Elevation") {
        const s = r.state;
        r.meta = s.elevation.toFixed(1) + "°";
      }
    }
    if (r.appearance === "luminaire" && p.label === "Power")
      r.meta = Math.round(p.figure) + " lx";
    if (r.appearance === "camera" && p.label === "Fov")
      r.meta = Math.round(p.figure) + "°";
    if (r.appearance === "cloth" && p.label === "Tint") {}
  }
  function syncTransform(r, p) {
    if (!r.box || !r.state.pos) return;
    if (p.label === "Position") {
      r.box.p = [p.axes[0], p.axes[1], p.axes[2]];
      r.state.pos = p.axes;
    }
  }

  /* ── the instance standing card ────────────────────────────────────────────────────────── */
  function standing(r, index) {
    const d = document.createElement("div");
    d.className = "card";
    d.innerHTML = `<div class="card-head"><span class="card-title" style="margin-left:16px">Instance</span></div>`;
    const pills = document.createElement("div");
    pills.className = "pills-row";
    const defs = [
      ["Visible", r.visible, (v) => { r.visible = v; App.refreshAll(); }],
      ["Locked", r.locked, (v) => { r.locked = v; App.refreshAll(); }],
      ["Dynamic", r.dynamic, (v) => { r.dynamic = v; }],
      ["Physics", r.physics, (v) => { r.physics = v; }],
    ];
    for (const [label, on, fn] of defs) pills.appendChild(Widgets.pillToggle(label, on, fn));
    d.appendChild(pills);

    const rows = document.createElement("div");
    rows.style.marginTop = "10px";
    rows.appendChild(prow({ label: "TYPE", cat: "readout", text: catLabel(r.category) }, r));
    rows.appendChild(prow({ label: "ID", cat: "readout", text: "#" + String(index).padStart(3, "0") }, r));
    d.appendChild(rows);
    return d;
  }

  /* ── the notes card ────────────────────────────────────────────────────────────────────── */
  function notes(r) {
    const id = `notes:${r.key}`;
    const shut = !!cardShut[id];
    const d = document.createElement("div");
    d.className = "card";
    const head = document.createElement("div");
    head.className = "card-head";
    head.innerHTML = `<span class="card-chev">${shut ? Glyphs.chevron : Glyphs.chevronUp}</span>
      <span class="card-title">Notes</span>`;
    head.addEventListener("click", () => {
      cardShut[id] = !cardShut[id];
      const again = notes(r);
      d.replaceWith(again);
    });
    d.appendChild(head);
    if (!shut) {
      const t = document.createElement("textarea");
      t.className = "notes-area";
      t.value = r.notes || "";
      t.addEventListener("input", () => (r.notes = t.value));
      d.appendChild(t);
    }
    return d;
  }

  /* ── the foot strip: "Geometry · dynamic" left; FPS / TRIS right ───────────────────────── */
  function footer(r) {
    const d = document.createElement("footer");
    d.className = "foot-strip insp-foot";
    const left = !r ? "—"
      : `${catLabel(r.category)} · ${r.dynamic ? "dynamic" : "static"}${r.locked ? " · locked" : ""}`;
    const fps = Readout.fps;
    const band = fps >= 50 ? "good" : fps < 24 ? "poor" : "fair";
    const tris = Readout.triangles > 0 ? String(Readout.triangles) : "—";
    d.innerHTML = `
      <span class="left">${left}</span>
      <span class="right">
        <span class="caps">FPS</span><span class="fig ${band}">${Math.round(fps)}</span>
        <span class="caps">·</span>
        <span class="caps">TRIS</span><span class="fig ${tris === "—" ? "none" : ""}">${tris}</span>
        ${band === "poor" ? `<span class="warn-tri">${Glyphs.warn}</span>` : ""}
      </span>`;
    return d;
  }

  function catLabel(c) {
    return { folder: "Folder", geometry: "Geometry", light: "Light", camera: "Camera" }[c] || "?";
  }

  /* the tick's live figures without disturbing the sheet: only the foot strip re-seats */
  function updateFooter() {
    const host = document.getElementById("inspector-body");
    const foot = host && host.querySelector(".insp-foot");
    if (!foot) return;
    const r = pickedRow();
    const fresh = footer(r ? r.row : null);
    foot.replaceWith(fresh);
  }

  return { renderAll, pickedRow, updateFooter };
})();

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function escapeAttr(s) { return escapeHtml(s); }
