import { analyzeCubic, cubicProfile, } from "./cubic-analysis.js";
import { auxiliaryWidthAt } from "./road-sections.js";
import { parameterStation } from "./bridge-profile.js";
/** Published geometric references inform these editable game-asset defaults.
 * They are not a site-specific civil, structural, traffic-capacity or safety approval.
 */
import { controlPoints, connected, getNode, } from "./model.js";
import { derivative, cubic, normalizeXZ, dotXZ, sub } from "./math.js";
import { sampleAlignment } from "./curves.js";
import { designSources, referenceLayout } from "./design-basis.js";
export { designSources, referenceLayout, roadClasses, } from "./design-basis.js";
export function curveDesignMetrics(points) {
    return analyzeCubic(points);
}
export function measureRoadDesign(project, r) {
    const role = r.roadClass, metric = curveDesignMetrics(controlPoints(project, r)), radiusTarget = role === "loop"
        ? r.speedLimit >= 50
            ? 100
            : 65
        : role === "mainline"
            ? r.speedLimit >= 100
                ? 600
                : r.speedLimit >= 80
                    ? 400
                    : 260
            : r.speedLimit >= 70
                ? 260
                : 150, gradeTarget = role === "mainline"
        ? referenceLayout.mainGrade
        : referenceLayout.rampGrade, widthTarget = role === "loop" ? 4.57 : 3.65;
    return {
        owner: r.id,
        role,
        ...metric,
        laneWidth: r.laneWidth,
        shoulderWidth: r.shoulderWidth,
        radiusTarget,
        gradeTarget,
        widthTarget,
        meetsReference: (metric.minimumRadius === null ||
            metric.minimumRadius >= radiusTarget - 0.1) &&
            metric.issues.length === 0 &&
            metric.maximumGrade !== null &&
            metric.maximumGrade <= gradeTarget + 0.05 &&
            r.laneWidth >= widthTarget - 0.01,
    };
}
export function measureWeaves(project, splitters) {
    const out = [];
    for (const merge of project.nodes) {
        const incident = connected(project, merge.id);
        if (!incident.some((r) => r.roadClass === "loop" && r.end === merge.id))
            continue;
        const nose = splitters.find((s) => s.owner === merge.id)?.pavingNose;
        if (!nose)
            continue;
        let cursor = merge.id, steps = 0, planLength = 0;
        const owners = [];
        let firstDirection, lastDirection;
        while (steps++ < project.roads.length) {
            const r = project.roads.find((r) => r.roadClass === "collector" && r.start === cursor);
            if (!r || owners.includes(r.id))
                break;
            const points = controlPoints(project, r);
            firstDirection ??= normalizeXZ(derivative(points, 0));
            lastDirection = normalizeXZ(derivative(points, 1));
            planLength += curveDesignMetrics(points).planLength;
            owners.push(r.id);
            cursor = r.end;
            if (connected(project, cursor).some((r) => r.roadClass === "loop" && r.start === cursor)) {
                const diverge = getNode(project, cursor), end = splitters.find((s) => s.owner === cursor)?.pavingNose;
                if (end)
                    out.push({
                        merge: merge.id,
                        diverge: cursor,
                        owners,
                        nodeSpacing: planLength,
                        noseSpacing: planLength +
                            Math.max(0, dotXZ(sub(merge.position, nose), firstDirection)) +
                            Math.max(0, dotXZ(sub(end, diverge.position), lastDirection)),
                        mergeNose: [...nose],
                        divergeNose: [...end],
                    });
                break;
            }
        }
    }
    return out;
}
export function measureJunctionLanes(project) {
    return project.nodes.flatMap((n) => {
        const roads = connected(project, n.id);
        if (roads.length < 3 ||
            !roads.every((r) => r.oneWay && r.markingStyle === "motorway"))
            return [];
        let incoming = 0, outgoing = 0, auxiliaryApproaches = 0;
        for (const r of roads) {
            const length = sampleAlignment(project, r).length, auxiliary = auxiliaryWidthAt(r, r.start === n.id ? 0 : length, length) >=
                r.laneWidth - 1e-6
                ? 1
                : 0;
            auxiliaryApproaches += auxiliary;
            if (r.end === n.id)
                incoming += r.lanes + auxiliary;
            else
                outgoing += r.lanes + auxiliary;
        }
        return [
            {
                owner: n.id,
                incoming,
                outgoing,
                auxiliaryApproaches,
                balanced: incoming === outgoing,
            },
        ];
    });
}
export const curveIssueMessages = {
    "plan-reversal": "plan direction reverses; reshape the handles or use separate connected roads",
    "vertical-tangent": "unbounded vertical grade at a stopped plan tangent; separate the handle from the pivot in plan",
    "collapsed-plan": "no usable horizontal alignment; move an endpoint in plan",
    "zero-radius-tangent": "zero-radius stopped tangent; move the coincident handle away from the pivot",
};
export function measureGradeJoins(project) {
    return project.nodes.flatMap((n) => {
        const roads = connected(project, n.id);
        if (roads.length !== 2)
            return [];
        const profiles = roads.map((r) => cubicProfile(controlPoints(project, r))), ts = roads.map((r) => (r.start === n.id ? 0 : 1)), dirs = profiles.map((p, i) => {
            const d = p.tangentAt(ts[i]);
            return d ? d.map((v) => v * (ts[i] === 0 ? 1 : -1)) : null;
        });
        if (!dirs[0] || !dirs[1])
            return [];
        const mismatch = 180 -
            (Math.acos(Math.max(-1, Math.min(1, dotXZ(dirs[0], dirs[1])))) * 180) /
                Math.PI;
        if (mismatch > 12 + 1e-7)
            return [];
        const grades = profiles.map((p, i) => {
            const grade = p.signedGradeAt(ts[i]);
            return grade === null ? null : grade * (ts[i] === 0 ? 1 : -1) || 0;
        }), delta = grades[0] === null || grades[1] === null
            ? null
            : Math.abs(grades[0] + grades[1]);
        return [
            {
                owner: n.id,
                roads: [roads[0].id, roads[1].id],
                outwardGrades: grades,
                delta,
                headingMismatch: mismatch === 0 ? 0 : mismatch,
                continuous: delta !== null && delta <= referenceLayout.gradeJoinTolerance,
                assessed: roads.some((r) => r.roadClass !== "street"),
            },
        ];
    });
}
export function reviewDesign(project, clearances, bridges, splitters = [], structureIssues = [], pavement = { generatedSections: [], surfaceJoins: [], surfaceClearances: [] }) {
    const xs = project.nodes.map((n) => n.position[0]), zs = project.nodes.map((n) => n.position[2]);
    const sections = new Map(pavement.generatedSections.map((s) => [s.owner, s]));
    const all = project.roads.map((r) => {
        const m = measureRoadDesign(project, r), s = sections.get(r.id), owners = new Set([
            r.id,
            ...(bridges ?? [])
                .filter((b) => b.kind === "joint" && b.connections?.includes(r.id) && b.owner)
                .map((b) => b.owner),
        ]), clear = pavement.surfaceClearances
            .filter((c) => owners.has(c.upper) && c.lowerKind === "motor")
            .map((c) => c.meters), measured = clear.length ? Math.min(...clear) : null, failedStructure = structureIssues.some((i) => owners.has(i.owner));
        return {
            ...m,
            ...(s
                ? {
                    minimumGeneratedLaneWidth: s.minimumLaneWidth,
                    minimumGeneratedWidthParameter: s.minimumWidthParameter,
                    generatedSectionMeasured: true,
                }
                : {}),
            minimumPhysicalMotorClearance: measured,
            meetsReference: m.meetsReference &&
                (!s || s.minimumLaneWidth >= m.widthTarget - 0.01) &&
                !failedStructure &&
                (measured === null || measured >= referenceLayout.clearance),
        };
    }), roads = all.filter((r) => r.role !== "street"), gradeJoins = measureGradeJoins(project), alignmentIssues = all.flatMap((m) => m.issues.map((i) => {
        const r = project.roads.find((r) => r.id === m.owner);
        return {
            owner: m.owner,
            kind: i.kind,
            parameter: i.parameter,
            position: cubic(controlPoints(project, r), i.parameter).map((v) => v === 0 ? 0 : v),
            message: curveIssueMessages[i.kind],
        };
    }));
    const minimumSurface = (kind) => {
        const values = pavement.surfaceClearances
            .filter((c) => c.lowerKind === kind)
            .map((c) => c.meters);
        return values.length ? Math.min(...values) : null;
    };
    return {
        units: "metres",
        basis: "Reference-scaled game geometry, not civil certification",
        sources: designSources,
        roads,
        clearanceTarget: referenceLayout.clearance,
        structureIssues,
        alignmentIssues,
        gradeJoins,
        junctionLanes: measureJunctionLanes(project),
        pavementAudit: {
            minimumMotorClearance: minimumSurface("motor"),
            minimumCycleClearance: minimumSurface("cycle"),
            minimumPedestrianClearance: minimumSurface("pedestrian"),
            allJoinsSealed: pavement.surfaceJoins.every((j) => j.sealed),
            method: "generated-pavement-surfaces",
        },
        withinSelectedTargets: pavement.surfaceJoins.every((j) => j.sealed) &&
            pavement.surfaceClearances
                .filter((c) => c.lowerKind === "motor")
                .every((c) => c.meters >= referenceLayout.clearance) &&
            structureIssues.length === 0 &&
            alignmentIssues.length === 0 &&
            gradeJoins.filter((j) => j.assessed).every((j) => j.continuous) &&
            roads.every((r) => r.meetsReference) &&
            clearances.every((c) => c.meters >= referenceLayout.clearance),
        weaves: measureWeaves(project, splitters),
        bridgeLength: bridges
            ? bridges
                .filter((b) => b.kind === "span")
                .reduce((s, b) => s + (b.spanLengths ?? []).reduce((v, l) => v + l, 0), 0)
            : project.roads
                .filter((r) => r.bridge)
                .reduce((s, r) => {
                const a = sampleAlignment(project, r);
                return (s +
                    parameterStation(a, r.bridgeTo) -
                    parameterStation(a, r.bridgeFrom));
            }, 0),
        minimumClearance: clearances.length
            ? Math.min(...clearances.map((c) => c.meters))
            : null,
        extent: xs.length
            ? [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)]
            : [0, 0],
        limitations: [
            "Chosen template cross-sections are editable assumptions, not universal jurisdiction standards.",
            "Traffic demand, queue storage, weaving capacity, stopping/decision sight distance and superelevation require site-specific review.",
            "Bridge members and foundations are geometric assets, not structural load designs.",
        ],
    };
}
