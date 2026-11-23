// Follow-up 69: the ShaderEditor's viewport. A real-time PBR preview (three.js MeshPhysicalMaterial in a softbox studio) of the
// material being edited, on the repository shader ball, a sphere, a rounded cube or a draped cloth, with orbit, pan and zoom.
// Every channel the material uses drives the matching physical input; a gradient, texture, GLSL shader or linked channel is drawn
// into a small image the material samples (scalar channels are stored across their own range).
import React, { useEffect, useRef, useState } from "react";
import { THREE, Stage } from "../Shared/Studio/Render.js";
import { MaterialChannels, GradientValue, ShownChannel, Rgb } from "./MaterialSpecification.js";
import { BakeShaderChannel } from "./ShaderChannel.js";
import { ReadMesh } from "./ShaderballPanel.jsx";
import { StudioReflections } from "./EditorAssets.js";

const Size = 128;
export const PreviewShapes = ["Shader ball", "Sphere", "Rounded cube", "Draped cloth"];
export const PreviewStudios = {
  "Studio softbox": { Key: "#ffffff", Rim: "#cfe0ff", Ambient: 0.55, Background: ["#3a3c41", "#1b1c1f"] },
  "Warm interior": { Key: "#ffd9ae", Rim: "#ffb27a", Ambient: 0.45, Background: ["#40362e", "#1d1916"] },
  "Overcast": { Key: "#e4ecf5", Rim: "#e4ecf5", Ambient: 0.9, Background: ["#4a4f56", "#24272b"] },
  "Night street": { Key: "#a9c4ff", Rim: "#ff8a5c", Ambient: 0.25, Background: ["#1f2533", "#0b0d12"] },
};

// ── Channel images ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const Pictures = new Map(); // data URL → Promise<Uint8ClampedArray>
function PicturePixels(Source) {
  if (!Pictures.has(Source))
    Pictures.set(
      Source,
      (async () => {
        const Image = new window.Image();
        Image.src = Source;
        await Image.decode();
        const Canvas = document.createElement("canvas");
        Canvas.width = Canvas.height = Size;
        const Brush = Canvas.getContext("2d");
        Brush.drawImage(Image, 0, 0, Size, Size);
        return Brush.getImageData(0, 0, Size, Size).data;
      })().catch(() => null),
    );
  return Pictures.get(Source);
}
// The 0–1 position of a value across a field's range.
const Across = (Field, Amount) => Math.max(0, Math.min(1, (Amount - Field.Minimum) / (Field.Maximum - Field.Minimum || 1)));
// Pixels (RGBA, top row first) for a channel that isn't a plain fill, or null. Scalars come out grey, 0–255 across the range.
export async function ChannelPixels(Owned, Field) {
  const Colour = Field.Kind === "Colour";
  if (Owned.Source === "Code") {
    if (Owned.Code?.Language !== "GLSL") return null;
    return BakeShaderChannel(Owned.Code.Text, Field).Pixels || null;
  }
  const Channel = ShownChannel(Owned);
  if (Channel.Source === "Gradient") {
    const Pixels = new Uint8ClampedArray(Size * Size * 4);
    for (let Y = 0; Y < Size; Y++)
      for (let X = 0; X < Size; X++) {
        const T = Channel.Axis === "V" ? 1 - Y / (Size - 1) : X / (Size - 1);
        const Shade = GradientValue(Channel, T, Colour);
        const RGB = Colour ? Rgb(Shade).map((Each) => Each * 255) : Array(3).fill(Across(Field, +Shade) * 255);
        Pixels.set([...RGB, 255], (Y * Size + X) * 4);
      }
    return Pixels;
  }
  if (Channel.Source === "Texture" && Channel.Texture?.Data) {
    const Raw = await PicturePixels(Channel.Texture.Data);
    if (!Raw) return null;
    const Pick = { R: 0, G: 1, B: 2, A: 3 }[Channel.Component];
    if (Colour && Pick === undefined) return Raw;
    const Pixels = new Uint8ClampedArray(Size * Size * 4);
    for (let At = 0; At < Size * Size; At++) {
      const Grey = Raw[At * 4 + (Pick ?? 0)];
      Pixels.set([Grey, Grey, Grey, 255], At * 4);
    }
    return Pixels;
  }
  return null;
}
function ImageTexture(Pixels, Colour, Repeat = 1) {
  const Texture = new THREE.DataTexture(new Uint8Array(Pixels), Size, Size, THREE.RGBAFormat);
  Texture.flipY = true;
  Texture.wrapS = Texture.wrapT = THREE.RepeatWrapping;
  Texture.repeat.set(Repeat, Repeat);
  Texture.magFilter = THREE.LinearFilter;
  Texture.minFilter = THREE.LinearMipmapLinearFilter;
  Texture.generateMipmaps = true;
  if (Colour) Texture.colorSpace = THREE.SRGBColorSpace;
  Texture.needsUpdate = true;
  return Texture;
}
const Fill = (Material, Id) => {
  const Channel = ShownChannel(Material.Channels[Id]);
  return Channel.Fill;
};

