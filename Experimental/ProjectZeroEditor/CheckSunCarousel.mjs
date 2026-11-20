// Smoke test the built standalone editor's Sun category navigation and controls.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const Folder = path.dirname(fileURLToPath(import.meta.url));
const Require = createRequire(path.resolve(Folder, "../FrontierEditor/package.json"));
const { JSDOM, VirtualConsole } = Require("jsdom");
const Errors = [];
const Console = new VirtualConsole();
Console.on("jsdomError", (Error) => Errors.push(Error.message));
const Dom = new JSDOM(fs.readFileSync(path.join(Folder, "index.html"), "utf8"), {
  url: "http://localhost:8092/?inspect=sun",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole: Console,
  beforeParse(Window) {
    Window.HTMLElement.prototype.scrollIntoView = function () {};
    Window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    Window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    Window.HTMLCanvasElement.prototype.getContext = () => null;
  },
});
const Wait = () => new Promise((Resolve) => setTimeout(Resolve, 40));
try {
  await Wait();
  const { document: Document, KeyboardEvent } = Dom.window;
  const Tabs = [...Document.querySelectorAll('.sun-category-list [role="tab"]')];
  assert.deepEqual(Tabs.map((Tab) => Tab.textContent), ["Overview", "Position", "Light", "Cycle", "Bake"]);
  const Panels = [...Document.querySelectorAll('.sun-page[role="tabpanel"]')];
  assert.equal(Panels.length, 5);
  assert.deepEqual(Panels.map((Panel) => Panel.hidden), [false, true, true, true, true]);
  const Enabled = Panels[0].querySelector('[data-quick-action="Enabled"]');
  const WasEnabled = Enabled.getAttribute("aria-pressed");
  Enabled.click();
  await Wait();
  assert.notEqual(Enabled.getAttribute("aria-pressed"), WasEnabled);
  Tabs[2].click();
  await Wait();
  assert.equal(Tabs[2].getAttribute("aria-selected"), "true");
  assert.equal(Panels[2].hidden, false);
  assert.ok(Panels[2].querySelector('[data-card="Temperature"]'));
  Tabs[2].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  await Wait();
  assert.equal(Tabs[3].getAttribute("aria-selected"), "true");
  assert.ok(Panels[3].querySelector('[data-card="Dynamic settings"]'));
  Document.querySelector('[aria-label="Next Sun category"]').click();
  await Wait();
  assert.equal(Tabs[4].getAttribute("aria-selected"), "true");
  assert.ok(Panels[4].querySelector('[data-card="Sun lighting bake"]'));
  Tabs[0].click();
  await Wait();
  assert.notEqual(Enabled.getAttribute("aria-pressed"), WasEnabled);
  assert.deepEqual(Errors, []);
  console.log("Sun carousel navigation, keyboard controls and state: OK");
} finally {
  Dom.window.close();
}
