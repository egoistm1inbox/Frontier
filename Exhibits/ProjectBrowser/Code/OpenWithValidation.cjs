//============================================================================================================================================
//                                                         OPENWITHVALIDATION.CJS
//============================================================================================================================================
// 🧩 Frontier / SolidArc "Open with" choices (cards, reader switch, inspector card, library defaults) and the lit sky / sand studio render.
const Fs = require('node:fs');
const Path = require('node:path');
const Assert = require('node:assert/strict');
const ChromiumPackage = require('@sparticuz/chromium');
const Chromium = ChromiumPackage.default;
const {chromium} = require('playwright-core');
const Destination = Path.resolve(__dirname, '..');
const Errors = [];
const Checks = [];
async function Main()
{
    await ChromiumPackage.inflate(Path.resolve(Path.dirname(require.resolve('@sparticuz/chromium')), '../bin/al2023.tar.br'));
    const Browser = await chromium.launch({executablePath:await Chromium.executablePath(),args:[...Chromium.args,'--enable-unsafe-swiftshader'],headless:true,
        env:{...process.env,LD_LIBRARY_PATH:'/tmp/al2023/lib:/tmp:'+(process.env.LD_LIBRARY_PATH || '')}});
    try
    {
        const Page = await Browser.newPage({viewport:{width:1600,height:950}});
        Page.on('pageerror',Failure=>Errors.push(Failure.message));
        const Address = process.env.PROJECT_BROWSER_URL || 'http://127.0.0.1:8770';
        await Page.goto(Address); await Page.evaluate(()=>localStorage.clear()); await Page.goto(Address,{waitUntil:'networkidle'});
        await Page.waitForFunction(()=>document.querySelectorAll('#Cards img[src^="data:image/png"]').length===1,{timeout:20000});

        Assert.equal(await Page.locator('.card-open [data-launch]').count(),2,'Each card offers Frontier and SolidArc');
        Assert.equal(await Page.locator('.card-open .preferred').getAttribute('data-launch'),'frontier','Projects default to Frontier');
        await Page.locator('.card-open [data-launch="solidarc"]').click();
        Assert.equal(await Page.locator('#LaunchTarget').textContent(),'SolidArc');
        Assert.equal(await Page.locator('#LaunchMark').getAttribute('data-application'),'solidarc');
        await Page.locator('#CloseDialog').click();
        Checks.push('Library cards launch Frontier or SolidArc directly; projects prefer Frontier');

        Assert.equal(await Page.locator('#LibraryOpenWith .ow-format').count(),3,'Library inspector lists Projects, CAD and Geometry defaults');
        Assert.equal(await Page.locator('#LibraryOpenWith [data-category="cad"].on').getAttribute('data-application'),'solidarc');
        await Page.locator('#LibraryOpenWith [data-category="project"][data-application="solidarc"]').click();
        Assert.equal(await Page.locator('.card-open .preferred').getAttribute('data-launch'),'solidarc','Card follows the Projects default');
        Assert.equal(await Page.evaluate(()=>JSON.parse(localStorage.getItem('frontier.browser.openWith')).project),'solidarc');
        await Page.locator('#LibraryOpenWith [data-category="project"][data-application="frontier"]').click();
        Checks.push('Format defaults persist and drive the card preference');

        await Page.locator('[data-open="default"]').first().click();
        await Page.waitForFunction(()=>document.querySelector('.render-canvas')?.width>300);
        Assert.equal(await Page.locator('#OpenEditorLabel').textContent(),'Open in Frontier');
        await Page.locator('#InspectorContent [data-application="solidarc"]').click();
        Assert.equal(await Page.locator('#OpenEditorLabel').textContent(),'Open in SolidArc');
        Assert.equal(await Page.locator('.ow-hero').getAttribute('data-application-shown'),'solidarc');
        Assert.equal(await Page.locator('#OpenAppSwitch [aria-checked="true"]').getAttribute('data-application'),'solidarc');
        await Page.locator('#OpenEditor').click();
        Assert.equal(await Page.locator('#LaunchTarget').textContent(),'SolidArc');
        await Page.locator('#CloseDialog').click();
        await Page.locator('#OpenAppSwitch [data-application="frontier"]').click();
        await Page.locator('[data-launch-selected]').click();
        Assert.equal(await Page.locator('#LaunchTarget').textContent(),'Frontier');
        await Page.locator('#CloseDialog').click();
        Checks.push('Reader switch, inspector Open with card and header button agree on Frontier / SolidArc');

        const Studio = await Page.locator('.render-canvas').evaluate(Canvas=>{
            const Gl=Canvas.getContext('webgl2');const Width=Canvas.width,Height=Canvas.height;const Row=new Uint8Array(Width*4);
            Gl.readPixels(0,Height-3,Width,1,Gl.RGBA,Gl.UNSIGNED_BYTE,Row);
            let Top=[0,0,0];for(let Index=0;Index<Row.length;Index+=4)for(let Channel=0;Channel<3;Channel++)Top[Channel]+=Row[Index+Channel]/Width;
            return {Top:Top.map(Level=>Math.round(Level))};
        });
        Assert(Studio.Top.every(Level=>Level>60),'Lit view has a sky / sand backdrop instead of a black void');
        await Page.locator('#RenderChannel').selectOption('5');
        const Drafting = await Page.locator('.render-canvas').evaluate(Canvas=>{const Gl=Canvas.getContext('webgl2');const Pixel=new Uint8Array(4);Gl.readPixels(2,Canvas.height-3,1,1,Gl.RGBA,Gl.UNSIGNED_BYTE,Pixel);return [...Pixel.slice(0,3)];});
        Assert(Drafting.every(Level=>Level<20),'CAD contours keep the black drafting ground');
        await Page.locator('#RenderChannel').selectOption('0');
        Checks.push('Lit render draws the sky / sand backdrop; CAD contour view stays black');

        Assert.deepEqual(Errors,[]);
        const Report={result:'passed',browser:await Browser.version(),checks:Checks,studio_top_row:Studio.Top,page_errors:Errors};
        Fs.mkdirSync(Path.join(Destination,'Results'),{recursive:true});
        Fs.writeFileSync(Path.join(Destination,'Results/OpenWithChecks.json'),JSON.stringify(Report,null,2)+'\n');
        console.log(JSON.stringify(Report,null,2));
    }
    finally {await Browser.close();}
}
Main().catch(Failure=>{console.error(Failure);process.exitCode=1;});
