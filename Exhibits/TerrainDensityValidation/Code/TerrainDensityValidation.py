#!/usr/bin/env python3
# TerrainDensityValidation — reference implementation of the Terrain Density Field mathematics.
#
# Proves, with the exact evaluation rules of Engine/Terrain (rho > 0 solid, strata composed in
# order through blend categories), that one sparse density field:
#   1. contains columns with several solid intervals (impossible for any heightfield),
#   2. carves a through-cave along a spline tube, leans cliffs into overhangs by domain warp,
#      and unions arch + spire formations,
#   3. extracts to a polygon surface (Surface Nets here; Dual Contouring in production),
#   4. erodes under the Mei-Decaudin-Hu shallow-water pipe model with a tracked sediment budget,
#   5. floods to lake equilibrium by priority-flood over the eroded surface.
#
# CPU/NumPy only. Exit code is non-zero when any proof fails; prints are the evidence record.
# Run: python3 Exhibits/TerrainDensityValidation/Code/TerrainDensityValidation.py

import heapq
import json
import sys
import time
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection

ROOT = Path(__file__).resolve().parents[3]
IMAGES = ROOT / "Exhibits/TerrainDensityValidation/Images"
RESULTS = ROOT / "Exhibits/TerrainDensityValidation/Results"
IMAGES.mkdir(parents=True, exist_ok=True)
RESULTS.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(20261027)

# ---------------------------------------------------------------------------
# Deterministic value noise (stands in for OpenSimplex in the reference; the
# field algebra being proven does not depend on the noise flavour).
# ---------------------------------------------------------------------------
def hash2(ix, iz, seed):
    n = (ix * 374761393 + iz * 668265263 + seed * 2246822519) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return (((n ^ (n >> 16)) & 0xFFFFFFFF) / 4294967295.0) * 2.0 - 1.0

def noise2(x, z, seed=0):
    ix = np.floor(x).astype(np.int64)
    iz = np.floor(z).astype(np.int64)
    fx = x - ix
    fz = z - iz
    sx = fx * fx * (3.0 - 2.0 * fx)
    sz = fz * fz * (3.0 - 2.0 * fz)
    a = hash2(ix, iz, seed)
    b = hash2(ix + 1, iz, seed)
    c = hash2(ix, iz + 1, seed)
    d = hash2(ix + 1, iz + 1, seed)
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz

def fbm(x, z, octaves=5, seed=0, lacunarity=2.02, gain=0.5):
    total = np.zeros_like(x, dtype=np.float64)
    amp, freq, norm = 1.0, 1.0, 0.0
    for o in range(octaves):
        total += amp * noise2(x * freq, z * freq, seed + o * 17)
        norm += amp
        amp *= gain
        freq *= lacunarity
    return total / norm

def ridged(x, z, octaves=5, seed=0):
    total = np.zeros_like(x, dtype=np.float64)
    amp, freq, norm = 1.0, 1.0, 0.0
    for o in range(octaves):
        n = 1.0 - np.abs(noise2(x * freq, z * freq, seed + o * 31))
        total += amp * (n * n)
        norm += amp
        amp *= 0.5
        freq *= 2.11
    return total / norm

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)

def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1.0 - h) + a * h - k * h * (1.0 - h)

def smax(a, b, k):
    return -smin(-a, -b, k)

# ---------------------------------------------------------------------------
# 1. Compose the density field from strata (mirrors the document semantics)
# ---------------------------------------------------------------------------
NX, NY, NZ = 96, 48, 96
xs, zs = np.meshgrid(np.arange(NX, dtype=np.float64), np.arange(NZ, dtype=np.float64), indexing="ij")
ys = np.arange(NY, dtype=np.float64)

# Stratum 1 — ElevationProfile: alpine massif H(x, z), folded in as rho = H - y.
massif = np.exp(-(((xs - 48.0) / 30.0) ** 2 + ((zs - 48.0) / 34.0) ** 2))
ridge = ridged(xs / 22.0, zs / 22.0, octaves=5, seed=7)
rolling = fbm(xs / 16.0, zs / 16.0, octaves=4, seed=3)
H = 5.0 + 33.0 * massif * (0.45 + 0.55 * ridge) + 4.5 * rolling + 6.0 * massif
H = np.clip(H, 1.5, NY - 4.0)

