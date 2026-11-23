//============================================================================================================================================
//                                                               BOUNDSURFACE.JS
//============================================================================================================================================
// 📐 The bound object's own surface as three.js geometry (Follow-up 75), for the ShaderEditor's preview ("the selected object" in the
// shape menu), the Texture paint and Baking tabs and the main viewport.
//   • By default an object draws as its three.js primitive (Viewport3D.jsx ShapeGeometry), with that primitive's own UVs.
//   • Once the UV tab's layout is in use (Values["Unwrapped UVs"]), the object draws through the UV tab's unwrap instead: the welded
//     surface the unwrap was made from, one corner per triangle with its packed UV, and normals smoothed only across edges whose faces
//     meet within the unwrap angle (so a cube keeps its hard edges and a sphere stays round). Those UVs never overlap, so it can be baked.
//   • ForPreview scales a copy to the plinth: its largest side becomes 1.15, centred, standing on it.

import * as THREE from "three";
import { ShapeGeometry } from "./Viewport3D.jsx";
import { UvLayoutOf } from "./Workspaces.jsx";
import { ShapeOf } from "./PrimitiveInspector.jsx";

export const LayoutKey = "Unwrapped UVs";
export const LayoutInUse = (Values) => !!(Values && Values[LayoutKey]);

// The unwrap as drawable geometry: positions, packed UVs and angle-limited smooth normals, one vertex per triangle corner.
export function UnwrapGeometry(Unwrap) {
  const { Mesh: Welded, Uvs, Angle } = Unwrap;
  const P = Welded.Positions, I = Welded.Indices, Triangles = I.length / 3;
  const Faces = new Float32Array(Triangles * 3), Around = new Map();
  for (let T = 0; T < Triangles; T++) {
    const [A, B, C] = [I[T * 3], I[T * 3 + 1], I[T * 3 + 2]];
    const Ux = P[B * 3] - P[A * 3], Uy = P[B * 3 + 1] - P[A * 3 + 1], Uz = P[B * 3 + 2] - P[A * 3 + 2];
    const Vx = P[C * 3] - P[A * 3], Vy = P[C * 3 + 1] - P[A * 3 + 1], Vz = P[C * 3 + 2] - P[A * 3 + 2];
    // Area-weighted (unnormalised) face normal.
    Faces.set([Uy * Vz - Uz * Vy, Uz * Vx - Ux * Vz, Ux * Vy - Uy * Vx], T * 3);
    for (const V of [A, B, C]) {
      if (!Around.has(V)) Around.set(V, []);
      Around.get(V).push(T);
    }
  }
  const Unit = (T) => {
    const L = Math.hypot(Faces[T * 3], Faces[T * 3 + 1], Faces[T * 3 + 2]) || 1;
    return [Faces[T * 3] / L, Faces[T * 3 + 1] / L, Faces[T * 3 + 2] / L];
  };
  const Limit = Math.cos((Math.min(89, Angle || 60) * Math.PI) / 180);
  const Position = new Float32Array(Triangles * 9), Normal = new Float32Array(Triangles * 9), Uv = new Float32Array(Triangles * 6);
  for (let T = 0; T < Triangles; T++) {
    const Own = Unit(T);
    for (let K = 0; K < 3; K++) {
      const V = I[T * 3 + K], Slot = T * 3 + K;
      Position.set([P[V * 3], P[V * 3 + 1], P[V * 3 + 2]], Slot * 3);
      let Nx = 0, Ny = 0, Nz = 0;
      for (const Other of Around.get(V)) {
        const N = Unit(Other);
        if (N[0] * Own[0] + N[1] * Own[1] + N[2] * Own[2] < Limit) continue;
        Nx += Faces[Other * 3];
        Ny += Faces[Other * 3 + 1];
        Nz += Faces[Other * 3 + 2];
      }
      const L = Math.hypot(Nx, Ny, Nz) || 1;
      Normal.set([Nx / L, Ny / L, Nz / L], Slot * 3);
      Uv.set([Uvs[T * 6 + K * 2], Uvs[T * 6 + K * 2 + 1]], Slot * 2);
    }
  }
  const Geometry = new THREE.BufferGeometry();
  Geometry.setAttribute("position", new THREE.BufferAttribute(Position, 3));
  Geometry.setAttribute("normal", new THREE.BufferAttribute(Normal, 3));
  Geometry.setAttribute("uv", new THREE.BufferAttribute(Uv, 2));
  return Geometry;
}

