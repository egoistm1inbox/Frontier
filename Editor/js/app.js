/* ══════════════════════════════════════════════════════════════════════════════════════════════
   APP.JS — EditorHost.cpp's record pass: seats the shared state, wires the three panels over
   the feed, and owns the editor-wide controls — the tab close marks, the Construct window
   (Shift A), the Control Centre shade behind the gear, and the keys (Tab compacts the outliner,
   Ctrl+Shift+F lands in the search, Ctrl+K raises the console, W/E/R seat the gizmo's mode).
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

"use strict";

/* the shared editor state the panels borrow each tick */
const Ed = {
  roster: Roster,
  picked: [9],                 // the sheet opens on the Tall Box
  shut: {},                    // collapse pose per row key (false reads open)
  compact: false,
  dockLeft: true,
  dockRight: true,
  dragging: -1,
  orderRevision: 0,
  fov: 55,
  shadeOpen: false,
  transport: { mode: 0, paused: false, realtime: true },
};
// default selection: the first dynamic object
Ed.picked = [Roster.findIndex((r) => r.label === "Tall Box")];

const App = (() => {
  function refreshOutliner() { Outliner.renderAll(); }
  function refreshInspector() { Inspector.renderAll(); }
  function refreshViewport() { Viewport.renderRailStatus(); }
  function refreshAll() {
    Outliner.renderAll();
    Inspector.renderAll();
    Viewport.renderRailStatus();
  }
  function toggleCompact() {
    Ed.compact = !Ed.compact;
    document.getElementById("col-outliner").classList.toggle("compact", Ed.compact);
    Outliner.renderAll();
  }
  function toggleDock(which) {
    const col = document.getElementById("col-" + which);
    const closing = !col.classList.contains("closed");
    col.classList.toggle("closed", closing);
    if (which === "outliner") Ed.dockLeft = !closing; else Ed.dockRight = !closing;
    Viewport.renderRail();
  }
  function toggleShade(force) {
    Ed.shadeOpen = force ?? !Ed.shadeOpen;
    const s = document.getElementById("shade");
    s.hidden = !Ed.shadeOpen;
    if (Ed.shadeOpen) renderShade();
    Viewport.renderRail();
  }

  /* ── the Control Centre shade — the gear's card ────────────────────────────────────────── */
  const ShadeState = { gi: true, aa: true, quality: 1, scale: 100, fpsOverlay: false };
  function renderShade() {
    const card = document.getElementById("shade-card");
    card.innerHTML = `
      <div class="shade-title">${Glyphs.gear}<span>Control Centre</span><span class="proj">${Readout.scene} · Project Zero</span></div>
      <div class="shade-row"><span class="s-label">Quality</span>
        <select id="shade-quality">
          ${["Performance", "Standard", "High", "Epic"].map((q, i) =>
            `<option ${i === ShadeState.quality ? "selected" : ""}>${q}</option>`).join("")}
        </select></div>
      <div class="shade-row"><span class="s-label">Global illumination</span><span id="shade-gi"></span></div>
      <div class="shade-row"><span class="s-label">Anti-aliasing</span><span id="shade-aa"></span></div>
      <div class="shade-row"><span class="s-label">Render scale</span>
        <span class="shade-scale"><input type="range" min="50" max="200" step="5" value="${ShadeState.scale}" id="shade-scale"><output id="shade-scale-out">${ShadeState.scale}%</output></span></div>
      <div class="shade-row"><span class="s-label">Frame-rate overlay</span><span id="shade-fps"></span></div>`;
    const mk = (sel, prop) => {
      const host = card.querySelector(sel);
      const p = { on: ShadeState[prop] };
      host.appendChild(Widgets.switch(p, () => { ShadeState[prop] = p.on; }));
    };
    mk("#shade-gi", "gi"); mk("#shade-aa", "aa"); mk("#shade-fps", "fpsOverlay");
    card.querySelector("#shade-quality").addEventListener("change", (e) => {
      ShadeState.quality = e.target.selectedIndex;
      Readout.quality = e.target.value;
      publishShade();
    });
    card.querySelector("#shade-scale").addEventListener("input", (e) => {
      ShadeState.scale = +e.target.value;
      card.querySelector("#shade-scale-out").textContent = ShadeState.scale + "%";
    });
    card.querySelector("#shade-scale").addEventListener("change", publishShade);
    card.querySelectorAll(".switch").forEach((s) => s.addEventListener("click", () => setTimeout(publishShade, 0)));
  }
  function publishShade() {
    toast("Render settings applied",
      `${["Performance", "Standard", "High", "Epic"][ShadeState.quality]}  |  GI ${ShadeState.gi ? "on" : "off"}, AA ${ShadeState.aa ? "on" : "off"}, scale ${ShadeState.scale}%`);
    Outliner.renderFoot();
  }

  /* ── the Construct window (NativeConstructPanel) ───────────────────────────────────────── */
  const Construct = (() => {
    let open = false, details = false, group = 0, key = -1;
    const GROUPS = ["All", "Environment", "Weather", "Cameras", "Geometry", "Lighting", "Vehicles", "Cloth"];
    let search = "";

    function groupOf(r) {
      if (r.appearance === "vehicle" || r.appearance === "tyre" || r.appearance === "tread") return 6;
      if (r.appearance === "cloth" || r.appearance === "foliage") return 7;
      if (["sun", "luminaire"].includes(r.appearance)) return 1;
      if (["camera", "post"].includes(r.appearance)) return 3;
      if (r.category === "light") return 5;
      if (["cloth"].includes(r.appearance)) return 7;
      return 4;
    }
    function matches(r) {
      if (!search) return true;
      return r.label.toLowerCase().includes(search);
    }
    function openWindow() {
      open = true; details = false;
      document.getElementById("construct-scrim").hidden = false;
      renderCatalogue(); renderChrome();
      setTimeout(() => document.getElementById("construct-search").focus(), 30);
    }
    function closeWindow() {
      open = false;
      document.getElementById("construct-scrim").hidden = true;
    }
    function renderChrome() {
      const s1 = document.getElementById("construct-step1");
      const s2 = document.getElementById("construct-step2");
      s1.classList.toggle("lit", !details);
      s2.classList.toggle("lit", details);
      document.getElementById("construct-slides").classList.toggle("details", details);
    }
    function renderCatalogue() {
      const cats = document.getElementById("construct-cats");
      cats.innerHTML = "";
      GROUPS.forEach((g, i) => {
        const b = document.createElement("button");
        b.className = "construct-cat" + (group === i ? " sel" : "");
        b.textContent = g;
        b.addEventListener("click", () => { group = i; renderCatalogue(); });
        cats.appendChild(b);
      });
      const tiles = document.getElementById("construct-tiles");
      tiles.innerHTML = "";
      let written = 0;
      Ed.roster.forEach((r, i) => {
        if (r.category === "folder") return;
        if (group && groupOf(r) !== group) return;
        if (!matches(r)) return;
        written++;
        const t = document.createElement("button");
        t.className = "construct-tile";
        t.innerHTML = `${artImg(r.art || artworkFor(r) || "EditorMesh", 52)}<span class="ct-name">${escapeHtml(r.label)}</span>`;
        t.addEventListener("click", () => { key = r.key; details = true; renderChrome(); renderProperties(); });
        tiles.appendChild(t);
      });
      if (!written) tiles.innerHTML = `<span class="construct-note">No matching engine entities.</span>`;
    }
    function rowOfKey() {
      const i = Ed.roster.findIndex((r) => r.key === key);
      return i >= 0 ? { r: Ed.roster[i], i } : null;
    }
    function renderProperties() {
      const found = rowOfKey();
      const label = document.getElementById("construct-proplabel");
      const enable = document.getElementById("construct-enable");
      const host = document.getElementById("construct-inspector");
      if (!found) {
        label.textContent = "Entity no longer exists.";
        host.innerHTML = "";
        return;
      }
      const { r, i } = found;
      label.textContent = r.label;
      // "Enable in world" stands when the row (or any ancestor) is hidden
      let hidden = !r.visible, walk = i, depth = r.depth;
      while (depth > 0 && walk > 0) {
        walk--;
        if (Ed.roster[walk].depth < depth) { hidden = hidden || !Ed.roster[walk].visible; depth = Ed.roster[walk].depth; }
      }
      enable.hidden = !hidden;
      enable.onclick = () => {
        r.visible = true;
        let w = i, d = r.depth;
        while (d > 0 && w > 0) { w--; if (Ed.roster[w].depth < d) { Ed.roster[w].visible = true; d = Ed.roster[w].depth; } }
        renderProperties(); refreshAll();
        toast("Construct", `${r.label} enabled in the world`);
      };
      // the embedded inspector: the same panel, seated over the picked row
      const keep = Ed.picked.slice();
      Ed.picked = [i];
      host.innerHTML = "";
      Inspector.renderAll(host);
      host.appendChild(document.createElement("div")).style.height = "14px";
      Ed.picked = keep.length ? keep : Ed.picked;
      // keep the selection attached to the key, as the C++ panel does
      Ed.picked = [i];
    }
    function renderEmbedded() { if (open && details) renderProperties(); }

    function init() {
      document.getElementById("construct-close").addEventListener("click", closeWindow);
      document.getElementById("construct-scrim").addEventListener("pointerdown", (e) => {
        if (e.target.id === "construct-scrim") closeWindow();
      });
      document.getElementById("construct-back").addEventListener("click", () => {
        details = false; renderChrome(); renderCatalogue();
      });
      document.getElementById("construct-search").addEventListener("input", (e) => {
        search = e.target.value.trim().toLowerCase();
        renderCatalogue();
      });
      document.getElementById("outliner-add").addEventListener("click", openWindow);
    }
    return { init, openWindow, closeWindow, renderEmbedded, get open() { return open; } };
  })();

  /* ── the keys ──────────────────────────────────────────────────────────────────────────── */
  function attachKeys() {
    window.addEventListener("keydown", (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
      if (e.key === "Escape") {
        if (Construct.open) { Construct.closeWindow(); return; }
        Popup.close();
        if (Ed.shadeOpen) toggleShade(false);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "F" || e.key === "f")) {
        e.preventDefault(); Ed.compact = false;
        document.getElementById("col-outliner").classList.remove("compact");
        Outliner.renderAll(); Outliner.focusSearch();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault(); Viewport.toggleConsole(); return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "r" || e.key === "R") && !typing) {
        e.preventDefault();
        Ed.transport.realtime = !Ed.transport.realtime;
        Viewport.renderRail();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Tab" && !Construct.open) { e.preventDefault(); toggleCompact(); return; }
      if (e.shiftKey && (e.key === "A" || e.key === "a")) { e.preventDefault(); Construct.openWindow(); return; }
      if (e.key === "w" || e.key === "W") Viewport.setGizmoMode(0);
      if (e.key === "e" || e.key === "E") Viewport.setGizmoMode(1);
      if (e.key === "r" || e.key === "R") Viewport.setGizmoMode(2);
      if (e.key === "Delete" || e.key === "Backspace") {
        // withdraw the picked non-pinned rows, the roster re-reads on the same tick
        const keep = [];
        const kill = new Set(Ed.picked);
        for (let i = 0; i < Ed.roster.length; i++) {
          const r = Ed.roster[i];
          if (kill.has(i) && !r.pinned) continue;
          keep.push(r);
        }
        if (keep.length !== Ed.roster.length) {
          Ed.roster.length = 0;
          Ed.roster.push(...keep);
          Ed.picked = [];
          toast("Outliner", "Row withdrawn from the roster");
          refreshAll();
        }
      }
    });
  }

  /* ── the tab close marks ───────────────────────────────────────────────────────────────── */
  function attachTabs() {
    document.querySelectorAll(".tab-close").forEach((b) =>
      b.addEventListener("click", () => {
        const col = b.closest(".dock-column");
        col.classList.add("closed");
        if (col.dataset.col === "outliner") Ed.dockLeft = false;
        if (col.dataset.col === "inspector") Ed.dockRight = false;
        Viewport.renderRail();
      }));
  }

  /* ── boot ──────────────────────────────────────────────────────────────────────────────── */
  function init() {
    Viewport.init();
    Outliner.renderAll();
    Inspector.renderAll();
    Construct.init();
    attachTabs();
    attachKeys();
    // the sun's meta rides the readout
    const sun = Ed.roster.find((r) => r.appearance === "sun");
    if (sun) sun.meta = sun.state.elevation.toFixed(1) + "°";
  }

  return { init, refreshAll, refreshOutliner, refreshInspector, refreshViewport,
           toggleCompact, toggleDock, toggleShade, Construct };
})();

window.App = App;
window.Ed = Ed;
App.init();
