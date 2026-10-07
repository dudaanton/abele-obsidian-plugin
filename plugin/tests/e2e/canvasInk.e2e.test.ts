import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { driver, tap, swipe, screenshot } from './helpers/phone'
import { withNativeInput } from './helpers/nativeInput'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample canvas ink',
  SHOTS = shotDir('canvas-ink')
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
const saved = () =>
  until(
    "view()?.documentLease&&!view().documentLease.document.session.dirty&&!button('Undo canvas change').disabled"
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
      for(let i=1;i<=12;i++){await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:${from[0]}+(${to[0] - from[0]})*i/12,y:${from[1]}+(${to[1] - from[1]})*i/12,button:'left',buttons:1});await new Promise(r=>setTimeout(r,16))}
      await cdp.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:${to[0]},y:${to[1]},button:'left',buttons:0,clickCount:1})
    }finally{if(owned)cdp.detach()}return true
  `)
    )
}
const press = async (expression: string) => {
  const geometry = `const el=${expression};if(!el)return null;const r=el.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);if(!r.width||!r.height||r.top<0||r.bottom>innerHeight||!el.contains(document.elementFromPoint(x,y)))return null;return[x,y]`
  await expect.poll(() => run<number[] | null>(geometry), { timeout: 15_000 }).not.toBeNull()
  await input(run<number[]>(geometry))
}
const click = (label: string) => press(`button(${JSON.stringify(label)})`)
const fit = async () => {
  await click('Fit diagram')
  await new Promise((r) => setTimeout(r, 350))
}
const point = (node: boolean, corner = false): number[] =>
  run(`
  const v=view().viewer,c=v.camera,r=v.stage.getBoundingClientRect(),n=v.graph.nodes[0]
  return [Math.round(r.left+${node ? `(n.x+${corner ? 'n.width' : 'n.width*0.3'}-c.x)*c.zoom` : 'r.width*0.15'}),Math.round(r.top+${node ? `(n.y+${corner ? 'n.height' : 'n.height*0.6'}-c.y)*c.zoom` : 'r.height*0.85'})]
