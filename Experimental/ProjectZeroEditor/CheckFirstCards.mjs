import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Follow-up 47: the Sun and Atmosphere first cards, three designs each (A/B/C), switched on the card and stored on the object.
const Folder = path.dirname(fileURLToPath(import.meta.url));
const Require = createRequire(process.env.FRONTIER_BROWSER_PACKAGE || path.resolve(Folder, "../../../_AgentScratch/Browser/package.json"));
const { chromium } = Require("playwright");
const Proof = process.env.FRONTIER_PROOF_FOLDER || path.join(Folder, "Screenshots/FirstCards");
fs.mkdirSync(Proof, { recursive: true });
const Checks = [],
  Errors = [];
const Browser = await chromium.launch({ executablePath: process.env.FRONTIER_BROWSER_EXECUTABLE || "/tmp/chromium", args: ["--no-sandbox", "--disable-gpu"] });
const Page = await Browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
Page.setDefaultTimeout(20000);
const Address = process.env.FRONTIER_EDITOR_URL || "http://127.0.0.1:4173/ProjectZeroEditor/";
Page.on("pageerror", (Error) => Errors.push(Error.stack));
const Open = async (Id) => {
  await Page.goto(Address + "?inspect=" + Id);
  await Page.locator(".inspector-scroll > [data-panel]").waitFor();
  await Page.waitForTimeout(250);
};
const Saved = () => Page.evaluate(() => JSON.parse(localStorage.getItem("Frontier.ProjectZeroHtml.v1")));
const StoredBecomes = (Id, Key, Test) =>
  Page.waitForFunction(
    ([Id, Key, Source]) => {
      const Values = JSON.parse(localStorage.getItem("Frontier.ProjectZeroHtml.v1") || "{}")?.Values?.[Id] || {};
      return new Function("Stored", "return " + Source)(Values[Key]);
    },
    [Id, Key, Test],
  );
const Patch = (Id, Values) =>
  Page.evaluate(
    ([Id, Values]) => {
      const Scene = JSON.parse(localStorage.getItem("Frontier.ProjectZeroHtml.v1") || "{}");
      Scene.Values ||= {};
      Scene.Values[Id] = Object.assign(Scene.Values[Id] || {}, Values);
      localStorage.setItem("Frontier.ProjectZeroHtml.v1", JSON.stringify(Scene));
    },
    [Id, Values],
  );
const Card = (Title) => Page.locator(`[data-card="${Title}"]`);

