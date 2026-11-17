//============================================================================================================================================
//                                                         COLLAPSESEQUENCE.JS
//============================================================================================================================================
// 🧩 Session-baked progressive rear-to-front collapsing bridge & sinkhole road with movie-style propagating faultline cracks and sand effects.

import { ConstructBox, SplitPart, MeasureMass, MeasureFaceNormal, TriangulateFace, ConstructRandom } from "./FractureStructure.js";
import { CourseMaterial } from "./MaterialSpecification.js";
import { EmitBoxFacets } from "./CourseStructure.js";
import { AddVector, SubtractVector, ScaleVector, CrossVector, DotVector, NormalizeVector,
         MultiplyAddVector, ConstructAxisQuaternion, ConstructRigidTransform, ClampScalar } from "./TransformProjection.js";

//------------------------------------------------------------------------------------------------------------------------
//                                                  CONSTANTS & BUDGETS
//------------------------------------------------------------------------------------------------------------------------

const ShardsPerBay         = 3;       // [-] - Convex Voronoi/faultline deck chunks per longitudinal bay
const CracksPerBay         = 4;       // [-] - Zigzagging faultline crack prisms per bay (continuous spine + branch)
const SandPoolCount        = 48;      // [-] - Pooled cascading sand/grit clumps pouring from active cracks & drops
const VertexStrideBytes    = 32;      // [B] - 8 × 4-byte scalars/uints per vertex in Scene.VertexRecords
const MaxTrianglesPerPiece = 64;      // [-] - Upper bound per multi-sided Voronoi slab or lightning fissure prism
const GravityAcceleration  = 9.81;    // [m/s²]

//------------------------------------------------------------------------------------------------------------------------
//                                        MANIFOLD PRISM & VORONOI BAY FRACTURING
//------------------------------------------------------------------------------------------------------------------------

// 📝 Converts an outward-wound closed facet array into local-centroid fragment triangles for a Composite FacetSet.
function PackFacetsAsPiece(Facets, Centroid = [0.0, 0.0, 0.0])
{
    const Triangles = [];
    for (const Facet of Facets)
    {
        const Family = Facet.Family !== undefined ? Facet.Family : Facet.Material;
        const Shifted = Facet.Corners.map((Corner) => SubtractVector(Corner, Centroid));
        if (Shifted.length === 3)
            Triangles.push({ Corners: Shifted, Family });
        else if (Shifted.length === 4)
        {
            Triangles.push({ Corners: [Shifted[0], Shifted[1], Shifted[2]], Family });
            Triangles.push({ Corners: [Shifted[0], Shifted[2], Shifted[3]], Family });
        }
    }
    return Triangles;
}

// 📝 Converts a clipped FractureStructure convex Part into local-centroid triangles with distinct road-top vs interior materials.
function ConvertClippedPartToPiece(Part, TopMaterial, UndersideMaterial, CutMaterial)
{
    const { Centroid } = MeasureMass(Part);
    const Triangles = [];
    for (const Face of Part.Faces)
    {
        if (!Face.Indices || Face.Indices.length < 3)
            continue;
        const Normal = MeasureFaceNormal(Part, Face);
        const IsSkin = !Face.Interior;
        let Family = CutMaterial;
        if (IsSkin)
        {
            if (Normal[2] > 0.65)
                Family = TopMaterial;
            else if (Normal[2] < -0.65)
                Family = UndersideMaterial;
            else
                Family = CourseMaterial.BarrierConcrete;
        }
        const { Triangles: LocalTris } = TriangulateFace(Part, Face);
        for (const [I0, I1, I2] of LocalTris)
        {
            Triangles.push({
                Corners: [
                    SubtractVector(Part.Vertices[Face.Indices[I0]], Centroid),
                    SubtractVector(Part.Vertices[Face.Indices[I1]], Centroid),
                    SubtractVector(Part.Vertices[Face.Indices[I2]], Centroid)
                ],
                Family
            });
        }
    }
    return { Centroid, Triangles };
}

