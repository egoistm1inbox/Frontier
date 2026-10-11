import React, { useEffect, useRef } from 'react';
import {
  Compass,
  Maximize2,
  RotateCcw,
  Eye,
  Camera,
  Layers,
  Sparkles
} from 'lucide-react';
import { Viewport3D, RENDER_MODES } from '../engine/Viewport3D.js';

export function ViewportCanvas({
  terrainData,
  bakedTextures,
  renderMode,
  wireframe,
  waterVisible,
  waterLevel,
  sunAzimuth,
  sunElevation,
  cameraPreset,
  onCameraPresetChange,
  isWebGPU
}) {
  const canvasRef = useRef(null);
  const viewportRef = useRef(null);

  // Initialize Viewport3D on mount
  useEffect(() => {
    if (!canvasRef.current) return;

    const vp = new Viewport3D(canvasRef.current);
    viewportRef.current = vp;

    // Handle window resize
    const handleResize = () => {
      if (!canvasRef.current || !viewportRef.current) return;
      const width = canvasRef.current.clientWidth;
      const height = canvasRef.current.clientHeight;
      viewportRef.current.resize(width, height);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(canvasRef.current);

    return () => {
      resizeObserver.disconnect();
      vp.dispose();
      viewportRef.current = null;
    };
  }, []);

  // Update terrain mesh when data or textures change
  useEffect(() => {
    if (viewportRef.current && terrainData && bakedTextures) {
      viewportRef.current.updateTerrain(terrainData, bakedTextures);
    }
  }, [terrainData, bakedTextures]);

  // Update render mode
  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.setRenderMode(renderMode);
    }
  }, [renderMode]);

  // Update wireframe
  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.setWireframe(wireframe);
    }
  }, [wireframe]);

  // Update water
  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.setWaterLevel(waterLevel);
      viewportRef.current.setWaterVisible(waterVisible);
    }
  }, [waterLevel, waterVisible]);

  // Update sun lighting
  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.setSunAzimuth(sunAzimuth);
      viewportRef.current.setSunElevation(sunElevation);
    }
  }, [sunAzimuth, sunElevation]);

  // Update camera preset
  useEffect(() => {
    if (viewportRef.current && cameraPreset) {
      viewportRef.current.setCameraPreset(cameraPreset);
    }
  }, [cameraPreset]);

  const handleResetCamera = () => {
    if (viewportRef.current) {
      viewportRef.current.setCameraPreset('perspective');
      if (onCameraPresetChange) onCameraPresetChange('perspective');
    }
  };

  return (
    <div className="viewport-container">
      <canvas ref={canvasRef} className="viewport-canvas" />

      {/* Floating HUD Top-Left */}
      <div className="viewport-hud">
        <div className="hud-pill">
          <Compass size={12} style={{ transform: `rotate(${sunAzimuth}deg)` }} />
          <span>SUN AZIMUTH: <strong>{sunAzimuth}°</strong></span>
        </div>
        <div className="hud-pill">
          <span>MODE: <strong style={{ textTransform: 'uppercase' }}>{renderMode}</strong></span>
        </div>
        {terrainData && terrainData.stats && (
          <div className="hud-pill">
            <span>PEAK: <strong>{terrainData.stats.maxAltitude}m</strong></span>
            <span>·</span>
            <span>MEAN SLOPE: <strong>{terrainData.stats.avgSlope}°</strong></span>
          </div>
        )}
      </div>

      {/* Floating Controls Bottom-Right */}
      <div className="hud-bottom-right">
        <button className="hud-button" onClick={handleResetCamera} title="Reset Camera View">
          <RotateCcw size={11} />
          <span>Reset Camera</span>
        </button>
      </div>
    </div>
  );
}
