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
import { RESTORE_PHONE_SCRIPT } from './helpers/phoneState'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const PATH = 'sample-fullscreen-deck.md'
const SHOTS = shotDir('abele-fullscreen')
let layout: unknown
let windowState: { bounds: unknown; minimum: number[] } | undefined
let emulated = false

beforeAll(async () => {
  if (!available) return
  layout = evalJson('app.workspace.getLayout()')
  if (!onPhone())
    windowState = evalJson(
      "(()=>{const w=require('@electron/remote').getCurrentWindow();return {bounds:w.getBounds(),minimum:w.getMinimumSize()}})()"
    )
  expect(
    await evalLong(`(async()=>{
    if(app.vault.getAbstractFileByPath(${JSON.stringify(PATH)}))throw Error('sample fixture already exists')
    const f=await app.vault.create(${JSON.stringify(PATH)},'---\\ntype: presentation\\n---\\n::slide{layout=title}::\\n# Sample show\\n---\\n# Second\\n---\\n# Third')
    const l=app.workspace.getLeaf('tab');await l.openFile(f);return l.view.getViewType()
  })()`)
  ).toBe('abele-deck')
})
afterAll(async () => {
  if (!available) return
  await evalLong(`(async()=>{
    for(const l of app.workspace.getLeavesOfType('abele-deck'))if(l.view.file?.path===${JSON.stringify(PATH)})l.detach()
    const f=app.vault.getAbstractFileByPath(${JSON.stringify(PATH)});if(f)await app.vault.delete(f)
    await app.workspace.changeLayout(${JSON.stringify(layout)})
    ${windowState ? `const w=require('@electron/remote').getCurrentWindow();w.setMinimumSize(...${JSON.stringify(windowState.minimum)});w.setBounds(${JSON.stringify(windowState.bounds)})` : ''}
    return true
  })()`)
  // Remove fixture views before switching modes: reload persists the outgoing mobile layout.
  if (emulated) await reloadApp('app.emulateMobile(false)')
})

const PRELUDE = `
  const wait=ms=>new Promise(r=>setTimeout(r,ms))
  const until=async(fn)=>{const end=Date.now()+5000;while(Date.now()<end){if(fn())return true;await wait(50)}return false}
  let leaf=app.workspace.getLeavesOfType('abele-deck').find(l=>l.view.file?.path===${JSON.stringify(PATH)})
  if(!leaf){leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(PATH)}))}
  const v=leaf.view.viewer;await v.ready
  const phone=!!window.__e2eHost,mobile=phone || document.body.classList.contains('is-mobile')
  const native=phone?null:require('@electron/remote').getCurrentWindow()
  const cdp=phone?null:require('@electron/remote').getCurrentWebContents().debugger
  const full=()=>native && (native.isFullScreen() || native.isSimpleFullScreen())
  const status=phone?window.Capacitor?.Plugins?.StatusBar:null
  const hidden=()=>getComputedStyle(v.toolbar).visibility==='hidden' && v.toolbar.inert
  const visible=()=>getComputedStyle(v.toolbar).visibility==='visible' && !v.toolbar.inert
  const tap=async(x,y)=>{
    if(phone)await window.__e2eHost.tap(x,y)
    else if(mobile){await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:0}]});await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}
    else {await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1})}
  }
  const move=async(x,y)=>{await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x,y})}
  const press=async(key,code,n)=>{
    await cdp.sendCommand('Input.dispatchKeyEvent',{type:'rawKeyDown',key,code,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n})
    await cdp.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:n,nativeVirtualKeyCode:n})
  }
  const picture=async(name)=>{
    await Promise.race([new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))),wait(3000).then(()=>{throw Error('window not drawing')})])
    const path=${JSON.stringify(SHOTS)}+'/'+name+'.png'
    if(phone)return await window.__e2eHost.shot(path)
    const fs=require('fs');fs.mkdirSync(${JSON.stringify(SHOTS)},{recursive:true});fs.writeFileSync(path,(await native.capturePage()).toPNG());return path
  }
  const active=()=>v.viewport.querySelector('.abele-slide:not([hidden])')
  const slideBox=()=>{const b=active().getBoundingClientRect();return [b.x,b.y,b.width,b.height]}
`
const probe = async (name: string) =>
  JSON.parse(
    await evalLong(`(async()=>{${PRELUDE}
  const beforeStatus=status?(await status.getInfo()).visible:null
  const beforeFull=full()
  await v.go(0)
  app.workspace.setActiveLeaf(leaf,{focus:true})
  await wait(350)
  const play=v.toolbar.querySelector('button[aria-label="Play"]'),b=play.getBoundingClientRect()
  await tap(b.left+b.width/2,b.top+b.height/2)
  try {
    if(!await until(()=>v.root.classList.contains('abele-deck-presenting')))throw Error('Play did not start')
    if(!mobile && !await until(full))throw Error('Play did not enter native fullscreen')
    await wait(300)
    const r={fullscreen:mobile || full(),initiallyHidden:hidden(),fill:v.root.getBoundingClientRect().height/innerHeight}
    r.idleShot=await picture(${JSON.stringify(name)}+'-idle')
    const size=slideBox()
    if(mobile){await tap(innerWidth/2,innerHeight/2);r.centerNoNavigation=v.index===0}
    else {
      await move(innerWidth/2,innerHeight/2);await wait(200);r.contentDoesNotReveal=hidden()
      await move(innerWidth/2,10)
    }
    r.revealed=await until(visible)
    await wait(200)
    r.sizeUnchanged=JSON.stringify(size)===JSON.stringify(slideBox())
    r.controlsShot=await picture(${JSON.stringify(name)}+'-controls')
    if(!mobile)await move(innerWidth/2,innerHeight/2)
    await wait(2800);r.hiddenAfterIdle=hidden()
    if(status)r.statusHidden=(await status.getInfo()).visible===false
    if(mobile) {
      await tap(innerWidth-25,innerHeight/2);r.tapNext=await until(()=>v.index===1)
      const x1=innerWidth*.8,x2=innerWidth*.2,y=innerHeight/2
      if(phone)await window.__e2eHost.swipe(x1,y,x2,y)
      else {await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x1,y,id:0}]});
        for(let i=1;i<=5;i++){await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x1+(x2-x1)*i/5,y,id:0}]});await wait(30)}
        await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}
      r.swipe=await until(()=>v.index===2)
      if(phone){
        await window.__e2eHost.orientation('landscape');if(!await until(()=>innerWidth>innerHeight))throw Error('phone did not turn')
        await wait(2800);r.landscapeShot=await picture(${JSON.stringify(name)}+'-landscape')
        const s=active().getBoundingClientRect();r.landscapeFits=s.left>=-1 && s.right<=innerWidth+1 && s.bottom<=innerHeight+1
      }
    } else {await press('ArrowRight','ArrowRight',39);r.keyboard=await until(()=>v.index===1)}
    v.root.focus()
    if(phone)v.root.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
    else await press('Escape','Escape',27)
    r.restored=await until(()=>v.root.parentElement===leaf.view.contentEl && (mobile || full()===beforeFull))
    if(status){await wait(200);r.statusRestored=(await status.getInfo()).visible===beforeStatus}
    return JSON.stringify(r)
  } finally {v.exitPresenting();if(phone)await ${RESTORE_PHONE_SCRIPT}}
})()`)
  )
