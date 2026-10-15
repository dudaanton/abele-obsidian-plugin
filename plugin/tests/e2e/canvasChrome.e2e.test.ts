/**
 * The canvas as a person works it, by real input: the kit's tool bar across the tab's top, a frame
 * drawn around cards and named on its label, a connection pulled from a card's edge point and
 * labelled with a double press, the picked things' more menu, and a Pencil drawing whatever tool
 * is in hand. Pictures of each for the desktop and the phone.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { driver, screenshot, swipe, tap, typeText } from './helpers/phone'
import { withNativeInput } from './helpers/nativeInput'
import { shotDir } from './helpers/shots'
import { canvasChrome, menuItem } from './helpers/canvasChrome'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample canvas chrome'
const SHOTS = shotDir('canvas-chrome')
const PRELUDE = `
  const path=${JSON.stringify(`${DIR}/sample.canvas`)}
  const view=()=>app.workspace.getLeavesOfType('abele-canvas').find(l=>l.view.file?.path===path)?.view
  const button=label=>view()?.contentEl.querySelector('[aria-label="'+label+'"]')
  const read=async()=>JSON.parse(await app.vault.read(app.vault.getAbstractFileByPath(path)))
`
const run = <T>(body: string): T =>
  evalAsync<T>(`(async()=>{${PRELUDE} return JSON.stringify(await (async()=>{${body}})())})()`)
/** What the canvas was doing, said when a wait gives up. */
const state = () =>
  run(`const v=view(),e=v?.editor,d=v?.documentLease?.document
    return {tool:e?.controls.tool(),picked:e?.controls.picked().ids,camera:v?.viewer.camera,dirty:d?.session.dirty,busy:d?.session.busy,
      waiting:e?.waiting,error:d?.error,ink:(v?.viewer.graph.abele?.ink??[]).length,events:(window.__canvasChrome?.events??[]).slice(-24),moves:window.__canvasChrome?.moves,stage:v?.viewer.stage.getBoundingClientRect().toJSON(),nodes:v?.viewer.graph.nodes.map(n=>[n.id,n.type,n.x,n.y,n.width,n.height]),corners:v&&[[363,166],[734,280]].map(([x,y])=>v.viewer.input.point({clientX:x,clientY:y})),leaves:app.workspace.getLeavesOfType('abele-canvas').filter(l=>l.view.file?.path===path).length,chromeClass:v?.contentEl.classList.contains('abele-canvas-view_chrome'),hosts:v?.contentEl.querySelectorAll('.abele-canvas-chrome-host').length,sameInput:v?.editor?.inputAdapter===v?.viewer.input,children:v&&[...v.contentEl.children].map(c=>[c.className,c.getBoundingClientRect().height|0,getComputedStyle(c).display])}`)
const until = async (expression: string) => {
  try {
    await expect
      .poll(() => run<boolean>(`return !!(${expression})`), { timeout: 15_000 })
      .toBe(true)
  } catch (error) {
    console.error('canvas state while waiting for', expression, JSON.stringify(state()))
    throw error
  }
}
const saved = () =>
  until(
    "view()?.documentLease&&!view().documentLease.document.session.dirty&&!view().documentLease.document.session.busy&&!button('Add text card').disabled"
  )
const cdp = (body: string) =>
  withNativeInput(() =>
    run(`
    const cdp=require('@electron/remote').getCurrentWebContents().debugger,owned=!cdp.isAttached();if(owned)cdp.attach('1.3')
    const mouse=(o)=>cdp.sendCommand('Input.dispatchMouseEvent',{button:'left',...o})
    const wait=(ms)=>new Promise(r=>setTimeout(r,ms))
    try {${body}} finally {if(owned)cdp.detach()}return true`)
  )
/** A press, or a press dragged to another place, by mouse or by finger. */
const input = async (from: number[], to = from) => {
  if (onPhone()) {
    if (from[0] === to[0] && from[1] === to[1]) tap(from[0], from[1])
    else swipe(from[0], from[1], to[0], to[1])
  } else
    await cdp(`
      await mouse({type:'mousePressed',x:${from[0]},y:${from[1]},buttons:1,clickCount:1})
      for(let i=1;i<=8;i++){await mouse({type:'mouseMoved',x:${from[0]}+(${to[0] - from[0]})*i/8,y:${from[1]}+(${to[1] - from[1]})*i/8,buttons:1});await wait(30)}
      await mouse({type:'mouseReleased',x:${to[0]},y:${to[1]},buttons:0,clickCount:1})`)
}
const double = async (at: number[]) => {
  if (onPhone()) driver(['doubletap', String(at[0]), String(at[1])])
  else
    await cdp(`
      for(const n of [1,2]){await mouse({type:'mousePressed',x:${at[0]},y:${at[1]},buttons:1,clickCount:n});await mouse({type:'mouseReleased',x:${at[0]},y:${at[1]},buttons:0,clickCount:n});await wait(60)}`)
}
/** The middle of a mark drawn over the canvas, which lets presses through to the canvas. */
const mark = (expression: string) =>
  run<number[] | null>(
    `const el=${expression};if(!el)return null;const r=el.getBoundingClientRect();return [Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)]`
  )
