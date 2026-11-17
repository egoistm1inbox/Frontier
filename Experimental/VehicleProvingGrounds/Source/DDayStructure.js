//============================================================================================================================================
//                                                            DDAYSTRUCTURE.JS
//============================================================================================================================================
// 🧩 Dedicated "D-Day Assault" ("dday") militarized Normandy beachhead & Atlantic Wall level geometry,
//    tactical cover volumes, minefields, barricades, fortifications, tanks, turrets, cannons, bombers,
//    military patrol cars, projectiles & battle props. Every 3D solid is a disjoint closed 2-manifold.

import { CourseMaterial } from "./MaterialSpecification.js";
import { EmitBoxFacets, EmitPrismFacets } from "./CourseStructure.js";
import { ConstructCabinFacets } from "./CabinStructure.js";
import { ResolveCoMAuthoredZ } from "./VehicleSpecification.js";
import { EmitConstructionDrumFacets } from "./SignageBuilder.js";
import { ConstructAxisQuaternion, RotateVector } from "./TransformProjection.js";

//------------------------------------------------------------------------------------------------------------------------
//                                  WATERTIGHT 2-MANIFOLD PRIMITIVE HELPERS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Places an EmitBoxFacets solid whose bottom sits at Z0 and whose footprint is centered at (CX, CY).
function EmitBoxAt(CX, CY, Z0, SX, SY, SZ, Family, FaceFamilies = null)
{
    const Raw = EmitBoxFacets(SX, SY, SZ, Family, FaceFamilies);
    return Raw.map((F) => ({
        Family:  F.Family,
        Corners: F.Corners.map((P) => [P[0] + CX, P[1] + CY, P[2] + Z0])
    }));
}

// 📝 Places a vertical prism whose bottom sits at Z0 and whose axis is at (CX, CY).
function EmitPrismAt(CX, CY, Z0, Radius, Height, Sides, Family)
{
    const Raw = EmitPrismFacets(Radius, Height, Sides, Family);
    return Raw.map((F) => ({
        Family:  F.Family,
        Corners: F.Corners.map((P) => [P[0] + CX, P[1] + CY, P[2] + Z0])
    }));
}

// 📝 Rotates facets around local origin by a unit quaternion (preserves outward winding & watertightness).
function RotateFacets(Facets, Axis, AngleRad, Offset = [0.0, 0.0, 0.0])
{
    const Q = ConstructAxisQuaternion(Axis, AngleRad);
    return Facets.map((F) => ({
        Family:  F.Family,
        Corners: F.Corners.map((P) =>
        {
            const R = RotateVector(Q, P);
            return [R[0] + Offset[0], R[1] + Offset[1], R[2] + Offset[2]];
        })
    }));
}

// 📝 Builds a watertight rotated box centered at (CX, CY, CZ) in local frame.
function EmitRotatedBox(CX, CY, CZ, SX, SY, SZ, Axis, AngleRad, Family)
{
    const Centered = EmitBoxFacets(SX, SY, SZ, Family).map((F) => ({
        Family:  F.Family,
        Corners: F.Corners.map((P) => [P[0], P[1], P[2] - 0.5 * SZ])
    }));
    return RotateFacets(Centered, Axis, AngleRad, [CX, CY, CZ]);
}

//------------------------------------------------------------------------------------------------------------------------
//                            FORTIFICATIONS: ATLANTIC WALL, BUNKERS, COVER SHELTERS & BARRICADES
//------------------------------------------------------------------------------------------------------------------------

// 📝 Massive 12.6 m tall Atlantic Wall main bastion segment (sloped lower seawall buttresses, casemate slit, upper parapet).
export function EmitAtlanticWallSegmentFacets()
{
    const Out = [];
    // ① Thick lower concrete glacis & main seawall body (X = [-5.0..+5.0], Y = [-14.0..+14.0], Z = [0..8.6])
    Out.push(...EmitBoxAt( 0.0,  0.0, 0.0,  10.0, 28.0, 8.6, CourseMaterial.BunkerConcrete));
    // ② Forward sloped anti-shell skirt plinth (disjoint by 16 mm West of main wall)
    Out.push(...EmitBoxAt(-6.2,  0.0, 0.0,   2.2, 27.6, 3.8, CourseMaterial.Concrete));
    // ③ Sloped upper bunker casemate tier & firing embrasure framing
    Out.push(...EmitBoxAt(-0.4,  0.0, 8.62,  9.2, 27.6, 2.6, CourseMaterial.Concrete));
    // ④ Glowing recessed coastal gun embrasure slit facing West (-X) toward the beach
    Out.push(...EmitBoxAt(-5.25, -6.5, 6.2,  0.45, 5.2, 0.9, CourseMaterial.GateLampRed));
    Out.push(...EmitBoxAt(-5.25,  6.5, 6.2,  0.45, 5.2, 0.9, CourseMaterial.GateLampRed));
    // ⑤ Upper fortified parapet crown & twin steel observation cupolas
    Out.push(...EmitBoxAt(-0.8,  0.0, 11.24, 9.8, 27.8, 1.35, CourseMaterial.BunkerConcrete));
    Out.push(...EmitBoxAt(-1.2, -7.0, 12.61, 3.2,  3.2, 1.15, CourseMaterial.WehrmachtSlate));
    Out.push(...EmitBoxAt(-1.2,  7.0, 12.61, 3.2,  3.2, 1.15, CourseMaterial.WehrmachtSlate));
    return Out;
}

// 📝 Breach Gate Bastion Tower flanking the main Atlantic Wall breach corridor (with luminous green breach beacons).
export function EmitAtlanticWallBastionFacets()
{
    const Out = [];
    Out.push(...EmitBoxAt(0.0, 0.0, 0.0,  12.4, 14.0, 13.8, CourseMaterial.BunkerConcrete));
    Out.push(...EmitBoxAt(-6.8, 0.0, 0.0,  1.2, 13.2,  4.4, CourseMaterial.Concrete));
    Out.push(...EmitBoxAt(0.0, 0.0, 13.82, 10.6, 12.0,  2.2, CourseMaterial.WehrmachtSlate));
    // Illuminated breach gate vertical guide pillars facing the beachhead
    Out.push(...EmitBoxAt(-6.25, 0.0, 4.55, 0.45, 3.2, 4.2, CourseMaterial.GateLamp));
    Out.push(...EmitBoxAt(-5.32, 0.0, 14.1, 0.40, 4.2, 0.9, CourseMaterial.LampWarm));
    return Out;
}

