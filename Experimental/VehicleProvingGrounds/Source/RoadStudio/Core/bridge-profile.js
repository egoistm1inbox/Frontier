/** A structure can occupy a bounded part of one continuous road alignment.
 * Keeping grade/width ports separate from structural ends avoids short graph
 * fragments and prevents long approaches being rendered as a viaduct. */
export const bridgeAt = (r, t) => r.bridge && t >= r.bridgeFrom - 1e-8 && t <= r.bridgeTo + 1e-8;
export function parameterStation(a, t) {
    if (t <= 0)
        return 0;
    if (t >= 1)
        return a.length;
    const i = a.stations.findIndex((s) => s.t >= t), left = a.stations[i - 1], right = a.stations[i];
    return (left.s +
        ((right.s - left.s) * (t - left.t)) / Math.max(1e-9, right.t - left.t));
}
