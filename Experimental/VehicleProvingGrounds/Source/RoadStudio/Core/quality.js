/** Geometry tolerances in metres. Editing topology remains independent. */
export const geometryProfiles = {
    editing: {
        maxSegment: 2.8,
        maxDepth: 12,
        maxDeviation: 0.045,
        minCornerPoints: 32,
        cornerSegment: 2.8,
        maxCornerPoints: 128,
    },
    production: {
        maxSegment: 0.75,
        maxDepth: 14,
        maxDeviation: 0.01,
        minCornerPoints: 64,
        cornerSegment: 0.35,
        maxCornerPoints: 512,
    },
};
export const normaliseDetail = (detail) => detail === "production" ? "production" : "editing";