// 📝 Overhead Breach Gate Archway Lintel spanning Y = [-12..+12] at Z = [4.6..13.0] — players drive straight underneath!
export function EmitAtlanticWallArchLintelFacets()
{
    const Out = [];
    Out.push(...EmitBoxAt(0.0, 0.0, 4.60, 11.0, 23.6, 5.6, CourseMaterial.BunkerConcrete));
    Out.push(...EmitBoxAt(-0.4, 0.0, 10.22, 11.8, 23.8, 2.8, CourseMaterial.Concrete));
    // Glowing green breach target chevron band visible from the landing beachhead
    Out.push(...EmitBoxAt(-5.58, 0.0, 5.20, 0.36, 14.0, 1.15, CourseMaterial.GateLamp));
    return Out;
}

// 📝 Coastal Reinforced Pillbox Bunker (solid heavy cover block + firing slit + cupola pad).
export function EmitConcreteBunkerFacets()
{
    const Out = [];
    // ① Main monolithic reinforced concrete base
    Out.push(...EmitBoxAt(0.0, 0.0, 0.0,   9.6, 9.6, 2.75, CourseMaterial.BunkerConcrete));
    // ② Overhanging armored concrete roof slab
    Out.push(...EmitBoxAt(-0.3, 0.0, 2.77, 10.4, 10.2, 1.15, CourseMaterial.Concrete));
    // ③ West-facing observation / MG firing slit frame (glows subtle amber inside)
    Out.push(...EmitBoxAt(-4.95, 0.0, 1.95, 0.32, 4.6, 0.56, CourseMaterial.GateLampRed));
    // ④ Rooftop sandbag & steel turret ring collar
    Out.push(...EmitBoxAt(0.0, 0.0, 3.94, 4.4, 4.4, 0.42, CourseMaterial.WehrmachtSlate));
    return Out;
}

// 📝 Separate solid blast wall (used as standalone cover walls & side walls of Drive-In Cover Shelters).
export function EmitCoverBlastWallFacets()
{
    const Out = [];
    Out.push(...EmitBoxAt(0.0, 0.0, 0.0,  3.2, 9.2, 1.35, CourseMaterial.Gravel));
    Out.push(...EmitBoxAt(0.0, 0.0, 1.37, 2.7, 9.0, 1.35, CourseMaterial.BunkerConcrete));
    Out.push(...EmitBoxAt(0.0, 0.0, 2.74, 3.0, 9.1, 0.36, CourseMaterial.Concrete));
    return Out;
}

// 📝 Drive-In Cover Shelter side wall (runs along X so players drive through East-West between left & right walls!).
export function EmitShelterSideWallFacets()
{
    const Out = [];
    Out.push(...EmitBoxAt(0.0, 0.0, 0.0, 14.0, 2.2, 1.20, CourseMaterial.Gravel));
    Out.push(...EmitBoxAt(0.0, 0.0, 1.22, 13.8, 1.95, 2.30, CourseMaterial.BunkerConcrete));
    return Out;
}

// 📝 Drive-In Cover Shelter overhead concrete roof slab (Z = 3.54..5.04 m — protects from overhead bombers!).
export function EmitShelterRoofFacets()
{
    const Out = [];
    Out.push(...EmitBoxAt(0.0, 0.0, 3.56, 14.6, 11.4, 1.28, CourseMaterial.BunkerConcrete));
    Out.push(...EmitBoxAt(0.0, 0.0, 4.86, 13.6, 10.4, 0.48, CourseMaterial.Concrete));
    // Illuminated interior emerald guidance strip under the roof so drivers spot shelter bays cleanly!
    Out.push(...EmitBoxAt(0.0, 0.0, 3.38, 12.0, 0.9, 0.14, CourseMaterial.GateLamp));
    return Out;
}

// 📝 Steel Czech Hedgehog anti-tank barricade (central hub + 6 angled disjoint steel I-beam legs).
export function EmitCzechHedgehogFacets()
{
    const Out = [];
    const HubZ = 1.05;
    Out.push(...EmitBoxAt(0.0, 0.0, HubZ - 0.16, 0.34, 0.34, 0.32, CourseMaterial.SteelDark));
    // 6 disjoint outward steel beams radiating in 3 orthogonal diagonal axes (starting > 0.24 m from center!)
    const Dirs = [
        [ 1,  1,  0.85], [-1, -1, -0.85],
        [-1,  1,  0.85], [ 1, -1, -0.85],
        [ 0.25, -1, 1.0], [-0.25, 1, -1.0]
    ];
    for (let I = 0; I < Dirs.length; ++I)
    {
        const [DX, DY, DZ] = Dirs[I];
        const Len = Math.hypot(DX, DY, DZ) || 1.0;
        const NX = DX / Len, NY = DY / Len, NZ = DZ / Len;
        // Center leg at 0.88 m from hub along direction, length 1.15 m => minimum 0.305 m from hub center (> 0.17 m half-hub!)
        const CX = NX * 0.88;
        const CY = NY * 0.88;
        const CZ = Math.max(0.24, HubZ + NZ * 0.88);
        const Yaw = Math.atan2(NY, NX);
        const Pitch = -Math.asin(Math.max(-0.98, Math.min(0.98, NZ)));
        const Local = EmitBoxFacets(1.12, 0.18, 0.18, CourseMaterial.SteelDark).map((F) => ({
            Family:  F.Family,
            Corners: F.Corners.map((P) => [P[0], P[1], P[2] - 0.09])
        }));
        const Pitched = RotateFacets(Local, [0.0, 1.0, 0.0], Pitch);
        Out.push(...RotateFacets(Pitched, [0.0, 0.0, 1.0], Yaw, [CX, CY, CZ]));
    }
    return Out;
}

// 📝 Stepped Concrete Dragon's Teeth cluster (3 tapered concrete anti-tank blocks on shared plinth).
export function EmitDragonsTeethFacets()
{
    const Out = [];
    Out.push(...EmitBoxAt(0.0, 0.0, 0.0, 2.2, 6.4, 0.26, CourseMaterial.Concrete));
    for (const Y of [-2.1, 0.0, 2.1])
    {
        Out.push(...EmitBoxAt(0.0, Y, 0.275, 1.45, 1.45, 0.65, CourseMaterial.BunkerConcrete));
        Out.push(...EmitBoxAt(0.10, Y, 0.94, 0.98, 0.98, 0.55, CourseMaterial.Concrete));
        Out.push(...EmitBoxAt(0.18, Y, 1.505, 0.55, 0.55, 0.38, CourseMaterial.BunkerConcrete));
    }
    return Out;
}