try {
  await Page.goto(Address);
  await Page.evaluate(() => localStorage.clear());

  // ----------------------------------------------------------------------------------------------------------------------- Sun
  await Open("sun");
  const Sun = Card("Sun now");
  await Sun.waitFor();
  await Patch("sun", { "Local Hours": 15.5 });
  await Open("sun");
  assert.deepEqual(await Sun.locator("[data-sun-design-pick]").evaluateAll((Each) => Each.map((Button) => [Button.dataset.sunDesignPick, Button.textContent])), [["dial", "A"], ["horizon", "B"], ["sheet", "C"]]);
  // A · dial: phases on the band, sunrise and sunset marks, a shadow hand by day; dragging to the top sets noon.
  assert.equal(await Sun.locator('[data-sun-design="dial"]').count(), 1);
  const Phases = await Sun.locator("[data-dial-phase]").evaluateAll((Each) => [...new Set(Each.map((Path) => Path.dataset.dialPhase))].sort());
  assert.deepEqual(Phases, ["astronomical", "civil", "day", "golden", "nautical", "night"]);
  assert.equal(await Sun.locator("[data-dial-mark]").count(), 2);
  assert.equal(await Sun.locator("[data-dial-shadow]").count(), 1);
  assert.deepEqual(await Sun.locator(".sun-card-chips [data-sun-fact]").allInnerTexts(), ["05:43", "12h 25 of light", "18:08"]);
  await Sun.screenshot({ path: path.join(Proof, "SunDial.png") });
  const Dial = await Sun.locator(".sd-dial").boundingBox();
  await Page.mouse.click(Dial.x + Dial.width / 2, Dial.y + Dial.height * 0.08);
  await StoredBecomes("sun", "Local Hours", "Math.abs(Stored - 12) < 0.2");
  Checks.push("Sun A · Solar dial: six light phases on the band, sunrise / sunset marks, shadow hand; 05:43 · 12h 25 · 18:08; clicking the top of the dial sets noon");

  // B · horizon: the sun sits on its path; the light band picks the time.
  await Patch("sun", { "Local Hours": 15.5 });
  await Open("sun");
  await Sun.locator('[data-sun-design-pick="horizon"]').click();
  await StoredBecomes("sun", "Sun card design", 'Stored === "horizon"');
  assert.equal(await Sun.locator('[data-sun-design="horizon"]').count(), 1);
  assert(await Sun.locator("[data-sun-path]").count() >= 1);
  assert.equal(await Sun.locator("[data-horizon-shadow]").count(), 1);
  assert.match(await Sun.locator('[data-sun-fact="Position"]').innerText(), /34\.4°[\s\S]*WNW 283°/);
  assert.match(await Sun.locator('[data-sun-fact="Peak"]').innerText(), /68°[\s\S]*11:54/);
  await Sun.screenshot({ path: path.join(Proof, "SunHorizon.png") });
  const Band = await Sun.locator(".sh-band").boundingBox();
  await Page.mouse.click(Band.x + Band.width * (62 / 240), Band.y + Band.height * 0.3);
  await StoredBecomes("sun", "Local Hours", "Math.abs(Stored - 6) < 0.2");
  Checks.push("Sun B · Horizon: path, figure shadow, 34.4° WNW 283°, highest 68° at 11:54; clicking a quarter along the light band sets 06:00");

  // C · sheet: four numbered figures and the blackbody bar; the hour dots pick the time.
  await Patch("sun", { "Local Hours": 15.5 });
  await Open("sun");
  await Sun.locator('[data-sun-design-pick="sheet"]').click();
  await StoredBecomes("sun", "Sun card design", 'Stored === "sheet"');
  const Figures = await Sun.locator(".ss-numbers [data-sun-fact]").evaluateAll((Each) => Each.map((Box) => [Box.dataset.sunFact, Box.querySelector("b").textContent]));
  assert.deepEqual(Figures, [["Illuminance", "63"], ["Air mass", "1.8"], ["UV index", "3.1"], ["Shadow", "1.5"]]);
  assert.equal(await Sun.locator("[data-sheet-beam]").count(), 1);
  assert.equal(await Sun.locator("[data-sheet-shadow]").count(), 1);
  assert.match(await Sun.locator('[data-sun-fact="Colour"]').getAttribute("aria-label"), /6500 kelvin/);
  assert(await Sun.locator(".ss-numbers [data-sun-fact]").evaluateAll((Each) => Each.every((Box) => Box.scrollWidth <= Box.clientWidth + 1)));
  await Sun.screenshot({ path: path.join(Proof, "SunSheet.png") });
  const Hours = await Sun.locator(".ss-hours").boundingBox();
  await Page.mouse.click(Hours.x + Hours.width * ((8 + (20.5 / 24) * 224) / 240), Hours.y + Hours.height * 0.35);
  await StoredBecomes("sun", "Local Hours", "Stored >= 20 && Stored < 21");
  await Open("sun");
  assert.equal(await Sun.locator('[data-sun-design="sheet"]').count(), 1);
  assert.match(await Sun.locator(".sun-card-phase").innerText(), /twilight|Night/);
  Checks.push("Sun C · Sunlight sheet: 63 klx, air mass 1.8, UV 3.1, shadow 1.5 × height, 6500 K; the 20:00 dot sets the evening; the design survives reload");

  // ---------------------------------------------------------------------------------------------------------------- Atmosphere
  await Open("atmosphere");
  const Air = Card("Atmosphere overview");
  await Air.waitFor();
  assert.equal(await Card("Sky colour").count(), 0);
  assert.equal(await Air.locator('[data-atmosphere-design="section"]').count(), 1);
  const Layers = await Air.locator("[data-layer]").evaluateAll((Each) => Each.map((Shape) => Shape.dataset.layer));
  assert.deepEqual(Layers, ["troposphere", "stratosphere", "mesosphere", "thermosphere", "ozone"]);
  assert.equal(await Air.locator("[data-density]").count(), 2);
  assert.equal(await Air.locator("[data-sunbeam]").count(), 1);
  const Depth = async () => +(await Air.locator('[data-figure="depth"] b').innerText());
  const Before = await Depth();
  await Air.screenshot({ path: path.join(Proof, "AtmosphereSection.png") });
  // Doubling Rayleigh deepens the column; the preview sun slider is stored on the atmosphere.
  await Patch("atmosphere", { Rayleigh: 2 });
  await Open("atmosphere");
  const After = await Depth();
  assert(After > Before * 1.4, `${Before} → ${After}`);
  await Air.locator('input[aria-label="Preview sun height"]').fill("6");
  await StoredBecomes("atmosphere", "Sky preview elevation", "Stored === 6");
  Checks.push(`Atmosphere A · Cross-section: four layers + ozone band, two density curves, a sunbeam; Rayleigh 1 → 2 deepens the column ${Before} → ${After}; preview sun 6° stored`);

  await Patch("atmosphere", { Rayleigh: 1, "Sky preview elevation": 32 });
  await Open("atmosphere");
  await Air.locator('[data-atmosphere-design-pick="limb"]').click();
  await StoredBecomes("atmosphere", "Atmosphere card design", 'Stored === "limb"');
  assert.equal(await Air.locator('[data-atmosphere-design="limb"]').count(), 1);
  assert.match(await Air.locator("[data-thickness]").textContent(), /60 km, drawn ×\d+/);
  assert.deepEqual(await Air.locator("[data-swatch]").evaluateAll((Each) => Each.map((Shape) => Shape.dataset.swatch)), ["Day limb", "Sunset band", "Overhead"]);
  const Sunset = await Air.locator('[data-swatch="Sunset band"] i').evaluate((Shape) => getComputedStyle(Shape).backgroundColor.match(/\d+/g).map(Number));
  assert(Sunset[0] > Sunset[2] * 2, String(Sunset));
  await Air.screenshot({ path: path.join(Proof, "AtmosphereLimb.png") });
  Checks.push(`Atmosphere B · Planet limb: glowing ring with thickness label, swatches day / sunset / overhead; sunset band is red-dominant rgb(${Sunset.join(", ")})`);

  await Air.locator('[data-atmosphere-design-pick="scatter"]').click();
  await StoredBecomes("atmosphere", "Atmosphere card design", 'Stored === "scatter"');
  // Forward reach is normalised, so the lobe's shape is its height over its width: lower anisotropy, rounder lobe.
  const Lobe = () => Air.locator('[data-lobe="mie"]').evaluate((Shape) => Shape.getBBox().height / Shape.getBBox().width);
  const Narrow = await Lobe();
  assert.equal(await Air.locator('[data-lobe="rayleigh"]').count(), 1);
  assert.equal(await Air.locator("[data-leftover]").count(), 1);
  await Air.screenshot({ path: path.join(Proof, "AtmosphereScatter.png") });
  await Patch("atmosphere", { "Mie Anisotropy": 0.2 });
  await Open("atmosphere");
  const Round = await Lobe();
  assert(Round > Narrow * 1.3, `${Narrow} → ${Round}`);
  Checks.push(`Atmosphere C · Scattering: Rayleigh and Mie lobes, leftover sunset beam; anisotropy 0.78 → 0.2 rounds the Mie lobe, height / width ${Narrow.toFixed(2)} → ${Round.toFixed(2)}`);

  assert.deepEqual(Errors, []);
  console.log(Checks.map((Check) => "🟢 " + Check).join("\n"));
  console.log(`${Checks.length} FirstCards checks passed`);
} finally {
  await Browser.close();
}