# Stratum 2 — DomainWarpCurve: lean grows with elevation, so faces looking -X overhang.
lean = 8.0 * smoothstep(14.0, 34.0, ys)                       # [cells] per height row
rho = np.empty((NX, NY, NZ), dtype=np.float64)
for j in range(NY):
    shifted = np.clip(xs + lean[j], 0.0, NX - 1.001)
    i0 = np.floor(shifted).astype(np.int64)
    frac = shifted - i0
    Hw = H[i0, zs.astype(np.int64)] * (1.0 - frac) + H[np.minimum(i0 + 1, NX - 1), zs.astype(np.int64)] * frac
    rho[:, j, :] = Hw - ys[j]

Xg, Yg, Zg = np.meshgrid(xs[:, 0], ys, zs[0, :], indexing="ij")

# Stratum 3 — SplineTube (SmoothCarve): a mine through-route along X at z = 48.
tube_y = 15.0 + 2.5 * np.sin((Xg - 8.0) / 80.0 * np.pi)      # gently arched centreline
sd_tube = np.sqrt((Yg - tube_y) ** 2 + (Zg - 48.0) ** 2) - 3.6
rho = smin(rho, sd_tube, 1.2)                                  # carve: rho < 0 inside the tube

# Stratum 4 — DistancePrimitive union: a rock arch (torus, ring in the YZ plane) on the NW flank.
ax, ay, az = 22.0, 15.0, 24.0
q = np.sqrt((Yg - ay) ** 2 + (Zg - az) ** 2) - 7.0
sd_arch = np.sqrt(q ** 2 + (Xg - ax) ** 2) - 2.1
rho = smax(rho, -sd_arch, 1.0)                                 # union: rho > 0 inside the arch rock

# Stratum 5 — DistancePrimitive union: a tapered spire on the SE flank.
sx, sz, base_y, spire_h = 73.0, 71.0, 8.0, 17.0
ty = np.clip((Yg - base_y) / spire_h, 0.0, 1.0)
radius_y = 3.4 * (1.0 - ty) + 0.6 * ty
sd_spire = np.sqrt((Xg - sx) ** 2 + (Zg - sz) ** 2) - radius_y
sd_spire = np.maximum(sd_spire, base_y - Yg)                   # flat foot
sd_spire = np.maximum(sd_spire, Yg - (base_y + spire_h))       # flat tip
rho = smax(rho, -sd_spire, 1.2)

# ---------------------------------------------------------------------------
# 2. Heightfield-impossibility census
# ---------------------------------------------------------------------------
solid = rho > 0.0
columns_multi = 0
max_intervals = 0
census_example = None
for i in range(NX):
    for k in range(NZ):
        col = solid[i, :, k]
        intervals = int(np.count_nonzero(col[1:] & ~col[:-1]) + (1 if col[0] else 0))
        if intervals > 1:
            columns_multi += 1
            if intervals > max_intervals:
                max_intervals = intervals
                census_example = (i, k, intervals)
total_columns = NX * NZ
print(f"[census] columns with >1 solid interval: {columns_multi} / {total_columns} "
      f"({100.0 * columns_multi / total_columns:.2f}%), max intervals in one column: {max_intervals} "
      f"at (x,z)=({census_example[0]},{census_example[1]})")

# Vertical-cliff census: surface cells whose gradient is within 15 deg of horizontal.
gx, gy, gz = np.gradient(rho)
gnorm = np.sqrt(gx ** 2 + gy ** 2 + gz ** 2) + 1e-12
surface_band = np.abs(rho) < 0.75
vertical = surface_band & (np.abs(gy / gnorm) < np.sin(np.radians(15.0)))
print(f"[cliffs] near-vertical surface samples (|rho|<0.75, normal within 15 deg of horizontal): "
      f"{int(np.count_nonzero(vertical))} of {int(np.count_nonzero(surface_band))} surface-band samples")

