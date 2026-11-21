import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { ResolveRenderSettings, CanonicalRenderSettings, MasterQualityPatch, EnginePatch } from "./RenderSettings.js";

// Per-camera render settings as components: every camera (Editor, Cine, Construct-placed) has Render Engine, MatCap, Shadow Maps,
// SDF Tracing and Ray Tracing rows that edit that camera's own copy, with the source presets.
const Folder = path.dirname(fileURLToPath(import.meta.url));
const Require = createRequire(process.env.FRONTIER_BROWSER_PACKAGE || path.resolve(Folder, "../../../_AgentScratch/Browser/package.json"));
const { chromium } = Require("playwright");
const Proof = process.env.FRONTIER_PROOF_FOLDER || path.join(Folder, "Screenshots/RenderSettings");
fs.mkdirSync(Proof, { recursive: true });
const Checks = [],
  Errors = [],
  FontFailures = [];

// Pure data first: clamping, fallbacks and the preset fan-out match the source.
assert.deepEqual(ResolveRenderSettings({}), CanonicalRenderSettings);
const Wild = ResolveRenderSettings({ RenderEngine: "sdf_shadows", ShadowRays: 99, PcssTaps: 1, ShadowMapRes: 4096, GiIntensity: -3, RenderScale: 60, ExposureGain: "x" });
assert.equal(Wild.RenderEngine, "gtx_sdf_gi");
assert.equal(Wild.ShadowRays, 16);
assert.equal(Wild.PcssTaps, 8);
assert.equal(Wild.ShadowMapRes, 2048);
assert.equal(Wild.GiIntensity, 0);
assert.equal(Wild.RenderScale, 100);
assert.equal(Wild.ExposureGain, 1.35);
assert.deepEqual(MasterQualityPatch(3), { ShadowQuality: 3, ShadowRays: 8, PcssTaps: 32, SmrtRays: 8, ShadowMapRes: 2048, GiQuality: 3, GiSamples: 14, GiCones: 10, ReflectionQuality: 3, ReflectionRays: 6, ReflectionBounces: 3 });
assert.equal(MasterQualityPatch(0).ShadowMapRes, 1024);
assert.equal(EnginePatch("openpbr_direct").GiAlgorithm, "off");
assert.equal(ResolveRenderSettings({ MatcapLight: 900, MatcapChannel: "x", MatcapTint: "red" }).MatcapLight, 360);
assert.equal(ResolveRenderSettings({ MatcapChannel: "x" }).MatcapChannel, "shaded");
assert.equal(ResolveRenderSettings({ MatcapTint: "red" }).MatcapTint, CanonicalRenderSettings.MatcapTint);
assert.equal(EnginePatch("pt_final").GiAlgorithm, "bvh");
Checks.push("Defaults, clamps, unknown-id fallback, tier fan-out and engine → GI coupling match the source");

const Browser = await chromium.launch({ executablePath: process.env.FRONTIER_BROWSER_EXECUTABLE || "/tmp/chromium", args: ["--no-sandbox", "--disable-gpu"] });
const Page = await Browser.newPage({ viewport: { width: 1365, height: 900 } });
Page.setDefaultTimeout(12000);
const Address = process.env.FRONTIER_EDITOR_URL || "http://127.0.0.1:4173/ProjectZeroEditor/";
Page.on("pageerror", (Error) => Errors.push(Error.stack));
Page.on("requestfailed", (Request) => {
  if (Request.url().includes("fontshare.com")) FontFailures.push(Request.url());
});
const Open = async (Id) => {
  await Page.goto(Address + "?inspect=" + Id);
  await Page.locator(".inspector-scroll > [data-panel]").waitFor();
  await Page.waitForTimeout(250);
};
const Saved = () => Page.evaluate(() => JSON.parse(localStorage.getItem("Frontier.ProjectZeroHtml.v1")));
const Stored = async (Id) => ((await Saved())?.Values?.[Id] || {})["Render Settings"] || {};
const Cards = () => Page.locator(".rc-cards [data-card]").evaluateAll((Each) => Each.map((Card) => Card.dataset.card));
const InUse = () => Page.locator(".rc-use").getAttribute("data-in-use");
const Names = ["Render Engine", "MatCap", "Shadow Maps", "SDF Tracing", "Ray Tracing"];

