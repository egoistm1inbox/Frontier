// Relief scene: a Three.js view of the terrain and its water. Water is a
// separate surface drawn at each cell's level and discarded where the level
// is not above the ground, so rivers and lakes exist only inside their cuts.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const WaterVertex = `
attribute float aGround;
varying float vDepth;
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vDepth = position.y - aGround;
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const WaterFragment = `
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uSun;
uniform vec3 uEye;
varying float vDepth;
varying vec3 vWorld;
void main() {
  if (vDepth <= 0.03) discard;
  float depthMix = smoothstep(0.0, 5.0, vDepth);
  vec3 colour = mix(uShallow, uDeep, depthMix);
  float shore = 1.0 - smoothstep(0.03, 0.9, vDepth);
  colour = mix(colour, vec3(0.66, 0.68, 0.62), shore * 0.35);
  vec3 viewDir = normalize(uEye - vWorld);
  vec3 halfVector = normalize(uSun + viewDir);
  float glint = pow(max(dot(vec3(0.0, 1.0, 0.0), halfVector), 0.0), 80.0) * 0.5;
  float alpha = mix(0.5, 0.92, smoothstep(0.0, 3.0, vDepth));
  gl_FragColor = vec4(colour + glint, alpha);
}`;

export function CreateReliefScene(Container) {
  const Renderer = new THREE.WebGLRenderer({ antialias: true });
  Renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  Renderer.outputColorSpace = THREE.SRGBColorSpace;
  Renderer.setClearColor(0x0b0c0d, 1);
  Container.appendChild(Renderer.domElement);

  const Scene = new THREE.Scene();
  const Camera = new THREE.PerspectiveCamera(38, 1, 2, 30000);
  const Controls = new OrbitControls(Camera, Renderer.domElement);
  Controls.enableDamping = true;
  Controls.maxPolarAngle = Math.PI * 0.485;

  const Sun = new THREE.Vector3(-0.6, 0.6, 0.55).normalize();
  Scene.add(new THREE.HemisphereLight(0xcfdde9, 0x3b342a, 0.9));
  const Directional = new THREE.DirectionalLight(0xfff3df, 2.1);
  Directional.position.copy(Sun).multiplyScalar(2000);
  Scene.add(Directional);

  const WaterMaterial = new THREE.ShaderMaterial({
    vertexShader: WaterVertex,
    fragmentShader: WaterFragment,
    uniforms: {
      uShallow: { value: new THREE.Vector3(0.36, 0.5, 0.42) },
      uDeep: { value: new THREE.Vector3(0.18, 0.31, 0.35) },
      uSun: { value: Sun },
      uEye: { value: Camera.position },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  let Terrain = null;
  let Water = null;
  let Framed = false;
  let Size = 1024;

  function Release(Mesh) {
    if (!Mesh) return;
    Scene.remove(Mesh);
    Mesh.geometry.dispose();
    if (Mesh.material !== WaterMaterial) Mesh.material.dispose();
  }

  // Terrain vertex (Column, Row) maps to raster index Row * N + Column, with row 0 at the far edge.
  function Update(Snapshot, Exaggeration) {
    const N = Snapshot.N;
    const Count = N * N;
    Size = Snapshot.Size;
    Release(Terrain);
    Release(Water);

    const Geometry = new THREE.PlaneGeometry(Size, Size, N - 1, N - 1);
    Geometry.rotateX(-Math.PI / 2);
    const Positions = Geometry.attributes.position;
    const Colours = new Float32Array(Count * 3);
    for (let Index = 0; Index < Count; Index++) {
      Positions.setY(Index, Snapshot.Height[Index] * Exaggeration);
      for (let Channel = 0; Channel < 3; Channel++) {
        Colours[Index * 3 + Channel] = Math.pow(Snapshot.Colour[Index * 3 + Channel], 2.2);
      }
    }
    Geometry.setAttribute("color", new THREE.BufferAttribute(Colours, 3));
    Geometry.computeVertexNormals();
    Terrain = new THREE.Mesh(Geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
    Scene.add(Terrain);

    const WaterGeometry = new THREE.PlaneGeometry(Size, Size, N - 1, N - 1);
    WaterGeometry.rotateX(-Math.PI / 2);
    const WaterPositions = WaterGeometry.attributes.position;
    const Ground = new Float32Array(Count);
    for (let Index = 0; Index < Count; Index++) {
      WaterPositions.setY(Index, Snapshot.WaterLevel[Index] * Exaggeration);
      Ground[Index] = Snapshot.Height[Index] * Exaggeration;
    }
    WaterGeometry.setAttribute("aGround", new THREE.BufferAttribute(Ground, 1));
    Water = new THREE.Mesh(WaterGeometry, WaterMaterial);
    Water.renderOrder = 2;
    Scene.add(Water);

    if (!Framed) {
      let Mean = 0;
      for (let Index = 0; Index < Count; Index++) Mean += Snapshot.Height[Index];
      Mean = (Mean / Count) * Exaggeration;
      Camera.near = 2;
      Camera.far = Size * 12;
      Camera.position.set(Size * 1.25, Size * 0.85 + Mean, Size * 1.35);
      Controls.target.set(0, Mean * 0.4, 0);
      Controls.update();
      Framed = true;
    }
  }

  function ResetCamera() {
    Framed = false;
  }

  function Resize() {
    const Width = Math.max(1, Container.clientWidth);
    const Height = Math.max(1, Container.clientHeight);
    Renderer.setSize(Width, Height);
    Camera.aspect = Width / Height;
    Camera.updateProjectionMatrix();
  }
  const Observer = new ResizeObserver(Resize);
  Observer.observe(Container);
  Resize();

  let Frame = 0;
  const Loop = () => {
    Frame = requestAnimationFrame(Loop);
    Controls.update();
    Renderer.render(Scene, Camera);
  };
  Loop();

  function Dispose() {
    cancelAnimationFrame(Frame);
    Observer.disconnect();
    Controls.dispose();
    Release(Terrain);
    Release(Water);
    WaterMaterial.dispose();
    Renderer.dispose();
    Renderer.domElement.remove();
  }

  return { Update, ResetCamera, Dispose };
}
