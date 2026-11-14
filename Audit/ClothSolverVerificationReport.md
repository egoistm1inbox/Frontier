# Cloth Solver Verification Report: Were the research papers implemented correctly?

**What I audited:** `SultanAladin/Frontier-1` @ branch `arena/56d5516e-frontier-1` (commit `1258912`), mainly `Experimental/ClothEditor/Engine/OrthotropicClothSolver.js`, `TextileCatalog.js` and `PatternDraftNetwork.js`.
**How:** I read each solver line by line and compared it with the original papers. For Stable Cosserat Rods I also compared it with the authors' own code ([YarnBall](https://github.com/jerry060599/YarnBall), `sim/cosserat.cu`). Then I ran experiments in Node with the repo's own mannequin and `coutureDress` (3 576 pts / 6 690 tris, 180 frames). Each experiment patches out one suspected defect at a time.
**Reproduce:** `CLOTH_EDITOR_DIR=/path/to/Frontier-1/Experimental/ClothEditor node Audit/ClothSolverAudit.mjs`. The raw output is in `Audit/ClothSolverAudit.output.txt`. The cloned repo is never modified.

My baseline numbers match the AI's `ClothSolverComparisonReport.md` exactly (A: 17.1 mm / 0.113 m³, C: 29.7 mm / 3.1 mm/s, …). So its *measurements* are real. Several of its *explanations* are wrong, and most of the solvers are **not** the algorithms they are named after.

---

## 1. Short answer

