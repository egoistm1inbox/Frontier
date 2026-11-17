// CAPTUREHMI.CJS
// 🧩 Drives a cabin HMI prototype through a JSON step list in headless Chromium and saves each requested capture.
// 📝 Steps: { "click": selector } · { "eval": "js" } · { "wait": ms } · { "drag": [selector, dx, dy] } ·
//    { "hover": [selector, fx, fy] } · { "shot": "file.png" }. Usage: node CaptureHmi.cjs <url> <steps.json> <outdir>
const { chromium } = require('playwright-core');
const sp = require('@sparticuz/chromium');
const fs = require('fs');
const path = require('path');
if (process.platform === 'linux') process.env.LD_LIBRARY_PATH = ['/tmp/al2023/lib', process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
(async () => {
  const [url, stepFile, outDir] = process.argv.slice(2);
  const steps = JSON.parse(fs.readFileSync(stepFile, 'utf8'));
  const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: [...sp.args, '--enable-unsafe-swiftshader'], headless: true });
  const page = await browser.newPage({ viewport: { width: 1640, height: 940 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForTimeout(5000);
  for (const step of steps) {
    if (step.click) await page.click(step.click);
    if (step.eval) await page.evaluate(step.eval);
    if (step.wait) await page.waitForTimeout(step.wait);
    if (step.hover) { const b = await page.locator(step.hover[0]).boundingBox(); await page.mouse.move(b.x + b.width * step.hover[1], b.y + b.height * step.hover[2]); }
    if (step.drag) {
      const b = await page.locator(step.drag[0]).boundingBox();
      const x = b.x + b.width / 2, y = b.y + b.height / 2;
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x + step.drag[1], y + step.drag[2], { steps: 8 }); await page.mouse.up();
    }
    if (step.shot) { await page.screenshot({ path: path.join(outDir, step.shot) }); console.log('saved', step.shot); }
  }
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})();
