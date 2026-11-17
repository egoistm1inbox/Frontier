//============================================================================================================================================
//                                                       INVERSIONARENASTRUCTURE.JS
//============================================================================================================================================
// 🧩 Inversion Arena — Multi-Track Open-World Stunt Complex ([Track A] + [Track B] + [Track C]):
//    • [Track A · Grand Prix Circuit] (preserved intact): 1.05 km stunt circuit + central infield stunt expressway
//      (360° Helical Loop, Camelback Waves, Skyline Tabletop, Twin 47° Velodrome Bowls, Heartline S-Bridge, 360° Full-Pipe,
//       Twin-Wing ±38° Split Canyon, Twin 45° Spine Gap, Whale-Tail Step-Up & 125° Over-Vert Cradle).
//    • [Track B · Subterranean Over/Under Wing] (North): Split Over/Under fork (5.2 m-deep Roofed Underground Subway Tunnel +
//      5.0 m Sky-Bridge Overpass + Ground-Level Underpass Boulevard), Serpentine ±28° Banked Waves & Proximity Linear Bollard Gate.
//    • [Track C · Kinetic Wave & Crossover Wing] (South): 84 m Travelling-Wave Kinetic Bollard Strip (one side/end rising while
//      opposite sinks), 9.8 m Over/Under Viaduct Bridge & Sunken Canyon Underpass, Westbound 360° Loop & 48° Steep Corkscrew Wing.

import { CourseMaterial } from "./MaterialSpecification.js";
import { EmitQuad, EmitBoxFacets } from "./CourseStructure.js";
import { ConstructHelicalLoopSurface, ConstructFullPipeSurface, ConstructTwistedRibbonSurface,
         ConstructTransitionRampSurface, ConstructWaveDeckSurface, ConstructTabletopRampSurface,
         ConstructBankedTurnSurface, ConstructHeartlineRibbonSurface,
         ConstructSubmergedTrenchSurface, ConstructSerpentineWaveSurface,
         ConstructCollapseDeckSurface, ConstructSurfaceSegmentDescriptors } from "./RampSurfaceProjection.js";
import { ConstructCollapseProxyShapes } from "./CollapseSequence.js";
import { ConstructTramShapes } from "./TramSequence.js";
import { ConstructInfrastructureShapes, EmitSignPanelOverlay } from "./SignageBuilder.js";
import { ConstructFactoryAndServiceShapes } from "./ServiceStationSequence.js";
import { ConstructTrafficLightShapes } from "./TrafficLightSequence.js";

//------------------------------------------------------------------------------------------------------------------------
//                                    MULTI-TRACK COMPLEX BOUNDS & TRACK CATALOG
//------------------------------------------------------------------------------------------------------------------------

export const InversionArenaBounds = Object.freeze({
    Minimum: Object.freeze([-156.0, -452.0]),
    Maximum: Object.freeze([ 222.0,  452.0])
});

export const InversionArenaTracks = Object.freeze([
    {
        Id:       "trackA",
        Label:    "Track A · Grand Prix",
        Name:     "Track A — Grand Prix Stunt Circuit",
        Icon:     "Flag",
        Position: [-88.0, -38.3],
        Yaw:      0.0,
        Note:     "Original 1.05 km Loop → Waves → Tabletop → Heartline → Full-Pipe circuit"
    },
    {
        Id:       "trackB",
        Label:    "Track B · Split & Tunnel",
        Name:     "Track B — Underground Split & Linear Bollards",
        Icon:     "ArrowDownUp",
        Position: [-86.0,  94.0],
        Yaw:      0.0,
        Note:     "Split Over/Under (-5.2 m Subway Tunnel vs +5.0 m Sky-Bridge) & Linear Bollards"
    },
    {
        Id:       "trackC",
        Label:    "Track C · Wave & Viaduct",
        Name:     "Track C — Kinetic Wave Bollards & Over/Under Viaduct",
        Icon:     "Activity",
        Position: [-98.0, -94.0],
        Yaw:      0.0,
        Note:     "84 m Travelling-Wave Bollards → Viaduct Over/Under Canyon → Westbound 360° Loop"
    },
    {
        Id:       "trackD",
        Label:    "Track D · Collapse Run",
        Name:     "Track D — Collapsing Sky-Bridge & Faultline Road",
        Icon:     "Zap",
        Position: [-92.0, -250.0],
        Yaw:      0.0,
        Note:     "Rear-to-front Collapsing Bridge (+5 m) & Sinkhole Road (0 m) with unique movie cracks & sand"
    },
    {
        Id:       "trackE",
        Label:    "Track E · 3-Lane Subway",
        Name:     "Track E — 3-Lane Center-Portal Subway Boulevard",
        Icon:     "GitFork",
        Position: [-104.0,  256.0],
        Yaw:      0.0,
        Note:     "[road][tunnel down][road] → [road][road][road] → [road][tunnel up][road]"
    },
    {
        Id:       "trackF",
        Label:    "Track F · Trams & Trains",
        Name:     "Track F — Streetcar Trams & Express Rail Traffic",
        Icon:     "Compass",
        Position: [-98.0,  314.0],
        Yaw:      0.0,
        Note:     "Dedicated 4-track transit corridor with live articulated trams & 3-car express trains"
    },
    {
        Id:       "trackG",
        Label:    "Track G · Construction Pit",
        Name:     "Track G — Underground Construction Site (Through-Trench & Dead-End Pit)",
        Icon:     "AlertTriangle",
        Position: [-106.0, -402.0],
        Yaw:      0.0,
        Note:     "CONSTRUCTION AHEAD signs & amber lights → Boolean road holes (Through-Trench + Dead-End Pit)"
    },
    {
        Id:       "trackH",
        Label:    "Track H · Factory & Auto-Fuel",
        Name:     "Track H — Drive-Through Megafactory & Industrial Robot Fuel + EV Bays",
        Icon:     "Zap",
        Position: [-88.0,  406.0],
        Yaw:      0.0,
        Note:     "Stop at Auto-Fuel or 800V EV Bay for 6-Axis Industrial Robot Arm coupling, then drive inside the Megafactory!"
    },
    {
        Id:       "trackI",
        Label:    "Track I · Spline & Bridge Demo",
        Name:     "Track I — Live Editable Spline S-Curve, Crossroads & Steel I-Girder Bridge",
        Icon:     "Compass",
        Position: [174.0, 66.0],
        Yaw:      -8.0,
        Note:     "Connected Arena gateway into the live-editable spline & steel I-girder bridge showcase — edit directly in Road Studio!"
    }
]);

//------------------------------------------------------------------------------------------------------------------------
//                                        3D ANALYTIC TRACK & STUNT SURFACES
//------------------------------------------------------------------------------------------------------------------------

