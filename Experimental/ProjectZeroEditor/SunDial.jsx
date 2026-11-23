// Follow-up 66: the Sun direction dial. A sky chart seen from above (zenith in the middle, the horizon ring, the ground band beyond it,
// north up and east right) with a polar grid: elevation rings every 15° and azimuth spokes every 15°. Drag anywhere on the chart and the
// sun follows the pointer (azimuth from the angle, elevation from the distance). Under it, a horizontal angle ruler for azimuth; beside
// it, a vertical one for elevation: tape rulers with a fixed needle, a tick every 5° and a labelled one every 15°, dragged like a tape.
import React, { useRef } from "react";

const Size = 300, Middle = Size / 2, Edge = 138, Horizon = 104; // chart radius, and the horizon ring's radius
const Clamp = (Number, Low, High) => Math.min(High, Math.max(Low, Number));
const Turn = (Degrees) => ((Degrees % 360) + 360) % 360;
const Radius = (Elevation) => (Elevation >= 0 ? (Horizon * (90 - Elevation)) / 90 : Horizon + ((Edge - Horizon) * -Elevation) / 90);
const ElevationAt = (Distance) =>
  Distance <= Horizon ? 90 - (Distance / Horizon) * 90 : -Clamp(((Distance - Horizon) / (Edge - Horizon)) * 90, 0, 90);
const Spot = (Azimuth, Elevation) => {
  const Angle = (Azimuth * Math.PI) / 180, Out = Radius(Elevation);
  return [Middle + Math.sin(Angle) * Out, Middle - Math.cos(Angle) * Out];
};
const Compass = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

// The tape ruler. Span is how many degrees the window shows; Wrap turns it around (azimuth), otherwise it stops at Low and High.
export function AngleRuler({ Label, Angle, Low, High, Wrap = false, Span = 90, Upright = false, Change, Readout }) {
  const Grip = useRef(null);
  const Length = () => (Upright ? Grip.current.Box.height : Grip.current.Box.width);
  const Settle = (Next) => (Wrap ? Turn(Next) : Clamp(Next, Low, High));
  const Down = (Event) => {
    Event.preventDefault();
    Event.currentTarget.setPointerCapture(Event.pointerId);
    Event.currentTarget.focus();
    Grip.current = { At: Upright ? Event.clientY : Event.clientX, From: Angle, Box: Event.currentTarget.getBoundingClientRect(), Moved: false };
  };
  const Move = (Event) => {
    if (!Grip.current) return;
    const Pixels = (Upright ? Event.clientY : Event.clientX) - Grip.current.At;
    if (Math.abs(Pixels) > 2) Grip.current.Moved = true;
    // Dragging the tape pulls it under the needle: left (or up) shows larger angles.
    const Next = Grip.current.From + (Upright ? Pixels : -Pixels) * (Span / Length());
    Change(Math.round(Settle(Next) * 2) / 2);
  };
  const Up = (Event) => {
    const Held = Grip.current;
    Grip.current = null;
    if (!Held || Held.Moved) return;
    // A click (no drag) jumps to that tick, snapped to 1°.
    const Offset = Upright ? Held.Box.top + Held.Box.height / 2 - Event.clientY : Event.clientX - (Held.Box.left + Held.Box.width / 2);
    Change(Math.round(Settle(Angle + (Offset / Length()) * Span)));
  };
  const Key = (Event) => {
    const Step = Event.shiftKey ? 15 : 1;
    const More = Upright ? ["ArrowUp", "PageUp"] : ["ArrowRight", "PageUp"];
    const Less = Upright ? ["ArrowDown", "PageDown"] : ["ArrowLeft", "PageDown"];
    if (More.includes(Event.key)) Change(Settle(Math.round(Angle) + Step));
    else if (Less.includes(Event.key)) Change(Settle(Math.round(Angle) - Step));
    else return;
    Event.preventDefault();
  };
  const Ticks = [];
  for (let Degree = Math.ceil((Angle - Span / 2) / 5) * 5; Degree <= Angle + Span / 2; Degree += 5) {
    if (!Wrap && (Degree < Low || Degree > High)) continue;
    const Place = 50 + ((Degree - Angle) / Span) * 100;
    const Major = Degree % 15 === 0;
    const Shown = Wrap ? Turn(Degree) : Degree;
    const Name = Wrap && Shown % 45 === 0 ? Compass[Shown / 45] : null;
    Ticks.push(
      <span
        key={Degree}
        className={"angle-tick" + (Major ? " major" : "") + (Name ? " named" : "") + (!Wrap && Degree === 0 ? " zero" : "")}
        style={Upright ? { top: 100 - Place + "%" } : { left: Place + "%" }}
      >
        {Major && <b>{Name ?? Shown + "°"}</b>}
      </span>,
    );
  }
  return (
    <div className={"angle-ruler" + (Upright ? " upright" : "")}>
      <div
        className="angle-tape"
        role="slider"
        tabIndex={0}
        aria-label={Label}
        aria-valuemin={Low}
        aria-valuemax={High}
        aria-valuenow={Math.round(Angle * 10) / 10}
        aria-orientation={Upright ? "vertical" : "horizontal"}
        data-angle-ruler={Label}
        onPointerDown={Down}
        onPointerMove={Move}
        onPointerUp={Up}
        onPointerCancel={() => (Grip.current = null)}
        onKeyDown={Key}
        title={`${Label}: drag the tape, click a tick, or use the arrow keys (Shift for 15° steps)`}
      >
        {!Wrap && <span className="angle-ground" style={Upright ? { top: Clamp(50 + (Angle / Span) * 100, 0, 100) + "%" } : {}} />}
        {Ticks}
        <i className="angle-needle" />
      </div>
      {Readout !== false && (
        <output className="angle-readout">
          <small>{Label}</small>
          {Readout ?? Angle.toFixed(1) + "°"}
        </output>
      )}
    </div>
  );
}