// 📝 Builds a sharp-tipped, jagged 8-vertex lightning fissure polyhedron between P0 -> P1 (ZERO 90° square/box corners!).
//    Endpoints P0 and P1 taper to razor spear points while two staggered interior stations form crooked jagged walls.
function ConstructCrackSegmentPiece(P0, P1, Width, Height, MaterialTop, MaterialSide)
{
    const DeltaX = P1[0] - P0[0];
    const DeltaY = P1[1] - P0[1];
    const Length = Math.max(0.32, Math.hypot(DeltaX, DeltaY));
    const TX = DeltaX / Length, TY = DeltaY / Length;
    const NX = -TY, NY = TX;

    const Midpoint = [0.5 * (P0[0] + P1[0]), 0.5 * (P0[1] + P1[1]), 0.0];
    const HalfL = 0.5 * Length;
    const HalfW = Math.max(0.045, 0.5 * Width);
    const HalfH = 0.5 * Height;

    // Asymmetric crooked lightning kinks at s = -0.18*L and s = +0.20*L; razor tips at -HalfL and +HalfL (no 90° corners!)
    const KinkA = 0.28 * HalfW;
    const KinkB = -0.24 * HalfW;
    const Ring2D = [
        [-HalfL - 0.03,  0.0],                // 0: rear razor spear tip
        [-0.20 * Length, -HalfW * 0.92 + KinkA], // 1: right-rear jagged shoulder
        [ 0.22 * Length, -HalfW * 0.78 + KinkB], // 2: right-front jagged shoulder
        [ HalfL + 0.03,  0.0],                // 3: front razor spear tip
        [ 0.18 * Length,  HalfW * 0.88 + KinkB], // 4: left-front jagged shoulder
        [-0.22 * Length,  HalfW * 0.82 + KinkA]  // 5: left-rear jagged shoulder
    ].map(([S, L]) => [S * TX + L * NX, S * TY + L * NY]);

    const N = Ring2D.length;
    const TopV = Ring2D.map(([X, Y]) => [X, Y,  HalfH]);
    const BotV = Ring2D.map(([X, Y]) => [X, Y, -HalfH]);
    const Triangles = [];

    // Outward +Z top polygon fan & outward -Z bottom polygon fan (convex/star-convex around origin [0, 0, ±HalfH])
    const TopCenter = [0.0, 0.0,  HalfH];
    const BotCenter = [0.0, 0.0, -HalfH];
    for (let I = 0; I < N; ++I)
    {
        const Next = (I + 1) % N;
        Triangles.push({ Corners: [TopCenter, TopV[I], TopV[Next]], Family: MaterialTop });
        Triangles.push({ Corners: [BotCenter, BotV[Next], BotV[I]], Family: MaterialSide });
        Triangles.push({ Corners: [BotV[I], BotV[Next], TopV[Next]], Family: MaterialSide });
        Triangles.push({ Corners: [BotV[I], TopV[Next], TopV[I]],    Family: MaterialSide });
    }

    return { Centroid: Midpoint, Triangles };
}

// 📝 Projects a span-local 3D point [RelX, RelY, RelZ] (where RelX ∈ [0, SpanLength]) into world space.
function SpanLocalToWorld(Span, RelX, RelY, RelZ)
{
    const Cos = Span.CosineYaw, Sin = Span.SineYaw;
    return [
        Span.StartWorld[0] + Cos * RelX - Sin * RelY,
        Span.StartWorld[1] + Sin * RelX + Cos * RelY,
        Span.DeckZ + RelZ
    ];
}

function ComposeWorldQuaternion(SpanYaw, Pitch, Roll, ExtraYaw)
{
    const QYaw = ConstructAxisQuaternion([0.0, 0.0, 1.0], SpanYaw + ExtraYaw);
    const QPitch = ConstructAxisQuaternion([0.0, 1.0, 0.0], Pitch);
    const QRoll = ConstructAxisQuaternion([1.0, 0.0, 0.0], Roll);
    const Multiply = (A, B) => [
        A[3] * B[0] + A[0] * B[3] + A[1] * B[2] - A[2] * B[1],
        A[3] * B[1] - A[0] * B[2] + A[1] * B[3] + A[2] * B[0],
        A[3] * B[2] + A[0] * B[1] - A[1] * B[0] + A[2] * B[3],
        A[3] * B[3] - A[0] * B[0] - A[1] * B[1] - A[2] * B[2]
    ];
    return Multiply(QYaw, Multiply(QPitch, QRoll));
}

//------------------------------------------------------------------------------------------------------------------------
//                                         SHARED BAY SDF PROXY SHAPE DESCRIPTOR
//------------------------------------------------------------------------------------------------------------------------