export const InversionArenaSurfaces = Object.freeze([
    // ===================================================================================================================
    // [TRACK A] ORIGINAL GRAND PRIX STUNT CIRCUIT & CENTRAL INFIELD EXPRESSWAY (100% PRESERVED)
    // ===================================================================================================================

    // ① Sector 1 (Outbound Straight): 18 m-tall 360° Helical Inversion Loop right off the Starting Grid
    ConstructHelicalLoopSurface({
        Key:            "HelicalLoop",
        ShapePrefix:    "GrandPrixLoop",
        Origin:         [-20.0, -38.3, 0.0],
        Yaw:            0.0,
        Radius:         8.8,
        Width:          11.4,
        HelicalShift:   8.6,
        Thickness:      0.66,
        KerbWidth:      0.65,
        KerbHeight:     0.32,
        AccentMaterial: CourseMaterial.PaintYellow
    }),

    // ② Sector 2 (Outbound Straight): 64 m Triple-Crest Sinusoidal Camelback Wave Roller Bridge
    ConstructWaveDeckSurface({
        Key:            "CamelbackWaves",
        ShapePrefix:    "CamelbackWaves",
        Origin:         [42.0, -29.7, 0.0],
        Yaw:            0.0,
        Length:         64.0,
        Width:          14.5,
        WaveCount:      3,
        Amplitude:      0.92,
        Thickness:      0.56,
        AccentMaterial: CourseMaterial.PaintBlue
    }),

    // ③ Sector 3 (Outbound Straight): 54 m Skyline Asymmetric Tabletop Mega-Jump before Turn 1
    ConstructTabletopRampSurface({
        Key:            "SkylineTabletop",
        ShapePrefix:    "SkylineTabletop",
        Origin:         [90.0, -29.7, 0.0],
        Yaw:            0.0,
        UpLength:       18.0,
        DeckLength:     12.0,
        DownLength:     24.0,
        Height:         3.30,
        Width:          14.5,
        Thickness:      0.62,
        AccentMaterial: CourseMaterial.KerbRed
    }),

    // ④ Turn 1 ("Thunderdome" East Hairpin): 180° Progressive Parabolic 47° Velodrome Bowl + C² Wall-Ride Coping
    ConstructBankedTurnSurface({
        Key:            "EastVelodromeBowl",
        ShapePrefix:    "VelodromeBowl",
        Origin:         [164.0, 0.0, 0.0],
        StartAngle:     -0.5 * Math.PI,
        SweepAngle:     Math.PI,
        InnerRadius:    24.0,
        OuterRadius:    46.0,
        RampAngle:      0.15 * Math.PI,
        MinimumSlope:   0.25,
        PeakSlope:      1.08,
        CopingWidth:    3.4,
        CopingLift:     2.2,
        Thickness:      0.68,
        AccentMaterial: CourseMaterial.PaintYellow
    }),

    // ⑤ Sector 4 (North Return Straight, Westbound): 84 m Zero-G Heartline S-Twist Sky-Bridge (+35° -> 0° -> −35°)
    ConstructHeartlineRibbonSurface({
        Key:            "HeartlineSwitchback",
        ShapePrefix:    "HeartlineSwitchback",
        Origin:         [110.0, 35.0, 0.0],
        Yaw:            Math.PI,
        Length:         84.0,
        Width:          13.8,
        BridgeHeight:   3.70,
        PeakAngle:      (35.0 * Math.PI) / 180.0,
        RampFraction:   0.22,
        CrossFraction:  0.26,
        Thickness:      0.60,
        AccentMaterial: CourseMaterial.PaintBlue
    }),

    // ⑥ Sector 5 (North Return Straight, Westbound): 56 m × 13.2 m Neon 360° Corkscrew Full-Pipe Tunnel + 45° Skirts
    ConstructFullPipeSurface({
        Key:            "FullPipe",
        Origin:         [26.0, 35.0, 0.0],
        Yaw:            Math.PI,
        Radius:         6.6,
        Length:         56.0,
        Thickness:      0.70,
        SkirtRadius:    6.8,
        SkirtAngle:     Math.PI * 0.25
    }),

    // ⑦ Sector 6 (North Return Straight, Westbound): 62 m Twin-Wing ±38° V-Camber Split Canyon (Infield + Stadium Wings)
    ConstructTwistedRibbonSurface({
        Key:            "TwinWingInfield",
        ShapePrefix:    "TwinWing38",
        Origin:         [-47.0, 25.8, 0.0],
        Yaw:            0.0,
        Length:         62.0,
        Width:          9.0,
        TwistLength:    20.0,
        PeakAngle:      (38.0 * Math.PI) / 180.0,
        BankSign:       1.0,
        Thickness:      0.58,
        AccentMaterial: CourseMaterial.PaintGreen
    }),
    ConstructTwistedRibbonSurface({
        Key:            "TwinWingOuter",
        ShapePrefix:    "TwinWing38",
        Origin:         [-47.0, 44.2, 0.0],
        Yaw:            Math.PI,
        Length:         62.0,
        Width:          9.0,
        TwistLength:    20.0,
        PeakAngle:      (38.0 * Math.PI) / 180.0,
        BankSign:       1.0,
        Thickness:      0.58,
        AccentMaterial: CourseMaterial.PaintYellow
    }),

    // ⑧ Turn 2 ("Sunset Slingshot" West Hairpin): 180° Progressive 47° Banked Bowl back onto the Start/Finish Straight
    ConstructBankedTurnSurface({
        Key:            "WestSlingshotBowl",
        ShapePrefix:    "VelodromeBowl",
        Origin:         [-96.0, 0.0, 0.0],
        StartAngle:     0.5 * Math.PI,
        SweepAngle:     Math.PI,
        InnerRadius:    24.0,
        OuterRadius:    46.0,
        RampAngle:      0.15 * Math.PI,
        MinimumSlope:   0.25,
        PeakSlope:      1.08,
        CopingWidth:    3.4,
        CopingLift:     2.2,
        Thickness:      0.68,
        AccentMaterial: CourseMaterial.PaintYellow
    }),

    // ⑨ Infield Stunt Expressway West: Twin 45° Skate Spine Aerial Gap over glowing target bullseye
    ConstructTransitionRampSurface({
        Key:            "LaunchSpine45",
        ShapePrefix:    "Spine45",
        Origin:         [-44.0, 0.0, 0.0],
        Yaw:            0.0,
        Radius:         12.0,
        Width:          13.0,
        MaximumAngle:   Math.PI * 0.25,
        Extension:      2.2,
        Thickness:      0.66,
        AccentMaterial: CourseMaterial.KerbRed
    }),
    ConstructTransitionRampSurface({
        Key:            "LandingSpine45",
        ShapePrefix:    "Spine45",
        Origin:         [-8.0, 0.0, 0.0],
        Yaw:            Math.PI,
        Radius:         12.0,
        Width:          13.0,
        MaximumAngle:   Math.PI * 0.25,
        Extension:      2.2,
        Thickness:      0.66,
        AccentMaterial: CourseMaterial.PaintGreen
    }),

    // ⑩ Infield Stunt Expressway Centre: 50 m High-Altitude Whale-Tail Step-Up Kicker (4.5 m sky deck)
    ConstructTabletopRampSurface({
        Key:            "WhaleTailStepUp",
        ShapePrefix:    "WhaleTailStepUp",
        Origin:         [22.0, 0.0, 0.0],
        Yaw:            0.0,
        UpLength:       16.0,
        DeckLength:     14.0,
        DownLength:     20.0,
        Height:         4.50,
        Width:          13.0,
        Thickness:      0.64,
        AccentMaterial: CourseMaterial.PaintBlue
    }),

    // ⑪ Infield Stunt Expressway East Finale: 22 m-wide 125° Over-Vert Inversion Cradle
    ConstructTransitionRampSurface({
        Key:            "OverVertCradle125",
        Origin:         [124.0, 0.0, 0.0],
        Yaw:            0.0,
        Radius:         10.5,
        Width:          22.0,
        MaximumAngle:   (125.0 * Math.PI) / 180.0,
        Extension:      0.0,
        Thickness:      0.70,
        AccentMaterial: CourseMaterial.PaintBlue
    }),

    // ===================================================================================================================
    // [TRACK B · NORTH WING] SPLIT OVER/UNDER SUBTERRANEAN TUNNEL + SKY-BRIDGE + UNDERPASS + SERPENTINE WAVES
    // ===================================================================================================================

    // ⑫ Track B Split Lower Fork: 92 m Excavated Underground Subway Tunnel (-5.2 m deep, roofed under ground boulevard!)
    ConstructSubmergedTrenchSurface({
        Key:                "TrackBSubwayTunnel",
        ShapePrefix:        "SubwayTrench52",
        Origin:             [-36.0, 84.0, 0.0],
        Yaw:                0.0,
        DownLength:         24.0,
        TunnelLength:       44.0,
        UpLength:           24.0,
        Width:              13.6,
        Depth:              5.20,
        Roofed:             true,
        GroundDeckOverRoof: true,
        AccentMaterial:     CourseMaterial.GateLamp
    }),

    // ⑬ Track B Split Upper Fork: 108 m Elevated Sky-Bridge Overpass (+5.0 m deck spanning over the ground Underpass road!)
    ConstructTabletopRampSurface({
        Key:            "TrackBSkyBridge",
        ShapePrefix:    "SkyBridge50",
        Origin:         [-44.0, 104.0, 0.0],
        Yaw:            0.0,
        UpLength:       26.0,
        DeckLength:     56.0,
        DownLength:     26.0,
        Height:         5.00,
        Width:          14.0,
        Thickness:      0.62,
        AccentMaterial: CourseMaterial.PaintYellow
    }),

    // ⑭ Track B East Hairpin: 180° Superelevated Bowl turning West onto Track B Return Straight
    ConstructBankedTurnSurface({
        Key:            "TrackBEastBowl",
        ShapePrefix:    "VelodromeBowl",
        Origin:         [156.0, 130.0, 0.0],
        StartAngle:     -0.5 * Math.PI,
        SweepAngle:     Math.PI,
        InnerRadius:    24.0,
        OuterRadius:    46.0,
        RampAngle:      0.15 * Math.PI,
        MinimumSlope:   0.25,
        PeakSlope:      1.08,
        CopingWidth:    3.4,
        CopingLift:     2.2,
        Thickness:      0.68,
        AccentMaterial: CourseMaterial.PaintBlue
    }),

    // ⑮ Track B North Return Straight: 72 m Serpentine Alternating-Camber Banked Rhythm Rollers (±28°)
    ConstructSerpentineWaveSurface({
        Key:            "TrackBSerpentineWave",
        ShapePrefix:    "SerpentineWave72",
        Origin:         [104.0, 166.0, 0.0],
        Yaw:            Math.PI,
        Length:         72.0,
        Width:          14.5,
        WaveCount:      3,
        Amplitude:      0.92,
        PeakAngle:      (28.0 * Math.PI) / 180.0,
        Thickness:      0.58,
        AccentMaterial: CourseMaterial.PaintGreen
    }),

    // ⑯ Track B West Return Hairpin: 180° Bowl feeding back into Split Fork & West Inter-Track Boulevard
    ConstructBankedTurnSurface({
        Key:            "TrackBWestBowl",
        ShapePrefix:    "VelodromeBowl",
        Origin:         [-96.0, 130.0, 0.0],
        StartAngle:     0.5 * Math.PI,
        SweepAngle:     Math.PI,
        InnerRadius:    24.0,
        OuterRadius:    46.0,
        RampAngle:      0.15 * Math.PI,
        MinimumSlope:   0.25,
        PeakSlope:      1.08,
        CopingWidth:    3.4,
        CopingLift:     2.2,
        Thickness:      0.68,
        AccentMaterial: CourseMaterial.PaintYellow
    }),

    // ===================================================================================================================
    // [TRACK C · SOUTH WING] KINETIC WAVE BOLLARDS + VIADUCT OVER/UNDER CANYON + WESTBOUND 360° LOOP & STEEP WING
    // ===================================================================================================================

    // ⑰ Track C Outbound Viaduct Bridge (+5.0 m sky span crossing at 90° OVER the sunken Canyon Underpass!)
    ConstructTabletopRampSurface({
        Key:            "TrackCViaductBridge",
        ShapePrefix:    "SkyBridge50",
        Origin:         [24.0, -94.0, 0.0],
        Yaw:            0.0,
        UpLength:       26.0,
        DeckLength:     56.0,
        DownLength:     26.0,
        Height:         5.00,
        Width:          14.0,
        Thickness:      0.62,
        AccentMaterial: CourseMaterial.KerbRed
    }),

    // ⑱ Inter-Track South Canyon Underpass (-5.2 m sunken open-cut tunnel diving right UNDER TrackCViaductBridge!)
    ConstructSubmergedTrenchSurface({
        Key:                "TrackCUnderpassTunnel",
        ShapePrefix:        "SubwayTrench52",
        Origin:             [78.0, -56.0, 0.0],
        Yaw:                -0.5 * Math.PI,
        DownLength:         24.0,
        TunnelLength:       44.0,
        UpLength:           24.0,
        Width:              13.6,
        Depth:              5.20,
        Roofed:             false,
        GroundDeckOverRoof: false,
        AccentMaterial:     CourseMaterial.PaintYellow
    }),

    // ⑲ Track C East Hairpin: 180° Superelevated Bowl onto South Mega-Stunt Backstretch
    ConstructBankedTurnSurface({
        Key:            "TrackCEastBowl",
        ShapePrefix:    "VelodromeBowl",
        Origin:         [156.0, -130.0, 0.0],
        StartAngle:     -0.5 * Math.PI,
        SweepAngle:     Math.PI,
        InnerRadius:    24.0,
        OuterRadius:    46.0,
        RampAngle:      0.15 * Math.PI,
        MinimumSlope:   0.25,
        PeakSlope:      1.08,
        CopingWidth:    3.4,
        CopingLift:     2.2,
        Thickness:      0.68,
        AccentMaterial: CourseMaterial.KerbRed
    }),

    // ⑳ Track C South Backstretch (Westbound): 18 m-tall Crimson 360° Helical Inversion Loop
    ConstructHelicalLoopSurface({
        Key:            "TrackCHelicalLoop",
        ShapePrefix:    "GrandPrixLoop",
        Origin:         [108.0, -162.0, 0.0],
        Yaw:            Math.PI,
        Radius:         8.8,
        Width:          11.4,
        HelicalShift:   8.6,
        Thickness:      0.66,
        KerbWidth:      0.65,
        KerbHeight:     0.32,
        AccentMaterial: CourseMaterial.KerbRed
    }),

    // ㉑ Track C South Backstretch: 56 m Extreme 46° Steep Corkscrew Wall-Ride Ribbon
    ConstructTwistedRibbonSurface({
        Key:            "TrackCCorkscrewWing",
        ShapePrefix:    "SteepWing46",
        Origin:         [36.0, -175.0, 0.0],
        Yaw:            Math.PI,
        Length:         56.0,
        Width:          11.0,
        TwistLength:    18.0,
        PeakAngle:      (46.0 * Math.PI) / 180.0,
        BankSign:       1.0,
        Thickness:      0.60,
        AccentMaterial: CourseMaterial.PaintBlue
    }),

    // ㉒ Track C South Backstretch: 72 m Serpentine Alternating-Camber Wave Rollers
    ConstructSerpentineWaveSurface({
        Key:            "TrackCSerpentineWave",
        ShapePrefix:    "SerpentineWave72",
        Origin:         [-38.0, -166.0, 0.0],
        Yaw:            Math.PI,
        Length:         72.0,
        Width:          14.5,
        WaveCount:      3,
        Amplitude:      0.92,
        PeakAngle:      (28.0 * Math.PI) / 180.0,
        Thickness:      0.58,
        AccentMaterial: CourseMaterial.PaintYellow
    }),

    // ㉓ Track C West Slingshot Hairpin: 180° Bowl back onto the Kinetic Wave Bollard Avenue & West Connector
    ConstructBankedTurnSurface({
        Key:            "TrackCWestBowl",
        ShapePrefix:    "VelodromeBowl",
        Origin:         [-96.0, -130.0, 0.0],
        StartAngle:     0.5 * Math.PI,
        SweepAngle:     Math.PI,
        InnerRadius:    24.0,
        OuterRadius:    46.0,
        RampAngle:      0.15 * Math.PI,
        MinimumSlope:   0.25,
        PeakSlope:      1.08,
        CopingWidth:    3.4,
        CopingLift:     2.2,
        Thickness:      0.68,
        AccentMaterial: CourseMaterial.PaintGreen
    }),

    // ===================================================================================================================
    // [TRACK D · SEISMIC COLLAPSE WING] REAR-TO-FRONT COLLAPSING SKY-BRIDGE (+5.0 m) & COLLAPSING SINKHOLE ROAD (0.0 m)
    // ===================================================================================================================

    // ㉔ Collapsing Sky-Bridge (Eastbound at Y = -250.0, X: -52 -> +112, 112 m fracturing elevated span at Z = +5.0 m)
    ConstructCollapseDeckSurface({
        Key:            "CollapseSkyBridge",
        ShapePrefix:    "SkyBridge50",
        Origin:         [-52.0, -250.0, 0.0],
        Yaw:            0.0,
        UpLength:       26.0,
        DeckLength:     112.0,
        DownLength:     26.0,
        Height:         5.00,
        Width:          14.0,
        Thickness:      0.62,
        BayCount:       14,
        ChasmDepth:     5.00,
        AccentMaterial: CourseMaterial.PaintYellow
    }),

    // ㉕ Track D East Turnaround Bowl (sweeps Y = -250 Eastbound around onto Y = -318 Westbound Collapse Road)
    ConstructBankedTurnSurface({
        Key:            "TrackDEastBowl",
        ShapePrefix:    "VelodromeBowl",
        Origin:         [156.0, -284.0, 0.0],
        StartAngle:     -0.5 * Math.PI,
        SweepAngle:     Math.PI,
        InnerRadius:    24.0,
        OuterRadius:    46.0,
        RampAngle:      0.15 * Math.PI,
        MinimumSlope:   0.25,
        PeakSlope:      1.08,
        CopingWidth:    3.4,
        CopingLift:     2.2,
        Thickness:      0.68,
        AccentMaterial: CourseMaterial.BannerAmber
    }),

    // ㉖ Subterranean Sand Sinkhole Chasm directly beneath Collapsing Road (X: +56 -> -56, -5.20 m floor + escape ramps!)
    ConstructSubmergedTrenchSurface({
        Key:                "CollapseSinkholeChasm",
        ShapePrefix:        "SubwayTrench52",
        Origin:             [56.0, -318.0, 0.0],
        Yaw:                Math.PI,
        DownLength:         12.0,
        TunnelLength:       88.0,
        GalleryTileLength:  44.0,
        UpLength:           12.0,
        Width:              13.6,
        Depth:              5.20,
        Roofed:             false,
        GroundDeckOverRoof: false,
        AccentMaterial:     CourseMaterial.BannerAmber
    }),

    // ㉗ Collapsing Faultline Road (Westbound at Y = -318.0, X: +56 -> -56, flush Z = 0.0 m highway over the -5.2 m chasm!)
    ConstructCollapseDeckSurface({
        Key:            "CollapseSinkholeRoad",
        ShapePrefix:    "SkyBridge50",
        Origin:         [56.0, -318.0, 0.0],
        Yaw:            Math.PI,
        UpLength:       0.0,
        DeckLength:     112.0,
        DownLength:     0.0,
        Height:         0.0,
        Width:          14.8,
        Thickness:      0.62,
        BayCount:       14,
        ChasmDepth:     5.20,
        AccentMaterial: CourseMaterial.KerbRed
    }),

    // ㉘ Track D West Turnaround Bowl
    ConstructBankedTurnSurface({
        Key:            "TrackDWestBowl",
        ShapePrefix:    "VelodromeBowl",
        Origin:         [-96.0, -284.0, 0.0],
        StartAngle:     0.5 * Math.PI,
        SweepAngle:     Math.PI,
        InnerRadius:    24.0,
        OuterRadius:    46.0,
        RampAngle:      0.15 * Math.PI,
        MinimumSlope:   0.25,
        PeakSlope:      1.08,
        CopingWidth:    3.4,
        CopingLift:     2.2,
        Thickness:      0.68,
        AccentMaterial: CourseMaterial.PaintYellow
    }),

    // ===================================================================================================================
    // [TRACK E · 3-LANE SUBWAY BOULEVARD] [road][tunnel down][road] -- [road][road][road] -- [road][tunnel up][road]
    // ===================================================================================================================

    // ㉙ Centre Subway Portal & Underground Station Gallery flanked by continuous Z = 0 Left & Right surface [road] lanes!
    ConstructSubmergedTrenchSurface({
        Key:                "SubwayThreeLaneCenter",
        ShapePrefix:        "SubwayTrench52",
        Origin:             [-68.0, 256.0, 0.0],
        Yaw:                0.0,
        DownLength:         24.0,
        TunnelLength:       88.0,
        GalleryTileLength:  44.0,
        UpLength:           24.0,
        Width:              13.6,
        Depth:              5.20,
        Roofed:             true,
        GroundDeckOverRoof: true,
        AccentMaterial:     CourseMaterial.GateLamp
    }),

    // ===================================================================================================================
    // [TRACK G · UNDERGROUND CONSTRUCTION SITE] OPEN BOOLEAN HOLES: THROUGH-TRENCH (COMES BACK UP) + DEAD-END PIT
    // ===================================================================================================================

    // ㉚ North Construction Lane (Y = -386.0): Open Boolean Road Hole -> -5.2 m Shored Utility Trench -> Comes Back Up!
    ConstructSubmergedTrenchSurface({
        Key:                "ConstructionThroughTrench",
        ShapePrefix:        "SubwayTrench52",
        Origin:             [-56.0, -386.0, 0.0],
        Yaw:                0.0,
        DownLength:         24.0,
        TunnelLength:       64.0,
        GalleryTileLength:  32.0,
        UpLength:           24.0,
        Width:              13.6,
        Depth:              5.20,
        Roofed:             false,
        GroundDeckOverRoof: false,
        AccentMaterial:     CourseMaterial.BannerAmber
    }),

    // ㉛ South Construction Lane (Y = -418.0): Open Boolean Road Hole -> -5.2 m Dead-End Underground Excavation Pit!
    ConstructSubmergedTrenchSurface({
        Key:                "ConstructionDeadEndPit",
        ShapePrefix:        "SubwayTrench52",
        Origin:             [-56.0, -418.0, 0.0],
        Yaw:                0.0,
        DeadEnd:            true,
        DownLength:         24.0,
        TunnelLength:       64.0,
        GalleryTileLength:  32.0,
        Width:              15.6,
        Depth:              5.20,
        Roofed:             false,
        GroundDeckOverRoof: false,
        AccentMaterial:     CourseMaterial.BannerAmber
    })
]);

const SegmentBundle = ConstructSurfaceSegmentDescriptors(InversionArenaSurfaces);

export const InversionPhysicsCutouts = Object.freeze(
    InversionArenaSurfaces.flatMap((Surface) => Surface.PhysicsCutouts || [])
);

export const InversionDistanceCutouts = Object.freeze(
    InversionArenaSurfaces.filter((Surface) => Surface.DistanceCutout).map((Surface) => Surface.DistanceCutout)
);

const VisualGroundCutouts = InversionArenaSurfaces.flatMap((Surface) => Surface.VisualCutouts || []);

export const InversionArenaShapes = Object.freeze({
    ...SegmentBundle.Shapes,
    ...ConstructCollapseProxyShapes(),
    ...ConstructTramShapes(),
    ...ConstructInfrastructureShapes(),
    ...ConstructFactoryAndServiceShapes(),
    ...ConstructTrafficLightShapes(),
    LoopPylon:         { Emit: () => EmitBoxFacets(0.85,  0.85, 18.8, CourseMaterial.SteelDark),      Voxel: 0.0,  Cards: 0, Distance: false },
    LoopCrossBeam:     { Emit: () => EmitBoxFacets(0.80, 23.60,  0.75, CourseMaterial.SteelDark),     Voxel: 0.0,  Cards: 0, Distance: false },
    LoopCrownLamp:     { Emit: () => EmitBoxFacets(0.45,  9.20,  0.16, CourseMaterial.GateLamp),      Voxel: 0.0,  Cards: 0, Distance: false },
    RaceGantryPost:    { Emit: () => EmitBoxFacets(0.75,  0.75,  7.60, CourseMaterial.SteelDark),     Voxel: 0.0,  Cards: 0, Distance: false },
    RaceGantryBeam:    { Emit: () => EmitBoxFacets(1.10, 24.40,  0.90, CourseMaterial.WallCobalt),    Voxel: 0.0,  Cards: 0, Distance: false },
    RaceGantryLamp:    { Emit: () => EmitBoxFacets(0.55, 18.00,  0.18, CourseMaterial.GateLamp),      Voxel: 0.0,  Cards: 0, Distance: false },
    SpineDeckPylon:    { Emit: () => EmitBoxFacets(0.70, 12.60,  3.40, CourseMaterial.TunnelConcrete), Voxel: 0.0,  Cards: 0, Distance: false },
    BridgePier:        { Emit: () => EmitBoxFacets(1.10, 13.40,  4.36, CourseMaterial.TunnelConcrete), Voxel: 0.0,  Cards: 0, Distance: false },
    StationPlatform:   { Emit: () => EmitBoxFacets(32.0,  3.40,  0.42, CourseMaterial.ApronConcrete,
                         [CourseMaterial.PaintYellow, CourseMaterial.PaintYellow, CourseMaterial.BarrierConcrete,
                          CourseMaterial.BarrierConcrete, CourseMaterial.ApronConcrete, CourseMaterial.TunnelConcrete]), Voxel: 0.28, Cards: 6 },
    LongBarrier:       { Emit: () => EmitBoxFacets(8.00,  0.65,  0.85, CourseMaterial.BarrierConcrete), Voxel: 0.20, Cards: 6 },
    TunnelCeilingLamp: { Emit: () => EmitBoxFacets(4.60,  0.48,  0.10, CourseMaterial.GateLamp),      Voxel: 0.0,  Cards: 0, Distance: false },
    BollardSocket:     { Emit: () => EmitBoxFacets(0.76,  0.76,  0.04, CourseMaterial.SteelDark),     Voxel: 0.0,  Cards: 0, Distance: false },
    KineticBollard:    { Emit: () => EmitBoxFacets(0.46,  0.46,  1.42, CourseMaterial.SteelDark,
                         [CourseMaterial.PaintYellow, CourseMaterial.GateLamp, CourseMaterial.PaintYellow,
                          CourseMaterial.GateLamp, CourseMaterial.GateLamp, CourseMaterial.SteelDark]), Voxel: 0.15, Cards: 10 },
    WaveBollard:       { Emit: () => EmitBoxFacets(0.54,  0.54,  1.76, CourseMaterial.WallCobalt,
                         [CourseMaterial.BannerAmber, CourseMaterial.GateLamp, CourseMaterial.BannerAmber,
                          CourseMaterial.GateLamp, CourseMaterial.GateLamp, CourseMaterial.SteelDark]), Voxel: 0.17, Cards: 10 },
    TriggerBeacon:     { Emit: () => EmitBoxFacets(0.95,  0.95,  4.20, CourseMaterial.WallCrimson),   Voxel: 0.34, Cards: 8 }
});