// The chart. Path is today's sun track (points of { Azimuth, Elevation, Hour }) when the direction is solved from the date and place.
export function SunDial({ Azimuth, Elevation, Path = [], Manual, Change }) {
  const Held = useRef(false);
  const Aim = (Event) => {
    const Box = Event.currentTarget.getBoundingClientRect();
    const X = ((Event.clientX - Box.left) / Box.width) * Size - Middle;
    const Y = ((Event.clientY - Box.top) / Box.height) * Size - Middle;
    const Next = Turn((Math.atan2(X, -Y) * 180) / Math.PI);
    Change(Math.round(Next * 2) / 2, Math.round(ElevationAt(Math.hypot(X, Y)) * 2) / 2);
  };
  const [SunX, SunY] = Spot(Azimuth, Elevation);
  const Night = Elevation < 0;
  const Track = Path.filter((Point) => Point.Elevation > -18)
    .map((Point, At) => {
      const [X, Y] = Spot(Point.Azimuth, Point.Elevation);
      return `${At ? "L" : "M"}${X.toFixed(1)},${Y.toFixed(1)}`;
    })
    .join(" ");
  const Rings = [15, 30, 45, 60, 75];
  const Spokes = Array.from({ length: 24 }, (_, At) => At * 15);
  return (
    <svg
      className={"sun-dial" + (Manual ? " manual" : "")}
      viewBox={`0 0 ${Size} ${Size}`}
      role="img"
      aria-label={`Sun direction: azimuth ${Azimuth.toFixed(1)} degrees, elevation ${Elevation.toFixed(1)} degrees`}
      data-sun-dial
      onPointerDown={(Event) => {
        Event.preventDefault();
        Event.currentTarget.setPointerCapture(Event.pointerId);
        Held.current = true;
        Aim(Event);
      }}
      onPointerMove={(Event) => Held.current && Aim(Event)}
      onPointerUp={() => (Held.current = false)}
      onPointerCancel={() => (Held.current = false)}
    >
      <defs>
        <radialGradient id="sun-dial-sky">
          <stop offset="0" stopColor="#2b3442" />
          <stop offset="1" stopColor="#1a1f27" />
        </radialGradient>
        <radialGradient id="sun-dial-glow">
          <stop offset="0" stopColor="#ffd77a" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffd77a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={Middle} cy={Middle} r={Edge} className="dial-ground" />
      <circle cx={Middle} cy={Middle} r={Horizon} fill="url(#sun-dial-sky)" />
      {Spokes.map((Degree) => {
        const [X, Y] = Spot(Degree, -90);
        return <line key={Degree} x1={Middle} y1={Middle} x2={X} y2={Y} className={"dial-spoke" + (Degree % 45 === 0 ? " main" : "")} />;
      })}
      {Rings.map((Ring) => (
        <circle key={Ring} cx={Middle} cy={Middle} r={Radius(Ring)} className={"dial-ring" + (Ring % 30 === 0 ? " main" : "")} />
      ))}
      <circle cx={Middle} cy={Middle} r={Radius(-45)} className="dial-ring under" />
      <circle cx={Middle} cy={Middle} r={Horizon} className="dial-horizon" />
      <circle cx={Middle} cy={Middle} r={Edge} className="dial-edge" />
      {[30, 60].map((Ring) => (
        <text key={Ring} x={Middle + 3} y={Middle - Radius(Ring) - 2} className="dial-ring-label">
          {Ring}°
        </text>
      ))}
      {Compass.filter((_, At) => At % 2 === 0).map((Name, At) => {
        const [X, Y] = Spot(At * 90, -50);
        return (
          <text key={Name} x={X} y={Y + 4} className={"dial-compass" + (Name === "N" ? " north" : "")}>
            {Name}
          </text>
        );
      })}
      {Track && <path d={Track} className="dial-track" />}
      {Path.filter((Point) => Point.Hour % 6 === 0 && Point.Elevation > -18).map((Point) => {
        const [X, Y] = Spot(Point.Azimuth, Point.Elevation);
        return (
          <g key={Point.Hour} className="dial-hour">
            <circle cx={X} cy={Y} r="2.2" />
            <text x={X + 5} y={Y - 4}>
              {String(Point.Hour).padStart(2, "0")}h
            </text>
          </g>
        );
      })}
      <line x1={Middle} y1={Middle} x2={SunX} y2={SunY} className="dial-ray" />
      {!Night && <circle cx={SunX} cy={SunY} r="22" fill="url(#sun-dial-glow)" />}
      <circle cx={SunX} cy={SunY} r="8.5" className={"dial-sun" + (Night ? " night" : "")} data-sun-spot={`${Azimuth.toFixed(1)},${Elevation.toFixed(1)}`} />
      <circle cx={Middle} cy={Middle} r="2.5" className="dial-zenith" />
    </svg>
  );
}

