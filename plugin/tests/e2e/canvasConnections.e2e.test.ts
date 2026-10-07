import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { tap, swipe, typeText, screenshot } from './helpers/phone'
import { withNativeInput } from './helpers/nativeInput'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample canvas connections'
const SHOTS = shotDir('canvas-connections')
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
    "view()?.documentLease&&!view().documentLease.document.session.dirty&&!button('Add text card').disabled"
  )
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
      for(let i=1;i<=8;i++){await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:${from[0]}+(${to[0] - from[0]})*i/8,y:${from[1]}+(${to[1] - from[1]})*i/8,button:'left',buttons:1});await new Promise(r=>setTimeout(r,30))}
      await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:${to[0]},y:${to[1]},button:'left',buttons:0,clickCount:1})
    } finally {if(owned)cdp.detach()}return true
  `)
    )
}
const press = async (expression: string) => {
  const geometry = `const el=${expression};if(!el)return null;const r=el.getBoundingClientRect();
    const x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2),hit=document.elementFromPoint(x,y);
    if(!r.width||!r.height||r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight||!el.contains(hit))return null;return [x,y]`
  await expect.poll(() => run<number[] | null>(geometry), { timeout: 15_000 }).not.toBeNull()
  await input(run<number[]>(geometry))
}
const click = async (label: string) => {
  await until(`button(${JSON.stringify(label)})&&!button(${JSON.stringify(label)}).disabled`)
  await press(`button(${JSON.stringify(label)})`)
}
const point = (id: string, corner = false): number[] =>
  run(`
  const v=view().viewer,n=v.graph.nodes.find(n=>n.id===${JSON.stringify(id)}),c=v.camera,r=v.stage.getBoundingClientRect()
  return [Math.round(r.left+(n.x+${corner ? 'n.width' : 'n.width/2'}-c.x)*c.zoom),Math.round(r.top+(n.y+${corner ? 'n.height' : 'n.height/2'}-c.y)*c.zoom)]
`)
const endpoint = (end: 'from' | 'to') =>
  run<number[]>(
    `const r=view().contentEl.querySelector('[data-end="${end}"]').getBoundingClientRect();return [Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)]`
  )
const fit = async () => {
  await click('Fit diagram')
  await new Promise((r) => setTimeout(r, 350))
}
const type = async (text: string) => {
  if (onPhone()) {
    await new Promise((r) => setTimeout(r, 500))
    typeText(text)
  } else
    await withNativeInput(() =>
      run(
        `const cdp=require('@electron/remote').getCurrentWebContents().debugger,owned=!cdp.isAttached();if(owned)cdp.attach('1.3');try{await cdp.sendCommand('Input.insertText',{text:${JSON.stringify(text)}})}finally{if(owned)cdp.detach()}return true`
      )
    )
}
const shot = (name: string) => {
  const path = `${SHOTS}/${name}.png`
  if (onPhone()) screenshot(path)
  else
    run(
      `const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(path)},image.toPNG());return true`
    )
}
const reopen = async () => {
  run(
    `const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-canvas',state:{file:path},active:true});await app.workspace.revealLeaf(leaf);return true`
  )
  await until('view()?.editor')
}

