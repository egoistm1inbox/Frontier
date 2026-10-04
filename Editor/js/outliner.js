/* ══════════════════════════════════════════════════════════════════════════════════════════════
   OUTLINER.JS — OutlinerPanel.cpp, spoken in the DOM. The panel head with its compact toggle,
   the two census tiles, the search pill, the per-host filter dropdown, the 39 px rows
   (chevron · glyph · name · tag · live meta · standing dot · eye) with drag-and-drop reparenting,
   and the five-column readout strip at the foot. Behaviour is the page's: click picks
   (Ctrl toggles, Shift spans), the chevron opens, double-click toggles, the eye hides, a drag
   reparents (top 28 % = sibling before, the rest = child, empty space = root), Tab compacts,
   Ctrl+Shift+F lands in the search, and an empty outline says "Nothing here."
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

"use strict";

/* the Project-Zero/game filter catalogue (EditorHost's GameFilters) */
const FILTERS = [
  { label: "Lights",   css: "#ffb454", mask: 1 << 1, on: false },
  { label: "Sky",      css: "#5aa9ff", mask: 1 << 2, on: false },
  { label: "Bodies",   css: "#dfe6f5", mask: 1 << 3, on: false },
  { label: "Geometry", css: "#e2e8f0", mask: 1 << 4, on: false },
  { label: "Camera",   css: "#34c759", mask: 1 << 5, on: false },
];

