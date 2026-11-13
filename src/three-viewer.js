import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class ThreeIconViewer {
  constructor(containerElement) {
    this.container = containerElement;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.currentModelGroup = null;
    this.currentModelType = 'battery';
    this.turntable = true;
    this.wireframe = false;
    this.particles = null;
    this.particlePositions = null;
    this.particleSpeeds = null;
    this.animTime = 0;
    this.cubeFlaps = [];
    this.materialSettings = {
      primaryColor: '#1e2025',
      accentColor: '#f59e0b',
      roughness: 0.38,
      metalness: 0.12,
    };

    this.init();
  }

  init() {
    const width = this.container.clientWidth || 600;
    const height = this.container.clientHeight || 450;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x13151a);

    // Camera
    this.camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    this.camera.position.set(0, 2.8, 5.5);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    // Orbit Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxDistance = 12;
    this.controls.minDistance = 2;
    this.controls.target.set(0, 0.2, 0);

    // Studio Lighting setup matching 3D clay renders
    this.setupLighting();

    // Studio Ground Shadow Plane
    this.setupGround();

    // Load initial model
    this.loadModel(this.currentModelType);

    // Resize listener
    window.addEventListener('resize', this.onResize.bind(this));

    // Animation Loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  setupLighting() {
    // Ambient Light (Soft fill)
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    this.scene.add(this.ambientLight);

    // Key Light (Warm soft directional from top-left)
    this.keyLight = new THREE.DirectionalLight(0xfff8e7, 2.6);
    this.keyLight.position.set(4, 7, 5);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.width = 1024;
    this.keyLight.shadow.mapSize.height = 1024;
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 20;
    this.keyLight.shadow.bias = -0.001;
    this.scene.add(this.keyLight);

    // Fill Light (Cool cyan soft light from right)
    this.fillLight = new THREE.DirectionalLight(0x7dd3fc, 1.4);
    this.fillLight.position.set(-5, 3, -2);
    this.scene.add(this.fillLight);

    // Rim / Back Light (Crisp specular edge highlight)
    this.rimLight = new THREE.DirectionalLight(0xffffff, 2.2);
    this.rimLight.position.set(0, 6, -6);
    this.scene.add(this.rimLight);
  }

  setupGround() {
    // Soft shadow receiver pedestal
    const groundGeo = new THREE.CylinderGeometry(2.4, 2.5, 0.1, 48);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x181a20,
      roughness: 0.85,
      metalness: 0.05
    });
    this.pedestal = new THREE.Mesh(groundGeo, groundMat);
    this.pedestal.position.y = -1.05;
    this.pedestal.receiveShadow = true;
    this.scene.add(this.pedestal);

    // Concentric coordinate rings
    const ringGeo = new THREE.RingGeometry(2.2, 2.24, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x334155, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.99;
    this.scene.add(ring);
  }

  onResize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  setMaterialParams(primary, accent, roughness, metalness) {
    this.materialSettings.primaryColor = primary || this.materialSettings.primaryColor;
    this.materialSettings.accentColor = accent || this.materialSettings.accentColor;
    if (roughness !== undefined) this.materialSettings.roughness = roughness;
    if (metalness !== undefined) this.materialSettings.metalness = metalness;
    this.loadModel(this.currentModelType);
  }

  loadModel(type) {
    this.currentModelType = type;
    if (this.currentModelGroup) {
      this.scene.remove(this.currentModelGroup);
    }

    this.currentModelGroup = new THREE.Group();
    this.cubeFlaps = [];
    this.particles = null;

    const charcoalMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.materialSettings.primaryColor),
      roughness: this.materialSettings.roughness,
      metalness: this.materialSettings.metalness,
      wireframe: this.wireframe
    });

    const goldMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.materialSettings.accentColor),
      roughness: this.materialSettings.roughness * 0.85,
      metalness: this.materialSettings.metalness + 0.1,
      wireframe: this.wireframe
    });

    const silverMat = new THREE.MeshStandardMaterial({
      color: 0xdbeafe,
      roughness: 0.25,
      metalness: 0.8,
      wireframe: this.wireframe
    });

    const cyanMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: this.materialSettings.roughness * 0.8,
      metalness: this.materialSettings.metalness,
      wireframe: this.wireframe
    });

    switch (type) {
      case 'battery':
        this.buildBattery(charcoalMat, goldMat, silverMat);
        break;
      case 'clapperboard':
        this.buildClapperboard(charcoalMat, silverMat);
        break;
      case 'extrude':
        this.buildExtrude(charcoalMat, goldMat, cyanMat);
        break;
      case 'bevel':
        this.buildBevel(charcoalMat, goldMat);
        break;
      case 'vortex':
        this.buildVortex(goldMat, cyanMat);
        break;
      case 'vectorgrid':
        this.buildVectorGrid(charcoalMat, goldMat, cyanMat);
        break;
      case 'uvunwrap':
        this.buildUVUnwrap(charcoalMat, goldMat);
        break;
      case 'magnet':
        this.buildMagnet(charcoalMat, goldMat, cyanMat);
        break;
      default:
        this.buildBattery(charcoalMat, goldMat, silverMat);
    }

    this.scene.add(this.currentModelGroup);
  }

  buildBattery(charcoalMat, goldMat, silverMat) {
    const group = this.currentModelGroup;

    // Cylinder Body (charcoal matte)
    const bodyGeo = new THREE.CylinderGeometry(0.75, 0.75, 1.4, 48);
    const body = new THREE.Mesh(bodyGeo, charcoalMat);
    body.position.y = -0.15;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Top Orange/Gold Cap
    const capGeo = new THREE.CylinderGeometry(0.76, 0.76, 0.45, 48);
    const cap = new THREE.Mesh(capGeo, goldMat);
    cap.position.y = 0.65;
    cap.castShadow = true;
    group.add(cap);

    // Beveled rim transition
    const rimGeo = new THREE.TorusGeometry(0.73, 0.04, 16, 48);
    const rim = new THREE.Mesh(rimGeo, goldMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.87;
    group.add(rim);

    // Metallic Silver Electrode Pin
    const pinGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 32);
    const pin = new THREE.Mesh(pinGeo, silverMat);
    pin.position.y = 0.98;
    pin.castShadow = true;
    group.add(pin);

    // 3D Beveled Lightning Bolt on Front
    const boltShape = new THREE.Shape();
    boltShape.moveTo(0.12, 0.55);
    boltShape.lineTo(-0.25, 0.05);
    boltShape.lineTo(0.02, 0.05);
    boltShape.lineTo(-0.16, -0.55);
    boltShape.lineTo(0.28, -0.02);
    boltShape.lineTo(0.02, -0.02);
    boltShape.closePath();

    const extrudeSettings = { depth: 0.12, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.03, bevelThickness: 0.03 };
    const boltGeo = new THREE.ExtrudeGeometry(boltShape, extrudeSettings);
    boltGeo.center();
    const boltMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      roughness: 0.25,
      metalness: 0.15
    });
    const bolt = new THREE.Mesh(boltGeo, boltMat);
    bolt.position.set(0, 0.08, 0.77);
    bolt.scale.set(1.1, 1.1, 1);
    bolt.castShadow = true;
    group.add(bolt);
  }

  buildClapperboard(charcoalMat, silverMat) {
    const group = this.currentModelGroup;

    // Main Slate Board
    const boardGeo = new THREE.BoxGeometry(1.9, 1.3, 0.14);
    const board = new THREE.Mesh(boardGeo, charcoalMat);
    board.position.set(0, -0.1, 0);
    board.castShadow = true;
    board.receiveShadow = true;
    group.add(board);

    // White Play Chevron Triangle Badge on Front
    const playShape = new THREE.Shape();
    playShape.moveTo(-0.26, 0.32);
    playShape.lineTo(0.36, 0);
    playShape.lineTo(-0.26, -0.32);
    playShape.closePath();

    const playExtrude = new THREE.ExtrudeGeometry(playShape, { depth: 0.08, bevelEnabled: true, bevelSegments: 3, bevelSize: 0.02, bevelThickness: 0.02 });
    playExtrude.center();
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.1 });
    const play = new THREE.Mesh(playExtrude, whiteMat);
    play.position.set(0.05, -0.12, 0.11);
    play.castShadow = true;
    group.add(play);

    // Fixed Top Slate Bar
    const topBarGeo = new THREE.BoxGeometry(1.9, 0.25, 0.15);
    const topBar = new THREE.Mesh(topBarGeo, charcoalMat);
    topBar.position.set(0, 0.62, 0);
    group.add(topBar);

    // Diagonal Striped Clapper Arm (Tilted Open like in reference!)
    const armGroup = new THREE.Group();
    armGroup.position.set(-0.85, 0.65, 0);
    armGroup.rotation.z = 0.42; // ~24 deg open angle

    const armGeo = new THREE.BoxGeometry(1.9, 0.26, 0.15);
    armGeo.translate(0.85, 0, 0);
    const arm = new THREE.Mesh(armGeo, charcoalMat);
    arm.castShadow = true;
    armGroup.add(arm);

    // White Zebra Stripes on Arm
    for (let i = 0; i < 4; i++) {
      const stripeGeo = new THREE.BoxGeometry(0.24, 0.262, 0.152);
      const stripe = new THREE.Mesh(stripeGeo, whiteMat);
      stripe.position.set(0.2 + i * 0.48, 0, 0);
      stripe.rotation.z = -0.35;
      armGroup.add(stripe);
    }
    group.add(armGroup);

    // Metallic Hinge Bracket with 3 Screws
    const hingeGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.22, 24);
    const hinge = new THREE.Mesh(hingeGeo, silverMat);
    hinge.rotation.x = Math.PI / 2;
    hinge.position.set(-0.82, 0.65, 0.08);
    group.add(hinge);

    for (let j = 0; j < 3; j++) {
      const screwGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.04, 16);
      const screw = new THREE.Mesh(screwGeo, silverMat);
      screw.rotation.x = Math.PI / 2;
      screw.position.set(-0.75 + (j % 2) * 0.18, 0.52 + Math.floor(j / 2) * 0.18, 0.11);
      group.add(screw);
    }
  }

  buildExtrude(charcoalMat, goldMat, cyanMat) {
    const group = this.currentModelGroup;

    // Base Polygon Block
    const baseGeo = new THREE.BoxGeometry(1.6, 0.4, 1.6);
    const base = new THREE.Mesh(baseGeo, charcoalMat);
    base.position.y = -0.6;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    // Extruded Column
    const colGeo = new THREE.BoxGeometry(1.3, 1.0, 1.3);
    const col = new THREE.Mesh(colGeo, charcoalMat);
    col.position.y = 0.1;
    col.castShadow = true;
    group.add(col);

    // Active Top Extruded Face (Amber Gold)
    const topGeo = new THREE.BoxGeometry(1.32, 0.08, 1.32);
    const top = new THREE.Mesh(topGeo, goldMat);
    top.position.y = 0.64;
    top.castShadow = true;
    group.add(top);

    // Upward Translation Arrow Gizmo
    const shaftGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.6, 16);
    const shaft = new THREE.Mesh(shaftGeo, cyanMat);
    shaft.position.y = 1.05;
    group.add(shaft);

    const coneGeo = new THREE.ConeGeometry(0.12, 0.25, 24);
    const cone = new THREE.Mesh(coneGeo, cyanMat);
    cone.position.y = 1.45;
    group.add(cone);
  }

  buildBevel(charcoalMat, goldMat) {
    const group = this.currentModelGroup;

    // Main corner block
    const blockGeo = new THREE.BoxGeometry(1.6, 1.6, 1.6);
    const block = new THREE.Mesh(blockGeo, charcoalMat);
    block.position.set(-0.2, 0, -0.2);
    block.castShadow = true;
    group.add(block);

    // Rounded Fillet Strip along corner
    const filletGeo = new THREE.CylinderGeometry(0.4, 0.4, 1.62, 32, 1, false, 0, Math.PI / 2);
    const fillet = new THREE.Mesh(filletGeo, goldMat);
    fillet.position.set(0.6, 0, 0.6);
    fillet.castShadow = true;
    group.add(fillet);
  }

  buildVortex(goldMat, cyanMat) {
    const group = this.currentModelGroup;

    // Helical Curve Tube
    const curvePoints = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const angle = t * Math.PI * 6;
      const r = (1 - t * 0.75) * 1.2;
      const y = (t - 0.5) * 1.8;
      curvePoints.push(new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r));
    }
    const path = new THREE.CatmullRomCurve3(curvePoints);
    const tubeGeo = new THREE.TubeGeometry(path, 64, 0.05, 12, false);
    const tube = new THREE.Mesh(tubeGeo, goldMat);
    group.add(tube);

    // Swirling Particle System
    const particleCount = 180;
    const pos = new Float32Array(particleCount * 3);
    this.particleSpeeds = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const h = Math.random() * 1.8 - 0.9;
      const r = (h + 1.0) * 0.7;
      pos[i * 3] = Math.cos(angle) * r;
      pos[i * 3 + 1] = h;
      pos[i * 3 + 2] = Math.sin(angle) * r;
      this.particleSpeeds[i] = 1.0 + Math.random() * 1.5;
    }
    this.particlePositions = pos;

    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pMat = new THREE.PointsMaterial({ color: 0x38bdf8, size: 0.08, transparent: true, opacity: 0.85 });
    this.particles = new THREE.Points(pGeo, pMat);
    group.add(this.particles);
  }

  buildVectorGrid(charcoalMat, goldMat, cyanMat) {
    const group = this.currentModelGroup;

    // 3D Grid of 3x3x3 Directional Arrows
    const size = 3;
    const spacing = 0.65;
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        for (let z = 0; z < size; z++) {
          const posX = (x - 1) * spacing;
          const posY = (y - 1) * spacing + 0.2;
          const posZ = (z - 1) * spacing;

          // Velocity vector in a rotational flow field around Y
          const dir = new THREE.Vector3(-posZ, 0.2, posX).normalize();
          const arrowGroup = new THREE.Group();
          arrowGroup.position.set(posX, posY, posZ);

          const mat = y === 1 ? goldMat : cyanMat;
          const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 12), mat);
          shaft.position.y = 0.175;
          const head = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 16), mat);
          head.position.y = 0.35;

          arrowGroup.add(shaft);
          arrowGroup.add(head);

          // Orient arrow in direction
          const quat = new THREE.Quaternion();
          quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
          arrowGroup.quaternion.copy(quat);

          group.add(arrowGroup);
        }
      }
    }
  }

  buildUVUnwrap(charcoalMat, goldMat) {
    const group = this.currentModelGroup;

    // Center base face
    const centerFace = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.9), goldMat);
    centerFace.position.set(0, -0.4, 0);
    centerFace.castShadow = true;
    group.add(centerFace);

    // 4 hinged flaps that peel open
    const flapOffsets = [
      { pos: [0, -0.4, 0.9], rotAxis: 'x', sign: 1 },
      { pos: [0, -0.4, -0.9], rotAxis: 'x', sign: -1 },
      { pos: [0.9, -0.4, 0], rotAxis: 'z', sign: -1 },
      { pos: [-0.9, -0.4, 0], rotAxis: 'z', sign: 1 }
    ];

    flapOffsets.forEach((item, idx) => {
      const flapGroup = new THREE.Group();
      if (item.rotAxis === 'x') {
        flapGroup.position.set(item.pos[0], item.pos[1], item.pos[2] - item.sign * 0.45);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.9), charcoalMat);
        mesh.position.set(0, 0, item.sign * 0.45);
        flapGroup.add(mesh);
      } else {
        flapGroup.position.set(item.pos[0] + item.sign * 0.45, item.pos[1], item.pos[2]);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.9), charcoalMat);
        mesh.position.set(-item.sign * 0.45, 0, 0);
        flapGroup.add(mesh);
      }
      group.add(flapGroup);
      this.cubeFlaps.push({ group: flapGroup, axis: item.rotAxis, sign: item.sign });
    });
  }

  buildMagnet(charcoalMat, goldMat, cyanMat) {
    const group = this.currentModelGroup;

    // Horseshoe Magnet Body
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-0.6, 0.6, 0),
      new THREE.Vector3(0, 1.4, 0),
      new THREE.Vector3(0.6, 0.6, 0)
    );
    const tubeGeo = new THREE.TubeGeometry(curve, 32, 0.18, 16, false);
    const magnetArch = new THREE.Mesh(tubeGeo, charcoalMat);
    group.add(magnetArch);

    // Left North Pole (Red)
    const nPoleMat = new THREE.MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.3 });
    const nPole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.4, 24), nPoleMat);
    nPole.position.set(-0.6, 0.4, 0);
    group.add(nPole);

    // Right South Pole (Blue)
    const sPoleMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.3 });
    const sPole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.4, 24), sPoleMat);
    sPole.position.set(0.6, 0.4, 0);
    group.add(sPole);

    // Magnetic flux line loops (Golden curves)
    for (let r = 0.3; r <= 0.8; r += 0.25) {
      const fluxCurve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(-0.6, 0.2, 0),
        new THREE.Vector3(0, 0.2 - r, 0),
        new THREE.Vector3(0.6, 0.2, 0)
      );
      const fluxTube = new THREE.TubeGeometry(fluxCurve, 24, 0.02, 8, false);
      const flux = new THREE.Mesh(fluxTube, goldMat);
      group.add(flux);
    }
  }

  animate() {
    requestAnimationFrame(this.animate);
    this.animTime += 0.016;

    if (this.controls) this.controls.update();

    if (this.currentModelGroup && this.turntable) {
      this.currentModelGroup.rotation.y += 0.007;
    }

    // Animate Vortex Particles
    if (this.particles && this.particlePositions) {
      const pos = this.particlePositions;
      const count = pos.length / 3;
      for (let i = 0; i < count; i++) {
        let x = pos[i * 3];
        let y = pos[i * 3 + 1];
        let z = pos[i * 3 + 2];
        const angle = 0.04 * this.particleSpeeds[i];
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        pos[i * 3] = x * cosA - z * sinA;
        pos[i * 3 + 2] = x * sinA + z * cosA;
        pos[i * 3 + 1] += 0.005;
        if (pos[i * 3 + 1] > 0.9) pos[i * 3 + 1] = -0.9;
      }
      this.particles.geometry.attributes.position.needsUpdate = true;
    }

    // Animate UV Cube Unwrapping Flaps
    if (this.cubeFlaps && this.cubeFlaps.length > 0) {
      const openAngle = (Math.sin(this.animTime * 1.5) * 0.5 + 0.5) * (Math.PI / 2);
      this.cubeFlaps.forEach(flap => {
        if (flap.axis === 'x') {
          flap.group.rotation.x = flap.sign * openAngle;
        } else {
          flap.group.rotation.z = flap.sign * openAngle;
        }
      });
    }

    this.renderer.render(this.scene, this.camera);
  }

  toggleTurntable() {
    this.turntable = !this.turntable;
    return this.turntable;
  }

  toggleWireframe() {
    this.wireframe = !this.wireframe;
    this.loadModel(this.currentModelType);
    return this.wireframe;
  }
}
