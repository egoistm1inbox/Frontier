//============================================================================================================================================
//                                                              PAINTWORKSPACE.JSX
//============================================================================================================================================
// 🧩 The ShaderEditor's Texture paint tab (Follow-up 74): painting straight onto the bound material, on the same live viewport the
// Material tab shows. It is drawn for the ShaderEditor rather than taken from the Texture Studio's paint studio.
//   • One brush paints a whole material at once, as a material painter does: every channel that is not locked in the LayerStack takes
//     the brush's own amount for it (colour, roughness, metallic, emission, occlusion, opacity, displacement), so a stroke of "Rust"
//     lays its colour, roughness and metalness together. The Paint page holds those amounts and a shelf of brush materials.
//   • Three docks, as in Pattern and Stamp: LayerStack | Viewport | Inspector. The LayerStack lists the paintable channels: the eye shows
//     or hides a channel's paint in the viewport, the lock keeps the brush off it.
//   • The Viewport paints on the 3D subject (left button; Alt, Shift, the right and middle buttons still move the camera) or, in UV, on
//     the flat picture of the chosen channel with the preview shape's UV layout over it.
//   • Tools: Brush, Eraser (brings back what the channel showed before painting), Soften, Fill (the whole channel, or through the mask)
//     and Picker (takes every channel's amount under the cursor into the brush). Mirror U repeats each dab across the texture.
//   • A mask from the Baking tab (occlusion, curvature, cavity, edge wear, dirt, dust…) limits where paint lands.
// Pictures are 512 × 512 (SurfaceTextures.js TextureEdge). Apply to material writes every painted channel into the material as a
// picture. The canvases live in Sessions (held by the ShaderEditor), so leaving the tab keeps the work.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Brush, Eraser, Droplet, PaintBucket, Pipette, FlipHorizontal2, Undo2, Redo2, Paintbrush, Download, RotateCcw, Grid3x3, MoreHorizontal, SlidersHorizontal } from "lucide-react";
import ArtworkOutliner from "./ArtworkOutliner.jsx";
import { DockTabs, ViewportHeader } from "./SurfaceDocks.jsx";
import { Popover } from "./PatternWorkspace.jsx";
import { QuickMenu, useQuickMenu, MenuTabs, MenuSections, MenuLabel, MenuChips } from "./QuickMenu.jsx";
import { PageStrip, PageTurn, PageLook } from "./PageCarousel.jsx";
import { Control, Card } from "./Inspectors.jsx";
import ShaderViewport, { ChannelPixels, PreviewGeometry, PreviewShapes, BoundShape } from "./ShaderViewport.jsx";
import { MaterialChannels, ShownChannel, Rgb } from "./MaterialSpecification.js";
import { TextureEdge, ChannelCanvas, EncodePicture, WithPicture } from "./SurfaceTextures.js";
import "./SurfaceWorkspaces.css";

const Edge = TextureEdge;
const FieldOf = (Id) => MaterialChannels.find((Each) => Each.Id === Id);
export const PaintChannels = ["colour", "roughness", "metallic", "emission", "occlusion", "opacity", "displacement"];
const Pages = [
  { Id: "brush", Label: "Brush" },
  { Id: "paint", Label: "Paint" },
  { Id: "mask", Label: "Mask" },
  { Id: "canvas", Label: "Canvas" },
];
const Tools = [
  ["brush", "Brush", "B", Brush],
  ["erase", "Eraser", "E", Eraser],
  ["soften", "Soften", "S", Droplet],
  ["fill", "Fill", "F", PaintBucket],
  ["pick", "Picker", "I", Pipette],
];
// Brush tip shapes (the remastered Texture Studio's Brush Inspector): each is a white stamp whose alpha is the tip.
const Nibs = [
  ["round", "Round"],
  ["chisel", "Chisel"],
  ["chalk", "Chalk"],
  ["splatter", "Splatter"],
  ["sponge", "Sponge"],
];
// The Brush inspector's sections while the Brush is chosen.
const MenuParts = [
  ["tip", "Tip & channels"],
  ["material", "Material"],
  ["mask", "Mask"],
];
// Brush materials: amounts for colour, roughness and metallic (the channels they unlock).
const BrushMaterials = [
  ["Rust", { colour: "#8a4528", roughness: 0.86, metallic: 0.15 }],
  ["Gold leaf", { colour: "#d8a73f", roughness: 0.22, metallic: 1 }],
  ["Copper", { colour: "#c4774b", roughness: 0.34, metallic: 1 }],
  ["Rubber", { colour: "#1d1d1f", roughness: 0.92, metallic: 0 }],
  ["Chalk", { colour: "#e9e5db", roughness: 0.97, metallic: 0 }],
  ["Oil", { colour: "#121212", roughness: 0.08, metallic: 0 }],
  ["Steel", { colour: "#9aa0a6", roughness: 0.38, metallic: 1 }],
  ["Moss", { colour: "#4f6b2c", roughness: 0.9, metallic: 0 }],
];
// Bake maps that read as masks (one value per texel).
export const MaskMaps = ["occlusion", "curvature", "cavity", "convexity", "edge-wear", "dirt", "dust", "thickness", "bevel-mask"];
const MaskNames = {
  occlusion: "Ambient occlusion",
  curvature: "Curvature",
  cavity: "Cavity",
  convexity: "Convexity",
  "edge-wear": "Edge wear",
  dirt: "Dirt",
  dust: "Dust",
  thickness: "Thickness",
  "bevel-mask": "Bevel",
};

