//============================================================================================================================================
//                                                              CAMERAMOUNT.JSX
//============================================================================================================================================
// 🎥 Follow-up 78: the scene camera's Mount page. The Mount card shows the chosen mount large (a drawing of the camera at its height and
// angle) with the two to pick from: A On tripod (fixed; the tripod's legs follow the camera's height) or B Floating (a moving camera on a
// crane, rig, drone or by hand). Under it the height (Tripod height on a tripod) and, floating, the roll. The Position + angle card is
// the Geometry page's transform table: position (y is the height) and angle (tilt, pan, roll), with Aim at Showcase working tilt and pan
// out. Values live on the camera row (CameraMounts.js).

import React from "react";
import TransformPanel from "./TransformPanel.jsx";
import { MountOf, MountPoses, DefaultHeight } from "./CameraMounts.js";

const Mounts = [
  { Id: "tripod", Letter: "A", Name: "On tripod", Caption: "A fixed camera · the tripod's legs extend to the camera's height" },
  { Id: "floating", Letter: "B", Name: "Floating", Caption: "A moving camera · crane, rig, drone or handheld, at any height" },
];

// The camera drawn at its height and angle: on a tripod whose legs reach it, or floating over a ring on the ground with its path.
function MountPicture({ Floating, Height, Tilt = 0, Roll = 0, Small = false }) {
  const Ground = Small ? 46 : 150, Scale = Small ? 13 : Floating ? 15 : 46;
  const Y = Ground - Math.min(Small ? 34 : 128, Height * Scale), X = Small ? 36 : 150;
  const Body = (
    <g transform={`translate(${X} ${Y}) rotate(${Roll}) rotate(${-Tilt * 0.6})`}>
      <rect x={Small ? -7 : -20} y={Small ? -5 : -13} width={Small ? 14 : 40} height={Small ? 9 : 25} rx={Small ? 2 : 5} fill="#d9d4ca" />
      <rect x={Small ? 7 : 20} y={Small ? -3 : -8} width={Small ? 6 : 17} height={Small ? 5 : 15} rx="1.5" fill="#9b968d" />
      <circle cx={Small ? -2 : -6} cy={Small ? -7 : -19} r={Small ? 3 : 8} fill="none" stroke="#d9d4ca" strokeWidth={Small ? 1.4 : 3} />
      <circle cx={Small ? 4 : 9} cy={Small ? -7 : -19} r={Small ? 3 : 8} fill="none" stroke="#d9d4ca" strokeWidth={Small ? 1.4 : 3} />
    </g>
  );
  return (
    <svg className={"cm-picture" + (Small ? " small" : "")} viewBox={Small ? "0 0 72 52" : "0 0 300 170"} aria-hidden="true">
      <path d={`M${Small ? 4 : 14} ${Ground} H${Small ? 68 : 286}`} stroke="#ffffff26" />
      {Floating ? (
        <>
          <path d={`M${X} ${Y + (Small ? 6 : 16)} V${Ground}`} stroke="#9fd0ff" strokeDasharray={Small ? "2 2" : "4 4"} opacity="0.7" />
          <ellipse cx={X} cy={Ground} rx={Small ? 8 : 26} ry={Small ? 2 : 6} fill="none" stroke="#9fd0ff" opacity="0.7" />
          <path d={Small ? `M${X - 26} ${Y + 10} Q${X - 14} ${Y - 10} ${X - 8} ${Y}` : `M${X - 120} ${Y + 40} C${X - 90} ${Y - 30} ${X - 50} ${Y - 30} ${X - 30} ${Y}`} fill="none" stroke="#9fd0ff" strokeDasharray={Small ? "1.5 2.5" : "3 5"} opacity="0.55" />
        </>
      ) : (
        <g stroke="#a9a49b" strokeWidth={Small ? 1.3 : 3} strokeLinecap="round">
          <path d={`M${X} ${Y + (Small ? 5 : 14)} L${X - (Small ? 14 : 46)} ${Ground}`} />
          <path d={`M${X} ${Y + (Small ? 5 : 14)} L${X + (Small ? 14 : 46)} ${Ground}`} />
          <path d={`M${X} ${Y + (Small ? 5 : 14)} L${X + (Small ? 3 : 8)} ${Ground}`} opacity="0.6" />
        </g>
      )}
      {Body}
      {!Small && (
        <g className="cm-height">
          <path d={`M262 ${Y} V${Ground}`} stroke="#ffd38a" strokeWidth="1" />
          <path d={`M256 ${Y} H268 M256 ${Ground} H268`} stroke="#ffd38a" strokeWidth="1" />
          <text x="256" y={(Y + Ground) / 2 + 4} textAnchor="end">
            {Height.toFixed(2)} m
          </text>
        </g>
      )}
    </svg>
  );
}