# ---------------------------------------------------------------------------
# 3. Surface Nets extraction (Dual Contouring's mass-point degenerate case)
# ---------------------------------------------------------------------------
t0 = time.perf_counter()
corners = np.array([[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]], dtype=np.int64)
edges = [(0,1),(2,3),(4,5),(6,7),(0,2),(1,3),(4,6),(5,7),(0,4),(1,5),(2,6),(3,7)]
signs = solid
mixed = np.zeros((NX - 1, NY - 1, NZ - 1), dtype=bool)
acc = np.zeros((NX - 1, NY - 1, NZ - 1), dtype=np.int32)
for c in corners:
    acc += signs[c[0]:NX - 1 + c[0], c[1]:NY - 1 + c[1], c[2]:NZ - 1 + c[2]].astype(np.int32)
mixed = (acc > 0) & (acc < 8)
cell_ids = np.argwhere(mixed)
vertex_index = -np.ones((NX - 1, NY - 1, NZ - 1), dtype=np.int64)
vertices = np.empty((len(cell_ids), 3), dtype=np.float64)
for vi, (i, j, k) in enumerate(cell_ids):
    pts = []
    for a, b in edges:
        ca, cb = corners[a], corners[b]
        pa = np.array([i + ca[0], j + ca[1], k + ca[2]])
        pb = np.array([i + cb[0], j + cb[1], k + cb[2]])
        ra = rho[pa[0], pa[1], pa[2]]
        rb = rho[pb[0], pb[1], pb[2]]
        if (ra > 0) != (rb > 0):
            t = ra / (ra - rb)
            pts.append(pa + t * (pb - pa))
    vertices[vi] = np.mean(pts, axis=0) if pts else np.array([i + 0.5, j + 0.5, k + 0.5])
    vertex_index[i, j, k] = vi

triangles = []
def add_quad(cells, flip):
    for (ci, cj, ck) in cells:  # boundary edges lack a full cell ring; their quads are skipped
        if not (0 <= ci < NX - 1 and 0 <= cj < NY - 1 and 0 <= ck < NZ - 1):
            return
    idx = [vertex_index[c] for c in cells]
    if min(idx) < 0:
        return
    if flip:
        idx = idx[::-1]
    triangles.append([idx[0], idx[1], idx[2]])
    triangles.append([idx[0], idx[2], idx[3]])

# Edges along X / Y / Z with a sign change generate one quad from the 4 sharing cells.
for axis in range(3):
    if axis == 0:
        change = signs[:-1] != signs[1:]
        cells_of = lambda i, j, k: [(i, j-1, k-1), (i, j, k-1), (i, j, k), (i, j-1, k)]
    elif axis == 1:
        change = signs[:, :-1] != signs[:, 1:]
        cells_of = lambda i, j, k: [(i-1, j, k-1), (i-1, j, k), (i, j, k), (i, j, k-1)]
    else:
        change = signs[:, :, :-1] != signs[:, :, 1:]
        cells_of = lambda i, j, k: [(i-1, j-1, k), (i, j-1, k), (i, j, k), (i-1, j, k)]
    for i, j, k in np.argwhere(change):
        if axis == 0:
            solid_first = signs[i, j, k]
        elif axis == 1:
            solid_first = signs[i, j, k]
        else:
            solid_first = signs[i, j, k]
        add_quad(cells_of(int(i), int(j), int(k)), not bool(solid_first))

triangles = np.array(triangles, dtype=np.int64)
extract_s = time.perf_counter() - t0
# Orient + shade from the field gradient (production uses analytic gradients identically).
centroids = vertices[triangles].mean(axis=1)
ci = np.clip(np.round(centroids).astype(np.int64), [0, 0, 0], [NX - 1, NY - 1, NZ - 1])
grad_at = np.stack([gx[ci[:,0], ci[:,1], ci[:,2]], gy[ci[:,0], ci[:,1], ci[:,2]], gz[ci[:,0], ci[:,1], ci[:,2]]], axis=1)
v0, v1, v2 = vertices[triangles[:,0]], vertices[triangles[:,1]], vertices[triangles[:,2]]
fnorm = np.cross(v1 - v0, v2 - v0)
# rho grows INTO the solid, so the outward surface normal opposes grad(rho).
flip_mask = np.einsum("ij,ij->i", fnorm, grad_at) > 0
triangles[flip_mask] = triangles[flip_mask][:, [0, 2, 1]]
fnorm[flip_mask] *= -1.0
flen = np.linalg.norm(fnorm, axis=1, keepdims=True) + 1e-12
fnorm /= flen
print(f"[extract] vertices={len(vertices)} triangles={len(triangles)} in {extract_s:.2f} s "
      f"(single-thread Python reference)")

