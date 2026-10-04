/* ══════════════════════════════════════════════════════════════════════════════════════════════
   WIDGETS.JS — ControlPanel.cpp, the hand-drawn widget vocabulary of the property sheet.
   The reference slider (92 px split pill + 26-over-24 track), the 44×25 switch, the three axis
   cells, the colour chip with its hex readout, the eight tint dots, the split-pill dropdown,
   the standing pill and the right-aligned readout.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

"use strict";

const Widgets = {
  /* the reference slider: pill + track; returns a live element */
  slider(prop, onChange) {
    const w = document.createElement("div");
    w.className = "slider-w";
    const decimals = prop.decimals ?? 2;
    w.innerHTML = `
      <div class="slider-pill">
        <input type="text" inputmode="decimal" spellcheck="false">
        <span class="unit">${prop.unit || ""}</span>
      </div>
      <div class="slider-track${prop.hi ? " hi" : ""}">
        <div class="rail"></div><div class="fillbar"></div><div class="thumb"></div>
      </div>`;
    const input = w.querySelector("input");
    const track = w.querySelector(".slider-track");
    const fill  = w.querySelector(".fillbar");
    const thumb = w.querySelector(".thumb");

    const fmt = (v) => v.toFixed(decimals);
    const seat = () => {
      input.value = fmt(prop.figure);
      const f = Math.min(1, Math.max(0, (prop.figure - prop.min) / (prop.max - prop.min)));
      const x = 12 + f * (track.clientWidth - 24);
      thumb.style.left = x + "px";
      fill.style.width = Math.max(0, x - 13) + "px";
    };
    const commit = (v) => {
      v = Math.min(prop.max, Math.max(prop.min, v));
      if (v !== prop.figure) { prop.figure = v; onChange && onChange(); }
      seat();
    };

    input.addEventListener("change", () => {
      const v = parseFloat(input.value.replace(",", "."));
      if (Number.isFinite(v)) commit(v); else seat();
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });

    let dragging = false;
    const fromEvent = (e) => {
      const r = track.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientX - r.left - 12) / Math.max(1, r.width - 24)));
      commit(prop.min + f * (prop.max - prop.min));
    };
    track.addEventListener("pointerdown", (e) => {
      dragging = true; track.setPointerCapture(e.pointerId); fromEvent(e);
    });
    track.addEventListener("pointermove", (e) => { if (dragging) fromEvent(e); });
    track.addEventListener("pointerup", () => (dragging = false));
    requestAnimationFrame(seat);
    w._seat = seat;
    return w;
  },

  /* the reference switch — 44×25, white when on */
  switch(prop, onChange) {
    const el = document.createElement("div");
    el.className = "switch" + (prop.on ? " on" : "");
    el.innerHTML = `<div class="knob"></div>`;
    el.addEventListener("click", () => {
      prop.on = !prop.on;
      el.classList.toggle("on", prop.on);
      onChange && onChange();
    });
    return el;
  },

  /* the three axis cells — a drag on the letter scrubs, a click on the figure types in */
  vec3(prop, onChange) {
    const el = document.createElement("div");
    el.className = "vec3";
    const cls = ["x", "y", "z"];
    prop.axes.forEach((v, i) => {
      const cell = document.createElement("div");
      cell.className = `axis-cell ${cls[i]}${prop.editable === false ? " locked" : ""}`;
      if (prop.editable === false) {
        cell.innerHTML = `<span class="letter">${"XYZ"[i]}</span><span class="val">${v.toFixed(2)}</span>`;
      } else {
        cell.innerHTML = `<span class="letter">${"XYZ"[i]}</span><input type="text" inputmode="decimal" spellcheck="false" value="${v.toFixed(2)}">`;
        const input = cell.querySelector("input");
        const letter = cell.querySelector(".letter");
        input.addEventListener("change", () => {
          const n = parseFloat(input.value.replace(",", "."));
          if (Number.isFinite(n)) { prop.axes[i] = n; onChange && onChange(); }
          input.value = prop.axes[i].toFixed(2);
        });
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
        let scrub = null;
        letter.addEventListener("pointerdown", (e) => {
          scrub = { x: e.clientX, v: prop.axes[i] };
          letter.setPointerCapture(e.pointerId);
          e.preventDefault();
        });
        letter.addEventListener("pointermove", (e) => {
          if (!scrub) return;
          prop.axes[i] = scrub.v + (e.clientX - scrub.x) * 0.005;
          input.value = prop.axes[i].toFixed(2);
          onChange && onChange();
        });
        letter.addEventListener("pointerup", () => (scrub = null));
      }
      el.appendChild(cell);
    });
    el._sync = () => el.querySelectorAll("input").forEach((inp, i) => {
      if (document.activeElement !== inp) inp.value = prop.axes[i].toFixed(2);
    });
    return el;
  },

  /* colour chip + hex readout; the swatch variant seats the eight tint dots */
  colour(prop, onChange) {
    const el = document.createElement("div");
    el.className = "chip-w";
    const toHex = (t) => "#" + t.map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
    if (prop.swatches) {
      el.innerHTML = `<div class="swatch-row"></div>`;
      const row = el.querySelector(".swatch-row");
      TINT_DOTS.forEach((d) => {
        const s = document.createElement("div");
        s.className = "swatch";
        s.style.background = tintCss(d);
        row.appendChild(s);
        s.addEventListener("click", () => {
          prop.tint[0] = d[0]; prop.tint[1] = d[1]; prop.tint[2] = d[2];
          mark(); onChange && onChange();
        });
      });
      const mark = () => row.querySelectorAll(".swatch").forEach((s, i) => {
        const d = TINT_DOTS[i];
        const on = Math.abs(d[0]-prop.tint[0]) + Math.abs(d[1]-prop.tint[1]) + Math.abs(d[2]-prop.tint[2]) < 0.06;
        s.classList.toggle("on", on);
      });
      mark();
      return el;
    }
    el.innerHTML = `<div class="colour-chip"></div><span class="hex-read"></span>`;
    const chip = el.querySelector(".colour-chip");
    const hex  = el.querySelector(".hex-read");
    const seat = () => { chip.style.background = tintCss(prop.tint); hex.textContent = toHex(prop.tint); };
    seat();
    chip.addEventListener("click", (e) => {
      const pop = Popup.open(e.currentTarget.getBoundingClientRect().left,
        e.currentTarget.getBoundingClientRect().bottom + 6, Popup.colourPicker(prop.tint, () => { seat(); onChange && onChange(); }));
    });
    return el;
  },

  /* the split pill dropdown */
  dropdown(prop, onChange) {
    const el = document.createElement("div");
    el.className = "dropdown";
    el.innerHTML = `<span class="dd-val"></span><span class="dd-caret">${Glyphs.chevronUp}</span>`;
    const val = el.querySelector(".dd-val");
    val.textContent = prop.options[prop.picked] ?? prop.options[0];
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = el.getBoundingClientRect();
      el.classList.add("open");
      Popup.open(r.left, r.bottom + 6, Popup.optionList(prop.options, prop.picked, (i) => {
        prop.picked = i; val.textContent = prop.options[i];
        el.classList.remove("open");
        onChange && onChange();
      }), () => el.classList.remove("open"));
    });
    return el;
  },

  /* right-aligned dim tabular readout */
  readout(prop) {
    const el = document.createElement("div");
    el.className = "readout-text";
    el.textContent = prop.text;
    return el;
  },

  /* the standing pill */
  pillToggle(label, on, onClick) {
    const el = document.createElement("button");
    el.className = "pill-toggle" + (on ? " on" : "");
    el.textContent = label;
    el.addEventListener("click", () => onClick((el.classList.toggle("on"))));
    return el;
  },
};

