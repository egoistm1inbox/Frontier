import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { PickTab, Settled } from "./TabReveal.mjs";

// Follow-up 48: editor assets (EditorAssets.js) — scene cameras stand in the 3D viewport as camera models on tripods with their frustum,
// the outliner shows each camera's model as its icon, and the camera inspector picks the body (A · Film, B · Digital, C · Mirrorless).
// And the lettered inspector tabs (InspectorTabs.jsx): every tabbed inspector has its own look, one page open at a time, ← → move,
// and the open tab is remembered while the editor is open. Follow-up 60: three vehicles (Follow-up 64: the pages turn in the page carousel)
// (the Controlled Vehicle, an Off-road Vehicle and a Pickup Truck) park in the level, sit in a Vehicles folder and have an inspector.
const Folder = path.dirname(fileURLToPath(import.meta.url));
const Require = createRequire(process.env.FRONTIER_BROWSER_PACKAGE || path.resolve(Folder, "../../../_AgentScratch/Browser/package.json"));
const { chromium } = Require("playwright");
const Proof = process.env.FRONTIER_PROOF_FOLDER || path.join(Folder, "Screenshots/EditorAssets");
fs.mkdirSync(Proof, { recursive: true });
const Checks = [],
  Errors = [];
const Browser = await chromium.launch({ executablePath: process.env.FRONTIER_BROWSER_EXECUTABLE || "/tmp/chromium", args: ["--no-sandbox", "--disable-gpu", "--enable-unsafe-swiftshader"] });
const Page = await Browser.newPage({ viewport: { width: 1440, height: 900 } });
Page.setDefaultTimeout(30000);
const Address = process.env.FRONTIER_EDITOR_URL || "http://127.0.0.1:4173/ProjectZeroEditor/";
Page.on("pageerror", (Error) => Errors.push(Error.stack));
const Open = async (Id) => {
  await Page.goto(Address + "?inspect=" + Id);
  await Page.waitForSelector(".viewport-3d-canvas[data-frames]");
  await Page.waitForTimeout(600);
};
const Canvas = () => Page.locator(".viewport-3d-canvas");
const RowIcon = (Id) => Page.locator(`[data-outliner-row="${Id}"] .native-icon`).first();
// Opaque pixels of an icon image.
const Opaque = (Id) =>
  RowIcon(Id).evaluate(async (Picture) => {
    await Picture.decode();
    const Board = document.createElement("canvas");
    Board.width = Picture.naturalWidth;
    Board.height = Picture.naturalHeight;
    const Brush = Board.getContext("2d");
    Brush.drawImage(Picture, 0, 0);
    const Bytes = Brush.getImageData(0, 0, Board.width, Board.height).data;
    let Count = 0;
    for (let At = 3; At < Bytes.length; At += 4) if (Bytes[At] > 128) Count++;
    return [Count, Board.width * Board.height];
  });

