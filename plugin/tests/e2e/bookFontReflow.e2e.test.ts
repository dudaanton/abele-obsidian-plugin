/** Real vault font bytes arriving after initial layout must not leave fallback-font marks. */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  runCli,
} from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { buildJustifiedEpub } from '../fixtures/books/justifiedBook'
import { aliasTrueTypeFont } from '../helpers/tinyFont'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample font reflow'
const BOOK = `${DIR}/sample-book.epub`
const SHOTS = shotDir('abele-font-reflow')
// Supplied by the host, also for phone runs. Font binaries never enter the repository.
const FONT =
  process.env.ABELE_TEST_FONT_FILE ?? '/System/Library/Fonts/Supplemental/Times New Roman.ttf'
type Check = {
  name: string
  words: number[][]
  highlight: number[][]
  search: number[][]
  query: number[][]
}
type Report = { error?: string; checks: Check[]; family: string; loaded: number; columns: number }

describe.skipIf(!available)('late real vault font', () => {
  let reader: unknown
  let eink: unknown
  let panels: boolean[]
  let places: { path: string; text: string | null }
  beforeAll(() => {
    reader = evalJson('window.__abeleTest.AbeleConfig.getInstance().reader')
    eink = evalJson('window.__abeleTest.reader.eink.state()')
    panels = evalJson(
      `(() => { const w=app.workspace,p=[w.leftSplit.collapsed,w.rightSplit.collapsed];w.leftSplit.collapse();w.rightSplit.collapse();return p })()`
    )
    places = JSON.parse(
      evalRaw(
        `(async()=>{const path=window.__abeleTest.AbeleConfig.getInstance().reader.placesPath||'abele-book-places.json';return JSON.stringify({path,text:await app.vault.adapter.exists(path)?await app.vault.adapter.read(path):null})})()`
      )
    )
    if (!onPhone())
      runCli([
        'dev:cdp',
        'method=Emulation.setDeviceMetricsOverride',
        'params={"width":960,"height":1280,"deviceScaleFactor":1,"mobile":false}',
      ])
    evalRaw(
      `(async()=>{await app.vault.createFolder(${JSON.stringify(`${DIR}/Fonts`)});return 'ok'})()`
    )
    // Keep each CLI/phone message below its argument limit even for a large host font.
    const data = Buffer.from(aliasTrueTypeFont(readFileSync(FONT), 'Sample Reflow Serif')).toString(
      'base64'
    )
    evalRaw('window.__fontTestData=""')
    try {
      for (let i = 0; i < data.length; i += 32000)
        evalRaw(`window.__fontTestData+=${JSON.stringify(data.slice(i, i + 32000))};void 0`)
      evalRaw(
        `(async()=>{const b=Uint8Array.from(atob(window.__fontTestData),c=>c.charCodeAt(0));await app.vault.createBinary(${JSON.stringify(`${DIR}/Fonts/Sample-Regular.ttf`)},b.buffer);return 'ok'})()`
      )
    } finally {
      evalRaw('delete window.__fontTestData')
    }
    evalRaw(`(async()=>{
      window.__abeleTest.reader.eink.set({on:false})
      const put=async(path,data)=>{const b=Uint8Array.from(atob(data),c=>c.charCodeAt(0));await app.vault.createBinary(path,b.buffer)}
      await put(${JSON.stringify(BOOK)},${JSON.stringify(Buffer.from(buildJustifiedEpub()).toString('base64'))})
      const cfg=window.__abeleTest.AbeleConfig.getInstance()
      cfg.reader={...cfg.reader,flow:'paginated',fontsFolder:${JSON.stringify(`${DIR}/Fonts`)},fontSize:110,lineHeight:1.5,margin:'normal',maxWidth:720,columns:2,themeColors:true,bookStyles:true,notesTo:'book',bookNotes:{}}
      await cfg.saveSettings()
      const fonts=window.__abeleTest.reader.fonts();await fonts.scan()
      const family=fonts.families.value[0]?.name;if(!family)throw Error('test font was not discovered')
      cfg.reader={...cfg.reader,font:'vault:'+family};await cfg.saveSettings()
      return 'ok'
    })()`)
  })
  afterAll(() => {
    if (!onPhone()) runCli(['dev:cdp', 'method=Emulation.clearDeviceMetricsOverride', 'params={}'])
    evalRaw(`(async()=>{
      for(const l of app.workspace.getLeavesOfType('abele-book'))if(l.view.file?.path===${JSON.stringify(BOOK)})l.detach()
      const cfg=window.__abeleTest.AbeleConfig.getInstance();cfg.reader=${JSON.stringify(reader)};await cfg.saveSettings()
      window.__abeleTest.reader.eink.set(${JSON.stringify(eink)})
      const dir=app.vault.getAbstractFileByPath(${JSON.stringify(DIR)});if(dir)await app.vault.delete(dir,true)
      const saved=${JSON.stringify(places)}
      if(saved?.text!=null)await app.vault.adapter.write(saved.path,saved.text)
      else if(saved&&await app.vault.adapter.exists(saved.path))await app.vault.adapter.remove(saved.path)
      if(!${panels?.[0] ?? true})app.workspace.leftSplit.expand()
      if(!${panels?.[1] ?? true})app.workspace.rightSplit.expand()
      return 'ok'
    })()`)
  })

  it('remeasures wrapping saved highlights and search after font load, reopen and column changes', async () => {
    const report = JSON.parse(
      await evalLong(
        `(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms))
      const until=async f=>{for(let i=0;i<200;i++){const x=f();if(x)return x;await wait(50)}throw Error('reader did not settle')}
      const fonts=window.__abeleTest.reader.fonts(),original=fonts.facesOf
      let release;const gate=new Promise(r=>release=r)
      fonts.facesOf=async function(...args){const data=await original.apply(this,args);await gate;return data}
      const checks=[]
      try{
        let leaf;try{leaf=app.workspace.getLeaf('tab')}catch{leaf=app.workspace.getLeaf(false)}
        await leaf.setViewState({type:'abele-book',state:{file:${JSON.stringify(BOOK)}},active:true})
        const v=await until(()=>leaf.view.model?.status==='ready'&&leaf.view.reading&&leaf.view)
        v.model.panel=false;await v.engine.goTo(0);await wait(600)
        const current=()=>v.engine.renderer.getContents().find(c=>c.index===0)
        const range=(length)=>{const d=current().doc,p=d.getElementById('p1-0-0'),r=d.createRange();r.setStart(p.firstChild,0);r.setEnd(p.firstChild,length);return r}
        const selected=range(150),query=String(range(40)).trim(),cfi=v.engine.getCFI(0,selected)
        const queryCfi=v.engine.getCFI(0,range(query.length)),link=cfi.slice(8,-1).replace(/\\[/g,'%5B').replace(/\\]/g,'%5D')
        await app.vault.create(${JSON.stringify(`${DIR}/sample-book highlights.md`)},'---\\ntype: book-highlights\\nfile: "[[sample-book.epub]]"\\n---\\n\\n> [!quote|yellow] [[sample-book.epub#cfi='+link+'|Sample chapter]]\\n> '+String(selected)+'\\n')
        await v.reading.loadHighlights();await v.reading.search(query)
        const hit=v.model.search.groups.flatMap(g=>g.hits).find(h=>h.cfi===queryCfi)
        if(!hit)throw Error('target search result missing')
        await v.reading.goToHit(hit)
        const rect=r=>[r.left,r.top,r.width,r.height]
        const check=async name=>{
          await wait(600)
          const c=current(),f=c.doc.defaultView.frameElement.getBoundingClientRect()
          const words=r=>[...r.getClientRects()].map(b=>[b.left+f.left,b.top+f.top,b.width,b.height])
          const groups=[...c.overlayer.element.children],boxes=g=>[...g.querySelectorAll('rect')].map(r=>rect(r.getBoundingClientRect()))
          checks.push({name,words:words(range(150)),query:words(range(query.length)),highlight:groups.filter(g=>g.getAttribute('fill')!=='none').flatMap(boxes),search:boxes(groups.find(g=>g.getAttribute('fill')==='none'))})
        }
        await wait(13000);await check('fallback')
        const before=[...current().doc.fonts].length;if(before)throw Error('font gate did not hold')
        release();fonts.facesOf=original
        await until(()=>[...current().doc.fonts].length)
        await current().doc.fonts.ready;await check('font settled')
        const loaded=[...current().doc.fonts].filter(f=>f.status==='loaded').length
        const family=fonts.families.value[0].name
        ${onPhone() ? `await window.__e2eHost.shot(${JSON.stringify(`${SHOTS}/phone.png`)})` : `const remote=require('@electron/remote'),cdp=remote.getCurrentWebContents().debugger;const shot=await cdp.sendCommand('Page.captureScreenshot',{format:'png'});require('fs').writeFileSync(${JSON.stringify(`${SHOTS}/desktop.png`)},Buffer.from(shot.data,'base64'))`}
        await v.engine.goTo(1);await v.engine.goTo(0);await v.reading.goToHit(hit);await check('section returned')
        v.model.panelTab='search';v.model.panel=true;await check('sidebar open');v.model.panel=false
        ${!onPhone() ? `await cdp.sendCommand('Emulation.setDeviceMetricsOverride',{width:1400,height:800,deviceScaleFactor:1,mobile:false});await check('two columns')` : ''}
        const columns=v.engine.renderer.columns
        await leaf.setViewState({type:'empty',state:{}})
        await leaf.setViewState({type:'abele-book',state:{file:${JSON.stringify(BOOK)}},active:true})
        const reopened=await until(()=>leaf.view.model?.status==='ready'&&leaf.view.model.highlights.length&&leaf.view)
        // A reopened book must restore the same saved range with the vault font already available.
        const c=reopened.engine.renderer.getContents()[0]
        await c.doc.fonts.ready;await wait(800)
        const anchor=c.doc.createRange(),p=c.doc.getElementById('p1-0-0'),f=c.doc.defaultView.frameElement.getBoundingClientRect()
        anchor.setStart(p.firstChild,0);anchor.setEnd(p.firstChild,150)
        checks.push({name:'reopened',words:[...anchor.getClientRects()].map(b=>[b.left+f.left,b.top+f.top,b.width,b.height]),highlight:[...c.overlayer.element.querySelectorAll('rect')].map(r=>rect(r.getBoundingClientRect())),search:[],query:[]})
        return JSON.stringify({checks,loaded,family,columns})
      }catch(e){return JSON.stringify({error:String(e.stack||e),checks})}
      finally{release();fonts.facesOf=original}
    })()`,
        90000
      )
    ) as Report
    expect(report.error).toBeUndefined()
    expect(report.loaded).toBeGreaterThan(0)
    expect(report.checks.map((c) => c.name)).toEqual([
      'fallback',
      'font settled',
      'section returned',
      'sidebar open',
      ...(!onPhone() ? ['two columns'] : []),
      'reopened',
    ])
    for (const c of report.checks) {
      const matches = (a: number[][], b: number[][]) =>
        a.length === b.length && b.every((r, j) => r.every((n, i) => Math.abs(n - a[j][i]) < 2))
      expect(c.words.length, c.name).toBeGreaterThan(1)
      expect(matches(c.highlight, c.words), `${c.name}: highlight ${JSON.stringify(c)}`).toBe(true)
      expect(matches(c.search, c.query), `${c.name}: search ${JSON.stringify(c)}`).toBe(true)
    }
    // A loaded face alone is not proof of a reflow: an installed family could already have
    // rendered the fallback phase. Its old rectangles must be measurably wrong for the new text.
    const before = report.checks[0].words,
      after = report.checks[1].words
    expect(
      before.length !== after.length ||
        after.some((r, j) => r.some((n, i) => Math.abs(n - before[j][i]) > 10))
    ).toBe(true)
    expect(report.family).toBe('Sample Reflow Serif')
    expect(report.columns).toBe(onPhone() ? 1 : 2)
  }, 120000)
})