// 📝 Fortified Watchtower with elevated glowing searchlight housing.
export function EmitWatchtowerFacets()
{
    const Out = [];
    // 4 disjoint corner legs
    for (const SX of [-1.25, 1.25])
    {
        for (const SY of [-1.25, 1.25])
            Out.push(...EmitBoxAt(SX, SY, 0.0, 0.36, 0.36, 7.6, CourseMaterial.SteelDark));
    }
    // Elevated concrete guardhouse platform & cabin
    Out.push(...EmitBoxAt(0.0, 0.0, 7.62, 3.6, 3.6, 0.35, CourseMaterial.BunkerConcrete));
    Out.push(...EmitBoxAt(0.0, 0.0, 7.99, 2.8, 2.8, 2.10, CourseMaterial.WehrmachtSlate));
    Out.push(...EmitBoxAt(0.0, 0.0, 10.11, 3.4, 3.4, 0.36, CourseMaterial.Concrete));
    // Glowing West-facing searchlight lens
    Out.push(...EmitBoxAt(-1.62, 0.0, 8.75, 0.36, 1.10, 0.85, CourseMaterial.LampWarm));
    return Out;
}

//------------------------------------------------------------------------------------------------------------------------
//                          DYNAMIC COMBAT ACTORS: TANKS, TURRETS, CANNONS, BOMBERS, BOMBS & MINES
//------------------------------------------------------------------------------------------------------------------------

// 📝 Allied M4-inspired Assault Tank Hull (6.6 m × 3.2 m × 1.62 m): armored glacis, left/right track runs & bogies.
export function EmitAssaultTankHullFacets()
{
    const Out = [];
    // ① Lower armored chassis tub
    Out.push(...EmitBoxAt(0.0, 0.0, 0.32, 5.90, 1.85, 0.92, CourseMaterial.MilitaryOlive));
    // ② Upper wide overhanging hull deck & rear engine louvers
    Out.push(...EmitBoxAt(-0.10, 0.0, 1.26, 6.20, 2.95, 0.48, CourseMaterial.MilitaryOlive));
    Out.push(...EmitBoxAt(-1.90, 0.0, 1.76, 2.10, 2.20, 0.16, CourseMaterial.SteelDark));
    // ③ Sloped front armor glacis plate & armored transmission nose (disjoint ahead of X = 3.01 m)
    Out.push(...EmitRotatedBox(3.48, 0.0, 0.88, 0.86, 2.50, 0.38, [0.0, 1.0, 0.0], 0.56, CourseMaterial.MilitaryOlive));
    // ④ Left & Right heavy armored track runs + fenders
    for (const SideY of [-1.26, 1.26])
    {
        Out.push(...EmitBoxAt(0.0, SideY, 0.14, 6.20, 0.56, 0.96, CourseMaterial.SteelDark));
        Out.push(...EmitBoxAt(0.0, SideY, 1.12, 6.32, 0.60, 0.10, CourseMaterial.MilitaryOlive));
    }
    // ⑤ Twin front armored convoy headlights
    Out.push(...EmitBoxAt(3.14, -0.78, 1.38, 0.22, 0.24, 0.22, CourseMaterial.Headlight));
    Out.push(...EmitBoxAt(3.14,  0.78, 1.38, 0.22, 0.24, 0.22, CourseMaterial.Headlight));
    // ⑥ White allied star / tactical roof plate marker
    Out.push(...EmitBoxAt(1.30, 0.0, 1.76, 0.95, 0.95, 0.05, CourseMaterial.PaintWhite));
    return Out;
}

// 📝 Assault Tank Rotating Turret (mounted around hull top Z ≈ 1.78 m).
export function EmitAssaultTankTurretFacets()
{
    const Out = [];
    // ① Main cast armor turret block
    Out.push(...EmitBoxAt(-0.15, 0.0, 0.0, 2.55, 2.05, 0.86, CourseMaterial.MilitaryOlive));
    // ② Rear counterweight bustle & ammo stowage
    Out.push(...EmitBoxAt(-1.62, 0.0, 0.10, 0.82, 1.56, 0.68, CourseMaterial.SteelDark));
    // ③ Commander cupola hatch on roof
    Out.push(...EmitPrismAt(-0.35, 0.42, 0.88, 0.44, 0.26, 12, CourseMaterial.MilitaryOlive));
    // ④ Front turret gun mantlet shield
    Out.push(...EmitBoxAt(1.24, 0.0, 0.10, 0.44, 1.15, 0.58, CourseMaterial.WehrmachtSlate));
    return Out;
}

// 📝 Assault Tank 75 mm Main Cannon Barrel (local origin at turret trunnion pivot, pointing +X).
export function EmitAssaultTankBarrelFacets()
{
    const Out = [];
    // ① Heavy gun tube (from X = 0.2..3.35 m)
    Out.push(...EmitBoxAt(1.75, 0.0, -0.10, 3.05, 0.22, 0.22, CourseMaterial.MilitaryOlive));
    // ② Slotted muzzle brake at tip
    Out.push(...EmitBoxAt(3.40, 0.0, -0.14, 0.34, 0.32, 0.30, CourseMaterial.SteelDark));
    return Out;
}

// 📝 Enemy Armoured Military Patrol Car (exact ControlVehicle chassis + tactical Feldgrau armor, bullbar & roof beacon).
export function ConstructMilitaryCarBodyFacets(ProjectedBodyFacets)
{
    const Rebase = ResolveCoMAuthoredZ();
    const LiveryFacets = ProjectedBodyFacets.map((F) =>
    {
        if (F.Family !== CourseMaterial.BodyCoat)
            return F;
        const AvgZ = (F.Corners[0][2] + F.Corners[1][2] + F.Corners[2][2]) / 3.0;
        const IsHoodOrRoof = AvgZ > (0.98 - Rebase);
        return {
            ...F,
            Family: IsHoodOrRoof ? CourseMaterial.WehrmachtSlate : CourseMaterial.SteelDark
        };
    });

    const AddBodyBox = (CX, CY, CZAuthored, SX, SY, SZ, Family) =>
    {
        for (const F of EmitBoxFacets(SX, SY, SZ, Family))
        {
            LiveryFacets.push({
                Family,
                Corners: F.Corners.map((P) => [P[0] + CX, P[1] + CY, P[2] + CZAuthored - Rebase])
            });
        }
    };

    // ① Armored roof tactical beacon & amber/crimson threat strobe bar
    AddBodyBox(0.05,  0.00, 1.38, 0.28, 0.88, 0.10, CourseMaterial.SteelDark);
    AddBodyBox(0.05,  0.26, 1.49, 0.22, 0.32, 0.09, CourseMaterial.TrafficRed);
    AddBodyBox(0.05, -0.26, 1.49, 0.22, 0.32, 0.09, CourseMaterial.TrafficOrange);
    // ② Heavy-duty welded steel ramming plow / bullbar on nose
    AddBodyBox(2.38,  0.38, 0.48, 0.12, 0.08, 0.46, CourseMaterial.SteelDark);
    AddBodyBox(2.38, -0.38, 0.48, 0.12, 0.08, 0.46, CourseMaterial.SteelDark);
    AddBodyBox(2.46,  0.00, 0.56, 0.10, 0.96, 0.10, CourseMaterial.BannerAmber);
    AddBodyBox(2.46,  0.00, 0.35, 0.10, 0.96, 0.10, CourseMaterial.SteelDark);
    // ③ Slatted armored window louvres on upper windshield edge
    AddBodyBox(0.55,  0.00, 1.15, 0.14, 1.12, 0.10, CourseMaterial.WehrmachtSlate);

    return [...LiveryFacets, ...ConstructCabinFacets()];
}

