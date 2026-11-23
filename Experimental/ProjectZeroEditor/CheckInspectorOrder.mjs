//============================================================================================================================================
//                                                           CHECKINSPECTORORDER.MJS
//============================================================================================================================================
// 📦 Cross-inspector section ordering, baking placement and live light-response regressions.

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { PickTab, ReferenceSheet } from "./TabReveal.mjs";
const Folder = path.dirname(fileURLToPath(import.meta.url));
const Require = createRequire(
  process.env.FRONTIER_BROWSER_PACKAGE ||
    path.resolve(Folder, "../../../_AgentScratch/Browser/package.json"),
);
const { chromium } = Require("playwright");
const Proof =
  process.env.FRONTIER_PROOF_FOLDER ||
  path.join(Folder, "Screenshots/InspectorOrder");
fs.mkdirSync(Proof, { recursive: true });
const Browser = await chromium.launch({
  executablePath: process.env.FRONTIER_BROWSER_EXECUTABLE || "/tmp/chromium",
  args: ["--no-sandbox", "--disable-gpu"],
});
const Page = await Browser.newPage({ viewport: { width: 1440, height: 1000 } });
Page.setDefaultTimeout(12000);
const Checks = [],
  Errors = [],
  FontFailures = [],
  Inventory = [];
Page.on("pageerror", (Error) => Errors.push(Error.stack));
Page.on("requestfailed", (Request) => {
  if (Request.url().includes("fontshare.com")) FontFailures.push(Request.url());
});
const Address =
  process.env.FRONTIER_EDITOR_URL || "http://127.0.0.1:4173/ProjectZeroEditor/";
const Card = (Title) => `[data-card="${Title}"]`;
const Frame = (Slice) =>
  Page.frameLocator(
    Slice
      ? `[data-reference-slice="${Slice}"] iframe`
      : 'iframe[title^="Reference inspector"]',
  ).first();
const Node = (Entry) =>
  typeof Entry === "string"
    ? Page.locator(Entry).first()
    : Frame(Entry[0]).locator(Entry[1]).first();
const Saved = () =>
  Page.evaluate(() =>
    JSON.parse(localStorage.getItem("Frontier.ProjectZeroHtml.v1")),
  );
