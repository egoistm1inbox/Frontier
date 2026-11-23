// Owned, build-time presentation adaptation; pinned inspector sources remain byte-identical.
// Every replacement must match once so an upstream change cannot silently drop the requested style.
export function RecolourInstrument(Name, Source) {
  const Replace = (Before, After) => {
    if (Source.split(Before).length !== 2)
      throw new Error(
        `Instrument presentation anchor changed: ${Name}: ${Before.slice(0, 65)}`,
      );
    Source = Source.replace(Before, () => After);
  };
  if (Name === "wind.js") {
    // Follow-up 67: the anemometer draws with the editor's shared live trace (the Diagnostics graph): dashed grid, the mean as the
    // reference line, and red wherever the wind drops below the mean.
    Replace(
      "import { flat } from '../world.js';",
      "import { flat } from '../world.js';\nimport { PaintTrace, TraceBrush } from '../../LiveTrace.js';",
    );
    const Start = Source.indexOf("  function paintTrace() {");
    const End = Source.indexOf("  /* ── the scale");
    if (Start < 0 || End < Start) throw new Error(`Instrument presentation anchor changed: ${Name}: paintTrace`);
    Source =
      Source.slice(0, Start) +
      `  function paintTrace() {
    const w = chartWrap.clientWidth || 280, h = mc.classList.contains('tall') ? 170 : 112;
    chart.style.height = h + 'px';
    const g = TraceBrush(chart, w, h);
    const mean = SPD();
    PaintTrace(g, {
      Width: w, Height: h,
      Top: Math.max(2, Math.max(...TRACE, mean) * 1.18),
      Points: TRACE.map((Speed, Index) => ({ X: Index / (TRACE.length - 1), Y: Speed })),
      Reference: mean, Short: 'below',
      Ticks: [[0, '\u221260 s'], [0.5, '\u221230 s'], [1, 'now']],
      Marker: { X: 1, Y: TRACE[TRACE.length - 1] },
    });
  }

` +
      Source.slice(End);
    // Follow-up 67: one set of readings, inside the anemometer card: Mean, Gust, Lull, From, Force and Gust factor (the separate
    // Gusting to / Lulling to cards repeated Gust and are no longer shown).
    Replace(
      "const pSpd = pill('Mean'), pGust = pill('Gust'), pFrom = pill('From'), pBf = pill('Force');",
      "const pSpd = pill('Mean'), pGust = pill('Gust'), pLull = pill('Lull'), pFrom = pill('From'), pBf = pill('Force'), pFactor = pill('Gust factor');",
    );
    Replace("  host.appendChild(rail);\n", "");
    Replace("  host.appendChild(duo);\n", "");
    Replace("  mc.appendChild(chartWrap);\n", "  mc.appendChild(chartWrap);\n  rail.classList.add('wf-readings');\n  mc.appendChild(rail);\n");
    Replace(
      "    pBf.innerHTML = `${b.n}<em>bf</em>`;",
      "    pBf.innerHTML = `${b.n}<em>bf</em>`;\n    pLull.innerHTML = `${lo.toFixed(1)}<em>m/s</em>`;\n    pFactor.innerHTML = `${(hi / Math.max(SPD(), 0.1)).toFixed(2)}<em>\u00d7</em>`;\n    pGust.parentElement.classList.toggle('down', hi > 17);",
    );
  } else if (Name === "fog.js") {
    Replace(
      "const [g, w, h] = sizeCanvas(chamberCv, 74); g.clearRect(0, 0, w, h); g.fillStyle = '#191919'; g.fillRect(0, 0, w, h);",
      "const [g, w, h] = sizeCanvas(chamberCv, 74); g.clearRect(0, 0, w, h);",
    );
  }
  return Source;
}
