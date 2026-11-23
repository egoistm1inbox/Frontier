//============================================================================================================================================
//                                                               LIGHTPROPS.JS
//============================================================================================================================================
// 💡 The Lighting folder's lights as props in the 3D viewport (Follow-up 63): each light is a fixture at its own position, aimed where its
// inspector aims it, with a real three.js light of its colour, strength, cone and reach, and an emitter face that glows in its colour.
//   • Spot light (Key Spot): a studio spot can with barn doors on a yoke; a SpotLight.
//   • Point light (Rim Point, Fill Point): a bare bulb in a socket; a PointLight.
//   • IES / automotive (ECE Low Beam): a projector headlamp unit; IES Downlight: a downlight can on a boom arm; both a SpotLight with
//     the field angle.
//   • Rect area light (Area Light, Softbox): a softbox of the light's width and height; a wide soft SpotLight from its face.
//   • Tube light (Studio Tube): a glowing tube of its length and radius in two clamps; a PointLight.
//   • LED emitter: a star board on a heat sink; LED strip: a lit channel of its length; both a wide SpotLight downward.
// Fixtures under 5.5 m stand on a C-stand; higher ones on a truss mast. Their properties are the light inspector's own (its defaults,
// the reference scene's presets and the light's saved properties: InspectorHost.js resolves them the same way). Candela-rated lights
// (spot, point) use their candela; lumen-rated ones are turned into candela over their beam and drawn at LumenScale, so their pools sit
// with the candela-rated ones in the viewport's sunlight. The Environment Light is the sky itself and has no prop. Browser authoring only.

import { THREE } from "../Shared/Studio/Render.js";
import { makeNode, flat, TYPES } from "./InspectorDepot/world.js";
import { LightDefaults, LightPresetDefaults, LightContextDefaults } from "./LightSpecification.js";
import { KelvinTint } from "./SkyShader.js";
import { StudioLit } from "./EditorAssets.js";
import { beam, glowSprite } from "../Shared/Studio/Visuals.js";

const Rad = Math.PI / 180;
export const LumenScale = 0.05;
const Presets = new Map(flat.map((Node) => [Node.name, Node.props]));
const LightTypes = new Set(["pointlight", "spotlight", "ieslight", "arealight", "tubelight", "ledlight", "ledstrip"]);

// A light row's type (the Area Light row has none of its own: it is a rect area light).
export const LightTypeOf = (Row) => (Row?.Panel === "light" ? Row.ReferenceType || "arealight" : null);

// A light's properties, resolved as the light inspector does: the type's defaults, the LED defaults, the preset's defaults, the reference
// scene's preset, then what was saved.
export function LightProperties(Row, Values = {}) {
  const Type = LightTypeOf(Row);
  const Preset = Row.ReferencePreset;
  const Props = TYPES[Type] ? structuredClone(makeNode(Row.Name, Type).props) : {};
  Object.assign(Props, structuredClone(LightDefaults[Type] || {}), structuredClone(LightPresetDefaults[Preset] || {}), structuredClone(Presets.get(Preset) || {}));
  if (!Props.pos) Props.pos = (LightContextDefaults[Preset]?.pos || [0, 2, 0]).slice();
  Object.assign(Props, Values.ReferenceInspector?.Properties || {});
  return Props;
}

// The lights to put up: every light row that isn't hidden (nor any folder above it).
export function LightPlacements(Rows, Values, HiddenUp) {
  return Rows.filter((Row) => LightTypes.has(LightTypeOf(Row)) && !HiddenUp(Row)).map((Row) => ({ Row, Type: LightTypeOf(Row), Props: LightProperties(Row, Values[Row.Id] || {}) }));
}

