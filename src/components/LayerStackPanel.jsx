import React, { useState } from 'react';
import {
  Mountain,
  Layers,
  Droplets,
  SlidersHorizontal,
  Wind,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
  Sun,
  Palette,
  Sparkles,
  Flame,
  Check,
  Compass
} from 'lucide-react';
import { TERRAIN_LAYER_TYPES } from '../engine/TerrainEngine.js';
import { TEXTURE_LAYER_TYPES } from '../engine/BiomeTexturing.js';

export function LayerStackPanel({
  activeTab,
  onTabChange,
  terrainLayers,
  onTerrainLayersChange,
  selectedTerrainLayerId,
  onSelectTerrainLayer,
  textureLayers,
  onTextureLayersChange,
  selectedTextureLayerId,
  onSelectTextureLayer
}) {
  const [showAddMenu, setShowAddMenu] = useState(false);

  // --- Terrain Layer Handlers ---
  const toggleTerrainEnabled = (id, e) => {
    e.stopPropagation();
    onTerrainLayersChange(
      terrainLayers.map((l) => (l.id === id ? { ...l, enabled: !l.enabled } : l))
    );
  };

  const moveTerrainLayer = (index, delta, e) => {
    e.stopPropagation();
    const newIdx = index + delta;
    if (newIdx < 0 || newIdx >= terrainLayers.length) return;
    const copy = [...terrainLayers];
    const [removed] = copy.splice(index, 1);
    copy.splice(newIdx, 0, removed);
    onTerrainLayersChange(copy);
  };

  const deleteTerrainLayer = (id, e) => {
    e.stopPropagation();
    if (terrainLayers.length <= 1) return;
    const filtered = terrainLayers.filter((l) => l.id !== id);
    onTerrainLayersChange(filtered);
    if (selectedTerrainLayerId === id) {
      onSelectTerrainLayer(filtered[0].id);
    }
  };

  const addTerrainLayer = (type) => {
    setShowAddMenu(false);
    const newId = `layer-${Date.now()}`;
    let newLayer = {
      id: newId,
      name: 'New Geological Layer',
      type,
      enabled: true,
      bypassed: false,
      blendMode: 'add',
      opacity: 0.75,
      params: {}
    };

    switch (type) {
      case TERRAIN_LAYER_TYPES.ALPINE_PEAKS:
        newLayer.name = 'Alpine Ridge Massif';
        newLayer.params = { seed: Math.floor(Math.random() * 9999), scale: 2.0, octaves: 6, sharpness: 2.2, altitude: 250 };
        break;
      case TERRAIN_LAYER_TYPES.SWISS_FBM:
        newLayer.name = 'Swiss Multi-Fractal';
        newLayer.params = { seed: Math.floor(Math.random() * 9999), scale: 2.5, octaves: 7, persistence: 0.5 };
        break;
      case TERRAIN_LAYER_TYPES.VORONOI_CRAGS:
        newLayer.name = 'Basalt Voronoi Crags';
        newLayer.params = { seed: Math.floor(Math.random() * 9999), scale: 3.2, jitter: 0.85 };
        break;
      case TERRAIN_LAYER_TYPES.HYDRAULIC_EROSION:
        newLayer.name = 'Hydraulic Gully Erosion';
        newLayer.params = { iterations: 50000, rainRate: 1.0, erodeSpeed: 0.35, depositSpeed: 0.35, inertia: 0.15, sedimentCapacity: 4.0 };
        break;
      case TERRAIN_LAYER_TYPES.THERMAL_TALUS:
        newLayer.name = 'Thermal Scree Talus';
        newLayer.params = { iterations: 12, reposeAngle: 38.0, talusRate: 0.5 };
        break;
      case TERRAIN_LAYER_TYPES.STRATA_TERRACES:
        newLayer.name = 'Sedimentary Terraces';
        newLayer.params = { frequency: 16, hardness: 0.7, warpModulation: 0.3 };
        break;
      case TERRAIN_LAYER_TYPES.DOMAIN_WARP:
        newLayer.name = 'Tectonic Domain Warp';
        newLayer.params = { strength: 1.5, frequency: 1.2 };
        break;
      default:
        newLayer.params = { scale: 2.0 };
    }

    onTerrainLayersChange([...terrainLayers, newLayer]);
    onSelectTerrainLayer(newId);
  };

  // --- Texture Layer Handlers ---
  const toggleTextureEnabled = (id, e) => {
    e.stopPropagation();
    onTextureLayersChange(
      textureLayers.map((l) => (l.id === id ? { ...l, enabled: !l.enabled } : l))
    );
  };

  const moveTextureLayer = (index, delta, e) => {
    e.stopPropagation();
    const newIdx = index + delta;
    if (newIdx < 0 || newIdx >= textureLayers.length) return;
    const copy = [...textureLayers];
    const [removed] = copy.splice(index, 1);
    copy.splice(newIdx, 0, removed);
    onTextureLayersChange(copy);
  };

  const deleteTextureLayer = (id, e) => {
    e.stopPropagation();
    if (textureLayers.length <= 1) return;
    const filtered = textureLayers.filter((l) => l.id !== id);
    onTextureLayersChange(filtered);
    if (selectedTextureLayerId === id) {
      onSelectTextureLayer(filtered[0].id);
    }
  };

  const getLayerIcon = (type) => {
    switch (type) {
      case TERRAIN_LAYER_TYPES.ALPINE_PEAKS:
      case TERRAIN_LAYER_TYPES.RIDGED_MULTIFRACTAL:
      case TERRAIN_LAYER_TYPES.PEAK_SHARPENER:
        return Mountain;
      case TERRAIN_LAYER_TYPES.HYDRAULIC_EROSION:
        return Droplets;
      case TERRAIN_LAYER_TYPES.THERMAL_TALUS:
        return SlidersHorizontal;
      case TERRAIN_LAYER_TYPES.STRATA_TERRACES:
        return Layers;
      case TERRAIN_LAYER_TYPES.DOMAIN_WARP:
        return Wind;
      case TERRAIN_LAYER_TYPES.VOLCANIC_CALDERA:
        return Flame;
      default:
        return Mountain;
    }
  };

  return (
    <div className="layer-stack-panel">
      {/* Top Navigation Tabs */}
      <div className="stack-tabs">
        <button
          className={`stack-tab ${activeTab === 'terrain' ? 'active' : ''}`}
          onClick={() => onTabChange('terrain')}
        >
          <Mountain size={13} />
          <span>Terrain Stack</span>
          <span className="tab-counter">{terrainLayers.length}</span>
        </button>
        <button
          className={`stack-tab ${activeTab === 'textures' ? 'active' : ''}`}
          onClick={() => onTabChange('textures')}
        >
          <Palette size={13} />
          <span>Texturing Stack</span>
          <span className="tab-counter">{textureLayers.length}</span>
        </button>
        <button
          className={`stack-tab ${activeTab === 'environment' ? 'active' : ''}`}
          onClick={() => onTabChange('environment')}
        >
          <Sun size={13} />
          <span>Atmosphere</span>
        </button>
      </div>

      {/* Terrain Layers List */}
      {activeTab === 'terrain' && (
        <div className="layer-list-container">
          <div className="layer-list-header">
            <div>
              <span className="section-title">GEOLOGICAL GENERATION</span>
              <span className="section-subtitle">Evaluated top-to-bottom</span>
            </div>
            <div className="relative-container">
              <button
                className="add-layer-button"
                onClick={() => setShowAddMenu(!showAddMenu)}
                title="Add Terrain Primitive or Geological Modifier"
              >
                <Plus size={14} />
                <span>Add Layer</span>
              </button>

              {showAddMenu && (
                <div className="add-menu-dropdown">
                  <div className="dropdown-category">PRIMITIVES</div>
                  <button onClick={() => addTerrainLayer(TERRAIN_LAYER_TYPES.ALPINE_PEAKS)}>
                    Alpine Massif Peaks
                  </button>
                  <button onClick={() => addTerrainLayer(TERRAIN_LAYER_TYPES.SWISS_FBM)}>
                    Swiss Multi-Fractal (fBm)
                  </button>
                  <button onClick={() => addTerrainLayer(TERRAIN_LAYER_TYPES.VORONOI_CRAGS)}>
                    Basalt Voronoi Crags
                  </button>
                  <button onClick={() => addTerrainLayer(TERRAIN_LAYER_TYPES.CANYON_FAULT)}>
                    Fault Line Canyon
                  </button>
                  <button onClick={() => addTerrainLayer(TERRAIN_LAYER_TYPES.VOLCANIC_CALDERA)}>
                    Volcanic Caldera
                  </button>
                  <button onClick={() => addTerrainLayer(TERRAIN_LAYER_TYPES.DESERT_DUNES)}>
                    Desert Wind Dunes
                  </button>

                  <div className="dropdown-category">GEOLOGICAL MODIFIERS</div>
                  <button onClick={() => addTerrainLayer(TERRAIN_LAYER_TYPES.HYDRAULIC_EROSION)}>
                    Hydraulic Fluvial Erosion
                  </button>
                  <button onClick={() => addTerrainLayer(TERRAIN_LAYER_TYPES.THERMAL_TALUS)}>
                    Thermal Scree & Talus
                  </button>
                  <button onClick={() => addTerrainLayer(TERRAIN_LAYER_TYPES.STRATA_TERRACES)}>
                    Sedimentary Strata Terraces
                  </button>
                  <button onClick={() => addTerrainLayer(TERRAIN_LAYER_TYPES.DOMAIN_WARP)}>
                    Tectonic Domain Warp
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="layer-rows">
            {terrainLayers.map((layer, index) => {
              const Icon = getLayerIcon(layer.type);
              const isSelected = selectedTerrainLayerId === layer.id;

              return (
                <div
                  key={layer.id}
                  className={`layer-row ${isSelected ? 'selected' : ''} ${!layer.enabled ? 'disabled' : ''}`}
                  onClick={() => onSelectTerrainLayer(layer.id)}
                >
                  {/* Visibility eye */}
                  <button
                    className={`visibility-toggle ${layer.enabled ? 'on' : 'off'}`}
                    onClick={(e) => toggleTerrainEnabled(layer.id, e)}
                    title={layer.enabled ? 'Mute Layer' : 'Enable Layer'}
                  >
                    {layer.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>

                  {/* Icon */}
                  <div className="layer-icon-wrapper">
                    <Icon size={14} className="layer-icon" />
                  </div>

                  {/* Name and Info */}
                  <div className="layer-text-info">
                    <span className="layer-name">{layer.name}</span>
                    <div className="layer-badges">
                      <span className="type-badge">{layer.blendMode}</span>
                      <span className="opacity-badge">{Math.round(layer.opacity * 100)}%</span>
                    </div>
                  </div>

                  {/* Reorder & Actions */}
                  <div className="layer-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      disabled={index === 0}
                      onClick={(e) => moveTerrainLayer(index, -1, e)}
                      title="Move Up"
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      disabled={index === terrainLayers.length - 1}
                      onClick={(e) => moveTerrainLayer(index, 1, e)}
                      title="Move Down"
                    >
                      <ChevronDown size={12} />
                    </button>
                    <button
                      onClick={(e) => deleteTerrainLayer(layer.id, e)}
                      title="Delete Layer"
                      className="delete-button"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Texture Layers List */}
      {activeTab === 'textures' && (
        <div className="layer-list-container">
          <div className="layer-list-header">
            <div>
              <span className="section-title">PBR BIOME TEXTURING</span>
              <span className="section-subtitle">Procedural rule-based shaders</span>
            </div>
          </div>

          <div className="layer-rows">
            {textureLayers.map((layer, index) => {
              const isSelected = selectedTextureLayerId === layer.id;

              return (
                <div
                  key={layer.id}
                  className={`layer-row ${isSelected ? 'selected' : ''} ${!layer.enabled ? 'disabled' : ''}`}
                  onClick={() => onSelectTextureLayer(layer.id)}
                >
                  <button
                    className={`visibility-toggle ${layer.enabled ? 'on' : 'off'}`}
                    onClick={(e) => toggleTextureEnabled(layer.id, e)}
                    title={layer.enabled ? 'Hide Material' : 'Show Material'}
                  >
                    {layer.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>

                  {/* Color Swatch */}
                  <div
                    className="texture-swatch"
                    style={{
                      background: `linear-gradient(135deg, ${layer.color1} 0%, ${layer.color2 || layer.color1} 100%)`
                    }}
                  />

                  {/* Name */}
                  <div className="layer-text-info">
                    <span className="layer-name">{layer.name}</span>
                    <div className="layer-badges">
                      <span className="type-badge">
                        Roughness {Math.round((layer.roughness ?? 0.8) * 100)}%
                      </span>
                      <span className="opacity-badge">{Math.round(layer.opacity * 100)}%</span>
                    </div>
                  </div>

                  {/* Reorder */}
                  <div className="layer-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      disabled={index === 0}
                      onClick={(e) => moveTextureLayer(index, -1, e)}
                      title="Move Up"
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      disabled={index === textureLayers.length - 1}
                      onClick={(e) => moveTextureLayer(index, 1, e)}
                      title="Move Down"
                    >
                      <ChevronDown size={12} />
                    </button>
                    <button
                      onClick={(e) => deleteTextureLayer(layer.id, e)}
                      title="Delete Material"
                      className="delete-button"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Environment tab notice */}
      {activeTab === 'environment' && (
        <div className="environment-quick-info">
          <div className="env-card-preview">
            <Sun size={28} className="env-icon" />
            <h3>Solar & Atmospheric Lighting</h3>
            <p>
              Tune Sun azimuth, elevation, daylight illuminance, Rayleigh molecular scattering, and
              water level in the Inspector to the right.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
