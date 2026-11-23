// Follow-up 69: a weather-station anemometer for the viewport. A graphite mast on a splayed tripod carries a data logger with a live
// screen, a solar panel, and a crossarm with a three-cup rotor at one end and a wind vane at the other; a red beacon caps the mast.
// The rotor and vane are driven from WindSample.js at the cups' own position and height (Viewport3D.jsx), so the instrument
// measures the wind field where it stands. Units are metres; y is up; the vane's nose points where the wind comes from.
import { THREE } from "../Shared/Studio/Render.js";

export const CupHeight = 2.05; // the cups' centre, the height the wind is sampled at
const ArmReach = 0.16;

const Look = (Colour, Rough = 0.4, Metal = 0, More = {}) => new THREE.MeshPhysicalMaterial({ color: Colour, roughness: Rough, metalness: Metal, ...More });

export function AnemometerAsset() {
  const Root = new THREE.Group();
  Root.name = "Anemometer";
  const Charcoal = Look("#2f3237", 0.32, 0.75);
  const Alloy = Look("#c9ccd1", 0.25, 0.9);
  const White = Look("#eef0f2", 0.45, 0, { clearcoat: 0.5, clearcoatRoughness: 0.3 });
  const Orange = Look("#ff6a1f", 0.3, 0, { clearcoat: 1, clearcoatRoughness: 0.12 });
  const Rubber = Look("#141518", 0.8, 0);
  const Add = (Into, Geometry, Material, [X, Y, Z] = [0, 0, 0], [RX, RY, RZ] = [0, 0, 0]) => {
    const Part = new THREE.Mesh(Geometry, Material);
    Part.position.set(X, Y, Z);
    Part.rotation.set(RX, RY, RZ);
    Part.castShadow = true;
    Part.receiveShadow = true;
    Into.add(Part);
    return Part;
  };
  // Tripod: three legs from a collar on the mast out to rubber feet.
  const Collar = 0.62, Spread = 0.6;
  Add(Root, new THREE.CylinderGeometry(0.036, 0.036, 0.08, 20), Charcoal, [0, Collar, 0]);
  for (let Leg = 0; Leg < 3; Leg++) {
    const Turn = (Leg / 3) * Math.PI * 2 + 0.3;
    const Foot = new THREE.Vector3(Math.cos(Turn) * Spread, 0.02, Math.sin(Turn) * Spread);
    const Top = new THREE.Vector3(Math.cos(Turn) * 0.035, Collar, Math.sin(Turn) * 0.035);
    const Length = Foot.distanceTo(Top);
    const Part = Add(Root, new THREE.CylinderGeometry(0.013, 0.016, Length, 12), Alloy);
    Part.position.copy(Foot).add(Top).multiplyScalar(0.5);
    Part.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), Top.clone().sub(Foot).normalize());
    Add(Root, new THREE.CylinderGeometry(0.03, 0.034, 0.03, 16), Rubber, [Foot.x, 0.015, Foot.z]);
  }
  // Mast.
  Add(Root, new THREE.CylinderGeometry(0.022, 0.026, 1.9, 20), Charcoal, [0, 0.95, 0]);
  // Data logger with a live screen (a canvas the viewport redraws).
  const Logger = new THREE.Group();
  Logger.position.set(0, 1.02, 0.07);
  Root.add(Logger);
  Add(Logger, new THREE.BoxGeometry(0.17, 0.23, 0.085), White);
  Add(Logger, new THREE.BoxGeometry(0.03, 0.06, 0.05), Charcoal, [0, 0, -0.06]);
  const Screen = document.createElement("canvas");
  Screen.width = 256;
  Screen.height = 160;
  const ScreenTexture = new THREE.CanvasTexture(Screen);
  ScreenTexture.colorSpace = THREE.SRGBColorSpace;
  const Display = Add(
    Logger,
    new THREE.PlaneGeometry(0.135, 0.085),
    new THREE.MeshBasicMaterial({ map: ScreenTexture, toneMapped: false }),
    [0, 0.045, 0.0431],
  );
  Display.castShadow = false;
  const Led = Add(Logger, new THREE.SphereGeometry(0.006, 10, 8), new THREE.MeshBasicMaterial({ color: "#3dff8e", toneMapped: false }), [0.06, -0.085, 0.043]);
  Led.castShadow = false;
  for (let Gland = 0; Gland < 3; Gland++) Add(Logger, new THREE.CylinderGeometry(0.008, 0.008, 0.02, 10), Rubber, [-0.04 + Gland * 0.04, -0.125, 0]);
  // Solar panel, tilted to the sky.
  const Solar = new THREE.Group();
  Solar.position.set(0, 1.42, -0.09);
  Solar.rotation.x = -0.75;
  Root.add(Solar);
  Add(Solar, new THREE.BoxGeometry(0.3, 0.012, 0.22), Alloy);
  const CellImage = document.createElement("canvas");
  CellImage.width = 120;
  CellImage.height = 88;
  const Cells = CellImage.getContext("2d");
  Cells.fillStyle = "#14234a";
  Cells.fillRect(0, 0, 120, 88);
  Cells.strokeStyle = "#5a73b8";
  Cells.lineWidth = 1;
  for (let X = 0; X <= 120; X += 20) Cells.strokeRect(X + 1, 1, 18, 86);
  for (let Y = 0; Y <= 88; Y += 22) {
    Cells.beginPath();
    Cells.moveTo(0, Y + 0.5);
    Cells.lineTo(120, Y + 0.5);
    Cells.stroke();
  }
  const CellTexture = new THREE.CanvasTexture(CellImage);
  CellTexture.colorSpace = THREE.SRGBColorSpace;
  Add(Solar, new THREE.PlaneGeometry(0.28, 0.2), Look("#ffffff", 0.15, 0.2, { map: CellTexture, clearcoat: 1, clearcoatRoughness: 0.05 }), [0, 0.0065, 0], [-Math.PI / 2, 0, 0]);
  Add(Root, new THREE.CylinderGeometry(0.008, 0.008, 0.12, 8), Alloy, [0, 1.42, -0.04], [Math.PI / 2, 0, 0]);
  // Crossarm.
  const ArmY = 1.86;
  Add(Root, new THREE.BoxGeometry(0.9, 0.028, 0.028), Alloy, [0, ArmY, 0]);
  Add(Root, new THREE.BoxGeometry(0.07, 0.07, 0.05), Charcoal, [0, ArmY, 0]);
  // Cup rotor on the arm's east end.
  const RotorAt = new THREE.Vector3(0.42, ArmY, 0);
  Add(Root, new THREE.CylinderGeometry(0.018, 0.022, 0.16, 16), White, [RotorAt.x, ArmY + 0.08, 0]);
  const Rotor = new THREE.Group();
  Rotor.position.set(RotorAt.x, CupHeight, 0);
  Root.add(Rotor);
  Add(Rotor, new THREE.CylinderGeometry(0.024, 0.03, 0.05, 20), White);
  Add(Rotor, new THREE.SphereGeometry(0.024, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), White, [0, 0.025, 0]);
  const Cup = new THREE.SphereGeometry(0.058, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  for (let Arm = 0; Arm < 3; Arm++) {
    const Turn = (Arm / 3) * Math.PI * 2;
    const Spoke = Add(Rotor, new THREE.CylinderGeometry(0.0045, 0.0045, ArmReach, 8), Alloy, [Math.cos(Turn) * ArmReach * 0.5, 0, Math.sin(Turn) * ArmReach * 0.5], [0, -Turn, Math.PI / 2]);
    Spoke.castShadow = true;
    // The cup's open side faces along the rotation, so the rotor turns anticlockwise seen from above.
    const Holder = new THREE.Group();
    Holder.position.set(Math.cos(Turn) * ArmReach, 0, Math.sin(Turn) * ArmReach);
    Holder.rotation.y = -Turn;
    Rotor.add(Holder);
    const Bowl = Add(Holder, Cup, Orange, [0, 0, 0], [-Math.PI / 2, 0, 0]);
    Bowl.material = Orange;
    Add(Holder, new THREE.TorusGeometry(0.058, 0.004, 8, 28), White, [0, 0, 0]);
  }
  // Wind vane on the arm's west end: nose (and counterweight) into the wind, tail fin downwind.
  const VaneAt = new THREE.Vector3(-0.42, ArmY, 0);
  Add(Root, new THREE.CylinderGeometry(0.018, 0.022, 0.12, 16), White, [VaneAt.x, ArmY + 0.06, 0]);
  const Vane = new THREE.Group();
  Vane.position.set(VaneAt.x, ArmY + 0.135, 0);
  Root.add(Vane);
  Add(Vane, new THREE.CylinderGeometry(0.02, 0.02, 0.03, 16), Charcoal);
  Add(Vane, new THREE.CylinderGeometry(0.005, 0.005, 0.42, 8), Alloy, [0, 0, -0.06], [Math.PI / 2, 0, 0]);
  Add(Vane, new THREE.ConeGeometry(0.02, 0.07, 16), Orange, [0, 0, 0.18], [Math.PI / 2, 0, 0]);
  const Fin = new THREE.Shape();
  Fin.moveTo(0, -0.02);
  Fin.lineTo(-0.2, -0.05);
  Fin.lineTo(-0.22, 0.08);
  Fin.lineTo(-0.02, 0.03);
  Fin.closePath();
  Add(Vane, new THREE.ExtrudeGeometry(Fin, { depth: 0.004, bevelEnabled: false }).translate(0, 0, -0.002), White, [0, 0, -0.08], [0, -Math.PI / 2, 0]);
  // Beacon.
  Add(Root, new THREE.CylinderGeometry(0.03, 0.03, 0.02, 16), Charcoal, [0, 1.91, 0]);
  const Beacon = Add(Root, new THREE.SphereGeometry(0.026, 16, 10), new THREE.MeshBasicMaterial({ color: "#ff3b30", toneMapped: false }), [0, 1.94, 0]);
  Beacon.castShadow = false;
  Root.userData.instrument = { Rotor, Vane, Screen, ScreenTexture, Led, Beacon };
  return Root;
}

