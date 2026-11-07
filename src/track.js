import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

export const PALETTE = {
  cyan: 0x22e6ff,
  magenta: 0xff2fbf,
  violet: 0x8b5cff,
  amber: 0xffb020,
  lime: 0x5cff9d,
};

/**
 * Circuit layout. A closed Catmull-Rom loop with elevation, a long sweeper,
 * a hairpin, a chicane and a banked esses section.
 * Units are metres. y is elevation above the void.
 */
const CONTROL_POINTS = [
  [0, 6, 0],
  [150, 6, -55],
  [310, 10, -45],
  [420, 16, 60],
  [400, 22, 185],
  [285, 20, 235],
  [175, 14, 185],
  [155, 10, 85],
  [70, 8, 40],
  [-40, 4, 85],
  [-130, 8, 175],
  [-245, 12, 170],
  [-315, 6, 70],
  [-290, 0, -50],
  [-190, -2, -100],
  [-80, 2, -60],
];

function makeGridTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#05070d';
  g.fillRect(0, 0, 256, 512);

  // subtle asphalt noise
  const noise = g.getImageData(0, 0, 256, 512);
  for (let i = 0; i < noise.data.length; i += 4) {
    const n = Math.random() * 12;
    noise.data[i] += n;
    noise.data[i + 1] += n;
    noise.data[i + 2] += n * 1.4;
  }
  g.putImageData(noise, 0, 0);

  // transverse light seams give a strong speed read
  g.strokeStyle = 'rgba(34,230,255,0.16)';
  g.lineWidth = 3;
  for (let y = 0; y < 512; y += 128) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
  }

  // edge lines
  g.strokeStyle = 'rgba(255,47,191,0.55)';
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(5, 0);
  g.lineTo(5, 512);
  g.moveTo(251, 0);
  g.lineTo(251, 512);
  g.stroke();

  // dashed centre line
  g.strokeStyle = 'rgba(140,180,255,0.20)';
  g.lineWidth = 4;
  g.setLineDash([46, 60]);
  g.beginPath();
  g.moveTo(128, 0);
  g.lineTo(128, 512);
  g.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Track {
  constructor(scene) {
    this.scene = scene;
    this.points = CONTROL_POINTS.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    this.curve = new THREE.CatmullRomCurve3(this.points, true, 'catmullrom', 0.5);
    this.length = this.curve.getLength();
    this.N = 1600;

    this._buildSamples();
    this._buildSurface();
    this._buildBarriers();
    this._buildGate();
    this._buildDecor();

    this.boostPads = this._makeBoostPads();
    this.group.name = 'track';
    scene.add(this.group);
  }

  /* ---------------------------------------------------------------- samples */

  _buildSamples() {
    const N = this.N;
    const samples = (this.samples = new Array(N));

    for (let i = 0; i < N; i++) {
      const t = i / N;
      const pos = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t).normalize();
      // true "right of travel" = tangent x up
      const right = new THREE.Vector3().crossVectors(tangent, UP).normalize();
      samples[i] = {
        t,
        pos,
        tangent,
        right,
        dist: t * this.length,
        curv: 0,
        bank: 0,
        hw: 17,
      };
    }

    // signed curvature from tangent delta
    for (let i = 0; i < N; i++) {
      const a = samples[i];
      const b = samples[(i + 1) % N];
      const d = new THREE.Vector3().subVectors(b.tangent, a.tangent);
      const segLen = this.length / N; // metres of arc between samples
      a.curv = d.dot(a.right) / segLen; // ~= 1 / corner radius
    }

    // smooth curvature so banking and width don't chatter
    const raw = samples.map((s) => s.curv);
    const W = 9;
    for (let i = 0; i < N; i++) {
      let sum = 0;
      for (let k = -W; k <= W; k++) sum += raw[(i + k + N) % N];
      samples[i].curv = sum / (W * 2 + 1);
    }

    for (let i = 0; i < N; i++) {
      const s = samples[i];
      const c = s.curv;
      s.hw = 17.5 - Math.min(5.5, Math.abs(c) * 420);
      // bank into corners: outside edge rides higher
      // outer edge rides ~0.16 rad max; positive c = right-hand corner
      s.bank = THREE.MathUtils.clamp(-c * 14, -0.16, 0.16);
    }

    // smooth banking
    const banks = samples.map((s) => s.bank);
    for (let i = 0; i < N; i++) {
      let sum = 0;
      for (let k = -12; k <= 12; k++) sum += banks[(i + k + N) % N];
      samples[i].bank = sum / 25;
    }
  }

  /** World point on the road surface at sample i, lateral t in [-1, 1]. */
  surfacePoint(i, t, out = new THREE.Vector3(), yLift = 0) {
    const s = this.samples[(i + this.N) % this.N];
    const lateral = t * s.hw;
    out.copy(s.pos).addScaledVector(s.right, lateral);
    out.y += s.bank * lateral + yLift;
    return out;
  }

  /** Nearest sample index to a world position, searching near a hint. */
  nearestIndex(pos, hint = -1, window = 40) {
    const N = this.N;
    if (hint < 0) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < N; i += 4) {
        const d = this.samples[i].pos.distanceToSquared(pos);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return this._refine(pos, best, 6);
    }
    return this._refine(pos, hint, window);
  }

  _refine(pos, center, window) {
    const N = this.N;
    let best = center;
    let bestD = this.samples[(center + N) % N].pos.distanceToSquared(pos);
    for (let k = -window; k <= window; k++) {
      const i = (center + k + N * 2) % N;
      const d = this.samples[i].pos.distanceToSquared(pos);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Lateral offset (normalised, 1 = edge) and surface height at sample i. */
  lateralAt(i, pos) {
    const s = this.samples[(i + this.N) % this.N];
    const dx = pos.x - s.pos.x;
    const dz = pos.z - s.pos.z;
    const lat = dx * s.right.x + dz * s.right.z;
    const t = lat / s.hw;
    return { t, lat, y: s.pos.y + s.bank * lat, hw: s.hw };
  }

  /* ----------------------------------------------------------------- meshes */

  _ribbonGeometry(tA, tB, yLift, uvRepeat) {
    const N = this.N;
    const positions = new Float32Array((N + 1) * 2 * 3);
    const uvs = new Float32Array((N + 1) * 2 * 2);
    const indices = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();

    for (let i = 0; i <= N; i++) {
      const idx = i % N;
      this.surfacePoint(idx, tA, a, yLift);
      this.surfacePoint(idx, tB, b, yLift);
      const o = i * 6;
      positions[o] = a.x;
      positions[o + 1] = a.y;
      positions[o + 2] = a.z;
      positions[o + 3] = b.x;
      positions[o + 4] = b.y;
      positions[o + 5] = b.z;
      const u = i * 4;
      const v = (i / N) * uvRepeat;
      uvs[u] = 0;
      uvs[u + 1] = v;
      uvs[u + 2] = 1;
      uvs[u + 3] = v;
      if (i < N) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /** Vertical wall ribbon at lateral t. */
  _wallGeometry(t, height, flip) {
    const N = this.N;
    const positions = new Float32Array((N + 1) * 2 * 3);
    const uvs = new Float32Array((N + 1) * 2 * 2);
    const indices = [];
    const p = new THREE.Vector3();

    for (let i = 0; i <= N; i++) {
      const idx = i % N;
      this.surfacePoint(idx, t, p, 0);
      const o = i * 6;
      positions[o] = p.x;
      positions[o + 1] = p.y;
      positions[o + 2] = p.z;
      positions[o + 3] = p.x;
      positions[o + 4] = p.y + height;
      positions[o + 5] = p.z;
      const u = i * 4;
      uvs[u] = i * 0.35;
      uvs[u + 1] = 0;
      uvs[u + 2] = i * 0.35;
      uvs[u + 3] = 1;
      if (i < N) {
        const base = i * 2;
        if (flip) indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
        else indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  _buildSurface() {
    this.group = new THREE.Group();
    const tex = makeGridTexture();
    tex.repeat.set(1, 1);
    const roadGeo = this._ribbonGeometry(-1, 1, 0, 150);

    const roadMat = new THREE.MeshStandardMaterial({
      map: tex,
      color: 0x9fb4cc,
      roughness: 0.62,
      metalness: 0.42,
      emissive: 0x1a3a55,
      emissiveMap: tex,
      emissiveIntensity: 0.55,
    });

    const road = new THREE.Mesh(roadGeo, roadMat);
    road.receiveShadow = false;
    this.group.add(road);

    // glowing edge strips
    const edgeMatA = new THREE.MeshBasicMaterial({
      color: PALETTE.cyan,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const edgeMatB = new THREE.MeshBasicMaterial({
      color: PALETTE.magenta,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.group.add(new THREE.Mesh(this._ribbonGeometry(-1.0, -0.94, 0.05, 150), edgeMatA));
    this.group.add(new THREE.Mesh(this._ribbonGeometry(0.94, 1.0, 0.05, 150), edgeMatB));
  }

  _buildBarriers() {
    const wallMat = (color) =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

    this.group.add(new THREE.Mesh(this._wallGeometry(-1.06, 2.2, false), wallMat(PALETTE.cyan)));
    this.group.add(new THREE.Mesh(this._wallGeometry(1.06, 2.2, true), wallMat(PALETTE.magenta)));

    // slim bright rails on top of the barriers
    const railMat = new THREE.MeshBasicMaterial({
      color: 0xbfefff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.group.add(new THREE.Mesh(this._ribbonGeometry(-1.08, -1.045, 2.2, 60), railMat));
    this.group.add(new THREE.Mesh(this._ribbonGeometry(1.045, 1.08, 2.2, 60), railMat));

    // pylons
    const N = this.N;
    const step = Math.round(N / 190);
    const count = Math.floor(N / step) * 2;
    const geo = new THREE.BoxGeometry(0.42, 4.2, 0.42);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x131a2c,
      emissive: 0x2bd6ff,
      emissiveIntensity: 2.2,
      roughness: 0.4,
      metalness: 0.7,
    });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3(1, 1, 1);
    let n = 0;
    for (let i = 0; i < N && n < count - 1; i += step) {
      for (const t of [-1.12, 1.12]) {
        this.surfacePoint(i, t, p, 2.1);
        q.setFromAxisAngle(UP, Math.atan2(this.samples[i].tangent.x, this.samples[i].tangent.z));
        m.compose(p, q, sc);
        inst.setMatrixAt(n, m);
        inst.setColorAt(n, new THREE.Color(t < 0 ? PALETTE.cyan : PALETTE.magenta));
        n++;
      }
    }
    inst.count = n;
    this.group.add(inst);
  }

  _makeGate(color, s, labelText) {
    const i = Math.round(s * this.N) % this.N;
    const sample = this.samples[i];
    const g = new THREE.Group();
    const accent = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x0d1424,
      emissive: color,
      emissiveIntensity: 1.4,
      metalness: 0.8,
      roughness: 0.35,
    });

    const H = 9.5;
    const W = sample.hw * 1.16;
    const legGeo = new THREE.BoxGeometry(0.9, H, 0.9);
    for (const sgn of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, frameMat);
      leg.position.set(sgn * W, H / 2, 0);
      g.add(leg);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 0.9, 1.1, 1.1), frameMat);
    beam.position.set(0, H, 0);
    g.add(beam);

    // light bar across the gate
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, 1.5), accent);
    bar.position.set(0, H - 1.3, 0);
    g.add(bar);

    // ground strip
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, 2.2), accent);
    strip.rotation.x = -Math.PI / 2;
    strip.position.y = 0.12;
    g.add(strip);

    g.position.copy(sample.pos);
    g.position.y += 0;
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), sample.tangent);
    g.position.addScaledVector(sample.tangent, 0);
    g.userData.gateIndex = Math.round(s * this.N);
    g.userData.color = color;
    g.userData.phase = s * Math.PI * 2;
    return g;
  }

  _buildGate() {
    // start / finish gantry
    const start = this._makeGate(PALETTE.cyan, 0);
    start.name = 'startGate';
    this.startGate = start;
    this.group.add(start);

    // checkered start line
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 32;
    const g = c.getContext('2d');
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 2; y++) {
        g.fillStyle = (x + y) % 2 === 0 ? '#e8f6ff' : '#0a0f1a';
        g.fillRect(x * 16, y * 16, 16, 16);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = this.samples[0];
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(s.hw * 2, 3.2),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9 })
    );
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = -Math.PI / 2;
    line.position.copy(s.pos);
    line.position.y += 0.07;
    line.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    // align with track tangent
    const dir = Math.atan2(s.tangent.x, s.tangent.z);
    line.rotation.z = -dir;
    this.group.add(line);
  }

  _buildDecor() {
    const N = this.N;

    // floating arches along the course
    const archMat = new THREE.MeshStandardMaterial({
      color: 0x0b1120,
      emissive: PALETTE.violet,
      emissiveIntensity: 1.5,
      metalness: 0.75,
      roughness: 0.3,
    });
    const archGeo = new THREE.TorusGeometry(1, 0.09, 6, 26, Math.PI);
    const archCount = 34;
    const arches = new THREE.InstancedMesh(archGeo, archMat, archCount);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    let n = 0;
    for (let k = 0; k < archCount; k++) {
      const i = Math.floor((k / archCount) * N) + Math.floor(N / archCount / 2);
      const s = this.samples[i % N];
      const side = k % 2 === 0 ? 1 : -1;
      this.surfacePoint(i % N, side * 1.9, p, 0);
      p.y += 16 + (k % 3) * 6;
      const e = new THREE.Euler(0, Math.atan2(s.tangent.x, s.tangent.z), 0);
      q.setFromEuler(e);
      const r = 5 + (k % 5);
      m.compose(p, q, new THREE.Vector3(r, r, r));
      arches.setMatrixAt(n++, m);
    }
    arches.count = n;
    this.group.add(arches);

    // distant neon shards drifting in the void
    const shardGeo = new THREE.IcosahedronGeometry(1, 0);
    const shardMat = new THREE.MeshStandardMaterial({
      color: 0x0a0f1c,
      emissive: 0x2a4c8a,
      emissiveIntensity: 1.1,
      metalness: 0.9,
      roughness: 0.25,
      flatShading: true,
    });
    const shardCount = 260;
    const shards = new THREE.InstancedMesh(shardGeo, shardMat, shardCount);
    for (let k = 0; k < shardCount; k++) {
      const s = this.samples[(k * 37) % N];
      const side = k % 2 === 0 ? 1 : -1;
      p.copy(s.pos)
        .addScaledVector(s.right, side * (45 + Math.random() * 140))
        .add(new THREE.Vector3((Math.random() - 0.5) * 120, -40 + Math.random() * 120, (Math.random() - 0.5) * 120));
      q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      const r = 2 + Math.random() * 9;
      m.compose(p, q, new THREE.Vector3(r * (0.4 + Math.random()), r, r * (0.4 + Math.random())));
      shards.setMatrixAt(k, m);
    }
    this.group.add(shards);

    // void floor grid
    const gc = document.createElement('canvas');
    gc.width = gc.height = 512;
    const gg = gc.getContext('2d');
    gg.fillStyle = '#04060c';
    gg.fillRect(0, 0, 512, 512);
    gg.strokeStyle = 'rgba(34,150,255,0.30)';
    gg.lineWidth = 2;
    for (let i = 0; i <= 512; i += 64) {
      gg.beginPath();
      gg.moveTo(i, 0);
      gg.lineTo(i, 512);
      gg.moveTo(0, i);
      gg.lineTo(512, i);
      gg.stroke();
    }
    const gtex = new THREE.CanvasTexture(gc);
    gtex.wrapS = gtex.wrapT = THREE.RepeatWrapping;
    gtex.repeat.set(60, 60);
    gtex.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000),
      new THREE.MeshBasicMaterial({ map: gtex, color: 0x405a80, fog: true })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -70;
    this.group.add(floor);

    // stars
    const starGeo = new THREE.BufferGeometry();
    const sp = new Float32Array(1500 * 3);
    for (let i = 0; i < 1500; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(2200 + Math.random() * 900);
      if (v.y < -200) v.y = Math.abs(v.y);
      sp[i * 3] = v.x;
      sp[i * 3 + 1] = v.y;
      sp[i * 3 + 2] = v.z;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0x9fcfff, size: 3.2, sizeAttenuation: true, fog: false, transparent: true, opacity: 0.8 })
    );
    this.group.add(stars);
  }

  _makeBoostPads() {
    const pads = [];
    const mat = new THREE.MeshBasicMaterial({
      color: PALETTE.lime,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const layout = [
      [0.12, -0.35],
      [0.3, 0.4],
      [0.47, 0.05],
      [0.62, -0.5],
      [0.79, 0.45],
      [0.9, -0.1],
    ];
    for (const [s, lateral] of layout) {
      const i = Math.round(s * this.N) % this.N;
      const sample = this.samples[i];
      const geo = new THREE.PlaneGeometry(sample.hw * 0.55, 7);
      const mesh = new THREE.Mesh(geo, mat.clone());
      const p = this.surfacePoint(i, lateral, new THREE.Vector3(), 0.09);
      mesh.position.copy(p);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = -Math.atan2(sample.tangent.x, sample.tangent.z);
      this.group.add(mesh);
      pads.push({ index: i, mesh, cooldown: 0 });
    }
    return pads;
  }

  update(dt, elapsed) {
    for (const pad of this.boostPads) {
      pad.cooldown = Math.max(0, pad.cooldown - dt);
      const pulse = 0.35 + 0.3 * Math.sin(elapsed * 7 + pad.index);
      pad.mesh.material.opacity = pad.cooldown > 0 ? 0.08 : pulse;
    }
    if (this.startGate) {
      this.startGate.userData.phase = elapsed;
    }
  }
}
