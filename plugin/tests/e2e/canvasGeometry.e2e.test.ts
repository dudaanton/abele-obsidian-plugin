import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { driver, tap, swipe, screenshot } from './helpers/phone'
import { withNativeInput } from './helpers/nativeInput'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample canvas geometry'
const SHOTS = shotDir('canvas-geometry')
const PRELUDE = `
  const path=${JSON.stringify(`${DIR}/sample.canvas`)}
  const view=()=>app.workspace.getLeavesOfType('abele-canvas').find(l=>l.view.file?.path===path)?.view
  const button=label=>view()?.contentEl.querySelector('[aria-label="'+label+'"]')
  const read=async()=>JSON.parse(await app.vault.read(app.vault.getAbstractFileByPath(path)))
`
const run = <T>(body: string): T =>
  evalAsync<T>(`(async()=>{${PRELUDE} return JSON.stringify(await (async()=>{${body}})())})()`)
const until = async (expression: string) => {
  await expect.poll(() => run<boolean>(`return !!(${expression})`), { timeout: 15_000 }).toBe(true)
}
const saved = () =>
  until(
    "view()?.documentLease&&!view().documentLease.document.session.dirty&&!button('Undo canvas change').disabled"
  )
const point = (id: string, corner = false): number[] =>
  run(`
  const v=view(), n=v.viewer.graph.nodes.find(n=>n.id===${JSON.stringify(id)}), c=v.viewer.camera, r=v.viewer.stage.getBoundingClientRect()
  return [Math.round(r.left+(n.x+${corner ? 'n.width' : 'n.width/2'}-c.x)*c.zoom),Math.round(r.top+(n.y+${corner ? 'n.height' : 'n.height/2'}-c.y)*c.zoom)]
`)
const input = async (from: number[], to = from) => {
  if (onPhone()) {
    if (from[0] === to[0] && from[1] === to[1]) tap(from[0], from[1])
    else swipe(from[0], from[1], to[0], to[1])
  } else
    await withNativeInput(() =>
      run(`
    const cdp=require('@electron/remote').getCurrentWebContents().debugger,owned=!cdp.isAttached();if(owned)cdp.attach('1.3')
    try {
      await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:${from[0]},y:${from[1]},button:'left',buttons:1,clickCount:1})
      for(let i=1;i<=6;i++) {await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:${from[0]}+(${to[0] - from[0]})*i/6,y:${from[1]}+(${to[1] - from[1]})*i/6,button:'left',buttons:1});await new Promise(r=>setTimeout(r,30))}
      await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:${to[0]},y:${to[1]},button:'left',buttons:0,clickCount:1})
    } finally {if(owned)cdp.detach()}return true
  `)
    )
}
const click = async (label: string) => {
  await until(`button(${JSON.stringify(label)})&&!button(${JSON.stringify(label)}).disabled`)
  const coords = run<number[]>(
    `const r=button(${JSON.stringify(label)}).getBoundingClientRect();return [Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)]`
  )
  await input(coords)
}
const fit = async () => {
  await click('Fit diagram')
  await new Promise((r) => setTimeout(r, 350))
}
const shot = (name: string) => {
  const path = `${SHOTS}/${name}.png`
  if (onPhone()) screenshot(path)
  else
    run(
      `const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(path)},image.toPNG());return true`
    )
}

