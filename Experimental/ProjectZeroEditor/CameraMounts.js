//============================================================================================================================================
//                                                              CAMERAMOUNTS.JS
//============================================================================================================================================
// 🎥 Follow-up 78: how a scene camera stands in the viewport. Two mounts: On tripod (a fixed camera; the tripod's legs extend or fold to
// the camera's height, its feet stay on the ground) or Floating (a moving camera held on a crane, rig, drone or by hand: no tripod,
// any height, with roll). Each camera stores on its row:
//   • Tripod (true / false) — the mount (the Overview's Tripod tile shares it);
//   • Camera Position [x, y, z] in metres — y is the camera's height; unset, the camera stands on its arc in front of the Showcase;
//   • Camera Angle [tilt, pan, roll] in degrees; Aim at Showcase (on by default) works tilt and pan out from where it stands.
// The viewport records each camera's pose as drawn (MountPoses), so the inspector shows the arc position and aimed angles until edited.

export const MountPoses = new Map();
export const TripodSpan = { Low: 0.4, High: 2.2 };
export const FloatSpan = { Low: 0.2, High: 8 };
export const DefaultHeight = (Body) => (Body === "mirrorless" ? 1.45 : 1.3);
const Triple = (Amount) => (Array.isArray(Amount) && Amount.length === 3 && Amount.every((Each) => Number.isFinite(+Each)) ? Amount.map(Number) : null);

// The mount a camera's values describe. Position and Angle are null when unset (the viewport then places and aims it).
export function MountOf(Own = {}) {
  const Tripod = Own.Tripod !== false;
  const Position = Triple(Own["Camera Position"]);
  const Angle = Triple(Own["Camera Angle"]);
  const Span = Tripod ? TripodSpan : FloatSpan;
  if (Position) Position[1] = Math.max(Span.Low, Math.min(Span.High, Position[1]));
  return { Tripod, Position, Angle, Aim: Own["Aim at Showcase"] !== false, Span };
}
