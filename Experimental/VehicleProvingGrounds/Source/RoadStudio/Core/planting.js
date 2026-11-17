import { add } from "./math.js";
/** A framed opening with walls and recessed soil; no tree/environment mesh. */
export function buildPlantingPit(b, sample, width, length, grate, rimHeight = 0.012, alongFractions = [-0.5, 0.5]) {
    const rim = 0.12, ring = (w, l, h) => [
        ...alongFractions.map((u) => sample(u * l, -w / 2, h)),
        ...[...alongFractions].reverse().map((u) => sample(u * l, w / 2, h)),
    ], close = (r) => [...r, r[0]], outer = ring(width, length, rimHeight), inner = ring(width - 2 * rim, length - 2 * rim, rimHeight), floor = ring(width - 2 * rim, length - 2 * rim, -0.16);
    b.strip("curb", "curb", close(outer), close(inner), true);
    b.strip("curb", "curb", close(inner), close(floor));
    b.strip("curb", "curb", close(ring(width, length, -0.16)), close(outer));
    b.polygon("planting", "soil", floor, undefined, true);
    if (grate) {
        const hw = (width - 2 * rim) / 2, hl = (length - 2 * rim) / 2, r = Math.min(0.32, hw - 0.045, hl - 0.045), hole = Array.from({ length: 32 }, (_, i) => sample(Math.cos((i * Math.PI) / 16) * r, Math.sin((i * Math.PI) / 16) * r, rimHeight + 0.002)), slots = [];
        const slot = (u, lo, hi) => {
            if (hi - lo < 0.12)
                return;
            slots.push([
                sample(u - 0.023, lo, rimHeight + 0.002),
                sample(u + 0.023, lo, rimHeight + 0.002),
                sample(u + 0.023, hi, rimHeight + 0.002),
                sample(u - 0.023, hi, rimHeight + 0.002),
            ]);
        };
        for (let u = -hl + 0.14; u < hl - 0.12; u += 0.24) {
            const clearance = r + 0.09;
            if (Math.abs(u) < clearance) {
                slot(u, -hw + 0.07, -clearance);
                slot(u, clearance, hw - 0.07);
            }
            else
                slot(u, -hw + 0.07, hw - 0.07);
        }
        b.faceWithHoles("planting", "tree-grate", ring(width - 2 * rim, length - 2 * rim, rimHeight + 0.002), [hole, ...slots]);
        for (const opening of [hole, ...slots])
            b.strip("planting", "utility-iron", close(opening), close(opening.map((p) => add(p, [0, -0.025, 0]))));
    }
}