// A channel's amount as the grey (scalars, across their range) or colour a canvas holds.
const Shade = (Id, Amount) => {
  const Field = FieldOf(Id);
  if (Field.Kind === "Colour") return Amount;
  const Grey = Math.round(Math.max(0, Math.min(1, (Amount - Field.Minimum) / (Field.Maximum - Field.Minimum || 1))) * 255);
  return `rgb(${Grey},${Grey},${Grey})`;
};
const Hex = (R, G, B) => "#" + [R, G, B].map((Each) => Each.toString(16).padStart(2, "0")).join("");
const Blank = () => {
  const Canvas = document.createElement("canvas");
  Canvas.width = Canvas.height = Edge;
  return Canvas;
};
// What a channel shows now, as a 512 × 512 picture (gradients and GLSL channels through the viewport's own channel pictures).
export async function ChannelPicture(Material, Id) {
  const Owned = Material.Channels[Id];
  const Source = Owned.Source === "Code" ? "Code" : ShownChannel(Owned).Source;
  if (Source === "Gradient" || Source === "Code") {
    const Pixels = await ChannelPixels(Owned, FieldOf(Id));
    if (Pixels) {
      const Side = Math.round(Math.sqrt(Pixels.length / 4));
      const Small = document.createElement("canvas");
      Small.width = Small.height = Side;
      Small.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(Pixels), Side, Side), 0, 0);
      const Canvas = Blank();
      Canvas.getContext("2d").drawImage(Small, 0, 0, Edge, Edge);
      return Canvas;
    }
  }
  return ChannelCanvas(Material, Id, Edge);
}
const Signature = (Material, Id) => JSON.stringify(Material.Channels[Id]);
const Copy = (Canvas) => {
  const Next = Blank();
  Next.getContext("2d").drawImage(Canvas, 0, 0);
  return Next;
};
// The brush tip: white with a soft edge (Hardness is the share of the radius kept solid), in one of the Nibs' shapes. The grain of
// chalk, splatter and sponge comes from a seeded sequence, so a tip looks the same on every dab.
const Tips = new Map();
const SeededSequence = (Seed) => () => ((Seed = (Seed * 16807) % 2147483647) - 1) / 2147483646;
function TipOf(Radius, Hardness, Nib = "round") {
  const Key = Math.round(Radius * 2) / 2 + ":" + Hardness.toFixed(2) + ":" + Nib;
  if (Tips.has(Key)) return Tips.get(Key);
  const Side = Math.ceil(Radius * 2) + 2, Canvas = document.createElement("canvas");
  Canvas.width = Canvas.height = Side;
  const Brush = Canvas.getContext("2d"), Middle = Side / 2;
  const Random = SeededSequence(Side * 7919 + Nibs.findIndex(([Id]) => Id === Nib) + 11);
  const Soft = (X, Y, Reach) => {
    const Fade = Brush.createRadialGradient(X, Y, 0, X, Y, Reach);
    Fade.addColorStop(0, "#fff");
    Fade.addColorStop(Math.min(0.99, Hardness), "#fff");
    Fade.addColorStop(1, "rgba(255,255,255,0)");
    return Fade;
  };
  if (Nib === "chisel") {
    // A flat, slanted blade.
    Brush.save();
    Brush.translate(Middle, Middle);
    Brush.rotate(-Math.PI / 5);
    Brush.scale(1, 0.32);
    Brush.fillStyle = Soft(0, 0, Radius);
    Brush.fillRect(-Middle, -Middle / 0.32, Side, Side / 0.32);
    Brush.restore();
  } else if (Nib === "splatter") {
    // Drops scattered inside the radius, larger towards the middle.
    const Count = Math.max(8, Math.min(46, Math.round(Radius * 0.9)));
    for (let At = 0; At < Count; At++) {
      const Angle = Random() * Math.PI * 2, Reach = Math.sqrt(Random()) * Radius * 0.86;
      const X = Middle + Math.cos(Angle) * Reach, Y = Middle + Math.sin(Angle) * Reach;
      const Drop = Math.max(0.8, Radius * (0.05 + Random() * 0.16) * (1.15 - Reach / Radius));
      Brush.fillStyle = Soft(X, Y, Drop);
      Brush.fillRect(X - Drop, Y - Drop, Drop * 2, Drop * 2);
    }
  } else {
    Brush.fillStyle = Soft(Middle, Middle, Radius);
    Brush.fillRect(0, 0, Side, Side);
    if (Nib === "chalk" || Nib === "sponge") {
      const Pixels = Brush.getImageData(0, 0, Side, Side), Alpha = Pixels.data;
      if (Nib === "chalk") {
        // Grain: most texels keep their cover, a share drop away in short streaks along the stroke.
        for (let Y = 0; Y < Side; Y++) {
          let Streak = 0;
          for (let X = 0; X < Side; X++) {
            if (Streak <= 0 && Random() < 0.16) Streak = 1 + Math.floor(Random() * 4);
            const Keep = Streak-- > 0 ? 0.12 : 0.72 + Random() * 0.28;
            Alpha[(Y * Side + X) * 4 + 3] *= Keep;
          }
        }
      } else {
        // Pores: a coarse lattice of random cover, blended between its corners.
        const Cell = Math.max(2, Radius / 4), Across = Math.ceil(Side / Cell) + 2;
        const Lattice = Array.from({ length: Across * Across }, () => (Random() < 0.38 ? 0.08 : 0.55 + Random() * 0.45));
        for (let Y = 0; Y < Side; Y++)
          for (let X = 0; X < Side; X++) {
            const U = X / Cell, V = Y / Cell, I = Math.floor(U), J = Math.floor(V), Fu = U - I, Fv = V - J;
            const A = Lattice[J * Across + I], B = Lattice[J * Across + I + 1], C = Lattice[(J + 1) * Across + I], D = Lattice[(J + 1) * Across + I + 1];
            Alpha[(Y * Side + X) * 4 + 3] *= (A * (1 - Fu) + B * Fu) * (1 - Fv) + (C * (1 - Fu) + D * Fu) * Fv;
          }
      }
      Brush.putImageData(Pixels, 0, 0);
    }
  }
  if (Tips.size > 64) Tips.clear();
  Tips.set(Key, Canvas);
  return Canvas;
}
// The chosen tip drawn small (the Brush inspector's preview).
function NibPicture({ Nib, Hardness, Strength, Size = 64 }) {
  const Sheet = useRef(null);
  useEffect(() => {
    const Canvas = Sheet.current;
    if (!Canvas) return;
    Canvas.width = Canvas.height = Size * 2;
    const Brush = Canvas.getContext("2d");
    Brush.clearRect(0, 0, Size * 2, Size * 2);
    Brush.globalAlpha = 0.35 + Strength * 0.65;
    Brush.drawImage(TipOf(Size * 0.8, Hardness, Nib), Size * 0.2, Size * 0.2, Size * 1.6, Size * 1.6);
  }, [Nib, Hardness, Strength, Size]);
  return <canvas ref={Sheet} aria-label={`${Nib} brush tip`} />;
}
// A mask picture (white, its alpha the mask) at 512 × 512 from a baked map: Level picks where it turns on, Spread how softly.
function MaskPicture(Baked, Invert, Level, Spread) {
  const Canvas = Blank(), Brush = Canvas.getContext("2d");
  Brush.drawImage(Baked, 0, 0, Edge, Edge);
  const Pixels = Brush.getImageData(0, 0, Edge, Edge), D = Pixels.data;
  const Low = Level - Spread / 2, Wide = Math.max(0.001, Spread);
  for (let At = 0; At < D.length; At += 4) {
    let Amount = D[At] / 255;
    if (Invert) Amount = 1 - Amount;
    const T = Math.max(0, Math.min(1, (Amount - Low) / Wide));
    D[At + 3] = Math.round(T * T * (3 - 2 * T) * 255);
    D[At] = D[At + 1] = D[At + 2] = 255;
  }
  Brush.putImageData(Pixels, 0, 0);
  return Canvas;
}
// The preview shape's UV layout drawn as lines over a transparent 512 × 512 picture.
const Layouts = new Map();
function LayoutOf(Shape, Bound) {
  const Key = Shape === BoundShape ? Shape + ":" + Bound?.Key : Shape;
  if (Layouts.has(Key)) return Layouts.get(Key);
  const Geometry = PreviewGeometry(Shape, Bound), Uv = Geometry.attributes.uv, Index = Geometry.index;
  const Canvas = Blank(), Brush = Canvas.getContext("2d");
  Brush.strokeStyle = "rgba(255,180,84,0.16)";
  Brush.lineWidth = 0.6;
  Brush.beginPath();
  const Count = Index ? Index.count : Uv.count;
  const Corner = (At) => (Index ? Index.getX(At) : At);
  for (let At = 0; At < Count; At += 3) {
    const A = Corner(At), B = Corner(At + 1), C = Corner(At + 2);
    Brush.moveTo(Uv.getX(A) * Edge, (1 - Uv.getY(A)) * Edge);
    Brush.lineTo(Uv.getX(B) * Edge, (1 - Uv.getY(B)) * Edge);
    Brush.lineTo(Uv.getX(C) * Edge, (1 - Uv.getY(C)) * Edge);
    Brush.closePath();
  }
  Brush.stroke();
  Geometry.dispose();
  if (Layouts.size > 8) Layouts.clear();
  Layouts.set(Key, Canvas);
  return Canvas;
}