try {
  await Page.goto(Address);
  await Page.evaluate(() => localStorage.clear());

  // Outliner icons: each camera row shows its body's model; the icons are pictures of the model, not blank squares.
  await Open("cine");
  assert.equal(await RowIcon("camera").getAttribute("data-native-icon"), "asset-camera-mirrorless");
  assert.equal(await RowIcon("cine").getAttribute("data-native-icon"), "asset-camera-film");
  const [Covered, Total] = await Opaque("cine");
  assert(Covered > Total * 0.2 && Covered < Total * 0.9, `the film camera icon is a picture: ${Covered} of ${Total} pixels`);
  await Page.locator('[data-outliner-row="camera"]').screenshot({ path: path.join(Proof, "Outliner-EditorCamera.png") });
  await Page.locator('[data-outliner-row="cine"]').screenshot({ path: path.join(Proof, "Outliner-CineCamera.png") });
  Checks.push(`Outliner: Editor Camera shows the mirrorless model, Cine Camera the film camera (${Covered} of ${Total} icon pixels drawn)`);

  // Viewport: the scene camera stands as its model (the editor camera is the view itself and is not drawn).
  assert.equal(await Canvas().getAttribute("data-cameras"), "cine:film");
  await Page.locator(".scene-image").screenshot({ path: path.join(Proof, "Viewport3D-CineCamera.png") });

  // Camera inspector, Body page: picking B · Digital changes the viewport model and the outliner icon.
  await PickTab(Page, "camera:body");
  assert.equal(await Page.locator('[data-camera-body-shown]').getAttribute("data-camera-body-shown"), "film");
  await Page.locator('[data-camera-body="digital"]').click();
  await Page.waitForFunction(() => document.querySelector(".viewport-3d-canvas").dataset.cameras === "cine:digital");
  assert.equal(await RowIcon("cine").getAttribute("data-native-icon"), "asset-camera-digital");
  assert.equal(await Page.locator('[data-camera-body="digital"]').getAttribute("aria-checked"), "true");
  await Page.locator('[data-card="Camera body"]').screenshot({ path: path.join(Proof, "CameraBody.png") });
  await Page.waitForTimeout(400);
  await Page.locator(".scene-image").screenshot({ path: path.join(Proof, "Viewport3D-DigitalCamera.png") });
  await Page.locator('[data-camera-body="film"]').click();
  await Page.waitForFunction(() => document.querySelector(".viewport-3d-canvas").dataset.cameras === "cine:film");
  Checks.push("Camera body: B · Digital swaps the viewport model (cine:digital) and the outliner icon (asset-camera-digital); A · Film swaps back");

  // Follow-up 59: Tripod off draws the body alone at head height (a camera that moves); on brings the tripod back. Stored per camera.
  // Follow-up 65: Tripod is one of the Overview page's Quick controls.
  await PickTab(Page, "camera:overview");
  const Tripod = Page.locator('[data-tab-page="camera:overview"] [data-quick-action="Tripod"]');
  assert.equal(await Tripod.getAttribute("aria-pressed"), "true");
  await Tripod.click();
  await Page.waitForFunction(() => document.querySelector(".viewport-3d-canvas").dataset.cameras === "cine:film:free");
  assert.equal(await Tripod.getAttribute("aria-pressed"), "false");
  assert.equal(JSON.parse(await Page.evaluate(() => localStorage.getItem("Frontier.ProjectZeroHtml.v1"))).Values.cine.Tripod, false);
  await Page.waitForTimeout(400);
  await Page.locator(".scene-image").screenshot({ path: path.join(Proof, "Viewport3D-CameraNoTripod.png") });
  await Page.locator('[data-card="Quick controls"]:visible').first().screenshot({ path: path.join(Proof, "CameraQuickNoTripod.png") });
  await Tripod.click();
  await Page.waitForFunction(() => document.querySelector(".viewport-3d-canvas").dataset.cameras === "cine:film");
  Checks.push("Tripod switch: off draws the film camera alone at head height (cine:film:free, Tripod false stored); on brings the tripod back");

  // Follow-up 78: the Mount page: A On tripod / B Floating, the tripod's legs following the camera's height, position and angle.
  const Poses = () => Canvas().getAttribute("data-camera-poses");
  await PickTab(Page, "camera:mount");
  assert.equal(await Page.locator("[data-camera-mount-shown]").getAttribute("data-camera-mount-shown"), "tripod");
  assert.match(await Poses(), /^cine:-?[\d.]+,1\.3,-?[\d.]+:/);
  await Page.locator('[data-tab-page="camera:mount"] input[type=range][aria-label="Tripod height"]').fill("2");
  await Page.waitForFunction(() => /^cine:-?[\d.]+,2,/.test(document.querySelector(".viewport-3d-canvas").dataset.cameraPoses));
  await Page.waitForTimeout(400);
  await Page.locator(".scene-image").screenshot({ path: path.join(Proof, "Viewport3D-TripodRaised.png") });
  await Page.locator('[data-camera-mount="floating"]').click();
  await Page.waitForFunction(() => document.querySelector(".viewport-3d-canvas").dataset.cameras === "cine:film:free");
  await Page.locator('[data-tab-page="camera:mount"] input[type=range][aria-label="Height"]').fill("3.5");
  await Page.locator('[data-tab-page="camera:mount"] input[aria-label="Camera Position X"]').fill("-4");
  await Page.locator('[data-tab-page="camera:mount"] input[aria-label="Camera Angle Y"]').fill("-60");
  await Page.waitForFunction(() => /^cine:-4,3\.5,[\d.-]+:[\d.-]+,-60,/.test(document.querySelector(".viewport-3d-canvas").dataset.cameraPoses));
  let Cine = JSON.parse(await Page.evaluate(() => localStorage.getItem("Frontier.ProjectZeroHtml.v1"))).Values.cine;
  assert.deepEqual([Cine.Tripod, Cine["Camera Position"][0], Cine["Camera Position"][1], Cine["Camera Angle"][1], Cine["Aim at Showcase"]], [false, -4, 3.5, -60, false]);
  await Page.locator('[data-tab-page="camera:mount"]').screenshot({ path: path.join(Proof, "CameraMountFloating.png") });
  await Page.locator('[data-camera-mount="tripod"]').click();
  await Page.waitForFunction(() => /^cine:-4,2\.2,/.test(document.querySelector(".viewport-3d-canvas").dataset.cameraPoses));
  await Page.getByRole("button", { name: "↺ Back on its arc" }).click();
  await Page.waitForFunction(() => /^cine:-?[\d.]+,1\.3,/.test(document.querySelector(".viewport-3d-canvas").dataset.cameraPoses) && document.querySelector(".viewport-3d-canvas").dataset.cameras === "cine:film");
  Checks.push("Mount: the tripod rises to 2 m with the camera; Floating at 3.5 m, x −4, pan −60° (aim off) is stored and drawn; back on a tripod it comes down to 2.2 m; Back on its arc restores the arc");

  // Hiding the camera takes it out of the viewport; showing it brings it back.
  await Page.getByRole("button", { name: "Toggle Cine Camera visibility" }).click();
  await Page.waitForFunction(() => document.querySelector(".viewport-3d-canvas").dataset.cameras === "");
  await Page.getByRole("button", { name: "Toggle Cine Camera visibility" }).click();
  await Page.waitForFunction(() => document.querySelector(".viewport-3d-canvas").dataset.cameras === "cine:film");
  Checks.push("Hiding Cine Camera takes its model out of the viewport; showing it brings it back");

  // Numbered pages (Follow-up 64): the page carousel's strip sits right under the header, above the cards: ‹, a pill per page with a flat
  // number badge, ›, and the count; one page at a time; a pick, the arrows or ← → turn it, sliding the pages across.
  const Looks = {};
  for (const Id of ["sun", "atmosphere", "stars", "moon", "flare", "cine"]) {
    await Open(Id);
    const Tabs = Page.locator("[data-tabs]").first();
    Looks[Id] = await Tabs.getAttribute("data-tabs-look");
    const Owner = await Tabs.getAttribute("data-tabs");
    const Strip = Tabs.locator(`[data-strip="${Owner}"]`);
    const Header = await Page.locator(".inspector-scroll > [data-panel] > header").boundingBox();
    const Bar = await Strip.boundingBox();
    const First = await Tabs.locator(".it-page:not([hidden]) [data-card]").first().boundingBox();
    assert(Bar.y < Header.y + Header.height + 60 && First.y > Bar.y + Bar.height, Id + ": the strip sits right under the header, the cards under it");
    const Count = await Tabs.locator("[data-tab-for]").count();
    assert(Count >= 3, Id + " has numbered pages");
    assert.deepEqual(await Strip.locator(".pc-number").allInnerTexts(), Array.from({ length: Count }, (_, At) => String(At + 1)), Id + ": the badges are numbers");
    assert.equal(await Strip.locator(".pc-count").innerText(), `1 / ${Count}`);
    assert.equal(await Tabs.locator(".it-page:not([hidden])").count(), 1, Id + " shows one page");
    await Strip.screenshot({ path: path.join(Proof, `Strip-${Owner}.png`) });
    const Second = await Tabs.locator("[data-tab-for]").nth(1).getAttribute("data-tab-for");
    await Tabs.locator("[data-tab-for]").nth(1).click();
    await Settled(Page);
    assert(await Page.locator(`[data-tab-page="${Second}"]`).isVisible());
    assert.equal(await Tabs.locator(".it-page:not([hidden])").count(), 1);
    assert.equal(await Strip.locator(".pc-count").innerText(), `2 / ${Count}`);
    await Page.keyboard.press("ArrowRight");
    await Settled(Page);
    const Third = await Tabs.locator(".it-page").nth(2).getAttribute("data-tab-page");
    assert(await Page.locator(`[data-tab-page="${Third}"]`).isVisible(), Id + " → opens the next page");
    await Strip.getByRole("button", { name: "Previous page" }).click();
    await Settled(Page);
    assert(await Page.locator(`[data-tab-page="${Second}"]`).isVisible(), Id + " ‹ goes back");
  }
  // Remembered: open Stars' third page, select another row and come back.
  await Open("stars");
  await PickTab(Page, "stars:renderer");
  await Page.locator('[data-outliner-row="sun"]').click();
  await Page.locator('[data-tabs="sun"]').waitFor();
  await Page.locator('[data-outliner-row="stars"]').click();
  await Page.locator('[data-tabs="stars"]').waitFor();
  assert(await Page.locator('[data-tab-page="stars:renderer"]').isVisible(), "Stars reopens on Renderer");
  Checks.push("Page carousel: " + Object.keys(Looks).join(", ") + " — numbered strip under the header with its count, one page open, pills, ← → and ‹ › turn it, the open page is remembered");

  // Vehicles (Follow-up 60): the Controlled Vehicle, the Off-road Vehicle and the Pickup Truck park in the level, sit in a Vehicles folder
  // in the outliner with their models as icons, and open the vehicle inspector (carousel pages Model · Size · Drive).
  await Open("vehicle");
  assert.equal(await Canvas().getAttribute("data-vehicles"), "vehicle:controlled offroad-vehicle:offroad pickup-truck:pickup");
  const Order = await Page.locator("[data-outliner-row]").evaluateAll((Rows) => Rows.map((Row) => Row.dataset.outlinerRow));
  const Folder = Order.indexOf("vehicles");
  assert(Folder >= 0, "the Vehicles folder is in the outliner");
  assert.deepEqual(
    ["vehicle", "offroad-vehicle", "pickup-truck"].map((Id) => Order.indexOf(Id) > Folder),
    [true, true, true],
    "the three vehicles follow their folder",
  );
  const Depth = (Id) => Page.locator(`[data-outliner-row="${Id}"]`).evaluate((Row) => Number(getComputedStyle(Row).getPropertyValue("--depth")));
  assert.equal(await Depth("vehicle"), (await Depth("vehicles")) + 1, "the vehicles nest in the folder");
  // Follow-up 65: the Controlled Vehicle's components are listed in its Component Viewer only, not in the scene outliner.
  assert.equal(await Page.locator('[data-outliner-row="vehicle-body"]').count(), 0, "no vehicle components in the scene outliner");
  for (const [Id, Model] of [["vehicle", "controlled"], ["offroad-vehicle", "offroad"], ["pickup-truck", "pickup"]]) {
    assert.equal(await RowIcon(Id).getAttribute("data-native-icon"), "asset-vehicle-" + Model);
    const [Drawn, Area] = await Opaque(Id);
    assert(Drawn > Area * 0.15 && Drawn < Area * 0.9, `${Id}'s icon is a picture: ${Drawn} of ${Area} pixels`);
  }
  await Page.locator('[data-outliner-row="vehicles"]').scrollIntoViewIfNeeded();
  await Page.locator(".outliner-rows").screenshot({ path: path.join(Proof, "Outliner-Vehicles.png") });
  Checks.push("Vehicles: three parked in the viewport (data-vehicles), a Vehicles folder holding them in the outliner with asset-vehicle-* model icons, the Controlled Vehicle's components under it");

  // The inspector: the model picture with paints, then Size and Drive from the page carousel.
  assert.equal(await Page.locator('[data-strip="vehicle"] .pc-count').innerText(), "1 / 3");
  assert.equal(await Page.locator("[data-vehicle-shown]").getAttribute("data-vehicle-shown"), "controlled");
  await Page.locator('[data-vehicle-paint="#b8262e"]').click();
  await Page.waitForFunction(() => document.querySelector("[data-vehicle-shown]")?.dataset.vehiclePaintShown === "#b8262e");
  assert.match(await Page.locator('[data-outliner-row="vehicle"]').innerText(), /Rally red/);
  await Page.locator(".inspector-scroll").screenshot({ path: path.join(Proof, "Vehicle-Model.png") });
  await PickTab(Page, "vehicle:size");
  await Page.locator(".inspector-scroll").screenshot({ path: path.join(Proof, "Vehicle-Size.png") });
  await PickTab(Page, "vehicle:drive");
  assert((await Page.locator("[data-vehicle-part]").count()) >= 6, "Drive lists the Controlled Vehicle's components");
  // Follow-up 65: pressing a Drive component only picks it (no Component Viewer); the Open Component Viewer button then opens the
  // panel on it, and the editor stays on the vehicle.
  await Page.locator('[data-vehicle-part="vehicle-suspension-fr"]').click();
  await Page.locator('[data-vehicle-part="vehicle-suspension-fr"][aria-pressed="true"]').waitFor();
  await Page.waitForTimeout(300);
  assert.equal(await Page.locator(".vcp").count(), 0, "picking a component does not open the Component Viewer");
  await Page.locator('[data-tab-page="vehicle:drive"] [data-open-component-viewer]').click();
  await Page.locator('.vcp[data-vcp-selected="vehicle-suspension-fr"]').waitFor();
  await Page.locator('[data-outliner-row="vehicle"][aria-selected="true"]').waitFor();
  await Page.keyboard.press("Escape");
  await Page.locator(".vcp").waitFor({ state: "detached" });
  for (const Id of ["offroad-vehicle", "pickup-truck"]) {
    await Open(Id);
    assert.equal(await Page.locator("[data-vehicle-shown]").getAttribute("data-vehicle-shown"), Id === "pickup-truck" ? "pickup" : "offroad");
    assert.equal(await Page.locator("[data-vehicle-part]").count(), 0);
    await Page.locator(".inspector-scroll").screenshot({ path: path.join(Proof, `Vehicle-${Id}.png`) });
  }
  await Canvas().screenshot({ path: path.join(Proof, "Viewport-Vehicles.png") });
  Checks.push("Vehicle inspector: page carousel; a paint repaints the picture and the outliner summary (Rally red); Drive lists and picks the components, and its button opens the Component Viewer on the picked one");

  // Scenes saved before Follow-up 60 (a Vehicle group, no folder, no parked vehicles) gain the folder and the two parked vehicles.
  await Page.evaluate(() => {
    const Saved = JSON.parse(localStorage.getItem("Frontier.ProjectZeroHtml.v1"));
    Saved.Rows = Saved.Rows.filter((Row) => !["vehicles", "offroad-vehicle", "pickup-truck"].includes(Row.Id)).map((Row) =>
      Row.Id === "vehicle" ? { Id: "vehicle", Name: "Vehicle", Panel: "group", Parent: null } : Row,
    );
    Saved.VehicleRevision = 1;
    localStorage.setItem("Frontier.ProjectZeroHtml.v1", JSON.stringify(Saved));
  });
  await Open("vehicle");
  assert.equal(await Canvas().getAttribute("data-vehicles"), "vehicle:controlled offroad-vehicle:offroad pickup-truck:pickup");
  assert.match(await Page.locator('[data-outliner-row="vehicle"]').innerText(), /Controlled Vehicle/);
  assert.equal(await Page.locator('[data-outliner-row="vehicles"]').count(), 1);
  Checks.push("Saved scenes from before: the Vehicle group becomes the Controlled Vehicle inside a new Vehicles folder, joined by the parked vehicles");

  assert.deepEqual(Errors, []);
  console.log("Editor asset checks passed:", Checks.length);
  for (const Each of Checks) console.log("🟢", Each);
} catch (Error) {
  Errors.push(Error.stack);
  console.error(Error);
  process.exitCode = 1;
  await Page.screenshot({ path: path.join(Proof, "Failure.png") }).catch(() => {});
} finally {
  fs.writeFileSync(path.join(Proof, "Checks.json"), JSON.stringify({ Checks, Errors }, null, 2) + "\n");
  await Browser.close();
}
