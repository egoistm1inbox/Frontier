// Follow-up 66: the debug marks shared by the scene viewport and the Component Viewer: the centre of mass (the usual checkered,
// quartered ball with a ring) and the centroid (a hollow diamond at the middle of the bounds), and the sums behind them.
import { THREE } from "../Shared/Studio/Render.js";
import { glowSprite, markDebug } from "../Shared/Studio/Visuals.js";

// The checkered centre-of-mass ball.
let Checker = null;
export function ComMark(Radius, Colour, Glow) {
  if (!Checker) {
    const Paper = document.createElement("canvas");
    Paper.width = Paper.height = 64;
    const Brush = Paper.getContext("2d");
    Brush.fillStyle = "#f2f2f2";
    Brush.fillRect(0, 0, 64, 64);
    Brush.fillStyle = "#16171b";
    Brush.fillRect(0, 0, 16, 32);
    Brush.fillRect(32, 0, 16, 32);
    Brush.fillRect(16, 32, 16, 32);
    Brush.fillRect(48, 32, 16, 32);
    Checker = new THREE.CanvasTexture(Paper);
    Checker.colorSpace = THREE.SRGBColorSpace;
  }
  const Mark = new THREE.Group();
  Mark.add(new THREE.Mesh(new THREE.SphereGeometry(Radius, 24, 16), new THREE.MeshBasicMaterial({ map: Checker })));
  const Ring = new THREE.Mesh(new THREE.TorusGeometry(Radius * 1.25, Radius * 0.12, 8, 40), new THREE.MeshBasicMaterial({ color: Colour }));
  Ring.rotation.x = Math.PI / 2;
  Mark.add(Ring);
  if (Glow) Mark.add(glowSprite(Colour, Radius * 7, 0.55));
  return markDebug(Mark);
}

// The centroid: a hollow diamond (an octahedron's edges) with a small solid core, so it never hides the centre-of-mass ball.
export function CentroidMark(Radius, Colour) {
  const Mark = new THREE.Group();
  const Edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.OctahedronGeometry(Radius * 1.6)),
    new THREE.LineBasicMaterial({ color: Colour, transparent: true, opacity: 0.95 }),
  );
  Mark.add(Edges);
  Mark.add(new THREE.Mesh(new THREE.OctahedronGeometry(Radius * 0.35), new THREE.MeshBasicMaterial({ color: Colour })));
  return markDebug(Mark);
}

// Draw a mark over everything (its own pass: no depth test, last in order).
export function OverAll(Mark) {
  Mark.traverse((Each) => {
    if (!Each.material) return;
    Each.material.depthTest = false;
    Each.material.depthWrite = false;
    Each.material.transparent = true;
    Each.renderOrder = 20;
  });
  return Mark;
}

// The solid parts of an object: its visible meshes that aren't debug marks, light beams, glows or invisible click targets.
export function SolidParts(Root) {
  const Parts = [];
  Root.traverse((Part) => {
    if (!Part.isMesh || Part.userData.debug || Part.userData.outline) return;
    const Material = Array.isArray(Part.material) ? Part.material[0] : Part.material;
    if (!Material || Material.visible === false || Material.blending === THREE.AdditiveBlending) return;
    for (let Up = Part; Up && Up !== Root.parent; Up = Up.parent) if (Up.visible === false) return;
    Parts.push(Part);
  });
  return Parts;
}

// Centre of mass, in world space, for uniform density: each closed part's signed-tetrahedron volume centroid, weighed by its volume;
// a part that does not close (a card, a lamp's shade) counts as a thin sheet (its area centroid, weighed by area × 1 cm).
const Corner = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
export function MassCentreOf(Root) {
  Root.updateMatrixWorld(true);
  const Sum = new THREE.Vector3();
  let Weight = 0;
  for (const Part of SolidParts(Root)) {
    const Shape = Part.geometry;
    const Points = Shape?.attributes?.position;
    if (!Points) continue;
    const Index = Shape.index;
    const Count = Index ? Index.count : Points.count;
    let Volume = 0, Area = 0;
    const ByVolume = new THREE.Vector3(), ByArea = new THREE.Vector3(), Box = new THREE.Box3();
    for (let At = 0; At + 2 < Count; At += 3) {
      for (let K = 0; K < 3; K++) {
        Corner[K].fromBufferAttribute(Points, Index ? Index.getX(At + K) : At + K).applyMatrix4(Part.matrixWorld);
        Box.expandByPoint(Corner[K]);
      }
      const [A, B, C] = Corner;
      const Signed = A.dot(new THREE.Vector3().crossVectors(B, C)) / 6;
      Volume += Signed;
      ByVolume.addScaledVector(new THREE.Vector3().add(A).add(B).add(C), Signed / 4);
      const Piece = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(B, A), new THREE.Vector3().subVectors(C, A)).length() / 2;
      Area += Piece;
      ByArea.addScaledVector(new THREE.Vector3().add(A).add(B).add(C), Piece / 3);
    }
    const Size = Box.getSize(new THREE.Vector3());
    const Closed = Math.abs(Volume) > Math.max(1e-9, Size.x * Size.y * Size.z * 0.02);
    if (Closed) {
      Sum.addScaledVector(ByVolume.divideScalar(Volume), Math.abs(Volume));
      Weight += Math.abs(Volume);
    } else if (Area > 0) {
      Sum.addScaledVector(ByArea.divideScalar(Area), Area * 0.01);
      Weight += Area * 0.01;
    }
  }
  return Weight > 0 ? Sum.divideScalar(Weight) : null;
}

// Centroid, in world space: the middle of the solid parts' bounds.
export function CentroidOf(Root) {
  Root.updateMatrixWorld(true);
  const Box = new THREE.Box3();
  for (const Part of SolidParts(Root)) Box.union(new THREE.Box3().setFromObject(Part));
  return Box.isEmpty() ? null : { Centre: Box.getCenter(new THREE.Vector3()), Size: Box.getSize(new THREE.Vector3()) };
}
