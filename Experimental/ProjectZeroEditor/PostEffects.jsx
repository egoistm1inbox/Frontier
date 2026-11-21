import React, { useEffect, useRef, useState } from "react";
import "./PostEffects.css";

// 🧩 Camera / post-process effect components: Motion Blur (under Cameras) and the Post Process sub-effects. Each has a
//    property sheet in the NativePanels format and a live preview: a small procedural scene (dusk sky, road, a car)
//    processed in the browser with the authored values, so every slider visibly changes the picture.
// 📝 Browser study only. Nothing here reaches the native renderer.

//------------------------------------------------------------------------------------------------------------------------
//                                                  SHEETS AND ROWS
//------------------------------------------------------------------------------------------------------------------------

const S = (Label, Minimum, Maximum, Default, Unit, Decimals, Group) => ({
  Label, Control: "Slider", Minimum, Maximum, Default, Unit, Decimals, Group,
});
const T = (Label, Default, Group) => ({ Label, Control: "Switch", Default, Group });
const C = (Label, Options, Default, Group) => ({ Label, Control: "Select", Options, Default, Group });

export const EffectSheets = {
  "motion-blur": [
    S("Shutter angle", 0, 360, 180, "°", 0, "Shutter"),
    C("Reference rate", ["24 fps", "30 fps", "60 fps", "120 fps"], 0, "Shutter"),
    T("Object motion", true, "Sources"),
    T("Camera motion", true, "Sources"),
    S("Max blur", 0, 15, 6, "% width", 1, "Quality"),
    S("Samples", 2, 32, 12, "", 0, "Quality"),
    S("Preview speed", 0, 2, 1, "×", 2, "Preview"),
  ],
  "heat-shimmer": [
    S("Strength", 0, 1, 0.45, "", 2, "Distortion"),
    S("Scale", 0.25, 4, 1, "×", 2, "Distortion"),
    S("Speed", 0, 4, 1, "×", 2, "Distortion"),
    S("Start distance", 0, 400, 40, "m", 0, "Range"),
    S("Height falloff", 0, 1, 0.55, "", 2, "Range"),
    T("Show mask", false, "Preview"),
  ],
  glitch: [
    S("Intensity", 0, 1, 0.45, "", 2, "Glitch"),
    S("Frequency", 0, 10, 3, "Hz", 1, "Glitch"),
    S("Block size", 2, 64, 14, "px", 0, "Glitch"),
    S("RGB split", 0, 24, 5, "px", 0, "Signal"),
    S("Scanline jitter", 0, 1, 0.3, "", 2, "Signal"),
    T("Colour drift", true, "Signal"),
  ],
  "chromatic-aberration": [
    S("Strength", 0, 12, 4, "px", 1, "Fringe"),
    S("Falloff", 0.5, 4, 2, "", 2, "Fringe"),
    C("Mode", ["Radial", "Lateral"], 0, "Fringe"),
  ],
  "film-grain": [
    S("Amount", 0, 1, 0.3, "", 2, "Grain"),
    S("Size", 1, 4, 1.4, "px", 1, "Grain"),
    S("Luminance response", 0, 1, 0.7, "", 2, "Grain"),
    T("Coloured", false, "Grain"),
    T("Animated", true, "Grain"),
  ],
  "lens-distortion": [
    S("Distortion", -1, 1, -0.15, "", 2, "Lens"),
    S("Scale", 0.5, 1.5, 1, "×", 2, "Lens"),
    S("Centre X", -0.5, 0.5, 0, "", 2, "Centre"),
    S("Centre Y", -0.5, 0.5, 0, "", 2, "Centre"),
  ],
  scanlines: [
    S("Line count", 32, 144, 90, "lines", 0, "Lines"),
    S("Intensity", 0, 1, 0.45, "", 2, "Lines"),
    S("Curvature", 0, 0.4, 0.12, "", 2, "Tube"),
    S("Flicker", 0, 1, 0.15, "", 2, "Tube"),
    T("Phosphor mask", true, "Tube"),
  ],
  sharpen: [
    S("Amount", 0, 3, 0.9, "×", 2, "Sharpen"),
    S("Radius", 1, 3, 1, "px", 0, "Sharpen"),
    S("Threshold", 0, 0.2, 0.02, "", 3, "Sharpen"),
  ],
};

export const EffectRows = [
  ["motion-blur", "Motion Blur", "Shutter-based blur · camera and object motion", "cameras"],
  ["heat-shimmer", "Heat Shimmer", "Rising-air refraction near hot ground", "post"],
  ["glitch", "Glitch", "Digital signal break-up · blocks and RGB split", "post"],
  ["chromatic-aberration", "Chromatic Aberration", "Colour fringing towards the frame edge", "post"],
  ["film-grain", "Film Grain", "Luminance-weighted photographic grain", "post"],
  ["lens-distortion", "Lens Distortion", "Barrel / pincushion warp", "post"],
  ["scanlines", "Scanlines", "CRT lines, tube curvature and phosphor mask", "post"],
  ["sharpen", "Sharpen", "Unsharp-mask edge contrast", "post"],
].map(([Id, Name, Description, Owner]) => ({ Id, Name, Panel: Id, Icon: "effect-" + Id, Parent: Owner, Description }));

export const IsEffectPanel = (Panel) => Object.hasOwn(EffectSheets, Panel);

const Fixed = (Amount, Digits = 2) => {
  const Text = (+Amount || 0).toFixed(Digits);
  return Text.includes(".") ? Text.replace(/\.?0+$/, "") : Text;
};