// The physical material for a resolved material (every channel, used or default). Returns the material and its textures.
export async function PhysicalLook(Material) {
  const Look = new THREE.MeshPhysicalMaterial();
  const Made = [];
  const Field = (Id) => MaterialChannels.find((Each) => Each.Id === Id);
  const Map = async (Id) => {
    const Owned = Material.Channels[Id];
    const Pixels = await ChannelPixels(Owned, Field(Id));
    if (!Pixels) return null;
    const Repeat = ShownChannel(Owned).Source === "Texture" ? ShownChannel(Owned).Repeat || 1 : 1;
    const Texture = ImageTexture(Pixels, Field(Id).Kind === "Colour", Repeat);
    Made.push(Texture);
    return Texture;
  };
  const Average = (Pixels) => {
    let Total = 0;
    for (let At = 0; At < Pixels.length; At += 4) Total += Pixels[At];
    return Total / (Pixels.length / 4) / 255;
  };
  // Colour.
  Look.color.set(Fill(Material, "colour"));
  const ColourMap = await Map("colour");
  if (ColourMap) {
    Look.map = ColourMap;
    Look.color.set("#ffffff");
  }
  // Scalars that three.js multiplies by a map: the map holds 0–1 across the range, so the factor is the range's top (all 0–1 here).
  const Scalar = async (Id, Key, MapKey) => {
    const Texture = await Map(Id);
    if (Texture && MapKey) {
      Look[MapKey] = Texture;
      Look[Key] = Field(Id).Maximum;
    } else Look[Key] = +Fill(Material, Id);
    return Texture;
  };
  await Scalar("metallic", "metalness", "metalnessMap");
  await Scalar("roughness", "roughness", "roughnessMap");
  await Scalar("transmission", "transmission", "transmissionMap");
  await Scalar("coat", "clearcoat", "clearcoatMap");
  await Scalar("coatRoughness", "clearcoatRoughness", "clearcoatRoughnessMap");
  await Scalar("sheenRoughness", "sheenRoughness", "sheenRoughnessMap");
  await Scalar("thickness", "thickness", "thicknessMap");
  // Channels without a matching map use the image's average.
  const Mean = async (Id) => {
    const Pixels = await ChannelPixels(Material.Channels[Id], Field(Id));
    return Pixels ? Field(Id).Minimum + Average(Pixels) * (Field(Id).Maximum - Field(Id).Minimum) : +Fill(Material, Id);
  };
  Look.ior = Math.max(1, Math.min(2.333, await Mean("ior")));
  Look.specularIntensity = Math.max(0, Math.min(1, ((await Mean("reflectance")) - 1) / 1.5 + 0.5));
  const Anisotropy = await Mean("anisotropy");
  Look.anisotropy = Math.abs(Anisotropy);
  Look.anisotropyRotation = (await Mean("direction")) + (Anisotropy < 0 ? Math.PI / 2 : 0);
  // Sheen and subsurface colour.
  const Sheen = Fill(Material, "sheen");
  Look.sheenColor.set(Sheen);
  const SheenMap = await Map("sheen");
  if (SheenMap) {
    Look.sheenColorMap = SheenMap;
    Look.sheenColor.set("#ffffff");
  }
  Look.sheen = SheenMap || Sheen.toLowerCase() !== "#000000" ? 1 : 0;
  Look.attenuationColor.set(Fill(Material, "subsurface"));
  Look.attenuationDistance = Math.max(0.05, +Fill(Material, "thickness") * 2);
  // Emission: the base colour glowing, scaled from nits (preview scale).
  const EmissionMap = await Map("emission");
  Look.emissive.set(Fill(Material, "colour"));
  if (EmissionMap) {
    Look.emissiveMap = EmissionMap;
    Look.emissiveIntensity = Field("emission").Maximum * 0.12;
  } else Look.emissiveIntensity = +Fill(Material, "emission") * 0.12;
  // Opacity.
  const OpacityMap = await Map("opacity");
  Look.opacity = OpacityMap ? 1 : +Fill(Material, "opacity");
  if (OpacityMap) Look.alphaMap = OpacityMap;
  Look.transparent = !!OpacityMap || Look.opacity < 0.999;
  Look.alphaTest = OpacityMap ? 0.02 : 0;
  Look.side = Look.transparent || Look.transmission > 0 ? THREE.DoubleSide : THREE.FrontSide;
  // Orientation (normal) maps, occlusion and displacement.
  const NormalMap = await Map("normal");
  if (NormalMap) {
    NormalMap.colorSpace = THREE.NoColorSpace;
    Look.normalMap = NormalMap;
  }
  const CoatNormal = await Map("coatNormal");
  if (CoatNormal) {
    CoatNormal.colorSpace = THREE.NoColorSpace;
    Look.clearcoatNormalMap = CoatNormal;
  }
  const Occlusion = await Map("occlusion");
  if (Occlusion) Look.aoMap = Occlusion;
  else Look.aoMapIntensity = 1;
  Look.userData.occlusion = +Fill(Material, "occlusion");
  const Displacement = await Map("displacement");
  if (Displacement) {
    Look.displacementMap = Displacement;
    Look.displacementScale = Field("displacement").Maximum - Field("displacement").Minimum;
    Look.displacementBias = Field("displacement").Minimum;
  }
  // Unlit: the colour as it is.
  if (Material.Type === "Unlit") {
    const Flat = new THREE.MeshBasicMaterial({ color: Look.color, map: Look.map, transparent: Look.transparent, opacity: Look.opacity, alphaMap: Look.alphaMap });
    Look.dispose();
    return { Look: Flat, Made };
  }
  return { Look, Made };
}

