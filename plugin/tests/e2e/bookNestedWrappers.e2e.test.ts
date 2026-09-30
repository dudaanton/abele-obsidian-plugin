/** Nested inline wrappers around chapter blocks must preserve text geometry and reading places. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { evalJson, evalLong, evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { buildJustifiedEpub, JUSTIFIED_BOOK_ID } from '../fixtures/books/justifiedBook'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample nested chapter'
const BOOK = `${DIR}/sample-book.epub`
const ID = `urn:uuid:sample-nested-${Date.now()}`

describe.skipIf(!available)('nested inline chapter wrappers', () => {
  let reader: unknown
  let eink: unknown
  let files: { path: string; text: string | null }[]
  beforeAll(() => {
    reader = evalJson('window.__abeleTest.AbeleConfig.getInstance().reader')
    eink = evalJson('window.__abeleTest.reader.eink.state()')
    files = JSON.parse(
      evalRaw(`(async()=>{
      const path=window.__abeleTest.AbeleConfig.getInstance().reader.placesPath||'abele-book-places.json',backup=(app.plugins.plugins.abele.manifest.dir||'.obsidian/plugins/abele')+'/book-places.backup.json'
      const files=[];for(const p of [path,backup])files.push({path:p,text:await app.vault.adapter.exists(p)?await app.vault.adapter.read(p):null});return JSON.stringify(files)
    })()`)
    )
    const entries = unzipSync(buildJustifiedEpub())
    entries['OEBPS/content.opf'] = strToU8(
      strFromU8(entries['OEBPS/content.opf']).replace(JUSTIFIED_BOOK_ID, ID)
    )
    for (const path of ['OEBPS/c1.xhtml', 'OEBPS/c2.xhtml'])
      entries[path] = strToU8(
        strFromU8(entries[path])
          .replace('<body>', '<body><span id="outer"><span id="middle"><span id="inner">')
          .replace('</body>', '</span></span></span></body>')
      )
    evalRaw(`(async()=>{
      window.__abeleTest.reader.eink.set({on:false})
      const cfg=window.__abeleTest.AbeleConfig.getInstance();cfg.reader={...cfg.reader,flow:'paginated',font:'serif',fontSize:110,lineHeight:1.5,columns:2,maxWidth:720,bookStyles:true};await cfg.saveSettings()
      await app.vault.createFolder(${JSON.stringify(DIR)})
      const b=Uint8Array.from(atob(${JSON.stringify(Buffer.from(zipSync(entries)).toString('base64'))}),c=>c.charCodeAt(0));await app.vault.createBinary(${JSON.stringify(BOOK)},b.buffer);return 'ok'
    })()`)
  })
  afterAll(() => {
    evalRaw(`(async()=>{
      for(const l of app.workspace.getLeavesOfType('abele-book'))if(l.getViewState().state?.file===${JSON.stringify(BOOK)}){const s=l.view.follow?.store;l.detach();if(s)await s.flush()}
      const cfg=window.__abeleTest.AbeleConfig.getInstance();cfg.reader=${JSON.stringify(reader)};await cfg.saveSettings();window.__abeleTest.reader.eink.set(${JSON.stringify(eink)})
      const dir=app.vault.getAbstractFileByPath(${JSON.stringify(DIR)});if(dir)await app.vault.delete(dir,true)
      for(const f of ${JSON.stringify(files)}){if(f.text!==null)await app.vault.adapter.write(f.path,f.text);else if(await app.vault.adapter.exists(f.path))await app.vault.adapter.remove(f.path)}return 'ok'
    })()`)
  })
  it('measures all wrapper levels as blocks and saves distinct nonempty ranges after navigation', async () => {
    const result = JSON.parse(
      await evalLong(
        `(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms)),until=async f=>{for(let i=0;i<200;i++){const v=f();if(v)return v;await wait(50)}throw Error('reader did not settle')}
      let l;try{l=app.workspace.getLeaf('tab')}catch{l=app.workspace.getLeaf(false)}
      await l.setViewState({type:'abele-book',state:{file:${JSON.stringify(BOOK)}},active:true})
      const v=await until(()=>l.view.model?.status==='ready'&&l.view.reading&&l.view);v.model.panel=false;await v.engine.goTo(0);await wait(800)
      const d=v.engine.renderer.getContents()[0].doc,display=['outer','middle','inner'].map(id=>d.defaultView.getComputedStyle(d.getElementById(id)).display)
      const checks=[]
      for(const id of ['p1-2-0','p1-4-0']){
        const p=d.getElementById(id),r=d.createRange();r.setStart(p.firstChild,0);r.setEnd(p.firstChild,20)
        const target=v.engine.getCFI(0,r);await v.engine.goTo(target);await wait(2200)
        const path=window.__abeleTest.AbeleConfig.getInstance().reader.placesPath||'abele-book-places.json'
        const place=JSON.parse(await app.vault.adapter.read(path))[${JSON.stringify(`id:${ID}`)}]
        const live=v.engine.resolveNavigation(v.engine.lastLocation.cfi).anchor(d)
        const saved=v.engine.resolveNavigation(place.cfi).anchor(d)
        checks.push({id,target,place,liveText:String(live),savedText:String(saved),includesTarget:saved.intersectsNode(p.firstChild)})
      }
      return JSON.stringify({display,checks,phone:${onPhone()}})
    })()`,
        60000
      )
    ) as {
      display: string[]
      checks: {
        place: { cfi: string }
        liveText: string
        savedText: string
        includesTarget: boolean
      }[]
    }
    expect(result.display).toEqual(['block', 'block', 'block'])
    expect(result.checks).toHaveLength(2)
    for (const check of result.checks) {
      expect(check.liveText.trim().length).toBeGreaterThan(0)
      expect(check.savedText.trim().length).toBeGreaterThan(0)
      expect(check.includesTarget).toBe(true)
    }
    expect(result.checks[0].place.cfi).not.toBe(result.checks[1].place.cfi)
  }, 90000)
})
