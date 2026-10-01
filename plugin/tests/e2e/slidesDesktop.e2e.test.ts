import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalJson, evalLong, evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { SAMPLE_VIDEO } from '../fixtures/slides'

targets('desktop')
const available = isObsidianRunning() && hasTestApi()
const PATH = 'sample-desktop-deck.md'
const SHOTS = shotDir('abele-slides')
let layout: unknown
let wasFullscreen = false
let wasSimpleFullscreen = false

beforeAll(async () => {
  if (!available) return
  layout = evalJson('app.workspace.getLayout()')
  wasFullscreen = evalJson("require('@electron/remote').getCurrentWindow().isFullScreen()")
  wasSimpleFullscreen = evalJson(
    "require('@electron/remote').getCurrentWindow().isSimpleFullScreen()"
  )
  expect(
    await evalLong(`(async () => {
    if(app.vault.getAbstractFileByPath(${JSON.stringify(PATH)}))throw Error('sample fixture already exists')
    const file=await app.vault.create(${JSON.stringify(PATH)},'---\\ntype: presentation\\n---\\n# First\\n---\\n# Second\\n---\\n# Third')
    const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file)
    return leaf.view.getViewType()
  })()`)
  ).toBe('abele-deck')
})

afterAll(async () => {
  if (!available) return
  evalRaw(`(async () => {
    if(document.fullscreenElement)await document.exitFullscreen()
    const win=require('@electron/remote').getCurrentWindow()
    if(win.isFullScreen()!==${wasFullscreen})win.setFullScreen(${wasFullscreen})
    if(win.isSimpleFullScreen()!==${wasSimpleFullscreen})win.setSimpleFullScreen(${wasSimpleFullscreen})
    for(const l of app.workspace.getLeavesOfType('abele-deck'))if(l.view.file?.path===${JSON.stringify(PATH)})l.detach()
    const file=app.vault.getAbstractFileByPath(${JSON.stringify(PATH)});if(file)await app.vault.delete(file)
    await app.workspace.changeLayout(${JSON.stringify(layout)})
    return true
  })()`)
})

const PRELUDE = `
  const wait=ms=>new Promise(r=>setTimeout(r,ms))
  const until=async(fn,ms=5000)=>{const end=Date.now()+ms;while(Date.now()<end){if(fn())return true;await wait(50)}return false}
  const leaf=app.workspace.getLeavesOfType('abele-deck').find(l=>l.view.file?.path===${JSON.stringify(PATH)})
  const viewer=leaf.view.viewer;await viewer.ready
  const cdp=require('@electron/remote').getCurrentWebContents().debugger
  const press=async(key,code,n)=>{
    await cdp.sendCommand('Input.dispatchKeyEvent',{type:'rawKeyDown',key,code,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n})
    await cdp.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n})
  }
`

