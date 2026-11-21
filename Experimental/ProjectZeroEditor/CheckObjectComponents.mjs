import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Follow-up 40: object components (Mass, Rigid Body, Collision) under each showcase object, the per-workspace carousel pages and
// the editable Vehicle Movement charts.
const Folder = path.dirname(fileURLToPath(import.meta.url));
const Require = createRequire(process.env.FRONTIER_BROWSER_PACKAGE || path.resolve(Folder, "../../../_AgentScratch/Browser/package.json"));
const { chromium } = Require("playwright");
const Proof = process.env.FRONTIER_PROOF_FOLDER || path.join(Folder, "Screenshots/ObjectComponents");
fs.mkdirSync(Proof, { recursive: true });
const Checks = [],
  Errors = [];
const Browser = await chromium.launch({ executablePath: process.env.FRONTIER_BROWSER_EXECUTABLE || "/tmp/chromium", args: ["--no-sandbox", "--disable-gpu"] });
const Page = await Browser.newPage({ viewport: { width: 1440, height: 1000 } });
Page.setDefaultTimeout(15000);
const Address = process.env.FRONTIER_EDITOR_URL || "http://127.0.0.1:4173/ProjectZeroEditor/";
const Key = "Frontier.ProjectZeroHtml.v1";
Page.on("pageerror", (Error) => Errors.push(Error.stack));
const Open = async (Id) => {
  await Page.goto(Address + "?inspect=" + Id);
  await Page.locator(".inspector-scroll > [data-panel]").waitFor();
  await Page.waitForTimeout(300);
};
const Saved = () => Page.evaluate((Name) => JSON.parse(localStorage.getItem(Name)), Key);
const Pill = (Name) => Page.locator(`.pi-pill[aria-label="${Name}"]`);
const Metrics = () => Page.locator(".vc-card .metric").allInnerTexts();
async function DragHandle(Plot, Index, Dx, Dy) {
  const Handle = Page.locator(`[data-plot="${Plot}"] .vc-handle`).nth(Index);
  await Handle.scrollIntoViewIfNeeded();
  const Box = await Handle.boundingBox();
  const X = Box.x + Box.width / 2, Y = Box.y + Box.height / 2;
  await Page.mouse.move(X, Y);
  await Page.mouse.down();
  await Page.mouse.move(X + Dx / 2, Y + Dy / 2);
  await Page.mouse.move(X + Dx, Y + Dy);
  await Page.mouse.up();
  await Page.waitForTimeout(250);
}

