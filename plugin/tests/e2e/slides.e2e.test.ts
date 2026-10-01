import { mkdirSync, writeFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { SAMPLE_IMAGE, SAMPLE_VIDEO } from '../fixtures/slides'

targets('desktop', 'phone')

const available = isObsidianRunning() && hasTestApi()
const DIR = 'sample-slides-e2e'
const PATH = `${DIR}/sample-deck.md`
const SHOTS = shotDir('abele-slides')
const SOURCE = `---
type: presentation
aspect: '16:9'
---
::slide{layout=title class=sample-accent}::
# Sample deck
A short introduction

> [!notes]
> Private reminder

> [!tip]
> Public suggestion
>
> > [!notes]
> > Hidden nested reminder

---
::slide{layout=split}::
## Two sides
::left::
- First point
- Second point
::right::
![[${DIR}/sample-image.svg]]

---
::slide{bg="[[${DIR}/sample-video.mp4]]" autoplay}::
## Video background

---
## Live chart
\`\`\`abele-chart
height: 400
series:
  - name: Sample
    data: [1, 3, 2, 4]
\`\`\`

---
## Live map
\`\`\`abele-map
height: 400
center: [0, 0]
zoom: 2
points:
  - lat: 0
    lon: 0
    label: Sample point
\`\`\`

---
::slide{layout=grid}::
## Grid
::cell::
One
::cell::
Two
::cell::
Three
::cell::
Four

---
::slide{layout=image}::
![[${DIR}/sample-image.svg]]
A caption

---
::slide{layout=quote}::
> A sample quotation

---
::slide{layout=section}::
# Section

\`\`\`css
@import "./sample-parent.css";
body { --sample-deck-only: 1; }
\`\`\`
`

const PRELUDE = `
  const wait = (ms) => new Promise(r => setTimeout(r, ms))
  const until = async (fn, ms=15000) => { const end=Date.now()+ms; while(Date.now()<end) { if(fn())return true; await wait(100) } return false }
  let leaf = app.workspace.getLeavesOfType('abele-deck').find(l => l.view.file?.path === ${JSON.stringify(PATH)})
  if (!leaf) { leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(PATH)})) }
  if (!leaf?.view.viewer) throw Error('presentation did not open as a deck')
  const viewer = leaf.view.viewer
  await viewer.ready
  const active = () => viewer.viewport.querySelector('.abele-slide:not([hidden])')
  const picture = async (name) => {
    const path = ${JSON.stringify(SHOTS)}+'/'+name+'.png'
    if(window.__e2eHost) return await window.__e2eHost.shot(path)
    const fs=require('fs');fs.mkdirSync(${JSON.stringify(SHOTS)},{recursive:true})
    fs.writeFileSync(path, (await require('@electron/remote').getCurrentWindow().capturePage()).toPNG())
    return path
  }
`

let layout: unknown
let emulated = false
let minimum: number[] = []

beforeAll(async () => {
  if (!available) return
  layout = evalJson('app.workspace.getLayout()')
  if (!onPhone())
    minimum = evalJson("require('@electron/remote').getCurrentWindow().getMinimumSize()")
  const result = await evalLong(`(async () => {
    for(const button of document.querySelectorAll('.notice button'))if(button.textContent==='Dismiss')button.click()
    const dir=${JSON.stringify(DIR)}
    if (app.vault.getAbstractFileByPath(dir)) throw Error('sample fixture directory already exists')
    await app.vault.createFolder(dir)
    await app.vault.create(dir+'/sample-parent.css','@import "./sample-imported.css";')
    await app.vault.create(dir+'/sample-imported.css','.workspace { display: none !important } body { --sample-imported: yes } .sample-accent { --sample-root-class: yes } .sample-accent h1 { --sample-heading-class: yes }')
    await app.vault.create(dir+'/sample-image.svg',${JSON.stringify(SAMPLE_IMAGE)})
    const bytes=Uint8Array.from(atob(${JSON.stringify(SAMPLE_VIDEO)}),c=>c.charCodeAt(0))
    await app.vault.createBinary(dir+'/sample-video.mp4',bytes.buffer)
    const file=await app.vault.create(${JSON.stringify(PATH)},${JSON.stringify(SOURCE)})
    const leaf=app.workspace.getLeaf('tab')
    await leaf.openFile(file)
    return leaf.view.getViewType()
  })()`)
  expect(result).toBe('abele-deck')
})

afterAll(async () => {
  if (!available) return
  if (emulated) await reloadApp('app.emulateMobile(false)')
  evalRaw(`(async () => {
    for(const leaf of app.workspace.getLeavesOfType('abele-deck')) if(leaf.view.file?.path.startsWith(${JSON.stringify(DIR)}+'/')) leaf.detach()
    const dir=app.vault.getAbstractFileByPath(${JSON.stringify(DIR)});if(dir)await app.vault.delete(dir,true)
    await app.workspace.changeLayout(${JSON.stringify(layout)})
    ${!onPhone() && minimum.length ? `require('@electron/remote').getCurrentWindow().setMinimumSize(${minimum[0]},${minimum[1]})` : ''}
    return true
  })()`)
})

describe.skipIf(!available)('presentation notes in the running app', () => {
  it('renders note content and scoped deck CSS without exposing speaker notes', async () => {
    const r = JSON.parse(
      await evalLong(`(async () => { ${PRELUDE}
      const result = { slides: viewer.viewport.querySelectorAll('.abele-slide').length,
        notes: viewer.root.textContent.includes('Private reminder'),
        body: getComputedStyle(document.body).getPropertyValue('--sample-deck-only'),
        scoped: getComputedStyle(active()).getPropertyValue('--sample-deck-only').trim(),
        nested:viewer.root.textContent.includes('Hidden nested reminder'),
        imported:getComputedStyle(active()).getPropertyValue('--sample-imported').trim(),
        rootClass:getComputedStyle(active()).getPropertyValue('--sample-root-class').trim(),
        headingClass:getComputedStyle(active().querySelector('h1')).getPropertyValue('--sample-heading-class').trim(),
        globalImport:getComputedStyle(document.body).getPropertyValue('--sample-imported').trim(),
        workspaceVisible:getComputedStyle(document.querySelector('.workspace')).display!=='none' }
      result.shot=await picture('desktop-title')
      await viewer.go(1)
      result.regions=[...active().querySelectorAll('.abele-slide-region')].map(el=>el.className)
      result.image=!!active().querySelector('img')
      return JSON.stringify(result)
    })()`)
    )
    expect(r.slides).toBeLessThanOrEqual(3)
    expect(r.notes).toBe(false)
    expect(r.body.trim()).toBe('')
    expect(r.scoped).toBe('1')
    expect(r.nested).toBe(false)
    expect(r.imported).toBe('yes')
    expect(r.rootClass).toBe('yes')
    expect(r.headingClass).toBe('yes')
    expect(r.globalImport).toBe('')
    expect(r.workspaceVisible).toBe(true)
    expect(r.regions).toHaveLength(3)
    expect(r.image).toBe(true)
  })

  it('plays muted inline video on entry and pauses it on leaving', async () => {
    const r = JSON.parse(
      await evalLong(`(async () => { ${PRELUDE}
      await viewer.go(2)
      const video=active().querySelector('video')
      const played=await until(()=>video.readyState>=2 && !video.paused && video.currentTime>0)
      const result={played, muted:video.muted, inline:video.playsInline, error:video.error?.message || '', time:video.currentTime,
        fallback:!!active().querySelector('.abele-slide-play')}
      const vb=video.getBoundingClientRect()
      result.controlsReachable=document.elementFromPoint(vb.left+vb.width/2,vb.bottom-12)?.closest('video')===video
      result.shot=await picture('video')
      await viewer.go(3);result.paused=video.paused
      return JSON.stringify(result)
    })()`)
    )
    expect(r.error).toBe('')
    expect(r.played, JSON.stringify(r)).toBe(true)
    expect(r.muted).toBe(true)
    expect(r.inline).toBe(true)
    expect(r.paused).toBe(true)
    expect(r.controlsReachable).toBe(true)
  })

  it('draws live charts and maps at logical size inside scaled slides', async () => {
    const r = JSON.parse(
      await evalLong(`(async () => { ${PRELUDE}
      await viewer.go(3)
      if(!await until(()=>active().querySelector('.abele-chart-container canvas')?.width>0))throw Error('chart did not draw')
      const canvas=active().querySelector('.abele-chart-container canvas')
      const box=canvas.getBoundingClientRect(), slide=active().getBoundingClientRect()
      const result={chart:{width:canvas.width,logical:canvas.clientWidth,scaled:box.width,slide:slide.width}}
      result.chartShot=await picture('chart')
      await viewer.go(4)
      if(!await until(()=>active().querySelector('.maplibregl-canvas')?.width>0 && active().querySelector('.maplibregl-marker')))throw Error('map did not draw')
      const map=active().querySelector('.maplibregl-canvas'), marker=active().querySelector('.maplibregl-marker')
      const m=map.getBoundingClientRect(),p=marker.getBoundingClientRect()
      result.map={width:map.width,logical:map.clientWidth,scaled:m.width,center:p.left+p.width/2,expected:m.left+m.width/2,lost:map.getContext('webgl2')?.isContextLost() ?? false}
      result.mapShot=await picture('map')
      return JSON.stringify(result)
    })()`)
    )
    expect(r.chart.width).toBeGreaterThan(0)
    expect(r.chart.logical).toBeGreaterThan(100)
    expect(r.chart.scaled).toBeLessThanOrEqual(r.chart.logical * 2)
    expect(r.map.width).toBeGreaterThan(0)
    expect(Math.abs(r.map.center - r.map.expected)).toBeLessThan(5)
    expect(r.map.lost).toBe(false)
  })

  it('lays out split columns, grid cells, full-bleed media and centered slides on the fixed canvas', async () => {
    const r = JSON.parse(
      await evalLong(`(async () => { ${PRELUDE}
      const result={}
      for(const [index,name] of [[1,'split'],[5,'grid'],[6,'image'],[7,'quote'],[8,'section']]) {
        await viewer.go(index)
        await Promise.race([new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))),wait(3000).then(()=>{throw Error('window not drawing')})])
        const slide=active(),box=slide.getBoundingClientRect()
        if(name==='split') {
          const left=slide.querySelector('.abele-slide-region-left').getBoundingClientRect(),right=slide.querySelector('.abele-slide-region-right').getBoundingClientRect()
          result.split=left.width>0 && right.width>0 && left.right<=right.left
        }
        if(name==='grid') {
          const cells=[...slide.querySelectorAll('.abele-slide-region-cell')].map(el=>el.getBoundingClientRect())
          result.grid=cells.length===4 && cells.every(c=>c.width>0 && c.height>0 && c.left>=box.left && c.right<=box.right+1 && c.bottom<=box.bottom+1)
        }
        if(name==='image') {
          const image=slide.querySelector('img')
          if(!await until(()=>image.complete && image.naturalWidth>0))throw Error('full-bleed image did not load')
          const media=image.getBoundingClientRect()
          result.image=Math.abs(media.width-box.width)<1 && Math.abs(media.height-box.height)<1
        }
        result[name+'Shot']=await picture('layout-'+name)
      }
      result.unchanged=await app.vault.read(leaf.view.file)===${JSON.stringify(SOURCE)}
      return JSON.stringify(result)
    })()`)
    )
    expect(r.unchanged).toBe(true)
    expect(r.split).toBe(true)
    expect(r.grid).toBe(true)
    expect(r.image).toBe(true)
  })

  it('previews changes beside the source editor and keeps the selected slide', async () => {
    const r = JSON.parse(
      await evalLong(`(async () => { ${PRELUDE}
      await viewer.go(1);
      [...viewer.toolbar.querySelectorAll('button')].find(b=>b.textContent==='Edit beside').click()
      if(!await until(()=>app.workspace.getLeavesOfType('markdown').some(l=>l.view.file?.path===${JSON.stringify(PATH)})))throw Error('source editor did not open')
      const source=app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path===${JSON.stringify(PATH)})
      source.view.editor.setValue(source.view.editor.getValue().replace('Two sides','Updated sides'))
      if(!await until(()=>active().textContent.includes('Updated sides')))throw Error('preview did not follow editor')
      const result={index:viewer.index,source:source.view.getViewType(),preview:leaf.view.getViewType()}
      source.detach();return JSON.stringify(result)
    })()`)
    )
    expect(r.index).toBe(1)
    expect(r.source).toBe('markdown')
    expect(r.preview).toBe('abele-deck')
  })

  it('shows slide dividers in source reading mode without raw settings markers', async () => {
    const r = JSON.parse(
      await evalLong(`(async () => { ${PRELUDE}
      const source=app.workspace.createLeafBySplit(leaf,'vertical')
      await source.openFile(leaf.view.file,{state:{abeleDeckSource:true,mode:'preview'}})
      if(!await until(()=>source.view.contentEl.querySelector('.abele-slide-divider')))throw Error('reading dividers did not render')
      const labels=new Set([...source.view.contentEl.querySelectorAll('.abele-slide-divider')].map(el=>el.textContent))
      const scroller=source.view.contentEl.querySelector('.markdown-preview-view')
      scroller.scrollTop=scroller.scrollHeight
      if(!await until(()=>[...source.view.contentEl.querySelectorAll('.abele-slide-divider')].some(el=>el.textContent==='Slide 9 · section')))throw Error('last reading divider did not render after scrolling')
      for(const el of source.view.contentEl.querySelectorAll('.abele-slide-divider'))labels.add(el.textContent)
      // MarkdownView keeps its raw editor buffer too; the reading renderer is the audience here.
      const result={labels:[...labels],raw:scroller.textContent.includes('::slide{'),rawNodes:[...scroller.querySelectorAll('p')].filter(el=>el.textContent.includes('::slide{')).map(el=>el.outerHTML)}
      source.detach();return JSON.stringify(result)
    })()`)
    )
    expect(r.labels).toContain('Slide 2 · split')
    expect(r.labels).toContain('Slide 9 · section')
    expect(r.raw, JSON.stringify(r)).toBe(false)
  })

  it('fits a phone layout, fills the window for play, and pages with taps, swipes and keyboard', async () => {
    if (!onPhone()) {
      emulated = true
      await reloadApp('app.emulateMobile(true)')
      evalRaw(
        "require('@electron/remote').getCurrentWindow().setMinimumSize(0,0); require('@electron/remote').getCurrentWindow().setContentSize(390,844)"
      )
    }
    const r = JSON.parse(
      await evalLong(`(async () => { ${PRELUDE}
      await viewer.go(0);await viewer.present(false)
      if(!await until(()=>Math.abs(viewer.root.getBoundingClientRect().width-window.innerWidth)<2))throw Error('overlay did not fill window')
      // Two drawing frames: a stopped window is a failure, not a substitute measurement.
      await Promise.race([new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))),wait(3000).then(()=>{throw Error('window not drawing')})])
      const root=viewer.root.getBoundingClientRect(),slide=active().getBoundingClientRect(),vp=viewer.viewport.getBoundingClientRect()
      const result={width:window.innerWidth,fill:root.height/window.innerHeight,ratio:slide.width/slide.height,
        outside:slide.left<root.left-1 || slide.right>root.right+1 || slide.bottom>root.bottom+1,
        toolbarOutside:[...viewer.toolbar.querySelectorAll('button')].some(el=>{const b=el.getBoundingClientRect();return b.left<root.left || b.right>root.right || b.top<0 || b.bottom>root.bottom})}
      result.shot=await picture('phone-title')
      const tap = async (x,y) => {
        if(window.__e2eHost) await window.__e2eHost.tap(x,y)
        else { const cdp=require('@electron/remote').getCurrentWebContents().debugger; await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:0}]});await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}) }
      }
      const swipe = async (x1,y1,x2,y2) => {
        if(window.__e2eHost) await window.__e2eHost.swipe(x1,y1,x2,y2)
        else { const cdp=require('@electron/remote').getCurrentWebContents().debugger;
          await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x1,y:y1,id:0}]});
          for(let i=1;i<=5;i++) { await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x1+(x2-x1)*i/5,y:y1+(y2-y1)*i/5,id:0}]});await wait(30) }
          await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}) }
      }
      await tap(root.right-25,vp.top+vp.height/2)
      result.tap=await until(()=>viewer.index===1)
      await viewer.go(0)
      await swipe(root.width*.8,vp.top+vp.height/2,root.width*.2,vp.top+vp.height/2)
      result.swipe=await until(()=>viewer.index===1)
      viewer.root.focus();viewer.root.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))
      await viewer.ready;result.keyboard=viewer.index===8
      result.windowPrint=typeof window.print
      if(window.__e2eHost) {
        try {
          await window.__e2eHost.orientation('landscape')
          if(!await until(()=>window.innerWidth>window.innerHeight))throw Error('phone did not turn')
          await Promise.race([new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))),wait(3000).then(()=>{throw Error('window not drawing')})])
          const box=active().getBoundingClientRect()
          result.landscape={ratio:box.width/box.height,fits:box.left>=0 && box.right<=window.innerWidth+1 && box.bottom<=window.innerHeight+1}
          result.landscapeShot=await picture('phone-landscape')
        } finally { await window.__e2eHost.orientation('portrait') }
      }
      viewer.root.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
      result.restored=viewer.root.parentElement===leaf.view.contentEl
      return JSON.stringify(result)
    })()`)
    )
    mkdirSync(SHOTS, { recursive: true })
    writeFileSync(`${SHOTS}/platform-findings.json`, JSON.stringify(r, null, 2))
    expect(r.fill).toBeCloseTo(1, 2)
    expect(r.ratio).toBeCloseTo(16 / 9, 2)
    expect(r.outside).toBe(false)
    expect(r.toolbarOutside).toBe(false)
    expect(r.tap, JSON.stringify(r)).toBe(true)
    expect(r.swipe, JSON.stringify(r)).toBe(true)
    expect(r.keyboard).toBe(true)
    expect(r.restored).toBe(true)
    if (onPhone()) {
      expect(r.landscape.ratio).toBeCloseTo(16 / 9, 2)
      expect(r.landscape.fits).toBe(true)
    }
  })
})