export const InversionArenaTerrainHulls = Object.freeze(SegmentBundle.TerrainHulls);

//------------------------------------------------------------------------------------------------------------------------
//                                  STARTING GRID, TELEPORTS & STUNT EVENTS
//------------------------------------------------------------------------------------------------------------------------

export const InversionArenaSpawn = Object.freeze({
    Position: Object.freeze([-88.0, -38.3]),
    Yaw:      0.0
});

export const InversionArenaZones = Object.freeze([
    { Name: "Start Grid",                Position: [-88.0,  -38.3], Yaw:   0.0, Note: "Track A Grid → 360° Helical Loop" },
    { Name: "Waves & Tabletop",          Position: [ -2.0,  -29.7], Yaw:   0.0, Note: "Track A Triple Camelback Waves → Skyline Tabletop" },
    { Name: "Turn 1 Bowl",               Position: [140.0,  -31.5], Yaw:   0.0, Note: "Track A 180° Thunderdome 47° Superelevated Bowl" },
    { Name: "Heartline S-Bridge",        Position: [164.0,   35.0], Yaw: 180.0, Note: "Track A 84 m Zero-G Heartline +35°/−35° Sky-Bridge" },
    { Name: "Corkscrew Pipe",            Position: [112.0,   14.6], Yaw: 160.0, Note: "Track A 360° Upside-Down Ceiling Carve in Full-Pipe" },
    { Name: "Twin-Wing V",               Position: [  2.0,   29.8], Yaw: 180.0, Note: "Track A ±38° Split V-Camber Canyon → Turn 2 Bowl" },
    { Name: "Infield Spine",             Position: [-86.0,    0.0], Yaw:   0.0, Note: "Track A 45° Spine Gap → 4.5 m Whale-Tail Kicker" },
    { Name: "125° Cradle",               Position: [ 74.0,    0.0], Yaw:   0.0, Note: "Track A 22 m 125° Over-Vert Inversion Wall" },
    { Name: "Track B · Split Tunnel/Sky", Position: [-82.0,   94.0], Yaw:   0.0, Note: "Left: -5.2 m Underground Tunnel · Right: +5.0 m Sky-Bridge" },
    { Name: "Track B · Underpass Road",   Position: [ 12.0,   58.0], Yaw:  90.0, Note: "Drive OVER -5.2 m Subway & UNDER +5.0 m Sky-Bridge" },
    { Name: "Track B · Linear Bollards",  Position: [ 58.0,  166.0], Yaw: 180.0, Note: "Proximity Trigger #1 — Linear Retracting Bollard Strip" },
    { Name: "Track C · Wave Bollards",    Position: [-98.0,  -94.0], Yaw:   0.0, Note: "Proximity Trigger #2 — 84 m Seesaw Travelling-Wave Bollards" },
    { Name: "Track C · Canyon Underpass", Position: [ 78.0,  -46.0], Yaw: -90.0, Note: "Dive -5.2 m UNDER the +5.0 m Track C Viaduct Bridge" },
    { Name: "Track C · South 360° Loop",  Position: [148.0, -162.0], Yaw: 180.0, Note: "Westbound 360° Loop → 46° Corkscrew Wing → Serpentine Waves" },
    { Name: "Track D · Collapsing Bridge", Position: [-92.0, -250.0], Yaw:   0.0, Note: "Outrun rear-to-front +5 m Bridge collapse, movie cracks & sand!" },
    { Name: "Track D · Collapsing Road",   Position: [  84.0, -318.0], Yaw: 180.0, Note: "Outrun rear-to-front Sinkhole Road collapse & sand fissures!" },
    { Name: "Track E · 3-Lane Subway",     Position: [-104.0,  256.0], Yaw:   0.0, Note: "[road][tunnel down][road] → [road][road][road] → [road][tunnel up][road]" },
    { Name: "Track F · Trams & Trains",    Position: [ -98.0,  314.0], Yaw:   0.0, Note: "Two-way Articulated Streetcar Trams & Express Commuter Trains" },
    { Name: "Track G · Thru Trench",       Position: [-108.0, -386.0], Yaw:   0.0, Note: "CONSTRUCTION AHEAD & Amber Lights → Open Hole Trench (comes back up!)" },
    { Name: "Track G · Dead-End Pit",      Position: [-108.0, -418.0], Yaw:   0.0, Note: "CONSTRUCTION AHEAD & Amber Lights → Underground Dead-End Pit!" },
    { Name: "Track H · Auto Fuel Bay",     Position: [ -74.0,  392.0], Yaw:   0.0, Note: "Pull into crimson bay & stop — 6-Axis Industrial Robot Arm refuels tank!" },
    { Name: "Track H · Auto EV Charge",    Position: [ -74.0,  420.0], Yaw:   0.0, Note: "Pull into cobalt/green bay & stop — 6-Axis Industrial Robot Arm 800V charge!" },
    { Name: "Track H · Factory Hall",      Position: [  -4.0,  408.0], Yaw:   0.0, Note: "Drive straight inside the Megafactory (industrial welding robots, presses & conveyors!)" }
]);

export const InversionArenaDrills = Object.freeze([
    {
        Id:       "loop360",
        Name:     "360° Inversion Loop",
        Glyph:    "RefreshCw",
        Note:     "Invert 180° through the 18 m Helical Loop onto the Wave Bridge",
        Groups:   ["loop"],
        Teleport: { Position: [-88.0, -38.3], Yaw: 0.0 },
        Start:    { Axis: "x", At: -31.0, From: -46.0, To: -30.0, Direction: 1.0 },
        Finish:   { Axis: "x", At: -15.5, From: -36.0, To: -22.0, Direction: 1.0 }
    },
    {
        Id:       "heartline",
        Name:     "Heartline S-Bridge",
        Glyph:    "TrendingUp",
        Note:     "Whip +35° Left → 0° Heartline → −35° Right across the elevated Sky-Bridge",
        Groups:   ["heartline"],
        Teleport: { Position: [166.0, 35.0], Yaw: 180.0 },
        Start:    { Axis: "x", At: 152.0, From: 26.0, To: 44.0, Direction: -1.0 },
        Finish:   { Axis: "x", At:  68.0, From: 26.0, To: 44.0, Direction: -1.0 }
    },
    {
        Id:       "pipecork",
        Name:     "Full-Pipe Corkscrew",
        Glyph:    "CircleDot",
        Note:     "Carve 45° → 90° → 180° upside-down across the Full-Pipe Tunnel ceiling",
        Groups:   ["pipe"],
        Teleport: { Position: [112.0, 14.6], Yaw: 160.0 },
        Start:    { Axis: "x", At: 54.0, From: 27.0, To: 43.0, Direction: -1.0 },
        Finish:   { Axis: "x", At: -2.5, From: 27.0, To: 43.0, Direction: -1.0 }
    },
    {
        Id:       "spinetransfer",
        Name:     "Infield Spine Gap",
        Glyph:    "Zap",
        Note:     "Launch the 45° Infield Skate Spine across the gap onto the receiver ramp",
        Groups:   ["spine"],
        Teleport: { Position: [-86.0, 0.0], Yaw: 0.0 },
        Lip:      -33.9,
        LateralY:   0.0,
        HalfSpan:   7.5
    }
]);

export const InversionClearZones = Object.freeze([
    [-148.0,  -52.0, 214.0,  -20.0],   // Track A South Outbound Straight
    [-148.0,   20.0, 214.0,   52.0],   // Track A North Return Straight
    [ 148.0, -444.0, 218.0,  444.0],   // East Bowls & Inter-Track Avenue (Tracks A..H)
    [-148.0, -444.0, -76.0,  444.0],   // West Bowls & Inter-Track Avenue (Tracks A..H)
    [ -88.0,  -14.0, 138.0,   14.0],   // Track A Infield Stunt Expressway
    [-148.0,   72.0, 214.0,  184.0],   // Track B Subterranean Split & Return Corridors
    [-148.0, -186.0, 214.0,  -74.0],   // Track C Kinetic Wave & Backstretch Corridors
    [-148.0, -346.0, 214.0, -228.0],   // Track D Collapsing Bridge & Collapsing Road Corridors
    [-148.0,  234.0, 214.0,  356.0],   // Track E 3-Lane Subway & Track F Tram/Train Corridors
    [-148.0, -442.0, 214.0, -370.0],   // Track G Underground Construction Site Corridors
    [-148.0,  372.0, 214.0,  442.0],   // Track H Drive-Through Factory & Automatic Service Plaza
    [  -4.0,   52.0,  28.0,  140.0],   // North Underpass Connector Boulevard
    [  64.0, -140.0,  92.0,  -52.0]    // South Canyon Underpass Connector
]);

//------------------------------------------------------------------------------------------------------------------------
//                           PROXIMITY TRIGGER ZONES & KINETIC BOLLARD STRIPS
//------------------------------------------------------------------------------------------------------------------------

export function ResolveInversionBollards()
{
    // ① Trigger #1 (Track B Return Straight, Westbound X: +32 -> -28, Y = +166):
    //    Simple Linear Retracting Bollard Strip — 7 sequential gate rows × 4 bollards across the road
    const LinearPosts = [];
    const LinearRows = 7;
    for (let Row = 0; Row < LinearRows; ++Row)
    {
        const X = 28.0 - Row * 9.0;
        const NormalizedU = Row / (LinearRows - 1);
        for (const OffsetY of [-4.8, -1.6, 1.6, 4.8])
        {
            LinearPosts.push({
                Shape:       "KineticBollard",
                Position:    [X, 166.0 + OffsetY, 0.0],
                Yaw:         0.0,
                Height:      1.42,
                NormalizedU,
                Side:        OffsetY >= 0.0 ? 1 : -1,
                InnerLane:   true
            });
        }
    }

    // ② Trigger #2 (Track C Outbound Avenue, Eastbound X: -76 -> +8, Y = -94):
    //    84 m Travelling Seesaw Wave Bollard Strip — 16 longitudinal stations × 2 counter-phased ranks:
    //    1 side rises while the opposite side sinks, and the entry end goes UP while the far end goes DOWN!
    const WavePosts = [];
    const WaveStations = 16;
    for (let Station = 0; Station < WaveStations; ++Station)
    {
        const X = -76.0 + Station * 5.6;
        const NormalizedU = Station / (WaveStations - 1);
        const InnerToggle = (Station & 1) === 1;
        const LeftY  = InnerToggle ? -90.6 : -87.8;
        const RightY = InnerToggle ? -97.4 : -100.2;
        WavePosts.push({
            Shape:       "WaveBollard",
            Position:    [X, LeftY, 0.0],
            Yaw:         0.0,
            Height:      1.76,
            NormalizedU,
            Side:        1,
            InnerLane:   InnerToggle
        });
        WavePosts.push({
            Shape:       "WaveBollard",
            Position:    [X, RightY, 0.0],
            Yaw:         0.0,
            Height:      1.76,
            NormalizedU,
            Side:        -1,
            InnerLane:   InnerToggle
        });
    }

    return [
        {
            Id:          "linearStrip",
            Name:        "Track B Linear Bollards",
            ShortName:   "Linear Bollards (B)",
            Mode:        "linear",
            Trigger:     { MinX: -38.0, MaxX: 62.0, MinY: 155.0, MaxY: 177.0 },
            HoldSeconds: 1.8,
            OpenSpeed:   3.8,
            CloseSpeed:  1.6,
            Beacon:      { Shape: "TriggerBeacon", Position: [38.0, 175.2, 0.0], Yaw: 0.0 },
            Posts:       LinearPosts
        },
        {
            Id:          "waveStrip",
            Name:        "Track C Wave Bollards",
            ShortName:   "Wave Bollards (C)",
            Mode:        "wave",
            Trigger:     { MinX: -106.0, MaxX: 20.0, MinY: -106.0, MaxY: -82.0 },
            HoldSeconds: 2.4,
            OpenSpeed:   3.4,
            CloseSpeed:  1.4,
            WaveSpeed:   3.4,
            Beacon:      { Shape: "TriggerBeacon", Position: [-82.0, -85.2, 0.0], Yaw: 0.0 },
            Posts:       WavePosts
        }
    ];
}

//------------------------------------------------------------------------------------------------------------------------
//                                  MULTI-TRACK SURFACE & PAINTED LIVERY
//------------------------------------------------------------------------------------------------------------------------

const PaintLift = 0.004;

function SubtractCutoutFromRects(Rects, Cutout)
{
    const [CX0, CY0, CX1, CY1] = Cutout;
    const Result = [];
    for (const Rect of Rects)
    {
        const [X0, Y0, X1, Y1] = Rect;
        if (X1 <= CX0 || X0 >= CX1 || Y1 <= CY0 || Y0 >= CY1)
        {
            Result.push(Rect);
            continue;
        }
        if (X0 < CX0) Result.push([X0, Y0, CX0, Y1]);
        if (X1 > CX1) Result.push([CX1, Y0, X1, Y1]);
        const MidX0 = Math.max(X0, CX0), MidX1 = Math.min(X1, CX1);
        if (MidX1 > MidX0)
        {
            if (Y0 < CY0) Result.push([MidX0, Y0, MidX1, CY0]);
            if (Y1 > CY1) Result.push([MidX0, CY1, MidX1, Y1]);
        }
    }
    return Result;
}

//------------------------------------------------------------------------------------------------------------------------
//                      SHARED HIGHWAY WAYPOINT GANTRY & ROADSIDE SIGNAGE MANIFEST
//------------------------------------------------------------------------------------------------------------------------

