export const supportsAuxiliary = (r) => r.oneWay &&
    r.markingStyle === "motorway" &&
    r.cycleMode === "none" &&
    r.parking === "none";
export function auxiliaryDimensions(r, length) {
    const scale = Math.min(1, length / Math.max(1, r.auxiliaryLength + r.auxiliaryTaper));
    return {
        run: r.auxiliaryLength * scale,
        taper: r.auxiliaryTaper * scale,
        scale,
    };
}
export function auxiliaryWidthAt(r, s, length) {
    if (!supportsAuxiliary(r) || r.auxiliaryLane === "none")
        return 0;
    const { run, taper } = auxiliaryDimensions(r, length), weight = r.auxiliaryLane === "exit"
        ? (s - (length - run - taper)) / Math.max(1, taper)
        : (run + taper - s) / Math.max(1, taper);
    return r.laneWidth * Math.max(0, Math.min(1, weight));
}