const Triple = (Value, Fallback) => (Array.isArray(Value) && Value.length === 3 && Value.every((Each) => Number.isFinite(+Each)) ? Value.map(Number) : Fallback);
const Amount = (Value, Fallback) => (Number.isFinite(+Value) && Value !== null && Value !== "" ? +Value : Fallback);
// Its colour: the authored colour, warmed or cooled by its colour temperature when it has one.
function ColourOf(Type, Props) {
  const Colour = new THREE.Color(/^#[\da-f]{6}$/i.test(Props.color || "") ? Props.color : "#ffffff");
  if (Props.temperature && Type !== "pointlight" && Type !== "spotlight") {
    const [R, G, B] = KelvinTint(+Props.temperature);
    Colour.multiply(new THREE.Color(R, G, B));
  }
  return Colour;
}
// Candela over a cone of the full angle (degrees), from lumens.
const ConeCandela = (Lumens, Angle) => Lumens / (2 * Math.PI * (1 - Math.cos((Math.min(Angle, 179) / 2) * Rad)));
// What it gives out: lumens (for the lumen-rated), the cone and the candela the viewport draws.
export function LightOutput(Type, Props) {
  switch (Type) {
    case "pointlight":
      return { Candela: Amount(Props.intensity, 14), Reach: Amount(Props.distance, 26), Cone: 360 };
    case "spotlight":
      return { Candela: Amount(Props.intensity, 62), Reach: 0, Cone: Amount(Props.angle, 26) };
    case "ieslight": {
      const Lumens = Amount(Props.lumens, 1650) * Amount(Props.multiplier, 1), Cone = Amount(Props.cone, 58);
      return { Lumens, Candela: ConeCandela(Lumens, Cone) * LumenScale, Reach: Amount(Props.range, 120), Cone };
    }
    case "arealight": {
      const Lumens = Amount(Props.lumens, 2400), Cone = Math.min(170, Amount(Props.spread, 120));
      return { Lumens, Candela: ConeCandela(Lumens, Cone) * LumenScale, Reach: 0, Cone };
    }
    case "tubelight": {
      const Lumens = Amount(Props.lumens, 1800);
      return { Lumens, Candela: (Lumens / (4 * Math.PI)) * LumenScale, Reach: Amount(Props.distance, 24), Cone: 360 };
    }
    case "ledlight": {
      const Lumens = Amount(Props.watts, 10) * Amount(Props.efficacy, 110) * Amount(Props.dimmer, 1), Cone = Math.min(170, Amount(Props.angle, 120));
      return { Lumens, Candela: ConeCandela(Lumens, Cone) * LumenScale, Reach: 0, Cone };
    }
    case "ledstrip": {
      const Lumens = Amount(Props.lumensPerMetre, 1000) * Amount(Props.length, 2.4) * Amount(Props.dimmer, 1);
      return { Lumens, Candela: ConeCandela(Lumens, 150) * LumenScale, Reach: 0, Cone: 150 };
    }
    default:
      return { Candela: 0, Reach: 0, Cone: 90 };
  }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   FIXTURE PARTS
//------------------------------------------------------------------------------------------------------------------------

const Finish = {
  Steel: () => new THREE.MeshStandardMaterial({ color: "#3a3d43", roughness: 0.42, metalness: 0.7 }),
  Black: () => new THREE.MeshStandardMaterial({ color: "#17181b", roughness: 0.55, metalness: 0.3 }),
  Chrome: () => new THREE.MeshStandardMaterial({ color: "#c9ccd1", roughness: 0.22, metalness: 0.9 }),
  Cloth: () => new THREE.MeshStandardMaterial({ color: "#1d1e22", roughness: 0.9, metalness: 0 }),
  Alloy: () => new THREE.MeshStandardMaterial({ color: "#9aa0a8", roughness: 0.35, metalness: 0.8 }),
};
const Part = (Shape, Material, At = [0, 0, 0], Turn = [0, 0, 0]) => {
  const Piece = new THREE.Mesh(Shape, Material);
  Piece.position.set(...At);
  Piece.rotation.set(...Turn);
  Piece.castShadow = true;
  return Piece;
};
// The emitter face: unlit, in the light's colour, brighter than white so it reads as a source.
const Glow = (Shape, Colour, Strength = 1) => {
  const Face = new THREE.Mesh(Shape, new THREE.MeshBasicMaterial({ color: Colour.clone().multiplyScalar(1.6 * Strength), toneMapped: false }));
  Face.userData.emitter = true;
  return Face;
};
// A rod from A to B.
function Rod(A, B, Radius, Material) {
  const From = new THREE.Vector3(...A), To = new THREE.Vector3(...B);
  const Length = From.distanceTo(To);
  const Piece = Part(new THREE.CylinderGeometry(Radius, Radius, Length, 10), Material);
  Piece.position.copy(From).add(To).multiplyScalar(0.5);
  Piece.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), To.clone().sub(From).normalize());
  return Piece;
}