const Outliner = (() => {
  let query = "";
  let searchEl = null;

  /* ── the walk's visibility: matches, then ancestors of matches ─────────────────────────── */
  function shownRows() {
    const R = Ed.roster;
    const searching = query.trim() !== "";
    const lit = FILTERS.filter((f) => f.on);
    const mask = lit.reduce((m, f) => m | f.mask, 0);
    const shown = new Array(R.length).fill(false);
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      let match = !searching || r.label.toLowerCase().includes(query.trim().toLowerCase());
      if (match && mask) match = (rowFilterMask(r) & mask) !== 0;
      if (match && r.category === "folder" && (searching || mask)) match = false;
      shown[i] = match;
    }
    for (let i = 0; i < R.length; i++) {
      if (!shown[i]) continue;
      let o = ownerOf(R, i);
      while (o >= 0) { shown[o] = true; o = ownerOf(R, o); }
    }
    return shown;
  }

  /* ── header: "Outliner" + "Scene · N nodes" + compact button ───────────────────────────── */
  function renderHead() {
    const head = document.getElementById("outliner-head");
    const total = Ed.roster.filter((r) => r.category !== "folder").length;
    head.innerHTML = `
      <h1>Outliner</h1>
      ${Ed.compact ? "" : `<span class="sub">${Readout.scene} · ${total} nodes</span>`}
      <button class="cbtn${Ed.compact ? " on" : ""}" title="Compact outliner (Tab)">${Glyphs.compact}</button>`;
    head.querySelector(".cbtn").addEventListener("click", () => App.toggleCompact());
  }

  /* ── the two census tiles ──────────────────────────────────────────────────────────────── */
  function renderTiles() {
    const host = document.getElementById("outliner-tiles");
    if (Ed.compact) { host.innerHTML = ""; return; }
    let vis = 0, hid = 0;
    for (const r of Ed.roster) if (r.category !== "folder") (r.visible ? vis++ : hid++);
    const tile = (ok) => `
      <div class="ss">
        <div class="ss-top">
          <span class="ss-ico ${ok ? "ok" : (hid ? "warn" : "idle")}">${ok ? Glyphs.check : Glyphs.warn}</span>
          <span class="ss-label">${ok ? "Visible" : "Hidden"}</span>
        </div>
        <span class="ss-num">${ok ? vis : hid}</span>
      </div>`;
    host.innerHTML = tile(true) + tile(false);
  }

  /* ── search pill + Filter button ───────────────────────────────────────────────────────── */
  function renderSearch() {
    const host = document.getElementById("outliner-search");
    host.innerHTML = "";
    const search = document.createElement("div");
    search.className = "search";
    search.innerHTML = `${Glyphs.search}<input type="text" spellcheck="false">`;
    searchEl = search.querySelector("input");
    searchEl.value = query;
    searchEl.placeholder = Ed.compact ? "Search" : "Search  Ctrl+Shift+F";
    searchEl.addEventListener("input", () => { query = searchEl.value; App.refreshOutliner(); App.refreshViewport(); });
    host.appendChild(search);

    const lit = FILTERS.filter((f) => f.on).length;
    const btn = document.createElement("button");
    btn.className = "narrow-btn";
    btn.innerHTML = `${Glyphs.sliders}<span>Filter</span>
      ${lit ? `<span class="narrow-count">${lit}</span>` : ""}<span class="caret"></span>`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      btn.classList.add("open");
      const r = btn.getBoundingClientRect();
      Popup.open(r.left, r.bottom + 6, Popup.filterMenu(FILTERS, (i) => {
        FILTERS[i].on = !FILTERS[i].on;
        App.refreshOutliner(); App.refreshViewport();
      }), () => btn.classList.remove("open"));
    });
    host.appendChild(btn);
  }

  /* ── lit chips ─────────────────────────────────────────────────────────────────────────── */
  function renderChips() {
    const host = document.getElementById("outliner-chips");
    host.innerHTML = "";
    if (Ed.compact) return;
    FILTERS.forEach((f) => {
      if (!f.on) return;
      const c = document.createElement("button");
      c.className = "chip";
      c.innerHTML = `<span class="dot" style="background:${f.css}"></span>${f.label}<span class="x">✕</span>`;
      c.addEventListener("click", () => { f.on = false; App.refreshOutliner(); App.refreshViewport(); });
      host.appendChild(c);
    });
  }

  /* ── the tree ──────────────────────────────────────────────────────────────────────────── */
  function renderTree() {
    const host = document.getElementById("outliner-tree");
    const shown = shownRows();
    const scrollTop = host.scrollTop;
    host.innerHTML = "";
    let drawn = 0;

    for (let i = 0; i < Ed.roster.length; i++) {
      if (!shown[i]) continue;
      const r = Ed.roster[i];
      // a shut folder's rows stay home unless a search is live
      if (r.category === "folder" && Ed.shut[r.key] && query.trim() === "") {
        host.appendChild(makeRow(i, true)); drawn++;
        i = runEnd(Ed.roster, i) - 1;
        continue;
      }
      host.appendChild(makeRow(i, false)); drawn++;
    }
    if (!drawn) {
      const e = document.createElement("div");
      e.className = "empty"; e.textContent = "Nothing here.";
      host.appendChild(e);
    }
    host.scrollTop = scrollTop;
  }

  function makeRow(i, hasShutKids) {
    const r = Ed.roster[i];
    const folder = r.category === "folder";
    const end = runEnd(Ed.roster, i);
    const hasKids = end > i + 1;
    const picked = Ed.picked.includes(i);
    const open = !Ed.shut[r.key];

    const el = document.createElement("div");
    el.className = "node" + (folder ? " folder" : "") + (picked ? " sel" : "") + (!r.visible && !folder ? " dim off" : "");
    el.style.paddingLeft = (8 + r.depth * 13) + "px";
    el.style.setProperty("--accent", tintCss(r.tint));
    el.dataset.index = i;

    // chevron
    const chev = document.createElement("span");
    chev.className = "chev" + (open ? " open" : "") + (hasKids ? "" : " hidden");
    chev.innerHTML = Glyphs.chevron;
    if (hasKids) chev.addEventListener("click", (e) => {
      e.stopPropagation();
      Ed.shut[r.key] = !Ed.shut[r.key];
      App.refreshOutliner(); App.refreshViewport();
    });
    el.appendChild(chev);

    // glyph / artwork
    const ico = document.createElement("span");
    ico.className = "nico";
    const art = artworkFor(r);
    if (r.art || art) ico.innerHTML = artImg(r.art || art, Math.min(30, 24));
    else ico.innerHTML = glyph(r.glyph || "ground", "glyph");
    ico.style.color = tintCss(r.tint);
    el.appendChild(ico);

    // name + tag
    const name = document.createElement("span");
    name.className = "nname";
    name.textContent = r.label;
    el.appendChild(name);
    if (r.tag) {
      const tag = document.createElement("span");
      tag.className = "ntag"; tag.textContent = r.tag;
      el.appendChild(tag);
    }

    // right-hand columns, measured right to left
    if (!folder) {
      const st = standingOf(r, Ed.roster, i);
      const stat = document.createElement("span");
      stat.className = "nstat " + st.standing;
      stat.title = st.note;
      stat.innerHTML = st.standing === "ok" ? Glyphs.check
        : st.standing === "quiet" ? Glyphs.dot : Glyphs.warn;
      el.appendChild(stat);
    }
    if (!Ed.compact && r.meta) {
      const meta = document.createElement("span");
      meta.className = "nmeta"; meta.textContent = r.meta;
      el.appendChild(meta);
    }
    if (!r.pinned) {
      const eye = document.createElement("button");
      eye.className = "eye";
      eye.innerHTML = r.visible ? Glyphs.eye : Glyphs.eyeOff;
      eye.addEventListener("click", (e) => {
        e.stopPropagation();
        r.visible = !r.visible;
        App.refreshAll();
      });
      el.appendChild(eye);
    }
    const db = document.createElement("span");
    db.className = "drop-before";
    el.appendChild(db);

    // clicks: pick (Ctrl toggles, Shift spans); a completed drag swallows its click
    el.addEventListener("click", (e) => {
      if (suppressClick) { suppressClick = false; return; }
      if (e.shiftKey && Ed.picked.length) {
        const a = Ed.picked[Ed.picked.length - 1];
        const lo = Math.min(a, i), hi = Math.max(a, i);
        const vis = shownRows();
        Ed.picked = [];
        for (let k = lo; k <= hi; k++) if (vis[k]) Ed.picked.push(k);
      } else if (e.ctrlKey || e.metaKey) {
        const at = Ed.picked.indexOf(i);
        if (at >= 0) Ed.picked.splice(at, 1); else Ed.picked.push(i);
      } else {
        Ed.picked = [i];
      }
      App.refreshAll();
      el.scrollIntoView?.({ block: "nearest" });
    });
    el.addEventListener("dblclick", () => {
      if (hasKids && !r.pinned) {
        Ed.shut[r.key] = !Ed.shut[r.key];
        App.refreshOutliner(); App.refreshViewport();
      }
    });

    // drag reparent — pointer events (mouse and touch alike); the seed arms on the row,
    // the document-level move/up below carry it
    if (!r.pinned && !r.component) {
      el.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || e.target.closest(".eye,.chev")) return;
        dragSeed = { i, x: e.clientX, y: e.clientY, el, started: false };
      });
    }
    return el;
  }

  /* the reparent drag, carried at document level so the pointer may leave the tree */
  let dragSeed = null;
  let suppressClick = false;
  function attachDrag() {
    document.addEventListener("pointermove", (e) => {
      if (!dragSeed) return;
      if (!dragSeed.started) {
        if (Math.hypot(e.clientX - dragSeed.x, e.clientY - dragSeed.y) < 4) return;
        dragSeed.started = true;
        Ed.dragging = dragSeed.i;
        dragSeed.el.classList.add("dragging");
        document.body.classList.add("is-dragging-row");
      }
      clearDrops();
      const t = document.elementFromPoint(e.clientX, e.clientY)?.closest(".node");
      if (t && +t.dataset.index !== Ed.dragging) {
        const rect = t.getBoundingClientRect();
        t.classList.add((e.clientY - rect.top) < rect.height * 0.28 ? "drop-before" : "drop-into");
      }
    });
    document.addEventListener("pointerup", (e) => {
      if (!dragSeed) return;
      const { started, el } = dragSeed;
      dragSeed = null;
      el.classList.remove("dragging");
      if (!started) return;
      suppressClick = true;
      document.body.classList.remove("is-dragging-row");
      const t = document.elementFromPoint(e.clientX, e.clientY)?.closest(".node");
      if (t && +t.dataset.index !== Ed.dragging) {
        const rect = t.getBoundingClientRect();
        moveRun(Ed.dragging, +t.dataset.index, (e.clientY - rect.top) < rect.height * 0.28);
      } else if (!t) {
        moveRun(Ed.dragging, -1, false);           // empty tree space seats it at the root's end
      }
      Ed.dragging = -1;
      clearDrops();
    });
  }

  function clearDrops() {
    document.querySelectorAll(".node.drop-before,.node.drop-into")
      .forEach((n) => n.classList.remove("drop-before", "drop-into"));
  }

  /* Lifts the row and everything under it; seats the run before Target (Before) or as Target's
     last row (Into); Target < 0 seats it at the root's end. Refuses a cycle. (MoveRun) */
  function moveRun(lifted, target, before) {
    const R = Ed.roster;
    if (lifted < 0 || lifted >= R.length) return;
    const end = runEnd(R, lifted);
    if (target >= lifted && target < end) return;            // cycle refused
    const pickKeys = Ed.picked.map((p) => R[p] && R[p].key);
    const run = R.splice(lifted, end - lifted);
    if (target < 0) {
      run.forEach((r) => (r.depth = 0));
      R.push(...run);
    } else {
      const t = target > lifted ? target - (end - lifted) : target;
      if (before) {
        const depth = R[t].depth;
        run.forEach((r) => (r.depth = depth));
        R.splice(t, 0, ...run);
      } else {
        const parentEnd = runEnd(R, t);
        const shift = R[t].depth + 1 - run[0].depth;
        run.forEach((r) => (r.depth += shift));
        R.splice(parentEnd, 0, ...run);
      }
    }
    Ed.orderRevision++;
    Ed.picked = pickKeys.map((k) => R.findIndex((r) => r.key === k)).filter((i) => i >= 0);
    App.refreshAll();
  }

  /* ── the foot strip: REALTIME · QUALITY · SUN · MOONS · CAM ────────────────────────────── */
  function renderFoot() {
    const host = document.getElementById("outliner-foot");
    const fps = Readout.fps;
    const band = fps >= 50 ? "good" : fps < 24 ? "poor" : "fair";
    const cam = `${Readout.cam[0].toFixed(0)}, ${Readout.cam[1].toFixed(1)}, ${Readout.cam[2].toFixed(0)}`;
    const cols = [
      { label: "REALTIME", fig: Math.round(fps), unit: "fps", cls: band === "good" ? "good" : band === "poor" ? "poor" : "", warn: band === "poor" },
      { label: "QUALITY", fig: Readout.quality, unit: "", hidec: true },
      { label: "SUN", fig: Readout.sunElevation.toFixed(1) + "°", unit: "" },
      { label: "MOONS", fig: `${Readout.moonCount}/${Readout.moonCap}`, unit: "" },
      { label: "CAM", fig: cam, hidec: true },
    ];
    host.innerHTML = cols.map((c) => `
      <div class="of-col${c.hidec ? " hide-c" : ""}">
        <span class="of-label">${c.label}</span>
        <span class="of-fig ${c.cls || ""}">
          ${c.warn ? `<span class="warn-tri">${Glyphs.warn}</span>` : ""}${c.fig}
          ${c.unit ? `<span class="unit">${c.unit}</span>` : ""}
        </span>
      </div>`).join("");
  }

  function focusSearch() { if (searchEl) searchEl.focus(); }

  function renderAll() {
    renderHead(); renderTiles(); renderSearch(); renderChips(); renderTree(); renderFoot();
  }

  attachDrag();

  return { renderAll, renderHead, renderTiles, renderSearch, renderChips, renderTree, renderFoot, focusSearch, shownRows };
})();
