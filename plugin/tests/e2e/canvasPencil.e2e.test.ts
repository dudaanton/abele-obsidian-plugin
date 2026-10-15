import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { withNativeInput } from './helpers/nativeInput'
import { screenshot } from './helpers/phone'
import { shotDir } from './helpers/shots'
import { randomUUID } from 'node:crypto'

/**
 * A Pencil on the canvas does what the tool in hand does, and its hovering tip goes when the pen
 * does. The desktop presses a real pen through the app's input (the debugger's pen pointer); the
 * phone has no pen, so there the same pen events are dispatched on the stage. The desktop runs
 * once at its own size and once as an emulated phone.
 */
targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = `Sample canvas pencil ${randomUUID()}`,
  SHOTS = shotDir('canvas-pencil')
const PRELUDE = `
  const path=${JSON.stringify(`${DIR}/sample.canvas`)}
  const view=()=>app.workspace.getLeavesOfType('abele-canvas').find(l=>l.view.file?.path===path)?.view
  const graph=()=>view().viewer.graph
  const ink=()=>(graph().abele?.ink??[]).length
  const lines=()=>(graph().abele?.lines??[]).length
  const kinds=()=>graph().nodes.map(n=>n.type)
  const ring=()=>!!view().viewer.stage.querySelector('.abele-canvas-pen-hover')
  const at=(fx,fy)=>{const r=view().viewer.stage.getBoundingClientRect();return[Math.round(r.left+r.width*fx),Math.round(r.top+r.height*fy)]}
  const pen=(type,x,y,buttons)=>{const target=document.elementFromPoint(x,y)??view().viewer.stage
    target.dispatchEvent(new PointerEvent(type,{pointerId:41,pointerType:'pen',isPrimary:true,clientX:x,clientY:y,button:type==='pointermove'?-1:0,buttons,pressure:buttons?0.6:0,bubbles:true,cancelable:true,composed:true}))}
`
const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async()=>{${PRELUDE}return JSON.stringify(await(async()=>{${body}})())})()`,
    120_000
  )
const until = async (expression: string) => {
  await expect.poll(() => run<boolean>(`return !!(${expression})`), { timeout: 20_000 }).toBe(true)
}
/** The stage's point at fractions of its width and height, on the screen. */
const at = (fx: number, fy: number) => run<number[]>(`return at(${fx},${fy})`)
const cdp = (body: string) =>
  withNativeInput(() =>
    run(`
    const cdp=require('@electron/remote').getCurrentWebContents().debugger,owned=!cdp.isAttached();if(owned)cdp.attach('1.3')
    const send=(type,x,y,buttons)=>cdp.sendCommand('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'&&!buttons?'none':'left',buttons,clickCount:type==='mouseMoved'?0:1,pointerType:'pen',force:buttons?0.6:0})
    try{${body}}finally{if(owned)cdp.detach()}return true
  `)
  )
/** A pen pressed at one point, drawn to another and lifted. */
const stroke = async (from: number[], to: number[]) => {
  const steps = 10
  if (onPhone())
    run(`
    pen('pointerdown',${from[0]},${from[1]},1)
    for(let i=1;i<=${steps};i++){pen('pointermove',${from[0]}+(${to[0] - from[0]})*i/${steps},${from[1]}+(${to[1] - from[1]})*i/${steps},1);await new Promise(r=>setTimeout(r,16))}
    pen('pointerup',${to[0]},${to[1]},0);return true`)
  else
    await cdp(`
    await send('mousePressed',${from[0]},${from[1]},1)
    for(let i=1;i<=${steps};i++){await send('mouseMoved',${from[0]}+(${to[0] - from[0]})*i/${steps},${from[1]}+(${to[1] - from[1]})*i/${steps},1);await new Promise(r=>setTimeout(r,16))}
    await send('mouseReleased',${to[0]},${to[1]},0)`)
}
/** A pen held over the screen, not touching it. */
const hover = async (p: number[]) => {
  if (onPhone()) run(`pen('pointermove',${p[0]},${p[1]},0);return true`)
  else await cdp(`await send('mouseMoved',${p[0]},${p[1]},0)`)
}
const shot = (name: string) => {
  const path = `${SHOTS}/${name}${emulated ? '-emulated-phone' : ''}.png`
  if (onPhone()) screenshot(path)
  else
    run(
      `const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(path)},image.toPNG());return true`
    )
}
/** The desktop pass that stands in for a phone, which the pictures are named after. */
let emulated = false
const use = (tool: string) =>
  run(`view().editor.controls.useTool(${JSON.stringify(tool)});return true`)
/** Ends the card just put down, whose field opened for its words. */
const leaveCard = async () => {
  run(
    `const field=view().contentEl.querySelector('textarea');field?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true`
  )
  await until('!view().editor.controls.editing()')
}

for (const mobile of onPhone() ? [false] : [false, true])
  describe.skipIf(!available)(`a Pencil on the canvas${mobile ? ', emulated phone' : ''}`, () => {
    let size: number[] | null = null
    beforeAll(async () => {
      emulated = mobile
      if (mobile) {
        size = evalJson<number[]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)
        evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390, 844)`)
        await reloadApp('app.emulateMobile(true)')
      }
      run(`
    if(app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}))throw Error('Synthetic folder already exists')
    window.__canvasPencil={layout:app.workspace.getLayout()}
    if(!${onPhone() || mobile}){app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse()}
    await app.vault.createFolder(${JSON.stringify(DIR)});window.__canvasPencil.owned=true
    await app.vault.create(path,JSON.stringify({nodes:[],edges:[]}))
    const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-canvas',state:{file:path},active:true});await app.workspace.revealLeaf(leaf);return true
  `)
      // Outside a test there is no expect.poll: wait for the open canvas by hand.
      for (
        let i = 0;
        !run<boolean>(`return !!(view()?.editor&&view().viewer.stage.clientWidth>0)`);
        i++
      ) {
        if (i > 80) throw new Error('The sample canvas never opened')
        await new Promise((r) => setTimeout(r, 250))
      }
      run(`view().viewer.setCamera({x:0,y:0,zoom:1});return true`)
    }, 180_000)
    afterAll(async () => {
      run(`
    const state=window.__canvasPencil,leaves=[];app.workspace.iterateAllLeaves(l=>{if(l.view.file?.path.startsWith(${JSON.stringify(DIR + '/')}))leaves.push(l)})
    for(const leaf of leaves){leaf.view.documentLease?.document.discardDraft();leaf.detach()}
    if(state?.owned){const folder=app.vault.getAbstractFileByPath(${JSON.stringify(DIR)});if(folder)await app.vault.delete(folder,true)}
    if(state)await app.workspace.changeLayout(state.layout)
    delete window.__canvasPencil;return true
  `)
      if (size) {
        evalRaw(
          `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`
        )
        await reloadApp('app.emulateMobile(false)')
      }
    }, 180_000)

    it('does what the tool in hand does, one tool after another', async () => {
      // Each tool has a row of its own, so what one leaves is not under the next.
      const row = (i: number) => [at(0.15, 0.2 + i * 0.06), at(0.45, 0.22 + i * 0.06)] as const
      const before = () =>
        run<{ ink: number; lines: number; kinds: string[] }>(
          'return {ink:ink(),lines:lines(),kinds:kinds()}'
        )

      await use('pen')
      let was = before()
      await stroke(...row(0))
      await until(`ink()===${was.ink + 1}`)
      expect(run<string>('return graph().abele.ink.at(-1).tool')).toBe('pen')

      await use('marker')
      await stroke(...row(1))
      await until(`ink()===${was.ink + 2}`)
      expect(run<string>('return graph().abele.ink.at(-1).tool')).toBe('marker')
      shot('pen-and-marker')

      for (const [i, tool] of (['select', 'lasso', 'connect'] as const).entries()) {
        await use(tool)
        was = before()
        await stroke(...row(2 + i))
        await new Promise((r) => setTimeout(r, 300))
        expect(before(), `${tool}: a pen draws nothing`).toEqual(was)
      }

      for (const [i, tool] of (['card', 'shape'] as const).entries()) {
        await use(tool)
        was = before()
        await stroke(...row(5 + i))
        await until(`kinds().length===${was.kinds.length + 1}`)
        expect(before().ink, `${tool}: no ink`).toBe(was.ink)
        await leaveCard()
      }

      await use('frame')
      was = before()
      await stroke(...row(7))
      await until(`kinds().includes('group')`)
      expect(before().ink).toBe(was.ink)
      // The new frame's name opens for writing, and on a phone its keyboard covers the rows below:
      // the name is left as it is and the keyboard put away before the next tool.
      run(`view().editor.controls.name(null);document.activeElement?.blur?.();return true`)
      await until(
        '!view().editor.controls.naming()&&!document.activeElement?.matches?.("input,textarea")'
      )
      await new Promise((r) => setTimeout(r, 500))

      for (const [i, tool] of (['line', 'arrow'] as const).entries()) {
        await use(tool)
        was = before()
        await stroke(...row(8 + i))
        await until(`lines()===${was.lines + 1}`)
        expect(before().ink, `${tool}: no ink`).toBe(was.ink)
      }
      shot('every-tool')

      // The eraser sweeps across the pen's row and takes its stroke away.
      // A card put down on a phone is brought into view, which moves the canvas: back to the start.
      run(`view().viewer.setCamera({x:0,y:0,zoom:1});return true`)
      await use('eraser')
      was = before()
      // The pen's row crosses x 0.3 at y 0.21 and the marker's at 0.27: the sweep meets only the first.
      const penStroke = run<string>("return graph().abele.ink.find(i=>i.tool==='pen').id")
      await stroke(at(0.3, 0.18), at(0.3, 0.24))
      await until(
        `ink()===${was.ink - 1}&&!graph().abele.ink.some(i=>i.id===${JSON.stringify(penStroke)})`
      )

      // With Navigate in hand the pen carries the canvas.
      await use('pan')
      was = before()
      const camera = run<{ x: number; y: number }>('return view().viewer.camera')
      await stroke(at(0.7, 0.5), at(0.8, 0.6))
      await until(`view().viewer.camera.x!==${camera.x}`)
      expect(before()).toEqual(was)
    }, 180_000)

    it('shows the tip only while it would draw, and lets it go when the pen does', async () => {
      run(`view().viewer.setCamera({x:0,y:0,zoom:1});return true`)
      await use('pen')
      await hover(at(0.6, 0.85))
      await until('ring()')
      shot('pen-tip')
      // The pen taken away with nothing said: the tip goes once its moves stop.
      await until('!ring()')

      await hover(at(0.62, 0.85))
      await until('ring()')
      // Taken away with a word from the platform.
      for (const type of ['pointerleave', 'pointercancel']) {
        run(
          `const s=view().viewer.stage;s.dispatchEvent(new PointerEvent(${JSON.stringify(type)},{pointerId:41,pointerType:'pen'}));return true`
        )
        await until('!ring()')
        await hover(at(0.64, 0.85))
        await until('ring()')
      }

      // Another tool in hand: no tip at all.
      await use('select')
      await until('!ring()')
      await hover(at(0.66, 0.85))
      await new Promise((r) => setTimeout(r, 200))
      expect(run<boolean>('return ring()')).toBe(false)
      shot('no-tip-with-select')
    }, 120_000)
  })