obj_path = RESULTS / "ExtractedSurface.obj"
with open(obj_path, "w") as f:
    f.write("# TerrainDensityValidation extracted surface (Surface Nets reference)\n")
    for v in vertices:
        f.write(f"v {v[0]:.4f} {v[1]:.4f} {v[2]:.4f}\n")
    for t in triangles:
        f.write(f"f {t[0]+1} {t[1]+1} {t[2]+1}\n")
print(f"[extract] wrote {obj_path} ({obj_path.stat().st_size} bytes)")

# ---------------------------------------------------------------------------
# 4. Shaded renders of the extracted surface (orthographic, painter sorted)
# ---------------------------------------------------------------------------
def render(ax, azim_deg, elev_deg, title):
    az, el = np.radians(azim_deg), np.radians(elev_deg)
    R = np.array([[np.cos(az), 0, np.sin(az)], [0, 1, 0], [-np.sin(az), 0, np.cos(az)]]) @ \
        np.array([[1, 0, 0], [0, np.cos(el), -np.sin(el)], [0, np.sin(el), np.cos(el)]])
    pts = (R @ vertices.T).T
    light = R @ np.array([-0.45, 0.8, 0.35])
    light = light / np.linalg.norm(light)
    world_normals = fnorm
    view_normals = (R @ world_normals.T).T
    lambert = np.clip(np.einsum("ij,j->i", world_normals, np.array([-0.45, 0.8, 0.35]) / np.linalg.norm([-0.45, 0.8, 0.35])), 0, 1)
    ny = world_normals[:, 1]
    y = centroids[:, 1]
    rock = np.array([0.45, 0.40, 0.38])
    strata_tint = 0.85 + 0.3 * np.sin(y * 0.9 + 1.5 * np.sin(centroids[:, 0] * 0.05))
    grass = np.array([0.35, 0.52, 0.28])
    dirt = np.array([0.52, 0.42, 0.30])
    snow = np.array([0.92, 0.93, 0.95])
    base = np.where((ny > 0.55)[:, None], grass, np.where((ny > 0.25)[:, None], dirt, rock * strata_tint[:, None]))
    base = np.where(((y > 33.0) & (ny > 0.35))[:, None], snow, base)
    shade = 0.25 + 0.75 * lambert
    colours = np.clip(base * shade[:, None], 0, 1)
    order = np.argsort(pts[triangles].mean(axis=1)[:, 2])
    polys = pts[triangles][order][:, :, :2]
    pc = PolyCollection(polys, facecolors=colours[order], edgecolors="none")
    ax.add_collection(pc)
    ax.autoscale_view()
    ax.set_aspect("equal")
    ax.axis("off")
    ax.set_title(title, fontsize=9, color="#ddd")
    ax.set_facecolor("#101014")

fig, axes = plt.subplots(1, 2, figsize=(13, 5.2), facecolor="#101014")
render(axes[0], -35, 28, "Extracted surface - NW view (arch visible left, overhang lean +X)")
render(axes[1], 140, 22, "Extracted surface - SE view (spire front-right)")
fig.tight_layout()
fig.savefig(IMAGES / "ExtractedSurface.png", dpi=110, facecolor=fig.get_facecolor())
plt.close(fig)

