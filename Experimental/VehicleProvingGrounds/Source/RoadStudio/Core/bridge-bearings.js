import { add, mul } from "./math.js";
/** Geometric assembly dimensions, not a bearing/load specification. */
export const bearingDimensions = {
    plateHeight: 0.012,
    rubberHeight: 0.046,
    width: 0.34,
    length: 0.55,
    totalHeight: 0.07,
};
/** Both steel plates, the elastomer pad and the girder underside meet exactly.
 * Offsets come from the span's FIXED girder count even where its width tapers. */
export function buildBearings(b, frame, depth, offsets, seat, existing = [], member) {
    const d = bearingDimensions, top = frame.p[1] - depth, bottom = top - d.totalHeight;
    return offsets.flatMap((offset, girderIndex) => {
        const axis = add(frame.p, mul(frame.n, offset)), shared = existing.find((b) => Math.hypot(b.position[0] - axis[0], b.position[2] - axis[2]) < 1e-7 &&
            Math.abs(b.top - top) < 1e-7);
        if (shared) {
            if (member && !shared.members?.includes(member))
                shared.members = [...(shared.members ?? []), member];
            return [];
        }
        const box = (material, centerY, height) => b.box("structure", material, [axis[0], centerY, axis[2]], d.width, height, d.length, frame.d);
        box("steel", bottom + d.plateHeight / 2, d.plateHeight);
        box("rubber", bottom + d.plateHeight + d.rubberHeight / 2, d.rubberHeight);
        box("steel", top - d.plateHeight / 2, d.plateHeight);
        return [
            {
                id: `${b.owner}:bearing:${seat}:${member ?? "span"}:${frame.s.toFixed(6)}:${girderIndex}`,
                seat,
                girderIndex,
                girderCount: offsets.length,
                station: frame.s,
                position: [axis[0], (bottom + top) / 2, axis[2]].map((v) => v === 0 ? 0 : v),
                direction: frame.d.map((v) => (v === 0 ? 0 : v)),
                offset: offset === 0 ? 0 : offset,
                bottom,
                top,
                width: d.width,
                length: d.length,
                plateHeight: d.plateHeight,
                rubberHeight: d.rubberHeight,
                physicalGeometry: true,
                ...(member ? { members: [member] } : {}),
            },
        ];
    });
}