describe.skipIf(!available)('canvas selection and geometry with real pointer input', () => {
  beforeAll(() => {
    run(`
      if(app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}))throw Error('Synthetic folder already exists')
      window.__canvasGeometry={layout:app.workspace.getLayout()}
      await app.vault.createFolder(${JSON.stringify(DIR)});window.__canvasGeometry.owned=true
      await app.vault.create(${JSON.stringify(`${DIR}/sample-note.md`)},'A linked note with unchanged contents.')
      await app.vault.create(path,JSON.stringify({nodes:[
        {id:'note',type:'file',file:${JSON.stringify(`${DIR}/sample-note.md`)},x:0,y:0,width:240,height:160},
        {id:'alpha',type:'text',text:'First concept',x:320,y:0,width:240,height:160},
        {id:'beta',type:'text',text:'Second concept',x:0,y:240,width:240,height:160}
      ],edges:[{id:'flow',fromNode:'note',toNode:'alpha',label:'Connected'}]}))
      const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-canvas',state:{file:path},active:true});await app.workspace.revealLeaf(leaf);return true
    `)
  }, 120_000)
  afterAll(() => {
    run(`
      const f=window.__canvasGeometry
      const leaves=[];app.workspace.iterateAllLeaves(l=>{if(l.view.file?.path.startsWith(${JSON.stringify(DIR + '/')}))leaves.push(l)})
      for(const leaf of leaves){leaf.view.documentLease?.document.discardDraft();leaf.detach()}
      if(f?.owned){const folder=app.vault.getAbstractFileByPath(${JSON.stringify(DIR)});if(folder)await app.vault.delete(folder,true)}
      if(f?.layout)await app.workspace.changeLayout(f.layout)
      delete window.__canvasGeometry;return true
    `)
  }, 120_000)

  it('moves and resizes a note, keeping content and connected edges; one gesture is one undo', async () => {
    await until('view()?.editor')
    expect(
      run<boolean>(`const v=view().viewer,c=v.camera;return v.graph.nodes.every(n=>
      (n.x-c.x)*c.zoom>=0&&(n.y-c.y)*c.zoom>=0&&
      (n.x+n.width-c.x)*c.zoom<=v.stage.clientWidth&&
      (n.y+n.height-c.y)*c.zoom<=v.stage.clientHeight)`)
    ).toBe(true)
    await fit()
    const start = point('note'),
      zoom = run<number>('return view().viewer.camera.zoom')
    await input(start, [start[0] + 36, start[1] + 24])
    await saved()
    const moved = run<{ x: number; y: number }>(
      "return (await read()).nodes.find(n=>n.id==='note')"
    )
    expect(moved.x).toBeCloseTo(36 / zoom, 0)
    expect(moved.y).toBeCloseTo(24 / zoom, 0)
    expect(run<number>('return view().documentLease.document.session.history.undo')).toBe(1)
    const corner = point('note', true)
    await input(corner, [corner[0] + 24, corner[1] + 18])
    await saved()
    const result = run<{ width: number; height: number; note: string; edges: number }>(`
      const g=await read(),n=g.nodes.find(n=>n.id==='note')
      return {width:n.width,height:n.height,note:await app.vault.read(app.vault.getAbstractFileByPath(n.file)),edges:g.edges.length}
    `)
    expect(result.width).toBeCloseTo(240 + 24 / zoom, 0)
    expect(result.height).toBeCloseTo(160 + 18 / zoom, 0)
    expect(result.note).toBe('A linked note with unchanged contents.')
    expect(result.edges).toBe(1)
    shot('selected-note-resized')
    await click('Undo canvas change')
    await saved()
    expect(run<number>("return (await read()).nodes.find(n=>n.id==='note').width")).toBe(240)
    await click('Redo canvas change')
    await saved()
    expect(run<number>("return (await read()).nodes.find(n=>n.id==='note').width")).toBe(
      result.width
    )
  }, 120_000)

  it('groups three touch-selected cards, moves the group, ungroups and undoes human and agent changes', async () => {
    await fit()
    await click('Toggle multiple selection')
    // Toggle the already-selected note off and on, then add the two other cards.
    await input(point('note'))
    await input(point('note'))
    await input(point('alpha'))
    await input(point('beta'))
    expect(run<number>('return view().viewer.selection.size')).toBe(3)
    await click('Group selected cards')
    await saved()
    const before = run<{ id: string; x: number; y: number }[]>('return (await read()).nodes')
    const group = before.find((n) => !['note', 'alpha', 'beta'].includes(n.id))!
    await click('Toggle multiple selection')
    await fit()
    const coords = run<number[]>(
      `const v=view(),n=v.viewer.graph.nodes.find(n=>n.type==='group'),c=v.viewer.camera,r=v.viewer.stage.getBoundingClientRect();return [Math.round(r.left+(n.x+n.width/2-c.x)*c.zoom),Math.round(r.top+(n.y+20-c.y)*c.zoom)]`
    )
    const zoom = run<number>('return view().viewer.camera.zoom')
    await input(coords, [coords[0] + 24, coords[1] + 18])
    await saved()
    const moved = run<typeof before>('return (await read()).nodes')
    for (const n of moved) {
      expect(n.x - before.find((b) => b.id === n.id)!.x).toBeCloseTo(24 / zoom, 0)
      expect(n.y - before.find((b) => b.id === n.id)!.y).toBeCloseTo(18 / zoom, 0)
    }
    shot('moved-group')
    await click('Ungroup selected group')
    await saved()
    expect(run<number>('return (await read()).nodes.length')).toBe(3)
    run(`
      const scope=new window.__abeleTest.ScopeResolver();scope.setFullVaultAccess(true)
      const ctx={scope,interactive:true},tools=Object.fromEntries(window.__abeleTest.createAgentTools().map(t=>[t.name,t]))
      const read=JSON.parse((await tools.canvas_read.execute('sample-read',{path},undefined,ctx)).content[0].text)
      await tools.canvas_edit.execute('sample-agent',{path,revision:read.revision,ops:[{op:'update',id:'alpha',patch:{text:'Agent continuation'}}]},undefined,ctx)
      return true
    `)
    await saved()
    await click('Undo canvas change')
    await saved()
    expect(run<string>("return (await read()).nodes.find(n=>n.id==='alpha').text")).toBe(
      'First concept'
    )
    await click('Undo canvas change')
    await saved()
    expect(
      run<boolean>(`return (await read()).nodes.some(n=>n.id===${JSON.stringify(group.id)})`)
    ).toBe(true)
    await click('Undo canvas change')
    await saved()
    const restored = run<typeof before>('return (await read()).nodes')
    expect(restored.map((n) => [n.id, n.x, n.y])).toEqual(before.map((n) => [n.id, n.x, n.y]))
    await click('Redo canvas change')
    await saved()
    await click('Redo canvas change')
    await saved()
    await click('Redo canvas change')
    await saved()
    expect(run<string>("return (await read()).nodes.find(n=>n.id==='alpha').text")).toBe(
      'Agent continuation'
    )
    shot('ungrouped-history')
  }, 120_000)

  it('uses two fingers for navigation without leaving an accidental card move', async () => {
    await fit()
    const before = run<string>('return await app.vault.read(app.vault.getAbstractFileByPath(path))')
    const history = run<number>('return view().documentLease.document.session.history.undo')
    const zoom = run<number>('return view().viewer.camera.zoom')
    if (onPhone()) driver(['pinch', '1.3'])
    else
      await withNativeInput(() =>
        run(`
      const v=view(),n=v.viewer.graph.nodes.find(n=>n.id==='note'),c=v.viewer.camera,r=v.viewer.stage.getBoundingClientRect(),
        x=Math.round(r.left+(n.x+n.width/2-c.x)*c.zoom),y=Math.round(r.top+(n.y+n.height/2-c.y)*c.zoom)
      const cdp=require('@electron/remote').getCurrentWebContents().debugger,owned=!cdp.isAttached();if(owned)cdp.attach('1.3')
      try {
        const first={id:1,x,y},second={id:2,x:x+80,y:y+40}
        await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[first]})
        await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...first,x:x+16,y:y+12}]})
        await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...first,x:x+16,y:y+12},second]})
        await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...first,x:x-20,y:y-10},{...second,x:x+100,y:y+50}]})
        await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
      } finally {if(owned)cdp.detach()}return true
    `)
      )
    expect(run<string>('return await app.vault.read(app.vault.getAbstractFileByPath(path))')).toBe(
      before
    )
    expect(run<number>('return view().documentLease.document.session.history.undo')).toBe(history)
    expect(run<boolean>('return view().documentLease.document.session.dirty')).toBe(false)
    expect(run<number>('return view().viewer.camera.zoom')).not.toBe(zoom)
    await input(point('note'))
    expect(run<boolean>("return view().viewer.selection.has('note')")).toBe(true)
    shot('pinch-selection')
  }, 120_000)
})
