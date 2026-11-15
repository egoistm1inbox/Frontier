// Material-preserving Cluster LOD check: node Tests/MaterialLodCheck.mjs [ControlVehicleBody.facet|ControlVehicleTyre.facet|ControlVehicleRim.facet]
// For each level, with Preserve materials off and on: seam vertices that left the source seams, material surface
// share drift, materials that vanished, remaining area, and non-manifold edges (cracks / fins).
import fs from 'fs';
const base = new URL('../', import.meta.url).pathname;
const { readFacet } = await import(base + 'Source/MeshData.js');
const { buildClusterHierarchy } = await import(base + 'Engine/ClusterHierarchy.js');
const { lodLevel, materialSeams } = await import(base + 'Source/Compile.js');
const file = process.argv[2] || 'ControlVehicleBody.facet';
const buf = fs.readFileSync(base + 'Vehicle/Archive/' + file);
const raw = readFacet(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), file);
const P = raw.positions;
function area(idx, fam) {
  const out = new Map();
  for (let t = 0; t < idx.length / 3; t++) {
    const a = idx[t*3]*3, b = idx[t*3+1]*3, c = idx[t*3+2]*3;
    const ux=P[b]-P[a],uy=P[b+1]-P[a+1],uz=P[b+2]-P[a+2],vx=P[c]-P[a],vy=P[c+1]-P[a+1],vz=P[c+2]-P[a+2];
    const A=Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)/2;
    out.set(fam[t],(out.get(fam[t])||0)+A);
  }
  return out;
}
const srcSeam = new Set(materialSeams(raw.indices, raw.families));
const srcArea = area(raw.indices, raw.families);
console.log(file, 'tris', raw.indices.length/3, 'slots', raw.slots.length, 'source seam verts', srcSeam.size);
for (const preserve of [false, true]) {
  const h = buildClusterHierarchy(P, raw.indices, { families: raw.families, preserveMaterials: preserve });
  let pure = 0;
  for (let c = 0; c < h.clusterCount; c++) { const f = h.triangleFamily.subarray(h.clusterFirst[c]/3, (h.clusterFirst[c]+h.clusterSize[c])/3); if (f.every(x => x === f[0])) pure++; }
  console.log(`\npreserve=${preserve} levels=${h.levels.length} clusters=${h.clusterCount} pure=${pure} stalled=${h.stalled} seamBlocked=${h.seamBlocked} ${h.buildMs.toFixed(0)}ms`);
  for (let L = 0; L < h.levels.length; L += Math.max(1, Math.floor(h.levels.length/5))) {
    const { indices, families } = lodLevel(h, L);
    const seams = materialSeams(indices, families);
    let off = 0; for (const v of seams) if (!srcSeam.has(v)) off++;
    const A = area(indices, families);
    let total = 0, now = 0; for (const a of srcArea.values()) total += a; for (const a of A.values()) now += a;
    let drift = 0; for (const [f, a] of srcArea) drift += Math.abs((A.get(f)||0)/now - a/total);
    const lost = [...srcArea.keys()].filter((f) => !A.get(f)).length;
    // non-manifold edge check (3+ triangles on one edge = crack/fin)
    const use = new Map(); let nm = 0;
    for (let t = 0; t < indices.length/3; t++) for (let k=0;k<3;k++){const a=indices[t*3+k],b=indices[t*3+(k+1)%3];const key=a<b?a*1e6+b:b*1e6+a;use.set(key,(use.get(key)||0)+1);}
    for (const u of use.values()) if (u>2) nm++;
    console.log(`  L${L}: tris ${indices.length/3}  seam verts off-source ${off}/${seams.length}  material share drift ${(50*drift).toFixed(2)}%  materials lost ${lost}  area ${(100*now/total).toFixed(0)}%  non-manifold edges ${nm}`);
  }
}