export function ConstructCollapseProxyShapes()
{
    return {
        CollapseBayProxy: {
            Emit: () => EmitBoxFacets(8.0, 14.0, 0.58, CourseMaterial.TunnelConcrete),
            Voxel: 0.36,
            Cards: 6
        }
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                                              COLLAPSE SEQUENCE CONTROLLER
//------------------------------------------------------------------------------------------------------------------------

export class CollapseSequence
{
    constructor(Scene, Spans = [], InitialSeed = null)
    {
        this.Scene       = Scene;
        this.Spans       = Spans;
        this.SessionSeed = (InitialSeed !== null && InitialSeed !== undefined)
            ? (InitialSeed >>> 0)
            : (((Math.random() * 0xFFFFFFFF) >>> 0) || 0xA53C9E47);
        this.BakeCount   = 0;
        this.Clock       = 0.0;
        this.Enabled     = true;
        this.SandCursor  = 0;
        this.SandShards  = [];
        this.Pieces      = [];

        if (this.Scene && this.Scene.CollapseBlock && this.Spans.length > 0)
            this.BakeAllSpans(this.SessionSeed, null);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                    SESSION-UNIQUE FRACTURE & MOVIE CRACK BAKING
    //--------------------------------------------------------------------------------------------------------------------

    BakeAllSpans(NewSeed, Device = null, VertexRecords = null)
    {
        if (NewSeed !== undefined && NewSeed !== null)
            this.SessionSeed = (NewSeed >>> 0) || 0x5F3759DF;
        this.BakeCount++;

        const Block = this.Scene ? this.Scene.CollapseBlock : null;
        if (!Block)
            return;

        const Random = ConstructRandom(this.SessionSeed);
        const AllPieces = [];
        let SlotCursor = 0;

        for (let SpanIndex = 0; SpanIndex < this.Spans.length; ++SpanIndex)
        {
            const Span = this.Spans[SpanIndex];
            const Surface = Span.Surface;
            const BayCount = Surface.BayCount;
            const BayLength = Surface.BayLength;
            const Width = Surface.Width;
            const Thickness = Surface.Thickness;

            Span.State = "armed";
            Span.Elapsed = 0.0;
            Span.ClearTimer = 0.0;
            Span.CrackFrontU = -0.02;
            Span.DropFrontU = -0.08;
            Span.Bays = [];

            // 📝 1) TRUE CONTINUOUS 3D VORONOI DECK PARTITIONING ACROSS THE ENTIRE SPAN (NO rectangular bay boxes!):
            //    Generate BayCount × ShardsPerBay staggered Voronoi seed points across the full SpanLength × Width slab
            //    and clip each cell against oblique bisector planes of neighboring sites so every shard is an organic
            //    5- to 7-sided irregular tectonic polygon with oblique triple-junction seams (never 90° squares!).
            const TotalShardTarget = BayCount * ShardsPerBay;
            const HalfSpan = 0.5 * Span.SpanLength;
            const VoronoiSites = [];
            for (let BayIdx = 0; BayIdx < BayCount; ++BayIdx)
            {
                const BaseX = -HalfSpan + (BayIdx + 0.5) * BayLength;
                const LaneAnchors = [-0.31 * Width, (Random() - 0.5) * 0.14 * Width, 0.31 * Width];
                for (let Sub = 0; Sub < ShardsPerBay; ++Sub)
                {
                    const LaneStagger = (Sub === 1 ? 0.34 : (Sub === 2 ? -0.28 : 0.05)) * BayLength * ((BayIdx & 1) ? -1.0 : 1.0);
                    const JitterX = (Random() - 0.5) * 0.48 * BayLength;
                    const JitterY = (Random() - 0.5) * 0.16 * Width;
                    VoronoiSites.push({
                        Sub,
                        X:     ClampScalar(BaseX + LaneStagger + JitterX, -HalfSpan + 1.2, HalfSpan - 1.2),
                        Y:     ClampScalar(LaneAnchors[Sub] + JitterY, -0.43 * Width, 0.43 * Width),
                        TiltZ: (Random() - 0.5) * 0.20
                    });
                }
            }

            const TopMat = Span.Kind === "road" ? CourseMaterial.Asphalt : CourseMaterial.ApronConcrete;
            const BayShardBuckets = Array.from({ length: BayCount }, () => []);

            for (let SiteIdx = 0; SiteIdx < TotalShardTarget; ++SiteIdx)
            {
                const SiteA = VoronoiSites[SiteIdx];
                let Cell = ConstructBox(Span.SpanLength, Width, Thickness);

                for (let OtherIdx = 0; OtherIdx < TotalShardTarget; ++OtherIdx)
                {
                    if (OtherIdx === SiteIdx)
                        continue;
                    const SiteB = VoronoiSites[OtherIdx];
                    const DX = SiteB.X - SiteA.X;
                    const DY = SiteB.Y - SiteA.Y;
                    if (Math.abs(DX) > 2.8 * BayLength)
                        continue;
                    const DistXY = Math.hypot(DX, DY);
                    if (DistXY < 0.25)
                        continue;
                    const MidX = 0.5 * (SiteA.X + SiteB.X);
                    const MidY = 0.5 * (SiteA.Y + SiteB.Y);
                    const PairSign = SiteIdx < OtherIdx ? 1.0 : -1.0;
                    const BevelZ = (SiteIdx < OtherIdx ? SiteA.TiltZ : -SiteB.TiltZ) * 0.65 * PairSign;
                    const Normal = NormalizeVector([DX / DistXY, DY / DistXY, BevelZ]);
                    const PlaneOffset = Normal[0] * MidX + Normal[1] * MidY - 0.008;
                    const Clipped = SplitPart(Cell, Normal, PlaneOffset);
                    if (Clipped)
                        Cell = Clipped[1];
                }

                const CutMat = (SiteIdx & 1) ? CourseMaterial.StoneInterior : CourseMaterial.ConcreteInterior;
                const PieceGeom = ConvertClippedPartToPiece(Cell, TopMat, CourseMaterial.TunnelConcrete, CutMat);
                const RelX = HalfSpan + PieceGeom.Centroid[0];
                const RelY = PieceGeom.Centroid[1];
                const RelZ = PieceGeom.Centroid[2] - 0.5 * Thickness;
                const RestWorld = SpanLocalToWorld(Span, RelX, RelY, RelZ);
                const OutwardY = Math.abs(RelY) > 0.2 ? Math.sign(RelY) : (SiteA.Sub === 0 ? -1.0 : 1.0);
                const AssignedBay = Math.min(BayCount - 1, Math.max(0, Math.floor(RelX / BayLength)));

                const ShardRecord = {
                    Slot:          SlotCursor++,
                    Occupant:      Block.First + SlotCursor - 1,
                    Triangles:     PieceGeom.Triangles,
                    RelX,
                    RelY,
                    RelZ,
                    RestWorld,
                    NormalizedU:   ClampScalar(RelX / Span.SpanLength + (Random() - 0.5) * 0.015, 0.005, 0.995),
                    OutwardDir:    NormalizeVector([(Random() - 0.35) * 0.45, OutwardY, 0.0]),
                    PitchRate:     (Random() - 0.5) * 2.4,
                    RollRate:      OutwardY * (0.55 + Random() * 1.45),
                    YawRate:       (Random() - 0.5) * 0.85,
                    TremorPhase:   Random() * Math.PI * 2.0,
                    Detached:      false,
                    DropTime:      0.0,
                    DropZ:         0.0,
                    VelocityZ:     0.0,
                    WorldPosition: RestWorld.slice()
                };
                BayShardBuckets[AssignedBay].push(ShardRecord);
                AllPieces.push(ShardRecord);
            }

            // 📝 2) CONTINUOUS JAGGED LIGHTNING FAULTLINE CRACK SPINE + FORKED BRANCHES (tapered spear-tip polyhedra, zero square corners!)
            let SpineY = (Random() - 0.5) * (Width * 0.28);

            for (let BayIdx = 0; BayIdx < BayCount; ++BayIdx)
            {
                const BayCenterRelX = (BayIdx + 0.5) * BayLength;
                const BayShards = BayShardBuckets[BayIdx];
                const FallbackShard = AllPieces[Math.max(0, AllPieces.length - 1)];

                const HalfBay = 0.5 * BayLength;
                const MidY1 = ClampScalar(SpineY + (Random() - 0.5) * 3.8, -0.38 * Width, 0.38 * Width);
                const NextSpineY = ClampScalar(MidY1 + (Random() - 0.5) * 4.0, -0.38 * Width, 0.38 * Width);
                const BranchSide = (Random() > 0.5 ? 1.0 : -1.0);
                const BranchTip1 = [
                    (Random() - 0.15) * (BayLength * 0.42),
                    ClampScalar(MidY1 + BranchSide * (2.8 + Random() * 3.0), -0.45 * Width, 0.45 * Width)
                ];
                const BranchTip2 = [
                    (Random() - 0.15) * (BayLength * 0.42),
                    ClampScalar(SpineY - BranchSide * (2.5 + Random() * 2.9), -0.45 * Width, 0.45 * Width)
                ];
                const CrackChains = [
                    [[-HalfBay, SpineY], [0.0, MidY1], 0.13],
                    [[0.0, MidY1], [HalfBay, NextSpineY], 0.13],
                    [[0.0, MidY1], BranchTip1, 0.09],
                    [[-0.22 * BayLength, 0.5 * (SpineY + MidY1)], BranchTip2, 0.085]
                ];
                SpineY = NextSpineY;

                const BayCracks = [];
                for (let CIdx = 0; CIdx < CracksPerBay; ++CIdx)
                {
                    const [P0, P1, CrackWidth] = CrackChains[CIdx];
                    const CrackGeom = ConstructCrackSegmentPiece(P0, P1, CrackWidth, 0.11, CourseMaterial.Tyre, CourseMaterial.StoneInterior);
                    const RelX = BayCenterRelX + CrackGeom.Centroid[0];
                    const RelY = CrackGeom.Centroid[1];
                    const HiddenWorld = SpanLocalToWorld(Span, RelX, RelY, -0.22);
                    const ParentShard = BayShards.length > 0 ? BayShards[CIdx % BayShards.length] : FallbackShard;
                    const CrackRecord = {
                        Slot:        SlotCursor++,
                        Occupant:    Block.First + SlotCursor - 1,
                        Triangles:   CrackGeom.Triangles,
                        RelX,
                        RelY,
                        NormalizedU: ClampScalar(RelX / Span.SpanLength, 0.002, 0.998),
                        ParentShard,
                        Opened:      false,
                        WorldPoint:  SpanLocalToWorld(Span, RelX, RelY, 0.02),
                        RestWorld:   HiddenWorld
                    };
                    BayCracks.push(CrackRecord);
                    AllPieces.push(CrackRecord);
                }

                Span.Bays.push({
                    Index:         BayIdx,
                    NormalizedU:   (BayIdx + 0.5) / BayCount,
                    ProxyOccupant: Block.ProxyFirst + Span.ProxyOffset + BayIdx,
                    Shards:        BayShards,
                    Cracks:        BayCracks,
                    Collapsed:     false
                });
            }

            Surface.BayDropZ.fill(0.0);
            Surface.BayPitch.fill(0.0);
            Surface.BayRoll.fill(0.0);
            Surface.BayIntact.fill(1);
        }

        // ③ Cascading sand/grit clump pool (warm sandstone/earth polyhedra pouring out of opening cracks & falling slabs)
        this.SandShards = [];
        const SandPalette = [CourseMaterial.Earth, CourseMaterial.StoneInterior, CourseMaterial.Wood];
        for (let SandIdx = 0; SandIdx < SandPoolCount; ++SandIdx)
        {
            const EX = 0.22 + Random() * 0.26;
            const EY = 0.20 + Random() * 0.24;
            const EZ = 0.16 + Random() * 0.20;
            const Mat = SandPalette[SandIdx % SandPalette.length];
            const SandBox = EmitBoxFacets(EX, EY, EZ, Mat);
            const ParkedWorld = [0.0, 0.0, -90.0];
            const SandRecord = {
                Slot:      SlotCursor++,
                Occupant:  Block.First + SlotCursor - 1,
                Triangles: PackFacetsAsPiece(SandBox, [0.0, 0.0, 0.5 * EZ]),
                Active:    false,
                Age:       0.0,
                Lifetime:  1.4,
                Position:  ParkedWorld.slice(),
                Velocity:  [0.0, 0.0, 0.0],
                SpinAxis:  NormalizeVector([Random() - 0.5, Random() - 0.5, Random() - 0.5]),
                SpinRate:  3.0 + Random() * 6.0,
                RestWorld: ParkedWorld
            };
            this.SandShards.push(SandRecord);
            AllPieces.push(SandRecord);
        }

        this.Pieces = AllPieces;
        this.UploadCompositeVertices(AllPieces, Device, VertexRecords);
        this.ResetAllPoses();
    }

    UploadCompositeVertices(Pieces, Device, VertexRecords = null)
    {
        const Block = this.Scene.CollapseBlock;
        const Set = this.Scene.FacetSets[Block.CompositeSet];
        const Facets = [];
        const Capacity = Set.VertexCapacity;
        const Bytes = new ArrayBuffer(Capacity * VertexStrideBytes);
        const Scalars = new Float32Array(Bytes);
        const Integers = new Uint32Array(Bytes);
        let Cursor = 0;

        for (let PieceIndex = 0; PieceIndex < Pieces.length; ++PieceIndex)
        {
            const Piece = Pieces[PieceIndex];
            if (Cursor + Piece.Triangles.length * 3 > Capacity)
                break;
            for (const Triangle of Piece.Triangles)
            {
                const [A, B, C] = Triangle.Corners;
                const Normal = NormalizeVector(CrossVector(SubtractVector(B, A), SubtractVector(C, A)));
                Facets.push({ Corners: [A, B, C], Family: Triangle.Family, OccupantOffset: PieceIndex });
                for (const Corner of [A, B, C])
                {
                    const Offset = Cursor * 8;
                    Scalars[Offset + 0] = Corner[0];
                    Scalars[Offset + 1] = Corner[1];
                    Scalars[Offset + 2] = Corner[2];
                    Integers[Offset + 3] = Triangle.Family;
                    Scalars[Offset + 4] = Normal[0];
                    Scalars[Offset + 5] = Normal[1];
                    Scalars[Offset + 6] = Normal[2];
                    Integers[Offset + 7] = PieceIndex;
                    ++Cursor;
                }
            }
        }
        Set.VertexCount = Cursor;
        Set.Facets = Facets;
        const TargetBuffer = VertexRecords || this.Scene.VertexRecords;
        if (Device && TargetBuffer)
            Device.queue.writeBuffer(TargetBuffer, Set.FirstVertex * VertexStrideBytes, Bytes, 0, Math.max(4, Cursor * VertexStrideBytes));
    }

    ResetAllPoses()
    {
        if (!this.Scene || !this.Scene.CollapseBlock)
            return;
        for (const Span of this.Spans)
            this.ResetSpan(Span);
        for (const Sand of this.SandShards)
        {
            Sand.Active = false;
            const Occupant = this.Scene.Occupants[Sand.Occupant];
            Occupant.Transform = ConstructRigidTransform([0.0, 0.0, -90.0], [0.0, 0.0, 0.0, 1.0]);
            Occupant.PreviousTransform = Occupant.Transform.slice();
        }
        this.Scene.ConstructDistanceList();
    }

    ResetSpan(Span)
    {
        Span.State = "armed";
        Span.Elapsed = 0.0;
        Span.ClearTimer = 0.0;
        Span.CrackFrontU = -0.02;
        Span.DropFrontU = -0.08;
        Span.Surface.BayDropZ.fill(0.0);
        Span.Surface.BayPitch.fill(0.0);
        Span.Surface.BayRoll.fill(0.0);
        Span.Surface.BayIntact.fill(1);

        const BaseQuat = ConstructAxisQuaternion([0.0, 0.0, 1.0], Span.Yaw);
        for (const Bay of Span.Bays)
        {
            Bay.Collapsed = false;
            if (this.Scene.Occupants[Bay.ProxyOccupant])
                this.Scene.Occupants[Bay.ProxyOccupant].Inactive = false;
            for (const Shard of Bay.Shards)
            {
                Shard.Detached = false;
                Shard.DropTime = 0.0;
                Shard.DropZ = 0.0;
                Shard.VelocityZ = 0.0;
                Shard.WorldPosition = Shard.RestWorld.slice();
                const Occupant = this.Scene.Occupants[Shard.Occupant];
                Occupant.Transform = ConstructRigidTransform(Shard.RestWorld, BaseQuat);
                Occupant.PreviousTransform = Occupant.Transform.slice();
            }
            for (const Crack of Bay.Cracks)
            {
                Crack.Opened = false;
                const Occupant = this.Scene.Occupants[Crack.Occupant];
                Occupant.Transform = ConstructRigidTransform(Crack.RestWorld, BaseQuat);
                Occupant.PreviousTransform = Occupant.Transform.slice();
            }
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                  FRAME ADVANCE, SAND STREAMS & VOLUMETRIC DUST
    //--------------------------------------------------------------------------------------------------------------------

    SpawnSandClump(Position, LateralDir, UpBoost = 1.0, FloorZ = -5.6)
    {
        const Sand = this.SandShards[this.SandCursor % this.SandShards.length];
        this.SandCursor++;
        Sand.Active = true;
        Sand.Age = 0.0;
        Sand.Lifetime = 1.35 + (this.SandCursor % 7) * 0.14;
        Sand.FloorZ = FloorZ;
        Sand.Position = Position.slice();
        const Hash = Math.sin(this.SandCursor * 12.9898 + this.Clock * 78.233) * 43758.5453;
        const Frac = Hash - Math.floor(Hash);
        const Frac2 = (Hash * 1.7) - Math.floor(Hash * 1.7);
        Sand.Velocity = [
            LateralDir[0] * (1.2 + Frac * 2.8) + (Frac2 - 0.5) * 2.2,
            LateralDir[1] * (1.2 + Frac * 2.8) + (Frac - 0.5) * 2.2,
            UpBoost * (1.2 + Frac2 * 2.6)
        ];
    }

    EmitSandSparks(Sparks, WorldPoint, Count, UpwardVelocity)
    {
        if (!Sparks || typeof Sparks.EmitBurst !== "function")
            return;
        Sparks.EmitBurst({
            Origin:      WorldPoint,
            Normal:      [0.0, 0.0, 1.0],
            Tangent:     [1.0, 0.0, 0.25],
            Velocity:    [0.0, 0.0, UpwardVelocity],
            Count,
            Speed:       4.8,
            Spread:      1.15,
            Lifetime:    0.62,
            Temperature: 1850.0
        });
    }

    TriggerSpan(Span)
    {
        if (Span.State !== "armed")
            return;
        Span.State = "collapsing";
        Span.Elapsed = 0.0;
        Span.CrackFrontU = 0.02;
        Span.DropFrontU = -0.04;
    }

    Advance(VehiclePosition, VehicleVelocity, Dt, Sparks = null)
    {
        if (!this.Enabled || !this.Scene || !this.Scene.CollapseBlock || !(Dt > 0.0))
            return false;

        const Step = Math.min(Dt, 0.05);
        this.Clock += Step;
        let DistanceChanged = false;
        let ActiveMotion = false;

        for (const Span of this.Spans)
        {
            const RelVec = SubtractVector(VehiclePosition, Span.StartWorld);
            const AlongX = RelVec[0] * Span.CosineYaw + RelVec[1] * Span.SineYaw;
            const AcrossY = -RelVec[0] * Span.SineYaw + RelVec[1] * Span.CosineYaw;
            const HeightDelta = VehiclePosition[2] - Span.DeckZ;
            const ForwardSpeed = VehicleVelocity
                ? (VehicleVelocity[0] * Span.CosineYaw + VehicleVelocity[1] * Span.SineYaw)
                : 0.0;

            const InsideDeckXY = AlongX >= 4.0 && AlongX <= Span.SpanLength - 6.0 && Math.abs(AcrossY) <= Span.Surface.HalfWidth + 0.8;
            if (Span.State === "armed" && InsideDeckXY && HeightDelta >= -0.8 && HeightDelta <= 4.0 && ForwardSpeed > -2.0)
                this.TriggerSpan(Span);

            // 📝 Auto-rearm once the player has cleared the district for 9 s after full collapse so runs are infinitely repeatable
            if (Span.State === "collapsed")
            {
                const DistFromMid = Math.hypot(AlongX - 0.5 * Span.SpanLength, AcrossY);
                if (DistFromMid > 85.0)
                {
                    Span.ClearTimer += Step;
                    if (Span.ClearTimer >= 9.0)
                    {
                        this.ResetSpan(Span);
                        DistanceChanged = true;
                        continue;
                    }
                }
                else
                    Span.ClearTimer = 0.0;
            }

            if (Span.State === "armed")
                continue;

            ActiveMotion = true;
            Span.Elapsed += Step;

            // ① Movie-crack wavefront races ahead at ~28 m/s; structural rear-to-front drop front chases ~0.40 s behind at ~18.5 m/s!
            const CrackRate = Span.CrackSpeed / Span.SpanLength;
            const DropRate = Span.DropSpeed / Span.SpanLength;
            Span.CrackFrontU = Math.min(1.12, 0.03 + Span.Elapsed * CrackRate);
            Span.DropFrontU = Span.Elapsed > Span.LeadDelay
                ? Math.min(1.12, (Span.Elapsed - Span.LeadDelay) * DropRate)
                : -0.02;

            const FloorWorldZ = Span.DeckZ - Span.ChasmDepth + 0.36;
            let AllResting = Span.DropFrontU >= 1.08;

            // ② Spawn cascading sand clumps & sparks strictly FROM THE ACTUAL CRACK SEAMS (never randomly across intact asphalt!)
            for (const Bay of Span.Bays)
            {
                for (const Crack of Bay.Cracks)
                {
                    if (!Crack.Opened && Span.CrackFrontU >= Crack.NormalizedU)
                    {
                        Crack.Opened = true;
                        const CrackWorld = SpanLocalToWorld(Span, Crack.RelX, Crack.RelY, 0.04);
                        Crack.WorldPoint = CrackWorld;
                        this.SpawnSandClump(CrackWorld, [-Span.SineYaw * 0.4, Span.CosineYaw * 0.4, 0.0], 0.95, FloorWorldZ);
                        this.EmitSandSparks(Sparks, CrackWorld, 4, 2.2);
                    }
                }
            }

            // ③ Update every bay's 3 Voronoi convex slabs + 4 movie crack ribbons + analytical support state
            for (const Bay of Span.Bays)
            {
                let SumDrop = 0.0;
                let DetachedCount = 0;

                for (const Shard of Bay.Shards)
                {
                    const Occupant = this.Scene.Occupants[Shard.Occupant];
                    Occupant.PreviousTransform.set(Occupant.Transform);

                    if (!Shard.Detached && Span.DropFrontU >= Shard.NormalizedU)
                    {
                        Shard.Detached = true;
                        Shard.VelocityZ = -0.65;
                    }

                    if (Shard.Detached)
                    {
                        DetachedCount++;
                        Shard.DropTime += Step;
                        const RestDrop = FloorWorldZ - Shard.RestWorld[2];
                        if (Shard.DropZ > RestDrop + 0.005 || Math.abs(Shard.VelocityZ) > 0.08)
                        {
                            AllResting = false;
                            Shard.VelocityZ -= GravityAcceleration * Step;
                            Shard.DropZ += Shard.VelocityZ * Step;
                            if (Shard.DropZ <= RestDrop)
                            {
                                Shard.DropZ = RestDrop;
                                Shard.VelocityZ = Math.abs(Shard.VelocityZ) > 1.6 ? -Shard.VelocityZ * 0.16 : 0.0;
                            }
                        }
                        const SettleT = Math.min(Shard.DropTime, 1.35);
                        const DriftXY = Math.min(Shard.DropTime * 0.85, 1.15);
                        const Pos = [
                            Shard.RestWorld[0] + (Span.CosineYaw * Shard.OutwardDir[0] - Span.SineYaw * Shard.OutwardDir[1]) * DriftXY,
                            Shard.RestWorld[1] + (Span.SineYaw * Shard.OutwardDir[0] + Span.CosineYaw * Shard.OutwardDir[1]) * DriftXY,
                            Shard.RestWorld[2] + Shard.DropZ
                        ];
                        Shard.WorldPosition = Pos;
                        const Quat = ComposeWorldQuaternion(
                            Span.Yaw,
                            Shard.PitchRate * SettleT * 0.36,
                            Shard.RollRate * SettleT * 0.34,
                            Shard.YawRate * SettleT * 0.25
                        );
                        Occupant.Transform = ConstructRigidTransform(Pos, Quat);
                        SumDrop += Shard.DropZ;
                    }
                    else if (Span.CrackFrontU >= Shard.NormalizedU)
                    {
                        // 📝 Active movie-crack propagation zone: slabs shudder, dip slightly, and micro-separate along Voronoi seams!
                        AllResting = false;
                        const CrackProgress = ClampScalar((Span.CrackFrontU - Shard.NormalizedU) / 0.16, 0.0, 1.0);
                        const Tremor = Math.sin(this.Clock * 48.0 + Shard.TremorPhase) * 0.032 * CrackProgress;
                        const Sag = -0.065 * CrackProgress + Tremor;
                        const Spread = 0.085 * CrackProgress;
                        Shard.DropZ = Sag;
                        const Pos = [
                            Shard.RestWorld[0] + (Span.CosineYaw * Shard.OutwardDir[0] - Span.SineYaw * Shard.OutwardDir[1]) * Spread,
                            Shard.RestWorld[1] + (Span.SineYaw * Shard.OutwardDir[0] + Span.CosineYaw * Shard.OutwardDir[1]) * Spread,
                            Shard.RestWorld[2] + Sag
                        ];
                        Shard.WorldPosition = Pos;
                        const Quat = ComposeWorldQuaternion(
                            Span.Yaw,
                            Math.sin(this.Clock * 36.0 + Shard.TremorPhase) * 0.022 * CrackProgress,
                            Shard.OutwardDir[1] * 0.028 * CrackProgress,
                            0.0
                        );
                        Occupant.Transform = ConstructRigidTransform(Pos, Quat);
                        SumDrop += Sag;
                    }
                }

                // ④ Animate the bay's 4 jagged faultline crack ribbons: erupt flush onto road as CrackFrontU passes!
                for (const Crack of Bay.Cracks)
                {
                    const Occupant = this.Scene.Occupants[Crack.Occupant];
                    Occupant.PreviousTransform.set(Occupant.Transform);
                    const Parent = Crack.ParentShard;
                    if (Parent.Detached)
                    {
                        const Pos = SpanLocalToWorld(Span, Crack.RelX, Crack.RelY, -0.55 + Parent.DropZ);
                        Occupant.Transform = ConstructRigidTransform(Pos, ConstructAxisQuaternion([0.0, 0.0, 1.0], Span.Yaw));
                    }
                    else if (Span.CrackFrontU >= Crack.NormalizedU)
                    {
                        // 📝 Erupts cleanly at the road fissure seam (+0.009 m) as a razor-tipped lightning tear!
                        const OpenT = ClampScalar((Span.CrackFrontU - Crack.NormalizedU) / 0.05, 0.0, 1.0);
                        const LiftZ = -0.048 + 0.057 * OpenT + Parent.DropZ;
                        const Pos = SpanLocalToWorld(Span, Crack.RelX, Crack.RelY, LiftZ);
                        Crack.WorldPoint = Pos;
                        Occupant.Transform = ConstructRigidTransform(Pos, ConstructAxisQuaternion([0.0, 0.0, 1.0], Span.Yaw));
                    }
                }

                const ShardCount = Math.max(1, Bay.Shards.length);
                const AvgDrop = SumDrop / ShardCount;
                Span.Surface.BayDropZ[Bay.Index] = DetachedCount > 0 ? AvgDrop : 0.0;
                Span.Surface.BayPitch[Bay.Index] = DetachedCount > 0 ? Math.min(-AvgDrop * 0.35, 0.14) : 0.0;
                Span.Surface.BayRoll[Bay.Index] = 0.0;

                // 📝 Once the bay drops more than 0.36 m, remove physical wheel support AND open the 3D SDF proxy to the sky!
                if (!Bay.Collapsed && AvgDrop <= -0.36)
                {
                    Bay.Collapsed = true;
                    Span.Surface.BayIntact[Bay.Index] = 0;
                    if (this.Scene.Occupants[Bay.ProxyOccupant])
                    {
                        this.Scene.Occupants[Bay.ProxyOccupant].Inactive = true;
                        DistanceChanged = true;
                    }
                }
            }

            if (AllResting)
                Span.State = "collapsed";
        }

        // ⑤ Advance pooled cascading sand/grit clumps
        for (const Sand of this.SandShards)
        {
            if (!Sand.Active)
                continue;
            ActiveMotion = true;
            const Occupant = this.Scene.Occupants[Sand.Occupant];
            Occupant.PreviousTransform.set(Occupant.Transform);
            Sand.Age += Step;
            if (Sand.Age >= Sand.Lifetime)
            {
                Sand.Active = false;
                Occupant.Transform = ConstructRigidTransform([0.0, 0.0, -90.0], [0.0, 0.0, 0.0, 1.0]);
                continue;
            }
            Sand.Velocity[2] -= GravityAcceleration * Step;
            Sand.Position[0] += Sand.Velocity[0] * Step;
            Sand.Position[1] += Sand.Velocity[1] * Step;
            Sand.Position[2] += Sand.Velocity[2] * Step;
            if (Sand.Position[2] < Sand.FloorZ)
            {
                Sand.Position[2] = Sand.FloorZ;
                Sand.Velocity[2] = Math.abs(Sand.Velocity[2]) * 0.22;
                Sand.Velocity[0] *= 0.65;
                Sand.Velocity[1] *= 0.65;
            }
            const Quat = ConstructAxisQuaternion(Sand.SpinAxis, Sand.Age * Sand.SpinRate);
            Occupant.Transform = ConstructRigidTransform(Sand.Position, Quat);
        }

        if (DistanceChanged)
            this.Scene.ConstructDistanceList();
        return ActiveMotion;
    }

    // 📝 Tight fissure-bound smoke vents positioned DIRECTLY on the opened jagged crack seams (Radius 0.24 m — never a 7 m fog blanket!):
    QuerySmokeEmissions()
    {
        const Emissions = [];
        for (const Span of this.Spans)
        {
            if (Span.State !== "collapsing")
                continue;

            const ActiveCracks = [];
            for (const Bay of Span.Bays)
            {
                for (const Crack of Bay.Cracks)
                {
                    if (!Crack.Opened)
                        continue;
                    if (Crack.ParentShard.Detached && Crack.ParentShard.DropTime > 0.55)
                        continue;
                    ActiveCracks.push(Crack);
                }
            }

            const StepStride = Math.max(1, Math.ceil(ActiveCracks.length / 9));
            for (let Idx = Math.max(0, ActiveCracks.length - 9 * StepStride); Idx < ActiveCracks.length; Idx += StepStride)
            {
                const Crack = ActiveCracks[Idx];
                const AgeU = Math.max(0.0, Span.CrackFrontU - Crack.NormalizedU);
                const Freshness = ClampScalar(1.0 - AgeU * 2.4, 0.30, 1.0);
                const Pos = [Crack.WorldPoint[0], Crack.WorldPoint[1], Crack.WorldPoint[2] + 0.02];
                Emissions.push({
                    Active:          true,
                    Burning:         false,
                    Strength:        0.55 * Freshness,
                    Position:        Pos,
                    Hub:             Pos,
                    Radius:          0.24,
                    Expansion:       0.32,
                    SmokeRate:       0.78 * Freshness,
                    SootRate:        0.0,
                    FlameRate:       0.0,
                    HeatRate:        0.14 * Freshness,
                    Velocity:        [0.0, 0.0, 1.35 + 0.55 * Freshness],
                    Plume:           null,
                    CombustionPower: 0.0,
                    Tread:           [0.0, 0.0, 0.0]
                });
            }
        }
        return Emissions;
    }

    static ComputePieceCapacity(Spans)
    {
        let Total = SandPoolCount;
        for (const Span of Spans)
            Total += Span.Surface.BayCount * (ShardsPerBay + CracksPerBay);
        return {
            PieceCount:     Total,
            VertexCapacity: Total * MaxTrianglesPerPiece * 3
        };
    }
}
