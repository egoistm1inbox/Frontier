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
  process.env.FRONTIER_PROOF_FOLDER ||
  path.join(Folder, "Screenshots/EntityContext");
fs.mkdirSync(Proof, { recursive: true });
const Browser = await chromium.launch({
  executablePath: process.env.FRONTIER_BROWSER_EXECUTABLE || "/tmp/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
const Page = await Browser.newPage({ viewport: { width: 1365, height: 768 } });
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
const Row = (Name) =>
  Page.locator(".outliner-row")
    .filter({
      has: Page.locator(".row-name", { hasText: Name }),
    })
    .first();
const Metadata = (Name) => Row(Name).locator(".row-identity small").innerText();

try {
  await Page.goto(Address + "?inspect=precipitation");
  await Page.evaluate(() => localStorage.clear());
  await Page.goto(Address);
  await Page.locator(".outliner-row").first().waitFor();
  await Page.waitForTimeout(500);
  // Follow-up 65: a fresh outliner is folded: the five top folders, with only the World folder's items showing; no vehicle
  // components (they live in the Component Viewer).
  assert.deepEqual(
    await Page.locator(".outliner-row").evaluateAll((Rows) => Rows.map((Row) => Row.dataset.outlinerRow)),
    ["showcase", "cameras", "world", "atmosphere", "sun", "moon", "stars", "wind", "height-fog", "aerial-fog", "local-fog", "clouds", "local-cloud", "lighting", "vehicles"],
  );
  Checks.push("A fresh outliner starts folded with only the World folder's items showing");
  // Unfold everything for the counts below (the folding the user leaves is kept from then on).
  await Page.evaluate(() => localStorage.setItem("Frontier.ProjectZeroHtml.v1", JSON.stringify({ Collapsed: {}, OutlinerRevision: 1 })));
  await Page.goto(Address + "?inspect=precipitation");
  await Page.locator(".outliner-row").first().waitFor();
  await Page.waitForTimeout(500);

  const Labels = await Page.locator(".row-identity small").allTextContents();
  // 71: Follow-up 48 adds the God Rays row (Project Zero specification §7). 56: Follow-up 46 moves the 15 Mass / Rigid Body / Collision
  // rows of the five primitives into each object's Components stack. 59: Follow-up 60 adds the Vehicles folder and two parked vehicles.
  // 69: Follow-up 63's component tree (18 vehicle components, was 8: no collision or movement, a suspension, wheel and rim per corner,
  // steering per front corner). 51: Follow-up 65 lists those 18 in the Component Viewer only.
  assert.equal(Labels.length, 51);
  assert(Labels.every((Label) => Label.trim().length));
  Checks.push(
    "All 51 default outliner entities expose a non-empty contextual value line",
  );

  assert.equal(await Metadata("Area Light"), "32 lx · Area · 0,0,0");
  assert.equal(await Metadata("Precipitation"), "Rain · 12 mm/h");
  assert.equal(await Metadata("Key Spot"), "90 cd · Spot · -6,8.5,5");
  assert.equal(await Metadata("Fill Point"), "10 cd · Point · -3.5,1.6,4.6");
  assert.equal(await Metadata("Environment Light"), "Sky atmosphere · 12k lx");
  assert.equal(await Metadata("LED Strip"), "2,400 lm · Strip · -1.8,2.8,-3.2");
  assert.equal(await Metadata("Moons"), "Lunar phase 223° · 62%");
  assert.equal(await Metadata("Wind"), "7 m/s · 250°");
  assert.equal(await Metadata("Cube"), "Position 0,0,0 m");
  Checks.push(
    "Light, precipitation, lunar, wind and geometry metadata use type-appropriate units and values",
  );

  await Row("Precipitation").click();
  await Page.getByRole("button", { name: "Snow", exact: true }).click();
  await Page.waitForFunction(() =>
    [...document.querySelectorAll(".outliner-row")].some(
      (Entry) =>
        Entry.querySelector(".row-name")?.textContent === "Precipitation" &&
        Entry.querySelector(".row-identity small")?.textContent.includes(
          "Snow",
        ),
    ),
  );
  assert.equal(await Metadata("Precipitation"), "Snow · 12 mm/h");
  Checks.push(
    "Precipitation type changes update the outliner context immediately",
  );

  for (const Entry of await Page.locator(".outliner-row").all()) {
    await Entry.scrollIntoViewIfNeeded();
    await Entry.click();
    // Follow-up 62: a Controlled Vehicle component opens in its Component Viewer panel, whose Details carry the notes action.
    if (await Page.locator(".vcp").count()) {
      assert.equal(await Page.locator(".vcp-details .entity-notes-add").count(), 1);
      await Page.keyboard.press("Escape");
      await Page.locator(".vcp").waitFor({ state: "detached" });
      continue;
    }
    // Follow-up 65: paged inspectors carry a Notes card on their first page instead of the header's Add notes action.
    assert.equal(
      await Page.locator(".inspector-scroll .entity-notes-add, .inspector-scroll .notes-card").count(),
      1,
      "one notes place for " + (await Entry.getAttribute("data-outliner-row")),
    );
  }
  Checks.push(
    "Every default row and collection exposes exactly one notes place (Add notes, or the first page's Notes card)",
  );

  await Row("Precipitation").click();
  assert.equal(await Page.getByRole("button", { name: "Add notes", exact: true }).count(), 0);
  const Notes = Page.getByRole("textbox", { name: "Instance notes" });
  await Notes.fill("Weather pass review");
  await Page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("Frontier.ProjectZeroHtml.v1"))?.Values
        ?.precipitation?.Notes === "Weather pass review",
  );
  await Page.reload();
  await Page.getByRole("textbox", { name: "Instance notes" }).waitFor();
  assert.equal(
    await Page.getByRole("textbox", { name: "Instance notes" }).inputValue(),
    "Weather pass review",
  );
  Checks.push(
    "Row notes (the Notes card) persist across reload",
  );

  await Page.screenshot({ path: path.join(Proof, "NotesAndMetadata.png") });
  // A folder keeps the optional header notes: Add notes opens them, Hide folds them away again.
  await Row("World").click();
  await Page.getByRole("button", { name: "Add notes", exact: true }).click();
  await Page.getByRole("button", { name: "Hide", exact: true }).click();
  assert.equal(
    await Page.getByRole("button", { name: "Add notes" }).count(),
    1,
  );
  assert.equal(
    await Page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("Frontier.ProjectZeroHtml.v1")).Values
          .precipitation.Notes,
    ),
    "Weather pass review",
  );
  Checks.push("Hiding the optional editor preserves its authored note");

  await Page.locator(".inspector-scroll").evaluate(
    (Node) => (Node.scrollTop = 0),
  );
  await Page.screenshot({ path: path.join(Proof, "OutlinerMetadata.png") });
} catch (Error) {
  Errors.push(Error.stack);
} finally {
  fs.writeFileSync(
    path.join(Proof, "Checks.json"),
    JSON.stringify({ Checks, Errors, FontFailures }, null, 2),
  );
  await Browser.close();
}
assert.deepEqual(Errors, []);
console.log("Entity context checks passed:", Checks.length);
