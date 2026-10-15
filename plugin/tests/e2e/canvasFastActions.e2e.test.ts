import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { swipe, tap, screenshot } from './helpers/phone'
import { withNativeInput } from './helpers/nativeInput'
import { shotDir } from './helpers/shots'
import { randomUUID } from 'node:crypto'
import { dismissOwnNotices } from './helpers/ownNotices'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = `Sample canvas fast actions ${randomUUID()}`,
  SHOTS = shotDir('canvas-fast-actions')
const PRELUDE = `
  const path=${JSON.stringify(`${DIR}/sample.canvas`)}
  const view=()=>app.workspace.getLeavesOfType('abele-canvas').find(l=>l.view.file?.path===path)?.view
  const button=label=>view()?.contentEl.querySelector('[aria-label="'+label+'"]')
  const read=async()=>JSON.parse(await app.vault.read(app.vault.getAbstractFileByPath(path)))
  const ink=g=>(g.abele?.ink?.length??0)+g.nodes.reduce((n,c)=>n+(c.abele?.ink?.length??0),0)
`
const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async()=>{${PRELUDE}return JSON.stringify(await(async()=>{${body}})())})()`,
    120_000
  )
const until = async (expression: string, timeout = 30_000) => {
  await expect.poll(() => run<boolean>(`return !!(${expression})`), { timeout }).toBe(true)
}
/** Every change made is written and nothing waits any more. */
const settled = () =>
  until(
    'view()?.documentLease&&!view().documentLease.document.session.dirty&&!view().documentLease.document.session.busy'
  )
/** Gestures one after another, with no pause for the save between them. */
const gestures = async (list: number[][][]) => {
  if (onPhone()) {
    for (const [from, to] of list)
      if (from[0] === to[0] && from[1] === to[1]) tap(from[0], from[1])
      else swipe(from[0], from[1], to[0], to[1])
    return
  }
  await withNativeInput(() =>
    run(`
    const cdp=require('@electron/remote').getCurrentWebContents().debugger,owned=!cdp.isAttached();if(owned)cdp.attach('1.3')
    const mouse=(type,x,y,buttons)=>cdp.sendCommand('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:1})
    try {
      for(const [[x0,y0],[x1,y1]] of ${JSON.stringify(list)}){
        await mouse('mousePressed',x0,y0,1)
        for(let i=1;i<=6;i++){await mouse('mouseMoved',x0+(x1-x0)*i/6,y0+(y1-y0)*i/6,1);await new Promise(r=>setTimeout(r,8))}
        await mouse('mouseReleased',x1,y1,0)
      }
    }finally{if(owned)cdp.detach()}return true
  `)
  )
}
const click = async (label: string) => {
  await until(`button(${JSON.stringify(label)}) && !button(${JSON.stringify(label)}).disabled`)
  const [x, y] = run<number[]>(
    `const r=button(${JSON.stringify(label)}).getBoundingClientRect();return[Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)]`
  )
  await gestures([
    [
      [x, y],
      [x, y],
    ],
  ])
}
const fit = async () => {
  await click('Fit diagram')
  await new Promise((r) => setTimeout(r, 350))
}
/** A screen point at a fraction of the card, read from what is on screen now. */
const at = (fx: number, fy: number): number[] =>
  run(`
  const v=view().viewer,c=v.camera,r=v.stage.getBoundingClientRect(),n=v.graph.nodes[0]
  return [Math.round(r.left+(n.x+n.width*${fx}-c.x)*c.zoom),Math.round(r.top+(n.y+n.height*${fy}-c.y)*c.zoom)]
