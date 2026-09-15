import asyncio, re, pathlib, json, posixpath
from playwright.async_api import async_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'qa-results'
OUT.mkdir(exist_ok=True)

def offline_bundle():
    fixture=(ROOT/'qa/visual-smoke.html').read_text()
    entry=re.search(r'<script type="module">(.*?)</script>',fixture,re.S).group(1)
    modules={}
    def convert(code,path):
        def replace(m):
            spec=m.group(2)
            if spec.startswith('.'):
                spec='qa:/'+posixpath.normpath(posixpath.join(posixpath.dirname(path),spec))
            return m.group(1)+spec+m.group(3)
        return re.sub(r"((?:from\s*|import\s*)['\"])([^'\"]+)(['\"])",replace,code)
    for path in (ROOT/'src').rglob('*.js'):
        rel=path.relative_to(ROOT).as_posix()
        modules['qa:/'+rel]=convert(path.read_text(),rel)
    modules['qa:/qa/entry.js']=convert(entry,'qa/entry.js')
    html=re.sub(r'<script type="module">.*?</script>','',fixture,flags=re.S)
    def css(m): return '<style>'+(ROOT/'qa'/m.group(1)).resolve().read_text()+'</style>'
    html=re.sub(r'<link rel="stylesheet" href="([^"]+)">',css,html)
    return html,modules

async def load(page):
    html,modules=offline_bundle()
    await page.set_content(html)
    await page.evaluate('''modules => {
        const imports={};
        for(const [id,code] of Object.entries(modules)) imports[id]=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
        const map=document.createElement('script');map.type='importmap';map.textContent=JSON.stringify({imports});document.head.appendChild(map);
    }''',modules)
    await page.evaluate("import('qa:/qa/entry.js')")
    await page.wait_for_function('window.qaReady === true')
    await page.wait_for_timeout(1400)

