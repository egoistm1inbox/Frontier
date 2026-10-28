/*
 * Frontier Hydro Lab
 *
 * A deliberately compact, CPU-readable reference for a hybrid water system:
 *   - infinite procedural swell + camera-following 2.5D height-field clipmaps
 *   - a sparse, chunked 3D particle/grid splash volume
 *   - explicit impact registration that transfers momentum and foam into the
 *     correct surface grid in world space.
 *
 * The data boundaries in this file are intentionally renderer independent.
 * A production renderer can replace the update loops with GPU compute passes
 * while retaining GridTransform, ImpactRecord and the coupling contract.
 */

export const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
export const lerp = (a, b, amount) => a + (b - a) * amount;

const TAU = Math.PI * 2;
const EPSILON = 1e-6;

function fract(value) {
  return value - Math.floor(value);
}

function length3(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize3(vector) {
  const length = length3(vector) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function formatKey(x, y, z) {
  return `${x}:${y}:${z}`;
}

function floorDiv(value, divisor) {
  return Math.floor(value / divisor);
}

/**
 * A general affine grid frame. `basis` contains the world vector for one
 * increment on the grid's x/y/z axes. Keeping this independent from the
 * simulation means a volume can be attached to any rotated or scaled grid,
 * rather than assuming a hard-coded global voxel coordinate system.
 */
export class GridTransform {
  constructor({ origin = [0, 0, 0], basis = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] } = {}) {
    this.origin = [...origin];
    this.basis = basis.map((axis) => [...axis]);
    this.inverse = this.#invertBasis();
  }

  #invertBasis() {
    const [a, b, c] = this.basis;
    const determinant = dot3(a, cross3(b, c));
    if (Math.abs(determinant) < EPSILON) {
      throw new Error('GridTransform basis must be invertible.');
    }

    // The rows of the inverse map world-space deltas to grid coordinates.
    const reciprocal = 1 / determinant;
    return [
      cross3(b, c).map((value) => value * reciprocal),
      cross3(c, a).map((value) => value * reciprocal),
      cross3(a, b).map((value) => value * reciprocal),
    ];
  }

  worldToGrid(position) {
    const delta = [
      position[0] - this.origin[0],
      position[1] - this.origin[1],
      position[2] - this.origin[2],
    ];
    return this.inverse.map((row) => dot3(row, delta));
  }

  gridToWorld(coordinate) {
    return [
      this.origin[0] + this.basis[0][0] * coordinate[0] + this.basis[1][0] * coordinate[1] + this.basis[2][0] * coordinate[2],
      this.origin[1] + this.basis[0][1] * coordinate[0] + this.basis[1][1] * coordinate[1] + this.basis[2][1] * coordinate[2],
      this.origin[2] + this.basis[0][2] * coordinate[0] + this.basis[1][2] * coordinate[1] + this.basis[2][2] * coordinate[2],
    ];
  }

  worldToCell(position) {
    const grid = this.worldToGrid(position);
    return [Math.floor(grid[0]), Math.floor(grid[1]), Math.floor(grid[2])];
  }
}

/**
 * Sparse cells are allocated per touched chunk. The grid stores the
 * particle-to-grid (P2G) accumulation that a FLIP/APIC GPU solver would use
 * for pressure projection. This reference keeps it sparse and observable for
 * the editor, rather than allocating an ocean-sized 3D texture.
 */
export class SparseVolumeGrid {
  constructor({ cellSize = 0.28, chunkSize = 8, transform } = {}) {
    this.cellSize = cellSize;
    this.chunkSize = chunkSize;
    this.transform = transform || new GridTransform({
      basis: [[cellSize, 0, 0], [0, cellSize, 0], [0, 0, cellSize]],
    });
    this.chunks = new Map();
    this.frame = 0;
  }

  get cellsPerChunk() {
    return this.chunkSize ** 3;
  }

