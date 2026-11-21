import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { ResolveRenderSettings, CanonicalRenderSettings, MasterQualityPatch, EnginePatch } from "./RenderSettings.js";

// Per-camera render settings: every camera row (Editor, Cine, Construct-placed) has its own copy, with the source presets.
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
const Section = () => Page.locator(".rs-section");
const Pick = (Label, Option) => Section().getByLabel(Label, { exact: true }).selectOption({ label: Option });
const Turn = (Page_) => Section().getByRole("tab", { name: Page_, exact: true }).click();

try {
  await Page.goto(Address);
  await Page.evaluate(() => localStorage.clear());

  // Editor Camera: heading with its own icon, quality page first.
  await Open("camera");
  await Section().scrollIntoViewIfNeeded();
  assert.equal(await Section().getAttribute("data-render-settings"), "camera");
  const Icon = Section().locator('img[data-native-icon="render-settings"]');
  assert.equal(await Icon.count(), 1);
  assert((await Icon.evaluate((Image) => Image.naturalWidth)) > 0);
  assert.deepEqual(await Section().locator("[data-card]").evaluateAll((Cards) => Cards.map((Card) => Card.dataset.card)), ["World render engine"]);
  Checks.push("Editor Camera shows Render settings with the render-settings icon and the World render engine card");

  // Engine pick couples GI; the summary chip follows.
  await Pick("Engine", "OpenPBR direct");
  let Settings = await Stored("camera");
  assert.equal(Settings.RenderEngine, "openpbr_direct");
  assert.equal(Settings.GiAlgorithm, "off");
  assert(await Section().locator(".rs-summary", { hasText: "Off (Ambient Fill)" }).count());
  Checks.push("OpenPBR direct turns GI off, as in the source inspector");

  // Global tier writes every count; a single-pass change then reads Custom.
  await Pick("Global quality tier", "Ultra");
  Settings = await Stored("camera");
  assert.equal(Settings.ShadowRays, 8);
  assert.equal(Settings.GiCones, 10);
  assert.equal(Settings.ReflectionBounces, 3);
  await Turn("Lighting");
  assert.deepEqual(await Section().locator("[data-card]").evaluateAll((Cards) => Cards.map((Card) => Card.dataset.card)), ["Shadows", "Global illumination", "Reflections"]);
  await Pick("Shadow quality", "Low");
  Settings = await Stored("camera");
  assert.equal(Settings.ShadowMapRes, 1024);
  assert.equal(Settings.PcssTaps, 8);
  await Page.screenshot({ path: path.join(Proof, "EditorCameraLighting.png"), fullPage: false });
  await Turn("Quality");
  assert.equal(await Section().getByLabel("Global quality tier", { exact: true }).evaluate((Select) => Select.selectedOptions[0].textContent), "Custom (mixed tiers)");
  Checks.push("Ultra tier fans out to every pass; dropping shadows to Low shows Custom and a 1024² map");

  // Cine Camera keeps its own defaults and its own edits.
  await Open("cine");
  await Section().scrollIntoViewIfNeeded();
  assert.equal(await Section().getByLabel("Engine", { exact: true }).evaluate((Select) => Select.selectedOptions[0].textContent), "GTX real-time GI");
  await Turn("Output");
  await Pick("Resolution scale", "50 %");
  assert.equal((await Stored("cine")).RenderScale, 50);
  assert.equal((await Stored("camera")).RenderScale, 100);
  assert(await Section().getByText("960 × 540").count());
  Checks.push("Cine Camera starts from the defaults; its 50 % scale leaves the Editor Camera at 100 %");

  // A camera placed from Construct gets its own copy too.
  await Page.getByRole("button", { name: "Construct", exact: true }).click();
  await Page.getByRole("dialog", { name: "Construct", exact: true }).waitFor();
  await Page.getByRole("textbox", { name: "Search construct", exact: true }).fill("Main Camera");
  await Page.locator(".construct-matrix").getByRole("button", { name: "Main Camera", exact: true }).click();
  await Page.getByRole("button", { name: "Add to scene", exact: true }).click();
  await Section().waitFor();
  const Placed = await Section().getAttribute("data-render-settings");
  assert.match(Placed, /^camera-/);
  await Section().scrollIntoViewIfNeeded();
  await Pick("Engine", "MatCap studio");
  assert.equal((await Stored(Placed)).RenderEngine, "matcap");
  assert.equal((await Stored("cine")).RenderEngine, "gtx_sdf_gi");
  await Page.screenshot({ path: path.join(Proof, "ConstructCamera.png") });
  await Section().getByRole("button", { name: "Reset", exact: true }).click();
  assert.equal((await Stored(Placed)).RenderEngine, "gtx_sdf_gi");
  Checks.push("A Construct-placed camera has its own settings; Reset restores the source defaults");
} catch (Error) {
  Errors.push(Error.stack);
} finally {
  fs.writeFileSync(path.join(Proof, "Checks.json"), JSON.stringify({ Checks, Errors, FontFailures }, null, 2));
  await Browser.close();
}
assert.deepEqual(Errors, []);
console.log("Render settings checks passed:", Checks.length);
