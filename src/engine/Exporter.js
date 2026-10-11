// Terrain & Texture Exporter: 16-bit Heightmap PNG, Normal Map, Albedo, Flow Mask, and 3D Wavefront OBJ

export class TerrainExporter {
  // Export 16-bit Heightmap as PNG (or 8-bit / packed)
  static exportHeightmapPNG(heightMap, size, bitDepth = 16) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(size, size);

    for (let i = 0; i < size * size; i++) {
      const h = Math.max(0, Math.min(1.0, heightMap[i]));
      const outIdx = i * 4;

      if (bitDepth === 16) {
        // High byte in R, Low byte in G (Standard 16-bit packed raw format)
        const val16 = Math.floor(h * 65535.0);
        imgData.data[outIdx + 0] = (val16 >> 8) & 255;
        imgData.data[outIdx + 1] = val16 & 255;
        imgData.data[outIdx + 2] = 0;
        imgData.data[outIdx + 3] = 255;
      } else {
        const val8 = Math.floor(h * 255.0);
        imgData.data[outIdx + 0] = val8;
        imgData.data[outIdx + 1] = val8;
        imgData.data[outIdx + 2] = val8;
        imgData.data[outIdx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    this.downloadCanvasAsImage(canvas, `terrain_heightmap_${bitDepth}bit.png`);
  }

  // Export Texture Map (Albedo, Normal, Flow, Sediment) as PNG
  static exportTexturePNG(pixelData, size, filename) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(size, size);

    imgData.data.set(pixelData);
    ctx.putImageData(imgData, 0, 0);
    this.downloadCanvasAsImage(canvas, filename);
  }

  // Export Flow or Sediment mask as grayscale PNG
  static exportMaskPNG(maskData, size, filename) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(size, size);

    for (let i = 0; i < size * size; i++) {
      const v = Math.round(Math.max(0, Math.min(1.0, maskData[i])) * 255);
      const idx = i * 4;
      imgData.data[idx + 0] = v;
      imgData.data[idx + 1] = v;
      imgData.data[idx + 2] = v;
      imgData.data[idx + 3] = 255;
    }

    ctx.putImageData(imgData, 0, 0);
    this.downloadCanvasAsImage(canvas, filename);
  }

  // Export 3D Mesh as Wavefront OBJ file
  static exportOBJ(heightMap, size, options = {}) {
    const {
      scaleXZ = 500.0,
      scaleY = 280.0,
      step = 1 // Step 1 = full res, Step 2 = half res for smaller file size
    } = options;

    let obj = `# Frontier Geological Terrain Generator (Gaea-grade)\n`;
    obj += `# Resolution: ${size}x${size}, Export Step: ${step}\n`;

    const subSize = Math.floor((size - 1) / step) + 1;

    // Vertices
    for (let y = 0; y < size; y += step) {
      const v = (y / (size - 1) - 0.5) * scaleXZ;
      for (let x = 0; x < size; x += step) {
        const u = (x / (size - 1) - 0.5) * scaleXZ;
        const h = heightMap[y * size + x] * scaleY;
        obj += `v ${u.toFixed(2)} ${h.toFixed(2)} ${v.toFixed(2)}\n`;
      }
    }

    // Texture Coordinates (UV)
    for (let y = 0; y < size; y += step) {
      const v = y / (size - 1);
      for (let x = 0; x < size; x += step) {
        const u = x / (size - 1);
        obj += `vt ${u.toFixed(4)} ${(1.0 - v).toFixed(4)}\n`;
      }
    }

    // Faces
    for (let j = 0; j < subSize - 1; j++) {
      for (let i = 0; i < subSize - 1; i++) {
        const v00 = j * subSize + i + 1;
        const v10 = j * subSize + (i + 1) + 1;
        const v01 = (j + 1) * subSize + i + 1;
        const v11 = (j + 1) * subSize + (i + 1) + 1;

        // Tri 1
        obj += `f ${v00}/${v00} ${v10}/${v10} ${v11}/${v11}\n`;
        // Tri 2
        obj += `f ${v00}/${v00} ${v11}/${v11} ${v01}/${v01}\n`;
      }
    }

    const blob = new Blob([obj], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `terrain_mesh_${subSize}x${subSize}.obj`;
    a.click();
    URL.revokeObjectURL(url);
  }

  static downloadCanvasAsImage(canvas, filename) {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  // Export full project JSON
  static exportProjectJSON(terrainLayers, textureLayers, settings) {
    const data = {
      version: '1.0.0',
      generator: 'Frontier Gaea Terrain Studio',
      timestamp: new Date().toISOString(),
      terrainLayers,
      textureLayers,
      settings
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `frontier_terrain_project_${Date.now()}.gaea.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