const HighwayOverheadGantries = Object.freeze([
    {
        Label:   "Main Straight Airport/City Waypoint",
        X:        42.0,
        CentreY: -35.0,
        Yaw:      0.0,
        Boards: [
            { OffsetY:  5.4, Shape: "WaypointBoardGreen", Width: 9.8, Height: 2.5, Line1: "AIRPORT 500 KM ^",     Line2: "INTL EXPRESSWAY",  Border: CourseMaterial.PaintWhite, Text: CourseMaterial.PaintWhite },
            { OffsetY: -5.4, Shape: "WaypointBoardBlue",  Width: 9.2, Height: 2.5, Line1: "FRONTIER CITY 500 M >", Line2: "DOWNTOWN EXIT 2",  Border: CourseMaterial.PaintWhite, Text: CourseMaterial.PaintWhite }
        ]
    },
    {
        Label:   "North Return Ring-Road Waypoint",
        X:        34.0,
        CentreY:  35.0,
        Yaw:      Math.PI,
        Boards: [
            { OffsetY:  5.4, Shape: "WaypointBoardGreen", Width: 9.8, Height: 2.5, Line1: "METRO CITY 500 M ^",    Line2: "WEST RING ROAD",   Border: CourseMaterial.PaintWhite, Text: CourseMaterial.PaintWhite },
            { OffsetY: -5.4, Shape: "WaypointBoardGreen", Width: 9.8, Height: 2.5, Line1: "SKYPORT 500 KM ^",      Line2: "CARGO TERMINAL",   Border: CourseMaterial.PaintWhite, Text: CourseMaterial.PaintWhite }
        ]
    },
    {
        Label:   "Track B Split Tunnel/Sky Waypoint",
        X:       -44.0,
        CentreY:  94.0,
        Yaw:      0.0,
        Boards: [
            { OffsetY: -5.4, Shape: "WaypointBoardBlue",  Width: 9.2, Height: 2.5, Line1: "SUBWAY TUNNEL v",       Line2: "UNDERGROUND -5M",  Border: CourseMaterial.PaintWhite, Text: CourseMaterial.PaintWhite },
            { OffsetY:  5.4, Shape: "WaypointBoardGreen", Width: 9.8, Height: 2.5, Line1: "APEX CITY 500 M ^",     Line2: "SKY BRIDGE +5M",   Border: CourseMaterial.PaintWhite, Text: CourseMaterial.PaintWhite }
        ]
    },
    {
        Label:   "Track E 3-Lane Subway & Airport Waypoint",
        X:       -82.0,
        CentreY:  256.0,
        Yaw:      0.0,
        Boards: [
            { OffsetY:  9.2, Shape: "WaypointBoardGreen", Width: 9.8, Height: 2.5, Line1: "HARBOR CITY 500 M ^",   Line2: "LEFT SURFACE RD",  Border: CourseMaterial.PaintWhite, Text: CourseMaterial.PaintWhite },
            { OffsetY:  0.0, Shape: "WaypointBoardBlue",  Width: 9.2, Height: 2.5, Line1: "SUBWAY DOWN 15 M v",    Line2: "CENTER TUNNEL",    Border: CourseMaterial.PaintWhite, Text: CourseMaterial.PaintWhite },
            { OffsetY: -9.2, Shape: "WaypointBoardGreen", Width: 9.8, Height: 2.5, Line1: "AIRPORT 500 KM ^",      Line2: "RIGHT SURFACE RD", Border: CourseMaterial.PaintWhite, Text: CourseMaterial.PaintWhite }
        ]
    },
    {
        Label:   "Track G Construction Site Portal",
        X:       -82.0,
        CentreY: -402.0,
        Yaw:      0.0,
        SpanHalf: 22.4,
        Boards: [
            { OffsetY:  14.0, Shape: "WaypointBoardAmber", Width: 10.6, Height: 2.45, Line1: "CONSTRUCTION AHEAD", Line2: "THRU TRENCH ^",   Border: CourseMaterial.SteelDark, Text: CourseMaterial.SteelDark },
            { OffsetY:   0.0, Shape: "WaypointBoardAmber", Width: 10.6, Height: 2.45, Line1: "CONSTRUCTION AHEAD", Line2: "OPEN ROAD HOLES", Border: CourseMaterial.SteelDark, Text: CourseMaterial.SteelDark },
            { OffsetY: -14.0, Shape: "WaypointBoardAmber", Width: 10.6, Height: 2.45, Line1: "CONSTRUCTION AHEAD", Line2: "DEAD END PIT !",  Border: CourseMaterial.SteelDark, Text: CourseMaterial.SteelDark }
        ]
    },
    {
        Label:   "Track H Factory & Auto-Service Portal",
        X:       -84.0,
        CentreY:  406.0,
        Yaw:      0.0,
        SpanHalf: 22.4,
        Boards: [
            { OffsetY:  14.0, Shape: "WaypointBoardGreen", Width: 9.8,  Height: 2.50, Line1: "AUTO EV CHARGE ^",   Line2: "STOP FOR ROBOT",  Border: CourseMaterial.PaintWhite, Text: CourseMaterial.PaintWhite },
            { OffsetY:   0.0, Shape: "WaypointBoardBlue",  Width: 9.2,  Height: 2.50, Line1: "FRONTIER FACTORY ^", Line2: "ASSEMBLY HALL 1", Border: CourseMaterial.PaintWhite, Text: CourseMaterial.PaintWhite },
            { OffsetY: -14.0, Shape: "WaypointBoardAmber", Width: 10.6, Height: 2.45, Line1: "AUTO FUEL BAY ^",    Line2: "STOP FOR ROBOT",  Border: CourseMaterial.SteelDark,  Text: CourseMaterial.SteelDark }
        ]
    }
]);

const RoadsideSigns = Object.freeze([
    // Construction Site Advance Warning Signs ("CONSTRUCTION AHEAD" before BOTH underground holes!)
    { Name: "Const Ahead N1", X: -98.0, Y: -375.5, Z: 0.0,   Yaw: 0.0,          Shape: "RoadsideBoardAmber", Width: 4.2, Height: 1.55, Line1: "CONSTRUCTION AHEAD", Line2: "OPEN TRENCH 40M",  Text: CourseMaterial.SteelDark },
    { Name: "Const Ahead N2", X: -66.0, Y: -375.5, Z: 0.0,   Yaw: 0.0,          Shape: "RoadsideBoardAmber", Width: 4.2, Height: 1.55, Line1: "THRU TRENCH ^",      Line2: "COMES BACK UP",    Text: CourseMaterial.SteelDark },
    { Name: "Const Ahead S1", X: -98.0, Y: -429.5, Z: 0.0,   Yaw: 0.0,          Shape: "RoadsideBoardAmber", Width: 4.2, Height: 1.55, Line1: "CONSTRUCTION AHEAD", Line2: "DEAD END PIT !",   Text: CourseMaterial.SteelDark },
    { Name: "Const Ahead S2", X: -66.0, Y: -429.5, Z: 0.0,   Yaw: 0.0,          Shape: "RoadsideBoardAmber", Width: 4.2, Height: 1.55, Line1: "CAUTION -5.2 M !",   Line2: "NO EXIT BELOW",    Text: CourseMaterial.SteelDark },
    // Underground Dead-End Pit Bulkhead Sign (mounted inside the -5.2 m subterranean dead-end chamber!)
    { Name: "DeadEnd Pit Sign", X: 30.8, Y: -418.0, Z: -5.20, Yaw: 0.0,         Shape: "RoadsideBoardAmber", Width: 4.2, Height: 1.55, Line1: "DEAD END PIT !",     Line2: "TURN AROUND <<",   Text: CourseMaterial.SteelDark },
    // Highway Waypoint & Distance Signs across the Complex ("500 KM TO AIRPORT", "500 M TO X CITY", hazards & limits)
    { Name: "Start Waypoint",   X: -62.0, Y: -48.5, Z: 0.0,  Yaw: 0.0,          Shape: "RoadsideBoardGreen", Width: 4.2, Height: 1.55, Line1: "500 KM AIRPORT ^",   Line2: "500 M NEXUS CITY", Text: CourseMaterial.PaintWhite },
    { Name: "Wave Bollard Sign",X: -88.0, Y: -103.5,Z: 0.0,  Yaw: 0.0,          Shape: "RoadsideBoardAmber", Width: 4.2, Height: 1.55, Line1: "WAVE BOLLARDS !",    Line2: "MOVING ROAD PITS", Text: CourseMaterial.SteelDark },
    { Name: "Canyon Dive Sign", X:  87.5, Y: -48.0, Z: 0.0,  Yaw: -0.5*Math.PI, Shape: "RoadsideBoardGreen", Width: 4.2, Height: 1.55, Line1: "CANYON TUNNEL v",    Line2: "500 M SOLAR CITY", Text: CourseMaterial.PaintWhite },
    { Name: "Bridge Sign",      X: -72.0, Y: -260.5,Z: 0.0,  Yaw: 0.0,          Shape: "RoadsideBoardAmber", Width: 4.2, Height: 1.55, Line1: "FALLING BRIDGE !",   Line2: "FULL THROTTLE ^",  Text: CourseMaterial.SteelDark },
    { Name: "Sinkhole Sign",    X:  72.0, Y: -306.5,Z: 0.0,  Yaw: Math.PI,      Shape: "RoadsideBoardAmber", Width: 4.2, Height: 1.55, Line1: "SINKHOLE ROAD !",    Line2: "FLOOR DROPS -5M",  Text: CourseMaterial.SteelDark },
    { Name: "South Waypoint",   X: -48.0, Y: -237.5,Z: 0.0,  Yaw: 0.0,          Shape: "RoadsideBoardGreen", Width: 4.2, Height: 1.55, Line1: "500 KM AIRPORT >",   Line2: "500 M COAST CITY", Text: CourseMaterial.PaintWhite },
    { Name: "Tram Xing Sign",   X: -88.0, Y:  306.5,Z: 0.0,  Yaw: 0.0,          Shape: "RoadsideBoardAmber", Width: 4.2, Height: 1.55, Line1: "LIVE TRAMS XING !",  Line2: "EXPRESS TRAINS ^", Text: CourseMaterial.SteelDark },
    { Name: "North Waypoint",   X:  18.0, Y:  238.5,Z: 0.0,  Yaw: 0.0,          Shape: "RoadsideBoardGreen", Width: 4.2, Height: 1.55, Line1: "500 KM SKYPORT ^",   Line2: "500 M METRO CITY", Text: CourseMaterial.PaintWhite },
    { Name: "Bowl Chevron E",   X: 178.0, Y:  -12.0,Z: 0.0,  Yaw: 0.0,          Shape: "ChevronHazardBoard", Width: 2.8, Height: 1.25, Line1: ">>> BANK 47 >>>",    Line2: "",                 Text: CourseMaterial.SteelDark },
    // Track H Automatic Fuel Station, 800V EV Charging Station & Megafactory Signs!
    { Name: "Auto Fuel Sign",   X: -66.5, Y:  384.5,Z: 0.0,  Yaw: 0.0,          Shape: "RoadsideBoardAmber", Width: 4.2, Height: 1.55, Line1: "AUTO FUEL BAY",      Line2: "ROBOT ARM BAY",    Text: CourseMaterial.SteelDark },
    { Name: "Auto EV Sign",     X: -66.5, Y:  429.5,Z: 0.0,  Yaw: 0.0,          Shape: "RoadsideBoardGreen", Width: 4.2, Height: 1.55, Line1: "AUTO 800V EV BAY",   Line2: "ROBOT ARM BAY",    Text: CourseMaterial.PaintWhite },
    { Name: "Factory West Sign",X:   6.0, Y:  396.0,Z: 0.0,  Yaw: 0.0,          Shape: "RoadsideBoardGreen", Width: 4.2, Height: 1.55, Line1: "FRONTIER FACTORY",   Line2: "DRIVE THRU HALL",  Text: CourseMaterial.PaintWhite },
    { Name: "Factory East Sign",X: 130.0, Y:  420.0,Z: 0.0,  Yaw: Math.PI,      Shape: "RoadsideBoardGreen", Width: 4.2, Height: 1.55, Line1: "FRONTIER FACTORY",   Line2: "STAMPING LINE 1",  Text: CourseMaterial.PaintWhite }
]);

