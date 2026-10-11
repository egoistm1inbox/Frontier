import React, { useEffect, useRef, useState } from 'react';
import {
  Compass,
  RotateCcw,
  AlertCircle
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
  const [initError, setInitError] = useState(null);

  // Initialize Viewport3D on mount
  useEffect(() => {
    if (!canvasRef.current) return;

    try {
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
    } catch (err) {
      console.error('Viewport initialization error:', err);
      setInitError(err.message);
    }
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

      {initError && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: 'rgba(28, 28, 32, 0.95)',
          padding: '20px 24px',
          borderRadius: '12px',
          border: '1px solid #e06c75',
          color: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          maxWidth: '400px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#e06c75' }}>
            <AlertCircle size={18} />
            <strong>Viewport Error</strong>
          </div>
          <p style={{ fontSize: '11px', color: '#a0a0a8', margin: 0 }}>{initError}</p>
        </div>
      )}

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