// The whole card body (Follow-up 67): the two angles on top as the card's readouts, the chart with the elevation ruler at its side, the
// azimuth ruler under them, and, when steered by hand, a way back to the solved direction.
export function SunDirection({ Azimuth, Elevation, Path, Manual, Clock = false, Change, Solve }) {
  const Facing = Compass[Math.round(Turn(Azimuth) / 45) % 8];
  return (
    <div className="sun-direction">
      <div className="sun-direction-readouts">
        <div>
          <small>Azimuth</small>
          <b>
            {Azimuth.toFixed(1)}
            <em>°</em>
          </b>
          <span>{Facing}</span>
        </div>
        <div>
          <small>Elevation</small>
          <b>
            {Elevation.toFixed(1)}
            <em>°</em>
          </b>
          <span>{Elevation < 0 ? "below horizon" : Elevation > 60 ? "high" : "above horizon"}</span>
        </div>
      </div>
      <div className="sun-direction-body">
        <div className="sun-direction-chart">
          <SunDial Azimuth={Azimuth} Elevation={Elevation} Path={Path} Manual={Manual} Change={Change} />
        </div>
        <AngleRuler Label="Elevation" Angle={Elevation} Low={-90} High={90} Span={90} Upright Readout={false} Change={(Next) => Change(Azimuth, Next)} />
      </div>
      <AngleRuler Label="Azimuth" Angle={Azimuth} Low={0} High={360} Wrap Span={90} Readout={false} Change={(Next) => Change(Next, Elevation)} />
      <div className="sun-direction-foot">
        <span className={"sun-direction-source" + (Manual ? " manual" : "")}>{Manual ? "Steered by hand" : Clock ? "Following this computer's clock" : "Solved from date, time and place"}</span>
        {Manual && Solve && (
          <button type="button" onClick={Solve}>
            Follow the clock
          </button>
        )}
      </div>
    </div>
  );
}