// 📝 Bunker Machine Gun Turret Pod (armored turret dome + twin heavy MG barrels facing +X in local space).
export function EmitMachineGunTurretFacets()
{
    const Out = [];
    // ① Armored rotating dome
    Out.push(...EmitPrismAt(0.0, 0.0, 0.0, 1.15, 0.88, 10, CourseMaterial.WehrmachtSlate));
    // ② Twin heavy machine gun barrels & perforated cooling jackets
    Out.push(...EmitBoxAt(1.32, -0.24, 0.34, 1.65, 0.14, 0.14, CourseMaterial.SteelDark));
    Out.push(...EmitBoxAt(1.32,  0.24, 0.34, 1.65, 0.14, 0.14, CourseMaterial.SteelDark));
    // ③ Crimson threat optic sensor on turret crown
    Out.push(...EmitBoxAt(0.60,  0.00, 0.90, 0.36, 0.42, 0.18, CourseMaterial.TrafficRed));
    return Out;
}

// 📝 Heavy Coastal Artillery Cannon Turret (gun shield + breech + massive 155 mm long barrel facing +X).
export function EmitCoastalCannonTurretFacets()
{
    const Out = [];
    // ① Heavy concrete-and-steel gun carriage base
    Out.push(...EmitPrismAt(0.0, 0.0, 0.0, 1.85, 0.65, 12, CourseMaterial.SteelDark));
    // ② Sloped armored casemate gun shield
    Out.push(...EmitBoxAt(0.15, 0.0, 0.67, 2.20, 2.55, 1.38, CourseMaterial.WehrmachtSlate));
    // ③ Recoil cradle & massive 4.8 m 155 mm barrel pointing +X
    Out.push(...EmitBoxAt(1.80, 0.0, 1.24, 1.40, 0.54, 0.48, CourseMaterial.SteelDark));
    Out.push(...EmitBoxAt(3.70, 0.0, 1.32, 3.80, 0.32, 0.32, CourseMaterial.WehrmachtSlate));
    Out.push(...EmitBoxAt(5.68, 0.0, 1.27, 0.40, 0.42, 0.42, CourseMaterial.BannerAmber));
    return Out;
}

// 📝 Twin-Engine WW2 Tactical Bomber / Dive-Bomber Aircraft Body (pointing +X, wingspan 15.2 m).
export function EmitAttackBomberBodyFacets()
{
    const Out = [];
    // ① Sleek twin-engine fuselage & nose glass cockpit
    Out.push(...EmitBoxAt( 0.0,  0.0, 0.0,  10.4, 1.35, 1.35, CourseMaterial.WehrmachtSlate));
    Out.push(...EmitBoxAt( 5.45, 0.0, 0.18,  1.25, 0.96, 0.88, CourseMaterial.VehicleGlass));
    // ② Swept main wing airfoil (span Y = -7.6..+7.6 m)
    Out.push(...EmitBoxAt( 0.50, 0.0, 0.56,  2.40, 15.4, 0.28, CourseMaterial.SteelDark));
    // ③ Twin radial engine nacelles mounted outboard on wing
    Out.push(...EmitBoxAt( 1.25, -2.95, 0.12, 2.35, 0.88, 0.88, CourseMaterial.WehrmachtSlate));
    Out.push(...EmitBoxAt( 1.25,  2.95, 0.12, 2.35, 0.88, 0.88, CourseMaterial.WehrmachtSlate));
    // ④ Horizontal stabilizer & twin vertical tail fins
    Out.push(...EmitBoxAt(-4.85,  0.0,  0.88, 1.35, 4.90, 0.20, CourseMaterial.SteelDark));
    Out.push(...EmitBoxAt(-4.85, -2.35, 1.10, 1.25, 0.16, 1.45, CourseMaterial.BannerAmber));
    Out.push(...EmitBoxAt(-4.85,  2.35, 1.10, 1.25, 0.16, 1.45, CourseMaterial.BannerAmber));
    // ⑤ Under-wing amber/crimson tactical wingtip strobes & bomb pylons
    Out.push(...EmitBoxAt( 0.45, -7.45, 0.30, 0.45, 0.35, 0.20, CourseMaterial.TrafficRed));
    Out.push(...EmitBoxAt( 0.45,  7.45, 0.30, 0.45, 0.35, 0.20, CourseMaterial.TrafficOrange));
    return Out;
}

// 📝 Single twin-blade spinning propeller centered around local origin (mounted on each engine nacelle nose).
export function EmitAttackBomberPropsFacets()
{
    const Out = [];
    Out.push(...EmitBoxAt(-0.14, 0.0, -0.11, 0.20, 0.22, 0.22, CourseMaterial.BannerAmber));
    Out.push(...EmitBoxAt( 0.06, 0.0, -1.04, 0.06, 0.16, 2.08, CourseMaterial.SteelDark));
    Out.push(...EmitBoxAt( 0.16, 0.0, -0.09, 0.06, 2.08, 0.16, CourseMaterial.PaintWhite));
    return Out;
}

// 📝 Finned Aerial Bomb (local origin near center of mass, pointing +X so velocity alignment noses down!).
export function EmitAerialBombFacets()
{
    const Out = [];
    Out.push(...EmitBoxAt( 0.00, 0.0, -0.20, 1.18, 0.40, 0.40, CourseMaterial.SteelDark));
    Out.push(...EmitBoxAt( 0.68, 0.0, -0.14, 0.28, 0.28, 0.28, CourseMaterial.TrafficRed));
    // Tail stabilizer fins
    Out.push(...EmitBoxAt(-0.68, 0.0, -0.34, 0.32, 0.72, 0.08, CourseMaterial.BannerAmber));
    Out.push(...EmitBoxAt(-0.68, 0.0, -0.02, 0.32, 0.08, 0.72, CourseMaterial.BannerAmber));
    return Out;
}

// 📝 Glowing Artillery Cannon Shell.
export function EmitArtilleryShellFacets()
{
    const Out = [];
    Out.push(...EmitBoxAt( 0.00, 0.0, -0.16, 0.92, 0.32, 0.32, CourseMaterial.TracerFire));
    Out.push(...EmitBoxAt( 0.56, 0.0, -0.12, 0.28, 0.24, 0.24, CourseMaterial.DerezHot));
    return Out;
}