# ---------------------------------------------------------------------------
# 5. Field slices (the topology evidence a heightfield cannot produce)
# ---------------------------------------------------------------------------
fig, axes = plt.subplots(2, 2, figsize=(12, 7.5), facecolor="#101014")
def show_slice(ax, img, title, xlabel, ylabel):
    ax.imshow(img, origin="lower", cmap="RdBu_r", vmin=-8, vmax=8, aspect="auto")
    ax.contour(img, levels=[0], colors=["#ffd75e"], linewidths=0.8)
    ax.set_title(title, fontsize=9, color="#ddd")
    ax.set_xlabel(xlabel, color="#aaa", fontsize=8)
    ax.set_ylabel(ylabel, color="#aaa", fontsize=8)
    ax.tick_params(colors="#888", labelsize=7)
show_slice(axes[0, 0], rho[:, :, 48].T, "Cave cross-section z=48: tunnel void inside the ridge", "x", "y")
show_slice(axes[0, 1], rho[:, :, 44].T, "Offset section z=44: warped strata lean (overhang)", "x", "y")
show_slice(axes[1, 0], rho[22, :, :].T, "Arch section x=22: ring opening (air enclosed by rock)", "z", "y")
top = np.where(solid.any(axis=1), NY - 1 - np.argmax(solid[:, ::-1, :], axis=1), 0)
axes[1, 1].imshow(top.T, origin="lower", cmap="terrain", aspect="auto")
axes[1, 1].set_title("Top-surface projection (what a heightfield would keep)", fontsize=9, color="#ddd")
axes[1, 1].set_xlabel("x", color="#aaa", fontsize=8)
axes[1, 1].set_ylabel("z", color="#aaa", fontsize=8)
axes[1, 1].tick_params(colors="#888", labelsize=7)
fig.tight_layout()
fig.savefig(IMAGES / "FieldSlices.png", dpi=110, facecolor=fig.get_facecolor())
plt.close(fig)

# ---------------------------------------------------------------------------
# 6. Shallow-water hydraulic erosion (Mei-Decaudin-Hu pipe model) + talus
# ---------------------------------------------------------------------------
N = 128
ex, ez = np.meshgrid(np.arange(N, dtype=np.float64), np.arange(N, dtype=np.float64), indexing="ij")
bed = 20.0 + 70.0 * ridged(ex / 26.0, ez / 26.0, octaves=5, seed=11) + 22.0 * fbm(ex / 14.0, ez / 14.0, 4, 5)
bed += 45.0 * np.exp(-(((ex - 34) / 20.0) ** 2 + ((ez - 64) / 26.0) ** 2))   # western massif
bed += 32.0 * np.exp(-(((ex - 92) / 16.0) ** 2 + ((ez - 40) / 18.0) ** 2))   # eastern hill
bed0 = bed.copy()
cell = 8.0                     # [m] solver cell (1.024 km fixture, ~120 m alpine relief)
dt = 0.1                       # [s]
g, pipeA = 9.80665, 1.2        # [m/s^2], [m^2]
Kc, Ks, Kd, Ke = 1.4, 0.5, 0.4, 0.002
rain = 0.03                    # [m/s] during rain steps
water = np.zeros_like(bed)
sed = np.zeros_like(bed)
flux = np.zeros((4, N, N))     # L, R, T, B outflow
wear = np.zeros_like(bed)
deposit = np.zeros_like(bed)
flowacc = np.zeros_like(bed)
eroded_total = deposited_total = outflow_sed = thermal_moved = 0.0

def shift(a, dx, dz, fill=0.0):
    out = np.full_like(a, fill)
    xs_src = slice(max(0, dx), N + min(0, dx)); xs_dst = slice(max(0, -dx), N + min(0, -dx))
    zs_src = slice(max(0, dz), N + min(0, dz)); zs_dst = slice(max(0, -dz), N + min(0, -dz))
    out[xs_dst, zs_dst] = a[xs_src, zs_src]
    return out

def bilinear(a, fx, fz):
    i0 = np.clip(np.floor(fx).astype(np.int64), 0, N - 2)
    k0 = np.clip(np.floor(fz).astype(np.int64), 0, N - 2)
    tx = np.clip(fx - i0, 0, 1); tz = np.clip(fz - k0, 0, 1)
    return (a[i0, k0] * (1-tx) * (1-tz) + a[i0+1, k0] * tx * (1-tz)
            + a[i0, k0+1] * (1-tx) * tz + a[i0+1, k0+1] * tx * tz)

