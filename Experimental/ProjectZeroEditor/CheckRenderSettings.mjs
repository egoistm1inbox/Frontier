import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { ResolveRenderSettings, CanonicalRenderSettings, MasterQualityPatch, RendererPatch, MasterTier, PbrShadowPatch, OcclusionOf, RendererLines } from "./RenderSettings.js";

// Per-camera render settings as one Camera Settings component (Render Engine before Follow-up 77): every camera (Editor, Cine,
// Construct-placed) has a single row. Its inspector carousel opens on Overview (render type cards, the chosen renderer's page lines,
// Quality); the next pages are that renderer's own (PBR: Shadows, Lighting, AO; SDF: Shadows, GI, AO; Ray traced: GI, Shadows, AO,
// Reflections; MatCap: Shadows, Lighting, MatCap type), then Output. Each renderer keeps its own keys.
const Folder = path.dirname(fileURLToPath(import.meta.url));
const Require = createRequire(process.env.FRONTIER_BROWSER_PACKAGE || path.resolve(Folder, "../../../_AgentScratch/Browser/package.json"));
const { chromium } = Require("playwright");
const Proof = process.env.FRONTIER_PROOF_FOLDER || path.join(Folder, "Screenshots/RenderSettings");
fs.mkdirSync(Proof, { recursive: true });
const Checks = [],
  Errors = [],
  FontFailures = [];

// Pure data first: clamping, fallbacks, the per-renderer preset fan-out, and the upgrade of the shared Follow-up 37–41 keys.
assert.deepEqual(ResolveRenderSettings({}), CanonicalRenderSettings);
const Wild = ResolveRenderSettings({ RenderEngine: "sdf_shadows", PbrContactRays: 99, PbrPcssTaps: 1, PbrMapRes: 4096, SdfGiIntensity: -3, RenderScale: 60, ExposureGain: "x", RayShadow: "bvh", MatcapShadow: "x" });
assert.equal(Wild.RenderEngine, "gtx_sdf_gi");
assert.equal(Wild.PbrContactRays, 16);
assert.equal(Wild.PbrPcssTaps, 8);
assert.equal(Wild.PbrMapRes, 2048);
assert.equal(Wild.SdfGiIntensity, 0);
assert.equal(Wild.RenderScale, 100);
assert.equal(Wild.ExposureGain, 1.35);
assert.equal(Wild.RayShadow, "bvh_disk");
assert.equal(Wild.MatcapShadow, "drop");
const Ultra = MasterQualityPatch(3);
assert.deepEqual([Ultra.PbrContactRays, Ultra.PbrPcssTaps, Ultra.SdfSteps, Ultra.SdfCones, Ultra.RayShadowRays, Ultra.RayGiSamples, Ultra.RayReflectionBounces], [8, 32, 48, 10, 8, 14, 3]);
assert.equal(PbrShadowPatch(0).PbrMapRes, 1024);
assert.equal(MasterTier({ ...CanonicalRenderSettings, ...PbrShadowPatch(0) }), -1);
assert.equal(RendererPatch("ray", { RayTracer: "pt_final" }).RenderEngine, "pt_final");
const Upgraded = ResolveRenderSettings({ RenderEngine: "pt_realtime", ShadowAlgorithm: "pcf", ShadowMapRes: 1024, SdfPenumbraMode: "analytic_cone", GiAlgorithm: "bvh", GiSamples: 12, ReflectionAlgorithm: "env" });
assert.deepEqual([Upgraded.PbrShadow, Upgraded.PbrMapRes, Upgraded.SdfShadow, Upgraded.RayGi, Upgraded.SdfGi, Upgraded.RayGiSamples, Upgraded.RayReflections, Upgraded.RayTracer], ["pcf", 1024, "analytic_cone", true, false, 12, false, "pt_realtime"]);
Checks.push("Defaults, clamps, unknown-id fallback, per-renderer tier fan-out and the upgrade of the shared Follow-up 41 keys");
// Follow-up 46: each renderer has its own ambient occlusion keys; MatCap has none.
const Occluded = ResolveRenderSettings({ SdfAoMethod: "hbao", SdfAoTaps: 40, RayAoRays: 0, XeGtaoSlices: 12, RayAoMethod: "rtao_bent" });
assert.deepEqual([Occluded.SdfAoMethod, Occluded.SdfAoTaps, Occluded.RayAoRays, Occluded.XeGtaoSlices, Occluded.RayAoMethod], ["sdf_cone", 12, 1, 9, "rtao_bent"]);
assert.deepEqual(["openpbr_direct", "gtx_sdf_gi", "pt_final", "matcap"].map((RenderEngine) => OcclusionOf({ ...CanonicalRenderSettings, RenderEngine })?.Switch ?? null), ["XeGtao", "SdfAo", "RayAo", null]);
assert.deepEqual(RendererLines(CanonicalRenderSettings).at(-1), ["AO", "Cone-traced SDF AO · 4 cones"]);
Checks.push("Ambient occlusion per renderer: XeGTAO (PBR), SDF AO and traced AO keys clamp and fall back; MatCap has none; the summary gains an AO line");

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
// The open page of the carousel, its cards, and turning to a page or picking a render type on Overview.
const Shown = () => Page.locator(".rc-settings .it-page:not([hidden]) .rc-cards");
const Cards = () => Shown().locator("[data-card]").evaluateAll((Each) => Each.map((Card) => Card.dataset.card));
const Pills = async () => (await Page.locator(".rc-settings .pc-pill").allInnerTexts()).map((Text) => Text.replace(/^\s*\d+\s*/, "").trim());
const Turn = async (Id) => {
  await Page.locator(`.rc-settings .pc-pill[data-tab-for$=":${Id}"]`).click();
  await Page.locator(`.rc-settings .it-page:not([hidden]) .rc-cards[data-render-tab="${Id}"]`).waitFor();
  await Page.waitForTimeout(350);
};
const Type = async (Id) => {
  await Turn("overview");
  await Page.locator(`.rc-types [data-render-type="${Id}"]`).click();
  await Page.locator(`.rc-settings[data-render-type="${Id}"]`).waitFor();
  await Page.waitForTimeout(250);
};