// 📝 Glowing High-Speed Tracer Bolt (for MG turrets & Tanks).
export function EmitTracerBoltFacets()
{
    return EmitBoxAt(0.0, 0.0, -0.08, 1.85, 0.16, 0.16, CourseMaterial.TracerFire);
}

// 📝 Teller Anti-Tank Landmine with blinking crimson arming pip.
export function EmitLandmineFacets()
{
    const Out = [];
    Out.push(...EmitPrismAt(0.0, 0.0, 0.0, 0.62, 0.18, 8, CourseMaterial.WehrmachtSlate));
    Out.push(...EmitPrismAt(0.0, 0.0, 0.195, 0.38, 0.08, 8, CourseMaterial.SteelDark));
    Out.push(...EmitBoxAt(0.0, 0.0, 0.29, 0.16, 0.16, 0.10, CourseMaterial.TrafficRed));
    return Out;
}

// 📝 Glowing Explosion Fireball Burst Polyhedron (scaled dynamically during detonations!).
export function EmitExplosionDomeFacets()
{
    const Out = [];
    // Multi-tiered disjoint bright incandescent plasma cluster (strictly closed outward 2-manifold!)
    Out.push(...EmitPrismAt(0.0, 0.0, -0.80, 1.00, 1.60, 8, CourseMaterial.TracerFire));
    Out.push(...EmitPrismAt(0.0, 0.0,  0.82, 0.72, 0.92, 8, CourseMaterial.DerezHot));
    Out.push(...EmitBoxAt( 1.06,  0.0, -0.35, 0.68, 0.68, 0.68, CourseMaterial.TracerFire));
    Out.push(...EmitBoxAt(-1.06,  0.0, -0.35, 0.68, 0.68, 0.68, CourseMaterial.TracerFire));
    Out.push(...EmitBoxAt( 0.0,  1.06, -0.35, 0.68, 0.68, 0.68, CourseMaterial.TracerFire));
    Out.push(...EmitBoxAt( 0.0, -1.06, -0.35, 0.68, 0.68, 0.68, CourseMaterial.TracerFire));
    return Out;
}

// 📝 Low-profile Scorched Blast Crater Rim placed at impact points.
export function EmitBlastCraterFacets()
{
    const Out = [];
    Out.push(...EmitPrismAt(0.0, 0.0, 0.0, 2.35, 0.07, 10, CourseMaterial.ScorchAsh));
    Out.push(...EmitBoxAt( 2.45,  0.0, 0.0, 0.55, 1.10, 0.18, CourseMaterial.Gravel));
    Out.push(...EmitBoxAt(-2.45,  0.0, 0.0, 0.55, 1.10, 0.18, CourseMaterial.Gravel));
    Out.push(...EmitBoxAt( 0.0,  2.45, 0.0, 1.10, 0.55, 0.18, CourseMaterial.Gravel));
    Out.push(...EmitBoxAt( 0.0, -2.45, 0.0, 1.10, 0.55, 0.18, CourseMaterial.Gravel));
    return Out;
}

export const DDayShapes = Object.freeze({
    AtlanticWallSegment: { Emit: EmitAtlanticWallSegmentFacets, Voxel: 0.36, Cards: 8.0 },
    AtlanticWallBastion: { Emit: EmitAtlanticWallBastionFacets, Voxel: 0.34, Cards: 8.0 },
    AtlanticWallArch:    { Emit: EmitAtlanticWallArchLintelFacets, Voxel: 0.36, Cards: 8.0 },
    ConcreteBunker:      { Emit: EmitConcreteBunkerFacets,      Voxel: 0.24, Cards: 10.0 },
    CoverBlastWall:      { Emit: EmitCoverBlastWallFacets,      Voxel: 0.18, Cards: 12.0 },
    ShelterSideWall:     { Emit: EmitShelterSideWallFacets,     Voxel: 0.22, Cards: 10.0 },
    ShelterRoof:         { Emit: EmitShelterRoofFacets,         Voxel: 0.24, Cards: 10.0 },
    CzechHedgehog:       { Emit: EmitCzechHedgehogFacets,       Voxel: 0.12, Cards: 12.0 },
    DragonsTeeth:        { Emit: EmitDragonsTeethFacets,        Voxel: 0.16, Cards: 10.0 },
    Watchtower:          { Emit: EmitWatchtowerFacets,          Voxel: 0.24, Cards: 8.0 },
    ConstructionDrum:    { Emit: EmitConstructionDrumFacets,    Voxel: 0.05, Cards: 12.0 },
    AssaultTankHull:     { Emit: EmitAssaultTankHullFacets,     Voxel: 0.14, Cards: 16.0 },
    AssaultTankTurret:   { Emit: EmitAssaultTankTurretFacets,   Voxel: 0.12, Cards: 12.0, Distance: false },
    AssaultTankBarrel:   { Emit: EmitAssaultTankBarrelFacets,   Voxel: 0.10, Cards: 10.0, Distance: false },
    MachineGunTurret:    { Emit: EmitMachineGunTurretFacets,    Voxel: 0.10, Cards: 10.0, Distance: false },
    CoastalCannonTurret: { Emit: EmitCoastalCannonTurretFacets, Voxel: 0.14, Cards: 10.0, Distance: false },
    AttackBomberBody:    { Emit: EmitAttackBomberBodyFacets,    Voxel: 0.18, Cards: 10.0, Distance: false },
    AttackBomberProps:   { Emit: EmitAttackBomberPropsFacets,   Voxel: 0.12, Cards: 8.0,  Distance: false },
    AerialBomb:          { Emit: EmitAerialBombFacets,          Voxel: 0.10, Cards: 8.0,  Distance: false },
    ArtilleryShell:      { Emit: EmitArtilleryShellFacets,      Voxel: 0.10, Cards: 8.0,  Distance: false },
    TracerBolt:          { Emit: EmitTracerBoltFacets,          Voxel: 0.08, Cards: 8.0,  Distance: false },
    Landmine:            { Emit: EmitLandmineFacets,            Voxel: 0.08, Cards: 10.0, Distance: false },
    ExplosionDome:       { Emit: EmitExplosionDomeFacets,       Voxel: 0.16, Cards: 8.0,  Distance: false },
    BlastCrater:         { Emit: EmitBlastCraterFacets,         Voxel: 0.14, Cards: 8.0,  Distance: false }
});

//------------------------------------------------------------------------------------------------------------------------
//                          D-DAY ASSAULT SPAWN, TELEPORT ZONES, FORTIFICATIONS & BATTLE SPECS
//------------------------------------------------------------------------------------------------------------------------

