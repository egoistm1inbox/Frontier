import React, { useState } from 'react';
import {
  X,
  Download,
  FileCode,
  Image,
  Box,
  Layers,
  Sparkles,
  Check
} from 'lucide-react';
import { TerrainExporter } from '../engine/Exporter.js';

export function ExportModal({
  isOpen,
  onClose,
  terrainData,
  bakedTextures,
  terrainLayers,
  textureLayers
}) {
  if (!isOpen || !terrainData) return null;

  const [objStep, setObjStep] = useState(1);
  const [downloadSuccess, setDownloadSuccess] = useState(null);

  const notifySuccess = (name) => {
    setDownloadSuccess(name);
    setTimeout(() => setDownloadSuccess(null), 3000);
  };

  const handleExport16BitHeight = () => {
    const size = Math.round(Math.sqrt(terrainData.heightMap.length));
    TerrainExporter.exportHeightmapPNG(terrainData.heightMap, size, 16);
    notifySuccess('16-bit Heightmap PNG');
  };

  const handleExport8BitHeight = () => {
    const size = Math.round(Math.sqrt(terrainData.heightMap.length));
    TerrainExporter.exportHeightmapPNG(terrainData.heightMap, size, 8);
    notifySuccess('8-bit Heightmap PNG');
  };

  const handleExportAlbedo = () => {
    if (!bakedTextures) return;
    TerrainExporter.exportTexturePNG(
      bakedTextures.albedoData,
      bakedTextures.texSize,
      'terrain_albedo_pbr.png'
    );
    notifySuccess('Albedo Color Map');
  };

  const handleExportNormal = () => {
    if (!bakedTextures) return;
    TerrainExporter.exportTexturePNG(
      bakedTextures.normalData,
      bakedTextures.texSize,
      'terrain_normal_map.png'
    );
    notifySuccess('Normal Map');
  };

  const handleExportFlow = () => {
    const size = Math.round(Math.sqrt(terrainData.flowMask.length));
    TerrainExporter.exportMaskPNG(terrainData.flowMask, size, 'terrain_flow_mask.png');
    notifySuccess('Hydraulic Flow Mask');
  };

  const handleExportSediment = () => {
    const size = Math.round(Math.sqrt(terrainData.sedimentMask.length));
    TerrainExporter.exportMaskPNG(terrainData.sedimentMask, size, 'terrain_sediment_mask.png');
    notifySuccess('Alluvial Sediment Mask');
  };

  const handleExportOBJ = () => {
    const size = Math.round(Math.sqrt(terrainData.heightMap.length));
    TerrainExporter.exportOBJ(terrainData.heightMap, size, { step: objStep });
    notifySuccess(`3D OBJ Mesh (${size}x${size})`);
  };

  const handleExportProjectJSON = () => {
    TerrainExporter.exportProjectJSON(terrainLayers, textureLayers, {});
    notifySuccess('Project Configuration (.gaea.json)');
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <Layers size={18} className="modal-icon" />
            <h2>Bake & Export Geological Assets</h2>
          </div>
          <button className="icon-close-button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {downloadSuccess && (
          <div className="download-toast">
            <Check size={14} />
            <span>Downloaded <strong>{downloadSuccess}</strong> successfully.</span>
          </div>
        )}

        <div className="modal-body">
          {/* Section 1: Heightfield Maps */}
          <div className="export-section">
            <div className="section-label-modal">
              <Image size={14} />
              <span>HEIGHTMAP ELEVATION MAPS</span>
            </div>
            <div className="export-grid">
              <div className="export-card">
                <h4>16-Bit RAW / PNG Heightmap</h4>
                <p>High-precision uncompressed elevation for Unreal Engine 5 Landscape, Unity Terrain, and Blender Microdisplacement.</p>
                <button className="export-download-btn" onClick={handleExport16BitHeight}>
                  <Download size={13} /> Export 16-Bit PNG
                </button>
              </div>

              <div className="export-card">
                <h4>8-Bit Standard Heightmap</h4>
                <p>Standard grayscale heightmap for quick texturing or previewing in standard photo editors.</p>
                <button className="export-download-btn secondary" onClick={handleExport8BitHeight}>
                  <Download size={13} /> Export 8-Bit PNG
                </button>
              </div>
            </div>
          </div>

          {/* Section 2: PBR Texture Maps */}
          <div className="export-section">
            <div className="section-label-modal">
              <Sparkles size={14} />
              <span>PBR SURFACE TEXTURE MAPS</span>
            </div>
            <div className="export-grid">
              <div className="export-card">
                <h4>Albedo Diffuse Color</h4>
                <p>Full-resolution multi-layer biome color texture baked from slope, altitude, and erosion masks.</p>
                <button className="export-download-btn" onClick={handleExportAlbedo}>
                  <Download size={13} /> Export Albedo PNG
                </button>
              </div>

              <div className="export-card">
                <h4>Normal Map (Tangent/World)</h4>
                <p>High-frequency micro-crag bump and geological macro-slope normals for realistic PBR lighting.</p>
                <button className="export-download-btn" onClick={handleExportNormal}>
                  <Download size={13} /> Export Normal PNG
                </button>
              </div>
            </div>
          </div>

          {/* Section 3: Geological Erosion Masks */}
          <div className="export-section">
            <div className="section-label-modal">
              <Layers size={14} />
              <span>GEOLOGICAL EROSION MASKS</span>
            </div>
            <div className="export-grid">
              <div className="export-card">
                <h4>Hydraulic Flow Mask</h4>
                <p>Fluvial runoff channels and drainage gullies. Ideal for river splines and water splash particle spawners.</p>
                <button className="export-download-btn" onClick={handleExportFlow}>
                  <Download size={13} /> Export Flow Mask
                </button>
              </div>

              <div className="export-card">
                <h4>Alluvial Sediment Mask</h4>
                <p>Deposition fan zones where sand and pebbles settle in valleys. Great for gravel foliage scatter masks.</p>
                <button className="export-download-btn" onClick={handleExportSediment}>
                  <Download size={13} /> Export Sediment Mask
                </button>
              </div>
            </div>
          </div>

          {/* Section 4: 3D Mesh Geometry */}
          <div className="export-section">
            <div className="section-label-modal">
              <Box size={14} />
              <span>3D MESH MODEL (WAVEFRONT OBJ)</span>
            </div>
            <div className="export-card single-wide">
              <h4>Wavefront 3D OBJ Mesh</h4>
              <p>Ready to drop directly into Blender, Maya, 3ds Max, Cinema4D, or Unreal Engine with UV coordinates.</p>
              <div className="obj-controls-row">
                <label>
                  <span>Resolution Step:</span>
                  <select
                    value={objStep}
                    onChange={(e) => setObjStep(Number(e.target.value))}
                    className="frontier-select"
                  >
                    <option value={1}>1:1 Full Grid Resolution</option>
                    <option value={2}>1:2 Half Resolution (Optimized)</option>
                    <option value={4}>1:4 Quarter Resolution (Lightweight)</option>
                  </select>
                </label>
                <button className="export-download-btn" onClick={handleExportOBJ}>
                  <Download size={13} /> Export .OBJ Mesh
                </button>
              </div>
            </div>
          </div>

          {/* Section 5: Project Preset */}
          <div className="export-section">
            <div className="section-label-modal">
              <FileCode size={14} />
              <span>PROJECT PRESET</span>
            </div>
            <div className="export-card single-wide">
              <h4>Save Frontier Project File</h4>
              <p>Export layerstack settings, parameters, and biome rules as a reusable `.gaea.json` preset.</p>
              <button className="export-download-btn secondary" onClick={handleExportProjectJSON}>
                <Download size={13} /> Save Project JSON
              </button>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="action-button secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
