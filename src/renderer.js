import { clamp, lerp } from './simulation.js';

const TAU = Math.PI * 2;

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function rgb(red, green, blue, alpha = 1) {
  return `rgba(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)}, ${alpha})`;
}

/**
 * Canvas renderer for the reference implementation. Rendering is purposefully
 * separate from the simulation: the same HybridFluidSimulation can feed a
 * WebGPU mesh/compute renderer without changing any fluid state or contacts.
 */
export class HydroRenderer {
  constructor(canvas, simulation) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.simulation = simulation;
    this.options = {
      showGrid: true,
      showFoam: true,
      showVolume: true,
      showContacts: true,
      showClipmaps: false,
      quality: 2,
      exposure: 1,
    };
    this.camera = {
      target: [0, 0, 27],
      azimuth: 0,
      elevation: 0.31,
      distance: 51,
      fieldOfView: 49,
    };
    this.size = { width: 0, height: 0, pixelRatio: 1 };
    this.drag = null;
    this.lastWaterMesh = null;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.#bindPointerControls();
  }

  destroy() {
    this.resizeObserver.disconnect();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * pixelRatio));
    const height = Math.max(1, Math.round(rect.height * pixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.size = { width: rect.width, height: rect.height, pixelRatio };
  }

  setOption(name, value) {
    this.options[name] = value;
  }

  setQuality(value) {
    this.options.quality = Number(value);
  }

  #cameraBasis() {
    const { target, azimuth, elevation, distance } = this.camera;
    const horizontal = Math.cos(elevation) * distance;
    const position = [
      target[0] + Math.sin(azimuth) * horizontal,
      target[1] + Math.sin(elevation) * distance,
      target[2] - Math.cos(azimuth) * horizontal,
    ];
    const forward = normalize([target[0] - position[0], target[1] - position[1], target[2] - position[2]]);
    const right = normalize(cross(forward, [0, 1, 0]));
    const up = normalize(cross(right, forward));
    return { position, forward, right, up };
  }

  #project(world, basis) {
    const { width, height } = this.size;
    const relative = [world[0] - basis.position[0], world[1] - basis.position[1], world[2] - basis.position[2]];
    const depth = dot(relative, basis.forward);
    if (depth <= 0.05) return null;
    const horizontal = dot(relative, basis.right);
    const vertical = dot(relative, basis.up);
    const focal = (height * 0.5) / Math.tan((this.camera.fieldOfView * Math.PI / 180) * 0.5);
    return {
      x: width * 0.5 + (horizontal * focal) / depth,
      y: height * 0.5 - (vertical * focal) / depth,
      depth,
    };
  }

  #worldRay(screenX, screenY, basis) {
    const { width, height } = this.size;
    const normalizedX = (screenX / width) * 2 - 1;
    const normalizedY = 1 - (screenY / height) * 2;
    const tangent = Math.tan((this.camera.fieldOfView * Math.PI / 180) * 0.5);
    const aspect = width / Math.max(height, 1);
    return normalize([
      basis.forward[0] + basis.right[0] * normalizedX * tangent * aspect + basis.up[0] * normalizedY * tangent,
      basis.forward[1] + basis.right[1] * normalizedX * tangent * aspect + basis.up[1] * normalizedY * tangent,
      basis.forward[2] + basis.right[2] * normalizedX * tangent * aspect + basis.up[2] * normalizedY * tangent,
    ]);
  }

  pickWater(screenX, screenY) {
    const basis = this.#cameraBasis();
    const ray = this.#worldRay(screenX, screenY, basis);
    if (Math.abs(ray[1]) < 0.0001) return null;
    const distance = -basis.position[1] / ray[1];
    if (distance <= 0 || distance > 230) return null;
    const x = basis.position[0] + ray[0] * distance;
    const z = basis.position[2] + ray[2] * distance;
    const water = this.simulation.ocean.sample(x, z, this.simulation.time);
    return { x, z, y: water.height, distance };
  }

  #bindPointerControls() {
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.canvas.addEventListener('pointerdown', (event) => {
      this.canvas.setPointerCapture(event.pointerId);
      const localX = event.clientX - this.canvas.getBoundingClientRect().left;
      const localY = event.clientY - this.canvas.getBoundingClientRect().top;
      this.drag = {
        pointerId: event.pointerId,
        x: localX,
        y: localY,
        startedX: localX,
        startedY: localY,
        mode: event.button === 2 || event.shiftKey || event.altKey ? 'camera' : 'impact',
      };
    });

    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.drag || this.drag.pointerId !== event.pointerId || this.drag.mode !== 'camera') return;
      const localX = event.clientX - this.canvas.getBoundingClientRect().left;
      const localY = event.clientY - this.canvas.getBoundingClientRect().top;
      this.camera.azimuth += (localX - this.drag.x) * 0.008;
      this.camera.elevation = clamp(this.camera.elevation + (localY - this.drag.y) * 0.006, 0.10, 1.02);
      this.drag.x = localX;
      this.drag.y = localY;
    });

    const release = (event) => {
      if (!this.drag || this.drag.pointerId !== event.pointerId) return;
      const drag = this.drag;
      this.drag = null;
      try { this.canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
      const movement = Math.hypot(drag.x - drag.startedX, drag.y - drag.startedY);
      if (drag.mode === 'impact' && movement < 7) {
        const water = this.pickWater(drag.x, drag.y);
        if (water) this.simulation.spawnImpact({ x: water.x, z: water.z, speed: 8.4, mass: 1, radius: 1.1, source: 'viewport' });
      }
    };
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', release);
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.camera.distance = clamp(this.camera.distance + event.deltaY * 0.032, 23, 115);
    }, { passive: false });
  }

  #paintAtmosphere(context) {
    // `render()` has already applied the device-pixel-ratio transform, so all
    // coordinates below remain in CSS pixels.
    const { width, height } = this.size;
    const w = width;
    const h = height;
    const sky = context.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#071321');
    sky.addColorStop(0.42, '#0a2639');
    sky.addColorStop(0.72, '#113e50');
    sky.addColorStop(1, '#082637');
    context.fillStyle = sky;
    context.fillRect(0, 0, w, h);

    const sunX = w * 0.74;
    const sunY = h * 0.22;
    const glow = context.createRadialGradient(sunX, sunY, 1, sunX, sunY, h * 0.34);
    glow.addColorStop(0, 'rgba(167, 223, 211, 0.19)');
    glow.addColorStop(0.22, 'rgba(104, 191, 186, 0.08)');
    glow.addColorStop(1, 'rgba(12, 36, 51, 0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, w, h);

    context.fillStyle = 'rgba(197, 240, 220, 0.48)';
    context.beginPath();
    context.arc(sunX, sunY, Math.max(2, h * 0.019), 0, TAU);
    context.fill();
  }

  #buildWaterMesh(basis) {
    const quality = this.options.quality;
    const horizontalCells = quality === 1 ? 36 : quality === 2 ? 54 : 72;
    const depthCells = quality === 1 ? 31 : quality === 2 ? 44 : 58;
    const horizontalSpan = quality === 1 ? 142 : quality === 2 ? 166 : 188;
    const depthNear = -18;
    const depthFar = quality === 1 ? 122 : quality === 2 ? 152 : 185;
    const target = this.camera.target;
    const vertices = Array.from({ length: depthCells + 1 }, () => new Array(horizontalCells + 1));
    const cells = [];
    const time = this.simulation.time;

    for (let row = 0; row <= depthCells; row += 1) {
      const z = target[2] + lerp(depthNear, depthFar, row / depthCells);
      for (let column = 0; column <= horizontalCells; column += 1) {
        const x = target[0] + lerp(-horizontalSpan / 2, horizontalSpan / 2, column / horizontalCells);
        const water = this.simulation.ocean.sample(x, z, time);
        const projected = this.#project([x, water.height, z], basis);
        vertices[row][column] = projected ? { ...projected, x, z, water } : null;
      }
    }

    for (let row = 0; row < depthCells; row += 1) {
      for (let column = 0; column < horizontalCells; column += 1) {
        const a = vertices[row][column];
        const b = vertices[row][column + 1];
        const c = vertices[row + 1][column + 1];
        const d = vertices[row + 1][column];
        if (!a || !b || !c || !d) continue;
        const depth = (a.depth + b.depth + c.depth + d.depth) * 0.25;
        cells.push({ a, b, c, d, depth, row, column });
      }
    }
    cells.sort((left, right) => right.depth - left.depth);
    return { vertices, cells, horizontalCells, depthCells };
  }

  #paintWater(context, mesh) {
    const exposure = this.options.exposure;
    for (const cell of mesh.cells) {
      const foam = this.options.showFoam
        ? (cell.a.water.foam + cell.b.water.foam + cell.c.water.foam + cell.d.water.foam) * 0.25
        : 0;
      const height = (cell.a.water.height + cell.b.water.height + cell.c.water.height + cell.d.water.height) * 0.25;
      const disturbance = Math.abs((cell.a.water.disturbance + cell.b.water.disturbance + cell.c.water.disturbance + cell.d.water.disturbance) * 0.25);
      const depthLight = clamp(1 - cell.depth / 190, 0.08, 0.98);
      const shimmer = clamp(0.23 + height * 0.32 + disturbance * 0.18 + depthLight * 0.4, 0, 1);
      const red = (5 + shimmer * 13 + foam * 142) * exposure;
      const green = (32 + shimmer * 74 + foam * 157) * exposure;
      const blue = (51 + shimmer * 87 + foam * 152) * exposure;
      const fog = clamp((cell.depth - 80) / 150, 0, 0.55);
      context.fillStyle = rgb(
        lerp(red, 16, fog),
        lerp(green, 55, fog),
        lerp(blue, 72, fog),
      );
      context.beginPath();
      context.moveTo(cell.a.x, cell.a.y);
      context.lineTo(cell.b.x, cell.b.y);
      context.lineTo(cell.c.x, cell.c.y);
      context.lineTo(cell.d.x, cell.d.y);
      context.closePath();
      context.fill();

      if (this.options.showGrid && (cell.row % 4 === 0 || cell.column % 4 === 0)) {
        context.strokeStyle = `rgba(113, 232, 213, ${0.028 + depthLight * 0.045})`;
        context.lineWidth = 0.55;
        context.stroke();
      }
    }
  }

  #paintClipmapBounds(context, basis) {
    if (!this.options.showClipmaps) return;
    const colors = ['rgba(101, 248, 224, .72)', 'rgba(148, 184, 255, .58)', 'rgba(244, 188, 112, .56)'];
    for (const level of this.simulation.ocean.levels) {
      const x = level.originX;
      const z = level.originZ;
      const size = level.extent;
      const points = [
        this.#project([x, this.simulation.ocean.sample(x, z, this.simulation.time).height + 0.04, z], basis),
        this.#project([x + size, this.simulation.ocean.sample(x + size, z, this.simulation.time).height + 0.04, z], basis),
        this.#project([x + size, this.simulation.ocean.sample(x + size, z + size, this.simulation.time).height + 0.04, z + size], basis),
        this.#project([x, this.simulation.ocean.sample(x, z + size, this.simulation.time).height + 0.04, z + size], basis),
      ];
      if (points.some((point) => !point)) continue;
      context.strokeStyle = colors[level.level % colors.length];
      context.setLineDash([5, 4]);
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
      context.closePath();
      context.stroke();
      context.setLineDash([]);
    }
  }

  #paintContacts(context, basis) {
    if (!this.options.showContacts) return;
    const events = this.simulation.ocean.registrations.filter((event) => event.age < 5.5).slice(0, 14);
    for (const event of events.reverse()) {
      const water = this.simulation.ocean.sample(event.x, event.z, this.simulation.time);
      const projected = this.#project([event.x, water.height + 0.07, event.z], basis);
      if (!projected || projected.x < -80 || projected.x > this.size.width + 80 || projected.y < -80 || projected.y > this.size.height + 80) continue;
      const pulse = clamp(1 - event.age / 5.5, 0, 1);
      const radius = (12 + event.radius * 15 + event.age * 4) / Math.max(0.7, projected.depth / 38);
      context.strokeStyle = `rgba(175, 255, 236, ${pulse * 0.44})`;
      context.lineWidth = 1;
      context.beginPath();
      context.ellipse(projected.x, projected.y, radius, radius * 0.28, 0, 0, TAU);
      context.stroke();
      if (event.age < 1.5) {
        context.fillStyle = `rgba(215, 255, 244, ${pulse * 0.78})`;
        context.font = '10px Inter, ui-sans-serif, sans-serif';
        context.fillText(event.id, projected.x + radius + 3, projected.y - 2);
      }
    }
  }

  #paintParticles(context, basis) {
    if (!this.options.showVolume) return;
    const particles = [];
    for (const particle of this.simulation.particles) {
      const point = this.#project([particle.x, particle.y, particle.z], basis);
      if (!point || point.depth > 235) continue;
      particles.push({ particle, point });
    }
    particles.sort((left, right) => right.point.depth - left.point.depth);
    for (const { particle, point } of particles) {
      const size = clamp((particle.radius * 260) / point.depth, 1.15, 7.5);
      const alpha = clamp(1 - point.depth / 260, 0.14, 0.94) * clamp(particle.life / 0.35, 0.2, 1);
      const trail = this.#project([
        particle.x - particle.vx * 0.035,
        particle.y - particle.vy * 0.035,
        particle.z - particle.vz * 0.035,
      ], basis);
      if (trail) {
        context.strokeStyle = `rgba(161, 232, 246, ${alpha * 0.55})`;
        context.lineWidth = Math.max(0.6, size * 0.47);
        context.beginPath();
        context.moveTo(trail.x, trail.y);
        context.lineTo(point.x, point.y);
        context.stroke();
      }
      const radial = context.createRadialGradient(point.x - size * 0.24, point.y - size * 0.32, 0, point.x, point.y, size);
      radial.addColorStop(0, `rgba(250, 255, 255, ${alpha})`);
      radial.addColorStop(0.42, `rgba(145, 226, 245, ${alpha * 0.94})`);
      radial.addColorStop(1, `rgba(44, 138, 178, ${alpha * 0.1})`);
      context.fillStyle = radial;
      context.beginPath();
      context.arc(point.x, point.y, size, 0, TAU);
      context.fill();
    }
  }

  #paintOverlay(context) {
    const { width, height } = this.size;
    const w = width;
    const h = height;
    const vignette = context.createRadialGradient(w * 0.52, h * 0.48, h * 0.18, w * 0.52, h * 0.48, h * 0.86);
    vignette.addColorStop(0.57, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(1,8,15,.48)');
    context.fillStyle = vignette;
    context.fillRect(0, 0, w, h);
  }

  render() {
    this.resize();
    const { context } = this;
    const { width, height, pixelRatio } = this.size;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    this.#paintAtmosphere(context);
    const basis = this.#cameraBasis();
    const mesh = this.#buildWaterMesh(basis);
    this.lastWaterMesh = mesh;
    this.#paintWater(context, mesh);
    this.#paintClipmapBounds(context, basis);
    this.#paintContacts(context, basis);
    this.#paintParticles(context, basis);
    this.#paintOverlay(context);
  }
}
