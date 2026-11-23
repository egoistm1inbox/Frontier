// Follow-up 62: the Controlled Vehicle's Component Viewer panel (VehicleComponentViewer.jsx). Its inspector opens the panel, which has its
// own Components outliner, the vehicle view and its own Details; a click on a component (view or outliner) opens that component's native
// inspector in the panel while the editor stays on the vehicle; edits change the view; Add / Delete; Simulate; Esc closes; choosing a
// component elsewhere opens the panel on it.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const Folder = path.dirname(fileURLToPath(import.meta.url));
const Require = createRequire(process.env.FRONTIER_BROWSER_PACKAGE || path.resolve(Folder, "../../../_AgentScratch/Browser/package.json"));
const { chromium } = Require("playwright");
const Proof = process.env.FRONTIER_PROOF_FOLDER || path.join(Folder, "Screenshots/VehicleComponentViewer");
fs.mkdirSync(Proof, { recursive: true });
const Browser = await chromium.launch({
  executablePath: process.env.FRONTIER_BROWSER_EXECUTABLE || "/tmp/chromium",
  args: ["--no-sandbox", "--disable-gpu", "--enable-unsafe-swiftshader"],
});
const Page = await Browser.newPage({ viewport: { width: 1600, height: 1000 } });
Page.setDefaultTimeout(20000);
const Address = process.env.FRONTIER_EDITOR_URL || "http://127.0.0.1:4173/ProjectZeroEditor/";
const Checks = [],
  Errors = [],
  FontFailures = [];
Page.on("pageerror", (Error) => Errors.push(Error.stack));
Page.on("requestfailed", (Request) => {
  if (Request.url().includes("fontshare.com")) FontFailures.push(Request.url());
});
const Canvas = () => Page.locator(".vcv-canvas");
const Readings = () => Page.evaluate(() => ({ ...document.querySelector(".vcv-canvas")?.dataset }));
const Details = () => Page.locator(".vcp-details .inspector-heading h1").innerText();
const MainHeading = () => Page.locator(".inspector-scroll:not(.vcp-details) .inspector-heading h1").innerText();
const Saved = async (Id) => ((await Page.evaluate(() => JSON.parse(localStorage.getItem("Frontier.ProjectZeroHtml.v1"))))?.Values || {})[Id] || {};
const Tag = () => Page.locator(".vcv-tag span").innerText();
const PanelOn = (Id) => Page.waitForFunction((Id) => document.querySelector(".vcp")?.dataset.vcpSelected === Id && document.querySelector(".vcv-canvas")?.dataset.selectedComponent === Id, Id);
// Clicks where a component's pick target lands on screen.
const ClickComponent = async (Id) => {
  const Point = await Page.evaluate((Id) => {
    const Surface = document.querySelector(".vcv-canvas"), Rect = Surface.getBoundingClientRect(), At = JSON.parse(Surface.dataset.picks)[Id];
    return At && [Rect.left + At[0] * Rect.width, Rect.top + At[1] * Rect.height];
  }, Id);
  assert(Point, "no pick target for " + Id);
  await Page.mouse.click(Point[0], Point[1]);
  await PanelOn(Id);
};

