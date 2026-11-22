import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Follow-up 48: editor assets (EditorAssets.js) — scene cameras stand in the 3D viewport as camera models on tripods with their frustum,
// the outliner shows each camera's model as its icon, and the camera inspector picks the body (A · Film, B · Digital, C · Mirrorless).
// And the lettered inspector tabs (InspectorTabs.jsx): every tabbed inspector has its own look, one page open at a time, ← → move,
// and the open tab is remembered while the editor is open.
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
  await Page.locator('[data-tab-for="camera:body"]').click();
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

  // Hiding the camera takes it out of the viewport; showing it brings it back.
  await Page.getByRole("button", { name: "Toggle Cine Camera visibility" }).click();
  await Page.waitForFunction(() => document.querySelector(".viewport-3d-canvas").dataset.cameras === "");
  await Page.getByRole("button", { name: "Toggle Cine Camera visibility" }).click();
  await Page.waitForFunction(() => document.querySelector(".viewport-3d-canvas").dataset.cameras === "cine:film");
  Checks.push("Hiding Cine Camera takes its model out of the viewport; showing it brings it back");

  // Tabs: each inspector's own look; one page at a time; ← →; remembered while the editor stays open.
  const Looks = {};
  for (const Id of ["sun", "atmosphere", "stars", "moon", "flare", "cine"]) {
    await Open(Id);
    const Tabs = Page.locator("[data-tabs]").first();
    Looks[Id] = await Tabs.getAttribute("data-tabs-look");
    const Owner = await Tabs.getAttribute("data-tabs");
    const Letters = await Tabs.locator("[data-tab-for]").count();
    assert(Letters >= 3, Id + " has lettered tabs");
    assert.equal(await Tabs.locator(".it-page:not([hidden])").count(), 1, Id + " shows one page");
    const Second = await Tabs.locator("[data-tab-for]").nth(1).getAttribute("data-tab-for");
    await Tabs.locator("[data-tab-for]").nth(1).click();
    assert(await Page.locator(`[data-tab-page="${Second}"]`).isVisible());
    assert.equal(await Tabs.locator(".it-page:not([hidden])").count(), 1);
    await Page.keyboard.press("ArrowRight");
    const Third = await Tabs.locator("[data-tab-for]").nth(2).getAttribute("data-tab-for");
    assert(await Page.locator(`[data-tab-page="${Third}"]`).isVisible(), Id + " → opens the next tab");
    await Tabs.locator(".it-bar").screenshot({ path: path.join(Proof, `Tabs-${Owner}.png`) });
  }
  assert.equal(new Set(Object.values(Looks)).size, 6, "every tabbed inspector looks different: " + JSON.stringify(Looks));
  // Remembered: open Stars' third tab, select another row and come back.
  await Open("stars");
  await Page.locator('[data-tab-for="stars:renderer"]').click();
  await Page.locator('[data-outliner-row="sun"]').click();
  await Page.locator('[data-tabs="sun"]').waitFor();
  await Page.locator('[data-outliner-row="stars"]').click();
  await Page.locator('[data-tabs="stars"]').waitFor();
  assert(await Page.locator('[data-tab-page="stars:renderer"]').isVisible(), "Stars reopens on Renderer");
  Checks.push("Tabs: " + Object.entries(Looks).map(([Id, Look]) => `${Id} ${Look}`).join(", ") + " — one page open, ← → move, the open tab is remembered");

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
