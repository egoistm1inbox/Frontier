// ACOUSTICS CHECK
// 🧩 Headless proof for the vehicle sound bench: loads the page, renders the live AudioWorklet through an
//    OfflineAudioContext (levels, NaN count, telemetry), then drives the real-time context (start, launch, shifts,
//    surfaces, cues), then switches to the GT-R NISMO (offline render, launch, ABS stop, kerb, pothole, impact cues) and
//    saves screenshots; then fires the weapons (energy LMG with and without the Turbocharger, SMG, LMG) and bullet cues; then renders and
//    drives the electric cars (Taycan, Next-Gen racer), swaps turbos and superchargers live, plays an aircraft clip, stages and launches the Demon on its TransBrake and times turbo lag at three settings, drives the 918 Spyder, Agera R, Mustang GT, Shelby GT350, Mustang GT3 and Ligier JS P320, measures the road layer at full, default and off, flips the road-noise switch
//    (hook and M key), plays the factory and sparks/electronics pads, fires the eight Follow-up 19 guns and plays the War pads. Run from a folder with playwright-core and @sparticuz/chromium installed:
//    AWS_EXECUTION_ENV=AWS_Lambda_nodejs20.x node AcousticsCheck.cjs <url> <outdir>
const { chromium } = require('playwright-core');
const Loaded = require('@sparticuz/chromium'), sp = Loaded.default ?? Loaded;   // newer releases export default; older ones a class with static methods
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
    // Shells: spent casings falling (pads ring while they play), and the reel serves the three shell clips.
    await Page.evaluate(() => { Bench.Cue('ShellsBrassRain'); Bench.Cue('ShellsSteel'); Bench.Cue('ShellsTank'); });
    await Page.waitForTimeout(900);
    await Page.evaluate(() => document.querySelector('#PadsShells').scrollIntoView({ block: 'center' }));
    console.log('shells ringing', JSON.stringify(await Page.evaluate(() => [...document.querySelectorAll('#PadsShells .Pad.Ring')].map((Pad) => Pad.dataset.cue))), 'pads', await Page.evaluate(() => document.querySelectorAll('#PadsShells .Pad').length));
    await Page.screenshot({ path: `${Out}/Acoustics-9-Shells.png`, timeout: 120000 });
    console.log('shell clips', JSON.stringify(await Page.evaluate(async () => Promise.all(['Shells-Floors', 'Shells-Calibres', 'Shells-BrassRain'].map(async (Name) => (await fetch(`../../../Exhibits/CabinHmi/Audio/${Name}.mp3`)).status)))));
    // Power: offline renders of the electric cars and an inducer through the real worklet, then live driving.
    // Electric cars start in 1st (a car in neutral is silent); combustion cars rev in neutral onto the limiter.
    for (const [Car, Inducer, Gear] of [['TaycanTurboS', null, 1], ['NextGenRacer', null, 1], ['GtrNismo', 'Roots', 0], ['LaFerrari', 'BigSingle', 0]])
        console.log('offline power', Car, Inducer, JSON.stringify(await Page.evaluate(([C, I, G]) => Bench.RenderOffline(4, C, I, G).then((R) => ({ Peak: R.Peak, Rms: R.Rms, NonFinite: R.NonFinite, Rpm: Math.round(R.Telemetry?.Rpm ?? 0), Kmh: Math.round(R.Telemetry?.Kmh ?? 0), Gear: R.Telemetry?.Gear })), [Car, Inducer, Gear])));
    await Page.evaluate(() => Bench.Car('TaycanTurboS'));
    await Page.evaluate(() => Bench.Command('Start'));
    await Page.waitForTimeout(900);
    await Page.evaluate(() => { Bench.Command('ShiftUp'); Bench.Hold('Throttle', 1); });
    await Page.waitForTimeout(4200);
    console.log('taycan live', JSON.stringify(await Page.evaluate(() => { const R = Bench.Readout(); return { Car: R.Car, Kmh: Math.round(R.Kmh), Gear: R.Gear, Rpm: Math.round(R.Rpm), Motors: R.Motors, Motor: +R.Motor.toFixed(2) }; })));
    await Page.evaluate(() => { Bench.Hold('Throttle', 0); Bench.Hold('Brake', 0.6); });
    await Page.waitForTimeout(1500);
    console.log('taycan regen', JSON.stringify(await Page.evaluate(() => { const R = Bench.Readout(); return { Kmh: Math.round(R.Kmh), Gear: R.Gear, Motor: +R.Motor.toFixed(2) }; })));
    await Page.evaluate(() => { Bench.Hold('Brake', null); Bench.Hold('Throttle', null); Bench.Sport(true); Bench.Car('NextGenRacer'); });
    await Page.evaluate(() => Bench.Command('Start'));
    await Page.waitForTimeout(900);
    await Page.evaluate(() => { Bench.Command('ShiftUp'); Bench.Hold('Throttle', 1); });
    await Page.waitForTimeout(5000);
    console.log('next-gen live', JSON.stringify(await Page.evaluate(() => { const R = Bench.Readout(); return { Car: R.Car, Kmh: Math.round(R.Kmh), Gear: R.Gear, Rpm: Math.round(R.Rpm) }; })));
    await Page.evaluate(() => { Bench.Hold('Throttle', null); Bench.Induction('TwinScrew'); });
    await Page.waitForTimeout(600);
    await Page.evaluate(() => Bench.Command('Start'));
    await Page.waitForTimeout(2000);
    await Page.evaluate(() => { Bench.Command('ShiftUp'); Bench.Hold('Throttle', 1); });
    await Page.waitForTimeout(3000);
    await Page.evaluate(() => Bench.Induction('Flutter'));
    await Page.waitForTimeout(1500);
    console.log('induction live', JSON.stringify(await Page.evaluate(() => { const R = Bench.Readout(); return { Car: R.Car, Induction: R.Induction, Kmh: Math.round(R.Kmh), Gear: R.Gear, Rpm: Math.round(R.Rpm), Boost: +R.Boost.toFixed(2), Spec: document.querySelector('#BrandSpec').textContent }; })));
    await Page.evaluate(() => Bench.Hold('Throttle', 0));
    await Page.waitForTimeout(800);
    await Page.evaluate(() => Bench.Hold('Throttle', null));
    console.log('fly', await Page.evaluate(() => Bench.Fly('RacerFlyover')));
    console.log('power pads', await Page.evaluate(() => document.querySelectorAll('#PadsInduction .Pad').length), await Page.evaluate(() => document.querySelectorAll('#PadsElectric .Pad').length));
    // Demon: stock blower voice through the real worklet, TransBrake staging and launch, then turbo lag timed live.
    console.log('build tag', await Page.evaluate(() => document.querySelector('#Build')?.textContent));
    console.log('offline demon', JSON.stringify(await Page.evaluate(() => Bench.RenderOffline(4, 'Demon', null, 0).then((R) => ({ Peak: R.Peak, Rms: R.Rms, NonFinite: R.NonFinite, Rpm: Math.round(R.Telemetry?.Rpm ?? 0) })))));
    await Page.evaluate(() => { Bench.Induction(null); return Bench.Car('Demon'); });
    await Page.evaluate(() => Bench.Command('Start'));
    await Page.waitForTimeout(2200);
    await Page.evaluate(() => { Bench.TransBrake(true); Bench.Command('ShiftUp'); Bench.Hold('Throttle', 1); });
    await Page.waitForTimeout(1800);
    console.log('demon staged', JSON.stringify(await Page.evaluate(() => { const R = Bench.Readout(); return { Car: R.Car, Stock: R.Stock, Kmh: Math.round(R.Kmh), Gear: R.Gear, Rpm: Math.round(R.Rpm), Boost: +R.Boost.toFixed(2), Spec: document.querySelector('#BrandSpec').textContent }; })));
    await Page.evaluate(() => Bench.TransBrake(false));
    await Page.waitForTimeout(2500);
    console.log('demon launched', JSON.stringify(await Page.evaluate(() => { const R = Bench.Readout(); return { Kmh: Math.round(R.Kmh), Gear: R.Gear, Rpm: Math.round(R.Rpm), Boost: +R.Boost.toFixed(2), Spool: document.querySelector('#SpoolTime').textContent }; })));
    for (const Lag of [0, 1, 2.5])
    {
        await Page.evaluate((L) => { Bench.Hold('Throttle', 0); Bench.Lag(L); return Bench.Induction('BigSingle'); }, Lag);
        await Page.waitForTimeout(1800);
        await Page.evaluate(() => Bench.Command('Neutral'));
        await Page.evaluate(() => Bench.Hold('Throttle', 1));
        await Page.waitForTimeout(3500);
        console.log('lag', Lag, JSON.stringify(await Page.evaluate(() => ({ Rpm: Math.round(Bench.Readout().Rpm), Boost: +Bench.Readout().Boost.toFixed(2), Spool: document.querySelector('#SpoolTime').textContent, Shown: document.querySelector('#LagShown').textContent }))));
    }
    await Page.evaluate(() => { Bench.Hold('Throttle', null); Bench.Lag(1); });
    // 918 Spyder (hybrid: both motors under the V8), Agera RS (twin turbo), and Follow-up 18's three Mustangs and the
    // Ligier JS P320: offline renders and a live pull in 2nd.
    for (const Car of ['Spyder918', 'AgeraRs', 'MustangGt', 'Gt350', 'MustangGt3', 'LigierJsP320'])
    {
        console.log('offline', Car, JSON.stringify(await Page.evaluate((C) => Bench.RenderOffline(4, C, null, 0).then((R) => ({ Peak: R.Peak, Rms: R.Rms, NonFinite: R.NonFinite, Rpm: Math.round(R.Telemetry?.Rpm ?? 0) })), Car)));
        await Page.evaluate((C) => { Bench.Induction(null); return Bench.Car(C); }, Car);
        await Page.evaluate(() => Bench.Command('Start'));
        await Page.waitForTimeout(2000);
        await Page.evaluate(() => { Bench.Command('ShiftUp'); Bench.Hold('Throttle', 1); });
        await Page.waitForTimeout(3000);
        console.log('live', Car, JSON.stringify(await Page.evaluate(() => { const R = Bench.Readout(); return { Car: R.Car, Kmh: Math.round(R.Kmh), Gear: R.Gear, Rpm: Math.round(R.Rpm), Motor: +(R.Motor ?? 0).toFixed(2), Boost: +(R.Boost ?? 0).toFixed(2), Chip: document.querySelector('#ChipKers').textContent, Spec: document.querySelector('#BrandSpec').textContent }; })));
        await Page.evaluate(() => Bench.Hold('Throttle', null));
    }
    // Road noise: the road layer alone (engine, tyres, chassis muted) at 100 %, the bench default and switched off;
    // then the live switch through the hook and the M key; then the factory and sparks/electronics pads.
    const Solo = { Engine: 0, Tyres: 0, Chassis: 0 };
    for (const [Label, Mix] of [['road 100 wind 100', { ...Solo, Road: 1, Wind: 1 }], ['road 40 wind 80 (default)', { ...Solo, Road: 0.4, Wind: 0.8 }], ['road off wind 80', { ...Solo, Road: 0, Wind: 0.8 }]])
        console.log('road layer', Label, JSON.stringify(await Page.evaluate((M) => Bench.RenderOffline(6, 'AgeraRs', null, 2, M).then((R) => ({ Rms: R.Rms, Peak: R.Peak, NonFinite: R.NonFinite, Kmh: Math.round(R.Telemetry?.Kmh ?? 0) })), Mix)));
    console.log('mix default', JSON.stringify(await Page.evaluate(() => Bench.Levels())));
    await Page.evaluate(() => Bench.RoadNoise(false));
    console.log('road switched off', JSON.stringify(await Page.evaluate(() => ({ ...Bench.Levels(), Switch: document.querySelector('#RoadNoise b').textContent, Muted: document.querySelector('[data-mix="Road"]').classList.contains('Muted') }))));
    await Page.keyboard.press('KeyM');
    await Page.waitForTimeout(200);
    console.log('M key', JSON.stringify(await Page.evaluate(() => ({ ...Bench.Levels(), Switch: document.querySelector('#RoadNoise b').textContent }))));
    await Page.evaluate(() => Bench.Mix('Wind', 0.3));
    console.log('wind slider', JSON.stringify(await Page.evaluate(() => ({ Wind: Bench.Levels().Wind, Shown: document.querySelector('[data-mix="Wind"] output').textContent }))));
    await Page.evaluate(() => Bench.Mix('Wind', 0.8));
    console.log('factory pads', await Page.evaluate(() => document.querySelectorAll('#PadsFactory .Pad').length), 'sparks pads', await Page.evaluate(() => document.querySelectorAll('#PadsSparks .Pad').length));
    await Page.evaluate(() => Promise.all(['Conveyor', 'Grinder', 'SparkShower', 'RelayClicks', 'BeamCreak'].map((Name) => Bench.Cue(Name))));
    await Page.waitForTimeout(300);
    console.log('factory playing', JSON.stringify(await Page.evaluate(() => ({ Looping: [...document.querySelectorAll('#PadsFactory .Pad.Looping, #PadsSparks .Pad.Looping')].map((Pad) => Pad.dataset.cue), Ringing: [...document.querySelectorAll('#PadsFactory .Pad.Ring, #PadsSparks .Pad.Ring')].map((Pad) => Pad.dataset.cue) }))));
    await Page.evaluate(() => document.querySelector('#PadsFactory').scrollIntoView({ block: 'center' }));
    await Page.screenshot({ path: `${Out}/Acoustics-10-Factory.png`, timeout: 120000, animations: 'disabled' });
    await Page.evaluate(() => Bench.Cue('Conveyor'));
    console.log('conveyor toggled off', await Page.evaluate(() => !document.querySelector('[data-cue="Conveyor"]').classList.contains('Looping')));
    // Follow-up 19: the eight new guns fire on the hold-to-fire trigger, and the War shelf's pads render and play.
    for (const [Gun, Hold] of [['Fifty', 1], ['Ak47', 1], ['M4', 1], ['Minigun', 1.2], ['Mg42', 1], ['Shotgun', 1.6], ['Pistol', 1], ['AntiMateriel', 1]])
        console.log('fire', Gun, JSON.stringify(await Page.evaluate(([Name, Seconds]) => Bench.Fire(Name, Seconds), [Gun, Hold])));
    console.log('weapon pads', await Page.evaluate(() => document.querySelectorAll('#PadsWeapons [data-weapon]').length), 'war pads', await Page.evaluate(() => [...document.querySelectorAll('#PadsWar .Pad')].map((Pad) => Pad.dataset.cue).join(',')));
    const WarStart = Date.now();
    await Page.evaluate(() => Promise.all(['SandBlast', 'MortarIncoming', 'Grenade', 'Helicopter', 'AirRaidSiren', 'TankDriveBy', 'Deafened', 'Battlefield'].map((Name) => Bench.Cue(Name))));
    console.log('war cues rendered and started in', Date.now() - WarStart, 'ms');
    await Page.evaluate(() => document.querySelector('#PadsWar').scrollIntoView({ block: 'center' }));
    await Page.screenshot({ path: `${Out}/Acoustics-12-War.png`, timeout: 120000, animations: 'disabled' });
    await Page.evaluate(() => document.querySelector('#Mix').scrollIntoView({ block: 'center' }));
    await Page.screenshot({ path: `${Out}/Acoustics-11-Mix.png`, timeout: 120000, animations: 'disabled' });
    await Page.evaluate(() => Bench.Induction('TwinScrew'));
    await Page.evaluate(() => document.querySelector('#PadsInduction').scrollIntoView({ block: 'center' }));
    await Page.waitForTimeout(1500);
    await Page.screenshot({ path: `${Out}/Acoustics-8-Power.png`, timeout: 120000, animations: 'disabled' });
    console.log('errors', JSON.stringify(Errors));
    await Browser.close();
})();
