//============================================================================================================================================
//                                                     CATALOGUELOADINGVALIDATION.CJS
//============================================================================================================================================
// 🧩 Verify cache-separated prototype assets and visible catalogue entries at the embedded preview width.
const Fs = require('node:fs');
const Path = require('node:path');
const Assert = require('node:assert/strict');
const Crypto = require('node:crypto');
const ChromiumPackage = process.env.CHROMIUM_PATH ? null : require('@sparticuz/chromium');
const {chromium} = require('playwright-core');
const Destination = Path.resolve(__dirname, '..');
async function Main()
{
    if (ChromiumPackage)
        await ChromiumPackage.inflate(Path.resolve(Path.dirname(require.resolve('@sparticuz/chromium')), '../bin/al2023.tar.br'));
    const Browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || await ChromiumPackage.default.executablePath(),
        args:ChromiumPackage ? [...ChromiumPackage.default.args,'--enable-unsafe-swiftshader'] :
            ['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader'],headless:true,
        env:{...process.env,LD_LIBRARY_PATH:process.env.CHROMIUM_LIBRARY_PATH || '/tmp/al2023/lib:/tmp:'+(process.env.LD_LIBRARY_PATH || '')}});
    try
    {
        const Page = await Browser.newPage({viewport:{width:890,height:800}});
        Page.setDefaultTimeout(5000);
        const Errors = [], Requests = [];
        Page.on('pageerror',Failure=>Errors.push(Failure.message));
        Page.on('request',Request=>Requests.push(Request.url()));
        // An old unversioned script must never be selected by the corrected document.
        await Page.route('**/Browser.js',Route=>Route.fulfill({contentType:'text/javascript',body:'throw new Error("Old cached script selected");'}));
        await Page.goto(process.env.PROJECT_BROWSER_URL || 'http://127.0.0.1:8770',{waitUntil:'networkidle'});
        for(const Name of ['Styles.css','PanelLayout.css','ReferenceRenderer.js','Browser.js'])
        {
            const Digest=Crypto.createHash('sha256').update(Fs.readFileSync(Path.resolve('Experimental/Project browser',Name))).digest('hex').slice(0,12);
            Assert(Requests.some(Address=>Address.endsWith('/'+Name+'?v='+Digest)),Name+' must request its current content revision');
        }
        // Default Project only (Project Zero specification §14): one rendered card, no sample files.
        await Page.waitForFunction(()=>document.querySelectorAll('#Cards img[src^="data:image/png"]').length===1);
        Assert.equal(await Page.locator('#Cards .file-card').count(),1);
        Assert.equal(await Page.locator('#CollectionCount').textContent(),'1 project');
        for(const Removed of ['valley','mount','stone','island','bracket','faceted'])Assert.equal(await Page.locator('[data-open="'+Removed+'"]').count(),0,Removed+' sample must be gone');
        Assert.equal(await Page.locator('text=/Cornell/i').count(),0);
        const VisibleCards=await Page.locator('#Cards .file-card').evaluateAll(Cards=>Cards.filter(Card=>{
            const Rectangle=Card.getBoundingClientRect();
            return Rectangle.width>0 && Rectangle.height>0 && Rectangle.top<innerHeight && Rectangle.bottom>0;
        }).length);
        Assert(VisibleCards===1,'The Default Project card must be visible, not only counted');
        await Page.screenshot({path:Path.join(Destination,'Images/CatalogueEmbedded.png')});
        await Page.locator('#Cards [data-open="default"]').first().click();
        await Assert.doesNotReject(()=>Page.locator('#Reader').waitFor({state:'visible'}));
        Assert.equal(await Page.locator('#ReaderName').textContent(),'Default Project.projectspace');
        await Page.locator('#OpenEditor').click();
        Assert.equal(await Page.locator('#LaunchTarget').textContent(),'Frontier');
        await Page.locator('#CloseDialog').click();
        await Page.locator('#Back').click();
        // + New Project: a blank scene that opens in Frontier only.
        await Page.locator('#NewProject').click();
        await Page.locator('#Reader').waitFor({state:'visible'});
        Assert.match(await Page.locator('#PreviewCanvas').innerText(),/Blank scene/);
        Assert.equal(await Page.locator('#PreviewCanvas canvas').count(),0,'A blank project draws no sample geometry');
        await Page.locator('#OpenEditor').click();
        Assert.equal(await Page.locator('#LaunchTarget').textContent(),'Frontier');
        Assert.match(await Page.locator('#LaunchDescription').textContent(),/No other workspace/);
        await Page.locator('#CloseDialog').click();
        await Page.locator('#Back').click();
        Assert.equal(await Page.locator('#Cards .file-card').count(),2);
        await Page.locator('[data-filter="cad"]').click();
        Assert.equal(await Page.locator('#Cards .file-card').count(),0);
        await Page.locator('[data-filter="all"]').click();
        await Page.reload({waitUntil:'networkidle'});
        Assert.equal(await Page.locator('#Cards .file-card').count(),1,'New projects last for the session only');
        Assert.deepEqual(Errors,[]);
        const Report={result:'passed',viewport:{width:890,height:800},visible_cards:VisibleCards,total_cards:1,
            checks:['Content-hashed asset URLs bypass old unversioned scripts','Default Project is the only card; the six sample files are gone',
                'Default Project and a new blank project both open in Frontier only','New Project adds a blank scene with no sample geometry',
                'CAD filter is empty; reload returns to the Default Project only'],page_errors:Errors};
        Fs.writeFileSync(Path.join(Destination,'Results/CatalogueLoadingChecks.json'),JSON.stringify(Report,null,2)+'\n');
        console.log(JSON.stringify(Report,null,2));
    }
    finally {await Browser.close();}
}
Main().catch(Failure=>{console.error(Failure);process.exitCode=1;});