const verify = (r: Record<string, unknown>, mobile: boolean) => {
  for (const k of [
    'fullscreen',
    'initiallyHidden',
    'revealed',
    'sizeUnchanged',
    'hiddenAfterIdle',
    'restored',
  ])
    expect(r[k], JSON.stringify(r)).toBe(true)
  expect(r.fill).toBeCloseTo(1, 2)
  for (const k of mobile
    ? ['centerNoNavigation', 'tapNext', 'swipe']
    : ['contentDoesNotReveal', 'keyboard'])
    expect(r[k], JSON.stringify(r)).toBe(true)
  if (onPhone())
    for (const k of ['statusHidden', 'statusRestored', 'landscapeFits'])
      expect(r[k], JSON.stringify(r)).toBe(true)
}

describe.skipIf(!available)('fullscreen show without permanent chrome', () => {
  it('enters from the actual Play gesture and reveals controls only at the top or on touch', async () => {
    verify(await probe(onPhone() ? 'phone' : 'desktop'), onPhone())
  })
  it.skipIf(onPhone())('fits and navigates under phone emulation', async () => {
    emulated = true
    await reloadApp('app.emulateMobile(true)')
    evalRaw(
      "require('@electron/remote').getCurrentWindow().setMinimumSize(0,0);require('@electron/remote').getCurrentWindow().setContentSize(390,844)"
    )
    verify(await probe('emulated-phone'), true)
  })
  it('ends a mobile show when another tab or file becomes active', async () => {
    if (!onPhone() && !emulated) {
      emulated = true
      await reloadApp('app.emulateMobile(true)')
    }
    const result = JSON.parse(
      await evalLong(`(async()=>{${PRELUDE}
      if(!mobile)throw Error('mobile layout required')
      const path='sample-navigation-note.md'
      if(app.vault.getAbstractFileByPath(path))throw Error('sample fixture already exists')
      const file=await app.vault.create(path,'# Sample destination')
      const before=status?(await status.getInfo()).visible:null
      let other
      try {
        app.workspace.setActiveLeaf(leaf,{focus:true})
        await v.present(false);await wait(200)
        const hiddenOnTab=status?(await status.getInfo()).visible===false:true
        other=app.workspace.getLeaf('tab');await other.openFile(file)
        const tabEnded=await until(()=>v.root.parentElement===leaf.view.contentEl && !v.root.classList.contains('abele-deck-presenting'))
        await wait(200)
        const tabRestored=status?(await status.getInfo()).visible===before:true
        other.detach();other=null
        app.workspace.setActiveLeaf(leaf,{focus:true})
        await v.present(false);await wait(200)
        const hiddenOnFile=status?(await status.getInfo()).visible===false:true
        await leaf.openFile(file)
        const fileEnded=await until(()=>!v.root.isConnected && !v.root.classList.contains('abele-deck-presenting'))
        await wait(200)
        const fileRestored=status?(await status.getInfo()).visible===before:true
        return JSON.stringify({hiddenOnTab,tabEnded,tabRestored,hiddenOnFile,fileEnded,fileRestored,type:leaf.view.getViewType()})
      } finally {
        v.exitPresenting();other?.detach()
        await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(PATH)}))
        await app.vault.delete(file)
      }
    })()`)
    )
    for (const key of [
      'hiddenOnTab',
      'tabEnded',
      'tabRestored',
      'hiddenOnFile',
      'fileEnded',
      'fileRestored',
    ])
      expect(result[key], JSON.stringify(result)).toBe(true)
    expect(result.type).toBe('markdown')
  })
})
