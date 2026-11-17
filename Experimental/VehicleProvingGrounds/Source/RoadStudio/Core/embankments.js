import { parameterStation } from "./bridge-profile.js";
import { edgePoint, frameAt, } from "./geometry.js";
import { add, mul } from "./math.js";
const GROUND = 0, SLOPE = 2;
/** Compacted approach fill is a closed infrastructure mesh, not a landscape
 * prop. A bounded structural interval stays completely free of fill. */
export function buildApproachFill(b, span) {
    const r = span.road, features = [];
    if (!r.embankment)
        return features;
    const first = span.frames[0].s, last = span.frames.at(-1).s, intervals = r.bridge
        ? [
            [
                first,
                Math.min(last, parameterStation(span.alignment, r.bridgeFrom)),
            ],
            [Math.max(first, parameterStation(span.alignment, r.bridgeTo)), last],
        ]
        : [[first, last]], height = (f) => f.p[1] - (f.roadBaseDepth ?? 0.48) - 0.005 - GROUND;
    for (const [a, z] of intervals) {
        if (z - a < 0.05)
            continue;
        const input = [
            frameAt(span, a),
            ...span.frames.filter((f) => f.s > a + 1e-7 && f.s < z - 1e-7),
            frameAt(span, z),
        ], runs = [];
        let run = [];
        const crossing = (p, q) => {
            let lo = p.s, hi = q.s;
            for (let i = 0; i < 24; i++) {
                const m = (lo + hi) / 2;
                if (height(frameAt(span, m)) > 0.05 === height(p) > 0.05)
                    lo = m;
                else
                    hi = m;
            }
            return frameAt(span, (lo + hi) / 2);
        };
        for (let i = 0; i < input.length; i++) {
            const f = input[i], prior = input[i - 1], live = height(f) > 0.05;
            if (live) {
                if (prior && height(prior) <= 0.05)
                    run.push(crossing(prior, f));
                run.push(f);
            }
            else if (run.length) {
                if (prior)
                    run.push(crossing(prior, f));
                runs.push(run);
                run = [];
            }
        }
        if (run.length)
            runs.push(run);
        for (const frames of runs) {
            if (frames.length < 2)
                continue;
            const crest = (side) => frames.map((f) => {
                const p = edgePoint(f, side, "bottom");
                p[1] = GROUND + Math.max(0, height(f));
                return p;
            }), toe = (side) => frames.map((f) => {
                const p = edgePoint(f, side, "bottom"), h = Math.max(0, height(f));
                const q = add(p, mul(f.n, side * (h * SLOPE + 0.6)));
                q[1] = GROUND;
                return q;
            }), left = crest(-1), right = crest(1), leftToe = toe(-1), rightToe = toe(1);
            b.strip("structure", "soil", left, right, true);
            b.strip("structure", "soil", leftToe, left);
            b.strip("structure", "soil", right, rightToe);
            b.strip("structure", "soil", rightToe, leftToe, false);
            for (const i of [0, frames.length - 1])
                b.quad("structure", "soil", [
                    left[i],
                    leftToe[i],
                    rightToe[i],
                    right[i],
                ]);
            features.push({
                owner: r.id,
                ownerKind: "road",
                kind: "approach-fill",
                start: [...frames[0].p],
                end: [...frames.at(-1).p],
                groundLevel: GROUND,
                slope: SLOPE,
                containsVegetation: false,
                physicalGeometry: true,
            });
        }
    }
    return features;
}
/** The tightly fitted split/merge platform uses a retaining base rather than
 * leaving a floating slab between the approach embankments. */
export function buildRetainedJoint(b, owner, bottom, enabled) {
    if (!enabled || !bottom.length || Math.max(...bottom.map((p) => p[1])) < 0.5)
        return;
    const base = bottom.map((p) => [p[0], GROUND, p[2]]), close = (p) => [...p, p[0]];
    b.polygon("structure", "concrete", bottom, undefined, true);
    b.strip("structure", "concrete", close(bottom), close(base));
    b.polygon("structure", "concrete", base, undefined, false);
    return {
        owner,
        ownerKind: "node",
        kind: "retained-junction",
        start: [...bottom[0]],
        end: [...bottom.at(-1)],
        groundLevel: GROUND,
        slope: 0,
        containsVegetation: false,
        physicalGeometry: true,
    };
}