try {
  await Page.goto(Address);
  await Page.evaluate(() => localStorage.clear());
  await Page.goto(Address + "?inspect=vehicle");
  await Page.locator(".inspector-scroll > [data-panel]").waitFor();

  // The vehicle's inspector opens the panel: outliner, view and Details; the ControlVehicle with its native components drawn.
  // Follow-up 63: no chassis collision (the object owns collision) and no movement component; the tree nests each wheel the way the
  // reference Component Viewer does: Body → Suspension → Steer (front) → Wheel → Rim.
  assert.equal(await Page.locator(".vcp").count(), 0);
  await Page.locator("[data-open-component-viewer]").click();
  await Page.waitForFunction(() => document.querySelector(".vcv-canvas")?.dataset.picks);
  await Page.waitForTimeout(1200);
  const Corners = ["fl", "fr", "rl", "rr"];
  const Parts = ["vehicle-body", ...Corners.flatMap((Corner) => [`vehicle-suspension-${Corner}`, ...(Corner[0] === "f" ? [`vehicle-steer-${Corner}`] : []), `vehicle-wheel-${Corner}`, `vehicle-rim-${Corner}`]), "vehicle-tow", "vehicle-headlights", "vehicle-brake"];
  assert.deepEqual((await Readings()).components.split(" ").sort(), [...Parts].sort());
  assert(!/collision|movement/.test((await Readings()).components));
  assert.equal(await Page.locator(".vcp-row").count(), 19);
  assert.equal(await Page.locator(".vcp-outliner-heading h1").innerText(), "Components");
  assert.equal(await Page.locator("[data-vcp-count]").innerText(), "19");
  assert.match(await Page.locator(".vcp-row.root").innerText(), /Origin\s*ROOT/);
  assert.equal(await Details(), "Controlled Vehicle");
  assert.equal(await MainHeading(), "Controlled Vehicle");
  // The tree: each row's depth, in order.
  const Tree = await Page.locator(".vcp-row").evaluateAll((Rows) => Rows.map((Row) => Row.dataset.vcvRow + ":" + Row.dataset.depth));
  assert.deepEqual(Tree, [
    "vehicle:0", "vehicle-body:1",
    "vehicle-suspension-fl:2", "vehicle-steer-fl:3", "vehicle-wheel-fl:4", "vehicle-rim-fl:5",
    "vehicle-suspension-fr:2", "vehicle-steer-fr:3", "vehicle-wheel-fr:4", "vehicle-rim-fr:5",
    "vehicle-suspension-rl:2", "vehicle-wheel-rl:3", "vehicle-rim-rl:4",
    "vehicle-suspension-rr:2", "vehicle-wheel-rr:3", "vehicle-rim-rr:4",
    "vehicle-tow:2", "vehicle-headlights:2", "vehicle-brake:2",
  ]);
  assert.equal(await Page.locator(".vcp-row[data-vcv-row='vehicle-wheel-fl']").getAttribute("aria-level"), "5");
  // Each component shows its own icon (sockets by type, the tyre and rim their own).
  const Icons = await Page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".vcp-row")].map((Row) => [Row.dataset.vcvRow, Object.entries(window.NativeAssets.Icons).find(([, Source]) => Source === Row.querySelector("img")?.getAttribute("src"))?.[0]])));
  const Expected = { vehicle: "vehicle-component-origin", "vehicle-body": "vehicle-component-body", "vehicle-tow": "vehicle-component-dock", "vehicle-headlights": "vehicle-component-spot-light", "vehicle-brake": "vehicle-component-point-light" };
  for (const Corner of Corners) {
    Expected[`vehicle-suspension-${Corner}`] = "vehicle-component-spring";
    if (Corner[0] === "f") Expected[`vehicle-steer-${Corner}`] = "vehicle-component-hinge";
    Expected[`vehicle-wheel-${Corner}`] = "vehicle-component-tyre";
    Expected[`vehicle-rim-${Corner}`] = "vehicle-component-rim";
  }
  assert.deepEqual(Icons, Expected);
  await Page.screenshot({ path: path.join(Proof, "Panel.png") });
  Checks.push("The vehicle inspector opens the Component Viewer panel: Components tree Origin → Body → Suspension → Steer → Wheel → Rim for each corner, 19 rows with their icons, no collision or movement component");

  // Every mesh shows its centre of mass, and the whole vehicle's (1,336 kg) is marked with a plumb line.
  const Massed = (await Readings()).massMarks.split(" ").sort();
  assert.deepEqual(Massed, Parts.filter((Id) => /body|wheel|rim/.test(Id)).sort());
  assert.match((await Readings()).wholeMass, /^1336 /);
  await Page.waitForFunction(() => /1,336 kg · centre of mass/.test(document.querySelector(".vcv-tag span")?.textContent || ""));
  await Page.locator("[data-vcp-centres]").click();
  await Page.waitForFunction(() => document.querySelector(".vcv-canvas").dataset.massMarks === "");
  await Page.locator("[data-vcp-centres]").click();
  await Page.waitForFunction(() => document.querySelector(".vcv-canvas").dataset.massMarks !== "");
  Checks.push(`Centre of mass: marks on all ${Massed.length} meshes and the whole vehicle (${(await Readings()).wholeMass}); the tool hides and shows them`);

  // A click on each component in the view opens its native inspector in the panel's Details; the editor stays on the vehicle. (The
  // near side's wheels: the far side's are behind the body from this view.)
  for (const [Id, Name, Class] of [
    ["vehicle-headlights", "Headlights", "SpotLight"],
    ["vehicle-wheel-fr", "WheelFR", "StaticMesh"],
    ["vehicle-rim-fr", "WheelFRRim", "StaticMesh"],
    ["vehicle-steer-fr", "SteerFR", "Socket"],
    ["vehicle-suspension-rr", "SuspensionRR", "Socket"],
    ["vehicle-tow", "Tow Hitch", "Socket"],
    ["vehicle-brake", "Brake Lights", "PointLight"],
  ]) {
    await ClickComponent(Id);
    await Page.locator(`.vcp-details .vehicle-inspector[data-component='${Class}']`).waitFor();
    assert.equal(await Details(), Name);
    assert.equal(await Page.locator(`.vcp-row[data-vcv-row='${Id}']`).getAttribute("aria-selected"), "true");
    assert.equal(await MainHeading(), "Controlled Vehicle");
  }
  // A wheel's Details: its mass and centre of mass.
  await ClickComponent("vehicle-wheel-fr");
  await Page.locator(".vcp-details [data-card='Mass and centre of mass']").waitFor();
  assert.match(await Page.locator(".vcp-details [data-card='Mass and centre of mass']").innerText(), /20 kg/);
  await Page.screenshot({ path: path.join(Proof, "Wheel.png") });
  Checks.push("Clicking each component in the view (tyre, rim, steering, suspension, tow, lights) opens its inspector in the panel's Details, a mesh's with its mass and centre of mass; the editor's inspector stays on the vehicle");

  // The outliner selects too.
  await Page.locator(".vcp-row[data-vcv-row='vehicle-body']").click();
  await Page.locator(".vcp-details .vehicle-inspector[data-component='StaticMesh']").waitFor();
  await PanelOn("vehicle-body");
  Checks.push("The panel's outliner selects the Body and opens the Static Mesh inspector in Details");

  // Editing in Details changes the view: the tow hitch releases (dock).
  await ClickComponent("vehicle-tow");
  assert.match(await Tag(), /connected/);
  await Page.locator(".vcp-details .vc-socket-scene").click();
  assert.equal((await Saved("vehicle-tow")).connected, false);
  await Page.waitForFunction(() => /released|seeking/i.test(document.querySelector(".vcv-tag span")?.textContent || ""));
  await Page.screenshot({ path: path.join(Proof, "TowReleased.png") });
  Checks.push("Edits in the panel's Details reach the view: releasing the tow dock");

  // The caret folds a branch: folding the front-left suspension hides its steering, wheel and rim.
  await Page.locator(".vcp-row[data-vcv-row='vehicle-suspension-fl'] [data-vcp-caret]").click();
  assert.equal(await Page.locator(".vcp-row[data-vcv-row='vehicle-rim-fl']").count(), 0);
  assert.equal(await Page.locator(".vcp-row[data-vcv-row='vehicle-suspension-fl']").getAttribute("aria-expanded"), "false");
  await Page.locator(".vcp-row[data-vcv-row='vehicle-suspension-fl'] [data-vcp-caret]").click();
  assert.equal(await Page.locator(".vcp-row[data-vcv-row='vehicle-rim-fl']").count(), 1);
  Checks.push("The tree folds and unfolds a corner");

  // The eye hides a component in the view.
  await Page.locator(".vcp-row[data-vcv-row='vehicle-headlights'] .vcp-eye").click();
  assert(!(await Readings()).components.includes("vehicle-headlights"));
  await Page.locator(".vcp-row[data-vcv-row='vehicle-headlights'] .vcp-eye").click();
  assert((await Readings()).components.includes("vehicle-headlights"));
  Checks.push("The eye hides and shows a component");

  // Add puts a native component on the vehicle (drawn, listed, opened); Delete removes it.
  await Page.locator(".vcp-add").click();
  await Page.locator(".vcp-menu-item", { hasText: "Point Light" }).click();
  await PanelOn("vehicle-point-light-1");
  assert.equal(await Details(), "Point Light 1");
  assert((await Readings()).components.includes("vehicle-point-light-1"));
  assert.equal(await Page.locator("[data-vcp-count]").innerText(), "20");
  await Page.screenshot({ path: path.join(Proof, "Added.png") });
  await Canvas().focus();
  await Page.keyboard.press("Delete");
  await PanelOn("vehicle");
  assert.equal(await Page.locator(".vcp-row[data-vcv-row='vehicle-point-light-1']").count(), 0);
  Checks.push("Add → Point Light adds a drawn, listed component and opens it; Delete removes it");

  // Simulate rolls the wheels and works the springs.
  const Still = await Readings();
  await Page.locator(".vcp-simulate").click();
  await Page.waitForTimeout(2500);
  const Moving = await Readings();
  assert.notEqual(Moving.spin, Still.spin);
  await Page.screenshot({ path: path.join(Proof, "Simulate.png") });
  await Page.locator(".vcp-simulate").click();
  Checks.push(`Simulate rolls the wheels (spin ${Still.spin} → ${Moving.spin}) and runs the sockets`);

  // Esc closes the panel.
  await Canvas().focus();
  await Page.keyboard.press("Escape");
  await Page.locator(".vcp").waitFor({ state: "detached" });
  Checks.push("Esc closes the panel");

  // Follow-up 65: choosing a component elsewhere (here ?inspect=) selects the vehicle without opening the panel; the inspector's
  // Open Component Viewer button then opens it on that component.
  await Page.goto(Address + "?inspect=vehicle-wheel-rl");
  await Page.locator('[data-outliner-row="vehicle"][aria-selected="true"]').waitFor();
  await Page.waitForTimeout(400);
  assert.equal(await Page.locator(".vcp").count(), 0, "a component link does not open the Component Viewer");
  assert.equal(await MainHeading(), "Controlled Vehicle");
  await Page.locator("[data-open-component-viewer]").first().click();
  await Page.locator(".vcp").waitFor();
  await PanelOn("vehicle-wheel-rl");
  assert.equal(await Details(), "WheelRL");
  Checks.push("Choosing a component outside the panel selects the vehicle only; the button opens the panel on that component");

  // Follow-up 65: the scene outliner lists the vehicle but none of its components (they live in the Component Viewer).
  assert.equal(await Page.locator('[data-outliner-row^="vehicle-"]').count(), 0, "no vehicle component rows in the scene outliner");
  // The debug menu's Centre of mass and Socket switches drive the panel's marks (the toolbar buttons flip the same switches).
  const Drawn = () => Page.locator(".vcp canvas[data-components]").getAttribute("data-components");
  assert.match(await Drawn(), /vehicle-suspension-fl/);
  await Page.locator("[data-vcp-sockets]").click();
  await Page.waitForFunction(() => !/vehicle-suspension-fl/.test(document.querySelector(".vcp canvas[data-components]")?.dataset.components || ""));
  assert.equal(await Page.locator("[data-vcp-sockets]").getAttribute("aria-pressed"), "false");
  await Page.locator("[data-vcp-sockets]").click();
  await Page.waitForFunction(() => /vehicle-suspension-fl/.test(document.querySelector(".vcp canvas[data-components]")?.dataset.components || ""));
  const Stored = async () => (await Page.evaluate(() => JSON.parse(localStorage.getItem("Frontier.ProjectZeroHtml.v1")).Settings)) || {};
  await Page.locator("[data-vcp-centres]").click();
  await Page.waitForFunction(() => JSON.parse(localStorage.getItem("Frontier.ProjectZeroHtml.v1")).Settings["Centre of mass debug"] === false);
  assert.equal((await Stored())["Socket debug"], true);
  await Page.locator("[data-vcp-centres]").click();
  Checks.push("Scene outliner shows no vehicle components; Centre of mass and Socket debugs switch from the debug settings (and the panel toolbar)");
} catch (Error) {
  Errors.push(Error.stack);
} finally {
  fs.writeFileSync(path.join(Proof, "Checks.json"), JSON.stringify({ Checks, Errors, FontFailures }, null, 2));
  await Browser.close();
}
assert.deepEqual(Errors, []);
console.log("Vehicle component viewer checks passed:", Checks.length);