// A small live picture of a canvas (redrawn when Revision changes).
function Thumbnail({ Canvas, Revision, Size = 26 }) {
  const Own = useRef(null);
  useEffect(() => {
    const Brush = Own.current?.getContext("2d");
    if (!Brush || !Canvas) return;
    Brush.clearRect(0, 0, Size * 2, Size * 2);
    Brush.drawImage(Canvas, 0, 0, Size * 2, Size * 2);
  }, [Canvas, Revision, Size]);
  return <canvas ref={Own} className="pw-thumbnail" width={Size * 2} height={Size * 2} style={{ width: Size, height: Size }} aria-hidden="true" />;
}

// The UV view: the chosen channel flat, with the UV layout over it; painting maps the cursor straight to texels.
function UvSheet({ Canvas, Revision, Layout, ShowLayout, Radius, Paint }) {
  const Own = useRef(null), Ring = useRef(null), Stroke = useRef(null);
  useEffect(() => {
    const Brush = Own.current?.getContext("2d");
    if (!Brush || !Canvas) return;
    Brush.clearRect(0, 0, Edge, Edge);
    Brush.drawImage(Canvas, 0, 0);
    if (ShowLayout) Brush.drawImage(Layout, 0, 0);
  }, [Canvas, Revision, Layout, ShowLayout]);
  const Texel = (Event) => {
    const Box = Own.current.getBoundingClientRect();
    return { X: ((Event.clientX - Box.left) / Box.width) * Edge, Y: ((Event.clientY - Box.top) / Box.height) * Edge, Scale: Box.width / Edge };
  };
  const Follow = (Event) => {
    const At = Texel(Event), Mark = Ring.current;
    if (!Mark) return;
    Mark.style.display = "block";
    Mark.style.left = At.X * At.Scale + "px";
    Mark.style.top = At.Y * At.Scale + "px";
    Mark.style.width = Mark.style.height = Radius * 2 * At.Scale + "px";
  };
  return (
    <div className="pw-sheet">
      <div className="pw-sheet-square">
        <canvas
          ref={Own}
          width={Edge}
          height={Edge}
          aria-label="Channel picture"
          onPointerDown={(Event) => {
            if (Event.button !== 0) return;
            Event.currentTarget.setPointerCapture(Event.pointerId);
            Stroke.current = Event.pointerId;
            const At = Texel(Event);
            Paint.Down({ Uv: { x: At.X / Edge, y: 1 - At.Y / Edge } }, Event);
          }}
          onPointerMove={(Event) => {
            Follow(Event);
            if (Stroke.current !== Event.pointerId) return;
            const At = Texel(Event);
            Paint.Move({ Uv: { x: At.X / Edge, y: 1 - At.Y / Edge }, Flat: true }, Event);
          }}
          onPointerUp={(Event) => {
            if (Stroke.current !== Event.pointerId) return;
            Stroke.current = null;
            Paint.Up();
          }}
          onPointerLeave={() => Ring.current && (Ring.current.style.display = "none")}
        />
        <span className="pw-sheet-ring" ref={Ring} />
      </div>
    </div>
  );
}

