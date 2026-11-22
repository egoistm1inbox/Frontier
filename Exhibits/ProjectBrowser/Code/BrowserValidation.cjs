//============================================================================================================================================
//                                                         BROWSERVALIDATION.CJS
//============================================================================================================================================
// 🧩 Execute real WebGL preview/version/thumbnail interactions and retain screenshots; no native-render claim.
const Fs = require('node:fs');
const Path = require('node:path');
const Assert = require('node:assert/strict');
const Crypto = require('node:crypto');
const ChromiumPackage = require('@sparticuz/chromium');
const Chromium = ChromiumPackage.default;
const {chromium} = require('playwright-core');
const Destination = Path.resolve(__dirname, '..');
const Digest = Text => Crypto.createHash('sha256').update(Text).digest('hex');
const Errors = [];
const Checks = [];
async function Main()
{
    await ChromiumPackage.inflate(Path.resolve(Path.dirname(require.resolve('@sparticuz/chromium')), '../bin/al2023.tar.br'));
    const Browser = await chromium.launch({executablePath:await Chromium.executablePath(),args:[...Chromium.args,'--enable-unsafe-swiftshader'],headless:true,
        env:{...process.env,LD_LIBRARY_PATH:'/tmp/al2023/lib:/tmp:'+(process.env.LD_LIBRARY_PATH || '')}});
    try
    {
        const Page = await Browser.newPage({viewport:{width:1440,height:1000}});
        Page.on('pageerror',Failure=>Errors.push(Failure.message));
        await Page.goto(process.env.PROJECT_BROWSER_URL || 'http://127.0.0.1:8770',{waitUntil:'networkidle'});
        await Page.waitForFunction(()=>document.querySelectorAll('#Cards img[src^="data:image/png"]').length===1,{timeout:20000});
        Assert.equal(await Page.locator('text=A PLACE FOR EVERYTHING YOU MAKE').count(),0);
        Assert.equal(await Page.locator('text=Start with an idea.').count(),0);
        Checks.push('Removed promotional copy; the Default Project thumbnail is a renderer PNG snapshot');
        await Page.screenshot({path:Path.join(Destination,'Images/LibraryOLED.png'),fullPage:true});
        await Page.locator('[data-open="default"]').first().click();
        await Page.waitForFunction(()=>document.querySelector('.render-canvas')?.width>300);
        Assert.equal(await Page.locator('.render-failure').count(),0);
        const Initial = await Page.locator('.render-canvas').evaluate(Canvas=>Canvas.toDataURL());
        const Snapshot = await Page.locator('[data-snapshot="default:0:0"] img').first().getAttribute('src');
        Assert.equal(Initial,Snapshot);
        const Pixels = await Page.locator('.render-canvas').evaluate(Canvas=>{
            const Gl=Canvas.getContext('webgl2');const Samples=new Uint8Array(Canvas.width*Canvas.height*4);Gl.readPixels(0,0,Canvas.width,Canvas.height,Gl.RGBA,Gl.UNSIGNED_BYTE,Samples);
            let Visible=0;for(let Index=0;Index<Samples.length;Index+=4)if(Samples[Index]+Samples[Index+1]+Samples[Index+2]>20)Visible++;
            return {Visible,Total:Canvas.width*Canvas.height};
        });
        Assert(Pixels.Visible>Pixels.Total*.02,'Real studio rasterization must contain visible geometry');
        await Page.screenshot({path:Path.join(Destination,'Images/ProjectRendered.png')});
        Checks.push('Reference EON/GGX studio scene has nonblack rasterized pixels; current preview and thumbnail bytes match');
        await Page.locator('#RenderChannel').selectOption('4');
        const Roughness=await Page.locator('.render-canvas').evaluate(Canvas=>Canvas.toDataURL());
        Assert.notEqual(Digest(Roughness),Digest(Initial));
        await Page.locator('#CaptureThumbnail').click();
        Assert.equal(await Page.locator('[data-snapshot="default:0:0"] img').first().getAttribute('src'),Roughness);
        await Page.locator('#RenderChannel').selectOption('0');
        Checks.push('Surface channel selection changes rasterization; Capture thumbnail uses actual current pixels');
        await Page.locator('[data-tab="history"]').click();
        Assert.equal(await Page.locator('[data-revision]').count(),1,'Default Project shows only its current version');
        Checks.push('History lists the single current version; sample revisions were removed with the sample files');
        await Page.locator('#Back').click();
        await Page.locator('#NewProject').click();
        await Page.locator('#Reader').waitFor({state:'visible'});
        Assert.equal(await Page.locator('#PreviewCanvas canvas').count(),0);
        await Page.locator('#OpenEditor').click();
        Assert.equal(await Page.locator('#LaunchTarget').textContent(),'Frontier');
        await Page.locator('#CloseDialog').click();
        Checks.push('New Project is a blank scene (no geometry) and opens in Frontier only');
        await Page.locator('#Back').click();
        await Page.locator('#Theme').selectOption('light');
        await Page.screenshot({path:Path.join(Destination,'Images/LibraryLight.png'),fullPage:true});
        await Page.setViewportSize({width:390,height:844});
        await Page.screenshot({path:Path.join(Destination,'Images/LibraryNarrow.png'),fullPage:true});
        Assert(await Page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Narrow library must fit viewport');
        await Page.locator('[data-open="default"]').first().click();
        if(await Page.locator('body').evaluate(Surface=>Surface.classList.contains('right-collapsed')))await Page.locator('#Reader [data-collapse="right"]').click();
        await Page.locator('[data-tab="history"]').click();
        await Page.screenshot({path:Path.join(Destination,'Images/ProjectNarrow.png'),fullPage:true});
        Assert(await Page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Narrow reader must fit viewport');
        Checks.push('Light theme and 390px library/reader layouts; no horizontal overflow');
        Assert.deepEqual(Errors,[]);
        const Report={result:'passed',browser:await Browser.version(),renderer:'Chromium WebGL 2 via software SwiftShader; not native Vulkan or hardware GPU execution',checks:Checks,studio_pixels:Pixels,
            current_snapshot_sha256:Digest(Initial),page_errors:Errors,
            source_sha256:Object.fromEntries(['index.html','Styles.css','PanelLayout.css','Browser.js','ReferenceRenderer.js'].map(Name=>[Name,Digest(Fs.readFileSync(Path.resolve('Experimental/Project browser',Name)))]))};
        Fs.writeFileSync(Path.join(Destination,'Results/BrowserChecks.json'),JSON.stringify(Report,null,2)+'\n');
        console.log(JSON.stringify(Report,null,2));
    }
    finally {await Browser.close();}
}
Main().catch(Failure=>{console.error(Failure);process.exitCode=1;});