async function Open(Id, Wide = false) {
  await Page.goto(
    Address + "?inspect=" + Id + (Wide ? "&workspace=inspector" : ""),
  );
  // A Controlled Vehicle component opens in its Component Viewer panel (Follow-up 62), whose Details come first in the page.
  // (The workspace Inspector behind it is hidden then, so wait for whichever is shown.)
  // (Heavy rows such as God Rays and the Controlled Vehicle can take longer than the default under the software renderer.)
  await Page.locator(".inspector-scroll > [data-panel]:visible").first().waitFor({ timeout: 40000 });
  // Follow-up 65: a component link selects the vehicle; its Component Viewer opens only from the inspector's button.
  const Shown = await Page.evaluate(() => document.querySelector(".outliner-row.selected")?.dataset.outlinerRow);
  if (Shown && Shown !== Id && (await Page.locator("[data-open-component-viewer]").count())) {
    // (The button is on the Model and Drive pages, so it is pressed wherever it is.)
    await Page.locator("[data-open-component-viewer]").first().evaluate((Button) => Button.click());
    await Page.locator(`.vcp[data-vcp-selected="${Id}"]`).waitFor({ timeout: 40000 });
    await Page.locator(".inspector-scroll > [data-panel]:visible").first().waitFor({ timeout: 40000 });
  }
  for (const Iframe of await Page.locator(
    ".reference-inspector-copy iframe",
  ).all())
    // (A sheet on a shut page is loaded but not shown, Follow-up 65.)
    await Iframe.contentFrame().locator(".mpanel > *").first().waitFor({ state: "attached" });
  await Page.waitForTimeout(150);
}
// Inspectors with lettered tabs (InspectorTabs.jsx): opens the tab holding an entry, returning its place among the tabs (or -1).
async function Reveal(Entry) {
  // An entry inside a reference sheet is found through the sheet's frame on the page (Follow-up 65: those sit on pages too).
  const Host =
    typeof Entry === "string"
      ? Node(Entry)
      : Page.locator(Entry[0] ? `[data-reference-slice="${Entry[0]}"] iframe` : 'iframe[title^="Reference inspector"]').first();
  const Tab = await Host.evaluate((Each) => Each.closest("[data-tab-page]")?.dataset.tabPage || null);
  if (!Tab) return -1;
  await PickTab(Page, Tab);
  return Page.locator(`[data-tab-page="${Tab}"]`).evaluate((Each) => [...Each.parentElement.querySelectorAll(":scope > [data-tab-page]")].indexOf(Each));
}
async function Sequence(Name, Entries) {
  let Bottom = -Infinity, Opened = -1;
  for (const Entry of Entries) {
    // Entries run through the tabs in order; each tab starts at its own top.
    const Tab = await Reveal(Entry);
    assert(Tab >= Opened, Name + " tab order " + JSON.stringify(Entry));
    if (Tab !== Opened) Bottom = -Infinity;
    Opened = Tab;
    const Rect = await Node(Entry).boundingBox();
    assert(Rect && Rect.height > 0, Name + " missing " + JSON.stringify(Entry));
    assert(
      Rect.y >= Bottom - 2,
      Name + " order/overlap " + JSON.stringify({ Entry, Rect, Bottom }),
    );
    Bottom = Rect.y + Rect.height;
  }
}
const TagsAndNotes = [Card("Quick controls"), Card("Tags"), Card("Notes")];
const Sections = {
  group: [
    ".collection-total",
    ".collection-status",
    ".collection-composition",
    ".collection-browser",
    ".collection-notes",
  ],
  // Showcase primitives: the cards come first (Follow-up 59: the category navigation no longer sits at the top); quick controls, then Notes holding the Purpose.
  geometry: [".pi-quick", ".pi-purpose"],
  // Follow-up 65: every paged inspector's first page closes with Quick controls, Tags and Notes (the closing cards); the pages then
  // run in their order.
  post: [...TagsAndNotes, Card("Exposure")],
  // Components (object: Mass, Rigid Body, Collision; camera: Camera Settings): the owner link, then the cards.
  "object-component": [".oc-owner", ".pi-component [data-card], .rc-cards [data-card]"],
  ...Object.fromEntries(
    [
      "motion-blur",
      "heat-shimmer",
      "glitch",
      "chromatic-aberration",
      "film-grain",
      "lens-distortion",
      "scanlines",
      "sharpen",
      "environment-light",
    ].map((Panel) => [Panel, [".effect-study", ...TagsAndNotes]]),
  ),
  camera: [Card("Lens + field of view"), ...TagsAndNotes, Card("Aperture study"), Card("Camera body"), Card("Sensor")],
  // Follow-up 48: God Rays (Project Zero specification §7), sheet-driven.
  "god-rays": [...TagsAndNotes, Card("Shafts"), Card("March"), Card("Interaction")],
  atmosphere: [
    Card("Atmosphere overview"),
    ...TagsAndNotes,
    Card("Atmospheric scattering"),
    Card("Aerosol haze"),
    Card("Density falloff"),
    Card("Planet and air"),
    Card("Sky colour"),
    Card("Ground reflectance"),
    Card("Atmosphere from space"),
    Card("Atmosphere bake"),
    Card("Baked atmosphere"),
  ],
  sun: [
    Card("Sun now"),
    Card("Quick controls"),
    Card("Sun direction"),
    Card("Sunlight intensity"),
    Card("Tags"),
    Card("Notes"),
    Card("Temperature"),
    Card("Sun disc"),
    Card("Daylight cycle"),
    Card("Dynamic settings"),
    Card("Observer and date"),
    Card("Sun lighting bake"),
  ],
  flare: [
    Card("Flare composite"),
    Card("Quick controls"),
    Card("Flare source"),
    Card("Tags"),
    Card("Notes"),
    Card("Flare layers"),
    Card("Halo & optical response"),
    Card("Lens flare image"),
  ],
  moon: [Card("Moon slot"), Card("Lunar phase"), ...TagsAndNotes, Card("Moon catalogue"), Card("Moonlight, size and atmosphere"), Card("Lunar position")],
  stars: [
    Card("Star field"),
    ...TagsAndNotes,
    Card("Twinkle"),
    Card("Renderer scale"),
    Card("Star field bake"),
  ],
  wind: [
    [null, ".wf-trace"],
    [null, ".mp-rail"],
    [null, ".mp-duo"],
    ...TagsAndNotes,
    Card("Atmospheric modifiers · native draft"),
  ],
  "height-fog": [Card("Fog layer"), ...TagsAndNotes, Card("Density by altitude"), Card("Light in the fog")],
  "aerial-fog": [Card("Aerial perspective"), ...TagsAndNotes, Card("Spectral transmission")],
  "local-fog": [Card("Visibility through fog"), ...TagsAndNotes, Card("Medium"), Card("Fog volume shape")],
  clouds: [
    [null, ".cl-hero"],
    [null, ".mp-duo"],
    ...TagsAndNotes,
    ".cloud-coverage-replacement",
    Card("Cloud base"),
    Card("Cloud body"),
    Card("Cloud wind"),
    Card("Quality"),
  ],
  "local-cloud": [
    [null, ".cl-hero"],
    [null, ".mp-duo"],
    ...TagsAndNotes,
    ".cloud-coverage-replacement",
    Card("Cloud base"),
    Card("Local bounds"),
    Card("Cloud body"),
  ],
  precipitation: [
    Card("Precipitation type"),
    ...TagsAndNotes,
    Card("Fall + density"),
    Card("Simulation + settling"),
  ],
  rainbow: [
    Card("Optical preview"),
    ...TagsAndNotes,
    Card("Bow response"),
    Card("Bake / image"),
  ],
};
// Vehicle folder rows: every inspector opens with its headline figure, then its fields (Vehicle Movement is data only).
Sections["vehicle-component"] = [".vc-card .metric", ".vc-card .field"];
// Level vehicles (Follow-up 60): the model picture and its paints, then the dimensions with their plan and facts.
Sections["vehicle-asset"] = [".va-hero", ".va-paints", ".va-plan", ".va-facts"];
const BakeCards = {
  sun: ["Sun lighting bake", "Sun disk bake"],
  atmosphere: ["Atmosphere bake", "Baked atmosphere"],
  flare: ["Lens flare image"],
  stars: ["Star field bake"],
  rainbow: ["Bake / image"],
  // Showcase geometry keeps Fracture on its own carousel page, so it has no "last card" rule.
};
try {
  await Open("sun");
  const Rows = (await Saved()).Rows;
  for (const Wide of [false, true])
    for (const Row of Rows) {
      await Open(Row.Id, Wide);
      assert.equal(
        await Page.locator(".inspector-scroll h1").first().count(),
        1,
      );
      assert(await Page.locator(".inspector-scroll .breadcrumbs").count());
      if (Row.Panel === "light") {
        // The readings rail and the source group live inside the Preview card, in that order.
        await Sequence(Row.Id, [
          [null, ".lp-preview"],
          [null, ".lp-participation"],
        ]);
        await Sequence(Row.Id, [
          [null, ".lp-preview .lp-primary"],
          [null, ".lp-preview .lp-readings"],
          [null, ".lp-preview > .lp-output"],
        ]);
        const Controls = Frame("details");
        // Follow-up 65: Overview (the summary, then Quick controls, Tags, Notes), then Source (the light's source and controls).
        await Sequence(Row.Id, [["summary", ".lp-participation"], ...TagsAndNotes, ["details", ".lp-shape"]]);
        // The analytical study sits inside the optics card's visual, with no card or header of its own.
        assert(
          (await Controls.locator(".lp-shape .lp-shape-visual > .lp-response").count()) <= 1,
        );
        assert.equal(
          await Controls.locator(".lp-response > header").count(),
          0,
        );
        assert.equal(await Controls.locator(".lp-response.lp-card").count(), 0);
        if (Wide) {
          // Wide frames place optics and placement in neighbouring columns.
          const Shape = await Controls.locator(".lp-shape").boundingBox();
          const Transform = await Controls.locator(".lp-transform").boundingBox();
          assert(Shape && Transform && Transform.y >= Shape.y - 2);
        } else
          await Sequence(Row.Id, [
            ["details", ".lp-shape"],
            ["details", ".lp-transform"],
          ]);
      } else await Sequence(Row.Id, Sections[Row.Panel]);
      if (BakeCards[Row.Panel]) {
        const Names = await Page.locator(
          ".inspector-scroll [data-card]",
        ).evaluateAll((Nodes) => Nodes.map((Node) => Node.dataset.card));
        assert.deepEqual(
          Names.slice(-BakeCards[Row.Panel].length),
          BakeCards[Row.Panel],
          Row.Id + " baking must be last",
        );
        const Last = Page.locator(Card(BakeCards[Row.Panel].at(-1)));
        assert(
          await Last.evaluate((Node) => {
            const Root = Node.closest("[data-panel]");
            return [
              ...Root.querySelectorAll(
                "input,select,textarea,button,[data-card]",
              ),
            ].every(
              // (The page carousel's strip, Follow-up 64, comes before the pages, so nothing of it follows.)
              (Other) =>
                Node.contains(Other) ||
                !(
                  Node.compareDocumentPosition(Other) &
                  Node.DOCUMENT_POSITION_FOLLOWING
                ),
            );
          }),
          Row.Id + " no controls follow baking",
        );
      }
      assert(
        await Page.locator(".inspector-scroll").first().evaluate(
          (Node) => Node.scrollWidth <= Node.clientWidth + 1,
        ),
        Row.Id + " parent overflow",
      );
      for (const Iframe of await Page.locator(
        ".reference-inspector-copy iframe",
      ).all())
        assert(
          await Iframe.contentFrame()
            .locator("body")
            .evaluate((Body) => Body.scrollWidth <= innerWidth),
          Row.Id + " frame overflow",
        );
      Checks.push(
        Row.Id +
          (Wide ? " expanded" : " docked") +
          ": heading, available section order, baking last, no overflow",
      );
      Inventory.push({
        Id: Row.Id,
        Panel: Row.Panel,
        Wide,
        Cards: await Page.locator(".inspector-scroll [data-card]").evaluateAll(
          (Nodes) => Nodes.map((Node) => Node.dataset.card),
        ),
      });
    }
  if (process.env.FRONTIER_BASELINE_HTML) {
    const Previous = await Browser.newPage();
    await Previous.route("http://baseline.test/**", (Route) =>
      Route.fulfill({
        contentType: "text/html",
        body: fs.readFileSync(process.env.FRONTIER_BASELINE_HTML, "utf8"),
      }),
    );
    const Inputs = (Page) =>
      Page.locator(".inspector-scroll").first().evaluate((Root) =>
        [
          ...Root.querySelectorAll(
            "input[aria-label]:not([readonly]),select[aria-label],textarea[aria-label]",
          ),
        ]
          .filter(
            (Node) =>
              !Node.getAttribute("aria-label")?.toLowerCase().includes("notes"),
          )
          .map((Node) =>
            [Node.tagName, Node.type, Node.getAttribute("aria-label")].join(
              " ",
            ),
          )
          .sort(),
      );
    for (const Row of Rows.filter(
      (Row, Index, All) =>
        All.findIndex((Other) => Other.Panel === Row.Panel) === Index,
    )) {
      await Open(Row.Id);
      await Previous.goto("http://baseline.test/?inspect=" + Row.Id);
      await Previous.locator(".inspector-scroll").waitFor();
      const ActualInputs = await Inputs(Page),
        PreviousInputs = await Inputs(Previous),
        ExpectedInputs =
          Row.Panel.includes("fog")
            ? PreviousInputs.filter(
                (Input) => Input !== "INPUT number Fog probe altitude",
              )
            : PreviousInputs;
      assert.deepEqual(
        ActualInputs,
        ExpectedInputs,
        Row.Id + " native input contract",
      );
      Checks.push(
        Row.Panel +
          ": native editable input inventory matches C052, ignoring order",
      );
    }
    await Previous.close();
  }
  await Open("reference-fill-point", true);
  // Follow-up 65: the light's sheet sits over its Overview and Source pages; ReferenceSheet finds the slice holding each target.
  const Table = ReferenceSheet(Page).locator(".lp-response-samples");
  assert.deepEqual(await Table.locator("tbody tr").allTextContents(), [
    "1 m10.00 lx100.0%",
    "2 m2.50 lx25.0%",
    "5 m0.40 lx4.0%",
    "10 m0.10 lx1.0%",
  ]);
  const Image = () =>
    ReferenceSheet(Page)
      .locator(".lp-response canvas")
      .evaluate((Canvas) => Canvas.toDataURL());
  const Before = await Image();
  await ReferenceSheet(Page).getByLabel("Intensity value", { exact: true }).fill("50");
  await Page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("Frontier.ProjectZeroHtml.v1")).Values[
        "reference-fill-point"
      ]?.ReferenceInspector?.Properties?.intensity === 50,
  );
  await ReferenceSheet(Page).getByLabel("Decay exponent value", { exact: true }).fill("1");
  await Table.getByText("10.00 lx", { exact: true }).waitFor();
  assert.notEqual(await Image(), Before);
  await Open("reference-fill-point", true);
  await Table.getByText("10.00 lx", { exact: true }).waitFor();
  await ReferenceSheet(Page)
    .locator(".lp-shape")
    .evaluate((Node) => Node.scrollIntoView({ block: "start" }));
  await Page.screenshot({
    path: path.join(Proof, "PointResponseExpanded.png"),
  });
  await Page.locator('iframe[title^="Reference inspector"]').evaluateAll((Iframes) =>
    Iframes.forEach((Iframe) => (Iframe.style.width = "240px")),
  );
  assert(
    await ReferenceSheet(Page)
      .locator("body")
      .evaluate((Node) => Node.scrollWidth <= innerWidth),
  );
  await Table.screenshot({ path: path.join(Proof, "PointSamplesNarrow.png") });
  Checks.push(
    "Point response: exact numeric samples, intensity/decay update chart and table, reload persistence, 240px fit",
  );
  for (const [Id, Wide, Name, Target] of [
    ["light", false, "AreaDocked", null],
    ["reference-softbox", true, "AreaExpanded", null],
    ["sun", true, "SunBakingLast", Card("Sun lighting bake")],
    ["atmosphere", true, "AtmosphereBakingLast", Card("Atmosphere bake")],
    ["stars", false, "StarsBakingLast", Card("Star field bake")],
    ["clouds", true, "CloudOrder", null],
    ["height-fog", false, "HeightFogOrder", Card("Fog layer")],
    ["wind", true, "WindOrder", Card("Wind controls")],
  ]) {
    await Open(Id, Wide);
    if (Target)
      await Page.locator(Target).evaluate((Node) =>
        Node.scrollIntoView({ block: "start" }),
      );
    await Page.screenshot({ path: path.join(Proof, Name + ".png") });
  }
  assert.deepEqual(Errors, []);
  console.log("Inspector order checks passed:", Checks.length);
} catch (Error) {
  Errors.push(Error.stack);
  console.error(Error);
  process.exitCode = 1;
  await Page.screenshot({ path: path.join(Proof, "Failure.png") }).catch(
    () => {},
  );
} finally {
  fs.writeFileSync(
    path.join(Proof, "Checks.json"),
    JSON.stringify({ Checks, Inventory, Errors, FontFailures }, null, 2) + "\n",
  );
  await Browser.close();
}
