import React from 'react';
import {
  Mountain,
  Layers,
  Droplets,
  SlidersHorizontal,
  Wind,
  RotateCcw,
  Sun,
  Palette,
  Waves,
  Sparkles,
  MoveUpRight,
  ArrowUpRight,
  CloudFog,
  Check
} from 'lucide-react';
import { TERRAIN_LAYER_TYPES } from '../engine/TerrainEngine.js';
import { TEXTURE_LAYER_TYPES } from '../engine/BiomeTexturing.js';
import { SunGizmo } from './visualizers/SunGizmo.jsx';
import { TerrainContours } from './visualizers/TerrainContours.jsx';
import { RoughnessProfile } from './visualizers/RoughnessProfile.jsx';
import { ErosionChannels } from './visualizers/ErosionChannels.jsx';
import { SlopeGauge } from './visualizers/SlopeGauge.jsx';
import { StrataDiagram, MaskRamp } from './visualizers/StrataDiagram.jsx';

export function InspectorPanel({
  activeTab,
  selectedTerrainLayer,
  onUpdateTerrainLayer,
  selectedTextureLayer,
  onUpdateTextureLayer,
  sunAzimuth,
  onSunAzimuthChange,
  sunElevation,
  onSunElevationChange,
  sunIntensity,
  onSunIntensityChange,
  waterLevel,
  onWaterLevelChange,
  waterVisible,
  onToggleWater,
  terrainStats
}) {
  // --- Helper Slider Component (Frontier styling) ---
  const renderSlider = (label, value, min, max, step, unit, onChange, caption) => (
    <div className="inspector-slider-row">
      <div className="slider-label-row">
        <span className="slider-label">{label}</span>
        <span className="slider-value">
          {typeof value === 'number' ? (Number.isInteger(step) ? value : value.toFixed(step < 0.1 ? 2 : 1)) : value}
          <small className="slider-unit">{unit}</small>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="frontier-slider"
      />
      {caption && <span className="slider-caption">{caption}</span>}
    </div>
  );

  return (
    <div className="inspector-panel">
      {/* 1. TERRAIN LAYER INSPECTION */}
      {activeTab === 'terrain' && selectedTerrainLayer && (
        <div className="inspector-content">
          {/* Header */}
          <div className="inspector-header">
            <div className="header-eyebrow">GEOLOGICAL LAYER PROPERTIES</div>
            <div className="header-title-row">
              <input
                type="text"
                className="header-layer-title-input"
                value={selectedTerrainLayer.name}
                onChange={(e) => onUpdateTerrainLayer({ name: e.target.value })}
              />
              <button
                className={`enabled-pill ${selectedTerrainLayer.enabled ? 'active' : 'disabled'}`}
                onClick={() => onUpdateTerrainLayer({ enabled: !selectedTerrainLayer.enabled })}
              >
                <span className="pill-dot" />
                {selectedTerrainLayer.enabled ? 'ACTIVE' : 'MUTED'}
              </button>
            </div>
          </div>

          <div className="cards-grid">
            {/* Blend & Opacity Card */}
            <div className="frontier-card">
              <div className="card-header">
                <span><Layers size={14} /> Layer Compositing</span>
              </div>
              <div className="blend-mode-selector">
                <span className="slider-label">Blend Mode</span>
                <select
                  value={selectedTerrainLayer.blendMode}
                  onChange={(e) => onUpdateTerrainLayer({ blendMode: e.target.value })}
                  className="frontier-select"
                >
                  <option value="replace">Replace</option>
                  <option value="add">Add (Additive)</option>
                  <option value="max">Max (Peak Union)</option>
                  <option value="min">Min (Valley Cut)</option>
                  <option value="multiply">Multiply</option>
                  <option value="subtract">Subtract</option>
                </select>
              </div>
              {renderSlider(
                'Layer Opacity',
                selectedTerrainLayer.opacity,
                0,
                1,
                0.01,
                '×',
                (v) => onUpdateTerrainLayer({ opacity: v })
              )}
            </div>

            {/* Alpine Peaks Primitives */}
            {[
              TERRAIN_LAYER_TYPES.ALPINE_PEAKS,
              TERRAIN_LAYER_TYPES.RIDGED_MULTIFRACTAL
            ].includes(selectedTerrainLayer.type) && (
              <>
                <div className="frontier-card wide-card">
                  <div className="card-header">
                    <span><Mountain size={14} /> Elevation & Topography</span>
                    <span className="badge">Fractal Peaks</span>
                  </div>
                  <TerrainContours
                    altitude={selectedTerrainLayer.params.altitude ?? 280}
                    roughness={Math.round((selectedTerrainLayer.params.sharpness ?? 2) * 30)}
                    erosion={35}
                  />
                  {renderSlider(
                    'Peak Altitude',
                    selectedTerrainLayer.params.altitude ?? 280,
                    50,
                    500,
                    5,
                    'm',
                    (v) => onUpdateTerrainLayer({ params: { ...selectedTerrainLayer.params, altitude: v } }),
                    'Maximum peak vertical displacement'
                  )}
                  {renderSlider(
                    'Fractal Scale',
                    selectedTerrainLayer.params.scale ?? 1.8,
                    0.5,
                    5.0,
                    0.1,
                    '×',
                    (v) => onUpdateTerrainLayer({ params: { ...selectedTerrainLayer.params, scale: v } })
                  )}
                  {renderSlider(
                    'Ridge Sharpness',
                    selectedTerrainLayer.params.sharpness ?? 2.2,
                    1.0,
                    4.0,
                    0.1,
                    '',
                    (v) => onUpdateTerrainLayer({ params: { ...selectedTerrainLayer.params, sharpness: v } }),
                    'Arete knife-edge exponent'
                  )}
                </div>

                <div className="frontier-card">
                  <div className="card-header">
                    <span><SlidersHorizontal size={14} /> Multi-Fractal Octaves</span>
                  </div>
                  <RoughnessProfile roughness={(selectedTerrainLayer.params.octaves ?? 7) * 12} />
                  {renderSlider(
                    'Octave Detail',
                    selectedTerrainLayer.params.octaves ?? 7,
                    2,
                    10,
                    1,
                    'oct',
                    (v) => onUpdateTerrainLayer({ params: { ...selectedTerrainLayer.params, octaves: v } })
                  )}
                  {renderSlider(
                    'Lacunarity',
                    selectedTerrainLayer.params.lacunarity ?? 2.1,
                    1.5,
                    3.5,
                    0.1,
                    '',
                    (v) => onUpdateTerrainLayer({ params: { ...selectedTerrainLayer.params, lacunarity: v } })
                  )}
                  {renderSlider(
                    'Gain / Persistence',
                    selectedTerrainLayer.params.gain ?? 0.52,
                    0.2,
                    0.8,
                    0.02,
                    '',
                    (v) => onUpdateTerrainLayer({ params: { ...selectedTerrainLayer.params, gain: v } })
                  )}
                </div>
              </>
            )}

            {/* Hydraulic Fluvial Erosion */}
            {selectedTerrainLayer.type === TERRAIN_LAYER_TYPES.HYDRAULIC_EROSION && (
              <div className="frontier-card wide-card">
                <div className="card-header">
                  <span><Droplets size={14} /> Fluvial Drainage Channels</span>
                  <span className="badge">Physical Simulation</span>
                </div>
                <ErosionChannels erosion={Math.round((selectedTerrainLayer.params.erodeSpeed ?? 0.38) * 100)} />
                {renderSlider(
                  'Simulation Droplets',
                  selectedTerrainLayer.params.iterations ?? 65000,
                  10000,
                  150000,
                  5000,
                  ' drops',
                  (v) => onUpdateTerrainLayer({ params: { ...selectedTerrainLayer.params, iterations: v } }),
                  'Virtual kinetic rain particles simulated'
                )}
                {renderSlider(
                  'Bedrock Dissolution Rate',
                  selectedTerrainLayer.params.erodeSpeed ?? 0.38,
                  0.05,
                  0.8,
                  0.02,
                  '',
                  (v) => onUpdateTerrainLayer({ params: { ...selectedTerrainLayer.params, erodeSpeed: v } }),
                  'Speed at which water carves gullies into rock'
                )}
                {renderSlider(
                  'Sediment Deposition Rate',
                  selectedTerrainLayer.params.depositSpeed ?? 0.35,
                  0.05,
                  0.8,
                  0.02,
                  '',
                  (v) => onUpdateTerrainLayer({ params: { ...selectedTerrainLayer.params, depositSpeed: v } }),
                  'Speed at which carried silt forms alluvial plains'
                )}
                {renderSlider(
                  'Droplet Inertia / Momentum',
                  selectedTerrainLayer.params.inertia ?? 0.18,
                  0.02,
                  0.5,
                  0.02,
                  '',
                  (v) => onUpdateTerrainLayer({ params: { ...selectedTerrainLayer.params, inertia: v } }),
                  'Tendency for water to flow straight down valleys'
                )}
              </div>
            )}

            {/* Thermal Scree & Talus */}
            {selectedTerrainLayer.type === TERRAIN_LAYER_TYPES.THERMAL_TALUS && (
              <div className="frontier-card wide-card">
                <div className="card-header">
                  <span><SlidersHorizontal size={14} /> Angle of Repose & Scree</span>
                  <span className="badge">Rockfall Talus</span>
                </div>
                <SlopeGauge
                  angle={Math.round(selectedTerrainLayer.params.reposeAngle ?? 37)}
                  repose={Math.round(selectedTerrainLayer.params.reposeAngle ?? 37)}
                />
                {renderSlider(
                  'Critical Repose Angle',
                  selectedTerrainLayer.params.reposeAngle ?? 37.0,
                  25.0,
                  50.0,
                  1.0,
                  '°',
                  (v) => onUpdateTerrainLayer({ params: { ...selectedTerrainLayer.params, reposeAngle: v } }),
                  'Slope beyond which fractured rock slides down cliffs'
                )}
                {renderSlider(
                  'Talus Slump Rate',
                  selectedTerrainLayer.params.talusRate ?? 0.52,
                  0.1,
                  1.0,
                  0.05,
                  '',
                  (v) => onUpdateTerrainLayer({ params: { ...selectedTerrainLayer.params, talusRate: v } }),
                  'Volume of scree deposited at cliff bases'
                )}
                {renderSlider(
                  'Weathering Iterations',
                  selectedTerrainLayer.params.iterations ?? 14,
                  2,
                  30,
                  1,
                  ' passes',
                  (v) => onUpdateTerrainLayer({ params: { ...selectedTerrainLayer.params, iterations: v } })
                )}
              </div>
            )}

            {/* Sedimentary Strata Terraces */}
            {selectedTerrainLayer.type === TERRAIN_LAYER_TYPES.STRATA_TERRACES && (
              <div className="frontier-card wide-card">
                <div className="card-header">
                  <span><Layers size={14} /> Sedimentary Strata Banding</span>
                  <span className="badge">Grand Canyon Benches</span>
                </div>
                <StrataDiagram
                  frequency={selectedTerrainLayer.params.frequency ?? 18}
                  hardness={selectedTerrainLayer.params.hardness ?? 0.72}
                />
                {renderSlider(
                  'Strata Frequency',
                  selectedTerrainLayer.params.frequency ?? 18,
                  4,
                  40,
                  1,
                  ' bands',
                  (v) => onUpdateTerrainLayer({ params: { ...selectedTerrainLayer.params, frequency: v } }),
                  'Number of horizontal geological layers'
                )}
                {renderSlider(
                  'Terrace Step Hardness',
                  selectedTerrainLayer.params.hardness ?? 0.72,
                  0.1,
                  0.98,
                  0.02,
                  '',
                  (v) => onUpdateTerrainLayer({ params: { ...selectedTerrainLayer.params, hardness: v } }),
                  'Sharpness of limestone ledges vs soft shale'
                )}
                {renderSlider(
                  'Tectonic Warp Modulation',
                  selectedTerrainLayer.params.warpModulation ?? 0.35,
                  0.0,
                  1.0,
                  0.05,
                  '',
                  (v) => onUpdateTerrainLayer({ params: { ...selectedTerrainLayer.params, warpModulation: v } })
                )}
              </div>
            )}

            {/* Tectonic Domain Warp */}
            {selectedTerrainLayer.type === TERRAIN_LAYER_TYPES.DOMAIN_WARP && (
              <div className="frontier-card wide-card">
                <div className="card-header">
                  <span><Wind size={14} /> Tectonic Shear & Folding</span>
                  <span className="badge">Metamorphic Drift</span>
                </div>
                {renderSlider(
                  'Displacement Strength',
                  selectedTerrainLayer.params.strength ?? 1.4,
                  0.2,
                  3.5,
                  0.1,
                  '×',
                  (v) => onUpdateTerrainLayer({ params: { ...selectedTerrainLayer.params, strength: v } }),
                  'Magnitude of continental plate folding'
                )}
                {renderSlider(
                  'Fold Frequency',
                  selectedTerrainLayer.params.frequency ?? 1.2,
                  0.3,
                  3.0,
                  0.1,
                  '',
                  (v) => onUpdateTerrainLayer({ params: { ...selectedTerrainLayer.params, frequency: v } })
                )}
              </div>
            )}

            {/* Alluvial Valley Infill */}
            {selectedTerrainLayer.type === TERRAIN_LAYER_TYPES.SEDIMENT_INFILL && (
              <div className="frontier-card wide-card">
                <div className="card-header">
                  <span><Layers size={14} /> Valley Floor Infill</span>
                </div>
                {renderSlider(
                  'Water/Basin Threshold',
                  selectedTerrainLayer.params.waterLevelThreshold ?? 0.12,
                  0.02,
                  0.35,
                  0.01,
                  '',
                  (v) => onUpdateTerrainLayer({ params: { ...selectedTerrainLayer.params, waterLevelThreshold: v } }),
                  'Altitude below which silt fills flat basins'
                )}
                {renderSlider(
                  'Infill Softness',
                  selectedTerrainLayer.params.infillSoftness ?? 0.08,
                  0.01,
                  0.2,
                  0.01,
                  '',
                  (v) => onUpdateTerrainLayer({ params: { ...selectedTerrainLayer.params, infillSoftness: v } })
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. TEXTURE LAYER INSPECTION */}
      {activeTab === 'textures' && selectedTextureLayer && (
        <div className="inspector-content">
          <div className="inspector-header">
            <div className="header-eyebrow">PBR SURFACE MATERIAL RULES</div>
            <div className="header-title-row">
              <input
                type="text"
                className="header-layer-title-input"
                value={selectedTextureLayer.name}
                onChange={(e) => onUpdateTextureLayer({ name: e.target.value })}
              />
              <button
                className={`enabled-pill ${selectedTextureLayer.enabled ? 'active' : 'disabled'}`}
                onClick={() => onUpdateTextureLayer({ enabled: !selectedTextureLayer.enabled })}
              >
                <span className="pill-dot" />
                {selectedTextureLayer.enabled ? 'VISIBLE' : 'HIDDEN'}
              </button>
            </div>
          </div>

          <div className="cards-grid">
            {/* Color & Surface Material Card */}
            <div className="frontier-card">
              <div className="card-header">
                <span><Palette size={14} /> Surface Colors & PBR</span>
              </div>
              <div className="color-pickers-row">
                <div className="color-field">
                  <span className="color-label">Primary Tint</span>
                  <div className="color-input-wrapper">
                    <input
                      type="color"
                      value={selectedTextureLayer.color1}
                      onChange={(e) => onUpdateTextureLayer({ color1: e.target.value })}
                      className="frontier-color-picker"
                    />
                    <span className="color-hex">{selectedTextureLayer.color1}</span>
                  </div>
                </div>

                <div className="color-field">
                  <span className="color-label">Noise Variation</span>
                  <div className="color-input-wrapper">
                    <input
                      type="color"
                      value={selectedTextureLayer.color2 || selectedTextureLayer.color1}
                      onChange={(e) => onUpdateTextureLayer({ color2: e.target.value })}
                      className="frontier-color-picker"
                    />
                    <span className="color-hex">{selectedTextureLayer.color2 || selectedTextureLayer.color1}</span>
                  </div>
                </div>
              </div>

              {renderSlider(
                'Surface Roughness',
                Math.round((selectedTextureLayer.roughness ?? 0.8) * 100),
                0,
                100,
                1,
                '%',
                (v) => onUpdateTextureLayer({ roughness: v / 100 }),
                '0% = mirror wet shine, 100% = matte rock'
              )}

              {renderSlider(
                'Material Opacity',
                selectedTextureLayer.opacity ?? 1.0,
                0,
                1,
                0.01,
                '×',
                (v) => onUpdateTextureLayer({ opacity: v })
              )}
            </div>

            {/* Altitude Placement Mask */}
            <div className="frontier-card">
              <div className="card-header">
                <span><Mountain size={14} /> Altitude Placement Mask</span>
              </div>
              <MaskRamp
                min={selectedTextureLayer.rules.altMin}
                max={selectedTextureLayer.rules.altMax}
                falloff={selectedTextureLayer.rules.altFalloff}
                total={500}
                label="Altitude"
              />
              {renderSlider(
                'Min Elevation',
                selectedTextureLayer.rules.altMin,
                0,
                500,
                5,
                'm',
                (v) => onUpdateTextureLayer({ rules: { ...selectedTextureLayer.rules, altMin: v } })
              )}
              {renderSlider(
                'Max Elevation',
                selectedTextureLayer.rules.altMax,
                0,
                500,
                5,
                'm',
                (v) => onUpdateTextureLayer({ rules: { ...selectedTextureLayer.rules, altMax: v } })
              )}
              {renderSlider(
                'Altitude Transition Falloff',
                selectedTextureLayer.rules.altFalloff,
                2,
                80,
                2,
                'm',
                (v) => onUpdateTextureLayer({ rules: { ...selectedTextureLayer.rules, altFalloff: v } })
              )}
            </div>

            {/* Slope Placement Mask */}
            <div className="frontier-card">
              <div className="card-header">
                <span><SlidersHorizontal size={14} /> Slope Angle Mask</span>
              </div>
              <SlopeGauge
                angle={selectedTextureLayer.rules.slopeMin}
                repose={selectedTextureLayer.rules.slopeMax}
              />
              {renderSlider(
                'Min Slope Angle',
                selectedTextureLayer.rules.slopeMin,
                0,
                90,
                1,
                '°',
                (v) => onUpdateTextureLayer({ rules: { ...selectedTextureLayer.rules, slopeMin: v } }),
                '0° = flat valley, 90° = vertical cliff'
              )}
              {renderSlider(
                'Max Slope Angle',
                selectedTextureLayer.rules.slopeMax,
                0,
                90,
                1,
                '°',
                (v) => onUpdateTextureLayer({ rules: { ...selectedTextureLayer.rules, slopeMax: v } })
              )}
              {renderSlider(
                'Slope Falloff',
                selectedTextureLayer.rules.slopeFalloff,
                1,
                30,
                1,
                '°',
                (v) => onUpdateTextureLayer({ rules: { ...selectedTextureLayer.rules, slopeFalloff: v } })
              )}
            </div>

            {/* Geological Mask Weighting (Flow, Sediment, Talus) */}
            <div className="frontier-card">
              <div className="card-header">
                <span><Droplets size={14} /> Geological Mask Weighting</span>
              </div>
              {renderSlider(
                'Erosion Flow Mask Weight',
                selectedTextureLayer.rules.flowWeight,
                -1.0,
                1.0,
                0.05,
                '',
                (v) => onUpdateTextureLayer({ rules: { ...selectedTextureLayer.rules, flowWeight: v } }),
                'Positive: only in river gullies; Negative: only on dry ridges'
              )}
              {renderSlider(
                'Alluvial Sediment Weight',
                selectedTextureLayer.rules.sedimentWeight,
                -1.0,
                1.0,
                0.05,
                '',
                (v) => onUpdateTextureLayer({ rules: { ...selectedTextureLayer.rules, sedimentWeight: v } }),
                'Weights towards alluvial fan deposits'
              )}
              {renderSlider(
                'Talus Scree Weight',
                selectedTextureLayer.rules.talusWeight,
                -1.0,
                1.0,
                0.05,
                '',
                (v) => onUpdateTextureLayer({ rules: { ...selectedTextureLayer.rules, talusWeight: v } }),
                'Weights towards cliff rockfall talus'
              )}
              {renderSlider(
                'Organic Fractal Breakup',
                selectedTextureLayer.rules.noiseBreakup,
                0.0,
                1.0,
                0.05,
                '',
                (v) => onUpdateTextureLayer({ rules: { ...selectedTextureLayer.rules, noiseBreakup: v } }),
                'Adds natural fractal edges'
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. ENVIRONMENT & ATMOSPHERE INSPECTION */}
      {activeTab === 'environment' && (
        <div className="inspector-content">
          <div className="inspector-header">
            <div className="header-eyebrow">ATMOSPHERE & LIGHTING</div>
            <div className="header-title-row">
              <h2>Sun Orbit & Physical Sky</h2>
            </div>
          </div>

          <div className="cards-grid">
            {/* Sun Direction Gizmo */}
            <div className="frontier-card wide-card direction-card">
              <div className="card-header">
                <span><Sun size={14} /> Solar Direction & Orbit</span>
                <span className="metric">
                  {sunElevation}° <small>elevation</small>
                </span>
              </div>
              <SunGizmo
                azimuth={sunAzimuth}
                elevation={sunElevation}
                onChange={(az, el) => {
                  onSunAzimuthChange(az);
                  onSunElevationChange(el);
                }}
              />
              <div className="direction-controls">
                {renderSlider(
                  'Sun Azimuth',
                  sunAzimuth,
                  0,
                  360,
                  1,
                  '°',
                  onSunAzimuthChange,
                  'Horizontal compass bearing (0° N, 90° E, 180° S, 270° W)'
                )}
                {renderSlider(
                  'Sun Elevation',
                  sunElevation,
                  -10,
                  90,
                  1,
                  '°',
                  onSunElevationChange,
                  'Angle above horizon (sunset at 0°)'
                )}
              </div>
            </div>

            {/* Water Plane Controls */}
            <div className="frontier-card">
              <div className="card-header">
                <span><Waves size={14} /> Lake & Water Basin</span>
                <button
                  className={`enabled-pill ${waterVisible ? 'active' : 'disabled'}`}
                  onClick={onToggleWater}
                >
                  <span className="pill-dot" />
                  {waterVisible ? 'VISIBLE' : 'HIDDEN'}
                </button>
              </div>
              {renderSlider(
                'Water Level Datum',
                waterLevel,
                0,
                120,
                1,
                'm',
                onWaterLevelChange,
                'Elevation of the water surface plane'
              )}
            </div>

            {/* Terrain Geometry Stats */}
            {terrainStats && (
              <div className="frontier-card">
                <div className="card-header">
                  <span><Mountain size={14} /> Geological Metrics</span>
                </div>
                <div className="stats-grid">
                  <div className="stat-item">
                    <span className="stat-label">Peak Altitude</span>
                    <span className="stat-number">{terrainStats.maxAltitude} <small>m</small></span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Base Elevation</span>
                    <span className="stat-number">{terrainStats.minAltitude} <small>m</small></span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Average Slope</span>
                    <span className="stat-number">{terrainStats.avgSlope}°</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Mesh Polygons</span>
                    <span className="stat-number">{(terrainStats.triangleCount / 1000).toFixed(0)}k <small>tris</small></span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