async def main():
    checks=[]
    async with async_playwright() as p:
        import os, shutil
        binary=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
        browser=await p.chromium.launch(**({'executable_path':binary} if binary else {}), headless=True)
        page=await browser.new_page(viewport={'width':1440,'height':900},device_scale_factor=1)
        page.set_default_timeout(6000)
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        await load(page)
        assert await page.locator('.player').count()==4
        checks.append('Real GameUI with four players renders without runtime errors')
        await page.screenshot(path=str(OUT/'desktop-dark.png'))
        await page.evaluate("qa.use('huoqiu'); qa.damage('fire'); qa.heal(); qa.secret();")
        await page.wait_for_timeout(280)
        assert await page.locator('.fx-use-card .cf-name').inner_text()=='火球术'
        assert await page.evaluate("getComputedStyle(document.querySelector('.fx-use-token')).getPropertyValue('--accent').trim()")=='#ff994d'
        await page.screenshot(path=str(OUT/'combat-fire.png'))
        checks.append('Card reveal, elemental palette, fire, healing and secrets render together')
        await page.wait_for_timeout(1700)
        assert await page.evaluate('qa.ui.fx.motion.tasks.size===0 && qa.ui.fx.motion.timers.size===0 && qa.ui.fx.particles.frame===null')
        checks.append('Effects finish with zero active tasks, timers or particle frame')
        await page.evaluate("qa.ui.fx.clear(); window.hits=[]; const fx=qa.ui.fx; const impact=fx.impact.bind(fx); fx.impact=(point,info)=>{hits.push(point);impact(point,info);};qa.use('shandianjian');")
        await page.wait_for_timeout(250)
        await page.evaluate("qa.rerender(); document.querySelector('[data-pid=p1]').style.translate='20px 8px';")
        await page.wait_for_timeout(1100)
        assert await page.evaluate("hits.length===1 && Math.abs(hits[0].x-(document.querySelector('[data-pid=p1]').getBoundingClientRect().left+document.querySelector('[data-pid=p1]').getBoundingClientRect().width/2))<1")
        checks.append('Card arrival follows the replacement player node after a full rerender')
        await page.evaluate("qa.ui.fx.clear();qa.damage('thunder');")
        await page.wait_for_timeout(100)
        assert await page.locator('.fx-lightning path').count()==3
        await page.screenshot(path=str(OUT/'combat-thunder.png'))
        await page.wait_for_timeout(1200)
        await page.evaluate("qa.draw();")
        await page.wait_for_timeout(60)
        assert await page.locator('.fx-draw-back').count()==1
        await page.wait_for_timeout(750)
        await page.evaluate("qa.rerender();")
        await page.wait_for_timeout(100)
        assert await page.locator('.fx-draw-back').count()==0
        checks.append('New hand card animates once; rerender does not replay the entrance')
        await page.evaluate("qa.play();qa.damage('fire');qa.secret();")
        await page.locator('.hand-row .card-face.clickable').filter(has_text='冲锋').click()
        await page.locator('.player.selectable[data-pid=p1]').click()
        assert await page.evaluate("qa.ui.targets.includes('p1')")
        await page.get_by_role('button',name=re.compile('^确认目标')).click()
        await page.wait_for_function("qa.move?.type==='play'")
        assert await page.evaluate("qa.move.targets[0]==='p1'")
        checks.append('Real card/target/confirm interaction remains clickable during active effects')
        await page.evaluate("qa.ui.fx.clear();for(let i=0;i<200;i++)qa.damage(i%2?'fire':'thunder');")
        assert await page.evaluate('qa.ui.fx.motion.tasks.size<=64 && qa.ui.fx.particles.items.length<=160')
        await page.wait_for_timeout(1800)
        assert await page.evaluate('qa.ui.fx.motion.tasks.size===0 && qa.ui.fx.motion.timers.size===0 && qa.ui.fx.particles.frame===null')
        checks.append('Burst of 200 damage events stays bounded and returns to idle')
        for mode in ['lite','off','full']:
            await page.locator('.fx-quality').click()
            assert await page.evaluate('qa.ui.fx.mode')==mode
        checks.append('Quality control cycles full/lite/off correctly')
        await page.emulate_media(reduced_motion='reduce')
        await page.wait_for_timeout(80)
        assert await page.evaluate('qa.ui.fx.mode')=='off'
        await page.evaluate("qa.damage('fire');qa.ui.fx.judge(qa.card('tao'),qa.target.name,{sourceCard:qa.card('shandian')});")
        assert await page.locator('.fx-dmg').is_visible()
        assert await page.locator('.fxj-front').is_visible()
        assert await page.locator('.fx-fire-bloom').count()==0
        assert await page.evaluate("document.querySelector('.fxj-flipper').getAnimations().length===0 && qa.ui.fx.particles.frame===null")
        await page.screenshot(path=str(OUT/'reduced-motion.png'))
        checks.append('OS reduced motion stops decoration and flip while retaining numbers and judgment text')
        await page.emulate_media(reduced_motion='no-preference')
        await page.wait_for_timeout(100)
        await page.evaluate("window.savedAnimate=Element.prototype.animate;Element.prototype.animate=undefined;qa.damage('thunder');qa.ui.fx.judge(qa.card('tao'),qa.target.name);")
        assert await page.locator('.fx-dmg').is_visible()
        await page.wait_for_timeout(1600)
        assert await page.evaluate('qa.ui.fx.motion.tasks.size===0')
        await page.evaluate('() => { Element.prototype.animate=window.savedAnimate; }')
        checks.append('Missing Web Animations API falls back to readable effects and cleans up')
        await page.evaluate("document.documentElement.dataset.theme='light';qa.ui.fx.clear();qa.rerender();")
        await page.wait_for_timeout(150)
        await page.screenshot(path=str(OUT/'desktop-light.png'))
        for width,height,name in [(390,844,'mobile-portrait'),(844,390,'mobile-landscape')]:
            await page.set_viewport_size({'width':width,'height':height})
            await page.wait_for_timeout(100)
            await page.evaluate("qa.use('huoqiu');")
            await page.wait_for_timeout(260)
            box=await page.locator('.fx-use-token').bounding_box()
            assert box and box['x']>=-1 and box['x']+box['width']<=width+1 and box['y']>=0
            control=await page.locator('.fx-quality').bounding_box()
            assert control and control['x']>=0 and control['x']+control['width']<=width
            await page.screenshot(path=str(OUT/(name+'.png')))
        checks.append('Portrait and landscape mobile card reveals and quality controls fit viewport')
        await page.evaluate("window.oldFx=qa.ui.fx;qa.damage();qa.destroy();")
        await page.wait_for_timeout(1800)
        assert await page.locator('.fx-root').count()==0
        assert await page.evaluate('oldFx.motion.tasks.size===0 && oldFx.motion.timers.size===0 && oldFx.particles.frame===null')
        checks.append('Leaving a game removes the layer and cancels all managed work')
        assert not errors, errors
        checks.append('No uncaught browser errors throughout the scenario')
        await browser.close()
    result={'passed':len(checks),'failed':0,'checks':checks,'browser':'Chromium','fixture':'actual GameEngine/GameUI, offline ES modules'}
    (OUT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__': asyncio.run(main())
