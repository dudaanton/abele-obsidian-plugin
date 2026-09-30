/** A real phone's saved places and highlights, received by a separately leased desktop vault. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { buildJustifiedEpub, JUSTIFIED_BOOK_ID } from '../fixtures/books/justifiedBook'
import { aliasTrueTypeFont } from '../helpers/tinyFont'

targets('phone')
// The caller must lease this vault, install the same build, and release it afterwards. No test
// acquires a second device behind the runner's back. Ordinary unpaired runs do not drive a desktop.
const DESKTOP = process.env.ABELE_READER_DESKTOP_VAULT
const available = onPhone() && !!DESKTOP && isObsidianRunning() && hasTestApi()
const DIR = 'Sample device reading'
const BOOK = `${DIR}/sample-book.epub`
const NOTE = `${DIR}/sample-book highlights.md`
const FAMILY = 'Sample Handoff Serif'
const SHOTS = shotDir('abele-device-reflow')
const ID = `urn:uuid:sample-device-reading-${Date.now()}`
const KEY = `id:${ID}`
type Device = 'phone' | 'desktop'
type Packet = {
  place: { cfi: string; at: number; [key: string]: unknown }
  text: string
  note: string
  index: number
}
type Backup = {
  reader: unknown
  eink: unknown
  panels: boolean[]
  files: { path: string; text: string | null }[]
  zoom?: number
  throttling?: boolean
}
type Probe = {
  samples: number
  failures: unknown[]
  index: number
  columns: number
  highlights: number
  search: number
  settings: Record<string, unknown>
  visible?: boolean
  text?: string
  notices?: number
  stored: Packet['place']
}
const backups: Partial<Record<Device, Backup>> = {}
const exec = promisify(execFile)
const PRELUDE = `
  const wait=ms=>new Promise(r=>setTimeout(r,ms))
  const until=async f=>{for(let i=0;i<200;i++){const x=await f();if(x)return x;await wait(50)}throw Error('reader did not settle')}
  const cfg=window.__abeleTest.AbeleConfig.getInstance()
  const placesPath=()=>cfg.reader.placesPath||'abele-book-places.json'
  const leaf=()=>app.workspace.getLeavesOfType('abele-book').find(l=>l.getViewState().state?.file===${JSON.stringify(BOOK)})
  const view=()=>leaf()?.view
  const current=()=>view()?.engine?.renderer?.getContents()[0]
  const range=(doc,index)=>{const p=doc.getElementById('p'+(index+1)+'-0-0'),r=doc.createRange();r.setStart(p.firstChild,0);r.setEnd(p.firstChild,150);return r}
`
async function run<T>(device: Device, body: string): Promise<T> {
  const code = `(async()=>{${PRELUDE}\n${body}\n})()`
  if (device === 'phone') return JSON.parse(await evalLong(code, 90000)) as T
  const { stdout } = await exec(
    process.env.OBSIDIAN_CLI ?? '/usr/local/bin/obsidian',
    [`vault=${DESKTOP}`, 'eval', `code=${code}`],
    { timeout: 45000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 }
  )
  const out = stdout.trim().replace(/^=> /, '')
  return JSON.parse(out) as T
}

const GEOMETRY = `
  const measure=()=>{
    const c=current();if(!c?.overlayer||!c.doc?.defaultView)return null
    const renderer=view().engine.renderer,stage=renderer.getBoundingClientRect()
    if(!stage.width||!stage.height)return null
    const d=c.doc,f=d.defaultView.frameElement.getBoundingClientRect()
    const rect=r=>[r.left,r.top,r.width,r.height]
    const words=r=>[...r.getClientRects()].map(b=>[b.left+f.left,b.top+f.top,b.width,b.height])
    const groups=[...c.overlayer.element.children],boxes=g=>[...g.querySelectorAll('rect')].map(r=>rect(r.getBoundingClientRect()))
    const highlight=groups.filter(g=>g.getAttribute('fill')!=='none').flatMap(boxes)
    const search=groups.filter(g=>g.getAttribute('fill')==='none').flatMap(boxes)
    const expected=words(range(d,c.index)),query=[]
    if(search.length){const w=d.createTreeWalker(d.body,NodeFilter.SHOW_TEXT);let n
      while(n=w.nextNode()){let from=0,at;while((at=n.data.toLowerCase().indexOf('рыбак',from))>=0){const r=d.createRange();r.setStart(n,at);r.setEnd(n,at+5);query.push(...words(r));from=at+5}}
    }
    const matches=(a,b)=>a.length===b.length&&b.every(r=>a.some(s=>r.every((n,i)=>Math.abs(n-s[i])<2)))
    const failures=[]
    if(highlight.length&&!matches(highlight,expected))failures.push({kind:'highlight',actual:highlight,expected})
    if(search.length&&!matches(search,query))failures.push({kind:'search',actual:search,expected:query})
    return {index:c.index,columns:renderer.columns,highlights:highlight.length,search:search.length,failures}
  }
`

async function snapshot(): Promise<Packet> {
  return run(
    'phone',
    `
    await wait(2300)
    const c=current(),places=JSON.parse(await app.vault.adapter.read(placesPath())),place=places[${JSON.stringify(KEY)}]
    if(!place?.cfi)throw Error('phone did not persist its place')
    const text=String(view().engine.resolveNavigation(place.cfi).anchor(c.doc))
    return JSON.stringify({place,text,index:c.index,note:await app.vault.adapter.read(${JSON.stringify(NOTE)})})
  `
  )
}
async function deliver(packet: Packet): Promise<void> {
  // The production boundary is an ordinary vault file modification. Preserve the phone's actual
  // timestamp and CFI; do not replace them with a fabricated newer clock or a desktop page number.
  await run(
    'desktop',
    `
    const path=placesPath(),all=await app.vault.adapter.exists(path)?JSON.parse(await app.vault.adapter.read(path)):{}
    all[${JSON.stringify(KEY)}]=${JSON.stringify(packet.place)}
    require('fs').writeFileSync(require('path').join(app.vault.adapter.getBasePath(),path),JSON.stringify(all))
    return JSON.stringify(true)
  `
  )
}
async function check(name: string, packet?: Packet): Promise<Probe> {
  const result = await run<Probe>(
    'desktop',
    `${GEOMETRY}
    await wait(600)
    const m=measure();if(!m)throw Error('no desktop geometry')
    const monitor=window.__deviceGeometry
    const out={...m,samples:monitor.samples,failures:[...monitor.failures,...m.failures],settings:cfg.reader,notices:monitor.notices.size,key:view().model.key,stored:await view().follow.store.get(view().model.key),lastLocation:view().engine.lastLocation.cfi}
    ${
      packet
        ? `const c=current(),r=view().engine.resolveNavigation(${JSON.stringify(packet.place.cfi)}).anchor(c.doc)
    out.text=String(r);r.collapse(true)
    const b=r.getBoundingClientRect(),f=c.doc.defaultView.frameElement.getBoundingClientRect(),s=view().engine.renderer.getBoundingClientRect()
    out.visible=b.left+f.left>=s.left-2&&b.left+f.left<s.right&&b.top+f.top>=s.top-2&&b.top+f.top<s.bottom`
        : ''
    }
    return JSON.stringify(out)
  `
  )
  writeFileSync(join(SHOTS, `${name}.json`), JSON.stringify(result, null, 2))
  expect(result.failures, name).toEqual([])
  expect(result.samples, name).toBeGreaterThan(0)
  expect(result.highlights, name).toBeGreaterThan(0)
  expect(result.settings).toMatchObject({
    fontSize: 110,
    lineHeight: 1.5,
    columns: 2,
    maxWidth: 720,
    font: `vault:${FAMILY}`,
  })
  if (packet) {
    expect(result.index, name).toBe(packet.index)
    expect(result.text, name).toBe(packet.text)
    expect(result.visible, name).toBe(true)
  }
  return result
}

describe.skipIf(!available)('phone to desktop reader geometry', () => {
  beforeAll(async () => {
    const entries = unzipSync(buildJustifiedEpub())
    entries['OEBPS/content.opf'] = strToU8(
      strFromU8(entries['OEBPS/content.opf']).replace(JUSTIFIED_BOOK_ID, ID)
    )
    const book = Buffer.from(zipSync(entries)).toString('base64')
    for (const device of ['phone', 'desktop'] as const) {
      backups[device] = await run<Backup>(
        device,
        `
        const paths=[placesPath(),(app.plugins.plugins.abele.manifest.dir||app.vault.configDir+'/plugins/abele')+'/book-places.backup.json']
        const files=[];for(const path of paths)files.push({path,text:await app.vault.adapter.exists(path)?await app.vault.adapter.read(path):null})
        return JSON.stringify({reader:cfg.reader,eink:window.__abeleTest.reader.eink.state(),panels:[app.workspace.leftSplit.collapsed,app.workspace.rightSplit.collapsed],files${device === 'desktop' ? ",zoom:require('@electron/remote').getCurrentWebContents().getZoomFactor(),throttling:require('@electron/remote').getCurrentWebContents().getBackgroundThrottling()" : ''}})
      `
      )
      await run(
        device,
        `
        window.__abeleTest.reader.eink.set({on:false});app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse()
        await app.vault.createFolder(${JSON.stringify(DIR)})
        const bytes=Uint8Array.from(atob(${JSON.stringify(book)}),c=>c.charCodeAt(0));await app.vault.createBinary(${JSON.stringify(BOOK)},bytes.buffer)
        cfg.reader={...cfg.reader,flow:'paginated',font:'serif',fontSize:${device === 'phone' ? 135 : 110},lineHeight:1.5,columns:${device === 'phone' ? 1 : 2},margin:'normal',maxWidth:720,themeColors:true,bookStyles:true,notesTo:'book',bookNotes:{}}
        await cfg.saveSettings()
        ${device === 'desktop' ? `const wc=require('@electron/remote').getCurrentWebContents();wc.setBackgroundThrottling(false);wc.setZoomFactor(1);if(!wc.debugger.isAttached())wc.debugger.attach('1.3');await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:960,height:1280,deviceScaleFactor:1,mobile:false})` : ''}
        return JSON.stringify(true)
      `
      )
    }
    const bytes = aliasTrueTypeFont(
      readFileSync(
        process.env.ABELE_TEST_FONT_FILE ?? '/System/Library/Fonts/Supplemental/Times New Roman.ttf'
      ),
      FAMILY
    )
    const data = Buffer.from(bytes).toString('base64')
    await run(
      'desktop',
      `await app.vault.createFolder(${JSON.stringify(`${DIR}/Fonts`)});window.__deviceFontData='';return JSON.stringify(true)`
    )
    try {
      for (let i = 0; i < data.length; i += 32000)
        await run(
          'desktop',
          `window.__deviceFontData+=${JSON.stringify(data.slice(i, i + 32000))};return JSON.stringify(true)`
        )
      await run(
        'desktop',
        `
        const b=Uint8Array.from(atob(window.__deviceFontData),c=>c.charCodeAt(0));await app.vault.createBinary(${JSON.stringify(`${DIR}/Fonts/Sample-Regular.ttf`)},b.buffer)
        cfg.reader={...cfg.reader,font:${JSON.stringify(`vault:${FAMILY}`)},fontsFolder:${JSON.stringify(`${DIR}/Fonts`)}};await cfg.saveSettings();await window.__abeleTest.reader.fonts().scan()
        return JSON.stringify(true)
      `
      )
    } finally {
      await run('desktop', `delete window.__deviceFontData;return JSON.stringify(true)`)
    }
  }, 120000)

  afterAll(async () => {
    for (const device of ['phone', 'desktop'] as const) {
      if (!backups[device]) continue
      await run(
        device,
        `
        const saved=${JSON.stringify(backups[device])}
        window.__deviceGeometry?.stop();delete window.__deviceGeometry
        window.__releaseDeviceFont?.();delete window.__releaseDeviceFont
        const store=view()?.follow?.store
        for(const l of app.workspace.getLeavesOfType('abele-book'))if(l.getViewState().state?.file===${JSON.stringify(BOOK)})l.detach()
        if(store)await store.flush();await wait(1800)
        cfg.reader=saved.reader;await cfg.saveSettings();window.__abeleTest.reader.eink.set(saved.eink)
        const dir=app.vault.getAbstractFileByPath(${JSON.stringify(DIR)});if(dir)await app.vault.delete(dir,true)
        for(const f of saved.files){if(f.text!==null)await app.vault.adapter.write(f.path,f.text);else if(await app.vault.adapter.exists(f.path))await app.vault.adapter.remove(f.path)}
        if(!saved.panels[0])app.workspace.leftSplit.expand();if(!saved.panels[1])app.workspace.rightSplit.expand()
        ${device === 'desktop' ? `const wc=require('@electron/remote').getCurrentWebContents();await wc.debugger.sendCommand('Emulation.clearDeviceMetricsOverride');wc.setZoomFactor(saved.zoom);wc.setBackgroundThrottling(saved.throttling)` : ''}
        return JSON.stringify(true)
      `
      )
    }
  }, 90000)

  it('restores and follows actual phone places without retaining pre-jump or fallback-font rectangles', async () => {
    await run(
      'phone',
      `
      let l;try{l=app.workspace.getLeaf('tab')}catch{l=app.workspace.getLeaf(false)}
      await l.setViewState({type:'abele-book',state:{file:${JSON.stringify(BOOK)}},active:true})
      const v=await until(()=>l.view.model?.status==='ready'&&l.view.reading&&l.view);v.model.panel=false
      for(const index of [0,1]){
        await v.engine.goTo(index);await wait(500)
        const d=current().doc,r=range(d,index),cfi=v.engine.getCFI(index,r)
        await v.engine.goTo(cfi);await wait(300)
        d.getSelection().removeAllRanges();d.getSelection().addRange(r)
        await until(()=>v.model.selection?.text===String(r));await v.reading.highlight('yellow')
      }
      await wait(700);return JSON.stringify(true)
    `
    )
    const first = await snapshot()
    expect(first.index).toBe(1)
    writeFileSync(join(SHOTS, 'phone-initial.json'), JSON.stringify(first, null, 2))
    await run(
      'phone',
      `await window.__e2eHost.shot(${JSON.stringify(join(SHOTS, 'device-source.png'))});return JSON.stringify(true)`
    )
    await run(
      'desktop',
      `await app.vault.create(${JSON.stringify(NOTE)},${JSON.stringify(first.note)});return JSON.stringify(true)`
    )
    await deliver(first)
    await run(
      'desktop',
      `${GEOMETRY}
      const fonts=window.__abeleTest.reader.fonts(),original=fonts.facesOf
      let release;const gate=new Promise(r=>release=r)
      fonts.facesOf=async function(...a){const data=await original.apply(this,a);await gate;return data}
      window.__releaseDeviceFont=()=>{release();fonts.facesOf=original}
      const state={samples:0,failures:[],notices:new Set()},seen=new MutationObserver(records=>{
        for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1)for(const el of [n,...n.querySelectorAll('.notice')])if(el.classList.contains('notice')&&/another device/.test(el.textContent))state.notices.add(el)
      })
      seen.observe(document.body,{childList:true,subtree:true})
      let frame,stopped=false
      const tick=()=>{if(stopped)return;const m=measure();if(m){state.samples++;if(m.failures.length&&state.failures.length<10)state.failures.push(m)}frame=requestAnimationFrame(tick)}
      state.stop=()=>{stopped=true;cancelAnimationFrame(frame);seen.disconnect()};window.__deviceGeometry=state;tick()
      const l=app.workspace.getLeaf('tab');await l.setViewState({type:'abele-book',state:{file:${JSON.stringify(BOOK)}},active:true})
      const v=await until(()=>l.view.model?.status==='ready'&&l.view.model.highlights.length===2&&l.view);v.model.panel=false
      return JSON.stringify(true)
    `
    )
    await check('cold-open-phone-place', first)
    await run(
      'desktop',
      `await view().reading.search('рыбак');await wait(13000);return JSON.stringify(true)`
    )
    const beforeFont = await check('phone-place-before-font', first)
    expect(beforeFont.search).toBeGreaterThan(0)
    await run(
      'desktop',
      `window.__releaseDeviceFont();await until(()=>[...current().doc.fonts].length);await current().doc.fonts.ready;return JSON.stringify(true)`
    )
    const afterFont = await check('phone-place-after-font', first)
    expect(afterFont.stored.cfi, 'reflow must not echo a different desktop page range').toBe(first.place.cfi)
    expect(afterFont.stored.at, 'reflow is not newer reading').toBe(first.place.at)

    // The second packet is recorded on the real phone AFTER desktop opening and font settling.
    // It therefore wins the normal timestamp merge without modifying its clock in the test.
    await run(
      'phone',
      `const v=view();await v.engine.goTo(0);await wait(400);await v.engine.goTo(v.engine.getCFI(0,range(current().doc,0)));return JSON.stringify(true)`
    )
    const second = await snapshot()
    expect(second.place.at).toBeGreaterThan(first.place.at)
    expect(second.index).toBe(0)
    writeFileSync(join(SHOTS, 'phone-next.json'), JSON.stringify(second, null, 2))
    await deliver(second)
    await run(
      'desktop',
      `
      // If a local layout relocation counted as reading, the incoming place waits until the tab
      // is looked at again. Exercise the real workspace event, not PlaceFollow.back directly.
      const l=leaf(),other=app.workspace.getLeaf('tab');await other.setViewState({type:'empty',state:{},active:true});await wait(250)
      app.workspace.setActiveLeaf(l,{focus:true});await wait(250);other.detach()
      await until(()=>current()?.index===0);return JSON.stringify(true)
    `
    )
    const followed = await check('followed-phone-place', second)
    // Arrival can follow during cold opening as well: one notice per distinct handoff, not
    // one total across both the initial packet and the later real page turn on the phone.
    expect(beforeFont.notices).toBeLessThanOrEqual(1)
    expect((followed.notices ?? 0) - (beforeFont.notices ?? 0)).toBe(1)
    expect(followed.stored.cfi).toBe(second.place.cfi)
    expect(followed.stored.at).toBe(second.place.at)
    await run(
      'desktop',
      `view().model.panelTab='search';view().model.panel=true;return JSON.stringify(true)`
    )
    await check('followed-sidebar', second)
    await run(
      'desktop',
      `view().model.panel=false;await require('@electron/remote').getCurrentWebContents().debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:1400,height:800,deviceScaleFactor:1,mobile:false});return JSON.stringify(true)`
    )
    expect((await check('followed-two-columns', second)).columns).toBe(2)
    for (const zoom of [0.9, 1.1, 1]) {
      await run(
        'desktop',
        `require('@electron/remote').getCurrentWebContents().setZoomFactor(${zoom});return JSON.stringify(true)`
      )
      await check(`followed-zoom-${zoom}`, second)
    }
    await run(
      'desktop',
      `
      const wc=require('@electron/remote').getCurrentWebContents(),shot=await wc.debugger.sendCommand('Page.captureScreenshot',{format:'png'})
      require('fs').writeFileSync(${JSON.stringify(join(SHOTS, 'device-received.png'))},Buffer.from(shot.data,'base64'));return JSON.stringify(true)
    `
    )
  }, 180000)
})