t0 = time.perf_counter()
STEPS = 900
for step in range(STEPS):
    if step < 600:
        water += rain * dt * (0.5 + rng.random((N, N)))        # 1. water increment
    total_h = bed + water
    dh = np.stack([total_h - shift(total_h, -1, 0, np.inf), total_h - shift(total_h, 1, 0, np.inf),
                   total_h - shift(total_h, 0, -1, np.inf), total_h - shift(total_h, 0, 1, np.inf)])
    dh = np.where(np.isinf(dh), 0.0, dh)
    flux = np.maximum(0.0, flux + dt * pipeA * g * dh / cell)  # 2. pipe flux
    fsum = flux.sum(axis=0)
    scale = np.minimum(1.0, (water * cell * cell) / np.maximum(dt * fsum, 1e-12))
    flux *= scale[None, :, :]
    fsum = flux.sum(axis=0)
    inflow = (shift(flux[1], -1, 0) + shift(flux[0], 1, 0) + shift(flux[3], 0, -1) + shift(flux[2], 0, 1))
    outflow_sed += float((sed[0, :] * flux[0][0, :] + sed[-1, :] * flux[1][-1, :]
                          + sed[:, 0] * flux[2][:, 0] + sed[:, -1] * flux[3][:, -1]).sum() * dt / cell)
    water = np.maximum(0.0, water + dt * (inflow - fsum) / (cell * cell))
    flowacc += fsum
    # velocity magnitude from mean outflow speed; direction from total-head gradient
    speed = fsum * dt / np.maximum(cell * cell * np.maximum(water, 1e-3), 1e-9)
    dhx = (shift(total_h, 1, 0, 0) - shift(total_h, -1, 0, 0)) / (2 * cell)
    dhz = (shift(total_h, 0, 1, 0) - shift(total_h, 0, -1, 0)) / (2 * cell)
    slope = np.sqrt(dhx ** 2 + dhz ** 2)
    sin_alpha = slope / np.sqrt(1.0 + slope ** 2)
    capacity = Kc * np.maximum(sin_alpha, 0.01) * np.minimum(speed, 4.0) * np.clip(water * 5.0, 0.15, 2.5)
    take = np.where(capacity > sed, np.minimum(Ks * (capacity - sed), 0.25), 0.0)  # 3. erosion
    drop = np.where(capacity <= sed, Kd * (sed - capacity), 0.0)                   #    deposition
    bed += drop - take
    sed += take - drop
    wear += take
    deposit += drop
    eroded_total += float(take.sum())
    deposited_total += float(drop.sum())
    vmag = np.sqrt(dhx ** 2 + dhz ** 2) + 1e-9                                      # 4. advection
    vx = (-dhx / vmag) * np.minimum(speed, 3.0)
    vz = (-dhz / vmag) * np.minimum(speed, 3.0)
    sed = bilinear(sed, ex - vx * dt / cell * 24.0, ez - vz * dt / cell * 24.0)
    water *= (1.0 - Ke)                                                             # 5. evaporation
    if step in (100, 400):
        active = water > 0.005
        print(f"[probe step {step}] mean water={water.mean():.4f} m, capacity p95="
              f"{np.percentile(capacity[active], 95) if active.any() else 0:.4f}, "
              f"take sum this step={take.sum():.4f}")
    if step % 6 == 5:                                                               # thermal talus
        T = np.tan(np.radians(37.0)) * cell
        delta = np.zeros_like(bed)
        for dxs, dzs in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
            diff = bed - shift(bed, dxs, dzs, np.inf)
            diff = np.where(np.isinf(diff), 0.0, diff)
            move = np.where(diff > T, 0.5 * 0.25 * (diff - T), 0.0)
            thermal_moved += float(move.sum())
            delta -= move
            delta += shift(move, -dxs, -dzs)
        bed += delta