try {
  await Page.goto(Address);
  await Page.evaluate(() => localStorage.clear());

  // Every camera lists the five render components, with their own icons; the camera inspector links to them.
  await Open("camera");
  const Rows = (await Saved()).Rows;
  for (const Owner of ["camera", "cine"])
    assert.deepEqual(Rows.filter((Row) => Row.Parent === Owner && Row.Panel === "object-component").map((Row) => Row.Name), Names, Owner);
  assert.equal(await Page.locator(".rs-section").count(), 0);
  assert.deepEqual(await Page.locator(".pi-components-card .oc-link b").allInnerTexts(), Names);
  for (const Icon of ["render-settings", "render-matcap", "render-shadow-maps", "render-sdf", "render-ray-tracing"]) {
    const Image = Page.locator(`.pi-components-card img[data-native-icon="${Icon}"]`);
    assert.equal(await Image.count(), 1, Icon);
    assert((await Image.evaluate((Each) => Each.naturalWidth)) > 0, Icon);
  }
  Checks.push("Editor and Cine cameras each carry Render Engine, MatCap, Shadow Maps, SDF Tracing and Ray Tracing, with baked icons");

  // Render Engine: engine families; picking OpenPBR couples GI off and moves the "in use" marks.
  await Open("camera-render-engine");
  assert.deepEqual(await Cards(), ["Engine", "Quality", "Output"]);
  assert.deepEqual(await Page.locator(".rc-family > span").allInnerTexts(), ["MATCAP", "RASTER", "SDF", "RAY TRACED"].map((Each) => Each), "families");
  await Page.locator(".rc-family button", { hasText: "OpenPBR direct" }).click();
  let Settings = await Stored("camera");
  assert.equal(Settings.RenderEngine, "openpbr_direct");
  assert.equal(Settings.GiAlgorithm, "off");
  assert.deepEqual(await Page.locator(".rc-uses button.on").allInnerTexts(), ["Shadow Maps", "Ray Tracing"]);
  Checks.push("Render Engine: OpenPBR direct turns GI off (source coupling); Shadow Maps and Ray Tracing stay in use");

  // Global tier fans out; a component's own tier then makes it Custom.
  await Page.getByRole("radio", { name: "Ultra", exact: true }).click();
  Settings = await Stored("camera");
  assert.equal(Settings.ShadowRays, 8);
  assert.equal(Settings.GiCones, 10);
  assert.equal(Settings.ReflectionBounces, 3);
  await Page.locator(".rc-uses button", { hasText: "Shadow Maps" }).click();
  await Page.locator('[data-render-component="Shadow Maps"]').waitFor();
  assert.deepEqual(await Cards(), ["Shadow map", "Penumbra"]);
  assert.equal(await InUse(), "true");
  await Page.getByLabel("Shadow quality", { exact: true }).selectOption({ label: "Low" });
  Settings = await Stored("camera");
  assert.equal(Settings.ShadowMapRes, 1024);
  assert.equal(Settings.PcssTaps, 8);
  await Page.getByRole("radio", { name: /3 × 3 PCF/ }).click();
  assert.equal((await Stored("camera")).ShadowAlgorithm, "pcf");
  assert.match(await Page.locator('[data-study="kernel"]').textContent(), /1024² map · 9 taps/);
  await Page.locator(".rc-cards").screenshot({ path: path.join(Proof, "ShadowMaps.png") });
  await Open("camera-render-engine");
  assert.equal(await Page.locator('.rc-segments[aria-label="Global quality tier"] [aria-checked="true"]').count(), 0);
  assert.match(await Page.locator('[data-card="Quality"]').innerText(), /Custom/);
  Checks.push("Ultra fans out to every pass; Shadow Maps Low gives a 1024² map, PCF draws 9 taps, and the global tier reads Custom");

  // SDF Tracing: penumbra rail and cone GI switch; idle under OpenPBR until the GI switch puts it in use.
  await Open("camera-sdf-tracing");
  assert.equal(await InUse(), "false");
  await Page.locator(".rc-rail button", { hasText: "Sobol spherical cap" }).click();
  assert.equal((await Stored("camera")).SdfPenumbraMode, "hybrid_sobol_cap");
  await Page.getByRole("switch", { name: "SDF cone GI", exact: true }).click();
  assert.equal((await Stored("camera")).GiAlgorithm, "sdf");
  assert.equal(await InUse(), "true");
  await Page.locator(".rc-cards").screenshot({ path: path.join(Proof, "SdfTracing.png") });
  Checks.push("SDF Tracing: Sobol spherical cap stored; turning on cone GI puts SDF Tracing in use under OpenPBR");

  // Ray Tracing lanes: tracing GI swaps it from SDF to BVH; reflections off falls back to the sky.
  await Open("camera-ray-tracing");
  await Page.getByRole("switch", { name: "Trace GI", exact: true }).click();
  await Page.getByRole("switch", { name: "Trace Reflections", exact: true }).click();
  Settings = await Stored("camera");
  assert.equal(Settings.GiAlgorithm, "bvh");
  assert.equal(Settings.ReflectionAlgorithm, "env");
  assert.deepEqual(await Cards(), ["Ray budget", "Traced GI"]);
  Checks.push("Ray Tracing: GI lane switches GI to BVH; reflections lane off falls back to sky/env");

  // MatCap on the Cine Camera: idle until "Use MatCap"; channel and light edits stay on the Cine Camera.
  await Open("cine-matcap");
  assert.equal(await InUse(), "false");
  await Page.locator(".rc-use button").click();
  assert.equal(await InUse(), "true");
  await Page.getByRole("radio", { name: "Normals", exact: true }).click();
  const Ball = await Page.locator(".rc-matcap").boundingBox();
  await Page.mouse.click(Ball.x + 4, Ball.y + Ball.height / 2);
  const Cine = await Stored("cine");
  assert.equal(Cine.RenderEngine, "matcap");
  assert.equal(Cine.MatcapChannel, "normal");
  assert(Math.abs(Cine.MatcapLight - 180) <= 3, String(Cine.MatcapLight));
  assert.equal((await Stored("camera")).RenderEngine, "openpbr_direct");
  assert.equal(await Page.locator(".outliner-row", { hasText: "Normals · light 180°" }).count(), 1);
  await Page.locator(".rc-cards").screenshot({ path: path.join(Proof, "MatCap.png") });
  Checks.push(`MatCap: Use MatCap switches only the Cine Camera; Normals stored and dragging the sphere edge sets the light to ${Cine.MatcapLight}°`);

  // A camera placed from Construct gets its own five components; Reset restores the defaults.
  await Page.getByRole("button", { name: "Construct", exact: true }).click();
  await Page.getByRole("dialog", { name: "Construct", exact: true }).waitFor();
  await Page.getByRole("textbox", { name: "Search construct", exact: true }).fill("Main Camera");
  await Page.locator(".construct-matrix").getByRole("button", { name: "Main Camera", exact: true }).click();
  await Page.getByRole("button", { name: "Add to scene", exact: true }).click();
  await Page.waitForTimeout(400);
  const Placed = (await Saved()).Rows.find((Row) => /^camera-/.test(Row.Id) && Row.Panel === "camera");
  assert(Placed, "placed camera");
  assert.deepEqual((await Saved()).Rows.filter((Row) => Row.Parent === Placed.Id).map((Row) => Row.Name), Names);
  await Open(Placed.Id + "-render-engine");
  await Page.locator(".rc-family button", { hasText: "Path tracer · final" }).click();
  assert.equal((await Stored(Placed.Id)).RenderEngine, "pt_final");
  assert.equal((await Stored("cine")).RenderEngine, "matcap");
  await Page.locator(".rc-reset button").click();
  assert.equal((await Stored(Placed.Id)).RenderEngine, "gtx_sdf_gi");
  Checks.push("A Construct-placed camera gets its own five render components; Reset restores the source defaults");

  // Scenes saved before (ComponentRevision 1) gain the camera components once.
  await Page.evaluate(() => {
    const Scene = JSON.parse(localStorage.getItem("Frontier.ProjectZeroHtml.v1"));
    Scene.Rows = Scene.Rows.filter((Row) => !(Row.Panel === "object-component" && /^(camera|cine)-/.test(Row.Id)));
    Scene.ComponentRevision = 1;
    localStorage.setItem("Frontier.ProjectZeroHtml.v1", JSON.stringify(Scene));
  });
  await Open("cine");
  const Restored = (await Saved()).Rows;
  assert.equal(Restored.filter((Row) => Row.Parent === "cine" && Row.Panel === "object-component").length, 5);
  assert.equal(Restored.filter((Row) => Row.Parent === "cube" && Row.Panel === "object-component").length, 3);
  Checks.push("Scenes saved at ComponentRevision 1 gain the camera render components on load; object components are untouched");
} catch (Error) {
  Errors.push(Error.stack);
} finally {
  fs.writeFileSync(path.join(Proof, "Checks.json"), JSON.stringify({ Checks, Errors, FontFailures }, null, 2));
  await Browser.close();
}
assert.deepEqual(Errors, []);
console.log("Render settings checks passed:", Checks.length);