describe.skipIf(!available)('shapes and connections with real pointer input', () => {
  beforeAll(() => {
    run(`
      if(app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}))throw Error('Synthetic folder already exists')
      window.__canvasConnections={layout:app.workspace.getLayout()}
      await app.vault.createFolder(${JSON.stringify(DIR)});window.__canvasConnections.owned=true
      await app.vault.create(path,JSON.stringify({nodes:[
        {id:'alpha',type:'text',text:'Input',x:0,y:0,width:220,height:120},
        {id:'beta',type:'text',text:'Process',x:360,y:0,width:220,height:120},
        {id:'gamma',type:'text',text:'Result',x:360,y:240,width:220,height:120}
      ],edges:[],abele:{future:{opaque:true}}}))
      return true
    `)
  }, 120_000)
  afterAll(() => {
    run(`
      const fixture=window.__canvasConnections,leaves=[]
      app.workspace.iterateAllLeaves(l=>{if(l.view.file?.path.startsWith(${JSON.stringify(DIR + '/')}))leaves.push(l)})
      for(const leaf of leaves){leaf.view.documentLease?.document.discardDraft();leaf.detach()}
      if(fixture?.owned){const folder=app.vault.getAbstractFileByPath(${JSON.stringify(DIR)});if(folder)await app.vault.delete(folder,true)}
      if(fixture?.layout)await app.workspace.changeLayout(fixture.layout)
      delete window.__canvasConnections;return true
    `)
  }, 120_000)

  it('adds a shape with typed text and changes a selected card into a shape', async () => {
    await reopen()
    await click('Shapes and connections')
    shot('shape-palette')
    await click('Add canvas shape')
    await press('view().contentEl.querySelector("textarea")')
    await type('A new shape')
    await click('Save text')
    await saved()
    expect(
      run<boolean>(
        "return (await read()).nodes.some(n=>n.text==='A new shape'&&n.styleAttributes.shape==='rectangle')"
      )
    ).toBe(true)
    await click('Delete selected card')
    await saved()
    await fit()
    await input(point('alpha'))
    await click('Shapes and connections')
    await click('Apply selected shape')
    await saved()
    expect(
      run<string>("return (await read()).nodes.find(n=>n.id==='alpha').styleAttributes.shape")
    ).toBe('rectangle')
  }, 120_000)

  it('connects cards, changes the caption and arrow, reconnects an endpoint and undoes', async () => {
    await click('Draw connection')
    await fit()
    await input(point('alpha'), point('beta'))
    await saved()
    const edge = run<{ id: string; fromNode: string; toNode: string }>(
      'return (await read()).edges[0]'
    )
    expect(edge).toMatchObject({ fromNode: 'alpha', toNode: 'beta' })
    await click('Select canvas objects')
    await click('Shapes and connections') // Close the palette; leave room for the property sheet.
    await press('view().contentEl.querySelector(".abele-canvas-connection-properties summary")')
    await press('view().contentEl.querySelector(\'[aria-label="Connection label"]\')')
    await type('Next step')
    await click('Apply connection style')
    await saved()
    await click('Reverse connection arrows')
    await saved()
    expect(run('return (await read()).edges[0]')).toMatchObject({
      id: edge.id,
      label: 'Next step',
      fromEnd: 'arrow',
      toEnd: 'none',
    })
    shot('connection-style')
    await press('view().contentEl.querySelector(".abele-canvas-connection-properties summary")')
    await fit()
    await input(endpoint('to'), point('gamma'))
    await saved()
    expect(run('return (await read()).edges[0]')).toMatchObject({
      id: edge.id,
      toNode: 'gamma',
      label: 'Next step',
    })
    await click('Undo canvas change')
    await saved()
    expect(run<string>('return (await read()).edges[0].toNode')).toBe('beta')
    await click('Redo canvas change')
    await saved()
    expect(run<string>('return (await read()).edges[0].toNode')).toBe('gamma')
    // Move and resize the bound card using actual pointer gestures.
    await input(point('gamma'))
    const p = point('gamma')
    await input(p, [p[0] - 20, p[1] - 16])
    await saved()
    const c = point('gamma', true)
    await input(c, [c[0] - 16, c[1] - 12])
    await saved()
    expect(run<string>('return (await read()).edges[0].toNode')).toBe('gamma')
    await fit()
    shot('flowchart')
    // Select the connection in its visible gap, then delete and restore it.
    const gap = run<number[]>(
      `const v=view().viewer,c=v.camera,r=v.stage.getBoundingClientRect(),edge=v.graph.edges[0],a=v.graph.nodes.find(n=>n.id===edge.fromNode),b=v.graph.nodes.find(n=>n.id===edge.toNode),end=(n,side)=>({top:[n.x+n.width/2,n.y],right:[n.x+n.width,n.y+n.height/2],bottom:[n.x+n.width/2,n.y+n.height],left:[n.x,n.y+n.height/2]})[side],p=end(a,edge.fromSide??'right'),q=end(b,edge.toSide??'left');return [Math.round(r.left+((p[0]+q[0])/2-c.x)*c.zoom),Math.round(r.top+((p[1]+q[1])/2-c.y)*c.zoom)]`
    )
    await input(gap)
    expect(run<boolean>(`return view().viewer.selection.has(${JSON.stringify(edge.id)})`)).toBe(
      true
    )
    await click('Delete selected card')
    await saved()
    expect(run<number>('return (await read()).edges.length')).toBe(0)
    await click('Undo canvas change')
    await saved()
    expect(run<string>('return (await read()).edges[0].id')).toBe(edge.id)
  }, 120_000)

  it('draws a free arrow, edits its endpoints, and retains it through a real native Canvas move', async () => {
    await click('Shapes and connections')
    await click('Draw free arrow')
    await fit()
    const points = run<number[]>(
      `const r=view().viewer.stage.getBoundingClientRect();return [Math.round(r.left+r.width*.15),Math.round(r.top+r.height*.7),Math.round(r.left+r.width*.4),Math.round(r.top+r.height*.9)]`
    )
    await input(points.slice(0, 2), points.slice(2))
    await saved()
    const original = run<{ id: string }>('return (await read()).abele.lines[0]')
    expect(original).toMatchObject({ version: 1, toEnd: 'arrow' })
    await click('Select canvas objects')
    await click('Shapes and connections')
    await fit()
    const e = endpoint('to')
    await input(e, [e[0] + 12, e[1] - 16])
    await saved()
    const line = run('return (await read()).abele.lines[0]')
    expect(line).not.toEqual(original)
    shot('free-arrow')
    // Native handoff is chosen through the header action, not an internal edit call.
    await press('view().containerEl.querySelector(\'[aria-label="Open in Obsidian Canvas"]\')')
    await until("app.workspace.getLeavesOfType('canvas').some(l=>l.view.file?.path===path)")
    await new Promise((r) => setTimeout(r, 800))
    const nativePoint = run<number[]>(
      `const leaf=app.workspace.getLeavesOfType('canvas').find(l=>l.view.file?.path===path),node=leaf.view.canvas.nodes.get('alpha'),r=node.nodeEl.getBoundingClientRect();return [Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)]`
    )
    const before = run<number>("return (await read()).nodes.find(n=>n.id==='alpha').x")
    await input(nativePoint, [nativePoint[0] + 20, nativePoint[1] + 14])
    await until(`(await read()).nodes.find(n=>n.id==='alpha').x!==${before}`)
    expect(run('return (await read()).abele.lines[0]')).toEqual(line)
    expect(run('return (await read()).abele.future')).toEqual({ opaque: true })
    run(
      "app.workspace.getLeavesOfType('canvas').find(l=>l.view.file?.path===path).detach();return true"
    )
    await reopen()
    await fit()
    expect(run('return view().viewer.graph.abele.lines[0]')).toEqual(line)
    shot('native-round-trip')
  }, 120_000)
})
