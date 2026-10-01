/** An overlay shares the frame's origin from attachment onward, without waiting for a resize. */
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
import { buildTinyFont } from '../helpers/tinyFont'
import { WAIT_PRELUDE } from './helpers/wait'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample overlay origin'
const BOOK = `${DIR}/sample-book.epub`
const FAMILY = 'Sample Wide Serif'
const SHOTS = shotDir('abele-overlay-origin')
const b64 = (data: Uint8Array) => Buffer.from(data).toString('base64')

type Geometry = {
  name: string
  columns: number
  frame: number[]
  overlay: number[]
  search: number[][]
  highlight: number[][]
  words: number[][]
  savedWords: number[][]
}
type Report = { error?: string; checks: Geometry[]; fontsBefore: number; fontsAfter: number }

describe.skipIf(!available)('book overlay coordinate origin', () => {
  let reader: unknown
  let panels: boolean[]
  let places: { path: string; text: string | null }
  beforeAll(() => {
    reader = evalJson('window.__abeleTest.AbeleConfig.getInstance().reader')
    panels = evalJson(
      `(() => { const w=app.workspace, p=[w.leftSplit.collapsed,w.rightSplit.collapsed]; w.leftSplit.collapse(); w.rightSplit.collapse(); return p })()`
    )
    places = JSON.parse(
      evalRaw(`(async () => {
      const path=window.__abeleTest.AbeleConfig.getInstance().reader.placesPath || 'abele-book-places.json'
      return JSON.stringify({path,text:await app.vault.adapter.exists(path)?await app.vault.adapter.read(path):null})
    })()`)
    )
    // A taller viewport than the host monitor can provide by resizing its native window.
    if (!onPhone())
      runCli([
        'dev:cdp',
        'method=Emulation.setDeviceMetricsOverride',
        'params={"width":960,"height":1280,"deviceScaleFactor":1,"mobile":false}',
      ])
    evalRaw(`(async () => {
      await app.vault.createFolder(${JSON.stringify(DIR)})
      await app.vault.createFolder(${JSON.stringify(`${DIR}/Fonts`)})
      const put=async(path,data)=>{const b=Uint8Array.from(atob(data),c=>c.charCodeAt(0));await app.vault.createBinary(path,b.buffer)}
      await put(${JSON.stringify(BOOK)},${JSON.stringify(b64(buildJustifiedEpub()))})
      await put(${JSON.stringify(`${DIR}/Fonts/Sample-Regular.ttf`)},${JSON.stringify(b64(buildTinyFont({ family: FAMILY })))})
      const cfg=window.__abeleTest.AbeleConfig.getInstance()
      cfg.reader={...cfg.reader,flow:'paginated',font:${JSON.stringify(`vault:${FAMILY}`)},fontsFolder:${JSON.stringify(`${DIR}/Fonts`)},fontSize:110,lineHeight:1.5,margin:'normal',maxWidth:720,columns:2,themeColors:true,bookStyles:true,notesTo:'book',bookNotes:{}}
      await cfg.saveSettings()
      await window.__abeleTest.reader.fonts().scan()
      return 'ok'
    })()`)
  })
  afterAll(() => {
    if (!onPhone()) runCli(['dev:cdp', 'method=Emulation.clearDeviceMetricsOverride', 'params={}'])
    evalRaw(`(async () => {
      for(const l of app.workspace.getLeavesOfType('abele-book'))if(l.view.file?.path===${JSON.stringify(BOOK)})l.detach()
      const cfg=window.__abeleTest.AbeleConfig.getInstance();cfg.reader=${JSON.stringify(reader)};await cfg.saveSettings()
      const dir=app.vault.getAbstractFileByPath(${JSON.stringify(DIR)});if(dir)await app.vault.delete(dir,true)
      const saved=${JSON.stringify(places)}
      if(saved?.text!=null)await app.vault.adapter.write(saved.path,saved.text)
      else if(saved && await app.vault.adapter.exists(saved.path))await app.vault.adapter.remove(saved.path)
      if(!${panels?.[0] ?? true})app.workspace.leftSplit.expand()
      if(!${panels?.[1] ?? true})app.workspace.rightSplit.expand()
      return 'ok'
    })()`)
  })

  it('positions search and saved highlights before the first resize, and through a late vault font and column changes', async () => {
    const report = JSON.parse(
      await evalLong(
        `(async () => {
      ${WAIT_PRELUDE}
      const need=async(fn,what)=>{const value=await until(fn);if(!value)throw Error(what+' did not settle');return value}
      // Cross a paint/observer boundary after the DOM or font condition, not a guessed delay.
      // Never use this for the attachment-microtask measurement below.
      const painted=async()=>{
        let done=false,frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{done=true})})
        try{await need(()=>done,'reader paint')}finally{cancelAnimationFrame(frame)}
      }
      const fonts=window.__abeleTest.reader.fonts(), original=fonts.facesOf
      let release
      const gate=new Promise(resolve=>release=resolve)
      // Hold the real font-file path, not the document's rendering or observer callbacks.
      fonts.facesOf=async function(...args){const data=await original.apply(this,args);await gate;return data}
      let renderer, attached
      const checks=[]
      try {
        let leaf;try{leaf=app.workspace.getLeaf('tab')}catch{leaf=app.workspace.getLeaf(false)}
        await leaf.setViewState({type:'abele-book',state:{file:${JSON.stringify(BOOK)}},active:true})
        const v=await need(()=>leaf.view.model?.status==='ready'&&leaf.view.reading&&leaf.view,'reader')
        v.model.panel=false
        await v.engine.goTo(0)
        renderer=v.engine.renderer
        const current=()=>renderer.getContents().find(c=>c.index===0)
        const pageReady=async()=>{
          await need(()=>current()?.doc?.readyState==='complete'&&current().doc.fonts.status==='loaded','chapter document')
          await painted()
        }
        const panel=()=>v.contentEl.querySelector('.abele-book-reader__panel')
        await need(()=>!panel(),'closed sidebar')
        await pageReady()
        const range=(doc,length)=>{const p=doc.getElementById('p1-2-0'),r=doc.createRange();r.setStart(p.firstChild,0);r.setEnd(p.firstChild,length);return r}
        const doc=current().doc
        const query=String(range(doc,35)).trim(), selected=range(doc,65)
        const cfi=v.engine.getCFI(0,selected),queryCfi=v.engine.getCFI(0,range(doc,query.length))
        const link=cfi.slice(8,-1).replace(/\\[/g,'%5B').replace(/\\]/g,'%5D')
        await app.vault.create(${JSON.stringify(`${DIR}/sample-book highlights.md`)},'---\\ntype: book-highlights\\nfile: "[[sample-book.epub]]"\\n---\\n\\n> [!quote|yellow] [[sample-book.epub#cfi='+link+'|Sample chapter]]\\n> '+String(selected)+'\\n')
        await v.reading.loadHighlights()
        await v.reading.search(query)
        const hit=v.model.search.groups.flatMap(g=>g.hits).find(h=>h.cfi===queryCfi)
        if(!hit)throw Error('target search result missing')
        const rect=r=>[r.left,r.top,r.width,r.height]
        const check=name=>{
          const c=current(),d=c.doc,f=d.defaultView.frameElement.getBoundingClientRect(),o=c.overlayer.element.getBoundingClientRect()
          const words=r=>[...r.getClientRects()].map(b=>[b.left+f.left,b.top+f.top,b.width,b.height])
          const groups=[...c.overlayer.element.children]
          const boxes=g=>[...g.querySelectorAll('rect')].map(r=>rect(r.getBoundingClientRect()))
          const search=groups.filter(g=>g.getAttribute('fill')==='none').flatMap(boxes)
          const highlight=groups.filter(g=>g.getAttribute('fill')!=='none').flatMap(boxes)
          checks.push({name,columns:renderer.columns,frame:rect(f),overlay:rect(o),search,highlight,words:words(range(d,query.length)),savedWords:words(range(d,65))})
        }
        attached=e=>{
          if(e.detail.index!==0)return
          const attach=e.detail.attach
          e.detail.attach=overlayer=>{
            attach(overlayer)
            // Annotation creation uses microtasks. Measure them before the next resize-observer
            // delivery, without delaying attachment, suppressing observers or moving any box.
            queueMicrotask(()=>check('attached'))
          }
        }
        renderer.addEventListener('create-overlayer',attached,{capture:true})
        await v.engine.goTo(1);await v.engine.goTo(0)
        await pageReady();check('first page settled')
        v.model.panelTab='search';v.model.panel=true
        await need(()=>panel()?.getBoundingClientRect().width>0,'open sidebar');await painted();check('sidebar open')
        await v.reading.goToHit(hit);await pageReady();check('result opened')
        v.model.panel=false
        await need(()=>!panel(),'closed sidebar');await painted();check('sidebar closed')
        const count=()=>[...current().doc.fonts].filter(f=>f.family.replace(/"/g,'')===${JSON.stringify(FAMILY)}).length
        const fontsBefore=count()
        // No startup timer is left to conceal missing font reflow notifications.
        await wait(13000);release();fonts.facesOf=original
        await need(()=>count()&&[...current().doc.fonts].every(f=>f.status==='loaded'),'vault font')
        await pageReady();check('vault font arrived')
        const fontsAfter=count()
        await v.engine.goTo(1);await v.engine.goTo(0);await pageReady();check('returned with font')
        await v.reading.goToHit(hit);await pageReady()
        ${
          onPhone()
            ? `await window.__e2eHost.shot(${JSON.stringify(`${SHOTS}/phone.png`)})`
            : `const remote=require('@electron/remote'),cdp=remote.getCurrentWebContents().debugger
        const shot=await cdp.sendCommand('Page.captureScreenshot',{format:'png'});require('fs').writeFileSync(${JSON.stringify(`${SHOTS}/portrait.png`)},Buffer.from(shot.data,'base64'))
        await cdp.sendCommand('Emulation.setDeviceMetricsOverride',{width:1400,height:800,deviceScaleFactor:1,mobile:false})
        await need(()=>innerWidth===1400&&innerHeight===800&&renderer.columns===2,'two-column viewport')
        await pageReady();check('two columns')
        await v.engine.goTo(1);await v.engine.goTo(0);await pageReady();check('two columns returned')`
        }
        const cfg=window.__abeleTest.AbeleConfig.getInstance();cfg.reader={...cfg.reader,flow:'scrolled'};await cfg.saveSettings()
        await need(()=>renderer.scrolled,'scrolled layout')
        await v.engine.goTo(1);await v.engine.goTo(0);await pageReady();check('scrolled returned')
        return JSON.stringify({checks,fontsBefore,fontsAfter})
      }catch(e){return JSON.stringify({error:String(e.stack||e),checks})}
      finally{release();fonts.facesOf=original;if(renderer&&attached)renderer.removeEventListener('create-overlayer',attached,{capture:true})}
    })()`,
        120000
      )
    ) as Report
    expect(report.error).toBeUndefined()
    expect(report.fontsBefore).toBe(0)
    expect(report.fontsAfter).toBe(1)
    expect(report.checks.filter((c) => c.name === 'attached').length).toBe(onPhone() ? 3 : 4)
    for (const c of report.checks) {
      expect(
        Math.abs(c.overlay[0] - c.frame[0]),
        `${c.name}: overlay left vs frame left`
      ).toBeLessThan(1)
      expect(
        Math.abs(c.overlay[1] - c.frame[1]),
        `${c.name}: overlay top vs frame top`
      ).toBeLessThan(1)
      expect(
        Math.abs(c.overlay[2] - c.frame[2]),
        `${c.name}: overlay width vs frame width`
      ).toBeLessThan(1)
      expect(
        Math.abs(c.overlay[3] - c.frame[3]),
        `${c.name}: overlay height vs frame height`
      ).toBeLessThan(1)
      expect(c.words.length).toBeGreaterThan(0)
      const contains = (actual: number[][], expected: number[][]) =>
        expected.every((w) => actual.some((r) => r.every((n, i) => Math.abs(n - w[i]) < 1)))
      expect(contains(c.search, c.words), `${c.name}: search boxes over the actual words`).toBe(
        true
      )
      expect(
        contains(c.highlight, c.savedWords),
        `${c.name}: saved highlight over the actual words`
      ).toBe(true)
    }
    expect(report.checks.find((c) => c.name === 'first page settled')?.columns).toBe(1)
    if (!onPhone()) expect(report.checks.find((c) => c.name === 'two columns')?.columns).toBe(2)
  }, 150000)
})
