import { CourseMaterial } from "./MaterialSpecification.js";
//============================================================================================================================================
//                                                            FACETSTRUCTURE.JS
//============================================================================================================================================
// 🧩 Scene topology — facet sets (the ControlVehicle, the proving grounds, breakable props) and the occupants placing them.

import { RetrieveFacetStream } from "./FacetCodec.js";
import { ConstructCabinFacets } from "./CabinStructure.js";
import { ConstructRoofFixtureFacets } from "./LightingSystem.js";
import { ResolveLevelDescriptor } from "./LevelStructure.js";
import { ConstructSolid, TriangulateFace, FractureMaterials, FragmentTriangleBudget } from "./FractureStructure.js";
import { VehicleGeometry, ResolveCoMAuthoredZ } from "./VehicleSpecification.js";
import { ConstructIdentityTransform, ConstructRigidTransform, TransformBounds, InvertTransform, RotateVector, ConjugateQuaternion,
         SubtractVector, CrossVector, NormalizeVector } from "./TransformProjection.js";
import { StressShapes, ResolveStressPlacements } from "./StressLayout.js";
import { CollapseSequence } from "./CollapseSequence.js";
import { TramSequence } from "./TramSequence.js";
import { ServiceStationSequence } from "./ServiceStationSequence.js";
import { TrafficLightSequence } from "./TrafficLightSequence.js";
import { RoadEditorSequence, RoadEditorVertexCapacity } from "./RoadEditorSequence.js";
import { ConstructPoliceVehicleBodyFacets } from "./CityPursuitStructure.js";
import { ConstructMilitaryCarBodyFacets, DDayTankSpecs, DDayTurretSpecs, DDayCannonSpecs,
         DDayEnemyCarSpecs, DDayMineCoords } from "./DDayStructure.js";

// 📝 What an occupant takes part in. A ground tile only owns a surface card; the ground occupant is only rastered,
//    because the scene distance field carries the ground as its analytic plane rather than as a sampled volume.
export const OccupantRole = Object.freeze({
    Raster:   1,   // [-] - drawn into the surface projection and the shadow depth
    Distance: 2,   // [-] - unioned into the scene distance field from its own distance volume
    Cards:    4,   // [-] - owns surface cards in the card depot
    Dynamic:  8,   // [-] - transform may change every frame
    Fallback: 16   // [-] - card-less: a traced hit shades from the packed albedo (FirstCard) instead of reading cards
});

export const VertexStride = 32;   // [B] - position.xyz, family (u32), normal.xyz, occupant offset (u32; composite sets)

// 📝 Occupant identities travel through rgba16float texels (the scene distance field) and half-precision reservoir
//    fields, exact up to 2048; DistanceRecords.wgsl reserves 2045–2047 for sky, ground and vacancy. Every occupant,
//    stress pool included, must fit below this ceiling.
export const IdentityCeiling = 2044;   // [-]

// 📝 The ground tiling the card depot uses for the course plane: an 18 × 10 lattice of 12 m tiles over the pad and
//    four strips over the authored 480 m surround. A ground hit resolves its card from x, y alone through this layout.
export const GroundLayout = Object.freeze({
    PadMinimum:   Object.freeze([-60.0, -60.0]),   // [m]
    TileExtent:   12.0,                            // [m]
    TileCount:    Object.freeze([18, 10]),         // [-] along x, y
    OuterExtent:  420.0,                           // [m] half extent of the authored surround quad, about the pad centre
    PadDensity:   6.0,                             // [texel/m]
    StripDensity: 0.35                             // [texel/m]
});

//------------------------------------------------------------------------------------------------------------------------
//                                                   SCENE STRUCTURE
//------------------------------------------------------------------------------------------------------------------------

// 📝 Occupant order: the vehicle (re-uploaded every frame), the level's distance occupants, the cones, the intact
//    breakable props, their fragment occupants, the stress pool — together the distance span, every identity below the
//    ceiling — then the ground and its card tiles and the rastered-only level shapes. The union pass does not walk the
//    span: it walks the active list (ConstructDistanceList), so a sleeping fragment slot or a disabled stress slot
//    costs nothing.
export class SceneStructure
{
    constructor()
    {
        this.FacetSets        = [];
        this.Occupants        = [];
        this.VehicleOccupants = { Body: -1, Wheels: [-1, -1, -1, -1] };
        this.GroundTiles      = { First: -1, Strips: [-1, -1, -1, -1] };
        this.GroundOccupant   = -1;
        this.DistanceCount    = 0;
        this.BaseDistanceCount = 0;
        this.StressPool       = { First: 0, Capacity: 0, Active: 0, Placements: [], FacetSets: [] };
        this.ConeBlock        = { First: 0, Count: 0, Placements: [], FacetSet: -1 };
        this.Breakables       = [];
        this.DistanceList     = new Uint32Array(0);
        this.DrawRuns         = [];
        this.ShadowRuns       = [];
    }