// A C-stand from the ground up to Height: three splayed legs, the column and a knuckle at the top.
function CStand(Height) {
  const Stand = new THREE.Group();
  const Steel = Finish.Steel(), Black = Finish.Black();
  const Low = Math.min(0.55, Height * 0.4);
  for (let Leg = 0; Leg < 3; Leg++) {
    const Turn = (Leg / 3) * Math.PI * 2 + 0.4;
    Stand.add(Rod([0, Low, 0], [Math.cos(Turn) * 0.55, 0.02, Math.sin(Turn) * 0.55], 0.014, Steel));
    Stand.add(Part(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 10), Black, [Math.cos(Turn) * 0.55, 0.015, Math.sin(Turn) * 0.55]));
  }
  Stand.add(Rod([0, 0.02, 0], [0, Height, 0], 0.019, Steel));
  Stand.add(Part(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 12), Black, [0, Low, 0]));
  Stand.add(Part(new THREE.CylinderGeometry(0.028, 0.028, 0.08, 12), Black, [0, Height * 0.62, 0]));
  return Stand;
}
// A truss mast for fixtures hung high: a square base plate and a three-chord truss with its zigzag bracing.
function TrussMast(Height) {
  const Mast = new THREE.Group();
  const Alloy = Finish.Alloy();
  Mast.add(Part(new THREE.BoxGeometry(0.9, 0.04, 0.9), Finish.Black(), [0, 0.02, 0]));
  const Chords = [0, 1, 2].map((Index) => [Math.cos((Index / 3) * Math.PI * 2) * 0.15, Math.sin((Index / 3) * Math.PI * 2) * 0.15]);
  for (const [X, Z] of Chords) Mast.add(Rod([X, 0.04, Z], [X, Height, Z], 0.016, Alloy));
  const Step = 0.5;
  for (let Y = 0.04, Index = 0; Y + Step <= Height + 0.01; Y += Step, Index++) {
    const [A, B] = [Chords[Index % 3], Chords[(Index + 1) % 3]];
    Mast.add(Rod([A[0], Y, A[1]], [B[0], Y + Step, B[1]], 0.007, Alloy));
  }
  return Mast;
}
// The support for a fixture at Height: a C-stand, or a truss mast above 5.5 m.
const Support = (Height) => (Height > 5.5 ? TrussMast(Height) : CStand(Height));
// Where a light shining down is hung from: a boom arm off a stand BoomReach behind it, with a sandbag on the far end, so the stand
// stays clear of what it lights. Returns the stand and arm, reaching to (0, Height, 0).
export const BoomReach = 1.6;
function BoomStand(Height) {
  const Boom = new THREE.Group();
  const Stand = Support(Height);
  Stand.position.z = -BoomReach;
  Boom.add(Stand);
  const Steel = Finish.Steel(), Black = Finish.Black();
  Boom.add(Rod([0, Height, -BoomReach - 0.7], [0, Height, 0.02], 0.016, Steel));
  Boom.add(Part(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 12), Black, [0, Height, -BoomReach], [Math.PI / 2, 0, 0]));
  Boom.add(Part(new THREE.CapsuleGeometry(0.07, 0.16, 4, 10), Finish.Cloth(), [0, Height - 0.08, -BoomReach - 0.68]));
  return Boom;
}