`)
const shot = (name: string) => {
  const path = `${SHOTS}/${name}.png`
  if (onPhone()) screenshot(path)
  else
    run(
      `const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(${JSON.stringify(path)},image.toPNG());return true`
    )
}

describe.skipIf(!available)('canvas pen with real mouse and finger input', () => {
  beforeAll(
    () =>
      run(`
    if(app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}))throw Error('Synthetic folder already exists')
    window.__canvasInk={layout:app.workspace.getLayout(),folder:app.vault.getConfig('attachmentFolderPath')}
    await app.vault.createFolder(${JSON.stringify(DIR)});window.__canvasInk.owned=true
    app.vault.setConfig('attachmentFolderPath',${JSON.stringify(DIR)})
    await app.vault.create(${JSON.stringify(`${DIR}/sample-note.md`)},${JSON.stringify('# Sample note\n\nA linked note remains separate from its annotation.')})
    await app.vault.create(path,JSON.stringify({nodes:[{id:'note',type:'file',file:${JSON.stringify(`${DIR}/sample-note.md`)},x:0,y:0,width:400,height:220}],edges:[]}))
    const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'abele-canvas',state:{file:path},active:true});await app.workspace.revealLeaf(leaf);return true
  `),
    120_000
  )
  afterAll(
    () =>
      run(`
    document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
    const state=window.__canvasInk,leaves=[];app.workspace.iterateAllLeaves(l=>{if(l.view.file?.path.startsWith(${JSON.stringify(DIR + '/')}))leaves.push(l)})
    for(const leaf of leaves){leaf.view.documentLease?.document.discardDraft();leaf.detach()}
    if(state?.owned){const folder=app.vault.getAbstractFileByPath(${JSON.stringify(DIR)});if(folder)await app.vault.delete(folder,true)}
    if(state){app.vault.setConfig('attachmentFolderPath',state.folder);await app.workspace.changeLayout(state.layout)}
    delete window.__canvasInk;return true
  `),
    120_000
  )
  it('draws attached pen and background marker strokes, then undo/redo restores their exact samples', async () => {
    await until('view()?.editor')
    await click('Canvas drawing tools')
    await click('Draw with pen')
    await fit()
    const start = point(true)
    await input(start, [start[0] + 50, start[1] + 8])
    await saved()
    const attached = run<{ version: number; tool: string; frame: unknown; points: number[] }[]>(
      'return (await read()).nodes[0].abele.ink'
    )
    expect(attached).toHaveLength(1)
    expect(attached[0]).toMatchObject({
      version: 1,
      tool: 'pen',
      frame: { width: 400, height: 220 },
    })
    expect(attached[0].points.length).toBeGreaterThan(6)
    // The foreground plane must really be above live note cards, not hidden behind them.
    expect(
      run<boolean>(
        `const v=view().viewer,p=point=>{const c=v.camera;return[(point[0]+v.graph.nodes[0].x-c.x)*c.zoom,(point[1]+v.graph.nodes[0].y-c.y)*c.zoom]};const xy=p(${JSON.stringify(attached[0].points)}),surface=v.inkCanvas,ratio=surface.width/v.stage.clientWidth,ctx=surface.getContext('2d');return ctx.getImageData(Math.round(xy[0]*ratio),Math.round(xy[1]*ratio),1,1).data[3]>0 && +getComputedStyle(surface).zIndex>(parseFloat(getComputedStyle(v.stage.querySelector('.abele-canvas-cards')).zIndex)||0)`
      )
    ).toBe(true)
    shot('attached-pen')
    await click('Draw with marker')
    const background = point(false)
    await input(background, [background[0] + 55, background[1] - 8])
    await saved()
    expect(run<{ tool: string }[]>('return (await read()).abele.ink')[0].tool).toBe('marker')
    const source = run<string>('return await app.vault.read(app.vault.getAbstractFileByPath(path))')
    await click('Undo canvas change')
    await saved()
    expect(run<unknown>('return (await read()).abele?.ink??null')).toBeNull()
    await click('Redo canvas change')
    await saved()
    expect(run<string>('return await app.vault.read(app.vault.getAbstractFileByPath(path))')).toBe(
      source
    )
    shot('mixed-ink')
  }, 120_000)
  it('moves and resizes the note without rewriting attached samples or moving background ink', async () => {
    const before = run<{ nodes: { abele: unknown }[]; abele: unknown }>('return await read()')
    await click('Canvas drawing tools')
    await fit()
    const start = point(true)
    await input(start, [start[0] + 22, start[1] + 16])
    await saved()
    const corner = point(true, true)
    await input(corner, [corner[0] + 18, corner[1] - 12])
    await saved()
    const after = run<typeof before>('return await read()')
    expect(after.nodes[0].abele).toEqual(before.nodes[0].abele)
    expect(after.abele).toEqual(before.abele)
    expect(
      run<boolean>(
        'const n=(await read()).nodes[0];return n.x!==0&&n.y!==0&&n.width!==400&&n.height!==220'
      )
    ).toBe(true)
    shot('annotation-follows-note')
  }, 120_000)
  it('interrupts drawing with a pinch without adding an accidental stroke', async () => {
    await click('Canvas drawing tools')
    await click('Draw with pen')
    await fit()
    const before = run<string>('return await app.vault.read(app.vault.getAbstractFileByPath(path))')
    if (onPhone()) driver(['pinch', '1.3'])
    else
      await withNativeInput(() =>
        run(`
      const v=view().viewer,r=v.stage.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2)
      const cdp=require('@electron/remote').getCurrentWebContents().debugger,owned=!cdp.isAttached();if(owned)cdp.attach('1.3')
      try{
        const a={id:1,x:x-30,y},b={id:2,x:x+30,y}
        await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a]})
        await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...a,x:x-35}]})
        await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...a,x:x-35},b]})
        await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...a,x:x-60},{...b,x:x+60}]})
        await cdp.sendCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
      }finally{if(owned)cdp.detach()}return true
    `)
      )
    expect(run<string>('return await app.vault.read(app.vault.getAbstractFileByPath(path))')).toBe(
      before
    )
    expect(run<boolean>('return view().documentLease.document.session.dirty')).toBe(false)
    await click('Canvas drawing tools')
  }, 120_000)
  it('reopens the saved scene, exports ink and displays the identical mixed picture in a note embed', async () => {
    run(
      `const leaf=view().leaf;await leaf.setViewState({type:'empty'});await leaf.setViewState({type:'abele-canvas',state:{file:path},active:true});await app.workspace.revealLeaf(leaf);return true`
    )
    await until('view()?.editor')
    await fit()
    expect(
      run<number>('return (await read()).nodes[0].abele.ink.length+(await read()).abele.ink.length')
    ).toBe(2)
    await press('view().containerEl.querySelector(\'[aria-label="Export diagram picture"]\')')
    await press(
      '[...document.querySelectorAll(".menu-item")].find(el=>el.textContent.trim()==="Export whole canvas as PNG")'
    )
    await until('view().lastExport?.extension==="png"&&!view().exportController')
    const exported = run<string>('return view().lastExport.path')
    run(
      `const scope=new window.__abeleTest.ScopeResolver();scope.setFullVaultAccess(true);const tools=Object.fromEntries(window.__abeleTest.createAgentTools().map(t=>[t.name,t]));await tools.canvas_export.execute('sample-export',{path,output:${JSON.stringify(`${DIR}/sample-export.png`)},format:'png'},undefined,{scope,interactive:true});await tools.canvas_export.execute('sample-picture',{path,output:${JSON.stringify(`${DIR}/sample-picture.png`)},format:'png',maxSide:1600},undefined,{scope,interactive:true});return true`
    )
    expect(
      run<boolean>(
        `const a=await app.vault.readBinary(app.vault.getAbstractFileByPath(${JSON.stringify(exported)})),b=await app.vault.readBinary(app.vault.getAbstractFileByPath(${JSON.stringify(`${DIR}/sample-export.png`)}));return a.byteLength===b.byteLength&&new Uint8Array(a).every((v,i)=>v===new Uint8Array(b)[i])`
      )
    ).toBe(true)
    run(
      `const note=await app.vault.create(${JSON.stringify(`${DIR}/sample-embed.md`)},'![[sample.canvas]]');const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'markdown',state:{file:note.path,mode:'preview'},active:true});await app.workspace.revealLeaf(leaf);return true`
    )
    await until(
      'document.querySelector(".abele-canvas-embed-picture")?.complete&&document.querySelector(".abele-canvas-embed-picture")?.naturalWidth>0'
    )
    expect(
      run<boolean>(
        `const image=document.querySelector('.abele-canvas-embed-picture'),data=Uint8Array.from(atob(image.src.split(',')[1]),c=>c.charCodeAt(0)),bytes=new Uint8Array(await app.vault.readBinary(app.vault.getAbstractFileByPath(${JSON.stringify(`${DIR}/sample-picture.png`)})));return data.length===bytes.length&&data.every((v,i)=>v===bytes[i])`
      )
    ).toBe(true)
    shot('saved-canvas-embed')
  }, 120_000)
})
