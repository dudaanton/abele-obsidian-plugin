import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { driver, tap, screenshot, swipeDriverArgs } from './helpers/phone'
import { withNativeInput } from './helpers/nativeInput'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample ink editing',
  SHOTS = shotDir('canvas-ink-editing')
const PRELUDE = `
 const path=${JSON.stringify(`${DIR}/sample.canvas`)}
 const view=()=>app.workspace.getLeavesOfType('abele-canvas').find(l=>l.view.file?.path===path)?.view
 const button=label=>view()?.contentEl.querySelector('[aria-label="'+label+'"]')
 const read=async()=>JSON.parse(await app.vault.read(app.vault.getAbstractFileByPath(path)))
`
const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async()=>{${PRELUDE}return JSON.stringify(await(async()=>{${body}})())})()`,
    120_000
  )
const until = async (expression: string) => {
  await expect.poll(() => run<boolean>(`return !!(${expression})`), { timeout: 20_000 }).toBe(true)
}
const saved = async () => {
  try {
    await until(
      'view()?.documentLease&&!view().documentLease.document.session.dirty&&(!button("Undo canvas change").disabled||!button("Redo canvas change").disabled)'
    )
  } catch (error) {
    throw new Error(
      run<string>(
        'const v=view(),s=v.documentLease.document.session;return JSON.stringify({dirty:s.dirty,busy:s.busy,history:s.history,error:v.documentLease.document.error,status:v.contentEl.querySelector(".abele-canvas-editor-status").textContent,graph:await read()})'
      ),
      { cause: error }
    )
  }
}
async function input(points: number[][]) {
  if (onPhone()) {
    if (points.length === 1) tap(...(points[0] as [number, number]))
    else
      driver(
        swipeDriverArgs(
          ...(points[0] as [number, number]),
          ...(points.at(-1)! as [number, number]),
          300,
          0.15
        )
      )
    return
  }
  await withNativeInput(() =>
    run(`
    const points=${JSON.stringify(points)},cdp=require('@electron/remote').getCurrentWebContents().debugger,owned=!cdp.isAttached();if(owned)cdp.attach('1.3')
    try{
      await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:points[0][0],y:points[0][1],button:'left',buttons:1,clickCount:1})
      for(let j=1;j<points.length;j++)for(let i=1;i<=12;i++){
        const a=points[j-1],b=points[j];await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:a[0]+(b[0]-a[0])*i/12,y:a[1]+(b[1]-a[1])*i/12,button:'left',buttons:1});await new Promise(r=>setTimeout(r,16))
      }
      const end=points.at(-1);await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:end[0],y:end[1],button:'left',buttons:0,clickCount:1})
    }finally{if(owned)cdp.detach()}return true
  `)
  )
}
async function press(expression: string) {
  const probe = `const el=${expression};if(!el)return null;const r=el.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);if(!r.width||!r.height||r.top<0||r.bottom>innerHeight||!el.contains(document.elementFromPoint(x,y)))return null;return[x,y]`
  await expect.poll(() => run<number[] | null>(probe), { timeout: 15_000 }).not.toBeNull()
  await input([run<number[]>(probe)])
}
const click = (label: string) => press(`button(${JSON.stringify(label)})`)
const actions = () =>
  press('view().contentEl.querySelector(".abele-canvas-shape-controls details summary")')
const fit = async () => {
  await click('Fit diagram')
  await new Promise((r) => setTimeout(r, 350))
}
const point = (x: number, y: number): number[] =>
  run(
    `const v=view().viewer,c=v.camera,r=v.stage.getBoundingClientRect();return[Math.round(r.left+(${x}-c.x)*c.zoom),Math.round(r.top+(${y}-c.y)*c.zoom)]`
  )
// Native serialization may reorder keys; compare the entire stored graph and exact samples.
const source = () => run<unknown>('return await read()')
const shot = (name: string) => {
  const path = `${SHOTS}/${name}.png`
  if (onPhone()) screenshot(path)
  else
    run(
      `const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(path)},image.toPNG());return true`
    )
}
async function selectMixed() {
  await click('Lasso canvas objects')
  await fit()
  if (onPhone()) {
    // The physical driver supports straight drags, not a multi-segment loop. Real lasso taps
    // and its additive-selection control exercise mixed finger editing without synthetic events.
    await actions()
    await click('Toggle lasso multiple selection')
    await actions()
    await fit()
    await input([point(100, 310)])
    await input([point(200, 40)])
    await actions()
    await click('Toggle lasso multiple selection')
    await actions()
  } else
    await input(
      [
        [-20, -20],
        [420, -20],
        [420, 350],
        [-20, 350],
        [-20, -20],
      ].map(([x, y]) => point(x, y))
    )
  await until('view().viewer.selection.has("card")&&view().viewer.selection.has("free")')
  await fit()
}

describe.skipIf(!available)('canvas eraser and lasso with real pointer input', () => {
  beforeAll(
    () =>
      run(`
    if(app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}))throw Error('Synthetic folder already exists')
    window.__inkEditing={layout:app.workspace.getLayout()}
    await app.vault.createFolder(${JSON.stringify(DIR)});window.__inkEditing.owned=true
    const ink=(id,points)=>({version:1,id,tool:'pen',color:'1',size:4,points})
    await app.vault.create(path,JSON.stringify({nodes:[{id:'card',type:'text',text:'Sample card',x:0,y:0,width:400,height:200,abele:{ink:[{...ink('attached',[60,120,0.2,300,120,0.8]),frame:{width:400,height:200}}]}}],edges:[],abele:{ink:[ink('free',[20,310,0.5,340,310,0.5])]}}))
    const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-canvas',state:{file:path},active:true});await app.workspace.revealLeaf(leaf);return true
  `),
    120_000
  )
  afterAll(
    () =>
      run(`
    const state=window.__inkEditing,leaves=[];app.workspace.iterateAllLeaves(l=>{if(l.view.file?.path.startsWith(${JSON.stringify(DIR + '/')}))leaves.push(l)})
    for(const leaf of leaves){leaf.view.documentLease?.document.discardDraft();leaf.detach()}
    if(state?.owned){const folder=app.vault.getAbstractFileByPath(${JSON.stringify(DIR)});if(folder)await app.vault.delete(folder,true)}
    if(state)await app.workspace.changeLayout(state.layout)
    delete window.__inkEditing;return true
  `),
    120_000
  )
  it('erases whole attached strokes and cuts free strokes, with exact undo for each sweep', async () => {
    await until('view()?.editor')
    await click('Canvas drawing tools')
    await click('Erase whole strokes')
    await fit()
    const before = source()
    await input([point(150, 120), point(200, 120)])
    await saved()
    expect(run<number>('return (await read()).nodes[0].abele.ink.length')).toBe(0)
    expect(run<number>('return (await read()).abele.ink.length')).toBe(1)
    shot('whole-eraser')
    await click('Undo canvas change')
    await saved()
    expect(source()).toEqual(before)
    await click('Erase part of strokes')
    await fit()
    await input([point(180, 290), point(180, 330)])
    await saved()
    expect(run<number>('return (await read()).abele.ink.length')).toBe(2)
    expect(run<number>('return (await read()).nodes[0].abele.ink.length')).toBe(1)
    shot('partial-eraser')
    await click('Undo canvas change')
    await saved()
    expect(source()).toEqual(before)
  }, 120_000)
  it('selects mixed ink/cards, moves and scales once, recolours and deletes with shared undo', async () => {
    await selectMixed()
    const before = source(),
      start = point(200, 40)
    await input([start, [start[0] + 20, start[1] + 15]])
    await saved()
    expect(
      run<boolean>('const g=await read();return g.nodes[0].x>0&&g.abele.ink[0].transform.x>0')
    ).toBe(true)
    shot('mixed-selection-moved')
    await click('Undo canvas change')
    await saved()
    expect(source()).toEqual(before)
    await fit()
    const handle = run<number[]>(
      'const r=button("Scale canvas selection").getBoundingClientRect();return[Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)]'
    )
    await input([handle, [handle[0] - 20, handle[1] - 15]])
    await saved()
    expect(run<boolean>('return (await read()).nodes[0].width<400')).toBe(true)
    await click('Undo canvas change')
    await saved()
    expect(source()).toEqual(before)
    await actions()
    await click('Recolor canvas selection')
    await saved()
    expect(run<string>('return (await read()).abele.ink[0].color')).toBe('')
    await click('Undo canvas change')
    await saved()
    expect(source()).toEqual(before)
    await click('Delete canvas selection')
    await saved()
    expect(run<number>('return (await read()).nodes.length+(await read()).abele.ink.length')).toBe(
      0
    )
    await click('Undo canvas change')
    await saved()
    expect(source()).toEqual(before)
    await actions()
  }, 180_000)
  it('detaches and attaches annotations, groups mixed content and promotes group ink on ungroup', async () => {
    await click('Lasso canvas objects')
    await fit()
    await input([point(150, 120)])
    await until('view().viewer.selection.has("attached")')
    await actions()
    const before = source()
    await click('Detach selected ink')
    await saved()
    expect(
      run<boolean>('return (await read()).abele.ink.some(s=>s.id==="attached"&&!s.frame)')
    ).toBe(true)
    shot('detached-annotation')
    await click('Undo canvas change')
    await saved()
    expect(source()).toEqual(before)
    await actions()
    await selectMixed()
    await actions()
    await click('Attach selected ink')
    await saved()
    expect(run<boolean>('return (await read()).nodes[0].abele.ink.some(s=>s.id==="free")')).toBe(
      true
    )
    await click('Undo canvas change')
    await saved()
    expect(source()).toEqual(before)
    await click('Group canvas selection')
    await saved()
    expect(run<number>('return (await read()).nodes.filter(n=>n.type==="group").length')).toBe(1)
    expect(
      run<boolean>(
        'return (await read()).nodes.find(n=>n.type==="group").abele.ink.some(s=>s.id==="free")'
      )
    ).toBe(true)
    shot('mixed-group')
    await click('Ungroup canvas selection')
    await saved()
    expect(run<boolean>('return (await read()).abele.ink.some(s=>s.id==="free"&&!s.frame)')).toBe(
      true
    )
    await click('Undo canvas change')
    await saved()
    expect(run<number>('return (await read()).nodes.filter(n=>n.type==="group").length')).toBe(1)
    await click('Undo canvas change')
    await saved()
    expect(source()).toEqual(before)
    await actions()
  }, 180_000)
  it('cancels an eraser sweep on pinch without adding history or saving partial changes', async () => {
    await click('Erase whole strokes')
    await fit()
    const before = source()
    if (onPhone()) driver(['pinch', '1.3'])
    else
      await withNativeInput(() =>
        run(`
      const [x,y]=${JSON.stringify(point(180, 120))},cdp=require('@electron/remote').getCurrentWebContents().debugger,owned=!cdp.isAttached();if(owned)cdp.attach('1.3')
      try{
        const a={id:1,x,y},b={id:2,x:x+40,y:y+30}
        await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a]})
        await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...a,x:x+10}]})
        await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...a,x:x+10},b]})
        await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...a,x:x-20},{...b,x:x+60}]})
        await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
      }finally{if(owned)cdp.detach()}return true
    `)
      )
    expect(source()).toEqual(before)
    expect(run<boolean>('return view().documentLease.document.session.dirty')).toBe(false)
    shot('eraser-pinch')
  }, 120_000)
  it('lets an agent continue real human ink, then selects both strokes and undoes their shared batches', async () => {
    await click('Draw with pen')
    await fit()
    const start = point(80, 250),
      end = point(180, 250)
    if (onPhone()) await input([start, end])
    else {
      const during = await withNativeInput(() =>
        run<{ busy: boolean; refused: boolean; unchanged: boolean }>(`
        const before=await app.vault.read(app.vault.getAbstractFileByPath(path)),cdp=require('@electron/remote').getCurrentWebContents().debugger,owned=!cdp.isAttached()
        if(owned)cdp.attach('1.3')
        try {
          const start=${JSON.stringify(start)},end=${JSON.stringify(end)}
          await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:start[0],y:start[1],button:'left',buttons:1,clickCount:1})
          const scope=new window.__abeleTest.ScopeResolver();scope.setFullVaultAccess(true)
          const ctx={scope,interactive:true},tools=Object.fromEntries(window.__abeleTest.createAgentTools().map(t=>[t.name,t]))
          const snapshot=JSON.parse((await tools.canvas_read.execute('read',{path},undefined,ctx)).content[0].text)
          let refused=false
          try {await tools.canvas_edit.execute('blocked',{path,revision:snapshot.revision,ops:[{op:'add_ink',stroke:{version:1,id:'blocked-ink',tool:'pen',points:[0,0,0.5]}}]},undefined,ctx)}catch(error){refused=/busy|pending/i.test(error.message)}
          const unchanged=before===await app.vault.read(app.vault.getAbstractFileByPath(path))
          for(let i=1;i<=12;i++){await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:start[0]+(end[0]-start[0])*i/12,y:start[1]+(end[1]-start[1])*i/12,button:'left',buttons:1});await new Promise(r=>setTimeout(r,16))}
          return {busy:snapshot.state?.busy===true,refused,unchanged}
        } finally {
          await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:${end[0]},y:${end[1]},button:'left',buttons:0,clickCount:1})
          if(owned)cdp.detach()
        }
      `)
      )
      expect(during).toEqual({ busy: true, refused: true, unchanged: true })
    }
    await saved()
    const humanId = run<string>('return (await read()).abele.ink.find(s=>s.id!=="free").id'),
      before = source()
    const edited = run<{ ids: string[]; picture: boolean }>(`
      const scope=new window.__abeleTest.ScopeResolver();scope.setFullVaultAccess(true)
      const ctx={scope,interactive:true},tools=Object.fromEntries(window.__abeleTest.createAgentTools().map(t=>[t.name,t]))
      const snapshot=JSON.parse((await tools.canvas_read.execute('read',{path},undefined,ctx)).content[0].text)
      await tools.canvas_edit.execute('edit',{path,revision:snapshot.revision,ops:[
        {op:'update_ink',id:${JSON.stringify(humanId)},patch:{color:'4'}},
        {op:'add_ink',stroke:{version:1,id:'agent-ink',tool:'pen',points:[80,280,0.5,180,280,0.5]}}
      ]},undefined,ctx)
      const result=JSON.parse((await tools.canvas_read.execute('read',{path},undefined,ctx)).content[0].text)
      const picture=await tools.look_at_canvas.execute('picture',{path,region:{x:50,y:220,width:160,height:90},maxSide:800},undefined,ctx)
      return {ids:result.ink.map(s=>s.id),picture:picture.injectMessages[0].content.some(c=>c.type==='image_url'&&c.image_url.url.startsWith('data:image/png;base64,'))}
    `)
    expect(edited.ids).toContain(humanId)
    expect(edited.ids).toContain('agent-ink')
    expect(edited.picture).toBe(true)
    await click('Lasso canvas objects')
    await fit()
    await actions()
    await click('Toggle lasso multiple selection')
    await actions()
    await input([point(130, 250)])
    await input([point(130, 280)])
    await until(
      `view().viewer.selection.has(${JSON.stringify(humanId)})&&view().viewer.selection.has('agent-ink')`
    )
    await actions()
    await click('Toggle lasso multiple selection')
    await click('Recolor canvas selection')
    await saved()
    expect(
      run<string[]>(
        `return (await read()).abele.ink.filter(s=>[${JSON.stringify(humanId)},'agent-ink'].includes(s.id)).map(s=>s.color)`
      )
    ).toEqual(['', ''])
    shot('human-agent-ink-selected')
    await click('Undo canvas change')
    await saved()
    expect(
      run<string>(
        `return (await read()).abele.ink.find(s=>s.id===${JSON.stringify(humanId)}).color`
      )
    ).toBe('4')
    await click('Undo canvas change')
    await saved()
    expect(source()).toEqual(before)
    await actions()
    shot('agent-ink-batch-undone')
  }, 180_000)
})