  #chunkForCell(cell, create = true) {
    const chunkCoordinate = [
      floorDiv(cell[0], this.chunkSize),
      floorDiv(cell[1], this.chunkSize),
      floorDiv(cell[2], this.chunkSize),
    ];
    const key = formatKey(...chunkCoordinate);
    let chunk = this.chunks.get(key);
    if (!chunk && create) {
      const count = this.cellsPerChunk;
      chunk = {
        key,
        coordinate: chunkCoordinate,
        mass: new Float32Array(count),
        momentumX: new Float32Array(count),
        momentumY: new Float32Array(count),
        momentumZ: new Float32Array(count),
        foam: new Float32Array(count),
        occupied: 0,
        lastTouched: this.frame,
      };
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  #localIndex(cell) {
    const x = ((cell[0] % this.chunkSize) + this.chunkSize) % this.chunkSize;
    const y = ((cell[1] % this.chunkSize) + this.chunkSize) % this.chunkSize;
    const z = ((cell[2] % this.chunkSize) + this.chunkSize) % this.chunkSize;
    return x + y * this.chunkSize + z * this.chunkSize * this.chunkSize;
  }

  beginFrame() {
    this.frame += 1;
    for (const chunk of this.chunks.values()) {
      chunk.mass.fill(0);
      chunk.momentumX.fill(0);
      chunk.momentumY.fill(0);
      chunk.momentumZ.fill(0);
      chunk.foam.fill(0);
      chunk.occupied = 0;
    }
  }

  #depositCell(cell, mass, velocity, foam) {
    if (mass <= EPSILON) return null;
    const chunk = this.#chunkForCell(cell);
    const index = this.#localIndex(cell);
    if (chunk.mass[index] === 0) chunk.occupied += 1;
    chunk.mass[index] += mass;
    chunk.momentumX[index] += velocity[0] * mass;
    chunk.momentumY[index] += velocity[1] * mass;
    chunk.momentumZ[index] += velocity[2] * mass;
    chunk.foam[index] += foam;
    chunk.lastTouched = this.frame;
    return { chunk, index };
  }

  #massAtCell(cell) {
    const chunk = this.#chunkForCell(cell, false);
    if (!chunk) return 0;
    return chunk.mass[this.#localIndex(cell)];
  }

  deposit(position, mass, velocity, foam = 0) {
    // Trilinear P2G deposit. A droplet crosses a cell boundary smoothly and
    // contributes to all eight surrounding voxel nodes instead of popping
    // between a single hard-assigned cell.
    const coordinate = this.transform.worldToGrid(position);
    const base = coordinate.map(Math.floor);
    const fraction = coordinate.map((value, axis) => value - base[axis]);
    let primary = null;
    for (let z = 0; z <= 1; z += 1) {
      for (let y = 0; y <= 1; y += 1) {
        for (let x = 0; x <= 1; x += 1) {
          const weight = (x ? fraction[0] : 1 - fraction[0])
            * (y ? fraction[1] : 1 - fraction[1])
            * (z ? fraction[2] : 1 - fraction[2]);
          const cell = [base[0] + x, base[1] + y, base[2] + z];
          const stored = this.#depositCell(cell, mass * weight, velocity, foam * weight);
          if (x === 0 && y === 0 && z === 0 && stored) {
            primary = { cell, chunk: stored.chunk.coordinate, localIndex: stored.index };
          }
        }
      }
    }
    return primary || { cell: base, chunk: [0, 0, 0], localIndex: 0 };
  }

  sampleCell(position) {
    const cell = this.transform.worldToCell(position);
    const chunk = this.#chunkForCell(cell, false);
    if (!chunk) return { mass: 0, velocity: [0, 0, 0], foam: 0, cell };
    const index = this.#localIndex(cell);
    const mass = chunk.mass[index];
    return {
      mass,
      velocity: mass > EPSILON
        ? [chunk.momentumX[index] / mass, chunk.momentumY[index] / mass, chunk.momentumZ[index] / mass]
        : [0, 0, 0],
      foam: chunk.foam[index],
      cell,
    };
  }

  sampleDensityGradient(position) {
    const coordinate = this.transform.worldToGrid(position);
    const base = coordinate.map(Math.floor);
    const fraction = coordinate.map((value, axis) => value - base[axis]);
    const massAt = (offsetX, offsetY, offsetZ) => this.#massAtCell([
      base[0] + offsetX,
      base[1] + offsetY,
      base[2] + offsetZ,
    ]);
    const trilinear = (offsetX = 0, offsetY = 0, offsetZ = 0) => {
      let total = 0;
      for (let z = 0; z <= 1; z += 1) {
        for (let y = 0; y <= 1; y += 1) {
          for (let x = 0; x <= 1; x += 1) {
            const weight = (x ? fraction[0] : 1 - fraction[0])
              * (y ? fraction[1] : 1 - fraction[1])
              * (z ? fraction[2] : 1 - fraction[2]);
            total += massAt(x + offsetX, y + offsetY, z + offsetZ) * weight;
          }
        }
      }
      return total;
    };
    const density = trilinear();
    const gradientInGrid = [
      (trilinear(1, 0, 0) - trilinear(-1, 0, 0)) * 0.5,
      (trilinear(0, 1, 0) - trilinear(0, -1, 0)) * 0.5,
      (trilinear(0, 0, 1) - trilinear(0, 0, -1)) * 0.5,
    ];
    // inverse rows map a grid-coordinate gradient back into world-space.
    const gradient = [0, 0, 0];
    for (let axis = 0; axis < 3; axis += 1) {
      gradient[0] += this.transform.inverse[axis][0] * gradientInGrid[axis];
      gradient[1] += this.transform.inverse[axis][1] * gradientInGrid[axis];
      gradient[2] += this.transform.inverse[axis][2] * gradientInGrid[axis];
    }
    return { density, gradient };
  }

  prune(maximumAge = 3) {
    for (const [key, chunk] of this.chunks) {
      if (this.frame - chunk.lastTouched > maximumAge) this.chunks.delete(key);
    }
  }

  get activeChunkCount() {
    let active = 0;
    for (const chunk of this.chunks.values()) {
      if (chunk.occupied > 0) active += 1;
    }
    return active;
  }

  get occupiedCellCount() {
    let occupied = 0;
    for (const chunk of this.chunks.values()) occupied += chunk.occupied;
    return occupied;
  }
}

