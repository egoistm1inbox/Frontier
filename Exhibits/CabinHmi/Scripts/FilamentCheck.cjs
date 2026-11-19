// FILAMENT CHECK
// 🧩 Headless proof for the particle showroom: loads each look at a fixed moment (Filament.Seek, time paused), saves a
//    screenshot per look plus variants (smoke rakes, clone dots, digital-twin scan, a palette swap) and reports
//    console errors. Run from a folder with playwright-core and @sparticuz/chromium installed:
//    AWS_EXECUTION_ENV=AWS_Lambda_nodejs20.x node FilamentCheck.cjs <page url> <outdir> [only]
const { chromium } = require('playwright-core');
const Loaded = require('@sparticuz/chromium'), sp = Loaded.default ?? Loaded;
const Shots = [
    { File: 'Filament-1-LightSpeed',   Query: 'look=Streaks&time=3' },
    { File: 'Filament-2a-TwinForming', Query: 'look=Assemble&time=3.2' },
    { File: 'Filament-2b-TwinScan',    Query: 'look=Assemble&time=7.1' },
    { File: 'Filament-2c-TwinRelease', Query: 'look=Assemble&time=11.6' },
    { File: 'Filament-3a-Airflow',     Query: 'look=Airflow&time=6' },
    { File: 'Filament-3b-SmokeRakes',  Query: 'look=Airflow&time=6&variant=1' },
    { File: 'Filament-4-Particular',   Query: 'look=Turbulence&time=7' },
    { File: 'Filament-5a-CloneBars',   Query: 'look=Clones&time=2.2' },
    { File: 'Filament-5b-CloneDots',   Query: 'look=Clones&time=5&variant=1&palette=Rosso' },
    { File: 'Filament-6-Charging',     Query: 'look=Charge&time=12.5' },
];
(async () =>
{
    const [Url, Out, Only] = process.argv.slice(2);
    const Browser = await chromium.launch({ executablePath: await sp.executablePath(), args: [...sp.args, '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'], headless: true });
    const Page = await Browser.newPage({ viewport: { width: 1600, height: 900 } });
    const Errors = [];
    Page.on('pageerror', (E) => Errors.push('PAGEERROR ' + E.message));
    Page.on('console', (M) => { if (M.type() === 'error' || M.type() === 'warning') Errors.push(M.type() + ' ' + M.text().slice(0, 1500)); });
    for (const Shot of Shots.filter((Each) => !Only || Each.File.includes(Only)))
    {
        const Started = Date.now();
        await Page.goto(`${Url}?${Shot.Query}&still=1&capture=1`, { waitUntil: 'load' });
        try { await Page.waitForFunction(() => document.body.classList.contains('Ready'), null, { timeout: 120000 }); }
        catch (Failure) { console.log(Shot.File, 'never ready', JSON.stringify(Errors)); continue; }
        await Page.waitForTimeout(300);
        await Page.screenshot({ path: `${Out}/${Shot.File}.png` });
        console.log(Shot.File, `${((Date.now() - Started) / 1000).toFixed(1)} s`);
    }
    console.log('errors', JSON.stringify(Errors));
    await Browser.close();
})();