    // 📝 StressCapacity reserves that many stress-test occupants (inactive until the stress sequence enables them) in
    //    the distance span, after the level and before the ground tiles, clamped to the identity ceiling.
    async ConstructScene(ArchiveFolder, StressCapacity = 0, LevelKey = "proving")
    {
        const Descriptor = ResolveLevelDescriptor(LevelKey);
        const ActiveShapes = Descriptor.Shapes;
        const [Body, Tyre, Rim] = await Promise.all([
            RetrieveFacetStream(`${ArchiveFolder}/ControlVehicleBody.facet`),
            RetrieveFacetStream(`${ArchiveFolder}/ControlVehicleTyre.facet`),
            RetrieveFacetStream(`${ArchiveFolder}/ControlVehicleRim.facet`)
        ]);

        // ① facet sets ------------------------------------------------------------------------------------------------
        // 📝 The cabin (CabinStructure.js) and roof fixture (LightingSystem.js) are part of the body: they move, shade, derez and enter the field with it.
        const ProjectedBody = ProjectBodyFacets(Body);
        const BodySet       = this.ConstructFacetSet("ControlVehicle body", [...ProjectedBody, ...ConstructCabinFacets(), ...ConstructRoofFixtureFacets(0)], 0.05, 40.0);
        this.VehicleBodySet = BodySet;
        const PoliceBodySet = this.ConstructFacetSet("Police ControlVehicle body", [...ConstructPoliceVehicleBodyFacets(ProjectedBody), ...ConstructCabinFacets()], 0.05, 40.0);
        this.PoliceBodySet  = PoliceBodySet;
        const EnemyCarBodySet = LevelKey === "dday"
            ? this.ConstructFacetSet("Military Patrol Car body", ConstructMilitaryCarBodyFacets(ProjectedBody), 0.05, 32.0)
            : -1;
        this.EnemyCarBodySet = EnemyCarBodySet;
        const WheelLeftSet  = this.ConstructFacetSet("ControlVehicle wheel (left)", ProjectWheelFacets(Tyre, Rim, false), 0.025, 40.0);
        const WheelRightSet = this.ConstructFacetSet("ControlVehicle wheel (right)", ProjectWheelFacets(Tyre, Rim, true), 0.025, 40.0);
        const GroundSet     = this.ConstructFacetSet(Descriptor.Title, Descriptor.EmitGround(), 0.0, 0.0);
        const ShapeSets = {};
        for (const [Key, Shape] of Object.entries(ActiveShapes))
            ShapeSets[Key] = this.ConstructFacetSet(Key, Shape.Emit(), Shape.Distance === false ? 0.0 : Shape.Voxel, Shape.Cards);

        // ② the vehicle --------------------------------------------------------------------------------------------------
        const VehicleRoles = OccupantRole.Raster | OccupantRole.Distance | OccupantRole.Cards | OccupantRole.Dynamic;
        const StaticRoles  = OccupantRole.Raster | OccupantRole.Distance | OccupantRole.Cards;
        this.VehicleOccupants.Body = this.ConstructOccupant("ControlVehicle", BodySet, ConstructIdentityTransform(), VehicleRoles);
        const WheelNames = ["Wheel FL", "Wheel FR", "Wheel RL", "Wheel RR"];
        for (let Wheel = 0; Wheel < 4; ++Wheel)
        {
            const Set = (Wheel & 1) ? WheelRightSet : WheelLeftSet;
            this.VehicleOccupants.Wheels[Wheel] = this.ConstructOccupant(WheelNames[Wheel], Set, ConstructIdentityTransform(), VehicleRoles);
        }
        this.DynamicCount = this.Occupants.length;

        // ③ the level's distance occupants; rastered-only shapes wait until after the ground ----------------------------
        const RasterOnly = [];
        for (const Placement of Descriptor.Placements())
        {
            if (ActiveShapes[Placement.Shape].Distance === false)
            {
                RasterOnly.push(Placement);
                continue;
            }
            const Index = this.ConstructOccupant(Placement.Name, ShapeSets[Placement.Shape], ResolvePlacementTransform(Placement), StaticRoles,
                                                 Placement.Material);
            this.Occupants[Index].Obstacle = Placement.Collider;
            this.Occupants[Index].Level = Placement.Shape;
        }

        // ③ cones: rigid bodies at rest — in the field and carded like any static occupant (Dynamic only so a knocked
        //    cone's motion invalidates the field; Moving lifts it onto the every-frame relighting list while it moves)
        const ConeRoles = StaticRoles | OccupantRole.Dynamic;
        const ConePlacements = Descriptor.Cones();
        this.ConeBlock = { First: this.Occupants.length, Count: ConePlacements.length, Placements: ConePlacements, FacetSet: ShapeSets.Cone };
        ConePlacements.forEach((Placement, Cone) =>
        {
            const ShapeKey = (Placement.Shape && ShapeSets[Placement.Shape] !== undefined) ? Placement.Shape : "Cone";
            const BaseZ = Placement.Position[2] ?? 0.0;
            const Half = 0.5 * Placement.Yaw;
            const Transform = ConstructRigidTransform([Placement.Position[0], Placement.Position[1], BaseZ], [0.0, 0.0, Math.sin(Half), Math.cos(Half)]);
            const Index = this.ConstructOccupant(Placement.Name, ShapeSets[ShapeKey], Transform, ConeRoles);
            this.Occupants[Index].Cone = Cone;
            this.Occupants[Index].Moving = false;
            this.Occupants[Index].RestTransform = Transform;
        });

        // ③b proximity-triggered kinetic bollards (linear retracting gates & travelling seesaw wave strips)
        const RawBollardZones = Descriptor.Bollards ? Descriptor.Bollards() : [];
        const BollardFirst = this.Occupants.length;
        const BuiltBollardZones = RawBollardZones.map((Zone) =>
        {
            for (let PostIndex = 0; PostIndex < Zone.Posts.length; ++PostIndex)
            {
                const Post = Zone.Posts[PostIndex];
                const Half = 0.5 * (Post.Yaw || 0.0);
                const Transform = ConstructRigidTransform(Post.Position, [0.0, 0.0, Math.sin(Half), Math.cos(Half)]);
                const Index = this.ConstructOccupant(`${Zone.Id} bollard ${PostIndex}`, ShapeSets[Post.Shape], Transform, ConeRoles, Post.Material ?? -1);
                this.Occupants[Index].Obstacle = true;
                this.Occupants[Index].Bollard = true;
                this.Occupants[Index].Moving = false;
                this.Occupants[Index].RestTransform = Transform;
            }
            return Zone;
        });
        const BollardAfterPosts = this.Occupants.length;
        for (const Zone of BuiltBollardZones)
        {
            if (Zone.Beacon && ShapeSets[Zone.Beacon.Shape] !== undefined)
            {
                const Half = 0.5 * (Zone.Beacon.Yaw || 0.0);
                const Transform = ConstructRigidTransform(Zone.Beacon.Position, [0.0, 0.0, Math.sin(Half), Math.cos(Half)]);
                const BeaconIdx = this.ConstructOccupant(`${Zone.Name} beacon`, ShapeSets[Zone.Beacon.Shape], Transform, ConeRoles, CourseMaterial.WallCrimson);
                this.Occupants[BeaconIdx].Obstacle = false;
                this.Occupants[BeaconIdx].Moving = false;
                Zone.BeaconOccupant = BeaconIdx;
            }
        }
        this.BollardBlock = { First: BollardFirst, Count: BollardAfterPosts - BollardFirst, Zones: BuiltBollardZones };

        // ③c seismic collapse bay distance proxies (distance + card occlusion only; visual mesh is session-baked Voronoi slabs!)
        const RawCollapseSpans = Descriptor.CollapseSpans ? Descriptor.CollapseSpans() : [];
        const ProxyFirst = this.Occupants.length;
        if (RawCollapseSpans.length > 0 && ShapeSets.CollapseBayProxy !== undefined)
        {
            const ProxyRoles = OccupantRole.Distance | OccupantRole.Cards | OccupantRole.Dynamic;
            for (const Span of RawCollapseSpans)
            {
                const Half = 0.5 * Span.Yaw;
                const Quat = [0.0, 0.0, Math.sin(Half), Math.cos(Half)];
                for (let BayIdx = 0; BayIdx < Span.Surface.BayCount; ++BayIdx)
                {
                    const RelX = (BayIdx + 0.5) * Span.Surface.BayLength;
                    const Pos = [
                        Span.StartWorld[0] + Span.CosineYaw * RelX,
                        Span.StartWorld[1] + Span.SineYaw * RelX,
                        Span.DeckZ - 0.60
                    ];
                    const Index = this.ConstructOccupant(`${Span.Id} bay proxy ${BayIdx}`, ShapeSets.CollapseBayProxy,
                                                         ConstructRigidTransform(Pos, Quat), ProxyRoles);
                    this.Occupants[Index].Moving = false;
                }
            }
        }
        const ProxyCount = this.Occupants.length - ProxyFirst;

        // ③d dedicated articulated streetcar trams & express rail trains (added separately with dynamic GI, shadows & collision)
        const RawTrams = Descriptor.Trams ? Descriptor.Trams() : [];
        const TramFirst = this.Occupants.length;
        for (const Consist of RawTrams)
        {
            if (ShapeSets[Consist.Shape] === undefined)
                continue;
            const Yaw = Consist.Direction >= 0.0 ? 0.0 : Math.PI;
            const Quat = [0.0, 0.0, Math.sin(0.5 * Yaw), Math.cos(0.5 * Yaw)];
            for (let CarIdx = 0; CarIdx < Consist.CarCount; ++CarIdx)
            {
                const Pos = [Consist.StartX, Consist.LaneY, Consist.BaseZ || 0.0];
                const Index = this.ConstructOccupant(`${Consist.Name} car ${CarIdx}`, ShapeSets[Consist.Shape],
                                                     ConstructRigidTransform(Pos, Quat), ConeRoles);
                this.Occupants[Index].Moving = false;
            }
        }
        this.TramBlock = { First: TramFirst, Count: this.Occupants.length - TramFirst, Consists: RawTrams };

        // ③e multi-axis industrial robot arms: Auto-Fuel / 800V EV bays + Megafactory spot-welding assembly cells
        const RawStations = Descriptor.ServiceStations ? Descriptor.ServiceStations() : [];
        const RawFactoryRobots = Descriptor.FactoryRobots ? Descriptor.FactoryRobots() : [];
        const ServiceFirst = this.Occupants.length;
        const ConstructIndustrialRobotOccupants = (Label, BasePos, EndEffectorShapeKey) =>
        {
            if (ShapeSets.IndustrialRobotPedestal === undefined ||
                ShapeSets.IndustrialRobotTurret === undefined ||
                ShapeSets.IndustrialRobotUpperArm === undefined ||
                ShapeSets.IndustrialRobotForearm === undefined ||
                ShapeSets[EndEffectorShapeKey] === undefined)
            {
                return;
            }
            const IdQuat = [0.0, 0.0, 0.0, 1.0];
            const BaseXform = ConstructRigidTransform(BasePos, IdQuat);
            const PIdx = this.ConstructOccupant(`${Label} pedestal`,  ShapeSets.IndustrialRobotPedestal,    BaseXform, ConeRoles);
            const TIdx = this.ConstructOccupant(`${Label} turret`,    ShapeSets.IndustrialRobotTurret,      BaseXform, ConeRoles);
            const UIdx = this.ConstructOccupant(`${Label} upper arm`, ShapeSets.IndustrialRobotUpperArm,    BaseXform, ConeRoles);
            const FIdx = this.ConstructOccupant(`${Label} forearm`,   ShapeSets.IndustrialRobotForearm,     BaseXform, ConeRoles);
            const WIdx = this.ConstructOccupant(`${Label} wrist`,     ShapeSets[EndEffectorShapeKey],       BaseXform, ConeRoles);
            this.Occupants[PIdx].Obstacle = true;
            this.Occupants[PIdx].Moving   = false;
            this.Occupants[TIdx].Moving   = false;
            this.Occupants[UIdx].Moving   = false;
            this.Occupants[FIdx].Moving   = false;
            this.Occupants[WIdx].Moving   = false;
        };
        for (let StIdx = 0; StIdx < RawStations.length; ++StIdx)
        {
            const St = RawStations[StIdx];
            const CouplerKey = St.Kind === "electric" ? "IndustrialRobotCouplerEV" : "IndustrialRobotCouplerFuel";
            ConstructIndustrialRobotOccupants(St.Name, St.BasePosition || St.DockPosition, CouplerKey);
        }
        for (let RbIdx = 0; RbIdx < RawFactoryRobots.length; ++RbIdx)
        {
            const Rb = RawFactoryRobots[RbIdx];
            ConstructIndustrialRobotOccupants(Rb.Name, Rb.BasePosition, "IndustrialRobotWelder");
        }
        this.ServiceBlock = {
            First:         ServiceFirst,
            Count:         this.Occupants.length - ServiceFirst,
            Stations:      RawStations,
            FactoryRobots: RawFactoryRobots
        };

        // ③g pole-less hovering robotic intersection traffic signal housings (+ 4 reserve slots for custom spline junctions)
        const RawTrafficLights = Descriptor.TrafficLights ? Descriptor.TrafficLights() : [];
        const DynamicSignalSlots = 6;
        const TotalTrafficSlots = RawTrafficLights.length > 0 ? (RawTrafficLights.length + DynamicSignalSlots) : 0;
        const TrafficHousingFirst = this.Occupants.length;
        if (TotalTrafficSlots > 0 && ShapeSets.HoverTrafficHousing !== undefined)
        {
            const Parked = ConstructRigidTransform([0.0, 0.0, -40.0], [0.0, 0.0, 0.0, 1.0]);
            for (let SigIdx = 0; SigIdx < TotalTrafficSlots; ++SigIdx)
            {
                const Spec = RawTrafficLights[SigIdx];
                const Half = 0.5 * (Spec?.Yaw || 0.0);
                const Initial = Spec
                    ? ConstructRigidTransform(Spec.Anchor, [0.0, 0.0, Math.sin(Half), Math.cos(Half)])
                    : Parked;
                const OccIdx = this.ConstructOccupant(Spec?.Name || `Spline Junction Signal ${SigIdx - RawTrafficLights.length + 1}`,
                                                      ShapeSets.HoverTrafficHousing, Initial, ConeRoles);
                this.Occupants[OccIdx].Moving = false;
                if (!Spec)
                    this.Occupants[OccIdx].Inactive = true;
            }
        }

        // ④ breakable props, whole: rastered, in the field, carded and a collider until they break ------------------------
        const BreakableSets = new Map();
        this.Breakables = Descriptor.Breakables().map((Definition) =>
        {
            const Material = FractureMaterials[Definition.Material];
            const Key = Definition.Material + JSON.stringify(Definition.Shape);
            if (!BreakableSets.has(Key))
            {
                // 📝 Volume voxel from the prop's largest side (about 40 across), never finer than 5 cm.
                const Longest = Definition.Shape.Kind === "prism" ? Math.max(2.0 * Definition.Shape.Radius, Definition.Shape.Height)
                                                                 : Math.max(...Definition.Shape.Extent);
                BreakableSets.set(Key, this.ConstructFacetSet(`${Material.Label} ${Definition.Shape.Kind}`,
                                                              EmitSolidFacets(ConstructSolid(Definition.Shape), Material.Skin),
                                                              Math.max(0.05, Longest / 40.0), 16.0));
            }
            const Height = Definition.Shape.Kind === "prism" ? Definition.Shape.Height : Definition.Shape.Extent[2];
            const Centre = [Definition.Position[0], Definition.Position[1], Definition.Position[2] + 0.5 * Height];
            const Orientation = [0.0, 0.0, Math.sin(0.5 * Definition.Yaw), Math.cos(0.5 * Definition.Yaw)];
            const Intact = this.ConstructOccupant(Definition.Name, BreakableSets.get(Key), ConstructRigidTransform(Centre, Orientation), StaticRoles);
            this.Occupants[Intact].Obstacle = true;
            this.Occupants[Intact].Breakable = true;
            const Size = Definition.Shape.Kind === "prism" ? [2.0 * Definition.Shape.Radius, 2.0 * Definition.Shape.Radius, Height]
                                                          : Definition.Shape.Extent;
            const Local = RotateVector(ConjugateQuaternion(Orientation), Definition.Approach);
            return { ...Definition, Centre, Orientation, Size, Radius: 0.5 * Math.hypot(Size[0], Size[1], Size[2]),
                     Depth: Math.abs(Local[0]) * Size[0] + Math.abs(Local[1]) * Size[1] + Math.abs(Local[2]) * Size[2],
                     Impact: Local.map((Component, Axis) => Math.max(-0.5 * Size[Axis], Math.min(0.5 * Size[Axis], Component * 10.0)))
                                  .map((Component, Axis) => (Axis === 2 ? -0.15 * Size[2] : Component)),
                     IntactOccupant: Intact, PieceFirst: -1, CompositeSet: -1 };
        });

        // ⑤ every breakable's fragments: one composite facet set with reserved room, Capacity occupants, all asleep.
        //    Only the first (the anchor) is rastered: it draws the whole set, each vertex naming its own fragment. A
        //    fragment enters the field (Distance) only once FractureSequence gives it a volume in the fragment pool.
        for (const Breakable of this.Breakables)
        {
            const Set = this.ConstructFacetSet(`${Breakable.Name} fragments`, [], 0.0, 0.0);
            const Reach = 0.5 * Math.max(...Breakable.Size);
            this.FacetSets[Set].LocalMinimum = [-Reach, -Reach, -Reach];
            this.FacetSets[Set].LocalMaximum = [Reach, Reach, Reach];
            this.FacetSets[Set].VertexCapacity = Breakable.Capacity * FragmentTriangleBudget * 3;
            this.FacetSets[Set].Composite = true;
            Breakable.CompositeSet = Set;
            Breakable.PieceFirst = this.Occupants.length;
            const Rest = ConstructRigidTransform(Breakable.Centre, Breakable.Orientation);
            for (let Slot = 0; Slot < Breakable.Capacity; ++Slot)
            {
                const Roles = Slot === 0 ? (OccupantRole.Raster | OccupantRole.Dynamic) : OccupantRole.Dynamic;
                const Index = this.ConstructOccupant(`${Breakable.Name} fragment ${Slot}`, Set, Rest, Roles);
                this.Occupants[Index].Inactive = true;
                this.Occupants[Index].Fragment = true;
                this.Occupants[Index].Moving = false;
            }
        }

        // ⑤b Police Interceptor Cruiser (same ControlVehicle chassis + 4 wheels, full GDF distance & cards) ------------
        const ParkedBelow   = ConstructRigidTransform([0.0, 0.0, -45.0], [0.0, 0.0, 0.0, 1.0]);
        const CruiserFirst  = this.Occupants.length;
        const CruiserBody   = this.ConstructOccupant("Police ControlVehicle", PoliceBodySet, ParkedBelow, VehicleRoles);
        const CruiserWheels = [-1, -1, -1, -1];
        for (let Wheel = 0; Wheel < 4; ++Wheel)
        {
            const Set = (Wheel & 1) ? WheelRightSet : WheelLeftSet;
            CruiserWheels[Wheel] = this.ConstructOccupant(`Police ${WheelNames[Wheel]}`, Set, ParkedBelow, VehicleRoles);
        }

        // ⑤c D-Day Assault Distance Actors (4 Allied Assault Tank hulls + 5 Enemy Patrol Car bodies) ---------------
        const DDayDistanceIndices = [];
        const DDayTankHulls = [];
        const DDayEnemyCarBodies = [];
        let DDayDistanceFirst = -1;
        if (LevelKey === "dday" && ShapeSets.AssaultTankHull !== undefined && EnemyCarBodySet >= 0)
        {
            DDayDistanceFirst = this.Occupants.length;
            for (let I = 0; I < DDayTankSpecs.length; ++I)
            {
                const Idx = this.ConstructOccupant(`D-Day ${DDayTankSpecs[I].Name} Hull`, ShapeSets.AssaultTankHull, ParkedBelow, VehicleRoles);
                DDayTankHulls.push(Idx);
                DDayDistanceIndices.push(Idx);
            }
            for (let I = 0; I < DDayEnemyCarSpecs.length; ++I)
            {
                const Idx = this.ConstructOccupant(`D-Day ${DDayEnemyCarSpecs[I].Name} Body`, EnemyCarBodySet, ParkedBelow, VehicleRoles);
                DDayEnemyCarBodies.push(Idx);
                DDayDistanceIndices.push(Idx);
            }
        }
        const DDayDistanceCount = DDayDistanceFirst >= 0 ? (this.Occupants.length - DDayDistanceFirst) : 0;

        // ⑥ the stress pool: shaped in runs, placed by slot, inactive until enabled -----------------------------------
        this.BaseDistanceCount = this.Occupants.length;
        const DDayRasterReserve = LevelKey === "dday" ? 132 : 0;
        const GroundOccupants = 1 + GroundLayout.TileCount[0] * GroundLayout.TileCount[1] + 4 + 128 + DDayRasterReserve;
        const Capacity = Math.max(0, Math.min(Math.floor(StressCapacity), IdentityCeiling - this.BaseDistanceCount - GroundOccupants));
        const StressSets = StressShapes.map((Shape) => this.ConstructFacetSet(Shape.Name, Shape.Emit(), Shape.DistanceVoxel, Shape.CardDensity));
        this.StressPool = { First: this.Occupants.length, Capacity, Active: 0, Placements: ResolveStressPlacements(Capacity, Descriptor.ClearZones), FacetSets: StressSets };
        this.StressPool.Placements.forEach((Placement, Slot) =>
        {
            const Half = 0.5 * Placement.Yaw;
            const Transform = ConstructRigidTransform(Placement.Position, [0.0, 0.0, Math.sin(Half), Math.cos(Half)]);
            const Index = this.ConstructOccupant(`Stress ${Slot}`, StressSets[Placement.Shape], Transform, StaticRoles, Placement.Family);
            this.Occupants[Index].Inactive = true;
            this.Occupants[Index].StressSlot = Slot;
            this.Occupants[Index].RestTransform = Transform;
            this.Occupants[Index].Obstacle = true;
        });
        this.DistanceCount = this.Occupants.length;

        // ⑦ the ground: rastered once, carded as tiles ----------------------------------------------------------------
        this.GroundOccupant = this.ConstructOccupant("Proving ground", GroundSet, ConstructIdentityTransform(), OccupantRole.Raster);
        this.GroundTiles.First = this.Occupants.length;
        for (let Row = 0; Row < GroundLayout.TileCount[0]; ++Row)
        {
            for (let Column = 0; Column < GroundLayout.TileCount[1]; ++Column)
            {
                const MinimumX = GroundLayout.PadMinimum[0] + Row * GroundLayout.TileExtent;
                const MinimumY = GroundLayout.PadMinimum[1] + Column * GroundLayout.TileExtent;
                const Tile = this.ConstructOccupant(`Ground tile ${Row},${Column}`, GroundSet, ConstructIdentityTransform(),
                                                    OccupantRole.Cards);
                this.AssignCardBounds(Tile, [MinimumX, MinimumY, -0.05],
                                      [MinimumX + GroundLayout.TileExtent, MinimumY + GroundLayout.TileExtent, 0.05], GroundLayout.PadDensity);
            }
        }
        const [PadX0, PadY0] = GroundLayout.PadMinimum;
        const PadX1 = PadX0 + GroundLayout.TileExtent * GroundLayout.TileCount[0], PadY1 = PadY0 + GroundLayout.TileExtent * GroundLayout.TileCount[1];
        const CentreX = 0.5 * (PadX0 + PadX1), CentreY = 0.5 * (PadY0 + PadY1), Outer = GroundLayout.OuterExtent;
        const StripBounds = [[[CentreX - Outer, CentreY - Outer], [PadX0, CentreY + Outer]], [[PadX1, CentreY - Outer], [CentreX + Outer, CentreY + Outer]],
                             [[PadX0, CentreY - Outer], [PadX1, PadY0]],                      [[PadX0, PadY1], [PadX1, CentreY + Outer]]];
        const StripNames = ["West", "East", "South", "North"];
        for (let Strip = 0; Strip < 4; ++Strip)
        {
            const [Low, High] = StripBounds[Strip];
            const Occupant = this.ConstructOccupant(`Ground strip ${StripNames[Strip]}`, GroundSet, ConstructIdentityTransform(),
                                                    OccupantRole.Cards);
            this.AssignCardBounds(Occupant, [Low[0], Low[1], -0.05], [High[0], High[1], 0.05], GroundLayout.StripDensity);
            this.GroundTiles.Strips[Strip] = Occupant;
        }

        // ⑧ rastered-only level shapes (the light poles, gantry posts, signs) --------------------------------------------
        for (const Placement of RasterOnly)
        {
            const Index = this.ConstructOccupant(Placement.Name, ShapeSets[Placement.Shape], ResolvePlacementTransform(Placement), OccupantRole.Raster,
                                                 Placement.Material);
            this.Occupants[Index].Obstacle = Placement.Collider;
            this.Occupants[Index].Level = Placement.Shape;
        }

        // ⑨ session-baked fractured collapsing bridge & road composite slabs, propagating movie cracks & sand clumps -----
        this.CollapseBlock = null;
        this.Collapse = null;
        if (RawCollapseSpans.length > 0)
        {
            const Budget = CollapseSequence.ComputePieceCapacity(RawCollapseSpans);
            const CollapseSet = this.ConstructFacetSet("Session collapse decks", [], 0.0, 0.0);
            this.FacetSets[CollapseSet].LocalMinimum = [-8.0, -8.0, -2.0];
            this.FacetSets[CollapseSet].LocalMaximum = [ 8.0,  8.0,  2.0];
            this.FacetSets[CollapseSet].VertexCapacity = Budget.VertexCapacity;
            this.FacetSets[CollapseSet].Composite = true;
            const CollapseFirst = this.Occupants.length;
            const Identity = ConstructIdentityTransform();
            for (let Slot = 0; Slot < Budget.PieceCount; ++Slot)
            {
                const Roles = Slot === 0 ? (OccupantRole.Raster | OccupantRole.Dynamic) : OccupantRole.Dynamic;
                const Index = this.ConstructOccupant(`Collapse piece ${Slot}`, CollapseSet, Identity, Roles);
                this.Occupants[Index].Moving = false;
            }
            this.CollapseBlock = {
                CompositeSet: CollapseSet,
                First:        CollapseFirst,
                Count:        Budget.PieceCount,
                ProxyFirst,
                ProxyCount,
                Spans:        RawCollapseSpans
            };
            this.Collapse = new CollapseSequence(this, RawCollapseSpans);
        }

        this.Trams = RawTrams.length > 0 ? new TramSequence(this, RawTrams) : null;
        this.ServiceStations = (RawStations.length > 0 || RawFactoryRobots.length > 0)
            ? new ServiceStationSequence(this, RawStations, RawFactoryRobots)
            : null;

        // ⑩ hovering robotic traffic light optical aspect pucks (Red / Orange / Yellow / Green) — rastered + dynamic!
        this.TrafficBlock = null;
        this.TrafficLights = null;
        if (TotalTrafficSlots > 0 && ShapeSets.HoverTrafficHousing !== undefined && ShapeSets.TrafficAspectRed !== undefined)
        {
            const LensFirst = this.Occupants.length;
            const LensShapes = [
                ShapeSets.TrafficAspectRed,
                ShapeSets.TrafficAspectOrange,
                ShapeSets.TrafficAspectYellow,
                ShapeSets.TrafficAspectGreen
            ];
            const Parked = ConstructRigidTransform([0.0, 0.0, -40.0], [0.0, 0.0, 0.0, 1.0]);
            for (let SigIdx = 0; SigIdx < TotalTrafficSlots; ++SigIdx)
            {
                for (let Aspect = 0; Aspect < 4; ++Aspect)
                {
                    const Occ = this.ConstructOccupant(`Traffic signal ${SigIdx} aspect ${Aspect}`, LensShapes[Aspect],
                                                       Parked, OccupantRole.Raster | OccupantRole.Dynamic);
                    this.Occupants[Occ].Moving = false;
                    if (SigIdx >= RawTrafficLights.length)
                        this.Occupants[Occ].Inactive = true;
                }
            }
            this.TrafficBlock = {
                HousingFirst: TrafficHousingFirst,
                LensFirst,
                BaseCount:    RawTrafficLights.length,
                DynamicSlots: DynamicSignalSlots,
                TotalCount:   TotalTrafficSlots
            };
            this.TrafficLights = new TrafficLightSequence(this, RawTrafficLights, DynamicSignalSlots);
        }

        // ⑩b Police Aerial Pursuit Units (Pursuit Helicopter + rotors + 3 Police Interceptor Drones — dynamic raster) --
        let AerialFirst = -1, HeliBody = -1, HeliMainRotor = -1, HeliTailRotor = -1;
        const PoliceDrones = [-1, -1, -1];
        if (ShapeSets.PoliceHelicopterBody !== undefined && ShapeSets.PoliceInterceptorDrone !== undefined)
        {
            const AerialRoles = OccupantRole.Raster | OccupantRole.Dynamic;
            AerialFirst   = this.Occupants.length;
            HeliBody      = this.ConstructOccupant("Police Helicopter Body",       ShapeSets.PoliceHelicopterBody,      ParkedBelow, AerialRoles);
            HeliMainRotor = this.ConstructOccupant("Police Helicopter Main Rotor", ShapeSets.PoliceHelicopterMainRotor, ParkedBelow, AerialRoles);
            HeliTailRotor = this.ConstructOccupant("Police Helicopter Tail Rotor", ShapeSets.PoliceHelicopterTailRotor, ParkedBelow, AerialRoles);
            for (let D = 0; D < 3; ++D)
                PoliceDrones[D] = this.ConstructOccupant(`Police Interceptor Drone ${D}`, ShapeSets.PoliceInterceptorDrone, ParkedBelow, AerialRoles);
        }
        this.PoliceBlock = {
            CruiserFirst,
            CruiserCount: 5,
            CruiserBody,
            CruiserWheels,
            AerialFirst,
            AerialCount:  AerialFirst >= 0 ? 6 : 0,
            HeliBody,
            HeliMainRotor,
            HeliTailRotor,
            Drones:       PoliceDrones
        };

        // ⑩c D-Day Assault Dynamic Raster Actors (tank turrets/barrels, car wheels, MG turrets, cannons, bombers, bombs, shells, tracers, mines, blasts, craters)
        this.DDayBlock = null;
        if (LevelKey === "dday" && DDayDistanceFirst >= 0)
        {
            const DDayRasterRoles = OccupantRole.Raster | OccupantRole.Dynamic;
            const RasterIndices = [];
            const RasterFirst = this.Occupants.length;
            const PushRaster = (Label, SetIdx) =>
            {
                const Idx = this.ConstructOccupant(Label, SetIdx, ParkedBelow, DDayRasterRoles);
                RasterIndices.push(Idx);
                return Idx;
            };

            const TankTurrets = DDayTankSpecs.map((S) => PushRaster(`D-Day ${S.Name} Turret`, ShapeSets.AssaultTankTurret));
            const TankBarrels = DDayTankSpecs.map((S) => PushRaster(`D-Day ${S.Name} Barrel`, ShapeSets.AssaultTankBarrel));

            const EnemyCarWheels = [];
            for (let C = 0; C < DDayEnemyCarSpecs.length; ++C)
            {
                for (let W = 0; W < 4; ++W)
                    EnemyCarWheels.push(PushRaster(`D-Day ${DDayEnemyCarSpecs[C].Name} ${WheelNames[W]}`, (W & 1) ? WheelRightSet : WheelLeftSet));
            }

            const Turrets = DDayTurretSpecs.map((S) => PushRaster(`D-Day ${S.Name}`, ShapeSets.MachineGunTurret));
            const Cannons = DDayCannonSpecs.map((S) => PushRaster(`D-Day ${S.Name}`, ShapeSets.CoastalCannonTurret));

            const BomberBodies = [0, 1].map((I) => PushRaster(`D-Day Bomber ${I} Body`, ShapeSets.AttackBomberBody));
            const BomberProps  = [0, 1, 2, 3].map((I) => PushRaster(`D-Day Bomber Prop ${I}`, ShapeSets.AttackBomberProps));

            const Bombs      = Array.from({ length: 8  }, (_, I) => PushRaster(`D-Day Aerial Bomb ${I}`, ShapeSets.AerialBomb));
            const Shells     = Array.from({ length: 6  }, (_, I) => PushRaster(`D-Day Artillery Shell ${I}`, ShapeSets.ArtilleryShell));
            const Tracers    = Array.from({ length: 18 }, (_, I) => PushRaster(`D-Day Tracer Bolt ${I}`, ShapeSets.TracerBolt));
            const Mines      = DDayMineCoords.map((_, I) => PushRaster(`D-Day Landmine ${I}`, ShapeSets.Landmine));
            const Explosions = Array.from({ length: 8  }, (_, I) => PushRaster(`D-Day Explosion Dome ${I}`, ShapeSets.ExplosionDome));
            const Craters    = Array.from({ length: 14 }, (_, I) => PushRaster(`D-Day Blast Crater ${I}`, ShapeSets.BlastCrater));

            this.DDayBlock = {
                DistanceFirst:   DDayDistanceFirst,
                DistanceCount:   DDayDistanceCount,
                DistanceIndices: DDayDistanceIndices,
                RasterFirst,
                RasterCount:     this.Occupants.length - RasterFirst,
                RasterIndices,
                TankHulls:       DDayTankHulls,
                TankTurrets,
                TankBarrels,
                EnemyCarBodies:  DDayEnemyCarBodies,
                EnemyCarWheels,
                Turrets,
                Cannons,
                BomberBodies,
                BomberProps,
                Bombs,
                Shells,
                Tracers,
                Mines,
                Explosions,
                Craters
            };
        }

        // ⑪ live-streamed Road Studio road, junction & highway bridge network (editable in Road Studio workspace) ------
        const RoadEditorSet = this.ConstructFacetSet("Road Studio network", [], 0.0, 0.0);
        this.FacetSets[RoadEditorSet].LocalMinimum   = [-2200.0, -2200.0, -40.0];
        this.FacetSets[RoadEditorSet].LocalMaximum   = [ 2400.0,  2200.0, 120.0];
        this.FacetSets[RoadEditorSet].VertexCapacity = RoadEditorVertexCapacity;
        const RoadEditorOcc = this.ConstructOccupant("Road Studio network", RoadEditorSet, ConstructIdentityTransform(), OccupantRole.Raster);
        this.RoadEditorBlock = { FacetSet: RoadEditorSet, Occupant: RoadEditorOcc };
        this.RoadEditor = new RoadEditorSequence(this, LevelKey);

        this.ConstructDistanceList();
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                            FACET SET CONSTRUCTION
    //--------------------------------------------------------------------------------------------------------------------

    ConstructFacetSet(Name, Facets, DistanceVoxel, CardDensity)
    {
        const Minimum = [Infinity, Infinity, Infinity];
        const Maximum = [-Infinity, -Infinity, -Infinity];
        for (const Facet of Facets)
        {
            for (const Corner of Facet.Corners)
            {
                for (let Axis = 0; Axis < 3; ++Axis)
                {
                    Minimum[Axis] = Math.min(Minimum[Axis], Corner[Axis]);
                    Maximum[Axis] = Math.max(Maximum[Axis], Corner[Axis]);
                }
            }
        }
        this.FacetSets.push({ Name, Facets, LocalMinimum: Minimum, LocalMaximum: Maximum, DistanceVoxel, CardDensity,
                              FirstVertex: 0, VertexCount: Facets.length * 3, VolumeIndex: -1 });
        return this.FacetSets.length - 1;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                  DRAW RUNS
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Consecutive rastered occupants of one facet set become one instanced draw: the vertex programs read the
    //    occupant record at instance_index, so FirstInstance is the run's first occupant. Inactive stress slots break
    //    runs and are skipped. The shadow runs leave out the ground, which never casts onto the course.
    ConstructDrawRuns()
    {
        const Runs = [], ShadowRuns = [];
        let Open = null, OpenShadow = null;
        this.Occupants.forEach((Occupant, Index) =>
        {
            const Drawn = (Occupant.Roles & OccupantRole.Raster) && !Occupant.Inactive;
            if (Drawn && Open && Open.FacetSet === Occupant.FacetSet && Open.First + Open.Count === Index)
                Open.Count++;
            else
                Open = Drawn ? (Runs.push({ FacetSet: Occupant.FacetSet, First: Index, Count: 1 }), Runs[Runs.length - 1]) : null;
            const Shadowed = Drawn && Index !== this.GroundOccupant;
            if (Shadowed && OpenShadow && OpenShadow.FacetSet === Occupant.FacetSet && OpenShadow.First + OpenShadow.Count === Index)
                OpenShadow.Count++;
            else
                OpenShadow = Shadowed ? (ShadowRuns.push({ FacetSet: Occupant.FacetSet, First: Index, Count: 1 }), ShadowRuns[ShadowRuns.length - 1]) : null;
        });
        this.DrawRuns = Runs;
        this.ShadowRuns = ShadowRuns;
    }

    // 📝 The union's active list: every enabled distance occupant of the span, in identity order (so ties resolve as
    //    they always did). Rebuilt each frame by the host — two thousand flag tests — and uploaded only on change.
    ConstructDistanceList()
    {
        const List = [];
        for (let Index = 0; Index < this.DistanceCount; ++Index)
        {
            const Occupant = this.Occupants[Index];
            if ((Occupant.Roles & OccupantRole.Distance) && !Occupant.Inactive)
                List.push(Index);
        }
        const Changed = List.length !== this.DistanceList.length || List.some((Value, Index) => Value !== this.DistanceList[Index]);
        if (Changed)
            this.DistanceList = Uint32Array.from(List);
        return Changed;
    }

    // 📝 Occupants the union pass walks.
    QueryUnionCount()
    {
        return this.DistanceList.length;
    }

    ConstructOccupant(Name, FacetSet, Transform, Roles, MaterialOverride = -1)
    {
        const Set = this.FacetSets[FacetSet];
        this.Occupants.push({
            Name, FacetSet, Roles, MaterialOverride,
            Transform:         Transform,
            PreviousTransform: Transform.slice(),
            CardMinimum:       Set.LocalMinimum.slice(),
            CardMaximum:       Set.LocalMaximum.slice(),
            CardDensity:       Set.CardDensity,
            FirstCard:         0,
            CardCount:         0
        });
        return this.Occupants.length - 1;
    }

    AssignCardBounds(Occupant, Minimum, Maximum, Density)
    {
        this.Occupants[Occupant].CardMinimum = Minimum;
        this.Occupants[Occupant].CardMaximum = Maximum;
        this.Occupants[Occupant].CardDensity = Density;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                               VERTEX ENCODING
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Non-indexed facet corners, 32 bytes each: flat sets repeat the facet normal, authored sets carry corner normals.
    EncodeVertexRecords()
    {
        let VertexTotal = 0;
        for (const Set of this.FacetSets)
        {
            Set.FirstVertex = VertexTotal;
            VertexTotal += Math.max(Set.VertexCount, Set.VertexCapacity || 0);
        }
        const Bytes = new ArrayBuffer(VertexTotal * VertexStride);
        const Scalars = new Float32Array(Bytes);
        const Integers = new Uint32Array(Bytes);
        let Cursor = 0;
        for (const Set of this.FacetSets)
        {
            Cursor = Set.FirstVertex;
            for (const Facet of Set.Facets)
            {
                const FacetNormal = NormalizeVector(CrossVector(SubtractVector(Facet.Corners[1], Facet.Corners[0]),
                                                                SubtractVector(Facet.Corners[2], Facet.Corners[0])));
                for (let Corner = 0; Corner < 3; ++Corner)
                {
                    const Normal = Facet.Normals ? Facet.Normals[Corner] : FacetNormal;
                    const Offset = Cursor * 8;
                    Scalars[Offset + 0] = Facet.Corners[Corner][0];
                    Scalars[Offset + 1] = Facet.Corners[Corner][1];
                    Scalars[Offset + 2] = Facet.Corners[Corner][2];
                    Integers[Offset + 3] = Facet.Family;
                    Scalars[Offset + 4] = Normal[0];
                    Scalars[Offset + 5] = Normal[1];
                    Scalars[Offset + 6] = Normal[2];
                    Integers[Offset + 7] = Facet.OccupantOffset || 0;
                    ++Cursor;
                }
            }
        }
        return Scalars;
    }

    // 📝 A fragment carries its own local bounds (LocalMinimum/LocalMaximum) — its composite set's bounds would be the
    //    whole prop's.
    QueryWorldBounds(Occupant)
    {
        const Record = this.Occupants[Occupant];
        const Set = this.FacetSets[Record.FacetSet];
        if (Record.LocalMinimum)
            return TransformBounds(Record.Transform, Record.LocalMinimum, Record.LocalMaximum);
        if (Record.Roles & OccupantRole.Raster || Record.Roles & OccupantRole.Distance)
            return TransformBounds(Record.Transform, Set.LocalMinimum, Set.LocalMaximum);
        return TransformBounds(Record.Transform, Record.CardMinimum, Record.CardMaximum);
    }

    // 📝 World bounds of every static occupant the vehicle hull collides with: walls, containers, barriers, props.
    QueryObstacleBounds()
    {
        const Bounds = [];
        this.Occupants.forEach((Occupant, Index) =>
        {
            if (Occupant.Obstacle && !Occupant.Inactive && (Occupant.Bollard || !(Occupant.Roles & OccupantRole.Dynamic)))
                Bounds.push(this.QueryWorldBounds(Index));
        });
        return Bounds;
    }

    // 📝 Advances an occupant's transform; the previous one is retained for motion vectors and reservoir carriage.
    AssignOccupantTransform(Occupant, Transform)
    {
        const Record = this.Occupants[Occupant];
        Record.PreviousTransform = Record.Transform;
        Record.Transform = Transform;
    }

    RetainOccupantTransform(Occupant)
    {
        const Record = this.Occupants[Occupant];
        Record.PreviousTransform = Record.Transform;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                              OCCUPANT ENCODING
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 336-byte records matching OccupantRecord in SceneRecords.wgsl (84 scalars). Count limits the encoding to the
    //    leading occupants — the vehicle's five, which are constructed first — for the per-frame upload.
    EncodeOccupantRecords(DistanceSpace, Count = this.Occupants.length)
    {
        return this.EncodeOccupantRange(DistanceSpace, 0, Count);
    }

    // 📝 The records of occupants [First, First + Count), for a partial upload at byte offset First · OccupantStride.
    EncodeOccupantRange(DistanceSpace, First, Count)
    {
        const Bytes = new ArrayBuffer(Math.max(1, Count) * OccupantStride);
        const Scalars = new Float32Array(Bytes);
        const Integers = new Uint32Array(Bytes);
        this.Occupants.slice(First, First + Count).forEach((Record, Local) =>
        {
            const Index = First + Local;
            const Offset = Local * (OccupantStride / 4);
            const Set = this.FacetSets[Record.FacetSet];
            Scalars.set(Record.Transform, Offset);
            Scalars.set(InvertTransform(Record.Transform), Offset + 16);
            Scalars.set(Record.PreviousTransform, Offset + 32);
            Scalars.set(InvertTransform(Record.PreviousTransform), Offset + 48);
            // 📝 An inactive occupant (a broken prop, a disabled slot) carries empty bounds: the union's overlap test
            //    can never pass, so it leaves the field without leaving the span.
            const Bounds = Record.Inactive ? { Minimum: [1.0e9, 1.0e9, 1.0e9], Maximum: [-1.0e9, -1.0e9, -1.0e9] } : this.QueryWorldBounds(Index);
            Scalars.set(Bounds.Minimum, Offset + 64);
            Integers[Offset + 67] = Record.Roles;
            Scalars.set(Bounds.Maximum, Offset + 68);
            Integers[Offset + 71] = Record.MaterialOverride >= 0 ? Record.MaterialOverride : 0xFFFFFFFF;
            const Volume = Record.Volume || ((DistanceSpace && Set.VolumeIndex >= 0) ? DistanceSpace.Volumes[Set.VolumeIndex] : null);
            if (Volume)
            {
                Scalars.set(Volume.Minimum, Offset + 72);
                Scalars[Offset + 75] = Volume.VoxelExtent;
                Scalars.set(Volume.TexelOrigin, Offset + 76);
                Scalars.set(Volume.Resolution, Offset + 80);
            }
            // 📝 A card-less occupant may carry its albedo packed where its first card would be (role Fallback).
            const Fallback = Record.CardCount === 0 && Record.FallbackAlbedo !== undefined;
            Integers[Offset + 79] = Fallback ? Record.FallbackAlbedo : Record.FirstCard;
            Integers[Offset + 83] = Record.CardCount;
            if (Fallback)
                Integers[Offset + 67] = Record.Roles | OccupantRole.Fallback;
        });
        return Scalars;
    }
}

export const OccupantStride = 336;   // [B] - OccupantRecord

//------------------------------------------------------------------------------------------------------------------------
//                                           CONTROLVEHICLE FACET PROJECTION
//------------------------------------------------------------------------------------------------------------------------

// 📝 DriveSceneAuthor::AppendVehicleBody(): rebase the authored model onto the centre of mass (z − 0.11285 m) and keep
//    the per-facet family; facet normals are flat, exactly as AppendFace derives them.
function ProjectBodyFacets(Stream)
{
    const Rebase = ResolveCoMAuthoredZ();
    const Facets = [];
    for (let Facet = 0; Facet < Stream.FacetCount; ++Facet)
    {
        const Corners = [];
        for (let Corner = 0; Corner < 3; ++Corner)
        {
            const Vertex = Stream.Facets[Facet * 3 + Corner];
            Corners.push([Stream.Positions[Vertex * 3], Stream.Positions[Vertex * 3 + 1], Stream.Positions[Vertex * 3 + 2] - Rebase]);
        }
        Facets.push({ Corners, Family: Stream.Families[Facet] });
    }
    return Facets;
}

// 📝 The authored tyre plus the authored rim (mags and all), hub-local with the axle along +Y. The rim is scaled to the
//    configured rim radius as DriveSceneAuthor::AppendWheel does. The right-hand wheels mirror Y so the mag face points
//    outward on both sides; mirroring reverses the winding, which is restored by swapping two corners.
// 📝 The tyre keeps the archive's smoothed corner normals (its deformation turns them in the vertex stage); the rim is
//    hard-shaded — every facet takes its own flat normal, Blender's "mark sharp" on every edge — so the spokes' and
//    flanges' faceted metal reads crisp instead of the averaged corner normals across each twisted fin.
export function ProjectWheelFacets(Tyre, Rim, Mirrored)
{
    const Facets = [];
    const RimScale = VehicleGeometry.TyreRimRadius / VehicleGeometry.AuthoredRimRadius;
    const Append = (Stream, Scale, Flat) =>
    {
        for (let Facet = 0; Facet < Stream.FacetCount; ++Facet)
        {
            const Corners = [], Normals = [];
            for (let Corner = 0; Corner < 3; ++Corner)
            {
                const Vertex = Stream.Facets[Facet * 3 + Corner];
                const Sign = Mirrored ? -1.0 : 1.0;
                Corners.push([Stream.Positions[Vertex * 3] * Scale, Sign * Stream.Positions[Vertex * 3 + 1] * Scale,
                              Stream.Positions[Vertex * 3 + 2] * Scale]);
                const Offset = Facet * 9 + Corner * 3;
                Normals.push([Stream.CornerNormals[Offset], Sign * Stream.CornerNormals[Offset + 1], Stream.CornerNormals[Offset + 2]]);
            }
            if (Mirrored)
            {
                [Corners[1], Corners[2]] = [Corners[2], Corners[1]];
                [Normals[1], Normals[2]] = [Normals[2], Normals[1]];
            }
            // Preserve the authored two-slot rim: 1296 dark MatTyre faces and 272
            // blue MatHub accents. Only the separate rubber archive may shred.
            const Family = Flat && Stream.Families[Facet] === CourseMaterial.Tyre ? CourseMaterial.RimBase : Stream.Families[Facet];
            Facets.push(Flat ? { Corners, Family } : { Corners, Normals, Family });
        }
    };
    Append(Tyre, 1.0, false);
    Append(Rim, RimScale, true);
    return Facets;
}

export function ResolvePlacementTransform(Placement)
{
    if (Placement.Orientation)
        return ConstructRigidTransform(Placement.Position, Placement.Orientation);
    const Half = 0.5 * (Placement.Yaw || 0.0);
    return ConstructRigidTransform(Placement.Position, [0.0, 0.0, Math.sin(Half), Math.cos(Half)]);
}

// 📝 A closed convex solid from FractureStructure as facets (its faces triangulated the way its fragments will be),
//    so the intact prop and its pieces are the same geometry.
function EmitSolidFacets(Part, Family)
{
    const Facets = [];
    for (const Face of Part.Faces)
    {
        const Result = TriangulateFace(Part, Face);
        for (const [A, B, C] of Result.Triangles)
            Facets.push({ Corners: [Part.Vertices[Face.Indices[A]], Part.Vertices[Face.Indices[B]], Part.Vertices[Face.Indices[C]]], Family });
    }
    return Facets;
}
