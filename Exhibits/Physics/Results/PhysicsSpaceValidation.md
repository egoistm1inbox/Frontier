# PhysicsSpaceValidation

JoltPhysics 5.6.0 behind `Frontier/Extensions/Physics` (cross-platform deterministic, SSE4.2).

| Result | Claim |
|---|---|
| 🟢 | free fall: 15.013 m after 1 s (closed form 15.095 m) |
| 🟢 | free fall: -9.81 m/s after 1 s (closed form −9.81) |
| 🟢 | a 1 m cube rests on the ground: centre at 0.500 m |
| 🟢 | it stops (0.0000 m/s) and sleeps |
| 🟢 | the landing is a contact (2) |
| 🟢 | the sphere pushes the box 0.22 m along x |
| 🟢 | a stack of five cubes stands: top at 2.248 m |
| 🟢 | a 30-body pile settles bit-identically twice (cross-platform deterministic build) |
| 🟢 | Euler (Z, then Y, then X) → quaternion → Euler: worst 1.3e-13° |
| 🟢 | the bridge makes 1 moving body and 2 colliders (ground, pedestal) |
| 🟢 | a record with six copies is held, not turned into one body for all of them |
| 🟢 | the crate record lands on the pedestal record: origin at 2.500 m (2.5 expected) |
| 🟢 | stopping puts the crate back at 5 m |
| 🟢 | 1000 falling boxes: 23.10 ms per 1/60 s step on 1 workers (this sandbox, Debug build of the extension) |
| 🟢 | capture written: PhysicsSpaceFalling.png |

15 / 15 assertions.