try {
  await Page.goto(Address);
  await Page.evaluate(() => localStorage.clear());

  // Every showcase object lists three components as outliner children, and the Overview links to them.
  await Open("cube");
  const Ids = ["cube", "sphere", "cylinder", "torus", "cone"].flatMap((Owner) => ["mass", "rigid-body", "collision"].map((Part) => `${Owner}-${Part}`));
  const Rows = (await Saved())?.Rows || [];
  for (const Id of Ids) assert(Rows.some((Row) => Row.Id === Id && Row.Panel === "object-component"), Id);
  assert.deepEqual(await Page.locator(".pi-components-card .oc-link b").allInnerTexts(), ["Mass", "Rigid Body", "Collision"]);
  assert.deepEqual(await Page.locator(".pi-pill").evaluateAll((Pills) => Pills.map((Each) => Each.getAttribute("aria-label"))), ["Overview", "Geometry", "Material", "UV", "Fracture", "SDF", "LOD"]);
  assert.equal(await Page.locator('.pi-pill[aria-label="Physics"]').count(), 0);
  Checks.push("15 component rows (Mass, Rigid Body, Collision × 5 objects); the carousel is Overview, Geometry, Material, UV, Fracture, SDF, LOD");

  // Mass edits are stored on the owning object, and the outliner line follows.
  await Page.locator('.oc-link[data-component="Mass"]').click();
  await Page.locator('.object-component-inspector[data-panel="object-component"]').waitFor();
  assert.match(await Page.locator(".object-component-inspector h1").innerText(), /Mass/);
  assert.match(await Page.locator(".pi-component .metric").first().innerText(), /950\s*kg/);
  await Page.locator(".pi-component select").first().selectOption({ label: "Aluminium · 2700 kg/m³" });
  await Page.waitForTimeout(250);
  assert.match(await Page.locator(".pi-component .metric").first().innerText(), /2,?700\s*kg/);
  const Values = (await Saved()).Values;
  assert.equal(Values.cube["Physics Density"], "Aluminium");
  assert.equal(Values["cube-mass"]?.["Physics Density"], undefined);
  assert.equal(await Page.locator(".outliner-row", { hasText: "2700 kg · Aluminium" }).count(), 1);
  await Page.locator(".inspector-scroll").screenshot({ path: path.join(Proof, "MassComponent.png") });
  Checks.push("Mass component: Aluminium writes Values.cube, the figure reads 2,700 kg and the outliner line follows");

  // Collision: the torus defaults to its distance field; a box proxy is chosen by hand.
  await Open("torus-collision");
  assert.match(await Page.locator('[data-card="Collision shape"]').innerText(), /Needs an SDF bake/);
  await Page.locator('[data-card="Collision shape"] select').selectOption({ label: "Box" });
  await Page.waitForTimeout(200);
  assert.equal((await Saved()).Values.torus["Collision Shape"], "box");
  assert.equal(await Page.locator(".outliner-row", { hasText: "Box · collides" }).count(), 2);
  Checks.push("Collision component: torus starts on SDF (asks for a bake), Box is stored on the torus");

  // Removing a component keeps it removed after reload; the Overview can add it back.
  await Open("sphere-rigid-body");
  await Page.locator(".outliner-row.selected").click({ button: "right" });
  await Page.getByRole("menu").getByRole("button", { name: "Remove from HTML scene", exact: true }).click();
  await Page.waitForTimeout(300);
  await Open("sphere");
  assert.deepEqual(await Page.locator(".pi-components-card .oc-link b").allInnerTexts(), ["Mass", "Collision"]);
  await Page.reload();
  await Page.locator(".pi-components-card").waitFor();
  assert.deepEqual(await Page.locator(".pi-components-card .oc-link b").allInnerTexts(), ["Mass", "Collision"]);
  await Page.locator(".oc-add button", { hasText: "Rigid Body" }).click();
  await Page.waitForTimeout(250);
  assert.deepEqual(await Page.locator(".pi-components-card .oc-link b").allInnerTexts(), ["Mass", "Collision", "Rigid Body"]);
  Checks.push("Deleted Rigid Body stays deleted across reload (ComponentRevision 1) and the Overview adds it back");

  // A scene saved before components gets them once.
  await Page.evaluate((Name) => {
    const Scene = JSON.parse(localStorage.getItem(Name));
    Scene.Rows = Scene.Rows.filter((Row) => Row.Panel !== "object-component");
    delete Scene.ComponentRevision;
    localStorage.setItem(Name, JSON.stringify(Scene));
  }, Key);
  await Open("cone");
  const Gained = ((await Saved()).Rows || []).filter((Row) => Row.Panel === "object-component");
  assert.equal(Gained.filter((Row) => ["cube", "sphere", "cylinder", "torus", "cone"].includes(Row.Parent)).length, 15);
  assert.equal(Gained.filter((Row) => ["camera", "cine"].includes(Row.Parent)).length, 10);
  Checks.push("Older saved scenes gain the 15 object and 10 camera component rows on load");

  // Each workspace preview has its own page.
  await Open("cube");
  for (const [Page_, Title] of [["UV", "UV preview"], ["Fracture", "Fracture preview"], ["SDF", "SDF preview"], ["LOD", "LOD preview"]]) {
    await Pill(Page_).click();
    await Page.locator(`[data-card="${Title}"]`).waitFor();
  }
  await Pill("Geometry").click();
  assert.equal(await Page.locator('[data-card="UV preview"]').count(), 0);
  Checks.push("UV, Fracture, SDF and LOD previews each sit on their own carousel page; Geometry no longer holds the UV card");

  // Vehicle Movement charts are editable.
  await Open("vehicle-movement");
  const Before = await Metrics();
  await DragHandle("suspension", 0, 0, -30);
  let Stored = (await Saved()).Values["vehicle-movement"];
  assert(Stored.dampingRatio < 0.6, String(Stored.dampingRatio));
  await DragHandle("torque", 8, 0, -40);
  Stored = (await Saved()).Values["vehicle-movement"];
  assert.equal(Stored.torqueCurve.length, 18);
  assert(Stored.torqueCurve[6][1] > 486, JSON.stringify(Stored.torqueCurve[6]));
  await DragHandle("torque", 0, -30, 0);
  assert((await Saved()).Values["vehicle-movement"].redlineRpm < 7200);
  await DragHandle("aero", 0, 0, -30);
  await DragHandle("aero", 1, 0, 30);
  Stored = (await Saved()).Values["vehicle-movement"];
  assert(Stored.dragArea > 0.74 && Stored.dragArea <= 1.2, String(Stored.dragArea));
  assert(Stored.liftArea < 1.1 && Stored.liftArea >= 0, String(Stored.liftArea));
  const After = await Metrics();
  assert.notEqual(After[2], Before[2]);
  assert.notEqual(After[4], Before[4]);
  await Page.locator('[data-plot="torque"]').screenshot({ path: path.join(Proof, "TorqueCurve.png") });
  Checks.push(`Vehicle charts: peak drag sets ζ ${Stored.dampingRatio}, torque point 7 → ${Stored.torqueCurve[6][1]} N·m, redline ${Stored.redlineRpm}, CdA ${Stored.dragArea}, ClA ${Stored.liftArea}`);
} catch (Error) {
  Errors.push(Error.stack);
} finally {
  fs.writeFileSync(path.join(Proof, "Checks.json"), JSON.stringify({ Checks, Errors }, null, 2));
  await Browser.close();
}
assert.deepEqual(Errors, []);
console.log("Object component checks passed:", Checks.length);
