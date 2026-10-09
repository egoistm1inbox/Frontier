/**
 * Frontier Landscape Studio — icon registry.
 *
 * One mapping from layer / process identifiers to lucide artwork. Semantic
 * colour stays on the icons; the surfaces around them remain neutral graphite,
 * exactly as the reference editor does it.
 */

import {
  AlignJustify, Anchor, Aperture, ArrowUpDown, Blend, Brush, Camera, CloudRain,
  Compass, Contrast, Crosshair, Droplet, Eraser, Filter, Gauge, Globe, Grid3x3,
  Hammer, Hexagon, ImageUp, LandPlot, Layers, LifeBuoy, MapPinned, Minus,
  Mountain, MoveUpRight, Palette, Route, Ruler, Scan, Snowflake, Sparkles,
  Square, Sun, Thermometer, Trees, Triangle, Waves, Waypoints, Wind,
} from 'lucide-react';

export const LAYER_ICONS = {
  base: Square,
  noise: Mountain,
  cellular: Hexagon,
  island: LifeBuoy,
  cone: Triangle,
  terrace: AlignJustify,
  ramp: MoveUpRight,
  smooth: Droplet,
  sharpen: Sparkles,
  flatten: Minus,
  normalize: ArrowUpDown,
  erode: Waves,
  brush: Brush,
  import: ImageUp,
  splat: Palette,
  satmap: Globe,
};

export const EROSION_ICONS = {
  hydraulic: Droplet,
  rainfall: CloudRain,
  thermal: Thermometer,
  wind: Wind,
  glacial: Snowflake,
  coastal: Anchor,
};

export const VIEW_ICONS = {
  shaded: Sun,
  height: Mountain,
  slope: LandPlot,
  flow: Route,
  erosion: Filter,
  talus: Hammer,
  water: Waves,
  normal: Scan,
  aspect: Compass,
};

export const TOOL_ICONS = {
  grid: Grid3x3,
  contours: Waypoints,
  wire: Scan,
  water: Waves,
  sculpt: Brush,
  orbit: Camera,
  top: MapPinned,
  reset: Crosshair,
  blend: Blend,
  contrast: Contrast,
  aperture: Aperture,
  gauge: Gauge,
  eraser: Eraser,
  trees: Trees,
  ruler: Ruler,
  layers: Layers,
};

export function layerIcon(type) {
  return LAYER_ICONS[type] || Layers;
}

export function erosionIcon(type) {
  return EROSION_ICONS[type] || Droplet;
}
