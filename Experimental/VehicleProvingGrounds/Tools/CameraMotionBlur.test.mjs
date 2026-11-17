import assert from "node:assert/strict";
import test from "node:test";
import { CameraMotionBlur } from "../Source/CameraMotionBlur.js";

test("camera motion blur is opt-in and resolves a bounded camera-owned strength", () => {
    const Component = new CameraMotionBlur();
    assert.equal(Component.ResolveStrength(), 0);
    Component.Enabled = true;
    Component.Strength = 0.6;
    assert.equal(Component.ResolveStrength(), 0.6);
    Component.Strength = 2;
    assert.equal(Component.ResolveStrength(), 1);
    Component.Enabled = false;
    assert.equal(Component.ResolveStrength(), 0);
});

test("camera motion blur clamps invalid and negative component strengths safely", () => {
    const Component = new CameraMotionBlur({ Enabled: true, Strength: -2 });
    assert.equal(Component.ResolveStrength(), 0);
    Component.Strength = Number.NaN;
    assert.equal(Component.ResolveStrength(), 0);
});
