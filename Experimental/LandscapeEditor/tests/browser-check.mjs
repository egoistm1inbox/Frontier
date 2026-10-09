// Browser smoke test for the running editor. Run `npm run dev` (or `npm run preview`) first, then:
//
//   npm run check:browser -- http://localhost:5173/
//
// It needs a Chrome or Chromium binary. Set CHROME_PATH to point at one if it is not on the usual
// install paths. Screenshots are written to check-output/ (git-ignored).

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || process.env.EDITOR_URL || 'http://localhost:5173/';
const outDir = fileURLToPath(new URL('../check-output/', import.meta.url));
const CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const executablePath = process.env.CHROME_PATH || CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chrome or Chromium found. Set CHROME_PATH to a browser binary.');
  process.exit(2);
}

const failures = [];
const check = (condition, message) => {
  if (condition) console.log(`  ok    ${message}`);
  else {
    console.log(`  FAIL  ${message}`);
    failures.push(message);
  }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1600, height: 900 },
});

try {
  const page = await browser.newPage();
  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(String(error)));

  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  console.log(`Loaded ${url}`);

  // The first evaluation takes a few seconds in a software-rendered browser.
  await page.waitForFunction(
    () => document.querySelectorAll('.outliner-row.lx-layer').length === 6 && /ERODED\s+[\d.]+/.test(document.querySelector('.viewport-footer')?.textContent ?? ''),
    { timeout: 120000 },
  );
  await sleep(500);

  const rows = await page.$$eval('.outliner-row.lx-layer strong', (els) => els.map((el) => el.textContent.trim()));
  check(rows.length === 6, `layer stack has six layers (found ${rows.length})`);
  check(rows.some((name) => name.startsWith('Erosion · ')), 'stack contains erosion layers');
  check(await page.$('.inspector-scroll') !== null, 'inspector column is present on the right');

  // Erosion type dropdown swaps the slider set.
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.outliner-row.lx-layer .lx-row-text strong')].find((el) => el.textContent.startsWith('Erosion · Rain droplets'));
    row?.click();
  });
  await page.waitForSelector('select[aria-label="Process"]', { timeout: 5000 });
  const titlesBefore = await page.$$eval('.inspector-scroll .property-card h3 span', (els) => els.map((el) => el.textContent));
  check(titlesBefore.includes('Rain droplets settings'), 'droplet layer shows rain droplet sliders');
  await page.select('select[aria-label="Process"]', 'thermal');
  await page.waitForFunction(() => [...document.querySelectorAll('.inspector-scroll .property-card h3 span')].some((el) => el.textContent === 'Thermal talus settings'), { timeout: 5000 });
  const renamed = await page.$$eval('.outliner-row.lx-layer strong', (els) => els.map((el) => el.textContent.trim()));
  check(renamed.includes('Erosion · Thermal talus'), 'changing the process renames a default-named layer');

  // Satmap mode: the mode button must become pressed and a screenshot is saved for inspection.
  await page.evaluate(() => [...document.querySelectorAll('.viewport-modes button')].find((el) => el.textContent.trim() === 'Satmap')?.click());
  await page.waitForFunction(
    () => [...document.querySelectorAll('.viewport-modes button[aria-pressed="true"]')].some((el) => el.textContent.trim() === 'Satmap'),
    { timeout: 5000 },
  ).then(() => check(true, 'satmap mode is selected in the viewport'), () => check(false, 'satmap mode is selected in the viewport'));
  await sleep(1500);
  const shotPath = join(outDir, 'satmap.png');
  await page.screenshot({ path: shotPath });
  check(existsSync(shotPath), 'satmap screenshot saved to check-output/satmap.png');

  // Wait for the evaluation that follows the process change to finish and report its readouts.
  await page.waitForFunction(() => /ERODED\s+[\d.]+.*EVAL\s+[\d.]+/.test(document.querySelector('.viewport-footer')?.textContent ?? ''), { timeout: 120000 });
  const footer = await page.$eval('.viewport-footer', (el) => el.textContent);
  check(/ERODED [\d.]+ [kMG]? ?m³/.test(footer) && /DEPOSITED [\d.]+ [kMG]? ?m³/.test(footer), 'footer reports eroded and deposited volumes');
  check(!/NaN|undefined/.test(footer), 'footer shows no NaN or undefined values');

  check(problems.length === 0, `no console errors${problems.length ? `: ${problems.slice(0, 3).join(' | ')}` : ''}`);
} catch (error) {
  console.log(`  FAIL  ${error.message}`);
  failures.push(error.message);
} finally {
  await browser.close();
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll browser checks passed.');