export default function PaintWorkspace({ Material, Owner, Apply, Sessions, SessionKey, Bakes = {}, Shape, ChooseShape, Bound = null }) {
  const Shapes = Bound ? [...PreviewShapes, BoundShape] : PreviewShapes;
  const ShapeName = (Name) => (Name === BoundShape ? Bound?.Name || "bound object" : Name);
  // ── The session: one canvas per channel (and what it showed before painting), kept by the ShaderEditor between visits ──────────
  const Session = useMemo(() => {
    if (!Sessions.current.has(SessionKey)) Sessions.current.set(SessionKey, { Canvases: {}, Originals: {}, Signatures: {}, Strokes: {}, Back: [], Ahead: [] });
    return Sessions.current.get(SessionKey);
  }, [Sessions, SessionKey]);
  const [Revision, Redraw] = useState(0);
  const [Generation, Renew] = useState(0); // counts the times channel canvases were made again
  const [Ready, Prepared] = useState(PaintChannels.every((Id) => Session.Canvases[Id]));
  const [Status, Report] = useState("");
  useEffect(() => {
    let Live = true;
    (async () => {
      let Made = false;
      for (const Id of PaintChannels) {
        const Now = Signature(Material, Id);
        if (Session.Canvases[Id] && (Session.Signatures[Id] === Now || Session.Strokes[Id])) continue;
        const Ground = await ChannelPicture(Material, Id);
        if (!Live) return;
        Session.Canvases[Id] = Ground;
        Session.Originals[Id] = Copy(Ground);
        Session.Signatures[Id] = Now;
        Made = true;
      }
      if (Live) {
        Prepared(true);
        if (Made) Renew((Count) => Count + 1);
        Redraw((Count) => Count + 1);
      }
    })();
    return () => {
      Live = false;
    };
  }, [Material, Session]);

  // ── Brush ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const [Tool, ChooseTool] = useState("brush");
  const [Size, Resize] = useState(24);
  const [Strength, Strengthen] = useState(0.85);
  const [Hardness, Harden] = useState(0.55);
  const [Spacing, Space] = useState(0.18);
  const [Mirror, Reflect] = useState(false);
  const [Nib, ChooseNib] = useState("round");
  const [Sampled, KeepSample] = useState(null);
  const [MenuPart, TurnMenuPart] = useState("tip");
  const [Amounts, SetAmounts] = useState(() => ({
    ...Object.fromEntries(PaintChannels.map((Id) => [Id, ShownChannel(Material.Channels[Id]).Fill])),
    colour: "#8a4528",
    roughness: 0.86,
    metallic: 0.15,
  }));
  const [Unlocked, Unlock] = useState(() => new Set(["colour", "roughness", "metallic"]));
  const [HiddenPaint, HidePaint] = useState(() => new Set());
  const [Focus, Choose] = useState("colour");
  const [Mode, ChooseMode] = useState("3d");
  const [ShowLayout, ToggleLayout] = useState(true);
  const [Mask, SetMask] = useState({ Map: "", Invert: false, Level: 0.5, Spread: 0.5 });
  const MaskCanvas = useMemo(() => (Mask.Map && Bakes[Mask.Map] ? MaskPicture(Bakes[Mask.Map].Canvas, Mask.Invert, Mask.Level, Mask.Spread) : null), [Mask, Bakes]);
  const MaskShape = Mask.Map && Bakes[Mask.Map]?.Shape;

  // ── Painting ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const Scratch = useRef(null);
  const Brushing = useRef(null);
  const Pending = useRef(0);
  const Now = useRef({});
  Now.current = { Tool, Size, Strength, Hardness, Spacing, Mirror, Amounts, Unlocked, MaskCanvas, Nib };
  const Targets = () => PaintChannels.filter((Id) => Now.current.Unlocked.has(Id));
  const Soon = () => {
    if (Pending.current) return;
    Pending.current = requestAnimationFrame(() => {
      Pending.current = 0;
      Redraw((Count) => Count + 1);
    });
  };
  useEffect(() => () => cancelAnimationFrame(Pending.current), []);
  // One dab of every target channel at texel (X, Y), wrapped across the edges, mirrored across U when asked.
  const Dab = (X, Y, Weight) => {
    const { Tool: Using, Size: Radius, Strength: Flow, Hardness: Solid, Amounts: Lay, MaskCanvas: Limit, Nib: Grain } = Now.current;
    const Tip = TipOf(Radius, Solid, Using === "soften" ? "round" : Grain), Side = Tip.width;
    const Spots = [[X, Y]];
    if (Now.current.Mirror) Spots.push([Edge - X, Y]);
    const Wrapped = [];
    for (const [Sx, Sy] of Spots)
      for (const Ox of [0, -Edge, Edge])
        for (const Oy of [0, -Edge, Edge]) {
          const Cx = Sx + Ox, Cy = Sy + Oy;
          if (Cx + Side / 2 < 0 || Cx - Side / 2 > Edge || Cy + Side / 2 < 0 || Cy - Side / 2 > Edge) continue;
          Wrapped.push([Cx, Cy]);
        }
    if (!Scratch.current) Scratch.current = document.createElement("canvas");
    const Work = Scratch.current;
    const Margin = Using === "soften" ? Math.ceil(Math.max(2, Radius / 3)) * 2 : 0;
    Work.width = Work.height = Side + Margin * 2;
    const Mix = Work.getContext("2d");
    for (const Id of Brushing.current.Ids) {
      const Picture = Session.Canvases[Id].getContext("2d");
      for (const [Cx, Cy] of Wrapped) {
        const Left = Cx - Side / 2, Top = Cy - Side / 2;
        Mix.globalCompositeOperation = "source-over";
        Mix.filter = "none";
        Mix.clearRect(0, 0, Work.width, Work.height);
        if (Using === "brush") {
          Mix.fillStyle = Shade(Id, Lay[Id]);
          Mix.fillRect(0, 0, Side, Side);
        } else if (Using === "erase") Mix.drawImage(Session.Originals[Id], Left, Top, Side, Side, 0, 0, Side, Side);
        else {
          Mix.filter = `blur(${Math.max(1, Radius / 6)}px)`;
          Mix.drawImage(Session.Canvases[Id], Left - Margin, Top - Margin, Side + Margin * 2, Side + Margin * 2, 0, 0, Side + Margin * 2, Side + Margin * 2);
          Mix.filter = "none";
        }
        Mix.globalCompositeOperation = "destination-in";
        Mix.drawImage(Tip, Margin, Margin);
        if (Limit) Mix.drawImage(Limit, ((Left % Edge) + Edge) % Edge, ((Top % Edge) + Edge) % Edge, Side, Side, Margin, Margin, Side, Side);
        Picture.globalAlpha = Math.max(0, Math.min(1, Flow * Weight));
        Picture.drawImage(Work, Margin, Margin, Side, Side, Left, Top, Side, Side);
        Picture.globalAlpha = 1;
      }
    }
  };
  const Texel = (Hit) => ({ X: Hit.Uv.x * Edge, Y: (1 - Hit.Uv.y) * Edge });
  const Begin = (Hit, Event) => {
    const Ids = Targets();
    const { Tool: Using, Amounts: Lay, MaskCanvas: Limit, Strength: Flow } = Now.current;
    const At = Texel(Hit);
    if (Using === "pick") {
      const Taken = {};
      for (const Id of PaintChannels) {
        const [R, G, B] = Session.Canvases[Id].getContext("2d").getImageData(Math.max(0, Math.min(Edge - 1, Math.floor(At.X))), Math.max(0, Math.min(Edge - 1, Math.floor(At.Y))), 1, 1).data;
        const Field = FieldOf(Id);
        Taken[Id] = Field.Kind === "Colour" ? Hex(R, G, B) : +(Field.Minimum + (R / 255) * (Field.Maximum - Field.Minimum)).toFixed(3);
      }
      SetAmounts((Before) => ({ ...Before, ...Taken }));
      KeepSample(Taken);
      ChooseTool("brush");
      Report("Picked the material under the cursor");
      return;
    }
    if (!Ids.length) {
      Report("Every channel is locked · unlock one in the LayerStack to paint it");
      return;
    }
    Session.Back.push(Object.fromEntries(Ids.map((Id) => [Id, Session.Canvases[Id].getContext("2d").getImageData(0, 0, Edge, Edge)])));
    if (Session.Back.length > 16) Session.Back.shift();
    Session.Ahead = [];
    if (Using === "fill") {
      for (const Id of Ids) {
        const Picture = Session.Canvases[Id].getContext("2d");
        Picture.globalAlpha = Flow;
        if (Limit) {
          const Layer = Blank(), Mix = Layer.getContext("2d");
          Mix.fillStyle = Shade(Id, Lay[Id]);
          Mix.fillRect(0, 0, Edge, Edge);
          Mix.globalCompositeOperation = "destination-in";
          Mix.drawImage(Limit, 0, 0);
          Picture.drawImage(Layer, 0, 0);
        } else {
          Picture.fillStyle = Shade(Id, Lay[Id]);
          Picture.fillRect(0, 0, Edge, Edge);
        }
        Picture.globalAlpha = 1;
        Session.Strokes[Id] = (Session.Strokes[Id] || 0) + 1;
      }
      Redraw((Count) => Count + 1);
      return;
    }
    Brushing.current = { Ids, Last: At, Left: 0 };
    Dab(At.X, At.Y, Event.pointerType === "pen" ? Event.pressure || 1 : 1);
    Soon();
  };
  const Continue = (Hit, Event) => {
    const Stroke = Brushing.current;
    if (!Stroke) return;
    if (!Hit) {
      Stroke.Last = null;
      return;
    }
    const At = Texel(Hit), Weight = Event.pointerType === "pen" ? Event.pressure || 1 : 1;
    const Step = Math.max(1, Now.current.Spacing * Now.current.Size);
    if (!Stroke.Last || Math.hypot(At.X - Stroke.Last.X, At.Y - Stroke.Last.Y) > Edge * 0.3) {
      // A jump across a UV seam starts a new run instead of streaking across the picture.
      Dab(At.X, At.Y, Weight);
      Stroke.Last = At;
      Stroke.Left = 0;
    } else {
      const Dx = At.X - Stroke.Last.X, Dy = At.Y - Stroke.Last.Y, Length = Math.hypot(Dx, Dy);
      let Along = Step - Stroke.Left;
      while (Along <= Length) {
        Dab(Stroke.Last.X + (Dx * Along) / Length, Stroke.Last.Y + (Dy * Along) / Length, Weight);
        Along += Step;
      }
      Stroke.Left = Length - (Along - Step);
      Stroke.Last = At;
    }
    Soon();
  };
  const Finish = () => {
    const Stroke = Brushing.current;
    if (!Stroke) return;
    for (const Id of Stroke.Ids) Session.Strokes[Id] = (Session.Strokes[Id] || 0) + 1;
    Brushing.current = null;
    Report("");
    Redraw((Count) => Count + 1);
  };
  const Painter = { Active: Ready && Mode === "3d", Radius: Size / Edge, Down: Begin, Move: Continue, Up: Finish };
  const Step = (From, To) => {
    const Entry = Session[From].pop();
    if (!Entry) return;
    Session[To].push(Object.fromEntries(Object.keys(Entry).map((Id) => [Id, Session.Canvases[Id].getContext("2d").getImageData(0, 0, Edge, Edge)])));
    for (const [Id, Pixels] of Object.entries(Entry)) {
      Session.Canvases[Id].getContext("2d").putImageData(Pixels, 0, 0);
      Session.Strokes[Id] = Math.max(0, (Session.Strokes[Id] || 0) + (From === "Back" ? -1 : 1));
    }
    Redraw((Count) => Count + 1);
  };
  const Undo = () => Step("Back", "Ahead"), Redo = () => Step("Ahead", "Back");
  // Keys while the pointer is over the workspace: B E S F I pick tools, [ and ] resize, Ctrl/⌘ Z undoes.
  const Root = useRef(null);
  useEffect(() => {
    const Keys = (Event) => {
      if (!Root.current?.matches(":hover") || /input|select|textarea/i.test(Event.target.tagName)) return;
      const Key = Event.key.toLowerCase();
      if ((Event.ctrlKey || Event.metaKey) && Key === "z") {
        Event.preventDefault();
        Event.shiftKey ? Redo() : Undo();
        return;
      }
      if (Event.ctrlKey || Event.metaKey || Event.altKey) return;
      const Picked = Tools.find(([, , Shortcut]) => Shortcut.toLowerCase() === Key);
      if (Picked) ChooseTool(Picked[0]);
      else if (Key === "[") Resize((Was) => Math.max(1, Math.round(Was / 1.2)));
      else if (Key === "]") Resize((Was) => Math.min(160, Math.round(Was * 1.2)));
      else return;
      Event.preventDefault();
    };
    window.addEventListener("keydown", Keys);
    return () => window.removeEventListener("keydown", Keys);
  });

  // ── Applying ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const Painted = PaintChannels.filter((Id) => Session.Strokes[Id]);
  const [Applying, Busy] = useState(false);
  const ApplyToMaterial = async () => {
    if (!Painted.length) return;
    Busy(true);
    try {
      let Next = Material;
      for (const Id of Painted) Next = WithPicture(Next, Id, EncodePicture(Session.Canvases[Id], `Painted ${FieldOf(Id).Label}`), 1);
      for (const Id of Painted) {
        Session.Signatures[Id] = Signature(Next, Id);
        Session.Strokes[Id] = 0;
      }
      Apply(Next);
      Report(`Applied to ${Owner} · ${Painted.map((Id) => FieldOf(Id).Label.toLowerCase()).join(", ")}`);
    } catch (Problem) {
      Report(String(Problem?.message || Problem));
    } finally {
      Busy(false);
    }
  };
  const ResetChannel = (Id) => {
    Session.Back.push({ [Id]: Session.Canvases[Id].getContext("2d").getImageData(0, 0, Edge, Edge) });
    Session.Canvases[Id].getContext("2d").drawImage(Session.Originals[Id], 0, 0);
    Session.Strokes[Id] = 0;
    Redraw((Count) => Count + 1);
  };
  const SavePicture = (Id) => {
    const Link = document.createElement("a");
    Link.href = Session.Canvases[Id].toDataURL("image/png");
    Link.download = `${Material.Name} ${FieldOf(Id).Label}.png`.replace(/[\\/:*?"<>|]/g, " ");
    Link.click();
  };

  // ── LayerStack: the paintable channels (ArtworkOutliner) ──────────────────────────────────────────────────────────────────────
  const [Query, Search] = useState(""), [Filter, Sift] = useState("all");
  const Toggle = (Change, Id) =>
    Change((Before) => {
      const Next = new Set(Before);
      Next.has(Id) ? Next.delete(Id) : Next.add(Id);
      return Next;
    });
  const Rows = PaintChannels.filter((Id) => FieldOf(Id).Label.toLowerCase().includes(Query.toLowerCase()))
    .filter((Id) => (Filter === "visible" ? !HiddenPaint.has(Id) : Filter === "hidden" ? HiddenPaint.has(Id) : Filter === "locked" ? !Unlocked.has(Id) : true))
    .map((Id) => ({
      Id,
      Name: FieldOf(Id).Label,
      Label: FieldOf(Id).Label + " channel",
      Detail: (Session.Strokes[Id] ? `${Session.Strokes[Id]} stroke${Session.Strokes[Id] === 1 ? "" : "s"} · not applied` : Material.Used.includes(Id) ? ShownChannel(Material.Channels[Id]).Source : "Default") + (Unlocked.has(Id) ? " · in the brush" : ""),
      Picture: <Thumbnail Canvas={Session.Canvases[Id]} Revision={Revision} />,
      Chosen: Focus === Id,
      Pick: () => Choose(Id),
      Hidden: HiddenPaint.has(Id),
      Show: () => Toggle(HidePaint, Id),
      Locked: !Unlocked.has(Id),
      Lock: () => Toggle(Unlock, Id),
    }));
  const Live = useMemo(() => (Ready ? Object.fromEntries(PaintChannels.filter((Id) => !HiddenPaint.has(Id)).map((Id) => [Id, Session.Canvases[Id]])) : undefined), [Ready, HiddenPaint, Session, Generation]);

  // ── Inspector pages ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  const [Page, TurnTo] = useState(0);
  const Motion = PageTurn(Page);
  const Turn = (At) => {
    Motion.Turn(At);
    TurnTo(At);
  };
  const [Shut, ShutDocks] = useState({});
  const AmountControl = (Id) => {
    const Field = FieldOf(Id);
    return Field.Kind === "Colour" ? (
      <Control key={Id} Field={{ Label: Field.Label, Control: "Colour" }} Value={Amounts[Id]} Change={(Amount) => SetAmounts((Before) => ({ ...Before, [Id]: Amount }))} />
    ) : (
      <Control
        key={Id}
        Field={{ Label: Field.Label, Minimum: Field.Minimum, Maximum: Field.Maximum, Decimals: Field.Maximum - Field.Minimum > 2 ? 1 : 2, Unit: Field.Unit, Default: Field.Default }}
        Value={Amounts[Id]}
        Change={(Amount) => SetAmounts((Before) => ({ ...Before, [Id]: Amount }))}
      />
    );
  };
  const MaskOptions = ["None", ...MaskMaps.filter((Id) => Bakes[Id]).map((Id) => MaskNames[Id])];
  const MaskIndex = Mask.Map ? MaskOptions.indexOf(MaskNames[Mask.Map]) : 0;
  // The brush's sliders, shared by the Brush page and the Brush inspector.
  const SizeField = <Control Field={{ Label: "Size", Minimum: 1, Maximum: 160, Decimals: 0, Unit: "px", Default: 24, Curve: 2 }} Value={Size} Change={Resize} />;
  const StrengthField = <Control Field={{ Label: "Strength", Minimum: 0, Maximum: 1, Decimals: 0, Unit: "%", Default: 0.85, DisplayScale: 100 }} Value={Strength} Change={Strengthen} />;
  const HardnessField = <Control Field={{ Label: "Hardness", Minimum: 0, Maximum: 1, Decimals: 0, Unit: "%", Default: 0.55, DisplayScale: 100 }} Value={Hardness} Change={Harden} />;
  const SpacingField = <Control Field={{ Label: "Spacing", Minimum: 0.05, Maximum: 1, Decimals: 0, Unit: "%", Default: 0.18, DisplayScale: 100 }} Value={Spacing} Change={Space} />;
  const MirrorField = <Control Field={{ Label: "Mirror U", Control: "Switch" }} Value={Mirror} Change={Reflect} />;
  const MaskFields = (
    <>
      <Control Field={{ Label: "Mask", Control: "Select", Options: MaskOptions }} Value={Math.max(0, MaskIndex)} Change={(At) => SetMask({ ...Mask, Map: At ? MaskMaps.find((Id) => MaskNames[Id] === MaskOptions[At]) : "" })} />
      {Mask.Map && (
        <>
          <Control Field={{ Label: "Invert", Control: "Switch" }} Value={Mask.Invert} Change={(Invert) => SetMask({ ...Mask, Invert })} />
          <Control Field={{ Label: "Level", Minimum: 0, Maximum: 1, Decimals: 2, Default: 0.5 }} Value={Mask.Level} Change={(Level) => SetMask({ ...Mask, Level })} />
          <Control Field={{ Label: "Spread", Minimum: 0.01, Maximum: 1, Decimals: 2, Default: 0.5 }} Value={Mask.Spread} Change={(Spread) => SetMask({ ...Mask, Spread })} />
        </>
      )}
    </>
  );
  const LoadMaterial = (Name, Look) => {
    SetAmounts((Before) => ({ ...Before, ...Look }));
    Unlock((Before) => new Set([...Before, "colour", "roughness", "metallic"]));
    Report(`Brush loaded with ${Name}`);
  };
  const PageBodies = [
    <>
      <Card Title={Tools.find(([Id]) => Id === Tool)[1]}>
        <div className="pw-tip">
          <span style={{ width: Math.min(96, Size * 2), height: Math.min(96, Size * 2), background: `radial-gradient(circle, #f0f0f0 0 ${Hardness * 70}%, transparent 71%)`, opacity: 0.35 + Strength * 0.65 }} />
          <small>
            {Size} px · {Math.round(Strength * 100)} % · {Math.round(Hardness * 100)} % hard
          </small>
        </div>
        <Control Field={{ Label: "Tip", Control: "Select", Options: Nibs.map(([, Caption]) => Caption) }} Value={Math.max(0, Nibs.findIndex(([Id]) => Id === Nib))} Change={(At) => ChooseNib(Nibs[At][0])} />
        {SizeField}
        {StrengthField}
        {HardnessField}
        {SpacingField}
        {MirrorField}
        <p className="card-foot">Right-click the viewport or press Q for the Brush inspector · [ and ] resize · a pen's pressure scales the strength · Alt-drag orbits while painting</p>
      </Card>
    </>,
    <>
      <Card Title="Brush materials">
        <div className="pw-materials" role="list">
          {BrushMaterials.map(([Name, Look]) => (
            <button
              key={Name}
              type="button"
              role="listitem"
              className="pw-material"
              title={`${Name} · colour, roughness and metallic`}
              onClick={() => LoadMaterial(Name, Look)}
            >
              <span
                style={{
                  background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,${0.9 - Look.roughness * 0.7}) 0, transparent ${18 + Look.roughness * 28}%), radial-gradient(circle at 45% 42%, ${Look.colour}, color-mix(in srgb, ${Look.colour} ${60 - Look.metallic * 25}%, #000) 85%)`,
                }}
              />
              {Name}
            </button>
          ))}
        </div>
      </Card>
      <Card Title="What the brush lays">
        {PaintChannels.filter((Id) => Unlocked.has(Id)).map(AmountControl)}
        {!Unlocked.size && <p>Every channel is locked. Unlock channels in the LayerStack to paint them.</p>}
        <p className="card-foot">Locked channels keep their pictures: {PaintChannels.filter((Id) => !Unlocked.has(Id)).map((Id) => FieldOf(Id).Label).join(", ") || "none"}</p>
      </Card>
    </>,
    <>
      <Card Title="Paint through a bake">
        {MaskFields}
        {Mask.Map && (
          <>
            <div className="pw-mask-preview">
              <Thumbnail Canvas={MaskCanvas} Revision={JSON.stringify(Mask)} Size={120} />
            </div>
            {MaskShape && MaskShape !== Shape && <p className="pw-warning">Baked on the {ShapeName(MaskShape).toLowerCase()} · its UVs differ from the {ShapeName(Shape).toLowerCase()} shown now.</p>}
          </>
        )}
        <p className="card-foot">{MaskOptions.length > 1 ? "Brush, Eraser, Soften and Fill land only where the mask is white." : "Bake geometry maps in the Baking tab to paint through occlusion, curvature, edge wear, dirt and more."}</p>
      </Card>
    </>,
    <>
      <Card Title={FieldOf(Focus).Label}>
        <div className="pw-canvas-preview">
          <Thumbnail Canvas={Session.Canvases[Focus]} Revision={Revision} Size={180} />
        </div>
        <p>
          {Edge} × {Edge} · {Session.Strokes[Focus] ? `${Session.Strokes[Focus]} strokes not applied` : "matches the material"}
        </p>
        <div className="pw-buttons">
          <button type="button" className="sfw-icon-button" onClick={() => ResetChannel(Focus)} disabled={!Ready}>
            <RotateCcw size={13} /> Clear paint
          </button>
          <button type="button" className="sfw-icon-button" onClick={() => SavePicture(Focus)} disabled={!Ready}>
            <Download size={13} /> PNG
          </button>
        </div>
      </Card>
      <Card Title="Preview shape">
        <Control Field={{ Label: "Shape", Control: "Select", Options: Shapes.map(ShapeName) }} Value={Math.max(0, Shapes.indexOf(Shape))} Change={(At) => ChooseShape(Shapes[At])} />
        <p className="card-foot">Painting follows the shape's UVs. The rounded cube repeats one square on every face; {Bound ? `${Bound.Name} paints through ${Bound.Unwrapped ? "the UV tab's layout" : "its primitive's own UVs"}.` : "bind a scene object to paint on it."}</p>
      </Card>
    </>,
  ];

  // ── The Brush inspector (the remastered Texture Studio's tool menu): right-click the viewport, press Q, or the rail's Brush pill ────────
  const Menu = useQuickMenu(Root);
  const [, ToolCaption, , ToolGlyph] = Tools.find(([Id]) => Id === Tool);
  const ChannelChips = (
    <>
      <MenuLabel Note={`${Unlocked.size} of ${PaintChannels.length} · the rest are locked`}>Paint channels</MenuLabel>
      <MenuChips Label="Paint channels" Chips={PaintChannels.map((Id) => [Id, FieldOf(Id).Label, Unlocked.has(Id), () => Toggle(Unlock, Id)])} />
    </>
  );
  const NibChips = (
    <>
      <MenuLabel>Brush tip shape</MenuLabel>
      <MenuChips Label="Brush tip shape" Chips={Nibs.map(([Id, Caption]) => [Id, Caption, Nib === Id, () => ChooseNib(Id)])} />
    </>
  );
  const TipCard = (
    <div className="qm-tip">
      <NibPicture Nib={Tool === "soften" ? "round" : Nib} Hardness={Hardness} Strength={Strength} />
      <span>
        <b>{Tool === "soften" ? "Soft blur" : Nibs.find(([Id]) => Id === Nib)[1]} tip</b>
        {Size} px · {Math.round(Strength * 100)} % · {Math.round(Hardness * 100)} % hard
        {Mirror ? <em>Mirrored across U</em> : null}
      </span>
    </div>
  );
  const Amountless = !PaintChannels.some((Id) => Unlocked.has(Id));
  const MenuBodies = {
    brush: (
      <>
        <MenuSections Label="Brush inspector sections" Sections={MenuParts} Active={MenuPart} Pick={TurnMenuPart} />
        {MenuPart === "tip" ? (
          <>
            {TipCard}
            {ChannelChips}
            {NibChips}
            <div className="qm-controls">
              {SizeField}
              {StrengthField}
              {HardnessField}
              {SpacingField}
              {MirrorField}
            </div>
          </>
        ) : MenuPart === "material" ? (
          <>
            <MenuLabel Note="colour · roughness · metallic">Brush materials</MenuLabel>
            <div className="qm-swatches" role="list" aria-label="Brush materials">
              {BrushMaterials.map(([Name, Look]) => (
                <button
                  key={Name}
                  type="button"
                  role="listitem"
                  className={"qm-swatch" + (Amounts.colour === Look.colour && Amounts.roughness === Look.roughness ? " on" : "")}
                  aria-label={Name}
                  title={Name}
                  style={{ background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,${0.9 - Look.roughness * 0.7}) 0, transparent ${18 + Look.roughness * 28}%), radial-gradient(circle at 45% 42%, ${Look.colour}, color-mix(in srgb, ${Look.colour} ${60 - Look.metallic * 25}%, #000) 85%)` }}
                  onClick={() => LoadMaterial(Name, Look)}
                />
              ))}
            </div>
            <MenuLabel>What the brush lays</MenuLabel>
            <div className="qm-controls">{PaintChannels.filter((Id) => Unlocked.has(Id)).map(AmountControl)}</div>
            {Amountless && <p className="qm-note">Every channel is locked · turn one on under Tip & channels.</p>}
          </>
        ) : (
          <>
            <div className="qm-controls">{MaskFields}</div>
            <p className="qm-note">{MaskOptions.length > 1 ? "Brush, Eraser, Soften and Fill land only where the mask is white." : "Bake geometry maps in the Baking tab to paint through occlusion, curvature, edge wear, dirt and more."}</p>
          </>
        )}
      </>
    ),
    erase: (
      <>
        {TipCard}
        {ChannelChips}
        {NibChips}
        <div className="qm-controls">
          {SizeField}
          {StrengthField}
          {HardnessField}
        </div>
        <p className="qm-note">The eraser brings back what each channel showed before painting.</p>
      </>
    ),
    soften: (
      <>
        {TipCard}
        {ChannelChips}
        <div className="qm-controls">
          {SizeField}
          {StrengthField}
        </div>
        <p className="qm-note">Soften blurs the paint under the tip · the blur grows with the size.</p>
      </>
    ),
    fill: (
      <>
        {ChannelChips}
        <MenuLabel>Fill with</MenuLabel>
        <div className="qm-controls">
          {PaintChannels.filter((Id) => Unlocked.has(Id)).map(AmountControl)}
          {StrengthField}
        </div>
        <p className="qm-note">{MaskCanvas ? `Fills only where ${MaskNames[Mask.Map].toLowerCase()} is white.` : "One click fills every channel in the brush across the whole texture."}</p>
      </>
    ),
    pick: (
      <>
        <MenuLabel>Sampled material</MenuLabel>
        {Sampled ? (
          <div className="qm-sample">
            <i style={{ background: Sampled.colour }} />
            <span>
              <b>{Sampled.colour}</b>
              Roughness {Number(Sampled.roughness).toFixed(2)} · Metallic {Number(Sampled.metallic).toFixed(2)}
            </span>
          </div>
        ) : (
          <p className="qm-note">Click the model with the Picker to sample every channel under the cursor.</p>
        )}
        <button
          type="button"
          className="qm-accent"
          disabled={!Sampled}
          onClick={() => {
            SetAmounts((Before) => ({ ...Before, ...Sampled }));
            ChooseTool("brush");
          }}
        >
          <Brush size={14} /> Paint with the sampled material
        </button>
      </>
    ),
  };
  const BrushInspector = (
    <QuickMenu Control={Menu} Category="paint" Glyph={<ToolGlyph size={14} />} Title={`${ToolCaption} inspector`} Keys="Right-click / Q / Esc" Width={372}>
      <MenuTabs Label="Paint tools" Tabs={Tools.map(([Id, Caption, , Glyph]) => [Id, Caption, Glyph])} Active={Tool} Pick={ChooseTool} />
      {MenuBodies[Tool]}
      {Tool !== "pick" && (
        <button type="button" className="qm-accent" disabled={!Painted.length || Applying} onClick={ApplyToMaterial}>
          <Paintbrush size={14} /> {Applying ? "Applying…" : Painted.length ? `Apply ${Painted.length} painted channel${Painted.length === 1 ? "" : "s"}` : "Nothing painted yet"}
        </button>
      )}
    </QuickMenu>
  );

  const ToolKeys = (
    <>
      <span className="sfw-view-family" role="group" aria-label="Paint tools">
        {Tools.map(([Id, Caption, Shortcut, Glyph]) => (
          <button key={Id} type="button" className={"sfw-tool labelled" + (Tool === Id ? " on" : "")} aria-label={Caption} aria-pressed={Tool === Id} aria-keyshortcuts={Shortcut} title={`${Caption} (${Shortcut})`} onClick={() => ChooseTool(Id)}>
            <Glyph size={15} />
            <kbd>{Shortcut}</kbd>
          </button>
        ))}
      </span>
      <span className="sfw-view-divider" />
      <span className="sfw-view-family" role="group" aria-label="Paint options">
        <button type="button" className={"sfw-tool" + (Mirror ? " on" : "")} aria-label="Mirror U" aria-pressed={Mirror} title="Mirror each dab across the texture" onClick={() => Reflect(!Mirror)}>
          <FlipHorizontal2 size={15} />
        </button>
        {Mode === "uv" && (
          <button type="button" className={"sfw-tool" + (ShowLayout ? " on" : "")} aria-label="Show UV layout" aria-pressed={ShowLayout} title="Show the shape's UV layout" onClick={() => ToggleLayout(!ShowLayout)}>
            <Grid3x3 size={15} />
          </button>
        )}
      </span>
      <span className="sfw-view-divider" />
      <Popover Label="More tools" Caption="More tools" Glyph={<MoreHorizontal size={15} />} className="sfw-more-pill">
        <span className="sfw-menu-title">Texture paint</span>
        <button data-closes onClick={() => Reflect(!Mirror)}>
          <FlipHorizontal2 size={13} /> {Mirror ? "Stop mirroring across U" : "Mirror across U"}
        </button>
        <button data-closes onClick={() => ChooseMode(Mode === "3d" ? "uv" : "3d")}>
          <Grid3x3 size={13} /> {Mode === "3d" ? "Paint on the UV sheet" : "Paint on the model"}
        </button>
        <span className="sfw-menu-title">Tip</span>
        {Nibs.map(([Id, Caption]) => (
          <button key={Id} data-closes aria-pressed={Nib === Id} onClick={() => ChooseNib(Id)}>
            <Brush size={13} /> {Caption}
            {Nib === Id ? " ✓" : ""}
          </button>
        ))}
        <span className="sfw-menu-title">{FieldOf(Focus).Label}</span>
        <button data-closes disabled={!Ready} onClick={() => ResetChannel(Focus)}>
          <RotateCcw size={13} /> Clear the paint
        </button>
        <button data-closes disabled={!Ready} onClick={() => SavePicture(Focus)}>
          <Download size={13} /> Save as PNG
        </button>
      </Popover>
      <button type="button" data-quick-menu-toggle className={"sfw-tool labelled sfw-menu-pill" + (Menu.At ? " on" : "")} aria-label="Brush inspector" aria-expanded={!!Menu.At} title="Brush inspector · right-click the viewport or press Q" onClick={Menu.Toggle}>
        <SlidersHorizontal size={14} /> Brush inspector <kbd>Q</kbd>
      </button>
    </>
  );
  const Trailing = (
    <>
      <label className="pw-size" title="Brush size">
        <input type="range" aria-label="Brush size slider" min={1} max={160} step={1} value={Size} style={{ "--fill": ((Size - 1) / 159) * 100 + "%" }} onChange={(Event) => Resize(+Event.target.value)} />
        <output>{Size}px</output>
      </label>
      <span className="sfw-view-note">
        {Edge} × {Edge}
      </span>
    </>
  );

  return (
    <div className="surface-workspace paint-workspace" data-surface-workspace="paint" ref={Root}>
      {BrushInspector}
      <div className={"sfw-body sfw-docks" + (Shut.left ? " no-left" : "") + (Shut.right ? " no-right" : "")}>
        {!Shut.left && (
          <section className="sfw-rail ao-rail sfw-pane left" aria-label="LayerStack dock">
            <DockTabs Label="LayerStack dock" Tabs={[{ Id: "channels", Label: "LayerStack" }]} Active="channels" Close={() => ShutDocks((Before) => ({ ...Before, left: true }))} />
            <ArtworkOutliner
              Title="Channels"
              Detail={`${Unlocked.size} in the brush · ${Painted.length} painted`}
              Visible={PaintChannels.length - HiddenPaint.size}
              Hidden={HiddenPaint.size}
              ShowAll={() => HidePaint(new Set())}
              HideAll={() => HidePaint(new Set(PaintChannels))}
              Query={Query}
              Search={Search}
              Filter={Filter}
              Sift={Sift}
              Label="Paint channels"
              Rows={Rows}
              Empty="No channel matches"
              Footer={
                <>
                  <span>
                    <small>Brush</small>
                    <b>{Unlocked.size} / {PaintChannels.length}</b>
                  </span>
                  <span>
                    <small>Lock</small>Keeps the brush off a channel
                  </span>
                </>
              }
            />
          </section>
        )}
        <section className="sfw-pane centre" aria-label="Viewport dock">
          <DockTabs Label="Viewport dock" Tabs={[{ Id: "viewport", Label: "Viewport" }]} Active="viewport" Restore={Shut.left || Shut.right ? () => ShutDocks({}) : undefined} />
          <ViewportHeader
            Picture={
              <span className="sfw-view-picture">
                <Paintbrush size={15} />
              </span>
            }
            Name={<span className="sfw-view-name pw-name">{Material.Name}</span>}
            Detail={<span role="status">{Status || (Ready ? (Painted.length ? `${Painted.length} channel${Painted.length === 1 ? "" : "s"} painted · not applied` : "Texture paint · ready") : "Preparing the channel pictures…")}</span>}
            ModesLabel="Paint view"
            Modes={[
              ["3d", "3D", Mode === "3d", () => ChooseMode("3d")],
              ["uv", "UV", Mode === "uv", () => ChooseMode("uv")],
            ]}
            Actions={
              <>
                <button type="button" className="sfw-icon-button" aria-label="Undo" title="Undo · Ctrl/⌘ Z" disabled={!Session.Back.length} onClick={Undo}>
                  <Undo2 size={14} />
                </button>
                <button type="button" className="sfw-icon-button" aria-label="Redo" title="Redo · Ctrl/⌘ Shift Z" disabled={!Session.Ahead.length} onClick={Redo}>
                  <Redo2 size={14} />
                </button>
              </>
            }
            Primary={
              <button type="button" className="sfw-apply" disabled={!Painted.length || Applying} onClick={ApplyToMaterial} title={`Write the painted channels into ${Owner}`}>
                <Paintbrush size={14} /> {Applying ? "Applying…" : "Apply to material"}
              </button>
            }
            Tools={ToolKeys}
            Trailing={Trailing}
          />
          <main className="sfw-centre pw-centre" data-tool={Tool} {...Menu.Viewport}>
            {Mode === "3d" ? (
              <ShaderViewport
                Material={Material}
                Eyebrow={"TEXTURE PAINT / " + Tools.find(([Id]) => Id === Tool)[1].toUpperCase()}
                Title={FieldOf(Focus).Label}
                Note={Unlocked.size ? "Brush writes " + PaintChannels.filter((Id) => Unlocked.has(Id)).map((Id) => FieldOf(Id).Label.toLowerCase()).join(" · ") : "Every channel is locked"}
                Shape={Shape}
                ChooseShape={ChooseShape}
                Live={Live}
                LiveRevision={Revision}
                Painter={Painter}
                Bound={Bound}
              />
            ) : (
              Ready && <UvSheet Canvas={Session.Canvases[Focus]} Revision={Revision} Layout={LayoutOf(Shape, Bound)} ShowLayout={ShowLayout} Radius={Size} Paint={Painter} />
            )}
          </main>
          <div className="sfw-view-foot">
            {Mode === "3d" ? "Left-drag paints · Alt-drag, Shift-drag or a right-drag move the camera · right-click or Q opens the Brush inspector" : `UV of the ${ShapeName(Shape).toLowerCase()} · ${FieldOf(Focus).Label}`}
            {MaskCanvas ? ` · masked by ${MaskNames[Mask.Map].toLowerCase()}` : ""}
          </div>
        </section>
        {!Shut.right && (
          <section className="sfw-inspector sfw-pane right" aria-label="Inspector dock">
            <DockTabs Label="Inspector dock" Tabs={[{ Id: "inspector", Label: "Inspector" }]} Active="inspector" Close={() => ShutDocks((Before) => ({ ...Before, right: true }))} />
            <PageStrip Owner="Texture paint" Pages={Pages} Index={Page} Pick={Turn} />
            <div className="sfw-pages pw-pages">
              {PageBodies.map((Body, At) => (
                <div key={Pages[At].Id} {...PageLook(At, Page, Motion)} data-page={Pages[At].Id}>
                  {Body}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
