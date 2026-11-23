// Follow-up 67: one live trace for the editor's running graphs, the Diagnostics performance history and the Wind anemometer. Dashed
// grid lines with their numbers on the right, a dashed reference line (60 fps, 16.7 ms, the mean wind), a faint fill under the trace and
// the trace itself; wherever the trace crosses to the wrong side of the reference (below it, or above it for frame times) it turns red,
// with a red wash between it and the line.
export const TraceColours = {
  Grid: "rgba(255,255,255,0.08)",
  Label: "rgba(255,255,255,0.34)",
  Reference: "rgba(163,172,146,0.55)",
  Fill: "rgba(163,172,146,0.07)",
  Line: "#dbded6",
  Short: "#ff5a52",
  ShortFill: "rgba(255,90,82,0.16)",
  Marker: "#b8c9a8",
};

// Size a canvas to its box at the screen's pixel ratio and hand back a brush in CSS pixels.
export function TraceBrush(Canvas, Width, Height) {
  const Ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  if (Canvas.width !== Math.round(Width * Ratio) || Canvas.height !== Math.round(Height * Ratio)) {
    Canvas.width = Math.round(Width * Ratio);
    Canvas.height = Math.round(Height * Ratio);
  }
  const Brush = Canvas.getContext("2d");
  Brush.setTransform(Ratio, 0, 0, Ratio, 0, 0);
  Brush.clearRect(0, 0, Width, Height);
  return Brush;
}

// Points: [{ X: 0…1 across the window, Y: the reading }]. Plot: the drawing box inside the canvas, in pixels. Top: the reading at the
// top edge. Reference: the line (or null). Short: "below" or "above", the side of the line that is short of the reference. Ticks:
// [[0…1, label]] under the plot. Marker: a point to ring (the latest reading, or the one being inspected).
export function PaintTrace(Brush, { Width, Height, Points, Top, Plot = { Left: 2, Right: 30, Top: 8, Bottom: 15 }, Reference = null, Short = "below", Ticks = [], Marker = null, Decimals = null, Guide = null }) {
  const Left = Plot.Left, Right = Width - Plot.Right, Upper = Plot.Top, Lower = Height - Plot.Bottom;
  const X = (Across) => Left + Across * (Right - Left);
  const Y = (Reading) => Lower - (Math.max(0, Reading) / Top) * (Lower - Upper);
  const Places = Decimals ?? (Top > 12 ? 0 : 1);
  Brush.font = "9px ui-sans-serif, system-ui, sans-serif";
  Brush.lineWidth = 1;
  // The grid: nought, half and full scale.
  for (const Share of [0, 0.5, 1]) {
    Brush.strokeStyle = TraceColours.Grid;
    Brush.setLineDash([4, 7]);
    Brush.beginPath();
    Brush.moveTo(Left, Y(Top * Share));
    Brush.lineTo(Right, Y(Top * Share));
    Brush.stroke();
    Brush.setLineDash([]);
    Brush.fillStyle = TraceColours.Label;
    Brush.textAlign = "left";
    Brush.fillText((Top * Share).toFixed(Share ? Places : 0), Right + 6, Y(Top * Share) + 3);
  }
  // The reference line.
  if (Reference !== null) {
    Brush.strokeStyle = TraceColours.Reference;
    Brush.setLineDash([7, 8]);
    Brush.beginPath();
    Brush.moveTo(Left, Y(Reference));
    Brush.lineTo(Right, Y(Reference));
    Brush.stroke();
    Brush.setLineDash([]);
  }
  if (Points.length > 1) {
    const Trace = () => {
      Brush.beginPath();
      Points.forEach((Point, At) => (At ? Brush.lineTo(X(Point.X), Y(Point.Y)) : Brush.moveTo(X(Point.X), Y(Point.Y))));
    };
    // The fill under the trace.
    Trace();
    Brush.lineTo(X(Points.at(-1).X), Lower);
    Brush.lineTo(X(Points[0].X), Lower);
    Brush.closePath();
    Brush.fillStyle = TraceColours.Fill;
    Brush.fill();
    // The trace, light on the good side of the line and red on the short side.
    const Side = (Good) => {
      Brush.save();
      Brush.beginPath();
      if (Reference === null) Brush.rect(0, 0, Width, Height);
      else if ((Short === "below") === Good) Brush.rect(0, 0, Width, Y(Reference));
      else Brush.rect(0, Y(Reference), Width, Height - Y(Reference));
      Brush.clip();
      if (!Good) {
        // The red wash between the trace and the line.
        Trace();
        Brush.lineTo(X(Points.at(-1).X), Y(Reference));
        Brush.lineTo(X(Points[0].X), Y(Reference));
        Brush.closePath();
        Brush.fillStyle = TraceColours.ShortFill;
        Brush.fill();
      }
      Trace();
      Brush.strokeStyle = Good ? TraceColours.Line : TraceColours.Short;
      Brush.lineWidth = 1.4;
      Brush.lineJoin = "round";
      Brush.stroke();
      Brush.restore();
    };
    Side(true);
    if (Reference !== null) Side(false);
  }
  // The inspected moment's guide.
  if (Guide !== null) {
    Brush.strokeStyle = "rgba(183,200,169,0.3)";
    Brush.beginPath();
    Brush.moveTo(X(Guide), Upper);
    Brush.lineTo(X(Guide), Lower);
    Brush.stroke();
  }
  if (Marker) {
    const IsShort = Reference !== null && (Short === "below" ? Marker.Y < Reference : Marker.Y > Reference);
    Brush.fillStyle = IsShort ? TraceColours.Short : Guide !== null ? TraceColours.Marker : "#ffffff";
    Brush.beginPath();
    Brush.arc(X(Marker.X), Y(Marker.Y), Guide !== null ? 4 : 2.8, 0, Math.PI * 2);
    Brush.fill();
  }
  Brush.fillStyle = TraceColours.Label;
  Ticks.forEach(([Across, Label], At) => {
    Brush.textAlign = At === 0 ? "left" : At === Ticks.length - 1 ? "right" : "center";
    Brush.fillText(Label, X(Across), Height - 3);
  });
}
