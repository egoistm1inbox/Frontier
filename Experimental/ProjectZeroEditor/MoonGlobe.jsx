import React, { useEffect, useRef, useState } from "react";

// Follow-up 65: the moon drawn as a lit sphere from its equirectangular texture (the shipped CelestialTextures maps), so Roll and
// Pitch turn the surface for real instead of spinning a flat picture. Optional: the phase lighting, the moonlight halo (Bright,
// Glow), the moon's own atmosphere (a tinted limb and rim) and a night-sky backdrop for the Appearance preview.

const Texels = {};
function LoadTexels(Preset) {
  if (!Texels[Preset])
    Texels[Preset] = new Promise((Resolve) => {
      const Picture = new Image();
      Picture.onload = () => {
        const Canvas = document.createElement("canvas");
        Canvas.width = Picture.naturalWidth;
        Canvas.height = Picture.naturalHeight;
        const Context = Canvas.getContext("2d", { willReadFrequently: true });
        Context.drawImage(Picture, 0, 0);
        Resolve({ Width: Canvas.width, Height: Canvas.height, Pixels: Context.getImageData(0, 0, Canvas.width, Canvas.height).data });
      };
      Picture.onerror = () => Resolve(null);
      Picture.src = window.NativeAssets?.Moons?.[Preset] || "";
    });
  return Texels[Preset];
}

const Hex = (Colour) => {
  const Digits = /^#?([0-9a-f]{6})$/i.exec(Colour || "")?.[1] || "9fc4ff";
  return [0, 2, 4].map((At) => parseInt(Digits.slice(At, At + 2), 16));
};
const Smooth = (From, To, X) => {
  const T = Math.min(1, Math.max(0, (X - From) / (To - From)));
  return T * T * (3 - 2 * T);
};