export function EmitInversionGroundFacets()
{
    const Facets = [];
    const MinX = InversionArenaBounds.Minimum[0], MaxX = InversionArenaBounds.Maximum[0];
    const MinY = InversionArenaBounds.Minimum[1], MaxY = InversionArenaBounds.Maximum[1];
    const CentreX = 0.5 * (MinX + MaxX);
    const Outer = 1850.0;

    // Collect true 3D boolean ground cutouts for ALL underground portals AND all 60 Wavy & Linear Bollard shafts!
    const BollardSocketHalf = 0.39;
    const BollardSocketDepth = 1.92;
    const BollardPosts = ResolveInversionBollards().flatMap((Zone) => Zone.Posts);
    const BollardCutouts = BollardPosts.map((Post) => [
        Post.Position[0] - BollardSocketHalf,
        Post.Position[1] - BollardSocketHalf,
        Post.Position[0] + BollardSocketHalf,
        Post.Position[1] + BollardSocketHalf
    ]);
    const AllGroundCutouts = [...VisualGroundCutouts, ...BollardCutouts];

    const SubtractAllCutouts = (InitialRects) =>
    {
        let Pieces = InitialRects;
        for (const Cutout of AllGroundCutouts)
            Pieces = SubtractCutoutFromRects(Pieces, Cutout);
        return Pieces;
    };

    // ① Surrounding sub-grade turf (Z = -0.02) WITH boolean cutouts subtracted so NO grass sheet blocks any underground hole!
    for (const [TX0, TY0, TX1, TY1] of SubtractAllCutouts([[CentreX - Outer, -Outer, CentreX + Outer, Outer]]))
        EmitQuad(Facets, [TX0, TY0, -0.02], [TX1, TY0, -0.02], [TX1, TY1, -0.02], [TX0, TY1, -0.02], CourseMaterial.Grass);

    // ② Multi-track asphalt & concrete grid with true boolean holes for every underground passage & bollard shaft
    const Cell = 12.0;
    const Rows = Math.ceil((MaxX - MinX) / Cell);
    const Cols = Math.ceil((MaxY - MinY) / Cell);
    for (let Row = 0; Row < Rows; ++Row)
    {
        for (let Col = 0; Col < Cols; ++Col)
        {
            const X0 = MinX + Row * Cell, X1 = Math.min(MaxX, X0 + Cell);
            const Y0 = MinY + Col * Cell, Y1 = Math.min(MaxY, Y0 + Cell);
            const UnderCollapseBridge = X1 > -56.0 && X0 < 56.0 && Y1 > -262.0 && Y0 < -238.0;
            const OnRaceCorridor =
                (Y0 <= -22.0 && Y1 >= -48.0) || (Y0 <= 48.0 && Y1 >= 22.0) || (Y0 <= 12.0 && Y1 >= -12.0) ||
                (Y0 <= 116.0 && Y1 >= 74.0)  || (Y0 <= 180.0 && Y1 >= 152.0) ||
                (Y0 <= -80.0 && Y1 >= -108.0) || (Y0 <= -152.0 && Y1 >= -184.0) ||
                (Y0 <= -238.0 && Y1 >= -262.0) || (Y0 <= -304.0 && Y1 >= -332.0) ||
                (Y0 <= 276.0 && Y1 >= 236.0) || (Y0 <= 352.0 && Y1 >= 306.0) ||
                (Y0 <= -372.0 && Y1 >= -434.0);
            const Checker = ((Row >> 1) + (Col >> 1)) & 1;
            const Family = UnderCollapseBridge
                ? CourseMaterial.Earth
                : (OnRaceCorridor ? CourseMaterial.Asphalt : (Checker ? CourseMaterial.AsphaltPatch : CourseMaterial.Asphalt));

            for (const [PX0, PY0, PX1, PY1] of SubtractAllCutouts([[X0, Y0, X1, Y1]]))
                EmitQuad(Facets, [PX0, PY0, 0.0], [PX1, PY0, 0.0], [PX1, PY1, 0.0], [PX0, PY1, 0.0], Family);
        }
    }

    // ②b 3D Road-Slab Cut Thickness Collars (Z: 0.0 -> -0.46 m) around every Underground Portal & Construction Hole!
    for (const [CX0, CY0, CX1, CY1] of VisualGroundCutouts)
    {
        const SlabBot = -0.46;
        // 4 inward-facing vertical road-slab cut faces so the boolean cut through the highway has crisp 46 cm slab thickness
        EmitQuad(Facets, [CX0, CY0, SlabBot], [CX0, CY1, SlabBot], [CX0, CY1, 0.0], [CX0, CY0, 0.0], CourseMaterial.TunnelConcrete);
        EmitQuad(Facets, [CX1, CY1, SlabBot], [CX1, CY0, SlabBot], [CX1, CY0, 0.0], [CX1, CY1, 0.0], CourseMaterial.TunnelConcrete);
        EmitQuad(Facets, [CX1, CY0, SlabBot], [CX0, CY0, SlabBot], [CX0, CY0, 0.0], [CX1, CY0, 0.0], CourseMaterial.TunnelConcrete);
        EmitQuad(Facets, [CX0, CY1, SlabBot], [CX1, CY1, SlabBot], [CX1, CY1, 0.0], [CX0, CY1, 0.0], CourseMaterial.TunnelConcrete);
    }

    // ②c True Recessed -1.92 m Sunken Steel Mechanical Shafts for ALL Wavy & Linear Kinetic Bollards!
    for (const Post of BollardPosts)
    {
        const BX0 = Post.Position[0] - BollardSocketHalf, BX1 = Post.Position[0] + BollardSocketHalf;
        const BY0 = Post.Position[1] - BollardSocketHalf, BY1 = Post.Position[1] + BollardSocketHalf;
        const BotZ = -BollardSocketDepth;
        // Shaft bottom floor (+Z normal) + 4 inward-facing mechanical shaft walls
        EmitQuad(Facets, [BX0, BY0, BotZ], [BX1, BY0, BotZ], [BX1, BY1, BotZ], [BX0, BY1, BotZ], CourseMaterial.SteelDark);
        EmitQuad(Facets, [BX0, BY0, BotZ], [BX0, BY1, BotZ], [BX0, BY1, 0.0],  [BX0, BY0, 0.0],  CourseMaterial.SteelDark);
        EmitQuad(Facets, [BX1, BY1, BotZ], [BX1, BY0, BotZ], [BX1, BY0, 0.0],  [BX1, BY1, 0.0],  CourseMaterial.SteelDark);
        EmitQuad(Facets, [BX1, BY0, BotZ], [BX0, BY0, BotZ], [BX0, BY0, 0.0],  [BX1, BY0, 0.0],  CourseMaterial.SteelDark);
        EmitQuad(Facets, [BX0, BY1, BotZ], [BX1, BY1, BotZ], [BX1, BY1, 0.0],  [BX0, BY1, 0.0],  CourseMaterial.SteelDark);
        // Flush yellow/steel collar bezel around the boolean shaft opening at Z = +0.004
        const Lip = 0.11;
        const RimMat = Post.Shape === "WaveBollard" ? CourseMaterial.BannerAmber : CourseMaterial.PaintYellow;
        EmitQuad(Facets, [BX0 - Lip, BY1, 0.004], [BX1 + Lip, BY1, 0.004], [BX1 + Lip, BY1 + Lip, 0.004], [BX0 - Lip, BY1 + Lip, 0.004], RimMat);
        EmitQuad(Facets, [BX0 - Lip, BY0 - Lip, 0.004], [BX1 + Lip, BY0 - Lip, 0.004], [BX1 + Lip, BY0, 0.004], [BX0 - Lip, BY0, 0.004], RimMat);
        EmitQuad(Facets, [BX0 - Lip, BY0, 0.004], [BX0, BY0, 0.004], [BX0, BY1, 0.004], [BX0 - Lip, BY1, 0.004], CourseMaterial.SteelDark);
        EmitQuad(Facets, [BX1, BY0, 0.004], [BX1 + Lip, BY0, 0.004], [BX1 + Lip, BY1, 0.004], [BX1, BY1, 0.004], CourseMaterial.SteelDark);
    }

    // Paint helper ALSO boolean-subtracts AllGroundCutouts so road stripes never float across open underground holes!
    const Paint = (X0, Y0, X1, Y1, Family, Lift = PaintLift) =>
    {
        const RX0 = Math.min(X0, X1), RX1 = Math.max(X0, X1);
        const RY0 = Math.min(Y0, Y1), RY1 = Math.max(Y0, Y1);
        for (const [PX0, PY0, PX1, PY1] of SubtractAllCutouts([[RX0, RY0, RX1, RY1]]))
            EmitQuad(Facets, [PX0, PY0, Lift], [PX1, PY0, Lift], [PX1, PY1, Lift], [PX0, PY1, Lift], Family);
    };

    const EmitChevron = (TipX, CentreY, DirSign, SpanY, ThicknessX, Family) =>
    {
        const BackX = TipX - DirSign * 3.2;
        if (DirSign > 0.0)
        {
            EmitQuad(Facets, [BackX, CentreY - SpanY, PaintLift], [BackX + ThicknessX, CentreY - SpanY, PaintLift],
                     [TipX + ThicknessX, CentreY, PaintLift], [TipX, CentreY, PaintLift], Family);
            EmitQuad(Facets, [TipX, CentreY, PaintLift], [TipX + ThicknessX, CentreY, PaintLift],
                     [BackX + ThicknessX, CentreY + SpanY, PaintLift], [BackX, CentreY + SpanY, PaintLift], Family);
        }
        else
        {
            EmitQuad(Facets, [TipX - ThicknessX, CentreY, PaintLift], [TipX, CentreY, PaintLift],
                     [BackX, CentreY - SpanY, PaintLift], [BackX - ThicknessX, CentreY - SpanY, PaintLift], Family);
            EmitQuad(Facets, [BackX - ThicknessX, CentreY + SpanY, PaintLift], [BackX, CentreY + SpanY, PaintLift],
                     [TipX, CentreY, PaintLift], [TipX - ThicknessX, CentreY, PaintLift], Family);
        }
    };

    const EmitChevronY = (CentreXPos, TipY, DirSign, SpanX, ThicknessY, Family) =>
    {
        const BackY = TipY - DirSign * 3.2;
        EmitQuad(Facets, [CentreXPos - SpanX, BackY, PaintLift], [CentreXPos, TipY, PaintLift],
                 [CentreXPos, TipY + DirSign * ThicknessY, PaintLift],
                 [CentreXPos - SpanX, BackY + DirSign * ThicknessY, PaintLift], Family);
        EmitQuad(Facets, [CentreXPos, TipY, PaintLift], [CentreXPos + SpanX, BackY, PaintLift],
                 [CentreXPos + SpanX, BackY + DirSign * ThicknessY, PaintLift],
                 [CentreXPos, TipY + DirSign * ThicknessY, PaintLift], Family);
    };

    const EmitRing = (CentreXPos, CentreYPos, InnerRadius, OuterRadius, Segments, Family) =>
    {
        for (let Step = 0; Step < Segments; ++Step)
        {
            const A0 = (2.0 * Math.PI * Step) / Segments;
            const A1 = (2.0 * Math.PI * (Step + 1)) / Segments;
            EmitQuad(Facets,
                     [CentreXPos + InnerRadius * Math.cos(A0), CentreYPos + InnerRadius * Math.sin(A0), PaintLift],
                     [CentreXPos + OuterRadius * Math.cos(A0), CentreYPos + OuterRadius * Math.sin(A0), PaintLift],
                     [CentreXPos + OuterRadius * Math.cos(A1), CentreYPos + OuterRadius * Math.sin(A1), PaintLift],
                     [CentreXPos + InnerRadius * Math.cos(A1), CentreYPos + InnerRadius * Math.sin(A1), PaintLift], Family);
        }
    };

    // ③ [Track A] Grand Prix Alternating Red/White Track Edge Kerbs (preserved intact)
    for (let X = -96.0, Idx = 0; X < 164.0; X += 4.0, ++Idx)
    {
        const KerbColor = (Idx & 1) ? CourseMaterial.PaintWhite : CourseMaterial.KerbRed;
        Paint(X, -46.4, X + 4.0, -45.5, KerbColor);
        Paint(X, -24.5, X + 4.0, -23.6, KerbColor);
        Paint(X,  23.6, X + 4.0,  24.5, KerbColor);
        Paint(X,  45.5, X + 4.0,  46.4, KerbColor);
    }

    // ④ [Track A] Checkered Start/Finish Line at X = −82.0 + 6 F1 Starting Grid Boxes
    for (let Row = 0; Row < 2; ++Row)
    {
        for (let Sq = 0; Sq < 22; ++Sq)
        {
            const Y0 = -45.4 + Sq * 0.95;
            const Shade = ((Row + Sq) & 1) ? CourseMaterial.PaintWhite : CourseMaterial.SteelDark;
            Paint(-82.6 + Row * 0.9, Y0, -81.7 + Row * 0.9, Y0 + 0.95, Shade, 0.005);
        }
    }
    for (let Slot = 0; Slot < 6; ++Slot)
    {
        const GX = -86.5 - Slot * 4.5;
        const GY = (Slot & 1) ? -32.2 : -38.3;
        Paint(GX - 0.15, GY - 1.5, GX + 0.15, GY + 1.5, CourseMaterial.PaintWhite);
        Paint(GX - 2.6,  GY - 1.5, GX,        GY - 1.3, CourseMaterial.PaintWhite);
        Paint(GX - 2.6,  GY + 1.3, GX,        GY + 1.5, CourseMaterial.PaintWhite);
    }

    // ⑤ [Track A] Direction Chevrons & Infield Stunt Expressway Bullseyes
    for (const X of [-70.0, -56.0, -42.0, 2.0, 80.0, 152.0])
        EmitChevron(X, -35.0, 1.0, 3.6, 1.1, CourseMaterial.PaintYellow);
    for (const X of [158.0, 62.0, -8.0, -84.0])
        EmitChevron(X,  35.0, -1.0, 3.6, 1.1, CourseMaterial.PaintBlue);
    Paint(-88.0, -7.2, 134.0, -6.9, CourseMaterial.PaintBlue);
    Paint(-88.0,  6.9, 134.0,  7.2, CourseMaterial.PaintBlue);
    for (const X of [-74.0, -60.0, 6.0, 82.0, 100.0])
        EmitChevron(X, 0.0, 1.0, 3.0, 0.95, CourseMaterial.PaintGreen);
    EmitRing(-26.0, 0.0, 3.4, 4.0, 40, CourseMaterial.KerbRed);
    EmitRing(-26.0, 0.0, 1.2, 1.6, 28, CourseMaterial.PaintYellow);
    EmitRing( 96.0, 0.0, 4.2, 4.8, 44, CourseMaterial.PaintBlue);

    // ⑥ Inter-Track Connector Boulevards & Underpass Guide Markings (Track A <-> Track B & Track C)
    Paint(-97.5, -104.0, -96.9, 104.0, CourseMaterial.PaintYellow);
    Paint(-82.1, -104.0, -81.5, 104.0, CourseMaterial.PaintYellow);
    for (const Y of [62.0, 74.0])
        EmitChevronY(-89.5, Y, 1.0, 3.2, 1.0, CourseMaterial.PaintGreen);
    for (const Y of [-62.0, -74.0])
        EmitChevronY(-89.5, Y, -1.0, 3.2, 1.0, CourseMaterial.KerbRed);

    // Track B Underpass Boulevard at X = +12 (drives OVER -5.2 m Subway Tunnel & UNDER +5.0 m Sky-Bridge!)
    Paint( 4.6, 56.0,  5.2, 132.0, CourseMaterial.PaintBlue);
    Paint(18.8, 56.0, 19.4, 132.0, CourseMaterial.PaintBlue);
    for (const Y of [64.0, 84.0, 118.0])
        EmitChevronY(12.0, Y, 1.0, 3.0, 1.0, CourseMaterial.PaintYellow);

    // ⑦ [Track B] Split Over/Under Fork Markings + Proximity Trigger #1 Sensor Pad (Linear Bollards)
    for (const X of [-70.0, -56.0])
    {
        EmitChevron(X,  84.0, 1.0, 3.0, 1.0, CourseMaterial.GateLamp);
        EmitChevron(X, 104.0, 1.0, 3.0, 1.0, CourseMaterial.PaintYellow);
    }
    Paint(34.0, 159.0, 52.0, 173.0, CourseMaterial.WallCobalt, 0.003);
    Paint(-32.0, 159.2, 52.0, 159.8, CourseMaterial.GateLamp, 0.005);
    Paint(-32.0, 172.2, 52.0, 172.8, CourseMaterial.GateLamp, 0.005);
    for (const X of [48.0, 38.0])
        EmitChevron(X, 166.0, -1.0, 3.4, 1.0, CourseMaterial.PaintGreen);

    // ⑧ [Track C] Proximity Trigger #2 Sensor Pad (84 m Travelling Wave Bollards) & South Loop Guide
    Paint(-94.0, -101.0, -78.0, -87.0, CourseMaterial.WallCobalt, 0.003);
    Paint(-94.0, -101.4,  10.0, -100.8, CourseMaterial.BannerAmber, 0.005);
    Paint(-94.0,  -87.2,  10.0,  -86.6, CourseMaterial.GateLamp, 0.005);
    for (const X of [-90.0, -80.0])
        EmitChevron(X, -94.0, 1.0, 3.4, 1.0, CourseMaterial.PaintYellow);
    for (const X of [146.0, 130.0])
        EmitChevron(X, -162.0, -1.0, 3.4, 1.0, CourseMaterial.KerbRed);

    // ⑨ [Track D] Seismic Collapse Sky-Bridge (Y = -250) & Collapse Faultline Road (Y = -318) Hazard Livery
    Paint(-94.0, -257.2, -52.0, -256.6, CourseMaterial.BannerAmber, 0.005);
    Paint(-94.0, -243.4, -52.0, -242.8, CourseMaterial.BannerAmber, 0.005);
    for (const X of [-82.0, -64.0])
        EmitChevron(X, -250.0, 1.0, 3.4, 1.0, CourseMaterial.BannerAmber);
    for (const X of [104.0, 92.0, 68.0])
        EmitChevron(X, -318.0, -1.0, 3.4, 1.0, CourseMaterial.KerbRed);

    // ⑩ [Track E] 3-Lane Subway Boulevard: [road][tunnel down][road] -- [road][road][road] -- [road][tunnel up][road]
    //    Outer boundary lines (Y = 238.5 & Y = 273.5) + 3-lane dividers (Y = 248.2 & Y = 263.8)
    Paint(-112.0, 238.4, 132.0, 239.0, CourseMaterial.PaintWhite, 0.005);
    Paint(-112.0, 273.0, 132.0, 273.6, CourseMaterial.PaintWhite, 0.005);
    for (let X = -108.0; X < 128.0; X += 8.0)
    {
        Paint(X, 248.0, X + 4.5, 248.5, CourseMaterial.PaintYellow, 0.005);
        Paint(X, 263.5, X + 4.5, 264.0, CourseMaterial.PaintYellow, 0.005);
    }
    //    Approach & middle -- [road][road][road] -- chevrons across all 3 lanes!
    for (const X of [-92.0, -78.0, 82.0])
    {
        EmitChevron(X, 243.5, 1.0, 2.4, 0.9, CourseMaterial.PaintGreen);
        EmitChevron(X, 256.0, 1.0, 2.8, 1.0, CourseMaterial.GateLamp);
        EmitChevron(X, 268.5, 1.0, 2.4, 0.9, CourseMaterial.PaintGreen);
    }
    for (const X of [-24.0, 0.0, 24.0])
    {
        EmitChevron(X, 243.5, 1.0, 2.4, 0.9, CourseMaterial.PaintGreen);
        EmitChevron(X, 256.0, 1.0, 2.8, 1.0, CourseMaterial.PaintYellow);
        EmitChevron(X, 268.5, 1.0, 2.4, 0.9, CourseMaterial.PaintGreen);
    }

    // ⑪ [Track F] Dedicated Streetcar Tram & Express Rail Transit Boulevard (Y = +308 .. +350)
    Paint(-142.0, 308.2, 206.0, 308.8, CourseMaterial.PaintYellow, 0.005);
    Paint(-142.0, 330.8, 206.0, 331.4, CourseMaterial.PaintYellow, 0.005);
    Paint(-142.0, 335.6, 206.0, 350.4, CourseMaterial.TunnelConcrete, 0.002);

    // ⑫ [Track G · Underground Construction Site] Approach Hazard Markings & Open-Hole Apron Striping (Y = -386 & Y = -418)
    Paint(-136.0, -377.4, 168.0, -376.8, CourseMaterial.PaintYellow, 0.005);
    Paint(-136.0, -395.2, 168.0, -394.6, CourseMaterial.PaintYellow, 0.005);
    Paint(-136.0, -408.8, 168.0, -408.2, CourseMaterial.BannerAmber, 0.005);
    Paint(-136.0, -427.8, 168.0, -427.2, CourseMaterial.BannerAmber, 0.005);
    for (let X = -104.0; X <= -60.0; X += 11.0)
    {
        EmitChevron(X, -386.0, 1.0, 3.0, 1.0, CourseMaterial.BannerAmber);
        EmitChevron(X, -418.0, 1.0, 3.2, 1.0, CourseMaterial.KerbRed);
    }
    for (const X of [64.0, 78.0, 92.0])
        EmitChevron(X, -386.0, 1.0, 3.0, 1.0, CourseMaterial.PaintGreen);

    // ⑫b [Track H · Drive-Through Megafactory & Automatic Fuel + 800V EV Service Plaza] Floor & Stop-Bay Livery!
    //     Polished industrial concrete factory slab (X = +12 .. +124, Y = +380 .. +436) + OSHA safety walkways
    Paint( 12.0, 380.2, 124.0, 435.8, CourseMaterial.ApronConcrete, 0.002);
    Paint( 12.0, 398.4, 124.0, 399.0, CourseMaterial.PaintYellow,   0.005);
    Paint( 12.0, 417.0, 124.0, 417.6, CourseMaterial.PaintYellow,   0.005);
    for (const X of [24.0, 48.0, 72.0, 96.0, 114.0])
        EmitChevron(X, 408.0, 1.0, 2.8, 0.9, CourseMaterial.PaintYellow);

    //     Automatic Octane-100 Fuel Stop Bay (X = -56, Y = +392)
    Paint(-63.8, 387.8, -48.2, 396.2, CourseMaterial.ApronConcrete, 0.002);
    Paint(-63.8, 387.8, -48.2, 388.4, CourseMaterial.KerbRed,       0.005);
    Paint(-63.8, 395.6, -48.2, 396.2, CourseMaterial.BannerAmber,   0.005);
    Paint(-48.8, 387.8, -48.2, 396.2, CourseMaterial.PaintWhite,    0.005);
    EmitChevron(-58.0, 392.0, 1.0, 2.2, 0.8, CourseMaterial.BannerAmber);

    //     Automatic 800V Electric Supercharger Stop Bay (X = -56, Y = +420)
    Paint(-63.8, 415.8, -48.2, 424.2, CourseMaterial.ApronConcrete, 0.002);
    Paint(-63.8, 415.8, -48.2, 416.4, CourseMaterial.PaintGreen,    0.005);
    Paint(-63.8, 423.6, -48.2, 424.2, CourseMaterial.GateLamp,      0.005);
    Paint(-48.8, 415.8, -48.2, 424.2, CourseMaterial.PaintWhite,    0.005);
    EmitChevron(-58.0, 420.0, 1.0, 2.2, 0.8, CourseMaterial.PaintGreen);

    // ⑬ Crisp 3D Vector Sign Lettering & Borders on ALL Overhead Highway Waypoint Gantries & Roadside Signs!
    for (const Gantry of HighwayOverheadGantries)
    {
        const CosY = Math.cos(Gantry.Yaw), SinY = Math.sin(Gantry.Yaw);
        for (const Board of Gantry.Boards)
        {
            const BX = Gantry.X - Board.OffsetY * SinY - 0.105 * CosY;
            const BY = Gantry.CentreY + Board.OffsetY * CosY - 0.105 * SinY;
            EmitSignPanelOverlay(Facets, [BX, BY, 7.35 + 0.5 * Board.Height], Gantry.Yaw,
                                 Board.Width, Board.Height, Board.Border, Board.Text, Board.Line1, Board.Line2);
        }
    }
    for (const Sign of RoadsideSigns)
    {
        const CosY = Math.cos(Sign.Yaw), SinY = Math.sin(Sign.Yaw);
        const FaceCenter = [
            Sign.X - 0.075 * CosY,
            Sign.Y - 0.075 * SinY,
            Sign.Z + 2.25 + 0.5 * Sign.Height
        ];
        const BorderMat = Sign.Shape === "RoadsideBoardGreen" ? CourseMaterial.PaintWhite : CourseMaterial.SteelDark;
        EmitSignPanelOverlay(Facets, FaceCenter, Sign.Yaw, Sign.Width, Sign.Height,
                             BorderMat, Sign.Text, Sign.Line1, Sign.Line2);
    }

    return Facets;
}

