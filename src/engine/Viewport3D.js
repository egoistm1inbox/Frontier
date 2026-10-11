import * as THREE from 'three';

export const RENDER_MODES = {
  PBR: 'pbr',
  CLAY: 'clay',
  HEIGHTMAP: 'heightmap',
  FLOW: 'flow',
  SEDIMENT: 'sediment',
  SLOPE: 'slope',
  WIREFRAME: 'wireframe'
};

export class Viewport3D {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.disposed = false;
    this.renderMode = RENDER_MODES.PBR;
    this.wireframeOverlay = false;
    this.waterVisible = true;
    this.waterLevel = 35.0; // meters

    // Environment Lighting
    this.sunAzimuth = 135.0; // degrees
    this.sunElevation = 38.0; // degrees
    this.sunIntensity = 110.0; // klux
    this.skyTurbidity = 2.5;

    // Camera state
    this.cameraDistance = 450.0;
    this.cameraPolar = 1.05; // radians (pitch)
    this.cameraAzimuth = 0.75; // radians (yaw)
    this.target = new THREE.Vector3(0, 40, 0);
    this.isDragging = false;
    this.isPanning = false;
    this.prevMouse = { x: 0, y: 0 };

    this.init();
  }

  async init() {
    const width = this.canvas.clientWidth || 800;
    const height = this.canvas.clientHeight || 600;

    // Check WebGPU availability and try WebGPURenderer, fall back to WebGLRenderer
    let renderer;
    let isWebGPU = false;

    if (typeof navigator !== 'undefined' && navigator.gpu) {
      try {
        const { WebGPURenderer } = await import('three/webgpu');
        renderer = new WebGPURenderer({
          canvas: this.canvas,
          antialias: true,
          powerPreference: 'high-performance'
        });
        await renderer.init();
        isWebGPU = true;
      } catch (err) {
        console.warn('WebGPU initialization failed, falling back to WebGL2:', err);
      }
    }

    if (!renderer) {
      renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        powerPreference: 'high-performance',
        alpha: false
      });
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
    }

    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer = renderer;
    this.isWebGPU = isWebGPU;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#101216');

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, width / height, 1.0, 5000.0);
    this.updateCameraPosition();

    // Lighting
    this.ambientLight = new THREE.AmbientLight(0xdbe6f5, 0.45);
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(0xfffaed, 2.5);
    this.directionalLight.castShadow = true;
    this.directionalLight.shadow.mapSize.width = 2048;
    this.directionalLight.shadow.mapSize.height = 2048;
    this.directionalLight.shadow.camera.near = 10;
    this.directionalLight.shadow.camera.far = 1500;
    const d = 300;
    this.directionalLight.shadow.camera.left = -d;
    this.directionalLight.shadow.camera.right = d;
    this.directionalLight.shadow.camera.top = d;
    this.directionalLight.shadow.camera.bottom = -d;
    this.scene.add(this.directionalLight);

    // Hemispherical sky/ground fill light
    this.hemiLight = new THREE.HemisphereLight(0x99b4d1, 0x3d352e, 0.65);
    this.scene.add(this.hemiLight);

    this.updateSunPosition();

    // Sky Dome
    this.buildSkyDome();

    // Water Plane
    this.buildWater();

    // Terrain Mesh placeholder
    this.terrainMesh = null;
    this.wireframeMesh = null;

    // Events
    this.bindEvents();

    // Render loop
    this.clock = new THREE.Clock();
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  buildSkyDome() {
    const skyGeo = new THREE.SphereGeometry(3000, 32, 16);
    // Procedural sky gradient shader
    this.skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uSunPos: { value: new THREE.Vector3() },
        uZenithColor: { value: new THREE.Color(0x19324d) },
        uHorizonColor: { value: new THREE.Color(0xdbe4ed) },
        uGroundColor: { value: new THREE.Color(0x1a1614) },
        uSunColor: { value: new THREE.Color(0xfff5d6) }
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uSunPos;
        uniform vec3 uZenithColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uGroundColor;
        uniform vec3 uSunColor;
        varying vec3 vWorldPos;

        void main() {
          vec3 dir = normalize(vWorldPos);
          float elevation = dir.y;
          vec3 sunDir = normalize(uSunPos);

          vec3 sky;
          if (elevation > 0.0) {
            float t = pow(1.0 - elevation, 2.5);
            sky = mix(uZenithColor, uHorizonColor, t);
          } else {
            sky = mix(uHorizonColor, uGroundColor, clamp(-elevation * 4.0, 0.0, 1.0));
          }

          // Sun disc & atmospheric flare
          float sunDot = max(0.0, dot(dir, sunDir));
          float sunGlow = pow(sunDot, 12.0) * 0.45;
          float sunDisc = smoothstep(0.9985, 0.9995, sunDot) * 4.0;

          vec3 finalColor = sky + (uSunColor * (sunGlow + sunDisc));
          gl_FragColor = vec4(finalColor, 1.0);
        }
      `
    });

    this.skyMesh = new THREE.Mesh(skyGeo, this.skyMaterial);
    this.scene.add(this.skyMesh);
  }

  buildWater() {
    const waterGeo = new THREE.PlaneGeometry(600, 600, 64, 64);
    waterGeo.rotateX(-Math.PI / 2);

    this.waterMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uWaterLevel: { value: this.waterLevel },
        uDeepColor: { value: new THREE.Color(0x0e283d) },
        uShallowColor: { value: new THREE.Color(0x286380) },
        uFoamColor: { value: new THREE.Color(0xebf4fa) },
        uSunDir: { value: new THREE.Vector3() },
        uSunColor: { value: new THREE.Color(0xfffae8) }
      },
      vertexShader: `
        uniform float uTime;
        varying vec3 vWorldPos;
        varying vec3 vNormal;

        void main() {
          vec3 pos = position;
          // Subtly animated ripples
          float wave1 = sin(pos.x * 0.08 + uTime * 1.8) * cos(pos.z * 0.08 + uTime * 1.5) * 0.4;
          float wave2 = sin(pos.x * 0.18 - uTime * 2.2 + pos.z * 0.12) * 0.25;
          pos.y += wave1 + wave2;

          vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
          vNormal = normalize(vec3(-wave1 * 0.2, 1.0, -wave2 * 0.2));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uDeepColor;
        uniform vec3 uShallowColor;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        varying vec3 vWorldPos;
        varying vec3 vNormal;

        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          vec3 n = normalize(vNormal);

          // Fresnel reflection
          float fresnel = clamp(1.0 - dot(viewDir, n), 0.0, 1.0);
          fresnel = pow(fresnel, 3.0);

          // Specular sun highlight
          vec3 halfVec = normalize(viewDir + normalize(uSunDir));
          float spec = pow(max(0.0, dot(n, halfVec)), 128.0) * 3.5;

          vec3 waterCol = mix(uDeepColor, uShallowColor, 0.4);
          vec3 finalCol = mix(waterCol, vec3(0.7, 0.85, 0.95), fresnel * 0.8) + (uSunColor * spec);

          gl_FragColor = vec4(finalCol, 0.85);
        }
      `
    });

    this.waterMesh = new THREE.Mesh(waterGeo, this.waterMaterial);
    this.waterMesh.position.y = this.waterLevel;
    this.scene.add(this.waterMesh);
  }

  updateSunPosition() {
    const radAz = (this.sunAzimuth * Math.PI) / 180.0;
    const radEl = (this.sunElevation * Math.PI) / 180.0;

    const dist = 800.0;
    const x = dist * Math.cos(radEl) * Math.sin(radAz);
    const y = dist * Math.sin(radEl);
    const z = dist * Math.cos(radEl) * Math.cos(radAz);

    this.directionalLight.position.set(x, y, z);
    this.directionalLight.target.position.set(0, 0, 0);

    const sunDir = new THREE.Vector3(x, y, z).normalize();

    // Adjust light intensity based on elevation (golden sunset when low)
    const daylight = Math.max(0.0, Math.sin(radEl));
    this.directionalLight.intensity = Math.pow(daylight, 0.6) * 2.8;

    if (this.skyMaterial) {
      this.skyMaterial.uniforms.uSunPos.value.copy(this.directionalLight.position);
      // Sunset warm horizon color tint
      const sunsetFactor = Math.max(0.0, 1.0 - Math.abs(this.sunElevation) / 35.0);
      const horizonColor = new THREE.Color().lerpColors(
        new THREE.Color(0xdbe4ed),
        new THREE.Color(0xf5b26b),
        sunsetFactor
      );
      this.skyMaterial.uniforms.uHorizonColor.value = horizonColor;
    }

    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uSunDir.value.copy(sunDir);
    }
  }

  // Build / update terrain 3D mesh from generated geological heightmap & textures
  updateTerrain(terrainData, bakedTextures) {
    const {
      heightMap,
      flowMask,
      sedimentMask,
      slopeMap,
      normalMap,
      stats
    } = terrainData;

    const size = Math.round(Math.sqrt(heightMap.length));
    const terrainScaleXZ = 500.0; // Total world units across terrain
    const maxAltitude = 280.0; // World elevation scale

    // Create or reuse PlaneGeometry
    let geometry = this.terrainMesh ? this.terrainMesh.geometry : null;
    if (!geometry || geometry.parameters.widthSegments !== (size - 1)) {
      if (this.terrainMesh) {
        this.scene.remove(this.terrainMesh);
        if (this.wireframeMesh) this.scene.remove(this.wireframeMesh);
        this.terrainMesh.geometry.dispose();
      }
      geometry = new THREE.PlaneGeometry(terrainScaleXZ, terrainScaleXZ, size - 1, size - 1);
      geometry.rotateX(-Math.PI / 2);
    }

    // Apply displacement vertices
    const pos = geometry.attributes.position;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const vIdx = y * size + x;
        const hIdx = y * size + x;
        const h = heightMap[hIdx];
        pos.setY(vIdx, h * maxAltitude);
      }
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();

    // Prepare textures from baked buffers
    const texSize = bakedTextures.texSize;
    const albedoTex = new THREE.DataTexture(
      bakedTextures.albedoData,
      texSize,
      texSize,
      THREE.RGBAFormat
    );
    albedoTex.wrapS = THREE.ClampToEdgeWrapping;
    albedoTex.wrapT = THREE.ClampToEdgeWrapping;
    albedoTex.magFilter = THREE.LinearFilter;
    albedoTex.minFilter = THREE.LinearMipmapLinearFilter;
    albedoTex.generateMipmaps = true;
    albedoTex.needsUpdate = true;

    // Build or update shader material for custom visualizer modes
    if (!this.terrainMaterial) {
      this.terrainMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uAlbedoMap: { value: albedoTex },
          uHeightMap: { value: null },
          uSunDir: { value: new THREE.Vector3() },
          uSunColor: { value: new THREE.Color(0xfffaed) },
          uAmbientColor: { value: new THREE.Color(0x354457) },
          uRenderMode: { value: 0 } // 0: PBR, 1: Clay, 2: Height, 3: Flow, 4: Sediment, 5: Slope
        },
        vertexShader: `
          varying vec3 vWorldPos;
          varying vec3 vNormal;
          varying vec2 vUv;

          void main() {
            vUv = uv;
            vNormal = normalize(normalMatrix * normal);
            vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D uAlbedoMap;
          uniform vec3 uSunDir;
          uniform vec3 uSunColor;
          uniform vec3 uAmbientColor;
          uniform int uRenderMode;

          varying vec3 vWorldPos;
          varying vec3 vNormal;
          varying vec2 vUv;

          void main() {
            vec3 n = normalize(vNormal);
            vec3 l = normalize(uSunDir);
            vec3 v = normalize(cameraPosition - vWorldPos);

            float nDotL = max(0.0, dot(n, l));

            // PBR Blinn-Phong/Cook-Torrance specular
            vec3 h = normalize(l + v);
            float spec = pow(max(0.0, dot(n, h)), 32.0) * 0.35;

            vec4 albedo = texture2D(uAlbedoMap, vUv);

            vec3 color = vec3(0.0);

            if (uRenderMode == 0) {
              // PBR Photoreal
              vec3 diffuse = albedo.rgb * (nDotL * uSunColor + uAmbientColor);
              color = diffuse + vec3(spec);
            } else if (uRenderMode == 1) {
              // Sculptor Clay mode
              vec3 clayBase = vec3(0.68, 0.65, 0.62);
              float ao = clamp(n.y * 0.7 + 0.3, 0.0, 1.0);
              color = clayBase * (nDotL * 0.85 + 0.35) * ao;
            } else if (uRenderMode == 2) {
              // Heightmap Raw
              float hVal = clamp(vWorldPos.y / 280.0, 0.0, 1.0);
              color = vec3(hVal);
            } else if (uRenderMode == 3) {
              // Flow Mask channel overlay
              float flow = smoothstep(0.05, 0.6, albedo.a);
              color = mix(vec3(0.12, 0.12, 0.14), vec3(0.1, 0.8, 1.0), flow);
            } else if (uRenderMode == 4) {
              // Sediment deposit
              float sed = albedo.g / 255.0;
              color = mix(vec3(0.15, 0.14, 0.13), vec3(0.95, 0.75, 0.25), sed);
            } else if (uRenderMode == 5) {
              // Slope Angle
              float slope = 1.0 - n.y; // 0 = flat, 1 = cliff
              vec3 flatCol = vec3(0.2, 0.7, 0.3);
              vec3 midCol = vec3(0.85, 0.75, 0.2);
              vec3 steepCol = vec3(0.85, 0.2, 0.15);
              if (slope < 0.4) {
                color = mix(flatCol, midCol, slope / 0.4);
              } else {
                color = mix(midCol, steepCol, (slope - 0.4) / 0.6);
              }
            }

            gl_FragColor = vec4(color, 1.0);
          }
        `
      });
    } else {
      this.terrainMaterial.uniforms.uAlbedoMap.value = albedoTex;
    }

    this.setRenderMode(this.renderMode);
    this.updateSunPosition();

    if (!this.terrainMesh) {
      this.terrainMesh = new THREE.Mesh(geometry, this.terrainMaterial);
      this.terrainMesh.receiveShadow = true;
      this.terrainMesh.castShadow = true;
      this.scene.add(this.terrainMesh);
    }

    // Wireframe overlay
    if (this.wireframeOverlay) {
      this.updateWireframe();
    }
  }

  setRenderMode(mode) {
    this.renderMode = mode;
    if (!this.terrainMaterial) return;

    let modeIdx = 0;
    switch (mode) {
      case RENDER_MODES.PBR: modeIdx = 0; break;
      case RENDER_MODES.CLAY: modeIdx = 1; break;
      case RENDER_MODES.HEIGHTMAP: modeIdx = 2; break;
      case RENDER_MODES.FLOW: modeIdx = 3; break;
      case RENDER_MODES.SEDIMENT: modeIdx = 4; break;
      case RENDER_MODES.SLOPE: modeIdx = 5; break;
      default: modeIdx = 0;
    }

    this.terrainMaterial.uniforms.uRenderMode.value = modeIdx;
  }

  setWireframe(enabled) {
    this.wireframeOverlay = enabled;
    if (enabled) {
      this.updateWireframe();
    } else if (this.wireframeMesh) {
      this.scene.remove(this.wireframeMesh);
      this.wireframeMesh = null;
    }
  }

  updateWireframe() {
    if (!this.terrainMesh) return;
    if (this.wireframeMesh) this.scene.remove(this.wireframeMesh);

    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x3bd5ff,
      wireframe: true,
      transparent: true,
      opacity: 0.28
    });
    this.wireframeMesh = new THREE.Mesh(this.terrainMesh.geometry, wireMat);
    this.wireframeMesh.position.y = 0.2; // slight bias
    this.scene.add(this.wireframeMesh);
  }

  setWaterLevel(level) {
    this.waterLevel = level;
    if (this.waterMesh) {
      this.waterMesh.position.y = level;
    }
  }

  setWaterVisible(visible) {
    this.waterVisible = visible;
    if (this.waterMesh) {
      this.waterMesh.visible = visible;
    }
  }

  setSunAzimuth(az) {
    this.sunAzimuth = az;
    this.updateSunPosition();
  }

  setSunElevation(el) {
    this.sunElevation = el;
    this.updateSunPosition();
  }

  // Preset Camera views
  setCameraPreset(preset) {
    switch (preset) {
      case 'perspective':
        this.cameraDistance = 450;
        this.cameraPolar = 1.05;
        this.cameraAzimuth = 0.75;
        this.target.set(0, 40, 0);
        break;
      case 'topdown':
        this.cameraDistance = 550;
        this.cameraPolar = 0.05; // directly overhead
        this.cameraAzimuth = 0.0;
        this.target.set(0, 0, 0);
        break;
      case 'cinematic':
        this.cameraDistance = 320;
        this.cameraPolar = 1.35; // ground skimming
        this.cameraAzimuth = 1.8;
        this.target.set(0, 80, 0);
        break;
      case 'isometric':
        this.cameraDistance = 500;
        this.cameraPolar = Math.PI / 4;
        this.cameraAzimuth = Math.PI / 4;
        this.target.set(0, 30, 0);
        break;
    }
    this.updateCameraPosition();
  }

  updateCameraPosition() {
    const x = this.target.x + this.cameraDistance * Math.sin(this.cameraPolar) * Math.sin(this.cameraAzimuth);
    const y = this.target.y + this.cameraDistance * Math.cos(this.cameraPolar);
    const z = this.target.z + this.cameraDistance * Math.sin(this.cameraPolar) * Math.cos(this.cameraAzimuth);

    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);
  }

  bindEvents() {
    const el = this.canvas;

    const onPointerDown = (e) => {
      e.preventDefault();
      this.isDragging = true;
      this.isPanning = (e.button === 2 || e.button === 1 || e.shiftKey);
      this.prevMouse = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.prevMouse.x;
      const dy = e.clientY - this.prevMouse.y;
      this.prevMouse = { x: e.clientX, y: e.clientY };

      if (this.isPanning) {
        // Pan parallel to view
        const right = new THREE.Vector3();
        this.camera.getWorldDirection(right);
        right.cross(this.camera.up).normalize();

        const panSpeed = this.cameraDistance * 0.0018;
        this.target.addScaledVector(right, -dx * panSpeed);
        this.target.y += dy * panSpeed;
      } else {
        // Orbit
        this.cameraAzimuth -= dx * 0.006;
        this.cameraPolar = Math.max(0.05, Math.min(Math.PI / 2 - 0.02, this.cameraPolar - dy * 0.006));
      }

      this.updateCameraPosition();
    };

    const onPointerUp = (e) => {
      this.isDragging = false;
      this.isPanning = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch (err) {}
    };

    const onWheel = (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 1.08 : 0.92;
      this.cameraDistance = Math.max(40, Math.min(1800, this.cameraDistance * zoomFactor));
      this.updateCameraPosition();
    };

    const onContextMenu = (e) => e.preventDefault();

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContextMenu);

    this.unbind = () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContextMenu);
    };
  }

  resize(width, height) {
    if (!this.renderer || !this.camera) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  animate() {
    if (this.disposed) return;
    requestAnimationFrame(this.animate);

    const elapsed = this.clock.getElapsedTime();
    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uTime.value = elapsed;
    }

    if (this.terrainMaterial) {
      const sunDir = new THREE.Vector3();
      this.directionalLight.getWorldDirection(sunDir);
      sunDir.negate();
      this.terrainMaterial.uniforms.uSunDir.value.copy(sunDir);
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    if (this.unbind) this.unbind();
    if (this.renderer) this.renderer.dispose();
  }
}
