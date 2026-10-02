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

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const resultJson = (raw: string) => {
  if (raw.startsWith('Error:')) throw new Error(raw)
  return JSON.parse(raw)
}
const PATH = 'sample-presenter-deck.md'
const SHOTS = shotDir('abele-presenter')
const SOURCE =
  '---\ntype: presentation\ntransition: fade\n---\n::slide{steps}::\n# First\n- One\n  - Nested\n- Two\n\n> [!notes]\n> Private cue\n---\n# Second\n\n> [!notes]\n> Second cue\n---\n# Third'
let layout: unknown
let emulated = false
let minimum: number[] = []

beforeAll(async () => {
  if (!available) return
  layout = evalJson('app.workspace.getLayout()')
  if (!onPhone())
    minimum = evalJson("require('@electron/remote').getCurrentWindow().getMinimumSize()")
  expect(
    await evalLong(`(async()=>{
    if(app.vault.getAbstractFileByPath(${JSON.stringify(PATH)}))throw Error('sample fixture already exists')
    const file=await app.vault.create(${JSON.stringify(PATH)},${JSON.stringify(SOURCE)})
    const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file);return leaf.view.getViewType()
  })()`)
  ).toBe('abele-deck')
})
afterAll(async () => {
  if (!available) return
  if (emulated) await reloadApp('app.emulateMobile(false)')
  evalRaw(`(async()=>{
    for(const leaf of app.workspace.getLeavesOfType('abele-deck'))if(leaf.view.file?.path===${JSON.stringify(PATH)})leaf.detach()
    const file=app.vault.getAbstractFileByPath(${JSON.stringify(PATH)});if(file)await app.vault.delete(file)
    await app.workspace.changeLayout(${JSON.stringify(layout)})
    ${minimum.length ? `require('@electron/remote').getCurrentWindow().setMinimumSize(${minimum[0]},${minimum[1]})` : ''}
    return true
  })()`)
})
const PRELUDE = `
  const wait=ms=>new Promise(r=>setTimeout(r,ms))
  const until=async(fn,ms=5000)=>{const end=Date.now()+ms;while(Date.now()<end){if(fn())return true;await wait(50)}return false}
  const leaf=app.workspace.getLeavesOfType('abele-deck').find(l=>l.view.file?.path===${JSON.stringify(PATH)} && l.view.presenter)
    || [app.workspace.getMostRecentLeaf(),...app.workspace.getLeavesOfType('abele-deck')].find(l=>l?.view.file?.path===${JSON.stringify(PATH)} && l.view.getViewType()==='abele-deck')
  const view=leaf.view;await view.viewer.ready
  const picture=async(name,doc=document)=>{
    await Promise.race([new Promise(r=>doc.defaultView.requestAnimationFrame(()=>doc.defaultView.requestAnimationFrame(r))),wait(3000).then(()=>{throw Error('window not drawing')})])
    const path=${JSON.stringify(SHOTS)}+'/'+name+'.png'
    if(window.__e2eHost)return await window.__e2eHost.shot(path)
    const fs=require('fs');fs.mkdirSync(${JSON.stringify(SHOTS)},{recursive:true})
    fs.writeFileSync(path,(await doc.defaultView.require('@electron/remote').getCurrentWindow().capturePage()).toPNG())
    return path
  }
`

