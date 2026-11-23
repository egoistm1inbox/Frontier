//============================================================================================================================================
//                                                              SURFACETEXTURES.JS
//============================================================================================================================================
// 🧩 How the ShaderEditor's Pattern and Stamp workspaces (Follow-up 71) write into the bound material.
//   • A pattern becomes the material's own tiles: its colour, roughness and metalness pictures replace those channels (each a Texture
//     source) and the tile repeat becomes the channel repeat. Motifs that leave a channel alone show the channel's earlier value under them.
//   • A stamp is pressed onto the material once: its artwork is drawn at a place on the surface (U, V, size and turn) over whatever each
//     targeted channel already shows, so the earlier fill, gradient-free texture or pattern stays around it.
// Pictures are kept at 512 × 512 and must fit the material format's embedded-picture limit (MaterialSpecification.js); larger encodings
// fall back to WebP and then a smaller edge.

import { MaterialChannels, ChangeChannel, ShownChannel, Rgb } from "./MaterialSpecification.js";

export const TextureEdge = 512;
const PictureLimit = 300000;
const Field = (Id) => MaterialChannels.find((Each) => Each.Id === Id);

export function DecodePicture(Source) {
  return new Promise((Resolve, Reject) => {
    const Picture = new Image();
    Picture.onload = () => Resolve(Picture);
    Picture.onerror = () => Reject(new Error("The picture could not be decoded."));
    Picture.src = Source;
  });
}
// An SVG document drawn into a canvas of Edge × Edge (decoded as a picture, never as page markup).
export async function SvgCanvas(Svg, Edge = TextureEdge) {
  const Url = URL.createObjectURL(new Blob([Svg], { type: "image/svg+xml" }));
  try {
    const Picture = await DecodePicture(Url);
    const Canvas = document.createElement("canvas");
    Canvas.width = Canvas.height = Edge;
    Canvas.getContext("2d").drawImage(Picture, 0, 0, Edge, Edge);
    return Canvas;
  } finally {
    URL.revokeObjectURL(Url);
  }
}
// The texture record a channel keeps: PNG when it fits, otherwise WebP, otherwise a smaller edge.
export function EncodePicture(Canvas, Name) {
  let Source = Canvas;
  for (let Edge = Canvas.width; Edge >= 128; Edge /= 2) {
    if (Edge !== Source.width) {
      const Smaller = document.createElement("canvas");
      Smaller.width = Smaller.height = Edge;
      Smaller.getContext("2d").drawImage(Canvas, 0, 0, Edge, Edge);
      Source = Smaller;
    }
    for (const [Type, Quality] of [["image/png"], ["image/webp", 0.92], ["image/webp", 0.8]]) {
      const Encoded = Source.toDataURL(Type, Quality);
      if (Encoded.startsWith("data:" + Type) && Encoded.length <= PictureLimit) return { Name, Data: Encoded, Width: Edge, Height: Edge };
    }
  }
  throw new Error("The picture is too detailed to embed in the material.");
}
// Grey for a scalar (0–255 across the channel's range) or the colour itself.
function Shade(Id, Amount) {
  const Range = Field(Id);
  if (Range.Kind === "Colour") return Amount;
  const Grey = Math.round(Math.max(0, Math.min(1, (Amount - Range.Minimum) / (Range.Maximum - Range.Minimum || 1))) * 255);
  return `rgb(${Grey},${Grey},${Grey})`;
}
// What a channel shows now, drawn into a fresh canvas: its fill, or its texture tiled by its repeat (so a pressed stamp lands once).
export async function ChannelCanvas(Material, Id, Edge = TextureEdge) {
  const Canvas = document.createElement("canvas");
  Canvas.width = Canvas.height = Edge;
  const Brush = Canvas.getContext("2d");
  const Channel = ShownChannel(Material.Channels[Id]);
  Brush.fillStyle = Shade(Id, Channel.Fill);
  Brush.fillRect(0, 0, Edge, Edge);
  if (Channel.Source === "Texture" && Channel.Texture?.Data) {
    try {
      const Picture = await DecodePicture(Channel.Texture.Data);
      const Count = Math.max(1, Math.round(Channel.Repeat || 1)), Step = Edge / Count;
      for (let Y = 0; Y < Count; Y++) for (let X = 0; X < Count; X++) Brush.drawImage(Picture, X * Step, Y * Step, Step, Step);
      if (Field(Id).Kind !== "Colour" && Channel.Component !== "R") {
        // A scalar read from another component: copy that component into grey so the stamp composites on what the channel reads.
        const Pick = { R: 0, G: 1, B: 2, A: 3 }[Channel.Component] ?? 0, Pixels = Brush.getImageData(0, 0, Edge, Edge);
        for (let At = 0; At < Pixels.data.length; At += 4) Pixels.data[At] = Pixels.data[At + 1] = Pixels.data[At + 2] = Pixels.data[At + Pick];
        Brush.putImageData(Pixels, 0, 0);
      }
    } catch {}
  }
  return Canvas;
}
// A material with one channel replaced by a picture.
export function WithPicture(Material, Id, Texture, Repeat = 1) {
  return ChangeChannel(Material, Id, {
    Source: "Texture",
    Texture,
    Repeat: Math.max(0.1, Math.min(16, Repeat)),
    Component: Field(Id).Kind === "Colour" ? "RGB" : "R",
  });
}