const center = (expression: string) =>
  run<
    number[] | null
  >(`const el=${expression};if(!el)return null;const r=el.getBoundingClientRect();
    const x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2),hit=document.elementFromPoint(x,y);
    if(!r.width||!r.height||r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight||!(el===hit||el.contains(hit)))return null;return [x,y]`)
const press = async (expression: string) => {
  await expect.poll(() => center(expression), { timeout: 15_000 }).not.toBeNull()
  await input(center(expression)!)
}
const type = async (text: string) => {
  if (onPhone()) typeText(text)
  else await cdp(`await cdp.sendCommand('Input.insertText',{text:${JSON.stringify(text)}})`)
}
const key = async (name: 'Enter' | 'Escape') => {
  if (onPhone()) {
    if (name === 'Enter') typeText('\n')
    return
  }
  const code = name === 'Enter' ? 13 : 27
  await cdp(`
    await cdp.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'${name}',code:'${name}',windowsVirtualKeyCode:${code}})
    await cdp.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'${name}',code:'${name}',windowsVirtualKeyCode:${code}})`)
}
const shot = (name: string) => {
  const path = `${SHOTS}/${name}-${onPhone() ? 'phone' : 'desktop'}.png`
  if (onPhone()) screenshot(path)
  else
    run(
      `const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(path)},image.toPNG());return true`
    )
}
/** Where a point of the canvas is on the screen. */
const screen = (x: number, y: number) =>
  run<number[]>(
    `const v=view().viewer,c=v.camera,r=v.stage.getBoundingClientRect();return [Math.round(r.left+(${x}-c.x)*c.zoom),Math.round(r.top+(${y}-c.y)*c.zoom)]`
  )
const middle = (id: string) =>
  run<number[]>(
    `const v=view().viewer,n=v.graph.nodes.find(n=>n.id===${JSON.stringify(id)}),c=v.camera,r=v.stage.getBoundingClientRect();return [Math.round(r.left+(n.x+n.width/2-c.x)*c.zoom),Math.round(r.top+(n.y+n.height/2-c.y)*c.zoom)]`
  )
const chrome = canvasChrome({ run, press, until, at: (p) => input(p), phone: onPhone() })
const reopen = async () => {
  run(
    `const old=app.workspace.getLeavesOfType('abele-canvas').filter(l=>l.view.file?.path===path)
    const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-canvas',state:{file:path},active:true});await app.workspace.revealLeaf(leaf)
    for(const l of old)l.detach();return true`
  )
  await until('view()?.editor&&view().contentEl.querySelector(".abele-canvas-chrome__tools")')
  run(`const f=window.__canvasChrome;f.events=[];const st=view().viewer.stage
    for(const t of ['pointerdown','pointerup','pointercancel','gotpointercapture','lostpointercapture'])st.addEventListener(t,e=>f.events.push([t,e.pointerType,e.pointerId,e.buttons,Math.round(e.clientX),Math.round(e.clientY),e.target.className?.baseVal??e.target.className]),true)
    let moves=0;st.addEventListener('pointermove',e=>{if(e.buttons)moves++;f.moves=moves},true)
    const input=view().viewer.input
    for(const m of ['down','up','cancel']){const fn=input[m].bind(input);input[m]=(e)=>{const r=fn(e);f.events.push(['input.'+m,r,!!input.gesture,!!input.connection]);return r}}
    const ports=input.ports
    for(const m of ['select','begin','complete','cancel','hold','dropped']){const fn=ports[m];if(!fn)continue;ports[m]=(...a)=>{const r=fn(...a);f.events.push(['ports.'+m,m==='select'?[...a[0]]:m==='complete'?a[0].map(o=>o.op):undefined,r]);return r}}
    let n=0;st.addEventListener('pointermove',e=>{if(e.buttons&&n++<2)f.events.push(['move',e.pointerType,e.pointerId,Math.round(e.clientX),Math.round(e.clientY),input.gesture?.box,input.marquee&&Math.round(input.marquee.width)])},true)
    view().editor.controls.watch(()=>{const ids=view().editor.controls.picked().ids.join(',');if(ids!==f.last){f.last=ids;f.events.push(['picked',ids])}})
    return true`)
  // The cards stand in the middle third of the stage, under the tools and clear of its edges.
  run(
    `const v=view().viewer,s=v.stage;v.setCamera({x:-60,y:-Math.max(80,s.clientHeight*.25),zoom:Math.min(1,s.clientWidth/820)});return true`
  )
}