describe.skipIf(!available)('shared presenter show', () => {
  it.skipIf(onPhone())(
    'opens an audience popout, synchronizes real clicker keys and ends from either window',
    async () => {
      const r = resultJson(
        await evalLong(`(async()=>{${PRELUDE}
      await view.viewer.go(0)
      await view.startPresenter()
      const attached=[]
      try {
        const presenter=view.presenter,show=view.show
        const audience=app.workspace.getLeavesOfType('abele-deck').find(l=>l!==leaf && l.view.show===show)
        const viewer=audience.view.viewer,doc=viewer.root.ownerDocument
        const active=()=>viewer.viewport.querySelector('.abele-slide:not([hidden])')
        const result={otherDocument:doc!==document,notes:presenter.notes.textContent.includes('Private cue'),privateAudience:viewer.root.textContent.includes('Private cue'),current:presenter.current.index,next:presenter.next.index,fragments:active().querySelectorAll('.abele-slide-fragment').length,transition:active().dataset.transition}
        const press=async(doc,key,code,n)=>{
          const cdp=doc.defaultView.require('@electron/remote').getCurrentWebContents().debugger
          if(!cdp.isAttached()){cdp.attach('1.3');attached.push(cdp)}
          await cdp.sendCommand('Input.dispatchKeyEvent',{type:'rawKeyDown',key,code,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n})
          await cdp.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n})
          await wait(100)
        }
        const native=doc.defaultView.require('@electron/remote').getCurrentWindow()
        result.movable=!native.isFullScreen() && !native.isSimpleFullScreen()
        const fullscreen=[...viewer.toolbar.querySelectorAll('button')].find(b=>b.textContent==='Fullscreen')
        const cdp=doc.defaultView.require('@electron/remote').getCurrentWebContents().debugger
        if(!cdp.isAttached()){cdp.attach('1.3');attached.push(cdp)}
        const box=fullscreen.getBoundingClientRect(),x=box.left+box.width/2,y=box.top+box.height/2
        await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1})
        await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1})
        if(!await until(()=>native.isFullScreen() || native.isSimpleFullScreen()))throw Error('audience did not enter fullscreen')
        const content=active().querySelector('.abele-slide-content')
        const style=doc.defaultView.getComputedStyle(content)
        result.animation=style.animationName
        result.duration=style.animationDuration
        try {
          await cdp.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
          result.reduced=doc.defaultView.getComputedStyle(content).animationName
        } finally {await cdp.sendCommand('Emulation.setEmulatedMedia',{features:[]})}
        presenter.root.focus()
        await press(document,'ArrowRight','ArrowRight',39)
        result.first=show.index===0 && show.step===1 && active().querySelectorAll('.abele-slide-fragment-hidden').length===1
        viewer.root.focus()
        await press(doc,' ','Space',32)
        result.second=show.index===0 && show.step===2
        await press(doc,'PageDown','PageDown',34)
        await presenter.ready;await viewer.ready
        result.paged=show.index===1 && presenter.current.index===1 && viewer.index===1 && presenter.notes.textContent.includes('Second cue')
        await press(doc,'PageUp','PageUp',33)
        result.reverse=show.index===0 && show.step===2
        const source=app.workspace.createLeafBySplit(leaf,'vertical')
        await source.openFile(view.file,{state:{abeleDeckSource:true,mode:'source'}})
        source.view.editor.setValue(source.view.editor.getValue().replace('Private cue','Edited cue').replace('# First','# Edited'))
        result.edited=await until(()=>presenter.notes.textContent.includes('Edited cue') && active().textContent.includes('Edited') && presenter.current.viewport.textContent.includes('Edited'))
        result.editPosition=show.index===0 && show.step===2
        source.view.editor.setValue(${JSON.stringify(SOURCE)})
        if(!await until(()=>presenter.notes.textContent.includes('Private cue') && active().textContent.includes('First')))throw Error('source did not restore')
        source.detach()
        await wait(350)
        result.presenterShot=await picture('desktop-presenter')
        result.audienceShot=await picture('desktop-audience',doc)
        result.fullscreen=doc.defaultView.require('@electron/remote').getCurrentWindow().isSimpleFullScreen() || doc.defaultView.require('@electron/remote').getCurrentWindow().isFullScreen()
        doc.defaultView.require('@electron/remote').getCurrentWindow().close()
        result.closed=await until(()=>show.ended && !view.presenter && !view.viewer.root.hidden)
        await view.startPresenter()
        const second=view.show
        leaf.detach()
        result.presenterClosed=await until(()=>second.ended && !app.workspace.getLeavesOfType('abele-deck').some(l=>l.view.show===second))
        return JSON.stringify(result)
      } finally { view.show?.end();for(const cdp of attached)if(cdp.isAttached())cdp.detach() }
    })()`)
      )
      expect(r.otherDocument).toBe(true)
      expect(r.notes).toBe(true)
      expect(r.privateAudience).toBe(false)
      expect([r.current, r.next, r.fragments, r.transition]).toEqual([0, 1, 2, 'fade'])
      expect(r.first, JSON.stringify(r)).toBe(true)
      expect(r.second, JSON.stringify(r)).toBe(true)
      expect(r.paged, JSON.stringify(r)).toBe(true)
      expect(r.reverse, JSON.stringify(r)).toBe(true)
      expect(r.edited, JSON.stringify(r)).toBe(true)
      expect(r.editPosition, JSON.stringify(r)).toBe(true)
      expect(r.animation).toBe('abele-slide-fade')
      expect(r.duration).toBe('0.25s')
      expect(r.reduced).toBe('none')
      expect(r.movable, JSON.stringify(r)).toBe(true)
      expect(r.fullscreen, JSON.stringify(r)).toBe(true)
      expect(r.closed).toBe(true)
      expect(r.presenterClosed).toBe(true)
    }
  )

  it('fits a local presenter on a phone with visible notes, previews and timer', async () => {
    if (!onPhone()) {
      emulated = true
      await reloadApp('app.emulateMobile(true)')
      evalRaw(
        "require('@electron/remote').getCurrentWindow().setMinimumSize(0,0);require('@electron/remote').getCurrentWindow().setContentSize(390,844)"
      )
    }
    const r = resultJson(
      await evalLong(`(async()=>{
      const file=app.vault.getAbstractFileByPath(${JSON.stringify(PATH)})
      const opened=app.workspace.getLeaf('tab');await opened.openFile(file)
      ${PRELUDE}
      await view.viewer.go(0)
      const tap=async(el)=>{
        const b=el.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2
        if(window.__e2eHost)await window.__e2eHost.tap(x,y)
        else {const cdp=require('@electron/remote').getCurrentWebContents().debugger;
          await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:0}]});
          await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}
      }
      await wait(350)
      await picture('phone-deck-entry')
      const present=[...view.viewer.toolbar.querySelectorAll('button')].find(b=>b.textContent==='Present')
      await tap(present)
      if(!await until(()=>view.presenter)) {
        const b=present.getBoundingClientRect()
        throw Error('presenter did not open from touch: '+JSON.stringify({box:{x:b.x,y:b.y,width:b.width,height:b.height},target:document.elementFromPoint(b.left+b.width/2,b.top+b.height/2)?.outerHTML,notices:[...document.querySelectorAll('.notice')].map(n=>n.textContent)}))
      }
      try {
        const p=view.presenter
        await p.ready
        const box=p.root.getBoundingClientRect()
        const fits=el=>{const b=el.getBoundingClientRect();return b.width>0 && b.height>0 && b.left>=box.left-1 && b.right<=box.right+1 && b.top>=box.top-1 && b.bottom<=box.bottom+1}
        const r={fill:box.height/window.innerHeight,notes:p.notes.textContent.includes('Private cue'),notesFit:fits(p.notes),currentFit:fits(p.current.viewport),nextFit:fits(p.next.viewport),controlsFit:[...p.root.querySelectorAll('button,select')].filter(el=>getComputedStyle(el).display!=='none' && el.getBoundingClientRect().width>0).every(fits),popouts:app.workspace.getLeavesOfType('abele-deck').filter(l=>l.view.show===view.show).length}
        await wait(350)
        r.shot=await picture('phone-presenter')
        await wait(1100);r.timer=p.root.querySelector('.abele-presenter-timer').textContent!=='00:00'
        const next=[...p.root.querySelectorAll('button')].find(b=>b.textContent==='Next')
        await tap(next);await tap(next);await tap(next);await p.ready
        r.paged=p.current.index===1 && p.notes.textContent.includes('Second cue')
        if(window.__e2eHost) {
          try {
            await window.__e2eHost.orientation('landscape')
            if(!await until(()=>window.innerWidth>window.innerHeight))throw Error('phone did not turn')
            await wait(350)
            const b=p.root.getBoundingClientRect()
            r.landscape=[p.notes,p.current.viewport,p.next.viewport].every(el=>{const x=el.getBoundingClientRect();return x.width>0 && x.height>0 && x.left>=b.left-1 && x.right<=b.right+1 && x.top>=b.top-1 && x.bottom<=b.bottom+1})
            r.landscapeShot=await picture('phone-presenter-landscape')
          } finally {await window.__e2eHost.orientation('portrait')}
        }
        await tap([...p.root.querySelectorAll('button')].find(b=>b.textContent==='End show'))
        r.restored=!view.presenter && !view.viewer.root.hidden && !document.querySelector('.abele-presenter')
        await view.viewer.present(false)
        const vp=view.viewer.viewport.getBoundingClientRect(),x=vp.left+vp.width/2,y=vp.bottom-30
        if(window.__e2eHost)await window.__e2eHost.longPress(x,y)
        else {const cdp=require('@electron/remote').getCurrentWebContents().debugger;
          await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:0}]});await wait(800);
          await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}
        r.longPress=await until(()=>view.presenter)
        if(view.presenter) {r.longPressShot=await picture('phone-presenter-longpress');view.show.end()}
        return JSON.stringify(r)
      } finally {view.show?.end()}
    })()`)
    )
    expect(r.fill).toBeCloseTo(1, 2)
    expect(r.notes).toBe(true)
    expect(r.notesFit, JSON.stringify(r)).toBe(true)
    expect(r.currentFit, JSON.stringify(r)).toBe(true)
    expect(r.nextFit, JSON.stringify(r)).toBe(true)
    expect(r.controlsFit, JSON.stringify(r)).toBe(true)
    expect(r.popouts).toBe(1)
    expect(r.timer).toBe(true)
    expect(r.paged, JSON.stringify(r)).toBe(true)
    expect(r.restored).toBe(true)
    expect(r.longPress, JSON.stringify(r)).toBe(true)
    if (onPhone()) expect(r.landscape, JSON.stringify(r)).toBe(true)
  })
})