erode_s = time.perf_counter() - t0
suspended = float(sed.sum())
imbalance = eroded_total - deposited_total - suspended
print(f"[erode] {STEPS} steps on {N}x{N} in {erode_s:.2f} s | eroded={eroded_total:.2f} "
      f"deposited={deposited_total:.2f} suspended={suspended:.2f} thermal_moved={thermal_moved:.2f} "
      f"(cell-metres) | hydraulic imbalance before boundary outflow={imbalance:.2f}")
bed_change = bed - bed0
print(f"[erode] bed change: min={bed_change.min():.3f} m max={bed_change.max():.3f} m "
      f"mean|change|={np.abs(bed_change).mean():.4f} m, NaN cells={int(np.isnan(bed).sum())}")

# ---------------------------------------------------------------------------
# 7. Lake equilibrium by priority-flood + river threshold on discharge
# ---------------------------------------------------------------------------
filled = np.full_like(bed, np.inf)
visited = np.zeros_like(bed, dtype=bool)
heap = []
for i in range(N):
    for k in (0, N - 1):
        heapq.heappush(heap, (bed[i, k], i, k)); filled[i, k] = bed[i, k]; visited[i, k] = True
for k in range(N):
    for i in (0, N - 1):
        if not visited[i, k]:
            heapq.heappush(heap, (bed[i, k], i, k)); filled[i, k] = bed[i, k]; visited[i, k] = True
while heap:
    h, i, k = heapq.heappop(heap)
    for di, dk in ((1,0),(-1,0),(0,1),(0,-1)):
        ni, nk = i + di, k + dk
        if 0 <= ni < N and 0 <= nk < N and not visited[ni, nk]:
            visited[ni, nk] = True
            fh = max(bed[ni, nk], h)
            filled[ni, nk] = fh
            heapq.heappush(heap, (fh, ni, nk))
lake_depth = filled - bed
lake_cells = int(np.count_nonzero(lake_depth > 0.05))
river = flowacc > np.percentile(flowacc, 97.5)
print(f"[water] lake cells (depth>0.05 m): {lake_cells} ({lake_cells * cell * cell / 1e6:.2f} km^2), "
      f"max depth {lake_depth.max():.2f} m | river cells (top 2.5% discharge): {int(river.sum())}")

def hillshade(h):
    gx_, gz_ = np.gradient(h)
    n = np.stack([-gx_, np.ones_like(h), -gz_], axis=-1)
    n /= (np.linalg.norm(n, axis=-1, keepdims=True) + 1e-12)
    light = np.array([-0.5, 0.8, 0.35]); light /= np.linalg.norm(light)
    return np.clip(np.einsum("ijk,k->ij", n, light), 0, 1)

fig, axes = plt.subplots(2, 3, figsize=(13.5, 8), facecolor="#101014")
for ax, img, title, cmap in [
    (axes[0,0], hillshade(bed0), "Bed before erosion (hillshade)", "gray"),
    (axes[0,1], hillshade(bed), "After hydraulic + thermal erosion", "gray"),
    (axes[0,2], bed_change, "Bed change [m] (blue carved / red deposited)", "RdBu"),
    (axes[1,0], np.log1p(flowacc), "Flow accumulation channel (log)", "viridis"),
    (axes[1,1], wear, "Wear channel (erosion mask)", "magma"),
    (axes[1,2], deposit, "Deposition channel (sediment mask)", "magma"),
]:
    ax.imshow(img.T, origin="lower", cmap=cmap, aspect="auto")
    ax.set_title(title, fontsize=9, color="#ddd")
    ax.tick_params(colors="#888", labelsize=7)
fig.tight_layout()
fig.savefig(IMAGES / "Erosion.png", dpi=110, facecolor=fig.get_facecolor())
plt.close(fig)

fig, axes = plt.subplots(1, 2, figsize=(12, 5), facecolor="#101014")
comp = np.repeat(hillshade(bed)[:, :, None], 3, axis=2)
comp[lake_depth > 0.05] = np.array([0.15, 0.45, 0.85])
comp[river] = np.array([0.3, 0.65, 1.0])
axes[0].imshow(np.transpose(comp, (1, 0, 2)), origin="lower", aspect="auto")
axes[0].set_title("Equilibrium water: lakes (priority-flood) + rivers (discharge)", fontsize=9, color="#ddd")
axes[0].tick_params(colors="#888", labelsize=7)
axes[1].imshow(lake_depth.T, origin="lower", cmap="Blues", aspect="auto")
axes[1].set_title("Lake depth [m]", fontsize=9, color="#ddd")
axes[1].tick_params(colors="#888", labelsize=7)
fig.tight_layout()
fig.savefig(IMAGES / "WaterBodies.png", dpi=110, facecolor=fig.get_facecolor())
plt.close(fig)

