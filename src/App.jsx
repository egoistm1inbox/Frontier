import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TopHeader } from './components/TopHeader.jsx';
import { ViewportCanvas } from './components/ViewportCanvas.jsx';
import { LayerStackPanel } from './components/LayerStackPanel.jsx';
import { InspectorPanel } from './components/InspectorPanel.jsx';
import { ExportModal } from './modals/ExportModal.jsx';
import { TerrainEngine, TERRAIN_LAYER_TYPES } from './engine/TerrainEngine.js';
import { BiomeTexturingEngine, TEXTURE_LAYER_TYPES } from './engine/BiomeTexturing.js';
import { RENDER_MODES } from './engine/Viewport3D.js';
import './styles/frontier-theme.css';

export default function App() {
  const [resolution, setResolution] = useState(256);
  const [renderMode, setRenderMode] = useState(RENDER_MODES.PBR);
  const [wireframe, setWireframe] = useState(false);
  const [waterVisible, setWaterVisible] = useState(true);
  const [waterLevel, setWaterLevel] = useState(32);
  const [sunAzimuth, setSunAzimuth] = useState(135);
  const [sunElevation, setSunElevation] = useState(38);
  const [sunIntensity, setSunIntensity] = useState(110);
  const [cameraPreset, setCameraPreset] = useState('perspective');
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('terrain'); // 'terrain' | 'textures' | 'environment'
  const [projectName, setProjectName] = useState('Matterhorn_Alpine.gaea');

  // Layer Stacks
  const [terrainLayers, setTerrainLayers] = useState(() => TerrainEngine.getDefaultLayers());
  const [selectedTerrainLayerId, setSelectedTerrainLayerId] = useState(terrainLayers[0].id);

  const [textureLayers, setTextureLayers] = useState(() => BiomeTexturingEngine.getDefaultLayers());
  const [selectedTextureLayerId, setSelectedTextureLayerId] = useState(textureLayers[0].id);

  // Engine Instances
  const terrainEngineRef = useRef(null);
  const biomeEngineRef = useRef(null);

  if (!terrainEngineRef.current) {
    terrainEngineRef.current = new TerrainEngine(resolution);
  }
  if (!biomeEngineRef.current) {
    biomeEngineRef.current = new BiomeTexturingEngine(512);
  }

  // Generated Data
  const [terrainData, setTerrainData] = useState(null);
  const [bakedTextures, setBakedTextures] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Full Geological Generation Pipeline
  const runGeneration = useCallback((layers = terrainLayers, texLayers = textureLayers, res = resolution) => {
    setIsGenerating(true);
    const tEngine = terrainEngineRef.current;
    const bEngine = biomeEngineRef.current;

    tEngine.setSize(res);
    const data = tEngine.generate(layers);
    const tex = bEngine.bakeTextures(data, texLayers, Math.min(1024, res * 2));

    setTerrainData(data);
    setBakedTextures(tex);
    setIsGenerating(false);
  }, [terrainLayers, textureLayers, resolution]);

  // Texture-only fast rebake
  const rebakeTexturesOnly = useCallback((texLayers = textureLayers) => {
    if (!terrainData) return;
    const bEngine = biomeEngineRef.current;
    const tex = bEngine.bakeTextures(terrainData, texLayers, Math.min(1024, resolution * 2));
    setBakedTextures(tex);
  }, [terrainData, textureLayers, resolution]);

  // Initial load
  useEffect(() => {
    runGeneration();
  }, []);

  // Update when resolution changes
  const handleResolutionChange = (newRes) => {
    setResolution(newRes);
    runGeneration(terrainLayers, textureLayers, newRes);
  };

  // Terrain Layer updates
  const handleTerrainLayersChange = (newLayers) => {
    setTerrainLayers(newLayers);
    runGeneration(newLayers, textureLayers, resolution);
  };

  const handleUpdateSelectedTerrainLayer = (partial) => {
    const updated = terrainLayers.map((l) =>
      l.id === selectedTerrainLayerId ? { ...l, ...partial } : l
    );
    setTerrainLayers(updated);
    runGeneration(updated, textureLayers, resolution);
  };

  // Texture Layer updates
  const handleTextureLayersChange = (newTexLayers) => {
    setTextureLayers(newTexLayers);
    rebakeTexturesOnly(newTexLayers);
  };

  const handleUpdateSelectedTextureLayer = (partial) => {
    const updated = textureLayers.map((l) =>
      l.id === selectedTextureLayerId ? { ...l, ...partial } : l
    );
    setTextureLayers(updated);
    rebakeTexturesOnly(updated);
  };

  // Re-seed action
  const handleRegenerate = () => {
    const updated = terrainLayers.map((l) => {
      if (l.params && typeof l.params.seed !== 'undefined') {
        return { ...l, params: { ...l.params, seed: Math.floor(Math.random() * 99999) } };
      }
      return l;
    });
    setTerrainLayers(updated);
    runGeneration(updated, textureLayers, resolution);
  };

  // Incremental +50k hydraulic erosion simulation step
  const handleRunErosionStep = () => {
    if (!terrainData) return;
    const tEngine = terrainEngineRef.current;
    const res = tEngine.hydraulic.simulate(terrainData.heightMap, resolution, {
      iterations: 50000,
      erodeSpeed: 0.38,
      depositSpeed: 0.35,
      inertia: 0.18,
      sedimentCapacityFactor: 4.5
    });

    const analyzed = tEngine.analyzeTerrain(res.heightMap, resolution);
    const updatedData = {
      ...terrainData,
      heightMap: res.heightMap,
      flowMask: res.flowMask,
      sedimentMask: res.sedimentMask,
      normalMap: analyzed.normalMap,
      slopeMap: analyzed.slopeMap,
      curvatureMap: analyzed.curvatureMap,
      stats: analyzed.stats
    };

    const tex = biomeEngineRef.current.bakeTextures(updatedData, textureLayers, Math.min(1024, resolution * 2));
    setTerrainData(updatedData);
    setBakedTextures(tex);
  };

  // Preset Switcher
  const handleSelectPreset = (presetId) => {
    let newTerrain = [];
    let newTextures = [...textureLayers];
    let newProjectName = '';
    let newWaterLevel = 32;

    switch (presetId) {
      case 'matterhorn':
        newProjectName = 'Matterhorn_Alpine.gaea';
        newTerrain = TerrainEngine.getDefaultLayers();
        newWaterLevel = 28;
        break;

      case 'grandcanyon':
        newProjectName = 'Grand_Canyon_Strata.gaea';
        newTerrain = [
          {
            id: 'canyon-base',
            name: 'Plateau Canyon Fault',
            type: TERRAIN_LAYER_TYPES.CANYON_FAULT,
            enabled: true,
            blendMode: 'replace',
            opacity: 1.0,
            params: { seed: 712, scale: 1.6, canyonDepth: 0.75, meander: 1.8 }
          },
          {
            id: 'canyon-strata',
            name: 'Sedimentary Strata Benches',
            type: TERRAIN_LAYER_TYPES.STRATA_TERRACES,
            enabled: true,
            blendMode: 'replace',
            opacity: 0.78,
            params: { frequency: 28, hardness: 0.88, warpModulation: 0.25 }
          },
          {
            id: 'canyon-erosion',
            name: 'Gully Runoff Erosion',
            type: TERRAIN_LAYER_TYPES.HYDRAULIC_EROSION,
            enabled: true,
            blendMode: 'replace',
            opacity: 0.85,
            params: { iterations: 60000, erodeSpeed: 0.42, depositSpeed: 0.32, inertia: 0.2 }
          },
          {
            id: 'canyon-talus',
            name: 'Sandstone Scree Slopes',
            type: TERRAIN_LAYER_TYPES.THERMAL_TALUS,
            enabled: true,
            blendMode: 'replace',
            opacity: 0.9,
            params: { iterations: 16, reposeAngle: 36.0, talusRate: 0.58 }
          }
        ];
        newTextures = [
          {
            id: 'canyon-red-rock',
            name: 'Red Terracotta Sandstone',
            type: TEXTURE_LAYER_TYPES.GRANITE_CLIFF,
            enabled: true,
            opacity: 1.0,
            color1: '#84422e',
            color2: '#a0533c',
            roughness: 0.88,
            rules: { altMin: 0, altMax: 500, altFalloff: 20, slopeMin: 32, slopeMax: 90, slopeFalloff: 8, flowWeight: 0, sedimentWeight: 0, talusWeight: 0, cavityWeight: 0, noiseBreakup: 0.3 }
          },
          {
            id: 'canyon-limestone',
            name: 'Buff Kaibab Limestone',
            type: TEXTURE_LAYER_TYPES.GRANITE_CLIFF,
            enabled: true,
            opacity: 0.85,
            color1: '#c9b48c',
            color2: '#b89f74',
            roughness: 0.82,
            rules: { altMin: 220, altMax: 500, altFalloff: 30, slopeMin: 0, slopeMax: 90, slopeFalloff: 10, flowWeight: 0, sedimentWeight: 0, talusWeight: 0, cavityWeight: 0, noiseBreakup: 0.4 }
          },
          {
            id: 'canyon-sand',
            name: 'River Colorado Sand',
            type: TEXTURE_LAYER_TYPES.ALLUVIAL_SAND,
            enabled: true,
            opacity: 0.95,
            color1: '#a68962',
            color2: '#8b6f49',
            roughness: 0.7,
            rules: { altMin: 0, altMax: 110, altFalloff: 15, slopeMin: 0, slopeMax: 20, slopeFalloff: 5, flowWeight: 0.5, sedimentWeight: 0.9, talusWeight: 0, cavityWeight: 0.3, noiseBreakup: 0.2 }
          }
        ];
        newWaterLevel = 18;
        break;

      case 'volcano':
        newProjectName = 'Volcanic_Caldera.gaea';
        newTerrain = [
          {
            id: 'volcano-cone',
            name: 'Caldera Crater Rim',
            type: TERRAIN_LAYER_TYPES.VOLCANIC_CALDERA,
            enabled: true,
            blendMode: 'replace',
            opacity: 1.0,
            params: { seed: 909, craterRadius: 0.38, rimHeight: 0.92, floorDepth: 0.22 }
          },
          {
            id: 'volcano-basalt',
            name: 'Basalt Voronoi Fracture',
            type: TERRAIN_LAYER_TYPES.VORONOI_CRAGS,
            enabled: true,
            blendMode: 'add',
            opacity: 0.45,
            params: { seed: 442, scale: 4.5, jitter: 0.9 }
          },
          {
            id: 'volcano-talus',
            name: 'Cinder Slump Talus',
            type: TERRAIN_LAYER_TYPES.THERMAL_TALUS,
            enabled: true,
            blendMode: 'replace',
            opacity: 0.85,
            params: { iterations: 14, reposeAngle: 34.0, talusRate: 0.5 }
          }
        ];
        newTextures = [
          {
            id: 'volc-obsidian',
            name: 'Dark Basalt & Ash',
            type: TEXTURE_LAYER_TYPES.GRANITE_CLIFF,
            enabled: true,
            opacity: 1.0,
            color1: '#232326',
            color2: '#303036',
            roughness: 0.78,
            rules: { altMin: 0, altMax: 500, altFalloff: 20, slopeMin: 25, slopeMax: 90, slopeFalloff: 10, flowWeight: 0, sedimentWeight: 0, talusWeight: 0, cavityWeight: 0, noiseBreakup: 0.3 }
          },
          {
            id: 'volc-moss',
            name: 'Icelandic Cinder Moss',
            type: TEXTURE_LAYER_TYPES.ALPINE_MOSS,
            enabled: true,
            opacity: 0.85,
            color1: '#4a5932',
            color2: '#687e3f',
            roughness: 0.85,
            rules: { altMin: 30, altMax: 260, altFalloff: 30, slopeMin: 0, slopeMax: 35, slopeFalloff: 8, flowWeight: 0, sedimentWeight: 0, talusWeight: 0, cavityWeight: 0.4, noiseBreakup: 0.45 }
          }
        ];
        newWaterLevel = 58; // Lake in caldera
        break;

      case 'icelandic':
        newProjectName = 'Icelandic_Highlands.gaea';
        newTerrain = [
          {
            id: 'ice-swiss',
            name: 'Swiss Glacial Uplift',
            type: TERRAIN_LAYER_TYPES.SWISS_FBM,
            enabled: true,
            blendMode: 'replace',
            opacity: 1.0,
            params: { seed: 888, scale: 2.2, octaves: 7, persistence: 0.52 }
          },
          {
            id: 'ice-warp',
            name: 'Glacial Flow Distortion',
            type: TERRAIN_LAYER_TYPES.DOMAIN_WARP,
            enabled: true,
            blendMode: 'replace',
            opacity: 0.9,
            params: { strength: 1.8, frequency: 1.4 }
          },
          {
            id: 'ice-erosion',
            name: 'Meltwater Fluvial Gorges',
            type: TERRAIN_LAYER_TYPES.HYDRAULIC_EROSION,
            enabled: true,
            blendMode: 'replace',
            opacity: 0.95,
            params: { iterations: 75000, erodeSpeed: 0.44, depositSpeed: 0.38, inertia: 0.22 }
          }
        ];
        newWaterLevel = 36;
        break;

      case 'dunes':
        newProjectName = 'Sahara_Dune_Sea.gaea';
        newTerrain = [
          {
            id: 'dune-wind',
            name: 'Transverse Wind Dunes',
            type: TERRAIN_LAYER_TYPES.DESERT_DUNES,
            enabled: true,
            blendMode: 'replace',
            opacity: 1.0,
            params: { seed: 555, scale: 3.5, waveAngle: 40.0, asymmetry: 0.78 }
          },
          {
            id: 'dune-warp',
            name: 'Wind Gust Warp',
            type: TERRAIN_LAYER_TYPES.DOMAIN_WARP,
            enabled: true,
            blendMode: 'replace',
            opacity: 0.4,
            params: { strength: 0.8, frequency: 1.0 }
          }
        ];
        newTextures = [
          {
            id: 'dune-sand-main',
            name: 'Sahara Golden Sand',
            type: TEXTURE_LAYER_TYPES.ALLUVIAL_SAND,
            enabled: true,
            opacity: 1.0,
            color1: '#c4995c',
            color2: '#d8af6f',
            roughness: 0.68,
            rules: { altMin: 0, altMax: 500, altFalloff: 20, slopeMin: 0, slopeMax: 90, slopeFalloff: 10, flowWeight: 0, sedimentWeight: 0, talusWeight: 0, cavityWeight: 0, noiseBreakup: 0.2 }
          }
        ];
        newWaterLevel = 0;
        setWaterVisible(false);
        break;

      case 'fjord':
        newProjectName = 'Nordic_Fjord_Glacial.gaea';
        newTerrain = [
          {
            id: 'fjord-peaks',
            name: 'Alpine Glacial Massif',
            type: TERRAIN_LAYER_TYPES.ALPINE_PEAKS,
            enabled: true,
            blendMode: 'replace',
            opacity: 1.0,
            params: { seed: 1234, scale: 1.6, octaves: 8, sharpness: 2.3, altitude: 320 }
          },
          {
            id: 'fjord-erosion',
            name: 'Torrential Glacial Runoff',
            type: TERRAIN_LAYER_TYPES.HYDRAULIC_EROSION,
            enabled: true,
            blendMode: 'replace',
            opacity: 0.9,
            params: { iterations: 80000, erodeSpeed: 0.4, depositSpeed: 0.35, inertia: 0.18 }
          },
          {
            id: 'fjord-talus',
            name: 'Fjord Cliff Rockfall',
            type: TERRAIN_LAYER_TYPES.THERMAL_TALUS,
            enabled: true,
            blendMode: 'replace',
            opacity: 0.8,
            params: { iterations: 14, reposeAngle: 42.0, talusRate: 0.48 }
          }
        ];
        newWaterLevel = 45;
        setWaterVisible(true);
        break;

      default:
        break;
    }

    setProjectName(newProjectName);
    setTerrainLayers(newTerrain);
    setSelectedTerrainLayerId(newTerrain[0].id);
    setTextureLayers(newTextures);
    setSelectedTextureLayerId(newTextures[0].id);
    setWaterLevel(newWaterLevel);

    runGeneration(newTerrain, newTextures, resolution);
  };

  const selectedTerrainLayer = terrainLayers.find((l) => l.id === selectedTerrainLayerId);
  const selectedTextureLayer = textureLayers.find((l) => l.id === selectedTextureLayerId);

  return (
    <div className="app-container">
      {/* Top Header */}
      <TopHeader
        projectName={projectName}
        resolution={resolution}
        onResolutionChange={handleResolutionChange}
        renderMode={renderMode}
        onRenderModeChange={setRenderMode}
        wireframe={wireframe}
        onToggleWireframe={() => setWireframe(!wireframe)}
        waterVisible={waterVisible}
        onToggleWater={() => setWaterVisible(!waterVisible)}
        onRegenerate={handleRegenerate}
        onRunErosionStep={handleRunErosionStep}
        onOpenExport={() => setExportModalOpen(true)}
        onSelectPreset={handleSelectPreset}
        cameraPreset={cameraPreset}
        onCameraPresetChange={setCameraPreset}
        isWebGPU={true}
      />

      {/* Main Workspace */}
      <main className="main-workspace">
        {/* Viewport (Center / Left) */}
        <ViewportCanvas
          terrainData={terrainData}
          bakedTextures={bakedTextures}
          renderMode={renderMode}
          wireframe={wireframe}
          waterVisible={waterVisible}
          waterLevel={waterLevel}
          sunAzimuth={sunAzimuth}
          sunElevation={sunElevation}
          cameraPreset={cameraPreset}
          onCameraPresetChange={setCameraPreset}
          isWebGPU={true}
        />

        {/* Right Sidebar Dock: LayerStack (Left) + Inspector (Right) */}
        <div className="right-sidebar-dock">
          {/* Column A: LayerStack */}
          <LayerStackPanel
            activeTab={activeTab}
            onTabChange={setActiveTab}
            terrainLayers={terrainLayers}
            onTerrainLayersChange={handleTerrainLayersChange}
            selectedTerrainLayerId={selectedTerrainLayerId}
            onSelectTerrainLayer={setSelectedTerrainLayerId}
            textureLayers={textureLayers}
            onTextureLayersChange={handleTextureLayersChange}
            selectedTextureLayerId={selectedTextureLayerId}
            onSelectTextureLayer={setSelectedTextureLayerId}
          />

          {/* Column B: Inspector */}
          <InspectorPanel
            activeTab={activeTab}
            selectedTerrainLayer={selectedTerrainLayer}
            onUpdateTerrainLayer={handleUpdateSelectedTerrainLayer}
            selectedTextureLayer={selectedTextureLayer}
            onUpdateTextureLayer={handleUpdateSelectedTextureLayer}
            sunAzimuth={sunAzimuth}
            onSunAzimuthChange={setSunAzimuth}
            sunElevation={sunElevation}
            onSunElevationChange={setSunElevation}
            sunIntensity={sunIntensity}
            onSunIntensityChange={setSunIntensity}
            waterLevel={waterLevel}
            onWaterLevelChange={setWaterLevel}
            waterVisible={waterVisible}
            onToggleWater={() => setWaterVisible(!waterVisible)}
            terrainStats={terrainData ? terrainData.stats : null}
          />
        </div>
      </main>

      {/* Export Asset Modal */}
      <ExportModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        terrainData={terrainData}
        bakedTextures={bakedTextures}
        terrainLayers={terrainLayers}
        textureLayers={textureLayers}
      />
    </div>
  );
}