describe.skipIf(!available)('single-screen desktop presentation', () => {
  it('takes keyboard navigation immediately after opening, without an extra click', async () => {
    const result = JSON.parse(
      await evalLong(`(async()=>{${PRELUDE}
      await press('ArrowRight','ArrowRight',39)
      const paged=await until(()=>viewer.index===1),keys=[]
      for(const [key,code,n,index] of [[' ','Space',32,2],['Home','Home',36,0],['End','End',35,2],['PageUp','PageUp',33,1]]) {
        await press(key,code,n);keys.push(await until(()=>viewer.index===index))
      }
      return JSON.stringify({paged,keys,focus:document.activeElement?.className})
    })()`)
    )
    expect(result.paged, JSON.stringify(result)).toBe(true)
    expect(result.keys, JSON.stringify(result)).toEqual([true, true, true, true])
  })

  it('keeps real popout fields editable and background video controls configured', async () => {
    const result = JSON.parse(
      await evalLong(`(async()=>{${PRELUDE}
      const path='sample-popout-deck.md',videoPath='sample-popout-video.mp4'
      let pop,file,videoFile
      try {
        if(app.vault.getAbstractFileByPath(path)||app.vault.getAbstractFileByPath(videoPath))throw Error('sample popout fixture already exists')
        videoFile=await app.vault.createBinary(videoPath,Uint8Array.from(atob(${JSON.stringify(SAMPLE_VIDEO)}),c=>c.charCodeAt(0)).buffer)
        file=await app.vault.create(path,'---\\ntype: presentation\\n---\\n::slide{bg="[[sample-popout-video.mp4]]"}::\\n# Window\\n---\\n# Next')
        if(!await until(()=>app.metadataCache.getFirstLinkpathDest(videoPath,path)))throw Error('sample media not indexed')
        pop=app.workspace.openPopoutLeaf()
        await pop.setViewState({type:'abele-deck',state:{file:path},active:true})
        app.workspace.setActiveLeaf(pop,{focus:true})
        const viewer=pop.view.viewer;await viewer.ready
        const doc=viewer.root.ownerDocument,win=doc.defaultView
        const input=doc.createElement('input');viewer.viewport.querySelector('.abele-slide:not([hidden])').append(input)
        input.focus();input.dispatchEvent(new win.KeyboardEvent('keydown',{key:' ',bubbles:true}))
        const video=viewer.viewport.querySelector('video')
        const result={otherDocument:doc!==document,foreignInput:!(input instanceof Element),foreignVideo:!(video instanceof HTMLVideoElement),index:viewer.index,controls:video.controls,loop:video.loop}
        viewer.root.focus();viewer.root.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))
        await viewer.ready;result.navigation=viewer.index===1
        return JSON.stringify(result)
      } finally {
        app.workspace.setActiveLeaf(leaf,{focus:true});pop?.detach()
        if(file)await app.vault.delete(file)
        if(videoFile)await app.vault.delete(videoFile)
      }
    })()`)
    )
    expect(result.otherDocument).toBe(true)
    expect(result.foreignInput).toBe(true)
    expect(result.foreignVideo).toBe(true)
    expect(result.index).toBe(0)
    expect(result.controls).toBe(true)
    expect(result.loop).toBe(true)
    expect(result.navigation).toBe(true)
  })

  it('requests native fullscreen from Play and restores the tab on escape', async () => {
    const result = JSON.parse(
      await evalLong(`(async()=>{${PRELUDE}
      await viewer.go(1)
      const native=require('@electron/remote').getCurrentWindow()
      const isFullscreen=()=>native.isFullScreen() || native.isSimpleFullScreen()
      const probe={before:isFullscreen()}
      const button=[...viewer.toolbar.querySelectorAll('button')].find(b=>b.textContent==='Play')
      const r=button.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2
      await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1})
      await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1})
      // DOM fullscreen can stay pending in an embedded browser without changing the native window.
      const fullscreen=await until(()=>isFullscreen() && viewer.root.classList.contains('abele-deck-presenting'))
      await Promise.race([new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))),wait(3000).then(()=>{throw Error('window not drawing')})])
      const fs=require('fs');fs.mkdirSync(${JSON.stringify(SHOTS)},{recursive:true})
      fs.writeFileSync(${JSON.stringify(SHOTS)}+'/desktop-fullscreen.png',(await require('@electron/remote').getCurrentWindow().capturePage()).toPNG())
      await press('ArrowRight','ArrowRight',39)
      const paged=await until(()=>viewer.index===2)
      await press('Escape','Escape',27)
      const restored=await until(()=>isFullscreen()===probe.before && viewer.root.parentElement===leaf.view.contentEl)
      return JSON.stringify({fullscreen,paged,restored,probe})
    })()`)
    )
    expect(result.fullscreen, JSON.stringify(result)).toBe(true)
    expect(result.paged, JSON.stringify(result)).toBe(true)
    expect(result.restored, JSON.stringify(result)).toBe(true)
  })
})