//------------------------------------------------------------------------------------------------------------------------
//                                  STADIUM BARRIERS, GANTRIES, CONES & SMASHABLES
//------------------------------------------------------------------------------------------------------------------------

export function ResolveInversionPlacements()
{
    const Degrees = Math.PI / 180.0;
    const List = [...SegmentBundle.Placements];
    const Add = (Shape, Name, Position, Yaw = 0.0, Material = -1, Collider = true) =>
        List.push({ Shape, Name, Position, Yaw, Material, Collider });

    // ① [Track A] Divider Walls at Y = ±55.5 with wide Open-World Connector Gateways into [Track B] and [Track C]
    for (let X = -152.0; X <= 216.0; X += 4.0)
    {
        const NorthGateway = (X >= -104.0 && X <= -76.0) || (X >= 0.0 && X <= 24.0);
        const SouthGateway = (X >= -104.0 && X <= -76.0) || (X >= 64.0 && X <= 92.0);
        if (!NorthGateway)
            Add("Jersey", `TrackA North ${X.toFixed(0)}`, [X,  55.5, 0.0], 0.0);
        if (!SouthGateway)
            Add("Jersey", `TrackA South ${X.toFixed(0)}`, [X, -55.5, 0.0], 0.0);
    }

    // Inner-Wing Divider Walls at Y = ±202.0 with wide 32 m Open-World Gateways into [Track D], [Track E] & [Track F]
    for (let X = -148.0; X <= 216.0; X += 8.0)
    {
        const OuterGateway = (X >= -108.0 && X <= -76.0) || (X >= 148.0 && X <= 180.0);
        if (!OuterGateway)
        {
            Add("LongBarrier", `Wing Divider N ${X.toFixed(0)}`, [X,  202.0, 0.0], 0.0);
            Add("LongBarrier", `Wing Divider S ${X.toFixed(0)}`, [X, -202.0, 0.0], 0.0);
        }
    }

    // Outer Complex Perimeter Walls around the full 8-Track Stadium ([−154..+220] × [−448..+448]) + Wing Dividers into [Track G] & [Track H]
    for (let X = -148.0; X <= 216.0; X += 16.0)
    {
        Add("LongBarrier", `Complex North ${X.toFixed(0)}`, [X,  448.0, 0.0], 0.0);
        Add("LongBarrier", `Complex South ${X.toFixed(0)}`, [X, -448.0, 0.0], 0.0);
        const OuterWingGateway = (X >= -112.0 && X <= -74.0) || (X >= 144.0 && X <= 184.0);
        if (!OuterWingGateway)
        {
            Add("LongBarrier", `Construction Divider ${X.toFixed(0)}`, [X, -360.0, 0.0], 0.0);
            Add("LongBarrier", `Factory Divider ${X.toFixed(0)}`,      [X,  360.0, 0.0], 0.0);
        }
    }
    for (let Y = -440.0; Y <= 440.0; Y += 16.0)
    {
        Add("LongBarrier", `Complex West ${Y.toFixed(0)}`, [-152.5, Y, 0.0], 90.0 * Degrees);
        const EastStudioGateway = (Y >= 50.0 && Y <= 82.0) || (Y >= -82.0 && Y <= -50.0);
        if (!EastStudioGateway)
            Add("LongBarrier", `Complex East ${Y.toFixed(0)}`, [ 220.5, Y, 0.0], 90.0 * Degrees);
    }

    // ② [Track A] Pit-wall divider islands (preserved intact)
    for (let X = -68.0; X <= 136.0; X += 8.0)
    {
        if (Math.abs(X - 4.0) > 12.0 && (X < 52.0 || X > 116.0))
        {
            Add("Jersey", `South Pit Wall ${X.toFixed(0)}`, [X, -21.0, 0.0], 0.0);
            Add("Jersey", `North Pit Wall ${X.toFixed(0)}`, [X,  21.0, 0.0], 0.0);
        }
    }

    // ③ Overhead Grand Prix & Track Wing Timing / Signpost Gantries
    const AddRaceGantry = (Label, X, CentreY, Yaw = 0.0) =>
    {
        const CosY = Math.cos(Yaw), SinY = Math.sin(Yaw);
        Add("RaceGantryPost", `${Label} post L`, [X + 12.2 * SinY, CentreY - 12.2 * CosY, 0.0], Yaw);
        Add("RaceGantryPost", `${Label} post R`, [X - 12.2 * SinY, CentreY + 12.2 * CosY, 0.0], Yaw);
        Add("RaceGantryBeam", `${Label} beam`,   [X, CentreY, 7.2], Yaw, -1, false);
        Add("RaceGantryLamp", `${Label} lamp`,   [X, CentreY, 7.0], Yaw, -1, false);
    };
    AddRaceGantry("Start/Finish Gantry",     -82.0,  -35.0);
    AddRaceGantry("Sector 1 Turn-In",        154.0,  -35.0);
    AddRaceGantry("Sector 2 Return",         158.0,   35.0);
    AddRaceGantry("Sector 3 Split-Wing",      -6.0,   35.0);
    AddRaceGantry("Track B Split Portal",    -56.0,   94.0);
    AddRaceGantry("Track B Linear Trigger",   36.0,  166.0);
    AddRaceGantry("Track C Wave Trigger",    -82.0,  -94.0);
    AddRaceGantry("Track D Collapse Bridge", -54.0, -250.0);
    AddRaceGantry("Track D Collapse Road",    64.0, -318.0);
    AddRaceGantry("Track E 3-Lane Subway",   -72.0,  256.0);
    AddRaceGantry("Track F Tramway Avenue",  -76.0,  319.5);

    // ④ Architectural steel A-frame portals cradling BOTH 18 m 360° Helical Loops (Track A & Track C)
    for (const PortalX of [-26.5, -20.0, -13.5])
    {
        Add("LoopPylon",     `LoopA pylon S ${PortalX}`, [PortalX, -45.8,  0.0], 0.0);
        Add("LoopPylon",     `LoopA pylon N ${PortalX}`, [PortalX, -22.8,  0.0], 0.0);
        Add("LoopCrossBeam", `LoopA beam ${PortalX}`,    [PortalX, -34.3, 18.8], 0.0, -1, false);
        Add("LoopCrownLamp", `LoopA lamp ${PortalX}`,    [PortalX, -34.3, 18.6], 0.0, -1, false);
    }
    for (const PortalX of [101.5, 108.0, 114.5])
    {
        Add("LoopPylon",     `LoopC pylon S ${PortalX}`, [PortalX, -177.8,  0.0], 0.0);
        Add("LoopPylon",     `LoopC pylon N ${PortalX}`, [PortalX, -154.8,  0.0], 0.0);
        Add("LoopCrossBeam", `LoopC beam ${PortalX}`,    [PortalX, -166.3, 18.8], 0.0, -1, false);
        Add("LoopCrownLamp", `LoopC lamp ${PortalX}`,    [PortalX, -166.3, 18.6], 0.0, -1, false);
    }

    // ⑤ Bridge support piers & Underpass Portals (clear of the Underpass & Canyon roadways!)
    Add("SpineDeckPylon", "Tabletop pier",      [114.0,  -29.7, 0.0], 0.0, -1, false);
    Add("SpineDeckPylon", "Heartline pier E",   [130.0,   35.0, 0.0], 0.0, -1, false);
    Add("SpineDeckPylon", "Heartline pier C",   [110.0,   35.0, 0.0], 0.0, -1, false);
    Add("SpineDeckPylon", "Heartline pier W",   [ 90.0,   35.0, 0.0], 0.0, -1, false);
    Add("SpineDeckPylon", "WhaleTail pier",     [ 45.0,    0.0, 0.0], 0.0, -1, false);
    // Track B Sky-Bridge piers flanking the X = +12 Ground Underpass Boulevard (wide 22 m drive-through span!)
    Add("BridgePier",     "SkyBridge pier W",   [ -4.0,  104.0, 0.0], 0.0);
    Add("BridgePier",     "SkyBridge pier E",   [ 28.0,  104.0, 0.0], 0.0);
    // Track C Viaduct Bridge piers flanking the X = +78 Sunken Canyon Underpass (wide 24 m span!)
    Add("BridgePier",     "Viaduct pier W",     [ 62.0,  -94.0, 0.0], 0.0);
    Add("BridgePier",     "Viaduct pier E",     [ 94.0,  -94.0, 0.0], 0.0);

    // Subterranean Tunnel Ceiling LED Light Strips inside Track B's -5.2 m Subway Gallery
    for (let X = -8.0; X <= 28.0; X += 9.0)
    {
        Add("TunnelCeilingLamp", `Subway lamp L ${X}`, [X, 80.5, -0.86], 0.0, -1, false);
        Add("TunnelCeilingLamp", `Subway lamp R ${X}`, [X, 87.5, -0.86], 0.0, -1, false);
    }

    // [Track E] 3-Lane Subway Ceiling LED Light Strips inside the 88 m Underground Subway Station Gallery
    for (let X = -38.0; X <= 38.0; X += 10.0)
    {
        Add("TunnelCeilingLamp", `Subway3L lamp L ${X}`, [X, 252.5, -0.86], 0.0, -1, false);
        Add("TunnelCeilingLamp", `Subway3L lamp R ${X}`, [X, 259.5, -0.86], 0.0, -1, false);
    }

    // [Track F] Dedicated 4-Track Streetcar Tramway & Express Rail Corridor (steel grooved rails, catenary & island platform)
    Add("StationPlatform", "Tram Central Island", [16.0, 319.5, 0.0], 0.0);
    for (let X = -132.0; X <= 198.0; X += 22.0)
    {
        for (const TrackCenterY of [314.0, 325.0, 340.0, 346.5])
        {
            Add("TramRailBar", `Rail S ${TrackCenterY} ${X}`, [X, TrackCenterY - 0.72, 0.02], 0.0, -1, false);
            Add("TramRailBar", `Rail N ${TrackCenterY} ${X}`, [X, TrackCenterY + 0.72, 0.02], 0.0, -1, false);
        }
    }
    for (let X = -120.0; X <= 188.0; X += 28.0)
    {
        Add("CatenaryPole", `Tram catenary pole ${X}`, [X, 319.5, 0.0], 0.0, -1, false);
        Add("CatenaryArm",  `Tram catenary arm ${X}`,  [X, 319.5, 6.2], 0.0, -1, false);
        Add("CatenaryPole", `Train catenary pole ${X}`, [X, 343.25, 0.0], 0.0, -1, false);
        Add("CatenaryArm",  `Train catenary arm ${X}`,  [X, 343.25, 6.4], 0.0, -1, false);
    }

    // Recessed floor sockets under all Linear & Wave Kinetic Bollards
    for (const Zone of ResolveInversionBollards())
    {
        for (let Index = 0; Index < Zone.Posts.length; ++Index)
        {
            const P = Zone.Posts[Index].Position;
            Add("BollardSocket", `${Zone.Id} socket ${Index}`, [P[0], P[1], 0.0], 0.0, -1, false);
        }
    }

    // ⑥ Clustered stadium floodlight poles (<= 14 poles inside cluster grid)
    for (const X of [-72.0, -36.0, 0.0, 36.0, 72.0, 108.0, 144.0])
    {
        const SouthAngle = 90.0 * Degrees;
        Add("Pole",     `South Floodlight ${X}`, [X, -49.5,  0.0], 0.0);
        Add("PoleHead", `South Head ${X}`,       [X, -48.8, 10.8], SouthAngle, -1, false);

        const NorthAngle = -90.0 * Degrees;
        Add("Pole",     `North Floodlight ${X}`, [X,  49.5,  0.0], 0.0);
        Add("PoleHead", `North Head ${X}`,       [X,  48.8, 10.8], NorthAngle, -1, false);
    }

    // ⑦ Grand Prix Paddock Materials Showcase beside the Start Straight
    Add("GardenAluminium", "Aluminium sphere", [-68.0, -17.0, 0.0], 0.0);
    Add("GardenGold",      "Gold sphere",      [-64.5, -17.0, 0.0], 0.0);
    Add("GardenGlass",     "Glass sphere",     [-61.0, -17.0, 0.0], 0.0);
    Add("GardenMirror",    "Standing mirror",  [-57.0, -17.5, 0.0], 0.0);

    // ⑧ Highway Overhead Waypoint Gantries ("500 KM TO AIRPORT", "500 M TO X CITY", "CONSTRUCTION AHEAD") & Roadside Signs
    for (const Gantry of HighwayOverheadGantries)
    {
        const CosY = Math.cos(Gantry.Yaw), SinY = Math.sin(Gantry.Yaw);
        const SpanHalf = Gantry.SpanHalf ?? 13.0;
        Add("WaypointGantryLeg",  `${Gantry.Label} leg L`, [Gantry.X - SpanHalf * SinY, Gantry.CentreY + SpanHalf * CosY, 0.0], Gantry.Yaw);
        Add("WaypointGantryLeg",  `${Gantry.Label} leg R`, [Gantry.X + SpanHalf * SinY, Gantry.CentreY - SpanHalf * CosY, 0.0], Gantry.Yaw);
        Add("WaypointGantryBeam", `${Gantry.Label} truss`, [Gantry.X, Gantry.CentreY, 7.20], Gantry.Yaw, -1, false);
        if (SpanHalf > 15.0)
        {
            Add("WaypointGantryBeam", `${Gantry.Label} truss L`, [Gantry.X - 9.0 * SinY, Gantry.CentreY + 9.0 * CosY, 7.20], Gantry.Yaw, -1, false);
            Add("WaypointGantryBeam", `${Gantry.Label} truss R`, [Gantry.X + 9.0 * SinY, Gantry.CentreY - 9.0 * CosY, 7.20], Gantry.Yaw, -1, false);
        }
        for (let BIdx = 0; BIdx < Gantry.Boards.length; ++BIdx)
        {
            const Board = Gantry.Boards[BIdx];
            const BX = Gantry.X - Board.OffsetY * SinY;
            const BY = Gantry.CentreY + Board.OffsetY * CosY;
            Add(Board.Shape, `${Gantry.Label} board ${BIdx}`, [BX, BY, 7.35], Gantry.Yaw, -1, false);
        }
    }
    for (const Sign of RoadsideSigns)
    {
        Add("RoadsideSignPost", `${Sign.Name} post`,  [Sign.X, Sign.Y, Sign.Z],        Sign.Yaw, -1, false);
        Add(Sign.Shape,         `${Sign.Name} board`, [Sign.X, Sign.Y, Sign.Z + 2.25], Sign.Yaw, -1, false);
    }

    // ⑨ [Track G · Underground Construction Site] Barricades, Shoring Struts & Glowing Amber Construction Lights!
    for (const X of [-96.0, -76.0, -60.0])
    {
        Add("ConstructionAFrame", `Const AFrame N ${X}`, [X, -376.2, 0.0], 0.0);
        Add("ConstructionAFrame", `Const AFrame M ${X}`, [X, -402.0, 0.0], 0.0);
        Add("ConstructionAFrame", `Const AFrame S ${X}`, [X, -428.8, 0.0], 0.0);
    }
    // Portable 4.6 m Construction Floodlight Towers before going down AND down inside the -5.2 m pits!
    Add("WorkLightTower", "Const Tower Approach N", [-88.0, -374.5,  0.0],  0.0,           -1, false);
    Add("WorkLightTower", "Const Tower Approach C", [-68.0, -402.0,  0.0],  0.0,           -1, false);
    Add("WorkLightTower", "Const Tower Approach S", [-88.0, -430.5,  0.0],  0.0,           -1, false);
    Add("WorkLightTower", "Const Tower Trench Mid", [  0.0, -391.2, -5.20], 90.0 * Degrees,-1, false);
    Add("WorkLightTower", "Const Tower Pit End L",  [ 26.0, -412.2, -5.20],  0.0,          -1, false);
    Add("WorkLightTower", "Const Tower Pit End R",  [ 26.0, -423.8, -5.20],  0.0,          -1, false);
    // Glowing Amber Trench-Rim Warning Beacon Posts flanking the approach & boolean holes
    for (const X of [-92.0, -72.0, -56.0, -28.0, 0.0, 28.0])
    {
        Add("AmberBeaconPost", `Trench Beacon NL ${X}`, [X, -378.2, 0.0], 0.0, -1, false);
        Add("AmberBeaconPost", `Trench Beacon NR ${X}`, [X, -393.8, 0.0], 0.0, -1, false);
        Add("AmberBeaconPost", `Pit Beacon SL ${X}`,    [X, -409.2, 0.0], 0.0, -1, false);
        Add("AmberBeaconPost", `Pit Beacon SR ${X}`,    [X, -426.8, 0.0], 0.0, -1, false);
    }
    // Heavy Steel Shoring Struts spanning overhead across the Open Construction Trench & Dead-End Pit!
    for (const X of [-24.0, -4.0, 16.0])
    {
        Add("TrenchShoringStrut", `ThruTrench Strut ${X}`, [X, -386.0, -0.32], 0.0, -1, false);
        Add("TrenchShoringStrut", `DeadEndPit Strut ${X}`, [X, -418.0, -0.32], 0.0, -1, false);
    }

    // ⑩ Corrugated Steel W-Beam Highway Railguards along Portals, Construction Approaches, Subway Ramps & Bridges!
    const AddGuardrailRun = (Label, StartX, EndX, Y, FaceSign = 1.0) =>
    {
        const Yaw = FaceSign >= 0.0 ? 0.0 : Math.PI;
        Add("GuardrailTerminal", `${Label} term W`, [StartX - 2.4, Y, 0.0], Yaw);
        for (let X = StartX; X <= EndX + 0.01; X += 4.0)
            Add("GuardrailSection", `${Label} ${X.toFixed(0)}`, [X, Y, 0.0], Yaw);
        Add("GuardrailTerminal", `${Label} term E`, [EndX + 2.4, Y, 0.0], Yaw);
    };
    // Construction Site approach & trench-rim W-beam highway railguards
    AddGuardrailRun("ConstGuard NL", -92.0,  56.0, -377.6, -1.0);
    AddGuardrailRun("ConstGuard NR", -92.0,  56.0, -394.4,  1.0);
    AddGuardrailRun("ConstGuard SL", -92.0,  32.0, -408.8, -1.0);
    AddGuardrailRun("ConstGuard SR", -92.0,  32.0, -427.2,  1.0);
    // 3-Lane Subway outer-road portal divider railguards (protecting [road][tunnel down][road] & [road][tunnel up][road]!)
    AddGuardrailRun("Subway3L Guard SW", -84.0, -48.0, 248.2, -1.0);
    AddGuardrailRun("Subway3L Guard NW", -84.0, -48.0, 263.8,  1.0);
    AddGuardrailRun("Subway3L Guard SE",  48.0,  84.0, 248.2, -1.0);
    AddGuardrailRun("Subway3L Guard NE",  48.0,  84.0, 263.8,  1.0);
    // Track A & Track D highway shoulder railguards
    AddGuardrailRun("TrackA Guard S",   -64.0, -36.0, -47.2,  1.0);
    AddGuardrailRun("Bridge Guard L",   -72.0, -56.0, -242.2, -1.0);
    AddGuardrailRun("Bridge Guard R",   -72.0, -56.0, -257.8,  1.0);
    AddGuardrailRun("Sinkhole Guard L",  60.0,  76.0, -310.0, -1.0);
    AddGuardrailRun("Sinkhole Guard R",  60.0,  76.0, -326.0,  1.0);

    // ⑪ [Track H] Automatic Octane-100 Fuel Station & Automatic 800V Electric Charging Station!
    //   Fuel Station Canopy & Twin Pumps (Bay center: X = -56, Y = +392; Island along Y = +398.2)
    Add("StationCanopyPillar", "AutoFuel Pillar W", [-62.5, 398.2, 0.0],  0.0);
    Add("StationCanopyPillar", "AutoFuel Pillar E", [-49.5, 398.2, 0.0],  0.0);
    Add("StationCanopyFuel",   "AutoFuel Canopy",   [-56.0, 393.5, 5.40], 0.0, -1, false);
    Add("StationCanopyLamp",   "AutoFuel Lamp",     [-56.0, 393.5, 5.28], 0.0, -1, false);
    Add("FuelDispenserPump",   "AutoFuel Pump W",   [-57.8, 398.2, 0.0],  0.0);
    Add("FuelDispenserPump",   "AutoFuel Pump E",   [-54.2, 398.2, 0.0],  0.0);
    Add("FactoryTankSilo",     "Fuel Storage Tank", [-71.5, 399.5, 0.0],  0.0);

    //   800V Electric Supercharger Canopy & Twin Pods (Bay center: X = -56, Y = +420; Island along Y = +426.2)
    Add("StationCanopyPillar", "AutoEV Pillar W",   [-62.5, 426.2, 0.0],  0.0);
    Add("StationCanopyPillar", "AutoEV Pillar E",   [-49.5, 426.2, 0.0],  0.0);
    Add("StationCanopyEV",     "AutoEV Canopy",     [-56.0, 421.5, 5.40], 0.0, -1, false);
    Add("StationCanopyLamp",   "AutoEV Lamp",       [-56.0, 421.5, 5.28], 0.0, -1, false);
    Add("ElectricChargerPod",  "AutoEV Pod W",      [-57.8, 426.2, 0.0],  0.0);
    Add("ElectricChargerPod",  "AutoEV Pod E",      [-54.2, 426.2, 0.0],  0.0);

    // ⑫ [Track H] Drive-Through Industrial Automotive Megafactory Hall (X = +12 .. +124, Y = +380 .. +436) + Interior Props!
    //   Exterior Perimeter Curtain Walls, Steel I-Columns, Open West/East Drive-Through Portals (Y = 398 .. 418) & Roof!
    for (let Bay = 0; Bay < 8; ++Bay)
    {
        const BX = 19.0 + Bay * 14.0;
        Add("FactoryWallPanel", `Factory Wall S ${Bay}`, [BX, 380.4, 0.0], 0.0);
        Add("FactoryWallPanel", `Factory Wall N ${Bay}`, [BX, 435.6, 0.0], 0.0);
        Add("FactoryColumn",    `Factory Col S ${Bay}`,  [BX - 6.8, 381.2, 0.0], 0.0);
        Add("FactoryColumn",    `Factory Col N ${Bay}`,  [BX - 6.8, 434.8, 0.0], 0.0);
    }
    Add("FactoryColumn", "Factory Col SE", [124.0, 381.2, 0.0], 0.0);
    Add("FactoryColumn", "Factory Col NE", [124.0, 434.8, 0.0], 0.0);

    //   West (X = +12) & East (X = +124) Portal Facades with 20 m wide Open Drive-Through Doors!
    for (const [Label, FX] of [["West", 12.0], ["East", 124.0]])
    {
        Add("FactoryEndWall",    `Factory ${Label} Facade S`, [FX, 389.2, 0.0],  0.0);
        Add("FactoryEndWall",    `Factory ${Label} Facade N`, [FX, 426.8, 0.0],  0.0);
        Add("FactoryColumn",     `Factory ${Label} Jamb S`,   [FX, 398.2, 0.0],  0.0);
        Add("FactoryColumn",     `Factory ${Label} Jamb N`,   [FX, 417.8, 0.0],  0.0);
        Add("FactoryDoorHeader", `Factory ${Label} Header`,   [FX, 408.0, 7.20], 0.0, -1, false);
    }
    //   Spanning Factory Roof Decks + High-Bay LED Strip Lighting + Twin Rooftop Smokestacks!
    for (let Span = 0; Span < 6; ++Span)
    {
        const RX = 21.3 + Span * 18.68;
        Add("FactoryRoofSlab",    `Factory Roof ${Span}`,   [RX, 408.0, 10.60], 0.0, -1, false);
        Add("FactoryHighBayLamp", `Factory Lamp S ${Span}`, [RX, 396.0, 10.42], 0.0, -1, false);
        Add("FactoryHighBayLamp", `Factory Lamp C ${Span}`, [RX, 408.0, 10.42], 0.0, -1, false);
        Add("FactoryHighBayLamp", `Factory Lamp N ${Span}`, [RX, 420.0, 10.42], 0.0, -1, false);
    }
    Add("FactoryChimney", "Factory Smokestack W", [ 96.0, 431.0, 11.20], 0.0, -1, false);
    Add("FactoryChimney", "Factory Smokestack E", [112.0, 431.0, 11.20], 0.0, -1, false);

    //   INTERIOR FACTORY PROPS: Hydraulic Stamping Presses, Automated Conveyors, Multi-Tier Storage Racks & Silos!
    Add("FactoryStampingPress", "Factory Press N1",     [ 30.0, 423.5, 0.0], 0.0);
    Add("FactoryStampingPress", "Factory Press N2",     [ 52.0, 423.5, 0.0], 0.0);
    Add("FactoryStampingPress", "Factory Press S1",     [ 30.0, 392.5, 0.0], 0.0);
    Add("FactoryStampingPress", "Factory Press S2",     [ 52.0, 392.5, 0.0], 0.0);
    Add("FactoryConveyorLine",  "Factory Conveyor N1",  [ 76.0, 421.5, 0.0], 0.0);
    Add("FactoryConveyorLine",  "Factory Conveyor N2",  [ 98.0, 421.5, 0.0], 0.0);
    Add("FactoryConveyorLine",  "Factory Conveyor S1",  [ 76.0, 394.5, 0.0], 0.0);
    Add("FactoryConveyorLine",  "Factory Conveyor S2",  [ 98.0, 394.5, 0.0], 0.0);
    for (const RX of [26.0, 66.0, 104.0])
    {
        Add("FactoryStorageRack", `Factory Rack N ${RX}`, [RX, 432.2, 0.0], 0.0);
        Add("FactoryStorageRack", `Factory Rack S ${RX}`, [RX, 383.8, 0.0], 0.0);
    }
    Add("FactoryTankSilo", "Factory Silo NE", [115.5, 426.5, 0.0], 0.0);
    Add("FactoryTankSilo", "Factory Silo SE", [115.5, 389.5, 0.0], 0.0);

    return List;
}