export function EffectSummary(Panel, V) {
  switch (Panel) {
    case "motion-blur": return Fixed(V("Shutter angle"), 0) + "° shutter · " + Fixed(V("Samples"), 0) + " samples";
    case "heat-shimmer": return Fixed(V("Strength")) + " · from " + Fixed(V("Start distance"), 0) + " m";
    case "glitch": return Fixed(V("Intensity")) + " · " + Fixed(V("Frequency"), 1) + " Hz";
    case "chromatic-aberration": return Fixed(V("Strength"), 1) + " px fringe";
    case "film-grain": return Math.round(V("Amount") * 100) + "% · " + Fixed(V("Size"), 1) + " px";
    case "lens-distortion": {
      const K = +V("Distortion");
      return (Math.abs(K) < 0.005 ? "None" : K < 0 ? "Barrel " : "Pincushion ") + (Math.abs(K) < 0.005 ? "" : Fixed(Math.abs(K)));
    }
    case "scanlines": return Fixed(V("Line count"), 0) + " lines · " + Math.round(V("Intensity") * 100) + "%";
    case "sharpen": return Fixed(V("Amount")) + "× · " + Fixed(V("Radius"), 0) + " px";
    default: return "";
  }
}

// Scene migration: Lens Flare moves from Sun to Cameras; Motion Blur joins Cameras; the effects join Post Process.
// Runs once per saved scene (CameraEffectsRevision), so later deletions are respected.
export function ArrangeCameraEffects(Rows = [], Revision) {
  if (Revision === 1 || !Array.isArray(Rows)) return Rows;
  let Result = Rows.filter((Row) => Row && Row.Id !== "flare");
  const Flare = Rows.find((Row) => Row?.Id === "flare");
  const HasCameras = Result.some((Row) => Row.Id === "cameras");
  const Insert = (Row) => {
    const Post = Result.findIndex((Each) => Each.Id === "post");
    if (Row.Parent === "cameras") {
      const At = Post >= 0 ? Post : Result.length;
      Result.splice(At, 0, Row);
      return;
    }
    let At = Post;
    for (let Index = 0; Index < Result.length; Index++) if (Result[Index].Parent === "post") At = Index;
    Result.splice(At < 0 ? Result.length : At + 1, 0, Row);
  };
  if (Flare)
    Insert(
      Flare.Parent === "sun" && HasCameras
        ? { ...Flare, Parent: "cameras", Description: "Camera optical effect · sun-driven" }
        : Flare,
    );
  const Present = new Set(Result.map((Row) => Row.Id));
  for (const Row of EffectRows)
    if (!Present.has(Row.Id) && (Row.Parent !== "post" || Present.has("post"))) Insert({ ...Row });
  return Result;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SCENE PAINT
//------------------------------------------------------------------------------------------------------------------------

const Width = 512, Height = 288, SkyLine = Math.round(Height * 0.54);

// PCG-style integer hash → [0, 1).
function Random(A, B = 0, C = 0) {
  let N = (Math.imul(A | 0, 73856093) ^ Math.imul(B | 0, 19349663) ^ Math.imul(C | 0, 83492791)) >>> 0;
  N = (Math.imul(N, 747796405) + 2891336453) >>> 0;
  const W = Math.imul((N >>> ((N >>> 28) + 4)) ^ N, 277803737) >>> 0;
  return (((W >>> 22) ^ W) >>> 0) / 4294967296;
}

function Ridge(X, Seed, Amplitude, Floor) {
  return Floor - Amplitude * (0.55 * Math.sin(X * 0.011 + Seed) + 0.3 * Math.sin(X * 0.027 + Seed * 2.1) + 0.15 * Math.sin(X * 0.063 + Seed * 3.7));
}

// Pose: Pan (camera px), Travel (road px), Car (centre x), Spin (wheel radians).
export function PaintScene(Context, Pose, Chart = false) {
  const Sky = Context.createLinearGradient(0, 0, 0, SkyLine);
  Sky.addColorStop(0, "#1b2747");
  Sky.addColorStop(0.55, "#5b4f7a");
  Sky.addColorStop(1, "#f0a46a");
  Context.fillStyle = Sky;
  Context.fillRect(0, 0, Width, SkyLine);
  const SunX = Width * 0.7 - Pose.Pan * 0.05, SunY = SkyLine - 44;
  const Glow = Context.createRadialGradient(SunX, SunY, 2, SunX, SunY, 70);
  Glow.addColorStop(0, "#fff4d6");
  Glow.addColorStop(0.18, "#ffe1a6");
  Glow.addColorStop(1, "#ffb36a00");
  Context.fillStyle = Glow;
  Context.fillRect(SunX - 70, SunY - 70, 140, 140);
  Context.fillStyle = "#fff6e2";
  Context.beginPath();
  Context.arc(SunX, SunY, 13, 0, Math.PI * 2);
  Context.fill();
  for (const [Seed, Amplitude, Floor, Colour, Parallax] of [
    [1.3, 26, SkyLine - 18, "#55456b", 0.25],
    [4.1, 18, SkyLine - 4, "#2f2a44", 0.55],
  ]) {
    Context.fillStyle = Colour;
    Context.beginPath();
    Context.moveTo(0, SkyLine + 1);
    for (let X = 0; X <= Width; X += 6) Context.lineTo(X, Ridge(X + Pose.Pan * Parallax, Seed, Amplitude, Floor));
    Context.lineTo(Width, SkyLine + 1);
    Context.fill();
  }
  const Ground = Context.createLinearGradient(0, SkyLine, 0, Height);
  Ground.addColorStop(0, "#3a3036");
  Ground.addColorStop(1, "#161417");
  Context.fillStyle = Ground;
  Context.fillRect(0, SkyLine, Width, Height - SkyLine);
  // Road towards a vanishing point.
  const Vanish = Width * 0.5 - Pose.Pan * 0.02;
  Context.fillStyle = "#2a2a2f";
  Context.beginPath();
  Context.moveTo(Vanish - 3, SkyLine);
  Context.lineTo(Vanish + 3, SkyLine);
  Context.lineTo(Width * 1.02, Height);
  Context.lineTo(-Width * 0.02, Height);
  Context.fill();
  Context.strokeStyle = "#d9d3c4";
  Context.lineWidth = 1.4;
  Context.beginPath();
  Context.moveTo(Vanish - 3, SkyLine);
  Context.lineTo(-Width * 0.02, Height);
  Context.moveTo(Vanish + 3, SkyLine);
  Context.lineTo(Width * 1.02, Height);
  Context.stroke();
  // Centre dashes: equal spacing in depth (1 / z), moving with Travel.
  Context.fillStyle = "#f3d27a";
  for (let Index = 0; Index < 16; Index++) {
    const Depth = 1 + ((Index * 4 - (Pose.Travel % 4) + 64) % 64);
    const Near = Depth - 1.6;
    if (Near <= 0.6) continue;
    const Y0 = SkyLine + (Height - SkyLine) * (1.6 / Depth), Y1 = SkyLine + (Height - SkyLine) * (1.6 / Near);
    const W0 = 3 * (1.6 / Depth), W1 = 3 * (1.6 / Near);
    Context.beginPath();
    Context.moveTo(Vanish - W0, Y0);
    Context.lineTo(Vanish + W0, Y0);
    Context.lineTo(Vanish + W1, Math.min(Height, Y1));
    Context.lineTo(Vanish - W1, Math.min(Height, Y1));
    Context.fill();
  }
  // Roadside poles.
  Context.strokeStyle = "#191519";
  for (let Index = 0; Index < 7; Index++) {
    const Depth = 1 + ((Index * 6 - (Pose.Travel % 6) + 42) % 42);
    const Scale = 1.6 / Depth;
    const Y = SkyLine + (Height - SkyLine) * Scale;
    const X = Vanish + (Width * 0.62) * Scale * 1.6;
    Context.lineWidth = Math.max(1, 5 * Scale);
    Context.beginPath();
    Context.moveTo(X, Y);
    Context.lineTo(X, Y - 150 * Scale);
    Context.stroke();
  }
  // Car with spoked wheels.
  const CarY = Height - 52, CarW = 118, Left = Pose.Car - CarW / 2;
  Context.fillStyle = "#00000055";
  Context.beginPath();
  Context.ellipse(Pose.Car, CarY + 28, CarW * 0.55, 6, 0, 0, Math.PI * 2);
  Context.fill();
  const Body = Context.createLinearGradient(0, CarY - 22, 0, CarY + 20);
  Body.addColorStop(0, "#ff6b55");
  Body.addColorStop(1, "#b52a22");
  Context.fillStyle = Body;
  Context.beginPath();
  Context.moveTo(Left + 4, CarY + 16);
  Context.lineTo(Left + 2, CarY + 2);
  Context.quadraticCurveTo(Left + 8, CarY - 6, Left + 28, CarY - 8);
  Context.lineTo(Left + 42, CarY - 24);
  Context.lineTo(Left + 82, CarY - 24);
  Context.lineTo(Left + 100, CarY - 8);
  Context.quadraticCurveTo(Left + CarW, CarY - 6, Left + CarW - 2, CarY + 4);
  Context.lineTo(Left + CarW - 4, CarY + 16);
  Context.closePath();
  Context.fill();
  Context.fillStyle = "#cfe6ff";
  Context.beginPath();
  Context.moveTo(Left + 46, CarY - 20);
  Context.lineTo(Left + 60, CarY - 20);
  Context.lineTo(Left + 60, CarY - 9);
  Context.lineTo(Left + 35, CarY - 9);
  Context.closePath();
  Context.moveTo(Left + 64, CarY - 20);
  Context.lineTo(Left + 80, CarY - 20);
  Context.lineTo(Left + 93, CarY - 9);
  Context.lineTo(Left + 64, CarY - 9);
  Context.closePath();
  Context.fill();
  Context.fillStyle = "#fff3c4";
  Context.fillRect(Left + CarW - 8, CarY - 2, 5, 4);
  for (const WheelX of [Left + 28, Left + CarW - 28]) {
    Context.fillStyle = "#121212";
    Context.beginPath();
    Context.arc(WheelX, CarY + 16, 13, 0, Math.PI * 2);
    Context.fill();
    Context.fillStyle = "#bfc4c9";
    Context.beginPath();
    Context.arc(WheelX, CarY + 16, 8, 0, Math.PI * 2);
    Context.fill();
    Context.strokeStyle = "#3a3d42";
    Context.lineWidth = 2;
    Context.beginPath();
    for (let Spoke = 0; Spoke < 5; Spoke++) {
      const A = Pose.Spin + (Spoke * Math.PI * 2) / 5;
      Context.moveTo(WheelX, CarY + 16);
      Context.lineTo(WheelX + Math.cos(A) * 8, CarY + 16 + Math.sin(A) * 8);
    }
    Context.stroke();
  }
  if (Chart) {
    Context.strokeStyle = "#ffffff70";
    Context.lineWidth = 1;
    Context.beginPath();
    for (let X = 0; X <= Width; X += Width / 16) {
      Context.moveTo(Math.round(X) + 0.5, 0);
      Context.lineTo(Math.round(X) + 0.5, Height);
    }
    for (let Y = 0; Y <= Height; Y += Height / 9) {
      Context.moveTo(0, Math.round(Y) + 0.5);
      Context.lineTo(Width, Math.round(Y) + 0.5);
    }
    Context.stroke();
  }
}

const CarSpeed = Width * 1.4, PanSpeed = Width * 0.22, RoadSpeed = 10;
function PoseAt(Time, Speed) {
  const Distance = Time * Speed;
  const Span = Width + 260;
  return {
    Pan: Distance * PanSpeed,
    Travel: Distance * RoadSpeed,
    Car: (((Distance * CarSpeed) % Span) + Span) % Span - 130,
    Spin: (Distance * CarSpeed) / 13,
  };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    PROCESSORS
//------------------------------------------------------------------------------------------------------------------------

function Bilinear(Source, X, Y, Channel) {
  if (X < 0) X = 0; else if (X > Width - 1.001) X = Width - 1.001;
  if (Y < 0) Y = 0; else if (Y > Height - 1.001) Y = Height - 1.001;
  const X0 = X | 0, Y0 = Y | 0, Fx = X - X0, Fy = Y - Y0;
  const I = (Y0 * Width + X0) * 4 + Channel;
  const A = Source[I], B = Source[I + 4], Cc = Source[I + Width * 4], D = Source[I + Width * 4 + 4];
  return (A + (B - A) * Fx) * (1 - Fy) + (Cc + (D - Cc) * Fx) * Fy;
}

const Smooth = (A, B, X) => {
  const T = Math.min(1, Math.max(0, (X - A) / (B - A)));
  return T * T * (3 - 2 * T);
};

// Metres to the ground row at screen y (camera 1.6 m above a flat road).
const GroundDistance = (Y) => (Y <= SkyLine ? Infinity : (1.6 * (Height - SkyLine) * 3.2) / (Y - SkyLine));
const GroundRow = (Metres) => SkyLine + (1.6 * (Height - SkyLine) * 3.2) / Math.max(0.01, Metres);

const Treatments = {
  "heat-shimmer"(Source, Target, P, Time) {
    const Strength = P("Strength"), Scale = P("Scale"), Speed = P("Speed"), Start = P("Start distance");
    const Falloff = P("Height falloff"), Mask = P("Show mask");
    const Rise = Height * 0.35 * (1 - Falloff) + 4;
    const Far = Smooth(Start, Start * 1.6 + 25, 400);
    for (let Y = 0; Y < Height; Y++) {
      const Weight = Y > SkyLine ? Smooth(Start, Start * 1.6 + 25, GroundDistance(Y)) : Far * Math.exp(-(SkyLine - Y) / Rise);
      const Amplitude = Strength * 7 * Weight;
      for (let X = 0; X < Width; X++) {
        const O = (Y * Width + X) * 4;
        if (Amplitude < 0.02) {
          Target[O] = Source[O]; Target[O + 1] = Source[O + 1]; Target[O + 2] = Source[O + 2]; Target[O + 3] = 255;
        } else {
          const Wave = Math.sin(Y * 0.42 / Scale + Time * 7 * Speed + Math.sin(X * 0.045 / Scale + Time * 2.3 * Speed) * 1.7);
          const Dx = Amplitude * Wave, Dy = Amplitude * 0.45 * Math.sin(X * 0.09 / Scale - Time * 5.5 * Speed);
          for (let Channel = 0; Channel < 3; Channel++) Target[O + Channel] = Bilinear(Source, X + Dx, Y + Dy, Channel);
          Target[O + 3] = 255;
        }
        if (Mask) {
          Target[O] = Target[O] * (1 - Weight * 0.55) + 255 * Weight * 0.55;
          Target[O + 1] = Target[O + 1] * (1 - Weight * 0.55) + 120 * Weight * 0.55;
          Target[O + 2] = Target[O + 2] * (1 - Weight * 0.55) + 40 * Weight * 0.55;
        }
      }
    }
  },
  glitch(Source, Target, P, Time) {
    const Intensity = P("Intensity"), Frequency = P("Frequency"), Block = Math.max(2, Math.round(P("Block size")));
    const Split = P("RGB split"), Jitter = P("Scanline jitter"), Drift = P("Colour drift");
    const Tick = Math.floor(Time * 12);
    const Burst = Intensity > 0 && Random(Tick, 7) < Math.min(1, Frequency / 12) * 1.6;
    const Gain = Burst ? 1 : 0.25;
    const Rows = Math.ceil(Height / Block);
    const Shift = new Float32Array(Rows), Swap = new Uint8Array(Rows);
    if (Burst)
      for (let Row = 0; Row < Rows; Row++) {
        const R = Random(Tick, Row, 3);
        if (R < Intensity * 0.55) Shift[Row] = (Random(Tick, Row, 5) - 0.5) * 2 * Intensity * Width * 0.18;
        if (Drift && R < Intensity * 0.12) Swap[Row] = 1;
      }
    const Offset = Split * Gain;
    for (let Y = 0; Y < Height; Y++) {
      const Row = (Y / Block) | 0;
      const Line = Shift[Row] + (Burst ? (Random(Tick, Y, 11) - 0.5) * Jitter * 10 : 0);
      const Noise = Burst && Random(Tick, Y, 13) < Intensity * 0.015;
      for (let X = 0; X < Width; X++) {
        const O = (Y * Width + X) * 4;
        if (Noise) {
          const N = Random(Tick, X, Y) * 255;
          Target[O] = Target[O + 1] = Target[O + 2] = N; Target[O + 3] = 255;
          continue;
        }
        const Sx = X + Line;
        const Wrap = (V) => ((Math.round(V) % Width) + Width) % Width;
        const RowStart = Y * Width * 4;
        let R = Source[RowStart + Wrap(Sx + Offset) * 4], G = Source[RowStart + Wrap(Sx) * 4 + 1], B = Source[RowStart + Wrap(Sx - Offset) * 4 + 2];
        if (Swap[Row]) [R, G, B] = [B, R, G];
        Target[O] = R; Target[O + 1] = G; Target[O + 2] = B; Target[O + 3] = 255;
      }
    }
  },
  "chromatic-aberration"(Source, Target, P) {
    const Strength = P("Strength"), Falloff = P("Falloff"), Lateral = P("Mode") === 1;
    const Cx = Width / 2, Cy = Height / 2, Reach = Math.hypot(Cx, Cy);
    for (let Y = 0; Y < Height; Y++)
      for (let X = 0; X < Width; X++) {
        const O = (Y * Width + X) * 4, Dx = X - Cx, Dy = Y - Cy, R = Math.hypot(Dx, Dy) / Reach;
        const K = Strength * Math.pow(R, Falloff);
        let Ux, Uy;
        if (Lateral) { Ux = Math.sign(Dx) || 0; Uy = 0; } else { Ux = R > 0 ? Dx / (R * Reach) : 0; Uy = R > 0 ? Dy / (R * Reach) : 0; }
        Target[O] = Bilinear(Source, X + Ux * K, Y + Uy * K, 0);
        Target[O + 1] = Source[O + 1];
        Target[O + 2] = Bilinear(Source, X - Ux * K, Y - Uy * K, 2);
        Target[O + 3] = 255;
      }
  },
  "film-grain"(Source, Target, P, Time) {
    const Amount = P("Amount"), Size = P("Size"), Response = P("Luminance response"), Coloured = P("Coloured");
    const Tick = P("Animated") ? Math.floor(Time * 24) : 0;
    for (let Y = 0; Y < Height; Y++)
      for (let X = 0; X < Width; X++) {
        const O = (Y * Width + X) * 4, Gx = Math.floor(X / Size), Gy = Math.floor(Y / Size);
        const L = (0.2126 * Source[O] + 0.7152 * Source[O + 1] + 0.0722 * Source[O + 2]) / 255;
        const Weight = (1 - Response) + Response * 4 * L * (1 - L) * 1.15;
        const Amplitude = Amount * Weight * 110;
        const N = Random(Gx, Gy, Tick) + Random(Gx, Gy, Tick + 9973) - 1;
        for (let Channel = 0; Channel < 3; Channel++) {
          const Jitter = Coloured ? Random(Gx, Gy, Tick * 3 + Channel + 17) + Random(Gy, Gx, Tick * 5 + Channel) - 1 : N;
          Target[O + Channel] = Source[O + Channel] + Jitter * Amplitude;
        }
        Target[O + 3] = 255;
      }
  },
  "lens-distortion"(Source, Target, P) {
    const K = P("Distortion"), Zoom = P("Scale");
    const Cx = Width * (0.5 + P("Centre X") * 0.5), Cy = Height * (0.5 + P("Centre Y") * 0.5);
    const Reach = Math.hypot(Width / 2, Height / 2);
    for (let Y = 0; Y < Height; Y++)
      for (let X = 0; X < Width; X++) {
        const O = (Y * Width + X) * 4, Dx = (X - Cx) / Reach, Dy = (Y - Cy) / Reach, R2 = Dx * Dx + Dy * Dy;
        const F = (1 + K * R2 + K * 0.35 * R2 * R2) / Zoom;
        const Sx = Cx + Dx * F * Reach, Sy = Cy + Dy * F * Reach;
        if (Sx < 0 || Sy < 0 || Sx > Width - 1 || Sy > Height - 1) {
          Target[O] = Target[O + 1] = Target[O + 2] = 10; Target[O + 3] = 255;
          continue;
        }
        for (let Channel = 0; Channel < 3; Channel++) Target[O + Channel] = Bilinear(Source, Sx, Sy, Channel);
        Target[O + 3] = 255;
      }
  },
  scanlines(Source, Target, P, Time) {
    const Lines = P("Line count"), Intensity = P("Intensity"), Curve = P("Curvature"), Flicker = P("Flicker"), Mask = P("Phosphor mask");
    const Pulse = 1 - Flicker * 0.18 * (0.5 + 0.5 * Math.sin(Time * 38)) - Flicker * 0.08 * Random(Math.floor(Time * 30), 1);
    for (let Y = 0; Y < Height; Y++)
      for (let X = 0; X < Width; X++) {
        const O = (Y * Width + X) * 4;
        const U = (X / Width) * 2 - 1, V = (Y / Height) * 2 - 1;
        const Uc = U * (1 + Curve * V * V), Vc = V * (1 + Curve * U * U);
        if (Math.abs(Uc) > 1 || Math.abs(Vc) > 1) {
          Target[O] = Target[O + 1] = Target[O + 2] = 6; Target[O + 3] = 255;
          continue;
        }
        const Sx = ((Uc + 1) / 2) * (Width - 1), Sy = ((Vc + 1) / 2) * (Height - 1);
        const Phase = ((Vc + 1) / 2) * Lines;
        const Dark = 1 - Intensity * (0.5 - 0.5 * Math.cos(Phase * Math.PI * 2));
        const Edge = Smooth(1, 0.82, Math.max(Math.abs(Uc), Math.abs(Vc)));
        const Gain = Dark * Pulse * (0.35 + 0.65 * Edge) * (1 + Intensity * 0.25);
        const Column = X % 3;
        for (let Channel = 0; Channel < 3; Channel++) {
          const Phosphor = Mask ? (Column === Channel ? 1.12 : 0.78) : 1;
          Target[O + Channel] = Bilinear(Source, Sx, Sy, Channel) * Gain * Phosphor;
        }
        Target[O + 3] = 255;
      }
  },
  sharpen(Source, Target, P) {
    const Amount = P("Amount"), Radius = Math.round(P("Radius")), Threshold = P("Threshold") * 255;
    const Temp = new Float32Array(Width * Height * 3), Blur = new Float32Array(Width * Height * 3);
    const Span = Radius * 2 + 1;
    for (let Y = 0; Y < Height; Y++)
      for (let X = 0; X < Width; X++)
        for (let Channel = 0; Channel < 3; Channel++) {
          let Sum = 0;
          for (let K = -Radius; K <= Radius; K++) Sum += Source[(Y * Width + Math.min(Width - 1, Math.max(0, X + K))) * 4 + Channel];
          Temp[(Y * Width + X) * 3 + Channel] = Sum / Span;
        }
    for (let Y = 0; Y < Height; Y++)
      for (let X = 0; X < Width; X++)
        for (let Channel = 0; Channel < 3; Channel++) {
          let Sum = 0;
          for (let K = -Radius; K <= Radius; K++) Sum += Temp[(Math.min(Height - 1, Math.max(0, Y + K)) * Width + X) * 3 + Channel];
          Blur[(Y * Width + X) * 3 + Channel] = Sum / Span;
        }
    for (let I = 0, J = 0; I < Width * Height * 4; I += 4, J += 3) {
      for (let Channel = 0; Channel < 3; Channel++) {
        const Detail = Source[I + Channel] - Blur[J + Channel];
        Target[I + Channel] = Math.abs(Detail) > Threshold ? Source[I + Channel] + Detail * Amount : Source[I + Channel];
      }
      Target[I + 3] = 255;
    }
  },
};

const ChartPanels = new Set(["chromatic-aberration", "lens-distortion"]);
const Rates = [24, 30, 60, 120];

export function MotionBlurSpan(P) {
  const Rate = Rates[P("Reference rate")] || 24;
  const Exposure = (P("Shutter angle") / 360) / Rate;
  const Speed = P("Preview speed");
  const Travel = CarSpeed * Speed * Exposure;
  const Limit = (P("Max blur") / 100) * Width;
  const Span = Travel > Limit && Travel > 0 ? Exposure * (Limit / Travel) : Exposure;
  return { Rate, Exposure, Span, Blur: Math.min(Travel, Limit), Clamped: Travel > Limit + 0.01 };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      PREVIEW
//------------------------------------------------------------------------------------------------------------------------

function Readouts(Panel, P) {
  const Percent = (Amount) => Math.round(Amount * 100) + "%";
  switch (Panel) {
    case "motion-blur": {
      const Span = MotionBlurSpan(P);
      return [
        ["Exposure", Span.Exposure > 0 ? "1/" + Math.round(1 / Span.Exposure) + " s" : "Closed"],
        ["Car streak", Span.Blur.toFixed(0) + " px" + (Span.Clamped ? " · capped" : "")],
        ["Samples", Fixed(P("Samples"), 0)],
      ];
    }
    case "heat-shimmer":
      return [["Starts at", Fixed(P("Start distance"), 0) + " m"], ["Peak shift", (P("Strength") * 7).toFixed(1) + " px"], ["Rise", Percent(1 - P("Height falloff"))]];
    case "glitch":
      return [["Bursts", Fixed(P("Frequency"), 1) + " Hz"], ["RGB split", Fixed(P("RGB split"), 0) + " px"], ["Blocks", Fixed(P("Block size"), 0) + " px"]];
    case "chromatic-aberration":
      return [["Edge fringe", Fixed(P("Strength"), 1) + " px"], ["Centre", "0 px"], ["Mode", ["Radial", "Lateral"][P("Mode")] || "Radial"]];
    case "film-grain":
    {
      const R = P("Luminance response"), Weight = (L) => 1 - R + R * 4 * L * (1 - L) * 1.15;
      return [["Amount", Percent(P("Amount"))], ["Grain size", Fixed(P("Size"), 1) + " px"], ["Shadows vs mids", Percent(Weight(0.08) / Weight(0.5))]];
    }
    case "lens-distortion": {
      const K = P("Distortion");
      const Edge = (1 + K + K * 0.35) / P("Scale") - 1;
      return [["Type", Math.abs(K) < 0.005 ? "None" : K < 0 ? "Barrel" : "Pincushion"], ["Corner shift", (Edge * 100).toFixed(0) + "%"], ["Scale", Fixed(P("Scale")) + "×"]];
    }
    case "scanlines":
      return [["Lines", Fixed(P("Line count"), 0)], ["Darkening", Percent(P("Intensity"))], ["Curvature", Fixed(P("Curvature"))]];
    case "sharpen":
      return [["Amount", Fixed(P("Amount")) + "×"], ["Radius", Fixed(P("Radius"), 0) + " px"], ["Threshold", Math.round(P("Threshold") * 255) + " / 255"]];
    default:
      return [];
  }
}

function DrawOverlays(Context, Panel, P, Split, Mode, Active) {
  Context.save();
  Context.font = "500 10px 'DM Sans', sans-serif";
  Context.textBaseline = "middle";
  if (Panel === "motion-blur") {
    const Angle = (P("Shutter angle") / 360) * Math.PI * 2, X = Width - 34, Y = 34;
    Context.fillStyle = "#000000a0";
    Context.beginPath();
    Context.arc(X, Y, 24, 0, Math.PI * 2);
    Context.fill();
    Context.fillStyle = "#3a3a3a";
    Context.beginPath();
    Context.arc(X, Y, 19, 0, Math.PI * 2);
    Context.fill();
    if (Angle > 0) {
      Context.fillStyle = "#f5c46a";
      Context.beginPath();
      Context.moveTo(X, Y);
      Context.arc(X, Y, 19, -Math.PI / 2, -Math.PI / 2 + Angle);
      Context.closePath();
      Context.fill();
    }
    Context.fillStyle = "#fff";
    Context.textAlign = "center";
    Context.fillText(Math.round(P("Shutter angle")) + "°", X, Y + 33);
  }
  if (Panel === "heat-shimmer") {
    const Y = GroundRow(Math.max(1, P("Start distance")));
    if (Y < Height - 2) {
      Context.strokeStyle = "#ffb36acc";
      Context.setLineDash([4, 4]);
      Context.beginPath();
      Context.moveTo(0, Y + 0.5);
      Context.lineTo(Width, Y + 0.5);
      Context.stroke();
      Context.setLineDash([]);
      Context.fillStyle = "#ffb36a";
      Context.textAlign = "left";
      Context.fillText("shimmer starts · " + Fixed(P("Start distance"), 0) + " m", 8, Y - 8);
    }
  }
  if (Panel === "film-grain") {
    const X = Width - 96, Y = Height - 56, W = 86, H = 44, R = P("Luminance response");
    Context.fillStyle = "#000000b0";
    Context.fillRect(X - 6, Y - 14, W + 12, H + 22);
    Context.strokeStyle = "#ffffff30";
    Context.strokeRect(X, Y, W, H);
    Context.strokeStyle = "#f2f2f2";
    Context.beginPath();
    for (let I = 0; I <= 40; I++) {
      const L = I / 40, Weight = (1 - R) + R * 4 * L * (1 - L) * 1.15;
      Context[I ? "lineTo" : "moveTo"](X + L * W, Y + H - Math.min(1.15, Weight) / 1.15 * H);
    }
    Context.stroke();
    Context.fillStyle = "#cfcfcf";
    Context.textAlign = "left";
    Context.fillText("grain vs brightness", X, Y - 7);
  }
  if (Mode === "split") {
    const X = Math.round(Split * Width);
    Context.fillStyle = "#ffffff";
    Context.fillRect(X - 1, 0, 2, Height);
    Context.beginPath();
    Context.arc(X, Height / 2, 9, 0, Math.PI * 2);
    Context.fill();
    Context.fillStyle = "#111";
    Context.beginPath();
    Context.moveTo(X - 5, Height / 2);
    Context.lineTo(X - 2, Height / 2 - 3);
    Context.lineTo(X - 2, Height / 2 + 3);
    Context.moveTo(X + 5, Height / 2);
    Context.lineTo(X + 2, Height / 2 - 3);
    Context.lineTo(X + 2, Height / 2 + 3);
    Context.fill();
    Context.fillStyle = "#000000a0";
    Context.textAlign = "left";
    for (const [Label, Left] of [["Original", 8], [Active ? "Effect" : "Effect · off", X + 8]]) {
      const W = Context.measureText(Label).width + 14;
      if (Left === 8 && X < W + 12) continue;
      if (Left !== 8 && X > Width - W - 12) continue;
      Context.fillStyle = "#000000a0";
      Context.beginPath();
      Context.roundRect(Left, Height - 26, W, 18, 9);
      Context.fill();
      Context.fillStyle = "#f2f2f2";
      Context.fillText(Label, Left + 7, Height - 17);
    }
  }
  if (!Active && Mode !== "split") {
    Context.fillStyle = "#000000a0";
    Context.beginPath();
    Context.roundRect(8, 8, 96, 20, 10);
    Context.fill();
    Context.fillStyle = "#ff8c7a";
    Context.textAlign = "left";
    Context.fillText("Effect disabled", 16, 18);
  }
  Context.restore();
}

export function EffectStudy({ Panel, Read, Active }) {
  const Canvas = useRef(null);
  const Latest = useRef({ Read, Active });
  Latest.current = { Read, Active };
  const [Mode, SetMode] = useState("split");
  const [Split, SetSplit] = useState(0.5);
  const [Paused, Pause] = useState(false);
  const Settings = useRef({ Mode, Split, Paused });
  Settings.current = { Mode, Split, Paused };
  const Drag = useRef(false);

  useEffect(() => {
    const Target = Canvas.current;
    if (!Target) return;
    const Context = Target.getContext("2d");
    const Scratch = document.createElement("canvas");
    Scratch.width = Width;
    Scratch.height = Height;
    const Paint = Scratch.getContext("2d", { willReadFrequently: true });
    const Original = document.createElement("canvas");
    Original.width = Width;
    Original.height = Height;
    const OriginalPaint = Original.getContext("2d");
    const Output = Context.createImageData(Width, Height);
    let Clock = 0, Before = performance.now(), Tick = 0, Handle = 0, Visible = true;
    const Watch = new IntersectionObserver(([Entry]) => (Visible = Entry.isIntersecting));
    Watch.observe(Target);
    const Render = (Now) => {
      Handle = requestAnimationFrame(Render);
      const Step = Math.min(0.1, (Now - Before) / 1000);
      if (Step < 1 / 40 && Tick > 0) return;
      Before = Now;
      if (!Visible && Tick > 0) return;
      const { Read: P, Active: On } = Latest.current;
      const { Mode: View, Split: Divide, Paused: Hold } = Settings.current;
      if (!Hold) Clock += Step;
      Tick++;
      const Speed = Panel === "motion-blur" ? P("Preview speed") : 0.35;
      const Pose = PoseAt(Clock, Speed);
      const Chart = ChartPanels.has(Panel);
      OriginalPaint.globalAlpha = 1;
      PaintScene(OriginalPaint, Pose, Chart);
      const Apply = On && View !== "original";
      if (!Apply) {
        Context.drawImage(Original, 0, 0);
      } else if (Panel === "motion-blur") {
        const Span = MotionBlurSpan(P).Span, Count = Math.max(2, Math.round(P("Samples")));
        const Objects = P("Object motion"), Camera = P("Camera motion");
        Paint.globalAlpha = 1;
        for (let Index = 0; Index < Count; Index++) {
          const Offset = Span * (Index / (Count - 1) - 0.5);
          const Shifted = PoseAt(Clock + Offset, Speed);
          const Mixed = {
            Pan: Camera ? Shifted.Pan : Pose.Pan,
            Travel: Camera ? Shifted.Travel : Pose.Travel,
            Car: Objects ? Shifted.Car : Pose.Car,
            Spin: Objects ? Shifted.Spin : Pose.Spin,
          };
          Paint.globalAlpha = 1 / (Index + 1);
          PaintScene(Paint, Mixed, false);
        }
        Paint.globalAlpha = 1;
        Context.drawImage(Scratch, 0, 0);
      } else {
        const Source = OriginalPaint.getImageData(0, 0, Width, Height).data;
        Treatments[Panel]?.(Source, Output.data, P, Clock);
        Context.putImageData(Output, 0, 0);
      }
      if (Apply && View === "split") {
        const X = Math.round(Divide * Width);
        if (X > 0) Context.drawImage(Original, 0, 0, X, Height, 0, 0, X, Height);
      }
      DrawOverlays(Context, Panel, P, Divide, View, On);
      Target.dataset.tick = String(Tick);
    };
    Handle = requestAnimationFrame(Render);
    return () => {
      cancelAnimationFrame(Handle);
      Watch.disconnect();
    };
  }, [Panel]);

  const Move = (Event) => {
    const Box = Canvas.current.getBoundingClientRect();
    SetSplit(Math.min(1, Math.max(0, (Event.clientX - Box.left) / Box.width)));
  };
  return (
    <section className="generic-card effect-study" data-card="Effect preview">
      <header className="effect-study-head">
        <h3>Effect preview</h3>
        <span>{Active ? "Authored values · browser render" : "Disabled · showing original"}</span>
      </header>
      <div className={"effect-canvas-seat" + (Mode === "split" ? " is-split" : "")}>
        <canvas
          ref={Canvas}
          width={Width}
          height={Height}
          role="img"
          aria-label={Panel.replaceAll("-", " ") + " live preview"}
          data-effect-preview={Panel}
          onPointerDown={(Event) => {
            if (Mode !== "split") return;
            Drag.current = true;
            Event.currentTarget.setPointerCapture(Event.pointerId);
            Move(Event);
          }}
          onPointerMove={(Event) => Drag.current && Move(Event)}
          onPointerUp={() => (Drag.current = false)}
          onPointerCancel={() => (Drag.current = false)}
        />
      </div>
      <div className="effect-study-bar">
        <div className="effect-segmented" role="radiogroup" aria-label="Preview mode">
          {[["Effect", "effect"], ["Split", "split"], ["Original", "original"]].map(([Label, Key]) => (
            <button key={Key} role="radio" aria-checked={Mode === Key} className={Mode === Key ? "active" : ""} onClick={() => SetMode(Key)}>
              {Label}
            </button>
          ))}
        </div>
        <button className="effect-pause" aria-pressed={Paused} onClick={() => Pause(!Paused)}>
          {Paused ? "Resume" : "Pause"}
        </button>
      </div>
      <div className="effect-readouts">
        {Readouts(Panel, Read).map(([Label, Text]) => (
          <div key={Label}>
            <span>{Label}</span>
            <b>{Text}</b>
          </div>
        ))}
      </div>
      <p className="graph-note">
        {Mode === "split" ? "Drag the divider to compare. " : ""}Procedural test scene processed with the values below; not the native renderer.
      </p>
    </section>
  );
}
