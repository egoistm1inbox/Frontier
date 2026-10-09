// Three.js view of the heightmap. Owns the renderer, camera, lights and the terrain mesh.
// React code calls the setters; the render loop only draws when something changed.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const UP = new THREE.Vector3(0, 1, 0);
const SKY_COLOUR = 0xc4d6e3;

// Vertex colours are authored in sRGB; three.js expects linear values for vertex colours.
function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

// Same convention as grid.js hillshade: east is +x, south is +z, elevation is up.
export function sunDirection(azimuthDeg, elevationDeg) {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
}

export class TerrainScene {
  constructor(host) {
    this.host = host;
    this.disposed = false;
    this.dirty = true;
    this.gridSize = 0;
    this.worldSize = 2048;
    this.exaggeration = 1;
    this.maxHeight = 600;
    this.texture = null;
    this.mode = 'shaded';
    this.projection = 'perspective';
    this.terrain = null;
    this.geometry = null;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.domElement.className = 'lx-canvas';
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY_COLOUR);
    this.scene.fog = new THREE.Fog(SKY_COLOUR, 4000, 14000);
    this.camera = new THREE.PerspectiveCamera(34, 1, 20, 1000000);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 60;
    this.controls.maxDistance = 30000;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.addEventListener('change', () => {
      this.dirty = true;
    });

    this.hemisphere = new THREE.HemisphereLight(0xe2eeff, 0x463c2e, 0.6);
    this.scene.add(this.hemisphere);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 1.5;
    this.scene.add(this.sun, this.sun.target);

    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
    this.waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x2c6d92,
      roughness: 0.18,
      metalness: 0.05,
      transparent: true,
      opacity: 0.84,
    });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.waterMaterial);
    this.water.rotation.x = -Math.PI / 2;
    this.water.receiveShadow = true;
    this.scene.add(this.water);

    this.setSun(300, 42);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  loop() {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const moved = this.controls.update();
    if (moved || this.dirty) {
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
    }
  }

  resize() {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  buildGrid(size) {
    if (this.terrain) {
      this.scene.remove(this.terrain);
      this.geometry.dispose();
    }
    const count = size * size;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const colours = new Float32Array(count * 3);
    for (let y = 0, i = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1, i += 1) {
        uvs[i * 2] = x / (size - 1);
        uvs[i * 2 + 1] = y / (size - 1);
      }
    }
    const indices = new Uint32Array((size - 1) * (size - 1) * 6);
    let t = 0;
    for (let y = 0; y < size - 1; y += 1) {
      for (let x = 0; x < size - 1; x += 1) {
        const a = y * size + x;
        const b = a + 1;
        const c = a + size;
        const d = c + 1;
        indices[t++] = a;
        indices[t++] = c;
        indices[t++] = b;
        indices[t++] = b;
        indices[t++] = c;
        indices[t++] = d;
      }
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry = geometry;
    this.terrain = new THREE.Mesh(geometry, this.material);
    this.terrain.castShadow = true;
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);
    this.gridSize = size;
  }

  // heights are normalised (0..1 of maxHeight); world units are metres.
  setTerrain({ heights, size, worldSize, maxHeight, exaggeration, seaLevel }) {
    const rebuilt = size !== this.gridSize;
    if (rebuilt) this.buildGrid(size);
    const reframe = rebuilt || worldSize !== this.worldSize;
    this.worldSize = worldSize;
    this.maxHeight = maxHeight;
    this.exaggeration = exaggeration;
    const positions = this.geometry.attributes.position.array;
    const half = worldSize / 2;
    const step = worldSize / (size - 1);
    const scale = maxHeight * exaggeration;
    for (let y = 0, i = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1, i += 1) {
        positions[i * 3] = x * step - half;
        positions[i * 3 + 1] = heights[i] * scale;
        positions[i * 3 + 2] = y * step - half;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
    this.water.scale.set(worldSize, worldSize, 1);
    this.water.position.y = seaLevel * exaggeration;
    this.updateShadowFrustum();
    if (reframe) this.frame();
    this.dirty = true;
  }

  setColours(colours) {
    if (!this.geometry || !colours) return;
    const target = this.geometry.attributes.color.array;
    for (let i = 0; i < colours.length; i += 1) target[i] = srgbToLinear(colours[i]);
    this.geometry.attributes.color.needsUpdate = true;
    this.dirty = true;
  }

  setTexture(rgba, size) {
    if (this.texture) this.texture.dispose();
    this.texture = null;
    if (rgba) {
      const texture = new THREE.DataTexture(rgba, size, size, THREE.RGBAFormat);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;
      this.texture = texture;
    }
    this.applyMaterialMode();
  }

  // 'satmap' uses the texture; every other mode reads the per-vertex colours.
  setMode(mode) {
    this.mode = mode;
    this.applyMaterialMode();
  }

  applyMaterialMode() {
    const useTexture = this.mode === 'satmap' && !!this.texture;
    this.material.map = useTexture ? this.texture : null;
    this.material.vertexColors = !useTexture;
    this.material.needsUpdate = true;
    this.dirty = true;
  }

  setWater(visible) {
    this.water.visible = visible;
    this.dirty = true;
  }

  setWireframe(on) {
    this.material.wireframe = on;
    this.dirty = true;
  }

  setSun(azimuthDeg, elevationDeg) {
    const direction = sunDirection(azimuthDeg, elevationDeg);
    this.sun.position.copy(direction).multiplyScalar(this.worldSize * 2.4);
    this.sun.position.y = Math.max(this.sun.position.y, 50);
    this.dirty = true;
  }

  updateShadowFrustum() {
    const s = this.worldSize;
    const camera = this.sun.shadow.camera;
    camera.left = -s * 0.62;
    camera.right = s * 0.62;
    camera.top = s * 0.62;
    camera.bottom = -s * 0.62;
    camera.near = 10;
    camera.far = s * 6;
    camera.updateProjectionMatrix();
    this.scene.fog.near = s * 1.4;
    this.scene.fog.far = s * 5;
  }

  setProjection(projection) {
    this.projection = projection;
    this.controls.maxPolarAngle = projection === 'top' ? 0.02 : Math.PI * 0.485;
    this.frame();
  }

  frame() {
    const s = this.worldSize;
    this.controls.target.set(0, this.maxHeight * this.exaggeration * 0.2, 0);
    if (this.projection === 'top') {
      this.camera.position.set(0, s * 2.1, s * 0.002);
    } else {
      const dir = new THREE.Vector3(0.62, 0.52, 0.74).normalize();
      this.camera.position.copy(this.controls.target).addScaledVector(dir, s * 2.1);
    }
    this.camera.up.copy(UP);
    this.controls.update();
    this.dirty = true;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.geometry?.dispose();
    this.material.dispose();
    this.waterMaterial.dispose();
    this.water.geometry.dispose();
    this.texture?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
