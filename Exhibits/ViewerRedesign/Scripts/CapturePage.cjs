// CAPTUREPAGE.CJS
// 🧩 Headless Chromium capture for the viewer redesign exhibit (see ../README.md for setup and usage).
// 📝 Sandbox Linux: @sparticuz/chromium unpacks NSS libraries to /tmp/al2023/lib only when AWS_EXECUTION_ENV is set.
const { chromium } = require('playwright-core');
const sp = require('@sparticuz/chromium');
if (process.platform === 'linux') process.env.LD_LIBRARY_PATH = ['/tmp/al2023/lib', process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
(async () => {
  const [url, out, w, h, wait] = process.argv.slice(2);
  const b = await chromium.launch({ executablePath: await sp.executablePath(), args: [...sp.args, '--enable-unsafe-swiftshader'], headless: true });
  const p = await b.newPage({ viewport: { width: +w || 1600, height: +h || 900 } });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForTimeout(+wait || 4000);
  await p.screenshot({ path: out });
  console.log(JSON.stringify(errs.slice(0, 10), null, 1));
  await b.close();
})();
