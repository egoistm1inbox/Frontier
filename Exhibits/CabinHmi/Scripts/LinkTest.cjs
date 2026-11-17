// LINKTEST.CJS
// 🧩 Opens Nocturne and the Tide cluster in one browser: the cluster demo must move the HMI car, and HMI lamps must light
//    the cluster telltales. Run from a folder with playwright-core and @sparticuz/chromium (see README).
const { chromium } = require('playwright-core');
const sp = require('@sparticuz/chromium');
process.env.LD_LIBRARY_PATH = ['/tmp/al2023/lib', process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
(async () => {
  const browser = await chromium.launch({ executablePath: await sp.executablePath(), args: [...sp.args, '--enable-unsafe-swiftshader'], headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1640, height: 940 } });
  const errors = [];
  const hmi = await ctx.newPage(); hmi.on('pageerror', e => errors.push('HMI ' + e.message));
  await hmi.goto('http://localhost:8097/Experimental/CabinHmi/Nocturne/Nocturne.html');
  const dash = await ctx.newPage(); dash.on('pageerror', e => errors.push('DASH ' + e.message));
  await dash.goto('http://localhost:8097/Experimental/CabinHmi/Clusters/Tide/Tide.html');
  await hmi.waitForTimeout(6000);
  await hmi.evaluate(() => { HmiCondition.OpenMenu('Drive'); HmiCondition.SetLamps({ FogFront: true, Beam: 'High' }); });
  await dash.evaluate(() => ClusterCondition.SetDemo(true));
  await hmi.waitForTimeout(9000);
  const h = await hmi.evaluate(() => ({ Speed: Math.round(HmiCondition.Condition.Speed), Plan: HmiCondition.FlowPlan().State }));
  const d = await dash.evaluate(() => ({ Fog: document.querySelector('[data-telltale="FogFront"]').className, High: document.querySelector('[data-telltale="High"]').className }));
  await hmi.screenshot({ path: '/home/user/Frontier/_ClaudeScratch/tmp/link-hmi.png' });
  console.log(JSON.stringify({ h, d, errors }));
  await browser.close();
})();