// The fixture heads, each facing −z (toward where it shines) from its pivot at the origin.
function SpotHead(Colour, Cone) {
  const Head = new THREE.Group();
  const Black = Finish.Black(), Steel = Finish.Steel();
  Head.add(Part(new THREE.CylinderGeometry(0.17, 0.15, 0.38, 24, 1, true), Black, [0, 0, 0.02], [Math.PI / 2, 0, 0]));
  Head.add(Part(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 24), Black, [0, 0, 0.22], [Math.PI / 2, 0, 0]));
  Head.add(Part(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8), Steel, [0, 0.06, 0.3], [Math.PI / 2, 0, 0])); // handle
  const Lens = Glow(new THREE.CircleGeometry(0.155, 28), Colour, 1);
  Lens.position.z = -0.17;
  Lens.rotation.y = Math.PI;
  Head.add(Lens);
  // Barn doors, opened to the cone.
  const Open = Math.min(70, 25 + Cone) * Rad;
  for (const [Side, Turn] of [[[0, 0.17], [-Open, 0, 0]], [[0, -0.17], [Open, 0, 0]], [[0.17, 0], [0, Open, 0]], [[-0.17, 0], [0, -Open, 0]]]) {
    const Door = new THREE.Group();
    Door.position.set(Side[0], Side[1], -0.18);
    Door.rotation.set(...Turn);
    const Plate = Part(new THREE.BoxGeometry(Side[0] ? 0.008 : 0.3, Side[0] ? 0.3 : 0.008, 0.16), Black, [Side[0] ? Math.sign(Side[0]) * 0.004 : 0, Side[1] ? Math.sign(Side[1]) * 0.004 : 0, -0.08]);
    Door.add(Plate);
    Head.add(Door);
  }
  // The yoke round the can.
  const Yoke = new THREE.Group();
  Yoke.add(Rod([-0.21, 0, 0], [-0.21, -0.26, 0], 0.012, Steel), Rod([0.21, 0, 0], [0.21, -0.26, 0], 0.012, Steel), Rod([-0.21, -0.26, 0], [0.21, -0.26, 0], 0.012, Steel));
  return { Head, Yoke, Drop: 0.26 };
}
function BulbHead(Colour) {
  const Head = new THREE.Group();
  Head.add(Part(new THREE.CylinderGeometry(0.035, 0.045, 0.09, 16), Finish.Black(), [0, -0.1, 0]));
  Head.add(Part(new THREE.CylinderGeometry(0.03, 0.035, 0.04, 16), Finish.Chrome(), [0, -0.04, 0]));
  Head.add(Glow(new THREE.SphereGeometry(0.075, 24, 16), Colour, 1));
  return { Head, Yoke: null, Drop: 0.15 };
}
function HeadlampHead(Colour) {
  const Head = new THREE.Group();
  const Black = Finish.Black();
  Head.add(Part(new THREE.BoxGeometry(0.36, 0.17, 0.22), Black, [0, 0, 0.06]));
  Head.add(Part(new THREE.CylinderGeometry(0.065, 0.065, 0.08, 24), Finish.Chrome(), [-0.07, 0, -0.06], [Math.PI / 2, 0, 0]));
  const Lens = Glow(new THREE.CircleGeometry(0.058, 24), Colour, 1);
  Lens.position.set(-0.07, 0, -0.101);
  Lens.rotation.y = Math.PI;
  Head.add(Lens);
  const Light = Glow(new THREE.PlaneGeometry(0.11, 0.025), Colour, 0.8); // the daytime light bar
  Light.position.set(0.09, -0.035, -0.051);
  Light.rotation.y = Math.PI;
  Head.add(Light);
  return { Head, Yoke: null, Drop: 0.1 };
}
function DownlightHead(Colour) {
  const Head = new THREE.Group();
  // The can points down its own −z; the downlight hangs it facing the floor (the light's aim does that).
  Head.add(Part(new THREE.CylinderGeometry(0.11, 0.09, 0.16, 28, 1, true), Finish.Chrome(), [0, 0, 0.02], [Math.PI / 2, 0, 0]));
  Head.add(Part(new THREE.CylinderGeometry(0.12, 0.12, 0.012, 28), Finish.Black(), [0, 0, -0.06], [Math.PI / 2, 0, 0]));
  const Face = Glow(new THREE.CircleGeometry(0.085, 28), Colour, 1);
  Face.position.z = -0.067;
  Face.rotation.y = Math.PI;
  Head.add(Face);
  return { Head, Yoke: null, Drop: 0.12 };
}
function SoftboxHead(Colour, Width, Height) {
  const Head = new THREE.Group();
  const W = Math.max(0.2, Math.min(4, Width)), H = Math.max(0.2, Math.min(4, Height)), Depth = Math.min(0.55, 0.2 + Math.max(W, H) * 0.18);
  // The cloth: four tapering sides from the speed ring to the face.
  const Ring = 0.12;
  const Corners = (Size, Z) => [[-Size[0] / 2, -Size[1] / 2, Z], [Size[0] / 2, -Size[1] / 2, Z], [Size[0] / 2, Size[1] / 2, Z], [-Size[0] / 2, Size[1] / 2, Z]];
  const Back = Corners([Ring, Ring], Depth), Front = Corners([W, H], 0);
  const Points = [];
  for (let Side = 0; Side < 4; Side++) {
    const [A, B, C, D] = [Back[Side], Back[(Side + 1) % 4], Front[(Side + 1) % 4], Front[Side]];
    Points.push(...A, ...B, ...C, ...A, ...C, ...D);
  }
  const Cloth = new THREE.BufferGeometry();
  Cloth.setAttribute("position", new THREE.Float32BufferAttribute(Points, 3));
  Cloth.computeVertexNormals();
  const Sides = Part(Cloth, Finish.Cloth());
  Sides.userData.twoSided = true;
  Head.add(Sides);
  Head.add(Part(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 16), Finish.Black(), [0, 0, Depth + 0.02], [Math.PI / 2, 0, 0]));
  const Face = Glow(new THREE.PlaneGeometry(W * 0.98, H * 0.98), Colour, 0.9);
  Face.rotation.y = Math.PI;
  Face.position.z = -0.002;
  Head.add(Face);
  // A thin black rim round the face.
  const Edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(W, H)), new THREE.LineBasicMaterial({ color: "#0b0b0c" }));
  Head.add(Edge);
  const Yoke = new THREE.Group();
  Yoke.add(Rod([0, 0, Depth], [0, -Math.min(0.35, H / 2 + 0.1), Depth], 0.015, Finish.Steel()));
  return { Head, Yoke, Drop: Math.min(0.35, H / 2 + 0.1) };
}
function TubeHead(Colour, Length, Radius) {
  const Head = new THREE.Group();
  const L = Math.max(0.2, Math.min(6, Length)), R = Math.max(0.012, Math.min(0.2, Radius));
  const Tube = Glow(new THREE.CylinderGeometry(R, R, L, 18), Colour, 1);
  Tube.rotation.z = Math.PI / 2;
  Head.add(Tube);
  for (const End of [-1, 1]) Head.add(Part(new THREE.CylinderGeometry(R * 1.25, R * 1.25, 0.05, 16), Finish.Black(), [End * (L / 2 + 0.02), 0, 0], [0, 0, Math.PI / 2]));
  // Two clamps to a cross bar on the stand.
  const Steel = Finish.Steel();
  Head.add(Rod([-L * 0.3, 0, 0], [-L * 0.3, -0.12, 0], 0.01, Steel), Rod([L * 0.3, 0, 0], [L * 0.3, -0.12, 0], 0.01, Steel), Rod([-L * 0.3, -0.12, 0], [L * 0.3, -0.12, 0], 0.012, Steel));
  return { Head, Yoke: null, Drop: 0.12 };
}
function LedHead(Colour) {
  const Head = new THREE.Group();
  // Heat sink fins behind a hexagonal star board, the emitter at its middle (facing −z).
  for (let Fin = -3; Fin <= 3; Fin++) Head.add(Part(new THREE.BoxGeometry(0.012, 0.13, 0.07), Finish.Alloy(), [Fin * 0.02, 0, 0.05]));
  Head.add(Part(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 6), new THREE.MeshStandardMaterial({ color: "#d8dadf", roughness: 0.3, metalness: 0.6 }), [0, 0, 0.008], [Math.PI / 2, 0, 0]));
  const Dome = Glow(new THREE.SphereGeometry(0.022, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), Colour, 1.2);
  Dome.rotation.x = -Math.PI / 2;
  Head.add(Dome);
  return { Head, Yoke: null, Drop: 0.09 };
}
function StripHead(Colour, Length) {
  const Head = new THREE.Group();
  const L = Math.max(0.2, Math.min(8, Length));
  // The aluminium channel (open to −z) with its diffuser-lit strip, and end caps.
  Head.add(Part(new THREE.BoxGeometry(L, 0.03, 0.022), Finish.Alloy(), [0, 0, 0.01]));
  const Strip = Glow(new THREE.PlaneGeometry(L * 0.99, 0.016), Colour, 1);
  Strip.rotation.y = Math.PI;
  Strip.position.z = -0.002;
  Head.add(Strip);
  for (const End of [-1, 1]) Head.add(Part(new THREE.BoxGeometry(0.01, 0.034, 0.026), Finish.Black(), [End * (L / 2 + 0.005), 0, 0.01]));
  const Steel = Finish.Steel();
  // Hangers behind the channel (up, once the strip faces the floor) to a bar.
  Head.add(Rod([-L * 0.35, 0, 0.02], [-L * 0.35, 0, 0.12], 0.008, Steel), Rod([L * 0.35, 0, 0.02], [L * 0.35, 0, 0.12], 0.008, Steel), Rod([-L * 0.35, 0, 0.12], [L * 0.35, 0, 0.12], 0.01, Steel));
  return { Head, Yoke: null, Drop: 0.12 };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE PROP
//------------------------------------------------------------------------------------------------------------------------

// Where it shines: toward its target, or for rotation-set lights (tube, LED) along its rotation from straight down.
function AimOf(Type, Props, At) {
  if (Array.isArray(Props.target)) return new THREE.Vector3(...Triple(Props.target, [At[0], 0, At[2]]));
  if (Type === "ledlight" || Type === "ledstrip" || Type === "tubelight") {
    const Rotation = Triple(Props.rot, [0, 0, 0]);
    const Down = new THREE.Vector3(0, -1, 0).applyEuler(new THREE.Euler(Rotation[0] * Rad, Rotation[1] * Rad, Rotation[2] * Rad));
    return new THREE.Vector3(...At).add(Down);
  }
  return new THREE.Vector3(At[0], 0, At[2]);
}

// One light's prop: { Group (the fixture on its support with its light), Light, Output }. The group stands at the light's position on the
// ground under it; the head sits at the authored position (the light's own place) and turns to its aim.
export function LightProp(Type, Props) {
  const At = Triple(Props.pos, [0, 2, 0]);
  const Height = Math.max(0.2, At[1]);
  const Colour = ColourOf(Type, Props);
  const Output = LightOutput(Type, Props);
  const Built =
    Type === "spotlight" ? SpotHead(Colour, Output.Cone)
      : Type === "pointlight" ? BulbHead(Colour)
        : Type === "ieslight" ? (/down/i.test(Props.profile || "") ? DownlightHead(Colour) : HeadlampHead(Colour))
          : Type === "arealight" ? SoftboxHead(Colour, Amount(Props.width, 2), Amount(Props.height, 1))
            : Type === "tubelight" ? TubeHead(Colour, Amount(Props.length, 1.5), Amount(Props.radius, 0.04))
              : Type === "ledlight" ? LedHead(Colour)
                : StripHead(Colour, Amount(Props.length, 2.4));
  const Group = new THREE.Group();
  Group.position.set(At[0], 0, At[2]);
  const Aim = AimOf(Type, Props, At);
  const Toward = Aim.clone().sub(new THREE.Vector3(...At));
  if (Toward.lengthSq() < 1e-6) Toward.set(0, -1, 0);
  Toward.normalize();
  // The support: a stand reaching to just under the head, or for a light shining down (not a bare bulb or a tube) a boom arm over it.
  const Hung = Toward.y < -0.8 && Type !== "pointlight" && Type !== "tubelight";
  if (Hung) {
    const Arm = Height + 0.12 + (Type === "ledstrip" ? 0.02 : 0);
    Group.add(BoomStand(Arm));
    Group.add(Rod([0, Arm, 0], [0, Height + (Type === "ledstrip" ? 0.14 : 0.04), 0], 0.01, Finish.Steel()));
  } else Group.add(Support(Math.max(0.1, Height - Built.Drop)));
  // The head: turns to its aim about the vertical (on the stand's knuckle), then tips.
  const Pivot = new THREE.Group();
  Pivot.position.set(0, Height, 0);
  Group.add(Pivot);
  const Pan = new THREE.Group();
  Pan.rotation.y = Math.atan2(-Toward.x, -Toward.z);
  Pivot.add(Pan);
  if (Built.Yoke && !Hung) Pan.add(Built.Yoke);
  const Tilt = new THREE.Group();
  Tilt.rotation.x = Math.asin(Math.max(-1, Math.min(1, Toward.y)));
  Pan.add(Tilt);
  // Tubes and strips lie along their own rotation instead of tipping toward an aim.
  if (Type === "tubelight" || Type === "ledstrip") {
    const Rotation = Triple(Props.rot, [0, 0, 0]);
    Pan.rotation.set(0, 0, 0);
    Tilt.rotation.set(Rotation[0] * Rad, Rotation[1] * Rad, Rotation[2] * Rad);
    if (Type === "ledstrip") Tilt.rotateX(-Math.PI / 2); // the lit face toward the floor
  }
  Tilt.add(Built.Head);
  // The fixture reads in any light (the cameras' studio look); the emitter faces keep their glow.
  const Emitters = [];
  Built.Head.traverse((Each) => Each.userData.emitter && Emitters.push([Each, Each.material]));
  StudioLit(Group);
  for (const [Each, Material] of Emitters) Each.material = Material;
  Group.traverse((Each) => Each.userData.twoSided && (Each.material.side = THREE.DoubleSide));
  // The light itself, from the head's face toward the aim.
  const Strength = Math.max(0, Output.Candela);
  let Light;
  if (Output.Cone >= 360) {
    Light = new THREE.PointLight(Colour, Strength, Output.Reach, Amount(Props.decay, 2));
    Light.position.set(0, Height, 0);
    Group.add(Light);
  } else {
    Light = new THREE.SpotLight(Colour, Strength, Output.Reach, Math.min(89, Output.Cone / 2) * Rad, Type === "spotlight" ? Amount(Props.penumbra, 0.42) : 0.85, 2);
    Light.position.set(0, Height, 0);
    Light.target.position.copy(Aim).sub(Group.position);
    Group.add(Light, Light.target);
  }
  // Shadows (when the light casts them) for the spot and IES lights only: each is another depth pass, and the sun has one already.
  const Shadows = Props.shadows === true && Light.isSpotLight && (Type === "spotlight" || Type === "ieslight");
  Light.castShadow = Shadows;
  if (Shadows) {
    Light.shadow.mapSize.set(512, 512);
    Light.shadow.bias = -0.0004;
  }
  // A soft glow round the emitter, and for spot and IES lights (with Draw cone / Draw distribution on) their beam out to the aim, up to
  // 4 m (both drawn as aids: they can't be clicked and don't block the sun's flare).
  const Halo = glowSprite(Colour, Type === "arealight" ? 1.6 : Type === "tubelight" || Type === "ledstrip" ? 1.1 : 0.7, 0.55);
  Halo.position.set(0, Height, 0);
  Group.add(Halo);
  if ((Type === "spotlight" && Props.showCone !== false) || (Type === "ieslight" && Props.showDistribution !== false)) {
    const Length = Math.min(4, Math.max(0.5, Aim.distanceTo(new THREE.Vector3(...At))));
    const Shaft = beam({ length: Length, radius: Length * Math.tan(Math.min(80, Output.Cone / 2) * Rad), color: Colour, strength: 0.16 });
    Shaft.rotation.y = Math.PI / 2;
    Shaft.position.z = Type === "spotlight" ? -0.17 : -0.1;
    Built.Head.add(Shaft);
  }
  // A large invisible target round the head, so the prop is easy to click.
  const Grab = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
  Grab.position.set(0, Height, 0);
  Grab.userData.grab = true; // the viewport tries these first, so a lamp head picks its light even with another prop's stand or canopy in front
  Group.add(Grab);
  Group.userData.light = { Type, Candela: +Strength.toFixed(2), Cone: Output.Cone, Lumens: Output.Lumens, Height, Hung };
  return { Group, Light, Output };
}