export const DDaySpawn = Object.freeze({ Position: [-144.0, 0.0, 0.72], Yaw: 0.0 });

export const DDayZones = Object.freeze([
    { Key: "1", Name: "Landing Beachhead",     Position: [-144.0,   0.0, 0.72], Yaw:  0.0 },
    { Key: "2", Name: "Barricade & Mine Belt", Position: [ -84.0,  -4.0, 0.72], Yaw:  0.05 },
    { Key: "3", Name: "Drive-In Cover Bunker", Position: [ -24.0,  22.0, 0.72], Yaw: -0.08 },
    { Key: "4", Name: "No-Man's-Land Killzone",Position: [  34.0, -10.0, 0.72], Yaw:  0.06 },
    { Key: "5", Name: "Forward Casemates",     Position: [  92.0,   0.0, 0.72], Yaw:  0.0 },
    { Key: "6", Name: "Atlantic Wall Breach",  Position: [ 128.0,   0.0, 0.72], Yaw:  0.0 }
]);

export const DDayClearZones = Object.freeze([
    [-165.0, -78.0, 175.0, 78.0]
]);

export const DDayWallReachX = 132.0; // Crossing X >= 132 m within |Y| <= 36 m reaches/breaches the Atlantic Wall!

export const DDayTankSpecs = Object.freeze([
    { Id: "tank_alpha",   Name: "Tank Alpha-1",   Start: [-130.0, -24.0], GoalX: 124.0, Speed: 4.9, Phase: 0.0 },
    { Id: "tank_bravo",   Name: "Tank Bravo-2",   Start: [-112.0,  -8.0], GoalX: 126.0, Speed: 5.4, Phase: 1.4 },
    { Id: "tank_charlie", Name: "Tank Charlie-3", Start: [-118.0,  10.0], GoalX: 126.0, Speed: 5.1, Phase: 2.7 },
    { Id: "tank_delta",   Name: "Tank Delta-4",   Start: [ -98.0,  27.0], GoalX: 124.0, Speed: 4.7, Phase: 3.9 }
]);

export const DDayTurretSpecs = Object.freeze([
    // Forward Bunker MG Nests (low nests + pillbox roof mounts)
    { Id: "mg_nw_1", Name: "North Pillbox MG-1", Position: [-44.0,  34.0, 3.95], LowNest: false },
    { Id: "mg_sw_1", Name: "South Pillbox MG-2", Position: [-44.0, -34.0, 3.95], LowNest: false },
    { Id: "mg_mid_n", Name: "Trench Nest MG-3",  Position: [ 22.0,  20.0, 0.00], LowNest: true  },
    { Id: "mg_mid_s", Name: "Trench Nest MG-4",  Position: [ 22.0, -20.0, 0.00], LowNest: true  },
    { Id: "mg_wall_n",Name: "Bastion MG-5",      Position: [140.0,  18.5, 4.65], LowNest: false },
    { Id: "mg_wall_s",Name: "Bastion MG-6",      Position: [140.0, -18.5, 4.65], LowNest: false }
]);

export const DDayCannonSpecs = Object.freeze([
    // Forward Casemate Coastal Cannons + Towering Atlantic Wall Batteries
    { Id: "can_fwd_n",  Name: "Casemate Cannon N",    Position: [ 68.0,  38.0, 3.95], Range: 195.0, Cooldown: 4.8, Phase: 0.8 },
    { Id: "can_fwd_s",  Name: "Casemate Cannon S",    Position: [ 68.0, -38.0, 3.95], Range: 195.0, Cooldown: 5.2, Phase: 2.6 },
    { Id: "can_wall_n", Name: "Atlantic Battery N",   Position: [145.0,  34.0, 12.6], Range: 260.0, Cooldown: 5.8, Phase: 1.5 },
    { Id: "can_wall_s", Name: "Atlantic Battery S",   Position: [145.0, -34.0, 12.6], Range: 260.0, Cooldown: 6.2, Phase: 3.7 }
]);

export const DDayEnemyCarSpecs = Object.freeze([
    { Id: "car_1", Name: "Scout Car 1", Waypoints: [[-82, -16], [-32, -18], [-12,  14], [-68,  16]], Speed: 16.5 },
    { Id: "car_2", Name: "Scout Car 2", Waypoints: [[-48,  12], [ 14,  10], [ 14, -14], [-48, -12]], Speed: 18.0 },
    { Id: "car_3", Name: "Patrol Car 3",Waypoints: [[ 24,  28], [ 76,  14], [ 76, -16], [ 24, -28]], Speed: 19.0 },
    { Id: "car_4", Name: "Patrol Car 4",Waypoints: [[ 72, -10], [118, -22], [118,  22], [ 72,  10]], Speed: 17.5 },
    { Id: "car_5", Name: "Wall Guard 5",Waypoints: [[112, -36], [126,   0], [112,  36], [ 96,   0]], Speed: 16.0 }
]);

export const DDayMineCoords = Object.freeze([
    // Sector 1 Beachhead mine belt (clear flanking gaps around Y = 0, ±14, ±26)
    [-108, -18], [-106,  -3], [-108,  14], [-104,  31],
    // Sector 2 Barricade & Mine Belt
    [ -74, -26], [ -72, -10], [ -74,   6], [ -70,  20],
    // Sector 3 Midfield Killzone
    [ -36, -24], [ -34,  -6], [ -36,  11], [ -32,  32],
    [   8, -30], [   6, -11], [  10,   6], [   8,  25],
    // Sector 4 Forward Casemates
    [  54, -24], [  56,  -4], [  54,  15], [  58,  30],
    // Sector 5 Wall Apron Final Gauntlet
    [ 102, -20], [ 104,  -5], [ 102,   9], [ 106,  22]
]);

// 📝 Drive-In Cover Shelters (open East-West drive-through concrete bunkers with overhead bomb-proof roofs!).
export const DDayDriveInShelters = Object.freeze([
    { Name: "West Beach Cover Shelter", CX: -22.0, CY:  22.0 },
    { Name: "South Trench Cover Shelter", CX: 18.0, CY: -28.0 },
    { Name: "Forward Assault Shelter",   CX:  82.0, CY:  18.0 }
]);