// Redraw the logger's screen: speed, direction and the Beaufort force.
export function PaintScreen(Instrument, { Speed, From, Cardinal, Force, Gust }) {
  const Brush = Instrument.Screen.getContext("2d");
  const W = Instrument.Screen.width, H = Instrument.Screen.height;
  const Back = Brush.createLinearGradient(0, 0, 0, H);
  Back.addColorStop(0, "#07131a");
  Back.addColorStop(1, "#0b1f27");
  Brush.fillStyle = Back;
  Brush.fillRect(0, 0, W, H);
  Brush.fillStyle = "#4fe3ff";
  Brush.font = "600 64px 'DM Sans', system-ui, sans-serif";
  Brush.textBaseline = "alphabetic";
  Brush.fillText(Speed.toFixed(1), 14, 82);
  const Wide = Brush.measureText(Speed.toFixed(1)).width;
  Brush.font = "500 22px 'DM Sans', system-ui, sans-serif";
  Brush.fillStyle = "#8fd8e8";
  Brush.fillText("m/s", 14 + Wide + 8, 82);
  Brush.fillStyle = "#c8f6ff";
  Brush.font = "500 24px 'DM Sans', system-ui, sans-serif";
  Brush.fillText(`${Cardinal} ${Math.round(From)}°`, 14, 124);
  Brush.fillStyle = "#6ab7c7";
  Brush.font = "500 18px 'DM Sans', system-ui, sans-serif";
  Brush.fillText(`F${Force} · gust ${Gust.toFixed(1)}`, 14, 150);
  // A little arrow showing where the wind comes from.
  Brush.save();
  Brush.translate(W - 44, 44);
  Brush.rotate((From * Math.PI) / 180);
  Brush.strokeStyle = "#4fe3ff";
  Brush.lineWidth = 4;
  Brush.beginPath();
  Brush.arc(0, 0, 28, 0, Math.PI * 2);
  Brush.globalAlpha = 0.35;
  Brush.stroke();
  Brush.globalAlpha = 1;
  Brush.beginPath();
  Brush.moveTo(0, -24);
  Brush.lineTo(9, 6);
  Brush.lineTo(0, 0);
  Brush.lineTo(-9, 6);
  Brush.closePath();
  Brush.fillStyle = "#4fe3ff";
  Brush.fill();
  Brush.restore();
  Instrument.ScreenTexture.needsUpdate = true;
}
