// Frontier VFX — engine-side loader (Three.js).
// Loads a `frontier-vfx/1` JSON (exported from the editor or from /presets)
// and spawns the live GPU effect into any THREE.Scene.
//
// Usage:
//   import * as THREE from 'three';
//   import { loadVfx } from './engine/frontier-vfx-loader.js';
//   const fx = await loadVfx(scene, './presets/fiber-burst.json');
//   fx.triggerBurst();          // punch the effect (impacts, pickups, ults)
//   in your loop: fx.update(dt, true);
//
// For non-Web engines (custom C++/Godot/Unity/Unreal) see FORMAT.md —
// the JSON maps 1:1 to shader uniforms; the GLSL in
// vfx-editor/src/vfx-engine.js ports directly (attributes: aSeed vec4, aDir vec3).
import * as THREE from 'three';
import { VfxEffect } from '../vfx-editor/src/vfx-engine.js';

/** Load an effect from a frontier-vfx JSON object, URL, or File. */
export async function loadVfx(scene, source) {
  let data = source;
  if (typeof source === 'string') {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`frontier-vfx: could not fetch ${source}`);
    data = await res.json();
  } else if (source instanceof File || source instanceof Blob) {
    data = JSON.parse(await source.text());
  }
  const params = data.params ?? data;
  const fx = new VfxEffect(scene, params);
  // recommended presentation (match editor look):
  if (data.params?.background) scene.background = new THREE.Color(data.params.background);
  return fx;
}

export { VfxEffect };