// 📝 Standalone Cover Blast Walls along the battlefield (block ground turret & cannon LOS!).
export const DDayCoverWalls = Object.freeze([
    { Name: "Beach Sandbag Cover 1", CX: -116.0, CY:  14.0, Yaw:  0.0 },
    { Name: "Beach Sandbag Cover 2", CX:  -90.0, CY: -16.0, Yaw:  0.0 },
    { Name: "Causeway Cover Wall 3", CX:  -58.0, CY:   8.0, Yaw:  0.0 },
    { Name: "Midfield Cover Wall 4", CX:   -6.0, CY: -10.0, Yaw:  0.0 },
    { Name: "Midfield Cover Wall 5", CX:   42.0, CY:  14.0, Yaw:  0.0 },
    { Name: "Killzone Cover Wall 6", CX:   76.0, CY: -14.0, Yaw:  0.0 },
    { Name: "Wall Approach Cover 7", CX:  114.0, CY:   8.0, Yaw:  0.0 }
]);

// 📝 Builds world AABB list of all static cover structures (bunkers, blast walls, shelters, Atlantic wall) for O(1) LOS cover checks.
export function BuildDDayCoverBoxes()
{
    const Boxes = [];
    // Concrete Bunkers (9.6 x 9.6 x 3.9 m)
    const BunkerPos = [
        [-44.0,  34.0], [-44.0, -34.0],
        [ 68.0,  38.0], [ 68.0, -38.0]
    ];
    for (const [X, Y] of BunkerPos)
        Boxes.push({ MinX: X - 4.9, MaxX: X + 4.9, MinY: Y - 4.9, MaxY: Y + 4.9, MaxZ: 4.0, AirRoof: false });

    // Cover Blast Walls (3.2 x 9.2 x 3.1 m)
    for (const W of DDayCoverWalls)
        Boxes.push({ MinX: W.CX - 1.6, MaxX: W.CX + 1.6, MinY: W.CY - 4.6, MaxY: W.CY + 4.6, MaxZ: 3.1, AirRoof: false });

    // Drive-In Cover Shelters (left wall, right wall + overhead air-cover roof volume!)
    for (const S of DDayDriveInShelters)
    {
        Boxes.push({ MinX: S.CX - 7.1, MaxX: S.CX + 7.1, MinY: S.CY + 3.4, MaxY: S.CY + 5.7, MaxZ: 3.6, AirRoof: false });
        Boxes.push({ MinX: S.CX - 7.1, MaxX: S.CX + 7.1, MinY: S.CY - 5.7, MaxY: S.CY - 3.4, MaxZ: 3.6, AirRoof: false });
        Boxes.push({ MinX: S.CX - 7.3, MaxX: S.CX + 7.3, MinY: S.CY - 5.7, MaxY: S.CY + 5.7, MaxZ: 5.4, AirRoof: true,
                     InteriorMinX: S.CX - 6.8, InteriorMaxX: S.CX + 6.8, InteriorMinY: S.CY - 3.5, InteriorMaxY: S.CY + 3.5 });
    }

    // Atlantic Wall flanking bastions & seawall segments
    Boxes.push({ MinX: 139.0, MaxX: 151.0, MinY:  12.0, MaxY:  78.0, MaxZ: 14.0, AirRoof: false });
    Boxes.push({ MinX: 139.0, MaxX: 151.0, MinY: -78.0, MaxY: -12.0, MaxZ: 14.0, AirRoof: false });

    return Boxes;
}

export function ResolveDDayPlacements()
{
    const Placements = [];

    // ① Towering Atlantic Wall across X = +145 m (central Breach Gate at Y = [-12..+12]!)
    Placements.push({ Name: "Atlantic Wall Breach Bastion North", Shape: "AtlanticWallBastion", Position: [145.0,  19.0, 0.0], Yaw: 0.0, Collider: true });
    Placements.push({ Name: "Atlantic Wall Breach Bastion South", Shape: "AtlanticWallBastion", Position: [145.0, -19.0, 0.0], Yaw: 0.0, Collider: true });
    Placements.push({ Name: "Atlantic Wall Breach Arch Lintel",   Shape: "AtlanticWallArch",    Position: [145.0,   0.0, 0.0], Yaw: 0.0, Collider: true });
    Placements.push({ Name: "Atlantic Wall North Wing 1",         Shape: "AtlanticWallSegment", Position: [145.0,  40.0, 0.0], Yaw: 0.0, Collider: true });
    Placements.push({ Name: "Atlantic Wall North Wing 2",         Shape: "AtlanticWallSegment", Position: [145.0,  68.0, 0.0], Yaw: 0.0, Collider: true });
    Placements.push({ Name: "Atlantic Wall South Wing 1",         Shape: "AtlanticWallSegment", Position: [145.0, -40.0, 0.0], Yaw: 0.0, Collider: true });
    Placements.push({ Name: "Atlantic Wall South Wing 2",         Shape: "AtlanticWallSegment", Position: [145.0, -68.0, 0.0], Yaw: 0.0, Collider: true });

    // ② Reinforced Flank Bunkers & Forward Artillery Casemates
    const Bunkers = [
        { Name: "North Pillbox Bunker",   Pos: [-44.0,  34.0, 0.0] },
        { Name: "South Pillbox Bunker",   Pos: [-44.0, -34.0, 0.0] },
        { Name: "North Casemate Bunker",  Pos: [ 68.0,  38.0, 0.0] },
        { Name: "South Casemate Bunker",  Pos: [ 68.0, -38.0, 0.0] }
    ];
    for (const B of Bunkers)
        Placements.push({ Name: B.Name, Shape: "ConcreteBunker", Position: B.Pos, Yaw: 0.0, Collider: true });

    // ③ Drive-In Concrete Cover Shelters (open-ended tunnels with side blast walls & bombproof overhead roof)
    for (const S of DDayDriveInShelters)
    {
        Placements.push({ Name: `${S.Name} North Wall`, Shape: "ShelterSideWall", Position: [S.CX, S.CY + 4.55, 0.0], Yaw: 0.0, Collider: true });
        Placements.push({ Name: `${S.Name} South Wall`, Shape: "ShelterSideWall", Position: [S.CX, S.CY - 4.55, 0.0], Yaw: 0.0, Collider: true });
        Placements.push({ Name: `${S.Name} Roof`,       Shape: "ShelterRoof",     Position: [S.CX, S.CY,        0.0], Yaw: 0.0, Collider: true });
    }

    // ④ Tactical Cover Blast Walls
    for (const W of DDayCoverWalls)
        Placements.push({ Name: W.Name, Shape: "CoverBlastWall", Position: [W.CX, W.CY, 0.0], Yaw: W.Yaw, Collider: true });

    // ⑤ Czech Hedgehogs & Dragon's Teeth Anti-Tank Barricades (arranged with wide driving & tank corridors!)
    const Hedgehogs = [
        [-124, -14], [-124,  14], [-96, -24], [-96,  22],
        [ -62, -20], [ -62,  24], [-26, -16], [-10,  26],
        [  28, -24], [  28,  24], [ 62, -18], [ 62,  20],
        [  96, -24], [  96,  24], [124, -18], [124,  18]
    ];
    Hedgehogs.forEach(([X, Y], Idx) =>
        Placements.push({ Name: `Czech Hedgehog ${Idx + 1}`, Shape: "CzechHedgehog", Position: [X, Y, 0.0], Yaw: Idx * 0.45, Collider: true }));

    const Teeth = [
        [-84,  34], [-84, -34], [4,  38], [4, -38], [92,  42], [92, -42]
    ];
    Teeth.forEach(([X, Y], Idx) =>
        Placements.push({ Name: `Dragon's Teeth ${Idx + 1}`, Shape: "DragonsTeeth", Position: [X, Y, 0.0], Yaw: 0.0, Collider: true }));

    // ⑥ Coastal Searchlight Watchtowers along flank ridges
    const Towers = [[-110, 48], [-110, -48], [16, 52], [16, -52], [116, 48], [116, -48]];
    Towers.forEach(([X, Y], Idx) =>
        Placements.push({ Name: `Coastal Watchtower ${Idx + 1}`, Shape: "Watchtower", Position: [X, Y, 0.0], Yaw: 0.0, Collider: true }));

    return Placements;
}