# ---------------------------------------------------------------------------
# 8. Memory model check (research section 3.1 numbers, recomputed)
# ---------------------------------------------------------------------------
def dense_bytes(extent_m, height_m, cell_m, sample_bytes=2):
    return (extent_m / cell_m) ** 2 * (height_m / cell_m) * sample_bytes
def hf_bytes(extent_m, cell_m, sample_bytes=2):
    return (extent_m / cell_m) ** 2 * sample_bytes
def narrow_band_bytes(extent_m, cell_m, band=6, avg_bytes=3.0):
    return (extent_m / cell_m) ** 2 * band * avg_bytes
mem = {
    "dense_0.5m_TB": dense_bytes(8000, 1000, 0.5) / 1e12,
    "dense_2m_GB": dense_bytes(8000, 1000, 2.0) / 1e9,
    "heightfield_0.5m_MB": hf_bytes(8000, 0.5) / 1e6,
    "heightfield_1m_MB": hf_bytes(8000, 1.0) / 1e6,
    "narrowband_2m_MB": narrow_band_bytes(8000, 2.0) / 1e6,
    "punchin_0.5m_r512_MB": narrow_band_bytes(1024, 0.5, avg_bytes=4.0) / 1e6,
}
for k, v in mem.items():
    print(f"[memory] {k} = {v:,.1f}")

# ---------------------------------------------------------------------------
# Verdicts
# ---------------------------------------------------------------------------
checks = {
    "multi_interval_columns_exist": bool(columns_multi > 0),
    "vertical_cliff_samples_exist": bool(int(np.count_nonzero(vertical)) > 0),
    "extraction_produced_triangles": bool(len(triangles) > 1000),
    "erosion_no_nan": bool(int(np.isnan(bed).sum()) == 0),
    "erosion_carved_and_deposited": bool((bed_change.min() < -0.1) and (bed_change.max() > 0.1)),
    "drainage_channel_exists": bool(float(flowacc.max()) > 10.0 * float(np.median(flowacc) + 1e-9)),
    "lakes_exist": bool(lake_cells > 0),
}
metrics = {
    "grid": [NX, NY, NZ],
    "multi_interval_columns": columns_multi,
    "multi_interval_percent": 100.0 * columns_multi / total_columns,
    "max_intervals_one_column": max_intervals,
    "vertical_cliff_samples": int(np.count_nonzero(vertical)),
    "surface_band_samples": int(np.count_nonzero(surface_band)),
    "vertices": int(len(vertices)),
    "triangles": int(len(triangles)),
    "extraction_seconds_python": extract_s,
    "erosion_steps": STEPS,
    "erosion_seconds_python": erode_s,
    "eroded_cell_metres": eroded_total,
    "deposited_cell_metres": deposited_total,
    "suspended_cell_metres": suspended,
    "thermal_moved_cell_metres": thermal_moved,
    "bed_change_min_m": float(bed_change.min()),
    "bed_change_max_m": float(bed_change.max()),
    "lake_cells": lake_cells,
    "lake_max_depth_m": float(lake_depth.max()),
    "river_cells": int(river.sum()),
    "memory_model": mem,
    "checks": checks,
}
(RESULTS / "Metrics.json").write_text(json.dumps(metrics, indent=2, default=lambda o: bool(o) if isinstance(o, np.bool_) else float(o)))
failed = [k for k, v in checks.items() if not v]
for k, v in checks.items():
    print(f"[check] {k}: {'PASS' if v else 'FAIL'}")
if failed:
    print(f"VALIDATION FAILED: {failed}")
    sys.exit(1)
print("VALIDATION PASSED - all checks green")
