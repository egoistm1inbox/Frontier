/*==========================================================================================================================================
                                                          TOPOLOGYSURFACE.JS
==========================================================================================================================================*/
// Editable 3D polygon surface with welded UV topology, seam tracking, island extraction, distortion/overlap telemetry,
// Blender-parity topology mutations (Split, Stitch, Weld, Pin, Seam), and Wavefront .obj import/export.

export function EdgeKey(VertexA, VertexB)
{
    return VertexA < VertexB ? `${VertexA}:${VertexB}` : `${VertexB}:${VertexA}`;
}

export function UdimFromUV(U, V)
{
    const TileU = Math.floor(U + 1e-6);
    const TileV = Math.floor(V + 1e-6);
    if (TileU < 0 || TileU > 9 || TileV < 0 || TileV > 99) return null;
    return 1001 + TileU + TileV * 10;
}

export function UdimOrigin(TileId)
{
    const Offset = Math.max(0, (TileId | 0) - 1001);
    return { u: Offset % 10, v: Math.floor(Offset / 10) };
}

export function TriangleArea3D(A, B, C)
{
    const Abx = B[0] - A[0], Aby = B[1] - A[1], Abz = B[2] - A[2];
    const Acx = C[0] - A[0], Acy = C[1] - A[1], Acz = C[2] - A[2];
    const Cx = Aby * Acz - Abz * Acy;
    const Cy = Abz * Acx - Abx * Acz;
    const Cz = Abx * Acy - Aby * Acx;
    return 0.5 * Math.hypot(Cx, Cy, Cz);
}

export function SignedTriangleArea2D(A, B, C)
{
    return 0.5 * ((B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]));
}

function SegmentsIntersectStrict(Ax, Ay, Bx, By, Cx, Cy, Dx, Dy)
{
    const Eps = 1e-7;
    const Cross = (Px, Py, Qx, Qy, Rx, Ry) => (Qx - Px) * (Ry - Py) - (Qy - Py) * (Rx - Px);
    const D1 = Cross(Cx, Cy, Dx, Dy, Ax, Ay);
    const D2 = Cross(Cx, Cy, Dx, Dy, Bx, By);
    const D3 = Cross(Ax, Ay, Bx, By, Cx, Cy);
    const D4 = Cross(Ax, Ay, Bx, By, Dx, Dy);
    return ((D1 > Eps && D2 < -Eps) || (D1 < -Eps && D2 > Eps)) &&
           ((D3 > Eps && D4 < -Eps) || (D3 < -Eps && D4 > Eps));
}

function PointInTriangleStrict(Px, Py, Ax, Ay, Bx, By, Cx, Cy)
{
    const Eps = 1e-6;
    const C1 = (Bx - Ax) * (Py - Ay) - (By - Ay) * (Px - Ax);
    const C2 = (Cx - Bx) * (Py - By) - (Cy - By) * (Px - Bx);
    const C3 = (Ax - Cx) * (Py - Cy) - (Ay - Cy) * (Px - Cx);
    const Pos = C1 > Eps && C2 > Eps && C3 > Eps;
    const Neg = C1 < -Eps && C2 < -Eps && C3 < -Eps;
    return Pos || Neg;
}

function TrianglesOverlap2D(T1, T2)
{
    if (T1.maxU <= T2.minU + 1e-6 || T2.maxU <= T1.minU + 1e-6 ||
        T1.maxV <= T2.minV + 1e-6 || T2.maxV <= T1.minV + 1e-6) return false;

    for (let i = 0; i < 3; i++)
    {
        const A = T1.pts[i], B = T1.pts[(i + 1) % 3];
        for (let j = 0; j < 3; j++)
        {
            const C = T2.pts[j], D = T2.pts[(j + 1) % 3];
            if (SegmentsIntersectStrict(A[0], A[1], B[0], B[1], C[0], C[1], D[0], D[1])) return true;
        }
    }
    const Cx1 = (T1.pts[0][0] + T1.pts[1][0] + T1.pts[2][0]) / 3;
    const Cy1 = (T1.pts[0][1] + T1.pts[1][1] + T1.pts[2][1]) / 3;
    if (PointInTriangleStrict(Cx1, Cy1, T2.pts[0][0], T2.pts[0][1], T2.pts[1][0], T2.pts[1][1], T2.pts[2][0], T2.pts[2][1])) return true;

    const Cx2 = (T2.pts[0][0] + T2.pts[1][0] + T2.pts[2][0]) / 3;
    const Cy2 = (T2.pts[0][1] + T2.pts[1][1] + T2.pts[2][1]) / 3;
    if (PointInTriangleStrict(Cx2, Cy2, T1.pts[0][0], T1.pts[0][1], T1.pts[1][0], T1.pts[1][1], T1.pts[2][0], T1.pts[2][1])) return true;

    for (const P of T1.pts)
    {
        if (PointInTriangleStrict(P[0], P[1], T2.pts[0][0], T2.pts[0][1], T2.pts[1][0], T2.pts[1][1], T2.pts[2][0], T2.pts[2][1])) return true;
    }
    for (const P of T2.pts)
    {
        if (PointInTriangleStrict(P[0], P[1], T1.pts[0][0], T1.pts[0][1], T1.pts[1][0], T1.pts[1][1], T1.pts[2][0], T1.pts[2][1])) return true;
    }
    return false;
}

export class TopologySurface
{
    constructor({ name = 'Surface', positions = [], faces = [], uvCoords = [], seams = [], pinned = [] } = {})
    {
        this.name = name;
        this.positions = positions.map(P => [Number(P[0]) || 0, Number(P[1]) || 0, Number(P[2]) || 0]);
        this.uvCoords = uvCoords.map(Uv => [Number(Uv[0]) || 0, Number(Uv[1]) || 0]);
        this.faces = faces.map((F, Index) => ({
            id: F.id ?? Index,
            name: F.name || F.partId || `Face ${Index}`,
            partId: F.partId || 'Surface',
            materialName: F.materialName || 'Default',
            corners: F.corners.map(C => ({ v: C.v | 0, uv: C.uv | 0 }))
        }));
        this.seams = new Set(seams);
        this.pinned = new Set(pinned);
        this.selectedUVs = new Set();
        this.selectedUVEdges = new Set();
        this.selectedEdges3D = new Set();
        this.selectedFaces = new Set();
        this.selectedIslands = new Set();
        this.activeFace = this.faces.length ? 0 : null;
        this.activeIsland = null;
        this.activeEdge3D = null;
        this.activeEdgeUV = null;
        this.importanceByFace = new Map(); // faceIndex -> groupId | null
        this.lockedIslands = new Set();    // key = canonical face signature or lowest face index
        this.hiddenIslands = new Set();
        this.undoStack = [];
        this.redoStack = [];
        this.faceNormals = [];
        this.RecomputeNormals();
    }

    CreateSnapshot(Label = 'Edit')
    {
        return { label: Label, data: this.Snapshot() };
    }

    RestoreSnapshot(Snap)
    {
        if (Snap?.data) this.Restore(Snap.data);
        else if (Snap) this.Restore(Snap);
    }

    PushUndo(Label = 'Edit')
    {
        this.undoStack.push(this.CreateSnapshot(Label));
        this.redoStack = [];
        if (this.undoStack.length > 60) this.undoStack.shift();
    }

    CanUndo() { return this.undoStack.length > 0; }
    CanRedo() { return this.redoStack.length > 0; }

    Undo()
    {
        if (!this.undoStack.length) return false;
        this.redoStack.push(this.CreateSnapshot('Redo'));
        this.RestoreSnapshot(this.undoStack.pop());
        return true;
    }

    Redo()
    {
        if (!this.redoStack.length) return false;
        this.undoStack.push(this.CreateSnapshot('Undo'));
        this.RestoreSnapshot(this.redoStack.pop());
        return true;
    }

