import { generateRockFormation } from '../geology/generator.js';

self.onmessage = (event) => {
  const { id, params } = event.data;
  try {
    const result = generateRockFormation(params, (progress, stage) => {
      self.postMessage({ type: 'progress', id, progress, stage });
    });

    const { mesh, stats, lithology } = result;
    const transferList = [
      mesh.positions.buffer,
      mesh.normals.buffer,
      mesh.uvs.buffer,
      mesh.colors.buffer,
      mesh.indices.buffer,
    ];
    if (mesh.albedos) transferList.push(mesh.albedos.buffer);

    self.postMessage(
      {
        type: 'done',
        id,
        params: result.params,
        lithology,
        stats,
        mesh: {
          positions: mesh.positions,
          normals: mesh.normals,
          uvs: mesh.uvs,
          colors: mesh.colors,
          albedos: mesh.albedos || null,
          hasCustomAlbedo: !!mesh.hasCustomAlbedo,
          indices: mesh.indices,
        },
      },
      transferList
    );
  } catch (err) {
    self.postMessage({
      type: 'error',
      id,
      message: err?.message || String(err),
    });
  }
};