// ── Patterns ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Layers: { colour, roughness, metallic } SVG documents from the pattern (patternSVG modes). Each lands over what the channel showed.
export async function PatternMaterial(Material, Layers, Repeat, Name) {
  let Next = Material;
  for (const [Id, Svg] of Object.entries(Layers)) {
    const Under = document.createElement("canvas");
    Under.width = Under.height = TextureEdge;
    const Brush = Under.getContext("2d");
    Brush.fillStyle = Shade(Id, ShownChannel(Material.Channels[Id]).Fill);
    Brush.fillRect(0, 0, TextureEdge, TextureEdge);
    Brush.drawImage(await SvgCanvas(Svg), 0, 0);
    Next = WithPicture(Next, Id, EncodePicture(Under, `${Name} · ${Field(Id).Label}`), Repeat);
  }
  return Next;
}

// ── Stamps ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The Texture Studio's channel targets and where they land in this material. Convert turns a stamp channel amount into this channel's.
export const StampTargets = {
  baseColor: { Id: "colour" },
  metalness: { Id: "metallic" },
  roughness: { Id: "roughness" },
  height: { Id: "displacement", Convert: (Amount) => (Amount - 0.5) * 0.2 },
  normal: { Id: "normal" },
  opacity: { Id: "opacity" },
  emission: { Id: "emission", Convert: (Hex) => (Rgb(Hex).reduce((Sum, Each, At) => Sum + Each * [0.2126, 0.7152, 0.0722][At], 0)) * 20 },
  occlusion: { Id: "occlusion" },
  anisotropy: { Id: "anisotropy" },
  anisotropyAngle: { Id: "direction", Convert: (Degrees) => (Degrees * Math.PI) / 180 },
  clearcoat: { Id: "coat" },
  transmission: { Id: "transmission" },
  refractionIndex: { Id: "ior", Convert: (Amount) => Math.min(2.5, Amount) },
  sheen: { Id: "sheen" },
  subsurface: { Id: "subsurface" },
};
// Placement: { U, V, Size, Turn } — the stamp's centre on the surface (0–1), its width as a share of the surface, and its turn in degrees.
export const RestingPlacement = { U: 0.5, V: 0.5, Size: 0.5, Turn: 0 };
function Press(Brush, Artwork, Placement, Edge) {
  const Width = Placement.Size * Edge;
  Brush.save();
  Brush.translate(Placement.U * Edge, Placement.V * Edge);
  Brush.rotate((Placement.Turn * Math.PI) / 180);
  Brush.drawImage(Artwork, -Width / 2, -Width / 2, Width, Width);
  Brush.restore();
}
// The stamp's coverage as a white-on-transparent silhouette (alpha) or white weighted by its luminance (luminance × alpha).
function Coverage(Artwork, Luminance) {
  const Canvas = document.createElement("canvas");
  Canvas.width = Canvas.height = Artwork.width;
  const Brush = Canvas.getContext("2d");
  Brush.drawImage(Artwork, 0, 0);
  const Pixels = Brush.getImageData(0, 0, Canvas.width, Canvas.height);
  for (let At = 0; At < Pixels.data.length; At += 4) {
    const D = Pixels.data, Weight = Luminance ? (0.2126 * D[At] + 0.7152 * D[At + 1] + 0.0722 * D[At + 2]) / 255 : 1;
    D[At + 3] = Math.round(D[At + 3] * Weight);
    D[At] = D[At + 1] = D[At + 2] = 255;
  }
  Brush.putImageData(Pixels, 0, 0);
  return Canvas;
}
// A tangent-space orientation picture from the stamp's luminance-weighted coverage (white raises the surface).
function OrientationFrom(Heights, Strength = 3) {
  const Edge = Heights.width, Read = Heights.getContext("2d").getImageData(0, 0, Edge, Edge).data;
  const Canvas = document.createElement("canvas");
  Canvas.width = Canvas.height = Edge;
  const Brush = Canvas.getContext("2d"), Out = Brush.createImageData(Edge, Edge);
  const H = (X, Y) => Read[((Math.min(Edge - 1, Math.max(0, Y)) * Edge + Math.min(Edge - 1, Math.max(0, X))) * 4)] / 255;
  for (let Y = 0; Y < Edge; Y++)
    for (let X = 0; X < Edge; X++) {
      const Dx = (H(X + 1, Y) - H(X - 1, Y)) * Strength, Dy = (H(X, Y + 1) - H(X, Y - 1)) * Strength;
      const Length = Math.hypot(Dx, Dy, 1), At = (Y * Edge + X) * 4;
      Out.data[At] = Math.round((-Dx / Length * 0.5 + 0.5) * 255);
      Out.data[At + 1] = Math.round((Dy / Length * 0.5 + 0.5) * 255);
      Out.data[At + 2] = Math.round((1 / Length * 0.5 + 0.5) * 255);
      Out.data[At + 3] = 255;
    }
  Brush.putImageData(Out, 0, 0);
  return Canvas;
}
// Presses the stamp (its assembled SVG) into every targeted channel of the material.
export async function StampMaterial(Material, Stamp, Svg, Placement) {
  const Artwork = await SvgCanvas(Svg);
  const Mask = Coverage(Artwork, Stamp.maskMode === "luminance");
  let Next = Material;
  const Targets = Stamp.channels.filter((Id) => StampTargets[Id]);
  for (const Target of Targets) {
    const { Id, Convert } = StampTargets[Target];
    const Canvas = await ChannelCanvas(Material, Id);
    const Brush = Canvas.getContext("2d");
    if (Target === "baseColor") Press(Brush, Artwork, Placement, TextureEdge);
    else if (Target === "normal") {
      // Orientation follows the stamp's relief: its silhouette on a flat field, turned into slopes.
      const Relief = document.createElement("canvas");
      Relief.width = Relief.height = TextureEdge;
      const Paint = Relief.getContext("2d");
      Paint.fillStyle = "#000";
      Paint.fillRect(0, 0, TextureEdge, TextureEdge);
      Press(Paint, Coverage(Artwork, true), Placement, TextureEdge);
      const Slopes = OrientationFrom(Relief);
      // Keep the earlier orientation outside the stamp.
      const Inside = document.createElement("canvas");
      Inside.width = Inside.height = TextureEdge;
      const Cut = Inside.getContext("2d");
      Cut.drawImage(Slopes, 0, 0);
      Cut.globalCompositeOperation = "destination-in";
      Press(Cut, Mask, Placement, TextureEdge);
      Brush.drawImage(Inside, 0, 0);
    } else {
      const Raw = Stamp.channelValues?.[Target];
      const Amount = Convert ? Convert(Raw) : Raw;
      const Tint = document.createElement("canvas");
      Tint.width = Tint.height = TextureEdge;
      const Paint = Tint.getContext("2d");
      Press(Paint, Mask, Placement, TextureEdge);
      Paint.globalCompositeOperation = "source-in";
      Paint.fillStyle = Shade(Id, Amount);
      Paint.fillRect(0, 0, TextureEdge, TextureEdge);
      Brush.drawImage(Tint, 0, 0);
    }
    Next = WithPicture(Next, Id, EncodePicture(Canvas, `${Stamp.name} · ${Field(Id).Label}`), 1);
  }
  return { Material: Next, Targets: Targets.map((Target) => Field(StampTargets[Target].Id).Label) };
}