`)
/** Hold every vault write of this view open, so the next action surely lands during a save. */
const slowWrites = (ms: number) =>
  run(
    ms === 0
      ? 'delete app.vault.process;return true'
      : `const original=Object.getPrototypeOf(app.vault).process
    app.vault.process=async function(...a){await new Promise(r=>setTimeout(r,${ms}));return original.apply(this,a)};return true`
  )
const shot = (name: string) => {
  const path = `${SHOTS}/${name}.png`
  if (onPhone()) screenshot(path)
  else
    run(
      `const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(path)},image.toPNG());return true`
    )
}

describe.skipIf(!available)('fast canvas actions are all saved', () => {
  beforeAll(
    () =>
      run(`
    if(app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}))throw Error('Synthetic folder already exists')
    window.__canvasFast={layout:app.workspace.getLayout()}
    if(!${onPhone()}){app.workspace.leftSplit.collapse();app.workspace.rightSplit.collapse()}
    await app.vault.createFolder(${JSON.stringify(DIR)});window.__canvasFast.owned=true
    await app.vault.create(path,JSON.stringify({nodes:[{id:'card',type:'text',text:'Sample card',x:0,y:0,width:400,height:300},{id:'far',type:'text',text:'Far card',x:900,y:700,width:100,height:80}],edges:[]}))
    const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-canvas',state:{file:path},active:true});await app.workspace.revealLeaf(leaf);return true
  `),
    120_000
  )
  afterAll(() => {
    slowWrites(0)
    run(`
    document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
    const state=window.__canvasFast,leaves=[];app.workspace.iterateAllLeaves(l=>{if(l.view.file?.path.startsWith(${JSON.stringify(DIR + '/')}))leaves.push(l)})
    for(const leaf of leaves){leaf.view.documentLease?.document.discardDraft();leaf.detach()}
    if(state?.owned){const folder=app.vault.getAbstractFileByPath(${JSON.stringify(DIR)});if(folder)await app.vault.delete(folder,true)}
    if(state)await app.workspace.changeLayout(state.layout)
    delete window.__canvasFast;return true
  `)
    dismissOwnNotices('Saved whole canvas')
  }, 120_000)

  const strokes = (row: number): number[][][] =>
    [0, 1, 2].map((i) => [
      at(0.15, 0.15 + row * 0.35 + i * 0.1),
      at(0.6, 0.15 + row * 0.35 + i * 0.1),
    ])

  it('saves every stroke of a quick run, each its own undo step', async () => {
    await until('view()?.editor')
    await click('Canvas drawing tools')
    await click('Draw with pen')
    await until('button("Draw with pen").getAttribute("aria-pressed")==="true"')
    await fit()
    const undo = () => run<number>('return view().documentLease.document.session.history.undo')
    await gestures(strokes(0))
    await settled()
    expect(run<number>('return ink(await read())')).toBe(3)
    expect(undo()).toBe(3)
    // Now with each write held open, so every later stroke is made during a save.
    slowWrites(onPhone() ? 4000 : 1500)
    try {
      await gestures(strokes(1))
      // All six are on screen at once, while the file is still behind.
      await until('ink(view().viewer.graph)===6&&ink(await read())<6', 10_000)
      shot('strokes-during-save')
      await settled()
    } finally {
      slowWrites(0)
      await click('Canvas drawing tools')
    }
    expect(run<number>('return ink(await read())')).toBe(6)
    expect(undo()).toBe(6)
  }, 180_000)

  it('saves a resize made right after a move', async () => {
    await fit()
    const before = run<{ x: number; y: number; width: number; height: number }>(
      'return (await read()).nodes[0]'
    )
    slowWrites(onPhone() ? 4000 : 1500)
    try {
      const start = at(0.5, 0.5)
      await gestures([[start, [start[0] + 30, start[1] + 20]]])
      // The corner of the card where it now is on screen, before its move is saved.
      const corner = at(1, 1)
      expect(
        run<boolean>(
          `return view().viewer.stage.contains(document.elementFromPoint(${corner[0]},${corner[1]}))`
        ),
        'the corner is on the canvas'
      ).toBe(true)
      await gestures([[corner, [corner[0] + 40, corner[1] + 30]]])
      await settled()
    } finally {
      slowWrites(0)
    }
    const after = run<typeof before>('return (await read()).nodes[0]')
    expect(after.x).toBeGreaterThan(before.x)
    expect(after.y).toBeGreaterThan(before.y)
    expect(after.width).toBeGreaterThan(before.width)
    expect(after.height).toBeGreaterThan(before.height)
    shot('move-then-resize')
  }, 180_000)

  it('writes local changes before an agent reads the canvas', async () => {
    await click('Canvas drawing tools')
    await click('Draw with pen')
    const before = run<number>('return ink(await read())')
    await gestures(strokes(0).slice(0, 1))
    await until('ink(view().viewer.graph)===' + (before + 1))
    const read = run<{ ink: number; file: number }>(
      `const scope=new window.__abeleTest.ScopeResolver();scope.setFullVaultAccess(true);const tools=Object.fromEntries(window.__abeleTest.createAgentTools().map(t=>[t.name,t]))
      const result=await tools.canvas_read.execute('sample-read',{path},undefined,{scope,interactive:true})
      return {ink:JSON.stringify(result).split('"points"').length-1,file:ink(await read())}`
    )
    expect(read.file).toBe(before + 1)
    await settled()
    await click('Canvas drawing tools')
  }, 120_000)

  it('shows all of it again after the canvas is reopened', async () => {
    const saved = run<{ nodes: unknown[] }>('return await read()')
    run(
      `const leaf=view().leaf;await leaf.setViewState({type:'empty'});await leaf.setViewState({type:'abele-canvas',state:{file:path},active:true});await app.workspace.revealLeaf(leaf);return true`
    )
    await until('view()?.editor')
    expect(run<number>('return ink(view().viewer.graph)')).toBe(7)
    expect(run<unknown>('return view().viewer.graph.nodes[0]')).toMatchObject(
      saved.nodes[0] as object
    )
    shot('reopened')
  }, 120_000)
})