// ── Preview shapes ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function ShaderBallGeometry() {
  const { Vertices, Indices, Count } = ReadMesh();
  const Position = new Float32Array(Count * 3), Normal = new Float32Array(Count * 3), Uv = new Float32Array(Count * 2);
  for (let At = 0; At < Count; At++) {
    const I = At * 8;
    // The mesh is z-up; the preview is y-up.
    Position.set([Vertices[I], Vertices[I + 2], -Vertices[I + 1]], At * 3);
    Normal.set([Vertices[I + 3], Vertices[I + 5], -Vertices[I + 4]], At * 3);
    Uv.set([Vertices[I + 6], Vertices[I + 7]], At * 2);
  }
  const Geometry = new THREE.BufferGeometry();
  Geometry.setAttribute("position", new THREE.BufferAttribute(Position, 3));
  Geometry.setAttribute("normal", new THREE.BufferAttribute(Normal, 3));
  Geometry.setAttribute("uv", new THREE.BufferAttribute(Uv, 2));
  Geometry.setIndex(new THREE.BufferAttribute(Indices, 1));
  Geometry.computeBoundingBox();
  const Box = Geometry.boundingBox, Span = Math.max(...Box.getSize(new THREE.Vector3()).toArray());
  Geometry.translate(-(Box.min.x + Box.max.x) / 2, -Box.min.y, -(Box.min.z + Box.max.z) / 2);
  Geometry.scale(1.3 / Span, 1.3 / Span, 1.3 / Span);
  return Geometry;
}
function RoundedCube(Side = 0.9, Round = 0.12, Steps = 24) {
  const Geometry = new THREE.BoxGeometry(Side, Side, Side, Steps, Steps, Steps);
  const P = Geometry.attributes.position, Inner = Side / 2 - Round, V = new THREE.Vector3(), C = new THREE.Vector3();
  for (let At = 0; At < P.count; At++) {
    V.fromBufferAttribute(P, At);
    C.set(Math.max(-Inner, Math.min(Inner, V.x)), Math.max(-Inner, Math.min(Inner, V.y)), Math.max(-Inner, Math.min(Inner, V.z)));
    V.sub(C).normalize().multiplyScalar(Round).add(C);
    P.setXYZ(At, V.x, V.y, V.z);
  }
  Geometry.computeVertexNormals();
  Geometry.translate(0, Side / 2, 0);
  return Geometry;
}
// A square of cloth dropped over a ball: the dome follows the ball to just past its equator, then the cloth hangs in folds that
// deepen as it falls, and whatever length is left when it reaches the plinth spreads out across it.
function DrapedCloth(Steps = 160) {
  const Geometry = new THREE.PlaneGeometry(2.3, 2.3, Steps, Steps);
  Geometry.rotateX(-Math.PI / 2);
  const P = Geometry.attributes.position, Radius = 0.5, Centre = 0.6, Floor = 0.045;
  const Over = Radius * 1.62; // arc length (from the top) where the cloth leaves the ball, about 93°
  const Leave = Over / Radius, R0 = Math.sin(Leave) * Radius, Y0 = Centre + Math.cos(Leave) * Radius;
  const Drop = Y0 - Floor;
  for (let At = 0; At < P.count; At++) {
    const X = P.getX(At), Z = P.getZ(At), Arc = Math.hypot(X, Z), Turn = Math.atan2(Z, X);
    let R, Y;
    if (Arc < Over) {
      const A = Arc / Radius;
      R = Math.sin(A) * Radius;
      Y = Centre + Math.cos(A) * Radius;
    } else {
      const Hang = Arc - Over;
      const Deep = Math.min(1, Hang / 0.35) ** 1.5;
      const Folds = (Math.sin(Turn * 7 + Math.sin(Turn * 2) * 1.2) * 0.6 + Math.sin(Turn * 12 + 1.7) * 0.25) * 0.055 * Deep;
      const Fall = Math.min(Hang, Drop), Pool = Math.max(0, Hang - Drop);
      R = R0 + Fall * 0.2 + Folds + Pool * 0.75;
      Y = Y0 - Fall + Math.min(Pool, 0.02) * 0.5;
    }
    P.setXYZ(At, Math.cos(Turn) * R, Math.max(Floor - 0.005, Y), Math.sin(Turn) * R);
  }
  Geometry.computeVertexNormals();
  return Geometry;
}
function Shape(Name) {
  if (Name === "Sphere") return new THREE.SphereGeometry(0.55, 128, 64).translate(0, 0.6, 0);
  if (Name === "Rounded cube") return RoundedCube().translate(0, 0.06, 0);
  if (Name === "Draped cloth") return DrapedCloth();
  return ShaderBallGeometry();
}

