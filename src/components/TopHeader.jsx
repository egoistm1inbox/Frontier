import React from 'react';
import {
  Layers,
  Sparkles,
  Download,
  RotateCcw,
  Droplets,
  Eye,
  Camera,
  Maximize2,
  Cpu,
  Mountain,
  Grid,
  Waves
} from 'lucide-react';
import { RENDER_MODES } from '../engine/Viewport3D.js';

export function TopHeader({
  projectName = 'Matterhorn_Alpine.gaea',
  resolution,
  onResolutionChange,
  renderMode,
  onRenderModeChange,
  wireframe,
  onToggleWireframe,
  waterVisible,
  onToggleWater,
  onRegenerate,
  onRunErosionStep,
  onOpenExport,
  onSelectPreset,
  cameraPreset,
  onCameraPresetChange,
  isWebGPU = true
}) {
  const presets = [
    { id: 'matterhorn', name: 'Matterhorn Alpine Massif' },
    { id: 'grandcanyon', name: 'Grand Canyon Terraces' },
    { id: 'volcano', name: 'Volcanic Caldera & Basalt' },
    { id: 'icelandic', name: 'Icelandic Highlands & Moss' },
    { id: 'dunes', name: 'Desert Mesa & Dunes' },
    { id: 'fjord', name: 'Fjord Glacial Valley' }
  ];

  return (
    <header className="top-header">
      {/* Brand & Project Info */}
      <div className="header-left">
        <div className="brand-badge">
          <Layers size={18} className="brand-icon" />
          <div className="brand-text">
            <span className="brand-title">frontier<span className="brand-dot">.</span></span>
            <span className="brand-sub">GAEA TERRAIN ENGINE</span>
          </div>
        </div>

        <div className="header-divider" />

        <div className="project-tag">
          <span className="project-name">{projectName}</span>
          <span className="engine-status-badge">
            <Cpu size={11} />
            {isWebGPU ? 'WEBGPU ACCELERATED' : 'WEBGL2 FALLBACK'}
          </span>
        </div>
      </div>

      {/* Middle: Render Mode Toggles */}
      <div className="header-center">
        <div className="render-mode-group" role="tablist">
          <button
            className={`render-mode-tab ${renderMode === RENDER_MODES.PBR ? 'active' : ''}`}
            onClick={() => onRenderModeChange(RENDER_MODES.PBR)}
            title="PBR Photorealistic Lit View"
          >
            PBR Lit
          </button>
          <button
            className={`render-mode-tab ${renderMode === RENDER_MODES.CLAY ? 'active' : ''}`}
            onClick={() => onRenderModeChange(RENDER_MODES.CLAY)}
            title="Sculptor Clay Mode"
          >
            Clay
          </button>
          <button
            className={`render-mode-tab ${renderMode === RENDER_MODES.HEIGHTMAP ? 'active' : ''}`}
            onClick={() => onRenderModeChange(RENDER_MODES.HEIGHTMAP)}
            title="Raw Elevation Heightmap"
          >
            Height
          </button>
          <button
            className={`render-mode-tab ${renderMode === RENDER_MODES.FLOW ? 'active' : ''}`}
            onClick={() => onRenderModeChange(RENDER_MODES.FLOW)}
            title="Hydraulic Fluvial Flow Mask"
          >
            <Droplets size={12} /> Flow
          </button>
          <button
            className={`render-mode-tab ${renderMode === RENDER_MODES.SEDIMENT ? 'active' : ''}`}
            onClick={() => onRenderModeChange(RENDER_MODES.SEDIMENT)}
            title="Alluvial Sediment Fan Mask"
          >
            Sediment
          </button>
          <button
            className={`render-mode-tab ${renderMode === RENDER_MODES.SLOPE ? 'active' : ''}`}
            onClick={() => onRenderModeChange(RENDER_MODES.SLOPE)}
            title="Slope Angle Distribution"
          >
            Slope
          </button>
        </div>

        {/* Viewport Toggles */}
        <div className="viewport-toggle-buttons">
          <button
            className={`tool-button ${wireframe ? 'active' : ''}`}
            onClick={onToggleWireframe}
            title="Toggle Wireframe Overlay"
          >
            <Grid size={14} />
          </button>
          <button
            className={`tool-button ${waterVisible ? 'active' : ''}`}
            onClick={onToggleWater}
            title="Toggle Water Surface"
          >
            <Waves size={14} />
          </button>
        </div>
      </div>

      {/* Right: Actions, Presets, Export */}
      <div className="header-right">
        {/* Preset Selector */}
        <select
          className="header-select preset-select"
          onChange={(e) => onSelectPreset(e.target.value)}
          defaultValue="matterhorn"
          title="Geological Terrain Presets"
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        {/* Resolution selector */}
        <select
          className="header-select resolution-select"
          value={resolution}
          onChange={(e) => onResolutionChange(Number(e.target.value))}
          title="Simulation Grid Resolution"
        >
          <option value={256}>256² Preview</option>
          <option value={512}>512² HD</option>
          <option value={1024}>1024² Ultra</option>
        </select>

        {/* Camera Views */}
        <div className="camera-view-group">
          <button
            className={`tool-button ${cameraPreset === 'perspective' ? 'active' : ''}`}
            onClick={() => onCameraPresetChange('perspective')}
            title="Perspective View"
          >
            <Camera size={13} />
          </button>
          <button
            className={`tool-button ${cameraPreset === 'topdown' ? 'active' : ''}`}
            onClick={() => onCameraPresetChange('topdown')}
            title="Top-Down Orthographic"
          >
            Top
          </button>
          <button
            className={`tool-button ${cameraPreset === 'cinematic' ? 'active' : ''}`}
            onClick={() => onCameraPresetChange('cinematic')}
            title="Cinematic Low-Angle View"
          >
            Cine
          </button>
        </div>

        {/* Erosion Iteration Action */}
        <button
          className="action-button secondary"
          onClick={onRunErosionStep}
          title="Simulate 50,000 Additional Hydraulic Droplets"
        >
          <Droplets size={13} />
          <span>+50k Rain</span>
        </button>

        {/* Re-generate */}
        <button
          className="action-button secondary"
          onClick={onRegenerate}
          title="Re-evaluate Geological Stack"
        >
          <RotateCcw size={13} />
          <span>Re-Seed</span>
        </button>

        {/* Export Modal trigger */}
        <button
          className="action-button primary"
          onClick={onOpenExport}
          title="Export 16-bit Heightmap, Textures, and 3D OBJ"
        >
          <Download size={13} />
          <span>Bake & Export</span>
        </button>
      </div>
    </header>
  );
}