export function CameraMountPage({ Subject, Values, Assign, Kit, Body }) {
  const { Card, Control, Metric } = Kit;
  const Mount = MountOf(Values);
  const Drawn = MountPoses.get(Subject.Id);
  const Position = Mount.Position || Drawn?.Position || [0, DefaultHeight(Body), 4];
  const Angle = Mount.Aim || !Mount.Angle ? Drawn?.Angle || [0, 0, Mount.Angle?.[2] || 0] : Mount.Angle;
  const Height = Position[1];
  const Floating = !Mount.Tripod;
  const Chosen = Mounts[Floating ? 1 : 0];
  const SetHeight = (Next) => Assign("Camera Position", [Position[0], +(+Next).toFixed(2), Position[2]]);
  const Choose = (Id) => {
    if ((Id === "floating") === Floating) return;
    Assign("Tripod", Id === "tripod");
    // A tripod reaches no higher than its span: a floating camera set down on one comes down to it.
    if (Id === "tripod" && Mount.Position && Height > 2.2) Assign("Camera Position", [Position[0], 2.2, Position[2]]);
  };
  // Typing an angle takes over from Aim at Showcase; roll keeps the aim.
  // The table's ↺ buttons pass null: back on the arc (position) or aimed again (angle).
  const Change = (Key, Next) => {
    if (Next === null) {
      Assign(Key, null);
      if (Key === "Camera Angle") Assign("Aim at Showcase", true);
      return;
    }
    if (Key === "Camera Angle" && (Next[0] !== Angle[0] || Next[1] !== Angle[1])) Assign("Aim at Showcase", false);
    if (Key === "Camera Position") Next = [Next[0], Math.max(Mount.Span.Low, Math.min(Mount.Span.High, Next[1])), Next[2]];
    Assign(Key, Next);
  };
  return (
    <>
      <Card Title="Mount" Class="camera-body-card cm-card">
        <div className="camera-body-hero cm-hero" data-camera-mount-shown={Chosen.Id}>
          <MountPicture Floating={Floating} Height={Height} Tilt={Angle[0]} Roll={Angle[2]} />
          <div>
            <b>
              {Chosen.Letter} · {Chosen.Name}
            </b>
            <small>{Chosen.Caption}</small>
          </div>
        </div>
        <div className="camera-body-choices cm-choices" role="radiogroup" aria-label="Camera mount">
          {Mounts.map((Each) => (
            <button key={Each.Id} type="button" role="radio" aria-checked={Each.Id === Chosen.Id} className={Each.Id === Chosen.Id ? "on" : ""} data-camera-mount={Each.Id} onClick={() => Choose(Each.Id)}>
              <MountPicture Floating={Each.Id === "floating"} Height={Each.Id === "floating" ? 2.4 : 1.4} Small />
              <span>
                <b>{Each.Letter}</b> {Each.Name}
              </span>
            </button>
          ))}
        </div>
        <Control
          Field={{ Label: Floating ? "Height" : "Tripod height", Minimum: Mount.Span.Low, Maximum: Mount.Span.High, Decimals: 2, Unit: "m", Default: DefaultHeight(Body) }}
          Value={Height}
          Change={SetHeight}
        />
        {Floating && (
          <Control Field={{ Label: "Roll", Minimum: -45, Maximum: 45, Decimals: 0, Unit: "°", Default: 0 }} Value={Angle[2]} Change={(Next) => Assign("Camera Angle", [Angle[0], Angle[1], Math.round(Next)])} />
        )}
        <p className="cm-note">
          {Floating
            ? "No tripod: the camera floats at its height, with a drop line to a ring on the ground under it, ready to move."
            : `The tripod follows the camera: its legs extend to ${Height.toFixed(2)} m and its feet stay on the ground (${Mount.Span.Low}–${Mount.Span.High} m).`}
        </p>
      </Card>
      <Card Title="Position + angle" Class="cm-place-card">
        <Metric Value={Height.toFixed(2)} Unit="m high" Caption={Mount.Position ? "Placed by hand" : "On its arc in front of the Showcase"} />
        <TransformPanel
          Compact
          Title="Camera"
          Space={Mount.Aim ? "AIMED AT SHOWCASE" : "WORLD SPACE"}
          Note=""
          Values={{ "Camera Position": Position, "Camera Angle": Angle }}
          Change={Change}
          Rows={[
            ["Camera Position", "m · y height", null, -200, 200, 0.05],
            ["Camera Angle", "° tilt pan roll", null, -360, 360, 0.5],
          ]}
        />
        <Control Field={{ Label: "Aim at Showcase", Control: "Switch" }} Value={Mount.Aim} Change={(Next) => Assign("Aim at Showcase", Next)} />
        <button
          type="button"
          className="cm-reset"
          disabled={!Mount.Position && !Mount.Angle && Mount.Aim}
          onClick={() => {
            Assign("Camera Position", null);
            Assign("Camera Angle", null);
            Assign("Aim at Showcase", true);
          }}
        >
          ↺ Back on its arc
        </button>
      </Card>
    </>
  );
}