// The object's surface in its own metres (scale applied), centred as the main viewport centres it.
export function BoundGeometry(Subject, Values = {}) {
  if (LayoutInUse(Values)) return UnwrapGeometry(UvLayoutOf(Subject, Values));
  const { Geometry } = ShapeGeometry(ShapeOf(Subject), (Key) => Values[Key]);
  const Scale = Array.isArray(Values.Scale) ? Values.Scale.map((Each) => Math.abs(+Each) || 1) : [1, 1, 1];
  Geometry.scale(...Scale);
  return Geometry;
}

// A copy sized and placed for the ShaderEditor's plinth.
export function ForPreview(Geometry) {
  Geometry.computeBoundingBox();
  const Box = Geometry.boundingBox, Size = Box.getSize(new THREE.Vector3());
  const Span = Math.max(Size.x, Size.y, Size.z) || 1, Scale = 1.15 / Span;
  Geometry.translate(-(Box.min.x + Box.max.x) / 2, -Box.min.y, -(Box.min.z + Box.max.z) / 2);
  Geometry.scale(Scale, Scale, Scale);
  Geometry.computeBoundingBox();
  Geometry.computeBoundingSphere();
  return Geometry;
}

// Whether a geometry's UVs can be baked: inside the 0–1 tile and no two triangles covering the same texels (sampled on a grid).
export function OverlappingUvs(Geometry, Grid = 128) {
  const Uv = Geometry.attributes.uv;
  if (!Uv) return "it has no UVs";
  for (let At = 0; At < Uv.count; At++) {
    const U = Uv.getX(At), V = Uv.getY(At);
    if (U < -0.01 || U > 1.01 || V < -0.01 || V > 1.01) return "its UVs run outside the 0–1 tile";
  }
  const Cells = new Uint8Array(Grid * Grid), Index = Geometry.index, Count = Index ? Index.count : Uv.count;
  const Corner = (At) => (Index ? Index.getX(At) : At);
  let Clashes = 0, Covered = 0;
  for (let At = 0; At < Count; At += 3) {
    const A = Corner(At), B = Corner(At + 1), C = Corner(At + 2);
    const X = [Uv.getX(A), Uv.getX(B), Uv.getX(C)].map((Each) => Each * Grid), Y = [Uv.getY(A), Uv.getY(B), Uv.getY(C)].map((Each) => Each * Grid);
    const Area = (X[1] - X[0]) * (Y[2] - Y[0]) - (X[2] - X[0]) * (Y[1] - Y[0]);
    if (Math.abs(Area) < 1e-9) continue;
    for (let Gy = Math.max(0, Math.floor(Math.min(...Y))); Gy <= Math.min(Grid - 1, Math.floor(Math.max(...Y))); Gy++)
      for (let Gx = Math.max(0, Math.floor(Math.min(...X))); Gx <= Math.min(Grid - 1, Math.floor(Math.max(...X))); Gx++) {
        const Px = Gx + 0.5, Py = Gy + 0.5;
        const L1 = ((X[1] - Px) * (Y[2] - Py) - (X[2] - Px) * (Y[1] - Py)) / Area;
        const L2 = ((X[2] - Px) * (Y[0] - Py) - (X[0] - Px) * (Y[2] - Py)) / Area;
        if (L1 < 0 || L2 < 0 || L1 + L2 > 1) continue;
        if (Cells[Gy * Grid + Gx]) Clashes++;
        else Covered++;
        Cells[Gy * Grid + Gx] = 1;
      }
  }
  return Clashes > Math.max(8, Covered * 0.02) ? "its UV islands overlap" : null;
}
