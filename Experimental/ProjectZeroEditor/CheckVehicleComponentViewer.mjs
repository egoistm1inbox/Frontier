// Follow-up 61: the Controlled Vehicle's Component Viewer (VehicleComponentViewer.jsx). The rail opens it; a click on a component in the
// view (or in its list) opens that component's inspector; editing the inspector changes the view; Simulate drives; Esc or selecting
// something outside the vehicle leaves.
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
const Heading = () => Page.locator(".inspector-heading h1").innerText();
const Saved = async (Id) => ((await Page.evaluate(() => JSON.parse(localStorage.getItem("Frontier.ProjectZeroHtml.v1"))))?.Values || {})[Id] || {};
const Tag = () => Page.locator(".vcv-tag span").innerText();
// Clicks where a component's pick target lands on screen.
const ClickComponent = async (Id) => {
  const Point = await Page.evaluate((Id) => {
    const Surface = document.querySelector(".vcv-canvas"), Rect = Surface.getBoundingClientRect(), At = JSON.parse(Surface.dataset.picks)[Id];
    return At && [Rect.left + At[0] * Rect.width, Rect.top + At[1] * Rect.height];
  }, Id);
  assert(Point, "no pick target for " + Id);
  await Page.mouse.click(Point[0], Point[1]);
  await Page.waitForFunction((Id) => document.querySelector(".vcv-canvas")?.dataset.selectedComponent === Id, Id);
};

try {
  await Page.goto(Address);
  await Page.evaluate(() => localStorage.clear());
  await Page.goto(Address + "?inspect=vehicle");
  await Page.locator(".inspector-scroll > [data-panel]").waitFor();

  // The rail shows for the vehicle and opens the viewer: the ControlVehicle with every native component drawn.
  const Rail = Page.getByRole("button", { name: "Vehicle Component Viewer" });
  await Rail.click();
  await Page.waitForFunction(() => document.querySelector(".vcv-canvas")?.dataset.picks);
  await Page.waitForTimeout(1200);
  assert.equal(await Rail.getAttribute("aria-pressed"), "true");
  const Drawn = (await Readings()).components.split(" ").sort();
  assert.deepEqual(Drawn, ["vehicle-body", "vehicle-brake", "vehicle-collision", "vehicle-headlights", "vehicle-movement", "vehicle-steering", "vehicle-suspension", "vehicle-tow"]);
  assert.equal(await Page.locator(".vcv-row").count(), 9);
  await Page.screenshot({ path: path.join(Proof, "Viewer.png") });
  Checks.push("Rail opens the Component Viewer: the ControlVehicle with its 8 native components drawn and listed");

  // A click on each component in the view selects it and opens its native inspector.
  for (const [Id, Name, Class] of [
    ["vehicle-headlights", "Headlights", "SpotLight"],
    ["vehicle-steering", "Steering", "Socket"],
    ["vehicle-suspension", "Front Suspension", "Socket"],
    ["vehicle-tow", "Tow Hitch", "Socket"],
    ["vehicle-brake", "Brake Lights", "PointLight"],
    ["vehicle-movement", "Vehicle Movement", "VehicleMovement"],
  ]) {
    await ClickComponent(Id);
    await Page.locator(`.vehicle-inspector[data-component='${Class}']`).waitFor();
    assert.equal(await Heading(), Name);
    assert.equal(await Page.locator(`.vcv-row[data-vcv-row='${Id}']`).getAttribute("aria-selected"), "true");
  }
  await Page.screenshot({ path: path.join(Proof, "Movement.png") });
  Checks.push("Clicking each component in the view opens its inspector (lights, sockets, movement) and marks it in the list");

  // The list selects too; the body opens the Static Mesh inspector.
  await Page.locator(".vcv-row[data-vcv-row='vehicle-body']").click();
  await Page.locator(".vehicle-inspector[data-component='StaticMesh']").waitFor();
  assert.equal((await Readings()).selectedComponent, "vehicle-body");
  Checks.push("The list selects the Body and opens the Static Mesh inspector; the viewer stays open");

  // Editing the inspector changes the view: the tow hitch releases (dock), the collision turns overlap-only.
  await ClickComponent("vehicle-tow");
  assert.match(await Tag(), /connected/);
  await Page.locator(".vc-socket-scene").click();
  assert.equal((await Saved("vehicle-tow")).connected, false);
  await Page.waitForFunction(() => /released|seeking/i.test(document.querySelector(".vcv-tag span")?.textContent || ""));
  await Page.screenshot({ path: path.join(Proof, "TowReleased.png") });
  await Page.locator(".vcv-row[data-vcv-row='vehicle-collision']").click();
  await Page.locator(".vehicle-inspector[data-component='BoxCollision']").waitFor();
  assert.match(await Tag(), /blocks all/);
  await Page.getByRole("switch", { name: "Generate overlap events" }).click();
  await Page.waitForFunction(() => /overlap only/.test(document.querySelector(".vcv-tag span")?.textContent || ""));
  Checks.push("Inspector edits reach the view: releasing the tow dock, overlap-only collision");

  // The eye hides a component in the view only.
  await Page.locator(".vcv-row[data-vcv-row='vehicle-headlights'] .vcv-eye").click();
  assert(!(await Readings()).components.includes("vehicle-headlights"));
  await Page.locator(".vcv-row[data-vcv-row='vehicle-headlights'] .vcv-eye").click();
  assert((await Readings()).components.includes("vehicle-headlights"));
  Checks.push("The eye hides and shows a component");

  // Simulate rolls the wheels and works the springs.
  const Still = await Readings();
  await Page.getByRole("button", { name: /Simulate/ }).click();
  await Page.waitForTimeout(2500);
  const Moving = await Readings();
  assert.notEqual(Moving.spin, Still.spin);
  await Page.screenshot({ path: path.join(Proof, "Simulate.png") });
  await Page.getByRole("button", { name: /Stop/ }).click();
  Checks.push(`Simulate rolls the wheels (spin ${Still.spin} → ${Moving.spin}) and runs the sockets`);

  // Esc leaves; the rail reopens; selecting outside the vehicle closes it and hides the rail.
  await Canvas().focus();
  await Page.keyboard.press("Escape");
  await Page.locator(".vcv").waitFor({ state: "detached" });
  await Rail.click();
  await Page.locator(".vcv").waitFor();
  await Page.goto(Address + "?inspect=sun");
  await Page.locator(".inspector-scroll > [data-panel]").waitFor();
  assert.equal(await Page.locator(".vcv, .vcv-rail").count(), 0);
  Checks.push("Esc leaves the viewer; it is only offered while the vehicle or one of its components is selected");
} catch (Error) {
  Errors.push(Error.stack);
} finally {
  fs.writeFileSync(path.join(Proof, "Checks.json"), JSON.stringify({ Checks, Errors, FontFailures }, null, 2));
  await Browser.close();
}
assert.deepEqual(Errors, []);
console.log("Vehicle component viewer checks passed:", Checks.length);
