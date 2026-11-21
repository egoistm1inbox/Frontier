// Follow-up 43: every Sun and Atmosphere card owns a distinct preview, and each preview edits its authored field.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const Require = createRequire(
  process.env.FRONTIER_BROWSER_PACKAGE ||
    new URL("../FrontierEditor/package.json", import.meta.url),
);
const { chromium } = Require("playwright");
const Proof =
  process.env.FRONTIER_PROOF_FOLDER ||
  path.resolve("Frontier/Experimental/ProjectZeroEditor/Screenshots");
fs.mkdirSync(Proof, { recursive: true });
const Browser = await chromium.launch({
  executablePath: process.env.FRONTIER_BROWSER_EXECUTABLE || undefined,
  args: ["--no-sandbox", "--disable-gpu"],
  headless: true,
});
const Page = await Browser.newPage({ viewport: { width: 1440, height: 1000 } });
Page.setDefaultTimeout(15000);
const Errors = [], Checks = [];
Page.on("pageerror", (Error) => Errors.push(Error.message));
const Saved = () => Page.evaluate(() => JSON.parse(localStorage.getItem("Frontier.ProjectZeroHtml.v1")));
const Card = (Name) => Page.locator(`[data-card="${Name}"]`);
const Slider = (Name) => Page.getByRole("slider", { name: Name, exact: true });
async function Press(Name, Key) {
  await Slider(Name).scrollIntoViewIfNeeded();
  await Slider(Name).focus();
  await Page.keyboard.press(Key);
}
const Base = process.env.FRONTIER_EDITOR_URL || "http://127.0.0.1:5180/";
try {
  await Page.goto(Base + "?inspect=sun", { waitUntil: "networkidle" });
  const Sun = { "Sun direction": ".shadow-plate", "Sunlight intensity": ".lit-sphere", Temperature: ".kelvin-ribbon", "Daylight cycle": ".day-dial", "Sun disc": ".solar-disc-study", "Dynamic settings": ".analemma" };
  for (const [Title, Selector] of Object.entries(Sun)) {
    assert.equal(await Card(Title).locator(Selector).count(), 1, Title);
    assert.equal(await Card(Title).locator("[data-live-plot]").count(), 0, Title + " keeps no generic chart");
  }
  assert.equal(new Set(Object.values(Sun)).size, 6);
  Checks.push("six Sun cards each own a different preview and no generic line chart");

  await Press("Sun shadow plate", "PageUp");
  assert.equal((await Saved()).Values.sun["Local Hours"], 16.5);
  await Press("Sun daylight graph", "Home");
  assert.equal((await Saved()).Values.sun["Local Hours"], 0);
  await Press("Sun daylight graph", "PageUp");
  await Press("Sun disc size", "End");
  assert.equal((await Saved()).Values.sun["Angular Diameter"], 5);
  assert.equal(await Card("Sun disc").locator("[data-penumbra]").count(), 1);
  Checks.push("shadow plate and day dial set Local Hours; disc size slider sets Angular Diameter");

  assert.ok(!(await Saved()).Values.sun?.["Colour source"]);
  const Ribbon = Slider("Sun colour temperature");
  await Ribbon.scrollIntoViewIfNeeded();
  const Box = await Ribbon.boundingBox();
  await Page.mouse.click(Box.x + Box.width * 0.2, Box.y + Box.height * 0.5);
  const Picked = (await Saved()).Values.sun;
  assert.equal(Picked["Colour source"], 1);
  assert.ok(Picked.Temperature > 1500 && Picked.Temperature < 3000, String(Picked.Temperature));
  assert.equal(await Card("Temperature").locator("[data-kelvin-thumb]").count(), 1);
  await Press("Sunlight gain graph", "End");
  await Page.waitForTimeout(100);
  assert.equal(await Card("Sunlight intensity").locator("[data-zebra]").count(), 1);
  Checks.push("ribbon switches to Temperature and picks a warm kelvin; full gain shows clipped zebra");
  await Press("Sun seasonal graph", "Home");
  assert.equal((await Saved()).Values.sun.Month, 1);
  assert.equal((await Saved()).Values.sun["Day of Month"], 1);
  await Card("Sun direction").scrollIntoViewIfNeeded();
  await Page.screenshot({ path: path.join(Proof, "SunStudies.png") });

  await Page.goto(Base + "?inspect=atmosphere", { waitUntil: "networkidle" });
  const Air = { "Atmospheric scattering": ".air-beam", "Aerosol haze": ".haze-ridges", "Ozone absorption": ".ozone-zenith", "Density falloff": ".altitude-column", "Ground reflectance": ".ground-bounce", "Native atmosphere controls": ".twilight-band" };
  for (const [Title, Selector] of Object.entries(Air)) {
    assert.equal(await Card(Title).locator(Selector).count(), 1, Title);
    assert.equal(await Card(Title).locator("[data-live-plot]").count(), 0, Title + " keeps no generic chart");
  }
  assert.equal(await Page.locator('[aria-label^="Atmosphere preset"]').count(), 0);
  assert.equal(await Card("Atmospheric scattering").locator("[data-beam-segment]").count(), 30);
  assert.equal(await Card("Aerosol haze").locator("[data-ridge]").count(), 5);
  Checks.push("six Atmosphere cards each own a different preview; still no presets");

  await Press("Scattering probe along the beam", "End");
  assert.equal((await Saved()).Values.atmosphere["Atmosphere probe beam"], 1);
  await Press("Mie anisotropy lobe", "Home");
  assert.equal((await Saved()).Values.atmosphere["Mie Anisotropy"], 0);
  await Press("Ozone absorption depth", "End");
  assert.equal((await Saved()).Values.atmosphere.Ozone, 4);
  const Before = await Card("Ozone absorption").locator("[data-ozone-sky='1']").evaluate((Rect) => document.querySelector(Rect.getAttribute("fill").slice(4, -1)).innerHTML);
  await Press("Ozone absorption depth", "Home");
  const After = await Card("Ozone absorption").locator("[data-ozone-sky='1']").evaluate((Rect) => document.querySelector(Rect.getAttribute("fill").slice(4, -1)).innerHTML);
  assert.notEqual(Before, After);
  await Press("Rayleigh Scale H handle", "End");
  assert.equal((await Saved()).Values.atmosphere["Rayleigh Scale H"], 15000);
  await Press("Mie Scale H handle", "Home");
  assert.equal((await Saved()).Values.atmosphere["Mie Scale H"], 300);
  Checks.push("beam probe, phase lobe, ozone dip and both scale-height handles write their fields");
  await Card("Atmospheric scattering").scrollIntoViewIfNeeded();
  await Page.screenshot({ path: path.join(Proof, "AtmosphereStudies.png") });
  assert.deepEqual(Errors, []);
  console.log("Sky study checks passed: " + Checks.length);
} finally {
  await Browser.close();
}
