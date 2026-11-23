// Follow-up 69: the wind at one point of the scene, for the viewport's anemometer. Every enabled Wind object contributes:
//  · its field (WindSpecification.js ResolveWind / EvaluateWind: the prevailing wind, the passing gust and any tornado or radial
//    parts placed in it) evaluated at the point itself, with the Wind inspector's speed, direction and gust as the prevailing wind;
//  · gusts that travel: the same gust signal as the inspector's trace, but carried downwind with the air, so two points along the
//    wind see the same gust at different times and points across it see different ones;
//  · height: a log-law profile, v(h) = v(10 m) · ln(h / z0) / ln(10 / z0), open terrain (z0 = 3 cm).
import { ResolveWind, EvaluateWind } from "./WindSpecification.js";

const Roughness = 0.03;
export const ReferenceHeight = 10;
export const Profile = (Height) => Math.log(Math.max(Height, Roughness * 1.5) / Roughness) / Math.log(ReferenceHeight / Roughness);

// The mean wind a Wind object sets, as its Wind inspector shows it (speed m/s, the bearing it comes FROM, gust 0–1, turbulence 0–1;
// unset, the inspector's own defaults, InspectorDepot/world.js).
export const WindDefaults = { speed: 4.2, direction: 214, gust: 0.3, turbulence: 0.24 };
export function MeanWind(Values = {}) {
  const Panel = { ...WindDefaults, ...(Values.ReferenceInspector?.Properties || {}) };
  const Read = (Key) => (Number.isFinite(Number(Panel[Key])) ? Number(Panel[Key]) : WindDefaults[Key]);
  return {
    Speed: Math.max(0, Read("speed")),
    From: ((Read("direction") % 360) + 360) % 360,
    Gust: Math.max(0, Read("gust")),
    Turbulence: Math.max(0, Read("turbulence")),
  };
}
// The inspector's gust signal (InspectorDepot/panels/wind.js gustAt), as a factor around 1.
const GustAt = (Phase, Gust, Turbulence) => {
  const Swell = Math.sin(Phase * 0.9) * 0.6 + Math.sin(Phase * 2.3 + 1.7) * 0.3 + Math.sin(Phase * 5.1) * 0.1;
  const Chop = (Math.sin(Phase * 17.3) + Math.sin(Phase * 29.7 + 2.1)) * 0.5;
  return 1 + Gust * (Swell * 0.55) + Turbulence * Chop * 0.18;
};

// The field a Wind object describes (WindSpecification.js), with the Wind inspector's speed, direction and gust written into its
// prevailing parts. The inspector gives the bearing the wind comes FROM; the field's parts carry the bearing the air flows TOWARD.
export function FieldOf(Values = {}) {
  const Mean = MeanWind(Values);
  return ResolveWind({ ...Values, Speed: Mean.Speed, Gust: Mean.Gust, Bearing: (Mean.From + 180) % 360 });
}

// The wind at (X, Z) metres, Height metres up, at Time seconds: the sum of every Wind object's field (EvaluateWind at that point),
// gusting with the inspector's gust signal carried downwind with the air, and scaled by height. Returns the velocity (VX, VZ m/s,
// x east, z south), its speed, the bearing it comes from, and the steady (gust-free) speed there.
export function SampleWind(Sources, X, Z, Height, Time) {
  let VX = 0, VZ = 0, SX = 0, SZ = 0;
  const Up = Profile(Height);
  for (const Values of Sources) {
    const Mean = MeanWind(Values);
    const Field = FieldOf(Values);
    const [FX, FZ] = EvaluateWind(Field, X, Z, Time);
    const Flow = Math.hypot(FX, FZ) || 1;
    // Gusts ride the wind: the phase a point sees lags by how far downwind it is, and drifts a little across the wind.
    const Downwind = (X * FX + Z * FZ) / Flow, Across = (X * -FZ + Z * FX) / Flow;
    const Rate = 0.4 + Mean.Turbulence * 2.2;
    const Phase = Time * Rate - (Downwind / Math.max(1, Flow)) * Rate + Math.sin(Across * 0.21) * 0.6;
    const Factor = Math.max(0, GustAt(Phase, Mean.Gust, Mean.Turbulence));
    // Turbulence also swings the direction a few degrees.
    const Swing = Mean.Turbulence * 0.26 * (Math.sin(Phase * 1.7 + 0.4) * 0.7 + Math.sin(Phase * 6.3) * 0.3);
    const C = Math.cos(Swing), S = Math.sin(Swing);
    VX += (FX * C - FZ * S) * Factor * Up;
    VZ += (FX * S + FZ * C) * Factor * Up;
    const [MX, MZ] = EvaluateWind({ ...Field, Components: Field.Components.filter((Part) => Part.Type !== "Gust") }, X, Z, Time);
    SX += MX * Up;
    SZ += MZ * Up;
  }
  const Speed = Math.hypot(VX, VZ);
  const From = Speed > 1e-4 ? ((Math.atan2(-VX, VZ) * 180) / Math.PI + 360) % 360 : 0;
  return { VX, VZ, Speed, From, Steady: Math.hypot(SX, SZ) };
}
export const Cardinal = (Bearing) =>
  ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(Bearing / 22.5) % 16];
export function Beaufort(Speed) {
  const Force = [0.5, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7].findIndex((Top) => Speed < Top);
  return Force < 0 ? 12 : Force;
}
