import { geometryProfiles } from "./quality.js";
const diffuse = {
    soil: [0.31, 0.26, 0.2],
    "cycle-red": [0.56, 0.29, 0.26],
    "cycle-green": [0.31, 0.44, 0.36],
    "bus-red": [0.46, 0.27, 0.25],
    "tree-grate": [0.32, 0.34, 0.32],
    asphalt: [0.18, 0.21, 0.25],
    "utility-iron": [0.41, 0.43, 0.4],
    "utility-recess": [0.1, 0.13, 0.12],
    "utility-cover": [0.32, 0.35, 0.33],
    "utility-grate": [0.45, 0.48, 0.44],
    "pave-border": [0.32, 0.37, 0.41],
    pole: [0.22, 0.27, 0.32],
    "signal-red": [0.93, 0.35, 0.35],
    "signal-green": [0.32, 0.83, 0.57],
    "signal-off": [0.14, 0.2, 0.23],
    rubber: [0.12, 0.15, 0.19],
    concrete: [0.64, 0.68, 0.61],
    cobble: [0.59, 0.61, 0.54],
    curb: [0.7, 0.74, 0.67],
    paint: [0.9, 0.92, 0.85],
    yellow: [0.88, 0.8, 0.48],
    steel: [0.67, 0.73, 0.7],
    "steel-dark": [0.35, 0.39, 0.42],
    foundation: [0.52, 0.54, 0.53],
    girder: [0.35, 0.46, 0.47],
    gutter: [0.15, 0.23, 0.2],
    "road-base": [0.39, 0.45, 0.39],
};
/** OBJ positions are in meters, Y-up. Normals are generated per triangle for
 * explicit, correct shading in engines that do not regenerate normals. */
export function exportOBJ(network, baseName = "frontier-roads", textures = {}) {
    const lines = [
        `# Frontier Road Studio | meters | Y-up`,
        `mtllib ${baseName}.mtl`,
    ];
    let vertexBase = 1, normalBase = 1;
    const materialNames = new Set();
    for (const mesh of network.meshes) {
        const material = mesh.material.replace(/[^a-zA-Z0-9_-]/g, "_");
        materialNames.add(material);
        lines.push(`o ${mesh.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`, `usemtl ${material}`);
        for (let i = 0; i < mesh.positions.length; i += 3)
            lines.push(`v ${mesh.positions
                .slice(i, i + 3)
                .map((n) => n.toFixed(6))
                .join(" ")}`);
        for (let i = 0; i < mesh.uvs.length; i += 2)
            lines.push(`vt ${mesh.uvs[i].toFixed(6)} ${mesh.uvs[i + 1].toFixed(6)}`);
        const faces = [];
        for (let i = 0; i < mesh.indices.length; i += 3) {
            const [a, b, c] = mesh.indices.slice(i, i + 3), p = mesh.positions;
            const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
            const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
            const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], length = Math.hypot(...n) || 1;
            lines.push(`vn ${n.map((v) => (v / length).toFixed(6)).join(" ")}`);
            faces.push(`f ${[a, b, c].map((v) => `${v + vertexBase}/${v + vertexBase}/${normalBase}`).join(" ")}`);
            normalBase++;
        }
        // A production girder/rail group can exceed a browser's argument limit.
        // Appending one line at a time avoids an otherwise valid OBJ failing with
        // "Maximum call stack size exceeded" on a large mesh.
        for (const face of faces)
            lines.push(face);
        vertexBase += mesh.positions.length / 3;
    }
    const mtl = [
        "# Frontier materials. Extract this archive with its textures directory intact.",
    ];
    for (const name of materialNames) {
        const color = (textures[name]
            ? name === "concrete"
                ? [0.76, 0.78, 0.81]
                : [1, 1, 1]
            : diffuse[name]) ??
            (name.startsWith("paving-") ? [0.66, 0.66, 0.59] : [0.3, 0.4, 0.32]);
        mtl.push(`newmtl ${name}`, `Kd ${color.join(" ")}`, `Ka 0.1 0.1 0.1`, `Ks ${["steel", "steel-dark", "girder", "pole"].includes(name) || name.startsWith("utility-") ? "0.5 0.5 0.5" : "0.05 0.05 0.05"}`, `Ns ${["steel", "steel-dark", "girder", "pole"].includes(name) ? 70 : 8}`, `d 1`, `illum 2`, ...(name.startsWith("utility-") ||
            ["tree-grate", "steel", "steel-dark", "girder", "pole"].includes(name)
            ? ["Pm 0.72"]
            : []), "");
        if (textures[name]) {
            const t = textures[name], clamp = t.wrapS === "clamp" && t.wrapT === "clamp" ? " -clamp on" : "";
            mtl.push(`map_Kd -s ${t.scale[0]} ${t.scale[1]} 1${clamp} ${t.path}`);
            if (t.alpha)
                mtl.push(`map_d -s ${t.scale[0]} ${t.scale[1]} 1 ${t.path}`);
            if (t.normalPath)
                mtl.push(`norm -s ${t.scale[0]} ${t.scale[1]} 1${clamp} ${t.normalPath}`);
            if (t.roughnessPath)
                mtl.push(`Pr 1`, `map_Pr -s ${t.scale[0]} ${t.scale[1]} 1${clamp} ${t.roughnessPath}`);
        }
    }
    return { obj: lines.join("\n"), mtl: mtl.join("\n") };
}
/** Explicit engine-side lookup; OBJ names alone cannot preserve authoring metadata. */
export function exportMeshManifest(network, project) {
    return {
        version: 1,
        generator: "Frontier Road authoring",
        project: project.name,
        units: "metres",
        upAxis: "Y",
        geometryDetail: network.detail,
        tolerances: {
            maxRoadSegment: geometryProfiles[network.detail].maxSegment,
            maxCurveDeviation: geometryProfiles[network.detail].maxDeviation,
        },
        bounds: network.bounds,
        triangles: network.triangles,
        vertices: network.vertices,
        includesPreviewEnvironment: false,
        services: network.services,
        footways: network.footways,
        plantings: network.plantings,
        blocks: network.blocks,
        mobility: network.mobility,
        bridges: network.bridges,
        barriers: network.barriers,
        splitters: network.splitters,
        streetDetails: network.streetDetails,
        roadsideParking: network.roadsideParking,
        designReview: network.designReview,
        generatedSections: network.generatedSections,
        surfaceJoins: network.surfaceJoins,
        surfaceClearances: network.surfaceClearances,
        auxiliaryLanes: network.auxiliaryLanes,
        embankments: network.embankments,
        junctionOffsets: network.junctions.map((j) => ({
            id: j.node.id,
            requestedRadius: j.requestedRadius,
            offsetRadiusFloor: j.radius,
            fittedCornerRadii: j.cornerRadii,
        })),
        objects: network.meshes.map((m) => ({
            name: m.name.replace(/[^a-zA-Z0-9_-]/g, "_"),
            kind: m.kind,
            owner: {
                id: m.owner,
                kind: m.ownerKind,
                name: m.ownerKind === "node"
                    ? project.nodes.find((n) => n.id === m.owner)?.name
                    : m.ownerKind === "site"
                        ? project.sites?.find((s) => s.id === m.owner)?.name
                        : project.roads.find((r) => r.id === m.owner)?.name,
            },
            material: m.material,
            vertices: m.positions.length / 3,
            triangles: m.indices.length / 3,
        })),
    };
}