export function ResolveDDayCones()
{
    const Drums = [];
    const Spots = [
        [-128,   6.0], [-128,  -6.0], [-92,   3.5], [-92,  -3.5],
        [ -48,   6.5], [ -48,  -6.5], [ -2,   4.5], [ -2,  -4.5],
        [  48,   5.0], [  48,  -5.0], [ 86,   6.0], [ 86,  -6.0],
        [ 118,   5.5], [ 118,  -5.5], [136,  10.0], [136, -10.0]
    ];
    Spots.forEach(([X, Y], I) =>
    {
        Drums.push({
            Name:     `Fuel / Supply Drum ${I + 1}`,
            Group:    "lone",
            Shape:    (I % 3 === 0) ? "Cone" : "ConstructionDrum",
            Position: [X, Y, 0.0],
            Yaw:      I * 0.5
        });
    });
    return Drums;
}

export function ResolveDDayBreakables()
{
    // Smashable timber beachhead barricades & supply crates right along the assault approach!
    const Props = [
        { Name: "Beach Timber Barricade 1", Pos: [-112.0,  0.0],  Material: "wood",     Extent: [1.1, 4.2, 1.35] },
        { Name: "Supply Munitions Crate 2", Pos: [ -84.0,  2.5],  Material: "wood",     Extent: [1.4, 1.4, 1.25] },
        { Name: "Checkpoint Wood Barrier 3",Pos: [ -40.0, -1.5],  Material: "wood",     Extent: [1.0, 4.6, 1.35] },
        { Name: "Concrete Blast Block 4",   Pos: [  12.0,  2.5],  Material: "concrete", Extent: [1.1, 3.2, 1.15] },
        { Name: "Supply Munitions Crate 5", Pos: [  46.0, -3.5],  Material: "wood",     Extent: [1.5, 1.5, 1.30] },
        { Name: "Forward Wood Barricade 6", Pos: [  84.0,  0.5],  Material: "wood",     Extent: [1.1, 4.4, 1.35] },
        { Name: "Wall Apron Crate Stack 7", Pos: [ 112.0, -3.0],  Material: "wood",     Extent: [1.5, 1.5, 1.35] },
        { Name: "Breach Gate Timber Stop 8",Pos: [ 129.0,  0.0],  Material: "wood",     Extent: [0.9, 4.8, 1.25] }
    ];
    return Props.map((P, I) => ({
        Name:     P.Name,
        Material: P.Material,
        Mode:     "baked",
        Shape:    { Kind: "box", Extent: P.Extent },
        Position: [P.Pos[0], P.Pos[1], 0.0],
        Yaw:      0.08 * ((I % 3) - 1),
        Approach: [1.0, 0.0, 0.0],
        Capacity: 8,
        Energy:   P.Material === "concrete" ? 6800 : 3400,
        Seed:     4401 + I * 53
    }));
}

export function ResolveDDayTrafficLights()
{
    return [];
}

export function EmitDDayGroundFacets()
{
    // Multi-zone coastal beachhead ground plane:
    // Ocean surf (West) -> Beach Sand -> War-torn Asphalt/Concrete Assault Causeway -> Atlantic Wall Apron -> Grassy Hinterland
    const Facets = [];
    const Quad = (X0, Y0, X1, Y1, Z, Family) =>
    {
        Facets.push(
            { Family, Corners: [[X0, Y0, Z], [X1, Y0, Z], [X1, Y1, Z]] },
            { Family, Corners: [[X0, Y0, Z], [X1, Y1, Z], [X0, Y1, Z]] }
        );
    };

    // ① Atlantic Ocean surf & wet shoreline foam West of X = -152 m
    Quad(-900.0, -900.0, -162.0,  900.0, 0.0, CourseMaterial.OceanWater);
    Quad(-162.0, -900.0, -155.0,  900.0, 0.0, CourseMaterial.PaintWhite);

    // ② Normandy landing beach sand (X = -155 .. -55 m) + flank beach verges
    Quad(-155.0, -900.0,  -55.0, -11.0, 0.0, CourseMaterial.BeachSand);
    Quad(-155.0,   11.0,  -55.0, 900.0, 0.0, CourseMaterial.BeachSand);
    Quad(-155.0,  -11.0,  -55.0,  11.0, 0.0, CourseMaterial.Gravel);

    // ③ Militarized No-Man's-Land & Coastal Assault Corridor (X = -55 .. +120 m)
    Quad( -55.0, -900.0,  120.0, -56.0, 0.0, CourseMaterial.Grass);
    Quad( -55.0,   56.0,  120.0, 900.0, 0.0, CourseMaterial.Grass);
    Quad( -55.0,  -56.0,  120.0, -12.0, 0.0, CourseMaterial.Gravel);
    Quad( -55.0,   12.0,  120.0,  56.0, 0.0, CourseMaterial.Gravel);
    // Central battered asphalt/concrete assault road leading straight to the Wall Breach!
    Quad( -55.0,  -12.0,  120.0,  12.0, 0.0, CourseMaterial.AsphaltPatch);

    // ④ Atlantic Wall Concrete Apron & Rear Fortress Ground (X = +120 .. +900 m)
    Quad( 120.0, -900.0,  175.0, -56.0, 0.0, CourseMaterial.Grass);
    Quad( 120.0,   56.0,  175.0, 900.0, 0.0, CourseMaterial.Grass);
    Quad( 120.0,  -56.0,  175.0,  56.0, 0.0, CourseMaterial.ApronConcrete);
    Quad( 175.0, -900.0,  900.0, 900.0, 0.0, CourseMaterial.Grass);

    return Facets;
}