export function ResolveInversionCones()
{
    const List = [];
    const Push = (X, Y, Group, Shape = "Cone", Z = 0.0) =>
        List.push({ Shape, Name: `${Shape} ${List.length + 1}`, Position: [X, Y, Z], Yaw: 0.0, Group });

    // ① [Track A] Original Grand Prix Slalom, Loop, Pipe & Spine Cones (preserved intact)
    for (let X = -76.0; X <= -36.0; X += 10.0)
    {
        Push(X, -43.8, "loop", "Cone");
        Push(X, -32.8, "loop", "Cone");
    }
    for (let Deg = -60; Deg <= 60; Deg += 30)
    {
        const Rad = (Deg * Math.PI) / 180.0;
        Push(164.0 + 23.2 * Math.cos(Rad), 23.2 * Math.sin(Rad), "circuit", "Cone");
        Push(-96.0 - 23.2 * Math.cos(Rad), 23.2 * Math.sin(Rad), "circuit", "Cone");
    }
    for (const X of [64.0, 58.0])
    {
        Push(X, 28.8, "pipe", "SlimPylonCone");
        Push(X, 41.2, "pipe", "SlimPylonCone");
    }
    for (const X of [-66.0, -54.0])
    {
        Push(X, -6.4, "spine", "ShortWorkCone");
        Push(X,  6.4, "spine", "ShortWorkCone");
    }

    // ② [Track G · Construction Site] Channelizer Tapers (Drums, Slim Pylons, Stubby Work Cones & Classic Cones)
    const WorkShapes = ["ConstructionDrum", "Cone", "SlimPylonCone", "ShortWorkCone"];
    for (let Step = 0; Step < 6; ++Step)
    {
        const X = -102.0 + Step * 8.0;
        const S = WorkShapes[Step % WorkShapes.length];
        Push(X, -379.6, "construction", S, 0.0);
        Push(X, -392.4, "construction", S, 0.0);
        Push(X, -411.2, "construction", WorkShapes[(Step + 1) % 4], 0.0);
        Push(X, -424.8, "construction", WorkShapes[(Step + 2) % 4], 0.0);
    }
    // Knockable drums & cones down INSIDE the -5.20 m Underground Through-Trench & Dead-End Pit!
    Push(-12.0, -382.2, "construction", "ConstructionDrum", -5.20);
    Push( 12.0, -389.8, "construction", "ShortWorkCone",    -5.20);
    Push( -6.0, -413.5, "construction", "ConstructionDrum", -5.20);
    Push( 18.0, -422.5, "construction", "ConstructionDrum", -5.20);
    Push( 27.5, -416.0, "construction", "Cone",             -5.20);
    Push( 27.5, -420.0, "construction", "SlimPylonCone",    -5.20);

    // ③ Scattered Solitary "Lone Cones" of all 4 types across shoulders, portals, bridges, trams & underground!
    const LoneCones = [
        [ -18.0,  -46.8, 0.0,   "Cone"],
        [  32.0,  -22.8, 0.0,   "ConstructionDrum"],
        [  98.0,  -46.5, 0.0,   "SlimPylonCone"],
        [ 128.0,   22.8, 0.0,   "ShortWorkCone"],
        [ -34.0,   46.8, 0.0,   "Cone"],
        [  18.0,    9.8, 0.0,   "SlimPylonCone"],
        [ -62.0,   76.2, 0.0,   "ConstructionDrum"],
        [  62.0,  111.5, 0.0,   "Cone"],
        [   4.0,  173.8, 0.0,   "ShortWorkCone"],
        [ -92.0,  -86.5, 0.0,   "SlimPylonCone"],
        [  14.0, -101.5, 0.0,   "ConstructionDrum"],
        [  71.2,  -52.0, 0.0,   "Cone"],
        [  48.0, -158.0, 0.0,   "ShortWorkCone"],
        [ -64.0, -258.5, 0.0,   "ConstructionDrum"],
        [ 122.0, -243.0, 0.0,   "Cone"],
        [  68.0, -326.5, 0.0,   "SlimPylonCone"],
        [ -68.0, -310.5, 0.0,   "ShortWorkCone"],
        [ -96.0,  241.5, 0.0,   "Cone"],
        [  -2.0,  270.8, 0.0,   "ConstructionDrum"],
        [  86.0,  269.2, 0.0,   "SlimPylonCone"],
        [ -48.0,  309.5, 0.0,   "ShortWorkCone"],
        [  58.0,  330.2, 0.0,   "Cone"],
        [  72.0, -392.0, 0.0,   "SlimPylonCone"],
        [   6.0, -418.0, -5.20, "Cone"],
        // Track H — Factory Floor Safety Cones/Drums & Auto-Fuel / Auto-EV Bay Guide Pylons
        [ -64.4,  388.2, 0.0,   "ShortWorkCone"],
        [ -47.6,  388.2, 0.0,   "ShortWorkCone"],
        [ -64.4,  416.2, 0.0,   "SlimPylonCone"],
        [ -47.6,  416.2, 0.0,   "SlimPylonCone"],
        [  20.0,  399.5, 0.0,   "ConstructionDrum"],
        [  20.0,  416.5, 0.0,   "ConstructionDrum"],
        [  58.0,  416.5, 0.0,   "ShortWorkCone"],
        [  94.0,  399.5, 0.0,   "SlimPylonCone"]
    ];
    for (const [LX, LY, LZ, LShape] of LoneCones)
        Push(LX, LY, "lone", LShape, LZ);

    return List;
}