try {
  await Page.goto(Address);
  await Page.evaluate(() => localStorage.clear());

  // Every camera lists one Camera Settings component with its baked icon; the four retired render-path icons no longer ship.
  await Open("camera");
  const Rows = (await Saved()).Rows;
  for (const Owner of ["camera", "cine"])
    assert.deepEqual(Rows.filter((Row) => Row.Parent === Owner && Row.Panel === "object-component").map((Row) => Row.Name), ["Camera Settings"], Owner);
  assert.deepEqual(await Page.locator(".pi-components-card .oc-link b").allInnerTexts(), ["Camera Settings"]);
  const Image = Page.locator('.pi-components-card img[data-native-icon="render-settings"]');
  assert.equal(await Image.count(), 1);
  assert((await Image.evaluate((Each) => Each.naturalWidth)) > 0);
  assert.deepEqual(await Page.evaluate(() => ["render-matcap", "render-shadow-maps", "render-sdf", "render-ray-tracing"].filter((Name) => window.NativeAssets?.Icons?.[Name])), []);
  Checks.push("Editor and Cine cameras each carry one Camera Settings component with its baked icon; the retired icons are gone");

  // Overview: render type cards, the chosen renderer's page lines, Quality; the carousel follows the render type. The old address opens it.
  await Open("camera-render-engine");
  assert.equal(await Page.locator(".inspector-scroll h1").first().innerText(), "Camera Settings");
  assert.deepEqual(await Pills(), ["Overview", "Shadows", "GI", "AO", "Output"]);
  assert.deepEqual(await Cards(), ["Render type", "SDF tracing", "Quality"]);
  assert.equal(await Page.locator('.rc-types [aria-checked="true"]').getAttribute("data-render-type"), "sdf");
  assert.equal(await Page.locator(".rc-type-hero").getAttribute("data-render-type-shown"), "sdf");
  await Type("pbr");
  let Settings = await Stored("camera");
  assert.equal(Settings.RenderEngine, "openpbr_direct");
  assert.deepEqual(await Pills(), ["Overview", "Shadows", "Lighting", "AO", "Output"]);
  assert.match(await Shown().locator(".rc-page-list").innerText(), /Shadows\s+Contact PCSS · 2048²/);
  await Shown().screenshot({ path: path.join(Proof, "Engine.png") });
  Checks.push("Overview: picking the PBR card sets OpenPBR direct; the carousel becomes Shadows, Lighting, AO, Output and the page lines sum them up");

  // Each renderer keeps its own shadow algorithm: PBR PCF at Low, SDF Sobol cap; neither touches the other.
  await Turn("ao");
  assert.deepEqual(await Cards(), ["Ambient occlusion"]);
  assert.match(await Shown().innerText(), /XeGTAO/);
  await Shown().getByRole("switch", { name: "XeGTAO", exact: true }).click();
  assert.equal((await Stored("camera")).XeGtao, false);
  await Shown().getByRole("switch", { name: "XeGTAO", exact: true }).click();
  await Turn("shadows");
  assert.deepEqual(await Cards(), ["Shadow algorithm", "Penumbra"]);
  await Shown().getByLabel("Shadow quality", { exact: true }).selectOption({ label: "Low" });
  await Shown().getByRole("radio", { name: /PCF Bilinear/ }).click();
  Settings = await Stored("camera");
  assert.deepEqual([Settings.PbrShadow, Settings.PbrMapRes, Settings.PbrPcssTaps], ["pcf", 1024, 8]);
  assert.match(await Shown().locator('[data-study="kernel"]').textContent(), /1024² map · 9 taps/);
  await Shown().screenshot({ path: path.join(Proof, "Pbr.png") });
  await Type("sdf");
  await Turn("ao");
  assert.deepEqual(await Cards(), ["SDF ambient occlusion"]);
  await Shown().getByRole("radiogroup", { name: "SDF AO method" }).getByRole("radio", { name: /Multi-tap SDF AO/ }).click();
  await Shown().locator('input[type=range][aria-label="Taps"]').fill("8");
  assert.equal(await Shown().locator('[data-ao="sdf_multitap"]').count(), 1);
  await Shown().screenshot({ path: path.join(Proof, "SdfAmbientOcclusion.png") });
  await Turn("shadows");
  assert.deepEqual(await Cards(), ["Distance-field shadows"]);
  await Shown().locator(".rc-rail button", { hasText: "Hybrid Sobol Cap" }).click();
  await Turn("gi");
  assert.deepEqual(await Cards(), ["Cone GI"]);
  Settings = await Stored("camera");
  assert.deepEqual([Settings.SdfShadow, Settings.PbrShadow, Settings.RenderEngine], ["hybrid_sobol_cap", "pcf", "gtx_sdf_gi"]);
  assert.deepEqual([Settings.SdfAoMethod, Settings.SdfAoTaps, Settings.XeGtao], ["sdf_multitap", 8, true]);
  await Shown().screenshot({ path: path.join(Proof, "Sdf.png") });
  Checks.push("PBR stores PCF at Low (1024², 8 taps) and SDF stores the Sobol cap and multi-tap AO separately");

  // Global tier: Custom after a renderer tier, then Ultra fans out to every renderer.
  await Turn("overview");
  assert.equal(await Shown().locator('.rc-segments[aria-label="Global quality tier"] [aria-checked="true"]').count(), 0);
  assert.match(await Shown().locator('[data-card="Quality"]').innerText(), /Custom/);
  await Shown().getByRole("radio", { name: "Ultra", exact: true }).click();
  Settings = await Stored("camera");
  assert.deepEqual([Settings.PbrContactRays, Settings.SdfCones, Settings.RayGiSamples, Settings.RayReflectionBounces], [8, 10, 14, 3]);
  Checks.push("A renderer's own tier makes the global tier Custom; Ultra then fans out to PBR, SDF and ray tracing");

  // Ray traced: Tracer | GI | Shadows | AO | Reflections; remembered across renderer switches.
  await Type("ray");
  assert.equal((await Stored("camera")).RenderEngine, "highend_bvh4_gi");
  assert.deepEqual(await Pills(), ["Overview", "Tracer", "GI", "Shadows", "AO", "Reflections", "Output"]);
  // Follow-up 78: the tracers have their own page.
  await Turn("tracer");
  await Shown().getByRole("radiogroup", { name: "Tracer" }).getByRole("radio", { name: /^PT final/ }).click();
  await Turn("overview");
  await Shown().locator('.rc-page-list [data-open-page="reflections"]').click();
  await Page.locator('.rc-settings .it-page:not([hidden]) .rc-cards[data-render-tab="reflections"]').waitFor();
  await Page.waitForTimeout(350);
  await Shown().getByRole("switch", { name: "Trace reflections", exact: true }).click();
  await Turn("shadows");
  await Shown().getByRole("radio", { name: /WideTree RayQuery · area/ }).click();
  await Turn("ao");
  await Shown().getByRole("radiogroup", { name: "Ray-traced AO method" }).getByRole("radio", { name: /RTAO \+ bent normal/ }).click();
  await Shown().locator('input[type=range][aria-label="AO rays"]').fill("6");
  await Shown().screenshot({ path: path.join(Proof, "RayAmbientOcclusion.png") });
  Settings = await Stored("camera");
  assert.deepEqual([Settings.RayAoMethod, Settings.RayAoRays, Settings.SdfAoMethod], ["rtao_bent", 6, "sdf_multitap"]);
  assert.deepEqual([Settings.RenderEngine, Settings.RayTracer, Settings.RayShadow, Settings.RayReflections], ["pt_final", "pt_final", "bvh_area", false]);
  await Type("sdf");
  await Type("ray");
  assert.equal((await Stored("camera")).RenderEngine, "pt_final");
  Checks.push("Ray traced: Tracer, GI, Shadows, AO, Reflections pages; PT final, area shadows and reflections off are stored (a page line opens Reflections); the tracer is remembered across renderers");

  // MatCap on the Cine Camera: Shadows | Lighting | MatCap type; edits stay on the Cine Camera.
  await Open("cine-camera-settings");
  await Type("matcap");
  assert.deepEqual(await Pills(), ["Overview", "Shadows", "Lighting", "MatCap type", "Output"]);
  await Turn("matcap");
  assert.deepEqual(await Cards(), ["MatCap type"]);
  await Shown().getByRole("radio", { name: "Normals", exact: true }).click();
  await Shown().locator(".rc-matcap").scrollIntoViewIfNeeded();
  const Ball = await Shown().locator(".rc-matcap").boundingBox();
  await Page.mouse.click(Ball.x + 4, Ball.y + Ball.height / 2);
  await Turn("shadows");
  assert.deepEqual(await Cards(), ["Studio shadow"]);
  await Shown().getByRole("radio", { name: /Screen contact/ }).click();
  const Cine = await Stored("cine");
  assert.deepEqual([Cine.RenderEngine, Cine.MatcapChannel, Cine.MatcapShadow], ["matcap", "normal", "contact"]);
  assert(Math.abs(Cine.MatcapLight - 180) <= 3, String(Cine.MatcapLight));
  assert.equal((await Stored("camera")).RenderEngine, "pt_final");
  assert.equal(await Page.locator(".outliner-row", { hasText: "MatCap · Ultra · 100 %" }).count(), 0);
  assert.equal(await Page.locator(".outliner-row", { hasText: "MatCap · Medium · 100 %" }).count(), 1);
  await Turn("overview");
  await Shown().screenshot({ path: path.join(Proof, "MatCap.png") });
  Checks.push(`MatCap: the MatCap card switches only the Cine Camera; Shadows, Lighting, MatCap type pages; Normals and screen-contact shadow stored, light ${Cine.MatcapLight}°`);

  // A camera placed from Construct gets its own single component; Reset restores the defaults.
  await Page.getByRole("button", { name: "Construct", exact: true }).click();
  await Page.getByRole("dialog", { name: "Construct", exact: true }).waitFor();
  await Page.getByRole("textbox", { name: "Search construct", exact: true }).fill("Main Camera");
  await Page.locator(".construct-matrix").getByRole("button", { name: "Main Camera", exact: true }).click();
  await Page.getByRole("button", { name: "Add to scene", exact: true }).click();
  await Page.waitForTimeout(400);
  const Placed = (await Saved()).Rows.find((Row) => /^camera-/.test(Row.Id) && Row.Panel === "camera");
  assert(Placed, "placed camera");
  assert.deepEqual((await Saved()).Rows.filter((Row) => Row.Parent === Placed.Id).map((Row) => Row.Name), ["Camera Settings"]);
  await Open(Placed.Id + "-camera-settings");
  await Type("matcap");
  assert.equal((await Stored(Placed.Id)).RenderEngine, "matcap");
  await Shown().locator(".rc-reset button").click();
  assert.equal((await Stored(Placed.Id)).RenderEngine, "gtx_sdf_gi");
  Checks.push("A Construct-placed camera gets its own Camera Settings component; Reset restores the source defaults");

  // Scenes saved with the Follow-up 41 rows (ComponentRevision 2) lose the four render-path rows once; old shared keys still read; the
  // Render Engine row is renamed Camera Settings.
  await Page.evaluate(() => {
    const Scene = JSON.parse(localStorage.getItem("Frontier.ProjectZeroHtml.v1"));
    const Old = [["MatCap", "matcap"], ["Shadow Maps", "shadow-maps"], ["SDF Tracing", "sdf-tracing"], ["Ray Tracing", "ray-tracing"]];
    const At = Scene.Rows.findIndex((Row) => Row.Id === "cine-camera-settings");
    Scene.Rows[At] = { ...Scene.Rows[At], Id: "cine-render-engine", Name: "Render Engine", Component: "Render Engine" };
    Scene.Rows.splice(At + 1, 0, ...Old.map(([Name, Slug]) => ({ Id: "cine-" + Slug, Name, Panel: "object-component", Icon: "render-" + Slug, Parent: "cine", Component: Name })));
    Scene.Values.cine = { ...(Scene.Values.cine || {}), "Render Settings": { RenderEngine: "openpbr_direct", ShadowAlgorithm: "pcf", ShadowMapRes: 1024, SdfPenumbraMode: "analytic_cone" } };
    Scene.Selected = "cine-render-engine";
    Scene.ComponentRevision = 2;
    localStorage.setItem("Frontier.ProjectZeroHtml.v1", JSON.stringify(Scene));
  });
  await Open("cine-render-engine");
  const Restored = (await Saved()).Rows;
  assert.deepEqual(Restored.filter((Row) => Row.Parent === "cine" && Row.Panel === "object-component").map((Row) => Row.Id + " " + Row.Name), ["cine-camera-settings Camera Settings"]);
  // Follow-up 46: object components are no longer outliner rows (they live in each object's component stack).
  assert.equal(Restored.filter((Row) => Row.Parent === "cube" && Row.Panel === "object-component").length, 0);
  assert.equal(await Page.locator(".rc-settings").getAttribute("data-render-type"), "pbr");
  await Turn("shadows");
  assert.equal(await Shown().getByRole("radio", { name: /PCF Bilinear/ }).getAttribute("aria-checked"), "true");
  Checks.push("Scenes saved at ComponentRevision 2 drop MatCap, Shadow Maps, SDF Tracing and Ray Tracing rows and rename Render Engine to Camera Settings; their PCF setup reads on the PBR Shadows page");
} catch (Error) {
  Errors.push(Error.stack);
} finally {
  fs.writeFileSync(path.join(Proof, "Checks.json"), JSON.stringify({ Checks, Errors, FontFailures }, null, 2));
  await Browser.close();
}
assert.deepEqual(Errors, []);
console.log("Render settings checks passed:", Checks.length);