// Radius: the disc radius in CSS pixels. Width/Height: the canvas (defaults to a square around the disc and its rim).
// Phase: 0–1 synodic phase (null lights the full face). Air: { Intensity, Thickness, Tint } or null. Natural: radius of a 0.52°
// reference ring (drawn dashed) or null.
export default function MoonGlobe({
  Preset = 0,
  Radius = 80,
  Width = null,
  Height = null,
  Roll = 0,
  Pitch = 0,
  Phase = null,
  Bright = 1.6,
  Glow = 0,
  Air = null,
  Backdrop = false,
  Natural = null,
  Label = "Moon preview",
  Class = "",
}) {
  const Canvas = useRef(null);
  const [Texture, Keep] = useState(null);
  useEffect(() => {
    let Live = true;
    LoadTexels(Preset).then((Loaded) => Live && Keep({ Preset, Loaded }));
    return () => {
      Live = false;
    };
  }, [Preset]);
  const Rim = Air ? 0.06 + 0.07 * Air.Thickness : 0;
  const Halo = Glow > 0 ? 1.25 + Glow * 0.9 : 1;
  const W = Width ?? Math.ceil(Radius * 2 * Math.max(1 + Rim, Halo) + 8);
  const H = Height ?? W;
  useEffect(() => {
    const Surface = Canvas.current;
    if (!Surface) return;
    const Scale = Math.min(2, window.devicePixelRatio || 1);
    Surface.width = Math.round(W * Scale);
    Surface.height = Math.round(H * Scale);
    const Context = Surface.getContext("2d");
    Context.setTransform(Scale, 0, 0, Scale, 0, 0);
    Context.clearRect(0, 0, W, H);
    const CX = W / 2,
      CY = H / 2;
    if (Backdrop) {
      const Sky = Context.createLinearGradient(0, 0, 0, H);
      Sky.addColorStop(0, "#04070f");
      Sky.addColorStop(0.75, "#0b1426");
      Sky.addColorStop(1, "#16213a");
      Context.fillStyle = Sky;
      Context.fillRect(0, 0, W, H);
      // A fixed scatter of faint stars (the same every frame).
      let Seed = 7;
      const Next = () => ((Seed = (Seed * 16807) % 2147483647) / 2147483647);
      for (let Index = 0; Index < 70; Index++) {
        const X = Next() * W,
          Y = Next() * H * 0.85,
          A = 0.25 + Next() * 0.55;
        Context.fillStyle = `rgba(220,230,255,${A})`;
        Context.fillRect(X, Y, Next() < 0.15 ? 1.6 : 1, Next() < 0.15 ? 1.6 : 1);
      }
    }
    // Moonlight halo: Glow sets its reach, Bright its strength.
    if (Glow > 0) {
      const Reach = Radius * Halo;
      const Light = Math.min(0.75, 0.14 * Bright * Math.min(1.5, Glow));
      const Lit = Phase == null ? 1 : 0.25 + 0.75 * (1 - Math.cos(Phase * Math.PI * 2)) * 0.5;
      const Gradient = Context.createRadialGradient(CX, CY, Radius * 0.9, CX, CY, Reach);
      Gradient.addColorStop(0, `rgba(214,226,255,${Light * Lit})`);
      Gradient.addColorStop(1, "rgba(214,226,255,0)");
      Context.fillStyle = Gradient;
      Context.beginPath();
      Context.arc(CX, CY, Reach, 0, Math.PI * 2);
      Context.fill();
    }
    // The moon's own atmosphere: a tinted rim outside the limb.
    const Tint = Hex(Air?.Tint);
    if (Air) {
      const Outer = Radius * (1 + Rim);
      const Gradient = Context.createRadialGradient(CX, CY, Radius * 0.97, CX, CY, Outer);
      const A = Math.min(0.9, 0.55 * Air.Intensity);
      Gradient.addColorStop(0, `rgba(${Tint},${A})`);
      Gradient.addColorStop(0.45, `rgba(${Tint},${A * 0.35})`);
      Gradient.addColorStop(1, `rgba(${Tint},0)`);
      Context.fillStyle = Gradient;
      Context.beginPath();
      Context.arc(CX, CY, Outer, 0, Math.PI * 2);
      Context.fill();
    }
    // The sphere, pixel by pixel in device pixels.
    const Chart = Texture?.Preset === Preset ? Texture.Loaded : null;
    const R = Radius * Scale,
      DX = CX * Scale,
      DY = CY * Scale;
    const Left = Math.max(0, Math.floor(DX - R)),
      Top = Math.max(0, Math.floor(DY - R));
    const Span = Math.min(Surface.width - Left, Math.ceil(R * 2) + 2),
      Rows = Math.min(Surface.height - Top, Math.ceil(R * 2) + 2);
    if (Span > 0 && Rows > 0) {
      const Block = Context.getImageData(Left, Top, Span, Rows);
      const Out = Block.data;
      const RollAngle = (Roll * Math.PI) / 180,
        PitchAngle = (Pitch * Math.PI) / 180;
      const CR = Math.cos(RollAngle),
        SR = Math.sin(RollAngle),
        CP = Math.cos(PitchAngle),
        SP = Math.sin(PitchAngle);
      const Angle = (Phase ?? 0.5) * Math.PI * 2;
      const LX = Math.sin(Angle),
        LZ = -Math.cos(Angle);
      const Gain = Math.min(1.45, 0.55 + 0.32 * Bright);
      const AirStrength = Air ? Math.min(1, 0.6 * Air.Intensity) : 0;
      for (let Y = 0; Y < Rows; Y++)
        for (let X = 0; X < Span; X++) {
          const NX = (Left + X + 0.5 - DX) / R,
            NY = -(Top + Y + 0.5 - DY) / R;
          const D2 = NX * NX + NY * NY;
          if (D2 > 1) continue;
          const NZ = Math.sqrt(1 - D2);
          // Undo the roll (about the view axis), then the pitch (about the screen's horizontal axis), into the body's frame.
          const X1 = NX * CR + NY * SR,
            Y1 = -NX * SR + NY * CR;
          const Y2 = Y1 * CP - NZ * SP,
            Z2 = Y1 * SP + NZ * CP;
          let Colour = [150, 150, 150];
          if (Chart) {
            const U = 0.5 + Math.atan2(X1, Z2) / (Math.PI * 2),
              V = 0.5 - Math.asin(Math.max(-1, Math.min(1, Y2))) / Math.PI;
            const TX = Math.min(Chart.Width - 1, Math.floor(U * Chart.Width)),
              TY = Math.min(Chart.Height - 1, Math.floor(V * Chart.Height));
            const At = (TY * Chart.Width + TX) * 4;
            Colour = [Chart.Pixels[At], Chart.Pixels[At + 1], Chart.Pixels[At + 2]];
          }
          // Phase lighting (the terminator), a little earthshine, and limb darkening.
          const Facing = NX * LX + NZ * LZ;
          const Shade =
            (Phase == null ? 1 : 0.035 + 0.965 * Smooth(-0.06, 0.12, Facing) * (0.45 + 0.55 * Math.max(0, Facing))) *
            (0.62 + 0.38 * NZ) *
            Gain;
          const Limb = AirStrength * Math.pow(1 - NZ, 2.5);
          const Edge = Math.min(1, (1 - Math.sqrt(D2)) * R * 1.2);
          const At = (Y * Span + X) * 4;
          for (let C = 0; C < 3; C++) {
            const Lit = Math.min(255, Colour[C] * Shade + Tint[C] * Limb);
            Out[At + C] = Out[At + C] * (1 - Edge) + Lit * Edge;
          }
          Out[At + 3] = Math.max(Out[At + 3], Edge * 255);
        }
      Context.putImageData(Block, Left, Top);
    }
    if (Natural) {
      Context.setLineDash([3, 4]);
      Context.strokeStyle = "rgba(220,230,255,0.55)";
      Context.lineWidth = 1;
      Context.beginPath();
      Context.arc(CX, CY, Natural, 0, Math.PI * 2);
      Context.stroke();
      Context.setLineDash([]);
    }
  }, [Texture, Preset, Radius, W, H, Roll, Pitch, Phase, Bright, Glow, Air?.Intensity, Air?.Thickness, Air?.Tint, Backdrop, Natural]);
  return (
    <canvas
      ref={Canvas}
      className={"moon-globe " + Class}
      role="img"
      aria-label={Label}
      data-moon-roll={Roll}
      data-moon-pitch={Pitch}
      style={{ width: W, height: H }}
    />
  );
}