export function ResolveInversionBreakables()
{
    const List = [];
    const Add = (Name, Shape, Material, X, Y, Yaw = 0.0, Options = {}) =>
    {
        const BaseZ = Options.Z ?? 0.0;
        const Approach = {
            Position: [X - 18.0 * Math.cos(Yaw), Y - 18.0 * Math.sin(Yaw)],
            Yaw:      Yaw * 180.0 / Math.PI
        };
        List.push({
            Name, Shape, Material,
            Position:      [X, Y, BaseZ],
            Yaw,
            Approach,
            Capacity:      Options.Capacity || 40,
            Ceiling:       Options.Ceiling || 28,
            StrengthScale: Options.StrengthScale || 1.0,
            DensityScale:  Options.DensityScale || 1.0
        });
    };

    const Pane     = { Kind: "box", Extent: [0.10, 3.20, 2.50] };
    const Tempered = { Kind: "box", Extent: [0.10, 3.20, 2.50] };
    const Crate    = { Kind: "box", Extent: [1.10, 1.10, 1.10] };
    const Barrier  = { Kind: "box", Extent: [0.55, 2.20, 0.95] };

    Add("Tabletop Victory Glass", Pane,     "glass",     148.0, -29.7, Math.PI * 0.5, { Capacity: 44, StrengthScale: 0.65 });
    Add("Pipe Exit Glass Gate",   Tempered, "tempered",   -5.0,  35.0, Math.PI * 0.5, { Capacity: 44, StrengthScale: 0.65 });
    Add("Spine Landing Pane",     Pane,     "glass",       6.0,   0.0, Math.PI * 0.5, { Capacity: 44, StrengthScale: 0.65 });
    Add("Subway Exit Glass",      Pane,     "glass",      70.0,  84.0, Math.PI * 0.5, { Capacity: 44, StrengthScale: 0.65 });
    Add("Viaduct Landing Glass",  Tempered, "tempered",  136.0, -94.0, Math.PI * 0.5, { Capacity: 44, StrengthScale: 0.65 });
    Add("Infield Chicane A",      Barrier,  "plastic",    86.0,  -2.2, Math.PI * 0.5, { Capacity: 24 });
    Add("Infield Chicane B",      Barrier,  "plastic",    86.0,   2.2, Math.PI * 0.5, { Capacity: 24 });
    Add("Paddock Crate 1",        Crate,    "wood",       -4.0, -12.0,  0.20,         { DensityScale: 0.32, Capacity: 28 });
    Add("Paddock Crate 2",        Crate,    "wood",       -4.0,  12.0, -0.20,         { DensityScale: 0.32, Capacity: 28 });
    // Smashable construction crates down inside the -5.20 m Underground Dead-End Pit!
    Add("Dead-End Pit Crate 1",   Crate,    "wood",       22.0, -415.5, 0.15,         { Z: -5.20, DensityScale: 0.32, Capacity: 24 });
    Add("Dead-End Pit Crate 2",   Crate,    "wood",       22.0, -420.5,-0.18,         { Z: -5.20, DensityScale: 0.32, Capacity: 24 });
    // Smashable interior Factory Parts Crates & QA Inspection Glass Panes INSIDE the Megafactory Hall!
    Add("Factory Parts Crate 1",  Crate,    "wood",       41.0,  415.5, 0.12,         { DensityScale: 0.32, Capacity: 24 });
    Add("Factory Parts Crate 2",  Crate,    "wood",       64.0,  400.5,-0.16,         { DensityScale: 0.32, Capacity: 24 });
    Add("Factory Parts Crate 3",  Crate,    "wood",       88.0,  415.5, 0.22,         { DensityScale: 0.32, Capacity: 24 });
    Add("Factory QA Glass Gate",  Tempered, "tempered",   68.0,  413.2, 0.0,          { Capacity: 36, StrengthScale: 0.60 });

    return List;
}

//------------------------------------------------------------------------------------------------------------------------
//                      SEISMIC COLLAPSING BRIDGE & COLLAPSING ROAD DESCRIPTORS
//------------------------------------------------------------------------------------------------------------------------

export function ResolveInversionCollapseSpans()
{
    const BridgeSurface = InversionArenaSurfaces.find((S) => S.Key === "CollapseSkyBridge");
    const RoadSurface   = InversionArenaSurfaces.find((S) => S.Key === "CollapseSinkholeRoad");
    return [
        {
            Id:          "collapseBridge",
            Name:        "Track D Collapsing Sky-Bridge",
            ShortName:   "Collapsing Bridge",
            Kind:        "bridge",
            Surface:     BridgeSurface,
            StartWorld:  [BridgeSurface.Origin[0] + BridgeSurface.UpLength * BridgeSurface.CosineYaw,
                          BridgeSurface.Origin[1] + BridgeSurface.UpLength * BridgeSurface.SineYaw, 0.0],
            Yaw:         0.0,
            CosineYaw:   1.0,
            SineYaw:     0.0,
            SpanLength:  112.0,
            DeckZ:       5.00,
            ChasmDepth:  5.00,
            CrackSpeed:  26.5,
            DropSpeed:   15.5,
            LeadDelay:   0.55,
            ProxyOffset: 0
        },
        {
            Id:          "collapseRoad",
            Name:        "Track D Collapsing Sinkhole Road",
            ShortName:   "Collapsing Road",
            Kind:        "road",
            Surface:     RoadSurface,
            StartWorld:  [56.0, -318.0, 0.0],
            Yaw:         Math.PI,
            CosineYaw:   -1.0,
            SineYaw:     0.0,
            SpanLength:  112.0,
            DeckZ:       0.0,
            ChasmDepth:  5.20,
            CrackSpeed:  26.5,
            DropSpeed:   15.5,
            LeadDelay:   0.55,
            ProxyOffset: BridgeSurface.BayCount
        }
    ];
}

//------------------------------------------------------------------------------------------------------------------------
//                     SEPARATE ARTICULATED TRAM & EXPRESS TRAIN TRAFFIC DESCRIPTORS
//------------------------------------------------------------------------------------------------------------------------

export function ResolveInversionTrams()
{
    return [
        // ① Eastbound Streetcar Line (Y = +314.0): 2 coupled two-car articulated yellow city trams stopping at Central Island
        {
            Id:              "tramEast1",
            Name:            "Streetcar Tram E-101",
            Kind:            "tram",
            Shape:           "TramCarBody",
            CarCount:        2,
            CarLength:       11.2,
            CarWidth:        2.65,
            CarHeight:       3.30,
            CarSpacing:      11.8,
            StartX:          -136.0,
            EndX:             204.0,
            LaneY:            314.0,
            BaseZ:            0.0,
            Direction:        1.0,
            CruiseSpeed:      12.5,
            StationX:         22.0,
            StationDwell:     2.2,
            InitialProgress:  28.0
        },
        {
            Id:              "tramEast2",
            Name:            "Streetcar Tram E-102",
            Kind:            "tram",
            Shape:           "TramCarBody",
            CarCount:        2,
            CarLength:       11.2,
            CarWidth:        2.65,
            CarHeight:       3.30,
            CarSpacing:      11.8,
            StartX:          -136.0,
            EndX:             204.0,
            LaneY:            314.0,
            BaseZ:            0.0,
            Direction:        1.0,
            CruiseSpeed:      12.5,
            StationX:         22.0,
            StationDwell:     2.2,
            InitialProgress:  198.0
        },
        // ② Westbound Streetcar Line (Y = +325.0): 2 coupled two-car articulated yellow city trams
        {
            Id:              "tramWest1",
            Name:            "Streetcar Tram W-201",
            Kind:            "tram",
            Shape:           "TramCarBody",
            CarCount:        2,
            CarLength:       11.2,
            CarWidth:        2.65,
            CarHeight:       3.30,
            CarSpacing:      11.8,
            StartX:           204.0,
            EndX:            -136.0,
            LaneY:            325.0,
            BaseZ:            0.0,
            Direction:       -1.0,
            CruiseSpeed:      12.5,
            StationX:         10.0,
            StationDwell:     2.2,
            InitialProgress:  62.0
        },
        {
            Id:              "tramWest2",
            Name:            "Streetcar Tram W-202",
            Kind:            "tram",
            Shape:           "TramCarBody",
            CarCount:        2,
            CarLength:       11.2,
            CarWidth:        2.65,
            CarHeight:       3.30,
            CarSpacing:      11.8,
            StartX:           204.0,
            EndX:            -136.0,
            LaneY:            325.0,
            BaseZ:            0.0,
            Direction:       -1.0,
            CruiseSpeed:      12.5,
            StationX:         10.0,
            StationDwell:     2.2,
            InitialProgress:  232.0
        },
        // ③ Express Commuter / Subway Rail Corridor (Y = +340.0 Eastbound & Y = +346.5 Westbound): 3-car heavy rail trains
        {
            Id:              "trainExpressEast",
            Name:            "Express Train R-401",
            Kind:            "train",
            Shape:           "TrainCoachBody",
            CarCount:        3,
            CarLength:       13.6,
            CarWidth:        2.92,
            CarHeight:       3.52,
            CarSpacing:      14.2,
            StartX:          -138.0,
            EndX:             206.0,
            LaneY:            340.0,
            BaseZ:            0.0,
            Direction:        1.0,
            CruiseSpeed:      21.5,
            StationX:         null,
            InitialProgress:  84.0
        },
        {
            Id:              "trainExpressWest",
            Name:            "Express Train R-402",
            Kind:            "train",
            Shape:           "TrainCoachBody",
            CarCount:        3,
            CarLength:       13.6,
            CarWidth:        2.92,
            CarHeight:       3.52,
            CarSpacing:      14.2,
            StartX:           206.0,
            EndX:            -138.0,
            LaneY:            346.5,
            BaseZ:            0.0,
            Direction:       -1.0,
            CruiseSpeed:      21.5,
            StationX:         null,
            InitialProgress:  156.0
        }
    ];
}

//------------------------------------------------------------------------------------------------------------------------
//------------------------------------------------------------------------------------------------------------------------
//      MULTI-AXIS INDUSTRIAL ROBOT ARMS: AUTO-FUEL, 800V EV & MEGAFACTORY WELDING CELLS
//------------------------------------------------------------------------------------------------------------------------

export function ResolveInversionServiceStations()
{
    return [
        {
            Id:            "autoFuelStation",
            Name:          "Auto-Fuel Octane-100 Station",
            Kind:          "fuel",
            BayCenter:     [-56.0, 392.0, 0.0],
            BayHalfExtent: [  7.8,   4.4],
            BasePosition:  [-56.8, 395.35, 0.0],
            BaseYaw:       -0.5 * Math.PI
        },
        {
            Id:            "autoElectricStation",
            Name:          "Auto-EV 800V Supercharger",
            Kind:          "electric",
            BayCenter:     [-56.0, 420.0, 0.0],
            BayHalfExtent: [  7.8,   4.4],
            BasePosition:  [-56.8, 423.35, 0.0],
            BaseYaw:       -0.5 * Math.PI
        }
    ];
}

export function ResolveInversionFactoryRobots()
{
    return [
        // North Assembly Line Industrial Spot-Welding Robots (tending Factory Conveyor N1 at [76, 421.5] & N2 at [98, 421.5])
        {
            Id:            "factoryRobotN1",
            Name:          "Factory Welding Robot N-01",
            BasePosition:  [75.5, 418.5, 0.0],
            BaseYaw:       0.5 * Math.PI,
            PhaseOffset:   0.0,
            CycleDuration: 4.8,
            WeldTargets:   [
                [74.0, 421.3, 1.80],
                [76.0, 421.5, 1.82],
                [77.8, 421.3, 2.02]
            ]
        },
        {
            Id:            "factoryRobotN2",
            Name:          "Factory Welding Robot N-02",
            BasePosition:  [97.5, 418.5, 0.0],
            BaseYaw:       0.5 * Math.PI,
            PhaseOffset:   1.35,
            CycleDuration: 4.5,
            WeldTargets:   [
                [96.0, 421.3, 1.80],
                [98.0, 421.5, 1.82],
                [99.8, 421.3, 2.02]
            ]
        },
        // South Assembly Line Industrial Spot-Welding Robots (tending Factory Conveyor S1 at [76, 394.5] & S2 at [98, 394.5])
        {
            Id:            "factoryRobotS1",
            Name:          "Factory Welding Robot S-01",
            BasePosition:  [75.5, 397.5, 0.0],
            BaseYaw:      -0.5 * Math.PI,
            PhaseOffset:   2.40,
            CycleDuration: 5.0,
            WeldTargets:   [
                [74.0, 394.7, 1.80],
                [76.0, 394.5, 1.82],
                [77.8, 394.7, 2.02]
            ]
        },
        {
            Id:            "factoryRobotS2",
            Name:          "Factory Welding Robot S-02",
            BasePosition:  [97.5, 397.5, 0.0],
            BaseYaw:      -0.5 * Math.PI,
            PhaseOffset:   3.65,
            CycleDuration: 4.6,
            WeldTargets:   [
                [96.0, 394.7, 1.80],
                [98.0, 394.5, 1.82],
                [99.8, 394.7, 2.02]
            ]
        }
    ];
}

//------------------------------------------------------------------------------------------------------------------------
//      POLE-LESS HOVERING ROBOTIC INTERSECTION TRAFFIC LIGHTS (RED / ORANGE / YELLOW / GREEN)
//------------------------------------------------------------------------------------------------------------------------

export function ResolveInversionTrafficLights()
{
    return [
        // Stationed in midair right over major road intersections (no ground pole, hovers in place — never chases player!)
        { Id: "tl_start_cross",   Name: "Start Grid & Paddock Signal",     Anchor: [-76.0,  -36.0, 4.45], Yaw: 0.0,           PhaseOffset:  0.0 },
        { Id: "tl_north_gate",    Name: "North Gateway Intersection",      Anchor: [ 12.0,   55.5, 4.45], Yaw: 0.5 * Math.PI, PhaseOffset:  4.2 },
        { Id: "tl_south_gate",    Name: "South Canyon Crossroads",         Anchor: [ 78.0,  -55.5, 4.45], Yaw: 0.5 * Math.PI, PhaseOffset:  8.4 },
        { Id: "tl_west_avenue",   Name: "West Grand Avenue Junction",      Anchor: [-90.0,  202.0, 4.45], Yaw: 0.5 * Math.PI, PhaseOffset: 12.6 },
        { Id: "tl_tram_xing",     Name: "Track F Tramway Crossing Signal", Anchor: [-78.0,  314.0, 4.55], Yaw: 0.0,           PhaseOffset:  2.5 },
        { Id: "tl_const_gate",    Name: "Track G Construction Crossroads", Anchor: [-90.0, -360.0, 4.45], Yaw: 0.5 * Math.PI, PhaseOffset:  6.8 },
        { Id: "tl_factory_plaza", Name: "Track H Factory & Service Signal",Anchor: [-36.0,  408.0, 4.45], Yaw: 0.0,           PhaseOffset: 10.5 },
        { Id: "tl_east_avenue",   Name: "East Grand Avenue Crossroads",    Anchor: [164.0,  360.0, 4.45], Yaw: 0.5 * Math.PI, PhaseOffset: 14.2 }
    ];
}
