// CAPTURETIERDESCENT.CJS
// 🧩 Headless Chromium capture for the viewer redesign exhibit (see ../README.md for setup and usage).
// 📝 Sandbox Linux: @sparticuz/chromium unpacks NSS libraries to /tmp/al2023/lib only when AWS_EXECUTION_ENV is set.
const { chromium } = require('playwright-core');
const sp = require('@sparticuz/chromium');
if (process.platform === 'linux') process.env.LD_LIBRARY_PATH = ['/tmp/al2023/lib', process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
(async () => {
  const b = await chromium.launch({ executablePath: await sp.executablePath(), args: [...sp.args, '--enable-unsafe-swiftshader'], headless: true });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type()==='error' && errs.push(m.text()));
  await p.goto(process.argv[2]); await p.waitForTimeout(2500);
  const out = process.argv[3];
  // clay + side view
  await p.click('[data-shading="clay"]');
  await p.evaluate(() => { const c = window.TierDescentCondition; c.Yaw = 0; c.Pitch = 0.05; });
  await p.click('[data-shading="clay"]'); await p.waitForTimeout(300);
  await p.locator('[data-id="Preview"]').screenshot({ path: out + '-side.png' });
  // materials, tier 3 forced, hover a cluster
  await p.evaluate(() => { const c = window.TierDescentCondition; c.Yaw = -0.65; c.Pitch = 0.38; });
  await p.click('[data-shading="materials"]');
  await p.locator('.TierRail li').nth(3).click(); await p.waitForTimeout(600);
  const box = await p.locator('[data-id="Preview"]').boundingBox();
  await p.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.48); await p.waitForTimeout(500);
  await p.screenshot({ path: out + '-forced.png' });
  // tyre part, pin seams, drag budget down
  await p.click('[data-part="Rim"]'); await p.click('[data-mode="pin"]'); await p.waitForTimeout(800);
  const h = await p.locator('[data-id="BudgetHandle"]').boundingBox();
  await p.mouse.move(h.x + h.width/2, h.y + h.height/2); await p.mouse.down(); await p.mouse.move(h.x + h.width/2, h.y + 40, { steps: 5 }); await p.mouse.up();
  await p.click('[data-shading="clusters"]'); await p.waitForTimeout(600);
  await p.screenshot({ path: out + '-rim.png' });
  const state = await p.evaluate(() => { const c = window.TierDescentCondition; return { part: c.PartToken, seam: c.SeamMode, budget: c.Budget, forced: c.ForcedTier, tiers: c.Build.Tiers.map(t => [t.triangles, +t.error.toFixed(4), +(t.materialError*100).toFixed(2)]), badge: document.querySelector('[data-id="TierBadge"]').textContent, shed: document.querySelector('[data-id="ShedWhole"]').textContent + document.querySelector('[data-id="ShedFraction"]').textContent }; });
  console.log(JSON.stringify(state)); console.log('errors', JSON.stringify(errs));
  await b.close();
})();