    RecomputeNormals()
    {
        this.faceNormals = this.faces.map(F =>
        {
            if (F.corners.length < 3) return [0, 1, 0];
            const A = this.positions[F.corners[0].v];
            const B = this.positions[F.corners[1].v];
            const C = this.positions[F.corners[2].v];
            const Nx = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]);
            const Ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
            const Nz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
            const Len = Math.hypot(Nx, Ny, Nz) || 1;
            return [Nx / Len, Ny / Len, Nz / Len];
        });
    }

    Snapshot()
    {
        return {
            name: this.name,
            uvCoords: this.uvCoords.map(P => [P[0], P[1]]),
            faces: this.faces.map(F => ({
                ...F,
                corners: F.corners.map(C => ({ v: C.v, uv: C.uv }))
            })),
            seams: [...this.seams],
            pinned: [...this.pinned],
            selectedUVs: [...this.selectedUVs],
            selectedUVEdges: [...this.selectedUVEdges],
            selectedEdges3D: [...this.selectedEdges3D],
            selectedFaces: [...this.selectedFaces],
            selectedIslands: [...this.selectedIslands],
            activeFace: this.activeFace,
            activeIsland: this.activeIsland,
            activeEdge3D: this.activeEdge3D,
            activeEdgeUV: this.activeEdgeUV,
            importanceByFace: [...this.importanceByFace.entries()],
            lockedIslands: [...this.lockedIslands],
            hiddenIslands: [...this.hiddenIslands]
        };
    }

    Restore(Snap)
    {
        this.name = Snap.name;
        this.uvCoords = Snap.uvCoords.map(P => [P[0], P[1]]);
        this.faces = Snap.faces.map(F => ({ ...F, corners: F.corners.map(C => ({ v: C.v, uv: C.uv })) }));
        this.seams = new Set(Snap.seams);
        this.pinned = new Set(Snap.pinned);
        this.selectedUVs = new Set(Snap.selectedUVs);
        this.selectedUVEdges = new Set(Snap.selectedUVEdges);
        this.selectedEdges3D = new Set(Snap.selectedEdges3D || []);
        this.selectedFaces = new Set(Snap.selectedFaces);
        this.selectedIslands = new Set(Snap.selectedIslands);
        this.activeFace = Snap.activeFace;
        this.activeIsland = Snap.activeIsland;
        this.activeEdge3D = Snap.activeEdge3D ?? null;
        this.activeEdgeUV = Snap.activeEdgeUV ?? null;
        this.importanceByFace = new Map(Snap.importanceByFace);
        this.lockedIslands = new Set(Snap.lockedIslands || []);
        this.hiddenIslands = new Set(Snap.hiddenIslands || []);
    }

    FaceArea3D(FaceIndex)
    {
        const F = this.faces[FaceIndex];
        let Area = 0;
        const P0 = this.positions[F.corners[0].v];
        for (let k = 1; k < F.corners.length - 1; k++)
        {
            Area += TriangleArea3D(P0, this.positions[F.corners[k].v], this.positions[F.corners[k + 1].v]);
        }
        return Area;
    }

    FaceSignedAreaUV(FaceIndex)
    {
        const F = this.faces[FaceIndex];
        let Area = 0;
        const U0 = this.uvCoords[F.corners[0].uv];
        for (let k = 1; k < F.corners.length - 1; k++)
        {
            Area += SignedTriangleArea2D(U0, this.uvCoords[F.corners[k].uv], this.uvCoords[F.corners[k + 1].uv]);
        }
        return Area;
    }

    FaceTrianglesDistortion(FaceIndex)
    {
        const F = this.faces[FaceIndex];
        const P0 = this.positions[F.corners[0].v];
        const U0 = this.uvCoords[F.corners[0].uv];
        let SumAngleError = 0;
        let SumAreaRatio = 0;
        let TriCount = 0;

        for (let k = 1; k < F.corners.length - 1; k++)
        {
            const P1 = this.positions[F.corners[k].v];
            const P2 = this.positions[F.corners[k + 1].v];
            const U1 = this.uvCoords[F.corners[k].uv];
            const U2 = this.uvCoords[F.corners[k + 1].uv];

            const Area3 = Math.max(1e-10, TriangleArea3D(P0, P1, P2));
            const Area2 = Math.abs(SignedTriangleArea2D(U0, U1, U2));

            // 2D Jacobian singular values via edge lengths & cotangent conformal metric
            const E1 = [P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]];
            const E2 = [P2[0] - P0[0], P2[1] - P0[1], P2[2] - P0[2]];
            const L1 = Math.hypot(E1[0], E1[1], E1[2]) || 1e-6;
            const Ex = [E1[0] / L1, E1[1] / L1, E1[2] / L1];
            const Dot = E2[0] * Ex[0] + E2[1] * Ex[1] + E2[2] * Ex[2];
            const Ortho = [E2[0] - Dot * Ex[0], E2[1] - Dot * Ex[1], E2[2] - Dot * Ex[2]];
            const LOrtho = Math.hypot(Ortho[0], Ortho[1], Ortho[2]) || 1e-6;
            const X1 = L1, Y1 = 0;
            const X2 = Dot, Y2 = LOrtho;
            const Det3 = X1 * Y2;

            const Du1 = U1[0] - U0[0], Dv1 = U1[1] - U0[1];
            const Du2 = U2[0] - U0[0], Dv2 = U2[1] - U0[1];

            // Jacobian J mapping 2D tangent frame -> UV
            const J00 = Du1 / X1;
            const J10 = Dv1 / X1;
            const J01 = (Du2 * X1 - Du1 * X2) / (Det3 || 1e-8);
            const J11 = (Dv2 * X1 - Dv1 * X2) / (Det3 || 1e-8);

            const A = J00 * J00 + J10 * J10;
            const B = J01 * J01 + J11 * J11;
            const C = J00 * J01 + J10 * J11;
            const Trace = A + B;
            const Disc = Math.sqrt(Math.max(0, (A - B) * (A - B) + 4 * C * C));
            const S1 = Math.sqrt(Math.max(1e-10, 0.5 * (Trace + Disc)));
            const S2 = Math.sqrt(Math.max(1e-10, 0.5 * (Trace - Disc)));
            const ConformalStretch = 1 - Math.min(S1, S2) / Math.max(S1, S2, 1e-8);
            SumAngleError += ConformalStretch;
            SumAreaRatio += Area2 / Area3;
            TriCount++;
        }

        return {
            angleStretch: TriCount ? SumAngleError / TriCount : 0,
            areaScale: TriCount ? SumAreaRatio / TriCount : 1
        };
    }

    ExtractIslands(TileResolutionResolver = () => 2048, PixelsPerUnitMultiplier = 100)
    {
        const N = this.faces.length;
        if (!N) return [];

        // Map UV edges -> incident faces (strictly NOT crossing marked seams between distinct 3D edges)
        const UvEdgeFaces = new Map();
        const UvVertFaces = new Map();
        for (let fi = 0; fi < N; fi++)
        {
            const Corners = this.faces[fi].corners;
            for (let k = 0; k < Corners.length; k++)
            {
                const A = Corners[k];
                const B = Corners[(k + 1) % Corners.length];
                const UvKey = EdgeKey(A.uv, B.uv);
                if (!UvEdgeFaces.has(UvKey)) UvEdgeFaces.set(UvKey, []);
                UvEdgeFaces.get(UvKey).push({ face: fi, seam: this.seams.has(EdgeKey(A.v, B.v)) });
                if (!UvVertFaces.has(A.uv)) UvVertFaces.set(A.uv, []);
                UvVertFaces.get(A.uv).push(fi);
            }
        }

        const Visited = new Uint8Array(N);
        const Islands = [];

        for (let Seed = 0; Seed < N; Seed++)
        {
            if (Visited[Seed]) continue;
            const Queue = [Seed];
            Visited[Seed] = 1;
            const FaceIndices = [];
            const UvSet = new Set();
            const EdgeSet = new Set();

            while (Queue.length)
            {
                const Fi = Queue.pop();
                FaceIndices.push(Fi);
                const Corners = this.faces[Fi].corners;
                for (let k = 0; k < Corners.length; k++)
                {
                    const A = Corners[k];
                    const B = Corners[(k + 1) % Corners.length];
                    UvSet.add(A.uv);
                    const UvKey = EdgeKey(A.uv, B.uv);
                    EdgeSet.add(UvKey);

                    // Connect across shared UV edge unless explicitly seam-tagged
                    const SeamHere = this.seams.has(EdgeKey(A.v, B.v));
                    if (!SeamHere)
                    {
                        for (const Inc of UvEdgeFaces.get(UvKey) || [])
                        {
                            if (!Inc.seam && !Visited[Inc.face])
                            {
                                Visited[Inc.face] = 1;
                                Queue.push(Inc.face);
                            }
                        }
                    }
                }
            }

            FaceIndices.sort((A, B) => A - B);
            let Area3D = 0, AreaUV = 0, SignedAreaUV = 0, FlippedFaces = 0;
            let MinU = Infinity, MinV = Infinity, MaxU = -Infinity, MaxV = -Infinity;
            let WeightedU = 0, WeightedV = 0, WeightTotal = 0;
            let AngleStretchSum = 0;
            const PartCounts = new Map();
            const GroupCounts = new Map();

            for (const Fi of FaceIndices)
            {
                const F = this.faces[Fi];
                const A3 = this.FaceArea3D(Fi);
                const SA2 = this.FaceSignedAreaUV(Fi);
                const A2 = Math.abs(SA2);
                const Dist = this.FaceTrianglesDistortion(Fi);
                Area3D += A3;
                AreaUV += A2;
                SignedAreaUV += SA2;
                AngleStretchSum += Dist.angleStretch * Math.max(1e-6, A3);
                if (SA2 < -1e-9) FlippedFaces++;

                PartCounts.set(F.partId, (PartCounts.get(F.partId) || 0) + 1);
                const GroupId = this.importanceByFace.get(Fi) || null;
                if (GroupId) GroupCounts.set(GroupId, (GroupCounts.get(GroupId) || 0) + 1);

                let Fu = 0, Fv = 0;
                for (const C of F.corners)
                {
                    const P = this.uvCoords[C.uv];
                    Fu += P[0];
                    Fv += P[1];
                    if (P[0] < MinU) MinU = P[0];
                    if (P[1] < MinV) MinV = P[1];
                    if (P[0] > MaxU) MaxU = P[0];
                    if (P[1] > MaxV) MaxV = P[1];
                }
                Fu /= F.corners.length;
                Fv /= F.corners.length;
                const W = Math.max(1e-7, A2);
                WeightedU += Fu * W;
                WeightedV += Fv * W;
                WeightTotal += W;
            }

            const CentroidU = WeightTotal > 0 ? WeightedU / WeightTotal : 0.5 * (MinU + MaxU);
            const CentroidV = WeightTotal > 0 ? WeightedV / WeightTotal : 0.5 * (MinV + MaxV);
            const UdimTile = UdimFromUV(CentroidU, CentroidV);
            const Origin = UdimTile ? UdimOrigin(UdimTile) : { u: Math.floor(CentroidU), v: Math.floor(CentroidV) };
            const OutOfBounds = !UdimTile ||
                MinU < Origin.u - 1e-4 || MaxU > Origin.u + 1 + 1e-4 ||
                MinV < Origin.v - 1e-4 || MaxV > Origin.v + 1 + 1e-4;

            let DominantPart = 'Island';
            let BestCount = -1;
            for (const [Part, Count] of PartCounts)
            {
                if (Count > BestCount) { BestCount = Count; DominantPart = Part; }
            }

            let DominantGroup = null;
            let BestGroupCount = 0;
            for (const [Gid, Count] of GroupCounts)
            {
                if (Count > BestGroupCount) { BestGroupCount = Count; DominantGroup = Gid; }
            }

            const TileRes = TileResolutionResolver(UdimTile || 1001);
            // Scene model coordinates in metres -> convert texel density to px/cm (or px/unit / 100)
            const TexelDensityPxPerCm = Area3D > 1e-9
                ? (Math.sqrt(AreaUV / Area3D) * TileRes) / PixelsPerUnitMultiplier
                : 0;

            let PinnedCount = 0;
            for (const UvIdx of UvSet) if (this.pinned.has(UvIdx)) PinnedCount++;

            const Key = FaceIndices[0];
            Islands.push({
                id: Islands.length,
                stableKey: Key,
                name: DominantPart,
                partId: DominantPart,
                faceIndices: FaceIndices,
                uvIndices: [...UvSet],
                uvEdgeKeys: [...EdgeSet],
                area3D: Area3D,
                areaUV: AreaUV,
                signedAreaUV: SignedAreaUV,
                flippedFaces: FlippedFaces,
                angleStretch: Area3D > 1e-9 ? AngleStretchSum / Area3D : 0,
                texelDensity: TexelDensityPxPerCm,
                bounds: {
                    minU: MinU, minV: MinV, maxU: MaxU, maxV: MaxV,
                    width: Math.max(0, MaxU - MinU),
                    height: Math.max(0, MaxV - MinV),
                    centerU: 0.5 * (MinU + MaxU),
                    centerV: 0.5 * (MinV + MaxV)
                },
                centroidU: CentroidU,
                centroidV: CentroidV,
                udimTile: UdimTile || 1001,
                outOfBounds: OutOfBounds,
                importanceGroupId: DominantGroup,
                pinnedCount: PinnedCount,
                locked: this.lockedIslands.has(Key),
                hidden: this.hiddenIslands.has(Key)
            });
        }

        // Disambiguate repeated names cleanly (Hood, Hood 02, ...)
        const SeenNames = new Map();
        for (const Isl of Islands)
        {
            const Base = Isl.name;
            const Num = (SeenNames.get(Base) || 0) + 1;
            SeenNames.set(Base, Num);
            Isl.displayName = Num > 1 ? `${Base} · ${String(Num).padStart(2, '0')}` : Base;
        }
        return Islands;
    }

    DetectOverlapsAndFlips(Islands)
    {
        const FlippedFaces = new Set();
        const OverlappingFaces = new Set();
        const OverlappingIslands = new Set();
        const TrisByTile = new Map();

        for (const Isl of Islands)
        {
            if (Isl.hidden) continue;
            const Tile = Isl.udimTile || 1001;
            if (!TrisByTile.has(Tile)) TrisByTile.set(Tile, []);
            const Bucket = TrisByTile.get(Tile);

            for (const Fi of Isl.faceIndices)
            {
                if (this.FaceSignedAreaUV(Fi) < -1e-9) FlippedFaces.add(Fi);
                const F = this.faces[Fi];
                const U0 = this.uvCoords[F.corners[0].uv];
                for (let k = 1; k < F.corners.length - 1; k++)
                {
                    const U1 = this.uvCoords[F.corners[k].uv];
                    const U2 = this.uvCoords[F.corners[k + 1].uv];
                    if (Math.abs(SignedTriangleArea2D(U0, U1, U2)) < 1e-10) continue;
                    Bucket.push({
                        face: Fi,
                        island: Isl.id,
                        pts: [U0, U1, U2],
                        minU: Math.min(U0[0], U1[0], U2[0]),
                        maxU: Math.max(U0[0], U1[0], U2[0]),
                        minV: Math.min(U0[1], U1[1], U2[1]),
                        maxV: Math.max(U0[1], U1[1], U2[1])
                    });
                }
            }
        }

        for (const Tris of TrisByTile.values())
        {
            Tris.sort((A, B) => A.minU - B.minU);
            for (let i = 0; i < Tris.length; i++)
            {
                const T1 = Tris[i];
                for (let j = i + 1; j < Tris.length; j++)
                {
                    const T2 = Tris[j];
                    if (T2.minU >= T1.maxU - 1e-6) break;
                    if (T1.face === T2.face) continue;
                    if (TrianglesOverlap2D(T1, T2))
                    {
                        OverlappingFaces.add(T1.face);
                        OverlappingFaces.add(T2.face);
                        OverlappingIslands.add(T1.island);
                        OverlappingIslands.add(T2.island);
                    }
                }
            }
        }

        return { FlippedFaces, OverlappingFaces, OverlappingIslands };
    }

    ResolveActiveUVs(SelectionMode, Islands)
    {
        if (SelectionMode === 'vertex') return new Set(this.selectedUVs);
        if (SelectionMode === 'edge')
        {
            const Out = new Set();
            for (const Key of this.selectedUVEdges)
            {
                const [A, B] = Key.split(':').map(Number);
                Out.add(A);
                Out.add(B);
            }
            return Out;
        }
        if (SelectionMode === 'face')
        {
            const Out = new Set();
            for (const Fi of this.selectedFaces)
            {
                for (const C of this.faces[Fi]?.corners || []) Out.add(C.uv);
            }
            return Out;
        }
        // 'island'
        const Out = new Set();
        for (const Isl of Islands)
        {
            if (this.selectedIslands.has(Isl.id) || this.selectedIslands.has(Isl.stableKey))
            {
                for (const UvIdx of Isl.uvIndices) Out.add(UvIdx);
            }
        }
        return Out;
    }

    SyncEdges3DFromUV()
    {
        this.selectedEdges3D.clear();
        if (!this.selectedUVEdges.size) return;
        for (const F of this.faces)
        {
            const C = F.corners;
            for (let k = 0; k < C.length; k++)
            {
                const KUv = EdgeKey(C[k].uv, C[(k + 1) % C.length].uv);
                if (this.selectedUVEdges.has(KUv))
                {
                    this.selectedEdges3D.add(EdgeKey(C[k].v, C[(k + 1) % C.length].v));
                }
            }
        }
    }

    SyncSelectionsFromMode(SourceMode, Islands = null)
    {
        if (!Islands) Islands = this.ExtractIslands();
        if (SourceMode === 'edge3d')
        {
            this.selectedUVEdges.clear();
            for (const F of this.faces)
            {
                const C = F.corners;
                for (let k = 0; k < C.length; k++)
                {
                    const K3 = EdgeKey(C[k].v, C[(k + 1) % C.length].v);
                    if (this.selectedEdges3D.has(K3))
                    {
                        this.selectedUVEdges.add(EdgeKey(C[k].uv, C[(k + 1) % C.length].uv));
                    }
                }
            }
        }

        if (SourceMode === 'vertex')
        {
            this.selectedUVEdges.clear();
            this.selectedFaces.clear();
            this.selectedIslands.clear();
            for (let fi = 0; fi < this.faces.length; fi++)
            {
                const C = this.faces[fi].corners;
                let All = true;
                for (let k = 0; k < C.length; k++)
                {
                    const A = C[k].uv, B = C[(k + 1) % C.length].uv;
                    if (this.selectedUVs.has(A) && this.selectedUVs.has(B)) this.selectedUVEdges.add(EdgeKey(A, B));
                    else All = false;
                }
                if (All) this.selectedFaces.add(fi);
            }
            this.SyncEdges3DFromUV();
            for (const Isl of Islands)
            {
                if (Isl.uvIndices.some(U => this.selectedUVs.has(U))) this.selectedIslands.add(Isl.id);
            }
        }
        else if (SourceMode === 'edge' || SourceMode === 'edge3d')
        {
            this.selectedUVs.clear();
            this.selectedFaces.clear();
            this.selectedIslands.clear();
            for (const Key of this.selectedUVEdges)
            {
                const [A, B] = Key.split(':').map(Number);
                this.selectedUVs.add(A);
                this.selectedUVs.add(B);
            }
            if (SourceMode === 'edge') this.SyncEdges3DFromUV();
            for (let fi = 0; fi < this.faces.length; fi++)
            {
                const C = this.faces[fi].corners;
                let AllEdges = true;
                for (let k = 0; k < C.length; k++)
                {
                    if (!this.selectedUVEdges.has(EdgeKey(C[k].uv, C[(k + 1) % C.length].uv))) { AllEdges = false; break; }
                }
                if (AllEdges) this.selectedFaces.add(fi);
            }
            for (const Isl of Islands)
            {
                if (Isl.uvIndices.some(U => this.selectedUVs.has(U))) this.selectedIslands.add(Isl.id);
            }
        }
        else if (SourceMode === 'face')
        {
            this.selectedUVs.clear();
            this.selectedUVEdges.clear();
            this.selectedEdges3D.clear();
            this.selectedIslands.clear();
            for (const Fi of this.selectedFaces)
            {
                const C = this.faces[Fi]?.corners || [];
                for (let k = 0; k < C.length; k++)
                {
                    this.selectedUVs.add(C[k].uv);
                    this.selectedUVEdges.add(EdgeKey(C[k].uv, C[(k + 1) % C.length].uv));
                    this.selectedEdges3D.add(EdgeKey(C[k].v, C[(k + 1) % C.length].v));
                }
            }
            for (const Isl of Islands)
            {
                if (Isl.faceIndices.some(Fi => this.selectedFaces.has(Fi))) this.selectedIslands.add(Isl.id);
            }
        }
        else if (SourceMode === 'island')
        {
            this.selectedUVs.clear();
            this.selectedUVEdges.clear();
            this.selectedEdges3D.clear();
            this.selectedFaces.clear();
            for (const Isl of Islands)
            {
                if (!this.selectedIslands.has(Isl.id)) continue;
                for (const Fi of Isl.faceIndices)
                {
                    this.selectedFaces.add(Fi);
                    const C = this.faces[Fi].corners;
                    for (let k = 0; k < C.length; k++) this.selectedEdges3D.add(EdgeKey(C[k].v, C[(k + 1) % C.length].v));
                }
                for (const U of Isl.uvIndices) this.selectedUVs.add(U);
                for (const E of Isl.uvEdgeKeys) this.selectedUVEdges.add(E);
            }
        }
    }

    SelectAll(Islands)
    {
        for (let u = 0; u < this.uvCoords.length; u++) this.selectedUVs.add(u);
        for (let fi = 0; fi < this.faces.length; fi++)
        {
            this.selectedFaces.add(fi);
            const C = this.faces[fi].corners;
            for (let k = 0; k < C.length; k++)
            {
                this.selectedUVEdges.add(EdgeKey(C[k].uv, C[(k + 1) % C.length].uv));
                this.selectedEdges3D.add(EdgeKey(C[k].v, C[(k + 1) % C.length].v));
            }
        }
        for (const Isl of Islands) this.selectedIslands.add(Isl.id);
    }

    ClearSelection()
    {
        this.selectedUVs.clear();
        this.selectedUVEdges.clear();
        this.selectedEdges3D.clear();
        this.selectedFaces.clear();
        this.selectedIslands.clear();
        this.activeEdge3D = null;
        this.activeEdgeUV = null;
    }

    InvertSelection(Mode, Islands)
    {
        if (Mode === 'island')
        {
            const Next = new Set();
            for (const Isl of Islands) if (!this.selectedIslands.has(Isl.id)) Next.add(Isl.id);
            this.selectedIslands = Next;
            this.SyncSelectionsFromMode('island', Islands);
        }
        else if (Mode === 'face')
        {
            const Next = new Set();
            for (let fi = 0; fi < this.faces.length; fi++) if (!this.selectedFaces.has(fi)) Next.add(fi);
            this.selectedFaces = Next;
            this.SyncSelectionsFromMode('face', Islands);
        }
        else if (Mode === 'edge')
        {
            const AllEdges = new Set();
            for (const F of this.faces)
            {
                for (let k = 0; k < F.corners.length; k++)
                {
                    AllEdges.add(EdgeKey(F.corners[k].uv, F.corners[(k + 1) % F.corners.length].uv));
                }
            }
            const Next = new Set();
            for (const E of AllEdges) if (!this.selectedUVEdges.has(E)) Next.add(E);
            this.selectedUVEdges = Next;
            this.SyncSelectionsFromMode('edge', Islands);
        }
        else
        {
            const Next = new Set();
            for (let u = 0; u < this.uvCoords.length; u++) if (!this.selectedUVs.has(u)) Next.add(u);
            this.selectedUVs = Next;
            this.SyncSelectionsFromMode('vertex', Islands);
        }
    }

    SelectMore(Islands, Mode = 'vertex')
    {
        return this.GrowSelection(Mode, Islands);
    }

    SelectLess(Islands, Mode = 'vertex')
    {
        return this.ShrinkSelection(Mode, Islands);
    }

    GrowSelection(Mode = 'vertex', Islands = null)
    {
        if (!Islands) Islands = this.ExtractIslands();
        if (Mode === 'face' || Mode === 'island')
        {
            const Topo = this.BuildEdgeTopology();
            const ToAdd = new Set();
            for (const Fi of this.selectedFaces)
            {
                const C = this.faces[Fi]?.corners || [];
                for (let k = 0; k < C.length; k++)
                {
                    const Edge = Topo.edges.get(EdgeKey(C[k].v, C[(k + 1) % C.length].v));
                    if (!Edge) continue;
                    for (const AdjFi of Edge.faces) ToAdd.add(AdjFi);
                }
            }
            for (const Fi of ToAdd) this.selectedFaces.add(Fi);
            this.SyncSelectionsFromMode('face', Islands);
            return this.selectedFaces.size;
        }
        if (Mode === 'edge')
        {
            const Topo = this.BuildEdgeTopology();
            const SelVerts3D = new Set();
            for (const E3 of this.selectedEdges3D)
            {
                const [Va, Vb] = E3.split(':').map(Number);
                SelVerts3D.add(Va);
                SelVerts3D.add(Vb);
            }
            for (const V of SelVerts3D)
            {
                for (const EKey of Topo.vertEdges.get(V) || []) this.selectedEdges3D.add(EKey);
            }
            // Also grow UV edges by shared UV vertices
            const SelUV = new Set(this.selectedUVs);
            for (const F of this.faces)
            {
                for (let k = 0; k < F.corners.length; k++)
                {
                    const A = F.corners[k].uv, B = F.corners[(k + 1) % F.corners.length].uv;
                    if (SelUV.has(A) || SelUV.has(B)) this.selectedUVEdges.add(EdgeKey(A, B));
                }
            }
            this.SyncSelectionsFromMode('edge', Islands);
            return this.selectedEdges3D.size;
        }
        const Adj = new Map();
        for (const F of this.faces)
        {
            for (let k = 0; k < F.corners.length; k++)
            {
                const A = F.corners[k].uv, B = F.corners[(k + 1) % F.corners.length].uv;
                if (!Adj.has(A)) Adj.set(A, new Set());
                if (!Adj.has(B)) Adj.set(B, new Set());
                Adj.get(A).add(B);
                Adj.get(B).add(A);
            }
        }
        const ToAdd = new Set();
        for (const U of this.selectedUVs)
        {
            for (const N of Adj.get(U) || []) ToAdd.add(N);
        }
        for (const N of ToAdd) this.selectedUVs.add(N);
        this.SyncSelectionsFromMode('vertex', Islands);
        return this.selectedUVs.size;
    }

    ShrinkSelection(Mode = 'vertex', Islands = null)
    {
        if (!Islands) Islands = this.ExtractIslands();
        if (Mode === 'face' || Mode === 'island')
        {
            const Topo = this.BuildEdgeTopology();
            const Keep = new Set();
            for (const Fi of this.selectedFaces)
            {
                const C = this.faces[Fi]?.corners || [];
                let Interior = true;
                for (let k = 0; k < C.length; k++)
                {
                    const Edge = Topo.edges.get(EdgeKey(C[k].v, C[(k + 1) % C.length].v));
                    if (!Edge || Edge.faces.length < 2 || Edge.faces.some(AdjFi => !this.selectedFaces.has(AdjFi)))
                    {
                        Interior = false;
                        break;
                    }
                }
                if (Interior) Keep.add(Fi);
            }
            this.selectedFaces = Keep;
            this.SyncSelectionsFromMode('face', Islands);
            return this.selectedFaces.size;
        }
        if (Mode === 'edge')
        {
            const Topo = this.BuildEdgeTopology();
            const VertCount = new Map();
            for (const E3 of this.selectedEdges3D)
            {
                const [Va, Vb] = E3.split(':').map(Number);
                VertCount.set(Va, (VertCount.get(Va) || 0) + 1);
                VertCount.set(Vb, (VertCount.get(Vb) || 0) + 1);
            }
            const Keep3D = new Set();
            for (const E3 of this.selectedEdges3D)
            {
                const [Va, Vb] = E3.split(':').map(Number);
                const AllA = [...(Topo.vertEdges.get(Va) || [])].every(K => this.selectedEdges3D.has(K));
                const AllB = [...(Topo.vertEdges.get(Vb) || [])].every(K => this.selectedEdges3D.has(K));
                if (AllA || AllB) Keep3D.add(E3);
            }
            this.selectedEdges3D = Keep3D;
            this.SyncSelectionsFromMode('edge3d', Islands);
            return this.selectedEdges3D.size;
        }
        const Adj = new Map();
        for (const F of this.faces)
        {
            for (let k = 0; k < F.corners.length; k++)
            {
                const A = F.corners[k].uv, B = F.corners[(k + 1) % F.corners.length].uv;
                if (!Adj.has(A)) Adj.set(A, new Set());
                if (!Adj.has(B)) Adj.set(B, new Set());
                Adj.get(A).add(B);
                Adj.get(B).add(A);
            }
        }
        const Keep = new Set();
        for (const U of this.selectedUVs)
        {
            const Neighbors = Adj.get(U);
            if (Neighbors && [...Neighbors].every(N => this.selectedUVs.has(N))) Keep.add(U);
        }
        this.selectedUVs = Keep;
        this.SyncSelectionsFromMode('vertex', Islands);
        return this.selectedUVs.size;
    }

    BuildEdgeTopology()
    {
        this.RecomputeNormals();
        const Edges = new Map();
        const VertEdges = new Map();
        const UvEdgeTo3D = new Map();
        const UvEdgeFaces = new Map();

        for (let fi = 0; fi < this.faces.length; fi++)
        {
            const C = this.faces[fi].corners;
            const Len = C.length;
            for (let k = 0; k < Len; k++)
            {
                const Va = C[k].v;
                const Vb = C[(k + 1) % Len].v;
                const Uva = C[k].uv;
                const Uvb = C[(k + 1) % Len].uv;
                const K3 = EdgeKey(Va, Vb);
                const KUv = EdgeKey(Uva, Uvb);

                if (!Edges.has(K3))
                {
                    Edges.set(K3, {
                        key: K3,
                        va: Math.min(Va, Vb),
                        vb: Math.max(Va, Vb),
                        faces: [],
                        uvEdges: new Set(),
                        halfEdges: [],
                        isMeshBoundary: false,
                        dihedralDeg: 0
                    });
                }
                const Info = Edges.get(K3);
                if (!Info.faces.includes(fi)) Info.faces.push(fi);
                Info.uvEdges.add(KUv);
                Info.halfEdges.push({ fi, k, va: Va, vb: Vb, uva: Uva, uvb: Uvb, uvKey: KUv });

                if (!VertEdges.has(Va)) VertEdges.set(Va, new Set());
                if (!VertEdges.has(Vb)) VertEdges.set(Vb, new Set());
                VertEdges.get(Va).add(K3);
                VertEdges.get(Vb).add(K3);

                UvEdgeTo3D.set(KUv, K3);
                if (!UvEdgeFaces.has(KUv)) UvEdgeFaces.set(KUv, []);
                UvEdgeFaces.get(KUv).push({ fi, k });
            }
        }

        for (const Info of Edges.values())
        {
            Info.isMeshBoundary = Info.faces.length === 1;
            if (Info.faces.length === 2)
            {
                const N0 = this.faceNormals[Info.faces[0]];
                const N1 = this.faceNormals[Info.faces[1]];
                const Dot = Math.max(-1, Math.min(1, N0[0] * N1[0] + N0[1] * N1[1] + N0[2] * N1[2]));
                Info.dihedralDeg = (Math.acos(Dot) * 180) / Math.PI;
            }
            else if (Info.faces.length > 2)
            {
                // Non-manifold: max dihedral across pairs
                let MaxDeg = 0;
                for (let a = 0; a < Info.faces.length; a++)
                {
                    for (let b = a + 1; b < Info.faces.length; b++)
                    {
                        const N0 = this.faceNormals[Info.faces[a]];
                        const N1 = this.faceNormals[Info.faces[b]];
                        const Dot = Math.max(-1, Math.min(1, N0[0] * N1[0] + N0[1] * N1[1] + N0[2] * N1[2]));
                        MaxDeg = Math.max(MaxDeg, (Math.acos(Dot) * 180) / Math.PI);
                    }
                }
                Info.dihedralDeg = MaxDeg;
            }
        }

        return { edges: Edges, vertEdges: VertEdges, uvEdgeTo3D: UvEdgeTo3D, uvEdgeFaces: UvEdgeFaces };
    }

    SelectEdge3D(Va, Vb, Additive = false, Islands = null)
    {
        const Key = EdgeKey(Va, Vb);
        if (!Additive) this.ClearSelection();
        if (Additive && this.selectedEdges3D.has(Key))
        {
            this.selectedEdges3D.delete(Key);
            if (this.activeEdge3D === Key) this.activeEdge3D = null;
        }
        else
        {
            this.selectedEdges3D.add(Key);
            this.activeEdge3D = Key;
        }
        this.SyncSelectionsFromMode('edge3d', Islands);
        return this.selectedEdges3D.size;
    }

    SelectEdgeLoop3D(Va, Vb, Additive = false, Islands = null)
    {
        const Topo = this.BuildEdgeTopology();
        const StartKey = EdgeKey(Va, Vb);
        if (!Topo.edges.has(StartKey)) return 0;
        if (!Additive) this.ClearSelection();

        const LoopEdges = new Set([StartKey]);
        const WalkDir = (StartVert, PrevVert, StartEdgeKey) =>
        {
            let Curr = StartVert;
            let From = PrevVert;
            let CurrKey = StartEdgeKey;

            for (let step = 0; step < 2048; step++)
            {
                const CurrInfo = Topo.edges.get(CurrKey);
                const Incident = Topo.vertEdges.get(Curr);
                if (!CurrInfo || !Incident) break;

                const PrevP = this.positions[From];
                const CurrP = this.positions[Curr];
                const Dx = CurrP[0] - PrevP[0], Dy = CurrP[1] - PrevP[1], Dz = CurrP[2] - PrevP[2];
                const Len = Math.hypot(Dx, Dy, Dz) || 1;

                let ChosenKey = null;
                let ChosenNext = null;

                if (CurrInfo.isMeshBoundary)
                {
                    // Walk along open boundary rim
                    let BestAlign = -2;
                    for (const CandKey of Incident)
                    {
                        if (CandKey === CurrKey || LoopEdges.has(CandKey)) continue;
                        const CInfo = Topo.edges.get(CandKey);
                        if (!CInfo || !CInfo.isMeshBoundary) continue;
                        const NextV = CInfo.va === Curr ? CInfo.vb : CInfo.va;
                        const NP = this.positions[NextV];
                        const Nx = NP[0] - CurrP[0], Ny = NP[1] - CurrP[1], Nz = NP[2] - CurrP[2];
                        const NLen = Math.hypot(Nx, Ny, Nz) || 1;
                        const Align = (Dx * Nx + Dy * Ny + Dz * Nz) / (Len * NLen);
                        if (Align > BestAlign)
                        {
                            BestAlign = Align;
                            ChosenKey = CandKey;
                            ChosenNext = NextV;
                        }
                    }
                }
                else if (Incident.size === 4)
                {
                    // Standard quad-pole valence 4: pick unique edge sharing zero faces with CurrInfo
                    const CurrFaces = new Set(CurrInfo.faces);
                    const OppositeCands = [];
                    for (const CandKey of Incident)
                    {
                        if (CandKey === CurrKey) continue;
                        const CInfo = Topo.edges.get(CandKey);
                        if (!CInfo) continue;
                        const SharesFace = CInfo.faces.some(Fi => CurrFaces.has(Fi));
                        if (!SharesFace) OppositeCands.push(CInfo);
                    }
                    if (OppositeCands.length === 1)
                    {
                        ChosenKey = OppositeCands[0].key;
                        ChosenNext = OppositeCands[0].va === Curr ? OppositeCands[0].vb : OppositeCands[0].va;
                    }
                    else if (OppositeCands.length > 1)
                    {
                        let BestAlign = -2;
                        for (const CInfo of OppositeCands)
                        {
                            const NextV = CInfo.va === Curr ? CInfo.vb : CInfo.va;
                            const NP = this.positions[NextV];
                            const Nx = NP[0] - CurrP[0], Ny = NP[1] - CurrP[1], Nz = NP[2] - CurrP[2];
                            const NLen = Math.hypot(Nx, Ny, Nz) || 1;
                            const Align = (Dx * Nx + Dy * Ny + Dz * Nz) / (Len * NLen);
                            if (Align > BestAlign) { BestAlign = Align; ChosenKey = CInfo.key; ChosenNext = NextV; }
                        }
                    }
                }
                else
                {
                    // High-valence / triangulated mesh fallback: strictly straight continuation
                    let BestAlign = 0.85;
                    for (const CandKey of Incident)
                    {
                        if (CandKey === CurrKey || LoopEdges.has(CandKey)) continue;
                        const CInfo = Topo.edges.get(CandKey);
                        if (!CInfo) continue;
                        const NextV = CInfo.va === Curr ? CInfo.vb : CInfo.va;
                        const NP = this.positions[NextV];
                        const Nx = NP[0] - CurrP[0], Ny = NP[1] - CurrP[1], Nz = NP[2] - CurrP[2];
                        const NLen = Math.hypot(Nx, Ny, Nz) || 1;
                        const Align = (Dx * Nx + Dy * Ny + Dz * Nz) / (Len * NLen);
                        if (Align > BestAlign) { BestAlign = Align; ChosenKey = CandKey; ChosenNext = NextV; }
                    }
                }

                if (!ChosenKey || ChosenNext === null || LoopEdges.has(ChosenKey)) break;
                LoopEdges.add(ChosenKey);
                From = Curr;
                Curr = ChosenNext;
                CurrKey = ChosenKey;
            }
        };

        WalkDir(Vb, Va, StartKey);
        WalkDir(Va, Vb, StartKey);

        for (const K of LoopEdges) this.selectedEdges3D.add(K);
        this.activeEdge3D = StartKey;
        this.SyncSelectionsFromMode('edge3d', Islands);
        return LoopEdges.size;
    }

    SelectEdgeRing3D(Va, Vb, Additive = false, Islands = null)
    {
        const Topo = this.BuildEdgeTopology();
        const StartKey = EdgeKey(Va, Vb);
        if (!Topo.edges.has(StartKey)) return 0;
        if (!Additive) this.ClearSelection();

        const RingEdges = new Set([StartKey]);
        const Queue = [StartKey];

        while (Queue.length)
        {
            const Key = Queue.pop();
            const Info = Topo.edges.get(Key);
            if (!Info) continue;

            for (const Fi of Info.faces)
            {
                const C = this.faces[Fi].corners;
                if (C.length !== 4) continue; // Edge rings walk opposite rungs across quads
                for (let k = 0; k < 4; k++)
                {
                    if (EdgeKey(C[k].v, C[(k + 1) % 4].v) === Key)
                    {
                        const OppK = (k + 2) % 4;
                        const OppKey = EdgeKey(C[OppK].v, C[(OppK + 1) % 4].v);
                        if (!RingEdges.has(OppKey))
                        {
                            RingEdges.add(OppKey);
                            Queue.push(OppKey);
                        }
                    }
                }
            }
        }

        for (const K of RingEdges) this.selectedEdges3D.add(K);
        this.activeEdge3D = StartKey;
        this.SyncSelectionsFromMode('edge3d', Islands);
        return RingEdges.size;
    }

    SelectShortestPath3D(SrcEdgeKey, DstEdgeKey, Additive = false, Islands = null)
    {
        const Topo = this.BuildEdgeTopology();
        if (!Topo.edges.has(DstEdgeKey)) return 0;
        if (!SrcEdgeKey || !Topo.edges.has(SrcEdgeKey) || SrcEdgeKey === DstEdgeKey)
        {
            const [Va, Vb] = DstEdgeKey.split(':').map(Number);
            return this.SelectEdge3D(Va, Vb, Additive, Islands);
        }

        const SrcInfo = Topo.edges.get(SrcEdgeKey);
        const DstInfo = Topo.edges.get(DstEdgeKey);
        const TargetVerts = new Set([DstInfo.va, DstInfo.vb]);

        // Dijkstra across 3D vertices
        const Dist = new Map();
        const Prev = new Map(); // vert -> { fromV, edgeKey }
        const Unvisited = new Set();

        for (const V of Topo.vertEdges.keys()) { Dist.set(V, Infinity); Unvisited.add(V); }
        Dist.set(SrcInfo.va, 0);
        Dist.set(SrcInfo.vb, 0);

        let Reached = null;
        while (Unvisited.size)
        {
            let U = null, BestD = Infinity;
            for (const Cand of Unvisited)
            {
                const D = Dist.get(Cand);
                if (D < BestD) { BestD = D; U = Cand; }
            }
            if (U === null || BestD === Infinity) break;
            Unvisited.delete(U);
            if (TargetVerts.has(U)) { Reached = U; break; }

            const PU = this.positions[U];
            for (const EKey of Topo.vertEdges.get(U) || [])
            {
                const EInfo = Topo.edges.get(EKey);
                const V = EInfo.va === U ? EInfo.vb : EInfo.va;
                if (!Unvisited.has(V)) continue;
                const PV = this.positions[V];
                const W = Math.hypot(PV[0] - PU[0], PV[1] - PU[1], PV[2] - PU[2]);
                const Alt = BestD + W;
                if (Alt < Dist.get(V))
                {
                    Dist.set(V, Alt);
                    Prev.set(V, { fromV: U, edgeKey: EKey });
                }
            }
        }

        if (!Additive) this.ClearSelection();
        const PathEdges = new Set([SrcEdgeKey, DstEdgeKey]);
        let Trace = Reached;
        while (Trace !== null && Prev.has(Trace))
        {
            const Step = Prev.get(Trace);
            PathEdges.add(Step.edgeKey);
            Trace = Step.fromV;
        }
        for (const K of PathEdges) this.selectedEdges3D.add(K);
        this.activeEdge3D = DstEdgeKey;
        this.SyncSelectionsFromMode('edge3d', Islands);
        return PathEdges.size;
    }

    SelectUvEdgeLoop(UvA, UvB, Islands = null, Additive = true)
    {
        if (!Additive) this.ClearSelection();
        // Walk across quad valence-4 vertices along UV edge direction
        const EdgeToFaces = new Map();
        const VertToEdges = new Map();
        for (let fi = 0; fi < this.faces.length; fi++)
        {
            const C = this.faces[fi].corners;
            for (let k = 0; k < C.length; k++)
            {
                const A = C[k].uv, B = C[(k + 1) % C.length].uv;
                const Key = EdgeKey(A, B);
                if (!EdgeToFaces.has(Key)) EdgeToFaces.set(Key, []);
                EdgeToFaces.get(Key).push({ face: fi, k });
                if (!VertToEdges.has(A)) VertToEdges.set(A, new Set());
                if (!VertToEdges.has(B)) VertToEdges.set(B, new Set());
                VertToEdges.get(A).add(Key);
                VertToEdges.get(B).add(Key);
            }
        }

        const StartKey = EdgeKey(UvA, UvB);
        const LoopEdges = new Set([StartKey]);
        const WalkDirection = (Start, Prev) =>
        {
            let Curr = Start, From = Prev;
            for (let step = 0; step < 1024; step++)
            {
                const IncidentEdges = VertToEdges.get(Curr);
                if (!IncidentEdges) break;
                const PrevPt = this.uvCoords[From];
                const CurrPt = this.uvCoords[Curr];
                const Dx = CurrPt[0] - PrevPt[0], Dy = CurrPt[1] - PrevPt[1];
                const Len = Math.hypot(Dx, Dy) || 1;
                let BestEdge = null, BestNext = null, BestDot = 0.25;
                for (const EKey of IncidentEdges)
                {
                    if (LoopEdges.has(EKey)) continue;
                    const [Ea, Eb] = EKey.split(':').map(Number);
                    const Other = Ea === Curr ? Eb : Ea;
                    const OPt = this.uvCoords[Other];
                    const Nx = OPt[0] - CurrPt[0], Ny = OPt[1] - CurrPt[1];
                    const NLen = Math.hypot(Nx, Ny) || 1;
                    const Align = (Dx * Nx + Dy * Ny) / (Len * NLen);
                    if (Align > BestDot)
                    {
                        BestDot = Align;
                        BestEdge = EKey;
                        BestNext = Other;
                    }
                }
                if (!BestEdge || BestNext === null) break;
                LoopEdges.add(BestEdge);
                From = Curr;
                Curr = BestNext;
            }
        };

        WalkDirection(UvB, UvA);
        WalkDirection(UvA, UvB);
        for (const E of LoopEdges) this.selectedUVEdges.add(E);
        this.activeEdgeUV = StartKey;
        this.SyncSelectionsFromMode('edge', Islands);
        return LoopEdges.size;
    }

    SelectUvEdgeRing(UvA, UvB, Islands = null, Additive = false)
    {
        if (!Additive) this.ClearSelection();
        const StartKey = EdgeKey(UvA, UvB);
        const UvEdgeFaces = new Map();
        for (let fi = 0; fi < this.faces.length; fi++)
        {
            const C = this.faces[fi].corners;
            for (let k = 0; k < C.length; k++)
            {
                const Key = EdgeKey(C[k].uv, C[(k + 1) % C.length].uv);
                if (!UvEdgeFaces.has(Key)) UvEdgeFaces.set(Key, []);
                UvEdgeFaces.get(Key).push(fi);
            }
        }
        const Ring = new Set([StartKey]);
        const Queue = [StartKey];
        while (Queue.length)
        {
            const K = Queue.pop();
            for (const Fi of UvEdgeFaces.get(K) || [])
            {
                const C = this.faces[Fi].corners;
                if (C.length !== 4) continue;
                for (let k = 0; k < 4; k++)
                {
                    if (EdgeKey(C[k].uv, C[(k + 1) % 4].uv) === K)
                    {
                        const OppK = (k + 2) % 4;
                        const OppKey = EdgeKey(C[OppK].uv, C[(OppK + 1) % 4].uv);
                        if (!Ring.has(OppKey)) { Ring.add(OppKey); Queue.push(OppKey); }
                    }
                }
            }
        }
        for (const E of Ring) this.selectedUVEdges.add(E);
        this.activeEdgeUV = StartKey;
        this.SyncSelectionsFromMode('edge', Islands);
        return Ring.size;
    }

    SelectUvShortestPath(SrcKeyUV, DstKeyUV, Islands = null, Additive = false)
    {
        if (!SrcKeyUV || SrcKeyUV === DstKeyUV)
        {
            if (!Additive) this.ClearSelection();
            this.selectedUVEdges.add(DstKeyUV);
            this.activeEdgeUV = DstKeyUV;
            this.SyncSelectionsFromMode('edge', Islands);
            return 1;
        }

        const VertEdges = new Map();
        for (const F of this.faces)
        {
            const C = F.corners;
            for (let k = 0; k < C.length; k++)
            {
                const A = C[k].uv, B = C[(k + 1) % C.length].uv;
                const Key = EdgeKey(A, B);
                if (!VertEdges.has(A)) VertEdges.set(A, new Set());
                if (!VertEdges.has(B)) VertEdges.set(B, new Set());
                VertEdges.get(A).add(Key);
                VertEdges.get(B).add(Key);
            }
        }

        const [Sa, Sb] = SrcKeyUV.split(':').map(Number);
        const [Da, Db] = DstKeyUV.split(':').map(Number);
        const Targets = new Set([Da, Db]);
        const Dist = new Map();
        const Prev = new Map();
        const Unvisited = new Set(VertEdges.keys());
        for (const V of Unvisited) Dist.set(V, Infinity);
        if (Unvisited.has(Sa)) Dist.set(Sa, 0);
        if (Unvisited.has(Sb)) Dist.set(Sb, 0);

        let Reached = null;
        while (Unvisited.size)
        {
            let U = null, BestD = Infinity;
            for (const Cand of Unvisited)
            {
                const D = Dist.get(Cand);
                if (D < BestD) { BestD = D; U = Cand; }
            }
            if (U === null || BestD === Infinity) break;
            Unvisited.delete(U);
            if (Targets.has(U)) { Reached = U; break; }

            const PU = this.uvCoords[U];
            for (const EKey of VertEdges.get(U) || [])
            {
                const [Ea, Eb] = EKey.split(':').map(Number);
                const V = Ea === U ? Eb : Ea;
                if (!Unvisited.has(V)) continue;
                const PV = this.uvCoords[V];
                const Alt = BestD + Math.hypot(PV[0] - PU[0], PV[1] - PU[1]);
                if (Alt < Dist.get(V))
                {
                    Dist.set(V, Alt);
                    Prev.set(V, { fromV: U, edgeKey: EKey });
                }
            }
        }

        if (!Additive) this.ClearSelection();
        const Path = new Set([SrcKeyUV, DstKeyUV]);
        let Trace = Reached;
        while (Trace !== null && Prev.has(Trace))
        {
            const Step = Prev.get(Trace);
            Path.add(Step.edgeKey);
            Trace = Step.fromV;
        }
        for (const E of Path) this.selectedUVEdges.add(E);
        this.activeEdgeUV = DstKeyUV;
        this.SyncSelectionsFromMode('edge', Islands);
        return Path.size;
    }

    SelectSharpEdges(AngleDeg = 35, Additive = false, Islands = null)
    {
        const Topo = this.BuildEdgeTopology();
        if (!Additive) this.ClearSelection();
        let Count = 0;
        for (const [Key, Info] of Topo.edges)
        {
            if (Info.faces.length >= 2 && Info.dihedralDeg >= AngleDeg)
            {
                this.selectedEdges3D.add(Key);
                this.activeEdge3D = Key;
                Count++;
            }
        }
        this.SyncSelectionsFromMode('edge3d', Islands);
        return Count;
    }

    GetBoundaryEdges(Scope = 'auto', Islands = null)
    {
        const Topo = this.BuildEdgeTopology();
        const Result3D = new Set();
        const ResultUV = new Set();

        const HasPartialFaceSelection = this.selectedFaces.size > 0 && this.selectedFaces.size < this.faces.length;
        const EffectiveScope = Scope === 'auto'
            ? (HasPartialFaceSelection ? 'selection' : 'all')
            : Scope;

        if (EffectiveScope === 'selection' && this.selectedFaces.size > 0)
        {
            // Blender: Select Boundary Loop around selected faces
            const EdgeCounts = new Map();
            const UvEdgeCounts = new Map();
            for (const Fi of this.selectedFaces)
            {
                const C = this.faces[Fi]?.corners || [];
                for (let k = 0; k < C.length; k++)
                {
                    const K3 = EdgeKey(C[k].v, C[(k + 1) % C.length].v);
                    const KUv = EdgeKey(C[k].uv, C[(k + 1) % C.length].uv);
                    EdgeCounts.set(K3, (EdgeCounts.get(K3) || 0) + 1);
                    UvEdgeCounts.set(KUv, (UvEdgeCounts.get(KUv) || 0) + 1);
                }
            }
            for (const [K3, Cnt] of EdgeCounts) if (Cnt === 1) Result3D.add(K3);
            for (const [KUv, Cnt] of UvEdgeCounts) if (Cnt === 1) ResultUV.add(KUv);
            return { edges3D: Result3D, edgesUV: ResultUV, scope: 'selection', topology: Topo };
        }

        if (EffectiveScope === 'mesh' || EffectiveScope === 'all')
        {
            for (const [K3, Info] of Topo.edges)
            {
                if (Info.isMeshBoundary)
                {
                    Result3D.add(K3);
                    for (const KUv of Info.uvEdges) ResultUV.add(KUv);
                }
            }
        }

        if (EffectiveScope === 'islands' || EffectiveScope === 'all')
        {
            for (const [KUv, FaceList] of Topo.uvEdgeFaces)
            {
                if (FaceList.length === 1)
                {
                    ResultUV.add(KUv);
                    const K3 = Topo.uvEdgeTo3D.get(KUv);
                    if (K3) Result3D.add(K3);
                }
            }
        }

        return { edges3D: Result3D, edgesUV: ResultUV, scope: EffectiveScope, topology: Topo };
    }

    SelectBoundaryEdges(Scope = 'auto', Additive = false, Islands = null)
    {
        const B = this.GetBoundaryEdges(Scope, Islands);
        if (!Additive) this.ClearSelection();
        for (const K3 of B.edges3D) { this.selectedEdges3D.add(K3); this.activeEdge3D = K3; }
        for (const KUv of B.edgesUV) { this.selectedUVEdges.add(KUv); this.activeEdgeUV = KUv; }
        this.SyncSelectionsFromMode(B.edgesUV.size ? 'edge' : 'edge3d', Islands);
        return { count3D: B.edges3D.size, countUV: B.edgesUV.size, scope: B.scope };
    }

    SelectAllSeamEdges(Additive = false, Islands = null)
    {
        if (!Additive) this.ClearSelection();
        for (const K3 of this.seams)
        {
            this.selectedEdges3D.add(K3);
            this.activeEdge3D = K3;
        }
        this.SyncSelectionsFromMode('edge3d', Islands);
        return this.selectedEdges3D.size;
    }

    SplitSelectedFaces(Islands)
    {
        // Blender Y: split selected faces into disconnected UV islands
        const FaceSet = new Set(this.selectedFaces);
        if (!FaceSet.size) return 0;

        const Remap = new Map();
        for (const Fi of FaceSet)
        {
            const F = this.faces[Fi];
            for (const C of F.corners)
            {
                if (!Remap.has(C.uv))
                {
                    const Orig = this.uvCoords[C.uv];
                    const NewIdx = this.uvCoords.length;
                    this.uvCoords.push([Orig[0], Orig[1]]);
                    if (this.pinned.has(C.uv)) this.pinned.add(NewIdx);
                    Remap.set(C.uv, NewIdx);
                }
                C.uv = Remap.get(C.uv);
            }
        }
        this.PruneUnusedUVs();
        this.SyncSelectionsFromMode('face', Islands);
        return FaceSet.size;
    }

    WeldSelectedUVs(Mode = 'center', DistanceThreshold = 0.015)
    {
        const Sel = [...this.selectedUVs];
        if (Sel.length < 2) return 0;
        let MergedCount = 0;

        if (Mode === 'center')
        {
            let SumU = 0, SumV = 0;
            for (const Idx of Sel) { SumU += this.uvCoords[Idx][0]; SumV += this.uvCoords[Idx][1]; }
            const TargetIdx = Sel[0];
            this.uvCoords[TargetIdx][0] = SumU / Sel.length;
            this.uvCoords[TargetIdx][1] = SumV / Sel.length;
            const MergeSet = new Set(Sel);
            for (const F of this.faces)
            {
                for (const C of F.corners) if (MergeSet.has(C.uv)) C.uv = TargetIdx;
            }
            this.selectedUVs = new Set([TargetIdx]);
            MergedCount = Sel.length - 1;
        }
        else
        {
            // Merge by distance clustering
            const Remap = new Map();
            const RepList = [];
            for (const Idx of Sel)
            {
                const P = this.uvCoords[Idx];
                let Matched = null;
                for (const Rep of RepList)
                {
                    const Rp = this.uvCoords[Rep];
                    if (Math.hypot(P[0] - Rp[0], P[1] - Rp[1]) <= DistanceThreshold)
                    {
                        Matched = Rep;
                        break;
                    }
                }
                if (Matched === null) { RepList.push(Idx); Remap.set(Idx, Idx); }
                else { Remap.set(Idx, Matched); MergedCount++; }
            }
            for (const F of this.faces)
            {
                for (const C of F.corners) if (Remap.has(C.uv)) C.uv = Remap.get(C.uv);
            }
            this.selectedUVs = new Set(RepList);
        }

        this.PruneUnusedUVs();
        return MergedCount;
    }

    StitchSelected(Islands)
    {
        // Blender V: find UV vertices on selected edges/faces whose 3D vertex matches another UV vertex on a neighboring face, and snap/weld
        const SelFaceSet = new Set(this.selectedFaces);
        if (!SelFaceSet.size)
        {
            for (const Isl of Islands)
            {
                if (this.selectedIslands.has(Isl.id))
                {
                    for (const Fi of Isl.faceIndices) SelFaceSet.add(Fi);
                }
            }
        }
        const CandidateUVs = new Map(); // 3D vertex v -> Set of uv indices
        for (const F of this.faces)
        {
            for (const C of F.corners)
            {
                if (!CandidateUVs.has(C.v)) CandidateUVs.set(C.v, new Set());
                CandidateUVs.get(C.v).add(C.uv);
            }
        }

        const Remap = new Map();
        const TargetUvForV = new Map();
        // Prefer UV vertices already in selected faces (or unselected partner if selected face is being stitched onto stationary island)
        for (let fi = 0; fi < this.faces.length; fi++)
        {
            if (SelFaceSet.size && SelFaceSet.has(fi)) continue;
            for (const C of this.faces[fi].corners)
            {
                if (this.selectedUVs.has(C.uv) || SelFaceSet.size)
                {
                    if (!TargetUvForV.has(C.v)) TargetUvForV.set(C.v, C.uv);
                }
            }
        }

        let Stitched = 0;
        for (const UvIdx of this.selectedUVs)
        {
            // Find 3D vertex owning UvIdx
            let Vert3D = null;
            for (const F of this.faces)
            {
                for (const C of F.corners) if (C.uv === UvIdx) { Vert3D = C.v; break; }
                if (Vert3D !== null) break;
            }
            if (Vert3D === null) continue;
            const Peers = CandidateUVs.get(Vert3D);
            if (!Peers || Peers.size < 2) continue;

            const Anchor = TargetUvForV.get(Vert3D);
            if (Anchor !== undefined && Anchor !== UvIdx)
            {
                Remap.set(UvIdx, Anchor);
                // Clear seam between this edge's neighbors if stitched
                Stitched++;
            }
            else
            {
                // Average all peers for this 3D vertex
                const Arr = [...Peers];
                const Rep = Arr[0];
                let U = 0, V = 0;
                for (const P of Arr) { U += this.uvCoords[P][0]; V += this.uvCoords[P][1]; }
                this.uvCoords[Rep] = [U / Arr.length, V / Arr.length];
                for (const P of Arr) if (P !== Rep) Remap.set(P, Rep);
                Stitched++;
            }
        }

        if (Remap.size)
        {
            for (const F of this.faces)
            {
                for (const C of F.corners) if (Remap.has(C.uv)) C.uv = Remap.get(C.uv);
            }
            // Also clear seams along edges whose endpoints are now unified UV vertices
            for (const F of this.faces)
            {
                for (let k = 0; k < F.corners.length; k++)
                {
                    const A = F.corners[k], B = F.corners[(k + 1) % F.corners.length];
                    const K = EdgeKey(A.v, B.v);
                    if (this.seams.has(K))
                    {
                        // Check if all faces on both sides share A.uv & B.uv
                        let AllMatched = true;
                        for (const F2 of this.faces)
                        {
                            for (let m = 0; m < F2.corners.length; m++)
                            {
                                const C1 = F2.corners[m], C2 = F2.corners[(m + 1) % F2.corners.length];
                                if (EdgeKey(C1.v, C2.v) === K && EdgeKey(C1.uv, C2.uv) !== EdgeKey(A.uv, B.uv))
                                {
                                    AllMatched = false;
                                }
                            }
                        }
                        if (AllMatched) this.seams.delete(K);
                    }
                }
            }
            this.PruneUnusedUVs();
        }
        return Stitched;
    }

    ToggleSeamsFromSelectedEdges(ForceMark = null, SelectionMode = 'edge', Islands = null)
    {
        return this.MarkSeamFromSelection(ForceMark, SelectionMode, Islands);
    }

    MarkSeamFromSelection(ForceMark = null, SelectionMode = 'edge', Islands = null)
    {
        const Target3DEdges = new Set();

        if ((SelectionMode === 'face' || SelectionMode === 'island') && this.selectedFaces.size > 0)
        {
            // Blender behavior in Face/Island mode: mark/clear perimeter boundary loop of selected faces
            const Boundary = this.GetBoundaryEdges('selection', Islands);
            for (const K3 of Boundary.edges3D) Target3DEdges.add(K3);
        }

        if (!Target3DEdges.size && this.selectedEdges3D.size > 0)
        {
            for (const K3 of this.selectedEdges3D) Target3DEdges.add(K3);
        }

        if (!Target3DEdges.size && this.selectedUVEdges.size > 0)
        {
            for (const F of this.faces)
            {
                for (let k = 0; k < F.corners.length; k++)
                {
                    const A = F.corners[k], B = F.corners[(k + 1) % F.corners.length];
                    if (this.selectedUVEdges.has(EdgeKey(A.uv, B.uv))) Target3DEdges.add(EdgeKey(A.v, B.v));
                }
            }
        }

        if (!Target3DEdges.size && this.selectedFaces.size > 0)
        {
            const Boundary = this.GetBoundaryEdges('selection', Islands);
            for (const K3 of Boundary.edges3D) Target3DEdges.add(K3);
        }

        if (!Target3DEdges.size) return 0;

        let Marked = 0;
        let Cleared = 0;
        for (const K of Target3DEdges)
        {
            const ShouldMark = ForceMark === null ? !this.seams.has(K) : ForceMark;
            if (ShouldMark && !this.seams.has(K)) { this.seams.add(K); Marked++; }
            else if (!ShouldMark && this.seams.has(K)) { this.seams.delete(K); Cleared++; }
        }
        if (Marked > 0) this.SplitUVsAlongSeams();
        return Marked + Cleared;
    }

    ClearSeamFromSelection(HealUVs = false, SelectionMode = 'edge', Islands = null)
    {
        const Removed = this.MarkSeamFromSelection(false, SelectionMode, Islands);
        if (HealUVs && Removed > 0) this.WeldNonSeamCorners();
        return Removed;
    }

    ToggleSeamEdge3D(Va, Vb, ForceMark = null, Islands = null)
    {
        const Key = EdgeKey(Va, Vb);
        const ShouldMark = ForceMark === null ? !this.seams.has(Key) : ForceMark;
        if (ShouldMark)
        {
            this.seams.add(Key);
            this.SplitUVsAlongSeams();
        }
        else
        {
            this.seams.delete(Key);
        }
        this.activeEdge3D = Key;
        if (Islands) this.SyncSelectionsFromMode(this.selectedEdges3D.size ? 'edge3d' : 'edge', Islands);
        return ShouldMark;
    }

    ToggleSeamLoop3D(Va, Vb, ForceMark = null, Islands = null)
    {
        const Key = EdgeKey(Va, Vb);
        const ShouldMark = ForceMark === null ? !this.seams.has(Key) : ForceMark;
        this.SelectEdgeLoop3D(Va, Vb, false, Islands);
        for (const K3 of this.selectedEdges3D)
        {
            if (ShouldMark) this.seams.add(K3);
            else this.seams.delete(K3);
        }
        if (ShouldMark) this.SplitUVsAlongSeams();
        this.SyncSelectionsFromMode('edge3d', Islands);
        return { marked: ShouldMark, count: this.selectedEdges3D.size };
    }

    MarkBoundaryAsSeam(Scope = 'auto', Islands = null)
    {
        const Boundary = this.GetBoundaryEdges(Scope, Islands);
        let Added = 0;
        for (const K3 of Boundary.edges3D)
        {
            if (!this.seams.has(K3))
            {
                this.seams.add(K3);
                Added++;
            }
            this.selectedEdges3D.add(K3);
        }
        if (Added > 0) this.SplitUVsAlongSeams();
        this.SyncSelectionsFromMode('edge3d', Islands);
        return { added: Added, total: Boundary.edges3D.size, scope: Boundary.scope };
    }

    MarkSharpAsSeam(AngleDeg = 35, Islands = null)
    {
        const Topo = this.BuildEdgeTopology();
        let Added = 0;
        let Matched = 0;
        this.ClearSelection();
        for (const [Key, Info] of Topo.edges)
        {
            if (Info.faces.length >= 2 && Info.dihedralDeg >= AngleDeg)
            {
                Matched++;
                this.selectedEdges3D.add(Key);
                this.activeEdge3D = Key;
                if (!this.seams.has(Key))
                {
                    this.seams.add(Key);
                    Added++;
                }
            }
        }
        if (Added > 0) this.SplitUVsAlongSeams();
        this.SyncSelectionsFromMode('edge3d', Islands);
        return { added: Added, matched: Matched };
    }

    SeamsFromIslands(Islands = null)
    {
        // Blender UV -> Seams from Islands: marks internal 3D mesh edges sitting along UV island boundaries
        const Topo = this.BuildEdgeTopology();
        let Added = 0;
        for (const [KUv, FaceList] of Topo.uvEdgeFaces)
        {
            if (FaceList.length !== 1) continue;
            const K3 = Topo.uvEdgeTo3D.get(KUv);
            if (!K3) continue;
            const Info = Topo.edges.get(K3);
            // Mark edges shared by >= 2 3D faces whose UVs split across island border
            if (Info && Info.faces.length >= 2 && !this.seams.has(K3))
            {
                this.seams.add(K3);
                Added++;
            }
        }
        if (Added > 0) this.SplitUVsAlongSeams();
        return Added;
    }

    ClearAllSeams()
    {
        const Count = this.seams.size;
        this.seams.clear();
        return Count;
    }

    WeldNonSeamCorners(OnlyFaces = null)
    {
        // Re-merge UV corners across edges where seams were cleared while keeping pinned UV coords intact
        const FaceFilter = OnlyFaces ? new Set(OnlyFaces) : null;
        const EdgeFaces = new Map();
        for (let fi = 0; fi < this.faces.length; fi++)
        {
            if (FaceFilter && !FaceFilter.has(fi)) continue;
            const C = this.faces[fi].corners;
            for (let k = 0; k < C.length; k++)
            {
                const K = EdgeKey(C[k].v, C[(k + 1) % C.length].v);
                if (!EdgeFaces.has(K)) EdgeFaces.set(K, []);
                EdgeFaces.get(K).push(fi);
            }
        }

        const CornersByV = new Map();
        for (let fi = 0; fi < this.faces.length; fi++)
        {
            if (FaceFilter && !FaceFilter.has(fi)) continue;
            const C = this.faces[fi].corners;
            for (let ci = 0; ci < C.length; ci++)
            {
                const V = C[ci].v;
                if (!CornersByV.has(V)) CornersByV.set(V, []);
                CornersByV.get(V).push({ fi, ci, uv: C[ci].uv });
            }
        }

        let Merged = 0;
        for (const [V, List] of CornersByV)
        {
            const Visited = new Uint8Array(List.length);
            for (let s = 0; s < List.length; s++)
            {
                if (Visited[s]) continue;
                Visited[s] = 1;
                const Group = [List[s]];
                const Queue = [List[s]];
                while (Queue.length)
                {
                    const Cur = Queue.pop();
                    const F = this.faces[Cur.fi];
                    const PrevV = F.corners[(Cur.ci + F.corners.length - 1) % F.corners.length].v;
                    const NextV = F.corners[(Cur.ci + 1) % F.corners.length].v;
                    for (const EKey of [EdgeKey(V, PrevV), EdgeKey(V, NextV)])
                    {
                        if (this.seams.has(EKey)) continue;
                        for (const AdjFi of EdgeFaces.get(EKey) || [])
                        {
                            for (let o = 0; o < List.length; o++)
                            {
                                if (!Visited[o] && List[o].fi === AdjFi)
                                {
                                    Visited[o] = 1;
                                    Group.push(List[o]);
                                    Queue.push(List[o]);
                                }
                            }
                        }
                    }
                }
                if (Group.length > 1)
                {
                    // Prefer pinned UV coordinate as canonical anchor
                    let Canonical = Group[0].uv;
                    for (const Item of Group)
                    {
                        if (this.pinned.has(Item.uv)) { Canonical = Item.uv; break; }
                    }
                    for (const Item of Group)
                    {
                        if (Item.uv !== Canonical)
                        {
                            this.faces[Item.fi].corners[Item.ci].uv = Canonical;
                            Merged++;
                        }
                    }
                }
            }
        }
        if (Merged > 0) this.PruneUnusedUVs();
        return Merged;
    }

    SplitUVsAlongSeams()
    {
        // Rebuild UV vertices per corner grouped by connected face components not crossing seams
        const EdgeFaces = new Map();
        for (let fi = 0; fi < this.faces.length; fi++)
        {
            const C = this.faces[fi].corners;
            for (let k = 0; k < C.length; k++)
            {
                const K = EdgeKey(C[k].v, C[(k + 1) % C.length].v);
                if (!EdgeFaces.has(K)) EdgeFaces.set(K, []);
                EdgeFaces.get(K).push(fi);
            }
        }

        // For each 3D vertex v, partition incident face corners by non-seam adjacency AND identical old uv index
        const CornersByV = new Map();
        for (let fi = 0; fi < this.faces.length; fi++)
        {
            const C = this.faces[fi].corners;
            for (let ci = 0; ci < C.length; ci++)
            {
                const V = C[ci].v;
                if (!CornersByV.has(V)) CornersByV.set(V, []);
                CornersByV.get(V).push({ fi, ci, uv: C[ci].uv });
            }
        }

        const NewUVs = [];
        const OldPinned = new Set(this.pinned);
        const OldSelUV = new Set(this.selectedUVs);
        const NewPinned = new Set();
        const NewSelUV = new Set();

        for (const [V, List] of CornersByV)
        {
            const Visited = new Uint8Array(List.length);
            for (let s = 0; s < List.length; s++)
            {
                if (Visited[s]) continue;
                Visited[s] = 1;
                const Group = [List[s]];
                const Queue = [List[s]];
                while (Queue.length)
                {
                    const Cur = Queue.pop();
                    const F = this.faces[Cur.fi];
                    const PrevV = F.corners[(Cur.ci + F.corners.length - 1) % F.corners.length].v;
                    const NextV = F.corners[(Cur.ci + 1) % F.corners.length].v;
                    const CandidateEdges = [EdgeKey(V, PrevV), EdgeKey(V, NextV)];
                    for (const EKey of CandidateEdges)
                    {
                        if (this.seams.has(EKey)) continue;
                        for (const AdjFi of EdgeFaces.get(EKey) || [])
                        {
                            for (let o = 0; o < List.length; o++)
                            {
                                if (!Visited[o] && List[o].fi === AdjFi && List[o].uv === Cur.uv)
                                {
                                    Visited[o] = 1;
                                    Group.push(List[o]);
                                    Queue.push(List[o]);
                                }
                            }
                        }
                    }
                }
                const BaseUV = this.uvCoords[List[s].uv] || [0, 0];
                const NewIdx = NewUVs.length;
                NewUVs.push([BaseUV[0], BaseUV[1]]);
                if (OldPinned.has(List[s].uv)) NewPinned.add(NewIdx);
                if (OldSelUV.has(List[s].uv)) NewSelUV.add(NewIdx);
                for (const Item of Group) this.faces[Item.fi].corners[Item.ci].uv = NewIdx;
            }
        }

        this.uvCoords = NewUVs;
        this.pinned = NewPinned;
        this.selectedUVs = NewSelUV;
        if (this.selectedEdges3D.size > 0)
        {
            this.selectedUVEdges.clear();
            for (const F of this.faces)
            {
                const C = F.corners;
                for (let k = 0; k < C.length; k++)
                {
                    if (this.selectedEdges3D.has(EdgeKey(C[k].v, C[(k + 1) % C.length].v)))
                    {
                        this.selectedUVEdges.add(EdgeKey(C[k].uv, C[(k + 1) % C.length].uv));
                    }
                }
            }
        }
    }

    PruneUnusedUVs()
    {
        const Used = new Map();
        const NewCoords = [];
        const NewPinned = new Set();
        const NewSelUV = new Set();

        for (const F of this.faces)
        {
            for (const C of F.corners)
            {
                let Mapped = Used.get(C.uv);
                if (Mapped === undefined)
                {
                    Mapped = NewCoords.length;
                    Used.set(C.uv, Mapped);
                    NewCoords.push([...(this.uvCoords[C.uv] || [0, 0])]);
                    if (this.pinned.has(C.uv)) NewPinned.add(Mapped);
                    if (this.selectedUVs.has(C.uv)) NewSelUV.add(Mapped);
                }
                C.uv = Mapped;
            }
        }
        this.uvCoords = NewCoords;
        this.pinned = NewPinned;
        this.selectedUVs = NewSelUV;

        const RemappedEdges = new Set();
        for (const Key of this.selectedUVEdges)
        {
            const [A, B] = Key.split(':').map(Number);
            if (Used.has(A) && Used.has(B)) RemappedEdges.add(EdgeKey(Used.get(A), Used.get(B)));
        }
        this.selectedUVEdges = RemappedEdges;
    }

    MoveIslandsToUdim(IslandIds, TargetTileId, Islands)
    {
        const Origin = UdimOrigin(TargetTileId);
        let Moved = 0;
        const TargetSet = new Set(IslandIds);
        for (const Isl of Islands)
        {
            if (!TargetSet.has(Isl.id) && !TargetSet.has(Isl.stableKey)) continue;
            const CurOrigin = UdimOrigin(Isl.udimTile || 1001);
            const Du = Origin.u - CurOrigin.u;
            const Dv = Origin.v - CurOrigin.v;
            if (Du === 0 && Dv === 0 && !Isl.outOfBounds) continue;
            // If out of bounds, recenter cleanly inside target tile
            const ShiftU = Isl.outOfBounds ? (Origin.u + 0.5 - Isl.bounds.centerU) : Du;
            const ShiftV = Isl.outOfBounds ? (Origin.v + 0.5 - Isl.bounds.centerV) : Dv;
            for (const UvIdx of Isl.uvIndices)
            {
                this.uvCoords[UvIdx][0] += ShiftU;
                this.uvCoords[UvIdx][1] += ShiftV;
            }
            Moved++;
        }
        return Moved;
    }

    static ParseObj(Text, Name = 'Imported OBJ')
    {
        const Positions = [];
        const RawUVs = [];
        const Faces = [];
        let CurrentGroup = 'Object';
        let CurrentMaterial = 'Default';
        const Lines = Text.split(/\r?\n/);

        for (const Raw of Lines)
        {
            const Line = Raw.trim();
            if (!Line || Line.startsWith('#')) continue;
            const Parts = Line.split(/\s+/);
            const Cmd = Parts[0];
            if (Cmd === 'v' && Parts.length >= 4)
            {
                Positions.push([parseFloat(Parts[1]) || 0, parseFloat(Parts[2]) || 0, parseFloat(Parts[3]) || 0]);
            }
            else if (Cmd === 'vt' && Parts.length >= 3)
            {
                RawUVs.push([parseFloat(Parts[1]) || 0, parseFloat(Parts[2]) || 0]);
            }
            else if ((Cmd === 'g' || Cmd === 'o') && Parts.length >= 2)
            {
                CurrentGroup = Parts.slice(1).join(' ');
            }
            else if (Cmd === 'usemtl' && Parts.length >= 2)
            {
                CurrentMaterial = Parts.slice(1).join(' ');
            }
            else if (Cmd === 'f' && Parts.length >= 4)
            {
                const Corners = [];
                for (let i = 1; i < Parts.length; i++)
                {
                    const Toks = Parts[i].split('/');
                    let VIdx = parseInt(Toks[0], 10);
                    if (VIdx < 0) VIdx = Positions.length + VIdx;
                    else VIdx -= 1;

                    let VtIdx = Toks[1] ? parseInt(Toks[1], 10) : NaN;
                    if (Number.isFinite(VtIdx))
                    {
                        VtIdx = VtIdx < 0 ? RawUVs.length + VtIdx : VtIdx - 1;
                    }
                    else
                    {
                        VtIdx = -1;
                    }
                    if (VIdx >= 0 && VIdx < Positions.length) Corners.push({ v: VIdx, uv: VtIdx });
                }
                if (Corners.length >= 3)
                {
                    Faces.push({
                        id: Faces.length,
                        name: CurrentGroup,
                        partId: CurrentGroup,
                        materialName: CurrentMaterial,
                        corners: Corners
                    });
                }
            }
        }

        // Normalize bounding scale nicely into ~3 metre workspace
        if (Positions.length)
        {
            let MinX = Infinity, MinY = Infinity, MinZ = Infinity;
            let MaxX = -Infinity, MaxY = -Infinity, MaxZ = -Infinity;
            for (const P of Positions)
            {
                if (P[0] < MinX) MinX = P[0]; if (P[0] > MaxX) MaxX = P[0];
                if (P[1] < MinY) MinY = P[1]; if (P[1] > MaxY) MaxY = P[1];
                if (P[2] < MinZ) MinZ = P[2]; if (P[2] > MaxZ) MaxZ = P[2];
            }
            const Span = Math.max(MaxX - MinX, MaxY - MinY, MaxZ - MinZ, 1e-4);
            const Cx = 0.5 * (MinX + MaxX), Cz = 0.5 * (MinZ + MaxZ);
            const Scale = 2.8 / Span;
            for (const P of Positions)
            {
                P[0] = (P[0] - Cx) * Scale;
                P[1] = (P[1] - MinY) * Scale;
                P[2] = (P[2] - Cz) * Scale;
            }
        }

        let HadUVs = RawUVs.length > 0;
        const UvCoords = RawUVs.length ? RawUVs.map(U => [U[0], U[1]]) : [];
        if (!HadUVs)
        {
            for (const F of Faces)
            {
                for (const C of F.corners)
                {
                    const P = Positions[C.v];
                    C.uv = UvCoords.length;
                    UvCoords.push([P[0] * 0.35 + 0.5, P[1] * 0.35 + 0.5]);
                }
            }
        }
        else
        {
            for (const F of Faces)
            {
                for (const C of F.corners)
                {
                    if (C.uv < 0 || C.uv >= UvCoords.length)
                    {
                        C.uv = UvCoords.length;
                        UvCoords.push([0, 0]);
                    }
                }
            }
        }

        const Surface = new TopologySurface({ name: Name, positions: Positions, faces: Faces, uvCoords: UvCoords });
        // Infer seams wherever two adjacent faces share a 3D edge with different UV indices
        const EdgeMap = new Map();
        for (const F of Surface.faces)
        {
            for (let k = 0; k < F.corners.length; k++)
            {
                const A = F.corners[k], B = F.corners[(k + 1) % F.corners.length];
                const K = EdgeKey(A.v, B.v);
                const UvK = EdgeKey(A.uv, B.uv);
                if (!EdgeMap.has(K)) EdgeMap.set(K, UvK);
                else if (EdgeMap.get(K) !== UvK) Surface.seams.add(K);
            }
        }
        Surface.PruneUnusedUVs();
        return { surface: Surface, hadUVs: HadUVs };
    }

    SelectIsland(IslandId, Additive = false, Islands = null)
    {
        const List = Islands || this.ExtractIslands();
        if (!Additive) this.ClearSelection();
        const Target = List.find(I => I.id === IslandId || I.stableKey === IslandId);
        if (!Target) return 0;
        if (Additive && this.selectedIslands.has(Target.id)) this.selectedIslands.delete(Target.id);
        else this.selectedIslands.add(Target.id);
        this.SyncSelectionsFromMode('island', List);
        this.activeIsland = Target.id;
        return Target.faceIndices.length;
    }

    SelectIslands(IslandIds, Additive = false, Islands = null)
    {
        const List = Islands || this.ExtractIslands();
        if (!Additive) this.ClearSelection();
        for (const Id of IslandIds)
        {
            const Target = List.find(I => I.id === Id || I.stableKey === Id);
            if (Target) this.selectedIslands.add(Target.id);
        }
        this.SyncSelectionsFromMode('island', List);
        return this.selectedIslands.size;
    }

    SelectFace(FaceIndex, Additive = false, Islands = null)
    {
        const List = Islands || this.ExtractIslands();
        if (!Additive) this.ClearSelection();
        if (Additive && this.selectedFaces.has(FaceIndex)) this.selectedFaces.delete(FaceIndex);
        else
        {
            this.selectedFaces.add(FaceIndex);
            this.activeFace = FaceIndex;
        }
        this.SyncSelectionsFromMode('face', List);
        return this.selectedFaces.size;
    }

    SelectLinked(Islands = null)
    {
        const List = Islands || this.ExtractIslands();
        for (const Isl of List)
        {
            if (Isl.uvIndices.some(U => this.selectedUVs.has(U)) || Isl.faceIndices.some(F => this.selectedFaces.has(F)))
            {
                this.selectedIslands.add(Isl.id);
            }
        }
        this.SyncSelectionsFromMode('island', List);
        return this.selectedIslands.size;
    }

    SyncDerivedSelectionFromFaces(Islands = null)
    {
        this.SyncSelectionsFromMode('face', Islands || this.ExtractIslands());
    }

    PinSelected(Pin = true)
    {
        let Changed = 0;
        for (const UvIdx of this.selectedUVs)
        {
            if (Pin && !this.pinned.has(UvIdx)) { this.pinned.add(UvIdx); Changed++; }
            else if (!Pin && this.pinned.has(UvIdx)) { this.pinned.delete(UvIdx); Changed++; }
        }
        return Changed;
    }

    PinIslandBoundaries(Islands = null)
    {
        const List = Islands || this.ExtractIslands();
        const TargetIslands = this.selectedIslands.size
            ? List.filter(I => this.selectedIslands.has(I.id))
            : List;
        const EdgeUseCount = new Map();
        for (const Isl of TargetIslands)
        {
            for (const Fi of Isl.faceIndices)
            {
                const C = this.faces[Fi].corners;
                for (let k = 0; k < C.length; k++)
                {
                    const K = EdgeKey(C[k].uv, C[(k + 1) % C.length].uv);
                    EdgeUseCount.set(K, (EdgeUseCount.get(K) || 0) + 1);
                }
            }
        }
        let Count = 0;
        for (const [Key, Cnt] of EdgeUseCount)
        {
            if (Cnt !== 1) continue;
            const [A, B] = Key.split(':').map(Number);
            if (!this.pinned.has(A)) { this.pinned.add(A); Count++; }
            if (!this.pinned.has(B)) { this.pinned.add(B); Count++; }
        }
        return Count;
    }

    AssignImportanceGroup(IslandIds, GroupId, Islands = null)
    {
        const List = Islands || this.ExtractIslands();
        const IdSet = new Set(IslandIds);
        let Updated = 0;
        for (const Isl of List)
        {
            if (!IdSet.has(Isl.id) && !IdSet.has(Isl.stableKey)) continue;
            for (const Fi of Isl.faceIndices)
            {
                if (GroupId) this.importanceByFace.set(Fi, GroupId);
                else this.importanceByFace.delete(Fi);
            }
            Updated++;
        }
        return Updated;
    }

    SetIslandLocked(IslandIdOrKey, Locked, Islands = null)
    {
        const List = Islands || this.ExtractIslands();
        const Target = List.find(I => I.id === IslandIdOrKey || I.stableKey === IslandIdOrKey);
        const Key = Target ? Target.stableKey : IslandIdOrKey;
        if (Locked) this.lockedIslands.add(Key);
        else this.lockedIslands.delete(Key);
    }

    SetIslandHidden(IslandIdOrKey, Hidden, Islands = null)
    {
        const List = Islands || this.ExtractIslands();
        const Target = List.find(I => I.id === IslandIdOrKey || I.stableKey === IslandIdOrKey);
        const Key = Target ? Target.stableKey : IslandIdOrKey;
        if (Hidden) this.hiddenIslands.add(Key);
        else this.hiddenIslands.delete(Key);
    }

    ToggleSeamEdge(Va, Vb, ForceMark = null, Islands = null)
    {
        return this.ToggleSeamEdge3D(Va, Vb, ForceMark, Islands);
    }

    SplitSelection(Islands = null)
    {
        return this.SplitSelectedFaces(Islands || this.ExtractIslands());
    }

    WeldSelected(Mode = 'center', DistanceThreshold = 0.015)
    {
        return this.WeldSelectedUVs(Mode, DistanceThreshold);
    }

    TransformSelectedUVs({ pivot = [0.5, 0.5], du = 0, dv = 0, angle = 0, scaleU = 1, scaleV = 1 } = {})
    {
        const Cos = Math.cos(angle), Sin = Math.sin(angle);
        for (const UvIdx of this.selectedUVs)
        {
            const P = this.uvCoords[UvIdx];
            const Rx = (P[0] - pivot[0]) * scaleU;
            const Ry = (P[1] - pivot[1]) * scaleV;
            P[0] = pivot[0] + (Rx * Cos - Ry * Sin) + du;
            P[1] = pivot[1] + (Rx * Sin + Ry * Cos) + dv;
        }
        return this.selectedUVs.size;
    }

    AnalyzeDiagnostics(Islands = null)
    {
        const List = Islands || this.ExtractIslands();
        const Base = this.DetectOverlapsAndFlips(List);
        let SumAngle = 0, MaxAngle = 0, SumArea3D = 0;
        for (let fi = 0; fi < this.faces.length; fi++)
        {
            const A3 = Math.max(1e-7, this.FaceArea3D(fi));
            const D = this.FaceTrianglesDistortion(fi);
            SumAngle += D.angleStretch * A3;
            SumArea3D += A3;
            if (D.angleStretch > MaxAngle) MaxAngle = D.angleStretch;
        }
        return {
            ...Base,
            overlapCount: Base.OverlappingFaces.size,
            flippedCount: Base.FlippedFaces.size,
            meanAngleStretch: SumArea3D > 0 ? SumAngle / SumArea3D : 0,
            maxAngleStretch: MaxAngle
        };
    }

    ExportObj()
    {
        return this.SerializeObj();
    }

    SerializeObj()
    {
        const Lines = [
            `# Frontier UV Studio Wavefront OBJ Export`,
            `# Surface: ${this.name}`,
            `# Vertices: ${this.positions.length} | UVs: ${this.uvCoords.length} | Faces: ${this.faces.length}`,
            ``
        ];
        for (const P of this.positions)
        {
            Lines.push(`v ${P[0].toFixed(6)} ${P[1].toFixed(6)} ${P[2].toFixed(6)}`);
        }
        for (const Uv of this.uvCoords)
        {
            Lines.push(`vt ${Uv[0].toFixed(6)} ${Uv[1].toFixed(6)}`);
        }
        let LastPart = null, LastMat = null;
        for (const F of this.faces)
        {
            if (F.partId !== LastPart) { Lines.push(`g ${F.partId.replace(/\s+/g, '_')}`); LastPart = F.partId; }
            if (F.materialName !== LastMat) { Lines.push(`usemtl ${F.materialName.replace(/\s+/g, '_')}`); LastMat = F.materialName; }
            Lines.push('f ' + F.corners.map(C => `${C.v + 1}/${C.uv + 1}`).join(' '));
        }
        return Lines.join('\n') + '\n';
    }
}