// ── The viewport ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export default function ShaderViewport({ Material, Eyebrow, Title, Note }) {
  const Host = useRef(null), Built = useRef(null);
  const [Shown, ShowShape] = useState("Shader ball"),
    [Studio, ChooseStudio] = useState("Studio softbox"),
    [Exposure, Expose] = useState(1),
    [Zoom, ReportZoom] = useState(100),
    [Full, ShowFull] = useState(false),
    [Status, Report] = useState("Preparing");
  // One renderer for the viewport's life.
  useEffect(() => {
    let View;
    try {
      const Canvas = document.createElement("canvas");
      Canvas.className = "sv-canvas";
      Canvas.tabIndex = 0;
      Canvas.setAttribute("aria-label", "Material preview viewport");
      Host.current.appendChild(Canvas);
      View = new Stage(Canvas, { background: "#1d1e21", grid: false, shadows: true });
      View.scene.background = null;
      View.renderer.setClearColor(0x000000, 0);
      View.renderer.toneMappingExposure = 1;
      View.ground.material.opacity = 0.45;
      const Reflections = StudioReflections(View.renderer);
      View.scene.environment = Reflections;
      // The plinth (dark, gently glossy, with a bevelled lip) the subject stands on.
      const Plinth = new THREE.Group();
      const Dark = new THREE.MeshPhysicalMaterial({ color: "#2a2b2e", roughness: 0.38, metalness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.25 });
      const Disc = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.82, 0.07, 96), Dark);
      Disc.position.y = -0.035;
      const Lip = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.012, 12, 128), new THREE.MeshStandardMaterial({ color: "#55575c", roughness: 0.3, metalness: 0.8 }));
      Lip.rotation.x = Math.PI / 2;
      Lip.position.y = -0.002;
      for (const Each of [Disc, Lip]) {
        Each.receiveShadow = true;
        Each.castShadow = true;
        Plinth.add(Each);
      }
      const Subject = new THREE.Mesh(Shape("Shader ball"), new THREE.MeshPhysicalMaterial());
      Subject.castShadow = Subject.receiveShadow = true;
      const Content = new THREE.Group();
      Content.add(Plinth, Subject);
      View.setContent(Content);
      View.sun.shadow.mapSize.set(1024, 1024);
      View.sun.shadow.bias = -0.0006;
      const Box = new THREE.Box3(new THREE.Vector3(-0.8, -0.05, -0.8), new THREE.Vector3(0.8, 1.3, 0.8));
      const Fit = (Animate = false) => View.frame(Box, { yaw: 32, pitch: 12, animate: Animate });
      View.resize();
      Fit();
      const Framed = () => View.rig.goal.distance;
      let Rest = 0;
      View.frameCallbacks.add(() => {
        if (!Rest) Rest = Framed();
        const Percent = Math.round((Rest / View.rig.distance) * 100);
        if (Built.current && Built.current.Percent !== Percent) {
          Built.current.Percent = Percent;
          ReportZoom(Percent);
        }
      });
      Built.current = { View, Subject, Reflections, Fit, Made: [], Percent: 100, Rest: () => (Rest = 0) };
    } catch (Problem) {
      Report("Preview unavailable · " + String(Problem?.message || Problem).slice(0, 80));
    }
    return () => {
      if (!View) return;
      View.resize = () => {};
      View.renderer.setAnimationLoop(null);
      View.setContent(null);
      for (const Each of Built.current?.Made || []) Each.dispose();
      Built.current?.Reflections?.dispose();
      View.renderer.dispose();
      View.renderer.forceContextLoss();
      View.canvas.remove();
      Built.current = null;
    };
  }, []);
  // The material.
  useEffect(() => {
    let Cancelled = false;
    const Timer = setTimeout(async () => {
      const Now = Built.current;
      if (!Now) return;
      try {
        const { Look, Made } = await PhysicalLook(Material);
        if (Cancelled || !Built.current) {
          Look.dispose();
          for (const Each of Made) Each.dispose();
          return;
        }
        const Old = Now.Subject.material;
        Now.Subject.material = Look;
        Old.dispose();
        for (const Each of Now.Made) Each.dispose();
        Now.Made = Made;
        Report("Live");
      } catch (Problem) {
        if (!Cancelled) Report("Preview error · " + String(Problem?.message || Problem).slice(0, 80));
      }
    }, 40);
    return () => {
      Cancelled = true;
      clearTimeout(Timer);
    };
  }, [Material]);
  // Shape, studio and exposure.
  useEffect(() => {
    const Now = Built.current;
    if (!Now) return;
    const Old = Now.Subject.geometry;
    Now.Subject.geometry = Shape(Shown);
    Old.dispose();
  }, [Shown]);
  useEffect(() => {
    const Now = Built.current;
    if (!Now) return;
    const Look = PreviewStudios[Studio];
    const Lights = Now.View.scene.children.filter((Each) => Each.isLight);
    Now.View.sun.color.set(Look.Key);
    const Rim = Lights.find((Each) => Each.isDirectionalLight && Each !== Now.View.sun);
    if (Rim) Rim.color.set(Look.Rim);
    const Sky = Lights.find((Each) => Each.isHemisphereLight);
    if (Sky) Sky.intensity = Look.Ambient * 1.6;
    Now.View.scene.environmentIntensity = Look.Ambient + 0.45;
  }, [Studio]);
  useEffect(() => {
    if (Built.current) Built.current.View.renderer.toneMappingExposure = Exposure;
  }, [Exposure]);
  useEffect(() => {
    const Now = Built.current;
    if (!Now) return;
    requestAnimationFrame(() => {
      Now.View.resize();
    });
  }, [Full]);
  const Background = PreviewStudios[Studio].Background;
  const ZoomBy = (Factor) => {
    const Now = Built.current;
    if (!Now) return;
    Now.View.rig.goal.distance = Math.max(0.5, Math.min(12, Now.View.rig.goal.distance * Factor));
  };
  return (
    <div
      className={"sv-viewport " + (Full ? "full" : "")}
      style={{ background: `radial-gradient(120% 90% at 50% 38%, ${Background[0]}, ${Background[1]} 75%)` }}
      data-preview-status={Status}
    >
      <div className="sv-host" ref={Host} />
      <div className="sv-top">
        <span className="sv-live">
          <i data-live={Status === "Live"} />
          LIVE PREVIEW <b>PBR</b>
        </span>
        <button className="sv-pill" onClick={() => ShowFull(!Full)} aria-pressed={Full}>
          {Full ? "Exit fullscreen" : "Fullscreen"}
        </button>
      </div>
      <div className="sv-title">
        <span>{Eyebrow}</span>
        <h2>{Title}</h2>
        <p>{Note}</p>
      </div>
      <div className="sv-zoom">
        <button aria-label="Zoom out" onClick={() => ZoomBy(1.15)}>
          −
        </button>
        <output aria-label="Zoom">{Zoom}%</output>
        <button aria-label="Zoom in" onClick={() => ZoomBy(1 / 1.15)}>
          +
        </button>
        <button
          className="sv-reset"
          onClick={() => {
            Built.current?.Fit(true);
          }}
        >
          Reset view
        </button>
      </div>
      <div className="sv-controls">
        <div className="sv-selects">
          <label className="sv-select">
            <select aria-label="Preview shape" value={Shown} onChange={(Event) => ShowShape(Event.target.value)}>
              {PreviewShapes.map((Name) => (
                <option key={Name}>{Name}</option>
              ))}
            </select>
          </label>
          <label className="sv-select">
            <select aria-label="Preview studio" value={Studio} onChange={(Event) => ChooseStudio(Event.target.value)}>
              {Object.keys(PreviewStudios).map((Name) => (
                <option key={Name}>{Name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="sv-exposure">
          <span>
            Exposure <output>{Exposure.toFixed(2)} ×</output>
          </span>
          <input
            aria-label="Preview exposure"
            type="range"
            min="0.25"
            max="2.5"
            step="0.05"
            value={Exposure}
            style={{ "--fill": ((Exposure - 0.25) / 2.25) * 100 + "%" }}
            onChange={(Event) => Expose(+Event.target.value)}
          />
        </div>
      </div>
      <div className="sv-foot">
        <span>Drag orbit / Shift-drag pan / Wheel zoom</span>
        <span>{Status === "Live" ? "WEBGL 2" : Status}</span>
      </div>
    </div>
  );
}