describe.skipIf(!available)('the canvas by hand', () => {
  beforeAll(() => {
    run(`
      if(app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}))throw Error('Synthetic folder already exists')
      window.__canvasChrome={layout:app.workspace.getLayout()}
      await app.vault.createFolder(${JSON.stringify(DIR)});window.__canvasChrome.owned=true
      await app.vault.create(path,JSON.stringify({nodes:[
        {id:'alpha',type:'text',text:'Sample input',x:0,y:0,width:220,height:120},
        {id:'beta',type:'text',text:'Sample step',x:300,y:0,width:220,height:120},
        {id:'gamma',type:'text',text:'Sample result',x:300,y:260,width:220,height:120,styleAttributes:{shape:'diamond'}}
      ],edges:[]}))
      return true
    `)
  }, 120_000)
  afterAll(() => {
    run(`
      const fixture=window.__canvasChrome,leaves=[]
      app.workspace.iterateAllLeaves(l=>{if(l.view.file?.path.startsWith(${JSON.stringify(DIR + '/')}))leaves.push(l)})
      for(const leaf of leaves){leaf.view.documentLease?.document.discardDraft();leaf.detach()}
      document.querySelector('.menu')&&document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
      if(fixture?.owned){const folder=app.vault.getAbstractFileByPath(${JSON.stringify(DIR)});if(folder)await app.vault.delete(folder,true)}
      if(fixture?.layout)await app.workspace.changeLayout(fixture.layout)
      delete window.__canvasChrome;return true
    `)
  }, 120_000)

  it('stands the tools across the top of the tab, with the old rows out of sight', async () => {
    await reopen()
    const layout = run<{ bar: number[]; content: number[]; stage: number; old: string }>(`
      const bar=view().contentEl.querySelector('.abele-canvas-chrome__tools').getBoundingClientRect(),c=view().contentEl.getBoundingClientRect(),st=view().viewer.stage.getBoundingClientRect()
      return {bar:[bar.top,bar.width],content:[c.top,c.width],stage:st.top,old:getComputedStyle(view().contentEl.querySelector('.abele-canvas-editor-controls')).display}`)
    expect(layout.old).toBe('none')
    // Across the whole top of the tab, under its header, as a drawing's tools are.
    expect(Math.abs(layout.bar[0] - layout.content[0])).toBeLessThan(2)
    expect(layout.bar[1]).toBeGreaterThan(layout.content[1] - 2)
    // Nothing of the old rows keeps a strip over the canvas: it starts at the tab's top too.
    expect(Math.abs(layout.stage - layout.content[0])).toBeLessThan(2)
    shot('toolbar')
  }, 120_000)

  it('picks a shape with a press and draws a box over empty canvas with Select', async () => {
    await reopen()
    await chrome.click('Select canvas objects')
    await input(middle('gamma'))
    await until(`view().viewer.selection.has('gamma')&&view().viewer.selection.size===1`)
    if (onPhone()) return
    const camera = run<number[]>(`const c=view().viewer.camera;return [c.x,c.y]`)
    await input(screen(-30, -30), screen(560, 150))
    await until(`view().viewer.selection.has('alpha')&&view().viewer.selection.has('beta')`)
    expect(run<number[]>(`const c=view().viewer.camera;return [c.x,c.y]`)).toEqual(camera)
  }, 120_000)

  it('draws a frame around cards and names it on its label', async () => {
    await reopen()
    await chrome.click('Draw frame')
    await input(screen(-30, -30), screen(560, 150))
    await until(`document.activeElement?.matches('[data-frame-id][contenteditable="true"]')`)
    await type('Sample stage')
    await key('Enter')
    if (onPhone()) await until(`!document.activeElement?.matches('[contenteditable="true"]')||true`)
    await saved()
    await until(`(await read()).nodes.some(n=>n.type==='group'&&n.label==='Sample stage')`)
    const frame = run<{ x: number; width: number }>(
      `return (await read()).nodes.find(n=>n.type==='group')`
    )
    expect(frame.x).toBeLessThanOrEqual(0)
    expect(frame.x + frame.width).toBeGreaterThanOrEqual(520)
    expect(run<string>(`return view().editor.controls.tool()`)).toBe('select')
    shot('frame')
  }, 120_000)

  it("pulls a connection from a card's edge point and labels it with a double press", async () => {
    await reopen()
    await chrome.click('Select canvas objects')
    await input(middle('beta'))
    const point = `view().contentEl.querySelector('.abele-canvas-connect-point[data-side="bottom"]')`
    await until(point)
    // Let go just inside the shape's top: the connection sticks to the edge nearest the pointer.
    const from = mark(point)!,
      to = screen(410, 275)
    if (onPhone()) swipe(from[0], from[1], to[0], to[1])
    else
      await cdp(`
        await mouse({type:'mouseMoved',x:${from[0]},y:${from[1]},buttons:0})
        await mouse({type:'mousePressed',x:${from[0]},y:${from[1]},buttons:1,clickCount:1})
        for(let i=1;i<=8;i++){await mouse({type:'mouseMoved',x:${from[0]}+(${to[0] - from[0]})*i/8,y:${from[1]}+(${to[1] - from[1]})*i/8,buttons:1});await wait(30)}`)
    if (!onPhone()) {
      // Held over the target: the line in the accent, the target's nearest point lit.
      await until(`view().contentEl.querySelector('.abele-canvas-connect-point.is-active')`)
      shot('connection-drawing')
      await cdp(`await mouse({type:'mouseReleased',x:${to[0]},y:${to[1]},buttons:0,clickCount:1})`)
    }
    await saved()
    await until(
      `(await read()).edges.some(e=>e.fromNode==='beta'&&e.toNode==='gamma'&&e.fromSide==='bottom'&&e.toSide==='top')`
    )
    const gap = run<number[]>(`
      const v=view().viewer,c=v.camera,r=v.stage.getBoundingClientRect(),b=v.graph.nodes.find(n=>n.id==='beta'),g=v.graph.nodes.find(n=>n.id==='gamma')
      return [Math.round(r.left+(b.x+b.width/2-c.x)*c.zoom),Math.round(r.top+((b.y+b.height+g.y)/2-c.y)*c.zoom)]`)
    await double(gap)
    await until(`document.activeElement?.matches('.abele-canvas-chrome__label')`)
    await type('Sample feeds')
    await key('Enter')
    await saved()
    await until(`(await read()).edges.some(e=>e.label==='Sample feeds')`)
    shot('connection-labelled')
    // Let go over nothing: a menu there offers what to make at its end.
    await input(middle('alpha'))
    const right = `view().contentEl.querySelector('.abele-canvas-connect-point[data-side="right"]')`
    await until(right)
    const start = mark(right)!,
      end = screen(110, 330)
    await input(start, end)
    await until(menuItem('Card'))
    shot('connection-drop')
    await press(menuItem('Card'))
    await until(`view().editor.controls.editing()`)
    await type('Sample made at the end')
    if (onPhone()) await input(chrome.emptySpot())
    else await key('Escape')
    await saved()
    await until(
      `(await read()).nodes.some(n=>n.text==='Sample made at the end')&&(await read()).edges.length===2`
    )
  }, 120_000)

  it("offers the picked thing's more menu and makes a copy beside it", async () => {
    await reopen()
    await chrome.click('Select canvas objects')
    await input(middle('alpha'))
    await press(
      `view().contentEl.querySelector('.abele-canvas-chrome__picked [aria-label="More"]')`
    )
    await until(menuItem('Duplicate'))
    shot('more-menu')
    const before = run<number>('return (await read()).nodes.length')
    await press(menuItem('Duplicate'))
    await saved()
    await until(`(await read()).nodes.length===${before + 1}`)
    await chrome.click('Undo canvas change')
    await saved()
    await until(`(await read()).nodes.length===${before}`)
  }, 120_000)

  it('draws with a pen, two strokes running, each kept', async () => {
    await reopen()
    const before = run<number>('return ((await read()).abele?.ink??[]).length')
    const a = screen(40, 200),
      b = screen(240, 230)
    if (onPhone()) {
      await chrome.click('Draw with pen')
      swipe(a[0], a[1], b[0], b[1])
      await saved()
      swipe(a[0], a[1] + 40, b[0], b[1] + 40)
    } else {
      await chrome.click('Select canvas objects')
      // A Pencil draws whatever tool is in hand; the second stroke lands while the first saves.
      await cdp(`
        const pen=(o)=>mouse({pointerType:'pen',force:0.5,...o})
        for(const dy of [0,40]){
          await pen({type:'mousePressed',x:${a[0]},y:${a[1]}+dy,buttons:1,clickCount:1})
          for(let i=1;i<=10;i++){await pen({type:'mouseMoved',x:${a[0]}+(${b[0] - a[0]})*i/10,y:${a[1]}+dy+(${b[1] - a[1]})*i/10,buttons:1});await wait(12)}
          await pen({type:'mouseReleased',x:${b[0]},y:${b[1]}+dy,buttons:0,clickCount:1})
        }`)
    }
    await saved()
    await until(`((await read()).abele?.ink??[]).length===${before + 2}`)
    if (!onPhone()) expect(run<string>('return view().editor.controls.tool()')).toBe('select')
    shot('pencil')
  }, 120_000)
})
