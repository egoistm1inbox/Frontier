// FILAMENT EDITOR CHECK
// 🧩 Headless proof for the particle editor: opens the editor on built-in recipes and solo layers at fixed moments
//    (capture=1: no animation loop, one frame per Seek), selects an outliner entry so its inspector page shows, saves a
//    screenshot per case and reports console errors. Also clicks through every outliner row and toggles a layer.
//    AWS_EXECUTION_ENV=AWS_Lambda_nodejs20.x node FilamentEditorCheck.cjs <editor url> <outdir> [only]
const { chromium } = require('playwright-core');
const Loaded = require('@sparticuz/chromium'), sp = Loaded.default ?? Loaded;
const Shots = [
    { File: 'FilamentEditor-1-LaunchRecipe',  Query: 'recipe=Launch&time=9.2&select=Transition' },
    { File: 'FilamentEditor-2-AeroRecipe',    Query: 'recipe=Aero&time=6&select=Airflow' },
    { File: 'FilamentEditor-3-ChargingRecipe', Query: 'recipe=Charging&time=12.5&select=Charge' },
    { File: 'FilamentEditor-4-OrbitGarden',   Query: 'recipe=Reference&time=5&select=Orbits' },
    { File: 'FilamentEditor-5-FibreWaveSolo', Query: 'solo=FibreWave&time=6&select=FibreWave' },
    { File: 'FilamentEditor-6-CameraPage',    Query: 'solo=Turbulence&time=7&select=Camera' },
    { File: 'FilamentEditor-7-RecipePage',    Query: 'recipe=Launch&time=3.4&select=Recipe' },
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
        await Page.goto(`${Url}?${Shot.Query}&fresh=1&capture=1`, { waitUntil: 'load' });
        try { await Page.waitForFunction(() => document.body.classList.contains('Ready'), null, { timeout: 120000 }); }
        catch (Failure) { console.log(Shot.File, 'never ready', JSON.stringify(Errors)); continue; }
        await Page.waitForTimeout(300);
        await Page.screenshot({ path: `${Out}/${Shot.File}.png` });
        console.log(Shot.File, `${((Date.now() - Started) / 1000).toFixed(1)} s`);
    }
    if (!Only)
    {
        // Click every outliner row, toggle the first layer's eye, flip a palette and export a recipe in memory.
        const Rows = await Page.$$('.tree-row .object-button');
        for (const Row of Rows) await Row.click();
        await Page.click('.tree-row .visibility');
        const Report = await Page.evaluate(() =>
        {
            window.FilamentEditor.Select('Layer:Streaks');
            document.querySelector('.palette-chip[data-palette="Ember"]').click();
            window.FilamentEditor.Seek(2);
            const Recipe = window.FilamentEditor.WriteRecipe();
            window.FilamentEditor.ReadRecipe(Recipe, true);
            return { Rows: document.querySelectorAll('.tree-row').length, Cards: document.querySelectorAll('.inspector-content .card').length,
                     Palette: Recipe.Layers[0].Params.Palette, On: Recipe.Layers.filter((Layer) => Layer.Enabled).map((Layer) => Layer.Look) };
        });
        console.log('clicked', Rows.length, 'rows', JSON.stringify(Report));
    }
    console.log('errors', JSON.stringify(Errors));
    await Browser.close();
})();
