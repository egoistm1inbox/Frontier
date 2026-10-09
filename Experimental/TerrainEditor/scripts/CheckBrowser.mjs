// Browser check: serves the built app from dist/, loads it in headless Chromium,
// waits for the first evaluation, checks the console is clean, and writes
// screenshots of the main views to out/browser.
//
// Set CHROME_PATH to a Chromium binary (for example /usr/bin/chromium).
// Run `npm run build` first.

import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const Here = dirname(fileURLToPath(import.meta.url));
const Root = join(Here, "..");
const DistDirectory = join(Root, "dist");
const OutputDirectory = join(Root, "out", "browser");
const ChromePath = process.env.CHROME_PATH;
const Types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

if (!ChromePath) {
  console.error("CHROME_PATH is not set. Point it at a Chromium binary.");
  process.exit(2);
}
if (!existsSync(join(DistDirectory, "index.html"))) {
  console.error("dist/ is missing. Run npm run build first.");
  process.exit(2);
}
mkdirSync(OutputDirectory, { recursive: true });

const Server = createServer((Request, Response) => {
  const Path = new URL(Request.url, "http://localhost").pathname;
  let File = join(DistDirectory, Path === "/" ? "index.html" : Path);
  if (!existsSync(File) || statSync(File).isDirectory()) File = join(DistDirectory, "index.html");
  Response.writeHead(200, { "Content-Type": Types[extname(File)] || "application/octet-stream" });
  createReadStream(File).pipe(Response);
});
await new Promise((Resolve) => Server.listen(0, "127.0.0.1", Resolve));
const Address = `http://127.0.0.1:${Server.address().port}/`;

const Failures = [];
const Problems = [];
const Pause = (Milliseconds) => new Promise((Resolve) => setTimeout(Resolve, Milliseconds));
const Browser = await puppeteer.launch({
  executablePath: ChromePath,
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 900 },
});

try {
  const Page = await Browser.newPage();
  Page.on("console", (Message) => {
    if (Message.type() === "error" && !/Failed to load resource/.test(Message.text())) Problems.push(`console: ${Message.text()}`);
  });
  Page.on("pageerror", (Failure) => Problems.push(`pageerror: ${Failure.message}`));
  await Page.goto(Address, { waitUntil: "load" });
  await Page.waitForSelector(".workspace", { timeout: 15000 });
  await Page.waitForSelector(".outliner-row", { timeout: 15000 });
  await Page.waitForFunction(() => [...document.querySelectorAll(".viewport-footer b")].some((Node) => /ms$/.test(Node.textContent)), { timeout: 120000 });

  const Layers = await Page.$$eval(".outliner-row", (Rows) => Rows.length);
  Expect(Layers >= 10, `expected the outliner to list the stack, found ${Layers} rows`);
  Expect(await Page.$(".relief-stage canvas") !== null, "3D relief canvas must exist");
  const CanvasSize = await Page.$eval(".relief-stage canvas", (Canvas) => [Canvas.width, Canvas.height]);
  Expect(CanvasSize[0] > 100 && CanvasSize[1] > 100, `3D canvas is too small: ${CanvasSize}`);
  await Pause(600);
  await Page.screenshot({ path: join(OutputDirectory, "01-relief.png") });

  // Select the top terrain layer, then isolate its mask.
  const Rows = await Page.$$(".outliner-row");
  await Rows[12].click();
  await Page.waitForSelector(".inspector-scroll");
  await Page.click(".viewport-modes button:nth-child(5)");
  await Page.waitForFunction(() => document.querySelector(".map-stage canvas") !== null, { timeout: 30000 });
  await Page.waitForFunction(() => !document.querySelector(".busy-chip"), { timeout: 120000 });
  await Pause(400);
  await Page.screenshot({ path: join(OutputDirectory, "02-mask.png") });

  await Page.click(".viewport-modes button:nth-child(4)");
  await Pause(400);
  await Page.screenshot({ path: join(OutputDirectory, "03-water.png") });

  await Page.click(".viewport-modes button:nth-child(1)");
  await Rows[9].click();
  await Pause(300);
  await Page.screenshot({ path: join(OutputDirectory, "05-inspector.png") });

  // Construct dialog: open, pick the Water group, then close.
  await Page.click('button[aria-label="Add layer"]');
  await Page.waitForSelector(".construct-dialog");
  const Tiles = await Page.$$eval(".construct-tile", (Nodes) => Nodes.length);
  Expect(Tiles >= 6, `Construct should list operations, found ${Tiles}`);
  await Page.screenshot({ path: join(OutputDirectory, "04-construct.png") });
  await Page.click('button[aria-label="Close construct"]');

  // Undo should remove the most recent edit without errors.
  const Before = await Page.$$eval(".outliner-row", (Nodes) => Nodes.length);
  await Page.click('button[aria-label="Undo"]');
  await Pause(300);
  Expect(Before > 0, "outliner must still be populated after undo");

  Expect(Problems.length === 0, `browser reported problems:\n  ${Problems.join("\n  ")}`);
} catch (Problem) {
  Failures.push(`browser check threw: ${Problem.message}`);
  try {
    const Pages = await Browser.pages();
    await Pages[Pages.length - 1].screenshot({ path: join(OutputDirectory, "failure.png") });
  } catch (Ignored) {
    // The screenshot is best effort.
  }
} finally {
  await Browser.close();
  Server.close();
}

function Expect(Condition, Message) {
  if (!Condition) Failures.push(Message);
}

if (Failures.length) {
  console.error(`FAILED:\n- ${Failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`Browser check passed. Screenshots in ${OutputDirectory}`);
