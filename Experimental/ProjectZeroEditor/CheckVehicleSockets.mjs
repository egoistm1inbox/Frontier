import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const Folder = path.dirname(fileURLToPath(import.meta.url));
const Require = createRequire(
  process.env.FRONTIER_BROWSER_PACKAGE ||
    path.resolve(Folder, "../../../_AgentScratch/Browser/package.json"),
);
const { chromium } = Require("playwright");
const Proof =
  process.env.FRONTIER_PROOF_FOLDER || path.join(Folder, "Screenshots/VehicleSockets");
fs.mkdirSync(Proof, { recursive: true });
const Browser = await chromium.launch({
  executablePath: process.env.FRONTIER_BROWSER_EXECUTABLE || "/tmp/chromium",
  args: ["--no-sandbox", "--disable-gpu"],
});
const Page = await Browser.newPage({ viewport: { width: 1365, height: 900 } });
Page.setDefaultTimeout(12000);
const Address =
  process.env.FRONTIER_EDITOR_URL || "http://127.0.0.1:4173/ProjectZeroEditor/";
const Checks = [],
  Errors = [],
  FontFailures = [];
Page.on("pageerror", (Error) => Errors.push(Error.stack));
Page.on("requestfailed", (Request) => {
  if (Request.url().includes("fontshare.com")) FontFailures.push(Request.url());
});
const Open = async (Id) => {
  await Page.goto(Address + "?inspect=" + Id);
  await Page.locator(".inspector-scroll > [data-panel]").waitFor();
  await Page.waitForTimeout(250);
};
const Saved = () =>
  Page.evaluate(() =>
    JSON.parse(localStorage.getItem("Frontier.ProjectZeroHtml.v1")),
  );

const Values = async (Id) => ((await Saved())?.Values || {})[Id] || {};
const Scene = () => Page.locator(".vc-socket-scene");
const TracePath = () => Scene().locator(".vc-trace path").last().getAttribute("d");

try {
  // Each socket row: live study first, then type, range and mount cards.
  for (const [Id, Kind, Range] of [
    ["vehicle-suspension", "Spring", "Spring & damper"],
    ["vehicle-steering", "Hinge", "Range of motion"],
    ["vehicle-tow", "Dock", "Coupling"],
  ]) {
    await Open(Id);
    const Titles = await Page.locator(".vehicle-inspector [data-card]").evaluateAll((Cards) => Cards.map((Card) => Card.dataset.card));
    assert.deepEqual(Titles, [Kind + " socket", "Socket type", Range, "Mount"]);
    assert.equal(await Page.locator('.vc-socket-kinds [role="radio"][aria-checked="true"]').innerText(), Kind);
    assert.equal(await Page.locator(".vc-socket-kinds svg").count(), 8);
    const Study = await Scene().boundingBox(), Metric = await Page.locator(".vc-socket-study .metric").boundingBox();
    assert(Study.y < Metric.y);
    Checks.push(`${Id}: study → Socket type → ${Range} → Mount; drawn kind glyphs`);
  }

  // The test drive runs the Component Viewer's stepSocket: the spring trace moves and the phase label follows the drive.
  await Open("vehicle-suspension");
  await Page.getByRole("button", { name: "Run test drive" }).click();
  await Page.waitForTimeout(1500);
  const Before = await TracePath();
  await Page.waitForTimeout(900);
  assert.notEqual(await TracePath(), Before);
  assert.match(await Scene().textContent(), /(Accelerating|Cruising|Braking|Standing) · \d+ km\/h/);
  await Page.screenshot({ path: path.join(Proof, "SpringStudy.png") });
  await Page.getByRole("button", { name: "Stop" }).click();
  assert.match(await Scene().textContent(), /parked/);
  Checks.push("Test drive animates the spring and its 6 s trace; Stop parks it");

  // Dragging the plate sets the preload (pose); the summary names the mount.
  await Scene().scrollIntoViewIfNeeded();
  const Box = await Scene().boundingBox();
  await Page.mouse.move(Box.x + Box.width / 2, Box.y + Box.height * 0.3);
  await Page.mouse.down();
  await Page.mouse.move(Box.x + Box.width / 2, Box.y + Box.height * 0.12, { steps: 4 });
  await Page.mouse.up();
  await Page.waitForTimeout(300);
  assert((await Values("vehicle-suspension")).pose > 0.5);
  assert(await Page.getByText("Spring socket · front axle").count());
  Checks.push("Dragging the spring plate writes the preload pose; outliner summary names the front axle");

  // Mount: dragging the marker moves the socket along the car and changes the spring's note.
  const Mount = Page.locator('[data-card="Mount"] svg').first();
  await Mount.scrollIntoViewIfNeeded();
  const Area = await Mount.boundingBox();
  await Page.mouse.click(Area.x + Area.width * 0.2, Area.y + Area.height * 0.5);
  await Page.waitForTimeout(300);
  assert((await Values("vehicle-suspension")).mount < -1);
  assert(await Page.getByText(/Rear of the car: it squats under acceleration/).count());
  Checks.push("Mount marker drags along the car; a rear spring explains squat");

  // Switching type keeps the numbers and swaps the study, range card and figures.
  await Page.locator(".vc-socket-kinds button", { hasText: "Tether" }).click();
  assert.equal((await Values("vehicle-suspension")).kind, "tether");
  await Page.locator('[data-card="Pendulum"]').waitFor();
  assert(await Page.getByText("Swing period").count());
  await Page.locator(".vc-socket-kinds button", { hasText: "Spring" }).click();
  assert((await Values("vehicle-suspension")).pose > 0.5);
  Checks.push("Switching to Tether shows the Pendulum card; switching back keeps the spring numbers");

  // Dock: a click on the study releases the coupling, and the pull test raises a release event.
  await Open("vehicle-tow");
  await Scene().click();
  assert.equal((await Values("vehicle-tow")).connected, false);
  await Page.waitForTimeout(200);
  await Scene().click();
  await Page.waitForTimeout(200);
  assert.equal((await Values("vehicle-tow")).connected, true);
  await Page.locator('[data-card="Coupling"] select').selectOption({ index: 1 });
  await Page.getByRole("button", { name: "Restart" }).click();
  await Page.waitForTimeout(100);
  const Early = await Page.locator(".vc-event").allTextContents();
  assert.deepEqual(Early, [], JSON.stringify(Early));
  await Page.getByRole("button", { name: "Run test drive" }).click();
  // Pull test ramps the load at 40 % of the break force per second, so it lets go at about 1.5 kN after ~2.5 s.
  await Page.locator(".vc-event", { hasText: /Released at 1\.[5-9]\d kN/ }).waitFor({ timeout: 8000 });
  await Page.screenshot({ path: path.join(Proof, "DockPullTest.png") });
  Checks.push("Dock toggles on click; the pull test breaks the coupling and reports the release load");
} catch (Error) {
  Errors.push(Error.stack);
} finally {
  fs.writeFileSync(path.join(Proof, "Checks.json"), JSON.stringify({ Checks, Errors, FontFailures }, null, 2));
  await Browser.close();
}
assert.deepEqual(Errors, []);
console.log("Vehicle socket checks passed:", Checks.length);
