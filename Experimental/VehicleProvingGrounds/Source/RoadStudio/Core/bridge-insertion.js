import { cubicProfile, analyzeCubic } from "./cubic-analysis.js";
import { buildNetwork } from "./geometry.js";
import { referenceLayout } from "./design-basis.js";
import { bridgeAt } from "./bridge-profile.js";
import { controlPoints, getNode, validateGenerationBudget, roadHalfWidth, } from "./model.js";
import { sampleAlignment, stationAt } from "./curves.js";
import { splitRoad, detectCrossings } from "./editing.js";
import { cubic } from "./math.js";
/** Atomic graph operation: preserves the two existing shared endpoints and the
 * exact XZ cubic, then inserts two level deck joints and three connected pieces.
 * It refuses steep/blocked approaches instead of lifting neighbouring streets.
 */
export function insertConnectedBridge(project, roadId, options = {}) {
    const original = project.roads.find((r) => r.id === roadId);
    if (!original)
        throw new RangeError("Select an existing road alignment.");
    if (original.bridge)
        throw new RangeError("This alignment is already a bridge. Edit its superstructure, or select a ground approach.");
    if (original.driveways.length)
        throw new RangeError("Clear vehicle entries before elevating this alignment, or choose another road.");
    if (original.auxiliaryLane !== "none")
        throw new RangeError("Choose an alignment without an authored speed-change lane before inserting a bridge.");
    const originalCurve = controlPoints(project, original), originalMetric = analyzeCubic(originalCurve), originalProfile = cubicProfile(originalCurve);
    if (originalMetric.issues.length)
        throw new RangeError("This alignment has a reversing, vertical or zero-radius tangent. Fix its handles before inserting a bridge.");
    const spatial = sampleAlignment(project, original);
    let planStation = 0;
    const stations = spatial.stations.map((f, i) => {
        if (i)
            planStation += Math.hypot(f.p[0] - spatial.stations[i - 1].p[0], f.p[2] - spatial.stations[i - 1].p[2]);
        return { ...f, s: planStation };
    }), alignment = { ...spatial, stations, length: planStation }, length = alignment.length, rise = options.rise ?? referenceLayout.deckElevation, deckLength = 64, requiredLength = Math.max(600, Math.ceil((3 * rise) / 0.0405 + deckLength));
    if (!Number.isFinite(rise) || rise < 5 || rise > 16)
        throw new RangeError("Bridge rise must be between 5 and 16 metres.");
    if (length < requiredLength)
        throw new RangeError(`Connected bridge insertion needs at least ${requiredLength} m for a 64 m deck and approximately 4% approaches at this rise. Use the Connected highway bridge template, or lengthen this alignment.`);
    if (project.roads.length > 498 || project.nodes.length > 1498)
        throw new RangeError("Not enough editor-tile capacity for the bridge approaches.");
    const draft = structuredClone(project), r = draft.roads.find((r) => r.id === roadId), elevation = Math.max(getNode(draft, r.start).position[1], getNode(draft, r.end).position[1]) + rise, start = r.start, end = r.end;
    const ta = stationAt(alignment, (length - deckLength) / 2).t, tb = stationAt(alignment, (length + deckLength) / 2).t;
    const a = splitRoad(draft, r.id, ta), rest = draft.roads.find((r) => r.start === a.id && r.end === end), b = splitRoad(draft, rest.id, (tb - ta) / (1 - ta));
    a.position[1] = b.position[1] = elevation;
    a.name = "Bridge landing · In";
    b.name = "Bridge landing · Out";
    a.crossings = b.crossings = false;
    const approachIn = draft.roads.find((r) => r.start === start && r.end === a.id), deck = draft.roads.find((r) => r.start === a.id && r.end === b.id), approachOut = draft.roads.find((r) => r.start === b.id && r.end === end);
    for (const piece of [approachIn, deck, approachOut]) {
        piece.bridge = piece.id === deck.id;
        piece.bridgeFrom = 0;
        piece.bridgeTo = 1;
        piece.embankment = piece.id !== deck.id;
        if (piece.roadClass === "street" && piece.markingStyle === "motorway")
            piece.roadClass = "mainline";
        piece.bridgeDepth = Math.max(piece.bridgeDepth, referenceLayout.deckDepth);
        piece.structure = options.structure ?? "steel";
        piece.guardrails = true;
        if (!original.guardrails) {
            piece.railStyle = "boxbeam";
            piece.railHeight = Math.max(0.95, piece.railHeight);
        }
        piece.h1[1] = piece.h2[1] = 0;
        if (piece.id === approachIn.id)
            piece.h1[1] =
                ((originalProfile.signedGradeAt(0) ?? 0) / 100) *
                    Math.hypot(piece.h1[0], piece.h1[2]);
        if (piece.id === approachOut.id)
            piece.h2[1] =
                (-(originalProfile.signedGradeAt(1) ?? 0) / 100) *
                    Math.hypot(piece.h2[0], piece.h2[2]);
        const metric = analyzeCubic(controlPoints(draft, piece));
        if (metric.issues.length ||
            metric.maximumGrade === null ||
            metric.maximumGrade > 4.05)
            throw new RangeError("This curve cannot fit grade-continuous approaches at approximately 4% grade. Lengthen the alignment or reduce the bridge rise.");
    }
    approachIn.name = `${original.name} · Bridge approach in`;
    deck.name = `${original.name} · Connected bridge deck`;
    approachOut.name = `${original.name} · Bridge approach out`;
    const edited = new Set([approachIn.id, deck.id, approachOut.id]);
    for (const crossing of detectCrossings(draft, Infinity)) {
        if (!edited.has(crossing.a) && !edited.has(crossing.b))
            continue;
        const a = draft.roads.find((r) => r.id === crossing.a), b = draft.roads.find((r) => r.id === crossing.b), ay = cubic(controlPoints(draft, a), crossing.ta)[1], by = cubic(controlPoints(draft, b), crossing.tb)[1], upper = ay > by ? a : b, lower = ay > by ? b : a, clearance = Math.abs(ay - by) -
            (bridgeAt(upper, ay > by ? crossing.ta : crossing.tb)
                ? upper.bridgeDepth
                : 0.48) -
            Math.max(0.12, 0.04 + (roadHalfWidth(lower) * lower.crossfall) / 100);
        if (clearance < referenceLayout.clearance)
            throw new RangeError("The inserted bridge would conflict with another road. Choose a clear alignment or increase its rise and approach length.");
    }
    validateGenerationBudget(draft);
    const generated = buildNetwork(draft), issue = generated.designReview.structureIssues.find((i) => edited.has(i.owner));
    if (issue)
        throw new RangeError(`${issue.message} Choose a clear landing or a longer structural span.`);
    const physical = generated.surfaceClearances.find((c) => c.lowerKind === "motor" &&
        (edited.has(c.upper) ||
            generated.bridges.some((b) => b.owner === c.upper &&
                b.kind === "joint" &&
                b.connections.some((id) => edited.has(id)))) &&
        c.meters < referenceLayout.clearance);
    if (physical)
        throw new RangeError("The inserted bridge has insufficient physical pavement clearance away from its centreline crossing. Increase the rise and approach length.");
    project.nodes = draft.nodes;
    project.roads = draft.roads;
    return {
        bridge: deck.id,
        approaches: [approachIn.id, approachOut.id],
        joints: [a.id, b.id],
        elevation,
        deckLength: sampleAlignment(draft, deck).length,
        approachLengths: [
            sampleAlignment(draft, approachIn).length,
            sampleAlignment(draft, approachOut).length,
        ],
    };
}