| Option | Named after | Implemented correctly? | One-line truth |
| :---: | :--- | :---: | :--- |
| **A** `avbd` | AVBD (Giles, **Diaz** & Yuksel 2025) | ⚠️ **Partly** | The VBD core is correct. The "Augmented" part (hard constraints through AL with stiffness ramping) covers seams only, and only for 0.4 s. Contacts are handled outside the solver. |
| **B** `xpbd` | XPBD (Macklin et al. 2016) | ✅ **Yes** | A textbook small-steps XPBD with minor quirks. This is the honest one. |
| **C** `scr` | Stable Cosserat Rods (Hsu et al. 2025) | ❌ **No** | The rod quaternions have **zero effect** on the cloth (proven bit-exact). What you see is a mass-spring + PBD strain-limit + PBD hinge-bending solver. |
| **D** `gn_knot` | Knots & Ties (Guo et al. 2025) | ❌ **No, and buggy** | Wrong contact Hessian (tangent instead of normal) and wrong force sign. A global "step throttle" slows **every** vertex to 10–20 %. **That throttle is your freeze.** The knot templates (the paper's real contribution) are not connected to the app. |
| **E** `jgs2` | JGS2 (Lan et al. 2025) | ❌ **No** | The "Schur" coupling is a made-up heuristic, not the real Hessian. With it removed the solver gets *quieter* (39.8 → 27.9 mm/s). |
| **F** `kes_aa` | Kawabata + Anderson | ❌ **Buggy** | The fabric modulus is applied **twice** (stress = C11² × strain ≈ 1 850× too stiff). **That causes the "puffed jacket".** Anderson acceleration is also misapplied across time steps. |
| PIE | Zhang et al. 2025 (mesh resolution) | ⚠️ **Formula yes, usage no** | Eq. 4 and the constants c₁ and c₂ are correct. The result is then multiplied by 1.35 and clamped to 9.5–18.5 mm, so 5 of 6 fabrics end up at the same 18.5 mm. |
| Nature Phys. | Zsolnai-Fehér 2022 | ❌ **N/A** | This is a short *Comment on fluid simulation*. It has no cloth or drag model in it. The citation on the wind-drag code is decorative. |

**Your observations were right, and now there are causes for them:**
- *"E and F look like a puffed-up jacket."* F's cause is the doubled modulus (§3.6). Fixing it takes F from 30.5 → **21.2 mm** gap and 0.168 → **0.114 m³** volume, nearly as close to the body as AVBD.
- *"D freezes prematurely."* D's cause is `_gnStepScale` (§3.4). It sat below 0.5 for 56 of 180 frames and ended at 0.17–0.21, even **without** switching solvers. The AI's report blamed the app's switching code. That was only part of it.
- *"C has the nice folds."* That's true, but they come from PBD hinge bending + soft compression + strong low-speed damping, not from Cosserat rods (§3.3).

---

## 2. Measurements (coutureDress, 180 frames, 60 FPS)

`gap` = mean SDF distance to the body (lower = hugs the body). `vol` = bbox m³ (the spawn shell is 0.189, a true drape is ≈ 0.11). `rms` = peak → final speed.

| Run | gap mm | vol m³ | RMS mm/s | Comment |
| :--- | ---: | ---: | :--- | :--- |
| A `avbd` shipped | **17.1** | **0.113** | 322 → 39.1 | Best contact/drape, residual shimmer |
| B `xpbd` shipped | 29.4 | 0.159 | 336 → 8.4 | |
| C `scr` shipped | 29.7 | 0.166 | 316 → **3.1** | Quietest |
| C with **random quaternions every frame** | 29.7 | 0.166 | 316 → 3.1 | **max position diff = 0** → rods are dead state |
| D `gn_knot` shipped | 26.7 | 0.138 | 489 → 36.8 | step scale min 0.10, < 0.5 in 56/180 frames |
| D, global throttle disabled | 26.3 | 0.148 | 484 → **381** | The throttle hides an unstable contact model |
| D, Hessian + sign fixed (throttle on) | 34.3 | 0.183 | 293 → 13.8 | Throttle stuck at 0.10 for 170/180 frames (stale-depth issue, §3.4) |
| E `jgs2` shipped | 24.9 | 0.134 | 327 → 39.8 | |
| E **without** the "Schur" term | 26.2 | 0.144 | 328 → **27.9** | The term adds chatter and is not JGS2 |
| F `kes_aa` shipped | 30.5 | 0.168 | 723 → 24.7 | Puffed |
| F, single modulus | 25.5 | 0.121 | 893 → 10.4 | |
| F, single modulus, **no Anderson** | **21.2** | **0.114** | 310 → **8.8** | 2nd closest to the body *and* quiet |

---

## 3. Per-algorithm findings

### 3.1 Option A: AVBD ⚠️ partly correct
**Paper:** VBD (per-vertex 3×3 Newton block, colour-batched Gauss–Seidel) plus an augmented-Lagrangian layer. Every hard constraint (contacts, joints, attachments) gets a dual λ and a stiffness that ramps up by `k ← k + β|C|` each iteration, with warm-start decay. This lets stiff/hard constraints converge without instability.
**Code (`_stepSubstepAVBD`, L457–878):**
- ✅ The VBD block solve is correct: inertia `m/h²`, orthotropic membrane with the correct force/Hessian, PSD Hessian floor, Bergou quadratic bending, colour batching, per-vertex step bound.
- ⚠️ AL is applied **only to seams**. The dual update runs only during a 0.4 s window after zipping (L844) and is clamped to ±18. The penalty ramp is `×1.10` (L857) rather than `+β|C|`.
- ⚠️ **Contacts are not part of the AVBD solve.** Body contact is an SDF position projection and self-contact is a separate PBD pass. The "OGC" bound is just an SDF clearance clamp, not Offset Geometric Contact.
- ⚠️ After the VBD sweep a PBD "crimp wall / shear lock" pass runs (L734+). That makes it a hybrid, not a pure energy solver.
- Citation typo: the authors are Giles, **Diaz** & Yuksel (not "Chen").

**Verdict:** a sound VBD cloth solver with AL seams. It is the most physically grounded of the six, which is why it drapes closest to the body.

### 3.2 Option B: XPBD ✅ correct
Standard XPBD: compliance `α̃ = 1/(k h²)`, λ accumulated and reset each substep, colour-batched, quadratic Bergou bending written as `C = |Σ cᵢxᵢ|`. Minor quirks: compliance switches mid-solve when the strain crosses the crimp knee while λ keeps accumulating, and the above-crimp branch is plain PBD. These don't affect correctness for game use.

### 3.3 Option C: Stable Cosserat Rods ❌ not implemented
**Paper / reference code:** every rod segment has a quaternion `q`. The **position** update uses the shear-stretch energy `c = (x₁ − x₀)/l − q·e₃`, so the director *pulls on the positions*. The **orientation** update is closed-form: `b = Σ ±(q_neighbor · q_rest)` uses the *rest Darboux* rotation, `v = −2k(x₁−x₀)/l`, `λ = |v| + |b|`, `q ← normalize(v·b·e₃ + λb)` (YarnBall `cosserat.cu` L70 and L251).
**Code (`_stepSubstepCosserat`, L1233–1426):**
1. **The director never reaches the positions.** L1304 is literally `void d3;`. The position pass is a plain axial spring `k(|x₁−x₀| − l)`. Experiment: replacing every quaternion with random values each frame gives a **bit-identical** garment (diff = 0). So the whole orientation solve (Pass 3) is decorative.
2. The orientation formula is invented. There is no rest Darboux vector, neighbour quaternions are averaged directly (meaningless for mesh edges meeting at 60°), and the "Banach fixed point" `λ = √(v²b² + λ²b² + v²)` (L1397) diverges whenever `|b| ≥ 1` and is then clamped. The output is a weighted blend, not `normalize(v·b·e₃ + λb)`.
3. SCR is a **rod** method (hair, yarn, straps). Applying it to the edges of a triangle mesh is not what the paper does. Its "yarn-level cloth" uses actual yarn polylines.

**Why C still looks good:** what actually runs is Jacobi mass-springs + `_clothPatchProjection` (PBD warp/weft/shear limits) + `_hingeBendingProjection` with a *soft* blend (≤ 0.3 of the bending error per substep). On top of that, the shared low-speed damper (`_applyLowAmplitudeHysteresis`, about 16 s⁻¹ below 50 mm/s) kills shimmer, so folds form and stay. That is a legitimate *practical* look, similar to what many games ship. It just shouldn't be called Stable Cosserat Rods.

### 3.4 Option D: FPB Knots & Ties ❌ not implemented, plus three bugs
**Paper:** the main contribution is **parametric Bézier-pipe knot templates**, UV→3D knot mapping, penetration-free initialisation and radius adjustment. The simulator is one Gauss–Newton step per time step solved with **global block-Jacobi PCG**. Contacts use `G_con = (−β₀N, −β₁N, −β₂N, N)`, so `H_con = G Gᵀ` is along the **normal**. Intersections are resolved with contour-minimisation gradients, and the step is backtracked by 0.9 *only when an intersection is detected*. The `1.2^K` lifespan weighting is used in the **initialisation** (rigid translation of the knot), not in the solver.
**Code (`_stepSubstepGaussNewton`, L1433–1725):**
1. **Wrong contact Hessian:** L1668 adds `kc·(I − nnᵀ)`. That is the *tangent-plane* projector. With `kc = 2.4e4 × 1.2¹²` ≈ 2×10⁵ against `m/h²` ≈ 10, contacting vertices are glued in-plane and get **no** stiffness along the normal.
2. **Wrong force sign:** L1672 applies `−kc·depth·n` to every participant. The normal points face → point, so the **point is pushed into the face** (the face vertices happen to get the right direction). The next PBD self-contact pass pushes it back, and the two fight each other.
3. **Global throttle = the freeze:** L1699 multiplies one shared `_gnStepScale` by 0.9 in every substep where *any single* contact is deeper than 2.5 mm (floor 0.10). That scale multiplies **every vertex's** step. Measured: min 0.10, below 0.5 for 56/180 frames, ending at 0.17–0.21, so the whole dress moves at about 20 % speed. Disabling it shows what it hides: RMS explodes to **381 mm/s**. Fixing the Hessian and sign alone is not enough. Contact depths are *stale* (recorded before the projection already resolved them), so the GN pushes a second time and the throttle then stays at 0.10.
4. Knot templates (`FPB_KNOT_TEMPLATES`, `sampleKnotTemplate`) exist only in `PatternDraftNetwork.js` and the validation test. **Nothing in the app uses them.** The global PCG and the IPC fallback are missing as well.

### 3.5 Option E: JGS2 ❌ not implemented
**Paper:** Jacobi/Gauss–Seidel overshoots because each vertex ignores how its neighbours will respond. JGS2 corrects every local 3×3 solve with a Schur-complement term derived from the **actual global Hessian**, precomputed at rest (a "perturbation subspace" with cubature for nonlinear energies). That is what gives near-second-order convergence.
**Code (`_stepSubstepSchurJGS2`, L2020–2328):** the off-diagonal blocks are **made up**: `H_ij ≈ −κ nnᵀ` with `κ = 0.25/deg × mean(diag H_ii)` (L2256), not taken from the membrane or bending energy. Then come relaxation 0.85/0.55 and a 2.5 mm trust region. Removing the term (`κ = 0`) makes E *quieter* (39.8 → 27.9 mm/s) with almost the same drape, so it is not giving any JGS2 benefit. The AI's report (§4.2) tuned the trust region to hide the chatter this term creates.

### 3.6 Option F: Kawabata + Anderson ❌ buggy (the "puffed jacket")
1. **Modulus applied twice:** `wrapStrain(strain, crimp, wall, C11)` already returns `tension = C11·ε`. L2454 then computes `su = C11 * envU.tension`, i.e. **C11²·ε**. The tangent and the C12 coupling are squared the same way. For poplin that is 1 850× too stiff, so the shell cannot stretch or compress enough to drape and keeps its spawn shape. (The buckling branch three lines below uses a single `C11`, which confirms this was not intended.)
2. **Anderson acceleration is misused:** AA speeds up a fixed-point iteration *within one solve*. Here it mixes positions from **previous substeps** (different times and inertia targets). It is accepted only if *membrane* energy doesn't increase (L2652), which rejects gravity sag and pulls the cloth back toward the less-stretched spawn shape. That is an anti-gravity bias. Removing it: gap 25.5 → 21.2 mm, RMS 10.4 → 8.8.
3. The Cerda–Mahadevan branch jumps from `−0.05·C11²·ε` to `−0.25·C11·ε_c` at 1 % compression. That is a stress discontinuity and a source of chatter.

With (1) and (2) fixed, F becomes a well-behaved orthotropic VBD-style solver: **21.2 mm / 0.114 m³ / 8.8 mm/s**.

### 3.7 PIE mesh resolution ⚠️ formula correct, result overridden
- ✅ Eq. 4 (`c₁r⁶ + c₂r⁴ = B/E`) with `c₁ = 32.08`, `c₂ = −1.876e-4` and the 2.5–50 mm bracket match the paper exactly. The Vandeparre wrinklon length formula matches §4.2.1.
- ❌ `authoringSpacingMm = clamp(1.35·r*, 9.5, 18.5)` (TextileCatalog L304), then `PatternDraftNetwork` L245 clamps again to 8–24 mm. The paper says edge length should be **≤ r***. The code always meshes *coarser* than r*.
- ❌ Because E is clamped at 2×10⁶ N/m², warp and weft give identical r* for most fabrics, so anisotropy is erased. Result: poplin, denim, wool, jersey and satin **all** get 18.5 mm. Only silk differs (13.5 mm).
- ❌ No sizing map, no seam/shirring/collision sources, no Poisson-disk + Delaunay meshing. `rWarp`, `rWeft`, `seamSourceMm` and `wrinklon` are shown in the UI but never used.
- ℹ️ `bendRigidity` values (e.g. 0.42 mN·m for poplin) look 10–40× higher than typical KES-B data. That pushes r* coarser. Worth double-checking the units.

### 3.8 Nature Physics s41567-022-01788-5 ❌ not applicable
"The flow from simulation to reality" (Zsolnai-Fehér 2022) is a one-page **Comment on fluid simulation** in graphics (FLIP, adaptivity, etc.). It contains no cloth or aerodynamic-drag formula. The quadratic normal drag plus skin friction at L1144 is a generic model. That's fine to use, but the citation is unrelated.

---

## 4. Which algorithm is actually best?

| Goal | Recommendation | Why |
| :--- | :--- | :--- |
| **Garment authoring (drape accuracy)** | **A (VBD/AVBD core)**, with F's orthotropic features merged in after the fixes | Correctly implemented and closest to the body. Fixed F proves the same block-Newton family can also settle quietly (8.8 mm/s). |
| **Look / "folds like FIFA"** | **C's recipe**, renamed (e.g. "PBD + hinge bending") | It works and it is the quietest, but it is not SCR. Its look comes from soft hinge bending + strain limiting + damping, all of which can be added to A or B. |
| **Game runtime** | **B (XPBD)** | Correct, cheap, deterministic, already has WGSL kernels. |
| **Knots / layered folds** | Not D as it stands | D needs a rewrite: normal-direction contact Hessian, correct signs, depths recomputed at the current positions inside the solve, no global throttle. The knot templates also need to be wired into the app. |
| **Stable Cosserat Rods, properly** | Use it for **rods**: drawstrings, straps, piping, hair, yarn | Port `cosserat.cu` (≈ 260 lines). The director must enter the stretch energy and the rest Darboux rotation must be used. |
| **Mesh resolution** | Use PIE's r* directly (≤ r*) | Remove the ×1.35 factor and the 9.5/18.5 clamps. Keep warp and weft separate. |

**Bottom line:** of the "research" options, only **B is fully faithful** and **A is mostly faithful**. **C, D, E and F carry the paper names, but the paper's key idea is missing or broken in each.** Your visual ranking (C > AVBD > XPBD; D/E/F problematic) matches what the code actually does. The reason C looks best is not the one the AI claimed.
