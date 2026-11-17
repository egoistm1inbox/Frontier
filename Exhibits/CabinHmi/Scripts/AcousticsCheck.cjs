// ACOUSTICS CHECK
// 🧩 Headless proof for the vehicle sound bench: loads the page, renders the live AudioWorklet through an
//    OfflineAudioContext (levels, NaN count, telemetry), then drives the real-time context (start, launch, shifts,
//    surfaces, cues), then switches to the GT-R NISMO (offline render, launch, ABS stop, kerb, pothole, impact cues) and
//    saves screenshots; then fires the weapons (energy LMG with and without the Turbocharger, SMG, LMG) and bullet cues. Run from a folder with playwright-core and @sparticuz/chromium installed:
//    AWS_EXECUTION_ENV=AWS_Lambda_nodejs20.x node AcousticsCheck.cjs <url> <outdir>
const { chromium } = require('playwright-core');
const sp = require('@sparticuz/chromium');
(async () =>
{
    const [Url, Out] = process.argv.slice(2);
    const Browser = await chromium.launch({ executablePath: await sp.executablePath(), args: [...sp.args, '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'], headless: true });
    const Page = await Browser.newPage({ viewport: { width: 1640, height: 1180 } });
    const Errors = [];
    Page.on('pageerror', (E) => Errors.push('PAGEERROR ' + E.message));
    Page.on('console', (M) => { if (M.type() === 'error') Errors.push(M.text()); });
    await Page.goto(Url, { waitUntil: 'load' });
    await Page.waitForTimeout(800);
    const Offline = await Page.evaluate(() => Bench.RenderOffline(6));
    console.log('offline', JSON.stringify(Offline));
    await Page.evaluate(() => Bench.Wake());
    const WakeLabel = await Page.evaluate(() => document.getElementById('Wake').textContent);
    console.log('wake', JSON.stringify(WakeLabel));
    await Page.screenshot({ path: `${Out}/Acoustics-1-Bench.png` });
    await Page.evaluate(() => Bench.Command('Start'));
    await Page.waitForTimeout(3500);
    console.log('idle', JSON.stringify(await Page.evaluate(() => Bench.Readout())));
    await Page.evaluate(() => { Bench.Command('ShiftUp'); Bench.Hold('Throttle', 1); });
    await Page.waitForTimeout(4200);
    const Pull = await Page.evaluate(() => Bench.Readout());
    console.log('pull', JSON.stringify(Pull));
    await Page.screenshot({ path: `${Out}/Acoustics-2-Launch.png` });
    await Page.evaluate(() => { Bench.Hold('Throttle', 0.3); Bench.Hold('Steer', 0.7); Bench.Surface('Gravel'); document.getElementById('Pickup').click(); Bench.Cue('Indicator'); Bench.Cue('XenonIgnite'); });
    await Page.waitForTimeout(1500);
    console.log('corner', JSON.stringify(await Page.evaluate(() => Bench.Readout())));
    await Page.screenshot({ path: `${Out}/Acoustics-3-GravelCabin.png` });
    await Page.evaluate(() => { Bench.Hold('Steer', 0); Bench.Hold('Throttle', 0); Bench.Hold('Brake', 1); Bench.Cue('DoorClose'); });
    await Page.waitForTimeout(2500);
    console.log('brake', JSON.stringify(await Page.evaluate(() => Bench.Readout())));
    // GT-R NISMO: offline proof first (should end on the 7100 limiter), then live.
    const GtrOffline = await Page.evaluate(() => Bench.RenderOffline(6, 'GtrNismo'));
    console.log('gtr offline', JSON.stringify(GtrOffline));
    await Page.evaluate(() => { Bench.Hold('Brake', 0); Bench.Hold('Throttle', null); Bench.Surface('Asphalt'); document.getElementById('Pickup').click(); return Bench.Car('GtrNismo'); });
    await Page.evaluate(() => Bench.Command('Start'));
    await Page.waitForTimeout(3000);
    console.log('gtr idle', JSON.stringify(await Page.evaluate(() => Bench.Readout())));
    await Page.evaluate(() => { Bench.Command('ShiftUp'); Bench.Hold('Throttle', 1); });
    await Page.waitForTimeout(4500);
    console.log('gtr pull', JSON.stringify(await Page.evaluate(() => Bench.Readout())));
    await Page.screenshot({ path: `${Out}/Acoustics-4-GtrPull.png` });
    await Page.evaluate(() => { Bench.Hold('Throttle', 0); Bench.Hold('Brake', 1); Bench.Kick('Kerb'); });
    await Page.waitForTimeout(700);
    console.log('gtr abs', JSON.stringify(await Page.evaluate(() => Bench.Readout())));
    await Page.screenshot({ path: `${Out}/Acoustics-5-GtrAbs.png` });
    await Page.evaluate(() => { Bench.Hold('Brake', 0); Bench.Kick('Pothole'); Bench.Cue('Explosion'); Bench.Cue('WindowShatter'); Bench.Cue('MetalCrash'); });
    await Page.waitForTimeout(1200);
    const Ringing = await Page.evaluate(() => [...document.querySelectorAll('#PadsImpacts .Pad.Ring')].map((Pad) => Pad.dataset.cue));
    console.log('impacts ringing', JSON.stringify(Ringing), 'pads', await Page.evaluate(() => document.querySelectorAll('#PadsImpacts .Pad').length));
    await Page.evaluate(() => document.querySelector('#PadsImpacts').scrollIntoView({ block: 'center' }));
    await Page.screenshot({ path: `${Out}/Acoustics-6-Impacts.png` });
    // Weapons: hold-to-fire on the audio clock. Same 1.75 s hold without and with the Turbocharger, then an SMG second.
    await Page.evaluate(() => Bench.Command('Start'));
    console.log('fire energy lmg', JSON.stringify(await Page.evaluate(() => Bench.Fire('EnergyLmg', 1.75))));
    await Page.waitForTimeout(1200);
    await Page.evaluate(() => Bench.Turbo(true));
    const Firing = Page.evaluate(() => Bench.Fire('EnergyLmg', 1.75));
    await Page.waitForTimeout(900);
    await Page.evaluate(() => document.querySelector('#PadsWeapons').scrollIntoView({ block: 'center' }));
    await Page.screenshot({ path: `${Out}/Acoustics-7-Weapons.png` });
    console.log('fire energy lmg + turbo', JSON.stringify(await Firing));
    await Page.waitForTimeout(800);
    console.log('fire smg', JSON.stringify(await Page.evaluate(() => Bench.Fire('Smg', 1))));
    console.log('fire lmg full belt cap', JSON.stringify(await Page.evaluate(() => Bench.Fire('Lmg', 0.5))));
    await Page.evaluate(() => { Bench.Cue('Sniper'); Bench.Cue('Supersonic'); Bench.Cue('HitWater'); Bench.Cue('HitMetal'); });
    await Page.waitForTimeout(1500);
    console.log('bullet pads', await Page.evaluate(() => document.querySelectorAll('#PadsBullets .Pad').length), 'weapon pads', await Page.evaluate(() => document.querySelectorAll('#PadsWeapons .Pad').length));
    console.log('errors', JSON.stringify(Errors));
    await Browser.close();
})();