/** A camera-following shallow-water tile. */
export class HeightFieldLevel {
  constructor({ resolution = 96, cellSize = 0.45, center = [0, 22], level = 0 } = {}) {
    this.resolution = resolution;
    this.cellSize = cellSize;
    this.level = level;
    this.originX = Math.floor((center[0] - (resolution * cellSize) / 2) / cellSize) * cellSize;
    this.originZ = Math.floor((center[1] - (resolution * cellSize) / 2) / cellSize) * cellSize;
    this.height = new Float32Array(resolution * resolution);
    this.velocity = new Float32Array(resolution * resolution);
    this.foam = new Float32Array(resolution * resolution);
    this.nextHeight = new Float32Array(resolution * resolution);
    this.nextVelocity = new Float32Array(resolution * resolution);
    this.nextFoam = new Float32Array(resolution * resolution);
  }

  get extent() {
    return this.resolution * this.cellSize;
  }

  #index(x, z) {
    return x + z * this.resolution;
  }

  containsWorld(x, z, margin = 0) {
    return x >= this.originX + margin
      && z >= this.originZ + margin
      && x < this.originX + this.extent - margin
      && z < this.originZ + this.extent - margin;
  }

  worldToCell(x, z) {
    return [(x - this.originX) / this.cellSize, (z - this.originZ) / this.cellSize];
  }

  cellToWorld(x, z) {
    return [this.originX + x * this.cellSize, this.originZ + z * this.cellSize];
  }

  recenter(centerX, centerZ) {
    const desiredX = Math.floor((centerX - this.extent / 2) / this.cellSize) * this.cellSize;
    const desiredZ = Math.floor((centerZ - this.extent / 2) / this.cellSize) * this.cellSize;
    const shiftX = Math.round((desiredX - this.originX) / this.cellSize);
    const shiftZ = Math.round((desiredZ - this.originZ) / this.cellSize);
    if (shiftX === 0 && shiftZ === 0) return false;

    const sourceHeight = this.height;
    const sourceVelocity = this.velocity;
    const sourceFoam = this.foam;
    const count = this.resolution * this.resolution;
    const height = new Float32Array(count);
    const velocity = new Float32Array(count);
    const foam = new Float32Array(count);

    for (let z = 0; z < this.resolution; z += 1) {
      const sourceZ = z + shiftZ;
      if (sourceZ < 0 || sourceZ >= this.resolution) continue;
      for (let x = 0; x < this.resolution; x += 1) {
        const sourceX = x + shiftX;
        if (sourceX < 0 || sourceX >= this.resolution) continue;
        const target = this.#index(x, z);
        const source = this.#index(sourceX, sourceZ);
        height[target] = sourceHeight[source];
        velocity[target] = sourceVelocity[source];
        foam[target] = sourceFoam[source];
      }
    }

    this.originX = desiredX;
    this.originZ = desiredZ;
    this.height = height;
    this.velocity = velocity;
    this.foam = foam;
    this.nextHeight.fill(0);
    this.nextVelocity.fill(0);
    this.nextFoam.fill(0);
    return true;
  }

  inject(x, z, { momentum = 0.6, radius = 1.2, foam = 0.15, displacement = 0 } = {}) {
    const [centerX, centerZ] = this.worldToCell(x, z);
    const radiusInCells = Math.max(1.25, radius / this.cellSize);
    const minX = Math.max(1, Math.floor(centerX - radiusInCells * 2.25));
    const maxX = Math.min(this.resolution - 2, Math.ceil(centerX + radiusInCells * 2.25));
    const minZ = Math.max(1, Math.floor(centerZ - radiusInCells * 2.25));
    const maxZ = Math.min(this.resolution - 2, Math.ceil(centerZ + radiusInCells * 2.25));
    let touched = 0;

    for (let cellZ = minZ; cellZ <= maxZ; cellZ += 1) {
      for (let cellX = minX; cellX <= maxX; cellX += 1) {
        const dx = (cellX - centerX) / radiusInCells;
        const dz = (cellZ - centerZ) / radiusInCells;
        const distanceSquared = dx * dx + dz * dz;
        if (distanceSquared > 5.2) continue;
        const falloff = Math.exp(-distanceSquared * 1.65);
        const index = this.#index(cellX, cellZ);
        this.velocity[index] += momentum * falloff;
        this.height[index] += displacement * falloff;
        this.foam[index] = clamp(this.foam[index] + foam * falloff, 0, 1.5);
        touched += 1;
      }
    }
    return touched;
  }

  update(deltaTime, { waveResponse, damping, foamPersistence, foamGain }) {
    const n = this.resolution;
    const inverseCellSizeSquared = 1 / (this.cellSize * this.cellSize);
    const responseSquared = waveResponse * waveResponse;
    const foamDecay = Math.exp(-deltaTime / Math.max(0.15, foamPersistence));
    const velocityDamping = Math.exp(-damping * deltaTime);

    for (let z = 0; z < n; z += 1) {
      for (let x = 0; x < n; x += 1) {
        const index = this.#index(x, z);
        if (x === 0 || z === 0 || x === n - 1 || z === n - 1) {
          this.nextHeight[index] = this.height[index] * 0.82;
          this.nextVelocity[index] = 0;
          this.nextFoam[index] = this.foam[index] * foamDecay;
          continue;
        }
        const laplacian = (
          this.height[this.#index(x - 1, z)]
          + this.height[this.#index(x + 1, z)]
          + this.height[this.#index(x, z - 1)]
          + this.height[this.#index(x, z + 1)]
          - 4 * this.height[index]
        ) * inverseCellSizeSquared;
        const velocity = (this.velocity[index] + responseSquared * laplacian * deltaTime) * velocityDamping;
        const height = clamp(this.height[index] + velocity * deltaTime, -2.5, 2.5);
        const whitecap = Math.max(0, Math.abs(laplacian) * this.cellSize * foamGain - 0.18);
        this.nextHeight[index] = height;
        this.nextVelocity[index] = velocity;
        this.nextFoam[index] = clamp(this.foam[index] * foamDecay + whitecap * deltaTime, 0, 1.4);
      }
    }

    [this.height, this.nextHeight] = [this.nextHeight, this.height];
    [this.velocity, this.nextVelocity] = [this.nextVelocity, this.velocity];
    [this.foam, this.nextFoam] = [this.nextFoam, this.foam];
  }

  sample(x, z) {
    const localX = (x - this.originX) / this.cellSize;
    const localZ = (z - this.originZ) / this.cellSize;
    if (localX < 0 || localZ < 0 || localX >= this.resolution - 1 || localZ >= this.resolution - 1) return null;
    const x0 = Math.floor(localX);
    const z0 = Math.floor(localZ);
    const x1 = x0 + 1;
    const z1 = z0 + 1;
    const fractionX = localX - x0;
    const fractionZ = localZ - z0;
    const index00 = this.#index(x0, z0);
    const index10 = this.#index(x1, z0);
    const index01 = this.#index(x0, z1);
    const index11 = this.#index(x1, z1);
    const blend = (data) => lerp(
      lerp(data[index00], data[index10], fractionX),
      lerp(data[index01], data[index11], fractionX),
      fractionZ,
    );
    return { height: blend(this.height), foam: blend(this.foam) };
  }
}

/**
 * The large-area water representation. The clipmaps carry only local,
 * interactive disturbances; low-frequency, world-space swell has no boundary
 * and makes the water appear continuous well outside the active simulation.
 */
export class OceanSurface {
  constructor(parameters, center = [0, 22]) {
    this.parameters = parameters;
    this.center = [...center];
    this.levels = [];
    this.registrations = [];
    this.rebuild(parameters, center);
  }

  rebuild(parameters = this.parameters, center = this.center) {
    this.parameters = parameters;
    this.center = [...center];
    const resolution = Math.round(parameters.surfaceResolution);
    const baseCellSize = parameters.surfaceCellSize;
    const levelCount = Math.round(parameters.clipmapLevels);
    this.levels = Array.from({ length: levelCount }, (_, level) => new HeightFieldLevel({
      resolution,
      cellSize: baseCellSize * (2 ** (level * 1.5)),
      center,
      level,
    }));
  }

  follow(centerX, centerZ) {
    this.center[0] = centerX;
    this.center[1] = centerZ;
    for (const level of this.levels) {
      // Leave a wide guard band so normal camera motion does not churn tiles.
      const gridCenterX = level.originX + level.extent / 2;
      const gridCenterZ = level.originZ + level.extent / 2;
      if (Math.abs(centerX - gridCenterX) > level.extent * 0.23 || Math.abs(centerZ - gridCenterZ) > level.extent * 0.23) {
        level.recenter(centerX, centerZ);
      }
    }
  }

  proceduralSample(x, z, time) {
    const amplitude = this.parameters.waveAmplitude;
    const wind = this.parameters.windSpeed;
    const direction = this.parameters.windDirection;
    const swell = [
      [0.50, 0.042, 0.78, 0.58, 0.0],
      [0.27, 0.085, 1.55, -0.18, 1.7],
      [0.16, 0.17, -0.42, 0.91, 3.3],
      [0.07, 0.36, 0.89, 0.33, 4.8],
    ];
    let height = 0;
    let slopeX = 0;
    let slopeZ = 0;
    for (const [weight, frequency, xDirection, zDirection, phase] of swell) {
      const angle = direction + Math.atan2(zDirection, xDirection);
      const dirX = Math.cos(angle);
      const dirZ = Math.sin(angle);
      const speed = Math.sqrt(9.81 / Math.max(frequency, 0.01)) * (0.72 + wind * 0.021);
      const waveAmplitude = amplitude * weight;
      const argument = (x * dirX + z * dirZ) * frequency - time * speed * frequency + phase;
      height += Math.sin(argument) * waveAmplitude;
      const slope = Math.cos(argument) * waveAmplitude * frequency;
      slopeX += slope * dirX;
      slopeZ += slope * dirZ;
    }
    const foam = clamp((Math.hypot(slopeX, slopeZ) - 0.11) * 1.45, 0, 0.23);
    return { height, foam, slopeX, slopeZ };
  }

  sample(x, z, time) {
    const base = this.proceduralSample(x, z, time);
    let local = null;
    for (const level of this.levels) {
      local = level.sample(x, z);
      if (local) break;
    }
    return {
      height: base.height + (local?.height || 0),
      foam: clamp(base.foam + (local?.foam || 0), 0, 1.5),
      baseHeight: base.height,
      disturbance: local?.height || 0,
    };
  }

  registerImpact({ x, z, energy, radius, foam, source = 'droplet', time = 0 }) {
    const gridHits = [];
    for (const level of this.levels) {
      if (!level.containsWorld(x, z, level.cellSize * 1.5)) continue;
      const [gridX, gridZ] = level.worldToCell(x, z);
      const attenuation = 1 / (1 + level.level * 0.72);
      const cells = level.inject(x, z, {
        momentum: energy * attenuation,
        radius: Math.max(radius, level.cellSize * 1.5),
        foam: foam * attenuation,
        displacement: -energy * 0.018 * attenuation,
      });
      gridHits.push({
        level: level.level,
        cell: [Math.round(gridX), Math.round(gridZ)],
        cells,
      });
    }

    const record = {
      id: `IM-${String(this.registrations.length + 1).padStart(3, '0')}`,
      x,
      z,
      energy,
      radius,
      foam,
      source,
      time,
      gridHits,
      age: 0,
    };
    this.registrations.unshift(record);
    this.registrations.length = Math.min(24, this.registrations.length);
    return record;
  }

  update(deltaTime) {
    for (const level of this.levels) {
      // Coarser cascades evolve at a less stiff, more stable response rate.
      level.update(deltaTime, {
        waveResponse: this.parameters.waveResponse / Math.sqrt(1 + level.level * 0.45),
        damping: this.parameters.surfaceDamping * (1 + level.level * 0.22),
        foamPersistence: this.parameters.foamPersistence,
        foamGain: this.parameters.foamGain,
      });
    }
    for (const registration of this.registrations) registration.age += deltaTime;
  }

  get coverage() {
    return this.levels.map((level) => level.extent);
  }
}

export const defaultParameters = Object.freeze({
  waveAmplitude: 0.78,
  windSpeed: 13,
  windDirection: -0.33,
  waveResponse: 5.4,
  surfaceDamping: 0.42,
  surfaceCellSize: 0.45,
  surfaceResolution: 96,
  clipmapLevels: 3,
  splashIntensity: 1.1,
  dropletCount: 74,
  splashCellSize: 0.28,
  solverIterations: 3,
  coupling: 1.0,
  foamPersistence: 6.5,
  foamGain: 0.72,
  gravity: 9.81,
  timeScale: 1,
  maxParticles: 1600,
});

/**
 * Hybrid coupling controller. A particle reaching the heightfield has its
 * normal momentum mapped into the surface clipmap and its foam transported
 * into the same world-space location. Nothing relies on a screen coordinate,
 * so a moving ocean grid, a rotated local grid, or another world cell can use
 * the exact same contact record.
 */
export class HybridFluidSimulation {
  constructor(parameters = {}) {
    this.parameters = { ...defaultParameters, ...parameters };
    this.time = 0;
    this.frame = 0;
    this.paused = false;
    this.focus = [0, 22];
    this.randomState = 0x6d2b79f5;
    this.particles = [];
    this.contacts = [];
    this.contactSerial = 0;
    this.ocean = new OceanSurface(this.parameters, this.focus);
    this.volume = new SparseVolumeGrid({ cellSize: this.parameters.splashCellSize });
  }

  random() {
    // Deterministic xorshift state: repeatable scenario recordings and tests.
    let state = this.randomState >>> 0;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    this.randomState = state >>> 0;
    return (this.randomState >>> 0) / 4294967296;
  }

  setFocus(x, z) {
    this.focus[0] = x;
    this.focus[1] = z;
    this.ocean.follow(x, z);
  }

  setParameter(name, value) {
    if (!(name in this.parameters)) throw new Error(`Unknown hydro parameter: ${name}`);
    this.parameters[name] = value;
  }

  rebuildSurface() {
    this.ocean.rebuild(this.parameters, this.focus);
  }

  rebuildVolume() {
    this.volume = new SparseVolumeGrid({ cellSize: this.parameters.splashCellSize });
  }

  reset() {
    this.time = 0;
    this.frame = 0;
    this.particles = [];
    this.contacts = [];
    this.contactSerial = 0;
    this.ocean = new OceanSurface(this.parameters, this.focus);
    this.volume = new SparseVolumeGrid({ cellSize: this.parameters.splashCellSize });
  }

  #pushParticle(particle) {
    if (this.particles.length >= this.parameters.maxParticles) this.particles.shift();
    this.particles.push(particle);
  }

  /** Spawn a source that includes falling mass and an immediate crown splash. */
  spawnImpact({ x = 0, z = 24, speed = 8.5, mass = 1, radius = 1.2, source = 'editor' } = {}) {
    const surface = this.ocean.sample(x, z, this.time);
    const count = Math.round(clamp(this.parameters.dropletCount * this.parameters.splashIntensity * Math.sqrt(mass), 12, 260));
    const intensity = speed * this.parameters.splashIntensity * mass;

    // First event is a deterministic emitter/contact registration. The falling
    // particles make secondary contact records when they return to the water.
    const primary = this.ocean.registerImpact({
      x,
      z,
      energy: intensity * 0.075 * this.parameters.coupling,
      radius,
      foam: 0.38 * this.parameters.foamGain,
      source,
      time: this.time,
    });
    this.#recordContact(primary, { type: 'source', velocity: [0, -speed, 0], mass });

    // A compact downward carrier gives the volume a real falling-water path.
    this.#pushParticle({
      x,
      y: surface.height + 2.4 + this.random() * 1.1,
      z,
      vx: (this.random() - 0.5) * 0.35,
      vy: -speed * 0.58,
      vz: (this.random() - 0.5) * 0.35,
      mass: mass * 0.38,
      radius: 0.12,
      foam: 0.18,
      life: 3.8,
      source,
    });

    // Crown / sheet fragments use outward lateral momentum and return through
    // the same coupling path rather than being a visual-only particle effect.
    for (let index = 0; index < count; index += 1) {
      const angle = this.random() * TAU;
      const radial = Math.pow(this.random(), 0.54);
      const lateralSpeed = (1.3 + radial * speed * 0.34) * (0.76 + this.random() * 0.5);
      const lift = (1.7 + speed * (0.24 + radial * 0.3)) * (0.78 + this.random() * 0.44);
      const spread = radius * (0.1 + radial * 0.42);
      this.#pushParticle({
        x: x + Math.cos(angle) * spread,
        y: surface.height + 0.045 + this.random() * 0.18,
        z: z + Math.sin(angle) * spread,
        vx: Math.cos(angle) * lateralSpeed,
        vy: lift,
        vz: Math.sin(angle) * lateralSpeed,
        mass: mass / count,
        radius: 0.035 + this.random() * 0.065,
        foam: clamp(0.48 + radial * 0.42, 0, 1),
        life: 1.8 + this.random() * 2.5,
        source,
      });
    }
    return primary;
  }

  #recordContact(registration, { type, velocity, mass }) {
    const volumeCell = this.volume.transform.worldToCell([registration.x, 0, registration.z]);
    this.contacts.unshift({
      id: `CT-${String(++this.contactSerial).padStart(4, '0')}`,
      time: this.time,
      type,
      x: registration.x,
      z: registration.z,
      energy: registration.energy,
      mass,
      velocity,
      surfaceGrids: registration.gridHits,
      volumeCell,
    });
    this.contacts.length = Math.min(30, this.contacts.length);
  }

  #applyVolumePressure(particle, deltaTime) {
    // A light-weight local pressure approximation provides cohesive spray
    // without pretending this CPU demo is a full high-resolution Navier–Stokes
    // solve. The sparse P2G field remains the handoff point for a GPU pressure
    // projection in a production build.
    const position = [particle.x, particle.y, particle.z];
    const sample = this.volume.sampleCell(position);
    const densitySample = this.volume.sampleDensityGradient(position);
    const targetMass = 0.012;
    if (densitySample.density <= targetMass) return;
    const excess = clamp((densitySample.density - targetMass) / targetMass, 0, 3);
    // The UI's pressure-pass control maps to the relaxation budget here. A
    // GPU backend would execute that many Jacobi/project iterations over the
    // same sparse cells instead of this compact CPU correction.
    const relaxation = 0.58 + this.parameters.solverIterations * 0.14;
    const gradient = densitySample.gradient;
    particle.vx -= gradient[0] * excess * 0.038 * relaxation * deltaTime;
    particle.vy += excess * 0.35 * relaxation * deltaTime - gradient[1] * excess * 0.038 * relaxation * deltaTime;
    particle.vz -= gradient[2] * excess * 0.038 * relaxation * deltaTime;
    particle.vx += (particle.vx - sample.velocity[0]) * excess * 0.055 * deltaTime;
    particle.vz += (particle.vz - sample.velocity[2]) * excess * 0.055 * deltaTime;
  }

  step(deltaTime) {
    if (this.paused) return;
    const scaledDelta = clamp(deltaTime * this.parameters.timeScale, 0, 1 / 30);
    if (scaledDelta <= 0) return;
    this.time += scaledDelta;
    this.frame += 1;
    this.ocean.follow(this.focus[0], this.focus[1]);
    this.ocean.update(scaledDelta);
    this.volume.beginFrame();

    const survivors = [];
    const windRadians = this.parameters.windDirection;
    const windX = Math.cos(windRadians) * this.parameters.windSpeed * 0.014;
    const windZ = Math.sin(windRadians) * this.parameters.windSpeed * 0.014;

    // Deposit current particles before integration, then sample the sparse
    // field for the inexpensive local pressure correction on the next update.
    for (const particle of this.particles) {
      this.volume.deposit([particle.x, particle.y, particle.z], particle.mass, [particle.vx, particle.vy, particle.vz], particle.foam);
    }

    for (const particle of this.particles) {
      particle.life -= scaledDelta;
      if (particle.life <= 0) continue;
      this.#applyVolumePressure(particle, scaledDelta);
      particle.vx += windX * scaledDelta;
      particle.vz += windZ * scaledDelta;
      particle.vy -= this.parameters.gravity * scaledDelta;
      particle.vx *= Math.exp(-0.22 * scaledDelta);
      particle.vy *= Math.exp(-0.075 * scaledDelta);
      particle.vz *= Math.exp(-0.22 * scaledDelta);
      particle.x += particle.vx * scaledDelta;
      particle.y += particle.vy * scaledDelta;
      particle.z += particle.vz * scaledDelta;

      const surface = this.ocean.sample(particle.x, particle.z, this.time);
      if (particle.y <= surface.height + particle.radius * 0.25) {
        const normalVelocity = Math.max(0, -particle.vy);
        const energy = normalVelocity * Math.sqrt(Math.max(particle.mass, 0.001)) * this.parameters.coupling;
        const registration = this.ocean.registerImpact({
          x: particle.x,
          z: particle.z,
          energy: energy * 0.26,
          radius: clamp(particle.radius * 7 + 0.16, 0.14, 0.88),
          foam: particle.foam * 0.22 * this.parameters.foamGain,
          source: particle.source,
          time: this.time,
        });
        this.#recordContact(registration, {
          type: 'return',
          velocity: [particle.vx, particle.vy, particle.vz],
          mass: particle.mass,
        });
      } else if (particle.y < 18 && Math.abs(particle.x - this.focus[0]) < 160 && Math.abs(particle.z - this.focus[1]) < 220) {
        survivors.push(particle);
      }
    }
    this.particles = survivors;
    this.volume.prune(2);
  }

  rain({ count = 7, centerX = this.focus[0], centerZ = this.focus[1] + 18 } = {}) {
    for (let index = 0; index < count; index += 1) {
      const angle = this.random() * TAU;
      const radius = Math.sqrt(this.random()) * 15;
      this.spawnImpact({
        x: centerX + Math.cos(angle) * radius,
        z: centerZ + Math.sin(angle) * radius,
        speed: 5.5 + this.random() * 5.5,
        mass: 0.35 + this.random() * 0.55,
        radius: 0.45 + this.random() * 0.65,
        source: 'rain-burst',
      });
    }
  }

  metrics() {
    const coverage = this.ocean.coverage;
    return {
      time: this.time,
      particles: this.particles.length,
      chunks: this.volume.activeChunkCount,
      occupiedCells: this.volume.occupiedCellCount,
      contactCount: this.contacts.length,
      registrations: this.ocean.registrations.length,
      nearCoverage: coverage[0] || 0,
      farCoverage: coverage.at(-1) || 0,
    };
  }
}