/* the eight tint dots (ControlPanel kTintDots) */
const TINT_DOTS = [
  [1.000, 1.000, 1.000], [0.937, 0.325, 0.314], [1.000, 0.694, 0.294], [0.961, 0.827, 0.294],
  [0.412, 0.816, 0.427], [0.357, 0.549, 1.000], [0.604, 0.482, 1.000], [0.310, 0.820, 0.773],
];

/* ── the shared popup surface ─────────────────────────────────────────────────────────────── */
const Popup = (() => {
  const el = () => document.getElementById("popup");
  let onClose = null;

  function open(x, y, build, closed) {
    const p = el();
    p.innerHTML = "";
    p.classList.remove("round20");
    if (typeof build === "function") build(p); else p.appendChild(build);
    p.hidden = false;
    const r = p.getBoundingClientRect();
    p.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
    p.style.top  = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
    onClose = closed || null;
    setTimeout(() => document.addEventListener("pointerdown", away, true), 0);
    return p;
  }
  function away(e) {
    const p = el();
    if (!p.hidden && !p.contains(e.target)) close();
  }
  function close() {
    el().hidden = true;
    document.removeEventListener("pointerdown", away, true);
    if (onClose) { const f = onClose; onClose = null; f(); }
  }

  function optionList(options, picked, onPick) {
    const box = document.createElement("div");
    options.forEach((o, i) => {
      const it = document.createElement("div");
      it.className = "popup-item" + (i === picked ? " on" : "");
      it.innerHTML = `${i === picked ? '<span class="ptick"></span>' : ""}<span>${o}</span>`;
      it.addEventListener("click", () => { close(); onPick(i); });
      box.appendChild(it);
    });
    return box;
  }

  function filterMenu(filters, onToggle) {
    const box = document.createElement("div");
    filters.forEach((f, i) => {
      const it = document.createElement("div");
      it.className = "popup-item" + (f.on ? " on" : "");
      it.innerHTML = `<span class="pdot" style="background:${f.css}"></span><span>${f.label}</span>
        ${f.on ? `<span class="popup-check">${Glyphs.check}</span>` : ""}`;
      it.addEventListener("click", () => { onToggle(i); close(); });
      box.appendChild(it);
    });
    return box;
  }

  function addMenu(groups, onItem) {
    const box = document.createElement("div");
    groups.forEach((g) => {
      const head = document.createElement("div");
      head.className = "group-head";
      head.textContent = g.name;
      box.appendChild(head);
      g.items.forEach((it) => {
        const d = document.createElement("div");
        d.className = "popup-item";
        d.innerHTML = `${artImg(it.art || "EditorMesh", 14)}<span>${it.name}</span>`;
        d.addEventListener("click", () => { close(); onItem(it); });
        box.appendChild(d);
      });
    });
    return box;
  }

  /* a compact picker for the colour chip — hue strip + value field, keeps the chip honest */
  function colourPicker(tint, onChange) {
    const box = document.createElement("div");
    box.style.cssText = "padding:4px;min-width:220px";
    const cv = document.createElement("canvas");
    cv.width = 220; cv.height = 120; cv.style.cssText = "border-radius:10px;cursor:crosshair";
    box.appendChild(cv);
    const ctx = cv.getContext("2d");
    const draw = () => {
      for (let x = 0; x < 220; x++) {
        for (let y = 0; y < 120; y += 4) {
          const h = x / 220, s = 1 - y / 240;
          ctx.fillStyle = `hsl(${h * 360},60%,${20 + s * 55}%)`;
          ctx.fillRect(x, y, 1, 4);
        }
      }
    };
    draw();
    cv.addEventListener("pointerdown", (e) => {
      const grab = (ev) => {
        const r = cv.getBoundingClientRect();
        const x = Math.min(219, Math.max(0, ev.clientX - r.left));
        const y = Math.min(119, Math.max(0, ev.clientY - r.top));
        const c = ctx.getImageData(x, y, 1, 1).data;
        tint[0] = c[0] / 255; tint[1] = c[1] / 255; tint[2] = c[2] / 255;
        onChange();
      };
      grab(e);
      const mv = (ev) => grab(ev);
      const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", mv);
      window.addEventListener("pointerup", up);
    });
    return box;
  }

  return { open, close, optionList, filterMenu, addMenu, colourPicker };
})();

/* ── toasts (NotificationQueue) ───────────────────────────────────────────────────────────── */
function toast(title, body) {
  const host = document.getElementById("toasts");
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `<div class="t-head">${title}</div><div class="t-body">${body}</div>`;
  host.appendChild(t);
  setTimeout(() => t.classList.add("out"), 2600);
  setTimeout(() => t.remove(), 3100);
}
