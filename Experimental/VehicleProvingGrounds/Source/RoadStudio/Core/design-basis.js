/** Pure metric reference constants: no model imports or runtime cycles. */
export const designSources = [
    {
        id: "fhwa",
        name: "FHWA interchange design prompt-list",
        url: "https://highways.dot.gov/field-offices/missouri/interchange-design-promptlist",
        sections: "Configurations; ramp design; spacing",
    },
    {
        id: "modot",
        name: "MoDOT diamond interchange alignment controls",
        url: "https://epg.modot.org/files/2/2a/234.2_Figure_1_Diamond_Interchange_Alignment_Controls.pdf",
        sections: "Ramp terminals; 300 ft taper; 400 ft entrance tangent",
    },
    {
        id: "caltrans",
        name: "Caltrans Highway Design Manual, Chapter 500",
        url: "https://dot.ca.gov/-/media/dot-media/programs/design/documents/chp0500-092923-a11y.pdf",
        sections: "Figures 502.2 / 502.3; 504.2; Table 504.3",
    },
    {
        id: "bridge-handbook",
        name: "FHWA Steel Bridge Design Handbook",
        url: "https://rosap.ntl.bts.gov/view/dot/49745/dot_49745_DS1.pdf",
        sections: "Girder arrangement, spacing, overhang and span proportions",
    },
    {
        id: "massdot",
        name: "MassDOT interchange design guide",
        url: "https://www.mass.gov/info-details/pddg-chapter-7-interchanges",
        sections: "Figures 7-2 / 7-4; Tables 7-11 / 7-12; ramp cross-sections",
    },
];
export const referenceLayout = {
    laneWidth: 3.65,
    mainShoulder: 2,
    rampLane: 3.7,
    rampShoulder: 1.5,
    loopLane: 4.9,
    carriagewayOffset: 8.5,
    collectorOffset: 32,
    loopRadius: 120,
    diamondTerminalSpacing: 260,
    diamondSpan: 48,
    cloverSpan: 96,
    deckElevation: 7.2,
    deckDepth: 1.6,
    entranceRun: 200,
    exitRun: 150,
    laneTaper: 90,
    mainGrade: 4,
    rampGrade: 6,
    clearance: 5.2,
    gradeJoinTolerance: 0.25,
};
export const roadClasses = [
    "street",
    "mainline",
    "connector",
    "loop",
    "collector",
];
